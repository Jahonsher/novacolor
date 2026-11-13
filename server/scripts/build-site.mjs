// Cross-platform equivalent of: VITE_BASE=/ VITE_API=1 vite build
// Builds the site for the Node server (served at the root path, API enabled).
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.VITE_BASE ??= '/'
process.env.VITE_API ??= '1'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { build } = await import('vite')
await build({ root, mode: 'production' })
