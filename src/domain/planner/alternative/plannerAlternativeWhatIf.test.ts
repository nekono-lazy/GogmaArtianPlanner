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
  TargetWeapon,
} from '../../models/publicTypes'
import { candidateStableKey, PlannerAlternativeSearchError } from '../../search'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelResult,
} from './plannerAlternativeKernel'
import {
  createPlannerAlternativeWhatIfComparison,
  type PlannerAlternativeComparison,
  type PlannerAlternativeWhatIfRequest,
} from './plannerAlternativeWhatIf'

/*
 * The Planner Alternative What-if Calculation end to end over the real kernel,
 * Planner Alternative Search, materializer, replacement preflight and Production
 * Plan generation (deterministic scheduler + Trace Replay). Only the Fake RNG
 * Engine, the ID factory and the Clock are injected; one test forces a
 * preflight refusal to get a rejected trial, which no fixture reaches.
 * The composition rules themselves are counted in
 * `plannerAlternativeWhatIf.composition.test.ts`.
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

const TARGET_A = 'target.what-if.a'
const TARGET_B = 'target.what-if.b'
const TARGET_C = 'target.what-if.c'
const SOURCE_C = 'owned.what-if.c'
const ENTRY_A = 'build-list.what-if.a' as BuildListEntryId
const ENTRY_B = 'build-list.what-if.b' as BuildListEntryId
const ENTRY_C = 'build-list.what-if.c' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const SOURCE_C_SKILL = 'series_skill.fixture.c-source'

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
 * The kernel fixture: A and B contend for Gogma 10. With A fixed, B's
 * alternative crosses the held and blocked Gogma 10 (Reset 11, Reset 12).
 */
function parts(): Parts {
  const a = ownSkillTarget(TARGET_A, SOURCE_A_SKILL, 5)
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

/** Target C, higher priority than B, Resets at Gogma 11 and 12, where B's alternative ends. */
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
    kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A) && buildListEntryIds.includes(ENTRY_B))
  if (!conflict) throw new Error('no Gogma conflict between A and B')
  return conflict.id
}

function request(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeWhatIfRequest> = {}): PlannerAlternativeWhatIfRequest {
  return {
    plannerInput: built.input,
    scenarioResolution: { conflictKey: gogmaConflictKey(built), selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 },
    bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
    ...overrides,
  }
}

async function compare(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeWhatIfRequest> = {}): Promise<PlannerAlternativeComparison> {
  const result = await createPlannerAlternativeWhatIfComparison(request(built, overrides), built.dependencies)
  if (result.status !== 'completed') throw new Error(`what-if failed: ${JSON.stringify(result)}`)
  return result.comparison
}

function kernelTargetB(result: PlannerAlternativeKernelResult) {
  if (result.status !== 'completed') throw new Error('kernel failed')
  const b = result.targets.find(({ targetWeaponId }) => targetWeaponId === TARGET_B)
  if (!b) throw new Error('no B')
  return b
}

function countPredictions(built: OrchestrationScenario): () => number {
  const spies = [
    vi.spyOn(built.engine, 'predictGogmaBonus'),
    vi.spyOn(built.engine, 'predictSkills'),
    vi.spyOn(built.engine, 'predictNormalArtian'),
  ]
  return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)
}

/** Ideal again at Gogma 14, so B has a second, costlier alternative. */
const twoIdeals = (gogmaCounter: number) =>
  gogmaCounter === 14 ? idealBonuses() : orchestrationResetResultAt(gogmaCounter)

describe('Planner Alternative what-if over the real kernel (PLANNER_SPEC 9.2.19.7 / 9.2.19.13)', () => {
  it('reuses the one found trial as the scenario: its Plan steps, the Route summary, no conflict', async () => {
    const built = scenario(parts())
    const kernel = kernelTargetB(await runPlannerAlternativeKernel({
      ...request(built),
      decision: request(built).scenarioResolution,
    }, built.dependencies))
    if (kernel.outcome.status !== 'found') throw new Error('expected found')

    const comparison = await compare(scenario(parts()))
    expect(comparison).toMatchObject({ fixedBuildListEntryId: ENTRY_A, fixedTargetWeaponId: TARGET_A })
    expect(comparison.alternatives).toHaveLength(1)
    const b = comparison.alternatives[0]
    expect(b).toMatchObject({ fixedBuildListEntryId: ENTRY_A, alternativeTargetWeaponId: TARGET_B, excludedByRepairLineageCount: 0 })
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(b.outcome.adoptedInScenario).toBe(true)
    expect(b.outcome.distance).toEqual({
      estimatedOperationCount: 3,
      estimatedGogmaAdvance: 3,
      estimatedSkillAdvance: kernel.outcome.candidate.estimatedSkillAdvance,
      estimatedNormalAdvance: kernel.outcome.candidate.estimatedNormalAdvance,
    })
    expect(b.outcome.alternative).toEqual({
      route: kernel.outcome.candidate.route,
      finalBonuses: kernel.outcome.candidate.finalBonuses,
      restorationBonusScope: kernel.outcome.candidate.restorationBonusScope,
      seriesSkillId: kernel.outcome.candidate.seriesSkillId,
      groupSkillId: kernel.outcome.candidate.groupSkillId,
      bonusAmendmentTrace: kernel.outcome.candidate.bonusAmendmentTrace,
      skillAmendmentTrace: kernel.outcome.candidate.skillAmendmentTrace,
      conversionSkillTrace: null,
    })
    // The scenario Plan is the reused trial Plan itself.
    const trialSteps = kernel.outcome.trialResult.plan!.steps.length
    expect(comparison.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: trialSteps,
      unplannedTargetWeaponIds: [],
      introducedConflicts: [],
      remainingConflicts: [],
    })
    expect(structuredClone(comparison)).toEqual(comparison)
  })

  it('adds no prediction for the Route summary or the scenario when the trial is reused', async () => {
    const one = scenario(parts())
    const kernelCount = countPredictions(one)
    await runPlannerAlternativeKernel({ ...request(one), decision: request(one).scenarioResolution }, one.dependencies)
    const two = scenario(parts())
    const whatIfCount = countPredictions(two)
    await compare(two)
    expect(kernelCount()).toBeGreaterThan(0)
    expect(whatIfCount()).toBe(kernelCount())
  })

  it('reports the conflict the alternative introduces with an unfixed Target, without re-searching that Target', async () => {
    const comparison = await compare(scenario(withUnfixedC(parts())))
    expect(comparison.alternatives.map(({ alternativeTargetWeaponId }) => alternativeTargetWeaponId)).toEqual([TARGET_B])
    const b = comparison.alternatives[0].outcome
    if (b.status !== 'found') throw new Error('expected found')
    expect(b.adoptedInScenario).toBe(true)
    expect(comparison.scenario).toMatchObject({
      status: 'evaluated',
      unplannedTargetWeaponIds: [TARGET_B],
      introducedConflicts: [expect.objectContaining({ participantTargetWeaponIds: [TARGET_B, TARGET_C], resolved: false })],
      remainingConflicts: [],
    })
  })

  it('runs one scenario over the input without replacement when nothing is found', async () => {
    const noIdeal = (gogmaCounter: number) => (gogmaCounter === 10 ? idealBonuses() : practicalBonuses())
    const built = scenario(parts(), noIdeal)
    const comparison = await compare(built, { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 } })
    expect(comparison.alternatives[0].outcome).toEqual({ status: 'stopped_by_search_extent_bound' })
    // A is fixed by the decision, so B's current Route stays out and B is not completed.
    expect(comparison.scenario).toMatchObject({
      status: 'evaluated',
      unplannedTargetWeaponIds: [TARGET_B],
      introducedConflicts: [],
      remainingConflicts: [],
    })
    if (comparison.scenario.status !== 'evaluated') return
    expect(comparison.scenario.scenarioOperationCount).toBeGreaterThan(0)

    // That one scenario run is the only full run: with one unit it still evaluates.
    const once = await compare(scenario(parts(), noIdeal), {
      extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 },
      bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 1 },
    })
    expect(once.scenario).toEqual(comparison.scenario)
  })

  it('evaluates every Target from the same baseline, whatever the input order', async () => {
    const one = await compare(scenario(withUnfixedC(parts())))
    const reversed = scenario(withUnfixedC(parts()))
    reversed.input.buildListEntries.reverse()
    reversed.input.targetWeapons.reverse()
    expect(await compare(reversed)).toEqual(one)
  })

  it('persists nothing and leaves its input untouched', async () => {
    const built = scenario(parts())
    const before = structuredClone(built.input)
    await compare(built)
    expect(built.input).toEqual(before)
  })
})

describe('Planner Alternative what-if: excludedByRepairLineageCount (PLANNER_SPEC 9.2.19.13)', () => {
  async function firstFound() {
    const built = scenario(parts(), twoIdeals)
    const b = kernelTargetB(await runPlannerAlternativeKernel({ ...request(built), decision: request(built).scenarioResolution }, built.dependencies))
    if (b.outcome.status !== 'found') throw new Error('expected found')
    return { key: candidateStableKey(b.outcome.candidate), route: b.outcome.candidate.route }
  }

  it('is zero with no prior lineage, and counts a reached lineage key once, never an unreached one', async () => {
    expect((await compare(scenario(parts(), twoIdeals))).alternatives[0].excludedByRepairLineageCount).toBe(0)

    const { key, route } = await firstFound()
    const built = scenario(parts(), twoIdeals)
    const comparison = await compare(built, {
      priorExcludedRoutes: [
        { targetWeaponId: TARGET_B as never, routeKeys: [key, 'route.lineage.never-reached'] },
        { targetWeaponId: TARGET_A as never, routeKeys: [key] },
      ],
    })
    const b = comparison.alternatives[0]
    expect(b.excludedByRepairLineageCount).toBe(1)
    if (b.outcome.status !== 'found') throw new Error('expected the second alternative')
    // The lineage-excluded first alternative is skipped; the costlier second one is found.
    expect(b.outcome.alternative.route).not.toEqual(route)
    expect(b.outcome.distance.estimatedOperationCount).toBeGreaterThan(route.operations.length)
  })

  it('does not count a rejected trial', async () => {
    forced.refusePreflights = 1
    const comparison = await compare(scenario(parts(), twoIdeals))
    const b = comparison.alternatives[0]
    expect(b.outcome.status).toBe('found')
    expect(b.excludedByRepairLineageCount).toBe(0)
  })
})

describe('Planner Alternative what-if: fail closed', () => {
  it('passes preparation failures through as typed values', async () => {
    const built = scenario(parts())
    const invalid = await createPlannerAlternativeWhatIfComparison(
      request(built, { scenarioResolution: { conflictKey: 'conflict.unknown', selectedBuildListEntryId: ENTRY_A } }),
      built.dependencies,
    )
    expect(invalid.status).toBe('invalid_fixed_resolution')
    const prior = await createPlannerAlternativeWhatIfComparison(
      request(built, { priorFixedBuildListEntryIds: ['build-list.what-if.missing' as BuildListEntryId] }),
      built.dependencies,
    )
    expect(prior).toMatchObject({ status: 'invalid_prior_fixed_entry' })
  })

  it('refuses an invalid extent even when the only Target is checkpoint-blocked and never searched', async () => {
    const a = ownSkillTarget(TARGET_A, SOURCE_A_SKILL, 5)
    const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
    const sourceB = orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: practicalBonuses(), seriesSkillId: SOURCE_B_SKILL })
    const blockedParts = (): Parts => ({
      targets: [a, b],
      ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }), sourceB],
      entries: [
        orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
        checkpointMixedEntry(ENTRY_B, b, ORCHESTRATION_SOURCE_B, sourceB, { select: true }),
      ],
    })
    const valid = await compare(scenario(blockedParts()))
    expect(valid.alternatives[0].outcome).toEqual({ status: 'blocked_by_selected_checkpoint' })

    const built = scenario(blockedParts())
    for (const extent of [
      { maxNormalAdvance: 1, maxGogmaAdvance: 5 } as never,
      { maxNormalAdvance: 0, maxGogmaAdvance: 5, maxSkillAdvance: 2 },
    ]) {
      await expect(createPlannerAlternativeWhatIfComparison(request(built, { extent }), built.dependencies))
        .rejects.toBeInstanceOf(PlannerAlternativeSearchError)
    }
  })

  it('takes no default for missing or partial extent and bounds', async () => {
    const built = scenario(parts())
    for (const overrides of [
      { bounds: undefined as never },
      { bounds: { maxCandidateTrialsPerTarget: 2 } as never },
      { bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 0 } },
      { extent: undefined as never },
      { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5 } as never },
    ]) {
      await expect(createPlannerAlternativeWhatIfComparison(request(built, overrides), built.dependencies)).rejects.toThrow()
    }
  })
})
