import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import sharp from 'sharp'
import { contentSchema, instagramShortcode, videoInput, type Video } from '../src/schemas.js'
import { parseRange } from '../src/static.js'
import { sniffImage } from '../src/uploads.js'
import { receiveFile, sniffVideo } from '../src/video.js'
import { ContentStore } from '../src/store/content.js'
import { APP_DIR, makeApp, waitFor, type TestApp } from './helpers.js'

/** Minimal ISO-BMFF header: `ftyp` box with the given major brand, then filler. */
const ftyp = (brand: string, size = 4096) => {
  const b = Buffer.alloc(size, 0x11)
  b.writeUInt32BE(24, 0)
  b.write('ftyp', 4, 'latin1')
  b.write(brand, 8, 'latin1')
  b.writeUInt32BE(0x200, 12)
  b.write('isommp41', 16, 'latin1')
  return b
}
const MP4 = ftyp('isom')
const MOV = ftyp('qt  ')
const HEIC = ftyp('heic')
const ebml = (docType: string) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from(docType), Buffer.alloc(2000, 0x22)])
const WEBM = ebml('webm')
const MKV = ebml('matroska')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500)])

const form = (bytes: Buffer, name: string) => {
  const fd = new FormData()
  fd.append('file', new Blob([bytes]), name)
  return fd
}

const IG = 'https://www.instagram.com/p/DcdNuX_tz1J/'
const title = { uz: 'Sinov', ru: 'Тест' }

describe('video schema', () => {
  test('instagram links are normalized to https://www.instagram.com/p/<id>/', () => {
    const ok = [
      'https://www.instagram.com/p/DcdNuX_tz1J/',
      'https://www.instagram.com/p/DcdNuX_tz1J',
      'https://instagram.com/reel/DcdNuX_tz1J/?igsh=abc123',
      'https://www.instagram.com/reels/DcdNuX_tz1J/',
      'https://www.instagram.com/tv/DcdNuX_tz1J/#x',
      'https://www.instagram.com/novacolor.uz/reel/DcdNuX_tz1J/',
      '  https://www.instagram.com/p/DcdNuX_tz1J/?img_index=1  ',
    ]
    for (const url of ok) {
      const r = videoInput.safeParse({ title, instagram: url })
      assert.ok(r.success, url)
      assert.equal(r.data.instagram, IG, url)
    }
    const bad = [
      'http://www.instagram.com/p/DcdNuX_tz1J/',
      'https://www.instagram.com/novacolor.uz/',
      'https://evil.com/p/DcdNuX_tz1J/',
      'https://www.instagram.com.evil.com/p/DcdNuX_tz1J/',
      'https://www.instagram.com/stories/novacolor.uz/123/',
      'javascript:alert(1)//instagram.com/p/DcdNuX_tz1J/',
      'https://www.instagram.com/p/<script>/',
    ]
    for (const url of bad) assert.equal(videoInput.safeParse({ title, instagram: url }).success, false, url)
    assert.equal(instagramShortcode('https://www.instagram.com/p/Dee5vk1sJxE/'), 'Dee5vk1sJxE')
  })

  test('src / poster paths, either src or instagram, optional fields', () => {
    assert.ok(videoInput.safeParse({ title, src: 'uploads/videos/abc-123.mp4' }).success)
    assert.ok(videoInput.safeParse({ title, src: 'video/showroom.webm' }).success)
    for (const src of ['uploads/videos/../content.json', 'https://x.com/a.mp4', 'uploads/images/a.webp', 'video/a.mp4.exe', 'uploads/videos/a b.mp4']) {
      assert.equal(videoInput.safeParse({ title, src }).success, false, src)
    }
    assert.equal(videoInput.safeParse({ title }).success, false, 'needs src or instagram')
    assert.equal(videoInput.safeParse({ title, src: '', instagram: '' }).success, false)
    assert.equal(videoInput.safeParse({ title, instagram: IG, poster: 'javascript:alert(1)' }).success, false)
    assert.equal(videoInput.safeParse({ title: { uz: '', ru: 'x' }, instagram: IG }).success, false, 'uz title required')
    assert.equal(videoInput.safeParse({ title, instagram: IG, date: '14.11.2026' }).success, false)
    const r = videoInput.parse({ title: { uz: 'A', ru: '' }, instagram: IG, poster: '', date: '', product: '' })
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { title: { uz: 'A', ru: '' }, instagram: IG, product: null })
  })

  test('content.json written before videos existed still loads (videos = [])', () => {
    const old = { products: [], categories: [], news: [], stats: [], about: { lead: { uz: '', ru: '' }, extra: { uz: '', ru: '' } }, clients: [], documents: [] }
    const contacts = { phone: '1', phoneHref: '', email: '', address: { uz: '', ru: '' }, telegram: '', instagram: '', map: '' }
    assert.deepEqual(contentSchema.parse({ ...old, contacts }).videos, [])
  })

  test('existing content.json without `videos` takes the seed videos once (and keeps an emptied list)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nc-mig-'))
    try {
      const seedFile = path.join(APP_DIR, 'src/data/content.json')
      const seed = JSON.parse(await readFile(seedFile, 'utf8')) as Record<string, unknown> & { videos: Video[] }
      const { videos: seedVideos, ...old } = seed
      await writeFile(path.join(dir, 'content.json'), JSON.stringify(old))
      const store = new ContentStore(dir, seedFile)
      await store.init()
      assert.deepEqual(store.get().videos, seedVideos)
      assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'content.json'), 'utf8')).videos, seedVideos)
      await store.mutate((d) => {
        d.videos = []
      })
      const again = new ContentStore(dir, seedFile)
      await again.init()
      assert.deepEqual(again.get().videos, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('magic bytes', () => {
    assert.equal(sniffVideo(MP4), 'mp4')
    assert.equal(sniffVideo(ftyp('mp42')), 'mp4')
    assert.equal(sniffVideo(MOV), 'mov')
    assert.equal(sniffVideo(WEBM), 'webm')
    assert.equal(sniffVideo(MKV), null)
    assert.equal(sniffVideo(HEIC), null)
    assert.equal(sniffVideo(ftyp('avif')), null)
    assert.equal(sniffVideo(PNG), null)
    assert.equal(sniffVideo(Buffer.from('ftyp')), null)
  })

  test('range parsing', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 })
    assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 })
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 })
    assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999 })
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable')
    assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable')
    assert.equal(parseRange('bytes=0-1,5-6', 1000), null)
    assert.equal(parseRange('bytes=5-1', 1000), null)
    assert.equal(parseRange('items=0-1', 1000), null)
    assert.equal(parseRange(undefined, 1000), null)
  })
})

describe('streaming multipart receiver', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nc-mp-'))
  })
  after(() => rm(dir, { recursive: true, force: true }))

  /** A multipart request whose body arrives in `chunk`-byte pieces (boundaries split across chunks). */
  const chunked = async (fd: FormData, chunk: number, headers: Record<string, string> = {}) => {
    const r = new Request('http://x/', { method: 'POST', body: fd })
    const bytes = new Uint8Array(await r.arrayBuffer())
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i >= bytes.length) return ctrl.close()
        ctrl.enqueue(bytes.slice(i, i + chunk))
        i += chunk
      },
    })
    return new Request('http://x/', {
      method: 'POST',
      body,
      headers: { 'content-type': r.headers.get('content-type')!, ...headers },
      duplex: 'half',
    } as RequestInit)
  }
  const opts = (maxBytes = 1 << 20) => ({ dir, maxBytes, what: 'Video', sniff: sniffVideo, badType: 'bad type' })

  test('file + fields survive any chunking; the stored bytes are exact', async () => {
    const payload = Buffer.concat([MP4, Buffer.from('\r\n--not-the-boundary\r\n'), Buffer.alloc(3000, 0x2d)])
    for (const size of [1, 7, 64, 1000, 1 << 16]) {
      const fd = new FormData()
      fd.append('note', 'salom')
      fd.append('file', new Blob([payload]), 'clip.mp4')
      fd.append('after', 'x')
      const got = await receiveFile(await chunked(fd, size), opts())
      assert.equal(got.kind, 'mp4')
      assert.equal(got.name, 'clip.mp4')
      assert.equal(got.bytes, payload.length)
      assert.deepEqual(got.fields, { note: 'salom', after: 'x' })
      assert.deepEqual(await readFile(got.tmp), payload, `chunk ${size}`)
      assert.match(path.basename(got.tmp), /^\.upload-/)
      await rm(got.tmp)
    }
  })

  test('limits and errors leave no temp files', async () => {
    const big = Buffer.concat([MP4, Buffer.alloc(5000)])
    await assert.rejects(receiveFile(await chunked(form(big, 'a.mp4'), 512), opts(4000)), { status: 413 })
    // declared Content-Length over the limit: refused before reading
    await assert.rejects(receiveFile(await chunked(form(MP4, 'a.mp4'), 512, { 'content-length': String(50 << 20) }), opts()), { status: 413 })
    await assert.rejects(receiveFile(await chunked(form(PNG, 'a.mp4'), 100), opts()), { status: 400, message: 'bad type' })
    await assert.rejects(receiveFile(await chunked(form(Buffer.alloc(0), 'a.mp4'), 100), opts()), { status: 400 })
    const noFile = new FormData()
    noFile.append('x', 'y')
    await assert.rejects(receiveFile(await chunked(noFile, 100), opts()), { status: 400 })
    // truncated body
    const full = await chunked(form(MP4, 'a.mp4'), 1 << 20)
    const bytes = new Uint8Array(await full.arrayBuffer())
    const cut = new Request('http://x/', { method: 'POST', body: bytes.slice(0, 2000), headers: { 'content-type': full.headers.get('content-type')! } })
    await assert.rejects(receiveFile(cut, opts()), { status: 400 })
    await assert.rejects(receiveFile(new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-type': 'application/json' } }), opts()), { status: 400 })
    assert.deepEqual(await readdir(dir), [])
  })
})

describe('videos (admin API, no ffmpeg)', () => {
  let t: TestApp
  let cookie: string
  before(async () => {
    t = await makeApp()
    cookie = await t.login()
  })
  after(() => t.close())

  const upload = (bytes: Buffer, name: string) => t.request('/api/admin/upload/video', { method: 'POST', body: form(bytes, name), cookie })
  type Uploaded = { path: string; poster: string | null; bytes: number; type: string; processing: boolean }

  test('seed content has the videos array and /api/content returns it', async () => {
    const c = (await (await t.request('/api/content')).json()) as { videos: Video[] }
    assert.ok(Array.isArray(c.videos))
  })

  test('auth and CSRF apply', async () => {
    assert.equal((await upload(MP4, 'a.mp4')).status, 201)
    const anon = await t.request('/api/admin/upload/video', { method: 'POST', body: form(MP4, 'a.mp4') })
    assert.equal(anon.status, 401)
    assert.equal((await t.json('/api/admin/videos', 'POST', { title, instagram: IG })).status, 401)
    const foreign = await t.json('/api/admin/videos', 'POST', { title, instagram: IG }, { cookie, headers: { origin: 'https://evil.example' } })
    assert.equal(foreign.status, 403)
  })

  test('upload: magic bytes decide (name/extension ignored), stored under uploads/videos', async () => {
    for (const [bytes, name] of [
      [PNG, 'fake.mp4'],
      [HEIC, 'photo.mov'],
      [MKV, 'clip.webm'],
      [Buffer.from('hello world, definitely not a video file at all, padding padding padding'), 'x.mp4'],
    ] as const) {
      const res = await upload(bytes, name)
      assert.equal(res.status, 400, name)
      assert.match(((await res.json()) as { error: string }).error, /MP4, MOV yoki WEBM/)
    }
    for (const [bytes, type] of [
      [MP4, 'mp4'],
      [MOV, 'mov'],
      [WEBM, 'webm'],
    ] as const) {
      const res = await upload(bytes, 'whatever.bin')
      assert.equal(res.status, 201)
      const body = (await res.json()) as Uploaded
      assert.match(body.path, new RegExp(`^uploads/videos/[a-z0-9]+-[a-f0-9]{10}\\.${type}$`))
      assert.deepEqual([body.type, body.bytes, body.poster, body.processing], [type, bytes.length, null, false])
      assert.deepEqual(await readFile(path.join(t.dataDir, body.path)), bytes)
    }
    // no temp files left behind
    const left = (await readdir(path.join(t.dataDir, 'uploads/videos'))).filter((f) => f.startsWith('.'))
    assert.deepEqual(left, [])
  })

  test('upload over 200 MB (declared) → 413 without reading the body', async () => {
    const res = await t.request('/api/admin/upload/video', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'multipart/form-data; boundary=xyz', 'content-length': String(250 * 1024 * 1024) },
      body: '--xyz--',
    })
    assert.equal(res.status, 413)
  })

  test('served with Range support (206 / 416), immutable cache, video/mp4', async () => {
    const bytes = Buffer.concat([MP4, Buffer.from(Array.from({ length: 10000 }, (_, i) => i % 251))])
    const { path: p } = (await (await upload(bytes, 'r.mp4')).json()) as Uploaded
    const full = await t.request(`/${p}`)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(full.headers.get('content-type'), 'video/mp4')
    assert.equal(full.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(full.headers.get('content-encoding'), null)
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)

    const part = await t.request(`/${p}`, { headers: { range: 'bytes=100-199', 'accept-encoding': 'gzip' } })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), `bytes 100-199/${bytes.length}`)
    assert.equal(part.headers.get('content-length'), '100')
    assert.equal(part.headers.get('content-encoding'), null)
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200))

    // what Safari sends first
    const probe = await t.request(`/${p}`, { headers: { range: 'bytes=0-1' } })
    assert.equal(probe.status, 206)
    assert.deepEqual(Buffer.from(await probe.arrayBuffer()), bytes.subarray(0, 2))

    const tail = await t.request(`/${p}`, { headers: { range: 'bytes=-10' } })
    assert.equal(tail.status, 206)
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(bytes.length - 10))

    const open = await t.request(`/${p}`, { headers: { range: `bytes=${bytes.length - 5}-` } })
    assert.equal(open.headers.get('content-range'), `bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}`)

    const bad = await t.request(`/${p}`, { headers: { range: `bytes=${bytes.length}-` } })
    assert.equal(bad.status, 416)
    assert.equal(bad.headers.get('content-range'), `bytes */${bytes.length}`)

    const head = await t.request(`/${p}`, { method: 'HEAD', headers: { range: 'bytes=0-9' } })
    assert.equal(head.status, 206)
    assert.equal(head.headers.get('content-length'), '10')

    // If-Range with another date → whole file; with the current one → the range
    const stale = await t.request(`/${p}`, { headers: { range: 'bytes=0-9', 'if-range': 'Wed, 01 Jan 2020 00:00:00 GMT' } })
    assert.equal(stale.status, 200)
    const fresh = await t.request(`/${p}`, { headers: { range: 'bytes=0-9', 'if-range': full.headers.get('last-modified')! } })
    assert.equal(fresh.status, 206)

    // the built site's static files honour ranges too (public/video/*.mp4)
    await writeFile(path.join(t.staticDir, 'clip.mp4'), bytes)
    const site = await t.request('/clip.mp4', { headers: { range: 'bytes=0-3' } })
    assert.equal(site.status, 206)
    assert.equal(site.headers.get('content-type'), 'video/mp4')
  })

  test('CRUD: instagram item, uploaded file item, product links, order, delete removes files', async () => {
    const products = t.ctx.content.get().products
    const slug = products[0]!.slug

    const ig = await t.json('/api/admin/videos', 'POST', { title, instagram: 'https://www.instagram.com/reel/Dee5vk1sJxE/?igsh=1', product: slug, date: '2026-11-01' }, { cookie })
    assert.equal(ig.status, 201)
    const a = (await ig.json()) as Video
    assert.deepEqual(a, { id: a.id, title, instagram: 'https://www.instagram.com/p/Dee5vk1sJxE/', product: slug, date: '2026-11-01' })

    assert.equal((await t.json('/api/admin/videos', 'POST', { title, instagram: IG, product: 'ghost' }, { cookie })).status, 400)
    assert.equal((await t.json('/api/admin/videos', 'POST', { title, src: 'uploads/videos/missing-0000000000.mp4' }, { cookie })).status, 400)
    assert.equal((await t.json('/api/admin/videos', 'POST', { title }, { cookie })).status, 400)

    const up = (await (await upload(MP4, 'v.mp4')).json()) as Uploaded
    const poster = (await (
      await t.request('/api/admin/upload/image', {
        method: 'POST',
        cookie,
        body: form(await sharp({ create: { width: 90, height: 160, channels: 3, background: '#345' } }).jpeg().toBuffer(), 'p.jpg'),
      })
    ).json()) as { path: string }
    const res = await t.json('/api/admin/videos', 'POST', { title, src: up.path, poster: poster.path, instagram: IG }, { cookie })
    assert.equal(res.status, 201)
    const b = (await res.json()) as Video
    assert.deepEqual([b.src, b.poster, b.instagram, b.product], [up.path, poster.path, IG, null])

    const listed = (await (await t.request('/api/content')).json()) as { videos: Video[] }
    assert.deepEqual(listed.videos.slice(-2).map((v) => v.id), [a.id, b.id])

    // update (full replace): instagram dropped
    const upd = await t.json(`/api/admin/videos/${b.id}`, 'PUT', { title: { uz: 'Yangi', ru: '' }, src: up.path, poster: poster.path }, { cookie })
    assert.equal(upd.status, 200)
    const b2 = (await upd.json()) as Video
    assert.equal(b2.instagram, undefined)
    assert.equal(b2.title.uz, 'Yangi')
    assert.equal((await t.json('/api/admin/videos/99999', 'PUT', { title, instagram: IG }, { cookie })).status, 404)

    // order
    assert.equal((await t.json('/api/admin/videos-order', 'PUT', { ids: [b.id, a.id] }, { cookie })).status, 200)
    assert.deepEqual(t.ctx.content.get().videos.slice(0, 2).map((v) => v.id), [b.id, a.id])
    assert.equal((await t.json('/api/admin/videos-order', 'PUT', { ids: [424242] }, { cookie })).status, 400)

    // product rename / delete keep video links consistent
    const p0 = products[0]!
    const renamed = await t.json(`/api/admin/products/${slug}`, 'PUT', { ...p0, slug: `${slug}-x` }, { cookie })
    assert.equal(renamed.status, 200)
    assert.equal(t.ctx.content.get().videos.find((v) => v.id === a.id)!.product, `${slug}-x`)
    assert.equal((await t.request(`/api/admin/products/${slug}-x`, { method: 'DELETE', cookie })).status, 200)
    assert.equal(t.ctx.content.get().videos.find((v) => v.id === a.id)!.product, null)

    // replacing the file removes the old upload; deleting removes the file (shared image posters stay)
    const up2 = (await (await upload(WEBM, 'v2.webm')).json()) as Uploaded
    assert.equal((await t.json(`/api/admin/videos/${b.id}`, 'PUT', { title, src: up2.path, poster: poster.path }, { cookie })).status, 200)
    assert.ok(!existsSync(path.join(t.dataDir, up.path)))
    assert.equal((await t.request(`/api/admin/videos/${b.id}`, { method: 'DELETE', cookie })).status, 200)
    assert.ok(!existsSync(path.join(t.dataDir, up2.path)))
    assert.ok(existsSync(path.join(t.dataDir, poster.path)))
    assert.equal((await t.request(`/api/admin/videos/${b.id}`, { method: 'DELETE', cookie })).status, 404)
    assert.equal((await t.request(`/api/admin/videos/${a.id}`, { method: 'DELETE', cookie })).status, 200)
  })
})

describe('videos with ffmpeg', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nc-ff-'))
  })
  after(() => rm(dir, { recursive: true, force: true }))

  /**
   * Stand-in for ffmpeg (no real ffmpeg needed): `-version` succeeds; a `.jpg` output gets a real JPEG,
   * an `.mp4` output (transcode) gets the first 100 bytes of the input after a short delay.
   */
  const fakeFfmpeg = async () => {
    const jpg = path.join(dir, 'frame.jpg')
    await writeFile(jpg, await sharp({ create: { width: 72, height: 128, channels: 3, background: '#a85' } }).jpeg().toBuffer())
    const bin = path.join(dir, 'ffmpeg')
    await writeFile(
      bin,
      `#!/bin/sh
if [ "$1" = "-version" ]; then echo "ffmpeg version fake"; exit 0; fi
in=""; prev=""; out=""
for a in "$@"; do
  if [ "$prev" = "-i" ]; then in="$a"; fi
  prev="$a"; out="$a"
done
case "$out" in
  *.jpg) cp "${jpg}" "$out" ;;
  *.mp4) sleep 0.3; head -c 100 "$in" > "$out" ;;
  *) exit 1 ;;
esac
`,
    )
    await chmod(bin, 0o755)
    return bin
  }

  test('missing ffmpeg binary: upload still works, no poster', async () => {
    const t = await makeApp({ FFMPEG_PATH: path.join(dir, 'no-such-ffmpeg') })
    try {
      const cookie = await t.login()
      const res = await t.request('/api/admin/upload/video', { method: 'POST', body: form(MOV, 'a.mov'), cookie })
      assert.equal(res.status, 201)
      const body = (await res.json()) as { poster: string | null; processing: boolean }
      assert.deepEqual([body.poster, body.processing], [null, false])
    } finally {
      await t.close()
    }
  })

  test('poster is generated; non-MP4 is transcoded in the background and references are rewritten', async () => {
    const t = await makeApp({ FFMPEG_PATH: await fakeFfmpeg() })
    try {
      const cookie = await t.login()
      const res = await t.request('/api/admin/upload/video', { method: 'POST', body: form(MOV, 'phone.mov'), cookie })
      assert.equal(res.status, 201)
      const up = (await res.json()) as { path: string; poster: string | null; processing: boolean }
      assert.match(up.poster ?? '', /^uploads\/videos\/[a-z0-9]+-[a-f0-9]{10}\.jpg$/)
      assert.equal(up.processing, true)
      const poster = await t.request(`/${up.poster}`)
      assert.equal(poster.headers.get('content-type'), 'image/jpeg')
      assert.equal(sniffImage(new Uint8Array(await poster.arrayBuffer())), 'jpeg')

      // saved while the transcode is still running → rewritten when it finishes
      const created = await t.json('/api/admin/videos', 'POST', { title, src: up.path, poster: up.poster }, { cookie })
      assert.equal(created.status, 201)
      const v = (await created.json()) as Video
      assert.equal(v.src, up.path)
      await t.ctx.media.idle()
      const target = up.path.replace(/\.mov$/, '-720p.mp4')
      await waitFor(() => t.ctx.content.get().videos.find((x) => x.id === v.id)?.src === target)
      assert.ok(existsSync(path.join(t.dataDir, target)))
      assert.ok(!existsSync(path.join(t.dataDir, up.path)))

      // a form saved later with the original path is mapped to the transcoded file
      const late = await t.json('/api/admin/videos', 'POST', { title, src: up.path }, { cookie })
      assert.equal(((await late.json()) as Video).src, target)

      // small MP4: poster only, no transcode
      const small = (await (await t.request('/api/admin/upload/video', { method: 'POST', body: form(MP4, 'a.mp4'), cookie })).json()) as {
        processing: boolean
        poster: string | null
      }
      assert.equal(small.processing, false)
      assert.ok(small.poster)
    } finally {
      await t.close()
    }
  })
})
