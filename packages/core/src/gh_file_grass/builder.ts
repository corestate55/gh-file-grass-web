import { linkHorizontal } from 'd3-shape'
import type { Link } from 'd3-shape'
import GHFileGrassBase from './base'
import type { Pos } from './base'

export interface FileLifeDatum extends Pos {
  fileIndex: number
  commitIndex: number
  // not a stat: keeps the union with GHLogStat discriminable
  index?: undefined
  tooltipHtml?: undefined
}

export interface ArrowDatum {
  sourceIndex: number
  targetIndex: number
  source: [number, number]
  target: [number, number]
}

export default class GHFileGrassBuilder extends GHFileGrassBase {
  statsLink!: Link<unknown, ArrowDatum, [number, number]>

  _fileClass(index: number): string {
    return `file${index}`
  }

  _fileLabelId(index: number): string {
    return `${this._fileClass(index)}-label`
  }

  _commitClass(index: number): string {
    return `commit${index}`
  }

  _commitLabelId(index: number): string {
    return `${this._commitClass(index)}-label`
  }

  _statClass(index: number): string {
    return `stat${index}`
  }

  _statRectId(index: number): string {
    return this._statClass(index)
  }

  _modClass(index: number): string {
    // specify color style of 'file-grass'
    return `mod${index}`
  }

  _ghUri(...pathList: string[]): string {
    let urlBase = this.origin
    const result = /.+@(.+):(.+)/.exec(this.origin)
    if (result) {
      urlBase = `https://${result[1]}/${result[2]}`
    }
    return [urlBase].concat(pathList).join('/')
  }

  _makeFileLabels(): void {
    this._selectClippedGroup('files')
      .selectAll('text.file-label')
      .data(this.files.all)
      .enter()
      .append('a')
      .attr('xlink:href', (d) => this._ghUri('blob', this.branch, d.name))
      .attr('target', '_blank')
      .append('text')
      .attr('id', (d) => this._fileLabelId(d.index))
      .attr('class', (d) => `file-label ${this._fileClass(d.index)}`)
      .attr('x', (d) => this._px(0, d))
      .attr('y', (d) => this._py(d.index, d))
      .attr('dy', this.fontSize)
      .text((d) => d.name)
  }

  _makeCommitLabels(): void {
    this._selectClippedGroup('commits')
      .selectAll('text.commit-label')
      .data(this.commits.all)
      .enter()
      .append('a')
      .attr('xlink:href', (d) => this._ghUri('commit', d.sha))
      .attr('target', '_blank')
      .append('text')
      .attr('id', (d) => this._commitLabelId(d.index))
      .attr('class', (d) => `commit-label ${this._commitClass(d.index)}`)
      .attr('x', (d) => this._px(d.index, d))
      .attr('y', (d) => this._py(0, d))
      .attr('dx', this.fontSize / 2)
      .attr('dy', this.fontSize / 2)
      .attr('transform', (d) => `rotate(-60,${d.px},${d.py})`)
      .text((d) => d.sha_short)
  }

  _lifeStartIndex(file: { name: string }): number {
    const stat =
      this.stats.findByFileAndType(file.name, 'new') || this.stats.findByDstAndRenamed(file.name)

    if (stat) {
      return this.commits.indexOf(stat.sha_short)
    }
    return 1
  }

  _lifeEndIndex(file: { name: string }): number {
    const stat =
      this.stats.findByFileAndType(file.name, 'deleted') ||
      this.stats.findByFileAndRenamed(file.name)

    if (stat) {
      return this.commits.indexOf(stat.sha_short)
    }
    return this.commits.length
  }

  _makeFileLifeStatRectsData(file: { name: string; index: number }): FileLifeDatum[] {
    const startIndex = this._lifeStartIndex(file)
    const endIndex = this._lifeEndIndex(file)

    return Array.from({ length: endIndex - startIndex + 1 }, (_, i) => ({
      fileIndex: file.index,
      commitIndex: i + startIndex,
      px: 0,
      py: 0,
    }))
  }

  _makeFileLifeStatRects(): void {
    for (const file of this.files.all) {
      const range = this._makeFileLifeStatRectsData(file)
      const classBy = (d: FileLifeDatum) =>
        ['file-life', this._fileClass(d.fileIndex), this._commitClass(d.commitIndex)].join(' ')

      this._selectClippedGroup('stats')
        .selectAll(`rect.file-${file.index}`)
        .data(range)
        .enter()
        .append('rect')
        .attr('class', classBy)
        .attr('x', (d) => this._px(d.commitIndex, d))
        .attr('y', (d) => this._py(d.fileIndex, d))
        .attr('width', this.lc)
        .attr('height', this.lc)
    }
  }

  _updateStatRectsData(): void {
    // add file/commit index
    this.stats.all.forEach((d) => {
      d.fileIndex = this.files.indexOf(d.path)
      d.commitIndex = this.commits.indexOf(d.sha_short)
    })
  }

  _makeStatRects(): void {
    this._updateStatRectsData()
    const classBy = (d: (typeof this.stats.all)[number]) =>
      [
        'stats',
        this._statClass(d.index),
        this._fileClass(d.fileIndex),
        this._commitClass(d.commitIndex),
        this._modClass(d.modifiedClass),
      ].join(' ')
    const sha = (d: (typeof this.stats.all)[number]) => {
      const c = this.commits.find(d.sha_short)
      return c ? c.sha : ''
    }

    this._selectClippedGroup('stats')
      .selectAll('rect.stats')
      .data(this.stats.all)
      .enter()
      .append('a')
      .attr('xlink:href', (d) => this._ghUri('tree', sha(d), d.stat_path.dst))
      .attr('target', '_blank')
      .attr('class', 'stats')
      .append('rect')
      .attr('id', (d) => this._statRectId(d.index))
      .attr('class', classBy)
      .attr('x', (d) => this._rectX(d))
      .attr('y', (d) => this._rectY(d))
      .attr('width', this.lc)
      .attr('height', this.lc)
  }

  _rectX(stat: { commitIndex: number }): number {
    return this._px(stat.commitIndex, stat as Partial<Pos>)
  }

  _rectY(stat: { fileIndex: number }): number {
    return this._py(stat.fileIndex, stat as Partial<Pos>)
  }

  _makeStatArrowsData(): ArrowDatum[] {
    const arrows: ArrowDatum[] = []
    const dxy = this.lc / 2
    for (const stat of this.stats.all) {
      const dstStats = this.stats.findAllDstOf(stat)
      if (dstStats.length < 1) {
        continue
      }
      dstStats.forEach((dstStat) => {
        arrows.push({
          sourceIndex: stat.index,
          targetIndex: dstStat.index,
          source: [stat.px + dxy, stat.py + dxy],
          target: [dstStat.px + dxy, dstStat.py + dxy],
        })
      })
    }
    return arrows
  }

  _makeStatArrows(): void {
    const arrows = this._makeStatArrowsData()
    const classBy = (d: ArrowDatum) =>
      ['stat-arrow', this._statClass(d.sourceIndex), this._statClass(d.targetIndex)].join(' ')

    this.statsLink = linkHorizontal<ArrowDatum, [number, number]>() // link generator
    this._selectClippedGroup('stats')
      .selectAll('path.stat-arrow')
      .data(arrows)
      .enter()
      .insert('path', 'a.stats') // paths be under stats-rect
      .attr('class', classBy)
      .attr('d', (d) => this.statsLink(d))
  }
}
