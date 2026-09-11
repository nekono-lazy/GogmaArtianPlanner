import { evaluateTargetCandidate } from '../domain/target'
import { createBuildListEntry } from '../domain/buildList'
import { V1_NORMAL_ARTIAN_RARITY } from '../domain/models/publicTypes'
import type { PlanConflict, TargetWeapon } from '../domain/models/publicTypes'
import {
  createProductionPlannerDependencies,
  preparePlannerInitialContext,
  type PlannerConflictResolution,
  type PlannerInput,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  createCandidateFromPrediction,
  createSearchExecutionContext,
  defaultCandidateSearchSettings,
  type CandidateSearchInput,
} from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import {
  createPlannerOrchestrationBenchmarkInput,
  PLANNER_ORCHESTRATION_BENCHMARK_BASE_SEED as BASE_SEED,
  PLANNER_ORCHESTRATION_BENCHMARK_GOGMA_COUNTER as GOGMA_COUNTER,
  PLANNER_ORCHESTRATION_BENCHMARK_SKILL_COUNTER as SKILL_COUNTER,
  PLANNER_ORCHESTRATION_BENCHMARK_NORMAL_COUNTER as NORMAL_COUNTER,
} from './plannerOrchestrationBenchmarkFixtures'

/** Measurement grid only. These values are NOT Production defaults. */
export const BENCHMARK_ONLY_WHAT_IF_BOUNDS_SWEEP = {
  maxCandidateTrialsPerCategoryPerTarget: [1, 2, 4, 8, 16],
  maxPlannerReruns: [1, 2, 4, 8, 16, 32],
} as const

export const plannerWhatIfBenchmarkWorkloads = [
  {
    id: 'what_if_dual_category',
    label: 'C. Skill conflict: reachable Practical and Ideal',
    baseWorkloadId: 'orchestration_single_conflict_early_adoption',
    participantCount: 2,
    note: 'Conversion entries conflict on Skill; alternate Gogma routes use the independent stream.',
  },
  {
    id: 'what_if_two_targets',
    label: 'A/B. One Gogma conflict: sanity / trial pressure',
    baseWorkloadId: 'orchestration_single_conflict_early_adoption',
    participantCount: 2,
    note: 'One Gogma conflict; reachable Ideal replaces the B8 unreachable Ideal.',
  },
  {
    id: 'what_if_three_targets',
    label: 'D. Three participants: shared rerun budget',
    baseWorkloadId: 'orchestration_trial_and_rerun_pressure',
    participantCount: 3,
    note: 'Three conversion participants; two independent alternatives with reachable Practical / Ideal. Also preserves the Normal conflict resolution.',
  },
  {
    id: 'what_if_combined',
    label: 'E. Five Targets: Gogma scenario plus explicit Skill resolution',
    baseWorkloadId: 'orchestration_combined_multi_target',
    participantCount: 3,
    note: 'Preserves every other explicit resolution through augmented preflight and full reruns.',
  },
] as const

export function plannerWhatIfBenchmarkWorkload(id: string) {
  const workload = plannerWhatIfBenchmarkWorkloads.find((value) => value.id === id)
  if (!workload) throw new RangeError(`Unknown Planner what-if benchmark workload: ${id}`)
  return workload
}

export interface PlannerWhatIfBenchmarkFixture {
  readonly workload: ReturnType<typeof plannerWhatIfBenchmarkWorkload>
  readonly plannerInput: PlannerInput
  readonly scenarioResolution: PlannerConflictResolution
  readonly initialConflicts: readonly PlanConflict[]
  /** Production positions used to define the reachable Ideal conditions. */
  readonly idealPredictionCounters: readonly {
    targetWeaponId: string
    stream: 'gogma' | 'skill'
    counter: number
  }[]
}

const FIXTURE_TIME = '2026-09-09T00:00:00.000Z'
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/**
 * Reuses B8's validated Master loading, Production RNG origin, predicted owned
 * sources and normal counters without modifying its workloads. B9 defines new
 * reachable Ideal conditions, then rebuilds EVERY Candidate and Entry through
 * the ordinary factories. No category, distance or stale hash is assigned here.
 * Fixture construction is outside the Browser measurement window.
 */
export function createPlannerWhatIfBenchmarkFixture(
  workloadId: string,
): PlannerWhatIfBenchmarkFixture {
  const workload = plannerWhatIfBenchmarkWorkload(workloadId)
  const conversionScenario = workloadId === 'what_if_dual_category' || workloadId === 'what_if_three_targets'
  const base = createPlannerOrchestrationBenchmarkInput(workload.baseWorkloadId).input
  const engine = new ProductionRngEngine()
  const idealPredictionCounters: PlannerWhatIfBenchmarkFixture['idealPredictionCounters'][number][] = []
  const targets = base.targetWeapons.map((original, index): TargetWeapon => {
    const entry = base.buildListEntries[index]
    const source = base.ownedWeapons.find(({ id }) => id === entry.candidateSnapshot.route.sourceOwnedWeaponId)
    if (!source || source.kind !== 'gogma') throw new Error('Missing Production fixture source.')
    const target: TargetWeapon = {
      ...original,
      id: original.id.replace('b8e1', 'b9b2a') as TargetWeapon['id'],
      name: original.name.replace('B8-E1', 'B9-B2a'),
    }
    // Scan a fixed, documented fixture construction window, not a Search bound.
    // Keep the original Practical condition; never relax it to fit a prediction.
    for (let offset = 1; offset <= 100; offset += 1) {
      const isSkill = entry.candidateSnapshot.route.kind === 'existing_gogma_reset_skills'
      const counter = (isSkill ? SKILL_COUNTER : GOGMA_COUNTER) + offset
      const skills = isSkill
        ? engine.predictSkills({ baseSeed: BASE_SEED, weaponTypeId: target.weaponTypeId,
            elementId: target.elementId, skillCounter: counter, master: base.master })
        : source
      const bonuses = isSkill ? source.restorationBonuses
        : engine.predictGogmaBonus({ baseSeed: BASE_SEED, weaponTypeId: target.weaponTypeId,
            elementId: target.elementId, gogmaCounter: counter,
            operation: { type: 'reset_bonuses' }, master: base.master })
      const proposal: TargetWeapon = {
        ...target,
        idealBonuses: bonuses,
        idealSkillCondition: isSkill
          ? { seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId, matchMode: 'all' }
          : { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
      }
      if (!validateTargetIdealImpliesPractical(proposal, base.master).isValid) continue
      const initial = entry.candidateSnapshot
      const match = evaluateTargetCandidate(proposal, initial.finalBonuses, 'gogma_artian', initial.seriesSkillId, initial.groupSkillId, base.master, 0.6)
      if (match.category === null) continue
      idealPredictionCounters.push({ targetWeaponId: target.id,
        stream: isSkill ? 'skill' : 'gogma', counter })
      return proposal
    }
    throw new Error(`No Production-valid reachable Ideal for ${target.id} in fixture scan.`)
  })
  const searchInput: CandidateSearchInput = {
    searchRunId: `b9-b2a-fixture:${workloadId}`,
    targetWeaponIds: targets.map(({ id }) => id),
    routeFilter: 'all', resultFilter: 'all',
    rngState: base.rngState, normalCounters: base.normalCounters,
    ownedWeapons: base.ownedWeapons, targetWeapons: targets,
    settings: { ...defaultCandidateSearchSettings },
    master: base.master, calculationContext: base.calculationContext,
  }
  const execution = createSearchExecutionContext({ now: () => FIXTURE_TIME })
  const buildListEntries = targets.map((target, index) => {
    const originalRoute = base.buildListEntries[index].candidateSnapshot.route
    const conversion = conversionScenario
    const route = conversion ? {
      kind: 'normal_artian_to_gogma' as const,
      sourceOwnedWeaponId: null,
      operations: [
        { type: 'create_normal_artian' as const, weaponTypeId: target.weaponTypeId,
          rarity: V1_NORMAL_ARTIAN_RARITY, count: 1, normalCounterBefore: NORMAL_COUNTER,
          normalCounterAfter: NORMAL_COUNTER + 1 },
        { type: 'convert_normal_to_gogma' as const, weaponTypeId: target.weaponTypeId,
          skillCounterBefore: SKILL_COUNTER, skillCounterAfter: SKILL_COUNTER + 1 },
        { type: 'reset_bonuses' as const, sourceOwnedWeaponId: null, gogmaCounterBefore: GOGMA_COUNTER, gogmaCounterAfter: GOGMA_COUNTER + 1 },
      ],
    } : originalRoute
    const source = base.ownedWeapons.find(({ id }) => id === originalRoute.sourceOwnedWeaponId)
    if (!source || source.kind !== 'gogma') throw new Error('Missing Production source.')
    const isSkill = route.kind === 'existing_gogma_reset_skills'
    const skills = isSkill || conversion
      ? engine.predictSkills({ baseSeed: BASE_SEED, weaponTypeId: target.weaponTypeId,
          elementId: target.elementId, skillCounter: SKILL_COUNTER, master: base.master })
      : source
    const candidate = createCandidateFromPrediction(target, {
      route,
      finalBonuses: isSkill ? source.restorationBonuses : engine.predictGogmaBonus({
        baseSeed: BASE_SEED, weaponTypeId: target.weaponTypeId, elementId: target.elementId,
        gogmaCounter: GOGMA_COUNTER, operation: { type: 'reset_bonuses' }, master: base.master,
      }),
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId,
    }, searchInput, execution)
    if (!candidate) throw new Error(`Production fixture Candidate rejected: ${target.id}`)
    return createBuildListEntry(candidate, target, { createdAt: FIXTURE_TIME })
  })
  const input: PlannerInput = { ...base, targetWeapons: targets, buildListEntries, conflictResolutions: [] }
  const prepared = preparePlannerInitialContext(input, createProductionPlannerDependencies(engine))
  if (prepared.status !== 'ready') throw new Error(`Fixture PlannerInput not ready: ${JSON.stringify(prepared.issues)}`)
  if (prepared.context.excludedBuildListEntries.length > 0 ||
      prepared.context.routePlanRejections.length > 0 ||
      prepared.context.validBuildListEntries.length !== buildListEntries.length) {
    throw new Error('Production fixture lost an Entry during Planner validation.')
  }
  const initialConflicts = prepared.context.initialConflictDetection.conflicts
  const scenarioKind = conversionScenario
    ? 'same_skill_counter' : 'same_gogma_counter'
  const scenarioConflicts = initialConflicts.filter(({ kind }) => kind === scenarioKind)
  if (scenarioConflicts.length !== 1) throw new Error('Fixture scenario conflict is not unique.')
  const scenarioConflict = scenarioConflicts[0]
  if (scenarioConflict.buildListEntryIds.length !== workload.participantCount) {
    throw new Error('Unexpected fixture participant count.')
  }
  const resolutions = initialConflicts.map((conflict) => ({
    conflictKey: conflict.id,
    // Reproducible fixture choice only; never a Production recommendation.
    selectedBuildListEntryId: [...conflict.buildListEntryIds].sort(compareIds)[0],
  }))
  const scenarioResolution = resolutions.find(({ conflictKey }) => conflictKey === scenarioConflict.id)
  if (!scenarioResolution) throw new Error('Missing fixture scenario resolution.')
  return {
    workload, plannerInput: { ...input, conflictResolutions: resolutions },
    scenarioResolution, initialConflicts, idealPredictionCounters,
  }
}
