import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api, type Category, type CategoryInput } from '../api'
import { useAdmin, useConfirm, useToast } from '../lib'
import { Badge, Button, Card, Empty, ErrorBox, Field, ImageField, Input, Modal, PageHeader, PageLoader } from '../ui'

export default function Categories() {
  const { content, contentError, reloadContent } = useAdmin()
  const [creating, setCreating] = useState(false)
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />

  return (
    <>
      <PageHeader
        title="Kategoriyalar"
        sub="Mahsulotlar soni avtomatik hisoblanadi"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Yangi kategoriya
          </Button>
        }
      />
      {content.categories.length === 0 ? (
        <Empty>Kategoriyalar yo‘q</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {content.categories.map((c) => (
            <CategoryCard key={`${c.id}:${c.name.uz}:${c.name.ru}:${c.image}`} category={c} />
          ))}
        </div>
      )}
      <CreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

function CategoryCard({ category: c }: { category: Category }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const initial: CategoryInput = { name: { ...c.name }, image: c.image }
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)

  const save = async () => {
    if (!f.name.uz.trim() || !f.name.ru.trim()) return toast.show('error', 'Ikkala tildagi nomni kiriting')
    setSaving(true)
    try {
      await api.updateCategory(c.id, { name: { uz: f.name.uz.trim(), ru: f.name.ru.trim() }, image: f.image })
      toast.success()
      await reloadContent() // card remounts with fresh data (key includes the values)
    } catch (e) {
      toast.error(e)
      setSaving(false)
    }
  }
  const del = async () => {
    const ok = await confirm({
      title: 'Kategoriyani o‘chirish',
      text: `“${c.name.uz}” kategoriyasi o‘chiriladi.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await api.deleteCategory(c.id)
      toast.success('O‘chirildi')
      await reloadContent()
    } catch (e) {
      setDeleting(false)
      if (e instanceof ApiError && e.status === 409)
        toast.show(
          'error',
          `${e.message || 'Kategoriya ishlatilmoqda'}. Avval ${c.count} ta mahsulotni boshqa kategoriyaga o‘tkazing yoki ulardan bu kategoriyani olib tashlang.`,
        )
      else toast.error(e)
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link to="/admin/products" className="text-sm text-stone-600 hover:underline">
          <Badge tone={c.count ? 'stone' : 'red'}>{c.count} ta mahsulot</Badge>
        </Link>
        <span className="text-xs text-stone-400">ID {c.id}</span>
      </div>
      <ImageField label="Rasm" value={f.image} onChange={(image) => setF((s) => ({ ...s, image }))} aspect="aspect-[16/9]" />
      <Field label="Nomi (o‘zbekcha)">
        {(id) => (
          <Input id={id} value={f.name.uz} onChange={(e) => setF((s) => ({ ...s, name: { ...s.name, uz: e.target.value } }))} />
        )}
      </Field>
      <Field label="Nomi (ruscha)">
        {(id) => (
          <Input id={id} lang="ru" value={f.name.ru} onChange={(e) => setF((s) => ({ ...s, name: { ...s.name, ru: e.target.value } }))} />
        )}
      </Field>
      <div className="mt-auto flex justify-between gap-2">
        <Button variant="danger" size="sm" onClick={del} loading={deleting}>
          O‘chirish
        </Button>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setF(initial)} disabled={saving}>
              Bekor
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={save} disabled={!dirty} loading={saving}>
            Saqlash
          </Button>
        </div>
      </div>
    </Card>
  )
}

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const blank: CategoryInput = { name: { uz: '', ru: '' }, image: '' }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const close = () => {
    setF(blank)
    onClose()
  }
  const save = async () => {
    if (!f.name.uz.trim() || !f.name.ru.trim()) return toast.show('error', 'Ikkala tildagi nomni kiriting')
    if (!f.image) return toast.show('error', 'Rasm yuklang')
    setSaving(true)
    try {
      await api.createCategory({ name: { uz: f.name.uz.trim(), ru: f.name.ru.trim() }, image: f.image })
      toast.success('Kategoriya qo‘shildi')
      await reloadContent()
      close()
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Yangi kategoriya"
      footer={
        <>
          <Button onClick={close}>Bekor qilish</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Qo‘shish
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Nomi (o‘zbekcha)">
          {(id) => (
            <Input id={id} value={f.name.uz} onChange={(e) => setF((s) => ({ ...s, name: { ...s.name, uz: e.target.value } }))} />
          )}
        </Field>
        <Field label="Nomi (ruscha)">
          {(id) => (
            <Input id={id} lang="ru" value={f.name.ru} onChange={(e) => setF((s) => ({ ...s, name: { ...s.name, ru: e.target.value } }))} />
          )}
        </Field>
        <ImageField label="Rasm" value={f.image} onChange={(image) => setF((s) => ({ ...s, image }))} aspect="aspect-[16/9]" />
      </div>
    </Modal>
  )
}
