import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { contentSchema, zodMessage, type Content } from '../schemas.js'
import { HttpError } from '../errors.js'
import { log } from '../log.js'
import { atomicWrite, Mutex, readJson } from './fs-utils.js'

export const BACKUPS_KEEP = 30

export class ContentError extends HttpError {
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(status, message)
  }
}

/** Category `count` = number of products in it (always computed server-side). */
export function withCounts(c: Content): Content {
  return {
    ...c,
    categories: c.categories.map((cat) => ({
      ...cat,
      count: c.products.filter((p) => p.categories.includes(cat.id)).length,
    })),
  }
}

export class ContentStore {
  private mutex = new Mutex()
  private current!: Content
  /** Increments on every successful save (used to invalidate derived caches, e.g. the AI prompt). */
  version = 0
  readonly file: string
  readonly backupsDir: string

  constructor(
    readonly dataDir: string,
    readonly seedFile: string,
  ) {
    this.file = path.join(dataDir, 'content.json')
    this.backupsDir = path.join(dataDir, 'backups')
  }

  async init(): Promise<void> {
    let raw = await readJson<unknown>(this.file)
    if (raw === undefined) {
      const seed = await readFile(this.seedFile, 'utf8').catch((e: NodeJS.ErrnoException) => {
        throw new Error(
          `content.json yo'q va boshlang'ich nusxa topilmadi (${this.seedFile}): ${e.code ?? e.message}. SEED_CONTENT ni ko'rsating.`,
        )
      })
      raw = JSON.parse(seed)
      const parsed = contentSchema.safeParse(raw)
      if (!parsed.success) throw new Error(`Boshlang'ich content.json noto'g'ri: ${zodMessage(parsed.error)}`)
      await atomicWrite(this.file, serialize(withCounts(parsed.data)))
      log.info(`content.json yaratildi (nusxa: ${this.seedFile})`)
      raw = parsed.data
    }
    // One-time migration: a content.json from before videos existed (no `videos` key at all) takes the
    // seed's videos. After that the key exists — an admin who deleted every video keeps an empty list.
    let migrated = false
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('videos' in raw)) {
      const seed = await readFile(this.seedFile, 'utf8').then(
        (s) => JSON.parse(s) as { videos?: unknown },
        () => null,
      )
      ;(raw as Record<string, unknown>).videos = Array.isArray(seed?.videos) ? seed.videos : []
      migrated = true
    }
    const parsed = contentSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`${this.file} noto'g'ri: ${zodMessage(parsed.error)}`)
    this.current = withCounts(parsed.data)
    if (migrated) {
      await this.backup()
      await atomicWrite(this.file, serialize(this.current))
      log.info(`content.json: videolar ro'yxati qo'shildi (${this.current.videos.length} ta, nusxa: ${this.seedFile})`)
    }
    this.version++
  }

  get(): Content {
    return this.current
  }

  /**
   * Apply a change under the lock: `fn` receives a deep copy and returns a result.
   * Then: recompute counts → validate → backup previous file → atomic write.
   */
  mutate<R>(fn: (draft: Content) => R): Promise<R> {
    return this.mutex.run(async () => {
      const draft = structuredClone(this.current)
      const result = fn(draft)
      const parsed = contentSchema.safeParse(withCounts(draft))
      if (!parsed.success) throw new ContentError(zodMessage(parsed.error))
      await this.backup()
      await atomicWrite(this.file, serialize(parsed.data))
      this.current = parsed.data
      this.version++
      return result
    })
  }

  private async backup() {
    await mkdir(this.backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let target = path.join(this.backupsDir, `content-${stamp}.json`)
    for (let i = 1; await exists(target); i++) target = path.join(this.backupsDir, `content-${stamp}-${i}.json`)
    try {
      await copyFile(this.file, target)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    const files = (await readdir(this.backupsDir)).filter((f) => /^content-.*\.json$/.test(f)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - BACKUPS_KEEP))) {
      await rm(path.join(this.backupsDir, f), { force: true })
    }
  }

  idle() {
    return this.mutex.idle()
  }
}

const serialize = (c: Content) => JSON.stringify(c, null, 1)

async function exists(p: string) {
  try {
    await readFile(p)
    return true
  } catch {
    return false
  }
}
