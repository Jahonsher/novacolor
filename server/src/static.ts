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

/** Stream a regular file, or return null if it doesn't exist / isn't a file. */
export async function fileResponse(
  file: string,
  method: string,
  cacheControl: string,
): Promise<Response | null> {
  let st
  try {
    st = await stat(file)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  const headers = new Headers({
    'content-type': contentType(file),
    'content-length': String(st.size),
    'cache-control': cacheControl,
    'last-modified': st.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  })
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(body, { status: 200, headers })
}

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
export const CACHE_NO_CACHE = 'no-cache'
export const CACHE_DEFAULT = 'public, max-age=3600'
