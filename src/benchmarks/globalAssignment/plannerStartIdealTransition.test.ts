import { describe, expect, it } from 'vitest'
import type { BuildListEntry, OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import { createPlannerDeterministicScheduleRun, type PlannerDeterministicScheduleRun } from '../../domain/planner/plannerDeterministicScheduler'
import { replayPlannerSearchTrace } from '../../domain/planner/plannerTraceReplay'
import type { PlannerRunResult, PlannerSearchRouteAction } from '../../domain/planner/plannerTypes'
import { createProductionPlanWithObserver } from '../../domain/planner/productionPlanGeneration'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { G0, IDEAL_SKILL, S0, SchedulerScenarioBuilder, schedulerIdeal } from '../../test/fixtures/plannerScheduler'

/*
 * Issue #154 Global Assignment Phase A-2 (`docs/PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md` 3.6 / 9.3, design 19):
 * the Production Planner's state transitions around a planning Target that holds an Ideal owned Gogma at Planner start
 * (G4), observed step by step on the deterministic scheduler with small scheduler fixtures. These tests fix the current
 * Production behaviour; they change nothing in it, and they are the evidence A-2 reads for its G4-iii option rule:
 *
 *   P1  in the final Planner input one Entry references the weapon w (the fixtures below hold that)
 *   P2  w's state and in-flight mark change only through an operation of a Route whose source is w (and its reserve)
 *   P3  an Entry that was not committed is committed only at the start, or dynamically once its Target lost `hasIdeal`
 *
 * G4-i / G4-ii are execution-order facts the Planner decides; nothing here turns them into a static Phase A rule.
 */

type CommitmentStatus = ReturnType<PlannerDeterministicScheduleRun['statusOf']>

interface StepSnapshot {
  /** The route action applied by this step (null for the snapshot before the first step and for a step that applied none). */
  appliedSourceOwnedWeaponId: string | null | undefined
  status: Record<string, CommitmentStatus>
  inFlight: string[]
  hasIdeal: Record<string, boolean>
  weapons: Record<string, string>
}

function readyRun(scenario: OrchestrationScenario): PlannerDeterministicScheduleRun {
  const created = createPlannerDeterministicScheduleRun(scenario.input, scenario.dependencies)
  if (created.status !== 'ready') throw new Error(`The scenario did not reach the scheduler: ${JSON.stringify(created.result.warnings)}`)
  return created.run
}

function weaponText(weapon: OwnedWeapon): string {
  return JSON.stringify([weapon.restorationBonuses, weapon.kind === 'gogma' ? [weapon.seriesSkillId, weapon.groupSkillId] : null])
}

/** Runs the schedule step by step, recording every Entry's commitment status, the in-flight weapons and each Target's `hasIdeal`. */
function traceRun(scenario: OrchestrationScenario): { snapshots: StepSnapshot[]; result: PlannerRunResult } {
  const run = readyRun(scenario)
  const snapshot = (appliedSourceOwnedWeaponId: StepSnapshot['appliedSourceOwnedWeaponId']): StepSnapshot => ({
    appliedSourceOwnedWeaponId,
    status: Object.fromEntries(scenario.input.buildListEntries.map(entry => [entry.id, run.statusOf(entry.id)])),
    inFlight: Object.keys(run.state.inFlightExistingSourceByOwnedWeaponId).sort(),
    hasIdeal: Object.fromEntries(scenario.input.targetWeapons.map(target => [target.id, run.state.targetSatisfaction[target.id]?.hasIdeal === true])),
    weapons: Object.fromEntries(run.state.simulatedInventory.ownedWeapons.map(weapon => [weapon.id, weaponText(weapon)])),
  })
  const snapshots: StepSnapshot[] = [snapshot(null)]
  for (let guard = 0; guard < 10_000; guard += 1) {
    const before = run.state.trace.length
    const outcome = run.step()
    const applied = run.state.trace.slice(before).find((action): action is PlannerSearchRouteAction => action.kind === 'route_operation')
    const operation = applied?.routeOperation
    snapshots.push(snapshot(applied === undefined ? undefined : operation !== null && operation !== undefined && 'sourceOwnedWeaponId' in operation ? operation.sourceOwnedWeaponId : null))
    if (outcome === 'finished' || outcome === 'bounded') return { snapshots, result: run.finish(false) }
  }
  throw new Error('The schedule did not finish.')
}

function expectReplayValid(scenario: OrchestrationScenario, result: PlannerRunResult) {
  expect(result.bestState).not.toBeNull()
  const replay = replayPlannerSearchTrace(scenario.input, result.bestState!, scenario.engine)
  expect(replay.issues).toEqual([])
  expect(replay.isValid).toBe(true)
}

/** Whether a route action of the run progressed `entry` (an executed operation of its Route). */
function progressed(result: PlannerRunResult, entry: BuildListEntry): boolean {
  return (result.bestState?.trace ?? []).some(action => action.kind === 'route_operation' && action.progressedBuildListEntryIds.includes(entry.id))
}

/** P2: a weapon is in flight from the first operation whose source it is until its reserve, and never before. */
function expectInFlightOnlyThroughOwnOperations(snapshots: readonly StepSnapshot[], weaponId: string) {
  let operated = false
  for (const step of snapshots) {
    if (step.appliedSourceOwnedWeaponId === weaponId) operated = true
    if (!operated) expect(step.inFlight, `${weaponId} in flight before any operation on it`).not.toContain(weaponId)
  }
}

describe('A-2 G4 (audit 3.6): the Planner-start Ideal Target and its own Entry, step by step on the Production scheduler', () => {
  it('G4-i: an Ideal weapon no Route operates keeps its Target satisfied, and the Target\'s own Entry is never committed nor run', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 4, schedulerIdeal(31))
    builder.resetAt.set(G0 + 9, schedulerIdeal(30))
    const t1 = builder.target('target.t1', 30)
    const t2 = builder.target('target.t2', 31)
    const ideal = builder.gogma('owned.ideal', { restorationBonuses: schedulerIdeal(30) })
    const own = builder.existingEntry('entry.t1', t1, builder.gogma('owned.v'), { bonus: { from: G0, resets: 10 } })
    const other = builder.existingEntry('entry.t2', t2, builder.gogma('owned.u'), { bonus: { from: G0, resets: 5 } })
    const scenario = builder.build()
    const { snapshots, result } = traceRun(scenario)
    for (const step of snapshots) {
      expect(step.status[own.id]).toBe('not_needed')
      expect(step.hasIdeal[t1.id]).toBe(true)
      expect(step.inFlight).not.toContain(ideal.id)
      expect(step.weapons[ideal.id]).toBe(weaponText(ideal))
    }
    expect(snapshots.at(-1)!.status[other.id]).toBe('secured')
    expect(progressed(result, own)).toBe(false)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([other.id])
    expect(result.termination.status).toBe('completed')
    expectReplayValid(scenario, result)
  })

  it('G4-i: another Target\'s zero-operation Route only references the weapon - it never mutates it nor puts it in flight', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 4, schedulerIdeal(31))
    builder.resetAt.set(G0 + 9, schedulerIdeal(30))
    const t1 = builder.target('target.t1', 30)
    const t2 = builder.target('target.t2', 31)
    // t3 shares t1's Ideal, so the same weapon satisfies both (cross satisfaction): its Entry is the zero-operation Route on it.
    const t3 = builder.target('target.t3', 30)
    const ideal = builder.gogma('owned.ideal', { restorationBonuses: schedulerIdeal(30) })
    const own = builder.existingEntry('entry.t1', t1, builder.gogma('owned.v'), { bonus: { from: G0, resets: 10 } })
    const other = builder.existingEntry('entry.t2', t2, builder.gogma('owned.u'), { bonus: { from: G0, resets: 5 } })
    const zero = builder.existingEntry('entry.t3', t3, ideal, {})
    expect(zero.candidateSnapshot.route).toMatchObject({ kind: 'existing_gogma_current', sourceOwnedWeaponId: ideal.id, operations: [] })
    const scenario = builder.build()
    const { snapshots, result } = traceRun(scenario)
    for (const step of snapshots) {
      expect(step.status[own.id]).toBe('not_needed')
      // The zero-operation Entry is secured from the Planner-start state on (its confirm_owned_ideal), without any operation.
      expect(step.status[zero.id]).toBe('secured')
      expect(step.hasIdeal[t1.id]).toBe(true)
      expect(step.hasIdeal[t3.id]).toBe(true)
      expect(step.inFlight).not.toContain(ideal.id)
      expect(step.weapons[ideal.id]).toBe(weaponText(ideal))
      expect(step.appliedSourceOwnedWeaponId).not.toBe(ideal.id)
    }
    expect(progressed(result, own)).toBe(false)
    expect(progressed(result, zero)).toBe(false)
    expect([...result.bestState!.selectedBuildListEntryIds].sort()).toEqual([other.id, zero.id].sort())
    expect(result.termination.status).toBe('completed')
    expectReplayValid(scenario, result)
  })

  it('G4-ii: another Target operating the Ideal weapon puts it in flight, the Target loses hasIdeal, and its own Entry is committed and run', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(28))
    builder.resetAt.set(G0 + 20, schedulerIdeal(27))
    const holder = builder.gogma('owned.holder', { restorationBonuses: schedulerIdeal(27) })
    const t1 = builder.target('target.t1', 27)
    const t2 = builder.target('target.t2', 28)
    const own = builder.existingEntry('entry.t1', t1, builder.gogma('owned.v'), { bonus: { from: G0, resets: 21 } })
    const mutating = builder.existingEntry('entry.t2', t2, holder, { bonus: { from: G0, resets: 3 } })
    const scenario = builder.build()
    const { snapshots, result } = traceRun(scenario)
    expect(snapshots[0]).toMatchObject({ status: { [own.id]: 'not_needed', [mutating.id]: 'committed' }, hasIdeal: { [t1.id]: true }, inFlight: [] })
    // The first step operates the holder (t2's Reset at G0): it is in flight and t1 is no longer Ideal.
    expect(snapshots[1]).toMatchObject({ appliedSourceOwnedWeaponId: holder.id, inFlight: [holder.id], hasIdeal: { [t1.id]: false } })
    // The next step's commitment refresh commits t1's Entry (executable, no collision): P3's dynamic commit.
    expect(snapshots[2]!.status[own.id]).toBe('committed')
    expectInFlightOnlyThroughOwnOperations(snapshots, holder.id)
    expect(progressed(result, own)).toBe(true)
    expect([...result.bestState!.selectedBuildListEntryIds].sort()).toEqual([own.id, mutating.id].sort())
    expect(result.termination.status).toBe('completed')
    expectReplayValid(scenario, result)
  })

  it('G4-ii: once the Counter passed the Target\'s holding position, its Entry is not committed when the Target loses hasIdeal', async () => {
    const builder = new SchedulerScenarioBuilder()
    // t1's own Route is one Reset at G0 (its holding unit); t2's first Reset on the holder consumes G0.
    builder.resetAt.set(G0, schedulerIdeal(27))
    builder.resetAt.set(G0 + 2, schedulerIdeal(28))
    const holder = builder.gogma('owned.holder', { restorationBonuses: schedulerIdeal(27) })
    const t1 = builder.target('target.t1', 27)
    const t2 = builder.target('target.t2', 28)
    const own = builder.existingEntry('entry.t1', t1, builder.gogma('owned.v'), { bonus: { from: G0, resets: 1 } })
    const mutating = builder.existingEntry('entry.t2', t2, holder, { bonus: { from: G0, resets: 3 } })
    const scenario = builder.build()
    const { snapshots, result } = traceRun(scenario)
    expect(snapshots[1]).toMatchObject({ appliedSourceOwnedWeaponId: holder.id, inFlight: [holder.id], hasIdeal: { [t1.id]: false } })
    for (const step of snapshots) expect(step.status[own.id]).toBe('not_needed')
    expect(progressed(result, own)).toBe(false)
    // t2's reserve rewrites the holder with its own Ideal, which is not t1's: t1 ends unsatisfied, the run is not completed.
    expect(snapshots.at(-1)!.hasIdeal[t1.id]).toBe(false)
    expect(snapshots.at(-1)!.inFlight).toEqual([])
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([mutating.id])
    expect(result.termination).toMatchObject({ status: 'exhausted', completedTargetCount: 1, totalTargetCount: 2 })
    expectReplayValid(scenario, result)
  })

  it('G4-ii: while another Ideal weapon of the Target stays out of flight, the Target keeps hasIdeal and its Entry is never committed', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(28))
    builder.resetAt.set(G0 + 20, schedulerIdeal(27))
    const operated = builder.gogma('owned.ideal.operated', { restorationBonuses: schedulerIdeal(27) })
    const kept = builder.gogma('owned.ideal.kept', { restorationBonuses: schedulerIdeal(27) })
    const t1 = builder.target('target.t1', 27)
    const t2 = builder.target('target.t2', 28)
    const own = builder.existingEntry('entry.t1', t1, builder.gogma('owned.v'), { bonus: { from: G0, resets: 21 } })
    const mutating = builder.existingEntry('entry.t2', t2, operated, { bonus: { from: G0, resets: 3 } })
    const scenario = builder.build()
    const { snapshots, result } = traceRun(scenario)
    expect(snapshots[1]).toMatchObject({ appliedSourceOwnedWeaponId: operated.id, inFlight: [operated.id] })
    for (const step of snapshots) {
      expect(step.hasIdeal[t1.id]).toBe(true)
      expect(step.status[own.id]).toBe('not_needed')
      expect(step.inFlight).not.toContain(kept.id)
      expect(step.weapons[kept.id]).toBe(weaponText(kept))
    }
    expect(progressed(result, own)).toBe(false)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([mutating.id])
    expect(result.termination.status).toBe('completed')
    expectReplayValid(scenario, result)
  })
})

/** G4-iii fixture: t1's own Entry operates t1's both-axis Ideal source and ends Ideal again; t2 runs an unrelated Route meanwhile. */
function g4iiiScenario(continuation: 'bonus' | 'skill' | 'both') {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 2, schedulerIdeal(30))
  builder.resetAt.set(G0 + 4, schedulerIdeal(31))
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  const t1: TargetWeapon = builder.target('target.t1', 30)
  const t2 = builder.target('target.t2', 31)
  // Both axes Ideal for t1 at Planner start (the builder's default Series Skill is t1's Ideal Skill), unprotected.
  const source = builder.gogma('owned.source', { restorationBonuses: schedulerIdeal(30) })
  const own = builder.existingEntry('entry.t1', t1, source, {
    ...(continuation !== 'skill' ? { bonus: { from: G0, resets: 3 } } : {}),
    ...(continuation !== 'bonus' ? { skill: { from: S0, resets: 2 } } : {}),
  })
  const other = builder.existingEntry('entry.t2', t2, builder.gogma('owned.u'), { bonus: { from: G0, resets: 5 } })
  return { scenario: builder.build(), t1, source, own, other }
}

describe('A-2 G4-iii (audit 3.6): a Target\'s own continuation on its both-axis Ideal source is never committed (P1 - P3)', () => {
  for (const continuation of ['bonus', 'skill', 'both'] as const) {
    it(`never commits, runs or mutates (${continuation} continuation), in the scheduler and in the Production Plan`, async () => {
      const { scenario, t1, source, own, other } = g4iiiScenario(continuation)
      expect(source.isProtected).toBe(false)
      // P1: the continuation is the one Entry whose Route references the source.
      expect(scenario.input.buildListEntries.filter(entry => entry.candidateSnapshot.route.sourceOwnedWeaponId === source.id).map(entry => entry.id)).toEqual([own.id])
      expect(own.candidateSnapshot.route.operations.length).toBeGreaterThan(0)
      const { snapshots, result } = traceRun(scenario)
      for (const step of snapshots) {
        // P3: never committed (t1 is Ideal from the start and nothing puts its source in flight).
        expect(step.status[own.id]).toBe('not_needed')
        expect(step.hasIdeal[t1.id]).toBe(true)
        // P2: no operation of another Route touches the source, so it never goes in flight and never changes.
        expect(step.appliedSourceOwnedWeaponId).not.toBe(source.id)
        expect(step.inFlight).not.toContain(source.id)
        expect(step.weapons[source.id]).toBe(weaponText(source))
      }
      expect(progressed(result, own)).toBe(false)
      expect(result.bestState!.selectedBuildListEntryIds).toEqual([other.id])
      expect(result.termination.status).toBe('completed')
      expectReplayValid(scenario, result)

      // The same input through the one Production entry: no Plan step runs the continuation or operates the source.
      const planned = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
      expect(planned.termination.status).toBe('completed')
      expect(planned.plan).not.toBeNull()
      expect(planned.plan!.selectedBuildListEntryIds).toEqual([other.id])
      expect(planned.plan!.steps.some(step => step.buildListEntryId === own.id)).toBe(false)
      expect(planned.plan!.steps.some(step => step.ownedWeaponId === source.id || step.executionEffects?.trackedOwnedWeaponId === source.id)).toBe(false)
    })
  }
})
