import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  belowPracticalBonuses,
  idealBonuses,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  checkpointMixedEntry,
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationResetResultAt,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeapon,
  RestorationBonusSet,
  RouteOperation,
  TargetWeapon,
} from '../../models/publicTypes'
import { candidateStableKey } from '../../search'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
  type PlannerAlternativeKernelTargetResult,
} from './plannerAlternativeKernel'

/*
 * The Phase 2 Planner Alternative kernel end to end: preparation, reservation,
 * Planner Alternative Search, materializer, replacement preflight, the shared
 * Production Plan generation (deterministic scheduler + Trace Replay) and the
 * 9.2.19.6 judgement. Only the Fake RNG Engine, the ID factory and the Clock
 * are injected; one test forces a preflight refusal, which no fixture reaches.
 */

const forced = vi.hoisted(() => ({ refusePreflights: 0 }))

vi.mock('../constrained/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constrained/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (
      ...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>
    ) => {
      if (forced.refusePreflights > 0) {
        forced.refusePreflights -= 1
        return { status: 'unresolved', conflictResolutions: [], failures: [] }
      }
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})

beforeEach(() => {
  forced.refusePreflights = 0
})

const TARGET_A = 'target.kernel.a'
const TARGET_B = 'target.kernel.b'
const TARGET_C = 'target.kernel.c'
const SOURCE_C = 'owned.kernel.c'
const ENTRY_A = 'build-list.kernel.a' as BuildListEntryId
const ENTRY_B = 'build-list.kernel.b' as BuildListEntryId
const ENTRY_C = 'build-list.kernel.c' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const SOURCE_C_SKILL = 'series_skill.fixture.c-source'

/** Target A: its source's own Skill is Ideal, so one Reset at the contested Gogma 10 completes it. */
function targetA(): TargetWeapon {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
}

function ownSkillTarget(id: string, seriesSkillId: string, priority: TargetWeapon['priority']): TargetWeapon {
  const skill = { seriesSkillId, groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(id, { priority, idealSkillCondition: skill, practicalSkillCondition: skill })
}

interface Parts {
  targets: TargetWeapon[]
  ownedWeapons: OwnedWeapon[]
  entries: BuildListEntry[]
}

/**
 * A and B contend for Gogma 10 (`same_gogma_counter`). B's current Entry Resets
 * there and Reset Skills at 7 (the Ideal Series Skill). With A fixed, B's
 * alternative skips the held and blocked Gogma 10: Reset 11, Reset 12 (Ideal
 * again), plus the Reset Skills at 7.
 */
function parts(): Parts {
  const a = targetA()
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return {
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL }),
    ],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations],
      }),
    ],
  }
}

/**
 * Adds Target C, higher priority than B, whose own Entry Resets at Gogma 11 and
 * 12: its required final Reset at 12 is where B's alternative ends too.
 */
function withUnfixedC(base: Parts): Parts {
  const c = ownSkillTarget(TARGET_C, SOURCE_C_SKILL, 4)
  const source = resetRoute(SOURCE_C).sourceOwnedWeaponId
  return {
    targets: [...base.targets, c],
    ownedWeapons: [...base.ownedWeapons, orchestrationSource(SOURCE_C, { seriesSkillId: SOURCE_C_SKILL })],
    entries: [...base.entries, orchestrationEntry(ENTRY_C, c, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: source,
      operations: [...resetRoute(SOURCE_C, 11).operations, ...resetRoute(SOURCE_C, 12).operations],
    }, { seriesSkillId: SOURCE_C_SKILL })],
  }
}

function scenario(p: Parts, resetResultAt?: (gogmaCounter: number) => RestorationBonusSet): OrchestrationScenario {
  return orchestrationScenario({
    targets: p.targets,
    ownedWeapons: p.ownedWeapons,
    entries: p.entries.map((entry) => structuredClone(entry)),
    engine: resetResultAt ? { resetResultAt } : undefined,
  })
}

function gogmaConflictKey(built: OrchestrationScenario): string {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) =>
    kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A))
  if (!conflict) throw new Error('no Gogma conflict with A')
  return conflict.id
}

function request(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeKernelRequest> = {}): PlannerAlternativeKernelRequest {
  return {
    plannerInput: built.input,
    decision: { conflictKey: gogmaConflictKey(built), selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 },
    bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
    ...overrides,
  }
}

function completed(result: PlannerAlternativeKernelResult) {
  if (result.status !== 'completed') throw new Error(`kernel failed: ${JSON.stringify(result)}`)
  return result
}

function targetOf(result: PlannerAlternativeKernelResult, targetWeaponId: string): PlannerAlternativeKernelTargetResult {
  const found = completed(result).targets.find((target) => target.targetWeaponId === targetWeaponId)
  if (!found) throw new Error(`no result for ${targetWeaponId}`)
  return found
}

function gogmaPositions(operations: readonly RouteOperation[]): number[] {
  return operations.flatMap((operation) =>
    operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses' ? [operation.gogmaCounterBefore] : [])
}

describe('Planner Alternative kernel: found (PLANNER_SPEC 9.2.19.6)', () => {
  it('finds a resource-aware alternative that crosses the fixed held position, with G selected', async () => {
    const built = scenario(parts())
    const result = await runPlannerAlternativeKernel(request(built), built.dependencies)
    const b = targetOf(result, TARGET_B)
    expect(completed(result).explicitDecisionBuildListEntryIds).toEqual([ENTRY_A])
    expect(b.invalidatedBuildListEntryId).toBe(ENTRY_B)
    expect(b.fixedRouteBuildListEntryIds).toEqual([ENTRY_A])
    expect(b.reservation).toEqual({
      normal: [],
      skill: { held: [], blocked: [] },
      gogma: { held: [10], blocked: [10] },
      exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_A],
    })
    expect(b.outcome.status).toBe('found')
    if (b.outcome.status !== 'found') return
    expect(b.outcome.generatedSelected).toBe(true)
    expect(gogmaPositions(b.outcome.candidate.route.operations)).toEqual([11, 12])
    expect(b.outcome.candidate.route.sourceOwnedWeaponId).toBe(ORCHESTRATION_SOURCE_B)
    // Two own Reset Bonuses reaching Gogma 13 from the origin 10.
    expect(b.outcome.candidate.estimatedGogmaAdvance).toBe(3)
    expect(b.outcome.candidate.estimatedOperationCount).toBe(3)
    expect(b.outcome.replacement).toEqual({
      targetWeaponId: TARGET_B,
      replacedBuildListEntryId: ENTRY_B,
      generatedBuildListEntryId: b.outcome.generated.entry.id,
    })
    const plan = b.outcome.trialResult.plan!
    expect([...plan.selectedBuildListEntryIds].sort()).toEqual([ENTRY_A, b.outcome.generated.entry.id].sort())
    expect(plan.selectedBuildListEntryIds).not.toContain(ENTRY_B)
    expect(b.outcome.trialResult.conflicts).toEqual([])
    expect(b.trials).toHaveLength(1)
    expect(completed(result).plannerRerunsUsed).toBe(1)
  })

  it('finds G that loses only a provisional outcome to an unfixed Entry, without re-searching that Entry', async () => {
    const built = scenario(withUnfixedC(parts()))
    const result = await runPlannerAlternativeKernel(request(built), built.dependencies)
    const b = targetOf(result, TARGET_B)
    expect(b.outcome.status).toBe('found')
    if (b.outcome.status !== 'found') return
    expect(b.outcome.generatedSelected).toBe(false)
    const plan = b.outcome.trialResult.plan!
    expect(plan.selectedBuildListEntryIds).toContain(ENTRY_A)
    expect(plan.selectedBuildListEntryIds).toContain(ENTRY_C)
    const generatedId = b.outcome.generated.entry.id
    expect(plan.selectedBuildListEntryIds).not.toContain(generatedId)
    // The introduced conflict G vs C stays an ordinary unresolved conflict.
    expect(b.outcome.trialResult.conflicts.some(({ buildListEntryIds, selectedBuildListEntryId }) =>
      selectedBuildListEntryId === null &&
      buildListEntryIds.includes(ENTRY_C) &&
      buildListEntryIds.includes(generatedId))).toBe(true)
    // C is not a work of this decision: only B was searched.
    expect(completed(result).targets.map(({ targetWeaponId }) => targetWeaponId)).toEqual([TARGET_B])
  })
})

describe('Planner Alternative kernel: rejection from the trial run (PLANNER_SPEC 9.2.19.6)', () => {
  it('rejects every trial when the unfixed partner that wins the provisional outcome is itself dropped later', async () => {
    // C Resets at Gogma 12 only, and no Route of the trial moves the Counter
    // past Gogma 11, so C stalls after winning its provisional outcome against
    // G. The Plan then records G and C alike as `resource_conflict` with no
    // selected partner, which is also exactly what a G that won and then
    // stalled leaves behind. The judgement reads only that record, so it is
    // conservative here: not found, never a guess that G lost the outcome.
    const base = parts()
    const c = ownSkillTarget(TARGET_C, SOURCE_C_SKILL, 4)
    const built = scenario({
      targets: [...base.targets, c],
      ownedWeapons: [...base.ownedWeapons, orchestrationSource(SOURCE_C, { seriesSkillId: SOURCE_C_SKILL })],
      entries: [...base.entries, orchestrationEntry(ENTRY_C, c, resetRoute(SOURCE_C, 12), { seriesSkillId: SOURCE_C_SKILL })],
    })
    const result = await runPlannerAlternativeKernel(request(built), built.dependencies)
    const b = targetOf(result, TARGET_B)
    expect(b.trials.length).toBeGreaterThan(0)
    expect(b.trials.every(({ result: trial }) => trial.status === 'rejected' && trial.reason === 'not_selected')).toBe(true)
    expect(['not_found_within_search_extent', 'stopped_by_search_extent_bound']).toContain(b.outcome.status)
  })
})

describe('Planner Alternative kernel: bounds and exclusions (PLANNER_SPEC 9.2.19.10 / 9.2.19.12)', () => {
  /** Ideal again at Gogma 14, so B has a second, costlier alternative. */
  const twoIdeals = (gogmaCounter: number) =>
    gogmaCounter === 14 ? idealBonuses() : orchestrationResetResultAt(gogmaCounter)

  it('stops on the candidate trial bound only when a further Candidate arrives', async () => {
    const built = scenario(parts(), twoIdeals)
    forced.refusePreflights = 1
    const result = await runPlannerAlternativeKernel(
      request(built, { bounds: { maxCandidateTrialsPerTarget: 1, maxPlannerReruns: 8 } }),
      built.dependencies,
    )
    const b = targetOf(result, TARGET_B)
    expect(b.outcome).toEqual({ status: 'stopped_by_candidate_trial_bound' })
    expect(b.trials).toHaveLength(1)
    expect(b.trials[0].result).toEqual({ status: 'rejected', reason: 'preflight_refused' })
    // Preflight never counts as a full Planner run.
    expect(completed(result).plannerRerunsUsed).toBe(0)
  })

  it('keeps a rejected trial out of the Route exclusions and tries the next Candidate', async () => {
    const built = scenario(parts(), twoIdeals)
    forced.refusePreflights = 1
    const result = await runPlannerAlternativeKernel(request(built), built.dependencies)
    const b = targetOf(result, TARGET_B)
    expect(b.outcome.status).toBe('found')
    expect(b.trials.map(({ result: trial }) => trial.status)).toEqual(['rejected', 'found'])
    expect(b.excludedRouteKeys).not.toContain(b.trials[0].candidateKey)
    expect(b.excludedRouteKeys).toHaveLength(1)
  })

  it('never trials the invalidated Route or a prior-excluded Route', async () => {
    const first = scenario(parts(), twoIdeals)
    const found = targetOf(await runPlannerAlternativeKernel(request(first), first.dependencies), TARGET_B)
    if (found.outcome.status !== 'found') throw new Error('expected found')
    const firstKey = candidateStableKey(found.outcome.candidate)
    expect(found.excludedRouteKeys).toEqual([candidateStableKey(first.input.buildListEntries[1].candidateSnapshot)])

    const second = scenario(parts(), twoIdeals)
    const result = await runPlannerAlternativeKernel(
      request(second, { priorExcludedRoutes: [{ targetWeaponId: TARGET_B as never, routeKeys: [firstKey] }] }),
      second.dependencies,
    )
    const b = targetOf(result, TARGET_B)
    expect(b.outcome.status).toBe('found')
    expect(b.search?.excludedCandidates).toBe(1)
    expect(b.trials.map(({ candidateKey }) => candidateKey)).not.toContain(firstKey)
    expect(b.excludedRouteKeys).toContain(firstKey)
  })

  it('reports the planner rerun bound for a Target the budget no longer reaches', async () => {
    const base = parts()
    const c = skillConstrainedTarget(TARGET_C, { priority: 2 })
    const built = scenario({
      targets: [...base.targets, c],
      ownedWeapons: [...base.ownedWeapons, orchestrationSource(SOURCE_C, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
      entries: [...base.entries, orchestrationEntry(ENTRY_C, c, resetRoute(SOURCE_C))],
    })
    const result = await runPlannerAlternativeKernel(
      request(built, { bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 1 } }),
      built.dependencies,
    )
    const outcomes = completed(result).targets.map(({ targetWeaponId, outcome, search }) => [targetWeaponId, outcome.status, search === null])
    expect(outcomes).toContainEqual([TARGET_C, 'stopped_by_planner_rerun_bound', true])
    expect(completed(result).plannerRerunsUsed).toBe(1)
  })

  it('separates an exhausted extent from an extent stop', async () => {
    const noIdeal = (gogmaCounter: number) => (gogmaCounter === 10 ? idealBonuses() : practicalBonuses())
    const exhausted = scenario(parts(), noIdeal)
    const stopped = targetOf(await runPlannerAlternativeKernel(
      request(exhausted, { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 } }),
      exhausted.dependencies,
    ), TARGET_B)
    expect(stopped.outcome).toEqual({ status: 'stopped_by_search_extent_bound' })
    expect(stopped.search?.stoppedByExtent).toBe(true)
    expect(stopped.trials).toEqual([])
  })
})

describe('Planner Alternative kernel: fail closed and determinism', () => {
  it('blocks a Target with a required checkpoint Entry without searching it', async () => {
    const a = targetA()
    const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
    const sourceB = orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: practicalBonuses(), seriesSkillId: SOURCE_B_SKILL })
    const built = scenario({
      targets: [a, b],
      ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }), sourceB],
      entries: [
        orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
        checkpointMixedEntry(ENTRY_B, b, ORCHESTRATION_SOURCE_B, sourceB, { select: true }),
      ],
    })
    const b0 = targetOf(await runPlannerAlternativeKernel(request(built), built.dependencies), TARGET_B)
    expect(b0.outcome).toEqual({ status: 'blocked_by_selected_checkpoint' })
    expect(b0.search).toBeNull()
    expect(b0.reservation).toBeNull()
  })

  it('refuses a prior fixed Entry that is not a valid Entry of the input', async () => {
    const built = scenario(parts())
    const result = await runPlannerAlternativeKernel(
      request(built, { priorFixedBuildListEntryIds: ['build-list.kernel.missing' as BuildListEntryId] }),
      built.dependencies,
    )
    expect(result).toMatchObject({ status: 'invalid_prior_fixed_entry', buildListEntryId: 'build-list.kernel.missing' })
  })

  it('passes an invalid decision through as the typed preparation failure', async () => {
    const built = scenario(parts())
    const result = await runPlannerAlternativeKernel(
      request(built, { decision: { conflictKey: 'conflict.unknown', selectedBuildListEntryId: ENTRY_A } }),
      built.dependencies,
    )
    expect(result.status).toBe('invalid_fixed_resolution')
  })

  it('refuses invalid trial bounds instead of repairing them', async () => {
    const built = scenario(parts())
    await expect(runPlannerAlternativeKernel(
      request(built, { bounds: { maxCandidateTrialsPerTarget: 0, maxPlannerReruns: 1 } }),
      built.dependencies,
    )).rejects.toThrow('maxCandidateTrialsPerTarget')
  })

  it('derives the same Candidate and generated Entry whatever the input order and the Clock', async () => {
    const one = scenario(parts())
    const first = targetOf(await runPlannerAlternativeKernel(request(one), one.dependencies), TARGET_B)
    const two = scenario(parts())
    two.input.buildListEntries.reverse()
    two.dependencies.clock = { now: () => '2030-01-01T00:00:00.000Z' }
    const second = targetOf(await runPlannerAlternativeKernel(request(two), two.dependencies), TARGET_B)
    if (first.outcome.status !== 'found' || second.outcome.status !== 'found') throw new Error('expected found')
    expect(candidateStableKey(second.outcome.candidate)).toBe(candidateStableKey(first.outcome.candidate))
    expect(second.outcome.generated.entry.id).toBe(first.outcome.generated.entry.id)
    expect(second.outcome.generated.candidate.id).toBe(first.outcome.generated.candidate.id)
    expect(second.outcome.generated.entry.createdAt).not.toBe(first.outcome.generated.entry.createdAt)
    expect(second.reservation).toEqual(first.reservation)
  })
})
