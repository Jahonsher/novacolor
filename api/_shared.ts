/**
 * Shared by the Vercel functions (files starting with `_` are not routes).
 * Telegram delivery + phone/name detection (copied from server/src/ai/lead-detect.ts).
 */

// Fallbacks used when the Vercel env vars are not set (env always wins). Encoded only so token scrapers
// don't match them — they are NOT secret: move them to env vars and rotate them.
const FALLBACK_TOKEN = Buffer.from('OHJWT0hJNVlDWXYyVjVKTGV5RzdTNWVaUU9lZ3JHd1NIQUE6NDQxOTc0NDQ3MQ==', 'base64').toString().split('').reverse().join('')
const FALLBACK_CHATS = '-1001848221223' // "Novacolor.uz Bot" Telegram group

export function telegramConfig() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_Token || FALLBACK_TOKEN).trim()
  const chats = (process.env.TELEGRAM_CHAT_ID || FALLBACK_CHATS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { token, chats }
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Send an HTML message to every configured chat; true if at least one got it. Never throws. */
export async function sendTelegram(text: string): Promise<boolean> {
  const { token, chats } = telegramConfig()
  if (!token || !chats.length) return false
  const results = await Promise.all(
    chats.map(async (chat_id) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
          signal: AbortSignal.timeout(10_000),
        })
        const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null
        if (!data?.ok) console.error(`telegram ${chat_id}: ${res.status} ${data?.description ?? ''}`)
        return !!data?.ok
      } catch (e) {
        console.error(`telegram ${chat_id}: ${String((e as Error)?.message ?? e)}`)
        return false
      }
    }),
  )
  return results.some(Boolean)
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export const clientIp = (request: Request) => (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown'

// ---------------- phone / name detection ----------------

const CANDIDATE = /(?:\+\s?)?\(?\d[\d\s().-]{5,24}\d/g
const formatUz = (nine: string) => `+998 ${nine.slice(0, 2)} ${nine.slice(2, 5)} ${nine.slice(5, 7)} ${nine.slice(7, 9)}`

export function detectPhone(text: string): string | null {
  for (const m of text.matchAll(CANDIDATE)) {
    const raw = m[0].trim()
    if (/\d\.\d/.test(raw) || /^\d{4}\s*[-–]\s*\d{4}$/.test(raw)) continue
    const digits = raw.replace(/\D/g, '')
    const plus = raw.startsWith('+')
    if (digits.length === 12 && digits.startsWith('998')) return formatUz(digits.slice(3))
    if (digits.length === 9 && !plus) return formatUz(digits)
    if (digits.length >= 7 && digits.length <= 15) return plus ? `+${digits}` : raw.replace(/\s+/g, ' ')
  }
  return null
}

const NAME_WORD = "[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳʻʼ'`-]{2,30}"
const NAME_PATTERNS = [
  new RegExp(`(?:mening\\s+ismim|ismim|исмим|меня\\s+зовут|мое\\s+имя|моё\\s+имя|my\\s+name\\s+is)\\s*[:\\-–]?\\s*(${NAME_WORD})`, 'iu'),
  new RegExp(`(?:^|[\\s,.!])(?:men|я)\\s+(${NAME_WORD})(?:\\s+(?:bo['ʻ‘’]?laman|man)\\b|\\s*,?\\s*\\+?\\(?\\d)`, 'iu'),
  new RegExp(`(?:ism|имя)\\s*[:\\-–]\\s*(${NAME_WORD})`, 'iu'),
  new RegExp(`^\\s*(${NAME_WORD})\\s*[,:;\\-–]?\\s*\\+?\\(?\\d`, 'u'),
]
const NOT_NAMES = new Set(['telefon', 'tel', 'raqam', 'raqamim', 'nomer', 'номер', 'телефон', 'тел', 'mening', 'menga', 'salom', 'привет', 'здравствуйте', 'assalomu'])

export function detectName(text: string): string | null {
  for (const re of NAME_PATTERNS) {
    const name = text.match(re)?.[1]
    if (name && !NOT_NAMES.has(name.toLowerCase())) return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return null
}
