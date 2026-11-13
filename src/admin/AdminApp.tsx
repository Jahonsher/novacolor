/**
 * Admin panel entry. Rendered by main.tsx (lazy) inside the site's <BrowserRouter basename=...>
 * for every path under /admin — so this file only declares <Routes>, never a Router.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import { api, setUnauthorizedHandler, type Content, type Stats } from './api'
import { AdminCtx, type AdminData } from './lib'
import { ConfirmProvider, PageLoader, ToastProvider } from './ui'
import Layout from './Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import ProductForm from './pages/ProductForm'
import Categories from './pages/Categories'
import Documents from './pages/Documents'
import News from './pages/News'
import Leads from './pages/Leads'
import Chats, { ChatDetail } from './pages/Chats'
import Settings from './pages/Settings'

type Auth = 'checking' | 'in' | 'out'

export default function AdminApp() {
  const [auth, setAuth] = useState<Auth>('checking')
  const navigate = useNavigate()
  const location = useLocation()

  // The public site hides the native cursor and paints <html> dark; undo that while the admin is mounted.
  useEffect(() => {
    const html = document.documentElement
    const prev = { bg: html.style.background, title: document.title }
    html.classList.remove('has-cursor', 'lenis', 'lenis-smooth')
    html.style.background = '#f5f5f4'
    document.title = 'NovaColor — Admin'
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const created = !robots
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.appendChild(robots)
    }
    const prevRobots = robots.content
    robots.content = 'noindex, nofollow'
    return () => {
      html.style.background = prev.bg
      document.title = prev.title
      if (created) robots.remove()
      else robots.content = prevRobots
    }
  }, [])

  useEffect(() => {
    let alive = true
    api
      .me()
      .then(() => alive && setAuth('in'))
      .catch(() => alive && setAuth('out'))
    return () => {
      alive = false
    }
  }, [])

  // any 401 from the API → back to the login page, remembering where we were
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuth('out')
      const here = window.location.pathname
      navigate('/admin', { replace: true, state: { from: here } })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  return (
    <div className="min-h-dvh bg-stone-100 font-sans text-stone-900 antialiased" style={{ cursor: 'auto' }}>
      <ToastProvider>
        <ConfirmProvider>
          {auth === 'checking' ? (
            <PageLoader />
          ) : (
            <Routes>
              <Route path="/admin">
                <Route
                  index
                  element={
                    auth === 'in' ? (
                      <Navigate to={nextPath(location.state, location.search)} replace />
                    ) : (
                      <Login onLogin={() => setAuth('in')} />
                    )
                  }
                />
                <Route element={<RequireAuth auth={auth} onLogout={() => setAuth('out')} />}>
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="products" element={<Products />} />
                  <Route path="products/new" element={<ProductForm />} />
                  <Route path="products/:slug" element={<ProductForm />} />
                  <Route path="categories" element={<Categories />} />
                  <Route path="documents" element={<Documents />} />
                  <Route path="news" element={<News />} />
                  <Route path="leads" element={<Leads />} />
                  <Route path="chats" element={<Chats />} />
                  <Route path="chats/:id" element={<ChatDetail />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          )}
        </ConfirmProvider>
      </ToastProvider>
    </div>
  )
}

/** Where to go after login: `state.from` (set by a 401 / guard) or `?next=`, limited to /admin paths. */
function nextPath(state: unknown, search: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const fromState =
    state && typeof state === 'object' && 'from' in state && typeof state.from === 'string' ? state.from : ''
  let from: string = fromState || new URLSearchParams(search).get('next') || ''
  if (base && from.startsWith(base + '/')) from = from.slice(base.length)
  return /^\/admin\/[a-z]/.test(from) ? from : '/admin/dashboard'
}

function RequireAuth({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const location = useLocation()
  if (auth !== 'in') return <Navigate to="/admin" replace state={{ from: location.pathname + location.search }} />
  return (
    <DataProvider>
      <Layout onLogout={onLogout}>
        <Outlet />
      </Layout>
    </DataProvider>
  )
}

/** Loads the site content once and the stats (new-leads badge) every 30 s. */
function DataProvider({ children }: { children: ReactNode }) {
  const [content, setContentState] = useState<Content | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  const reloadContent = useCallback(
    () =>
      api.content().then(
        (c) => {
          setContentState(c)
          setContentError(null)
          return c
        },
        (e: unknown) => {
          setContentError(e instanceof Error ? e.message : 'Xatolik')
          return null
        },
      ),
    [],
  )
  const reloadStats = useCallback(() => {
    api.stats().then(setStats, () => {})
  }, [])
  const setContent = useCallback((fn: (c: Content) => Content) => {
    setContentState((c) => (c ? fn(c) : c))
  }, [])

  useEffect(() => {
    void reloadContent()
    reloadStats()
    const t = setInterval(reloadStats, 30_000)
    return () => clearInterval(t)
  }, [reloadContent, reloadStats])

  const value = useMemo<AdminData>(
    () => ({ content, contentError, reloadContent, setContent, stats, reloadStats }),
    [content, contentError, reloadContent, setContent, stats, reloadStats],
  )
  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>
}
