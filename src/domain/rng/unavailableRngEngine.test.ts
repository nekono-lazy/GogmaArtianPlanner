import { describe, expect, it } from 'vitest'
import { UnavailableRngEngine } from './unavailableRngEngine'
import { UnsupportedRngOperationError } from './rngEngine'

describe('UnavailableRngEngine', () => {
  it('advertises no production capability and never guesses seed behavior', () => {
    const engine = new UnavailableRngEngine()
    expect(Object.values(engine.capabilities)).toEqual([false, false, false, false, false])
    expect(() => engine.normalizeSeed('unverified')).toThrow(UnsupportedRngOperationError)
  })
})
