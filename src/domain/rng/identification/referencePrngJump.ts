import {
  nextReferencePrngState,
  type ReferencePrngState,
} from '../production/referencePrng'

const STATE_WORD_COUNT = 4
const STATE_BIT_COUNT = 128

export type ReferencePrngJump = Uint32Array

function stateWords(state: ReferencePrngState): readonly number[] {
  return [state.x, state.y, state.z, state.w]
}

function identityMatrix(): ReferencePrngJump {
  const matrix = new Uint32Array(STATE_BIT_COUNT * STATE_WORD_COUNT)
  for (let bit = 0; bit < STATE_BIT_COUNT; bit += 1) {
    matrix[bit * STATE_WORD_COUNT + Math.floor(bit / 32)] = (1 << (bit % 32)) >>> 0
  }
  return matrix
}

function oneStepMatrix(): ReferencePrngJump {
  const matrix = new Uint32Array(STATE_BIT_COUNT * STATE_WORD_COUNT)
  for (let bit = 0; bit < STATE_BIT_COUNT; bit += 1) {
    const words = [0, 0, 0, 0]
    words[Math.floor(bit / 32)] = (1 << (bit % 32)) >>> 0
    const next = nextReferencePrngState({
      x: words[0]!,
      y: words[1]!,
      z: words[2]!,
      w: words[3]!,
    })
    matrix.set(stateWords(next), bit * STATE_WORD_COUNT)
  }
  return matrix
}

export function applyReferencePrngJump(
  matrix: ReferencePrngJump,
  state: ReferencePrngState,
): ReferencePrngState {
  const output = [0, 0, 0, 0]
  const inputWords = stateWords(state)
  for (let wordIndex = 0; wordIndex < STATE_WORD_COUNT; wordIndex += 1) {
    let bits = inputWords[wordIndex]! >>> 0
    while (bits !== 0) {
      const lowestBit = (bits & -bits) >>> 0
      const bitIndex = 31 - Math.clz32(lowestBit)
      const columnOffset = (wordIndex * 32 + bitIndex) * STATE_WORD_COUNT
      output[0] = (output[0]! ^ matrix[columnOffset]!) >>> 0
      output[1] = (output[1]! ^ matrix[columnOffset + 1]!) >>> 0
      output[2] = (output[2]! ^ matrix[columnOffset + 2]!) >>> 0
      output[3] = (output[3]! ^ matrix[columnOffset + 3]!) >>> 0
      bits = (bits & (bits - 1)) >>> 0
    }
  }
  return { x: output[0]!, y: output[1]!, z: output[2]!, w: output[3]! }
}

function composeMatrices(
  after: ReferencePrngJump,
  before: ReferencePrngJump,
): ReferencePrngJump {
  const composed = new Uint32Array(STATE_BIT_COUNT * STATE_WORD_COUNT)
  for (let bit = 0; bit < STATE_BIT_COUNT; bit += 1) {
    const offset = bit * STATE_WORD_COUNT
    const transformed = applyReferencePrngJump(after, {
      x: before[offset]!,
      y: before[offset + 1]!,
      z: before[offset + 2]!,
      w: before[offset + 3]!,
    })
    composed.set(stateWords(transformed), offset)
  }
  return composed
}

/** Builds a forward-only linear transition from the Production PRNG step. */
export function compileReferencePrngJump(stepCount: number): ReferencePrngJump {
  if (!Number.isSafeInteger(stepCount) || stepCount < 0) {
    throw new RangeError('Reference PRNG jump step count must be a non-negative safe integer')
  }
  let remaining = stepCount
  let result = identityMatrix()
  let power = oneStepMatrix()
  while (remaining !== 0) {
    if (remaining % 2 === 1) result = composeMatrices(power, result)
    remaining = Math.floor(remaining / 2)
    if (remaining !== 0) power = composeMatrices(power, power)
  }
  return result
}
