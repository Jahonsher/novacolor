/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** set (e.g. `1`) in the server build — enables /api calls, runtime content, AI chat, admin */
  readonly VITE_API?: string
  /** deploy base, read by vite.config.ts (`/` on the server, default `/novacolor/` for GitHub Pages) */
  readonly VITE_BASE?: string
  /** optional override: the contact form posts here instead of /api/leads */
  readonly VITE_CONTACT_ENDPOINT?: string
}
