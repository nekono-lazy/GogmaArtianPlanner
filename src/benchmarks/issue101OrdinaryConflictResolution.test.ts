import { beforeAll, describe, expect, it } from 'vitest'
import type { BuildListEntryId, PlanConflict, ProductionPlan } from '../domain/models/publicTypes'
import {
  checkPersistableConflictPreferenceResultShape,
  checkPreferredBuildListEntriesCompleted,
  createProductionPlan,
  createProductionPlannerDependencies,
  derivePlannerConflictDecisionSet,
  type PlannerInput,
  type PlannerResult,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { conflictResolutionPlannerOptions } from '../services/planner/plannerRuntimeOptions'
import { createProductionPlannerWorkerCalculations } from '../workers/planner.worker.production'
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'
import {
  createIssue101RealFixture,
  ISSUE_101_DRAGON_TARGET_ID,
  ISSUE_101_FIRE_TARGET_ID,
  type Issue101RealFixture,
} from './issue101PlannerAlternativeFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'

/*
 * The Issue #101 real case (Fire and Dragon Charge Blade, one shared Normal,
 * Skill and Gogma position) under the current ordinary Planner conflict
 * resolution (Issue #278, `docs/PLANNER_SPEC.md` 9.6): the fresh input, the
 * Production Planner Worker's interaction preparation, the explicit decision
 * set of `derivePlannerConflictDecisionSet()`, the ordinary
 * `createProductionPlan()` with `conflictResolutionPlannerOptions()` of the
 * displayed Draft, and the save-time shape and completion checks.
 *
 * Every expected value below was reproduced from the fixture on the current
 * code. Nothing is taken from the removed Planner Alternative actual repair
 * (its alternative Route search, its replaced Entries and its Plans), and
 * nothing assumes the conflict can be avoided: a decision only picks which
 * registered Route this Plan runs, so the other Target is not created here.
 */

const SLOW = 120_000

type ReadyPreparation = Extract<PlannerInteractionPreparationResult, { status: 'ready' }>

function dependencies() {
  return createProductionPlannerDependencies(new ProductionRngEngine())
}

function freshInput(fixture: Issue101RealFixture): PlannerInput {
  return structuredClone(fixture.plannerInput)
}

/** Every BuildListEntry ID a Plan names, wherever it names one. */
function namedEntryIds(plan: ProductionPlan): BuildListEntryId[] {
  return [
    ...plan.selectedBuildListEntryIds,
    ...plan.steps.flatMap(({ buildListEntryId }) => (buildListEntryId === null ? [] : [buildListEntryId])),
    ...plan.rejectedBuildListEntries.map(({ buildListEntryId }) => buildListEntryId),
    ...plan.conflicts.flatMap(({ buildListEntryIds }) => buildListEntryIds),
  ]
}

describe('Issue #101 real case: the ordinary Planner conflict resolution (PLANNER_SPEC 9.6)', () => {
  let fixture: Issue101RealFixture
  let baseline: PlannerResult
  let draft: ProductionPlan
  let preparation: ReadyPreparation

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
    baseline = await createProductionPlan(freshInput(fixture), dependencies())
    if (baseline.plan === null) throw new Error('The Issue #101 baseline produced no Plan.')
    draft = baseline.plan
    const prepared = createProductionPlannerWorkerCalculations().prepareInteraction(freshInput(fixture), dependencies())
    if (prepared.status !== 'ready') throw new Error('The Issue #101 interaction preparation is not ready.')
    preparation = prepared
  }, SLOW)

  it('recognises the Fire / Dragon conflicts in the Draft without any decision', () => {
    // A finished run over both Targets: one completes, nothing truncated it.
    expect(baseline.termination).toMatchObject({
      status: 'exhausted',
      reachedLimits: [],
      completedTargetCount: 1,
      totalTargetCount: 2,
    })
    expect(baseline.conflictResolutionOutcome).toBeUndefined()
    expect(draft.conflictRepairLineage).toBeNull()
    expect(baseline.conflicts).toEqual(draft.conflicts)
    const pair = [fixture.fireEntry.id, fixture.dragonEntry.id].sort()
    expect(draft.conflicts.map(({ kind }) => kind).sort())
      .toEqual(['same_gogma_counter', 'same_normal_counter', 'same_skill_counter'])
    for (const conflict of draft.conflicts) {
      expect([...conflict.buildListEntryIds].sort()).toEqual(pair)
      expect(conflict.selectedBuildListEntryId).toBeNull()
    }
    // The current initial Conflicts the screen decides against are the same ones.
    expect(preparation.validBuildListEntryIds.slice().sort()).toEqual(pair)
    expect(preparation.currentConflicts.map(({ id }) => id).sort())
      .toEqual(fixture.initialConflicts.map(({ id }) => id).sort())
    expect(draft.conflicts.map(({ id }) => id).sort()).toEqual(fixture.initialConflicts.map(({ id }) => id).sort())
  })

  const sides = [
    { side: 'Dragon', preferred: () => fixture.dragonEntry, other: () => fixture.fireEntry, targetWeaponId: ISSUE_101_DRAGON_TARGET_ID },
    { side: 'Fire', preferred: () => fixture.fireEntry, other: () => fixture.dragonEntry, targetWeaponId: ISSUE_101_FIRE_TARGET_ID },
  ] as const
  const kinds = ['same_gogma_counter', 'same_skill_counter', 'same_normal_counter'] as const
  const cases = sides.flatMap((side) => kinds.map((kind) => ({ ...side, kind })))

  it.each(cases)('runs only the preferred $side Route for a decision on the $kind conflict, leaving the other Entry in the Build List', async ({ kind, preferred, other, targetWeaponId }) => {
    const preferredEntry = preferred()
    const otherEntry = other()
    const conflict = draft.conflicts.find((candidate: PlanConflict) => candidate.kind === kind)!
    const decision = { conflictKey: conflict.id, selectedBuildListEntryId: preferredEntry.id }

    const set = derivePlannerConflictDecisionSet({
      displayedPlan: draft,
      currentCalculationContext: fixture.plannerInput.calculationContext,
      preparation,
      decision,
    })
    if (set.status !== 'ready') throw new Error(`The decision set was refused: ${JSON.stringify(set.refusal)}`)
    // A first decision: nothing earlier is carried, replaced or superseded.
    expect(set.resolutions).toEqual([decision])
    expect(set.carriedOver).toEqual([])
    expect(set.superseded).toEqual([])
    expect(set.replaced).toBeNull()
    expect(set.requiresConfirmation).toBe(false)
    expect(set.excludedBuildListEntryIds).toEqual([otherEntry.id])

    const input: PlannerInput = {
      ...freshInput(fixture),
      conflictResolutions: set.resolutions,
      options: conflictResolutionPlannerOptions(draft),
    }
    const before = structuredClone(input)
    const result = await createProductionPlan(input, dependencies())

    // A finished run, never a truncated one: the decision leaves one Target out.
    expect(result.termination.status).not.toBe('incomplete')
    expect(result.termination).toMatchObject({
      status: 'exhausted',
      reachedLimits: [],
      limits: input.options,
      completedTargetCount: 1,
      totalTargetCount: 2,
    })
    expect(result.warnings).toEqual([])
    const plan = result.plan
    if (plan === null) throw new Error('The decision produced no Plan.')

    // The decision is recorded on its own Conflict; the other two Conflicts of
    // the same pair have one remaining participant and are no longer reported.
    expect(result.conflicts).toEqual(plan.conflicts)
    expect(plan.conflicts.map(({ id, selectedBuildListEntryId }) => ({ id, selectedBuildListEntryId })))
      .toEqual([{ id: conflict.id, selectedBuildListEntryId: preferredEntry.id }])

    // Only the preferred registered Route runs, and it creates its own Target.
    expect(plan.selectedBuildListEntryIds).toEqual([preferredEntry.id])
    expect(plan.rejectedBuildListEntries.map(({ buildListEntryId, reason }) => ({ buildListEntryId, reason })))
      .toEqual([{ buildListEntryId: otherEntry.id, reason: 'resource_conflict' }])
    expect(new Set(plan.steps.map(({ buildListEntryId }) => buildListEntryId))).toEqual(new Set([preferredEntry.id]))
    const { normalForgeCount } = summarizeIssue101Route(preferredEntry.candidateSnapshot.route, preferredEntry.candidateSnapshot)
    if (normalForgeCount === null) throw new Error('The Issue #101 Route forges no predicted Normal.')
    expect(plan.steps.filter(({ operationType }) => operationType === 'create_normal_artian')).toHaveLength(normalForgeCount)
    expect(plan.steps.flatMap(({ executionEffects }) => executionEffects?.targetCompletions ?? [])
      .map(({ buildListEntryId, targetWeaponId: completed }) => ({ buildListEntryId, targetWeaponId: completed })))
      .toEqual([{ buildListEntryId: preferredEntry.id, targetWeaponId }])

    // No alternative Route, generated Entry or replacement: the Plan names only
    // the two registered Entries, the input Build List is untouched, and the
    // Plan is calculated over the same Build List as the Draft.
    expect(result).not.toHaveProperty('generatedBuildListEntries')
    const registered = new Set(fixture.plannerInput.buildListEntries.map(({ id }) => id))
    expect(namedEntryIds(plan).filter((id) => !registered.has(id))).toEqual([])
    expect(input).toEqual(before)
    expect(input.buildListEntries).toEqual(fixture.plannerInput.buildListEntries)
    expect(plan.baseSnapshot.buildListEntriesHash).toBe(draft.baseSnapshot.buildListEntriesHash)
    expect(plan.conflictRepairLineage).toBeNull()

    // The preferred Entry's completion, through the typed outcome and the save-time checks.
    expect(result.conflictResolutionOutcome).toEqual({
      preferredEntries: [{ buildListEntryId: preferredEntry.id, targetWeaponId, status: 'completed' }],
      allPreferredEntriesCompleted: true,
    })
    expect(checkPersistableConflictPreferenceResultShape(plan, result, set.resolutions)).toBeNull()
    expect(checkPreferredBuildListEntriesCompleted(plan, set.resolutions, fixture.plannerInput.buildListEntries)).toBeNull()
  })
})
