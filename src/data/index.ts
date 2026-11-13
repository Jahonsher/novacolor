import content from './content.json'
import { apiGet } from '../lib/api'

export type Lang = 'uz' | 'ru'
export type Localized = Record<Lang, string>

export type Product = {
  id: number
  slug: string
  name: string
  categories: number[]
  image: string
  gallery: string[]
  subtitle: Localized
  description: Localized
}

export type Category = {
  id: number
  name: Localized
  image: string
  count: number
}

export type NewsItem = {
  id: number
  title: string
  date: string
  image: string
  product: string | null
}

export const products = content.products as Product[]
export const categories = content.categories as Category[]
export const news = content.news as NewsItem[]
export const stats = content.stats as { id: number; value: number; label: Localized }[]
export const about = content.about as { lead: Localized; extra: Localized }
export const contacts = content.contacts as {
  phone: string
  phoneHref: string
  email: string
  address: Localized
  telegram: string
  instagram: string
  map: string
}
export const clients = content.clients as string[]

/** Certificates and declarations (PDFs in public/pdf, or uploaded through the admin panel). */
export type DocGroup = 'company' | 'product' | 'epd'
export type Doc = {
  file: string
  /** uploaded PDFs: path relative to the site root, e.g. `uploads/pdf/x.pdf` (static ones live in `pdf/<file>`) */
  path?: string
  group: DocGroup
  title: Localized
  /** product slugs the document applies to */
  products: string[]
  /** size in KB */
  size: number
}
export const documents = content.documents as Doc[]
export const docsForProduct = (slug: string) => documents.filter((d) => d.products.includes(slug))

/** Resolve a public asset path against the deploy base (e.g. /novacolor/). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

export const productBySlug = (slug: string) => products.find((p) => p.slug === slug)
export const categoryById = (id: number) => categories.find((c) => c.id === id)

/** Products picked for the home page showcase: one strong image per category first. */
export const featured: Product[] = []
function computeFeatured() {
  const picks: Product[] = []
  for (const c of categories) {
    const p = products.find((x) => x.categories.includes(c.id) && !picks.includes(x))
    if (p) picks.push(p)
  }
  featured.splice(0, featured.length, ...picks)
}
computeFeatured()

/* ---------------- runtime content (server build) ----------------
 * The exports above are imported as live bindings all over the site, so fresh
 * content from the server is written into the *same* arrays/objects. Called
 * once from main.tsx before the first render; any failure keeps the content
 * bundled into the build. */

const replaceArray = <T>(target: T[], next: unknown) => {
  if (Array.isArray(next)) target.splice(0, target.length, ...(next as T[]))
}
const replaceObject = (target: object, next: unknown) => {
  if (next && typeof next === 'object' && !Array.isArray(next)) Object.assign(target, next)
}

export async function loadRuntimeContent(): Promise<boolean> {
  // `import.meta.env.VITE_API` inline (same as API_ENABLED) so the static build drops this code
  if (!import.meta.env.VITE_API) return false
  try {
    const c = await apiGet<Partial<Record<keyof typeof content, unknown>>>('content', { timeout: 3000 })
    // a usable catalogue must at least have products and categories — otherwise keep the bundled one
    if (!c || !Array.isArray(c.products) || !c.products.length || !Array.isArray(c.categories) || !c.categories.length) return false
    replaceArray(products, c.products)
    replaceArray(categories, c.categories)
    replaceArray(news, c.news)
    replaceArray(stats, c.stats)
    replaceArray(clients, c.clients)
    replaceArray(documents, c.documents)
    replaceObject(about, c.about)
    replaceObject(contacts, c.contacts)
    computeFeatured()
    return true
  } catch {
    return false
  }
}

export const pad = (n: number) => String(n).padStart(2, '0')
