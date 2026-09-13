import { describe, expect, it } from 'vitest'
import {
  initializeReferencePrng,
  nextReferencePrngState,
  type ReferencePrngState,
} from '../production/referencePrng'
import {
  applyReferencePrngJump,
  compileReferencePrngJump,
} from './referencePrngJump'

const DIRECT_STEP_COUNTS = [
  0,
  1,
  2,
  3,
  5,
  10,
  31,
  32,
  33,
  100,
  255,
  256,
  257,
  999,
  1_000,
] as const

function advanceDirectly(
  state: ReferencePrngState,
  stepCount: number,
): ReferencePrngState {
  let current = state
  for (let step = 0; step < stepCount; step += 1) {
    current = nextReferencePrngState(current)
  }
  return current
}

function singleBitState(inputBit: number): ReferencePrngState {
  const wordIndex = Math.floor(inputBit / 32)
  const bitPattern = (1 << (inputBit % 32)) >>> 0
  return {
    x: wordIndex === 0 ? bitPattern : 0,
    y: wordIndex === 1 ? bitPattern : 0,
    z: wordIndex === 2 ? bitPattern : 0,
    w: wordIndex === 3 ? bitPattern : 0,
  }
}

const LINEAR_OPERATOR_STATES: readonly ReferencePrngState[] = [
  { x: 0, y: 0, z: 0, w: 0 },
  ...Array.from({ length: 128 }, (_, inputBit) => singleBitState(inputBit)),
]

const PRODUCTION_INITIALIZED_STATES: readonly ReferencePrngState[] = [
  initializeReferencePrng(0),
  initializeReferencePrng(1),
  initializeReferencePrng(51_231_782),
  initializeReferencePrng(99_999_999),
]

const DETERMINISTIC_STATES: readonly ReferencePrngState[] = [
  { x: 0x6d2b79f5, y: 0x1b56c4e9, z: 0xa5a5a5a5, w: 0x5a5a5a5a },
  { x: 0xffffffff, y: 0x80000000, z: 0x7fffffff, w: 0x00000001 },
  { x: 0x243f6a88, y: 0x85a308d3, z: 0x13198a2e, w: 0x03707344 },
  { x: 0xdeadbeef, y: 0xcafebabe, z: 0x01234567, w: 0x89abcdef },
]

const ALL_TEST_STATES = [
  ...LINEAR_OPERATOR_STATES,
  ...PRODUCTION_INITIALIZED_STATES,
  ...DETERMINISTIC_STATES,
]

describe('Reference PRNG forward jump', () => {
  it.each(DIRECT_STEP_COUNTS)(
    'matches direct Production stepping for %i steps',
    (stepCount) => {
      const jump = compileReferencePrngJump(stepCount)
      for (const state of ALL_TEST_STATES) {
        expect(applyReferencePrngJump(jump, state)).toEqual(
          advanceDirectly(state, stepCount),
        )
      }
    },
  )

  it.each([
    [0, 0],
    [0, 1],
    [1, 0],
    [2, 3],
    [10, 31],
    [32, 33],
    [255, 257],
    [999, 1_000],
    [100_000, 1_000_000],
  ] as const)('obeys the semigroup property for %i + %i steps', (a, b) => {
    const combined = compileReferencePrngJump(a + b)
    const first = compileReferencePrngJump(a)
    const second = compileReferencePrngJump(b)
    for (const state of [...PRODUCTION_INITIALIZED_STATES, ...DETERMINISTIC_STATES]) {
      expect(applyReferencePrngJump(combined, state)).toEqual(
        applyReferencePrngJump(second, applyReferencePrngJump(first, state)),
      )
    }
  })

  it('compiles deterministic operators for the same step count', () => {
    const first = compileReferencePrngJump(257)
    const second = compileReferencePrngJump(257)
    for (const state of ALL_TEST_STATES) {
      expect(applyReferencePrngJump(first, state)).toEqual(
        applyReferencePrngJump(second, state),
      )
    }
  })

  it('does not mutate the input state', () => {
    const state = { x: 0xdeadbeef, y: 0xcafebabe, z: 0x01234567, w: 0x89abcdef }
    const original = { ...state }
    applyReferencePrngJump(compileReferencePrngJump(1_000), state)
    expect(state).toEqual(original)
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid step count %s', (stepCount) => {
    expect(() => compileReferencePrngJump(stepCount)).toThrow(RangeError)
  })
})
