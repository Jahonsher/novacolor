import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  api,
  type About,
  type AdminSettings,
  type Contacts,
  type TelegramChat,
  type TelegramMode,
  type TelegramSettings,
  type TelegramSubscriber,
  type TelegramUpdates,
} from '../api'
import { cx, errText, fmtDate, useAdmin, useConfirm, useToast } from '../lib'
import { Badge, Button, Card, ErrorBox, Field, Icon, IconButton, Input, PageHeader, PageLoader, SectionTitle, Spinner, Textarea } from '../ui'

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
  /** mode being saved (shown right away, reverted if saving fails) */
  const [pendingMode, setPendingMode] = useState<TelegramMode | null>(null)
  /** bumped after a test message (subscribers may have been switched off by Telegram errors) */
  const [subsVersion, setSubsVersion] = useState(0)

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
  const setTg = (t: TelegramSettings) => setS((cur) => (cur ? { ...cur, telegram: t } : cur))

  const test = async () => {
    setTesting(true)
    try {
      const r = await api.telegramTest()
      const counts = r.total ? `: ${r.sent ?? 0}/${r.total} ta qabul qiluvchiga` : ''
      const failed = r.results?.filter((x) => !x.ok) ?? []
      const why = failed[0]?.error ? ` — ${failed.length} tasida xato: ${failed[0].error}` : ''
      if (r.ok) toast.show(failed.length ? 'info' : 'success', `Sinov xabari yuborildi${counts}${why}`)
      else toast.show('error', `Xabar yuborilmadi: ${r.error ?? 'noma’lum xato'}`)
      if (r.results?.some((x) => x.deactivated)) setSubsVersion((v) => v + 1)
    } catch (e) {
      toast.error(e)
    } finally {
      setTesting(false)
    }
  }

  const changeMode = async (mode: TelegramMode) => {
    if (!s || mode === s.telegram.mode) return
    setPendingMode(mode)
    try {
      setTg(await api.setTelegramMode(mode))
      toast.success(mode === 'subscribers' ? 'Arizalar endi hamma obunachilarga yuboriladi' : 'Arizalar endi bitta chatga yuboriladi')
    } catch (e) {
      toast.error(e)
    } finally {
      setPendingMode(null)
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
  const single = tg.mode === 'single'
  const noRecipients = single ? !tg.chatId : tg.subscribers.active === 0
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
          <Row k="Arizalar kimga">
            {single ? (
              (tg.chatId ?? <span className="text-amber-700">Chat ID yo‘q</span>)
            ) : (
              <span className={tg.subscribers.active ? undefined : 'text-amber-700'}>{tg.subscribers.active} ta faol obunachi</span>
            )}
          </Row>
        </dl>
        {!tg.configured && (
          <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            Bot tokeni serverdagi <code className="font-mono text-xs">.env</code> faylida{' '}
            <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> sifatida yoziladi, so‘ng server qayta ishga
            tushiriladi.
          </p>
        )}
        {tg.configured && <ModeSwitch tg={tg} value={pendingMode ?? tg.mode} saving={!!pendingMode} onChange={changeMode} />}
        {/* key: a new saved value resets the field */}
        {single && <ChatIdForm key={tg.chatId ?? ''} tg={tg} onSaved={setTg} />}
        {tg.configured && (
          <>
            {noRecipients && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                {single
                  ? 'Arizalar Telegram’ga kelishi uchun yuqorida Chat ID’ni kiriting va saqlang, keyin sinov tugmasini bosing.'
                  : 'Hozircha faol obunachi yo‘q — arizalar Telegram’ga bormaydi. Quyidagi ro‘yxatga obunachi qo‘shing.'}
              </p>
            )}
            <Button className="mt-3 w-full" onClick={test} loading={testing}>
              Sinov xabari yuborish{single ? '' : ' (hammaga)'}
            </Button>
          </>
        )}
      </Card>

      {tg.configured && (
        <Subscribers
          key={subsVersion}
          tg={tg}
          onCounts={(active, total) => setS((cur) => (cur ? { ...cur, telegram: { ...cur.telegram, subscribers: { active, total } } } : cur))}
        />
      )}

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

const MODES: { value: TelegramMode; label: string; hint: string }[] = [
  { value: 'subscribers', label: 'Hamma obunachilarga', hint: 'Botga /start bosgan har bir kishi va bot qo‘shilgan guruhlar' },
  { value: 'single', label: 'Bitta chat yoki guruhga', hint: 'Faqat bitta Chat ID (masalan, ish guruhi)' },
]

function ModeSwitch({
  tg,
  value,
  saving,
  onChange,
}: {
  tg: TelegramSettings
  value: TelegramMode
  saving: boolean
  onChange: (m: TelegramMode) => void
}) {
  const fromEnv = tg.modeSource === 'env'
  return (
    <fieldset className="mt-3 border-t border-stone-100 pt-3" disabled={fromEnv || saving}>
      <legend className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-700">
        Arizalar kimga yuboriladi {saving && <Spinner className="size-4" />}
      </legend>
      <div className="grid gap-2">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={cx(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-700',
              value === m.value ? 'border-stone-800 bg-stone-50' : 'border-stone-200 hover:bg-stone-50',
            )}
          >
            <input
              type="radio"
              name="tg-mode"
              value={m.value}
              checked={value === m.value}
              onChange={() => onChange(m.value)}
              className="mt-0.5 accent-stone-900"
            />
            <span>
              <span className="block font-medium text-stone-900">{m.label}</span>
              <span className="block text-xs text-stone-500">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {fromEnv && (
        <p className="mt-1.5 text-xs text-stone-500">
          Rejim serverdagi .env faylida (TELEGRAM_MODE) o‘rnatilgan — bu yerda o‘zgartirib bo‘lmaydi.
        </p>
      )}
    </fieldset>
  )
}

/** Where /start updates go: shown above the subscribers list. */
function UpdatesStatus({ u }: { u: TelegramUpdates }) {
  if (u.state === 'webhook')
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
        Bot hozir {u.webhookHost ?? 'boshqa sayt'} saytiga ulangan, shuning uchun /start bosganlar ro‘yxati bu yerga kelmaydi.
        Ro‘yxatni qo‘lda qo‘shing yoki botni shu serverga ulang (DEPLOY.md)
      </p>
    )
  if (u.state === 'polling' || u.state === 'webhook-self')
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200" role="status">
        Obunachilar avtomatik qo‘shilmoqda
      </p>
    )
  if (u.state === 'error')
    return (
      <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700 ring-1 ring-stone-200" role="status">
        Telegram bilan aloqa yo‘q, qayta urinilmoqda{u.error ? `: ${u.error}` : ''}
      </p>
    )
  return (
    <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 ring-1 ring-stone-200" role="status">
      Bot holati tekshirilmoqda…
    </p>
  )
}

const TYPE_LABEL: Record<TelegramSubscriber['type'], string> = { private: 'shaxsiy', group: 'guruh', supergroup: 'superguruh' }
const OFF_REASON: Record<NonNullable<TelegramSubscriber['disabledBy']>, string> = {
  admin: 'siz o‘chirgansiz',
  user: 'o‘zi bekor qilgan (/stop yoki bloklagan)',
  telegram: 'yetkazib bo‘lmadi (bloklagan yoki chat yo‘q)',
}
const SUB_ID_RE = /^-?\d{3,20}$/

function Subscribers({ tg, onCounts }: { tg: TelegramSettings; onCounts: (active: number, total: number) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [list, setList] = useState<TelegramSubscriber[] | null>(null)
  const [updates, setUpdates] = useState<TelegramUpdates>(tg.updates)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [chatId, setChatId] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const apply = (next: TelegramSubscriber[]) => {
    setList(next)
    onCounts(next.filter((x) => x.active).length, next.length)
  }
  const fetchList = useCallback(
    () =>
      api.telegramSubscribers().then(
        (r) => {
          setList(r.subscribers)
          setUpdates(r.updates)
          setError(null)
          return r.subscribers
        },
        (e) => {
          setError(errText(e))
          return null
        },
      ),
    [],
  )
  useEffect(() => {
    void fetchList()
  }, [fetchList])
  const reload = async () => {
    setLoading(true)
    const next = await fetchList()
    if (next) onCounts(next.filter((x) => x.active).length, next.length)
    setLoading(false)
  }

  const idTrim = chatId.trim()
  const idInvalid = idTrim !== '' && !SUB_ID_RE.test(idTrim)
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!list || !SUB_ID_RE.test(idTrim) || !name.trim()) return
    setAdding(true)
    try {
      const s = await api.addTelegramSubscriber({ chatId: idTrim, name: name.trim() })
      apply([s, ...list])
      setChatId('')
      setName('')
      toast.success('Obunachi qo‘shildi')
    } catch (err) {
      toast.error(err)
    } finally {
      setAdding(false)
    }
  }
  const toggle = async (s: TelegramSubscriber) => {
    if (!list) return
    setBusy(s.chatId)
    try {
      const u = await api.patchTelegramSubscriber(s.chatId, { active: !s.active })
      apply(list.map((x) => (x.chatId === s.chatId ? u : x)))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }
  const remove = async (s: TelegramSubscriber) => {
    if (!list) return
    const ok = await confirm({
      title: 'Obunachini o‘chirish',
      text: `${s.name} ro‘yxatdan o‘chiriladi. U botga qayta /start bossa yana qo‘shiladi — butunlay to‘sish uchun o‘chirish o‘rniga «Faol» tugmasini o‘chiring.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setBusy(s.chatId)
    try {
      await api.deleteTelegramSubscriber(s.chatId)
      apply(list.filter((x) => x.chatId !== s.chatId))
      toast.success('O‘chirildi')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }

  const active = list?.filter((x) => x.active).length ?? tg.subscribers.active
  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionTitle className="mb-0">Telegram obunachilari</SectionTitle>
        <div className="flex items-center gap-1.5">
          {list && (
            <Badge tone={active ? 'green' : 'amber'}>
              {active} faol / {list.length}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => void reload()} loading={loading}>
            Yangilash
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {tg.mode === 'single' && (
          <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 ring-1 ring-stone-200">
            Hozir «Bitta chat» rejimi: arizalar faqat yuqoridagi Chat ID’ga boradi, bu ro‘yxat ishlatilmaydi.
          </p>
        )}
        <UpdatesStatus u={updates} />
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
          Diqqat: botga /start bosgan har qanday odam mijozlar ma'lumotini oladi. Keraksizlarni o'chiring.
        </p>
      </div>

      <form onSubmit={add} className="mt-3 grid gap-2 border-t border-stone-100 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Chat ID" error={idInvalid ? 'Faqat raqam (guruh: -100…)' : null}>
            {(id) => (
              <Input
                id={id}
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="123456789"
                inputMode="numeric"
                aria-invalid={idInvalid || undefined}
                className="font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Ism">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan, Aziz (sotuv)" maxLength={100} />}
          </Field>
        </div>
        <Button type="submit" disabled={!SUB_ID_RE.test(idTrim) || !name.trim() || !list} loading={adding}>
          <Icon name="plus" /> Qo‘lda qo‘shish
        </Button>
        <p className="text-xs text-stone-500">
          Chat ID’ni bilish: odam Telegram’da @userinfobot ga yozadi. U botga oldin /start bosgan bo‘lishi shart, aks holda bot
          unga yoza olmaydi.
        </p>
      </form>

      <div className="mt-3 border-t border-stone-100 pt-3">
        {error && <ErrorBox text={error} onRetry={() => void reload()} />}
        {!error && !list && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-stone-500">
            <Spinner className="size-4" /> Yuklanmoqda…
          </div>
        )}
        {list && list.length === 0 && <p className="py-3 text-center text-sm text-stone-500">Hali obunachi yo‘q.</p>}
        {list && list.length > 0 && (
          <ul className="divide-y divide-stone-100" aria-label="Obunachilar">
            {list.map((s) => (
              <li key={s.chatId} className={cx('flex items-center gap-2 py-2.5', !s.active && 'opacity-70')}>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium text-stone-900">
                    {s.name}
                    {s.username && <span className="font-normal text-stone-500"> @{s.username}</span>}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    <span className="font-mono">{s.chatId}</span> · {TYPE_LABEL[s.type]} ·{' '}
                    {s.source === 'manual' ? 'qo‘lda' : s.type === 'private' ? '/start' : 'bot qo‘shilgan'} · {fmtDate(s.addedAt)}
                  </p>
                  {!s.active && s.disabledBy && <p className="text-xs text-amber-800">O‘chiq: {OFF_REASON[s.disabledBy]}</p>}
                </div>
                <Switch
                  checked={s.active}
                  disabled={busy === s.chatId}
                  label={`${s.name}: ${s.active ? 'faol' : 'faol emas'}`}
                  onChange={() => void toggle(s)}
                />
                <IconButton label={`${s.name} — o‘chirish`} disabled={busy === s.chatId} onClick={() => void remove(s)}>
                  <Icon name="trash" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? 'Faol — arizalar boradi' : 'Faol emas — arizalar bormaydi'}
      disabled={disabled}
      onClick={onChange}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700',
        checked ? 'bg-emerald-600' : 'bg-stone-300',
      )}
    >
      <span className={cx('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
    </button>
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
