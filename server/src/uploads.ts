import { randomBytes } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { HttpError } from './errors.js'
import { atomicWrite } from './store/fs-utils.js'

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_PDF_BYTES = 30 * 1024 * 1024
export const MAX_IMAGE_SIDE = 2000
/** ~40 MP (e.g. 8000×5000): decoding bigger images could take hundreds of MB of RAM on a small VPS. */
export const MAX_INPUT_PIXELS = 40_000_000

// One libvips worker thread and no operation cache: uploads are rare, RAM on a 1 GB server is not.
sharp.concurrency(1)
sharp.cache(false)

export class UploadError extends HttpError {
  constructor(message: string, status: 400 | 413 = 400) {
    super(status, message)
  }
}

export type ImageKind = 'jpeg' | 'png' | 'webp'

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png'
  const ascii = (from: number, to: number) => Buffer.from(b.subarray(from, to)).toString('latin1')
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

export const isPdf = (b: Uint8Array) => b.length >= 5 && Buffer.from(b.subarray(0, 5)).toString('latin1') === '%PDF-'

/** Read a multipart field as a File and enforce the size limit. */
export async function readUpload(file: unknown, maxBytes: number, what: string): Promise<{ bytes: Buffer; name: string }> {
  if (!(file instanceof File)) throw new UploadError(`${what}: "file" maydoni kerak (multipart/form-data)`)
  if (file.size === 0) throw new UploadError(`${what}: fayl bo'sh`)
  if (file.size > maxBytes) throw new UploadError(`${what}: fayl juda katta (maks. ${Math.round(maxBytes / 1048576)} MB)`, 413)
  return { bytes: Buffer.from(await file.arrayBuffer()), name: file.name || '' }
}

const unreadable = () => new UploadError("Rasmni o'qib bo'lmadi (fayl buzilgan yoki juda katta)")

/**
 * Store an uploaded image: max 2000px, EXIF orientation applied, metadata (GPS …) stripped, WebP q82.
 * A small, already-compressed JPEG/WebP can come out BIGGER as WebP — then the original bytes are kept
 * (with their own extension), but only if they need no change at all: within 2000px, no rotation, no
 * metadata to strip.
 */
export async function saveImage(uploadsDir: string, bytes: Buffer) {
  const kind = sniffImage(bytes)
  if (!kind) throw new UploadError('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')
  const input = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
  const meta = await input()
    .metadata()
    .catch(() => {
      throw unreadable()
    })
  const out = await input()
    .rotate()
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw unreadable()
    })

  let data: Buffer = out.data
  let ext = 'webp'
  let { width, height } = out.info
  const untouched =
    (kind === 'jpeg' || kind === 'webp') &&
    !!meta.width &&
    !!meta.height &&
    meta.width <= MAX_IMAGE_SIDE &&
    meta.height <= MAX_IMAGE_SIDE &&
    (meta.orientation ?? 1) === 1 &&
    !meta.exif &&
    !meta.xmp &&
    !meta.iptc &&
    (meta.pages ?? 1) === 1
  if (untouched && bytes.length <= out.data.length) {
    data = bytes
    ext = kind === 'jpeg' ? 'jpg' : 'webp'
    width = meta.width!
    height = meta.height!
  }

  const id = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`
  await atomicWrite(path.join(uploadsDir, 'images', `${id}.${ext}`), data)
  return { path: `uploads/images/${id}.${ext}`, width, height }
}

const translit: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

export function slugifyFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '').toLowerCase()
  const s = [...base]
    .map((ch) => translit[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || 'hujjat'
}

/**
 * Save a PDF to uploads/pdf/<name>.pdf with a name unique among `taken` and on disk.
 * The name is reserved atomically (`open(…, 'wx')` fails if the file exists), so two concurrent uploads
 * of the same file name can't pick the same name; the content is then written to a temp file and renamed
 * over the reservation (readers never see a half-written PDF).
 */
export async function savePdf(uploadsDir: string, bytes: Buffer, originalName: string, taken: Set<string>) {
  if (!isPdf(bytes)) throw new UploadError('Faqat PDF fayl yuklash mumkin (%PDF bilan boshlanishi kerak)')
  const dir = path.join(uploadsDir, 'pdf')
  const base = slugifyFileName(originalName)
  let name = ''
  for (let i = 1; ; i++) {
    name = i === 1 ? `${base}.pdf` : `${base}-${i}.pdf`
    if (taken.has(name)) continue
    try {
      await (await open(path.join(dir, name), 'wx')).close()
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  const target = path.join(dir, name)
  try {
    await atomicWrite(target, bytes)
  } catch (e) {
    await rm(target, { force: true })
    throw e
  }
  return { file: name, path: `uploads/pdf/${name}`, size: Math.max(1, Math.round(bytes.length / 1024)) }
}
