import { describe, expect, it } from 'vitest'
import type { BuildListEntry, OwnedWeapon, TargetWeapon } from '../models/publicTypes'
import {
  idealBonuses,
  IDEAL_SERIES_SKILL_ID,
} from '../../test/fixtures/constrainedEnumeration'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetSkillsRoute,
  type OrchestrationScenario,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { derivePlannerCheckpointRequirements } from './plannerCheckpoints'
import {
  entryIsRelevantForState,
  isPlannerSearchStateComplete,
} from './plannerEntryRelevance'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { validatePlannerInput } from './plannerValidation'
import { createProductionPlan } from './productionPlanGeneration'

const TARGET_T = 'target.required.t'
const TARGET_U = 'target.required.u'
const SOURCE_A = 'owned.required.a'
const SOURCE_A2 = 'owned.required.a2'
const SOURCE_B = 'owned.required.b'
const SOURCE_C = 'owned.required.c'
const SOURCE_IDEAL = 'owned.required.ideal'
const ENTRY_A = 'build-list.required.a'
const ENTRY_A2 = 'build-list.required.a2'
const ENTRY_B = 'build-list.required.b'
const ENTRY_C = 'build-list.required.c'
/** Only Target U requires it and only Entry C's Reset Skills produces it. */
const GROUP_SKILL_U = 'group_skill.fixture.required-u'

interface ScenarioOptions {
  /** Entry A (five Resets, checkpoint at the first) selects its checkpoint. */
  selectA?: boolean
  /** Entry B: one Reset Skills on a source that already holds the Ideal slots. */
  withB?: boolean
  /** A second checkpoint-selected Entry of the same Target. */
  withSecondSelected?: boolean
  /** Target T already holds an Ideal weapon before planning starts. */
  alreadyIdeal?: boolean
  /** Target U with Entry C: one Reset Skills, whose weapon also satisfies T. */
  withU?: boolean
}

/**
 * One Target T with two Routes to the same Ideal: Entry A is a five-Reset
 * Bonus Route whose first Reset is a selectable checkpoint, Entry B is a single
 * Reset Skills on a weapon that already carries the Ideal five slots. Without a
 * selection the Planner takes the cheaper B; with A's checkpoint selected, A is
 * T's required Entry (`docs/PLANNER_SPEC.md` 7.5.6).
 */
function scenario(options: ScenarioOptions = {}): OrchestrationScenario & {
  entries: { a: BuildListEntry; b: BuildListEntry | null; c: BuildListEntry | null }
} {
  const t = orchestrationTarget(TARGET_T, { priority: 3 })
  const targets: TargetWeapon[] = [t]
  const sourceA = orchestrationSource(SOURCE_A, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  const ownedWeapons: OwnedWeapon[] = [sourceA]
  const a = checkpointBonusEntry(ENTRY_A, t, SOURCE_A, sourceA, {
    select: options.selectA !== false,
  })
  const entries: BuildListEntry[] = [a]
  let b: BuildListEntry | null = null
  let c: BuildListEntry | null = null
  if (options.withB !== false) {
    ownedWeapons.push(orchestrationSource(SOURCE_B, { restorationBonuses: idealBonuses() }))
    b = orchestrationEntry(ENTRY_B, t, resetSkillsRoute(SOURCE_B), {
      finalBonuses: idealBonuses(),
    })
    entries.push(b)
  }
  if (options.withSecondSelected === true) {
    const sourceA2 = orchestrationSource(SOURCE_A2, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
    ownedWeapons.push(sourceA2)
    entries.push(checkpointBonusEntry(ENTRY_A2, t, SOURCE_A2, sourceA2))
  }
  if (options.alreadyIdeal === true) {
    ownedWeapons.push(orchestrationSource(SOURCE_IDEAL, {
      restorationBonuses: idealBonuses(),
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
    }))
  }
  if (options.withU === true) {
    // U additionally needs a Group Skill, so A's finished weapon never
    // satisfies U, while C's finished weapon (Ideal slots, Ideal Series Skill)
    // satisfies both U and T.
    const u = orchestrationTarget(TARGET_U, {
      priority: 5,
      idealSkillCondition: {
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
        groupSkillId: GROUP_SKILL_U,
        matchMode: 'all',
      },
      practicalSkillCondition: {
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
        groupSkillId: GROUP_SKILL_U,
        matchMode: 'all',
      },
    })
    targets.push(u)
    ownedWeapons.push(orchestrationSource(SOURCE_C, { restorationBonuses: idealBonuses() }))
    c = orchestrationEntry(ENTRY_C, u, resetSkillsRoute(SOURCE_C), {
      finalBonuses: idealBonuses(),
    })
    c.candidateSnapshot.groupSkillId = GROUP_SKILL_U
    c.candidateSnapshot.skillAmendmentTrace = [{
      operationIndex: 0,
      operationType: 'reset_skills',
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
      groupSkillId: GROUP_SKILL_U,
    }]
    entries.push(c)
  }
  const built = orchestrationScenario({
    targets,
    entries,
    ownedWeapons,
    engine: {
      resetResultAt: checkpointBonusResultAt,
      ...(options.withU === true
        ? {
            skillResultAt: (skillCounter: number) =>
              skillCounter === 7
                ? { seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: GROUP_SKILL_U }
                : { seriesSkillId: `series_skill.fixture.s${skillCounter}`, groupSkillId: null },
          }
        : {}),
    },
  })
  return { ...built, entries: { a, b, c } }
}

function selectedOpportunityId(entry: BuildListEntry): string {
  const [id] = entry.selectedCheckpointOpportunityIds ?? []
  if (!id) throw new Error('The fixture Entry selects no checkpoint.')
  return id
}

function readyContext(built: OrchestrationScenario) {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

describe('A checkpoint-selected BuildListEntry is its Target\'s required Entry', () => {
  it('A/C: is not bypassed by a cheaper Entry of the same Target and completes through its checkpoint', async () => {
    const built = scenario({ selectA: true, withB: true })
    const a = built.entries.a

    const result = await createProductionPlan(built.input, built.dependencies)

    // Entry B alone would have finished the Target in one operation, but it is
    // not this Target's Route while A carries a selection.
    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_A])
    expect(result.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reserve_weapon',
    ])
    // The selected checkpoint was really reached, on the real Step that
    // produced it.
    expect(result.plan?.steps.flatMap(({ checkpointMilestones }) => checkpointMilestones ?? []))
      .toEqual([
        expect.objectContaining({
          buildListEntryId: ENTRY_A,
          checkpointOpportunityId: selectedOpportunityId(a),
        }),
      ])
    expect(result.plan?.steps[0].checkpointMilestones).toHaveLength(1)
    // The user is told that B was left out of this run's candidate selection.
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'selected_checkpoint_fixes_target_entry' }),
    )
    expect(result.warnings.find(({ kind }) => kind === 'selected_checkpoint_fixes_target_entry')?.message)
      .toContain(ENTRY_B)
  })

  it('B: stays relevant after another weapon made its Target Ideal, and the state is not complete until it is secured', () => {
    const built = scenario({ selectA: true, withB: true })
    const context = readyContext(built)
    const requirements = context.checkpointRequirements
    const a = built.entries.a
    const b = built.entries.b!
    expect([...requirements.requiredEntryIdByTargetId]).toEqual([[TARGET_T, ENTRY_A]])

    const state = structuredClone(context.initialState)
    // Another Entry or weapon just made Target T Ideal.
    state.targetSatisfaction[TARGET_T as never] = { hasPractical: true, hasIdeal: true }

    expect(entryIsRelevantForState(state, a, requirements)).toBe(true)
    expect(entryIsRelevantForState(state, b, requirements)).toBe(false)
    expect(isPlannerSearchStateComplete(state, [TARGET_T as never], requirements)).toBe(false)

    state.selectedBuildListEntryIds = [ENTRY_A as never]
    expect(entryIsRelevantForState(state, a, requirements)).toBe(false)
    expect(isPlannerSearchStateComplete(state, [TARGET_T as never], requirements)).toBe(true)
  })

  it('B: keeps planning the required Entry after another Target\'s weapon satisfied its Target', async () => {
    // Target U's one-operation Entry C secures a weapon that satisfies Target T
    // as well, so T.hasIdeal becomes true mid-search. Entry A must still run to
    // its checkpoint and its Ideal before the Plan is complete.
    const built = scenario({ selectA: true, withB: false, withU: true })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_A, ENTRY_C])
    // Both Entries were secured, whichever order the Beam Search chose: C's
    // weapon satisfying T never let the Planner drop A.
    expect(
      result.plan?.steps.filter(({ operationType }) => operationType === 'reserve_weapon'),
    ).toHaveLength(2)
    expect(result.plan?.steps.flatMap(({ checkpointMilestones }) => checkpointMilestones ?? []))
      .toEqual([expect.objectContaining({ buildListEntryId: ENTRY_A })])
    expect(result.termination.completedTargetCount).toBe(2)
  })

  it('B: the typed termination counts a Target complete only once its required Entry is secured', async () => {
    const built = scenario({ selectA: true, withB: false, withU: true })
    // Starve the search so it stops before Entry A can finish: Target T may
    // already be Ideal through Entry C's weapon, but it is not complete.
    built.input.options = { ...built.input.options, maxPlanSteps: 2 }

    const result = await runPlannerBeamSearch(built.input, built.dependencies)

    expect(result.completed).toBe(false)
    expect(result.termination.status).not.toBe('completed')
    expect(result.termination.completedTargetCount).toBeLessThan(2)
    expect(result.bestState?.selectedBuildListEntryIds ?? []).not.toContain(ENTRY_A)
  })

  it('D: fails closed when one Target has two checkpoint-selected Entries', async () => {
    const built = scenario({ selectA: true, withB: true, withSecondSelected: true })

    const validation = validatePlannerInput(built.input, built.dependencies)
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: 'buildListEntries',
        code: 'invalid_structure',
        message: expect.stringContaining(ENTRY_A) as string,
      }),
    )
    expect(validation.issues[0]?.message).toContain(ENTRY_A2)
    expect(validation.warnings).toContainEqual(
      expect.objectContaining({ kind: 'multiple_selected_checkpoint_entries' }),
    )
    // Neither Entry is picked, scored, or tried: no Plan at all.
    expect(preparePlannerInitialContext(built.input, built.dependencies).status).toBe('invalid')
    const result = await createProductionPlan(built.input, built.dependencies)
    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'multiple_selected_checkpoint_entries' }),
    )
    expect(derivePlannerCheckpointRequirements(built.input.buildListEntries)).toEqual({
      requirements: { requiredEntryIdByTargetId: new Map() },
      violations: [{ targetWeaponId: TARGET_T, buildListEntryIds: [ENTRY_A, ENTRY_A2] }],
    })
  })

  it('F: keeps the ordinary candidate selection for a Target whose Entries select nothing', async () => {
    const built = scenario({ selectA: false, withB: true })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_B])
    expect(result.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_skills',
      'reserve_weapon',
    ])
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_fixes_target_entry',
    )
  })

  it('G: fails closed when the Target already holds an Ideal weapon', async () => {
    const built = scenario({ selectA: true, withB: true, alreadyIdeal: true })

    const validation = validatePlannerInput(built.input, built.dependencies)
    expect(validation.isValid).toBe(true)
    const initial = createInitialPlannerSearchState(built.input, validation.validBuildListEntries)
    expect(initial.isValid).toBe(false)
    expect(initial.state).toBeNull()
    expect(initial.issues).toEqual([
      expect.objectContaining({
        path: 'buildListEntries',
        code: 'invalid_state',
        message: expect.stringContaining(ENTRY_A) as string,
      }),
    ])
    expect(preparePlannerInitialContext(built.input, built.dependencies).status).toBe('invalid')

    const result = await createProductionPlan(built.input, built.dependencies)
    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'selected_checkpoint_target_already_ideal' }),
    )
    // The selection was never touched to get there.
    expect(built.entries.a.selectedCheckpointOpportunityIds).toHaveLength(1)
  })

  it('G: an already-Ideal Target without a selection keeps its ordinary outcome', async () => {
    const built = scenario({ selectA: false, withB: true, alreadyIdeal: true })

    const result = await createProductionPlan(built.input, built.dependencies)

    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'all_targets_already_satisfied' }),
    )
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_target_already_ideal',
    )
  })
})
