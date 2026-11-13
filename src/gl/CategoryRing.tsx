import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { asset, categories, pad } from '../data'
import { useLang } from '../i18n'
import { gsap, ScrollTrigger, useGSAP, reducedMotion } from '../lib/motion'
import { getQuality, onQuality } from '../lib/perf'
import { glPixelRatio } from './media'
import { useTransition } from '../components/Transition'
import { Reveal } from '../components/Reveal'

/**
 * Scroll-triggered 3D navigation: category panels sit on the inside of a
 * cylinder; the section pins and scrolling spins the ring. Clicking the
 * front panel opens that category.
 */
const vertex = /* glsl */ `
  uniform float uRadius;
  uniform float uVelocity;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec3 p = position;
    float ang = p.x / uRadius;
    p.x = sin(ang) * uRadius;
    p.z = (cos(ang) - 1.0) * uRadius;
    p.y *= 1.0 + abs(uVelocity) * 0.12 * (1.0 - cos(ang * 3.0));
    vec4 world = modelMatrix * vec4(p, 1.0);
    vDepth = world.z;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec2 uImage;
  uniform vec2 uPlane;
  uniform float uFacing;
  uniform float uVelocity;
  uniform float uLoaded;
  uniform float uRadius;
  varying vec2 vUv;
  varying float vDepth;
  vec2 cover(vec2 uv) {
    float rp = uPlane.x / uPlane.y;
    float ri = uImage.x / uImage.y;
    vec2 s = rp < ri ? vec2(rp / ri, 1.0) : vec2(1.0, ri / rp);
    return (uv - 0.5) * s + 0.5;
  }
  void main() {
    vec2 uv = cover(vUv);
    // subtle parallax inside the frame as the ring turns
    uv.x += (1.0 - uFacing) * 0.06 * sign(vDepth);
    float s = uVelocity * 0.015;
    vec3 col = vec3(
      texture2D(uTexture, uv + vec2(s, 0.0)).r,
      texture2D(uTexture, uv).g,
      texture2D(uTexture, uv - vec2(s, 0.0)).b
    );
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    float f = smoothstep(-0.1, 1.0, uFacing);
    col = mix(vec3(grey) * 0.55, col, f);
    col *= mix(0.18, 1.0, f);
    gl_FragColor = vec4(col, uLoaded);
  }
`

export function CategoryRing() {
  const section = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const names = useRef<HTMLDivElement>(null)
  const target = useRef(0)
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const { l, t } = useLang()
  const { go } = useTransition()
  const N = categories.length

  // three.js scene
  useEffect(() => {
    const el = canvas.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: getQuality() >= 3, alpha: true })
    } catch {
      return
    }
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    const group = new THREE.Group()
    scene.add(group)

    const W = 1.7
    const H = 1.06
    const step = (Math.PI * 2) / N
    const R = (N * W * 1.32) / (Math.PI * 2)
    const loader = new THREE.TextureLoader()
    const mats: THREE.ShaderMaterial[] = []
    const geo = new THREE.PlaneGeometry(W, H, 64, 1)
    // set whenever the next tick must draw even if nothing moves
    let dirty = true

    categories.forEach((c, i) => {
      const uniforms = {
        uTexture: { value: null as THREE.Texture | null },
        uImage: { value: new THREE.Vector2(1, 1) },
        uPlane: { value: new THREE.Vector2(W, H) },
        uFacing: { value: 0 },
        uVelocity: { value: 0 },
        uLoaded: { value: 0 },
        uRadius: { value: R },
      }
      const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, transparent: true, side: THREE.DoubleSide })
      mats.push(mat)
      loader.load(asset(c.image), (tex) => {
        const img = tex.image as { width: number; height: number }
        uniforms.uTexture.value = tex
        uniforms.uImage.value.set(img.width, img.height)
        gsap.to(uniforms.uLoaded, { value: 1, duration: 1.2, onStart: () => (dirty = true), onComplete: () => (dirty = true) })
      })
      const pivot = new THREE.Object3D()
      pivot.rotation.y = i * step
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.z = R
      pivot.add(mesh)
      group.add(pivot)
    })

    const resize = () => {
      const { width, height } = el.getBoundingClientRect()
      renderer.setPixelRatio(glPixelRatio())
      renderer.setSize(width, height, false)
      dirty = true
      camera.aspect = width / height
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      // keep the front panel ~62% of viewport height, and fit width on portrait screens
      const byH = H / 0.62 / (2 * half)
      const byW = (W * 1.15) / (2 * half * camera.aspect)
      camera.position.set(0, 0, R + Math.max(byH, byW))
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    const offQuality = onQuality(resize)

    const mouse = new THREE.Vector2()
    const onMove = (e: PointerEvent) => mouse.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5)
    window.addEventListener('pointermove', onMove)

    let current = 0
    let visible = false
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
    io.observe(el)

    const tick = () => {
      if (!visible) return
      const prev = current
      current += (target.current - current) * (reducedMotion ? 1 : 0.06)
      const vel = current - prev
      const dx = (mouse.y * 0.12 - group.rotation.x) * 0.05
      const dz = (-mouse.x * 0.03 - group.rotation.z) * 0.05
      const fading = mats.some((m) => m.uniforms.uLoaded.value > 0 && m.uniforms.uLoaded.value < 1)
      // ring at rest and pointer still: the last frame is still valid
      const moving = Math.abs(vel) > 1e-5 || Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5 || fading
      if (!moving && !dirty) return
      dirty = moving // one more frame after motion stops so the final pose is drawn
      group.rotation.y = -current * step
      group.rotation.x += dx
      group.rotation.z += dz
      mats.forEach((m, i) => {
        m.uniforms.uFacing.value = Math.cos(i * step - current * step)
        m.uniforms.uVelocity.value = vel * 10
      })
      const idx = ((Math.round(current) % N) + N) % N
      if (idx !== activeRef.current) {
        activeRef.current = idx
        setActive(idx)
      }
      renderer.render(scene, camera)
    }
    gsap.ticker.add(tick)
    return () => {
      gsap.ticker.remove(tick)
      offQuality()
      window.removeEventListener('pointermove', onMove)
      ro.disconnect()
      io.disconnect()
      geo.dispose()
      mats.forEach((m) => {
        m.uniforms.uTexture.value?.dispose()
        m.dispose()
      })
      renderer.dispose()
    }
  }, [N])

  // pin + scrub
  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: section.current,
        start: 'top top',
        end: `+=${(N - 1) * 55}%`,
        pin: true,
        scrub: true,
        snap: reducedMotion ? undefined : { snapTo: 1 / (N - 1), duration: { min: 0.4, max: 0.9 }, delay: 0.12, ease: 'sine.inOut' },
        onUpdate: (self) => (target.current = self.progress * (N - 1)),
      })
    },
    { scope: section },
  )

  // swap the big category title
  const firstSwap = useRef(true)
  useGSAP(
    () => {
      const items = names.current?.querySelectorAll<HTMLElement>('[data-name]')
      const first = firstSwap.current
      firstSwap.current = false
      items?.forEach((node, i) => {
        gsap[first ? 'set' : 'to'](node, {
          y: 0,
          opacity: 1,
          yPercent: i === active ? 0 : i < active ? -135 : 135,
          rotate: i === active ? 0 : i < active ? -4 : 4,
          duration: 1.2,
          ease: 'power4.out',
        })
      })
    },
    { dependencies: [active, l], scope: names },
  )

  const cat = categories[active]
  const open = () => go(`/products?c=${cat.id}`)

  return (
    <section ref={section} className="relative h-screen overflow-hidden">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" data-cursor={t('cats.open')} onClick={open} aria-hidden />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-5 pb-8 pt-28 md:px-10 md:pb-10">
        <div className="flex items-start justify-between">
          <Reveal as="p" className="label">
            {`02 — ${t('cats.label')}`}
          </Reveal>
          <p className="label tabular-nums">
            <span className="text-bone">{pad(active + 1)}</span> / {pad(N)}
          </p>
        </div>
        <div className="flex items-end justify-between gap-6">
          <div>
            <div ref={names} className="relative h-[17vw] w-[88vw] overflow-hidden md:h-[9vw] md:w-[62vw]">
              {categories.map((c, i) => (
                <h3
                  key={c.id}
                  data-name
                  className={`display absolute left-0 top-0 whitespace-nowrap text-[15vw] md:text-[8vw] ${i === 0 ? '' : 'opacity-0'}`}
                >
                  {l(c.name)}
                </h3>
              ))}
            </div>
            <p className="label mt-3">
              {cat.count} {t('cats.products')}
            </p>
          </div>
          <button onClick={open} className="pointer-events-auto group hidden items-center gap-4 md:flex" data-cursor="link">
            <span className="label !text-bone">{t('cats.open')}</span>
            <span className="grid h-16 w-16 place-items-center rounded-full border border-line transition-colors duration-500 group-hover:bg-bone group-hover:text-ink">→</span>
          </button>
        </div>
        <div className="label absolute bottom-1/2 right-5 hidden origin-right translate-y-1/2 rotate-90 md:right-10 md:block">{t('cats.hint')}</div>
      </div>
    </section>
  )
}
