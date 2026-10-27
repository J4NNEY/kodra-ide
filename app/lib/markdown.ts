/**
 * Tiny markdown renderer used by the agent transcript.
 * Input is escaped before any markup is produced, so the output is safe to
 * hand to `v-html` even when the model echoes untrusted file contents.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function inline(raw: string): string {
  let out = escapeHtml(raw)

  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  )
  out = out.replace(
    /(^|\s)(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>'
  )
  return out
}

function isFence(line: string): { lang: string } | null {
  const match = /^\s*```([\w+-]*)\s*$/.exec(line)
  return match ? { lang: match[1] ?? '' } : null
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []

  let inFence = false
  let fenceLang = ''
  let code: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const closeList = () => {
    if (listType) html.push(`</${listType}>`)
    listType = null
  }
  const flush = () => {
    flushParagraph()
    closeList()
  }

  for (const line of lines) {
    const fence = isFence(line)
    if (fence) {
      if (inFence) {
        html.push(
          `<pre><code data-lang="${escapeHtml(fenceLang)}">${escapeHtml(
            code.join('\n')
          )}</code></pre>`
        )
        inFence = false
        code = []
        fenceLang = ''
      } else {
        flush()
        inFence = true
        fenceLang = fence.lang
      }
      continue
    }

    if (inFence) {
      code.push(line)
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(heading[1].length + 1, 5)
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush()
      html.push('<hr />')
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      closeList()
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      flushParagraph()
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    paragraph.push(line.trim())
  }

  if (inFence && code.length) {
    html.push(
      `<pre><code data-lang="${escapeHtml(fenceLang)}">${escapeHtml(code.join('\n'))}</code></pre>`
    )
  }
  flush()

  return html.join('\n')
}
