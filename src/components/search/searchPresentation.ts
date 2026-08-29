import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { RestorationBonus } from '../../domain/models/publicTypes'
export {
  candidateCategoryLabels as categoryLabels,
  getRouteOperationLabel as operationLabel,
  routeKindLabels,
  skippedRouteReasonLabels,
  staleReasonLabels,
} from '../../presentation/labels'

export function bonusLabel(
  bonus: RestorationBonus,
  weaponTypeId: string,
  master: MasterDataRoot,
): string {
  const specificDefinition = master.weaponBonusDefinitions.find(
      (definition) =>
        definition.weaponTypeId === weaponTypeId &&
        definition.bonusTypeId === bonus.bonusTypeId &&
        definition.bonusRankId === bonus.bonusRankId &&
        definition.scope === 'gogma_artian',
    )?.displayNameJa
  const genericLabel = [
      master.bonusTypes.find(({ id }) => id === bonus.bonusTypeId)?.displayNameJa,
      master.bonusRanks.find(({ id }) => id === bonus.bonusRankId)?.displayNameJa,
    ]
      .filter(Boolean)
      .join(' ')
  return specificDefinition ?? (genericLabel || '不明な復元ボーナス')
}

export function seriesSkillLabel(id: string | null, master: MasterDataRoot): string {
  if (id === null) return 'なし'
  return master.seriesSkills.find((skill) => skill.id === id)?.displayNameJa ?? '不明なシリーズスキル'
}

export function groupSkillLabel(id: string | null, master: MasterDataRoot): string {
  if (id === null) return 'なし'
  return master.groupSkills.find((skill) => skill.id === id)?.displayNameJa ?? '不明なグループスキル'
}

export function materialLabel(id: string, master: MasterDataRoot): string {
  return master.materials.find((material) => material.id === id)?.displayNameJa ?? '不明な素材'
}
