import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  BuildListEntryId,
  PlanConflict,
  ProductionPlan,
  TargetWeaponId,
} from '../../models/publicTypes'
import type { PlannerAlternativeCandidate } from '../../search'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../../../test/fixtures/plannerTermination'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerResult,
  PlannerRunBuildListContext,
  PlannerRunResult,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import type {
  PlannerAlternativeFound,
  PlannerAlternativeKernelCompletedResult,
  PlannerAlternativeKernelOutcome,
  PlannerAlternativeKernelTargetResult,
} from './plannerAlternativeKernel'
import type { PlannerAlternativeFullRunBudget } from './plannerAlternativeTrial'
import {
  createPlannerAlternativeWhatIfComparison,
  type PlannerAlternativeWhatIfRequest,
} from './plannerAlternativeWhatIf'
import type { PlannerAlternativeComparison } from './plannerAlternativeComparison'

/*
 * The scenario composition of `docs/PLANNER_SPEC.md` 9.2.19.8.1 and the typed
 * scenario of 9.2.19.13, isolated: the kernel's individual trials, the
 * preflights and the full Planner runs are scripted, so every full run the
 * calculation starts - and every budget unit it consumes - is counted exactly.
 * The found judgement itself (`judgePlannerAlternativeTrial()`) and the shared
 * budget (`createPlannerAlternativeFullRunBudget()`) are the real ones. The
 * real kernel end to end is `plannerAlternativeWhatIf.test.ts`.
 */

interface ScriptedRun {
  /** Extra full runs inside the same Plan generation (runtime-unsupported retries). */
  retries?: number
  result: PlannerResult
}

const script = vi.hoisted(() => ({
  /** Full runs the kernel's individual trials start, before its result. */
  kernelTrialRuns: 0,
  kernelTargets: [] as unknown[],
  kernelBudget: null as unknown,
  /** Each full run of the composition, in order. */
  runs: [] as unknown[],
  runContexts: [] as unknown[],
  /** Generated Entry IDs whose adoption preflight refuses. */
  refusedAdoptions: new Set<string>(),
  preflights: 0,
}))

const FIXED = 'entry.a' as BuildListEntryId
const FIXED_TARGET = 'target.a' as TargetWeaponId
const CONFLICT = 'conflict.scenario'

function entryOf(target: string): BuildListEntryId {
  return `entry.${target}` as BuildListEntryId
}
function generatedOf(target: string): BuildListEntryId {
  return `generated.${target}` as BuildListEntryId
}
function targetId(target: string): TargetWeaponId {
  return `target.${target}` as TargetWeaponId
}

const PLANNING_TARGETS = ['a', 'b', 'c', 'd', 'e'].map(targetId)

vi.mock('./plannerAlternativeKernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerAlternativeKernel')>()
  return {
    ...actual,
    preparePlannerAlternativeKernel: () => ({
      status: 'ready',
      prepared: {
        explicitDecisionBuildListEntryIds: [FIXED],
        scenario: {
          mergedInput: {
            buildListEntries: ['a', 'b', 'c', 'd', 'e'].map((t) =>
              ({ id: entryOf(t), targetWeaponId: targetId(t) }) as BuildListEntry),
          },
          fixedConstraints: [],
          conflictContexts: [],
          initialContext: { planningTargetIds: PLANNING_TARGETS },
        },
      },
    }),
    runPreparedPlannerAlternativeKernel: async (
      _prepared: unknown,
      request: PlannerAlternativeWhatIfRequest,
      _dependencies: unknown,
      options: { fullRunBudget: PlannerAlternativeFullRunBudget },
    ): Promise<PlannerAlternativeKernelCompletedResult> => {
      script.kernelBudget = options.fullRunBudget
      expect(options.fullRunBudget.limit).toBe(request.bounds.maxPlannerReruns)
      for (let run = 0; run < script.kernelTrialRuns; run += 1) options.fullRunBudget.beforePlannerRun()
      return {
        status: 'completed',
        conflictKey: CONFLICT,
        fixedBuildListEntryId: FIXED,
        fixedTargetWeaponId: FIXED_TARGET,
        explicitDecisionBuildListEntryIds: [FIXED],
        targets: script.kernelTargets as PlannerAlternativeKernelTargetResult[],
        plannerRerunsUsed: script.kernelTrialRuns,
      }
    },
  }
})

vi.mock('../constrained/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constrained/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (
      input: PlannerInput,
      replacements: { generatedBuildListEntryId: string }[],
    ) => {
      script.preflights += 1
      const added = replacements[replacements.length - 1].generatedBuildListEntryId
      return script.refusedAdoptions.has(added)
        ? { status: 'unresolved', conflictResolutions: [], failures: [] }
        : { status: 'ready', resolvedInput: input }
    },
    preparePlannerAugmentedConflictPreflight: (input: PlannerInput) => {
      script.preflights += 1
      return { status: 'ready', resolvedInput: input }
    },
  }
})

vi.mock('../productionPlanGeneration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productionPlanGeneration')>()
  return {
    ...actual,
    createProductionPlanWithObserver: async (
      _input: PlannerInput,
      _dependencies: unknown,
      _executionOptions: unknown,
      observer: ProductionPlanGenerationObserver,
      context: PlannerRunBuildListContext,
    ) => {
      const next = script.runs.shift() as ScriptedRun | undefined
      if (!next) throw new Error('No scripted full Planner run left.')
      for (let run = 0; run <= (next.retries ?? 0); run += 1) {
        // The budget refuses by throwing, exactly as in Production.
        observer.beforePlannerRun()
        observer.afterPlannerRun?.({ cancelled: false, routeCommitment: undefined } as unknown as PlannerRunResult)
      }
      script.runContexts.push(context)
      return next.result
    },
  }
})

beforeEach(() => {
  script.kernelTrialRuns = 0
  script.kernelTargets = []
  script.kernelBudget = null
  script.runs = []
  script.runContexts = []
  script.refusedAdoptions = new Set()
  script.preflights = 0
})

function plan(stepCount: number, selected: readonly BuildListEntryId[], completions: readonly string[] = []): ProductionPlan {
  return {
    selectedBuildListEntryIds: [...selected],
    steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `step.${index}`,
      executionEffects: index === 0
        ? { targetCompletions: completions.map((t) => ({ targetWeaponId: targetId(t) })) }
        : { targetCompletions: [] },
    })),
  } as unknown as ProductionPlan
}

function conflict(id: string, participants: readonly BuildListEntryId[], selected: BuildListEntryId | null = null): PlanConflict {
  return {
    id,
    kind: 'same_gogma_counter',
    buildListEntryIds: [...participants],
    reason: 'fixture',
    recommendedBuildListEntryId: null,
    selectedBuildListEntryId: selected,
    resolutionNote: null,
    checkpointParticipants: [],
  }
}

function result(options: {
  plan?: ProductionPlan | null
  conflicts?: PlanConflict[]
  termination?: PlannerResult['termination']
}): PlannerResult {
  return {
    plan: options.plan === undefined ? plan(1, [FIXED]) : options.plan,
    conflicts: options.conflicts ?? [],
    warnings: [],
    termination: options.termination ?? completedPlannerTermination(),
  }
}

/** The individual trial result: A and this Target's generated Entry selected. */
function trialResultFor(target: string, stepCount = 10): PlannerResult {
  return result({ plan: plan(stepCount, [FIXED, generatedOf(target)]) })
}

function candidate(operationCount: number): PlannerAlternativeCandidate {
  return {
    targetWeaponId: 'target.x',
    finalBonuses: [],
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series.fixture',
    groupSkillId: null,
    route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: null, operations: [] },
    estimatedOperationCount: operationCount,
    estimatedGogmaAdvance: operationCount,
    estimatedSkillAdvance: 0,
    estimatedNormalAdvance: null,
    requiredMaterials: [],
    bonusAmendmentTrace: [],
    skillAmendmentTrace: [],
  } as unknown as PlannerAlternativeCandidate
}

function kernelTarget(target: string, outcome: PlannerAlternativeKernelOutcome, skippedExcludedRouteKeys: string[] = []): PlannerAlternativeKernelTargetResult {
  return {
    targetWeaponId: targetId(target),
    invalidatedBuildListEntryId: entryOf(target),
    invalidatedRouteKey: `route.${target}`,
    fixedRouteBuildListEntryIds: [FIXED],
    reservation: null,
    excludedRouteKeys: [],
    outcome,
    search: null,
    trials: [],
    skippedExcludedRouteKeys,
  }
}

function found(target: string, trialResult = trialResultFor(target), operationCount = 3): PlannerAlternativeFound {
  return {
    status: 'found',
    candidate: candidate(operationCount),
    generated: { entry: { id: generatedOf(target), targetWeaponId: targetId(target) } } as never,
    replacement: {
      targetWeaponId: targetId(target),
      replacedBuildListEntryId: entryOf(target),
      generatedBuildListEntryId: generatedOf(target),
    },
    trialResult,
    trialRouteCommitment: null,
    generatedSelected: true,
  }
}

const dependencies = {} as PlannerDependencies

function request(maxPlannerReruns = 8, overrides: Partial<PlannerAlternativeWhatIfRequest> = {}): PlannerAlternativeWhatIfRequest {
  return {
    plannerInput: {} as PlannerInput,
    scenarioResolution: { conflictKey: CONFLICT, selectedBuildListEntryId: FIXED },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 },
    bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns },
    ...overrides,
  }
}

async function compare(req = request()): Promise<PlannerAlternativeComparison> {
  const outcome = await createPlannerAlternativeWhatIfComparison(req, dependencies)
  if (outcome.status !== 'completed') throw new Error(`comparison failed: ${outcome.status}`)
  return outcome.comparison
}

function adoptedOf(comparison: PlannerAlternativeComparison): Record<string, boolean | null | undefined> {
  return Object.fromEntries(comparison.alternatives.map(({ alternativeTargetWeaponId, outcome }) =>
    [alternativeTargetWeaponId, outcome.status === 'found' ? outcome.adoptedInScenario : undefined]))
}

function budgetUsed(): number {
  return (script.kernelBudget as PlannerAlternativeFullRunBudget).used
}

function replacedTargetsOf(context: unknown): string[] {
  const ctx = context as PlannerRunBuildListContext
  return ctx.kind === 'temporary_replacement'
    ? ctx.replacements.map(({ targetWeaponId }) => targetWeaponId)
    : []
}

describe('Planner Alternative scenario composition: full Planner runs (PLANNER_SPEC 9.2.19.8.1)', () => {
  it('found = 0: one scenario run over the input without replacement, and nothing else', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [
      kernelTarget('b', { status: 'not_found_within_search_extent' }),
      kernelTarget('c', { status: 'stopped_by_search_extent_bound' }),
    ]
    script.runs = [{ result: result({ plan: plan(7, [FIXED]) }) }]
    const comparison = await compare()
    expect(script.runContexts).toEqual([{ kind: 'persisted' }])
    expect(budgetUsed()).toBe(3)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 7 })
  })

  it('found = 1: reuses the individual trial result and adds no run, other Targets not found included', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = [
      kernelTarget('b', { status: 'not_found_within_search_extent' }),
      kernelTarget('c', found('c', trialResultFor('c', 12))),
      kernelTarget('d', { status: 'stopped_by_candidate_trial_bound' }),
    ]
    const comparison = await compare()
    expect(script.runContexts).toEqual([])
    expect(script.preflights).toBe(0)
    expect(budgetUsed()).toBe(3)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 12 })
    expect(adoptedOf(comparison)).toEqual({ 'target.b': undefined, 'target.c': true, 'target.d': undefined })
  })

  it('found = n: n - 1 adoption runs over the growing accepted set, and the last accepted result is final', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = ['b', 'c', 'd'].map((t) => kernelTarget(t, found(t)))
    script.runs = [
      { result: result({ plan: plan(20, [FIXED, generatedOf('b'), generatedOf('c')]) }) },
      { result: result({ plan: plan(31, [FIXED, generatedOf('b'), generatedOf('c'), generatedOf('d')]) }) },
    ]
    const comparison = await compare()
    expect(script.runContexts.map(replacedTargetsOf)).toEqual([
      ['target.b', 'target.c'],
      ['target.b', 'target.c', 'target.d'],
    ])
    expect(budgetUsed()).toBe(5)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 31 })
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': true, 'target.d': true })
  })

  it('rejects only the replacement whose adoption run fails, keeps the earlier ones, and adds the next to them', async () => {
    script.kernelTrialRuns = 4
    script.kernelTargets = ['b', 'c', 'd', 'e'].map((t) => kernelTarget(t, found(t)))
    script.runs = [
      // B2 + C2: accepted.
      { result: result({ plan: plan(20, [FIXED, generatedOf('b'), generatedOf('c')]) }) },
      // B2 + C2 + D2: D2 dropped (not selected, no provisional outcome) -> reject.
      { result: result({ plan: plan(25, [FIXED, generatedOf('b'), generatedOf('c')]) }) },
      // B2 + C2 + E2: accepted.
      { result: result({ plan: plan(33, [FIXED, generatedOf('b'), generatedOf('c'), generatedOf('e')]) }) },
    ]
    const comparison = await compare()
    expect(script.runContexts.map(replacedTargetsOf)).toEqual([
      ['target.b', 'target.c'],
      ['target.b', 'target.c', 'target.d'],
      ['target.b', 'target.c', 'target.e'],
    ])
    // The rejected run was started, so it consumed the budget.
    expect(budgetUsed()).toBe(7)
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': true, 'target.d': false, 'target.e': true })
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 33 })
  })

  it('rejects an adoption when an accepted replacement falls out, and reuses the previous accepted result when the last one is rejected', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = ['b', 'c', 'd'].map((t) => kernelTarget(t, found(t)))
    script.runs = [
      // B2 + C2: C2 selected but the accepted B2 falls out -> reject C2.
      { result: result({ plan: plan(20, [FIXED, generatedOf('c')]) }) },
      // B2 + D2: the explicit decision Entry A falls out -> reject D2.
      { result: result({ plan: plan(21, [generatedOf('b'), generatedOf('d')]) }) },
    ]
    const comparison = await compare()
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': false, 'target.d': false })
    // The current scenario result is still B2's individual trial.
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 10 })
    expect(budgetUsed()).toBe(5)
  })

  it('treats an adoption preflight refusal as a reject that starts no run and consumes no budget', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = ['b', 'c', 'd'].map((t) => kernelTarget(t, found(t)))
    script.refusedAdoptions = new Set([generatedOf('c')])
    script.runs = [{ result: result({ plan: plan(22, [FIXED, generatedOf('b'), generatedOf('d')]) }) }]
    const comparison = await compare()
    expect(script.runContexts.map(replacedTargetsOf)).toEqual([['target.b', 'target.d']])
    expect(budgetUsed()).toBe(4)
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': false, 'target.d': true })
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 22 })
  })
})

describe('Planner Alternative scenario composition: request-global maxPlannerReruns (PLANNER_SPEC 9.2.19.12)', () => {
  it('shares one budget between the kernel trials and the adoption runs: the limit-th run still evaluates', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = ['b', 'c'].map((t) => kernelTarget(t, found(t)))
    script.runs = [{ result: result({ plan: plan(18, [FIXED, generatedOf('b'), generatedOf('c')]) }) }]
    const comparison = await compare(request(3))
    expect(budgetUsed()).toBe(3)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 18 })
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': true })
  })

  it('reaches the rerun bound only when one more run is needed: accepted stays true, the unevaluated are null', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = ['b', 'c', 'd'].map((t) => kernelTarget(t, found(t)))
    script.runs = [{ result: result({ plan: plan(18, [FIXED, generatedOf('b'), generatedOf('c')]) }) }]
    const comparison = await compare(request(4))
    expect(script.runContexts).toHaveLength(1)
    expect(budgetUsed()).toBe(4)
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true, 'target.c': true, 'target.d': null })
    expect(comparison.scenario).toEqual({ status: 'stopped_by_planner_rerun_bound' })
    // No preflight is prepared for a run the budget cannot start.
    expect(script.preflights).toBe(1)
  })

  it('found = 0 with the budget spent by the trials stops the scenario without a run', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [kernelTarget('b', { status: 'stopped_by_candidate_trial_bound' })]
    const comparison = await compare(request(2))
    expect(script.runContexts).toEqual([])
    expect(comparison.scenario).toEqual({ status: 'stopped_by_planner_rerun_bound' })
  })

  it('found = 1 needs no run, so a spent budget still evaluates', async () => {
    script.kernelTrialRuns = 1
    script.kernelTargets = [kernelTarget('b', found('b'))]
    const comparison = await compare(request(1))
    expect(budgetUsed()).toBe(1)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 10 })
    expect(adoptedOf(comparison)).toEqual({ 'target.b': true })
  })

  it('counts a runtime-unsupported retry inside an adoption run against the same budget', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = ['b', 'c'].map((t) => kernelTarget(t, found(t)))
    script.runs = [{ retries: 1, result: result({ plan: plan(18, [FIXED, generatedOf('b'), generatedOf('c')]) }) }]
    const comparison = await compare(request(4))
    expect(budgetUsed()).toBe(4)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated' })

    // The same retry with one unit fewer: the retry cannot start, so C2 is unevaluated.
    script.kernelBudget = null
    script.runs = [{ retries: 1, result: result({ plan: plan(18, [FIXED, generatedOf('b'), generatedOf('c')]) }) }]
    const stopped = await compare(request(3))
    expect(budgetUsed()).toBe(3)
    expect(adoptedOf(stopped)).toEqual({ 'target.b': true, 'target.c': null })
    expect(stopped.scenario).toEqual({ status: 'stopped_by_planner_rerun_bound' })
  })
})

describe('Planner Alternative typed scenario (PLANNER_SPEC 9.2.19.13)', () => {
  it('counts the final Plan steps, never the Route estimates', async () => {
    script.kernelTrialRuns = 1
    // The alternative Route alone claims 40 own operations; the scenario Plan has 9 Steps.
    script.kernelTargets = [kernelTarget('b', found('b', trialResultFor('b', 9), 40))]
    const comparison = await compare()
    const b = comparison.alternatives[0].outcome
    if (b.status !== 'found') throw new Error('expected found')
    expect(b.distance.estimatedOperationCount).toBe(40)
    expect(comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 9 })
  })

  it('returns no count for a plan-step bound and reports no_plan for a scenario run without Plan', async () => {
    script.kernelTrialRuns = 1
    script.kernelTargets = [kernelTarget('b', found('b', result({
      plan: plan(50, [FIXED, generatedOf('b')]),
      termination: incompletePlannerTermination(['max_plan_steps'], { limits: { maxPlanSteps: 50 } }),
    })))]
    expect((await compare()).scenario).toEqual({ status: 'stopped_by_plan_step_bound', maxPlanSteps: 50 })

    script.kernelTargets = [kernelTarget('b', { status: 'not_found_within_search_extent' })]
    script.runs = [{ result: result({ plan: null, termination: exhaustedPlannerTermination() }) }]
    expect((await compare()).scenario).toEqual({ status: 'no_plan' })
  })

  it('classifies the final result conflicts, expanding the decision over the invalidated Entries left in place', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = [
      kernelTarget('b', found('b')),
      kernelTarget('c', { status: 'not_found_within_search_extent' }),
      kernelTarget('d', { status: 'blocked_by_selected_checkpoint' }),
    ]
    const conflicts = [
      // A vs C, left in place: the decision expands onto it.
      conflict('conflict.a-c', [FIXED, entryOf('c')]),
      // A vs C vs E: another Entry takes part, so no expansion.
      conflict('conflict.a-c-e', [FIXED, entryOf('c'), entryOf('e')]),
      // B2 vs E: introduced by the accepted replacement.
      conflict('conflict.b2-e', [generatedOf('b'), entryOf('e')]),
      // A vs C resolved by an explicit resolution: not unresolved.
      conflict('conflict.explicit', [FIXED, entryOf('c')], FIXED),
      // A vs D with a selected checkpoint: never expanded.
      { ...conflict('conflict.a-d', [FIXED, entryOf('d')]), checkpointParticipants: [{ buildListEntryId: entryOf('d'), axis: 'skill', opportunityId: 'opp' }] } as PlanConflict,
    ]
    script.kernelTargets[0] = kernelTarget('b', found('b', result({
      plan: plan(14, [FIXED, generatedOf('b')], ['a', 'b']),
      conflicts,
    })))
    const comparison = await compare()
    expect(comparison.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: 14,
      unplannedTargetWeaponIds: ['target.c', 'target.d', 'target.e'],
      introducedConflicts: [
        { kind: 'same_gogma_counter', participantTargetWeaponIds: ['target.b', 'target.e'], resolved: false },
      ],
      remainingConflicts: [
        { kind: 'same_gogma_counter', participantTargetWeaponIds: ['target.a', 'target.c', 'target.e'], resolved: false },
        { kind: 'same_gogma_counter', participantTargetWeaponIds: ['target.a', 'target.d'], resolved: false },
      ],
    })
  })

  it('counts only prior lineage skips as excludedByRepairLineageCount', async () => {
    script.kernelTrialRuns = 1
    script.kernelTargets = [
      // Skipped: the current Route only, the lineage key, and a key in both.
      kernelTarget('b', found('b'), ['route.current', 'route.lineage', 'route.both']),
      // Not searched.
      kernelTarget('c', { status: 'blocked_by_selected_checkpoint' }),
    ]
    const comparison = await compare(request(8, {
      priorExcludedRoutes: [
        { targetWeaponId: targetId('b'), routeKeys: ['route.lineage', 'route.both', 'route.never-reached'] },
        { targetWeaponId: targetId('c'), routeKeys: ['route.lineage'] },
      ],
    }))
    expect(comparison.alternatives.map(({ excludedByRepairLineageCount }) => excludedByRepairLineageCount)).toEqual([2, 0])
  })

  it('projects the Route summary from the Candidate and keeps the stable Target order', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [kernelTarget('c', { status: 'stopped_by_planner_rerun_bound' }), kernelTarget('b', found('b'))]
    const comparison = await compare()
    expect(comparison.alternatives.map(({ alternativeTargetWeaponId }) => alternativeTargetWeaponId)).toEqual(['target.c', 'target.b'])
    expect(comparison.alternatives.every(({ fixedBuildListEntryId, fixedTargetWeaponId }) =>
      fixedBuildListEntryId === FIXED && fixedTargetWeaponId === FIXED_TARGET)).toBe(true)
    const b = comparison.alternatives[1].outcome
    if (b.status !== 'found') throw new Error('expected found')
    expect(b.alternative).toEqual({
      route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: null, operations: [] },
      finalBonuses: [],
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: 'series.fixture',
      groupSkillId: null,
      bonusAmendmentTrace: [],
      skillAmendmentTrace: [],
      conversionSkillTrace: null,
    })
    expect(comparison.conflictKey).toBe(CONFLICT)
    expect(structuredClone(comparison)).toEqual(comparison)
  })
})
