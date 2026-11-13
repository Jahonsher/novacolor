import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, type About, type AdminSettings, type Contacts, type TelegramChat, type TelegramSettings } from '../api'
import { errText, useAdmin, useToast } from '../lib'
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, PageLoader, SectionTitle, Spinner, Textarea } from '../ui'

export default function Settings() {
  const { content, contentError, reloadContent } = useAdmin()
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />
  return (
    <>
      <PageHeader title="Sozlamalar" sub="Aloqa ma’lumotlari, “Biz haqimizda” matni, Telegram va AI holati" />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <ContactsForm initial={content.contacts} />
          <AboutForm initial={content.about} />
        </div>
        <ServiceStatus />
      </div>
    </>
  )
}

function FormCard({
  title,
  children,
  onSubmit,
  dirty,
  saving,
  onReset,
}: {
  title: string
  children: ReactNode
  onSubmit: () => void
  dirty: boolean
  saving: boolean
  onReset: () => void
}) {
  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <div className="grid gap-4 p-4 md:p-5">
          <SectionTitle className="mb-0">{title}</SectionTitle>
          {children}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3 md:px-5">
          {dirty && <span className="mr-auto text-sm text-amber-700">Saqlanmagan o‘zgarishlar</span>}
          <Button disabled={!dirty || saving} onClick={onReset}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Saqlash
          </Button>
        </div>
      </form>
    </Card>
  )
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

function ContactsForm({ initial }: { initial: Contacts }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const [saved, setSaved] = useState(initial)
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const set = <K extends keyof Contacts>(k: K, v: Contacts[K]) => setF((s) => ({ ...s, [k]: v }))

  const submit = async () => {
    if (!f.phone.trim()) return toast.show('error', 'Telefon raqamini kiriting')
    setSaving(true)
    try {
      const body = { ...f, phoneHref: f.phoneHref.trim() || telHref(f.phone) }
      await api.updateContacts(body)
      setSaved(body)
      setF(body)
      await reloadContent()
      toast.success()
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard title="Aloqa ma’lumotlari" onSubmit={submit} dirty={dirty} saving={saving} onReset={() => setF(saved)}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Telefon (saytda ko‘rinadigan)">
          {(id) => (
            <Input
              id={id}
              type="tel"
              value={f.phone}
              placeholder="+998 (97) 422 22 77"
              onChange={(e) => {
                const phone = e.target.value
                // keep the tel: link in sync while it still matches the old number
                setF((s) => ({ ...s, phone, phoneHref: s.phoneHref === telHref(s.phone) || !s.phoneHref ? telHref(phone) : s.phoneHref }))
              }}
            />
          )}
        </Field>
        <Field label="Telefon havolasi" hint="Masalan: tel:+998974222277 — telefon bilan avtomatik yangilanadi">
          {(id) => (
            <Input id={id} value={f.phoneHref} onChange={(e) => set('phoneHref', e.target.value)} className="font-mono text-sm" spellCheck={false} />
          )}
        </Field>
        <Field label="Email">
          {(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />}
        </Field>
        <Field label="Telegram havolasi">
          {(id) => (
            <Input id={id} type="url" value={f.telegram} placeholder="https://t.me/…" onChange={(e) => set('telegram', e.target.value)} />
          )}
        </Field>
        <Field label="Instagram havolasi">
          {(id) => (
            <Input
              id={id}
              type="url"
              value={f.instagram}
              placeholder="https://www.instagram.com/…"
              onChange={(e) => set('instagram', e.target.value)}
            />
          )}
        </Field>
        <div className="hidden md:block" />
        <Field label="Manzil (o‘zbekcha)">
          {(id) => <Input id={id} value={f.address.uz} onChange={(e) => set('address', { ...f.address, uz: e.target.value })} />}
        </Field>
        <Field label="Manzil (ruscha)">
          {(id) => (
            <Input id={id} lang="ru" value={f.address.ru} onChange={(e) => set('address', { ...f.address, ru: e.target.value })} />
          )}
        </Field>
      </div>
      <Field label="Xarita (iframe havolasi)" hint="Yandex Maps → Ulashish → Kartani joylashtirish → src=“…” ichidagi havola">
        {(id) => (
          <Textarea id={id} rows={3} value={f.map} onChange={(e) => set('map', e.target.value)} className="font-mono text-xs" spellCheck={false} />
        )}
      </Field>
    </FormCard>
  )
}

function AboutForm({ initial }: { initial: About }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const [saved, setSaved] = useState(initial)
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)

  const submit = async () => {
    setSaving(true)
    try {
      await api.updateAbout(f)
      setSaved(f)
      await reloadContent()
      toast.success()
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }
  const area = (k: keyof About, lang: 'uz' | 'ru', label: string) => (
    <Field label={label}>
      {(id) => (
        <Textarea
          id={id}
          lang={lang}
          rows={6}
          value={f[k][lang]}
          onChange={(e) => setF((s) => ({ ...s, [k]: { ...s[k], [lang]: e.target.value } }))}
        />
      )}
    </Field>
  )
  return (
    <FormCard title="“Biz haqimizda” matni" onSubmit={submit} dirty={dirty} saving={saving} onReset={() => setF(saved)}>
      <div className="grid gap-4 md:grid-cols-2">
        {area('lead', 'uz', 'Asosiy matn (o‘zbekcha)')}
        {area('lead', 'ru', 'Asosiy matn (ruscha)')}
        {area('extra', 'uz', 'Qo‘shimcha matn (o‘zbekcha)')}
        {area('extra', 'ru', 'Qo‘shimcha matn (ruscha)')}
      </div>
    </FormCard>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-stone-500">{k}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-stone-800">{children}</dd>
    </div>
  )
}

function ServiceStatus() {
  const toast = useToast()
  const [s, setS] = useState<AdminSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const fetchSettings = useCallback(
    () =>
      api.settings().then(
        (r) => {
          setS(r)
          setError(null)
        },
        (e) => setError(errText(e)),
      ),
    [],
  )
  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])
  const load = () => {
    setError(null)
    void fetchSettings()
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.telegramTest()
      if (r.ok) toast.success('Sinov xabari yuborildi — Telegram’ni tekshiring')
      else toast.show('error', `Xabar yuborilmadi: ${r.error ?? 'noma’lum xato'}`)
    } catch (e) {
      toast.error(e)
    } finally {
      setTesting(false)
    }
  }

  if (error) return <ErrorBox text={error} onRetry={load} />
  if (!s)
    return (
      <Card className="flex items-center justify-center gap-3 p-8 text-stone-500">
        <Spinner /> Yuklanmoqda…
      </Card>
    )

  const { telegram: tg, ai } = s
  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 md:p-5">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle className="mb-0">Telegram bot</SectionTitle>
          {tg.configured ? <Badge tone="green">Ulangan</Badge> : <Badge tone="red">Sozlanmagan</Badge>}
        </div>
        <dl className="divide-y divide-stone-100">
          <Row k="Bot">
            {tg.botUsername ? (
              <a href={`https://t.me/${tg.botUsername}`} target="_blank" rel="noreferrer" className="text-amber-800 hover:underline">
                @{tg.botUsername}
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row k="Chat ID">{tg.chatId ?? <span className="text-amber-700">yo‘q</span>}</Row>
        </dl>
        {!tg.configured && (
          <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            Bot tokeni serverdagi <code className="font-mono text-xs">.env</code> faylida{' '}
            <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> sifatida yoziladi, so‘ng server qayta ishga
            tushiriladi.
          </p>
        )}
        {/* key: a new saved value resets the field */}
        <ChatIdForm key={tg.chatId ?? ''} tg={tg} onSaved={(t) => setS((cur) => (cur ? { ...cur, telegram: t } : cur))} />
        {tg.configured && (
          <>
            {!tg.chatId && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                Arizalar Telegram’ga kelishi uchun yuqorida Chat ID’ni kiriting va saqlang, keyin sinov tugmasini bosing.
              </p>
            )}
            <Button className="mt-3 w-full" onClick={test} loading={testing}>
              Sinov xabari yuborish
            </Button>
          </>
        )}
      </Card>

      <Card className="p-4 md:p-5">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle className="mb-0">AI yordamchi</SectionTitle>
          {ai.enabled ? <Badge tone="green">Yoqilgan</Badge> : <Badge tone="red">O‘chiq</Badge>}
        </div>
        <dl className="divide-y divide-stone-100">
          <Row k="Provayder">{ai.provider}</Row>
          <Row k="Model">
            <span className="font-mono text-xs">{ai.model || '—'}</span>
          </Row>
        </dl>
        {ai.provider === 'free' && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            Bepul provayder faqat sinov uchun: javoblar sifati past va ma’lumotlar uchinchi tomonga yuboriladi.
          </p>
        )}
        <p className="mt-3 text-sm text-stone-500">
          API kalitlari va provayder serverdagi <code className="font-mono text-xs">.env</code> faylida sozlanadi (
          <code className="font-mono text-xs">AI_PROVIDER</code>, <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>{' '}
          yoki <code className="font-mono text-xs">AI_API_KEY</code>, <code className="font-mono text-xs">AI_MODEL</code>).
          Xavfsizlik uchun ular admin panelda ko‘rsatilmaydi.
        </p>
      </Card>
    </div>
  )
}

const CHAT_ID_RE = /^$|^-?\d{3,20}$|^@[A-Za-z][A-Za-z0-9_]{4,31}$/

/** Telegram chat ID, saved to the server's settings.json (TELEGRAM_CHAT_ID in .env wins). */
function ChatIdForm({ tg, onSaved }: { tg: TelegramSettings; onSaved: (t: TelegramSettings) => void }) {
  const toast = useToast()
  const fromEnv = tg.chatIdSource === 'env'
  const [value, setValue] = useState(tg.chatId ?? '')
  const [saving, setSaving] = useState(false)
  const [found, setFound] = useState<{ chats?: TelegramChat[]; error?: string } | null>(null)
  const [finding, setFinding] = useState(false)

  // lists who wrote to the bot recently; the admin picks one explicitly (nothing is saved automatically)
  const detect = async () => {
    setFinding(true)
    try {
      const r = await api.telegramChats()
      setFound(r.ok ? { chats: r.chats ?? [] } : { error: r.error ?? 'Xatolik' })
    } catch (err) {
      setFound({ error: errText(err) })
    } finally {
      setFinding(false)
    }
  }
  const trimmed = value.trim()
  const invalid = !CHAT_ID_RE.test(trimmed)
  const dirty = trimmed !== (tg.chatId ?? '')

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (invalid || !dirty) return
    setSaving(true)
    try {
      const t = await api.setTelegramChat(trimmed)
      onSaved(t)
      toast.success(trimmed ? 'Chat ID saqlandi' : 'Chat ID o‘chirildi')
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-3 border-t border-stone-100 pt-3">
      <Field
        label="Arizalar keladigan Chat ID"
        hint={
          fromEnv
            ? 'Chat ID serverdagi .env faylida (TELEGRAM_CHAT_ID) o‘rnatilgan va u ustun turadi — bu yerda o‘zgartirib bo‘lmaydi.'
            : undefined
        }
        error={invalid ? 'Chat ID raqam bo‘lishi kerak (guruh uchun -100… bilan boshlanadi) yoki @kanal_nomi.' : null}
      >
        {(id) => (
          <div className="flex gap-2">
            <Input
              id={id}
              value={value}
              inputMode="text"
              placeholder="masalan 123456789"
              disabled={fromEnv}
              aria-invalid={invalid || undefined}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono text-sm"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" disabled={fromEnv || invalid || !dirty} loading={saving}>
              Saqlash
            </Button>
          </div>
        )}
      </Field>
      {!fromEnv && tg.configured && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={detect} loading={finding}>
            Botga yozganlarni ko‘rish (aniqlash)
          </Button>
          {found?.error && <p className="mt-1.5 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">{found.error}</p>}
          {found?.chats && found.chats.length === 0 && (
            <p className="mt-1.5 text-sm text-stone-500">Hech kim yozmagan. Botga /start yozing va qayta bosing.</p>
          )}
          {found?.chats && found.chats.length > 0 && (
            <ul className="mt-1.5 divide-y divide-stone-100 rounded-lg border border-stone-200">
              {found.chats.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {c.name ?? '—'}
                    {c.username && <span className="text-stone-500"> @{c.username}</span>}
                    <span className="block font-mono text-xs text-stone-500">
                      {c.id} · {c.type === 'private' ? 'shaxsiy' : c.type}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => setValue(c.id)}>
                    Tanlash
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!fromEnv && (
        <div className="mt-2 space-y-1.5 text-sm text-stone-600">
          <p>
            Chat ID’ni bilish uchun Telegram’da{' '}
            <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-amber-800 underline">
              @userinfobot
            </a>{' '}
            ga yozing — u sizning raqamli ID’ingizni yuboradi.
          </p>
          <p>
            Muhim: shu foydalanuvchi botimizga{tg.botUsername ? <> (@{tg.botUsername})</> : null} oldin <b>/start</b> yozgan
            bo‘lishi kerak, aks holda bot unga xabar yubora olmaydi. Guruhga yuborish uchun botni guruhga qo‘shing va guruh
            ID’sini (-100… bilan boshlanadi) kiriting.
          </p>
        </div>
      )}
    </form>
  )
}
