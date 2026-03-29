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
 * @property {number} swipeDominanceRatio — |dy| must exceed |dx| * this to arm vertical stack scrub
 * @property {number} [slideStackDragPxPerSlide] — finger px per 1.0 slide index (mobile scrub)
 * @property {number} [slideStackDragArmPx] — min vertical px before scrub replaces tilt
 * @property {number} [slideStackSnapDuration] — gsap seconds to snap to integer slide (0 = instant)
 * @property {string} [slideStackSnapEase] — gsap ease name for release snap (e.g. expo.out)
 * @property {number} [slideStackMagneticCommit] — 0–0.49: fraction of inter-slide travel that feels “sticky”; 0 = linear (off)
 * @property {number} [slideStackMagneticStickPower] — >1 = more resistance before commit
 * @property {number} [slideStackMagneticPullPower] — >1 = stronger ease into the next slide after commit
 * @property {number} [slideStackMagneticFollow] — 0–1 lerp per move toward magnetic target (1 = no extra smoothing)
 * @property {boolean} clearHoverOnPointerEnd — reset tilt/hover when pointer lifts (touch UX)
 * @property {{ fov: number, position: { x: number, y: number, z: number } }} camera
 * @property {object} stack — passed into main `stackLayout`
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
  const scale = 0.65
  // Vertical-depth stack in YZ (screen-up + into scene) for portrait framing
  return {
    xStart: 0,
    zStart: 0,
    xStep: 0,
    zStep: -0.8,
    scale,
    plane: /** @type {StackCurvePlane} */ ('yz'),
    curveUseCustomEnd: true,
    curveStart: { x: -0.4, y: -0.8, z: 0 },
    curveEnd: { x: 5.8, y: 4, z: -7 },
    curveBend: -0.85,
    curveVerticalBend: 0.8,
    slotSpreadExponent: 0.9,
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
    /** Smaller = faster scrub through all slides for a given drag distance. */
    slideStackDragPxPerSlide: 80,
    slideStackDragArmPx: 20,
    slideStackSnapDuration: 2,
    slideStackSnapEase: 'expo.out',
    /** ~25% of each slide transition is “sticky”; past that, motion eases into the next slide. */
    slideStackMagneticCommit: 0.2,
    slideStackMagneticStickPower: 2,
    slideStackMagneticPullPower: 4,
    /** Slight extra follow to avoid shimmer when direction wiggles. */
    slideStackMagneticFollow: 0.2,
    clearHoverOnPointerEnd: true,
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
