/**
 * Screen-space text: **viewport-fixed** (`position: fixed`), independent of the Three.js camera/resolution.
 *
 * **Position**
 * - `dock: 'top-right'` — row along the top, flush right (safe-area aware). Gaps/padding are **fixed px**
 *   via `style.css` (`--ui-dock-*`). Ignored for that item if you set any of **`left` / `top` / `right` / `bottom`**
 *   (those use absolute positioning vs the viewport instead).
 * - Or omit `dock` and set `left` / `top` / `right` / `bottom` in **px** (or any CSS) vs the viewport.
 *
 * **Fixed size:** default text size is **`VIEWPORT_UI_TEXT_PX` in `main.js`** (`--ui-fixed-text-px` on `#app`).
 * Optional per-item **`fontSize`** (number = px or CSS string) overrides. Header width uses the same pattern.
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

const topOffset = 'max(68px, env(safe-area-inset-top))'; 

export const TEXT_OVERLAYS = [

  {
    text: 'linkedin',
    fontSize: '20px',
    dock: 'top-right',
    right: '893px',
    top: topOffset,
    fontWeight: 500,
    tracking: '-0.04em',
    href: 'https://example.com',
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
 * @param {{ viewportTextPx?: number }} [options] — if set, default `font-size` is applied as px with `!important` (Safari-stable).
 */
export function mountTextOverlays(appRoot, options = {}) {
  const { viewportTextPx } = options
  ensureTextOverlayFont()
  if (TEXT_OVERLAYS.length === 0) return

  const root = document.createElement('div')
  root.id = 'text-overlays'
  root.className = 'text-overlays-root'

  /** @type {HTMLDivElement | null} */
  let topRightDock = null

  for (const item of TEXT_OVERLAYS) {
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
