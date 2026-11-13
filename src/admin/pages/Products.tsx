import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { cx, img, useAdmin, useToast } from '../lib'
import {
  Badge,
  Empty,
  ErrorBox,
  IconButton,
  Input,
  PageHeader,
  PageLoader,
  focusRing,
  Icon,
} from '../ui'

export default function Products() {
  const { content, contentError, reloadContent, setContent } = useAdmin()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />

  const { products, categories, documents } = content
  const query = q.trim().toLowerCase()
  const shown = query
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.slug.includes(query) ||
          p.subtitle.uz.toLowerCase().includes(query) ||
          p.subtitle.ru.toLowerCase().includes(query),
      )
    : products
  const catName = (id: number) => categories.find((c) => c.id === id)?.name.uz ?? `#${id}`

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= products.length) return
    const prev = products
    const next = [...products]
    ;[next[index], next[j]] = [next[j], next[index]]
    setContent((c) => ({ ...c, products: next }))
    setSaving(true)
    try {
      await api.orderProducts(next.map((p) => p.slug))
    } catch (e) {
      setContent((c) => ({ ...c, products: prev }))
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Mahsulotlar"
        sub={`${products.length} ta mahsulot · saytdagi tartib shu ro‘yxat bo‘yicha`}
        actions={
          <Link
            to="/admin/products/new"
            className={cx(
              'inline-flex h-10 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700',
              focusRing,
            )}
          >
            + Yangi mahsulot
          </Link>
        }
      />
      <div className="mb-4">
        <label htmlFor="p-search" className="sr-only">
          Qidirish
        </label>
        <Input
          id="p-search"
          type="search"
          placeholder="Nomi yoki tavsifi bo‘yicha qidirish…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:max-w-sm"
        />
        {query && <p className="mt-2 text-xs text-stone-500">Qidiruv paytida tartibni o‘zgartirib bo‘lmaydi.</p>}
      </div>

      {shown.length === 0 ? (
        <Empty>Hech narsa topilmadi</Empty>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {shown.map((p) => {
            const i = products.indexOf(p)
            const docs = documents.filter((d) => d.products.includes(p.slug)).length
            return (
              <li key={p.slug} className="flex items-center gap-3 px-3 py-2.5 md:gap-4 md:px-4">
                <span className="hidden w-6 text-right text-sm text-stone-400 tabular-nums sm:block">{i + 1}</span>
                <Link
                  to={`/admin/products/${p.slug}`}
                  className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-lg md:gap-4', focusRing)}
                >
                  <img
                    src={img(p.image)}
                    alt=""
                    loading="lazy"
                    className="size-14 shrink-0 rounded-lg bg-stone-100 object-cover md:size-16"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-stone-900">{p.name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {p.categories.map((c) => (
                        <Badge key={c}>{catName(c)}</Badge>
                      ))}
                      {docs > 0 && <Badge tone="green">{docs} sertifikat</Badge>}
                      {p.categories.length === 0 && <Badge tone="red">Kategoriyasiz</Badge>}
                    </span>
                  </span>
                </Link>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <IconButton label={`${p.name} — yuqoriga`} disabled={!!query || saving || i === 0} onClick={() => move(i, -1)}>
                    <Icon name="up" />
                  </IconButton>
                  <IconButton
                    label={`${p.name} — pastga`}
                    disabled={!!query || saving || i === products.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="down" />
                  </IconButton>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
