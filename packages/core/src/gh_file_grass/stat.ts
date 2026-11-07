import type { FileChangeType, Stat, StatPath } from '../schema'
import GHInfoBase from './info_base'
import { escapeHtml as esc } from './escape'

export default class GHLogStat extends GHInfoBase {
  path: string
  mode: string
  type: FileChangeType | null
  src: string
  dst: string
  bin: boolean | undefined
  stat_path: StatPath
  insertions: number
  deletions: number
  lines: number
  sha_short: string
  index: number
  // added by GHLogStats / GHFileGrassBuilder
  modifiedClass = 0
  fileIndex = 0
  commitIndex = 0
  px = 0
  py = 0

  constructor(stat: Stat) {
    super()
    this.path = stat.path
    this.mode = stat.mode
    this.type = stat.type
    this.src = stat.src
    this.dst = stat.dst
    this.bin = stat.bin
    this.stat_path = stat.stat_path
    this.insertions = stat.insertions
    this.deletions = stat.deletions
    this.lines = stat.lines
    this.sha_short = stat.sha_short
    this.index = stat.index
  }

  isRenamed(): boolean {
    return this.stat_path.src !== this.stat_path.dst
  }

  isModified(): boolean {
    return this.lines > 0
  }

  _statBarStr(ins: number, del: number): string {
    const total = ins + del
    const barStr = (classStr: string, count: number) => {
      return `<span class="stat-box ${classStr}"></span>`.repeat(count)
    }
    const cal = (val: number, total: number) => {
      return total <= 5 ? val : Math.floor(val / (total / 5))
    }
    const insRepeat = cal(ins, total)
    const delRepeat = cal(del, total)
    const keepRepeat = 5 - insRepeat - delRepeat
    const barData = { ins: insRepeat, del: delRepeat, keep: keepRepeat }
    return (Object.keys(barData) as (keyof typeof barData)[])
      .map((key) => barStr(key, barData[key]))
      .join('')
  }

  _fileActionStr(): string {
    const space = '&nbsp;&nbsp;'
    const markedStr = (mark: string, str: string) => [mark, str].join(space)

    if (this.type === 'new') {
      return markedStr(this._addedMark(), this._insStr(esc(this.path)))
    } else if (this.type === 'deleted') {
      return markedStr(this._deletedMark(), this._delStr(esc(this.path)))
    } else if (this.isRenamed()) {
      return markedStr(this._renamedMark(), esc(this.stat_path.path))
    } else {
      // modified
      const str = this.isRenamed() ? esc(this.stat_path.path) : this._modStr(esc(this.path))
      return markedStr(this._modifiedMark(), str)
    }
  }

  _diffIndexStr(): string {
    if (!this.isModified()) {
      return ''
    }
    // src / dst は、分からないとき(例: 変更前が取得範囲の外)は '' になる。空のまま出さず '?' にする。
    // mode も取得元によっては無い。
    const blob = (hash: string) => (hash === '' ? '?' : hash)
    const range = `${blob(this.src)}..${blob(this.dst)}`
    return this._liStr(this._codeStr(esc(this.mode ? `${range} ${this.mode}` : range)))
  }

  _statIndicatorStr(): string {
    const bar = this._statBarStr(this.insertions, this.deletions)
    if (this.bin) {
      return `BIN ${bar}`
    }
    const ins = '+' + this.insertions
    const del = '-' + this.deletions
    return `${this._insStr(ins)}, ${this._delStr(del)} ${bar} (${this.lines})`
  }

  tooltipHtml(): string {
    return [
      '<ul>',
      this._liStr(this._codeStr(esc(this.sha_short))),
      this._liStr(this._fileActionStr()),
      this._liStr(this._statIndicatorStr()),
      this._diffIndexStr(), // empty for no-diff stat
      '</ul>',
    ].join('')
  }
}
