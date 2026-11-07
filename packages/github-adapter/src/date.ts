const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  // undefined(実行環境の既定)と空文字を区別する
  const key = timeZone === undefined ? 'default' : `tz:${timeZone}`
  let f = formatters.get(key)
  if (!f) {
    // 不正な timeZone は RangeError をそのまま投げる(呼び出し側のバグ)
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(key, f)
  }
  return f
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0')

/**
 * ISO 8601 の日時を、Ruby の `Time#to_s` と同じ `YYYY-MM-DD HH:MM:SS +HHMM` に整形する。
 * `timeZone` は IANA 名('Asia/Tokyo' など)。省略すると実行環境の既定 TZ。
 * 日時として解釈できない文字列は RangeError。
 */
export function formatGitDate(iso: string, timeZone?: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid date: ${iso}`)

  const parts: Record<string, number> = {}
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts

  // オフセット = 「その TZ の壁時計を UTC とみなした時刻」 − 実際の時刻(秒未満は切り捨て)
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const epochSeconds = Math.floor(instant.getTime() / 1000) * 1000
  const offsetMinutes = Math.round((wallAsUtc - epochSeconds) / 60000)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(offsetMinutes)

  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  )
}

/** timeZone が不正なら RangeError。リクエストを送る前に呼び出し側のバグを検出するために使う */
export function assertTimeZone(timeZone?: string): void {
  formatterFor(timeZone)
}
