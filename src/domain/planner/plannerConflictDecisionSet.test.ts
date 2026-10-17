import { describe, expect, it } from 'vitest'
import { createValidProductionPlan } from '../../test/fixtures/domainData'
import type {
  BuildListEntryId,
  PlanConflict,
  ProductionPlan,
} from '../models/publicTypes'
import {
  derivePlannerConflictDecisionSet,
  plannerConflictDecisionExclusions,
  plannerConflictEffectiveCheckpointParticipants,
  plannerPersistedConflictDecisions,
  type PlannerConflictDecisionPreparation,
} from './plannerConflictDecisionSet'
import type { PlannerResolvableConflict } from './plannerConflictDetection'
import type { PlannerConflictResolution } from './plannerTypes'

/**
 * `docs/PLANNER_SPEC.md` 9.6.3: the explicit decision set of one 「この候補を
 * 優先」 - carry-over, replacement, the two supersede directions, the
 * checkpoint fixpoint and its re-judgement, the consistency check and the
 * preferred-Entries pre-check - as one pure function over synthetic
 * preparations.
 */

const id = (value: string) => value as BuildListEntryId
const A = id('entry.a')
const B = id('entry.b')
const C = id('entry.c')
const D = id('entry.d')

function conflict(
  conflictId: string,
  participants: readonly BuildListEntryId[],
  checkpoints: readonly BuildListEntryId[] = [],
): PlannerResolvableConflict {
  return {
    id: conflictId,
    buildListEntryIds: [...participants],
    checkpointParticipants: checkpoints.map((buildListEntryId, index) => ({
      buildListEntryId,
      axis: 'bonus' as const,
      opportunityId: `opportunity.${conflictId}.${index}` as never,
    })),
  }
}

function preparation(
  conflicts: readonly PlannerResolvableConflict[],
  valid: readonly BuildListEntryId[] = [A, B, C, D],
): PlannerConflictDecisionPreparation {
  return { validBuildListEntryIds: [...valid], currentConflicts: [...conflicts] }
}

/** A displayed Draft whose Conflicts record `decisions` as their selections. */
function draft(
  conflicts: readonly PlannerResolvableConflict[],
  decisions: readonly PlannerConflictResolution[] = [],
  edit: (plan: ProductionPlan) => void = () => undefined,
): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.conflicts = conflicts.map((current): PlanConflict => ({
    id: current.id,
    kind: 'same_gogma_counter',
    buildListEntryIds: [...current.buildListEntryIds],
    reason: 'fixture',
    recommendedBuildListEntryId: null,
    selectedBuildListEntryId:
      decisions.find(({ conflictKey }) => conflictKey === current.id)?.selectedBuildListEntryId ?? null,
    resolutionNote: null,
    checkpointParticipants: [...(current.checkpointParticipants ?? [])],
  }))
  edit(plan)
  return plan
}

const decide = (conflictKey: string, selectedBuildListEntryId: BuildListEntryId): PlannerConflictResolution =>
  ({ conflictKey, selectedBuildListEntryId })

function run(
  plan: ProductionPlan,
  current: readonly PlannerResolvableConflict[],
  decision: PlannerConflictResolution | null,
  valid?: readonly BuildListEntryId[],
) {
  return derivePlannerConflictDecisionSet({
    displayedPlan: plan,
    currentCalculationContext: plan.calculationContext,
    preparation: preparation(current, valid),
    decision,
  })
}

const X = conflict('conflict.x', [A, B])
const Y = conflict('conflict.y', [A, C])
const Z = conflict('conflict.z', [B, D])

describe('derivePlannerConflictDecisionSet', () => {
  it('reads only the displayed Plan selections as earlier decisions', () => {
    const plan = draft([X, Y], [decide(X.id, A)])
    expect(plannerPersistedConflictDecisions(plan)).toEqual([decide(X.id, A)])
  })

  it('passes a first decision alone and asks for no confirmation', () => {
    const result = run(draft([X, Y]), [X, Y], decide(X.id, A))
    expect(result).toEqual({
      status: 'ready',
      resolutions: [decide(X.id, A)],
      carriedOver: [],
      notCarriedOver: [],
      superseded: [],
      replaced: null,
      excludedBuildListEntryIds: [B],
      requiresConfirmation: false,
    })
  })

  it('carries a compatible earlier decision and returns the set in conflict ID order', () => {
    const result = run(draft([X, Z], [decide(Z.id, D)]), [X, Z], decide(X.id, A))
    expect(result).toMatchObject({
      status: 'ready',
      resolutions: [decide(X.id, A), decide(Z.id, D)],
      carriedOver: [decide(Z.id, D)],
      requiresConfirmation: false,
    })
  })

  it('replaces the earlier decision of the same conflict without asking (re-selection)', () => {
    const result = run(draft([X], [decide(X.id, A)]), [X], decide(X.id, B))
    expect(result).toMatchObject({
      status: 'ready',
      resolutions: [decide(X.id, B)],
      replaced: decide(X.id, A),
      superseded: [],
      requiresConfirmation: false,
    })
  })

  it('supersedes an earlier decision whose preferred Entry the new decision does not select', () => {
    // Y preferred A; preferring B on X excludes A.
    const result = run(draft([X, Y], [decide(Y.id, A)]), [X, Y], decide(X.id, B))
    expect(result).toMatchObject({
      status: 'ready',
      resolutions: [decide(X.id, B)],
      superseded: [{ resolution: decide(Y.id, A), reason: 'selected_entry_not_preferred' }],
      requiresConfirmation: true,
    })
  })

  it('supersedes an earlier decision that did not select the Entry now preferred', () => {
    // Y preferred C, excluding A; preferring A on X lifts that exclusion.
    const result = run(draft([X, Y], [decide(Y.id, C)]), [X, Y], decide(X.id, A))
    expect(result).toMatchObject({
      status: 'ready',
      resolutions: [decide(X.id, A)],
      superseded: [{ resolution: decide(Y.id, C), reason: 'preferred_entry_was_excluded' }],
      requiresConfirmation: true,
    })
  })

  it.each([
    ['its conflict is no current initial Conflict', [X], 'conflict_not_current'],
    ['its Entry is no participant any more', [X, conflict('conflict.z', [C, D])], 'entry_not_participant'],
  ] as const)('does not carry an earlier decision when %s, and says so before running', (_, current, reason) => {
    const result = run(draft([X, Z], [decide(Z.id, B)]), current, decide(X.id, A))
    expect(result).toMatchObject({
      status: 'ready',
      resolutions: [decide(X.id, A)],
      notCarriedOver: [{ resolution: decide(Z.id, B), reason }],
      requiresConfirmation: true,
    })
  })

  it('does not carry an earlier decision whose Entry is no valid Entry', () => {
    const result = run(draft([X, Z], [decide(Z.id, D)]), [X, Z], decide(X.id, A), [A, B, C])
    expect(result).toMatchObject({
      status: 'ready',
      notCarriedOver: [{ resolution: decide(Z.id, D), reason: 'entry_not_valid' }],
    })
  })

  it.each([
    ['a dynamic or stale conflict', decide('conflict.dynamic', A), 'conflict_not_current'],
    ['a non-participant', decide(X.id, C), 'entry_not_participant'],
  ] as const)('refuses a new decision on %s', (_, decision, reason) => {
    const result = run(draft([X]), [X], decision)
    expect(result).toMatchObject({ status: 'refused', refusal: { reason } })
  })

  it('refuses a new decision for an invalid Entry', () => {
    expect(run(draft([X]), [X], decide(X.id, A), [B, C, D])).toMatchObject({
      status: 'refused',
      refusal: { reason: 'entry_not_valid' },
    })
  })

  it.each(['active', 'stale', 'completed', 'abandoned'] as const)('refuses a %s displayed Plan', (status) => {
    const result = run(draft([X], [], (plan) => { plan.status = status }), [X], decide(X.id, A))
    expect(result).toMatchObject({ status: 'refused', refusal: { reason: 'plan_not_editable' } })
  })

  it('refuses a displayed Plan of an incompatible CalculationContext', () => {
    const plan = draft([X])
    const result = derivePlannerConflictDecisionSet({
      displayedPlan: plan,
      currentCalculationContext: { ...plan.calculationContext, appSchemaVersion: 99 },
      preparation: preparation([X]),
      decision: decide(X.id, A),
    })
    expect(result).toMatchObject({ status: 'refused', refusal: { reason: 'plan_not_editable' } })
  })

  describe('checkpoint participants (9.6.2 / 9.5.1)', () => {
    const conflict1 = conflict('conflict.1', [A, B])
    const conflict2 = conflict('conflict.2', [B, C], [B])

    it('refuses a decision on a conflict with an effective checkpoint participant, whichever side it prefers', () => {
      expect(run(draft([conflict2]), [conflict2], decide(conflict2.id, C))).toMatchObject({
        status: 'refused', refusal: { reason: 'checkpoint_conflict' },
      })
      expect(run(draft([conflict2]), [conflict2], decide(conflict2.id, B))).toMatchObject({
        status: 'refused', refusal: { reason: 'checkpoint_conflict' },
      })
    })

    it('accepts a decision once another decision excludes every checkpoint participant', () => {
      // {B (checkpoint), C, D}: B is excluded by A on conflict 1, so C / D decide as usual.
      const three = conflict('conflict.3', [B, C, D], [B])
      const result = run(draft([conflict1, three], [decide(conflict1.id, A)]), [conflict1, three], decide(three.id, C))
      expect(result).toMatchObject({
        status: 'ready',
        resolutions: [decide(conflict1.id, A), decide(three.id, C)],
        excludedBuildListEntryIds: [B, D],
        requiresConfirmation: false,
      })
    })

    it('keeps refusing when an effective checkpoint participant remains ({B, C (checkpoint), D} with B excluded)', () => {
      const three = conflict('conflict.3', [B, C, D], [C])
      expect(run(draft([conflict1, three], [decide(conflict1.id, A)]), [conflict1, three], decide(three.id, D))).toMatchObject({
        status: 'refused', refusal: { reason: 'checkpoint_conflict' },
      })
    })

    it('keeps refusing a decision that selects the checkpoint participant itself', () => {
      const three = conflict('conflict.3', [B, C, D], [B])
      expect(run(draft([conflict1, three], [decide(conflict1.id, A)]), [conflict1, three], decide(three.id, B))).toMatchObject({
        status: 'refused',
      })
    })

    it('supersedes a decision whose checkpoint participant the new decision restores, and confirms it first', () => {
      // Earlier: A on E = {A, P} (excluding the checkpoint participant P), then C
      // on {P (checkpoint), C, D}. Now B on X = {A, B}: A is no longer preferred,
      // so the decision on E is superseded, P runs again, and the decision on
      // conflict 3 has an effective checkpoint participant again.
      const P = id('entry.p')
      const E = conflict('conflict.e', [A, P])
      const three = conflict('conflict.3', [P, C, D], [P])
      const result = run(
        draft([E, three, X], [decide(E.id, A), decide(three.id, C)]),
        [E, three, X],
        decide(X.id, B),
        [A, B, C, D, P],
      )
      expect(result).toMatchObject({
        status: 'ready',
        resolutions: [decide(X.id, B)],
        superseded: [
          { resolution: decide(E.id, A), reason: 'selected_entry_not_preferred' },
          { resolution: decide(three.id, C), reason: 'checkpoint_participant_restored' },
        ],
        requiresConfirmation: true,
      })
    })

    it('carries an earlier checkpoint decision the new decision makes applicable', () => {
      // Conflict 3's checkpoint participant B is excluded by the new decision itself.
      const three = conflict('conflict.3', [B, C, D], [B])
      const result = run(draft([three], [decide(three.id, C)]), [conflict1, three], decide(conflict1.id, A))
      expect(result).toMatchObject({
        status: 'ready',
        resolutions: [decide(conflict1.id, A), decide(three.id, C)],
        carriedOver: [decide(three.id, C)],
        requiresConfirmation: false,
      })
    })

    it('does not carry an earlier decision that keeps an effective checkpoint participant', () => {
      // The input changed: nothing excludes conflict 3's checkpoint participant any more.
      const three = conflict('conflict.3', [B, C, D], [B])
      const W = conflict('conflict.w', [A, D])
      const result = run(draft([three], [decide(three.id, C)]), [three, W], decide(W.id, A))
      expect(result).toMatchObject({
        status: 'ready',
        resolutions: [decide(W.id, A)],
        notCarriedOver: [{ resolution: decide(three.id, C), reason: 'checkpoint_conflict' }],
        requiresConfirmation: true,
      })
    })

    it('reads the effective checkpoint participants of the carried set for the display', () => {
      const three = conflict('conflict.3', [B, C, D], [B])
      const carried = run(draft([conflict1, three], [decide(conflict1.id, A)]), [conflict1, three], null)
      expect(carried.status).toBe('ready')
      if (carried.status !== 'ready') return
      expect(carried.excludedBuildListEntryIds).toEqual([B])
      expect(plannerConflictEffectiveCheckpointParticipants(three, carried.excludedBuildListEntryIds)).toEqual([])
      expect(plannerConflictEffectiveCheckpointParticipants(three, [])).toHaveLength(1)
    })
  })

  it('refuses an inconsistent earlier set instead of picking a decision (rule 5)', () => {
    // A preferred on X, excluded on Y: never produced by a saved Plan, refused.
    const result = run(draft([X, Y], [decide(X.id, A), decide(Y.id, C)]), [X, Y, Z], decide(Z.id, D))
    expect(result).toMatchObject({ status: 'refused', refusal: { reason: 'inconsistent_decision_set', buildListEntryId: A } })
  })

  it('refuses before calculating when two preferred Entries meet in an undecided current conflict (rule 6)', () => {
    const W = conflict('conflict.w', [B, C])
    // Y prefers C (excluding A); preferring B on Z keeps C preferred; W = {B, C} is undecided.
    const result = run(draft([Y, Z, W], [decide(Y.id, C)]), [Y, Z, W], decide(Z.id, B))
    expect(result).toMatchObject({
      status: 'refused',
      refusal: { reason: 'preferred_entries_conflict', conflictId: W.id, buildListEntryIds: [B, C] },
    })
  })

  it('is deterministic whatever the order of the earlier decisions', () => {
    const plan = draft([X, Z], [decide(Z.id, D)])
    const reversed = structuredClone(plan)
    reversed.conflicts.reverse()
    expect(run(plan, [X, Z], decide(X.id, A))).toEqual(run(reversed, [Z, X], decide(X.id, A)))
  })
})

describe('plannerConflictDecisionExclusions', () => {
  it('attributes exactly the excluded Entries of a ready set to the decisions that exclude them, in conflict ID order', () => {
    // X = {A, B} prefers A, W = {D, B} prefers D, Y = {A, C} undecided.
    const W = conflict('conflict.w', [D, B])
    const current = [X, Y, W]
    const result = run(draft(current, [decide(X.id, A), decide(W.id, D)]), current, null)
    if (result.status !== 'ready') throw new Error('expected a ready set')
    const exclusions = plannerConflictDecisionExclusions(current, result.resolutions)
    expect([...exclusions.keys()].sort()).toEqual(result.excludedBuildListEntryIds)
    expect(exclusions.get(B)).toEqual([decide(W.id, D), decide(X.id, A)])
    expect(exclusions.has(A)).toBe(false)
    expect(exclusions.has(C)).toBe(false)
  })

  it('excludes nothing for a decision naming no current initial Conflict, and decides nothing', () => {
    const resolutions = [decide('conflict.gone', A)]
    expect(plannerConflictDecisionExclusions([X], resolutions).size).toBe(0)
    expect(resolutions).toEqual([decide('conflict.gone', A)])
  })
})
