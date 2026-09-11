import { describe, expect, it } from 'vitest'
import type {
  NormalArtianCounter,
  RngState,
  RouteOperation,
} from '../models/publicTypes'
import {
  createValidNormalArtianCounter,
  createValidRngState,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import { deriveRngCapabilities } from './capabilities'
import type { RngEngineCapabilities } from './rngEngine'

const supportedEngine: RngEngineCapabilities = {
  supportsSeedSearch: true,
  supportsNormalArtianPrediction: true,
  supportsGogmaPrediction: true,
  supportsSkillPrediction: true,
  supportsKeepBonusesPrediction: true,
}

function confirmedRngState(): RngState {
  return {
    ...createValidRngState(),
    skillCounter: { value: 7, isConfirmed: true, source: 'manual' },
  }
}

function resetBonusesOperation(): RouteOperation {
  return {
    type: 'reset_bonuses',
    sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
    gogmaCounterBefore: 10,
    gogmaCounterAfter: 11,
  }
}

function resetSkillsOperation(): RouteOperation {
  return {
    type: 'reset_skills',
    sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
    skillCounterBefore: 7,
    skillCounterAfter: 8,
  }
}

function createNormalOperation(): RouteOperation {
  return {
    type: 'create_normal_artian',
    weaponTypeId: 'weapon.fixture.a',
    rarity: 8,
    count: 1,
    normalCounterBefore: 4,
    normalCounterAfter: 5,
  }
}

describe('deriveRngCapabilities', () => {
  it('enables Gogma prediction with all confirmed Gogma dependencies', () => {
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [],
      [resetBonusesOperation()],
      supportedEngine,
    )
    expect(result.canPredictGogma).toBe(true)
  })

  it('disables Gogma prediction when the Gogma Counter is missing', () => {
    const rngState = confirmedRngState()
    rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    const result = deriveRngCapabilities(
      rngState,
      [],
      [resetBonusesOperation()],
      supportedEngine,
    )
    expect(result.canPredictGogma).toBe(false)
    expect(result.missingRequirements).toEqual(['gogma_counter'])
  })

  it('enables Skill prediction with all confirmed Skill dependencies', () => {
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [],
      [resetSkillsOperation()],
      supportedEngine,
    )
    expect(result.canPredictSkills).toBe(true)
  })

  it('does not require a confirmed legacy Counter Gate for Skill or Gogma prediction', () => {
    const rngState = confirmedRngState()
    rngState.counterGate = { value: null, isConfirmed: false, source: null }
    const result = deriveRngCapabilities(
      rngState,
      [],
      [resetBonusesOperation(), resetSkillsOperation()],
      supportedEngine,
    )
    expect(result.canPredictSkills).toBe(true)
    expect(result.canPredictGogma).toBe(true)
    expect(result.canRunPlanner).toBe(true)
    expect(result.missingRequirements).toEqual([])
  })

  it('disables Skill prediction when the Skill Counter is missing', () => {
    const rngState = confirmedRngState()
    rngState.skillCounter = { value: null, isConfirmed: false, source: null }
    const result = deriveRngCapabilities(
      rngState,
      [],
      [resetSkillsOperation()],
      supportedEngine,
    )
    expect(result.canPredictSkills).toBe(false)
    expect(result.missingRequirements).toEqual(['skill_counter'])
  })

  it('returns only confirmed Normal Counter IDs in deterministic order', () => {
    const confirmed = createValidNormalArtianCounter()
    const rarity6 = {
      ...confirmed,
      id: 'weapon.fixture.a:6',
      rarity: 6,
    } as unknown as NormalArtianCounter
    const rarity7 = {
      ...confirmed,
      id: 'weapon.fixture.a:7',
      rarity: 7,
    } as unknown as NormalArtianCounter
    const unconfirmed = {
      ...confirmed,
      id: 'weapon.fixture.b:8',
      weaponTypeId: 'weapon.fixture.b',
      counter: null,
      isConfirmed: false,
    }
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [rarity6, confirmed, unconfirmed, rarity7],
      [],
      supportedEngine,
    )
    expect(result.normalArtianSearchableCounterIds).toEqual([
      'weapon.fixture.a:8',
    ])
    expect(result.canSearchNormalArtian).toBe(true)
  })

  it('does not require every Normal Counter to enable Normal search', () => {
    const confirmed = createValidNormalArtianCounter()
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [
        confirmed,
        { ...confirmed, id: 'other:8', counter: null, isConfirmed: false },
      ],
      [createNormalOperation()],
      supportedEngine,
    )
    expect(result.canSearchNormalArtian).toBe(true)
    expect(result.canRunPlanner).toBe(true)
  })

  it('disables Planner for Keep when Keep prediction is unsupported', () => {
    const engine = {
      ...supportedEngine,
      supportsKeepBonusesPrediction: false,
    }
    const keepOperation: RouteOperation = {
      type: 'keep_bonuses',
      sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
      gogmaCounterBefore: 10,
      gogmaCounterAfter: 11,
    }
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [],
      [keepOperation],
      engine,
    )
    expect(result.canRunPlanner).toBe(false)
    expect(result.missingRequirements).toEqual(['engine:keep_prediction'])
  })

  it('requires only Skill prediction for a Reset Skills-only operation list', () => {
    const rngState = confirmedRngState()
    rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    const engine = {
      ...supportedEngine,
      supportsGogmaPrediction: false,
      supportsKeepBonusesPrediction: false,
    }
    const result = deriveRngCapabilities(
      rngState,
      [],
      [resetSkillsOperation()],
      engine,
    )
    expect(result.canPredictGogma).toBe(false)
    expect(result.canRunPlanner).toBe(true)
    expect(result.missingRequirements).toEqual([])
  })

  it('enables Planner when every required operation capability is available', () => {
    const result = deriveRngCapabilities(
      confirmedRngState(),
      [createValidNormalArtianCounter()],
      [
        createNormalOperation(),
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 10,
          skillCounterAfter: 11,
        },
        resetSkillsOperation(),
      ],
      supportedEngine,
    )
    expect(result.canRunPlanner).toBe(true)
    expect(result.missingRequirements).toEqual([])
  })

  it('returns all operation-related missing requirements in fixed order', () => {
    const rngState = confirmedRngState()
    rngState.baseSeed = { value: null, isConfirmed: false, source: null }
    rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    rngState.skillCounter = { value: null, isConfirmed: false, source: null }
    rngState.counterGate = { value: null, isConfirmed: false, source: null }
    const unsupportedEngine: RngEngineCapabilities = {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: false,
      supportsGogmaPrediction: false,
      supportsSkillPrediction: false,
      supportsKeepBonusesPrediction: false,
    }
    const keepOperation: RouteOperation = {
      type: 'keep_bonuses',
      sourceOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
      gogmaCounterBefore: 10,
      gogmaCounterAfter: 11,
    }
    const result = deriveRngCapabilities(
      rngState,
      [],
      [keepOperation, resetSkillsOperation(), createNormalOperation()],
      unsupportedEngine,
    )
    expect(result.missingRequirements).toEqual([
      'base_seed',
      'gogma_counter',
      'skill_counter',
      'normal_artian_counter:weapon.fixture.a:8',
      'engine:gogma_prediction',
      'engine:skill_prediction',
      'engine:normal_artian_prediction',
      'engine:keep_prediction',
    ])
  })

  it('derives Seed search only from explicit Engine support', () => {
    const supported = deriveRngCapabilities(
      confirmedRngState(),
      [],
      [],
      supportedEngine,
    )
    const unsupported = deriveRngCapabilities(
      confirmedRngState(),
      [],
      [],
      { ...supportedEngine, supportsSeedSearch: false },
    )
    expect(supported.canSearchSeed).toBe(true)
    expect(unsupported.canSearchSeed).toBe(false)
  })
})

describe('deriveRngCapabilities for a blind Normal creation', () => {
  function blindNormalOperation(): RouteOperation {
    return {
      type: 'create_normal_artian',
      weaponTypeId: 'weapon.fixture.a',
      rarity: 8,
      count: 1,
      normalCounterBefore: null,
      normalCounterAfter: null,
    }
  }

  function unconfirmedCounter(): NormalArtianCounter {
    return { ...createValidNormalArtianCounter(), counter: null, isConfirmed: false }
  }

  it('requires neither a confirmed Normal Counter nor Normal prediction', () => {
    const capabilities = deriveRngCapabilities(
      confirmedRngState(),
      [unconfirmedCounter()],
      [blindNormalOperation(), resetBonusesOperation()],
      { ...supportedEngine, supportsNormalArtianPrediction: false },
    )
    expect(capabilities.missingRequirements).toEqual([])
    expect(capabilities.canRunPlanner).toBe(true)
  })

  it('still requires the Gogma inputs its forced Reset Bonuses needs', () => {
    const rngState = confirmedRngState()
    rngState.gogmaCounter = { value: null, isConfirmed: false, source: null }
    const capabilities = deriveRngCapabilities(
      rngState,
      [unconfirmedCounter()],
      [blindNormalOperation(), resetBonusesOperation()],
      supportedEngine,
    )
    expect(capabilities.missingRequirements).toContain('gogma_counter')
    expect(capabilities.canRunPlanner).toBe(false)
  })

  it('keeps the predicted Normal creation requirements unchanged', () => {
    const capabilities = deriveRngCapabilities(
      confirmedRngState(),
      [unconfirmedCounter()],
      [createNormalOperation()],
      supportedEngine,
    )
    expect(capabilities.missingRequirements).toContain(
      `normal_artian_counter:${unconfirmedCounter().id}`,
    )
    expect(capabilities.canRunPlanner).toBe(false)
  })
})
