import { describe, expect, it } from 'vitest'
import {
  validatePlannerConflictRepairLineage,
  validateProductionPlan,
  type PlannerConflictRepairLineage,
  type ProductionPlan,
} from './publicTypes'
import { buildListEntryId, createValidProductionPlan, targetWeaponId } from '../../test/fixtures/domainData'

/**
 * `ProductionPlan.conflictRepairLineage` validation (`docs/DATA_MODEL.md`
 * 11.1.1, `docs/PLANNER_SPEC.md` 9.2.19.11): persisted structure, literals and
 * ID forms only - never a current foreign key.
 */

function lineage(): PlannerConflictRepairLineage {
  return {
    decisions: [{
      conflictKind: 'same_normal_counter',
      fixedBuildListEntryId: buildListEntryId('build-list.lineage.fixed'),
      fixedTargetWeaponId: targetWeaponId('target.lineage.fixed'),
      invalidatedRoutes: [{
        targetWeaponId: targetWeaponId('target.lineage.a'),
        invalidatedBuildListEntryId: buildListEntryId('build-list.lineage.a'),
        invalidatedRouteKey: 'route.key.a',
        replacementBuildListEntryId: buildListEntryId('build-list.lineage.a2'),
        outcome: 'replaced',
      }, {
        targetWeaponId: targetWeaponId('target.lineage.b'),
        invalidatedBuildListEntryId: buildListEntryId('build-list.lineage.b'),
        invalidatedRouteKey: 'route.key.b',
        replacementBuildListEntryId: null,
        outcome: 'rejected_by_scenario_composition',
      }],
    }, {
      // A decision kept only for its still valid fixed Entry.
      conflictKind: 'same_owned_weapon_consumed',
      fixedBuildListEntryId: buildListEntryId('build-list.lineage.fixed.2'),
      fixedTargetWeaponId: targetWeaponId('target.lineage.fixed.2'),
      invalidatedRoutes: [],
    }],
  }
}

function planWith(value: unknown): ProductionPlan {
  return { ...createValidProductionPlan(), conflictRepairLineage: value as ProductionPlan['conflictRepairLineage'] }
}

function lineageIssues(value: unknown) {
  return validateProductionPlan(planWith(value)).issues.filter(({ path }) => path.startsWith('conflictRepairLineage'))
}

describe('ProductionPlan conflictRepairLineage validation', () => {
  it('accepts null - a Plan outside any repair chain', () => {
    expect(validateProductionPlan(planWith(null)).isValid).toBe(true)
  })

  it('accepts a structurally valid lineage, empty decisions included', () => {
    expect(validateProductionPlan(planWith(lineage())).isValid).toBe(true)
    expect(validateProductionPlan(planWith({ decisions: [] })).isValid).toBe(true)
    expect(validatePlannerConflictRepairLineage(lineage())).toEqual({ isValid: true, issues: [] })
  })

  it.each([
    'replaced',
    'rejected_by_scenario_composition',
    'not_found_within_search_extent',
    'stopped_by_search_extent_bound',
    'stopped_by_candidate_trial_bound',
    'stopped_by_planner_rerun_bound',
    'blocked_by_selected_checkpoint',
  ] as const)('accepts the outcome %s with its replacement rule', (outcome) => {
    const value = lineage()
    value.decisions[0].invalidatedRoutes = [{
      ...value.decisions[0].invalidatedRoutes[0],
      outcome,
      replacementBuildListEntryId: outcome === 'replaced' ? buildListEntryId('build-list.g') : null,
    }]
    expect(lineageIssues(value)).toEqual([])
  })

  it('refuses a missing field: a current Plan body always carries it', () => {
    const plan = createValidProductionPlan() as Partial<ProductionPlan>
    delete plan.conflictRepairLineage
    expect(validateProductionPlan(plan as ProductionPlan).issues.map(({ path }) => path)).toContain('conflictRepairLineage')
  })

  it.each([
    ['a non-object lineage', 'lineage'],
    ['a lineage without a decisions array', { decisions: 'x' }],
    ['a non-object decision', { decisions: [3] }],
  ])('refuses %s', (_label, value) => {
    expect(lineageIssues(value).length).toBeGreaterThan(0)
  })

  it('refuses an unknown outcome literal and an unknown conflict kind', () => {
    const outcome = lineage()
    ;(outcome.decisions[0].invalidatedRoutes[1] as { outcome: string }).outcome = 'cancelled'
    expect(lineageIssues(outcome).map(({ code }) => code)).toContain('invalid_literal')
    const kind = lineage()
    ;(kind.decisions[0] as { conflictKind: string }).conflictKind = 'same_everything'
    expect(lineageIssues(kind).map(({ path }) => path)).toContain('conflictRepairLineage.decisions[0].conflictKind')
  })

  it('refuses replaced without a replacement, and a replacement on a non-replaced outcome', () => {
    const replaced = lineage()
    replaced.decisions[0].invalidatedRoutes[0].replacementBuildListEntryId = null
    expect(lineageIssues(replaced).map(({ code }) => code)).toEqual(['invalid_state'])
    const notReplaced = lineage()
    notReplaced.decisions[0].invalidatedRoutes[1].replacementBuildListEntryId = buildListEntryId('build-list.extra')
    expect(lineageIssues(notReplaced).map(({ code }) => code)).toEqual(['invalid_state'])
  })

  it('refuses malformed IDs and an empty Route key', () => {
    const value = lineage()
    value.decisions[0].fixedBuildListEntryId = '' as never
    value.decisions[0].fixedTargetWeaponId = '  ' as never
    value.decisions[0].invalidatedRoutes[0].targetWeaponId = 7 as never
    value.decisions[0].invalidatedRoutes[0].invalidatedBuildListEntryId = null as never
    value.decisions[0].invalidatedRoutes[0].invalidatedRouteKey = ''
    expect(lineageIssues(value).map(({ path }) => path)).toEqual([
      'conflictRepairLineage.decisions[0].fixedBuildListEntryId',
      'conflictRepairLineage.decisions[0].fixedTargetWeaponId',
      'conflictRepairLineage.decisions[0].invalidatedRoutes[0].targetWeaponId',
      'conflictRepairLineage.decisions[0].invalidatedRoutes[0].invalidatedBuildListEntryId',
      'conflictRepairLineage.decisions[0].invalidatedRoutes[0].invalidatedRouteKey',
    ])
  })

  it('never checks lineage IDs as current foreign keys, whatever the Plan status', () => {
    // No Build List or Target exists here at all; the structure alone decides.
    for (const status of ['draft', 'active', 'completed', 'abandoned', 'stale'] as const) {
      expect(lineageIssues(lineage())).toEqual([])
      expect(validateProductionPlan({ ...planWith(lineage()), status }).issues
        .filter(({ path }) => path.startsWith('conflictRepairLineage'))).toEqual([])
    }
  })
})
