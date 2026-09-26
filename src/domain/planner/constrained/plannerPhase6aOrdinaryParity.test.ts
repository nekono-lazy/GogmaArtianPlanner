import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildListEntry, TargetWeapon } from '../../models/publicTypes'
import { defaultConstrainedEnumerationBounds } from '../../search'
import {
  belowPracticalBonuses,
  idealBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationBounds,
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
import { runtimeUnsupportedFixture } from '../../../test/fixtures/plannerRuntimeUnsupported'
import type { PlannerDependencies, PlannerInput, PlannerResult } from '../plannerTypes'
import { createProductionPlan } from '../productionPlanGeneration'
import { createProductionPlanWithConstrainedSearch } from './plannerConstrainedOrchestration'
import { defaultPlannerOrchestrationBounds } from './plannerOrchestrationBounds'

/**
 * Phase 6-A migration evidence (`docs/PLANNER_SPEC.md` 9.2.7 / 9.2.19.16):
 * the Build List ordinary Planner and the replan Preview hand the Planner a
 * fresh input with `conflictResolutions = []`, so the legacy B8 orchestration
 * they used to call ran exactly its initial ordinary Planner run and returned
 * it. Switching them to `createPlan()` therefore changes no result.
 *
 * Each case runs the legacy orchestration with the Production values its
 * Worker adapter passed (`defaultPlannerOrchestrationBounds`,
 * `defaultConstrainedEnumerationBounds`) and the ordinary Production Planner
 * over two identically built inputs with deterministic ID / Clock / RNG
 * dependencies, and requires:
 *
 * - the same `plan`, `conflicts`, `warnings` and `termination` (exact equality
 *   is legitimate here only because the ID factory and the Clock are injected
 *   and sequential, AGENTS.md "Testing Requirements")
 * - no generated Entry and no replacement from the legacy path
 * - the same number of full Planner runs, and no constrained enumeration,
 *   materialization, Candidate trial or replacement preflight at all
 * - the same RNG Engine and Clock work
 *
 * The one case where the two could differ is outside the Build List and replan
 * inputs' reach in practice: the legacy budget capped the runtime-unsupported
 * retries of that initial run at `maxPlannerReruns` (4) full runs, while the
 * ordinary Planner has no such cap. It is recorded, not hidden, in
 * `docs/PLANNER_SPEC.md` 9.2.19.16.
 */

const counts = vi.hoisted(() => ({
  fullRuns: 0,
  enumerations: 0,
  materializers: 0,
  replacementPreflights: 0,
}))

vi.mock('../plannerDeterministicScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerDeterministicScheduler')>()
  return {
    ...actual,
    runPlannerDeterministicSchedule: (...args: Parameters<typeof actual.runPlannerDeterministicSchedule>) => {
      counts.fullRuns += 1
      return actual.runPlannerDeterministicSchedule(...args)
    },
  }
})

vi.mock('../../search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../search')>()
  return {
    ...actual,
    visitConstrainedCandidates: (...args: Parameters<typeof actual.visitConstrainedCandidates>) => {
      counts.enumerations += 1
      return actual.visitConstrainedCandidates(...args)
    },
  }
})

vi.mock('./constrainedMaterializer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constrainedMaterializer')>()
  return {
    ...actual,
    createConstrainedMaterializer: (...args: Parameters<typeof actual.createConstrainedMaterializer>) => {
      counts.materializers += 1
      return actual.createConstrainedMaterializer(...args)
    },
  }
})

vi.mock('./plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (
      ...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>
    ) => {
      counts.replacementPreflights += 1
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})

beforeEach(() => {
  counts.fullRuns = 0
  counts.enumerations = 0
  counts.materializers = 0
  counts.replacementPreflights = 0
})

interface CountedDependencies {
  dependencies: PlannerDependencies
  clockCalls: { calls: number }
}

function withCountingClock(dependencies: PlannerDependencies): CountedDependencies {
  const clockCalls = { calls: 0 }
  const inner = dependencies.clock
  return {
    dependencies: {
      ...dependencies,
      clock: {
        now: () => {
          clockCalls.calls += 1
          return inner.now()
        },
      },
    },
    clockCalls,
  }
}

/** Target A: the single Reset at the contested Gogma Counter is its whole Ideal Route. */
function targetA(): TargetWeapon {
  return orchestrationTarget('target.phase6a.a', {
    priority: 5,
    idealSkillCondition: { seriesSkillId: 'series_skill.fixture.z', groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: 'series_skill.fixture.z', groupSkillId: null, matchMode: 'all' },
  })
}

function sourceA() {
  return orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: 'series_skill.fixture.z' })
}

function entryA(target: TargetWeapon): BuildListEntry {
  return orchestrationEntry('build-list.phase6a.a', target, resetRoute(ORCHESTRATION_SOURCE_A), {
    finalBonuses: idealBonuses(),
    seriesSkillId: 'series_skill.fixture.z',
  })
}

/** Reset at the contested Gogma Counter, then the Ideal Skill: an unresolved conflict with Target A. */
function contendingParts() {
  const a = targetA()
  const b = skillConstrainedTarget('target.phase6a.b', { priority: 1 })
  const entryB = orchestrationEntry('build-list.phase6a.b', b, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
    operations: [
      ...resetRoute(ORCHESTRATION_SOURCE_B).operations,
      ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations,
    ],
  }, { finalBonuses: idealBonuses() })
  return {
    targets: [a, b],
    ownedWeapons: [
      sourceA(),
      orchestrationSource(ORCHESTRATION_SOURCE_B, {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: 'series_skill.fixture.b-source',
      }),
    ],
    entries: [entryA(a), entryB],
  }
}

interface ParityCase {
  name: string
  build(): { input: PlannerInput; dependencies: PlannerDependencies; engineCounts?: object }
  expectedFullRuns: number
}

function scenarioCase(
  name: string,
  parts: () => Parameters<typeof orchestrationScenario>[0],
  expectedFullRuns = 1,
): ParityCase {
  return {
    name,
    expectedFullRuns,
    build: () => {
      const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
      const options = parts()
      const built: OrchestrationScenario = orchestrationScenario({
        ...options,
        engine: { ...options.engine, callCounts },
      })
      return { input: built.input, dependencies: built.dependencies, engineCounts: callCounts }
    },
  }
}

const cases: ParityCase[] = [
  scenarioCase('one Target and no conflict', () => {
    const a = targetA()
    return { targets: [a], ownedWeapons: [sourceA()], entries: [entryA(a)] }
  }),
  scenarioCase('an unresolved Gogma Counter conflict (provisional outcome)', contendingParts),
  scenarioCase('an empty Build List (no Plan)', () => ({ targets: [targetA()], ownedWeapons: [sourceA()], entries: [] })),
  {
    name: 'a runtime-unsupported retry inside the initial run',
    expectedFullRuns: 2,
    build: () => {
      const { input, dependencies } = runtimeUnsupportedFixture()
      return { input, dependencies }
    },
  },
]

function ordinaryShape(result: PlannerResult): PlannerResult {
  return {
    plan: result.plan,
    conflicts: result.conflicts,
    warnings: result.warnings,
    termination: result.termination,
  }
}

describe('Phase 6-A: legacy B8 orchestration without an explicit resolution == the ordinary Planner', () => {
  it.each(cases)('$name', async ({ build, expectedFullRuns }) => {
    const legacyBuilt = build()
    const ordinaryBuilt = build()
    expect(legacyBuilt.input.conflictResolutions).toEqual([])
    const legacy = withCountingClock(legacyBuilt.dependencies)
    const ordinary = withCountingClock(ordinaryBuilt.dependencies)

    const legacyResult = await createProductionPlanWithConstrainedSearch(legacyBuilt.input, legacy.dependencies, {
      enumerationBounds: defaultConstrainedEnumerationBounds,
      orchestrationBounds: defaultPlannerOrchestrationBounds,
    })
    const legacyCounts = { ...counts }
    counts.fullRuns = 0
    const ordinaryResult = await createProductionPlan(ordinaryBuilt.input, ordinary.dependencies, undefined)

    // No constrained work ever started on the legacy path.
    expect(legacyCounts).toEqual({
      fullRuns: expectedFullRuns,
      enumerations: 0,
      materializers: 0,
      replacementPreflights: 0,
    })
    expect(legacyResult.generatedBuildListEntries).toEqual([])
    expect(legacyResult.generatedBuildListEntryReplacements).toEqual([])
    expect(legacyResult.warnings.map(({ kind }) => kind)).not.toContain('max_planner_reruns_reached')
    // The ordinary Planner ran the same full runs and produced the same result.
    expect(counts.fullRuns).toBe(expectedFullRuns)
    expect(ordinaryShape(legacyResult)).toEqual(ordinaryShape(ordinaryResult))
    expect(Object.keys(ordinaryResult).sort()).toEqual(['conflicts', 'plan', 'termination', 'warnings'])
    // Same Engine and Clock work: nothing was predicted or materialized beside the run.
    expect(legacyBuilt.engineCounts).toEqual(ordinaryBuilt.engineCounts)
    expect(legacy.clockCalls.calls).toBe(ordinary.clockCalls.calls)
  })

  it('keeps the unresolved conflict and its provisional outcome on both paths', async () => {
    const legacyBuilt = cases[1].build()
    const ordinaryBuilt = cases[1].build()
    const legacyResult = await createProductionPlanWithConstrainedSearch(legacyBuilt.input, legacyBuilt.dependencies, {
      enumerationBounds: defaultConstrainedEnumerationBounds,
      orchestrationBounds: defaultPlannerOrchestrationBounds,
    })
    const ordinaryResult = await createProductionPlan(ordinaryBuilt.input, ordinaryBuilt.dependencies, undefined)

    const conflict = ordinaryResult.conflicts.find(({ kind }) => kind === 'same_gogma_counter')
    expect(conflict).toBeDefined()
    expect(conflict?.selectedBuildListEntryId).toBeNull()
    expect(legacyResult.conflicts).toEqual(ordinaryResult.conflicts)
  })

  it('control: the same counters do see constrained work once an explicit resolution exists', async () => {
    // Proves the instrumentation above observes the legacy path: only an
    // explicit resolution - which neither the Build List nor the replan input
    // ever carries - starts enumeration, materialization and trials.
    const probe = cases[1].build()
    const probeResult = await createProductionPlan(probe.input, probe.dependencies, undefined)
    const conflict = probeResult.conflicts.find(({ kind }) => kind === 'same_gogma_counter')
    if (conflict === undefined) throw new Error('Expected the contended Gogma Counter conflict.')
    const parts = contendingParts()
    const resolved = orchestrationScenario({
      ...parts,
      conflictResolutions: [{ conflictKey: conflict.id, selectedBuildListEntryId: parts.entries[0].id }],
    })
    counts.fullRuns = 0

    // The fixture Engine covers only the fixture's own enumeration extent.
    await createProductionPlanWithConstrainedSearch(resolved.input, resolved.dependencies, {
      enumerationBounds: orchestrationEnumerationBounds(),
      orchestrationBounds: orchestrationBounds(),
    })

    expect(counts.enumerations).toBeGreaterThan(0)
    expect(counts.materializers).toBeGreaterThan(0)
    expect(counts.fullRuns).toBeGreaterThan(1)
  })
})
