const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape text to be embedded in HTML (element content or quoted attribute). */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

/** Encode each '/'-separated segment of a URL path (keeps the separators). */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Only http(s) URLs may be used as link targets (rejects e.g. `javascript:`). */
export function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '#'
}

/**
 * 長い文章をツールチップ向けに省略する。行数と文字数の両方に上限があり、超えたら末尾に '…' を付ける。
 * 末尾の空白は取り除く。サロゲートペアの途中では切らない。
 */
export function truncateText(text: string, maxLines: number, maxChars: number): string {
  const trimmed = text.replace(/\s+$/, '')
  const lines = trimmed.split(/\r\n|\r|\n/)
  let out = lines.slice(0, maxLines).join('\n')
  let cut = lines.length > maxLines
  if (out.length > maxChars) {
    out = out.slice(0, maxChars)
    const last = out.charCodeAt(out.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1) // 高位サロゲートだけが残った
    cut = true
  }
  return cut ? `${out.replace(/\s+$/, '')}…` : out
}
