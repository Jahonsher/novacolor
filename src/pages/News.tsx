import { GLImage } from '../components/GLImage'
import { Reveal } from '../components/Reveal'
import { TLink } from '../components/Transition'
import { ContactCTA, NewsList } from '../components/Blocks'
import { news, pad, productBySlug } from '../data'
import { formatDate, useLang } from '../i18n'

export default function News() {
  const { t, l, lang } = useLang()
  const [lead, ...rest] = news
  const leadProduct = lead.product ? productBySlug(lead.product) : undefined

  return (
    <>
      <section className="px-5 pb-20 pt-36 md:px-10 md:pt-48">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-8">
            <Reveal as="p" className="label mb-8">{`— ${t('news.label')}`}</Reveal>
            <Reveal as="h1" by="chars" immediate className="display text-[18vw] md:text-[12vw]">
              {t('news.page.title')}
            </Reveal>
          </div>
          <div className="flex items-end md:col-span-4">
            <Reveal as="p" delay={0.3} className="max-w-sm text-sm leading-relaxed text-ash">
              {t('news.page.intro')}
            </Reveal>
          </div>
        </div>
      </section>

      {/* featured story */}
      <section className="px-5 md:px-10">
        <TLink to={leadProduct ? `/products/${leadProduct.slug}` : '/news'} className="group grid gap-8 md:grid-cols-12" data-cursor="view">
          <GLImage src={lead.image} alt={lead.title} className="aspect-[4/5] md:col-span-6 md:aspect-[5/6]" eager />
          <div className="flex flex-col justify-between gap-8 md:col-span-5 md:col-start-8">
            <div className="flex justify-between">
              <span className="label">{pad(1)}</span>
              <span className="label">{formatDate(lead.date, lang)}</span>
            </div>
            <div>
              <Reveal as="h2" by="chars" className="display text-[18vw] transition-transform duration-1000 ease-[var(--ease-expo)] group-hover:italic md:text-[8vw]">
                {lead.title}
              </Reveal>
              {leadProduct && <Reveal as="p" className="mt-6 max-w-md text-ash">{l(leadProduct.subtitle)}</Reveal>}
              <span className="label mt-10 inline-flex items-center gap-3 !text-bone">
                <span className="link-line">{t('news.read')}</span>
                <span className="transition-transform duration-500 group-hover:translate-x-2">→</span>
              </span>
            </div>
          </div>
        </TLink>
      </section>

      {/* the rest as a big grid */}
      <section className="tone-light panel mt-24 px-5 py-24 md:mt-32 md:px-10 md:py-32">
        <div className="grid gap-x-8 gap-y-16 md:grid-cols-2">
          {rest.map((n, i) => {
            const p = n.product ? productBySlug(n.product) : undefined
            return (
              <TLink key={n.id} to={p ? `/products/${p.slug}` : '/news'} className={`group block ${i % 2 ? 'md:mt-32' : ''}`} data-cursor="view">
                <GLImage src={n.image} alt={n.title} className="aspect-[4/3]" />
                <div className="mt-5 flex items-baseline justify-between border-b border-line pb-4">
                  <h3 className="display text-4xl transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-2 group-hover:italic md:text-6xl">{n.title}</h3>
                  <span className="label">{pad(i + 2)}</span>
                </div>
                <div className="mt-3 flex justify-between text-sm text-ash">
                  <span className="line-clamp-1">{p ? l(p.subtitle) : ''}</span>
                  <span className="shrink-0 pl-4">{formatDate(n.date, lang)}</span>
                </div>
              </TLink>
            )
          })}
        </div>
      </section>

      <section className="px-5 py-24 md:px-10">
        <p className="label border-b border-line pb-5">{`— ${t('news.title')}`}</p>
        <NewsList />
      </section>
      <ContactCTA />
    </>
  )
}
