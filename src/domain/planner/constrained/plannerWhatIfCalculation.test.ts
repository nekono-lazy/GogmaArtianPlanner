import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeapon,
  RestorationBonusSet,
  TargetWeapon,
} from '../../models/publicTypes'
import { CandidateSearchError } from '../../search'
import {
  belowPracticalBonuses,
  idealBonuses,
  IDEAL_SERIES_SKILL_ID,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  restorationBonus,
  restorationBonusSet,
} from '../../../test/fixtures/targetEvaluation'
import {
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
import type { RngEngine } from '../../rng/rngEngine'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
} from '../plannerTypes'
import { createPlannerConstrainedConflictContexts } from './plannerConflictContext'
import type { PlannerFixedConflictConstraint } from './plannerConflictContext'
import { PlannerWhatIfBoundsError } from './plannerWhatIfBounds'
import type { PlannerWhatIfBounds } from './plannerWhatIfBounds'
import {
  createPlannerWhatIfComparison,
  isPlannerWhatIfCandidateFeasible,
  plannerWhatIfEnumerationOutcome,
  PlannerWhatIfCancelledError,
} from './plannerWhatIfCalculation'
import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfOutcome,
  PlannerWhatIfTargetComparison,
} from './plannerWhatIfTypes'

/**
 * B9-B1b what-if Domain calculation.
 *
 * The pipeline runs for real end to end: `preparePlannerWhatIfScenario`, the
 * constrained enumerator, the B8-C2 materializer, the B8-C3b augmented
 * preflight, and the shared Production Plan generation with its Beam Search and
 * Trace Replay. Only the Fake RNG Engine, the ID factory and the Clock are
 * injected, exactly as the Planner contract already requires.
 *
 * The two module wrappers below do not replace behaviour: they delegate to the
 * real implementation and record what it was called with, so the independence
 * and fixed-constraint contracts can be asserted from outside. One test
 * deliberately forces a preflight failure, a branch no fixture can reach
 * naturally.
 */

interface PreflightOverride {
  (callIndex: number): { status: 'unresolved'; conflictResolutions: []; failures: [] } | null
}

const observed = vi.hoisted(() => ({
  plannerInputs: [] as string[][],
  preflightConstraints: [] as string[][],
  preflightOverride: null as PreflightOverride | null,
}))

vi.mock('../productionPlanGeneration', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../productionPlanGeneration')>()
  return {
    ...actual,
    createProductionPlanWithObserver: (
      ...args: Parameters<typeof actual.createProductionPlanWithObserver>
    ) => {
      observed.plannerInputs.push(args[0].buildListEntries.map(({ id }) => id))
      return actual.createProductionPlanWithObserver(...args)
    },
  }
})

vi.mock('./plannerAugmentedPreflight', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerAugmentedConflictPreflight: (
      ...args: Parameters<typeof actual.preparePlannerAugmentedConflictPreflight>
    ) => {
      observed.preflightConstraints.push(
        args[1].map(({ fixedBuildListEntryId }) => fixedBuildListEntryId),
      )
      const forced = observed.preflightOverride?.(
        observed.preflightConstraints.length,
      )
      return forced ?? actual.preparePlannerAugmentedConflictPreflight(...args)
    },
  }
})

beforeEach(() => {
  observed.plannerInputs = []
  observed.preflightConstraints = []
  observed.preflightOverride = null
})

const TARGET_A = 'target.whatif.a'
const TARGET_B = 'target.whatif.b'
const TARGET_C = 'target.whatif.c'
const TARGET_D = 'target.whatif.d'
const TARGET_E = 'target.whatif.e'
const ENTRY_A = 'build-list.whatif.a'
const ENTRY_B = 'build-list.whatif.b'
const ENTRY_C = 'build-list.whatif.c'
const ENTRY_D = 'build-list.whatif.d'
const ENTRY_E = 'build-list.whatif.e'
const SOURCE_A = 'owned.whatif.a'
const SOURCE_B1 = 'owned.whatif.b1'
const SOURCE_B2 = 'owned.whatif.b2'
const SOURCE_C = 'owned.whatif.c'
const SOURCE_D = 'owned.whatif.d'
const SOURCE_E = 'owned.whatif.e'
const NON_IDEAL_SERIES_SKILL_ID = 'series_skill.fixture.z'

/** Five identical slots, so a Target can require one Bonus Type exclusively. */
function uniformBonuses(bonusTypeId: string): RestorationBonusSet {
  const slot = restorationBonus(bonusTypeId, 'bonus_rank.fixture.high')
  return restorationBonusSet(slot, slot, slot, slot, slot)
}

/**
 * A Target satisfied only by five high slots of one Bonus Type plus the Ideal
 * Series Skill.
 *
 * The three what-if Targets use three different Bonus Types, so no weapon
 * secured for one of them can satisfy another. Without that separation a single
 * result would satisfy several Targets at once and the Planner would stop
 * needing the other Entries, which is a Target modelling artefact rather than
 * the coexistence question B9 asks.
 */
function uniformTarget(
  id: string,
  bonusTypeId: string,
  priority: TargetWeapon['priority'],
): TargetWeapon {
  return skillConstrainedTarget(id, {
    priority,
    idealBonuses: uniformBonuses(bonusTypeId),
    practicalBonusConditions: [
      {
        id: `condition.whatif.${bonusTypeId}`,
        bonusTypeId,
        minimumRankId: 'bonus_rank.fixture.high',
        requiredCount: 5,
        requiredExCount: 0,
      },
    ],
    practicalAlternativeGroups: [],
  })
}

/**
 * A Target reachable only by the contested Gogma Counter's Reset result.
 *
 * It deliberately requires a high Sharpness slot on top of the default Attack
 * and Element conditions, because the Skill-conflict fixture already owns a
 * weapon that satisfies the default conditions. Without that extra requirement
 * this Target would start out satisfied, its Entry would be irrelevant, and the
 * second conflict would never be detected.
 */
function gogmaConflictTarget(id: string): TargetWeapon {
  return orchestrationTarget(id, {
    priority: 3,
    practicalBonusConditions: [
      {
        id: 'condition.whatif.gogma.attack',
        bonusTypeId: 'bonus_type.fixture.attack',
        minimumRankId: 'bonus_rank.fixture.high',
        requiredCount: 2,
        requiredExCount: 0,
      },
      {
        id: 'condition.whatif.gogma.sharpness',
        bonusTypeId: 'bonus_type.fixture.sharpness',
        minimumRankId: 'bonus_rank.fixture.high',
        requiredCount: 1,
        requiredExCount: 0,
      },
    ],
  })
}

interface WhatIfPartsOptions {
  /** The Skill-free source that makes a Gogma-only Candidate reachable. */
  withSecondBSource?: boolean
  /** A second non-fixed participant Target of the same Skill conflict. */
  withTargetC?: boolean
  /** Two extra Targets contending for a Gogma Counter, i.e. a 2nd conflict. */
  withGogmaConflict?: boolean
}

interface WhatIfParts {
  targets: TargetWeapon[]
  ownedWeapons: OwnedWeapon[]
  entries: BuildListEntry[]
}

/**
 * The what-if scenario.
 *
 * Targets A, B and C all need the Ideal Series Skill, and their Entries all
 * Reset Skills at the same Skill Counter, which is the `same_skill_counter`
 * conflict the comparison is about. Target B additionally owns a source that
 * already carries the Ideal Series Skill, so a Bonus-only Route reaches B
 * without touching the contested Skill position at all.
 */
function whatIfParts(options: WhatIfPartsOptions = {}): WhatIfParts {
  const a = uniformTarget(TARGET_A, 'bonus_type.fixture.sharpness', 5)
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const targets: TargetWeapon[] = [a, b]
  const ownedWeapons: OwnedWeapon[] = [
    orchestrationSource(SOURCE_A, {
      restorationBonuses: uniformBonuses('bonus_type.fixture.sharpness'),
    }),
    orchestrationSource(SOURCE_B1, { restorationBonuses: practicalBonuses() }),
  ]
  const entries: BuildListEntry[] = [
    orchestrationEntry(ENTRY_A, a, resetSkillsRoute(SOURCE_A), {
      category: 'ideal',
      finalBonuses: uniformBonuses('bonus_type.fixture.sharpness'),
    }),
    orchestrationEntry(ENTRY_B, b, resetSkillsRoute(SOURCE_B1), {
      category: 'practical',
      finalBonuses: practicalBonuses(),
    }),
  ]
  if (options.withSecondBSource !== false) {
    ownedWeapons.push(
      orchestrationSource(SOURCE_B2, {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: IDEAL_SERIES_SKILL_ID,
      }),
    )
  }
  if (options.withTargetC === true) {
    const c = uniformTarget(TARGET_C, 'bonus_type.fixture.utility', 2)
    targets.push(c)
    ownedWeapons.push(
      orchestrationSource(SOURCE_C, {
        restorationBonuses: uniformBonuses('bonus_type.fixture.utility'),
      }),
    )
    entries.push(
      orchestrationEntry(ENTRY_C, c, resetSkillsRoute(SOURCE_C), {
        category: 'ideal',
        finalBonuses: uniformBonuses('bonus_type.fixture.utility'),
      }),
    )
  }
  if (options.withGogmaConflict === true) {
    // Two Targets whose Entries Reset Bonuses at the same Gogma Counter. Their
    // results keep the source Series Skill, which none of A, B or C accepts, so
    // this second conflict adds a second explicit resolution without changing
    // what satisfies the Skill-conflict Targets.
    ;[
      [TARGET_D, SOURCE_D, ENTRY_D],
      [TARGET_E, SOURCE_E, ENTRY_E],
    ].forEach(([targetId, sourceId, entryId]) => {
      const target = gogmaConflictTarget(targetId)
      targets.push(target)
      ownedWeapons.push(
        orchestrationSource(sourceId, {
          restorationBonuses: belowPracticalBonuses(),
        }),
      )
      entries.push(
        orchestrationEntry(entryId, target, resetRoute(sourceId), {
          category: 'practical',
          finalBonuses: idealBonuses(),
          seriesSkillId: NON_IDEAL_SERIES_SKILL_ID,
        }),
      )
    })
  }
  return { targets, ownedWeapons, entries }
}

/** The `PlanConflict.id`s the ordinary Planner authority detects, by kind. */
function detectedConflictIds(parts: WhatIfParts): Record<string, string> {
  const probe = orchestrationScenario({
    targets: parts.targets,
    entries: parts.entries.map((entry) => structuredClone(entry)),
    ownedWeapons: parts.ownedWeapons,
  })
  const prepared = preparePlannerInitialContext(probe.input, probe.dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  const byKind: Record<string, string> = {}
  createPlannerConstrainedConflictContexts(prepared.context).forEach(
    ({ kind, conflictId }) => {
      byKind[kind] = conflictId
    },
  )
  return byKind
}

interface WhatIfScenario {
  built: OrchestrationScenario
  scenarioResolution: PlannerConflictResolution
  otherResolutions: PlannerConflictResolution[]
}

function whatIfScenario(options: WhatIfPartsOptions = {}): WhatIfScenario {
  const parts = whatIfParts(options)
  const conflictIds = detectedConflictIds(whatIfParts(options))
  const scenarioResolution: PlannerConflictResolution = {
    conflictKey: conflictIds.same_skill_counter,
    selectedBuildListEntryId: ENTRY_A as BuildListEntryId,
  }
  const otherResolutions: PlannerConflictResolution[] =
    options.withGogmaConflict === true
      ? [
          {
            conflictKey: conflictIds.same_gogma_counter,
            selectedBuildListEntryId: ENTRY_D as BuildListEntryId,
          },
        ]
      : []
  return {
    built: orchestrationScenario({
      targets: parts.targets,
      entries: parts.entries,
      ownedWeapons: parts.ownedWeapons,
      conflictResolutions: otherResolutions,
    }),
    scenarioResolution,
    otherResolutions,
  }
}

function bounds(
  maxCandidateTrialsPerCategoryPerTarget: number,
  maxPlannerReruns: number,
): PlannerWhatIfBounds {
  return { maxCandidateTrialsPerCategoryPerTarget, maxPlannerReruns }
}

function compare(
  scenario: WhatIfScenario,
  whatIfBounds: PlannerWhatIfBounds,
  options: {
    dependencies?: PlannerDependencies
    executionOptions?: Parameters<typeof createPlannerWhatIfComparison>[2]['executionOptions']
  } = {},
): Promise<PlannerWhatIfCalculationResult> {
  return createPlannerWhatIfComparison(
    {
      plannerInput: scenario.built.input,
      scenarioResolution: scenario.scenarioResolution,
      bounds: whatIfBounds,
    },
    options.dependencies ?? scenario.built.dependencies,
    {
      enumerationBounds: orchestrationEnumerationBounds(),
      executionOptions: options.executionOptions,
    },
  )
}

function alternatives(
  result: PlannerWhatIfCalculationResult,
): PlannerWhatIfTargetComparison[] {
  if (result.status !== 'completed') {
    throw new Error(`Expected a completed comparison: ${result.status}`)
  }
  return result.comparison.alternatives
}

function only(result: PlannerWhatIfCalculationResult): PlannerWhatIfTargetComparison {
  const [first, ...rest] = alternatives(result)
  expect(rest).toEqual([])
  return first
}

/** The two known distances of the fixture, as plain readable values. */
const PRACTICAL_DISTANCE = {
  estimatedOperationCount: 2,
  estimatedGogmaAdvance: 2,
  estimatedSkillAdvance: 0,
  estimatedNormalAdvance: null,
}
const IDEAL_DISTANCE = {
  estimatedOperationCount: 1,
  estimatedGogmaAdvance: 1,
  estimatedSkillAdvance: 0,
  estimatedNormalAdvance: null,
}

function found(distance: typeof PRACTICAL_DISTANCE): PlannerWhatIfOutcome {
  return { status: 'found', distance }
}

describe('B9-B1b comparison shape', () => {
  it('reports the fixed side and one alternative per non-fixed participant Target', async () => {
    const scenario = whatIfScenario({ withTargetC: true })

    const result = await compare(scenario, bounds(99, 99))

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.comparison.conflictKey).toBe(
      scenario.scenarioResolution.conflictKey,
    )
    expect(result.comparison.fixedBuildListEntryId).toBe(ENTRY_A)
    expect(result.comparison.fixedTargetWeaponId).toBe(TARGET_A)
    // The fixed Target never yields, and the works order is the existing stable
    // one, not a B9-specific Target sort.
    expect(
      result.comparison.alternatives.map(({ targetWeaponId }) => targetWeaponId),
    ).toEqual([TARGET_B, TARGET_C])
  })

  it('leaves the caller PlannerInput untouched and persists nothing', async () => {
    const scenario = whatIfScenario()
    const before = structuredClone(scenario.built.input)

    await compare(scenario, bounds(99, 99))

    expect(scenario.built.input).toEqual(before)
  })

  it('fails closed on invalid what-if bounds instead of assuming a default', async () => {
    const scenario = whatIfScenario()

    await expect(compare(scenario, bounds(0, 1))).rejects.toBeInstanceOf(
      PlannerWhatIfBoundsError,
    )
  })

  it('returns the scenario preparation failure unchanged', async () => {
    const scenario = whatIfScenario()
    scenario.scenarioResolution = {
      conflictKey: 'plan-conflict:fnv1a32:deadbeef',
      selectedBuildListEntryId: ENTRY_A as BuildListEntryId,
    }

    const result = await compare(scenario, bounds(99, 99))

    expect(result.status).toBe('invalid_fixed_resolution')
    // No enumeration, no materialization, no Beam Search.
    expect(observed.plannerInputs).toEqual([])
  })
})

describe('B9-B1b Candidate ordering authority', () => {
  it('takes the next Candidate in compareConstrainedCandidates order, not the first feasible one', async () => {
    const scenario = whatIfScenario()

    // The Practical axis begins with a Reset-Skills Candidate sitting on the
    // contested Skill Counter, which the fixed Entry already owns. Only the
    // Bonus-only Candidate after it can coexist.
    const oneTrial = only(await compare(scenario, bounds(1, 99)))
    expect(oneTrial.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })

    const twoTrials = only(await compare(whatIfScenario(), bounds(2, 99)))
    expect(twoTrials.practical).toEqual(found(PRACTICAL_DISTANCE))
  })

  it('uses the enumerator estimates as the distance, with no B9 measure of its own', async () => {
    const scenario = whatIfScenario()

    const comparison = only(await compare(scenario, bounds(99, 99)))

    expect(comparison.practical).toEqual(found(PRACTICAL_DISTANCE))
    expect(comparison.ideal).toEqual(found(IDEAL_DISTANCE))
  })
})

describe('B9-B1b exclusive category slots', () => {
  it('never lets an Ideal Candidate fill the Practical slot', async () => {
    const scenario = whatIfScenario()

    // One trial each: the Ideal axis has a feasible first Candidate, the
    // Practical axis does not. A shared pool would have filled both slots with
    // the Ideal answer.
    const comparison = only(await compare(scenario, bounds(1, 99)))

    expect(comparison.ideal).toEqual(found(IDEAL_DISTANCE))
    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })
  })

  it('fills and stops the two slots independently', async () => {
    const scenario = whatIfScenario({ withSecondBSource: false })

    // Practical has three Candidates and Ideal four, all infeasible. Three
    // trials therefore exhaust Practical exactly while Ideal still has one
    // Candidate left, so the two slots end with different statuses.
    const comparison = only(await compare(scenario, bounds(3, 99)))

    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_enumeration_bound',
    })
    expect(comparison.ideal).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })
  })
})

describe('B9-B1b category execution order', () => {
  it('spends the shared Planner rerun budget on Practical before Ideal', async () => {
    const scenario = whatIfScenario()

    // Practical needs two full Beam Searches to reach its feasible Candidate.
    // With exactly two affordable executions the Ideal slot is left unjudged,
    // which is only true if Practical ran first.
    const comparison = only(await compare(scenario, bounds(99, 2)))

    expect(comparison.practical).toEqual(found(PRACTICAL_DISTANCE))
    expect(comparison.ideal).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_planner_rerun_bound',
    })
    expect(observed.plannerInputs).toHaveLength(2)
  })

  it('answers both slots when one more execution is affordable', async () => {
    const scenario = whatIfScenario()

    const comparison = only(await compare(scenario, bounds(99, 3)))

    expect(comparison.practical).toEqual(found(PRACTICAL_DISTANCE))
    expect(comparison.ideal).toEqual(found(IDEAL_DISTANCE))
    expect(observed.plannerInputs).toHaveLength(3)
  })
})

describe('B9-B1b independence', () => {
  /** Baseline plus at most one trial Entry: nothing a trial produced survives. */
  function assertTrialInputsAreBaselinePlusOne(baseline: readonly string[]): void {
    expect(observed.plannerInputs.length).toBeGreaterThan(1)
    observed.plannerInputs.forEach((entryIds) => {
      const extra = entryIds.filter((id) => !baseline.includes(id))
      expect(entryIds.filter((id) => baseline.includes(id)).sort()).toEqual(
        [...baseline].sort(),
      )
      expect(extra.length).toBeLessThanOrEqual(1)
    })
  }

  it('rebuilds every Candidate trial input from the same baseline', async () => {
    const scenario = whatIfScenario()
    const baseline = scenario.built.input.buildListEntries.map(
      ({ id }) => id as string,
    )

    await compare(scenario, bounds(99, 99))

    assertTrialInputsAreBaselinePlusOne(baseline)
    // Several distinct trial Entries were tried, so the check above really did
    // see more than one generated Entry.
    const generated = new Set(
      observed.plannerInputs.flatMap((ids) =>
        ids.filter((id) => !baseline.includes(id)),
      ),
    )
    expect(generated.size).toBeGreaterThan(1)
  })

  it('never carries one Target what-if Entry into the next Target', async () => {
    const scenario = whatIfScenario({ withTargetC: true })
    const baseline = scenario.built.input.buildListEntries.map(
      ({ id }) => id as string,
    )

    const comparison = alternatives(await compare(scenario, bounds(99, 99)))

    expect(comparison.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      TARGET_B,
      TARGET_C,
    ])
    assertTrialInputsAreBaselinePlusOne(baseline)
  })

  it('evaluates a Target the same way whether or not another Target precedes it', async () => {
    const alone = only(await compare(whatIfScenario(), bounds(99, 99)))
    const withNeighbour = alternatives(
      await compare(whatIfScenario({ withTargetC: true }), bounds(99, 99)),
    )

    expect(withNeighbour[0].practical).toEqual(alone.practical)
    expect(withNeighbour[0].ideal).toEqual(alone.ideal)
  })
})

describe('B9-B1b augmented preflight', () => {
  it('passes every fixed constraint, not only the scenario one', async () => {
    const scenario = whatIfScenario({ withGogmaConflict: true })

    await compare(scenario, bounds(2, 99))

    expect(observed.preflightConstraints.length).toBeGreaterThan(0)
    observed.preflightConstraints.forEach((fixedEntryIds) => {
      expect([...fixedEntryIds].sort()).toEqual([ENTRY_A, ENTRY_D].sort())
    })
  })

  it('rejects only that Candidate and starts no Beam Search when the preflight fails', async () => {
    const scenario = whatIfScenario()
    // The first Practical Candidate would otherwise be rejected by a full
    // rerun; forcing its preflight to fail proves the trial is spent without
    // one, and that the next Candidate is still evaluated.
    observed.preflightOverride = (callIndex) =>
      callIndex === 1
        ? { status: 'unresolved', conflictResolutions: [], failures: [] }
        : null

    const comparison = only(await compare(scenario, bounds(2, 99)))

    expect(comparison.practical).toEqual(found(PRACTICAL_DISTANCE))
    // Two Practical trials, but only the second one ran a Beam Search.
    expect(observed.preflightConstraints).toHaveLength(3)
    expect(observed.plannerInputs).toHaveLength(2)
  })

  it('spends the trial budget on a preflight-rejected Candidate', async () => {
    const scenario = whatIfScenario()
    observed.preflightOverride = (callIndex) =>
      callIndex === 1
        ? { status: 'unresolved', conflictResolutions: [], failures: [] }
        : null

    const comparison = only(await compare(scenario, bounds(1, 99)))

    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })
    // The rejected preflight consumed the only Practical trial without a Beam.
    expect(observed.plannerInputs).toHaveLength(1)
  })
})

describe('B9-B1b reusedExisting Candidates', () => {
  it('judges an existing semantic Entry with a full rerun instead of rejecting it outright', async () => {
    const scenario = whatIfScenario()

    // The first Practical Candidate is exactly the existing Entry B, so the
    // materializer reuses it. B8 would have spent the trial and skipped the
    // rerun; B9 must still preflight and run the Planner.
    const comparison = only(await compare(scenario, bounds(1, 99)))

    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })
    const baseline = scenario.built.input.buildListEntries.map(
      ({ id }) => id as string,
    )
    // No duplicate Entry: the first trial input is the baseline itself, and it
    // still reached a preflight and a full Beam Search.
    expect(observed.preflightConstraints.length).toBeGreaterThanOrEqual(1)
    expect(observed.plannerInputs[0]).toEqual(baseline)
    expect(observed.plannerInputs[0]).toContain(ENTRY_B)
  })
})

describe('B9-B1b feasibility authority', () => {
  const trial = 'build-list.constrained.trial' as BuildListEntryId

  function constraint(id: string): PlannerFixedConflictConstraint {
    return {
      originalConflictId: 'plan-conflict:test',
      resourceIdentity: {
        kind: 'same_skill_counter',
        counterStream: 'skill',
        counterBefore: 7,
      },
      fixedBuildListEntryId: id as BuildListEntryId,
      fixedTargetWeaponId: TARGET_A as never,
      fixedCandidateFingerprint: 'fingerprint.test',
    }
  }

  const fixed = [constraint(ENTRY_A), constraint(ENTRY_D)]

  it('requires the trial Entry and every fixed Entry', () => {
    expect(
      isPlannerWhatIfCandidateFeasible(
        [trial, ENTRY_A as BuildListEntryId, ENTRY_D as BuildListEntryId],
        trial,
        fixed,
      ),
    ).toBe(true)
  })

  it('rejects a Plan that does not select the trial Entry', () => {
    expect(
      isPlannerWhatIfCandidateFeasible(
        [ENTRY_A as BuildListEntryId, ENTRY_D as BuildListEntryId],
        trial,
        fixed,
      ),
    ).toBe(false)
  })

  it('rejects a Plan that keeps the trial Entry by dropping a fixed Entry', () => {
    expect(
      isPlannerWhatIfCandidateFeasible(
        [trial, ENTRY_A as BuildListEntryId],
        trial,
        fixed,
      ),
    ).toBe(false)
  })

  it('does not require a completed Plan, only the selected Entries', () => {
    expect(isPlannerWhatIfCandidateFeasible([trial], trial, [])).toBe(true)
  })
})

describe('B9-B1b enumeration outcome', () => {
  it('separates a bound stop from exhaustion', () => {
    expect(
      plannerWhatIfEnumerationOutcome({
        examinedCandidates: 3,
        evaluatedOffAxisPairs: 0,
        exhausted: false,
        stoppedByBound: true,
      }),
    ).toEqual<PlannerWhatIfOutcome>({ status: 'stopped_by_enumeration_bound' })
    expect(
      plannerWhatIfEnumerationOutcome({
        examinedCandidates: 3,
        evaluatedOffAxisPairs: 0,
        exhausted: true,
        stoppedByBound: false,
      }),
    ).toEqual<PlannerWhatIfOutcome>({ status: 'not_found_within_search_extent' })
  })

  it('raises an invariant failure instead of inventing a status', () => {
    expect(() =>
      plannerWhatIfEnumerationOutcome({
        examinedCandidates: 0,
        evaluatedOffAxisPairs: 0,
        exhausted: false,
        stoppedByBound: false,
      }),
    ).toThrowError()
  })
})

describe('B9-B1b bound precedence', () => {
  it('reports a trial bound only when a further Candidate was left untried', async () => {
    const truncating = only(
      await compare(whatIfScenario({ withSecondBSource: false }), bounds(2, 99)),
    )
    expect(truncating.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })

    // Exactly three Practical Candidates: spending the last trial on the last
    // Candidate is not a truncation, so the enumeration bound is reported.
    const exact = only(
      await compare(whatIfScenario({ withSecondBSource: false }), bounds(3, 99)),
    )
    expect(exact.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_enumeration_bound',
    })
  })

  it('prefers the trial bound when both caps would block the same Candidate', async () => {
    const scenario = whatIfScenario()

    // One trial, and the budget is spent by that trial too. Raising
    // maxPlannerReruns alone would not get past the trial cap.
    const comparison = only(await compare(scenario, bounds(1, 1)))

    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_candidate_trial_bound',
    })
  })

  it('reports a rerun bound when the budget blocks the next Beam Search', async () => {
    const scenario = whatIfScenario()

    const comparison = only(await compare(scenario, bounds(99, 1)))

    expect(comparison.practical).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_planner_rerun_bound',
    })
    expect(comparison.ideal).toEqual<PlannerWhatIfOutcome>({
      status: 'stopped_by_planner_rerun_bound',
    })
    // Two Production Plan generations were entered, but the budget refused the
    // second one's Beam Search, which is what makes this a bound rather than an
    // infeasible Candidate.
    expect(observed.plannerInputs).toHaveLength(2)
  })

  it('keeps a found answer when a later bound is reached', async () => {
    const scenario = whatIfScenario()

    // The enumeration itself stopped on a bound, yet both slots were answered
    // before that mattered.
    const comparison = only(await compare(scenario, bounds(99, 99)))

    expect(comparison.practical.status).toBe('found')
    expect(comparison.ideal.status).toBe('found')
  })

  it('starts no work for a Target once the shared budget is spent', async () => {
    const scenario = whatIfScenario({ withTargetC: true })

    // Target B answers both slots with three executions, leaving none for
    // Target C, whose slots are reported as blocked rather than searched.
    const comparison = alternatives(await compare(scenario, bounds(99, 3)))

    expect(comparison[0].practical).toEqual(found(PRACTICAL_DISTANCE))
    expect(comparison[0].ideal).toEqual(found(IDEAL_DISTANCE))
    expect(comparison[1]).toEqual<PlannerWhatIfTargetComparison>({
      targetWeaponId: TARGET_C as never,
      practical: { status: 'stopped_by_planner_rerun_bound' },
      ideal: { status: 'stopped_by_planner_rerun_bound' },
    })
    expect(observed.plannerInputs).toHaveLength(3)
  })

  it('decides a Candidate-free category from the enumeration alone', async () => {
    const scenario = whatIfScenario({ withTargetC: true })

    // Target C has no Practical Candidate at all, so that slot needs no Beam
    // Search and is decided by the enumeration summary.
    const comparison = alternatives(await compare(scenario, bounds(99, 4)))

    expect(comparison[1]).toEqual<PlannerWhatIfTargetComparison>({
      targetWeaponId: TARGET_C as never,
      practical: { status: 'stopped_by_enumeration_bound' },
      ideal: { status: 'stopped_by_enumeration_bound' },
    })
  })
})

describe('B9-B1b cancellation', () => {
  it('normalizes a cancelled constrained enumeration', async () => {
    const scenario = whatIfScenario()

    const outcome = await compare(scenario, bounds(99, 99), {
      executionOptions: { shouldCancel: () => true },
    }).then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    )

    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.error).toBeInstanceOf(PlannerWhatIfCancelledError)
    // No partial comparison is returned, and no Beam Search was started.
    expect(observed.plannerInputs).toEqual([])
  })

  it('ends the request when a Candidate trial Beam Search is cancelled', async () => {
    const scenario = whatIfScenario()
    // The Clock is the deterministic trigger: the enumerator never calls it,
    // and the materializer calls it once per Candidate. Cancellation therefore
    // switches on after the enumeration finished, inside the first trial.
    let clockCalls = 0
    const inner = scenario.built.dependencies.clock
    scenario.built.dependencies.clock = {
      now: () => {
        clockCalls += 1
        return inner.now()
      },
    }

    const outcome = await compare(scenario, bounds(99, 99), {
      executionOptions: { shouldCancel: () => clockCalls >= 1 },
    }).then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    )

    expect(clockCalls).toBeGreaterThanOrEqual(1)
    expect(outcome.resolved).toBe(false)
    if (outcome.resolved) return
    expect(outcome.error).toBeInstanceOf(PlannerWhatIfCancelledError)
    // A cancelled Beam Search returns `plan: null`; it must not be read as an
    // infeasible Candidate, so exactly one execution was started and no further
    // Candidate was judged.
    expect(observed.plannerInputs).toHaveLength(1)
  })

  it('never converts an ordinary Search failure into a cancellation', async () => {
    const scenario = whatIfScenario()
    const engine = scenario.built.dependencies.rngEngine
    const failure = new Error('fixture prediction failure')
    scenario.built.dependencies.rngEngine = new Proxy(engine, {
      get(target, property) {
        if (property === 'predictGogmaBonus') {
          return () => {
            throw failure
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as RngEngine

    await expect(compare(scenario, bounds(99, 99))).rejects.toBe(failure)
  })

  it('only normalizes the Search Domain cancellation code', () => {
    // The guard is the `cancelled` code, never the error class alone.
    const other = new CandidateSearchError('invalid_input', 'not a cancellation')
    expect(other).not.toBeInstanceOf(PlannerWhatIfCancelledError)
    expect(other.code).not.toBe('cancelled')
  })
})

describe('B9-B1b semantic determinism', () => {
  it('produces the same comparison under different runtime IDs and Clock values', async () => {
    const first = whatIfScenario()
    const second = whatIfScenario()
    let planIds = 0
    let stepIds = 0
    let ownedIds = 0
    second.built.dependencies = {
      ...second.built.dependencies,
      idFactory: {
        productionPlanId: () => `plan.second.${++planIds}` as never,
        planStepId: () => `step.second.${++stepIds}` as never,
        ownedWeaponId: () => `owned.second.${++ownedIds}` as never,
      },
      clock: { now: () => '2031-12-31T23:59:59.000Z' },
    }

    const left = await compare(first, bounds(99, 99))
    const right = await compare(second, bounds(99, 99))

    expect(right).toEqual(left)
  })
})

describe('B9-B1b empty work set', () => {
  it('completes with no alternatives when the conflict has no other Target', async () => {
    const parts = whatIfParts()
    // Both participants of the Skill conflict belong to the fixed Target, so
    // there is nothing to compare against and nothing is invented.
    const merged: PlannerInput['buildListEntries'] = parts.entries.map((entry) =>
      entry.id === ENTRY_B
        ? { ...structuredClone(entry), targetWeaponId: TARGET_A as never }
        : entry,
    )
    const conflictIds = detectedConflictIds({
      ...parts,
      entries: merged.map((entry) => structuredClone(entry)),
    })
    const built = orchestrationScenario({
      targets: parts.targets,
      entries: merged,
      ownedWeapons: parts.ownedWeapons,
    })

    const result = await createPlannerWhatIfComparison(
      {
        plannerInput: built.input,
        scenarioResolution: {
          conflictKey: conflictIds.same_skill_counter,
          selectedBuildListEntryId: ENTRY_A as BuildListEntryId,
        },
        bounds: bounds(99, 99),
      },
      built.dependencies,
      { enumerationBounds: orchestrationEnumerationBounds() },
    )

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.comparison.alternatives).toEqual([])
    expect(observed.plannerInputs).toEqual([])
  })
})
