const STORAGE_NS = 'dev:textPanels:v1'

/**
 * @param {string} layoutId
 * @param {string} pageId
 * @param {Array<{ group: object[], parentIndex: number | null }>} path
 * @param {number} currentIndex
 */
export function buildTextPanelStorageKey(layoutId, pageId, path, currentIndex) {
  const parts = []
  for (let i = 1; i < path.length; i++) {
    const pi = path[i].parentIndex
    if (pi != null) parts.push(String(pi))
  }
  parts.push(String(currentIndex))
  return `${STORAGE_NS}|${layoutId}|${pageId}|${parts.join('.')}`
}

/**
 * @param {string} layoutId
 * @param {string} pageId
 * @param {number[]} indexPath indices from root group, e.g. [2, 0] for first slide under root[2]
 */
function keyForTreePath(layoutId, pageId, indexPath) {
  return `${STORAGE_NS}|${layoutId}|${pageId}|${indexPath.join('.')}`
}

/**
 * @param {string} key
 * @returns {object[] | undefined} undefined = no override stored
 */
export function readTextPanelOverride(key) {
  try {
    if (typeof localStorage === 'undefined') return undefined
    const raw = localStorage.getItem(key)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {string} key
 * @param {object[] | null | undefined} panels
 */
export function writeTextPanelOverride(key, panels) {
  try {
    if (typeof localStorage === 'undefined') return
    if (panels == null) {
      localStorage.removeItem(key)
      return
    }
    if (Array.isArray(panels) && panels.length === 0) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify(panels))
  } catch (e) {
    console.warn('dev text panel storage: write failed', e)
  }
}

/**
 * Recursively walk slide tree; apply localStorage overrides so reload keeps dev TP edits.
 * @param {object[]} group
 * @param {string} layoutId
 * @param {string} pageId
 * @param {number[]} [prefix]
 */
export function applyTextPanelOverridesToSlideTree(group, layoutId, pageId, prefix = []) {
  if (!Array.isArray(group) || typeof localStorage === 'undefined') return
  for (let i = 0; i < group.length; i++) {
    const node = group[i]
    const indexPath = prefix.concat(i)
    const key = keyForTreePath(layoutId, pageId, indexPath)
    const over = readTextPanelOverride(key)
    if (over !== undefined) {
      if (over.length > 0) {
        // Merge disk (imported JSON) with dev storage so new keys in the file (e.g. stackOpacity*) apply
        // when localStorage still has an older copy of the same panel.
        const fromDisk = Array.isArray(node.textPanels) ? node.textPanels : node.textPanel ? [node.textPanel] : []
        node.textPanels = over.map((p, i) => {
          if (!p || typeof p !== 'object') return {}
          const base = fromDisk[i] && typeof fromDisk[i] === 'object' ? fromDisk[i] : {}
          return { ...base, ...p }
        })
        delete node.textPanel
      } else {
        delete node.textPanels
        delete node.textPanel
      }
    }
    const ch = node?.children
    if (Array.isArray(ch) && ch.length) {
      applyTextPanelOverridesToSlideTree(ch, layoutId, pageId, indexPath)
    }
  }
}
