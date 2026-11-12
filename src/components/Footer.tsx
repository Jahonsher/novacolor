import { useRef } from 'react'
import { TLink } from './Transition'
import { NAV } from './Header'
import { Reveal } from './Reveal'
import { contacts, products } from '../data'
import { useLang } from '../i18n'
import { gsap, useGSAP, useReady, lenis, reducedMotion } from '../lib/motion'

const YEAR = new Date().getFullYear()

export function Footer() {
  const { t, l } = useLang()
  const word = useRef<HTMLDivElement>(null)
  const ready = useReady()

  // giant wordmark rises letter by letter as the footer scrolls in
  useGSAP(
    () => {
      if (!ready || reducedMotion) return
      gsap.from(word.current!.querySelectorAll('span'), {
        yPercent: 100,
        ease: 'none',
        stagger: 0.04,
        scrollTrigger: { trigger: word.current, start: 'top bottom', end: 'bottom bottom', scrub: true },
      })
    },
    { dependencies: [ready], scope: word },
  )

  return (
    <footer className="tone-char relative mt-2 overflow-hidden rounded-t-[28px] px-5 pt-20 md:mt-3 md:rounded-t-[44px] md:px-10">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <Reveal as="p" className="display max-w-md text-3xl italic md:text-4xl">
            {t('footer.text')}
          </Reveal>
          <div className="mt-8 flex gap-6 text-sm">
            <a href={contacts.telegram} target="_blank" rel="noreferrer" className="link-line">
              Telegram ↗
            </a>
            <a href={contacts.instagram} target="_blank" rel="noreferrer" className="link-line">
              Instagram ↗
            </a>
          </div>
        </div>
        <div className="md:col-span-2">
          <p className="label mb-5">{t('footer.links')}</p>
          <ul className="space-y-2 text-sm">
            {NAV.map((n) => (
              <li key={n.to}>
                <TLink to={n.to} className="link-line text-ash hover:text-bone">
                  {t(n.key)}
                </TLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <p className="label mb-5">{t('nav.products')}</p>
          <ul className="space-y-2 text-sm">
            {products.slice(0, 5).map((p) => (
              <li key={p.slug}>
                <TLink to={`/products/${p.slug}`} className="link-line text-ash hover:text-bone">
                  {p.name}
                </TLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-3">
          <p className="label mb-5">{t('footer.contact')}</p>
          <ul className="space-y-2 text-sm text-ash">
            <li>
              <a href={contacts.phoneHref} className="link-line text-bone">
                {contacts.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${contacts.email}`} className="link-line">
                {contacts.email}
              </a>
            </li>
            <li>{l(contacts.address)}</li>
          </ul>
        </div>
      </div>

      <div ref={word} className="display mt-20 flex select-none justify-between overflow-hidden text-[19.5vw] leading-[0.78] tracking-[-0.04em]" aria-hidden>
        {'novacolor'.split('').map((ch, i) => (
          <span key={i} className="inline-block">
            {ch}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 text-xs text-mute">
        <span>
          © {YEAR} Novacolor Uzbekistan. {t('footer.rights')}.
        </span>
        <button onClick={() => lenis?.scrollTo(0, { duration: 2 })} className="label link-line">
          {t('footer.top')} ↑
        </button>
      </div>
    </footer>
  )
}
