import { createBuildListEntry } from '../domain/buildList'
import { V1_NORMAL_ARTIAN_RARITY } from '../domain/models/publicTypes'
import type {
  BuildCandidate,
  BuildListEntry,
  ElementId,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  PlanConflict,
  RestorationBonusSet,
  RngState,
  SkillCondition,
  TargetWeapon,
  TargetWeaponId,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  createProductionPlannerDependencies,
  defaultPlannerOptions,
  preparePlannerInitialContext,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeTrialBounds,
  type PlannerInput,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  searchCandidates,
  type CandidateSearchSettings,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  ISSUE_101_BASE_SEED,
  ISSUE_101_GOGMA_COUNTER,
  ISSUE_101_SKILL_COUNTER,
  ISSUE_101_WEAPON_TYPE_ID,
} from './issue101ConstrainedResearchFixtures'
import {
  assertPlannerAlternativeBenchmarkExtent,
  assertPlannerAlternativeBenchmarkTrialBounds,
  benchmarkMaster,
  PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
} from './plannerAlternativeBenchmarkFixtures'

/**
 * Planner Alternative Phase 3-A **rerun-pressure** fixture: a Kernel workload
 * whose outcome depends on the shared `maxPlannerReruns` budget
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md` 5.4).
 *
 * **synthetic Production benchmark fixture** - not a game observation. Every
 * weapon value and Ideal is a `ProductionRngEngine` prediction made while the
 * fixture is built, every Candidate comes from the unmodified `searchCandidates()`,
 * every Entry from `createBuildListEntry()`, and every conflict key from
 * `preparePlannerInitialContext()`. Nothing is mocked: the Kernel runs the
 * Production Search, materializer, preflight, full Planner run and Trace
 * Replay.
 *
 * Shape (Charge Blade, Base Seed 51231782, Skill origin 341, Gogma origin 55,
 * no Normal Counter; the Skill and Gogma Counters are shared by every weapon):
 *
 * - Target **A** (Dragon, priority 5, fixed by the decision): an unprotected
 *   owned Dragon Gogma whose Ideal needs one Reset Skills at Skill 341 and the
 *   Reset result at Gogma 55 (A's final, blocked Reset).
 * - Targets **B** and **C** (Fire, priority 1): each an owned rarity-8 Fire
 *   Normal whose Ideal is the Fire Reset result at Gogma 56 (no Skill
 *   condition). Each canonical Route converts at Skill 341 and Resets at 55 and
 *   56, so A, B and C share one `same_skill_counter` conflict at Skill 341. A's
 *   Dragon Gogma is not a compatible source for a Fire Target.
 *
 * The decision "prefer A on the Skill 341 conflict" (the real conflict ID)
 * makes B and C the non-fixed participants the Kernel works on, in its own
 * stable work order. Each needs one full Planner run for its first Candidate
 * trial, so the one `maxPlannerReruns` budget of the Kernel run decides
 * whether the second Target is evaluated at all.
 */


const WEAPON_TYPE = ISSUE_101_WEAPON_TYPE_ID as WeaponTypeId
/** A's element. A different element keeps A's owned Gogma out of the non-fixed Targets' source set. */
const FIXED_ELEMENT = 'element.dragon' as ElementId
const NON_FIXED_ELEMENT = 'element.fire' as ElementId
const SKILL_ORIGIN = ISSUE_101_SKILL_COUNTER
const GOGMA_ORIGIN = ISSUE_101_GOGMA_COUNTER
/** Where the owned weapons' own values are predicted: far from every Route position. */
const OWN_VALUE_COUNTER_START = 5_000
const OWN_NORMAL_COUNTER_START = 900

/**
 * The settings the fixture Candidates are searched with: the current
 * recommended initial values (Issue #125), written out so a later default
 * change cannot silently redefine the fixture.
 */
const FIXTURE_SEARCH_SETTINGS: CandidateSearchSettings = {
  maxNormalAdvance: 350,
  maxGogmaAdvance: 500,
  maxSkillAdvance: 1500,
}

/**
 * Benchmark-only sanity extent of the rerun-pressure workload: the conversion
 * window 341..342 and Gogma 55..94. Not a Production default.
 */
export const BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT: PlannerAlternativeSearchExtent = {
  maxNormalAdvance: 1,
  maxGogmaAdvance: 40,
  maxSkillAdvance: 1,
}

/**
 * Benchmark-only trial bound of the rerun sweep: large enough that the trial
 * cap never stops B or C before their first trial. Not a Production default.
 */
export const BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS = 8

export interface PlannerAlternativeRerunPressureFixture {
  readonly plannerInput: PlannerInput
  readonly initialConflicts: readonly PlanConflict[]
  /** Target A's Entry: the decision's fixed side. */
  readonly fixedEntry: BuildListEntry
  /** B's and C's Entries, in Target ID order. */
  readonly nonFixedEntries: readonly BuildListEntry[]
  readonly candidates: readonly BuildCandidate[]
}

type PredictedSkills = { seriesSkillId: SkillCondition['seriesSkillId']; groupSkillId: SkillCondition['groupSkillId'] }

interface Predictions {
  skillsAt(skillCounter: number): PredictedSkills
  resetAt(gogmaCounter: number): RestorationBonusSet
  normalAt(normalCounter: number): RestorationBonusSet
}

function predictions(elementId: ElementId): Predictions {
  const { master } = benchmarkMaster()
  const engine = new ProductionRngEngine()
  return {
    skillsAt: (skillCounter) => engine.predictSkills({
      baseSeed: ISSUE_101_BASE_SEED, skillCounter, weaponTypeId: WEAPON_TYPE, elementId, master,
    }),
    resetAt: (gogmaCounter) => engine.predictGogmaBonus({
      baseSeed: ISSUE_101_BASE_SEED, gogmaCounter, weaponTypeId: WEAPON_TYPE, elementId,
      operation: { type: 'reset_bonuses' }, master,
    }),
    normalAt: (normalCounter) => engine.predictNormalArtian({
      baseSeed: ISSUE_101_BASE_SEED, weaponTypeId: WEAPON_TYPE, elementId,
      rarity: V1_NORMAL_ARTIAN_RARITY, normalCounter, master,
    }),
  }
}

function multisetKey(bonuses: RestorationBonusSet): string {
  return bonuses.map(({ bonusTypeId, bonusRankId }) => `${bonusTypeId}:${bonusRankId}`).sort().join('|')
}

function rngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 2,
    baseSeed: { value: ISSUE_101_BASE_SEED, isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: GOGMA_ORIGIN, isConfirmed: true, source: 'observation' },
    skillCounter: { value: SKILL_ORIGIN, isConfirmed: true, source: 'observation' },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    lastIdentifiedAt: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
}

function target(
  id: string,
  name: string,
  elementId: ElementId,
  priority: TargetWeapon['priority'],
  idealBonuses: RestorationBonusSet,
  skills: SkillCondition,
): TargetWeapon {
  const value: TargetWeapon = {
    id: id as TargetWeaponId,
    name,
    weaponTypeId: WEAPON_TYPE,
    elementId,
    priority,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    lifecycleStatus: 'active',
    completedAt: null,
    completedByProductionPlanId: null,
    idealBonuses: structuredClone(idealBonuses),
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: skills,
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
  const containment = validateTargetIdealImpliesPractical(value, benchmarkMaster().master)
  if (!containment.isValid) throw new Error(`Rerun-pressure fixture Target '${id}' violates Ideal implies Practical.`)
  return value
}

function ownedGogma(id: string, elementId: ElementId, bonuses: RestorationBonusSet, skills: PredictedSkills): OwnedGogmaArtianWeapon {
  return {
    id: id as OwnedWeaponId,
    kind: 'gogma',
    name: `Planner Alternative rerun-pressure benchmark: ${id} (synthetic)`,
    weaponTypeId: WEAPON_TYPE,
    elementId,
    restorationBonuses: structuredClone(bonuses),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
    status: 'unclassified',
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
}

function ownedNormal(id: string, elementId: ElementId, bonuses: RestorationBonusSet): OwnedNormalArtianWeapon {
  return {
    id: id as OwnedWeaponId,
    kind: 'normal',
    name: `Planner Alternative rerun-pressure benchmark: ${id} (synthetic)`,
    weaponTypeId: WEAPON_TYPE,
    elementId,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    restorationBonuses: structuredClone(bonuses),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
}

const ANY_SKILL: SkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }

/**
 * Builds the rerun-pressure workload with the current Production authorities.
 * It runs one real Candidate Search per Target, so callers cache it.
 */
export async function createPlannerAlternativeRerunPressureFixture(): Promise<PlannerAlternativeRerunPressureFixture> {
  const { master, context } = benchmarkMaster()
  const predict = predictions(FIXED_ELEMENT)
  const predictNonFixed = predictions(NON_FIXED_ELEMENT)
  const aSkills = predict.skillsAt(SKILL_ORIGIN)
  const aIdeal = predict.resetAt(GOGMA_ORIGIN)
  const nonFixedIdeal = predictNonFixed.resetAt(GOGMA_ORIGIN + 1)

  // A's own values: the first predictions from 5000 that are not its Ideal.
  let ownCounter = OWN_VALUE_COUNTER_START
  let aOwnSkills = predict.skillsAt(ownCounter)
  while (aOwnSkills.seriesSkillId === aSkills.seriesSkillId && aOwnSkills.groupSkillId === aSkills.groupSkillId) {
    aOwnSkills = predict.skillsAt(++ownCounter)
  }
  ownCounter = OWN_VALUE_COUNTER_START
  let aOwnBonuses = predict.resetAt(ownCounter)
  while (multisetKey(aOwnBonuses) === multisetKey(aIdeal)) aOwnBonuses = predict.resetAt(++ownCounter)

  const fixed = target('target.pa-rerun.a', 'Planner Alternative rerun-pressure benchmark: A (fixed)', FIXED_ELEMENT, 5, aIdeal,
    { ...aSkills, matchMode: 'all' })
  const nonFixedIds = ['b', 'c']
  const nonFixed = nonFixedIds.map((suffix) =>
    target(`target.pa-rerun.${suffix}`, `Planner Alternative rerun-pressure benchmark: ${suffix.toUpperCase()}`, NON_FIXED_ELEMENT, 1, nonFixedIdeal, ANY_SKILL))
  const ownedWeapons: OwnedWeapon[] = [
    ownedGogma('owned.pa-rerun.a', FIXED_ELEMENT, aOwnBonuses, aOwnSkills),
    ...nonFixedIds.map((suffix, index) =>
      ownedNormal(`owned.pa-rerun.${suffix}`, NON_FIXED_ELEMENT, predictNonFixed.normalAt(OWN_NORMAL_COUNTER_START + index))),
  ]
  const targetWeapons = [fixed, ...nonFixed]

  const engine = new ProductionRngEngine()
  const candidates: BuildCandidate[] = []
  const entries: BuildListEntry[] = []
  for (const value of targetWeapons) {
    const result = await searchCandidates({
      searchRunId: 'planner-alternative-rerun-pressure',
      targetWeaponId: value.id,
      routeFilter: 'all',
      rngState: rngState(),
      normalCounters: [],
      ownedWeapons: structuredClone(ownedWeapons),
      targetWeapons: structuredClone(targetWeapons),
      settings: { ...FIXTURE_SEARCH_SETTINGS },
      master,
      calculationContext: { ...context },
    }, engine)
    const candidate = result.targetResult.candidate
    if (candidate === null) throw new Error(`Rerun-pressure fixture: Candidate Search found no Ideal for '${value.id}'.`)
    candidates.push(candidate)
    entries.push(createBuildListEntry(candidate, value, { createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME }))
  }
  const plannerInput: PlannerInput = {
    rngState: rngState(),
    normalCounters: [],
    ownedWeapons: structuredClone(ownedWeapons),
    targetWeapons: structuredClone(targetWeapons),
    buildListEntries: structuredClone(entries),
    calculationContext: { ...context },
    options: { ...defaultPlannerOptions },
    master: structuredClone(master),
    conflictResolutions: [],
  }
  const prepared = preparePlannerInitialContext(plannerInput, createProductionPlannerDependencies(engine))
  if (prepared.status !== 'ready') throw new Error('Rerun-pressure fixture: the Planner input is not ready.')
  return {
    plannerInput,
    initialConflicts: structuredClone(prepared.context.initialConflictDetection.conflicts),
    fixedEntry: entries[0],
    nonFixedEntries: entries.slice(1),
    candidates,
  }
}

/**
 * The Kernel request of the rerun-pressure workload: "prefer A on the conflict
 * at Skill 341", built from the conflict the Planner itself reported (never a
 * hard-coded key) and A's real Entry. Extent and bounds are the caller's.
 */
export function createPlannerAlternativeRerunPressureKernelRequest(
  fixture: PlannerAlternativeRerunPressureFixture,
  extent: PlannerAlternativeSearchExtent,
  bounds: PlannerAlternativeTrialBounds,
): PlannerAlternativeKernelRequest {
  assertPlannerAlternativeBenchmarkExtent(extent)
  assertPlannerAlternativeBenchmarkTrialBounds(bounds)
  const conflicts = fixture.initialConflicts.filter(({ kind, buildListEntryIds }) =>
    kind === 'same_skill_counter' && buildListEntryIds.includes(fixture.fixedEntry.id))
  if (conflicts.length !== 1) {
    throw new Error(`Rerun-pressure fixture: expected exactly one Skill conflict with A, found ${conflicts.length}.`)
  }
  return {
    plannerInput: structuredClone(fixture.plannerInput),
    decision: { conflictKey: conflicts[0].id, selectedBuildListEntryId: fixture.fixedEntry.id },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { ...extent },
    bounds: { ...bounds },
  }
}
