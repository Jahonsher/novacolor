#!/usr/bin/env node
/**
 * Merges the Novacolor PDF catalogs update (server/scripts/catalogs-update.json) into a content.json:
 *   - new products (added only if the slug does not exist yet; inserted next to their category),
 *   - extra gallery images for existing products (only missing paths are appended),
 *   - certificate ↔ product links in `documents`,
 *   - the "Matt" category image (only while it is still the old default),
 *   - the `catalogs` list (missing entries are added; entries already present are left as they are).
 * Category `count`s are recomputed. Running it twice changes nothing the second time (idempotent).
 *
 * Usage:
 *   node server/scripts/merge-catalogs.mjs [content.json] [--dry-run] [--no-backup] [--force]
 *   default file: $DATA_DIR/content.json, else <repo>/data/content.json
 *
 * IMPORTANT: stop the server first. It keeps content in memory and would overwrite the file on the next
 * admin save (and refuses nothing). The script checks http://127.0.0.1:$PORT/api/health and stops unless --force.
 * A copy of the file is written to <dir>/backups/content-<time>-before-catalogs.json first (unless --no-backup).
 *
 * Kataloglar yangilanishini content.json'ga qo'shadi. Avval serverni to'xtating! Batafsil: DEPLOY.md.
 */
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const target = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(process.env.DATA_DIR ? path.resolve(repo, process.env.DATA_DIR) : path.join(repo, 'data'), 'content.json'))
const dryRun = flag('--dry-run')

const update = JSON.parse(await readFile(path.join(here, 'catalogs-update.json'), 'utf8'))
const raw = await readFile(target, 'utf8')
const content = JSON.parse(raw)

if (!dryRun && !flag('--force')) {
  const port = process.env.PORT || 8080
  const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then(
    (r) => r.ok,
    () => false,
  )
  if (running) {
    console.error(`XATO: server ishlayapti (http://127.0.0.1:${port}). Avval uni to'xtating, so'ng qayta ishga tushiring (yoki --force).`)
    process.exit(1)
  }
}

const log = []
const products = content.products
const bySlug = () => new Map(products.map((p) => [p.slug, p]))

// 1. new products
let nextId = Math.max(0, ...products.map((p) => p.id)) + 1
for (const np of update.newProducts) {
  if (bySlug().has(np.slug)) continue
  const { after, ...fields } = np
  const categories = fields.categories.filter((id) => content.categories.some((c) => c.id === id))
  if (!categories.length) {
    log.push(`! ${np.slug}: kategoriya topilmadi (${fields.categories.join(',')}) — o'tkazib yuborildi`)
    continue
  }
  const product = { id: nextId++, ...fields, categories }
  let at = products.findIndex((p) => p.slug === after)
  if (at < 0) at = products.findLastIndex((p) => p.categories.includes(categories[0]))
  products.splice(at < 0 ? products.length : at + 1, 0, product)
  log.push(`+ mahsulot: ${np.slug}`)
}

// 2. gallery images of existing products
for (const [slug, images] of Object.entries(update.galleryAdditions)) {
  const p = bySlug().get(slug)
  if (!p) continue
  p.gallery ??= []
  const add = images.filter((g) => !p.gallery.includes(g))
  if (add.length) {
    p.gallery.push(...add)
    log.push(`+ galereya ${slug}: ${add.length} ta rasm`)
  }
}

// 3. certificates ↔ products
const known = bySlug()
for (const [file, slugs] of Object.entries(update.documentLinks)) {
  const d = content.documents?.find((x) => x.file === file)
  if (!d) continue
  const add = slugs.filter((s) => known.has(s) && !d.products.includes(s))
  if (add.length) {
    d.products.push(...add)
    log.push(`+ hujjat ${file}: ${add.join(', ')}`)
  }
}

// 4. category images (only the untouched default)
for (const { id, from, to } of update.categoryImages) {
  const c = content.categories.find((x) => x.id === id)
  if (c && c.image === from) {
    c.image = to
    log.push(`~ kategoriya ${id} rasmi: ${to}`)
  }
}

// 5. catalogs
content.catalogs ??= []
for (const cat of update.catalogs) {
  if (content.catalogs.some((x) => x.file === cat.file)) continue
  content.catalogs.push({ ...cat, products: cat.products.filter((s) => known.has(s)) })
  log.push(`+ katalog: ${cat.file}`)
}

// category counts (the server recomputes them too)
for (const c of content.categories) c.count = products.filter((p) => p.categories.includes(c.id)).length

if (!log.length) {
  console.log(`${target}: o'zgarish yo'q (allaqachon qo'shilgan).`)
  process.exit(0)
}
console.log(log.join('\n'))
console.log(`Jami: ${products.length} mahsulot, ${content.catalogs.length} katalog. Kategoriyalar: ${content.categories.map((c) => `${c.name.uz} ${c.count}`).join(', ')}`)
if (dryRun) {
  console.log('--dry-run: fayl o\'zgartirilmadi.')
  process.exit(0)
}

if (!flag('--no-backup')) {
  const dir = path.join(path.dirname(target), 'backups')
  await mkdir(dir, { recursive: true })
  const backup = path.join(dir, `content-${new Date().toISOString().replace(/[:.]/g, '-')}-before-catalogs.json`)
  await copyFile(target, backup)
  console.log(`Zaxira: ${backup}`)
}
// same layout the server writes (1-space indent); keep a trailing newline only if the file had one
const out = JSON.stringify(content, null, 1) + (raw.endsWith('\n') ? '\n' : '')
const tmp = `${target}.tmp-${process.pid}`
await writeFile(tmp, out, { mode: (await stat(target)).mode & 0o777 })
await rename(tmp, target)
console.log(`Yozildi: ${target}`)
