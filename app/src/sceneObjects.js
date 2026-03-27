import * as THREE from 'three'

/**
 * Config-driven 3D scene objects (GLTF models).
 * Add an entry to SCENE_OBJECT_CONFIGS to add a new object; set position/rotation mode to control behaviour.
 *
 * Config shape:
 * - url: string – path to .gltf or .glb
 * - scale: number – uniform scale
 * - scene: 'main' | 'overlay' – which scene to add to
 * - alwaysOnTop?: boolean – if overlay, draw on top of slides (depthTest: false, second pass)
 * - position: { mode: 'world', x, y, z } | { mode: 'camera', distance, offsetX, offsetY }
 * - rotation: { mode: 'slideIndex'|'velocitySpin'|'fixed'|'none', initialY?: number, initialX?: number, initialZ?: number, y?: number }
 *   - initialX, initialY, initialZ = base orientation. For slideIndex / velocitySpin, spin is applied around world Y (not the tilted model's Y).
 *   - velocitySpin: uses context.logoSpinAngle (rad), driven by main.js (physics-like angular velocity, not slide count).
 *   - y: used when mode is 'fixed' (overrides initialY if set)
 * - groupPath?: number[] – if set, object is only visible when current path starts with these indices (e.g. [0] = first top-level group and its subgroups; [0, 1] = first group's second subgroup). Omit for global objects (always visible).
 * - model: THREE.Group | null – set by loader (do not set in config)
 */

/** @type {Array<{ url: string, scale: number, scene: 'main'|'overlay', alwaysOnTop?: boolean, position: object, rotation: object, groupPath?: number[], model?: THREE.Group|null }} */
export const SCENE_OBJECT_CONFIGS = [
  {
    id: 'xbox-logo',
    url: '/assets/3D/xbox_logo-2/scene.gltf',
    scale: 0.8,
    scene: 'overlay',
    alwaysOnTop: true,
    position: {
      mode: 'camera',
      distance: 5,
      offsetX: 7,
      offsetY: -3.5,
    },
    rotation: { mode: 'velocitySpin', initialY: 2.35, initialX: 1, initialZ: 0 },
  },
  // Group-scoped example (only visible in first top-level group and its subgroups):
  // { id: 'music-player-model', url: '...', scale: 1, scene: 'overlay', groupPath: [0], position: {...}, rotation: {...} },
  // Only in first group's second subgroup: groupPath: [0, 1],
]

const _eulerInitial = new THREE.Euler()
const _quatInitial = new THREE.Quaternion()
const _quatWorldY = new THREE.Quaternion()
const _worldY = new THREE.Vector3(0, 1, 0)

/** True when current path (pathIndices) is inside the group identified by groupPath (same indices or deeper under it). */
export function isPathInGroup(pathIndices, groupPath) {
  if (!groupPath || groupPath.length === 0) return true
  return pathIndices.length >= groupPath.length && groupPath.every((idx, i) => pathIndices[i] === idx)
}

/**
 * Apply position and rotation to a loaded model from its config and current context.
 * For slideIndex, spin is applied around world Y so you can tune initialX/initialY/initialZ without changing the spin axis.
 * @param {THREE.Group} model - The loaded model (wrapper group)
 * @param {object} config - Same entry from SCENE_OBJECT_CONFIGS
 * @param {{ numSlides: number, gltfSlideIndex: number, camera: THREE.PerspectiveCamera, pathIndices: number[], logoSpinAngle?: number }} context
 */
export function applySceneObjectBehaviour(model, config, context) {
  const { position, rotation, groupPath } = config
  const { numSlides, gltfSlideIndex, camera, pathIndices, logoSpinAngle = 0 } = context

  model.visible = isPathInGroup(pathIndices ?? [], groupPath)
  if (!model.visible) return

  if (position.mode === 'world') {
    model.position.set(
      position.x ?? 0,
      position.y ?? 0,
      position.z ?? 0
    )
  } else if (position.mode === 'camera') {
    model.position.set(
      position.offsetX ?? 0,
      position.offsetY ?? 0,
      -(position.distance ?? 2)
    )
  }

  const initialY = rotation.initialY ?? rotation.offsetY ?? 0
  const initialX = rotation.initialX ?? 0
  const initialZ = rotation.initialZ ?? 0

  if (rotation.mode === 'slideIndex') {
    const spin = numSlides <= 1 ? 0 : (gltfSlideIndex / (numSlides - 1)) * Math.PI * 2
    _eulerInitial.set(initialX, initialY, initialZ, 'XYZ')
    _quatInitial.setFromEuler(_eulerInitial)
    _quatWorldY.setFromAxisAngle(_worldY, spin)
    model.quaternion.copy(_quatWorldY).multiply(_quatInitial)
  } else if (rotation.mode === 'velocitySpin') {
    _eulerInitial.set(initialX, initialY, initialZ, 'XYZ')
    _quatInitial.setFromEuler(_eulerInitial)
    _quatWorldY.setFromAxisAngle(_worldY, logoSpinAngle)
    model.quaternion.copy(_quatWorldY).multiply(_quatInitial)
  } else {
    model.rotation.set(initialX, initialY, initialZ)
    if (rotation.mode === 'fixed' && rotation.y !== undefined) model.rotation.y = rotation.y
  }
}
