import type { MasterDataRoot } from '../master/masterTypes'
import { getEnabledElements, getEnabledWeaponTypes } from '../master/masterSelectors'
import type { RestorationBonusSet } from '../models/publicTypes'
import type { OwnedWeaponDraft, TargetWeaponDraft } from '../../services/crud/entityCrudServices'

export class MasterOptionsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MasterOptionsUnavailableError'
  }
}

export function createDefaultBonusSet(
  master: MasterDataRoot,
  weaponTypeId: string,
): RestorationBonusSet {
  const definition = master.weaponBonusDefinitions.find(
    (entry) => entry.isEnabled && entry.weaponTypeId === weaponTypeId,
  )
  if (!definition) {
    throw new MasterOptionsUnavailableError(
      '選択した武器種の復元ボーナスMaster Dataが利用できません。',
    )
  }
  const bonus = {
    bonusTypeId: definition.bonusTypeId,
    bonusRankId: definition.bonusRankId,
  }
  return [
    { ...bonus },
    { ...bonus },
    { ...bonus },
    { ...bonus },
    { ...bonus },
  ]
}

function baseOptions(master: MasterDataRoot) {
  const weaponType = getEnabledWeaponTypes(master).find((type) =>
    master.weaponBonusDefinitions.some(
      (definition) => definition.isEnabled && definition.weaponTypeId === type.id,
    ),
  )
  const element = getEnabledElements(master)[0]
  if (!weaponType || !element) {
    throw new MasterOptionsUnavailableError(
      '武器種または属性Master Dataが利用できません。',
    )
  }
  return { weaponTypeId: weaponType.id, elementId: element.id }
}

export function createOwnedWeaponDraft(
  master: MasterDataRoot,
  status: OwnedWeaponDraft['status'] = 'material',
): OwnedWeaponDraft {
  const base = baseOptions(master)
  return {
    name: '',
    ...base,
    restorationBonuses: createDefaultBonusSet(master, base.weaponTypeId),
    seriesSkillId: null,
    groupSkillId: null,
    status,
    isProtected: status !== 'material',
    relatedTargetWeaponIds: [],
    memo: null,
  }
}

export function createTargetWeaponDraft(master: MasterDataRoot): TargetWeaponDraft {
  const base = baseOptions(master)
  return {
    name: '',
    ...base,
    priority: 3,
    isEnabled: true,
    idealBonuses: createDefaultBonusSet(master, base.weaponTypeId),
    practicalBonusConditions: [],
    practicalAlternativeGroups: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
  }
}
