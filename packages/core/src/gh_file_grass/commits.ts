import type { Commit } from '../schema'
import GHLogCommit from './commit'

export default class GHLogCommits {
  commits: GHLogCommit[]
  all: GHLogCommit[] // alias
  length: number

  constructor(commits: Commit[]) {
    this.commits = commits.map((d) => new GHLogCommit(d))
    this.all = this.commits
    this.length = commits.length
    this.sort()
  }

  find(shaShort: string): GHLogCommit | undefined {
    return this.commits.find((d) => d.sha_short === shaShort)
  }

  sort(): void {
    this.commits.sort((a, b) => a.index - b.index)
  }

  indexOf(shaShort: string): number {
    return this.commits.map((d) => d.sha_short).indexOf(shaShort) + 1
  }
}
