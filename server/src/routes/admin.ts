import { existsSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { clearSessionCookie, isAuthed, passwordMatches, setSessionCookie } from '../auth.js'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { log } from '../log.js'
import { clientIp, fromTrustedProxy, limitKey } from '../rate-limit.js'
import {
  aboutSchema,
  categoryInput,
  contactsInput,
  docGroup,
  docMetaInput,
  leadPatch,
  newsInput,
  productInput,
  inferChatType,
  slugSchema,
  subscriberChatId,
  subscriberInput,
  subscriberPatch,
  subscribersPut,
  telegramSettingsInput,
  videoInput,
  zodMessage,
  type Content,
  type Video,
} from '../schemas.js'
import { ContentError } from '../store/content.js'
import { MAX_SUBSCRIBERS, SubscriberError, type Subscriber } from '../store/subscribers.js'
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES, readUpload, saveImage, savePdf, UploadError } from '../uploads.js'
import { MAX_VIDEO_BYTES, receiveFile, sniffVideo, transcodedPath, uploadId } from '../video.js'
import { ADMIN_BODY, jsonBody, maxBody, notFound, SMALL_BODY } from './util.js'

const MB = 1024 * 1024
const nextId = (items: { id: number }[]) => items.reduce((m, x) => Math.max(m, x.id), 0) + 1

const tooLarge = (max: number) =>
  bodyLimit({
    maxSize: max + MB,
    onError: () => {
      throw new UploadError(`Fayl juda katta (maks. ${Math.round(max / MB)} MB)`, 413)
    },
  })

function checkCategories(content: Content, ids: number[]) {
  const known = new Set(content.categories.map((c) => c.id))
  const bad = ids.find((id) => !known.has(id))
  if (bad !== undefined) throw new ContentError(`Kategoriya topilmadi: ${bad}`)
}

function checkProducts(content: Content, slugs: string[]) {
  const known = new Set(content.products.map((p) => p.slug))
  const bad = slugs.find((s) => !known.has(s))
  if (bad !== undefined) throw new ContentError(`Mahsulot topilmadi: ${bad}`)
}

const UPLOADED_VIDEO_RE = /^uploads\/videos\/[\w.-]+\.(mp4|webm|mov)$/

/**
 * Uploaded video path as it should be stored: if a background transcode has already replaced the original
 * (`<id>-720p.mp4` exists), that one; the file must exist. Static `video/…` paths are taken as they are.
 * Synchronous on purpose: called inside `content.mutate` (under the lock, see VideoTools.transcode).
 */
function resolveVideoSrc(uploadsDir: string, src: string): string {
  if (!UPLOADED_VIDEO_RE.test(src)) return src
  const onDisk = (rel: string) => existsSync(path.join(uploadsDir, rel.replace(/^uploads\//, '')))
  const t = transcodedPath(src)
  if (t !== src && onDisk(t)) return t
  if (!onDisk(src)) throw new ContentError(`Video fayl topilmadi: ${src} — qayta yuklang`)
  return src
}

/** Build a stored video from validated input (no `undefined` keys). */
function videoItem(id: number, input: z.infer<typeof videoInput>, src: string | undefined): Video {
  return {
    id,
    title: input.title,
    ...(src ? { src } : {}),
    ...(input.poster ? { poster: input.poster } : {}),
    ...(input.instagram ? { instagram: input.instagram } : {}),
    product: input.product,
    ...(input.date ? { date: input.date } : {}),
  }
}

/** Tashkent (UTC+5) calendar day of an ISO timestamp. */
const tashkentDay = (iso: string | Date) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10)

export function adminRoutes(ctx: AppContext) {
  const app = new Hono()
  const { content } = ctx

  // CSRF, two layers on top of SameSite=Strict:
  // 1) if the browser sends Origin, it must be this site (the Host the request was sent to, or the
  //    X-Forwarded-Host set by a trusted proxy);
  // 2) state-changing requests must be JSON or multipart (a cross-site HTML form can't send JSON).
  app.use('*', async (c, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin !== undefined && !sameOrigin(c, origin)) {
        log.warn(`Admin: begona Origin rad etildi: ${origin.slice(0, 100)} (${c.req.method} ${c.req.path})`)
        throw new HttpError(403, "So'rov boshqa saytdan yuborilgan (Origin mos emas)")
      }
    }
    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      const ct = (c.req.header('content-type') ?? '').toLowerCase()
      if (!ct.startsWith('application/json') && !ct.startsWith('multipart/form-data')) {
        throw new HttpError(415, "Content-Type application/json yoki multipart/form-data bo'lishi kerak")
      }
    }
    await next()
  })

  const sameOrigin = (c: Context, origin: string) => {
    let host: string
    try {
      host = new URL(origin).host.toLowerCase()
    } catch {
      return false // includes the opaque "null" origin
    }
    if (host === new URL(c.req.url).host.toLowerCase()) return true
    const fwd = fromTrustedProxy(c, ctx.config) ? c.req.header('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase() : undefined
    return !!fwd && host === fwd
  }

  const tooManyLogins = () => new HttpError(429, "Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring.")

  // The attempt is counted synchronously, BEFORE anything is awaited (body, password check):
  // otherwise 100 concurrent requests would all pass a "blocked?" check made before the first failure
  // is recorded. Success resets the per-IP counter and takes the attempt back from the global one.
  app.post(
    '/login',
    async (c, next) => {
      const key = limitKey(clientIp(c, ctx.config))
      if (!ctx.limits.login.hit(key)) throw tooManyLogins()
      // all IPs together: bounds a distributed guessing attack (the admin may be locked out for ≤ 10 min)
      if (!ctx.limits.loginGlobal.hit('global')) {
        log.warn('Admin: umumiy noto‘g‘ri kirishlar limiti tugadi (10 daqiqa)')
        throw tooManyLogins()
      }
      await next()
    },
    maxBody(SMALL_BODY),
    async (c) => {
      const ip = clientIp(c, ctx.config)
      const { password } = await jsonBody(c, z.object({ password: z.string().max(500) }))
      if (!passwordMatches(password, ctx.config.adminPassword)) {
        log.warn(`Admin: noto'g'ri parol (ip ${ip})`)
        throw new HttpError(401, "Parol noto'g'ri")
      }
      ctx.limits.login.reset(limitKey(ip))
      ctx.limits.loginGlobal.undo('global')
      setSessionCookie(c, ctx.sessionKey())
      log.info(`Admin: kirish (ip ${ip})`)
      return c.json({ ok: true })
    },
  )

  // Everything below requires a valid session cookie.
  app.use('*', async (c, next) => {
    if (!isAuthed(c, ctx.sessionKey())) throw new HttpError(401, 'Avval tizimga kiring')
    await next()
  })

  // JSON bodies of authenticated requests (uploads have their own, bigger limits).
  app.use('*', async (c, next) => {
    // upload/video enforces its own limit while streaming the body to disk
    if (c.req.path.endsWith('/upload/image') || c.req.path.endsWith('/upload/video') || (c.req.method === 'POST' && c.req.path.endsWith('/documents'))) {
      return next()
    }
    return maxBody(ADMIN_BODY)(c, next)
  })

  // Logout invalidates every session (all devices): the session epoch in settings.json is bumped.
  app.post('/logout', async (c) => {
    await ctx.settings.bumpSessionEpoch()
    clearSessionCookie(c)
    log.info('Admin: chiqish (barcha qurilmalarda)')
    return c.json({ ok: true })
  })

  app.get('/me', (c) => c.json({ ok: true }))

  app.get('/content', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(content.get())
  })

  // ---- Products ----
  app.post('/products', async (c) => {
    const input = await jsonBody(c, productInput)
    const product = await content.mutate((d) => {
      if (d.products.some((p) => p.slug === input.slug)) throw new ContentError(`Slug band: ${input.slug}`, 409)
      checkCategories(d, input.categories)
      const p = { id: nextId(d.products), ...input }
      d.products.push(p)
      return p
    })
    return c.json(product, 201)
  })

  app.put('/products/:slug', async (c) => {
    const slug = c.req.param('slug')
    const input = await jsonBody(c, productInput)
    const product = await content.mutate((d) => {
      const i = d.products.findIndex((p) => p.slug === slug)
      if (i < 0) throw new ContentError('Mahsulot topilmadi', 404)
      if (input.slug !== slug && d.products.some((p) => p.slug === input.slug)) {
        throw new ContentError(`Slug band: ${input.slug}`, 409)
      }
      checkCategories(d, input.categories)
      const p = { id: d.products[i]!.id, ...input }
      d.products[i] = p
      if (input.slug !== slug) {
        for (const n of d.news) if (n.product === slug) n.product = input.slug
        for (const v of d.videos) if (v.product === slug) v.product = input.slug
        for (const doc of d.documents) doc.products = doc.products.map((s) => (s === slug ? input.slug : s))
      }
      return p
    })
    return c.json(product)
  })

  app.delete('/products/:slug', async (c) => {
    const slug = c.req.param('slug')
    await content.mutate((d) => {
      const before = d.products.length
      d.products = d.products.filter((p) => p.slug !== slug)
      if (d.products.length === before) throw new ContentError('Mahsulot topilmadi', 404)
      for (const n of d.news) if (n.product === slug) n.product = null
      for (const v of d.videos) if (v.product === slug) v.product = null
      for (const doc of d.documents) doc.products = doc.products.filter((s) => s !== slug)
    })
    return c.json({ ok: true })
  })

  app.put('/products-order', async (c) => {
    const { slugs } = await jsonBody(c, z.object({ slugs: z.array(slugSchema).max(5000) }))
    await content.mutate((d) => {
      const bySlug = new Map(d.products.map((p) => [p.slug, p]))
      const unknown = slugs.find((s) => !bySlug.has(s))
      if (unknown) throw new ContentError(`Mahsulot topilmadi: ${unknown}`)
      const seen = new Set<string>()
      const ordered = slugs.filter((s) => !seen.has(s) && seen.add(s)).map((s) => bySlug.get(s)!)
      d.products = [...ordered, ...d.products.filter((p) => !seen.has(p.slug))]
    })
    return c.json({ ok: true })
  })

  // ---- Categories ----
  app.post('/categories', async (c) => {
    const input = await jsonBody(c, categoryInput)
    const cat = await content.mutate((d) => {
      const x = { id: nextId(d.categories), ...input, count: 0 }
      d.categories.push(x)
      return x.id
    })
    return c.json(content.get().categories.find((x) => x.id === cat), 201)
  })

  app.put('/categories/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const input = await jsonBody(c, categoryInput)
    await content.mutate((d) => {
      const x = d.categories.find((k) => k.id === id)
      if (!x) throw new ContentError('Kategoriya topilmadi', 404)
      Object.assign(x, input)
    })
    return c.json(content.get().categories.find((x) => x.id === id))
  })

  app.delete('/categories/:id', async (c) => {
    const id = Number(c.req.param('id'))
    await content.mutate((d) => {
      if (!d.categories.some((k) => k.id === id)) throw new ContentError('Kategoriya topilmadi', 404)
      const used = d.products.filter((p) => p.categories.includes(id)).length
      if (used) throw new ContentError(`Kategoriya ishlatilmoqda (${used} ta mahsulot) — avval mahsulotlardan olib tashlang`, 409)
      d.categories = d.categories.filter((k) => k.id !== id)
    })
    return c.json({ ok: true })
  })

  // ---- News ----
  app.post('/news', async (c) => {
    const input = await jsonBody(c, newsInput)
    const item = await content.mutate((d) => {
      if (input.product) checkProducts(d, [input.product])
      const n = { id: nextId(d.news), ...input }
      d.news.push(n)
      return n
    })
    return c.json(item, 201)
  })

  app.put('/news/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const input = await jsonBody(c, newsInput)
    const item = await content.mutate((d) => {
      const i = d.news.findIndex((n) => n.id === id)
      if (i < 0) throw new ContentError('Yangilik topilmadi', 404)
      if (input.product) checkProducts(d, [input.product])
      d.news[i] = { id, ...input }
      return d.news[i]!
    })
    return c.json(item)
  })

  app.delete('/news/:id', async (c) => {
    const id = Number(c.req.param('id'))
    await content.mutate((d) => {
      const before = d.news.length
      d.news = d.news.filter((n) => n.id !== id)
      if (d.news.length === before) throw new ContentError('Yangilik topilmadi', 404)
    })
    return c.json({ ok: true })
  })

  // ---- Videos ----
  /** Uploaded files (video, generated poster) no video points at any more → deleted. */
  const cleanupVideoFiles = async (paths: (string | undefined)[]) => {
    const used = new Set(content.get().videos.flatMap((v) => [v.src, v.poster]))
    for (const p of new Set(paths)) {
      if (!p || used.has(p) || !p.startsWith('uploads/videos/') || p.includes('..')) continue
      await rm(path.join(ctx.uploadsDir, 'videos', path.basename(p)), { force: true })
    }
  }

  app.post('/videos', async (c) => {
    const input = await jsonBody(c, videoInput)
    const item = await content.mutate((d) => {
      if (input.product) checkProducts(d, [input.product])
      const v = videoItem(nextId(d.videos), input, input.src && resolveVideoSrc(ctx.uploadsDir, input.src))
      d.videos.push(v)
      return v
    })
    return c.json(item, 201)
  })

  app.put('/videos/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const input = await jsonBody(c, videoInput)
    const { item, old } = await content.mutate((d) => {
      const i = d.videos.findIndex((v) => v.id === id)
      if (i < 0) throw new ContentError('Video topilmadi', 404)
      if (input.product) checkProducts(d, [input.product])
      const old = d.videos[i]!
      d.videos[i] = videoItem(id, input, input.src && resolveVideoSrc(ctx.uploadsDir, input.src))
      return { item: d.videos[i]!, old }
    })
    await cleanupVideoFiles([old.src, old.poster])
    return c.json(item)
  })

  app.delete('/videos/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const removed = await content.mutate((d) => {
      const v = d.videos.find((x) => x.id === id)
      if (!v) throw new ContentError('Video topilmadi', 404)
      d.videos = d.videos.filter((x) => x !== v)
      return v
    })
    await cleanupVideoFiles([removed.src, removed.poster])
    return c.json({ ok: true })
  })

  app.put('/videos-order', async (c) => {
    const { ids } = await jsonBody(c, z.object({ ids: z.array(z.int().positive()).max(5000) }))
    await content.mutate((d) => {
      const byId = new Map(d.videos.map((v) => [v.id, v]))
      const unknown = ids.find((i) => !byId.has(i))
      if (unknown !== undefined) throw new ContentError(`Video topilmadi: ${unknown}`)
      const seen = new Set<number>()
      const ordered = ids.filter((i) => !seen.has(i) && seen.add(i)).map((i) => byId.get(i)!)
      d.videos = [...ordered, ...d.videos.filter((v) => !seen.has(v.id))]
    })
    return c.json({ ok: true })
  })

  // ---- Contacts / about ----
  app.put('/contacts', async (c) => {
    const input = await jsonBody(c, contactsInput)
    const phoneHref = input.phoneHref || `tel:${input.phone.replace(/[^\d+]/g, '')}`
    const contacts = await content.mutate((d) => {
      d.contacts = { ...input, phoneHref }
      return d.contacts
    })
    return c.json(contacts)
  })

  app.put('/about', async (c) => {
    const input = await jsonBody(c, aboutSchema)
    const about = await content.mutate((d) => {
      d.about = input
      return d.about
    })
    return c.json(about)
  })

  // ---- Uploads ----
  app.post('/upload/image', tooLarge(MAX_IMAGE_BYTES), async (c) => {
    const form = await c.req.parseBody()
    const { bytes } = await readUpload(form.file, MAX_IMAGE_BYTES, 'Rasm')
    const saved = await saveImage(ctx.uploadsDir, bytes)
    log.info(`Rasm yuklandi: ${saved.path} (${saved.width}x${saved.height})`)
    return c.json(saved, 201)
  })

  // Video: streamed to disk (never buffered), type by magic bytes, ≤ 200 MB. With ffmpeg: a poster JPEG and,
  // for big / non-MP4 files, a background H.264 720p transcode (`processing: true`).
  app.post('/upload/video', async (c) => {
    const dir = path.join(ctx.uploadsDir, 'videos')
    const up = await receiveFile(c.req.raw, {
      dir,
      maxBytes: MAX_VIDEO_BYTES,
      what: 'Video',
      sniff: sniffVideo,
      badType: 'Faqat MP4, MOV yoki WEBM video yuklash mumkin',
    })
    const id = uploadId()
    const name = `${id}.${up.kind}`
    try {
      await rename(up.tmp, path.join(dir, name))
    } catch (e) {
      await rm(up.tmp, { force: true })
      throw e
    }
    const rel = `uploads/videos/${name}`
    const poster = (await ctx.media.poster(path.join(dir, name), path.join(dir, `${id}.jpg`))) ? `uploads/videos/${id}.jpg` : null
    const processing = await ctx.media.maybeTranscode(rel, up.bytes, up.kind)
    log.info(`Video yuklandi: ${rel} (${(up.bytes / MB).toFixed(1)} MB${poster ? ', poster' : ''}${processing ? ', siqilmoqda' : ''})`)
    return c.json({ path: rel, poster, bytes: up.bytes, type: up.kind, processing }, 201)
  })

  // ---- Documents ----
  app.post('/documents', tooLarge(MAX_PDF_BYTES), async (c) => {
    const form = await c.req.parseBody()
    const meta = z
      .object({
        title_uz: z.string().trim().min(1).max(300),
        title_ru: z.string().trim().min(1).max(300),
        group: docGroup,
        products: z.array(slugSchema).max(200),
      })
      .safeParse({
        title_uz: form.title_uz,
        title_ru: form.title_ru,
        group: form.group,
        products: parseJsonArray(form.products),
      })
    if (!meta.success) throw new HttpError(400, zodMessage(meta.error))
    checkProducts(content.get(), meta.data.products)
    const { bytes, name } = await readUpload(form.file, MAX_PDF_BYTES, 'PDF')
    const taken = new Set(content.get().documents.map((d) => d.file))
    const saved = await savePdf(ctx.uploadsDir, bytes, name, taken)
    try {
      const doc = await content.mutate((d) => {
        // re-check under the lock: another upload may have taken the name meanwhile
        if (d.documents.some((k) => k.file === saved.file)) {
          throw new ContentError(`Bu nomdagi hujjat allaqachon bor: ${saved.file} — qayta urinib ko'ring`, 409)
        }
        checkProducts(d, meta.data.products)
        const x = {
          file: saved.file,
          group: meta.data.group,
          title: { uz: meta.data.title_uz, ru: meta.data.title_ru },
          products: meta.data.products,
          size: saved.size,
          path: saved.path,
        }
        d.documents.push(x)
        return x
      })
      return c.json(doc, 201)
    } catch (e) {
      await rm(path.join(ctx.uploadsDir, 'pdf', saved.file), { force: true })
      throw e
    }
  })

  app.put('/documents/:file', async (c) => {
    const file = c.req.param('file')
    const input = await jsonBody(c, docMetaInput)
    const doc = await content.mutate((d) => {
      const x = d.documents.find((k) => k.file === file)
      if (!x) throw new ContentError('Hujjat topilmadi', 404)
      if (input.products) checkProducts(d, input.products)
      if (input.title) x.title = input.title
      if (input.group) x.group = input.group
      if (input.products) x.products = input.products
      return x
    })
    return c.json(doc)
  })

  app.delete('/documents/:file', async (c) => {
    const file = c.req.param('file')
    const removed = await content.mutate((d) => {
      const x = d.documents.find((k) => k.file === file)
      if (!x) throw new ContentError('Hujjat topilmadi', 404)
      d.documents = d.documents.filter((k) => k !== x)
      return x
    })
    if (removed.path?.startsWith('uploads/pdf/')) {
      const name = path.basename(removed.path)
      await rm(path.join(ctx.uploadsDir, 'pdf', name), { force: true })
    }
    return c.json({ ok: true })
  })

  // ---- Leads ----
  app.get('/leads', (c) => c.json(ctx.leads.list()))

  app.patch('/leads/:id', async (c) => {
    const input = await jsonBody(c, leadPatch)
    const lead = await ctx.leads.patch(c.req.param('id'), input)
    if (!lead) throw notFound('Ariza')
    return c.json(lead)
  })

  app.delete('/leads/:id', async (c) => {
    if (!(await ctx.leads.remove(c.req.param('id')))) throw notFound('Ariza')
    return c.json({ ok: true })
  })

  // ---- Chats ----
  app.get('/chats', (c) =>
    c.json(
      [...ctx.chats.get()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((s) => {
          const first = s.messages.find((m) => m.role === 'user')?.content ?? ''
          return {
            id: s.id,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            lang: s.lang,
            page: s.page ?? null,
            count: s.messages.length,
            preview: first.length > 140 ? `${first.slice(0, 140)}…` : first,
            leadId: s.leadId ?? null,
          }
        }),
    ),
  )

  app.get('/chats/:id', (c) => {
    const s = ctx.chats.find(c.req.param('id'))
    if (!s) throw notFound('Suhbat')
    return c.json(s)
  })

  // ---- Settings / Telegram / stats ----
  const telegramInfo = async () => ({
    configured: ctx.telegram.configured,
    /** subscribers: every active subscriber; single: one chat (chatId) */
    mode: ctx.telegram.mode,
    modeSource: ctx.telegram.modeSource,
    chatId: ctx.telegram.chatId,
    chatIdSource: ctx.telegram.chatIdSource,
    botUsername: await ctx.telegram.getBotUsername(),
    subscribers: { active: ctx.subscribers.active().length, total: ctx.subscribers.list().length },
    updates: ctx.telegram.updates,
    webhookReceiver: ctx.telegram.webhookReceiver,
  })

  app.get('/settings', async (c) =>
    c.json({
      telegram: await telegramInfo(),
      ai: { provider: ctx.ai?.name ?? ctx.config.ai.provider, model: ctx.ai?.model ?? ctx.config.ai.model, enabled: !!ctx.ai },
    }),
  )

  // `{ chatId?, mode? }`: chat ID for single mode (auto-discovery can't work while the bot has a webhook)
  // and the mode. Env (TELEGRAM_CHAT_ID / TELEGRAM_MODE) wins.
  app.put('/settings/telegram', async (c) => {
    const { chatId, mode } = await jsonBody(c, telegramSettingsInput)
    if (chatId !== undefined && ctx.config.telegram.chatId) {
      throw new HttpError(409, "TELEGRAM_CHAT_ID server .env faylida o'rnatilgan va u ustun turadi — o'zgartirish uchun .env'ni tahrirlang")
    }
    if (mode !== undefined && ctx.config.telegram.mode) {
      throw new HttpError(409, "TELEGRAM_MODE server .env faylida o'rnatilgan va u ustun turadi — o'zgartirish uchun .env'ni tahrirlang")
    }
    if (chatId !== undefined) {
      await ctx.telegram.setChatId(chatId || null)
      log.info(`Admin: Telegram chat ID ${chatId ? "o'rnatildi" : "o'chirildi"}`)
    }
    if (mode !== undefined) {
      await ctx.telegram.setMode(mode)
      log.info(`Admin: Telegram rejimi — ${mode === 'single' ? 'bitta chat' : 'hamma obunachilar'}`)
    }
    return c.json(await telegramInfo())
  })

  // ---- Telegram subscribers (mode `subscribers`) ----
  const subscribersError = (e: unknown): never => {
    if (e instanceof SubscriberError) throw new HttpError(e.status, e.message)
    throw e
  }
  const subscribersList = () => ({
    subscribers: [...ctx.subscribers.list()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    max: MAX_SUBSCRIBERS,
    updates: ctx.telegram.updates,
  })
  const chatIdParam = (c: Context) => {
    const r = subscriberChatId.safeParse(c.req.param('chatId'))
    if (!r.success) throw new HttpError(400, zodMessage(r.error))
    return r.data
  }
  const logSub = (what: string, s: Pick<Subscriber, 'chatId'>) => log.info(`Admin: Telegram obunachi ${what} (${s.chatId})`)

  app.get('/telegram/subscribers', (c) => c.json(subscribersList()))

  app.post('/telegram/subscribers', async (c) => {
    const input = await jsonBody(c, subscriberInput)
    const s = await ctx.subscribers
      .addManual({
        chatId: input.chatId,
        name: input.name,
        type: input.type ?? inferChatType(input.chatId),
        ...(input.username ? { username: input.username } : {}),
      })
      .catch(subscribersError)
    logSub("qo'lda qo'shildi", s)
    return c.json(s, 201)
  })

  app.put('/telegram/subscribers', async (c) => {
    const { subscribers } = await jsonBody(c, subscribersPut)
    await ctx.subscribers
      .replaceAll(
        subscribers.map((x) => ({
          chatId: x.chatId,
          name: x.name,
          type: x.type ?? inferChatType(x.chatId),
          active: x.active,
          ...(x.username ? { username: x.username } : {}),
        })),
      )
      .catch(subscribersError)
    log.info(`Admin: Telegram obunachilar ro'yxati almashtirildi (${subscribers.length} ta)`)
    return c.json(subscribersList())
  })

  app.patch('/telegram/subscribers/:chatId', async (c) => {
    const chatId = chatIdParam(c)
    const input = await jsonBody(c, subscriberPatch)
    const s = await ctx.subscribers.patch(chatId, input).catch(subscribersError)
    if (input.active !== undefined) logSub(input.active ? 'yoqildi' : "o'chirildi (faol emas)", s)
    return c.json(s)
  })

  app.delete('/telegram/subscribers/:chatId', async (c) => {
    const chatId = chatIdParam(c)
    await ctx.subscribers.remove(chatId).catch(subscribersError)
    logSub("ro'yxatdan o'chirildi", { chatId })
    return c.json({ ok: true })
  })

  // Recent chats that wrote to the bot — the admin picks one explicitly (nothing is saved here).
  app.get('/telegram/chats', async (c) => {
    if (!ctx.telegram.configured) return c.json({ ok: false, error: 'Telegram sozlanmagan: TELEGRAM_BOT_TOKEN kiriting' })
    try {
      return c.json({ ok: true, chats: await ctx.telegram.recentChats() })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.warn(`Telegram chatlarini olish: ${error}`)
      return c.json({ ok: false, error })
    }
  })

  // Test message to every current recipient: `{ ok, total, sent, failed, results, error? }` (ok = ≥ 1 delivered).
  app.post('/telegram/test', async (c) => {
    if (!ctx.telegram.configured) return c.json({ ok: false, error: 'Telegram sozlanmagan: TELEGRAM_BOT_TOKEN kiriting' })
    try {
      const r = await ctx.telegram.broadcast('✅ NovaColor: sinov xabari. Arizalar shu chatga keladi.')
      const error = r.sent ? undefined : r.results[0]?.error
      if (r.failed) log.warn(`Telegram sinovi: ${r.sent}/${r.total} ta yetdi`)
      return c.json({ ok: r.sent > 0, total: r.total, sent: r.sent, failed: r.failed, results: r.results, ...(error ? { error } : {}) })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.warn(`Telegram sinovi: ${error}`)
      return c.json({ ok: false, total: 0, sent: 0, failed: 0, results: [], error })
    }
  })

  app.get('/stats', (c) => {
    const today = tashkentDay(new Date())
    const leads = ctx.leads.get()
    const cnt = content.get()
    return c.json({
      products: cnt.products.length,
      documents: cnt.documents.length,
      videos: cnt.videos.length,
      leadsNew: leads.filter((l) => l.status === 'new').length,
      leadsTotal: leads.length,
      chatsToday: ctx.chats.get().filter((s) => tashkentDay(s.updatedAt) === today).length,
    })
  })

  return app
}

function parseJsonArray(v: unknown): unknown {
  if (v === undefined || v === '') return []
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

