import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
} from './publicTypes'
import type { CalculationContext } from './publicTypes'

/**
 * Issue #136 / #101 Phase 5-B: the Production Plan screen's Conflict what-if and
 * actual repair run the Planner Alternative scenario (`docs/PLANNER_SPEC.md`
 * 9.2.19.15). Every version 1..15 ProductionPlan fails closed, while the
 * explicit build-result exception `16 -> [12, 13, 14, 15]` keeps version 12..15
 * BuildCandidates and BuildListEntries usable. The persisted
 * `ProductionPlan.conflictRepairLineage` moved Dexie to 10 and Export to 13.
 *
 * Phase 6-A (the ordinary Planner routing of the Build List and the replan
 * Preview) moved the current schema to 17 (`calculationSchema17Boundary.test.ts`);
 * this file keeps pinning the schema 16 runtime's own exception.
 */
describe('calculation schema 16 boundary', () => {
  const current: CalculationContext = {
    ...createValidBuildCandidate().calculationContext,
    appSchemaVersion: 16,
  }
  const at = (appSchemaVersion: number, difference: Partial<CalculationContext> = {}) => ({
    ...current,
    appSchemaVersion,
    ...difference,
  })

  it('was superseded by a later calculation schema', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBeGreaterThan(16)
  })

  it.each([12, 13, 14, 15, 16])('keeps a schema %i build result compatible under schema 16', (version) => {
    expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'keeps a schema %i build result incompatible under schema 16',
    (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(false)
    },
  )

  it.each([
    ['gameVersion', { gameVersion: 'game.other' }],
    ['masterDataVersion', { masterDataVersion: 999 }],
    ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
  ] as const)('never lets the 16 -> [12, 13, 14, 15] exception cover a different %s', (_, difference) => {
    for (const version of [12, 13, 14, 15, 16]) {
      expect(isBuildResultCalculationContextCompatible(at(version, difference), current)).toBe(false)
    }
  })

  it('is directional: a newer build result is never compatible with an older runtime', () => {
    expect(isBuildResultCalculationContextCompatible(current, at(15))).toBe(false)
    expect(isBuildResultCalculationContextCompatible(current, at(14))).toBe(false)
  })

  it('never lets a schema 16 runtime accept a schema 17 build result', () => {
    expect(isBuildResultCalculationContextCompatible(at(17), current)).toBe(false)
  })

  it.each([1, 11, 12, 13, 14, 15])('keeps a schema %i ProductionPlan incompatible under schema 16', (version) => {
    const plan = createValidProductionPlan()
    const planCurrent = { ...plan.calculationContext, appSchemaVersion: 16 }
    expect(isCalculationContextCompatible({ ...planCurrent, appSchemaVersion: version }, planCurrent)).toBe(false)
  })

  it('never applies the build-result exception to a ProductionPlan: the same schema 15 context splits', () => {
    const schema15 = at(15)
    expect(isBuildResultCalculationContextCompatible(schema15, current)).toBe(true)
    expect(isCalculationContextCompatible(schema15, current)).toBe(false)
  })
})
