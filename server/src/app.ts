import path from 'node:path'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import type { AppContext } from './context.js'
import { HttpError } from './errors.js'
import { errMsg, log } from './log.js'
import { adminRoutes } from './routes/admin.js'
import { chatRoutes } from './routes/chat.js'
import { publicRoutes } from './routes/public.js'
import { CACHE_DEFAULT, CACHE_IMMUTABLE, CACHE_NO_CACHE, fileResponse, safeJoin } from './static.js'

const QUIET_PREFIXES = ['/assets/', '/img/', '/uploads/', '/fonts/', '/favicon']

export function createApp(ctx: AppContext) {
  const app = new Hono()

  // Concise request log: API calls, page loads and errors; skips successful asset hits.
  app.use('*', async (c, next) => {
    const t = performance.now()
    await next()
    const p = c.req.path
    const status = c.res.status
    if (status < 400 && QUIET_PREFIXES.some((q) => p.startsWith(q))) return
    log.info(`${c.req.method} ${p} ${status} ${Math.round(performance.now() - t)}ms`)
  })

  // Security headers. The admin panel and the API must never be framed (clickjacking);
  // the public site may only be framed by itself.
  app.use('*', async (c, next) => {
    await next()
    const p = c.req.path
    const api = p.startsWith('/api/')
    const noFrame = api || p === '/admin' || p.startsWith('/admin/')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('X-Frame-Options', noFrame ? 'DENY' : 'SAMEORIGIN')
    c.header('Content-Security-Policy', noFrame ? "frame-ancestors 'none'" : "frame-ancestors 'self'")
    if (api) c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store')
  })

  app.use('*', compress())

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status)
    log.error(`${c.req.method} ${c.req.path}: ${errMsg(err)}${err instanceof Error && err.stack ? `\n${err.stack}` : ''}`)
    return c.json({ error: 'Serverda ichki xatolik' }, 500)
  })

  app.route('/api', publicRoutes(ctx))
  app.route('/api/ai', chatRoutes(ctx))
  app.route('/api/admin', adminRoutes(ctx))
  app.all('/api/*', (c) => c.json({ error: 'Topilmadi' }, 404))

  // Uploaded files (unique names → immutable cache).
  app.on(['GET', 'HEAD'], '/uploads/*', async (c) => {
    const rel = c.req.path.slice('/uploads/'.length)
    const file = safeJoin(ctx.uploadsDir, rel)
    const res = file && (await fileResponse(file, c.req.method, CACHE_IMMUTABLE))
    return res || c.text('Topilmadi', 404)
  })

  // Built site + SPA fallback.
  const root = ctx.config.staticDir
  const indexHtml = path.join(root, 'index.html')
  app.on(['GET', 'HEAD'], '*', async (c) => {
    const p = c.req.path
    const file = safeJoin(root, p)
    if (file && file !== path.resolve(root) && file !== indexHtml) {
      const cache = p.startsWith('/assets/') ? CACHE_IMMUTABLE : CACHE_DEFAULT
      const res = await fileResponse(file, c.req.method, cache)
      if (res) return res
      // Missing file-like paths (/img/x.jpg) get a real 404 instead of the HTML shell.
      if (path.extname(p) && !p.startsWith('/admin')) return c.text('Topilmadi', 404)
    }
    const res = await fileResponse(indexHtml, c.req.method, CACHE_NO_CACHE)
    return res ?? c.text("Sayt build qilinmagan: avval 'npm run build:site' ni ishga tushiring.", 404)
  })

  return app
}
