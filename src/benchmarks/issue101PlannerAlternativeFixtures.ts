import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  V1_NORMAL_ARTIAN_RARITY,
} from '../domain/models/publicTypes'
import type {
  BuildCandidate,
  BuildListEntry,
  CalculationContext,
  ElementId,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  PlanConflict,
  RestorationBonusSet,
  RngState,
  TargetWeapon,
  TargetWeaponId,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  createProductionPlannerDependencies,
  defaultPlannerOptions,
  preparePlannerInitialContext,
} from '../domain/planner'
import type { PlannerInput } from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { searchCandidates } from '../domain/search'
import type {
  CandidateSearchSettings,
  ConstrainedSearchOrigin,
  SearchMasterSubset,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'

/**
 * Issue #101 fixtures of the Planner Alternative tests and benchmark.
 *
 * - **Issue #101 real case** (`createIssue101RealFixture()`): the RNG state
 *   recorded in the Issue (Base Seed 51231782, Skill Counter 341, Gogma Counter
 *   55, Charge Blade Normal Counter 0) and the Issue's own Ideal
 *   (斬れ味・装填強化EX x1, 属性強化EX x2, 属性強化II x2) for a Fire and a Dragon
 *   Charge Blade Target. The two BuildListEntries carry the Candidates the
 *   unmodified current Candidate Search returns for them - nothing about the
 *   Route is taken from the Issue text, so a later RNG / Search change shows up
 *   as a fixture change instead of being hidden by a hard-coded Route.
 * - **Production benchmark fixture** (`createIssue101NoIdealSearchOrigin()`):
 *   the same RNG state and weapon, but a Fire Target whose Ideal the Production
 *   RNG can never produce (three 属性強化EX: the exact-ID repeat penalty of both
 *   Reset and Keep takes an EX candidate from 100 to 20 to 0, so a third EX of
 *   one type has zero weight). It measures the full traversal cost when no
 *   Ideal is inside the extent; it is not the Issue #101 case.
 *
 * Every Candidate comes from `searchCandidates()` with the unmodified
 * `ProductionRngEngine`, every Entry from `createBuildListEntry()`, and every
 * conflict key from `preparePlannerInitialContext()`. No Candidate result,
 * Counter position, or conflict key is hand-written.
 *
 * These fixtures were first built for the legacy B8 constrained re-search
 * research harness (`docs/ISSUE_101_CONSTRAINED_RESEARCH_BENCHMARK.md`), which
 * Phase 6-B2b removed together with its enumeration / orchestration sweep and
 * the approximate owned-Dragon variant. The real case itself is unchanged.
 */

export const ISSUE_101_BASE_SEED = '51231782'
export const ISSUE_101_SKILL_COUNTER = 341
export const ISSUE_101_GOGMA_COUNTER = 55
export const ISSUE_101_NORMAL_COUNTER = 0
export const ISSUE_101_WEAPON_TYPE_ID = 'weapon.charge_blade' as WeaponTypeId
export const ISSUE_101_FIRE_TARGET_ID = 'target.issue101.fire' as TargetWeaponId
export const ISSUE_101_DRAGON_TARGET_ID = 'target.issue101.dragon' as TargetWeaponId
const FIRE = 'element.fire' as ElementId
const DRAGON = 'element.dragon' as ElementId

/**
 * The Candidate Search settings the two Entries are searched with: the current
 * recommended initial values (`recommendedCandidateSearchDefaults`, Issue #125:
 * Normal 350 / 復元ボーナス 500 / Skill 1500), written out so a later default
 * change cannot silently redefine the fixture.
 */
export const ISSUE_101_CANDIDATE_SEARCH_SETTINGS: CandidateSearchSettings = {
  maxNormalAdvance: 350,
  maxGogmaAdvance: 500,
  maxSkillAdvance: 1500,
}

const FIXTURE_TIME = '2026-09-25T00:00:00.000Z'
const FIXTURE_SEARCH_RUN_ID = 'issue101-benchmark-fixture'

/** The Issue #101 Ideal, read from the Issue text. */
export const ISSUE_101_IDEAL_BONUSES: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
] as RestorationBonusSet

/** Production benchmark fixture only: three 属性強化EX, never drawable. */
export const ISSUE_101_UNREACHABLE_IDEAL_BONUSES: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.gogma_sharpness_capacity', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' },
  { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
] as RestorationBonusSet

interface Issue101Master {
  readonly master: SearchMasterSubset
  readonly context: CalculationContext
}

let cachedMaster: Issue101Master | null = null

function issue101Master(): Issue101Master {
  if (cachedMaster !== null) return cachedMaster
  const loaded = loadMasterData()
  if (!loaded.ok) {
    throw new Error(`Master Data is invalid: ${JSON.stringify(loaded.issues)}`)
  }
  const data = loaded.data
  cachedMaster = {
    master: {
      weaponBonusDefinitions: data.weaponBonusDefinitions,
      weaponTypes: data.weaponTypes,
      elements: data.elements,
      bonusTypes: data.bonusTypes,
      bonusRanks: data.bonusRanks,
      artianBonusTypeMappings: data.artianBonusTypeMappings,
      materialCosts: data.materialCosts,
    },
    context: {
      gameVersion: data.manifest.gameVersion,
      masterDataVersion: data.manifest.dataVersion,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      rngEngineVersion: new ProductionRngEngine().version,
    },
  }
  return cachedMaster
}

export function createIssue101RngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 2,
    baseSeed: { value: ISSUE_101_BASE_SEED, isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: ISSUE_101_GOGMA_COUNTER, isConfirmed: true, source: 'observation' },
    skillCounter: { value: ISSUE_101_SKILL_COUNTER, isConfirmed: true, source: 'observation' },
    // Legacy field only; Production active prediction never reads it.
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    lastIdentifiedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

export function createIssue101NormalCounter(): NormalArtianCounter {
  return {
    id: `${ISSUE_101_WEAPON_TYPE_ID}:${V1_NORMAL_ARTIAN_RARITY}`,
    weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    counter: ISSUE_101_NORMAL_COUNTER,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: FIXTURE_TIME,
    candidateCount: 1,
    lastIdentifiedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

/**
 * The Issue's Targets are Bonus-only: no Skill condition, no compromise. An
 * unset Practical Skill (both IDs null) allows only the Ideal Skills, which are
 * unset too, so any Skill satisfies it.
 */
function createTarget(
  id: TargetWeaponId,
  name: string,
  elementId: ElementId,
  idealBonuses: RestorationBonusSet,
  master: SearchMasterSubset,
): TargetWeapon {
  const target: TargetWeapon = {
    id,
    name,
    weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
    elementId,
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    lifecycleStatus: 'active',
    completedAt: null,
    completedByProductionPlanId: null,
    idealBonuses: structuredClone(idealBonuses),
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
  const containment = validateTargetIdealImpliesPractical(target, master)
  if (!containment.isValid) {
    throw new Error(
      `Issue #101 Target '${id}' violates Ideal implies Practical: ${containment.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join(' / ')}`,
    )
  }
  return target
}

export function createIssue101Targets(): { fire: TargetWeapon; dragon: TargetWeapon } {
  const { master } = issue101Master()
  return {
    fire: createTarget(ISSUE_101_FIRE_TARGET_ID, 'Issue #101 火チャージアックス', FIRE, ISSUE_101_IDEAL_BONUSES, master),
    dragon: createTarget(ISSUE_101_DRAGON_TARGET_ID, 'Issue #101 龍チャージアックス', DRAGON, ISSUE_101_IDEAL_BONUSES, master),
  }
}

export function createIssue101SearchOrigin(
  targetWeapons: readonly TargetWeapon[],
): ConstrainedSearchOrigin {
  const { master, context } = issue101Master()
  return {
    rngState: createIssue101RngState(),
    normalCounters: [createIssue101NormalCounter()],
    ownedWeapons: [],
    targetWeapons: structuredClone([...targetWeapons]),
    master,
    calculationContext: { ...context },
  }
}

export interface Issue101RealFixture {
  readonly fireCandidate: BuildCandidate
  readonly dragonCandidate: BuildCandidate
  readonly fireEntry: BuildListEntry
  readonly dragonEntry: BuildListEntry
  /** The ordinary Planner input, with no conflict resolution. */
  readonly plannerInput: PlannerInput
  readonly initialConflicts: readonly PlanConflict[]
}

async function searchIdeal(
  target: TargetWeapon,
  targetWeapons: TargetWeapon[],
  ownedWeapons: OwnedGogmaArtianWeapon[],
  engine: ProductionRngEngine,
): Promise<BuildCandidate> {
  const { master, context } = issue101Master()
  const result = await searchCandidates(
    {
      searchRunId: FIXTURE_SEARCH_RUN_ID,
      targetWeaponId: target.id,
      routeFilter: 'all',
      rngState: createIssue101RngState(),
      normalCounters: [createIssue101NormalCounter()],
      ownedWeapons: structuredClone(ownedWeapons),
      targetWeapons,
      settings: { ...ISSUE_101_CANDIDATE_SEARCH_SETTINGS },
      master,
      calculationContext: { ...context },
    },
    engine,
  )
  const candidate = result.targetResult.candidate
  if (candidate === null) {
    throw new Error(`Issue #101 fixture: Candidate Search found no Ideal for '${target.id}'.`)
  }
  return candidate
}

/**
 * Builds the Issue #101 real case with the current Production authorities. It
 * runs two real Candidate Searches, so callers cache it.
 */
export async function createIssue101RealFixture(): Promise<Issue101RealFixture> {
  const { master, context } = issue101Master()
  const engine = new ProductionRngEngine()
  const { fire, dragon } = createIssue101Targets()
  const targetWeapons = [fire, dragon]
  const ownedWeapons: OwnedGogmaArtianWeapon[] = []
  const fireCandidate = await searchIdeal(fire, targetWeapons, ownedWeapons, engine)
  const dragonCandidate = await searchIdeal(dragon, targetWeapons, ownedWeapons, engine)
  const fireEntry = createBuildListEntry(fireCandidate, fire, { createdAt: FIXTURE_TIME })
  const dragonEntry = createBuildListEntry(dragonCandidate, dragon, { createdAt: FIXTURE_TIME })
  const plannerInput: PlannerInput = {
    rngState: createIssue101RngState(),
    normalCounters: [createIssue101NormalCounter()],
    ownedWeapons: structuredClone(ownedWeapons),
    targetWeapons,
    buildListEntries: [fireEntry, dragonEntry],
    calculationContext: { ...context },
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: master.weaponBonusDefinitions,
      weaponTypes: master.weaponTypes,
      elements: master.elements,
      bonusTypes: master.bonusTypes,
      bonusRanks: master.bonusRanks,
      artianBonusTypeMappings: master.artianBonusTypeMappings,
      materialCosts: master.materialCosts,
    },
    conflictResolutions: [],
  }
  const prepared = preparePlannerInitialContext(
    plannerInput,
    createProductionPlannerDependencies(engine),
  )
  if (prepared.status !== 'ready') {
    throw new Error('Issue #101 fixture: the Planner input is not ready.')
  }
  return {
    fireCandidate,
    dragonCandidate,
    fireEntry,
    dragonEntry,
    plannerInput,
    initialConflicts: structuredClone(prepared.context.initialConflictDetection.conflicts),
  }
}

/**
 * Production benchmark fixture only: the Search origin and the Target of an
 * Ideal no extent can reach.
 */
export function createIssue101NoIdealSearchOrigin(): {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
} {
  const { master } = issue101Master()
  const target = createTarget(
    'target.issue101.no_ideal' as TargetWeaponId,
    'Issue #101 benchmark: unreachable Ideal',
    FIRE,
    ISSUE_101_UNREACHABLE_IDEAL_BONUSES,
    master,
  )
  return {
    origin: createIssue101SearchOrigin([target]),
    targetWeaponId: target.id,
  }
}
