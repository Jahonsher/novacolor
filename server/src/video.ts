import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { setPriority } from 'node:os'
import path from 'node:path'
import { errMsg, log } from './log.js'
import { sniffImage, UploadError } from './uploads.js'

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
/** Bigger uploads are re-encoded to H.264 720p in the background (when ffmpeg is available). */
export const TRANSCODE_ABOVE_BYTES = 25 * 1024 * 1024
export const POSTER_MAX_SIDE = 1080

export type VideoKind = 'mp4' | 'mov' | 'webm'

const ascii = (b: Uint8Array, from: number, to: number) => Buffer.from(b.subarray(from, to)).toString('latin1')

/** ISO-BMFF brands of still images (HEIC/AVIF/…) — they also start with an `ftyp` box. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis', 'jpeg', 'jp2 ', 'crx '])

/**
 * Video type by magic bytes: an `ftyp` box at offset 4 (MP4 / QuickTime MOV; image brands are refused)
 * or an EBML header (1A 45 DF A3) whose DocType is `webm`.
 */
export function sniffVideo(b: Uint8Array): VideoKind | null {
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const major = ascii(b, 8, 12)
    if (IMAGE_BRANDS.has(major)) return null
    return major === 'qt  ' ? 'mov' : 'mp4'
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    // the DocType element lives in the first few dozen bytes of the EBML header
    return ascii(b, 4, Math.min(b.length, 64)).includes('webm') ? 'webm' : null
  }
  return null
}

/** Enough of the file to identify it. */
const SNIFF_BYTES = 64
const MAX_PART_HEADERS = 16 * 1024
const MAX_FIELD_BYTES = 64 * 1024

export type ReceivedFile<K> = { tmp: string; bytes: number; kind: K; name: string; fields: Record<string, string> }

/**
 * Stream the `file` field of a multipart/form-data request straight to a temp file in `dir` — the body is
 * never buffered in memory (a 200 MB video on a 1 GB server). The size limit is enforced while reading
 * (and up front from Content-Length); the type is checked from the first bytes, so a wrong file is refused
 * before the rest of it is stored. The temp name is a dotfile (never served by /uploads).
 */
export async function receiveFile<K>(
  req: Request,
  opts: { dir: string; maxBytes: number; what: string; sniff: (head: Uint8Array) => K | null; badType: string },
): Promise<ReceivedFile<K>> {
  const { maxBytes, what } = opts
  const tooBig = () => new UploadError(`${what}: fayl juda katta (maks. ${Math.round(maxBytes / 1048576)} MB)`, 413)
  const ct = req.headers.get('content-type') ?? ''
  const bm = /^multipart\/form-data\s*;.*?\bboundary=(?:"([^"]{1,200})"|([^\s;]{1,200}))/i.exec(ct)
  if (!bm) throw new UploadError(`${what}: "file" maydoni kerak (multipart/form-data)`)
  const boundary = bm[1] ?? bm[2]!
  // multipart overhead (headers, other fields) is small; anything well over the limit is refused unread
  const envelope = maxBytes + 1024 * 1024
  const declared = Number(req.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > envelope) throw tooBig()
  if (!req.body) throw new UploadError(`${what}: so'rov tanasi bo'sh`)

  // a leading CRLF lets the first boundary match the same delimiter as the others
  const delim = Buffer.from(`\r\n--${boundary}`)
  const CRLF2 = Buffer.from('\r\n\r\n')
  const reader = req.body.getReader()
  let buf: Buffer = Buffer.from('\r\n')
  let total = 0
  // (`as` keeps TS from narrowing: the state is changed inside parse())
  let state = 'preamble' as 'preamble' | 'after' | 'headers' | 'body' | 'done'
  let part: { kind: 'file' } | { kind: 'field'; name: string; chunks: Buffer[]; size: number } | { kind: 'skip' } | null = null
  const fields: Record<string, string> = {}
  let fh = null as FileHandle | null
  const tmp = path.join(opts.dir, `.upload-${randomBytes(8).toString('hex')}.tmp`)
  let fileSeen = false
  let fileName = ''
  let fileBytes = 0
  let head = Buffer.alloc(0)
  let kind: K | null = null

  const writeFile = async (data: Buffer) => {
    if (!data.length) return
    fileBytes += data.length
    if (fileBytes > maxBytes) throw tooBig()
    if (kind === null && head.length < SNIFF_BYTES) {
      head = Buffer.concat([head, data.subarray(0, SNIFF_BYTES - head.length)])
      if (head.length >= SNIFF_BYTES) {
        kind = opts.sniff(head)
        if (kind === null) throw new UploadError(opts.badType)
      }
    }
    await fh!.write(data)
  }
  const endPart = async () => {
    if (part?.kind === 'file') {
      if (kind === null) {
        kind = opts.sniff(head)
        if (kind === null) throw new UploadError(fileBytes ? opts.badType : `${what}: fayl bo'sh`)
      }
      await fh!.close()
      fh = null
    } else if (part?.kind === 'field') {
      fields[part.name] = Buffer.concat(part.chunks).toString('utf8')
    }
    part = null
  }
  const partData = async (data: Buffer) => {
    if (!part || !data.length) return
    if (part.kind === 'file') return writeFile(data)
    if (part.kind === 'field') {
      part.size += data.length
      if (part.size > MAX_FIELD_BYTES) throw new UploadError(`${what}: maydon juda katta`)
      part.chunks.push(Buffer.from(data))
    }
  }

  const parse = async () => {
    for (;;) {
      if (state === 'preamble') {
        const i = buf.indexOf(delim)
        if (i < 0) {
          buf = buf.subarray(Math.max(0, buf.length - delim.length + 1))
          return
        }
        buf = buf.subarray(i + delim.length)
        state = 'after'
      } else if (state === 'after') {
        if (buf.length < 2) return
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          state = 'done'
          return
        }
        // optional transport padding (spaces / tabs) before the CRLF
        const nl = buf.indexOf('\r\n')
        if (nl < 0) {
          if (buf.length > 256) throw new UploadError(`${what}: multipart formati noto'g'ri`)
          return
        }
        buf = buf.subarray(nl + 2)
        state = 'headers'
      } else if (state === 'headers') {
        const i = buf.indexOf(CRLF2)
        if (i < 0) {
          if (buf.length > MAX_PART_HEADERS) throw new UploadError(`${what}: multipart formati noto'g'ri`)
          return
        }
        const headers = buf.subarray(0, i).toString('utf8')
        buf = buf.subarray(i + 4)
        const disp = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? ''
        const name = /\bname="([^"]*)"/i.exec(disp)?.[1] ?? /\bname=([^\s;]+)/i.exec(disp)?.[1] ?? ''
        const filename = /\bfilename="([^"]*)"/i.exec(disp)?.[1]
        if (name === 'file' && filename !== undefined && !fileSeen) {
          fileSeen = true
          fileName = filename
          fh = await open(tmp, 'wx', 0o644)
          part = { kind: 'file' }
        } else if (filename === undefined && name && Object.keys(fields).length < 20) {
          part = { kind: 'field', name, chunks: [], size: 0 }
        } else {
          part = { kind: 'skip' }
        }
        state = 'body'
      } else if (state === 'body') {
        const i = buf.indexOf(delim)
        if (i < 0) {
          // keep a possible partial delimiter at the end for the next chunk
          const safe = buf.length - (delim.length - 1)
          if (safe > 0) {
            await partData(buf.subarray(0, safe))
            buf = buf.subarray(safe)
          }
          return
        }
        await partData(buf.subarray(0, i))
        await endPart()
        buf = buf.subarray(i + delim.length)
        state = 'after'
      } else {
        return
      }
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > envelope) throw tooBig()
      buf = buf.length ? Buffer.concat([buf, value]) : Buffer.from(value)
      await parse()
      if (state === 'done') break
    }
    if (state !== 'done') throw new UploadError(`${what}: yuklash oxirigacha yetmadi (aloqa uzildi?)`)
    if (!fileSeen) throw new UploadError(`${what}: "file" maydoni kerak (multipart/form-data)`)
    if (!fileBytes || kind === null) throw new UploadError(`${what}: fayl bo'sh`)
    return { tmp, bytes: fileBytes, kind, name: fileName, fields }
  } catch (e) {
    await reader.cancel().catch(() => undefined)
    await fh?.close().catch(() => undefined)
    await rm(tmp, { force: true })
    throw e
  }
}

/* ---------------- ffmpeg (optional) ---------------- */

type RunResult = { ok: boolean; error?: string }

/**
 * Optional ffmpeg helpers: poster frames and background re-encoding of big uploads.
 * Everything degrades gracefully: without ffmpeg (or with FFMPEG_PATH=off) uploads still work.
 * Transcodes run one at a time at the lowest CPU priority, so the site stays responsive on 1 vCPU.
 */
export class VideoTools {
  private availability: Promise<boolean> | null = null
  private queue: Promise<void> = Promise.resolve()
  private children = new Set<ChildProcess>()
  private closed = false
  /** Upload paths (`uploads/videos/…`) waiting for / being transcoded. */
  readonly processing = new Set<string>()

  constructor(
    private readonly bin: string | null,
    private readonly uploadsDir: string,
    /** Called after `from` was replaced by `to` on disk (rewrite references in content.json). */
    private readonly onTranscoded: (from: string, to: string) => Promise<void>,
  ) {}

  /** Can ffmpeg be run? Checked once (`ffmpeg -version`). */
  available(): Promise<boolean> {
    if (!this.bin) return Promise.resolve(false)
    this.availability ??= this.run(['-version'], 10_000).then((r) => {
      if (!r.ok) log.warn(`ffmpeg topilmadi (${this.bin}): video uchun poster avtomatik yaratilmaydi`)
      return r.ok
    })
    return this.availability
  }

  /** JPEG frame (at 1 s, or the first frame of a shorter clip), at most 1080px on the long side. */
  async poster(input: string, output: string): Promise<boolean> {
    if (!(await this.available())) return false
    const vf = `scale=w='min(${POSTER_MAX_SIDE},iw)':h='min(${POSTER_MAX_SIDE},ih)':force_original_aspect_ratio=decrease`
    for (const at of ['1', '0']) {
      await rm(output, { force: true })
      const r = await this.run(
        ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', at, '-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '3', output],
        60_000,
      )
      if (r.ok && (await isJpeg(output))) return true
    }
    await rm(output, { force: true })
    return false
  }

  /**
   * Queue a background transcode to H.264 720p (CRF 28, AAC, +faststart) when it's worth it: the file is
   * bigger than 25 MB, or it isn't MP4 (MOV/WebM don't play everywhere). Returns true if queued.
   * The result `<id>-720p.mp4` replaces the original only if it's smaller (or the original isn't MP4).
   */
  async maybeTranscode(rel: string, bytes: number, kind: VideoKind): Promise<boolean> {
    if (this.closed || (bytes <= TRANSCODE_ABOVE_BYTES && kind === 'mp4')) return false
    if (!(await this.available())) return false
    this.processing.add(rel)
    this.queue = this.queue.then(() => this.transcode(rel, bytes, kind)).catch((e) => log.error(`Video siqish: ${errMsg(e)}`))
    return true
  }

  private async transcode(rel: string, bytes: number, kind: VideoKind) {
    const input = path.join(this.uploadsDir, rel.replace(/^uploads\//, ''))
    const target = transcodedPath(rel)
    const output = path.join(this.uploadsDir, target.replace(/^uploads\//, ''))
    const tmp = path.join(path.dirname(output), `.${path.basename(output, '.mp4')}.${randomBytes(4).toString('hex')}.tmp.mp4`)
    try {
      if (this.closed || !existsSync(input)) return
      const t = Date.now()
      // 720p = the short side ≤ 720 (vertical reels → 720×1280); never upscaled; even dimensions for yuv420p
      const vf = "scale=w='if(gt(iw,ih),-2,min(720,iw))':h='if(gt(iw,ih),min(720,ih),-2)'"
      const r = await this.run(
        [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-vf', vf,
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp,
        ],
        45 * 60_000,
        true,
      )
      if (!r.ok) {
        log.warn(`Video siqilmadi (${rel}): ${r.error ?? 'ffmpeg xatosi'} — asl fayl qoladi`)
        return
      }
      const out = await stat(tmp).catch(() => null)
      if (!out?.size || !(await sniffFile(tmp))) {
        log.warn(`Video siqilmadi (${rel}): natija bo'sh — asl fayl qoladi`)
        return
      }
      // the video was deleted (file cleaned up) while it was being encoded
      if (!existsSync(input)) return
      if (kind === 'mp4' && out.size >= bytes) {
        log.info(`Video siqish foyda bermadi (${rel}): asl fayl qoladi`)
        return
      }
      await rename(tmp, output)
      log.info(`Video siqildi: ${rel} → ${target} (${mb(bytes)} → ${mb(out.size)} MB, ${Math.round((Date.now() - t) / 1000)} s)`)
      await this.onTranscoded(rel, target)
      await rm(input, { force: true })
    } finally {
      await rm(tmp, { force: true })
      this.processing.delete(rel)
    }
  }

  /** Resolves once every queued transcode has finished (tests / shutdown). */
  idle(): Promise<void> {
    return this.queue
  }

  close() {
    this.closed = true
    for (const c of this.children) c.kill('SIGKILL')
  }

  private run(args: string[], timeoutMs: number, lowPriority = false): Promise<RunResult> {
    const bin = this.bin
    if (!bin || this.closed) return Promise.resolve({ ok: false, error: 'ffmpeg yo‘q' })
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      } catch (e) {
        return resolve({ ok: false, error: errMsg(e) })
      }
      this.children.add(child)
      if (lowPriority && child.pid) {
        try {
          setPriority(child.pid, 19)
        } catch {
          /* not permitted — fine */
        }
      }
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-2000)
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      let settled = false
      const done = (r: RunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.children.delete(child)
        resolve(r)
      }
      child.on('error', (e) => done({ ok: false, error: e.message }))
      child.on('close', (code, signal) =>
        done(code === 0 ? { ok: true } : { ok: false, error: signal ? `to'xtatildi (${signal})` : stderr.trim().split('\n').pop() || `kod ${code}` }),
      )
    })
  }
}

const mb = (n: number) => (n / 1048576).toFixed(1)

/** `uploads/videos/<id>.<ext>` → `uploads/videos/<id>-720p.mp4` */
export const transcodedPath = (rel: string) => rel.replace(/\.(mp4|webm|mov)$/, '-720p.mp4')

async function isJpeg(file: string) {
  try {
    const fh = await open(file, 'r')
    try {
      const b = Buffer.alloc(3)
      await fh.read(b, 0, 3, 0)
      return sniffImage(b) === 'jpeg'
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

async function sniffFile(file: string) {
  try {
    return sniffVideo((await readFile(file)).subarray(0, SNIFF_BYTES))
  } catch {
    return null
  }
}

/** New unique base name for an upload (same scheme as images). */
export const uploadId = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`
