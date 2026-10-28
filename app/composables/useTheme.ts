import { EXTENSION_THEMES_KEY, builtinThemes, kindOfTheme, type Theme } from '../lib/themes'

/**
 * Resolves the theme the UI is actually showing (system preference included)
 * so canvas-based widgets (xterm, CodeMirror highlighting) can follow it.
 */
export function usePrefersLight() {
  const prefersLight = useState<boolean>('kudo:prefers-light', () => false)

  if (import.meta.client) {
    onMounted(() => {
      const query = window.matchMedia('(prefers-color-scheme: light)')
      prefersLight.value = query.matches
      const handler = (event: MediaQueryListEvent) => {
        prefersLight.value = event.matches
      }
      query.addEventListener('change', handler)
      onBeforeUnmount(() => query.removeEventListener('change', handler))
    })
  }

  return prefersLight
}

export function useEffectiveTheme() {
  const ide = useIde()
  const prefersLight = usePrefersLight()
  const extensionThemes = useState<Theme[]>(EXTENSION_THEMES_KEY, () => [])

  return computed<'dark' | 'light'>(() => {
    const theme = ide.settings.value.theme
    if (theme === 'system' || theme === 'auto') {
      return prefersLight.value ? 'light' : 'dark'
    }
    return kindOfTheme(theme, [...builtinThemes, ...extensionThemes.value])
  })
}
