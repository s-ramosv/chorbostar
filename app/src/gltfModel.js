import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Set renderOrder on an object and all its descendants (higher = drawn later, in front).
 * @param {THREE.Object3D} obj
 * @param {number} order
 */
function setRenderOrderRecursive(obj, order) {
  obj.renderOrder = order
  obj.traverse((child) => { child.renderOrder = order })
}

// Overlay uses default depth (depthTest/depthWrite true). main.js clears depth buffer before overlay pass
// so overlay draws on top of slides and meshes occlude each other correctly (no green/gray clipping).

/**
 * Center the model so its bounding-box center is at the origin (position then acts as center; z won't shift).
 * Puts the raw model inside a wrapper group and returns the wrapper.
 * @param {THREE.Object3D} model
 * @returns {{ wrapper: THREE.Group, model: THREE.Object3D }}
 */
function centerModel(model) {
  const box = new THREE.Box3().setFromObject(model)
  const center = new THREE.Vector3()
  box.getCenter(center)
  if (center.x === 0 && center.y === 0 && center.z === 0) {
    const wrapper = new THREE.Group()
    wrapper.add(model)
    return { wrapper, model }
  }
  model.position.sub(center)
  const wrapper = new THREE.Group()
  wrapper.add(model)
  return { wrapper, model }
}

/**
 * Load a GLTF/GLB model and add it to the scene.
 * - Sets loader path so external .bin and textures next to the .gltf load correctly.
 * - Centers the model so position is the visual center (changing z won't shift it sideways).
 * - Optional scale: uniform scale so different-sized models fit the scene.
 *
 * @param {THREE.Scene} scene - Three.js scene (or overlayScene if alwaysOnTop)
 * @param {string} url - URL to the .gltf or .glb file (e.g. '/assets/3D/ipod_classic/scene.gltf')
 * @param {{ position?: { x?: number, y?: number, z?: number }, scale?: number, renderOrder?: number, alwaysOnTop?: boolean, overlayScene?: THREE.Scene, onLoad?: (model: THREE.Group) => void }} [options]
 * @returns {Promise<THREE.Group>} The wrapper group (centered); use wrapper.position to move, wrapper.scale to scale.
 */
export function loadGltfModel(scene, url, options = {}) {
  const { position = { x: 0, y: 0, z: 0 }, scale: scaleOption, renderOrder, alwaysOnTop, overlayScene, onLoad } = options

  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    const path = url.replace(/[^/]+$/, '')
    const filename = path ? url.slice(path.length) : url
    if (path) loader.setPath(path)

    loader.load(
      filename,
      (gltf) => {
        const raw = gltf.scene
        const { wrapper, model } = centerModel(raw)
        wrapper.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0)
        if (scaleOption != null) wrapper.scale.setScalar(scaleOption)
        if (renderOrder != null) setRenderOrderRecursive(wrapper, renderOrder)
        const targetScene = alwaysOnTop && overlayScene ? overlayScene : scene
        targetScene.add(wrapper)
        onLoad?.(wrapper)
        resolve(wrapper)
      },
      undefined,
      (err) => {
        console.error('GLTF load error:', err)
        reject(err)
      }
    )
  })
}
