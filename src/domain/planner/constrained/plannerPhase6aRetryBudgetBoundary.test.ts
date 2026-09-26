import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConstrainedEnumerationBounds } from '../../search'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../../../test/fixtures/candidateSearch'
import { createValidTargetWeapon, targetWeaponId } from '../../../test/fixtures/domainData'
import {
  createEntry,
  createSource,
  synchronizeEntry,
} from '../../../test/fixtures/plannerRuntimeUnsupported'
import type { TargetWeapon } from '../../models/publicTypes'
import type { RngEngine } from '../../rng/rngEngine'
import type { PlannerDependencies, PlannerInput } from '../plannerTypes'
import { createProductionPlan } from '../productionPlanGeneration'
import { createProductionPlanWithConstrainedSearch } from './plannerConstrainedOrchestration'
import { defaultPlannerOrchestrationBounds } from './plannerOrchestrationBounds'

/**
 * The one observable difference Phase 6-A formalised (`docs/PLANNER_SPEC.md`
 * 9.2.7 / 9.2.19.15), and the reason calculation schema 17 exists.
 *
 * The legacy B8 orchestration counted every full Planner run - the
 * runtime-unsupported retries inside its initial ordinary run included -
 * against `defaultPlannerOrchestrationBounds.maxPlannerReruns = 4`. The
 * ordinary `createPlan()` the Build List and the replan Preview now run has no
 * such budget. So an input that needs a fifth full run stops on the old path
 * with `plan = null` and `max_planner_reruns_reached`, while the new path keeps
 * excluding the unsupported Entries and produces a Plan.
 *
 * Only Trace Replay's verdict is forced here, through this file's own
 * `vi.mock`: the first `forcedUnsupportedRuns` replays report the trace's first
 * Entry as runtime-unsupported, exactly the shape Production Plan generation
 * reacts to. Nothing in the Production Planner, the RNG Engine or the B8
 * orchestration is hooked or changed.
 */

const replay = vi.hoisted(() => ({ forcedUnsupportedRuns: 0, calls: 0 }))

vi.mock('../plannerTraceReplay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plannerTraceReplay')>()
  return {
    ...actual,
    replayPlannerSearchTrace: (...args: Parameters<typeof actual.replayPlannerSearchTrace>) => {
      replay.calls += 1
      const [, bestState] = args
      if (replay.forcedUnsupportedRuns > 0 && bestState.trace.length > 0) {
        replay.forcedUnsupportedRuns -= 1
        return {
          isValid: false,
          drafts: [],
          issues: [],
          unsupportedInput: {
            buildListEntryId: bestState.trace[0].primaryBuildListEntryId,
            operationType: 'skill',
            reason: 'reference_adapter_unsupported',
            actionIndex: 0,
          },
        }
      }
      return actual.replayPlannerSearchTrace(...args)
    },
  }
})

beforeEach(() => {
  replay.forcedUnsupportedRuns = 0
  replay.calls = 0
})

const TARGET_COUNT = 6

/**
 * Six Targets whose one-operation Reset Skills Routes all contend for the same
 * Skill Counter position, with distinct priorities: every run commits the
 * highest-priority remaining Entry, so each forced exclusion makes the next run
 * select a different Entry, and a run always has a trace to replay.
 */
function contendedInput(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const searchInput = createCandidateSearchInput()
  const priorities: TargetWeapon['priority'][] = [5, 4, 3, 2, 1, 1]
  const targets: TargetWeapon[] = Array.from({ length: TARGET_COUNT }, (_, index) => ({
    ...createValidTargetWeapon(),
    id: targetWeaponId(`target.retry.${index}`),
    name: `Retry ${index}`,
    priority: priorities[index],
  }))
  const sources = targets.map((target, index) => createSource(`retry.${index}`, target))
  const entries = targets.map((target, index) => createEntry(`retry.${index}`, target, sources[index]))
  const baseEngine = createCandidateSearchEngine(searchInput)
  const engine: RngEngine = {
    version: baseEngine.version,
    capabilities: { ...baseEngine.capabilities },
    getPredictionSupport: baseEngine.getPredictionSupport.bind(baseEngine),
    normalizeSeed: baseEngine.normalizeSeed.bind(baseEngine),
    predictGogmaBonus: baseEngine.predictGogmaBonus.bind(baseEngine),
    predictSkills: () => ({ seriesSkillId: 'series_skill.fixture.a', groupSkillId: null }),
    predictNormalArtian: baseEngine.predictNormalArtian.bind(baseEngine),
    advanceGogmaCounter: baseEngine.advanceGogmaCounter.bind(baseEngine),
    advanceSkillCounter: baseEngine.advanceSkillCounter.bind(baseEngine),
    advanceNormalCounter: baseEngine.advanceNormalCounter.bind(baseEngine),
  }
  const input: PlannerInput = {
    rngState: structuredClone(searchInput.rngState),
    normalCounters: structuredClone(searchInput.normalCounters),
    ownedWeapons: sources,
    targetWeapons: targets,
    buildListEntries: entries,
    calculationContext: { ...structuredClone(searchInput.calculationContext), rngEngineVersion: engine.version },
    options: { maxPlanSteps: 300 },
    master: structuredClone(searchInput.master),
    conflictResolutions: [],
  }
  entries.forEach((entry, index) => synchronizeEntry(input, entry, targets[index]))
  let planId = 0
  let stepId = 0
  let ownedId = 0
  return {
    input,
    dependencies: {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => `plan.retry.${++planId}` as never,
        planStepId: () => `step.retry.${++stepId}` as never,
        ownedWeaponId: () => `owned.retry.created.${++ownedId}` as never,
      },
      clock: { now: () => '2026-09-27T00:00:00.000Z' },
    },
  }
}

async function runLegacy(forced: number) {
  const { input, dependencies } = contendedInput()
  replay.forcedUnsupportedRuns = forced
  replay.calls = 0
  const result = await createProductionPlanWithConstrainedSearch(input, dependencies, {
    enumerationBounds: defaultConstrainedEnumerationBounds,
    orchestrationBounds: defaultPlannerOrchestrationBounds,
  })
  return { result, replays: replay.calls }
}

async function runOrdinary(forced: number) {
  const { input, dependencies } = contendedInput()
  replay.forcedUnsupportedRuns = forced
  replay.calls = 0
  const result = await createProductionPlan(input, dependencies, undefined)
  return { result, replays: replay.calls }
}

const kinds = (warnings: readonly { kind: string }[]) => warnings.map(({ kind }) => kind)

describe('Phase 6-A: the legacy B8 retry budget the ordinary Planner no longer has (schema 17)', () => {
  it('uses the Production legacy budget of 4 full runs', () => {
    expect(defaultPlannerOrchestrationBounds.maxPlannerReruns).toBe(4)
  })

  it('agrees while the retries fit in 4 full runs (3 runtime-unsupported Entries)', async () => {
    const legacy = await runLegacy(3)
    const ordinary = await runOrdinary(3)

    expect(legacy.replays).toBe(4)
    expect(ordinary.replays).toBe(4)
    expect(legacy.result.plan).not.toBeNull()
    expect(kinds(legacy.result.warnings)).not.toContain('max_planner_reruns_reached')
    expect(legacy.result.plan).toEqual(ordinary.result.plan)
    expect(legacy.result.warnings).toEqual(ordinary.result.warnings)
    expect(legacy.result.termination).toEqual(ordinary.result.termination)
  })

  it('differs once a fifth full run is needed (4 runtime-unsupported Entries)', async () => {
    const legacy = await runLegacy(4)
    const ordinary = await runOrdinary(4)

    // The old path: 4 full runs, the fifth refused by the orchestration budget.
    expect(legacy.replays).toBe(4)
    expect(legacy.result.plan).toBeNull()
    expect(kinds(legacy.result.warnings)).toContain('max_planner_reruns_reached')
    expect(legacy.result.generatedBuildListEntries).toEqual([])

    // The new path: it keeps excluding the unsupported Entries and plans on the fifth run.
    expect(ordinary.replays).toBe(5)
    expect(ordinary.result.plan).not.toBeNull()
    expect(kinds(ordinary.result.warnings)).not.toContain('max_planner_reruns_reached')
    expect(kinds(ordinary.result.warnings).filter((kind) => kind === 'rng_prediction_unsupported')).toHaveLength(4)
    const selected = ordinary.result.plan?.selectedBuildListEntryIds ?? []
    expect(selected).toHaveLength(1)
    expect(ordinary.result.plan?.rejectedBuildListEntries.map(({ buildListEntryId }) => buildListEntryId))
      .not.toContain(selected[0])
  })
})
