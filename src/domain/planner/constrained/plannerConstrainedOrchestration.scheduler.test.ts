import { describe, expect, it, vi } from 'vitest'
import type { BuildListEntry, BuildListEntryId, TargetWeapon } from '../../models/publicTypes'
import {
  belowPracticalBonuses,
  idealBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  CONFLICT_GOGMA_COUNTER,
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationBounds,
  orchestrationEnumerationBounds,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import { runPlannerDeterministicSchedule } from '../plannerDeterministicScheduler'
import { createProductionPlanWithSearchRunner } from '../productionPlanGeneration'
import { createPlannerConstrainedConflictContexts } from './plannerConflictContext'
import { createProductionPlanWithConstrainedSearch } from './plannerConstrainedOrchestration'

/**
 * Issue #103 Phase B: B8 constrained re-search with the deterministic scheduler
 * injected as the full Planner search (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`
 * 12 / 17 Phase B).
 *
 * Production is untouched: only this test module replaces
 * `createProductionPlanWithObserver()` with `createProductionPlanWithSearchRunner()`
 * over the scheduler, so the whole shared tail - the rerun budget observer,
 * the runtime-unsupported retry, Trace Replay, the execution projection, the
 * snapshot and the checkpoint defence - is the one Production implementation.
 * The B8 adoption condition, the replacement metadata and the three
 * orchestration bounds are the existing ones, unchanged.
 */

const searches = vi.hoisted(() => ({ scheduler: 0, beam: 0 }))

vi.mock('../productionPlanGeneration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productionPlanGeneration')>()
  const scheduler = await import('../plannerDeterministicScheduler')
  return {
    ...actual,
    createProductionPlanWithObserver: (
      ...args: Parameters<typeof actual.createProductionPlanWithObserver>
    ) =>
      actual.createProductionPlanWithSearchRunner(
        async (input, dependencies, options, buildListContext) => {
          searches.scheduler += 1
          return scheduler.runPlannerDeterministicSchedule(input, dependencies, options, buildListContext)
        },
        ...args,
      ),
  }
})

vi.mock('../plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: (...args: Parameters<typeof actual.runPlannerBeamSearch>) => {
      searches.beam += 1
      return actual.runPlannerBeamSearch(...args)
    },
  }
})

const TARGET_A = 'target.orchestration.a'
const TARGET_B = 'target.orchestration.b'
const ENTRY_A = 'build-list.orchestration.a'
const ENTRY_B = 'build-list.orchestration.b'
const SOURCE_A_SERIES_SKILL_ID = 'series_skill.fixture.z'
const SOURCE_B_SERIES_SKILL_ID = 'series_skill.fixture.b-source'

/** The B8 fixture: A and B Reset at one contested Gogma Counter (see the Beam test). */
function parts() {
  const a: TargetWeapon = orchestrationTarget(TARGET_A, {
    priority: 5,
    idealSkillCondition: { seriesSkillId: SOURCE_A_SERIES_SKILL_ID, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: SOURCE_A_SERIES_SKILL_ID, groupSkillId: null, matchMode: 'all' },
  })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const entryA: BuildListEntry = orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), {
    finalBonuses: idealBonuses(),
    seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
  })
  const entryB: BuildListEntry = orchestrationEntry(ENTRY_B, b, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
    operations: [
      ...resetRoute(ORCHESTRATION_SOURCE_B).operations,
      ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations,
    ],
  })
  return {
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SERIES_SKILL_ID }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: SOURCE_B_SERIES_SKILL_ID,
      }),
    ],
    entries: [entryA, entryB],
  }
}

function gogmaConflictId(): string {
  const { targets, entries, ownedWeapons } = parts()
  const probe = orchestrationScenario({ targets, entries, ownedWeapons })
  const prepared = preparePlannerInitialContext(probe.input, probe.dependencies)
  if (prepared.status !== 'ready') throw new Error('Expected a ready Planner initial context.')
  const conflict = createPlannerConstrainedConflictContexts(prepared.context).find(
    ({ kind, counterBefore }) => kind === 'same_gogma_counter' && counterBefore === CONFLICT_GOGMA_COUNTER,
  )
  if (!conflict) throw new Error('The fixture produced no Gogma Counter conflict.')
  return conflict.conflictId
}

/** The user fixed Target A's Entry for the contested Gogma position. */
function fixedScenario(): OrchestrationScenario {
  const { targets, entries, ownedWeapons } = parts()
  return orchestrationScenario({
    targets,
    entries,
    ownedWeapons,
    conflictResolutions: [{ conflictKey: gogmaConflictId(), selectedBuildListEntryId: entries[0].id }],
  })
}

function unresolvedScenario(): OrchestrationScenario {
  return orchestrationScenario(parts())
}

function options(overrides: Partial<Parameters<typeof orchestrationBounds>[0]> = {}) {
  return {
    enumerationBounds: orchestrationEnumerationBounds(),
    orchestrationBounds: orchestrationBounds(overrides),
  }
}

async function orchestrate(built: OrchestrationScenario, bounds = options()) {
  searches.scheduler = 0
  searches.beam = 0
  const result = await createProductionPlanWithConstrainedSearch(built.input, built.dependencies, bounds)
  return { result, schedulerRuns: searches.scheduler, beamRuns: searches.beam }
}

const warningKinds = (warnings: readonly { kind: string }[]) => warnings.map(({ kind }) => kind)
const entryId = (value: string) => value as BuildListEntryId

describe('B8 with the scheduler injected: no explicit resolution', () => {
  it('returns the ordinary scheduler Plan and runs no constrained trial', async () => {
    const { result, schedulerRuns, beamRuns } = await orchestrate(unresolvedScenario(), options({ maxPlannerReruns: 1 }))
    const direct = unresolvedScenario()
    const expected = await createProductionPlanWithSearchRunner(
      runPlannerDeterministicSchedule,
      direct.input,
      direct.dependencies,
      undefined,
    )
    expect(schedulerRuns).toBe(1)
    expect(beamRuns).toBe(0)
    expect(result.generatedBuildListEntries).toEqual([])
    expect(result.plan).toEqual(expected.plan)
    expect(result.conflicts).toEqual(expected.conflicts)
    // The provisional outcome is not a resolution: nothing is fixed.
    const conflict = result.conflicts.find(({ kind }) => kind === 'same_gogma_counter')
    expect(conflict?.selectedBuildListEntryId).toBeNull()
    expect(warningKinds(result.warnings)).not.toContain('max_planner_reruns_reached')
  })
})

describe('B8 with the scheduler injected: Candidate trial and adoption', () => {
  it('adopts a generated Entry for the losing Target through a scheduler full rerun', async () => {
    const { result, schedulerRuns, beamRuns } = await orchestrate(fixedScenario())
    expect(beamRuns).toBe(0)
    // The initial run plus at least one Candidate trial.
    expect(schedulerRuns).toBeGreaterThanOrEqual(2)
    expect(result.plan).not.toBeNull()
    expect(result.generatedBuildListEntries).toHaveLength(1)
    const generated = result.generatedBuildListEntries[0]
    expect(generated.targetWeaponId).toBe(TARGET_B)
    // The same Candidate the Beam Search adopts in the ordinary B8 test: the
    // Ideal reached again two Gogma positions later, off the contested one.
    expect(generated.candidateSnapshot.route.operations.map(({ type }) => type))
      .toEqual(['reset_bonuses', 'reset_bonuses', 'reset_bonuses', 'reset_skills'])
    // The existing adoption authority: the trial Entry and the fixed Entry are
    // both selected by the final full run.
    expect(result.plan?.selectedBuildListEntryIds).toEqual([generated.id, entryId(ENTRY_A)].sort())
    expect(result.generatedBuildListEntryReplacements).toEqual([{
      targetWeaponId: TARGET_B,
      replacedBuildListEntryId: entryId(ENTRY_B),
      generatedBuildListEntryId: generated.id,
    }])
    // The Plan is calculated and recorded over the replacement set.
    expect(JSON.stringify(result.plan)).not.toContain(ENTRY_B)
    expect(result.termination).toMatchObject({ status: 'completed', completedTargetCount: 2, totalTargetCount: 2 })
    expect(result.warnings).toEqual([])
    // The replaced Entry's conflict left with it; nothing provisional was fixed.
    expect(result.conflicts.every(({ buildListEntryIds }) => !buildListEntryIds.includes(entryId(ENTRY_B))))
      .toBe(true)
  })

  it('produces identical generated Entries and selection on an identical rerun', async () => {
    const left = await orchestrate(fixedScenario())
    const right = await orchestrate(fixedScenario())
    expect(right.result.generatedBuildListEntries).toEqual(left.result.generatedBuildListEntries)
    expect(right.result.plan?.selectedBuildListEntryIds).toEqual(left.result.plan?.selectedBuildListEntryIds)
    expect(right.schedulerRuns).toBe(left.schedulerRuns)
  })

  it('leaves the caller PlannerInput untouched', async () => {
    const built = fixedScenario()
    const before = structuredClone(built.input)
    await orchestrate(built)
    expect(built.input).toEqual(before)
  })
})

describe('B8 with the scheduler injected: the orchestration bounds keep their meaning', () => {
  /** Full runs the adopting orchestration needs: the initial run plus every trial. */
  async function adoptingRuns() {
    const { result, schedulerRuns } = await orchestrate(fixedScenario())
    expect(result.generatedBuildListEntries).toHaveLength(1)
    return schedulerRuns
  }

  it('counts the initial run and every Candidate trial against maxPlannerReruns', async () => {
    const runs = await adoptingRuns()
    const short = await orchestrate(fixedScenario(), options({ maxPlannerReruns: runs - 1 }))
    expect(short.result.plan).not.toBeNull()
    expect(short.result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(short.result.warnings)).toContain('max_planner_reruns_reached')
    expect(short.schedulerRuns).toBe(runs - 1)

    const exact = await orchestrate(fixedScenario(), options({ maxPlannerReruns: runs }))
    expect(exact.result.generatedBuildListEntries).toHaveLength(1)
    expect(exact.result.warnings).toEqual([])
  })

  it('processes exactly maxCandidateTrialsPerConflict Candidates', async () => {
    // A Candidate the preflight rejects spends a trial without a full run, so
    // the adopting trial count is found, not derived from the run count.
    let trials = 0
    for (let limit = 1; limit <= 8 && trials === 0; limit += 1) {
      const probe = await orchestrate(fixedScenario(), options({ maxCandidateTrialsPerConflict: limit }))
      if (probe.result.generatedBuildListEntries.length === 1) trials = limit
    }
    // The Beam Search adopts on the fourth delivered Candidate as well.
    expect(trials).toBe(4)
    const stopped = await orchestrate(fixedScenario(), options({ maxCandidateTrialsPerConflict: trials - 1 }))
    expect(stopped.result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(stopped.result.warnings)).toContain('max_candidate_trials_per_conflict_reached')

    const exact = await orchestrate(fixedScenario(), options({ maxCandidateTrialsPerConflict: trials }))
    expect(exact.result.generatedBuildListEntries).toHaveLength(1)
    expect(exact.result.warnings).toEqual([])
  })

  it('counts only adopted Entries against maxGeneratedBuildListEntries', async () => {
    const { result } = await orchestrate(fixedScenario(), options({ maxGeneratedBuildListEntries: 1 }))
    expect(result.generatedBuildListEntries).toHaveLength(1)
    expect(warningKinds(result.warnings)).not.toContain('max_generated_build_list_entries_reached')
  })
})
