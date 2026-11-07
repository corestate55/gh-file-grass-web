/** 時刻(時:分)の表示。ブラウザのロケールに従う */
export function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
