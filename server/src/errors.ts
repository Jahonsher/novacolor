import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Error with an HTTP status and an Uzbek message for `{ error }` responses. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}
