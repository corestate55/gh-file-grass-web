import { select } from 'd3-selection'
import type { GitLogData } from './schema'
import GHFileGrassOperator from './gh_file_grass/operator'

export default class GHFileGrass extends GHFileGrassOperator {
  draw(data: GitLogData): void {
    this._initialize(data)
    this._makeSVGCanvas()
    this._makeTooltip()

    this._makeCommitHistogram()
    this._makeCommitLinesChart()

    this._makeFileLabels()
    this._makeCommitLabels()

    this._makeFileLifeStatRects()
    this._makeStatRects()
    this._makeStatArrows() // must be after making stats-rect

    this._addFilesHandler()
    this._addCommitsHandler()
    this._addStatsHandler()
    this._addStatsArrowHandler()
    this._addCommitHistogramHandler()
    this._addCommitLinesChartHandler()

    this._addDragToGroups()
  }

  _makeTooltip(): void {
    this.tooltip = select(this.container)
      .append('div')
      .attr('class', 'gh-file-grass-tooltip')
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '0px')
      .style('visibility', 'hidden')
  }

  destroy(): void {
    this.svg?.remove()
    this.tooltip?.remove()
  }
}
