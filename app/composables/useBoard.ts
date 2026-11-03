/**
 * Open state for the full-screen whiteboard. The board contents themselves are
 * loaded and saved by `BoardOverlay.vue`, keyed by workspace.
 */
export function useBoard() {
  const open = useState<boolean>('kodra:board-open', () => false)

  function show() {
    open.value = true
  }

  function hide() {
    open.value = false
  }

  function toggle() {
    open.value = !open.value
  }

  return { open, show, hide, toggle }
}
