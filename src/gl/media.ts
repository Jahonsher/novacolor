import * as THREE from 'three'
import { gsap, scroll } from '../lib/motion'

/**
 * One full-screen WebGL canvas that draws every registered <GLImage>.
 * DOM <img> elements stay in the layout (hidden) and we mirror their
 * bounding boxes each frame, so layout/SEO/accessibility stay native while
 * the pixels get shader effects: scroll-velocity bend + RGB split, hover
 * ripple/zoom, and a noisy "plaster" reveal.
 */

const vertex = /* glsl */ `
  uniform float uVelocity;
  uniform float uHover;
  varying vec2 vUv;
  const float PI = 3.141592653589793;
  void main() {
    vUv = uv;
    vec3 p = position;
    // bend the plane like paper when scrolling fast
    p.y -= sin(uv.x * PI) * uVelocity * 0.0022;
    p.x += sin(uv.y * PI) * uVelocity * 0.0004;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec2 uPlane;
  uniform vec2 uImage;
  uniform float uHover;
  uniform vec2 uMouse;
  uniform float uReveal;
  uniform float uVelocity;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  vec2 cover(vec2 uv) {
    float rp = uPlane.x / uPlane.y;
    float ri = uImage.x / uImage.y;
    vec2 s = rp < ri ? vec2(rp / ri, 1.0) : vec2(1.0, ri / rp);
    return (uv - 0.5) * s + 0.5;
  }

  void main() {
    vec2 uv = vUv;

    // hover: soft zoom + liquid ripple around the pointer
    float d = distance(uv, uMouse);
    float ripple = sin(d * 28.0 - uTime * 4.0) * 0.006 * uHover * (1.0 - smoothstep(0.0, 0.55, d));
    uv = (uv - 0.5) * (1.0 - 0.07 * uHover) + 0.5;
    uv += normalize(uv - uMouse + 0.0001) * ripple;

    // reveal: image settles from a slight zoom
    uv = (uv - 0.5) * (1.0 + 0.22 * (1.0 - uReveal)) + 0.5;

    vec2 c = cover(uv);
    float shift = clamp(uVelocity, -60.0, 60.0) * 0.00035;
    vec3 col;
    col.r = texture2D(uTexture, c + vec2(0.0, shift)).r;
    col.g = texture2D(uTexture, c).g;
    col.b = texture2D(uTexture, c - vec2(0.0, shift)).b;

    // reveal mask: bottom-up with a trowel-like noisy edge
    float n = (noise(vec2(vUv.x * 7.0, uTime * 0.4)) - 0.5) * 0.18 + (noise(vUv * 22.0) - 0.5) * 0.05;
    float edge = uReveal * 1.3 - 0.13;
    float mask = 1.0 - smoothstep(edge - 0.04, edge, vUv.y + n);

    col *= mix(0.55, 1.0, uReveal);
    col += 0.04 * uHover;
    gl_FragColor = vec4(col, mask);
  }
`

export type Item = {
  el: HTMLElement
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  uniforms: {
    uTexture: { value: THREE.Texture | null }
    uPlane: { value: THREE.Vector2 }
    uImage: { value: THREE.Vector2 }
    uHover: { value: number }
    uMouse: { value: THREE.Vector2 }
    uReveal: { value: number }
    uVelocity: { value: number }
    uTime: { value: number }
  }
  ready: boolean
  cleanup: () => void
}

class MediaGL {
  enabled = false
  private renderer?: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  private geometry = new THREE.PlaneGeometry(1, 1, 24, 24)
  private items = new Set<Item>()
  private textures = new Map<string, Promise<THREE.Texture>>()
  private loader = new THREE.TextureLoader()
  private velocity = 0
  private w = 0
  private h = 0

  init(canvas: HTMLCanvasElement) {
    if (this.renderer) return true
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      this.enabled = false
      return false
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.enabled = true
    this.resize()
    window.addEventListener('resize', this.resize)
    gsap.ticker.add(this.tick)
    return true
  }

  destroy() {
    gsap.ticker.remove(this.tick)
    window.removeEventListener('resize', this.resize)
    this.items.forEach((i) => this.remove(i))
    this.renderer?.dispose()
    this.renderer = undefined
    this.enabled = false
  }

  private resize = () => {
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.renderer?.setSize(this.w, this.h, false)
    Object.assign(this.camera, { left: -this.w / 2, right: this.w / 2, top: this.h / 2, bottom: -this.h / 2 })
    this.camera.updateProjectionMatrix()
  }

  private texture(src: string) {
    let p = this.textures.get(src)
    if (!p) {
      p = this.loader.loadAsync(src).then((t) => {
        t.minFilter = THREE.LinearFilter
        t.generateMipmaps = false
        return t
      })
      this.textures.set(src, p)
      p.catch(() => this.textures.delete(src))
    }
    return p
  }

  add(el: HTMLElement, src: string, onReady: (ok: boolean) => void): Item | null {
    if (!this.enabled) return null
    const uniforms: Item['uniforms'] = {
      uTexture: { value: null },
      uPlane: { value: new THREE.Vector2(1, 1) },
      uImage: { value: new THREE.Vector2(1, 1) },
      uHover: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uReveal: { value: 0 },
      uVelocity: { value: 0 },
      uTime: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, transparent: true })
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.visible = false

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      gsap.to(uniforms.uMouse.value, { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, duration: 0.6, ease: 'power3.out' })
    }
    const onEnter = () => gsap.to(uniforms.uHover, { value: 1, duration: 1.1, ease: 'power3.out' })
    const onLeave = () => gsap.to(uniforms.uHover, { value: 0, duration: 1.1, ease: 'power3.out' })
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)

    const item: Item = {
      el,
      mesh,
      uniforms,
      ready: false,
      cleanup: () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerenter', onEnter)
        el.removeEventListener('pointerleave', onLeave)
        gsap.killTweensOf([uniforms.uHover, uniforms.uMouse.value, uniforms.uReveal])
        material.dispose()
      },
    }
    this.items.add(item)
    this.scene.add(mesh)

    this.texture(src).then(
      (t) => {
        if (!this.items.has(item)) return
        const img = t.image as { width: number; height: number }
        uniforms.uTexture.value = t
        uniforms.uImage.value.set(img.width, img.height)
        item.ready = true
        onReady(true)
      },
      () => onReady(false),
    )
    return item
  }

  remove(item: Item) {
    if (!this.items.delete(item)) return
    this.scene.remove(item.mesh)
    item.cleanup()
  }

  private tick = (time: number) => {
    if (!this.renderer) return
    this.velocity += (scroll.velocity - this.velocity) * 0.08
    if (Math.abs(this.velocity) < 0.01) this.velocity = 0
    for (const item of this.items) {
      const r = item.el.getBoundingClientRect()
      const visible = item.ready && r.width > 0 && r.bottom > -50 && r.top < this.h + 50 && r.right > 0 && r.left < this.w
      item.mesh.visible = visible
      if (!visible) continue
      item.mesh.position.set(r.left + r.width / 2 - this.w / 2, -(r.top + r.height / 2) + this.h / 2, 0)
      item.mesh.scale.set(r.width, r.height, 1)
      const u = item.uniforms
      u.uPlane.value.set(r.width, r.height)
      u.uVelocity.value = this.velocity
      u.uTime.value = time
    }
    this.renderer.render(this.scene, this.camera)
  }
}

export const mediaGL = new MediaGL()
