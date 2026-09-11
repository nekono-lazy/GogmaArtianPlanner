import { benchmarkPracticalBonuses, benchmarkPracticalSkills } from './targetCompromiseFixture'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  CalculationContext,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
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
  ConstrainedCandidateSearchInput,
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
  SearchMasterSubset,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  CANDIDATE_SEARCH_BENCHMARK_BASE_SEED,
  CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID,
  CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER,
  CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER,
  CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER,
  CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID,
} from './candidateSearchBenchmarkFixtures'

/**
 * B8-B2 constrained enumeration Browser Worker benchmark fixtures.
 *
 * The Production input constants are the B5 ones, imported rather than
 * restated: `weapon.bow` / `element.fire`, the C5-E2C9 live-read Base Seed and
 * starting Skill Counter (source `observation`), Normal Counter 0, and the
 * synthetic starting Gogma Counter 200 (source `manual`, not a real-game
 * observation). Every prediction the workloads reach is a Production-supported
 * input for the unmodified `ProductionRngEngine`.
 *
 * The unreachable halves are the same reference-level facts B5 used, not new
 * empirical guesses:
 *
 * - `bonus_type.attack` / `bonus_rank.i` is absent from
 *   `REFERENCE_GOGMA_RESET_CANDIDATES`, and every Normal Artian slot is
 *   `bonus_rank.base`, so no Reset or Keep result can contain it
 * - `group_skill.verified_14` is enabled in Master but absent from
 *   `REFERENCE_GROUP_SKILL_POOL`, so `predictSkills` never returns it
 *
 * Unlike B5, an unreachable Ideal is not used to defeat a search termination
 * rule: the constrained enumerator has no canonical-Ideal termination. It is
 * used to keep a stream *active*, because SEARCH_SPEC 5.6.1 disables a stream
 * whose current state already satisfies the Ideal condition. That same rule is
 * what these fixtures use, deliberately, to isolate one axis at a time.
 */
export const CONSTRAINED_BENCHMARK_BASE_SEED = CANDIDATE_SEARCH_BENCHMARK_BASE_SEED
export const CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID =
  CANDIDATE_SEARCH_BENCHMARK_WEAPON_TYPE_ID
export const CONSTRAINED_BENCHMARK_ELEMENT_ID = CANDIDATE_SEARCH_BENCHMARK_ELEMENT_ID
export const CONSTRAINED_BENCHMARK_NORMAL_COUNTER =
  CANDIDATE_SEARCH_BENCHMARK_NORMAL_COUNTER
export const CONSTRAINED_BENCHMARK_SKILL_COUNTER =
  CANDIDATE_SEARCH_BENCHMARK_SKILL_COUNTER
export const CONSTRAINED_BENCHMARK_GOGMA_COUNTER =
  CANDIDATE_SEARCH_BENCHMARK_GOGMA_COUNTER

const FIXTURE_TIME = '2026-09-06T00:00:00.000Z'
const TARGET_ID = 'target.benchmark.b8' as TargetWeaponId
const OWNED_GOGMA_SOURCE_ID = 'owned.benchmark.b8.gogma' as OwnedWeaponId
const OWNED_NORMAL_SOURCE_ID = 'owned.benchmark.b8.normal' as OwnedWeaponId

/**
 * The same far-away Reset depth B5 used for its synthetic Owned Gogma source.
 * Its five slots are a Production Reset result, so they are `gogma_artian`
 * scope and every slot is a reference Keep family member, and they satisfy the
 * Practical bonus condition below, which the Ideal-implies-Practical
 * containment needs when they are used as the Ideal anchor.
 */
const OWNED_GOGMA_SOURCE_BONUS_DEPTH = 778
const OWNED_GOGMA_SOURCE_SKILL_COUNTER = CONSTRAINED_BENCHMARK_SKILL_COUNTER + 9
/** The Normal Artian block the synthetic Owned Normal source was forged from. */
const OWNED_NORMAL_SOURCE_COUNTER = CONSTRAINED_BENCHMARK_NORMAL_COUNTER + 3000


const UNREACHABLE_GROUP_SKILL_ID = 'group_skill.verified_14'

/**
 * How a workload anchors the Target's Ideal bonus condition.
 *
 * `owned_gogma_current` makes the Owned Gogma source's Bonus stream inactive
 * (SEARCH_SPEC 5.6.1), which is how the Skill axis is isolated.
 * `unreachable` keeps the Bonus stream active on every base.
 */
export type ConstrainedIdealBonuses =
  | { readonly kind: 'owned_gogma_current' }
  | { readonly kind: 'unreachable' }

/**
 * How a workload anchors the Target's Ideal skill condition.
 *
 * `owned_gogma_current` makes the Owned Gogma source's Skill stream inactive,
 * which is how the Gogma axis is isolated. It does not disable the Skill stream
 * of a conversion base, whose current Skills are the conversion result.
 */
export type ConstrainedIdealSkills =
  | { readonly kind: 'owned_gogma_current' }
  | { readonly kind: 'unreachable' }

export interface ConstrainedIdealSpec {
  readonly bonuses: ConstrainedIdealBonuses
  readonly skills: ConstrainedIdealSkills
}

/** Which synthetic sources a workload puts into the origin's inventory. */
export interface ConstrainedInventorySpec {
  readonly normalCounter: boolean
  readonly ownedNormal: boolean
  readonly ownedGogma: boolean
}

export interface ConstrainedEnumerationBenchmarkWorkload {
  readonly id: string
  readonly label: string
  readonly group: 'normal' | 'skill' | 'gogma' | 'off_axis' | 'combined'
  readonly ideal: ConstrainedIdealSpec
  readonly inventory: ConstrainedInventorySpec
  readonly bounds: ConstrainedEnumerationBounds
  readonly note: string
}

function bounds(
  maxNormalForgeCount: number,
  maxGogmaAdvance: number,
  maxSkillResetCount: number,
  maxOffAxisPairEvaluations: number,
): ConstrainedEnumerationBounds {
  return {
    maxNormalForgeCount,
    maxGogmaAdvance,
    maxSkillResetCount,
    maxOffAxisPairEvaluations,
  }
}

/**
 * The Normal axis in isolation.
 *
 * No owned weapon exists, so the only Route base family is
 * `normal_artian_to_gogma`, one base per forge count. Gogma and Skill stay at
 * their validator minimum of 1 and off-axis evaluation is disabled, so the
 * measured growth is the Normal offset enumeration plus one shared Skill
 * position and one Reset per base.
 */
const normalScaling = [10, 50, 100, 250, 500, 1000].map(
  (forgeCount): ConstrainedEnumerationBenchmarkWorkload => ({
    id: `constrained_normal_${forgeCount}`,
    label: `A. Normal forge count ${forgeCount}`,
    group: 'normal',
    ideal: { bonuses: { kind: 'unreachable' }, skills: { kind: 'unreachable' } },
    inventory: { normalCounter: true, ownedNormal: false, ownedGogma: false },
    bounds: bounds(forgeCount, 1, 1, 0),
    note: 'Normal offsets only; Gogma and Skill at the validator minimum, off-axis disabled.',
  }),
)

/**
 * The Skill axis in isolation.
 *
 * The origin holds no Normal Counter and no Owned Normal weapon, so no
 * conversion base exists and the single Owned Gogma base carries the whole
 * enumeration. Its current five slots are the Ideal bonus anchor, so its Bonus
 * stream is inactive and only Reset Skills advances.
 */
const skillScaling = [10, 50, 100, 250, 500, 1000].map(
  (resetCount): ConstrainedEnumerationBenchmarkWorkload => ({
    id: `constrained_skill_${resetCount}`,
    label: `B. Skill reset count ${resetCount}`,
    group: 'skill',
    ideal: {
      bonuses: { kind: 'owned_gogma_current' },
      skills: { kind: 'unreachable' },
    },
    inventory: { normalCounter: false, ownedNormal: false, ownedGogma: true },
    bounds: bounds(1, 1, resetCount, 0),
    note: 'One Owned Gogma base whose current bonuses are already Ideal, so only the Skill stream searches.',
  }),
)

/**
 * The Gogma axis in isolation.
 *
 * The mirror of the Skill sweep: the Owned Gogma source's current Skills are
 * the Ideal skill anchor, so its Skill stream is inactive and only Reset /
 * Keep Bonuses advance. The source is `gogma_artian` scope and unprotected, so
 * both amendments are Production-supported.
 */
const gogmaScaling = [10, 25, 50, 100, 200].map(
  (advance): ConstrainedEnumerationBenchmarkWorkload => ({
    id: `constrained_gogma_${advance}`,
    label: `C. Gogma advance ${advance}`,
    group: 'gogma',
    ideal: {
      bonuses: { kind: 'unreachable' },
      skills: { kind: 'owned_gogma_current' },
    },
    inventory: { normalCounter: false, ownedNormal: false, ownedGogma: true },
    bounds: bounds(1, advance, 1, 0),
    note: 'One Owned Gogma base whose current Skills are already Ideal, so only the Bonus stream searches.',
  }),
)

/**
 * The off-axis budget sweep.
 *
 * One Owned Gogma base with both streams active, so `B(c)` and `K(c)` are both
 * non-trivial and off-axis cells `(i > 0, j > 0)` genuinely exist. Only
 * `maxOffAxisPairEvaluations` varies inside one `G/S` pair.
 */
const offAxisBudgets = [0, 10, 25, 50, 100, 250, 500, 1000]
const offAxisScaling = [10, 25].flatMap((depth) =>
  offAxisBudgets.map(
    (budget): ConstrainedEnumerationBenchmarkWorkload => ({
      id: `constrained_off_axis_${depth}_${budget}`,
      label: `D. Off-axis G/S ${depth}/${depth}, budget ${budget}`,
      group: 'off_axis',
      ideal: {
        bonuses: { kind: 'unreachable' },
        skills: { kind: 'unreachable' },
      },
      inventory: { normalCounter: false, ownedNormal: false, ownedGogma: true },
      bounds: bounds(1, depth, depth, budget),
      note: 'One Owned Gogma base with both streams active; only the off-axis budget varies.',
    }),
  ),
)

/**
 * The combined workload that actually decides the Production defaults.
 *
 * It is the shape a Planner constrained re-search meets: a Normal Counter, an
 * Owned Normal source, an Owned Gogma source, both streams active on every
 * base, and no Ideal nearby. Single-axis numbers are never summed into a
 * default; a chosen tuple must have been measured here.
 */
const combinedTuples: ReadonlyArray<readonly [number, number, number, number]> = [
  [10, 10, 25, 25],
  [25, 25, 50, 50],
  [50, 25, 100, 100],
  [100, 50, 200, 250],
  [250, 100, 500, 500],
]
const combinedScaling = combinedTuples.map(
  ([normal, gogma, skill, offAxis]): ConstrainedEnumerationBenchmarkWorkload => ({
    id: `constrained_combined_${normal}_${gogma}_${skill}_${offAxis}`,
    label: `E. Combined N/G/S/O ${normal}/${gogma}/${skill}/${offAxis}`,
    group: 'combined',
    ideal: { bonuses: { kind: 'unreachable' }, skills: { kind: 'unreachable' } },
    inventory: { normalCounter: true, ownedNormal: true, ownedGogma: true },
    bounds: bounds(normal, gogma, skill, offAxis),
    note: 'Every currently legal Route base with both streams active and no Ideal nearby.',
  }),
)

export const constrainedEnumerationBenchmarkWorkloads: readonly ConstrainedEnumerationBenchmarkWorkload[] =
  [
    ...normalScaling,
    ...skillScaling,
    ...gogmaScaling,
    ...offAxisScaling,
    ...combinedScaling,
  ]

export function constrainedEnumerationBenchmarkWorkload(
  id: string,
): ConstrainedEnumerationBenchmarkWorkload {
  const workload = constrainedEnumerationBenchmarkWorkloads.find(
    (entry) => entry.id === id,
  )
  if (!workload) {
    throw new RangeError(`Unknown constrained enumeration benchmark workload: ${id}`)
  }
  return workload
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

function benchmarkRngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: {
      value: CONSTRAINED_BENCHMARK_BASE_SEED,
      isConfirmed: true,
      source: 'observation',
    },
    gogmaCounter: {
      value: CONSTRAINED_BENCHMARK_GOGMA_COUNTER,
      isConfirmed: true,
      source: 'manual',
    },
    skillCounter: {
      value: CONSTRAINED_BENCHMARK_SKILL_COUNTER,
      isConfirmed: true,
      source: 'observation',
    },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function benchmarkNormalCounter(): NormalArtianCounter {
  return {
    id: `${CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID}:${V1_NORMAL_ARTIAN_RARITY}`,
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    counter: CONSTRAINED_BENCHMARK_NORMAL_COUNTER,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: FIXTURE_TIME,
    candidateCount: 1,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function skillsAtCounter(
  skillCounter: number,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): SkillPredictionResult {
  return engine.predictSkills({
    baseSeed: CONSTRAINED_BENCHMARK_BASE_SEED,
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    skillCounter,
    master,
  })
}

function resetBonusesAtDepth(
  depth: number,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): RestorationBonusSet {
  return engine.predictGogmaBonus({
    baseSeed: CONSTRAINED_BENCHMARK_BASE_SEED,
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    gogmaCounter: CONSTRAINED_BENCHMARK_GOGMA_COUNTER + depth - 1,
    operation: { type: 'reset_bonuses' },
    master,
  })
}

function normalBonusesAtCounter(
  normalCounter: number,
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): RestorationBonusSet {
  return engine.predictNormalArtian({
    baseSeed: CONSTRAINED_BENCHMARK_BASE_SEED,
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    normalCounter,
    master,
  })
}

/**
 * The synthetic Owned Gogma benchmark source, built exactly like B5's: five
 * slots from a Production Reset result at a far Gogma depth and Skills from a
 * Production Skill result at a far Skill Counter, so no cheaper Route inside
 * the measured horizon reproduces them. It is unprotected and `material`, so
 * Reset Bonuses and Keep Bonuses are both legal on it.
 */
export function constrainedBenchmarkOwnedGogma(
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): OwnedGogmaArtianWeapon {
  const skills = skillsAtCounter(OWNED_GOGMA_SOURCE_SKILL_COUNTER, master, engine)
  return {
    id: OWNED_GOGMA_SOURCE_ID,
    kind: 'gogma',
    name: 'B8 benchmark Gogma source',
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    restorationBonuses: resetBonusesAtDepth(
      OWNED_GOGMA_SOURCE_BONUS_DEPTH,
      master,
      engine,
    ),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
    status: 'material',
    isProtected: false,
    relatedTargetWeaponIds: [],
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

/**
 * The synthetic Owned Normal benchmark source. Its five slots are a Production
 * Normal Artian result from a Normal block far from the starting counter, so
 * the `owned_normal_artian_to_gogma` base is a genuinely different base from
 * every `normal_artian_to_gogma` offset rather than a duplicate of one.
 */
export function constrainedBenchmarkOwnedNormal(
  master: SearchMasterSubset,
  engine: ProductionRngEngine,
): OwnedNormalArtianWeapon {
  return {
    id: OWNED_NORMAL_SOURCE_ID,
    kind: 'normal',
    name: 'B8 benchmark Normal source',
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    restorationBonuses: normalBonusesAtCounter(
      OWNED_NORMAL_SOURCE_COUNTER,
      master,
      engine,
    ),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    relatedTargetWeaponIds: [],
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}



export interface ConstrainedEnumerationBenchmarkFixture {
  readonly input: ConstrainedCandidateSearchInput
  readonly workload: ConstrainedEnumerationBenchmarkWorkload
}

/**
 * Builds one deterministic benchmark input.
 *
 * The origin is a `ConstrainedSearchOrigin`, not a `CandidateSearchInput`: it
 * carries no `searchRunId`, `routeFilter`, `resultFilter`, or
 * `CandidateSearchSettings`, exactly as SEARCH_SPEC 5.6.7 requires. The
 * Ideal-implies-Practical containment is asserted here rather than assumed.
 */
export function createConstrainedEnumerationBenchmarkInput(
  workloadId: string,
): ConstrainedEnumerationBenchmarkFixture {
  const workload = constrainedEnumerationBenchmarkWorkload(workloadId)
  const { master, context } = benchmarkMaster()
  const engine = new ProductionRngEngine()
  const ownedGogma = constrainedBenchmarkOwnedGogma(master, engine)

  const idealBonuses: RestorationBonusSet =
    workload.ideal.bonuses.kind === 'owned_gogma_current'
      ? ownedGogma.restorationBonuses
      : ownedGogma.restorationBonuses.map((bonus) => ({ ...bonus, bonusRankId: 'bonus_rank.ex' })) as RestorationBonusSet

  const idealSkillCondition: SkillCondition =
    workload.ideal.skills.kind === 'owned_gogma_current'
      ? {
          seriesSkillId: ownedGogma.seriesSkillId,
          groupSkillId: ownedGogma.groupSkillId,
          matchMode: 'all',
        }
      : {
          seriesSkillId: skillsAtCounter(CONSTRAINED_BENCHMARK_SKILL_COUNTER, master, engine).seriesSkillId,
          groupSkillId: UNREACHABLE_GROUP_SKILL_ID,
          matchMode: 'all',
        }

  const target: TargetWeapon = {
    id: TARGET_ID,
    name: 'B8 benchmark target',
    weaponTypeId: CONSTRAINED_BENCHMARK_WEAPON_TYPE_ID,
    elementId: CONSTRAINED_BENCHMARK_ELEMENT_ID,
    priority: 3,
    isEnabled: true,
    idealBonuses,
    practicalBonusConditions: benchmarkPracticalBonuses(idealBonuses),
    alternativeBonusRules: [],
    idealSkillCondition,
    practicalSkillCondition: workload.inventory.ownedGogma ? { seriesSkillId: idealSkillCondition.seriesSkillId, groupSkillId: ownedGogma.groupSkillId, matchMode: 'any' } : benchmarkPracticalSkills(idealSkillCondition),
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

  const ownedWeapons: OwnedWeapon[] = [
    ...(workload.inventory.ownedNormal
      ? [constrainedBenchmarkOwnedNormal(master, engine)]
      : []),
    ...(workload.inventory.ownedGogma ? [ownedGogma] : []),
  ]

  const origin: ConstrainedSearchOrigin = {
    rngState: benchmarkRngState(),
    normalCounters: workload.inventory.normalCounter ? [benchmarkNormalCounter()] : [],
    ownedWeapons,
    targetWeapons: [target],
    master,
    calculationContext: { ...context, rngEngineVersion: engine.version },
  }

  return {
    workload,
    input: {
      origin,
      targetWeaponId: target.id,
      bounds: { ...workload.bounds },
    },
  }
}
