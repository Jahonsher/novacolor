import { createContext, useCallback, useContext, useEffect, useRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { useHref, useLocation, useNavigate } from 'react-router'
import { gsap, ScrollTrigger, nextFrame, scrollToTop, setReady, reducedMotion } from '../lib/motion'
import { asset } from '../data'
import { useLang } from '../i18n'

type Ctx = { go: (to: string) => void; run: (fn: () => void) => Promise<void> }
const TransitionContext = createContext<Ctx | null>(null)

/**
 * Barba-style page transitions: stone-coloured panels sweep up to cover the
 * page, the route swaps underneath, then the panels lift away and the new
 * page's reveal animations start.
 */
export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const overlay = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const internalNav = useRef(false)
  const { t } = useLang()

  const cover = useCallback(() => {
    const el = overlay.current!
    const panels = el.querySelectorAll('[data-panel]')
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .set(el, { autoAlpha: 1 })
        .fromTo(panels, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: reducedMotion ? 0.01 : 0.9, ease: 'power4.inOut', stagger: 0.06 })
        .fromTo(el.querySelector('[data-mark]'), { yPercent: 110 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' }, '-=0.35')
    })
  }, [])

  const uncover = useCallback(() => {
    const el = overlay.current!
    const panels = el.querySelectorAll('[data-panel]')
    gsap
      .timeline({ onComplete: () => void gsap.set(el, { autoAlpha: 0 }) })
      .to(el.querySelector('[data-mark]'), { yPercent: -110, duration: 0.45, ease: 'expo.in' })
      .call(() => setReady(true), [], '+=0.05')
      .to(panels, { scaleY: 0, transformOrigin: '50% 0%', duration: reducedMotion ? 0.01 : 1, ease: 'power4.inOut', stagger: 0.06 }, '<-0.1')
  }, [])

  const run = useCallback(
    async (fn: () => void) => {
      if (busy.current) return
      busy.current = true
      setReady(false)
      await cover()
      internalNav.current = true
      fn()
      await nextFrame()
      await nextFrame()
      scrollToTop()
      ScrollTrigger.refresh()
      await new Promise((r) => setTimeout(r, 120))
      internalNav.current = false
      uncover()
      busy.current = false
    },
    [cover, uncover],
  )

  const go = useCallback(
    (to: string) => {
      const here = location.pathname + location.search
      if (to === here) {
        scrollToTop(false)
        return
      }
      void run(() => navigate(to))
    },
    [location, navigate, run],
  )

  // browser back/forward to another page: no curtain, just reset scroll and
  // refresh triggers (query-only changes like the product filter keep scroll)
  useEffect(() => {
    if (internalNav.current) return
    scrollToTop()
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }, [location.pathname])

  return (
    <TransitionContext.Provider value={{ go, run }}>
      {children}
      <div ref={overlay} className="pointer-events-none invisible fixed inset-0 z-[90] flex" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} data-panel className="h-full flex-1 bg-char" style={{ boxShadow: '1px 0 0 0 #161513' }} />
        ))}
        <div className="absolute inset-0 grid place-items-center overflow-hidden">
          <div className="overflow-hidden">
            <div data-mark className="flex flex-col items-center gap-3">
              <img src={asset('img/logo.png')} alt="" className="h-9 w-auto" />
              <span className="label">{t('tagline')}</span>
            </div>
          </div>
        </div>
      </div>
    </TransitionContext.Provider>
  )
}

export function useTransition() {
  const ctx = useContext(TransitionContext)
  if (!ctx) throw new Error('useTransition outside provider')
  return ctx
}

/** <a> that navigates through the page transition. */
export function TLink({
  to,
  children,
  onClick,
  ...rest
}: { to: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> } & AnchorHTMLAttributes<HTMLAnchorElement> & Record<`data-${string}`, unknown>) {
  const href = useHref(to)
  const { go } = useTransition()
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    go(to)
  }
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
