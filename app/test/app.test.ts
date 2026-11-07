import {
  GitHubClient,
  HttpError,
  NetworkError,
  NotFoundError,
  RateLimitError,
} from '@gh-file-grass/github-adapter'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import App from '../src/App.vue'
import { HISTORY_CLIENT } from '../src/lib/client'
import type { HistoryClient } from '../src/lib/client'
import { branchList, createFakeClient, historyResult, rateInfo } from './helpers/fake-client'
import type { FakeClient } from './helpers/fake-client'
import { sampleData } from './helpers/graph-data'

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0)
const RESET = NOW + 30 * 60_000

// FileGrassView は別にテスト済み。ここでは data を受け取ったことと error の発火だけ見る
const ViewStub = defineComponent({
  props: { data: { type: Object, required: true } },
  emits: ['error'],
  render() {
    return h('div', {
      class: 'view-stub',
      'data-branch': (this.data as { branch: string }).branch,
      onClick: () => this.$emit('error', new Error('draw failed')),
    })
  },
})

let wrappers: VueWrapper[] = []
function mountApp(fake: { client: HistoryClient }) {
  const w = mount(App, {
    global: {
      provide: { [HISTORY_CLIENT as unknown as string]: fake.client },
      stubs: { FileGrassView: ViewStub },
    },
  })
  wrappers.push(w)
  return w
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers = []
  vi.useRealTimers()
})

// --- helpers ---
const buttonByText = (w: VueWrapper, text: string) =>
  w.findAll('button').find((b) => b.text() === text)
const showButton = (w: VueWrapper) => buttonByText(w, 'Show')!
const isDisabled = (el: { attributes: (n: string) => string | undefined }) =>
  el.attributes('disabled') !== undefined

async function submitRepo(w: VueWrapper, input: string) {
  await w.find('input[type="text"]').setValue(input)
  await w.find('form.repo-form').trigger('submit')
  await flushPromises()
}
async function loadBranches(
  w: VueWrapper,
  fake: FakeClient,
  names = ['main', 'dev'],
  hasMore = false,
) {
  await w.find('input[type="text"]').setValue('o/r')
  await w.find('form.repo-form').trigger('submit')
  fake.branchesCalls.at(-1)!.resolve(branchList(names, hasMore))
  await flushPromises()
}
async function typeCount(w: VueWrapper, text: string, commit = true) {
  const input = w.find('input[type="number"]')
  ;(input.element as HTMLInputElement).value = text
  await input.trigger('input')
  if (commit) await input.trigger('change')
}
async function pickBranch(w: VueWrapper, name: string) {
  await w.find('select').setValue(name)
  await flushPromises()
}
async function show(w: VueWrapper) {
  await w.find('form.show-form').trigger('submit')
  await flushPromises()
}
const alertText = (w: VueWrapper) => w.find('[role="alert"]').text()

describe('startup', () => {
  test('asks for the quota once (free), shows it, and starts in the empty state', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(42, RESET)
    const w = mountApp(fake)
    await flushPromises()
    expect(fake.rateLimitCalls).toBe(1)
    expect(w.find('.badge').text()).toContain('42 / 60 left')
    expect(w.find('.intro').text()).toMatch(/60 requests per hour/)
    expect(isDisabled(showButton(w))).toBe(true)
    expect(w.find('select').attributes('disabled')).toBeDefined()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(fake.branchesCalls).toHaveLength(0)
  })

  test('a failing quota request is ignored', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = new HttpError(500)
    const w = mountApp(fake)
    await flushPromises()
    expect(w.find('.badge').text()).toBe('API quota: unknown')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('loading branches', () => {
  test('submitting loads the branches and selects main', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await w.find('input[type="text"]').setValue(' https://github.com/vuejs/core ')
    await w.find('form.repo-form').trigger('submit')
    expect(fake.branchesCalls[0]!.ref).toEqual({ owner: 'vuejs', repo: 'core' })
    expect(isDisabled(w.find('form.repo-form button'))).toBe(true) // busy
    fake.branchesCalls[0]!.resolve(branchList(['dev', 'main', 'next']))
    await flushPromises()
    expect((w.find('select').element as HTMLSelectElement).value).toBe('main')
    expect(w.findAll('option').map((o) => o.text())).toEqual(['dev', 'main', 'next'])
    expect(isDisabled(showButton(w))).toBe(false)
  })

  test.each([
    [['dev', 'master', 'x'], 'master'],
    [['dev', 'x'], 'dev'],
  ])('default branch for %j is %s', async (names, expected) => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake, names)
    expect((w.find('select').element as HTMLSelectElement).value).toBe(expected)
  })

  test('an invalid repository shows an error without any request', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await submitRepo(w, 'git@github.com:o/r.git')
    expect(alertText(w)).toContain('https GitHub URL or owner/repo')
    expect(fake.branchesCalls).toHaveLength(0)
  })

  test('a missing repository shows an error and keeps Show disabled', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await w.find('input[type="text"]').setValue('o/missing')
    await w.find('form.repo-form').trigger('submit')
    fake.branchesCalls[0]!.reject(new NotFoundError('repository', 404, 'Not Found'))
    await flushPromises()
    expect(alertText(w)).toContain('Repository not found.')
    expect(alertText(w)).toContain('Not Found') // GitHub message, as text
    expect(isDisabled(showButton(w))).toBe(true)
  })

  test('an empty list of branches is an error', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake, [])
    expect(alertText(w)).toContain('no branches')
  })

  test('more than 100 branches: a note is shown', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake, ['main'], true)
    expect(w.find('.note').text()).toBe('Only the first 100 branches are listed.')
  })

  test('the branches of the previous repository are cleared when a new one is submitted', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await w.find('input[type="text"]').setValue('x/y')
    await w.find('form.repo-form').trigger('submit')
    expect(w.findAll('option').map((o) => o.text())).toEqual(['Load branches first'])
    expect(isDisabled(showButton(w))).toBe(true)
  })
})

describe('estimate and the Show button', () => {
  test('shows an upper bound with the remaining quota before the history is known', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(42, RESET)
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    expect(w.find('.estimate').text()).toBe('Uses up to 21 requests (42 left)')
  })

  test('exact estimates: cached / n requests', async () => {
    const fake = createFakeClient()
    fake.state.estimate = () => ({ requests: 0, exact: true })
    const w = mountApp(fake)
    await loadBranches(w, fake)
    expect(w.find('.estimate').text()).toBe('Already fetched: uses no requests')

    fake.state.estimate = () => ({ requests: 1, exact: true })
    await typeCount(w, '6') // a new count recomputes the estimate
    expect(w.find('.estimate').text()).toBe('Uses 1 request')

    fake.state.estimate = () => ({ requests: 4, exact: true })
    await typeCount(w, '7')
    expect(w.find('.estimate').text()).toBe('Uses 4 requests')
  })

  test('the estimate follows the count', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await typeCount(w, '5')
    expect(w.find('.estimate').text()).toContain('up to 6 requests')
  })

  test.each(['0', '51', '', 'abc'])(
    'count %j disables Show and hides the estimate',
    async (text) => {
      const fake = createFakeClient()
      const w = mountApp(fake)
      await loadBranches(w, fake)
      await typeCount(w, text)
      expect(isDisabled(showButton(w))).toBe(true)
      expect(w.find('.estimate').exists()).toBe(false)
      await w.find('form.show-form').trigger('submit') // Enter in the field
      expect(fake.historyCalls).toHaveLength(0)
    },
  )

  test('the quota is exhausted: Show is disabled while a new fetch would be needed', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(0, RESET)
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    expect(w.find('.badge').text()).toContain('· low')
    expect(isDisabled(showButton(w))).toBe(true)
  })

  test('the quota is exhausted but everything is cached: nothing is needed, so Show stays enabled', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(0, RESET)
    fake.state.estimate = () => ({ requests: 0, exact: true })
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    expect(isDisabled(showButton(w))).toBe(false)
  })

  test('once the reset time has passed the button is enabled again', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(0, RESET)
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    expect(isDisabled(showButton(w))).toBe(true)
    vi.setSystemTime(RESET + 1)
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(isDisabled(showButton(w))).toBe(false)
    expect(w.find('.badge').text()).toContain('has reset')
  })
})

describe('quota warning before pressing Show', () => {
  async function withQuota(remaining: number) {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(remaining, RESET)
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    return { fake, w }
  }
  const warning = (w: VueWrapper) => w.find('.quota-warning')

  test('shows how many commits can be fetched now when the estimate exceeds the quota', async () => {
    const { w } = await withQuota(10) // 20 commits: up to 21 requests
    expect(warning(w).text()).toMatch(
      /^Not enough quota for 20 commits: it needs up to 21 requests but 10 are left\. You can fetch up to 9 now, or wait until .+\.$/,
    )
    expect(warning(w).attributes('role')).toBe('status')
    // advisory: the button is still usable (the estimate is only an upper bound)
    expect(isDisabled(showButton(w))).toBe(false)
  })

  test('disappears as soon as the count fits', async () => {
    const { w } = await withQuota(10)
    expect(warning(w).exists()).toBe(true)
    await typeCount(w, '9')
    expect(warning(w).exists()).toBe(false)
    await typeCount(w, '10')
    expect(warning(w).exists()).toBe(true)
  })

  test('no warning when the quota is plentiful', async () => {
    const { w } = await withQuota(60)
    expect(warning(w).exists()).toBe(false)
  })

  test('no warning while the quota is unknown', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    expect(warning(w).exists()).toBe(false)
  })

  test('nothing can be fetched: says to wait', async () => {
    const { w } = await withQuota(1)
    expect(warning(w).text()).toMatch(
      /^Not enough quota to fetch anything new \(1 left\)\. Wait until .+\.$/,
    )
  })

  test('an exact estimate is worded without "up to"', async () => {
    const fake = createFakeClient()
    fake.state.rateLimitResult = rateInfo(3, RESET)
    fake.state.estimate = (_r, _b, count) => ({ requests: count, exact: true })
    const w = mountApp(fake)
    await flushPromises()
    await loadBranches(w, fake)
    expect(warning(w).text()).toContain('it needs 20 requests but 3 are left')
    expect(warning(w).text()).toContain('You can fetch up to 3 now')
  })

  test('after the window resets the warning is gone (the old quota is stale)', async () => {
    const { w } = await withQuota(10)
    expect(warning(w).exists()).toBe(true)
    vi.setSystemTime(RESET + 1)
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(warning(w).exists()).toBe(false)
  })
})

describe('showing a history', () => {
  test('runs the fetch with the chosen branch and count, shows progress, then the result', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await pickBranch(w, 'dev')
    await typeCount(w, '7')
    await show(w)

    const call = fake.historyCalls[0]!
    expect(call.branch).toBe('dev')
    expect(call.opts.count).toBe(7)
    expect(w.find('progress').exists()).toBe(true)
    expect(buttonByText(w, 'Cancel')).toBeDefined()

    call.opts.onProgress!({ phase: 'detail', done: 3, total: 7 })
    await flushPromises()
    expect(w.find('.progress-label').text()).toBe('Fetching commit details: 3 / 7')

    call.resolve(historyResult({ data: sampleData('dev') }))
    await flushPromises()
    expect(w.find('progress').exists()).toBe(false)
    expect(buttonByText(w, 'Cancel')).toBeUndefined()
    expect(w.find('.result-heading').text()).toBe('o/r @ dev — 3 commits')
    expect(w.find('.view-stub').attributes('data-branch')).toBe('dev')
    expect(w.find('.intro').exists()).toBe(false)
  })

  test('warnings of the result are listed', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.historyCalls[0]!.resolve(
      historyResult({
        data: sampleData(),
        warnings: [{ kind: 'unknown-src', sha: 'a'.repeat(40) }],
      }),
    )
    await flushPromises()
    expect(w.find('[data-kind="unknown-src"]').text()).toContain('For 1 commit')
  })

  test('pressing Enter in the count field (submit) runs it once', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    await show(w) // phase is loadingHistory: ignored
    expect(fake.historyCalls).toHaveLength(1)
  })

  test('the previous result stays (dimmed, marked as updating) while the next one loads', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.historyCalls[0]!.resolve(historyResult({ data: sampleData('main') }))
    await flushPromises()

    await pickBranch(w, 'dev')
    await show(w)
    expect(w.find('.view-stub').exists()).toBe(true)
    expect(w.find('.stale').exists()).toBe(true)
    expect(w.find('.updating').text()).toBe('Updating…')
    expect(w.find('main').attributes('aria-busy')).toBe('true')

    fake.historyCalls[1]!.resolve(historyResult({ data: sampleData('dev') }))
    await flushPromises()
    expect(w.find('.stale').exists()).toBe(false)
    expect(w.find('.updating').exists()).toBe(false)
    expect(w.find('.view-stub').attributes('data-branch')).toBe('dev')
  })

  test('a failed run keeps the previous result and shows the error', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.historyCalls[0]!.resolve(historyResult({ data: sampleData('main') }))
    await flushPromises()

    await show(w)
    fake.historyCalls[1]!.reject(new HttpError(502))
    await flushPromises()
    expect(alertText(w)).toContain('HTTP 502')
    expect(w.find('.view-stub').attributes('data-branch')).toBe('main')
    expect(isDisabled(showButton(w))).toBe(false) // can retry
  })

  test('submitting a different repository removes the previous result', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.historyCalls[0]!.resolve(historyResult({ data: sampleData() }))
    await flushPromises()
    expect(w.find('.view-stub').exists()).toBe(true)

    await w.find('input[type="text"]').setValue('x/y')
    await w.find('form.repo-form').trigger('submit')
    expect(w.find('.view-stub').exists()).toBe(false)
    expect(w.find('.intro').exists()).toBe(true)
  })

  test('a drawing failure is reported in the banner and cleared by the next result', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.historyCalls[0]!.resolve(historyResult({ data: sampleData() }))
    await flushPromises()
    await w.find('.view-stub').trigger('click') // the stub emits "error"
    expect(alertText(w)).toContain('draw failed')

    await show(w)
    fake.historyCalls[1]!.resolve(historyResult({ data: sampleData() }))
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('changing inputs while a history loads', () => {
  async function loading(clientOpts: Parameters<typeof createFakeClient>[0] = {}) {
    const fake = createFakeClient(clientOpts)
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    return { fake, w, signal: fake.historyCalls[0]!.signal! }
  }

  test('choosing another branch aborts the running fetch; its late result is never shown', async () => {
    const { fake, w, signal } = await loading({ ignoreAbort: true })
    await pickBranch(w, 'dev')
    expect(signal.aborted).toBe(true)
    expect(w.find('progress').exists()).toBe(false)
    expect(isDisabled(showButton(w))).toBe(false)

    fake.historyCalls[0]!.resolve(historyResult({ data: sampleData('main') })) // late
    await flushPromises()
    expect(w.find('.view-stub').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  test('committing a new count aborts the running fetch; typing alone does not', async () => {
    const { w, signal } = await loading()
    await typeCount(w, '9', false)
    expect(signal.aborted).toBe(false)
    await w.find('input[type="number"]').trigger('change')
    expect(signal.aborted).toBe(true)
  })

  test('an invalid count never commits, so it does not abort', async () => {
    const { w, signal } = await loading()
    await typeCount(w, '99')
    expect(signal.aborted).toBe(false)
  })

  test('Cancel aborts, hides the progress and shows no error', async () => {
    const { w, signal } = await loading()
    await buttonByText(w, 'Cancel')!.trigger('click')
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(buttonByText(w, 'Cancel')).toBeUndefined()
    expect(w.find('progress').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(isDisabled(showButton(w))).toBe(false)
  })

  test('unmounting aborts the running fetch', async () => {
    const { w, signal } = await loading()
    w.unmount()
    expect(signal.aborted).toBe(true)
  })

  test('submitting the repository again aborts the running fetch', async () => {
    const { fake, w, signal } = await loading()
    await w.find('form.repo-form').trigger('submit')
    expect(signal.aborted).toBe(true)
    fake.branchesCalls.at(-1)!.resolve(branchList(['main']))
    await flushPromises()
    expect(w.find('progress').exists()).toBe(false)
  })
})

describe('error messages', () => {
  async function failWith(error: unknown, rateAfter: ReturnType<typeof rateInfo> | null = null) {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.state.rate = rateAfter // observed while the request was running
    fake.historyCalls[0]!.reject(error)
    await flushPromises()
    return w
  }

  test('not enough quota (checked before fetching)', async () => {
    const w = await failWith(
      new RateLimitError({
        reason: 'insufficient',
        limit: 60,
        remaining: 9,
        resetAt: new Date(RESET),
        needed: 20,
      }),
    )
    expect(alertText(w)).toContain('Not enough API quota left.')
    expect(alertText(w)).toContain('20 requests are needed but 9 remain')
  })

  test('not enough quota names the largest count that works now', async () => {
    const fake = createFakeClient()
    fake.state.estimate = (_r, _b, count) => ({ requests: count, exact: true })
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.state.rate = rateInfo(10, RESET) // observed after the list request
    fake.historyCalls[0]!.reject(
      new RateLimitError({
        reason: 'insufficient',
        limit: 60,
        remaining: 10,
        resetAt: new Date(RESET),
        needed: 20,
      }),
    )
    await flushPromises()
    expect(alertText(w)).toContain('About 20 requests are needed but 10 remain.')
    expect(alertText(w)).toContain('Up to 10 commits can be fetched now, or wait until')
    expect(alertText(w)).not.toContain('Reduce the number')
  })

  test('rate limit reached', async () => {
    const w = await failWith(
      new RateLimitError({
        reason: 'exhausted',
        limit: 60,
        remaining: 0,
        resetAt: new Date(RESET),
      }),
    )
    expect(alertText(w)).toContain('GitHub API rate limit reached.')
  })

  test('a network error is shown as a rate limit when the quota is known to be exhausted', async () => {
    const w = await failWith(new NetworkError(new TypeError('x')), rateInfo(0, RESET))
    expect(alertText(w)).toContain('GitHub API rate limit reached.')
  })

  test('a plain network error', async () => {
    const w = await failWith(new NetworkError(new TypeError('x')), rateInfo(30, RESET))
    expect(alertText(w)).toContain('Could not reach the GitHub API.')
  })

  test('an unknown branch', async () => {
    const w = await failWith(new NotFoundError('branch', 422))
    expect(alertText(w)).toContain('Branch not found.')
  })

  test('markup in a GitHub message is shown as text only', async () => {
    const w = await failWith(new HttpError(500, undefined, '<img src=x onerror=alert(1)>'))
    expect(w.find('[role="alert"]').element.querySelector('img')).toBeNull()
    expect(alertText(w)).toContain('<img src=x onerror=alert(1)>')
  })

  test('the badge follows the observed quota even when the run fails', async () => {
    const fake = createFakeClient()
    const w = mountApp(fake)
    await loadBranches(w, fake)
    await show(w)
    fake.state.rate = rateInfo(11, RESET)
    fake.historyCalls[0]!.reject(new HttpError(500))
    await flushPromises()
    expect(w.find('.badge').text()).toContain('11 / 60 left')
  })
})

describe('wiring with the real GitHubClient', () => {
  test('changing the branch aborts the in-flight HTTP request (the signal reaches fetch)', async () => {
    const signals: AbortSignal[] = []
    const stubFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const headers = {
        'content-type': 'application/json',
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '50',
        'x-ratelimit-reset': String(Math.floor(RESET / 1000)),
      }
      if (url.pathname === '/rate_limit') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resources: { core: { limit: 60, remaining: 50, reset: Math.floor(RESET / 1000) } },
            }),
            { headers },
          ),
        )
      }
      if (url.pathname.endsWith('/branches')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { name: 'main', commit: { sha: 'a'.repeat(40) } },
              { name: 'dev', commit: { sha: 'b'.repeat(40) } },
            ]),
            { headers },
          ),
        )
      }
      // the commit list never answers; it can only end by an abort
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) signals.push(init.signal)
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    }) as typeof fetch

    const client = new GitHubClient({ fetch: stubFetch, now: () => Date.now() })
    const w = mountApp({ client })
    await flushPromises()
    await w.find('input[type="text"]').setValue('o/r')
    await w.find('form.repo-form').trigger('submit')
    await flushPromises()
    expect(w.findAll('option').map((o) => o.text())).toEqual(['main', 'dev'])

    await show(w)
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(false)
    expect(w.find('progress').exists()).toBe(true)

    await pickBranch(w, 'dev')
    expect(signals[0]!.aborted).toBe(true)
    expect(w.find('progress').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
