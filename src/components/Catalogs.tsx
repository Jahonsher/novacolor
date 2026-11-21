import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { catalogCover, catalogPdf, pad, productBySlug, type Catalog } from '../data'
import { useLang } from '../i18n'
import { gsap, lenis } from '../lib/motion'
import { FadeUp } from './Reveal'
import { TLink } from './Transition'

const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`)

/** "Metallics — metall effektli pardozlar" → ["Metallics", "metall effektli pardozlar"] */
const splitTitle = (s: string) => {
  const i = s.indexOf(' — ')
  return i > 0 ? [s.slice(0, i), s.slice(i + 3)] : [s, '']
}

/**
 * Browsers that show PDFs inline (desktop Chrome / Safari / Firefox / Edge). Phones and tablets either download
 * the file or render only the first page inside an iframe — there the viewer shows the cover with "open / download".
 */
function inlinePdf() {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { pdfViewerEnabled?: boolean }
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(n.userAgent) || (n.maxTouchPoints > 1 && /Macintosh/.test(n.userAgent))
  return !mobile && n.pdfViewerEnabled !== false
}

/** Catalog cards: cover (click → full-screen viewer), title, pages, PDF download. */
export function CatalogGrid({ items, product = false, className = '' }: { items: Catalog[]; product?: boolean; className?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <div className={`grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 md:grid-cols-3 md:gap-x-8 lg:grid-cols-4 ${className}`}>
        {items.map((c, i) => (
          <CatalogCard key={c.file} c={c} index={i} product={product} onView={() => setOpen(i)} />
        ))}
      </div>
      {open !== null && items[open] && <CatalogViewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

function CatalogCard({ c, index, product, onView }: { c: Catalog; index: number; product: boolean; onView: () => void }) {
  const { l, t } = useLang()
  const [name, sub] = splitTitle(l(c.title))
  // product brochures link to the product page on the Kataloglar page
  const p = product && c.group === 'product' ? productBySlug(c.products[0] ?? '') : undefined
  return (
    <FadeUp y={40} delay={(index % 4) * 0.06}>
      <article className="group">
        <button
          type="button"
          onClick={onView}
          data-cursor="view"
          aria-label={`${t('catalogs.view')}: ${l(c.title)}`}
          className="relative block aspect-[4/5] w-full overflow-hidden rounded-[18px] bg-char md:rounded-[22px]"
        >
          <img
            src={catalogCover(c)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute left-1/2 top-1/2 max-h-[76%] max-w-[72%] -translate-x-1/2 -translate-y-1/2 object-contain shadow-[0_26px_50px_-18px_rgb(0_0_0/0.45)] transition-[translate,scale] duration-1000 ease-[var(--ease-expo)] group-hover:-translate-y-[54%] group-hover:scale-[1.04]"
          />
          {c.pages ? (
            <span className="label absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 backdrop-blur md:left-4 md:top-4">
              {c.pages} {t('catalogs.pages')}
            </span>
          ) : null}
          <span className="label absolute bottom-3 right-3 hidden rounded-full bg-bone px-3 py-1.5 !text-ink opacity-0 transition-opacity duration-500 group-hover:opacity-100 md:inline">
            {t('catalogs.view')} →
          </span>
        </button>
        <div className="mt-4 border-b border-line pb-3">
          <h3 className="display text-[1.65rem] leading-[1.02] transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-1 md:text-3xl">{name}</h3>
          {sub && <p className="mt-1.5 line-clamp-2 text-sm text-ash">{sub}</p>}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {p ? (
            <TLink to={`/products/${p.slug}`} className="label link-line truncate !text-bone" data-cursor="link">
              {t('catalogs.product')} →
            </TLink>
          ) : (
            <button type="button" onClick={onView} className="label link-line !text-bone" data-cursor="link">
              {t('catalogs.view')} →
            </button>
          )}
          <a
            href={catalogPdf(c)}
            download={c.file}
            data-cursor="link"
            aria-label={`${t('catalogs.download')}: ${l(c.title)}`}
            className="flex shrink-0 items-center gap-2"
          >
            <span className="label hidden tabular-nums sm:inline">{fmtSize(c.size)}</span>
            <span className="grid h-10 w-10 place-items-center rounded-full border border-line transition-colors duration-500 hover:bg-bone hover:text-ink">↓</span>
          </a>
        </div>
      </article>
    </FadeUp>
  )
}

/** Full-screen catalog: the PDF itself (desktop) or its cover with open / download (phones). Prev / next between catalogs. */
export function CatalogViewer({ items, index, onIndex, onClose }: { items: Catalog[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const { l, t } = useLang()
  const c = items[index]!
  const many = items.length > 1
  const [inline] = useState(inlinePdf)
  const [loaded, setLoaded] = useState<string | null>(null)
  const close = () => gsap.to(root.current, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.6, ease: 'expo.inOut', onComplete: onClose })
  const go = (step: number) => onIndex((index + step + items.length) % items.length)

  useEffect(() => {
    lenis?.stop()
    gsap.fromTo(root.current, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.8, ease: 'expo.inOut' })
    return () => {
      lenis?.start()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (many && e.key === 'ArrowRight') go(1)
      if (many && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pdf = catalogPdf(c)
  const arrows = many && (
    <>
      <button onClick={() => go(-1)} className="absolute left-2 top-1/2 z-[2] grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink/70 backdrop-blur hover:bg-bone hover:text-ink md:left-6 md:h-14 md:w-14" aria-label="Prev">
        ←
      </button>
      <button onClick={() => go(1)} className="absolute right-2 top-1/2 z-[2] grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink/70 backdrop-blur hover:bg-bone hover:text-ink md:right-6 md:h-14 md:w-14" aria-label="Next">
        →
      </button>
    </>
  )

  return createPortal(
    <div ref={root} className="tone-dark fixed inset-0 z-[95] flex flex-col bg-ink/95 backdrop-blur" role="dialog" aria-modal="true" aria-label={l(c.title)}>
      <div className="flex items-center justify-between gap-6 px-5 py-4 md:px-10 md:py-5">
        <span className="label min-w-0 truncate">
          {many && `${pad(index + 1)} / ${pad(items.length)} — `}
          {l(c.title)}
          {c.pages ? ` · ${c.pages} ${t('catalogs.pages')}` : ''}
        </span>
        <button onClick={close} className="label link-line shrink-0 !text-bone">
          {t('close')} ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 md:px-24" data-lenis-prevent>
        {inline ? (
          <div className="relative h-full w-full max-w-[1400px] overflow-hidden rounded-md bg-[#2a2826] shadow-2xl">
            {/* the cover stays visible until the PDF has loaded */}
            {loaded !== c.file && <img src={catalogCover(c)} alt="" className="absolute inset-0 m-auto max-h-[90%] max-w-[90%] animate-pulse object-contain" />}
            <iframe key={c.file} src={`${pdf}#view=FitH`} title={l(c.title)} onLoad={() => setLoaded(c.file)} className="relative h-full w-full border-0" />
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-5">
            <img key={c.file} src={catalogCover(c)} alt={l(c.title)} className="min-h-0 max-w-full flex-1 rounded-sm object-contain shadow-2xl" />
            <p className="max-w-xs text-center text-sm text-ash">{t('catalogs.mobile')}</p>
          </div>
        )}
        {arrows}
      </div>
      <div className="flex flex-wrap justify-center gap-3 px-5 py-4 md:py-5">
        <a href={pdf} target="_blank" rel="noopener" className="label rounded-full border border-line px-5 py-3 !text-bone transition-colors duration-500 hover:bg-bone hover:!text-ink">
          {t('catalogs.open')} ↗
        </a>
        <a href={pdf} download={c.file} className="label rounded-full border border-line px-5 py-3 !text-bone transition-colors duration-500 hover:bg-bone hover:!text-ink">
          {t('catalogs.download')} ↓ <span className="opacity-60">{fmtSize(c.size)}</span>
        </a>
      </div>
    </div>,
    document.body,
  )
}
