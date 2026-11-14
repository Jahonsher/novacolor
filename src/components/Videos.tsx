import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { asset, INSTAGRAM_PROFILE, instagramId, pad, type Video } from '../data'
import { formatDate, useLang } from '../i18n'
import { gsap, lenis, reducedMotion, useGSAP } from '../lib/motion'
import { getQuality, onQuality, useQuality } from '../lib/perf'
import { InstagramIcon } from './InstagramIcon'
import { Reveal } from './Reveal'
import { SectionHead } from './Blocks'

/*
 * Videos ("From Instagram"). Plain DOM, never the WebGL image layer, and no per-frame JS: everything is
 * driven by IntersectionObserver / visibilitychange / quality-change events.
 *
 * - Self-hosted files (`src`): muted looping <video>, plays only while ≥ 50 % visible (and the tab is
 *   visible, quality ≥ 2, no reduced motion, no lightbox open). Click → fullscreen player with sound.
 * - Instagram-only items: Instagram's own embed player in the card, cropped to the media box. The iframe
 *   is created only near the viewport and at most MAX_EMBEDS exist at once — no request to Instagram
 *   before that.
 */

/* ---------------- inline <video> playback ---------------- */

const inline = new Set<HTMLVideoElement>()
const visible = new WeakSet<HTMLVideoElement>()
let lightboxOpen = false
const canAutoplay = () => !reducedMotion && !document.hidden && !lightboxOpen && getQuality() >= 2

function sync(v: HTMLVideoElement) {
  if (visible.has(v) && canAutoplay()) {
    if (v.paused) v.play().catch(() => undefined)
  } else if (!v.paused) v.pause()
}
const syncAll = () => inline.forEach(sync)

let playIO: IntersectionObserver | null = null
function watchVideo(v: HTMLVideoElement) {
  if (!playIO) {
    playIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLVideoElement
          if (e.isIntersecting && e.intersectionRatio >= 0.5) visible.add(el)
          else visible.delete(el)
          sync(el)
        }
      },
      { threshold: [0, 0.5] },
    )
    document.addEventListener('visibilitychange', syncAll)
    onQuality(syncAll)
  }
  inline.add(v)
  playIO.observe(v)
  return () => {
    playIO?.unobserve(v)
    inline.delete(v)
    visible.delete(v)
    v.pause()
  }
}

/* ---------------- Instagram embeds: lazy, at most MAX_EMBEDS alive ---------------- */

const MAX_EMBEDS = 3
/**
 * A card is "near" when its row is within about one viewport vertically AND the card is within one row
 * width of the row's visible part horizontally. (IntersectionObserver's rootMargin doesn't extend past a
 * scrolling ancestor's clip, so the horizontal part is measured on the row's scroll events.)
 */
type Slot = { el: HTMLElement; row: HTMLElement | null; seen: boolean; live: boolean; set: (live: boolean) => void }
const slots = new Set<Slot>()
const nearRows = new Set<Element>()
const slotOf = new WeakMap<Element, Slot>()
const rowRefs = new Map<HTMLElement, number>()
let rowIO: IntersectionObserver | null = null
let seenIO: IntersectionObserver | null = null
let pending = 0

function isNear(s: Slot) {
  if (!s.row) return s.seen
  if (!nearRows.has(s.row)) return false
  const r = s.el.getBoundingClientRect()
  const box = s.row.getBoundingClientRect()
  return r.right > box.left - box.width && r.left < box.right + box.width
}

/** Visible cards first, then the nearest ones; everything else is unmounted. Runs on IO / row-scroll events. */
function assignEmbeds() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const dist = (s: Slot) => {
    const r = s.el.getBoundingClientRect()
    return Math.hypot(Math.max(0, r.left - vw, -r.right), Math.max(0, r.top - vh, -r.bottom))
  }
  const ranked = [...slots].filter(isNear).sort((a, b) => Number(b.seen) - Number(a.seen) || dist(a) - dist(b))
  const keep = new Set(ranked.slice(0, MAX_EMBEDS))
  for (const s of slots) {
    const live = keep.has(s)
    if (live !== s.live) {
      s.live = live
      s.set(live)
    }
  }
}
// row scrolling: settle first (cheap, but no need to run on every scroll event)
const scheduleAssign = () => {
  clearTimeout(pending)
  pending = window.setTimeout(assignEmbeds, 120)
}

function watchEmbed(el: HTMLElement, set: (live: boolean) => void) {
  if (!rowIO || !seenIO) {
    rowIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) nearRows.add(e.target)
          else nearRows.delete(e.target)
        }
        assignEmbeds()
      },
      { rootMargin: '100% 0px 100% 0px' },
    )
    seenIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = slotOf.get(e.target)
        if (s) s.seen = e.isIntersecting
      }
      assignEmbeds()
    })
  }
  const row = el.closest<HTMLElement>('[data-video-row]')
  if (row) {
    const n = rowRefs.get(row) ?? 0
    if (!n) {
      rowIO.observe(row)
      row.addEventListener('scroll', scheduleAssign, { passive: true })
    }
    rowRefs.set(row, n + 1)
  }
  const s: Slot = { el, row, seen: false, live: false, set }
  slots.add(s)
  slotOf.set(el, s)
  seenIO.observe(el)
  return () => {
    seenIO?.unobserve(el)
    slots.delete(s)
    if (row) {
      const n = (rowRefs.get(row) ?? 1) - 1
      if (n) rowRefs.set(row, n)
      else {
        rowRefs.delete(row)
        rowIO?.unobserve(row)
        nearRows.delete(row)
        row.removeEventListener('scroll', scheduleAssign)
      }
    }
    assignEmbeds()
  }
}

/**
 * Crop of Instagram's embed page (`/p/<id>/embed/`) to the video. The page is cross-origin, so the iframe
 * is made bigger than the card and shifted inside an `overflow: hidden` box. Measured layout (Nov 2026, the
 * same for every width and post): a 54px header row (avatar + name), then the media box — full iframe
 * width, 4:5 — then ~154px of footer (likes, "View more on Instagram", comments). A reel's 9:16 video is
 * letterboxed inside the 4:5 box, so for a 9:16 card the iframe is widened until the video's height equals
 * the box's height (W = cardH / 1.25) and centred: the side bars, the header and the footer all fall
 * outside the card. Tapping still reaches the iframe and plays the video there (no autoplay — Instagram's rule).
 */
const IG_HEADER = 54
const IG_MEDIA = 1.25
const IG_FOOTER = 154
function embedCrop(cardW: number, cardAspect: number): CSSProperties {
  const cardH = cardW * cardAspect
  const w = Math.ceil(cardH / IG_MEDIA)
  return {
    left: -Math.round((w - cardW) / 2),
    top: -IG_HEADER,
    width: w,
    // the whole embed document fits, so it never scrolls inside the card
    height: IG_HEADER + Math.ceil(w * IG_MEDIA) + IG_FOOTER + 40,
  }
}

/* ---------------- components ---------------- */

/** Reels are vertical; the card always uses 9:16. */
const ASPECT = 16 / 9

function Placeholder({ v, title }: { v: Video; title: string }) {
  if (v.poster) return <img src={asset(v.poster)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
  return (
    <div className="absolute inset-0 flex flex-col justify-between bg-[radial-gradient(120%_80%_at_20%_0%,rgba(194,165,124,0.35),transparent_60%),radial-gradient(90%_70%_at_100%_100%,rgba(236,231,223,0.12),transparent_60%)] p-5">
      <InstagramIcon className="size-7 text-bone/80" />
      <p className="display text-2xl leading-tight text-bone/90">{title}</p>
    </div>
  )
}

const playIcon = (
  <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor" aria-hidden>
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)

function FileCard({ v, title, onOpen }: { v: Video; title: string; onOpen: () => void }) {
  const { t } = useLang()
  const ref = useRef<HTMLVideoElement>(null)
  const quality = useQuality()
  const still = quality <= 1 || reducedMotion
  useEffect(() => (ref.current ? watchVideo(ref.current) : undefined), [])
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block aspect-[9/16] w-full overflow-hidden bg-char text-left"
      data-cursor={t('videos.play')}
      aria-label={`${t('videos.play')}: ${title}`}
    >
      <video
        ref={ref}
        // no poster → let the browser fetch just enough to show the first frame
        src={v.poster ? asset(v.src!) : `${asset(v.src!)}#t=0.1`}
        poster={v.poster ? asset(v.poster) : undefined}
        preload={v.poster ? 'none' : 'metadata'}
        muted
        loop
        playsInline
        disablePictureInPicture
        tabIndex={-1}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-[var(--ease-expo)] group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink/60 to-transparent" />
      <span
        className={`pointer-events-none absolute left-4 top-4 grid h-12 w-12 place-items-center rounded-full border border-bone/50 text-bone backdrop-blur-sm transition-opacity duration-500 ${
          still ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
        }`}
      >
        {playIcon}
      </span>
    </button>
  )
}

function InstagramCard({ v, title }: { v: Video; title: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const loadedRef = useRef(false)
  const id = instagramId(v.instagram)

  useEffect(() => {
    const el = box.current
    if (!el || !id) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    let timer = 0
    const stop = watchEmbed(el, (on) => {
      setLive(on)
      clearTimeout(timer)
      loadedRef.current = false
      setLoaded(false) // unmounted far off-screen → loads again when it comes back
      // no load event at all (blocked / offline): keep the placeholder; the link under the card still works
      if (on) timer = window.setTimeout(() => !loadedRef.current && setFailed(true), 20_000)
    })
    return () => {
      clearTimeout(timer)
      ro.disconnect()
      stop()
    }
  }, [id])

  return (
    <div ref={box} className="relative aspect-[9/16] w-full overflow-hidden bg-char">
      <Placeholder v={v} title={title} />
      {id && live && !failed && width > 0 && (
        <iframe
          src={`https://www.instagram.com/p/${id}/embed/`}
          title={title}
          scrolling="no"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            loadedRef.current = true
            setLoaded(true)
          }}
          className={`absolute max-w-none border-0 transition-opacity duration-700 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          style={embedCrop(width, ASPECT)}
        />
      )}
    </div>
  )
}

function VideoCard({ v, i, onOpen }: { v: Video; i: number; onOpen: () => void }) {
  const { t, l, lang } = useLang()
  const title = l(v.title) || v.title.uz
  return (
    <figure className="w-[64vw] shrink-0 snap-start sm:w-[40vw] md:w-auto md:basis-[calc((100%-3rem)/3)]">
      {v.src ? <FileCard v={v} title={title} onOpen={onOpen} /> : <InstagramCard v={v} title={title} />}
      <figcaption className="mt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="display line-clamp-2 text-2xl md:text-3xl">{title}</h3>
          <span className="label shrink-0">{pad(i + 1)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {v.date && <span className="text-sm text-ash">{formatDate(v.date, lang)}</span>}
          {v.instagram && (
            <a href={v.instagram} target="_blank" rel="noopener noreferrer" className="label link-line !text-bone" data-cursor="link">
              {t('videos.open')} ↗
            </a>
          )}
        </div>
      </figcaption>
    </figure>
  )
}

/** Horizontal, swipeable row of 9:16 cards (+ arrows on desktop when it overflows). */
export function VideoRow({ items, wide = false }: { items: Video[]; wide?: boolean }) {
  const { t } = useLang()
  const row = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const [open, setOpen] = useState<number | null>(null)
  const files = items.filter((v) => v.src)

  useEffect(() => {
    const el = row.current!
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 })
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [items.length])

  const step = (dir: 1 | -1) => {
    const el = row.current!
    const card = el.firstElementChild as HTMLElement | null
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 300) + 24), behavior: reducedMotion ? 'auto' : 'smooth' })
  }
  const arrow = 'grid h-12 w-12 place-items-center rounded-full border border-line transition-colors duration-500 hover:bg-bone hover:text-ink disabled:pointer-events-none disabled:opacity-30'

  return (
    <div className="relative">
      <div
        ref={row}
        // horizontal swipes / trackpad gestures scroll the row natively; vertical ones still scroll the page (Lenis)
        data-lenis-prevent-horizontal
        data-video-row
        className={`-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-px-5 px-5 pb-2 [scrollbar-width:none] md:mx-0 md:gap-6 md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden ${
          wide ? 'md:[&>figure]:basis-[calc((100%-4.5rem)/4)]' : ''
        }`}
      >
        {items.map((v, i) => (
          <VideoCard key={v.id} v={v} i={i} onOpen={() => setOpen(files.indexOf(v))} />
        ))}
      </div>
      {!(edges.start && edges.end) && (
        <div className="mt-6 hidden justify-end gap-3 md:flex">
          <button type="button" className={arrow} onClick={() => step(-1)} disabled={edges.start} aria-label={t('videos.prev')}>
            ←
          </button>
          <button type="button" className={arrow} onClick={() => step(1)} disabled={edges.end} aria-label={t('videos.next')}>
            →
          </button>
        </div>
      )}
      {open !== null && open >= 0 && <VideoLightbox items={files} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Home page section "04 — From Instagram". */
export function VideoSection({ items, index }: { items: Video[]; index: string }) {
  const { t } = useLang()
  const handle = '@' + INSTAGRAM_PROFILE.replace(/\/+$/, '').split('/').pop()
  return (
    <section className="px-5 py-28 md:px-10 md:py-36">
      <SectionHead index={index} label={t('videos.label')}>
        <a href={INSTAGRAM_PROFILE} target="_blank" rel="noopener noreferrer" className="label link-line !text-bone" data-cursor="link">
          {handle} ↗
        </a>
      </SectionHead>
      {/* mobile: title → videos → text + button; desktop: text column on the left, videos on the right */}
      <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-12 md:grid-rows-[auto_1fr] md:gap-x-6 md:gap-y-8">
        <Reveal as="h2" by="words" className="display text-6xl md:col-span-4 md:pr-8 md:text-[5vw]">
          {t('videos.title')}
        </Reveal>
        <div className="min-w-0 md:col-span-8 md:col-start-5 md:row-span-2 md:row-start-1">
          <VideoRow items={items} />
        </div>
        <div className="flex flex-col gap-8 md:col-span-4 md:row-start-2 md:self-end md:pr-8">
          <p className="max-w-sm text-sm leading-relaxed text-ash">{t('videos.text')}</p>
          <a
            href={INSTAGRAM_PROFILE}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative inline-flex w-max items-center gap-3 overflow-hidden rounded-full border border-bone/40 px-6 py-4"
            data-cursor="link"
          >
            <span className="absolute inset-0 translate-y-full rounded-full bg-bone transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-y-0" />
            <InstagramIcon className="relative size-5 transition-colors duration-500 group-hover:text-ink" />
            <span className="label relative !text-bone transition-colors duration-500 group-hover:!text-ink">{t('videos.profile')}</span>
          </a>
        </div>
      </div>
    </section>
  )
}

/** Fullscreen player for self-hosted videos: sound, native controls, ←/→ between videos. */
function VideoLightbox({ items, index, onIndex, onClose }: { items: Video[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const player = useRef<HTMLVideoElement>(null)
  const { t, l } = useLang()
  const v = items[index]!
  const title = l(v.title) || v.title.uz
  const close = () => {
    player.current?.pause()
    gsap.to(root.current, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.7, ease: 'expo.inOut', onComplete: onClose })
  }
  const go = (d: number) => onIndex((index + d + items.length) % items.length)

  useEffect(() => {
    lightboxOpen = true
    syncAll()
    lenis?.stop()
    gsap.fromTo(root.current, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'expo.inOut' })
    // the tab going to the background pauses the big player too
    const onHide = () => document.hidden && player.current?.pause()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      lightboxOpen = false
      lenis?.start()
      syncAll()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (items.length > 1 && e.key === 'ArrowRight') go(1)
      if (items.length > 1 && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // opened by a click → playing with sound is allowed; if the browser still refuses, controls are there
  useEffect(() => {
    player.current?.play().catch(() => undefined)
  }, [index])

  useGSAP(() => {
    gsap.fromTo(root.current!.querySelector('[data-player]'), { scale: 1.05, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.9, ease: 'expo.out' })
  }, { dependencies: [index], scope: root })

  const nav = 'absolute top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-line bg-ink/40 hover:bg-bone hover:text-ink'
  return createPortal(
    <div ref={root} className="fixed inset-0 z-[95] flex flex-col bg-ink/95 backdrop-blur" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-6 px-5 py-5 md:px-10">
        <span className="label min-w-0 truncate">
          {title}
          {items.length > 1 && ` — ${pad(index + 1)} / ${pad(items.length)}`}
        </span>
        <div className="flex shrink-0 items-center gap-6">
          {v.instagram && (
            <a href={v.instagram} target="_blank" rel="noopener noreferrer" className="label link-line hidden !text-bone sm:inline">
              {t('videos.open')} ↗
            </a>
          )}
          <button type="button" onClick={close} className="label link-line !text-bone">
            {t('close')} ✕
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-8 md:px-24">
        <video
          data-player
          ref={player}
          key={v.id}
          src={asset(v.src!)}
          poster={v.poster ? asset(v.poster) : undefined}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="h-full max-h-full w-auto max-w-full bg-char object-contain"
        />
        {items.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${nav} left-2 md:left-8`} aria-label={t('videos.prev')}>
              ←
            </button>
            <button type="button" onClick={() => go(1)} className={`${nav} right-2 md:right-8`} aria-label={t('videos.next')}>
              →
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
