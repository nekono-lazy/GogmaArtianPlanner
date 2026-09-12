import { FakeRngEngine, type FakeRngFixtures } from '../../domain/rng/fakeRngEngine'
import type {
  CandidateSearchInput,
  CandidateSearchResult,
  SearchMasterSubset,
  TargetCandidateSearchResult,
} from '../../domain/search'
import type { BuildCandidate } from '../../domain/models/publicTypes'
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

/**
 * The searched Target's Candidates as a list.
 *
 * A Search result is at most one canonical Ideal Candidate, so this is an empty
 * or single-element array. It exists so an assertion can keep reading like a
 * collection without pretending the Domain still returns several Candidates.
 */
export function candidatesOf(
  result: CandidateSearchResult | TargetCandidateSearchResult,
): BuildCandidate[] {
  const targetResult = 'targetResult' in result ? result.targetResult : result
  return targetResult.candidate === null ? [] : [targetResult.candidate]
}

export const searchMasterFixture: SearchMasterSubset = {
  weaponBonusDefinitions: [],
  weaponTypes: [],
  elements: [],
  bonusTypes: [],
  bonusRanks: targetEvaluationMaster.bonusRanks.map((rank) => ({ ...rank })),
  lotteries: [
    {
      id: 'lottery.fixture.normal.a.8',
      lotteryKind: 'normal_artian_bonus',
      weaponTypeId: 'weapon.fixture.a',
      rarity: 8,
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

/**
 * Satisfies the fixture Target's Practical bonus conditions without matching
 * `idealBonuses`, so a Route base using it keeps searching the Bonus stream.
 */
export function practicalOnlyBonuses() {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
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
    targetWeaponId: target.id,
    routeFilter: 'all',
    rngState,
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [owned],
    targetWeapons: [target],
    settings: {
      maxNormalAdvance: 1,
      maxGogmaAdvance: 1,
      maxSkillAdvance: 1,
    },
    master: {
      weaponBonusDefinitions: searchMasterFixture.weaponBonusDefinitions.map(
        (definition) => ({ ...definition }),
      ),
      weaponTypes: searchMasterFixture.weaponTypes.map((weaponType) => ({ ...weaponType })),
      elements: searchMasterFixture.elements.map((element) => ({ ...element })),
      bonusTypes: searchMasterFixture.bonusTypes.map((bonusType) => ({ ...bonusType })),
      bonusRanks: searchMasterFixture.bonusRanks.map((rank) => ({ ...rank })),
      lotteries: searchMasterFixture.lotteries.map((lottery) => ({ ...lottery })),
      materialCosts: searchMasterFixture.materialCosts.map((cost) => ({ ...cost })),
    },
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: 'fake-fixture:candidate-search-v1',
      // Historical calculation context; runtime creators use the current authority.
      appSchemaVersion: 1,
    },
  }
}

export interface CandidateSearchFixtureOptions {
  keepSupported?: boolean
  /**
   * Series Skill published at Skill Counter 8, the first Reset Skills position.
   * It defaults to the conversion Skill, which the B3 stream-local retention
   * folds into the `resetCount = 0` solution; pass a different Skill when the
   * test needs a Reset Skills operation to survive retention.
   */
  resetSkillSeriesSkillId?: string
  normalResult?: ReturnType<typeof createRestorationBonusSet>
  resetResult?: ReturnType<typeof createRestorationBonusSet>
  keepResult?: ReturnType<typeof createRestorationBonusSet>
  skillSupported?: boolean
}

export function createCandidateSearchEngine(
  input: CandidateSearchInput,
  options: CandidateSearchFixtureOptions = {},
): FakeRngEngine {
  const normalResult = options.normalResult ?? createRestorationBonusSet()
  const resetResult = options.resetResult ?? belowPracticalBonuses()
  const keepResult = options.keepResult ?? createRestorationBonusSet()
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
          weaponTypeId: input.targetWeapons[0].weaponTypeId, elementId: input.targetWeapons[0].elementId, rarity: 8,
          normalCounter: 4,
          master: input.master,
        },
        result: normalResult,
      },
    ],
    resetBonusPredictions: [
      {
        input: {
          baseSeed: input.rngState.baseSeed.value as string,
          gogmaCounter: 10,
          weaponTypeId: input.targetWeapons[0].weaponTypeId,
          elementId: input.targetWeapons[0].elementId,
          operation: { type: 'reset_bonuses' },
          master: input.master,
        },
        result: resetResult,
      },
    ],
    skillPredictions: options.skillSupported === false ? [] : [
      { input: { baseSeed: input.rngState.baseSeed.value as string, skillCounter: 7, weaponTypeId: input.targetWeapons[0].weaponTypeId, elementId: input.targetWeapons[0].elementId, master: input.master }, result: { seriesSkillId: 'series_skill.fixture.a', groupSkillId: null } },
      { input: { baseSeed: input.rngState.baseSeed.value as string, skillCounter: 8, weaponTypeId: input.targetWeapons[0].weaponTypeId, elementId: input.targetWeapons[0].elementId, master: input.master }, result: { seriesSkillId: options.resetSkillSeriesSkillId ?? 'series_skill.fixture.a', groupSkillId: null } },
    ],
    keepBonusPredictions: options.keepSupported && source ? [{ input: { baseSeed: input.rngState.baseSeed.value as string, gogmaCounter: 10, weaponTypeId: input.targetWeapons[0].weaponTypeId, elementId: input.targetWeapons[0].elementId, operation: { type: 'keep_bonuses' as const, currentBonuses: source.restorationBonuses }, master: input.master }, result: keepResult }] : [],    normalCounterAdvances: [
      {
        current: 4,
        operation: { type: 'create_normal_artian', count: 1 },
        result: 5,
      },
    ],
    gogmaCounterAdvances: [
      {
        current: 10,
        operation: { type: 'reset_bonuses' },
        result: 11,
      },
      { current: 10, operation: { type: 'reset_bonuses' }, result: 11 },
      ...(options.keepSupported
        ? [
            {
              current: 10,
              operation: { type: 'keep_bonuses' as const },
              result: 11,
            },
          ]
        : []),
    ],
    skillCounterAdvances: options.skillSupported === false ? [] : [
      { current: 7, operation: { type: 'convert_normal_to_gogma' }, result: 8 },
      { current: 7, operation: { type: 'reset_skills' }, result: 8 },
      { current: 8, operation: { type: 'reset_skills' }, result: 9 },
    ],
  }
  return new FakeRngEngine(fixtures)
}
