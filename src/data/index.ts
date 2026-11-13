import content from './content.json'

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

/** Certificates and declarations (PDFs in public/pdf). */
export type DocGroup = 'company' | 'product' | 'epd'
export type Doc = {
  file: string
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
export const featured = (() => {
  const picks: Product[] = []
  for (const c of categories) {
    const p = products.find((x) => x.categories.includes(c.id) && !picks.includes(x))
    if (p) picks.push(p)
  }
  return picks
})()

export const pad = (n: number) => String(n).padStart(2, '0')
