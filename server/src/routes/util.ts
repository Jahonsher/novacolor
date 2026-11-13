import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { z } from 'zod'
import { HttpError } from '../errors.js'
import { zodMessage } from '../schemas.js'

/** Parse a JSON body and validate it; throws HttpError(400) with an Uzbek message. */
export async function jsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, "So'rov tanasi JSON formatida bo'lishi kerak")
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new HttpError(400, zodMessage(parsed.error))
  return parsed.data
}

export const notFound = (what: string) => new HttpError(404, `${what} topilmadi`)

const KB = 1024
/** JSON bodies of public endpoints and login. */
export const SMALL_BODY = 16 * KB
/** Admin JSON (a product with long descriptions, the whole about text …). */
export const ADMIN_BODY = 1024 * KB

/**
 * Reject bigger bodies with 413 before they are buffered: an oversized Content-Length is refused
 * without reading anything; a chunked body is read only up to the limit.
 */
export const maxBody = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: () => {
      throw new HttpError(413, "So'rov juda katta")
    },
  })
