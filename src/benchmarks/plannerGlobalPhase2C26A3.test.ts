import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
} from '../domain/planner/alternative'
import type { BuildListEntryId, TargetWeapon, TargetWeaponId } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchInput,
} from '../domain/search'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimeEvent } from '../domain/search/bonusStream'
import { idealBonuses, belowPracticalBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { createCountingRngEngine } from './plannerAlternativeBenchmarkInstrumentation'
import { createIssue101NoIdealSearchInput, createLongHeldFixture } from './plannerAlternativeBenchmarkFixtures'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import {
  createPhase2C26A3KernelProgress,
  createPhase2C26A3RuntimeTracker,
  isPhase2C26A3Primary,
  parsePhase2C26A2ResultAuthority,
  PHASE2C26A3_CONCURRENCY,
  selectPhase2C26A3Tasks,
  validatePhase2C26A3ConditionParity,
  validatePhase2C26A3Selection,
  type Phase2C26A3DepthRecord,
  type Phase2C26A3PhaseStartRecord,
} from './plannerGlobalPhase2C26A3'
import { analyzePhase2C26A3Kernel, phase2c26a3Decision, summarizePhase2C26A3 } from './plannerGlobalPhase2C26A3Analysis'

/*
 * Issue #154 Phase 2-C2.6-A3. The held-aware Gogma section-boundary observer is observational only: with and without it
 * the delivered Candidates, the Search summary, the prediction calls and the kernel result are identical. Its event
 * contract (pairing, no overlap, section order, ascending depth, nothing after a closed stream) is fixed here, and the
 * committed A2 / C2.6-A RESULTs are read as the fail-closed selection / parity authorities. No duration is asserted.
 */

const SLOW = 180_000

// ---------------------------------------------------------------- Search level

function searchWorkloads(): Array<[string, PlannerAlternativeSearchInput, number | null]> {
  return [
    ['no-Ideal, empty reservation', createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 12, maxSkillAdvance: 2 }), null],
    ['long Gogma held', createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, 12],
    ['long Gogma held / blocked', createLongHeldFixture('long_gogma_held', { heldLength: 4, heldMode: 'held_blocked' }, { maxNormalAdvance: 1, maxGogmaAdvance: 10, maxSkillAdvance: 1 }).input, null],
  ]
}

async function runSearch(input: PlannerAlternativeSearchInput, stopAfter: number | null, observe: ((event: ReservedGogmaRuntimeEvent) => unknown) | null) {
  const counting = createCountingRngEngine(new ProductionRngEngine())
  const keys: string[] = []
  const execution = await visitPlannerAlternativeCandidates(
    structuredClone(input),
    counting.engine,
    (candidate) => {
      keys.push(candidateStableKey(candidate))
      return stopAfter !== null && keys.length >= stopAfter ? 'stop' : 'continue'
    },
    observe === null ? {} : { instrumentation: { onGogmaReservedRuntime: observe as (event: ReservedGogmaRuntimeEvent) => void } },
  )
  return { keys, execution, counts: counting.counts() }
}

/** The contract every observed sequence must satisfy; returns the violations (empty = valid). */
function contractViolations(events: readonly ReservedGogmaRuntimeEvent[]): string[] {
  const issues: string[] = []
  let depth: { stream: number; depth: number; phases: string[] } | null = null
  let phase: string | null = null
  const lastDepth = new Map<number, number>()
  const closed = new Set<number>()
  for (const [index, event] of events.entries()) {
    const at = `#${index} ${event.type} s${event.streamIndex}/d${event.depth}`
    if (closed.has(event.streamIndex)) issues.push(`${at}: after the stream closed`)
    switch (event.type) {
      case 'depth_started':
        if (depth !== null) issues.push(`${at}: nested depth`)
        if (event.depth !== (lastDepth.get(event.streamIndex) ?? 0) + 1) issues.push(`${at}: depth not ascending by one`)
        lastDepth.set(event.streamIndex, event.depth)
        depth = { stream: event.streamIndex, depth: event.depth, phases: [] }
        break
      case 'phase_started':
        if (phase !== null) issues.push(`${at}: overlaps ${phase}`)
        if (depth === null || depth.stream !== event.streamIndex || depth.depth !== event.depth) issues.push(`${at}: outside its depth`)
        phase = event.phase
        depth?.phases.push(event.phase)
        break
      case 'phase_completed':
        if (phase !== event.phase) issues.push(`${at}: completes ${event.phase} but ${String(phase)} is active`)
        if (depth === null || depth.stream !== event.streamIndex || depth.depth !== event.depth) issues.push(`${at}: outside its depth`)
        phase = null
        break
      case 'depth_completed': {
        if (phase !== null) issues.push(`${at}: ${phase} still active`)
        if (depth === null || depth.stream !== event.streamIndex || depth.depth !== event.depth) issues.push(`${at}: without its start`)
        // Sections run in the registered order; an empty depth stops after state_generation.
        const order = depth?.phases ?? []
        const full = [...RESERVED_GOGMA_RUNTIME_PHASES]
        const emptyDepth = full.slice(0, 3)
        const noScan = full.slice(0, 5)
        if (order.length > 0 && !([full, emptyDepth, noScan].some(expected => JSON.stringify(expected) === JSON.stringify(order)))) {
          issues.push(`${at}: section order ${order.join(',')}`)
        }
        if (event.exhausted) closed.add(event.streamIndex)
        depth = null
        break
      }
    }
  }
  if (phase !== null || depth !== null) issues.push('a section or depth is left open at the end')
  return issues
}

describe('held-aware Gogma runtime observer: semantic neutrality', () => {
  it('changes no delivered key sequence, Search summary or prediction call count', async () => {
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const plain = await runSearch(input, stopAfter, null)
      const events: ReservedGogmaRuntimeEvent[] = []
      // A return value is never read: returning something must change nothing.
      const observed = await runSearch(input, stopAfter, (event) => { events.push(structuredClone(event)); return 'stop' })
      expect(observed.keys, label).toEqual(plain.keys)
      expect(observed.execution, label).toEqual(plain.execution)
      expect(observed.counts, label).toEqual(plain.counts)
      expect(events.length, label).toBeGreaterThan(0)
    }
  }, SLOW)

  it('reports boundaries in the registered contract, with the counts known at each boundary and no timestamp', async () => {
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const events: ReservedGogmaRuntimeEvent[] = []
      await runSearch(input, stopAfter, (event) => { events.push(structuredClone(event)) })
      // A consumer stop may leave no depth open: every read completes before the next composition is delivered.
      expect(contractViolations(events), label).toEqual([])
      for (const event of events) {
        expect(Object.keys(event).sort(), label).toEqual(
          (event.type === 'phase_started' || event.type === 'phase_completed' ? ['counts', 'depth', 'phase', 'startGogmaCounter', 'streamIndex', 'type']
            : event.type === 'depth_completed' ? ['counts', 'depth', 'exhausted', 'startGogmaCounter', 'streamIndex', 'type']
              : ['counts', 'depth', 'startGogmaCounter', 'streamIndex', 'type']))
        if (event.type === 'phase_completed' && event.phase === 'window_collection') expect(event.counts.legalPositionCount, label).not.toBeNull()
        if (event.type === 'phase_completed' && event.phase === 'state_generation') expect(event.counts.generatedStates, label).not.toBeNull()
        if (event.type === 'phase_completed' && event.phase === 'frontier_reduction_sort') expect(event.counts.frontierStatesAfter, label).not.toBeNull()
        if (event.type === 'phase_started' && event.phase === 'window_collection') expect(event.counts.legalPositionCount, label).toBeNull()
      }
      const depthsDone = events.filter((event) => event.type === 'depth_completed')
      expect(depthsDone.length, label).toBeGreaterThan(0)
      // generated = 0 exactly for the depth that stops after state_generation.
      for (const done of depthsDone) {
        const completedSections = events.filter((event) => event.type === 'phase_completed' && event.streamIndex === done.streamIndex && event.depth === done.depth)
        if (done.counts.generatedStates === 0) expect(done.exhausted, label).toBe(true)
        if (completedSections.length > 0 && done.counts.generatedStates !== null && done.counts.generatedStates > 0) {
          expect(completedSections.map((event) => event.type === 'phase_completed' && event.phase), label).toContain('frontier_reduction_sort')
        }
      }
    }
  }, SLOW)

  it('stops reporting a depth that throws (cancellation) and reports nothing after', async () => {
    const [, input] = searchWorkloads()[2]
    const events: ReservedGogmaRuntimeEvent[] = []
    await expect(visitPlannerAlternativeCandidates(structuredClone(input), new ProductionRngEngine(), () => 'continue', {
      shouldCancel: () => events.some((event) => event.type === 'phase_started' && event.phase === 'state_generation'),
      instrumentation: { onGogmaReservedRuntime: (event) => { events.push(structuredClone(event)) } },
    })).rejects.toThrow()
    const last = events.at(-1)
    expect(last?.type).toBe('phase_started')
    expect(last?.type === 'phase_started' && last.phase).toBe('state_generation')
  }, SLOW)
})

// ---------------------------------------------------------------- tracker

describe('Phase 2-C2.6-A3 runtime tracker', () => {
  const counts = { frontierStatesBefore: 1, legalPositionCount: null, generatedStates: null, frontierStatesAfter: null, windowMemoEntries: 0 }
  const base = { streamIndex: 0, startGogmaCounter: 55, counts }

  function drive(sequence: Array<[number, ReservedGogmaRuntimeEvent]>) {
    let clock = 0
    const phases: Phase2C26A3PhaseStartRecord[] = [], depths: Phase2C26A3DepthRecord[] = []
    const tracker = createPhase2C26A3RuntimeTracker({ now: () => clock, origin: () => 0, emitPhaseStarted: r => phases.push(r), emitDepth: r => depths.push(r) })
    const observe = tracker.observerForTarget(0)
    for (const [at, event] of sequence) { clock = at; observe(event) }
    return { tracker, phases, depths, setClock: (at: number) => { clock = at } }
  }

  it('attributes exclusive section wall time, keeps the inclusive depth time apart and reports the active section', () => {
    const { tracker, phases, depths, setClock } = drive([
      [0, { type: 'depth_started', depth: 1, ...base }],
      [1, { type: 'phase_started', phase: 'window_collection', depth: 1, ...base }],
      [3, { type: 'phase_completed', phase: 'window_collection', depth: 1, ...base }],
      [3, { type: 'phase_started', phase: 'support_evaluation', depth: 1, ...base }],
      [4, { type: 'phase_completed', phase: 'support_evaluation', depth: 1, ...base }],
      [4, { type: 'phase_started', phase: 'state_generation', depth: 1, ...base }],
      [14, { type: 'phase_completed', phase: 'state_generation', depth: 1, ...base }],
      [14, { type: 'phase_started', phase: 'solution_materialization', depth: 1, ...base }],
      [20, { type: 'phase_completed', phase: 'solution_materialization', depth: 1, ...base }],
      [20, { type: 'phase_started', phase: 'frontier_reduction_sort', depth: 1, ...base }],
      [25, { type: 'phase_completed', phase: 'frontier_reduction_sort', depth: 1, ...base }],
      [25, { type: 'phase_started', phase: 'exhaustion_scan', depth: 1, ...base }],
      [26, { type: 'phase_completed', phase: 'exhaustion_scan', depth: 1, ...base }],
      [27, { type: 'depth_completed', exhausted: false, depth: 1, ...base }],
      [30, { type: 'depth_started', depth: 2, ...base }],
      [31, { type: 'phase_started', phase: 'window_collection', depth: 2, ...base }],
    ])
    expect(phases.map(p => p.phase)).toEqual([...RESERVED_GOGMA_RUNTIME_PHASES, 'window_collection'])
    expect(depths).toHaveLength(1)
    expect(depths[0]).toMatchObject({ depth: 1, inclusiveMs: 27, phaseMs: { window_collection: 2, support_evaluation: 1, state_generation: 10, solution_materialization: 6, frontier_reduction_sort: 5, exhaustion_scan: 1 } })
    setClock(40)
    const snapshot = tracker.snapshot()
    expect(snapshot.byTarget[0].phaseTotalsMs).toEqual({ window_collection: 2, support_evaluation: 1, state_generation: 10, solution_materialization: 6, frontier_reduction_sort: 5, exhaustion_scan: 1 })
    expect(snapshot.byTarget[0]).toMatchObject({ completedDepths: 1, inclusiveDepthMs: 27, maxDepthReached: 2, streams: 1 })
    expect(snapshot.activePhase).toEqual({ targetOrdinal: 0, streamIndex: 0, depth: 2, phase: 'window_collection', startedMs: 31, elapsedMs: 9 })
    expect(snapshot.activeDepth).toMatchObject({ depth: 2, startedMs: 30, elapsedMs: 10 })
    expect(snapshot.contractViolations).toBe(0)
  })

  it('counts contract violations instead of throwing', () => {
    const { tracker } = drive([
      [0, { type: 'phase_completed', phase: 'state_generation', depth: 1, ...base }],
      [1, { type: 'depth_started', depth: 2, ...base }],
      [2, { type: 'phase_started', phase: 'window_collection', depth: 2, ...base }],
      [3, { type: 'phase_started', phase: 'support_evaluation', depth: 2, ...base }],
      [4, { type: 'depth_completed', exhausted: true, depth: 2, ...base }],
      [5, { type: 'depth_started', depth: 3, ...base }],
    ])
    const snapshot = tracker.snapshot()
    expect(snapshot.contractViolations).toBeGreaterThanOrEqual(5)
  })

  it('stamps nothing from the stream: the event carries no time', () => {
    for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) expect(phase).toMatch(/^[a-z_]+$/)
    expect(bonusStreamSource).not.toMatch(/performance\.now|Date\.now|process\.hrtime|new Date\(/)
  })
})

// ---------------------------------------------------------------- kernel level

const TARGET_A = 'target.a3.a'
const TARGET_B = 'target.a3.b' as TargetWeaponId
const ENTRY_A = 'build-list.a3.a' as BuildListEntryId
const ENTRY_B = 'build-list.a3.b' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function kernelScenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return orchestrationScenario({
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
  })
}

function kernelRequest(built: ReturnType<typeof kernelScenario>, extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }): PlannerAlternativeKernelRequest {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) => kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A))
  if (!conflict) throw new Error('no Gogma conflict with A')
  return {
    plannerInput: built.input, decision: { conflictKey: conflict.id, selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [], priorExcludedRoutes: [], extent, bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
  }
}

describe('Phase 2-C2.6-A3 kernel progress: semantic neutrality', () => {
  it('returns the identical kernel result with and without the A3 instrumentation, and attaches only the boundary observer', async () => {
    for (const extent of [{ maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 }]) {
      const plainBuilt = kernelScenario()
      const plain: PlannerAlternativeKernelResult = await runPlannerAlternativeKernel(kernelRequest(plainBuilt, extent), plainBuilt.dependencies, {})
      let clock = 0
      const lifecycle: unknown[] = [], depths: Phase2C26A3DepthRecord[] = []
      const progress = createPhase2C26A3KernelProgress({ now: () => (clock += 1), predictionCounts: () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }),
        emitLifecycle: r => lifecycle.push(r), emitPhaseStarted: () => undefined, emitDepth: r => depths.push(r) })
      progress.start()
      const handed = progress.instrumentation.searchInstrumentationForTarget?.(TARGET_B, 0)
      expect(Object.keys(handed ?? {})).toEqual(['onGogmaReservedRuntime'])
      const observedBuilt = kernelScenario()
      const observed = await runPlannerAlternativeKernel(kernelRequest(observedBuilt, extent), observedBuilt.dependencies, { instrumentation: progress.instrumentation })
      expect(observed).toEqual(plain)
      if (plain.status !== 'completed' || observed.status !== 'completed') throw new Error('kernel failed')
      expect(observed.plannerRerunsUsed).toBe(plain.plannerRerunsUsed)
      expect(observed.targets.map(t => [t.outcome.status, t.trials, t.search])).toEqual(plain.targets.map(t => [t.outcome.status, t.trials, t.search]))
      expect(lifecycle.length).toBeGreaterThan(0)
      const heartbeat = progress.heartbeat()
      expect(heartbeat.gogmaRuntime.contractViolations).toBe(0)
      expect(heartbeat.gogmaRuntime.byTarget.length).toBeGreaterThan(0)
      expect(depths.length).toBeGreaterThan(0)
    }
  }, SLOW)
})

// ---------------------------------------------------------------- authorities

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a)
const a2Json = JSON.parse(rawA2)
let c26aSha = ''
beforeAll(async () => { c26aSha = await sha256Hex(rawC26a) })

function c26aAuthority(): Phase2C26A2Authority {
  const parsed = parsePhase2C26AAuthority(c26aJson)
  if (!parsed.authority) throw new Error(parsed.issues.join('; '))
  return parsed.authority
}

describe('Phase 2-C2.6-A2 RESULT as the selection authority', () => {
  it('accepts the committed formal A2 RESULT made against the committed C2.6-A RESULT and derives the primaries by rule', () => {
    const c26a = c26aAuthority()
    const parsed = parsePhase2C26A2ResultAuthority(a2Json, c26aSha, c26a)
    expect(parsed.issues).toEqual([])
    const primaries = parsed.authority?.primaryOrientationIds ?? []
    expect(primaries).toHaveLength(3)
    // Evidence check (not a source constant): the rule picks these rows of the committed A2 RESULT.
    expect(primaries).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    for (const row of parsed.authority?.rows ?? []) expect(primaries.includes(row.orientationId)).toBe(isPhase2C26A3Primary(row))
  })

  it('fails closed on a non-formal A2, another C2.6-A file, another next case or a row that changes the primary count', () => {
    const c26a = c26aAuthority()
    const mutate = (edit: (json: typeof a2Json) => void) => { const json = structuredClone(a2Json); edit(json); return parsePhase2C26A2ResultAuthority(json, c26aSha, c26a) }
    expect(parsePhase2C26A2ResultAuthority(a2Json, '0'.repeat(64), c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.conclusion.next.case = 'mixed' }).valid).toBe(false)
    expect(mutate(json => { json.summary.resultClass.timeout_in_search = 8 }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.out_of_memory = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation.push(json.perOrientation[0]) }).valid).toBe(false)
    const extra = mutate(json => {
      const row = json.perOrientation.find((r: { orientationId: string }) => r.orientationId === 'c20-p1')
      Object.assign(row.counters, { startedTargets: 1, completedTargets: 0, trialsStarted: 0, fullPlannerRunsStarted: 0 })
      row.activeTargetOrdinal = 0
    })
    expect(extra.valid).toBe(false)
    expect(extra.issues.join(';')).toMatch(/derives 4 primaries/)
  })
})

describe('Phase 2-C2.6-A3 selection and condition parity', () => {
  const c26a = c26aAuthority()
  const primaries = ['c6-p1', 'c13-p1', 'c14-p0']
  const orientation = (id: string) => structuredClone(c26a.orientations.find(o => o.orientationId === id) as Phase2C2Orientation)

  it('accepts exactly the primaries and rejects missing, duplicate, foreign, non-primary and metadata-changed orientations', () => {
    expect(validatePhase2C26A3Selection(primaries.map(orientation), primaries, c26a).valid).toBe(true)
    expect(validatePhase2C26A3Selection(primaries.slice(0, 2).map(orientation), primaries, c26a).missing).toEqual(['c14-p0'])
    expect(validatePhase2C26A3Selection([...primaries, 'c6-p1'].map(orientation), primaries, c26a).duplicate).toEqual(['c6-p1'])
    expect(validatePhase2C26A3Selection([...primaries.map(orientation), { ...orientation('c6-p1'), orientationId: 'c99-p0' }], primaries, c26a).foreign).toEqual(['c99-p0'])
    expect(validatePhase2C26A3Selection([...primaries, 'c13-p0'].map(orientation), primaries, c26a).notPrimary).toEqual(['c13-p0'])
    const changed = primaries.map(orientation)
    changed[0].fixedBuildListEntryId = 'build-list.other' as BuildListEntryId
    expect(validatePhase2C26A3Selection(changed, primaries, c26a).metadataMismatches).toEqual([{ orientationId: 'c6-p1', fields: ['fixedBuildListEntryId'] }])
    const tasks = c26a.orientations.map(o => ({ orientation: o, conditions: {} as never }))
    expect(selectPhase2C26A3Tasks(tasks, primaries).map(t => t.orientation.orientationId)).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
  })

  it('requires every C2.6-A condition except the concurrency, which must be 1, and the A2 conditions to be C2.6-A\'s', () => {
    const current = { ...c26a.conditions, concurrency: PHASE2C26A3_CONCURRENCY } as Phase2C26A2RunConditions
    const parity = validatePhase2C26A3ConditionParity(current, c26a, a2Json.conditions)
    expect(parity.issues).toEqual([])
    expect(parity.checks.find(check => check.condition === 'concurrency')).toMatchObject({ current: 1, authority: 3, matches: true })
    expect(validatePhase2C26A3ConditionParity({ ...current, concurrency: 3 }, c26a, a2Json.conditions).issues).toEqual(['concurrency differs'])
    expect(validatePhase2C26A3ConditionParity({ ...current, childHeapLimitMb: 4096 }, c26a, a2Json.conditions).issues).toEqual(['childHeapLimitMb differs'])
    expect(validatePhase2C26A3ConditionParity({ ...current, orientationBudgetMs: 60_000 }, c26a, a2Json.conditions).issues).toEqual(['orientationBudgetMs differs'])
    expect(validatePhase2C26A3ConditionParity(current, c26a, { ...a2Json.conditions, extent: { maxNormalAdvance: 5 } }).issues).toEqual(['a2.extent differs'])
  })
})

// ---------------------------------------------------------------- post-hoc analysis

describe('Phase 2-C2.6-A3 analysis: coverage and the pre-registered decision rule', () => {
  const phaseTotals = (dominant: string, dominantMs: number, restMs: number) =>
    Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(phase => [phase, phase === dominant ? dominantMs : restMs]))

  /** A synthetic killed kernel child: search started at 1000 ms, last heartbeat at 101000 ms. */
  function killedKernel(id: string, dominant: string, dominantMs: number, activePhase: string | null) {
    const lifecycle = (seq: number, type: string, elapsedMs: number) => ({ kind: 'lifecycle', seq, elapsedMs, predictionCounts: {}, search: null, searchDepths: null,
      event: { type, targetWeaponId: 'target.x', targetOrdinal: 0, targetCount: 1, budget: { used: 0, limit: 8 } } })
    const depth = { kind: 'gogma_depth', seq: 1, targetOrdinal: 0, streamIndex: 0, startGogmaCounter: 55, depth: 1, exhausted: false,
      counts: { frontierStatesBefore: 1, legalPositionCount: 3, generatedStates: 10, frontierStatesAfter: 5, windowMemoEntries: 1 },
      phaseMs: phaseTotals(dominant, dominantMs, 10), inclusiveMs: dominantMs + 50, startedMs: 2000, completedMs: 2000 + dominantMs + 50 }
    const started = { kind: 'gogma_phase_started', seq: 2, elapsedMs: 99000, targetOrdinal: 0, streamIndex: 0, depth: 2, phase: activePhase ?? 'state_generation' }
    return {
      orientationId: id,
      task: { orientation: { orientationId: id, kind: 'same_gogma_counter', fixedTargetWeaponId: 'target.f', participantTargetWeaponIds: ['target.f', 'target.x'] } },
      process: { outcome: 'timeout', killedAtMs: 103000, ipc: { kernelInvoked: { originChildProcessMs: 500 }, minClockOffsetMs: 20 } },
      events: [lifecycle(1, 'target_started', 900), lifecycle(2, 'search_started', 1000)],
      heartbeats: [{ kind: 'heartbeat', elapsedMs: 101000, activeTarget: { targetOrdinal: 0 }, gogmaRuntime: {
        byTarget: [{ targetOrdinal: 0, phaseTotalsMs: phaseTotals(dominant, dominantMs, 10), completedDepths: 1, inclusiveDepthMs: dominantMs + 50, maxDepthReached: 2, streams: 1 }],
        activePhase: activePhase === null ? null : { targetOrdinal: 0, streamIndex: 0, depth: 2, phase: activePhase, startedMs: 99000, elapsedMs: 2000 },
        activeDepth: activePhase === null ? null : { targetOrdinal: 0, streamIndex: 0, depth: 2, startedMs: 98990, elapsedMs: 2010, phaseMs: {} },
        contractViolations: 0 } }],
      runtime: activePhase === null ? [depth] : [depth, started],
    }
  }

  it('computes coverage at the last heartbeat, including the active section, and reads the section active at the kill', () => {
    const row = analyzePhase2C26A3Kernel(killedKernel('c1-p0', 'state_generation', 90_000, 'state_generation'), value => value)
    const search = row.primarySearch
    expect(search).not.toBeNull()
    expect(search?.observationPoint).toBe('last_heartbeat')
    expect(search?.searchWallMs).toBe(100_000)
    // 90 000 + 5 * 10 + 2 000 active.
    expect(search?.measuredGogmaMs).toBe(92_050)
    expect(search?.coverage).toBeCloseTo(0.9205)
    expect(search?.dominantPhase).toBe('state_generation')
    expect(search?.activeAtObservation).toEqual({ streamIndex: 0, depth: 2, phase: 'state_generation', elapsedMs: 2000 })
    // Kill at parent 103 000 -> kernel elapsed 103 000 - 500 - 20 = 102 480.
    expect(search?.searchWallAtKillEstimateMs).toBeCloseTo(101_480)
    expect(row.activeAtEnd).toMatchObject({ where: 'section', phase: 'state_generation', depth: 2 })
    expect(row.activeAtEnd.elapsedAtKillEstimateMs).toBeCloseTo(3480)
    const between = analyzePhase2C26A3Kernel(killedKernel('c1-p1', 'state_generation', 90_000, null), value => value)
    expect(between.activeAtEnd).toMatchObject({ where: 'between_depths', depth: 1, phase: null })
  })

  it('decides G, R and M exactly by the registered rule', () => {
    const rows = (specs: Array<[string, number]>) => specs.map(([dominant, ms], index) =>
      analyzePhase2C26A3Kernel(killedKernel(`c${index}-p0`, dominant, ms, null), value => value))
    expect(phase2c26a3Decision(rows([['state_generation', 95_000], ['state_generation', 90_000], ['frontier_reduction_sort', 20_000]])))
      .toMatchObject({ case: 'G_gogma_phase_dominant', dominantPhase: 'state_generation', dominantPhaseConsistentAcrossPrimaries: false })
    expect(phase2c26a3Decision(rows([['solution_materialization', 95_000], ['solution_materialization', 90_000], ['solution_materialization', 85_000]])))
      .toMatchObject({ case: 'G_gogma_phase_dominant', dominantPhase: 'solution_materialization', dominantPhaseConsistentAcrossPrimaries: true })
    expect(phase2c26a3Decision(rows([['state_generation', 50_000], ['state_generation', 60_000], ['state_generation', 95_000]])))
      .toMatchObject({ case: 'R_gogma_does_not_explain', dominantPhase: null })
    expect(phase2c26a3Decision(rows([['state_generation', 95_000], ['frontier_reduction_sort', 90_000], ['state_generation', 30_000]])))
      .toMatchObject({ case: 'M_mixed', dominantPhase: null })
    expect(phase2c26a3Decision(rows([['state_generation', 95_000], ['state_generation', 90_000]]))).toMatchObject({ case: 'M_mixed', recommendation: 'fail closed: no decision' })
  })

  it('summarizes exclusive section totals without double counting the inclusive depth time', () => {
    const rows = [analyzePhase2C26A3Kernel(killedKernel('c1-p0', 'state_generation', 90_000, 'state_generation'), value => value)]
    const summary = summarizePhase2C26A3(rows)
    expect(summary.measuredGogmaMs).toBe(92_050)
    expect(Object.values(summary.phaseTotalsMs).reduce((a, b) => a + b, 0)).toBe(92_050)
    expect(rows[0].primarySearch?.inclusiveDepthReadMs).toBe(90_050 + 2010)
  })
})
