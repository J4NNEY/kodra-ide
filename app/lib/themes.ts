/**
 * Theme definitions shared by the app shell, the editor and extensions.
 *
 * A theme is plain data: a palette of UI colours plus a syntax palette. The
 * shell maps the palette onto CSS custom properties, CodeMirror turns the syntax
 * palette into a `HighlightStyle`, and xterm uses the terminal overrides.
 */

export type ThemeKind = 'dark' | 'light'

export const COLOR_KEYS = [
  'surface0',
  'surface1',
  'surface2',
  'surface3',
  'surface4',
  'canvas',
  'glass',
  'glassStrong',
  'border',
  'borderStrong',
  'text',
  'textDim',
  'textMuted',
  'textFaint',
  'accent',
  'accentStrong',
  'green',
  'red',
  'blue',
  'purple',
  'orange'
] as const

export type ColorKey = (typeof COLOR_KEYS)[number]
export type ThemeColors = Record<ColorKey, string>

export const SYNTAX_KEYS = [
  'keyword',
  'operator',
  'string',
  'number',
  'comment',
  'variable',
  'function',
  'type',
  'tag',
  'attribute',
  'heading',
  'link',
  'meta',
  'invalid'
] as const

export type SyntaxKey = (typeof SYNTAX_KEYS)[number]

export interface SyntaxStyle {
  color?: string
  italic?: boolean
  bold?: boolean
}

export type SyntaxPalette = Record<SyntaxKey, SyntaxStyle>

export interface TerminalColors {
  background?: string
  foreground?: string
  cursor?: string
  selection?: string
}

export interface Theme {
  id: string
  name: string
  kind: ThemeKind
  colors: ThemeColors
  syntax: SyntaxPalette
  terminal?: TerminalColors
  /** Folder of the extension that contributed the theme. */
  extension?: string
}

const SURFACE_DARK: ThemeColors = {
  surface0: '#0a0a0a',
  surface1: '#0f0f0f',
  surface2: '#141414',
  surface3: '#181818',
  surface4: '#2a2a2a',
  canvas: '#000000',
  glass: '#ffffff12',
  glassStrong: '#ffffff24',
  border: '#ffffff10',
  borderStrong: '#ffffff1c',
  text: '#e6e6e9',
  textDim: '#a1a1aa',
  textMuted: '#71717a',
  textFaint: '#52525b',
  accent: '#d4a73c',
  accentStrong: '#ffc857',
  green: '#73c991',
  red: '#e4676b',
  blue: '#6cb6ff',
  purple: '#c792ea',
  orange: '#e2a03f'
}

const SYNTAX_DARK: SyntaxPalette = {
  keyword: { color: '#c792ea' },
  operator: { color: '#89ddff' },
  string: { color: '#c3e88d' },
  number: { color: '#f78c6c' },
  comment: { color: '#5c6773', italic: true },
  variable: { color: '#d6deeb' },
  function: { color: '#82aaff' },
  type: { color: '#ffcb6b' },
  tag: { color: '#f07178' },
  attribute: { color: '#c792ea' },
  heading: { color: '#d4a73c', bold: true },
  link: { color: '#6cb6ff' },
  meta: { color: '#8aa9c9' },
  invalid: { color: '#e4676b' }
}

const SURFACE_LIGHT: ThemeColors = {
  ...SURFACE_DARK,
  surface0: '#f3f4f6',
  surface1: '#ffffff',
  surface2: '#f7f7f8',
  surface3: '#f0f0f2',
  surface4: '#e6e7ea',
  canvas: '#eceef1',
  glass: '#0000000a',
  glassStrong: '#00000014',
  border: '#00000012',
  borderStrong: '#0000001f',
  text: '#18181b',
  textDim: '#52525b',
  textMuted: '#71717a',
  textFaint: '#a1a1aa'
}

const SYNTAX_LIGHT: SyntaxPalette = {
  keyword: { color: '#a626a4' },
  operator: { color: '#0550ae' },
  string: { color: '#0a7d33' },
  number: { color: '#b75501' },
  comment: { color: '#8b949e', italic: true },
  variable: { color: '#24292f' },
  function: { color: '#0550ae' },
  type: { color: '#953800' },
  tag: { color: '#c41a16' },
  attribute: { color: '#8250df' },
  heading: { color: '#9a6700', bold: true },
  link: { color: '#0b5cad' },
  meta: { color: '#57606a' },
  invalid: { color: '#d1242f' }
}

export const builtinThemes: Theme[] = [
  {
    id: 'kudo-dark',
    name: 'Kudo Dark',
    kind: 'dark',
    colors: SURFACE_DARK,
    syntax: SYNTAX_DARK
  },
  {
    id: 'kudo-light',
    name: 'Kudo Light',
    kind: 'light',
    colors: SURFACE_LIGHT,
    syntax: SYNTAX_LIGHT
  },
  {
    id: 'midnight',
    name: 'Midnight',
    kind: 'dark',
    colors: {
      ...SURFACE_DARK,
      surface0: '#080b16',
      surface1: '#0b1020',
      surface2: '#10172b',
      surface3: '#152038',
      surface4: '#223253',
      canvas: '#05070f',
      border: '#7aa2f71a',
      borderStrong: '#7aa2f733',
      text: '#c8d3f5',
      textDim: '#9aa7cc',
      textMuted: '#6f7ca8',
      textFaint: '#4a5578',
      accent: '#5cc8ff',
      accentStrong: '#82dcff',
      blue: '#5cc8ff',
      purple: '#b39dff',
      green: '#8bd49c'
    },
    syntax: {
      keyword: { color: '#7aa2f7' },
      operator: { color: '#89ddff' },
      string: { color: '#9ece6a' },
      number: { color: '#ff9e64' },
      comment: { color: '#565f89', italic: true },
      variable: { color: '#c0caf5' },
      function: { color: '#7aa2f7' },
      type: { color: '#e0af68' },
      tag: { color: '#f7768e' },
      attribute: { color: '#bb9af7' },
      heading: { color: '#7dcfff', bold: true },
      link: { color: '#2ac3de' },
      meta: { color: '#a9b1d6' },
      invalid: { color: '#f7768e' }
    },
    terminal: { background: '#0b1020', selection: '#7aa2f744' }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    kind: 'dark',
    colors: {
      ...SURFACE_DARK,
      surface0: '#101112',
      surface1: '#161719',
      surface2: '#1b1d1f',
      surface3: '#222427',
      surface4: '#2e3134',
      canvas: '#0b0c0d',
      text: '#d7dae0',
      textDim: '#9fa5ad',
      textMuted: '#787f88',
      textFaint: '#565c64',
      accent: '#7ddba3',
      accentStrong: '#9bf0bd',
      green: '#7ddba3'
    },
    syntax: {
      keyword: { color: '#c678dd' },
      operator: { color: '#56b6c2' },
      string: { color: '#98c379' },
      number: { color: '#d19a66' },
      comment: { color: '#5c6370', italic: true },
      variable: { color: '#abb2bf' },
      function: { color: '#61afef' },
      type: { color: '#e5c07b' },
      tag: { color: '#e06c75' },
      attribute: { color: '#d19a66' },
      heading: { color: '#61afef', bold: true },
      link: { color: '#56b6c2' },
      meta: { color: '#7f848e' },
      invalid: { color: '#e06c75' }
    }
  },
  {
    id: 'sand',
    name: 'Sand',
    kind: 'light',
    colors: {
      ...SURFACE_LIGHT,
      surface0: '#f6f0e4',
      surface1: '#fdf9f1',
      surface2: '#f8f2e7',
      surface3: '#f0e8d9',
      surface4: '#e3d8c4',
      canvas: '#efe8da',
      border: '#8a6d3b1f',
      borderStrong: '#8a6d3b33',
      text: '#2f2a22',
      textDim: '#5d5546',
      textMuted: '#7a7160',
      textFaint: '#a79c88',
      accent: '#b8722c',
      accentStrong: '#d98a3c',
      green: '#5e8c4a',
      red: '#b34a3c',
      blue: '#3d6f9e',
      purple: '#86609c',
      orange: '#c07a25'
    },
    syntax: {
      keyword: { color: '#859900' },
      operator: { color: '#657b83' },
      string: { color: '#2aa198' },
      number: { color: '#d33682' },
      comment: { color: '#93a1a1', italic: true },
      variable: { color: '#073642' },
      function: { color: '#268bd2' },
      type: { color: '#b58900' },
      tag: { color: '#dc322f' },
      attribute: { color: '#6c71c4' },
      heading: { color: '#cb4b16', bold: true },
      link: { color: '#268bd2' },
      meta: { color: '#93a1a1' },
      invalid: { color: '#dc322f' }
    },
    terminal: { background: '#fdf9f1' }
  },
  {
    id: 'violet',
    name: 'Violet',
    kind: 'dark',
    colors: {
      ...SURFACE_DARK,
      surface0: '#0e0b14',
      surface1: '#141020',
      surface2: '#1a1528',
      surface3: '#221a33',
      surface4: '#392b52',
      canvas: '#0a0710',
      border: '#c792ea1f',
      borderStrong: '#c792ea38',
      text: '#ece7f7',
      textDim: '#b9b0cf',
      textMuted: '#8a7fa6',
      textFaint: '#635a7c',
      accent: '#c792ea',
      accentStrong: '#e0b8ff',
      purple: '#c792ea',
      blue: '#82aaff'
    },
    syntax: {
      ...SYNTAX_DARK,
      comment: { color: '#5f5a78', italic: true },
      variable: { color: '#e2dff5' },
      heading: { color: '#c3a6ff', bold: true },
      meta: { color: '#9a92b8' }
    }
  }
]

const DEFAULT_THEME_ID = 'kudo-dark'

/** Nuxt state key holding themes contributed by enabled extensions. */
export const EXTENSION_THEMES_KEY = 'kudo:extension-themes'

const COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value.trim())
}

export function baseThemeFor(kind: ThemeKind): Theme {
  return kind === 'light' ? builtinThemes[1]! : builtinThemes[0]!
}

/** Legacy `dark`/`light` values and unknown ids resolve to a built-in theme. */
export function themeIdFor(id: string | undefined): string {
  if (!id) return DEFAULT_THEME_ID
  const value = id.trim()
  if (value === 'dark') return 'kudo-dark'
  if (value === 'light') return 'kudo-light'
  return value || DEFAULT_THEME_ID
}

export function kindOfTheme(id: string | undefined, themes: Theme[]): ThemeKind {
  const found = themes.find((theme) => theme.id === themeIdFor(id))
  return found?.kind ?? 'dark'
}

/**
 * Turn an extension theme contribution into a full theme. Missing colours and
 * syntax rules inherit from the built-in theme of the same kind, so extension
 * authors only need to list what they change.
 */
export function normalizeTheme(raw: unknown, extension?: string): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!ID_RE.test(id) || id === 'system') return null
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 60)
      : id
  const kind: ThemeKind = source.kind === 'light' ? 'light' : 'dark'
  const base = baseThemeFor(kind)

  const colors: ThemeColors = { ...base.colors }
  const rawColors = source.colors
  if (rawColors && typeof rawColors === 'object') {
    for (const key of COLOR_KEYS) {
      const value = (rawColors as Record<string, unknown>)[key]
      if (isColor(value)) colors[key] = value.trim()
    }
  }

  const syntax: SyntaxPalette = { ...base.syntax }
  const rawSyntax = source.syntax
  if (rawSyntax && typeof rawSyntax === 'object') {
    for (const key of SYNTAX_KEYS) {
      const rule = (rawSyntax as Record<string, unknown>)[key]
      if (!rule || typeof rule !== 'object') continue
      const style = rule as Record<string, unknown>
      const next: SyntaxStyle = { ...syntax[key] }
      if (isColor(style.color)) next.color = style.color.trim()
      if (style.italic === true) next.italic = true
      else if (style.italic === false) delete next.italic
      if (style.bold === true) next.bold = true
      else if (style.bold === false) delete next.bold
      syntax[key] = next
    }
  }

  const terminal: TerminalColors = {}
  const rawTerminal = source.terminal
  if (rawTerminal && typeof rawTerminal === 'object') {
    for (const key of ['background', 'foreground', 'cursor', 'selection'] as const) {
      const value = (rawTerminal as Record<string, unknown>)[key]
      if (isColor(value)) terminal[key] = value.trim()
    }
  }

  return {
    id,
    name,
    kind,
    colors,
    syntax,
    ...(Object.keys(terminal).length ? { terminal } : {}),
    ...(extension ? { extension } : {})
  }
}

const CSS_VAR: Record<ColorKey, string> = {
  surface0: '--surface-0',
  surface1: '--surface-1',
  surface2: '--surface-2',
  surface3: '--surface-3',
  surface4: '--surface-4',
  canvas: '--canvas',
  glass: '--glass',
  glassStrong: '--glass-strong',
  border: '--border',
  borderStrong: '--border-strong',
  text: '--text',
  textDim: '--text-dim',
  textMuted: '--text-muted',
  textFaint: '--text-faint',
  accent: '--accent',
  accentStrong: '--accent-strong',
  green: '--green',
  red: '--red',
  blue: '--blue',
  purple: '--purple',
  orange: '--orange'
}

const SHADOW_DARK = '0 24px 64px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.06)'
const SHADOW_LIGHT = '0 24px 64px -16px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.06)'

/** Apply a theme (plus the user's accent and typography) to the document. */
export function applyThemeVars(
  theme: Theme,
  options: { accent?: string; fontSize?: number; fontFamily?: string } = {}
) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme.kind
  for (const key of COLOR_KEYS) {
    root.style.setProperty(CSS_VAR[key], theme.colors[key])
  }
  // Expose the syntax palette to CSS so semantic tokens added on top of the
  // syntax tree can use the same colours as the theme.
  for (const key of SYNTAX_KEYS) {
    const color = theme.syntax[key]?.color
    if (color) root.style.setProperty(`--syntax-${key}`, color)
  }
  const accent = isColor(options.accent) ? options.accent : theme.colors.accent
  root.style.setProperty('--accent', accent)
  root.style.setProperty(
    '--accent-soft',
    accent.length === 4 || accent.length === 7 ? `${accent}22` : theme.colors.accent + '22'
  )
  if (typeof options.fontSize === 'number') {
    root.style.setProperty('--fs-mono', `${options.fontSize}px`)
  }
  if (options.fontFamily) root.style.setProperty('--font-mono', options.fontFamily)
  root.style.setProperty('--shadow-lg', theme.kind === 'light' ? SHADOW_LIGHT : SHADOW_DARK)
}

/** Resolve `system` (and legacy ids) against the current theme list. */
export function resolveTheme(
  id: string | undefined,
  themes: Theme[],
  prefersLight = false
): Theme {
  if (id === 'system' || id === 'auto') {
    return themes.find((t) => t.id === (prefersLight ? 'kudo-light' : 'kudo-dark')) ?? builtinThemes[0]!
  }
  const wanted = themeIdFor(id)
  return themes.find((t) => t.id === wanted) ?? builtinThemes[0]!
}

export interface SnippetContribution {
  prefix: string
  body: string
  description?: string
  language?: string
  extension?: string
}

/** Snippet bodies pasted into an editor stay small enough to render safely. */
const MAX_SNIPPET_PREFIX = 64
const MAX_SNIPPET_BODY = 8000

/** Validate a snippet from an extension manifest. */
export function normalizeSnippet(raw: unknown, extension?: string): SnippetContribution | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const prefix = typeof source.prefix === 'string' ? source.prefix.trim() : ''
  const body = typeof source.body === 'string' ? source.body : ''
  if (!prefix || !body) return null
  if (prefix.length > MAX_SNIPPET_PREFIX || body.length > MAX_SNIPPET_BODY) return null
  const description =
    typeof source.description === 'string' ? source.description.trim().slice(0, 120) : ''
  const language = typeof source.language === 'string' ? source.language.trim() : ''
  return {
    prefix,
    body,
    ...(description ? { description } : {}),
    ...(language ? { language } : {}),
    ...(extension ? { extension } : {})
  }
}

/** Replace `${1:label}` style tab stops with their text and drop bare stops. */
export function expandSnippet(body: string): string {
  return body
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$\d+/g, '')
}
