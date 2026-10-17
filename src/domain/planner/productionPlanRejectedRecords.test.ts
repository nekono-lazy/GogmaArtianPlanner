import { describe, expect, it } from 'vitest'
import type { BuildListEntry, ProductionPlan, RejectedBuildListEntry } from '../models/publicTypes'
import { validateProductionPlan } from '../models/publicTypes'
import {
  G0,
  IDEAL_SKILL,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from '../../test/fixtures/plannerScheduler'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import { PlannerPlanGenerationError } from './plannerPlanGenerationError'
import {
  createProductionPlanWithObserver,
  createProductionPlanWithSearchRunner,
  createRejectedBuildListEntries,
} from './productionPlanGeneration'
import type { PlannerRouteCommitmentEntryEvidence, PlannerRunResult } from './plannerTypes'

/**
 * Issue #121 PR-2 (`docs/PLANNER_SPEC.md` 9.6.9.1, `docs/DATA_MODEL.md` 11.9):
 * Plan generation copies each rejected Entry's `targetWeaponId` from the
 * PlannerInput and gives every `resource_conflict` record its cause, in
 * `rejectedReason()`'s branch order, from the run's own runtime records - the
 * applied explicit resolution, the provisional outcome, or the deadlock /
 * stall drop with whether other committed Routes were pending. Nothing is read
 * from a message, and nothing the Planner decides changes.
 */

/**
 * One Gogma conflict at G0 + 2 between A's holding Keep and B's holding Reset
 * (the scheduler suite's Scenario D, shortened). B ranks first by priority.
 * With `stallWinner`, B also needs a Reset Skills at S0 + 1 that nobody makes
 * reachable: B wins the conflict, runs its Bonus lane, and stalls alone.
 */
function gogmaConflictScenario(options: { stallWinner?: boolean } = {}) {
  const builder = new SchedulerScenarioBuilder()
  builder.keepAt.set(G0 + 2, schedulerIdeal(0))
  builder.resetAt.set(G0 + 2, schedulerIdeal(1))
  if (options.stallWinner) builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  const entryA = builder.existingEntry(
    'entry.a',
    builder.target('target.a', 0, { priority: 2 }),
    builder.gogma('owned.a'),
    { bonus: { from: G0, resets: 2, keeps: 1 } },
  )
  const entryB = builder.existingEntry(
    'entry.b',
    builder.target('target.b', 1, { priority: 4 }),
    builder.gogma('owned.b'),
    {
      bonus: { from: G0, resets: 3 },
      ...(options.stallWinner ? { skill: { from: S0 + 1, resets: 1 } } : {}),
    },
  )
  return { builder, entryA, entryB }
}

/**
 * P completes at G0; Q's only operation is a Reset Skills at S0 + 1, a held
 * position nobody before it fills. Q stalls alone once P is done.
 */
function loneStallScenario() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0, schedulerIdeal(30))
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  const entryP = builder.existingEntry(
    'entry.p',
    builder.target('target.p', 30),
    builder.gogma('owned.p'),
    { bonus: { from: G0, resets: 1 } },
  )
  const entryQ = builder.existingEntry(
    'entry.q',
    builder.target('target.q', 31),
    builder.gogma('owned.q', { restorationBonuses: schedulerIdeal(31), seriesSkillId: 'series_skill.fixture.z' }),
    { skill: { from: S0 + 1, resets: 1 } },
  )
  return { builder, entryP, entryQ }
}

function catalogueScenario(id: string): OrchestrationScenario {
  const found = plannerSchedulerCatalogue().find((item) => item.id === id)
  if (!found) throw new Error(`The catalogue has no ${id} scenario.`)
  return found.scenario
}

async function planOf(scenario: OrchestrationScenario): Promise<ProductionPlan> {
  const result = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
  expect(result.plan).not.toBeNull()
  const plan = result.plan!
  // Every generated Plan passes its own Domain validation, the explicit cause
  // matching the decided Conflicts both ways included.
  expect(validateProductionPlan(plan).issues).toEqual([])
  return plan
}

function evidenceOf(result: PlannerRunResult, entry: BuildListEntry): PlannerRouteCommitmentEntryEvidence {
  const evidence = result.routeCommitment?.entries.find(({ buildListEntryId }) => buildListEntryId === entry.id)
  expect(evidence).toBeDefined()
  return evidence!
}

function record(entry: BuildListEntry, fields: Partial<RejectedBuildListEntry>): RejectedBuildListEntry {
  return {
    buildListEntryId: entry.id,
    targetWeaponId: entry.targetWeaponId,
    reason: 'resource_conflict',
    detail: expect.any(String),
    ...fields,
  } as RejectedBuildListEntry
}

describe('the rejected Build List record of a deterministic scheduler run (Issue #121)', () => {
  it('records an explicit decision loser as explicit_resolution_not_selected with its Target', async () => {
    const probe = gogmaConflictScenario()
    const unresolved = await runPlannerDeterministicSchedule(probe.builder.build().input, probe.builder.build().dependencies)
    const [conflict] = unresolved.conflicts
    const { builder, entryA, entryB } = gogmaConflictScenario()
    // The lower-priority participant is preferred explicitly.
    builder.conflictResolutions = [{ conflictKey: conflict.id, selectedBuildListEntryId: entryA.id }]
    const scenario = builder.build()
    const plan = await planOf(scenario)
    expect(plan.conflicts.find(({ id }) => id === conflict.id)?.selectedBuildListEntryId).toBe(entryA.id)
    expect(plan.selectedBuildListEntryIds).toEqual([entryA.id])
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryB, { resourceConflictCause: 'explicit_resolution_not_selected' }),
    ])
  })

  it('records a provisional outcome loser as provisional_outcome_not_committed', async () => {
    const { builder, entryA, entryB } = gogmaConflictScenario()
    const scenario = builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(evidenceOf(result, entryA)).toMatchObject({
      status: 'dropped',
      provisionalOutcome: { selectedBuildListEntryId: entryB.id },
      stuckDrop: null,
    })
    const plan = await planOf(scenario)
    expect(plan.conflicts.map(({ selectedBuildListEntryId }) => selectedBuildListEntryId)).toEqual([null])
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryA, { resourceConflictCause: 'provisional_outcome_not_committed' }),
    ])
  })

  it('keeps the provisional cause of the loser when its winner is later dropped by a stall', async () => {
    const { builder, entryA, entryB } = gogmaConflictScenario({ stallWinner: true })
    const scenario = builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([])
    expect(evidenceOf(result, entryA)).toMatchObject({
      provisionalOutcome: { selectedBuildListEntryId: entryB.id },
      stuckDrop: null,
    })
    // The winner was the only pending Route when it stalled.
    expect(evidenceOf(result, entryB)).toMatchObject({
      status: 'dropped',
      provisionalOutcome: null,
      stuckDrop: { otherPendingRoutes: false },
    })
    const plan = await planOf(scenario)
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryA, { resourceConflictCause: 'provisional_outcome_not_committed' }),
      record(entryB, { resourceConflictCause: 'stuck_drop_without_other_routes' }),
    ])
  })

  it('records a drop of a true deadlock among several pending Routes as stuck_drop_with_other_routes', async () => {
    const scenario = catalogueScenario('true-deadlock')
    const entryY = scenario.input.buildListEntries.find(({ id }) => id === 'entry.y')!
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(evidenceOf(result, entryY)).toMatchObject({
      status: 'dropped',
      provisionalOutcome: null,
      stuckDrop: { otherPendingRoutes: true },
    })
    const plan = await planOf(scenario)
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryY, { resourceConflictCause: 'stuck_drop_with_other_routes' }),
    ])
  })

  it('records the stall of a lone Route as stuck_drop_without_other_routes', async () => {
    const { builder, entryP, entryQ } = loneStallScenario()
    const scenario = builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryP.id])
    expect(result.conflicts).toEqual([])
    expect(evidenceOf(result, entryQ)).toMatchObject({
      status: 'dropped',
      provisionalOutcome: null,
      stuckDrop: { otherPendingRoutes: false },
    })
    expect(evidenceOf(result, entryP)).toMatchObject({ status: 'secured', provisionalOutcome: null, stuckDrop: null })
    const plan = await planOf(scenario)
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryQ, { resourceConflictCause: 'stuck_drop_without_other_routes' }),
    ])
  })

  it('gives every other reason its Target and no cause', async () => {
    const satisfied = catalogueScenario('cross-satisfaction')
    const entryB = satisfied.input.buildListEntries.find(({ id }) => id === 'entry.b')!
    expect((await planOf(satisfied)).rejectedBuildListEntries).toEqual([
      record(entryB, { reason: 'already_satisfied' }),
    ])

    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 1, schedulerIdeal(23))
    const owned = builder.gogma('owned.ideal', { restorationBonuses: schedulerIdeal(22) })
    builder.existingEntry('entry.z', builder.target('target.z', 22), owned, {})
    const destructive = builder.existingEntry('entry.y', builder.target('target.y', 23), owned, {
      bonus: { from: G0, resets: 2 },
    })
    const protectedPlan = await planOf(builder.build())
    expect(protectedPlan.rejectedBuildListEntries).toEqual([
      record(destructive, { reason: 'requires_protected_weapon' }),
    ])
    expect('resourceConflictCause' in protectedPlan.rejectedBuildListEntries[0]).toBe(false)
  })

  it('records the explicit and the provisional cause side by side in one run', async () => {
    // The scheduler suite's Scenario L, shortened: an explicit Gogma decision
    // and an unresolved Skill conflict.
    const build = () => {
      const { builder, entryA, entryB } = gogmaConflictScenario()
      builder.skillAt.set(S0 + 3, IDEAL_SKILL)
      builder.existingEntry(
        'entry.c',
        builder.target('target.c', 20),
        builder.gogma('owned.c', { restorationBonuses: schedulerIdeal(20), seriesSkillId: 'series_skill.fixture.z' }),
        { skill: { from: S0, resets: 4 } },
      )
      const entryD = builder.existingEntry(
        'entry.d',
        builder.target('target.d', 21),
        builder.gogma('owned.d', { restorationBonuses: schedulerIdeal(21), seriesSkillId: 'series_skill.fixture.z' }),
        { skill: { from: S0, resets: 4 } },
      )
      return { builder, entryA, entryB, entryD }
    }
    const probe = build().builder.build()
    const unresolved = await runPlannerDeterministicSchedule(probe.input, probe.dependencies)
    const gogma = unresolved.conflicts.find(({ kind }) => kind === 'same_gogma_counter')!
    const { builder, entryA, entryB, entryD } = build()
    builder.conflictResolutions = [{ conflictKey: gogma.id, selectedBuildListEntryId: entryA.id }]
    const plan = await planOf(builder.build())
    expect(plan.rejectedBuildListEntries).toEqual([
      record(entryB, { resourceConflictCause: 'explicit_resolution_not_selected' }),
      record(entryD, { resourceConflictCause: 'provisional_outcome_not_committed' }),
    ])
  })
})

describe('a resource_conflict cause the run does not record is never guessed (Issue #121)', () => {
  async function provisionalRun() {
    const { builder, entryA } = gogmaConflictScenario()
    const scenario = builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    return { scenario, result, entryA }
  }

  it('fails closed without route commitment evidence', async () => {
    const { scenario, result } = await provisionalRun()
    const withoutEvidence: PlannerRunResult = { ...result, routeCommitment: undefined }
    expect(() => createRejectedBuildListEntries(
      scenario.input,
      withoutEvidence,
      result.bestState!.selectedBuildListEntryIds,
    )).toThrow(PlannerPlanGenerationError)
  })

  it('fails closed when the dropped Entry names neither a provisional outcome nor a stuck drop', async () => {
    const { scenario, result, entryA } = await provisionalRun()
    const blank: PlannerRunResult = {
      ...result,
      routeCommitment: {
        ...result.routeCommitment!,
        entries: result.routeCommitment!.entries.map((entry) =>
          entry.buildListEntryId === entryA.id ? { ...entry, provisionalOutcome: null, stuckDrop: null } : entry,
        ),
      },
    }
    expect(() => createRejectedBuildListEntries(
      scenario.input,
      blank,
      result.bestState!.selectedBuildListEntryIds,
    )).toThrow(/neither the provisional outcome nor the deadlock \/ stall drop/)
  })

  it('refuses to generate a Plan from such a run and returns no result', async () => {
    const { scenario } = await provisionalRun()
    await expect(createProductionPlanWithSearchRunner(
      async (input, dependencies, options, context) => ({
        ...await runPlannerDeterministicSchedule(input, dependencies, options, context),
        routeCommitment: undefined,
      }),
      scenario.input,
      scenario.dependencies,
      undefined,
    )).rejects.toBeInstanceOf(PlannerPlanGenerationError)
  })
})

describe('the Beam Search oracle result through the same record (Issue #121)', () => {
  it('records an explicit decision loser exactly as the scheduler does, and nothing else as a cause', async () => {
    const probe = gogmaConflictScenario()
    const unresolved = await runPlannerDeterministicSchedule(probe.builder.build().input, probe.builder.build().dependencies)
    const { builder, entryA, entryB } = gogmaConflictScenario()
    builder.conflictResolutions = [{ conflictKey: unresolved.conflicts[0].id, selectedBuildListEntryId: entryA.id }]
    const scenario = builder.build()
    const beam = await runPlannerBeamSearchOracle(scenario.input, scenario.dependencies)
    expect(beam.routeCommitment).toBeUndefined()
    expect(beam.rejections.some(({ reason }) => reason === 'conflict_not_committed')).toBe(false)
    expect(createRejectedBuildListEntries(scenario.input, beam, beam.bestState!.selectedBuildListEntryIds)).toEqual([
      record(entryB, { resourceConflictCause: 'explicit_resolution_not_selected' }),
    ])
  })

  it('records an unresolved conflict of the oracle without any scheduler cause', async () => {
    const { builder } = gogmaConflictScenario()
    const scenario = builder.build()
    const beam = await runPlannerBeamSearchOracle(scenario.input, scenario.dependencies)
    const records = createRejectedBuildListEntries(scenario.input, beam, beam.bestState?.selectedBuildListEntryIds ?? [])
    const targetByEntryId = new Map(scenario.input.buildListEntries.map(({ id, targetWeaponId }) => [id, targetWeaponId]))
    records.forEach((rejected) => {
      expect(rejected.targetWeaponId).toBe(targetByEntryId.get(rejected.buildListEntryId))
      expect(rejected.reason === 'resource_conflict'
        ? rejected.resourceConflictCause === 'explicit_resolution_not_selected'
        : !('resourceConflictCause' in rejected)).toBe(true)
    })
  })
})
