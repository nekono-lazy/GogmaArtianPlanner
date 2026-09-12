import { describe, expect, it } from 'vitest'
import {
  compromiseCheckpointBadgeLabel,
  candidateSearchProgressPhaseLabels,
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
    expect(getRouteOperationLabel({ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 1, skillCounterAfter: 2 })).toBe('スキルをリセット')
    expect(skippedRouteReasonLabels.master_data_unavailable).toContain('マスターデータ')
    expect(staleReasonLabels.target_definition_changed).toContain('目標武器')
    expect(rngStateSourceLabels.gogma_seed_finder_import).toBe('GogmaSeedFinderから取得')
  })

  it('names the Candidate Search progress phases', () => {
    expect(candidateSearchProgressPhaseLabels).toEqual({
      preparing: '準備中',
      searching: '探索中',
      finalizing: '結果を整理中',
    })
  })

  it('states normal-scope Keep as a prediction limit, not a game rule', () => {
    const label = skippedRouteReasonLabels.normal_scope_keep_prediction_unsupported
    expect(label).toContain('予測未対応')
    // The game allows Keep as the first amendment of inherited Normal-scope
    // bonuses, so the label must not claim a Reset is required first.
    expect(label).not.toContain('リセット')
    expect(label).not.toContain('必要')
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
