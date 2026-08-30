import type {
  ElementId,
  GroupSkillId,
  NormalArtianRarity,
  RestorationBonusSet,
  SeriesSkillId,
  WeaponTypeId,
} from '../models/publicTypes'
import type {
  BonusRankMaster,
  LotteryMaster,
  WeaponBonusDefinition,
} from '../master/masterTypes'

export type NormalizedSeed = string

export interface RngEngineCapabilities {
  supportsSeedSearch: boolean
  supportsNormalArtianPrediction: boolean
  supportsGogmaPrediction: boolean
  supportsSkillPrediction: boolean
  supportsKeepBonusesPrediction: boolean
}

export interface RngMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[]
  lotteries: LotteryMaster[]
  bonusRanks: BonusRankMaster[]
}

export interface GogmaBonusPredictionInput {
  baseSeed: NormalizedSeed
  gogmaCounter: number
  counterGate: number
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  operation:
    | { type: 'reset_bonuses' }
    | { type: 'keep_bonuses'; currentBonuses: RestorationBonusSet }
  master: RngMasterSubset
}

export interface SkillPredictionInput {
  baseSeed: NormalizedSeed
  skillCounter: number
  counterGate: number
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  master: RngMasterSubset
}

export interface SkillPredictionResult {
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
}

export interface NormalArtianPredictionInput {
  baseSeed: NormalizedSeed
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  rarity: NormalArtianRarity
  normalCounter: number
  master: RngMasterSubset
}

export type GogmaOperation =
  | { type: 'reset_bonuses' }
  | { type: 'keep_bonuses' }

export type SkillOperation =
  | { type: 'convert_normal_to_gogma' }
  | { type: 'reset_skills' }

export type NormalArtianOperation = {
  type: 'create_normal_artian'
  count: number
}

export interface RngEngine {
  readonly version: string
  readonly capabilities: RngEngineCapabilities
  normalizeSeed(input: string): NormalizedSeed
  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet
  predictSkills(input: SkillPredictionInput): SkillPredictionResult
  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet
  advanceGogmaCounter(current: number, operation: GogmaOperation): number
  advanceSkillCounter(current: number, operation: SkillOperation): number
  advanceNormalCounter(current: number, operation: NormalArtianOperation): number
}

export class UnsupportedRngOperationError extends Error {
  constructor(operation: string) {
    super(`RNG operation is unsupported without an explicit fixture: ${operation}`)
    this.name = 'UnsupportedRngOperationError'
  }
}
