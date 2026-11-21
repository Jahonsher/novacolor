import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { after, before, describe, test } from 'node:test'
import type { Content } from '../src/schemas.js'
import { ContentStore } from '../src/store/content.js'
import { APP_DIR, makeApp, type TestApp } from './helpers.js'

const SEED = path.join(APP_DIR, 'src/data/content.json')
const run = promisify(execFile)

/** The seed as an installation from before the catalogs update had it: no catalogs, none of the new products. */
async function oldContent() {
  const seed = JSON.parse(await readFile(SEED, 'utf8')) as Content & Record<string, unknown>
  const update = JSON.parse(await readFile(path.join(APP_DIR, 'server/scripts/catalogs-update.json'), 'utf8')) as {
    newProducts: { slug: string }[]
    galleryAdditions: Record<string, string[]>
  }
  const added = new Set(update.newProducts.map((p) => p.slug))
  delete seed.catalogs
  seed.products = seed.products.filter((p) => !added.has(p.slug))
  for (const p of seed.products) p.gallery = p.gallery.filter((g) => !update.galleryAdditions[p.slug]?.includes(g))
  for (const d of seed.documents) d.products = d.products.filter((s) => !added.has(s))
  seed.categories.find((c) => c.id === 6)!.image = 'img/products/supremematt.jpg'
  return seed
}

describe('catalogs', () => {
  let t: TestApp
  let cookie: string
  before(async () => {
    t = await makeApp()
    cookie = await t.login()
  })
  after(() => t.close())

  test('seed has catalogs; /api/content returns them; every file has a PDF and a cover', async () => {
    const c = (await (await t.request('/api/content')).json()) as Content
    assert.ok(c.catalogs.length > 30)
    const slugs = new Set(c.products.map((p) => p.slug))
    for (const k of c.catalogs) {
      for (const s of k.products) assert.ok(slugs.has(s), `${k.file}: unknown product ${s}`)
      await readFile(path.join(APP_DIR, 'public/pdf/catalogs', k.file))
      await readFile(path.join(APP_DIR, 'public/img/catalogs', k.file.replace(/\.pdf$/, '.jpg')))
    }
  })

  test('product rename / delete rewrite catalog links', async () => {
    const c = (await (await t.request('/api/content')).json()) as Content
    const p = c.products.find((x) => x.slug === 'zeus')!
    let r = await t.json('/api/admin/products/zeus', 'PUT', { ...p, slug: 'zeus-2' }, { cookie })
    assert.equal(r.status, 200)
    let k = t.ctx.content.get().catalogs.find((x) => x.file === 'zeus.pdf')!
    assert.deepEqual(k.products, ['zeus-2'])
    r = await t.request('/api/admin/products/zeus-2', { method: 'DELETE', cookie })
    assert.equal(r.status, 200)
    k = t.ctx.content.get().catalogs.find((x) => x.file === 'zeus.pdf')!
    assert.deepEqual(k.products, [])
  })
})

describe('catalogs: older content.json', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nc-catalogs-'))
  })
  after(() => rm(dir, { recursive: true, force: true }))

  test('without a `catalogs` key the store takes the seed list once (links to missing products dropped, backup kept)', async () => {
    const data = path.join(dir, 'store')
    await mkdir(data, { recursive: true })
    await writeFile(path.join(data, 'content.json'), JSON.stringify(await oldContent()))
    const store = new ContentStore(data, SEED)
    await store.init()
    const cat = store.get().catalogs
    assert.ok(cat.length > 30)
    assert.deepEqual(cat.find((k) => k.file === 'r-stone.pdf')!.products, []) // product not installed
    assert.deepEqual(cat.find((k) => k.file === 'africa.pdf')!.products, ['africa'])
    assert.equal((await readdir(path.join(data, 'backups'))).length, 1)
    // second start: nothing to migrate
    const again = new ContentStore(data, SEED)
    await again.init()
    assert.equal((await readdir(path.join(data, 'backups'))).length, 1)
  })

  test('merge-catalogs.mjs: adds products, gallery, links and catalogs; idempotent; backup first', async () => {
    const data = path.join(dir, 'merge')
    await mkdir(data, { recursive: true })
    const file = path.join(data, 'content.json')
    const old = await oldContent()
    await writeFile(file, JSON.stringify(old, null, 1))
    const script = path.join(APP_DIR, 'server/scripts/merge-catalogs.mjs')
    await run(process.execPath, [script, file, '--force'])
    const merged = JSON.parse(await readFile(file, 'utf8')) as Content
    const seed = JSON.parse(await readFile(SEED, 'utf8')) as Content
    assert.deepEqual(
      merged.products.map((p) => p.slug),
      seed.products.map((p) => p.slug),
    )
    assert.deepEqual(
      merged.products.map((p) => p.gallery),
      seed.products.map((p) => p.gallery),
    )
    assert.deepEqual(merged.catalogs, seed.catalogs)
    assert.deepEqual(merged.documents, seed.documents)
    assert.deepEqual(merged.categories, seed.categories)
    assert.equal((await readdir(path.join(data, 'backups'))).length, 1)
    // second run: no change, no new backup
    const before = await readFile(file, 'utf8')
    const { stdout } = await run(process.execPath, [script, file, '--force'])
    assert.match(stdout, /o'zgarish yo'q/)
    assert.equal(await readFile(file, 'utf8'), before)
    assert.equal((await readdir(path.join(data, 'backups'))).length, 1)
    // the server accepts the result
    const store = new ContentStore(data, SEED)
    await store.init()
    assert.equal(store.get().products.length, seed.products.length)
  })
})
