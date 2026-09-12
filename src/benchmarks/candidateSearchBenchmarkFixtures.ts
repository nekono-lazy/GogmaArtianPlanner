import { benchmarkPracticalBonuses, benchmarkPracticalSkills } from './targetCompromiseFixture'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  CalculationContext,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  RngState,
  SkillCondition,
  TargetWeapon,
  TargetWeaponId,
} from '../domain/models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import type { SkillPredictionResult } from '../domain/rng/rngEngine'
import type {
  CandidateSearchInput,
  CandidateSearchSettings,
  SearchMasterSubset,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'

/**
 * B5 Candidate Search Browser Worker benchmark fixtures.
 *
 * Every workload is a Production-supported input for the unmodified
 * `ProductionRngEngine`: the Bow / Fire Normal Artian pool is game-verified,
 * and Skill and Gogma Reset prediction accept that weapon and element. The
 * Base Seed and the starting Skill Counter are the C5-E2C9 live-game read and
 * keep source `observation`. The starting Gogma Counter is a synthetic
 * benchmark constant, so it uses source `manual`; it is not a real-game
 * observation and carries no verification claim.
 *
 * No workload assumes unverified RNG behavior. Every Ideal meant to be
 * reachable is read back from the Engine at the exact position the search
 * reaches it, and the unreachable Ideal is unreachable by the pinned reference
 * Reset candidate table rather than by an empirical guess.
 */
export const CANDIDATE_SEARCH_BENCHMARK_BASE_SEED = '51231782'
export const CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID = 'weapon.bow'
export const CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID = 'element.fire'
export const CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER = 0
export const CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER = 341
export const CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER = 200

const FIXTURE_TIME = '2026-09-05T00:00:00.000Z'
const TARGET_ID = 'target.benchmark.b5' as TargetWeaponId
const OWNED_GOGMA_SOURCE_ID = 'owned.benchmark.b5.gogma' as OwnedWeaponId
/** Deliberately far from the starting Counters; see `ownedGogmaSource`. */
const OWNED_GOGMA_SOURCE_BONUS_DEPTH = 778
const OWNED_GOGMA_SOURCE_SKILL_COUNTER =
  CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER + 9

/**
 * `bonus_rank.i` exists in the Bow Gogma Master definitions but is absent from
 * `REFERENCE_GOGMA_RESET_CANDIDATES`, and every Normal Artian slot is
 * `bonus_rank.base`, so no Reset or Keep result can contain it.
 */

/**
 * Enabled in the Group Skill Master but deliberately absent from
 * `REFERENCE_GROUP_SKILL_POOL`, so Production `predictSkills` never returns it.
 * The Skill stream therefore never satisfies this Ideal and never stops early.
 */
const UNREACHABLE_GROUP_SKILL_ID = 'group_skill.verified_14'

/**
 * The two streams are independent, so the Ideal is specified per stream. An
 * Ideal Candidate needs both halves at once, so one unreachable half is enough
 * to remove every Ideal, and each reachable half is read back from the Engine.
 *
 * SEARCH_SPEC 5.1 requires `finalBonusScope = "gogma_artian"` for an Ideal, and
 * a bare conversion keeps the inherited `normal_artian` slots. The Ideal bonus
 * anchor is therefore never the conversion output: it is either a Reset result
 * or the Owned Gogma source's own Gogma-scope slots. The union deliberately
 * cannot express a conversion-output bonus anchor.
 */
export type BenchmarkIdealBonuses =
  /** Reset Bonuses at `depth`, i.e. Gogma Counter `start + depth - 1`. */
  | { readonly kind: 'gogma_reset'; readonly depth: number }
  /** The synthetic Owned Gogma source's current five Gogma-scope slots. */
  | { readonly kind: 'owned_gogma_current' }
  | { readonly kind: 'unreachable' }

export type BenchmarkIdealSkills =
  /** The Skill assigned by `convert_normal_to_gogma` at the start Counter. */
  | { readonly kind: 'conversion' }
  /** Reset Skills `depth` on the Owned Gogma source, i.e. `start + depth - 1`. */
  | { readonly kind: 'owned_reset'; readonly depth: number }
  | { readonly kind: 'unreachable' }

export interface BenchmarkIdealSpec {
  readonly bonuses: BenchmarkIdealBonuses
  readonly skills: BenchmarkIdealSkills
}

/** True when the workload needs the synthetic Owned Gogma source in inventory. */
export function usesOwnedGogmaSource(ideal: BenchmarkIdealSpec): boolean {
  return (
    ideal.bonuses.kind === 'owned_gogma_current' ||
    ideal.skills.kind === 'owned_reset'
  )
}

export interface CandidateSearchBenchmarkWorkload {
  readonly id: string
  readonly label: string
  readonly ideal: BenchmarkIdealSpec
  readonly settings: CandidateSearchSettings
  /**
   * The canonical Ideal's `estimatedOperationCount` when one exists. The Normal
   * route reaches offset 0 with `create_normal_artian` plus
   * `convert_normal_to_gogma`, so a reachable Ideal at stream depth `d` costs
   * `2 + d`.
   */
  readonly expectedIdealOperationCount: number | null
  readonly note: string
}

/**
 * The complete Candidate Search settings in force when the B5 measurements were
 * taken, pinned field by field. These were the shipped defaults at that time;
 * B6 lowered the shipped defaults to `1000 / 200 / 1000`. This
 * preset deliberately does not read `defaultCandidateSearchSettings`, so a
 * later default change can never silently redefine a historical workload and
 * the values recorded in
 * `docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md` stay reproducible.
 */
export const B5_MEASUREMENT_SETTINGS: CandidateSearchSettings = {
  maxNormalAdvance: 5000,
  maxGogmaAdvance: 5000,
  maxSkillAdvance: 5000,
}

function b5Settings(
  overrides: Partial<CandidateSearchSettings> = {},
): CandidateSearchSettings {
  return { ...B5_MEASUREMENT_SETTINGS, ...overrides }
}

/**
 * Fixed presets, so every recorded measurement names one immutable workload.
 * Every workload derives from `B5_MEASUREMENT_SETTINGS`: the `*_default_bounds`
 * entries use it unchanged, and the bounded sweeps override only the bound they
 * characterize. `default bounds` in a label means the B5-era defaults, not the
 * current shipped defaults, so the labels say so explicitly.
 */
export const candidateSearchBenchmarkWorkloads: readonly CandidateSearchBenchmarkWorkload[] = [
  {
    id: 'near_ideal_default_bounds',
    label: 'A1. Near Ideal (B5 default bounds)',
    ideal: { bonuses: { kind: 'gogma_reset', depth: 1 }, skills: { kind: 'conversion' } },
    settings: b5Settings(),
    expectedIdealOperationCount: 3,
    note: 'The conversion Skill is already Ideal and the first Reset Bonuses produces the Ideal Gogma-scope slots, so B4 stops at D = 3 (create + convert + reset) under the pinned B5 settings.',
  },
  {
    id: 'skill_depth_8_default_bounds',
    label: 'A2. Ideal at Skill depth 8 on an Owned Gogma source (B5 default bounds)',
    ideal: { bonuses: { kind: 'owned_gogma_current' }, skills: { kind: 'owned_reset', depth: 8 } },
    settings: b5Settings(),
    expectedIdealOperationCount: 8,
    note: 'The Owned Gogma source already holds the Ideal Gogma-scope slots, so only the Skill stream searches; the Ideal Skill first appears at Reset Skills depth 8, giving D = 8.',
  },
  {
    id: 'bonus_depth_8_default_bounds',
    label: 'A3. Ideal at Gogma Reset depth 8 (B5 default bounds)',
    ideal: { bonuses: { kind: 'gogma_reset', depth: 8 }, skills: { kind: 'conversion' } },
    settings: b5Settings(),
    expectedIdealOperationCount: 10,
    note: 'Reachable only after 8 Reset Bonuses, so the Bonus stream sets D = 10 under the pinned B5 settings.',
  },
  ...[10, 25, 50, 100, 200].map((depth) => ({
    id: `no_ideal_gogma_${depth}`,
    label: `B. No Ideal, Gogma bound ${depth}`,
    ideal: {
      bonuses: { kind: 'unreachable' },
      skills: { kind: 'unreachable' },
    } as const,
    settings: b5Settings({
      maxNormalAdvance: 1,
      maxGogmaAdvance: depth,
      maxSkillAdvance: 1,
    }),
    expectedIdealOperationCount: null,
    note: 'Exhausts the Gogma stream frontier; Normal and Skill stay at their minimum.',
  })),
  ...[10, 100, 1000, 5000].map((depth) => ({
    id: `no_ideal_skill_${depth}`,
    label: `C1. No Ideal, Skill bound ${depth}`,
    ideal: {
      bonuses: { kind: 'unreachable' },
      skills: { kind: 'unreachable' },
    } as const,
    settings: b5Settings({
      maxNormalAdvance: 1,
      maxGogmaAdvance: 1,
      maxSkillAdvance: depth,
    }),
    expectedIdealOperationCount: null,
    note: 'Exhausts the Skill stream; Normal and Gogma stay at their minimum.',
  })),
  ...[10, 100, 1000, 5000].map((depth) => ({
    id: `no_ideal_normal_${depth}`,
    label: `C2. No Ideal, Normal bound ${depth}`,
    ideal: {
      bonuses: { kind: 'unreachable' },
      skills: { kind: 'unreachable' },
    } as const,
    settings: b5Settings({
      maxNormalAdvance: depth,
      maxGogmaAdvance: 1,
      maxSkillAdvance: 1,
    }),
    expectedIdealOperationCount: null,
    note: 'Exhausts the Normal offsets; Gogma and Skill stay at their minimum.',
  })),
  {
    id: 'no_ideal_default_bounds',
    label: 'D. No Ideal (B5 default bounds)',
    ideal: {
      bonuses: { kind: 'unreachable' },
      skills: { kind: 'unreachable' },
    } as const,
    settings: b5Settings(),
    expectedIdealOperationCount: null,
    note: 'The pinned B5 5000 / 5000 / 5000 bounds with nothing to stop at. Intended for the cancellation and feasibility observations, not for a completion measurement.',
  },
]

export function candidateSearchBenchmarkWorkload(
  id: string,
): CandidateSearchBenchmarkWorkload {
  const workload = candidateSearchBenchmarkWorkloads.find(
    (entry) => entry.id === id,
  )
  if (!workload) {
    throw new RangeError(`Unknown Candidate Search benchmark workload: ${id}`)
  }
  return workload
}

export interface CandidateSearchBenchmarkFixture {
  readonly input: CandidateSearchInput
  readonly workload: CandidateSearchBenchmarkWorkload
}

interface BenchmarkMaster {
  master: SearchMasterSubset
  context: Omit<CalculationContext, 'rngEngineVersion'>
}

/** Master Data is read-only here, and the Production input shares it too. */
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

function benchmarkRngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: {
      value: CANDIDATE_SEARCH_BENCHMARK_BASE_SEED,
      isConfirmed: true,
      source: 'observation',
    },
    // Synthetic benchmark starting point, not a real-game observation.
    gogmaCounter: {
      value: CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER,
      isConfirmed: true,
      source: 'manual',
    },
    skillCounter: {
      value: CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER,
      isConfirmed: true,
      source: 'observation',
    },
    // Legacy field only; Production active prediction never reads it.
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function benchmarkNormalCounter(): NormalArtianCounter {
  return {
    id: `${CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID}:${V1_NORMAL_ARTIAN_RARITY}`,
    weaponTypeId: CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    counter: CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: FIXTURE_TIME,
    candidateCount: 1,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

/**
 * `convert_normal_to_gogma` assigns the Skill read at the pre-conversion Skill
 * Counter, and Reset Skills depth `k` on an existing Gogma source reads
 * `startSkillCounter + k - 1`, so both anchors are absolute Counter positions.
 */
function skillsAtCounter(
  skillCounter: number,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): SkillPredictionResult {
  return engine.predictSkills({
    baseSeed: CANDIDATE_SEARCH_BENCHMARK_BASE_SEED,
    weaponTypeId: CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID,
    skillCounter,
    master,
  })
}

/** The depth-`d` Bonus amendment runs at Gogma Counter `start + d - 1`. */
function resetBonusesAtDepth(
  depth: number,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): RestorationBonusSet {
  return engine.predictGogmaBonus({
    baseSeed: CANDIDATE_SEARCH_BENCHMARK_BASE_SEED,
    weaponTypeId: CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID,
    gogmaCounter: CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER + depth - 1,
    operation: { type: 'reset_bonuses' },
    master,
  })
}

/**
 * Synthetic Owned Gogma benchmark source. Its five slots are a Production Reset
 * result, so they are Gogma-scope and every slot is a reference Keep family
 * member; its Skills are a Production Skill result. Both are far enough from the
 * starting Counters that no cheaper Route reproduces them inside the measured
 * horizon. Nothing here assumes unverified game behavior.
 */
function ownedGogmaSource(
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): OwnedGogmaArtianWeapon {
  const skills = skillsAtCounter(OWNED_GOGMA_SOURCE_SKILL_COUNTER, master, engine)
  return {
    id: OWNED_GOGMA_SOURCE_ID,
    kind: 'gogma',
    name: 'B5 benchmark Gogma source',
    weaponTypeId: CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID,
    restorationBonuses: resetBonusesAtDepth(
      OWNED_GOGMA_SOURCE_BONUS_DEPTH,
      master,
      engine,
    ),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
    status: 'unclassified',
    isProtected: false,
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

interface IdealResolution {
  bonuses: RestorationBonusSet
  skills: SkillCondition
}

function resolveIdeal(
  ideal: BenchmarkIdealSpec,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): IdealResolution {
  const bonuses: RestorationBonusSet =
    ideal.bonuses.kind === 'unreachable'
      ? resetBonusesAtDepth(1, master, engine).map((bonus) => ({ ...bonus, bonusRankId: 'bonus_rank.i' })) as RestorationBonusSet
      : ideal.bonuses.kind === 'owned_gogma_current'
        ? ownedGogmaSource(master, engine).restorationBonuses
        : resetBonusesAtDepth(ideal.bonuses.depth, master, engine)

  const skills: SkillCondition =
    ideal.skills.kind === 'unreachable'
      ? {
          seriesSkillId: skillsAtCounter(CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER, master, engine).seriesSkillId,
          groupSkillId: UNREACHABLE_GROUP_SKILL_ID,
          matchMode: 'all',
        }
      : {
          ...skillsAtCounter(
            ideal.skills.kind === 'conversion'
              ? CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER
              : CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER + ideal.skills.depth - 1,
            master,
            engine,
          ),
          matchMode: 'all',
        }

  return { bonuses, skills }
}

/**
 * Builds one deterministic benchmark input. The Ideal is read back from the
 * Production Engine, so the same workload id always yields the same input, and
 * the Ideal-implies-Practical containment invariant is asserted here instead of
 * being assumed.
 */
export function createCandidateSearchBenchmarkInput(
  workloadId: string,
  searchRunId: string,
): CandidateSearchBenchmarkFixture {
  const workload = candidateSearchBenchmarkWorkload(workloadId)
  const { master, context } = benchmarkMaster()
  const engine = new ProductionRngEngine()
  const ideal = resolveIdeal(workload.ideal, master, engine)

  const target: TargetWeapon = {
    id: TARGET_ID,
    name: 'B5 benchmark target',
    weaponTypeId: CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID,
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    idealBonuses: ideal.bonuses,
    practicalBonusConditions: benchmarkPracticalBonuses(ideal.bonuses),
    alternativeBonusRules: [],
    idealSkillCondition: { ...ideal.skills },
    practicalSkillCondition: { ...benchmarkPracticalSkills(ideal.skills), groupSkillId: skillsAtCounter(CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER, master, engine).groupSkillId, matchMode: 'any' },
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }

  const containment = validateTargetIdealImpliesPractical(target, master)
  if (!containment.isValid) {
    throw new Error(
      `Benchmark workload '${workloadId}' violates Ideal implies Practical: ${containment.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join(' / ')}`,
    )
  }

  return {
    workload,
    input: {
      searchRunId,
      targetWeaponId: target.id,
      routeFilter: 'all',
      rngState: benchmarkRngState(),
      normalCounters: [benchmarkNormalCounter()],
      ownedWeapons: usesOwnedGogmaSource(workload.ideal)
        ? [ownedGogmaSource(master, engine)]
        : [],
      targetWeapons: [target],
      settings: { ...workload.settings },
      master,
      calculationContext: { ...context, rngEngineVersion: engine.version },
    },
  }
}
