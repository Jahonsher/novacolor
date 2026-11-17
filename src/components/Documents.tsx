import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { asset, pad, type Doc } from '../data'
import { useLang } from '../i18n'
import { gsap, lenis } from '../lib/motion'
import { FadeUp } from './Reveal'

const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`)

const pdfUrl = (d: Doc) => asset(d.path ?? `pdf/${d.file}`)
/** First page as an image: `img/docs/<name>.jpg` for bundled PDFs, `<path>.jpg` next to an uploaded one. */
const previewUrl = (d: Doc) => asset(d.path ? d.path.replace(/\.pdf$/i, '.jpg') : `img/docs/${d.file.replace(/\.pdf$/i, '.jpg')}`)

/**
 * Certificates / EPDs: each row shows the first page as a picture (click → full-size view) and a PDF download.
 * Documents without a preview image fall back to a plain row.
 */
export function DocList({ docs }: { docs: Doc[] }) {
  const { l, t } = useLang()
  const [open, setOpen] = useState<number | null>(null)
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const shown = docs.filter((d) => !missing.has(d.file))
  const hide = (file: string) => setMissing((m) => new Set(m).add(file))

  return (
    <>
      <ul className="border-t border-line">
        {docs.map((d, i) => {
          const hasPreview = !missing.has(d.file)
          const view = () => setOpen(shown.indexOf(d))
          return (
            <li key={d.file}>
              <FadeUp y={24}>
                <div className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-line py-5 md:grid-cols-[3rem_auto_1fr_5rem_auto] md:gap-8 md:py-6">
                  <span className="label hidden tabular-nums md:block">{pad(i + 1)}</span>
                  {hasPreview ? (
                    <button
                      type="button"
                      onClick={view}
                      data-cursor="link"
                      aria-label={`${t('docs.view')}: ${l(d.title)}`}
                      className="relative h-20 w-14 shrink-0 overflow-hidden rounded-sm border border-line bg-white shadow-sm transition-transform duration-500 ease-[var(--ease-expo)] hover:-translate-y-1 hover:shadow-lg md:h-28 md:w-20"
                    >
                      <img src={previewUrl(d)} alt="" loading="lazy" decoding="async" onError={() => hide(d.file)} className="h-full w-full object-cover object-top" />
                    </button>
                  ) : (
                    <span className="label tabular-nums md:hidden">{pad(i + 1)}</span>
                  )}
                  {hasPreview ? (
                    <button type="button" onClick={view} data-cursor="link" className="text-left">
                      <span className="display block text-xl leading-snug transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-2 md:text-3xl">{l(d.title)}</span>
                      <span className="label mt-2 inline-block">{t('docs.view')} →</span>
                    </button>
                  ) : (
                    <span className="display text-xl leading-snug md:text-3xl">{l(d.title)}</span>
                  )}
                  <span className="label hidden text-right md:block">{fmtSize(d.size)}</span>
                  <a href={pdfUrl(d)} target="_blank" rel="noopener" data-cursor="link" aria-label={`${t('docs.download')}: ${l(d.title)}`} className="flex items-center gap-3">
                    <span className="label hidden !text-bone sm:inline">PDF</span>
                    <span className="grid h-11 w-11 place-items-center rounded-full border border-line transition-colors duration-500 hover:bg-bone hover:text-ink md:h-12 md:w-12">↓</span>
                  </a>
                </div>
              </FadeUp>
            </li>
          )
        })}
      </ul>
      {open !== null && shown[open] && <DocViewer docs={shown} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

/** Full-screen certificate image with prev/next and a PDF download. */
function DocViewer({ docs, index, onIndex, onClose }: { docs: Doc[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const { l, t } = useLang()
  const d = docs[index]!
  const many = docs.length > 1
  const close = () => gsap.to(root.current, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.6, ease: 'expo.inOut', onComplete: onClose })
  const go = (step: number) => onIndex((index + step + docs.length) % docs.length)

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

  return createPortal(
    <div ref={root} className="tone-dark fixed inset-0 z-[95] flex flex-col bg-ink/95 backdrop-blur" role="dialog" aria-modal="true" aria-label={l(d.title)}>
      <div className="flex items-center justify-between gap-6 px-5 py-5 md:px-10">
        <span className="label min-w-0 truncate">
          {many && `${pad(index + 1)} / ${pad(docs.length)} — `}
          {l(d.title)}
        </span>
        <button onClick={close} className="label link-line shrink-0 !text-bone">
          {t('close')} ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 md:px-24" data-lenis-prevent>
        <img key={d.file} src={previewUrl(d)} alt={l(d.title)} className="h-full max-h-full w-auto max-w-full rounded-sm bg-white object-contain shadow-2xl" />
        {many && (
          <>
            <button onClick={() => go(-1)} className="absolute left-2 top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink/60 hover:bg-bone hover:text-ink md:left-8" aria-label="Prev">
              ←
            </button>
            <button onClick={() => go(1)} className="absolute right-2 top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink/60 hover:bg-bone hover:text-ink md:right-8" aria-label="Next">
              →
            </button>
          </>
        )}
      </div>
      <div className="flex justify-center px-5 py-5 md:py-6">
        <a href={pdfUrl(d)} target="_blank" rel="noopener" className="label rounded-full border border-line px-6 py-3 !text-bone transition-colors duration-500 hover:bg-bone hover:!text-ink">
          {t('docs.download')} ↓
        </a>
      </div>
    </div>,
    document.body,
  )
}
