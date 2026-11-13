import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type ChatSession, type ChatSummary } from '../api'
import { cx, errText, fmtDateTime, fmtRelative, siteUrl } from '../lib'
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, PageLoader, focusRing } from '../ui'

/** A path inside this site (`/products/x`) — never `//host` or a URL. */
const SITE_PATH = /^\/(?!\/)[\w/-]{0,200}$/

export default function Chats() {
  const [list, setList] = useState<ChatSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyLeads, setOnlyLeads] = useState(false)
  const [busy, setBusy] = useState(false)

  const fetchList = useCallback(
    () =>
      api
        .chats()
        .then(
          (l) => {
            setList([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
            setError(null)
          },
          (e) => setError(errText(e)),
        )
        .finally(() => setBusy(false)),
    [],
  )
  useEffect(() => {
    void fetchList()
  }, [fetchList])
  const load = () => {
    setBusy(true)
    void fetchList()
  }

  if (error && !list) return <ErrorBox text={error} onRetry={load} />
  if (!list) return <PageLoader />
  const shown = onlyLeads ? list.filter((c) => c.leadId) : list

  return (
    <>
      <PageHeader
        title="AI suhbatlar"
        sub={`${list.length} ta suhbat · ${list.filter((c) => c.leadId).length} tasida ariza qoldirilgan`}
        actions={
          <Button onClick={load} loading={busy}>
            Yangilash
          </Button>
        }
      />
      <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" className="size-4 accent-stone-900" checked={onlyLeads} onChange={(e) => setOnlyLeads(e.target.checked)} />
        Faqat ariza qoldirilganlar
      </label>
      {shown.length === 0 ? (
        <Empty>Suhbatlar yo‘q</Empty>
      ) : (
        <Card className="divide-y divide-stone-100">
          {shown.map((c) => (
            <Link
              key={c.id}
              to={`/admin/chats/${encodeURIComponent(c.id)}`}
              className={cx('flex flex-col gap-1.5 px-4 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4', focusRing)}
            >
              <span className="flex shrink-0 items-center gap-2 text-sm text-stone-500 sm:w-44">
                <time dateTime={c.updatedAt} title={fmtDateTime(c.updatedAt)}>
                  {fmtRelative(c.updatedAt)}
                </time>
                <Badge tone="blue">{c.lang.toUpperCase()}</Badge>
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-800">{c.preview || <i className="text-stone-400">bo‘sh</i>}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-stone-500 tabular-nums">{c.count} xabar</span>
                {c.leadId && <Badge tone="amber">Ariza</Badge>}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </>
  )
}

export function ChatDetail() {
  const { id = '' } = useParams()
  const [chat, setChat] = useState<ChatSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    api.chat(id).then(
      (c) => alive && (setChat(c), setError(null)),
      (e) => alive && setError(errText(e)),
    )
    return () => {
      alive = false
    }
  }, [id, attempt])
  const load = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }

  const back = (
    <Link to="/admin/chats" className={cx('mb-3 inline-block text-sm text-stone-600 hover:text-stone-900', focusRing)}>
      ← AI suhbatlar
    </Link>
  )
  if (error)
    return (
      <>
        {back}
        <ErrorBox text={error} onRetry={load} />
      </>
    )
  if (!chat) return <PageLoader />

  return (
    <>
      {back}
      <PageHeader
        title="Suhbat"
        sub={
          <>
            Boshlangan: {fmtDateTime(chat.createdAt)} · {chat.messages.length} xabar · til: {chat.lang.toUpperCase()}
            {chat.page && (
              <>
                {' · sahifa: '}
                {/* same-origin link only for a plain site path; anything else is shown as text */}
                {SITE_PATH.test(chat.page) ? (
                  <a href={siteUrl(chat.page.slice(1))} target="_blank" rel="noreferrer" className="underline">
                    {chat.page}
                  </a>
                ) : (
                  <span className="break-all">{chat.page}</span>
                )}
              </>
            )}
          </>
        }
        actions={
          chat.leadId && (
            <Link
              to={`/admin/leads?id=${encodeURIComponent(chat.leadId)}`}
              className={cx('inline-flex h-10 items-center rounded-lg bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700', focusRing)}
            >
              Ariza qoldirilgan → Arizani ochish
            </Link>
          )
        }
      />
      <Card className="p-3 md:p-6">
        {chat.messages.length === 0 ? (
          <p className="py-8 text-center text-stone-500">Xabarlar yo‘q</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {chat.messages.map((m, i) => {
              const user = m.role === 'user'
              return (
                <li key={i} className={cx('flex flex-col', user ? 'items-end' : 'items-start')}>
                  <span className="mb-1 px-1 text-xs text-stone-400">
                    {user ? 'Mijoz' : 'AI yordamchi'} · {fmtDateTime(m.at)}
                  </span>
                  <div
                    lang={chat.lang}
                    className={cx(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap md:max-w-[70%]',
                      user ? 'rounded-br-md bg-stone-900 text-white' : 'rounded-bl-md bg-stone-100 text-stone-900',
                    )}
                  >
                    {m.content}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    </>
  )
}
