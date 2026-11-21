import { useRef } from 'react'
import { useSearchParams } from 'react-router'
import { GLImage } from '../components/GLImage'
import { Reveal } from '../components/Reveal'
import { TLink } from '../components/Transition'
import { ContactCTA } from '../components/Blocks'
import { catalogCover, catalogs, categories, categoryById, pad, products } from '../data'
import { useLang } from '../i18n'
import { gsap, useGSAP, ScrollTrigger, reducedMotion, useMedia } from '../lib/motion'

export default function Products() {
  const { t, l } = useLang()
  const [params, setParams] = useSearchParams()
  const active = Number(params.get('c')) || 0
  const list = active ? products.filter((p) => p.categories.includes(active)) : products
  const grid = useRef<HTMLDivElement>(null)
  const wide = useMedia('(min-width: 1024px)')

  const choose = (id: number) => {
    if (id === active) return
    const cards = grid.current?.querySelectorAll('[data-card]')
    const swap = () => {
      setParams(id ? { c: String(id) } : {}, { replace: true, preventScrollReset: true })
    }
    if (!cards?.length || reducedMotion) return swap()
    gsap.to(cards, { autoAlpha: 0, y: 40, duration: 0.45, ease: 'power3.in', stagger: 0.02, onComplete: swap })
  }

  // after a filter change: cards rise in, triggers recalculated
  useGSAP(
    () => {
      const cards = grid.current!.querySelectorAll('[data-card]')
      gsap.fromTo(cards, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.05 })
      ScrollTrigger.refresh()
      // gentle column parallax on wide screens
      if (!reducedMotion && wide) {
        grid.current!.querySelectorAll<HTMLElement>('[data-col="1"]').forEach((c) =>
          gsap.fromTo(c, { y: 0 }, { y: -80, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } }),
        )
      }
    },
    { dependencies: [active, wide], scope: grid },
  )

  return (
    <>
      <section className="px-5 pb-16 pt-36 md:px-10 md:pt-48">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-8">
            <Reveal as="p" className="label mb-8">{`— ${t('nav.products')}`}</Reveal>
            <Reveal key={active} as="h1" by="chars" immediate className="display text-[18vw] md:text-[12vw]">
              {active ? l(categoryById(active)!.name) : t('products.title')}
            </Reveal>
          </div>
          <div className="flex flex-col justify-end md:col-span-4">
            <Reveal as="p" className="max-w-sm text-sm leading-relaxed text-ash" delay={0.3}>
              {t('products.intro')}
            </Reveal>
          </div>
        </div>
        <div className="mt-14 flex flex-wrap gap-2 border-y border-line py-5" role="tablist">
          {[{ id: 0, name: null }, ...categories].map((c) => {
            const on = c.id === active
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={on}
                onClick={() => choose(c.id)}
                className={`label relative overflow-hidden rounded-full border px-4 py-2 transition-colors duration-500 ${on ? 'border-bone bg-bone !text-ink' : 'border-line !text-bone hover:border-bone/60'}`}
              >
                {c.name ? l(c.name) : t('products.all')}
                <span className="ml-2 opacity-50">{c.id ? categoryById(c.id)!.count : products.length}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="label">
            {list.length} {t('products.count')}
          </p>
          {catalogs.length > 0 && (
            <TLink to="/catalogs" className="label group inline-flex items-center gap-3 !text-bone" data-cursor="link">
              <span className="link-line">
                {t('catalogs.title')} · {catalogs.length} PDF
              </span>
              <span className="transition-transform duration-500 group-hover:translate-x-1.5">→</span>
            </TLink>
          )}
        </div>
      </section>

      <section className="tone-light panel px-5 py-16 md:px-10 md:py-20">
        <div ref={grid} key={active} className={wide ? 'grid grid-cols-3 gap-x-10' : 'grid grid-cols-1 gap-x-6 gap-y-16 sm:grid-cols-2'}>
          {wide
            ? [0, 1, 2].map((col) => (
                <div key={col} data-col={col} className={`flex flex-col gap-16 ${col === 1 ? 'pt-40' : ''}`}>
                  {list
                    .map((p, i) => ({ p, i }))
                    .filter(({ i }) => i % 3 === col)
                    .map(({ p, i }) => (
                      <Card key={p.slug} slug={p.slug} index={i} />
                    ))}
                </div>
              ))
            : list.map((p, i) => <Card key={p.slug} slug={p.slug} index={i} />)}
        </div>
      </section>
      <CatalogsTeaser />
      <ContactCTA />
    </>
  )
}

function Card({ slug, index }: { slug: string; index: number }) {
  const { l } = useLang()
  const p = products.find((x) => x.slug === slug)!
  const cat = categoryById(p.categories[0])
  return (
    <TLink to={`/products/${p.slug}`} data-card className="group block" data-cursor="view">
      <GLImage src={p.image} alt={p.name} className="aspect-[4/5] w-full" />
      <div className="mt-5 flex items-baseline justify-between gap-4 border-b border-line pb-4">
        <h2 className="display text-4xl transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-2 group-hover:italic md:text-5xl">{p.name}</h2>
        <span className="label">{pad(index + 1)}</span>
      </div>
      <div className="mt-3 flex justify-between gap-4 text-sm text-ash">
        <span className="line-clamp-2">{l(p.subtitle)}</span>
        {cat && <span className="label shrink-0">{l(cat.name)}</span>}
      </div>
    </TLink>
  )
}

/** Link to the Kataloglar page: a fan of collection catalog covers. */
function CatalogsTeaser() {
  const { t } = useLang()
  const covers = [...catalogs.filter((c) => c.group === 'collection'), ...catalogs.filter((c) => c.group !== 'collection')].slice(0, 4)
  if (!covers.length) return null
  return (
    <section className="px-5 py-24 md:px-10 md:py-32">
      <TLink to="/catalogs" className="group grid items-center gap-14 md:grid-cols-12" data-cursor="view">
        <div className="md:col-span-5">
          <Reveal as="p" className="label mb-6">{`— ${t('catalogs.label')}`}</Reveal>
          <Reveal as="h2" by="chars" className="display text-[15vw] transition-transform duration-1000 ease-[var(--ease-expo)] group-hover:translate-x-3 group-hover:italic md:text-[7vw]">
            {t('catalogs.title')}
          </Reveal>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-ash">{t('catalogs.teaser')}</p>
          <span className="mt-10 inline-flex items-center gap-5">
            <span className="grid h-14 w-14 place-items-center rounded-full border border-line transition-colors duration-500 group-hover:bg-bone group-hover:text-ink">→</span>
            <span className="label link-line !text-bone">
              {t('catalogs.all')} · {catalogs.length}
            </span>
          </span>
        </div>
        <div className="relative h-[62vw] md:col-span-6 md:col-start-7 md:h-[30vw]">
          {covers.map((c, i) => (
            <img
              key={c.file}
              src={catalogCover(c)}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute top-1/2 h-auto max-h-[92%] w-[40%] -translate-y-1/2 rounded-sm object-contain shadow-[0_30px_60px_-20px_rgb(0_0_0/0.45)] transition-[rotate,translate] duration-1000 ease-[var(--ease-expo)]"
              style={{ left: `${i * 20}%`, rotate: `${(i - 1.5) * 5}deg`, zIndex: i }}
            />
          ))}
        </div>
      </TLink>
    </section>
  )
}
