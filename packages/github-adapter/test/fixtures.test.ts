import { describe, expect, test } from 'vitest'
import { loadDetails, loadLogsJson } from './helpers/fixtures'

describe('recorded fixtures', () => {
  test('API order matches logs.json commit order (Step 0 ②)', () => {
    const details = loadDetails()
    const logs = loadLogsJson()
    expect(details).toHaveLength(64)
    expect(details.map((d) => d.sha)).toEqual(logs.commits.map((c) => c.sha))
  })

  test('loadDetails(k) returns the newest k commits', () => {
    expect(loadDetails(10).map((d) => d.sha)).toEqual(
      loadDetails()
        .slice(0, 10)
        .map((d) => d.sha),
    )
  })

  test('root commit has no parents, others have at least one', () => {
    const details = loadDetails()
    expect(details.at(-1)!.parents).toHaveLength(0)
    expect(details.slice(0, -1).every((d) => d.parents.length >= 1)).toBe(true)
  })
})
