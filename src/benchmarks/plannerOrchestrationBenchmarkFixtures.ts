import { benchmarkPracticalBonuses } from './targetCompromiseFixture'
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  V1_NORMAL_ARTIAN_RARITY,
} from '../domain/models/publicTypes'
import type {
  BuildListEntry,
  BuildListEntryId,
  BuildRoute,
  CalculationContext,
  ElementId,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
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
import type {
  PlannerConflictResolution,
  PlannerInput,
  PlannerOrchestrationBounds,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  createCandidateFromPrediction,
  createSearchExecutionContext,
  defaultCandidateSearchSettings,
} from '../domain/search'
import type { CandidateSearchInput, SearchMasterSubset } from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  CONSTRAINED_BENCHMARK_BASE_SEED,
  CONSTRAINED_BENCHMARK_NORMAL_COUNTER,
  CONSTRAINED_BENCHMARK_SKILL_COUNTER,
} from './constrainedEnumerationBenchmarkFixtures'

/**
 * B8-E1 Planner orchestration Browser benchmark fixtures.
 *
 * Every workload is Production-valid: the RNG state constants are the B5 /
 * B8-B2 ones, and every restoration bonus set, Skill pair, and Candidate result
 * in a fixture comes from the unmodified `ProductionRngEngine`. No Fake Engine
 * is used anywhere, and no Candidate result is guessed or hand-written.
 *
 * How a fixture is built, in order:
 *
 * 1. `ProductionRngEngine` supplies the source weapons' five slots and Skills,
 *    and the Candidate result of each BuildListEntry's Route.
 * 2. `createCandidateFromPrediction()` - the ordinary Search Domain Candidate
 *    authority - classifies the result, derives the estimates and material
 *    requirements, computes `searchStateHash` / `referencedOwnedWeaponsHash`,
 *    and *validates* the Candidate. A fixture whose result satisfies neither
 *    the Ideal nor the Practical condition returns `null` there and is rejected
 *    by `createPlannerOrchestrationBenchmarkInput()` instead of being patched.
 * 3. `createBuildListEntry()` produces the ordinary persisted Entry shape, so
 *    every Entry is non-stale against the very state the Planner receives.
 * 4. `preparePlannerInitialContext()` - the existing Planner initial conflict
 *    authority - reports the real initial `PlanConflict`s, and the explicit
 *    `PlannerConflictResolution`s are built from those stable keys. No conflict
 *    key is ever hand-written, and `recommendedBuildListEntryId` is never used
 *    to pick the fixed side.
 *
 * The workloads deliberately share one RNG origin, because that is what a real
 * Planner run has: one Base Seed, one Gogma Counter, one Skill Counter, and one
 * Normal Artian counter per weapon type.
 */

export const PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED = CONSTRAINED_BENCHMARK_BASE_SEED
// Schema 6 fixture: Counters 117-119 share a Bow layout with different tiers.
export const PLANNER_ORCHESTRATION_BENCHMARK_GOGMA_COUNTER = 117
export const PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER =
  CONSTRAINED_BENCHMARK_SKILL_COUNTER
export const PLANNER_ORCHESTRATION_BENCHMARK_NORMAL_COUNTER =
  CONSTRAINED_BENCHMARK_NORMAL_COUNTER

const FIXTURE_TIME = '2026-09-08T00:00:00.000Z'
const FIXTURE_SEARCH_RUN_ID = 'b8-e1-benchmark-fixture'

/**
 * The Bonus and Skill positions the synthetic sources are drawn from.
 *
 * They are far outside every measured horizon, so a source's own five slots and
 * Skills are never reproduced by a cheap Route inside the enumeration bounds.
 */
const SOURCE_BONUS_SCAN_START = 500
const SOURCE_BONUS_SCAN_END = 900
const SOURCE_SKILL_SCAN_START = 800
const SOURCE_SKILL_SCAN_END = 900

/**
 * `bonus_type.attack` at `bonus_rank.i` is absent from the reference Gogma
 * Reset candidate pool, and every Normal Artian slot is `bonus_rank.base`, so
 * no reachable result carries it. `group_skill.verified_14` is enabled in
 * Master but absent from the reference Group Skill pool, so `predictSkills`
 * never returns it. Both facts are the same ones the B8-B2 fixtures rely on.
 *
 * An unreachable Ideal keeps every Target permanently improvable, which is what
 * a Planner benchmark wants: no Target drops out of planning because it is
 * already complete, and SEARCH_SPEC 5.6.1 never disables a stream.
 */
const PRACTICAL_BONUS_TYPE_ID = 'bonus_type.attack'

/**
 * How one Target's Practical condition is shaped, and therefore what its
 * BuildListEntry Route has to achieve.
 *
 * `bonus`: Practical is bonus-only. The source's own five slots deliberately
 * carry no `bonus_type.attack`, so the source does not already satisfy the
 * Target and a Bonus amendment (or a conversion, whose Normal-scope slots do
 * carry it) is required.
 *
 * `skill`: Practical additionally requires the Series Skill the Skill stream
 * produces at the starting Skill Counter. The source's five slots do carry
 * `bonus_type.attack`, and its Series Skill deliberately differs, so a Skill
 * operation is required.
 */
export type PlannerOrchestrationTargetFlavor = 'bonus' | 'skill'

/** The Route the workload's BuildListEntry for one Target carries. */
export type PlannerOrchestrationEntrySolution =
  | { readonly kind: 'reset_bonuses' }
  | { readonly kind: 'reset_skills' }
  | { readonly kind: 'convert'; readonly forgeCount: number }

export interface PlannerOrchestrationTargetSpec {
  readonly key: string
  readonly weaponTypeId: WeaponTypeId
  readonly elementId: ElementId
  readonly flavor: PlannerOrchestrationTargetFlavor
  readonly entry: PlannerOrchestrationEntrySolution
}

export type PlannerOrchestrationWorkloadGroup =
  | 'baseline'
  | 'early_adoption'
  | 'trial_pressure'
  | 'generated_cap'
  | 'combined'

export interface PlannerOrchestrationBenchmarkWorkload {
  readonly id: string
  readonly label: string
  readonly group: PlannerOrchestrationWorkloadGroup
  /**
   * `none` leaves `PlannerInput.conflictResolutions` empty, which is what makes
   * the ordinary baseline an ordinary Planner run: PLANNER_SPEC 9.2.7 forbids
   * running constrained re-search without an explicit resolution.
   *
   * `fix_lowest_entry_id` gives every detected initial conflict one explicit
   * resolution whose selected Entry is the participant with the lexicographically
   * smallest BuildListEntry ID. That is a fixture choice, made so a workload is
   * reproducible; it is not a Planner authority and never stands in for a user
   * decision in Production.
   */
  readonly conflictResolution: 'none' | 'fix_lowest_entry_id'
  readonly targets: readonly PlannerOrchestrationTargetSpec[]
  readonly note: string
}

const BOW = 'weapon.bow' as WeaponTypeId
const LONG_SWORD = 'weapon.long_sword' as WeaponTypeId
const FIRE = 'element.fire' as ElementId
const WATER = 'element.water' as ElementId
const THUNDER = 'element.thunder' as ElementId
const ICE = 'element.ice' as ElementId
const DRAGON = 'element.dragon' as ElementId

function targetSpec(
  key: string,
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
  flavor: PlannerOrchestrationTargetFlavor,
  entry: PlannerOrchestrationEntrySolution,
): PlannerOrchestrationTargetSpec {
  return { key, weaponTypeId, elementId, flavor, entry }
}

/**
 * A. The ordinary baseline.
 *
 * Two Targets whose Routes touch disjoint streams - one Gogma amendment at the
 * starting Gogma Counter, one conversion at the starting Normal and Skill
 * positions - so the initial Planner run detects no conflict at all, and no
 * explicit resolution exists. `createConstrainedPlan()` therefore performs
 * exactly one ordinary Production Planner run and stops: no enumeration, no
 * materialization, no preflight, no rerun, and no B8 orchestration warning.
 */
const baselineWorkload: PlannerOrchestrationBenchmarkWorkload = {
  id: 'orchestration_ordinary_baseline',
  label: 'A. Ordinary baseline (no fixed constraint)',
  group: 'baseline',
  conflictResolution: 'none',
  targets: [
    targetSpec('bow_fire', BOW, FIRE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_water', BOW, WATER, 'skill', { kind: 'reset_skills' }),
  ],
  note: 'Two Targets on disjoint streams; no conflict and no explicit resolution, so only the initial ordinary Planner run happens.',
}

/**
 * B. One counter conflict, resolved by an early Candidate.
 *
 * Both Targets want a Reset Bonuses at the starting Gogma Counter from their own
 * source, so exactly two BuildListEntries participate in one
 * `same_gogma_counter` conflict. The fixed side keeps that position; the
 * yielding Target's constrained re-search reaches a conversion Candidate, whose
 * later Reset Bonuses preserve its Ideal layout while relaxing ranks.
 * Earlier Counter prefixes can be passed by the fixed side.
 */
const earlyAdoptionWorkload: PlannerOrchestrationBenchmarkWorkload = {
  id: 'orchestration_single_conflict_early_adoption',
  label: 'B. One Gogma conflict, early adoption',
  group: 'early_adoption',
  conflictResolution: 'fix_lowest_entry_id',
  targets: [
    targetSpec('bow_fire', BOW, FIRE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_thunder', BOW, THUNDER, 'bonus', { kind: 'reset_bonuses' }),
  ],
  note: 'Two participants in one same_gogma_counter conflict; the yielding Target adopts a conversion Candidate on the free Normal / Skill positions.',
}

/**
 * C. Trial and rerun pressure.
 *
 * Three BuildListEntries share one `same_gogma_counter` conflict, so one fixed
 * side leaves two conflict works that share a single
 * `maxCandidateTrialsPerConflict` budget (PLANNER_SPEC 9.2.16). The first work
 * adopts a Candidate after a rejected trial; the second work then has no free
 * shared stream left and spends trials, each of which is a real full Beam Search
 * rerun rather than a preflight-only rejection.
 */
const trialPressureWorkload: PlannerOrchestrationBenchmarkWorkload = {
  id: 'orchestration_trial_and_rerun_pressure',
  label: 'C. Shared trial budget, repeated Beam reruns',
  group: 'trial_pressure',
  conflictResolution: 'fix_lowest_entry_id',
  targets: [
    targetSpec('bow_fire', BOW, FIRE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_ice', BOW, ICE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_thunder', BOW, THUNDER, 'bonus', { kind: 'reset_bonuses' }),
  ],
  note: 'Three participants in one conflict; two works share one trial budget and every trial runs a full Beam Search.',
}

/**
 * D. Generated-entry cap.
 *
 * Four BuildListEntries in one conflict leave three conflict works, and this
 * fixture settles only the first of them with a generated Candidate. The
 * remaining works keep asking for new Entries, which is exactly the condition
 * `max_generated_build_list_entries_reached` reports at
 * `maxGeneratedBuildListEntries = 1`.
 *
 * The B8-E1 investigation did not observe a Production-valid two-entry
 * adoption; this is not a Domain maximum and does not block B8-E2. One
 * generated Entry is deliberately not claimed as a limit: `reset_bonuses`,
 * `keep_bonuses`, and source-backed `reset_skills` are shareable physical
 * actions, so one Counter position is not one BuildListEntry. What was tried
 * and what blocked it is recorded in
 * `docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md` 7.5.
 */
const generatedCapWorkload: PlannerOrchestrationBenchmarkWorkload = {
  id: 'orchestration_generated_entry_cap',
  label: 'D. Generated-entry cap pressure',
  group: 'generated_cap',
  conflictResolution: 'fix_lowest_entry_id',
  targets: [
    targetSpec('bow_fire', BOW, FIRE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_water', BOW, WATER, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_thunder', BOW, THUNDER, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_ice', BOW, ICE, 'bonus', { kind: 'reset_bonuses' }),
  ],
  note: 'Four participants in one conflict leave three works, so more generated Entries are requested than a small cap allows.',
}

/**
 * E. The combined multi-Target workload.
 *
 * Five Targets across two weapon types, two conflict resource shapes - one
 * `same_gogma_counter` with three participants and one `same_skill_counter`
 * with two - and one explicit resolution per conflict, so the augmented
 * preflight has to re-map every resolution, not only the one whose conflict
 * triggered the current work (PLANNER_SPEC 9.2.3.1).
 */
const combinedWorkload: PlannerOrchestrationBenchmarkWorkload = {
  id: 'orchestration_combined_multi_target',
  label: 'E. Combined multi-Target, two conflict shapes',
  group: 'combined',
  conflictResolution: 'fix_lowest_entry_id',
  targets: [
    targetSpec('bow_fire', BOW, FIRE, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_water', BOW, WATER, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('bow_thunder', BOW, THUNDER, 'bonus', { kind: 'reset_bonuses' }),
    targetSpec('ls_ice', LONG_SWORD, ICE, 'skill', { kind: 'reset_skills' }),
    targetSpec('ls_dragon', LONG_SWORD, DRAGON, 'skill', { kind: 'reset_skills' }),
  ],
  note: 'Five Targets, two weapon types, a Gogma-counter conflict and a Skill-counter conflict, and two explicit resolutions.',
}

export const plannerOrchestrationBenchmarkWorkloads: readonly PlannerOrchestrationBenchmarkWorkload[] =
  [
    baselineWorkload,
    earlyAdoptionWorkload,
    trialPressureWorkload,
    generatedCapWorkload,
    combinedWorkload,
  ]

export function plannerOrchestrationBenchmarkWorkload(
  id: string,
): PlannerOrchestrationBenchmarkWorkload {
  const workload = plannerOrchestrationBenchmarkWorkloads.find(
    (entry) => entry.id === id,
  )
  if (!workload) {
    throw new RangeError(`Unknown Planner orchestration benchmark workload: ${id}`)
  }
  return workload
}

/**
 * The benchmark-only orchestration bounds sweep of B8-E2.
 *
 * These are **measurement grid values, not Production defaults**. B8-E1 adds no
 * `defaultPlannerOrchestrationBounds`, no Production fallback, and no clamp:
 * `PlannerOrchestrationBounds` stays caller-supplied everywhere, and B8-E2
 * decides its Production default from real Browser measurements taken with this
 * grid. Nothing here may be exported into `src/domain` or read as a default.
 */
export const BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP = {
  maxCandidateTrialsPerConflict: [1, 2, 4, 8, 16],
  maxGeneratedBuildListEntries: [1, 2, 4],
  maxPlannerReruns: [1, 2, 4, 8, 16, 32],
} as const

/**
 * The tuple the benchmark UI starts from. It is a starting point for the sweep,
 * chosen so a first run is not obviously truncated - never a proposed
 * Production default.
 */
export const BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 8,
  maxGeneratedBuildListEntries: 4,
  maxPlannerReruns: 16,
}

interface BenchmarkMaster {
  master: SearchMasterSubset
  context: Omit<CalculationContext, 'rngEngineVersion'>
}

let cachedMaster: BenchmarkMaster | null = null

function benchmarkMaster(): BenchmarkMaster {
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
      lotteries: data.lotteries,
      materialCosts: data.materialCosts,
    },
    context: {
      gameVersion: data.manifest.gameVersion,
      masterDataVersion: data.manifest.dataVersion,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    },
  }
  return cachedMaster
}

interface ProductionPredictions {
  resetBonuses: (
    weaponTypeId: WeaponTypeId,
    elementId: ElementId,
    gogmaCounter: number,
  ) => RestorationBonusSet
  normalBonuses: (
    weaponTypeId: WeaponTypeId,
    elementId: ElementId,
    normalCounter: number,
  ) => RestorationBonusSet
  skills: (
    weaponTypeId: WeaponTypeId,
    elementId: ElementId,
    skillCounter: number,
  ) => { seriesSkillId: string | null; groupSkillId: string | null }
}

function createProductionPredictions(
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): ProductionPredictions {
  return {
    resetBonuses: (weaponTypeId, elementId, gogmaCounter) =>
      engine.predictGogmaBonus({
        baseSeed: PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED,
        weaponTypeId,
        elementId,
        gogmaCounter,
        operation: { type: 'reset_bonuses' },
        master,
      }),
    normalBonuses: (weaponTypeId, elementId, normalCounter) =>
      engine.predictNormalArtian({
        baseSeed: PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED,
        weaponTypeId,
        elementId,
        rarity: V1_NORMAL_ARTIAN_RARITY,
        normalCounter,
        master,
      }),
    skills: (weaponTypeId, elementId, skillCounter) =>
      engine.predictSkills({
        baseSeed: PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED,
        weaponTypeId,
        elementId,
        skillCounter,
        master,
      }),
  }
}

function hasPracticalBonusType(bonuses: RestorationBonusSet): boolean {
  return bonuses.some(({ bonusTypeId }) => bonusTypeId === PRACTICAL_BONUS_TYPE_ID)
}

/**
 * The first far Reset depth whose Production result matches `wanted`.
 *
 * `false` is used for a `bonus`-flavored source, which must not already satisfy
 * its Target; `true` is used for a `skill`-flavored source, whose Practical
 * bonus condition must already hold so that only its Skills are missing.
 */
function sourceBonusDepth(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
  wanted: boolean,
  predictions: ProductionPredictions,
): number {
  for (
    let offset = SOURCE_BONUS_SCAN_START;
    offset < SOURCE_BONUS_SCAN_END;
    offset += 1
  ) {
    const counter = PLANNER_ORCHESTRATION_BENCHMARK_GOGMA_COUNTER + offset
    if (
      hasPracticalBonusType(
        predictions.resetBonuses(weaponTypeId, elementId, counter),
      ) === wanted
    ) {
      return counter
    }
  }
  throw new Error(
    `No Production Reset depth in [${SOURCE_BONUS_SCAN_START}, ${SOURCE_BONUS_SCAN_END}) for ${weaponTypeId}/${elementId} carries ${PRACTICAL_BONUS_TYPE_ID} = ${wanted}.`,
  )
}

/**
 * The first far Skill Counter whose Production Series Skill differs from
 * `excludedSeriesSkillId`, so a `skill`-flavored source genuinely lacks the
 * Series Skill its Target's Practical condition requires.
 */
function sourceSkillCounter(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
  excludedSeriesSkillId: string | null,
  predictions: ProductionPredictions,
): number {
  for (
    let offset = SOURCE_SKILL_SCAN_START;
    offset < SOURCE_SKILL_SCAN_END;
    offset += 1
  ) {
    const counter = PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER + offset
    const predicted = predictions.skills(weaponTypeId, elementId, counter)
    if (
      excludedSeriesSkillId === null ||
      predicted.seriesSkillId !== excludedSeriesSkillId
    ) {
      return counter
    }
  }
  throw new Error(
    `No Production Skill Counter in [${SOURCE_SKILL_SCAN_START}, ${SOURCE_SKILL_SCAN_END}) for ${weaponTypeId}/${elementId} avoids ${excludedSeriesSkillId}.`,
  )
}

function benchmarkRngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: {
      value: PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED,
      isConfirmed: true,
      source: 'observation',
    },
    gogmaCounter: {
      value: PLANNER_ORCHESTRATION_BENCHMARK_GOGMA_COUNTER,
      isConfirmed: true,
      source: 'manual',
    },
    skillCounter: {
      value: PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER,
      isConfirmed: true,
      source: 'observation',
    },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function benchmarkNormalCounter(weaponTypeId: WeaponTypeId): NormalArtianCounter {
  return {
    id: `${weaponTypeId}:${V1_NORMAL_ARTIAN_RARITY}`,
    weaponTypeId,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    counter: PLANNER_ORCHESTRATION_BENCHMARK_NORMAL_COUNTER,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: FIXTURE_TIME,
    candidateCount: 1,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function createBenchmarkTarget(
  spec: PlannerOrchestrationTargetSpec, source: OwnedGogmaArtianWeapon,
  predictions: ProductionPredictions,
): TargetWeapon {
  const prediction = createRoutePrediction(spec, source, predictions)
  const bonusFocused = spec.flavor === 'bonus'
  // The Route prediction is the Target's Ideal result on both axes: Candidate
  // Search composes Ideal results only, so a workload whose Route stops at a
  // compromise state would produce no Candidate at all. The two flavors still
  // differ in which axis the Route has to amend, which is what the workload
  // measures.
  const idealBonuses = structuredClone(prediction.finalBonuses)
  return {
    id: `target.b8e1.${spec.key}` as TargetWeaponId,
    name: `B8-E1 ${spec.key}`, weaponTypeId: spec.weaponTypeId, elementId: spec.elementId,
    priority: 3, isEnabled: true, preferredOwnedWeaponId: null, idealBonuses,
    practicalBonusConditions: benchmarkPracticalBonuses(idealBonuses), alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: prediction.seriesSkillId, groupSkillId: prediction.groupSkillId, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: bonusFocused ? null : prediction.seriesSkillId, groupSkillId: null, matchMode: 'all' },
    memo: null, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
  }
}

function createBenchmarkSource(
  spec: PlannerOrchestrationTargetSpec,
  predictions: ProductionPredictions,
): OwnedGogmaArtianWeapon {
  const wantsPracticalBonuses = spec.flavor === 'skill'
  const bonusDepth = sourceBonusDepth(
    spec.weaponTypeId,
    spec.elementId,
    wantsPracticalBonuses,
    predictions,
  )
  const skillCounter = sourceSkillCounter(
    spec.weaponTypeId,
    spec.elementId,
    spec.flavor === 'skill' ? predictions.skills(spec.weaponTypeId, spec.elementId, PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER).seriesSkillId : null,
    predictions,
  )
  const skills = predictions.skills(spec.weaponTypeId, spec.elementId, skillCounter)
  return {
    id: `owned.b8e1.${spec.key}` as OwnedWeaponId,
    kind: 'gogma',
    name: `B8-E1 source ${spec.key}`,
    weaponTypeId: spec.weaponTypeId,
    elementId: spec.elementId,
    restorationBonuses: predictions.resetBonuses(
      spec.weaponTypeId,
      spec.elementId,
      bonusDepth,
    ),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: skills.seriesSkillId as OwnedGogmaArtianWeapon['seriesSkillId'],
    groupSkillId: skills.groupSkillId as OwnedGogmaArtianWeapon['groupSkillId'],
    status: 'unclassified',
    isProtected: false,
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

interface RoutePrediction {
  route: BuildRoute
  finalBonuses: RestorationBonusSet
  restorationBonusScope: 'normal_artian' | 'gogma_artian'
  seriesSkillId: OwnedGogmaArtianWeapon['seriesSkillId']
  groupSkillId: OwnedGogmaArtianWeapon['groupSkillId']
}

/**
 * The concrete ordered `RouteOperation[]` of one workload Entry, together with
 * the Production result that Route actually produces.
 *
 * Every counter here is the origin position of its stream, because that is what
 * a Route reachable from the current state looks like: a Gogma amendment starts
 * at the current Gogma Counter, a conversion starts at the current Normal
 * Counter and consumes the current Skill position.
 */
function createRoutePrediction(
  spec: PlannerOrchestrationTargetSpec,
  source: OwnedGogmaArtianWeapon,
  predictions: ProductionPredictions,
): RoutePrediction {
  const gogmaCounter = PLANNER_ORCHESTRATION_BENCHMARK_GOGMA_COUNTER
  const skillCounter = PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER
  const normalCounter = PLANNER_ORCHESTRATION_BENCHMARK_NORMAL_COUNTER
  if (spec.entry.kind === 'reset_bonuses') {
    return {
      route: {
        kind: 'existing_gogma_reset_bonuses',
        sourceOwnedWeaponId: source.id,
        operations: [
          {
            type: 'reset_bonuses',
            sourceOwnedWeaponId: source.id,
            gogmaCounterBefore: gogmaCounter,
            gogmaCounterAfter: gogmaCounter + 1,
          },
        ],
      },
      finalBonuses: predictions.resetBonuses(
        spec.weaponTypeId,
        spec.elementId,
        gogmaCounter,
      ),
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: source.seriesSkillId,
      groupSkillId: source.groupSkillId,
    }
  }
  if (spec.entry.kind === 'reset_skills') {
    const skills = predictions.skills(spec.weaponTypeId, spec.elementId, skillCounter)
    return {
      route: {
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: source.id,
        operations: [
          {
            type: 'reset_skills',
            sourceOwnedWeaponId: source.id,
            skillCounterBefore: skillCounter,
            skillCounterAfter: skillCounter + 1,
          },
        ],
      },
      // Reset Skills keeps the source's five slots and their scope unchanged.
      finalBonuses: source.restorationBonuses,
      restorationBonusScope: source.restorationBonusScope,
      seriesSkillId: skills.seriesSkillId as OwnedGogmaArtianWeapon['seriesSkillId'],
      groupSkillId: skills.groupSkillId as OwnedGogmaArtianWeapon['groupSkillId'],
    }
  }
  const { forgeCount } = spec.entry
  const skills = predictions.skills(spec.weaponTypeId, spec.elementId, skillCounter)
  return {
    route: {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        {
          type: 'create_normal_artian',
          weaponTypeId: spec.weaponTypeId,
          rarity: V1_NORMAL_ARTIAN_RARITY,
          count: forgeCount,
          normalCounterBefore: normalCounter,
          normalCounterAfter: normalCounter + forgeCount,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: spec.weaponTypeId,
          skillCounterBefore: skillCounter,
          skillCounterAfter: skillCounter + 1,
        },
        { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: gogmaCounter, gogmaCounterAfter: gogmaCounter + 1 },
      ],
    },
    // Conversion preserves the Normal slots; only the following Reset supplies the accepted Gogma result.
    finalBonuses: predictions.resetBonuses(
      spec.weaponTypeId, spec.elementId, gogmaCounter,
    ),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: skills.seriesSkillId as OwnedGogmaArtianWeapon['seriesSkillId'],
    groupSkillId: skills.groupSkillId as OwnedGogmaArtianWeapon['groupSkillId'],
  }
}

export interface PlannerOrchestrationBenchmarkFixture {
  readonly workload: PlannerOrchestrationBenchmarkWorkload
  readonly input: PlannerInput
  /** The real initial conflicts the existing Planner authority detected. */
  readonly initialConflicts: readonly PlanConflict[]
  /** The Entries held fixed, one per explicit resolution, in resolution order. */
  readonly fixedBuildListEntryIds: readonly BuildListEntryId[]
  /** Entry ID per workload Target key, so tests can assert structure. */
  readonly buildListEntryIdByTargetKey: Readonly<Record<string, BuildListEntryId>>
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Builds one deterministic, Production-valid Planner orchestration benchmark
 * input.
 *
 * It is deliberately synchronous and side-effect free: it touches no Worker, no
 * persistence, and no Clock, so the benchmark can build it outside the measured
 * window. The returned `PlannerInput` is structured-clone data only.
 */
export function createPlannerOrchestrationBenchmarkInput(
  workloadId: string,
): PlannerOrchestrationBenchmarkFixture {
  const workload = plannerOrchestrationBenchmarkWorkload(workloadId)
  const { master, context } = benchmarkMaster()
  const engine = new ProductionRngEngine()
  const predictions = createProductionPredictions(master, engine)
  const calculationContext: CalculationContext = {
    ...context,
    rngEngineVersion: engine.version,
  }

  const sources = workload.targets.map((spec) => createBenchmarkSource(spec, predictions))
  const targets = workload.targets.map((spec, index) => createBenchmarkTarget(spec, sources[index], predictions))
  targets.forEach((target) => {
    const validation = validateTargetIdealImpliesPractical(target, master)
    if (!validation.isValid) throw new Error(JSON.stringify(validation.issues))
  })
  const ownedWeapons: OwnedWeapon[] = [...sources]
  const normalCounters = [
    ...new Set(workload.targets.map(({ weaponTypeId }) => weaponTypeId)),
  ]
    .sort(compareStableStrings)
    .map((weaponTypeId) => benchmarkNormalCounter(weaponTypeId))
  const rngState = benchmarkRngState()

  // The ordinary Search Domain Candidate authority. `settings` is only what an
  // ordinary Candidate Search would have carried when the user added these
  // Entries; it is never an enumeration or orchestration bound.
  const searchInput: CandidateSearchInput = {
    searchRunId: FIXTURE_SEARCH_RUN_ID,
    // Candidate Search is single-Target now. This fixture only uses the input
    // as the `createCandidateFromPrediction()` context, which reads the Master
    // subset, the RNG snapshot and the CalculationContext, never this id.
    targetWeaponId: targets[0].id,
    routeFilter: 'all',
    rngState,
    normalCounters,
    ownedWeapons,
    targetWeapons: targets,
    settings: { ...defaultCandidateSearchSettings },
    master,
    calculationContext,
  }
  const execution = createSearchExecutionContext({ now: () => FIXTURE_TIME })

  const buildListEntryIdByTargetKey: Record<string, BuildListEntryId> = {}
  const buildListEntries: BuildListEntry[] = workload.targets.map((spec, index) => {
    const target = targets[index]
    const prediction = createRoutePrediction(spec, sources[index], predictions)
    const candidate = createCandidateFromPrediction(
      target,
      {
        finalBonuses: prediction.finalBonuses,
        restorationBonusScope: prediction.restorationBonusScope,
        seriesSkillId: prediction.seriesSkillId,
        groupSkillId: prediction.groupSkillId,
        route: prediction.route,
      },
      searchInput,
      execution,
    )
    if (candidate === null) {
      throw new Error(
        `Workload '${workloadId}' Target '${spec.key}' produced a Production result satisfying neither the Ideal nor the Practical condition.`,
      )
    }
    const entry = createBuildListEntry(candidate, target, {
      createdAt: FIXTURE_TIME,
    })
    buildListEntryIdByTargetKey[spec.key] = entry.id
    return entry
  })

  const baseInput: PlannerInput = {
    rngState,
    normalCounters,
    ownedWeapons,
    targetWeapons: targets,
    buildListEntries,
    calculationContext,
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: master.weaponBonusDefinitions,
      weaponTypes: master.weaponTypes,
      elements: master.elements,
      bonusTypes: master.bonusTypes,
      bonusRanks: master.bonusRanks,
      lotteries: master.lotteries,
      materialCosts: master.materialCosts,
    },
    conflictResolutions: [],
  }

  // The existing Planner initial conflict authority, never a hand-written key.
  const prepared = preparePlannerInitialContext(
    baseInput,
    createProductionPlannerDependencies(engine),
  )
  if (prepared.status !== 'ready') {
    throw new Error(
      `Workload '${workloadId}' is not a valid PlannerInput: ${JSON.stringify(
        prepared.issues,
      )}`,
    )
  }
  const initialConflicts = prepared.context.initialConflictDetection.conflicts
  const conflictResolutions: PlannerConflictResolution[] =
    workload.conflictResolution === 'none'
      ? []
      : initialConflicts.map((conflict) => ({
          conflictKey: conflict.id,
          selectedBuildListEntryId: [...conflict.buildListEntryIds].sort(
            compareStableStrings,
          )[0],
        }))

  return {
    workload,
    input: { ...baseInput, conflictResolutions },
    initialConflicts,
    fixedBuildListEntryIds: conflictResolutions.map(
      ({ selectedBuildListEntryId }) => selectedBuildListEntryId,
    ),
    buildListEntryIdByTargetKey,
  }
}
