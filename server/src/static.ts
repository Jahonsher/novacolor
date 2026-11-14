import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
}

export const contentType = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

/**
 * Resolve a URL path inside `root`; returns null for anything that escapes it
 * (../, encoded traversal, absolute paths, NUL bytes, backslashes, dotfiles).
 */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const parts = decoded.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null
  const rootAbs = path.resolve(root)
  const full = path.resolve(rootAbs, ...parts)
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) return null
  return full
}

/**
 * Single byte range from a `Range` header: `{ start, end }` (inclusive), `'unsatisfiable'` (→ 416), or null
 * when the header is absent / malformed / multi-range (→ the whole file, 200 — allowed by RFC 9110).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    // suffix: the last N bytes
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Number(m[2])
  if (start >= size) return 'unsatisfiable'
  if (end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Stream a regular file, or return null if it doesn't exist / isn't a file.
 * Supports single `Range` requests (206 / 416) — video playback needs it (iOS Safari won't play MP4s
 * from a server without it; seeking fetches only the needed part). `If-Range` with another date → whole file.
 */
export async function fileResponse(
  file: string,
  method: string,
  cacheControl: string,
  req?: { range?: string; ifRange?: string },
): Promise<Response | null> {
  let st
  try {
    st = await stat(file)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  const lastModified = st.mtime.toUTCString()
  const headers = new Headers({
    'content-type': contentType(file),
    'content-length': String(st.size),
    'cache-control': cacheControl,
    'last-modified': lastModified,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  })
  const range = req?.ifRange && req.ifRange !== lastModified ? null : parseRange(req?.range, st.size)
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${st.size}`)
    headers.set('content-length', '0')
    return new Response(null, { status: 416, headers })
  }
  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${st.size}`)
    headers.set('content-length', String(range.end - range.start + 1))
  }
  const status = range ? 206 : 200
  if (method === 'HEAD') return new Response(null, { status, headers })
  const stream = range ? createReadStream(file, { start: range.start, end: range.end }) : createReadStream(file)
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
}

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_NO_CACHE = 'no-cache'
export const CACHE_DEFAULT = 'public, max-age=3600'
