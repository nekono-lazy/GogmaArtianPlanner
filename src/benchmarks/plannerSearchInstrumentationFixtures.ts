import { benchmarkPracticalBonuses } from './targetCompromiseFixture'
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  V1_NORMAL_ARTIAN_RARITY,
} from '../domain/models/publicTypes'
import type {
  BuildListEntry,
  BuildRoute,
  CalculationContext,
  ElementId,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
  RngState,
  RouteOperation,
  TargetWeapon,
  TargetWeaponId,
  WeaponTypeId,
} from '../domain/models/publicTypes'
import type { PlannerInput, PlannerOptions } from '../domain/planner'
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
  CONSTRAINED_BENCHMARK_GOGMA_COUNTER,
  CONSTRAINED_BENCHMARK_NORMAL_COUNTER,
  CONSTRAINED_BENCHMARK_SKILL_COUNTER,
} from './constrainedEnumerationBenchmarkFixtures'

/**
 * Issue #103 Planner search instrumentation fixtures.
 *
 * These workloads exist to *observe* the ordinary Beam Search; they are not a
 * performance target and never decide a default. Every one is Production-valid:
 *
 * 1. `ProductionRngEngine` supplies each source weapon's five slots and Skills
 *    and each Route's final result. No Fake Engine, no hand-written result.
 * 2. Each Target's Ideal is exactly its Route's Production result, so
 *    `createCandidateFromPrediction()` - the ordinary Candidate authority -
 *    classifies it as the Ideal and computes the hashes.
 * 3. `createBuildListEntry()` produces the ordinary persisted Entry, non-stale
 *    against the very state the Planner receives.
 *
 * The Route shapes mirror what Candidate Search produces from one shared RNG
 * origin: a Bonus lane that Resets at every Gogma position from the current
 * Counter up to its result (optionally ending in Keeps), and a Skill lane that
 * Resets Skills at every Skill position up to its result. Every Route therefore
 * starts at the same Counters, and every intermediate Reset is
 * `canSkipWhenCounterPassed`, which is the shape of a real multi-Target Build
 * List. No real user data is contained here.
 */

export const PLANNER_SEARCH_INSTRUMENTATION_BASE_SEED = CONSTRAINED_BENCHMARK_BASE_SEED
export const PLANNER_SEARCH_INSTRUMENTATION_GOGMA_COUNTER =
  CONSTRAINED_BENCHMARK_GOGMA_COUNTER
export const PLANNER_SEARCH_INSTRUMENTATION_SKILL_COUNTER =
  CONSTRAINED_BENCHMARK_SKILL_COUNTER
export const PLANNER_SEARCH_INSTRUMENTATION_NORMAL_COUNTER =
  CONSTRAINED_BENCHMARK_NORMAL_COUNTER

const FIXTURE_TIME = '2026-09-24T00:00:00.000Z'
const FIXTURE_SEARCH_RUN_ID = 'issue-103-planner-search-instrumentation'
/** Far outside every Route, so no source already holds its Target's result. */
const SOURCE_BONUS_OFFSET = 2_000
const SOURCE_SKILL_OFFSET = 3_000

export type PlannerSearchInstrumentationRouteShape =
  | {
      readonly kind: 'existing_gogma'
      /** Reset Bonuses operations from the current Gogma Counter. */
      readonly bonusResets: number
      /** Keep Bonuses operations after the last Reset. */
      readonly keepTail: number
      /** Reset Skills operations from the current Skill Counter. */
      readonly skillResets: number
    }
  | {
      readonly kind: 'new_normal'
      /** Normal forges from the current Normal Counter of the weapon type. */
      readonly forgeCount: number
      /** Reset Bonuses after the conversion; at least one. */
      readonly bonusResets: number
      /** Reset Skills after the conversion. */
      readonly skillResets: number
    }

export interface PlannerSearchInstrumentationTargetSpec {
  readonly key: string
  readonly weaponTypeId: WeaponTypeId
  readonly elementId: ElementId
  readonly route: PlannerSearchInstrumentationRouteShape
}

export interface PlannerSearchInstrumentationWorkload {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly options: PlannerOptions
  readonly targets: readonly PlannerSearchInstrumentationTargetSpec[]
}

const WEAPON_TYPES: readonly WeaponTypeId[] = [
  'weapon.great_sword',
  'weapon.long_sword',
  'weapon.sword_and_shield',
  'weapon.dual_blades',
  'weapon.hammer',
  'weapon.hunting_horn',
  'weapon.lance',
  'weapon.gunlance',
  'weapon.switch_axe',
  'weapon.charge_blade',
  'weapon.insect_glaive',
  'weapon.bow',
  'weapon.light_bowgun',
  'weapon.heavy_bowgun',
] as WeaponTypeId[]

const ELEMENTS: readonly ElementId[] = [
  'element.fire',
  'element.water',
  'element.thunder',
  'element.ice',
  'element.dragon',
] as ElementId[]

function existing(
  bonusResets: number,
  keepTail: number,
  skillResets: number,
): PlannerSearchInstrumentationRouteShape {
  return { kind: 'existing_gogma', bonusResets, keepTail, skillResets }
}

/**
 * A. Small sanity workload: three Targets, short Routes, and a search that
 * finishes well inside the default bounds. Tests assert metric consistency
 * and instrumentation parity on it.
 */
const SANITY_TARGETS: readonly PlannerSearchInstrumentationTargetSpec[] = [
  {
    key: 'bonus-only',
    weaponTypeId: 'weapon.long_sword' as WeaponTypeId,
    elementId: 'element.fire' as ElementId,
    route: existing(4, 0, 0),
  },
  {
    key: 'skill-only',
    weaponTypeId: 'weapon.hammer' as WeaponTypeId,
    elementId: 'element.water' as ElementId,
    route: existing(0, 0, 2),
  },
  {
    key: 'mixed-keep',
    weaponTypeId: 'weapon.bow' as WeaponTypeId,
    elementId: 'element.thunder' as ElementId,
    route: existing(2, 1, 3),
  },
]

/**
 * Deterministic Route lengths for the representative workloads.
 *
 * The spread imitates a Build List of canonical Ideals found from one RNG
 * origin within the Candidate Search defaults (Gogma 350 / Skill 1500): many
 * short Routes, Bonus lanes up to about 240 Gogma positions and Skill lanes up
 * to about 170 Skill positions, some Routes with only one lane, a few ending in
 * Keeps, and every sixth Target forging a new Normal Artian. Colliding end positions are left to
 * the formula on purpose: whatever conflicts the ordinary Planner detects in
 * them are part of the measurement, never hand-placed.
 */
function representativeTargets(
  count: number,
  newNormalEvery: number,
): PlannerSearchInstrumentationTargetSpec[] {
  return Array.from({ length: count }, (_unused, index) => {
    const weaponTypeId = WEAPON_TYPES[index % WEAPON_TYPES.length]
    const elementId = ELEMENTS[(index * 3 + Math.floor(index / WEAPON_TYPES.length)) % ELEMENTS.length]
    // Two independent permutations of 0..count-1 scaled to 0..34, squared so
    // short Routes are common and a few reach a few hundred operations.
    const bonusRank = (((index * 37) % count) * 35) / count
    const skillRank = (((index * 53) % count) * 35) / count
    const bonusResets = index % 9 === 4 ? 0 : 1 + Math.floor((bonusRank * bonusRank) / 5)
    const skillResets = index % 4 === 1 ? 0 : Math.floor((skillRank * skillRank) / 7)
    const keepTail = bonusResets === 0 ? 0 : index % 5 === 0 ? 1 : index % 7 === 3 ? 2 : 0
    const route: PlannerSearchInstrumentationRouteShape =
      newNormalEvery > 0 && index % newNormalEvery === newNormalEvery - 1
        ? {
            kind: 'new_normal',
            forgeCount: 1 + (Math.floor(index / newNormalEvery) % 3),
            bonusResets: Math.max(bonusResets, 1),
            skillResets,
          }
        : existing(bonusResets, keepTail, bonusResets === 0 && skillResets === 0 ? 1 : skillResets)
    return {
      key: `t${String(index).padStart(2, '0')}`,
      weaponTypeId,
      elementId,
      route,
    }
  })
}

/** The Build List settings of the Issue #103 post-#102 baseline report. */
export const ISSUE_103_BASELINE_PLANNER_OPTIONS: PlannerOptions = {
  maxPlanSteps: 1_000,
  maxExpandedStates: 200_000,
  beamWidth: 50,
}

export const PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS: readonly PlannerSearchInstrumentationWorkload[] = [
  {
    id: 'sanity-3',
    label: 'A. Sanity (3 Targets)',
    note: 'Short Routes on three owned Gogma weapons; the search completes inside the default bounds.',
    options: { maxPlanSteps: 300, maxExpandedStates: 10_000, beamWidth: 50 },
    targets: SANITY_TARGETS,
  },
  {
    id: 'representative-12',
    label: 'B-12. Representative (12 Targets, reduced bounds)',
    note: 'The representative Route generator with 12 Targets and 20,000 expanded states, for quick runs and the observer overhead comparison.',
    options: { maxPlanSteps: 1_000, maxExpandedStates: 20_000, beamWidth: 50 },
    targets: representativeTargets(12, 6),
  },
  {
    id: 'representative-35',
    label: 'B-35. Representative (35 Targets, Issue #103 baseline bounds)',
    note: '35 Production-valid Build List Entries sharing one RNG origin, measured with the post-#102 baseline bounds 1000 / 200000 / 50.',
    options: ISSUE_103_BASELINE_PLANNER_OPTIONS,
    targets: representativeTargets(35, 6),
  },
]

export function plannerSearchInstrumentationWorkload(
  workloadId: string,
): PlannerSearchInstrumentationWorkload {
  const workload = PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS.find(
    ({ id }) => id === workloadId,
  )
  if (!workload) {
    throw new Error(`Unknown Planner search instrumentation workload '${workloadId}'.`)
  }
  return workload
}

interface FixtureMaster {
  master: SearchMasterSubset
  context: Omit<CalculationContext, 'rngEngineVersion'>
}

let cachedMaster: FixtureMaster | null = null

function fixtureMaster(): FixtureMaster {
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
    },
  }
  return cachedMaster
}

type Skills = Pick<OwnedGogmaArtianWeapon, 'seriesSkillId' | 'groupSkillId'>

class Predictions {
  private readonly engine: ProductionRngEngine
  private readonly master: SearchMasterSubset

  constructor(engine: ProductionRngEngine, master: SearchMasterSubset) {
    this.engine = engine
    this.master = master
  }

  reset(weaponTypeId: WeaponTypeId, elementId: ElementId, gogmaCounter: number) {
    return this.engine.predictGogmaBonus({
      baseSeed: PLANNER_SEARCH_INSTRUMENTATION_BASE_SEED,
      weaponTypeId,
      elementId,
      gogmaCounter,
      operation: { type: 'reset_bonuses' },
      master: this.master,
    })
  }

  keep(
    weaponTypeId: WeaponTypeId,
    elementId: ElementId,
    gogmaCounter: number,
    currentBonuses: RestorationBonusSet,
  ) {
    return this.engine.predictGogmaBonus({
      baseSeed: PLANNER_SEARCH_INSTRUMENTATION_BASE_SEED,
      weaponTypeId,
      elementId,
      gogmaCounter,
      operation: { type: 'keep_bonuses', currentBonuses },
      master: this.master,
    })
  }

  skills(weaponTypeId: WeaponTypeId, elementId: ElementId, skillCounter: number): Skills {
    const predicted = this.engine.predictSkills({
      baseSeed: PLANNER_SEARCH_INSTRUMENTATION_BASE_SEED,
      weaponTypeId,
      elementId,
      skillCounter,
      master: this.master,
    })
    return {
      seriesSkillId: predicted.seriesSkillId as Skills['seriesSkillId'],
      groupSkillId: predicted.groupSkillId as Skills['groupSkillId'],
    }
  }
}

function fixtureRngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 2,
    baseSeed: {
      value: PLANNER_SEARCH_INSTRUMENTATION_BASE_SEED,
      isConfirmed: true,
      source: 'observation',
    },
    gogmaCounter: {
      value: PLANNER_SEARCH_INSTRUMENTATION_GOGMA_COUNTER,
      isConfirmed: true,
      source: 'observation',
    },
    skillCounter: {
      value: PLANNER_SEARCH_INSTRUMENTATION_SKILL_COUNTER,
      isConfirmed: true,
      source: 'observation',
    },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    lastIdentifiedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function fixtureNormalCounter(weaponTypeId: WeaponTypeId): NormalArtianCounter {
  return {
    id: `${weaponTypeId}:${V1_NORMAL_ARTIAN_RARITY}`,
    weaponTypeId,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    counter: PLANNER_SEARCH_INSTRUMENTATION_NORMAL_COUNTER,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: FIXTURE_TIME,
    candidateCount: 1,
    lastIdentifiedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

interface RouteResult {
  source: OwnedGogmaArtianWeapon | null
  route: BuildRoute
  finalBonuses: RestorationBonusSet
  seriesSkillId: Skills['seriesSkillId']
  groupSkillId: Skills['groupSkillId']
}

function bonusLane(
  spec: PlannerSearchInstrumentationTargetSpec,
  sourceId: OwnedWeaponId | null,
  resets: number,
  keeps: number,
  predictions: Predictions,
  startBonuses: RestorationBonusSet | null,
): { operations: RouteOperation[]; bonuses: RestorationBonusSet } {
  const operations: RouteOperation[] = []
  let bonuses: RestorationBonusSet | null = startBonuses
  let counter = PLANNER_SEARCH_INSTRUMENTATION_GOGMA_COUNTER
  for (let index = 0; index < resets; index += 1) {
    operations.push({
      type: 'reset_bonuses',
      sourceOwnedWeaponId: sourceId,
      gogmaCounterBefore: counter,
      gogmaCounterAfter: counter + 1,
    })
    bonuses = predictions.reset(spec.weaponTypeId, spec.elementId, counter)
    counter += 1
  }
  for (let index = 0; index < keeps; index += 1) {
    operations.push({
      type: 'keep_bonuses',
      sourceOwnedWeaponId: sourceId,
      gogmaCounterBefore: counter,
      gogmaCounterAfter: counter + 1,
    })
    if (bonuses === null) throw new Error('A Keep needs known current bonuses.')
    bonuses = predictions.keep(spec.weaponTypeId, spec.elementId, counter, bonuses)
    counter += 1
  }
  if (bonuses === null) throw new Error('A new Normal Route needs at least one Reset.')
  return { operations, bonuses }
}

function skillLane(
  sourceId: OwnedWeaponId | null,
  from: number,
  resets: number,
): RouteOperation[] {
  return Array.from({ length: resets }, (_unused, index) => ({
    type: 'reset_skills' as const,
    sourceOwnedWeaponId: sourceId,
    skillCounterBefore: from + index,
    skillCounterAfter: from + index + 1,
  }))
}

function createRouteResult(
  spec: PlannerSearchInstrumentationTargetSpec,
  index: number,
  predictions: Predictions,
): RouteResult {
  const skillCounter = PLANNER_SEARCH_INSTRUMENTATION_SKILL_COUNTER
  if (spec.route.kind === 'new_normal') {
    const { forgeCount, bonusResets, skillResets } = spec.route
    const normal = PLANNER_SEARCH_INSTRUMENTATION_NORMAL_COUNTER
    const bonus = bonusLane(spec, null, Math.max(bonusResets, 1), 0, predictions, null)
    const skills = predictions.skills(
      spec.weaponTypeId,
      spec.elementId,
      skillCounter + skillResets,
    )
    return {
      source: null,
      route: {
        kind: 'normal_artian_to_gogma',
        sourceOwnedWeaponId: null,
        operations: [
          {
            type: 'create_normal_artian',
            weaponTypeId: spec.weaponTypeId,
            rarity: V1_NORMAL_ARTIAN_RARITY,
            count: forgeCount,
            normalCounterBefore: normal,
            normalCounterAfter: normal + forgeCount,
          },
          {
            type: 'convert_normal_to_gogma',
            weaponTypeId: spec.weaponTypeId,
            skillCounterBefore: skillCounter,
            skillCounterAfter: skillCounter + 1,
          },
          ...bonus.operations,
          ...skillLane(null, skillCounter + 1, skillResets),
        ],
      },
      finalBonuses: bonus.bonuses,
      ...skills,
    }
  }
  const { bonusResets, keepTail, skillResets } = spec.route
  const sourceId = `owned.issue103.${spec.key}` as OwnedWeaponId
  const sourceBonuses = predictions.reset(
    spec.weaponTypeId,
    spec.elementId,
    PLANNER_SEARCH_INSTRUMENTATION_GOGMA_COUNTER + SOURCE_BONUS_OFFSET + index,
  )
  const sourceSkills = predictions.skills(
    spec.weaponTypeId,
    spec.elementId,
    skillCounter + SOURCE_SKILL_OFFSET + index,
  )
  const source: OwnedGogmaArtianWeapon = {
    id: sourceId,
    kind: 'gogma',
    name: `Issue 103 source ${spec.key}`,
    weaponTypeId: spec.weaponTypeId,
    elementId: spec.elementId,
    restorationBonuses: sourceBonuses,
    restorationBonusScope: 'gogma_artian',
    ...sourceSkills,
    status: 'unclassified',
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
  const bonus = bonusLane(spec, sourceId, bonusResets, keepTail, predictions, sourceBonuses)
  const skills =
    skillResets > 0
      ? predictions.skills(spec.weaponTypeId, spec.elementId, skillCounter + skillResets - 1)
      : sourceSkills
  const hasBonus = bonus.operations.length > 0
  const hasSkill = skillResets > 0
  const kind: BuildRoute['kind'] =
    hasSkill && !hasBonus
      ? 'existing_gogma_reset_skills'
      : hasSkill || keepTail > 0
        ? 'existing_gogma_mixed'
        : 'existing_gogma_reset_bonuses'
  return {
    source,
    route: {
      kind,
      sourceOwnedWeaponId: sourceId,
      operations: [...bonus.operations, ...skillLane(sourceId, skillCounter, skillResets)],
    },
    finalBonuses: bonus.bonuses,
    ...skills,
  }
}

function createTarget(
  spec: PlannerSearchInstrumentationTargetSpec,
  result: RouteResult,
): TargetWeapon {
  const idealBonuses = structuredClone(result.finalBonuses)
  return {
    id: `target.issue103.${spec.key}` as TargetWeaponId,
    name: `Issue 103 ${spec.key}`,
    weaponTypeId: spec.weaponTypeId,
    elementId: spec.elementId,
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    idealBonuses,
    lifecycleStatus: 'active',
    completedAt: null,
    completedByProductionPlanId: null,
    practicalBonusConditions: benchmarkPracticalBonuses(idealBonuses),
    alternativeBonusRules: [],
    idealSkillCondition: {
      seriesSkillId: result.seriesSkillId,
      groupSkillId: result.groupSkillId,
      matchMode: 'all',
    },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface PlannerSearchInstrumentationFixture {
  readonly workload: PlannerSearchInstrumentationWorkload
  readonly input: PlannerInput
  readonly engine: ProductionRngEngine
}

/**
 * Builds one deterministic, Production-valid PlannerInput. Synchronous and
 * side-effect free: no Worker, no persistence, no Clock.
 */
export function createPlannerSearchInstrumentationInput(
  workloadId: string,
): PlannerSearchInstrumentationFixture {
  const workload = plannerSearchInstrumentationWorkload(workloadId)
  const { master, context } = fixtureMaster()
  const engine = new ProductionRngEngine()
  const predictions = new Predictions(engine, master)
  const calculationContext: CalculationContext = {
    ...context,
    rngEngineVersion: engine.version,
  }
  const results = workload.targets.map((spec, index) =>
    createRouteResult(spec, index, predictions),
  )
  const targets = workload.targets.map((spec, index) => createTarget(spec, results[index]))
  targets.forEach((target) => {
    const validation = validateTargetIdealImpliesPractical(target, master)
    if (!validation.isValid) throw new Error(JSON.stringify(validation.issues))
  })
  const ownedWeapons: OwnedWeapon[] = results.flatMap(({ source }) =>
    source === null ? [] : [source],
  )
  const normalCounters = [...new Set(workload.targets.map(({ weaponTypeId }) => weaponTypeId))]
    .sort(compareStableStrings)
    .map(fixtureNormalCounter)
  const rngState = fixtureRngState()
  const searchInput: CandidateSearchInput = {
    searchRunId: FIXTURE_SEARCH_RUN_ID,
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
  const buildListEntries: BuildListEntry[] = workload.targets.map((spec, index) => {
    const result = results[index]
    const candidate = createCandidateFromPrediction(
      targets[index],
      {
        finalBonuses: result.finalBonuses,
        restorationBonusScope: 'gogma_artian',
        seriesSkillId: result.seriesSkillId,
        groupSkillId: result.groupSkillId,
        route: result.route,
      },
      searchInput,
      execution,
    )
    if (candidate === null) {
      throw new Error(
        `Workload '${workloadId}' Target '${spec.key}' produced no Ideal Candidate.`,
      )
    }
    return createBuildListEntry(candidate, targets[index], { createdAt: FIXTURE_TIME })
  })
  return {
    workload,
    engine,
    input: {
      rngState,
      normalCounters,
      ownedWeapons,
      targetWeapons: targets,
      buildListEntries,
      calculationContext,
      options: { ...workload.options },
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
    },
  }
}
