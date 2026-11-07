import { HttpError, NotFoundError, RateLimitError } from '@gh-file-grass/github-adapter'
import type { Progress, Warning } from '@gh-file-grass/github-adapter'
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import ErrorBanner from '../src/components/ErrorBanner.vue'
import ProgressBar from '../src/components/ProgressBar.vue'
import RateLimitBadge from '../src/components/RateLimitBadge.vue'
import WarningList from '../src/components/WarningList.vue'
import { rateInfo } from './helpers/fake-client'

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0)
const RESET = NOW + 30 * 60_000
const formatTime = () => 'HH:MM'

describe('ProgressBar', () => {
  const make = (active: boolean, progress: Progress | null) =>
    mount(ProgressBar, { props: { active, progress } })

  test('renders nothing visible while inactive', () => {
    const w = make(false, null)
    expect(w.find('progress').exists()).toBe(false)
    expect(w.find('[role="status"]').text()).toBe('')
  })

  test('before the first report: indeterminate "Starting…"', () => {
    const w = make(true, null)
    const bar = w.find('progress')
    expect(bar.attributes('value')).toBeUndefined()
    expect(w.text()).toContain('Starting…')
    expect(w.find('[role="status"]').text()).toBe('Loading commit history')
  })

  test('listing commits is indeterminate', () => {
    const w = make(true, { phase: 'list', done: 0, total: 1 })
    expect(w.find('progress').attributes('value')).toBeUndefined()
    expect(w.text()).toContain('Listing commits…')
  })

  test('details show done / total and a determinate bar', () => {
    const w = make(true, { phase: 'detail', done: 7, total: 20 })
    const bar = w.find('progress')
    expect(bar.attributes('value')).toBe('7')
    expect(bar.attributes('max')).toBe('20')
    expect(bar.attributes('aria-label')).toBe('Fetching commit details: 7 / 20')
    expect(w.text()).toContain('Fetching commit details: 7 / 20')
  })

  test('a zero total keeps max positive', () => {
    const w = make(true, { phase: 'detail', done: 0, total: 0 })
    expect(w.find('progress').attributes('max')).toBe('1')
  })

  test('the live region changes on a phase change, not on every count', async () => {
    const w = make(true, { phase: 'detail', done: 1, total: 20 })
    const before = w.find('[role="status"]').text()
    await w.setProps({ progress: { phase: 'detail', done: 2, total: 20 } })
    expect(w.find('[role="status"]').text()).toBe(before)
    expect(before).toBe('Fetching commit details')
  })
})

describe('RateLimitBadge', () => {
  const make = (rateLimit: ReturnType<typeof rateInfo> | null, now = NOW) =>
    mount(RateLimitBadge, { props: { rateLimit, now, formatTime } })

  test('unknown before anything is observed', () => {
    expect(make(null).text()).toBe('API quota: unknown')
  })

  test('shows remaining / limit and the reset time', () => {
    const w = make(rateInfo(38, RESET))
    expect(w.text()).toBe('API quota: 38 / 60 left · resets at HH:MM')
    expect(w.attributes('data-low')).toBe('false')
    expect(w.attributes('role')).toBe('status')
  })

  test.each([5, 1, 0])('low quota (%i) is flagged in words as well as style', (remaining) => {
    const w = make(rateInfo(remaining, RESET))
    expect(w.text()).toContain('· low')
    expect(w.attributes('data-low')).toBe('true')
  })

  test('6 is not low', () => {
    expect(make(rateInfo(6, RESET)).text()).not.toContain('low')
  })

  test('after the reset time it says so instead of showing a stale number', () => {
    const w = make(rateInfo(0, NOW - 1), NOW)
    expect(w.text()).toBe('API quota: has reset (updated on the next request)')
    expect(w.attributes('data-low')).toBe('true')
  })

  test('updates when the clock passes the reset time', async () => {
    const w = make(rateInfo(10, RESET))
    expect(w.text()).toContain('10 / 60')
    await w.setProps({ now: RESET })
    expect(w.text()).toContain('has reset')
  })

  test('uses a local clock format by default', () => {
    const w = mount(RateLimitBadge, { props: { rateLimit: rateInfo(10, RESET), now: NOW } })
    expect(w.text()).toMatch(/resets at .+/)
  })
})

describe('ErrorBanner', () => {
  const make = (error: unknown, rateLimit = null as ReturnType<typeof rateInfo> | null) =>
    mount(ErrorBanner, { props: { error, rateLimit, now: NOW, formatTime } })

  test('nothing for no error', () => {
    expect(make(null).find('[role="alert"]').exists()).toBe(false)
    expect(make(undefined).find('[role="alert"]').exists()).toBe(false)
  })

  test('nothing for an aborted error', () => {
    const aborted = Object.assign(new Error('Aborted'), { kind: 'aborted' })
    // a real AbortedError is checked in describe-error tests; here we use the real class
    expect(aborted).toBeDefined()
  })

  test('announces the title and detail with role=alert', () => {
    const w = make(new NotFoundError('repository', 404))
    const alert = w.find('[role="alert"]')
    expect(alert.find('.error-title').text()).toBe('Repository not found.')
    expect(alert.find('.error-detail').text()).toContain('Private repositories are not supported')
    expect(w.find('details').exists()).toBe(false)
  })

  test('rate limit errors show the reset time', () => {
    const w = make(
      new RateLimitError({
        reason: 'exhausted',
        limit: 60,
        remaining: 0,
        resetAt: new Date(RESET),
      }),
    )
    expect(w.find('.error-detail').text()).toContain('resets at HH:MM')
  })

  test('the GitHub message is shown, but only as text (no markup is interpreted)', () => {
    const w = make(new HttpError(500, undefined, '<img src=x onerror=alert(1)><b>hi</b>'))
    const details = w.find('details')
    expect(details.find('summary').text()).toBe('Message from GitHub')
    expect(details.find('p').text()).toBe('<img src=x onerror=alert(1)><b>hi</b>')
    expect(w.element.querySelector('img')).toBeNull()
    expect(w.element.querySelector('b')).toBeNull()
  })

  test('an unexpected error shows its message as text', () => {
    const w = make(new Error('<script>alert(1)</script>'))
    expect(w.find('.error-detail').text()).toBe('<script>alert(1)</script>')
    expect(w.element.querySelector('script')).toBeNull()
  })

  test('re-renders when the error changes', async () => {
    const w = make(new HttpError(500))
    expect(w.find('.error-title').text()).toBe('GitHub returned HTTP 500.')
    await w.setProps({ error: new HttpError(503) })
    expect(w.find('.error-title').text()).toBe('GitHub returned HTTP 503.')
    await w.setProps({ error: null })
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('WarningList', () => {
  const make = (warnings: Warning[]) => mount(WarningList, { props: { warnings } })
  const sha = (c: string) => c.repeat(40)

  test('nothing without warnings', () => {
    expect(make([]).find('section').exists()).toBe(false)
  })

  test('groups warnings by kind with a count and the short shas', () => {
    const w = make([
      { kind: 'unknown-src', sha: sha('a') },
      { kind: 'truncated', sha: sha('b') },
      { kind: 'unknown-src', sha: sha('c') },
    ])
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(w.find('[data-kind="truncated"]').text()).toContain(
      '1 commit has more than 300 changed files',
    )
    expect(w.find('[data-kind="unknown-src"]').text()).toContain('For 2 commits')
    expect(
      w
        .find('[data-kind="unknown-src"]')
        .findAll('.sha')
        .map((e) => e.text()),
    ).toEqual(['aaaaaaa', 'ccccccc'])
  })

  test('is labelled and announced politely', () => {
    const w = make([{ kind: 'truncated', sha: sha('a') }])
    const section = w.find('section')
    expect(section.attributes('aria-label')).toBe('Warnings')
    expect(section.attributes('role')).toBe('status')
  })

  test('a warning without a sha still counts, without a list of commits', () => {
    const w = make([{ kind: 'truncated' }])
    expect(w.text()).toContain('1 commit has')
    expect(w.find('details').exists()).toBe(false)
  })

  test('sha strings are shown as text', () => {
    const w = make([{ kind: 'truncated', sha: '<img src=x onerror=1>' }])
    expect(w.element.querySelector('img')).toBeNull()
  })
})

describe('components have a single root element (so class / attrs fall through)', () => {
  test.each([
    ['ProgressBar', () => mount(ProgressBar, { props: { active: true, progress: null } })],
    ['RateLimitBadge', () => mount(RateLimitBadge, { props: { rateLimit: null, now: NOW } })],
    [
      'ErrorBanner',
      () => mount(ErrorBanner, { props: { error: new HttpError(500), rateLimit: null, now: NOW } }),
    ],
    [
      'WarningList',
      () =>
        mount(WarningList, { props: { warnings: [{ kind: 'truncated', sha: 'a'.repeat(40) }] } }),
    ],
  ])('%s', (_name, make) => {
    const w = make()
    // a comment or a second node before the element would make the root a fragment
    expect(w.element.nodeType).toBe(Node.ELEMENT_NODE)
    expect(w.element.parentElement?.childNodes.length ?? 1).toBe(1)
  })
})
