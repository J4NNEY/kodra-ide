/**
 * Data model, geometry and text layout for the whiteboard canvas.
 *
 * Everything lives in world coordinates (unscaled pixels). The overlay keeps
 * the viewport separately, so a board file never depends on the window size.
 */

export type BoardTone = 'slate' | 'amber' | 'rose' | 'violet' | 'teal' | 'blue'

export type BoardElementType =
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'stroke'
  | 'arrow'

export interface BoardElement {
  id: string
  type: BoardElementType
  x: number
  y: number
  w: number
  h: number
  tone: BoardTone
  /** Notes, shapes and text labels. */
  text?: string
  /** Font size for text, stroke width for freehand. */
  size?: number
  /** Freehand points, relative to x/y, as a flat [x0, y0, x1, y1, …] list. */
  points?: number[]
  /** Arrow endpoints when the arrow is not attached to a shape. */
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  /** Arrow binding: element ids the endpoints stick to. */
  from?: string
  to?: string
}

export interface BoardView {
  x: number
  y: number
  zoom: number
}

export interface BoardDocument {
  version: 1
  name: string
  elements: BoardElement[]
  view: BoardView
}

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const BOARD_VERSION = 1 as const
export const BOARD_MAX_ELEMENTS = 2000
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3
export const GRID_STEP = 24

export const TONES: BoardTone[] = ['slate', 'amber', 'rose', 'violet', 'teal', 'blue']

export const TONE_LABEL: Record<BoardTone, string> = {
  slate: 'Neutral',
  amber: 'Amber',
  rose: 'Rose',
  violet: 'Violet',
  teal: 'Teal',
  blue: 'Blue'
}

export const ELEMENT_LABEL: Record<BoardElementType, string> = {
  note: 'Note',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  text: 'Text',
  stroke: 'Drawing',
  arrow: 'Connector'
}

let seq = 0

export function uid(): string {
  seq = (seq + 1) % 1_000_000
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createBoard(name = 'Untitled board'): BoardDocument {
  return {
    version: BOARD_VERSION,
    name,
    elements: [],
    view: { x: 0, y: 0, zoom: 1 }
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normaliseRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y)
  }
}

export function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.w
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.h
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(rectRight(a), rectRight(b)) - x,
    h: Math.max(rectBottom(a), rectBottom(b)) - y
  }
}

export function inflateRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(rectRight(a) < b.x || rectRight(b) < a.x || rectBottom(a) < b.y || rectBottom(b) < a.y)
}

/** Where the ray from the rect centre towards `toward` leaves the rect. */
export function edgePoint(rect: Rect, toward: Point): Point {
  const centre = centreOf(rect)
  const dx = toward.x - centre.x
  const dy = toward.y - centre.y
  if (dx === 0 && dy === 0) return centre
  const halfW = rect.w / 2
  const halfH = rect.h / 2
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: centre.x + dx * scale, y: centre.y + dy * scale }
}

/**
 * Resolve an arrow's two ends. Bound ends follow the shape they point at, so a
 * connector keeps touching the border while the shapes around it move.
 */
export function arrowPoints(arrow: BoardElement, byId: Map<string, BoardElement>): { a: Point; b: Point } {
  const freeA: Point = { x: arrow.x1 ?? arrow.x, y: arrow.y1 ?? arrow.y }
  const freeB: Point = { x: arrow.x2 ?? arrow.x + arrow.w, y: arrow.y2 ?? arrow.y + arrow.h }
  const from = arrow.from ? byId.get(arrow.from) : undefined
  const to = arrow.to ? byId.get(arrow.to) : undefined
  const fromRect = from && from.type !== 'arrow' ? rectOf(from, byId) : null
  const toRect = to && to.type !== 'arrow' ? rectOf(to, byId) : null

  let a = freeA
  let b = freeB
  if (fromRect) a = edgePoint(fromRect, toRect ? centreOf(toRect) : freeB)
  if (toRect) b = edgePoint(toRect, fromRect ? centreOf(fromRect) : freeA)
  return { a, b }
}

/** Bounding box used for selection, marquee hits and resize handles. */
export function rectOf(element: BoardElement, byId: Map<string, BoardElement>): Rect {
  if (element.type === 'arrow') {
    const { a, b } = arrowPoints(element, byId)
    return normaliseRect(a, b)
  }
  return { x: element.x, y: element.y, w: element.w, h: element.h }
}

export function elementBounds(
  elements: BoardElement[],
  byId: Map<string, BoardElement>
): Rect | null {
  let bounds: Rect | null = null
  for (const element of elements) {
    const rect = rectOf(element, byId)
    bounds = bounds ? unionRect(bounds, rect) : { ...rect }
  }
  return bounds
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

export function strokePoints(element: BoardElement): Point[] {
  const points = element.points ?? []
  const result: Point[] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    result.push({ x: element.x + (points[i] ?? 0), y: element.y + (points[i + 1] ?? 0) })
  }
  return result
}

/** Hit test in world coordinates. `tolerance` is already divided by zoom. */
export function pointInElement(
  element: BoardElement,
  point: Point,
  byId: Map<string, BoardElement>,
  tolerance = 0
): boolean {
  const rect = inflateRect(rectOf(element, byId), tolerance)
  if (element.type === 'stroke') {
    const points = strokePoints(element)
    const half = (element.size ?? 3) / 2 + tolerance
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (a && b && distanceToSegment(point, a, b) <= half) return true
    }
    return false
  }
  if (element.type === 'arrow') {
    const { a, b } = arrowPoints(element, byId)
    return distanceToSegment(point, a, b) <= 8 + tolerance
  }
  if (element.type === 'ellipse') {
    const centre = centreOf(rect)
    const rx = Math.max(1, rect.w / 2)
    const ry = Math.max(1, rect.h / 2)
    const nx = (point.x - centre.x) / rx
    const ny = (point.y - centre.y) / ry
    return nx * nx + ny * ny <= 1.08
  }
  if (element.type === 'diamond') {
    const centre = centreOf(rect)
    const nx = Math.abs(point.x - centre.x) / Math.max(1, rect.w / 2)
    const ny = Math.abs(point.y - centre.y) / Math.max(1, rect.h / 2)
    return nx + ny <= 1.06
  }
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

export function shiftElement(element: BoardElement, dx: number, dy: number): void {
  if (element.type === 'arrow') {
    const a = { x: element.x1 ?? element.x, y: element.y1 ?? element.y }
    const b = { x: element.x2 ?? element.x + element.w, y: element.y2 ?? element.y + element.h }
    element.x1 = a.x + dx
    element.y1 = a.y + dy
    element.x2 = b.x + dx
    element.y2 = b.y + dy
    element.x = Math.min(element.x1, element.x2)
    element.y = Math.min(element.y1, element.y2)
    element.w = Math.abs(element.x2 - element.x1)
    element.h = Math.abs(element.y2 - element.y1)
    return
  }
  element.x += dx
  element.y += dy
}

/** Keep an arrow's stored bbox in sync with its free endpoints. */
export function syncArrowBounds(element: BoardElement): void {
  if (element.type !== 'arrow') return
  const a = { x: element.x1 ?? element.x, y: element.y1 ?? element.y }
  const b = { x: element.x2 ?? element.x + element.w, y: element.y2 ?? element.y + element.h }
  const rect = normaliseRect(a, b)
  element.x = rect.x
  element.y = rect.y
  element.w = rect.w
  element.h = rect.h
}

/** Smooth SVG path for a freehand stroke. */
export function strokePath(element: BoardElement): string {
  const points = strokePoints(element)
  if (!points.length) return ''
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M ${first.x} ${first.y} l 0.01 0`
  let d = `M ${first.x} ${first.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    if (!current || !next) continue
    const midX = (current.x + next.x) / 2
    const midY = (current.y + next.y) / 2
    d += ` Q ${current.x} ${current.y} ${midX} ${midY}`
  }
  const last = points[points.length - 1]
  if (last) d += ` L ${last.x} ${last.y}`
  return d
}

export function textPadding(element: BoardElement): number {
  if (element.type === 'note') return 12
  if (element.type === 'text') return 4
  return 14
}

export function fontSize(element: BoardElement): number {
  if (element.type === 'text') return element.size ?? 18
  if (element.type === 'note') return element.size ?? 14
  return element.size ?? 14
}

export const LINE_HEIGHT = 1.35

/* ------------------------------------------------------------------ */
/* Text layout                                                         */
/* ------------------------------------------------------------------ */

let measureContext: CanvasRenderingContext2D | null = null
const wordWidthCache = new Map<string, number>()
let fontFamilyHint = ''

function fontFamily(): string {
  if (fontFamilyHint) return fontFamilyHint
  if (typeof document === 'undefined') return 'system-ui, sans-serif'
  fontFamilyHint = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  return fontFamilyHint
}

/** Pixel width of a word for the canvas text style used by the board. */
export function measureWord(word: string, size: number, weight = 500): number {
  const key = `${weight}|${size}|${word}`
  const cached = wordWidthCache.get(key)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') {
    const approx = word.length * size * 0.55
    wordWidthCache.set(key, approx)
    return approx
  }
  measureContext ??= document.createElement('canvas').getContext('2d')
  let width = word.length * size * 0.55
  if (measureContext) {
    measureContext.font = `${weight} ${size}px ${fontFamily()}`
    width = measureContext.measureText(word).width
  }
  wordWidthCache.set(key, width)
  if (wordWidthCache.size > 4000) wordWidthCache.clear()
  return width
}

export function measureText(text: string, size: number): number {
  return measureWord(text, size)
}

/** Word-wrap that also honours explicit newlines and over-long words. */
export function wrapText(text: string, maxWidth: number, size: number, weight = 500): string[] {
  const source = text.replace(/\r\n?/g, '\n')
  if (!source) return []
  const lines: string[] = []
  for (const paragraph of source.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    let line = ''
    for (const rawWord of paragraph.split(/(\s+)/)) {
      const word = rawWord
      if (!word) continue
      const candidate = line ? `${line}${word}` : word.trimStart()
      if (candidate && measureWord(candidate.trimEnd(), size, weight) <= maxWidth) {
        line = candidate
        continue
      }
      if (line.trim()) {
        lines.push(line.trimEnd())
        line = word.trimStart()
        if (line && measureWord(line, size, weight) <= maxWidth) continue
      } else {
        line = word.trimStart()
      }
      // Break a single word that is wider than the box, character by character.
      let rest = line
      while (rest && measureWord(rest, size, weight) > maxWidth) {
        let cut = rest.length - 1
        while (cut > 1 && measureWord(rest.slice(0, cut), size, weight) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export function visibleLines(element: BoardElement): string[] {
  const pad = textPadding(element)
  const size = fontSize(element)
  const maxWidth = Math.max(24, element.w - pad * 2)
  const all = wrapText(element.text ?? '', maxWidth, size)
  const maxLines = Math.max(1, Math.floor((element.h - pad * 2) / (size * LINE_HEIGHT)))
  if (all.length <= maxLines) return all
  const clipped = all.slice(0, maxLines)
  const lastIndex = clipped.length - 1
  const last = clipped[lastIndex]
  if (last !== undefined) clipped[lastIndex] = `${last.replace(/\s+$/, '')}…`
  return clipped
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

const KNOWN_TYPES: BoardElementType[] = ['note', 'rect', 'ellipse', 'diamond', 'text', 'stroke', 'arrow']

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readTone(value: unknown): BoardTone {
  return typeof value === 'string' && (TONES as string[]).includes(value)
    ? (value as BoardTone)
    : 'slate'
}

function readElement(raw: unknown): BoardElement | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const type = source.type
  if (typeof type !== 'string' || !(KNOWN_TYPES as string[]).includes(type)) return null
  const element: BoardElement = {
    id: typeof source.id === 'string' && source.id ? source.id : uid(),
    type: type as BoardElementType,
    x: finite(source.x),
    y: finite(source.y),
    w: Math.max(1, finite(source.w, 1)),
    h: Math.max(1, finite(source.h, 1)),
    tone: readTone(source.tone)
  }
  if (typeof source.text === 'string') element.text = source.text.slice(0, 4000)
  if (typeof source.size === 'number' && Number.isFinite(source.size)) element.size = source.size
  if (Array.isArray(source.points)) {
    element.points = source.points
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .slice(0, 20000)
  }
  for (const key of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key])) element[key] = source[key] as number
  }
  if (typeof source.from === 'string' && source.from) element.from = source.from
  if (typeof source.to === 'string' && source.to) element.to = source.to
  return element
}

/** Parse a stored board. Returns null when the payload is not usable. */
export function parseBoard(raw: string | null): BoardDocument | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const source = parsed as Record<string, unknown>
  const list = Array.isArray(source.elements) ? source.elements : []
  const elements: BoardElement[] = []
  for (const rawElement of list.slice(0, BOARD_MAX_ELEMENTS)) {
    const element = readElement(rawElement)
    if (element) elements.push(element)
  }
  const ids = new Set(elements.map((element) => element.id))
  for (const element of elements) {
    if (element.from && !ids.has(element.from)) delete element.from
    if (element.to && !ids.has(element.to)) delete element.to
  }
  const rawView = (source.view ?? {}) as Record<string, unknown>
  const view: BoardView = {
    x: finite(rawView.x),
    y: finite(rawView.y),
    zoom: clamp(finite(rawView.zoom, 1), MIN_ZOOM, MAX_ZOOM)
  }
  return {
    version: BOARD_VERSION,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.slice(0, 80) : 'Untitled board',
    elements,
    view
  }
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'board'
}
