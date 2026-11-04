/**
 * Operations the agent can apply to the design document through `write_design`.
 * Every operation validates its input and reports what changed, so the tool
 * result can double as a readable changelog.
 */

import {
  CONTAINER_KINDS,
  DESIGN_MAX_NODES,
  DEVICES,
  NODE_LABEL,
  createBoard,
  createNode,
  findNode,
  findParent,
  isContainer,
  nodeIndex,
  removeNode,
  containsNode,
  cloneNode,
  type DesignBoard,
  type DesignDocument,
  type DesignNode,
  type DesignNodeKind,
  type DesignSize,
  type DesignTone,
  type DesignVariant,
  type DeviceId,
  type WidthMode
} from './design'

const KINDS: DesignNodeKind[] = [
  'frame',
  'stack',
  'row',
  'card',
  'navbar',
  'list',
  'listItem',
  'heading',
  'text',
  'button',
  'input',
  'textarea',
  'badge',
  'avatar',
  'image',
  'divider',
  'checkbox',
  'toggle',
  'tabs',
  'icon'
]

const SIZES: DesignSize[] = ['sm', 'md', 'lg']
const VARIANTS: DesignVariant[] = ['primary', 'secondary', 'ghost', 'danger']
const TONES: DesignTone[] = ['slate', 'accent', 'green', 'red', 'blue', 'purple']

export interface DesignOpResult {
  changed: boolean
  log: string[]
}

function str(value: unknown, max = 400): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

function resolveBoard(doc: DesignDocument, ref: unknown): DesignBoard | null {
  if (typeof ref === 'string' && ref.trim()) {
    const needle = ref.trim().toLowerCase()
    return (
      doc.boards.find((board) => board.id === ref) ??
      doc.boards.find((board) => board.name.toLowerCase() === needle) ??
      null
    )
  }
  return doc.boards.find((board) => board.id === doc.activeBoardId) ?? doc.boards[0] ?? null
}

function flatten(root: DesignNode, out: DesignNode[] = []): DesignNode[] {
  out.push(root)
  for (const child of root.children ?? []) flatten(child, out)
  return out
}

/**
 * Resolve a node reference from the agent. Ids are exact; names, visible text
 * and a unique component label ("Card", "List") are accepted as a convenience
 * so a freshly created tree can be edited without another round trip.
 */
function resolveNode(board: DesignBoard, ref: unknown): DesignNode | null {
  if (typeof ref !== 'string' || !ref.trim()) return null
  const needle = ref.trim()
  const byId = findNode(board.root, needle)
  if (byId) return byId

  const nodes = flatten(board.root)
  const lower = needle.toLowerCase()
  const byName = nodes.filter((node) => node.name?.toLowerCase() === lower)
  if (byName.length) return byName[0]!
  const byText = nodes.filter((node) => node.text?.trim().toLowerCase() === lower)
  if (byText.length) return byText[0]!
  const byLabel = nodes.filter((node) => NODE_LABEL[node.kind].toLowerCase() === lower)
  if (byLabel.length === 1) return byLabel[0]!
  const byPartial = nodes.filter((node) => node.text?.toLowerCase().includes(lower))
  if (byPartial.length === 1) return byPartial[0]!
  return null
}

/** Apply a plain property bag to a node, rejecting unknown or invalid values. */
export function setNodeProps(node: DesignNode, props: Record<string, unknown>): string[] {
  const applied: string[] = []
  const set = (key: string, value: unknown) => {
    ;(node as unknown as Record<string, unknown>)[key] = value
    applied.push(key)
  }

  for (const [key, value] of Object.entries(props)) {
    switch (key) {
      case 'name': {
        const text = str(value, 80)
        if (text !== null) set('name', text)
        break
      }
      case 'text': {
        const text = str(value, 800)
        if (text !== null) set('text', text)
        break
      }
      case 'subtitle': {
        const text = str(value, 400)
        if (text !== null) set('subtitle', text)
        break
      }
      case 'placeholder': {
        const text = str(value, 200)
        if (text !== null) set('placeholder', text)
        break
      }
      case 'src': {
        const text = str(value, 2000)
        if (text !== null) set('src', text)
        break
      }
      case 'size': {
        if (typeof value === 'string' && (SIZES as string[]).includes(value)) set('size', value)
        break
      }
      case 'variant': {
        if (typeof value === 'string' && (VARIANTS as string[]).includes(value)) set('variant', value)
        break
      }
      case 'tone': {
        if (typeof value === 'string' && (TONES as string[]).includes(value)) set('tone', value)
        break
      }
      case 'direction': {
        if (value === 'vertical' || value === 'horizontal') set('direction', value)
        break
      }
      case 'align': {
        if (value === 'start' || value === 'center' || value === 'end') set('align', value)
        break
      }
      case 'justify': {
        if (value === 'start' || value === 'center' || value === 'end' || value === 'between') {
          set('justify', value)
        }
        break
      }
      case 'gap': {
        const n = num(value, 0, 200)
        if (n !== null) set('gap', n)
        break
      }
      case 'padding': {
        const n = num(value, 0, 200)
        if (n !== null) set('padding', n)
        break
      }
      case 'radius': {
        const n = num(value, 0, 200)
        if (n !== null) set('radius', n)
        break
      }
      case 'width': {
        if (value === 'fill' || value === 'hug') set('width', value as WidthMode)
        else {
          const n = num(value, 24, 4000)
          if (n !== null) set('width', n)
        }
        break
      }
      case 'height': {
        if (value === 'hug') set('height', 'hug')
        else {
          const n = num(value, 1, 4000)
          if (n !== null) set('height', n)
        }
        break
      }
      case 'icon': {
        const text = str(value, 40)
        if (text !== null) set('icon', text)
        break
      }
      case 'checked': {
        if (typeof value === 'boolean') set('checked', value)
        break
      }
      case 'activeTab': {
        const n = num(value, 0, 20)
        if (n !== null) set('activeTab', Math.floor(n))
        break
      }
      case 'items': {
        if (Array.isArray(value)) {
          const items = value
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 12)
            .map((item) => item.slice(0, 80))
          set('items', items)
        }
        break
      }
      default:
        break
    }
  }
  return applied
}

function label(node: DesignNode): string {
  const text = node.text ?? node.placeholder ?? node.name ?? ''
  return text ? `${NODE_LABEL[node.kind]} "${text.slice(0, 40)}"` : NODE_LABEL[node.kind]
}

function insertNode(target: DesignNode, node: DesignNode, index: unknown): void {
  const children = target.children ?? []
  const at =
    typeof index === 'number' && Number.isFinite(index)
      ? Math.max(0, Math.min(children.length, Math.floor(index)))
      : children.length
  children.splice(at, 0, node)
  target.children = children
}

/**
 * Apply the JSON operations produced by the agent. Returns a changelog; the
 * caller decides whether to checkpoint/persist.
 */
export function applyDesignOps(doc: DesignDocument, input: unknown): DesignOpResult {
  const log: string[] = []
  let changed = false
  const ops = Array.isArray(input) ? input : []
  if (!ops.length) return { changed, log: ['No operations supplied.'] }

  for (const raw of ops.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') {
      log.push('Skipped an operation that was not an object.')
      continue
    }
    const op = raw as Record<string, unknown>
    const name = typeof op.op === 'string' ? op.op : ''

    if (name === 'create_board') {
      if (doc.boards.length >= 24) {
        log.push('Skipped create_board: the project already has 24 boards.')
        continue
      }
      const boardName = str(op.name, 80)?.trim() || `Screen ${doc.boards.length + 1}`
      const device: DeviceId =
        typeof op.device === 'string' && Object.prototype.hasOwnProperty.call(DEVICES, op.device)
          ? (op.device as DeviceId)
          : 'desktop'
      const board = createBoard(boardName, device)
      doc.boards.push(board)
      doc.activeBoardId = board.id
      changed = true
      log.push(`Created board "${boardName}" (${DEVICES[device].label}) with id ${board.id}.`)
      continue
    }

    if (name === 'set_active_board') {
      const board = resolveBoard(doc, op.board ?? op.name)
      if (!board) {
        log.push('Skipped set_active_board: board not found.')
        continue
      }
      doc.activeBoardId = board.id
      changed = true
      log.push(`Active board is now "${board.name}".`)
      continue
    }

    if (name === 'update_board') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped update_board: board not found.')
        continue
      }
      const nextName = str(op.name, 80)?.trim()
      if (nextName) {
        board.name = nextName
        changed = true
      }
      if (op.device === 'desktop' || op.device === 'tablet' || op.device === 'mobile') {
        const preset = DEVICES[op.device]
        board.device = op.device
        board.width = preset.width
        board.height = preset.height
        board.root.width = preset.width
        board.root.height = preset.height
        changed = true
      }
      if (op.theme === 'light' || op.theme === 'dark') {
        board.theme = op.theme
        changed = true
      }
      log.push(`Updated board "${board.name}".`)
      continue
    }

    if (name === 'delete_board') {
      const board = resolveBoard(doc, op.board)
      if (!board || doc.boards.length <= 1) {
        log.push('Skipped delete_board: keep at least one board.')
        continue
      }
      doc.boards = doc.boards.filter((entry) => entry.id !== board.id)
      if (doc.activeBoardId === board.id) doc.activeBoardId = doc.boards[0]!.id
      changed = true
      log.push(`Deleted board "${board.name}".`)
      continue
    }

    if (name === 'add_node') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped add_node: board not found.')
        continue
      }
      if (typeof op.kind !== 'string' || !(KINDS as string[]).includes(op.kind)) {
        log.push(`Skipped add_node: unknown kind "${String(op.kind)}".`)
        continue
      }
      if (countBoard(board) >= DESIGN_MAX_NODES) {
        log.push('Skipped add_node: the board is full.')
        continue
      }
      const parent = op.parent ? resolveNode(board, op.parent) : board.root
      if (!parent || !isContainer(parent.kind)) {
        log.push('Skipped add_node: parent must be a container (frame, stack, row, card, navbar, list).')
        continue
      }
      const node = createNode(op.kind as DesignNodeKind)
      if (op.text !== undefined) node.text = str(op.text, 800) ?? node.text
      if (op.placeholder !== undefined) node.placeholder = str(op.placeholder, 200) ?? node.placeholder
      const props = op.props && typeof op.props === 'object' ? (op.props as Record<string, unknown>) : null
      if (props) setNodeProps(node, props)
      insertNode(parent, node, op.index)
      changed = true
      log.push(`Added ${label(node)} (id ${node.id}) to ${parent.name || NODE_LABEL[parent.kind]}.`)
      continue
    }

    if (name === 'update_node') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped update_node: board not found.')
        continue
      }
      const node = resolveNode(board, op.id)
      if (!node) {
        log.push(`Skipped update_node: node "${String(op.id)}" not found.`)
        continue
      }
      const props = op.props && typeof op.props === 'object' ? (op.props as Record<string, unknown>) : null
      const applied = props ? setNodeProps(node, props) : []
      if (op.text !== undefined) applied.push(...setNodeProps(node, { text: op.text }))
      if (!applied.length) {
        log.push(`Skipped update_node ${node.id}: no recognised properties.`)
        continue
      }
      changed = true
      log.push(`Updated ${label(node)} (${applied.join(', ')}).`)
      continue
    }

    if (name === 'remove_node') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped remove_node: board not found.')
        continue
      }
      const node = resolveNode(board, op.id)
      if (!node) {
        log.push(`Skipped remove_node: node "${String(op.id)}" not found.`)
        continue
      }
      if (node === board.root) {
        log.push('Skipped remove_node: the screen frame cannot be removed.')
        continue
      }
      const text = label(node)
      removeNode(board.root, node.id)
      changed = true
      log.push(`Removed ${text}.`)
      continue
    }

    if (name === 'move_node') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped move_node: board not found.')
        continue
      }
      const node = resolveNode(board, op.id)
      if (!node) {
        log.push(`Skipped move_node: node "${String(op.id)}" not found.`)
        continue
      }
      if (node === board.root) {
        log.push('Skipped move_node: the screen frame cannot be moved.')
        continue
      }
      const parent = op.parent ? resolveNode(board, op.parent) : findParent(board.root, node.id)
      if (!parent || !isContainer(parent.kind)) {
        log.push('Skipped move_node: parent must be a container.')
        continue
      }
      if (containsNode(node, parent.id)) {
        log.push('Skipped move_node: a node cannot move inside itself.')
        continue
      }
      const location = nodeIndex(board.root, node.id)
      if (!location) {
        log.push('Skipped move_node: node is not attached to the board.')
        continue
      }
      location.parent.children?.splice(location.index, 1)
      let index = op.index
      if (typeof index === 'number' && location.parent === parent && location.index < index) {
        index -= 1
      }
      insertNode(parent, node, index)
      changed = true
      log.push(`Moved ${label(node)} into ${parent.name || NODE_LABEL[parent.kind]}.`)
      continue
    }

    if (name === 'duplicate_node') {
      const board = resolveBoard(doc, op.board)
      if (!board) {
        log.push('Skipped duplicate_node: board not found.')
        continue
      }
      const node = resolveNode(board, op.id)
      if (!node || node === board.root) {
        log.push('Skipped duplicate_node: node not found.')
        continue
      }
      const location = nodeIndex(board.root, node.id)
      if (!location) {
        log.push('Skipped duplicate_node: node is not attached to the board.')
        continue
      }
      const copy = cloneNode(node)
      resignIds(copy)
      insertNode(location.parent, copy, location.index + 1)
      changed = true
      log.push(`Duplicated ${label(node)} as ${copy.id}.`)
      continue
    }

    log.push(`Skipped unknown operation "${name || '(missing op)'}".`)
  }

  return { changed, log }
}

function countBoard(board: DesignBoard): number {
  const walk = (node: DesignNode): number =>
    1 + (node.children ?? []).reduce((sum, child) => sum + walk(child), 0)
  return walk(board.root)
}

function resignIds(node: DesignNode): void {
  node.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  for (const child of node.children ?? []) resignIds(child)
}
