import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, type Lead, type LeadStatus } from '../api'
import { STATUS_LABEL, cx, errText, fmtDateTime, fmtRelative, useAdmin, useConfirm, useToast } from '../lib'
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  IconButton,
  PageLoader,
  PageHeader,
  Select,
  Textarea,
  focusRing,
  Icon,
} from '../ui'

const STATUS_TONE = { new: 'amber', in_progress: 'blue', done: 'green' } as const
export const LeadStatusBadge = ({ status }: { status: LeadStatus }) => (
  <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
)
export const SourceBadge = ({ source }: { source: Lead['source'] }) =>
  source === 'ai' ? <Badge tone="violet">AI</Badge> : <Badge>Forma</Badge>

const TG = {
  sent: { tone: 'green', text: 'Telegram: yuborildi' },
  failed: { tone: 'red', text: 'Telegram: xato' },
  skipped: { tone: 'stone', text: 'Telegram: yuborilmadi' },
} as const

type StatusFilter = 'all' | LeadStatus
type SourceFilter = 'all' | Lead['source']

export default function Leads() {
  const { reloadStats } = useAdmin()
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  // /admin/leads?id=… (from a chat or the Telegram message): scroll to that lead and highlight it
  const [params] = useSearchParams()
  const focusId = params.get('id')
  const scrolledTo = useRef<string | null>(null)

  const fetchLeads = useCallback(
    (manual: boolean) =>
      api
        .leads()
        .then(
          (l) => {
            setLeads(l)
            setError(null)
            setUpdatedAt(new Date())
            reloadStats()
          },
          (e) => {
            if (manual) toast.error(e)
            setError(errText(e))
          },
        )
        .finally(() => setRefreshing(false)),
    [reloadStats, toast],
  )

  useEffect(() => {
    void fetchLeads(false)
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchLeads(false)
    }, 30_000)
    return () => clearInterval(t)
  }, [fetchLeads])
  const load = (manual: boolean) => {
    setRefreshing(true)
    void fetchLeads(manual)
  }

  useEffect(() => {
    if (!focusId || !leads || scrolledTo.current === focusId) return
    const el = document.getElementById(`lead-${focusId}`)
    if (!el) return
    scrolledTo.current = focusId
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  }, [focusId, leads, status, source])

  const update = (l: Lead) => setLeads((list) => list?.map((x) => (x.id === l.id ? l : x)) ?? null)
  const remove = (id: string) => setLeads((list) => list?.filter((x) => x.id !== id) ?? null)

  if (error && !leads) return <ErrorBox text={error} onRetry={() => load(true)} />
  if (!leads) return <PageLoader />

  const count = (s: StatusFilter) =>
    leads.filter((l) => (s === 'all' || l.status === s) && (source === 'all' || l.source === source)).length
  const shown = leads.filter((l) => (status === 'all' || l.status === status) && (source === 'all' || l.source === source))

  return (
    <>
      <PageHeader
        title="Arizalar"
        sub={
          <>
            Sayt formasi va AI yordamchidan kelgan arizalar · har 30 soniyada yangilanadi
            {updatedAt && ` · ${updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
          </>
        }
        actions={
          <Button onClick={() => load(true)} loading={refreshing}>
            Yangilash
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* the pill itself scrolls (very narrow phones), so its rounded edges are never cut by the screen */}
        <div
          className="w-full overflow-x-auto rounded-lg bg-stone-200/70 [scrollbar-width:none] sm:w-auto"
          role="group"
          aria-label="Holat bo‘yicha"
        >
          <div className="flex w-max min-w-full gap-1 p-1">
          {(['all', 'new', 'in_progress', 'done'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cx(
                'flex-1 rounded-md px-2 py-1.5 text-sm whitespace-nowrap sm:px-3',
                status === s ? 'bg-white font-medium text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
                focusRing,
              )}
            >
              {s === 'all' ? 'Hammasi' : STATUS_LABEL[s]}{' '}
              <span className="text-stone-400 tabular-nums">{count(s)}</span>
            </button>
          ))}
          </div>
        </div>
        <label className="sr-only" htmlFor="lead-source">
          Manba
        </label>
        <Select
          id="lead-source"
          value={source}
          onChange={(e) => setSource(e.target.value as SourceFilter)}
          className="w-auto"
        >
          <option value="all">Barcha manbalar</option>
          <option value="contact">Forma</option>
          <option value="ai">AI yordamchi</option>
        </Select>
      </div>

      {focusId && !leads.some((l) => l.id === focusId) && (
        <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600" role="status">
          Bu ariza topilmadi — o‘chirilgan bo‘lishi mumkin.
        </p>
      )}
      {shown.length === 0 ? (
        <Empty>{leads.length ? 'Bu filtr bo‘yicha arizalar yo‘q' : 'Hozircha arizalar yo‘q'}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((l) => (
            <LeadRow key={l.id} lead={l} highlight={l.id === focusId} onChange={update} onRemove={remove} />
          ))}
        </ul>
      )}
    </>
  )
}

function LeadRow({
  lead,
  highlight,
  onChange,
  onRemove,
}: {
  lead: Lead
  highlight?: boolean
  onChange: (l: Lead) => void
  onRemove: (id: string) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { reloadStats } = useAdmin()
  const [note, setNote] = useState(lead.note ?? '')
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const editing = useRef(false)
  const noteId = useId()
  const statusId = useId()

  // keep the note in sync with auto-refresh, unless the admin is typing in it
  useEffect(() => {
    if (!editing.current) setNote(lead.note ?? '')
  }, [lead.note])

  const setStatus = async (status: LeadStatus) => {
    setSavingStatus(true)
    try {
      const l = await api.patchLead(lead.id, { status })
      onChange({ ...lead, ...l, status })
      reloadStats()
      toast.success()
    } catch (e) {
      toast.error(e)
    } finally {
      setSavingStatus(false)
    }
  }
  const saveNote = async () => {
    editing.current = false
    if (note === (lead.note ?? '')) return
    setSavingNote(true)
    try {
      const l = await api.patchLead(lead.id, { note })
      onChange({ ...lead, ...l, note })
      toast.success('Izoh saqlandi')
    } catch (e) {
      toast.error(e)
    } finally {
      setSavingNote(false)
    }
  }
  const del = async () => {
    const ok = await confirm({
      title: 'Arizani o‘chirish',
      text: `${lead.name || lead.phone} arizasi butunlay o‘chiriladi.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteLead(lead.id)
      onRemove(lead.id)
      reloadStats()
      toast.success('O‘chirildi')
    } catch (e) {
      toast.error(e)
    }
  }

  const tg = TG[lead.telegram] ?? TG.skipped
  return (
    <li
      id={`lead-${lead.id}`}
      tabIndex={-1}
      aria-current={highlight || undefined}
      className={cx(
        'scroll-mt-24 rounded-xl border bg-white p-4 outline-none md:p-5',
        lead.status === 'new' ? 'border-amber-300 shadow-[inset_3px_0_0_#f59e0b]' : 'border-stone-200',
        highlight && 'ring-2 ring-amber-500 ring-offset-2',
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <time dateTime={lead.createdAt} title={fmtDateTime(lead.createdAt)}>
              {fmtRelative(lead.createdAt)}
            </time>
            <SourceBadge source={lead.source} />
            <Badge tone={tg.tone}>{tg.text}</Badge>
          </div>
          <p className="mt-2 text-lg font-semibold text-stone-900">{lead.name || <span className="text-stone-400">Ism ko‘rsatilmagan</span>}</p>
          <a
            href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
            className={cx('mt-0.5 inline-block text-base font-medium text-amber-800 underline-offset-4 hover:underline', focusRing)}
          >
            {lead.phone}
          </a>
          {lead.product && (
            <p className="mt-2 text-sm">
              <span className="text-stone-500">Mahsulot: </span>
              {lead.product}
            </p>
          )}
          {lead.message && (
            <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm whitespace-pre-line text-stone-700">{lead.message}</p>
          )}
          {lead.chatId && (
            <Link
              to={`/admin/chats/${encodeURIComponent(lead.chatId)}`}
              className={cx('mt-2 inline-block text-sm text-violet-700 underline-offset-4 hover:underline', focusRing)}
            >
              AI suhbatni ochish →
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:w-72">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor={statusId} className="mb-1 block text-xs font-medium text-stone-500">
                Holat
              </label>
              <Select
                id={statusId}
                value={lead.status}
                disabled={savingStatus}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
              >
                {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
            <IconButton label="Arizani o‘chirish" onClick={del} className="mb-1 hover:text-red-700">
              <Icon name="trash" />
            </IconButton>
          </div>
          <div>
            <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-stone-500">
              Izoh {savingNote && <span className="text-stone-400">· saqlanmoqda…</span>}
            </label>
            <Textarea
              id={noteId}
              rows={2}
              value={note}
              placeholder="Masalan: qo‘ng‘iroq qilindi, ertaga uchrashuv"
              onFocus={() => (editing.current = true)}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              className="text-sm"
            />
          </div>
        </div>
      </div>
    </li>
  )
}
