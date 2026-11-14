/**
 * Typed client for the admin API (see docs/backend-spec.md).
 * All requests go to `${BASE_URL}api/...` with the session cookie.
 * In dev, `localStorage.ncMock = '1'` routes requests to an in-browser mock (src/admin/dev/mockApi.ts).
 */
import type { Category, Doc, DocGroup, Localized, NewsItem, Product } from '../data'

export type { Category, DocGroup, Localized, NewsItem, Product }

/** Uploaded PDFs carry their full relative path; bundled ones only have `file`. */
export type AdminDoc = Doc & { path?: string }

export type Contacts = {
  phone: string
  phoneHref: string
  email: string
  address: Localized
  telegram: string
  instagram: string
  map: string
}
export type About = { lead: Localized; extra: Localized }

export type Content = {
  products: Product[]
  categories: Category[]
  news: NewsItem[]
  stats: { id: number; value: number; label: Localized }[]
  about: About
  contacts: Contacts
  clients: string[]
  documents: AdminDoc[]
}

export type LeadStatus = 'new' | 'in_progress' | 'done'
export type Lead = {
  id: string
  createdAt: string
  source: 'contact' | 'ai'
  name: string
  phone: string
  product?: string
  message?: string
  chatId?: string
  status: LeadStatus
  note?: string
  telegram: 'sent' | 'failed' | 'skipped'
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string; at: string }
export type ChatSession = {
  id: string
  createdAt: string
  updatedAt: string
  lang: 'uz' | 'ru'
  page?: string
  messages: ChatMessage[]
  leadId?: string
}
export type ChatSummary = {
  id: string
  createdAt: string
  updatedAt: string
  lang: 'uz' | 'ru'
  page: string | null
  count: number
  preview: string
  leadId: string | null
}

export type TelegramMode = 'subscribers' | 'single'
/**
 * How /start updates reach the server: `polling` / `webhook-self` — subscribers are added automatically;
 * `webhook` — the bot is connected to another site (`webhookHost`), /start never reaches us.
 */
export type TelegramUpdates = {
  state: 'off' | 'checking' | 'polling' | 'webhook' | 'webhook-self' | 'error'
  webhookHost: string | null
  checkedAt: string | null
  error: string | null
}
export type TelegramSettings = {
  configured: boolean
  /** `subscribers` — every active subscriber; `single` — one chat (chatId) */
  mode: TelegramMode
  /** `env` = TELEGRAM_MODE in .env (read-only here) */
  modeSource: 'env' | 'settings' | 'default'
  chatId: string | null
  /** `env` = TELEGRAM_CHAT_ID in .env (wins, read-only here); `settings` = saved from the admin panel */
  chatIdSource?: 'env' | 'settings' | null
  botUsername: string | null
  subscribers: { active: number; total: number }
  updates: TelegramUpdates
  webhookReceiver: boolean
}
export type TelegramSubscriber = {
  chatId: string
  name: string
  username?: string
  type: 'private' | 'group' | 'supergroup'
  addedAt: string
  source: 'start' | 'manual'
  active: boolean
  disabledBy?: 'admin' | 'user' | 'telegram'
}
export type TelegramSubscribers = { subscribers: TelegramSubscriber[]; max: number; updates: TelegramUpdates }
export type TelegramTestResult = {
  ok: boolean
  error?: string
  total?: number
  sent?: number
  failed?: number
  results?: { chatId: string; name?: string; ok: boolean; error?: string; deactivated?: boolean }[]
}
export type TelegramChat = { id: string; type: string; name: string | null; username: string | null }
export type AdminSettings = {
  telegram: TelegramSettings
  ai: { provider: string; model: string; enabled: boolean }
}

export type Stats = {
  products: number
  documents: number
  leadsNew: number
  leadsTotal: number
  chatsToday: number
}

export type ProductInput = Omit<Product, 'id'> & { id?: number }
export type CategoryInput = { name: Localized; image: string }
export type NewsInput = Omit<NewsItem, 'id'>
export type DocMeta = { title: Localized; group: DocGroup; products: string[] }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const BASE = `${import.meta.env.BASE_URL}api/`

type Handler = (url: string, init: RequestInit) => Promise<Response>
let mock: Promise<Handler> | null = null
if (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('ncMock') === '1') {
  mock = import('./dev/mockApi').then((m) => m.handle)
}
export const usingMock = () => mock !== null

let onUnauthorized: (() => void) | null = null
/** Called on any 401 (except login / me) — the app redirects to the login page. */
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  } else if (method !== 'GET') {
    // mutating requests must be JSON or multipart (CSRF guard on the server)
    init.body = '{}'
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const url = BASE + path
  let res: Response
  try {
    res = mock ? await (await mock)(url, init) : await fetch(url, init)
  } catch {
    throw new ApiError(0, "Server bilan aloqa yo'q. Internetni tekshiring.")
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    if (res.status === 401 && path !== 'admin/login' && path !== 'admin/me') onUnauthorized?.()
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : res.status === 401
          ? 'Avval tizimga kiring'
          : res.status === 413
            ? 'Fayl juda katta'
            : `Xatolik (${res.status})`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

const enc = encodeURIComponent

export const api = {
  // auth
  login: (password: string) => request<{ ok: true }>('POST', 'admin/login', { password }),
  logout: () => request<{ ok: true }>('POST', 'admin/logout'),
  me: () => request<{ ok: true }>('GET', 'admin/me'),

  content: () => request<Content>('GET', 'admin/content'),
  stats: () => request<Stats>('GET', 'admin/stats'),

  // products
  createProduct: (p: ProductInput) => request<Product>('POST', 'admin/products', p),
  updateProduct: (slug: string, p: ProductInput) => request<Product>('PUT', `admin/products/${enc(slug)}`, p),
  deleteProduct: (slug: string) => request<{ ok: true }>('DELETE', `admin/products/${enc(slug)}`),
  orderProducts: (slugs: string[]) => request<{ ok: true }>('PUT', 'admin/products-order', { slugs }),

  // categories
  createCategory: (c: CategoryInput) => request<Category>('POST', 'admin/categories', c),
  updateCategory: (id: number, c: CategoryInput) => request<Category>('PUT', `admin/categories/${id}`, c),
  deleteCategory: (id: number) => request<{ ok: true }>('DELETE', `admin/categories/${id}`),

  // news
  createNews: (n: NewsInput) => request<NewsItem>('POST', 'admin/news', n),
  updateNews: (id: number, n: NewsInput) => request<NewsItem>('PUT', `admin/news/${id}`, n),
  deleteNews: (id: number) => request<{ ok: true }>('DELETE', `admin/news/${id}`),

  // site texts
  updateContacts: (c: Contacts) => request<Contacts>('PUT', 'admin/contacts', c),
  updateAbout: (a: About) => request<About>('PUT', 'admin/about', a),

  // uploads
  uploadImage: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ path: string; width: number; height: number }>('POST', 'admin/upload/image', fd)
  },

  // documents
  createDocument: (file: File, meta: DocMeta) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title_uz', meta.title.uz)
    fd.append('title_ru', meta.title.ru)
    fd.append('group', meta.group)
    fd.append('products', JSON.stringify(meta.products))
    return request<AdminDoc>('POST', 'admin/documents', fd)
  },
  updateDocument: (file: string, meta: DocMeta) => request<AdminDoc>('PUT', `admin/documents/${enc(file)}`, meta),
  deleteDocument: (file: string) => request<{ ok: true }>('DELETE', `admin/documents/${enc(file)}`),

  // leads
  leads: () => request<Lead[]>('GET', 'admin/leads'),
  patchLead: (id: string, patch: { status?: LeadStatus; note?: string }) =>
    request<Lead>('PATCH', `admin/leads/${enc(id)}`, patch),
  deleteLead: (id: string) => request<{ ok: true }>('DELETE', `admin/leads/${enc(id)}`),

  // AI chats
  chats: () => request<ChatSummary[]>('GET', 'admin/chats'),
  chat: (id: string) => request<ChatSession>('GET', `admin/chats/${enc(id)}`),

  // settings
  settings: () => request<AdminSettings>('GET', 'admin/settings'),
  telegramTest: () => request<TelegramTestResult>('POST', 'admin/telegram/test'),
  telegramChats: () =>
    request<{ ok: boolean; error?: string; chats?: TelegramChat[] }>('GET', 'admin/telegram/chats'),
  setTelegramChat: (chatId: string) => request<TelegramSettings>('PUT', 'admin/settings/telegram', { chatId }),
  setTelegramMode: (mode: TelegramMode) => request<TelegramSettings>('PUT', 'admin/settings/telegram', { mode }),
  telegramSubscribers: () => request<TelegramSubscribers>('GET', 'admin/telegram/subscribers'),
  addTelegramSubscriber: (s: { chatId: string; name: string }) =>
    request<TelegramSubscriber>('POST', 'admin/telegram/subscribers', s),
  patchTelegramSubscriber: (chatId: string, patch: { active?: boolean; name?: string }) =>
    request<TelegramSubscriber>('PATCH', `admin/telegram/subscribers/${enc(chatId)}`, patch),
  deleteTelegramSubscriber: (chatId: string) =>
    request<{ ok: true }>('DELETE', `admin/telegram/subscribers/${enc(chatId)}`),
}
