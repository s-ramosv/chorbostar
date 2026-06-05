/**
 * Animated FBX character beside the slides (separate from GLTF `sceneObjects.js`).
 *
 * - Desktop default / desktop alt / mobile can each use independent settings.
 * - Set `enabled: false` on a profile to skip loading entirely.
 * - Put `.fbx` and texture files under `public/assets/3D/sit-idle/` (served as `/assets/3D/sit-idle/...`).
 * - `appearance: 'white'`: optional bright PBR white (no video); default desktop/alt use `'video'`.
 */

/** @typedef {typeof SIT_IDLE_CHARACTER_DESKTOP} SitIdleCharacterConfig */

export const SIT_IDLE_CHARACTER_DESKTOP = {
  enabled: true,
  /** `'video'` = projected video texture; `'white'` = bright static / emissive look (see alt). */
  appearance: 'video',
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

/**
 * Desktop “alt page” (`/desk-alt`): tune independently of `SIT_IDLE_CHARACTER_DESKTOP`.
 */
export const SIT_IDLE_CHARACTER_DESKTOP_ALT = {
  ...SIT_IDLE_CHARACTER_DESKTOP,
  enabled: true, // false = hide on alt page
  appearance: 'video',
  fbxScale: 8.2,
  wrapperPosition: {
    x: 2.8,
    y: -2.3,
    z: -3.6,
  },
  wrapperRotation: {
    x: Math.PI / 48,
    y: -Math.PI / 10,
    z: Math.PI / 24,
  },
  renderBehindSlides: false,
}

/** Portrait / touch: different model and/or placement; tune `wrapperPosition` / `fbxScale` here. */
export const SIT_IDLE_CHARACTER_MOBILE = {
  enabled: true,
  appearance: 'video',
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
 * @param {'default' | 'alt'} [desktopPageId] — from `resolveDesktopPageId` (desktop only)
 * @returns {SitIdleCharacterConfig}
 */
export function getSitIdleCharacterConfig(profileId, contentPageId = 'default') {
  if (contentPageId === 'alt') return SIT_IDLE_CHARACTER_DESKTOP_ALT
  return SIT_IDLE_CHARACTER_DESKTOP
}
