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

/**
 * Issue #129: the Production Planner fast-forwards the Counter-advance forges
 * of a predicted Normal creation instead of making them `same_normal_counter`
 * conflicts (`docs/PLANNER_SPEC.md` 7.0.2). Every version 1..14 ProductionPlan
 * fails closed, while the explicit build-result exception `15 -> [12, 13, 14]`
 * keeps version 12 / 13 / 14 BuildCandidates and BuildListEntries usable.
 */
describe('calculation schema 15 boundary', () => {
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
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(15)
  })

  it('moves no persisted schema or RNG version', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(9)
    expect(EXPORT_SCHEMA_VERSION).toBe(12)
    expect(APP_SETTINGS_SCHEMA_VERSION).toBe(2)
    expect(RNG_STATE_SCHEMA_VERSION).toBe(2)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })

  it.each([12, 13, 14, 15])('keeps a schema %i build result compatible under schema 15', (version) => {
    expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
    'keeps a schema %i build result incompatible under schema 15',
    (version) => {
      expect(isBuildResultCalculationContextCompatible(at(version), current)).toBe(false)
    },
  )

  it.each([
    ['gameVersion', { gameVersion: 'game.other' }],
    ['masterDataVersion', { masterDataVersion: 999 }],
    ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
  ] as const)('never lets the 15 -> [12, 13, 14] exception cover a different %s', (_, difference) => {
    for (const version of [12, 13, 14, 15]) {
      expect(isBuildResultCalculationContextCompatible(at(version, difference), current)).toBe(false)
    }
  })

  it('is directional: a newer build result is never compatible with an older runtime', () => {
    expect(isBuildResultCalculationContextCompatible(current, at(14))).toBe(false)
    expect(isBuildResultCalculationContextCompatible(current, at(13))).toBe(false)
  })

  it('is an explicit map, never a range that a future schema would inherit', () => {
    // A hypothetical schema 16 runtime has no exception until one is written.
    for (const version of [12, 13, 14, 15]) {
      expect(isBuildResultCalculationContextCompatible(at(version), at(16))).toBe(false)
    }
  })

  it.each([1, 11, 12, 13, 14])('keeps a schema %i ProductionPlan incompatible under schema 15', (version) => {
    const plan = createValidProductionPlan()
    const planCurrent = { ...plan.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    expect(isCalculationContextCompatible({ ...planCurrent, appSchemaVersion: version }, planCurrent)).toBe(false)
  })

  it('keeps a schema 15 ProductionPlan compatible under schema 15', () => {
    expect(isCalculationContextCompatible(current, current)).toBe(true)
  })

  it('never applies the build-result exception to a ProductionPlan: the same schema 14 context splits', () => {
    const schema14 = at(14)
    expect(isBuildResultCalculationContextCompatible(schema14, current)).toBe(true)
    expect(isCalculationContextCompatible(schema14, current)).toBe(false)
  })
})
