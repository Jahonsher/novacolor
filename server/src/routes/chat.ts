import { Hono } from 'hono'
import { detectName, detectPhone } from '../ai/lead-detect.js'
import { AiError, type ChatTurn, type Lang } from '../ai/types.js'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { errMsg, log } from '../log.js'
import { clientIp, limitKey } from '../rate-limit.js'
import { chatInput, type ChatSession, type Content } from '../schemas.js'
import { jsonBody, maxBody, SMALL_BODY } from './util.js'

export const HISTORY_FOR_MODEL = 20
/** Visitor messages per chat session; after that the visitor is asked to call or leave a phone number. */
export const MAX_USER_MESSAGES_PER_SESSION = 100

const MSG = {
  limit: {
    uz: "Bugungi xabarlar limiti tugadi. Iltimos, ertaga yozing yoki bizga qo'ng'iroq qiling.",
    ru: 'Дневной лимит сообщений исчерпан. Пожалуйста, напишите завтра или позвоните нам.',
  },
  thanks: {
    uz: "Rahmat! Arizangiz qabul qilindi, menejerimiz tez orada siz bilan bog'lanadi.",
    ru: 'Спасибо! Ваша заявка принята, наш менеджер скоро с вами свяжется.',
  },
  sessionCap: {
    uz: "Suhbat juda uzun bo'lib ketdi. Batafsil maslahat uchun menejerimizga qo'ng'iroq qiling yoki telefon raqamingizni qoldiring — o'zimiz bog'lanamiz.",
    ru: 'Разговор получился очень длинным. Для подробной консультации позвоните нашему менеджеру или оставьте номер телефона — мы сами свяжемся с вами.',
  },
  busy: {
    uz: "AI yordamchi bugun juda band. Iltimos, telefon raqamingizni qoldiring — menejerimiz o'zi bog'lanadi, yoki bizga qo'ng'iroq qiling.",
    ru: 'AI-ассистент сегодня перегружен. Пожалуйста, оставьте номер телефона — менеджер сам свяжется с вами, или позвоните нам.',
  },
  inProgress: {
    uz: 'Oldingi xabarga javob tayyorlanmoqda, biroz kuting.',
    ru: 'Ответ на предыдущее сообщение ещё готовится, подождите немного.',
  },
  off: {
    uz: "AI yordamchi hozircha ishlamayapti. Iltimos, aloqa formasidan foydalaning yoki qo'ng'iroq qiling.",
    ru: 'AI-ассистент сейчас недоступен. Пожалуйста, воспользуйтесь формой связи или позвоните нам.',
  },
} satisfies Record<string, Record<Lang, string>>

/** Last `n` messages, trimmed so the first one is from the user (API requirement). */
export function historyWindow(messages: ChatSession['messages'], n = HISTORY_FOR_MODEL): ChatTurn[] {
  const tail = messages.slice(-n)
  while (tail.length && tail[0]!.role !== 'user') tail.shift()
  return tail.map((m) => ({ role: m.role, content: m.content }))
}

/** Product the visitor is probably asking about: current product page, else the latest one mentioned. */
function guessProduct(content: Content, page: string | undefined, userTexts: string[]): string | undefined {
  const slug = page?.match(/\/products\/([a-z0-9-]+)/)?.[1]
  const onPage = slug && content.products.find((p) => p.slug === slug)
  if (onPage) return onPage.name
  for (const t of [...userTexts].reverse()) {
    const lower = t.toLowerCase()
    const hit = content.products.find((p) => p.name.length >= 3 && lower.includes(p.name.toLowerCase()))
    if (hit) return hit.name
  }
  return undefined
}

export function chatRoutes(ctx: AppContext) {
  const app = new Hono()
  /** Sessions with a message being answered (one at a time: no lost messages, no double leads). */
  const inFlight = new Set<string>()

  app.post(
    '/chat',
    // over the daily limit → refused before the body is even read
    async (c, next) => {
      if (ctx.limits.ai.blocked(limitKey(clientIp(c, ctx.config)))) throw new HttpError(429, MSG.limit.uz, { limit: true })
      await next()
    },
    maxBody(SMALL_BODY),
    async (c) => {
      const body = await jsonBody(c, chatInput)
      const lang = body.lang
      if (!ctx.ai) throw new HttpError(503, MSG.off[lang])
      if (!ctx.limits.ai.hit(limitKey(clientIp(c, ctx.config)))) throw new HttpError(429, MSG.limit[lang], { limit: true })
      if (inFlight.has(body.sessionId)) throw new HttpError(409, MSG.inProgress[lang])
      inFlight.add(body.sessionId)
      try {
        return c.json(await handleMessage(body, ctx.ai))
      } finally {
        inFlight.delete(body.sessionId)
      }
    },
  )

  async function handleMessage(body: ReturnType<typeof chatInput.parse>, ai: NonNullable<AppContext['ai']>) {
    const lang = body.lang
    const now = new Date().toISOString()
    const existing = ctx.chats.find(body.sessionId)
    const session: ChatSession = existing
      ? structuredClone(existing)
      : { id: body.sessionId, createdAt: now, updatedAt: now, lang, ...(body.page ? { page: body.page } : {}), messages: [] }
    session.lang = lang
    session.updatedAt = now
    // Retry after a failed call re-sends the same text: reuse the unanswered user message instead of duplicating it.
    const last = session.messages.at(-1)
    if (last?.role === 'user' && last.content === body.message) last.at = now
    else session.messages.push({ role: 'user', content: body.message, at: now })

    const capped = session.messages.filter((m) => m.role === 'user').length > MAX_USER_MESSAGES_PER_SESSION

    // Lead detection — independent of the AI call, so a phone number is never lost.
    let leadCreated = false
    const phone = !session.leadId ? detectPhone(body.message) : null
    if (phone) {
      const userTexts = session.messages.filter((m) => m.role === 'user').map((m) => m.content)
      let name = ''
      for (const t of [...userTexts].reverse()) {
        const n = detectName(t)
        if (n) {
          name = n
          break
        }
      }
      const content = ctx.content.get()
      const product = guessProduct(content, body.page ?? session.page, userTexts)
      const r = await ctx.leads.upsert(
        { source: 'ai', name, phone, ...(product ? { product } : {}), message: userTexts.slice(-6).join('\n'), chatId: session.id },
        () => ctx.limits.leadsGlobal.hit('global'),
      )
      if (r.lead) {
        session.leadId = r.lead.id
        leadCreated = true
        // merged = the same phone was left a few minutes ago: already notified
        if (r.kind === 'created') {
          const telegram = await ctx.telegram.notifyLead(r.lead)
          if (telegram !== r.lead.telegram) await ctx.leads.patch(r.lead.id, { telegram })
        }
      } else {
        log.warn(`AI ariza saqlanmadi (${r.kind === 'full' ? "arizalar ro'yxati to'la" : 'soatlik limit'}), suhbat ${session.id}`)
      }
    }

    const system = ctx.prompts.get(ctx.content.get(), ctx.content.version, lang)
    const contextLines: string[] = []
    const page = body.page ?? session.page
    if (page) contextLines.push(`The visitor is on page: ${page}`)
    if (session.leadId) contextLines.push('The visitor has already left a phone number; a request for the manager has been created.')

    let reply: string
    if (capped) {
      reply = leadCreated ? MSG.thanks[lang] : MSG.sessionCap[lang]
    } else if (!ctx.limits.aiGlobal.hit('global')) {
      // AI_GLOBAL_DAILY_LIMIT: a cost cap across all visitors; leads are still captured
      log.warn(`AI: umumiy kunlik limit tugadi (AI_GLOBAL_DAILY_LIMIT=${ctx.limits.aiGlobal.limit})`)
      reply = leadCreated ? MSG.thanks[lang] : MSG.busy[lang]
    } else {
      try {
        const result = await ai.chat({
          system,
          context: contextLines.join('\n') || undefined,
          messages: historyWindow(session.messages),
          lang,
        })
        reply = result.text
      } catch (e) {
        const kind = e instanceof AiError ? e.kind : 'unavailable'
        log.warn(`AI xatosi (${ai.name}/${kind}): ${errMsg(e)}`)
        if (!leadCreated) {
          await ctx.chats.save(session)
          throw new HttpError(503, MSG.off[lang])
        }
        // The phone number was captured — answer anyway so the visitor knows it worked.
        reply = MSG.thanks[lang]
      }
    }

    session.messages.push({ role: 'assistant', content: reply, at: new Date().toISOString() })
    session.updatedAt = new Date().toISOString()
    await ctx.chats.save(session)
    return leadCreated ? { reply, lead: true } : { reply }
  }

  return app
}
