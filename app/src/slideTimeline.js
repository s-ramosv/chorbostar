import * as THREE from 'three'

/**
 * Constellation-style timeline: one anchor per slide. Layout uses **`position`** in **card local
 * space** (origin = card center, Y+ = up the card) — one place for node + connector + playhead
 * base. **`labelOffset`** is the same (offset from the anchor; negative Y = below the anchor on the
 * card). Legacy `anchorOffsetX` / `yOffset`–style fields still work if `position` is omitted.
 * The connector is a fixed chain along the **stack only** — from the **front** card (`currentIndex`)
 * to the **last** slide: edges `(currentIndex, currentIndex+1) … (n-2, n-1)` — never from vanish
 * into the front. During a stack nav tween, a **nav** tube grows on that chord and the playhead
 * follows it; the **rest** of the stack (edges from `targetIndex` onward) stays drawn using
 * `targetIndex` as the left end, and the one stack edge that would duplicate the nav chord is
 * hidden. When idle, the playhead uses the stack chain as before.
 *
 * The connector is built from thin `CylinderGeometry` segments (not gl.LINES), so it has real
 * screen thickness and can participate in depth with the rest of the scene. `lineDepthPull` nudges
 * the connector slightly toward the camera so it is not fully hidden under card quads (which use
 * depthWrite: false and often draw on top in sort order). High `renderOrder` still draws the
 * timeline after the main slide stack in the same scene.
 */
export const DEFAULT_SLIDE_TIMELINE = {
  enabled: true,
  followSlides: true,
  yOffset: 0.45,
  zBias: 0,
  /**
   * Card local space: origin = card center, +Y = up. Sets where nodes, line, and playhead attach.
   * Omitted fields fall back to a point near the bottom edge (see `resolveTimelineAnchorPosition`).
   * Replaces `anchorOffsetX` / `anchorOffsetYFromBottom` / `anchorLocalZ` when set.
   */
  position: null,
  /**
   * Card local offset from the anchor to each date label (negative Y = “below” the node on the card).
   * Replaces `labelOffsetY` when set.
   */
  labelOffset: null,
  nodeRadius: 0.052,
  /**
   * Optional: per-node ring scale (world units, same basis as `nodeRadius`).
   * Index `i` missing → use `nodeRadius`.
   */
  nodeRadii: null,
  nodeRingInner: 0.4,
  nodeRingOuter: 1,
  nodeColor: '#94a3b8',
  /**
   * Optional: per-index stroke/fill for “present and past” nodes. Index missing → `nodeColor`.
   */
  nodeColors: null,
  futureNodeColor: '#64748b',
  /** Optional: per-index “future” nodes. Index missing → `futureNodeColor`. */
  futureNodeColors: null,
  lineColor: '#38bdf8',
  lineOpacity: 0.88,
  /** World units — tube radius of the visible connector (1px `THREE.Line` is not reliable). */
  lineRadius: 0.012,
  /**
   * World units: push each connector vertex along (camera − point) so the tube sits a hair in
   * front in depth and is not z‑occluded by large transparent card planes.
   */
  lineDepthPull: 0.03,
  /** Renders with the same scene depth test; use > slide cards (0–2) to draw on top of the stack. */
  lineRenderOrder: 8,
  lineWidthWorld: 0,
  lineWidthPx: 2.5,
  /** Ignored for filled playhead; kept for JSON compatibility. */
  playheadInner: 0.5,
  /** Multiplier on `playheadRadius` for the moving disc’s radius. */
  playheadOuter: 1,
  playheadRadius: 0.06,
  playheadColor: '#f8fafc',
  futureNodeOpacity: 0.28,
  presentNodeOpacity: 1,
  labelFontPx: 28,
  /** CSS color string for date labels, e.g. `"#e2e8f0"`, `"rgb(200,200,200)"` */
  labelColor: '#e2e8f0',
  /** 100–900, or e.g. `"semibold"`. */
  labelFontWeight: 400,
  labelFontFamily: 'system-ui, sans-serif',
  labelScale: 1,
  /** @deprecated Prefer `labelOffset: { y }` in card local space. */
  labelOffsetY: 0.11,
  /** @deprecated Use `position.x` */
  anchorOffsetX: 0,
  /** @deprecated Use `position.y` (center-relative) instead of from-bottom */
  anchorOffsetYFromBottom: 0.04,
  /** @deprecated Use `position.z` */
  anchorLocalZ: 0.04,
  labels: null,
}

export function resolveSlideTimelineConfig(raw) {
  if (raw == null) return null
  if (raw === false) return 'disabled'
  if (raw === true) return { ...DEFAULT_SLIDE_TIMELINE }
  if (typeof raw === 'object' && raw.enabled === false) return 'disabled'
  if (typeof raw === 'object') {
    const o = { ...DEFAULT_SLIDE_TIMELINE, ...raw }
    if (raw.position && typeof raw.position === 'object') o.position = { ...raw.position }
    if (raw.labelOffset && typeof raw.labelOffset === 'object') o.labelOffset = { ...raw.labelOffset }
    if (Array.isArray(raw.nodeColors)) o.nodeColors = raw.nodeColors.slice()
    if (Array.isArray(raw.futureNodeColors)) o.futureNodeColors = raw.futureNodeColors.slice()
    if (Array.isArray(raw.nodeRadii)) o.nodeRadii = raw.nodeRadii.map(Number)
    return o
  }
  return null
}

/**
 * @param {any} c
 * @param {number} cardHeight world units; card is centered, half-height = cardHeight/2
 * @returns {{ x: number, y: number, z: number }}
 */
export function resolveTimelineAnchorPosition(c, cardHeight) {
  const half = cardHeight * 0.5
  const p = c.position
  if (p && typeof p === 'object') {
    return {
      x: p.x != null && !Number.isNaN(Number(p.x)) ? Number(p.x) : 0,
      y:
        p.y != null && !Number.isNaN(Number(p.y))
          ? Number(p.y)
          : -half + (c.anchorOffsetYFromBottom ?? 0.04),
      z: p.z != null && !Number.isNaN(Number(p.z)) ? Number(p.z) : 0.04,
    }
  }
  return {
    x: c.anchorOffsetX ?? 0,
    y: -half + (c.anchorOffsetYFromBottom ?? 0.04),
    z: c.anchorLocalZ ?? 0.04,
  }
}

/**
 * Card-local offset from anchor to each label. Negative Y places the label below the node (card up).
 * @param {any} c
 * @returns {{ x: number, y: number, z: number }}
 */
function resolveTimelineLabelOffset(c) {
  const lo = c.labelOffset
  if (lo && typeof lo === 'object') {
    const defY = c.labelOffsetY != null ? -Number(c.labelOffsetY) : -0.11
    return {
      x: lo.x != null && !Number.isNaN(Number(lo.x)) ? Number(lo.x) : 0,
      y: lo.y != null && !Number.isNaN(Number(lo.y)) ? Number(lo.y) : defY,
      z: lo.z != null && !Number.isNaN(Number(lo.z)) ? Number(lo.z) : 0,
    }
  }
  if (c.labelOffsetY != null) {
    return { x: 0, y: -Number(c.labelOffsetY), z: 0 }
  }
  return { x: 0, y: -0.11, z: 0 }
}

function buildColinearTimelinePoints(n, slotPositions, yOff, zBias) {
  if (n <= 0 || !slotPositions?.length) return []
  const yBase = (slotPositions[0].y ?? 0) - yOff
  const zSum = slotPositions.reduce((s, p) => s + p.z, 0)
  const zBase = zSum / n + zBias
  const xs = slotPositions.map((s) => s.x)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const pts = []
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1)
    pts.push(new THREE.Vector3(xMin + (xMax - xMin) * u, yBase, zBase))
  }
  return pts
}

function positionOnPolyline(points, t, target = new THREE.Vector3()) {
  if (points.length === 0) return target.set(0, 0, 0)
  if (points.length === 1) return target.copy(points[0])
  const maxT = points.length - 1
  const tC = THREE.MathUtils.clamp(t, 0, maxT)
  const i = Math.min(Math.floor(tC), points.length - 2)
  const f = tC - i
  return target.lerpVectors(points[i], points[i + 1], f)
}

/**
 * `gltfSlideIndex` along the stack only: waypoints `points[front] … points[n-1]`.
 * Parameter in chain space: `gltfSlideIndex - front` in `[0, m-1]`, m = n − front. At `gltf ===
 * front` the playhead is at the **front** node; increasing `gltf` moves toward the last slide.
 * Never uses indices below `front`, so the ring never runs on a vanish→front path.
 * @param {THREE.Vector3[]} points
 * @param {import('three').Vector3} target
 */
function positionOnStackChain(points, n, gltfSlideIndex, front, target) {
  const m = n - front
  if (m < 1) return target.set(0, 0, 0)
  if (m === 1) return target.copy(points[front] ?? target.set(0, 0, 0))
  const tC = THREE.MathUtils.clamp(gltfSlideIndex - front, 0, m - 1)
  const j = Math.min(Math.floor(tC), m - 2)
  const f = tC - j
  return target.lerpVectors(
    points[front + j],
    points[front + j + 1],
    f
  )
}

/** Skips zero-length edge when two anchors coincide (e.g. vanish pile). */
const VERT_DEDUPE_EPS = 1e-3
/** Fade nav chord in the last part of the tween (forward only) so it does not “pop” off onComplete. */
const NAV_CHORD_FADE_END = 0.12
/** Min drawn cylinder length while a nav tween is active (avoids vanishing mid-anim). */
const STACK_SEG_LEN_FLOOR = 1e-4

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const _pullDir = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _aP = new THREE.Vector3()
const _bP = new THREE.Vector3()
const _midS = new THREE.Vector3()
const _dirS = new THREE.Vector3()

function pullPointToCamera(p, camera, d, out) {
  out.copy(p)
  if (d > 0) {
    _pullDir.subVectors(camera.position, out).normalize().multiplyScalar(d)
    out.add(_pullDir)
  }
  return out
}

const ANCHOR_NAME = 'slide-timeline-anchor'

function clearAnchorsOnCards(cards) {
  if (!cards) return
  for (const card of cards) {
    if (!card) continue
    const a = card.getObjectByName(ANCHOR_NAME)
    if (a) a.removeFromParent()
  }
}

function makeLabelSprite(text, config) {
  if (text == null) return null
  const s = String(text)
  if (!s.trim()) return null
  const fontPx = Math.max(8, Number(config.labelFontPx) || 28)
  const lineGap = 1.15
  const lineH = fontPx * lineGap
  const fontW = config.labelFontWeight ?? 400
  const fontFamily = String(config.labelFontFamily || 'system-ui, sans-serif')
  const fontCss = `${fontW} ${fontPx}px ${fontFamily}`
  const lines = s.split(/\r\n|\n|\r/)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const pad = 16
  ctx.font = fontCss
  let maxW = 0
  for (const line of lines) {
    maxW = Math.max(maxW, ctx.measureText(line).width)
  }
  const w = Math.ceil(maxW) + pad * 2
  const h = Math.max(Math.ceil(lineH * lines.length), fontPx) + pad * 2
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? Math.min(2, window.devicePixelRatio) : 1
  const cw = Math.ceil(w * dpr)
  const ch = Math.ceil(h * dpr)
  canvas.width = cw
  canvas.height = ch
  const ctx2 = canvas.getContext('2d')
  if (!ctx2) return null
  if (dpr !== 1) {
    ctx2.scale(dpr, dpr)
  }
  ctx2.font = fontCss
  ctx2.textAlign = 'center'
  ctx2.textBaseline = 'top'
  const c = new THREE.Color()
  try {
    c.setStyle(String(config.labelColor ?? '#e2e8f0'))
  } catch {
    c.set('#e2e8f0')
  }
  ctx2.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
  const cx = w / 2
  let y = pad
  for (const line of lines) {
    ctx2.fillText(line, cx, y)
    y += lineH
  }
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  const base = 0.55 * (config.labelScale ?? 1) * (fontPx / 28)
  const scaleH = base * (h / w)
  sprite.scale.set(base, scaleH, 1)
  return sprite
}

function disposeTimelineObject3D(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    const m = o.material
    if (!m) return
    if (Array.isArray(m)) {
      m.forEach((x) => {
        if (x.map) x.map.dispose()
        x.dispose()
      })
    } else {
      if (m.map) m.map.dispose()
      m.dispose()
    }
  })
}

function makeRing(innerR, outerR, color, opacity) {
  const inR = Math.min(innerR, outerR * 0.98)
  const geo = new THREE.RingGeometry(inR, outerR, 64)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  return new THREE.Mesh(geo, mat)
}

/** Solid filled disc for timeline nodes (uses same outer radius as the old ring). */
function makeFilledCircle(radius, color, opacity) {
  const geo = new THREE.CircleGeometry(radius, 64)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  return new THREE.Mesh(geo, mat)
}

/**
 * @param {THREE.Group} group
 * @param {{ n: number, slotPositions?: any[], config: any, cards?: import('three').Object3D[] | null, cardHeight?: number }} opts
 */
export function buildSlideTimeline(group, { n, slotPositions, config, cards, cardHeight }) {
  for (const ch of [...group.children]) {
    disposeTimelineObject3D(ch)
    group.remove(ch)
  }
  if (Array.isArray(cards)) {
    clearAnchorsOnCards(cards)
  }

  const resolved = resolveSlideTimelineConfig(config)
  if (resolved === 'disabled' || resolved === null) {
    group.visible = false
    group.userData.tl = null
    return
  }
  if (n < 1) {
    group.visible = false
    group.userData.tl = null
    return
  }

  const c = /** @type {any} */ (resolved)
  const follow = c.followSlides !== false && Array.isArray(cards) && cards.length >= n
  const ch = typeof cardHeight === 'number' && cardHeight > 0 ? cardHeight : 2.1

  const anchorPos = resolveTimelineAnchorPosition(c, ch)
  let anchors = []
  if (follow) {
    for (let i = 0; i < n; i++) {
      const anchor = new THREE.Group()
      anchor.name = ANCHOR_NAME
      anchor.position.set(anchorPos.x, anchorPos.y, anchorPos.z)
      cards[i].add(anchor)
      anchors.push(anchor)
    }
  }

  const yOff = c.yOffset
  const zB = c.zBias ?? 0
  const staticPoints = follow
    ? []
    : buildColinearTimelinePoints(n, slotPositions || [], yOff, zB)
  if (!follow && staticPoints.length < 1) {
    group.visible = false
    group.userData.tl = null
    return
  }

  group.visible = true
  group.renderOrder = 0

  const ro = Math.max(0, Number(c.lineRenderOrder) || 8)
  const lineR = Math.max(0.001, Number(c.lineRadius) || 0.012)
  const col = new THREE.Color(c.lineColor)
  const lineOp = Number(c.lineOpacity)
  const lineMat = new THREE.MeshBasicMaterial({
    color: col,
    transparent: lineOp < 1,
    opacity: lineOp,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  // In-stack chain only, at most n−1 edges (no vanish → front).
  const maxSeg = Math.max(0, n - 1)
  const segmentGroup = new THREE.Group()
  segmentGroup.name = 'slide-timeline-segments'
  const segmentMeshes = []
  for (let i = 0; i < maxSeg; i++) {
    const geo = new THREE.CylinderGeometry(lineR, lineR, 1, 10, 1, false)
    const m = new THREE.Mesh(geo, lineMat)
    m.name = `slide-timeline-seg-${i}`
    m.renderOrder = ro
    m.frustumCulled = false
    m.visible = false
    segmentGroup.add(m)
    segmentMeshes.push(m)
  }
  const navGeo = new THREE.CylinderGeometry(lineR, lineR, 1, 10, 1, false)
  const navLineMat = lineMat.clone()
  const navSegment = new THREE.Mesh(navGeo, navLineMat)
  navSegment.name = 'slide-timeline-nav-seg'
  navSegment.renderOrder = ro
  navSegment.frustumCulled = false
  navSegment.visible = false
  segmentGroup.add(navSegment)

  group.add(segmentGroup)

  const pr = c.playheadRadius
  const playheadR = pr * c.playheadOuter
  const playhead = makeFilledCircle(playheadR, c.playheadColor, 1)
  playhead.name = 'slide-timeline-playhead'
  playhead.renderOrder = ro + 1
  playhead.frustumCulled = false
  group.add(playhead)

  const worldScratch = Array.from({ length: n }, () => new THREE.Vector3())
  const staticLabelOff = !follow ? resolveTimelineLabelOffset(c) : null

  const nodeMeshes = []
  const labelSprites = []
  const nodeColorsArr = c.nodeColors
  const nodeRadiiArr = c.nodeRadii
  for (let i = 0; i < n; i++) {
    const rNode =
      Array.isArray(nodeRadiiArr) && nodeRadiiArr[i] != null && !Number.isNaN(Number(nodeRadiiArr[i]))
        ? Number(nodeRadiiArr[i])
        : c.nodeRadius
    const outerR = rNode * c.nodeRingOuter
    const initCol =
      Array.isArray(nodeColorsArr) && nodeColorsArr[i] != null ? String(nodeColorsArr[i]) : c.nodeColor
    const ring = makeFilledCircle(outerR, initCol, c.presentNodeOpacity)
    ring.name = `slide-timeline-node-${i}`
    ring.userData.tlNodeIndex = i
    ring.renderOrder = ro + 1
    ring.frustumCulled = false
    if (!follow) {
      ring.position.copy(staticPoints[i])
    }
    group.add(ring)
    nodeMeshes.push(ring)

    const list = c.labels
    const lab = list && list[i] != null ? String(list[i]) : ''
    const spr = makeLabelSprite(lab, c)
    if (spr) {
      if (!follow && staticLabelOff) {
        spr.position.set(
          staticPoints[i].x + staticLabelOff.x,
          staticPoints[i].y + staticLabelOff.y,
          staticPoints[i].z + staticLabelOff.z
        )
      }
      spr.name = `slide-timeline-label-${i}`
      group.add(spr)
      labelSprites.push(spr)
    } else {
      labelSprites.push(null)
    }
  }

  const tl = {
    points: follow ? worldScratch : staticPoints,
    n,
    config: c,
    segmentGroup,
    segmentMeshes,
    navSegment,
    navLineMat,
    lineMat,
    playhead,
    nodeMeshes,
    labelSprites,
    follow,
    anchors,
    lineRenderOrder: ro,
    anchorLocal: { x: anchorPos.x, y: anchorPos.y, z: anchorPos.z },
    cards: follow && Array.isArray(cards) ? cards : null,
  }
  group.userData.tl = tl
}

/**
 * @param {THREE.Group} group
 * @param {number} gltfSlideIndex
 * @param {THREE.PerspectiveCamera} camera
 * @param {import('three').Vector2} [resolution] unused; kept for call-site compatibility
 * @param {number} [stackFrontIndex] current slide in front of the stack (`currentIndex` in main); defaults to `floor(gltfSlideIndex)`.
 * @param {number} [targetSlideIndex] `targetIndex` in main while a stack nav tween runs; when === stackFrontIndex, the static stack line is used.
 */
export function updateSlideTimeline(
  group,
  gltfSlideIndex,
  camera,
  resolution,
  stackFrontIndex,
  targetSlideIndex
) {
  void resolution
  const tl = group.userData.tl
  if (!group.visible || !tl) return

  const {
    segmentMeshes,
    navSegment,
    navLineMat,
    playhead,
    nodeMeshes,
    config,
    labelSprites,
    n,
    follow,
    anchors,
    points: pts,
    lineRenderOrder,
    anchorLocal,
    cards: timelineCards,
  } = tl
  if (n < 1) return

  const points = /** @type {THREE.Vector3[]} */ (pts)
  const ro = lineRenderOrder ?? 8
  const tF = Number(gltfSlideIndex)
  const nMax = n - 1
  const front = Math.max(0, Math.min(nMax, Math.floor(
    stackFrontIndex != null && !Number.isNaN(stackFrontIndex) ? stackFrontIndex : tF
  )))

  if (follow) {
    for (let i = 0; i < n; i++) {
      anchors[i].getWorldPosition(points[i])
    }
  }

  const pull = Math.max(0, Number(config.lineDepthPull) ?? 0.03)
  const toIdx =
    targetSlideIndex != null && !Number.isNaN(Number(targetSlideIndex))
      ? Math.max(0, Math.min(nMax, Math.floor(targetSlideIndex)))
      : front
  // When target ≠ front, stack edges use `toIdx` for the full tween; do not
  // require `navSegment` (old `isNav` did, which made deeper stack lines pop).
  const navChordActive =
    follow && n >= 2 && Math.abs(toIdx - front) > 1e-4
  let navT = 0
  if (navChordActive) {
    const d = toIdx - front
    navT = Math.abs(d) < 1e-6 ? 0 : THREE.MathUtils.clamp((tF - front) / d, 0, 1)
  }
  // Do not fade when going back (toIdx < front): the end fade would read as opacity → 0, then
  // the in-stack edge replaces the nav at full line opacity on the same step — a 0 → 1 flash.
  const navForward = navChordActive && toIdx > front
  const navFade =
    navForward && navT > 1 - NAV_CHORD_FADE_END
      ? (1 - navT) / NAV_CHORD_FADE_END
      : 1

  const lineMat = tl.lineMat
  if (lineMat) {
    try {
      lineMat.color.set(String(config.lineColor ?? '#38bdf8'))
    } catch {
      lineMat.color.set('#38bdf8')
    }
    const lop = Number(config.lineOpacity)
    lineMat.opacity = lop
    lineMat.transparent = lop < 1
    if (navLineMat) {
      try {
        navLineMat.color.set(String(config.lineColor ?? '#38bdf8'))
      } catch {
        navLineMat.color.set('#38bdf8')
      }
      const nOp = lop * (navChordActive ? navFade : 0)
      navLineMat.opacity = nOp
      navLineMat.transparent = nOp < 1
    }
  }
  let playheadFromNav = false
  if (n >= 2) {
    const edgeFront = navChordActive ? toIdx : front
    const navLo = navChordActive ? Math.min(front, toIdx) : -1
    const navHi = navChordActive ? Math.max(front, toIdx) : -1

    if (navChordActive) {
      _a.copy(points[front])
      _b.copy(points[toIdx])
      pullPointToCamera(_a, camera, pull, _aP)
      pullPointToCamera(_b, camera, pull, _bP)
      _tmpC.lerpVectors(_aP, _bP, navT)
      if (navSegment) {
        const lenN = _aP.distanceTo(_tmpC)
        if (lenN < 1e-5 || navFade < 0.002) {
          navSegment.visible = false
        } else {
          _dirS.subVectors(_tmpC, _aP)
          _dirS.normalize()
          _midS.addVectors(_aP, _tmpC).multiplyScalar(0.5)
          navSegment.position.copy(_midS)
          navSegment.scale.set(1, lenN, 1)
          const yDotN = Math.abs(_dirS.y)
          if (yDotN > 0.999) {
            navSegment.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), _dirS.y < 0 ? Math.PI : 0)
          } else {
            navSegment.quaternion.setFromUnitVectors(Y_AXIS, _dirS)
          }
          navSegment.visible = true
          navSegment.renderOrder = ro
        }
      }
      playhead.position.copy(_tmpC)
      playheadFromNav = true
    } else {
      if (navSegment) navSegment.visible = false
    }

    for (let k = 0; k < n - 1; k++) {
      const mesh = segmentMeshes[k]
      if (!mesh) continue
      if (follow && k < edgeFront) {
        mesh.visible = false
        continue
      }
      if (navChordActive && k === navLo && k + 1 === navHi) {
        mesh.visible = false
        continue
      }
      const A = points[k]
      const B = points[k + 1]
      _a.copy(A)
      _b.copy(B)
      pullPointToCamera(_a, camera, pull, _aP)
      pullPointToCamera(_b, camera, pull, _bP)
      const len = _aP.distanceTo(_bP)
      const stackSegDuringNav = navChordActive && k >= edgeFront
      if (!stackSegDuringNav) {
        if (A.distanceTo(B) < VERT_DEDUPE_EPS || len < 1e-5) {
          mesh.visible = false
          continue
        }
      }
      const lenDraw = stackSegDuringNav ? Math.max(len, STACK_SEG_LEN_FLOOR) : len
      if (lenDraw < 1e-8) {
        mesh.visible = false
        continue
      }
      _dirS.subVectors(_bP, _aP)
      if (_dirS.lengthSq() < 1e-18) {
        mesh.visible = false
        continue
      }
      _dirS.normalize()
      _midS.addVectors(_aP, _bP).multiplyScalar(0.5)
      mesh.position.copy(_midS)
      mesh.scale.set(1, lenDraw, 1)
      const yDot = Math.abs(_dirS.y)
      if (yDot > 0.999) {
        mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), _dirS.y < 0 ? Math.PI : 0)
      } else {
        mesh.quaternion.setFromUnitVectors(Y_AXIS, _dirS)
      }
      mesh.visible = true
      mesh.renderOrder = ro
    }
    for (let j = n - 1; j < segmentMeshes.length; j++) {
      const m = segmentMeshes[j]
      if (m) m.visible = false
    }
  } else {
    for (const m of segmentMeshes) {
      if (m) m.visible = false
    }
    if (navSegment) navSegment.visible = false
  }

  if (!playheadFromNav) {
    if (follow) {
      positionOnStackChain(points, n, tF, front, _tmpV)
    } else {
      positionOnPolyline(points, tF, _tmpV)
    }
    pullPointToCamera(_tmpV, camera, pull, _tmpV)
    playhead.position.copy(_tmpV)
  }

  for (let i = 0; i < n; i++) {
    if (follow) {
      nodeMeshes[i].position.copy(points[i])
    }
    const ring = nodeMeshes[i]
    if (!ring || !ring.material) continue
    const isFuture = i > gltfSlideIndex + 1e-4
    const colPresent =
      config.nodeColors && config.nodeColors[i] != null ? String(config.nodeColors[i]) : config.nodeColor
    const colFuture =
      config.futureNodeColors && config.futureNodeColors[i] != null
        ? String(config.futureNodeColors[i])
        : config.futureNodeColor
    if (isFuture) {
      ring.material.color.set(colFuture)
      ring.material.opacity = config.futureNodeOpacity
    } else {
      ring.material.color.set(colPresent)
      ring.material.opacity = config.presentNodeOpacity
    }
  }

  const la = anchorLocal ?? { x: 0, y: 0, z: 0 }
  const lOff = resolveTimelineLabelOffset(config)
  for (let i = 0; i < n; i++) {
    const spr = labelSprites[i]
    if (spr) {
      if (follow) {
        const card = timelineCards && timelineCards[i]
        const parent = card || anchors[i]?.parent
        if (parent) {
          _labelPos.set(la.x + lOff.x, la.y + lOff.y, la.z + lOff.z)
          parent.localToWorld(_labelPos)
          spr.position.copy(_labelPos)
        }
      }
      spr.quaternion.copy(camera.quaternion)
    }
  }
  for (const ring of nodeMeshes) {
    if (ring) ring.quaternion.copy(camera.quaternion)
  }
  if (playhead) playhead.quaternion.copy(camera.quaternion)
}

const _tmpV = new THREE.Vector3()
const _tmpC = new THREE.Vector3()
const _labelPos = new THREE.Vector3()
