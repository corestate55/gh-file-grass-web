import type { FileChangeType, Stat } from '../schema'
import GHLogStat from './stat'

export default class GHLogStats {
  stats: GHLogStat[]
  all: GHLogStat[] // alias
  length: number

  constructor(stats: Stat[]) {
    this.stats = stats.map((d) => new GHLogStat(d))
    this.all = this.stats
    this.length = this.stats.length
    this._classifyByLog10ModifiedLines()
  }

  findByFileAndType(file: string, type: FileChangeType): GHLogStat | undefined {
    return this.stats.find((d) => d.path === file && d.type === type)
  }

  findByFileAndRenamed(file: string): GHLogStat | undefined {
    return this.stats.find((d) => d.path === file && d.isRenamed())
  }

  findByDstAndRenamed(file: string): GHLogStat | undefined {
    return this.stats.find((d) => d.stat_path.dst === file && d.isRenamed())
  }

  findAllDstOf(stat: GHLogStat): GHLogStat[] {
    if (stat.dst === '0000000' || stat.dst === '') {
      return []
    }
    return this.stats.filter((d) => d.src === stat.dst)
  }

  sortByIndex(): void {
    this.stats.sort((a, b) => a.index - b.index)
  }

  sortByLines(): void {
    this.stats.sort((a, b) => a.lines - b.lines)
  }

  _statsDistByLog10Line(): Record<string, GHLogStat[]> {
    const statsDist: Record<string, GHLogStat[]> = {}
    this.stats.forEach((d) => {
      const countKey = d.lines > 0 ? Math.floor(10 * Math.log10(d.lines)) : 0
      const list = statsDist[countKey] ?? (statsDist[countKey] = [])
      list.push(d)
    })
    return statsDist
  }

  _classifyByLog10ModifiedLines(): void {
    this.sortByLines()
    const statsDist = this._statsDistByLog10Line()
    const stepDiv = Object.keys(statsDist).length / 4
    let modClass = 1
    let step = stepDiv
    Object.keys(statsDist)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((countKey, i) => {
        if (i > step) {
          modClass += 1
          step = stepDiv * modClass
        }
        statsDist[countKey]?.forEach((d) => {
          d.modifiedClass = modClass
        })
      })
    this.sortByIndex()
  }
}
