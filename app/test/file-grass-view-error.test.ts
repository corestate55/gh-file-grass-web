import { mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { sampleData, smallerData } from './helpers/graph-data'

const state = vi.hoisted(() => ({ fail: true }))

vi.mock('@gh-file-grass/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gh-file-grass/core')>()
  return {
    ...actual,
    draw: (...args: Parameters<typeof actual.draw>) => {
      if (state.fail) throw new Error('draw failed')
      return actual.draw(...args)
    },
  }
})

const { default: FileGrassView } = await import('../src/components/FileGrassView.vue')

describe('FileGrassView: draw failures', () => {
  test('a failing draw is reported through the error event and does not break the component', async () => {
    state.fail = true
    const w = mount(FileGrassView, { props: { data: sampleData() } })
    const errors = w.emitted('error')!
    expect(errors).toHaveLength(1)
    expect(errors[0]![0]).toBeInstanceOf(Error)
    expect((errors[0]![0] as Error).message).toBe('draw failed')
    expect(w.find('.grass-scroll').element.querySelector('svg')).toBeNull()

    // the next data is drawn normally
    state.fail = false
    await w.setProps({ data: smallerData() })
    expect(w.find('.grass-scroll').element.querySelectorAll('svg')).toHaveLength(1)
    expect(w.emitted('error')).toHaveLength(1)
    w.unmount()
  })
})
