export type GitHubErrorKind =
  | 'invalid_input'
  | 'not_found'
  | 'rate_limited'
  | 'secondary_rate_limited'
  | 'empty_repository'
  | 'http'
  | 'network'
  | 'aborted'

/**
 * 取得系エラーの基底。UI は `kind` で分岐して表示する。
 * `apiMessage` は GitHub が返した文字列で、信頼できない入力として扱うこと
 * (テキスト補間で表示し、HTML としては解釈しない)。
 */
export abstract class GitHubError extends Error {
  abstract readonly kind: GitHubErrorKind
  readonly status?: number
  readonly apiMessage?: string

  constructor(
    message: string,
    extra: { status?: number; apiMessage?: string; cause?: unknown } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause })
    if (extra.status !== undefined) this.status = extra.status
    if (extra.apiMessage !== undefined) this.apiMessage = extra.apiMessage
  }
}

export type InvalidInputReason =
  | 'empty'
  | 'unsupported_scheme'
  | 'unsupported_host'
  | 'invalid_format'
  | 'invalid_owner'
  | 'invalid_repo'

export class InvalidInputError extends GitHubError {
  readonly kind = 'invalid_input'
  readonly input: string
  readonly reason: InvalidInputReason
  constructor(input: string, reason: InvalidInputReason) {
    super(`Invalid repository input (${reason}): ${input}`)
    this.name = 'InvalidInputError'
    this.input = input
    this.reason = reason
  }
}

export type NotFoundResource = 'repository' | 'branch_or_repository' | 'branch' | 'commit'

/** 404(private リポジトリも 404 になる)と、一覧 API の 422(存在しないブランチ) */
export class NotFoundError extends GitHubError {
  readonly kind = 'not_found'
  readonly resource: NotFoundResource
  constructor(resource: NotFoundResource, status: number, apiMessage?: string) {
    super(`Not found (${resource})`, {
      status,
      ...(apiMessage === undefined ? {} : { apiMessage }),
    })
    this.name = 'NotFoundError'
    this.resource = resource
  }
}

export class RateLimitError extends GitHubError {
  readonly kind = 'rate_limited'
  /** exhausted: GitHub が拒否した / insufficient: 取得前の見積もりで残量不足と判明した */
  readonly reason: 'exhausted' | 'insufficient'
  readonly limit: number
  readonly remaining: number
  readonly resetAt: Date
  readonly needed?: number
  constructor(init: {
    reason: 'exhausted' | 'insufficient'
    limit: number
    remaining: number
    resetAt: Date
    needed?: number
    status?: number
    apiMessage?: string
  }) {
    super(
      init.reason === 'insufficient'
        ? `Rate limit too low: need ${init.needed} requests, ${init.remaining} remaining`
        : 'API rate limit exceeded',
      {
        ...(init.status === undefined ? {} : { status: init.status }),
        ...(init.apiMessage === undefined ? {} : { apiMessage: init.apiMessage }),
      },
    )
    this.name = 'RateLimitError'
    this.reason = init.reason
    this.limit = init.limit
    this.remaining = init.remaining
    this.resetAt = init.resetAt
    if (init.needed !== undefined) this.needed = init.needed
  }
}

export class SecondaryRateLimitError extends GitHubError {
  readonly kind = 'secondary_rate_limited'
  readonly retryAfterSec: number
  readonly retryAt: Date
  constructor(retryAfterSec: number, retryAt: Date, status?: number, apiMessage?: string) {
    super('Secondary rate limit', {
      ...(status === undefined ? {} : { status }),
      ...(apiMessage === undefined ? {} : { apiMessage }),
    })
    this.name = 'SecondaryRateLimitError'
    this.retryAfterSec = retryAfterSec
    this.retryAt = retryAt
  }
}

export class EmptyRepositoryError extends GitHubError {
  readonly kind = 'empty_repository'
  constructor() {
    super('The repository is empty', { status: 409 })
    this.name = 'EmptyRepositoryError'
  }
}

export class HttpError extends GitHubError {
  readonly kind = 'http'
  constructor(status: number, detail?: string, apiMessage?: string) {
    super(`HTTP ${status}${detail ? ` (${detail})` : ''}`, {
      status,
      ...(apiMessage === undefined ? {} : { apiMessage }),
    })
    this.name = 'HttpError'
  }
}

/** fetch 自体の失敗。CORS ブロックやオフラインもここに入る */
export class NetworkError extends GitHubError {
  readonly kind = 'network'
  constructor(cause: unknown) {
    super('Network error', { cause })
    this.name = 'NetworkError'
  }
}

/** 呼び出し側が中断した。UI は表示しない */
export class AbortedError extends GitHubError {
  readonly kind = 'aborted'
  constructor(cause?: unknown) {
    super('Aborted', { cause })
    this.name = 'AbortedError'
  }
}
