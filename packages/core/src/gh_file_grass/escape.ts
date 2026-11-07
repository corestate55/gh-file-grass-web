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
