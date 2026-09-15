import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  ImprovementPreference,
  IntermediateStateSelection,
  OwnedGogmaArtianWeapon,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../buildList'
import { extractIntermediateStateGroups } from '../search'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointIdealBonuses,
  checkpointMixedCandidate,
  checkpointPracticalBonuses,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import { ownedWeaponId, targetWeaponId } from '../../test/fixtures/domainData'
import {
  fixture as plannerFixture,
  routeEntry,
  sourceWeapon,
  target as plannerTarget,
} from '../../test/fixtures/plannerBeam'
import {
  constrainedMaster,
  idealBonuses,
  IDEAL_SERIES_SKILL_ID,
  practicalBonuses,
} from '../../test/fixtures/constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { comparePlannerSearchStates } from './plannerScoring'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { createProductionPlan } from './productionPlanGeneration'
import type { PlannerSearchAction, PlannerSearchState } from './plannerTypes'

const PRACTICAL_GROUP_SKILL = 'group_skill.fixture.a'

function resetBonuses(sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'], counter: number): RouteOperation {
  return { type: 'reset_bonuses', sourceOwnedWeaponId, gogmaCounterBefore: counter, gogmaCounterAfter: counter + 1 }
}
function resetSkills(sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'], counter: number): RouteOperation {
  return { type: 'reset_skills', sourceOwnedWeaponId, skillCounterBefore: counter, skillCounterAfter: counter + 1 }
}

const routeActions = (state: PlannerSearchState | null) =>
  (state?.trace ?? []).filter(
    (action): action is PlannerSearchAction & { kind: 'route_operation' } =>
      action.kind === 'route_operation',
  )
const actionTypesOf = (state: PlannerSearchState | null, entryId: string) =>
  routeActions(state)
    .filter(({ primaryBuildListEntryId }) => primaryBuildListEntryId === entryId)
    .map(({ actionType }) => actionType)

/**
 * The mixed two-lane Route on the orchestration Fake Engine: Reset Bonuses at
 * Gogma 10 (Practical) and 11 (Ideal), Reset Skills at Skill 7 (Practical) and
 * 8 (Ideal). The engine answers every replay prediction, so a full
 * ProductionPlan with milestones can be generated.
 */
interface MixedSelection {
  skill?: boolean
  bonus?: boolean
  improvementPreference?: ImprovementPreference
}

function mixedScenario(
  selection: MixedSelection,
  options: { entryId?: string; targetId?: string; sourceId?: string } = {},
) {
  const entryId = options.entryId ?? 'build-list.lanes.a'
  const sourceId = options.sourceId ?? 'owned.lanes.a'
  const target = orchestrationTarget(options.targetId ?? 'target.lanes.a')
  const source = orchestrationSource(sourceId)
  const entry = orchestrationEntry(entryId, target, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [
      resetBonuses(ownedWeaponId(sourceId), 10),
      resetBonuses(ownedWeaponId(sourceId), 11),
      resetSkills(ownedWeaponId(sourceId), 7),
      resetSkills(ownedWeaponId(sourceId), 8),
    ],
  }, { finalBonuses: idealBonuses() })
  const snapshot = entry.candidateSnapshot
  snapshot.bonusAmendmentTrace = [
    { operationIndex: 0, operationType: 'reset_bonuses', restorationBonuses: practicalBonuses(), restorationBonusScope: 'gogma_artian' },
    { operationIndex: 1, operationType: 'reset_bonuses', restorationBonuses: idealBonuses(), restorationBonusScope: 'gogma_artian' },
  ]
  snapshot.skillAmendmentTrace = [
    { operationIndex: 2, operationType: 'reset_skills', seriesSkillId: null, groupSkillId: PRACTICAL_GROUP_SKILL },
    { operationIndex: 3, operationType: 'reset_skills', seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: null },
  ]
  snapshot.intermediateStateGroups = extractIntermediateStateGroups(snapshot, {
    target,
    master: constrainedMaster(),
    ownedWeapons: [source],
  })
  const skill = intermediateOpportunityAt(snapshot, 'skill', 1).opportunity
  const bonus = intermediateOpportunityAt(snapshot, 'bonus', 1).opportunity
  const entrySelection: IntermediateStateSelection = {
    ...defaultIntermediateStateSelection(),
    ...(selection.skill ? { skillOpportunityId: skill.id } : {}),
    ...(selection.bonus ? { bonusOpportunityId: bonus.id } : {}),
    ...(selection.improvementPreference ? { improvementPreference: selection.improvementPreference } : {}),
  }
  entry.intermediateStateSelection = entrySelection
  const built = orchestrationScenario({
    targets: [target],
    entries: [entry],
    ownedWeapons: [source],
    engine: {
      resetResultAt: (gogmaCounter) => (gogmaCounter === 10 ? practicalBonuses() : idealBonuses()),
      skillResultAt: (skillCounter) =>
        skillCounter === 7
          ? { seriesSkillId: null, groupSkillId: PRACTICAL_GROUP_SKILL }
          : { seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: null },
    },
  })
  return { ...built, entry, target, source, skill, bonus }
}

describe('Lane-interleaved compromise checkpoints in a ProductionPlan', () => {
  it('D: holds the Practical Skill while the Bonus lane finishes, then improves the Skill', async () => {
    const built = mixedScenario({ skill: true })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.termination.status).toBe('completed')
    const types = result.plan?.steps.map(({ operationType }) => operationType) ?? []
    expect(types).toHaveLength(5)
    expect(types.at(-1)).toBe('reserve_weapon')
    // The second Reset Skills may only run once the Bonus lane reached its
    // Ideal end: the checkpoint is Practical Skill + Ideal Bonus.
    expect(types[3]).toBe('reset_skills')
    const milestones = result.plan?.steps.flatMap((step, index) =>
      (step.checkpointMilestones ?? []).map((milestone) => ({ index, milestone })),
    ) ?? []
    expect(milestones).toEqual([
      {
        index: 2,
        milestone: {
          buildListEntryId: built.entry.id,
          targetWeaponId: built.target.id,
          skillOpportunityId: built.skill.id,
          bonusOpportunityId: null,
          conditionMatch: { bonus: 'ideal', skill: 'practical' },
          remainingOperationCount: 1,
        },
      },
    ])
    // The checkpoint step really holds the pinned pair.
    expect(result.plan?.steps[2].expectedResult).toMatchObject({
      restorationBonuses: idealBonuses(),
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: null,
      groupSkillId: PRACTICAL_GROUP_SKILL,
    })
  })

  it('E: holds the Practical Bonus while the Skill lane finishes, then improves the Bonus', async () => {
    const built = mixedScenario({ bonus: true })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.termination.status).toBe('completed')
    const types = result.plan?.steps.map(({ operationType }) => operationType) ?? []
    expect(types[3]).toBe('reset_bonuses')
    const milestone = result.plan?.steps[2].checkpointMilestones?.[0]
    expect(milestone).toMatchObject({
      skillOpportunityId: null,
      bonusOpportunityId: built.bonus.id,
      // `practicalBonuses()` replaces the Ideal Sharpness with Utility, which
      // the fixture Target accepts through its Alternative Rule.
      conditionMatch: { bonus: 'alternative', skill: 'ideal' },
      remainingOperationCount: 1,
    })
    expect(result.plan?.steps[2].expectedResult).toMatchObject({
      restorationBonuses: practicalBonuses(),
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
    })
  })

  it.each<ImprovementPreference>(['skill_first', 'bonus_first', 'planner'])(
    'F: reaches Practical + Practical, then continues on both lanes to the Ideal (%s)',
    async (improvementPreference) => {
      const built = mixedScenario({ skill: true, bonus: true, improvementPreference })

      const result = await createProductionPlan(built.input, built.dependencies)

      expect(result.termination.status).toBe('completed')
      const types = result.plan?.steps.map(({ operationType }) => operationType) ?? []
      expect(types).toHaveLength(5)
      // The checkpoint completes with the second physical step, whichever lane
      // came first, and the Plan does not stop there.
      expect(new Set(types.slice(0, 2))).toEqual(new Set(['reset_bonuses', 'reset_skills']))
      expect(result.plan?.steps[1].checkpointMilestones).toEqual([
        expect.objectContaining({
          skillOpportunityId: built.skill.id,
          bonusOpportunityId: built.bonus.id,
          conditionMatch: { bonus: 'alternative', skill: 'practical' },
          remainingOperationCount: 2,
        }),
      ])
      expect(result.plan?.steps[1].expectedResult).toMatchObject({
        restorationBonuses: practicalBonuses(),
        groupSkillId: PRACTICAL_GROUP_SKILL,
      })
      // After the checkpoint, the improvement order follows the preference.
      if (improvementPreference === 'skill_first') {
        expect(types.slice(2, 4)).toEqual(['reset_skills', 'reset_bonuses'])
      } else if (improvementPreference === 'bonus_first') {
        expect(types.slice(2, 4)).toEqual(['reset_bonuses', 'reset_skills'])
      } else {
        expect(new Set(types.slice(2, 4))).toEqual(new Set(['reset_bonuses', 'reset_skills']))
      }
      // The reserved weapon is the Ideal, never the compromise product.
      expect(result.plan?.steps[4].expectedResult).toMatchObject({
        restorationBonuses: idealBonuses(),
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
        shouldSecure: false,
      })
    },
  )

  it('never secures the Candidate before the selected checkpoint was reached', async () => {
    const built = mixedScenario({ skill: true, bonus: true })
    built.input.options = { ...built.input.options, maxPlanSteps: 1 }

    const result = await runPlannerBeamSearch(built.input, built.dependencies)

    expect(result.completed).toBe(false)
    expect(result.bestState?.selectedBuildListEntryIds).toEqual([])
    expect(result.bestState?.reachedCheckpointByEntryId[built.entry.id]).toBeUndefined()
  })
})

/**
 * Beam-level scenarios on the counter-only Planner fixture: no replay
 * prediction is needed to observe the order the Planner chose.
 */
function twoLaneEntry(
  id: string,
  goal: TargetWeapon,
  source: OwnedGogmaArtianWeapon,
  gogmaCounter: number,
  skillCounter: number,
  preference: ImprovementPreference,
): BuildListEntry {
  const entry = routeEntry(id, goal, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: source.id,
    operations: [resetBonuses(source.id, gogmaCounter), resetSkills(source.id, skillCounter)],
  })
  entry.intermediateStateSelection = { ...defaultIntermediateStateSelection(), improvementPreference: preference }
  return entry
}

describe('Improvement preference in the Beam Search', () => {
  it.each<[ImprovementPreference, string[]]>([
    ['skill_first', ['reset_skills', 'reset_bonuses']],
    ['bonus_first', ['reset_bonuses', 'reset_skills']],
  ])('N: follows %s when both lane orders are equally feasible', async (preference, expected) => {
    const goal = plannerTarget('target.preference')
    const source = sourceWeapon('owned.preference')
    const entry = twoLaneEntry('entry.preference', goal, source, 10, 7, preference)
    const { input, dependencies } = plannerFixture([goal], [entry], [source])

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(actionTypesOf(result.bestState, entry.id)).toEqual(expected)
    expect(result.bestState?.improvementPreferenceViolationCount).toBe(0)
  })

  it('N: leaves the order to the Planner and still completes when nothing is preferred', async () => {
    const goal = plannerTarget('target.preference.planner')
    const source = sourceWeapon('owned.preference.planner')
    const entry = twoLaneEntry('entry.preference.planner', goal, source, 10, 7, 'planner')
    const { input, dependencies } = plannerFixture([goal], [entry], [source])

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(new Set(actionTypesOf(result.bestState, entry.id))).toEqual(new Set(['reset_bonuses', 'reset_skills']))
    expect(result.bestState?.improvementPreferenceViolationCount).toBe(0)
  })

  it('M: yields to whole-Plan feasibility - a skill_first Entry runs its Bonus first when another Target needs it', async () => {
    // Target A prefers Skill first, but its Reset Skills sits at Skill Counter
    // 8 while the current Counter is 7. Only Target B's Reset Skills at 7 can
    // move the Counter there, and B holds its current Practical Skills as a
    // selected lane start, so B's Skill lane is gated until its Bonus lane
    // reaches Gogma 11 - which only A's Reset Bonuses at 10 can provide.
    const goalA = plannerTarget('target.soft.a')
    const goalB: TargetWeapon = { ...plannerTarget('target.soft.b'), weaponTypeId: 'weapon.fixture.b' }
    const sourceA = sourceWeapon('owned.soft.a')
    const sourceB: OwnedGogmaArtianWeapon = {
      ...sourceWeapon('owned.soft.b'),
      weaponTypeId: 'weapon.fixture.b',
      seriesSkillId: null,
      groupSkillId: PRACTICAL_GROUP_SKILL,
    }
    const entryA = twoLaneEntry('entry.soft.a', goalA, sourceA, 10, 8, 'skill_first')
    const entryB = routeEntry('entry.soft.b', goalB, {
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: sourceB.id,
      operations: [resetBonuses(sourceB.id, 11), resetSkills(sourceB.id, 7)],
    })
    entryB.candidateSnapshot.intermediateStateGroups = extractIntermediateStateGroups(
      entryB.candidateSnapshot,
      { target: goalB, master: { ...constrainedMaster() }, ownedWeapons: [sourceB] },
    )
    const currentSkills = intermediateOpportunityAt(entryB.candidateSnapshot, 'skill', 0).opportunity
    entryB.intermediateStateSelection = { ...defaultIntermediateStateSelection(), skillOpportunityId: currentSkills.id }
    const { input, dependencies } = plannerFixture([goalA, goalB], [entryA, entryB], [sourceA, sourceB])

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    // A executed its Bonus amendment before its Skill amendment despite
    // skill_first: the preference is soft and never blocks the only feasible
    // global order.
    expect(actionTypesOf(result.bestState, entryA.id)).toEqual(['reset_bonuses', 'reset_skills'])
    expect(result.bestState?.improvementPreferenceViolationCount).toBe(1)
    // B held its selected lane start until its Bonus lane arrived.
    expect(actionTypesOf(result.bestState, entryB.id)).toEqual(['reset_bonuses', 'reset_skills'])
    expect(result.bestState?.reachedCheckpointByEntryId[entryB.id]).toBe(true)
    expect(result.bestState?.selectedBuildListEntryIds.slice().sort()).toEqual([entryA.id, entryB.id].sort())
  })

  it('O: interleaves two Targets across the shared Skill and Gogma Counters, each Entry in its own order', async () => {
    const goalA = plannerTarget('target.interleave.a')
    const goalB: TargetWeapon = { ...plannerTarget('target.interleave.b'), weaponTypeId: 'weapon.fixture.b' }
    const sourceA = sourceWeapon('owned.interleave.a')
    const sourceB: OwnedGogmaArtianWeapon = { ...sourceWeapon('owned.interleave.b'), weaponTypeId: 'weapon.fixture.b' }
    // B's units sit one position after A's on both streams, so every B unit
    // needs the matching A unit to have run first while A stays free.
    const entryA = twoLaneEntry('entry.interleave.a', goalA, sourceA, 10, 7, 'planner')
    const entryB = twoLaneEntry('entry.interleave.b', goalB, sourceB, 11, 8, 'planner')
    const { input, dependencies } = plannerFixture([goalA, goalB], [entryA, entryB], [sourceA, sourceB])

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    const actions = routeActions(result.bestState)
    expect(actions).toHaveLength(4)
    const indexOf = (entryId: string, type: string) =>
      actions.findIndex(({ primaryBuildListEntryId, actionType }) => primaryBuildListEntryId === entryId && actionType === type)
    expect(indexOf(entryA.id, 'reset_bonuses')).toBeLessThan(indexOf(entryB.id, 'reset_bonuses'))
    expect(indexOf(entryA.id, 'reset_skills')).toBeLessThan(indexOf(entryB.id, 'reset_skills'))
    expect(result.bestState?.selectedBuildListEntryIds.slice().sort()).toEqual([entryA.id, entryB.id].sort())
  })

  it('P: executes the selected later arrival itself and never substitutes the earlier one', async () => {
    const { candidate, source } = checkpointMixedCandidate({
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const later = intermediateOpportunityAt(candidate, 'skill', 2)
    expect(later.group.opportunities.map(({ lanePosition }) => lanePosition)).toEqual([1, 2])
    const goal: TargetWeapon = { ...checkpointTarget(), id: targetWeaponId('target.fixture.a') }
    const entry = createBuildListEntry(candidate, goal, {
      intermediateStateSelection: { ...defaultIntermediateStateSelection(), skillOpportunityId: later.opportunity.id },
    })
    const { input, dependencies } = plannerFixture([goal], [entry], [source])

    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    const skillActions = routeActions(result.bestState).filter(({ actionType }) => actionType === 'reset_skills')
    // All three Reset Skills really run: the selected second arrival is held
    // because its own operation executed, not because the first one did.
    expect(skillActions.map(({ routeOperation }) => routeOperation.type === 'reset_skills' && routeOperation.skillCounterBefore))
      .toEqual([7, 8, 9])
    expect(result.bestState?.reachedCheckpointByEntryId[entry.id]).toBe(true)
    expect(entry.intermediateStateSelection?.skillOpportunityId).toBe(later.opportunity.id)
  })

  it('never lets a preferred but infeasible order block the Plan (checkpoint pin over preference)', async () => {
    // bonus_first with a selected Bonus lane start: the Bonus lane may not
    // advance before the Skill lane reaches its Ideal end, so the preference
    // cannot be followed until the checkpoint - and the Plan still completes.
    const built = mixedScenario({ improvementPreference: 'bonus_first' })
    const start = intermediateOpportunityAt(built.entry.candidateSnapshot, 'bonus', 1).opportunity
    built.entry.intermediateStateSelection = {
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: start.id,
      improvementPreference: 'bonus_first',
    }

    const result = await runPlannerBeamSearch(built.input, built.dependencies)

    expect(result.completed).toBe(true)
    const types = actionTypesOf(result.bestState, built.entry.id)
    // Reset Bonuses (pin 1), both Reset Skills (lane end), then the last Reset.
    expect(types.slice(0, 1)).toEqual(['reset_bonuses'])
    expect(types.at(-1)).toBe('reset_bonuses')
    expect(types.filter((type) => type === 'reset_skills')).toHaveLength(2)
    expect(CHECKPOINT_IDEAL_SKILL.seriesSkillId).toBe(IDEAL_SERIES_SKILL_ID)
    expect(checkpointPracticalBonuses()).not.toEqual(idealBonuses())
  })
})

describe('comparePlannerSearchStates improvement preference', () => {
  function stateWith(overrides: Partial<PlannerSearchState>): PlannerSearchState {
    const goal = plannerTarget('target.compare')
    const source = sourceWeapon('owned.compare')
    const entry = twoLaneEntry('entry.compare', goal, source, 10, 7, 'skill_first')
    const { input } = plannerFixture([goal], [entry], [source])
    const initial = createInitialPlannerSearchState(input, [{ entry, missingRngRequirements: [] }])
    if (initial.state === null) throw new Error('Fixture initial state is missing.')
    return { ...initial.state, ...overrides }
  }

  it('keeps the existing evaluationScore above a lower violation count', () => {
    const better = stateWith({ evaluationScore: 10, improvementPreferenceViolationCount: 3 })
    const worse = stateWith({ evaluationScore: 5, improvementPreferenceViolationCount: 0 })
    expect(comparePlannerSearchStates(better, worse)).toBeLessThan(0)
  })

  it('keeps the preferred-source preference above the improvement preference', () => {
    const preferred = stateWith({ preferredSourceProgressCount: 1, improvementPreferenceViolationCount: 2 })
    const other = stateWith({ preferredSourceProgressCount: 0, improvementPreferenceViolationCount: 0 })
    expect(comparePlannerSearchStates(preferred, other)).toBeLessThan(0)
  })

  it('prefers fewer violations once the existing evaluation ties, above the weapon switch count', () => {
    const fewer = stateWith({ improvementPreferenceViolationCount: 0, weaponSwitchCount: 3 })
    const more = stateWith({ improvementPreferenceViolationCount: 1, weaponSwitchCount: 0 })
    expect(comparePlannerSearchStates(fewer, more)).toBeLessThan(0)
    expect(comparePlannerSearchStates(more, fewer)).toBeGreaterThan(0)
  })
})
