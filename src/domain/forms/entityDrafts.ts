import type { ArtianBonusScope, MasterDataRoot } from '../master/masterTypes'
import { getBonusDefinitionsForWeapon, getEnabledElements, getEnabledWeaponTypes } from '../master/masterSelectors'
import type {
  ArtianWeaponKind,
  OwnedWeaponStatus,
  RestorationBonusSet,
  RestorationBonusScope,
} from '../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
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
  elementId: string,
  scope: ArtianBonusScope = 'gogma_artian',
): RestorationBonusSet {
  const definition = getBonusDefinitionsForWeapon(
    master,
    weaponTypeId,
    elementId,
    scope,
  )[0]
  if (!definition) {
    throw new MasterOptionsUnavailableError(
      '選択した武器種の復元ボーナスのマスターデータが利用できません。',
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

function baseOptions(master: MasterDataRoot, scope: ArtianBonusScope) {
  const element = getEnabledElements(master)[0]
  if (!element) {
    throw new MasterOptionsUnavailableError(
      '属性のマスターデータが利用できません。',
    )
  }
  const weaponType = getEnabledWeaponTypes(master).find((type) =>
    getBonusDefinitionsForWeapon(master, type.id, element.id, scope).length > 0,
  )
  if (!weaponType || !element) {
    throw new MasterOptionsUnavailableError(
      '武器種または属性のマスターデータが利用できません。',
    )
  }
  return { weaponTypeId: weaponType.id, elementId: element.id }
}

export function createOwnedWeaponDraft(
  master: MasterDataRoot,
  kindOrStatus: ArtianWeaponKind | OwnedWeaponStatus = 'gogma',
  requestedStatus: OwnedWeaponStatus = 'material',
): OwnedWeaponDraft {
  const kind: ArtianWeaponKind =
    kindOrStatus === 'normal' || kindOrStatus === 'gogma'
      ? kindOrStatus
      : 'gogma'
  const status: OwnedWeaponStatus =
    kindOrStatus === 'material' ||
    kindOrStatus === 'practical' ||
    kindOrStatus === 'ideal'
      ? kindOrStatus
      : requestedStatus
  const scope: RestorationBonusScope =
    kind === 'normal' ? 'normal_artian' : 'gogma_artian'
  const base = baseOptions(master, scope)
  const common = {
    kind,
    name: '',
    ...base,
    restorationBonusScope: scope,
    restorationBonuses: createDefaultBonusSet(
      master,
      base.weaponTypeId,
      base.elementId,
      scope,
    ),
    relatedTargetWeaponIds: [],
    memo: null,
  }
  return kind === 'normal'
    ? {
        ...common,
        kind: 'normal',
        rarity: V1_NORMAL_ARTIAN_RARITY,
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
        isProtected: false,
      }
    : {
        ...common,
        kind: 'gogma',
        seriesSkillId: null,
        groupSkillId: null,
        status,
        isProtected: status !== 'material',
      }
}

export function createTargetWeaponDraft(master: MasterDataRoot): TargetWeaponDraft {
  const base = baseOptions(master, 'gogma_artian')
  return {
    name: '',
    ...base,
    priority: 3,
    isEnabled: true,
    idealBonuses: createDefaultBonusSet(master, base.weaponTypeId, base.elementId),
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
  }
}
