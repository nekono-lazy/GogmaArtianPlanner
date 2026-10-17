import { describe, expect, it } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../models/common'
import type {
  PlanConflict,
  PlanStep,
  ProductionPlan,
  RejectedBuildListEntry,
  TargetWeaponId,
} from '../models/publicTypes'
import {
  buildListEntryId,
  createValidProductionPlan,
  planStepId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createBuildListOptimizationAdoptionFixture } from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import {
  hasProductionPlanTargetCompletionAuthority,
  PLAN_COMPLETION_RATIO_CALCULATION_APP_SCHEMA_VERSIONS,
  productionPlanRejectionCauseBreakdownOf,
  summarizeProductionPlanCompletion,
} from './productionPlanCompletionSummary'

/**
 * Issue #121 (`docs/PLANNER_SPEC.md` 9.6.9.1): the completion summary of one
 * exact persisted Plan. These Plans are hand-built records that pin each
 * condition and set operation; the Plans the Planner actually generates for
 * the explicit / provisional / stuck drop causes are summarised in
 * `productionPlanRejectedRecords.test.ts`.
 */

const target = (suffix: string): TargetWeaponId => targetWeaponId(`target.summary.${suffix}`)
const entry = (suffix: string) => buildListEntryId(`build-list.summary.${suffix}`)

/** A current-form Plan (every Step carries `executionEffects`) whose Steps complete the given Targets. */
function planCompleting(stepsCompleting: readonly (readonly string[])[], overrides: Partial<ProductionPlan> = {}): ProductionPlan {
  const base = createValidProductionPlan()
  const template = base.steps[0]
  const steps: PlanStep[] = (stepsCompleting.length === 0 ? [[]] : stepsCompleting).map((completing, index) => ({
    ...structuredClone(template),
    id: planStepId(`step.summary.${index}`),
    order: index + 1,
    progressedTargetWeaponIds: completing.map(target),
    executionEffects: {
      trackedOwnedWeaponId: null,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: completing.map((suffix) => ({
        buildListEntryId: entry(suffix),
        targetWeaponId: target(suffix),
        ownedWeaponId: 'owned.summary' as never,
      })),
    },
  }))
  return {
    ...base,
    calculationContext: { ...base.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
    steps,
    selectedBuildListEntryIds: stepsCompleting.flat().map(entry),
    ...overrides,
  }
}

function rejected(
  suffix: string,
  reason: RejectedBuildListEntry['reason'],
  cause?: RejectedBuildListEntry['resourceConflictCause'],
  targetSuffix: string | null = suffix,
): RejectedBuildListEntry {
  return {
    buildListEntryId: entry(suffix),
    ...(targetSuffix === null ? {} : { targetWeaponId: target(targetSuffix) }),
    reason,
    ...(cause === undefined ? {} : { resourceConflictCause: cause }),
    detail: 'internal detail',
  }
}

function conflict(id: string, participants: readonly string[], selected: string | null): PlanConflict {
  return {
    id,
    kind: 'same_gogma_counter',
    buildListEntryIds: participants.map(entry),
    reason: 'internal reason',
    recommendedBuildListEntryId: entry(participants[0]),
    selectedBuildListEntryId: selected === null ? null : entry(selected),
    resolutionNote: null,
    checkpointParticipants: [],
  }
}

describe('summarizeProductionPlanCompletion (Issue #121)', () => {
  it('reads N / N for a Plan without conflicts or rejections', () => {
    expect(summarizeProductionPlanCompletion(planCompleting([['a'], ['b']]))).toEqual({
      status: 'ratio_determined',
      completedTargetWeaponIds: [target('a'), target('b')],
      completedCount: 2,
      causeBreakdown: { conflictNotCreatedTargetWeaponIds: [], unestablishedNotCreatedTargetWeaponIds: [] },
      conflictNotCreatedCount: 0,
      isProvisional: false,
    })
  })

  it('counts each Target a shared Step completes, and a Target named twice once', () => {
    const summary = summarizeProductionPlanCompletion(planCompleting([['a', 'b'], ['a'], ['c']]))
    expect(summary).toMatchObject({ status: 'ratio_determined', completedCount: 3, conflictNotCreatedCount: 0 })
  })

  it('counts an explicit decision loser and is not provisional when every Conflict is decided', () => {
    const plan = planCompleting([['a']], {
      conflicts: [conflict('conflict.x', ['a', 'b'], 'a')],
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'explicit_resolution_not_selected')],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_determined',
      completedCount: 1,
      conflictNotCreatedCount: 1,
      causeBreakdown: { conflictNotCreatedTargetWeaponIds: [target('b')], unestablishedNotCreatedTargetWeaponIds: [] },
      isProvisional: false,
    })
  })

  it('counts a provisional outcome loser and is provisional while a Conflict has no decision', () => {
    const plan = planCompleting([['a']], {
      conflicts: [conflict('conflict.x', ['a', 'b'], null)],
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'provisional_outcome_not_committed')],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_determined',
      completedCount: 1,
      conflictNotCreatedCount: 1,
      isProvisional: true,
    })
  })

  it('counts a Target losing several Conflicts once, and never one the Plan completes', () => {
    const plan = planCompleting([['a'], ['c']], {
      conflicts: [
        conflict('conflict.x', ['a', 'b'], 'a'),
        conflict('conflict.y', ['b', 'c'], 'c'),
        // C also took part in a Conflict it lost through another (legacy duplicate) Entry.
        conflict('conflict.z', ['c-duplicate', 'd'], null),
      ],
      rejectedBuildListEntries: [
        rejected('b', 'resource_conflict', 'explicit_resolution_not_selected'),
        rejected('b-duplicate', 'resource_conflict', 'provisional_outcome_not_committed', 'b'),
        rejected('c-duplicate', 'resource_conflict', 'provisional_outcome_not_committed', 'c'),
        rejected('d', 'resource_conflict', 'provisional_outcome_not_committed'),
      ],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_determined',
      completedCount: 2,
      // B once (two records), C not (planned completion, R ∩ C), D once.
      causeBreakdown: { conflictNotCreatedTargetWeaponIds: [target('b'), target('d')] },
      conflictNotCreatedCount: 2,
    })
  })

  it.each([
    'requires_protected_weapon',
    'already_satisfied',
    'longer_route',
    'dominated_by_better_candidate',
    'lower_priority',
  ] as const)('never counts a %s rejection as a conflict', (reason) => {
    const plan = planCompleting([['a']], { rejectedBuildListEntries: [rejected('b', reason)] })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ status: 'ratio_determined', conflictNotCreatedCount: 0 })
  })

  it('keeps the ratio and never counts a stuck drop with no other pending Route', () => {
    const plan = planCompleting([['a']], {
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'stuck_drop_without_other_routes')],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_determined',
      conflictNotCreatedCount: 0,
      causeBreakdown: { conflictNotCreatedTargetWeaponIds: [], unestablishedNotCreatedTargetWeaponIds: [] },
    })
  })

  it('leaves the ratio undetermined beside a stuck drop with other pending Routes, keeping the breakdown', () => {
    const plan = planCompleting([['a']], {
      conflicts: [conflict('conflict.x', ['b', 'a'], null)],
      rejectedBuildListEntries: [
        rejected('b', 'resource_conflict', 'provisional_outcome_not_committed'),
        rejected('c', 'resource_conflict', 'stuck_drop_with_other_routes'),
        // A stuck drop of a Target already in R or C belongs to that group.
        rejected('b-again', 'resource_conflict', 'stuck_drop_with_other_routes', 'b'),
        rejected('a-again', 'resource_conflict', 'stuck_drop_with_other_routes', 'a'),
      ],
    })
    expect(summarizeProductionPlanCompletion(plan)).toEqual({
      status: 'ratio_undeterminable',
      reason: 'conflict_cause_not_established',
      completedTargetWeaponIds: [target('a')],
      completedCount: 1,
      causeBreakdown: {
        conflictNotCreatedTargetWeaponIds: [target('b')],
        unestablishedNotCreatedTargetWeaponIds: [target('c')],
      },
      isProvisional: true,
    })
  })

  it('determines M = 0 for a Plan saved before the fields existed when it has no resource_conflict record', () => {
    const plan = planCompleting([['a']], {
      rejectedBuildListEntries: [rejected('b', 'requires_protected_weapon', undefined, null)],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ status: 'ratio_determined', conflictNotCreatedCount: 0 })
  })

  it.each([
    ['no cause', rejected('b', 'resource_conflict', undefined)],
    ['no Target', rejected('b', 'resource_conflict', 'explicit_resolution_not_selected', null)],
    ['neither field', rejected('b', 'resource_conflict', undefined, null)],
  ])('refuses to classify a resource_conflict record with %s (rejection_details_not_recorded)', (_label, record) => {
    const plan = planCompleting([['a']], {
      conflicts: [conflict('conflict.x', ['a', 'b'], 'a')],
      rejectedBuildListEntries: [rejected('c', 'resource_conflict', 'provisional_outcome_not_committed'), record],
    })
    expect(summarizeProductionPlanCompletion(plan)).toEqual({
      status: 'ratio_undeterminable',
      reason: 'rejection_details_not_recorded',
      completedTargetWeaponIds: [target('a')],
      completedCount: 1,
      causeBreakdown: null,
      isProvisional: false,
    })
  })

  it('knows nothing of a legacy Plan whose Steps lack executionEffects, not even N', () => {
    const plan = planCompleting([['a']], { conflicts: [conflict('conflict.x', ['a', 'b'], null)] })
    delete (plan.steps[0] as Partial<PlanStep>).executionEffects
    expect(hasProductionPlanTargetCompletionAuthority(plan)).toBe(false)
    expect(summarizeProductionPlanCompletion(plan)).toEqual({ status: 'completion_unknown', isProvisional: true })
  })

  it.each([1, 12, 13])('does not read the rejections of calculation schema %i (calculation_version_unsupported)', (version) => {
    const plan = planCompleting([['a']], {
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'explicit_resolution_not_selected')],
    })
    plan.calculationContext.appSchemaVersion = version
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_undeterminable',
      reason: 'calculation_version_unsupported',
      completedCount: 1,
      causeBreakdown: null,
    })
  })

  it('reads every schema of the explicit set, never a range, and includes the current version', () => {
    expect([...PLAN_COMPLETION_RATIO_CALCULATION_APP_SCHEMA_VERSIONS]).toEqual([14, 15, 16, 17, 18])
    expect(PLAN_COMPLETION_RATIO_CALCULATION_APP_SCHEMA_VERSIONS.has(CURRENT_CALCULATION_APP_SCHEMA_VERSION)).toBe(true)
    for (const version of [14, 15, 16, 17, 18]) {
      const plan = planCompleting([['a']])
      plan.calculationContext.appSchemaVersion = version
      expect(summarizeProductionPlanCompletion(plan).status).toBe('ratio_determined')
    }
    const future = planCompleting([['a']])
    future.calculationContext.appSchemaVersion = CURRENT_CALCULATION_APP_SCHEMA_VERSION + 1
    expect(summarizeProductionPlanCompletion(future)).toMatchObject({ reason: 'calculation_version_unsupported' })
  })

  it.each([
    ['an unknown reason', { ...rejected('b', 'lower_priority'), reason: 'future_reason' as never }],
    ['an unknown cause', rejected('b', 'resource_conflict', 'future_cause' as never)],
    ['a cause on another reason', rejected('b', 'already_satisfied', 'explicit_resolution_not_selected')],
  ])('refuses a record with %s (unknown_rejection_reason)', (_label, record) => {
    const plan = planCompleting([['a']], { rejectedBuildListEntries: [record] })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_undeterminable',
      reason: 'unknown_rejection_reason',
      causeBreakdown: null,
    })
  })

  it('reports the first failing condition in the order 2, 3, 4, 5', () => {
    const records = [
      rejected('b', 'resource_conflict', 'stuck_drop_with_other_routes'),
      rejected('c', 'resource_conflict', undefined),
      { ...rejected('d', 'lower_priority'), reason: 'future_reason' as never },
    ]
    const plan = planCompleting([['a']], { rejectedBuildListEntries: records })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ reason: 'unknown_rejection_reason' })
    plan.rejectedBuildListEntries = records.slice(0, 2)
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ reason: 'rejection_details_not_recorded' })
    plan.rejectedBuildListEntries = records.slice(0, 1)
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ reason: 'conflict_cause_not_established' })
    plan.calculationContext.appSchemaVersion = 13
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({ reason: 'calculation_version_unsupported' })
  })

  it('reads N + M = 0 for a Plan that completes nothing and loses no conflict', () => {
    const plan = planCompleting([], {
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'stuck_drop_without_other_routes')],
    })
    expect(summarizeProductionPlanCompletion(plan)).toMatchObject({
      status: 'ratio_determined',
      completedCount: 0,
      conflictNotCreatedCount: 0,
    })
  })

  it('takes the Plan alone and gives the same summary for the same Plan every time', () => {
    expect(summarizeProductionPlanCompletion).toHaveLength(1)
    const plan = planCompleting([['a']], {
      conflicts: [conflict('conflict.x', ['a', 'b'], null)],
      rejectedBuildListEntries: [rejected('b', 'resource_conflict', 'provisional_outcome_not_committed')],
    })
    const before = structuredClone(plan)
    const first = summarizeProductionPlanCompletion(plan)
    expect(summarizeProductionPlanCompletion(structuredClone(plan))).toEqual(first)
    // A pure projection: the Plan is never touched.
    expect(plan).toEqual(before)
  })

  it('exposes the breakdown only where the records allow one', () => {
    const determined = summarizeProductionPlanCompletion(planCompleting([['a']]))
    expect(productionPlanRejectionCauseBreakdownOf(determined)).toEqual({
      conflictNotCreatedTargetWeaponIds: [],
      unestablishedNotCreatedTargetWeaponIds: [],
    })
    const legacy = planCompleting([['a']])
    delete (legacy.steps[0] as Partial<PlanStep>).executionEffects
    expect(productionPlanRejectionCauseBreakdownOf(summarizeProductionPlanCompletion(legacy))).toBeNull()
    const old = planCompleting([['a']])
    old.calculationContext.appSchemaVersion = 13
    expect(productionPlanRejectionCauseBreakdownOf(summarizeProductionPlanCompletion(old))).toBeNull()
  })

  it('reads N / N for a Plan adopted from the Build List global optimization', async () => {
    const fixture = await createBuildListOptimizationAdoptionFixture('plain')
    const plan = fixture.artifact.plannerResult.plan as ProductionPlan
    // The adoption conditions: completed, no Conflict, no rejection (17.11).
    expect(plan.conflicts).toEqual([])
    expect(plan.rejectedBuildListEntries).toEqual([])
    const summary = summarizeProductionPlanCompletion({
      ...plan,
      calculationContext: { ...plan.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
    })
    expect(summary).toMatchObject({ status: 'ratio_determined', conflictNotCreatedCount: 0, isProvisional: false })
    expect(summary.status === 'ratio_determined' && summary.completedCount).toBe(
      new Set(fixture.input.buildListEntries.map(({ targetWeaponId }) => targetWeaponId)).size,
    )
  })
})
