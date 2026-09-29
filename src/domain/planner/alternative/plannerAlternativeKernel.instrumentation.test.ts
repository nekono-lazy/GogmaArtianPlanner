import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  belowPracticalBonuses,
  idealBonuses,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  checkpointMixedEntry,
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationResetResultAt,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeapon,
  RestorationBonusSet,
  TargetWeapon,
} from '../../models/publicTypes'
import { candidateStableKey } from '../../search'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelInstrumentation,
  type PlannerAlternativeKernelInstrumentationEvent,
  type PlannerAlternativeKernelOptions,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
} from './plannerAlternativeKernel'

/*
 * Issue #154 Phase 2-C2.6-A2: the optional kernel lifecycle instrumentation is
 * observational only. Every scenario is run twice from fresh, identical
 * fixtures - once without instrumentation, once with it - and the two kernel
 * results must be identical. One test forces a preflight refusal, which no
 * fixture reaches, exactly as the kernel test does.
 */

const forced = vi.hoisted(() => ({ refusePreflights: 0 }))

vi.mock('../replacement/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../replacement/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (
      ...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>
    ) => {
      if (forced.refusePreflights > 0) {
        forced.refusePreflights -= 1
        return { status: 'unresolved', conflictResolutions: [], failures: [] }
      }
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})

beforeEach(() => {
  forced.refusePreflights = 0
})

const TARGET_A = 'target.kernel.a'
const TARGET_B = 'target.kernel.b'
const TARGET_C = 'target.kernel.c'
const SOURCE_C = 'owned.kernel.c'
const ENTRY_A = 'build-list.kernel.a' as BuildListEntryId
const ENTRY_B = 'build-list.kernel.b' as BuildListEntryId
const ENTRY_C = 'build-list.kernel.c' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

interface Parts {
  targets: TargetWeapon[]
  ownedWeapons: OwnedWeapon[]
  entries: BuildListEntry[]
}

function targetA(): TargetWeapon {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
}

/** A and B contend for Gogma 10; with A fixed, B has a resource-aware alternative. */
function parts(): Parts {
  const a = targetA()
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return {
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL }),
    ],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations],
      }),
    ],
  }
}

/** A third participant C that the rerun budget can leave unreached. */
function withRerunStarvedC(): Parts {
  const base = parts()
  const c = skillConstrainedTarget(TARGET_C, { priority: 2 })
  return {
    targets: [...base.targets, c],
    ownedWeapons: [...base.ownedWeapons, orchestrationSource(SOURCE_C, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [...base.entries, orchestrationEntry(ENTRY_C, c, resetRoute(SOURCE_C))],
  }
}

function checkpointParts(): Parts {
  const a = targetA()
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const sourceB = orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: practicalBonuses(), seriesSkillId: SOURCE_B_SKILL })
  return {
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }), sourceB],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      checkpointMixedEntry(ENTRY_B, b, ORCHESTRATION_SOURCE_B, sourceB, { select: true }),
    ],
  }
}

const twoIdeals = (gogmaCounter: number) => (gogmaCounter === 14 ? idealBonuses() : orchestrationResetResultAt(gogmaCounter))
const noIdeal = (gogmaCounter: number) => (gogmaCounter === 10 ? idealBonuses() : practicalBonuses())

function scenario(p: Parts, resetResultAt?: (gogmaCounter: number) => RestorationBonusSet): OrchestrationScenario {
  return orchestrationScenario({
    targets: p.targets,
    ownedWeapons: p.ownedWeapons,
    entries: p.entries.map((entry) => structuredClone(entry)),
    engine: resetResultAt ? { resetResultAt } : undefined,
  })
}

function request(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeKernelRequest> = {}): PlannerAlternativeKernelRequest {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) =>
    kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A))
  if (!conflict) throw new Error('no Gogma conflict with A')
  return {
    plannerInput: built.input,
    decision: { conflictKey: conflict.id, selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 },
    bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
    ...overrides,
  }
}

interface Case {
  name: string
  parts: () => Parts
  resetResultAt?: (gogmaCounter: number) => RestorationBonusSet
  overrides?: Partial<PlannerAlternativeKernelRequest>
  refusePreflights?: number
}

const CASES: Case[] = [
  { name: 'found on the first trial', parts },
  { name: 'a refused preflight, then found', parts, resetResultAt: twoIdeals, refusePreflights: 1 },
  { name: 'the candidate trial bound', parts, resetResultAt: twoIdeals, refusePreflights: 1, overrides: { bounds: { maxCandidateTrialsPerTarget: 1, maxPlannerReruns: 8 } } },
  { name: 'the planner rerun bound', parts: withRerunStarvedC, overrides: { bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 1 } } },
  { name: 'a search extent stop', parts, resetResultAt: noIdeal, overrides: { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 } } },
  { name: 'a checkpoint-blocked Target', parts: checkpointParts },
]

interface Observed {
  events: PlannerAlternativeKernelInstrumentationEvent[]
  searchRequests: [string, number][]
  settledByTarget: Map<string, number>
}

function observingInstrumentation(): { instrumentation: PlannerAlternativeKernelInstrumentation; observed: Observed } {
  const observed: Observed = { events: [], searchRequests: [], settledByTarget: new Map() }
  return {
    observed,
    instrumentation: {
      // A return value is never read: returning something must change nothing.
      onEvent: ((event: PlannerAlternativeKernelInstrumentationEvent) => {
        observed.events.push(structuredClone(event))
        return 'stop'
      }) as unknown as PlannerAlternativeKernelInstrumentation['onEvent'],
      searchInstrumentationForTarget: (targetWeaponId, targetOrdinal) => {
        observed.searchRequests.push([targetWeaponId, targetOrdinal])
        return { onWorkSettled: () => { observed.settledByTarget.set(targetWeaponId, (observed.settledByTarget.get(targetWeaponId) ?? 0) + 1) } }
      },
    },
  }
}

async function runCase(testCase: Case, options: PlannerAlternativeKernelOptions): Promise<PlannerAlternativeKernelResult> {
  const built = scenario(testCase.parts(), testCase.resetResultAt)
  forced.refusePreflights = testCase.refusePreflights ?? 0
  return runPlannerAlternativeKernel(request(built, testCase.overrides), built.dependencies, options)
}

function completed(result: PlannerAlternativeKernelResult) {
  if (result.status !== 'completed') throw new Error(`kernel failed: ${JSON.stringify(result)}`)
  return result
}

const types = (events: readonly PlannerAlternativeKernelInstrumentationEvent[]) => events.map(({ type }) => type)

describe('Planner Alternative kernel instrumentation: semantic neutrality', () => {
  for (const testCase of CASES) {
    it(`returns the identical kernel result with and without instrumentation: ${testCase.name}`, async () => {
      const without = completed(await runCase(testCase, {}))
      const explicitUndefined = completed(await runCase(testCase, { instrumentation: undefined }))
      const { instrumentation, observed } = observingInstrumentation()
      const withObserver = completed(await runCase(testCase, { instrumentation }))
      expect(explicitUndefined).toEqual(without)
      expect(withObserver).toEqual(without)
      // The comparison fields the Research reads, spelled out.
      const view = (result: typeof without) => result.targets.map((target) => ({
        targetWeaponId: target.targetWeaponId,
        outcome: target.outcome.status,
        trials: target.trials,
        generatedSelected: target.outcome.status === 'found' ? target.outcome.generatedSelected : null,
        search: target.search,
      }))
      expect(view(withObserver)).toEqual(view(without))
      expect(withObserver.plannerRerunsUsed).toBe(without.plannerRerunsUsed)
      expect(observed.events.at(-1)).toEqual({
        type: 'kernel_completed', targetCount: without.targets.length, plannerRerunsUsed: without.plannerRerunsUsed,
        budget: { used: without.plannerRerunsUsed, limit: (testCase.overrides?.bounds ?? { maxPlannerReruns: 8 }).maxPlannerReruns },
      })
    })
  }

  it('carries no Candidate, Route, Entry, PlannerResult or timestamp in any event', async () => {
    for (const testCase of CASES) {
      const { instrumentation, observed } = observingInstrumentation()
      await runCase(testCase, { instrumentation })
      for (const event of observed.events) {
        const keys = Object.keys(event)
        expect(keys).not.toEqual(expect.arrayContaining(['candidate']))
        for (const forbidden of ['candidate', 'route', 'entry', 'generated', 'trialResult', 'plan', 'timestamp', 'createdAt', 'elapsedMs']) {
          expect(keys).not.toContain(forbidden)
        }
        expect(JSON.stringify(event).length).toBeLessThan(2000)
      }
    }
  })
})

describe('Planner Alternative kernel instrumentation: lifecycle order', () => {
  it('reports target, search, candidate, trial, preflight, full run, trial, search, target and kernel in order', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    const result = completed(await runCase(CASES[0], { instrumentation }))
    expect(types(observed.events)).toEqual([
      'target_started', 'search_started', 'candidate_delivered', 'trial_started', 'preflight_started', 'preflight_completed',
      'full_planner_run_started', 'full_planner_run_completed', 'trial_completed', 'search_completed', 'target_completed', 'kernel_completed',
    ])
    const [targetStarted] = observed.events
    expect(targetStarted).toEqual({ type: 'target_started', targetWeaponId: TARGET_B, targetOrdinal: 0, targetCount: 1, budget: { used: 0, limit: 8 } })
    const byType = new Map(observed.events.map((event) => [event.type, event]))
    const b = result.targets[0]
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(byType.get('candidate_delivered')).toMatchObject({ deliveryIndex: 0, candidateKey: candidateStableKey(b.outcome.candidate) })
    expect(byType.get('trial_started')).toMatchObject({ trialIndex: 0, candidateKey: b.trials[0].candidateKey })
    expect(byType.get('preflight_completed')).toMatchObject({ status: 'ready' })
    // The rerun budget is read before and after the one full run.
    expect(byType.get('full_planner_run_started')).toMatchObject({ budget: { used: 0, limit: 8 } })
    expect(byType.get('full_planner_run_completed')).toMatchObject({ status: 'completed', budget: { used: 1, limit: 8 } })
    expect(byType.get('trial_completed')).toMatchObject({ result: { status: 'found', generatedSelected: b.outcome.generatedSelected } })
    expect(byType.get('search_completed')).toMatchObject({ deliveredCandidates: b.search?.deliveredCandidates, stoppedByConsumer: true })
    expect(byType.get('target_completed')).toMatchObject({ outcome: 'found' })
  })

  it('reports a refused preflight without a full run, then the next trial', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    await runCase(CASES[1], { instrumentation })
    expect(types(observed.events)).toEqual([
      'target_started', 'search_started',
      'candidate_delivered', 'trial_started', 'preflight_started', 'preflight_completed', 'trial_completed',
      'candidate_delivered', 'trial_started', 'preflight_started', 'preflight_completed',
      'full_planner_run_started', 'full_planner_run_completed', 'trial_completed',
      'search_completed', 'target_completed', 'kernel_completed',
    ])
    const trialsDone = observed.events.filter((event) => event.type === 'trial_completed')
    expect(trialsDone.map((event) => [event.trialIndex, event.result])).toEqual([
      [0, { status: 'rejected', reason: 'preflight_refused' }],
      [1, { status: 'found', generatedSelected: true }],
    ])
    expect(observed.events.filter((event) => event.type === 'preflight_completed').map((event) => event.status)).toEqual(['refused', 'ready'])
  })

  it('reports the candidate trial bound as a delivered but untrialled Candidate', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    const result = completed(await runCase(CASES[2], { instrumentation }))
    expect(result.targets[0].outcome.status).toBe('stopped_by_candidate_trial_bound')
    expect(types(observed.events)).toEqual([
      'target_started', 'search_started',
      'candidate_delivered', 'trial_started', 'preflight_started', 'preflight_completed', 'trial_completed',
      'candidate_delivered', 'search_completed', 'target_completed', 'kernel_completed',
    ])
    expect(observed.events.find((event) => event.type === 'target_completed')).toMatchObject({ outcome: 'stopped_by_candidate_trial_bound' })
  })

  it('reports a Target the rerun budget no longer reaches, with no search', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    const result = completed(await runCase(CASES[3], { instrumentation }))
    const stopped = result.targets.find((target) => target.outcome.status === 'stopped_by_planner_rerun_bound')
    expect(stopped).toBeDefined()
    const events = observed.events.filter((event) => 'targetWeaponId' in event && event.targetWeaponId === stopped?.targetWeaponId)
    expect(types(events)).toEqual(['target_started', 'target_stopped_rerun_bound', 'target_completed'])
    expect(events[1]).toMatchObject({ budget: { used: 1, limit: 1 } })
    // No Search instrumentation was asked for a Target that was never searched.
    expect(observed.searchRequests.map(([id]) => id)).not.toContain(stopped?.targetWeaponId)
    expect(observed.events.filter((event) => event.type === 'target_started').map((event) => event.targetOrdinal)).toEqual(
      result.targets.map((_, index) => index))
  })

  it('reports an extent stop with no trial', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    await runCase(CASES[4], { instrumentation })
    expect(types(observed.events)).toEqual(['target_started', 'search_started', 'search_completed', 'target_completed', 'kernel_completed'])
    expect(observed.events[2]).toMatchObject({ stoppedByExtent: true, stoppedByConsumer: false, deliveredCandidates: 0 })
  })

  it('reports a checkpoint-blocked Target without a search', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    await runCase(CASES[5], { instrumentation })
    expect(types(observed.events)).toEqual(['target_started', 'target_skipped_checkpoint', 'target_completed', 'kernel_completed'])
    expect(observed.events[2]).toMatchObject({ outcome: 'blocked_by_selected_checkpoint' })
    expect(observed.searchRequests).toEqual([])
  })
})

describe('Planner Alternative kernel instrumentation: Search instrumentation per Target', () => {
  it('asks for one Search instrumentation per searched Target, with its ordinal, and hands it to that Search only', async () => {
    const { instrumentation, observed } = observingInstrumentation()
    const result = completed(await runCase({ name: 'two searched Targets', parts: withRerunStarvedC }, { instrumentation }))
    const searched = result.targets.map((target, index) => [target, index] as const).filter(([target]) => target.search !== null)
    expect(observed.searchRequests).toEqual(searched.map(([target, index]) => [target.targetWeaponId, index]))
    for (const [target] of searched) expect(observed.settledByTarget.get(target.targetWeaponId)).toBeGreaterThan(0)
    expect([...observed.settledByTarget.keys()].sort()).toEqual(searched.map(([target]) => target.targetWeaponId).sort())
  })
})

describe('Planner Alternative kernel instrumentation: Production isolation', () => {
  it('is never set by a Production caller', () => {
    const production = import.meta.glob(['../../**/*.ts', '../../../services/**/*.ts', '../../../workers/**/*.ts', '../../../pages/**/*.tsx',
      '../../../components/**/*.tsx', '../../../db/**/*.ts', '!../../**/*.test.ts', '!../../../**/*.test.ts', '!../../../**/*.test.tsx',
      '!../../../workers/*.benchmark.ts'],
    { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    const users = Object.entries(production)
      .filter(([, source]) => /PlannerAlternativeKernelInstrumentation|searchInstrumentationForTarget|onEvent\s*:/.test(source))
      .map(([path]) => path)
    expect(users).toEqual(['./plannerAlternativeKernel.ts'])
    // The one Production kernel caller passes execution options and the shared budget only.
    const scenarioSource = production['./plannerAlternativeScenario.ts']
    expect(scenarioSource).toMatch(/runPreparedPlannerAlternativeKernel\(prepared, request, dependencies, \{\s*executionOptions: options\.executionOptions,\s*fullRunBudget: budget,\s*\}\)/)
  })
})
