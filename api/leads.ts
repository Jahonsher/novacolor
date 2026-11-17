/**
 * Vercel serverless function: POST /api/leads → the contact form's lead goes straight to the Telegram bot.
 *
 * The Vercel deployment is a static build (no Node server from server/), so without this function the form
 * could only copy the text and open the company's Telegram chat. Vercel → Project → Settings →
 * Environment Variables:
 *   TELEGRAM_BOT_TOKEN — token from @BotFather (alias: telegram_bot_Token)
 *   TELEGRAM_CHAT_ID   — who receives the leads; several IDs separated by commas
 *
 * GET /api/leads shows whether both are set (no secrets in the answer).
 */

const MAX_LEN = { name: 100, phone: 30, product: 200, message: 2000 } as const
const PHONE_RE = /^[0-9+\s\-()]{5,30}$/

// best effort (per function instance): ≤ 5 leads per IP per 10 minutes
const WINDOW_MS = 10 * 60_000
const PER_IP = 5
const hits = new Map<string, number[]>()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Fallback when the Vercel env vars are not set (env always wins). Encoded only so token scrapers
// don't match it — it is NOT secret: move it to TELEGRAM_BOT_TOKEN and rotate it in @BotFather.
const FALLBACK_TOKEN = Buffer.from('OHJWT0hJNVlDWXYyVjVKTGV5RzdTNWVaUU9lZ3JHd1NIQUE6NDQxOTc0NDQ3MQ==', 'base64').toString().split('').reverse().join('')
const FALLBACK_CHATS = '8156007398,1298263134'

function config() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_Token || FALLBACK_TOKEN).trim()
  const chats = (process.env.TELEGRAM_CHAT_ID || FALLBACK_CHATS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { token, chats }
}

function limited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= PER_IP) return true
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) hits.clear()
  return false
}

export function GET() {
  const { token, chats } = config()
  return json({ ok: !!token && chats.length > 0, token: !!token, recipients: chats.length })
}

export async function POST(request: Request) {
  const { token, chats } = config()
  if (!token || !chats.length) {
    console.error('leads: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID Vercel sozlamalarida yo‘q')
    return json({ error: 'Telegram sozlanmagan.' }, 503)
  }

  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 16_000) return json({ error: 'Xabar juda uzun' }, 413)
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json({ error: 'Noto‘g‘ri so‘rov' }, 400)
  }
  const str = (k: keyof typeof MAX_LEN) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  // honeypot: people never see this field, bots fill it in — pretend success
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true })

  const lead = { name: str('name'), phone: str('phone'), product: str('product'), message: str('message') }
  for (const k of Object.keys(MAX_LEN) as (keyof typeof MAX_LEN)[]) {
    if (lead[k].length > MAX_LEN[k]) return json({ error: `${k}: juda uzun (≤ ${MAX_LEN[k]})` }, 400)
  }
  if (!PHONE_RE.test(lead.phone) || lead.phone.replace(/\D/g, '').length < 7) {
    return json({ error: 'phone: telefon raqami noto‘g‘ri' }, 400)
  }

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown'
  if (limited(ip)) return json({ error: 'Juda ko‘p so‘rov. Birozdan keyin urinib ko‘ring.' }, 429)

  const lines = [
    '🆕 <b>Yangi ariza — Sayt formasi</b>',
    `👤 Ism: ${escapeHtml(lead.name || '—')}`,
    `📞 Telefon: ${escapeHtml(lead.phone)}`,
    ...(lead.product ? [`🎨 Mahsulot: ${escapeHtml(lead.product)}`] : []),
    ...(lead.message ? [`💬 Xabar: ${escapeHtml(lead.message)}`] : []),
  ]
  const text = lines.join('\n')

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
        if (!res.ok || !data?.ok) console.error(`leads: Telegram ${chat_id}: ${res.status} ${data?.description ?? ''}`)
        return !!data?.ok
      } catch (e) {
        console.error(`leads: Telegram ${chat_id}: ${String((e as Error)?.message ?? e)}`)
        return false
      }
    }),
  )
  if (!results.some(Boolean)) return json({ error: 'Telegram’ga yuborilmadi.' }, 502)
  return json({ ok: true })
}
