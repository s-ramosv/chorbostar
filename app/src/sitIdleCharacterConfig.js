/**
 * Animated FBX character beside the slides (separate from GLTF `sceneObjects.js`).
 *
 * - Desktop / mobile each have their own file and transform/video settings.
 * - Set `enabled: false` on a profile to skip loading entirely.
 * - Put `.fbx` and texture files under `public/assets/3D/sit-idle/` (served as `/assets/3D/sit-idle/...`).
 */

/** @typedef {typeof SIT_IDLE_CHARACTER_DESKTOP} SitIdleCharacterConfig */

export const SIT_IDLE_CHARACTER_DESKTOP = {
  enabled: true,
  renderBehindSlides: false,
  fbxFile: 'Sitting Idle.fbx',
  fbxScale: 9.5,
  mirrorX: -1,
  mirrorTextureX: -1,
  wrapperPosition: { x: 1, y: -2.6, z: -4 },
  wrapperRotation: { x: Math.PI / 64, y: -Math.PI / 16, z: 0 },
  videoFile: 'texture8.mp4',
  normalMapFile: 'tripo_normal_96033f95-3167-4070-bcee-43528d052148.jpg',
}

/** Portrait / touch: different model and/or placement; tune `wrapperPosition` / `fbxScale` here. */
export const SIT_IDLE_CHARACTER_MOBILE = {
  enabled: true,
  /** If true, character is parented to the main slide scene (depth-sorted behind cards) instead of the overlay pass. */
  renderBehindSlides: true,
  fbxFile: 'Neutral Idle.fbx',
  fbxScale: 7.8,
  mirrorX: -1,
  mirrorTextureX: -1,
  wrapperPosition: { x: -1.2, y: -2.8, z: -3.75 },
  wrapperRotation: { x: Math.PI / 4, y: Math.PI / 5, z: -Math.PI / 32 },
  videoFile: 'texture8.mp4',
  normalMapFile: 'tripo_normal_96033f95-3167-4070-bcee-43528d052148.jpg',
}

/**
 * @param {'desktop' | 'mobile'} profileId
 * @returns {SitIdleCharacterConfig}
 */
export function getSitIdleCharacterConfig(profileId) {
  return profileId === 'mobile' ? SIT_IDLE_CHARACTER_MOBILE : SIT_IDLE_CHARACTER_DESKTOP
}
