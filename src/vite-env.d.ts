/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** set (e.g. `1`) in the server build — enables /api calls, runtime content, AI chat, admin */
  readonly VITE_API?: string
  /** deploy base, read by vite.config.ts (`/` on the server, default `/novacolor/` for GitHub Pages) */
  readonly VITE_BASE?: string
  /** "1": admin panel on the in-browser mock API (demo deploy without a server) */
  readonly VITE_ADMIN_DEMO?: string
  /** optional override: the contact form posts here instead of /api/leads */
  readonly VITE_CONTACT_ENDPOINT?: string
}
