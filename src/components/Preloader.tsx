import { useRef, useState } from 'react'
import { asset, categories } from '../data'
import { gsap, useGSAP, setReady, reducedMotion } from '../lib/motion'
import { useLang } from '../i18n'

const preload = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = asset(src)
  })

/** Counter 000 → 100 while fonts + first images load, then the curtain lifts. */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)
  const { t } = useLang()

  useGSAP(
    () => {
      const el = root.current!
      const counter = el.querySelector('[data-count]')!
      const progress = { v: 0 }
      let loaded = 0
      const jobs = [document.fonts.ready.then(() => undefined), ...categories.map((c) => preload(c.image)), preload('img/logo.png')]
      const total = jobs.length
      jobs.forEach((j) => j.then(() => loaded++))

      const intro = gsap.timeline()
      intro.from(el.querySelectorAll('[data-in]'), { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.08 })

      // the counter chases real progress, but never faster than ~1.6s
      const chase = gsap.to(progress, {
        v: 100,
        duration: reducedMotion ? 0.2 : 1.8,
        ease: 'power2.inOut',
        onUpdate: () => {
          const v = Math.min(progress.v, ((loaded + 1) / (total + 1)) * 100)
          counter.textContent = String(Math.round(v)).padStart(3, '0')
          gsap.set(el.querySelector('[data-bar]'), { scaleX: v / 100 })
        },
      })

      Promise.all([Promise.all(jobs), chase.then()]).then(() => {
        counter.textContent = '100'
        gsap
          .timeline({ onComplete: () => setDone(true) })
          .set(el.querySelector('[data-bar]'), { scaleX: 1 })
          .to(el.querySelectorAll('[data-in]'), { yPercent: -110, duration: 0.7, ease: 'expo.in', stagger: 0.04 })
          .call(() => setReady(true))
          .to(el, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.2, ease: 'expo.inOut' }, '-=0.1')
      })
    },
    { scope: root },
  )

  if (done) return null
  return (
    <div ref={root} className="tone-dark fixed inset-0 z-[100] flex flex-col justify-between bg-char p-6 md:p-10" style={{ clipPath: 'inset(0% 0% 0% 0%)' }}>
      <div className="flex justify-between">
        <div className="overflow-hidden">
          <img data-in src={asset('img/logo.png')} alt="Novacolor" className="h-8 w-auto md:h-10" />
        </div>
        <div className="overflow-hidden">
          <span data-in className="label block">
            {t('tagline')}
          </span>
        </div>
      </div>
      <div>
        <div className="flex items-end justify-between gap-6">
          <div className="overflow-hidden">
            <p data-in className="display max-w-xl text-4xl italic text-ash md:text-6xl">
              {t('hero.title')}
            </p>
          </div>
          <div className="overflow-hidden">
            <span data-in data-count className="display block text-[22vw] leading-[0.8] md:text-[14vw]">
              000
            </span>
          </div>
        </div>
        <div className="mt-6 h-px w-full bg-line">
          <div data-bar className="h-full origin-left scale-x-0 bg-sand" />
        </div>
      </div>
    </div>
  )
}
