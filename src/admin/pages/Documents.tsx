import { useRef, useState } from 'react'
import { api, type AdminDoc, type DocGroup, type DocMeta, type Product } from '../api'
import { GROUP_LABEL, cx, pdfUrl, useAdmin, useConfirm, useToast } from '../lib'
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  ProductPicker,
  Select,
  focusRing,
  Icon,
} from '../ui'

const GROUPS = Object.keys(GROUP_LABEL) as DocGroup[]

export default function Documents() {
  const { content, contentError, reloadContent, reloadStats } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<{ doc?: AdminDoc } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />

  const { documents, products } = content
  const query = q.trim().toLowerCase()
  const shown = query
    ? documents.filter(
        (d) =>
          d.title.uz.toLowerCase().includes(query) ||
          d.title.ru.toLowerCase().includes(query) ||
          d.file.toLowerCase().includes(query) ||
          d.products.some((s) => s.includes(query)),
      )
    : documents
  const productName = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug

  const del = async (d: AdminDoc) => {
    const ok = await confirm({
      title: 'Hujjatni o‘chirish',
      text: `“${d.title.uz}” ro‘yxatdan o‘chiriladi${d.path?.startsWith('uploads/') ? ' va fayl serverdan o‘chiriladi' : ''}.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setDeleting(d.file)
    try {
      await api.deleteDocument(d.file)
      await reloadContent()
      reloadStats()
      toast.success('O‘chirildi')
    } catch (e) {
      toast.error(e)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Sertifikatlar"
        sub={`${documents.length} ta PDF hujjat · mahsulotga biriktirilganlari mahsulot sahifasida ko‘rinadi`}
        actions={
          <Button variant="primary" onClick={() => setModal({})}>
            + PDF yuklash
          </Button>
        }
      />
      <div className="mb-5">
        <label htmlFor="doc-search" className="sr-only">
          Qidirish
        </label>
        <Input
          id="doc-search"
          type="search"
          placeholder="Nomi yoki mahsulot bo‘yicha qidirish…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:max-w-sm"
        />
      </div>

      {shown.length === 0 && <Empty>{documents.length ? 'Hech narsa topilmadi' : 'Hujjatlar yo‘q'}</Empty>}
      <div className="flex flex-col gap-8">
        {GROUPS.map((g) => {
          const list = shown.filter((d) => d.group === g)
          if (!list.length) return null
          return (
            <section key={g} aria-labelledby={`grp-${g}`}>
              <h2 id={`grp-${g}`} className="mb-3 flex items-baseline gap-2 text-lg font-semibold">
                {GROUP_LABEL[g]} <span className="text-sm font-normal text-stone-500">{list.length}</span>
              </h2>
              <Card className="divide-y divide-stone-100">
                {list.map((d) => (
                  <div key={d.file} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <a
                      href={pdfUrl(d)}
                      target="_blank"
                      rel="noreferrer"
                      className={cx('flex min-w-0 flex-1 items-start gap-3 rounded-md', focusRing)}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                        <Icon name="pdf" className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-stone-900 hover:underline">{d.title.uz}</span>
                        <span className="block text-sm text-stone-500" lang="ru">
                          {d.title.ru}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {d.products.slice(0, 6).map((s) => (
                            <Badge key={s}>{productName(s)}</Badge>
                          ))}
                          {d.products.length > 6 && <Badge>+{d.products.length - 6}</Badge>}
                          {g !== 'company' && d.products.length === 0 && <Badge tone="amber">Mahsulot biriktirilmagan</Badge>}
                          <span className="text-xs leading-5 text-stone-400">
                            {d.file}
                            {d.size ? ` · ${fmtSize(d.size)}` : ''}
                          </span>
                        </span>
                      </span>
                    </a>
                    <div className="flex shrink-0 gap-2 pl-13 sm:pl-0">
                      <Button size="sm" onClick={() => setModal({ doc: d })}>
                        Tahrirlash
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => del(d)} loading={deleting === d.file}>
                        O‘chirish
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          )
        })}
      </div>
      {modal && <DocModal doc={modal.doc} products={products} onClose={() => setModal(null)} />}
    </>
  )
}

const fmtSize = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`)

function DocModal({ doc, products, onClose }: { doc?: AdminDoc; products: Product[]; onClose: () => void }) {
  const { reloadContent, reloadStats } = useAdmin()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<DocMeta>(
    doc
      ? { title: { ...doc.title }, group: doc.group, products: [...doc.products] }
      : { title: { uz: '', ru: '' }, group: 'product', products: [] },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = (f: File | undefined) => {
    setError(null)
    if (!f) return setFile(null)
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return setError('Faqat PDF fayl yuklash mumkin')
    if (f.size > 30 * 1024 * 1024) return setError('PDF 30 MB dan katta bo‘lmasin')
    setFile(f)
    const base = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
    setMeta((m) => ({ ...m, title: { uz: m.title.uz || base, ru: m.title.ru || base } }))
  }

  const save = async () => {
    if (!doc && !file) return setError('PDF faylni tanlang')
    if (!meta.title.uz.trim() || !meta.title.ru.trim()) return toast.show('error', 'Ikkala tildagi nomni kiriting')
    const body: DocMeta = { ...meta, title: { uz: meta.title.uz.trim(), ru: meta.title.ru.trim() } }
    setSaving(true)
    try {
      if (doc) await api.updateDocument(doc.file, body)
      else await api.createDocument(file!, body)
      await reloadContent()
      reloadStats()
      toast.success(doc ? 'Saqlandi' : 'Hujjat yuklandi')
      onClose()
    } catch (e) {
      toast.error(e)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={() => !saving && onClose()}
      title={doc ? 'Hujjatni tahrirlash' : 'Yangi PDF yuklash'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {doc ? 'Saqlash' : 'Yuklash'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {doc ? (
          <p className="text-sm text-stone-500">
            Fayl:{' '}
            <a href={pdfUrl(doc)} target="_blank" rel="noreferrer" className="text-amber-800 underline">
              {doc.file}
            </a>
          </p>
        ) : (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-stone-700">PDF fayl (≤ 30 MB)</span>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => fileRef.current?.click()}>{file ? 'Boshqa fayl' : 'Faylni tanlash'}</Button>
              <span className="min-w-0 truncate text-sm text-stone-600">
                {file ? `${file.name} · ${fmtSize(Math.round(file.size / 1024))}` : 'Fayl tanlanmagan'}
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {error && <p className="mt-1.5 text-sm text-red-700">{error}</p>}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nomi (o‘zbekcha)">
            {(id) => (
              <Input
                id={id}
                value={meta.title.uz}
                onChange={(e) => setMeta((m) => ({ ...m, title: { ...m.title, uz: e.target.value } }))}
              />
            )}
          </Field>
          <Field label="Nomi (ruscha)">
            {(id) => (
              <Input
                id={id}
                lang="ru"
                value={meta.title.ru}
                onChange={(e) => setMeta((m) => ({ ...m, title: { ...m.title, ru: e.target.value } }))}
              />
            )}
          </Field>
        </div>
        <Field label="Guruh">
          {(id) => (
            <Select id={id} value={meta.group} onChange={(e) => setMeta((m) => ({ ...m, group: e.target.value as DocGroup }))}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ProductPicker
          label="Qaysi mahsulotlarga tegishli"
          products={products}
          value={meta.products}
          onChange={(products) => setMeta((m) => ({ ...m, products }))}
        />
      </div>
    </Modal>
  )
}
