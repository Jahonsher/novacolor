import { BlockList, isIP } from 'node:net'
import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

/** Fixed-window in-memory counter per key. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>()
  private timer: NodeJS.Timeout

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 10 * 60_000))
    this.timer.unref()
  }

  private entry(key: string) {
    const t = this.now()
    let e = this.hits.get(key)
    if (!e || e.reset <= t) {
      e = { count: 0, reset: t + this.windowMs }
      this.hits.set(key, e)
    }
    return e
  }

  /** Count one hit; returns false if the key is over the limit (the hit is still counted). */
  hit(key: string): boolean {
    const e = this.entry(key)
    e.count++
    return e.count <= this.limit
  }

  /** True if the key has already used up its limit (does not count a hit). */
  blocked(key: string): boolean {
    return this.entry(key).count >= this.limit
  }

  /** Take back one hit (e.g. a login attempt that turned out to be successful). */
  undo(key: string) {
    const e = this.hits.get(key)
    if (e && e.count > 0) e.count--
  }

  reset(key: string) {
    this.hits.delete(key)
  }

  private sweep() {
    const t = this.now()
    for (const [k, e] of this.hits) if (e.reset <= t) this.hits.delete(k)
  }

  stop() {
    clearInterval(this.timer)
  }
}

/** `::ffff:1.2.3.4` → `1.2.3.4`; trims, strips brackets, lowercases. */
export function normalizeIp(ip: string): string {
  const t = ip.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = t.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  return mapped ? mapped[1]! : t
}

/** Expand an IPv6 address to its 8 hextets; null if it is not IPv6. */
function ipv6Hextets(ip: string): string[] | null {
  if (isIP(ip) !== 6) return null
  let s = ip
  // embedded IPv4 tail (e.g. 64:ff9b::1.2.3.4) → two hextets
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number]
    s = s.slice(0, -v4[0].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = s.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail !== undefined && tail ? tail.split(':') : []
  const fill = tail !== undefined ? Array<string>(8 - h.length - t.length).fill('0') : []
  const all = [...h, ...fill, ...t]
  return all.length === 8 ? all.map((x) => x.replace(/^0+(?=.)/, '')) : null
}

/**
 * Rate-limit key for a client IP: IPv4 as is, IPv6 by its /64 prefix
 * (one subscriber usually gets a whole /64, so per-address limits would be trivial to bypass).
 */
export function limitKey(ip: string): string {
  const n = normalizeIp(ip)
  const hx = ipv6Hextets(n)
  return hx ? `${hx.slice(0, 4).join(':')}::/64` : n
}

/**
 * Proxies whose X-Forwarded-For / X-Real-IP headers are believed (only with TRUST_PROXY=1).
 * Default: loopback + private ranges — a proxy on the same host (nginx) or in the same
 * docker-compose network (Caddy reaches the app from a 172.16.0.0/12 address).
 */
export const DEFAULT_TRUSTED_PROXIES = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']

export class TrustedProxies {
  private list = new BlockList()

  constructor(readonly entries: string[] = DEFAULT_TRUSTED_PROXIES) {
    for (const raw of entries) {
      const [addr = '', bits] = raw.trim().split('/')
      const ip = normalizeIp(addr)
      const v = isIP(ip)
      if (!v) throw new Error(`TRUSTED_PROXIES: noto'g'ri manzil "${raw}"`)
      const max = v === 6 ? 128 : 32
      const prefix = bits === undefined ? max : Number(bits)
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`TRUSTED_PROXIES: noto'g'ri prefiks "${raw}"`)
      this.list.addSubnet(ip, prefix, v === 6 ? 'ipv6' : 'ipv4')
    }
  }

  has(ip: string | undefined): boolean {
    if (!ip) return false
    const n = normalizeIp(ip)
    const v = isIP(n)
    return v === 4 ? this.list.check(n, 'ipv4') : v === 6 ? this.list.check(n, 'ipv6') : false
  }
}

export type ProxyOptions = { trustProxy: boolean; trustedProxies: TrustedProxies }

/** Socket peer address (undefined when the request did not come through @hono/node-server). */
export function peerIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address ?? undefined
  } catch {
    return undefined
  }
}

/** Forwarded headers of this request may be believed: TRUST_PROXY is on and the socket peer is a trusted proxy. */
export const fromTrustedProxy = (c: Context, opts: ProxyOptions) => opts.trustProxy && opts.trustedProxies.has(peerIp(c))

/**
 * Client IP for rate limits and logs.
 * Forwarded headers are used only when TRUST_PROXY is on AND the socket peer is a trusted proxy.
 * Then the RIGHT-MOST X-Forwarded-For entry is taken — the one appended by our proxy; everything to
 * its left is whatever the client sent — or else X-Real-IP. Otherwise: the socket address.
 */
export function clientIp(c: Context, opts: ProxyOptions): string {
  const peer = peerIp(c)
  if (opts.trustProxy && opts.trustedProxies.has(peer)) {
    const last = c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((s) => normalizeIp(s))
      .filter(Boolean)
      .at(-1)
    if (last && isIP(last)) return last
    const real = normalizeIp(c.req.header('x-real-ip') ?? '')
    if (real && isIP(real)) return real
  }
  return peer ? normalizeIp(peer) : 'unknown'
}
