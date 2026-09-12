import { describe, expect, it } from 'vitest'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointTarget,
  CHECKPOINT_SOURCE_ID,
  CHECKPOINT_START_GOGMA_COUNTER,
} from '../../test/fixtures/checkpointRoute'
import {
  buildListEntryId,
  createValidProductionPlan,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createBuildListEntry } from '../buildList'
import type {
  BuildCandidate,
  BuildListEntry,
  CompromiseCheckpointOpportunityId,
  PlanStepOperationType,
  TargetWeapon,
} from '../models/publicTypes'
import {
  fixture as plannerFixture,
  plannerEngine,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { createPlannerRouteUnitPlans } from './plannerRouteProgress'
import {
  hasReachedEverySelectedCheckpoint,
  selectedCheckpointAtOperationIndex,
  selectedCheckpointEndpointOperationIndexes,
  selectedCheckpointsForEntry,
} from './plannerCheckpoints'
import type { PlannerSearchState } from './plannerTypes'

/**
 * One Route that passes two selectable compromise states before reaching the
 * Ideal: Reset, Reset, Reset, Reset.
 */
function routeCandidate(): BuildCandidate {
  return checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointPracticalBonuses(),
    checkpointIdealBonuses(),
  ])
}

function entryWith(
  selected: readonly CompromiseCheckpointOpportunityId[],
  candidate: BuildCandidate = routeCandidate(),
  target: TargetWeapon = checkpointTarget(),
): BuildListEntry {
  return createBuildListEntry(candidate, target, {
    selectedCheckpointOpportunityIds: selected,
  })
}

const unitsOf = (entry: BuildListEntry) => {
  const { unitPlans, rejections } = createPlannerRouteUnitPlans([entry], plannerEngine())
  expect(rejections).toEqual([])
  return unitPlans.get(entry.id) ?? []
}

describe('Selected compromise checkpoints as Planner constraints', () => {
  it('never lets a selected checkpoint endpoint be silently fast-forwarded', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const opportunity = group.opportunities[0]
    const selectedUnits = unitsOf(entryWith([opportunity.id], candidate))

    const endpoint = selectedUnits.find(
      ({ position }) => position.operationIndex === opportunity.afterOperationIndex,
    )
    expect(endpoint?.canSkipWhenCounterPassed).toBe(false)
  })

  it('keeps the ordinary safe fast-forward on an unselected intermediate unit', () => {
    const candidate = routeCandidate()
    const units = unitsOf(entryWith([], candidate))

    // Reset followed by Reset is unobserved, so every unit but the last one
    // keeps its existing skippability when nothing is selected.
    expect(units.map(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed))
      .toEqual([true, true, true, false])
  })

  it('keeps a fully overwritten prefix unit skippable even beside a selection', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    // Select the arrival at operation index 2, so index 0 and 1 stay ordinary
    // unobserved prefix units.
    const later = group.opportunities.find(({ afterOperationIndex }) => afterOperationIndex === 2)
    expect(later).toBeDefined()
    const units = unitsOf(entryWith([later!.id], candidate))

    expect(units.map(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed))
      .toEqual([true, true, false, false])
  })

  it('exposes the selected endpoints and their exact states in Route order', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const entry = entryWith([group.opportunities[1].id], candidate)

    expect([...selectedCheckpointEndpointOperationIndexes(entry)]).toEqual([
      group.opportunities[1].afterOperationIndex,
    ])
    const selected = selectedCheckpointsForEntry(entry)
    expect(selected).toHaveLength(1)
    expect(selected[0].groupId).toBe(group.id)
    expect(selected[0].opportunity.restorationBonuses).toEqual(
      checkpointPracticalBonusesReordered(),
    )
    expect(selected[0].opportunity.restorationBonusScope).toBe('gogma_artian')
    expect(selected[0].opportunity.seriesSkillId).toBe('series_skill.fixture.a')
    expect(
      selectedCheckpointAtOperationIndex(entry, group.opportunities[0].afterOperationIndex),
    ).toBeNull()
  })

  it('refuses to finish an Entry whose selected checkpoint was not reached', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const entry = entryWith([group.opportunities[0].id], candidate)

    expect(hasReachedEverySelectedCheckpoint(entry, [])).toBe(false)
    expect(
      hasReachedEverySelectedCheckpoint(entry, [group.opportunities[1].id]),
    ).toBe(false)
    expect(
      hasReachedEverySelectedCheckpoint(entry, [group.opportunities[0].id]),
    ).toBe(true)
  })

  it('never resolves a missed checkpoint by substituting another opportunity', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const entry = entryWith([group.opportunities[0].id], candidate)

    // Reaching a different arrival of the very same group does not satisfy the
    // selection: only the selected opportunity does.
    expect(group.opportunities.length).toBeGreaterThan(1)
    expect(
      hasReachedEverySelectedCheckpoint(
        entry,
        group.opportunities.slice(1).map(({ id }) => id),
      ),
    ).toBe(false)
    // And the selection itself is never rewritten by the Planner.
    expect(entry.selectedCheckpointOpportunityIds).toEqual([group.opportunities[0].id])
  })

  it('leaves an Entry with no selection under the ordinary Ideal Route contract', () => {
    const candidate = routeCandidate()
    const entry = entryWith([], candidate)

    expect(selectedCheckpointsForEntry(entry)).toEqual([])
    expect(selectedCheckpointEndpointOperationIndexes(entry).size).toBe(0)
    expect(hasReachedEverySelectedCheckpoint(entry, [])).toBe(true)
  })

  it('records reached checkpoints per Entry and keeps no Practical-first priority', async () => {
    const goal = target('target.checkpoint.state')
    const source = sourceWeapon('owned.checkpoint.state')
    const entry = routeEntry('entry.checkpoint.state', goal, resetRoute(source.id))
    const { input, dependencies } = plannerFixture([goal], [entry], [source])

    const result = await runPlannerBeamSearch(input, dependencies)
    const state = result.bestState as PlannerSearchState & {
      practicalFirstProgressTargetIds?: unknown
    }

    expect(state.reachedCheckpointOpportunityIdsByEntryId).toEqual({})
    expect(Object.keys(state)).not.toContain('practicalFirstProgressTargetIds')
    expect(state.practicalFirstProgressTargetIds).toBeUndefined()
  })
})

describe('Compromise checkpoints inside a ProductionPlan', () => {
  it('adds no PlanStep operation type of its own', () => {
    const operationTypes: PlanStepOperationType[] = [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'keep_bonuses',
      'reset_skills',
      'reserve_weapon',
      'confirm_result',
    ]

    // A checkpoint is metadata on a real physical Step, never a Step of its
    // own (`docs/PLANNER_SPEC.md` 7.5.4).
    expect(operationTypes).not.toContain('reach_checkpoint' as PlanStepOperationType)
    const plan = createValidProductionPlan()
    expect(operationTypes).toContain(plan.steps[0].operationType)
  })

  it('carries a milestone on the physical Step and keeps the later Steps', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const opportunity = group.opportunities[0]
    const plan = createValidProductionPlan()
    const amendmentStep = {
      ...plan.steps[0],
      operationType: 'reset_bonuses' as const,
      checkpointMilestones: [
        {
          buildListEntryId: buildListEntryId('build-list.checkpoint'),
          targetWeaponId: targetWeaponId('target.fixture.a'),
          checkpointGroupId: group.id,
          checkpointOpportunityId: opportunity.id,
          remainingOperationCount: opportunity.remainingOperationCount,
        },
      ],
    }

    expect(amendmentStep.checkpointMilestones[0].remainingOperationCount)
      .toBeGreaterThan(0)
    // A milestone never reserves a weapon and never changes a status.
    expect(amendmentStep.inventoryChange?.addOwnedWeapon ?? null).toBeNull()
    expect(amendmentStep.operationType).not.toBe('reserve_weapon')
  })

  it('reaches a checkpoint with no reservation, status or protection change', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const entry = entryWith([group.opportunities[0].id], candidate)
    const units = unitsOf(entry)
    const endpoint = units.find(
      ({ position }) =>
        position.operationIndex === group.opportunities[0].afterOperationIndex,
    )

    // The checkpoint endpoint is an ordinary bonus amendment: it secures
    // nothing, so it can neither add an OwnedWeapon nor label one.
    expect(endpoint?.operation.type).toBe('reset_bonuses')
    expect(endpoint?.counterStream).toBe('gogma')
    expect(endpoint?.counterBefore).toBe(CHECKPOINT_START_GOGMA_COUNTER)
    // Only the Route's own final operation forms the Candidate the Planner
    // then reserves.
    expect(units.at(-1)?.position.operationIndex).toBe(
      candidate.route.operations.length - 1,
    )
    expect(candidate.route.sourceOwnedWeaponId).toBe(CHECKPOINT_SOURCE_ID)
  })

  it('keeps the remaining Route after a milestone and reserves only at its end', () => {
    const candidate = routeCandidate()
    const [group] = candidate.checkpointGroups ?? []
    const opportunity = group.opportunities[0]
    const entry = entryWith([opportunity.id], candidate)
    const units = unitsOf(entry)

    // Steps after the milestone really exist: the Route continues to the Ideal.
    const after = units.filter(
      ({ position }) => position.operationIndex > opportunity.afterOperationIndex,
    )
    expect(after.length).toBe(opportunity.remainingOperationCount)
    expect(after.length).toBeGreaterThan(0)

    // Only the Ideal-completing operation makes the Candidate, so the ordinary
    // reserve semantics apply there and nowhere earlier.
    expect(hasReachedEverySelectedCheckpoint(entry, [opportunity.id])).toBe(true)
    expect(hasReachedEverySelectedCheckpoint(entry, [])).toBe(false)
    expect(entry.candidateSnapshot.finalBonuses).toEqual(checkpointIdealBonuses())
  })
})
