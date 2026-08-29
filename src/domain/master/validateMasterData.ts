import type { MasterDataRoot, MasterManifest } from './masterTypes'

export interface MasterValidationResult {
  isValid: boolean
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isManifest(value: unknown): value is MasterManifest {
  if (!isRecord(value)) return false

  return (
    value.gameTitle === 'Monster Hunter Wilds' &&
    value.appDataKind === 'gogma-artian-planner-master' &&
    typeof value.gameVersion === 'string' &&
    Number.isInteger(value.dataVersion) &&
    Number(value.dataVersion) > 0 &&
    (value.generatedAt === null || typeof value.generatedAt === 'string') &&
    (value.notes === null || typeof value.notes === 'string')
  )
}

function validateUniqueIds(
  collectionName: string,
  values: ReadonlyArray<{ id: string }>,
  errors: string[],
) {
  const ids = new Set<string>()
  for (const value of values) {
    if (value.id.length === 0) {
      errors.push(`${collectionName} contains an empty id.`)
    } else if (ids.has(value.id)) {
      errors.push(`${collectionName} contains duplicate id: ${value.id}`)
    }
    ids.add(value.id)
  }
}

export function validateMasterData(master: MasterDataRoot): MasterValidationResult {
  const errors: string[] = []
  if (!isManifest(master.manifest)) {
    errors.push('manifest is invalid.')
  }

  const collections: Array<[
    string,
    ReadonlyArray<{ id: string }>,
  ]> = [
    ['weaponTypes', master.weaponTypes],
    ['elements', master.elements],
    ['bonusTypes', master.bonusTypes],
    ['bonusRanks', master.bonusRanks],
    ['weaponBonusDefinitions', master.weaponBonusDefinitions],
    ['seriesSkills', master.seriesSkills],
    ['groupSkills', master.groupSkills],
    ['lotteries', master.lotteries],
    ['materials', master.materials],
    ['materialCosts', master.materialCosts],
  ]
  for (const [name, values] of collections) {
    validateUniqueIds(name, values, errors)
  }

  const weaponTypeIds = new Set(master.weaponTypes.map(({ id }) => id))
  const bonusTypeIds = new Set(master.bonusTypes.map(({ id }) => id))
  const bonusRankIds = new Set(master.bonusRanks.map(({ id }) => id))
  const materialIds = new Set(master.materials.map(({ id }) => id))
  const definitionKeys = new Set<string>()

  for (const definition of master.weaponBonusDefinitions) {
    const key = `${definition.weaponTypeId}:${definition.bonusTypeId}:${definition.bonusRankId}`
    if (definitionKeys.has(key)) {
      errors.push(`weaponBonusDefinitions contains duplicate reference key: ${key}`)
    }
    definitionKeys.add(key)
    if (!weaponTypeIds.has(definition.weaponTypeId)) errors.push(`${definition.id} references an unknown weapon type.`)
    if (!bonusTypeIds.has(definition.bonusTypeId)) errors.push(`${definition.id} references an unknown bonus type.`)
    if (!bonusRankIds.has(definition.bonusRankId)) errors.push(`${definition.id} references an unknown bonus rank.`)
  }

  for (const lottery of master.lotteries) {
    if (!Number.isFinite(lottery.weight) || lottery.weight < 0) {
      errors.push(`${lottery.id} has an invalid weight.`)
    }
    if (lottery.resultType === 'bonus' && (!lottery.bonusTypeId || !lottery.bonusRankId)) {
      errors.push(`${lottery.id} is missing its bonus result.`)
    }
    if (lottery.resultType === 'series_skill' && !lottery.seriesSkillId) {
      errors.push(`${lottery.id} is missing its series skill result.`)
    }
    if (lottery.resultType === 'group_skill' && !lottery.groupSkillId) {
      errors.push(`${lottery.id} is missing its group skill result.`)
    }
  }

  for (const cost of master.materialCosts) {
    if (!Number.isInteger(cost.quantity) || cost.quantity < 1) {
      errors.push(`${cost.id} has an invalid quantity.`)
    }
    if (!materialIds.has(cost.materialId)) {
      errors.push(`${cost.id} references an unknown material.`)
    }
  }

  return { isValid: errors.length === 0, errors }
}

export function parseMasterManifest(input: unknown): MasterManifest | null {
  return isManifest(input) ? input : null
}
