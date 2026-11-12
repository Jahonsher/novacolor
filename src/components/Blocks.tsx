import { useRef, useState } from 'react'
import { asset, clients, news, pad, productBySlug, stats } from '../data'
import { formatDate, useLang } from '../i18n'
import { gsap, useGSAP, useReady, reducedMotion, isTouch } from '../lib/motion'
import { Reveal } from './Reveal'
import { TLink } from './Transition'

/** Section heading row: "03 — Label" + optional link. */
export function SectionHead({ index, label, children }: { index: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-line pb-5">
      <Reveal as="p" className="label">{`${index} — ${label}`}</Reveal>
      {children}
    </div>
  )
}

/** Numbers that count up when they scroll into view. */
export function Stats() {
  const { l } = useLang()
  const root = useRef<HTMLDivElement>(null)
  const ready = useReady()
  useGSAP(
    () => {
      if (!ready) return
      root.current!.querySelectorAll<HTMLElement>('[data-value]').forEach((el) => {
        const end = Number(el.dataset.value)
        const isYear = el.dataset.year === '1'
        const o = { v: isYear ? end - 40 : 0 }
        gsap.to(o, {
          v: end,
          duration: reducedMotion ? 0 : 2.4,
          ease: 'expo.out',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          onUpdate: () => (el.textContent = isYear ? String(Math.round(o.v)) : Math.round(o.v).toLocaleString('ru-RU').replace(/ /g, ' ')),
        })
      })
      gsap.from(root.current!.querySelectorAll('[data-rule]'), { scaleX: 0, transformOrigin: '0 50%', duration: 1.6, ease: 'expo.inOut', stagger: 0.1, scrollTrigger: { trigger: root.current, start: 'top 85%', once: true } })
    },
    { dependencies: [ready], scope: root },
  )
  return (
    <div ref={root} className="grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.id}>
          <div data-rule className="mb-6 h-px w-full bg-line" />
          <p className="display flex items-start text-6xl md:text-7xl lg:text-8xl">
            <span data-value={s.value} data-year={s.id === 1 ? '1' : '0'} className="tabular-nums">
              0
            </span>
            {s.id !== 1 ? <span className="ml-1 text-4xl text-sand">+</span> : null}
          </p>
          <p className="label mt-3">{l(s.label)}</p>
        </div>
      ))}
    </div>
  )
}

/** News rows; hovering shows the picture floating with the pointer. */
export function NewsList({ limit }: { limit?: number }) {
  const { lang, t } = useLang()
  const root = useRef<HTMLDivElement>(null)
  const float = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const items = limit ? news.slice(0, limit) : news

  useGSAP(
    () => {
      if (isTouch) return
      const f = float.current!
      const xTo = gsap.quickTo(f, 'x', { duration: 0.7, ease: 'power3' })
      const yTo = gsap.quickTo(f, 'y', { duration: 0.7, ease: 'power3' })
      const rTo = gsap.quickTo(f, 'rotate', { duration: 0.9, ease: 'power3' })
      let lastX = 0
      const move = (e: PointerEvent) => {
        const r = root.current!.getBoundingClientRect()
        xTo(e.clientX - r.left)
        yTo(e.clientY - r.top)
        rTo(gsap.utils.clamp(-12, 12, (e.clientX - lastX) * 0.6))
        lastX = e.clientX
      }
      root.current!.addEventListener('pointermove', move)
      return () => root.current?.removeEventListener('pointermove', move)
    },
    { scope: root },
  )

  useGSAP(() => {
    gsap.to(float.current, { autoAlpha: hover === null ? 0 : 1, scale: hover === null ? 0.7 : 1, duration: 0.6, ease: 'expo.out' })
  }, { dependencies: [hover], scope: root })

  return (
    <div ref={root} className="relative" onPointerLeave={() => setHover(null)}>
      {items.map((n, i) => {
        const p = n.product ? productBySlug(n.product) : undefined
        return (
          <TLink
            key={n.id}
            to={p ? `/products/${p.slug}` : '/news'}
            onPointerEnter={() => setHover(i)}
            className="group relative grid grid-cols-12 items-center gap-4 border-b border-line py-7 md:py-9"
            data-cursor="link"
          >
            <span className="label col-span-2 md:col-span-1">{pad(i + 1)}</span>
            <Reveal as="h3" by="words" className="display col-span-10 text-4xl transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-3 group-hover:italic md:col-span-6 md:text-6xl">
              {n.title}
            </Reveal>
            <span className="col-span-6 col-start-3 text-sm text-ash md:col-span-3 md:col-start-auto">{formatDate(n.date, lang)}</span>
            <span className="label col-span-4 flex items-center justify-end gap-3 !text-bone md:col-span-2">
              <span className="hidden md:inline">{t('news.read')}</span>
              <span className="inline-block transition-transform duration-500 group-hover:translate-x-2">→</span>
            </span>
            <span className="absolute bottom-[-1px] left-0 h-px w-full origin-left scale-x-0 bg-bone transition-transform duration-700 ease-[var(--ease-expo)] group-hover:scale-x-100" />
            {isTouch && <img src={asset(n.image)} alt="" className="col-span-12 aspect-[16/10] w-full object-cover md:hidden" loading="lazy" />}
          </TLink>
        )
      })}
      {!isTouch && (
        <div ref={float} className="pointer-events-none invisible absolute left-0 top-0 z-10 -ml-[140px] -mt-[180px] h-[360px] w-[280px] overflow-hidden">
          {items.map((n, i) => (
            <img
              key={n.id}
              src={asset(n.image)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-[clip-path] duration-700 ease-[var(--ease-expo)]"
              style={{ clipPath: hover === i ? 'inset(0% 0% 0% 0%)' : 'inset(100% 0% 0% 0%)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Infinite client-logo strip. */
export function Clients() {
  const row = [...clients, ...clients, ...clients]
  return (
    <div className="relative overflow-hidden py-10 [mask-image:linear-gradient(90deg,transparent,#000_15%,#000_85%,transparent)]">
      <div className="flex w-max items-center gap-24 pr-24" style={{ animation: reducedMotion ? 'none' : 'marquee 40s linear infinite' }}>
        {[...row, ...row].map((c, i) => (
          <img key={i} src={asset(c)} alt="" className="h-14 w-auto opacity-70 [filter:brightness(0)] md:h-20" loading="lazy" />
        ))}
      </div>
    </div>
  )
}

/** Big closing call-to-action with a magnetic round button. */
export function ContactCTA() {
  const { t } = useLang()
  const btn = useRef<HTMLAnchorElement>(null)
  useGSAP(() => {
    if (isTouch) return
    const el = btn.current!
    const xTo = gsap.quickTo(el, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.4)' })
    const yTo = gsap.quickTo(el, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.4)' })
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      xTo((e.clientX - r.left - r.width / 2) * 0.35)
      yTo((e.clientY - r.top - r.height / 2) * 0.35)
    }
    const leave = () => {
      xTo(0)
      yTo(0)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  })
  return (
    <section className="tone-sand panel px-5 py-24 md:px-10 md:py-36">
      <Reveal as="p" className="label mb-10">{t('cta.label')}</Reveal>
      <div className="grid items-end gap-12 md:grid-cols-12">
        <Reveal as="h2" by="words" className="display text-[12vw] md:col-span-9 md:text-[7vw]">
          {t('cta.title')}
        </Reveal>
        <div className="flex md:col-span-3 md:justify-end">
          <TLink
            ref={btn}
            to="/contact"
            className="group relative grid h-40 w-40 place-items-center overflow-hidden rounded-full border border-bone/40 md:h-48 md:w-48"
            data-cursor="link"
          >
            <span className="absolute inset-0 translate-y-full rounded-full bg-bone transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-y-0" />
            <span className="label relative !text-bone transition-colors duration-500 group-hover:!text-ink">{t('cta.button')}</span>
          </TLink>
        </div>
      </div>
    </section>
  )
}
