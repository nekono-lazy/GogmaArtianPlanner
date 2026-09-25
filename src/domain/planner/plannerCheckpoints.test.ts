import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_MISMATCH_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointIdealBonuses,
  checkpointMixedCandidate,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import {
  createValidProductionPlan,
} from '../../test/fixtures/domainData'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../buildList'
import type {
  BuildCandidate,
  BuildListEntry,
  IntermediateStateSelection,
  PlanStepOperationType,
} from '../models/publicTypes'
import {
  fixture as plannerFixture,
  plannerEngine,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { createPlannerRouteUnitPlans } from './plannerRouteProgress'
import {
  checkpointConditionMatchFor,
  entryIntermediateSelection,
  hasIntermediateStateSelection,
  intermediatePinFor,
  intermediatePinOperationIndex,
  selectedIntermediateStateAtOperationIndex,
} from './plannerCheckpoints'
import {
  hasReachedIntermediatePin,
  isPlannerLaneUnitBlockedByPin,
  isPlannerLaneUnitHolding,
  splitPlannerRouteUnitsByLane,
} from './plannerRouteLanes'
import type { PlannerSearchState } from './plannerTypes'

/**
 * One Route with three Bonus amendments (Practical, Practical again, Ideal)
 * and two Reset Skills (Practical, Ideal): four lane positions the user can
 * select on top of the Ideal lane ends.
 */
function routeCandidate(): { candidate: BuildCandidate } {
  return checkpointMixedCandidate({
    bonusResults: [
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ],
    skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
  })
}

function entryWith(
  selection: Partial<IntermediateStateSelection>,
  candidate: BuildCandidate = routeCandidate().candidate,
): BuildListEntry {
  return createBuildListEntry(candidate, checkpointTarget(), {
    intermediateStateSelection: { ...defaultIntermediateStateSelection(), ...selection },
  })
}

const unitsOf = (entry: BuildListEntry) => {
  const { unitPlans, rejections } = createPlannerRouteUnitPlans([entry], plannerEngine())
  expect(rejections).toEqual([])
  return unitPlans.get(entry.id) ?? []
}

describe('Selected intermediate states as Planner constraints', () => {
  it('never lets a selected lane endpoint be silently fast-forwarded', () => {
    const { candidate } = routeCandidate()
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    const units = unitsOf(entryWith({ bonusOpportunityId: bonus.id }, candidate))

    const endpoint = units.find(({ position }) => position.operationIndex === bonus.operationIndex)
    expect(endpoint?.canSkipWhenCounterPassed).toBe(false)
  })

  it('keeps the ordinary safe fast-forward inside each lane when nothing is selected', () => {
    const units = unitsOf(entryWith({}))

    // Reset followed by Reset on the Bonus lane and Reset Skills followed by
    // Reset Skills on the Skill lane are unobserved; each lane end is required.
    expect(units.map(({ lane, canSkipWhenCounterPassed }) => `${lane}:${canSkipWhenCounterPassed}`))
      .toEqual(['bonus:true', 'bonus:true', 'bonus:false', 'skill:true', 'skill:false'])
  })

  it('keeps a fully overwritten prefix unit skippable beside a later selection', () => {
    const { candidate } = routeCandidate()
    const later = intermediateOpportunityAt(candidate, 'bonus', 2).opportunity
    const units = unitsOf(entryWith({ bonusOpportunityId: later.id }, candidate))

    expect(units.map(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed))
      .toEqual([true, false, false, true, false])
  })

  it('derives the checkpoint pin from the selected positions and the Ideal lane ends', () => {
    const { candidate } = routeCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 2).opportunity

    expect(intermediatePinFor(entryWith({}, candidate))).toBeNull()
    expect(intermediatePinFor(entryWith({ skillOpportunityId: skill.id }, candidate)))
      .toEqual({ skill: 1, bonus: 3 })
    expect(intermediatePinFor(entryWith({ bonusOpportunityId: bonus.id }, candidate)))
      .toEqual({ skill: 2, bonus: 2 })
    expect(intermediatePinFor(entryWith({ skillOpportunityId: skill.id, bonusOpportunityId: bonus.id }, candidate)))
      .toEqual({ skill: 1, bonus: 2 })
  })

  it('exposes the selected endpoints, their conditions, and no substitute', () => {
    const { candidate } = routeCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1)
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 2)
    const entry = entryWith({ skillOpportunityId: skill.opportunity.id, bonusOpportunityId: bonus.opportunity.id }, candidate)

    expect(hasIntermediateStateSelection(entry)).toBe(true)
    const selection = entryIntermediateSelection(entry)
    expect(selection.skill?.group.id).toBe(skill.group.id)
    expect(selection.bonus?.opportunity.restorationBonuses).toEqual(checkpointPracticalBonusesReordered())
    expect(checkpointConditionMatchFor(entry)).toEqual({ bonus: 'practical', skill: 'practical' })
    expect(intermediatePinOperationIndex(entry, 'skill')).toBe(skill.opportunity.operationIndex)
    expect(intermediatePinOperationIndex(entry, 'bonus')).toBe(bonus.opportunity.operationIndex)
    // Another arrival of the same product is not the selected endpoint.
    expect(selectedIntermediateStateAtOperationIndex(entry, 0)).toBeNull()
    expect(selectedIntermediateStateAtOperationIndex(entry, bonus.opportunity.operationIndex ?? -1))
      .toEqual({ axis: 'bonus', opportunityId: bonus.opportunity.id })
    expect(selectedIntermediateStateAtOperationIndex(entry, skill.opportunity.operationIndex ?? -1))
      .toEqual({ axis: 'skill', opportunityId: skill.opportunity.id })
  })

  it('gates each lane at its pin until the other lane arrived', () => {
    const { candidate } = routeCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const entry = entryWith({ skillOpportunityId: skill.id }, candidate)
    const lanes = splitPlannerRouteUnitsByLane(unitsOf(entry), intermediatePinFor(entry))

    // Skill pin 1, Bonus pin 3 (the Ideal end): the second Reset Skills may not
    // run while the Bonus lane is short of its end, and every Bonus unit is
    // free because the Bonus pin is the lane end.
    expect(isPlannerLaneUnitBlockedByPin(lanes.skill[0], { base: 0, bonus: 0, skill: 0 }, lanes.pin)).toBe(false)
    expect(isPlannerLaneUnitBlockedByPin(lanes.skill[1], { base: 0, bonus: 2, skill: 1 }, lanes.pin)).toBe(true)
    expect(isPlannerLaneUnitBlockedByPin(lanes.skill[1], { base: 0, bonus: 3, skill: 1 }, lanes.pin)).toBe(false)
    expect(isPlannerLaneUnitBlockedByPin(lanes.bonus[2], { base: 0, bonus: 2, skill: 0 }, lanes.pin)).toBe(false)
    // The unit producing the selected Skill state is never skippable, so it
    // holds its Counter position whatever the pin state (design 5).
    expect(lanes.skill[0].canSkipWhenCounterPassed).toBe(false)
    expect(isPlannerLaneUnitHolding(lanes.skill[0])).toBe(true)
    expect(hasReachedIntermediatePin(lanes, { base: 0, bonus: 3, skill: 1 })).toBe(true)
    expect(hasReachedIntermediatePin(lanes, { base: 0, bonus: 2, skill: 1 })).toBe(false)
    expect(hasReachedIntermediatePin({ ...lanes, pin: null }, { base: 0, bonus: 3, skill: 1 })).toBe(false)
  })

  it('leaves an Entry with no selection under the ordinary Ideal Route contract', () => {
    const entry = entryWith({})

    expect(hasIntermediateStateSelection(entry)).toBe(false)
    expect(intermediatePinFor(entry)).toBeNull()
    expect(checkpointConditionMatchFor(entry)).toEqual({ bonus: 'ideal', skill: 'ideal' })
  })

  it('records reached checkpoints per Entry and keeps no Practical-first priority', async () => {
    const goal = target('target.checkpoint.state')
    const source = sourceWeapon('owned.checkpoint.state')
    const entry = routeEntry('entry.checkpoint.state', goal, resetRoute(source.id))
    const { input, dependencies } = plannerFixture([goal], [entry], [source])

    const result = await runPlannerBeamSearchOracle(input, dependencies)
    const state = result.bestState as PlannerSearchState & {
      practicalFirstProgressTargetIds?: unknown
    }

    expect(state.reachedCheckpointByEntryId).toEqual({})
    expect(state.improvementPreferenceViolationCount).toBe(0)
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
    const { candidate } = routeCandidate()
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    const plan = createValidProductionPlan()
    const amendmentStep = {
      ...plan.steps[0],
      operationType: 'reset_bonuses' as const,
      checkpointMilestones: [
        {
          buildListEntryId: plan.steps[0].buildListEntryId!,
          targetWeaponId: candidate.targetWeaponId,
          skillOpportunityId: null,
          bonusOpportunityId: bonus.id,
          conditionMatch: { bonus: 'practical' as const, skill: 'ideal' as const },
          remainingOperationCount: 2,
        },
      ],
    }

    expect(amendmentStep.checkpointMilestones[0].remainingOperationCount).toBeGreaterThan(0)
    // A milestone never reserves a weapon and never changes a status.
    expect(amendmentStep.inventoryChange?.addOwnedWeapon ?? null).toBeNull()
    expect(amendmentStep.operationType).not.toBe('reserve_weapon')
  })

  it('reaches a checkpoint with no reservation, status or protection change', () => {
    const { candidate } = routeCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const entry = entryWith({ skillOpportunityId: skill.id }, candidate)
    const units = unitsOf(entry)
    const endpoint = units.find(({ position }) => position.operationIndex === skill.operationIndex)

    // The endpoint is an ordinary Reset Skills: it secures nothing, so it can
    // neither add an OwnedWeapon nor label one.
    expect(endpoint?.operation.type).toBe('reset_skills')
    expect(endpoint?.counterStream).toBe('skill')
    // Only the Route's own final operations form the Candidate the Planner
    // then reserves.
    expect(units.filter(({ lane }) => lane === 'skill').at(-1)?.canSkipWhenCounterPassed).toBe(false)
    expect(candidate.route.operations.some(({ type }) => type === 'reset_skills')).toBe(true)
    expect(CHECKPOINT_MISMATCH_SKILL.seriesSkillId).not.toBe(candidate.seriesSkillId)
  })
})
