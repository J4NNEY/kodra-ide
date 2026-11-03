/**
 * Lightweight shared log used by the "Output" panel tab and by background
 * operations (terminal lifecycle, git, agent tool runs).
 */
export interface LogLine {
  id: number
  time: number
  channel: string
  text: string
}

let seq = 0

export function useOutputLog() {
  const lines = useState<LogLine[]>('kodra:output-log', () => [])

  function push(channel: string, text: string) {
    const entry: LogLine = { id: ++seq, time: Date.now(), channel, text }
    lines.value = [...lines.value, entry].slice(-500)
    return entry
  }

  function clear() {
    lines.value = []
  }

  return { lines, push, clear }
}
