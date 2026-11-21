import { ContactCTA } from '../components/Blocks'
import { CatalogGrid } from '../components/Catalogs'
import { Reveal } from '../components/Reveal'
import { CATALOG_GROUPS, catalogs, pad, products, type CatalogGroup } from '../data'
import { useLang, type Key } from '../i18n'
import { lenis } from '../lib/motion'

/** Section order on the page: collections first, then the product brochures, colour cards, inspiration, technical. */
const ORDER: CatalogGroup[] = ['collection', 'product', 'colors', 'inspiration', 'technical']

/** Product brochures follow the product order of the catalogue. */
const productRank = (slugs: string[]) => {
  const i = products.findIndex((p) => slugs.includes(p.slug))
  return i < 0 ? products.length : i
}

export default function Catalogs() {
  const { t } = useLang()
  const groups = ORDER.filter((g) => CATALOG_GROUPS.includes(g))
    .map((g) => {
      const items = catalogs.filter((c) => (CATALOG_GROUPS.includes(c.group) ? c.group : 'product') === g)
      if (g === 'product') items.sort((a, b) => productRank(a.products) - productRank(b.products))
      return { g, items }
    })
    .filter((x) => x.items.length)

  const jump = (g: string) => {
    const el = document.getElementById(`catalogs-${g}`)
    if (!el) return
    if (lenis) lenis.scrollTo(el, { offset: -110, duration: 1.4 })
    else el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <section className="px-5 pb-12 pt-36 md:px-10 md:pt-48">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-8">
            <Reveal as="p" className="label mb-8">{`— ${t('nav.products')} / ${t('catalogs.label')}`}</Reveal>
            <Reveal as="h1" by="chars" immediate className="display text-[17vw] md:text-[12vw]">
              {t('catalogs.title')}
            </Reveal>
          </div>
          <div className="flex flex-col justify-end md:col-span-4">
            <Reveal as="p" className="max-w-sm text-sm leading-relaxed text-ash" delay={0.3}>
              {t('catalogs.intro')}
            </Reveal>
          </div>
        </div>
        <div className="mt-14 flex flex-wrap gap-2 border-y border-line py-5">
          {groups.map(({ g, items }) => (
            <button
              key={g}
              type="button"
              onClick={() => jump(g)}
              className="label rounded-full border border-line px-4 py-2 !text-bone transition-colors duration-500 hover:border-bone/60"
            >
              {t(`catalogs.group.${g}` as Key)}
              <span className="ml-2 opacity-50">{items.length}</span>
            </button>
          ))}
        </div>
        <p className="label mt-6">
          {catalogs.length} PDF · {t('catalogs.note')}
        </p>
      </section>

      {groups.map(({ g, items }, i) => (
        <section key={g} id={`catalogs-${g}`} className={`px-5 py-16 md:px-10 md:py-24 ${i % 2 === 0 ? 'tone-light panel' : ''}`}>
          <div className="mb-10 flex items-end justify-between gap-6 border-b border-line pb-5 md:mb-14">
            <Reveal as="h2" by="words" className="display text-5xl md:text-7xl">
              {t(`catalogs.group.${g}` as Key)}
            </Reveal>
            <span className="label tabular-nums">{pad(items.length)}</span>
          </div>
          <CatalogGrid items={items} product />
        </section>
      ))}
      <ContactCTA />
    </>
  )
}
