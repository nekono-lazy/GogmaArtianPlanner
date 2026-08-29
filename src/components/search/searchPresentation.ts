import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  BuildListEntryStaleReason,
  CandidateCategory,
  RestorationBonus,
  RouteKind,
  RouteOperation,
} from '../../domain/models/publicTypes'
import type { SkippedRouteReason } from '../../domain/search'

export const skippedRouteReasonLabels: Record<SkippedRouteReason, string> = {
  normal_counter_unconfirmed: '対象の通常アーティアCounterが未確定です',
  no_owned_weapon_available: '条件に合う所持巨戟アーティアがありません',
  no_unprotected_source_weapon: '破壊的操作に使える未保護武器がありません',
  gogma_capability_missing: '巨戟アーティア予測に必要なRNG状態が不足しています',
  skill_capability_missing: 'スキル予測に必要なRNG状態が不足しています',
  keep_prediction_unsupported: 'Keep Bonuses予測は現在のEngineで利用できません',
  calculation_context_incompatible: '計算バージョンに互換性がありません',
  disabled_by_filter: '検索フィルターで除外されています',
  master_data_unavailable: 'Routeに必要なMaster Dataが利用できません',
}

export const staleReasonLabels: Record<BuildListEntryStaleReason, string> = {
  target_definition_changed: 'Target条件が変更されています',
  rng_state_changed: 'RNG状態が検索時から変更されています',
  owned_weapon_changed: '参照している所持武器が変更されています',
  calculation_context_changed: 'ゲーム・Master・Engineバージョンが変更されています',
}

export const routeKindLabels: Record<RouteKind, string> = {
  normal_artian_to_gogma: '通常アーティア経由',
  existing_gogma_reset_bonuses: '所持武器：ボーナスリセット',
  existing_gogma_keep_bonuses: '所持武器：ボーナス保持',
  existing_gogma_reset_skills: '所持武器：スキルリセット',
  existing_gogma_mixed: '所持武器：複合Route',
}

export const categoryLabels: Record<CandidateCategory, string> = {
  ideal: '理想',
  practical: '実用',
}

export function operationLabel(operation: RouteOperation): string {
  switch (operation.type) {
    case 'create_normal_artian':
      return `通常アーティア作成 × ${operation.count}`
    case 'convert_normal_to_gogma':
      return '巨戟アーティアへ変換'
    case 'reset_bonuses':
      return '復元ボーナスをリセット'
    case 'keep_bonuses':
      return '復元ボーナスを保持して再抽選'
    case 'reset_skills':
      return 'スキルをリセット'
    case 'use_weapon_as_material':
      return '所持武器を素材として使用'
  }
}

export function bonusLabel(
  bonus: RestorationBonus,
  weaponTypeId: string,
  master: MasterDataRoot,
): string {
  const specificDefinition = master.weaponBonusDefinitions.find(
      (definition) =>
        definition.weaponTypeId === weaponTypeId &&
        definition.bonusTypeId === bonus.bonusTypeId &&
        definition.bonusRankId === bonus.bonusRankId,
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
