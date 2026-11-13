import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Lead } from '../api'
import { cx, errText, fmtRelative, useAdmin } from '../lib'
import { Card, Empty, ErrorBox, PageHeader, SectionTitle, Spinner, focusRing } from '../ui'
import { LeadStatusBadge, SourceBadge } from './Leads'

export default function Dashboard() {
  const { stats, reloadStats } = useAdmin()
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    reloadStats()
    api.leads().then(
      (l) => setLeads(l.slice(0, 5)),
      (e) => setError(errText(e)),
    )
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])

  const tiles = [
    { label: 'Yangi arizalar', value: stats?.leadsNew, to: '/admin/leads', accent: true },
    { label: 'Jami arizalar', value: stats?.leadsTotal, to: '/admin/leads' },
    { label: 'Bugungi AI suhbatlar', value: stats?.chatsToday, to: '/admin/chats' },
    { label: 'Mahsulotlar', value: stats?.products, to: '/admin/products' },
    { label: 'Sertifikatlar', value: stats?.documents, to: '/admin/documents' },
  ]

  return (
    <>
      <PageHeader title="Bosh sahifa" sub="Saytdagi so‘nggi holat" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t, i) => (
          <Link
            key={t.label}
            to={t.to}
            className={cx(
              'rounded-xl border p-4 transition-colors md:p-5',
              t.accent && (t.value ?? 0) > 0
                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                : 'border-stone-200 bg-white hover:bg-stone-50',
              i === 0 && 'col-span-2 md:col-span-1',
              focusRing,
            )}
          >
            <p className="text-sm text-stone-600">{t.label}</p>
            <p className="mt-2 font-display text-4xl leading-none text-stone-900 tabular-nums">
              {t.value ?? <Spinner className="size-5 text-stone-400" />}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <SectionTitle>So‘nggi arizalar</SectionTitle>
        <Link to="/admin/leads" className="text-sm text-stone-600 underline-offset-4 hover:underline">
          Barchasi →
        </Link>
      </div>
      {error ? (
        <ErrorBox text={error} onRetry={load} />
      ) : !leads ? (
        <Card className="flex items-center justify-center gap-3 p-8 text-stone-500">
          <Spinner /> Yuklanmoqda…
        </Card>
      ) : leads.length === 0 ? (
        <Empty>Hozircha arizalar yo‘q</Empty>
      ) : (
        <Card className="divide-y divide-stone-100">
          {leads.map((l) => (
            <Link
              key={l.id}
              to="/admin/leads"
              className={cx('flex items-center gap-3 px-4 py-3 hover:bg-stone-50 sm:gap-4', focusRing)}
            >
              <span className="hidden w-32 shrink-0 text-sm text-stone-500 sm:block">{fmtRelative(l.createdAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {l.name || 'Ismsiz'} <span className="font-normal text-stone-600">· {l.phone}</span>
                </span>
                <span className="block text-xs text-stone-500 sm:hidden">{fmtRelative(l.createdAt)}</span>
              </span>
              {l.product && <span className="hidden text-sm text-stone-600 sm:inline">{l.product}</span>}
              <span className="flex gap-1.5">
                <SourceBadge source={l.source} />
                <LeadStatusBadge status={l.status} />
              </span>
            </Link>
          ))}
        </Card>
      )}

      <SectionTitle className="mt-8">Tezkor amallar</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {[
          ['/admin/products/new', '+ Yangi mahsulot'],
          ['/admin/documents', '+ Sertifikat yuklash'],
          ['/admin/news', '+ Yangilik'],
          ['/admin/settings', 'Aloqa ma’lumotlari'],
        ].map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className={cx('rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50', focusRing)}
          >
            {label}
          </Link>
        ))}
      </div>
    </>
  )
}
