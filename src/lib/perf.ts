import { useSyncExternalStore } from 'react'
import { gsap } from 'gsap'

/**
 * Adaptive quality.
 *
 * Level 3 = full effects (strong devices), 0 = minimal (hero frozen).
 * We start from a guess based on the device, then a frame-rate governor
 * watches real frame times and steps the level down when the page can't keep
 * up — so average phones and laptops stay smooth instead of stuttering.
 * The level never goes back up within a visit (no flicker between levels).
 *
 * Debug: add `?q=0..3` to the URL to force a level.
 */
export type Quality = 0 | 1 | 2 | 3

const STORE = 'nc-quality-v1'
const STORE_TTL = 3 * 24 * 3600 * 1000

const clamp = (n: number): Quality => Math.max(0, Math.min(3, Math.round(n))) as Quality

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return ''
  }
}

function initialGuess(): { level: Quality; forced: boolean } {
  if (typeof window === 'undefined') return { level: 3, forced: true }
  const forced = new URLSearchParams(location.search).get('q')
  if (forced !== null && /^[0-3]$/.test(forced)) return { level: Number(forced) as Quality, forced: true }

  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const cores = nav.hardwareConcurrency || 4
  const mem = nav.deviceMemory ?? 8
  const touch = window.matchMedia('(hover: none), (pointer: coarse)').matches
  const gpu = gpuName()

  let level: number = touch ? (cores >= 8 && mem >= 6 ? 2 : 1) : cores >= 8 && mem >= 8 ? 3 : 2
  if (nav.connection?.saveData) level = Math.min(level, 1)
  // software rendering — no real GPU at all
  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) level = Math.min(level, 1)
  // weak integrated / older mobile GPUs
  else if (/Intel.*(HD|UHD) Graphics|Mali-[4T]|Mali-G[0-5]\d\b|Adreno.*\b[3-5]\d\d\b|PowerVR/i.test(gpu)) level = Math.min(level, 2)

  // remember a downgrade from a recent visit, so the first seconds don't stutter again
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null') as { q: number; t: number } | null
    if (saved && Date.now() - saved.t < STORE_TTL) level = Math.min(level, saved.q)
  } catch {
    /* storage unavailable */
  }
  return { level: clamp(level), forced: false }
}

const init = initialGuess()
let level: Quality = init.level
const subs = new Set<() => void>()

function apply() {
  if (typeof document !== 'undefined') document.documentElement.dataset.q = String(level)
}
apply()

export const getQuality = () => level

function setQuality(q: Quality) {
  if (q === level) return
  level = q
  apply()
  try {
    localStorage.setItem(STORE, JSON.stringify({ q, t: Date.now() }))
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f())
}

export const onQuality = (cb: () => void) => {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

export const useQuality = () => useSyncExternalStore(onQuality, getQuality, () => 3 as Quality)

/* ---------------- frame-rate governor ---------------- */

let started = false

/**
 * Start watching frame times (call once the page is visible — the preloader
 * and shader compilation cause one-off hitches we don't want to count).
 */
export function startGovernor() {
  if (started || init.forced || typeof window === 'undefined') return
  started = true
  const frames: number[] = []
  let last = 0
  let cooldownUntil = performance.now() + 1500
  let slowWindows = 0

  const tick = () => {
    const now = performance.now()
    const dt = now - last
    last = now
    // ignore hidden tabs and long pauses (tab switch, debugger, etc.)
    if (document.hidden || dt > 500 || dt <= 0) {
      frames.length = 0
      return
    }
    if (now < cooldownUntil) return
    frames.push(dt)
    if (frames.length < 30) return

    const sorted = [...frames].sort((a, b) => a - b)
    frames.length = 0
    const median = sorted[sorted.length >> 1]
    // below ~45 fps → step down; the last step (freezing the hero) only below ~22 fps
    const slow = level > 1 ? median > 22 : median > 45
    slowWindows = slow ? slowWindows + 1 : 0
    // clearly struggling (< 25 fps) → act on the first window; borderline → confirm with a second one.
    // Freezing the hero is the last resort: it needs ~3 s of sustained slowness, so a one-off
    // hitch (image decoding, a long scroll) can't trigger it
    const needed = level <= 1 ? 3 : median > 40 ? 1 : 2
    if (slowWindows >= needed && level > 0) {
      slowWindows = 0
      setQuality((level - 1) as Quality)
      // give the GPU a moment to settle at the new level before judging again
      cooldownUntil = now + 1200
    }
  }
  gsap.ticker.add(tick)
}
