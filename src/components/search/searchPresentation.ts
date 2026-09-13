import type { ArtianBonusScope, MasterDataRoot } from '../../domain/master/masterTypes'
import type { RestorationBonus } from '../../domain/models/publicTypes'
export {
  compromiseCheckpointBadgeLabel,
  getRouteOperationLabel as operationLabel,
  routeKindLabels,
  skippedRouteReasonLabels,
  staleReasonLabels,
} from '../../presentation/labels'

/**
 * The display name of one restoration bonus.
 *
 * Restoration bonus availability and naming are scope-dependent Master Data
 * (`docs/MASTER_DATA.md`): a normal-tier and a Gogma-tier slot of the same
 * bonus type are different `WeaponBonusDefinition`s. Callers that know the
 * scope of the slots they render - a Candidate's `restorationBonusScope`, a
 * trace step's `restorationBonusScope`, a checkpoint group's
 * `restorationBonusScope` - pass it so the matching definition's own label is
 * used. When no scope is given, the historical lookup (Gogma definition, then
 * the generic type + rank label) is kept unchanged for existing call sites.
 * No scope is ever inferred here from an ID pattern.
 */
export function bonusLabel(
  bonus: RestorationBonus,
  weaponTypeId: string,
  master: MasterDataRoot,
  scope: ArtianBonusScope = 'gogma_artian',
): string {
  const specificDefinition = master.weaponBonusDefinitions.find(
      (definition) =>
        definition.weaponTypeId === weaponTypeId &&
        definition.bonusTypeId === bonus.bonusTypeId &&
        definition.bonusRankId === bonus.bonusRankId &&
        definition.scope === scope,
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
  return master.materials.find((material) => material.id === id)?.displayNameJa ?? '不明なアイテム素材'
}
