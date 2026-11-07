import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import App from '../src/App.vue'

describe('App', () => {
  test('mounts and can use the workspace packages from source', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('corestate55/gh-file-grass')
    expect(wrapper.text()).toContain('core ready')
  })
})
