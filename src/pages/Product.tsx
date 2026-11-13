import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router'
import { GLImage } from '../components/GLImage'
import { Reveal, FadeUp } from '../components/Reveal'
import { TLink } from '../components/Transition'
import { DocList } from '../components/Documents'
import { asset, categoryById, docsForProduct, pad, productBySlug, products } from '../data'
import { useLang } from '../i18n'
import { gsap, useGSAP, lenis, reducedMotion, useMedia } from '../lib/motion'
import NotFound from './NotFound'

export default function Product() {
  const { slug = '' } = useParams()
  const p = productBySlug(slug)
  if (!p) return <NotFound />
  return <ProductView key={p.slug} slug={p.slug} />
}

function ProductView({ slug }: { slug: string }) {
  const { t, l } = useLang()
  const p = productBySlug(slug)!
  const idx = products.indexOf(p)
  const next = products[(idx + 1) % products.length]
  const cats = p.categories.map((c) => categoryById(c)).filter(Boolean)
  const paragraphs = l(p.description).split(/\n\n+/)
  const docs = docsForProduct(p.slug)
  const gallery = useRef<HTMLDivElement>(null)
  const wide = useMedia('(min-width: 768px)')
  const [lightbox, setLightbox] = useState<number | null>(null)

  // gallery columns drift at different speeds
  useGSAP(
    () => {
      if (reducedMotion || !wide) return
      gallery.current!.querySelectorAll<HTMLElement>('[data-speed]').forEach((col) => {
        const s = Number(col.dataset.speed)
        gsap.fromTo(col, { y: 0 }, { y: -s, ease: 'none', scrollTrigger: { trigger: gallery.current, start: 'top bottom', end: 'bottom top', scrub: true } })
      })
    },
    { dependencies: [wide], scope: gallery },
  )

  const cols = wide ? 3 : 1
  const columns = Array.from({ length: cols }, (_, c) => p.gallery.map((src, i) => ({ src, i })).filter(({ i }) => i % cols === c))

  return (
    <>
      {/* hero */}
      <section className="px-5 pb-20 pt-32 md:px-10 md:pt-44">
        <div className="mb-10 flex items-center justify-between">
          <TLink to="/products" className="label group flex items-center gap-3 !text-bone" data-cursor="link">
            <span className="transition-transform duration-500 group-hover:-translate-x-2">←</span>
            <span className="link-line">{t('product.back')}</span>
          </TLink>
          <span className="label">
            {pad(idx + 1)} / {pad(products.length)}
          </span>
        </div>
        <div className="grid gap-12 md:grid-cols-12">
          <div className="flex flex-col justify-between gap-10 md:col-span-6">
            <div>
              <Reveal as="p" className="label mb-6">
                {`${t('product.category')}: ${cats.map((c) => l(c!.name)).join(' · ')}`}
              </Reveal>
              <Reveal as="h1" by="chars" immediate className="display text-[16vw] leading-[0.88] md:text-[8.5vw]">
                {p.name}
              </Reveal>
            </div>
            <Reveal as="p" by="words" delay={0.4} immediate className="display max-w-md text-3xl italic text-sand md:text-4xl">
              {l(p.subtitle)}
            </Reveal>
          </div>
          <GLImage src={p.image} alt={p.name} reveal eager className="aspect-[4/5] md:col-span-5 md:col-start-8" />
        </div>
      </section>

      {/* description */}
      <section className="tone-light panel px-5 py-24 md:px-10 md:py-32">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-3">
            <div className="md:sticky md:top-32">
              <Reveal as="p" className="label">{`— ${t('product.description')}`}</Reveal>
            </div>
          </div>
          <div className="space-y-8 md:col-span-8 md:col-start-5">
            {paragraphs.map((para, i) => (
              <Reveal key={i} as="p" className={i === 0 ? 'display text-3xl leading-[1.2] md:text-[2.6rem]' : 'max-w-2xl text-base leading-relaxed text-ash md:text-lg'}>
                {para}
              </Reveal>
            ))}
            <FadeUp className="pt-6">
              <TLink to={`/contact?p=${encodeURIComponent(p.name)}`} className="group inline-flex items-center gap-5" data-cursor="link">
                <span className="grid h-14 w-14 place-items-center rounded-full border border-line transition-colors duration-500 group-hover:bg-bone group-hover:text-ink">→</span>
                <span className="label link-line !text-bone">{t('product.consult')}</span>
              </TLink>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* gallery */}
      <section className="px-5 py-24 md:px-10 md:py-32">
        <div className="mb-12 flex items-end justify-between border-b border-line pb-5">
          <Reveal as="h2" by="words" className="display text-5xl md:text-7xl">
            {t('product.gallery')}
          </Reveal>
          <span className="label">{pad(p.gallery.length)}</span>
        </div>
        <div ref={gallery} className={`grid gap-6 md:gap-8 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {columns.map((col, c) => (
            <div key={c} data-speed={[60, 160, 100][c]} className={`flex flex-col gap-6 md:gap-8 ${c === 1 ? 'md:pt-28' : ''}`}>
              {col.map(({ src, i }) => (
                <button key={src} onClick={() => setLightbox(i)} className="block text-left" data-cursor="view">
                  <GLImage src={src} alt={`${p.name} ${i + 1}`} className={i % 3 === 1 ? 'aspect-[3/4]' : i % 3 === 2 ? 'aspect-square' : 'aspect-[4/5]'} />
                  <span className="label mt-3 block">{pad(i + 1)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* certificates & declarations for this product */}
      {docs.length > 0 && (
        <section className="px-5 pb-24 md:px-10 md:pb-32">
          <div className="mb-10 flex items-end justify-between gap-6">
            <Reveal as="h2" by="words" className="display text-5xl md:text-7xl">
              {t('docs.label')}
            </Reveal>
            <span className="label">{pad(docs.length)}</span>
          </div>
          <DocList docs={docs} />
          <p className="label mt-6">{t('docs.note')}</p>
        </section>
      )}

      {/* next product */}
      <TLink to={`/products/${next.slug}`} className="tone-sand panel group relative block overflow-hidden" data-cursor="view">
        <div className="grid items-center gap-8 px-5 py-20 md:grid-cols-12 md:px-10 md:py-28">
          <div className="md:col-span-7">
            <Reveal as="p" className="label mb-6">{`${t('product.next')} →`}</Reveal>
            <Reveal as="h2" by="chars" className="display text-[17vw] transition-transform duration-1000 ease-[var(--ease-expo)] group-hover:translate-x-4 group-hover:italic md:text-[9vw]">
              {next.name}
            </Reveal>
            <p className="mt-4 max-w-md text-sm text-ash">{l(next.subtitle)}</p>
          </div>
          <GLImage src={next.image} alt={next.name} className="aspect-[16/10] md:col-span-5" />
        </div>
      </TLink>

      {lightbox !== null && <Lightbox images={p.gallery} index={lightbox} name={p.name} onClose={() => setLightbox(null)} onIndex={setLightbox} />}
    </>
  )
}

function Lightbox({ images, index, name, onClose, onIndex }: { images: string[]; index: number; name: string; onClose: () => void; onIndex: (i: number) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const { t } = useLang()
  const close = () => gsap.to(root.current, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.7, ease: 'expo.inOut', onComplete: onClose })
  const go = (d: number) => onIndex((index + d + images.length) % images.length)

  useEffect(() => {
    lenis?.stop()
    gsap.fromTo(root.current, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'expo.inOut' })
    return () => {
      lenis?.start()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useGSAP(() => {
    gsap.fromTo(root.current!.querySelector('[data-photo]'), { scale: 1.08, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 1, ease: 'expo.out' })
  }, { dependencies: [index], scope: root })

  return createPortal(
    <div ref={root} className="fixed inset-0 z-[95] flex flex-col bg-ink/95 backdrop-blur" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-center justify-between px-5 py-5 md:px-10">
        <span className="label">
          {name} — {pad(index + 1)} / {pad(images.length)}
        </span>
        <button onClick={close} className="label link-line !text-bone">
          {t('close')} ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-8 md:px-24">
        <img data-photo key={images[index]} src={asset(images[index])} alt="" className="h-full max-h-full w-auto max-w-full object-contain" />
        <button onClick={() => go(-1)} className="absolute left-2 top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-line hover:bg-bone hover:text-ink md:left-8" aria-label="Prev">
          ←
        </button>
        <button onClick={() => go(1)} className="absolute right-2 top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-line hover:bg-bone hover:text-ink md:right-8" aria-label="Next">
          →
        </button>
      </div>
    </div>,
    document.body,
  )
}
