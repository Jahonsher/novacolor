import { createContext, useContext, useEffect } from 'react'
import { asset } from '../data'
import type { Content, LeadStatus, Stats } from './api'

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

/** Public URL for a stored path (static `img/...`, uploaded `uploads/...`, or an absolute/blob URL). */
export const img = (path: string | null | undefined) => {
  if (!path) return ''
  return /^(blob:|data:|https?:)/.test(path) ? path : asset(path)
}

/** PDF link for a document. */
export const pdfUrl = (d: { file: string; path?: string }) => img(d.path ?? `pdf/${d.file}`)

/** Site page URL (opens the public site). */
export const siteUrl = (path = '') => asset(path)

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

/** "Mi-Ku Therm" → "mi-ku-therm"; Cyrillic is transliterated, everything else becomes `-`. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[а-яёўқғҳ]/g, (ch) => CYR[ch] ?? '')
    .replace(/['’`ʻʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const pad = (n: number) => String(n).padStart(2, '0')
/** 14.11.2026 */
export const fmtDate = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}
/** 14.11.2026 09:05 */
export const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** "bugun 09:05" / "kecha 18:20" / "12.11.2026 10:00" */
export const fmtRelative = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff === 0) return `bugun ${t}`
  if (diff === 1) return `kecha ${t}`
  return fmtDateTime(iso)
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Yangi',
  in_progress: 'Jarayonda',
  done: 'Bajarildi',
}
export const GROUP_LABEL = {
  company: 'Kompaniya sertifikatlari',
  product: 'Mahsulot sertifikatlari',
  epd: 'Ekologik deklaratsiyalar (EPD)',
} as const

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Xatolik yuz berdi')

/* ---------------- toasts ---------------- */
export type ToastKind = 'success' | 'error' | 'info'
export type ToastApi = {
  show: (kind: ToastKind, text: string) => void
  success: (text?: string) => void
  error: (e: unknown) => void
}
export const ToastCtx = createContext<ToastApi | null>(null)
export const useToast = () => {
  const t = useContext(ToastCtx)
  if (!t) throw new Error('ToastProvider missing')
  return t
}

/* ---------------- confirm dialog ---------------- */
export type ConfirmOptions = {
  title: string
  text?: string
  confirmText?: string
  danger?: boolean
}
export const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null)
export const useConfirm = () => {
  const c = useContext(ConfirmCtx)
  if (!c) throw new Error('ConfirmProvider missing')
  return c
}

/* ---------------- admin data (content + stats) ---------------- */
export type AdminData = {
  content: Content | null
  contentError: string | null
  reloadContent: () => Promise<Content | null>
  setContent: (fn: (c: Content) => Content) => void
  stats: Stats | null
  reloadStats: () => void
}
export const AdminCtx = createContext<AdminData | null>(null)
export const useAdmin = () => {
  const a = useContext(AdminCtx)
  if (!a) throw new Error('AdminCtx missing')
  return a
}

/* ---------------- unsaved-changes guard ----------------
 * BrowserRouter is a declarative router (no useBlocker), so the guard is a module flag:
 * in-app links call `confirmLeave()`, and the browser's own unload is caught with beforeunload. */
let dirty = false
export const confirmLeave = () =>
  !dirty || window.confirm("Saqlanmagan o'zgarishlar bor. Sahifadan chiqib ketasizmi?")
export const useUnsavedGuard = (isDirty: boolean) => {
  useEffect(() => {
    dirty = isDirty
    if (!isDirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      dirty = false
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [isDirty])
}

/* ---------------- uploads ---------------- */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const checkImage = (f: File) => {
  if (!IMAGE_TYPES.includes(f.type)) return 'Faqat JPG, PNG yoki WEBP rasm yuklash mumkin'
  if (f.size > 15 * 1024 * 1024) return 'Rasm 15 MB dan katta bo‘lmasin'
  return null
}

/* ---------------- icon paths (24×24, stroke) ---------------- */
export const ICONS = {
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  left: 'M19 12H5M12 19l-7-7 7-7',
  right: 'M5 12h14M12 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  pdf: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4zM14 3v4h4M9 13h6M9 17h4',
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  products: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  categories: 'M4 6h16M4 12h16M4 18h10',
  docs: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4zM14 3v4h4M9 13l2 2 4-4',
  news: 'M5 4h12a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1zM8 8h7M8 12h7M8 16h4',
  leads: 'M4 6h16v12H4zM4 7l8 6 8-6',
  video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3',
  chats: 'M5 5h14v10H9l-4 4z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  site: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
} as const
export type IconName = keyof typeof ICONS
