import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, type LinkProps } from 'react-router'
import { api, type Product } from './api'
import {
  ConfirmCtx,
  ToastCtx,
  confirmLeave,
  cx,
  errText,
  img,
  useToast,
  checkImage,
  ICONS,
  type ConfirmOptions,
  type IconName,
  type ToastApi,
  type ToastKind,
} from './lib'

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700'

/* ---------------- buttons ---------------- */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-400',
  secondary: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
  ghost: 'text-stone-700 hover:bg-stone-200/60 disabled:text-stone-400',
}
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-10 px-4 text-sm',
        VARIANT[variant],
        focusRing,
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

/** Small square icon button (reorder, remove…). */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35',
        focusRing,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Link that respects the unsaved-changes guard. */
export function GuardedLink({ onClick, ...props }: LinkProps) {
  return (
    <Link
      {...props}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (!confirmLeave()) e.preventDefault()
        onClick?.(e)
      }}
    />
  )
}

/* ---------------- form controls ---------------- */
export const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:ring-2 focus:ring-amber-600/25 focus:outline-none disabled:bg-stone-100 sm:text-[15px]'

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : hint ? (
        <p className="text-xs text-stone-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cx(inputCls, className)} {...p} />
)
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(inputCls, 'leading-relaxed', className)} {...p} />
)
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cx(inputCls, 'pr-8', className)} {...p} />
)

/* ---------------- layout bits ---------------- */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-7">
      <div className="min-w-0">
        <h1 className="font-display text-3xl leading-tight font-normal text-stone-900 md:text-4xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-stone-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cx('rounded-xl border border-stone-200 bg-white', className)}>{children}</div>
)

export const SectionTitle = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h2 className={cx('mb-3 text-xs font-semibold tracking-[0.14em] text-stone-500 uppercase', className)}>
    {children}
  </h2>
)

const BADGE = {
  stone: 'bg-stone-100 text-stone-700 ring-stone-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
}
export function Badge({ tone = 'stone', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        BADGE[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export const PageLoader = () => (
  <div className="flex items-center justify-center gap-3 py-24 text-stone-500" role="status">
    <Spinner /> Yuklanmoqda…
  </div>
)

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800" role="alert">
      <p>{text}</p>
      {onRetry && (
        <Button className="mt-3" size="sm" onClick={onRetry}>
          Qayta urinish
        </Button>
      )}
    </div>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-stone-300 px-4 py-12 text-center text-stone-500">
    {children}
  </div>
)

/* ---------------- modal (native <dialog>: focus trap + Esc for free) ---------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cx(
        'm-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/45',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <IconButton label="Yopish" onClick={onClose} className="border-transparent">
              <Icon name="x" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

/* ---------------- toasts ---------------- */
type Toast = { id: number; kind: ToastKind; text: string }
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const seq = useRef(0)
  const show = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current
    setList((l) => [...l.slice(-3), { id, kind, text }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 2800)
  }, [])
  const apiObj = useMemo<ToastApi>(
    () => ({
      show,
      success: (text = 'Saqlandi') => show('success', text),
      error: (e) => show('error', errText(e)),
    }),
    [show],
  )
  return (
    <ToastCtx.Provider value={apiObj}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-16 z-[100] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:top-auto md:right-5 md:bottom-5 md:items-end"
      >
        {list.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
              t.kind === 'error' && 'bg-red-700 text-white ring-red-800',
              t.kind === 'success' && 'bg-stone-900 text-white ring-stone-950',
              t.kind === 'info' && 'bg-white text-stone-800 ring-stone-200',
            )}
          >
            <span aria-hidden className="mt-px">
              {t.kind === 'error' ? '!' : t.kind === 'success' ? '✓' : 'i'}
            </span>
            <span>{t.text}</span>
            <button
              type="button"
              className="-mr-1 ml-1 opacity-70 hover:opacity-100"
              aria-label="Yopish"
              onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------- confirm dialog ---------------- */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  )
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        footer={
          <>
            <Button onClick={() => close(false)}>Bekor qilish</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmText ?? 'Tasdiqlash'}
            </Button>
          </>
        }
      >
        <p className="text-stone-600">{state?.text ?? 'Ishonchingiz komilmi?'}</p>
      </Modal>
    </ConfirmCtx.Provider>
  )
}

/* ---------------- uploads ---------------- */
/** Single image with preview + upload/replace (+ optional remove). */
export function ImageField({
  label,
  value,
  onChange,
  aspect = 'aspect-[4/3]',
  allowRemove,
  className,
}: {
  label: string
  value: string
  onChange: (path: string) => void
  aspect?: string
  allowRemove?: boolean
  className?: string
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const pick = async (f: File | undefined) => {
    if (!f) return
    const bad = checkImage(f)
    if (bad) return toast.show('error', bad)
    setBusy(true)
    try {
      const r = await api.uploadImage(f)
      onChange(r.path)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span id={id} className="text-sm font-medium text-stone-700">
        {label}
      </span>
      <div
        className={cx(
          'relative overflow-hidden rounded-lg border border-stone-200 bg-stone-100',
          aspect,
        )}
      >
        {value ? (
          <img src={img(value)} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-400">Rasm yo‘q</div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-stone-700">
            <Spinner />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => input.current?.click()} loading={busy} aria-describedby={id}>
          {value ? 'Almashtirish' : 'Rasm yuklash'}
        </Button>
        {allowRemove && value && (
          <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}>
            Olib tashlash
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  )
}

/* ---------------- product multi-select ---------------- */
export function ProductPicker({
  products,
  value,
  onChange,
  label = 'Mahsulotlar',
}: {
  products: Product[]
  value: string[]
  onChange: (slugs: string[]) => void
  label?: string
}) {
  const [q, setQ] = useState('')
  const id = useId()
  const shown = products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (slug: string) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug])
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-stone-700">
        {label} <span className="font-normal text-stone-500">({value.length} tanlangan)</span>
      </legend>
      <label htmlFor={id} className="sr-only">
        Mahsulot qidirish
      </label>
      <Input id={id} type="search" placeholder="Qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={cx(
                'rounded-full bg-stone-900 px-2.5 py-0.5 text-xs text-white hover:bg-stone-700',
                focusRing,
              )}
              aria-label={`${products.find((p) => p.slug === s)?.name ?? s} — olib tashlash`}
            >
              {products.find((p) => p.slug === s)?.name ?? s} ×
            </button>
          ))}
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-stone-200">
        {shown.length === 0 && <p className="p-3 text-sm text-stone-500">Topilmadi</p>}
        {shown.map((p) => (
          <label
            key={p.slug}
            className="flex cursor-pointer items-center gap-3 border-b border-stone-100 px-3 py-2 last:border-0 hover:bg-stone-50"
          >
            <input
              type="checkbox"
              className="size-4 accent-stone-900"
              checked={value.includes(p.slug)}
              onChange={() => toggle(p.slug)}
            />
            <img src={img(p.image)} alt="" className="size-7 rounded object-cover" loading="lazy" />
            <span className="text-sm">{p.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* ---------------- icons (inline, tiny; paths in lib.ts) ---------------- */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ?? 'size-4'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  )
}
