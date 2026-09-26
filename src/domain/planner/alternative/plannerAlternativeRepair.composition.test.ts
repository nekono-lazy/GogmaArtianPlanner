import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  BuildListEntryId,
  PlanConflict,
  PlannerConflictRepairLineage,
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
  PlannerRunResult,
  ProductionPlanGenerationObserver,
} from '../plannerTypes'
import type { PlannerAlternativeComparison } from './plannerAlternativeComparison'
import type {
  PlannerAlternativeFound,
  PlannerAlternativeKernelCompletedResult,
  PlannerAlternativeKernelOutcome,
  PlannerAlternativeKernelRequest,
  PlannerAlternativeKernelTargetResult,
} from './plannerAlternativeKernel'
import {
  createPlannerAlternativeRepair,
  type PlannerAlternativeRepairArtifact,
  type PlannerAlternativeRepairCalculationResult,
  type PlannerAlternativeRepairRequest,
} from './plannerAlternativeRepair'
import type { PlannerAlternativeFullRunBudget } from './plannerAlternativeTrial'
import { createPlannerAlternativeWhatIfComparison } from './plannerAlternativeWhatIf'

/*
 * The actual repair over the shared scenario calculation, isolated the same
 * way as `plannerAlternativeWhatIf.composition.test.ts`: the kernel's
 * individual trials, the preflights and the full Planner runs are scripted, so
 * every full run and budget unit is counted, while the scenario composition,
 * the found judgement, the budget, the decision expansion and the lineage are
 * the real ones. Every scenario is also run as a what-if over the same script
 * to show the two share one calculation.
 */

interface ScriptedRun {
  retries?: number
  result: PlannerResult
}

const script = vi.hoisted(() => ({
  kernelTrialRuns: 0,
  kernelTargets: [] as unknown[],
  kernelBudget: null as unknown,
  kernelRequests: [] as unknown[],
  runs: [] as unknown[],
  runCount: 0,
  refusedAdoptions: new Set<string>(),
}))

const FIXED = 'entry.a' as BuildListEntryId
const FIXED_TARGET = 'target.a' as TargetWeaponId
const CONFLICT = 'conflict.scenario'
const NAMES = ['a', 'b', 'c', 'd', 'e']

const entryOf = (t: string) => `entry.${t}` as BuildListEntryId
const generatedOf = (t: string) => `generated.${t}` as BuildListEntryId
const targetId = (t: string) => `target.${t}` as TargetWeaponId

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
            buildListEntries: NAMES.map((t) => ({ id: entryOf(t), targetWeaponId: targetId(t) }) as BuildListEntry),
          },
          fixedConstraints: [],
          conflictContexts: [],
          initialContext: { planningTargetIds: NAMES.map(targetId) },
          scenarioConstraint: { resourceIdentity: { kind: 'same_gogma_counter', counterStream: 'gogma', counterBefore: 10 } },
        },
      },
    }),
    runPreparedPlannerAlternativeKernel: async (
      _prepared: unknown,
      request: PlannerAlternativeKernelRequest,
      _dependencies: unknown,
      options: { fullRunBudget: PlannerAlternativeFullRunBudget },
    ): Promise<PlannerAlternativeKernelCompletedResult> => {
      script.kernelBudget = options.fullRunBudget
      script.kernelRequests.push(request)
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
    ) => script.refusedAdoptions.has(replacements[replacements.length - 1].generatedBuildListEntryId)
      ? { status: 'unresolved', conflictResolutions: [], failures: [] }
      : { status: 'ready', resolvedInput: input },
    preparePlannerAugmentedConflictPreflight: (input: PlannerInput) => ({ status: 'ready', resolvedInput: input }),
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
    ) => {
      const next = script.runs[script.runCount] as ScriptedRun | undefined
      script.runCount += 1
      if (!next) throw new Error('No scripted full Planner run left.')
      for (let run = 0; run <= (next.retries ?? 0); run += 1) {
        observer.beforePlannerRun()
        observer.afterPlannerRun?.({ cancelled: false, routeCommitment: undefined } as unknown as PlannerRunResult)
      }
      return structuredClone(next.result)
    },
  }
})

beforeEach(() => {
  script.kernelTrialRuns = 0
  script.kernelTargets = []
  script.kernelBudget = null
  script.kernelRequests = []
  script.runs = []
  script.runCount = 0
  script.refusedAdoptions = new Set()
})

function plan(
  stepCount: number,
  selected: readonly BuildListEntryId[],
  conflicts: PlanConflict[] = [],
  completions: readonly string[] = [],
): ProductionPlan {
  return {
    id: 'plan.scenario',
    selectedBuildListEntryIds: [...selected],
    conflicts: structuredClone(conflicts),
    steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `step.${index}`,
      executionEffects: { targetCompletions: index === 0 ? completions.map((t) => ({ targetWeaponId: targetId(t) })) : [] },
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
  warnings?: PlannerResult['warnings']
}): PlannerResult {
  const conflicts = options.conflicts ?? []
  return {
    plan: options.plan === undefined ? plan(1, [FIXED], conflicts) : options.plan,
    conflicts,
    warnings: options.warnings ?? [],
    termination: options.termination ?? completedPlannerTermination(),
  }
}

function planResult(stepCount: number, selected: readonly BuildListEntryId[], conflicts: PlanConflict[] = []): PlannerResult {
  return result({ plan: plan(stepCount, selected, conflicts), conflicts })
}

function candidate(): PlannerAlternativeCandidate {
  return {
    targetWeaponId: 'target.x',
    finalBonuses: [],
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series.fixture',
    groupSkillId: null,
    route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: null, operations: [] },
    estimatedOperationCount: 3,
    estimatedGogmaAdvance: 3,
    estimatedSkillAdvance: 0,
    estimatedNormalAdvance: null,
    requiredMaterials: [],
    bonusAmendmentTrace: [],
    skillAmendmentTrace: [],
  } as unknown as PlannerAlternativeCandidate
}

function kernelTarget(t: string, outcome: PlannerAlternativeKernelOutcome): PlannerAlternativeKernelTargetResult {
  return {
    targetWeaponId: targetId(t),
    invalidatedBuildListEntryId: entryOf(t),
    invalidatedRouteKey: `route.${t}`,
    fixedRouteBuildListEntryIds: [FIXED],
    reservation: null,
    excludedRouteKeys: [`route.${t}`],
    outcome,
    search: null,
    trials: [],
    skippedExcludedRouteKeys: [],
  }
}

function found(t: string, trialResult = planResult(10, [FIXED, generatedOf(t)])): PlannerAlternativeFound {
  return {
    status: 'found',
    candidate: candidate(),
    generated: { entry: { id: generatedOf(t), targetWeaponId: targetId(t) } } as never,
    replacement: { targetWeaponId: targetId(t), replacedBuildListEntryId: entryOf(t), generatedBuildListEntryId: generatedOf(t) },
    trialResult,
    trialRouteCommitment: null,
    generatedSelected: true,
  }
}

const dependencies = {} as PlannerDependencies

function request(maxPlannerReruns = 8, lineage: PlannerConflictRepairLineage | null = null): PlannerAlternativeRepairRequest {
  return {
    plannerInput: {
      buildListEntries: NAMES.map((t) => ({ id: entryOf(t), targetWeaponId: targetId(t) })),
    } as unknown as PlannerInput,
    decision: { conflictKey: CONFLICT, selectedBuildListEntryId: FIXED },
    lineage,
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 },
    bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns },
  }
}

interface Both {
  repair: Extract<PlannerAlternativeRepairCalculationResult, { status: 'completed' }>
  whatIf: PlannerAlternativeComparison
  repairRuns: number
  repairBudget: number
}

/** Runs the repair, then a what-if over the same script, and checks they are one calculation. */
async function repairAndWhatIf(req = request()): Promise<Both> {
  const firstKernelRequest = script.kernelRequests.length
  const repair = await createPlannerAlternativeRepair(req, dependencies)
  if (repair.status !== 'completed') throw new Error(`repair failed: ${repair.status}`)
  const repairRuns = script.runCount
  const repairBudget = (script.kernelBudget as PlannerAlternativeFullRunBudget).used
  const repairKernelRequest = script.kernelRequests[firstKernelRequest] as PlannerAlternativeKernelRequest
  script.runCount = 0
  const whatIf = await createPlannerAlternativeWhatIfComparison({
    plannerInput: req.plannerInput,
    scenarioResolution: req.decision,
    priorFixedBuildListEntryIds: repairKernelRequest.priorFixedBuildListEntryIds,
    priorExcludedRoutes: repairKernelRequest.priorExcludedRoutes,
    extent: req.extent,
    bounds: req.bounds,
  }, dependencies)
  if (whatIf.status !== 'completed') throw new Error(`what-if failed: ${whatIf.status}`)
  // The same comparison, the same full runs, the same budget.
  expect(repair.comparison).toEqual(whatIf.comparison)
  expect(script.runCount).toBe(repairRuns)
  expect((script.kernelBudget as PlannerAlternativeFullRunBudget).used).toBe(repairBudget)
  return { repair, whatIf: whatIf.comparison, repairRuns, repairBudget }
}

function artifactOf(both: Both): PlannerAlternativeRepairArtifact {
  if (both.repair.persistence.status !== 'persistable') {
    throw new Error(`expected an artifact, got ${both.repair.persistence.reason}`)
  }
  return both.repair.persistence.artifact
}

describe('Planner Alternative actual repair: one shared scenario calculation (PLANNER_SPEC 9.2.19.8.1)', () => {
  it('found = 0: one scenario run, an artifact without replacement, and each individual outcome in the lineage', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [
      kernelTarget('b', { status: 'not_found_within_search_extent' }),
      kernelTarget('c', { status: 'stopped_by_search_extent_bound' }),
    ]
    script.runs = [{ result: planResult(7, [FIXED]) }]
    const both = await repairAndWhatIf()
    expect(both.repairRuns).toBe(1)
    expect(both.repairBudget).toBe(3)
    const artifact = artifactOf(both)
    expect(artifact.plannerResult.plan.steps).toHaveLength(7)
    expect(both.repair.comparison.scenario).toMatchObject({ status: 'evaluated', scenarioOperationCount: 7 })
    expect(artifact.generatedBuildListEntries).toEqual([])
    expect(artifact.generatedBuildListEntryReplacements).toEqual([])
    expect(artifact.conflictRepairLineage).toEqual({
      decisions: [{
        conflictKind: 'same_gogma_counter',
        fixedBuildListEntryId: FIXED,
        fixedTargetWeaponId: FIXED_TARGET,
        invalidatedRoutes: [
          { targetWeaponId: targetId('b'), invalidatedBuildListEntryId: entryOf('b'), invalidatedRouteKey: 'route.b', replacementBuildListEntryId: null, outcome: 'not_found_within_search_extent' },
          { targetWeaponId: targetId('c'), invalidatedBuildListEntryId: entryOf('c'), invalidatedRouteKey: 'route.c', replacementBuildListEntryId: null, outcome: 'stopped_by_search_extent_bound' },
        ],
      }],
    })
  })

  it('found = 1: reuses the individual trial as the saved Plan with no further run', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [
      kernelTarget('b', { status: 'blocked_by_selected_checkpoint' }),
      kernelTarget('c', found('c', planResult(12, [FIXED, generatedOf('c')]))),
    ]
    const both = await repairAndWhatIf()
    expect(both.repairRuns).toBe(0)
    expect(both.repairBudget).toBe(2)
    const artifact = artifactOf(both)
    expect(artifact.plannerResult.plan.steps).toHaveLength(12)
    expect(artifact.generatedBuildListEntries.map(({ id }) => id)).toEqual([generatedOf('c')])
    expect(artifact.generatedBuildListEntryReplacements).toEqual([
      { targetWeaponId: targetId('c'), replacedBuildListEntryId: entryOf('c'), generatedBuildListEntryId: generatedOf('c') },
    ])
    expect(artifact.conflictRepairLineage.decisions[0].invalidatedRoutes.map(({ outcome, replacementBuildListEntryId }) =>
      [outcome, replacementBuildListEntryId])).toEqual([
      ['blocked_by_selected_checkpoint', null],
      ['replaced', generatedOf('c')],
    ])
  })

  it('found = n with rejects: only accepted replacements are saved; rejected ones are rejected_by_scenario_composition', async () => {
    script.kernelTrialRuns = 4
    script.kernelTargets = ['b', 'c', 'd', 'e'].map((t) => kernelTarget(t, found(t)))
    // C2: adoption preflight refused (no run). D2: adoption run rejects it.
    script.refusedAdoptions = new Set([generatedOf('c')])
    script.runs = [
      { result: planResult(25, [FIXED, generatedOf('b')]) },
      { result: planResult(33, [FIXED, generatedOf('b'), generatedOf('e')]) },
    ]
    const both = await repairAndWhatIf()
    expect(both.repairRuns).toBe(2)
    expect(both.repairBudget).toBe(6)
    const artifact = artifactOf(both)
    expect(artifact.plannerResult.plan.steps).toHaveLength(33)
    expect(artifact.generatedBuildListEntries.map(({ id }) => id)).toEqual([generatedOf('b'), generatedOf('e')])
    expect(artifact.generatedBuildListEntryReplacements.map(({ targetWeaponId }) => targetWeaponId))
      .toEqual([targetId('b'), targetId('e')])
    expect(artifact.conflictRepairLineage.decisions[0].invalidatedRoutes).toEqual([
      { targetWeaponId: targetId('b'), invalidatedBuildListEntryId: entryOf('b'), invalidatedRouteKey: 'route.b', replacementBuildListEntryId: generatedOf('b'), outcome: 'replaced' },
      { targetWeaponId: targetId('c'), invalidatedBuildListEntryId: entryOf('c'), invalidatedRouteKey: 'route.c', replacementBuildListEntryId: null, outcome: 'rejected_by_scenario_composition' },
      { targetWeaponId: targetId('d'), invalidatedBuildListEntryId: entryOf('d'), invalidatedRouteKey: 'route.d', replacementBuildListEntryId: null, outcome: 'rejected_by_scenario_composition' },
      { targetWeaponId: targetId('e'), invalidatedBuildListEntryId: entryOf('e'), invalidatedRouteKey: 'route.e', replacementBuildListEntryId: generatedOf('e'), outcome: 'replaced' },
    ])
    expect(both.whatIf.alternatives.map(({ outcome }) => outcome.status === 'found' && outcome.adoptedInScenario))
      .toEqual([true, false, false, true])
  })

  it('reuses the previous accepted result when the last replacement is rejected', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = ['b', 'c'].map((t) => kernelTarget(t, found(t, planResult(t === 'b' ? 11 : 13, [FIXED, generatedOf(t)]))))
    script.runs = [{ result: planResult(20, [FIXED, generatedOf('c')]) }]
    const both = await repairAndWhatIf()
    const artifact = artifactOf(both)
    // B2's own trial Plan, not the rejected run.
    expect(artifact.plannerResult.plan.steps).toHaveLength(11)
    expect(artifact.generatedBuildListEntries.map(({ id }) => id)).toEqual([generatedOf('b')])
    expect(artifact.conflictRepairLineage.decisions[0].invalidatedRoutes.map(({ outcome }) => outcome))
      .toEqual(['replaced', 'rejected_by_scenario_composition'])
  })
})

describe('Planner Alternative actual repair: no artifact without a savable final Plan (PLANNER_SPEC 9.2.19.8)', () => {
  it('stops on the rerun bound with no artifact and no lineage', async () => {
    script.kernelTrialRuns = 3
    script.kernelTargets = ['b', 'c', 'd'].map((t) => kernelTarget(t, found(t)))
    script.runs = [{ result: planResult(18, [FIXED, generatedOf('b'), generatedOf('c')]) }]
    const both = await repairAndWhatIf(request(4))
    expect(both.repair.comparison.scenario).toEqual({ status: 'stopped_by_planner_rerun_bound' })
    expect(both.repair.persistence).toEqual({ status: 'not_persistable', reason: 'stopped_by_planner_rerun_bound' })
  })

  it('refuses a plan-step bounded result and a scenario without Plan', async () => {
    script.kernelTrialRuns = 1
    script.kernelTargets = [kernelTarget('b', found('b', result({
      plan: plan(50, [FIXED, generatedOf('b')]),
      termination: incompletePlannerTermination(['max_plan_steps'], { limits: { maxPlanSteps: 50 } }),
    })))]
    expect((await repairAndWhatIf()).repair.persistence)
      .toEqual({ status: 'not_persistable', reason: 'stopped_by_plan_step_bound' })

    script.kernelTargets = [kernelTarget('b', { status: 'not_found_within_search_extent' })]
    script.runs = [{ result: result({ plan: null, termination: exhaustedPlannerTermination() }) }]
    script.runCount = 0
    expect((await repairAndWhatIf()).repair.persistence).toEqual({ status: 'not_persistable', reason: 'no_plan' })
  })

  it('refuses a final Plan that could not honour an explicit resolution', async () => {
    script.kernelTrialRuns = 1
    script.kernelTargets = [kernelTarget('b', { status: 'not_found_within_search_extent' })]
    script.runs = [{
      result: result({
        plan: plan(5, [FIXED]),
        warnings: [{ kind: 'invalid_conflict_resolution', message: 'fixture' }],
      }),
    }]
    const both = await repairAndWhatIf()
    expect(both.repair.comparison.scenario.status).toBe('evaluated')
    expect(both.repair.persistence).toEqual({ status: 'not_persistable', reason: 'invalid_conflict_resolution' })
  })
})

describe('Planner Alternative actual repair: decision expansion in the saved Plan (PLANNER_SPEC 9.2.19.9)', () => {
  it('saves the fixed Entry as decided on the invalidated Entries left in place, in the Plan and the result alike', async () => {
    script.kernelTrialRuns = 2
    script.kernelTargets = [
      kernelTarget('b', found('b')),
      kernelTarget('c', { status: 'not_found_within_search_extent' }),
    ]
    const conflicts = [
      conflict('conflict.a-c', [FIXED, entryOf('c')]),
      conflict('conflict.a-c-e', [FIXED, entryOf('c'), entryOf('e')]),
      conflict('conflict.b2-e', [generatedOf('b'), entryOf('e')]),
      conflict('conflict.explicit', [FIXED, entryOf('c')], entryOf('c')),
      { ...conflict('conflict.a-c.checkpoint', [FIXED, entryOf('c')]), checkpointParticipants: [{ buildListEntryId: entryOf('c'), axis: 'skill', opportunityId: 'opp' }] } as PlanConflict,
      { ...conflict('conflict.a-c.legacy', [FIXED, entryOf('c')]), checkpointParticipants: undefined },
      // B's invalidated Entry was replaced: B is no longer left in place.
      conflict('conflict.a-b', [FIXED, entryOf('b')]),
    ]
    script.kernelTargets[0] = kernelTarget('b', found('b', planResult(14, [FIXED, generatedOf('b')], conflicts)))
    const both = await repairAndWhatIf()
    // Expansion is no full Planner run.
    expect(both.repairRuns).toBe(0)
    const artifact = artifactOf(both)
    const selectedById = Object.fromEntries(artifact.plannerResult.conflicts.map(({ id, selectedBuildListEntryId }) => [id, selectedBuildListEntryId]))
    expect(selectedById).toEqual({
      'conflict.a-c': FIXED,
      'conflict.a-c-e': null,
      'conflict.b2-e': null,
      'conflict.explicit': entryOf('c'),
      'conflict.a-c.checkpoint': null,
      'conflict.a-c.legacy': null,
      'conflict.a-b': null,
    })
    expect(artifact.plannerResult.plan.conflicts).toEqual(artifact.plannerResult.conflicts)
    const expanded = artifact.plannerResult.conflicts.find(({ id }) => id === 'conflict.a-c')
    expect(expanded?.resolutionNote).not.toBeNull()
    // The what-if reads the same expansion: the expanded conflict is no unresolved one.
    if (both.whatIf.scenario.status !== 'evaluated') throw new Error('expected evaluated')
    expect([...both.whatIf.scenario.introducedConflicts, ...both.whatIf.scenario.remainingConflicts]).toHaveLength(5)
  })

  it('never mutates the reused trial result', async () => {
    script.kernelTrialRuns = 1
    const trial = planResult(4, [FIXED, generatedOf('b')], [conflict('conflict.a-c', [FIXED, entryOf('c')])])
    const b = found('b', trial)
    script.kernelTargets = [kernelTarget('b', b), kernelTarget('c', { status: 'not_found_within_search_extent' })]
    const before = structuredClone(script.kernelTargets)
    await repairAndWhatIf()
    expect(script.kernelTargets).toEqual(before)
  })
})

describe('Planner Alternative actual repair: lineage context (PLANNER_SPEC 9.2.19.11)', () => {
  it('passes the still valid lineage to the kernel and carries it into the next lineage', async () => {
    const lineage: PlannerConflictRepairLineage = {
      decisions: [
        {
          conflictKind: 'same_skill_counter',
          fixedBuildListEntryId: entryOf('d'),
          fixedTargetWeaponId: targetId('d'),
          invalidatedRoutes: [
            // B's current Entry is still the one recorded: valid.
            { targetWeaponId: targetId('b'), invalidatedBuildListEntryId: 'entry.b-old' as BuildListEntryId, invalidatedRouteKey: 'route.b-old', replacementBuildListEntryId: entryOf('b'), outcome: 'replaced' },
            // E's current Entry is not the one recorded: expired.
            { targetWeaponId: targetId('e'), invalidatedBuildListEntryId: 'entry.e-old' as BuildListEntryId, invalidatedRouteKey: 'route.e-old', replacementBuildListEntryId: 'entry.e-new' as BuildListEntryId, outcome: 'replaced' },
          ],
        },
      ],
    }
    script.kernelTrialRuns = 1
    script.kernelTargets = [kernelTarget('b', found('b'))]
    const both = await repairAndWhatIf(request(8, lineage))
    const kernelRequest = script.kernelRequests[0] as PlannerAlternativeKernelRequest
    expect(kernelRequest.priorFixedBuildListEntryIds).toEqual([entryOf('d')])
    expect(kernelRequest.priorExcludedRoutes).toEqual([{ targetWeaponId: targetId('b'), routeKeys: ['route.b-old'] }])
    expect(artifactOf(both).conflictRepairLineage).toEqual({
      decisions: [
        { ...lineage.decisions[0], invalidatedRoutes: [lineage.decisions[0].invalidatedRoutes[0]] },
        {
          conflictKind: 'same_gogma_counter',
          fixedBuildListEntryId: FIXED,
          fixedTargetWeaponId: FIXED_TARGET,
          invalidatedRoutes: [{ targetWeaponId: targetId('b'), invalidatedBuildListEntryId: entryOf('b'), invalidatedRouteKey: 'route.b', replacementBuildListEntryId: generatedOf('b'), outcome: 'replaced' }],
        },
      ],
    })
    // The request's lineage is not mutated.
    expect(lineage.decisions[0].invalidatedRoutes).toHaveLength(2)
  })

  it('records only the decision invalidated Routes, never a trial-rejected Candidate', async () => {
    script.kernelTrialRuns = 3
    const b = kernelTarget('b', found('b'))
    b.trials = [
      { candidateKey: 'route.rejected-trial', generatedBuildListEntryId: 'generated.rejected' as BuildListEntryId, result: { status: 'rejected', reason: 'not_selected' } },
      { candidateKey: 'route.found', generatedBuildListEntryId: generatedOf('b'), result: { status: 'found', generatedSelected: true } },
    ]
    script.kernelTargets = [b]
    const lineage = artifactOf(await repairAndWhatIf()).conflictRepairLineage
    expect(JSON.stringify(lineage)).not.toContain('rejected-trial')
    expect(JSON.stringify(lineage)).not.toContain('route.found')
    expect(lineage.decisions[0].invalidatedRoutes.map(({ invalidatedRouteKey }) => invalidatedRouteKey)).toEqual(['route.b'])
  })
})
