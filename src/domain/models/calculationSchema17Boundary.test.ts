import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
} from './publicTypes'
import type { CalculationContext } from './publicTypes'

/**
 * Issue #136 / #101 Phase 6-A: the Build List's ordinary Plan creation and the
 * running Plan's replan Preview run the ordinary `createPlan()` instead of the
 * legacy B8 `createConstrainedPlan()` (`docs/PLANNER_SPEC.md` 9.2.7 /
 * 9.2.19.15). With `conflictResolutions = []` the two ordinarily agree, but the
 * ordinary Planner has no B8 `maxPlannerReruns = 4` budget on its
 * runtime-unsupported retries, so an input needing more than 4 full runs can
 * now produce a Plan where the old path returned none: a Planner-only
 * calculation change. Every version 1..16 ProductionPlan fails closed, while the
 * explicit build-result exception `17 -> [12, 13, 14, 15, 16]` keeps version
 * 12..16 BuildCandidates and BuildListEntries usable. No persisted shape moved.
 */
describe('calculation schema 17 boundary (historical, judged under an explicit schema 17 runtime)', () => {
  const current: CalculationContext = {
    ...createValidBuildCandidate().calculationContext,
    appSchemaVersion: 17,
  }
  const at = (appSchemaVersion: number, difference: Partial<CalculationContext> = {}) => ({
    ...current,
    appSchemaVersion,
    ...difference,
  })

  it.each([12, 13, 14, 15, 16, 17])('keeps a schema %i build result compatible under schema 17', (version) => {
    expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'keeps a schema %i build result incompatible under schema 17',
    (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(false)
    },
  )

  it.each([
    ['gameVersion', { gameVersion: 'game.other' }],
    ['masterDataVersion', { masterDataVersion: 999 }],
    ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
  ] as const)('never lets the 17 -> [12, 13, 14, 15, 16] exception cover a different %s', (_, difference) => {
    for (const version of [12, 13, 14, 15, 16, 17]) {
      expect(isBuildResultCalculationContextCompatible(at(version, difference), current)).toBe(false)
    }
  })

  it('is directional: a schema 17 build result is never compatible with an older runtime', () => {
    for (const runtime of [12, 13, 14, 15, 16]) {
      expect(isBuildResultCalculationContextCompatible(current, at(runtime))).toBe(false)
    }
  })

  it('keeps the historical exceptions exactly: 16 -> [12..15], 15 -> [12..14], 14 -> [12, 13], 13 -> [12]', () => {
    const under = (runtime: number, versions: number[]) =>
      versions.map((version) => isBuildResultCalculationContextCompatible(at(version), at(runtime)))
    expect(under(16, [11, 12, 13, 14, 15, 16, 17])).toEqual([false, true, true, true, true, true, false])
    expect(under(15, [11, 12, 13, 14, 15, 16])).toEqual([false, true, true, true, true, false])
    expect(under(14, [11, 12, 13, 14, 15])).toEqual([false, true, true, true, false])
    expect(under(13, [11, 12, 13, 14])).toEqual([false, true, true, false])
  })

  it.each([1, 11, 12, 13, 14, 15, 16])('keeps a schema %i ProductionPlan incompatible under schema 17', (version) => {
    const plan = createValidProductionPlan()
    const planCurrent = { ...plan.calculationContext, appSchemaVersion: 17 }
    expect(isCalculationContextCompatible({ ...planCurrent, appSchemaVersion: version }, planCurrent)).toBe(false)
  })

  it('keeps a schema 17 ProductionPlan compatible under schema 17', () => {
    expect(isCalculationContextCompatible(current, current)).toBe(true)
  })

  it('never applies the build-result exception to a ProductionPlan: the same schema 16 context splits', () => {
    const schema16 = at(16)
    expect(isBuildResultCalculationContextCompatible(schema16, current)).toBe(true)
    expect(isCalculationContextCompatible(schema16, current)).toBe(false)
  })
})
