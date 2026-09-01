import { describe, expect, it, vi } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { isCalculationContextCompatible } from '../../domain/models/publicTypes'
import {
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import {
  createPlannerCalculationContext,
  createPlannerInput,
  type PlannerInputRepositories,
} from './createPlannerInput'

describe('createPlannerInput', () => {
  it('uses the Worker engine version as CalculationContext authority and caller-supplied Master', async () => {
    const master = createValidMasterDataFixture()
    const calculationContext = createPlannerCalculationContext(
      master,
      PRODUCTION_RNG_ENGINE_VERSION,
    )
    const rngState = createValidRngState()
    const normalCounter = createValidNormalArtianCounter()
    const ownedWeapon = createValidOwnedWeapon()
    const target = createValidTargetWeapon()
    const entry = createValidBuildListEntry()
    const repositories: PlannerInputRepositories = {
      ensureInitialRngState: vi.fn(async () => rngState),
      getAllNormalArtianCounters: vi.fn(async () => [normalCounter]),
      getAllOwnedWeapons: vi.fn(async () => [ownedWeapon]),
      getAllTargetWeapons: vi.fn(async () => [target]),
      getAllBuildListEntries: vi.fn(async () => [entry]),
    }

    const input = await createPlannerInput(master, calculationContext, repositories)

    expect(input.calculationContext.rngEngineVersion)
      .toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(input.buildListEntries).toEqual([entry])
    expect(input.master).toEqual({
      weaponBonusDefinitions: master.weaponBonusDefinitions,
      weaponTypes: master.weaponTypes,
      elements: master.elements,
      bonusTypes: master.bonusTypes,
      bonusRanks: master.bonusRanks,
      lotteries: master.lotteries,
      materialCosts: master.materialCosts,
    })
    expect(input).not.toHaveProperty('rngEngine')
  })

  it('keeps legacy or unavailable engine versions incompatible with Production context', () => {
    const master = createValidMasterDataFixture()
    const production = createPlannerCalculationContext(master, PRODUCTION_RNG_ENGINE_VERSION)
    const unavailable = createPlannerCalculationContext(master, 'production-engine-unavailable')
    expect(isCalculationContextCompatible(production, production)).toBe(true)
    expect(isCalculationContextCompatible(unavailable, production)).toBe(false)
  })
})
