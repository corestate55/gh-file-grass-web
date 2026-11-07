import {
  AbortedError,
  HttpError,
  InvalidInputError,
  NotFoundError,
} from '@gh-file-grass/github-adapter'
import { computed, effectScope, isReactive } from 'vue'
import type { EffectScope } from 'vue'
import { afterEach, describe, expect, test } from 'vitest'
import { useHistoryLoader } from '../src/composables/useHistoryLoader'
import type { HistoryLoader } from '../src/composables/useHistoryLoader'
import { NoBranchesError } from '../src/lib/errors'
import { flush } from './helpers/deferred'
import {
  branchList,
  createFakeClient,
  emptyData,
  historyResult,
  rateInfo,
} from './helpers/fake-client'
import type { FakeClient } from './helpers/fake-client'

let scope: EffectScope | undefined
afterEach(() => scope?.stop())

function setup(clientOpts: Parameters<typeof createFakeClient>[0] = {}) {
  const fake = createFakeClient(clientOpts)
  scope = effectScope()
  const loader = scope.run(() => useHistoryLoader(fake.client, { timeZone: 'Asia/Tokyo' }))!
  return { fake, loader, scope }
}

/** ブランチを読み込み済みの状態にする */
async function ready(
  fake: FakeClient,
  loader: HistoryLoader,
  input = 'o/r',
  names = ['main', 'dev'],
) {
  const p = loader.loadBranches(input)
  fake.branchesCalls.at(-1)!.resolve(branchList(names))
  await p
}

describe('initial state', () => {
  test('idle and empty', () => {
    const { loader } = setup()
    expect(loader.phase.value).toBe('idle')
    expect(loader.repo.value).toBeNull()
    expect(loader.branches.value).toEqual([])
    expect(loader.hasMoreBranches.value).toBe(false)
    expect(loader.progress.value).toBeNull()
    expect(loader.result.value).toBeNull()
    expect(loader.error.value).toBeNull()
    expect(loader.rateLimit.value).toBeNull()
  })
})

describe('loadBranches', () => {
  test('idle -> loadingBranches -> ready; stores the branches and hasMore', async () => {
    const { fake, loader } = setup()
    const p = loader.loadBranches('  https://github.com/Owner/Repo.git ')
    expect(loader.phase.value).toBe('loadingBranches')
    expect(loader.repo.value).toEqual({ owner: 'Owner', repo: 'Repo' })
    expect(fake.branchesCalls[0]!.ref).toEqual({ owner: 'Owner', repo: 'Repo' })

    const list = branchList(['main', 'dev'], true)
    fake.branchesCalls[0]!.resolve(list)
    await expect(p).resolves.toBe(list)
    expect(loader.phase.value).toBe('ready')
    expect(loader.branches.value.map((b) => b.name)).toEqual(['main', 'dev'])
    expect(loader.hasMoreBranches.value).toBe(true)
    expect(loader.error.value).toBeNull()
  })

  test('an invalid input sets the error without calling the client or touching a running load', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const running = loader.loadHistory('main', 5)
    const signal = fake.historyCalls[0]!.signal!

    await expect(loader.loadBranches('git@github.com:o/r.git')).resolves.toBeNull()
    expect(loader.error.value).toBeInstanceOf(InvalidInputError)
    expect(fake.branchesCalls).toHaveLength(1) // only the first one
    expect(signal.aborted).toBe(false)
    expect(loader.phase.value).toBe('loadingHistory')

    fake.historyCalls[0]!.resolve(historyResult())
    await running
    expect(loader.result.value).not.toBeNull()
  })

  test('a failure sets the error and returns to idle for a new repository', async () => {
    const { fake, loader } = setup()
    const p = loader.loadBranches('o/missing')
    fake.branchesCalls[0]!.reject(new NotFoundError('repository', 404))
    await expect(p).resolves.toBeNull()
    expect(loader.phase.value).toBe('idle')
    expect(loader.error.value).toBeInstanceOf(NotFoundError)
    expect(loader.branches.value).toEqual([])
  })

  test('a repository without branches is reported as an error', async () => {
    const { fake, loader } = setup()
    const p = loader.loadBranches('o/empty')
    fake.branchesCalls[0]!.resolve(branchList([]))
    await p
    expect(loader.phase.value).toBe('idle')
    expect(loader.error.value).toBeInstanceOf(NoBranchesError)
  })

  test('a new submit clears the previous error', async () => {
    const { fake, loader } = setup()
    const p1 = loader.loadBranches('o/missing')
    fake.branchesCalls[0]!.reject(new HttpError(502))
    await p1
    expect(loader.error.value).not.toBeNull()
    void loader.loadBranches('o/r')
    expect(loader.error.value).toBeNull()
  })

  test('a different repository clears branches and the previous result; the same one keeps them', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader, 'o/r')
    const h = loader.loadHistory('main', 3)
    fake.historyCalls[0]!.resolve(historyResult())
    await h
    expect(loader.result.value).not.toBeNull()

    // the same repository (case-insensitive): result stays visible while the branches reload
    void loader.loadBranches('O/R')
    expect(loader.result.value).not.toBeNull()
    expect(loader.branches.value).toHaveLength(2)
    fake.branchesCalls.at(-1)!.resolve(branchList(['main', 'dev']))
    await flush()

    // another repository
    void loader.loadBranches('x/y')
    expect(loader.result.value).toBeNull()
    expect(loader.branches.value).toEqual([])
    expect(loader.hasMoreBranches.value).toBe(false)
  })

  test('failing to reload the same repository keeps the old branches usable', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const p = loader.loadBranches('o/r')
    fake.branchesCalls.at(-1)!.reject(new HttpError(500))
    await p
    expect(loader.phase.value).toBe('ready')
    expect(loader.error.value).toBeInstanceOf(HttpError)
    expect(loader.branches.value).toHaveLength(2)
  })

  test('submitting again supersedes the earlier load, even if the client ignores the abort', async () => {
    const { fake, loader } = setup({ ignoreAbort: true })
    const p1 = loader.loadBranches('a/one')
    const p2 = loader.loadBranches('b/two')
    expect(fake.branchesCalls[0]!.signal!.aborted).toBe(true)
    fake.branchesCalls[1]!.resolve(branchList(['main']))
    await p2
    // the old one answers late with different data: must be ignored
    fake.branchesCalls[0]!.resolve(branchList(['stale']))
    await expect(p1).resolves.toBeNull()
    expect(loader.repo.value).toEqual({ owner: 'b', repo: 'two' })
    expect(loader.branches.value.map((b) => b.name)).toEqual(['main'])
  })
})

describe('loadHistory', () => {
  test('ready -> loadingHistory -> ready; mirrors progress; passes count, timeZone and a signal', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const p = loader.loadHistory('dev', 7)
    expect(loader.phase.value).toBe('loadingHistory')
    const call = fake.historyCalls[0]!
    expect(call.branch).toBe('dev')
    expect(call.opts.count).toBe(7)
    expect(call.opts.timeZone).toBe('Asia/Tokyo')
    expect(call.signal).toBeInstanceOf(AbortSignal)

    call.opts.onProgress!({ phase: 'detail', done: 2, total: 7 })
    expect(loader.progress.value).toEqual({ phase: 'detail', done: 2, total: 7 })

    const res = historyResult({ warnings: [{ kind: 'truncated', sha: 'x' }] })
    call.resolve(res)
    await p
    expect(loader.phase.value).toBe('ready')
    expect(loader.progress.value).toBeNull()
    expect(loader.result.value).toMatchObject({
      repo: { owner: 'o', repo: 'r' },
      branch: 'dev',
      count: 7,
      warnings: [{ kind: 'truncated', sha: 'x' }],
    })
  })

  test('does nothing before a repository is loaded', async () => {
    const { fake, loader } = setup()
    await loader.loadHistory('main', 5)
    expect(fake.historyCalls).toHaveLength(0)
    expect(loader.phase.value).toBe('idle')
  })

  test('the result is kept raw (shallow): the graph data is not made deeply reactive', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const p = loader.loadHistory('main', 5)
    fake.historyCalls[0]!.resolve(historyResult({ data: emptyData() }))
    await p
    expect(isReactive(loader.result.value)).toBe(false)
    expect(isReactive(loader.result.value!.data)).toBe(false)
  })

  test('a failure shows the error, keeps the previous result and returns to ready', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const first = loader.loadHistory('main', 3)
    fake.historyCalls[0]!.resolve(historyResult())
    await first
    const kept = loader.result.value

    const second = loader.loadHistory('dev', 3)
    fake.historyCalls[1]!.reject(new HttpError(502))
    await second
    expect(loader.phase.value).toBe('ready')
    expect(loader.error.value).toBeInstanceOf(HttpError)
    expect(loader.result.value).toBe(kept)
    expect(loader.progress.value).toBeNull()
  })

  test('an aborted error is never shown', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const p = loader.loadHistory('main', 3)
    fake.historyCalls[0]!.reject(new AbortedError('x')) // current generation, but reported as aborted
    await p
    expect(loader.error.value).toBeNull()
    expect(loader.phase.value).toBe('ready')
  })

  test('a new run aborts the previous one; late results and late progress of the old run are ignored', async () => {
    const { fake, loader } = setup({ ignoreAbort: true })
    await ready(fake, loader)
    const p1 = loader.loadHistory('main', 3)
    const p2 = loader.loadHistory('dev', 4)
    expect(fake.historyCalls[0]!.signal!.aborted).toBe(true)
    expect(fake.historyCalls[1]!.signal!.aborted).toBe(false)

    fake.historyCalls[1]!.opts.onProgress!({ phase: 'detail', done: 1, total: 4 })
    fake.historyCalls[0]!.opts.onProgress!({ phase: 'detail', done: 3, total: 3 }) // stale
    expect(loader.progress.value).toEqual({ phase: 'detail', done: 1, total: 4 })

    fake.historyCalls[1]!.resolve(historyResult({ data: emptyData('o/r', 'dev') }))
    await p2
    fake.historyCalls[0]!.resolve(historyResult({ data: emptyData('o/r', 'main') })) // late
    await p1
    expect(loader.result.value).toMatchObject({ branch: 'dev', count: 4 })
    expect(loader.phase.value).toBe('ready')
  })

  test('a late failure of an aborted run does not become an error or change the phase', async () => {
    const { fake, loader } = setup({ ignoreAbort: true })
    await ready(fake, loader)
    const p1 = loader.loadHistory('main', 3)
    const p2 = loader.loadHistory('dev', 3)
    fake.historyCalls[0]!.reject(new HttpError(500)) // late, from the old run
    await p1
    expect(loader.error.value).toBeNull()
    expect(loader.phase.value).toBe('loadingHistory')
    fake.historyCalls[1]!.resolve(historyResult())
    await p2
  })

  test('starting a history load clears the previous error', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    const p1 = loader.loadHistory('main', 3)
    fake.historyCalls[0]!.reject(new HttpError(500))
    await p1
    expect(loader.error.value).not.toBeNull()
    void loader.loadHistory('main', 3)
    expect(loader.error.value).toBeNull()
  })

  test('loading branches while a history load runs aborts it', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    void loader.loadHistory('main', 3)
    const signal = fake.historyCalls[0]!.signal!
    void loader.loadBranches('o/r')
    expect(signal.aborted).toBe(true)
    expect(loader.phase.value).toBe('loadingBranches')
    fake.branchesCalls.at(-1)!.resolve(branchList(['main']))
    await flush()
    expect(loader.phase.value).toBe('ready')
  })
})

describe('cancel and disposal', () => {
  test('cancel() aborts the running history load, returns to ready and drops its late result', async () => {
    const { fake, loader } = setup({ ignoreAbort: true })
    await ready(fake, loader)
    const p = loader.loadHistory('main', 3)
    loader.cancel()
    expect(fake.historyCalls[0]!.signal!.aborted).toBe(true)
    expect(loader.phase.value).toBe('ready')
    expect(loader.progress.value).toBeNull()
    fake.historyCalls[0]!.resolve(historyResult())
    await p
    expect(loader.result.value).toBeNull()
    expect(loader.error.value).toBeNull()
  })

  test('cancel() while loading branches goes back to idle when nothing was loaded', async () => {
    const { fake, loader } = setup()
    const p = loader.loadBranches('o/r')
    loader.cancel()
    expect(loader.phase.value).toBe('idle')
    await p
    expect(fake.branchesCalls[0]!.signal!.aborted).toBe(true)
    expect(loader.error.value).toBeNull()
  })

  test('cancel() with nothing running is harmless', () => {
    const { loader } = setup()
    expect(() => loader.cancel()).not.toThrow()
    expect(loader.phase.value).toBe('idle')
  })

  test('disposing the scope aborts a running load', async () => {
    const { fake, loader, scope } = setup()
    await ready(fake, loader)
    const p = loader.loadHistory('main', 3)
    scope.stop()
    expect(fake.historyCalls[0]!.signal!.aborted).toBe(true)
    await p
  })
})

describe('rate limit and cache version', () => {
  test('the observed quota is copied after success, failure and abort', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    fake.state.rate = rateInfo(40)
    const ok = loader.loadHistory('main', 3)
    fake.historyCalls[0]!.resolve(historyResult())
    await ok
    expect(loader.rateLimit.value?.remaining).toBe(40)

    fake.state.rate = rateInfo(12)
    const bad = loader.loadHistory('main', 3)
    fake.historyCalls[1]!.reject(new HttpError(500))
    await bad
    expect(loader.rateLimit.value?.remaining).toBe(12)

    fake.state.rate = rateInfo(5)
    const aborted = loader.loadHistory('main', 3)
    loader.cancel()
    await aborted
    expect(loader.rateLimit.value?.remaining).toBe(5)
  })

  test('refreshRateLimit asks the client and copies the value; failures are swallowed', async () => {
    const { fake, loader } = setup()
    fake.state.rateLimitResult = rateInfo(33)
    await loader.refreshRateLimit()
    expect(fake.rateLimitCalls).toBe(1)
    expect(loader.rateLimit.value?.remaining).toBe(33)

    fake.state.rateLimitResult = new HttpError(500)
    await expect(loader.refreshRateLimit()).resolves.toBeUndefined()
    expect(loader.error.value).toBeNull()
    expect(loader.rateLimit.value?.remaining).toBe(33)
  })

  test('cacheVersion increases after every load, so estimates are recomputed', async () => {
    const { fake, loader } = setup()
    const v0 = loader.cacheVersion.value
    await ready(fake, loader)
    const v1 = loader.cacheVersion.value
    expect(v1).toBeGreaterThan(v0)

    const est = computed(() => loader.estimate('main', 5))
    expect(est.value).toEqual({ requests: 6, exact: false })
    fake.state.estimate = () => ({ requests: 0, exact: true })
    expect(est.value).toEqual({ requests: 6, exact: false }) // not reactive on its own
    const p = loader.loadHistory('main', 5)
    fake.historyCalls[0]!.resolve(historyResult())
    await p
    expect(est.value).toEqual({ requests: 0, exact: true })
  })
})

describe('estimate', () => {
  test('null without a repository', () => {
    const { loader } = setup()
    expect(loader.estimate('main', 5)).toBeNull()
  })

  test('null when the client rejects the count', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    fake.state.estimate = () => {
      throw new RangeError('count')
    }
    expect(loader.estimate('main', 0)).toBeNull()
  })

  test('returns the client estimate', async () => {
    const { fake, loader } = setup()
    await ready(fake, loader)
    expect(loader.estimate('main', 20)).toEqual({ requests: 21, exact: false })
  })
})
