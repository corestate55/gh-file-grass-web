import { InvalidInputError } from './errors'
import type { RepoRef } from './types'

const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * リポジトリ指定を `{owner, repo}` にする。大文字小文字は入力のまま保持する。
 *
 * 受理:
 *  - `owner/repo`(`.git` 付き可。ちょうど 2 セグメントのときだけ)
 *  - `https://github.com/owner/repo[.git][/tree/…][?…][#…]`、`www.github.com` も可
 *  - `github.com/owner/repo…`(スキーム省略)
 * 拒否: https 以外のスキーム(http / ssh / git@…)、github.com 以外のホスト、
 *   ポートや認証情報付き、owner/repo の形式違反、`.` / `..`
 */
export function parseRepoInput(input: string): RepoRef {
  const text = input.trim()
  if (text === '') throw new InvalidInputError(input, 'empty')

  let segments: string[]

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    segments = segmentsOfUrl(input, text)
  } else if (/^[^/\s]+@/.test(text)) {
    // git@github.com:o/r など。https のみを受け付ける
    throw new InvalidInputError(input, 'unsupported_scheme')
  } else {
    const first = text.split(/[/?#]/, 1)[0] ?? ''
    if (/^(www\.)?github\.com$/i.test(first)) {
      segments = segmentsOfUrl(input, `https://${text}`)
    } else if (first.includes('.')) {
      // owner に '.' は使えないので、ホスト名として書かれたもの(github.com 以外)
      throw new InvalidInputError(input, 'unsupported_host')
    } else {
      segments = text.replace(/\/+$/, '').split('/')
      if (segments.length !== 2) throw new InvalidInputError(input, 'invalid_format')
    }
  }

  const [owner, rawRepo] = segments
  if (owner === undefined || rawRepo === undefined) {
    throw new InvalidInputError(input, 'invalid_format')
  }
  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo

  if (!OWNER_RE.test(owner)) throw new InvalidInputError(input, 'invalid_owner')
  // '.' と '..' は正規表現を通るが、URL の正規化でパスが化けるので拒否する
  if (repo === '.' || repo === '..' || !REPO_RE.test(repo)) {
    throw new InvalidInputError(input, 'invalid_repo')
  }
  return { owner, repo }
}

function segmentsOfUrl(input: string, text: string): string[] {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new InvalidInputError(input, 'invalid_format')
  }
  if (url.protocol !== 'https:') throw new InvalidInputError(input, 'unsupported_scheme')
  if (!GITHUB_HOSTS.has(url.hostname)) throw new InvalidInputError(input, 'unsupported_host')
  if (url.port !== '' || url.username !== '' || url.password !== '') {
    throw new InvalidInputError(input, 'invalid_format')
  }
  return url.pathname.split('/').filter((s) => s !== '')
}
