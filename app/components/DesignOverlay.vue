<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlignLeft,
  ArrowRight,
  Bell,
  Check,
  CheckSquare,
  ChevronRight,
  ClipboardCopy,
  Columns,
  Copy,
  CreditCard,
  Heading,
  Heart,
  Home,
  Image as ImageIcon,
  Layers,
  List,
  Maximize,
  Menu,
  Minus,
  Monitor,
  MousePointerClick,
  PanelTop,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Star,
  Tablet,
  Tag,
  TextCursorInput,
  ToggleLeft,
  Trash2,
  Type,
  Undo2,
  User,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-vue-next'
import {
  DESIGN_MAX_NODES,
  DEVICES,
  ICON_NAMES,
  NODE_LABEL,
  cloneNode,
  containsNode,
  countNodes,
  createNode,
  findNode,
  findParent,
  isContainer,
  isHorizontal,
  layoutBoard,
  nodeIndex,
  removeNode,
  type DesignBoard,
  type DesignNode,
  type DesignNodeKind,
  type DeviceId,
  type LayoutBox
} from '../lib/design'
import { setNodeProps } from '../lib/designOps'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface MoveDrag {
  mode: 'move'
  id: string
  startX: number
  startY: number
  moved: boolean
}

interface PanDrag {
  mode: 'pan'
  startX: number
  startY: number
  viewX: number
  viewY: number
}

interface ResizeDrag {
  mode: 'resize'
  id: string
  handle: HandleId
  startX: number
  startY: number
  rect: { w: number; h: number }
}

type DragState = MoveDrag | PanDrag | ResizeDrag

interface DropInfo {
  parentId: string
  index: number
  x: number
  y: number
  w: number
  h: number
}

const design = useDesign()
const ide = useIde()

const doc = design.doc
const board = computed(() => design.activeBoard.value)
const root = computed(() => board.value?.root ?? null)
const boxes = computed<LayoutBox[]>(() => (board.value ? layoutBoard(board.value) : []))
const visibleBoxes = computed(() => boxes.value.filter((box) => box.parentId !== null))
const selectedId = ref<string | null>(null)
const insertTargetId = ref<string | null>(null)
const hoverId = ref<string | null>(null)
const stage = ref<HTMLElement | null>(null)
const textField = ref<HTMLInputElement | null>(null)
const drag = ref<DragState | null>(null)
const dropInfo = ref<DropInfo | null>(null)
const zoom = computed(() => board.value?.view.zoom ?? 1)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)

const selectedBox = computed(() => boxes.value.find((box) => box.id === selectedId.value) ?? null)
const selectedNode = computed(() => (root.value && selectedId.value ? findNode(root.value, selectedId.value) : null))
const isEmpty = computed(() => (root.value?.children?.length ?? 0) === 0)
const canUndo = design.canUndo
const canRedo = design.canRedo

const ICONS: Record<string, unknown> = {
  Sparkles,
  Search,
  Bell,
  Star,
  Heart,
  Settings,
  Home,
  User,
  Plus,
  Check,
  ArrowRight,
  ChevronRight
}

const PALETTE: { group: string; items: { kind: DesignNodeKind; icon: unknown }[] }[] = [
  {
    group: 'Layout',
    items: [
      { kind: 'stack', icon: Layers },
      { kind: 'row', icon: Menu },
      { kind: 'card', icon: CreditCard },
      { kind: 'navbar', icon: PanelTop },
      { kind: 'list', icon: List }
    ]
  },
  {
    group: 'Content',
    items: [
      { kind: 'heading', icon: Heading },
      { kind: 'text', icon: Type },
      { kind: 'button', icon: MousePointerClick },
      { kind: 'input', icon: TextCursorInput },
      { kind: 'textarea', icon: AlignLeft },
      { kind: 'badge', icon: Tag },
      { kind: 'avatar', icon: User },
      { kind: 'image', icon: ImageIcon },
      { kind: 'divider', icon: Minus },
      { kind: 'checkbox', icon: CheckSquare },
      { kind: 'toggle', icon: ToggleLeft },
      { kind: 'tabs', icon: Columns },
      { kind: 'icon', icon: Sparkles },
      { kind: 'listItem', icon: Menu }
    ]
  }
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

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

const worldStyle = computed(() => {
  const view = board.value?.view
  if (!view) return {}
  return {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    transformOrigin: '0 0'
  }
})

const boardStyle = computed(() => {
  if (!board.value) return {}
  return { width: `${board.value.width}px`, height: `${board.value.height}px` }
})

const stageBgStyle = computed(() => {
  const view = board.value?.view
  const step = 24 * (view?.zoom ?? 1)
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${view?.x ?? 0}px ${view?.y ?? 0}px`
  }
})

const selectionStyle = computed(() => {
  const box = selectedBox.value
  if (!box) return {}
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    borderWidth: `${1.5 / zoom.value}px`
  }
})

const handleMarks = computed(() => {
  const box = selectedBox.value
  if (!box) return []
  const size = 9 / zoom.value
  return HANDLES.map((handle) => ({
    id: handle.id,
    x: box.x + box.w * handle.fx,
    y: box.y + box.h * handle.fy,
    size
  }))
})

function fit() {
  const el = stage.value
  const current = board.value
  if (!el || !current) return
  const pad = 56
  const scale = Math.min(
    (el.clientWidth - pad * 2) / current.width,
    (el.clientHeight - pad * 2) / current.height
  )
  const next = Math.max(0.12, Math.min(1.2, scale))
  current.view.zoom = next
  current.view.x = (el.clientWidth - current.width * next) / 2
  current.view.y = (el.clientHeight - current.height * next) / 2
}

function toWorld(clientX: number, clientY: number) {
  const el = stage.value
  const view = board.value?.view
  if (!el || !view) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom
  }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const current = board.value
  if (!current) return
  const view = current.view
  if (event.ctrlKey || event.metaKey) {
    const el = stage.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const before = { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom }
    const next = Math.min(2.5, Math.max(0.15, view.zoom * Math.exp(-event.deltaY * 0.0015)))
    view.zoom = next
    view.x = sx - before.x * next
    view.y = sy - before.y * next
    return
  }
  view.x -= event.deltaX
  view.y -= event.deltaY
}

function zoomBy(factor: number) {
  const current = board.value
  const el = stage.value
  if (!current || !el) return
  const rect = el.getBoundingClientRect()
  const sx = rect.width / 2
  const sy = rect.height / 2
  const view = current.view
  const before = { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom }
  const next = Math.min(2.5, Math.max(0.15, view.zoom * factor))
  view.zoom = next
  view.x = sx - before.x * next
  view.y = sy - before.y * next
}

function resetZoom() {
  const current = board.value
  const el = stage.value
  if (!current || !el) return
  const rect = el.getBoundingClientRect()
  const center = { x: current.width / 2, y: current.height / 2 }
  current.view.zoom = 1
  current.view.x = rect.width / 2 - center.x
  current.view.y = rect.height / 2 - center.y
}

/* ------------------------------------------------------------------ */
/* Selection and mutations                                             */
/* ------------------------------------------------------------------ */

function beginEdit() {
  design.checkpoint()
}

function select(id: string | null) {
  selectedId.value = id
  if (id) hoverId.value = null
  const screen = root.value
  if (!screen) {
    insertTargetId.value = null
    return
  }
  const node = id ? findNode(screen, id) : null
  if (!node) {
    insertTargetId.value = screen.id
    return
  }
  insertTargetId.value = isContainer(node.kind)
    ? node.id
    : findParent(screen, node.id)?.id ?? screen.id
}

function activateBoard(id: string) {
  design.setActiveBoard(id)
  selectedId.value = null
  insertTargetId.value = null
  void nextTick(fit)
}

function addComponent(kind: DesignNodeKind) {
  const current = board.value
  const screen = root.value
  if (!current || !screen) return
  if (countNodes(screen) >= DESIGN_MAX_NODES) {
    ide.notify('This board is full. Remove a few components first.', 'error')
    return
  }
  design.checkpoint()
  const target =
    (insertTargetId.value ? findNode(screen, insertTargetId.value) : null) ?? screen
  const parent = isContainer(target.kind) ? target : findParent(screen, target.id) ?? screen
  const node = createNode(kind)
  parent.children = [...(parent.children ?? []), node]
  selectedId.value = node.id
  insertTargetId.value = parent.id
  void nextTick(() => textField.value?.focus())
}

function deleteSelection() {
  const current = root.value
  const node = selectedNode.value
  if (!current || !node || node.id === current.id) return
  design.checkpoint()
  removeNode(current, node.id)
  selectedId.value = null
}

function resignIds(node: DesignNode) {
  node.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  for (const child of node.children ?? []) resignIds(child)
}

function duplicateSelection() {
  const current = root.value
  const node = selectedNode.value
  if (!current || !node || node.id === current.id) return
  const location = nodeIndex(current, node.id)
  if (!location) return
  design.checkpoint()
  const copy = cloneNode(node)
  resignIds(copy)
  const children = [...(location.parent.children ?? [])]
  children.splice(location.index + 1, 0, copy)
  location.parent.children = children
  selectedId.value = copy.id
}

function assign(key: string, event: Event) {
  const node = selectedNode.value
  if (!node) return
  const target = event.target as HTMLInputElement
  let value: unknown = target.value
  if (target.type === 'number') value = Number(target.value)
  else if (target.type === 'checkbox') value = target.checked
  if (key === 'items') {
    value = String(target.value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  setNodeProps(node, { [key]: value })
}

function assignAndCheck(key: string, event: Event) {
  design.checkpoint()
  assign(key, event)
}

function changeWidthMode(event: Event) {
  const node = selectedNode.value
  if (!node) return
  design.checkpoint()
  const mode = (event.target as HTMLSelectElement).value
  setNodeProps(node, { width: mode === 'fixed' ? 260 : (mode as 'fill' | 'hug') })
}

function changeHeightMode(event: Event) {
  const node = selectedNode.value
  if (!node) return
  design.checkpoint()
  const mode = (event.target as HTMLSelectElement).value
  setNodeProps(node, { height: mode === 'fixed' ? 160 : 'hug' })
}

const widthMode = computed(() => {
  const node = selectedNode.value
  if (!node) return 'fill'
  if (typeof node.width === 'number') return 'fixed'
  return node.width ?? 'fill'
})

const heightMode = computed(() => {
  const node = selectedNode.value
  if (!node) return 'hug'
  return typeof node.height === 'number' ? 'fixed' : 'hug'
})

const targetLabel = computed(() => {
  const screen = root.value
  const target = insertTargetId.value && screen ? findNode(screen, insertTargetId.value) : screen
  if (!target) return 'Screen'
  return target.name || NODE_LABEL[target.kind]
})

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                 */
/* ------------------------------------------------------------------ */

function onBoardPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('design-board')) {
    return
  }
  select(null)
  startPan(event)
}

function startPan(event: PointerEvent) {
  const view = board.value?.view
  if (!view) return
  drag.value = {
    mode: 'pan',
    startX: event.clientX,
    startY: event.clientY,
    viewX: view.x,
    viewY: view.y
  }
  document.body.style.cursor = 'grabbing'
}

function onStagePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  select(null)
  startPan(event)
}

function onNodePointerDown(event: PointerEvent, box: LayoutBox) {
  if (event.button !== 0) return
  const node = box.node
  if (box.parentId === null) return
  select(box.id)
  drag.value = {
    mode: 'move',
    id: box.id,
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  }
}

function onHandlePointerDown(event: PointerEvent, handle: HandleId) {
  if (event.button !== 0) return
  const box = selectedBox.value
  if (!box) return
  design.checkpoint()
  drag.value = {
    mode: 'resize',
    id: box.id,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    rect: { w: box.w, h: box.h }
  }
  event.stopPropagation()
}

function containerAt(point: { x: number; y: number }, ignore: DesignNode | null): LayoutBox | null {
  for (let i = boxes.value.length - 1; i >= 0; i--) {
    const box = boxes.value[i]
    if (!box || !isContainer(box.node.kind)) continue
    if (ignore && (box.id === ignore.id || containsNode(ignore, box.id))) continue
    if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
      return box
    }
  }
  return null
}

function computeDrop(event: PointerEvent, dragged: DesignNode): DropInfo | null {
  const point = toWorld(event.clientX, event.clientY)
  const target = containerAt(point, dragged)
  if (!target) return null
  const horizontal =
    target.node.direction === 'horizontal' ||
    target.node.kind === 'row' ||
    target.node.kind === 'navbar' ||
    isHorizontal(target.node.kind)
  const siblings = boxes.value.filter(
    (box) => box.parentId === target.id && box.id !== dragged.id
  )
  let index = 0
  for (const sibling of siblings) {
    const mid = horizontal ? sibling.x + sibling.w / 2 : sibling.y + sibling.h / 2
    const coord = horizontal ? point.x : point.y
    if (coord > mid) index++
  }
  const before = siblings[index - 1]
  const after = siblings[index]
  if (horizontal) {
    const x = after ? after.x - 4 : before ? before.x + before.w + 4 : target.x + target.w / 2
    return {
      parentId: target.id,
      index,
      x,
      y: target.y + 10,
      w: 3 / zoom.value,
      h: Math.max(12, target.h - 20)
    }
  }
  const y = after ? after.y - 4 : before ? before.y + before.h + 4 : target.y + target.h / 2
  return {
    parentId: target.id,
    index,
    x: target.x + 10,
    y,
    w: Math.max(12, target.w - 20),
    h: 3 / zoom.value
  }
}

function onPointerMove(event: PointerEvent) {
  const state = drag.value
  if (!state) return
  if (state.mode === 'pan') {
    const view = board.value?.view
    if (!view) return
    view.x = state.viewX + (event.clientX - state.startX)
    view.y = state.viewY + (event.clientY - state.startY)
    return
  }

  if (state.mode === 'move') {
    const node = root.value ? findNode(root.value, state.id) : null
    if (!node) return
    if (!state.moved) {
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
      if (distance < 4) return
      state.moved = true
    }
    dropInfo.value = computeDrop(event, node)
    return
  }

  if (state.mode === 'resize') {
    const node = root.value ? findNode(root.value, state.id) : null
    if (!node) return
    const dx = (event.clientX - state.startX) / zoom.value
    const dy = (event.clientY - state.startY) / zoom.value
    let width = state.rect.w
    let height = state.rect.h
    if (state.handle.includes('e')) width += dx
    if (state.handle.includes('w')) width -= dx
    if (state.handle.includes('s')) height += dy
    if (state.handle.includes('n')) height -= dy
    const nextWidth = Math.max(32, Math.round(width))
    node.width = nextWidth
    if (node.kind === 'avatar' || node.kind === 'icon') {
      node.height = nextWidth
    } else if (isContainer(node.kind) || ['image', 'textarea', 'text', 'heading'].includes(node.kind)) {
      node.height = Math.max(16, Math.round(height))
    }
  }
}

function onPointerUp() {
  const state = drag.value
  drag.value = null
  document.body.style.cursor = ''
  if (!state) return
  if (state.mode === 'move' && state.moved) {
    const current = root.value
    const drop = dropInfo.value
    const node = current ? findNode(current, state.id) : null
    if (current && drop && node) {
      const parent = findNode(current, drop.parentId)
      const location = nodeIndex(current, node.id)
      if (parent && location && !containsNode(node, parent.id)) {
        design.checkpoint()
        location.parent.children?.splice(location.index, 1)
        const children = [...(parent.children ?? [])]
        children.splice(Math.max(0, Math.min(children.length, drop.index)), 0, node)
        parent.children = children
        selectedId.value = node.id
      }
    }
  }
  dropInfo.value = null
}

function onNodeDoubleClick(box: LayoutBox) {
  select(box.id)
  void nextTick(() => {
    if (textField.value) {
      textField.value.focus()
      textField.value.select()
    }
  })
}

/* ------------------------------------------------------------------ */
/* Boards                                                              */
/* ------------------------------------------------------------------ */

function addBoard() {
  design.addBoard('desktop')
  selectedId.value = null
  void nextTick(fit)
}

function duplicateBoard(id: string) {
  design.duplicateBoard(id)
  selectedId.value = null
  void nextTick(fit)
}

function deleteBoard(id: string) {
  if (doc.value.boards.length <= 1) {
    ide.notify('Keep at least one board.', 'info')
    return
  }
  if (!window.confirm('Delete this board? You can undo with Ctrl+Z.')) return
  if (design.removeBoard(id)) {
    selectedId.value = null
    void nextTick(fit)
  }
}

function changeDevice(device: string) {
  const current = board.value
  if (!current) return
  if (device !== 'desktop' && device !== 'tablet' && device !== 'mobile') return
  design.checkpoint()
  const preset = DEVICES[device]
  current.device = device
  current.width = preset.width
  current.height = preset.height
  current.root.width = preset.width
  current.root.height = preset.height
  selectedId.value = null
  void nextTick(fit)
}

function changeTheme(theme: DesignBoard['theme']) {
  if (!board.value) return
  design.checkpoint()
  board.value.theme = theme
}

function deviceIcon(device: DeviceId) {
  return device === 'mobile' ? Smartphone : device === 'tablet' ? Tablet : Monitor
}

function assignBoardName(event: Event) {
  if (!board.value) return
  board.value.name = (event.target as HTMLInputElement).value.slice(0, 80)
}

const layers = computed(() => {
  const rows: { id: string; kind: DesignNodeKind; text: string; depth: number }[] = []
  const walk = (node: DesignNode, depth: number) => {
    for (const child of node.children ?? []) {
      rows.push({
        id: child.id,
        kind: child.kind,
        text: child.text || child.placeholder || child.name || NODE_LABEL[child.kind],
        depth
      })
      walk(child, depth + 1)
    }
  }
  if (root.value) walk(root.value, 0)
  return rows
})

function nodeIcon(kind: DesignNodeKind) {
  const found = PALETTE.flatMap((group) => group.items).find((item) => item.kind === kind)
  return found?.icon ?? Layers
}

function iconComponent(name: string | undefined) {
  return ICONS[name ?? ''] ?? Sparkles
}

function initials(node: DesignNode): string {
  const text = (node.text ?? node.name ?? '').trim()
  if (!text) return '•'
  return text
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function avatarStyle(node: DesignNode) {
  if (!node.src) return {}
  return { backgroundImage: `url("${node.src.replace(/"/g, '%22')}")` }
}

function imageStyle(node: DesignNode) {
  if (!node.src) return {}
  return { backgroundImage: `url("${node.src.replace(/"/g, '%22')}")` }
}

function nodeStyle(box: LayoutBox) {
  return {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    borderRadius: box.node.radius !== undefined ? `${box.node.radius}px` : undefined
  } as Record<string, string | undefined>
}

function textStyle(node: DesignNode) {
  const headings: Record<string, number> = { sm: 20, md: 28, lg: 38 }
  const texts: Record<string, number> = { sm: 13, md: 15, lg: 17 }
  const size = node.size ?? 'md'
  const isHeading = node.kind === 'heading'
  const textAlign: 'left' | 'center' | 'right' =
    node.align === 'center' ? 'center' : node.align === 'end' ? 'right' : 'left'
  return {
    fontSize: `${isHeading ? headings[size] ?? 28 : texts[size] ?? 15}px`,
    fontWeight: String(isHeading ? 650 : 400),
    lineHeight: String(isHeading ? 1.18 : 1.55),
    textAlign
  }
}

/* ------------------------------------------------------------------ */
/* Keyboard, sync, lifecycle                                           */
/* ------------------------------------------------------------------ */

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (isTyping(event.target)) {
      ;(event.target as HTMLElement).blur()
      return
    }
    if (selectedId.value) {
      selectedId.value = null
      return
    }
    close()
    return
  }
  if (isTyping(event.target)) return
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && key === 'z') {
    event.preventDefault()
    event.shiftKey ? design.redo() : design.undo()
    return
  }
  if (mod && key === 'y') {
    event.preventDefault()
    design.redo()
    return
  }
  if (mod && key === 'd') {
    event.preventDefault()
    duplicateSelection()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }
  if (event.key === '=' || event.key === '+') {
    event.preventDefault()
    zoomBy(1.15)
    return
  }
  if (event.key === '-') {
    event.preventDefault()
    zoomBy(1 / 1.15)
    return
  }
  if (event.key === '0' && mod) {
    event.preventDefault()
    resetZoom()
    return
  }
  if (event.key === '1' && event.shiftKey) {
    event.preventDefault()
    fit()
  }
}

function setInert(inert: boolean) {
  const shell = document.querySelector<HTMLElement>('.app-shell')
  if (!shell) return
  if (inert) shell.setAttribute('inert', '')
  else shell.removeAttribute('inert')
}

function close() {
  design.persistNow()
  void design.syncNow()
  design.hide()
}

async function copySpec() {
  try {
    await navigator.clipboard.writeText(design.copySpec())
    ide.notify('Design spec copied to the clipboard.', 'info')
  } catch {
    ide.notify('Could not copy the design spec.', 'error')
  }
}

const syncLabel = computed(() => {
  const state = design.sync.value.state
  if (state === 'saving') return 'Saving…'
  if (state === 'saved') return 'Workspace synced'
  if (state === 'error') return 'Sync failed'
  return 'Local only'
})

let previousFocus: HTMLElement | null = null

watch(
  () => board.value?.id,
  () => {
    selectedId.value = null
    insertTargetId.value = null
    void nextTick(fit)
  }
)

watch(
  () => design.revision.value,
  () => {
    const current = root.value
    if (selectedId.value && current && !findNode(current, selectedId.value)) selectedId.value = null
  }
)

watch(
  () => design.origin.value,
  (origin) => {
    if (origin === 'agent' && design.open.value) {
      ide.notify('The design canvas was updated by the agent.', 'info')
    }
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  setInert(true)
  design.init()
  void nextTick(() => {
    fit()
    stage.value?.focus()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  setInert(false)
  design.persistNow()
  void design.syncNow()
  document.body.style.cursor = ''
  const target = previousFocus
  previousFocus = null
  if (target?.isConnected) target.focus()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="design.open.value && board" class="design-shell" role="dialog" aria-modal="true" aria-label="Design canvas">
      <header class="design-head">
        <div class="design-brand">
          <span class="design-badge"><Sparkles :size="15" /></span>
          <div class="design-title">
            <span>Design canvas</span>
            <small>{{ board.name }} · {{ DEVICES[board.device].label }}</small>
          </div>
        </div>

        <div class="design-actions">
          <button class="ds-icon" type="button" :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="design.undo()">
            <Undo2 :size="14" />
          </button>
          <button class="ds-icon" type="button" :disabled="!canRedo" title="Redo (Ctrl+Shift+Z)" @click="design.redo()">
            <Redo2 :size="14" />
          </button>
          <span class="ds-sep" />
          <button class="ds-icon" type="button" title="Copy the design spec" @click="copySpec">
            <ClipboardCopy :size="14" />
          </button>
          <button class="ds-icon" type="button" title="Sync .kodra/design now" @click="design.syncNow()">
            <RefreshCw :size="14" :class="{ spinning: design.sync.value.state === 'saving' }" />
          </button>
          <span class="sync-chip" :data-state="design.sync.value.state" :title="design.sync.value.message || syncLabel">
            {{ syncLabel }}
          </span>
          <span class="ds-sep" />
          <button class="ds-icon" type="button" title="Close (Esc)" @click="close">
            <X :size="15" />
          </button>
        </div>
      </header>

      <div class="design-body">
        <aside class="design-rail" aria-label="Boards">
          <div class="rail-head">
            <span>Boards</span>
            <button class="ds-icon sm" type="button" title="New board" @click="addBoard">
              <Plus :size="14" />
            </button>
          </div>
          <div class="rail-list">
            <div
              v-for="entry in doc.boards"
              :key="entry.id"
              class="rail-item"
              :class="{ active: entry.id === board.id }"
            >
              <button class="rail-main" type="button" @click="activateBoard(entry.id)">
                <component :is="deviceIcon(entry.device)" :size="14" />
                <span class="rail-name">{{ entry.name }}</span>
                <small>{{ countNodes(entry.root) - 1 }}</small>
              </button>
              <div class="rail-tools">
                <button class="ds-icon xs" type="button" title="Duplicate board" @click.stop="duplicateBoard(entry.id)">
                  <Copy :size="12" />
                </button>
                <button class="ds-icon xs" type="button" title="Delete board" @click.stop="deleteBoard(entry.id)">
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
          <div class="rail-foot">
            <p>Every board is a screen. The agent reads this tree through <code>read_design</code>.</p>
          </div>
        </aside>

        <main
          ref="stage"
          class="design-stage"
          :style="stageBgStyle"
          tabindex="0"
          @pointerdown="onStagePointerDown"
          @wheel="onWheel"
          @contextmenu.prevent
        >
          <div class="design-world" :style="worldStyle">
            <div
              class="design-board"
              :data-theme="board.theme"
              :style="boardStyle"
              @pointerdown.stop="onBoardPointerDown"
            >
              <div
                v-for="box in visibleBoxes"
                :key="box.id"
                class="dnode"
                :class="[
                  `k-${box.node.kind}`,
                  box.node.tone ? `tone-${box.node.tone}` : '',
                  box.node.variant ? `variant-${box.node.variant}` : '',
                  { selected: selectedId === box.id, hovered: hoverId === box.id }
                ]"
                :style="nodeStyle(box)"
                @pointerdown.stop="onNodePointerDown($event, box)"
                @pointerenter="hoverId = box.id"
                @pointerleave="hoverId === box.id && (hoverId = null)"
                @dblclick.stop="onNodeDoubleClick(box)"
              >
                <template v-if="box.node.kind === 'heading' || box.node.kind === 'text'">
                  <span class="node-text" :style="textStyle(box.node)">{{ box.node.text }}</span>
                </template>

                <template v-else-if="box.node.kind === 'button'">
                  <span>{{ box.node.text }}</span>
                </template>

                <template v-else-if="box.node.kind === 'input'">
                  <span class="node-muted">{{ box.node.placeholder }}</span>
                </template>

                <template v-else-if="box.node.kind === 'textarea'">
                  <span class="node-muted node-top">{{ box.node.placeholder }}</span>
                </template>

                <template v-else-if="box.node.kind === 'badge'">
                  <span>{{ box.node.text }}</span>
                </template>

                <template v-else-if="box.node.kind === 'avatar'">
                  <span class="avatar" :style="avatarStyle(box.node)">{{ initials(box.node) }}</span>
                </template>

                <template v-else-if="box.node.kind === 'image'">
                  <span v-if="!box.node.src" class="image-empty"><ImageIcon :size="22" /></span>
                  <span v-else class="image-fill" :style="imageStyle(box.node)" />
                </template>

                <template v-else-if="box.node.kind === 'divider'">
                  <span class="divider" />
                </template>

                <template v-else-if="box.node.kind === 'checkbox'">
                  <span class="check-box" :class="{ on: box.node.checked }">
                    <Check v-if="box.node.checked" :size="12" :stroke-width="3" />
                  </span>
                  <span class="check-label">{{ box.node.text }}</span>
                </template>

                <template v-else-if="box.node.kind === 'toggle'">
                  <span class="toggle-track" :class="{ on: box.node.checked }">
                    <span class="toggle-knob" />
                  </span>
                  <span class="check-label">{{ box.node.text }}</span>
                </template>

                <template v-else-if="box.node.kind === 'tabs'">
                  <span
                    v-for="(item, index) in box.node.items ?? []"
                    :key="index"
                    class="tab"
                    :class="{ active: (box.node.activeTab ?? 0) === index }"
                  >
                    {{ item }}
                  </span>
                </template>

                <template v-else-if="box.node.kind === 'listItem'">
                  <span class="li-avatar">{{ initials(box.node) }}</span>
                  <span class="li-body">
                    <span class="li-title">{{ box.node.text }}</span>
                    <span v-if="box.node.subtitle" class="li-sub">{{ box.node.subtitle }}</span>
                  </span>
                  <ChevronRight class="li-chevron" :size="16" />
                </template>

                <template v-else-if="box.node.kind === 'icon'">
                  <component :is="iconComponent(box.node.icon)" :size="box.w" :stroke-width="1.8" />
                </template>

                <template v-else-if="box.node.kind === 'frame'">
                  <span class="frame-tag">{{ box.node.name || 'Frame' }}</span>
                </template>
              </div>

              <div v-if="selectedBox" class="selection" :style="selectionStyle" />
              <span
                v-for="mark in handleMarks"
                :key="mark.id"
                class="handle"
                :data-handle="mark.id"
                :style="{
                  left: `${mark.x}px`,
                  top: `${mark.y}px`,
                  width: `${mark.size}px`,
                  height: `${mark.size}px`,
                  transform: 'translate(-50%, -50%)',
                  borderWidth: `${1 / zoom}px`
                }"
                @pointerdown.stop="onHandlePointerDown($event, mark.id)"
              />

              <div
                v-if="dropInfo"
                class="drop-line"
                :style="{
                  left: `${dropInfo.x}px`,
                  top: `${dropInfo.y}px`,
                  width: `${dropInfo.w}px`,
                  height: `${dropInfo.h}px`
                }"
              />

              <div v-if="isEmpty" class="board-empty" @pointerdown.stop>
                <div class="board-empty-card">
                  <span class="board-empty-badge"><Layers :size="20" /></span>
                  <h2>Start a screen</h2>
                  <p>Add components from the right panel, or ask the agent to outline a layout with <code>write_design</code>.</p>
                  <div class="board-empty-actions">
                    <button class="btn primary sm" type="button" @click="addComponent('navbar')">Add a navbar</button>
                    <button class="btn sm" type="button" @click="addComponent('heading')">Add a heading</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="stage-zoom">
            <button class="ds-icon" type="button" title="Zoom out (Ctrl+-)" @click="zoomBy(1 / 1.15)">
              <ZoomOut :size="14" />
            </button>
            <button class="zoom-value" type="button" title="Reset to 100%" @click="resetZoom">{{ zoomLabel }}</button>
            <button class="ds-icon" type="button" title="Zoom in (Ctrl+=)" @click="zoomBy(1.15)">
              <ZoomIn :size="14" />
            </button>
            <span class="ds-sep" />
            <button class="ds-icon" type="button" title="Fit screen (Shift+1)" @click="fit">
              <Maximize :size="14" />
            </button>
          </div>

          <div class="stage-hint">
            <MousePointerClick :size="12" />
            <span>Drag a component to reorder · scroll to pan · Ctrl+scroll to zoom</span>
          </div>
        </main>

        <aside class="design-side" aria-label="Components and properties">
          <section class="side-block">
            <header class="side-head">
              <span>Screen</span>
              <small>{{ board.width }}×{{ board.height }}</small>
            </header>
            <label class="field">
              <span>Name</span>
              <input :value="board.name" maxlength="80" @focus="beginEdit" @input="assignBoardName" />
            </label>
            <div class="field">
              <span>Device</span>
              <div class="seg">
                <button
                  v-for="(preset, id) in DEVICES"
                  :key="id"
                  type="button"
                  :class="{ active: board.device === id }"
                  :title="preset.label"
                  @click="changeDevice(id)"
                >
                  <component :is="deviceIcon(id as DeviceId)" :size="13" />
                  <span>{{ preset.label }}</span>
                </button>
              </div>
            </div>
            <div class="field">
              <span>Theme</span>
              <div class="seg">
                <button type="button" :class="{ active: board.theme === 'light' }" @click="changeTheme('light')">Light</button>
                <button type="button" :class="{ active: board.theme === 'dark' }" @click="changeTheme('dark')">Dark</button>
              </div>
            </div>
          </section>

          <section class="side-block">
            <header class="side-head">
              <span>Insert</span>
              <small>into {{ targetLabel }}</small>
            </header>
            <div v-for="group in PALETTE" :key="group.group" class="palette-group">
              <span class="palette-title">{{ group.group }}</span>
              <div class="palette-grid">
                <button
                  v-for="item in group.items"
                  :key="item.kind"
                  class="palette-btn"
                  type="button"
                  :title="`Add ${NODE_LABEL[item.kind]}`"
                  @click="addComponent(item.kind)"
                >
                  <component :is="item.icon" :size="15" :stroke-width="1.7" />
                  <span>{{ NODE_LABEL[item.kind] }}</span>
                </button>
              </div>
            </div>
          </section>

          <section v-if="layers.length" class="side-block">
            <header class="side-head">
              <span>Layers</span>
              <small>{{ layers.length }}</small>
            </header>
            <div class="layer-list">
              <button
                v-for="layer in layers"
                :key="layer.id"
                class="layer-row"
                :class="{ active: layer.id === selectedId }"
                type="button"
                :style="{ paddingLeft: `${8 + layer.depth * 12}px` }"
                @click="select(layer.id)"
                @pointerenter="hoverId = layer.id"
                @pointerleave="hoverId === layer.id && (hoverId = null)"
              >
                <component :is="nodeIcon(layer.kind)" :size="12" />
                <span>{{ layer.text }}</span>
              </button>
            </div>
          </section>

          <section class="side-block grow">
            <header class="side-head">
              <span>Properties</span>
              <small v-if="selectedNode">{{ NODE_LABEL[selectedNode.kind] }}</small>
            </header>

            <template v-if="selectedNode">
              <label class="field">
                <span>Layer name</span>
                <input :value="selectedNode.name ?? ''" placeholder="Optional label for the agent" @focus="beginEdit" @input="assign('name', $event)" />
              </label>

              <label v-if="['heading', 'text', 'button', 'badge', 'listItem', 'checkbox', 'toggle'].includes(selectedNode.kind)" class="field">
                <span>Text</span>
                <input ref="textField" :value="selectedNode.text ?? ''" @focus="beginEdit" @input="assign('text', $event)" />
              </label>

              <label v-if="selectedNode.kind === 'listItem'" class="field">
                <span>Subtitle</span>
                <input :value="selectedNode.subtitle ?? ''" @focus="beginEdit" @input="assign('subtitle', $event)" />
              </label>

              <label v-if="selectedNode.kind === 'input' || selectedNode.kind === 'textarea'" class="field">
                <span>Placeholder</span>
                <input :value="selectedNode.placeholder ?? ''" @focus="beginEdit" @input="assign('placeholder', $event)" />
              </label>

              <label v-if="selectedNode.kind === 'image' || selectedNode.kind === 'avatar'" class="field">
                <span>Image URL</span>
                <input :value="selectedNode.src ?? ''" placeholder="https://…" @focus="beginEdit" @input="assign('src', $event)" />
              </label>

              <label v-if="selectedNode.kind === 'tabs'" class="field">
                <span>Labels (comma separated)</span>
                <input :value="(selectedNode.items ?? []).join(', ')" @focus="beginEdit" @input="assign('items', $event)" />
              </label>

              <div v-if="selectedNode.kind === 'tabs'" class="field-row">
                <label class="field">
                  <span>Active tab</span>
                  <input type="number" min="0" :value="selectedNode.activeTab ?? 0" @focus="beginEdit" @change="assignAndCheck('activeTab', $event)" />
                </label>
              </div>

              <div v-if="selectedNode.kind === 'icon'" class="field">
                <span>Icon</span>
                <select :value="selectedNode.icon ?? 'Sparkles'" @change="assignAndCheck('icon', $event)">
                  <option v-for="name in ICON_NAMES" :key="name" :value="name">{{ name }}</option>
                </select>
              </div>

              <div class="field-row">
                <label v-if="['heading', 'text', 'button', 'tabs'].includes(selectedNode.kind)" class="field">
                  <span>Size</span>
                  <select :value="selectedNode.size ?? 'md'" @change="assignAndCheck('size', $event)">
                    <option value="sm">Small</option>
                    <option value="md">Medium</option>
                    <option value="lg">Large</option>
                  </select>
                </label>
                <label v-if="selectedNode.kind === 'button'" class="field">
                  <span>Variant</span>
                  <select :value="selectedNode.variant ?? 'primary'" @change="assignAndCheck('variant', $event)">
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="ghost">Ghost</option>
                    <option value="danger">Danger</option>
                  </select>
                </label>
                <label v-if="selectedNode.kind === 'badge'" class="field">
                  <span>Tone</span>
                  <select :value="selectedNode.tone ?? 'accent'" @change="assignAndCheck('tone', $event)">
                    <option value="accent">Accent</option>
                    <option value="slate">Neutral</option>
                    <option value="green">Green</option>
                    <option value="red">Red</option>
                    <option value="blue">Blue</option>
                    <option value="purple">Purple</option>
                  </select>
                </label>
                <label v-if="selectedNode.kind === 'checkbox' || selectedNode.kind === 'toggle'" class="field check-field">
                  <span>Checked</span>
                  <input type="checkbox" :checked="!!selectedNode.checked" @change="assignAndCheck('checked', $event)" />
                </label>
              </div>

              <div class="field-row">
                <label class="field">
                  <span>Width</span>
                  <select :value="widthMode" @change="changeWidthMode">
                    <option value="fill">Fill</option>
                    <option value="hug">Hug</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </label>
                <label v-if="widthMode === 'fixed'" class="field narrow">
                  <span>px</span>
                  <input type="number" min="24" :value="typeof selectedNode.width === 'number' ? selectedNode.width : 260" @focus="beginEdit" @change="assignAndCheck('width', $event)" />
                </label>
                <label v-if="['image', 'textarea', 'text', 'heading', 'frame', 'stack', 'row', 'card', 'navbar', 'list'].includes(selectedNode.kind)" class="field">
                  <span>Height</span>
                  <select :value="heightMode" @change="changeHeightMode">
                    <option value="hug">Hug</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </label>
                <label v-if="heightMode === 'fixed'" class="field narrow">
                  <span>px</span>
                  <input type="number" min="16" :value="typeof selectedNode.height === 'number' ? selectedNode.height : 160" @focus="beginEdit" @change="assignAndCheck('height', $event)" />
                </label>
              </div>

              <template v-if="isContainer(selectedNode.kind)">
                <div class="field-row">
                  <label v-if="selectedNode.kind !== 'list'" class="field">
                    <span>Direction</span>
                    <select :value="selectedNode.direction ?? (selectedNode.kind === 'row' || selectedNode.kind === 'navbar' ? 'horizontal' : 'vertical')" @change="assignAndCheck('direction', $event)">
                      <option value="vertical">Vertical</option>
                      <option value="horizontal">Horizontal</option>
                    </select>
                  </label>
                  <label class="field narrow">
                    <span>Gap</span>
                    <input type="number" min="0" :value="selectedNode.gap ?? 12" @focus="beginEdit" @change="assignAndCheck('gap', $event)" />
                  </label>
                  <label class="field narrow">
                    <span>Pad</span>
                    <input type="number" min="0" :value="selectedNode.padding ?? 16" @focus="beginEdit" @change="assignAndCheck('padding', $event)" />
                  </label>
                </div>
                <div class="field-row">
                  <label class="field narrow">
                    <span>Radius</span>
                    <input type="number" min="0" max="80" :value="selectedNode.radius ?? 0" @focus="beginEdit" @change="assignAndCheck('radius', $event)" />
                  </label>
                  <label class="field">
                    <span>Align</span>
                    <select :value="selectedNode.align ?? 'start'" @change="assignAndCheck('align', $event)">
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Justify</span>
                    <select :value="selectedNode.justify ?? 'start'" @change="assignAndCheck('justify', $event)">
                      <option value="start">Start</option>
                      <option value="center">Center</option>
                      <option value="end">End</option>
                      <option value="between">Between</option>
                    </select>
                  </label>
                </div>
              </template>

              <div class="prop-actions">
                <button class="btn sm" type="button" :disabled="selectedNode.id === root?.id" @click="duplicateSelection">
                  <Copy :size="13" /> Duplicate
                </button>
                <button class="btn sm danger" type="button" :disabled="selectedNode.id === root?.id" @click="deleteSelection">
                  <Trash2 :size="13" /> Delete
                </button>
              </div>
            </template>

            <p v-else class="side-empty">Select a component on the canvas or in Layers to edit its properties.</p>
          </section>
        </aside>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.design-shell {
  position: fixed;
  inset: 0;
  z-index: 232;
  display: flex;
  flex-direction: column;
  background-color: color-mix(in srgb, var(--canvas) 90%, transparent);
  background-image:
    radial-gradient(70% 60% at 0% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 62%),
    radial-gradient(60% 50% at 100% 0%, color-mix(in srgb, var(--blue) 10%, transparent), transparent 64%);
  backdrop-filter: blur(24px) saturate(140%);
  animation: design-in 180ms var(--ease-out);
}

@keyframes design-in {
  from {
    opacity: 0;
    transform: scale(0.996);
  }
}

.design-head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--canvas) 55%, transparent);
}

.design-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.design-badge {
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

.design-title {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.design-title > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.design-title small {
  font-size: 10.5px;
  color: var(--text-faint);
}

.design-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.ds-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}

.ds-icon:hover:not(:disabled) {
  background: var(--fill-2);
  color: var(--text);
}

.ds-icon:disabled {
  opacity: 0.4;
  cursor: default;
}

.ds-icon.sm {
  width: 24px;
  height: 24px;
}

.ds-icon.xs {
  width: 20px;
  height: 20px;
}

.ds-icon.xs svg {
  opacity: 0.75;
}

.ds-sep {
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--hairline);
}

.sync-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--fill-1);
  color: var(--text-faint);
  font-size: 10.5px;
  white-space: nowrap;
}

.sync-chip[data-state='saved'] {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 34%, transparent);
  background: color-mix(in srgb, var(--green) 10%, transparent);
}

.sync-chip[data-state='error'] {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 34%, transparent);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.design-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.design-rail {
  display: flex;
  flex-direction: column;
  width: 208px;
  min-width: 208px;
  border-right: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-1) 52%, transparent);
}

.rail-head,
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rail-head small,
.side-head small {
  color: var(--text-faint);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.rail-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 6px 10px;
}

.rail-item {
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

.rail-item:hover {
  background: var(--fill-1);
}

.rail-item.active {
  border-color: var(--hairline-strong);
  background: var(--fill-2);
}

.rail-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 8px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font: 500 12px/1.2 var(--font-ui);
  text-align: left;
  cursor: pointer;
}

.rail-item.active .rail-main {
  color: var(--text);
}

.rail-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-main small {
  color: var(--text-faint);
  font-size: 10px;
}

.rail-tools {
  display: none;
  align-items: center;
  gap: 1px;
  padding-right: 4px;
}

.rail-item:hover .rail-tools {
  display: flex;
}

.rail-foot {
  padding: 10px 12px;
  border-top: 1px solid var(--hairline);
}

.rail-foot p {
  margin: 0;
  color: var(--text-faint);
  font-size: 10.5px;
  line-height: 1.5;
}

.rail-foot code {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.design-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  outline: none;
  background-image: radial-gradient(circle, var(--hairline-strong) 1px, transparent 1px);
  touch-action: none;
  cursor: grab;
}

.design-stage:active {
  cursor: grabbing;
}

.design-world {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.design-board {
  position: relative;
  pointer-events: auto;
  overflow: hidden;
  border-radius: 8px;
  background: var(--d-bg);
  color: var(--d-text);
  font-family: var(--font-ui);
  box-shadow:
    0 40px 90px -34px #00000099,
    0 0 0 1px #00000026;
  --d-bg: #ffffff;
  --d-surface: #f6f7f9;
  --d-surface-2: #eceef2;
  --d-text: #18181b;
  --d-muted: #6b7280;
  --d-border: #e3e5ea;
  --d-accent: #d4a73c;
  --d-accent-ink: #231a00;
  --d-green: #2f9e6b;
  --d-red: #d9535a;
  --d-blue: #3b82f6;
  --d-purple: #8b5cf6;
}

.design-board[data-theme='dark'] {
  --d-bg: #101216;
  --d-surface: #171a20;
  --d-surface-2: #1e222a;
  --d-text: #f2f3f5;
  --d-muted: #9aa1ad;
  --d-border: #272c36;
  --d-accent: #f0c24b;
  --d-accent-ink: #1d1600;
  --d-green: #3ecf8e;
  --d-red: #ff6b70;
  --d-blue: #6aa8ff;
  --d-purple: #b18cff;
}

.dnode {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--d-text);
}

.dnode.hovered {
  outline: 1px dashed color-mix(in srgb, var(--d-accent) 70%, transparent);
  outline-offset: -1px;
}

.k-heading,
.k-text {
  display: flex;
  align-items: flex-start;
}

.node-text {
  display: block;
  width: 100%;
  white-space: pre-wrap;
  overflow: hidden;
}

.k-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border-radius: 10px;
  background: var(--d-accent);
  color: var(--d-accent-ink);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.k-button.variant-secondary {
  background: var(--d-bg);
  color: var(--d-text);
  border: 1px solid var(--d-border);
}

.k-button.variant-ghost {
  background: transparent;
  color: var(--d-text);
}

.k-button.variant-danger {
  background: var(--d-red);
  color: #ffffff;
}

.k-input,
.k-textarea {
  display: flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid var(--d-border);
  border-radius: 10px;
  background: var(--d-bg);
  color: var(--d-muted);
  font-size: 14px;
}

.k-textarea {
  align-items: flex-start;
  padding: 12px 14px;
}

.node-muted {
  color: var(--d-muted);
  font-size: 14px;
}

.node-top {
  align-self: flex-start;
}

.k-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--d-accent) 18%, var(--d-bg));
  color: color-mix(in srgb, var(--d-accent) 70%, var(--d-text));
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tone-green {
  background: color-mix(in srgb, var(--d-green) 16%, var(--d-bg));
  color: var(--d-green);
}

.tone-red {
  background: color-mix(in srgb, var(--d-red) 16%, var(--d-bg));
  color: var(--d-red);
}

.tone-blue {
  background: color-mix(in srgb, var(--d-blue) 16%, var(--d-bg));
  color: var(--d-blue);
}

.tone-purple {
  background: color-mix(in srgb, var(--d-purple) 16%, var(--d-bg));
  color: var(--d-purple);
}

.tone-slate {
  background: var(--d-surface-2);
  color: var(--d-muted);
}

.k-avatar {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--d-surface-2);
  background-size: cover;
  background-position: center;
  color: var(--d-muted);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
}

.avatar {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
}

.k-image {
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--d-surface-2), var(--d-surface));
  border: 1px solid var(--d-border);
  color: var(--d-muted);
  overflow: hidden;
}

.image-fill {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
}

.k-divider {
  display: flex;
  align-items: center;
}

.divider {
  width: 100%;
  height: 1px;
  background: var(--d-border);
}

.k-checkbox,
.k-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--d-text);
  white-space: nowrap;
}

.check-box {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--d-border);
  background: var(--d-bg);
  color: var(--d-accent-ink);
  flex: none;
}

.check-box.on {
  background: var(--d-accent);
  border-color: var(--d-accent);
}

.toggle-track {
  position: relative;
  width: 36px;
  height: 21px;
  border-radius: 999px;
  background: var(--d-surface-2);
  border: 1px solid var(--d-border);
  flex: none;
}

.toggle-track.on {
  background: var(--d-accent);
  border-color: var(--d-accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--d-bg);
  box-shadow: 0 1px 2px #00000033;
  transition: transform 0.15s ease;
}

.toggle-track.on .toggle-knob {
  transform: translateX(15px);
}

.k-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  border-bottom: 1px solid var(--d-border);
}

.tab {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  color: var(--d-muted);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab.active {
  color: var(--d-text);
  border-bottom-color: var(--d-accent);
}

.k-listItem {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--d-border);
  background: var(--d-surface);
  color: var(--d-text);
}

.li-avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--d-surface-2);
  color: var(--d-muted);
  font-size: 11px;
  font-weight: 600;
  flex: none;
}

.li-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.li-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--d-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.li-sub {
  font-size: 12px;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.li-chevron {
  color: var(--d-muted);
  flex: none;
}

.k-icon {
  display: grid;
  place-items: center;
  color: var(--d-text);
}

.k-stack,
.k-row {
  background: transparent;
}

.k-card {
  background: var(--d-surface);
  border: 1px solid var(--d-border);
}

.k-navbar {
  display: flex;
  background: var(--d-bg);
  border-bottom: 1px solid var(--d-border);
}

.k-list {
  background: var(--d-surface);
  border: 1px solid var(--d-border);
}

.k-frame {
  background: transparent;
}

.frame-tag {
  position: absolute;
  top: 6px;
  left: 8px;
  color: var(--d-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.selection {
  position: absolute;
  border: 1.5px solid var(--accent);
  pointer-events: none;
  z-index: 5;
}

.handle {
  position: absolute;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--surface-1);
  pointer-events: auto;
  cursor: pointer;
}

.drop-line {
  position: absolute;
  z-index: 6;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  pointer-events: none;
}

.board-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: none;
}

.board-empty-card {
  width: min(380px, 100%);
  padding: 24px;
  border-radius: 18px;
  border: 1px solid var(--d-border);
  background: var(--d-surface);
  text-align: center;
  pointer-events: auto;
}

.board-empty-badge {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--d-accent) 18%, var(--d-surface));
  color: color-mix(in srgb, var(--d-accent) 70%, var(--d-text));
}

.board-empty-card h2 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--d-text);
}

.board-empty-card p {
  margin: 0 auto 14px;
  max-width: 300px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--d-muted);
}

.board-empty-card code {
  font-family: var(--font-mono);
  font-size: 11px;
}

.board-empty-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.stage-zoom {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--hairline-strong);
  background-color: var(--layer-solid);
  background-image: var(--sheen-soft);
  backdrop-filter: blur(26px) saturate(160%);
  box-shadow: var(--rim-top), var(--shadow-pop);
}

.zoom-value {
  min-width: 50px;
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

.stage-hint {
  position: absolute;
  left: 16px;
  bottom: 16px;
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

.design-side {
  display: flex;
  flex-direction: column;
  width: 276px;
  min-width: 276px;
  overflow-y: auto;
  border-left: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-1) 52%, transparent);
}

.side-block {
  padding: 0 12px 12px;
  border-bottom: 1px solid var(--hairline);
}

.side-block.grow {
  flex: 1;
  border-bottom: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  min-width: 0;
  flex: 1;
}

.field > span {
  color: var(--text-faint);
  font-size: 10px;
  letter-spacing: 0.02em;
}

.field input,
.field select {
  width: 100%;
  height: 27px;
  padding: 0 7px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-xs);
  background: var(--fill-1);
  color: var(--text);
  font: 12px/1 var(--font-ui);
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: var(--accent);
  background: var(--fill-2);
}

.field.check-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.field.check-field input {
  width: 16px;
  height: 16px;
}

.field.narrow {
  flex: 0 0 62px;
}

.field-row {
  display: flex;
  gap: 8px;
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--hairline);
  background: var(--fill-1);
}

.seg button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  height: 22px;
  padding: 0 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-faint);
  font: 11px/1 var(--font-ui);
  cursor: pointer;
  white-space: nowrap;
}

.seg button.active {
  background: var(--fill-3);
  color: var(--text);
}

.palette-group {
  margin-bottom: 8px;
}

.palette-title {
  display: block;
  margin-bottom: 4px;
  color: var(--text-faint);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.palette-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.palette-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-xs);
  background: var(--fill-1);
  color: var(--text-dim);
  font: 11px/1 var(--font-ui);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.palette-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-btn:hover {
  border-color: var(--hairline-strong);
  background: var(--fill-2);
  color: var(--text);
}

.layer-list {
  max-height: 190px;
  overflow-y: auto;
  padding: 2px 0;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 25px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: 11px/1 var(--font-ui);
  text-align: left;
  cursor: pointer;
}

.layer-row span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-row:hover {
  background: var(--fill-1);
  color: var(--text);
}

.layer-row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.prop-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.prop-actions .btn {
  flex: 1;
  justify-content: center;
}

.side-empty {
  margin: 6px 0 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 1080px) {
  .design-rail {
    width: 176px;
    min-width: 176px;
  }

  .design-side {
    width: 246px;
    min-width: 246px;
  }

  .stage-hint {
    display: none;
  }
}
</style>
