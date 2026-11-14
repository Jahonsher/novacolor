# NovaColor saytini serverga joylash (boshlovchilar uchun)

Bu qo'llanma saytni **admin panel**, **AI chat** va **Telegram xabarnomalar** bilan internetga
chiqarishni bosqichma-bosqich tushuntiradi. Hammasi bitta arzon serverda, Docker ichida ishlaydi.

> Qisqa yo'l: **1 GB RAM'li VPS (Ubuntu 24.04) → Docker → `.env` → `docker compose up -d --build` →
> domen → HTTPS.** Taxminan 30–60 daqiqa.

Mundarija:

1. [Hosting tanlash](#1-hosting-tanlash)
2. [Serverga ulanish (telefondan ham)](#2-serverga-ulanish)
3. [Serverni tayyorlash](#3-serverni-tayyorlash)
4. [Docker o'rnatish](#4-docker-ornatish)
5. [Kodni yuklab olish](#5-kodni-yuklab-olish)
6. [`.env` sozlamalari](#6-env-sozlamalari)
7. [Birinchi ishga tushirish (domensiz)](#7-birinchi-ishga-tushirish-domensiz)
8. [Domen va HTTPS](#8-domen-va-https)
9. [Yangilash, loglar, parolni almashtirish](#9-yangilash-loglar-parolni-almashtirish)
10. [Zaxira nusxa (backup) va tiklash](#10-zaxira-nusxa-backup-va-tiklash)
11. [Muammolar va yechimlar](#11-muammolar-va-yechimlar)
12. [GitHub Pages versiyasi](#12-github-pages-versiyasi)

---

## 1. Hosting tanlash

Sayt juda kam resurs ishlatadi (server ~30 MB RAM). **1 vCPU / 1 GB RAM / 20+ GB disk yetarli.**
Narxlar o'zgarib turadi — quyidagilar **taxminan**, to'lashdan oldin provayder saytida tekshiring.

| Variant | Narxi (taxminan) | Afzalligi | Kamchiligi |
|---|---|---|---|
| **Hetzner Cloud** (eng kichik tarif: CX22 yoki uning yangi nomi) — **tavsiya** | ~4–5 € / oy | Arzon, tez, ishonchli; Germaniya/Finlyandiya | Ro'yxatdan o'tishda pasport/karta tekshiruvi bo'lishi mumkin |
| **Contabo** | ~5–7 € / oy | Shu narxga ko'p RAM/disk | Sekinroq, ba'zan o'rnatish to'lovi; qo'llab-quvvatlash sust |
| **Timeweb Cloud** | ~300–500 ₽ / oy | Rubl/rus kartalari bilan to'lash oson; Qozog'iston (Olmaota) lokatsiyasi bor | **Rossiya** lokatsiyasidan Claude/OpenAI/Gemini API ishlamaydi — Qozog'iston yoki Yevropa lokatsiyasini tanlang |
| **Aeza** | ~4–6 € / oy | Arzon, Yevropa lokatsiyalari | Xuddi shunday: Rossiya lokatsiyasidan AI API'lar bloklangan |
| **DigitalOcean / Vultr** | ~5–6 $ / oy (1 GB) | Juda oson panel, yaxshi hujjatlar | Biroz qimmatroq; 4 $ tarif (512 MB) — kam |
| **Oracle Cloud Free** | bepul | Doimiy bepul ARM server | Ro'yxatdan o'tish ko'pincha rad etiladi, server "bo'sh" deb o'chirilishi mumkin |

**Bepul platformalar (Render / Railway / Fly.io)** — ehtiyot bo'ling:

- **Render free**: 15 daqiqa tashrif bo'lmasa "uxlaydi" (birinchi ochilish 30–60 soniya), va **diski vaqtinchalik** —
  har qayta ishga tushganda **yuklangan rasmlar, arizalar (leads), suhbatlar YO'QOLADI**. Doimiy disk faqat pullik tarifda.
- **Railway / Fly.io**: doimiy bepul tarif yo'q (sinov krediti yoki oyiga bir necha $). Ishlatsangiz, albatta
  **persistent volume** yarating va uni `/app/data` ga ulang, aks holda ma'lumotlar yo'qoladi.
  Bu platformalar `Dockerfile`ni o'zi topadi; `.env` qiymatlarini ularning panelida kiritasiz.

**Tavsiya (standart yo'l):** Hetzner Cloud'dagi eng kichik server, **Ubuntu 24.04**, lokatsiya —
Germaniya yoki Finlyandiya. Qo'shimcha 20% ga provayderning avtomatik "Backups" funksiyasini yoqish ham foydali.
Qolgan qo'llanma shu yo'l bo'yicha yozilgan (boshqa VPS'larda ham xuddi shunday).

> Muhim: AI (Claude, OpenAI, Gemini) so'rovlari **server joylashgan mamlakatdan** yuboriladi.
> Rossiyadagi serverdan ular ishlamaydi. Yevropa yoki Qozog'iston lokatsiyasini tanlang.

**Domen** (ixtiyoriy, lekin tavsiya etiladi): masalan `novacolor.uz` — mahalliy .uz registratorlaridan olinadi
(narxi registratorga bog'liq). Domensiz ham sayt `http://SERVER_IP:8080` manzilida ishlaydi, lekin HTTPS bo'lmaydi.

---

## 2. Serverga ulanish

Server yaratilgach, provayder sizga **IP manzil** (masalan `203.0.113.10`) va **root paroli** (yoki SSH kalit) beradi.

- **Telefondan:** **Termius** ilovasi (iOS/Android, bepul). "New host" → IP, foydalanuvchi `root`, parol → Connect.
- **Kompyuterdan (Windows/Mac/Linux):** terminalda:

```bash
ssh root@203.0.113.10
```

Quyidagi buyruqlarni nusxalab, terminalga qo'yib, Enter bosasiz.

---

## 3. Serverni tayyorlash

### 3.1 Yangilash

```bash
apt update && apt upgrade -y
```

### 3.2 Alohida foydalanuvchi yaratish

`root` bilan doimiy ishlash xavfli. `nova` nomli foydalanuvchi yarating (parol so'raydi — eslab qoling):

```bash
adduser nova
usermod -aG sudo nova
```

### 3.3 Swap (qo'shimcha "virtual xotira") — 1 GB RAM'li serverda albatta

Saytni yig'ish (build) ~700 MB xotira talab qiladi. Swap bo'lmasa, 1 GB serverda build to'xtab qolishi mumkin.

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

### 3.4 Firewall (ufw)

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 8080/tcp
ufw enable
```

`8080` — faqat domensiz sinov uchun. Domen ulanganidan keyin uni yopamiz (8-bo'lim).

> Eslatma: Docker o'zi ochgan portlar ufw'ni chetlab o'tadi. Shuning uchun 8-bo'limda `APP_BIND=127.0.0.1`
> qo'yamiz — shunda 8080 internetdan umuman ko'rinmaydi.

Endi `nova` foydalanuvchisi bilan qayta kiring:

```bash
exit
ssh nova@203.0.113.10
```

---

## 4. Docker o'rnatish

Rasmiy o'rnatish skripti:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker nova
```

Guruh o'zgarishi kuchga kirishi uchun **chiqib, qayta kiring** (`exit`, keyin yana `ssh nova@...`). Tekshirish:

```bash
docker version
docker compose version
```

---

## 5. Kodni yuklab olish

```bash
sudo apt install -y git
git clone https://github.com/Jahonsher/novacolor.git ~/novacolor
cd ~/novacolor
git checkout main
```

---

## 6. `.env` sozlamalari

Barcha sozlamalar va maxfiy kalitlar `.env` faylida turadi. Namunadan nusxa oling va tahrirlang:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

`nano`da: o'zgartiring → **Ctrl+O**, Enter (saqlash) → **Ctrl+X** (chiqish).
Qator boshidagi `#` — "izoh" degani; qiymat ishlashi uchun `#` ni olib tashlang.

### 6.1 Majburiy

```ini
ADMIN_PASSWORD=Uzun-va-Murakkab-Parol-2026
```

- Admin panel (`/admin`) paroli. **Kamida 8 belgi**, aks holda server ishga tushmaydi.
- Parolda **`$` belgisini ishlatmang** (Docker uni maxsus belgi deb tushunadi).
- Parolni almashtirsangiz, barcha qurilmalardagi admin sessiyalari avtomatik bekor bo'ladi (qayta kirish kerak).

### 6.2 Tavsiya etiladi

```ini
SESSION_SECRET=...
PUBLIC_URL=http://203.0.113.10:8080
```

- `SESSION_SECRET` — admin cookie imzosi. Tasodifiy qiymat yarating va natijani qo'ying:
  ```bash
  openssl rand -hex 32
  ```
  Bo'sh qoldirilsa, server o'zi yaratib `data/settings.json`ga saqlaydi (bu ham ishlaydi).
- `PUBLIC_URL` — saytning manzili; Telegram xabaridagi "Admin" havolasi uchun. Domen ulangandan keyin
  `https://novacolor.uz` ga almashtirasiz.

### 6.3 Telegram (arizalar botga kelishi uchun)

> **MUHIM:** kompaniyaning mavjud boti **@novacolorbot** jonli sayt **novacolor.uz** ga ulangan (unda **webhook** bor).
> Uning tokeni bilan **hech qachon** `deleteWebhook` / `setWebhook` chaqirmang va uni boshqa dasturga ulamang —
> novacolor.uz saytining boti ishlamay qoladi. Bu server ham ularni hech qachon chaqirmaydi.
> **Tavsiya:** arizalar uchun **alohida** bot yarating (quyidagicha) — 2 daqiqalik ish.

1. Telegram'da **@BotFather** → `/newbot` → bot nomi (masalan "NovaColor arizalar") va username'ini kiriting
   (masalan `novacolor_arizalar_bot`) → u **token** beradi (`123456789:AA...` ko'rinishida).
2. O'zingiz yaratgan botni oching va **Start** (`/start`) tugmasini bosing. **Bu shart** — bot sizga birinchi bo'lib yoza olmaydi.
   Arizalar guruhga kelishi kerak bo'lsa — botni guruhga qo'shing va guruhda biror xabar yozing.
3. `.env` ga faqat tokenni yozing:

```ini
TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

4. Serverni ishga tushirgach: admin panel → **Sozlamalar** → **Telegram bot** → **"Aniqlash"** tugmasi botga yaqinda
   yozgan chatlarni ko'rsatadi — o'zingiznikini tanlang va saqlang. (Bu faqat botda webhook **yo'q** bo'lsa ishlaydi —
   yangi bot uchun shunday.) Chat ID'ni qo'lda ham kiritsa bo'ladi: uni **@userinfobot** ga istalgan xabar yuborib bilasiz
   (`Id: 123456789`; guruh ID'si `-100…` bilan boshlanadi).
5. Sinash: o'sha yerda **"Sinov xabari yuborish"** tugmasi.

- `.env`da `TELEGRAM_CHAT_ID=...` yozsangiz, u admin paneldagidan **ustun** turadi (panelda o'zgartirib bo'lmaydi).

#### Arizalar kimga boradi: ikki rejim

Admin panel → **Sozlamalar** → **Telegram bot** → "Arizalar kimga yuboriladi":

- **Hamma obunachilarga** (vaqtinchalik rejim) — botga `/start` bosgan har bir kishi va bot qo'shilgan guruhlar arizani oladi.
  Ro'yxat — "Telegram obunachilari" kartasida: faollikni yoqish/o'chirish, o'chirish, **"Qo'lda qo'shish"** (Chat ID + ism).
  Obunachi botga `/stop` yozsa — o'zi chiqadi. Botni bloklagan odam keyingi yuborishda avtomatik o'chiriladi.
- **Bitta chat yoki guruhga** — faqat bitta Chat ID (yuqoridagi 4-qadam). Keyinchalik ish guruhiga o'tganda shuni tanlang.

> **Diqqat:** "Hamma obunachilarga" rejimida botga `/start` bosgan **har qanday** odam mijozlarning telefon raqamlarini oladi.
> Ro'yxatni tekshirib turing. Begona odamni **"Faol" tugmasi bilan o'chiring** — shunda u qayta `/start` bossa ham yoqilmaydi
> (ro'yxatdan butunlay o'chirilgan odam esa `/start` bilan qaytib qo'shiladi).

Rejimni `.env`da ham qat'iy belgilash mumkin (`TELEGRAM_MODE=subscribers` yoki `single`) — u paneldagidan ustun.

**/start bosganlar qanday qo'shiladi.** Server har 10 daqiqada botni tekshiradi (`getWebhookInfo`, faqat o'qish):

- botda **webhook yo'q** (alohida yangi bot) → server yangilanishlarni o'zi oladi, `/start` bosganlar **avtomatik** qo'shiladi
  (panelda yashil "Obunachilar avtomatik qo'shilmoqda");
- bot **boshqa saytga ulangan** (hozir **@novacolorbot** → **novacolor.uz**) → `/start` bosganlar bu serverga **kelmaydi**:
  panelda sariq ogohlantirish chiqadi. Bu holda obunachilarni **qo'lda qo'shing** (har bir odam @userinfobot dan o'z ID'sini
  bilib beradi; u @novacolorbot ga oldin `/start` bosgan bo'lishi shart).

**Botni shu serverga ulash (keyinroq, ixtiyoriy).** Faqat novacolor.uz endi bu botni ishlatmasligi aniq bo'lganda:

> ⚠️ **OGOHLANTIRISH:** quyidagi buyruq botni **novacolor.uz saytidan olib qo'yadi** — o'sha saytning boti darhol ishlamay qoladi.
> Telegram'da bitta botning faqat bitta webhook'i bo'ladi. Bu server buni hech qachon o'zi qilmaydi.

1. `.env`ga sir qo'shing va qayta ishga tushiring (`docker compose up -d`):
   ```ini
   TELEGRAM_WEBHOOK_SECRET=   # openssl rand -hex 32 natijasi
   ```
2. Serverda **bir marta** (HTTPS domen ishlayotgan bo'lishi kerak):
   ```bash
   source <(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)=' .env)
   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -d "url=https://SIZNING-DOMEN.uz/api/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}" \
     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     -d 'allowed_updates=["message","my_chat_member"]'
   ```
   Javob `{"ok":true,...}` bo'lsa — 10 daqiqa ichida (yoki serverni qayta ishga tushirganda) panelda yashil holat chiqadi.

### 6.4 AI yordamchi

`AI_PROVIDER` ni tanlang va kalitni qo'ying. Quyidagilardan **bittasini** yozing.

**Anthropic (Claude) — sifat bo'yicha eng yaxshisi:**

```ini
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Kalit: **platform.claude.com** (Anthropic Console) → API Keys. Oldindan balans to'ldiriladi.
Standart model — `claude-opus-5-5` (taxminan 4 $ / 1M kiruvchi token va 20 $ / 1M chiquvchi token).

**Ancha arzon variant:** `claude-haiku-5-5` — taxminan **0,10 $ / 0,50 $** (1M token uchun), ya'ni ~40 marta arzon.
Sayt maslahatchisi uchun odatda yetarli. Yoqish uchun `.env` ga qo'shing:

```ini
AI_MODEL=claude-haiku-5-5
```

(Server Haiku uchun so'rovni o'zi moslaydi: unda server tomonidagi "refusal fallback" yo'q, shuning uchun bu parametrlar
faqat Opus/Sonnet/Fable modellariga yuboriladi.)

**OpenAI:**

```ini
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

**Groq** (tez, cheklangan bepul tarifi bor):

```ini
AI_PROVIDER=openai
AI_API_KEY=gsk_...
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

**OpenRouter** (bitta kalit bilan ko'p modellar; `:free` bilan tugaydigan modellar bepul, lekin cheklangan):

```ini
AI_PROVIDER=openai
AI_API_KEY=sk-or-...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-4o-mini
```

**Google Gemini** (OpenAI-mos manzil; kalit: aistudio.google.com):

```ini
AI_PROVIDER=openai
AI_API_KEY=AIza...
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-2.5-flash
```

> Model nomlari vaqt o'tishi bilan o'zgaradi — provayder saytidagi joriy ro'yxatdan tekshiring.

- Hech qanday kalit yozilmasa — AI **o'chiq** (`off`): saytda chat tugmasi ko'rinmaydi, qolgan hammasi ishlaydi.
- `AI_PROVIDER=free` — kalitsiz, **faqat sinov uchun** va faqat aniq yozilganda yoqiladi: sekin, sifati past, ishonchsiz,
  mijoz xabarlari (telefon raqamlari bilan) uchinchi tomonga (pollinations.ai) ketadi. Haqiqiy saytda ishlatmang.
- `AI_PROVIDER=mock` — faqat avtomatik testlar uchun (tayyor javoblar). Docker'da (`NODE_ENV=production`) server u bilan
  ishga tushmaydi.
- `AI_PROVIDER=off` — AI chat butunlay o'chadi.

**Xarajat va spam cheklovlari** (standart qiymatlar odatda yetarli, o'zgartirish shart emas):

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `AI_DAILY_LIMIT` | `60` | bitta foydalanuvchi (IP; IPv6 — /64 tarmoq) kuniga nechta AI xabar yubora oladi |
| `AI_GLOBAL_DAILY_LIMIT` | `500` | **barcha** tashrifchilar uchun jami kunlik AI xabarlar. Oshsa, chat "telefon raqamingizni qoldiring / qo'ng'iroq qiling" deb javob beradi (AI chaqirilmaydi, pul ketmaydi; telefon qoldirilsa ariza baribir yaratiladi) |
| `LEADS_HOURLY_LIMIT` | `60` | soatiga jami yangi arizalar (spam himoyasi). Telegram xabarlari ham soatiga 60 tadan oshmaydi |

Bundan tashqari: bitta suhbatda 100 ta xabardan keyin AI qo'ng'iroq qilishni taklif qiladi; xuddi shu telefon 10 daqiqa
ichida qayta yuborilsa — yangi ariza ochilmaydi (mavjudi yangilanadi, Telegram'ga ikkinchi marta yuborilmaydi).

### 6.5 Boshqa sozlamalar

`PORT`, `HOST`, `DATA_DIR`, `STATIC_DIR`, `SEED_CONTENT` — **Docker'da o'zgartirmang** (konteyner ichida to'g'ri o'rnatilgan).
`TRUST_PROXY` — hozircha o'chiq qoldiring; 8-bo'limda yoqamiz. `TRUSTED_PROXIES` — odatda kerak emas (8.2 ga qarang).

---

## 7. Birinchi ishga tushirish (domensiz)

```bash
cd ~/novacolor
docker compose up -d --build
```

Birinchi marta 3–7 daqiqa davom etadi (sayt yig'iladi). Tekshirish:

```bash
docker compose ps
curl http://localhost:8080/api/health
```

`{"ok":true,...}` chiqsa — ishlayapti. `docker compose ps`da bir daqiqadan keyin `(healthy)` yozuvi chiqadi.

Brauzerda (telefondan ham) oching:

- Sayt: `http://203.0.113.10:8080`
- Admin panel: `http://203.0.113.10:8080/admin` → `ADMIN_PASSWORD` bilan kiring.

Barcha ma'lumotlar (kontent, yuklangan rasmlar/PDF, arizalar, suhbatlar) serverdagi **`~/novacolor/data/`**
papkasida saqlanadi. Konteynerni qayta yig'ish yoki o'chirish ularga ta'sir qilmaydi.

---

## 8. Domen va HTTPS

### 8.1 DNS

Domen registratori panelida **A-yozuv** qo'shing:

| Turi | Nomi (Host) | Qiymati |
|---|---|---|
| A | `@` | `203.0.113.10` (server IP) |
| A | `www` | `203.0.113.10` (ixtiyoriy) |

DNS yangilanishi 5 daqiqadan bir necha soatgacha davom etadi. Tekshirish: `ping novacolor.uz` IP'ni ko'rsatsa — tayyor.

> Cloudflare ishlatsangiz, yozuvni **"DNS only" (kulrang bulut)** qilib qo'ying, "Proxied" emas.

### 8.2 `.env` ga qo'shing

`nano .env` bilan **fayl oxiriga** qo'shing (domeningizni yozing):

```ini
# --- Domen / HTTPS ---
DOMAIN=novacolor.uz
COMPOSE_PROFILES=https
APP_BIND=127.0.0.1
TRUST_PROXY=1
PUBLIC_URL=https://novacolor.uz
```

Agar faylning yuqorisida `PUBLIC_URL=...` yoki `TRUST_PROXY=...` izohsiz qator bo'lsa, uni o'chiring (takrorlanmasin).

- `DOMAIN` — Caddy shu domen uchun Let's Encrypt sertifikatini **avtomatik** oladi va yangilab turadi.
- `COMPOSE_PROFILES=https` — endi oddiy `docker compose up -d` Caddy'ni ham ishga tushiradi.
- `APP_BIND=127.0.0.1` — 8080 port internetdan yopiladi, sayt faqat Caddy orqali (80/443) ochiladi.
- `TRUST_PROXY=1` — server mijozning haqiqiy IP'sini Caddy'dan oladi (login/AI cheklovlari to'g'ri ishlashi uchun).
  Caddy'siz (8080 to'g'ridan-to'g'ri ochiq bo'lsa) buni **yoqmang**.

Qanday ishlaydi (dasturchi uchun): `X-Forwarded-For` sarlavhasiga faqat so'rov **ishonchli proxy**dan kelganda ishoniladi
(`TRUSTED_PROXIES`, standart: loopback + xususiy tarmoqlar `10/8`, `172.16/12`, `192.168/16`, `fc00::/7` — Caddy
konteyneri compose tarmog'idan, `172.x` manzildan ulanadi) va **eng o'ngdagi** yozuv olinadi (uni Caddy qo'shadi;
chapdagilarni mijoz o'zi yozgan bo'lishi mumkin). Shuning uchun soxta `X-Forwarded-For` bilan cheklovlarni chetlab bo'lmaydi.
Konteyner ichida server `0.0.0.0` da tinglaydi (compose belgilaydi), tashqariga esa faqat `APP_BIND=127.0.0.1:8080` ochiq.
Docker'siz (systemd + shu serverdagi nginx) `TRUST_PROXY=1` bo'lsa, server standart bo'yicha `127.0.0.1` da tinglaydi.
CDN (masalan Cloudflare "Proxied") ortida ishlatmang — u holda mijoz IP'si emas, CDN IP'si sanaladi.

### 8.3 Ishga tushirish

```bash
docker compose --profile https up -d --build
sudo ufw delete allow 8080/tcp
```

Bir daqiqadan keyin `https://novacolor.uz` va `https://novacolor.uz/admin` ochiladi (yashil qulf bilan).
Caddy HTTPS'ni majburiy qiladi (HSTS, 1 yil) va 32 MB dan katta so'rovlarni serverga o'tkazmaydi.
Sertifikat olinmasa: `docker compose logs caddy` (odatda DNS hali yangilanmagan yoki 80/443 port yopiq).

`www.novacolor.uz` ham ishlashi kerak bo'lsa: `Caddyfile`dagi `www` blokidan `#` larni olib tashlang va
`docker compose restart caddy`.

---

## 9. Yangilash, loglar, parolni almashtirish

### Yangi versiyani o'rnatish

Dasturchi GitHub'ga yangi kod yuklaganda:

```bash
cd ~/novacolor
./deploy/update.sh
```

Bu skript: zaxira nusxa oladi → `git pull` → `docker compose up -d --build` → eski image'larni tozalaydi.
Qo'lda xuddi shu:

```bash
cd ~/novacolor
git pull
docker compose up -d --build
```

Ma'lumotlar (`data/`) saqlanib qoladi.

### Loglarni ko'rish

```bash
docker compose logs -f app          # jonli (chiqish: Ctrl+C)
docker compose logs --tail 100 app  # oxirgi 100 qator
docker compose logs caddy           # HTTPS / sertifikat
docker compose ps                   # holat
```

### Qayta ishga tushirish / to'xtatish

```bash
docker compose restart app
docker compose down        # to'xtatish (ma'lumotlar saqlanadi)
docker compose up -d       # yana ishga tushirish
```

### Admin parolini almashtirish

```bash
cd ~/novacolor
nano .env                  # ADMIN_PASSWORD=yangi-parol
docker compose up -d       # yangi sozlama bilan qayta yaratadi
```

Parol almashgach, allaqachon kirgan barcha qurilmalar avtomatik chiqib ketadi (yangi parol bilan qayta kiriladi).
Admin paneldagi **"Chiqish"** tugmasi ham **barcha qurilmalardan** chiqaradi (masalan, telefon yo'qolsa — kompyuterdan
kirib "Chiqish" bosing va parolni almashtiring).

---

## 10. Zaxira nusxa (backup) va tiklash

Eng muhim narsa — **`data/`** papkasi (kontent, rasmlar, PDF, arizalar, suhbatlar, sozlamalar).
Kod GitHub'da turadi, `data/` esa faqat serverda.

> Server har bir kontent o'zgarishida `data/backups/` ga `content.json`ning oxirgi 30 nusxasini o'zi saqlaydi.
> Lekin bu server diski buzilsa yordam bermaydi — quyidagi to'liq zaxirani ham qiling.

### Qo'lda zaxira

```bash
cd ~/novacolor
./deploy/backup.sh
```

Natija: `~/novacolor-backups/novacolor-data-YYYYMMDD-HHMM.tar.gz`. Oxirgi 14 tasi saqlanadi, eskilari o'chadi.

`data/` papkasi maxfiy (faqat egasi o'qiy oladi: papka `700`, `settings.json`/`leads.json`/`chats.json`/`telegram-subscribers.json` — `600`).
Egasi — konteynerdagi `node` foydalanuvchisi (uid 1000; odatda serverdagi birinchi foydalanuvchi, masalan `nova`, ham
uid 1000). `Permission denied` chiqsa, `id -u` ni tekshiring yoki zaxirani `sudo ./deploy/backup.sh` bilan oling
(cron'da ham — `sudo crontab -e`).

### Har kuni avtomatik (cron)

Avval bir marta qo'lda ishga tushiring (papka yaratiladi), keyin:

```bash
crontab -e
```

Fayl oxiriga qo'shing (har kuni soat 03:30 da):

```
30 3 * * * /home/nova/novacolor/deploy/backup.sh >> /home/nova/novacolor-backups/backup.log 2>&1
```

### Zaxirani o'z kompyuteringiz/telefoningizga yuklab olish

Zaxira faqat serverda tursa, server bilan birga yo'qolishi mumkin. Haftada bir marta yuklab oling:

- **Kompyuterdan:**
  ```bash
  scp nova@203.0.113.10:~/novacolor-backups/novacolor-data-*.tar.gz .
  ```
- **Telefondan:** Termius → host → **SFTP** → `novacolor-backups` papkasi → faylni yuklab oling.

Zaxirada maxfiy ma'lumotlar bor (`settings.json`, mijoz telefonlari) — uni boshqalarga bermang.

### Zaxiradan tiklash

```bash
cd ~/novacolor
docker compose stop app
mv data data.eski-$(date +%F)
tar -xzf ~/novacolor-backups/novacolor-data-20261114-0330.tar.gz
docker compose start app
```

(Fayl nomini o'zingizdagisiga almashtiring.) Hammasi joyida bo'lsa, keyinroq `data.eski-...` ni o'chirishingiz mumkin.
Yangi serverga ko'chishda ham xuddi shunday: 3–7 bo'limlarni bajaring, zaxirani `~/novacolor` ichida oching, `docker compose up -d`.

---

## 11. Muammolar va yechimlar

**Server ishga tushmayapti / sayt ochilmayapti**

```bash
docker compose ps
docker compose logs --tail 50 app
```

- `XATO: ADMIN_PASSWORD o'rnatilmagan` yoki `juda qisqa` → `.env`da parolni tekshiring (kamida 8 belgi), `docker compose up -d`.
- `env file .env not found` → `.env` yaratilmagan: `cp .env.example .env`.

**Port band (`port is already allocated` / `address already in use`)**

```bash
sudo ss -ltnp | grep -E ':80 |:443 |:8080 '
```

Ba'zi serverlarda nginx yoki apache oldindan o'rnatilgan bo'ladi: `sudo systemctl disable --now nginx apache2`.
Yoki `.env`ga `APP_PORT=8081` yozib, boshqa portdan foydalaning.

**Build xotira yetmay to'xtadi (`Killed`, `exit code: 137`)** → 3.3-bo'limdagi swap'ni yoqing va qayta urinib ko'ring.

**Rasm yuklashda xato / `sharp` xatolari**

- `Could not load the "sharp" module` → `docker compose build --no-cache && docker compose up -d`.
- `Unsupported CPU` / `requires v2 microarchitecture` → server protsessori juda eski yoki virtual CPU turi cheklangan.
  Provayder panelida boshqa CPU turini tanlang yoki boshqa tarif/provayderga o'ting.
- "Faqat JPG, PNG yoki WEBP" → boshqa formatdagi rasm (HEIC, GIF). Telefonda rasmni JPG qilib saqlang.
- Rasm hajmi — 15 MB gacha, PDF — 30 MB gacha.

**Telegram'ga xabar kelmayapti**

1. Admin panel → Sozlamalar → "Sinov xabari yuborish" — xato sababi shu yerda ko'rinadi.
2. Botda **Start** bosilmagan → botni oching, `/start` yozing.
3. `TELEGRAM_CHAT_ID` noto'g'ri → @userinfobot'dan qayta tekshiring. Guruhga yuborish kerak bo'lsa, botni guruhga
   qo'shing; guruh ID'si minus bilan boshlanadi (`-100...`).
4. Token noto'g'ri (`401 Unauthorized`) → @BotFather'dan tokenni qayta nusxalang.
5. "Aniqlash"da `webhook yoqilgan` / `409 Conflict` → bot boshqa dasturga (webhook bilan) ulangan, masalan
   **@novacolorbot** — u novacolor.uz saytiniki. **`deleteWebhook` ni chaqirmang** (o'sha sayt boti buziladi).
   Yechim: 6.3-bo'limdagidek **alohida bot** yarating; yoki Chat ID'ni qo'lda kiriting (yuborish webhook bilan ham ishlaydi).
   "Hamma obunachilarga" rejimida ham shunday: obunachilarni qo'lda qo'shing (6.3, "Arizalar kimga boradi").
6. Bir soatda 60 tadan ko'p ariza kelsa (spam), qolganlari Telegram'ga yuborilmaydi ("Telegram: xato") — ular admin
   panelda bor.
7. `.env`ni o'zgartirgandan keyin: `docker compose up -d`.

**AI chat javob bermayapti**

- **429** "limit" → foydalanuvchi kunlik limitga yetdi (`AI_DAILY_LIMIT`) yoki provayderda limit/balans tugadi.
  Provayder panelida balansni tekshiring.
- Chat "AI yordamchi bugun juda band… telefon qoldiring" deyapti → jami kunlik limit (`AI_GLOBAL_DAILY_LIMIT`, standart 500)
  tugadi; ertaga tiklanadi yoki limitni oshiring (logda `umumiy kunlik limit`).
- `400` / `model` xatosi logda → `AI_MODEL` nomini tekshiring (masalan `claude-opus-5-5`, `claude-haiku-5-5`).
- **503** → AI o'chiq (`AI_PROVIDER=off`), kalit noto'g'ri yoki provayder vaqtincha ishlamayapti.
  Sabab logda: `docker compose logs app | grep -i ai`.
- Kalit to'g'ri, lekin baribir ishlamayapti → server joylashgan mamlakat provayder tomonidan bloklangan bo'lishi mumkin
  (masalan, Rossiya). 1-bo'limga qarang.
- Saytda chat tugmasi umuman yo'q → `curl http://localhost:8080/api/health` da `"ai":false` — AI sozlanmagan.

**Disk to'ldi**

```bash
df -h
du -sh ~/novacolor/data/* ~/novacolor-backups
docker system df
docker image prune -af          # eski image'lar (xavfsiz)
docker builder prune -af        # build keshi (xavfsiz)
sudo journalctl --vacuum-size=200M
```

`docker volume prune` ni **ishlatmang** — HTTPS sertifikatlari saqlanadigan volume o'chib ketishi mumkin.
Konteyner loglari avtomatik cheklangan (10 MB × 3).

**HTTPS ishlamayapti** → DNS A-yozuvi serverga ko'rsatyaptimi (`ping domen`), 80 va 443 portlar ochiqmi (`sudo ufw status`),
`.env`da `DOMAIN` to'g'rimi. Keyin `docker compose logs caddy`.

---

## 12. GitHub Pages versiyasi

Eski statik versiya (`npm run deploy` → https://jahonsher.github.io/novacolor/) avvalgidek ishlayveradi —
lekin u faqat **ko'rgazma**: admin panel, AI chat va Telegram'siz, kontent esa koddagi `src/data/content.json`dan olinadi.
Admin paneldagi o'zgarishlar faqat serverdagi saytda ko'rinadi.

---

### Texnik ma'lumot (dasturchi uchun)

- `Dockerfile` — multi-stage (`node:22-alpine`): build bosqichi `npm ci` + `npm run build:site` + `npm run server:build`;
  runtime'da faqat production bog'liqliklar, `dist/`, `server-dist/`, seed `src/data/content.json`.
  Jarayon `node` (uid 1000) foydalanuvchisi nomidan ishlaydi; entrypoint (`deploy/docker-entrypoint.sh`) faqat
  `/app/data` egasini to'g'rilash uchun root'dan boshlanadi. `HEALTHCHECK` → `/api/health`.
- `docker-compose.yml` — `app` (8080, `./data:/app/data`, ichida `HOST=0.0.0.0`) + `caddy` (profil `https`, 80/443, `Caddyfile`).
  `${DOMAIN}`, `${APP_BIND}`, `${APP_PORT}`, `COMPOSE_PROFILES` — `.env`dan olinadi.
- Runtime image'da faqat server bog'liqliklari (`hono`, `@hono/node-server`, `zod`, `sharp`, `@anthropic-ai/sdk`);
  React/three.js/GSAP va h.k. — `devDependencies` (faqat sayt build'ida kerak).
- Himoya: so'rov tanasi cheklovlari (16 KB / 1 MB / yuklashlar), login urinishlari parol tekshirilishidan oldin sanaladi,
  admin so'rovlarida `Origin` tekshiruvi, `X-Frame-Options`/CSP `frame-ancestors`, `nosniff`; batafsil — `docs/backend-spec.md`.
- Node versiyasini almashtirish: `docker compose build --build-arg NODE_VERSION=24`.
