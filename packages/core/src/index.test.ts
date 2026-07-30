import { describe, expect, it } from 'vitest'
import { placeholder, placeholderSchema } from './index.js'

describe('placeholder', () => {
  it('produces a value that satisfies the schema', () => {
    expect(placeholderSchema.parse(placeholder())).toEqual({ ready: true })
  })
})
