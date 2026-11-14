# NovaColor — server, admin panel, AI yordamchi: texnik spetsifikatsiya

Bu hujjat — server API va front-end o'rtasidagi **shartnoma**. Server, admin panel va sayt
integratsiyasi shu hujjatga qarab yoziladi; o'zgartirish kerak bo'lsa, avval shu fayl yangilanadi.

## Maqsad

- Sayt bitta arzon serverda (VPS / Docker) ishlaydi: bitta Node jarayoni saytni ham, API'ni ham beradi.
- Admin panel (`/admin`): mahsulotlar, kategoriyalar, sertifikatlar (PDF), yangiliklar, aloqa ma'lumotlari,
  arizalar (leads) va AI suhbatlarini boshqarish.
- AI yordamchi: saytdagi chat — mijozga mahsulot tanlashda maslahat beradi; mijoz telefonini qoldirsa
  ariza yaratiladi va Telegram'ga yuboriladi.
- Telegram bot: aloqa formasidan va AI chatdan kelgan arizalar botga yuboriladi; admin panelda ham ko'rinadi.
- GitHub Pages'dagi statik versiya (`npm run deploy`) avvalgidek ishlashda davom etadi (API'siz).

## Arxitektura

```
NovaColor/
  src/                 sayt (React + Vite) — mavjud
  src/admin/           admin panel (React, lazy-load, /admin yo'lida)
  server/              Node + TypeScript server (Hono)
    src/index.ts       kirish nuqtasi: API + statik fayllar (dist/) + /uploads
    src/...            store, auth, routes, ai, telegram
    tsconfig.json      → server-dist/ ga kompilyatsiya
  data/                (gitignore) ish vaqtidagi ma'lumotlar — DATA_DIR
    content.json       sayt kontenti (birinchi ishga tushganda src/data/content.json'dan nusxa)
    uploads/images/    admin yuklagan rasmlar
    uploads/pdf/       admin yuklagan PDF'lar
    uploads/videos/    admin yuklagan videolar (+ ffmpeg yaratgan poster .jpg)
    leads.json         arizalar
    chats.json         AI suhbatlari
    settings.json      avtomatik sozlamalar (sessiya siri, Telegram chat_id va rejimi)
    telegram-subscribers.json  Telegram obunachilari (arizalar kimga boradi) + getUpdates offset
    backups/           content.json'ning oxirgi 30 ta nusxasi (har saqlashda)
```

- Node ≥ 22. Server freymvorki: `hono` + `@hono/node-server`. Validatsiya: `zod`.
  Rasmlarni kichraytirish: `sharp`. AI: `@anthropic-ai/sdk` (Claude) + OpenAI-mos HTTP adapter (bepul/boshqa provayderlar uchun).
- Ma'lumotlar JSON fayllarda (bitta admin, kichik hajm — ma'lumotlar bazasi shart emas). Yozish — atomik
  (`tmp` faylga yozib `rename`), bitta jarayon ichida navbat bilan (mutex).
- Sayt server bilan **ildiz yo'lda** (`/`) ishlaydi: `VITE_BASE=/ VITE_API=1 vite build`.
  GitHub Pages build: `base=/novacolor/`, `VITE_API` yo'q → API chaqirilmaydi, chat ko'rinmaydi, forma eski usulda.

## Muhit o'zgaruvchilari (`.env`)

| O'zgaruvchi | Majburiy | Izoh |
|---|---|---|
| `PORT` | yo'q | standart `8080` |
| `DATA_DIR` | yo'q | standart `<app>/data` (nisbiy yo'l ilova papkasiga nisbatan) |
| `STATIC_DIR` | yo'q | build qilingan sayt, standart `<app>/dist` |
| `SEED_CONTENT` | yo'q | birinchi ishga tushishdagi kontent, standart `<app>/src/data/content.json` |
| `HOST` | yo'q | standart `0.0.0.0`; `TRUST_PROXY=1` bo'lsa standart `127.0.0.1` (proxy shu serverda). Docker'da konteyner ichida doim `0.0.0.0` (compose belgilaydi), tashqi port `APP_BIND` bilan cheklanadi |
| `TRUST_PROXY` | yo'q | `1` — reverse proxy (nginx/Caddy) ortida: cheklovlar uchun IP **eng o'ngdagi** `X-Forwarded-For` yozuvidan (proxy qo'shgan; chapdagilar — mijoz yuborgan, ishonchsiz) yoki `X-Real-IP`dan olinadi — faqat so'rov soketi `TRUSTED_PROXIES` ichidan kelgan bo'lsa. Aks holda soket manzili. Proxy'siz o'chiq qoldiring |
| `TRUSTED_PROXIES` | yo'q | vergul bilan IP/CIDR ro'yxati. Standart: loopback + xususiy tarmoqlar (`127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7`) — shu serverdagi nginx va docker-compose tarmog'idagi Caddy uchun |
| `ENV_FILE` | yo'q | `.env` yo'li (standart `<app>/.env`; muhitdagi o'zgaruvchilar ustun) |
| `FFMPEG_PATH` | yo'q | ffmpeg (video posteri va katta videolarni siqish). Standart `ffmpeg` (PATH'dan); `off` — o'chirish. Topilmasa yuklash baribir ishlaydi, faqat poster avtomatik yaratilmaydi (Videolar bo'limi) |
| `ADMIN_PASSWORD` | **ha** | admin panel paroli (kamida 8 belgi; bo'lmasa server ishga tushmaydi) |
| `SESSION_SECRET` | yo'q | cookie imzosi; bo'lmasa `DATA_DIR/settings.json`ga tasodifiy yaratiladi |
| `PUBLIC_URL` | yo'q | masalan `https://novacolor.uz` — Telegram xabaridagi havolalar uchun |
| `TELEGRAM_BOT_TOKEN` | yo'q | bot tokeni (alias: `telegram_bot_Token`) |
| `TELEGRAM_CHAT_ID` | yo'q | `single` rejimida arizalar keladigan chat. Bo'lmasa — admin panel → Sozlamalar'da kiritiladi (`settings.json`). Env ustun |
| `TELEGRAM_MODE` | yo'q | `subscribers` (hamma faol obunachilarga) \| `single` (bitta chat). Env admin paneldagidan ustun. Bo'lmasa: admin panelda tanlangani; u ham bo'lmasa — chat ID (env yoki saqlangan) bor → `single`, yo'q → `subscribers`. Noto'g'ri qiymat → server ishga tushmaydi |
| `TELEGRAM_WEBHOOK_SECRET` | yo'q | ≥ 16 belgi `[A-Za-z0-9_-]`. Berilsa `POST /api/telegram/webhook/<secret>` yoqiladi (bot shu serverga ulanganda). Webhook'ni server **o'zi o'rnatmaydi** (DEPLOY.md) |
| `TELEGRAM_API_BASE` | yo'q | standart `https://api.telegram.org` (o'z Bot API serveri yoki testlarda soxta Telegram) |
| `AI_PROVIDER` | yo'q | `anthropic` \| `openai` \| `free` \| `mock` \| `off`. Bo'lmasa: `ANTHROPIC_API_KEY` bor → `anthropic`; `AI_API_KEY` bor → `openai`; aks holda `off`. `free` faqat aniq yozilganda; `mock` — avtomatik testlar uchun (oflayn, tayyor javob `/products/teodorico` havolasi bilan), `NODE_ENV=production`da server ishga tushmaydi |
| `ANTHROPIC_API_KEY` | yo'q | Claude uchun |
| `AI_MODEL` | yo'q | anthropic standarti `claude-opus-5-5`; openai standarti `gpt-4o-mini`; free standarti `openai` |
| `AI_API_KEY`, `AI_BASE_URL` | yo'q | OpenAI-mos provayder (OpenAI, Groq, OpenRouter, Gemini OpenAI-endpoint …) |
| `AI_DAILY_LIMIT` | yo'q | bitta IP uchun kunlik AI xabarlar soni, standart `60`. IPv6 manzillar `/64` bo'yicha sanaladi (barcha IP cheklovlari kabi) |
| `AI_GLOBAL_DAILY_LIMIT` | yo'q | barcha tashrifchilar uchun jami kunlik AI xabarlar (xarajat chegarasi), standart `500`. Oshsa AI chaqirilmaydi: `200 { reply: "AI band… telefon qoldiring" }`, telefon bo'lsa ariza baribir yaratiladi |
| `LEADS_HOURLY_LIMIT` | yo'q | jami yangi arizalar soatiga (forma + AI), standart `60`. Telegram xabarlari alohida: soatiga 60 ta |

`free` provayder — `https://text.pollinations.ai/openai` (kalitsiz, faqat **sinov** uchun: sifati past,
ma'lumotlar — telefon raqamlari bilan — uchinchi tomonga ketadi). Shuning uchun u hech qachon standart sifatida
tanlanmaydi: faqat `AI_PROVIDER=free` yozilganda. Ishlab chiqarishda haqiqiy kalit qo'yiladi.

## Ma'lumot turlari

`src/data/index.ts`dagi turlar asos (Product, Category, NewsItem, Doc, contacts, about, stats, clients).
Qo'shimchalar:

```ts
type Lead = {
  id: string                 // nanoid/uuid
  createdAt: string          // ISO
  source: 'contact' | 'ai'
  name: string               // ai'da noma'lum bo'lsa ''
  phone: string
  product?: string
  message?: string
  chatId?: string            // source=ai bo'lsa — tegishli suhbat
  status: 'new' | 'in_progress' | 'done'
  note?: string              // admin izohi
  telegram: 'sent' | 'failed' | 'skipped'
}
type ChatSession = {
  id: string                 // brauzer yaratgan sessionId (uuid)
  createdAt: string; updatedAt: string
  lang: 'uz' | 'ru'
  page?: string              // suhbat boshlangan sahifa
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]
  leadId?: string
}
```

Rasm yo'llari: statik (`img/products/x.jpg`) yoki yuklangan (`uploads/images/<id>.webp`) — ikkalasi ham
front-end'dagi `asset(path)` orqali ochiladi. PDF: `pdf/x.pdf` yoki `uploads/pdf/<nom>.pdf`.
`Doc.file` — endi to'liq nisbiy yo'l saqlanadi? **Yo'q**: mos kelish uchun `Doc.file` nom bo'lib qoladi,
yuklangan PDF'lar uchun ixtiyoriy `Doc.path` maydoni qo'shiladi (`uploads/pdf/<nom>.pdf`); front-end:
`asset(d.path ?? 'pdf/' + d.file)`.

Kategoriya `count` — server tomonidan hisoblanadi (mahsulotlar soni), admin kiritmaydi.

## API

Barcha javoblar JSON. Xato: `{ "error": "matn (o'zbekcha)" }` + mos HTTP status.

### Ommaviy

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/api/health` | `{ ok: true, ai: boolean, telegram: boolean }` |
| GET | `/api/content` | butun kontent: `{ products, categories, news, stats, about, contacts, clients, documents, videos }` (`Cache-Control: no-cache`) |
| POST | `/api/leads` | aloqa formasi. Body: `{ name, phone, product?, message? }` → `201 { ok: true }`. Validatsiya: name 1–100, phone 5–30 (raqam/+/bo'sh joy/-/()), message ≤ 2000. IP bo'yicha 5/10daq cheklov (429) — tana o'qilishidan **oldin** sanaladi. Honeypot maydoni `website` bo'sh bo'lmasa — jim `201`, saqlamaydi. **Takror**: xuddi shu telefon (raqamlari) 10 daqiqa ichida → yangi ariza emas, mavjudiga xabar qo'shiladi, Telegram'ga ikkinchi marta yuborilmaydi. Jami soatlik limit (`LEADS_HOURLY_LIMIT`) yoki ro'yxat to'la (10 000, o'chiriladigan `done` yo'q) → `503 { error: "… qo'ng'iroq qiling: <telefon>" }` |
| POST | `/api/telegram/webhook/:secret` | faqat `TELEGRAM_WEBHOOK_SECRET` (va token) bo'lsa; aks holda `404`. `:secret` mos emas → `404`; `X-Telegram-Bot-Api-Secret-Token` sarlavhasi yo'q/mos emas → `401` (ikkalasi ham vaqt bo'yicha xavfsiz solishtiriladi). Tana ≤ 64 KB, `update_id` yo'q → `400`. Yangilanish polling'dagidek ishlanadi (Telegram bo'limi), `update_id < offset` (qayta yuborilgan) — e'tiborsiz. Javob doim `200 { ok: true }` (ichki xato logga yoziladi). Sir loglarda `***` bilan yashiriladi |
| POST | `/api/ai/chat` | Body: `{ sessionId, lang: 'uz'|'ru', page?, message }` (`page` — faqat sayt yo'li `^/[\w/-]{0,200}$`, `//` bilan boshlanmaydi; boshqa qiymat jimgina tashlab yuboriladi) → `{ reply: string, lead?: boolean }`. Server suhbat tarixini o'zi saqlaydi (`chats.json`), so'nggi 20 xabarni modelga yuboradi. message ≤ 1000 belgi. IP kunlik limiti (`AI_DAILY_LIMIT`) → 429 `{ error, limit: true }` (limit tugagan IP'ning tanasi o'qilmaydi). Shu sessiyada oldingi xabarga javob hali tayyorlanayotgan bo'lsa → `409 { error }`. AI o'chiq/xato → 503 `{ error }`. Sessiyada 100 ta tashrifchi xabaridan keyin AI chaqirilmaydi: muloyim "qo'ng'iroq qiling / telefon qoldiring" javobi. Jami kunlik limit — `AI_GLOBAL_DAILY_LIMIT` |

**Tana hajmi**: `/api/ai/chat`, `/api/leads`, `/api/admin/login` — ≤ 16 KB; boshqa admin JSON — ≤ 1 MB (faqat kirgan
admin uchun o'qiladi); yuklashlar — o'z cheklovlari (rasm 15 MB, PDF 30 MB). Kattarog'i → `413 { error }`: `Content-Length`
katta bo'lsa tana umuman o'qilmaydi, `chunked` bo'lsa chegaragacha o'qiladi. Video (`/api/admin/upload/video`) — ≤ 200 MB, tana xotiraga yig'ilmaydi: diskka oqim bilan yoziladi.
Caddy'da qo'shimcha `request_body`: video yuklash yo'li uchun 201 MB, qolgan hammasi 32 MB (matcherlar bir-birini istisno qiladi).
Node `requestTimeout` — 30 daqiqa (standart 5 daqiqa sekin internetda 200 MB yuklashni uzib qo'yardi; sarlavhalar uchun `headersTimeout` 60 s qoladi).

**Xavfsizlik sarlavhalari** (hamma javoblarda): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`;
`/admin*` va `/api/*` — `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`; qolgan sayt —
`SAMEORIGIN` + `frame-ancestors 'self'`. HSTS — Caddy'da (`max-age=31536000`).

**AI xulqi** (system prompt server tomonida, katalogdan avtomatik quriladi):
- Novacolor (Toshkent) dekorativ qoplamalari bo'yicha maslahatchi; javob tili — `lang`.
- Faqat katalogdagi mahsulotlarni tavsiya qiladi (nomi, qisqa tavsifi, kategoriyasi, sahifa havolasi `/products/<slug>`).
- Narx so'ralsa — narxlar menejer orqali; ism va telefon qoldirishni taklif qiladi.
- Qisqa (2–5 jumla), markdown'siz yoki minimal.
- Mavzudan tashqari savollarga muloyim rad.
- **Lead aniqlash**: foydalanuvchi xabarida telefon raqami topilsa (regex: `+998`/`998`/9 xonali O'zbekiston
  raqamlari va umumiy 7–15 raqam), sessiyada hali lead bo'lmasa → `Lead{source:'ai'}` yaratiladi (shu telefon
  10 daqiqa ichida forma/boshqa suhbatdan kelgan bo'lsa — o'sha ariza yangilanadi va sessiyaga bog'lanadi)
  (ism — xabardan aniqlansa, aks holda bo'sh; `message` — suhbatdan qisqa mazmun: oxirgi 6 ta foydalanuvchi xabari),
  Telegram'ga yuboriladi, javobda `lead: true`.
- Anthropic: `client.beta.messages.create({ model, max_tokens: 1024, system, messages, output_config: { effort: 'low' },
  cache_control: { type: 'ephemeral' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })` — `thinking`
  yuborilmaydi; `betas`/`fallbacks` faqat server-side fallback'i bor modellarda: `claude-fable-5-2`, `claude-fable-5-1`,
  `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5-5` (masalan `claude-haiku-5-5`da ular yuborilmaydi); `system` = [katalog (kesh nuqtasi bilan), joriy sahifa/lead holati]. Javobdagi `text` bloklarni yig'ish;
  `stop_reason === 'refusal'` → muloyim standart javob.
- AI xato bersa, lekin shu xabarda telefon topilib ariza yaratilgan bo'lsa → `200 { reply: <"Rahmat! Arizangiz qabul qilindi…">, lead: true }`.
- Qayta yuborish: oxirgi saqlangan xabar xuddi shu matndagi (javobsiz) foydalanuvchi xabari bo'lsa — takror saqlanmaydi.

### Admin (cookie sessiya)

Kirish: `POST /api/admin/login { password }` → `HttpOnly; SameSite=Strict; Path=/; Max-Age=7 kun`
(`Secure` — HTTPS bo'lsa) cookie `nc_admin` (HMAC-imzolangan muddatli token). Imzo kaliti =
`HMAC(sessionSecret, ADMIN_PASSWORD + sessionEpoch)`: parol almashsa — barcha sessiyalar bekor; `sessionEpoch`
(`settings.json`) har `POST /api/admin/logout`da oshadi — **chiqish barcha qurilmalarda** amal qiladi.
`GET /api/admin/me → { ok: true }` (401 agar kirmagan).
Barcha `/api/admin/*` (login'dan tashqari) — cookie talab qiladi, aks holda `401`.
CSRF (SameSite'dan tashqari): `POST`/`PUT`/`PATCH`/`DELETE`da `Origin` sarlavhasi bo'lsa, uning host'i so'rov
`Host`iga (yoki ishonchli proxy'dan kelgan `X-Forwarded-Host`ga) teng bo'lishi shart, aks holda `403`;
`POST`/`PUT`/`PATCH` (jumladan login/logout) `Content-Type: application/json` yoki `multipart/form-data` bo'lishi shart, aks holda `415`. `DELETE` — tanasiz, Content-Type shart emas.
Login cheklovi: har urinish parol tekshirilishidan **oldin, sinxron** sanaladi (bir vaqtda 100 ta so'rov ham 5 tadan
ortiq tekshirilmaydi): IP bo'yicha 5 urinish/10 daqiqa → `429` (to'g'ri parol bilan ham); muvaffaqiyatli kirish IP
hisobini tozalaydi. Qo'shimcha: barcha IP'lardan jami 50 ta noto'g'ri urinish/10 daqiqa → hamma uchun `429`
(taqsimlangan parol terish hujumiga qarshi; IP bo'yicha bloklangan so'rovlar jami hisobga qo'shilmaydi).

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/api/admin/content` | `/api/content` bilan bir xil (yangilangan) |
| POST | `/api/admin/products` | yangi mahsulot (Product, `id` server beradi; `slug` noyob, `[a-z0-9-]`) → 201 Product |
| PUT | `/api/admin/products/:slug` | to'liq yangilash (slug o'zgarishi mumkin, noyobligi tekshiriladi) |
| DELETE | `/api/admin/products/:slug` | o'chirish (documents/news'dagi havolalar ham tozalanadi) |
| PUT | `/api/admin/products-order` | `{ slugs: string[] }` — tartib |
| POST/PUT/DELETE | `/api/admin/categories[/:id]` | kategoriyalar (`name{uz,ru}`, `image`); ishlatilayotgan kategoriyani o'chirib bo'lmaydi (409) |
| POST/PUT/DELETE | `/api/admin/news[/:id]` | yangiliklar |
| PUT | `/api/admin/contacts` | aloqa ma'lumotlari |
| PUT | `/api/admin/about` | `{ lead{uz,ru}, extra{uz,ru} }` |
| POST | `/api/admin/upload/image` | multipart `file` (jpg/png/webp, ≤ 15 MB, ≤ ~40 MP, magic-bytes tekshiruvi) → max 2000px, EXIF bo'yicha buriladi, metadata o'chiriladi, webp q82 → `{ path: 'uploads/images/<id>.webp', width, height }`. Istisno: JPEG/WebP allaqachon ≤ 2000px, burish/metadata yo'q va WebP kattaroq chiqsa — asl fayl saqlanadi (`<id>.jpg` / `<id>.webp`) |
| POST | `/api/admin/upload/video` | multipart `file` — Videolar bo'limiga qarang |
| POST/PUT/DELETE | `/api/admin/videos[/:id]` | videolar (Videolar bo'limi) |
| PUT | `/api/admin/videos-order` | `{ ids: number[] }` — tartib (noma'lum id → 400; ro'yxatda yo'qlari oxirida eski tartibda) |
| POST | `/api/admin/documents` | multipart: `file` (PDF ≤ 30 MB, `%PDF` bilan boshlanishi shart), `title_uz`, `title_ru`, `group`, `products` (JSON massiv) → 201 Doc |
| PUT | `/api/admin/documents/:file` | meta yangilash (title, group, products) |
| DELETE | `/api/admin/documents/:file` | ro'yxatdan o'chirish; fayl `uploads/` ichida bo'lsa — o'zi ham o'chadi |
| GET | `/api/admin/leads` | `Lead[]` (yangisi birinchi) |
| PATCH | `/api/admin/leads/:id` | `{ status?, note? }` |
| DELETE | `/api/admin/leads/:id` | |
| GET | `/api/admin/chats` | `ChatSession[]` qisqa: `{id, createdAt, updatedAt, lang, page, count, preview, leadId}` |
| GET | `/api/admin/chats/:id` | to'liq `ChatSession` |
| GET | `/api/admin/settings` | `{ telegram: { configured, mode, modeSource, chatId, chatIdSource, botUsername, subscribers: { active, total }, updates: { state, webhookHost, checkedAt, error }, webhookReceiver }, ai: { provider, model, enabled } }` |
| PUT | `/api/admin/settings/telegram` | `{ chatId?, mode? }` (kamida bittasi). `chatId` — `settings.json`ga (`''` — o'chirish), raqam (`123456789`, guruh `-100…`) yoki `@kanal`; `TELEGRAM_CHAT_ID` env'da bo'lsa → 409. `mode` — `subscribers`\|`single`; `TELEGRAM_MODE` env'da bo'lsa → 409. Noto'g'ri → 400. Javob: `telegram` bloki (settings'dagi kabi) |
| GET | `/api/admin/telegram/subscribers` | `{ subscribers: Subscriber[] (yangisi birinchi), max: 100, updates }` |
| POST | `/api/admin/telegram/subscribers` | qo'lda qo'shish `{ chatId (faqat raqam), name (1–100), username?, type? }` → `201 Subscriber` (`source: 'manual'`; `type` berilmasa: `-100…` superguruh, `-…` guruh, aks holda shaxsiy). Bor ID / ro'yxat to'la → 409 |
| PUT | `/api/admin/telegram/subscribers` | butun ro'yxatni almashtirish `{ subscribers: [{ chatId, name, username?, type?, active }] }` (≤ 100; ma'lum ID'lar `addedAt`/`source`ni saqlaydi) → GET kabi javob |
| PATCH | `/api/admin/telegram/subscribers/:chatId` | `{ active?, name? }` → `Subscriber`; topilmasa 404 |
| DELETE | `/api/admin/telegram/subscribers/:chatId` | `{ ok: true }`; topilmasa 404 |
| GET | `/api/admin/telegram/chats` | `single` rejimi uchun yordamchi: botga yaqinda yozgan chatlar (`getUpdates`; polling/o'z webhook'imiz ishlayotgan bo'lsa — obunachilar ro'yxatidan) → `{ ok: true, chats: [{ id, type, name, username }] }` yoki `{ ok: false, error }` (webhook bo'lsa 409 sababi). **Hech narsa saqlanmaydi** |
| POST | `/api/admin/telegram/test` | sinov xabari hozirgi barcha qabul qiluvchilarga → `{ ok, total, sent, failed, results: [{ chatId, name?, ok, error?, deactivated? }], error? }` (`ok` — kamida bittasiga yetdi) |
| GET | `/api/admin/stats` | `{ products, documents, videos, leadsNew, leadsTotal, chatsToday }` |

Har bir kontent o'zgarishi: validatsiya (zod) → `backups/content-<ISO>.json` (30 tadan oshsa eskisi o'chadi) → atomik yozish.
(ISO'dagi `:` va `.` → `-`, masalan `content-2026-11-14T10-20-30-123Z.json` — Windows'da ham ishlashi uchun; backup — o'zgarishdan **oldingi** holat.)

**Javob shakllari (aniqlik):**
- `POST /products` → `201 Product`; `PUT /products/:slug` → `200 Product` (slug o'zgarsa news/documents'dagi havolalar ham yangilanadi); `DELETE` → `{ ok: true }`; `PUT /products-order` → `{ ok: true }` (ro'yxatda yo'q mahsulotlar oxirida eski tartibda qoladi; noma'lum slug → 400).
- Product body: `{ slug, name, categories: number[], image, gallery?: string[], subtitle{uz,ru}, description{uz,ru} }`; `id` e'tiborsiz. Noma'lum kategoriya → 400. Slug band → 409.
- Kategoriya: `POST` body `{ name{uz,ru}, image }` → `201 Category` (`count` hisoblangan); `PUT /categories/:id` → `200 Category`; `DELETE` → `{ ok: true }` / 409.
- Yangilik: body `{ title, date: 'YYYY-MM-DD', image, product: slug | null }` → `POST 201 NewsItem`, `PUT 200 NewsItem`, `DELETE { ok: true }`.
- `PUT /contacts` body: contacts (`phoneHref` ixtiyoriy — bo'lmasa `tel:+998…` telefondan hosil qilinadi; berilsa `^tel:\+?\d+$`) → `200 contacts`.
  `telegram` — `https://t.me/…` yoki `https://telegram.me/…`; `instagram` — `https://(www.)instagram.com/…`;
  `map` (iframe src) — `https://` Yandex (`yandex.ru|uz|com|kz|by|com.tr`) yoki Google (`google.com/…`, `maps.google.…`);
  `email` — to'g'ri email; bo'sh qator (`''`) — "yo'q" degani. `PUT /about` → `200 about`.
- Rasm yo'llari (mahsulot `image`/`gallery`, kategoriya, yangilik): faqat `^(img|uploads|pdf)/[\w./-]+$`, `..` va `//`siz
  (URL va `javascript:` kabi sxemalar yo'q). Saqlangan `content.json` yumshoqroq tekshiriladi — eski qiymat serverni to'xtatmaydi.
- `POST /upload/image` → **`201`** `{ path, width, height }`. Noto'g'ri fayl → 400, katta → 413.
- `POST /documents` → `201 Doc` (`file` = lotinlashtirilgan nom, masalan `sertifikat-iso-9001.pdf`, takrorlansa `-2`;
  nom diskda atomik band qilinadi (`open(…, 'wx')`), bir vaqtdagi bir xil nomli yuklashlar to'qnashmaydi; `path: 'uploads/pdf/<file>'`, `size` KB). `products` maydoni — JSON massiv satri (yo'q bo'lsa `[]`); noma'lum slug → 400.
- `PUT /documents/:file` body: `{ title?: {uz,ru}, group?, products?: string[] }` (qisman) → `200 Doc`. `DELETE` → `{ ok: true }`.
- `PATCH /leads/:id` → `200 Lead`; `DELETE /leads/:id` → `{ ok: true }`; topilmasa 404.
- `GET /chats` element: `{ id, createdAt, updatedAt, lang, page: string|null, count, preview, leadId: string|null }`, `updatedAt` bo'yicha yangisi birinchi; `preview` — birinchi foydalanuvchi xabari (≤140 belgi).
- `GET /settings`: `telegram.chatId`, `telegram.botUsername` — `string | null`; `telegram.chatIdSource` — `'env'|'settings'|null`; `ai.provider` — `'anthropic'|'openai'|'free'|'mock'|'off'`.
- `GET /settings`: `telegram.mode` — `'subscribers'|'single'`, `modeSource` — `'env'|'settings'|'default'`; `updates.state` — `off|checking|polling|webhook|webhook-self|error`, `updates.webhookHost` — faqat host (URL yo'li/siri ko'rsatilmaydi).
- `POST /telegram/test` → har doim `200`; qabul qiluvchi yo'q bo'lsa `{ ok: false, total: 0, …, error: "sabab" }`.
- `GET /stats`: `chatsToday` — bugun (Toshkent vaqti) faol bo'lgan suhbatlar soni.
- `POST /login` → `{ ok: true }` / 401 / 429; `POST /logout` → `{ ok: true }`.

### Statik fayllar

- `/uploads/*` → `DATA_DIR/uploads/*` (path traversal himoyasi; `Cache-Control: public, max-age=31536000, immutable` — nomlar noyob).
- Qolgani → `dist/` (Vite build). Topilmagan yo'l va `/admin*` → `dist/index.html` (SPA fallback).
  Istisno: kengaytmali topilmagan fayl (`/img/x.jpg`, `/admin*` dan tashqari) → `404` (HTML emas).
- `/api/*` dagi noma'lum yo'l → `404 { error }`.
- `dist/assets/*` uzoq kesh, `index.html` — `no-cache`.
- **Range** (`/uploads/*` va `dist/` fayllari): `Accept-Ranges: bytes`; bitta oraliq `bytes=a-b`, `bytes=a-`, `bytes=-n` → `206` +
  `Content-Range`; fayldan tashqari → `416` (`Content-Range: bytes */<hajm>`); bir nechta oraliq yoki noto'g'ri sarlavha → butun fayl `200`;
  `If-Range` (Last-Modified bilan) mos kelmasa → `200`. 206 javoblar siqilmaydi. (iOS Safari Range'siz serverdan MP4 o'ynatmaydi.)

## Videolar ("Instagram'dan" bo'limi)

Kompaniya Instagram videolari saytda **video sifatida** ko'rsatiladi: o'zimizda saqlangan fayl (`src`) yoki Instagram'ning
rasmiy embed pleyeri (faqat `instagram` havolasi bo'lsa).

```ts
type Video = {
  id: number
  title: { uz: string; ru: string }   // ru bo'sh bo'lishi mumkin → saytda uz ko'rsatiladi
  src?: string        // 'uploads/videos/<id>.mp4|webm|mov' (admin yuklagan) yoki 'video/<nom>.mp4' (public/video)
  poster?: string     // rasm yo'li (img/…, uploads/…) — yuklashda ffmpeg yaratgan 'uploads/videos/<id>.jpg' yoki admin yuklagan rasm
  instagram?: string  // 'https://www.instagram.com/p/<shortcode>/' (normallashtirilgan)
  product?: string | null  // mahsulot slug — video o'sha mahsulot sahifasida ham chiqadi
  date?: string       // 'YYYY-MM-DD'
}
```

- `content.json`dagi `videos` massivi. `src` yoki `instagram`dan kamida bittasi shart. Eski `content.json`da `videos` kaliti umuman
  bo'lmasa (bu funksiyadan oldingi o'rnatish) — server ishga tushganda **bir marta** `SEED_CONTENT`dagi videolar qo'shiladi (backup bilan);
  kalit bor bo'lsa (bo'sh massiv ham) — tegilmaydi.
- **Instagram havolasi**: `https://(www.)instagram.com/[<user>/](p|reel|reels|tv)/<shortcode>/…` (query/fragment mumkin) →
  `https://www.instagram.com/p/<shortcode>/` ko'rinishida saqlanadi. Boshqa host, `http:`, profil/stories havolasi → 400.
- `POST /videos` body: `{ title{uz,ru}, src?, poster?, instagram?, product?: slug|null, date? }` (`''` — "yo'q") → `201 Video`;
  `PUT /videos/:id` — to'liq almashtirish → `200 Video`; `DELETE` → `{ ok: true }`; topilmasa 404; noma'lum mahsulot → 400.
  `src` `uploads/videos/…` bo'lsa fayl diskda bo'lishi shart (yo'q → 400); fon siqishi tugagan bo'lsa (`<id>-720p.mp4` bor) — o'sha saqlanadi.
  PUT/DELETE'dan keyin hech bir video ishlatmayotgan `uploads/videos/` fayllari (video, generatsiya qilingan poster) o'chiriladi.
  Mahsulot slug'i o'zgarsa/o'chirilsa — `videos[].product` ham yangilanadi / `null`.
- `POST /upload/video` — multipart `file`. Tana **oqim bilan** diskka (`uploads/videos/.upload-*.tmp`) yoziladi, xotiraga yig'ilmaydi.
  Turi magic bytes bo'yicha: `ftyp` box (offset 4) → MP4 (`qt  ` brendi → MOV; HEIC/AVIF kabi rasm brendlari rad etiladi), EBML
  `1A 45 DF A3` + DocType `webm` → WebM (Matroska `.mkv` rad etiladi). Nom/kengaytma/MIME e'tiborga olinmaydi; tur birinchi baytlarda
  aniqlanadi — noto'g'ri fayl oxirigacha qabul qilinmaydi. ≤ 200 MB: `Content-Length` katta bo'lsa tana o'qilmaydi (`413`), aks holda
  o'qish paytida sanaladi. Nomi `uploads/videos/<base36 vaqt>-<10 hex>.<mp4|mov|webm>` → **`201`**
  `{ path, poster: string|null, bytes, type: 'mp4'|'mov'|'webm', processing: boolean }`.
- **ffmpeg (ixtiyoriy)**: bor bo'lsa — 1-soniyadagi kadr (qisqa videoda birinchi kadr), uzun tomoni ≤ 1080px, `uploads/videos/<id>.jpg`
  (`poster`). Fayl > 25 MB yoki MP4 emas (MOV/WebM) bo'lsa — fonda (navbat, bittadan, eng past CPU ustuvorligida) H.264 720p
  (qisqa tomoni ≤ 720, kattalashtirilmaydi), CRF 28, AAC 128k, `+faststart` → `<id>-720p.mp4`. MP4 uchun natija kichikroq bo'lsagina
  almashtiriladi (MOV/WebM — har doim, moslik uchun). Tugagach `content.json`dagi havolalar yangilanadi va asl fayl o'chiriladi;
  hali saqlanmagan forma eski yo'l bilan kelsa — server uni yangi faylga o'zi bog'laydi. ffmpeg yo'q / xato → asl fayl qoladi, poster `null`.
- Sayt (bosh sahifa, Featured'dan keyin, `videos.length > 0` bo'lsa; keyingi bo'lim raqamlari bittaga suriladi):
  - vertikal 9:16 kartalar, gorizontal surish (mobil — swipe, `data-lenis-prevent-horizontal`; desktop — strelkalar), profil tugmasi
    `https://www.instagram.com/novacolor.uz/`. WebGL rasm qatlami ishlatilmaydi; har kadr JS yo'q (faqat IntersectionObserver va hodisalar).
  - `src`: `<video muted loop playsInline preload="none" poster>` (poster yo'q → `preload="metadata"` + `#t=0.1`), ≥ 50% ko'rinsa o'ynaydi,
    aks holda pauza; tab yashirilsa — hammasi pauza. Sifat darajasi ≤ 1 yoki `prefers-reduced-motion` → avtomatik o'ynamaydi (poster + ▶).
    Bosilganda — to'liq ekran pleyer (ovoz, `controls`, ←/→, Esc).
  - faqat `instagram`: kartaning ichida `https://www.instagram.com/p/<id>/embed/` iframe, Instagram interfeysi qirqilgan (o'lchangan:
    54px sarlavha, keyin to'liq kenglikdagi 4:5 media, ~154px pastki qism; 9:16 reel 4:5 ichida chetlari qora — shuning uchun iframe kengligi
    `kartaBalandligi / 1.25`, markazlashtirilgan, `top: -54px`). Iframe faqat karta ~1 ekran yaqinlashganda yaratiladi (gorizontal qatorda
    ham ±1 qator kengligi), bir vaqtda ≤ 3 ta; uzoqlashganlari olib tashlanadi. Undan oldin instagram.com'ga **bitta ham so'rov yo'q**.
    Iframe ostida poster/placeholder; 20 s ichida yuklanmasa — placeholder qoladi. Video bosilganda iframe ichida o'ynaydi
    (Instagram avtomatik o'ynatishga ruxsat bermaydi). Har karta ostida "Instagram'da ochish ↗".
  - Mahsulot sahifasi: `product` shu mahsulot bo'lgan videolar galereyadan keyin ("Videolar").

## Telegram

- **Rejimlar** (`telegram.mode`): `subscribers` — ariza **barcha faol obunachilarga** yuboriladi (vaqtinchalik rejim:
  egasi xohlagan "/start bosgan hammaga"); `single` — bitta chat: `TELEGRAM_CHAT_ID` (env, ustun) yoki admin panelda
  kiritilgan qiymat (`settings.json`). Tanlash: `TELEGRAM_MODE` (env) → admin panel → standart (chat ID bor → `single`,
  yo'q → `subscribers`; eski o'rnatishlar o'zgarmaydi).
- **Obunachilar** — `DATA_DIR/telegram-subscribers.json` (`0600`):
  `{ subscribers: [{ chatId, name, username?, type: 'private'|'group'|'supergroup', addedAt, source: 'start'|'manual', active, disabledBy?: 'admin'|'user'|'telegram' }], updateOffset? }`.
  Ko'pi bilan 100 ta (`/start` toshqini ro'yxatni cheksiz kattalashtirmasin; to'lsa yangi `/start` e'tiborsiz, logda ogohlantirish).
- **Yangilanishlarni olish** (`/start` va h.k.): server ishga tushganda va har 10 daqiqada `getWebhookInfo`.
  - Webhook **yo'q** → `getUpdates` long polling (`timeout: 25`, `allowed_updates: ['message','my_chat_member']`,
    `offset` faylda saqlanadi). 409 "webhook" → polling to'xtaydi, qayta tekshiriladi; boshqa 409 (ikkinchi nusxa) → 30 s kutish.
  - Webhook **boshqa saytga** (hozir @novacolorbot → `novacolor.uz`) → polling **yo'q**, logda bir marta o'zbekcha
    ogohlantirish, admin panelda sariq ogohlantirish (`updates.state = 'webhook'`, `webhookHost`). Obunachilar qo'lda qo'shiladi.
  - Webhook **shu serverga** (`…/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`) → `webhook-self`, yangilanishlar webhook orqali keladi.
  - Server **hech qachon** `deleteWebhook`/`setWebhook` chaqirmaydi.
- **Yangilanishni ishlash** (polling va webhook bir xil):
  - shaxsiy chatda `/start` (`/start payload`, `/start@bot` ham) → obunachi qo'shiladi/qayta yoqiladi (`source: 'start'`)
    va bitta javob: "Siz NovaColor arizalari xabarnomasiga obuna bo'ldingiz. Bekor qilish: /stop". Admin o'chirgan
    (`disabledBy: 'admin'`) obunachi `/start` bilan qayta yoqilmaydi va javob olmaydi. Ro'yxatdan **o'chirilgan** odam `/start` bossa qayta qo'shiladi.
  - `/stop` → `active: false, disabledBy: 'user'` + tasdiq javobi.
  - `my_chat_member`: bot guruh/superguruhga qo'shildi (`member`/`administrator`) → guruh obunachi; chiqarildi
    (`left`/`kicked`) → o'chadi; shaxsiy chatda `kicked` (botni bloklagan) → o'chadi. Guruhdagi `/start` va oddiy xabarlar hech narsa qilmaydi.
  - `migrate_to_chat_id` (guruh superguruhga aylandi) → obunachining ID'si yangilanadi.
- **Yuborish**: `sendMessage` (HTML parse_mode, matn **avval escape qilinadi, keyin** xavfsiz qisqartiriladi — `&amp;` o'rtasidan
  kesilmaydi; jami ≤ 4000 belgi). Har bir qabul qiluvchiga alohida, bir vaqtda ≤ 5 ta, ≤ 25 xabar/s; 429 → `retry_after`
  (≤ 10 s) dan keyin bir marta qayta. Obunachiga 403 (bloklagan / guruhdan chiqarilgan) yoki 400 "chat not found" →
  obunachi o'chadi (`disabledBy: 'telegram'`); boshqa xatolar o'chirmaydi. Lead `telegram`: kamida bittasiga yetdi → `'sent'`,
  hech kimga → `'failed'`. Soatiga 60 ta ariza xabari (bitta ariza = bitta hisob, qabul qiluvchilar soniga bog'liq emas);
  oshsa — `'failed'` (ariza admin panelda bor). Takror (10 daq ichida shu telefon) — qayta yuborilmaydi.
- **Xavfsizlik**: `subscribers` rejimida botga `/start` bosgan **har qanday** odam mijozlar telefonini oladi. Admin panelda
  ogohlantirish bor; keraksizlarini "Faol" tugmasi bilan o'chirish kerak (bu doimiy). Doimiy yechim — `single` rejimi + yopiq guruh.
- `single` rejimida yordam: "Aniqlash" tugmasi `GET /telegram/chats` orqali yozganlar ro'yxatini ko'rsatadi, admin o'zi
  tanlab saqlaydi; webhook bo'lsa 409 → Chat ID qo'lda (@userinfobot).
- Telegram sozlanmagan (token yo'q) → `telegram: 'skipped'`; token bor, lekin yuborib bo'lmadi (qabul qiluvchi yo'q, xato) → `'failed'`.
- Ariza xabari formati:
  ```
  🆕 Yangi ariza — Sayt formasi | AI yordamchi
  👤 Ism: …
  📞 Telefon: …
  🎨 Mahsulot: …
  💬 Xabar: …
  🔗 Admin: <PUBLIC_URL>/admin/leads?id=<lead id>
  ```

## Front-end integratsiya

- `vite.config.ts`: `base: process.env.VITE_BASE ?? '/novacolor/'`.
- `src/data/index.ts`: `loadRuntimeContent()` — `import.meta.env.VITE_API` bo'lsa `asset('api/content')`ni oladi
  (3 s timeout) va eksport qilingan massiv/obyektlarni **joyida** yangilaydi (`products.splice(...)`,
  `Object.assign(contacts, …)`, `featured` qayta hisoblanadi). `main.tsx` render qilishdan oldin kutadi; xato bo'lsa — build ichidagi kontent.
- `main.tsx`: yo'l `${BASE}admin` bilan boshlansa → `React.lazy(() => import('./admin/AdminApp'))` render qilinadi
  (sayt komponentlari, Lenis, WebGL, preloader yuklanmaydi).
- Aloqa formasi: `VITE_API` bo'lsa `POST asset('api/leads')`.
- AI chat: `src/components/AiChat.tsx` — `VITE_API` bo'lsa va `/api/health` → `ai: true` bo'lsa ko'rinadi.

## Admin panel UI

- Admin panel chat sahifasini (`page`) faqat shu saytdagi yo'l bo'lsa havola qiladi, aks holda oddiy matn.
- Yo'llar: `/admin` (kirish), `/admin/products`, `/admin/products/new`, `/admin/products/:slug`,
  `/admin/categories`, `/admin/documents`, `/admin/news`, `/admin/videos`, `/admin/leads`, `/admin/chats`, `/admin/settings` (aloqa ma'lumotlari, about, Telegram, AI holati).
- Til: o'zbekcha. Oddiy, toza, mobilga mos (telefondan boshqarish mumkin bo'lsin).
- Bosh sahifa (dashboard): yangi arizalar soni, mahsulotlar, hujjatlar, bugungi suhbatlar.
- Arizalar ro'yxati 30 s'da avtomatik yangilanadi. `/admin/leads?id=<id>` — o'sha arizaga aylantiradi va ajratib ko'rsatadi
  (suhbat sahifasidagi "Ariza qoldirilgan" tugmasi va Telegram xabaridagi havola shunday ochiladi).

## Ma'lumotlar fayllari

- `DATA_DIR` — `0700`; `settings.json` (sessiya siri), `leads.json`, `chats.json`, `telegram-subscribers.json` — `0600` (eski fayllar ishga tushishda
  tuzatiladi). Docker entrypoint papkani `node` foydalanuvchisiga beradi.
- `chats.json` har xabarda yoziladi: bir vaqtda kelgan saqlashlar bitta yozuvga birlashtiriladi (atomik `tmp → rename`
  saqlanadi, har `save()` o'z o'zgarishi diskka tushgach qaytadi).
