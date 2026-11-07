import { describe, expect, test } from 'vitest'
import { AbortedError } from '../src/errors'
import { Semaphore } from '../src/semaphore'
import { flush } from './helpers/deferred'

describe('Semaphore', () => {
  test('rejects a non-positive / non-integer limit', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError)
    expect(() => new Semaphore(1.5)).toThrow(RangeError)
  })

  test('grants up to max immediately, queues the rest in FIFO order', async () => {
    const sem = new Semaphore(2)
    const order: string[] = []
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    expect(sem.active).toBe(2)

    const p3 = sem.acquire().then((r) => (order.push('3'), r))
    const p4 = sem.acquire().then((r) => (order.push('4'), r))
    await flush()
    expect(order).toEqual([])
    expect(sem.waiting).toBe(2)

    r1()
    const r3 = await p3
    expect(order).toEqual(['3'])
    expect(sem.active).toBe(2) // the slot was handed over, not freed
    r2()
    const r4 = await p4
    expect(order).toEqual(['3', '4'])
    r3()
    r4()
    expect(sem.active).toBe(0)
    expect(sem.waiting).toBe(0)
  })

  test('release is idempotent', async () => {
    const sem = new Semaphore(1)
    const r = await sem.acquire()
    r()
    r()
    expect(sem.active).toBe(0)
    const r2 = await sem.acquire()
    expect(sem.active).toBe(1)
    r2()
  })

  test('an already aborted signal rejects without taking a slot', async () => {
    const sem = new Semaphore(1)
    const ac = new AbortController()
    ac.abort('bye')
    await expect(sem.acquire(ac.signal)).rejects.toBeInstanceOf(AbortedError)
    expect(sem.active).toBe(0)
  })

  test('a waiter aborted while queued leaves the queue and never receives a slot', async () => {
    const sem = new Semaphore(1)
    const held = await sem.acquire()
    const ac = new AbortController()
    const waiting = sem.acquire(ac.signal)
    const next = sem.acquire()
    expect(sem.waiting).toBe(2)

    ac.abort(new Error('stop'))
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' })
    expect(sem.waiting).toBe(1)

    held()
    const r = await next // goes to the live waiter, not the aborted one
    expect(sem.active).toBe(1)
    r()
    expect(sem.active).toBe(0)
  })

  test('aborting after the slot was granted does nothing (listener removed)', async () => {
    const sem = new Semaphore(1)
    const held = await sem.acquire()
    const ac = new AbortController()
    const p = sem.acquire(ac.signal)
    held()
    const r = await p
    ac.abort()
    expect(sem.active).toBe(1)
    r()
    expect(sem.active).toBe(0)
  })
})
