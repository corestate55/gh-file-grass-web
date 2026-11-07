import { expect, test } from 'vitest'
import * as mod from '../src/index'

test('package entry loads', () => {
  expect(mod).toBeDefined()
})
