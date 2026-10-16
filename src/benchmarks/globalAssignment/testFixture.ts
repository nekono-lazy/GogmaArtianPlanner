/**
 * Test-only synthetic fixtures for the Global Assignment Research modules (Issue #154 Phase A).
 * Not a benchmark input and not an oracle: every value is a small hand-written table, and the
 * PlannerInput is the existing two-Target `globalResearchFixture()` shape rebuilt here so that the
 * Fake Engine's Ideal Reset positions can be varied (two inputs with the same Targets and different
 * valid Entry Routes).
 */
import { createBuildListEntry } from '../../domain/buildList'
import { GLOBAL_RESEARCH_RECORDED_CALCULATION_APP_SCHEMA_VERSION } from '../plannerGlobalOptimizationTestFixture'
import type { OwnedWeapon, RestorationBonusSet, TargetWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../../domain/rng/fakeRngEngine'
import { keepFamilyLayout } from '../../domain/rng/gogmaBonusFamily'
import type {
  RngEngine, RngEngineCapabilities, RngPredictionSupport, RngPredictionSupportInput, SkillPredictionResult,
} from '../../domain/rng/rngEngine'
import { searchCandidates } from '../../domain/search/candidateSearch'
import type { CandidateSearchInput } from '../../domain/search/searchTypes'
import { belowPracticalBonuses, createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet, targetWeaponId } from '../../test/fixtures/domainData'
import { GLOBAL_RESEARCH_TIME } from '../plannerGlobalOptimizationResearch'

export const FIXTURE_ENGINE_VERSION = 'fake-fixture:global-research'
export const FIXTURE_SKILL_ORIGIN = 7
export const FIXTURE_GOGMA_ORIGIN = 10
export const FIXTURE_NORMAL_ORIGIN = 4
export const FIXTURE_NORMAL_COUNTER_ID = 'weapon.fixture.a:8'

/** The fixture Target's Ideal: attack high x2, element middle, utility low, sharpness high. */
export const IDEAL_BONUSES: RestorationBonusSet = createRestorationBonusSet()
/** A family multiset different from the Ideal's (three attack slots). */
export const OTHER_FAMILIES: RestorationBonusSet = [IDEAL_BONUSES[0], IDEAL_BONUSES[0], IDEAL_BONUSES[0], IDEAL_BONUSES[3], IDEAL_BONUSES[4]]
/** The Ideal families in another slot order, lower tiers, Normal-side Sharpness spelling (a Normal-scope set). */
export const IDEAL_FAMILIES_REORDERED_NORMAL: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.normal_sharpness', bonusRankId: 'bonus_rank.fixture.low' },
  IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0], { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]

const fixtureMaster = { artianBonusTypeMappings: [
  { id: 'artian_bonus_mapping.fixture.attack', normalBonusTypeId: 'bonus_type.fixture.attack', gogmaBonusTypeId: 'bonus_type.fixture.attack' },
  { id: 'artian_bonus_mapping.fixture.sharpness', normalBonusTypeId: 'bonus_type.fixture.normal_sharpness', gogmaBonusTypeId: 'bonus_type.fixture.sharpness' },
] }

const idealRankByFamily: Record<string, string> = {
  'bonus_type.fixture.attack': 'bonus_rank.fixture.high',
  'bonus_type.fixture.element': 'bonus_rank.fixture.middle',
  'bonus_type.fixture.utility': 'bonus_rank.fixture.low',
  'bonus_type.fixture.sharpness': 'bonus_rank.fixture.high',
}

/** The ordered family layout as the Domain authority reads it (Normal-side types mapped). */
export function families(bonuses: RestorationBonusSet): string[] {
  return keepFamilyLayout(bonuses, fixtureMaster)
}

export function layoutKeyOf(bonuses: RestorationBonusSet): string {
  return families(bonuses).join('\u0000')
}

/** A Keep result that keeps each slot's family and rerolls every tier to the fixture Ideal's rank: Ideal iff the layout is an Ideal permutation. */
export function keepToIdealRanks(current: RestorationBonusSet): RestorationBonusSet {
  return families(current).map(family => ({ bonusTypeId: family, bonusRankId: idealRankByFamily[family] ?? 'bonus_rank.fixture.low' })) as RestorationBonusSet
}

/** A Keep result that keeps each slot's family and rerolls every tier to low: never the fixture Ideal (attack must be high). */
export function keepToLowRanks(current: RestorationBonusSet): RestorationBonusSet {
  return families(current).map(family => ({ bonusTypeId: family, bonusRankId: 'bonus_rank.fixture.low' })) as RestorationBonusSet
}

export interface TableEngineSpec {
  version?: string
  capabilities?: Partial<RngEngineCapabilities>
  skill?: (position: number, weaponTypeId: string, elementId: string) => SkillPredictionResult
  reset?: (position: number, weaponTypeId: string, elementId: string) => RestorationBonusSet
  keep?: (position: number, currentBonuses: RestorationBonusSet, weaponTypeId: string, elementId: string) => RestorationBonusSet
  normal?: (position: number, weaponTypeId: string, elementId: string) => RestorationBonusSet
  /** Overrides the capability-level support answer for some inputs; `null` keeps the default. */
  support?: (input: RngPredictionSupportInput) => RngPredictionSupport | null
}

export interface TableEngine {
  engine: RngEngine
  calls: { skill: number; reset: number; keep: number; normal: number; support: number }
  /** Every prediction input as `type|element|position` (Keep: `|layout`), in call order. */
  inputs: { skill: string[]; reset: string[]; keep: string[]; normal: string[] }
}

/**
 * A deterministic RNG Engine computed from small tables, counting its calls. Unlike `FakeRngEngine`
 * it answers every position, so a scan can be compared with a brute-force re-evaluation; like it, it
 * guesses no Production behaviour.
 */
export function createTableEngine(spec: TableEngineSpec = {}): TableEngine {
  const capabilities: RngEngineCapabilities = {
    supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: true, supportsKeepBonusesPrediction: true,
    ...spec.capabilities,
  }
  const calls = { skill: 0, reset: 0, keep: 0, normal: 0, support: 0 }
  const inputs = { skill: [] as string[], reset: [] as string[], keep: [] as string[], normal: [] as string[] }
  const skill = spec.skill ?? (() => ({ seriesSkillId: 'series_skill.fixture.other', groupSkillId: null }))
  const reset = spec.reset ?? (() => structuredClone(OTHER_FAMILIES))
  const keep = spec.keep ?? ((_position, current) => keepToLowRanks(current))
  const normal = spec.normal ?? (() => structuredClone(OTHER_FAMILIES))
  const engine: RngEngine = {
    version: spec.version ?? FIXTURE_ENGINE_VERSION,
    capabilities,
    getPredictionSupport(input) {
      calls.support += 1
      const override = spec.support?.(input)
      if (override) return override
      const supported = input.type === 'normal_artian' ? capabilities.supportsNormalArtianPrediction
        : input.type === 'skill' ? capabilities.supportsSkillPrediction
          : input.type === 'gogma_reset' ? capabilities.supportsGogmaPrediction
            : capabilities.supportsGogmaPrediction && capabilities.supportsKeepBonusesPrediction
      return supported ? { supported: true } : { supported: false, reason: 'engine_capability_unavailable' }
    },
    normalizeSeed: value => value,
    predictGogmaBonus(input) {
      if (input.operation.type === 'reset_bonuses') {
        calls.reset += 1
        inputs.reset.push(`${input.weaponTypeId}|${input.elementId}|${input.gogmaCounter}`)
        return reset(input.gogmaCounter, input.weaponTypeId, input.elementId)
      }
      calls.keep += 1
      inputs.keep.push(`${input.weaponTypeId}|${input.elementId}|${input.gogmaCounter}|${families(input.operation.currentBonuses).join(',')}`)
      return keep(input.gogmaCounter, input.operation.currentBonuses, input.weaponTypeId, input.elementId)
    },
    predictSkills(input) {
      calls.skill += 1
      inputs.skill.push(`${input.weaponTypeId}|${input.elementId}|${input.skillCounter}`)
      return skill(input.skillCounter, input.weaponTypeId, input.elementId)
    },
    predictNormalArtian(input) {
      calls.normal += 1
      inputs.normal.push(`${input.weaponTypeId}|${input.elementId}|${input.normalCounter}`)
      return normal(input.normalCounter, input.weaponTypeId, input.elementId)
    },
    advanceGogmaCounter: current => current + 1,
    advanceSkillCounter: current => current + 1,
    advanceNormalCounter: (current, operation) => current + operation.count,
  }
  return { engine, calls, inputs }
}

export interface GlobalAssignmentFixtureOptions {
  /** Gogma positions (of 10 / 11) whose Fake Reset result is the Ideal; the others return a non-Ideal set. Default both. */
  idealResetPositions?: number[]
  /** Adds Target c with Target a's weapon type and element (a second Target of one memo group). */
  sameElementTarget?: boolean
  /** Owned weapons present when the Entries are searched (an owned source makes the canonical Ideal an existing-Gogma Route). */
  ownedAtSearch?: OwnedWeapon[]
  /** `false` leaves the rarity-8 Normal Counter unconfirmed, so the searched Entries are forced-Reset (blind) Routes. Default true. */
  normalCounterConfirmed?: boolean
  /** `false` removes Normal Artian prediction from the Fake Engine, so a confirmed Counter still yields blind Routes. Default true. */
  fakeNormalPrediction?: boolean
}

export interface GlobalAssignmentFixture {
  search: CandidateSearchInput
  input: PlannerInput
  /** The fixed-table Fake Engine the Entries were searched with (version `FIXTURE_ENGINE_VERSION`). */
  fakeEngine: FakeRngEngine
  targets: { a: TargetWeapon; b: TargetWeapon; c: TargetWeapon | null }
}

/**
 * Two (or three) Targets on one weapon type sharing the Skill / Gogma / Normal streams, each with one
 * valid BuildListEntry searched by a fixed-table Fake Engine (the `globalResearchFixture()` shape). The
 * owned weapon list is empty; tests add owned weapons afterwards (no Entry references one).
 */
export async function createGlobalAssignmentFixture(options: GlobalAssignmentFixtureOptions = {}): Promise<GlobalAssignmentFixture> {
  const idealResetPositions = options.idealResetPositions ?? [10, 11]
  const search = createCandidateSearchInput()
  search.ownedWeapons = structuredClone(options.ownedAtSearch ?? [])
  // Two Gogma positions, so a fixture whose Ideal Reset sits at 11 alone still finds its canonical Ideal.
  search.settings = { ...search.settings, maxGogmaAdvance: 2 }
  if (options.normalCounterConfirmed === false) search.normalCounters = search.normalCounters.map(counter => ({ ...counter, isConfirmed: false }))
  search.calculationContext.appSchemaVersion = GLOBAL_RESEARCH_RECORDED_CALCULATION_APP_SCHEMA_VERSION
  const a = search.targetWeapons[0]!
  const b: TargetWeapon = { ...structuredClone(a), id: targetWeaponId('target.fixture.b'), elementId: 'element.fixture.b' }
  search.targetWeapons.push(b)
  const c: TargetWeapon | null = options.sameElementTarget ? { ...structuredClone(a), id: targetWeaponId('target.fixture.c') } : null
  if (c) search.targetWeapons.push(c)
  const bonuses = createRestorationBonusSet()
  const seed = search.rngState.baseSeed.value!
  const groups = [...new Map(search.targetWeapons.map(target => [`${target.weaponTypeId}|${target.elementId}`, target])).values()]
  const fixtures: FakeRngFixtures = {
    version: 'global-research',
    capabilities: { supportsNormalArtianPrediction: options.fakeNormalPrediction !== false, supportsGogmaPrediction: true, supportsSkillPrediction: true, supportsKeepBonusesPrediction: false },
    normalizedSeeds: [], keepBonusPredictions: [],
    resetBonusPredictions: groups.flatMap(target => [10, 11].map(gogmaCounter => ({
      input: { baseSeed: seed, gogmaCounter, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: { type: 'reset_bonuses' as const }, master: search.master },
      result: idealResetPositions.includes(gogmaCounter) ? bonuses : belowPracticalBonuses(),
    }))),
    gogmaCounterAdvances: [{ current: 10, operation: { type: 'reset_bonuses' }, result: 11 }, { current: 11, operation: { type: 'reset_bonuses' }, result: 12 }],
    normalArtianPredictions: groups.flatMap(target => [4, 5].map(normalCounter => ({
      input: { baseSeed: seed, weaponTypeId: target.weaponTypeId, elementId: target.elementId, rarity: 8 as const, normalCounter, master: search.master }, result: bonuses,
    }))),
    skillPredictions: groups.flatMap(target => [7, 8, 9].map(skillCounter => ({
      input: { baseSeed: seed, skillCounter, weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: search.master },
      result: { seriesSkillId: a.idealSkillCondition.seriesSkillId, groupSkillId: null },
    }))),
    normalCounterAdvances: [{ current: 4, operation: { type: 'create_normal_artian', count: 1 }, result: 5 }, { current: 5, operation: { type: 'create_normal_artian', count: 1 }, result: 6 }],
    skillCounterAdvances: [{ current: 7, operation: { type: 'convert_normal_to_gogma' }, result: 8 }, { current: 8, operation: { type: 'convert_normal_to_gogma' }, result: 9 },
      { current: 7, operation: { type: 'reset_skills' }, result: 8 }, { current: 8, operation: { type: 'reset_skills' }, result: 9 }, { current: 9, operation: { type: 'reset_skills' }, result: 10 }],
  }
  const fakeEngine = new FakeRngEngine(fixtures)
  if (fakeEngine.version !== FIXTURE_ENGINE_VERSION) throw new Error(`Fixture Engine version drifted: ${fakeEngine.version}`)
  search.calculationContext.rngEngineVersion = fakeEngine.version
  const entries = []
  for (const target of search.targetWeapons) {
    const result = await searchCandidates({ ...search, targetWeaponId: target.id }, fakeEngine, { now: () => GLOBAL_RESEARCH_TIME })
    if (!result.targetResult.candidate) throw new Error(`Fixture Candidate missing for ${target.id}`)
    entries.push(createBuildListEntry(result.targetResult.candidate, target, { createdAt: GLOBAL_RESEARCH_TIME }))
  }
  const input: PlannerInput = { ...search, buildListEntries: entries, conflictResolutions: [], options: { maxPlanSteps: 100 } }
  return { search, input, fakeEngine, targets: { a, b, c } }
}

export function ownedGogma(id: string, overrides: Partial<Extract<OwnedWeapon, { kind: 'gogma' }>> = {}): OwnedWeapon {
  return {
    id, kind: 'gogma', name: id, weaponTypeId: 'weapon.fixture.a', elementId: 'element.fixture.a',
    restorationBonuses: structuredClone(OTHER_FAMILIES), restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.other', groupSkillId: null, status: 'unclassified', isProtected: false,
    executionInProgress: null, memo: null, createdAt: GLOBAL_RESEARCH_TIME, updatedAt: GLOBAL_RESEARCH_TIME,
    ...overrides,
  } as OwnedWeapon
}

export function ownedNormal(id: string, overrides: Partial<Extract<OwnedWeapon, { kind: 'normal' }>> = {}): OwnedWeapon {
  return {
    id, kind: 'normal', rarity: 8, name: id, weaponTypeId: 'weapon.fixture.a', elementId: 'element.fixture.a',
    restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL), restorationBonusScope: 'normal_artian',
    seriesSkillId: null, groupSkillId: null, status: null, isProtected: false,
    executionInProgress: null, memo: null, createdAt: GLOBAL_RESEARCH_TIME, updatedAt: GLOBAL_RESEARCH_TIME,
    ...overrides,
  } as OwnedWeapon
}
