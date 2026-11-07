/** 件数上限つき LRU。Map の挿入順を使い、get / set で末尾(最近使用)に移す */
export class LruCache<K, V> {
  readonly max: number
  #map = new Map<K, V>()

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError(`cache size must be >= 1: ${max}`)
    this.max = max
  }

  get size(): number {
    return this.#map.size
  }

  /** 順位を更新せずに存在だけ確認する */
  has(key: K): boolean {
    return this.#map.has(key)
  }

  get(key: K): V | undefined {
    if (!this.#map.has(key)) return undefined
    const value = this.#map.get(key) as V
    this.#map.delete(key)
    this.#map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.#map.delete(key)
    this.#map.set(key, value)
    while (this.#map.size > this.max) {
      const oldest = this.#map.keys().next()
      if (oldest.done) break
      this.#map.delete(oldest.value)
    }
  }

  delete(key: K): void {
    this.#map.delete(key)
  }
}

/** 有効期限つき。時計を注入できる(`now() - 保存時刻 >= ttlMs` で期限切れ) */
export class TtlCache<K, V> {
  #map = new Map<K, { value: V; at: number }>()

  constructor(
    readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.#map.get(key)
    if (!entry) return undefined
    if (this.now() - entry.at >= this.ttlMs) {
      this.#map.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V): void {
    this.#map.set(key, { value, at: this.now() })
  }

  delete(key: K): void {
    this.#map.delete(key)
  }
}
