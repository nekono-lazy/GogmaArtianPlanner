import type { RestorationBonusSet } from '../../models/publicTypes'
import { UnsupportedRngInputError } from '../rngEngine'
import {
  type GogmaOperation,
  type GogmaBonusPredictionInput,
  type NormalArtianOperation,
  type NormalArtianPredictionInput,
  type NormalizedSeed,
  type RngEngine,
  type RngEngineCapabilities,
  type RngPredictionSupport,
  type RngPredictionSupportInput,
  type SkillOperation,
  type SkillPredictionInput,
  type SkillPredictionResult,
} from '../rngEngine'
import { normalizeBaseSeed } from './baseSeed'
import {
  GameAdjustedGogmaResetAvailabilityError,
  GameAdjustedGogmaResetMasterDataError,
  gameAdjustedGogmaResetCandidatesForWeaponAndElement,
  gogmaScopeKeepCurrentBonusFamily,
} from './gameGogmaBonuses'
import {
  predictGameAdjustedGogmaReset,
  predictReferenceGogmaKeep,
  REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD,
} from './gogmaPrediction'
import { UnsupportedGameVerifiedNormalPredictionError, gameVerifiedNormalCandidatesForWeaponAndElement } from './gameNormalBonuses'
import { predictGameVerifiedNormalArtian } from './normalPrediction'
import { toReferenceAttributeForce, toReferenceWeaponType } from './referenceAdapters'
import {
  predictReferenceSkills,
  REFERENCE_SKILL_COUNTER_GATE_THRESHOLD,
} from './skillPrediction'

export const PRODUCTION_RNG_ENGINE_VERSION = 'production-rng:c5-e2'

const capabilities: RngEngineCapabilities = {
  supportsSeedSearch: false,
  supportsNormalArtianPrediction: true,
  supportsGogmaPrediction: true,
  supportsSkillPrediction: true,
  supportsKeepBonusesPrediction: true,
}

function normalizedBaseSeed(seed: NormalizedSeed): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(seed)) throw new RangeError('Normalized base seed must be a decimal unsigned integer')
  return normalizeBaseSeed(BigInt(seed))
}

function requireSupport(support: RngPredictionSupport, operation: RngPredictionSupportInput['type']): void {
  if (!support.supported) throw new UnsupportedRngInputError(operation, support.reason)
}

function validateCounter(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
}

function advanceOneCounter(current: number, label: string): number {
  validateCounter(current, label)
  const next = current + 1
  if (!Number.isSafeInteger(next)) throw new RangeError(`${label} exceeds the safe integer range`)
  return next
}

function hasResetMaster(master: GogmaBonusPredictionInput['master']): master is GogmaBonusPredictionInput['master'] & Required<Pick<GogmaBonusPredictionInput['master'], 'weaponTypes' | 'elements' | 'bonusTypes'>> {
  return Boolean(master.weaponTypes && master.elements && master.bonusTypes)
}

/** Production-only facade; it does not select the app's active Engine. */
export class ProductionRngEngine implements RngEngine {
  readonly version = PRODUCTION_RNG_ENGINE_VERSION
  readonly capabilities = { ...capabilities }

  normalizeSeed(input: string): NormalizedSeed {
    const trimmed = input.trim()
    if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) throw new RangeError('Base seed must be unsigned decimal or hexadecimal')
    return normalizeBaseSeed(BigInt(trimmed)).toString(10)
  }

  getPredictionSupport(input: RngPredictionSupportInput): RngPredictionSupport {
    switch (input.type) {
      case 'normal_artian':
        if (input.rarity !== 8) return { supported: false, reason: 'reference_adapter_unsupported' }
        try {
          gameVerifiedNormalCandidatesForWeaponAndElement(input.weaponTypeId, input.elementId)
          return { supported: true }
        } catch (error) {
          if (error instanceof UnsupportedGameVerifiedNormalPredictionError) return { supported: false, reason: 'normal_pool_unverified' }
          throw error
        }
      case 'skill':
        try {
          toReferenceWeaponType(input.weaponTypeId)
          toReferenceAttributeForce(input.elementId)
          return { supported: true }
        } catch (error) {
          if (error instanceof RangeError) return { supported: false, reason: 'reference_adapter_unsupported' }
          throw error
        }
      case 'gogma_reset':
        if (!hasResetMaster(input.master)) return { supported: false, reason: 'master_data_unavailable' }
        try {
          toReferenceWeaponType(input.weaponTypeId)
          toReferenceAttributeForce(input.elementId)
          gameAdjustedGogmaResetCandidatesForWeaponAndElement(input.weaponTypeId, input.elementId, input.master)
          return { supported: true }
        } catch (error) {
          if (error instanceof GameAdjustedGogmaResetAvailabilityError) return { supported: false, reason: 'no_available_reset_candidates' }
          if (error instanceof GameAdjustedGogmaResetMasterDataError) return { supported: false, reason: 'master_data_unavailable' }
          if (error instanceof RangeError) return { supported: false, reason: 'reference_adapter_unsupported' }
          throw error
        }
      case 'gogma_keep':
        try {
          toReferenceWeaponType(input.weaponTypeId)
          toReferenceAttributeForce(input.elementId)
        } catch (error) {
          if (error instanceof RangeError) return { supported: false, reason: 'reference_adapter_unsupported' }
          throw error
        }
        if (!Array.isArray(input.currentBonuses) || input.currentBonuses.length !== 5) return { supported: false, reason: 'unsupported_current_bonus' }
        // Keep needs the slot family only, so every legal `gogma_artian` tier
        // is readable, including the rank I values the reference lottery never
        // draws. Normal-tier current bonuses stay unsupported.
        if (input.currentBonuses.some((bonus) => gogmaScopeKeepCurrentBonusFamily(bonus) === null)) {
          return { supported: false, reason: 'unsupported_current_bonus' }
        }
        return { supported: true }
    }
  }

  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet {
    requireSupport(this.getPredictionSupport({ type: 'normal_artian', weaponTypeId: input.weaponTypeId, elementId: input.elementId, rarity: input.rarity }), 'normal_artian')
    return predictGameVerifiedNormalArtian({ ...input, baseSeed: normalizedBaseSeed(input.baseSeed) })
  }

  predictSkills(input: SkillPredictionInput): SkillPredictionResult {
    requireSupport(this.getPredictionSupport({ type: 'skill', weaponTypeId: input.weaponTypeId, elementId: input.elementId }), 'skill')
    const result = predictReferenceSkills({
      ...input,
      baseSeed: normalizedBaseSeed(input.baseSeed),
      counterGate: REFERENCE_SKILL_COUNTER_GATE_THRESHOLD,
    })
    return { seriesSkillId: result.seriesSkillId, groupSkillId: result.groupSkillId }
  }

  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet {
    const base = {
      baseSeed: normalizedBaseSeed(input.baseSeed),
      weaponTypeId: input.weaponTypeId,
      elementId: input.elementId,
      gogmaCounter: input.gogmaCounter,
      counterGate: REFERENCE_GOGMA_COUNTER_GATE_THRESHOLD,
    }
    if (input.operation.type === 'reset_bonuses') {
      requireSupport(this.getPredictionSupport({ type: 'gogma_reset', weaponTypeId: input.weaponTypeId, elementId: input.elementId, master: input.master }), 'gogma_reset')
      return predictGameAdjustedGogmaReset(base, input.master as Required<Pick<typeof input.master, 'weaponBonusDefinitions' | 'weaponTypes' | 'elements' | 'bonusTypes'>>).bonuses
    }
    requireSupport(this.getPredictionSupport({ type: 'gogma_keep', weaponTypeId: input.weaponTypeId, elementId: input.elementId, currentBonuses: input.operation.currentBonuses }), 'gogma_keep')
    return predictReferenceGogmaKeep({ ...base, currentBonuses: input.operation.currentBonuses }).bonuses
  }

  advanceGogmaCounter(current: number, operation: GogmaOperation): number { void operation; return advanceOneCounter(current, 'Gogma counter') }
  advanceSkillCounter(current: number, operation: SkillOperation): number { void operation; return advanceOneCounter(current, 'Skill counter') }
  advanceNormalCounter(current: number, operation: NormalArtianOperation): number {
    validateCounter(current, 'Normal Artian counter')
    if (!Number.isSafeInteger(operation.count) || operation.count < 1) throw new RangeError('Normal Artian operation count must be a positive safe integer')
    const next = current + operation.count
    if (!Number.isSafeInteger(next)) throw new RangeError('Normal Artian counter exceeds the safe integer range')
    return next
  }
}
