import { describe, expect, it } from 'vitest'

import { errorsOf } from '@/apiErrors'

describe('errorsOf', () => {
  it('reads the errors of a 422 by field, the first of a field counts', () => {
    expect(
      errorsOf({
        errors: [
          { field: 'name', message: 'a' },
          { field: 'name', message: 'b' },
          { field: 'options.1.label', message: 'c' },
        ],
      }),
    ).toEqual({ name: 'a', 'options.1.label': 'c' })
    expect(errorsOf(undefined)).toEqual({})
    expect(errorsOf({ errors: 'x' })).toEqual({})
  })
})
