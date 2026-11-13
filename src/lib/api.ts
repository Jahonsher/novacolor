/**
 * Talking to the Node server (docs/backend-spec.md).
 *
 * The GitHub Pages build has no server: VITE_API is unset there, API_ENABLED is
 * a build-time `false` and every caller skips the network entirely.
 */
export const API_ENABLED = Boolean(import.meta.env.VITE_API)

/** `/api/<path>` resolved against the deploy base (`/` on the server, `/novacolor/` in dev). */
export const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path.replace(/^\//, '')}`

/** Error with the server's `{ error }` text (Uzbek) and the HTTP status (0 = network / timeout). */
export class ApiError extends Error {
  status: number
  data: Record<string, unknown> | null
  constructor(message: string, status: number, data: Record<string, unknown> | null = null) {
    super(message)
    this.status = status
    this.data = data
  }
}

type Opts = { timeout?: number; signal?: AbortSignal }

async function request<T>(method: string, path: string, body: unknown, { timeout = 15000, signal }: Opts = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'same-origin',
    })
  } catch (e) {
    throw new ApiError(ctrl.signal.aborted && !signal?.aborted ? 'timeout' : String((e as Error)?.message ?? e), 0)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  let data: Record<string, unknown> | null = null
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`, res.status, data)
  return data as T
}

export const apiGet = <T>(path: string, opts?: Opts) => request<T>('GET', path, undefined, opts)
export const apiPost = <T>(path: string, body: unknown, opts?: Opts) => request<T>('POST', path, body, opts)
