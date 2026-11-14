import { useRef, useState } from 'react'
import { InstagramIcon } from '../../components/InstagramIcon'
import { api, MAX_VIDEO_MB, type Product, type Video, type VideoInput } from '../api'
import { cx, fmtDate, img, siteUrl, useAdmin, useConfirm, useToast } from '../lib'
import { Badge, Button, Empty, ErrorBox, Field, Icon, IconButton, ImageField, Input, Modal, PageHeader, PageLoader, Select } from '../ui'

/** Same rule as the server: post / reel / tv link on instagram.com. */
const IG_RE = /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]{1,30}\/)?(?:p|reels?|tv)\/[A-Za-z0-9_-]{5,64}\/?(?:[?#].*)?$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']

export default function Videos() {
  const { content, contentError, reloadContent, setContent } = useAdmin()
  const toast = useToast()
  const confirm = useConfirm()
  const [modal, setModal] = useState<{ item?: Video } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />

  const videos = content.videos ?? []
  const { products } = content
  const productName = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= videos.length) return
    const prev = videos
    const next = [...videos]
    ;[next[index], next[j]] = [next[j], next[index]]
    setContent((c) => ({ ...c, videos: next }))
    setSaving(true)
    try {
      await api.orderVideos(next.map((v) => v.id))
    } catch (e) {
      setContent((c) => ({ ...c, videos: prev }))
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }

  const del = async (v: Video) => {
    const ok = await confirm({
      title: 'Videoni o‘chirish',
      text: `“${v.title.uz}” saytdan o‘chiriladi${v.src?.startsWith('uploads/') ? ' (yuklangan fayl ham o‘chadi)' : ''}.`,
      confirmText: 'O‘chirish',
      danger: true,
    })
    if (!ok) return
    setDeleting(v.id)
    try {
      await api.deleteVideo(v.id)
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
        title="Videolar"
        sub={`${videos.length} ta video · bosh sahifadagi “Instagram’dan” bo‘limi, tartib shu ro‘yxat bo‘yicha`}
        actions={
          <Button variant="primary" onClick={() => setModal({})}>
            + Video qo‘shish
          </Button>
        }
      />
      {videos.length === 0 ? (
        <Empty>Videolar yo‘q — bo‘lim saytda ko‘rinmaydi</Empty>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {videos.map((v, i) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-3 md:gap-4 md:px-4">
              <span className="hidden w-6 text-right text-sm text-stone-400 tabular-nums sm:block">{i + 1}</span>
              <button
                type="button"
                onClick={() => setModal({ item: v })}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left md:gap-4"
              >
                <VideoThumb v={v} className="w-14 shrink-0 md:w-16" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-stone-900">{v.title.uz}</span>
                  {v.title.ru && <span className="block truncate text-sm text-stone-500">{v.title.ru}</span>}
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {v.src ? <Badge tone="green">Video fayl</Badge> : null}
                    {v.instagram ? <Badge tone="violet">Instagram</Badge> : null}
                    {v.product ? <Badge>{productName(v.product)}</Badge> : null}
                    {v.date ? <Badge tone="blue">{fmtDate(v.date)}</Badge> : null}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                <IconButton label={`${v.title.uz} — yuqoriga`} disabled={saving || i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </IconButton>
                <IconButton label={`${v.title.uz} — pastga`} disabled={saving || i === videos.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </IconButton>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-2">
                <Button size="sm" onClick={() => setModal({ item: v })}>
                  Tahrirlash
                </Button>
                <Button size="sm" variant="danger" onClick={() => del(v)} loading={deleting === v.id}>
                  O‘chirish
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-stone-500">
        Video fayl (MP4/MOV/WEBM, {MAX_VIDEO_MB} MB gacha) yuklang yoki Instagram post / Reels havolasini qo‘ying.{' '}
        <a href={siteUrl('')} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-stone-800">
          Saytda ko‘rish
        </a>
      </p>
      {modal && <VideoModal item={modal.item} products={products} onClose={() => setModal(null)} />}
    </>
  )
}

/** 9:16 preview: poster, else the video's first frame, else an Instagram placeholder. */
function VideoThumb({ v, className }: { v: Pick<Video, 'poster' | 'src' | 'instagram'>; className?: string }) {
  const box = cx('relative aspect-[9/16] overflow-hidden rounded-lg bg-stone-100', className)
  if (v.poster) return <img src={img(v.poster)} alt="" loading="lazy" className={cx(box, 'object-cover')} />
  if (v.src) return <video src={`${img(v.src)}#t=0.5`} preload="metadata" muted playsInline className={cx(box, 'object-cover')} />
  return (
    <span className={cx(box, 'flex items-center justify-center bg-gradient-to-br from-amber-400 via-rose-500 to-violet-600 text-white')}>
      <InstagramIcon className="size-6" />
    </span>
  )
}

function VideoModal({ item, products, onClose }: { item?: Video; products: Product[]; onClose: () => void }) {
  const { reloadContent } = useAdmin()
  const toast = useToast()
  const [f, setF] = useState<VideoInput>({
    title: { uz: item?.title.uz ?? '', ru: item?.title.ru ?? '' },
    src: item?.src ?? '',
    poster: item?.poster ?? '',
    instagram: item?.instagram ?? '',
    product: item?.product ?? null,
    date: item?.date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = <K extends keyof VideoInput>(k: K, v: VideoInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const igBad = f.instagram.trim() !== '' && !IG_RE.test(f.instagram.trim())

  const save = async () => {
    if (!f.title.uz.trim()) return toast.show('error', 'Sarlavhani (o‘zbekcha) kiriting')
    if (!f.src && !f.instagram.trim()) return toast.show('error', 'Video fayl yuklang yoki Instagram havolasini kiriting')
    if (igBad) return toast.show('error', 'Instagram havolasi noto‘g‘ri')
    setSaving(true)
    try {
      const body: VideoInput = { ...f, title: { uz: f.title.uz.trim(), ru: f.title.ru.trim() }, instagram: f.instagram.trim() }
      if (item) await api.updateVideo(item.id, body)
      else await api.createVideo(body)
      await reloadContent()
      toast.success()
      onClose()
    } catch (e) {
      toast.error(e)
      setSaving(false)
    }
  }

  const busy = saving || uploading
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={item ? 'Videoni tahrirlash' : 'Yangi video'}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={uploading}>
            Saqlash
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sarlavha (o‘zbekcha)">
            {(id) => <Input id={id} value={f.title.uz} maxLength={300} onChange={(e) => set('title', { ...f.title, uz: e.target.value })} />}
          </Field>
          <Field label="Sarlavha (ruscha)" hint="Bo‘sh qolsa, o‘zbekchasi ko‘rsatiladi">
            {(id) => <Input id={id} value={f.title.ru} maxLength={300} onChange={(e) => set('title', { ...f.title, ru: e.target.value })} />}
          </Field>
        </div>

        <VideoFileField
          value={f.src}
          onChange={(src) => set('src', src)}
          onUploaded={(r) => {
            setF((s) => ({ ...s, src: r.path, poster: s.poster || r.poster || '' }))
            if (r.processing) toast.show('info', 'Video serverda siqilmoqda (bir necha daqiqa). Saqlashingiz mumkin — tayyor bo‘lgach o‘zi almashadi.')
          }}
          onBusy={setUploading}
        />

        <Field
          label="Instagram havolasi"
          error={igBad ? 'Post yoki Reels havolasi kerak: https://www.instagram.com/reel/… yoki https://www.instagram.com/p/…' : null}
          hint={
            f.src
              ? 'Ixtiyoriy: video ostida “Instagram’da ochish” havolasi chiqadi'
              : 'Video fayl bo‘lmasa, saytda Instagram’ning o‘z pleyeri ko‘rsatiladi (Instagram’dan ilovada “Ulashish → Havolani nusxalash”)'
          }
        >
          {(id) => (
            <Input
              id={id}
              type="url"
              inputMode="url"
              placeholder="https://www.instagram.com/reel/…"
              value={f.instagram}
              onChange={(e) => set('instagram', e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <ImageField label="Poster (ixtiyoriy)" value={f.poster} onChange={(p) => set('poster', p)} aspect="aspect-[9/16]" allowRemove />
          <div className="grid content-start gap-4">
            <p className="text-xs text-stone-500">
              Poster — video yuklanguncha ko‘rinadigan rasm (vertikal, 9:16). Video fayldan avtomatik olinadi (serverda ffmpeg bo‘lsa); xohlasangiz o‘zingiz yuklang.
            </p>
            <Field label="Bog‘langan mahsulot (ixtiyoriy)" hint="Video shu mahsulot sahifasida ham ko‘rinadi">
              {(id) => (
                <Select id={id} value={f.product ?? ''} onChange={(e) => set('product', e.target.value || null)}>
                  <option value="">— Yo‘q —</option>
                  {products.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Sana (ixtiyoriy)">
              {(id) => <Input id={id} type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />}
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Upload (with a progress bar) / replace / remove the video file. */
function VideoFileField({
  value,
  onChange,
  onUploaded,
  onBusy,
}: {
  value: string
  onChange: (src: string) => void
  onUploaded: (r: Awaited<ReturnType<typeof api.uploadVideo>>) => void
  onBusy: (b: boolean) => void
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState<{ p: number; size: number; name: string } | null>(null)

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    if (!VIDEO_TYPES.includes(file.type) && !VIDEO_EXT.test(file.name)) return toast.show('error', 'Faqat MP4, MOV yoki WEBM video yuklash mumkin')
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) return toast.show('error', `Video ${MAX_VIDEO_MB} MB dan katta bo‘lmasin (bu fayl ${mb(file.size)} MB)`)
    const ctrl = new AbortController()
    abort.current = ctrl
    setProgress({ p: 0, size: file.size, name: file.name })
    onBusy(true)
    try {
      const r = await api.uploadVideo(file, (p) => setProgress((s) => (s ? { ...s, p } : s)), ctrl.signal)
      onUploaded(r)
      toast.success('Video yuklandi')
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(e)
    } finally {
      abort.current = null
      setProgress(null)
      onBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-stone-700">Video fayl</span>
      {progress ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-stone-700">{progress.name}</span>
            <span className="shrink-0 text-stone-500 tabular-nums">
              {progress.p >= 1 ? 'Serverda ishlanmoqda…' : `${Math.round(progress.p * 100)}% · ${mb(progress.p * progress.size)} / ${mb(progress.size)} MB`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-stone-900 transition-[width] duration-200" style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => abort.current?.abort()} disabled={progress.p >= 1}>
            Bekor qilish
          </Button>
        </div>
      ) : value ? (
        <div className="flex flex-wrap items-start gap-3">
          <video src={img(value)} controls preload="metadata" playsInline className="aspect-[9/16] w-36 rounded-lg bg-stone-900 object-contain" />
          <div className="flex flex-col gap-2">
            <p className="max-w-56 text-xs break-all text-stone-500">{value}</p>
            <Button size="sm" onClick={() => input.current?.click()}>
              Almashtirish
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              Olib tashlash
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-stone-300 p-4">
          <Button size="sm" onClick={() => input.current?.click()}>
            Video yuklash
          </Button>
          <span className="text-xs text-stone-500">MP4, MOV yoki WEBM · {MAX_VIDEO_MB} MB gacha · vertikal (9:16) videolar eng yaxshi ko‘rinadi</span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  )
}

const mb = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)
