import { useEffect, useRef } from 'react'
import { gsap, isTouch } from '../lib/motion'
import { useLang } from '../i18n'

/** Dot + ring cursor. Elements with data-cursor="label" grow it into a labelled disc. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const { t } = useLang()
  const viewText = t('view')

  useEffect(() => {
    if (isTouch) return
    document.documentElement.classList.add('has-cursor')
    const d = dot.current!
    const r = ring.current!
    const xd = gsap.quickTo(d, 'x', { duration: 0.15, ease: 'power3' })
    const yd = gsap.quickTo(d, 'y', { duration: 0.15, ease: 'power3' })
    const xr = gsap.quickTo(r, 'x', { duration: 0.6, ease: 'power3' })
    const yr = gsap.quickTo(r, 'y', { duration: 0.6, ease: 'power3' })
    let state = ''

    const move = (e: PointerEvent) => {
      xd(e.clientX)
      yd(e.clientY)
      xr(e.clientX)
      yr(e.clientY)
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-cursor], a, button, input, textarea')
      const next = target ? (target.dataset.cursor ?? (target.matches('input, textarea') ? 'text' : 'link')) : ''
      if (next === state) return
      state = next
      const big = next !== '' && next !== 'link' && next !== 'text'
      if (big) label.current!.textContent = next === 'view' ? viewText : next
      gsap.to(r, {
        width: big ? 96 : next === 'link' ? 56 : 34,
        height: big ? 96 : next === 'link' ? 56 : 34,
        backgroundColor: big ? 'rgba(236,231,223,1)' : 'rgba(236,231,223,0)',
        borderColor: next === 'text' ? 'rgba(236,231,223,0)' : 'rgba(236,231,223,0.5)',
        duration: 0.5,
        ease: 'expo.out',
      })
      gsap.to(label.current, { autoAlpha: big ? 1 : 0, scale: big ? 1 : 0.6, duration: 0.4 })
      gsap.to(d, { scale: big ? 0 : next === 'text' ? 0.5 : 1, duration: 0.3 })
    }
    const leave = () => gsap.to([d, r], { autoAlpha: 0, duration: 0.3 })
    // pointer events stop inside an iframe (Instagram player): hide the custom cursor there, the iframe
    // shows the native one; the next move in this document brings it back
    let inFrame = false
    const over = (e: PointerEvent) => {
      if ((e.target as Element | null)?.tagName !== 'IFRAME') return
      inFrame = true
      leave()
    }
    const back = () => {
      if (!inFrame) return
      inFrame = false
      gsap.to([d, r], { autoAlpha: 1, duration: 0.3 })
    }
    const enter = () => gsap.to([d, r], { autoAlpha: 1, duration: 0.3 })
    const down = () => gsap.to(r, { scale: 0.85, duration: 0.2 })
    const up = () => gsap.to(r, { scale: 1, duration: 0.4, ease: 'expo.out' })

    window.addEventListener('pointermove', move)
    window.addEventListener('pointermove', back)
    window.addEventListener('pointerover', over)
    document.addEventListener('pointerleave', leave)
    document.addEventListener('pointerenter', enter)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      document.documentElement.classList.remove('has-cursor')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointermove', back)
      window.removeEventListener('pointerover', over)
      document.removeEventListener('pointerleave', leave)
      document.removeEventListener('pointerenter', enter)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [viewText])

  if (isTouch) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[110]" aria-hidden>
      <div ref={dot} className="fixed left-0 top-0 -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-bone mix-blend-difference" />
      <div
        ref={ring}
        className="fixed left-0 top-0 grid h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-bone/50 mix-blend-difference"
      >
        <span ref={label} className="label invisible text-[10px] !tracking-[0.18em] !text-ink" />
      </div>
    </div>
  )
}
