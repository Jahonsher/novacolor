import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { useLocation } from 'react-router'
import { TLink, useTransition } from './Transition'
import { asset, categories, contacts, pad } from '../data'
import { useLang, type Key } from '../i18n'
import { gsap, lenis } from '../lib/motion'

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
  const glass = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [light, setLight] = useState(false)
  const [refract] = useState(supportsRefraction)
  const openRef = useRef(false)
  openRef.current = open
  const activeIndex = NAV.slice(1).findIndex((n) => pathname.startsWith(n.to))

  // the bar is always on screen; it turns into light glass over light sections (like iOS)
  useEffect(() => {
    let frame = 0
    let current = false
    const tick = () => {
      if (++frame % 4) return
      const g = glass.current
      if (!g) return
      const r = g.getBoundingClientRect()
      const y = r.top + r.height / 2
      let over = false
      if (!openRef.current) {
        for (const s of document.querySelectorAll<HTMLElement>('.tone-light, .tone-sand')) {
          const sr = s.getBoundingClientRect()
          if (sr.top <= y && sr.bottom >= y && sr.left < r.right && sr.right > r.left) {
            over = true
            break
          }
        }
      }
      if (over !== current) {
        current = over
        setLight(over)
      }
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
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

  const isLight = light && !open

  return (
    <>
      <LiquidFilter />
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6 md:pt-5">
        <div
          ref={glass}
          onPointerMove={onGlassMove}
          onPointerLeave={onGlassLeave}
          className={`glass ${refract ? 'glass-refract' : ''} ${isLight ? 'is-light ui-on-light' : ''} pointer-events-auto mx-auto flex max-w-[1240px] items-center justify-between gap-4 rounded-full py-2 pl-5 pr-2 md:py-2.5 md:pl-7 md:pr-2.5`}
        >
          <TLink to="/" aria-label="Novacolor" data-cursor="link" className="shrink-0 transition-transform duration-500 active:scale-95" onClick={() => setOpen(false)}>
            <img src={asset('img/logo.png')} alt="Novacolor" className="logo h-6 w-auto md:h-7" />
          </TLink>

          <nav ref={nav} className="relative hidden items-center lg:flex" onPointerLeave={() => moveLens(activeLink())}>
            <span ref={lens} className="glass-chip pointer-events-none invisible absolute left-0 top-0 h-full rounded-full" aria-hidden />
            {NAV.slice(1).map((n, i) => (
              <TLink
                key={n.to}
                to={n.to}
                data-navlink
                onClick={() => setOpen(false)}
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
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="glass-chip label group flex items-center gap-3 rounded-full py-2.5 pl-4 pr-3.5 !text-bone transition-transform duration-300 hover:scale-[1.03] active:scale-95"
            >
              <span className="w-12 text-center">{open ? t('close') : t('menu')}</span>
              <span className="relative block h-2.5 w-5">
                <span
                  className="absolute left-0 h-px w-full bg-bone transition-transform duration-700 ease-[var(--ease-expo)]"
                  style={{ top: open ? '50%' : '0%', transform: open ? 'rotate(45deg)' : 'none' }}
                />
                <span
                  className="absolute left-0 h-px w-full origin-center bg-bone transition-transform duration-700 ease-[var(--ease-expo)]"
                  style={{ top: open ? '50%' : '100%', transform: open ? 'rotate(-45deg)' : 'none' }}
                />
              </span>
            </button>
          </div>
        </div>
      </header>
      <Menu open={open} onClose={() => setOpen(false)} capsule={glass} refract={refract} />
    </>
  )
}

/**
 * Liquid-glass dropdown: the panel is born from the navbar capsule and
 * "pours" downward with an elastic, droplet-shaped bottom edge. It's
 * translucent, so the page stays visible (blurred) behind it.
 */
function Menu({ open, onClose, capsule, refract }: { open: boolean; onClose: () => void; capsule: RefObject<HTMLDivElement | null>; refract: boolean }) {
  const { t, l } = useLang()
  const panel = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(0)
  const { pathname } = useLocation()
  const mounted = useRef(false)

  useEffect(() => {
    const p = panel.current!
    const c = content.current!
    const bd = backdrop.current!
    const items = p.querySelectorAll('[data-item]')
    const fades = p.querySelectorAll('[data-fade]')
    if (!mounted.current) {
      mounted.current = true
      if (!open) return
    }
    const capH = capsule.current?.offsetHeight ?? 60
    const r = capH / 2
    const corners = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const
    const all = (v: string) => Object.fromEntries(corners.map((k) => [k, v]))
    gsap.killTweensOf([p, bd, ...items, ...fades])

    if (open) {
      lenis?.stop()
      c.style.paddingTop = `${capH + 28}px`
      const top = p.getBoundingClientRect().top
      const target = Math.min(c.scrollHeight, window.innerHeight - top - 12)
      const w = p.offsetWidth
      gsap
        .timeline()
        .set(p, { autoAlpha: 1, height: capH, scaleX: 1, ...all(`${r}px ${r}px`) })
        .set(bd, { autoAlpha: 1 })
        .fromTo(bd, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0)
        // liquid pours down: elastic stretch…
        .to(p, { height: target, duration: 1.35, ease: 'elastic.out(1, 0.6)' }, 0)
        // …with a droplet-shaped bottom that settles into soft corners
        .to(p, { borderBottomLeftRadius: `${w * 0.48}px 90px`, borderBottomRightRadius: `${w * 0.48}px 90px`, duration: 0.32, ease: 'power2.out' }, 0)
        .to(p, { ...all('36px 36px'), duration: 0.9, ease: 'elastic.out(1, 0.45)' }, 0.32)
        .fromTo(p, { scaleX: 0.97 }, { scaleX: 1, duration: 1.1, ease: 'elastic.out(1, 0.4)' }, 0)
        .fromTo(items, { yPercent: 120, rotate: 3 }, { yPercent: 0, rotate: 0, duration: 1, ease: 'expo.out', stagger: 0.05 }, 0.2)
        .fromTo(fades, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'expo.out', stagger: 0.05 }, 0.32)
    } else {
      lenis?.start()
      gsap
        .timeline()
        .to(fades, { autoAlpha: 0, duration: 0.2 }, 0)
        .to(items, { yPercent: -120, duration: 0.35, ease: 'power3.in', stagger: 0.02 }, 0)
        .to(p, { borderBottomLeftRadius: `${p.offsetWidth * 0.48}px 70px`, borderBottomRightRadius: `${p.offsetWidth * 0.48}px 70px`, duration: 0.25, ease: 'power2.in' }, 0.1)
        .to(p, { height: capH, ...all(`${r}px ${r}px`), scaleX: 0.985, duration: 0.55, ease: 'power3.inOut' }, 0.18)
        .to(bd, { autoAlpha: 0, duration: 0.4 }, 0.2)
        .set(p, { autoAlpha: 0, scaleX: 1 })
    }
  }, [open, capsule])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visual = categories[hover % categories.length]

  return (
    <>
      <div ref={backdrop} onClick={onClose} className="invisible fixed inset-0 z-[48] bg-black/15" aria-hidden />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[49] px-3 pt-3 md:px-6 md:pt-5">
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={t('menu')}
          aria-hidden={!open}
          className={`glass glass-panel ${refract ? 'glass-refract' : ''} pointer-events-auto invisible mx-auto max-w-[1240px] origin-top overflow-hidden`}
        >
          <div ref={content} className="h-full overflow-y-auto" data-lenis-prevent>
            <div className="grid gap-8 px-6 pb-8 md:grid-cols-12 md:gap-10 md:px-10 md:pb-10">
              <nav className="md:col-span-7">
                {NAV.map((n, i) => {
                  const active = n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)
                  return (
                    <div key={n.to} className="overflow-hidden">
                      <TLink to={n.to} data-item onClick={onClose} onMouseEnter={() => setHover(i)} className="group flex items-baseline gap-4 py-1 md:gap-6">
                        <span className="label w-6">{pad(i + 1)}</span>
                        <span
                          className={`display text-[12vw] leading-[1.02] drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] transition-[color,transform] duration-700 ease-[var(--ease-expo)] group-hover:translate-x-3 group-hover:italic md:text-6xl lg:text-7xl ${active ? 'text-sand' : 'text-bone'}`}
                        >
                          {t(n.key)}
                        </span>
                      </TLink>
                    </div>
                  )
                })}
              </nav>
              <div className="flex flex-col justify-between gap-6 md:col-span-5">
                <div data-fade className="relative hidden aspect-[4/3] overflow-hidden rounded-[24px] md:block">
                  {categories.map((c) => (
                    <img
                      key={c.id}
                      src={asset(c.image)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-1000 ease-[var(--ease-expo)]"
                      style={{ opacity: c.id === visual.id ? 1 : 0, transform: c.id === visual.id ? 'scale(1)' : 'scale(1.12)' }}
                    />
                  ))}
                  <span className="label absolute bottom-4 left-4 rounded-full bg-black/30 px-3 py-1.5 !text-bone backdrop-blur">{l(visual.name)}</span>
                </div>
                <div data-fade className="space-y-2 text-sm text-ash">
                  <a href={contacts.phoneHref} className="link-line display block text-3xl text-bone">
                    {contacts.phone}
                  </a>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <a href={contacts.telegram} target="_blank" rel="noreferrer" className="link-line">
                      Telegram ↗
                    </a>
                    <a href={contacts.instagram} target="_blank" rel="noreferrer" className="link-line">
                      Instagram ↗
                    </a>
                  </div>
                  <p>{l(contacts.address)}</p>
                </div>
                <div data-fade className="sm:hidden">
                  <LangSwitch glass />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
