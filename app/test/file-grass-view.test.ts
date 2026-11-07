import { assertInvariants } from '@gh-file-grass/core'
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import FileGrassView from '../src/components/FileGrassView.vue'
import { noChanges, sampleData, smallerData } from './helpers/graph-data'

const scrollOf = (w: ReturnType<typeof mount>) => w.find('.grass-scroll').element as HTMLElement

describe('FileGrassView', () => {
  test('the test data is valid for core', () => {
    expect(() => assertInvariants(sampleData())).not.toThrow()
    expect(() => assertInvariants(smallerData())).not.toThrow()
  })

  test('draws one svg into the scroll container and describes it in a caption', () => {
    const w = mount(FileGrassView, { props: { data: sampleData() } })
    const el = scrollOf(w)
    expect(el.querySelectorAll('svg')).toHaveLength(1)
    expect(el.querySelectorAll('text.commit-label')).toHaveLength(3)
    expect(el.querySelectorAll('text.file-label')).toHaveLength(2)
    expect(el.classList.contains('gh-file-grass')).toBe(true)
    expect(w.find('figcaption').text()).toBe(
      'o/r @ main: 3 commits, 2 files. Hover over cells for details.',
    )
    w.unmount()
  })

  test('a new data object replaces the picture (destroy -> draw), never stacking svgs', async () => {
    const w = mount(FileGrassView, { props: { data: sampleData() } })
    const first = scrollOf(w).querySelector('svg')
    await w.setProps({ data: smallerData() })
    const el = scrollOf(w)
    expect(el.querySelectorAll('svg')).toHaveLength(1)
    expect(el.querySelector('svg')).not.toBe(first)
    expect(el.querySelectorAll('text.commit-label')).toHaveLength(2)
    expect(el.querySelectorAll('.gh-file-grass-tooltip')).toHaveLength(1)
    expect(w.find('figcaption').text()).toContain('o/r @ dev: 2 commits')
    w.unmount()
  })

  test('re-rendering with the same data object does not redraw', async () => {
    const data = sampleData()
    const w = mount(FileGrassView, { props: { data } })
    const first = scrollOf(w).querySelector('svg')
    await w.setProps({ data })
    expect(scrollOf(w).querySelector('svg')).toBe(first)
    w.unmount()
  })

  test('unmount destroys the picture and restores the container', () => {
    const w = mount(FileGrassView, { props: { data: sampleData() } })
    const el = scrollOf(w)
    w.unmount()
    expect(el.querySelector('svg')).toBeNull()
    expect(el.querySelector('.gh-file-grass-tooltip')).toBeNull()
    expect(el.classList.contains('gh-file-grass')).toBe(false)
  })

  test('repeated redraws leave nothing behind', async () => {
    const w = mount(FileGrassView, { props: { data: sampleData() } })
    for (let i = 0; i < 5; i++) await w.setProps({ data: i % 2 ? sampleData() : smallerData() })
    const el = scrollOf(w)
    expect(el.querySelectorAll('svg')).toHaveLength(1)
    expect(el.children).toHaveLength(2) // svg + tooltip
    w.unmount()
  })

  test('data without file changes shows a message and draws nothing', async () => {
    const w = mount(FileGrassView, { props: { data: noChanges() } })
    expect(w.find('.grass-empty').text()).toBe('No file changes in the selected range.')
    expect(scrollOf(w).querySelector('svg')).toBeNull()
    expect(w.find('figcaption').exists()).toBe(false)

    // going from empty to non-empty draws, and back to empty clears
    await w.setProps({ data: sampleData() })
    expect(w.find('.grass-empty').exists()).toBe(false)
    expect(scrollOf(w).querySelectorAll('svg')).toHaveLength(1)
    await w.setProps({ data: noChanges() })
    expect(scrollOf(w).querySelector('svg')).toBeNull()
    expect(w.find('.grass-empty').exists()).toBe(true)
    w.unmount()
  })

  test('hovering a cell shows the tooltip inside the container (escaped content)', async () => {
    const data = sampleData()
    data.commits[0]!.message = '<img src=x onerror=alert(1)>'
    const w = mount(FileGrassView, { props: { data }, attachTo: document.body })
    const el = scrollOf(w)
    el.querySelector('text.commit-label.commit3')!.dispatchEvent(new MouseEvent('mouseover'))
    const tooltip = el.querySelector<HTMLElement>('.gh-file-grass-tooltip')!
    // happy-dom has no layout, so the position cannot be asserted here; the content can
    expect(tooltip.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(tooltip.querySelector('img')).toBeNull()
    w.unmount()
  })

  test('two views on one page do not interfere', () => {
    const a = mount(FileGrassView, { props: { data: sampleData() }, attachTo: document.body })
    const b = mount(FileGrassView, { props: { data: smallerData() }, attachTo: document.body })
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    a.unmount()
    expect(scrollOf(b).querySelectorAll('svg')).toHaveLength(1)
    b.unmount()
  })
})
