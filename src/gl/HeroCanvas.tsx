import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { gsap, reducedMotion, useReady } from '../lib/motion'
import { getQuality, onQuality, type Quality } from '../lib/perf'

/**
 * Full-screen "liquid Venetian plaster" — domain-warped fbm noise lit like a
 * trowelled metallic finish. The pointer pushes the material around.
 */
const fragment = /* glsl */ `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uIntro;
  uniform float uScroll;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
  float pattern(vec2 p, out vec2 q, out vec2 r) {
    float t = uTime * 0.05;
    q = vec2(fbm(p + vec2(0.0, 0.0) + t), fbm(p + vec2(5.2, 1.3) - t));
    r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p + 3.5 * q + vec2(8.3, 2.8)));
    return fbm(p + 3.5 * r);
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 1.5;
    vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0) * 1.5;
    float md = length(p - m);
    p += (p - m) * 0.35 * exp(-md * md * 1.6);   // pointer "lens" push
    p.y += uScroll * 1.2;

    vec2 q, r;
    float f = pattern(p, q, r);
    vec2 q2, r2;
    float e = 0.02;
    float fx = pattern(p + vec2(e, 0.0), q2, r2);
    float fy = pattern(p + vec2(0.0, e), q2, r2);
    vec3 n = normalize(vec3((f - fx) / e * 0.22, (f - fy) / e * 0.22, 1.0));

    // palette: charcoal → umber → sand, with bone highlights
    vec3 charcoal = vec3(0.047, 0.043, 0.039);
    vec3 umber = vec3(0.20, 0.155, 0.115);
    vec3 sand = vec3(0.76, 0.65, 0.49);
    vec3 bone = vec3(0.93, 0.90, 0.87);
    vec3 col = mix(charcoal, umber, smoothstep(0.2, 0.9, f));
    col = mix(col, sand * 0.75, smoothstep(0.55, 1.1, length(q)) * 0.55);
    col = mix(col, charcoal, smoothstep(0.4, 0.9, r.y) * 0.6);

    // metallic sheen
    vec3 L = normalize(vec3(m * 0.4 + vec2(0.4, 0.6), 1.2));
    vec3 V = vec3(0.0, 0.0, 1.0);
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-L, n), V), 0.0, 1.0), 22.0);
    col *= 0.55 + 0.6 * diff;
    col += spec * mix(sand, bone, 0.4) * 0.55;

    // vignette + intro fade + film grain
    vec2 vv = vUv - 0.5;
    col *= 1.0 - dot(vv, vv) * 1.3;
    col *= uIntro;
    col += (hash(vUv * uRes + uTime) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`

/**
 * Per quality level: fbm octaves, render scale (× min(dpr, 1.5)) and frame rate.
 * The material is soft and moves slowly, so fewer octaves, a lower internal
 * resolution and 30 fps are hard to tell apart — but far cheaper on weak GPUs.
 * Level 0 freezes the material (renders only when something actually changes).
 */
const LEVELS: Record<Quality, { octaves: number; scale: number; fps: number }> = {
  3: { octaves: 5, scale: 0.6, fps: 0 },
  2: { octaves: 4, scale: 0.45, fps: 30 },
  1: { octaves: 3, scale: 0.32, fps: 30 },
  0: { octaves: 4, scale: 0.5, fps: -1 },
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export function HeroCanvas({ className = '' }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ready = useReady()
  const uniforms = useRef({
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uIntro: { value: 0 },
    uScroll: { value: 0 },
  })

  useEffect(() => {
    const el = canvas.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, powerPreference: 'high-performance' })
    } catch {
      el.style.display = 'none'
      return
    }
    const u = uniforms.current
    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    let cfg = LEVELS[getQuality()]
    const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: u, defines: { OCTAVES: cfg.octaves } })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(mesh)

    // forces the next tick to draw (used by the frozen level 0)
    let dirty = true
    let lastDraw = 0

    // the material is soft, so render at reduced resolution for speed
    const resize = () => {
      const { width, height } = el.getBoundingClientRect()
      const scale = Math.min(window.devicePixelRatio, 1.5) * cfg.scale
      renderer.setPixelRatio(scale)
      renderer.setSize(width, height, false)
      u.uRes.value.set(width * scale, height * scale)
      dirty = true
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const offQuality = onQuality(() => {
      cfg = LEVELS[getQuality()]
      material.defines.OCTAVES = cfg.octaves
      material.needsUpdate = true
      resize()
    })

    const target = new THREE.Vector2(0.5, 0.5)
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      target.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
    }
    window.addEventListener('pointermove', onMove)

    let visible = true
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
    io.observe(el)

    let lastIntro = -1
    let lastScroll = -1
    const tick = (time: number) => {
      if (!visible) return
      const r = el.getBoundingClientRect()
      const scrollV = Math.max(0, -r.top / Math.max(1, r.height))
      if (cfg.fps < 0 || reducedMotion) {
        // frozen: a still frame, redrawn only when scroll / intro / size change
        const intro = u.uIntro.value
        if (!dirty && intro === lastIntro && Math.abs(scrollV - lastScroll) < 0.002) return
        dirty = false
        lastIntro = intro
        lastScroll = scrollV
        u.uTime.value = 4
        u.uScroll.value = scrollV
        renderer.render(scene, camera)
        return
      }
      const now = performance.now()
      if (cfg.fps > 0 && !dirty && now - lastDraw < 1000 / cfg.fps - 4) return
      lastDraw = now
      dirty = false
      u.uTime.value = time
      // mouse easing is tuned per 60 fps frame — keep the same feel at 30 fps
      u.uMouse.value.lerp(target, cfg.fps > 0 ? 0.08 : 0.04)
      u.uScroll.value = scrollV
      renderer.render(scene, camera)
    }
    gsap.ticker.add(tick)

    return () => {
      gsap.ticker.remove(tick)
      offQuality()
      window.removeEventListener('pointermove', onMove)
      ro.disconnect()
      io.disconnect()
      mesh.geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  useEffect(() => {
    if (ready) gsap.to(uniforms.current.uIntro, { value: 1, duration: 2.4, ease: 'power2.out' })
  }, [ready])

  return <canvas ref={canvas} className={`block h-full w-full ${className}`} aria-hidden />
}
