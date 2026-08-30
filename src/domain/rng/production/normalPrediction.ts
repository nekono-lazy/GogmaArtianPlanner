import type { ElementId, NormalArtianRarity, WeaponTypeId } from '../../models/publicTypes'
import { toReferenceNormalFinalAttribute } from './referenceAdapters'
import {
  mapReferenceNormalResult,
  REFERENCE_NORMAL_ELEMENTAL_CANDIDATES,
  REFERENCE_NORMAL_NONE_CANDIDATES,
  type ReferenceNormalCandidate,
  type ReferenceNormalLotteryId,
  type ReferenceNormalSemanticMappingResult,
} from './referenceNormalBonuses'
import { readReferenceRngBlock } from './referencePrng'
import { deriveNormalArtianSeed } from './seedDerivation'

export interface ReferenceNormalPredictionInput {
  readonly baseSeed: number
  readonly weaponTypeId: WeaponTypeId
  readonly elementId: ElementId
  readonly rarity: NormalArtianRarity
  readonly normalCounter: number
}

export interface ReferenceNormalRawPredictionResult {
  /** Ordered IDs from the reference Normal lottery namespace, never Domain IDs. */
  readonly referenceIds: readonly [
    ReferenceNormalLotteryId,
    ReferenceNormalLotteryId,
    ReferenceNormalLotteryId,
    ReferenceNormalLotteryId,
    ReferenceNormalLotteryId,
  ]
  /** Normal Counter is directly the zero-based, ungated reference block index. */
  readonly blockIndex: number
}

export interface ReferenceNormalPredictionResult extends ReferenceNormalRawPredictionResult {
  readonly semanticResult: ReferenceNormalSemanticMappingResult
}

interface MutableReferenceNormalCandidate {
  readonly referenceId: ReferenceNormalLotteryId
  readonly maximumOccurrences: 2 | 5
  count: number
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`)
  }
}

/** Exposes the exact reference pool selected by the final semantic element. */
export function referenceNormalCandidatesForElement(
  elementId: ElementId,
): readonly ReferenceNormalCandidate[] {
  return toReferenceNormalFinalAttribute(elementId) === 1
    ? REFERENCE_NORMAL_NONE_CANDIDATES
    : REFERENCE_NORMAL_ELEMENTAL_CANDIDATES
}

function mutablePool(candidates: readonly ReferenceNormalCandidate[]): MutableReferenceNormalCandidate[] {
  return candidates.map((candidate) => ({ ...candidate, count: 0 }))
}

/**
 * Bit-for-bit reference Normal lottery prediction. It uses the first five
 * post-step words of exactly one ten-step, zero-based Normal block.
 */
export function predictReferenceNormalRaw(
  input: ReferenceNormalPredictionInput,
): ReferenceNormalRawPredictionResult {
  requireNonNegativeSafeInteger(input.normalCounter, 'Normal Artian counter')
  const pool = mutablePool(referenceNormalCandidatesForElement(input.elementId))
  const seed = deriveNormalArtianSeed(input.baseSeed, input.weaponTypeId, input.rarity)
  const rawValues = readReferenceRngBlock(seed, input.normalCounter).values
  const selected: ReferenceNormalLotteryId[] = []

  for (let slot = 0; slot < 5; slot += 1) {
    const rawValue = rawValues[slot]
    if (rawValue === undefined) {
      throw new Error(`Reference Normal block is missing raw value for slot ${slot + 1}`)
    }
    const poolIndex = rawValue % pool.length
    const candidate = pool[poolIndex]
    if (candidate === undefined) {
      throw new Error(`Reference Normal pool is empty at slot ${slot + 1}`)
    }
    selected.push(candidate.referenceId)
    candidate.count += 1
    if (candidate.count >= candidate.maximumOccurrences) pool.splice(poolIndex, 1)
  }

  return {
    referenceIds: [selected[0]!, selected[1]!, selected[2]!, selected[3]!, selected[4]!],
    blockIndex: input.normalCounter,
  }
}

/** Combines raw parity output with its deliberately safe Domain mapping. */
export function predictReferenceNormalArtian(
  input: ReferenceNormalPredictionInput,
): ReferenceNormalPredictionResult {
  const rawResult = predictReferenceNormalRaw(input)
  return {
    ...rawResult,
    semanticResult: mapReferenceNormalResult(input.weaponTypeId, rawResult.referenceIds),
  }
}
