import type {
  BuildListEntryStaleReason,
  CompromiseConditionMatch,
  NormalArtianRarity,
  OwnedWeaponStatus,
  PlanStepOperationType,
  ProductionPlanStatus,
  RngStateSource,
  RouteKind,
  RouteOperation,
  ArtianWeaponKind,
} from '../domain/models/publicTypes'
import { isBlindCreateNormalArtianOperation } from '../domain/models/publicTypes'
import type { SkillMatchMode } from '../domain/models/common'
import type {
  CandidateRouteFilter,
  CandidateSearchNoticeSeverity,
  CandidateSearchProgressPhase,
  SkippedRouteReason,
} from '../domain/search'
import type { RngCapabilityMissingRequirement } from '../domain/rng/capabilities'
import type { PlannerWarningKind } from '../domain/planner'

export const ownedWeaponStatusLabels: Record<OwnedWeaponStatus, string> = {
  unclassified: '未分類',
  practical: '実用',
  ideal: '理想',
}

export const artianWeaponKindLabels: Record<ArtianWeaponKind, string> = {
  normal: '通常アーティア',
  gogma: '巨戟アーティア',
}

export const skillMatchModeLabels: Record<SkillMatchMode, string> = {
  all: 'すべて一致',
  any: 'いずれか一致',
}

/**
 * How one compromise checkpoint state rates on each Target axis.
 *
 * Explanatory display only: a checkpoint is never an independent Candidate, so
 * these labels classify a state on the canonical Ideal Route, not a category.
 */
export const compromiseBonusMatchLabels: Record<
  CompromiseConditionMatch['bonus'],
  string
> = {
  ideal: '理想',
  practical: '実用',
  alternative: '代替',
}

export const compromiseSkillMatchLabels: Record<
  CompromiseConditionMatch['skill'],
  string
> = {
  ideal: '理想',
  practical: '実用',
}

/** The short badge one checkpoint group shows: the weaker of its two axes. */
export function compromiseCheckpointBadgeLabel(
  conditionMatch: CompromiseConditionMatch,
): string {
  if (conditionMatch.bonus === 'alternative') return '代替'
  return conditionMatch.bonus === 'practical' || conditionMatch.skill === 'practical'
    ? '実用'
    : '理想'
}

export const routeKindLabels: Record<RouteKind, string> = {
  normal_artian_to_gogma: '新規通常アーティアから巨戟化',
  owned_normal_artian_to_gogma: '所持通常アーティアから巨戟化',
  existing_gogma_current: '所持巨戟の現在性能（操作なし）',
  existing_gogma_reset_bonuses: '所持巨戟の復元ボーナス再抽選',
  existing_gogma_keep_bonuses: '所持巨戟の復元ボーナス保持再抽選',
  existing_gogma_reset_skills: '所持巨戟のスキル再抽選',
  existing_gogma_mixed: '所持巨戟の複合ルート',
}

export const productionPlanStatusLabels: Record<ProductionPlanStatus, string> = {
  draft: '下書き',
  active: '実行中',
  completed: '完了',
  stale: '再計算が必要',
  abandoned: '破棄済み',
}

export const planStepOperationLabels: Record<PlanStepOperationType, string> = {
  create_normal_artian: '通常アーティアを作成',
  convert_normal_to_gogma: '巨戟アーティアへ変換',
  reset_bonuses: '復元ボーナスをリセット',
  keep_bonuses: '復元ボーナスを保持して再抽選',
  reset_skills: 'スキルをリセット',
  reserve_weapon: '目標武器として確保',
  confirm_result: '結果を確認',
}

export const plannerWarningLabels: Record<PlannerWarningKind, string> = {
  no_build_list_entries: '利用できるビルドリスト項目がありません',
  rng_state_missing: '必要なRNG状態または予測機能が不足しています',
  rng_prediction_unsupported: '指定されたRNG予測入力には対応していません',
  protected_weapon_required: '保護中の武器が必要なため実行できません',
  build_list_entry_stale: '再検索が必要なビルドリスト項目があります',
  calculation_context_incompatible: '計算に使用したバージョンに互換性がありません',
  all_targets_already_satisfied: 'すべての目標武器をすでに満たしています',
  invalid_conflict_resolution: '選択した競合解決を現在の状態へ適用できません',
  max_steps_reached: '計画ステップ数の上限に到達しました',
  max_expanded_states_reached: '探索状態数の上限に到達しました',
  max_candidate_trials_per_conflict_reached:
    '1つの競合について試行できる候補数の上限に到達しました',
  max_generated_build_list_entries_reached:
    '再検索で追加できるビルドリスト項目数の上限に到達しました',
  max_planner_reruns_reached: 'Plannerの再実行回数の上限に到達しました',
  constrained_enumeration_bound_reached:
    '再検索の探索範囲の上限に到達したため、候補の探索を打ち切りました',
  selected_checkpoint_blocks_constrained_search:
    '選択済みチェックポイントがある目標武器は再検索で別ルートへ置き換えません。作成リストでチェックポイントを変更または解除してください',
  multiple_selected_checkpoint_entries:
    '同じ目標武器にチェックポイントを選択した候補が2件以上あります。作成リストで片方のチェックポイント選択を解除してください',
  selected_checkpoint_target_already_ideal:
    '既に理想品を所持している目標武器にチェックポイントが選択されています。作成リストでそのチェックポイント選択を解除してください',
  selected_checkpoint_fixes_target_entry:
    'チェックポイントを選択した候補がある目標武器では、その候補だけを作成ルートとして扱い、同じ目標武器の他の候補は使用しません',
  invalid_checkpoint_selection:
    'チェックポイントの選択内容が候補の内容と一致しません。作成リストでその候補のチェックポイント選択を解除し、必要なら候補を追加し直してください',
}

export const candidateRouteFilterLabels: Record<CandidateRouteFilter, string> = {
  all: 'すべての作成ルート',
  normal_artian: '通常アーティア経由',
  existing_gogma: '所持巨戟アーティア経由',
}

/**
 * The Target-internal work total is discovered while searching, so the phase is
 * an activity signal. Never present it, or `processedWorkItems`, as a percent.
 */
export const candidateSearchProgressPhaseLabels: Record<CandidateSearchProgressPhase, string> = {
  preparing: '準備中',
  searching: '探索中',
  finalizing: '結果を整理中',
}

/**
 * A search that succeeded under a narrower method is an ordinary result, not a
 * failure, so it is headed as a notice rather than a warning.
 */
export const candidateSearchNoticeSeverityLabels: Record<CandidateSearchNoticeSeverity, string> = {
  info: 'お知らせ',
  warning: '警告',
}

export const skippedRouteReasonLabels: Record<SkippedRouteReason, string> = {
  normal_counter_unconfirmed: '対象の通常アーティアカウンターを検索に使用できません',
  // Used by both owned Normal Artian and existing Gogma routes, so the label
  // stays weapon-kind neutral; the RouteKind label names the concrete route.
  no_owned_weapon_available: '条件に合う所持武器がありません',
  no_unprotected_source_weapon: '破壊的操作に使える未保護武器がありません',
  gogma_capability_missing: '巨戟アーティア予測に必要なRNG状態が不足しています',
  skill_capability_missing: 'スキル予測に必要なRNG状態が不足しています',
  keep_prediction_unsupported: '復元ボーナス保持予測は現在の予測エンジンで利用できません',
  calculation_context_incompatible: '計算に使用したバージョンに互換性がありません',
  disabled_by_filter: '検索条件で除外されています',
  master_data_unavailable: '作成ルートに必要なマスターデータが利用できません',
  rng_state_unconfirmed: '確認済みのRNG状態が不足しています',
  normal_prediction_unsupported: '通常アーティア予測は現在のRNGエンジンで未対応です',
  skill_prediction_unsupported: 'スキル予測は現在のRNGエンジンで未対応です',
  gogma_prediction_unsupported: '巨戟アーティア予測は現在のRNGエンジンで未対応です',
  normal_scope_keep_prediction_unsupported:
    '通常アーティア由来の復元ボーナスを保持する再抽選は、現在の予測エンジンでは予測未対応です',
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
  8: 'レア8',
}

export function getPersistenceReferenceKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    owned_weapon: '所持武器',
    target_weapon: '目標武器',
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
      // A blind creation predicts no restoration bonuses, so the label says so
      // instead of implying a known result (`docs/SEARCH_SPEC.md` 6.1.1).
      return isBlindCreateNormalArtianOperation(operation)
        ? '通常アーティアを作成 × 1（復元ボーナス内容は不問）'
        : `通常アーティアを作成 × ${operation.count}`
    case 'convert_normal_to_gogma':
      return '巨戟アーティアへ変換'
    case 'reset_bonuses':
      return '復元ボーナスをリセット'
    case 'keep_bonuses':
      return '復元ボーナスを保持して再抽選'
    case 'reset_skills':
      return 'スキルをリセット'
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
    'engine:gogma_prediction': '巨戟アーティア予測エンジンが未対応です',
    'engine:skill_prediction': 'スキル予測エンジンが未対応です',
    'engine:normal_artian_prediction': '通常アーティア予測エンジンが未対応です',
    'engine:keep_prediction': '復元ボーナス保持予測エンジンが未対応です',
  }
  return labels[requirement as Exclude<RngCapabilityMissingRequirement, `normal_artian_counter:${string}`>]
}
