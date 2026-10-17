import { describe, expect, it } from 'vitest'
import { createValidBuildListEntry, createValidProductionPlan } from '../../test/fixtures/domainData'
import type { BuildListEntry, ProductionPlan } from '../models/publicTypes'
import {
  evaluatePlannerConflictResolutionOutcome,
  plannerPlanCompletionRecord,
  plannerPreferredBuildListEntryIds,
} from './plannerConflictPreferenceOutcome'
import type { PlannerRouteCommitmentEvidence, PlannerSearchRejectionReason } from './plannerTypes'

/**
 * `docs/PLANNER_SPEC.md` 9.6.6: a preferred Entry is completed only when the
 * Plan records it in `selectedBuildListEntryIds` and a `targetCompletions`
 * record of its Target; one record without the other is inconsistent; the cause
 * of an incomplete one comes only from the route commitment record.
 */

const entry: BuildListEntry = createValidBuildListEntry()
const other: BuildListEntry = { ...createValidBuildListEntry(), id: 'build-list.fixture.other' as never, targetWeaponId: 'target.fixture.other' as never }

function planCompleting(selected: boolean, completes: boolean): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.selectedBuildListEntryIds = selected ? [entry.id] : []
  plan.steps = plan.steps.map((step, index) => ({
    ...step,
    executionEffects: {
      trackedOwnedWeaponId: 'owned.fixture.a' as never,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: completes && index === plan.steps.length - 1
        ? [{ buildListEntryId: entry.id, targetWeaponId: entry.targetWeaponId, ownedWeaponId: 'owned.fixture.a' as never }]
        : [],
    },
  }))
  return plan
}

function evidence(
  status: PlannerRouteCommitmentEvidence['entries'][number]['status'],
  rejectionReasons: PlannerSearchRejectionReason[] = [],
  provisionalOutcome: { conflictId: string; selectedBuildListEntryId: BuildListEntry['id'] } | null = null,
): PlannerRouteCommitmentEvidence {
  return {
    provisionalOutcomes: [],
    entries: [{ buildListEntryId: entry.id, status, provisionalOutcome, stuckDrop: null, rejectionReasons }],
  }
}

const decision = { conflictKey: 'conflict.fixture', selectedBuildListEntryId: entry.id }

function evaluate(plan: ProductionPlan | null, routeCommitment: PlannerRouteCommitmentEvidence | null, resolutions = [decision]) {
  return evaluatePlannerConflictResolutionOutcome({
    resolutions,
    plan,
    buildListEntries: [entry, other],
    routeCommitment,
  })
}

describe('evaluatePlannerConflictResolutionOutcome', () => {
  it('lists each preferred Entry once, in stable ID order', () => {
    expect(plannerPreferredBuildListEntryIds([
      { conflictKey: 'b', selectedBuildListEntryId: other.id },
      decision,
      { conflictKey: 'c', selectedBuildListEntryId: entry.id },
    ])).toEqual([entry.id, other.id].sort())
  })

  it('completes an Entry the Plan both secures and completes the Target of', () => {
    const plan = planCompleting(true, true)
    expect(plannerPlanCompletionRecord(plan, entry.id, entry.targetWeaponId)).toBe('completed')
    expect(evaluate(plan, evidence('secured'))).toEqual({
      allPreferredEntriesCompleted: true,
      preferredEntries: [{ buildListEntryId: entry.id, targetWeaponId: entry.targetWeaponId, status: 'completed' }],
    })
  })

  it.each([
    ['secured but not completing its Target', true, false],
    ['completing its Target but not secured', false, true],
  ])('fails an Entry %s closed as an inconsistent record', (_, selected, completes) => {
    const plan = planCompleting(selected, completes)
    expect(plannerPlanCompletionRecord(plan, entry.id, entry.targetWeaponId)).toBe('inconsistent')
    expect(evaluate(plan, evidence('secured')).preferredEntries[0]).toMatchObject({
      status: 'incomplete',
      cause: { kind: 'inconsistent_completion_record' },
    })
  })

  it.each([
    ['a provisional outcome won by another preferred Entry', evidence('dropped', ['conflict_not_committed'], { conflictId: 'conflict.y', selectedBuildListEntryId: other.id }),
      { kind: 'preferred_entries_conflict', conflictId: 'conflict.y', otherBuildListEntryId: other.id }],
    ['a deadlock / stall drop', evidence('dropped', ['conflict_not_committed']), { kind: 'deadlock_or_stall' }],
    ['a passed Counter', evidence('dropped', ['counter_before_current']), { kind: 'execution_precondition_failed' }],
    ['a broken source', evidence('dropped', ['inventory_precondition_failed']), { kind: 'execution_precondition_failed' }],
    ['a protected source', evidence('dropped', ['protected_destructive_use']), { kind: 'execution_precondition_failed' }],
    ['an unreached checkpoint', evidence('dropped', ['selected_checkpoint_not_reached']), { kind: 'checkpoint_not_reached' }],
    ['a release by another Entry', evidence('released'), { kind: 'satisfied_by_other_entry' }],
  ] as const)('names %s', (_, routeCommitment, cause) => {
    expect(evaluate(planCompleting(false, false), routeCommitment, [decision, { conflictKey: 'conflict.other', selectedBuildListEntryId: other.id }])
      .preferredEntries.find(({ buildListEntryId }) => buildListEntryId === entry.id)).toMatchObject({ status: 'incomplete', cause })
  })

  it.each([
    ['no route commitment record', null],
    ['a provisional outcome won by an Entry nobody preferred', evidence('dropped', ['conflict_not_committed'], { conflictId: 'conflict.y', selectedBuildListEntryId: 'build-list.fixture.nobody' as never })],
    ['an Entry still committed when the run ended', evidence('committed')],
  ])('never guesses a cause for %s', (_, routeCommitment) => {
    expect(evaluate(planCompleting(false, false), routeCommitment).preferredEntries[0]).toMatchObject({
      status: 'incomplete',
      cause: { kind: 'unknown' },
    })
  })

  it('reports every preferred Entry incomplete when the run produced no Plan', () => {
    expect(evaluate(null, evidence('dropped', ['conflict_not_committed']))).toEqual({
      allPreferredEntriesCompleted: false,
      preferredEntries: [{ buildListEntryId: entry.id, targetWeaponId: entry.targetWeaponId, status: 'incomplete', cause: { kind: 'deadlock_or_stall' } }],
    })
  })

  it('names no Target for a preferred Entry missing from the run input', () => {
    const outcome = evaluatePlannerConflictResolutionOutcome({
      resolutions: [{ conflictKey: 'x', selectedBuildListEntryId: 'build-list.fixture.gone' as never }],
      plan: null,
      buildListEntries: [entry],
      routeCommitment: null,
    })
    expect(outcome.preferredEntries[0]).toMatchObject({ targetWeaponId: null, status: 'incomplete', cause: { kind: 'unknown' } })
  })
})
