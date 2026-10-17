import { describe, expect, it } from 'vitest'
import {
  validateProductionPlan,
  type PlanConflict,
  type ProductionPlan,
  type RejectedBuildListEntry,
} from './publicTypes'
import { buildListEntryId, createValidProductionPlan, targetWeaponId } from '../../test/fixtures/domainData'

/**
 * The Issue #121 fields of `ProductionPlan.rejectedBuildListEntries`
 * (`docs/DATA_MODEL.md` 11.9, `docs/PLANNER_SPEC.md` 9.6.9.1), checked by
 * `validateProductionPlan()` - so on save and on Import alike - only where
 * present: a record without them is one an earlier build saved.
 */

const SELECTED = buildListEntryId('build-list.fixture.a')
const LOSER = buildListEntryId('build-list.fixture.loser')
const OTHER = buildListEntryId('build-list.fixture.other')

function decidedConflict(selected = SELECTED, participants = [SELECTED, LOSER]): PlanConflict {
  return {
    id: 'conflict.fixture.decided',
    kind: 'same_gogma_counter',
    buildListEntryIds: participants,
    reason: 'fixture',
    recommendedBuildListEntryId: SELECTED,
    selectedBuildListEntryId: selected,
    resolutionNote: null,
    checkpointParticipants: [],
  }
}

function planWith(
  records: RejectedBuildListEntry[],
  conflicts: PlanConflict[] = [],
): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.conflicts = conflicts
  plan.rejectedBuildListEntries = records
  return plan
}

function rejected(fields: Partial<RejectedBuildListEntry> = {}): RejectedBuildListEntry {
  return {
    buildListEntryId: LOSER,
    targetWeaponId: targetWeaponId('target.fixture.loser'),
    reason: 'resource_conflict',
    resourceConflictCause: 'provisional_outcome_not_committed',
    detail: 'fixture',
    ...fields,
  }
}

function issuesOf(plan: ProductionPlan) {
  return validateProductionPlan(plan).issues.map(({ path, code }) => ({ path, code }))
}

describe('validateProductionPlan: the rejected Build List record (Issue #121)', () => {
  it('accepts a record of an earlier build without either field, whatever its reason, and completes nothing', () => {
    const legacy: RejectedBuildListEntry[] = [
      { buildListEntryId: LOSER, reason: 'resource_conflict', detail: 'legacy' },
      { buildListEntryId: OTHER, reason: 'already_satisfied', detail: 'legacy' },
    ]
    // Even beside a decided Conflict: the explicit cause is required only of a record that names a cause.
    const plan = planWith(legacy, [decidedConflict()])
    expect(issuesOf(plan)).toEqual([])
    expect(plan.rejectedBuildListEntries[0]).not.toHaveProperty('targetWeaponId')
    expect(plan.rejectedBuildListEntries[0]).not.toHaveProperty('resourceConflictCause')
  })

  it('accepts every cause on a resource_conflict record and a Target on every reason', () => {
    expect(issuesOf(planWith([
      rejected({ resourceConflictCause: 'provisional_outcome_not_committed' }),
      rejected({ buildListEntryId: OTHER, resourceConflictCause: 'stuck_drop_without_other_routes' }),
    ]))).toEqual([])
    expect(issuesOf(planWith([rejected({ resourceConflictCause: 'stuck_drop_with_other_routes' })]))).toEqual([])
    expect(issuesOf(planWith(
      [rejected({ resourceConflictCause: 'explicit_resolution_not_selected' })],
      [decidedConflict()],
    ))).toEqual([])
    const { resourceConflictCause: _cause, ...protectedRecord } = rejected({ reason: 'requires_protected_weapon' })
    void _cause
    expect(issuesOf(planWith([protectedRecord]))).toEqual([])
  })

  it('accepts a Target that no longer exists: the record is no current foreign key', () => {
    expect(issuesOf(planWith([rejected({ targetWeaponId: targetWeaponId('target.fixture.deleted') })]))).toEqual([])
  })

  it('refuses a malformed Target ID', () => {
    for (const bad of ['', '   ', null, 42]) {
      expect(issuesOf(planWith([rejected({ targetWeaponId: bad as never })]))).toEqual([
        { path: 'rejectedBuildListEntries[0].targetWeaponId', code: 'invalid_id' },
      ])
    }
  })

  it('refuses an unknown cause literal', () => {
    for (const bad of ['deadlock', 'stall', '', null, 1]) {
      expect(issuesOf(planWith([rejected({ resourceConflictCause: bad as never })]))).toEqual([
        { path: 'rejectedBuildListEntries[0].resourceConflictCause', code: 'invalid_literal' },
      ])
    }
  })

  it('refuses a cause on a record whose reason is not resource_conflict', () => {
    for (const reason of ['already_satisfied', 'requires_protected_weapon', 'longer_route', 'dominated_by_better_candidate', 'lower_priority'] as const) {
      expect(issuesOf(planWith([rejected({ reason })]))).toEqual([
        { path: 'rejectedBuildListEntries[0].resourceConflictCause', code: 'invalid_state' },
      ])
    }
  })

  it('refuses explicit_resolution_not_selected without a decided Conflict another selected participant of the Plan won', () => {
    const explicit = rejected({ resourceConflictCause: 'explicit_resolution_not_selected' })
    const refused = [{ path: 'rejectedBuildListEntries[0].resourceConflictCause', code: 'invalid_state' }]
    // No Conflict at all.
    expect(issuesOf(planWith([explicit]))).toEqual(refused)
    // An undecided Conflict.
    expect(issuesOf(planWith([explicit], [decidedConflict(null as never)]))).toEqual(refused)
    // A decided Conflict the record's Entry does not take part in.
    expect(issuesOf(planWith([explicit], [decidedConflict(SELECTED, [SELECTED, OTHER])]))).toEqual(refused)
    // A Conflict decided for the record's own Entry.
    expect(issuesOf(planWith([explicit], [decidedConflict(LOSER)]))).toEqual(refused)
    // A Conflict decided for an Entry the Plan does not select.
    expect(issuesOf(planWith([explicit], [decidedConflict(OTHER, [OTHER, LOSER])]))).toEqual(refused)
  })

  it('refuses another cause on a resource_conflict record a selected participant of its decided Conflict won', () => {
    for (const cause of ['provisional_outcome_not_committed', 'stuck_drop_without_other_routes', 'stuck_drop_with_other_routes'] as const) {
      expect(issuesOf(planWith([rejected({ resourceConflictCause: cause })], [decidedConflict()]))).toEqual([
        { path: 'rejectedBuildListEntries[0].resourceConflictCause', code: 'invalid_state' },
      ])
    }
  })
})
