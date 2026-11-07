import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GitLogData } from '@gh-file-grass/core/schema'
import type { GhCommitDetail } from '../../src/github-types'

const FIXTURES = join(import.meta.dirname, '../fixtures')
const LOGS_JSON = join(import.meta.dirname, '../../../core/test/fixtures/logs.json')

interface Recorded<T> {
  body: T
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** 録画した詳細 API 応答を、一覧 API と同じ順(新しい順)で返す。k 指定で先頭 k 件。 */
export function loadDetails(k?: number): GhCommitDetail[] {
  const list = readJson<Recorded<{ sha: string }[]>>(join(FIXTURES, 'commits-list.json')).body
  const shas = list.map((c) => c.sha).slice(0, k ?? list.length)
  return shas.map(
    (sha) => readJson<Recorded<GhCommitDetail>>(join(FIXTURES, 'commits', `${sha}.json`)).body,
  )
}

/** 元 Ruby 実装の出力(ゴールデンの期待値) */
export function loadLogsJson(): GitLogData {
  return readJson<GitLogData>(LOGS_JSON)
}
