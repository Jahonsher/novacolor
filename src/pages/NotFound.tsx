import { HeroCanvas } from '../gl/HeroCanvas'
import { Reveal } from '../components/Reveal'
import { TLink } from '../components/Transition'
import { useLang } from '../i18n'

export default function NotFound() {
  const { t } = useLang()
  return (
    <section className="tone-dark grain relative h-[100svh] overflow-hidden bg-ink">
      <div className="absolute inset-0 opacity-70">
        <HeroCanvas />
      </div>
      <div className="relative flex h-full flex-col items-center justify-center gap-8 px-5 text-center">
        <Reveal as="p" by="chars" immediate className="display text-[30vw] leading-none md:text-[20vw]">
          404
        </Reveal>
        <Reveal as="p" immediate delay={0.3} className="display text-3xl italic md:text-5xl">
          {t('notfound.title')}
        </Reveal>
        <TLink to="/" className="label link-line !text-bone" data-cursor="link">
          ← {t('notfound.back')}
        </TLink>
      </div>
    </section>
  )
}
