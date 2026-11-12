import { useEffect, useRef, useState } from 'react'
import { mediaGL, type Item } from '../gl/media'
import { asset } from '../data'
import { gsap, useGSAP, useReady, reducedMotion } from '../lib/motion'

type Props = {
  src: string
  alt: string
  className?: string
  /** play the shader reveal when scrolled into view (default true) */
  reveal?: boolean
  cursor?: string
  eager?: boolean
}

/**
 * Image drawn by the shared WebGL canvas (see gl/media.ts).
 * Falls back to a plain <img> with a CSS clip reveal when WebGL isn't available.
 */
export function GLImage({ src, alt, className = '', reveal = true, cursor, eager }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const item = useRef<Item | null>(null)
  const [mode, setMode] = useState<'pending' | 'gl' | 'dom'>(() => (mediaGL.enabled && !reducedMotion ? 'pending' : 'dom'))
  const ready = useReady()

  useEffect(() => {
    if (!wrap.current || reducedMotion) return
    const it = mediaGL.add(wrap.current, asset(src), (ok) => setMode(ok ? 'gl' : 'dom'))
    item.current = it
    if (!it) setMode('dom')
    return () => {
      if (it) mediaGL.remove(it)
      item.current = null
    }
  }, [src])

  useGSAP(
    () => {
      const el = wrap.current
      if (!el) return
      if (mode === 'gl' && item.current) {
        const u = item.current.uniforms.uReveal
        if (!reveal) {
          u.value = 1
          return
        }
        if (!ready) return
        gsap.to(u, { value: 1, duration: 2.2, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 94%', once: true } })
      } else if (mode === 'dom' && reveal && ready && !reducedMotion) {
        gsap.fromTo(
          el.querySelector('img'),
          { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.18 },
          { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 94%', once: true } },
        )
      }
    },
    { dependencies: [ready, mode, reveal], scope: wrap },
  )

  return (
    <div ref={wrap} className={`relative overflow-hidden ${className}`} data-cursor={cursor}>
      <img
        src={asset(src)}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: mode === 'dom' ? 1 : 0 }}
      />
    </div>
  )
}
