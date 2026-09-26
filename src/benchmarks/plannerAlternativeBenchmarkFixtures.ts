import { loadMasterData } from '../domain/master/loadMasterData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
} from '../domain/models/publicTypes'
import type {
  ElementId,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  RngState,
  SkillCondition,
  TargetWeapon,
  TargetWeaponId,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import {
  assertPlannerAlternativeTrialBounds,
  createConstrainedSearchOriginFromPlannerInput,
  derivePlannerAlternativeReservation,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeTrialBounds,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  candidateStableKey,
  emptyPlannerAlternativeReservation,
  validatePlannerAlternativeSearchExtent,
  type ConstrainedSearchOrigin,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
  type PlannerAlternativeSearchInput,
  type SearchMasterSubset,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  createIssue101NoIdealEnumerationInput,
  createIssue101RealFixture,
  ISSUE_101_BASE_SEED,
  ISSUE_101_BASELINE_BOUNDS,
  ISSUE_101_GOGMA_COUNTER,
  ISSUE_101_SKILL_COUNTER,
  ISSUE_101_WEAPON_TYPE_ID,
  type Issue101RealFixture,
} from './issue101ConstrainedResearchFixtures'

/**
 * Planner Alternative Search Phase 3-A benchmark fixtures
 * (`docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`).
 *
 * Three kinds of fixture live here and are kept apart on purpose:
 *
 * - **Issue #101 real case**: `createIssue101RealFixture()` unchanged - the
 *   Issue's RNG state and Ideal, both Candidates from the unmodified current
 *   Candidate Search, the conflict keys from the Planner itself. The Search
 *   workload derives the Dragon-fixed reservation with the Planner authority
 *   (`derivePlannerAlternativeReservation()`), excludes the Fire current Route
 *   by `candidateStableKey()`, and never hands a Conflict DTO to the Search
 *   Domain. The Kernel workload builds its decision from the real initial
 *   `same_normal_counter` conflict ID, never a hard-coded one.
 * - **no-Ideal worst case**: the existing Issue #101 Production benchmark
 *   fixture (three 属性強化EX, which the exact-ID repeat penalty makes
 *   undrawable), searched to the end of the extent.
 * - **synthetic Production benchmark fixture** (`long_skill_held` /
 *   `long_gogma_held`): not a game observation. Every weapon value and Ideal
 *   is a `ProductionRngEngine` prediction made while the fixture is built; the
 *   held run is a synthetic reservation that stands for a fixed Route holding
 *   `heldLength` consecutive positions from the origin. The Ideal comes from a
 *   fixed benchmark-only anchor position, so a held-length sweep changes only
 *   the reservation.
 *
 * Fixture construction runs before a measurement (the Issue #101 fixture runs
 * two real Candidate Searches) and is never timed. Every value returned is a
 * fresh structured clone, so no run can mutate a cached fixture.
 *
 * Every `BENCHMARK_ONLY_*` value is a measurement grid for Phase 3-B, never a
 * Production default. Phase 3-C decided those from the real Browser Worker
 * measurements in the Search / Planner Domain authorities
 * (`docs/PLANNER_SPEC.md` 9.2.19.12 / 9.2.19.16); these grids and sanity values
 * stay unchanged as the historical Phase 3-B measurement conditions.
 */

export const PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME = '2026-09-26T00:00:00.000Z'

/** Benchmark-only extent measurement grid. Not a Production default. */
export const BENCHMARK_ONLY_EXTENT_GRID = {
  normal: [1, 4, 16, 40, 80],
  /** Keeps 235: the Issue #101 Fire alternative needs Gogma 56..289 (origin 55). */
  gogma: [30, 60, 120, 180, 220, 235, 240, 300, 350],
  skill: [1, 2, 4, 8, 16, 32, 64],
} as const

/** Benchmark-only Candidate trial grid. Not a Production default. */
export const BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID = [1, 2, 3, 4, 8] as const

/** Benchmark-only full Planner rerun grid. Not a Production default. */
export const BENCHMARK_ONLY_PLANNER_RERUN_GRID = [1, 2, 3, 4, 8, 16] as const

/** Benchmark-only held run length grid of the synthetic long-held fixtures. */
export const BENCHMARK_ONLY_HELD_LENGTH_GRID = [1, 8, 32, 128, 512] as const

/**
 * The Phase 2 acceptance extent of the Issue #101 Kernel (Normal target offset
 * 0 only, the conversion window 341..342, Gogma 55..294): a sanity value that
 * is known to reach the Fire alternative. Benchmark-only, not a default.
 */
export const BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT: PlannerAlternativeSearchExtent = {
  maxNormalAdvance: 1,
  maxGogmaAdvance: 240,
  maxSkillAdvance: 1,
}

/** The Phase 2 acceptance trial bounds, as a sanity value. Benchmark-only, not a default. */
export const BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS: PlannerAlternativeTrialBounds = {
  maxCandidateTrialsPerTarget: 3,
  maxPlannerReruns: 3,
}

export type PlannerAlternativeSearchWorkloadId =
  | 'issue101_fire_dragon_fixed'
  | 'issue101_no_ideal'
  | 'issue101_no_ideal_dragon_fixed'
  | 'long_skill_held'
  | 'long_gogma_held'

/**
 * `issue101_prefer_dragon_normal`: the Issue #101 real case (found path, one
 * trial). `kernel_multi_target`: the synthetic rerun-pressure fixture of
 * `plannerAlternativeRerunPressureFixtures.ts`, two non-fixed Targets sharing
 * one `maxPlannerReruns` budget.
 */
export type PlannerAlternativeKernelWorkloadId = 'issue101_prefer_dragon_normal' | 'kernel_multi_target'

export const PLANNER_ALTERNATIVE_SEARCH_WORKLOADS: readonly PlannerAlternativeSearchWorkloadId[] = [
  'issue101_fire_dragon_fixed',
  'issue101_no_ideal',
  'issue101_no_ideal_dragon_fixed',
  'long_skill_held',
  'long_gogma_held',
]

export const PLANNER_ALTERNATIVE_KERNEL_WORKLOADS: readonly PlannerAlternativeKernelWorkloadId[] = [
  'issue101_prefer_dragon_normal',
  'kernel_multi_target',
]

/**
 * `held`: every held position is also a legal own operation position (held,
 * not blocked), the worst case for the held-aware state growth.
 * `held_blocked`: every held position is blocked too, so the run can only be
 * skipped (the Issue #101 Skill / Gogma shape, stretched).
 */
export type LongHeldMode = 'held' | 'held_blocked'

export interface LongHeldOptions {
  readonly heldLength: number
  readonly heldMode: LongHeldMode
}

function extentIssues(extent: PlannerAlternativeSearchExtent): string[] {
  if (extent === null || typeof extent !== 'object') return ['extent must be an object.']
  return validatePlannerAlternativeSearchExtent(extent).map(({ path, message }) => `${path}: ${message}`)
}

/**
 * Fails closed on an invalid or partial extent with the Search Domain
 * validator, before any Worker is created. Nothing is completed, clamped or
 * defaulted.
 */
export function assertPlannerAlternativeBenchmarkExtent(extent: PlannerAlternativeSearchExtent): void {
  const issues = extentIssues(extent)
  if (issues.length > 0) throw new RangeError(`Invalid PlannerAlternativeSearchExtent: ${issues.join(' / ')}`)
}

/** Fails closed on invalid trial bounds with the Planner Domain validator. */
export function assertPlannerAlternativeBenchmarkTrialBounds(bounds: PlannerAlternativeTrialBounds): void {
  if (bounds === null || typeof bounds !== 'object') throw new RangeError('Invalid PlannerAlternativeTrialBounds: bounds must be an object.')
  assertPlannerAlternativeTrialBounds(bounds)
}

export function assertLongHeldOptions(options: LongHeldOptions): void {
  if (!Number.isInteger(options.heldLength) || options.heldLength < 1) {
    throw new RangeError('heldLength must be an integer greater than or equal to 1.')
  }
  if (options.heldMode !== 'held' && options.heldMode !== 'held_blocked') {
    throw new RangeError(`Unknown heldMode '${String(options.heldMode)}'.`)
  }
}

export type LongHeldWorkloadId = 'long_skill_held' | 'long_gogma_held'

/**
 * How far past the origin the long-held Ideal anchor stands: the largest held
 * length of the grid, so the anchor is the first position after the longest
 * held run of the series. Benchmark-only, never a Production default.
 */
export const BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET = 512

/**
 * The fixed anchor positions the long-held Target Ideals are predicted at
 * (Skill origin 341 / Gogma origin 55 plus the offset). The Ideal is decided
 * once per series from these positions and never follows the held length.
 */
export const BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION = ISSUE_101_SKILL_COUNTER + BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET
export const BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION = ISSUE_101_GOGMA_COUNTER + BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET

/**
 * The one extent of a held-length scaling series (both long-held workloads):
 * its Skill / Gogma window `origin .. origin + 512` covers every held run of
 * the grid and the Ideal anchor. A scaling comparison keeps it fixed across
 * every held length; only the reservation changes. Benchmark-only.
 */
export const BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT: PlannerAlternativeSearchExtent = {
  maxNormalAdvance: 1,
  maxGogmaAdvance: BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET + 1,
  maxSkillAdvance: BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET + 1,
}

/**
 * The fixed part of one long-held comparison series: where its Ideal is
 * predicted. Everything else of the fixture is fixed by construction; only
 * `LongHeldOptions` (the reservation) varies inside a series.
 */
export interface LongHeldSeries {
  readonly idealPosition: number
}

export function defaultLongHeldSeries(workload: LongHeldWorkloadId): LongHeldSeries {
  return {
    idealPosition: workload === 'long_skill_held'
      ? BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION
      : BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION,
  }
}

// ---------------------------------------------------------------------------
// Issue #101 real case
// ---------------------------------------------------------------------------

/**
 * The Issue #101 Search workload: Dragon fixed, the Fire Target searched under
 * Dragon's reservation with the Fire current Route excluded. Everything comes
 * from the Planner / Search authorities over the real fixture.
 */
export function createIssue101DragonFixedSearchInput(
  fixture: Issue101RealFixture,
  extent: PlannerAlternativeSearchExtent,
): PlannerAlternativeSearchInput {
  assertPlannerAlternativeBenchmarkExtent(extent)
  return {
    origin: createConstrainedSearchOriginFromPlannerInput(fixture.plannerInput),
    targetWeaponId: fixture.fireEntry.targetWeaponId,
    extent: { ...extent },
    reservation: createIssue101DragonReservation(fixture),
    excludedRouteKeys: [candidateStableKey(fixture.fireEntry.candidateSnapshot)],
  }
}

/** Dragon's resource reservation, derived by the Planner authority. */
export function createIssue101DragonReservation(fixture: Issue101RealFixture): PlannerAlternativeReservation {
  return derivePlannerAlternativeReservation([structuredClone(fixture.dragonEntry)], new ProductionRngEngine())
}

/**
 * The Issue #101 Kernel workload: "prefer Dragon on the Normal conflict", built
 * from the conflict ID the Planner itself reported for the real fixture.
 */
export function createIssue101KernelRequest(
  fixture: Issue101RealFixture,
  extent: PlannerAlternativeSearchExtent,
  bounds: PlannerAlternativeTrialBounds,
): PlannerAlternativeKernelRequest {
  assertPlannerAlternativeBenchmarkExtent(extent)
  assertPlannerAlternativeBenchmarkTrialBounds(bounds)
  const normal = fixture.initialConflicts.filter(({ kind }) => kind === 'same_normal_counter')
  if (normal.length !== 1) {
    throw new Error(`Issue #101 fixture: expected exactly one Normal conflict, found ${normal.length}.`)
  }
  if (!normal[0].buildListEntryIds.includes(fixture.dragonEntry.id)) {
    throw new Error(`Issue #101 fixture: conflict '${normal[0].id}' has no Dragon participant.`)
  }
  return {
    plannerInput: structuredClone(fixture.plannerInput),
    decision: { conflictKey: normal[0].id, selectedBuildListEntryId: fixture.dragonEntry.id },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { ...extent },
    bounds: { ...bounds },
  }
}

// ---------------------------------------------------------------------------
// no-Ideal worst case
// ---------------------------------------------------------------------------

/**
 * The no-Ideal workload: the existing Issue #101 unreachable-Ideal fixture
 * (origin and Target from `createIssue101NoIdealEnumerationInput()`, whose
 * constrained bounds argument only satisfies that helper and is discarded),
 * searched by Planner Alternative Search under the given reservation.
 */
export function createIssue101NoIdealSearchInput(
  extent: PlannerAlternativeSearchExtent,
  reservation: PlannerAlternativeReservation = emptyPlannerAlternativeReservation,
): PlannerAlternativeSearchInput {
  assertPlannerAlternativeBenchmarkExtent(extent)
  const { origin, targetWeaponId } = createIssue101NoIdealEnumerationInput(ISSUE_101_BASELINE_BOUNDS)
  return {
    origin,
    targetWeaponId,
    extent: { ...extent },
    reservation: structuredClone(reservation),
    excludedRouteKeys: [],
  }
}

// ---------------------------------------------------------------------------
// synthetic Production benchmark fixture: long held runs
// ---------------------------------------------------------------------------

const LONG_HELD_ELEMENT = 'element.fire' as ElementId
const LONG_HELD_WEAPON_ID = 'owned.planner-alternative-benchmark.long-held' as OwnedWeaponId
const LONG_HELD_TARGET_ID = 'target.planner-alternative-benchmark.long-held' as TargetWeaponId
/** Where the owned Gogma's own values are predicted: far from every held run. */
const LONG_HELD_OWNED_SKILL_COUNTER_START = 5_000
const LONG_HELD_OWNED_GOGMA_COUNTER_START = 5_000

export interface BenchmarkMaster {
  readonly master: SearchMasterSubset
  readonly context: ConstrainedSearchOrigin['calculationContext']
}

let cachedMaster: BenchmarkMaster | null = null

/** The Production Master subset and CalculationContext every synthetic benchmark fixture uses. */
export function benchmarkMaster(): BenchmarkMaster {
  if (cachedMaster !== null) return cachedMaster
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(`Master Data is invalid: ${JSON.stringify(loaded.issues)}`)
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

function sameSkills(left: SkillCondition, right: { seriesSkillId: unknown; groupSkillId: unknown }): boolean {
  return left.seriesSkillId === right.seriesSkillId && left.groupSkillId === right.groupSkillId
}

function multisetKey(bonuses: RestorationBonusSet): string {
  return bonuses.map(({ bonusTypeId, bonusRankId }) => `${bonusTypeId}:${bonusRankId}`).sort().join('|')
}

function longHeldRngState(stream: 'skill' | 'gogma'): RngState {
  // Only the stream under measurement is confirmed, so no other Route kind
  // (conversion needs the Skill Counter, the blind forced Reset Route both)
  // adds work the fixture does not mean to measure.
  return {
    id: 'current',
    schemaVersion: 2,
    baseSeed: { value: ISSUE_101_BASE_SEED, isConfirmed: true, source: 'observation' },
    gogmaCounter: stream === 'gogma'
      ? { value: ISSUE_101_GOGMA_COUNTER, isConfirmed: true, source: 'observation' }
      : { value: null, isConfirmed: false, source: null },
    skillCounter: stream === 'skill'
      ? { value: ISSUE_101_SKILL_COUNTER, isConfirmed: true, source: 'observation' }
      : { value: null, isConfirmed: false, source: null },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    lastIdentifiedAt: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
}

function heldRun(origin: number, options: LongHeldOptions) {
  const held = Array.from({ length: options.heldLength }, (_, index) => origin + index)
  return { held, blocked: options.heldMode === 'held_blocked' ? [...held] : [] }
}

export interface LongHeldFixture {
  readonly input: PlannerAlternativeSearchInput
  /** The series' fixed anchor position the Ideal is predicted at. */
  readonly idealPosition: number
  readonly heldPositions: readonly number[]
  readonly blockedPositions: readonly number[]
}

/**
 * Synthetic Production benchmark fixture: one unprotected owned Charge Blade
 * (Fire) Gogma and a Target whose Ideal only one stream can still change.
 *
 * - `long_skill_held`: the Gogma's five `gogma_artian` slots are the Production
 *   Reset prediction at Gogma 5000 and are the Target's Ideal (so no Bonus
 *   work exists); the Target's Ideal Skills are the Production Skill
 *   prediction at the series anchor (`BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION`
 *   = 853 by default). The held Skill run is `341 .. 341 + heldLength - 1`.
 *   The Gogma Counter is unconfirmed.
 * - `long_gogma_held`: the Gogma's Skills are the Production Skill prediction
 *   at Skill 5000 and are the Target's Ideal (so no Skill work exists); the
 *   Target's Ideal five slots are the Production Reset prediction at the
 *   series anchor (`BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION` = 567 by
 *   default). The held Gogma run is `55 .. 55 + heldLength - 1`. The Skill
 *   Counter is unconfirmed.
 *
 * The owned weapon's other value is the first Production prediction at or
 * after 5000 that does not already satisfy the Ideal, so a zero-operation
 * Candidate never short-cuts the run. Nothing is hand-written.
 *
 * Inside one series (same `workload`, `series` and extent) the Target, its
 * Ideal, the OwnedWeapon, the RNG origin, the Normal Counters and the
 * CalculationContext are identical whatever `options` say: `heldLength` changes
 * only the held positions of the measured stream, and `heldMode` only its
 * blocked positions. Whether a Candidate is reachable may differ by held
 * length; that is part of what a scaling series measures. `series` exists so a
 * test can use a short series; the benchmark page and console use the default.
 */
export function createLongHeldFixture(
  workload: LongHeldWorkloadId,
  options: LongHeldOptions,
  extent: PlannerAlternativeSearchExtent,
  series: LongHeldSeries = defaultLongHeldSeries(workload),
): LongHeldFixture {
  assertLongHeldOptions(options)
  assertPlannerAlternativeBenchmarkExtent(extent)
  if (!Number.isInteger(series.idealPosition) || series.idealPosition < 0) {
    throw new RangeError('series.idealPosition must be a non-negative integer.')
  }
  const { master, context } = benchmarkMaster()
  const engine = new ProductionRngEngine()
  const weaponTypeId = ISSUE_101_WEAPON_TYPE_ID as WeaponTypeId
  const predictSkills = (skillCounter: number) => engine.predictSkills({
    baseSeed: ISSUE_101_BASE_SEED, skillCounter, weaponTypeId, elementId: LONG_HELD_ELEMENT, master,
  })
  const predictReset = (gogmaCounter: number) => engine.predictGogmaBonus({
    baseSeed: ISSUE_101_BASE_SEED, gogmaCounter, weaponTypeId, elementId: LONG_HELD_ELEMENT,
    operation: { type: 'reset_bonuses' }, master,
  })

  const stream = workload === 'long_skill_held' ? 'skill' : 'gogma'
  const origin = stream === 'skill' ? ISSUE_101_SKILL_COUNTER : ISSUE_101_GOGMA_COUNTER
  const { idealPosition } = series
  const run = heldRun(origin, options)

  let idealBonuses: RestorationBonusSet
  let idealSkills: SkillCondition
  let ownedBonuses: RestorationBonusSet
  let ownedSkills: { seriesSkillId: SkillCondition['seriesSkillId']; groupSkillId: SkillCondition['groupSkillId'] }
  if (stream === 'skill') {
    idealBonuses = predictReset(LONG_HELD_OWNED_GOGMA_COUNTER_START)
    ownedBonuses = structuredClone(idealBonuses)
    const ideal = predictSkills(idealPosition)
    idealSkills = { seriesSkillId: ideal.seriesSkillId, groupSkillId: ideal.groupSkillId, matchMode: 'all' }
    let counter = LONG_HELD_OWNED_SKILL_COUNTER_START
    let owned = predictSkills(counter)
    while (sameSkills(idealSkills, owned)) owned = predictSkills(++counter)
    ownedSkills = { seriesSkillId: owned.seriesSkillId, groupSkillId: owned.groupSkillId }
  } else {
    idealBonuses = predictReset(idealPosition)
    const skills = predictSkills(LONG_HELD_OWNED_SKILL_COUNTER_START)
    idealSkills = { seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId, matchMode: 'all' }
    ownedSkills = { seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId }
    let counter = LONG_HELD_OWNED_GOGMA_COUNTER_START
    ownedBonuses = predictReset(counter)
    while (multisetKey(ownedBonuses) === multisetKey(idealBonuses)) ownedBonuses = predictReset(++counter)
  }

  const target: TargetWeapon = {
    id: LONG_HELD_TARGET_ID,
    name: `Planner Alternative benchmark: ${workload} (Ideal @ ${idealPosition})`,
    weaponTypeId,
    elementId: LONG_HELD_ELEMENT,
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    lifecycleStatus: 'active',
    completedAt: null,
    completedByProductionPlanId: null,
    idealBonuses,
    practicalBonusConditions: [],
    alternativeBonusRules: [],
    idealSkillCondition: idealSkills,
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
  const containment = validateTargetIdealImpliesPractical(target, master)
  if (!containment.isValid) {
    throw new Error(`Long-held fixture Target violates Ideal implies Practical: ${JSON.stringify(containment.issues)}`)
  }
  const owned: OwnedGogmaArtianWeapon = {
    id: LONG_HELD_WEAPON_ID,
    kind: 'gogma',
    name: 'Planner Alternative benchmark: owned Gogma (synthetic)',
    weaponTypeId,
    elementId: LONG_HELD_ELEMENT,
    restorationBonuses: ownedBonuses,
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: ownedSkills.seriesSkillId,
    groupSkillId: ownedSkills.groupSkillId,
    status: 'unclassified',
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
    updatedAt: PLANNER_ALTERNATIVE_BENCHMARK_FIXTURE_TIME,
  }
  const reservation: PlannerAlternativeReservation = {
    normal: [],
    skill: stream === 'skill' ? run : { held: [], blocked: [] },
    gogma: stream === 'gogma' ? run : { held: [], blocked: [] },
    exclusiveOwnedWeaponIds: [],
  }
  return {
    input: {
      origin: {
        rngState: longHeldRngState(stream),
        normalCounters: [],
        ownedWeapons: [owned],
        targetWeapons: [target],
        master: structuredClone(master),
        calculationContext: { ...context },
      },
      targetWeaponId: target.id,
      extent: { ...extent },
      reservation,
      excludedRouteKeys: [],
    },
    idealPosition,
    heldPositions: run.held,
    blockedPositions: run.blocked,
  }
}

// ---------------------------------------------------------------------------
// One entry point per workload
// ---------------------------------------------------------------------------

export interface PlannerAlternativeSearchWorkloadOptions {
  readonly workload: PlannerAlternativeSearchWorkloadId
  readonly extent: PlannerAlternativeSearchExtent
  /** Required by the long-held workloads, refused by the others. */
  readonly longHeld?: LongHeldOptions
}

/**
 * Builds the Search input of one workload. The Issue #101 real fixture must be
 * built (and cached) by the caller beforehand; it is needed by the Dragon-fixed
 * workloads only.
 */
export function createPlannerAlternativeSearchWorkloadInput(
  options: PlannerAlternativeSearchWorkloadOptions,
  issue101: Issue101RealFixture | null,
): PlannerAlternativeSearchInput {
  const longHeldWorkload = options.workload === 'long_skill_held' || options.workload === 'long_gogma_held'
  if (longHeldWorkload !== (options.longHeld !== undefined)) {
    throw new RangeError(longHeldWorkload
      ? `Workload '${options.workload}' requires longHeld options.`
      : `Workload '${options.workload}' takes no longHeld options.`)
  }
  const requireIssue101 = (): Issue101RealFixture => {
    if (issue101 === null) throw new Error(`Workload '${options.workload}' needs the Issue #101 real fixture.`)
    return issue101
  }
  switch (options.workload) {
    case 'issue101_fire_dragon_fixed':
      return createIssue101DragonFixedSearchInput(requireIssue101(), options.extent)
    case 'issue101_no_ideal':
      return createIssue101NoIdealSearchInput(options.extent)
    case 'issue101_no_ideal_dragon_fixed':
      return createIssue101NoIdealSearchInput(options.extent, createIssue101DragonReservation(requireIssue101()))
    case 'long_skill_held':
    case 'long_gogma_held':
      return createLongHeldFixture(options.workload, options.longHeld as LongHeldOptions, options.extent).input
  }
}

export function plannerAlternativeSearchWorkloadNeedsIssue101(workload: PlannerAlternativeSearchWorkloadId): boolean {
  return workload === 'issue101_fire_dragon_fixed' || workload === 'issue101_no_ideal_dragon_fixed'
}

export { createIssue101RealFixture }
export type { Issue101RealFixture }
