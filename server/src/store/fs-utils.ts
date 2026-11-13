import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

/** Serialises async critical sections inside one process. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => undefined)
    return next
  }

  /** Resolves once everything queued so far has finished. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined)
  }
}

/** Write a file atomically: temp file in the same dir → fsync → rename. `mode` e.g. 0o600 for private files. */
export async function atomicWrite(file: string, data: string | Uint8Array, mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const fh = await open(tmp, 'w', mode)
  try {
    // the umask may have masked `mode` at creation; this also narrows it if the umask is permissive
    await fh.chmod(mode)
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${path.basename(file)} buzilgan (JSON o'qib bo'lmadi): ${file}`)
  }
}

/** Best-effort chmod (e.g. tighten files created by older versions); ignores missing files / foreign owners. */
export async function tryChmod(p: string, mode: number): Promise<void> {
  await chmod(p, mode).catch(() => undefined)
}

export type JsonFileOptions = {
  indent?: number
  /** File mode; private data (leads, chats, settings) is 0o600. */
  mode?: number
  /**
   * Write-behind: the new value is applied in memory under the lock right away and the file is written
   * after it, so updates that arrive while a write is in progress are merged into ONE next write instead
   * of rewriting (and fsyncing) the whole file once per update. Each `update()` still resolves only after
   * a write containing its change has finished. Used for chats.json (big, written on every chat message).
   */
  coalesce?: boolean
}

/** Simple JSON-backed value with atomic writes and an in-process mutex. */
export class JsonFile<T> {
  private mutex = new Mutex()
  private value: T | undefined
  private readonly opts: JsonFileOptions
  private writing: Promise<void> | null = null
  private queued: Promise<void> | null = null

  constructor(
    readonly file: string,
    private readonly initial: () => T,
    opts: JsonFileOptions | number = {},
  ) {
    this.opts = typeof opts === 'number' ? { indent: opts } : opts
  }

  async load(): Promise<T> {
    if (this.value === undefined) {
      this.value = (await readJson<T>(this.file)) ?? this.initial()
      if (this.opts.mode !== undefined) await tryChmod(this.file, this.opts.mode)
    }
    return this.value
  }

  private write(value: T) {
    return atomicWrite(this.file, JSON.stringify(value, null, this.opts.indent), this.opts.mode)
  }

  /** Coalescing flush: at most one write in flight and one queued (which writes the latest value). */
  private flush(): Promise<void> {
    if (this.queued) return this.queued
    if (this.writing) {
      const after = () => {
        this.queued = null
        return this.flush()
      }
      this.queued = this.writing.then(after, after)
      return this.queued
    }
    const p = this.write(this.value as T).finally(() => {
      this.writing = null
    })
    this.writing = p
    return p
  }

  get(): T {
    if (this.value === undefined) throw new Error(`${this.file} hali yuklanmagan`)
    return this.value
  }

  /** Run `fn` on the current value under the lock; the returned value replaces it and is persisted. */
  update<R>(fn: (current: T) => { value: T; result: R } | Promise<{ value: T; result: R }>): Promise<R> {
    if (this.opts.coalesce) {
      return this.mutex
        .run(async () => {
          const { value, result } = await fn(await this.load())
          this.value = value
          return result
        })
        .then(async (result) => {
          await this.flush()
          return result
        })
    }
    return this.mutex.run(async () => {
      const current = await this.load()
      const { value, result } = await fn(current)
      await this.write(value)
      this.value = value
      return result
    })
  }

  async idle() {
    await this.mutex.idle()
    while (this.writing || this.queued) await (this.queued ?? this.writing)?.catch(() => undefined)
  }
}
