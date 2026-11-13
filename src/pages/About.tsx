import { useRef } from 'react'
import { GLImage } from '../components/GLImage'
import { Reveal, ScrubText } from '../components/Reveal'
import { Clients, ContactCTA, Stats } from '../components/Blocks'
import { DocList } from '../components/Documents'
import { about, categories, documents, type DocGroup } from '../data'
import { useLang } from '../i18n'
import { gsap, useGSAP, reducedMotion } from '../lib/motion'

export default function About() {
  const { t, l } = useLang()
  const band = useRef<HTMLDivElement>(null)

  // wide image band zooms out as it passes
  useGSAP(
    () => {
      if (reducedMotion) return
      // scale (not clip-path) so the WebGL plane, which mirrors the element's box, follows it
      gsap.fromTo(band.current, { scale: 0.68 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: band.current, start: 'top 95%', end: 'top 15%', scrub: true } })
    },
    { scope: band },
  )

  const groups: { key: DocGroup; label: string }[] = [
    { key: 'company', label: t('docs.company') },
    { key: 'product', label: t('docs.product') },
    { key: 'epd', label: t('docs.epd') },
  ]

  const milestones = [
    { year: '1982', text: t('about.milestone1') },
    { year: '2009', text: t('about.milestone2') },
  ]

  return (
    <>
      <section className="px-5 pb-24 pt-36 md:px-10 md:pt-48">
        <Reveal as="p" className="label mb-8">{`— ${t('about.page.label')}`}</Reveal>
        <Reveal as="h1" by="chars" immediate className="display text-[17vw] md:text-[11vw]">
          {t('about.title')}
        </Reveal>
        <div className="mt-16 grid gap-10 md:grid-cols-12">
          <p className="label md:col-span-3">Forlì, Italia — 1982</p>
          <ScrubText className="display text-3xl leading-[1.15] md:col-span-9 md:text-5xl">{l(about.lead)}</ScrubText>
        </div>
      </section>

      <div ref={band} className="mx-5 md:mx-10">
        <GLImage src="img/categories/mineral.jpg" alt="Novacolor" className="aspect-[16/9] md:aspect-[21/9]" />
      </div>

      <section className="tone-light panel mt-16 px-5 py-24 md:mt-24 md:px-10 md:py-32">
        <div className="grid gap-16 md:grid-cols-12">
          <div className="md:col-span-5">
            <GLImage src="img/about.jpg" alt="Novacolor interior" className="aspect-[4/5]" />
          </div>
          <div className="flex flex-col justify-center md:col-span-6 md:col-start-7">
            <Reveal as="p" className="text-lg leading-relaxed text-ash md:text-xl">
              {l(about.extra)}
            </Reveal>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 md:px-10 md:py-32">
        {milestones.map((m) => (
          <div key={m.year} className="grid gap-6 border-b border-line py-10 md:grid-cols-12 md:py-14">
            <Reveal as="p" by="chars" className="display text-8xl text-sand md:col-span-5 md:text-[10vw]">
              {m.year}
            </Reveal>
            <Reveal as="p" className="display self-end text-2xl leading-snug md:col-span-6 md:col-start-7 md:text-4xl">
              {m.text}
            </Reveal>
          </div>
        ))}
      </section>

      <section className="px-5 pb-28 md:px-10 md:pb-40">
        <Reveal as="p" className="label mb-10">{`— ${t('about.values.label')}`}</Reveal>
        <div className="grid gap-6 md:grid-cols-3">
          {[t('about.value1'), t('about.value2'), t('about.value3')].map((v, i) => (
            <div key={v} className="group relative overflow-hidden border border-line p-8 md:p-10">
              <span className="label">0{i + 1}</span>
              <Reveal as="p" by="words" className="display mt-16 text-5xl italic md:text-6xl">
                {v}
              </Reveal>
              <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-sand transition-transform duration-1000 ease-[var(--ease-expo)] group-hover:scale-x-100" />
            </div>
          ))}
        </div>
      </section>

      {/* certificates & declarations */}
      <section id="sertifikatlar" className="px-5 pb-28 md:px-10 md:pb-40">
        <Reveal as="p" className="label mb-8">{`— ${t('docs.label')}`}</Reveal>
        <Reveal as="h2" by="words" className="display mb-16 text-6xl italic text-sand md:mb-24 md:text-8xl">
          {t('docs.title')}
        </Reveal>
        <div className="space-y-20 md:space-y-28">
          {groups.map((g) => (
            <div key={g.key} className="grid gap-8 md:grid-cols-12">
              <div className="md:col-span-3">
                <Reveal as="p" className="label md:sticky md:top-32">
                  {g.label}
                </Reveal>
              </div>
              <div className="md:col-span-9">
                <DocList docs={documents.filter((d) => d.group === g.key)} />
              </div>
            </div>
          ))}
        </div>
        <p className="label mt-10">{t('docs.note')}</p>
      </section>

      <section className="tone-light panel px-5 py-24 md:px-10 md:py-32">
        <Reveal as="p" className="label mb-16">{`— ${t('stats.label')}`}</Reveal>
        <Stats />
      </section>

      <section className="px-5 py-24 md:px-10 md:py-32">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-7">
          {categories.map((c) => (
            <div key={c.id}>
              <GLImage src={c.image} alt={l(c.name)} className="aspect-[3/4]" />
              <p className="label mt-3">{l(c.name)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="tone-light panel">
        <p className="label px-5 pt-10 md:px-10">{`— ${t('clients.label')}`}</p>
        <Clients />
      </section>
      <ContactCTA />
    </>
  )
}
