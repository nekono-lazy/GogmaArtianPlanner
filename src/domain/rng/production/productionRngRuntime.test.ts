import { describe, expect, it } from 'vitest'
import { createBuildListCalculationContext } from '../../../services/buildList/createBuildListCalculationContext'
import { createPlannerCalculationContext } from '../../../services/planner/createPlannerInput'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, isCalculationContextCompatible } from '../../models/publicTypes'
import { createValidMasterDataFixture } from '../../../test/fixtures/masterData'
import { createProductionPlannerRngEngine } from '../../../workers/planner.worker.production'
import { createProductionSearchRngEngine } from '../../../workers/search.worker.production'
import { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } from './productionRngEngine'
import { productionRngEngine, productionRngRuntime } from './productionRngRuntime'

describe('Production RNG runtime authority', () => {
  it('shares calculation schema 2 across BuildList and Planner without changing RNG metadata', () => {
    const master = createValidMasterDataFixture()
    const buildList = createBuildListCalculationContext(master)
    const planner = createPlannerCalculationContext(master, productionRngRuntime.version)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(2)
    expect(buildList.appSchemaVersion).toBe(CURRENT_CALCULATION_APP_SCHEMA_VERSION)
    expect(planner).toEqual(buildList)
    expect(isCalculationContextCompatible({ ...buildList, appSchemaVersion: 1 }, planner)).toBe(false)
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
