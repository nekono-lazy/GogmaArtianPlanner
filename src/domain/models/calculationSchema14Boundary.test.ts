import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
} from './publicTypes'
import type { CalculationContext } from './publicTypes'

/**
 * Issue #103 Phase C: the Production Planner moved from the Beam Search to the
 * deterministic scheduler (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`
 * 15.2 / 15.3). Every version 1..13 ProductionPlan fails closed, while the
 * explicit build-result exception `14 -> [12, 13]` keeps version 12 / 13
 * BuildCandidates and BuildListEntries usable.
 *
 * Issue #129 moved the current schema to 15 (`calculationSchema15Boundary.test.ts`);
 * this file keeps pinning the schema 14 runtime's own exception.
 */
describe('calculation schema 14 boundary', () => {
  const current: CalculationContext = {
    ...createValidBuildCandidate().calculationContext,
    appSchemaVersion: 14,
  }
  const at = (appSchemaVersion: number, difference: Partial<CalculationContext> = {}) => ({
    ...current,
    appSchemaVersion,
    ...difference,
  })

  it('was superseded by a later calculation schema', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBeGreaterThan(14)
  })

  it.each([12, 13, 14])('keeps a schema %i build result compatible under schema 14', (version) => {
    expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'keeps a schema %i build result incompatible under schema 14',
    (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(false)
    },
  )

  it.each([
    ['gameVersion', { gameVersion: 'game.other' }],
    ['masterDataVersion', { masterDataVersion: 999 }],
    ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
  ] as const)('never lets the 14 -> [12, 13] exception cover a different %s', (_, difference) => {
    for (const version of [12, 13, 14]) {
      expect(isBuildResultCalculationContextCompatible(at(version, difference), current)).toBe(false)
    }
  })

  it('is directional: a newer build result is never compatible with an older runtime', () => {
    expect(isBuildResultCalculationContextCompatible(current, at(13))).toBe(false)
    expect(isBuildResultCalculationContextCompatible(current, at(12))).toBe(false)
  })

  it.each([12, 13])('keeps a schema %i ProductionPlan incompatible under schema 14', (version) => {
    const plan = createValidProductionPlan()
    const planCurrent = { ...plan.calculationContext, appSchemaVersion: 14 }
    expect(isCalculationContextCompatible({ ...planCurrent, appSchemaVersion: version }, planCurrent)).toBe(false)
  })

  it('keeps a schema 14 ProductionPlan compatible under schema 14', () => {
    expect(isCalculationContextCompatible(current, current)).toBe(true)
  })

  it('never applies the build-result exception to a ProductionPlan: the same schema 13 context splits', () => {
    const schema13 = at(13)
    expect(isBuildResultCalculationContextCompatible(schema13, current)).toBe(true)
    expect(isCalculationContextCompatible(schema13, current)).toBe(false)
  })
})
