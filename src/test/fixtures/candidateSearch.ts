import { FakeRngEngine, type FakeRngFixtures } from '../../domain/rng/fakeRngEngine'
import type {
  CandidateSearchInput,
  SearchMasterSubset,
} from '../../domain/search'
import {
  createRestorationBonusSet,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
  ownedWeaponId,
} from './domainData'
import { restorationBonus, restorationBonusSet, targetEvaluationMaster } from './targetEvaluation'

export const SEARCH_FIXTURE_TIME = '2026-08-29T01:00:00.000Z'

export const searchMasterFixture: SearchMasterSubset = {
  weaponBonusDefinitions: [],
  bonusRanks: targetEvaluationMaster.bonusRanks.map((rank) => ({ ...rank })),
  lotteries: [
    {
      id: 'lottery.fixture.normal.a.rare7',
      lotteryKind: 'normal_artian_bonus',
      weaponTypeId: 'weapon.fixture.a',
      rarity: 'rare7',
      resultType: 'bonus',
      bonusTypeId: 'bonus_type.fixture.attack',
      bonusRankId: 'bonus_rank.fixture.high',
      seriesSkillId: null,
      groupSkillId: null,
      internalValue: 'fixture-only',
      weight: 0,
      sortOrder: 1,
      isEnabled: true,
    },
  ],
  materialCosts: [],
}

export function belowPracticalBonuses() {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )
}

export function createCandidateSearchInput(): CandidateSearchInput {
  const rngState = createValidRngState()
  rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  const target = createValidTargetWeapon()
  const owned = createValidOwnedWeapon(ownedWeaponId('owned.fixture.source'))
  owned.restorationBonuses = createRestorationBonusSet()
  owned.seriesSkillId = 'series_skill.fixture.a'
  owned.groupSkillId = null
  return {
    searchRunId: 'search-run.fixture.v1',
    targetWeaponIds: [target.id],
    routeFilter: 'all',
    resultFilter: 'all',
    rngState,
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [owned],
    targetWeapons: [target],
    settings: {
      maxNormalAdvance: 1,
      maxGogmaAdvance: 1,
      maxSkillAdvance: 1,
      maxCandidatesPerTarget: 200,
      similarityThreshold: 0.6,
    },
    master: {
      weaponBonusDefinitions: searchMasterFixture.weaponBonusDefinitions.map(
        (definition) => ({ ...definition }),
      ),
      bonusRanks: searchMasterFixture.bonusRanks.map((rank) => ({ ...rank })),
      lotteries: searchMasterFixture.lotteries.map((lottery) => ({ ...lottery })),
      materialCosts: searchMasterFixture.materialCosts.map((cost) => ({ ...cost })),
    },
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: 'fake-fixture:candidate-search-v1',
      appSchemaVersion: 1,
    },
  }
}

export interface CandidateSearchFixtureOptions {
  keepSupported?: boolean
  normalResult?: ReturnType<typeof createRestorationBonusSet>
  gogmaNewResult?: ReturnType<typeof createRestorationBonusSet>
  resetResult?: ReturnType<typeof createRestorationBonusSet>
  keepResult?: ReturnType<typeof createRestorationBonusSet>
  skillSupported?: boolean
}

export function createCandidateSearchEngine(
  input: CandidateSearchInput,
  options: CandidateSearchFixtureOptions = {},
): FakeRngEngine {
  const normalResult = options.normalResult ?? createRestorationBonusSet()
  const gogmaNewResult = options.gogmaNewResult ?? createRestorationBonusSet()
  const resetResult = options.resetResult ?? belowPracticalBonuses()
  const keepResult = options.keepResult ?? createRestorationBonusSet()
  const keepSelection = {
    mode: 'engine_defined' as const,
    engineParameters: { fixture: 'explicit' },
  }
  const source = input.ownedWeapons[0]
  const fixtures: FakeRngFixtures = {
    version: 'candidate-search-v1',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: options.skillSupported ?? true,
      supportsKeepBonusesPrediction: options.keepSupported ?? false,
    },
    normalizedSeeds: [],
    normalArtianPredictions: [
      {
        input: {
          baseSeed: input.rngState.baseSeed.value as string,
          weaponTypeId: input.targetWeapons[0].weaponTypeId,
          rarity: 'rare7',
          normalCounter: 4,
          master: input.master,
        },
        result: normalResult,
      },
    ],
    gogmaPredictions: [
      {
        input: {
          baseSeed: input.rngState.baseSeed.value as string,
          gogmaCounter: 10,
          counterGate: input.rngState.counterGate.value as number,
          weaponTypeId: input.targetWeapons[0].weaponTypeId,
          elementId: input.targetWeapons[0].elementId,
          operation: { type: 'new_gogma' },
          master: input.master,
        },
        result: gogmaNewResult,
      },
      {
        input: {
          baseSeed: input.rngState.baseSeed.value as string,
          gogmaCounter: 10,
          counterGate: input.rngState.counterGate.value as number,
          weaponTypeId: input.targetWeapons[0].weaponTypeId,
          elementId: input.targetWeapons[0].elementId,
          operation: { type: 'reset_bonuses' },
          master: input.master,
        },
        result: resetResult,
      },
      ...(options.keepSupported
        ? [
            {
              input: {
                baseSeed: input.rngState.baseSeed.value as string,
                gogmaCounter: 10,
                counterGate: input.rngState.counterGate.value as number,
                weaponTypeId: input.targetWeapons[0].weaponTypeId,
                elementId: input.targetWeapons[0].elementId,
                operation: { type: 'keep_bonuses' as const, selection: keepSelection },
                master: input.master,
              },
              result: keepResult,
            },
          ]
        : []),
    ],
    skillPredictions:
      options.skillSupported === false
        ? []
        : [
            {
              input: {
                baseSeed: input.rngState.baseSeed.value as string,
                skillCounter: 7,
                counterGate: input.rngState.counterGate.value as number,
                weaponTypeId: input.targetWeapons[0].weaponTypeId,
                elementId: input.targetWeapons[0].elementId,
                master: input.master,
              },
              result: {
                seriesSkillId: 'series_skill.fixture.a',
                groupSkillId: null,
              },
            },
          ],
    keepSelections:
      options.keepSupported && source
        ? [
            {
              input: {
                sourceBonuses: source.restorationBonuses,
                weaponTypeId: input.targetWeapons[0].weaponTypeId,
                elementId: input.targetWeapons[0].elementId,
                master: input.master,
              },
              result: [keepSelection],
            },
          ]
        : [],
    normalCounterAdvances: [
      {
        current: 4,
        operation: { type: 'create_normal_artian', count: 1 },
        result: 5,
      },
    ],
    gogmaCounterAdvances: [
      {
        current: 10,
        operation: { type: 'create_gogma_from_normal' },
        result: 11,
      },
      { current: 10, operation: { type: 'reset_bonuses' }, result: 11 },
      ...(options.keepSupported
        ? [
            {
              current: 10,
              operation: { type: 'keep_bonuses' as const, selection: keepSelection },
              result: 11,
            },
          ]
        : []),
    ],
    skillCounterAdvances:
      options.skillSupported === false
        ? []
        : [
            {
              current: 7,
              operation: { type: 'reset_skills' },
              result: 8,
            },
          ],
  }
  return new FakeRngEngine(fixtures)
}
