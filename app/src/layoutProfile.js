/**
 * Device / layout profile evaluated once at startup (see plan: avoid mid-session stack jumps).
 * Mobile: narrow viewport + coarse pointer (touch-first).
 */

/** @typedef {'xz' | 'xy' | 'yz'} StackCurvePlane */

/**
 * @typedef {object} LayoutProfile
 * @property {'desktop' | 'mobile'} id
 * @property {number} maxDpr
 * @property {boolean} useWindowParallax
 * @property {boolean} useWheelNav
 * @property {boolean} useSwipeNav
 * @property {number} swipeThresholdPx
 * @property {number} swipeDominanceRatio — scrub axis must dominate: vertical scrub → |dy| ≥ |dx|×ratio; horizontal → |dx| ≥ |dy|×ratio
 * @property {'horizontal' | 'vertical'} [slideStackDragAxis] — mobile scrub along X or Y (default vertical)
 * @property {number} [slideStackDragPxPerSlide] — finger px per 1.0 slide index along scrub axis
 * @property {number} [slideStackDragArmPx] — min px along scrub axis before scrub replaces tilt
 * @property {number} [slideStackLogoSpinPerPx] — horizontal scrub only: world-Y spin (rad) per horizontal px
 * @property {1 | -1} [slideStackDragHorizontalSign] — multiply horizontal scrub delta; `-1` inverts (e.g. finger right decreases index)
 * @property {number} [slideStackSnapDuration] — gsap seconds to snap to integer slide (0 = instant)
 * @property {string} [slideStackSnapEase] — gsap ease name for release snap (e.g. expo.out)
 * @property {number} [slideStackMagneticCommit] — 0–0.49: fraction of inter-slide travel that feels “sticky”; 0 = linear (off)
 * @property {number} [slideStackMagneticStickPower] — >1 = more resistance before commit
 * @property {number} [slideStackMagneticPullPower] — >1 = stronger ease into the next slide after commit
 * @property {number} [slideStackMagneticFollow] — 0–1 lerp per move toward magnetic target (1 = no extra smoothing)
 * @property {boolean} [slideStackMagneticLogoStimulusOnCommit] — if not `false`, magnetic `commit` crossings call `triggerLogoStimulus` (same ramp/decay as Arrow Left/Right)
 * @property {boolean} clearHoverOnPointerEnd — reset tilt/hover when pointer lifts (touch UX)
 * @property {{ fov: number, position: { x: number, y: number, z: number } }} camera
 * @property {object} stack — passed into main `stackLayout` (curve + optional overrides below)
 *
 * **Optional on `stack`** (desktop/mobile; omit to keep main.js defaults):
 * - `vanishZ` — world Z where discarded slides sit (default `2`)
 * - `vanishOffsetX`, `vanishOffsetY` — added to front-slot X/Y for vanish point (default `0`)
 * - `frontSlideStackYawRad` — world Y tilt on the front card in the stack (rad)
 * - `frontSlideStackYawExitBlend` — how slide index blends out of that tilt
 * - `slideOffFrameYawRad` — Y rotation when a slide is “past” the float front (transition)
 * - `slideOffFrameRotationBlend` — width of that blend in slide-index space
 *
 * **Optional `headerBanner`** (viewport-locked `.viewport-header-banner` image):
 * CSS string values applied as `#app` custom properties — tune position/size per profile.
 * Omit on desktop to keep fixed top-right cap; set on mobile for viewport-relative fit (full image on narrow AR).
 *
 * @property {object} [headerBanner]
 * @property {string} [headerBanner.maxWidth] — e.g. `min(100vw - 24px, 96vmin)`
 * @property {string} [headerBanner.offsetY] — extra top offset, e.g. `8px` or `max(8px, env(safe-area-inset-top))`
 * @property {string} [headerBanner.objectPosition] — e.g. `top center` (whole graphic visible when scaled down)
 * @property {string} [headerBanner.right] — e.g. `auto` when centering
 * @property {string} [headerBanner.left] — e.g. `50%` when centering
 * @property {string} [headerBanner.transform] — e.g. `translateX(-50%)` with left 50%
 * @property {string} [headerBanner.maxHeight] — optional cap, e.g. `min(28vh, 200px)`
 *
 * **Optional `textUi`** — CSS strings → `#app` custom properties (mainly **`fontSize`** → `--ui-fixed-text-px`).
 * Mobile label positions are per-item **`top` / `right`** in `textOverlays.js`, not here.
 * Optional dock tuning (only if you use `dock: 'top-right'` **without** explicit insets on those items):
 *
 * @property {object} [textUi]
 * @property {string} [textUi.fontSize] — e.g. `clamp(14px, 3.6vmin, 22px)`
 * @property {string} [textUi.dockGap] — `--ui-dock-gap-px`
 * @property {string} [textUi.dockPadX] — `--ui-dock-pad-x`
 * @property {string} [textUi.dockPadY] — `--ui-dock-pad-y` (used when `dockTop` omitted)
 * @property {string} [textUi.dockTop] — full dock `top` override
 */

/** Viewport width at or below this uses mobile stack when pointer is coarse (touch). */
const MOBILE_MAX_WIDTH_PX = 768

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    stack: Object.freeze({ ...profile.stack }),
    camera: Object.freeze({
      ...profile.camera,
      position: Object.freeze({ ...profile.camera.position }),
    }),
    ...(profile.headerBanner
      ? { headerBanner: Object.freeze({ ...profile.headerBanner }) }
      : {}),
    ...(profile.textUi ? { textUi: Object.freeze({ ...profile.textUi }) } : {}),
  })
}

function desktopStack() {
  const xStart = -2.25
  const zStart = 0
  const xStep = 1.7
  const zStep = -0.8
  const scale = 1.33
  return {
    xStart,
    zStart,
    xStep,
    zStep,
    scale,
    plane: /** @type {StackCurvePlane} */ ('xz'),
    curveUseCustomEnd: true,
    curveStart: { x: xStart * scale, y: -0.12, z: zStart * scale },
    curveEnd: { x: 15, y: 1, z: -10.0 },
    curveBend: -1,
    curveVerticalBend: 0,
    slotSpreadExponent: 0.5,
  }
}

function mobileStack2() {
  const scale = 0.65
  // Vertical-depth stack in YZ (screen-up + into scene) for portrait framing
  return {
    xStart: 0,
    zStart: 0,
    xStep: 0,
    zStep: 0,
    scale,
    plane: /** @type {StackCurvePlane} */ ('yz'),
    curveUseCustomEnd: true,
    curveStart: { x: -0.4, y: -0.8, z: 0 },
    curveEnd: { x: -0.8, y: 4, z: -3 },
    curveBend: 0,
    curveVerticalBend: 0,
    slotSpreadExponent: 1,
  }
}

function mobileStack() {
  const scale = 0.85
  // Vertical-depth stack in YZ (screen-up + into scene) for portrait framing
  return {
    xStart: 0,
    zStart: 0,
    xStep: 0,
    zStep: -0.8,
    scale,
    plane: /** @type {StackCurvePlane} */ ('yz'),
    curveUseCustomEnd: true,
    curveStart: { x: -0.10, y: -0.6, z: 0 },
    curveEnd: { x: 5.8, y: -1.5, z: -9 },
    curveBend: 0,
    curveVerticalBend: 0,
    slotSpreadExponent: 0.3,
    vanishZ: 2,
    vanishOffsetX: -1.5,
    vanishOffsetY: 0,
    frontSlideStackYawRad: Math.PI / 16,
    frontSlideStackYawExitBlend: 0.8,
    slideOffFrameYawRad: Math.PI / 2,
    slideOffFrameRotationBlend: 1,
  }
}

/** @returns {LayoutProfile} */
function desktopProfile() {
  return {
    id: 'desktop',
    maxDpr: 2,
    useWindowParallax: true,
    useWheelNav: true,
    useSwipeNav: false,
    swipeThresholdPx: 48,
    swipeDominanceRatio: 1.2,
    clearHoverOnPointerEnd: false,
    camera: {
      fov: 100,
      position: { x: -0.6, y: 0.35, z: 2.5 },
    },
    stack: desktopStack(),
  }
}

/** @returns {LayoutProfile} */
function mobileProfile() {
  return {
    id: 'mobile',
    maxDpr: 1.5,
    useWindowParallax: false,
    useWheelNav: false,
    useSwipeNav: true,
    swipeThresholdPx: 0,
    swipeDominanceRatio: 0.2,
    slideStackDragAxis: 'horizontal',
    /** `-1` inverts horizontal scrub vs default (`1` = finger right → higher index, same as ArrowRight). */
    slideStackDragHorizontalSign: -1,
    /** Smaller = faster scrub through all slides for a given drag distance. */
    slideStackDragPxPerSlide: 80,
    slideStackDragArmPx: 0,
    /** Couple horizontal finger motion to Xbox Y rotation while scrubbing (rad per px). */
    slideStackLogoSpinPerPx: 0.005,
    slideStackSnapDuration: 0.5,
    slideStackSnapEase: 'expo.out',
    /** ~25% of each slide transition is “sticky”; past that, motion eases into the next slide. */
    slideStackMagneticCommit: 0.05,
    slideStackMagneticStickPower: 3,
    slideStackMagneticPullPower: 5,
    /** Slight extra follow to avoid shimmer when direction wiggles. */
    slideStackMagneticFollow: 0.2,
    /** Same logo kick/decay as arrow keys when scrub passes magnetic sticky zone (see `triggerLogoStimulus`). */
    slideStackMagneticLogoStimulusOnCommit: true,
    clearHoverOnPointerEnd: true,
    /**
     * Header: size vs viewport + horizontal placement. See LayoutProfile JSDoc above for presets.
     * Quick edits: `offsetY` = move down; `transform` = fine-tune (e.g. `translateX(calc(-50% + 20px))`).
     */
    headerBanner: {
      maxWidth: 'calc(200vw - max(0px, env(safe-area-inset-left) + env(safe-area-inset-right)))',
      offsetY: 'max(50px, env(safe-area-inset-top))',
      objectPosition: 'top right',
      right: 'max(0px, env(safe-area-inset-right))',
      left: '-185%',
      transform: 'translateX(50%)',
    },
    /** Default overlay font when items omit `fontSize`. Mobile labels use per-item `top`/`right` in `textOverlays.js`. */
    textUi: {
      fontSize: 'clamp(14px, 3.6vmin, 22px)',
    },
    camera: {
      fov: 88,
      position: { x: 0, y: 0.15, z: 3.15 },
    },
    stack: mobileStack(),
  }
}

/**
 * @returns {Readonly<LayoutProfile>}
 */
export function resolveLayoutProfile() {
  // Dev-only: force layout so Chrome + mouse can preview mobile stack without touch emulation.
  // Example: http://localhost:5173/?layout=mobile  (reload after changing the query)
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(window.location.search).get('layout')
    if (q === 'mobile') return freezeProfile(mobileProfile())
    if (q === 'desktop') return freezeProfile(desktopProfile())
  }

  const narrow = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const profile = narrow && coarse ? mobileProfile() : desktopProfile()
  return freezeProfile(profile)
}
