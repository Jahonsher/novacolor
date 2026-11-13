import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import sharp from 'sharp'
import type { Doc } from '../src/schemas.js'
import { safeJoin } from '../src/static.js'
import { sniffImage } from '../src/uploads.js'
import { APP_DIR, makeApp, type TestApp } from './helpers.js'

const form = (file: Blob, name: string, fields: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append('file', file, name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

describe('uploads', () => {
  let t: TestApp
  let cookie: string
  before(async () => {
    t = await makeApp()
    cookie = await t.login()
  })
  after(() => t.close())

  const upload = (p: string, body: FormData) => t.request(p, { method: 'POST', body, cookie })

  test('already-small jpg (webp would be bigger) is kept as is, served with immutable cache', async () => {
    // 94 KB, 1080×1170, no EXIF: as WebP q82 it would be ~103 KB
    const jpg = await readFile(path.join(APP_DIR, 'public/img/products/africa-1.jpg'))
    const res = await upload('/api/admin/upload/image', form(new Blob([jpg], { type: 'image/jpeg' }), 'photo.jpg'))
    assert.equal(res.status, 201)
    const body = (await res.json()) as { path: string; width: number; height: number }
    assert.match(body.path, /^uploads\/images\/[a-z0-9-]+\.jpg$/)
    assert.deepEqual([body.width, body.height], [1080, 1170])
    const served = await t.request(`/${body.path}`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/jpeg')
    assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), jpg)
  })

  test('jpg with EXIF (e.g. GPS) is never kept as is: re-encoded to webp, metadata stripped', async () => {
    const jpg = await sharp(await readFile(path.join(APP_DIR, 'public/img/products/africa-1.jpg')))
      .withExif({ IFD0: { Copyright: 'secret-location' } })
      .jpeg({ quality: 70 })
      .toBuffer()
    assert.ok((await sharp(jpg).metadata()).exif)
    const res = await upload('/api/admin/upload/image', form(new Blob([jpg]), 'exif.jpg'))
    assert.equal(res.status, 201)
    const body = (await res.json()) as { path: string }
    assert.match(body.path, /\.webp$/)
    const stored = await readFile(path.join(t.dataDir, body.path))
    assert.equal((await sharp(stored).metadata()).exif, undefined)
  })

  test('jpg → webp when webp is smaller (≤ 2000px)', async () => {
    const jpg = await sharp(await readFile(path.join(APP_DIR, 'public/img/products/africa-1.jpg'))).jpeg({ quality: 100 }).toBuffer()
    const res = await upload('/api/admin/upload/image', form(new Blob([jpg], { type: 'image/jpeg' }), 'photo.jpg'))
    assert.equal(res.status, 201)
    const body = (await res.json()) as { path: string; width: number; height: number }
    assert.match(body.path, /^uploads\/images\/[a-z0-9-]+\.webp$/)
    assert.ok(body.width > 0 && body.width <= 2000 && body.height <= 2000)

    const served = await t.request(`/${body.path}`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/webp')
    assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const bytes = new Uint8Array(await served.arrayBuffer())
    assert.equal(sniffImage(bytes), 'webp')
  })

  test('large png is downscaled to 2000px', async () => {
    const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#c33' } }).png().toBuffer()
    const res = await upload('/api/admin/upload/image', form(new Blob([png]), 'big.png'))
    assert.equal(res.status, 201)
    const body = (await res.json()) as { width: number; height: number }
    assert.deepEqual([body.width, body.height], [2000, 1000])
  })

  test('rejects non-images by magic bytes (extension / mime are ignored)', async () => {
    const fake = new Blob(['<?php echo 1; ?>'], { type: 'image/jpeg' })
    const r1 = await upload('/api/admin/upload/image', form(fake, 'evil.jpg'))
    assert.equal(r1.status, 400)
    assert.ok(((await r1.json()) as { error: string }).error)

    const gif = new Blob([Buffer.from('GIF89a......')], { type: 'image/gif' })
    assert.equal((await upload('/api/admin/upload/image', form(gif, 'a.gif'))).status, 400)

    // Valid PNG signature but garbage body → sharp fails → 400, not 500.
    const broken = new Blob([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])])
    assert.equal((await upload('/api/admin/upload/image', form(broken, 'b.png'))).status, 400)

    const noFile = new FormData()
    noFile.append('other', 'x')
    assert.equal((await upload('/api/admin/upload/image', noFile)).status, 400)
  })

  test('uploads require auth', async () => {
    const res = await t.request('/api/admin/upload/image', { method: 'POST', body: form(new Blob(['x']), 'a.jpg') })
    assert.equal(res.status, 401)
  })

  test('PDF documents: %PDF required; create, update meta, delete removes file', async () => {
    const notPdf = await upload(
      '/api/admin/documents',
      form(new Blob(['hello'], { type: 'application/pdf' }), 'x.pdf', { title_uz: 'A', title_ru: 'Б', group: 'company' }),
    )
    assert.equal(notPdf.status, 400)

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    const product = t.ctx.content.get().products[0]!.slug
    const res = await upload(
      '/api/admin/documents',
      form(new Blob([pdf]), 'Sertifikat ISO 9001.pdf', {
        title_uz: 'Sertifikat',
        title_ru: 'Сертификат',
        group: 'product',
        products: JSON.stringify([product]),
      }),
    )
    assert.equal(res.status, 201)
    const doc = (await res.json()) as Doc
    assert.equal(doc.file, 'sertifikat-iso-9001.pdf')
    assert.equal(doc.path, 'uploads/pdf/sertifikat-iso-9001.pdf')
    assert.deepEqual(doc.products, [product])
    assert.equal(doc.size, 1)
    const onDisk = path.join(t.dataDir, 'uploads/pdf/sertifikat-iso-9001.pdf')
    assert.ok(existsSync(onDisk))
    const served = await t.request(`/${doc.path}`)
    assert.equal(served.headers.get('content-type'), 'application/pdf')

    // Same name again → unique file name.
    const again = await upload('/api/admin/documents', form(new Blob([pdf]), 'Sertifikat ISO 9001.pdf', { title_uz: 'a', title_ru: 'b', group: 'company' }))
    assert.equal(((await again.json()) as Doc).file, 'sertifikat-iso-9001-2.pdf')

    const badProducts = await upload('/api/admin/documents', form(new Blob([pdf]), 'z.pdf', { title_uz: 'a', title_ru: 'b', group: 'company', products: '["ghost"]' }))
    assert.equal(badProducts.status, 400)

    const upd = await t.json(`/api/admin/documents/${doc.file}`, 'PUT', { title: { uz: 'Yangi', ru: 'Новый' }, group: 'epd' }, { cookie })
    assert.equal(upd.status, 200)
    const u = (await upd.json()) as Doc
    assert.equal(u.group, 'epd')
    assert.equal(u.title.uz, 'Yangi')

    assert.equal((await t.request(`/api/admin/documents/${doc.file}`, { method: 'DELETE', cookie })).status, 200)
    assert.ok(!existsSync(onDisk))
    assert.ok(!t.ctx.content.get().documents.some((d) => d.file === doc.file))
  })

  test('path traversal on /uploads is blocked', async () => {
    await writeFile(path.join(t.dataDir, 'secret.txt'), 'TOP-SECRET')
    const attempts = [
      '/uploads/../secret.txt',
      '/uploads/%2e%2e/secret.txt',
      '/uploads/..%2fsecret.txt',
      '/uploads/images/..%2f..%2fsecret.txt',
      '/uploads/%2e%2e%2f%2e%2e%2fcontent.json',
      '/uploads/..%5csecret.txt',
      '/uploads/%00secret.txt',
      '/uploads/%2fetc%2fpasswd',
      '/uploads/.%2e/settings.json',
    ]
    for (const p of attempts) {
      const res = await t.request(p)
      const text = await res.text()
      assert.ok(!text.includes('TOP-SECRET') && !text.includes('sessionSecret') && !text.includes('"products"'), p)
      assert.notEqual(res.status, 200, p)
    }
    assert.equal(safeJoin('/data/uploads', '../x'), null)
    assert.equal(safeJoin('/data/uploads', '%2e%2e/x'), null)
    assert.equal(safeJoin('/data/uploads', 'images/a.webp'), path.resolve('/data/uploads/images/a.webp'))
  })
})

describe('static site', () => {
  let t: TestApp
  before(async () => {
    t = await makeApp()
  })
  after(() => t.close())

  test('SPA fallback, caching headers, API 404', async () => {
    const root = await t.request('/')
    assert.equal(root.status, 200)
    assert.equal(root.headers.get('cache-control'), 'no-cache')
    assert.match(await root.text(), /NovaColor/)

    for (const p of ['/admin', '/admin/leads', '/products/africa', '/index.html']) {
      const r = await t.request(p)
      assert.equal(r.status, 200, p)
      assert.equal(r.headers.get('cache-control'), 'no-cache', p)
    }

    const asset = await t.request('/assets/app-abc123.js')
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.match(asset.headers.get('content-type') ?? '', /javascript/)

    assert.equal((await t.request('/img/missing.jpg')).status, 404)
    const api = await t.request('/api/nope')
    assert.equal(api.status, 404)
    assert.ok(((await api.json()) as { error: string }).error)
  })
})
