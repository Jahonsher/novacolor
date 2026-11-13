import { asset, pad, type Doc } from '../data'
import { useLang } from '../i18n'
import { FadeUp } from './Reveal'

const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`)

/** A list of downloadable PDFs (certificates, EPDs) — each row opens the file in a new tab. */
export function DocList({ docs }: { docs: Doc[] }) {
  const { l } = useLang()
  return (
    <ul className="border-t border-line">
      {docs.map((d, i) => (
        <li key={d.file}>
          <FadeUp y={24}>
            <a
              href={asset(d.path ?? `pdf/${d.file}`)}
              target="_blank"
              rel="noopener"
              data-cursor="link"
              className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-line py-5 md:grid-cols-[4rem_1fr_6rem_auto] md:gap-8 md:py-6"
            >
              <span className="label tabular-nums">{pad(i + 1)}</span>
              <span className="display text-xl leading-snug transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-2 md:text-3xl">{l(d.title)}</span>
              <span className="label hidden text-right md:block">{fmtSize(d.size)}</span>
              <span className="flex items-center gap-3">
                <span className="label hidden !text-bone sm:inline">PDF</span>
                <span className="grid h-11 w-11 place-items-center rounded-full border border-line transition-colors duration-500 group-hover:bg-bone group-hover:text-ink md:h-12 md:w-12">↓</span>
              </span>
            </a>
          </FadeUp>
        </li>
      ))}
    </ul>
  )
}
