import { Reveal, FadeUp } from '../components/Reveal'
import { Clients as ClientStrip, ContactCTA, SectionHead, Stats } from '../components/Blocks'
import { asset, clients, pad } from '../data'
import { clientInfo, sectors, type SectorKey } from '../data/clients'
import { useLang } from '../i18n'

export default function Clients() {
  const { t, l, lang } = useLang()
  const list = clients.map((src) => ({ src, info: clientInfo(src) }))
  // sectors in the order they first appear among the logos
  const used = [...new Set(list.map((c) => c.info?.sector).filter(Boolean))] as SectorKey[]

  const steps = [
    { title: t('clients.step1'), text: t('clients.step1.text') },
    { title: t('clients.step2'), text: t('clients.step2.text') },
    { title: t('clients.step3'), text: t('clients.step3.text') },
    { title: t('clients.step4'), text: t('clients.step4.text') },
  ]

  return (
    <>
      <section className="px-5 pb-16 pt-36 md:px-10 md:pb-24 md:pt-48">
        <Reveal as="p" className="label mb-8">{`— ${t('nav.clients')}`}</Reveal>
        <Reveal as="h1" by="chars" immediate className="display text-[15vw] md:text-[10vw]">
          {t('nav.clients')}
        </Reveal>
        <div className="mt-14 grid gap-10 md:grid-cols-12">
          <p className="label md:col-span-3">{t('clients.title')}</p>
          <Reveal as="p" by="words" className="display text-3xl leading-[1.15] md:col-span-9 md:text-5xl">
            {t('clients.lead')}
          </Reveal>
        </div>
      </section>

      <ClientStrip />

      {/* every client: logo card + name, field and a short note */}
      <section className="tone-light panel mt-16 px-5 py-24 md:mt-24 md:px-10 md:py-32">
        <SectionHead index="01" label={t('clients.grid')}>
          <span className="label">{`${pad(list.length)} ${lang === 'ru' ? 'компаний' : 'ta kompaniya'}`}</span>
        </SectionHead>
        <div className="mt-14 grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(({ src, info }, i) => (
            <FadeUp key={src}>
              <article>
                <div className="flex aspect-[16/10] items-center justify-center rounded-[28px] bg-white p-10 shadow-[0_18px_40px_-28px_rgb(22_21_19/0.45)] md:p-12">
                  <img src={asset(src)} alt={info?.name ?? ''} className="max-h-full max-w-full object-contain" loading="lazy" draggable={false} />
                </div>
                {info && (
                  <div className="mt-6">
                    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
                      <h3 className="display text-3xl md:text-4xl">{info.name}</h3>
                      <span className="label shrink-0">{pad(i + 1)}</span>
                    </div>
                    <p className="label mt-4 !text-sand">{l(sectors[info.sector].name)}</p>
                    <p className="mt-3 text-sm leading-relaxed text-ash">{l(info.about)}</p>
                  </div>
                )}
              </article>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* the fields these clients come from and what Novacolor brings to each */}
      <section className="px-5 py-24 md:px-10 md:py-32">
        <SectionHead index="02" label={t('clients.sectors')} />
        <Reveal as="h2" by="words" className="display mt-12 max-w-[16ch] text-5xl md:text-7xl">
          {t('clients.sectors.title')}
        </Reveal>
        <div className="mt-16">
          {used.map((k, i) => (
            <FadeUp key={k}>
              <div className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-6 md:py-10">
                <span className="label md:col-span-1">{pad(i + 1)}</span>
                <h3 className="display text-3xl md:col-span-4 md:text-5xl">{l(sectors[k].name)}</h3>
                <p className="text-sm leading-relaxed text-ash md:col-span-6 md:col-start-7 md:text-base">{l(sectors[k].text)}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* how a project goes */}
      <section className="tone-char panel px-5 py-24 md:px-10 md:py-32">
        <SectionHead index="03" label={t('clients.process')} />
        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {steps.map((s, i) => (
            <FadeUp key={i}>
              <div className="h-full rounded-[28px] bg-ink/70 p-7 md:p-8">
                <p className="display text-6xl text-sand">{pad(i + 1)}</p>
                <h3 className="display mt-8 text-3xl">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ash">{s.text}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      <section className="px-5 py-24 md:px-10 md:py-32">
        <Reveal as="p" className="label mb-16">{`— ${t('stats.label')}`}</Reveal>
        <Stats />
      </section>

      <ContactCTA />
    </>
  )
}
