/**
 * Issue #74 Phase 1 research only (`docs/ISSUE_74_NORMAL_SEED_IDENTIFICATION_RESEARCH.md`).
 *
 * Identifies `Base Seed + starting Normal Counter` pairs from consecutive
 * rarity-8 Normal Artian observations of one weapon type. Nothing in the
 * Production execution path imports this module: it is not an Identification
 * contract, has no Worker, UI or Persistence, and does not change
 * `docs/RNG_SPEC.md` 9.12 (where the Base Seed stays known). It exists to
 * measure whether the existing Normal Counter Identification can be widened to
 * an unknown Base Seed, and how fast a complete search can be.
 *
 * Two methods are compared:
 *
 * - Method A (`identifyNormalSeedAndCounterWithCounterKernel`): calls the
 *   unchanged Production kernel `identifyNormalArtianCounter()` once per Base
 *   Seed candidate. It is the correctness baseline.
 * - Method B (`identifyNormalSeedAndCounterCompiled`): the same Production
 *   seed derivation / initialization / jump / ten-step block and the same pool
 *   step, compiled into per-slot `w % modulus === index` constraints and a
 *   non-allocating int32 PRNG walk. The seed derivation term, the 100-round
 *   initialization and the one-step transition are inlined copies of the
 *   Production functions, each checked bit-for-bit by the research test. It
 *   prunes no Seed and no Counter on any assumed game rule; every
 *   (Seed, Counter) of the requested ranges is evaluated.
 *
 * The compiled constraint is exact, not a heuristic: for one ordered
 * observation the pool state before each slot is fully determined by the
 * observed prefix (each slot must have selected the observed candidate, and
 * candidate IDs are unique within a pool), so `selectReferenceNormalLotteryIdsFromRawValues()`
 * returns the observation if and only if every slot's raw word satisfies
 * `raw % poolLength === observedIndex` for that derived pool. The research test
 * checks this differentially against the Production pool step.
 */
import type { NormalArtianRarity, WeaponTypeId } from '../../domain/models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../../domain/models/common'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { isNormalArtianLotteryTableClass } from '../../domain/rng/normalArtianLotteryTable'
import { gameVerifiedNormalCandidatesForWeaponAndTableClass } from '../../domain/rng/production/gameNormalBonuses'
import {
  referenceNormalIdFromRestorationBonus,
  type ReferenceNormalCandidate,
  type ReferenceNormalLotteryId,
} from '../../domain/rng/production/referenceNormalBonuses'
import {
  REFERENCE_RNG_BLOCK_SIZE,
  type ReferencePrngState,
} from '../../domain/rng/production/referencePrng'
import { deriveNormalArtianSeed, REFERENCE_RNG_SEED_SALT } from '../../domain/rng/production/seedDerivation'
import {
  getNormalArtianCounterIdentificationSupport,
  identifyNormalArtianCounter,
} from '../../domain/rng/identification/normalArtianCounterIdentification'
import {
  applyReferencePrngJump,
  compileReferencePrngJump,
  type ReferencePrngJump,
} from '../../domain/rng/identification/referencePrngJump'
import type { NormalArtianCounterObservation } from '../../domain/rng/identification/normalArtianCounterIdentificationTypes'
import {
  CANONICAL_BASE_SEED_MAX,
  CANONICAL_BASE_SEED_MIN,
  type InclusiveNumberRange,
} from '../../domain/rng/identification/skillIdentificationTypes'

const NORMAL_RESULT_SLOT_COUNT = 5
/**
 * Module-local copy of `REFERENCE_RNG_BLOCK_SIZE` for the hot loops. Under the
 * vitest module runner an imported binding is read through a namespace getter
 * on every access, which made the walk about four times slower in measurement;
 * a bundled Browser Worker has no such indirection.
 */
const BLOCK_SIZE: number = REFERENCE_RNG_BLOCK_SIZE
const DEFAULT_SEED_CHUNK_SIZE = 1_000

/**
 * Research-only upper bound of the starting Normal Counter. Issue #74 proposes
 * 0..500 as the default; the bound keeps a research run from silently becoming
 * a multi-hour job and is not a proposed Production limit.
 */
export const RESEARCH_MAX_NORMAL_COUNTER = 100_000

export interface NormalSeedIdentificationResearchInput {
  readonly weaponTypeId: WeaponTypeId
  readonly rarity: NormalArtianRarity
  /** Ordered consecutive forges of this weapon type; observation `i` sits at `C + i`. */
  readonly observations: readonly NormalArtianCounterObservation[]
  readonly seedRange: InclusiveNumberRange
  readonly normalCounterRange: InclusiveNumberRange
  readonly maxMatches?: number
}

export interface NormalSeedIdentificationResearchMatch {
  readonly baseSeed: number
  readonly startNormalCounter: number
}

export interface NormalSeedIdentificationResearchResult {
  /** Ordered by Base Seed, then starting Normal Counter. */
  readonly matches: readonly NormalSeedIdentificationResearchMatch[]
  /** The completed Seed prefix: every Counter of every Seed in it was evaluated. */
  readonly searchedSeedRange: InclusiveNumberRange
  readonly isTruncated: boolean
}

export type NormalSeedIdentificationResearchClassification =
  | 'unique'
  | 'multiple'
  | 'zero'
  | 'incomplete'

export interface NormalSeedIdentificationResearchProgress {
  readonly searchedSeeds: number
  readonly totalSeeds: number
  readonly matchesFound: number
}

/** Cheap counters for the measurement; they never change a result. */
export interface NormalSeedIdentificationResearchStatistics {
  seedsEvaluated: number
  countersEvaluated: number
  /** (Seed, Counter) pairs whose observation 1 matched all five slots and needed observations 2..n. */
  firstObservationPasses: number
}

export interface NormalSeedIdentificationResearchExecutionOptions {
  readonly shouldCancel?: () => boolean
  readonly yieldControl?: () => Promise<void>
  readonly onProgress?: (progress: NormalSeedIdentificationResearchProgress) => void
  readonly seedChunkSize?: number
  /**
   * `true` (default) stops evaluating the slots of observation 1 at its first
   * failing slot. `false` evaluates all five slots at every Counter before
   * rejecting, which isolates the early-rejection effect. The PRNG steps taken
   * are the same either way, and so are the matches.
   */
  readonly earlyRejection?: boolean
  readonly statistics?: NormalSeedIdentificationResearchStatistics
}

export class NormalSeedIdentificationResearchError extends Error {
  readonly code: 'invalid_input' | 'unsupported_input' | 'cancelled'

  constructor(code: 'invalid_input' | 'unsupported_input' | 'cancelled', message: string) {
    super(message)
    this.name = 'NormalSeedIdentificationResearchError'
    this.code = code
  }
}

/** One observation compiled into five exact `raw % modulus === index` slot constraints. */
export interface CompiledNormalObservationConstraint {
  readonly moduli: readonly number[]
  readonly indices: readonly number[]
}

function requireSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new NormalSeedIdentificationResearchError('invalid_input', `${label} must be a safe integer.`)
  }
}

function validateRange(range: InclusiveNumberRange, label: string, minimum: number, maximum: number): void {
  requireSafeInteger(range.startInclusive, `${label} start`)
  requireSafeInteger(range.endInclusive, `${label} end`)
  if (range.startInclusive < minimum || range.endInclusive > maximum || range.endInclusive < range.startInclusive) {
    throw new NormalSeedIdentificationResearchError(
      'invalid_input',
      `${label} must be an inclusive ascending range from ${minimum} to ${maximum}.`,
    )
  }
}

/**
 * Compiles one ordered observation against its table-class pool. An
 * observation the pool can never draw (a slot outside the pool, or a candidate
 * beyond its `maximumOccurrences`) has no derivable pool index at that slot and
 * is refused as malformed input, exactly the two conditions the Production
 * kernel's `requireProducibleByPool()` refuses.
 */
export function compileNormalObservationConstraint(
  referenceIds: readonly ReferenceNormalLotteryId[],
  candidates: readonly ReferenceNormalCandidate[],
): CompiledNormalObservationConstraint {
  if (referenceIds.length !== NORMAL_RESULT_SLOT_COUNT) {
    throw new NormalSeedIdentificationResearchError('invalid_input', 'An observation must have five slots.')
  }
  const pool = candidates.map((candidate) => ({ ...candidate, count: 0 }))
  const moduli: number[] = []
  const indices: number[] = []
  for (let slot = 0; slot < NORMAL_RESULT_SLOT_COUNT; slot += 1) {
    const index = pool.findIndex((entry) => entry.referenceId === referenceIds[slot])
    if (index < 0) {
      throw new NormalSeedIdentificationResearchError(
        'invalid_input',
        `Slot ${slot + 1} cannot be produced by this Normal Artian pool.`,
      )
    }
    moduli.push(pool.length)
    indices.push(index)
    const entry = pool[index]!
    entry.count += 1
    if (entry.count >= entry.maximumOccurrences) pool.splice(index, 1)
  }
  return { moduli, indices }
}

/**
 * The probability that one uniformly random block draws exactly this
 * observation: the product of `1 / modulus` over its five slots. It models the
 * raw words as uniform, which is an analysis assumption, not a game rule.
 */
export function compiledObservationProbability(constraint: CompiledNormalObservationConstraint): number {
  return constraint.moduli.reduce((probability, modulus) => probability / modulus, 1)
}

function validateInput(input: NormalSeedIdentificationResearchInput, engine: RngEngine): void {
  if (input.rarity !== V1_NORMAL_ARTIAN_RARITY) {
    throw new NormalSeedIdentificationResearchError('invalid_input', 'Only rarity 8 is supported.')
  }
  validateRange(input.seedRange, 'Base Seed range', CANONICAL_BASE_SEED_MIN, CANONICAL_BASE_SEED_MAX)
  validateRange(input.normalCounterRange, 'Normal Counter range', 0, RESEARCH_MAX_NORMAL_COUNTER)
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new NormalSeedIdentificationResearchError('invalid_input', 'At least one observation is required.')
  }
  for (const observation of input.observations) {
    if (!isNormalArtianLotteryTableClass(observation.tableClass)) {
      throw new NormalSeedIdentificationResearchError('invalid_input', 'Unknown lottery table class.')
    }
    if (!Array.isArray(observation.bonuses) || observation.bonuses.length !== NORMAL_RESULT_SLOT_COUNT) {
      throw new NormalSeedIdentificationResearchError('invalid_input', 'An observation must have five slots.')
    }
  }
  if (input.maxMatches !== undefined) {
    requireSafeInteger(input.maxMatches, 'maxMatches')
    if (input.maxMatches < 1) {
      throw new NormalSeedIdentificationResearchError('invalid_input', 'maxMatches must be at least 1.')
    }
  }
  const support = getNormalArtianCounterIdentificationSupport(input.weaponTypeId, input.rarity, engine)
  if (!support.supported) {
    throw new NormalSeedIdentificationResearchError('unsupported_input', `Unsupported input: ${support.reason}.`)
  }
}

/** Compiles every observation of the input in order. */
export function compileNormalSeedResearchObservations(
  weaponTypeId: WeaponTypeId,
  observations: readonly NormalArtianCounterObservation[],
): readonly CompiledNormalObservationConstraint[] {
  return observations.map((observation) => {
    let referenceIds: ReferenceNormalLotteryId[]
    try {
      referenceIds = observation.bonuses.map((bonus) => referenceNormalIdFromRestorationBonus(weaponTypeId, bonus))
    } catch (error) {
      if (error instanceof RangeError) {
        throw new NormalSeedIdentificationResearchError('invalid_input', error.message)
      }
      throw error
    }
    return compileNormalObservationConstraint(
      referenceIds,
      gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, observation.tableClass),
    )
  })
}

/**
 * The Production one-step transition (`nextReferencePrngState()`) on
 * unboxed words. The research test checks it against the Production function;
 * Method B inlines this exact formula to avoid one object per step.
 */
export function researchPrngStep(state: ReferencePrngState): ReferencePrngState {
  const t = state.x ^ (state.x << 15)
  return { x: state.y, y: state.z, z: state.w, w: (state.w ^ (state.w >>> 21) ^ t ^ (t >>> 4)) >>> 0 }
}

/** Initial words and mixing constant of `initializeReferencePrng()` (pinned GARP.lua v0.9.4). */
const INITIAL_X = 0x159a55e5
const INITIAL_Y = 0x1f123bb5
const INITIAL_Z = 0x05491333
const INITIAL_W = 0x05491333
const MIX_CONSTANT = 0x65ac9365

/**
 * `initializeReferencePrng()` on int32 locals, written into `out` as int32 bit
 * patterns. The research test checks it against the Production function.
 */
export function researchInitializePrng(seed: number, out: Int32Array): void {
  let seedState = seed | 0
  let x = INITIAL_X
  let y = INITIAL_Y
  let z = INITIAL_Z
  let w = INITIAL_W
  for (let iteration = 1; iteration <= 100; iteration += 1) {
    const mixed = (MIX_CONSTANT >>> (seedState & 3)) ^ seedState
    seedState = (mixed << 4) ^ (mixed << 3) ^ (mixed >>> 3) ^ (mixed >>> 4) ^ mixed
    const t = seedState ^ (seedState << 15)
    w = z ^ (z >>> 21) ^ t ^ (t >>> 4)
    if (iteration < 100) {
      x = y
      y = z
      z = w
    }
  }
  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = w
}

/**
 * The additive term of `deriveNormalArtianSeed()` for one weapon type and
 * rarity: `derive(B) = (B + term) ^ salt`. It is read from the Production
 * function itself (`derive(0) ^ salt`), never re-encoded.
 */
export function normalSeedDerivationTerm(weaponTypeId: WeaponTypeId, rarity: NormalArtianRarity): number {
  return (deriveNormalArtianSeed(0, weaponTypeId, rarity) ^ REFERENCE_RNG_SEED_SALT) >>> 0
}

/**
 * Checks observations `firstObservation..observationCount - 1` from the
 * block-start state of observation `firstObservation` (int32 words), stepping
 * a private copy. Observation `i` is the block ten steps after observation `i - 1`.
 */
function matchesObservationsFrom(
  startX: number,
  startY: number,
  startZ: number,
  startW: number,
  moduli: Int32Array,
  indices: Int32Array,
  firstObservation: number,
  observationCount: number,
): boolean {
  let x = startX
  let y = startY
  let z = startZ
  let w = startW
  for (let observation = firstObservation; observation < observationCount; observation += 1) {
    for (let step = 0; step < BLOCK_SIZE; step += 1) {
      const t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      if (step < NORMAL_RESULT_SLOT_COUNT) {
        const constraint = observation * NORMAL_RESULT_SLOT_COUNT + step
        if ((w >>> 0) % (moduli[constraint]! >>> 0) !== indices[constraint]! >>> 0) return false
      }
    }
  }
  return true
}

/**
 * Walks every starting Counter of one Seed from its positioned state (int32
 * words in `state`), appending each matching Counter to `matchedCounters`.
 *
 * Observation 1 is judged on the walk's own ten steps per block, so no block is
 * stepped twice; only a Counter whose observation 1 passes all five slots
 * (rare) steps a private copy through observations 2..n, starting from the
 * next block the walk has just reached. Returns how many Counters passed
 * observation 1.
 */
function walkSeedCounters(
  state: Int32Array,
  counterStart: number,
  counterEnd: number,
  moduli: Int32Array,
  indices: Int32Array,
  observationCount: number,
  earlyRejection: boolean,
  matchedCounters: number[],
): number {
  const m0 = moduli[0]! >>> 0
  const m1 = moduli[1]! >>> 0
  const m2 = moduli[2]! >>> 0
  const m3 = moduli[3]! >>> 0
  const m4 = moduli[4]! >>> 0
  const i0 = indices[0]! >>> 0
  const i1 = indices[1]! >>> 0
  const i2 = indices[2]! >>> 0
  const i3 = indices[3]! >>> 0
  const i4 = indices[4]! >>> 0
  let x = state[0]! | 0
  let y = state[1]! | 0
  let z = state[2]! | 0
  let w = state[3]! | 0
  let firstObservationPasses = 0
  for (let counter = counterStart; counter <= counterEnd; counter += 1) {
    let pass: boolean
    let t = x ^ (x << 15)
    x = y
    y = z
    z = w
    w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
    const r0 = (w >>> 0) % m0 === i0
    t = x ^ (x << 15)
    x = y
    y = z
    z = w
    w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
    if (earlyRejection) {
      // Stop evaluating slots after the first failure; the remaining steps of
      // the block are still taken because the next Counter starts after them.
      pass = r0 && (w >>> 0) % m1 === i1
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      pass = pass && (w >>> 0) % m2 === i2
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      pass = pass && (w >>> 0) % m3 === i3
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      pass = pass && (w >>> 0) % m4 === i4
    } else {
      // Evaluate all five slots before deciding.
      let failures = r0 ? 0 : 1
      if ((w >>> 0) % m1 !== i1) failures += 1
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      if ((w >>> 0) % m2 !== i2) failures += 1
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      if ((w >>> 0) % m3 !== i3) failures += 1
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
      if ((w >>> 0) % m4 !== i4) failures += 1
      pass = failures === 0
    }
    for (let step = NORMAL_RESULT_SLOT_COUNT; step < BLOCK_SIZE; step += 1) {
      t = x ^ (x << 15)
      x = y
      y = z
      z = w
      w = w ^ (w >>> 21) ^ t ^ (t >>> 4)
    }
    if (pass) {
      firstObservationPasses += 1
      // (x, y, z, w) is now the block-start state of Counter + 1, i.e. observation 2.
      if (matchesObservationsFrom(x, y, z, w, moduli, indices, 1, observationCount)) matchedCounters.push(counter)
    }
  }
  return firstObservationPasses
}

interface SeedChunkContext {
  readonly derivationTerm: number
  readonly startJump: ReferencePrngJump | null
  readonly counterStart: number
  readonly counterEnd: number
  readonly moduli: Int32Array
  readonly indices: Int32Array
  readonly observationCount: number
  readonly earlyRejection: boolean
  readonly maxMatches: number | undefined
  readonly initialState: Int32Array
  readonly matchedCounters: number[]
}

/**
 * Searches one contiguous Seed chunk synchronously, appending matches in Seed
 * then Counter order. The async driver only yields between chunks, the way a
 * Worker would report progress and observe cancellation.
 */
function searchSeedChunk(
  context: SeedChunkContext,
  chunkStart: number,
  chunkEnd: number,
  matches: NormalSeedIdentificationResearchMatch[],
): { completedSeed: number; firstObservationPasses: number; stoppedByMaxMatches: boolean } {
  const state = context.initialState
  const matchedCounters = context.matchedCounters
  let firstObservationPasses = 0
  for (let baseSeed = chunkStart; baseSeed <= chunkEnd; baseSeed += 1) {
    researchInitializePrng((baseSeed + context.derivationTerm) ^ REFERENCE_RNG_SEED_SALT, state)
    if (context.startJump !== null) {
      const positioned = applyReferencePrngJump(context.startJump, {
        x: state[0]! >>> 0,
        y: state[1]! >>> 0,
        z: state[2]! >>> 0,
        w: state[3]! >>> 0,
      })
      state[0] = positioned.x
      state[1] = positioned.y
      state[2] = positioned.z
      state[3] = positioned.w
    }
    firstObservationPasses += walkSeedCounters(
      state,
      context.counterStart,
      context.counterEnd,
      context.moduli,
      context.indices,
      context.observationCount,
      context.earlyRejection,
      matchedCounters,
    )
    for (let index = 0; index < matchedCounters.length; index += 1) {
      matches.push({ baseSeed, startNormalCounter: matchedCounters[index]! })
    }
    matchedCounters.length = 0
    if (context.maxMatches !== undefined && matches.length >= context.maxMatches) {
      return { completedSeed: baseSeed, firstObservationPasses, stoppedByMaxMatches: true }
    }
  }
  return { completedSeed: chunkEnd, firstObservationPasses, stoppedByMaxMatches: false }
}

export function classifyNormalSeedResearchResult(
  result: NormalSeedIdentificationResearchResult,
): NormalSeedIdentificationResearchClassification {
  if (result.isTruncated) return 'incomplete'
  if (result.matches.length === 0) return 'zero'
  return result.matches.length === 1 ? 'unique' : 'multiple'
}

/**
 * Method B: complete search over every (Seed, Counter) of the requested ranges
 * with compiled slot constraints and a non-allocating Production PRNG walk.
 */
export async function identifyNormalSeedAndCounterCompiled(
  input: NormalSeedIdentificationResearchInput,
  engine: RngEngine,
  options: NormalSeedIdentificationResearchExecutionOptions = {},
): Promise<NormalSeedIdentificationResearchResult> {
  validateInput(input, engine)
  const compiled = compileNormalSeedResearchObservations(input.weaponTypeId, input.observations)
  const observationCount = compiled.length
  const moduli = Int32Array.from(compiled.flatMap((constraint) => constraint.moduli))
  const indices = Int32Array.from(compiled.flatMap((constraint) => constraint.indices))
  const earlyRejection = options.earlyRejection ?? true
  const statistics = options.statistics
  const shouldCancel = options.shouldCancel ?? (() => false)
  const yieldControl = options.yieldControl ?? (() => Promise.resolve())
  const chunkSize = options.seedChunkSize ?? DEFAULT_SEED_CHUNK_SIZE
  requireSafeInteger(chunkSize, 'Seed chunk size')
  if (chunkSize < 1) {
    throw new NormalSeedIdentificationResearchError('invalid_input', 'Seed chunk size must be at least 1.')
  }

  const context: SeedChunkContext = {
    derivationTerm: normalSeedDerivationTerm(input.weaponTypeId, input.rarity),
    startJump: input.normalCounterRange.startInclusive === 0
      ? null
      : compileReferencePrngJump(input.normalCounterRange.startInclusive * BLOCK_SIZE),
    counterStart: input.normalCounterRange.startInclusive,
    counterEnd: input.normalCounterRange.endInclusive,
    moduli,
    indices,
    observationCount,
    earlyRejection,
    maxMatches: input.maxMatches,
    initialState: new Int32Array(4),
    matchedCounters: [],
  }
  const seedStart = input.seedRange.startInclusive
  const seedEnd = input.seedRange.endInclusive
  const totalSeeds = seedEnd - seedStart + 1
  const matches: NormalSeedIdentificationResearchMatch[] = []
  let completedSeed = seedStart - 1
  let stoppedByLimit = false

  for (let chunkStart = seedStart; chunkStart <= seedEnd; chunkStart += chunkSize) {
    if (shouldCancel()) {
      throw new NormalSeedIdentificationResearchError('cancelled', 'Research search was cancelled.')
    }
    const chunkEnd = Math.min(seedEnd, chunkStart + chunkSize - 1)
    const chunk = searchSeedChunk(context, chunkStart, chunkEnd, matches)
    completedSeed = chunk.completedSeed
    stoppedByLimit = chunk.stoppedByMaxMatches && completedSeed < seedEnd
    if (statistics !== undefined) {
      const seedsInChunk = completedSeed - chunkStart + 1
      statistics.seedsEvaluated += seedsInChunk
      statistics.countersEvaluated += seedsInChunk * (context.counterEnd - context.counterStart + 1)
      statistics.firstObservationPasses += chunk.firstObservationPasses
    }
    options.onProgress?.({ searchedSeeds: completedSeed - seedStart + 1, totalSeeds, matchesFound: matches.length })
    if (chunk.stoppedByMaxMatches) break
    await yieldControl()
  }

  if (shouldCancel()) {
    throw new NormalSeedIdentificationResearchError('cancelled', 'Research search was cancelled.')
  }
  return {
    matches,
    searchedSeedRange: { startInclusive: seedStart, endInclusive: completedSeed },
    isTruncated: stoppedByLimit,
  }
}

/**
 * Method A: the unchanged Production Normal Counter kernel, called once per
 * Base Seed candidate. It is the correctness baseline of Method B and the
 * "direct extension" whose cost Phase 1 measures; it repeats the kernel's
 * validation, observation compilation and Counter-start jump per Seed.
 */
export async function identifyNormalSeedAndCounterWithCounterKernel(
  input: NormalSeedIdentificationResearchInput,
  engine: RngEngine,
): Promise<NormalSeedIdentificationResearchResult> {
  validateInput(input, engine)
  const matches: NormalSeedIdentificationResearchMatch[] = []
  for (let baseSeed = input.seedRange.startInclusive; baseSeed <= input.seedRange.endInclusive; baseSeed += 1) {
    const result = await identifyNormalArtianCounter(
      {
        baseSeed: String(baseSeed),
        weaponTypeId: input.weaponTypeId,
        rarity: input.rarity,
        observations: input.observations,
        normalCounterRange: input.normalCounterRange,
      },
      engine,
    )
    for (const match of result.matches) {
      matches.push({ baseSeed, startNormalCounter: match.startNormalCounter })
    }
    if (input.maxMatches !== undefined && matches.length >= input.maxMatches) {
      return {
        matches,
        searchedSeedRange: { startInclusive: input.seedRange.startInclusive, endInclusive: baseSeed },
        isTruncated: baseSeed < input.seedRange.endInclusive,
      }
    }
  }
  return {
    matches,
    searchedSeedRange: { ...input.seedRange },
    isTruncated: false,
  }
}
