import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'
import Lenis from 'lenis'
import { useSyncExternalStore } from 'react'

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP)

export { gsap, ScrollTrigger, SplitText, useGSAP }

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const isTouch =
  typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches

/* ---------------- smooth scroll ---------------- */

export const scroll = { y: 0, velocity: 0 }
export let lenis: Lenis | null = null

const raf = (time: number) => lenis?.raf(time * 1000)

export function initSmoothScroll() {
  if (lenis) return lenis
  lenis = new Lenis({
    // frame-rate independent damping feels silkier than a fixed duration
    lerp: 0.075,
    wheelMultiplier: 0.95,
    touchMultiplier: 1.4,
    smoothWheel: !reducedMotion,
  })
  lenis.on('scroll', (l: Lenis) => {
    scroll.y = l.scroll
    scroll.velocity = l.velocity
    ScrollTrigger.update()
  })
  gsap.ticker.add(raf)
  gsap.ticker.lagSmoothing(0)
  return lenis
}

export function destroySmoothScroll() {
  gsap.ticker.remove(raf)
  lenis?.destroy()
  lenis = null
}

export function scrollToTop(immediate = true) {
  if (lenis) lenis.scrollTo(0, { immediate, force: true })
  else window.scrollTo(0, 0)
}

/* ---------------- "page ready" gate ----------------
 * Reveal animations wait until the preloader / page transition has
 * uncovered the page, so the user actually sees them play. */

let ready = false
const subs = new Set<() => void>()
export function setReady(v: boolean) {
  if (ready === v) return
  ready = v
  subs.forEach((f) => f())
}
export const useReady = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => ready,
  )

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}
