import { Component, StrictMode, Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/manrope'
import '@fontsource/cormorant-garamond/300.css'
import '@fontsource/cormorant-garamond/300-italic.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import './index.css'
import { LangProvider } from './i18n'
import { loadRuntimeContent } from './data'

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

const BASE = import.meta.env.BASE_URL

/*
 * Admin panel (/admin*): rendered *instead of* the site. App.tsx is only ever
 * imported dynamically below, so on admin pages its module (WebGL canvas,
 * Lenis, preloader, cursor) is never evaluated.
 * The glob keeps the build working whether or not src/admin/AdminApp.tsx exists yet.
 * The static GitHub Pages build has no server, so there /admin is just a 404 page
 * (the admin is still reachable in `npm run dev` without VITE_API).
 */
// (the env checks are spelled out inline so the Pages build drops the admin chunk entirely)
const adminModule =
  import.meta.env.VITE_API || import.meta.env.DEV
    ? (import.meta.glob<{ default: ComponentType }>('./admin/AdminApp.tsx')['./admin/AdminApp.tsx'] as (() => Promise<{ default: ComponentType }>) | undefined)
    : undefined
const isAdminPath = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}admin(/|$)`).test(location.pathname)
const ADMIN = adminModule && isAdminPath ? lazy(adminModule) : null

/** A failed admin chunk (e.g. after a redeploy) shows a reload hint instead of a blank page. */
class AdminBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center bg-ink p-6 text-center text-bone">
        <div>
          <p className="mb-4">Admin panelni yuklab bo‘lmadi.</p>
          <button type="button" onClick={() => location.reload()} className="rounded-full border border-line px-5 py-2 text-sm">
            Qayta yuklash
          </button>
        </div>
      </div>
    )
  }
}

const root = createRoot(document.getElementById('root')!)
const render = (node: ReactNode) =>
  root.render(
    <StrictMode>
      <BrowserRouter basename={BASE.replace(/\/$/, '')}>
        <LangProvider>{node}</LangProvider>
      </BrowserRouter>
    </StrictMode>,
  )

if (ADMIN) {
  render(
    <AdminBoundary>
      <Suspense fallback={<div className="grid min-h-dvh place-items-center bg-ink text-sm text-ash">…</div>}>
        <ADMIN />
      </Suspense>
    </AdminBoundary>,
  )
} else {
  // fetch the site code and the server content in parallel; content failures fall back to the bundled JSON
  void Promise.all([import('./App.tsx'), loadRuntimeContent()]).then(([{ default: App }]) => render(<App />))
}
