import { describe, expect, test } from 'vitest'
import { formatGitDate } from '../src/date'
import { loadDetails, loadLogsJson } from './helpers/fixtures'

describe('formatGitDate', () => {
  test.each([
    ['2022-05-02T14:21:38Z', 'Asia/Tokyo', '2022-05-02 23:21:38 +0900'],
    ['2022-05-02T14:21:38Z', 'UTC', '2022-05-02 14:21:38 +0000'],
    ['2022-05-02T14:21:38Z', 'Asia/Kolkata', '2022-05-02 19:51:38 +0530'],
    ['2022-05-02T14:21:38Z', 'America/St_Johns', '2022-05-02 11:51:38 -0230'],
    // DST 前後(2022-03-13 に米東部が EST -0500 -> EDT -0400)
    ['2022-03-13T06:59:59Z', 'America/New_York', '2022-03-13 01:59:59 -0500'],
    ['2022-03-13T07:00:00Z', 'America/New_York', '2022-03-13 03:00:00 -0400'],
    // 0 時は '24' ではなく '00'
    ['2022-05-01T15:00:00Z', 'Asia/Tokyo', '2022-05-02 00:00:00 +0900'],
    // 日付をまたぐ
    ['2022-12-31T20:30:00Z', 'Asia/Tokyo', '2023-01-01 05:30:00 +0900'],
    // 入力にオフセット表記があっても同じ瞬間として扱う
    ['2022-05-02T23:21:38+09:00', 'UTC', '2022-05-02 14:21:38 +0000'],
    // 小数秒は切り捨て
    ['2022-05-02T14:21:38.999Z', 'UTC', '2022-05-02 14:21:38 +0000'],
  ])('%s in %s', (iso, tz, expected) => {
    expect(formatGitDate(iso, tz)).toBe(expected)
  })

  test('default time zone yields the same shape', () => {
    expect(formatGitDate('2022-05-02T14:21:38Z')).toMatch(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}$/,
    )
  })

  test('invalid time zone throws', () => {
    expect(() => formatGitDate('2022-05-02T14:21:38Z', 'Not/AZone')).toThrow(RangeError)
  })

  test('invalid date throws', () => {
    expect(() => formatGitDate('yesterday-ish', 'UTC')).toThrow(RangeError)
  })

  test('committer.date of all recorded commits reproduces the Ruby date (Asia/Tokyo)', () => {
    const logs = loadLogsJson()
    const details = loadDetails()
    // ルートは Ruby が `git show` の別書式で出すので除外(時刻値の一致は golden で確認する)
    const nonRoot = details.slice(0, -1)
    expect(nonRoot).toHaveLength(63)
    nonRoot.forEach((d, i) => {
      expect(formatGitDate(d.commit.committer!.date!, 'Asia/Tokyo')).toBe(logs.commits[i]!.date)
    })
  })
})
