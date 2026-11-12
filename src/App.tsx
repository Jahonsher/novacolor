import { useEffect, useRef } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { mediaGL } from './gl/media'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { Preloader } from './components/Preloader'
import { Cursor } from './components/Cursor'
import { TransitionProvider } from './components/Transition'
import { useLang } from './i18n'
import { initSmoothScroll, destroySmoothScroll, reducedMotion } from './lib/motion'
import Home from './pages/Home'
import Products from './pages/Products'
import Product from './pages/Product'
import About from './pages/About'
import News from './pages/News'
import Contact from './pages/Contact'
import NotFound from './pages/NotFound'

// initialise the shared WebGL layer before any page mounts its images
const glCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
if (glCanvas && !reducedMotion) {
  // above the page content (z-1) so images also show on solid light sections,
  // below the header, menu, lightbox and transition layers
  glCanvas.className = 'pointer-events-none fixed inset-0 z-[2] h-full w-full'
  glCanvas.setAttribute('aria-hidden', 'true')
  mediaGL.init(glCanvas)
}

function GLLayer() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (glCanvas && host.current) host.current.appendChild(glCanvas)
  }, [])
  return <div ref={host} />
}

const titles: Record<string, { uz: string; ru: string }> = {
  '/products': { uz: 'Mahsulotlar', ru: 'Продукты' },
  '/about': { uz: 'Biz haqimizda', ru: 'О нас' },
  '/news': { uz: 'Yangiliklar', ru: 'Новости' },
  '/contact': { uz: 'Aloqa', ru: 'Контакты' },
}

export default function App() {
  const { lang } = useLang()
  const { pathname } = useLocation()

  useEffect(() => {
    initSmoothScroll()
    return () => destroySmoothScroll()
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    const key = Object.keys(titles).find((k) => pathname.startsWith(k))
    document.title = key ? `${titles[key][lang]} — Novacolor` : 'Novacolor — I colori dell’Architettura'
  }, [pathname, lang])

  return (
    <TransitionProvider>
      <GLLayer />
      <Header />
      <main key={lang} className="relative z-[1]">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:slug" element={<Product />} />
          <Route path="/about" element={<About />} />
          <Route path="/news" element={<News />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </main>
      <Cursor />
      <Preloader />
    </TransitionProvider>
  )
}
