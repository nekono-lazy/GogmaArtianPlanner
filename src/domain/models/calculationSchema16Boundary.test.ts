import { describe, expect, it } from 'vitest'
import { createValidBuildCandidate, createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  APP_SETTINGS_SCHEMA_VERSION,
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  RNG_STATE_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
} from './publicTypes'
import type { CalculationContext } from './publicTypes'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../rng/production/productionRngEngine'
import { loadMasterData } from '../master/loadMasterData'

/**
 * Issue #136 / #101 Phase 5-B: the Production Plan screen's Conflict what-if and
 * actual repair run the Planner Alternative scenario (`docs/PLANNER_SPEC.md`
 * 9.2.19.15). Every version 1..15 ProductionPlan fails closed, while the
 * explicit build-result exception `16 -> [12, 13, 14, 15]` keeps version 12..15
 * BuildCandidates and BuildListEntries usable. The persisted
 * `ProductionPlan.conflictRepairLineage` moves Dexie to 10 and Export to 13.
 */
describe('calculation schema 16 boundary', () => {
  const current: CalculationContext = {
    ...createValidBuildCandidate().calculationContext,
    appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  }
  const at = (appSchemaVersion: number, difference: Partial<CalculationContext> = {}) => ({
    ...current,
    appSchemaVersion,
    ...difference,
  })

  it('is the current calculation schema', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
  })

  it('moves Dexie to 10 and Export to 13 for the repair lineage, and no Settings, RngState, RNG or Master version', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(APP_SETTINGS_SCHEMA_VERSION).toBe(2)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    const master = loadMasterData()
    expect(master.ok && master.data.manifest.dataVersion).toBe(4)
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

  it('is an explicit map, never a range that a future schema would inherit', () => {
    // A hypothetical schema 17 runtime has no exception until one is written.
    for (const version of [12, 13, 14, 15, 16]) {
      expect(isBuildResultCalculationContextCompatible(at(version), at(17))).toBe(false)
    }
  })

  it('keeps the historical exceptions exactly: 15 -> [12, 13, 14], 14 -> [12, 13], 13 -> [12]', () => {
    const runtime = (version: number) => at(version)
    expect([11, 12, 13, 14, 15].map((v) => isBuildResultCalculationContextCompatible(at(v), runtime(15))))
      .toEqual([false, true, true, true, true])
    expect([11, 12, 13, 14].map((v) => isBuildResultCalculationContextCompatible(at(v), runtime(14))))
      .toEqual([false, true, true, true])
    expect([11, 12, 13].map((v) => isBuildResultCalculationContextCompatible(at(v), runtime(13))))
      .toEqual([false, true, true])
  })

  it.each([1, 11, 12, 13, 14, 15])('keeps a schema %i ProductionPlan incompatible under schema 16', (version) => {
    const plan = createValidProductionPlan()
    const planCurrent = { ...plan.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    expect(isCalculationContextCompatible({ ...planCurrent, appSchemaVersion: version }, planCurrent)).toBe(false)
  })

  it('keeps a schema 16 ProductionPlan compatible under schema 16', () => {
    expect(isCalculationContextCompatible(current, current)).toBe(true)
  })

  it('never applies the build-result exception to a ProductionPlan: the same schema 15 context splits', () => {
    const schema15 = at(15)
    expect(isBuildResultCalculationContextCompatible(schema15, current)).toBe(true)
    expect(isCalculationContextCompatible(schema15, current)).toBe(false)
  })
})
