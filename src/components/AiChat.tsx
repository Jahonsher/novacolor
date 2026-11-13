import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { TLink } from './Transition'
import { useLang, type Key } from '../i18n'
import { useQuality } from '../lib/perf'
import { useMedia } from '../lib/motion'
import { ApiError, apiGet, apiPost } from '../lib/api'
import { productBySlug } from '../data'

/**
 * Customer-facing AI assistant (docs/backend-spec.md → POST /api/ai/chat).
 *
 * Loaded lazily from App.tsx only in the server build, after the preloader.
 * Shows nothing unless /api/health reports `ai: true`. No JS animation: all
 * motion is CSS transitions, so a closed widget costs nothing per frame.
 */

type Msg = { role: 'user' | 'assistant'; content: string; lead?: boolean }
type Failure = { kind: 'error' | 'limit'; message: string }

const SESSION_KEY = 'nc-ai-session'
const MSGS_KEY = 'nc-ai-messages-v1'
const MAX_KEPT = 60

/* ---------------- persistence ---------------- */

const uuid = () => {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch {
    /* insecure context */
  }
  const b = new Uint8Array(16)
  try {
    crypto.getRandomValues(b)
  } catch {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function sessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return (memoryId ??= uuid())
  }
}
let memoryId: string | undefined

function loadMsgs(): Msg[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(MSGS_KEY) || '[]') as unknown
    return Array.isArray(v) ? v.filter((m): m is Msg => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string') : []
  } catch {
    return []
  }
}
function saveMsgs(m: Msg[]) {
  try {
    sessionStorage.setItem(MSGS_KEY, JSON.stringify(m.slice(-MAX_KEPT)))
  } catch {
    /* storage full / blocked */
  }
}

/* one health check per page load */
let health: Promise<boolean> | null = null
const checkHealth = () =>
  (health ??= apiGet<{ ai?: boolean }>('health', { timeout: 5000 })
    .then((h) => h?.ai === true)
    .catch(() => false))

/* ---------------- safe rich text ----------------
 * No HTML from the model ever reaches the DOM: the reply is tokenised into
 * text / **bold** / in-app routes / http(s) URLs / phone numbers and rendered
 * as React elements. Line breaks come from `white-space: pre-wrap`. */

const BASE = import.meta.env.BASE_URL
const ROUTE_RE = /^\/(?:products|about|news|contact)(?:\/[a-z0-9-]+)?\/?$|^\/$/i

const LINK_RE = new RegExp(
  [
    /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/.source, // 1,2 markdown link
    /(https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?»])/.source, // 3 url
    /(?<![\w/.:-])(\/(?:products|about|news|contact)(?:\/[a-z0-9-]*[a-z0-9])?)(?![\w/])/.source, // 4 route
    /(?<![\w+])(\+?\d[\d \-()]{6,}\d)(?![\w])/.source, // 5 phone-ish
  ].join('|'),
  'gi',
)

type Target = { kind: 'route'; to: string } | { kind: 'url'; href: string } | { kind: 'tel'; href: string }

function resolve(raw: string): Target | null {
  if (raw.startsWith('/')) return ROUTE_RE.test(raw) ? { kind: 'route', to: raw.replace(/\/$/, '') || '/' } : null
  if (/^tel:\+?[\d\s()-]{5,}$/i.test(raw)) return { kind: 'tel', href: `tel:${raw.slice(4).replace(/[^\d+]/g, '')}` }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      // links to this very site open in-app (with the page transition)
      if (u.origin === location.origin && (u.pathname + '/').startsWith(BASE)) {
        const to = '/' + u.pathname.slice(BASE.length)
        if (ROUTE_RE.test(to)) return { kind: 'route', to: to.replace(/\/$/, '') || '/' }
      }
      return { kind: 'url', href: u.href }
    } catch {
      return null
    }
  }
  return null
}

type Labels = { route: (to: string) => string }

/** Bare links get a readable label: product name / page name / URL without the scheme. */
const routeLabel = (to: string, t: (k: Key) => string) => {
  const [, section, slug] = to.split('/')
  if (section === 'products' && slug) {
    const p = productBySlug(slug)
    return p ? `${p.name} →` : to
  }
  const nav: Record<string, Key> = { '': 'nav.home', products: 'nav.products', about: 'nav.about', news: 'nav.news', contact: 'nav.contact' }
  return nav[section ?? ''] ? `${t(nav[section ?? ''])} →` : to
}
const urlLabel = (href: string) => href.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

function linkify(text: string, keyBase: string, onRoute: () => void, labels: Labels): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  const cls = 'underline decoration-sand/60 underline-offset-[3px] transition-colors hover:text-sand [overflow-wrap:anywhere]'
  const push = (target: Target | null, label: string, raw: string) => {
    const key = `${keyBase}-${i++}`
    if (!target) return void out.push(raw)
    if (target.kind === 'route')
      out.push(
        <TLink key={key} to={target.to} onClick={onRoute} className={cls} data-cursor="link">
          {label}
        </TLink>,
      )
    else
      out.push(
        <a key={key} href={target.href} className={cls} data-cursor="link" {...(target.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {label}
        </a>,
      )
  }
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    last = at + m[0].length
    if (m[1] !== undefined) push(resolve(m[2]), m[1], m[0])
    else if (m[3] !== undefined) {
      const r = resolve(m[3])
      push(r, r?.kind === 'route' ? labels.route(r.to) : urlLabel(m[3]), m[0])
    } else if (m[4] !== undefined) {
      const r = resolve(m[4])
      push(r, r?.kind === 'route' ? labels.route(r.to) : m[4], m[0])
    }
    else if (m[5] !== undefined) {
      const digits = m[5].replace(/\D/g, '')
      push(digits.length >= 9 && digits.length <= 15 ? { kind: 'tel', href: `tel:${m[5].trim().startsWith('+') ? '+' : ''}${digits}` } : null, m[5], m[0])
    }
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function RichText({ text, onRoute }: { text: string; onRoute: () => void }) {
  const { t } = useLang()
  const labels: Labels = { route: (to) => routeLabel(to, t) }
  const parts = text.split(/\*\*([^*\n][^*]*?)\*\*/g)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <strong key={i} className="font-semibold text-bone">
            {linkify(p, `b${i}`, onRoute, labels)}
          </strong>
        ) : (
          linkify(p, `t${i}`, onRoute, labels)
        ),
      )}
    </>
  )
}

/* ---------------- widget ---------------- */

const CHIPS: Key[] = ['ai.chip1', 'ai.chip2', 'ai.chip3']

export default function AiChat() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    void checkHealth().then((ok) => alive && setEnabled(ok))
    return () => {
      alive = false
    }
  }, [])
  return enabled ? <ChatWidget /> : null
}

function ChatWidget() {
  const { t, lang } = useLang()
  const { pathname } = useLocation()
  const quality = useQuality()
  const desktop = useMedia('(min-width: 768px)')

  const [mounted, setMounted] = useState(false) // panel DOM is created on first open
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<(Failure & { retry: string }) | null>(null)
  const [draft, setDraft] = useState('')

  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)

  useEffect(() => saveMsgs(msgs), [msgs])

  const show = useCallback(() => {
    setMounted(true)
    // let the closed state paint once so the panel transitions in
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)))
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
  }, [])

  // keep the newest message in view
  useEffect(() => {
    if (!open) return
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, msgs, pending, failure])

  // focus the input on open (not on touch — it would pop the keyboard over the greeting)
  useEffect(() => {
    if (open && desktop) input.current?.focus({ preventScroll: true })
  }, [open, desktop])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hide])

  const send = useCallback(
    async (raw: string, retry = false) => {
      const message = raw.trim().slice(0, 1000)
      if (!message || busy.current) return
      busy.current = true
      setFailure(null)
      if (!retry) {
        setMsgs((m) => [...m, { role: 'user', content: message }])
        setDraft('')
      }
      setPending(true)
      try {
        const res = await apiPost<{ reply?: string; lead?: boolean }>(
          'ai/chat',
          { sessionId: sessionId(), lang, page: pathname, message },
          { timeout: 45000 },
        )
        const reply = typeof res?.reply === 'string' && res.reply.trim() ? res.reply.trim() : null
        if (!reply) throw new ApiError('empty', 502)
        setMsgs((m) => [...m, { role: 'assistant', content: reply, lead: res.lead === true || undefined }])
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(String(e), 0)
        const limit = err.status === 429 || err.data?.limit === true
        setFailure({ kind: limit ? 'limit' : 'error', message: err.status >= 400 && err.status !== 502 ? err.message : '', retry: message })
      } finally {
        busy.current = false
        setPending(false)
      }
    },
    [lang, pathname],
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }
  // grow the textarea with its content (up to ~5 lines)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [draft])

  // on phones the sheet covers the page — close it when a link leads elsewhere in the site
  const onRoute = useCallback(() => {
    if (!desktop) setOpen(false)
  }, [desktop])

  const glass = quality >= 3
  const empty = !msgs.some((m) => m.role === 'user')

  return (
    <>
      {/* launcher — below the header menu (z-48/49), transitions (90), lightbox (95), preloader (100), cursor (110) */}
      <button
        ref={button}
        type="button"
        onClick={open ? hide : show}
        aria-label={open ? t('ai.close') : t('ai.button')}
        aria-expanded={open}
        aria-controls="nc-ai-panel"
        title={open ? undefined : t('ai.button')}
        data-cursor="link"
        className={`fixed bottom-4 right-4 z-[47] grid h-14 w-14 place-items-center rounded-full border border-bone/20 bg-char text-bone shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)] transition-[transform,opacity] duration-500 ease-[var(--ease-expo)] hover:scale-105 active:scale-95 md:bottom-8 md:right-8 md:h-16 md:w-16 ${open ? 'max-md:pointer-events-none max-md:scale-75 max-md:opacity-0' : ''}`}
      >
        <span className={`absolute transition-[transform,opacity] duration-500 ease-[var(--ease-expo)] ${open ? 'rotate-45 scale-50 opacity-0' : ''}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M12 6.4l.85 2.25 2.25.85-2.25.85L12 12.6l-.85-2.25-2.25-.85 2.25-.85z" fill="var(--color-sand)" />
          </svg>
        </span>
        <span className={`absolute text-2xl font-light leading-none transition-[transform,opacity] duration-500 ease-[var(--ease-expo)] ${open ? '' : '-rotate-45 scale-50 opacity-0'}`} aria-hidden>
          ×
        </span>
        {empty && !open && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-char bg-sand" aria-hidden />}
      </button>

      {mounted && (
        <section
          id="nc-ai-panel"
          role="dialog"
          aria-label={t('ai.title')}
          aria-hidden={!open}
          data-lenis-prevent
          className={`fixed inset-x-0 bottom-0 z-[47] flex h-[85dvh] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-line text-bone shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.7)] transition-[transform,opacity,visibility] duration-500 ease-[var(--ease-expo)] md:inset-x-auto md:bottom-28 md:right-8 md:h-[560px] md:max-h-[calc(100dvh-9rem)] md:w-[380px] md:origin-bottom-right md:rounded-[28px] md:border-b ${
            glass ? 'bg-char/80 backdrop-blur-xl' : 'bg-char'
          } ${open ? 'visible translate-y-0 opacity-100 md:scale-100' : 'pointer-events-none invisible translate-y-8 opacity-0 md:translate-y-3 md:scale-95'}`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="display text-2xl leading-none">{t('ai.title')}</p>
              <p className="label mt-1.5 truncate !text-[0.625rem]">{t('ai.subtitle')}</p>
            </div>
            <button type="button" onClick={hide} aria-label={t('ai.close')} data-cursor="link" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-xl font-light transition-colors duration-300 hover:bg-bone hover:text-ink">
              ×
            </button>
          </header>

          <div ref={list} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-5" data-lenis-prevent aria-live="polite">
            <Bubble role="assistant">{t('ai.greeting')}</Bubble>
            {empty && (
              <div className="flex flex-wrap gap-2 pt-1">
                {CHIPS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => void send(t(k))}
                    disabled={pending}
                    data-cursor="link"
                    className="rounded-full border border-sand/40 px-3.5 py-2 text-left text-[0.8125rem] leading-snug text-bone/90 transition-colors duration-300 hover:border-sand hover:bg-sand hover:text-ink disabled:opacity-50"
                  >
                    {t(k)}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i}>
                <Bubble role={m.role}>{m.role === 'assistant' ? <RichText text={m.content} onRoute={onRoute} /> : m.content}</Bubble>
                {m.lead && <p className="mt-1.5 pl-1 text-xs text-sand">{t('ai.lead')}</p>}
              </div>
            ))}
            {pending && (
              <div className="flex items-center gap-1.5 px-1 py-2" role="status" aria-label={t('ai.typing')}>
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-sand" style={{ animationDelay: `${d * 0.2}s` }} />
                ))}
                <span className="label ml-2 !text-[0.625rem]">{t('ai.typing')}</span>
              </div>
            )}
            {failure && (
              <div className="rounded-2xl border border-red-300/30 px-4 py-3 text-sm text-red-200" role="alert">
                {failure.kind === 'limit' ? (
                  <p>{t('ai.limit')}</p>
                ) : (
                  <>
                    <p>{failure.message && lang === 'uz' ? failure.message : t('ai.error')}</p>
                    <button type="button" onClick={() => void send(failure.retry, true)} data-cursor="link" className="label mt-2 !text-bone underline underline-offset-4 hover:!text-sand">
                      {t('ai.retry')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <div className="flex items-end gap-2 rounded-[22px] border border-line bg-ink/60 py-1.5 pl-4 pr-1.5 focus-within:border-bone/40">
              <textarea
                ref={input}
                rows={1}
                value={draft}
                maxLength={1000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('ai.placeholder')}
                aria-label={t('ai.placeholder')}
                disabled={failure?.kind === 'limit'}
                className="max-h-[132px] min-h-9 flex-1 resize-none bg-transparent py-2 text-base md:text-[0.9375rem] leading-snug text-bone outline-none placeholder:text-ash disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim() || failure?.kind === 'limit'}
                aria-label={t('ai.send')}
                data-cursor="link"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bone text-ink transition-opacity duration-300 disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <p className="mt-2 px-1 text-[0.6875rem] leading-snug text-ash">{t('ai.disclaimer')}</p>
          </form>
        </section>
      )}
    </>
  )
}

function Bubble({ role, children }: { role: Msg['role']; children: ReactNode }) {
  const user = role === 'user'
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] whitespace-pre-wrap break-words px-4 py-2.5 text-[0.9375rem] leading-relaxed ${
          user ? 'rounded-[20px] rounded-br-md bg-bone text-ink' : 'rounded-[20px] rounded-bl-md border border-line bg-ink/50 text-bone/90'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
