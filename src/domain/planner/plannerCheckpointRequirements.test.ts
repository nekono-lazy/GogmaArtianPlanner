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
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { scoreCandidate } from './plannerScoring'
import { validatePlannerInput } from './plannerValidation'
import { createProductionPlanWithObserver } from './productionPlanGeneration'
import type { PlannerBuildListContext } from './plannerTypes'

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
  const id = entry.intermediateStateSelection?.bonusOpportunityId ?? null
  if (id === null) throw new Error('The fixture Entry selects no intermediate state.')
  return id
}

/**
 * Target T's two Routes (Entries A and B) cannot both be persisted: that is a
 * legacy duplicate of the Build List cardinality contract
 * (`docs/DATA_MODEL.md` 9.4.1), and an ordinary persisted input holding them
 * fails closed before any checkpoint rule runs (see "the ordinary persisted
 * input" below). The only input that holds two Entries of one Target is the
 * augmented preflight input of a B8 / what-if trial - persisted Entry A plus
 * the temporary Entry B replacing it (`docs/PLANNER_SPEC.md` 9.2.18) - so the
 * validation and initial-context rules run there. No full Planner run ever
 * holds both: a trial's run gets the replacement set, so every Plan below runs
 * over one Entry per Target.
 */
function trialBuildListContext(built: OrchestrationScenario): PlannerBuildListContext {
  const hasB = built.input.buildListEntries.some(({ id }) => id === ENTRY_B)
  return hasB
    ? {
        kind: 'temporary_augmented',
        replacements: [{
          targetWeaponId: TARGET_T as never,
          replacedBuildListEntryId: ENTRY_A as never,
          generatedBuildListEntryId: ENTRY_B as never,
        }],
      }
    : { kind: 'persisted' }
}

/** The same scenario with Entry B left out: one Entry per Target again. */
function withoutB(built: OrchestrationScenario): OrchestrationScenario {
  return {
    ...built,
    input: {
      ...built.input,
      buildListEntries: built.input.buildListEntries.filter(({ id }) => id !== ENTRY_B),
    },
  }
}

function plan(built: OrchestrationScenario) {
  return createProductionPlanWithObserver(built.input, built.dependencies, undefined)
}

function beamSearch(built: OrchestrationScenario) {
  return runPlannerBeamSearchOracle(built.input, built.dependencies, {})
}

function trialValidation(built: OrchestrationScenario) {
  return validatePlannerInput(built.input, built.dependencies, trialBuildListContext(built))
}

function trialContext(built: OrchestrationScenario) {
  return preparePlannerInitialContext(built.input, built.dependencies, trialBuildListContext(built))
}

function readyContext(built: OrchestrationScenario) {
  const prepared = trialContext(built)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

describe('A checkpoint-selected BuildListEntry is its Target\'s required Entry', () => {
  it('A/C: is not bypassed by a cheaper Entry of the same Target and completes through its checkpoint', async () => {
    const built = scenario({ selectA: true, withB: true })
    const a = built.entries.a

    // Entry B alone would have finished the Target in one operation, but it is
    // not this Target's Route while A carries a selection. The user is told
    // that B was left out of the candidate selection.
    const context = readyContext(built)
    expect([...context.checkpointRequirements.requiredEntryIdByTargetId]).toEqual([[TARGET_T, ENTRY_A]])
    expect(context.initialRelevantEntries.map(({ id }) => id)).toEqual([ENTRY_A])
    const warning = trialContext(built)
    expect(warning.status === 'ready' && warning.context.warnings.find(
      ({ kind }) => kind === 'selected_checkpoint_fixes_target_entry',
    )?.message).toContain(ENTRY_B)

    // A full run never holds B beside A; A completes through its checkpoint.
    const result = await plan(withoutB(built))
    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_A])
    expect(result.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
      'reset_bonuses',
    ])
    expect(result.plan?.steps.at(-1)?.executionEffects?.targetCompletions.map(({ buildListEntryId }) => buildListEntryId))
      .toEqual([ENTRY_A])
    // The selected checkpoint was really reached, on the real Step that
    // produced it.
    expect(result.plan?.steps.flatMap(({ checkpointMilestones }) => checkpointMilestones ?? []))
      .toEqual([
        expect.objectContaining({
          buildListEntryId: ENTRY_A,
          bonusOpportunityId: selectedOpportunityId(a),
          skillOpportunityId: null,
          conditionMatch: { bonus: 'alternative', skill: 'ideal' },
        }),
      ])
    expect(result.plan?.steps[0].checkpointMilestones).toHaveLength(1)
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

    const result = await plan(built)

    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_A, ENTRY_C])
    // Both Entries were secured, whichever order the Beam Search chose: C's
    // weapon satisfying T never let the Planner drop A.
    expect(result.plan?.steps.flatMap(({ executionEffects }) => executionEffects?.targetCompletions ?? [])).toHaveLength(2)
    expect(result.plan?.steps.flatMap(({ checkpointMilestones }) => checkpointMilestones ?? []))
      .toEqual([expect.objectContaining({ buildListEntryId: ENTRY_A })])
    expect(result.termination.completedTargetCount).toBe(2)
  })

  it('B: the typed termination counts a Target complete only once its required Entry is secured', async () => {
    const built = scenario({ selectA: true, withB: false, withU: true })
    // Starve the search so it stops before Entry A can finish: Target T may
    // already be Ideal through Entry C's weapon, but it is not complete.
    built.input.options = { ...built.input.options, maxPlanSteps: 2 }

    const result = await beamSearch(built)

    expect(result.completed).toBe(false)
    expect(result.termination.status).not.toBe('completed')
    expect(result.termination.completedTargetCount).toBeLessThan(2)
    expect(result.bestState?.selectedBuildListEntryIds ?? []).not.toContain(ENTRY_A)
  })

  it('#102: counts the required-Entry Target as a planning Target and never an unlisted one', async () => {
    const built = scenario({ selectA: true, withB: false })
    // An active Target the Build List gives no Route is not a goal of the run.
    built.input.targetWeapons.push(orchestrationTarget('target.required.unlisted', {
      elementId: 'element.fixture.b',
    }))

    const context = readyContext(built)
    expect(context.planningTargetIds).toEqual([TARGET_T])
    expect([...context.checkpointRequirements.requiredEntryIdByTargetId])
      .toEqual([[TARGET_T, ENTRY_A]])

    const result = await plan(built)
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
    expect(result.plan?.steps.flatMap(({ checkpointMilestones }) => checkpointMilestones ?? []))
      .toEqual([expect.objectContaining({ buildListEntryId: ENTRY_A })])

    // Stopped before its required Entry is secured, the planning Target is
    // not complete, whatever the unlisted Target does.
    const starved = scenario({ selectA: true, withB: false })
    starved.input.targetWeapons.push(orchestrationTarget('target.required.unlisted', {
      elementId: 'element.fixture.b',
    }))
    starved.input.options = { ...starved.input.options, maxPlanSteps: 2 }
    const partial = await beamSearch(starved)
    expect(partial.termination).toMatchObject({
      status: 'incomplete',
      reachedLimits: ['max_plan_steps'],
      completedTargetCount: 0,
      totalTargetCount: 1,
    })
    expect(partial.bestState?.selectedBuildListEntryIds ?? []).not.toContain(ENTRY_A)
  })

  it('D: fails closed when one Target has two checkpoint-selected Entries', async () => {
    const built = scenario({ selectA: true, withB: true, withSecondSelected: true })

    const validation = trialValidation(built)
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
    // Neither Entry is picked, scored, or tried: no Plan at all - not in the
    // trial preflight, and not as an ordinary input either.
    expect(trialContext(built).status).toBe('invalid')
    const result = await plan(withoutB(built))
    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'multiple_selected_checkpoint_entries' }),
    )
    expect(derivePlannerCheckpointRequirements(built.input.buildListEntries)).toEqual({
      requirements: { requiredEntryIdByTargetId: new Map() },
      violations: [{ targetWeaponId: TARGET_T, buildListEntryIds: [ENTRY_A, ENTRY_A2] }],
    })
  })

  it('F: runs a selection-free temporary Entry as its Target\'s only Route in the replacement set', async () => {
    const built = scenario({ selectA: false, withB: true })
    // Nothing is selected, so no Entry is the Target's required Entry.
    expect([...readyContext(built).checkpointRequirements.requiredEntryIdByTargetId]).toEqual([])

    // The trial's full run gets the replacement set: B in place of A.
    const result = await createProductionPlanWithObserver(
      {
        ...built.input,
        buildListEntries: built.input.buildListEntries.filter(({ id }) => id !== ENTRY_A),
      },
      built.dependencies,
      undefined,
      undefined,
      {
        kind: 'temporary_replacement',
        replacements: [{
          targetWeaponId: TARGET_T as never,
          replacedBuildListEntryId: ENTRY_A as never,
          generatedBuildListEntryId: ENTRY_B as never,
        }],
      },
    )

    expect(result.termination.status).toBe('completed')
    expect(result.plan?.selectedBuildListEntryIds).toEqual([ENTRY_B])
    expect(result.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_skills',
    ])
    expect(result.plan?.steps[0].executionEffects?.targetCompletions).toHaveLength(1)
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_fixes_target_entry',
    )
  })

  it('G: fails closed when the Target already holds an Ideal weapon', async () => {
    const built = scenario({ selectA: true, withB: true, alreadyIdeal: true })

    const validation = trialValidation(built)
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
    expect(trialContext(built).status).toBe('invalid')

    const result = await plan(withoutB(built))
    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'selected_checkpoint_target_already_ideal' }),
    )
    // The selection was never touched to get there.
    expect(selectedOpportunityId(built.entries.a)).toBeTruthy()
  })

  it('G: an already-Ideal Target without a selection keeps its ordinary outcome', async () => {
    const built = scenario({ selectA: false, withB: true, alreadyIdeal: true })

    const result = await plan(withoutB(built))

    expect(result.plan).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'all_targets_already_satisfied' }),
    )
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_target_already_ideal',
    )
  })

  it('D: keeps the required Entry through PlannerCheckpointRequirements, never through the score', () => {
    const selected = scenario({ selectA: true, withB: true })
    const unselected = scenario({ selectA: false, withB: true })
    const context = readyContext(selected)
    const target = selected.input.targetWeapons[0]
    const state = structuredClone(context.initialState)

    // The score reads no selection at all: a checkpoint is a hard constraint,
    // not a weight, so the selected and the unselected Entry score identically.
    expect(scoreCandidate(state, target, selected.entries.a)).toEqual(
      scoreCandidate(state, target, unselected.entries.a),
    )
    // What keeps Entry A and drops Entry B is the requirement authority.
    expect(entryIsRelevantForState(state, selected.entries.a, context.checkpointRequirements))
      .toBe(true)
    expect(entryIsRelevantForState(state, selected.entries.b!, context.checkpointRequirements))
      .toBe(false)
    const none = readyContext(unselected)
    expect(entryIsRelevantForState(state, unselected.entries.b!, none.checkpointRequirements))
      .toBe(true)
  })
})


describe('A malformed checkpoint selection fails the Planner input closed', () => {
  function malformed(
    mutate: (entry: BuildListEntry) => void,
  ): ReturnType<typeof scenario> {
    const built = scenario({ selectA: true, withB: true })
    mutate(built.entries.a)
    return built
  }

  function expectFailClosed(built: ReturnType<typeof scenario>, detail: string) {
    const validation = trialValidation(built)
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: `buildListEntries.${ENTRY_A}.intermediateStateSelection`,
        code: 'invalid_state',
        message: expect.stringContaining(detail) as string,
      }),
    )
    expect(validation.warnings).toContainEqual(
      expect.objectContaining({ kind: 'invalid_checkpoint_selection' }),
    )
    expect(trialContext(built).status).toBe('invalid')
  }

  it('A: rejects an unknown opportunity id and never starts the Beam Search', async () => {
    const built = malformed((entry) => {
      entry.intermediateStateSelection = {
        ...entry.intermediateStateSelection!,
        bonusOpportunityId: 'intermediate-opportunity:unknown' as never,
      }
    })
    expectFailClosed(built, 'must exist on its own lane in the candidate snapshot')

    const result = await beamSearch(withoutB(built))
    expect(result.bestState).toBeNull()
    expect(result.expandedStates).toBe(0)
    expect(result.validationIssues).not.toEqual([])
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'invalid_checkpoint_selection' }),
    )
  })

  it('B: rejects an opportunity of the other lane', () => {
    const built = malformed((entry) => {
      entry.intermediateStateSelection = {
        ...entry.intermediateStateSelection!,
        skillOpportunityId: entry.intermediateStateSelection!.bonusOpportunityId,
        bonusOpportunityId: null,
      }
    })
    expectFailClosed(built, 'must exist on its own lane in the candidate snapshot')
  })

  it('C: rejects an unknown improvement preference', () => {
    const built = malformed((entry) => {
      entry.intermediateStateSelection = {
        ...entry.intermediateStateSelection!,
        improvementPreference: 'fastest' as never,
      }
    })
    expectFailClosed(built, 'improvement preference')
  })

  it('D: never reads the malformed selection as empty', async () => {
    const built = malformed((entry) => {
      entry.intermediateStateSelection = {
        ...entry.intermediateStateSelection!,
        bonusOpportunityId: 'intermediate-opportunity:unknown' as never,
      }
    })

    // The trial preflight refuses it with Entry B beside it (above), and a run
    // over Entry A alone never reads the selection as selection-free: no Plan.
    expect(trialContext(built).status).toBe('invalid')
    const result = await plan(withoutB(built))

    expect(result.plan).toBeNull()
    expect(result.termination.status).toBe('exhausted')
    expect(result.termination.expandedStates).toBe(0)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ kind: 'invalid_checkpoint_selection' }),
    )
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_fixes_target_entry',
    )
  })

  it('keeps a well-formed selection and a selection-free Entry working as before', () => {
    const selected = scenario({ selectA: true, withB: true })
    const unselected = scenario({ selectA: false, withB: true })
    expect(trialValidation(selected).isValid).toBe(true)
    expect(trialValidation(unselected).isValid).toBe(true)
    expect(
      trialValidation(selected).warnings.map(({ kind }) => kind),
    ).not.toContain('invalid_checkpoint_selection')
  })
})

describe('the ordinary persisted input', () => {
  it('fails closed on the two Entries of Target T before any checkpoint rule picks one', async () => {
    const built = scenario({ selectA: true, withB: true })

    const validation = validatePlannerInput(built.input, built.dependencies)
    expect(validation.isValid).toBe(false)
    expect(validation.warnings.map(({ kind }) => kind)).toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect(validation.warnings.find(({ kind }) => kind === 'duplicate_build_list_entries_for_target')?.message)
      .toContain(`${ENTRY_A}, ${ENTRY_B}`)
    expect(preparePlannerInitialContext(built.input, built.dependencies).status).toBe('invalid')

    const result = await createProductionPlanWithObserver(built.input, built.dependencies, undefined)
    expect(result.plan).toBeNull()
    expect(result.termination).toMatchObject({ status: 'exhausted', expandedStates: 0 })
    // The required Entry is never used to choose A over B either.
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'selected_checkpoint_fixes_target_entry',
    )
  })
})
