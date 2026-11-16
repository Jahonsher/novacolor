import { useState, type FormEvent } from 'react'
import { api, type Content } from '../api'
import { cx, img, useAdmin, useToast, useUnsavedGuard } from '../lib'
import { Badge, Button, Card, ErrorBox, Field, GuardedLink, PageHeader, PageLoader, SectionTitle, Textarea, focusRing } from '../ui'

const MAX = 20000

const EXAMPLE = `Masalan:
Ish vaqti: dushanba–shanba 9:00–18:00, yakshanba dam olish kuni.
Showroom: Toshkent, … ko‘chasi. Namunalarni jonli ko‘rish mumkin, oldindan qo‘ng‘iroq qiling.
Yetkazib berish: Toshkent bo‘ylab; viloyatlarga kelishilgan holda.
Kafolat: … yil. Ustalarimiz qoplamani surtib berishi mumkin.
Qanday tanlash: avval xona yoki fasad, keyin effekt (metall, baxmal, beton, marmar) va maydonni so‘rang.
Ko‘p so‘raladigan savollar: …`

export default function AiTraining() {
  const { content, contentError, reloadContent } = useAdmin()
  if (!content) return contentError ? <ErrorBox text={contentError} onRetry={reloadContent} /> : <PageLoader />
  return (
    <>
      <PageHeader title="AI o‘rgatish" sub="Sayt AI maslahatchisiga kompaniya va mahsulotlar haqida qo‘shimcha bilim bering" />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px] xl:items-start">
        <div className="flex flex-col gap-5">
          <Card className="p-4 text-sm leading-relaxed text-stone-700 md:p-5">
            <SectionTitle>AI qanday o‘rganadi</SectionTitle>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <b>Umumiy bilim</b> — quyidagi matn: yetkazib berish, ish vaqti, showroom, kafolat, mahsulot tanlash
                bo‘yicha maslahatlar, ko‘p so‘raladigan savollar.
              </li>
              <li>
                <b>Mahsulot bilimi</b> — har bir mahsulot sahifasidagi “AI uchun ma’lumot” maydoni: qaysi xona/yuzaga mos,
                sarfi, afzalliklari, nima bilan birga ishlatiladi.
              </li>
            </ol>
            <p className="mt-3 text-stone-500">
              AI bu ma’lumotlarni mijozlarga javob berishda ishlatadi. Ular saytda ko‘rinmaydi. Narxlarni yozmang — narxni
              menejer aytadi. O‘zgarishlar saqlangandan so‘ng darhol kuchga kiradi.
            </p>
          </Card>
          <KnowledgeForm initial={content.aiKnowledge ?? ''} />
        </div>
        <ProductsTrained content={content} />
      </div>
    </>
  )
}

function KnowledgeForm({ initial }: { initial: string }) {
  const { setContent } = useAdmin()
  const toast = useToast()
  const [saved, setSaved] = useState(initial)
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = text !== saved
  useUnsavedGuard(dirty)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await api.updateAiKnowledge(text)
      setSaved(res.text)
      setText(res.text)
      setContent((c) => ({ ...c, aiKnowledge: res.text }))
      toast.success()
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <div className="grid gap-4 p-4 md:p-5">
          <SectionTitle className="mb-0">Umumiy bilim</SectionTitle>
          <Field
            label="Kompaniya haqida ma’lumot va savol-javoblar"
            hint={`O‘zbek yoki rus tilida yozish mumkin — AI mijoz tilida javob beradi. ${text.length}/${MAX}`}
          >
            {(id) => (
              <Textarea id={id} rows={16} maxLength={MAX} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3 md:px-5">
          {dirty && <span className="mr-auto text-sm text-amber-700">Saqlanmagan o‘zgarishlar</span>}
          <Button disabled={!dirty || saving} onClick={() => setText(saved)}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
            Saqlash
          </Button>
        </div>
      </form>
    </Card>
  )
}

function ProductsTrained({ content }: { content: Content }) {
  const { products } = content
  const trained = products.filter((p) => p.ai?.trim()).length
  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionTitle className="mb-0">Mahsulotlar</SectionTitle>
        <span className="text-sm text-stone-600">
          {trained} / {products.length} mahsulot o‘rgatilgan
        </span>
      </div>
      <ul className="-mx-1 flex flex-col">
        {products.map((p) => {
          const ok = !!p.ai?.trim()
          return (
            <li key={p.slug}>
              <GuardedLink
                to={`/admin/products/${p.slug}`}
                className={cx('flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-stone-50', focusRing)}
              >
                <img src={img(p.image)} alt="" className="size-8 shrink-0 rounded object-cover" loading="lazy" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                {ok ? <Badge tone="green">✓ o‘rgatilgan</Badge> : <Badge>o‘rgatilmagan</Badge>}
              </GuardedLink>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
