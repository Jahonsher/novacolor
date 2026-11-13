import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Reveal, FadeUp } from '../components/Reveal'
import { contacts } from '../data'
import { useLang } from '../i18n'
import { apiUrl } from '../lib/api'

/**
 * The form posts JSON to VITE_CONTACT_ENDPOINT when one is configured, else to
 * the site's own server (/api/leads → saved + forwarded to the Telegram bot)
 * in the server build. The static GitHub Pages build has neither: it copies the
 * message and opens the company's Telegram chat.
 */
// (env check inline rather than API_ENABLED so the static build carries no /api code)
const ENDPOINT = import.meta.env.VITE_CONTACT_ENDPOINT || (import.meta.env.VITE_API ? apiUrl('leads') : undefined)

const PHONE_RE = /^[0-9+\s\-()]{5,30}$/

// same limits as the server (POST /api/leads), so a visitor can't type past them
const MAX_LEN: Record<string, number> = { name: 100, phone: 30, product: 200, message: 2000 }

function Field({ label, name, type = 'text', textarea, required, defaultValue }: { label: string; name: string; type?: string; textarea?: boolean; required?: boolean; defaultValue?: string }) {
  const cls =
    'peer w-full border-0 border-b border-line bg-transparent pb-3 pt-7 text-xl text-bone outline-none transition-colors duration-500 placeholder:text-transparent focus:border-bone md:text-2xl'
  return (
    <label className="relative block">
      {textarea ? (
        <textarea name={name} rows={4} required={required} maxLength={MAX_LEN[name]} placeholder={label} defaultValue={defaultValue} className={`${cls} resize-none`} data-lenis-prevent />
      ) : (
        <input name={name} type={type} required={required} maxLength={MAX_LEN[name]} placeholder={label} defaultValue={defaultValue} className={cls} />
      )}
      <span className="label pointer-events-none absolute left-0 top-0 transition-all duration-500 peer-placeholder-shown:top-8 peer-placeholder-shown:text-base peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-0 peer-focus:text-[0.6875rem] peer-focus:uppercase peer-focus:tracking-[0.22em]">
        {label}
      </span>
    </label>
  )
}

export default function Contact() {
  const { t, l } = useLang()
  const [params] = useSearchParams()
  const product = params.get('p') ?? ''
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'copied' | 'error'>('idle')
  // shown instead of the generic "couldn't send, please call" text when we know what is wrong
  const [errorText, setErrorText] = useState('')

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    const data = Object.fromEntries(form.entries()) as Record<string, string>
    setErrorText('')
    // same rule as the server (digits, + - ( ) and spaces), checked here so the hint is in the visitor's language
    const phone = (data.phone ?? '').trim()
    if (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 7) {
      setErrorText(t('contact.phoneInvalid'))
      setStatus('error')
      formEl.querySelector<HTMLInputElement>('input[name=phone]')?.focus()
      return
    }
    setStatus('sending')
    if (ENDPOINT) {
      try {
        const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        if (!res.ok) {
          // the server explains validation / rate-limit problems in `{ error }` ("field: message" for validation)
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null
          if (typeof body?.error === 'string') {
            const msg = body.error.replace(/^[a-z_.]+: /i, '')
            setErrorText(res.status === 400 ? msg : `${msg} ${t('contact.error')}`)
          }
          throw new Error(String(res.status))
        }
        setStatus('sent')
        formEl.reset()
      } catch {
        setStatus('error')
      }
      return
    }
    const text = [
      `${t('contact.name')}: ${data.name}`,
      `${t('contact.phone')}: ${data.phone}`,
      data.product ? `${t('contact.product')}: ${data.product}` : '',
      `${t('contact.message')}: ${data.message}`,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard may be blocked; Telegram still opens */
    }
    window.open(contacts.telegram, '_blank', 'noopener')
    setStatus('copied')
  }

  const info = [
    { label: t('contact.phone'), value: contacts.phone, href: contacts.phoneHref },
    { label: t('contact.email'), value: contacts.email, href: `mailto:${contacts.email}` },
    { label: t('contact.address'), value: l(contacts.address) },
  ]

  return (
    <>
      <section className="px-5 pb-20 pt-36 md:px-10 md:pt-48">
        <Reveal as="p" className="label mb-8">{`— ${t('contact.label')}`}</Reveal>
        <Reveal as="h1" by="words" immediate className="display max-w-[12ch] text-[15vw] md:text-[9vw]">
          {t('contact.title')}
        </Reveal>
      </section>

      <section className="tone-light panel px-5 py-20 md:px-10 md:py-28">
        <div className="grid gap-20 md:grid-cols-12">
          <FadeUp className="md:col-span-7">
            <form onSubmit={submit} className="space-y-10">
              {/* honeypot: hidden from people, bots fill it in — the server silently drops those */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                defaultValue=""
                className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden opacity-0"
              />
              <div className="grid gap-10 md:grid-cols-2">
                <Field label={t('contact.name')} name="name" required />
                <Field label={t('contact.phone')} name="phone" type="tel" required />
              </div>
              {product && <Field label={t('contact.product')} name="product" defaultValue={product} />}
              <Field label={t('contact.message')} name="message" textarea required />
              <div className="flex flex-wrap items-center gap-8">
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="group relative h-36 w-36 overflow-hidden rounded-full border border-bone/40 disabled:opacity-50"
                  data-cursor="link"
                >
                  <span className="absolute inset-0 translate-y-full rounded-full bg-bone transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-y-0" />
                  <span className="label relative !text-bone transition-colors duration-500 group-hover:!text-ink">
                    {status === 'sending' ? t('contact.sending') : t('contact.send')}
                  </span>
                </button>
                {/* the form sits on the light (tone-light) panel: dark red stays readable there */}
                <p aria-live="polite" className={`max-w-sm text-sm ${status === 'error' ? 'text-red-700' : 'text-sand'}`}>
                  {status === 'sent' && t('contact.sent')}
                  {status === 'copied' && t('contact.copied')}
                  {status === 'error' && (errorText || t('contact.error'))}
                </p>
              </div>
            </form>
          </FadeUp>

          <div className="space-y-10 md:col-span-4 md:col-start-9">
            {info.map((i, k) => (
              <FadeUp key={i.label} delay={k * 0.08} className="border-t border-line pt-5">
                <p className="label mb-3">{i.label}</p>
                {i.href ? (
                  <a href={i.href} className="display link-line text-3xl">
                    {i.value}
                  </a>
                ) : (
                  <p className="display text-3xl">{i.value}</p>
                )}
              </FadeUp>
            ))}
            <FadeUp delay={0.25} className="border-t border-line pt-5">
              <p className="label mb-3">{t('contact.socials')}</p>
              <div className="flex gap-6">
                <a href={contacts.telegram} target="_blank" rel="noreferrer" className="display link-line text-3xl">
                  Telegram ↗
                </a>
                <a href={contacts.instagram} target="_blank" rel="noreferrer" className="display link-line text-3xl">
                  Instagram ↗
                </a>
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      <FadeUp className="px-5 py-24 md:px-10">
        <div className="relative aspect-[4/3] overflow-hidden border border-line md:aspect-[21/9]">
          <iframe
            title="Novacolor — map"
            src={contacts.map}
            className="absolute inset-0 h-full w-full [filter:grayscale(1)_invert(0.92)_contrast(0.9)]"
            loading="lazy"
            allowFullScreen
          />
        </div>
      </FadeUp>
    </>
  )
}
