import { useRef } from 'react'
import { HeroCanvas } from '../gl/HeroCanvas'
import { CategoryRing } from '../gl/CategoryRing'
import { GLImage } from '../components/GLImage'
import { Reveal, ScrubText, FadeUp } from '../components/Reveal'
import { TLink } from '../components/Transition'
import { Clients, ContactCTA, NewsList, SectionHead, Stats } from '../components/Blocks'
import { about, featured, pad } from '../data'
import { useLang } from '../i18n'
import { gsap, useGSAP, reducedMotion, useReady } from '../lib/motion'

function Hero() {
  const { t } = useLang()
  const root = useRef<HTMLElement>(null)
  const ready = useReady()

  useGSAP(
    () => {
      if (reducedMotion) return
      // title drifts up and fades as you leave the hero
      gsap.to(root.current!.querySelector('[data-hero-title]'), {
        yPercent: -35,
        opacity: 0.15,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
      })
      if (ready) gsap.from(root.current!.querySelectorAll('[data-hero-fade]'), { autoAlpha: 0, y: 24, duration: 1.4, ease: 'expo.out', stagger: 0.08, delay: 0.7 })
    },
    { dependencies: [ready], scope: root },
  )

  return (
    <section ref={root} className="grain relative h-[100svh] min-h-[600px] overflow-hidden">
      <div className="absolute inset-0">
        <HeroCanvas />
      </div>
      <div className="relative flex h-full flex-col justify-between px-5 pb-8 pt-28 md:px-10 md:pb-10 md:pt-36">
        <div data-hero-fade className="invisible flex justify-between">
          <span className="label">01 — Novacolor</span>
          <span className="label hidden md:block">{t('tagline')}</span>
        </div>
        <div data-hero-title>
          <Reveal as="h1" by="chars" immediate delay={0.15} className="display max-w-[14ch] text-[17vw] md:text-[10.5vw]">
            {t('hero.title')}
          </Reveal>
        </div>
        <div className="grid grid-cols-2 items-end gap-6 md:grid-cols-3">
          <p data-hero-fade className="invisible max-w-xs text-sm leading-relaxed text-bone/80">
            {t('hero.sub')}
          </p>
          <div data-hero-fade className="invisible hidden flex-col items-center gap-3 md:flex">
            <span className="label">{t('hero.scroll')}</span>
            <span className="relative block h-14 w-px overflow-hidden bg-line">
              <span className="absolute inset-x-0 top-0 h-1/2 animate-[scrollcue_2s_var(--ease-expo)_infinite] bg-bone" />
            </span>
          </div>
          {/* server build: keep the label clear of the fixed AI-chat launcher (bottom-right) */}
          <p data-hero-fade className={`label invisible text-right ${import.meta.env.VITE_API ? 'pr-16 md:pr-20' : ''}`}>
            {t('hero.location')}
          </p>
        </div>
      </div>
    </section>
  )
}

function AboutIntro() {
  const { t, l } = useLang()
  return (
    <section className="tone-light panel px-5 py-24 md:px-10 md:py-36">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-3">
          <Reveal as="p" className="label">{`— ${t('about.label')}`}</Reveal>
        </div>
        <div className="md:col-span-9">
          <Reveal as="h2" by="words" className="display mb-12 text-6xl italic text-sand md:text-8xl">
            {t('about.title')}
          </Reveal>
          <ScrubText className="display text-3xl leading-[1.15] md:text-5xl">{l(about.lead)}</ScrubText>
        </div>
      </div>
      <div className="mt-20 grid gap-6 md:mt-28 md:grid-cols-12">
        <GLImage src="img/about.jpg" alt="Novacolor interior" className="aspect-[4/5] md:col-span-5 md:col-start-2" />
        <div className="flex flex-col justify-end gap-10 md:col-span-4 md:col-start-8">
          <GLImage src="img/products/teodorico-2.jpg" alt="Teodorico" className="aspect-square w-2/3 self-end" />
          <FadeUp>
            <TLink to="/about" className="group label inline-flex items-center gap-4 !text-bone" data-cursor="link">
              <span className="link-line">{t('about.more')}</span>
              <span className="transition-transform duration-500 group-hover:translate-x-2">→</span>
            </TLink>
          </FadeUp>
        </div>
      </div>
    </section>
  )
}

function Featured() {
  const { t, l } = useLang()
  const root = useRef<HTMLElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const distance = () => track.current!.scrollWidth - window.innerWidth
      gsap.to(track.current, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: () => `+=${distance()}`,
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
        },
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} className="tone-char relative flex h-screen flex-col justify-center overflow-hidden">
      <div className="mb-10 px-5 md:px-10">
        <SectionHead index="03" label={t('featured.label')}>
          <TLink to="/products" className="label link-line !text-bone">
            {t('all.products')} →
          </TLink>
        </SectionHead>
      </div>
      <div ref={track} className="flex w-max items-end gap-6 px-5 md:gap-10 md:px-10">
        <div className="flex w-[80vw] shrink-0 flex-col justify-end md:w-[38vw]">
          <Reveal as="h2" by="words" className="display text-6xl md:text-[6.5vw]">
            {t('featured.title')}
          </Reveal>
        </div>
        {featured.map((p, i) => (
          <TLink key={p.slug} to={`/products/${p.slug}`} className="group block w-[68vw] shrink-0 md:w-[26vw]" data-cursor="view">
            <GLImage src={p.image} alt={p.name} className={`w-full ${i % 2 ? 'aspect-[4/5]' : 'aspect-[3/4]'}`} />
            <div className="mt-5 flex items-baseline justify-between gap-4">
              <h3 className="display text-3xl md:text-4xl">{p.name}</h3>
              <span className="label">{pad(i + 1)}</span>
            </div>
            <p className="mt-2 line-clamp-1 text-sm text-ash">{l(p.subtitle)}</p>
          </TLink>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const { t } = useLang()
  return (
    <>
      <Hero />
      <AboutIntro />
      <CategoryRing />
      <section className="tone-light panel px-5 py-24 md:px-10 md:py-32">
        <div className="mb-16">
          <Reveal as="p" className="label">{`— ${t('stats.label')}`}</Reveal>
        </div>
        <Stats />
      </section>
      <Featured />
      <section className="px-5 py-28 md:px-10 md:py-36">
        <SectionHead index="04" label={t('news.label')}>
          <TLink to="/news" className="label link-line !text-bone">
            {t('news.all')} →
          </TLink>
        </SectionHead>
        <NewsList limit={5} />
      </section>
      <section className="tone-light panel">
        <p className="label px-5 pt-10 md:px-10">{`05 — ${t('clients.label')}`}</p>
        <Clients />
      </section>
      <ContactCTA />
    </>
  )
}
