import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { Content, Product } from '../src/schemas.js'
import { BACKUPS_KEEP } from '../src/store/content.js'
import { APP_DIR, makeApp, type TestApp } from './helpers.js'

const product = (over: Partial<Product> = {}) => ({
  slug: 'test-paint',
  name: 'Test Paint',
  categories: [1],
  image: 'uploads/images/x.webp',
  gallery: [],
  subtitle: { uz: 'Sinov', ru: 'Тест' },
  description: { uz: 'Tavsif', ru: 'Описание' },
  ...over,
})

describe('content & products', () => {
  let t: TestApp
  let cookie: string
  before(async () => {
    t = await makeApp()
    cookie = await t.login()
  })
  after(() => t.close())

  const backups = async () => (await readdir(path.join(t.dataDir, 'backups')).catch(() => [])).filter((f) => f.endsWith('.json'))
  const publicContent = async () => (await (await t.request('/api/content')).json()) as Content

  test('seeds content.json from src/data/content.json on first run', async () => {
    const seed = JSON.parse(await readFile(path.join(APP_DIR, 'src/data/content.json'), 'utf8')) as Content
    const res = await t.request('/api/content')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-cache')
    const c = (await res.json()) as Content
    for (const k of ['products', 'categories', 'news', 'stats', 'about', 'contacts', 'clients', 'documents']) assert.ok(k in c, k)
    assert.equal(c.products.length, seed.products.length)
    assert.deepEqual(c.products[0], seed.products[0])
    const onDisk = await readFile(path.join(t.dataDir, 'content.json'), 'utf8')
    assert.ok(onDisk.startsWith('{\n "products"'), 'stored with JSON.stringify(d, null, 1)')
  })

  test('create product: server id, 201, counts recomputed, backup written', async () => {
    const before = await publicContent()
    const cat1Before = before.categories.find((c) => c.id === 1)!.count
    const backupsBefore = (await backups()).length

    const res = await t.json('/api/admin/products', 'POST', { ...product(), id: 999 }, { cookie })
    assert.equal(res.status, 201)
    const p = (await res.json()) as Product
    assert.equal(p.slug, 'test-paint')
    assert.equal(p.id, Math.max(...before.products.map((x) => x.id)) + 1)

    const afterC = await publicContent()
    assert.ok(afterC.products.some((x) => x.slug === 'test-paint'))
    assert.equal(afterC.categories.find((c) => c.id === 1)!.count, cat1Before + 1)
    assert.equal((await backups()).length, backupsBefore + 1)
  })

  test('slug uniqueness and validation', async () => {
    const dup = await t.json('/api/admin/products', 'POST', product(), { cookie })
    assert.equal(dup.status, 409)
    assert.ok(((await dup.json()) as { error: string }).error)

    const bad = await t.json('/api/admin/products', 'POST', product({ slug: 'Bad Slug!' }), { cookie })
    assert.equal(bad.status, 400)

    const badCat = await t.json('/api/admin/products', 'POST', product({ slug: 'x-1', categories: [9999] }), { cookie })
    assert.equal(badCat.status, 400)

    const missing = await t.json('/api/admin/products', 'POST', { slug: 'x-2' }, { cookie })
    assert.equal(missing.status, 400)

    const notJson = await t.request('/api/admin/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
      cookie,
    })
    assert.equal(notJson.status, 400)
  })

  test('update with slug rename keeps id and rewrites references; rename onto taken slug → 409', async () => {
    const c0 = await publicContent()
    const existing = c0.products[0]!
    const created = c0.products.find((p) => p.slug === 'test-paint')!

    const clash = await t.json('/api/admin/products/test-paint', 'PUT', product({ slug: existing.slug }), { cookie })
    assert.equal(clash.status, 409)

    // Attach a document and a news item to it, then rename.
    const docFile = c0.documents[0]!.file
    assert.equal((await t.json(`/api/admin/documents/${docFile}`, 'PUT', { products: ['test-paint'] }, { cookie })).status, 200)
    const news = await t.json('/api/admin/news', 'POST', { title: 'N', date: '2026-01-02', image: 'img/x.jpg', product: 'test-paint' }, { cookie })
    assert.equal(news.status, 201)

    const res = await t.json('/api/admin/products/test-paint', 'PUT', product({ slug: 'renamed-paint', name: 'Renamed' }), { cookie })
    assert.equal(res.status, 200)
    const p = (await res.json()) as Product
    assert.equal(p.id, created.id)
    const c1 = await publicContent()
    assert.ok(c1.documents.find((d) => d.file === docFile)!.products.includes('renamed-paint'))
    assert.ok(c1.news.some((n) => n.product === 'renamed-paint'))

    const missing = await t.json('/api/admin/products/nope', 'PUT', product({ slug: 'nope' }), { cookie })
    assert.equal(missing.status, 404)
  })

  test('delete product cleans document/news references', async () => {
    const res = await t.request('/api/admin/products/renamed-paint', { method: 'DELETE', cookie })
    assert.equal(res.status, 200)
    const c = await publicContent()
    assert.ok(!c.products.some((p) => p.slug === 'renamed-paint'))
    assert.ok(!c.documents.some((d) => d.products.includes('renamed-paint')))
    assert.ok(!c.news.some((n) => n.product === 'renamed-paint'))
    assert.equal((await t.request('/api/admin/products/renamed-paint', { method: 'DELETE', cookie })).status, 404)
  })

  test('products order', async () => {
    const c0 = await publicContent()
    const last = c0.products.at(-1)!.slug
    const res = await t.json('/api/admin/products-order', 'PUT', { slugs: [last] }, { cookie })
    assert.equal(res.status, 200)
    const c1 = await publicContent()
    assert.equal(c1.products[0]!.slug, last)
    assert.equal(c1.products.length, c0.products.length)
    assert.equal((await t.json('/api/admin/products-order', 'PUT', { slugs: ['ghost'] }, { cookie })).status, 400)
  })

  test('categories: create/update, count is server-computed, used category cannot be deleted', async () => {
    const res = await t.json('/api/admin/categories', 'POST', { name: { uz: 'Yangi', ru: 'Новая' }, image: 'img/c.jpg', count: 77 }, { cookie })
    assert.equal(res.status, 201)
    const cat = (await res.json()) as { id: number; count: number }
    assert.equal(cat.count, 0)
    const upd = await t.json(`/api/admin/categories/${cat.id}`, 'PUT', { name: { uz: 'Yangi2', ru: 'Новая2' }, image: 'img/c.jpg' }, { cookie })
    assert.equal(upd.status, 200)
    assert.equal(((await upd.json()) as { name: { uz: string } }).name.uz, 'Yangi2')

    const used = await t.request('/api/admin/categories/1', { method: 'DELETE', cookie })
    assert.equal(used.status, 409)
    const del = await t.request(`/api/admin/categories/${cat.id}`, { method: 'DELETE', cookie })
    assert.equal(del.status, 200)
  })

  test('contacts and about', async () => {
    const contacts = {
      phone: '+998 (90) 111 22 33',
      email: 'a@b.uz',
      address: { uz: 'Toshkent', ru: 'Ташкент' },
      telegram: 'https://t.me/x',
      instagram: 'https://instagram.com/x',
      map: 'https://yandex.uz/map',
    }
    const res = await t.json('/api/admin/contacts', 'PUT', contacts, { cookie })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { phoneHref: string }).phoneHref, 'tel:+998901112233')
    const about = { lead: { uz: 'a', ru: 'б' }, extra: { uz: 'c', ru: 'д' } }
    assert.equal((await t.json('/api/admin/about', 'PUT', about, { cookie })).status, 200)
    const c = await publicContent()
    assert.deepEqual(c.about, about)
    assert.equal(c.contacts.email, 'a@b.uz')
  })

  test(`backups are capped at ${BACKUPS_KEEP}`, async () => {
    for (let i = 0; i < BACKUPS_KEEP + 3; i++) {
      const r = await t.json('/api/admin/about', 'PUT', { lead: { uz: `v${i}`, ru: 'б' }, extra: { uz: 'c', ru: 'д' } }, { cookie })
      assert.equal(r.status, 200)
    }
    assert.equal((await backups()).length, BACKUPS_KEEP)
  })

  test('stats', async () => {
    const res = await t.request('/api/admin/stats', { cookie })
    const s = (await res.json()) as Record<string, number>
    const c = await publicContent()
    assert.equal(s.products, c.products.length)
    assert.equal(s.documents, c.documents.length)
    assert.equal(typeof s.leadsNew, 'number')
    assert.equal(typeof s.chatsToday, 'number')
  })
})
