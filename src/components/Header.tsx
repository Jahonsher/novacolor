import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { useLocation } from 'react-router'
import { TLink, useTransition } from './Transition'
import { asset, categories, contacts, pad } from '../data'
import { useLang, type Key } from '../i18n'
import { gsap, lenis } from '../lib/motion'
import { attachLiquid } from '../lib/liquid'

export const NAV: { to: string; key: Key }[] = [
  { to: '/', key: 'nav.home' },
  { to: '/products', key: 'nav.products' },
  { to: '/about', key: 'nav.about' },
  { to: '/news', key: 'nav.news' },
  { to: '/contact', key: 'nav.contact' },
]

/**
 * UZ / RU switch with a liquid-glass droplet you can drag (or tap).
 * While pressed the droplet swells; while moving it stretches with the
 * velocity like a drop of water, then settles with an elastic wobble.
 * Releasing past the middle switches the language.
 */
function LangSwitch() {
  const { lang, setLang } = useLang()
  const { run } = useTransition()
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const labels = useRef<(HTMLButtonElement | null)[]>([])
  const pos = useRef(lang === 'ru' ? 1 : 0)
  const drag = useRef<{ x0: number; p0: number; moved: boolean; lastX: number; lastT: number } | null>(null)
  const anim = useRef<gsap.core.Timeline | null>(null)
  const PAD = 4

  const span = () => (track.current && thumb.current ? track.current.clientWidth - thumb.current.offsetWidth - PAD * 2 : 0)
  const render = (p: number) => {
    gsap.set(thumb.current, { x: PAD + p * span() })
    labels.current.forEach((el, i) => el && gsap.set(el, { opacity: 0.42 + 0.58 * Math.max(0, 1 - Math.abs(p - i)) }))
  }

  useLayoutEffect(() => {
    pos.current = lang === 'ru' ? 1 : 0
    render(pos.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const settle = (target: 0 | 1) => {
    anim.current?.kill()
    const o = { p: pos.current }
    const dist = Math.min(1, Math.abs(target - o.p))
    anim.current = gsap
      .timeline({
        onComplete: () => {
          const next = target ? 'ru' : 'uz'
          if (next !== lang) void run(() => setLang(next))
        },
      })
      .to(o, { p: target, duration: 0.7 + dist * 0.2, ease: 'elastic.out(1, 0.72)', onUpdate: () => ((pos.current = o.p), render(o.p)) }, 0)
      .to(thumb.current, { scaleX: 1 + 0.3 * dist, scaleY: 1 - 0.14 * dist, duration: 0.2, ease: 'sine.out' }, 0)
      .to(thumb.current, { scaleX: 1, scaleY: 1, duration: 0.9, ease: 'elastic.out(1.1, 0.4)' }, 0.2)
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    anim.current?.kill()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, p0: pos.current, moved: false, lastX: e.clientX, lastT: performance.now() }
    // the droplet swells under the finger
    gsap.to(thumb.current, { scaleX: 1.16, scaleY: 1.16, duration: 0.45, ease: 'expo.out' })
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (Math.abs(dx) > 3) d.moved = true
    if (!d.moved) return
    let p = d.p0 + dx / Math.max(1, span())
    // rubber-band past the ends
    if (p < 0) p *= 0.25
    if (p > 1) p = 1 + (p - 1) * 0.25
    pos.current = p
    render(p)
    const now = performance.now()
    const v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT)
    d.lastX = e.clientX
    d.lastT = now
    const stretch = Math.min(0.35, Math.abs(v) * 0.25)
    gsap.to(thumb.current, { scaleX: 1.16 + stretch, scaleY: 1.16 - stretch * 0.5, duration: 0.25, ease: 'power2.out', overwrite: 'auto' })
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    let target: 0 | 1
    if (d.moved) target = pos.current > 0.5 ? 1 : 0
    else {
      const r = track.current!.getBoundingClientRect()
      target = e.clientX > r.left + r.width / 2 ? 1 : 0
    }
    settle(target)
  }

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label="Til / Язык"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="label relative flex h-[38px] w-[104px] touch-none select-none items-center rounded-full !text-bone shadow-[inset_0_1px_3px_rgb(0_0_0/0.22),inset_0_0_0_0.5px_rgb(255_255_255/0.14)]"
      data-cursor="link"
    >
      <span ref={thumb} className="glass-drop pointer-events-none absolute left-0 top-1 h-[30px] w-[48px] rounded-full will-change-transform" aria-hidden />
      {(['uz', 'ru'] as const).map((l, i) => (
        <button
          key={l}
          ref={(n) => {
            labels.current[i] = n
          }}
          role="radio"
          aria-checked={l === lang}
          tabIndex={l === lang ? 0 : -1}
          onClick={(e) => e.detail === 0 && settle(i as 0 | 1)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') settle(1)
            if (e.key === 'ArrowLeft') settle(0)
          }}
          className="relative z-[1] flex-1 text-center"
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function Header() {
  const { t, lang } = useLang()
  const { pathname } = useLocation()
  const glass = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const lens = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [light, setLight] = useState(false)
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
        .to(l, { ...vars, duration: 0.85, ease: 'elastic.out(0.9, 0.85)', overwrite: 'auto' })
        .fromTo(l, { scaleY: 0.86 }, { scaleY: 1, duration: 0.8, ease: 'elastic.out(1, 0.6)' }, 0)
  }
  const activeLink = () => (activeIndex >= 0 ? nav.current?.querySelectorAll<HTMLElement>('[data-navlink]')[activeIndex] ?? null : null)

  /* ---- drag the lens between sections (like the iOS tab bar) ---- */
  const { go } = useTransition()
  type Geo = { c: number; w: number; el: HTMLElement }
  const drag = useRef<{ x0: number; c0: number; moved: boolean; lastX: number; lastT: number; links: Geo[] } | null>(null)
  const suppressClick = useRef(false)

  const geometry = (): Geo[] => {
    const nr = nav.current!.getBoundingClientRect()
    return [...nav.current!.querySelectorAll<HTMLElement>('[data-navlink]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { c: r.left - nr.left + r.width / 2, w: r.width, el }
    })
  }
  // lens width blends between neighbouring links as it travels
  const widthAt = (cx: number, links: Geo[]) => {
    if (cx <= links[0].c) return links[0].w
    const last = links[links.length - 1]
    if (cx >= last.c) return last.w
    for (let i = 0; i < links.length - 1; i++) {
      const a = links[i]
      const b = links[i + 1]
      if (cx <= b.c) return a.w + (b.w - a.w) * ((cx - a.c) / (b.c - a.c))
    }
    return last.w
  }

  const onNavMove = (e: PointerEvent) => {
    const d = drag.current
    const l = lens.current
    if (!d || !l) return
    const dx = e.clientX - d.x0
    if (!d.moved) {
      if (Math.abs(dx) < 5) return
      d.moved = true
      gsap.killTweensOf(l)
      // the droplet swells as it's picked up
      gsap.to(l, { autoAlpha: 1, scaleX: 1.1, scaleY: 1.14, duration: 0.45, ease: 'expo.out' })
    }
    const first = d.links[0].c
    const last = d.links[d.links.length - 1].c
    let cx = d.c0 + dx
    // rubber band past the first / last section
    if (cx < first) cx = first - (first - cx) * 0.3
    if (cx > last) cx = last + (cx - last) * 0.3
    const w = widthAt(cx, d.links)
    gsap.to(l, { x: cx - w / 2, width: w, duration: 0.28, ease: 'power3.out', overwrite: 'auto' })
    const now = performance.now()
    const v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT)
    d.lastX = e.clientX
    d.lastT = now
    const stretch = Math.min(0.32, Math.abs(v) * 0.22)
    gsap.to(l, { scaleX: 1.1 + stretch, scaleY: 1.14 - stretch * 0.45, duration: 0.3, ease: 'power2.out' })
  }

  const onNavUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onNavMove)
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 60)
    const nr = nav.current!.getBoundingClientRect()
    const px = Math.min(Math.max(e.clientX - nr.left, d.links[0].c), d.links[d.links.length - 1].c)
    let best = 0
    d.links.forEach((g, i) => Math.abs(g.c - px) < Math.abs(d.links[best].c - px) && (best = i))
    const l = lens.current!
    // settle onto the nearest section with an elastic wobble, then open it
    gsap
      .timeline()
      .to(l, { x: d.links[best].c - d.links[best].w / 2, width: d.links[best].w, duration: 0.9, ease: 'elastic.out(0.9, 0.7)' }, 0)
      .to(l, { scaleX: 1.18, scaleY: 0.9, duration: 0.16, ease: 'sine.out' }, 0)
      .to(l, { scaleX: 1, scaleY: 1, duration: 0.9, ease: 'elastic.out(1.1, 0.45)' }, 0.16)
    if (best !== activeIndex) setTimeout(() => go(NAV[best + 1].to), 420)
  }

  const onNavDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const links = geometry()
    if (!links.length) return
    const nr = nav.current!.getBoundingClientRect()
    const px = e.clientX - nr.left
    const l = lens.current!
    const lx = Number(gsap.getProperty(l, 'x'))
    const lw = l.offsetWidth
    const shown = getComputedStyle(l).visibility !== 'hidden'
    // grab the lens if the press is on it, otherwise it jumps to the finger
    const c0 = shown && px >= lx && px <= lx + lw ? lx + lw / 2 : px
    drag.current = { x0: e.clientX, c0, moved: false, lastX: e.clientX, lastT: performance.now(), links }
    window.addEventListener('pointermove', onNavMove)
    window.addEventListener('pointerup', onNavUp, { once: true })
  }

  useEffect(() => {
    // after fonts settle, park the lens under the current page
    // (also after a language change — the link widths change)
    const id = setTimeout(() => moveLens(activeLink(), true), 50)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, lang])

  const isLight = light && !open

  // real edge refraction (Chromium) — clear centre, bending rim
  useEffect(() => attachLiquid(glass.current!, { radius: 'pill', bezel: 18, strength: 34, blur: 2.5 }), [])

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6 md:pt-5">
        <div
          ref={glass}
          onPointerMove={onGlassMove}
          onPointerLeave={onGlassLeave}
          className={`glass ${isLight ? 'is-light ui-on-light' : ''} pointer-events-auto mx-auto flex max-w-[1240px] items-center justify-between gap-4 rounded-full py-2 pl-5 pr-2 md:py-2.5 md:pl-7 md:pr-2.5`}
        >
          <TLink to="/" aria-label="Novacolor" data-cursor="link" className="shrink-0 transition-transform duration-500 active:scale-95" onClick={() => setOpen(false)}>
            <img src={asset('img/logo.png')} alt="Novacolor" className="logo h-6 w-auto md:h-7" />
          </TLink>

          <nav
            ref={nav}
            className="relative hidden touch-none select-none items-center lg:flex"
            onPointerDown={onNavDown}
            onPointerLeave={() => !drag.current && moveLens(activeLink())}
          >
            <span ref={lens} className="glass-drop pointer-events-none invisible absolute left-0 top-0 h-full rounded-full will-change-transform" aria-hidden />
            {NAV.slice(1).map((n, i) => (
              <TLink
                key={n.to}
                to={n.to}
                data-navlink
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onClick={(e) => {
                  // a drag that ends on a link must not also count as a click
                  if (suppressClick.current) return e.preventDefault()
                  setOpen(false)
                }}
                onPointerEnter={(e) => !drag.current && moveLens(e.currentTarget)}
                className="label relative z-[1] flex items-baseline gap-1.5 rounded-full px-4 py-2.5 !text-bone transition-transform duration-300 active:scale-95"
              >
                <span className="text-[9px] text-bone/50">{pad(i + 1)}</span>
                <span className={i === activeIndex ? 'text-bone' : 'text-bone/85'}>{t(n.key)}</span>
              </TLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden sm:block">
              <LangSwitch />
            </div>
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="glass-drop label group flex items-center gap-3 rounded-full py-2.5 pl-4 pr-3.5 !text-bone transition-transform duration-300 hover:scale-[1.03] active:scale-95"
            >
              <span className="min-w-12 text-center">{open ? t('close') : t('menu')}</span>
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
      <Menu open={open} onClose={() => setOpen(false)} capsule={glass} />
    </>
  )
}

/**
 * Liquid-glass dropdown: the panel is born from the navbar capsule and
 * "pours" downward with an elastic, droplet-shaped bottom edge. It's
 * translucent, so the page stays visible (blurred) behind it.
 */
function Menu({ open, onClose, capsule }: { open: boolean; onClose: () => void; capsule: RefObject<HTMLDivElement | null> }) {
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
        .to(p, { height: target, duration: 1.5, ease: 'elastic.out(0.8, 0.85)' }, 0)
        // …with a droplet-shaped bottom that settles into soft corners
        .to(p, { borderBottomLeftRadius: `${w * 0.48}px 90px`, borderBottomRightRadius: `${w * 0.48}px 90px`, duration: 0.4, ease: 'sine.out' }, 0)
        .to(p, { ...all('36px 36px'), duration: 1.1, ease: 'elastic.out(0.9, 0.6)' }, 0.38)
        .fromTo(p, { scaleX: 0.975 }, { scaleX: 1, duration: 1.3, ease: 'elastic.out(0.9, 0.55)' }, 0)
        .fromTo(items, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, ease: 'power4.out', stagger: 0.06 }, 0.22)
        .fromTo(fades, { autoAlpha: 0, y: 16, filter: 'blur(6px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 1, ease: 'power3.out', stagger: 0.06 }, 0.36)
    } else {
      lenis?.start()
      gsap
        .timeline()
        .to(fades, { autoAlpha: 0, filter: 'blur(4px)', duration: 0.25, ease: 'power2.in' }, 0)
        .to(items, { yPercent: -110, opacity: 0, duration: 0.4, ease: 'power3.in', stagger: 0.025 }, 0)
        .to(p, { borderBottomLeftRadius: `${p.offsetWidth * 0.48}px 70px`, borderBottomRightRadius: `${p.offsetWidth * 0.48}px 70px`, duration: 0.3, ease: 'sine.in' }, 0.12)
        .to(p, { height: capH, ...all(`${r}px ${r}px`), scaleX: 0.985, duration: 0.7, ease: 'expo.inOut' }, 0.2)
        .to(bd, { autoAlpha: 0, duration: 0.5, ease: 'sine.out' }, 0.3)
        .set(p, { autoAlpha: 0, scaleX: 1 })
    }
  }, [open, capsule])

  // panel refraction: a wider, softer rim than the bar
  useEffect(() => attachLiquid(panel.current!, { radius: 36, bezel: 34, strength: 60, blur: 14, saturate: 165, brightness: 0.97 }), [])

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
          className={`glass glass-panel pointer-events-auto invisible mx-auto max-w-[1240px] origin-top overflow-hidden`}
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
                  <LangSwitch />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
