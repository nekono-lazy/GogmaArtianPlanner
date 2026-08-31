import type { ElementId, RestorationBonusSet, WeaponTypeId } from '../../models/publicTypes'
import { gameAdjustedGogmaResetCandidatesForWeaponAndElement, type GameAdjustedGogmaMasterSubset } from './gameGogmaBonuses'
import { readReferenceRngBlock } from './referencePrng'
import {
  REFERENCE_GOGMA_RESET_CANDIDATES,
  referenceGogmaIdFromRestorationBonus,
  referenceGogmaKeepFamilyCandidates,
  restorationBonusSetFromReferenceGogmaIds,
} from './referenceGogmaBonuses'
import { deriveGogmaSeed } from './seedDerivation'
import {
  buildReferenceWeightedGogmaPool,
  drawReferenceWeightedGogmaBonus,
} from './weightedDraw'

/** The pinned reference's Gogma counter gate is 0x23 (35). */
export const REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD = 35

export interface ReferenceGogmaPredictionInput {
  readonly baseSeed: number
  readonly weaponTypeId: WeaponTypeId
  readonly elementId: ElementId
  readonly gogmaCounter: number
  readonly counterGate: number
}

export interface ReferenceGogmaKeepPredictionInput extends ReferenceGogmaPredictionInput {
  /** Ordered current Gogma-scope bonuses; each slot fixes its own family. */
  readonly currentBonuses: RestorationBonusSet
}

export interface ReferenceGogmaPredictionResult {
  readonly bonuses: RestorationBonusSet
  readonly effectiveBlock: number
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`)
  }
}

function referenceGogmaBlock(input: ReferenceGogmaPredictionInput): {
  effectiveBlock: number
  rawValues: readonly number[]
} {
  requireNonNegativeSafeInteger(input.gogmaCounter, 'Gogma counter')
  requireNonNegativeSafeInteger(input.counterGate, 'Counter gate')
  const effectiveBlock = input.counterGate < REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD
    ? 0
    : input.gogmaCounter
  const seed = deriveGogmaSeed(input.baseSeed, input.weaponTypeId, input.elementId)
  return { effectiveBlock, rawValues: readReferenceRngBlock(seed, effectiveBlock).values }
}

function predictReferenceGogmaSlots(
  rawValues: readonly number[],
  candidatesForSlot: (slot: number) => ReturnType<typeof referenceGogmaKeepFamilyCandidates>,
): RestorationBonusSet {
  const selectedReferenceIds: number[] = []
  for (let slot = 0; slot < 5; slot += 1) {
    const rawValue = rawValues[slot]
    if (rawValue === undefined) {
      throw new Error(`Reference Gogma block is missing raw value for slot ${slot + 1}`)
    }
    const pool = buildReferenceWeightedGogmaPool(candidatesForSlot(slot), selectedReferenceIds)
    selectedReferenceIds.push(drawReferenceWeightedGogmaBonus(rawValue, pool))
  }
  return restorationBonusSetFromReferenceGogmaIds(selectedReferenceIds)
}

/** Reset ignores the prior set and redraws all five slots from the fixed pool. */
export function predictReferenceGogmaReset(input: ReferenceGogmaPredictionInput): ReferenceGogmaPredictionResult {
  const { effectiveBlock, rawValues } = referenceGogmaBlock(input)
  return {
    bonuses: predictReferenceGogmaSlots(rawValues, () => REFERENCE_GOGMA_RESET_CANDIDATES),
    effectiveBlock,
  }
}

/**
 * Applies the game-verified pre-draw availability filtering behavior to the fixed reference
 * Reset table, using formal Gogma-scope Master availability without changing
 * seed derivation, block consumption, draw order, or repeat penalties.
 */
export function predictGameAdjustedGogmaReset(
  input: ReferenceGogmaPredictionInput,
  master: GameAdjustedGogmaMasterSubset,
): ReferenceGogmaPredictionResult {
  const { effectiveBlock, rawValues } = referenceGogmaBlock(input)
  const candidates = gameAdjustedGogmaResetCandidatesForWeaponAndElement(
    input.weaponTypeId,
    input.elementId,
    master,
  )
  return {
    bonuses: predictReferenceGogmaSlots(rawValues, () => candidates),
    effectiveBlock,
  }
}

/** Keep redraws every slot from the explicit current slot's reference family. */
export function predictReferenceGogmaKeep(input: ReferenceGogmaKeepPredictionInput): ReferenceGogmaPredictionResult {
  if (!Array.isArray(input.currentBonuses) || input.currentBonuses.length !== 5) {
    throw new RangeError('Keep current bonuses must contain exactly five slots')
  }
  const currentReferenceIds = input.currentBonuses.map(referenceGogmaIdFromRestorationBonus)
  const { effectiveBlock, rawValues } = referenceGogmaBlock(input)
  return {
    bonuses: predictReferenceGogmaSlots(
      rawValues,
      (slot) => referenceGogmaKeepFamilyCandidates(currentReferenceIds[slot]!),
    ),
    effectiveBlock,
  }
}
