/**
 * Real "liquid glass" refraction for Chromium.
 *
 * For each glass element we paint a displacement map that matches its
 * rounded-rect shape: the centre is neutral (clear glass) and a bezel near
 * the edge pushes samples inward, so the backdrop bends like it would
 * through a thick water droplet. Red/green/blue are displaced by slightly
 * different amounts for a hint of chromatic dispersion. The SVG filter is
 * applied with `backdrop-filter: url(#id)`, which only Chromium supports —
 * other browsers keep the plain blurred glass from CSS.
 */

const NS = 'http://www.w3.org/2000/svg'
let defs: SVGDefsElement | null = null
let counter = 0

export const canRefract =
  typeof navigator !== 'undefined' &&
  /Chrome\//.test(navigator.userAgent) &&
  !/Edg\/|OPR\//.test(navigator.userAgent) &&
  typeof CSS !== 'undefined' &&
  CSS.supports('backdrop-filter', 'url(#a) blur(1px)')

function ensureDefs() {
  if (defs) return defs
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  defs = document.createElementNS(NS, 'defs')
  svg.appendChild(defs)
  document.body.appendChild(svg)
  return defs
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/** Rounded-rect displacement map, rendered at reduced resolution (it's smooth). */
function makeMap(w: number, h: number, radius: number, bezel: number) {
  const k = 0.5
  const W = Math.max(4, Math.round(w * k))
  const H = Math.max(4, Math.round(h * k))
  const r = Math.min(radius, w / 2, h / 2) * k
  const b = Math.max(2, bezel * k)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const d = img.data
  const cx = W / 2
  const cy = H / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - cx
      const py = y + 0.5 - cy
      const qx = Math.abs(px) - (cx - r)
      const qy = Math.abs(py) - (cy - r)
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      // signed distance to the rounded rect (negative inside)
      const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
      const inward = -sd
      let dx = 0
      let dy = 0
      if (inward < b) {
        let nx: number
        let ny: number
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(ox, oy) || 1
          nx = ox / len
          ny = oy / len
        } else if (qx > qy) {
          nx = 1
          ny = 0
        } else {
          nx = 0
          ny = 1
        }
        nx *= Math.sign(px) || 1
        ny *= Math.sign(py) || 1
        // convex-lens profile: strongest right at the rim, fading inward
        const t = 1 - Math.max(0, inward) / b
        const m = t * t * (3 - 2 * t)
        dx = -nx * m
        dy = -ny * m
      }
      const i = (y * W + x) * 4
      d[i] = 128 + dx * 127
      d[i + 1] = 128 + dy * 127
      d[i + 2] = 128
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

type Options = {
  /** corner radius in px, or 'pill' for height / 2 */
  radius?: number | 'pill'
  /** width of the refracting rim in px */
  bezel?: number
  /** displacement strength in px */
  strength?: number
  blur?: number
  saturate?: number
  brightness?: number
}

/** Attach edge refraction to an element. Returns a cleanup function. */
export function attachLiquid(target: HTMLElement, opts: Options = {}) {
  if (!canRefract) return () => {}
  const { radius = 'pill', bezel = 22, strength = 46, blur = 3, saturate = 170, brightness = 1.04 } = opts
  const id = `nc-lg-${++counter}`
  const filter = el('filter', { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })
  const image = el('feImage', { x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'none', result: 'map' })
  filter.appendChild(image)
  const channels = [
    { s: 1, m: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
    { s: 0.96, m: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
    { s: 0.92, m: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' },
  ]
  const maps: SVGFEDisplacementMapElement[] = []
  channels.forEach((c, i) => {
    const dm = el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: strength * c.s, xChannelSelector: 'R', yChannelSelector: 'G', result: `d${i}` })
    dm.dataset.s = String(c.s)
    maps.push(dm)
    filter.appendChild(dm)
    filter.appendChild(el('feColorMatrix', { in: `d${i}`, type: 'matrix', values: c.m, result: `c${i}` }))
  })
  filter.appendChild(el('feBlend', { in: 'c0', in2: 'c1', mode: 'screen', result: 'rg' }))
  filter.appendChild(el('feBlend', { in: 'rg', in2: 'c2', mode: 'screen' }))
  ensureDefs().appendChild(filter)

  let w = 0
  let h = 0
  let dpr = 0
  let timer = 0
  const paint = () => {
    if (w < 2 || h < 2) return
    const rad = radius === 'pill' ? h / 2 : radius
    image.setAttribute('href', makeMap(w, h, rad, Math.min(bezel, h / 2, w / 2)))
  }
  const measure = () => {
    const nw = target.offsetWidth
    const nh = target.offsetHeight
    const nd = window.devicePixelRatio || 1
    if (nw === w && nh === h && nd === dpr) return
    w = nw
    h = nh
    dpr = nd
    // Chrome evaluates backdrop filters in device pixels, so the map and the
    // displacement strength are scaled by devicePixelRatio (otherwise the map
    // only covers part of the glass on Retina screens)
    image.setAttribute('width', String(w * dpr))
    image.setAttribute('height', String(h * dpr))
    maps.forEach((m) => m.setAttribute('scale', String(strength * Number(m.dataset.s) * dpr)))
    clearTimeout(timer)
    timer = window.setTimeout(paint, 90)
  }
  measure()
  paint()
  const ro = new ResizeObserver(measure)
  ro.observe(target)
  window.addEventListener('resize', measure)
  const value = `url(#${id}) blur(${blur}px) saturate(${saturate}%) brightness(${brightness})`
  target.style.setProperty('backdrop-filter', value)
  target.style.setProperty('-webkit-backdrop-filter', value)

  return () => {
    ro.disconnect()
    window.removeEventListener('resize', measure)
    clearTimeout(timer)
    filter.remove()
    target.style.removeProperty('backdrop-filter')
    target.style.removeProperty('-webkit-backdrop-filter')
  }
}
