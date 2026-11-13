# NovaColor

Premium animated website for **Novacolor** Italian decorative wall coatings (Tashkent), with an admin panel,
AI chat assistant and Telegram notifications.
Italiyaning **Novacolor** dekorativ devor qoplamalari uchun premium animatsiyali sayt (Toshkent) — admin panel,
AI yordamchi va Telegram xabarnomalari bilan.

- Static showcase (no admin/AI) / Statik ko'rgazma: https://jahonsher.github.io/novacolor/
- **Deploy to a server / Serverga joylash: [DEPLOY.md](DEPLOY.md)** (o'zbekcha, bosqichma-bosqich)
- API & architecture spec / Texnik spetsifikatsiya: [docs/backend-spec.md](docs/backend-spec.md)

## Stack / Texnologiyalar

- Site: React + TypeScript + Vite, Tailwind CSS, three.js (WebGL), GSAP + ScrollTrigger + SplitText, Lenis
- Admin panel: React (`/admin`, lazy-loaded, mobile-friendly, Uzbek UI)
- Server: Node >= 22 + TypeScript, Hono, zod, sharp (image resize, WebP), Claude / OpenAI-compatible AI, Telegram Bot API
- Storage: JSON files in `DATA_DIR` (no database)
- Deploy: Docker + docker compose, Caddy (automatic HTTPS)

## Structure / Tuzilma

```
src/                   site (React)              sayt
src/admin/             admin panel               admin panel
src/data/content.json  seed content (UZ/RU)      boshlang'ich kontent
public/                images, PDFs              rasmlar, PDF'lar
server/src/            API server (Hono)         server
server/test/           server tests              testlar
docs/                  specification             spetsifikatsiya
data/                  runtime data, gitignored: content.json, uploads/, leads.json, chats.json, settings.json, backups/
Dockerfile, docker-compose.yml, Caddyfile, deploy/   deployment / joylash
```

## Local development / Lokal ishga tushirish

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD=... (min 8 chars) / kamida 8 belgi
```

**Static site only / Faqat sayt (API'siz)**, same as the GitHub Pages build:

```bash
npm run dev                 # http://localhost:5173/novacolor/
```

**Full stack / To'liq (sayt + server + admin + AI)**, two terminals / ikkita terminal:

```bash
npm run server:dev          # API server: http://localhost:8080 (auto-reload)
VITE_API=1 npm run dev      # site:  http://localhost:5173/novacolor/
                            # admin: http://localhost:5173/novacolor/admin
```

Vite proxies `/api/*` and `/uploads/*` to `http://localhost:8080` (override with `VITE_API_TARGET`).

**Production build locally / Production'ni lokal sinash** (exactly what the server runs):

```bash
npm run build:all           # dist/ (site at "/", API on) + server-dist/
npm start                   # http://localhost:8080  and  http://localhost:8080/admin
```

**Docker:**

```bash
docker compose up -d --build   # http://localhost:8080 (needs .env), see DEPLOY.md
```

## Configuration notes / Sozlamalar haqida

All variables are listed in [.env.example](.env.example); step-by-step setup in [DEPLOY.md](DEPLOY.md).
Barcha o'zgaruvchilar — `.env.example`da, bosqichma-bosqich — DEPLOY.md'da.

- **AI** is `off` unless a key is set (`ANTHROPIC_API_KEY` → Claude, default model `claude-opus-5-5`;
  `AI_API_KEY` → any OpenAI-compatible API). `AI_MODEL=claude-haiku-5-5` is the much cheaper Claude option
  ($0.10 / $0.50 vs $4 / $20 per 1M tokens). `AI_PROVIDER=free` is explicit and for testing only (slow; a third-party
  service receives visitor messages); `AI_PROVIDER=mock` is for automated tests only and is refused in production.
  AI kalitsiz — o'chiq. `free` — faqat aniq yozilganda va faqat sinov uchun; `mock` — faqat testlar uchun, production'da ishlamaydi.
- **Telegram**: set `TELEGRAM_BOT_TOKEN`, then choose the chat in admin → **Sozlamalar** (the "Aniqlash" button lists
  chats that recently wrote to the bot — only when the bot has no webhook). `TELEGRAM_CHAT_ID` in `.env` wins.
  Chat ID admin panel → Sozlamalar'da tanlanadi; `.env`dagi `TELEGRAM_CHAT_ID` ustun.
  **Important / Muhim:** the existing bot **@novacolorbot** has a webhook owned by the live website novacolor.uz —
  never call `deleteWebhook`/`setWebhook` on it (the server never does). Create a separate notifications bot via
  @BotFather. / @novacolorbot'ning webhook'i novacolor.uz saytiniki — unga `deleteWebhook` qilmang; arizalar uchun
  @BotFather'da alohida bot yarating.
- **Limits / Cheklovlar**: `AI_DAILY_LIMIT` (per IP, IPv6 per /64, default 60/day), `AI_GLOBAL_DAILY_LIMIT` (all visitors,
  default 500/day), `LEADS_HOURLY_LIMIT` (default 60/hour; Telegram notifications are capped at 60/hour too).
  Behind a reverse proxy set `TRUST_PROXY=1`; forwarded headers are believed only from `TRUSTED_PROXIES`
  (default: loopback + private ranges).
- Admin **logout signs out every device**; changing `ADMIN_PASSWORD` does the same. / "Chiqish" — barcha qurilmalardan.

## Tests and checks / Testlar

```bash
npm run test:server         # server tests (node:test)
npm run lint                # oxlint
npm run build               # type-check + GitHub Pages build
```

## GitHub Pages

```bash
npm run deploy              # static showcase -> gh-pages branch (no admin/AI)
```

Content for the static build comes from `src/data/content.json`. On the server, content is edited in the admin
panel and stored in `data/content.json`.
Statik versiyada kontent `src/data/content.json`dan olinadi; serverda esa admin paneldan tahrirlanadi va
`data/content.json`da saqlanadi.
