import {
  EmptyRepositoryError,
  GitHubError,
  HttpError,
  InvalidInputError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  SecondaryRateLimitError,
  ShaShortCollisionError,
} from '@gh-file-grass/github-adapter'
import type { RateLimitInfo } from '@gh-file-grass/github-adapter'
import { NoBranchesError } from './errors'
import { errorMessages as m } from './messages'
import type { ErrorText } from './messages'

export interface DescribedError extends ErrorText {
  /** GitHub が返したメッセージ。信頼できない文字列なので、必ずテキスト補間で表示する */
  apiMessage?: string
}

export interface DescribeContext {
  /** 直前に観測した残量(network エラーの解釈に使う) */
  rateLimit: RateLimitInfo | null
  /** 現在時刻(ms) */
  now: number
  /** 時刻の表示。省略時はブラウザのロケール */
  formatTime?: (d: Date) => string
}

const defaultFormatTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * エラーを画面に出す文言にする。表示しないもの(中断)は null。
 * ここがエラー文言の唯一の分岐点なので、ブラウザでの実測結果を反映する場合もここだけを直す。
 */
export function describeError(err: unknown, ctx: DescribeContext): DescribedError | null {
  const time = ctx.formatTime ?? defaultFormatTime
  const withApi = (text: ErrorText): DescribedError =>
    err instanceof GitHubError && err.apiMessage ? { ...text, apiMessage: err.apiMessage } : text

  if (err instanceof GitHubError && err.kind === 'aborted') return null

  if (err instanceof InvalidInputError) {
    switch (err.reason) {
      case 'empty':
        return m.inputEmpty()
      case 'unsupported_scheme':
        return m.inputScheme()
      case 'unsupported_host':
        return m.inputHost()
      default:
        return m.inputFormat()
    }
  }
  if (err instanceof NotFoundError) {
    if (err.resource === 'repository') return withApi(m.repoNotFound())
    if (err.resource === 'commit') return withApi(m.commitNotFound())
    return withApi(m.branchNotFound())
  }
  if (err instanceof RateLimitError) {
    return withApi(
      err.reason === 'insufficient'
        ? m.quotaInsufficient(err.needed ?? 0, err.remaining, time(err.resetAt))
        : m.rateLimited(time(err.resetAt)),
    )
  }
  if (err instanceof SecondaryRateLimitError) {
    return withApi(m.secondaryRateLimited(time(err.retryAt), err.retryAfterSec))
  }
  if (err instanceof EmptyRepositoryError) return m.emptyRepository()
  if (err instanceof HttpError) return withApi(m.http(err.status))
  if (err instanceof NetworkError) {
    // 403 は CORS ヘッダが付かず、ブラウザ上では network error に見える可能性がある。
    // 直前の観測で枠が尽きていたなら、レート制限として表示する。
    const rl = ctx.rateLimit
    if (rl && rl.remaining <= 0 && rl.resetAt.getTime() > ctx.now) {
      return m.rateLimited(time(rl.resetAt))
    }
    return m.network()
  }
  if (err instanceof ShaShortCollisionError) return m.shaCollision()
  if (err instanceof NoBranchesError) return m.noBranches()

  return m.unexpected(err instanceof Error ? err.message : String(err))
}
