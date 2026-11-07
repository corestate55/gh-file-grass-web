import { scaleLinear } from 'd3-scale'
import GHFileGrassBuilder from './builder'
import type GHLogCommit from './commit'

export interface CommitLinesDatum {
  index: number
  sha_short: string // for debug
  logLines: number
  lines: number
  commit: GHLogCommit // refs to call toolTipHtml()
  px?: number
}

export interface CommitHistDatum {
  index: number
  name: string // for debug
  hist: number
  py?: number
}

export default class GHBarChartBuilder extends GHFileGrassBuilder {
  _commitHistogramId(index: number): string {
    return this._id(`${this._fileClass(index)}-histogram`)
  }

  _commitLinesChartId(index: number): string {
    return this._id(`${this._commitClass(index)}-chart`)
  }

  _commitLinesChartRank(lines: number): string {
    const rank = Math.floor(lines / 10)
    return `rank${rank > 3 ? 4 : rank}` // max:4
  }

  _makeCommitLinesData(): CommitLinesDatum[] {
    return this.commits.all.map((d) => ({
      index: d.index,
      sha_short: d.sha_short, // for debug
      logLines: d.stat_total.lines > 0 ? Math.floor(10 * Math.log10(d.stat_total.lines)) : 0,
      lines: d.stat_total.lines,
      commit: d, // refs to call toolTipHtml()
    }))
  }

  _makeCommitLinesChart(): void {
    const commitLines = this._makeCommitLinesData()
    const yScale = scaleLinear()
      .domain([0, Math.max(1, ...commitLines.map((d) => d.logLines))]) // avoid zero-width domain
      .range([0, this.py0 * (1 - this.cBaseRatio)])
    const classBy = (d: CommitLinesDatum) =>
      ['commit-chart', this._commitClass(d.index), this._commitLinesChartRank(d.logLines)].join(' ')

    this._selectClippedGroup('commits')
      .selectAll('rect.commit-chart')
      .data(commitLines)
      .enter()
      .append('rect')
      .attr('id', (d) => this._commitLinesChartId(d.index))
      .attr('class', classBy)
      .attr('x', (d) => this._px(d.index, d))
      .attr('y', 0)
      .attr('width', this.lc)
      .attr('height', (d) => yScale(d.logLines))
  }

  _makeCommitHistogramData(): CommitHistDatum[] {
    return this.files.all.map((d) => ({
      index: d.index,
      name: d.name, // for debug
      hist: d.commits.length,
    }))
  }

  _makeCommitHistogram(): void {
    const commitHist = this._makeCommitHistogramData()
    const basePosRatio = 0.7
    const xScale = scaleLinear()
      .domain([0, Math.max(1, ...commitHist.map((d) => d.hist))]) // avoid zero-width domain
      .range([0, (1 - basePosRatio) * this.px0])
    const classBy = (d: CommitHistDatum) => ['commit-hist', `${this._fileClass(d.index)}`].join(' ')

    this._selectClippedGroup('files')
      .selectAll('rect.commit-hist')
      .data(commitHist)
      .enter()
      .append('rect')
      .attr('id', (d) => this._commitHistogramId(d.index))
      .attr('class', classBy)
      .attr('x', this.px0 * basePosRatio)
      .attr('y', (d) => this._py(d.index, d))
      .attr('width', (d) => xScale(d.hist))
      .attr('height', this.lc)
  }
}
