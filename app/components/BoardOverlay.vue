<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowUpRight,
  Circle,
  Diamond,
  Download,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X
} from 'lucide-vue-next'
import {
  BOARD_MAX_ELEMENTS,
  GRID_STEP,
  LINE_HEIGHT,
  MAX_ZOOM,
  MIN_ZOOM,
  TONES,
  TONE_LABEL,
  arrowPoints,
  clamp,
  createBoard,
  elementBounds,
  fontSize,
  inflateRect,
  normaliseRect,
  parseBoard,
  pointInElement,
  rectOf,
  rectsIntersect,
  shiftElement,
  slugify,
  strokePath,
  strokePoints,
  syncArrowBounds,
  textPadding,
  uid,
  visibleLines,
  wrapText,
  type BoardDocument,
  type BoardElement,
  type BoardElementType,
  type BoardTone,
  type Point,
  type Rect
} from '../lib/board'

type Tool = 'select' | 'note' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'pen'
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Origin {
  x: number
  y: number
  w: number
  h: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

interface DragState {
  mode: 'pan' | 'move' | 'resize' | 'marquee' | 'create' | 'draw' | 'endpoint'
  pointerId: number
  startScreen: Point
  lastScreen: Point
  startWorld: Point
  moved: boolean
  before: string
  handle?: HandleId
  startRect?: Rect
  origins?: Map<string, Origin>
  arrowId?: string
  arrowEnd?: 'a' | 'b'
}

const TOOLS: { id: Tool; label: string; key: string; icon: unknown }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: MousePointer2 },
  { id: 'note', label: 'Sticky note', key: 'N', icon: StickyNote },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
  { id: 'diamond', label: 'Diamond', key: 'D', icon: Diamond },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'arrow', label: 'Connector', key: 'A', icon: ArrowUpRight },
  { id: 'pen', label: 'Freehand pen', key: 'P', icon: PenTool }
]

const HANDLES: { id: HandleId; fx: number; fy: number }[] = [
  { id: 'nw', fx: 0, fy: 0 },
  { id: 'n', fx: 0.5, fy: 0 },
  { id: 'ne', fx: 1, fy: 0 },
  { id: 'e', fx: 1, fy: 0.5 },
  { id: 'se', fx: 1, fy: 1 },
  { id: 's', fx: 0.5, fy: 1 },
  { id: 'sw', fx: 0, fy: 1 },
  { id: 'w', fx: 0, fy: 0.5 }
]

const TEXT_TYPES: BoardElementType[] = ['note', 'rect', 'ellipse', 'diamond', 'text']

const board = useBoard()
const ide = useIde()

const doc = ref<BoardDocument>(createBoard())
const selected = ref<string[]>([])
const tool = ref<Tool>('select')
const activeTone = ref<BoardTone>('amber')
const editingId = ref<string | null>(null)
const editorValue = ref('')
const draft = ref<BoardElement | null>(null)
const marquee = ref<Rect | null>(null)
const spaceDown = ref(false)
const panning = ref(false)
const exporting = ref(false)
const stage = ref<HTMLElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
const probeHost = ref<HTMLElement | null>(null)
const past = ref<string[]>([])
const future = ref<string[]>([])

let drag: DragState | null = null
let drawPoints: Point[] = []
let saveTimer: ReturnType<typeof setTimeout> | null = null

const byId = computed(() => new Map(doc.value.elements.map((element) => [element.id, element])))
const elements = computed(() => doc.value.elements)
const zoom = computed(() => doc.value.view.zoom)
const zoomLabel = computed(() => `${Math.round(doc.value.view.zoom * 100)}%`)
const isEmpty = computed(() => doc.value.elements.length === 0)
const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
const countLabel = computed(() => {
  const count = doc.value.elements.length
  if (!count) return 'empty'
  return `${count} item${count === 1 ? '' : 's'}`
})

const selectedElements = computed(() =>
  selected.value.map((id) => byId.value.get(id)).filter((element): element is BoardElement => !!element)
)
const single = computed(() => (selectedElements.value.length === 1 ? selectedElements.value[0] ?? null : null))
const selectionRect = computed(() => elementBounds(selectedElements.value, byId.value))

const textElements = computed(() =>
  doc.value.elements.filter((element) => TEXT_TYPES.includes(element.type))
)

const linesById = computed(() => {
  const map = new Map<string, string[]>()
  for (const element of textElements.value) map.set(element.id, visibleLines(element))
  return map
})

const editingElement = computed(() =>
  editingId.value ? byId.value.get(editingId.value) ?? null : null
)

const cursorStyle = computed(() => {
  if (panning.value) return 'grabbing'
  if (spaceDown.value) return 'grab'
  return tool.value === 'select' ? 'default' : 'crosshair'
})

const gridStyle = computed(() => {
  const view = doc.value.view
  const step = GRID_STEP * view.zoom
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
    opacity: view.zoom < 0.4 ? '0.45' : '1'
  }
})

const editorStyle = computed(() => {
  const element = editingElement.value
  if (!element) return {}
  const view = doc.value.view
  const pad = textPadding(element)
  return {
    left: `${view.x + element.x * view.zoom}px`,
    top: `${view.y + element.y * view.zoom}px`,
    width: `${Math.max(48, element.w * view.zoom)}px`,
    height: `${Math.max(30, element.h * view.zoom)}px`,
    padding: `${pad * view.zoom}px`,
    fontSize: `${fontSize(element) * view.zoom}px`,
    lineHeight: String(LINE_HEIGHT),
    textAlign: element.type === 'text' || element.type === 'note' ? 'left' : 'center'
  } as Record<string, string>
})

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function storageKey(path: string | undefined | null): string {
  return `kodra:board:${path ? encodeURIComponent(path) : '~'}`
}

function loadBoard() {
  if (saveTimer) clearTimeout(saveTimer)
  let stored: string | null = null
  try {
    stored = localStorage.getItem(storageKey(ide.workspace.value?.path))
  } catch {
    stored = null
  }
  doc.value = parseBoard(stored) ?? createBoard()
  selected.value = []
  past.value = []
  future.value = []
  editingId.value = null
  draft.value = null
  marquee.value = null
  drawPoints = []
  drag = null
}

/** Only warn once per session: the autosave retries on every change. */
let saveFailureNotified = false

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    localStorage.setItem(storageKey(ide.workspace.value?.path), JSON.stringify(doc.value))
    saveFailureNotified = false
  } catch {
    if (saveFailureNotified) return
    saveFailureNotified = true
    ide.notify('This board could not be saved: browser storage is full.', 'error')
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 400)
}

watch(doc, scheduleSave, { deep: true })

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function snapshot(): string {
  return JSON.stringify(doc.value)
}

function remember(before: string) {
  if (before === snapshot()) return
  past.value.push(before)
  if (past.value.length > 60) past.value.shift()
  future.value = []
  scheduleSave()
}

function mutate(change: () => void) {
  const before = snapshot()
  change()
  remember(before)
}

function undo() {
  const previous = past.value.pop()
  if (!previous) return
  commitEditing()
  future.value.push(snapshot())
  doc.value = parseBoard(previous) ?? createBoard()
  selected.value = []
  scheduleSave()
}

function redo() {
  const next = future.value.pop()
  if (!next) return
  commitEditing()
  past.value.push(snapshot())
  doc.value = parseBoard(next) ?? createBoard()
  selected.value = []
  scheduleSave()
}

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

function screenPoint(event: PointerEvent | WheelEvent | MouseEvent): Point {
  const rect = stage.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

function toWorld(point: Point): Point {
  const view = doc.value.view
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }
}

function zoomAt(screen: Point, factor: number) {
  const view = doc.value.view
  const next = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  if (next === view.zoom) return
  view.x = screen.x - ((screen.x - view.x) * next) / view.zoom
  view.y = screen.y - ((screen.y - view.y) * next) / view.zoom
  view.zoom = next
}

function zoomBy(factor: number) {
  const width = stage.value?.clientWidth ?? 800
  const height = stage.value?.clientHeight ?? 600
  zoomAt({ x: width / 2, y: height / 2 }, factor)
}

function resetZoom() {
  zoomAt({ x: (stage.value?.clientWidth ?? 800) / 2, y: (stage.value?.clientHeight ?? 600) / 2 }, 1 / doc.value.view.zoom)
}

function fitToContent() {
  const bounds = elementBounds(doc.value.elements, byId.value)
  const width = stage.value?.clientWidth ?? 800
  const height = stage.value?.clientHeight ?? 600
  if (!bounds) {
    doc.value.view = { x: 0, y: 0, zoom: 1 }
    return
  }
  const pad = 90
  const next = clamp(
    Math.min(
      (width - pad * 2) / Math.max(bounds.w, 40),
      (height - pad * 2) / Math.max(bounds.h, 40)
    ),
    MIN_ZOOM,
    1.4
  )
  doc.value.view = {
    zoom: next,
    x: width / 2 - (bounds.x + bounds.w / 2) * next,
    y: height / 2 - (bounds.y + bounds.h / 2) * next
  }
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */

function diamondPoints(element: BoardElement): string {
  const right = element.x + element.w
  const bottom = element.y + element.h
  return [
    `${element.x + element.w / 2},${element.y}`,
    `${right},${element.y + element.h / 2}`,
    `${element.x + element.w / 2},${bottom}`,
    `${element.x},${element.y + element.h / 2}`
  ].join(' ')
}

function textAnchor(element: BoardElement): string {
  return element.type === 'text' || element.type === 'note' ? 'start' : 'middle'
}

function textX(element: BoardElement): number {
  return element.type === 'text' || element.type === 'note'
    ? element.x + textPadding(element)
    : element.x + element.w / 2
}

function textY(element: BoardElement, lineCount: number): number {
  const size = fontSize(element)
  if (element.type === 'text' || element.type === 'note') {
    return element.y + textPadding(element) + size * 0.95
  }
  return element.y + element.h / 2 - ((lineCount - 1) * size * LINE_HEIGHT) / 2 + size * 0.34
}

function clipId(element: BoardElement): string {
  return `board-clip-${element.id}`
}

function clipFor(element: BoardElement): string | undefined {
  if (element.type === 'text') return undefined
  return `url(#${clipId(element)})`
}

function showsPlaceholder(element: BoardElement): boolean {
  return element.type === 'note' && !(element.text ?? '').trim() && editingId.value !== element.id
}

function arrowHead(element: BoardElement): string {
  const { a, b } = arrowPoints(element, byId.value)
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const size = 10
  const left = { x: b.x - size * Math.cos(angle - Math.PI / 6), y: b.y - size * Math.sin(angle - Math.PI / 6) }
  const right = { x: b.x - size * Math.cos(angle + Math.PI / 6), y: b.y - size * Math.sin(angle + Math.PI / 6) }
  return `${b.x},${b.y} ${left.x},${left.y} ${right.x},${right.y}`
}

function arrowLine(element: BoardElement): { a: Point; b: Point } {
  return arrowPoints(element, byId.value)
}

/** Handle markers for the current selection, in world coordinates. */
const handleMarks = computed(() => {
  const rect = selectionRect.value
  if (!rect || !single.value) return []
  return HANDLES.map((handle) => ({
    id: handle.id,
    x: rect.x + rect.w * handle.fx,
    y: rect.y + rect.h * handle.fy
  }))
})

const arrowEnds = computed(() => {
  const element = single.value
  if (!element || element.type !== 'arrow') return null
  return arrowPoints(element, byId.value)
})

const handleSize = computed(() => 9 / zoom.value)
const strokeWidthSelection = computed(() => 1.5 / zoom.value)

/* ------------------------------------------------------------------ */
/* Hit testing                                                         */
/* ------------------------------------------------------------------ */

function pick(world: Point, ignore?: string): BoardElement | null {
  const tolerance = 6 / doc.value.view.zoom
  for (let index = doc.value.elements.length - 1; index >= 0; index--) {
    const element = doc.value.elements[index]
    if (!element || element.id === ignore) continue
    if (pointInElement(element, world, byId.value, tolerance)) return element
  }
  return null
}

function handleAt(world: Point): HandleId | null {
  if (!single.value || single.value.type === 'arrow') return null
  const rect = rectOf(single.value, byId.value)
  const radius = 7 / doc.value.view.zoom
  for (const handle of HANDLES) {
    const x = rect.x + rect.w * handle.fx
    const y = rect.y + rect.h * handle.fy
    if (Math.abs(world.x - x) <= radius && Math.abs(world.y - y) <= radius) return handle.id
  }
  return null
}

function endpointAt(world: Point): 'a' | 'b' | null {
  const element = single.value
  if (!element || element.type !== 'arrow') return null
  const ends = arrowPoints(element, byId.value)
  const radius = 8 / doc.value.view.zoom
  if (Math.hypot(world.x - ends.a.x, world.y - ends.a.y) <= radius) return 'a'
  if (Math.hypot(world.x - ends.b.x, world.y - ends.b.y) <= radius) return 'b'
  return null
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function defaultSize(kind: Tool): { w: number; h: number } {
  if (kind === 'note') return { w: 240, h: 150 }
  if (kind === 'text') return { w: 260, h: 48 }
  if (kind === 'diamond') return { w: 190, h: 150 }
  if (kind === 'ellipse') return { w: 200, h: 140 }
  return { w: 200, h: 130 }
}

function selectTool(next: Tool) {
  commitEditing()
  tool.value = next
}

function toggleSelection(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((current) => current !== id)
    : [...selected.value, id]
}

function removeElements(ids: string[]) {
  const targets = new Set(ids)
  if (!targets.size) return
  mutate(() => {
    doc.value.elements = doc.value.elements.filter((element) => !targets.has(element.id))
    for (const element of doc.value.elements) {
      if (element.from && targets.has(element.from)) delete element.from
      if (element.to && targets.has(element.to)) delete element.to
    }
  })
  selected.value = selected.value.filter((id) => !targets.has(id))
  if (editingId.value && targets.has(editingId.value)) editingId.value = null
}

function deleteSelection() {
  if (!selected.value.length) return
  removeElements([...selected.value])
}

function applyTone(tone: BoardTone) {
  activeTone.value = tone
  if (!selectedElements.value.length) return
  mutate(() => {
    for (const element of selectedElements.value) element.tone = tone
  })
}

function duplicateSelection() {
  const source = selectedElements.value
  if (!source.length) return
  const remap = new Map<string, string>()
  const copies: BoardElement[] = source.map((element) => {
    const copy: BoardElement = JSON.parse(JSON.stringify(element)) as BoardElement
    copy.id = uid()
    remap.set(element.id, copy.id)
    shiftElement(copy, 28, 28)
    return copy
  })
  if (doc.value.elements.length + copies.length > BOARD_MAX_ELEMENTS) {
    ide.notify('This board is full. Delete a few items first.', 'error')
    return
  }
  // A connector copied together with its shapes should point at the copies.
  for (const copy of copies) {
    if (copy.from) copy.from = remap.get(copy.from) ?? copy.from
    if (copy.to) copy.to = remap.get(copy.to) ?? copy.to
  }
  mutate(() => {
    doc.value.elements.push(...copies)
  })
  selected.value = copies.map((copy) => copy.id)
}

function selectAll() {
  selected.value = doc.value.elements.map((element) => element.id)
}

function clearBoard() {
  if (!doc.value.elements.length) return
  if (!window.confirm('Remove every item on this board? You can undo with Ctrl+Z.')) return
  mutate(() => {
    doc.value.elements = []
  })
  selected.value = []
}

function nudge(dx: number, dy: number) {
  if (!selected.value.length) return
  mutate(() => {
    for (const element of selectedElements.value) shiftElement(element, dx, dy)
  })
}

function startEditing(element: BoardElement) {
  if (!TEXT_TYPES.includes(element.type)) return
  commitEditing()
  selected.value = [element.id]
  editingId.value = element.id
  editorValue.value = element.text ?? ''
  void nextTick(() => {
    const node = editor.value
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  })
}

function commitEditing() {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  const element = byId.value.get(id)
  if (!element) return
  const next = editorValue.value
  if (element.type === 'text' && !next.trim()) {
    removeElements([id])
    return
  }
  if ((element.text ?? '') === next) return
  mutate(() => {
    element.text = next
    if (element.type === 'text') {
      // Text boxes grow vertically instead of clipping the label.
      const size = fontSize(element)
      const lines = wrapText(next, Math.max(24, element.w - textPadding(element) * 2), size)
      element.h = Math.max(size * LINE_HEIGHT + textPadding(element) * 2, lines.length * size * LINE_HEIGHT + textPadding(element) * 2)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                 */
/* ------------------------------------------------------------------ */

function originsForSelection(): Map<string, Origin> {
  const origins = new Map<string, Origin>()
  for (const element of selectedElements.value) {
    origins.set(element.id, {
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      x1: element.x1,
      y1: element.y1,
      x2: element.x2,
      y2: element.y2
    })
  }
  return origins
}

function applyMove(dx: number, dy: number) {
  if (!drag?.origins) return
  for (const element of selectedElements.value) {
    const origin = drag.origins.get(element.id)
    if (!origin) continue
    element.x = origin.x + dx
    element.y = origin.y + dy
    if (element.type === 'arrow') {
      element.x1 = (origin.x1 ?? origin.x) + dx
      element.y1 = (origin.y1 ?? origin.y) + dy
      element.x2 = (origin.x2 ?? origin.x + origin.w) + dx
      element.y2 = (origin.y2 ?? origin.y + origin.h) + dy
      syncArrowBounds(element)
    }
  }
}

function resizedRect(start: Rect, handle: HandleId, world: Point): Rect {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = world.x
  if (handle.includes('e')) right = world.x
  if (handle.includes('n')) top = world.y
  if (handle.includes('s')) bottom = world.y
  const minW = 48
  const minH = 30
  if (right - left < minW) {
    if (handle.includes('w')) left = right - minW
    else right = left + minW
  }
  if (bottom - top < minH) {
    if (handle.includes('n')) top = bottom - minH
    else bottom = top + minH
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function onPointerDown(event: PointerEvent) {
  if (event.button === 2) return
  if (!board.open.value) return
  const screen = screenPoint(event)
  const world = toWorld(screen)
  if (editingId.value) commitEditing()
  event.preventDefault()
  stage.value?.setPointerCapture(event.pointerId)

  const base: Omit<DragState, 'mode'> = {
    pointerId: event.pointerId,
    startScreen: screen,
    lastScreen: screen,
    startWorld: world,
    moved: false,
    before: snapshot()
  }

  if (event.button === 1 || spaceDown.value) {
    drag = { ...base, mode: 'pan' }
    panning.value = true
    return
  }

  if (tool.value === 'select') {
    const arrowEnd = endpointAt(world)
    if (arrowEnd && single.value) {
      drag = { ...base, mode: 'endpoint', arrowId: single.value.id, arrowEnd }
      return
    }
    const handle = handleAt(world)
    if (handle && single.value) {
      drag = { ...base, mode: 'resize', handle, startRect: rectOf(single.value, byId.value) }
      return
    }
    const hit = pick(world)
    if (hit) {
      if (event.shiftKey) toggleSelection(hit.id)
      else if (!selected.value.includes(hit.id)) selected.value = [hit.id]
      drag = { ...base, mode: 'move', origins: originsForSelection() }
      return
    }
    if (!event.shiftKey) selected.value = []
    drag = { ...base, mode: 'marquee' }
    marquee.value = { x: world.x, y: world.y, w: 0, h: 0 }
    return
  }

  if (tool.value === 'pen') {
    drawPoints = [world]
    drag = { ...base, mode: 'draw' }
    updateStrokeDraft()
    return
  }

  drag = { ...base, mode: 'create' }
  const size = defaultSize(tool.value)
  draft.value = previewElement(tool.value, world, size)
}

function previewElement(kind: Tool, point: Point, size: { w: number; h: number }): BoardElement {
  if (kind === 'arrow') {
    return {
      id: 'draft',
      type: 'arrow',
      x: point.x,
      y: point.y,
      w: 1,
      h: 1,
      tone: activeTone.value,
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y
    }
  }
  const type = (kind === 'note' ? 'note' : kind) as BoardElementType
  return {
    id: 'draft',
    type,
    x: point.x,
    y: point.y,
    w: size.w,
    h: size.h,
    tone: activeTone.value,
    text: ''
  }
}

function updateStrokeDraft() {
  if (!drawPoints.length) return
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of drawPoints) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const points: number[] = []
  for (const point of drawPoints) points.push(point.x - minX, point.y - minY)
  draft.value = {
    id: 'draft',
    type: 'stroke',
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    tone: activeTone.value,
    size: 3,
    points
  }
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return
  const screen = screenPoint(event)
  const world = toWorld(screen)
  const dx = world.x - drag.startWorld.x
  const dy = world.y - drag.startWorld.y
  if (Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) > 2) drag.moved = true

  if (drag.mode === 'pan') {
    doc.value.view.x += screen.x - drag.lastScreen.x
    doc.value.view.y += screen.y - drag.lastScreen.y
    drag.lastScreen = screen
    return
  }

  if (drag.mode === 'move') {
    let moveX = dx
    let moveY = dy
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) moveY = 0
      else moveX = 0
    }
    applyMove(moveX, moveY)
    return
  }

  if (drag.mode === 'resize' && drag.startRect && single.value) {
    const rect = resizedRect(drag.startRect, drag.handle ?? 'se', world)
    single.value.x = rect.x
    single.value.y = rect.y
    single.value.w = rect.w
    single.value.h = rect.h
    return
  }

  if (drag.mode === 'marquee') {
    marquee.value = normaliseRect(drag.startWorld, world)
    return
  }

  if (drag.mode === 'draw') {
    const last = drawPoints[drawPoints.length - 1]
    const threshold = 1.5 / doc.value.view.zoom
    if (!last || Math.hypot(world.x - last.x, world.y - last.y) >= threshold) {
      drawPoints.push(world)
      updateStrokeDraft()
    }
    return
  }

  if (drag.mode === 'create' && draft.value) {
    if (draft.value.type === 'arrow') {
      draft.value.x2 = world.x
      draft.value.y2 = world.y
      syncArrowBounds(draft.value)
    } else {
      const rect = normaliseRect(drag.startWorld, world)
      draft.value.x = rect.x
      draft.value.y = rect.y
      draft.value.w = Math.max(1, rect.w)
      draft.value.h = Math.max(1, rect.h)
    }
    return
  }

  if (drag.mode === 'endpoint' && drag.arrowId) {
    const arrow = byId.value.get(drag.arrowId)
    if (!arrow) return
    if (drag.arrowEnd === 'a') {
      arrow.x1 = world.x
      arrow.y1 = world.y
    } else {
      arrow.x2 = world.x
      arrow.y2 = world.y
    }
    syncArrowBounds(arrow)
  }
}

function bindingTarget(world: Point, ignore: string): BoardElement | null {
  const hit = pick(world, ignore)
  if (!hit || hit.type === 'arrow' || hit.type === 'stroke') return null
  return hit
}

function finishCreate(world: Point, moved: boolean, startWorld: Point) {
  const kind = tool.value
  if (kind === 'arrow') {
    const start = startWorld
    if (Math.hypot(world.x - start.x, world.y - start.y) < 10) return
    const arrow: BoardElement = {
      id: uid(),
      type: 'arrow',
      x: Math.min(start.x, world.x),
      y: Math.min(start.y, world.y),
      w: Math.abs(world.x - start.x),
      h: Math.abs(world.y - start.y),
      tone: activeTone.value,
      x1: start.x,
      y1: start.y,
      x2: world.x,
      y2: world.y
    }
    const from = bindingTarget(start, arrow.id)
    const to = bindingTarget(world, arrow.id)
    if (from) arrow.from = from.id
    if (to) arrow.to = to.id
    mutate(() => doc.value.elements.push(arrow))
    selected.value = [arrow.id]
    tool.value = 'select'
    return
  }

  const type = (kind === 'note' ? 'note' : kind) as BoardElementType
  const size = defaultSize(kind)
  const start = startWorld
  const dragged = moved ? normaliseRect(start, world) : { x: start.x, y: start.y, w: size.w, h: size.h }
  const rect: Rect = {
    x: dragged.x,
    y: dragged.y,
    w: dragged.w < 6 ? size.w : dragged.w,
    h: dragged.h < 6 ? size.h : dragged.h
  }
  const element: BoardElement = {
    id: uid(),
    type,
    x: rect.x,
    y: rect.y,
    w: Math.max(24, rect.w),
    h: Math.max(24, rect.h),
    tone: activeTone.value,
    text: ''
  }
  if (doc.value.elements.length >= BOARD_MAX_ELEMENTS) {
    ide.notify('This board is full. Delete a few items first.', 'error')
    return
  }
  mutate(() => doc.value.elements.push(element))
  selected.value = [element.id]
  tool.value = 'select'
  if (type === 'note' || type === 'text') startEditing(element)
}

function finishStroke() {
  const element = draft.value
  draft.value = null
  drawPoints = []
  if (!element || !element.points || element.points.length < 4) return
  if (doc.value.elements.length >= BOARD_MAX_ELEMENTS) {
    ide.notify('This board is full. Delete a few items first.', 'error')
    return
  }
  mutate(() => doc.value.elements.push(element))
  selected.value = [element.id]
}

function onPointerUp(event: PointerEvent) {
  const state = drag
  if (!state || state.pointerId !== event.pointerId) return
  drag = null
  panning.value = false
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId)
  }
  const world = toWorld(screenPoint(event))

  if (state.mode === 'move' || state.mode === 'resize' || state.mode === 'endpoint') {
    if (state.mode === 'endpoint' && state.arrowId) {
      const arrow = byId.value.get(state.arrowId)
      const target = bindingTarget(world, state.arrowId)
      if (arrow) {
        if (state.arrowEnd === 'a') {
          if (target) arrow.from = target.id
          else delete arrow.from
        } else if (target) {
          arrow.to = target.id
        } else {
          delete arrow.to
        }
      }
    }
    if (state.moved) remember(state.before)
    return
  }

  if (state.mode === 'marquee') {
    const rect = marquee.value
    marquee.value = null
    if (rect && (rect.w > 4 || rect.h > 4)) {
      const hits = doc.value.elements.filter((element) =>
        rectsIntersect(inflateRect(rectOf(element, byId.value), 2), rect)
      )
      selected.value = hits.map((element) => element.id)
    }
    return
  }

  if (state.mode === 'create') {
    finishCreate(world, state.moved, state.startWorld)
    draft.value = null
    return
  }

  if (state.mode === 'draw') {
    finishStroke()
  }
}

function onDoubleClick(event: MouseEvent) {
  if (tool.value !== 'select') return
  const world = toWorld(screenPoint(event))
  const hit = pick(world)
  if (hit && TEXT_TYPES.includes(hit.type)) {
    event.preventDefault()
    startEditing(hit)
  }
}

function onWheel(event: WheelEvent) {
  if (!board.open.value) return
  event.preventDefault()
  const point = screenPoint(event)
  if (event.ctrlKey || event.metaKey) {
    zoomAt(point, Math.exp(-event.deltaY * 0.0016))
    return
  }
  doc.value.view.x -= event.deltaX
  doc.value.view.y -= event.deltaY
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function onKeyDown(event: KeyboardEvent) {
  if (!board.open.value) return

  if (editingId.value) {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault()
      event.stopPropagation()
      commitEditing()
    }
    return
  }

  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }

  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (tool.value !== 'select') {
      tool.value = 'select'
      draft.value = null
      return
    }
    close()
    return
  }

  if (event.code === 'Space') {
    if (!spaceDown.value) spaceDown.value = true
    event.preventDefault()
    return
  }

  if (mod) {
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      undo()
      return
    }
    if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault()
      redo()
      return
    }
    if (key === 'a') {
      event.preventDefault()
      selectAll()
      return
    }
    if (key === 'd') {
      event.preventDefault()
      duplicateSelection()
      return
    }
    if (key === '0') {
      event.preventDefault()
      resetZoom()
      return
    }
    if (key === '=' || key === '+') {
      event.preventDefault()
      zoomBy(1.2)
      return
    }
    if (key === '-') {
      event.preventDefault()
      zoomBy(1 / 1.2)
      return
    }
    return
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }

  if (event.key.startsWith('Arrow')) {
    if (!selected.value.length) return
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') nudge(-step, 0)
    else if (event.key === 'ArrowRight') nudge(step, 0)
    else if (event.key === 'ArrowUp') nudge(0, -step)
    else if (event.key === 'ArrowDown') nudge(0, step)
    return
  }

  if (event.key === '1' && event.shiftKey) {
    event.preventDefault()
    fitToContent()
    return
  }

  const byKey: Record<string, Tool> = {
    v: 'select',
    n: 'note',
    r: 'rect',
    o: 'ellipse',
    d: 'diamond',
    t: 'text',
    a: 'arrow',
    p: 'pen'
  }
  const next = byKey[key]
  if (next) {
    event.preventDefault()
    selectTool(next)
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceDown.value = false
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function toneColors(tone: BoardTone): { fill: string; line: string; ink: string; stroke: string } {
  const node = probeHost.value?.querySelector<HTMLElement>(`.tone-probe[data-tone="${tone}"]`)
  if (!node) return { fill: '#1c1c1f', line: '#3a3a40', ink: '#e6e6e9', stroke: '#d4d4d8' }
  const style = getComputedStyle(node)
  const strokeNode = node.querySelector<HTMLElement>('.tone-probe-stroke')
  return {
    fill: style.backgroundColor,
    line: style.borderTopColor,
    ink: style.color,
    stroke: strokeNode ? getComputedStyle(strokeNode).backgroundColor : style.color
  }
}

function cssColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  if (!value) return fallback
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;left:-9999px;top:0;color:var(${variable})`
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}

function exportFont(): string {
  return getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawExportElement(ctx: CanvasRenderingContext2D, element: BoardElement) {
  const colors = toneColors(element.tone)

  if (element.type === 'arrow') {
    const { a, b } = arrowPoints(element, byId.value)
    ctx.strokeStyle = colors.stroke
    ctx.fillStyle = colors.stroke
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const size = 10
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - size * Math.cos(angle - Math.PI / 6), b.y - size * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(b.x - size * Math.cos(angle + Math.PI / 6), b.y - size * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
    return
  }

  if (element.type === 'stroke') {
    const points = strokePoints(element)
    if (points.length < 2) return
    ctx.strokeStyle = colors.stroke
    ctx.lineWidth = element.size ?? 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
    return
  }

  if (element.type !== 'text') {
    ctx.beginPath()
    if (element.type === 'ellipse') {
      ctx.ellipse(element.x + element.w / 2, element.y + element.h / 2, element.w / 2, element.h / 2, 0, 0, Math.PI * 2)
    } else if (element.type === 'diamond') {
      ctx.moveTo(element.x + element.w / 2, element.y)
      ctx.lineTo(element.x + element.w, element.y + element.h / 2)
      ctx.lineTo(element.x + element.w / 2, element.y + element.h)
      ctx.lineTo(element.x, element.y + element.h / 2)
      ctx.closePath()
    } else {
      roundedRectPath(ctx, element.x, element.y, element.w, element.h, element.type === 'note' ? 10 : 8)
    }
    ctx.fillStyle = colors.fill
    ctx.fill()
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  const lines = visibleLines(element)
  if (!lines.length) return
  const size = fontSize(element)
  ctx.font = `500 ${size}px ${exportFont()}`
  ctx.fillStyle = colors.ink
  ctx.textAlign = element.type === 'text' || element.type === 'note' ? 'left' : 'center'
  ctx.textBaseline = 'alphabetic'
  let y = textY(element, lines.length)
  for (const line of lines) {
    ctx.fillText(line, textX(element), y)
    y += size * LINE_HEIGHT
  }
}

async function exportPng() {
  if (exporting.value) return
  commitEditing()
  const bounds = elementBounds(doc.value.elements, byId.value)
  if (!bounds) {
    ide.notify('Add something to the board first.', 'info')
    return
  }
  exporting.value = true
  try {
    const padding = 48
    const scale = 2
    const width = Math.max(64, Math.ceil(bounds.w + padding * 2))
    const height = Math.max(64, Math.ceil(bounds.h + padding * 2))
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(8192, Math.round(width * scale))
    canvas.height = Math.min(8192, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.scale(canvas.width / width, canvas.height / height)
    ctx.translate(padding - bounds.x, padding - bounds.y)
    ctx.fillStyle = cssColor('--canvas', '#111113')
    ctx.fillRect(bounds.x - padding, bounds.y - padding, width, height)
    for (const element of doc.value.elements) drawExportElement(ctx, element)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG encoding failed')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugify(doc.value.name)}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
    ide.notify('Board exported as PNG', 'success')
  } catch (error) {
    ide.notify(`Export failed: ${String(error)}`, 'error')
  } finally {
    exporting.value = false
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

let previousFocus: HTMLElement | null = null

/**
 * The overlay covers the whole shell, so the shell behind it is made inert:
 * Tab cannot reach editor inputs and screen readers skip the hidden UI.
 */
function setBackgroundInert(inert: boolean) {
  const shell = document.querySelector<HTMLElement>('.app-shell')
  if (!shell) return
  if (inert) shell.setAttribute('inert', '')
  else shell.removeAttribute('inert')
}

function close() {
  commitEditing()
  saveNow()
  board.hide()
}

watch(
  () => ide.workspace.value?.path,
  (path, previous) => {
    if (!board.open.value) return
    if (previous) {
      try {
        localStorage.setItem(storageKey(previous), JSON.stringify(doc.value))
      } catch {
        /* ignore */
      }
    }
    loadBoard()
  }
)

/* The overlay is mounted only while it is open (`v-if` in app.vue), so its
   lifetime is the session: open work happens on mount, teardown on unmount. */
onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  setBackgroundInert(true)
  loadBoard()
  void nextTick(() => stage.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  setBackgroundInert(false)
  saveNow()
  const target = previousFocus
  previousFocus = null
  if (target?.isConnected) target.focus()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="board.open.value"
      class="board-shell"
      role="dialog"
      aria-modal="true"
      aria-label="Whiteboard canvas"
    >
      <header class="board-head">
        <div class="board-id">
          <span class="board-badge"><PenTool :size="15" /></span>
          <input
            v-model="doc.name"
            class="board-name"
            maxlength="80"
            spellcheck="false"
            aria-label="Board name"
            @change="scheduleSave"
          />
          <span class="board-meta">{{ countLabel }}</span>
        </div>

        <div class="board-actions">
          <button
            class="icon-btn"
            type="button"
            :disabled="!canUndo"
            title="Undo (Ctrl+Z)"
            @click="undo"
          >
            <Undo2 :size="14" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :disabled="!canRedo"
            title="Redo (Ctrl+Shift+Z)"
            @click="redo"
          >
            <Redo2 :size="14" />
          </button>
          <span class="board-divider" />
          <button
            class="icon-btn"
            type="button"
            :disabled="exporting || !elements.length"
            title="Export as PNG"
            @click="exportPng"
          >
            <Download :size="14" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :disabled="!elements.length"
            title="Clear board"
            @click="clearBoard"
          >
            <Trash2 :size="14" />
          </button>
          <span class="board-divider" />
          <button class="icon-btn" type="button" title="Close (Esc)" @click="close">
            <X :size="15" />
          </button>
        </div>
      </header>

      <div
        ref="stage"
        class="board-stage"
        :style="{ cursor: cursorStyle }"
        tabindex="0"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="onDoubleClick"
        @wheel="onWheel"
        @contextmenu.prevent
      >
        <div class="board-grid" :style="gridStyle" />

        <svg class="board-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath
              v-for="element in textElements"
              :id="clipId(element)"
              :key="`clip-${element.id}`"
            >
              <rect
                v-if="element.type === 'note' || element.type === 'rect'"
                :x="element.x"
                :y="element.y"
                :width="element.w"
                :height="element.h"
                :rx="element.type === 'note' ? 10 : 8"
              />
              <ellipse
                v-else-if="element.type === 'ellipse'"
                :cx="element.x + element.w / 2"
                :cy="element.y + element.h / 2"
                :rx="element.w / 2"
                :ry="element.h / 2"
              />
              <polygon
                v-else-if="element.type === 'diamond'"
                :points="diamondPoints(element)"
              />
            </clipPath>
          </defs>

          <g :transform="`translate(${doc.view.x} ${doc.view.y}) scale(${doc.view.zoom})`">
            <g
              v-for="element in elements"
              :key="element.id"
              :class="`tone-${element.tone}`"
            >
              <template v-if="element.type === 'note'">
                <rect
                  class="el-note"
                  :x="element.x"
                  :y="element.y"
                  :width="element.w"
                  :height="element.h"
                  rx="10"
                />
              </template>

              <template v-else-if="element.type === 'stroke'">
                <path
                  class="el-stroke"
                  :d="strokePath(element)"
                  :stroke-width="element.size ?? 3"
                />
              </template>

              <template v-else-if="element.type === 'arrow'">
                <line
                  class="el-arrow"
                  :x1="arrowLine(element).a.x"
                  :y1="arrowLine(element).a.y"
                  :x2="arrowLine(element).b.x"
                  :y2="arrowLine(element).b.y"
                />
                <polygon class="el-arrow-head" :points="arrowHead(element)" />
              </template>

              <template v-else>
                <rect
                  v-if="element.type === 'rect'"
                  class="el-shape"
                  :x="element.x"
                  :y="element.y"
                  :width="element.w"
                  :height="element.h"
                  rx="8"
                />
                <ellipse
                  v-else-if="element.type === 'ellipse'"
                  class="el-shape"
                  :cx="element.x + element.w / 2"
                  :cy="element.y + element.h / 2"
                  :rx="element.w / 2"
                  :ry="element.h / 2"
                />
                <polygon
                  v-else-if="element.type === 'diamond'"
                  class="el-shape"
                  :points="diamondPoints(element)"
                />
              </template>

              <text
                v-if="editingId !== element.id && (linesById.get(element.id)?.length ?? 0) > 0"
                class="el-text"
                :x="textX(element)"
                :y="textY(element, linesById.get(element.id)?.length ?? 1)"
                :text-anchor="textAnchor(element)"
                :font-size="fontSize(element)"
                :clip-path="clipFor(element)"
              >
                <tspan
                  v-for="(line, index) in linesById.get(element.id) ?? []"
                  :key="index"
                  :x="textX(element)"
                  :dy="index === 0 ? 0 : fontSize(element) * LINE_HEIGHT"
                >
                  {{ line || ' ' }}
                </tspan>
              </text>

              <text
                v-if="showsPlaceholder(element)"
                class="el-placeholder"
                :x="element.x + 12"
                :y="element.y + 12 + fontSize(element) * 0.95"
                :font-size="fontSize(element)"
              >
                Type something…
              </text>
            </g>

            <g v-if="draft" :class="`tone-${draft.tone}`">
              <rect
                v-if="draft.type === 'note'"
                class="el-note draft"
                :x="draft.x"
                :y="draft.y"
                :width="draft.w"
                :height="draft.h"
                rx="10"
              />
              <rect
                v-else-if="draft.type === 'rect'"
                class="el-shape draft"
                :x="draft.x"
                :y="draft.y"
                :width="draft.w"
                :height="draft.h"
                rx="8"
              />
              <ellipse
                v-else-if="draft.type === 'ellipse'"
                class="el-shape draft"
                :cx="draft.x + draft.w / 2"
                :cy="draft.y + draft.h / 2"
                :rx="draft.w / 2"
                :ry="draft.h / 2"
              />
              <polygon
                v-else-if="draft.type === 'diamond'"
                class="el-shape draft"
                :points="diamondPoints(draft)"
              />
              <path
                v-else-if="draft.type === 'stroke'"
                class="el-stroke draft"
                :d="strokePath(draft)"
                :stroke-width="draft.size ?? 3"
              />
              <template v-else-if="draft.type === 'arrow'">
                <line
                  class="el-arrow draft"
                  :x1="arrowLine(draft).a.x"
                  :y1="arrowLine(draft).a.y"
                  :x2="arrowLine(draft).b.x"
                  :y2="arrowLine(draft).b.y"
                />
                <polygon class="el-arrow-head draft" :points="arrowHead(draft)" />
              </template>
              <text
                v-else-if="draft.type === 'text'"
                class="el-text draft"
                :x="draft.x + 4"
                :y="draft.y + 4 + fontSize(draft) * 0.95"
                :font-size="fontSize(draft)"
              >
                Text
              </text>
            </g>

            <rect
              v-if="marquee"
              class="marquee"
              :x="marquee.x"
              :y="marquee.y"
              :width="marquee.w"
              :height="marquee.h"
              :stroke-width="strokeWidthSelection"
            />

            <g v-if="selectionRect" class="selection">
              <rect
                :x="selectionRect.x"
                :y="selectionRect.y"
                :width="selectionRect.w"
                :height="selectionRect.h"
                fill="none"
                stroke="var(--accent)"
                :stroke-width="strokeWidthSelection"
              />
              <template v-if="single && single.type !== 'arrow'">
                <rect
                  v-for="mark in handleMarks"
                  :key="mark.id"
                  class="handle"
                  :x="mark.x - handleSize / 2"
                  :y="mark.y - handleSize / 2"
                  :width="handleSize"
                  :height="handleSize"
                  rx="2"
                  :stroke-width="1.5 / zoom"
                />
              </template>
              <template v-if="arrowEnds">
                <circle
                  class="handle"
                  :cx="arrowEnds.a.x"
                  :cy="arrowEnds.a.y"
                  :r="handleSize / 2"
                  :stroke-width="1.5 / zoom"
                />
                <circle
                  class="handle"
                  :cx="arrowEnds.b.x"
                  :cy="arrowEnds.b.y"
                  :r="handleSize / 2"
                  :stroke-width="1.5 / zoom"
                />
              </template>
            </g>
          </g>
        </svg>

        <textarea
          v-if="editingId && editingElement"
          ref="editor"
          v-model="editorValue"
          class="board-editor"
          :class="`tone-${editingElement.tone}`"
          :style="editorStyle"
          spellcheck="false"
          @blur="commitEditing"
          @pointerdown.stop
          @wheel.stop
        />

        <div v-if="isEmpty && tool === 'select'" class="board-empty">
          <div class="board-empty-card" @pointerdown.stop>
            <span class="board-empty-badge"><PenTool :size="20" /></span>
            <h2>Blank canvas</h2>
            <p>
              Drop a note, sketch a shape or draw freely. The board saves per workspace and never
              leaves this machine.
            </p>
            <div class="board-empty-keys">
              <span><kbd>N</kbd> note</span>
              <span><kbd>R</kbd> shape</span>
              <span><kbd>P</kbd> pen</span>
              <span><kbd>Space</kbd> pan</span>
            </div>
            <div class="board-empty-actions">
              <button class="btn primary sm" type="button" @click="selectTool('note')">
                Add a note
              </button>
              <button class="btn sm" type="button" @click="selectTool('pen')">
                Start drawing
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="board-dock">
        <button
          v-for="entry in TOOLS"
          :key="entry.id"
          class="dock-btn"
          type="button"
          :class="{ active: tool === entry.id }"
          :title="`${entry.label} (${entry.key})`"
          :aria-label="entry.label"
          :aria-pressed="tool === entry.id"
          @click="selectTool(entry.id)"
        >
          <component :is="entry.icon" :size="16" :stroke-width="1.8" />
        </button>
        <span class="dock-sep" />
        <button
          v-for="tone in TONES"
          :key="tone"
          class="tone-dot"
          type="button"
          :class="[`tone-${tone}`, { active: activeTone === tone }]"
          :title="TONE_LABEL[tone]"
          :aria-pressed="activeTone === tone"
          @click="applyTone(tone)"
        />
      </div>

      <div class="board-zoom">
        <button class="dock-btn" type="button" title="Zoom out (Ctrl+-)" @click="zoomBy(1 / 1.2)">
          <Minus :size="14" />
        </button>
        <button class="zoom-value" type="button" title="Reset to 100% (Ctrl+0)" @click="resetZoom">
          {{ zoomLabel }}
        </button>
        <button class="dock-btn" type="button" title="Zoom in (Ctrl+=)" @click="zoomBy(1.2)">
          <Plus :size="14" />
        </button>
        <span class="dock-sep" />
        <button class="dock-btn" type="button" title="Fit content (Shift+1)" @click="fitToContent">
          <Maximize :size="14" />
        </button>
      </div>

      <div class="board-hint">
        <Hand :size="12" />
        <span>Space or middle-drag to pan · Ctrl+scroll to zoom · double-click to edit</span>
      </div>

      <div ref="probeHost" class="tone-probes" aria-hidden="true">
        <span
          v-for="tone in TONES"
          :key="tone"
          class="tone-probe"
          :class="`tone-${tone}`"
          :data-tone="tone"
        >
          <i class="tone-probe-stroke" />
        </span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.board-shell {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: flex;
  flex-direction: column;
  background-color: color-mix(in srgb, var(--canvas) 88%, transparent);
  background-image:
    radial-gradient(
      80% 70% at 0% 0%,
      color-mix(in srgb, var(--accent) 14%, transparent) 0%,
      transparent 62%
    ),
    radial-gradient(
      70% 60% at 100% 0%,
      color-mix(in srgb, var(--blue) 12%, transparent) 0%,
      transparent 64%
    ),
    var(--sheen-soft);
  backdrop-filter: blur(24px) saturate(140%);
  animation: board-in 180ms var(--ease-out);
}

@keyframes board-in {
  from {
    opacity: 0;
    transform: scale(0.995);
  }
}

.board-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--canvas) 55%, transparent);
}

.board-id {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.board-badge {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hairline-strong);
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: var(--rim-top);
}

.board-name {
  min-width: 120px;
  max-width: 320px;
  padding: 4px 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text);
  font: 600 13px/1.2 var(--font-ui);
}

.board-name:hover {
  background: var(--fill-1);
}

.board-name:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--fill-1);
}

.board-meta {
  color: var(--text-faint);
  font-size: 11px;
  white-space: nowrap;
}

.board-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.board-divider {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--hairline);
}

.board-stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  touch-action: none;
  outline: none;
}

.board-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, var(--hairline-strong) 1px, transparent 1px);
  pointer-events: none;
}

.board-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.el-note {
  fill: var(--tone-fill);
  stroke: var(--tone-line);
  stroke-width: 1;
}

.el-shape {
  fill: var(--tone-fill);
  stroke: var(--tone-line);
  stroke-width: 1.5;
}

.el-text {
  fill: var(--tone-ink);
  font-family: var(--font-ui);
  font-weight: 500;
  user-select: none;
}

.el-placeholder {
  fill: var(--text-faint);
  font-family: var(--font-ui);
  font-weight: 400;
  font-style: italic;
}

.el-stroke {
  fill: none;
  stroke: var(--tone-stroke);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.el-arrow {
  stroke: var(--tone-stroke);
  stroke-width: 2;
  stroke-linecap: round;
}

.el-arrow-head {
  fill: var(--tone-stroke);
}

.draft {
  opacity: 0.72;
  stroke-dasharray: 5 4;
}

.marquee {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-dasharray: 4 3;
}

.selection .handle {
  fill: var(--surface-1);
  stroke: var(--accent);
}

.board-editor {
  position: absolute;
  z-index: 3;
  margin: 0;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--tone-fill) 92%, transparent);
  color: var(--tone-ink);
  font-family: var(--font-ui);
  font-weight: 500;
  resize: none;
  outline: none;
  overflow: hidden;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

.board-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  padding: 24px;
}

.board-empty-card {
  width: min(390px, 100%);
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--hairline-strong);
  background-color: var(--layer-solid);
  background-image: var(--sheen-soft);
  backdrop-filter: blur(26px) saturate(150%);
  box-shadow: var(--rim-top), var(--shadow-pop);
  text-align: center;
  pointer-events: auto;
}

.board-empty-badge {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--hairline-strong);
  background: var(--accent-soft);
  color: var(--accent);
}

.board-empty-card h2 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.board-empty-card p {
  margin: 0 auto 14px;
  max-width: 300px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.board-empty-keys {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 12px;
  margin-bottom: 16px;
  font-size: 11px;
  color: var(--text-faint);
}

.board-empty-keys kbd {
  margin-right: 4px;
}

.board-empty-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.board-dock,
.board-zoom {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: var(--radius-md);
  border: 1px solid var(--hairline-strong);
  background-color: var(--layer-solid);
  background-image: var(--sheen-soft);
  backdrop-filter: blur(26px) saturate(160%);
  box-shadow: var(--rim-top), var(--shadow-pop);
}

.board-dock {
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
}

.board-zoom {
  right: 18px;
  bottom: 18px;
}

.dock-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.dock-btn:hover {
  background: var(--fill-2);
  color: var(--text);
}

.dock-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.dock-sep {
  width: 1px;
  height: 20px;
  margin: 0 5px;
  background: var(--hairline);
}

.zoom-value {
  min-width: 52px;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-dim);
  font: 500 11px/1 var(--font-mono);
  cursor: pointer;
}

.zoom-value:hover {
  background: var(--fill-2);
  color: var(--text);
}

.tone-dot {
  width: 18px;
  height: 18px;
  margin: 0 2px;
  border-radius: 50%;
  border: 1px solid var(--tone-line);
  background: var(--tone-fill);
  cursor: pointer;
  transition: transform var(--dur) var(--ease);
}

.tone-dot:hover {
  transform: scale(1.12);
}

.tone-dot.active {
  box-shadow:
    0 0 0 2px var(--surface-1),
    0 0 0 4px var(--accent);
}

.board-hint {
  position: absolute;
  left: 18px;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
  color: var(--text-faint);
  font-size: 11px;
  pointer-events: none;
}

.tone-probes {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.tone-probe {
  display: block;
  width: 4px;
  height: 4px;
  border: 1px solid var(--tone-line);
  background: var(--tone-fill);
  color: var(--tone-ink);
}

.tone-probe-stroke {
  display: block;
  width: 4px;
  height: 4px;
  background: var(--tone-stroke);
}

/* Tone tokens. Each tone tints the theme surface, so it works in both
   light and dark without hard-coded hex backgrounds. Ink stays the theme
   text colour so labels keep their contrast; freehand strokes and
   connectors take the tone itself. */
.tone-slate {
  --tone-fill: color-mix(in srgb, var(--text) 7%, var(--surface-2));
  --tone-line: color-mix(in srgb, var(--text) 26%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, var(--text) 76%, transparent);
}

.tone-amber {
  --tone-fill: color-mix(in srgb, #f0b429 22%, var(--surface-2));
  --tone-line: color-mix(in srgb, #f0b429 52%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, #eab308 62%, var(--text));
}

.tone-rose {
  --tone-fill: color-mix(in srgb, #f43f5e 18%, var(--surface-2));
  --tone-line: color-mix(in srgb, #f43f5e 46%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, #f43f5e 62%, var(--text));
}

.tone-violet {
  --tone-fill: color-mix(in srgb, #8b5cf6 20%, var(--surface-2));
  --tone-line: color-mix(in srgb, #8b5cf6 48%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, #8b5cf6 60%, var(--text));
}

.tone-teal {
  --tone-fill: color-mix(in srgb, #14b8a6 20%, var(--surface-2));
  --tone-line: color-mix(in srgb, #14b8a6 48%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, #14b8a6 58%, var(--text));
}

.tone-blue {
  --tone-fill: color-mix(in srgb, #3b82f6 20%, var(--surface-2));
  --tone-line: color-mix(in srgb, #3b82f6 48%, transparent);
  --tone-ink: var(--text);
  --tone-stroke: color-mix(in srgb, #3b82f6 62%, var(--text));
}

@media (max-width: 720px) {
  .board-hint,
  .board-meta {
    display: none;
  }
}
</style>
