import { useState } from 'react'
import { api, type NewsInput, type NewsItem, type Product } from '../api'
import { fmtDate, img, useAdmin, useConfirm, useToast } from '../lib'
import { Badge, Button, Card, Empty, ErrorBox, Field, ImageField, Input, Modal, PageHeader, PageLoader, Select } from '../ui'

const today = () => new Date().toISOString().slice(0, 10)

export default function News() {
  const { content, contentError, reloadContent } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const [modal, setModal] = useState<{ item?: NewsItem } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />

  const { news, products } = content
  const productName = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug

  const del = async (n: NewsItem) => {
    const ok = await confirm({
      title: 'Yangilikni o‘chirish',
      text: `“${n.title}” o‘chiriladi.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setDeleting(n.id)
    try {
      await api.deleteNews(n.id)
      await reloadContent()
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
        title="Yangiliklar"
        sub={`${news.length} ta yangilik`}
        actions={
          <Button variant="primary" onClick={() => setModal({})}>
            + Yangilik qo‘shish
          </Button>
        }
      />
      {news.length === 0 ? (
        <Empty>Yangiliklar yo‘q</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {news.map((n) => (
            <Card key={n.id} className="flex flex-col overflow-hidden">
              <img src={img(n.image)} alt="" loading="lazy" className="aspect-[16/10] w-full bg-stone-100 object-cover" />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="text-sm text-stone-500">{fmtDate(n.date)}</p>
                <p className="font-medium text-stone-900">{n.title}</p>
                {n.product && (
                  <div>
                    <Badge>{productName(n.product)}</Badge>
                  </div>
                )}
                <div className="mt-auto flex gap-2 pt-2">
                  <Button size="sm" onClick={() => setModal({ item: n })}>
                    Tahrirlash
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => del(n)} loading={deleting === n.id}>
                    O‘chirish
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal && <NewsModal item={modal.item} products={products} onClose={() => setModal(null)} />}
    </>
  )
}

function NewsModal({ item, products, onClose }: { item?: NewsItem; products: Product[]; onClose: () => void }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const [f, setF] = useState<NewsInput>(
    item
      ? { title: item.title, date: item.date, image: item.image, product: item.product }
      : { title: '', date: today(), image: '', product: null },
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!f.title.trim()) return toast.show('error', 'Sarlavhani kiriting')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return toast.show('error', 'Sanani kiriting')
    if (!f.image) return toast.show('error', 'Rasm yuklang')
    setSaving(true)
    try {
      const body = { ...f, title: f.title.trim() }
      if (item) await api.updateNews(item.id, body)
      else await api.createNews(body)
      await reloadContent()
      toast.success()
      onClose()
    } catch (e) {
      toast.error(e)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={item ? 'Yangilikni tahrirlash' : 'Yangi yangilik'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Saqlash
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Sarlavha">
          {(id) => <Input id={id} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />}
        </Field>
        <Field label="Sana">
          {(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />}
        </Field>
        <ImageField label="Rasm" value={f.image} onChange={(image) => setF((s) => ({ ...s, image }))} aspect="aspect-[16/10]" />
        <Field label="Bog‘langan mahsulot (ixtiyoriy)" hint="Yangilik bosilganda shu mahsulot sahifasi ochiladi">
          {(id) => (
            <Select
              id={id}
              value={f.product ?? ''}
              onChange={(e) => setF((s) => ({ ...s, product: e.target.value || null }))}
            >
              <option value="">— Yo‘q —</option>
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  )
}
