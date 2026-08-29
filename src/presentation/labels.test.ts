import { describe, expect, it } from 'vitest'
import {
  candidateCategoryLabels,
  getRngMissingRequirementLabel,
  getRouteOperationLabel,
  ownedWeaponStatusLabels,
  planStepOperationLabels,
  rngStateSourceLabels,
  routeKindLabels,
  skippedRouteReasonLabels,
  staleReasonLabels,
} from './labels'

describe('presentation labels', () => {
  it('maps normal UI Domain values to shared Japanese labels', () => {
    expect(ownedWeaponStatusLabels).toEqual({ material: '素材', practical: '実用', ideal: '理想' })
    expect(candidateCategoryLabels.practical).toBe('実用')
    expect(routeKindLabels.normal_artian_to_gogma).toContain('新規通常アーティア')
    expect(routeKindLabels.existing_gogma_reset_skills).toContain('スキル再抽選')
    expect(planStepOperationLabels.create_material_gogma).toBe('素材用巨戟アーティアとして登録')
    expect(getRouteOperationLabel({ type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 1, skillCounterAfter: 2 })).toBe('スキルをリセット')
    expect(skippedRouteReasonLabels.master_data_unavailable).toContain('マスターデータ')
    expect(staleReasonLabels.target_definition_changed).toContain('目標武器')
    expect(rngStateSourceLabels.gogma_seed_finder_import).toBe('GogmaSeedFinderから取得')
  })

  it('translates fixed and counter-specific RNG requirements', () => {
    expect(getRngMissingRequirementLabel('base_seed')).toContain('基準シード')
    expect(getRngMissingRequirementLabel('normal_artian_counter:weapon.dual_blades:8')).toContain('通常アーティアカウンター')
    expect(getRngMissingRequirementLabel('engine:gogma_prediction')).toContain('予測エンジン')
  })
})
