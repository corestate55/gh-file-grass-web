import { AbortedError } from './errors'

interface Waiter {
  resolve: (release: () => void) => void
  reject: (reason: unknown) => void
  cleanup: () => void
}

/** 同時実行数の上限。待機中に signal が中断されたら待ち行列から外れて AbortedError で終わる */
export class Semaphore {
  readonly max: number
  #active = 0
  #queue: Waiter[] = []

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError(`concurrency must be >= 1: ${max}`)
    this.max = max
  }

  get active(): number {
    return this.#active
  }

  get waiting(): number {
    return this.#queue.length
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AbortedError(signal.reason))
    if (this.#active < this.max) {
      this.#active++
      return Promise.resolve(this.#releaser())
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = this.#queue.indexOf(waiter)
        if (i >= 0) this.#queue.splice(i, 1)
        reject(new AbortedError(signal?.reason))
      }
      const waiter: Waiter = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#queue.push(waiter)
    })
  }

  #releaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.#queue.shift()
      if (next) {
        // 枠は手放さず、そのまま次の待機者に渡す
        next.cleanup()
        next.resolve(this.#releaser())
      } else {
        this.#active--
      }
    }
  }
}
