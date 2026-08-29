import type {
  BuildListEntryStaleReason,
  CandidateCategory,
  NormalArtianRarity,
  OwnedWeaponStatus,
  RngStateSource,
  RouteKind,
  RouteOperation,
} from '../domain/models/publicTypes'
import type {
  CandidateRouteFilter,
  SkippedRouteReason,
} from '../domain/search'
import type { RngCapabilityMissingRequirement } from '../domain/rng/capabilities'

export const ownedWeaponStatusLabels: Record<OwnedWeaponStatus, string> = {
  material: '素材',
  practical: '実用',
  ideal: '理想',
}

export const candidateCategoryLabels: Record<CandidateCategory, string> = {
  ideal: '理想',
  practical: '実用',
}

export const routeKindLabels: Record<RouteKind, string> = {
  normal_artian_to_gogma: '通常アーティア経由',
  existing_gogma_reset_bonuses: '所持武器：復元ボーナスリセット',
  existing_gogma_keep_bonuses: '所持武器：復元ボーナス保持',
  existing_gogma_reset_skills: '所持武器：スキルリセット',
  existing_gogma_mixed: '所持武器：複合ルート',
}

export const candidateRouteFilterLabels: Record<CandidateRouteFilter, string> = {
  all: 'すべての作成ルート',
  normal_artian: '通常アーティア経由',
  existing_gogma: '所持巨戟アーティア経由',
}

export const skippedRouteReasonLabels: Record<SkippedRouteReason, string> = {
  normal_counter_unconfirmed: '対象の通常アーティアカウンターを検索に使用できません',
  no_owned_weapon_available: '条件に合う所持巨戟アーティアがありません',
  no_unprotected_source_weapon: '破壊的操作に使える未保護武器がありません',
  gogma_capability_missing: '巨戟アーティア予測に必要なRNG状態が不足しています',
  skill_capability_missing: 'スキル予測に必要なRNG状態が不足しています',
  keep_prediction_unsupported: '復元ボーナス保持予測は現在の予測エンジンで利用できません',
  calculation_context_incompatible: '計算に使用したバージョンに互換性がありません',
  disabled_by_filter: '検索条件で除外されています',
  master_data_unavailable: '作成ルートに必要なマスターデータが利用できません',
}

export const staleReasonLabels: Record<BuildListEntryStaleReason, string> = {
  target_definition_changed: '目標武器の条件が変更されています',
  rng_state_changed: 'RNG状態が検索時から変更されています',
  owned_weapon_changed: '参照している所持武器が変更されています',
  calculation_context_changed: 'ゲーム・マスターデータ・予測エンジンのバージョンが変更されています',
}

export const rngStateSourceLabels: Record<RngStateSource, string> = {
  manual: '手動入力',
  gogma_seed_finder_import: 'GogmaSeedFinderから取得',
  observation: '観測検索',
}

export const normalArtianRarityLabels: Record<NormalArtianRarity, string> = {
  rare6: 'レア6',
  rare7: 'レア7',
  rare8: 'レア8',
}

export function getPersistenceReferenceKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    owned_weapon: '所持武器',
    build_candidate: '検索候補',
    build_list_entry: 'ビルドリスト',
    production_plan: '生産計画',
    execution_history: '実行履歴',
  }
  return labels[kind] ?? '関連データ'
}

export function getRouteOperationLabel(operation: RouteOperation): string {
  switch (operation.type) {
    case 'create_normal_artian':
      return `通常アーティアを作成 × ${operation.count}`
    case 'convert_normal_to_gogma':
      return '巨戟アーティアへ変換'
    case 'reset_bonuses':
      return '復元ボーナスをリセット'
    case 'keep_bonuses':
      return '復元ボーナスを保持して再抽選'
    case 'reset_skills':
      return 'スキルをリセット'
    case 'use_weapon_as_material':
      return '素材武器として使用'
  }
}

export function getRngMissingRequirementLabel(
  requirement: RngCapabilityMissingRequirement,
): string {
  if (requirement.startsWith('normal_artian_counter:')) {
    return '対象の通常アーティアカウンターを検索に使用できません'
  }
  const labels: Record<Exclude<RngCapabilityMissingRequirement, `normal_artian_counter:${string}`>, string> = {
    base_seed: 'Base Seed（基準シード）を検索に使用できません',
    gogma_counter: '巨戟カウンターを検索に使用できません',
    skill_counter: 'スキルカウンターを検索に使用できません',
    counter_gate: 'Counter Gate（カウンターゲート）を検索に使用できません',
    'engine:gogma_prediction': '巨戟アーティア予測エンジンが未対応です',
    'engine:skill_prediction': 'スキル予測エンジンが未対応です',
    'engine:normal_artian_prediction': '通常アーティア予測エンジンが未対応です',
    'engine:keep_prediction': '復元ボーナス保持予測エンジンが未対応です',
  }
  return labels[requirement as Exclude<RngCapabilityMissingRequirement, `normal_artian_counter:${string}`>]
}
