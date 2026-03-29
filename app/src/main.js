import * as THREE from 'three'
import gsap from 'gsap'

// Neutral env map for overlay (metallic PBR); kept dim to avoid blown-out look
function createNeutralEnvMap(renderer) {
  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0.4, 0.42, 0.45)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(envScene)
  const envMap = rt.texture
  pmrem.dispose()
  return envMap
}
import { loadGltfModel } from './gltfModel.js'
import { SCENE_OBJECT_CONFIGS, applySceneObjectBehaviour } from './sceneObjects.js'
import slidesStructure from './slides-structure.json'
import { mountTextOverlays } from './textOverlays.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

// Scene (no solid background so the background video shows through)
const scene = new THREE.Scene()
scene.background = null

// Overlay scene: rendered after main scene so its contents (e.g. GLTF model) draw on top
const overlayScene = new THREE.Scene()
overlayScene.background = null
// Overlay lights: kept moderate to avoid overexposure
const overlayAmbient = new THREE.AmbientLight(0xffffff, 0.5)
overlayScene.add(overlayAmbient)
const overlayDir = new THREE.DirectionalLight(0xffffff, 0.55)
overlayDir.position.set(2, 5, 4)
overlayScene.add(overlayDir)
const overlayFill = new THREE.DirectionalLight(0xffffff, 0.2)
overlayFill.position.set(-2, 2, 3)
overlayScene.add(overlayFill)
// Left-front light for the sit-idle character (silhouette and shading)
const overlayLeftFront = new THREE.DirectionalLight(0xffffff, 4)
overlayLeftFront.position.set(-3, 1, -1)
overlayLeftFront.target.position.set(-0.5, -2, -2.5)
overlayScene.add(overlayLeftFront)
overlayScene.add(overlayLeftFront.target)

// Camera
const camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.z = 2.5
camera.position.x = -0.6
camera.position.y = 0.35

/** Subtle view tilt from pointer position (whole window), typical Three.js “mouse parallax”. */
const CAMERA_PARALLAX_YAW_MAX = 0.02
const CAMERA_PARALLAX_PITCH_MAX = 0.02
/** `1` = default, `-1` = invert horizontal parallax. */
const CAMERA_PARALLAX_YAW_SIGN = -1
/** `1` = default, `-1` = invert vertical parallax. */
const CAMERA_PARALLAX_PITCH_SIGN = -1
const CAMERA_PARALLAX_SMOOTH = 2
const cameraParallaxBaseRotX = 0
const cameraParallaxBaseRotY = 0
const cameraParallaxBaseRotZ = 0
let cameraParallaxNdcX = 0
let cameraParallaxNdcY = 0
let cameraParallaxTargetNdcX = 0
let cameraParallaxTargetNdcY = 0

function setCameraParallaxFromClient(clientX, clientY) {
  const w = window.innerWidth
  const h = window.innerHeight
  if (w < 1 || h < 1) return
  cameraParallaxTargetNdcX = (clientX / w) * 2 - 1
  cameraParallaxTargetNdcY = -((clientY / h) * 2 - 1)
}

function stepCameraParallax(delta) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    camera.rotation.set(cameraParallaxBaseRotX, cameraParallaxBaseRotY, cameraParallaxBaseRotZ)
    return
  }
  const k = Math.min(1, CAMERA_PARALLAX_SMOOTH * delta)
  cameraParallaxNdcX += (cameraParallaxTargetNdcX - cameraParallaxNdcX) * k
  cameraParallaxNdcY += (cameraParallaxTargetNdcY - cameraParallaxNdcY) * k
  camera.rotation.x =
    cameraParallaxBaseRotX -
    cameraParallaxNdcY * CAMERA_PARALLAX_PITCH_MAX * CAMERA_PARALLAX_PITCH_SIGN
  camera.rotation.y =
    cameraParallaxBaseRotY +
    cameraParallaxNdcX * CAMERA_PARALLAX_YAW_MAX * CAMERA_PARALLAX_YAW_SIGN
  camera.rotation.z = cameraParallaxBaseRotZ
}

// Renderer
const container = document.querySelector('#app')
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setClearColor(0x000000, 0)
container.appendChild(renderer.domElement)

// Background layer elements (video, image, or custom per config)
const bgVideo = document.getElementById('bg-video')
const bgImage = document.getElementById('bg-image')
const bgCustom = document.getElementById('bg-custom')
const slideCounterEl = document.getElementById('slide-counter')

// Safari / WebKit (used for video rate limits and slightly larger overlay type to match other browsers’ optics)
const isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || /Apple/.test(navigator.vendor)

/** Viewport-fixed header (DOM, not WebGL) — `public/assets/header/` */
const HEADER_WEB_IMAGE_PATH = `${import.meta.env.BASE_URL}assets/header/textowebheader.webp`
const HEADER_WEB_IMAGE_OPACITY = 0.12
/** Display width cap (px); height follows aspect ratio. Not clamped to 100vw — stays this wide on narrow viewports (clips left). Top-right via `object-position`. */
const HEADER_WEB_IMAGE_MAX_WIDTH_PX = 1920
/** Extra downward shift (px); positive moves the banner down; top-right corner alignment uses `right` + `top` + safe-area. */
const HEADER_WEB_IMAGE_OFFSET_Y_PX = 25
/**
 * Viewport overlay text (CSS px) on `#app` as `--ui-fixed-text-px`. WebKit often renders this stack a touch smaller
 * than Chromium at the same px; bump slightly so it tracks the fixed-width header graphic.
 */
const VIEWPORT_UI_TEXT_PX = isSafari ? 18 : 16

container.style.setProperty('--ui-fixed-text-px', `${VIEWPORT_UI_TEXT_PX}px`)
container.style.setProperty('--ui-header-max-width-px', `${HEADER_WEB_IMAGE_MAX_WIDTH_PX}px`)
container.style.setProperty('--ui-header-offset-y', `${HEADER_WEB_IMAGE_OFFSET_Y_PX}px`)

mountTextOverlays(container, { viewportTextPx: VIEWPORT_UI_TEXT_PX })

{
  const headerImg = document.createElement('img')
  headerImg.className = 'viewport-header-banner'
  headerImg.src = HEADER_WEB_IMAGE_PATH
  headerImg.alt = ''
  headerImg.draggable = false
  headerImg.style.opacity = String(HEADER_WEB_IMAGE_OPACITY)
  container.appendChild(headerImg)
}

// Background hue shift (0–360 degrees); applied to video, image, and custom bg
const BACKGROUND_HUE_ROTATE_DEG = 0
container.style.setProperty('--bg-hue-rotate', `${BACKGROUND_HUE_ROTATE_DEG}deg`)

// Background video: same ramp / coast idea as the Xbox logo (`LOGO_RAMP_*`), but **forward `playbackRate` only**
// (no reverse playback — slide “back” still drives idle→fast forward via stimulus, never negative rate).
const VIDEO_PLAYBACK_IDLE = 0.5        // `playbackRate` scale when nav stimulus is 0
const VIDEO_PLAYBACK_PEAK_EXTRA = 4  // extra scale when stimulus = 1 (pairs with `LOGO_NAV_PEAK_EXTRA` feel)
const VIDEO_MAX_SIGNED_RATE = 8      // clamp on nonnegative `videoSignedPlaybackRate`
/**
 * 1/s — how fast `videoSignedPlaybackRate` chases its target when **speeding up** (higher = snappier).
 * Coast / settle still use `LOGO_COAST_DECAY` / `LOGO_RAMP_DOWN`.
 */
const VIDEO_SPEED_RAMP_UP = 8
/** Safari / iOS WebKit: no logo-linked variable speed — background video stays 1×. */
const VIDEO_LOGO_LINKED_PLAYBACK = !isSafari
// Minimum positive `playbackRate` when physics is enabled (Safari often ≥ 0.5)
const VIDEO_MIN_RATE_EFFECTIVE = isSafari ? 0.5 : 0.25
const VIDEO_BG_DEFAULT_RATE = VIDEO_LOGO_LINKED_PLAYBACK
  ? Math.max(VIDEO_MIN_RATE_EFFECTIVE, VIDEO_PLAYBACK_IDLE)
  : 1
/** Browser clamp for forward `playbackRate`. */
const VIDEO_PLAYBACK_RATE_HARD_MAX = 16
/**
 * If the playhead sits within this much of `duration` (slow/variable `ended`), snap to 0 so playback doesn’t stall.
 */
const VIDEO_FORWARD_END_SNAP_EPS = 0.04
/** Nonnegative forward playback scale; smoothed toward `VIDEO_PLAYBACK_IDLE + peak * stimulus`. */
let videoSignedPlaybackRate = VIDEO_PLAYBACK_IDLE

// Xbox logo: smooth angular velocity toward a target; decaying stimulus (0–1) from slide enter or overscroll.
const LOGO_IDLE_OMEGA = 0.2 // rad/s at stimulus 0
const LOGO_NAV_PEAK_EXTRA = 20 // extra rad/s when stimulus = 1 (decays quickly — not tied to full tween length)
const LOGO_STIMULUS_DECAY = 2 // 1/s, exp decay back down toward 0
const LOGO_STIMULUS_SMOOTH_UP = 8 // 1/s, smooth rise toward target when entering slides
/** Stimulus target value used by enter/overscroll; animate() eases stimulus toward this. */
const LOGO_STIMULUS_BUMP = 1
const LOGO_RAMP_UP = 8 // 1/s — approach when speeding up or reversing (keep moderate; avoid instant snap)
const LOGO_RAMP_DOWN = 1 // 1/s — gentle when near target
const LOGO_COAST_DECAY = 7 // 1/s — same-sign shed of speed above target (overscroll / post-kick)
const LOGO_MAX_OMEGA = 50

// Slide counter position in scene coordinates (same space as cards: x horizontal, y up; z=0)
const SLIDE_COUNTER_X = -400.2
const SLIDE_COUNTER_Y = -1.7
const _slideCounterPos = new THREE.Vector3()

bgVideo.muted = true
bgVideo.playsInline = true
bgVideo.setAttribute('playsinline', '')
// Loop: restart on ended (Safari-safe: rAF + try/catch, avoid sync seek during event)
bgVideo.addEventListener('ended', () => {
  requestAnimationFrame(() => {
    try {
      bgVideo.currentTime = 0
      bgVideo.play().catch(() => {})
    } catch (_) {}
  })
})
for (const ev of ['stalled', 'waiting']) {
  bgVideo.addEventListener(ev, () => {
    if (!bgVideo.classList.contains('is-active')) return
    bgVideo.play().catch(() => {})
  })
}

const BACKGROUND_CROSSFADE_DURATION = 0.4

function getActiveBgLayer() {
  if (bgVideo.classList.contains('is-active')) return bgVideo
  if (bgImage.classList.contains('is-active')) return bgImage
  if (bgCustom.classList.contains('is-active')) return bgCustom
  return null
}

function setBackgroundForPath() {
  const config = getBackgroundConfig(path)
  const currentLayer = getActiveBgLayer()
  videoSignedPlaybackRate = VIDEO_PLAYBACK_IDLE
  bgVideo.pause()

  let newLayer
  let newSrc = null

  if (!config) {
    newLayer = bgCustom
  } else {
    switch (config.type) {
      case 'video':
        if (config.src) {
          try {
            newSrc = config.src
            newLayer = bgVideo
            break
          } catch (e) {
            newLayer = bgCustom
            break
          }
        }
        newLayer = bgCustom
        break
      case 'image':
        if (config.src) {
          newSrc = config.src
          bgImage.src = config.src
          newLayer = bgImage
        } else {
          newLayer = bgCustom
        }
        break
      case 'custom':
      default:
        newLayer = bgCustom
        break
    }
  }

  const sameLayer = currentLayer === newLayer
  const sameContent = sameLayer && (
    (newLayer === bgVideo && newSrc === bgVideo.src) ||
    (newLayer === bgImage && newSrc === bgImage.src) ||
    (newLayer === bgCustom)
  )
  if (sameContent) return

  if (!currentLayer) {
    bgVideo.classList.remove('is-active')
    bgImage.classList.remove('is-active')
    bgCustom.classList.remove('is-active')
    if (newLayer === bgVideo && newSrc) {
      bgVideo.src = newSrc
      bgVideo.currentTime = 0
      bgVideo.playbackRate = VIDEO_BG_DEFAULT_RATE
      bgVideo.play().catch(() => {})
    }
    newLayer.classList.add('is-active')
    return
  }

  if (sameLayer) {
    // Same element, different content: fade out → update → fade in
    gsap.to(currentLayer, {
      opacity: 0,
      duration: BACKGROUND_CROSSFADE_DURATION / 2,
      ease: 'power2.inOut',
      onComplete: () => {
        if (newLayer === bgVideo && newSrc) {
          bgVideo.src = newSrc
          bgVideo.currentTime = 0
          bgVideo.playbackRate = VIDEO_BG_DEFAULT_RATE
          bgVideo.play().catch(() => {})
        }
        gsap.to(newLayer, {
          opacity: 1,
          duration: BACKGROUND_CROSSFADE_DURATION / 2,
          ease: 'power2.inOut',
          onComplete: () => {
            newLayer.style.opacity = ''
          },
        })
      },
    })
    return
  }

  // Different layers: crossfade
  if (newLayer === bgVideo && newSrc) {
    bgVideo.src = newSrc
    bgVideo.currentTime = 0
    bgVideo.playbackRate = VIDEO_BG_DEFAULT_RATE
  }
  newLayer.style.opacity = '0'
  newLayer.style.zIndex = '1'
  currentLayer.style.zIndex = '0'
  newLayer.classList.add('is-active')
  if (newLayer === bgVideo) bgVideo.play().catch(() => {})

  gsap.to(currentLayer, {
    opacity: 0,
    duration: BACKGROUND_CROSSFADE_DURATION,
    ease: 'power2.inOut',
    onComplete: () => {
      currentLayer.classList.remove('is-active')
      currentLayer.style.zIndex = ''
      if (currentLayer === bgVideo) bgVideo.pause()
    },
  })
  gsap.to(newLayer, {
    opacity: 1,
    duration: BACKGROUND_CROSSFADE_DURATION,
    ease: 'power2.inOut',
    onComplete: () => {
      newLayer.style.opacity = ''
      newLayer.style.zIndex = ''
    },
  })
}
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

overlayScene.environment = createNeutralEnvMap(renderer)
overlayScene.environmentIntensity = 0.45

const clock = new THREE.Clock()
const animationMixers = []
let sitIdleVideoTexture = null

// 3D objects: load from SCENE_OBJECT_CONFIGS (see sceneObjects.js)
overlayScene.add(camera)

SCENE_OBJECT_CONFIGS.forEach((objConfig) => {
  loadGltfModel(scene, objConfig.url, {
    position: { x: 0, y: 0, z: 0 },
    scale: objConfig.scale,
    alwaysOnTop: objConfig.alwaysOnTop ?? false,
    overlayScene: objConfig.scene === 'overlay' ? overlayScene : undefined,
    onLoad: (model) => {
      objConfig.model = model
      if (objConfig.position?.mode === 'camera') {
        overlayScene.remove(model)
        camera.add(model)
      }
    },
  }).catch(() => {})
})

// FBX model with animation (Sitting Idle) – file lives in assets/3D/sit-idle/
const fbxLoader = new FBXLoader()
fbxLoader.setPath('/assets/3D/sit-idle/')
fbxLoader.load(
  encodeURI('Sitting Idle.fbx'),
  (group) => {
    const box = new THREE.Box3().setFromObject(group)
    const center = new THREE.Vector3()
    box.getCenter(center)
    group.position.sub(center)
    // Mixamo-style FBX often in cm; scale down so ~1–2 units tall in view
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const fbxScale = 9.5 // increase to make the character bigger (e.g. 2, 3)
    const sitIdleMirrorX = -1 // -1 = mirror left/right, 1 = normal
    const sitIdleMirrorTextureX = -1 // -1 = mirror video left/right (e.g. match character mirror), 1 = normal
    group.scale.setScalar(fbxScale / maxDim)
    group.scale.x *= sitIdleMirrorX
    const wrapper = new THREE.Group()
    wrapper.add(group)
    // In front of camera (camera at ~z=4): slightly left, low, and forward
    wrapper.position.set(1, -2.6, -4)
    // Rotation in radians: X = tilt, Y = spin left/right, Z = roll (e.g. Math.PI = 180°)
    wrapper.rotation.set(Math.PI/64, -Math.PI/16, 0)
    overlayScene.add(wrapper)
    if (group.animations && group.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(group)
      group.animations.forEach((clip) => mixer.clipAction(clip).play())
      animationMixers.push(mixer)
    }
    // Apply video as diffuse texture and keep normal map for lighting/silhouette
    const SIT_IDLE_BASE = '/assets/3D/sit-idle/'
    const video = document.createElement('video')
    video.src = SIT_IDLE_BASE + encodeURI('texture8.mp4')
    video.loop = true
    video.muted = true
    video.playsInline = true
    video.play().catch((e) => console.warn('Sit-idle video texture autoplay:', e))
    const videoTex = new THREE.VideoTexture(video)
    videoTex.colorSpace = THREE.SRGBColorSpace
    videoTex.minFilter = THREE.LinearFilter
    videoTex.magFilter = THREE.LinearFilter
    // Clamp so the video doesn’t tile and break up; deforms with mesh UVs only
    videoTex.wrapS = videoTex.wrapT = THREE.ClampToEdgeWrapping
    // Tweak to fit your character’s UV layout: lower repeat = zoom in; sitIdleMirrorTextureX flips video horizontally
    videoTex.repeat.set(sitIdleMirrorTextureX, 1)
    videoTex.offset.set(sitIdleMirrorTextureX === -1 ? 1 : 0, 0)
    sitIdleVideoTexture = videoTex
    const texLoader = new THREE.TextureLoader().setPath(SIT_IDLE_BASE)
    const normalTex = texLoader.load(encodeURI('tripo_normal_96033f95-3167-4070-bcee-43528d052148.jpg'), undefined, undefined, (e) => console.warn('Sit-idle normal texture failed', e))
    group.traverse((child) => {
      if (!child.isMesh || !child.material) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      const newMats = materials.map((mat) => {
        return new THREE.MeshStandardMaterial({
          map: videoTex,
          normalMap: normalTex,
          color: mat.color ? mat.color.clone() : 0xffffff,
          roughness: 0.0,
          metalness: 0.0,
        })
      })
      child.material = newMats.length === 1 ? newMats[0] : newMats
    })
    // Project video from the front (one coherent image, no camouflage): UVs from world X/Y
    wrapper.updateMatrixWorld(true)
    const projBox = new THREE.Box3().setFromObject(group)
    const projSize = new THREE.Vector3()
    projBox.getSize(projSize)
    const dx = Math.max(projSize.x, 1e-5)
    const dy = Math.max(projSize.y, 1e-5)
    const _worldPos = new THREE.Vector3()
    group.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return
      const geo = child.geometry
      const pos = geo.attributes.position
      const uvs = new Float32Array(pos.count * 2)
      for (let i = 0; i < pos.count; i++) {
        _worldPos.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld)
        uvs[i * 2] = (_worldPos.x - projBox.min.x) / dx
        uvs[i * 2 + 1] = (_worldPos.y - projBox.min.y) / dy
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    })
  },
  undefined,
  (err) => console.error('FBX load failed:', err)
)

// Tree from config (single source of truth)
const ROOT_GROUP = slidesStructure.root

function getChildren(node) {
  return node?.children ?? []
}

/** Get the node that "owns" the current group (whose children we're viewing). Null when at root. */
function getOwnerNode(path) {
  if (path.length <= 1) return null
  const parentEntry = path[path.length - 2]
  const currentEntry = path[path.length - 1]
  return parentEntry.group[currentEntry.parentIndex]
}

/** Background config for current path: rootBackground at root, else owner node's background. */
function getBackgroundConfig(path) {
  if (path.length === 1) return slidesStructure.rootBackground ?? null
  const owner = getOwnerNode(path)
  return owner?.background ?? null
}

// Path stack: current page = path[path.length - 1]
let path = [{ group: ROOT_GROUP, parentIndex: null }]
function currentPage() {
  return path[path.length - 1]
}
function currentGroup() {
  return currentPage().group
}

// Slot positions: configurable curved trajectory from first slot to last slot.
const X_START = -2.25
const Z_START = 0
const X_STEP = 1.7
const Z_STEP = -0.8
const SCALE = 1.33

// Curve controls for stack trajectory.
// Keep defaults close to the current linear stack; tweak these to experiment.
const STACK_CURVE_USE_CUSTOM_END = true
const STACK_CURVE_START = { x: X_START * SCALE, y: -0.12, z: Z_START * SCALE }
const STACK_CURVE_END = { x: 15, y: 1, z: -10.0 } // used when STACK_CURVE_USE_CUSTOM_END = true
const STACK_CURVE_PLANE = 'xz' // 'xz' | 'xy' | 'yz'
const STACK_CURVE_BEND = -1 // signed amount of curvature in plane units (0 = straight line)
const STACK_CURVE_VERTICAL_BEND = 0 // secondary axis bend (e.g. arc lift/drop)
/**
 * How slide indices map to position along the curve (0 = front, 1 = back along path).
 * 1 = even spacing in curve parameter (default).
 * >1 = pack slots toward the front → 1st covers 2nd more than (n−1) covers n.
 * <1 = pack toward the back → deeper pairs overlap more.
 */
const STACK_SLOT_SPREAD_EXPONENT = 0.5

function normalizeVec3(v) {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len <= 1e-6) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function getCurveControlPoint(start, end) {
  const mid = {
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5,
    z: (start.z + end.z) * 0.5,
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z

  let perp = { x: 0, y: 0, z: 0 }
  if (STACK_CURVE_PLANE === 'xy') {
    perp = normalizeVec3({ x: -dy, y: dx, z: 0 })
    return {
      x: mid.x + perp.x * STACK_CURVE_BEND,
      y: mid.y + perp.y * STACK_CURVE_BEND,
      z: mid.z + STACK_CURVE_VERTICAL_BEND,
    }
  }
  if (STACK_CURVE_PLANE === 'yz') {
    perp = normalizeVec3({ x: 0, y: -dz, z: dy })
    return {
      x: mid.x + STACK_CURVE_VERTICAL_BEND,
      y: mid.y + perp.y * STACK_CURVE_BEND,
      z: mid.z + perp.z * STACK_CURVE_BEND,
    }
  }
  // Default: XZ plane
  perp = normalizeVec3({ x: -dz, y: 0, z: dx })
  return {
    x: mid.x + perp.x * STACK_CURVE_BEND,
    y: mid.y + STACK_CURVE_VERTICAL_BEND,
    z: mid.z + perp.z * STACK_CURVE_BEND,
  }
}

function quadraticBezier3(p0, p1, p2, t) {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  return {
    x: uu * p0.x + 2 * u * t * p1.x + tt * p2.x,
    y: uu * p0.y + 2 * u * t * p1.y + tt * p2.y,
    z: uu * p0.z + 2 * u * t * p1.z + tt * p2.z,
  }
}

function getSlotPositions(n) {
  if (n <= 0) return []
  const start = STACK_CURVE_START
  const end = STACK_CURVE_USE_CUSTOM_END
    ? STACK_CURVE_END
    : {
        x: (X_START + Math.max(0, n - 1) * X_STEP) * SCALE,
        y: 0,
        z: (Z_START + Math.max(0, n - 1) * Z_STEP) * SCALE,
      }
  if (n === 1) return [{ x: start.x, y: start.y, z: start.z }]
  const control = getCurveControlPoint(start, end)
  const p = STACK_SLOT_SPREAD_EXPONENT
  return Array.from({ length: n }, (_, i) => {
    const linear = i / (n - 1)
    const t = p === 1 ? linear : Math.pow(linear, p)
    return quadraticBezier3(start, control, end, t)
  })
}

let slotPositions = getSlotPositions(currentGroup().length)

const VANISH_Z = 2
function getVanishPosition() {
  return { x: slotPositions[0].x, y: slotPositions[0].y, z: VANISH_Z }
}

// Transition speeds (enter subgroup / go back to parent)
const TRANSITION_COLLAPSE_DURATION = 0.25
const TRANSITION_PAGE_TURN_OUT_DURATION = 0.4
const TRANSITION_PAGE_TURN_IN_DURATION = 0.4
const TRANSITION_UNCROLL_DURATION = 0.25

// Press animation when clicking the front slide to enter (shrink → restore → enter)
const PRESS_SHRINK_DURATION = 0.08
const PRESS_RESTORE_DURATION = 0.16
const PRESS_SCALE = 0.75

/**
 * Extra world Y rotation (rad) on the visible front stack slide; the next slide stays at 0 relative to this.
 * Positive ≈ front card’s right edge swings toward the camera in the default layout (negate to flip).
 * `gltfSlideIndex` blends between slides during navigation so the handoff stays smooth.
 */
const FRONT_SLIDE_STACK_YAW_RAD = Math.PI / 16
/** Slide-index span over which the old front eases stack yaw to 0 as it moves past the front. */
const FRONT_SLIDE_STACK_YAW_EXIT_BLEND = 0.8

/**
 * World Y rotation (rad) when a slide is fully “off” the front (past the float front index while leaving).
 * Blends smoothly from stack yaw (front tilt) ↔ this value using `gltfSlideIndex`, so going forward and backward match.
 */
const SLIDE_OFF_FRAME_YAW_RAD = Math.PI / 4
/**
 * How wide the rotation blend is in slide-index space (same units as `gltfSlideIndex` tween).
 * Larger = longer ease between front stack pose and off-frame pose.
 */
const SLIDE_OFF_FRAME_ROTATION_BLEND = 1

/** Pointer-driven tilt on the front slide only (adds on top of stack / off-frame yaw). */
const FRONT_SLIDE_HOVER_TILT_ENABLED = true
/** Max pitch (rotation.x, rad) from pointer top vs bottom on the card. */
const FRONT_SLIDE_HOVER_TILT_MAX_X = 0.05
/** Max extra yaw (rotation.y, rad) from pointer left vs right on the card. */
const FRONT_SLIDE_HOVER_TILT_MAX_Y = 0.05
/** How fast hover tilt follows the pointer (1/s). */
const FRONT_SLIDE_HOVER_TILT_SMOOTH = 8

/** Front slide: scale + world offset on hover (separate from deeper slides). */
const FRONT_SLIDE_HOVER_POP_ENABLED = true
const FRONT_SLIDE_HOVER_POP_SCALE = 1.04
const FRONT_SLIDE_HOVER_POP_LIFT_WORLD = 0.14
const FRONT_SLIDE_HOVER_POP_LIFT_X = 0
const FRONT_SLIDE_HOVER_POP_LIFT_Y = 0.04
const FRONT_SLIDE_HOVER_POP_SMOOTH = 8

/** Smooth front-card stack / off-frame yaw when `gltfSlideIndex` snaps after a slide advance (1/s). */
const FRONT_STACK_VISUAL_YAW_SMOOTH = 14

/** Deeper (non-front) visible slides: scale + offset toward camera on hover. */
const DEEP_SLIDE_HOVER_ENABLED = true
const DEEP_SLIDE_HOVER_SCALE = 1.07
/** World-units pop along XZ toward the camera. */
const DEEP_SLIDE_HOVER_LIFT_WORLD = 0.32
/** Optional sideways nudge while hovered (world X). */
const DEEP_SLIDE_HOVER_LIFT_X = 0.2
/** Optional upward nudge while hovered (world Y). */
const DEEP_SLIDE_HOVER_LIFT_Y = 0.0
const DEEP_SLIDE_HOVER_SMOOTH = 12

/** World position of the page-turn axis: left border of canvas at given depth, same y as slide. */
function getPageTurnAxis(slidePos) {
  const leftNDC = new THREE.Vector3(-1, 0, 0.5).unproject(camera)
  const dir = leftNDC.clone().sub(camera.position).normalize()
  const t = (slidePos.z - camera.position.z) / dir.z
  const axis = camera.position.clone().add(dir.clone().multiplyScalar(t))
  return { x: axis.x, y: slidePos.y ?? 0, z: slidePos.z }
}

/** Y rotation from page-turn animations only; combined with stack yaw in syncSlideStackRotations(). */
function setCardPageTurnState(card, axis, angle, restX) {
  card.userData.pageTurnY = angle
  const dx = restX - axis.x
  card.position.x = axis.x + dx * Math.cos(angle)
  card.position.z = axis.z + dx * Math.sin(angle)
}

function getSlideStackYawRad(slideIndex, frontFloat) {
  const maxYaw = FRONT_SLIDE_STACK_YAW_RAD
  if (maxYaw === 0) return 0
  const d = slideIndex - frontFloat
  if (d >= 1) return 0
  if (d >= 0) {
    return maxYaw * (1 - THREE.MathUtils.smoothstep(d, 0, 1))
  }
  const b = Math.max(1e-4, FRONT_SLIDE_STACK_YAW_EXIT_BLEND)
  if (d <= -b) return 0
  return maxYaw * THREE.MathUtils.smoothstep(d, -b, 0)
}

/** 0 = use stack yaw only; 1 = use SLIDE_OFF_FRAME_YAW_RAD (slide has moved past the float front). */
function getOffFrameYawBlend(slideIndex, frontFloat) {
  if (SLIDE_OFF_FRAME_YAW_RAD === 0) return 0
  const w = Math.max(1e-4, SLIDE_OFF_FRAME_ROTATION_BLEND)
  const delta = slideIndex - frontFloat
  if (delta >= 0) return 0
  if (delta <= -w) return 1
  return 1 - THREE.MathUtils.smoothstep(delta, -w, 0)
}

function getCombinedStackVisualYawRad(slideIndex, frontFloat) {
  const stackYaw = getSlideStackYawRad(slideIndex, frontFloat)
  const offBlend = getOffFrameYawBlend(slideIndex, frontFloat)
  return THREE.MathUtils.lerp(stackYaw, SLIDE_OFF_FRAME_YAW_RAD, offBlend)
}

let _frontStackYawSmoothed = 0
let _frontStackYawSmoothedForIndex = -1

function syncSlideStackRotations(delta) {
  const noStackTilt = FRONT_SLIDE_STACK_YAW_RAD === 0
  const noOffFrame = SLIDE_OFF_FRAME_YAW_RAD === 0
  if (noStackTilt && noOffFrame && cards.every((c) => (c.userData.pageTurnY ?? 0) === 0)) {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]
      const page = c.userData.pageTurnY ?? 0
      c.rotation.x = 0
      if (c.rotation.y !== page) c.rotation.y = page
    }
    return
  }

  const useSmoothFrontStack = !noStackTilt || !noOffFrame
  const frontIdx = currentIndex
  if (useSmoothFrontStack && cards[frontIdx]) {
    if (_frontStackYawSmoothedForIndex !== frontIdx) {
      _frontStackYawSmoothed = getCombinedStackVisualYawRad(frontIdx, gltfSlideIndex)
      _frontStackYawSmoothedForIndex = frontIdx
    }
    const targetYaw = getCombinedStackVisualYawRad(frontIdx, gltfSlideIndex)
    const sk = 1 - Math.exp(-FRONT_STACK_VISUAL_YAW_SMOOTH * delta)
    _frontStackYawSmoothed += (targetYaw - _frontStackYawSmoothed) * sk
  }

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const idx = c.userData?.index
    if (idx == null) continue
    const page = c.userData.pageTurnY ?? 0
    c.rotation.x = 0
    const stackPart =
      useSmoothFrontStack && idx === frontIdx
        ? _frontStackYawSmoothed
        : getCombinedStackVisualYawRad(idx, gltfSlideIndex)
    c.rotation.y = page + stackPart
  }
}

const BASE_DURATION = 0.6
const MIN_DURATION = 0.3
const STREAK_RESET_MS = 400
const EASE = 'power2.out'

let lastPressTime = 0
let lastDirection = null
let streak = 0
function getDurationForDirection(direction) {
  const now = Date.now()
  if (lastDirection !== direction || now - lastPressTime > STREAK_RESET_MS) streak = 1
  else streak++
  lastDirection = direction
  lastPressTime = now
  return Math.max(MIN_DURATION, BASE_DURATION - (streak - 1) * 0.05)
}

const CARD_WIDTH = 1.4 * 1.5 * SCALE
const CARD_HEIGHT = 1.4 * 1.5 * SCALE

let hoverTiltTargetX = 0
let hoverTiltTargetY = 0
let hoverTiltCurrentX = 0
let hoverTiltCurrentY = 0
let pointerIsOverCanvas = false
/** Slide index under pointer for deep-stack hover, or -1. */
let hoverDeepIndex = -1
/** True when pointer is over the front slide (for pop lift / scale). */
let hoverFrontPop = false

const _hoverLocal = new THREE.Vector3()
const _deepHoverDir = new THREE.Vector3()

function updateSlideHoverFromPointer(clientX, clientY) {
  hoverTiltTargetX = 0
  hoverTiltTargetY = 0
  hoverDeepIndex = -1
  hoverFrontPop = false
  if (cards.length === 0 || isTransitioning) return

  const el = renderer.domElement
  const rect = el.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(cardMeshes)
  if (hits.length === 0) return

  // Match click behaviour: prefer the current front card so vanishing / stacked meshes
  // closer along Z do not eat the ray and shrink the hover “effective area”.
  const frontHit = hits.find((h) => h.object.parent?.userData?.index === currentIndex)
  const hit = frontHit ?? hits[0]
  const group3d = hit.object.parent
  const idx = group3d?.userData?.index
  if (idx == null) return

  const front = cards[currentIndex]
  const pageTurnBusy = front && Math.abs(front.userData.pageTurnY ?? 0) > 1e-5

  if (idx === currentIndex && group3d === cards[currentIndex] && !pageTurnBusy && !activeTimeline) {
    if (FRONT_SLIDE_HOVER_POP_ENABLED) hoverFrontPop = true
    if (FRONT_SLIDE_HOVER_TILT_ENABLED) {
      _hoverLocal.copy(hit.point)
      group3d.worldToLocal(_hoverLocal)
      const halfW = CARD_WIDTH * 0.5
      const halfH = CARD_HEIGHT * 0.5
      const nx = THREE.MathUtils.clamp(_hoverLocal.x / halfW, -1, 1)
      const ny = THREE.MathUtils.clamp(_hoverLocal.y / halfH, -1, 1)
      hoverTiltTargetX = -ny * FRONT_SLIDE_HOVER_TILT_MAX_X
      hoverTiltTargetY = nx * FRONT_SLIDE_HOVER_TILT_MAX_Y
    }
    return
  }

  if (
    DEEP_SLIDE_HOVER_ENABLED &&
    idx > currentIndex &&
    !activeTimeline &&
    group3d === cards[idx] &&
    getCardOpacity(cards[idx]) > 0.05
  ) {
    hoverDeepIndex = idx
  }
}

function stepAndApplyFrontSlideHoverTilt(delta) {
  if (!FRONT_SLIDE_HOVER_TILT_ENABLED || cards.length === 0) return
  const k = 1 - Math.exp(-FRONT_SLIDE_HOVER_TILT_SMOOTH * delta)
  const front = cards[currentIndex]
  if (!pointerIsOverCanvas || isTransitioning || (front && Math.abs(front.userData.pageTurnY ?? 0) > 1e-5)) {
    hoverTiltTargetX = 0
    hoverTiltTargetY = 0
  }
  hoverTiltCurrentX += (hoverTiltTargetX - hoverTiltCurrentX) * k
  hoverTiltCurrentY += (hoverTiltTargetY - hoverTiltCurrentY) * k
  if (!front) return
  front.rotation.x = hoverTiltCurrentX
  front.rotation.y += hoverTiltCurrentY
}

function stepAndApplyDeepSlideHover(delta) {
  if (!DEEP_SLIDE_HOVER_ENABLED || cards.length === 0) return
  const k = 1 - Math.exp(-DEEP_SLIDE_HOVER_SMOOTH * delta)
  const allowDeep =
    pointerIsOverCanvas && !isTransitioning && !activeTimeline

  for (let i = 0; i < cards.length; i++) {
    if (i === currentIndex) continue
    const c = cards[i]
    const wantLift = allowDeep && i === hoverDeepIndex ? DEEP_SLIDE_HOVER_LIFT_WORLD : 0
    const wantX = allowDeep && i === hoverDeepIndex ? DEEP_SLIDE_HOVER_LIFT_X : 0
    const wantY = allowDeep && i === hoverDeepIndex ? DEEP_SLIDE_HOVER_LIFT_Y : 0
    const wantScale = allowDeep && i === hoverDeepIndex ? DEEP_SLIDE_HOVER_SCALE : 1

    const prevLift = c.userData._hoverLiftApplied ?? 0
    const prevX = c.userData._hoverXApplied ?? 0
    const prevY = c.userData._hoverYApplied ?? 0
    _deepHoverDir.subVectors(camera.position, c.position)
    _deepHoverDir.y = 0
    if (_deepHoverDir.lengthSq() < 1e-8) _deepHoverDir.set(0, 0, 1)
    else _deepHoverDir.normalize()

    c.position.x -= _deepHoverDir.x * prevLift + prevX
    c.position.z -= _deepHoverDir.z * prevLift
    c.position.y -= prevY

    const newLift = prevLift + (wantLift - prevLift) * k
    const newX = prevX + (wantX - prevX) * k
    const newY = prevY + (wantY - prevY) * k
    c.position.x += _deepHoverDir.x * newLift + newX
    c.position.z += _deepHoverDir.z * newLift
    c.position.y += newY
    c.userData._hoverLiftApplied = newLift
    c.userData._hoverXApplied = newX
    c.userData._hoverYApplied = newY

    const curS = c.scale.x
    const newS = curS + (wantScale - curS) * k
    c.scale.setScalar(newS)
  }
}

function stepAndApplyFrontSlideHoverPop(delta) {
  if (!FRONT_SLIDE_HOVER_POP_ENABLED || cards.length === 0) return
  const k = 1 - Math.exp(-FRONT_SLIDE_HOVER_POP_SMOOTH * delta)
  const front = cards[currentIndex]
  if (!front) return
  const pageBusy = Math.abs(front.userData.pageTurnY ?? 0) > 1e-5
  const allowPop =
    pointerIsOverCanvas && !isTransitioning && !activeTimeline && hoverFrontPop && !pageBusy

  const wantLift = allowPop ? FRONT_SLIDE_HOVER_POP_LIFT_WORLD : 0
  const wantX = allowPop ? FRONT_SLIDE_HOVER_POP_LIFT_X : 0
  const wantY = allowPop ? FRONT_SLIDE_HOVER_POP_LIFT_Y : 0
  const wantScale = allowPop ? FRONT_SLIDE_HOVER_POP_SCALE : 1

  const prevLift = front.userData._hoverLiftApplied ?? 0
  const prevX = front.userData._hoverXApplied ?? 0
  const prevY = front.userData._hoverYApplied ?? 0
  _deepHoverDir.subVectors(camera.position, front.position)
  _deepHoverDir.y = 0
  if (_deepHoverDir.lengthSq() < 1e-8) _deepHoverDir.set(0, 0, 1)
  else _deepHoverDir.normalize()

  front.position.x -= _deepHoverDir.x * prevLift + prevX
  front.position.z -= _deepHoverDir.z * prevLift
  front.position.y -= prevY

  const newLift = prevLift + (wantLift - prevLift) * k
  const newX = prevX + (wantX - prevX) * k
  const newY = prevY + (wantY - prevY) * k
  front.position.x += _deepHoverDir.x * newLift + newX
  front.position.z += _deepHoverDir.z * newLift
  front.position.y += newY
  front.userData._hoverLiftApplied = newLift
  front.userData._hoverXApplied = newX
  front.userData._hoverYApplied = newY

  const curS = front.scale.x
  const newS = curS + (wantScale - curS) * k
  front.scale.setScalar(newS)
}

/** Set false to use MeshBasicMaterial for art — no blur shader, no per-frame blur uniform updates (lightest path). */
const SLIDE_STACK_BLUR_ENABLED = false

/**
 * When true, only the front slide is full color; deeper slides are grayscale.
 * Saturation eases smoothly between 1st and 2nd stack positions (uses gltfSlideIndex during transitions).
 */
const SLIDE_FRONT_COLOR_ONLY = false

/** True when slide art needs a custom shader (blur and/or stack desaturation). */
const SLIDE_USE_ART_SHADER = SLIDE_STACK_BLUR_ENABLED || SLIDE_FRONT_COLOR_ONLY

/** Stack blur: front slide sharp; deeper slides blur more; follows gltfSlideIndex during transitions. */
const SLIDE_BLUR_MAX_UV = 0.0
const SLIDE_BLUR_UV_PER_STACK = 0.0

/**
 * Binomial blur kernel size: 1 → 3×3, 2 → 5×5, 3 → 7×7, 4 → 9×9 (more taps = smoother, heavier GPU).
 * Pascal row (2R) ⊗ same — Gaussian-like. Change this to resize the kernel.
 */
const SLIDE_BLUR_KERNEL_RADIUS = 11

function binomialRow(n) {
  const row = []
  let c = 1
  row.push(c)
  for (let k = 1; k <= n; k++) {
    c = (c * (n - k + 1)) / k
    row.push(Math.round(c))
  }
  return row
}

function buildSlideArtFragmentShader(radius) {
  const R = Math.max(1, Math.min(4, Math.floor(radius)))
  const size = 2 * R + 1
  const coeffs = binomialRow(2 * R)
  const sum1d = coeffs.reduce((a, b) => a + b, 0)
  const norm = 1 / (sum1d * sum1d)
  let binomFn = 'float binomK(int k) {\n'
  for (let k = 0; k < coeffs.length; k++) {
    binomFn += `  if (k == ${k}) return ${coeffs[k]}.0;\n`
  }
  binomFn += '  return 0.0;\n}\n'
  const stepMul = (0.84 / R).toFixed(8)
  const normStr = norm.toExponential(10)
  return `
uniform sampler2D map;
uniform float blurStrength;
uniform float saturation;
uniform float opacity;
varying vec2 vUv;

${binomFn}
void main() {
  vec4 c;
  if (blurStrength < 1.0e-6) {
    c = texture2D(map, vUv);
  } else {
    vec2 stepUV = vec2(blurStrength * ${stepMul});
    c = vec4(0.0);
    for (int j = 0; j < ${size}; j++) {
      for (int i = 0; i < ${size}; i++) {
        float w = binomK(i) * binomK(j) * ${normStr};
        vec2 off = vec2(float(i - ${R}), float(j - ${R})) * stepUV;
        c += texture2D(map, vUv + off) * w;
      }
    }
  }
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(luma), c.rgb, saturation);
  gl_FragColor = vec4(c.rgb, c.a * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
}

const slideArtFragmentShaderSimple = `
uniform sampler2D map;
uniform float saturation;
uniform float opacity;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(map, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(luma), c.rgb, saturation);
  gl_FragColor = vec4(c.rgb, c.a * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const slideArtVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const slideArtFragmentShader = SLIDE_STACK_BLUR_ENABLED
  ? buildSlideArtFragmentShader(SLIDE_BLUR_KERNEL_RADIUS)
  : ''

function createSlideArtShaderMaterial() {
  const fullBlur = SLIDE_STACK_BLUR_ENABLED
  const uniforms = {
    map: { value: null },
    saturation: { value: 1 },
    opacity: { value: 1 },
  }
  if (fullBlur) uniforms.blurStrength = { value: 0 }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: slideArtVertexShader,
    fragmentShader: fullBlur ? slideArtFragmentShader : slideArtFragmentShaderSimple,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Inner slide size = INNER_UV_RATIO of the art image (e.g. 2/3). Art plane uses full image so outer bleed and transparency are visible. */
const INNER_UV_RATIO = 2 / 3
/** Full art plane: size = inner / ratio (outer bound). UVs 0–1 with V flipped so the texture is not vertically mirrored. */
function createFullArtPlaneGeometry(innerWidth, innerHeight) {
  const w = innerWidth / INNER_UV_RATIO
  const h = innerHeight / INNER_UV_RATIO
  const g = new THREE.PlaneGeometry(w, h)
  const uv = g.attributes.uv
  uv.setXY(0, 0, 1)
  uv.setXY(1, 1, 1)
  uv.setXY(2, 0, 0)
  uv.setXY(3, 1, 0)
  uv.needsUpdate = true
  return g
}

const textureLoader = new THREE.TextureLoader()
/** Cache of loaded art textures by URL so go-back etc. can show art immediately during animations. */
const artTextureCache = new Map()

function preloadGroupArt(group) {
  if (!group) return
  group.forEach((node) => {
    if (node.art && !artTextureCache.has(node.art)) {
      textureLoader.load(node.art, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = true
        artTextureCache.set(node.art, tex)
      })
    }
  })
}

function makeLabelTexture(parentIndex, index) {
  const label = parentIndex == null || parentIndex === -1 ? `R, ${index}` : `${parentIndex}, ${index}`
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 36px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function createCardsForGroup(group, parentIndexForLabels) {
  const n = group.length
  const positions = getSlotPositions(n)
  const borderThickness = 0.01 * 1.5 * SCALE
  const innerWidth = CARD_WIDTH - 2 * borderThickness
  const innerHeight = CARD_HEIGHT - 2 * borderThickness
  const borderGeometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT)
  const innerGeometry = new THREE.PlaneGeometry(innerWidth, innerHeight)
  const borderMaterial = new THREE.MeshBasicMaterial({
    color: 0x808080,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const labelSize = 0.32
  const labelGeometry = new THREE.PlaneGeometry(labelSize, labelSize)
  const artGeometry = createFullArtPlaneGeometry(innerWidth, innerHeight)
  const cards = []
  for (let i = 0; i < n; i++) {
    const node = group[i]
    const pos = positions[i]
    const group3d = new THREE.Group()
    group3d.userData = { index: i, parentIndex: parentIndexForLabels, pageTurnY: 0 }
    group3d.position.set(pos.x, pos.y ?? 0, pos.z)
    if (!node.art) {
      const border = new THREE.Mesh(borderGeometry, borderMaterial.clone())
      border.position.z = 0
      group3d.add(border)
    }

    if (node.art) {
      const artMaterial = SLIDE_USE_ART_SHADER
        ? createSlideArtShaderMaterial()
        : new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          alphaTest: 0,
        })
      if (SLIDE_USE_ART_SHADER) {
        artMaterial.opacity = 0
        artMaterial.uniforms.opacity.value = 0
      }
      group3d.userData.artMaterial = SLIDE_USE_ART_SHADER ? artMaterial : null
      const artPlane = new THREE.Mesh(artGeometry.clone(), artMaterial)
      artPlane.position.z = 0.001
      group3d.add(artPlane)
      const hitPlane = new THREE.Mesh(
        innerGeometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          colorWrite: false,
          side: THREE.DoubleSide,
        })
      )
      hitPlane.position.z = 0.002
      group3d.add(hitPlane)
      group3d.userData.hitMesh = hitPlane
      const applyArtTexture = (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = true
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        if (SLIDE_STACK_BLUR_ENABLED) {
          tex.minFilter = THREE.LinearMipmapLinearFilter
          tex.magFilter = THREE.LinearFilter
          tex.generateMipmaps = true
        } else {
          tex.minFilter = THREE.LinearFilter
          tex.magFilter = THREE.LinearFilter
          tex.generateMipmaps = false
        }
        if (SLIDE_USE_ART_SHADER) {
          artMaterial.uniforms.map.value = tex
        } else {
          artMaterial.map = tex
        }
        const op = getCardOpacity(group3d)
        artMaterial.opacity = op
        if (artMaterial.uniforms?.opacity) artMaterial.uniforms.opacity.value = op
      }
      const cached = artTextureCache.get(node.art)
      if (cached) {
        const tex = cached.clone()
        applyArtTexture(tex)
      } else {
        textureLoader.load(
          node.art,
          (tex) => {
            artTextureCache.set(node.art, tex)
            applyArtTexture(tex)
          },
          undefined,
          () => {
            // onError: leave material without map (stays transparent/invisible or add fallback)
          }
        )
      }
    } else {
      const inner = new THREE.Mesh(innerGeometry, innerMaterial.clone())
      inner.position.z = 0.001
      group3d.add(inner)
      group3d.userData.hitMesh = inner
      const labelMaterial = new THREE.MeshBasicMaterial({
        map: makeLabelTexture(parentIndexForLabels, i),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const label = new THREE.Mesh(labelGeometry, labelMaterial)
      label.position.set(CARD_WIDTH / 2 - labelSize / 2 - 0.05, -CARD_HEIGHT / 2 + labelSize / 2 + 0.05, 0.002)
      group3d.add(label)
    }
    scene.add(group3d)
    cards.push(group3d)
  }
  return cards
}

function removeCardsFromScene(cards) {
  cards.forEach((g) => scene.remove(g))
}

let cards = []
let cardMeshes = []
let currentIndex = 0
let targetIndex = 0
/** Smooth 0..N-1 value used for GLTF rotation; tweened during slide transitions. */
let gltfSlideIndex = 0
/** Integrated world-Y rotation for velocitySpin logo (rad); not derived from slide index. */
let logoSpinAngle = 0
let logoAngularVelocity = 0
/** +1 = forward / right, −1 = back / left — sets idle spin direction after ramps settle. */
let logoLastSpinDir = 1
/** 0–1 current stimulus value applied to spin target. */
let logoNavStimulus = 0
/** 0–1 target stimulus; entering slides sets this to 1, then animate() eases current value toward it. */
let logoNavStimulusTarget = 0
/** +1 / −1 while a slide tween runs — from sign(target−start), not from float gltfSlideIndex (avoids overshoot flipping spin). */
let logoSlideNavDir = 0
let activeTimeline = null
/** True only during enter-child / go-back transitions; used to block input. Slide-to-slide nav still accepts input. */
let isTransitioning = false

function switchToGroup(group, parentIndexForLabels, frontIndex) {
  setBackgroundForPath()
  if (activeTimeline) activeTimeline.kill()
  activeTimeline = null
  logoSlideNavDir = 0
  _frontStackYawSmoothedForIndex = -1
  if (cards.length) {
    removeCardsFromScene(cards)
    cards = []
    cardMeshes = []
  }
  slotPositions = getSlotPositions(group.length)
  currentIndex = frontIndex
  targetIndex = frontIndex
  gltfSlideIndex = frontIndex
  cards = createCardsForGroup(group, parentIndexForLabels)
  cardMeshes = cards.map((g) => g.userData.hitMesh)
  const vanish = getVanishPosition()
  for (let i = 0; i < group.length; i++) {
    if (i < frontIndex) {
      cards[i].position.set(vanish.x, vanish.y ?? 0, vanish.z)
      setCardOpacity(cards[i], 0)
    } else {
      const slot = slotPositions[i - frontIndex]
      cards[i].position.set(slot.x, slot.y ?? 0, slot.z)
      setCardOpacity(cards[i], 1)
    }
  }
}

function setCardOpacity(group, value) {
  group.children.forEach((child) => {
    if (!child.material) return
    const m = child.material
    m.opacity = value
    if (m.uniforms?.opacity) m.uniforms.opacity.value = value
  })
}

function getCardOpacity(group) {
  const first = group.children[0]
  if (!first?.material) return 1
  const m = first.material
  return m.uniforms?.opacity ? m.uniforms.opacity.value : m.opacity
}

function updateSlideArtEffects() {
  if (!SLIDE_USE_ART_SHADER) return
  const n = numSlides()
  for (let i = 0; i < n; i++) {
    const mat = cards[i]?.userData?.artMaterial
    if (!mat?.uniforms) continue
    if (SLIDE_STACK_BLUR_ENABLED && mat.uniforms.blurStrength) {
      const behind = Math.max(0, i - gltfSlideIndex)
      mat.uniforms.blurStrength.value = Math.min(SLIDE_BLUR_MAX_UV, behind * SLIDE_BLUR_UV_PER_STACK)
    }
    if (mat.uniforms.saturation) {
      if (SLIDE_FRONT_COLOR_ONLY) {
        const d = i - gltfSlideIndex
        const t = THREE.MathUtils.clamp(d, 0, 1)
        // smoothstep(x, min, max) — x first (was wrong as smoothstep(0,1,t) → always 1.0 saturation)
        mat.uniforms.saturation.value = 1 - THREE.MathUtils.smoothstep(t, 0, 1)
      } else {
        mat.uniforms.saturation.value = 1
      }
    }
  }
}

function numSlides() {
  return currentGroup().length
}

function lastSlideIndex() {
  return numSlides() - 1
}

function syncOpacityForFront(frontIndex) {
  const n = numSlides()
  for (let i = 0; i < frontIndex; i++) setCardOpacity(cards[i], 0)
  for (let i = frontIndex; i < n; i++) setCardOpacity(cards[i], 1)
}

function animateToTarget(duration, ease = EASE) {
  const n = numSlides()
  const vanish = getVanishPosition()

  if (activeTimeline) activeTimeline.kill()
  const fromIndex = currentIndex
  const toIndex = targetIndex
  const gltfIndexObj = { value: gltfSlideIndex }
  activeTimeline = gsap.timeline({
    onStart: () => {
      triggerLogoStimulus(logoSlideNavDir)
    },
    onComplete: () => {
      logoSlideNavDir = 0
      currentIndex = targetIndex
      gltfSlideIndex = targetIndex
      for (let i = 0; i < targetIndex; i++) {
        cards[i].position.set(vanish.x, vanish.y ?? 0, vanish.z)
        setCardOpacity(cards[i], 0)
      }
      for (let i = targetIndex; i < n; i++) setCardOpacity(cards[i], 1)
      activeTimeline = null
      targetIndex = currentIndex
    },
    onKill: () => {
      activeTimeline = null
      gltfSlideIndex = currentIndex
      logoSlideNavDir = 0
    },
  })
  activeTimeline.to(gltfIndexObj, {
    value: toIndex,
    duration,
    ease,
    onUpdate: () => { gltfSlideIndex = gltfIndexObj.value },
  }, '<')

  if (targetIndex === currentIndex) {
    for (let i = currentIndex + 1; i < n; i++) setCardOpacity(cards[i], 1)
    for (let i = 0; i < currentIndex; i++) {
      const card = cards[i]
      const op = { value: getCardOpacity(card) }
      activeTimeline.to(card.position, { x: vanish.x, y: vanish.y ?? 0, z: vanish.z, duration, ease }, '<')
      activeTimeline.to(op, { value: 0, duration, ease, onUpdate: () => setCardOpacity(card, op.value) }, '<')
    }
    const front = cards[currentIndex]
    const frontOpacity = { value: getCardOpacity(front) }
    activeTimeline.to(front.position, { x: slotPositions[0].x, y: slotPositions[0].y ?? 0, z: slotPositions[0].z, duration, ease }, '<')
    activeTimeline.to(frontOpacity, { value: 1, duration, ease, onUpdate: () => setCardOpacity(front, frontOpacity.value) }, '<')
    for (let i = currentIndex + 1; i < n; i++) {
      const slot = slotPositions[i - currentIndex]
      activeTimeline.to(cards[i].position, { x: slot.x, y: slot.y ?? 0, z: slot.z, duration, ease }, '<')
    }
    return
  }

  if (targetIndex > currentIndex) {
    for (let i = targetIndex; i < n; i++) setCardOpacity(cards[i], 1)
    for (let i = 0; i < targetIndex; i++) {
      const card = cards[i]
      const op = { value: getCardOpacity(card) }
      activeTimeline.to(card.position, { x: vanish.x, y: vanish.y ?? 0, z: vanish.z, duration, ease }, '<')
      activeTimeline.to(op, { value: 0, duration, ease, onUpdate: () => setCardOpacity(card, op.value) }, '<')
    }
    for (let i = targetIndex; i < n; i++) {
      const slot = slotPositions[i - targetIndex]
      activeTimeline.to(cards[i].position, { x: slot.x, y: slot.y ?? 0, z: slot.z, duration, ease }, '<')
    }
  } else {
    for (let i = targetIndex + 1; i < n; i++) setCardOpacity(cards[i], 1)
    for (let i = 0; i < targetIndex; i++) {
      const card = cards[i]
      const op = { value: getCardOpacity(card) }
      activeTimeline.to(card.position, { x: vanish.x, y: vanish.y ?? 0, z: vanish.z, duration, ease }, '<')
      activeTimeline.to(op, { value: 0, duration, ease, onUpdate: () => setCardOpacity(card, op.value) }, '<')
    }
    const appearing = cards[targetIndex]
    const appearOpacity = { value: getCardOpacity(appearing) }
    activeTimeline.to(appearing.position, { x: slotPositions[0].x, y: slotPositions[0].y ?? 0, z: slotPositions[0].z, duration, ease }, '<')
    activeTimeline.to(appearOpacity, { value: 1, duration, ease, onUpdate: () => setCardOpacity(appearing, appearOpacity.value) }, '<')
    for (let i = targetIndex + 1; i < n; i++) {
      const slot = slotPositions[i - targetIndex]
      activeTimeline.to(cards[i].position, { x: slot.x, y: slot.y ?? 0, z: slot.z, duration, ease }, '<')
    }
  }
}

const COLLAPSE_OFFSET_Z = 0.02

function enterChildWithTransition() {
  const group = currentGroup()
  const node = group[currentIndex]
  const children = getChildren(node)
  if (children.length === 0) return
  if (activeTimeline) activeTimeline.kill()
  isTransitioning = true

  preloadGroupArt(group)

  const n = group.length
  /** Visual front is always stack slot 0 even when `currentIndex` > 0 (see `switchToGroup`). */
  const slot0 = slotPositions[0]
  const axis = getPageTurnAxis(slot0)
  const restX = slot0.x

  activeTimeline = gsap.timeline({
    onComplete: () => { activeTimeline = null; isTransitioning = false },
    onKill: () => { activeTimeline = null; isTransitioning = false },
  })

  // 1. Collapse only the slides to the right of the selected one (currentIndex) behind it, and fade them out
  const frontCard = cards[currentIndex]
  for (let i = currentIndex + 1; i < n; i++) {
    const card = cards[i]
    activeTimeline.to(card.position, {
      x: slot0.x,
      z: slot0.z - COLLAPSE_OFFSET_Z * (i - currentIndex),
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
    }, '<')
    const op = { value: getCardOpacity(card) }
    activeTimeline.to(op, {
      value: 0,
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
      onUpdate: () => setCardOpacity(card, op.value),
    }, '<')
  }

  // 2. Page-turn the selected (front) slide out (rotate around axis, fade out)
  const angleOut = { value: 0 }
  const opacityOut = { value: 1 }
  activeTimeline.to(angleOut, {
    value: Math.PI / 2,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => {
      setCardPageTurnState(frontCard, axis, angleOut.value, restX)
      setCardOpacity(frontCard, opacityOut.value)
    },
  }, `+=${TRANSITION_COLLAPSE_DURATION * 0.5}`)
  activeTimeline.to(opacityOut, {
    value: 0,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => setCardOpacity(frontCard, opacityOut.value),
  }, '<')

  // 3. Swap to child group and set initial state, then run page-in and uncroll
  const parentIndexForLabels = currentIndex
  activeTimeline.add(() => {
    removeCardsFromScene(cards)
    path.push({ group: children, parentIndex: parentIndexForLabels })
    slotPositions = getSlotPositions(children.length)
    currentIndex = 0
    targetIndex = 0
    cards = createCardsForGroup(children, parentIndexForLabels)
    cardMeshes = cards.map((g) => g.userData.hitMesh)
    setBackgroundForPath()

    const childSlot0 = slotPositions[0]
    const childAxis = getPageTurnAxis(childSlot0)
    const childRestX = childSlot0.x
    const childN = children.length

    // First subslide: turned in from opposite side (angle -PI/2)
    setCardPageTurnState(cards[0], childAxis, -Math.PI / 2, childRestX)
    setCardOpacity(cards[0], 0)
    for (let i = 1; i < childN; i++) {
      cards[i].position.set(childSlot0.x, childSlot0.y ?? 0, childSlot0.z - COLLAPSE_OFFSET_Z * i)
      setCardOpacity(cards[i], 0)
    }

    // 4. First subslide page-turn in
    const angleIn = { value: -Math.PI / 2 }
    const opacityIn = { value: 0 }
    activeTimeline.to(angleIn, {
      value: 0,
      duration: TRANSITION_PAGE_TURN_IN_DURATION,
      ease: EASE,
      onUpdate: () => {
        setCardPageTurnState(cards[0], childAxis, angleIn.value, childRestX)
        setCardOpacity(cards[0], opacityIn.value)
      },
    })
    activeTimeline.to(opacityIn, {
      value: 1,
      duration: TRANSITION_PAGE_TURN_IN_DURATION,
      ease: EASE,
      onUpdate: () => setCardOpacity(cards[0], opacityIn.value),
    }, '<')

    // 5. Uncollapse rest to the right
    if (childN > 1) {
      for (let i = 1; i < childN; i++) {
        const slot = slotPositions[i]
        activeTimeline.to(cards[i].position, {
          x: slot.x,
            y: slot.y ?? 0,
            z: slot.z,
          duration: TRANSITION_UNCROLL_DURATION,
          ease: EASE,
        }, '<')
        const op = { value: 0 }
        activeTimeline.to(op, {
          value: 1,
          duration: TRANSITION_UNCROLL_DURATION,
          onUpdate: () => setCardOpacity(cards[i], op.value),
        }, '<')
      }
    }
  })
}

function goBackWithTransition() {
  if (path.length <= 1) return
  if (activeTimeline) activeTimeline.kill()
  isTransitioning = true

  const n = currentGroup().length
  const slot0 = slotPositions[0]
  const axis = getPageTurnAxis(slot0)
  const restX = slot0.x

  // Phase 1: collapse + page-out only. Phase 2 (swap + page-in) runs in onComplete so it always plays.
  activeTimeline = gsap.timeline({
    onComplete: () => {
      const popped = path.pop()
      const parentEntry = currentPage()
      const parentGroup = parentEntry.group
      const parentIndexForLabels = parentEntry.parentIndex
      const frontIndex = popped.parentIndex

      removeCardsFromScene(cards)
      slotPositions = getSlotPositions(parentGroup.length)
      currentIndex = frontIndex
      targetIndex = frontIndex
      gltfSlideIndex = frontIndex
      cards = createCardsForGroup(parentGroup, parentIndexForLabels)
      cardMeshes = cards.map((g) => g.userData.hitMesh)
      requestAnimationFrame(() => setBackgroundForPath())

      const parentSlot0 = slotPositions[0]
      const parentAxis = getPageTurnAxis(parentSlot0)
      const parentRestX = parentSlot0.x
      const parentN = parentGroup.length

      for (let i = 0; i < parentN; i++) {
        setCardOpacity(cards[i], 0)
        cards[i].renderOrder = 0
      }
      cards[frontIndex].renderOrder = 1

      const vanish = getVanishPosition()
      for (let i = 0; i < frontIndex; i++) {
        cards[i].position.set(vanish.x, vanish.y ?? 0, vanish.z)
      }
      // Match `switchToGroup`: the deck’s front slide sits at stack slot 0, not slot `frontIndex`.
      const frontStackSlot = parentSlot0
      cards[frontIndex].position.set(frontStackSlot.x, frontStackSlot.y ?? 0, frontStackSlot.z)
      setCardPageTurnState(cards[frontIndex], parentAxis, Math.PI / 2, parentRestX)
      for (let i = frontIndex + 1; i < parentN; i++) {
        cards[i].position.set(parentSlot0.x, parentSlot0.y ?? 0, parentSlot0.z - COLLAPSE_OFFSET_Z * (i - frontIndex))
      }

      // Start phase 2 on the next animation frame so the initial state is rendered and GSAP doesn't run the timeline to completion in the same tick
      requestAnimationFrame(() => {
        const angleIn = { value: Math.PI / 2 }
        const opacityIn = { value: 0 }
        activeTimeline = gsap.timeline({
          onComplete: () => {
            cards.forEach((c) => { c.renderOrder = 0 })
            activeTimeline = null
            isTransitioning = false
          },
          onKill: () => {
            if (cards.length) cards.forEach((c) => { c.renderOrder = 0 })
            activeTimeline = null
            isTransitioning = false
          },
        })
        activeTimeline.to(angleIn, {
          value: 0,
          duration: TRANSITION_PAGE_TURN_IN_DURATION,
          ease: EASE,
          onUpdate: () => {
            setCardPageTurnState(cards[frontIndex], parentAxis, angleIn.value, parentRestX)
            setCardOpacity(cards[frontIndex], opacityIn.value)
          },
        })
        activeTimeline.to(opacityIn, {
          value: 1,
          duration: TRANSITION_PAGE_TURN_IN_DURATION,
          ease: EASE,
          onUpdate: () => setCardOpacity(cards[frontIndex], opacityIn.value),
        }, '<')
        for (let i = 1; i < parentN - frontIndex; i++) {
          const slot = slotPositions[i]
          const card = cards[frontIndex + i]
          activeTimeline.to(card.position, {
            x: slot.x,
            y: slot.y ?? 0,
            z: slot.z,
            duration: TRANSITION_UNCROLL_DURATION,
            ease: EASE,
          }, '<')
          const op = { value: 0 }
          activeTimeline.to(op, {
            value: 1,
            duration: TRANSITION_UNCROLL_DURATION,
            onUpdate: () => setCardOpacity(card, op.value),
          }, '<')
        }
      })
    },
    onKill: () => {
      if (cards.length) cards.forEach((c) => { c.renderOrder = 0 })
      activeTimeline = null
      isTransitioning = false
    },
  })

  // 1. Collapse subslides to the right behind the first
  for (let i = 1; i < n; i++) {
    const card = cards[i]
    activeTimeline.to(card.position, {
      x: slot0.x,
      z: slot0.z - COLLAPSE_OFFSET_Z * i,
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
    }, '<')
    const op = { value: getCardOpacity(card) }
    activeTimeline.to(op, {
      value: 0,
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
      onUpdate: () => setCardOpacity(card, op.value),
    }, '<')
  }

  // 2. Page-turn first subslide out
  const angleOut = { value: 0 }
  const opacityOut = { value: 1 }
  activeTimeline.to(angleOut, {
    value: -Math.PI / 2,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => {
      setCardPageTurnState(cards[0], axis, angleOut.value, restX)
      setCardOpacity(cards[0], opacityOut.value)
    },
  }, `+=${TRANSITION_COLLAPSE_DURATION * 0.5}`)
  activeTimeline.to(opacityOut, {
    value: 0,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => setCardOpacity(cards[0], opacityOut.value),
  }, '<')
}

function enterChild() {
  const group = currentGroup()
  const node = group[currentIndex]
  const children = getChildren(node)
  if (children.length === 0) return
  enterChildWithTransition()
}

/** Press animation on the front card, then enter child. */
function enterChildWithPressAnimation() {
  const group = currentGroup()
  const node = group[currentIndex]
  const children = getChildren(node)
  if (children.length === 0) return
  triggerLogoStimulus(logoLastSpinDir)
  isTransitioning = true
  const frontCard = cards[currentIndex]
  const pressTimeline = gsap.timeline({
    onComplete: () => { enterChildWithTransition() },
    onKill: () => { isTransitioning = false },
  })
  pressTimeline.to(frontCard.scale, {
    x: PRESS_SCALE,
    y: PRESS_SCALE,
    z: 1,
    duration: PRESS_SHRINK_DURATION,
    ease: 'power2.in',
  })
  pressTimeline.to(frontCard.scale, {
    x: 1,
    y: 1,
    z: 1,
    duration: PRESS_RESTORE_DURATION,
    ease: 'power2.out',
  })
}

/** Run collapse + page-turn out, then navigate to url. Used for link-only slides. */
function enterLinkWithTransition(url) {
  if (!url) return
  if (activeTimeline) activeTimeline.kill()
  isTransitioning = true

  const group = currentGroup()
  const n = group.length
  const slot0 = slotPositions[0]
  const axis = getPageTurnAxis(slot0)
  const restX = slot0.x
  const frontCard = cards[currentIndex]

  activeTimeline = gsap.timeline({
    onComplete: () => {
      activeTimeline = null
      isTransitioning = false
      window.location.href = url
    },
    onKill: () => {
      activeTimeline = null
      isTransitioning = false
    },
  })

  for (let i = currentIndex + 1; i < n; i++) {
    const card = cards[i]
    activeTimeline.to(card.position, {
      x: slot0.x,
      z: slot0.z - COLLAPSE_OFFSET_Z * (i - currentIndex),
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
    }, '<')
    const op = { value: getCardOpacity(card) }
    activeTimeline.to(op, {
      value: 0,
      duration: TRANSITION_COLLAPSE_DURATION,
      ease: EASE,
      onUpdate: () => setCardOpacity(card, op.value),
    }, '<')
  }

  const angleOut = { value: 0 }
  const opacityOut = { value: 1 }
  activeTimeline.to(angleOut, {
    value: Math.PI / 2,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => {
      setCardPageTurnState(frontCard, axis, angleOut.value, restX)
      setCardOpacity(frontCard, opacityOut.value)
    },
  }, `+=${TRANSITION_COLLAPSE_DURATION * 0.5}`)
  activeTimeline.to(opacityOut, {
    value: 0,
    duration: TRANSITION_PAGE_TURN_OUT_DURATION,
    ease: EASE,
    onUpdate: () => setCardOpacity(frontCard, opacityOut.value),
  }, '<')
}

/** Press animation then run link transition (for link-only slides). */
function enterLinkWithPressAnimation() {
  const group = currentGroup()
  const node = group[currentIndex]
  const link = node?.link
  if (!link) return
  triggerLogoStimulus(logoLastSpinDir)
  isTransitioning = true
  const frontCard = cards[currentIndex]
  const pressTimeline = gsap.timeline({
    onComplete: () => { enterLinkWithTransition(link) },
    onKill: () => { isTransitioning = false },
  })
  pressTimeline.to(frontCard.scale, {
    x: PRESS_SCALE,
    y: PRESS_SCALE,
    z: 1,
    duration: PRESS_SHRINK_DURATION,
    ease: 'power2.in',
  })
  pressTimeline.to(frontCard.scale, {
    x: 1,
    y: 1,
    z: 1,
    duration: PRESS_RESTORE_DURATION,
    ease: 'power2.out',
  })
}

function goBackToParent() {
  if (path.length <= 1) return
  goBackWithTransition()
}

/** Overscroll: same stimulus + target omega as normal rotation (no separate velocity impulse). */
function triggerLogoStimulus(direction) {
  if (direction !== 0) logoLastSpinDir = direction
  logoNavStimulusTarget = 1
}

function bumpLogoSpinStimulus(direction) {
  if (direction === 0) return
  triggerLogoStimulus(direction)
}

function navigateRight() {
  if (isTransitioning) return
  if (currentIndex >= lastSlideIndex()) {
    bumpLogoSpinStimulus(1)
    return
  }
  const newTarget = Math.min(lastSlideIndex(), targetIndex + 1)
  if (newTarget === targetIndex) return
  targetIndex = newTarget
  logoSlideNavDir = 1
  logoLastSpinDir = 1
  animateToTarget(getDurationForDirection('right'))
}

function navigateLeft() {
  if (isTransitioning) return
  if (currentIndex === 0 && path.length > 1 && !activeTimeline) {
    goBackToParent()
    return
  }
  if (currentIndex <= 0) {
    bumpLogoSpinStimulus(-1)
    return
  }
  const newTarget = Math.max(0, targetIndex - 1)
  if (newTarget === targetIndex) return
  targetIndex = newTarget
  logoSlideNavDir = -1
  logoLastSpinDir = -1
  animateToTarget(getDurationForDirection('left'))
}

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const CLICK_NAVIGATE_DURATION = 0.5

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    navigateRight()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    navigateLeft()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (activeTimeline) return
    const node = currentGroup()[currentIndex]
    const children = getChildren(node)
    if (children.length > 0) enterChildWithPressAnimation()
    else if (node?.link) enterLinkWithPressAnimation()
  }
})

let wheelAccum = 0
let wheelCooldownUntil = 0
const WHEEL_THRESHOLD = 7
const WHEEL_COOLDOWN_MS = 10
window.addEventListener('wheel', (e) => {
  if (Date.now() < wheelCooldownUntil) {
    e.preventDefault()
    wheelAccum = 0
    return
  }
  wheelAccum -= e.deltaY
  if (wheelAccum >= WHEEL_THRESHOLD) {
    wheelAccum = 0
    wheelCooldownUntil = Date.now() + WHEEL_COOLDOWN_MS
    e.preventDefault()
    navigateRight()
  } else if (wheelAccum <= -WHEEL_THRESHOLD) {
    wheelAccum = 0
    wheelCooldownUntil = Date.now() + WHEEL_COOLDOWN_MS
    e.preventDefault()
    navigateLeft()
  }
}, { passive: false })

function onCanvasClick(e) {
  if (isTransitioning) return
  const el = renderer.domElement
  const rect = el.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(cardMeshes)
  if (hits.length === 0) return
  // Prefer the front slide so it stays fully clickable (vanishing slides sit in front at z=2)
  const frontHit = hits.find((h) => h.object.parent?.userData?.index === currentIndex)
  const hit = frontHit ?? hits[0]
  const group3d = hit.object.parent
  const index = group3d?.userData?.index
  if (index == null) return
  const node = currentGroup()[index]
  const children = getChildren(node)
  if (index === currentIndex) {
    if (!activeTimeline) {
      if (children.length > 0) enterChildWithPressAnimation()
      else if (node?.link) enterLinkWithPressAnimation()
    }
    return
  }
  if (index < currentIndex) return
  targetIndex = Math.max(0, Math.min(lastSlideIndex(), index))
  logoSlideNavDir = Math.sign(targetIndex - currentIndex)
  if (logoSlideNavDir !== 0) logoLastSpinDir = logoSlideNavDir
  animateToTarget(CLICK_NAVIGATE_DURATION)
}
renderer.domElement.addEventListener('click', onCanvasClick)

renderer.domElement.addEventListener('pointerenter', () => {
  pointerIsOverCanvas = true
})
renderer.domElement.addEventListener('pointerleave', () => {
  pointerIsOverCanvas = false
  hoverTiltTargetX = 0
  hoverTiltTargetY = 0
  hoverDeepIndex = -1
  hoverFrontPop = false
})
renderer.domElement.addEventListener('pointermove', (e) => {
  pointerIsOverCanvas = true
  updateSlideHoverFromPointer(e.clientX, e.clientY)
})

window.addEventListener('pointermove', (e) => {
  setCameraParallaxFromClient(e.clientX, e.clientY)
}, { passive: true })
document.documentElement.addEventListener('mouseleave', () => {
  cameraParallaxTargetNdcX = 0
  cameraParallaxTargetNdcY = 0
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function stepBackgroundVideoPlayback() {
  if (!bgVideo.classList.contains('is-active')) return

  const kickPlay = () => {
    bgVideo.play().catch(() => {})
  }

  if (!VIDEO_LOGO_LINKED_PLAYBACK) {
    try {
      if (bgVideo.readyState >= 2 && Math.abs(bgVideo.playbackRate - 1) > 0.01) bgVideo.playbackRate = 1
      kickPlay()
    } catch (_) {}
    return
  }

  // Brief `readyState` dips skip rate tweaks but still nudge `play()` so we don’t stay paused after a buffer hitch.
  if (bgVideo.readyState < 2) {
    kickPlay()
    return
  }

  const mag = Math.min(VIDEO_MAX_SIGNED_RATE, Math.max(0, videoSignedPlaybackRate))
  const minMag = VIDEO_MIN_RATE_EFFECTIVE
  const clampedMag = Math.min(VIDEO_PLAYBACK_RATE_HARD_MAX, Math.max(minMag, mag))

  const dur = bgVideo.duration
  if (Number.isFinite(dur) && dur > VIDEO_FORWARD_END_SNAP_EPS * 2) {
    if (bgVideo.currentTime >= dur - VIDEO_FORWARD_END_SNAP_EPS) {
      try {
        bgVideo.currentTime = 0
      } catch (_) {}
    }
  }
  try {
    if (Math.abs(bgVideo.playbackRate - clampedMag) > 0.01) bgVideo.playbackRate = clampedMag
    kickPlay()
  } catch (_) {}
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  animationMixers.forEach((m) => m.update(delta))
  if (sitIdleVideoTexture?.image?.readyState >= 2) sitIdleVideoTexture.needsUpdate = true
  const total = numSlides()
  slideCounterEl.textContent = `${targetIndex + 1} of ${total}`

  if (logoSlideNavDir !== 0) {
    logoLastSpinDir = logoSlideNavDir
  }

  if (logoNavStimulus < logoNavStimulusTarget) {
    const rise = 1 - Math.exp(-LOGO_STIMULUS_SMOOTH_UP * delta)
    logoNavStimulus += (logoNavStimulusTarget - logoNavStimulus) * rise
    if (Math.abs(logoNavStimulusTarget - logoNavStimulus) < 1e-4) logoNavStimulus = logoNavStimulusTarget
  } else {
    logoNavStimulus *= Math.exp(-LOGO_STIMULUS_DECAY * delta)
    if (logoNavStimulus < 1e-4) logoNavStimulus = 0
  }
  logoNavStimulusTarget *= Math.exp(-LOGO_STIMULUS_DECAY * delta)
  if (logoNavStimulusTarget < 1e-4) logoNavStimulusTarget = 0

  const omegaTarget =
    logoLastSpinDir * (LOGO_IDLE_OMEGA + LOGO_NAV_PEAK_EXTRA * logoNavStimulus)
  const omegaErr = omegaTarget - logoAngularVelocity
  const reversing =
    Math.sign(omegaTarget) !== Math.sign(logoAngularVelocity) &&
    Math.abs(logoAngularVelocity) > 0.05 &&
    Math.abs(omegaTarget) > 0.05
  const speedingUp = Math.abs(omegaTarget) > Math.abs(logoAngularVelocity)
  const excessDecaying =
    Math.abs(logoAngularVelocity) > Math.abs(omegaTarget) + 0.02 &&
    Math.sign(logoAngularVelocity) === Math.sign(omegaTarget)
  const logoRamp = reversing || speedingUp ? LOGO_RAMP_UP : excessDecaying ? LOGO_COAST_DECAY : LOGO_RAMP_DOWN
  logoAngularVelocity += omegaErr * Math.min(1, logoRamp * delta)
  logoAngularVelocity = THREE.MathUtils.clamp(logoAngularVelocity, -LOGO_MAX_OMEGA, LOGO_MAX_OMEGA)
  logoSpinAngle += logoAngularVelocity * delta

  if (VIDEO_LOGO_LINKED_PLAYBACK) {
    const videoRateTarget = VIDEO_PLAYBACK_IDLE + VIDEO_PLAYBACK_PEAK_EXTRA * logoNavStimulus
    const videoRateErr = videoRateTarget - videoSignedPlaybackRate
    const videoSpeedingUp = videoRateTarget > videoSignedPlaybackRate
    const videoExcessDecaying =
      videoSignedPlaybackRate > videoRateTarget + 0.02
    const videoRamp = videoSpeedingUp
      ? VIDEO_SPEED_RAMP_UP
      : videoExcessDecaying
        ? LOGO_COAST_DECAY
        : LOGO_RAMP_DOWN
    videoSignedPlaybackRate += videoRateErr * Math.min(1, videoRamp * delta)
    videoSignedPlaybackRate = THREE.MathUtils.clamp(
      videoSignedPlaybackRate,
      0,
      VIDEO_MAX_SIGNED_RATE
    )
  }
  stepBackgroundVideoPlayback()
  stepCameraParallax(delta)

  _slideCounterPos.set(SLIDE_COUNTER_X, SLIDE_COUNTER_Y, 0).project(camera)
  const px = (_slideCounterPos.x * 0.5 + 0.5) * window.innerWidth
  const py = (-_slideCounterPos.y * 0.5 + 0.5) * window.innerHeight
  slideCounterEl.style.left = `${px}px`
  slideCounterEl.style.top = `${py}px`
  const pathIndices = path.slice(1).map((p) => p.parentIndex)
  updateSlideArtEffects()
  syncSlideStackRotations(delta)
  stepAndApplyFrontSlideHoverTilt(delta)
  stepAndApplyDeepSlideHover(delta)
  stepAndApplyFrontSlideHoverPop(delta)
  const context = { numSlides: total, gltfSlideIndex, camera, pathIndices, logoSpinAngle }
  SCENE_OBJECT_CONFIGS.forEach((objConfig) => {
    if (objConfig.model) applySceneObjectBehaviour(objConfig.model, objConfig, context)
  })
  renderer.render(scene, camera)
  if (overlayScene.children.length > 0) {
    renderer.autoClear = false
    const gl = renderer.getContext()
    gl.clear(gl.DEPTH_BUFFER_BIT)
    renderer.render(overlayScene, camera)
    renderer.autoClear = true
  }
}

switchToGroup(ROOT_GROUP, null, 0)
animate()
