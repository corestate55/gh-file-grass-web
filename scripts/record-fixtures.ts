// 開発専用: GitHub API の挙動確認とフィクスチャ録画(DESIGN.md Step 0)。
// 成果物(アプリ)には含めない。トークンは環境変数 GITHUB_TOKEN からのみ読み、保存しない。
//
// 使い方(Node 22.6+ / 24 は TS をそのまま実行可):
//   node scripts/record-fixtures.ts probe   # 小さな検証(項目①②⑦⑧)
//   node scripts/record-fixtures.ts record  # 64 件分の詳細・branches を録画
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OWNER = 'corestate55'
const REPO = 'gh-file-grass'
const API = 'https://api.github.com'
const LOGS_JSON = 'gh-file-grass/public/logs.json' // 読み取り専用
const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/github-adapter/test/fixtures',
)

const token = process.env.GITHUB_TOKEN
if (!token) throw new Error('GITHUB_TOKEN is not set')

// 保存するヘッダは許可リスト方式(Authorization 等は絶対に残さない)
const KEEP_HEADERS = [
  'content-type',
  'link',
  'etag',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
]

interface Recorded {
  url: string
  status: number
  headers: Record<string, string>
  body: unknown
}

async function get(path: string): Promise<Recorded> {
  const url = `${API}${path}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // 実ブラウザの CORS 挙動を確認するため Origin を付ける(項目⑦)
      Origin: 'https://example.github.io',
    },
  })
  const headers: Record<string, string> = {}
  for (const k of KEEP_HEADERS) {
    const v = res.headers.get(k)
    if (v !== null) headers[k] = v
  }
  return { url, status: res.status, headers, body: await res.json() }
}

async function save(rel: string, rec: Recorded) {
  const file = join(FIXTURE_DIR, rel)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(rec, null, 2) + '\n')
}

interface LogsJson {
  commits: { sha: string; sha_short: string; index: number }[]
}
async function loadExpected(): Promise<LogsJson['commits']> {
  const logs = JSON.parse(await readFile(LOGS_JSON, 'utf8')) as LogsJson
  return logs.commits // 新しい順
}

const remaining = (r: Recorded) => r.headers['x-ratelimit-remaining']

async function probe() {
  const expected = await loadExpected()
  const head = expected[0]
  console.log(`logs.json: ${expected.length} commits, head=${head.sha_short}`)

  // ① リモートに d64a81b があるか
  const headRec = await get(`/repos/${OWNER}/${REPO}/commits/${head.sha}`)
  console.log(`① head commit: status=${headRec.status}`)

  // ② 一覧の並び順
  const list = await get(`/repos/${OWNER}/${REPO}/commits?sha=${head.sha}&per_page=100`)
  await save('commits-list.json', list)
  const listed = (list.body as { sha: string }[]).map((c) => c.sha)
  console.log(`② list: status=${list.status}, count=${listed.length}`)
  const n = expected.length
  let firstDiff = -1
  for (let i = 0; i < n; i++) {
    if (listed[i] !== expected[i].sha) {
      firstDiff = i
      break
    }
  }
  if (firstDiff === -1) {
    console.log(`   先頭 ${n} 件の sha 順が logs.json と完全一致`)
  } else {
    console.log(
      `   不一致: 位置 ${firstDiff} expected=${expected[firstDiff].sha_short} actual=${listed[firstDiff]?.slice(0, 7)}`,
    )
    const exp = new Set(expected.map((c) => c.sha))
    const sameSet = listed.slice(0, n).every((s) => exp.has(s))
    console.log(`   先頭 ${n} 件の集合は一致: ${sameSet}`)
  }
  console.log(
    `   root(${expected[n - 1].sha_short}) が一覧に含まれる: ${listed.includes(expected[n - 1].sha)}`,
  )

  // ⑦ CORS 公開ヘッダ
  console.log(`⑦ access-control-allow-origin: ${list.headers['access-control-allow-origin']}`)
  console.log(`   access-control-expose-headers: ${list.headers['access-control-expose-headers']}`)

  // ⑧ /rate_limit が枠を消費するか(通常 API の前後で /rate_limit を比較)
  const r1 = await get('/rate_limit')
  const r2 = await get('/rate_limit')
  const core = (r: Recorded) =>
    (r.body as { resources: { core: { remaining: number } } }).resources.core.remaining
  console.log(`⑧ /rate_limit 連続2回の core.remaining: ${core(r1)} -> ${core(r2)}`)
  const before = core(r2)
  const mid = await get(`/repos/${OWNER}/${REPO}/commits/${head.sha}`)
  const r3 = await get('/rate_limit')
  console.log(
    `   通常API1回後: ${before} -> ${core(r3)} (通常API応答ヘッダ remaining=${remaining(mid)})`,
  )
  await save('rate-limit.json', r3)
}

async function record() {
  const expected = await loadExpected()
  const list = JSON.parse(
    await readFile(join(FIXTURE_DIR, 'commits-list.json'), 'utf8'),
  ) as Recorded
  const listed = new Set((list.body as { sha: string }[]).map((c) => c.sha))

  const branches = await get(`/repos/${OWNER}/${REPO}/branches?per_page=100`)
  await save('branches.json', branches)
  console.log(`branches: status=${branches.status}`)

  let done = 0
  for (const c of expected) {
    if (!listed.has(c.sha)) {
      console.log(`skip (一覧に無い): ${c.sha_short}`)
      continue
    }
    const rec = await get(`/repos/${OWNER}/${REPO}/commits/${c.sha}`)
    if (rec.status !== 200) {
      console.log(`  ${c.sha_short}: status=${rec.status}`)
    }
    await save(`commits/${c.sha}.json`, rec)
    done++
    if (done % 10 === 0) console.log(`  ${done}/${expected.length} (remaining=${remaining(rec)})`)
  }
  console.log(`done: ${done} commits`)
}

const mode = process.argv[2]
if (mode === 'probe') await probe()
else if (mode === 'record') await record()
else {
  console.error('usage: node scripts/record-fixtures.ts <probe|record>')
  process.exit(1)
}
