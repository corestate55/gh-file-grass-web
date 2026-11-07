import type { Author, Commit, StatTotal } from '../schema'
import GHInfoBase from './info_base'
import { escapeHtml as esc, truncateText } from './escape'

// ツールチップに出すメッセージの上限。超えた分は省略する(dependabot の長い本文などで巨大にならないように)
const MESSAGE_MAX_LINES = 8
const MESSAGE_MAX_CHARS = 400

export default class GHLogCommit extends GHInfoBase {
  sha: string
  sha_short: string
  author: Author
  date: string
  message: string
  index: number
  stat_total: StatTotal
  // position saved by GHFileGrassBase._px()/_py()
  px = 0
  py = 0

  constructor(commit: Commit) {
    super()
    this.sha = commit.sha
    this.sha_short = commit.sha_short
    this.author = commit.author
    this.date = commit.date
    this.message = commit.message
    this.index = commit.index
    this.stat_total = commit.stat_total
  }

  _statTotalStr(): string {
    const st = this.stat_total // shortening alias
    const file = `${st.files} changed ${st.files > 1 ? 'files' : 'file'}`
    const add = `${st.insertions} additions`
    const del = `${st.deletions} deletions`

    return `${this._filesStr(file)} with ${this._insStr(add)} and ${this._delStr(del)}.`
  }

  tooltipHtml(): string {
    return [
      '<ul>',
      this._liStr(this._codeStr(esc(this.sha))),
      this._liStr(`${esc(this.author.name)} &lt;${esc(this.author.email)}&gt;`),
      this._liStr(esc(this.date)),
      this._liStr(esc(truncateText(this.message, MESSAGE_MAX_LINES, MESSAGE_MAX_CHARS)), 'message'),
      this._liStr(this._statTotalStr()),
      '</ul>',
    ].join('')
  }
}
