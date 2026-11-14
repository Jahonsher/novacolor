import { z } from 'zod'

z.config(z.locales.uz())

const text = (max: number) => z.string().trim().max(max)

/**
 * Asset path relative to the site root: static `img/…` / `pdf/…` or uploaded `uploads/…`.
 * No URLs (the front-end prefixes paths with the base URL, so `https://…` would break, and any scheme —
 * `javascript:` included — is excluded by construction), no `..`, no `//`.
 */
export const ASSET_PATH_RE = /^(img|uploads|pdf)\/[\w./-]+$/
export const isAssetPath = (s: string) => ASSET_PATH_RE.test(s) && !s.includes('..') && !s.includes('//')
const assetPath = z
  .string()
  .trim()
  .max(500)
  .refine(isAssetPath, { message: "Yo'l noto'g'ri: img/…, uploads/… yoki pdf/… bo'lishi kerak" })
/**
 * Stored content is validated leniently: every write goes through the strict *Input schemas, and an old
 * value that predates a stricter rule must not stop the server from starting.
 */
const storedAsset = z.string().max(500)

/** https URL on one of the allowed hosts ('' = not set). */
const httpsOn = (hosts: RegExp, message: string) =>
  z
    .string()
    .trim()
    .max(2000)
    .refine(
      (s) => {
        if (s === '') return true
        try {
          const u = new URL(s)
          return u.protocol === 'https:' && !u.username && !u.password && hosts.test(u.hostname.toLowerCase())
        } catch {
          return false
        }
      },
      { message },
    )
const TELEGRAM_HOSTS = /^(t\.me|telegram\.me)$/
const INSTAGRAM_HOSTS = /^(www\.)?instagram\.com$/
/** Map iframe src: Yandex map widget or Google Maps embed. */
const MAP_HOSTS = /^((www\.)?yandex\.(ru|uz|com|kz|by|com\.tr)|(www\.|maps\.)?google\.(com|ru|uz|co\.uz|kz))$/

export const localized = (max = 20000) => z.object({ uz: text(max), ru: text(max) })
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, { message: "Slug faqat kichik lotin harflari, raqamlar va '-' dan iborat bo'lishi kerak" })

const productFields = (asset: z.ZodType<string>) => ({
  slug: slugSchema,
  name: text(200).min(1),
  categories: z.array(z.int().positive()).max(50),
  image: asset,
  gallery: z.array(asset).max(100).default([]),
  subtitle: localized(500),
  description: localized(20000),
})
export const productInput = z.object(productFields(assetPath))
export const productSchema = z.object({ id: z.int().positive(), ...productFields(storedAsset) })

const categoryFields = (asset: z.ZodType<string>) => ({
  name: z.object({ uz: text(100).min(1), ru: text(100).min(1) }),
  image: asset,
})
export const categoryInput = z.object(categoryFields(assetPath))
export const categorySchema = z.object({ id: z.int().positive(), ...categoryFields(storedAsset), count: z.int().nonnegative() })

const newsFields = (asset: z.ZodType<string>) => ({
  title: text(300).min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Sana YYYY-MM-DD formatida bo‘lishi kerak' }),
  image: asset,
  product: slugSchema.nullable().default(null),
})
export const newsInput = z.object(newsFields(assetPath))
export const newsSchema = z.object({ id: z.int().positive(), ...newsFields(storedAsset) })

export const statSchema = z.object({ id: z.int(), value: z.number(), label: localized(200) })

export const aboutSchema = z.object({ lead: localized(10000), extra: localized(10000) })

export const contactsInput = z.object({
  phone: text(50).min(1),
  // '' / missing → generated from `phone`
  phoneHref: text(60)
    .regex(/^$|^tel:\+?\d{3,20}$/, { message: "Telefon havolasi tel:+998901234567 ko'rinishida bo'lishi kerak" })
    .optional(),
  email: text(200).refine((s) => s === '' || z.email().safeParse(s).success, { message: "Email noto'g'ri" }),
  address: localized(500),
  telegram: httpsOn(TELEGRAM_HOSTS, "Telegram havolasi https://t.me/… bo'lishi kerak"),
  instagram: httpsOn(INSTAGRAM_HOSTS, "Instagram havolasi https://www.instagram.com/… bo'lishi kerak"),
  map: httpsOn(MAP_HOSTS, "Xarita havolasi Yandex yoki Google xaritasining https://… embed manzili bo'lishi kerak"),
})
/** Stored contacts (lenient, see storedAsset). */
export const contactsSchema = z.object({
  phone: text(50).min(1),
  phoneHref: text(60),
  email: text(200),
  address: localized(500),
  telegram: text(500),
  instagram: text(500),
  map: text(2000),
})

export const docGroup = z.enum(['company', 'product', 'epd'])
export const docSchema = z.object({
  file: z.string().min(1).max(200),
  group: docGroup,
  title: localized(300),
  products: z.array(slugSchema),
  size: z.number().nonnegative(),
  path: z.string().max(300).optional(),
})
export const docMetaInput = z.object({
  title: z.object({ uz: text(300).min(1), ru: text(300).min(1) }).optional(),
  group: docGroup.optional(),
  products: z.array(slugSchema).max(200).optional(),
})

/** Whole content.json. Unknown top-level keys are preserved. */
export const contentSchema = z.looseObject({
  products: z.array(productSchema),
  categories: z.array(categorySchema),
  news: z.array(newsSchema),
  stats: z.array(statSchema),
  about: aboutSchema,
  contacts: contactsSchema,
  clients: z.array(z.string()),
  documents: z.array(docSchema),
})

export type Localized = z.infer<ReturnType<typeof localized>>
export type Product = z.infer<typeof productSchema>
export type Category = z.infer<typeof categorySchema>
export type NewsItem = z.infer<typeof newsSchema>
export type Doc = z.infer<typeof docSchema>
export type Contacts = z.infer<typeof contactsSchema>
export type Content = z.infer<typeof contentSchema>

export const phoneField = z
  .string()
  .trim()
  .min(5)
  .max(30)
  .regex(/^[0-9+\s\-()]+$/, { message: "Telefon raqami noto'g'ri" })

export const leadInput = z.object({
  name: text(100).min(1),
  phone: phoneField,
  product: text(200).optional(),
  message: text(2000).optional(),
  website: z.string().optional(),
})

/**
 * Telegram settings (both optional, at least one): `chatId` for `single` mode — numeric (users, groups `-100…`)
 * or a public channel `@username`, '' clears it; `mode` — who gets the leads.
 */
export const telegramSettingsInput = z
  .object({
    chatId: z
      .string()
      .trim()
      .max(64)
      .regex(/^$|^-?\d{3,20}$|^@[A-Za-z][A-Za-z0-9_]{4,31}$/, {
        message: "Chat ID noto'g'ri: raqam (masalan 123456789 yoki guruh uchun -100…) yoki @kanal_nomi bo'lishi kerak",
      })
      .optional(),
    mode: z.enum(['subscribers', 'single'], { message: "Rejim noto'g'ri: subscribers yoki single" }).optional(),
  })
  .refine((v) => v.chatId !== undefined || v.mode !== undefined, { message: 'chatId yoki mode kerak' })

/** Subscriber chat ID: numeric only (a user, or a group `-…` / supergroup `-100…`). */
export const subscriberChatId = z
  .string()
  .trim()
  .regex(/^-?\d{3,20}$/, { message: "Chat ID noto'g'ri: raqam bo'lishi kerak (masalan 123456789, guruh uchun -100…)" })
const subscriberName = text(100).min(1, { message: 'Ism kiriting' })
const subscriberType = z.enum(['private', 'group', 'supergroup'])
const tgUsername = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ''))
  .pipe(z.string().regex(/^$|^[A-Za-z0-9_]{3,64}$/, { message: "Username noto'g'ri" }))

export const subscriberInput = z.object({
  chatId: subscriberChatId,
  name: subscriberName,
  username: tgUsername.optional(),
  type: subscriberType.optional(),
})
export const subscriberPatch = z
  .object({ active: z.boolean().optional(), name: subscriberName.optional() })
  .refine((v) => v.active !== undefined || v.name !== undefined, { message: 'active yoki name kerak' })
export const subscribersPut = z.object({
  subscribers: z.array(subscriberInput.extend({ active: z.boolean().default(true) })).max(1000),
})

/** Type from the ID when not given: `-100…` supergroup, `-…` group, else a private chat. */
export const inferChatType = (chatId: string) => (chatId.startsWith('-100') ? 'supergroup' : chatId.startsWith('-') ? 'group' : 'private')

export const leadStatus = z.enum(['new', 'in_progress', 'done'])
export const leadPatch = z.object({ status: leadStatus.optional(), note: text(2000).optional() })

export type Lead = {
  id: string
  createdAt: string
  source: 'contact' | 'ai'
  name: string
  phone: string
  product?: string
  message?: string
  chatId?: string
  status: z.infer<typeof leadStatus>
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

export const chatInput = z.object({
  sessionId: z
    .string()
    .trim()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  lang: z.enum(['uz', 'ru']),
  // a site path only (`///evil.com` or `https://…` would turn into an external link in the admin);
  // anything else is dropped rather than failing the visitor's message (e.g. chatting on a 404 page)
  page: z
    .string()
    .trim()
    .regex(/^\/(?!\/)[\w/-]{0,200}$/)
    .optional()
    .catch(undefined),
  message: z.string().trim().min(1).max(1000),
})

/** First zod issue as a short Uzbek message. */
export function zodMessage(err: z.ZodError): string {
  const i = err.issues[0]
  if (!i) return "Ma'lumotlar noto'g'ri"
  const where = i.path.length ? `${i.path.join('.')}: ` : ''
  return `${where}${i.message}`
}
