/**
 * Dev-only: live-edit `textPanel` / `textPanels` on the current front slide.
 * Optional 3D drag/scale via TransformControls — writes `position` (x,y), `zOffset`, `widthRatio`, `aspectRatio`.
 * Loaded only when `import.meta.env.DEV` (see main.js).
 */

import { TransformControls } from 'three/addons/controls/TransformControls.js'
import * as THREE from 'three'
import { setTextPanelVisualEditActive } from './devFlags.js'
import { writeTextPanelOverride } from './devTextPanelStorage.js'

const DEFAULT_NEW_PANEL = {
  enabled: true,
  paragraphs: [{ text: 'New text', align: 'left' }],
  widthRatio: 0.85,
  aspectRatio: 1.4,
  anchor: 'top-left',
  zOffset: 0.35,
  fontSizePx: 28,
  textColor: '#F7F8FA',
  backgroundMode: 'highlight',
  boxColor: '#0D1117',
  boxOpacity: 0.88,
  highlightRadiusPx: 0,
  textureWidthPx: 1536,
  textureDprScale: 1.2,
  stackTextOffsetXRatio: 0,
  stackOpacityFront: 1,
  stackOpacityInitial: 1,
}

/**
 * @param {{
 *   getContext: () => { node: object, card: import('three').Group, pathLabel: string, editorKey: string } | null
 *   refresh: (ctx: { node: object, card: import('three').Group }) => void
 *   getThree: () => {
 *     camera: import('three').Camera
 *     scene: import('three').Scene
 *     renderer: import('three').WebGLRenderer
 *     getInnerSize: () => { innerWidth: number, innerHeight: number }
 *   } | null
 *   getTextPanelStorageKey?: () => string
 * }} options
 */
export function initTextPanelEditor(options) {
  const { getContext, refresh, getThree, getTextPanelStorageKey } = options
  if (typeof document === 'undefined') return

  document.getElementById('text-panel-editor')?.remove()

  const root = document.createElement('div')
  root.id = 'text-panel-editor'
  root.innerHTML = `
    <button type="button" class="text-panel-editor__toggle" title="Text panel editor (dev)">TP</button>
    <div class="text-panel-editor__panel" hidden>
      <div class="text-panel-editor__head">
        <strong>Text panels</strong> <span class="text-panel-editor__badge">dev</span>
        <button type="button" class="text-panel-editor__close" aria-label="Close">×</button>
      </div>
      <p class="text-panel-editor__path"></p>
      <p class="text-panel-editor__hint">Edits the <strong>front</strong> slide. <strong>Apply</strong> updates 3D; <strong>Copy JSON</strong> saves to your JSON file.</p>
      <div class="text-panel-editor__visual">
        <label class="text-panel-editor__vlabel"><input type="checkbox" id="text-panel-editor-visual" /> Visual drag + resize (3D gizmo)</label>
        <div class="text-panel-editor__vrow" id="text-panel-editor-visual-tools" hidden>
          <label>Panel <select id="text-panel-editor-which"></select></label>
          <label>Mode
            <select id="text-panel-editor-mode">
              <option value="translate">move</option>
              <option value="scale">scale</option>
            </select>
          </label>
        </div>
        <p class="text-panel-editor__vinfo" id="text-panel-editor-vinfo" hidden>On mouse release, gizmo changes commit to <code>finalPosition</code> (x, y, z), <code>position</code>, <code>zOffset</code>, <code>widthRatio</code>, <code>aspectRatio</code> (anchor fields are cleared; <code>initialPosition</code> is unchanged). In dev, those updates and <strong>Apply</strong> are saved in <strong>localStorage</strong> for this browser so they survive reload; use <strong>Copy JSON</strong> to put them in your repo file.</p>
      </div>
      <label class="text-panel-editor__label" for="text-panel-editor-ta">textPanels JSON</label>
      <textarea id="text-panel-editor-ta" spellcheck="false"></textarea>
      <div class="text-panel-editor__row">
        <button type="button" class="text-panel-editor__btn" data-action="apply">Apply</button>
        <button type="button" class="text-panel-editor__btn" data-action="reload">Reload</button>
        <button type="button" class="text-panel-editor__btn" data-action="add">+ Panel</button>
        <button type="button" class="text-panel-editor__btn" data-action="copy">Copy JSON</button>
      </div>
      <p class="text-panel-editor__err" hidden></p>
    </div>
  `

  const style = document.createElement('style')
  style.textContent = `
    #text-panel-editor {
      position: fixed; inset: 0;
      font-family: system-ui, sans-serif; font-size: 13px;
      z-index: 2147483647 !important;
      pointer-events: none;
    }
    #text-panel-editor .text-panel-editor__toggle {
      position: fixed; bottom: 12px; right: 12px; width: 40px; height: 40px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.25); background: rgba(15,17,20,0.85); color: #e8eaed;
      cursor: pointer; font-weight: 700; font-size: 12px; letter-spacing: 0.02em; pointer-events: auto;
    }
    #text-panel-editor .text-panel-editor__panel {
      position: fixed; bottom: 60px; right: 12px; width: min(520px, calc(100vw - 24px));
      max-height: min(70vh, 640px); display: flex; flex-direction: column; gap: 8px;
      background: rgba(15,17,20,0.95); color: #e8eaed; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 12px; padding: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      pointer-events: auto;
    }
    #text-panel-editor .text-panel-editor__panel[hidden] {
      display: none !important;
    }
    #text-panel-editor .text-panel-editor__vrow[hidden],
    #text-panel-editor .text-panel-editor__vinfo[hidden],
    #text-panel-editor .text-panel-editor__err[hidden] {
      display: none !important;
    }
    #text-panel-editor .text-panel-editor__head { display: flex; align-items: center; gap: 8px; }
    #text-panel-editor .text-panel-editor__badge { font-size: 10px; text-transform: uppercase; opacity: 0.7; border: 1px solid rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 4px; }
    #text-panel-editor .text-panel-editor__close {
      margin-left: auto; background: transparent; border: 0; color: #e8eaed; font-size: 22px; line-height: 1;
      cursor: pointer; padding: 4px 8px; min-width: 32px; min-height: 32px; pointer-events: auto;
    }
    #text-panel-editor .text-panel-editor__path { font-size: 12px; opacity: 0.9; margin: 0; word-break: break-word; }
    #text-panel-editor .text-panel-editor__hint, #text-panel-editor .text-panel-editor__vlabel, #text-panel-editor .text-panel-editor__vrow, #text-panel-editor .text-panel-editor__vinfo { font-size: 11px; }
    #text-panel-editor .text-panel-editor__hint, #text-panel-editor .text-panel-editor__vinfo { opacity: 0.8; margin: 0; }
    #text-panel-editor .text-panel-editor__vrow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    #text-panel-editor .text-panel-editor__vrow select { margin-left: 4px; background: #0b0d10; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; }
    #text-panel-editor .text-panel-editor__label { font-size: 12px; }
    #text-panel-editor textarea { width: 100%; min-height: 200px; flex: 1; font-family: ui-monospace, monospace; font-size: 11px;
      line-height: 1.4; background: #0b0d10; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 8px; resize: vertical; }
    #text-panel-editor .text-panel-editor__row { display: flex; flex-wrap: wrap; gap: 6px; }
    #text-panel-editor .text-panel-editor__btn { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
    #text-panel-editor .text-panel-editor__btn:hover { background: #30363d; }
    #text-panel-editor .text-panel-editor__err { color: #f85149; font-size: 12px; margin: 0; }
  `

  document.head.appendChild(style)
  document.body.appendChild(root)

  const panelEl = root.querySelector('.text-panel-editor__panel')
  const pathEl = root.querySelector('.text-panel-editor__path')
  const ta = root.querySelector('#text-panel-editor-ta')
  const errEl = root.querySelector('.text-panel-editor__err')
  const btnToggle = root.querySelector('.text-panel-editor__toggle')
  const btnClose = root.querySelector('.text-panel-editor__close')
  const visCb = root.querySelector('#text-panel-editor-visual')
  const visTools = root.querySelector('#text-panel-editor-visual-tools')
  const vinfo = root.querySelector('#text-panel-editor-vinfo')
  const whichSel = root.querySelector('#text-panel-editor-which')
  const modeSel = root.querySelector('#text-panel-editor-mode')

  const pickRaycaster = new THREE.Raycaster()
  const pickNdc = new THREE.Vector2()

  let visualOn = false
  let transformControls = null
  /** @type {import('three').Object3D | null} */
  let transformHelper = null
  let lastEditorKey = null
  let dragStartSnapshot = null
  const transformUndoStack = []
  const transformRedoStack = []
  const TRANSFORM_HISTORY_LIMIT = 100

  function getPanelsArray(node) {
    if (Array.isArray(node.textPanels) && node.textPanels.length) return node.textPanels
    if (node.textPanel) return [node.textPanel]
    return []
  }

  function setPanelsOnNode(node, arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      delete node.textPanels
      delete node.textPanel
      return
    }
    node.textPanels = arr
    delete node.textPanel
  }

  function getPanelsJsonFromNode(node) {
    return getPanelsArray(node)
  }

  function clonePanelsArray(arr) {
    if (!Array.isArray(arr)) return []
    try {
      return JSON.parse(JSON.stringify(arr))
    } catch (_) {
      return arr.map((p) => (p && typeof p === 'object' ? { ...p } : {}))
    }
  }

  function snapshotCurrentPanels(ctx) {
    return clonePanelsArray(getPanelsArray(ctx.node))
  }

  function samePanelsSnapshot(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function clearTransformHistory() {
    transformUndoStack.length = 0
    transformRedoStack.length = 0
    dragStartSnapshot = null
  }

  function persistTextPanelsToDevStorage() {
    if (typeof getTextPanelStorageKey !== 'function') return
    const ctx = getContext()
    if (!ctx) return
    const key = getTextPanelStorageKey()
    if (!key) return
    writeTextPanelOverride(key, getPanelsArray(ctx.node))
  }

  function pushTransformHistory(before, after) {
    if (!before || !after || samePanelsSnapshot(before, after)) return
    transformUndoStack.push({ before: clonePanelsArray(before), after: clonePanelsArray(after) })
    if (transformUndoStack.length > TRANSFORM_HISTORY_LIMIT) transformUndoStack.shift()
    transformRedoStack.length = 0
  }

  function applyPanelsSnapshotFromHistory(snapshot) {
    const ctx = getContext()
    if (!ctx) return false
    setPanelsOnNode(ctx.node, clonePanelsArray(snapshot))
    ta.value = JSON.stringify(ctx.node.textPanels, null, 2)
    refresh({ node: ctx.node, card: ctx.card })
    setupWhichOptions(ctx)
    reattachGizmo()
    showErr('')
    persistTextPanelsToDevStorage()
    return true
  }

  function undoTransformEdit() {
    if (!visualOn || panelEl.hidden) return
    const item = transformUndoStack.pop()
    if (!item) return
    const ok = applyPanelsSnapshotFromHistory(item.before)
    if (!ok) return
    transformRedoStack.push(item)
  }

  function redoTransformEdit() {
    if (!visualOn || panelEl.hidden) return
    const item = transformRedoStack.pop()
    if (!item) return
    const ok = applyPanelsSnapshotFromHistory(item.after)
    if (!ok) return
    transformUndoStack.push(item)
  }

  function listTextPanelMeshes(card) {
    if (!card) return []
    const out = []
    card.traverse((c) => {
      if (c.isMesh && c.userData?.slideTextPanel) out.push(c)
    })
    return out.sort(
      (a, b) => (a.userData.textPanelIndex ?? 0) - (b.userData.textPanelIndex ?? 0)
    )
  }

  function disposeTransformControls() {
    if (transformControls) {
      const t = getThree?.() ?? null
      if (t?.scene && transformHelper) t.scene.remove(transformHelper)
      transformHelper = null
      try {
        transformControls.detach()
      } catch (_) {}
      if (typeof transformControls.dispose === 'function') transformControls.dispose()
      transformControls = null
    }
  }

  function applyPlaneGizmoMode() {
    if (!transformControls) return
    const mode = modeSel.value === 'scale' ? 'scale' : 'translate'
    transformControls.setMode(mode)
    transformControls.setSpace('local')
    transformControls.setSize(2.4)
    // Card-local: X/Y in-plane, Z along the card normal; depth is stored as `zOffset` on commit.
    transformControls.showX = true
    transformControls.showY = true
    transformControls.showZ = true
  }

  function clearAnchorFieldsForLayout(panel) {
    if (!panel || typeof panel !== 'object') return
    delete panel.anchor
    delete panel.offsetXRatio
    delete panel.offsetYRatio
    delete panel.marginXRatio
    delete panel.marginYRatio
  }

  function setupWhichOptions(ctx) {
    if (!ctx?.card) return
    const meshes = listTextPanelMeshes(ctx.card)
    const prev = whichSel.value
    whichSel.innerHTML = ''
    if (meshes.length === 0) return
    meshes.forEach((_, i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = `Panel ${i + 1}`
      whichSel.appendChild(o)
    })
    if (meshes.length) {
      whichSel.value =
        prev && parseInt(prev, 10) < meshes.length ? prev : '0'
    }
  }

  function commitFromTransforms() {
    const ctx = getContext()
    if (!ctx) return
    const t = getThree()
    if (!t?.getInnerSize) return
    const { innerWidth } = t.getInnerSize()
    if (innerWidth < 1e-6) return
    const meshes = listTextPanelMeshes(ctx.card)
    const arr = getPanelsArray(ctx.node).map((p) =>
      p && typeof p === 'object' ? { ...p } : {}
    )
    for (let i = 0; i < Math.min(meshes.length, arr.length); i++) {
      const mesh = meshes[i]
      const p = arr[i]
      const gw = mesh.geometry?.parameters?.width
      const gh = mesh.geometry?.parameters?.height
      if (gw == null || gh == null) continue
      const w = Math.max(1e-6, gw * mesh.scale.x)
      const h = Math.max(1e-6, gh * mesh.scale.y)
      const px = mesh.position.x
      const py = mesh.position.y
      const pz = mesh.position.z
      p.position = { x: px, y: py }
      p.zOffset = pz
      p.finalPosition = { x: px, y: py, z: pz }
      p.widthRatio = THREE.MathUtils.clamp(w / innerWidth, 0.1, 3)
      p.aspectRatio = w / h
      clearAnchorFieldsForLayout(p)
    }
    setPanelsOnNode(ctx.node, arr)
    ta.value = JSON.stringify(ctx.node.textPanels, null, 2)
    persistTextPanelsToDevStorage()
  }

  function reattachGizmo() {
    if (!transformControls || !visualOn) return
    const ctx = getContext()
    if (!ctx) return
    const meshes = listTextPanelMeshes(ctx.card)
    if (!meshes.length) return
    const idx = Math.min(
      whichSel.value ? parseInt(whichSel.value, 10) : 0,
      Math.max(0, meshes.length - 1)
    )
    const mesh = meshes[idx]
    if (mesh) transformControls.attach(mesh)
  }

  function onDraggingChanged(ev) {
    if (ev.value) {
      const ctx = getContext()
      dragStartSnapshot = ctx ? snapshotCurrentPanels(ctx) : null
      return
    }
    const ctx = getContext()
    if (!ctx || !visualOn) return
    try {
      commitFromTransforms()
      const after = snapshotCurrentPanels(ctx)
      pushTransformHistory(dragStartSnapshot, after)
      dragStartSnapshot = null
      showErr('')
      refresh({ node: ctx.node, card: ctx.card })
      reattachGizmo()
    } catch (e) {
      dragStartSnapshot = null
      showErr(e?.message || String(e))
    }
  }

  function setVisual(on) {
    visualOn = on
    setTextPanelVisualEditActive(on)
    visTools.hidden = !on
    vinfo.hidden = !on
    if (!on) {
      dragStartSnapshot = null
      if (transformControls) {
        transformControls.removeEventListener('dragging-changed', onDraggingChanged)
        disposeTransformControls()
      }
      return
    }
    const t = getThree()
    if (!t?.scene || !t?.camera) {
      setTextPanelVisualEditActive(false)
      return
    }
    if (!transformControls) {
      transformControls = new TransformControls(t.camera, t.renderer.domElement)
      transformHelper = transformControls.getHelper()
      t.scene.add(transformHelper)
    }
    transformControls.removeEventListener('dragging-changed', onDraggingChanged)
    transformControls.addEventListener('dragging-changed', onDraggingChanged)
    const ctx = getContext()
    setupWhichOptions(ctx)
    applyPlaneGizmoMode()
    reattachGizmo()
  }

  function onCanvasPointerDownForSelect(e) {
    if (!visualOn || e.button !== 0) return
    const t = getThree()
    if (!t?.camera || !transformHelper) return
    const ctx = getContext()
    if (!ctx?.card) return
    const meshes = listTextPanelMeshes(ctx.card)
    if (meshes.length === 0) return

    const el = t.renderer.domElement
    const rect = el.getBoundingClientRect()
    pickNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pickNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    pickRaycaster.setFromCamera(pickNdc, t.camera)
    const gHits = pickRaycaster.intersectObject(transformHelper, true)
    const pHits = pickRaycaster.intersectObjects(meshes, true)
    const g0 = gHits[0]
    const p0 = pHits[0]
    if (g0 && (!p0 || g0.distance < p0.distance)) return
    if (!p0 || !p0.object.userData?.slideTextPanel) return
    const i = p0.object.userData.textPanelIndex
    if (i == null) return
    whichSel.value = String(i)
    reattachGizmo()
  }

  function showErr(msg) {
    if (!msg) {
      errEl.hidden = true
      errEl.textContent = ''
      return
    }
    errEl.hidden = false
    errEl.textContent = msg
  }

  function loadFromContext() {
    const ctx = getContext()
    if (!ctx) {
      pathEl.textContent = 'No slide in context'
      ta.value = ''
      showErr('')
      clearTransformHistory()
      return
    }
    lastEditorKey = ctx.editorKey
    pathEl.textContent = ctx.pathLabel
    ta.value = JSON.stringify(getPanelsJsonFromNode(ctx.node), null, 2)
    showErr('')
    clearTransformHistory()
  }

  function apply() {
    const ctx = getContext()
    if (!ctx) {
      showErr('No slide in context')
      return
    }
    let parsed
    try {
      parsed = JSON.parse(ta.value)
    } catch (e) {
      showErr(`JSON parse: ${e.message || e}`)
      return
    }
    if (!Array.isArray(parsed)) {
      showErr('Root JSON must be an array of text panel objects (use [ { … } ]).')
      return
    }
    setPanelsOnNode(ctx.node, parsed)
    showErr('')
    clearTransformHistory()
    try {
      refresh({ node: ctx.node, card: ctx.card })
      persistTextPanelsToDevStorage()
    } catch (e) {
      showErr(`Refresh failed: ${e.message || e}`)
    }
  }

  function addPanel() {
    const ctx = getContext()
    if (!ctx) return
    let ar
    try {
      ar = JSON.parse(ta.value)
    } catch (_) {
      ar = getPanelsArray(ctx.node)
    }
    if (!Array.isArray(ar)) ar = []
    ar.push({ ...DEFAULT_NEW_PANEL })
    setPanelsOnNode(ctx.node, ar)
    ta.value = JSON.stringify(ar, null, 2)
    clearTransformHistory()
  }

  function copy() {
    ta.select()
    navigator.clipboard.writeText(ta.value).catch(() => {})
  }

  let selectCanvas = null
  const bindTextPanelSelectCanvas = () => {
    const t = getThree()
    if (!t?.renderer?.domElement) return
    if (selectCanvas === t.renderer.domElement) return
    if (selectCanvas) {
      selectCanvas.removeEventListener('pointerdown', onCanvasPointerDownForSelect, true)
    }
    selectCanvas = t.renderer.domElement
    selectCanvas.addEventListener('pointerdown', onCanvasPointerDownForSelect, true)
  }

  visCb.addEventListener('change', () => {
    if (visCb.checked) {
      const ctx = getContext()
      const t = getThree()
      if (!t || !ctx?.card) {
        visCb.checked = false
        showErr('3D or slide not available — use a text slide first.')
        return
      }
      if (listTextPanelMeshes(ctx.card).length === 0) {
        visCb.checked = false
        showErr('This slide has no text panels. Add JSON or use + Panel.')
        return
      }
      setVisual(true)
      bindTextPanelSelectCanvas()
    } else {
      setVisual(false)
    }
  })
  whichSel.addEventListener('change', reattachGizmo)
  modeSel.addEventListener('change', () => {
    if (!transformControls || !visualOn) return
    applyPlaneGizmoMode()
  })

  const isTypingTarget = (target) => {
    if (!target) return false
    if (target === ta) return true
    if (target.isContentEditable) return true
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (panelEl.hidden || !visualOn) return
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.altKey) return
      if (String(e.key).toLowerCase() !== 'z') return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      if (e.shiftKey) redoTransformEdit()
      else undoTransformEdit()
    },
    true
  )

  bindTextPanelSelectCanvas()

  function setPanelOpen(open) {
    panelEl.hidden = !open
    if (open) {
      panelEl.style.removeProperty('display')
      loadFromContext()
    } else {
      panelEl.style.display = 'none'
      setVisual(false)
      visCb.checked = false
    }
  }

  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation()
    setPanelOpen(panelEl.hidden)
  })
  btnClose.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    setPanelOpen(false)
  })

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.getAttribute('data-action')
    if (action === 'apply') apply()
    if (action === 'reload') loadFromContext()
    if (action === 'add') {
      addPanel()
      showErr('')
    }
    if (action === 'copy') copy()
  })

  setInterval(() => {
    if (panelEl.hidden) return
    const ctx = getContext()
    if (!ctx) return
    if (ctx.editorKey === lastEditorKey) return
    setVisual(false)
    visCb.checked = false
    lastEditorKey = null
    loadFromContext()
  }, 300)
}
