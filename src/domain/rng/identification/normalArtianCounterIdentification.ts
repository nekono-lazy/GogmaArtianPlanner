import type { ElementId, RestorationBonusSet } from '../../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../../models/common'
import type { RngEngine, RngPredictionSupport } from '../rngEngine'
import { gameVerifiedNormalCandidatesForWeaponAndElement } from '../production/gameNormalBonuses'
import { selectReferenceNormalLotteryIdsFromRawValues } from '../production/normalPrediction'
import { toReferenceNormalFinalAttribute } from '../production/referenceAdapters'
import {
  referenceNormalIdFromRestorationBonus,
  type ReferenceNormalCandidate,
  type ReferenceNormalLotteryId,
} from '../production/referenceNormalBonuses'
import {
  initializeReferencePrng,
  nextReferencePrngState,
  REFERENCE_RNG_BLOCK_SIZE,
  type ReferencePrngState,
} from '../production/referencePrng'
import { deriveNormalArtianSeed } from '../production/seedDerivation'
import { applyReferencePrngJump, compileReferencePrngJump } from './referencePrngJump'
import {
  MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER,
  NORMAL_ARTIAN_ATTRIBUTE_CLASSES,
  NormalArtianCounterIdentificationError,
  type NormalArtianAttributeClass,
  type NormalArtianCounterIdentificationExecutionOptions,
  type NormalArtianCounterIdentificationInput,
  type NormalArtianCounterIdentificationResult,
  type NormalArtianCounterObservation,
} from './normalArtianCounterIdentificationTypes'

const NORMAL_RESULT_SLOT_COUNT = 5
const DEFAULT_COUNTER_CHUNK_SIZE = 1_000

/**
 * Internal pool-selection representatives for the Production adapter.
 *
 * `predictNormalArtian` and `getPredictionSupport` take an `ElementId`, while
 * the Normal lottery distinguishes only "no attribute" from "any attribute"
 * (`docs/RNG_SPEC.md` 9.12). `element.fire` here means "select the
 * attribute-present pool" and nothing else: it never claims the observed
 * weapon was Fire, and it must never be persisted, displayed, or written into
 * an observation or result.
 */
const REPRESENTATIVE_ELEMENT_BY_ATTRIBUTE_CLASS: Readonly<
  Record<NormalArtianAttributeClass, ElementId>
> = {
  none: 'element.none',
  attribute_present: 'element.fire',
}

/** The Production adapter's pool-selection representative; see the constant above. */
export function normalArtianAttributeClassRepresentativeElementId(
  attributeClass: NormalArtianAttributeClass,
): ElementId {
  return REPRESENTATIVE_ELEMENT_BY_ATTRIBUTE_CLASS[attributeClass]
}

/**
 * Classifies a concrete element the way the Normal lottery does: elementless
 * or attribute-present. Every non-none element of the reference final-attribute
 * adapter is one class. Unknown elements raise the adapter's `RangeError`.
 */
export function normalArtianAttributeClassFromElementId(
  elementId: ElementId,
): NormalArtianAttributeClass {
  return toReferenceNormalFinalAttribute(elementId) === 1 ? 'none' : 'attribute_present'
}

type ReferenceNormalIdTuple = ReturnType<typeof selectReferenceNormalLotteryIdsFromRawValues>

interface CompiledObservation {
  readonly candidates: readonly ReferenceNormalCandidate[]
  readonly referenceIds: ReferenceNormalIdTuple
}

function requireSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new NormalArtianCounterIdentificationError('invalid_input', `${label} must be a safe integer.`)
  }
}

function isAttributeClass(value: unknown): value is NormalArtianAttributeClass {
  return NORMAL_ARTIAN_ATTRIBUTE_CLASSES.includes(value as NormalArtianAttributeClass)
}

function isStructurallyValidBonusSet(bonuses: unknown): bonuses is RestorationBonusSet {
  return (
    Array.isArray(bonuses) &&
    bonuses.length === NORMAL_RESULT_SLOT_COUNT &&
    bonuses.every((bonus: unknown) =>
      typeof bonus === 'object' &&
      bonus !== null &&
      typeof (bonus as { bonusTypeId?: unknown }).bonusTypeId === 'string' &&
      typeof (bonus as { bonusRankId?: unknown }).bonusRankId === 'string')
  )
}

function validateObservation(observation: NormalArtianCounterObservation): void {
  if (typeof observation !== 'object' || observation === null) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'Every Normal Artian observation must be an object.',
    )
  }
  if (!isAttributeClass(observation.attributeClass)) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'Every Normal Artian observation must declare attributeClass "none" or "attribute_present".',
    )
  }
  if (!isStructurallyValidBonusSet(observation.bonuses)) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'Every Normal Artian observation must contain exactly five ordered restoration bonus slots.',
    )
  }
}

function validateInput(input: NormalArtianCounterIdentificationInput, engine: RngEngine): number {
  let normalizedSeed: string
  try {
    normalizedSeed = engine.normalizeSeed(input.baseSeed)
  } catch (error) {
    if (error instanceof RangeError) {
      throw new NormalArtianCounterIdentificationError('invalid_input', error.message)
    }
    throw error
  }
  if (normalizedSeed !== input.baseSeed) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'Base Seed must already use the canonical Production decimal form.',
    )
  }

  if (input.rarity !== V1_NORMAL_ARTIAN_RARITY) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      `Normal Artian Counter identification supports rarity ${V1_NORMAL_ARTIAN_RARITY} only.`,
    )
  }

  const range = input.normalCounterRange
  requireSafeInteger(range.startInclusive, 'Normal Counter range start')
  requireSafeInteger(range.endInclusive, 'Normal Counter range end')
  if (
    range.startInclusive < 0 ||
    range.endInclusive < range.startInclusive ||
    range.endInclusive > MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER
  ) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      `Normal Counter range must be inclusive and ascending from 0 to ${MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER}.`,
    )
  }
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'At least one ordered five-slot Normal Artian observation is required.',
    )
  }
  if (
    input.observations.length - 1 >
    MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER - range.endInclusive
  ) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'The final consecutive observation exceeds the supported Normal Counter range.',
    )
  }
  input.observations.forEach(validateObservation)
  if (input.maxMatches !== undefined) {
    requireSafeInteger(input.maxMatches, 'maxMatches')
    if (input.maxMatches < 1) {
      throw new NormalArtianCounterIdentificationError('invalid_input', 'maxMatches must be at least 1.')
    }
  }
  return Number(normalizedSeed)
}

function distinctAttributeClasses(
  observations: readonly NormalArtianCounterObservation[],
): readonly NormalArtianAttributeClass[] {
  return NORMAL_ARTIAN_ATTRIBUTE_CLASSES.filter((attributeClass) =>
    observations.some((observation) => observation.attributeClass === attributeClass))
}

function normalPredictionSupport(
  input: NormalArtianCounterIdentificationInput,
  attributeClass: NormalArtianAttributeClass,
  engine: RngEngine,
): RngPredictionSupport {
  try {
    return engine.getPredictionSupport({
      type: 'normal_artian',
      weaponTypeId: input.weaponTypeId,
      elementId: normalArtianAttributeClassRepresentativeElementId(attributeClass),
      rarity: input.rarity,
    })
  } catch (error) {
    // A weapon type the reference adapter does not know raises the adapter's
    // RangeError from the support query itself; it is a known unsupported
    // input, not a kernel failure. Anything else stays fatal.
    if (error instanceof RangeError) {
      return { supported: false, reason: 'reference_adapter_unsupported' }
    }
    throw error
  }
}

/**
 * Fails closed on every attribute class the observations use. The Production
 * Engine answers `normal_pool_unverified` for a weapon type with no
 * game-verified Normal pool; that reason is forwarded as structured data and
 * never replaced by a reference-pool fallback.
 */
function requirePredictionSupport(
  input: NormalArtianCounterIdentificationInput,
  attributeClasses: readonly NormalArtianAttributeClass[],
  engine: RngEngine,
): void {
  if (!engine.capabilities.supportsNormalArtianPrediction) {
    throw new NormalArtianCounterIdentificationError(
      'unsupported_input',
      'The active RNG Engine does not support Normal Artian prediction.',
      'engine_capability_unavailable',
    )
  }
  for (const attributeClass of attributeClasses) {
    const support = normalPredictionSupport(input, attributeClass, engine)
    if (!support.supported) {
      throw new NormalArtianCounterIdentificationError(
        'unsupported_input',
        `Normal Artian Counter identification input is unsupported: ${support.reason}.`,
        support.reason,
      )
    }
  }
}

function compileObservations(
  input: NormalArtianCounterIdentificationInput,
  attributeClasses: readonly NormalArtianAttributeClass[],
): readonly CompiledObservation[] {
  const candidatesByClass = new Map<NormalArtianAttributeClass, readonly ReferenceNormalCandidate[]>(
    attributeClasses.map((attributeClass) => [
      attributeClass,
      gameVerifiedNormalCandidatesForWeaponAndElement(
        input.weaponTypeId,
        normalArtianAttributeClassRepresentativeElementId(attributeClass),
      ),
    ]),
  )
  return input.observations.map((observation) => {
    const candidates = candidatesByClass.get(observation.attributeClass)
    if (candidates === undefined) {
      throw new Error(`Normal Artian pool is missing for ${observation.attributeClass}`)
    }
    let referenceIds: ReferenceNormalLotteryId[]
    try {
      referenceIds = observation.bonuses.map((bonus) =>
        referenceNormalIdFromRestorationBonus(input.weaponTypeId, bonus))
    } catch (error) {
      if (error instanceof RangeError) {
        throw new NormalArtianCounterIdentificationError('invalid_input', error.message)
      }
      throw error
    }
    return {
      candidates,
      referenceIds: [
        referenceIds[0]!, referenceIds[1]!, referenceIds[2]!, referenceIds[3]!, referenceIds[4]!,
      ],
    }
  })
}

function advance(state: ReferencePrngState, steps: number): ReferencePrngState {
  let current = state
  for (let step = 0; step < steps; step += 1) current = nextReferencePrngState(current)
  return current
}

/** The first five post-step words of the block that starts at `blockState`. */
function rawForgeValues(blockState: ReferencePrngState): readonly number[] {
  const values: number[] = []
  let state = blockState
  for (let slot = 0; slot < NORMAL_RESULT_SLOT_COUNT; slot += 1) {
    state = nextReferencePrngState(state)
    values.push(state.w)
  }
  return values
}

function referenceIdsEqual(left: ReferenceNormalIdTuple, right: ReferenceNormalIdTuple): boolean {
  for (let slot = 0; slot < NORMAL_RESULT_SLOT_COUNT; slot += 1) {
    if (left[slot] !== right[slot]) return false
  }
  return true
}

function matchesObservations(
  blockState: ReferencePrngState,
  observations: readonly CompiledObservation[],
): boolean {
  let observationState = blockState
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]!
    const prediction = selectReferenceNormalLotteryIdsFromRawValues(
      rawForgeValues(observationState),
      observation.candidates,
    )
    if (!referenceIdsEqual(prediction, observation.referenceIds)) return false
    if (index + 1 < observations.length) {
      observationState = advance(observationState, REFERENCE_RNG_BLOCK_SIZE)
    }
  }
  return true
}

/**
 * Identifies only the starting rarity-8 Normal Artian Counter of one weapon
 * type for an already-known canonical Base Seed (`docs/RNG_SPEC.md` 9.12).
 *
 * The walk positions the Production PRNG at the first candidate block once
 * and steps ten words per Counter afterwards, so the correctness authority
 * stays `ProductionRngEngine.predictNormalArtian()`: the same seed derivation,
 * block addressing, game-verified pool, and pool step are shared, and nothing
 * is re-derived.
 */
export async function identifyNormalArtianCounter(
  input: NormalArtianCounterIdentificationInput,
  engine: RngEngine,
  options: NormalArtianCounterIdentificationExecutionOptions = {},
): Promise<NormalArtianCounterIdentificationResult> {
  const baseSeed = validateInput(input, engine)
  const attributeClasses = distinctAttributeClasses(input.observations)
  requirePredictionSupport(input, attributeClasses, engine)
  const observations = compileObservations(input, attributeClasses)
  const chunkSize = options.counterChunkSize ?? DEFAULT_COUNTER_CHUNK_SIZE
  requireSafeInteger(chunkSize, 'Counter chunk size')
  if (chunkSize < 1) {
    throw new NormalArtianCounterIdentificationError(
      'invalid_input',
      'Counter chunk size must be at least 1.',
    )
  }
  const shouldCancel = options.shouldCancel ?? (() => false)
  const yieldControl = options.yieldControl ?? (() => Promise.resolve())
  const range = input.normalCounterRange
  const totalCounters = range.endInclusive - range.startInclusive + 1
  const initialized = initializeReferencePrng(
    deriveNormalArtianSeed(baseSeed, input.weaponTypeId, input.rarity),
  )
  let blockState = applyReferencePrngJump(
    compileReferencePrngJump(range.startInclusive * REFERENCE_RNG_BLOCK_SIZE),
    initialized,
  )
  const matches: { startNormalCounter: number }[] = []
  let searchedCounters = 0
  let completedCounter = range.startInclusive - 1
  let stoppedByLimit = false

  for (
    let chunkStart = range.startInclusive;
    chunkStart <= range.endInclusive;
    chunkStart += chunkSize
  ) {
    if (shouldCancel()) {
      throw new NormalArtianCounterIdentificationError(
        'cancelled',
        'Normal Artian Counter identification was cancelled.',
      )
    }
    const chunkEnd = Math.min(range.endInclusive, chunkStart + chunkSize - 1)
    for (let counter = chunkStart; counter <= chunkEnd; counter += 1) {
      if (matchesObservations(blockState, observations)) {
        matches.push({ startNormalCounter: counter })
      }
      searchedCounters += 1
      completedCounter = counter
      if (input.maxMatches !== undefined && matches.length >= input.maxMatches) {
        stoppedByLimit = counter < range.endInclusive
        break
      }
      if (counter < range.endInclusive) {
        blockState = advance(blockState, REFERENCE_RNG_BLOCK_SIZE)
      }
    }

    options.onProgress?.({ searchedCounters, totalCounters, matchesFound: matches.length })
    if (stoppedByLimit) break
    await yieldControl()
  }

  if (shouldCancel()) {
    throw new NormalArtianCounterIdentificationError(
      'cancelled',
      'Normal Artian Counter identification was cancelled.',
    )
  }
  return {
    matches,
    searchedCounterRange: {
      startInclusive: range.startInclusive,
      endInclusive: completedCounter,
    },
    isTruncated: stoppedByLimit,
  }
}
