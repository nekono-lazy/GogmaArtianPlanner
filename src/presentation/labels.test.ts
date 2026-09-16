import { describe, expect, it } from 'vitest'
import {
  compromiseCheckpointBadgeLabel,
  candidateSearchProgressPhaseLabels,
  conflictKindLabels,
  rejectedBuildListEntryReasonLabels,
  getRngMissingRequirementLabel,
  getRouteOperationLabel,
  ownedWeaponStatusLabels,
  planStepOperationLabels,
  plannerWarningLabels,
  rngStateSourceLabels,
  routeKindLabels,
  skippedRouteReasonLabels,
  staleReasonLabels,
} from './labels'

describe('presentation labels', () => {
  it('maps normal UI Domain values to shared Japanese labels', () => {
    expect(ownedWeaponStatusLabels).toEqual({ unclassified: '未分類', practical: '実用', ideal: '理想' })
    expect(compromiseCheckpointBadgeLabel({ bonus: 'practical', skill: 'ideal' })).toBe('実用')
    expect(compromiseCheckpointBadgeLabel({ bonus: 'ideal', skill: 'practical' })).toBe('実用')
    expect(compromiseCheckpointBadgeLabel({ bonus: 'alternative', skill: 'ideal' })).toBe('代替')
    expect(routeKindLabels.normal_artian_to_gogma).toContain('新規通常アーティア')
    expect(routeKindLabels.existing_gogma_reset_skills).toContain('スキル再抽選')
    expect(planStepOperationLabels.reserve_weapon).toBe('目標武器として確保')
    expect(plannerWarningLabels.max_steps_reached).toContain('ステップ数')
    expect(plannerWarningLabels.max_expanded_states_reached).toContain('探索状態数')
    expect(plannerWarningLabels.rng_prediction_unsupported).toContain('予測入力')
    // A completed Target is excluded, not broken: its label never asks for a
    // re-search or calls the Entry stale.
    expect(plannerWarningLabels.completed_target_excluded).toBe('完了済みの目標武器は生産計画の対象外です')
    expect(plannerWarningLabels.completed_target_excluded).not.toMatch(/再検索|stale|古い/i)
    expect(plannerWarningLabels.completed_target_excluded).not.toBe(plannerWarningLabels.build_list_entry_stale)
    expect(getRouteOperationLabel({ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 1, skillCounterAfter: 2 })).toBe('スキルをリセット')
    expect(skippedRouteReasonLabels.master_data_unavailable).toContain('マスターデータ')
    expect(staleReasonLabels.target_definition_changed).toContain('目標武器')
    expect(rngStateSourceLabels.observation).toBe('観測検索')
  })

  it('names every persisted rejection reason and conflict kind for the Plan view', () => {
    expect(Object.keys(rejectedBuildListEntryReasonLabels).sort()).toEqual([
      'already_satisfied',
      'dominated_by_better_candidate',
      'longer_route',
      'lower_priority',
      'requires_protected_weapon',
      'resource_conflict',
    ])
    expect(rejectedBuildListEntryReasonLabels.resource_conflict).toContain('競合')
    expect(Object.keys(conflictKindLabels).sort()).toEqual([
      'same_gogma_counter',
      'same_normal_counter',
      'same_owned_weapon_consumed',
      'same_skill_counter',
    ])
    expect(conflictKindLabels.same_skill_counter).toContain('スキルカウンター')
  })

  it('names the Candidate Search progress phases', () => {
    expect(candidateSearchProgressPhaseLabels).toEqual({
      preparing: '準備中',
      searching: '探索中',
      finalizing: '結果を整理中',
    })
  })

  it('presents no skip reason as a game rule requiring a Reset first', () => {
    // Keep from known normal-scope slots is predicted, so the former
    // normal-scope reason no longer exists, and no remaining label may claim
    // that the game forces a Reset before Keep.
    expect('normal_scope_keep_prediction_unsupported' in skippedRouteReasonLabels).toBe(false)
    for (const label of Object.values(skippedRouteReasonLabels)) {
      expect(label).not.toContain('必須')
      expect(label).not.toMatch(/リセット.*必要/)
    }
  })

  it('keeps no_owned_weapon_available neutral for Normal and Gogma source routes', () => {
    const label = skippedRouteReasonLabels.no_owned_weapon_available
    expect(label).toBe('条件に合う所持武器がありません')
    expect(label).not.toContain('巨戟')
    expect(label).not.toContain('通常')
  })

  it('translates fixed and counter-specific RNG requirements', () => {
    expect(getRngMissingRequirementLabel('base_seed')).toContain('基準シード')
    expect(getRngMissingRequirementLabel('normal_artian_counter:weapon.dual_blades:8')).toContain('通常アーティアカウンター')
    expect(getRngMissingRequirementLabel('engine:gogma_prediction')).toContain('予測エンジン')
  })
})
