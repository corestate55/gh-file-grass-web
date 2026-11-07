import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { defineComponent, h } from 'vue'
import BranchSelect from '../src/components/BranchSelect.vue'
import CountInput from '../src/components/CountInput.vue'
import RepoForm from '../src/components/RepoForm.vue'

describe('RepoForm', () => {
  const make = (props: Record<string, unknown> = {}) =>
    mount(RepoForm, {
      props: {
        modelValue: '',
        'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }),
        ...props,
      },
    })
  let w: ReturnType<typeof make>

  test('the input is labelled and the button is disabled while empty', () => {
    w = make()
    const input = w.find('input')
    const label = w.find('label')
    expect(label.text()).toBe('Repository')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(w.find('button').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  test('typing updates the model and enables the button', async () => {
    w = make()
    await w.find('input').setValue('vuejs/core')
    expect(w.props('modelValue')).toBe('vuejs/core')
    expect(w.find('button').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  test('submit (Enter or button) emits the raw text once', async () => {
    w = make({ modelValue: ' vuejs/core ' })
    await w.find('form').trigger('submit')
    expect(w.emitted('submit')).toEqual([[' vuejs/core ']])
    w.unmount()
  })

  test('whitespace only cannot be submitted', async () => {
    w = make({ modelValue: '   ' })
    expect(w.find('button').attributes('disabled')).toBeDefined()
    await w.find('form').trigger('submit')
    expect(w.emitted('submit')).toBeUndefined()
    w.unmount()
  })

  test('busy disables submitting', async () => {
    w = make({ modelValue: 'a/b', busy: true })
    expect(w.find('button').attributes('disabled')).toBeDefined()
    await w.find('form').trigger('submit')
    expect(w.emitted('submit')).toBeUndefined()
    w.unmount()
  })

  test('two forms in one app get distinct ids', () => {
    const Two = defineComponent({
      render: () => h('div', [h(RepoForm, { modelValue: '' }), h(RepoForm, { modelValue: '' })]),
    })
    const ids = mount(Two)
      .findAll('input')
      .map((i) => i.attributes('id'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('BranchSelect', () => {
  const branches = [{ name: 'main' }, { name: 'dev' }, { name: 'feature/<b>x</b>' }]

  test('lists the branches and shows the selected one', () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'dev' } })
    const options = w.findAll('option')
    expect(options.map((o) => o.text())).toEqual(['main', 'dev', 'feature/<b>x</b>'])
    expect((w.find('select').element as HTMLSelectElement).value).toBe('dev')
    expect(w.find('label').attributes('for')).toBe(w.find('select').attributes('id'))
  })

  test('branch names are shown as text, never as HTML', () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'main' } })
    expect(w.find('select').element.querySelector('b')).toBeNull()
  })

  test('choosing a branch updates the model', async () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'main' } })
    await w.find('select').setValue('dev')
    expect(w.emitted('update:modelValue')).toEqual([['dev']])
  })

  test('is disabled with a hint before any branch is loaded', () => {
    const w = mount(BranchSelect, { props: { branches: [], modelValue: null } })
    expect(w.find('select').attributes('disabled')).toBeDefined()
    expect(w.find('option').text()).toBe('Load branches first')
  })

  test('disabled prop', () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'main', disabled: true } })
    expect(w.find('select').attributes('disabled')).toBeDefined()
  })

  test('hasMore adds a note that the select points to', () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'main', hasMore: true } })
    const note = w.find('.note')
    expect(note.text()).toBe('Only the first 100 branches are listed.')
    expect(w.find('select').attributes('aria-describedby')).toBe(note.attributes('id'))
  })

  test('no note without hasMore', () => {
    const w = mount(BranchSelect, { props: { branches, modelValue: 'main' } })
    expect(w.find('.note').exists()).toBe(false)
    expect(w.find('select').attributes('aria-describedby')).toBeUndefined()
  })
})

describe('CountInput', () => {
  const make = (value: number | null = 20) => {
    const w = mount(CountInput, {
      props: {
        modelValue: value,
        'onUpdate:modelValue': (v: number | null) => w.setProps({ modelValue: v }),
      },
    })
    return w
  }

  test('shows the value with a label and min / max', () => {
    const w = make(20)
    const input = w.find('input')
    expect((input.element as HTMLInputElement).value).toBe('20')
    expect(input.attributes('min')).toBe('1')
    expect(input.attributes('max')).toBe('50')
    expect(w.find('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-invalid')).toBe('false')
    expect(w.find('.error').exists()).toBe(false)
  })

  test('typing a valid number updates the model immediately; "change" only when committed', async () => {
    const w = make(20)
    const input = w.find('input')
    ;(input.element as HTMLInputElement).value = '30'
    await input.trigger('input') // typing: no commit yet
    expect(w.props('modelValue')).toBe(30)
    expect(w.emitted('change')).toBeUndefined()
    await input.trigger('change') // blur / Enter
    expect(w.emitted('change')).toEqual([[30]])
  })

  test.each(['', '0', '51', '1.5', '-3', 'abc', '1e1'])(
    'invalid input %j -> null model, error shown, no change event',
    async (text) => {
      const w = make(20)
      const input = w.find('input')
      await input.setValue(text)
      expect(w.props('modelValue')).toBeNull()
      expect(input.attributes('aria-invalid')).toBe('true')
      expect(w.find('.error').text()).toBe('Enter a whole number from 1 to 50.')
      expect(input.attributes('aria-describedby')).toBe(w.find('.error').attributes('id'))
      await input.trigger('change')
      expect(w.emitted('change')).toBeUndefined()
    },
  )

  test('recovers when a valid number is entered again', async () => {
    const w = make(20)
    const input = w.find('input')
    await input.setValue('99')
    expect(w.props('modelValue')).toBeNull()
    await input.setValue('12')
    expect(w.props('modelValue')).toBe(12)
    expect(w.find('.error').exists()).toBe(false)
  })

  test('boundaries 1 and 50 are accepted', async () => {
    const w = make(20)
    await w.find('input').setValue('1')
    expect(w.props('modelValue')).toBe(1)
    await w.find('input').setValue('50')
    expect(w.props('modelValue')).toBe(50)
  })

  test('a value set by the parent replaces the text', async () => {
    const w = make(20)
    await w.setProps({ modelValue: 5 })
    expect((w.find('input').element as HTMLInputElement).value).toBe('5')
  })

  test('null model starts as an invalid empty field', () => {
    const w = make(null)
    expect(w.find('input').attributes('aria-invalid')).toBe('true')
  })

  test('custom range', async () => {
    const w = mount(CountInput, { props: { modelValue: 3, min: 2, max: 4 } })
    await w.find('input').setValue('5')
    expect(w.find('.error').text()).toBe('Enter a whole number from 2 to 4.')
  })
})
