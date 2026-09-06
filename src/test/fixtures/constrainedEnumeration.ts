import { FakeRngEngine, type FakeRngFixtures } from '../../domain/rng/fakeRngEngine'
import type {
  CandidateSearchInput,
  CandidateSearchSettings,
  ConstrainedCandidateSearchInput,
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../domain/search'
import type { SkillPredictionResult } from '../../domain/rng/rngEngine'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/publicTypes'
import { searchMasterFixture } from './candidateSearch'
import {
  DOMAIN_FIXTURE_TIME,
  createRestorationBonusSet,
  createValidNormalArtianCounter,
  createValidRngState,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from './domainData'
import { restorationBonus, restorationBonusSet } from './targetEvaluation'

/**
 * Deterministic fixtures for the B8-B1 constrained candidate enumerator.
 *
 * The Fake Engine still answers only from explicit fixture entries; this module
 * just generates those entries over the Counter ranges a bounded constrained
 * enumeration actually visits. No Production RNG behavior is implied.
 */

export const CONSTRAINED_ENGINE_VERSION = 'fake-fixture:constrained-enumeration-v1'

export const CONSTRAINED_START_NORMAL_COUNTER = 4
export const CONSTRAINED_START_SKILL_COUNTER = 7
export const CONSTRAINED_START_GOGMA_COUNTER = 10

export const IDEAL_SERIES_SKILL_ID = 'series_skill.fixture.a'

/** Matches `idealBonuses` of the fixture Target as an unordered multiset. */
export function idealBonuses(): RestorationBonusSet {
  return createRestorationBonusSet()
}

/** Satisfies the Practical bonus conditions without matching `idealBonuses`. */
export function practicalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )
}

/** A second Practical result, incomparable with `practicalBonuses()`. */
export function alternativePracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )
}

/**
 * The same ordered Bonus Type layout as `practicalBonuses()` with lower ranks,
 * so both share one `gogmaKeepFamilyLayoutKey()` and the B2 family-layout
 * frontier folds them into a single representative.
 */
export function sameLayoutLowerRanks(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )
}

/** Satisfies neither the Ideal nor the Practical bonus conditions. */
export function belowPracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )
}

export function constrainedMaster() {
  return {
    weaponBonusDefinitions: searchMasterFixture.weaponBonusDefinitions.map((d) => ({ ...d })),
    weaponTypes: searchMasterFixture.weaponTypes.map((w) => ({ ...w })),
    elements: searchMasterFixture.elements.map((e) => ({ ...e })),
    bonusTypes: searchMasterFixture.bonusTypes.map((b) => ({ ...b })),
    bonusRanks: searchMasterFixture.bonusRanks.map((r) => ({ ...r })),
    lotteries: searchMasterFixture.lotteries.map((l) => ({ ...l })),
    materialCosts: searchMasterFixture.materialCosts.map((c) => ({ ...c })),
  }
}

export function constrainedTarget(): TargetWeapon {
  return createValidTargetWeapon()
}

export function gogmaWeapon(
  id: string,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  return {
    id: ownedWeaponId(id),
    kind: 'gogma',
    name: `Constrained fixture ${id}`,
    weaponTypeId: 'weapon.fixture.a',
    elementId: 'element.fixture.a',
    restorationBonuses: practicalBonuses(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.z',
    groupSkillId: null,
    status: 'material',
    isProtected: false,
    relatedTargetWeaponIds: [targetWeaponId('target.fixture.a')],
    memo: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
    ...overrides,
  }
}

export function normalWeapon(
  id: string,
  overrides: Partial<OwnedNormalArtianWeapon> = {},
): OwnedNormalArtianWeapon {
  return {
    id: ownedWeaponId(id),
    kind: 'normal',
    name: `Constrained fixture ${id}`,
    weaponTypeId: 'weapon.fixture.a',
    elementId: 'element.fixture.a',
    rarity: 8,
    restorationBonuses: practicalBonuses(),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    relatedTargetWeaponIds: [],
    memo: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
    ...overrides,
  }
}

/**
 * A distinct Practical five-slot result per index.
 *
 * Slots 1-3 satisfy the fixture Target's Practical conditions (two attack at
 * high plus one element at middle); slots 4 and 5 vary so every index yields a
 * different completed multiset. Used to build a long Bonus axis.
 */
export function practicalVariant(index: number): RestorationBonusSet {
  const fillers = [
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.high'),
  ]
  const fourth = fillers[index % fillers.length]
  const fifth = fillers[Math.floor(index / fillers.length) % fillers.length]
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    fourth,
    fifth,
  )
}

export interface ConstrainedOriginOptions {
  ownedWeapons?: ConstrainedSearchOrigin['ownedWeapons']
  /** Set to `[]` to make the Normal forge route unavailable. */
  normalCounters?: ConstrainedSearchOrigin['normalCounters']
  target?: TargetWeapon
  /** Additional Targets kept in the origin snapshot but never enumerated. */
  extraTargetWeapons?: TargetWeapon[]
  skillCounterConfirmed?: boolean
  gogmaCounterConfirmed?: boolean
}

export function createConstrainedSearchOrigin(
  options: ConstrainedOriginOptions = {},
): ConstrainedSearchOrigin {
  const rngState = createValidRngState()
  rngState.skillCounter = {
    value: CONSTRAINED_START_SKILL_COUNTER,
    isConfirmed: options.skillCounterConfirmed ?? true,
    source: 'manual',
  }
  rngState.gogmaCounter = {
    value: CONSTRAINED_START_GOGMA_COUNTER,
    isConfirmed: options.gogmaCounterConfirmed ?? true,
    source: 'observation',
  }
  return {
    rngState,
    normalCounters: options.normalCounters ?? [createValidNormalArtianCounter()],
    ownedWeapons: options.ownedWeapons ?? [],
    targetWeapons: [
      options.target ?? constrainedTarget(),
      ...(options.extraTargetWeapons ?? []),
    ],
    master: constrainedMaster(),
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: CONSTRAINED_ENGINE_VERSION,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    },
  }
}

export function constrainedBounds(
  overrides: Partial<ConstrainedEnumerationBounds> = {},
): ConstrainedEnumerationBounds {
  return {
    maxNormalForgeCount: 2,
    maxGogmaAdvance: 2,
    maxSkillResetCount: 2,
    maxOffAxisPairEvaluations: 0,
    ...overrides,
  }
}

export function constrainedInput(
  origin: ConstrainedSearchOrigin,
  bounds: ConstrainedEnumerationBounds = constrainedBounds(),
): ConstrainedCandidateSearchInput {
  return {
    origin,
    targetWeaponId: origin.targetWeapons[0].id,
    bounds,
  }
}

/**
 * The ordinary UI Search request over the same origin snapshot.
 *
 * Both Search boundaries share one fixture so a Domain contract that must hold
 * in `searchCandidates()` and in the constrained enumerator can be asserted
 * against identical inputs.
 */
export function candidateSearchInputFromOrigin(
  origin: ConstrainedSearchOrigin,
  settings: Partial<CandidateSearchSettings> = {},
): CandidateSearchInput {
  return {
    searchRunId: 'search-run.constrained-fixture',
    targetWeaponIds: [origin.targetWeapons[0].id],
    routeFilter: 'all',
    resultFilter: 'all',
    rngState: origin.rngState,
    normalCounters: origin.normalCounters,
    ownedWeapons: origin.ownedWeapons,
    targetWeapons: origin.targetWeapons,
    settings: {
      maxNormalAdvance: 1,
      maxGogmaAdvance: 2,
      maxSkillAdvance: 1,
      maxCandidatesPerTarget: 200,
      similarityThreshold: 0.6,
      ...settings,
    },
    master: origin.master,
    calculationContext: origin.calculationContext,
  }
}

export interface ConstrainedEngineOptions {
  /** Absolute Normal Counter positions to fixture, inclusive of the start. */
  normalPositions?: number
  skillPositions?: number
  gogmaPositions?: number
  normalResultAt?: (normalCounter: number) => RestorationBonusSet
  skillResultAt?: (skillCounter: number) => SkillPredictionResult
  resetResultAt?: (gogmaCounter: number) => RestorationBonusSet
  /** Current five slots for which a Keep prediction fixture is generated. */
  keepInputs?: RestorationBonusSet[]
  keepResultAt?: (
    gogmaCounter: number,
    currentBonuses: RestorationBonusSet,
  ) => RestorationBonusSet
  normalSupported?: boolean
  skillSupported?: boolean
  gogmaSupported?: boolean
  keepSupported?: boolean
  /** Counts every Engine prediction call, per operation. */
  callCounts?: { normal: number; skill: number; gogmaReset: number; gogmaKeep: number }
}

/**
 * A counting Fake Engine over the Counter ranges a bounded enumeration visits.
 *
 * Every prediction is still an explicit fixture entry, so a call outside the
 * generated range fails loudly instead of returning an invented result.
 */
export function createConstrainedEngine(
  origin: ConstrainedSearchOrigin,
  options: ConstrainedEngineOptions = {},
): FakeRngEngine {
  const target = origin.targetWeapons[0]
  const baseSeed = origin.rngState.baseSeed.value as string
  const master = origin.master
  const normalPositions = options.normalPositions ?? 6
  const skillPositions = options.skillPositions ?? 8
  const gogmaPositions = options.gogmaPositions ?? 6
  const normalResultAt = options.normalResultAt ?? (() => practicalBonuses())
  const skillResultAt =
    options.skillResultAt ??
    ((skillCounter: number) => ({
      seriesSkillId: `series_skill.fixture.s${skillCounter}`,
      groupSkillId: null,
    }))
  const resetResultAt = options.resetResultAt ?? (() => belowPracticalBonuses())
  const keepResultAt = options.keepResultAt ?? (() => belowPracticalBonuses())
  const startNormal = origin.normalCounters[0]?.counter ?? CONSTRAINED_START_NORMAL_COUNTER
  const startSkill = CONSTRAINED_START_SKILL_COUNTER
  const startGogma = CONSTRAINED_START_GOGMA_COUNTER

  const range = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => start + index)

  const fixtures: FakeRngFixtures = {
    version: 'constrained-enumeration-v1',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: options.normalSupported ?? true,
      supportsGogmaPrediction: options.gogmaSupported ?? true,
      supportsSkillPrediction: options.skillSupported ?? true,
      supportsKeepBonusesPrediction: options.keepSupported ?? false,
    },
    normalizedSeeds: [],
    normalArtianPredictions: range(startNormal, normalPositions).map((normalCounter) => ({
      input: {
        baseSeed,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        rarity: 8 as const,
        normalCounter,
        master,
      },
      result: normalResultAt(normalCounter),
    })),
    resetBonusPredictions: range(startGogma, gogmaPositions).map((gogmaCounter) => ({
      input: {
        baseSeed,
        gogmaCounter,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'reset_bonuses' as const },
        master,
      },
      result: resetResultAt(gogmaCounter),
    })),
    keepBonusPredictions: (options.keepInputs ?? []).flatMap((currentBonuses) =>
      range(startGogma, gogmaPositions).map((gogmaCounter) => ({
        input: {
          baseSeed,
          gogmaCounter,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: { type: 'keep_bonuses' as const, currentBonuses },
          master,
        },
        result: keepResultAt(gogmaCounter, currentBonuses),
      })),
    ),
    skillPredictions: range(startSkill, skillPositions).map((skillCounter) => ({
      input: {
        baseSeed,
        skillCounter,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master,
      },
      result: skillResultAt(skillCounter),
    })),
    normalCounterAdvances: range(startNormal, normalPositions).flatMap((current) =>
      range(1, normalPositions).map((count) => ({
        current,
        operation: { type: 'create_normal_artian' as const, count },
        result: current + count,
      })),
    ),
    gogmaCounterAdvances: range(startGogma, gogmaPositions).flatMap((current) => [
      { current, operation: { type: 'reset_bonuses' as const }, result: current + 1 },
      { current, operation: { type: 'keep_bonuses' as const }, result: current + 1 },
    ]),
    skillCounterAdvances: range(startSkill, skillPositions).flatMap((current) => [
      { current, operation: { type: 'convert_normal_to_gogma' as const }, result: current + 1 },
      { current, operation: { type: 'reset_skills' as const }, result: current + 1 },
    ]),
  }

  const engine = new FakeRngEngine(fixtures)
  const counts = options.callCounts
  if (!counts) return engine

  const countingEngine = Object.create(engine) as FakeRngEngine
  return Object.assign(countingEngine, {
    predictNormalArtian: (input: Parameters<FakeRngEngine['predictNormalArtian']>[0]) => {
      counts.normal += 1
      return engine.predictNormalArtian(input)
    },
    predictSkills: (input: Parameters<FakeRngEngine['predictSkills']>[0]) => {
      counts.skill += 1
      return engine.predictSkills(input)
    },
    predictGogmaBonus: (input: Parameters<FakeRngEngine['predictGogmaBonus']>[0]) => {
      if (input.operation.type === 'reset_bonuses') counts.gogmaReset += 1
      else counts.gogmaKeep += 1
      return engine.predictGogmaBonus(input)
    },
  })
}

export function ownedId(value: string): OwnedWeaponId {
  return ownedWeaponId(value)
}
