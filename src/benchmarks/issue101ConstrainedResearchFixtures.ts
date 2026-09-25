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
import type { PlannerConflictResolution, PlannerInput } from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  searchCandidates,
  validateConstrainedEnumerationBounds,
} from '../domain/search'
import type {
  CandidateSearchSettings,
  ConstrainedCandidateSearchInput,
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
  SearchMasterSubset,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'

/**
 * Issue #101 constrained re-search benchmark fixtures.
 *
 * Two different things live here and are kept apart on purpose:
 *
 * - **Issue #101 real case** (`issue101_real_*`): the RNG state recorded in the
 *   Issue (Base Seed 51231782, Skill Counter 341, Gogma Counter 55, Charge
 *   Blade Normal Counter 0) and the Issue's own Ideal (斬れ味・装填強化EX x1,
 *   属性強化EX x2, 属性強化II x2) for a Fire and a Dragon Charge Blade Target.
 *   The two BuildListEntries carry the Candidates the unmodified current
 *   Candidate Search returns for them - nothing about the Route is taken from
 *   the Issue text, so a later RNG / Search change shows up as a fixture
 *   change instead of being hidden by a hard-coded Route.
 * - **Production benchmark fixture** (`issue101_no_ideal`): the same RNG state
 *   and weapon, but a Fire Target whose Ideal the Production RNG can never
 *   produce (three 属性強化EX: the exact-ID repeat penalty of both Reset and
 *   Keep takes an EX candidate from 100 to 20 to 0, so a third EX of one type
 *   has zero weight). It exists only to measure the constrained enumeration's
 *   full traversal cost when no Ideal is inside the extent; it is not the
 *   Issue #101 case.
 *
 * - **Production benchmark fixture** (`issue101_approx_owned_dragon`): the
 *   Issue #101 real case with one difference - the Dragon side already holds
 *   the Gogma a Normal forged at Counter 206 and converted would be (a
 *   synthetic owned Gogma whose five `normal_artian` slots are the Production
 *   Normal prediction at Normal Counter 206). Its Candidate therefore performs
 *   no conversion, so the Fire alternative no longer collides with it at Skill
 *   Counter 341. It exists only so the time to an *adopted* Candidate can be
 *   measured; it is not the Issue #101 case (see
 *   `docs/ISSUE_101_CONSTRAINED_RESEARCH_BENCHMARK.md`).
 *
 * Every Candidate comes from `searchCandidates()` with the unmodified
 * `ProductionRngEngine`, every Entry from `createBuildListEntry()`, and every
 * conflict key from `preparePlannerInitialContext()`. No Candidate result,
 * Counter position, or conflict key is hand-written.
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

/** The historical B8-B2 Production enumeration default, the sweep baseline. */
export const ISSUE_101_BASELINE_BOUNDS: ConstrainedEnumerationBounds = {
  maxNormalForgeCount: 40,
  maxGogmaAdvance: 30,
  maxSkillResetCount: 100,
  maxOffAxisPairEvaluations: 500,
}

/** The Gogma sweep this task measures; Normal / Skill / off-axis stay at baseline. */
export const ISSUE_101_GOGMA_SWEEP = [30, 50, 100, 150, 200, 250, 350] as const

export function issue101GogmaBounds(maxGogmaAdvance: number): ConstrainedEnumerationBounds {
  return { ...ISSUE_101_BASELINE_BOUNDS, maxGogmaAdvance }
}

/**
 * Fails closed on invalid bounds with the existing Search Domain validator,
 * before any Worker is created. Nothing is repaired or clamped.
 */
export function assertIssue101EnumerationBounds(bounds: ConstrainedEnumerationBounds): void {
  const issues = validateConstrainedEnumerationBounds(bounds)
  if (issues.length > 0) {
    throw new RangeError(
      `Invalid ConstrainedEnumerationBounds: ${issues.map(({ path, message }) => `${path}: ${message}`).join(' / ')}`,
    )
  }
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

export function createIssue101ConstrainedOrigin(
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

/**
 * Which explicit `PlannerConflictResolution`s the orchestration input carries.
 * The fixed side is always the Dragon Entry (the Issue's example: 206 goes to
 * 龍, 火 looks for another Route), so the constrained re-search works on Fire.
 *
 * - `primary`: the user preferred Dragon on one conflict only - the
 *   `same_normal_counter` conflict the Issue names in the real case, and the
 *   one `same_gogma_counter` conflict in the approximate case.
 * - `all`: the user preferred Dragon on every initial conflict of the pair.
 *
 * This is a fixture choice made so a workload is reproducible; it never
 * stands in for a user decision in Production, and
 * `recommendedBuildListEntryId` is never read.
 */
export type Issue101ResolutionScope = 'primary' | 'all'

/** Which pair the orchestration fixture holds. */
export type Issue101OrchestrationVariant = 'real' | 'approx_owned_dragon'

export const ISSUE_101_APPROX_DRAGON_WEAPON_ID =
  'owned.issue101.approx.dragon' as OwnedWeaponId
/** The Normal Counter whose forge the synthetic Dragon Gogma stands for. */
export const ISSUE_101_APPROX_DRAGON_NORMAL_COUNTER = 206
/** Far outside every measured Skill horizon, so it never matches a Route result. */
const APPROX_DRAGON_SKILL_COUNTER = 900

/**
 * The synthetic owned Dragon Gogma of the approximate fixture: its five slots
 * are the Production Normal prediction at Charge Blade Normal Counter 206 with
 * `normal_artian` scope (what forging and converting that weapon leaves), and
 * its Skills a Production Skill prediction far away. Nothing is guessed.
 */
export function createIssue101ApproxDragonWeapon(): OwnedGogmaArtianWeapon {
  const { master } = issue101Master()
  const engine = new ProductionRngEngine()
  const skills = engine.predictSkills({
    baseSeed: ISSUE_101_BASE_SEED,
    skillCounter: APPROX_DRAGON_SKILL_COUNTER,
    weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
    elementId: DRAGON,
    master,
  })
  return {
    id: ISSUE_101_APPROX_DRAGON_WEAPON_ID,
    kind: 'gogma',
    name: 'Issue #101 benchmark: owned Dragon Gogma (Normal 206)',
    weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
    elementId: DRAGON,
    restorationBonuses: engine.predictNormalArtian({
      baseSeed: ISSUE_101_BASE_SEED,
      weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
      elementId: DRAGON,
      rarity: V1_NORMAL_ARTIAN_RARITY,
      normalCounter: ISSUE_101_APPROX_DRAGON_NORMAL_COUNTER,
      master,
    }),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: skills.seriesSkillId,
    groupSkillId: skills.groupSkillId,
    status: 'unclassified',
    isProtected: false,
    executionInProgress: null,
    memo: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

export interface Issue101RealFixture {
  readonly variant: Issue101OrchestrationVariant
  readonly fireCandidate: BuildCandidate
  readonly dragonCandidate: BuildCandidate
  readonly fireEntry: BuildListEntry
  readonly dragonEntry: BuildListEntry
  /** The ordinary Planner input: no resolution, so no constrained re-search. */
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
 * Builds the Issue #101 real case (or its approximate variant) with the
 * current Production authorities. It runs two real Candidate Searches, so
 * callers cache it.
 */
export async function createIssue101RealFixture(
  variant: Issue101OrchestrationVariant = 'real',
): Promise<Issue101RealFixture> {
  const { master, context } = issue101Master()
  const engine = new ProductionRngEngine()
  const { fire, dragon } = createIssue101Targets()
  const targetWeapons = [fire, dragon]
  const ownedWeapons = variant === 'real' ? [] : [createIssue101ApproxDragonWeapon()]
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
    variant,
    fireCandidate,
    dragonCandidate,
    fireEntry,
    dragonEntry,
    plannerInput,
    initialConflicts: structuredClone(prepared.context.initialConflictDetection.conflicts),
  }
}

/**
 * The orchestration input: the ordinary input plus explicit resolutions that
 * fix the Dragon Entry, built from the conflict keys the Planner itself
 * reported. Never a hand-written key.
 */
export function createIssue101OrchestrationInput(
  fixture: Issue101RealFixture,
  scope: Issue101ResolutionScope,
): PlannerInput {
  // The approximate variant has no Normal conflict: its Dragon side forges
  // nothing, so `primary` there means the one Gogma conflict it does have.
  const primaryKind =
    fixture.variant === 'real' ? 'same_normal_counter' : 'same_gogma_counter'
  const conflicts = fixture.initialConflicts.filter((conflict) =>
    scope === 'all' ? true : conflict.kind === primaryKind,
  )
  if (conflicts.length === 0) {
    throw new Error(`Issue #101 fixture: no initial conflict for resolution scope '${scope}'.`)
  }
  const conflictResolutions: PlannerConflictResolution[] = conflicts.map((conflict) => {
    if (!conflict.buildListEntryIds.includes(fixture.dragonEntry.id)) {
      throw new Error(`Issue #101 fixture: conflict '${conflict.id}' has no Dragon participant.`)
    }
    return { conflictKey: conflict.id, selectedBuildListEntryId: fixture.dragonEntry.id }
  })
  return { ...structuredClone(fixture.plannerInput), conflictResolutions }
}

/** The enumeration input for the Issue #101 real case: the Fire (yielding) Target. */
export function createIssue101RealEnumerationInput(
  bounds: ConstrainedEnumerationBounds,
): ConstrainedCandidateSearchInput {
  assertIssue101EnumerationBounds(bounds)
  const { fire, dragon } = createIssue101Targets()
  return {
    origin: createIssue101ConstrainedOrigin([fire, dragon]),
    targetWeaponId: fire.id,
    bounds: { ...bounds },
  }
}

/** Production benchmark fixture only: an Ideal no bound can reach. */
export function createIssue101NoIdealEnumerationInput(
  bounds: ConstrainedEnumerationBounds,
): ConstrainedCandidateSearchInput {
  assertIssue101EnumerationBounds(bounds)
  const { master } = issue101Master()
  const target = createTarget(
    'target.issue101.no_ideal' as TargetWeaponId,
    'Issue #101 benchmark: unreachable Ideal',
    FIRE,
    ISSUE_101_UNREACHABLE_IDEAL_BONUSES,
    master,
  )
  return {
    origin: createIssue101ConstrainedOrigin([target]),
    targetWeaponId: target.id,
    bounds: { ...bounds },
  }
}

export type Issue101EnumerationWorkloadId = 'issue101_real_fire' | 'issue101_no_ideal'

export function createIssue101EnumerationInput(
  workloadId: Issue101EnumerationWorkloadId,
  bounds: ConstrainedEnumerationBounds,
): ConstrainedCandidateSearchInput {
  switch (workloadId) {
    case 'issue101_real_fire':
      return createIssue101RealEnumerationInput(bounds)
    case 'issue101_no_ideal':
      return createIssue101NoIdealEnumerationInput(bounds)
  }
}
