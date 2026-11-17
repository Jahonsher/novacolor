/**
 * Vercel serverless function: POST /api/ai/chat — the site's AI consultant without the Node server.
 *
 * Model: Claude Haiku 5.5 through OpenCode (Go plan). Vercel has no storage, so the browser sends the
 * recent history with every message. A phone number in a message → lead to the Telegram group.
 *
 * Temporary setup (demo): the key is embedded and works only until AI_UNTIL, with request caps.
 * Env vars win: OPENCODE_API_KEY, AI_MODEL, AI_UNTIL (ISO date), AI_MAX_REQUESTS.
 */
import { PRODUCTS, SYSTEM_PROMPT } from '../_ai-prompt.js'
import { clientIp, detectName, detectPhone, escapeHtml, json, sendTelegram } from '../_shared.js'

type Lang = 'uz' | 'ru'
type Turn = { role: 'user' | 'assistant'; content: string }

const FALLBACK_KEY = Buffer.from('d05EckM0RG1BMjQ1QXR2ejNVc3JHcWtlck1KRk1NTGhfZWRlOGU5NmE0OTFhX2tzX2Nv', 'base64').toString().split('').reverse().join('')
const API_KEY = (process.env.OPENCODE_API_KEY || FALLBACK_KEY).trim()
const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5'
const ENDPOINT = process.env.AI_ENDPOINT || 'https://opencode.ai/inference/go/anthropic/v1/messages'
/** After this moment the chat answers with the "call us" note and never calls the model. */
const UNTIL = Date.parse(process.env.AI_UNTIL || '2026-11-20T23:59:59+05:00')
/** Cap on model calls (per function instance — Vercel usually keeps one warm for a small site). */
const MAX_REQUESTS = Number(process.env.AI_MAX_REQUESTS) || 1000
const PER_IP_PER_DAY = 40
const HISTORY = 20

let used = 0
const ipHits = new Map<string, number[]>()

const MSG = {
  limit: {
    uz: "Bugungi xabarlar limiti tugadi. Iltimos, telefon raqamingizni qoldiring yoki bizga qo'ng'iroq qiling: +998 (97) 422 22 77.",
    ru: 'Дневной лимит сообщений исчерпан. Оставьте номер телефона или позвоните нам: +998 (97) 422 22 77.',
  },
  thanks: {
    uz: "Rahmat! Arizangiz qabul qilindi, menejerimiz tez orada siz bilan bog'lanadi.",
    ru: 'Спасибо! Ваша заявка принята, наш менеджер скоро с вами свяжется.',
  },
  off: {
    uz: "AI yordamchi hozircha ishlamayapti. Telefon raqamingizni qoldiring yoki qo'ng'iroq qiling: +998 (97) 422 22 77.",
    ru: 'AI-ассистент сейчас недоступен. Оставьте номер телефона или позвоните: +998 (97) 422 22 77.',
  },
} satisfies Record<string, Record<Lang, string>>

export const aiAvailable = () => !!API_KEY && Date.now() < UNTIL && used < MAX_REQUESTS

function ipLimited(ip: string): boolean {
  const now = Date.now()
  const list = (ipHits.get(ip) ?? []).filter((t) => now - t < 86_400_000)
  if (list.length >= PER_IP_PER_DAY) return true
  list.push(now)
  ipHits.set(ip, list)
  if (ipHits.size > 5000) ipHits.clear()
  return false
}

function parseHistory(v: unknown): Turn[] {
  if (!Array.isArray(v)) return []
  const turns = v
    .filter((m): m is Turn => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && !!m.content.trim())
    .slice(-HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  while (turns.length && turns[0]!.role !== 'user') turns.shift()
  return turns
}

function guessProduct(page: string, texts: string[]): string | undefined {
  const slug = /\/products\/([a-z0-9-]+)/.exec(page)?.[1]
  const onPage = slug && PRODUCTS.find((p) => p.slug === slug)
  if (onPage) return onPage.name
  for (const t of [...texts].reverse()) {
    const hit = PRODUCTS.find((p) => p.name.length >= 3 && t.toLowerCase().includes(p.name.toLowerCase()))
    if (hit) return hit.name
  }
  return undefined
}

async function callModel(system: string, context: string, messages: Turn[], session: string): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'x-opencode-session': session,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }, ...(context ? [{ type: 'text', text: context }] : [])],
      messages,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  const data = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null
  if (!res.ok) throw new Error(`AI ${res.status}: ${data?.error?.message ?? ''}`)
  const text = (data?.content ?? [])
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('')
    .trim()
  if (!text) throw new Error('AI: empty reply')
  return text
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 64_000) return json({ error: 'Xabar juda uzun' }, 413)
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json({ error: 'Noto‘g‘ri so‘rov' }, 400)
  }
  const lang: Lang = body.lang === 'ru' ? 'ru' : 'uz'
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : ''
  if (!message) return json({ error: 'Xabar bo‘sh' }, 400)
  const session = typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(body.sessionId) ? body.sessionId : 'anon'
  const page = typeof body.page === 'string' && body.page.startsWith('/') ? body.page.slice(0, 200) : ''

  if (ipLimited(clientIp(request))) return json({ error: MSG.limit[lang], limit: true }, 429)

  const history = parseHistory(body.history)
  // the browser may already include the current message as the last turn
  const last = history.at(-1)
  if (!(last?.role === 'user' && last.content.trim() === message)) history.push({ role: 'user', content: message })
  while (history.length > 1 && history.at(-2)?.role === 'user') history.splice(-2, 1) // keep turns alternating

  // lead: the first phone number in this conversation → Telegram group
  const userTexts = history.filter((m) => m.role === 'user').map((m) => m.content)
  const alreadyLeft = userTexts.slice(0, -1).some((t) => detectPhone(t))
  const phone = alreadyLeft ? null : detectPhone(message)
  let lead = false
  if (phone) {
    const name = userTexts.map(detectName).filter(Boolean).at(-1) ?? ''
    const product = guessProduct(page, userTexts)
    const lines = [
      '🆕 <b>Yangi ariza — AI yordamchi</b>',
      `👤 Ism: ${escapeHtml(name || '—')}`,
      `📞 Telefon: ${escapeHtml(phone)}`,
      ...(product ? [`🎨 Mahsulot: ${escapeHtml(product)}`] : []),
      `💬 Suhbat:\n${escapeHtml(userTexts.slice(-6).join('\n').slice(0, 1500))}`,
    ]
    lead = await sendTelegram(lines.join('\n'))
  }

  if (!aiAvailable()) return json({ reply: lead ? MSG.thanks[lang] : MSG.off[lang], ...(lead ? { lead } : {}) })
  used++

  const context = [
    page && `The visitor is on page: ${page}`,
    (lead || alreadyLeft) && 'The visitor has already left a phone number; a request for the manager has been created.',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const reply = await callModel(SYSTEM_PROMPT[lang], context, history, session)
    return json({ reply, ...(lead ? { lead } : {}) })
  } catch (e) {
    console.error(String((e as Error)?.message ?? e))
    if (lead) return json({ reply: MSG.thanks[lang], lead })
    return json({ error: MSG.off[lang] }, 503)
  }
}
