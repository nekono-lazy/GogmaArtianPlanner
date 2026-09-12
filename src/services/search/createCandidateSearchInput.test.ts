import { describe, expect, it } from 'vitest'
import { createDefaultAppSettings } from '../../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import {
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'
import {
  createCandidateSearchInput,
  type SearchInputRepositories,
} from './createCandidateSearchInput'

describe('createCandidateSearchInput', () => {
  it('passes the Production Reset Master subset from the caller-supplied Master root', async () => {
    const master = createValidMasterDataFixture()
    const rngState = createValidRngState()
    const normalCounters = [createValidNormalArtianCounter()]
    const ownedWeapons = [createValidOwnedWeapon()]
    const targetWeapons = [createValidTargetWeapon()]
    const repositories: SearchInputRepositories = {
      ensureInitialRngState: async () => rngState,
      getAllNormalArtianCounters: async () => normalCounters,
      getAllOwnedWeapons: async () => ownedWeapons,
      getAllTargetWeapons: async () => targetWeapons,
      ensureSettings: async () => createDefaultAppSettings('2026-09-01T00:00:00.000Z'),
    }
    const calculationContext = {
      gameVersion: master.manifest.gameVersion,
      masterDataVersion: master.manifest.dataVersion,
      rngEngineVersion: 'unavailable-rng:v1',
      appSchemaVersion: 1,
    }

    const input = await createCandidateSearchInput({
      searchRunId: 'search.master-subset',
      targetWeaponId: targetWeapons[0].id,
      routeFilter: 'all',
      settings: {
        maxNormalAdvance: 1,
        maxGogmaAdvance: 1,
        maxSkillAdvance: 1,
      },
      master,
      calculationContext,
    }, repositories)

    expect(input.master).toEqual({
      weaponBonusDefinitions: master.weaponBonusDefinitions,
      weaponTypes: master.weaponTypes,
      elements: master.elements,
      bonusTypes: master.bonusTypes,
      bonusRanks: master.bonusRanks,
      lotteries: master.lotteries,
      materialCosts: master.materialCosts,
    })
    expect(input.calculationContext).toEqual(calculationContext)
  })
})
