import { describe, expect, it } from 'vitest'
import { createBuildListCalculationContext } from '../../../services/buildList/createBuildListCalculationContext'
import { createPlannerCalculationContext } from '../../../services/planner/createPlannerInput'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
} from '../../models/publicTypes'
import { createValidMasterDataFixture } from '../../../test/fixtures/masterData'
import { createProductionPlannerRngEngine } from '../../../workers/planner.worker.production'
import { createProductionSearchRngEngine } from '../../../workers/search.worker.production'
import { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } from './productionRngEngine'
import { productionRngEngine, productionRngRuntime } from './productionRngRuntime'

describe('Production RNG runtime authority', () => {
  it('shares calculation schema 5 while retaining only build-result compatibility with schema 2, 3 and 4', () => {
    const master = createValidMasterDataFixture()
    const buildList = createBuildListCalculationContext(master)
    const planner = createPlannerCalculationContext(master, productionRngRuntime.version)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(5)
    expect(buildList.appSchemaVersion).toBe(CURRENT_CALCULATION_APP_SCHEMA_VERSION)
    expect(planner).toEqual(buildList)
    expect(isCalculationContextCompatible({ ...buildList, appSchemaVersion: 1 }, planner)).toBe(false)
    expect(isBuildResultCalculationContextCompatible(
      { ...buildList, appSchemaVersion: 1 },
      planner,
    )).toBe(false)
    const olderPlannerSchemas = [2, 3, 4].map((appSchemaVersion) => ({
      ...buildList,
      appSchemaVersion,
    }))
    olderPlannerSchemas.forEach((context) => {
      // A ProductionPlan still requires exact four-field equality.
      expect(isCalculationContextCompatible(context, planner)).toBe(false)
      expect(isBuildResultCalculationContextCompatible(context, planner)).toBe(true)
      expect(isBuildResultCalculationContextCompatible(
        { ...context, rngEngineVersion: 'production-rng:other' },
        planner,
      )).toBe(false)
    })
  })

  it('never treats the current schema as compatible with a future one', () => {
    const master = createValidMasterDataFixture()
    const current = createBuildListCalculationContext(master)
    const future = {
      ...current,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION + 1,
    }
    // The build-result exception is directional and enumerated, never a
    // general forward compatibility.
    expect(isBuildResultCalculationContextCompatible(future, current)).toBe(false)
    expect(isCalculationContextCompatible(future, current)).toBe(false)
  })

  it('keeps UI, Workers, and CalculationContext on the Production Engine version', () => {
    const master = createValidMasterDataFixture()

    expect(productionRngEngine).toBeInstanceOf(ProductionRngEngine)
    expect(productionRngRuntime.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(productionRngRuntime.version).toBe(productionRngEngine.version)
    expect(productionRngRuntime.capabilities).toEqual(productionRngEngine.capabilities)
    expect(createProductionSearchRngEngine().version).toBe(productionRngRuntime.version)
    expect(createProductionPlannerRngEngine().version).toBe(productionRngRuntime.version)
    expect(createBuildListCalculationContext(master).rngEngineVersion).toBe(productionRngRuntime.version)
    expect(createPlannerCalculationContext(master, productionRngRuntime.version).rngEngineVersion)
      .toBe(PRODUCTION_RNG_ENGINE_VERSION)

    const current = createPlannerCalculationContext(master, productionRngRuntime.version)
    expect(isCalculationContextCompatible(
      { ...current, rngEngineVersion: 'production-rng:c5-b' },
      current,
    )).toBe(false)
  })
})
