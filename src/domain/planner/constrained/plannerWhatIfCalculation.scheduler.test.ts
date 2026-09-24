import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeapon,
  RestorationBonusSet,
  TargetWeapon,
} from '../../models/publicTypes'
import {
  belowPracticalBonuses,
  idealBonuses,
  IDEAL_SERIES_SKILL_ID,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import { restorationBonus, restorationBonusSet } from '../../../test/fixtures/targetEvaluation'
import {
  checkpointMixedEntry,
  orchestrationEntry,
  orchestrationEnumerationBounds,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import type { PlannerConflictResolution } from '../plannerTypes'
import { createPlannerConstrainedConflictContexts } from './plannerConflictContext'
import type { PlannerWhatIfBounds } from './plannerWhatIfBounds'
import { createPlannerWhatIfComparison } from './plannerWhatIfCalculation'
import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfOutcome,
  PlannerWhatIfTargetComparison,
} from './plannerWhatIfTypes'

/**
 * B9 what-if on the Production path, whose full Planner run is the
 * deterministic scheduler (Issue #103 Phase C,
 * `docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 12.4 / 17).
 *
 * Phase B ran this module with the scheduler injected through a test-only
 * mock of `createProductionPlanWithObserver()`. Since Phase C nothing is
 * injected: the ordinary `createProductionPlanWithObserver()` reaches the
 * scheduler, and the mocks below only count the full runs (and prove the Beam
 * Search oracle never runs). Feasibility is the unchanged authority
 * (`plan.selectedBuildListEntryIds` holds the trial Entry and every fixed
 * Entry), and the bounds keep their meaning. The fixtures and the expected
 * outcomes are those of the Beam Search what-if test
 * (`plannerWhatIfCalculation.test.ts`), so equal expectations mean equal
 * answers.
 */

const observed = vi.hoisted(() => ({
  schedulerRuns: 0,
  beamRuns: 0,
  /** The Build List context and Entry IDs of each full run, in call order. */
  runs: [] as Array<{ context: string; entryIds: string[] }>,
}))

vi.mock('../plannerDeterministicScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerDeterministicScheduler')>()
  return {
    ...actual,
    runPlannerDeterministicSchedule: (
      ...args: Parameters<typeof actual.runPlannerDeterministicSchedule>
    ) => {
      observed.schedulerRuns += 1
      observed.runs.push({
        context: args[3]?.kind ?? 'persisted',
        entryIds: args[0].buildListEntries.map(({ id }) => id),
      })
      return actual.runPlannerDeterministicSchedule(...args)
    },
  }
})

vi.mock('../plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: (...args: Parameters<typeof actual.runPlannerBeamSearch>) => {
      observed.beamRuns += 1
      return actual.runPlannerBeamSearch(...args)
    },
  }
})

beforeEach(() => {
  observed.schedulerRuns = 0
  observed.beamRuns = 0
  observed.runs = []
})

const TARGET_A = 'target.whatif.a'
const TARGET_B = 'target.whatif.b'
const TARGET_C = 'target.whatif.c'
const ENTRY_A = 'build-list.whatif.a'
const ENTRY_B = 'build-list.whatif.b'
const ENTRY_C = 'build-list.whatif.c'
const SOURCE_A = 'owned.whatif.a'
const SOURCE_B1 = 'owned.whatif.b1'
const SOURCE_B2 = 'owned.whatif.b2'
const SOURCE_C = 'owned.whatif.c'
const NON_IDEAL_SERIES_SKILL_ID = 'series_skill.fixture.z'

function uniformBonuses(bonusTypeId: string): RestorationBonusSet {
  const slot = restorationBonus(bonusTypeId, 'bonus_rank.fixture.high')
  return restorationBonusSet(slot, slot, slot, slot, slot)
}

function uniformTarget(id: string, bonusTypeId: string, priority: TargetWeapon['priority']): TargetWeapon {
  return skillConstrainedTarget(id, {
    priority,
    idealBonuses: uniformBonuses(bonusTypeId),
    practicalBonusConditions: [
      { id: `condition.whatif.${bonusTypeId}`, bonusTypeId, minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 },
    ],
    alternativeBonusRules: [],
  })
}

interface Parts {
  targets: TargetWeapon[]
  ownedWeapons: OwnedWeapon[]
  entries: BuildListEntry[]
}

/** The Beam what-if fixture: A, B (and C) Reset Skills on one contested Skill Counter. */
function whatIfParts(options: { withSecondBSource?: boolean; withTargetC?: boolean } = {}): Parts {
  const a = uniformTarget(TARGET_A, 'bonus_type.fixture.sharpness', 5)
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const targets: TargetWeapon[] = [a, b]
  const ownedWeapons: OwnedWeapon[] = [
    orchestrationSource(SOURCE_A, { restorationBonuses: uniformBonuses('bonus_type.fixture.sharpness') }),
    orchestrationSource(SOURCE_B1, { restorationBonuses: idealBonuses() }),
  ]
  const entries: BuildListEntry[] = [
    orchestrationEntry(ENTRY_A, a, resetSkillsRoute(SOURCE_A), { finalBonuses: uniformBonuses('bonus_type.fixture.sharpness') }),
    orchestrationEntry(ENTRY_B, b, resetSkillsRoute(SOURCE_B1), { finalBonuses: idealBonuses() }),
  ]
  if (options.withSecondBSource !== false) {
    ownedWeapons.push(orchestrationSource(SOURCE_B2, {
      restorationBonuses: belowPracticalBonuses(),
      seriesSkillId: IDEAL_SERIES_SKILL_ID,
    }))
  }
  if (options.withTargetC === true) {
    const c = uniformTarget(TARGET_C, 'bonus_type.fixture.utility', 2)
    targets.push(c)
    ownedWeapons.push(orchestrationSource(SOURCE_C, { restorationBonuses: uniformBonuses('bonus_type.fixture.utility') }))
    entries.push(orchestrationEntry(ENTRY_C, c, resetSkillsRoute(SOURCE_C), { finalBonuses: uniformBonuses('bonus_type.fixture.utility') }))
  }
  return { targets, ownedWeapons, entries }
}

function conflictIdOf(parts: Parts, kind: string): string {
  const probe = orchestrationScenario({
    targets: parts.targets,
    entries: parts.entries.map((entry) => structuredClone(entry)),
    ownedWeapons: parts.ownedWeapons,
  })
  const prepared = preparePlannerInitialContext(probe.input, probe.dependencies)
  if (prepared.status !== 'ready') throw new Error('Expected a ready Planner initial context.')
  const context = createPlannerConstrainedConflictContexts(prepared.context).find((found) => found.kind === kind)
  if (!context) throw new Error(`The fixture produced no ${kind} conflict.`)
  return context.conflictId
}

interface Scenario {
  built: OrchestrationScenario
  scenarioResolution: PlannerConflictResolution
}

function whatIfScenario(options: Parameters<typeof whatIfParts>[0] = {}): Scenario {
  const parts = whatIfParts(options)
  return {
    built: orchestrationScenario(parts),
    scenarioResolution: {
      conflictKey: conflictIdOf(whatIfParts(options), 'same_skill_counter'),
      selectedBuildListEntryId: ENTRY_A as BuildListEntryId,
    },
  }
}

function bounds(maxCandidateTrialsPerTarget: number, maxPlannerReruns: number): PlannerWhatIfBounds {
  return { maxCandidateTrialsPerTarget, maxPlannerReruns }
}

function compare(scenario: Scenario, whatIfBounds: PlannerWhatIfBounds): Promise<PlannerWhatIfCalculationResult> {
  return createPlannerWhatIfComparison(
    { plannerInput: scenario.built.input, scenarioResolution: scenario.scenarioResolution, bounds: whatIfBounds },
    scenario.built.dependencies,
    { enumerationBounds: orchestrationEnumerationBounds() },
  )
}

function alternatives(result: PlannerWhatIfCalculationResult): PlannerWhatIfTargetComparison[] {
  if (result.status !== 'completed') throw new Error(`Expected a completed comparison: ${result.status}`)
  return result.comparison.alternatives
}

function only(result: PlannerWhatIfCalculationResult): PlannerWhatIfTargetComparison {
  const [first, ...rest] = alternatives(result)
  expect(rest).toEqual([])
  return first
}

const IDEAL_DISTANCE = {
  estimatedOperationCount: 1,
  estimatedGogmaAdvance: 1,
  estimatedSkillAdvance: 0,
  estimatedNormalAdvance: null,
}

describe('B9 what-if on the Production path (scheduler): found / not found', () => {
  it('finds the same Ideal alternative the Beam Search finds, through scheduler full runs only', async () => {
    const comparison = only(await compare(whatIfScenario(), bounds(99, 99)))
    expect(comparison.targetWeaponId).toBe(TARGET_B)
    expect(comparison.outcome).toEqual<PlannerWhatIfOutcome>({ status: 'found', distance: IDEAL_DISTANCE })
    expect(observed.schedulerRuns).toBeGreaterThan(0)
    expect(observed.beamRuns).toBe(0)
  })

  it('runs each Candidate trial over its replacement set, never the replaced Entry', async () => {
    await compare(whatIfScenario(), bounds(99, 99))
    const trials = observed.runs.filter(({ context }) => context === 'temporary_replacement')
    expect(trials.length).toBeGreaterThan(0)
    trials.forEach(({ entryIds }) => {
      expect(entryIds).toContain(ENTRY_A)
      expect(entryIds).not.toContain(ENTRY_B)
    })
  })

  it('reports the enumeration bound when every enumerated Candidate is infeasible', async () => {
    const comparison = only(await compare(whatIfScenario({ withSecondBSource: false }), bounds(99, 99)))
    expect(comparison.outcome).toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_enumeration_bound' })
  })

  it('is deterministic', async () => {
    const left = await compare(whatIfScenario({ withTargetC: true }), bounds(99, 99))
    const right = await compare(whatIfScenario({ withTargetC: true }), bounds(99, 99))
    expect(right).toEqual(left)
  })
})

describe('B9 what-if on the Production path (scheduler): the bounds keep their meaning', () => {
  it('stops at the Candidate trial bound before reaching a feasible Candidate', async () => {
    const comparison = only(await compare(whatIfScenario(), bounds(1, 99)))
    expect(comparison.outcome.status).not.toBe('found')
  })

  it('reports a trial bound only when a further Candidate was left untried', async () => {
    expect(only(await compare(whatIfScenario({ withSecondBSource: false }), bounds(2, 99))).outcome)
      .toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_candidate_trial_bound' })
    expect(only(await compare(whatIfScenario({ withSecondBSource: false }), bounds(3, 99))).outcome)
      .toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_enumeration_bound' })
  })

  it('prefers the trial bound when both caps would block the same Candidate', async () => {
    expect(only(await compare(whatIfScenario(), bounds(1, 1))).outcome)
      .toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_candidate_trial_bound' })
  })

  it('reports a rerun bound when the budget blocks the next full run', async () => {
    const comparison = only(await compare(whatIfScenario(), bounds(99, 1)))
    expect(comparison.outcome).toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_planner_rerun_bound' })
    // The budget refused the second Production Plan generation's full run
    // before it started, so only the first full run reached the scheduler.
    expect(observed.runs).toHaveLength(1)
    expect(observed.schedulerRuns).toBe(1)
  })

  it('starts no work for a Target once the shared budget is spent', async () => {
    const comparison = alternatives(await compare(whatIfScenario({ withTargetC: true }), bounds(99, 2)))
    expect(comparison[0].outcome).toEqual<PlannerWhatIfOutcome>({ status: 'found', distance: IDEAL_DISTANCE })
    expect(comparison[1]).toEqual<PlannerWhatIfTargetComparison>({
      targetWeaponId: TARGET_C as never,
      outcome: { status: 'stopped_by_planner_rerun_bound' },
    })
    expect(observed.runs).toHaveLength(2)
  })
})

describe('B9 what-if on the Production path (scheduler): selected checkpoint', () => {
  it('answers blocked_by_selected_checkpoint and runs nothing for that Target', async () => {
    const a = orchestrationTarget(TARGET_A, {
      priority: 3,
      practicalBonusConditions: [
        { id: 'condition.whatif.gogma.attack', bonusTypeId: 'bonus_type.fixture.attack', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 },
        { id: 'condition.whatif.gogma.sharpness', bonusTypeId: 'bonus_type.fixture.sharpness', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 },
      ],
    })
    const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
    const sourceB = orchestrationSource(SOURCE_B1, { restorationBonuses: practicalBonuses() })
    const parts: Parts = {
      targets: [a, b],
      ownedWeapons: [orchestrationSource(SOURCE_A, { restorationBonuses: belowPracticalBonuses() }), sourceB],
      entries: [
        orchestrationEntry(ENTRY_A, a, resetRoute(SOURCE_A), {
          finalBonuses: idealBonuses(),
          seriesSkillId: NON_IDEAL_SERIES_SKILL_ID,
        }),
        checkpointMixedEntry(ENTRY_B, b, SOURCE_B1, sourceB),
      ],
    }
    const scenario: Scenario = {
      built: orchestrationScenario(parts),
      scenarioResolution: {
        conflictKey: conflictIdOf(parts, 'same_gogma_counter'),
        selectedBuildListEntryId: ENTRY_A as BuildListEntryId,
      },
    }
    const comparison = only(await compare(scenario, bounds(99, 99)))
    expect(comparison).toEqual<PlannerWhatIfTargetComparison>({
      targetWeaponId: TARGET_B as never,
      outcome: { status: 'blocked_by_selected_checkpoint' },
    })
    expect(observed.runs).toEqual([])
  })
})
