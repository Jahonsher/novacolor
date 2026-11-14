import { Hono } from 'hono'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { errMsg, log } from '../log.js'
import { secretEquals, type TgUpdate } from '../telegram.js'
import { maxBody } from './util.js'

/** Telegram updates are small; a long message with entities stays well below this. */
const UPDATE_BODY = 64 * 1024

/**
 * Webhook receiver: POST /api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>, header
 * X-Telegram-Bot-Api-Secret-Token = the same secret. Not registered at all without the secret (→ 404).
 * The server never calls setWebhook itself (see DEPLOY.md for the one manual command).
 */
export function telegramRoutes(ctx: AppContext) {
  const app = new Hono()
  const secret = ctx.config.telegram.webhookSecret
  if (!secret || !ctx.telegram.configured) return app

  app.post(
    '/webhook/:secret',
    async (c, next) => {
      if (!secretEquals(c.req.param('secret'), secret)) throw new HttpError(404, 'Topilmadi')
      if (!secretEquals(c.req.header('x-telegram-bot-api-secret-token'), secret)) {
        log.warn('Telegram webhook: secret token sarlavhasi yo‘q yoki noto‘g‘ri')
        throw new HttpError(401, 'Ruxsat yo‘q')
      }
      await next()
    },
    maxBody(UPDATE_BODY),
    async (c) => {
      let update: TgUpdate
      try {
        update = (await c.req.json()) as TgUpdate
      } catch {
        throw new HttpError(400, "So'rov tanasi JSON formatida bo'lishi kerak")
      }
      if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') {
        throw new HttpError(400, 'update_id yo‘q')
      }
      try {
        await ctx.telegram.handleWebhookUpdate(update)
      } catch (e) {
        // 200 anyway: Telegram would otherwise retry the same update again and again
        log.warn(`Telegram webhook yangilanishi ${update.update_id}: ${errMsg(e)}`)
      }
      return c.json({ ok: true })
    },
  )
  return app
}
