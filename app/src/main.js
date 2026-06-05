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
import { getSceneObjectConfigsForProfile, applySceneObjectBehaviour } from './sceneObjects.js'
import {
  mountTextOverlays,
  getDesktopTextOverlaysForPage,
  TEXT_OVERLAY_FONT_FAMILY,
} from './textOverlays.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { resolveLayoutProfile } from './layoutProfile.js'
import { getSitIdleCharacterConfig } from './sitIdleCharacterConfig.js'
import {
  resolveDesktopPageId,
  getContentPageId,
  getSlidesStructureForPage,
  getDesktopLayoutPatch,
  mergeDesktopLayoutPatch,
  getDesktopFrontSlideHoverTiltPatch,
} from './desktopPage.js'
import { isTextPanelVisualEditActive } from './devFlags.js'
import {
  applyTextPanelOverridesToSlideTree,
  buildTextPanelStorageKey,
} from './devTextPanelStorage.js'
import { buildSlideTimeline, updateSlideTimeline } from './slideTimeline.js'

const layoutProfile = resolveLayoutProfile()
const desktopPageId = resolveDesktopPageId(layoutProfile.id)
const contentPageId = getContentPageId(layoutProfile.id, desktopPageId)
const slidesStructure = getSlidesStructureForPage(layoutProfile.id, desktopPageId)
const effectiveLayout = mergeDesktopLayoutPatch(layoutProfile, getDesktopLayoutPatch(contentPageId))
const sceneObjectConfigs = getSceneObjectConfigsForProfile(layoutProfile.id, contentPageId)
const sitIdleCharacter = getSitIdleCharacterConfig(layoutProfile.id, contentPageId)
const DEFAULT_FRONT_SLIDE_HOVER_TILT = Object.freeze({
  enabled: true,
  maxX: 0.05,
  maxY: 0.05,
  smooth: 8,
})
const frontSlideHoverTilt = {
  ...DEFAULT_FRONT_SLIDE_HOVER_TILT,
  ...(getDesktopFrontSlideHoverTiltPatch(contentPageId) ?? {}),
}

// Scene (no solid background so the background video shows through)
const scene = new THREE.Scene()
scene.background = null
const slideTimelineGroup = new THREE.Group()
slideTimelineGroup.name = 'slide-timeline'
scene.add(slideTimelineGroup)

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

// Camera (FOV / position from layout profile; desktop alt page can patch via `desktopPage.js`)
const camera = new THREE.PerspectiveCamera(
  effectiveLayout.camera.fov,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.set(
  effectiveLayout.camera.position.x,
  effectiveLayout.camera.position.y,
  effectiveLayout.camera.position.z
)

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
  if (!layoutProfile.useWindowParallax) {
    camera.rotation.set(cameraParallaxBaseRotX, cameraParallaxBaseRotY, cameraParallaxBaseRotZ)
    return
  }
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
container.setAttribute('data-layout-profile', layoutProfile.id)
if (layoutProfile.id === 'desktop') {
  container.setAttribute('data-desktop-page', contentPageId)
  document.title = 'Samuel Ramos Varela Portfolio'
}

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

const tu = layoutProfile.textUi
if (tu) {
  container.style.setProperty(
    '--ui-fixed-text-px',
    tu.fontSize ?? `${VIEWPORT_UI_TEXT_PX}px`
  )
  if (tu.dockGap != null) container.style.setProperty('--ui-dock-gap-px', tu.dockGap)
  if (tu.dockPadX != null) container.style.setProperty('--ui-dock-pad-x', tu.dockPadX)
  if (tu.dockPadY != null) container.style.setProperty('--ui-dock-pad-y', tu.dockPadY)
  if (tu.dockTop != null) container.style.setProperty('--ui-dock-top', tu.dockTop)
} else {
  container.style.setProperty('--ui-fixed-text-px', `${VIEWPORT_UI_TEXT_PX}px`)
}

const hb = layoutProfile.headerBanner
if (hb) {
  container.style.setProperty('--ui-header-max-width', hb.maxWidth)
  container.style.setProperty('--ui-header-offset-y', hb.offsetY)
  if (hb.objectPosition != null) {
    container.style.setProperty('--ui-header-object-position', hb.objectPosition)
  }
  if (hb.right != null) container.style.setProperty('--ui-header-right', hb.right)
  if (hb.left != null) container.style.setProperty('--ui-header-left', hb.left)
  if (hb.transform != null) container.style.setProperty('--ui-header-transform', hb.transform)
  if (hb.maxHeight != null) {
    container.style.setProperty('--ui-header-max-height', hb.maxHeight)
  }
} else {
  container.style.setProperty('--ui-header-max-width', `${HEADER_WEB_IMAGE_MAX_WIDTH_PX}px`)
  container.style.setProperty('--ui-header-offset-y', `${HEADER_WEB_IMAGE_OFFSET_Y_PX}px`)
  container.style.setProperty('--ui-header-object-position', 'top right')
  container.style.setProperty('--ui-header-right', 'max(0px, env(safe-area-inset-right))')
  container.style.setProperty('--ui-header-left', 'auto')
  container.style.setProperty('--ui-header-transform', 'none')
}

mountTextOverlays(container, {
  viewportTextPx: VIEWPORT_UI_TEXT_PX,
  overlays: getDesktopTextOverlaysForPage(contentPageId),
})

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
const VIDEO_PLAYBACK_IDLE = 0.5      // `playbackRate` scale when nav stimulus is 0
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

function syncRendererToWindow() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, layoutProfile.maxDpr))
  renderer.setSize(window.innerWidth, window.innerHeight)
}

syncRendererToWindow()

overlayScene.environment = createNeutralEnvMap(renderer)
overlayScene.environmentIntensity = 0.45

const clock = new THREE.Clock()
const animationMixers = []
let sitIdleVideoTexture = null

// 3D objects: GLTF list from sceneObjects.js (`getSceneObjectConfigsForProfile` ← layoutProfile.id)
overlayScene.add(camera)

function applySceneObjectMaterialOverrides(model, objConfig) {
  const { materialRoughness, materialMetalness } = objConfig
  if (materialRoughness == null && materialMetalness == null) return
  model.traverse((child) => {
    if (!child.isMesh || !child.material) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) {
      if (materialRoughness != null && 'roughness' in mat) mat.roughness = materialRoughness
      if (materialMetalness != null && 'metalness' in mat) mat.metalness = materialMetalness
    }
  })
}

sceneObjectConfigs.forEach((objConfig) => {
  loadGltfModel(scene, objConfig.url, {
    position: { x: 0, y: 0, z: 0 },
    scale: objConfig.scale,
    alwaysOnTop: objConfig.alwaysOnTop ?? false,
    overlayScene: objConfig.scene === 'overlay' ? overlayScene : undefined,
    onLoad: (model) => {
      objConfig.model = model
      applySceneObjectMaterialOverrides(model, objConfig)
      if (objConfig.position?.mode === 'camera') {
        overlayScene.remove(model)
        camera.add(model)
      }
    },
  }).catch(() => {})
})

// FBX animated character — desktop vs mobile file + params in `sitIdleCharacterConfig.js`
const sitIdleBaseUrl = `${import.meta.env.BASE_URL || '/'}`.replace(/\/?$/, '/')
const SIT_IDLE_BASE = `${sitIdleBaseUrl}assets/3D/sit-idle/`
if (sitIdleCharacter.enabled) {
  const fbxLoader = new FBXLoader()
  fbxLoader.setPath(SIT_IDLE_BASE)
  fbxLoader.load(
    encodeURI(sitIdleCharacter.fbxFile),
    (group) => {
      const box = new THREE.Box3().setFromObject(group)
      const center = new THREE.Vector3()
      box.getCenter(center)
      group.position.sub(center)
      const size = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z, 1)
      const { fbxScale, mirrorX, mirrorTextureX, wrapperPosition, wrapperRotation } = sitIdleCharacter
      group.scale.setScalar(fbxScale / maxDim)
      group.scale.x *= mirrorX
      const wrapper = new THREE.Group()
      wrapper.add(group)
      wrapper.position.set(wrapperPosition.x, wrapperPosition.y, wrapperPosition.z)
      wrapper.rotation.set(wrapperRotation.x, wrapperRotation.y, wrapperRotation.z)
      const behindSlides = sitIdleCharacter.renderBehindSlides === true
      const idleHostScene = behindSlides ? scene : overlayScene
      if (behindSlides) {
        if (scene.environment == null && overlayScene.environment) {
          scene.environment = overlayScene.environment
        }
        // Slides are mostly MeshBasicMaterial; these only meaningfully light the sit-idle PBR meshes.
        if (!scene.userData.sitIdleMainLights) {
          const lightGroup = new THREE.Group()
          lightGroup.name = 'sit-idle-main-lights'
          lightGroup.add(new THREE.AmbientLight(0xffffff, 0.5))
          const dir = new THREE.DirectionalLight(0xffffff, 0.55)
          dir.position.set(2, 5, 4)
          lightGroup.add(dir)
          const fill = new THREE.DirectionalLight(0xffffff, 0.2)
          fill.position.set(-2, 2, 3)
          lightGroup.add(fill)
          const lf = new THREE.DirectionalLight(0xffffff, 4)
          lf.position.set(-3, 1, -1)
          lf.target.position.set(-0.5, -2, -2.5)
          lightGroup.add(lf)
          lightGroup.add(lf.target)
          scene.add(lightGroup)
          scene.userData.sitIdleMainLights = lightGroup
        }
      }
      idleHostScene.add(wrapper)
      if (group.animations && group.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(group)
        group.animations.forEach((clip) => mixer.clipAction(clip).play())
        animationMixers.push(mixer)
      }

      const appearance = sitIdleCharacter.appearance ?? 'video'
      const useWhiteAppearance = appearance === 'white'
      const texLoader = new THREE.TextureLoader().setPath(SIT_IDLE_BASE)
      const normalTex = texLoader.load(
        encodeURI(sitIdleCharacter.normalMapFile),
        undefined,
        undefined,
        (e) => console.warn('Sit-idle normal texture failed', e)
      )

      /** @type {THREE.Texture | null} */
      let diffuseMap = null
      if (useWhiteAppearance) {
        if (sitIdleCharacter.colorMapFile) {
          diffuseMap = texLoader.load(
            encodeURI(sitIdleCharacter.colorMapFile),
            undefined,
            undefined,
            (e) => console.warn('Sit-idle color map failed', e)
          )
          diffuseMap.colorSpace = THREE.SRGBColorSpace
          diffuseMap.wrapS = diffuseMap.wrapT = THREE.ClampToEdgeWrapping
          diffuseMap.repeat.set(mirrorTextureX, 1)
          diffuseMap.offset.set(mirrorTextureX === -1 ? 1 : 0, 0)
        }
      } else {
        const video = document.createElement('video')
        video.src = SIT_IDLE_BASE + encodeURI(sitIdleCharacter.videoFile)
        video.loop = true
        video.muted = true
        video.playsInline = true
        video.play().catch((e) => console.warn('Sit-idle video texture autoplay:', e))
        const videoTex = new THREE.VideoTexture(video)
        videoTex.colorSpace = THREE.SRGBColorSpace
        videoTex.minFilter = THREE.LinearFilter
        videoTex.magFilter = THREE.LinearFilter
        videoTex.wrapS = videoTex.wrapT = THREE.ClampToEdgeWrapping
        videoTex.repeat.set(mirrorTextureX, 1)
        videoTex.offset.set(mirrorTextureX === -1 ? 1 : 0, 0)
        sitIdleVideoTexture = videoTex
        diffuseMap = videoTex
      }

      const whiteColor = sitIdleCharacter.materialColor ?? 0xffffff
      const whiteEmissive = sitIdleCharacter.emissive ?? 0x000000
      const whiteEmissiveIntensity = sitIdleCharacter.emissiveIntensity ?? 0
      const whiteRoughness = sitIdleCharacter.roughness ?? 0.06
      const whiteMetalness = sitIdleCharacter.metalness ?? 0
      const whiteNormalScale = sitIdleCharacter.normalScale ?? 1
      const whiteEnvMapIntensity = sitIdleCharacter.envMapIntensity ?? 1.45
      const idleEnvMap = idleHostScene.environment ?? null

      group.traverse((child) => {
        if (!child.isMesh || !child.material) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        const newMats = materials.map((mat) => {
          if (useWhiteAppearance) {
            return new THREE.MeshStandardMaterial({
              map: diffuseMap,
              normalMap: normalTex,
              normalScale: new THREE.Vector2(whiteNormalScale, whiteNormalScale),
              color: whiteColor,
              emissive: whiteEmissive,
              emissiveIntensity: whiteEmissiveIntensity,
              roughness: whiteRoughness,
              metalness: whiteMetalness,
              envMap: idleEnvMap,
              envMapIntensity: whiteEnvMapIntensity,
            })
          }
          return new THREE.MeshStandardMaterial({
            map: diffuseMap,
            normalMap: normalTex,
            color: mat.color ? mat.color.clone() : 0xffffff,
            roughness: 0.0,
            metalness: 0.0,
          })
        })
        child.material = newMats.length === 1 ? newMats[0] : newMats
      })

      // World-space UV projection is for video only; it smears static images on white mode.
      if (diffuseMap && !useWhiteAppearance) {
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
      }
    },
    undefined,
    (err) => console.error('FBX load failed:', err)
  )
}

// Tree from config (single source of truth)
const ROOT_GROUP = slidesStructure.root
if (import.meta.env.DEV) {
  applyTextPanelOverridesToSlideTree(ROOT_GROUP, layoutProfile.id, contentPageId)
}

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

// Stack curve: mutable copy of effective layout stack (desktop alt patches in `desktopPage.js`).
const stackLayout = {
  ...effectiveLayout.stack,
  curveStart: { ...effectiveLayout.stack.curveStart },
  curveEnd: { ...effectiveLayout.stack.curveEnd },
}

let CARD_WIDTH = 1.4 * 1.5 * stackLayout.scale
let CARD_HEIGHT = 1.4 * 1.5 * stackLayout.scale

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
  if (stackLayout.plane === 'xy') {
    perp = normalizeVec3({ x: -dy, y: dx, z: 0 })
    return {
      x: mid.x + perp.x * stackLayout.curveBend,
      y: mid.y + perp.y * stackLayout.curveBend,
      z: mid.z + stackLayout.curveVerticalBend,
    }
  }
  if (stackLayout.plane === 'yz') {
    perp = normalizeVec3({ x: 0, y: -dz, z: dy })
    return {
      x: mid.x + stackLayout.curveVerticalBend,
      y: mid.y + perp.y * stackLayout.curveBend,
      z: mid.z + perp.z * stackLayout.curveBend,
    }
  }
  // Default: XZ plane
  perp = normalizeVec3({ x: -dz, y: 0, z: dx })
  return {
    x: mid.x + perp.x * stackLayout.curveBend,
    y: mid.y + stackLayout.curveVerticalBend,
    z: mid.z + perp.z * stackLayout.curveBend,
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
  const start = stackLayout.curveStart
  const end = stackLayout.curveUseCustomEnd
    ? stackLayout.curveEnd
    : {
        x: (stackLayout.xStart + Math.max(0, n - 1) * stackLayout.xStep) * stackLayout.scale,
        y: 0,
        z: (stackLayout.zStart + Math.max(0, n - 1) * stackLayout.zStep) * stackLayout.scale,
      }
  if (n === 1) return [{ x: start.x, y: start.y, z: start.z }]
  const control = getCurveControlPoint(start, end)
  const p = stackLayout.slotSpreadExponent
  return Array.from({ length: n }, (_, i) => {
    const linear = i / (n - 1)
    const t = p === 1 ? linear : Math.pow(linear, p)
    return quadraticBezier3(start, control, end, t)
  })
}

let slotPositions = getSlotPositions(currentGroup().length)

function getVanishPosition() {
  const s0 = slotPositions[0]
  if (!s0) return { x: 0, y: 0, z: stackLayout.vanishZ ?? 2 }
  const ox = stackLayout.vanishOffsetX ?? 0
  const oy = stackLayout.vanishOffsetY ?? 0
  return {
    x: s0.x + ox,
    y: (s0.y ?? 0) + oy,
    z: stackLayout.vanishZ ?? 2,
  }
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

/** Defaults match previous globals; override via `stackLayout` from `layoutProfile.stack`. */
function getFrontSlideStackYawRad() {
  return stackLayout.frontSlideStackYawRad ?? Math.PI / 16
}
function getFrontSlideStackYawExitBlend() {
  return stackLayout.frontSlideStackYawExitBlend ?? 0.8
}
function getSlideOffFrameYawRad() {
  return stackLayout.slideOffFrameYawRad ?? Math.PI / 4
}
function getSlideOffFrameRotationBlend() {
  return stackLayout.slideOffFrameRotationBlend ?? 1
}

/** Pointer-driven tilt on the front slide only (adds on top of stack / off-frame yaw). */
const FRONT_SLIDE_HOVER_TILT_ENABLED = frontSlideHoverTilt.enabled
/** Max pitch (rotation.x, rad) from pointer top vs bottom on the card. */
const FRONT_SLIDE_HOVER_TILT_MAX_X = frontSlideHoverTilt.maxX
/** Max extra yaw (rotation.y, rad) from pointer left vs right on the card. */
const FRONT_SLIDE_HOVER_TILT_MAX_Y = frontSlideHoverTilt.maxY
/** How fast hover tilt follows the pointer (1/s). */
const FRONT_SLIDE_HOVER_TILT_SMOOTH = frontSlideHoverTilt.smooth

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
  const maxYaw = getFrontSlideStackYawRad()
  if (maxYaw === 0) return 0
  const d = slideIndex - frontFloat
  if (d >= 1) return 0
  if (d >= 0) {
    return maxYaw * (1 - THREE.MathUtils.smoothstep(d, 0, 1))
  }
  const b = Math.max(1e-4, getFrontSlideStackYawExitBlend())
  if (d <= -b) return 0
  return maxYaw * THREE.MathUtils.smoothstep(d, -b, 0)
}

/** 0 = use stack yaw only; 1 = use slide-off-frame yaw (slide has moved past the float front). */
function getOffFrameYawBlend(slideIndex, frontFloat) {
  if (getSlideOffFrameYawRad() === 0) return 0
  const w = Math.max(1e-4, getSlideOffFrameRotationBlend())
  const delta = slideIndex - frontFloat
  if (delta >= 0) return 0
  if (delta <= -w) return 1
  return 1 - THREE.MathUtils.smoothstep(delta, -w, 0)
}

function getCombinedStackVisualYawRad(slideIndex, frontFloat) {
  const stackYaw = getSlideStackYawRad(slideIndex, frontFloat)
  const offBlend = getOffFrameYawBlend(slideIndex, frontFloat)
  return THREE.MathUtils.lerp(stackYaw, getSlideOffFrameYawRad(), offBlend)
}

let _frontStackYawSmoothed = 0
let _frontStackYawSmoothedForIndex = -1

function syncSlideStackRotations(delta) {
  const noStackTilt = getFrontSlideStackYawRad() === 0
  const noOffFrame = getSlideOffFrameYawRad() === 0
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
  if (stackDragActive) return
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
  if (stackDragActive) return
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
  if (stackDragActive) return
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
const SLIDE_STACK_BLUR_ENABLED = true

/**
 * When true, only the front slide is full color; deeper slides are grayscale.
 * Saturation eases smoothly between 1st and 2nd stack positions (uses gltfSlideIndex during transitions).
 */
const SLIDE_FRONT_COLOR_ONLY = true

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
/** Cache of loaded slide image-panel textures by URL. */
const slideImagePanelTextureCache = new Map()

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

const DEFAULT_SLIDE_TEXT_PANEL = Object.freeze({
  enabled: true,
  // Width/height of the panel plane.
  aspectRatio: 1.45,
  // Fraction of inner slide width used by the panel.
  widthRatio: 0.72,
  // Draw slightly closer to camera than slide art for subtle parallax.
  zOffset: 0.03,
  // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  anchor: 'top-left',
  marginXRatio: 0.08,
  marginYRatio: 0.08,
  // Text rendering options.
  fontFamily: TEXT_OVERLAY_FONT_FAMILY,
  fontWeight: 520,
  fontSizePx: 42,
  minFontSizePx: 20,
  autoFit: true,
  lineHeight: 1.3,
  paragraphGapPx: 18,
  textAlign: 'left',
  verticalAlign: 'top',
  textColor: '#ffffff',
  // Width of the text column inside panel (0..1 of available width).
  textSpanRatio: 1,
  // Horizontal offset for the full panel (ratio of inner slide width).
  offsetXRatio: 0,
  // Vertical offset for the full panel (ratio of inner slide height).
  offsetYRatio: 0,
  // Background styling:
  // - 'highlight' = per-line highlight behind text (default)
  // - 'panel' = one rounded rectangle behind the full panel area
  // - 'none' = no background fill
  backgroundMode: 'highlight',
  boxColor: '#111111',
  boxOpacity: 0.72,
  borderColor: '#ffffff',
  borderOpacity: 0,
  borderWidthPx: 0,
  radiusPx: 24,
  highlightPaddingXPx: 12,
  highlightPaddingYPx: 7,
  highlightRadiusPx: 8,
  // Inner spacing.
  paddingXRatio: 0.08,
  paddingYRatio: 0.11,
  // Texture quality budget.
  textureWidthPx: 1024,
  // Multiplier on top of device pixel ratio for crisper text rendering.
  textureDprScale: 1,
  // When > 0, non–front-in-stack slides shift text in +X (world card space) by `innerWidth * ratio * w`,
  // where w = min(1, max(0, i - gltfSlideIndex)) so the offset eases to 0 as the transition brings the
  // card to the front (see `getStackTextOffsetWeightForCardIndex` / `updateSlideTextPanelStackVisuals`).
  stackTextOffsetXRatio: 0,
  // With fractional `gltfSlideIndex`, text opacity eases between these: front (w=0) vs behind (w=1).
  stackOpacityFront: 1,
  stackOpacityInitial: 1,
  // Optional, like image panels: at the fractional front (w→0) use `position`/`finalPosition` and
  // `finalSizeRatio`; when |index − gltfSlideIndex| → 1, lerp toward `initialPosition` / `initialSizeRatio`.
  finalPosition: null,
  initialPosition: null,
})

const DEFAULT_SLIDE_IMAGE_PANEL = Object.freeze({
  enabled: true,
  src: '',
  // Single-size mode (preferred): scales from inner slide width; height follows image aspect (no stretching).
  sizeRatio: null,
  // Fraction of inner slide width/height; values > 1 allow spanning beyond card bounds.
  // Legacy fallback when `sizeRatio` is not set.
  widthRatio: 1,
  heightRatio: 1,
  // Fallback aspect used before image load when `sizeRatio` is set.
  aspectRatio: 1,
  // Crop in source pixels: uniform `cropPx` or per-side. Applied via map offset/repeat (keeps true aspect).
  cropPx: 0,
  // Optional overrides (if omitted, `cropPx` is used for that side).
  cropLeftPx: null,
  cropRightPx: null,
  cropTopPx: null,
  cropBottomPx: null,
  // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  anchor: 'center',
  marginXRatio: 0,
  marginYRatio: 0,
  offsetXRatio: 0,
  offsetYRatio: 0,
  zOffset: 0.05,
  // Base multiplier (applies at all stack depths).
  opacity: 1,
  // Stack blend multipliers (front = w0, initial/behind = w1).
  stackOpacityFront: 1,
  stackOpacityInitial: 1,
  // Stack transforms (lerped by |cardIndex − gltfSlideIndex|, capped at 1): w=0 → final*, w=1 → initial*.
  finalPosition: null,
  initialPosition: null,
  finalSizeRatio: null,
  initialSizeRatio: null,
})

function clamp01(v) {
  return THREE.MathUtils.clamp(v ?? 0, 0, 1)
}

function hexToRgba(hex, alpha = 1) {
  const a = THREE.MathUtils.clamp(alpha, 0, 1)
  const raw = String(hex ?? '')
    .trim()
    .replace(/[\u201c\u201d\u2018\u2019]/g, '') // smart quotes from copy-paste
  const c = new THREE.Color()
  try {
    if (raw) c.setStyle(raw)
    else c.set(0x000000)
  } catch {
    c.set(0x000000)
  }
  if (!Number.isFinite(c.r) || !Number.isFinite(c.g) || !Number.isFinite(c.b)) c.set(0x000000)
  const r = Math.round(c.r * 255)
  const g = Math.round(c.g * 255)
  const b = Math.round(c.b * 255)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(Math.max(r, 0), w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

function wrapTextLine(ctx, text, maxWidth) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ['']
  const words = trimmed.split(/\s+/)
  const lines = []
  let current = ''
  const pushWordChunks = (word) => {
    if (ctx.measureText(word).width <= maxWidth) return [word]
    const chunks = []
    let rest = word
    while (rest.length) {
      let lo = 1
      let hi = rest.length
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const probe = rest.slice(0, mid)
        if (ctx.measureText(probe).width <= maxWidth) lo = mid + 1
        else hi = mid - 1
      }
      const take = Math.max(1, hi)
      chunks.push(rest.slice(0, take))
      rest = rest.slice(take)
    }
    return chunks
  }

  for (const word of words) {
    const chunks = pushWordChunks(word)
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk
      if (!current || ctx.measureText(next).width <= maxWidth) {
        current = next
      } else {
        lines.push(current)
        current = chunk
      }
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function buildParagraphLines(ctx, paragraphs, maxWidth) {
  const lines = []
  const gaps = []
  paragraphs.forEach((paragraph, pIdx) => {
    const paraText = typeof paragraph === 'string' ? paragraph : paragraph?.text
    const paraAlign = typeof paragraph === 'string' ? undefined : paragraph?.align
    const paraSpanRatio = typeof paragraph === 'string' ? undefined : paragraph?.spanRatio
    const spanRatio = THREE.MathUtils.clamp(
      Number(paraSpanRatio) || 1,
      0.15,
      1
    )
    const paraMaxWidth = Math.max(1, maxWidth * spanRatio)
    const rawLines = String(paraText ?? '').split('\n')
    rawLines.forEach((raw) => {
      wrapTextLine(ctx, raw, paraMaxWidth).forEach((line) =>
        lines.push({ text: line, align: paraAlign, spanRatio })
      )
    })
    if (pIdx < paragraphs.length - 1) gaps.push(lines.length)
  })
  return { lines, gaps }
}

function computeTextBlockHeight(lines, gaps, lineHeightPx, paragraphGapPx) {
  return lines.length * lineHeightPx + gaps.length * paragraphGapPx
}

function normalizeSlideTextPanelConfig(rawPanel, nodeName) {
  if (!rawPanel || rawPanel.enabled === false) return null
  const merged = { ...DEFAULT_SLIDE_TEXT_PANEL, ...rawPanel }
  const paragraphs = []
  if (Array.isArray(merged.paragraphs)) {
    for (const p of merged.paragraphs) {
      if (typeof p === 'string') {
        if (p.trim().length > 0) {
          paragraphs.push({
            text: p,
            align: merged.textAlign,
            spanRatio: merged.textSpanRatio,
          })
        }
      } else if (p && typeof p === 'object') {
        const text = String(p.text ?? '').trim()
        if (!text) continue
        const align = p.align === 'right' || p.align === 'center' || p.align === 'left' ? p.align : merged.textAlign
        const spanRatio = p.spanRatio ?? merged.textSpanRatio
        paragraphs.push({ text, align, spanRatio })
      }
    }
  }
  if (paragraphs.length === 0) {
    const fallback = merged.text ?? nodeName ?? ''
    if (String(fallback).trim()) {
      paragraphs.push({
        text: String(fallback),
        align: merged.textAlign,
        spanRatio: merged.textSpanRatio,
      })
    }
  }
  merged.paragraphs = paragraphs
  merged.aspectRatio = Math.max(0.2, Number(merged.aspectRatio) || DEFAULT_SLIDE_TEXT_PANEL.aspectRatio)
  merged.widthRatio = THREE.MathUtils.clamp(Number(merged.widthRatio) || DEFAULT_SLIDE_TEXT_PANEL.widthRatio, 0.1, 3)
  merged.textSpanRatio = THREE.MathUtils.clamp(
    Number(merged.textSpanRatio) || DEFAULT_SLIDE_TEXT_PANEL.textSpanRatio,
    0.15,
    1
  )
  merged.offsetXRatio = THREE.MathUtils.clamp(
    Number(merged.offsetXRatio) || DEFAULT_SLIDE_TEXT_PANEL.offsetXRatio,
    -2,
    2
  )
  merged.offsetYRatio = THREE.MathUtils.clamp(
    Number(merged.offsetYRatio) || DEFAULT_SLIDE_TEXT_PANEL.offsetYRatio,
    -2,
    2
  )
  merged.marginXRatio = clamp01(merged.marginXRatio)
  merged.marginYRatio = clamp01(merged.marginYRatio)
  merged.paddingXRatio = clamp01(merged.paddingXRatio)
  merged.paddingYRatio = clamp01(merged.paddingYRatio)
  merged.textureWidthPx = THREE.MathUtils.clamp(
    Number(merged.textureWidthPx) || DEFAULT_SLIDE_TEXT_PANEL.textureWidthPx,
    256,
    2048
  )
  merged.textureDprScale = THREE.MathUtils.clamp(
    Number(merged.textureDprScale) || DEFAULT_SLIDE_TEXT_PANEL.textureDprScale,
    0.5,
    3
  )
  merged.fontSizePx = Math.max(8, Number(merged.fontSizePx) || DEFAULT_SLIDE_TEXT_PANEL.fontSizePx)
  merged.minFontSizePx = Math.max(8, Number(merged.minFontSizePx) || DEFAULT_SLIDE_TEXT_PANEL.minFontSizePx)
  merged.backgroundMode =
    merged.backgroundMode === 'panel' || merged.backgroundMode === 'none' ? merged.backgroundMode : 'highlight'
  for (const key of ['textColor', 'boxColor', 'borderColor']) {
    if (merged[key] != null) merged[key] = String(merged[key]).trim()
  }
  merged.borderWidthPx = Math.max(0, Number(merged.borderWidthPx) || 0)
  merged.radiusPx = Math.max(0, Number(merged.radiusPx) || 0)
  merged.highlightPaddingXPx = THREE.MathUtils.clamp(Number(merged.highlightPaddingXPx) || 0, -256, 256)
  merged.highlightPaddingYPx = THREE.MathUtils.clamp(Number(merged.highlightPaddingYPx) || 0, -256, 256)
  merged.highlightRadiusPx = Math.max(0, Number(merged.highlightRadiusPx) || 0)
  merged.paragraphGapPx = THREE.MathUtils.clamp(Number(merged.paragraphGapPx) || 0, -256, 512)
  merged.lineHeight = Math.max(0.8, Number(merged.lineHeight) || DEFAULT_SLIDE_TEXT_PANEL.lineHeight)
  merged.stackTextOffsetXRatio = THREE.MathUtils.clamp(
    Number(merged.stackTextOffsetXRatio) || DEFAULT_SLIDE_TEXT_PANEL.stackTextOffsetXRatio,
    -0.4,
    0.4
  )
  {
    const n = Number(merged.stackOpacityFront)
    merged.stackOpacityFront = Number.isFinite(n)
      ? clamp01(n)
      : DEFAULT_SLIDE_TEXT_PANEL.stackOpacityFront
  }
  {
    const n = Number(merged.stackOpacityInitial)
    merged.stackOpacityInitial = Number.isFinite(n)
      ? clamp01(n)
      : DEFAULT_SLIDE_TEXT_PANEL.stackOpacityInitial
  }
  if (merged.position && typeof merged.position === 'object') {
    const x = Number(merged.position.x)
    const y = Number(merged.position.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      merged.position = { x, y }
    } else {
      delete merged.position
    }
  }
  {
    const zDef = Number.isFinite(Number(merged.zOffset)) ? Number(merged.zOffset) : DEFAULT_SLIDE_TEXT_PANEL.zOffset
    const normWorld = (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const x = Number(raw.x)
      const y = Number(raw.y)
      const z = Number(raw.z)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return { x, y, z: Number.isFinite(z) ? z : zDef }
    }
    // `position` (editor) wins over `finalPosition` in file — same "at front" placement.
    const posFromEditor = merged.position
    const posKey =
      posFromEditor &&
      Number.isFinite(Number(posFromEditor.x)) &&
      Number.isFinite(Number(posFromEditor.y))
    const posFinal =
      (posKey
        ? {
            x: Number(posFromEditor.x),
            y: Number(posFromEditor.y),
            z: zDef,
          }
        : null) ||
      normWorld(merged.finalPosition) ||
      normWorld(merged.position)
    const posInitial = posFinal ? (normWorld(merged.initialPosition) ?? { ...posFinal }) : null
    if (posFinal) {
      merged.position = { x: posFinal.x, y: posFinal.y }
      merged.finalPosition = { x: posFinal.x, y: posFinal.y, z: posFinal.z }
      merged.initialPosition = { x: posInitial.x, y: posInitial.y, z: posInitial.z }
    } else {
      delete merged.finalPosition
      delete merged.initialPosition
    }
  }
  return merged
}

function normalizeSlideTextPanelConfigs(node) {
  const list = Array.isArray(node?.textPanels) ? node.textPanels : node?.textPanel ? [node.textPanel] : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const fallbackName = i === 0 ? node?.name : ''
    const panel = normalizeSlideTextPanelConfig(list[i], fallbackName)
    if (panel) out.push(panel)
  }
  return out
}

function normalizeSlideImagePanelConfig(rawPanel) {
  if (!rawPanel || rawPanel.enabled === false) return null
  const merged = { ...DEFAULT_SLIDE_IMAGE_PANEL, ...rawPanel }
  const src = String(merged.src ?? merged.image ?? merged.url ?? '').trim()
  if (!src) return null
  merged.src = src

  {
    const raw = merged.sizeRatio ?? merged.scaleRatio ?? merged.scale
    const n = Number(raw)
    merged.sizeRatio = Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0.02, 20) : null
  }
  merged.widthRatio = THREE.MathUtils.clamp(
    Number(merged.widthRatio) || DEFAULT_SLIDE_IMAGE_PANEL.widthRatio,
    0.02,
    20
  )
  merged.heightRatio = THREE.MathUtils.clamp(
    Number(merged.heightRatio) || DEFAULT_SLIDE_IMAGE_PANEL.heightRatio,
    0.02,
    20
  )
  merged.offsetXRatio = THREE.MathUtils.clamp(
    Number(merged.offsetXRatio) || DEFAULT_SLIDE_IMAGE_PANEL.offsetXRatio,
    -20,
    20
  )
  merged.offsetYRatio = THREE.MathUtils.clamp(
    Number(merged.offsetYRatio) || DEFAULT_SLIDE_IMAGE_PANEL.offsetYRatio,
    -20,
    20
  )
  merged.marginXRatio = THREE.MathUtils.clamp(
    Number(merged.marginXRatio) || DEFAULT_SLIDE_IMAGE_PANEL.marginXRatio,
    -20,
    20
  )
  merged.marginYRatio = THREE.MathUtils.clamp(
    Number(merged.marginYRatio) || DEFAULT_SLIDE_IMAGE_PANEL.marginYRatio,
    -20,
    20
  )
  merged.aspectRatio = THREE.MathUtils.clamp(
    Number(merged.aspectRatio) || DEFAULT_SLIDE_IMAGE_PANEL.aspectRatio,
    0.02,
    50
  )
  merged.opacity = clamp01(merged.opacity)
  {
    const raw =
      merged.stackOpacityFront ??
      merged.frontOpacity ??
      merged.finalOpacity
    const n = Number(raw)
    merged.stackOpacityFront = Number.isFinite(n)
      ? clamp01(n)
      : DEFAULT_SLIDE_IMAGE_PANEL.stackOpacityFront
  }
  {
    const raw = merged.stackOpacityInitial ?? merged.initialOpacity
    const n = Number(raw)
    merged.stackOpacityInitial = Number.isFinite(n)
      ? clamp01(n)
      : DEFAULT_SLIDE_IMAGE_PANEL.stackOpacityInitial
  }
  merged.anchor =
    merged.anchor === 'top-left' ||
    merged.anchor === 'top-right' ||
    merged.anchor === 'bottom-left' ||
    merged.anchor === 'bottom-right' ||
    merged.anchor === 'center'
      ? merged.anchor
      : DEFAULT_SLIDE_IMAGE_PANEL.anchor
  merged.zOffset = Number.isFinite(Number(merged.zOffset))
    ? Number(merged.zOffset)
    : DEFAULT_SLIDE_IMAGE_PANEL.zOffset

  const normalizePanelPos = (raw, fallbackZ) => {
    if (!raw || typeof raw !== 'object') return null
    const x = Number(raw.x)
    const y = Number(raw.y)
    const z = Number(raw.z)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y, z: Number.isFinite(z) ? z : fallbackZ }
  }

  const normalizeSizeRatio = (raw) => {
    const n = Number(raw)
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0.02, 20) : null
  }

  merged.finalPosition = normalizePanelPos(
    merged.finalPosition ?? merged.frontPosition ?? merged.positionFront,
    merged.zOffset
  )
  merged.initialPosition = normalizePanelPos(
    merged.initialPosition ?? merged.positionInitial,
    merged.zOffset
  )
  merged.finalSizeRatio = normalizeSizeRatio(
    merged.finalSizeRatio ?? merged.frontSizeRatio ?? merged.sizeRatioFront
  )
  merged.initialSizeRatio = normalizeSizeRatio(
    merged.initialSizeRatio ?? merged.sizeRatioInitial
  )

  {
    const cAll = Math.max(0, Number(merged.cropPx) || 0)
    const readSide = (v) => {
      if (v == null || v === '') return cAll
      const n = Number(v)
      return Number.isFinite(n) ? Math.max(0, n) : cAll
    }
    let L = readSide(merged.cropLeftPx)
    let R = readSide(merged.cropRightPx)
    let T = readSide(merged.cropTopPx)
    let B = readSide(merged.cropBottomPx)
    merged.cropL = L
    merged.cropR = R
    merged.cropT = T
    merged.cropB = B
  }

  if (merged.position && typeof merged.position === 'object') {
    const x = Number(merged.position.x)
    const y = Number(merged.position.y)
    const z = Number(merged.position.z)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      merged.position = { x, y, z: Number.isFinite(z) ? z : merged.zOffset }
    } else {
      delete merged.position
    }
  }
  return merged
}

function normalizeSlideImagePanelConfigs(node) {
  const list = Array.isArray(node?.imagePanels) ? node.imagePanels : node?.imagePanel ? [node.imagePanel] : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const panel = normalizeSlideImagePanelConfig(list[i])
    if (panel) out.push(panel)
  }
  return out
}

function createSlideTextPanelTexture(panel) {
  const logicalWidth = Math.round(panel.textureWidthPx)
  const logicalHeight = Math.max(64, Math.round(logicalWidth / panel.aspectRatio))
  const dpr = THREE.MathUtils.clamp(
    (window.devicePixelRatio || 1) * (panel.textureDprScale || 1),
    1,
    4
  )
  const canvasWidth = Math.round(logicalWidth * dpr)
  const canvasHeight = Math.round(logicalHeight * dpr)
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (dpr !== 1) ctx.scale(dpr, dpr)

  const padX = panel.paddingXRatio * logicalWidth
  const padY = panel.paddingYRatio * logicalHeight
  if (panel.backgroundMode === 'panel') {
    const boxX = 0
    const boxY = 0
    const boxW = logicalWidth
    const boxH = logicalHeight
    roundedRectPath(ctx, boxX, boxY, boxW, boxH, panel.radiusPx)
    ctx.fillStyle = hexToRgba(panel.boxColor, panel.boxOpacity)
    ctx.fill()
    if (panel.borderWidthPx > 0 && panel.borderOpacity > 0) {
      ctx.lineWidth = panel.borderWidthPx
      ctx.strokeStyle = hexToRgba(panel.borderColor, panel.borderOpacity)
      ctx.stroke()
    }
  }

  const maxTextWidth = Math.max(1, logicalWidth - padX * 2)
  const maxTextHeight = Math.max(1, logicalHeight - padY * 2)
  let fontSize = panel.fontSizePx
  let layout = { lines: panel.paragraphs.map((p) => ({ text: p.text, align: p.align })), gaps: [] }
  let lineHeightPx = fontSize * panel.lineHeight
  const minFont = Math.min(panel.fontSizePx, panel.minFontSizePx)

  while (fontSize >= minFont) {
    ctx.font = `${panel.fontWeight} ${fontSize}px "${panel.fontFamily}", sans-serif`
    layout = buildParagraphLines(ctx, panel.paragraphs, maxTextWidth)
    lineHeightPx = fontSize * panel.lineHeight
    const h = computeTextBlockHeight(layout.lines, layout.gaps, lineHeightPx, panel.paragraphGapPx)
    if (!panel.autoFit || h <= maxTextHeight) break
    fontSize -= 1
  }

  ctx.font = `${panel.fontWeight} ${fontSize}px "${panel.fontFamily}", sans-serif`
  ctx.fillStyle = panel.textColor
  ctx.textBaseline = 'top'

  const textBlockHeight = computeTextBlockHeight(
    layout.lines,
    layout.gaps,
    lineHeightPx,
    panel.paragraphGapPx
  )
  const startY =
    panel.verticalAlign === 'middle'
      ? (logicalHeight - textBlockHeight) * 0.5
      : panel.verticalAlign === 'bottom'
        ? logicalHeight - padY - textBlockHeight
        : padY
  const getTextX = (align, spanRatio) => {
    const ratio = THREE.MathUtils.clamp(Number(spanRatio) || 1, 0.15, 1)
    const spanWidth = maxTextWidth * ratio
    if (align === 'center') return logicalWidth * 0.5
    if (align === 'right') return logicalWidth - padX
    return padX + (maxTextWidth - spanWidth) * 0
  }

  let y = startY
  const gapSet = new Set(layout.gaps)
  for (let i = 0; i < layout.lines.length; i++) {
    const lineSpec = layout.lines[i]
    const line = lineSpec?.text ?? ''
    const align = lineSpec?.align === 'center' || lineSpec?.align === 'right' ? lineSpec.align : 'left'
    const spanRatio = lineSpec?.spanRatio ?? panel.textSpanRatio
    const textX = getTextX(align, spanRatio)
    const lineWidth = ctx.measureText(line).width
    if (panel.backgroundMode === 'highlight' && panel.boxOpacity > 0 && line.trim().length > 0) {
      const hx =
        align === 'center'
          ? textX - lineWidth * 0.5 - panel.highlightPaddingXPx
          : align === 'right'
            ? textX - lineWidth - panel.highlightPaddingXPx
            : textX - panel.highlightPaddingXPx
      const hy = y - panel.highlightPaddingYPx * 0.5
      const hw = Math.max(1, lineWidth + panel.highlightPaddingXPx * 2)
      const hh = Math.max(1, lineHeightPx + panel.highlightPaddingYPx)
      roundedRectPath(ctx, hx, hy, hw, hh, panel.highlightRadiusPx)
      ctx.fillStyle = hexToRgba(panel.boxColor, panel.boxOpacity)
      ctx.fill()
      if (panel.borderWidthPx > 0 && panel.borderOpacity > 0) {
        ctx.lineWidth = panel.borderWidthPx
        ctx.strokeStyle = hexToRgba(panel.borderColor, panel.borderOpacity)
        ctx.stroke()
      }
    }
    ctx.fillStyle = panel.textColor
    ctx.textAlign = align
    ctx.fillText(line, textX, y)
    y += lineHeightPx
    if (gapSet.has(i + 1)) y += panel.paragraphGapPx
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  if (renderer?.capabilities?.getMaxAnisotropy) {
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  }
  tex.needsUpdate = true
  return tex
}

function getAnchoredPanelPosition(anchor, innerWidth, innerHeight, panelWidth, panelHeight, marginX, marginY) {
  const left = -innerWidth * 0.5 + panelWidth * 0.5 + marginX
  const right = innerWidth * 0.5 - panelWidth * 0.5 - marginX
  const top = innerHeight * 0.5 - panelHeight * 0.5 - marginY
  const bottom = -innerHeight * 0.5 + panelHeight * 0.5 + marginY
  switch (anchor) {
    case 'top-right':
      return { x: right, y: top }
    case 'bottom-left':
      return { x: left, y: bottom }
    case 'bottom-right':
      return { x: right, y: bottom }
    case 'center':
      return { x: 0, y: 0 }
    default:
      return { x: left, y: top }
  }
}

function hasSlideTextPanelAbsolutePosition(panel) {
  if (panel?.finalPosition) {
    const f = panel.finalPosition
    return Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y))
  }
  const p = panel?.position
  return p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
}

function hasSlideImagePanelAbsolutePosition(panel) {
  const p = panel?.position
  return p && typeof p.x === 'number' && typeof p.y === 'number'
}

/**
 * Weight in [0,1] for stack text/image “initial” vs “final” (position, size, opacity).
 * 0 = at the fractional front (`gltfSlideIndex`); 1 = one or more steps away in either direction.
 * Uses |i − gltfSlideIndex| so slide index 0 still eases during transitions (not only i > front).
 */
function getStackTextOffsetWeightForCardIndex(i) {
  const g = Number(gltfSlideIndex)
  const gi = Number.isFinite(g) ? g : 0
  return Math.min(1, Math.abs(i - gi))
}

/**
 * Animates the slide-text wrapper group in X while `gltfSlideIndex` tweens; updates per-panel stack
 * opacities the same way. Skipped during TP gizmo so we don’t fight TransformControls. Layout X stays
 * on the child mesh; stack shift is the parent only.
 */
function updateSlideTextPanelStackVisuals() {
  if (isTextPanelVisualEditActive()) return
  const n = cards.length
  if (n === 0) return
  const { innerWidth } = getSlideCardInnerSize()
  for (let ci = 0; ci < n; ci++) {
    const card = cards[ci]
    const slideIdx = card.userData?.index
    if (slideIdx == null) continue
    const w = getStackTextOffsetWeightForCardIndex(slideIdx)
    const base = card.userData?.slideCardOpacity
    const cardBase = base === undefined ? 1 : THREE.MathUtils.clamp(base, 0, 1)
    for (const child of card.children) {
      if (child.userData?.textPanelStackOffsetGroup) {
        const ratio = child.userData.textPanelStackOffsetXRatio ?? 0
        child.position.set(innerWidth * ratio * w, 0, 0)
      }
    }
    card.traverse((obj) => {
      if (!obj.isMesh) return
      if (!obj.userData?.slideTextPanel && !obj.userData?.slideImagePanel) return
      if (obj.userData?.slideTextPanel) {
        const pF = obj.userData.textPanelPositionFinal
        const pI = obj.userData.textPanelPositionInitial
        if (pF && pI) {
          const zF = pF.z
          const zI = pI.z
          const useZ = Number.isFinite(zF) && Number.isFinite(zI)
          obj.position.set(
            THREE.MathUtils.lerp(pF.x, pI.x, w),
            THREE.MathUtils.lerp(pF.y, pI.y, w),
            useZ ? THREE.MathUtils.lerp(zF, zI, w) : (Number.isFinite(zF) ? zF : obj.position.z)
          )
        }
      } else if (obj.userData?.slideImagePanel) {
        const pF = obj.userData.imagePanelPositionFinal
        const pI = obj.userData.imagePanelPositionInitial
        if (pF && pI) {
          obj.position.set(
            THREE.MathUtils.lerp(pF.x, pI.x, w),
            THREE.MathUtils.lerp(pF.y, pI.y, w),
            THREE.MathUtils.lerp(pF.z, pI.z, w)
          )
        }
        const useSizeRatio = !!obj.userData.imagePanelUseSizeRatio
        if (useSizeRatio) {
          const aspectRaw = Number(obj.userData.imagePanelAspect)
          const aspect = Number.isFinite(aspectRaw) ? Math.max(0.02, aspectRaw) : 1
          const rF = Number(obj.userData.imagePanelSizeRatioFinal)
          const rI = Number(obj.userData.imagePanelSizeRatioInitial)
          const ratioF = Number.isFinite(rF) ? rF : 1
          const ratioI = Number.isFinite(rI) ? rI : ratioF
          const ratio = THREE.MathUtils.lerp(ratioF, ratioI, w)
          const width = innerWidth * ratio
          const height = width / aspect
          obj.scale.set(width, height, 1)
        } else {
          const w0 = Number(obj.userData.imagePanelStaticWidth)
          const h0 = Number(obj.userData.imagePanelStaticHeight)
          const width = Number.isFinite(w0) ? w0 : 1
          const height = Number.isFinite(h0) ? h0 : 1
          obj.scale.set(width, height, 1)
        }
      }
      const mat = obj.material
      const mats = Array.isArray(mat) ? mat : [mat]
      const raw0 = obj.userData?.slideTextPanel
        ? obj.userData.textPanelStackOpacityFront
        : obj.userData.imagePanelStackOpacityFront
      const raw1 = obj.userData?.slideTextPanel
        ? obj.userData.textPanelStackOpacityInitial
        : obj.userData.imagePanelStackOpacityInitial
      const o0 = Number.isFinite(Number(raw0)) ? clamp01(Number(raw0)) : 1
      const o1 = Number.isFinite(Number(raw1)) ? clamp01(Number(raw1)) : 1
      const t = THREE.MathUtils.lerp(o0, o1, w)
      const baseRaw = Number(obj.userData?.slideOpacityBase)
      const base = Number.isFinite(baseRaw) ? clamp01(baseRaw) : 1
      const mOpacity = cardBase * base * t
      for (const m of mats) {
        if (!m) continue
        m.transparent = true
        m.opacity = mOpacity
        if (m.uniforms?.opacity) m.uniforms.opacity.value = mOpacity
      }
    })
  }
}

function addOneSlideTextPanel(group3d, panel, innerWidth, innerHeight, panelIndex) {
  const panelWidth = innerWidth * panel.widthRatio
  const panelHeight = panelWidth / panel.aspectRatio
  const marginX = innerWidth * panel.marginXRatio
  const marginY = innerHeight * panel.marginYRatio
  const anchored = getAnchoredPanelPosition(
    panel.anchor,
    innerWidth,
    innerHeight,
    panelWidth,
    panelHeight,
    marginX,
    marginY
  )
  const tex = createSlideTextPanelTexture(panel)
  if (!tex) return
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(panelWidth, panelHeight),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  )
  plane.name = 'slide-text-panel'
  plane.userData.slideTextPanel = true
  plane.userData.textPanelIndex = panelIndex
  plane.userData.textPanelStackOpacityFront = panel.stackOpacityFront
  plane.userData.textPanelStackOpacityInitial = panel.stackOpacityInitial
  if (hasSlideTextPanelAbsolutePosition(panel)) {
    const pF =
      panel.finalPosition ??
      (panel.position
        ? { x: panel.position.x, y: panel.position.y, z: panel.zOffset }
        : null)
    const pI = panel.initialPosition ?? pF
    if (pF) {
      plane.userData.textPanelPositionFinal = { x: pF.x, y: pF.y, z: pF.z ?? panel.zOffset }
    }
    if (pI) {
      plane.userData.textPanelPositionInitial = { x: pI.x, y: pI.y, z: pI.z ?? panel.zOffset }
    }
    if (pF) {
      const z0 = pF.z ?? panel.zOffset
      plane.position.set(pF.x, pF.y, z0)
    } else {
      plane.position.set(panel.position.x, panel.position.y, panel.zOffset)
    }
  } else {
    const offsetX = innerWidth * panel.offsetXRatio
    const offsetY = innerHeight * panel.offsetYRatio
    plane.position.set(anchored.x + offsetX, anchored.y + offsetY, panel.zOffset)
  }
  const cardIndex = group3d.userData?.index ?? 0
  const stackRatio = panel.stackTextOffsetXRatio ?? 0
  if (stackRatio === 0) {
    group3d.add(plane)
    return
  }
  const t = getStackTextOffsetWeightForCardIndex(cardIndex)
  const offsetGroup = new THREE.Group()
  offsetGroup.name = 'slide-text-panel-offset'
  offsetGroup.userData.textPanelStackOffsetGroup = true
  offsetGroup.userData.textPanelStackOffsetXRatio = stackRatio
  offsetGroup.position.set(innerWidth * stackRatio * t, 0, 0)
  offsetGroup.add(plane)
  group3d.add(offsetGroup)
}

function addSlideTextPanels(group3d, node, innerWidth, innerHeight) {
  const panels = normalizeSlideTextPanelConfigs(node)
  if (panels.length === 0) return
  for (let i = 0; i < panels.length; i++) addOneSlideTextPanel(group3d, panels[i], innerWidth, innerHeight, i)
}

function configureSlideImagePanelTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = true
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
}

function getTextureImageDimensions(tex) {
  const img = tex?.image
  if (!img) return null
  const w = Number(img.naturalWidth ?? img.videoWidth ?? img.width)
  const h = Number(img.naturalHeight ?? img.videoHeight ?? img.height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

/**
 * @returns {{ w: number, h: number, L: number, R: number, T: number, B: number, innerW: number, innerH: number } | null}
 */
function getImagePanelCropState(tex, L, R, T, B) {
  const dims = getTextureImageDimensions(tex)
  if (!dims) return null
  const { w, h } = dims
  let a = Math.max(0, L)
  let b = Math.max(0, R)
  let c = Math.max(0, T)
  let d = Math.max(0, B)
  if (a + b >= w) a = 0, b = 0
  if (c + d >= h) c = 0, d = 0
  let iW = w - a - b
  let iH = h - c - d
  if (iW < 1 || iH < 1) {
    a = 0
    b = 0
    c = 0
    d = 0
    iW = w
    iH = h
  }
  return { w, h, L: a, R: b, T: c, B: d, innerW: iW, innerH: iH }
}

function applyImagePanelMapCrop(tex, L, R, T, B) {
  const s = getImagePanelCropState(tex, L, R, T, B)
  if (!s) return
  const { w: W, h: H, L: a, R: b, T: c, B: d, innerW, innerH } = s
  tex.offset.set(0, 0)
  tex.repeat.set(1, 1)
  if (a <= 0 && b <= 0 && c <= 0 && d <= 0) {
    tex.needsUpdate = true
    return
  }
  // Sample sub-rectangle (u,v) in [0,1]². Works with flipY on image maps.
  tex.repeat.set(innerW / W, innerH / H)
  tex.offset.set(a / W, c / H)
  tex.needsUpdate = true
}

function addOneSlideImagePanel(group3d, panel, innerWidth, innerHeight, panelIndex) {
  const cropL = Math.max(0, Number(panel.cropL) || 0)
  const cropR = Math.max(0, Number(panel.cropR) || 0)
  const cropT = Math.max(0, Number(panel.cropT) || 0)
  const cropB = Math.max(0, Number(panel.cropB) || 0)
  const resolveAnchoredBasePosition = (panelWidth, panelHeight) => {
    const marginX = innerWidth * panel.marginXRatio
    const marginY = innerHeight * panel.marginYRatio
    const anchored = getAnchoredPanelPosition(
      panel.anchor,
      innerWidth,
      innerHeight,
      panelWidth,
      panelHeight,
      marginX,
      marginY
    )
    if (hasSlideImagePanelAbsolutePosition(panel)) {
      return {
        x: panel.position.x,
        y: panel.position.y,
        z: panel.position.z ?? panel.zOffset,
      }
    }
    const offsetX = innerWidth * panel.offsetXRatio
    const offsetY = innerHeight * panel.offsetYRatio
    return { x: anchored.x + offsetX, y: anchored.y + offsetY, z: panel.zOffset }
  }
  let imageAspect = panel.aspectRatio
  const usesSizeRatio = panel.sizeRatio != null || panel.finalSizeRatio != null || panel.initialSizeRatio != null
  const staticWidth = innerWidth * panel.widthRatio
  const staticHeight = innerHeight * panel.heightRatio
  const defaultSizeRatio = panel.sizeRatio ?? panel.finalSizeRatio ?? panel.initialSizeRatio
  const sizeRatioFinal = panel.finalSizeRatio ?? defaultSizeRatio
  const sizeRatioInitial = panel.initialSizeRatio ?? sizeRatioFinal
  const startWidth = usesSizeRatio ? innerWidth * (sizeRatioFinal ?? 1) : staticWidth
  const startHeight = usesSizeRatio ? startWidth / Math.max(0.02, imageAspect) : staticHeight
  const basePos = resolveAnchoredBasePosition(startWidth, startHeight)
  const posFinal = panel.finalPosition ?? basePos
  const posInitial = panel.initialPosition ?? posFinal

  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: panel.opacity,
  })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  plane.name = 'slide-image-panel'
  plane.userData.slideImagePanel = true
  plane.userData.imagePanelIndex = panelIndex
  plane.userData.slideOpacityBase = panel.opacity
  plane.userData.imagePanelStackOpacityFront = panel.stackOpacityFront
  plane.userData.imagePanelStackOpacityInitial = panel.stackOpacityInitial
  plane.userData.imagePanelAspect = imageAspect
  plane.userData.imagePanelUseSizeRatio = usesSizeRatio
  plane.userData.imagePanelSizeRatioFinal = sizeRatioFinal
  plane.userData.imagePanelSizeRatioInitial = sizeRatioInitial
  plane.userData.imagePanelStaticWidth = staticWidth
  plane.userData.imagePanelStaticHeight = staticHeight
  plane.userData.imagePanelPositionFinal = { ...posFinal }
  plane.userData.imagePanelPositionInitial = { ...posInitial }
  plane.position.set(posFinal.x, posFinal.y, posFinal.z)
  if (usesSizeRatio) {
    const w = innerWidth * (sizeRatioFinal ?? 1)
    const h = w / Math.max(0.02, imageAspect)
    plane.scale.set(w, h, 1)
  } else {
    plane.scale.set(staticWidth, staticHeight, 1)
  }
  group3d.add(plane)

  const applyTex = (baseTex) => {
    if (!plane.parent) return
    const tex = baseTex.clone()
    configureSlideImagePanelTexture(tex)
    applyImagePanelMapCrop(tex, cropL, cropR, cropT, cropB)
    mat.map = tex
    mat.needsUpdate = true
  }
  const applyImageAspectFromTexture = (tex) => {
    const st = getImagePanelCropState(tex, cropL, cropR, cropT, cropB)
    if (!st) return
    imageAspect = st.innerW / st.innerH
    plane.userData.imagePanelAspect = imageAspect
    if (usesSizeRatio) {
      const ratioF = Number(plane.userData.imagePanelSizeRatioFinal)
      const ratio = Number.isFinite(ratioF) ? ratioF : 1
      const w = innerWidth * ratio
      const h = w / Math.max(0.02, imageAspect)
      plane.scale.set(w, h, 1)
    } else {
      const w0 = staticWidth
      const h0 = w0 / Math.max(0.02, imageAspect)
      plane.userData.imagePanelStaticWidth = w0
      plane.userData.imagePanelStaticHeight = h0
      plane.scale.set(w0, h0, 1)
    }
  }
  const cached = slideImagePanelTextureCache.get(panel.src)
  if (cached) {
    applyImageAspectFromTexture(cached)
    applyTex(cached)
    return
  }
  textureLoader.load(
    panel.src,
    (tex) => {
      configureSlideImagePanelTexture(tex)
      slideImagePanelTextureCache.set(panel.src, tex)
      applyImageAspectFromTexture(tex)
      applyTex(tex)
    },
    undefined,
    () => {}
  )
}

function addSlideImagePanels(group3d, node, innerWidth, innerHeight) {
  const panels = normalizeSlideImagePanelConfigs(node)
  if (panels.length === 0) return
  for (let i = 0; i < panels.length; i++) addOneSlideImagePanel(group3d, panels[i], innerWidth, innerHeight, i)
}

function getSlideCardInnerSize() {
  const borderThickness = 0.01 * 1.5 * stackLayout.scale
  return {
    innerWidth: CARD_WIDTH - 2 * borderThickness,
    innerHeight: CARD_HEIGHT - 2 * borderThickness,
  }
}

function removeSlideTextPanelMeshes(group3d) {
  if (!group3d) return
  const disposeMesh = (mesh) => {
    mesh.geometry?.dispose()
    if (mesh.material) {
      const m = mesh.material
      if (m.map) m.map.dispose()
      m.dispose()
    }
  }
  const groups = []
  group3d.traverse((obj) => {
    if (obj.userData?.textPanelStackOffsetGroup) groups.push(obj)
  })
  for (const g of groups) {
    g.traverse((obj) => {
      if (obj.isMesh) disposeMesh(obj)
    })
    g.removeFromParent()
  }
  const legacy = []
  group3d.traverse((obj) => {
    if (obj.isMesh && obj.userData?.slideTextPanel) legacy.push(obj)
  })
  for (const mesh of legacy) {
    disposeMesh(mesh)
    mesh.removeFromParent()
  }
}

function refreshSlideTextPanelsOnCard(group3d, node) {
  if (!group3d || !node) return
  removeSlideTextPanelMeshes(group3d)
  const { innerWidth, innerHeight } = getSlideCardInnerSize()
  addSlideTextPanels(group3d, node, innerWidth, innerHeight)
}

function removeSlideImagePanelMeshes(group3d) {
  if (!group3d) return
  const meshes = []
  group3d.traverse((obj) => {
    if (obj.isMesh && obj.userData?.slideImagePanel) meshes.push(obj)
  })
  for (const mesh of meshes) {
    mesh.geometry?.dispose()
    const mat = mesh.material
    const mats = Array.isArray(mat) ? mat : [mat]
    for (const m of mats) {
      if (!m) continue
      if (m.map) m.map.dispose()
      m.dispose()
    }
    mesh.removeFromParent()
  }
}

function refreshSlideImagePanelsOnCard(group3d, node) {
  if (!group3d || !node) return
  removeSlideImagePanelMeshes(group3d)
  const { innerWidth, innerHeight } = getSlideCardInnerSize()
  addSlideImagePanels(group3d, node, innerWidth, innerHeight)
}

function getDevTextEditorSlidePathLabel() {
  const parts = []
  for (let i = 1; i < path.length; i++) {
    const idx = path[i].parentIndex
    const parentGroup = path[i - 1].group
    const node = parentGroup[idx]
    parts.push(node?.name ?? String(idx))
  }
  const cur = currentGroup()[currentIndex]
  parts.push(cur?.name ?? String(currentIndex))
  return parts.join(' → ')
}

function createCardsForGroup(group, parentIndexForLabels) {
  const n = group.length
  const positions = getSlotPositions(n)
  const borderThickness = 0.01 * 1.5 * stackLayout.scale
  const innerWidth = CARD_WIDTH - 2 * borderThickness
  const innerHeight = CARD_HEIGHT - 2 * borderThickness
  const borderGeometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT)
  const innerGeometry = new THREE.PlaneGeometry(innerWidth, innerHeight)
  const borderMaterial = new THREE.MeshBasicMaterial({
    color: 0x808080,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const labelSize = 0.32
  const labelGeometry = new THREE.PlaneGeometry(labelSize, labelSize)
  const artGeometry = createFullArtPlaneGeometry(innerWidth, innerHeight)
  const cards = []
  for (let i = 0; i < n; i++) {
    const node = group[i]
    const pos = positions[i]
    const group3d = new THREE.Group()
    group3d.userData = { index: i, parentIndex: parentIndexForLabels, pageTurnY: 0, slideCardOpacity: 1 }
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
    addSlideImagePanels(group3d, node, innerWidth, innerHeight)
    addSlideTextPanels(group3d, node, innerWidth, innerHeight)
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
  syncSlideTimeline()
}

function setCardOpacity(group, value) {
  const v = THREE.MathUtils.clamp(value, 0, 1)
  if (group.userData) group.userData.slideCardOpacity = v
  // Text panels: base card opacity is `slideCardOpacity`; stack front/initial opacities are applied in
  // `updateSlideTextPanelStackVisuals` (also under `slide-text-panel-offset` groups).
  group.traverse((obj) => {
    if (!obj.isMesh) return
    if (obj.userData?.slideTextPanel || obj.userData?.slideImagePanel) return
    const mat = obj.material
    const mats = Array.isArray(mat) ? mat : [mat]
    const base = Number(obj.userData?.slideOpacityBase)
    const baseOpacity = Number.isFinite(base) ? THREE.MathUtils.clamp(base, 0, 1) : 1
    const outOpacity = v * baseOpacity
    for (const m of mats) {
      if (!m) continue
      m.transparent = true
      m.opacity = outOpacity
      if (m.uniforms?.opacity) m.uniforms.opacity.value = outOpacity
    }
  })
  if (!isTextPanelVisualEditActive()) updateSlideTextPanelStackVisuals()
}

function getCardOpacity(group) {
  const first = group.children[0]
  if (!first?.material) return 1
  const m = first.material
  return m.uniforms?.opacity ? m.uniforms.opacity.value : m.opacity
}

function setCardRenderOrder(group, order) {
  if (!group) return
  group.traverse((obj) => {
    if (obj.isMesh) obj.renderOrder = order
  })
}

function resetAllCardRenderOrders() {
  for (const c of cards) setCardRenderOrder(c, 0)
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

function syncSlideTimeline() {
  try {
    if (path.length < 2) {
      buildSlideTimeline(slideTimelineGroup, { n: 0, slotPositions: [], config: false, cards })
      return
    }
    const owner = getOwnerNode(path)
    const n = numSlides()
    buildSlideTimeline(slideTimelineGroup, {
      n,
      slotPositions,
      config: owner?.timeline ?? null,
      cards,
      cardHeight: CARD_HEIGHT,
    })
    updateSlideTimeline(slideTimelineGroup, gltfSlideIndex, camera, undefined, currentIndex, targetIndex)
  } catch (e) {
    console.error('syncSlideTimeline failed; timeline disabled.', e)
    try {
      buildSlideTimeline(slideTimelineGroup, { n: 0, slotPositions: [], config: false, cards })
    } catch (_) {}
  }
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
  killStackSnapTween()
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

// --- Mobile stack scrub: drag vertically through fractional slide index, snap on release ---
const _stackLerpPosA = []
const _stackLerpPosB = []
const _stackLerpOpA = []
const _stackLerpOpB = []

function ensureStackLerpBuffers(n) {
  while (_stackLerpPosA.length < n) {
    _stackLerpPosA.push(new THREE.Vector3())
    _stackLerpPosB.push(new THREE.Vector3())
  }
  while (_stackLerpOpA.length < n) {
    _stackLerpOpA.push(0)
    _stackLerpOpB.push(0)
  }
}

function fillDiscreteStackLayout(frontIdx, n, vanish, outPos, outOp) {
  for (let i = 0; i < n; i++) {
    if (i < frontIdx) {
      outPos[i].set(vanish.x, vanish.y ?? 0, vanish.z)
      outOp[i] = 0
    } else {
      const slot = slotPositions[i - frontIdx]
      outPos[i].set(slot.x, slot.y ?? 0, slot.z)
      outOp[i] = 1
    }
  }
}

/** @type {ReturnType<typeof gsap.to> | null} */
let stackSnapTween = null
let stackDragActive = false
let stackDragCandidate = false
let stackDragPtrDownX = 0
let stackDragPtrDownY = 0
let stackDragBaselineFloat = 0
let stackDragAnchorY = 0
let stackDragAnchorX = 0
/** Last clientX for per-move logo spin during horizontal scrub. */
let stackDragLastClientXForLogo = 0
/** Raw linear index from finger (before magnetic remap). */
let stackDragLastRawF = null
/** Drag direction for asymmetric magnetic curve. */
let stackDragForwardHint = true
/** Smoothed displayed index (lerps toward magnetic target each move). */
let stackDragDisplayF = 0
/** Previous raw (pre-magnetic) float index; used to detect crossing `slideStackMagneticCommit`. */
let stackDragMagPrevRawF = null

function stackScrubUsesHorizontalAxis() {
  return layoutProfile.slideStackDragAxis === 'horizontal'
}

function stackScrubHorizontalSign() {
  const s = layoutProfile.slideStackDragHorizontalSign
  return s === -1 ? -1 : 1
}

function stackScrubRawF(clientX, clientY, baseline, px) {
  const n = numSlides()
  const hi = Math.max(0, n - 1)
  if (stackScrubUsesHorizontalAxis()) {
    const sx = stackScrubHorizontalSign()
    // sx=1: finger +X → higher index (ArrowRight). sx=-1 inverts (see layoutProfile.slideStackDragHorizontalSign).
    return THREE.MathUtils.clamp(
      baseline + (sx * (clientX - stackDragAnchorX)) / px,
      0,
      hi
    )
  }
  return THREE.MathUtils.clamp(baseline + (stackDragAnchorY - clientY) / px, 0, hi)
}

function applyHorizontalScrubLogoSpin(clientX) {
  const radPerPx = layoutProfile.slideStackLogoSpinPerPx
  if (!stackScrubUsesHorizontalAxis() || radPerPx == null || radPerPx === 0) return
  const dlx = clientX - stackDragLastClientXForLogo
  stackDragLastClientXForLogo = clientX
  if (Math.abs(dlx) < 1e-4) return
  // Opposite sign vs slide scrub: world-Y spin direction for this mesh reads better inverted from finger X.
  logoSpinAngle -= stackScrubHorizontalSign() * dlx * radPerPx
}

/**
 * When raw slide fraction crosses the magnetic sticky boundary, fire the same logo stimulus as arrow keys
 * (`triggerLogoStimulus` → `logoNavStimulus` / `omegaTarget` ramp and `LOGO_STIMULUS_DECAY` coast-down).
 */
function maybeTriggerMagneticCommitLogoStimulus(rawF) {
  const commit = layoutProfile.slideStackMagneticCommit
  if (commit == null || commit <= 0) return
  if (layoutProfile.slideStackMagneticLogoStimulusOnCommit === false) return

  const n = numSlides()
  const maxF = Math.max(0, n - 1)
  const rf = THREE.MathUtils.clamp(rawF, 0, maxF)
  const k = Math.floor(rf)
  const u = rf - k

  if (stackDragMagPrevRawF == null) {
    stackDragMagPrevRawF = rf
    return
  }

  const prf = stackDragMagPrevRawF
  const pk = Math.floor(prf)
  const pu = prf - pk

  if (k === pk && k < n - 1) {
    const c = THREE.MathUtils.clamp(commit, 0.04, 0.48)
    const delta = rf - prf
    if (delta > 1e-7 && pu <= c && u > c) {
      triggerLogoStimulus(1)
    } else if (delta < -1e-7 && pu >= 1 - c && u < 1 - c) {
      triggerLogoStimulus(-1)
    }
  }

  stackDragMagPrevRawF = rf
}

/**
 * Resistance in the first `commit` of fractional travel, then ease toward the next integer.
 * Mirrored when dragging backward.
 */
function magneticInterSlideU(u, forward, commit, stickPow, pullPow) {
  const c = THREE.MathUtils.clamp(commit, 0.04, 0.48)
  u = THREE.MathUtils.clamp(u, 0, 1)
  if (forward) {
    if (u <= c) return c * Math.pow(u / c, stickPow)
    const t = (u - c) / (1 - c)
    return c + (1 - c) * Math.pow(t, pullPow)
  }
  const v = 1 - u
  return 1 - magneticInterSlideU(v, true, c, stickPow, pullPow)
}

function applyMagneticToRawSlideIndex(rawF) {
  const n = numSlides()
  const maxF = Math.max(0, n - 1)
  let rf = THREE.MathUtils.clamp(rawF, 0, maxF)
  const commit = layoutProfile.slideStackMagneticCommit

  if (stackDragLastRawF != null) {
    const delta = rf - stackDragLastRawF
    if (Math.abs(delta) > 1e-5) stackDragForwardHint = delta > 0
  }
  stackDragLastRawF = rf

  if (commit == null || commit <= 0 || n <= 1) return rf

  const stickPow = layoutProfile.slideStackMagneticStickPower ?? 2.2
  const pullPow = layoutProfile.slideStackMagneticPullPower ?? 2.35
  const k = Math.floor(rf)
  const u = rf - k
  if (k >= n - 1) return rf

  return k + magneticInterSlideU(u, stackDragForwardHint, commit, stickPow, pullPow)
}

function killStackSnapTween() {
  if (stackSnapTween) {
    stackSnapTween.kill()
    stackSnapTween = null
  }
}

function isStackScrubInteracting() {
  return stackDragActive || stackSnapTween != null
}

function applySlideStackAtFloatIndex(f) {
  const n = numSlides()
  if (n === 0 || cards.length < n) return
  f = THREE.MathUtils.clamp(f, 0, n - 1)
  const vanish = getVanishPosition()
  ensureStackLerpBuffers(n)
  const k0 = Math.floor(f)
  const k1 = Math.min(n - 1, k0 + 1)
  const t = f - k0
  fillDiscreteStackLayout(k0, n, vanish, _stackLerpPosA, _stackLerpOpA)
  fillDiscreteStackLayout(k1, n, vanish, _stackLerpPosB, _stackLerpOpB)
  for (let i = 0; i < n; i++) {
    cards[i].position.lerpVectors(_stackLerpPosA[i], _stackLerpPosB[i], t)
    setCardOpacity(cards[i], THREE.MathUtils.lerp(_stackLerpOpA[i], _stackLerpOpB[i], t))
  }
  gltfSlideIndex = f
  const r = Math.round(f)
  currentIndex = r
  targetIndex = r
}

function snapStackDragToNearestSlide() {
  const n = numSlides()
  if (n === 0) return
  killStackSnapTween()
  const snapped = THREE.MathUtils.clamp(Math.round(gltfSlideIndex), 0, n - 1)
  const dur = layoutProfile.slideStackSnapDuration ?? 0.15
  if (dur <= 0.01 || Math.abs(snapped - gltfSlideIndex) < 1e-5) {
    applySlideStackAtFloatIndex(snapped)
    return
  }
  const o = { f: gltfSlideIndex }
  stackSnapTween = gsap.to(o, {
    f: snapped,
    duration: dur,
    ease: layoutProfile.slideStackSnapEase ?? 'expo.out',
    onUpdate: () => {
      applySlideStackAtFloatIndex(o.f)
    },
    onComplete: () => {
      applySlideStackAtFloatIndex(snapped)
      stackSnapTween = null
    },
  })
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
  const parentIndexForLabels = currentIndex

  resetAllCardRenderOrders()
  setCardRenderOrder(cards[currentIndex], 2)

  const endEnterChild = () => {
    resetAllCardRenderOrders()
    activeTimeline = null
    isTransitioning = false
  }
  const killEnterChild = () => {
    resetAllCardRenderOrders()
    activeTimeline = null
    isTransitioning = false
  }

  // Phase 1: collapse + page-turn parent slide out. Phase 2 (swap, page-in, uncollapse) runs after rAF
  // so the new meshes render one frame and GSAP does not snap child tweens to end in the same tick.
  activeTimeline = gsap.timeline({
    onComplete: () => {
      removeCardsFromScene(cards)
      path.push({ group: children, parentIndex: parentIndexForLabels })
      slotPositions = getSlotPositions(children.length)
      currentIndex = 0
      targetIndex = 0
      gltfSlideIndex = 0
      _frontStackYawSmoothedForIndex = -1
      cards = createCardsForGroup(children, parentIndexForLabels)
      cardMeshes = cards.map((g) => g.userData.hitMesh)
      setBackgroundForPath()
      syncSlideTimeline()
      resetAllCardRenderOrders()
      setCardRenderOrder(cards[0], 2)

      const childSlot0 = slotPositions[0]
      const childAxis = getPageTurnAxis(childSlot0)
      const childRestX = childSlot0.x
      const childN = children.length
      setCardPageTurnState(cards[0], childAxis, -Math.PI / 2, childRestX)
      setCardOpacity(cards[0], 0)
      for (let i = 1; i < childN; i++) {
        cards[i].position.set(childSlot0.x, childSlot0.y ?? 0, childSlot0.z - COLLAPSE_OFFSET_Z * i)
        setCardOpacity(cards[i], 0)
      }

      requestAnimationFrame(() => {
        const tl = gsap.timeline({ onComplete: endEnterChild, onKill: killEnterChild })
        activeTimeline = tl
        const slot = slotPositions[0]
        const cAxis = getPageTurnAxis(slot)
        const cRestX = slot.x
        const cn = children.length

        const angleIn = { value: -Math.PI / 2 }
        const opacityIn = { value: 0 }
        tl.to(angleIn, {
          value: 0,
          duration: TRANSITION_PAGE_TURN_IN_DURATION,
          ease: EASE,
          onUpdate: () => {
            setCardPageTurnState(cards[0], cAxis, angleIn.value, cRestX)
            setCardOpacity(cards[0], opacityIn.value)
          },
        })
        tl.to(opacityIn, {
          value: 1,
          duration: TRANSITION_PAGE_TURN_IN_DURATION,
          ease: EASE,
          onUpdate: () => setCardOpacity(cards[0], opacityIn.value),
        }, '<')

        if (cn > 1) {
          for (let i = 1; i < cn; i++) {
            const s = slotPositions[i]
            tl.to(cards[i].position, {
              x: s.x,
              y: s.y ?? 0,
              z: s.z,
              duration: TRANSITION_UNCROLL_DURATION,
              ease: EASE,
            }, '<')
            const op = { value: 0 }
            tl.to(op, {
              value: 1,
              duration: TRANSITION_UNCROLL_DURATION,
              onUpdate: () => setCardOpacity(cards[i], op.value),
            }, '<')
          }
        }
      })
    },
    onKill: killEnterChild,
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
}

function goBackWithTransition() {
  if (path.length <= 1) return
  if (activeTimeline) activeTimeline.kill()
  isTransitioning = true

  const n = currentGroup().length
  const slot0 = slotPositions[0]
  const axis = getPageTurnAxis(slot0)
  const restX = slot0.x
  resetAllCardRenderOrders()
  setCardRenderOrder(cards[0], 2)

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
      syncSlideTimeline()
      requestAnimationFrame(() => setBackgroundForPath())

      const parentSlot0 = slotPositions[0]
      const parentAxis = getPageTurnAxis(parentSlot0)
      const parentRestX = parentSlot0.x
      const parentN = parentGroup.length

      for (let i = 0; i < parentN; i++) {
        setCardOpacity(cards[i], 0)
      }
      resetAllCardRenderOrders()
      setCardRenderOrder(cards[frontIndex], 2)

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
            resetAllCardRenderOrders()
            activeTimeline = null
            isTransitioning = false
          },
          onKill: () => {
            resetAllCardRenderOrders()
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
      resetAllCardRenderOrders()
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
  const newTarget = Math.min(lastSlideIndex(), currentIndex + 1)
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
  const newTarget = Math.max(0, currentIndex - 1)
  if (newTarget === targetIndex) return
  targetIndex = newTarget
  logoSlideNavDir = -1
  logoLastSpinDir = -1
  animateToTarget(getDurationForDirection('left'))
}

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
const CLICK_NAVIGATE_DURATION = 0.5

/** Primary pointer that started on the canvas (touch idle reset). */
let activeCanvasPointerId = null
let swipePointerId = null
let suppressNextCanvasClick = false

window.addEventListener('keydown', (e) => {
  if (isTextPanelVisualEditActive()) return
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
if (layoutProfile.useWheelNav) {
  window.addEventListener('wheel', (e) => {
    if (isTextPanelVisualEditActive()) {
      e.preventDefault()
      return
    }
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
}

/** Max movement (px) to count as a tap vs swipe; pointerup uses this so touch picks match click. */
const CANVAS_TAP_SLOP_PX = 16

/**
 * Raycast pick: same behaviour as a canvas click (enter child / link / jump to slide).
 * @param {number} clientX
 * @param {number} clientY
 */
function performCanvasSlidePick(clientX, clientY) {
  if (isTextPanelVisualEditActive()) return
  if (isTransitioning || isStackScrubInteracting()) return
  const el = renderer.domElement
  const rect = el.getBoundingClientRect()
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
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

function onCanvasClick(e) {
  if (suppressNextCanvasClick) {
    suppressNextCanvasClick = false
    return
  }
  performCanvasSlidePick(e.clientX, e.clientY)
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
  if (isTextPanelVisualEditActive()) return
  pointerIsOverCanvas = true
  if (!layoutProfile.useSwipeNav || isTransitioning || cards.length === 0) {
    updateSlideHoverFromPointer(e.clientX, e.clientY)
    return
  }
  if (stackDragActive) {
    const px = layoutProfile.slideStackDragPxPerSlide ?? 52
    const rawF = stackScrubRawF(e.clientX, e.clientY, stackDragBaselineFloat, px)
    maybeTriggerMagneticCommitLogoStimulus(rawF)
    const fMag = applyMagneticToRawSlideIndex(rawF)
    const follow = layoutProfile.slideStackMagneticFollow ?? 1
    stackDragDisplayF = THREE.MathUtils.lerp(stackDragDisplayF, fMag, Math.min(1, follow))
    applySlideStackAtFloatIndex(stackDragDisplayF)
    applyHorizontalScrubLogoSpin(e.clientX)
    return
  }
  if (stackDragCandidate) {
    const tdx = e.clientX - stackDragPtrDownX
    const tdy = e.clientY - stackDragPtrDownY
    const arm = layoutProfile.slideStackDragArmPx ?? 12
    const ratio = layoutProfile.swipeDominanceRatio ?? 1.2
    const armed = stackScrubUsesHorizontalAxis()
      ? Math.abs(tdx) >= arm && Math.abs(tdx) >= Math.abs(tdy) * ratio
      : Math.abs(tdy) >= arm && Math.abs(tdy) >= Math.abs(tdx) * ratio
    if (armed) {
      if (activeTimeline) activeTimeline.kill()
      killStackSnapTween()
      stackDragActive = true
      stackDragCandidate = false
      pointerIsOverCanvas = false
      hoverTiltTargetX = 0
      hoverTiltTargetY = 0
      hoverTiltCurrentX = 0
      hoverTiltCurrentY = 0
      hoverDeepIndex = -1
      hoverFrontPop = false
      for (const c of cards) {
        c.userData._hoverLiftApplied = 0
        c.userData._hoverXApplied = 0
        c.userData._hoverYApplied = 0
        c.scale.setScalar(1)
      }
      stackDragBaselineFloat = gltfSlideIndex
      stackDragAnchorY = e.clientY
      stackDragAnchorX = e.clientX
      stackDragLastClientXForLogo = e.clientX
      stackDragLastRawF = gltfSlideIndex
      stackDragForwardHint = true
      stackDragDisplayF = gltfSlideIndex
      const px = layoutProfile.slideStackDragPxPerSlide ?? 52
      const rawF = stackScrubRawF(e.clientX, e.clientY, stackDragBaselineFloat, px)
      const fMag = applyMagneticToRawSlideIndex(rawF)
      const follow = layoutProfile.slideStackMagneticFollow ?? 1
      stackDragDisplayF = THREE.MathUtils.lerp(stackDragDisplayF, fMag, Math.min(1, follow))
      applySlideStackAtFloatIndex(stackDragDisplayF)
    } else {
      updateSlideHoverFromPointer(e.clientX, e.clientY)
    }
    return
  }
  updateSlideHoverFromPointer(e.clientX, e.clientY)
})

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (isTextPanelVisualEditActive()) return
  if (layoutProfile.clearHoverOnPointerEnd) activeCanvasPointerId = e.pointerId
  if (layoutProfile.useSwipeNav && e.isPrimary) {
    swipePointerId = e.pointerId
    stackDragPtrDownX = e.clientX
    stackDragPtrDownY = e.clientY
    stackDragActive = false
    stackDragCandidate = true
    stackDragLastRawF = null
    stackDragMagPrevRawF = null
    killStackSnapTween()
  }
})

window.addEventListener(
  'pointerup',
  (e) => {
    if (layoutProfile.useSwipeNav && e.pointerId === swipePointerId) {
      const dx = e.clientX - stackDragPtrDownX
      const dy = e.clientY - stackDragPtrDownY
      swipePointerId = null
      if (stackDragActive) {
        stackDragActive = false
        stackDragCandidate = false
        snapStackDragToNearestSlide()
        suppressNextCanvasClick = true
      } else {
        stackDragCandidate = false
        if (Math.hypot(dx, dy) <= CANVAS_TAP_SLOP_PX) {
          suppressNextCanvasClick = true
          performCanvasSlidePick(e.clientX, e.clientY)
        }
      }
    }

    if (layoutProfile.clearHoverOnPointerEnd && e.pointerId === activeCanvasPointerId) {
      pointerIsOverCanvas = false
      hoverTiltTargetX = 0
      hoverTiltTargetY = 0
      hoverDeepIndex = -1
      hoverFrontPop = false
      activeCanvasPointerId = null
    }
  },
  true
)

window.addEventListener('pointercancel', (e) => {
  if (layoutProfile.useSwipeNav && e.pointerId === swipePointerId) {
    const wasStackDrag = stackDragActive
    swipePointerId = null
    stackDragCandidate = false
    if (wasStackDrag) {
      stackDragActive = false
      snapStackDragToNearestSlide()
      suppressNextCanvasClick = true
    }
  }
  if (layoutProfile.clearHoverOnPointerEnd && e.pointerId === activeCanvasPointerId) {
    pointerIsOverCanvas = false
    hoverTiltTargetX = 0
    hoverTiltTargetY = 0
    hoverDeepIndex = -1
    hoverFrontPop = false
    activeCanvasPointerId = null
  }
}, true)

if (layoutProfile.useWindowParallax) {
  window.addEventListener('pointermove', (e) => {
    if (isTextPanelVisualEditActive()) return
    setCameraParallaxFromClient(e.clientX, e.clientY)
  }, { passive: true })
}
document.documentElement.addEventListener('mouseleave', () => {
  cameraParallaxTargetNdcX = 0
  cameraParallaxTargetNdcY = 0
})

window.addEventListener('resize', () => {
  syncRendererToWindow()
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
  const tpEdit = isTextPanelVisualEditActive()
  if (tpEdit) {
    pointerIsOverCanvas = false
    hoverTiltTargetX = 0
    hoverTiltTargetY = 0
    hoverDeepIndex = -1
    hoverFrontPop = false
    stackDragActive = false
    stackDragCandidate = false
  }

  const delta = clock.getDelta()
  if (!tpEdit) {
    animationMixers.forEach((m) => m.update(delta))
  }
  if (sitIdleVideoTexture?.image?.readyState >= 2) sitIdleVideoTexture.needsUpdate = true
  const total = numSlides()
  slideCounterEl.textContent = `${targetIndex + 1} of ${total}`

  if (!tpEdit) {
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
  }
  stepBackgroundVideoPlayback()
  if (!tpEdit) {
    stepCameraParallax(delta)
  }

  _slideCounterPos.set(SLIDE_COUNTER_X, SLIDE_COUNTER_Y, 0).project(camera)
  const px = (_slideCounterPos.x * 0.5 + 0.5) * window.innerWidth
  const py = (-_slideCounterPos.y * 0.5 + 0.5) * window.innerHeight
  slideCounterEl.style.left = `${px}px`
  slideCounterEl.style.top = `${py}px`
  const pathIndices = path.slice(1).map((p) => p.parentIndex)
  if (!tpEdit) {
    updateSlideArtEffects()
    updateSlideTextPanelStackVisuals()
    if (
      !activeTimeline &&
      targetIndex !== currentIndex &&
      Math.abs(gltfSlideIndex - currentIndex) < 0.02
    ) {
      targetIndex = currentIndex
    }
    updateSlideTimeline(slideTimelineGroup, gltfSlideIndex, camera, undefined, currentIndex, targetIndex)
  }
  if (!tpEdit) {
    syncSlideStackRotations(delta)
    stepAndApplyFrontSlideHoverTilt(delta)
    stepAndApplyDeepSlideHover(delta)
    stepAndApplyFrontSlideHoverPop(delta)
  }
  const context = { numSlides: total, gltfSlideIndex, camera, pathIndices, logoSpinAngle }
  if (!tpEdit) {
    sceneObjectConfigs.forEach((objConfig) => {
      if (objConfig.model) applySceneObjectBehaviour(objConfig.model, objConfig, context)
    })
  }
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

if (import.meta.env.DEV) {
  import('./textPanelEditor.js').then(({ initTextPanelEditor }) => {
    initTextPanelEditor({
      getContext: () => {
        const g = currentGroup()
        const node = g[currentIndex]
        const card = cards[currentIndex]
        if (!node || !card) return null
        return {
          node,
          card,
          pathLabel: getDevTextEditorSlidePathLabel(),
          editorKey: `${path.length}|${currentIndex}|${node.name ?? ''}`,
        }
      },
      getTextPanelStorageKey: () =>
        buildTextPanelStorageKey(layoutProfile.id, contentPageId, path, currentIndex),
      refresh: ({ node, card }) => refreshSlideTextPanelsOnCard(card, node),
      getThree: () => ({
        camera,
        scene,
        renderer,
        getInnerSize: getSlideCardInnerSize,
      }),
    })
  })
}
