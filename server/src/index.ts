import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { ConfigError, findAppDir, loadConfig } from './config.js'
import { createContext } from './context.js'
import { errMsg, log } from './log.js'

// Load .env (ENV_FILE or <app>/.env). Variables already set in the environment win.
const envFile = process.env.ENV_FILE ?? path.join(process.env.APP_DIR ?? findAppDir(), '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

async function main() {
  let config
  try {
    config = loadConfig()
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`\nXATO: ${e.message}\n`)
      process.exit(1)
    }
    throw e
  }

  const ctx = await createContext(config)
  const app = createApp(ctx)

  if (!existsSync(path.join(config.staticDir, 'index.html'))) {
    log.warn(`Sayt topilmadi (${config.staticDir}/index.html). 'npm run build:site' ni ishga tushiring.`)
  }
  const tgChat = ctx.telegram.chatId ? 'chat ID bor' : "chat ID yo'q — admin panel → Sozlamalar'da kiriting"
  log.info(`DATA_DIR: ${config.dataDir}`)
  log.info(`AI: ${ctx.ai ? `${ctx.ai.name} (${ctx.ai.model})` : "o'chiq"}; Telegram: ${ctx.telegram.configured ? tgChat : 'sozlanmagan'}`)
  if (ctx.ai?.name === 'free') log.warn("AI 'free' provayderi faqat sinov uchun: xabarlar uchinchi tomonga (pollinations.ai) yuboriladi")

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log.info(`NovaColor server ishga tushdi: http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}`)
  })

  let closing = false
  const shutdown = (sig: string) => {
    if (closing) return
    closing = true
    log.info(`${sig}: to'xtatilmoqda…`)
    server.close()
    ctx
      .close()
      .catch((e) => log.error(errMsg(e)))
      .finally(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((e) => {
  console.error(`\nXATO: server ishga tushmadi: ${errMsg(e)}\n`)
  process.exit(1)
})
