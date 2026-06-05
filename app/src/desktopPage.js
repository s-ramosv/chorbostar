/**
 * Desktop-only parallel “pages”: same app bundle, different slides + optional layout / GLTF / overlays.
 * Mobile uses the **alt** content bundle (`slides-structure-desktop-alt.json`) with the mobile touch layout.
 *
 * **Production routes** (desktop): `/` → alt (chorbostar.com landing); `/music` → default (original).
 * **Legacy paths** `/desk-alt` and `/alt` also load alt (Netlify may 301 them to `/`).
 * **Dev query:** `?page=alt` | `?page=desk-alt` → alt; `?page=default` | `?page=music` → default.
 *
 * ---
 * **Layout tuning:** Edit `ALT_PAGE_CAMERA`, `ALT_PAGE_STACK`, and
 * `ALT_PAGE_FRONT_SLIDE_HOVER_TILT` below. Values are merged in
 * `mergeDesktopLayoutPatch()` on top of `resolveLayoutProfile()` (for default desktop, that matches
 * `DESKTOP_REFERENCE_*`). Non-alt routes ignore this file’s patch (`getDesktopLayoutPatch` returns null).
 */

import slidesDefault from './slides-structure.json'
import slidesAlt from './slides-structure-desktop-alt.json'

export const DESKTOP_PAGE_DEFAULT = 'default'
export const DESKTOP_PAGE_ALT = 'alt'

/** @typedef {'default' | 'alt'} DesktopPageId */

// ---------------------------------------------------------------------------
// Reference defaults — same numbers as `layoutProfile.js` → `desktopProfile()` / `desktopStack()`.
// (Kept here so you can compare when editing the alt page without opening two files.)
// ---------------------------------------------------------------------------

/** @type {{ fov: number, position: { x: number, y: number, z: number } }} */
export const DESKTOP_REFERENCE_CAMERA = Object.freeze({
  /** Vertical field of view (degrees). */
  fov: 100,
  position: {
    x: -0.6,
    y: 0.35,
    z: 2.5,
  },
})

const _xStart = -1.5
const _zStart = 0
const _xStep = 1.7
const _zStep = -0.8
const _scale = 1.5

/** @type {Readonly<Record<string, unknown>>} */
export const DESKTOP_REFERENCE_STACK = Object.freeze({
  /** Slot grid origin X (world units, before `scale`). */
  xStart: _xStart,
  /** Slot grid origin Z (world units, before `scale`). */
  zStart: _zStart,
  /** Delta X between adjacent slide indices. */
  xStep: _xStep,
  /** Delta Z between adjacent slide indices. */
  zStep: _zStep,
  /**
   * Uniform scale for stack math and **card size** in main.js (`CARD_WIDTH` / `CARD_HEIGHT` ∝ `scale`).
   */
  scale: _scale,
  /** Stack curve plane: `'xz'` (desktop), `'yz'`, `'xy'`. */
  plane: 'xz',
  /** If true, `curveEnd` below is used; else end point is derived from last slot. */
  curveUseCustomEnd: true,
  /** Bezier start for slide stack path (world units). */
  curveStart: {
    x: _xStart * _scale,
    y: -0.12,
    z: _zStart * _scale,
  },
  /** Bezier end for slide stack path (world units). */
  curveEnd: {
    x: 15,
    y: 1,
    z: -10.0,
  },
  /** Lateral bend of the curve (sign/direction depends on plane). */
  curveBend: -1,
  /** Extra bend on the “vertical” axis for the curve control point. */
  curveVerticalBend: 0,
  /** 0–1: how strongly slot indices spread along the curve (see `getSlotPositions` in main.js). */
  slotSpreadExponent: 0.5,

  // --- Optional (omit on default desktop; main.js uses fallbacks if undefined) ---
  /** World Z where off-stack slides sit. main.js default `2` if omitted. */
  // vanishZ: 2,
  /** Added to vanish X/Y. Default `0`. */
  // vanishOffsetX: 0,
  // vanishOffsetY: 0,
  /** World-Y tilt on front card (rad). main.js default `Math.PI / 16` if omitted. */
  // frontSlideStackYawRad: Math.PI / 16,
  /** Blend width in slide-index space. main.js default `0.8` if omitted. */
  // frontSlideStackYawExitBlend: 0.8,
  /** Y rotation for slides past the float front. main.js default `Math.PI / 4` if omitted. */
  // slideOffFrameYawRad: Math.PI / 4,
  /** Blend width for off-frame yaw. main.js default `1` if omitted. */
  // slideOffFrameRotationBlend: 1,
})

// ---------------------------------------------------------------------------
// Alt page (`/desk-alt`, `/alt`, or `?page=alt`) — **edit these objects**.
// `mergeDesktopLayoutPatch` shallow-merges `stack` and merges `curveStart` / `curveEnd` if partially set.
// ---------------------------------------------------------------------------

/** Alt desktop camera (starts from reference; tweak freely). */
export const ALT_PAGE_CAMERA = {
  /** Default reference: `100`. Current alt: slightly narrower FOV. */
  fov: 90,
  position: {
    /** Default reference: `-0.6` */
    x: -0.45,
    /** Default reference: `0.35` */
    y: 0.38,
    /** Default reference: `2.5` — lower = closer to slides (typical). */
    z: 2.65,
  },
}

/**
 * Alt desktop stack — include every key you want to override; omitted keys keep `layoutProfile.stack`
 * from the frozen profile (same as reference for stock desktop).
 *
 * For a **full** alt stack, copy `DESKTOP_REFERENCE_STACK`, paste here, and edit (uncomment optional vanish/yaw if needed).
 */
export const ALT_PAGE_STACK = {
  xStart: _xStart,
  zStart: _zStart,
  xStep: _xStep,
  zStep: _zStep,
  scale: _scale,
  plane: 'xz',
  curveUseCustomEnd: true,
  curveStart: {
    x: _xStart * _scale,
    y: 0.4,
    z: _zStart * _scale,
  },
  /** Default reference end: `{ x: 15, y: 1, z: -10 }` — alt pulls the end in slightly. */
  curveEnd: {
    x: 10,
    y: 1.1,
    z: -5,
  },
  /** Default reference: `-1` */
  curveBend: 0,
  curveVerticalBend: 0,
  slotSpreadExponent: 0.7,

  // Uncomment to override main.js fallbacks for this page only:
  // vanishZ: 2,
  // vanishOffsetX: 2,
  // vanishOffsetY: 0,
  frontSlideStackYawRad: Math.PI / 32,
  // frontSlideStackYawExitBlend: 0.8,
  slideOffFrameYawRad: Math.PI / 2,
  // slideOffFrameRotationBlend: 1,
}

/**
 * Alt-only hover tilt on the **front** slide.
 * These map to `FRONT_SLIDE_HOVER_TILT_*` in main.js.
 *
 * Defaults in main.js:
 * - enabled: true
 * - maxX: 0.05
 * - maxY: 0.05
 * - smooth: 8
 */
export const ALT_PAGE_FRONT_SLIDE_HOVER_TILT = {
  enabled: true,
  maxX: 0.03,
  maxY: 0.03,
  smooth: 8,
}

// ---------------------------------------------------------------------------
// Routing + merge helpers
// ---------------------------------------------------------------------------

function normalizeAppPath(pathname) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  let p = pathname.replace(/\/$/, '') || '/'
  if (base && base !== '/' && p.startsWith(base)) {
    p = p.slice(base.length) || '/'
  }
  if (!p.startsWith('/')) p = `/${p}`
  return p
}

/**
 * @param {'desktop' | 'mobile'} layoutProfileId
 * @returns {DesktopPageId}
 */
export function resolveDesktopPageId(layoutProfileId) {
  if (layoutProfileId !== 'desktop') return DESKTOP_PAGE_DEFAULT
  if (typeof window === 'undefined') return DESKTOP_PAGE_DEFAULT

  if (import.meta.env.DEV) {
    const q = new URLSearchParams(window.location.search).get('page')
    if (q === 'alt' || q === 'desk-alt') return DESKTOP_PAGE_ALT
    if (q === 'default' || q === 'music') return DESKTOP_PAGE_DEFAULT
  }

  const path = normalizeAppPath(window.location.pathname)
  if (path === '/music') return DESKTOP_PAGE_DEFAULT

  // `/`, `/desk-alt`, `/alt`, and any other desktop path → alt landing
  return DESKTOP_PAGE_ALT
}

/**
 * Content page id for slides, overlays, GLTF, sit-idle, etc.
 * Mobile always uses **alt** content (same slides/arts as desktop `/`); desktop routes pick default vs alt.
 *
 * @param {'desktop' | 'mobile'} layoutProfileId
 * @param {DesktopPageId} desktopPageId — from `resolveDesktopPageId` (desktop only)
 * @returns {DesktopPageId}
 */
export function getContentPageId(layoutProfileId, desktopPageId) {
  if (layoutProfileId === 'mobile') return DESKTOP_PAGE_ALT
  return desktopPageId
}

/**
 * @param {'desktop' | 'mobile'} layoutProfileId
 * @param {DesktopPageId} pageId
 */
export function getSlidesStructureForPage(layoutProfileId, pageId) {
  const contentPageId = getContentPageId(layoutProfileId, pageId)
  return contentPageId === DESKTOP_PAGE_ALT ? slidesAlt : slidesDefault
}

/**
 * Returns layout overrides **only** for the alt desktop page; `null` for default desktop / mobile.
 * Camera/stack values come from `ALT_PAGE_CAMERA` and `ALT_PAGE_STACK` above.
 *
 * @param {DesktopPageId} pageId
 * @returns {{ camera?: { fov?: number, position?: { x?: number, y?: number, z?: number } }, stack?: object } | null}
 */
export function getDesktopLayoutPatch(pageId) {
  if (pageId !== DESKTOP_PAGE_ALT) return null
  return {
    camera: { ...ALT_PAGE_CAMERA },
    stack: { ...ALT_PAGE_STACK },
  }
}

/**
 * Returns hover-tilt overrides only for the alt desktop page; `null` for default desktop / mobile.
 *
 * @param {DesktopPageId} pageId
 * @returns {{ enabled?: boolean, maxX?: number, maxY?: number, smooth?: number } | null}
 */
export function getDesktopFrontSlideHoverTiltPatch(pageId) {
  if (pageId !== DESKTOP_PAGE_ALT) return null
  return { ...ALT_PAGE_FRONT_SLIDE_HOVER_TILT }
}

/**
 * @param {{ camera: { fov: number, position: { x: number, y: number, z: number } }, stack: object }} layoutProfile
 * @param {object | null} patch — from `getDesktopLayoutPatch`
 */
export function mergeDesktopLayoutPatch(layoutProfile, patch) {
  if (!patch) {
    return {
      camera: layoutProfile.camera,
      stack: layoutProfile.stack,
    }
  }
  const cam = layoutProfile.camera
  const pc = patch.camera
  const mergedCamera = pc
    ? {
        fov: pc.fov ?? cam.fov,
        position: {
          x: pc.position?.x ?? cam.position.x,
          y: pc.position?.y ?? cam.position.y,
          z: pc.position?.z ?? cam.position.z,
        },
      }
    : cam

  const base = layoutProfile.stack
  const ps = patch.stack
  const mergedStack = ps
    ? {
        ...base,
        ...ps,
        curveStart: ps.curveStart ? { ...base.curveStart, ...ps.curveStart } : base.curveStart,
        curveEnd: ps.curveEnd ? { ...base.curveEnd, ...ps.curveEnd } : base.curveEnd,
      }
    : base

  return { camera: mergedCamera, stack: mergedStack }
}
