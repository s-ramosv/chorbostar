/**
 * Screen-space text: **viewport-fixed** (`position: fixed`), independent of the Three.js camera/resolution.
 *
 * **Position**
 * - **`top` / `right` / `left` / `bottom`** — any CSS length, inset from the **viewport** (via `.text-overlays-root`).
 *   `top` = distance from top border; `right` = distance from right border (same as normal CSS `position: fixed` insets).
 *   Use `max(12px, env(safe-area-inset-*))` on phones with notches. Set **both** `top` and `right` (or other pairs) so layout is unambiguous.
 * - `dock: 'top-right'` — flex row in the dock; only used if you do **not** set any of `left`/`top`/`right`/`bottom`.
 *   Spacing from `style.css` (`--ui-dock-*`) and `layoutProfile.textUi`.
 *
 * **Fixed size:** default text size is **`--ui-fixed-text-px` on `#app`** from `main.js` (desktop: `VIEWPORT_UI_TEXT_PX`; mobile: `layoutProfile.textUi.fontSize` for viewport-relative `clamp` / `vmin`).
 * Optional per-item **`fontSize`** overrides the variable for that item only.
 *
 * Other fields: `text`, `fontSize`, `tracking`, `transform`, `color`, `href`, `download`, `id`, `maxWidth`,
 * `fontWeight` — same as before.
 */

/** Path under `public/` (no leading slash), e.g. `download/resume.pdf`. Respects Vite `base` / Netlify deploy. */
export function publicAsset(pathFromPublic) {
  const base = import.meta.env.BASE_URL || '/'
  const p = pathFromPublic.replace(/^\//, '')
  return `${base}${p}`
}

const topOffset = 'max(68px, env(safe-area-inset-top))'

/** Wide-viewport layout with pixel-anchored insets (header graphic alignment). */
export const TEXT_OVERLAYS_DESKTOP = [
  {
    text: 'linkedin',
    fontSize: '20px',
    dock: 'top-right',
    right: '893px',
    top: topOffset,
    fontWeight: 500,
    tracking: '-0.04em',
    href: 'https://www.linkedin.com/in/samu-rv/',
  },
  {
    text: 'cv',
    fontSize: '20px',
    right: '810px',
    top: topOffset,
    fontWeight: 500,
    tracking: '-0.04em',
    href: publicAsset('download/SamuelRV-CV-240326.pdf'),
    download: 'Samuel-Ramos-Varela-CV.pdf',
  },
  {
    text: 'samuel ramos varela',
    dock: 'top-right',
    top: topOffset,
    right: '20px',
    fontSize: '20px',
    fontWeight: 500,
    tracking: '-0.04em',
  },
]

/**
 * Mobile: each line is positioned independently — edit **`top`** and **`right`** per item (CSS strings).
 * Smaller `right` = closer to the right edge; larger `right` = further left. Share one `MOBILE_TEXT_TOP` or set `top` per item.
 * Font size still comes from `layoutProfile.textUi.fontSize` unless you add `fontSize` here.
 */
const MOBILE_TEXT_TOP = 'calc(env(safe-area-inset-top) + clamp(60px, 12vmin, 70px))'

export const TEXT_OVERLAYS_MOBILE = [
  {
    text: 'samuel ramos varela',
    top: MOBILE_TEXT_TOP,
    right: 'max(10px, env(safe-area-inset-right))',
    fontWeight: 500,
    tracking: '-0.04em',
  },
  {
    text: 'linkedin',
    top: MOBILE_TEXT_TOP,
    left: 'calc(clamp(10px, 15vmin, 98px))',
    fontWeight: 500,
    tracking: '-0.04em',
    href: 'https://www.linkedin.com/in/samu-rv/',
  },
  {
    text: 'cv',
    top: MOBILE_TEXT_TOP,
    right: 'max(240px, env(safe-area-inset-right))',
    fontWeight: 500,
    tracking: '-0.04em',
    href: publicAsset('download/SamuelRV-CV-240326.pdf'),
    download: 'Samuel-Ramos-Varela-CV.pdf',
  },
]

/** @deprecated Use TEXT_OVERLAYS_DESKTOP or pass `overlays` to mountTextOverlays */
export const TEXT_OVERLAYS = TEXT_OVERLAYS_DESKTOP

/** Matches `public/assets/fonts/apple-font.ttf` (SF Pro variable). */
const FONT_FAMILY = 'SF Pro'

/**
 * Optional extra `@font-face` rules (e.g. **SF Compact** under another name, or italic).
 */
export const FONT_FACE_EXTRA_CSS = ''

function ensureTextOverlayFont() {
  if (document.getElementById('text-overlay-font-face')) return
  const base = import.meta.env.BASE_URL || '/'
  const url = `${base}assets/fonts/apple-font.ttf`
  const style = document.createElement('style')
  style.id = 'text-overlay-font-face'
  const primary = `@font-face{font-family:'${FONT_FAMILY}';src:url('${url}') format('truetype') tech('variations'),url('${url}') format('truetype');font-weight:100 900;font-style:normal;font-display:swap;}`
  style.textContent = primary + (FONT_FACE_EXTRA_CSS || '')
  document.head.appendChild(style)
}

/**
 * @param {HTMLElement} appRoot — `#app`
 * @param {{ viewportTextPx?: number, overlays?: typeof TEXT_OVERLAYS_DESKTOP }} [options] — `overlays` defaults to desktop list.
 */
export function mountTextOverlays(appRoot, options = {}) {
  const { viewportTextPx, overlays = TEXT_OVERLAYS_DESKTOP } = options
  ensureTextOverlayFont()
  if (!overlays || overlays.length === 0) return

  const root = document.createElement('div')
  root.id = 'text-overlays'
  root.className = 'text-overlays-root'

  /** @type {HTMLDivElement | null} */
  let topRightDock = null

  for (const item of overlays) {
    const tag = item.href ? 'a' : 'span'
    const el = document.createElement(tag)
    el.className = item.href ? 'text-overlay text-overlay--link' : 'text-overlay text-overlay--static'
    el.textContent = item.text

    const track = typeof item.tracking === 'number' ? `${item.tracking}px` : item.tracking
    el.style.letterSpacing = track
    if (item.fontSize != null) {
      el.style.fontSize = typeof item.fontSize === 'number' ? `${item.fontSize}px` : item.fontSize
    }
    el.style.fontWeight = item.fontWeight != null ? String(item.fontWeight) : '400'
    el.style.color = item.color ?? '#000000'

    const hasExplicitInset =
      item.left != null || item.right != null || item.top != null || item.bottom != null
    const useDock = item.dock === 'top-right' && !hasExplicitInset
    if (useDock) {
      if (!topRightDock) {
        topRightDock = document.createElement('div')
        topRightDock.className = 'text-overlays-dock text-overlays-dock--top-right'
        root.appendChild(topRightDock)
      }
    } else {
      if (item.left != null) el.style.left = item.left
      else if (item.right != null) el.style.left = 'auto'
      else el.style.left = '0'
      if (item.right != null) el.style.right = item.right

      if (item.top != null) el.style.top = item.top
      else if (item.bottom != null) el.style.top = 'auto'
      else el.style.top = '0'
      if (item.bottom != null) el.style.bottom = item.bottom
    }

    if (item.transform != null) el.style.transform = item.transform
    if (item.maxWidth != null) el.style.maxWidth = item.maxWidth
    if (item.id) el.id = item.id

    if (item.href) {
      el.href = item.href
      const wantsDownload = item.download !== undefined && item.download !== false
      if (wantsDownload) {
        el.download = item.download === true ? '' : String(item.download)
        el.target = '_self'
      } else {
        el.target = '_blank'
        el.rel = 'noopener noreferrer'
      }
    }

    if (useDock) topRightDock.appendChild(el)
    else root.appendChild(el)
  }

  appRoot.appendChild(root)
}

export { FONT_FAMILY as TEXT_OVERLAY_FONT_FAMILY }
