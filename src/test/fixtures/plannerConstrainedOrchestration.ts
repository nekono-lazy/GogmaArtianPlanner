import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../../domain/models/hashing'
import { createTargetDefinitionHash } from '../../domain/buildList'
import type { FakeRngEngine } from '../../domain/rng/fakeRngEngine'
import type { ConstrainedSearchOrigin } from '../../domain/search'
import {
  defaultPlannerOptions,
  type PlannerConflictResolution,
  type PlannerDependencies,
  type PlannerInput,
} from '../../domain/planner/plannerTypes'
import type { PlannerOrchestrationBounds } from '../../domain/planner/constrained/plannerOrchestrationBounds'
import type { ConstrainedEnumerationBounds } from '../../domain/search'
import {
  buildListEntryId,
  candidateId,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from './domainData'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  CONSTRAINED_START_SKILL_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  alternativePracticalBonuses,
  belowPracticalBonuses,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  idealBonuses,
  practicalBonuses,
  type ConstrainedEngineOptions,
} from './constrainedEnumeration'

/**
 * Deterministic fixtures for the B8-C4b Planner constrained-search
 * orchestration.
 *
 * They deliberately reuse the B8-B1 constrained enumeration fixtures, so one
 * Fake Engine answers both the constrained enumerator and the ordinary Planner
 * / Trace Replay over the same origin snapshot. Every prediction remains an
 * explicit fixture entry; no Production RNG behavior is implied.
 */

export const ORCHESTRATION_SOURCE_A = 'owned.orchestration.a'
export const ORCHESTRATION_SOURCE_B = 'owned.orchestration.b'

/**
 * The Gogma Counter both original Entries fight over, and the position every
 * bonus-amendment Route reachable from the origin has to start at.
 */
export const CONFLICT_GOGMA_COUNTER = CONSTRAINED_START_GOGMA_COUNTER
export const CONFLICT_SKILL_COUNTER = CONSTRAINED_START_SKILL_COUNTER

/** The default Target: Practical is bonus-only, exactly as in domainData. */
export function orchestrationTarget(
  id: string,
  overrides: Partial<TargetWeapon> = {},
): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    name: `Orchestration fixture ${id}`,
    ...overrides,
  }
}

/**
 * A Target whose Practical condition also requires the Ideal Series Skill.
 *
 * That makes a Reset-Skills-only Route a genuine Practical solution, which is
 * how a constrained Candidate can avoid the contested Gogma Counter entirely.
 * Ideal still implies Practical: both skill conditions name the same Series
 * Skill with `matchMode: 'all'`.
 */
export function skillConstrainedTarget(
  id: string,
  overrides: Partial<TargetWeapon> = {},
): TargetWeapon {
  return orchestrationTarget(id, {
    practicalSkillCondition: {
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
      groupSkillId: null,
      matchMode: 'all',
    },
    ...overrides,
  })
}

export function orchestrationSource(
  id: string,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  return gogmaWeapon(id, {
    restorationBonuses: belowPracticalBonuses(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.z',
    groupSkillId: null,
    status: 'unclassified',
    isProtected: false,
    ...overrides,
  })
}

export function resetRoute(
  sourceId: string,
  gogmaCounter = CONFLICT_GOGMA_COUNTER,
): BuildRoute {
  return {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [{
      type: 'reset_bonuses',
      sourceOwnedWeaponId: ownedWeaponId(sourceId),
      gogmaCounterBefore: gogmaCounter,
      gogmaCounterAfter: gogmaCounter + 1,
    }],
  }
}

export function resetSkillsRoute(
  sourceId: string,
  skillCounter = CONFLICT_SKILL_COUNTER,
): BuildRoute {
  return {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [{
      type: 'reset_skills',
      sourceOwnedWeaponId: ownedWeaponId(sourceId),
      skillCounterBefore: skillCounter,
      skillCounterAfter: skillCounter + 1,
    }],
  }
}

export interface OrchestrationEntryOptions {
  category?: 'ideal' | 'practical'
  finalBonuses?: RestorationBonusSet
  seriesSkillId?: string | null
}

/**
 * A BuildListEntry whose Candidate snapshot matches what the Fake Engine
 * actually predicts along the Route, so Trace Replay reproduces it.
 */
export function orchestrationEntry(
  id: string,
  target: TargetWeapon,
  route: BuildRoute,
  options: OrchestrationEntryOptions = {},
): BuildListEntry {
  const entry = createValidBuildListEntry()
  entry.id = buildListEntryId(id)
  entry.candidateId = candidateId(`candidate.${id}`)
  entry.targetWeaponId = target.id
  const snapshot = entry.candidateSnapshot
  snapshot.id = entry.candidateId
  snapshot.targetWeaponId = target.id
  snapshot.route = structuredClone(route)
  snapshot.category = options.category ?? 'ideal'
  snapshot.isSimilarToIdeal = false
  snapshot.finalBonuses = options.finalBonuses ?? idealBonuses()
  snapshot.restorationBonusScope = 'gogma_artian'
  snapshot.seriesSkillId =
    options.seriesSkillId === undefined
      ? IDEAL_SERIES_SKILL_ID
      : options.seriesSkillId
  snapshot.groupSkillId = null
  snapshot.requiredMaterials = []
  snapshot.estimatedOperationCount = route.operations.length
  snapshot.estimatedGogmaAdvance = route.operations.filter(({ type }) =>
    type === 'reset_bonuses' || type === 'keep_bonuses',
  ).length
  snapshot.estimatedSkillAdvance = route.operations.filter(({ type }) =>
    type === 'convert_normal_to_gogma' || type === 'reset_skills',
  ).length
  snapshot.estimatedNormalAdvance = null
  return entry
}

/** Keeps every derived hash of an Entry consistent with the Planner input. */
export function synchronizeOrchestrationEntry(
  input: PlannerInput,
  entry: BuildListEntry,
): void {
  const target = input.targetWeapons.find(({ id }) => id === entry.targetWeaponId)
  if (!target) throw new Error('Fixture Target is missing.')
  entry.calculationContext = { ...input.calculationContext }
  entry.candidateSnapshot.calculationContext = { ...input.calculationContext }
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    input.rngState,
    input.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    input.ownedWeapons,
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash =
    entry.referencedOwnedWeaponsHash
  entry.isStale = false
  entry.staleReasons = []
}

export interface OrchestrationScenarioOptions {
  targets: TargetWeapon[]
  entries: BuildListEntry[]
  ownedWeapons?: OwnedWeapon[]
  /** Empty by default so the Normal forge Route stays out of the fixture. */
  normalCounters?: PlannerInput['normalCounters']
  conflictResolutions?: PlannerConflictResolution[]
  engine?: ConstrainedEngineOptions
}

export interface OrchestrationScenario {
  input: PlannerInput
  dependencies: PlannerDependencies
  origin: ConstrainedSearchOrigin
  engine: FakeRngEngine
  idCounts: { plan: number; step: number; owned: number }
}

/**
 * The default Gogma Reset results.
 *
 * Position 10 is the contested one and yields the Ideal five slots, so every
 * Ideal Candidate must fight for it. Positions 11 and 12 yield two distinct
 * Practical results, and everything else stays below the Practical line.
 */
export function orchestrationResetResultAt(gogmaCounter: number): RestorationBonusSet {
  if (gogmaCounter === CONFLICT_GOGMA_COUNTER) return idealBonuses()
  if (gogmaCounter === CONFLICT_GOGMA_COUNTER + 1) return practicalBonuses()
  if (gogmaCounter === CONFLICT_GOGMA_COUNTER + 2) return alternativePracticalBonuses()
  return belowPracticalBonuses()
}

/** The Ideal Series Skill sits at the first reachable Skill position. */
export function orchestrationSkillResultAt(skillCounter: number) {
  return skillCounter === CONFLICT_SKILL_COUNTER
    ? { seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: null }
    : { seriesSkillId: `series_skill.fixture.s${skillCounter}`, groupSkillId: null }
}

export function orchestrationScenario(
  options: OrchestrationScenarioOptions,
): OrchestrationScenario {
  const ownedWeapons = options.ownedWeapons ?? []
  const origin = createConstrainedSearchOrigin({
    ownedWeapons: structuredClone(ownedWeapons),
    normalCounters: structuredClone(options.normalCounters ?? []),
    target: options.targets[0],
    extraTargetWeapons: options.targets.slice(1),
  })
  const engine = createConstrainedEngine(origin, {
    resetResultAt: orchestrationResetResultAt,
    skillResultAt: orchestrationSkillResultAt,
    ...options.engine,
  })
  const input: PlannerInput = {
    rngState: structuredClone(origin.rngState),
    normalCounters: structuredClone(origin.normalCounters),
    ownedWeapons: structuredClone(origin.ownedWeapons),
    targetWeapons: structuredClone(origin.targetWeapons),
    buildListEntries: options.entries,
    calculationContext: structuredClone(origin.calculationContext),
    options: { ...defaultPlannerOptions },
    master: structuredClone(origin.master),
    conflictResolutions: options.conflictResolutions ?? [],
  }
  options.entries.forEach((entry) => synchronizeOrchestrationEntry(input, entry))
  const idCounts = { plan: 0, step: 0, owned: 0 }
  return {
    input,
    dependencies: {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => `plan.orchestration.${++idCounts.plan}` as never,
        planStepId: () => `step.orchestration.${++idCounts.step}` as never,
        ownedWeaponId: () =>
          ownedWeaponId(`owned.orchestration.created.${++idCounts.owned}`),
      },
      clock: { now: () => '2026-09-05T00:00:00.000Z' },
    },
    origin,
    engine,
    idCounts,
  }
}

export function orchestrationBounds(
  overrides: Partial<PlannerOrchestrationBounds> = {},
): PlannerOrchestrationBounds {
  return {
    maxCandidateTrialsPerConflict: 8,
    maxGeneratedBuildListEntries: 4,
    maxPlannerReruns: 16,
    ...overrides,
  }
}

export function orchestrationEnumerationBounds(
  overrides: Partial<ConstrainedEnumerationBounds> = {},
): ConstrainedEnumerationBounds {
  return {
    maxNormalForgeCount: 1,
    maxGogmaAdvance: 3,
    maxSkillResetCount: 2,
    maxOffAxisPairEvaluations: 0,
    ...overrides,
  }
}

/** A normal Artian counter for the scenarios that deliberately enable forging. */
export function orchestrationNormalCounters() {
  return [createValidNormalArtianCounter()]
}

export { CONSTRAINED_START_NORMAL_COUNTER } from './constrainedEnumeration'
