import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { leadInput } from '../schemas.js'
import { log } from '../log.js'
import { clientIp, limitKey } from '../rate-limit.js'
import { jsonBody, maxBody, SMALL_BODY } from './util.js'

export function publicRoutes(ctx: AppContext) {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, ai: !!ctx.ai, telegram: ctx.telegram.configured }))

  app.get('/content', (c) => {
    c.header('Cache-Control', 'no-cache')
    return c.json(ctx.content.get())
  })

  app.post(
    '/leads',
    // counted before the body is read
    async (c, next) => {
      if (!ctx.limits.leads.hit(limitKey(clientIp(c, ctx.config)))) {
        throw new HttpError(429, "Juda ko'p so'rov. Iltimos, birozdan keyin qayta urinib ko'ring.")
      }
      await next()
    },
    maxBody(SMALL_BODY),
    async (c) => {
      const body = await jsonBody(c, leadInput)
      // Honeypot: bots fill the hidden "website" field. Pretend success, store nothing.
      if (body.website?.trim()) return c.json({ ok: true }, 201)
      const r = await ctx.leads.upsert(
        {
          source: 'contact',
          name: body.name,
          phone: body.phone,
          ...(body.product ? { product: body.product } : {}),
          ...(body.message ? { message: body.message } : {}),
        },
        () => ctx.limits.leadsGlobal.hit('global'),
      )
      if (!r.lead) {
        log.warn(`Ariza qabul qilinmadi: ${r.kind === 'full' ? "ro'yxat to'la (bajarilgan arizalarni o'chiring)" : 'soatlik umumiy limit'}`)
        const phone = ctx.content.get().contacts.phone
        throw new HttpError(503, `Hozir arizani qabul qila olmadik. Iltimos, qo'ng'iroq qiling: ${phone}`)
      }
      // merged = the same phone a few minutes ago: the lead was updated, no second notification
      if (r.kind === 'created') {
        const telegram = await ctx.telegram.notifyLead(r.lead)
        if (telegram !== r.lead.telegram) await ctx.leads.patch(r.lead.id, { telegram })
      }
      return c.json({ ok: true }, 201)
    },
  )

  return app
}
