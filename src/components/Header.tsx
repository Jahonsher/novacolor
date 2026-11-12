import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useLocation } from 'react-router'
import { TLink, useTransition } from './Transition'
import { asset, categories, contacts, pad } from '../data'
import { useLang, type Key } from '../i18n'
import { gsap, useGSAP, lenis, scroll } from '../lib/motion'

export const NAV: { to: string; key: Key }[] = [
  { to: '/', key: 'nav.home' },
  { to: '/products', key: 'nav.products' },
  { to: '/about', key: 'nav.about' },
  { to: '/news', key: 'nav.news' },
  { to: '/contact', key: 'nav.contact' },
]

/** Segmented UZ / RU control; the active language sits on a glass droplet. */
function LangSwitch({ glass = false }: { glass?: boolean }) {
  const { lang, setLang } = useLang()
  const { run } = useTransition()
  const change = (l: 'uz' | 'ru') => l !== lang && void run(() => setLang(l))
  return (
    <div className={`label flex items-center !text-bone ${glass ? 'gap-0.5 rounded-full bg-white/[0.04] p-1' : 'gap-2'}`}>
      {(['uz', 'ru'] as const).map((l) => (
        <button
          key={l}
          onClick={() => change(l)}
          aria-pressed={l === lang}
          className={`rounded-full px-3 py-1.5 transition-[opacity,background-color,transform] duration-500 active:scale-90 ${
            l === lang ? `opacity-100 ${glass ? 'glass-chip' : ''}` : 'opacity-50 hover:opacity-90'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/** SVG filter used by Chromium to refract what's behind the glass. */
function LiquidFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="nc-liquid" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="7" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="38" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

const supportsRefraction = () =>
  typeof window !== 'undefined' &&
  /Chrome\//.test(navigator.userAgent) &&
  !/Edg\/|OPR\//.test(navigator.userAgent) &&
  CSS.supports('backdrop-filter', 'url(#a) blur(1px)')

export function Header() {
  const { t } = useLang()
  const { pathname } = useLocation()
  const bar = useRef<HTMLElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [refract] = useState(supportsRefraction)
  const activeIndex = NAV.slice(1).findIndex((n) => pathname.startsWith(n.to))

  // hide on scroll down, show on scroll up
  useEffect(() => {
    let last = 0
    let hidden = false
    const onTick = () => {
      const y = scroll.y
      const down = y > last + 2 && y > 160
      const up = y < last - 2
      if (down && !hidden) {
        hidden = true
        gsap.to(bar.current, { yPercent: -160, duration: 0.9, ease: 'expo.out' })
      } else if ((up || y < 160) && hidden) {
        hidden = false
        gsap.to(bar.current, { yPercent: 0, duration: 0.9, ease: 'expo.out' })
      }
      last = y
    }
    gsap.ticker.add(onTick)
    return () => gsap.ticker.remove(onTick)
  }, [])

  // specular highlight follows the pointer across the glass
  const onGlassMove = (e: RPointerEvent) => {
    const el = glass.current!
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
    el.style.setProperty('--hl', '1')
  }
  const onGlassLeave = () => glass.current!.style.setProperty('--hl', '0')

  // the lens droplet glides (with a little squash) to the hovered / active link
  const moveLens = (target: HTMLElement | null, instant = false) => {
    const l = lens.current
    const n = nav.current
    if (!l || !n) return
    if (!target) {
      gsap.to(l, { autoAlpha: 0, scale: 0.6, duration: 0.4, ease: 'power3.out' })
      return
    }
    const nr = n.getBoundingClientRect()
    const tr = target.getBoundingClientRect()
    const vars = { x: tr.left - nr.left, width: tr.width, autoAlpha: 1, scale: 1 }
    if (instant) gsap.set(l, vars)
    else
      gsap
        .timeline()
        .to(l, { ...vars, duration: 0.7, ease: 'elastic.out(1, 0.75)' })
        .fromTo(l, { scaleY: 0.82 }, { scaleY: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.5)' }, 0)
  }
  const activeLink = () => (activeIndex >= 0 ? nav.current?.querySelectorAll<HTMLElement>('[data-navlink]')[activeIndex] ?? null : null)

  useEffect(() => {
    // after fonts settle, park the lens under the current page
    const id = setTimeout(() => moveLens(activeLink(), true), 50)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <>
      <LiquidFilter />
      <header ref={bar} className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6 md:pt-5">
        <div
          ref={glass}
          onPointerMove={onGlassMove}
          onPointerLeave={onGlassLeave}
          className={`glass ${refract ? 'glass-refract' : ''} pointer-events-auto mx-auto flex max-w-[1240px] items-center justify-between gap-4 rounded-full py-2 pl-5 pr-2 md:py-2.5 md:pl-7 md:pr-2.5`}
        >
          <TLink to="/" aria-label="Novacolor" data-cursor="link" className="shrink-0 transition-transform duration-500 active:scale-95">
            <img src={asset('img/logo.png')} alt="Novacolor" className="h-6 w-auto drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)] md:h-7" />
          </TLink>

          <nav ref={nav} className="relative hidden items-center lg:flex" onPointerLeave={() => moveLens(activeLink())}>
            <span ref={lens} className="glass-chip pointer-events-none invisible absolute left-0 top-0 h-full rounded-full" aria-hidden />
            {NAV.slice(1).map((n, i) => (
              <TLink
                key={n.to}
                to={n.to}
                data-navlink
                onPointerEnter={(e) => moveLens(e.currentTarget)}
                className="label relative z-[1] flex items-baseline gap-1.5 rounded-full px-4 py-2.5 !text-bone transition-transform duration-300 active:scale-95"
              >
                <span className="text-[9px] text-bone/50">{pad(i + 1)}</span>
                <span className={i === activeIndex ? 'text-bone' : 'text-bone/85'}>{t(n.key)}</span>
              </TLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden sm:block">
              <LangSwitch glass />
            </div>
            <button
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className="glass-chip label group flex items-center gap-3 rounded-full py-2.5 pl-4 pr-3.5 !text-bone transition-transform duration-300 hover:scale-[1.03] active:scale-95"
            >
              <span>{t('menu')}</span>
              <span className="flex w-5 flex-col gap-[4px]">
                <span className="h-px w-full bg-bone transition-transform duration-500 group-hover:scale-x-75" />
                <span className="h-px w-full origin-right bg-bone transition-transform duration-500 group-hover:scale-x-50" />
              </span>
            </button>
          </div>
        </div>
      </header>
      <Menu open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, l } = useLang()
  const root = useRef<HTMLDivElement>(null)
  const tl = useRef<gsap.core.Timeline>(null)
  const [hover, setHover] = useState(0)
  const { pathname } = useLocation()

  useGSAP(
    () => {
      const el = root.current!
      tl.current = gsap
        .timeline({ paused: true })
        .set(el, { autoAlpha: 1 })
        .fromTo(el, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'expo.inOut' })
        .from(el.querySelectorAll('[data-item]'), { yPercent: 120, rotate: 4, duration: 1.1, ease: 'expo.out', stagger: 0.06 }, '-=0.45')
        .from(el.querySelectorAll('[data-fade]'), { autoAlpha: 0, y: 20, duration: 0.8, ease: 'expo.out', stagger: 0.05 }, '<0.2')
        .from(el.querySelector('[data-visual]'), { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.2, ease: 'expo.inOut' }, 0.3)
    },
    { scope: root },
  )

  useEffect(() => {
    if (!tl.current) return
    if (open) {
      lenis?.stop()
      tl.current.timeScale(1).play()
    } else {
      lenis?.start()
      tl.current.timeScale(1.6).reverse()
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visual = categories[hover % categories.length]

  return (
    <div ref={root} className="invisible fixed inset-0 z-[80] flex flex-col bg-char" role="dialog" aria-modal="true" aria-hidden={!open}>
      <div className="flex items-center justify-between px-5 py-5 md:px-10 md:py-7">
        <img data-fade src={asset('img/logo.png')} alt="Novacolor" className="h-7 w-auto md:h-8" />
        <button data-fade onClick={onClose} className="label group flex items-center gap-3 !text-bone">
          {t('close')}
          <span className="relative block h-4 w-4">
            <span className="absolute left-0 top-1/2 h-px w-full rotate-45 bg-bone transition-transform duration-500 group-hover:rotate-[135deg]" />
            <span className="absolute left-0 top-1/2 h-px w-full -rotate-45 bg-bone transition-transform duration-500 group-hover:rotate-45" />
          </span>
        </button>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-10 px-5 pb-8 md:px-10 lg:grid-cols-12">
        <nav className="flex flex-col justify-center lg:col-span-7">
          {NAV.map((n, i) => {
            const active = n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)
            return (
              <div key={n.to} className="overflow-hidden">
                <TLink
                  to={n.to}
                  data-item
                  onClick={onClose}
                  onMouseEnter={() => setHover(i)}
                  className="group flex items-baseline gap-4 py-1 md:gap-6"
                >
                  <span className="label w-6">{pad(i + 1)}</span>
                  <span className={`display text-[13vw] leading-[1] transition-[color,transform] duration-700 ease-[var(--ease-expo)] group-hover:translate-x-4 group-hover:italic md:text-[7.2vw] lg:text-[5.6vw] ${active ? 'text-sand' : 'text-bone'}`}>
                    {t(n.key)}
                  </span>
                </TLink>
              </div>
            )
          })}
        </nav>
        <div className="hidden flex-col justify-center lg:col-span-5 lg:flex">
          <div data-visual className="relative aspect-[4/5] w-full overflow-hidden">
            {categories.map((c) => (
              <img
                key={c.id}
                src={asset(c.image)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-1000 ease-[var(--ease-expo)]"
                style={{ opacity: c.id === visual.id ? 1 : 0, transform: c.id === visual.id ? 'scale(1)' : 'scale(1.12)' }}
              />
            ))}
            <span className="label absolute bottom-4 left-4 !text-bone">{l(visual.name)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-6 border-t border-line px-5 py-6 md:px-10">
        <div data-fade className="flex flex-wrap gap-x-10 gap-y-2 text-sm text-ash">
          <a href={contacts.phoneHref} className="link-line text-bone">
            {contacts.phone}
          </a>
          <a href={contacts.telegram} target="_blank" rel="noreferrer" className="link-line">
            Telegram
          </a>
          <a href={contacts.instagram} target="_blank" rel="noreferrer" className="link-line">
            Instagram
          </a>
          <span>{l(contacts.address)}</span>
        </div>
        <div data-fade>
          <LangSwitch />
        </div>
      </div>
    </div>
  )
}
