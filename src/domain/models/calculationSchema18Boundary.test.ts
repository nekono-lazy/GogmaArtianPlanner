import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  APP_SETTINGS_SCHEMA_VERSION,
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  RNG_STATE_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
  isProductionPlanCalculationCompatible,
  validateProductionPlan,
} from './publicTypes'
import type { CalculationContext, PlannerConflictRepairLineage, ProductionPlan } from './publicTypes'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../rng/production/productionRngEngine'
import { loadMasterData } from '../master/loadMasterData'

/**
 * Issue #278 PR-2 (`docs/PLANNER_SPEC.md` 9.6.10): the Production Plan screen's
 * conflict resolution moves from the Planner Alternative repair to the ordinary
 * Planner. An input with explicit resolutions can plan differently, an input
 * without any plans exactly as under 17. So:
 *
 * - the build-result exception is `18 -> [12..17]`
 * - the first ProductionPlan exception is the narrow `18 -> 17` for a Plan whose
 *   body and snapshot are version 17, with no repair lineage and no selected
 *   Conflict, in any status
 * - every other version 17 Plan and every version 1..16 Plan fails closed
 * - no persisted shape moved
 */
const current: CalculationContext = {
  ...createValidBuildCandidate().calculationContext,
  appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
}
const at = (appSchemaVersion: number, difference: Partial<CalculationContext> = {}): CalculationContext => ({
  ...current,
  appSchemaVersion,
  ...difference,
})

/** A Plan whose body and snapshot carry `context`. */
function planAt(
  context: CalculationContext,
  edit: (plan: ProductionPlan) => void = () => undefined,
  snapshotContext: CalculationContext = context,
): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.calculationContext = structuredClone(context)
  plan.baseSnapshot = { ...plan.baseSnapshot, calculationContext: structuredClone(snapshotContext) }
  edit(plan)
  return plan
}

function withConflict(plan: ProductionPlan, selected: boolean) {
  const [entryId] = plan.selectedBuildListEntryIds
  plan.conflicts = [{
    id: 'conflict.fixture.a',
    kind: 'same_gogma_counter',
    buildListEntryIds: [entryId, 'build-list.fixture.other' as never],
    reason: 'fixture',
    recommendedBuildListEntryId: entryId,
    selectedBuildListEntryId: selected ? entryId : null,
    resolutionNote: null,
    checkpointParticipants: [],
  }]
}

const lineage: PlannerConflictRepairLineage = {
  decisions: [{
    conflictKind: 'same_gogma_counter',
    fixedBuildListEntryId: 'build-list.fixture.a' as never,
    fixedTargetWeaponId: 'target.fixture.a' as never,
    invalidatedRoutes: [{
      targetWeaponId: 'target.fixture.b' as never,
      invalidatedBuildListEntryId: 'build-list.fixture.b' as never,
      invalidatedRouteKey: 'route.fixture.b',
      replacementBuildListEntryId: null,
      outcome: 'stopped_by_search_extent_bound',
    }],
  }],
}

describe('calculation schema 18 boundary', () => {
  it('is the current calculation schema', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(18)
  })

  it('moves no Dexie, Export, Settings, RngState, RNG or Master version: no persisted shape changed', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(APP_SETTINGS_SCHEMA_VERSION).toBe(2)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    const master = loadMasterData()
    expect(master.ok && master.data.manifest.dataVersion).toBe(4)
  })

  describe('build results', () => {
    it.each([12, 13, 14, 15, 16, 17, 18])('keeps a schema %i build result compatible under schema 18', (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(true)
    })

    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('keeps a schema %i build result incompatible under schema 18', (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(false)
    })

    it.each([
      ['gameVersion', { gameVersion: 'game.other' }],
      ['masterDataVersion', { masterDataVersion: 999 }],
      ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
    ] as const)('never lets the 18 -> [12..17] exception cover a different %s', (_, difference) => {
      for (const version of [12, 13, 14, 15, 16, 17]) {
        expect(isBuildResultCalculationContextCompatible(at(version, difference), current)).toBe(false)
      }
    })

    it('is directional and an explicit map a future schema does not inherit', () => {
      for (const runtime of [12, 13, 14, 15, 16, 17]) {
        expect(isBuildResultCalculationContextCompatible(current, at(runtime))).toBe(false)
      }
      for (const version of [12, 13, 14, 15, 16, 17]) {
        expect(isBuildResultCalculationContextCompatible(at(version), at(19))).toBe(false)
      }
    })

    it('keeps the historical exception 17 -> [12..16] exactly', () => {
      const under17 = [11, 12, 13, 14, 15, 16, 17, 18].map((version) =>
        isBuildResultCalculationContextCompatible(at(version), at(17)))
      expect(under17).toEqual([false, true, true, true, true, true, true, false])
    })
  })

  describe('ProductionPlans (isProductionPlanCalculationCompatible)', () => {
    it('keeps a schema 18 Plan compatible, selected Conflicts and all', () => {
      expect(isProductionPlanCalculationCompatible(planAt(current), current)).toBe(true)
      expect(isProductionPlanCalculationCompatible(planAt(current, (plan) => withConflict(plan, true)), current)).toBe(true)
    })

    it.each(['draft', 'active', 'stale', 'completed', 'abandoned'] as const)(
      'keeps a resolution-free schema 17 %s Plan compatible: no lineage and no selected Conflict',
      (status) => {
        const plan = planAt(at(17), (target) => {
          target.status = status
          withConflict(target, false)
        })
        expect(isProductionPlanCalculationCompatible(plan, current)).toBe(true)
        // The Plan / snapshot consistency of validation stays exact and is untouched.
        expect(isCalculationContextCompatible(plan.calculationContext, plan.baseSnapshot.calculationContext)).toBe(true)
      },
    )

    it('keeps a schema 17 Plan without any Conflict compatible (a Build List optimization adoption)', () => {
      expect(isProductionPlanCalculationCompatible(planAt(at(17)), current)).toBe(true)
    })

    it('fails a schema 17 Plan with a repair lineage closed, in every status', () => {
      for (const status of ['draft', 'active', 'stale', 'completed', 'abandoned'] as const) {
        const plan = planAt(at(17), (target) => {
          target.status = status
          target.conflictRepairLineage = structuredClone(lineage)
        })
        expect(isProductionPlanCalculationCompatible(plan, current), status).toBe(false)
      }
    })

    it('fails a schema 17 Plan with no lineage but a selected Conflict closed', () => {
      expect(isProductionPlanCalculationCompatible(planAt(at(17), (plan) => withConflict(plan, true)), current)).toBe(false)
    })

    it('judges the snapshot by the same rule: a mixed 18 / 17 Plan is never compatible', () => {
      expect(isProductionPlanCalculationCompatible(planAt(at(17), () => undefined, current), current)).toBe(false)
      expect(isProductionPlanCalculationCompatible(planAt(current, () => undefined, at(17)), current)).toBe(false)
      // Validation refuses such a Plan on its own.
      expect(validateProductionPlan(planAt(current, () => undefined, at(17))).isValid).toBe(false)
    })

    it.each([1, 11, 12, 13, 14, 15, 16])('keeps a resolution-free schema %i Plan incompatible', (version) => {
      expect(isProductionPlanCalculationCompatible(planAt(at(version)), current)).toBe(false)
    })

    it.each([
      ['gameVersion', { gameVersion: 'game.other' }],
      ['masterDataVersion', { masterDataVersion: 999 }],
      ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
    ] as const)('never lets the 18 -> 17 Plan exception cover a different %s', (_, difference) => {
      expect(isProductionPlanCalculationCompatible(planAt(at(17, difference)), current)).toBe(false)
      expect(isProductionPlanCalculationCompatible(planAt(at(18, difference)), current)).toBe(false)
    })

    it('is an explicit map, never a range: no other runtime inherits it', () => {
      expect(isProductionPlanCalculationCompatible(planAt(at(17)), at(19))).toBe(false)
      expect(isProductionPlanCalculationCompatible(planAt(at(16)), at(17))).toBe(false)
      expect(isProductionPlanCalculationCompatible(planAt(at(18)), at(17))).toBe(false)
    })

    it('never applies the build-result exception to a Plan: a schema 16 context splits', () => {
      expect(isBuildResultCalculationContextCompatible(at(16), current)).toBe(true)
      expect(isProductionPlanCalculationCompatible(planAt(at(16)), current)).toBe(false)
    })
  })
})
