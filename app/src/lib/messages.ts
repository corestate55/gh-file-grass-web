// UI の文言。英語(元アプリと core のツールチップに合わせる)。
// 日本語化などをする場合はここを差し替える。

export interface ErrorText {
  title: string
  detail?: string
}

export const errorMessages = {
  inputEmpty: (): ErrorText => ({
    title: 'Enter a repository.',
    detail: 'For example: vuejs/core',
  }),
  inputScheme: (): ErrorText => ({
    title: 'Use an https GitHub URL or owner/repo.',
    detail: 'ssh, git@ and http URLs are not supported.',
  }),
  inputHost: (): ErrorText => ({ title: 'Only github.com repositories are supported.' }),
  inputFormat: (): ErrorText => ({
    title: "That doesn't look like a repository.",
    detail: 'For example: vuejs/core or https://github.com/vuejs/core',
  }),

  repoNotFound: (): ErrorText => ({
    title: 'Repository not found.',
    detail: 'Check the spelling. Private repositories are not supported.',
  }),
  branchNotFound: (): ErrorText => ({
    title: 'Branch not found.',
    detail: 'It may have been deleted. Load the branches again and retry.',
  }),
  commitNotFound: (): ErrorText => ({
    title: 'A commit could not be fetched.',
    detail: 'The history may have been rewritten (force push). Load the branches again and retry.',
  }),
  noBranches: (): ErrorText => ({ title: 'This repository has no branches.' }),

  rateLimited: (resetAt: string): ErrorText => ({
    title: 'GitHub API rate limit reached.',
    detail: `Unauthenticated requests are limited to 60 per hour. The limit resets at ${resetAt}.`,
  }),
  quotaInsufficient: (needed: number, remaining: number, resetAt: string): ErrorText => ({
    title: 'Not enough API quota left.',
    detail: `About ${needed} requests are needed but ${remaining} remain. Reduce the number of commits, or wait until ${resetAt}.`,
  }),
  secondaryRateLimited: (retryAt: string, seconds: number): ErrorText => ({
    title: 'Too many requests in a short time.',
    detail: `Try again after ${retryAt} (in about ${seconds} seconds).`,
  }),

  emptyRepository: (): ErrorText => ({ title: 'This repository is empty.' }),
  http: (status: number | undefined): ErrorText => ({
    title: `GitHub returned HTTP ${status ?? 'error'}.`,
  }),
  network: (): ErrorText => ({
    title: 'Could not reach the GitHub API.',
    detail: 'You may be offline, or the browser blocked the response.',
  }),
  shaCollision: (): ErrorText => ({
    title: 'Two commits share the same short SHA, so they cannot be shown.',
    detail: 'Change the number of commits and try again.',
  }),
  unexpected: (message: string): ErrorText => ({
    title: 'Unexpected error.',
    detail: message,
  }),
} as const

export const viewMessages = {
  noChanges: 'No file changes in the selected range.',
  caption: (repo: string, branch: string, commits: number, files: number) =>
    `${repo} @ ${branch}: ${commits} ${commits === 1 ? 'commit' : 'commits'}, ${files} ${files === 1 ? 'file' : 'files'}. Hover over cells for details.`,
} as const

export const formMessages = {
  repoLabel: 'Repository',
  repoPlaceholder: 'owner/repo or https://github.com/owner/repo',
  loadBranches: 'Load branches',
  branchLabel: 'Branch',
  branchesFirst: 'Load branches first',
  branchesTruncated: 'Only the first 100 branches are listed.',
  countLabel: 'Number of commits',
  countInvalid: (min: number, max: number) => `Enter a whole number from ${min} to ${max}.`,
} as const

export const statusMessages = {
  quotaUnknown: 'API quota: unknown',
  quotaReset: 'API quota: has reset (updated on the next request)',
  quota: (remaining: number, limit: number, resetAt: string, low: boolean) =>
    `API quota: ${remaining} / ${limit} left · resets at ${resetAt}${low ? ' · low' : ''}`,

  progressStarting: 'Starting…',
  progressList: 'Listing commits…',
  progressDetail: (done: number, total: number) => `Fetching commit details: ${done} / ${total}`,
  announceList: 'Listing commits',
  announceDetail: 'Fetching commit details',
  announceStarting: 'Loading commit history',

  apiMessage: 'Message from GitHub',
  warningsLabel: 'Warnings',
  truncated: (n: number) =>
    `${n} ${n === 1 ? 'commit has' : 'commits have'} more than 300 changed files; only the first 300 are shown.`,
  unknownSrc: (n: number) =>
    `For ${n} ${n === 1 ? 'commit' : 'commits'}, the source of some changes is outside the fetched range, so some arrows are not drawn.`,
  showCommits: (n: number) => `Show ${n === 1 ? 'commit' : 'commits'}`,
} as const

export const appMessages = {
  title: 'gh-file-grass',
  tagline: "See which files changed in a public GitHub repository's latest commits.",
  intro:
    'Everything runs in your browser with the unauthenticated GitHub API (60 requests per hour). ' +
    'Loading the branches uses 1 request. Showing N commits uses up to N + 1 more; commits fetched before are reused.',
  show: 'Show',
  cancel: 'Cancel',
  resultHeading: (repo: string, branch: string, commits: number) =>
    `${repo} @ ${branch} — ${commits} ${commits === 1 ? 'commit' : 'commits'}`,
  estimateUpTo: (requests: number, remaining: number | null) =>
    remaining === null
      ? `Uses up to ${requests} requests`
      : `Uses up to ${requests} requests (${remaining} left)`,
  estimateExact: (requests: number) =>
    `Uses ${requests} ${requests === 1 ? 'request' : 'requests'}`,
  estimateCached: 'Already fetched: uses no requests',
  updating: 'Updating…',
} as const
