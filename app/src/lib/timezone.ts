/**
 * ブラウザのタイムゾーン(IANA 名)。取得できない・検証に通らないときは undefined
 * (adapter は実行環境の既定にフォールバックする)。
 */
export function resolveTimeZone(): string | undefined {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return undefined
    new Intl.DateTimeFormat('en', { timeZone: tz }) // 不正なら RangeError
    return tz
  } catch {
    return undefined
  }
}
