/**
 * Design canvas model: screen boards, a small component library and the
 * auto-layout engine that turns the tree into world-space boxes.
 *
 * The canvas is intentionally a *design* surface rather than a freeform
 * whiteboard: every board is one screen, and components are laid out by their
 * parent so an agent can read a predictable, semantic tree.
 */

import { clamp, measureWord, wrapText, slugify, uid, type Point, type Rect } from './board'

export const DESIGN_VERSION = 2 as const
export const DESIGN_MAX_NODES = 800
export const DESIGN_MAX_DEPTH = 12

export type DeviceId = 'desktop' | 'tablet' | 'mobile'

export const DEVICES: Record<DeviceId, { label: string; width: number; height: number }> = {
  desktop: { label: 'Desktop', width: 1280, height: 800 },
  tablet: { label: 'Tablet', width: 834, height: 1112 },
  mobile: { label: 'Mobile', width: 390, height: 844 }
}

export type DesignNodeKind =
  | 'frame'
  | 'stack'
  | 'row'
  | 'card'
  | 'navbar'
  | 'list'
  | 'listItem'
  | 'heading'
  | 'text'
  | 'button'
  | 'input'
  | 'textarea'
  | 'badge'
  | 'avatar'
  | 'image'
  | 'divider'
  | 'checkbox'
  | 'toggle'
  | 'tabs'
  | 'icon'

export type DesignTheme = 'light' | 'dark'
export type DesignTone = 'slate' | 'accent' | 'green' | 'red' | 'blue' | 'purple'
export type DesignVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type DesignSize = 'sm' | 'md' | 'lg'
export type WidthMode = number | 'fill' | 'hug'

export interface DesignNode {
  id: string
  kind: DesignNodeKind
  /** Human/agent readable label. Optional; the kind is usually enough. */
  name?: string
  text?: string
  subtitle?: string
  placeholder?: string
  src?: string
  tone?: DesignTone
  variant?: DesignVariant
  size?: DesignSize
  align?: 'start' | 'center' | 'end'
  justify?: 'start' | 'center' | 'end' | 'between'
  direction?: 'vertical' | 'horizontal'
  gap?: number
  padding?: number
  radius?: number
  width?: WidthMode
  height?: number | 'hug'
  icon?: string
  checked?: boolean
  items?: string[]
  activeTab?: number
  children?: DesignNode[]
}

export interface DesignBoard {
  id: string
  name: string
  device: DeviceId
  theme: DesignTheme
  /** Board width/height follow the device preset unless the root is resized. */
  width: number
  height: number
  root: DesignNode
  view: { x: number; y: number; zoom: number }
}

export interface DesignDocument {
  version: typeof DESIGN_VERSION
  boards: DesignBoard[]
  activeBoardId: string
}

export interface LayoutBox {
  id: string
  node: DesignNode
  parentId: string | null
  depth: number
  x: number
  y: number
  w: number
  h: number
}

export const CONTAINER_KINDS: DesignNodeKind[] = ['frame', 'stack', 'row', 'card', 'navbar', 'list']

export const NODE_LABEL: Record<DesignNodeKind, string> = {
  frame: 'Frame',
  stack: 'Stack',
  row: 'Row',
  card: 'Card',
  navbar: 'Navbar',
  list: 'List',
  listItem: 'List item',
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  input: 'Input',
  textarea: 'Textarea',
  badge: 'Badge',
  avatar: 'Avatar',
  image: 'Image',
  divider: 'Divider',
  checkbox: 'Checkbox',
  toggle: 'Toggle',
  tabs: 'Tabs',
  icon: 'Icon'
}

export const TONES: DesignTone[] = ['slate', 'accent', 'green', 'red', 'blue', 'purple']

export const ICON_NAMES = [
  'Sparkles',
  'Search',
  'Bell',
  'Star',
  'Heart',
  'Settings',
  'Home',
  'User',
  'Plus',
  'Check',
  'ArrowRight',
  'ChevronRight'
] as const

export function isContainer(kind: DesignNodeKind): boolean {
  return CONTAINER_KINDS.includes(kind)
}

export function isHorizontal(kind: DesignNodeKind): boolean {
  return kind === 'row' || kind === 'navbar'
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export function createNode(kind: DesignNodeKind): DesignNode {
  const node: DesignNode = { id: uid(), kind }
  switch (kind) {
    case 'frame':
      return { ...node, name: 'Screen', direction: 'vertical', gap: 24, padding: 32 }
    case 'stack':
      return { ...node, direction: 'vertical', gap: 12, padding: 16, width: 'fill' }
    case 'row':
      return {
        ...node,
        direction: 'horizontal',
        gap: 12,
        padding: 0,
        align: 'center',
        justify: 'start',
        width: 'fill'
      }
    case 'card':
      return {
        ...node,
        direction: 'vertical',
        gap: 12,
        padding: 20,
        radius: 16,
        width: 'fill',
        children: [createNode('heading'), createNode('text'), createNode('button')]
      }
    case 'navbar':
      return {
        ...node,
        name: 'Navbar',
        direction: 'horizontal',
        gap: 16,
        padding: 16,
        justify: 'between',
        align: 'center',
        height: 64,
        width: 'fill',
        children: [
          { ...createNode('text'), text: 'Kodra', size: 'md', width: 'hug', name: 'Brand' },
          {
            ...createNode('row'),
            gap: 20,
            align: 'center',
            justify: 'end',
            width: 'hug',
            children: ['Product', 'Pricing', 'Docs'].map((label) => ({
              ...createNode('text'),
              text: label,
              size: 'sm',
              width: 'hug'
            }))
          },
          { ...createNode('button'), text: 'Sign in', size: 'sm' }
        ]
      }
    case 'list':
      return {
        ...node,
        direction: 'vertical',
        gap: 0,
        padding: 0,
        radius: 14,
        width: 'fill',
        children: [
          { ...createNode('listItem'), text: 'Workspace settings', subtitle: 'Members, roles and access' },
          { ...createNode('listItem'), text: 'Notifications', subtitle: 'Email and desktop alerts' },
          { ...createNode('listItem'), text: 'Billing', subtitle: 'Plan, invoices and receipts' }
        ]
      }
    case 'listItem':
      return { ...node, text: 'List item', subtitle: 'Supporting detail', width: 'fill' }
    case 'heading':
      return { ...node, text: 'Section heading', size: 'md', width: 'fill' }
    case 'text':
      return {
        ...node,
        text: 'Supporting copy that explains this section in a sentence or two.',
        size: 'md',
        width: 'fill'
      }
    case 'button':
      return { ...node, text: 'Button', variant: 'primary', size: 'md', width: 'hug' }
    case 'input':
      return { ...node, placeholder: 'Email address', width: 'fill' }
    case 'textarea':
      return { ...node, placeholder: 'Write a message…', width: 'fill' }
    case 'badge':
      return { ...node, text: 'New', tone: 'accent', width: 'hug' }
    case 'avatar':
      return { ...node, text: 'KD', size: 'md' }
    case 'image':
      return { ...node, src: '', width: 'fill', height: 160 }
    case 'divider':
      return { ...node, width: 'fill' }
    case 'checkbox':
      return { ...node, text: 'Remember me', checked: true, width: 'hug' }
    case 'toggle':
      return { ...node, text: 'Notifications', checked: true, width: 'hug' }
    case 'tabs':
      return { ...node, items: ['Overview', 'Activity', 'Settings'], activeTab: 0, width: 'fill' }
    case 'icon':
      return { ...node, icon: 'Sparkles', width: 'hug' }
    default:
      return node
  }
}

export function createBoard(name = 'Home', device: DeviceId = 'desktop'): DesignBoard {
  const preset = DEVICES[device]
  const root: DesignNode = {
    ...createNode('frame'),
    name: 'Screen',
    width: preset.width,
    height: preset.height
  }
  return {
    id: uid(),
    name,
    device,
    theme: 'light',
    width: preset.width,
    height: preset.height,
    root,
    view: { x: 0, y: 0, zoom: 1 }
  }
}

export function createDesign(): DesignDocument {
  const board = createBoard('Home')
  return { version: DESIGN_VERSION, boards: [board], activeBoardId: board.id }
}

export function cloneNode(node: DesignNode): DesignNode {
  return JSON.parse(JSON.stringify(node)) as DesignNode
}

export function cloneBoard(board: DesignBoard, name: string): DesignBoard {
  const copy = JSON.parse(JSON.stringify(board)) as DesignBoard
  copy.id = uid()
  copy.name = name
  copy.view = { x: 0, y: 0, zoom: 1 }
  resign(copy.root)
  return copy
}

function resign(node: DesignNode): void {
  node.id = uid()
  for (const child of node.children ?? []) resign(child)
}

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

const HEADING_SIZE: Record<DesignSize, number> = { sm: 20, md: 28, lg: 38 }
const TEXT_SIZE: Record<DesignSize, number> = { sm: 13, md: 15, lg: 17 }
const BUTTON_SIZE: Record<DesignSize, number> = { sm: 13, md: 14, lg: 15 }
const BUTTON_HEIGHT: Record<DesignSize, number> = { sm: 32, md: 40, lg: 46 }
const INPUT_HEIGHT: Record<DesignSize, number> = { sm: 36, md: 42, lg: 48 }
const BADGE_HEIGHT: Record<DesignSize, number> = { sm: 20, md: 24, lg: 28 }
const AVATAR_SIZE: Record<DesignSize, number> = { sm: 32, md: 40, lg: 48 }
const ICON_SIZE: Record<DesignSize, number> = { sm: 20, md: 24, lg: 30 }

export function nodeFont(node: DesignNode): { size: number; lineHeight: number; weight: number } {
  const size = node.size ?? 'md'
  switch (node.kind) {
    case 'heading':
      return { size: HEADING_SIZE[size], lineHeight: 1.18, weight: 650 }
    case 'button':
      return { size: BUTTON_SIZE[size], lineHeight: 1.2, weight: 600 }
    case 'badge':
      return { size: BADGE_HEIGHT[size] < 24 ? 11 : 12, lineHeight: 1.2, weight: 600 }
    case 'tabs':
      return { size: BUTTON_SIZE[size], lineHeight: 1.2, weight: 600 }
    case 'listItem':
      return { size: 14, lineHeight: 1.35, weight: 500 }
    case 'text':
      return { size: TEXT_SIZE[size], lineHeight: 1.55, weight: 400 }
    default:
      return { size: 14, lineHeight: 1.4, weight: 400 }
  }
}

function leafPadding(node: DesignNode): { x: number; y: number } {
  const size = node.size ?? 'md'
  switch (node.kind) {
    case 'button':
      return { x: size === 'sm' ? 14 : size === 'lg' ? 22 : 18, y: 0 }
    case 'input':
    case 'textarea':
      return { x: 14, y: 0 }
    case 'badge':
      return { x: size === 'sm' ? 8 : 10, y: 0 }
    case 'listItem':
      return { x: 12, y: 12 }
    case 'tabs':
      return { x: 4, y: 0 }
    default:
      return { x: 0, y: 0 }
  }
}

function longestLine(text: string, size: number, weight = 500): number {
  let width = 0
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    width = Math.max(width, measureWord(line, size, weight))
  }
  return width
}

export function textHeightFor(node: DesignNode, width: number): number {
  const font = nodeFont(node)
  const pad = leafPadding(node)
  const inner = Math.max(24, width - pad.x * 2)
  const lines = wrapText(node.text ?? '', inner, font.size, font.weight)
  return Math.max(1, lines.length) * font.size * font.lineHeight + pad.y * 2
}

function listItemHeight(node: DesignNode): number {
  const pad = leafPadding(node)
  const titleLines = Math.max(1, wrapText(node.text ?? '', 260, 14, 500).length)
  const subLines = node.subtitle ? Math.max(1, wrapText(node.subtitle, 260, 12.5, 400).length) : 0
  const textHeight = titleLines * 14 * 1.35 + subLines * 12.5 * 1.35 + (subLines ? 3 : 0)
  return pad.y * 2 + Math.max(AVATAR_SIZE.md, textHeight)
}

function intrinsicWidth(node: DesignNode): number {
  const font = nodeFont(node)
  const pad = leafPadding(node)
  switch (node.kind) {
    case 'heading':
    case 'text':
      return Math.ceil(longestLine(node.text ?? '', font.size, font.weight)) + pad.x * 2
    case 'button':
      return Math.ceil(measureWord(node.text ?? '', font.size, font.weight)) + pad.x * 2
    case 'badge':
      return Math.ceil(measureWord(node.text ?? '', font.size, font.weight)) + pad.x * 2
    case 'checkbox':
      return 20 + 8 + Math.ceil(measureWord(node.text ?? '', 14, 400))
    case 'toggle':
      return 40 + 8 + Math.ceil(measureWord(node.text ?? '', 14, 400))
    case 'avatar':
      return AVATAR_SIZE[node.size ?? 'md']
    case 'icon':
      return ICON_SIZE[node.size ?? 'md']
    case 'listItem': {
      const title = Math.ceil(measureWord(node.text ?? '', 14, 500))
      const sub = node.subtitle ? Math.ceil(measureWord(node.subtitle, 12.5, 400)) : 0
      return pad.x * 2 + AVATAR_SIZE.md + 12 + Math.max(title, sub) + 22
    }
    case 'tabs': {
      const active = 14
      const labels = (node.items ?? []).reduce(
        (sum, item) => sum + measureWord(item, font.size, font.weight) + 24,
        0
      )
      return labels + pad.x * 2 + Math.max(0, (node.items?.length ?? 1) - 1) * 6 + active
    }
    case 'image':
      return 120
    case 'divider':
      return 40
    default:
      return 80
  }
}

function leafHeight(node: DesignNode, width: number): number {
  const size = node.size ?? 'md'
  switch (node.kind) {
    case 'heading':
    case 'text':
      return textHeightFor(node, width)
    case 'button':
      return BUTTON_HEIGHT[size]
    case 'input':
      return INPUT_HEIGHT[size]
    case 'textarea':
      return typeof node.height === 'number' ? node.height : 96
    case 'badge':
      return BADGE_HEIGHT[size]
    case 'avatar':
      return AVATAR_SIZE[size]
    case 'image':
      return typeof node.height === 'number' ? node.height : 160
    case 'divider':
      return 1
    case 'checkbox':
      return 22
    case 'toggle':
      return 26
    case 'tabs':
      return 38
    case 'icon':
      return ICON_SIZE[size]
    case 'listItem':
      return listItemHeight(node)
    default:
      return 24
  }
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function defaultWidth(node: DesignNode): WidthMode {
  switch (node.kind) {
    case 'button':
    case 'badge':
    case 'avatar':
    case 'checkbox':
    case 'toggle':
    case 'icon':
      return 'hug'
    default:
      return 'fill'
  }
}

function widthOf(node: DesignNode): WidthMode {
  return node.width ?? defaultWidth(node)
}

function containerPadding(node: DesignNode): number {
  if (node.padding !== undefined) return node.padding
  if (node.kind === 'frame') return 32
  if (node.kind === 'card') return 20
  if (node.kind === 'navbar') return 16
  if (node.kind === 'list') return 0
  if (node.kind === 'row') return 0
  return 16
}

function containerGap(node: DesignNode): number {
  if (node.gap !== undefined) return node.gap
  if (node.kind === 'frame') return 24
  if (node.kind === 'list') return 0
  if (node.kind === 'row' || node.kind === 'navbar') return 12
  return 12
}

function measureNode(node: DesignNode, available: number): { w: number; h: number } {
  const mode = widthOf(node)
  let width: number
  if (typeof mode === 'number') width = Math.max(24, mode)
  else if (mode === 'hug') width = Math.max(24, Math.min(intrinsicWidth(node), Math.max(24, available)))
  else width = Math.max(24, available)

  if (!isContainer(node.kind)) {
    const height = typeof node.height === 'number' ? node.height : leafHeight(node, width)
    return { w: width, h: Math.max(1, height) }
  }

  const pad = containerPadding(node)
  const gap = containerGap(node)
  const children = node.children ?? []
  const inner = Math.max(24, width - pad * 2)
  if (!children.length) {
    return { w: width, h: typeof node.height === 'number' ? node.height : pad * 2 }
  }

  if (isHorizontal(node.kind)) {
    const measured = children.map((child) => measureNode(child, inner))
    let hugTotal = 0
    let fillCount = 0
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child) continue
      const mode = widthOf(child)
      if (mode === 'fill') fillCount++
      else hugTotal += measured[i]?.w ?? 0
    }
    const share = fillCount
      ? Math.max(24, (inner - hugTotal - gap * (children.length - 1)) / fillCount)
      : 0
    let content = 0
    let height = 0
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child) continue
      const mode = widthOf(child)
      const childWidth = mode === 'fill' ? share : measured[i]?.w ?? share
      const childHeight =
        typeof child.height === 'number' ? child.height : measureNode(child, childWidth).h
      content += childWidth
      height = Math.max(height, childHeight)
    }
    content += gap * (children.length - 1)
    if (mode !== 'hug') width = Math.max(width, content + pad * 2)
    const fixedHeight = typeof node.height === 'number' ? node.height : pad * 2 + height
    return { w: Math.max(24, width), h: Math.max(1, fixedHeight) }
  }

  let content = 0
  let widest = 0
  for (const child of children) {
    const childMode = widthOf(child)
    const childAvailable = typeof childMode === 'number' ? Math.max(24, childMode) : inner
    const measured = measureNode(child, childAvailable)
    content += measured.h
    widest = Math.max(widest, measured.w)
  }
  content += gap * (children.length - 1)
  const hugWidth = pad * 2 + widest
  if (mode === 'hug') width = Math.max(24, Math.min(hugWidth, Math.max(24, available)))
  const fixedHeight = typeof node.height === 'number' ? node.height : pad * 2 + content
  return { w: Math.max(24, width), h: Math.max(1, fixedHeight) }
}

function alignOffset(available: number, size: number, align: DesignNode['align']): number {
  if (align === 'center') return Math.max(0, (available - size) / 2)
  if (align === 'end') return Math.max(0, available - size)
  return 0
}

function justifyOffset(available: number, total: number, justify: DesignNode['justify']): number {
  if (justify === 'center') return Math.max(0, (available - total) / 2)
  if (justify === 'end') return Math.max(0, available - total)
  return 0
}

/**
 * Flatten the active board into absolutely positioned boxes. Children are
 * returned after their parent so a simple DOM loop paints them on top.
 */
export function layoutBoard(board: DesignBoard): LayoutBox[] {
  const boxes: LayoutBox[] = []
  const root = board.root

  const place = (
    node: DesignNode,
    x: number,
    y: number,
    width: number,
    height: number,
    parentId: string | null,
    depth: number
  ) => {
    boxes.push({ id: node.id, node, parentId, depth, x, y, w: width, h: height })
    if (!isContainer(node.kind) || depth >= DESIGN_MAX_DEPTH) return

    const children = node.children ?? []
    if (!children.length) return
    const pad = containerPadding(node)
    const gap = containerGap(node)
    const innerW = Math.max(0, width - pad * 2)
    const innerH = Math.max(0, height - pad * 2)

    if (isHorizontal(node.kind)) {
      const measured = children.map((child) => measureNode(child, innerW))
      let hugTotal = 0
      let fillCount = 0
      const widths: number[] = children.map((child, index) => {
        const mode = widthOf(child)
        if (mode === 'fill') {
          fillCount++
          return 0
        }
        hugTotal += measured[index]?.w ?? 0
        return measured[index]?.w ?? 0
      })
      const spare = Math.max(0, innerW - hugTotal - gap * (children.length - 1))
      const share = fillCount ? spare / fillCount : 0
      let total = hugTotal + share * fillCount + gap * (children.length - 1)
      for (let i = 0; i < widths.length; i++) {
        if (!widths[i]) widths[i] = share
      }
      let start = pad + justifyOffset(innerW, total, node.justify)
      const between = node.justify === 'between' && children.length > 1
      const betweenGap = between ? Math.max(gap, (innerW - total + gap * (children.length - 1)) / (children.length - 1)) : gap
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (!child) continue
        const cw = Math.max(24, widths[i] ?? 0)
        const ch =
          typeof child.height === 'number'
            ? child.height
            : measureNode(child, cw).h
        const cy = pad + alignOffset(innerH, ch, node.align)
        place(child, x + start, y + cy, cw, ch, node.id, depth + 1)
        start += cw + (between ? betweenGap : gap)
      }
      return
    }

    const measured = children.map((child) => {
      const mode = widthOf(child)
      const available = typeof mode === 'number' ? Math.max(24, mode) : innerW
      return measureNode(child, available)
    })
    const widths = children.map((child, index) => {
      const mode = widthOf(child)
      if (typeof mode === 'number') return Math.max(24, mode)
      if (mode === 'hug') return measured[index]?.w ?? innerW
      return innerW
    })
    const heights = children.map((child, index) => {
      if (typeof child.height === 'number') return child.height
      return measureNode(child, widths[index] ?? innerW).h
    })
    const total = heights.reduce((sum, value) => sum + value, 0) + gap * (children.length - 1)
    let cursor = pad + justifyOffset(innerH, total, node.justify)
    const between = node.justify === 'between' && children.length > 1
    const betweenGap = between ? Math.max(gap, (innerH - total + gap * (children.length - 1)) / (children.length - 1)) : gap
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child) continue
      const cw = widths[i] ?? innerW
      const cx = pad + alignOffset(innerW, cw, node.align)
      const ch = heights[i] ?? 0
      place(child, x + cx, y + cursor, cw, ch, node.id, depth + 1)
      cursor += ch + (between ? betweenGap : gap)
    }
  }

  place(root, 0, 0, board.width, board.height, null, 0)
  return boxes
}

export function boxMap(boxes: LayoutBox[]): Map<string, LayoutBox> {
  return new Map(boxes.map((box) => [box.id, box]))
}

export function findNode(root: DesignNode, id: string): DesignNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export function findParent(root: DesignNode, id: string): DesignNode | null {
  for (const child of root.children ?? []) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

export function removeNode(root: DesignNode, id: string): boolean {
  const children = root.children ?? []
  const index = children.findIndex((child) => child.id === id)
  if (index >= 0) {
    children.splice(index, 1)
    root.children = children
    return true
  }
  for (const child of children) {
    if (removeNode(child, id)) return true
  }
  return false
}

export function countNodes(root: DesignNode): number {
  return 1 + (root.children ?? []).reduce((sum, child) => sum + countNodes(child), 0)
}

export function containsNode(root: DesignNode, id: string): boolean {
  return findNode(root, id) !== null
}

export function nodeIndex(root: DesignNode, id: string): { parent: DesignNode; index: number } | null {
  const children = root.children ?? []
  const index = children.findIndex((child) => child.id === id)
  if (index >= 0) return { parent: root, index }
  for (const child of children) {
    const found = nodeIndex(child, id)
    if (found) return found
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Agent-facing summaries                                              */
/* ------------------------------------------------------------------ */

function short(text: string | undefined, max = 60): string {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function propLine(node: DesignNode): string {
  const parts: string[] = []
  if (node.size) parts.push(`size=${node.size}`)
  if (node.variant) parts.push(`variant=${node.variant}`)
  if (node.tone && node.tone !== 'slate') parts.push(`tone=${node.tone}`)
  if (node.direction) parts.push(`direction=${node.direction}`)
  if (node.gap !== undefined) parts.push(`gap=${node.gap}`)
  if (node.padding !== undefined) parts.push(`padding=${node.padding}`)
  if (node.radius !== undefined) parts.push(`radius=${node.radius}`)
  if (node.width !== undefined) parts.push(`width=${node.width}`)
  if (node.height !== undefined) parts.push(`height=${node.height}`)
  if (node.align) parts.push(`align=${node.align}`)
  if (node.justify) parts.push(`justify=${node.justify}`)
  if (node.checked !== undefined) parts.push(`checked=${node.checked}`)
  if (node.items?.length) parts.push(`items=${node.items.join('|')}`)
  if (node.icon) parts.push(`icon=${node.icon}`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

function describeNode(node: DesignNode, depth: number): string[] {
  const indent = '  '.repeat(depth)
  let label = `${indent}- ${NODE_LABEL[node.kind]} \`${node.id}\``
  if (node.name) label += ` · ${node.name}`
  if (node.text) label += `: “${short(node.text)}”`
  else if (node.placeholder) label += `: placeholder “${short(node.placeholder)}”`
  else if (node.src) label += `: ${short(node.src)}`
  label += propLine(node)
  const lines = [label]
  for (const child of node.children ?? []) lines.push(...describeNode(child, depth + 1))
  return lines
}

export function boardMarkdown(board: DesignBoard): string {
  const nodes = countNodes(board.root)
  return [
    `## ${board.name}`,
    '',
    `- Board id: \`${board.id}\``,
    `- Device: ${DEVICES[board.device].label} (${board.width}×${board.height})`,
    `- Theme: ${board.theme}`,
    `- Components: ${nodes - 1}`,
    '',
    ...describeNode(board.root, 0)
  ].join('\n')
}

export function designMarkdown(doc: DesignDocument): string {
  const active = doc.boards.find((board) => board.id === doc.activeBoardId)
  const parts = [
    '# Kodra design',
    '',
    'This file describes the design canvas. Board ids and node ids are stable and can be used with the `write_design` tool.',
    '',
    `Boards: ${doc.boards.length}. Active board: ${active?.name ?? 'none'}.`,
    ''
  ]
  for (const board of doc.boards) {
    parts.push(boardMarkdown(board), '')
  }
  return parts.join('\n')
}

/** Compact brief injected into the agent system prompt. */
export function designBrief(doc: DesignDocument, max = 2400): string {
  if (!doc.boards.length) return ''
  const lines: string[] = ['Design canvas (Kodra):', '']
  for (const board of doc.boards) {
    const active = board.id === doc.activeBoardId ? ' (active)' : ''
    lines.push(
      `- ${board.name}${active} — ${DEVICES[board.device].label} ${board.width}×${board.height}, ${countNodes(board.root) - 1} components`
    )
    for (const child of board.root.children ?? []) {
      const text = child.text ? ` “${short(child.text, 36)}”` : child.placeholder ? ` “${short(child.placeholder, 36)}”` : ''
      lines.push(`  - ${NODE_LABEL[child.kind]}${text} [${child.id}]`)
    }
  }
  lines.push(
    '',
    'Call `read_design` for the full tree with ids and properties, and `write_design` to change it. Generated copy: `.kodra/design/`.'
  )
  const text = lines.join('\n')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function boardToJson(board: DesignBoard): string {
  return JSON.stringify({ ...board, view: undefined }, null, 2)
}

export function designFileName(board: DesignBoard): string {
  return `${slugify(board.name)}.md`
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

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

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readNode(raw: unknown, depth: number): DesignNode | null {
  if (!raw || typeof raw !== 'object' || depth > DESIGN_MAX_DEPTH) return null
  const source = raw as Record<string, unknown>
  const kind = source.kind
  if (typeof kind !== 'string' || !(KINDS as string[]).includes(kind)) return null
  const node: DesignNode = {
    id: typeof source.id === 'string' && source.id ? source.id : uid(),
    kind: kind as DesignNodeKind
  }
  if (typeof source.name === 'string') node.name = source.name.slice(0, 80)
  if (typeof source.text === 'string') node.text = source.text.slice(0, 800)
  if (typeof source.subtitle === 'string') node.subtitle = source.subtitle.slice(0, 400)
  if (typeof source.placeholder === 'string') node.placeholder = source.placeholder.slice(0, 200)
  if (typeof source.src === 'string') node.src = source.src.slice(0, 2000)
  if (typeof source.tone === 'string' && (TONES as string[]).includes(source.tone)) {
    node.tone = source.tone as DesignTone
  }
  if (typeof source.variant === 'string' && (VARIANTS as string[]).includes(source.variant)) {
    node.variant = source.variant as DesignVariant
  }
  if (typeof source.size === 'string' && (SIZES as string[]).includes(source.size)) {
    node.size = source.size as DesignSize
  }
  for (const key of ['align', 'justify', 'direction'] as const) {
    const allowed =
      key === 'direction' ? ['vertical', 'horizontal'] : key === 'align' ? ['start', 'center', 'end'] : ['start', 'center', 'end', 'between']
    if (typeof source[key] === 'string' && allowed.includes(source[key] as string)) {
      ;(node as unknown as Record<string, unknown>)[key] = source[key]
    }
  }
  for (const key of ['gap', 'padding', 'radius'] as const) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key])) {
      node[key] = clamp(source[key] as number, 0, 200)
    }
  }
  if (typeof source.width === 'number' && Number.isFinite(source.width)) {
    node.width = clamp(source.width, 24, 4000)
  } else if (source.width === 'fill' || source.width === 'hug') {
    node.width = source.width
  }
  if (typeof source.height === 'number' && Number.isFinite(source.height)) {
    node.height = clamp(source.height, 1, 4000)
  } else if (source.height === 'hug') {
    node.height = 'hug'
  }
  if (typeof source.icon === 'string') node.icon = source.icon.slice(0, 40)
  if (typeof source.checked === 'boolean') node.checked = source.checked
  if (typeof source.activeTab === 'number') node.activeTab = Math.max(0, Math.floor(source.activeTab))
  if (Array.isArray(source.items)) {
    node.items = source.items
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 12)
      .map((item) => item.slice(0, 80))
  }
  if (Array.isArray(source.children) && isContainer(node.kind)) {
    const children: DesignNode[] = []
    for (const child of source.children.slice(0, DESIGN_MAX_NODES)) {
      const parsed = readNode(child, depth + 1)
      if (parsed) children.push(parsed)
    }
    if (children.length) node.children = children
  }
  return node
}

function uniqueIds(doc: DesignDocument): void {
  const seen = new Set<string>()
  const visit = (node: DesignNode) => {
    if (seen.has(node.id)) node.id = uid()
    seen.add(node.id)
    for (const child of node.children ?? []) visit(child)
  }
  for (const board of doc.boards) visit(board.root)
}

/** Parse a stored design document. Returns null when the payload is unusable. */
export function parseDesign(raw: string | null): DesignDocument | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const source = parsed as Record<string, unknown>
  const rawBoards = Array.isArray(source.boards) ? source.boards : []
  const boards: DesignBoard[] = []
  for (const rawBoard of rawBoards.slice(0, 24)) {
    if (!rawBoard || typeof rawBoard !== 'object') continue
    const entry = rawBoard as Record<string, unknown>
    const device =
      typeof entry.device === 'string' &&
      Object.prototype.hasOwnProperty.call(DEVICES, entry.device)
        ? (entry.device as DeviceId)
        : 'desktop'
    const preset = DEVICES[device]
    const root = readNode(entry.root, 0) ?? createBoard('Screen', device).root
    if (!isContainer(root.kind)) continue
    const width = clamp(finite(entry.width, preset.width), 240, 4000)
    const height = clamp(finite(entry.height, preset.height), 240, 6000)
    root.width = width
    root.height = height
    const rawView = (entry.view ?? {}) as Record<string, unknown>
    boards.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : uid(),
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 80) : 'Untitled board',
      device,
      theme: entry.theme === 'dark' ? 'dark' : 'light',
      width,
      height,
      root,
      view: {
        x: finite(rawView.x),
        y: finite(rawView.y),
        zoom: clamp(finite(rawView.zoom, 1), 0.2, 2.5)
      }
    })
  }
  if (!boards.length) return null
  const doc: DesignDocument = {
    version: DESIGN_VERSION,
    boards,
    activeBoardId:
      typeof source.activeBoardId === 'string' && boards.some((b) => b.id === source.activeBoardId)
        ? source.activeBoardId
        : boards[0]!.id
  }
  uniqueIds(doc)
  return doc
}

/* ------------------------------------------------------------------ */
/* Interaction helpers                                                 */
/* ------------------------------------------------------------------ */

export function boxAt(boxes: LayoutBox[], point: Point): LayoutBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    if (!box) continue
    if (
      point.x >= box.x &&
      point.x <= box.x + box.w &&
      point.y >= box.y &&
      point.y <= box.y + box.h
    ) {
      return box
    }
  }
  return null
}

export function rectOfBox(box: LayoutBox): Rect {
  return { x: box.x, y: box.y, w: box.w, h: box.h }
}

export function contentWidth(board: DesignBoard, node: DesignNode): number {
  const box = layoutBoard(board).find((entry) => entry.id === node.id)
  if (!box) return node.width === 'hug' ? 320 : board.width
  return box.w
}
