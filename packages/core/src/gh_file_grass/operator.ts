import { select } from 'd3-selection'
import type { Selection } from 'd3-selection'
import { drag } from 'd3-drag'
import type { D3DragEvent } from 'd3-drag'
import GHBarChartBuilder from './chart_builder'
import type { CommitHistDatum, CommitLinesDatum } from './chart_builder'
import type { ArrowDatum, FileLifeDatum } from './builder'
import type { FileDatum } from './files'
import type GHLogCommit from './commit'
import type GHLogStat from './stat'
import type { Area, GroupDatum } from './base'

type AnySelection = Selection<Element, unknown, SVGSVGElement, unknown>
type StatRectDatum = GHLogStat | FileLifeDatum

export default class GHFileGrassOperator extends GHBarChartBuilder {
  _selectObject(classStr: string, callback: (selection: AnySelection) => void): void {
    const selection = this.svg.selectAll(`.${classStr}`) as unknown as AnySelection
    callback(selection)
  }

  _selectFile(fileIndex: number, callback: (selection: AnySelection) => void): void {
    this._selectObject(this._fileClass(fileIndex), callback)
  }

  _selectCommit(commitIndex: number, callback: (selection: AnySelection) => void): void {
    this._selectObject(this._commitClass(commitIndex), callback)
  }

  _selectStat(statIndex: number, callback: (selection: AnySelection) => void): void {
    this._selectObject(this._statClass(statIndex), callback)
  }

  _addSelected(selection: AnySelection): void {
    selection.classed('selected', true)
  }

  _removeSelected(selection: AnySelection): void {
    selection.classed('selected', false)
  }

  _addFilesHandler(): void {
    const mouseOver = (_ev: Event, d: FileDatum) => this._selectFile(d.index, this._addSelected)
    const mouseOut = (_ev: Event, d: FileDatum) => this._selectFile(d.index, this._removeSelected)
    this._selectClippedGroup('files')
      .selectAll<SVGTextElement, FileDatum>('text')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _addCommitsHandler(): void {
    const mouseOver = (_ev: Event, d: GHLogCommit) => {
      this._selectCommit(d.index, this._addSelected)
      this._enableTooltip(d.tooltipHtml(), this._commitLabelId(d.index))
    }
    const mouseOut = (_ev: Event, d: GHLogCommit) => {
      this._selectCommit(d.index, this._removeSelected)
      this._disableTooltip()
    }
    this._selectClippedGroup('commits')
      .selectAll<SVGTextElement, GHLogCommit>('text')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _positionMatrixOfId(id: string): DOMMatrix {
    const target = document.getElementById(id) as unknown as SVGGraphicsElement
    // attribute .[xy] are only for rect and text.
    return target.getScreenCTM()!.translate(+target.getAttribute('x')!, +target.getAttribute('y')!)
  }

  _enableTooltip(htmlStr: string, id: string): void {
    const matrix = this._positionMatrixOfId(id)
    const yMargin = id.match(/commit.*label/) ? 1 : 2
    select('div#stat-tooltip')
      .style('visibility', 'visible')
      .style('left', `${window.pageXOffset + matrix.e - this.lc * 1.25}px`)
      .style('top', `${window.pageYOffset + matrix.f + this.lc * yMargin}px`)
      .html(htmlStr)
  }

  _disableTooltip(): void {
    select('div#stat-tooltip').style('visibility', 'hidden')
  }

  _addStatsHandler(): void {
    const mouseOver = (_ev: Event, d: StatRectDatum) => {
      this._selectCommit(d.commitIndex, this._addSelected)
      this._selectFile(d.fileIndex, this._addSelected)
      if (d.index) {
        this._selectStat(d.index, this._addSelected)
        this._enableTooltip(d.tooltipHtml(), this._statRectId(d.index))
      }
    }
    const mouseOut = (_ev: Event, d: StatRectDatum) => {
      this._selectCommit(d.commitIndex, this._removeSelected)
      this._selectFile(d.fileIndex, this._removeSelected)
      if (d.index) {
        this._selectStat(d.index, this._removeSelected)
        this._disableTooltip()
      }
    }
    this._selectClippedGroup('stats')
      .selectAll<SVGRectElement, StatRectDatum>('rect')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _addStatsArrowHandler(): void {
    const mouseOver = (_ev: Event, d: ArrowDatum) => {
      ;[d.sourceIndex, d.targetIndex].forEach((statIndex) => {
        this._selectStat(statIndex, this._addSelected)
      })
    }
    const mouseOut = (_ev: Event, d: ArrowDatum) => {
      ;[d.sourceIndex, d.targetIndex].forEach((statIndex) => {
        this._selectStat(statIndex, this._removeSelected)
      })
    }
    this._selectClippedGroup('stats')
      .selectAll<SVGPathElement, ArrowDatum>('path')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _histogramToolTipHtml(d: CommitHistDatum): string {
    return `${d.hist} ${d.hist > 1 ? 'commits' : 'commit'}`
  }

  _addCommitHistogramHandler(): void {
    const mouseOver = (_ev: Event, d: CommitHistDatum) => {
      this._selectFile(d.index, this._addSelected)
      this._enableTooltip(this._histogramToolTipHtml(d), this._commitHistogramId(d.index))
    }
    const mouseOut = (_ev: Event, d: CommitHistDatum) => {
      this._selectFile(d.index, this._removeSelected)
      this._disableTooltip()
    }
    this._selectClippedGroup('files')
      .selectAll<SVGRectElement, CommitHistDatum>('rect.commit-hist')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _addCommitLinesChartHandler(): void {
    const mouseOver = (_ev: Event, d: CommitLinesDatum) => {
      this._selectCommit(d.index, this._addSelected)
      this._enableTooltip(d.commit.tooltipHtml(), this._commitLinesChartId(d.index))
    }
    const mouseOut = (_ev: Event, d: CommitLinesDatum) => {
      this._selectCommit(d.index, this._removeSelected)
      this._disableTooltip()
    }
    this._selectClippedGroup('commits')
      .selectAll<SVGRectElement, CommitLinesDatum>('rect.commit-chart')
      .on('mouseover', mouseOver)
      .on('mouseout', mouseOut)
  }

  _dragAll(dx: number, dy: number): void {
    this._selectClippedGroup('commits')
      .selectAll<SVGTextElement, GHLogCommit>('text')
      .attr('x', (d) => (d.px += dx))
      .attr('transform', (d) => `rotate(-60,${d.px},${d.py})`)
    this._selectClippedGroup('files')
      .selectAll<SVGTextElement, FileDatum>('text')
      .attr('y', (d) => (d.py += dy))
    this._selectClippedGroup('stats')
      .selectAll<SVGRectElement, { px: number; py: number }>('rect')
      .attr('x', (d) => (d.px += dx))
      .attr('y', (d) => (d.py += dy))
    this._selectClippedGroup('stats')
      .selectAll<SVGPathElement, ArrowDatum>('path')
      .attr('d', (d) => {
        d.source[0] += dx
        d.source[1] += dy
        d.target[0] += dx
        d.target[1] += dy
        return this.statsLink(d)
      })
    this._selectClippedGroup('files')
      .selectAll<SVGRectElement, { py: number }>('rect')
      .attr('y', (d) => (d.py += dy))
    this._selectClippedGroup('commits')
      .selectAll<SVGRectElement, { px: number }>('rect')
      .attr('x', (d) => (d.px += dx))
  }

  _addDragToGroups(): void {
    type DragEvent = D3DragEvent<SVGRectElement, GroupDatum, GroupDatum>
    const handlerOf: Record<Area, (event: DragEvent) => void> = {
      commits: (event) => this._dragAll(event.dx, 0),
      files: (event) => this._dragAll(0, event.dy),
      stats: (event) => this._dragAll(event.dx, event.dy),
    }
    for (const area of Object.keys(handlerOf) as Area[]) {
      // NOTICE: insert drag-handler rect before 'g' (clipped-group)
      // to prevent to cover (and disable) stat-rect event.
      this._selectGroup(area)
        .insert('rect', 'g')
        .attr('id', `${area}-drag-handler`)
        .attr('class', 'drag-handler')
        .attr('x', (d) => d.clipPath.x)
        .attr('y', (d) => d.clipPath.y)
        .attr('width', (d) => d.clipPath.width)
        .attr('height', (d) => d.clipPath.height)
        .call(drag<SVGRectElement, GroupDatum>().on('drag', handlerOf[area]))
    }
  }
}
