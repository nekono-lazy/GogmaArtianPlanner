import type { BonusRankId, BonusTypeId, WeaponTypeId } from '../models/publicTypes'
import type {
  BonusRankMaster,
  ElementMaster,
  GroupSkillMaster,
  LotteryKind,
  LotteryMaster,
  MasterDataRoot,
  MaterialCostMaster,
  MaterialCostOperationType,
  SeriesSkillMaster,
  WeaponBonusDefinition,
  WeaponTypeMaster,
} from './masterTypes'

export type MasterDataDomainErrorCode =
  | 'master_id_not_found'
  | 'master_reference_invalid'

export class MasterDataDomainError extends Error {
  readonly code: MasterDataDomainErrorCode
  readonly masterName: string
  readonly id: string

  constructor(
    code: MasterDataDomainErrorCode,
    masterName: string,
    id: string,
  ) {
    super(`${masterName} id '${id}' is not available.`)
    this.name = 'MasterDataDomainError'
    this.code = code
    this.masterName = masterName
    this.id = id
  }
}

function compareBySortOrderAndId(
  left: { sortOrder: number; id: string },
  right: { sortOrder: number; id: string },
) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

function compareByRankOrderAndId(
  left: { order: number; id: string },
  right: { order: number; id: string },
) {
  return left.order - right.order || left.id.localeCompare(right.id)
}

function requireById<T extends { id: string }>(
  values: readonly T[],
  id: string,
  masterName: string,
): T {
  const value = values.find((entry) => entry.id === id)
  if (!value) {
    throw new MasterDataDomainError('master_id_not_found', masterName, id)
  }
  return value
}

export type BonusRankMasterLookup = Pick<MasterDataRoot, 'bonusRanks'>

export function getBonusRank(
  master: BonusRankMasterLookup,
  bonusRankId: BonusRankId,
): BonusRankMaster {
  return requireById(master.bonusRanks, bonusRankId, 'BonusRankMaster')
}

export function getEnabledWeaponTypes(
  master: MasterDataRoot,
): WeaponTypeMaster[] {
  return master.weaponTypes
    .filter(({ isEnabled }) => isEnabled)
    .sort(compareBySortOrderAndId)
}

export function getEnabledElements(master: MasterDataRoot): ElementMaster[] {
  return master.elements
    .filter(({ isEnabled }) => isEnabled)
    .sort(compareBySortOrderAndId)
}

export function getBonusDefinitionsForWeapon(
  master: MasterDataRoot,
  weaponTypeId: WeaponTypeId,
): WeaponBonusDefinition[] {
  requireById(master.weaponTypes, weaponTypeId, 'WeaponTypeMaster')
  return master.weaponBonusDefinitions
    .filter(
      (definition) =>
        definition.isEnabled && definition.weaponTypeId === weaponTypeId,
    )
    .sort(compareBySortOrderAndId)
}

export function getRanksForBonusType(
  master: MasterDataRoot,
  weaponTypeId: WeaponTypeId,
  bonusTypeId: BonusTypeId,
): BonusRankMaster[] {
  requireById(master.weaponTypes, weaponTypeId, 'WeaponTypeMaster')
  requireById(master.bonusTypes, bonusTypeId, 'BonusTypeMaster')

  const rankIds = new Set(
    master.weaponBonusDefinitions
      .filter(
        (definition) =>
          definition.isEnabled &&
          definition.weaponTypeId === weaponTypeId &&
          definition.bonusTypeId === bonusTypeId,
      )
      .map(({ bonusRankId }) => bonusRankId),
  )

  return [...rankIds]
    .map((rankId) => {
      const rank = master.bonusRanks.find(({ id }) => id === rankId)
      if (!rank) {
        throw new MasterDataDomainError(
          'master_reference_invalid',
          'BonusRankMaster',
          rankId,
        )
      }
      return rank
    })
    .filter(({ isEnabled }) => isEnabled)
    .sort(compareByRankOrderAndId)
}

export function getBonusRankOrder(
  master: BonusRankMasterLookup,
  bonusRankId: BonusRankId,
): number {
  return getBonusRank(master, bonusRankId).order
}

export function isExRank(
  master: BonusRankMasterLookup,
  bonusRankId: BonusRankId,
): boolean {
  return getBonusRank(master, bonusRankId).isEx
}

export function getSeriesSkillOptions(
  master: MasterDataRoot,
): SeriesSkillMaster[] {
  return master.seriesSkills
    .filter(({ isEnabled }) => isEnabled)
    .sort(compareBySortOrderAndId)
}

export function getGroupSkillOptions(
  master: MasterDataRoot,
): GroupSkillMaster[] {
  return master.groupSkills
    .filter(({ isEnabled }) => isEnabled)
    .sort(compareBySortOrderAndId)
}

export function getMaterialCosts(
  master: MasterDataRoot,
  operationType: MaterialCostOperationType,
  weaponTypeId: WeaponTypeId,
): MaterialCostMaster[] {
  requireById(master.weaponTypes, weaponTypeId, 'WeaponTypeMaster')
  return master.materialCosts
    .filter(
      (cost) =>
        cost.isEnabled &&
        cost.operationType === operationType &&
        (cost.weaponTypeId === null || cost.weaponTypeId === weaponTypeId),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function getLotteryEntries(
  master: MasterDataRoot,
  lotteryKind: LotteryKind,
  weaponTypeId: WeaponTypeId | null,
  rarity: LotteryMaster['rarity'],
): LotteryMaster[] {
  if (weaponTypeId !== null) {
    requireById(master.weaponTypes, weaponTypeId, 'WeaponTypeMaster')
  }
  return master.lotteries
    .filter(
      (entry) =>
        entry.isEnabled &&
        entry.lotteryKind === lotteryKind &&
        entry.weaponTypeId === weaponTypeId &&
        entry.rarity === rarity,
    )
    .sort(compareBySortOrderAndId)
}
