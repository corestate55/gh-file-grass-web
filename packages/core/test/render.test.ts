import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import logsJson from './fixtures/logs.json'
import { draw } from '../src'
import type { GitLogData } from '../src'

// golden-original.svg.html は元実装(gh-file-grass の JS)に同じ logs.json を与えて得た SVG。
// 移植後の出力は、インスタンス接頭辞(gfgN-)を除けばバイト単位で一致しなければならない。
const golden = readFileSync(join(import.meta.dirname, 'fixtures/golden-original.svg.html'), 'utf8')
const data = () => structuredClone(logsJson) as unknown as GitLogData

function mount(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('draw()', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('renders SVG identical to the original implementation (except id prefix)', () => {
    const container = mount()
    draw(data(), { container })
    const svg = container.querySelector('svg')!.outerHTML
    expect(svg.replace(/gfg\d+-/g, '')).toBe(golden)
  })

  test('element counts', () => {
    const container = mount()
    draw(data(), { container })
    const count = (sel: string) => container.querySelectorAll(sel).length
    expect(count('rect.stats')).toBe(221)
    expect(count('text.file-label')).toBe(38)
    expect(count('text.commit-label')).toBe(64)
    expect(count('path.stat-arrow')).toBe(186)
    expect(count('rect.file-life')).toBe(1583)
    expect(count('rect.commit-chart')).toBe(64)
    expect(count('rect.commit-hist')).toBe(38)
    expect(count('rect.drag-handler')).toBe(3)
  })

  test('does not modify the input data', () => {
    const input = data()
    const before = JSON.stringify(input)
    draw(input, { container: mount() })
    expect(JSON.stringify(input)).toBe(before)
  })

  test('two instances in one document have no id collisions', () => {
    const a = mount()
    const b = mount()
    draw(data(), { container: a })
    draw(data(), { container: b })
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    // url(#...) references stay inside their own instance
    for (const container of [a, b]) {
      const own = new Set([...container.querySelectorAll('[id]')].map((e) => e.id))
      for (const el of container.querySelectorAll('[clip-path]')) {
        const ref = /url\(#(.+)\)/.exec(el.getAttribute('clip-path')!)![1]!
        expect(own.has(ref)).toBe(true)
      }
    }
  })

  test('hover on one instance does not touch the other', () => {
    const a = mount()
    const b = mount()
    draw(data(), { container: a })
    draw(data(), { container: b })
    a.querySelector('text.file-label')!.dispatchEvent(new MouseEvent('mouseover'))
    expect(a.querySelectorAll('.selected').length).toBeGreaterThan(0)
    expect(b.querySelectorAll('.selected').length).toBe(0)
  })

  test('destroy() removes svg and tooltip and restores the container', () => {
    const container = mount()
    container.className = 'mine'
    container.appendChild(document.createElement('span')) // pre-existing child
    const handle = draw(data(), { container })
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.classList.contains('gh-file-grass')).toBe(true)

    handle.destroy()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.gh-file-grass-tooltip')).toBeNull()
    expect(container.children).toHaveLength(1)
    expect(container.className).toBe('mine')
    expect(container.style.position).toBe('')
    handle.destroy() // idempotent
  })

  test('destroy() then draw() again gives the same picture', () => {
    const container = mount()
    draw(data(), { container }).destroy()
    draw(data(), { container })
    const svg = container.querySelector('svg')!.outerHTML
    expect(svg.replace(/gfg\d+-/g, '')).toBe(golden)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  test('repeated draw/destroy leaves no residue', () => {
    const container = mount()
    for (let i = 0; i < 5; i++) draw(data(), { container }).destroy()
    expect(container.innerHTML).toBe('')
  })

  test('leaves a draw failure clean', () => {
    const container = mount()
    const bad = { ...data(), commits: null } as unknown as GitLogData
    expect(() => draw(bad, { container })).toThrow()
    expect(container.innerHTML).toBe('')
    expect(container.className).toBe('')
  })
})

describe('tooltip', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  const stubGeometry = (container: HTMLElement) => {
    // happy-dom has no layout: provide a CTM and a container rect.
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
    } as DOMRect)
    for (const el of container.querySelectorAll<SVGGraphicsElement>('svg, svg *')) {
      el.getScreenCTM = () => new DOMMatrix([1, 0, 0, 1, 130, 90])
    }
  }

  test('shows the tooltip inside the container using container-relative coordinates', () => {
    const container = mount()
    draw(data(), { container })
    stubGeometry(container)
    const tooltip = container.querySelector<HTMLElement>('.gh-file-grass-tooltip')!
    expect(tooltip.style.visibility).toBe('hidden')

    const rect = container.querySelector('rect.stats')!
    rect.dispatchEvent(new MouseEvent('mouseover'))
    expect(tooltip.style.visibility).toBe('visible')
    expect(tooltip.innerHTML).toContain('<ul>')
    const x = Number(rect.getAttribute('x'))
    const y = Number(rect.getAttribute('y'))
    // left = ctm.e + x - rect.left - lc*1.25 ; top = ctm.f + y - rect.top + lc*2   (lc = 12)
    expect(parseFloat(tooltip.style.left)).toBeCloseTo(130 + x - 100 - 15)
    expect(parseFloat(tooltip.style.top)).toBeCloseTo(90 + y - 50 + 24)

    rect.dispatchEvent(new MouseEvent('mouseout'))
    expect(tooltip.style.visibility).toBe('hidden')
  })

  describe('keeping the tooltip inside the visible part of the container', () => {
    // happy-dom has no layout: provide the measurements the code reads
    function setup(view: { clientWidth: number; scrollLeft?: number; tooltipWidth: number }) {
      const container = mount()
      draw(data(), { container })
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect)
      Object.defineProperty(container, 'clientWidth', {
        value: view.clientWidth,
        configurable: true,
      })
      container.scrollLeft = view.scrollLeft ?? 0
      const tooltip = container.querySelector<HTMLElement>('.gh-file-grass-tooltip')!
      Object.defineProperty(tooltip, 'offsetWidth', {
        value: view.tooltipWidth,
        configurable: true,
      })
      return { container, tooltip }
    }
    const hoverAt = (container: HTMLElement, ctmX: number) => {
      for (const el of container.querySelectorAll<SVGGraphicsElement>('svg, svg *')) {
        el.getScreenCTM = () => new DOMMatrix([1, 0, 0, 1, ctmX, 0])
      }
      const rect = container.querySelector('rect.stats')!
      rect.dispatchEvent(new MouseEvent('mouseover'))
      return Number(rect.getAttribute('x'))
    }
    const leftOf = (tooltip: HTMLElement) => parseFloat(tooltip.style.left)

    test('near the right edge it moves left so that it fits', () => {
      const { container, tooltip } = setup({ clientWidth: 600, tooltipWidth: 300 })
      hoverAt(container, 550)
      expect(leftOf(tooltip)).toBe(300) // 600 - 300
    })

    test('with room on the right it is placed next to the cell as before', () => {
      const { container, tooltip } = setup({ clientWidth: 2000, tooltipWidth: 300 })
      const x = hoverAt(container, 100)
      expect(leftOf(tooltip)).toBeCloseTo(100 + x - 15)
    })

    test('it never goes past the left edge, even if it is wider than the view (left edge wins)', () => {
      const { container, tooltip } = setup({ clientWidth: 200, tooltipWidth: 500 })
      hoverAt(container, 150)
      expect(leftOf(tooltip)).toBe(0)
    })

    test('the visible range follows the horizontal scroll position', () => {
      const { container, tooltip } = setup({ clientWidth: 600, scrollLeft: 400, tooltipWidth: 300 })
      hoverAt(container, 1000) // far to the right of the visible range 400..1000
      expect(leftOf(tooltip)).toBe(700) // 400 + 600 - 300
      hoverAt(container, -2000) // far to the left of it
      expect(leftOf(tooltip)).toBe(400)
    })

    test('without layout information (width 0) nothing is clamped', () => {
      const { container, tooltip } = setup({ clientWidth: 0, tooltipWidth: 0 })
      const x = hoverAt(container, 5000)
      expect(leftOf(tooltip)).toBeCloseTo(5000 + x - 15)
    })
  })
})
