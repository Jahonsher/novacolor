import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Content, type Product, type ProductInput } from '../api'
import { GROUP_LABEL, SLUG_RE, checkImage, cx, img, pdfUrl, siteUrl, slugify, useAdmin, useConfirm, useToast, useUnsavedGuard } from '../lib'
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  GuardedLink,
  IconButton,
  ImageField,
  Input,
  PageHeader,
  PageLoader,
  SectionTitle,
  Spinner,
  Textarea,
  focusRing,
  Icon,
} from '../ui'

export default function ProductForm() {
  const { slug } = useParams()
  const { content, contentError, reloadContent } = useAdmin()
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />
  const product = slug ? content.products.find((p) => p.slug === slug) : undefined
  if (slug && !product)
    return (
      <Empty>
        Mahsulot topilmadi.{' '}
        <Link to="/admin/products" className="underline">
          Ro‘yxatga qaytish
        </Link>
      </Empty>
    )
  // key: switching between products remounts the editor with fresh state
  return <Editor key={slug ?? 'new'} product={product} content={content} />
}

type FormState = Omit<ProductInput, 'id'>
const empty: FormState = {
  name: '',
  slug: '',
  categories: [],
  image: '',
  gallery: [],
  subtitle: { uz: '', ru: '' },
  description: { uz: '', ru: '' },
}
const fromProduct = (p: Product): FormState => ({
  name: p.name,
  slug: p.slug,
  categories: [...p.categories],
  image: p.image,
  gallery: [...p.gallery],
  subtitle: { ...p.subtitle },
  description: { ...p.description },
})

function Editor({ product, content }: { product?: Product; content: Content }) {
  const isNew = !product
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { reloadContent, reloadStats } = useAdmin()
  const [saved, setSaved] = useState<FormState>(() => (product ? fromProduct(product) : empty))
  const [f, setF] = useState<FormState>(saved)
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(saved), [f, saved])
  useUnsavedGuard(dirty)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const setName = (name: string) => setF((s) => ({ ...s, name, slug: slugTouched ? s.slug : slugify(name) }))

  const slugTaken = content.products.some((p) => p.slug === f.slug && p.slug !== product?.slug)
  const errors = {
    name: !f.name.trim() ? 'Nomini kiriting' : null,
    slug: !f.slug
      ? 'Manzilni kiriting'
      : !SLUG_RE.test(f.slug)
        ? 'Faqat kichik lotin harflari, raqamlar va "-" (masalan: mi-ku-therm)'
        : slugTaken
          ? 'Bu manzil boshqa mahsulotda ishlatilgan'
          : null,
    categories: f.categories.length === 0 ? 'Kamida bitta kategoriya tanlang' : null,
    image: !f.image ? 'Asosiy rasmni yuklang' : null,
  }
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : k === 'slug' && f.slug ? errors.slug : null)
  const linkedDocs = product ? content.documents.filter((d) => d.products.includes(product.slug)) : []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) {
      toast.show('error', 'Formadagi xatolarni tuzating')
      return
    }
    const body: ProductInput = {
      ...f,
      name: f.name.trim(),
      subtitle: { uz: f.subtitle.uz.trim(), ru: f.subtitle.ru.trim() },
      description: { uz: tidy(f.description.uz), ru: tidy(f.description.ru) },
    }
    setSaving(true)
    try {
      const res = product ? await api.updateProduct(product.slug, { ...body, id: product.id }) : await api.createProduct(body)
      const next = res?.slug ? fromProduct(res) : body
      setSaved(next)
      setF(next)
      await reloadContent()
      reloadStats()
      toast.success()
      if (!product || next.slug !== product.slug) navigate(`/admin/products/${next.slug}`, { replace: true })
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!product) return
    const ok = await confirm({
      title: 'Mahsulotni o‘chirish',
      text: `“${product.name}” saytdan o‘chiriladi. Sertifikat va yangiliklardagi havolalar ham olib tashlanadi. Bu amalni qaytarib bo‘lmaydi.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.deleteProduct(product.slug)
      setSaved(f) // clear the unsaved guard
      await reloadContent()
      reloadStats()
      toast.success('O‘chirildi')
      navigate('/admin/products', { replace: true })
    } catch (err) {
      toast.error(err)
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <GuardedLink
        to="/admin/products"
        className={cx('mb-3 inline-block text-sm text-stone-600 hover:text-stone-900', focusRing)}
      >
        ← Mahsulotlar
      </GuardedLink>
      <PageHeader
        title={product ? product.name : 'Yangi mahsulot'}
        sub={dirty ? <span className="text-amber-700">Saqlanmagan o‘zgarishlar bor</span> : isNew ? undefined : 'Barcha o‘zgarishlar saqlangan'}
        actions={
          product && (
            <a
              href={siteUrl(`products/${product.slug}`)}
              target="_blank"
              rel="noreferrer"
              className={cx('inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm hover:bg-stone-50', focusRing)}
            >
              Saytda ko‘rish <Icon name="external" />
            </a>
          )
        }
      />

      {/* one column on phones (main image right after the name), two columns from lg */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <Card className="order-1 grid gap-4 p-4 md:p-5">
            <Field label="Nomi" error={show('name')}>
              {(id) => <Input id={id} value={f.name} onChange={(e) => setName(e.target.value)} maxLength={120} required />}
            </Field>
            <Field
              label="Sahifa manzili (slug)"
              error={show('slug')}
              hint={
                <>
                  Sayt manzili: /products/<b>{f.slug || '…'}</b> — nomdan avtomatik yaratiladi
                </>
              }
            >
              {(id) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    value={f.slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                    }}
                    className="font-mono text-sm"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                  {slugTouched && f.name && slugify(f.name) !== f.slug && (
                    <Button
                      size="md"
                      variant="ghost"
                      onClick={() => {
                        setSlugTouched(!isNew)
                        set('slug', slugify(f.name))
                      }}
                    >
                      Nomdan
                    </Button>
                  )}
                </div>
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-stone-700">Kategoriyalar</legend>
              <div className="flex flex-wrap gap-2">
                {content.categories.map((c) => {
                  const on = f.categories.includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className={cx(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber-700',
                        on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white hover:bg-stone-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() =>
                          set('categories', on ? f.categories.filter((x) => x !== c.id) : [...f.categories, c.id])
                        }
                      />
                      {on ? '✓ ' : ''}
                      {c.name.uz}
                    </label>
                  )
                })}
              </div>
              {show('categories') && <p className="mt-1.5 text-sm text-red-700">{show('categories')}</p>}
            </fieldset>
          </Card>

          <Card className="order-3 grid gap-4 p-4 md:p-5">
            <SectionTitle className="mb-0">Matnlar</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Qisqa tavsif (o‘zbekcha)">
                {(id) => (
                  <Input id={id} value={f.subtitle.uz} onChange={(e) => set('subtitle', { ...f.subtitle, uz: e.target.value })} />
                )}
              </Field>
              <Field label="Qisqa tavsif (ruscha)">
                {(id) => (
                  <Input id={id} lang="ru" value={f.subtitle.ru} onChange={(e) => set('subtitle', { ...f.subtitle, ru: e.target.value })} />
                )}
              </Field>
            </div>
            <Field label="To‘liq tavsif (o‘zbekcha)" hint="Xatboshilarni bo‘sh qator bilan ajrating">
              {(id) => (
                <Textarea
                  id={id}
                  rows={9}
                  value={f.description.uz}
                  onChange={(e) => set('description', { ...f.description, uz: e.target.value })}
                />
              )}
            </Field>
            <Field label="To‘liq tavsif (ruscha)" hint="Абзацы разделяйте пустой строкой">
              {(id) => (
                <Textarea
                  id={id}
                  lang="ru"
                  rows={9}
                  value={f.description.ru}
                  onChange={(e) => set('description', { ...f.description, ru: e.target.value })}
                />
              )}
            </Field>
          </Card>

          <Card className="order-4 p-4 md:p-5">
            <Gallery value={f.gallery} onChange={(fn) => setF((s) => ({ ...s, gallery: fn(s.gallery) }))} />
          </Card>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <Card className="order-2 p-4 md:p-5">
            <ImageField label="Asosiy rasm" value={f.image} onChange={(p) => set('image', p)} />
            {show('image') && <p className="mt-1.5 text-sm text-red-700">{show('image')}</p>}
          </Card>

          {!isNew && (
            <Card className="order-5 p-4 md:p-5">
              <SectionTitle>Sertifikatlar</SectionTitle>
              {linkedDocs.length === 0 ? (
                <p className="text-sm text-stone-500">Bu mahsulotga sertifikat biriktirilmagan.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {linkedDocs.map((d) => (
                    <li key={d.file}>
                      <a
                        href={pdfUrl(d)}
                        target="_blank"
                        rel="noreferrer"
                        className={cx('flex items-start gap-2 text-sm hover:underline', focusRing)}
                      >
                        <Icon name="pdf" className="mt-0.5 size-4 shrink-0 text-red-700" />
                        <span>
                          {d.title.uz}
                          <span className="block text-xs text-stone-500">{GROUP_LABEL[d.group]}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <GuardedLink to="/admin/documents" className="mt-3 inline-block text-sm text-amber-800 hover:underline">
                Sertifikatlarni boshqarish →
              </GuardedLink>
            </Card>
          )}

          {!isNew && (
            <Card className="order-6 p-4 md:p-5">
              <SectionTitle>Xavfli hudud</SectionTitle>
              <Button variant="danger" onClick={del} loading={deleting} className="w-full">
                Mahsulotni o‘chirish
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* sticky action bar — always reachable on a phone */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-100/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        {dirty && <span className="mr-auto hidden text-sm text-amber-700 sm:block">Saqlanmagan o‘zgarishlar</span>}
        <Button disabled={!dirty || saving} onClick={() => setF(saved)}>
          Bekor qilish
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !isNew}>
          {isNew ? 'Yaratish' : 'Saqlash'}
        </Button>
      </div>
    </form>
  )
}

/** Normalise paragraph breaks: trim, collapse 3+ newlines to one blank line. */
const tidy = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

function Gallery({ value, onChange }: { value: string[]; onChange: (fn: (g: string[]) => string[]) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    const bad = list.map(checkImage).find(Boolean)
    if (bad) {
      toast.show('error', bad)
      return
    }
    setProgress({ done: 0, total: list.length })
    // sequential; each finished upload is appended to whatever the gallery is by then
    for (const [i, file] of list.entries()) {
      try {
        const r = await api.uploadImage(file)
        onChange((g) => [...g, r.path])
      } catch (e) {
        toast.error(e)
        break
      }
      setProgress({ done: i + 1, total: list.length })
    }
    setProgress(null)
    if (input.current) input.current.value = ''
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    onChange((g) => {
      const next = [...g]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="mb-0">Galereya ({value.length})</SectionTitle>
        <Button size="sm" onClick={() => input.current?.click()} loading={!!progress}>
          {progress ? `Yuklanmoqda ${progress.done}/${progress.total}` : '+ Rasmlar qo‘shish'}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      {value.length === 0 && !progress ? (
        <p className="rounded-lg border border-dashed border-stone-300 py-8 text-center text-sm text-stone-500">
          Galereyada rasm yo‘q. Bir nechta rasmni birdaniga tanlash mumkin.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {value.map((p, i) => (
            <li key={p + i} className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
              <img src={img(p)} alt={`Galereya ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <IconButton label="Chapga" disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="left" />
                  </IconButton>
                  <IconButton label="O‘ngga" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                    <Icon name="right" />
                  </IconButton>
                </div>
                <IconButton
                  label="Rasmni olib tashlash"
                  className="hover:text-red-700"
                  onClick={() => onChange((g) => g.filter((_, k) => k !== i))}
                >
                  <Icon name="x" />
                </IconButton>
              </div>
            </li>
          ))}
          {progress && (
            <li className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-stone-300 text-stone-500">
              <Spinner />
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
