import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// GitHub Pages: sayt https://jahonsher.github.io/novacolor/ manzilida ochiladi.
// Server bilan: VITE_BASE=/ VITE_API=1 vite build (docs/backend-spec.md)
const base = process.env.VITE_BASE ?? '/novacolor/'

// `npm run dev` → API va yuklangan fayllar lokal serverga (server/, :8080) uzatiladi.
// So'rov base bilan ham (/novacolor/api/...), base'siz ham (/api/...) kelishi mumkin — prefiks olib tashlanadi.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8080'
const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The server rejects admin mutations whose Origin is not its own host (CSRF), so the dev proxy presents
// requests as coming from the target's origin (changeOrigin only rewrites Host).
const targetOrigin = new URL(API_TARGET).origin
const configure: ProxyOptions['configure'] = (p) =>
  p.on('proxyReq', (req) => {
    if (req.getHeader('origin')) req.setHeader('origin', targetOrigin)
  })
const proxy: Record<string, ProxyOptions> = {
  [`^${escaped}(api|uploads)/`]: {
    target: API_TARGET,
    changeOrigin: true,
    configure,
    rewrite: (p) => p.replace(new RegExp(`^${escaped}`), '/'),
  },
}
if (base !== '/') proxy['^/(api|uploads)/'] = { target: API_TARGET, changeOrigin: true, configure }

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { proxy },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'motion', test: /node_modules[\\/](gsap|@gsap|lenis)/ },
            // higher priority: otherwise React is captured into `motion` (via @gsap/react), and the
            // admin panel — which needs React but not gsap/lenis — would have to download it
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
