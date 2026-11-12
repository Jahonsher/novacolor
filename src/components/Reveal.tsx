import { useRef, type ElementType, type ReactNode } from 'react'
import { gsap, SplitText, useGSAP, useReady, reducedMotion } from '../lib/motion'

type Props = {
  as?: ElementType
  children: ReactNode
  className?: string
  /** what to split into: lines slide up, words/chars cascade inside line masks */
  by?: 'lines' | 'words' | 'chars'
  delay?: number
  stagger?: number
  /** play right away (above the fold) instead of on scroll */
  immediate?: boolean
  start?: string
}

/** Text that "seeps" out of invisible line masks as it enters the viewport. */
export function Reveal({ as: Tag = 'div', children, className = '', by = 'lines', delay = 0, stagger, immediate, start = 'top 88%' }: Props) {
  const ref = useRef<HTMLElement>(null)
  const ready = useReady()

  useGSAP(
    () => {
      const el = ref.current
      if (!el || !ready) return
      if (reducedMotion) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }
      const split = SplitText.create(el, {
        type: by === 'lines' ? 'lines' : `lines,${by}`,
        mask: 'lines',
        linesClass: 'split-line',
        autoSplit: true,
        onSplit(self) {
          gsap.set(el, { autoAlpha: 1 })
          const targets = by === 'chars' ? self.chars : by === 'words' ? self.words : self.lines
          return gsap.from(targets, {
            yPercent: 115,
            opacity: 0,
            rotate: by === 'chars' ? 6 : by === 'words' ? 2 : 0,
            transformOrigin: '0% 100%',
            duration: by === 'lines' ? 1.6 : 1.4,
            ease: 'power4.out',
            force3D: true,
            stagger: stagger ?? (by === 'chars' ? 0.028 : by === 'words' ? 0.04 : 0.1),
            delay,
            scrollTrigger: immediate ? undefined : { trigger: el, start, once: true },
          })
        },
      })
      return () => split.revert()
    },
    { dependencies: [ready], scope: ref },
  )

  return (
    <Tag ref={ref} className={`invisible ${className}`}>
      {children}
    </Tag>
  )
}

/** Paragraph whose words light up one by one while scrolling through it. */
export function ScrubText({ as: Tag = 'p', children, className = '' }: { as?: ElementType; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const ready = useReady()
  useGSAP(
    () => {
      const el = ref.current
      if (!el || !ready || reducedMotion) return
      const split = SplitText.create(el, {
        type: 'words',
        autoSplit: true,
        onSplit(self) {
          return gsap.fromTo(
            self.words,
            { opacity: 0.12 },
            { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: true } },
          )
        },
      })
      return () => split.revert()
    },
    { dependencies: [ready], scope: ref },
  )
  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  )
}

/** Generic fade/slide-up for non-text blocks. */
export function FadeUp({ children, className = '', delay = 0, y = 60 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const ready = useReady()
  useGSAP(
    () => {
      if (!ref.current || !ready) return
      gsap.set(ref.current, { autoAlpha: 1 })
      if (reducedMotion) return
      gsap.from(ref.current, { y, autoAlpha: 0, duration: 1.6, delay, ease: 'power4.out', scrollTrigger: { trigger: ref.current, start: 'top 92%', once: true } })
    },
    { dependencies: [ready], scope: ref },
  )
  return (
    <div ref={ref} className={`invisible ${className}`}>
      {children}
    </div>
  )
}
