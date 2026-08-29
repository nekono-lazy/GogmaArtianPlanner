import type { MasterDataRoot } from './masterTypes'
import type { OwnedWeapon, RestorationBonus, TargetWeapon } from '../models/publicTypes'
import { getBonusDefinitionsForWeapon } from './masterSelectors'

function validateBonus(
  master: MasterDataRoot,
  weaponTypeId: string,
  elementId: string,
  scope: 'normal_artian' | 'gogma_artian',
  bonus: RestorationBonus,
  path: string,
  issues: string[],
) {
  if (
    !master.weaponTypes.some(
      ({ id, isEnabled }) => id === weaponTypeId && isEnabled,
    ) ||
    !master.elements.some(
      ({ id, isEnabled }) => id === elementId && isEnabled,
    )
  ) {
    issues.push(`${path}: 武器種または属性のマスターデータが利用できません。`)
    return
  }
  const available = getBonusDefinitionsForWeapon(
    master,
    weaponTypeId,
    elementId,
    scope,
  ).some(
    (definition) =>
      definition.bonusTypeId === bonus.bonusTypeId &&
      definition.bonusRankId === bonus.bonusRankId,
  )
  if (!available) issues.push(`${path}: 選択した武器種では利用できないボーナス／Rankです。`)
}

function validateCommon(
  value: Pick<OwnedWeapon, 'weaponTypeId' | 'elementId' | 'seriesSkillId' | 'groupSkillId'>,
  master: MasterDataRoot,
  issues: string[],
) {
  if (!master.weaponTypes.some(({ id, isEnabled }) => id === value.weaponTypeId && isEnabled)) {
    issues.push('weaponTypeId: 利用可能な武器種が見つかりません。')
  }
  if (!master.elements.some(({ id, isEnabled }) => id === value.elementId && isEnabled)) {
    issues.push('elementId: 利用可能な属性が見つかりません。')
  }
  if (value.seriesSkillId !== null && !master.seriesSkills.some(({ id, isEnabled }) => id === value.seriesSkillId && isEnabled)) {
    issues.push('seriesSkillId: 利用可能なシリーズスキルではありません。')
  }
  if (value.groupSkillId !== null && !master.groupSkills.some(({ id, isEnabled }) => id === value.groupSkillId && isEnabled)) {
    issues.push('groupSkillId: 利用可能なグループスキルではありません。')
  }
}

export function validateOwnedWeaponMasterReferences(
  weapon: OwnedWeapon,
  master: MasterDataRoot,
): string[] {
  const issues: string[] = []
  validateCommon(weapon, master, issues)
  const scope =
    weapon.kind === 'normal' ? 'normal_artian' : 'gogma_artian'
  weapon.restorationBonuses.forEach((bonus, index) =>
    validateBonus(master, weapon.weaponTypeId, weapon.elementId, scope, bonus, `restorationBonuses[${index}]`, issues),
  )
  return issues
}

export function validateTargetWeaponMasterReferences(
  target: TargetWeapon,
  master: MasterDataRoot,
): string[] {
  const issues: string[] = []
  validateCommon(
    {
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      seriesSkillId: target.idealSkillCondition.seriesSkillId,
      groupSkillId: target.idealSkillCondition.groupSkillId,
    },
    master,
    issues,
  )
  if (target.practicalSkillCondition.seriesSkillId !== null && !master.seriesSkills.some(({ id, isEnabled }) => id === target.practicalSkillCondition.seriesSkillId && isEnabled)) issues.push('practicalSkillCondition.seriesSkillId: 利用できません。')
  if (target.practicalSkillCondition.groupSkillId !== null && !master.groupSkills.some(({ id, isEnabled }) => id === target.practicalSkillCondition.groupSkillId && isEnabled)) issues.push('practicalSkillCondition.groupSkillId: 利用できません。')
  target.idealBonuses.forEach((bonus, index) => validateBonus(master, target.weaponTypeId, target.elementId, 'gogma_artian', bonus, `idealBonuses[${index}]`, issues))
  target.practicalBonusConditions.forEach((condition, index) => validateBonus(master, target.weaponTypeId, target.elementId, 'gogma_artian', { bonusTypeId: condition.bonusTypeId, bonusRankId: condition.minimumRankId }, `practicalBonusConditions[${index}]`, issues))
  target.practicalAlternativeGroups.forEach((group, groupIndex) => group.options.forEach((option, optionIndex) => validateBonus(master, target.weaponTypeId, target.elementId, 'gogma_artian', { bonusTypeId: option.bonusTypeId, bonusRankId: option.minimumRankId }, `practicalAlternativeGroups[${groupIndex}].options[${optionIndex}]`, issues)))
  return issues
}
