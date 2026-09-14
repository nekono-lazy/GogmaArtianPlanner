import type {
  NormalArtianRarity,
  RestorationBonusSet,
  WeaponTypeId,
} from '../../models/publicTypes'
import type { NormalizedSeed, RngPredictionUnsupportedReason } from '../rngEngine'
import { REFERENCE_RNG_BLOCK_SIZE } from '../production/referencePrng'
import type { InclusiveNumberRange } from './skillIdentificationTypes'

/**
 * The largest starting Normal Counter one identification may evaluate.
 *
 * A Normal Counter addresses one ten-step reference PRNG block, and
 * `readReferenceRngBlock()` refuses a block index above this same bound so
 * that `blockIndex * REFERENCE_RNG_BLOCK_SIZE` stays a safe integer. The
 * identification walk positions the PRNG the same way, so it inherits the
 * bound instead of inventing one. Persisted `NormalArtianCounter` domain
 * validation is a separate contract and is not widened or narrowed here.
 */
export const MAX_NORMAL_ARTIAN_IDENTIFICATION_COUNTER = Math.floor(
  Number.MAX_SAFE_INTEGER / REFERENCE_RNG_BLOCK_SIZE,
)

/**
 * The only element distinction the Normal Artian lottery makes.
 *
 * The Normal seed is Base Seed + weapon type + rarity; the element never
 * enters it. The element decides only which candidate pool is drawn from, and
 * that pool is the same for Fire, Water, Thunder, Ice, Dragon, Poison,
 * Paralysis, Sleep, and Blast (`docs/RNG_SPEC.md` 9.12). Counter
 * identification therefore never asks for an exact `ElementId`; it asks only
 * whether the forged weapon had an attribute at all.
 */
export type NormalArtianAttributeClass = 'none' | 'attribute_present'

export const NORMAL_ARTIAN_ATTRIBUTE_CLASSES: readonly NormalArtianAttributeClass[] = [
  'none',
  'attribute_present',
]

/** One forged rarity-8 Normal Artian weapon: its attribute class and five ordered slots. */
export interface NormalArtianCounterObservation {
  readonly attributeClass: NormalArtianAttributeClass
  readonly bonuses: RestorationBonusSet
}

export interface NormalArtianCounterIdentificationInput {
  readonly baseSeed: NormalizedSeed
  readonly weaponTypeId: WeaponTypeId
  readonly rarity: NormalArtianRarity
  /** Ordered consecutive forges of this weapon type; observation `i` sits at `C + i`. */
  readonly observations: readonly NormalArtianCounterObservation[]
  readonly normalCounterRange: InclusiveNumberRange
  readonly maxMatches?: number
}

export interface NormalArtianCounterIdentificationMatch {
  readonly startNormalCounter: number
}

export interface NormalArtianCounterIdentificationResult {
  readonly matches: readonly NormalArtianCounterIdentificationMatch[]
  /** The completed starting-Counter prefix; `endInclusive` is the last Counter actually evaluated. */
  readonly searchedCounterRange: InclusiveNumberRange
  readonly isTruncated: boolean
}

export interface NormalArtianCounterIdentificationProgress {
  /** Starting Counter candidates fully accepted or rejected, not prediction calls. */
  readonly searchedCounters: number
  readonly totalCounters: number
  readonly matchesFound: number
}

export interface NormalArtianCounterIdentificationExecutionOptions {
  readonly shouldCancel?: () => boolean
  readonly yieldControl?: () => Promise<void>
  readonly onProgress?: (progress: NormalArtianCounterIdentificationProgress) => void
  /** Runtime tuning only; this is not a persisted Production contract. */
  readonly counterChunkSize?: number
}

export type NormalArtianCounterIdentificationErrorCode =
  | 'invalid_input'
  | 'unsupported_input'
  | 'cancelled'

export class NormalArtianCounterIdentificationError extends Error {
  readonly code: NormalArtianCounterIdentificationErrorCode
  readonly unsupportedReason: RngPredictionUnsupportedReason | null

  constructor(
    code: NormalArtianCounterIdentificationErrorCode,
    message: string,
    unsupportedReason: RngPredictionUnsupportedReason | null = null,
  ) {
    super(message)
    this.name = 'NormalArtianCounterIdentificationError'
    this.code = code
    this.unsupportedReason = unsupportedReason
  }
}

export type NormalArtianCounterIdentificationWorkerRequest =
  | {
      readonly type: 'identify_normal_artian_counter'
      readonly requestId: string
      readonly input: NormalArtianCounterIdentificationInput
    }
  | { readonly type: 'cancel'; readonly requestId: string }

export type NormalArtianCounterIdentificationWorkerResponse =
  | {
      readonly type: 'normal_artian_counter_identification_result'
      readonly requestId: string
      readonly result: NormalArtianCounterIdentificationResult
    }
  | {
      readonly type: 'progress'
      readonly requestId: string
      readonly progress: NormalArtianCounterIdentificationProgress
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly message: string
      readonly code: NormalArtianCounterIdentificationErrorCode | 'unexpected_error'
      readonly unsupportedReason: RngPredictionUnsupportedReason | null
    }
