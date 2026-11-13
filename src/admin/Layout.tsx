import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { api, usingMock } from './api'
import { confirmLeave, cx, siteUrl, useAdmin, useToast } from './lib'
import {
  focusRing,
  Icon,
} from './ui'

const NAV = [
  { to: '/admin/dashboard', label: 'Bosh sahifa', icon: 'home' },
  { to: '/admin/products', label: 'Mahsulotlar', icon: 'products' },
  { to: '/admin/categories', label: 'Kategoriyalar', icon: 'categories' },
  { to: '/admin/documents', label: 'Sertifikatlar', icon: 'docs' },
  { to: '/admin/news', label: 'Yangiliklar', icon: 'news' },
  { to: '/admin/leads', label: 'Arizalar', icon: 'leads', badge: true },
  { to: '/admin/chats', label: 'AI suhbatlar', icon: 'chats' },
  { to: '/admin/settings', label: 'Sozlamalar', icon: 'settings' },
] as const

export default function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { stats } = useAdmin()
  const newLeads = stats?.leadsNew ?? 0

  // scroll to top on page change
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <div className="md:flex">
      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-white/95 px-3 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cx('relative inline-flex size-10 items-center justify-center rounded-lg hover:bg-stone-100', focusRing)}
          aria-label="Menyuni ochish"
          aria-expanded={open}
          aria-controls="admin-nav"
        >
          <Icon name="menu" className="size-6" />
          {newLeads > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-amber-600 ring-2 ring-white" />
          )}
        </button>
        <Brand />
        <NavLink
          to="/admin/leads"
          onClick={(e) => !confirmLeave() && e.preventDefault()}
          className={cx('relative inline-flex size-10 items-center justify-center rounded-lg hover:bg-stone-100', focusRing)}
          aria-label={`Arizalar${newLeads ? `, ${newLeads} ta yangi` : ''}`}
        >
          <Icon name="leads" className="size-6" />
          {newLeads > 0 && <CountBadge n={newLeads} className="absolute -top-0.5 -right-0.5" />}
        </NavLink>
      </header>

      {/* overlay for the mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 bg-stone-950/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        id="admin-nav"
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-stone-200 bg-white transition-[translate,visibility] duration-200 md:sticky md:top-0 md:z-auto md:h-dvh md:w-60 md:translate-x-0 md:transition-none',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full max-md:invisible',
        )}
        aria-label="Admin menyusi"
      >
        <div className="flex h-14 items-center justify-between px-5 md:h-20">
          <Brand />
          <button
            type="button"
            className={cx('inline-flex size-9 items-center justify-center rounded-lg hover:bg-stone-100 md:hidden', focusRing)}
            onClick={() => setOpen(false)}
            aria-label="Menyuni yopish"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  onClick={(e) => (confirmLeave() ? setOpen(false) : e.preventDefault())}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors md:py-2 md:text-sm',
                      isActive ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100',
                      focusRing,
                    )
                  }
                >
                  <Icon name={n.icon} className="size-[18px] shrink-0" />
                  <span className="flex-1">{n.label}</span>
                  {'badge' in n && newLeads > 0 && <CountBadge n={newLeads} />}
                </NavLink>
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-col gap-0.5 border-t border-stone-200 pt-4">
            <li>
              <a
                href={siteUrl('')}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className={cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-stone-700 hover:bg-stone-100 md:py-2 md:text-sm', focusRing)}
              >
                <Icon name="site" className="size-[18px]" />
                Saytni ko‘rish
              </a>
            </li>
            <li>
              <LogoutButton onLogout={onLogout} />
            </li>
          </ul>
        </nav>
        {usingMock() && (
          <p className="m-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Sinov rejimi (mock API) — ma'lumotlar saqlanmaydi
          </p>
        )}
      </aside>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-8 md:pt-8 lg:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}

function Brand() {
  return (
    <span className="flex items-baseline gap-2 select-none">
      <span className="font-display text-2xl leading-none text-stone-900">NovaColor</span>
      <span className="text-[10px] font-semibold tracking-[0.2em] text-stone-500 uppercase">Admin</span>
    </span>
  )
}

function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 text-[11px] font-semibold text-white',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirmLeave()) return
        setBusy(true)
        try {
          await api.logout()
        } catch (e) {
          toast.error(e)
        }
        onLogout()
        navigate('/admin', { replace: true })
      }}
      className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] text-stone-700 hover:bg-red-50 hover:text-red-700 md:py-2 md:text-sm', focusRing)}
    >
      <Icon name="logout" className="size-[18px]" />
      <span>
        Chiqish
        <span className="block text-xs text-stone-500">barcha qurilmalarda</span>
      </span>
    </button>
  )
}
