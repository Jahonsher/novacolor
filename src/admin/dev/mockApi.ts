/**
 * DEV-ONLY in-browser mock of the admin API (docs/backend-spec.md).
 * Enabled with `localStorage.ncMock = '1'` in `npm run dev`; api.ts imports it dynamically behind
 * `import.meta.env.DEV`, so it is not part of production builds.
 * State lives in sessionStorage (survives reloads of the tab). Password: `novacolor`.
 */
import seed from '../../data/content.json'
import type { AdminDoc, ChatSession, Content, Lead, Stats } from '../api'

type DB = { content: Content; leads: Lead[]; chats: ChatSession[]; chatId: string | null }

const KEY = 'ncMockDb'
const AUTH = 'ncMockAuth'

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString()

function initial(): DB {
  const content = structuredClone(seed) as unknown as Content
  const chats: ChatSession[] = [
    {
      id: 'c-1001',
      createdAt: iso(42),
      updatedAt: iso(35),
      lang: 'uz',
      page: '/products/africa',
      leadId: 'l-1',
      messages: [
        { role: 'user', content: 'Salom! Mehmonxonaga metall effektli qoplama kerak edi', at: iso(42) },
        {
          role: 'assistant',
          content:
            'Assalomu alaykum! Mehmonxona uchun Africa yoki Velvet Gold mos keladi — ikkalasi ham yumshoq metall jilosi bilan. Africa baxmalsimon teksturaga ega: /products/africa',
          at: iso(41),
        },
        { role: 'user', content: 'Narxi qancha? 40 kv metr', at: iso(38) },
        {
          role: 'assistant',
          content: 'Narxlar menejer orqali aniqlanadi. Ismingiz va telefon raqamingizni qoldirsangiz, menejer bog‘lanadi.',
          at: iso(38),
        },
        { role: 'user', content: 'Aziz, +998 90 123 45 67', at: iso(35) },
        { role: 'assistant', content: 'Rahmat, Aziz! Menejer tez orada qo‘ng‘iroq qiladi.', at: iso(35) },
      ],
    },
    {
      id: 'c-1002',
      createdAt: iso(60 * 5),
      updatedAt: iso(60 * 5 - 3),
      lang: 'ru',
      page: '/',
      messages: [
        { role: 'user', content: 'Здравствуйте, есть ли покрытие для фасада?', at: iso(60 * 5) },
        {
          role: 'assistant',
          content: 'Здравствуйте! Для фасадов подойдут покрытия из категории «Фасадные». Хотите, подскажу варианты под ваш стиль?',
          at: iso(60 * 5 - 1),
        },
        { role: 'user', content: 'Спасибо, пока смотрю', at: iso(60 * 5 - 3) },
      ],
    },
    {
      id: 'c-1003',
      createdAt: iso(60 * 26),
      updatedAt: iso(60 * 26 - 4),
      lang: 'ru',
      page: '/products',
      leadId: 'l-4',
      messages: [
        { role: 'user', content: 'Нужна венецианская штукатурка для гостиной', at: iso(60 * 26) },
        { role: 'assistant', content: 'Отличный выбор! Посмотрите Valpaint Stucco — классика с глубиной и блеском.', at: iso(60 * 26 - 2) },
        { role: 'user', content: '998977776655 перезвоните', at: iso(60 * 26 - 4) },
        { role: 'assistant', content: 'Спасибо! Менеджер свяжется с вами в ближайшее время.', at: iso(60 * 26 - 4) },
      ],
    },
  ]
  const leads: Lead[] = [
    { id: 'l-1', createdAt: iso(35), source: 'ai', name: 'Aziz', phone: '+998 90 123 45 67', product: 'Africa', message: 'Mehmonxonaga metall effektli qoplama, 40 kv m', chatId: 'c-1001', status: 'new', telegram: 'sent' },
    { id: 'l-2', createdAt: iso(90), source: 'contact', name: 'Dilnoza Karimova', phone: '+998 (93) 555-12-34', product: 'Mi-Ku Therm', message: 'Kvartira uchun maslahat kerak. Qachon showroomga kelsam bo‘ladi?', status: 'new', telegram: 'failed' },
    { id: 'l-3', createdAt: iso(60 * 7), source: 'contact', name: 'Rustam', phone: '+998 97 000 11 22', status: 'in_progress', note: 'Qo‘ng‘iroq qilindi, shanba kuni keladi', telegram: 'sent' },
    { id: 'l-4', createdAt: iso(60 * 26 - 4), source: 'ai', name: '', phone: '998977776655', message: 'Венецианская штукатурка для гостиной', chatId: 'c-1003', status: 'done', telegram: 'sent' },
    { id: 'l-5', createdAt: iso(60 * 50), source: 'contact', name: 'Елена', phone: '+998 71 200 30 40', product: 'Velvet', message: 'Сколько стоит доставка?', status: 'done', telegram: 'skipped' },
  ]
  return { content: withCounts(content), leads, chats, chatId: null }
}

function withCounts(c: Content): Content {
  c.categories = c.categories.map((cat) => ({ ...cat, count: c.products.filter((p) => p.categories.includes(cat.id)).length }))
  return c
}

let db: DB = (() => {
  try {
    const s = sessionStorage.getItem(KEY)
    if (s) return JSON.parse(s) as DB
  } catch {
    /* ignore */
  }
  return initial()
})()
const persist = () => sessionStorage.setItem(KEY, JSON.stringify(db))
// handy from the console: window.ncMockReset()
;(window as unknown as { ncMockReset: () => void }).ncMockReset = () => {
  sessionStorage.removeItem(KEY)
  db = initial()
}

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const err = (status: number, error: string) => json(status, { error })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const nextId = (xs: { id: number }[]) => xs.reduce((m, x) => Math.max(m, x.id), 0) + 1

export async function handle(url: string, init: RequestInit): Promise<Response> {
  await sleep(180 + Math.random() * 220)
  const method = (init.method ?? 'GET').toUpperCase()
  const path = decodeURI(new URL(url, location.origin).pathname.replace(/^.*?\/api\//, ''))
  const body: unknown =
    init.body instanceof FormData ? init.body : typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined
  const b = body as Record<string, unknown>
  const seg = path.split('/') // ['admin', 'products', 'slug']
  const c = db.content

  if (path === 'admin/login' && method === 'POST') {
    if (b?.password !== 'novacolor') return err(401, 'Parol noto‘g‘ri')
    sessionStorage.setItem(AUTH, '1')
    return json(200, { ok: true })
  }
  if (sessionStorage.getItem(AUTH) !== '1') return err(401, 'Avval tizimga kiring')

  const res = route()
  if (method !== 'GET') persist()
  return res

  function route(): Response {
    const [, r, idRaw] = seg
    const id = idRaw ? decodeURIComponent(idRaw) : undefined

    if (r === 'logout') {
      sessionStorage.removeItem(AUTH)
      return json(200, { ok: true })
    }
    if (r === 'me') return json(200, { ok: true })
    if (r === 'content') return json(200, withCounts(c))
    if (r === 'stats') {
      const today = new Date().toDateString()
      const s: Stats = {
        products: c.products.length,
        documents: c.documents.length,
        leadsNew: db.leads.filter((l) => l.status === 'new').length,
        leadsTotal: db.leads.length,
        chatsToday: db.chats.filter((x) => new Date(x.updatedAt).toDateString() === today).length,
      }
      return json(200, s)
    }

    if (r === 'products') {
      const p = b as unknown as Content['products'][number]
      if (method === 'POST' || method === 'PUT') {
        if (!p.name || !SLUG.test(p.slug)) return err(400, 'Nomi yoki slug noto‘g‘ri')
        if (c.products.some((x) => x.slug === p.slug && x.slug !== id)) return err(409, 'Bu slug band')
      }
      if (method === 'POST') {
        const np = { ...p, id: nextId(c.products) }
        c.products.push(np)
        return json(201, np)
      }
      const i = c.products.findIndex((x) => x.slug === id)
      if (i < 0) return err(404, 'Mahsulot topilmadi')
      if (method === 'PUT') {
        const old = c.products[i]
        c.products[i] = { ...p, id: old.id }
        if (old.slug !== p.slug) {
          c.documents.forEach((d) => (d.products = d.products.map((s) => (s === old.slug ? p.slug : s))))
          c.news.forEach((n) => n.product === old.slug && (n.product = p.slug))
        }
        return json(200, c.products[i])
      }
      if (method === 'DELETE') {
        const [old] = c.products.splice(i, 1)
        c.documents.forEach((d) => (d.products = d.products.filter((s) => s !== old.slug)))
        c.news.forEach((n) => n.product === old.slug && (n.product = null))
        return json(200, { ok: true })
      }
    }
    if (r === 'products-order' && method === 'PUT') {
      const slugs = b.slugs as string[]
      c.products.sort((x, y) => slugs.indexOf(x.slug) - slugs.indexOf(y.slug))
      return json(200, { ok: true })
    }

    if (r === 'categories') {
      const cat = b as { name: { uz: string; ru: string }; image: string }
      if (method === 'POST') {
        const nc = { id: nextId(c.categories), name: cat.name, image: cat.image, count: 0 }
        c.categories.push(nc)
        return json(201, nc)
      }
      const i = c.categories.findIndex((x) => x.id === Number(id))
      if (i < 0) return err(404, 'Kategoriya topilmadi')
      if (method === 'PUT') {
        c.categories[i] = { ...c.categories[i], name: cat.name, image: cat.image }
        return json(200, c.categories[i])
      }
      if (method === 'DELETE') {
        if (c.products.some((p) => p.categories.includes(Number(id))))
          return err(409, 'Bu kategoriya mahsulotlarda ishlatilmoqda')
        c.categories.splice(i, 1)
        return json(200, { ok: true })
      }
    }

    if (r === 'news') {
      if (method === 'POST') {
        const n = { ...(b as object), id: nextId(c.news) } as Content['news'][number]
        c.news.unshift(n)
        return json(201, n)
      }
      const i = c.news.findIndex((x) => x.id === Number(id))
      if (i < 0) return err(404, 'Yangilik topilmadi')
      if (method === 'PUT') {
        c.news[i] = { ...(b as object), id: c.news[i].id } as Content['news'][number]
        return json(200, c.news[i])
      }
      if (method === 'DELETE') {
        c.news.splice(i, 1)
        return json(200, { ok: true })
      }
    }

    if (r === 'contacts' && method === 'PUT') {
      c.contacts = b as Content['contacts']
      return json(200, c.contacts)
    }
    if (r === 'about' && method === 'PUT') {
      c.about = b as Content['about']
      return json(200, c.about)
    }

    if (r === 'upload' && id === 'image' && method === 'POST') {
      const f = (body as FormData).get('file') as File
      if (!f || !/^image\/(jpeg|png|webp)$/.test(f.type)) return err(400, 'Faqat JPG/PNG/WEBP')
      return json(200, { path: URL.createObjectURL(f), width: 1200, height: 900 })
    }

    if (r === 'documents') {
      if (method === 'POST') {
        const fd = body as FormData
        const f = fd.get('file') as File
        if (!f) return err(400, 'Fayl yo‘q')
        const name = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
        if (c.documents.some((d) => d.file === name)) return err(409, 'Bunday nomli fayl bor')
        const d: AdminDoc = {
          file: name,
          path: URL.createObjectURL(f),
          group: fd.get('group') as AdminDoc['group'],
          title: { uz: String(fd.get('title_uz')), ru: String(fd.get('title_ru')) },
          products: JSON.parse(String(fd.get('products') ?? '[]')),
          size: Math.round(f.size / 1024),
        }
        c.documents.push(d)
        return json(201, d)
      }
      const i = c.documents.findIndex((x) => x.file === id)
      if (i < 0) return err(404, 'Hujjat topilmadi')
      if (method === 'PUT') {
        const m = b as Pick<AdminDoc, 'title' | 'group' | 'products'>
        c.documents[i] = { ...c.documents[i], title: m.title, group: m.group, products: m.products }
        return json(200, c.documents[i])
      }
      if (method === 'DELETE') {
        c.documents.splice(i, 1)
        return json(200, { ok: true })
      }
    }

    if (r === 'leads') {
      if (method === 'GET') return json(200, [...db.leads].sort((x, y) => y.createdAt.localeCompare(x.createdAt)))
      const i = db.leads.findIndex((x) => x.id === id)
      if (i < 0) return err(404, 'Ariza topilmadi')
      if (method === 'PATCH') {
        db.leads[i] = { ...db.leads[i], ...(b as object) }
        return json(200, db.leads[i])
      }
      if (method === 'DELETE') {
        db.leads.splice(i, 1)
        return json(200, { ok: true })
      }
    }

    if (r === 'chats') {
      if (!id)
        return json(
          200,
          db.chats.map((x) => ({
            id: x.id,
            createdAt: x.createdAt,
            updatedAt: x.updatedAt,
            lang: x.lang,
            page: x.page ?? null,
            count: x.messages.length,
            preview: x.messages.find((m) => m.role === 'user')?.content.slice(0, 120) ?? '',
            leadId: x.leadId ?? null,
          })),
        )
      const chat = db.chats.find((x) => x.id === id)
      return chat ? json(200, chat) : err(404, 'Suhbat topilmadi')
    }

    if (r === 'settings' && id === 'telegram' && method === 'PUT') {
      const chatId = String((b as { chatId?: unknown })?.chatId ?? '').trim()
      if (chatId && !/^-?\d{3,20}$|^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chatId)) return err(400, 'chatId: Chat ID noto‘g‘ri')
      db.chatId = chatId || null
      return json(200, { configured: true, chatId: db.chatId, chatIdSource: db.chatId ? 'settings' : null, botUsername: 'novacolor_leads_bot' })
    }
    if (r === 'settings')
      return json(200, {
        telegram: { configured: true, chatId: db.chatId, chatIdSource: db.chatId ? 'settings' : null, botUsername: 'novacolor_leads_bot' },
        ai: { provider: 'free', model: 'openai', enabled: true },
      })
    if (r === 'telegram' && id === 'test' && method === 'POST') {
      if (!db.chatId) {
        db.chatId = '123456789'
        return json(200, { ok: true })
      }
      return json(200, { ok: true })
    }

    return err(404, `Mock: ${method} ${path} yo‘q`)
  }
}
