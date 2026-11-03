import { computed } from 'vue'
import type { Settings } from '../lib/types'
import { defaultSettings } from '../lib/defaults'
import {
  EXTENSION_THEMES_KEY,
  applyThemeVars,
  builtinThemes,
  resolveTheme,
  type Theme
} from '../lib/themes'

/**
 * Theme registry: built-in palettes plus whatever enabled extensions contribute.
 * Keeps the selected theme in sync with the CSS variables the shell renders.
 */
export function useThemes() {
  const settings = useState<Settings>('kodra:settings', () => structuredClone(defaultSettings))
  const prefersLight = useState<boolean>('kodra:prefers-light', () => false)
  const extensionThemes = useState<Theme[]>(EXTENSION_THEMES_KEY, () => [])

  const all = computed<Theme[]>(() => {
    const extra = extensionThemes.value.filter(
      (theme) => !builtinThemes.some((builtin) => builtin.id === theme.id)
    )
    return [...builtinThemes, ...extra]
  })

  function byId(id: string | undefined): Theme {
    return resolveTheme(id, all.value, prefersLight.value)
  }

  const active = computed<Theme>(() =>
    settings.value.theme === 'system' || settings.value.theme === 'auto'
      ? resolveTheme(settings.value.theme, all.value, prefersLight.value)
      : byId(settings.value.theme)
  )

  function apply(theme?: Theme, accent?: string) {
    applyThemeVars(theme ?? active.value, {
      accent: accent ?? settings.value.accent,
      fontSize: settings.value.fontSize,
      fontFamily: settings.value.fontFamily
    })
  }

  /** Preview a theme without saving it (used by the settings dialog). */
  function preview(id: string, accent?: string) {
    apply(byId(id), accent ?? byId(id).colors.accent)
  }

  function setExtensionThemes(themes: Theme[]) {
    extensionThemes.value = themes
  }

  return {
    all,
    active,
    byId,
    apply,
    preview,
    setExtensionThemes
  }
}
