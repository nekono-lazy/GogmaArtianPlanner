import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { stableStringify } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { belowPracticalBonuses, idealBonuses } from '../test/fixtures/constrainedEnumeration'
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
import { createPhase2C25BController } from '../workers/plannerGlobalPhase2C25B.worker.benchmark'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { derivePhase2C25APreSearchContexts, runPhase2C25ASearchOnly } from './plannerGlobalPhase2C25A'
import { derivePhase2C25BContexts } from './plannerGlobalPhase2C25B'
import {
  analyzePhase2C25B,
  mergePhase2C25BRun,
  phase2c25bLostDuringSearchBeforeFirstCandidate,
  phase2c25bPairClassification,
  phase2c25bWorkerHeapLimitStatement,
  type Phase2C25BExternalEvidence,
  type Phase2C25BExternalRun,
  type Phase2C25BPageExport,
} from './plannerGlobalPhase2C25BAnalysis'
import { comparePhase2C25BContextParity, parsePhase2C25BEvidence, phase2c25bRangeReservation, phase2c25bWorkload } from './plannerGlobalPhase2C25BEvidence'
import { createPhase2C25BRunner, phase2c25bRepeatDecision, PHASE2C25B_RELAY_PREFIX, type Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import {
  PHASE2C25B_CANDIDATE_STOP_BOUND,
  type Phase2C25BResponse,
  type Phase2C25BSearchRecord,
} from './plannerGlobalPhase2C25BProtocol'

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha256Bytes = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))
const sha256 = async (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer as ArrayBuffer)
const EXPORT_BYTES = new TextEncoder().encode('{"synthetic":"export"}').buffer as ArrayBuffer

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c25b.a'
const ENTRY_B = 'build-list.c25b.b'

/** The Phase 2-C2.5-A synthetic contention: A and B contend for Gogma 10; with either fixed, the other has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c25b.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c25b.b', { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

/**
 * A Phase 2-C2.5-A-shaped evidence built from a real derivation (committed forms: SHA-256 Route keys, reservation
 * ranges) and the Node Search-only path of that phase for the Node rows. Every orientation is a completed control.
 */
async function syntheticEvidence(built: ReturnType<typeof scenario>) {
  const all = await derivePhase2C25BContexts(built.input, [], () => built.engine)
  const orientations = all.baseline.orientations
  const derived = await derivePhase2C25BContexts(built.input, orientations.map(o => o.orientationId), () => built.engine)
  const nodeContexts = []
  for (const orientation of orientations) {
    const prepared = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
    for (const context of prepared.contexts.filter(c => c.status === 'searchable')) {
      const record = await runPhase2C25ASearchOnly(built.input, prepared, context.workIndex, built.engine, { mode: 'minimal' })
      const mode = { status: record.status, wallMs: 1, timeToFirstMs: record.timeToFirstMs, searchSummary: record.searchSummary,
        firstCandidateKeySha256: record.firstCandidateKey === null ? null : await sha256(record.firstCandidateKey), v8FatalGc: null }
      nodeContexts.push({ orientationId: orientation.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, classification: 'no_oom',
        minimal: mode, instrumented: mode, growth: null })
    }
  }
  return {
    derived,
    json: {
      provenance: { formal: true, measuredHead: 'head', exportSha256: await sha256Bytes(EXPORT_BYTES) },
      conditions: { searchExtent: { ...defaultPlannerAlternativeSearchExtent }, candidateStopBound: 1, researchMaxPlanSteps: built.input.options.maxPlanSteps, childHeapLimitMb: 8192,
        calculationContext: { ...built.input.calculationContext } },
      selection: { selected: orientations.map(o => ({ orientationId: o.orientationId, kind: o.kind, role: 'completed_control' })) },
      baseline: { summary: derived.baseline.summary },
      preSearchContexts: await Promise.all(orientations.map(async o => ({ orientationId: o.orientationId, contexts: await Promise.all(derived.contexts[o.orientationId].map(async c => ({
        workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, status: c.status, invalidatedBuildListEntryId: c.invalidatedBuildListEntryId,
        invalidatedRouteKeySha256: await sha256(c.invalidatedRouteKey), fixedRouteBuildListEntryIds: c.fixedRouteBuildListEntryIds, reservation: phase2c25bRangeReservation(c.reservation),
        excludedRouteKeySha256s: await Promise.all(c.excludedRouteKeys.map(sha256)), extent: c.extent, originDigest: c.originDigest, contextDigest: c.contextDigest }))) }))),
      contexts: nodeContexts,
    },
  }
}

/** A Worker that runs the real benchmark controller in-process, answering through the Worker message interface. */
class InProcessWorker implements BenchmarkWorkerLike {
  terminated = false
  readonly posted: unknown[] = []
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  private readonly controller
  constructor(engine: ReturnType<typeof scenario>['engine']) {
    this.controller = createPhase2C25BController(message => { queueMicrotask(() => this.emit(structuredClone(message))) },
      { createEngine: () => engine, yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)), sha256 })
    queueMicrotask(() => this.emit({ type: 'pg2c25b_benchmark_ready', environment: this.controller.environment() }))
  }
  postMessage(message: unknown) { this.posted.push(message); void this.controller.handleMessage(structuredClone(message)) }
  addEventListener(type: string, listener: (event: Event) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  terminate() { this.terminated = true }
  emit(data: Phase2C25BResponse) { if (!this.terminated) for (const l of this.listeners.get('message') ?? []) l({ data } as MessageEvent) }
}

/** A scripted Worker for protocol tests: `script` answers each request with a list of responses or a native failure. */
class ScriptedWorker implements BenchmarkWorkerLike {
  terminated = false
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  private readonly script: (requestId: string, type: string) => (Phase2C25BResponse | 'native_error' | 'messageerror')[]
  constructor(script: (requestId: string, type: string) => (Phase2C25BResponse | 'native_error' | 'messageerror')[], ready = true) {
    this.script = script
    if (ready) queueMicrotask(() => this.emit({ type: 'pg2c25b_benchmark_ready', environment: ENV }))
  }
  postMessage(message: unknown) {
    const m = message as { requestId: string; type: string }
    const steps = this.script(m.requestId, m.type)
    void (async () => {
      for (const step of steps) {
        await new Promise(resolve => setTimeout(resolve, 0))
        if (step === 'native_error' || step === 'messageerror') for (const l of this.listeners.get(step === 'native_error' ? 'error' : 'messageerror') ?? []) l({ type: step === 'native_error' ? 'error' : 'messageerror', message: 'boom' } as unknown as Event)
        else this.emit(step)
      }
    })()
  }
  addEventListener(type: string, listener: (event: Event) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  terminate() { this.terminated = true }
  emit(data: Phase2C25BResponse) { if (!this.terminated) for (const l of this.listeners.get('message') ?? []) l({ data } as MessageEvent) }
}
const ENV = { protocolVersion: 'planner-global-phase2c25b', userAgent: 'test', hardwareConcurrency: 1, crossOriginIsolated: false, performanceMemory: null, messageChannel: true, rngEngineVersion: 'v' }

async function preparedRunner(options: { worker?: 'in_process' | ((requestId: string, type: string) => (Phase2C25BResponse | 'native_error' | 'messageerror')[]); mutate?: (evidence: Record<string, unknown>) => void } = {}) {
  const built = scenario()
  const { json, derived } = await syntheticEvidence(built)
  options.mutate?.(json as unknown as Record<string, unknown>)
  const relayed: Record<string, unknown>[] = []
  const workers: BenchmarkWorkerLike[] = []
  const script = options.worker
  const runner = createPhase2C25BRunner({
    sha256, sha256Bytes, buildInput: () => ({ input: built.input, maxPlanSteps: built.input.options.maxPlanSteps }),
    relay: event => relayed.push(event), visibilityState: () => 'visible', onVisibilityChange: () => () => undefined,
    createWorker: () => {
      // The contexts Worker always runs the real controller; a scripted Search Worker replaces only the Search ones.
      const worker = workers.length === 0 || script === undefined || script === 'in_process' ? new InProcessWorker(built.engine) : new ScriptedWorker(script)
      workers.push(worker)
      return worker
    },
  })
  await runner.loadExport(EXPORT_BYTES, 'export.json')
  await runner.loadEvidence(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer, 'evidence.json')
  return { built, json, derived, runner, relayed, workers }
}

// ---------------------------------------------------------------- evidence

describe('Phase 2-C2.5-B evidence', () => {
  it('parses the Phase 2-C2.5-A evidence and derives the workload from it, never from code', async () => {
    const built = scenario()
    const { json } = await syntheticEvidence(built)
    const view = parsePhase2C25BEvidence(json)
    const workload = phase2c25bWorkload(view)
    expect(workload.length).toBeGreaterThan(0)
    expect(workload.map(c => c.orientationId)).toEqual(view.expectedContexts.filter(c => c.status === 'searchable').map(c => c.orientationId))
    // Selecting fewer orientations in the evidence selects fewer contexts: nothing is named in code.
    const narrowed = parsePhase2C25BEvidence({ ...json, selection: { selected: json.selection.selected.slice(0, 1) } })
    expect(phase2c25bWorkload(narrowed).every(c => c.orientationId === json.selection.selected[0].orientationId)).toBe(true)
  })

  it('fails closed on malformed evidence', async () => {
    const built = scenario()
    const { json } = await syntheticEvidence(built)
    const broken = (patch: (value: Record<string, unknown>) => void) => {
      const copy = structuredClone(json) as unknown as Record<string, unknown>
      patch(copy)
      return () => parsePhase2C25BEvidence(copy)
    }
    expect(broken(v => { (v.provenance as Record<string, unknown>).formal = false })).toThrow(/formal/)
    expect(broken(v => { v.preSearchContexts = [] })).toThrow(/no recorded pre-search contexts/)
    expect(broken(v => { v.contexts = [] })).toThrow(/no Node result/)
    expect(broken(v => { ((v.selection as { selected: { role: string }[] }).selected[0]).role = 'guess' })).toThrow(/unknown/)
    expect(broken(v => { delete v.conditions })).toThrow(/conditions/)
    expect(() => parsePhase2C25BEvidence(null)).toThrow()
  })

  it('reports every differing context field, digest included, as a parity failure', async () => {
    const built = scenario()
    const { json, derived } = await syntheticEvidence(built)
    const view = parsePhase2C25BEvidence(json)
    expect((await comparePhase2C25BContextParity(view, derived, sha256)).matches).toBe(true)
    const patched = async (patch: (context: typeof view.expectedContexts[number]) => void) => {
      const copy = structuredClone(view)
      patch(copy.expectedContexts[0])
      return comparePhase2C25BContextParity(copy, derived, sha256)
    }
    expect((await patched(c => { c.contextDigest = 'fnv1a32:00000000' })).rows[0].checks.contextDigest).toBe(false)
    expect((await patched(c => { c.extent = { ...c.extent, maxGogmaAdvance: 1 } })).rows[0].checks.extent).toBe(false)
    expect((await patched(c => { c.reservation = { ...c.reservation!, gogma: { held: [[1, 99]], blocked: [] } } })).rows[0].checks.reservation).toBe(false)
    expect((await patched(c => { c.excludedRouteKeySha256s = ['0'.repeat(64)] })).rows[0].checks.excludedRouteKeys).toBe(false)
    expect((await patched(c => { c.originDigest = 'x' })).matches).toBe(false)
    const summary = structuredClone(view)
    summary.baselineSummary = { ...summary.baselineSummary, conflicts: 99 }
    expect(await comparePhase2C25BContextParity(summary, derived, sha256)).toMatchObject({ matches: false, baselineSummary: false })
  })
})

// ---------------------------------------------------------------- runner

describe('Phase 2-C2.5-B runner', () => {
  it('re-derives every context in a fresh Worker, matches the evidence, and reproduces the Node Search-only first Candidate in both modes', async () => {
    const { runner, json, relayed, workers } = await preparedRunner({ worker: 'in_process' })
    const preparation = await runner.prepare()
    expect(preparation).toMatchObject({ status: 'ok', exportShaMatchesEvidence: true })
    expect(preparation.parity!.rows.every(row => row.matches)).toBe(true)
    const [first] = runner.selectedContexts()
    const minimal = await runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' })
    const instrumented = await runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'instrumented' })
    const node = json.contexts.find(c => c.orientationId === first.orientationId && c.workIndex === first.workIndex)!
    for (const record of [minimal, instrumented]) {
      expect(record.status).toBe(node.minimal.status)
      expect(record.result!.firstCandidateKeySha256).toBe(node.minimal.firstCandidateKeySha256)
      expect(stableStringify(record.result!.searchSummary)).toBe(stableStringify(node.minimal.searchSummary))
      expect(record.error).toBeNull()
    }
    expect(minimal.semanticDigest).toBe(instrumented.semanticDigest)
    expect(minimal.progress.count).toBe(0)
    expect(instrumented.progress.count).toBeGreaterThan(0)
    expect(instrumented.progress.snapshots.every(s => s.workerHeap === null && typeof s.gogma.totalGeneratedStates === 'number')).toBe(true)
    if (minimal.status === 'first_candidate') {
      expect(minimal.firstCandidateNotice).not.toBeNull()
      expect(minimal.timeline.firstCandidateNoticeAtMs).not.toBeNull()
      expect(minimal.result!.searchSummary.deliveredCandidates).toBe(PHASE2C25B_CANDIDATE_STOP_BOUND)
    }
    // One fresh Worker per run (contexts + 2 Search runs), each terminated; the evidence never reaches a Worker.
    expect(workers).toHaveLength(3)
    expect(workers.every(w => (w as InProcessWorker).terminated)).toBe(true)
    for (const worker of workers) expect(JSON.stringify((worker as InProcessWorker).posted)).not.toMatch(/firstCandidateKeySha256|preSearchContexts|expectedContexts/)
    expect(relayed.filter(e => e.runKey === minimal.runKey).map(e => e.event)).toEqual(expect.arrayContaining(['run_started', 'accepted', 'search_ready', 'run_settled']))
    expect(PHASE2C25B_RELAY_PREFIX).toBe('[pg2c25b]')
  })

  it('refuses a formal run when the Export SHA-256 differs from the evidence, without starting a Worker', async () => {
    const { runner, workers } = await preparedRunner({ mutate: e => { (e.provenance as Record<string, unknown>).exportSha256 = 'f'.repeat(64) } })
    expect(await runner.prepare()).toMatchObject({ status: 'failed', exportShaMatchesEvidence: false, contextsWorker: null })
    expect(workers).toHaveLength(0)
    await expect(runner.runContext({ orientationId: 'any', workIndex: 0, mode: 'minimal' })).rejects.toThrow(/preparation/)
  })

  it('refuses every run when a recorded context digest differs', async () => {
    const { runner, workers } = await preparedRunner({ mutate: e => {
      const contexts = (e.preSearchContexts as { contexts: { contextDigest: string }[] }[])[0].contexts
      contexts[0].contextDigest = 'fnv1a32:deadbeef'
    } })
    const preparation = await runner.prepare()
    expect(preparation.status).toBe('failed')
    expect(preparation.message).toMatch(/contextDigest/)
    const [first] = runner.selectedContexts()
    await expect(runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' })).rejects.toThrow(/preparation/)
    expect(workers).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- Worker protocol outcomes

function fakeSearchRecord(status: Phase2C25BSearchRecord['status'] = 'first_candidate'): Phase2C25BSearchRecord {
  return { mode: 'minimal', orientationId: 'o', targetWeaponId: 't', workIndex: 0, contextDigest: 'd', status,
    searchSummary: { deliveredCandidates: status === 'first_candidate' ? 1 : 0, excludedCandidates: 0, exhausted: false, stoppedByExtent: status !== 'first_candidate', stoppedByConsumer: status === 'first_candidate', skippedExcludedRouteKeys: 0 },
    timeToFirstMs: status === 'first_candidate' ? 1 : null, elapsedMs: 2, firstCandidateKeySha256: status === 'first_candidate' ? 'k' : null, firstCandidateSummary: null,
    predictionCounts: null, predictionCountsAtFirstCandidate: null, finalSnapshot: null, snapshotsEmitted: 0 }
}

async function scriptedRun(steps: (requestId: string) => (Phase2C25BResponse | 'native_error' | 'messageerror')[], budgetMs?: number): Promise<Phase2C25BRunRecord> {
  const { runner } = await preparedRunner({ worker: (requestId, type) => type === 'pg2c25b_benchmark_search' ? steps(requestId) : [] })
  expect((await runner.prepare()).status).toBe('ok')
  const [first] = runner.selectedContexts()
  return runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal', budgetMs })
}

describe('Phase 2-C2.5-B Worker protocol outcomes', () => {
  const accepted = (requestId: string): Phase2C25BResponse => ({ type: 'pg2c25b_benchmark_accepted', requestId })
  const ready = (requestId: string): Phase2C25BResponse => ({ type: 'pg2c25b_benchmark_search_ready', requestId, preparationMs: 1, workerHeap: null })
  const notice = (requestId: string): Phase2C25BResponse => ({ type: 'pg2c25b_benchmark_first_candidate', requestId, timeToFirstMs: 1 })

  it('keeps a normal result, a structured error, native errors before / after the first Candidate, messageerror and a timeout apart', async () => {
    const normal = await scriptedRun(id => [accepted(id), ready(id), notice(id), { type: 'pg2c25b_benchmark_search_result', requestId: id, record: fakeSearchRecord() }])
    expect(normal).toMatchObject({ status: 'first_candidate', error: null })
    expect(normal.timeline.acceptedAtMs).not.toBeNull()
    expect(normal.firstCandidateNotice).not.toBeNull()
    const extent = await scriptedRun(id => [accepted(id), ready(id), { type: 'pg2c25b_benchmark_search_result', requestId: id, record: fakeSearchRecord('stopped_by_extent_before_candidate') }])
    expect(extent.status).toBe('stopped_by_extent_before_candidate')
    const structured = await scriptedRun(id => [accepted(id), ready(id), { type: 'pg2c25b_benchmark_error', requestId: id, stage: 'search', name: 'RangeError', message: 'x', firstCandidateDelivered: false }])
    expect(structured).toMatchObject({ status: 'structured_error', result: null, error: { source: 'structured', stage: 'search', name: 'RangeError' } })
    const before = await scriptedRun(id => [accepted(id), ready(id), 'native_error'])
    expect(before).toMatchObject({ status: 'worker_error_before_first_candidate', result: null, semanticDigest: null, error: { source: 'native_error' } })
    const after = await scriptedRun(id => [accepted(id), ready(id), notice(id), 'native_error'])
    expect(after.status).toBe('worker_error_after_first_candidate')
    const messageError = await scriptedRun(id => [accepted(id), 'messageerror'])
    expect(messageError.status).toBe('worker_messageerror')
    const timeout = await scriptedRun(id => [accepted(id), ready(id)], 30)
    expect(timeout).toMatchObject({ status: 'timeout', result: null, error: { source: 'timeout' } })
    // None of the failures is a "no Candidate" Search status.
    for (const record of [structured, before, after, messageError, timeout]) expect(['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate']).not.toContain(record.status)
  })
})

// ---------------------------------------------------------------- classification

describe('Phase 2-C2.5-B classification', () => {
  const mode = (status: string, digest: string | null = null, noticed = false) => ({ status: status as never, semanticDigest: digest, firstCandidateNoticed: noticed })

  it('classifies a pair by the pre-registered rules and never turns a Worker failure into OOM or no-match', () => {
    expect(phase2c25bPairClassification(mode('worker_error_before_first_candidate'), mode('worker_error_before_first_candidate'))).toBe('browser_search_failure_reproduced')
    expect(phase2c25bPairClassification(mode('first_candidate', 'a', true), mode('worker_error_before_first_candidate'))).toBe('instrumentation_contamination')
    expect(phase2c25bPairClassification(mode('worker_error_before_first_candidate'), mode('stopped_by_extent_before_candidate', 'b'))).toBe('inconsistent_modes')
    expect(phase2c25bPairClassification(mode('first_candidate', 'a', true), mode('first_candidate', 'a', true))).toBe('browser_no_failure')
    expect(phase2c25bPairClassification(mode('first_candidate', 'a', true), mode('first_candidate', 'b', true))).toBe('observer_semantic_mismatch')
    expect(phase2c25bPairClassification(mode('page_crashed'), mode('page_crashed'))).toBe('inconclusive_page_or_browser_crash')
    expect(phase2c25bPairClassification(mode('worker_error_before_first_candidate'), mode('browser_crashed'))).toBe('inconclusive_page_or_browser_crash')
    expect(phase2c25bPairClassification(mode('timeout'), mode('first_candidate', 'a', true))).toBe('inconclusive_timeout_or_abort')
    expect(phase2c25bPairClassification(mode('structured_error'), mode('structured_error'))).toBe('browser_search_structured_error')
    expect(phase2c25bPairClassification(mode('structured_error'), mode('worker_error_before_first_candidate'))).toBe('browser_search_failure_mixed')
    expect(phase2c25bPairClassification(mode('worker_error_after_first_candidate', null, true), mode('worker_error_after_first_candidate', null, true))).toBe('failure_after_first_candidate')
    expect(phase2c25bPairClassification(mode('worker_target_destroyed_before_first_candidate'), mode('worker_target_destroyed_before_first_candidate'))).toBe('browser_search_failure_reproduced')
  })

  it('repeats a context once for a crash, a native failure, a mode disagreement or a CDP attach failure', () => {
    const pair = (a: string, b: string, attempt = 1, cdp = false, da: string | null = 'x', db: string | null = 'x') =>
      phase2c25bRepeatDecision({ attempt, minimal: { status: a as never, semanticDigest: da }, instrumented: { status: b as never, semanticDigest: db }, cdpAttachFailure: cdp })
    expect(pair('first_candidate', 'first_candidate')).toEqual({ repeat: false, reasons: [] })
    expect(pair('page_crashed', 'page_crashed').reasons).toEqual(['page_or_browser_crash'])
    expect(pair('page_crashed', 'page_crashed', 2).repeat).toBe(false)
    expect(pair('worker_error_before_first_candidate', 'worker_error_before_first_candidate').reasons).toEqual(['native_worker_failure'])
    expect(pair('first_candidate', 'worker_error_before_first_candidate').reasons).toEqual(['native_worker_failure', 'mode_classification_mismatch'])
    expect(pair('first_candidate', 'first_candidate', 1, false, 'a', 'b').reasons).toEqual(['mode_classification_mismatch'])
    expect(pair('first_candidate', 'first_candidate', 1, true).reasons).toEqual(['cdp_attach_failure'])
  })

  function externalRun(runKey: string, mode: 'minimal' | 'instrumented', attempt: number, overrides: Partial<Phase2C25BExternalRun> = {}): Phase2C25BExternalRun {
    const [orientationWork] = runKey.split(':')
    const [orientationId, workIndex] = orientationWork.split('#')
    return { runKey, orientationId, workIndex: Number(workIndex), mode, attempt, sessionIndex: 1, startedAt: 1000, endedAt: 9000, driverStatus: 'page_settled', pageStatus: null,
      workerTargets: [{ targetIdSha: 'w', createdAt: 1000, attachedAt: 1001, firstSampleAt: 1500, lastSuccessfulSampleAt: 7000, samples: 2, detachedAt: 8000, destroyedAt: 8000 }],
      heapSamples: [{ atEpochMs: 1500, requestMs: 1, targetIdSha: 'w', usedSize: 10, totalSize: 20 }, { atEpochMs: 7000, requestMs: 1, targetIdSha: 'w', usedSize: 30, totalSize: 40 }],
      sampleErrors: [], events: [], pageEvents: [], crash: null, crashDumps: [], ...overrides }
  }

  it('merges a lost page from the external evidence only, and labels an explicit V8 OOM crash key as auxiliary', () => {
    const lost = mergePhase2C25BRun(externalRun('c#0:minimal:a1', 'minimal', 1, { driverStatus: 'page_crashed',
      crash: { detectedAt: 8000, via: 'Inspector.detached', reason: 'Render process gone.' },
      pageEvents: [{ receivedAt: 1100, event: 'search_ready', runKey: 'c#0:minimal:a1' }],
      crashDumps: [{ ptype: 'renderer', loadedOrigin: 'http://127.0.0.1', v8OomLocation: 'MarkCompactCollector: young object promotion failed', v8OomDetails: null, mentionsAllocationFailure: true, mtime: 't' }] }), null)
    expect(lost).toMatchObject({ status: 'page_crashed', source: 'external_only', searchStarted: true, firstCandidateNoticed: false, browserOomEvidence: 'explicit_v8_oom_crash_key',
      searchStartToLossMs: 6900 })
    expect(lost.cdp).toMatchObject({ samples: 2, maxUsedBytes: 30, lastUsedBytes: 30 })
    expect(phase2c25bLostDuringSearchBeforeFirstCandidate(lost)).toBe(true)
    // A crash dump without the V8 OOM key is no OOM evidence; a loss is still not a Search failure.
    const unexplained = mergePhase2C25BRun(externalRun('c#0:minimal:a1', 'minimal', 1, { driverStatus: 'page_crashed', crash: { detectedAt: 8000, via: 'x' } }), null)
    expect(unexplained.browserOomEvidence).toBeNull()
    expect(() => mergePhase2C25BRun(externalRun('c#0:minimal:a1', 'minimal', 1), null)).toThrow(/no page record/)
  })

  it('reports control semantic parity with Node only when status, Search summary and first Candidate key all agree in both modes', async () => {
    const built = scenario()
    const { json } = await syntheticEvidence(built)
    const view = parsePhase2C25BEvidence(json)
    const context = phase2c25bWorkload(view)[0]
    const node = view.nodeContexts.find(n => n.orientationId === context.orientationId && n.workIndex === context.workIndex)!
    const pageRecord = (mode: 'minimal' | 'instrumented', key: string | null): Phase2C25BRunRecord => {
      const result = { ...fakeSearchRecord(node.minimal.status as 'first_candidate'), searchSummary: node.minimal.searchSummary as never, firstCandidateKeySha256: key }
      return { runKey: `${context.orientationId}#${context.workIndex}:${mode}:a1`, status: result.status, result, semanticDigest: stableStringify({ status: result.status, summary: result.searchSummary, key }),
        error: null, firstCandidateNotice: result.status === 'first_candidate' ? { timeToFirstMs: 1, atMs: 1 } : null, timeline: { searchReadyAtMs: 1 },
        progress: { count: 0, snapshots: [] }, workerLifetimeMs: 1 } as unknown as Phase2C25BRunRecord
    }
    const analyse = (key: string | null) => analyzePhase2C25B(
      [{ records: ['minimal', 'instrumented'].map(m => pageRecord(m as 'minimal', key)) } as unknown as Phase2C25BPageExport],
      { runs: ['minimal', 'instrumented'].map(m => externalRun(`${context.orientationId}#${context.workIndex}:${m}:a1`, m as 'minimal', 1)) } as unknown as Phase2C25BExternalEvidence,
      { ...view, expectedContexts: view.expectedContexts.filter(c => c.orientationId === context.orientationId && c.workIndex === context.workIndex) })
    const good = analyse(node.minimal.firstCandidateKeySha256)
    expect(good.contexts[0]).toMatchObject({ classification: 'browser_no_failure', controlSemanticParity: true })
    const bad = analyse(node.minimal.firstCandidateKeySha256 === null ? 'other' : 'f'.repeat(64))
    expect(bad.contexts[0].controlSemanticParity).toBe(false)
  })
})

// ---------------------------------------------------------------- heap limit wording

describe('Phase 2-C2.5-B heap limit wording', () => {
  const GiB = 2 ** 30
  const statement = (worker: number | null) => phase2c25bWorkerHeapLimitStatement({
    representativeSampledMaxBytes: [3.714 * GiB, 3.85 * GiB, 3.8 * GiB], pageRealmJsHeapSizeLimit: 4_395_630_592, workerRealmJsHeapSizeLimit: worker })

  it('keeps the Worker used heap, the page realm limit and the unknown Worker limit apart', () => {
    const text = statement(null)
    // The measured Worker used heap (CDP sampled maxima), with its range.
    expect(text).toMatch(/Dedicated Worker used heap sampled by CDP reached 3\.71-3\.85 GiB/)
    // The page realm limit, as another realm's reference value.
    expect(text).toMatch(/page realm reported performance\.memory\.jsHeapSizeLimit 4395630592 bytes \(about 4\.09 GiB\), a value of another realm given for reference only/)
    // The Worker's own limit is unknown and never taken to equal the page realm value.
    expect(text).toMatch(/Dedicated Worker realm did not expose its own jsHeapSizeLimit, so the Worker's actual heap limit was not measured \(unknown\) and is not taken to equal the page realm value/)
    expect(text).toMatch(/Neither value is compared directly with the Node 8 GB heap limit/)
    // Never a Worker / Browser heap limit of about 4 GiB.
    expect(text).not.toMatch(/(?:Worker|Browser)[^;]*heap limit[^;]*(?:about|≈|~)\s*4(?:\.\d+)?\s*GiB/i)
    expect(text).not.toMatch(/Worker heap limit \(about 4 GiB\)/)
  })

  it('names a Worker realm limit only when the Worker realm itself reports one', () => {
    expect(statement(1234)).toMatch(/Dedicated Worker realm reported its own jsHeapSizeLimit 1234 bytes/)
    expect(statement(1234)).not.toMatch(/not measured/)
    expect(phase2c25bWorkerHeapLimitStatement({ representativeSampledMaxBytes: [], pageRealmJsHeapSizeLimit: null, workerRealmJsHeapSizeLimit: null }))
      .toMatch(/no Dedicated Worker used heap was sampled.*page realm exposed no jsHeapSizeLimit/)
  })

  it('makes the analyzer use that statement and never rewrite the raw evidence of a committed run', () => {
    const analyzer = Object.values(scriptSources)[0]
    expect(analyzer).toMatch(/phase2c25bWorkerHeapLimitStatement\(/)
    expect(analyzer).not.toMatch(/heap limit \(about 4 GiB\)|about 4 GiB/)
    expect(analyzer).toMatch(/verified_unchanged/)
    expect(analyzer).toMatch(/raw evidence is never rewritten/)
  })
})

// ---------------------------------------------------------------- isolation

const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'PHASE2C1_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./plannerGlobalPhase2C25B*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const workerSources = import.meta.glob('../workers/plannerGlobalPhase2C25B.worker.benchmark*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const pageSources = import.meta.glob('../pages/PlannerGlobalPhase2C25BBenchmarkPage.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25b*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const benchmarkOnly = [/^\.\.\/benchmark\.tsx$/, /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/, /^\.\.\/pages\/[A-Za-z0-9]+BenchmarkPage(\.test)?\.tsx$/,
  /^\.\.\/workers\/[A-Za-z0-9]+\.worker\.benchmark(\.entry)?(\.test)?\.ts$/, /\.test\.tsx?$/]

describe('Phase 2-C2.5-B isolation', () => {
  const runtime = Object.entries({ ...benchmarkSources, ...workerSources, ...pageSources }).filter(([path]) => !/\.test\.tsx?$/.test(path))

  it('keeps the oracle, hard-coded IDs / Counter positions and file reads out of every runtime module', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual(['../pages/PlannerGlobalPhase2C25BBenchmarkPage.tsx', '../workers/plannerGlobalPhase2C25B.worker.benchmark.entry.ts',
      '../workers/plannerGlobalPhase2C25B.worker.benchmark.ts', './plannerGlobalPhase2C25B.ts', './plannerGlobalPhase2C25BAnalysis.ts', './plannerGlobalPhase2C25BEvidence.ts',
      './plannerGlobalPhase2C25BHarness.ts', './plannerGlobalPhase2C25BProtocol.ts'])
    for (const [path, source] of runtime) {
      expect(source, path).not.toMatch(ORACLE_NAMES)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source, path).not.toMatch(/['"]c\d+-p\d+['"]|build-list\.fnv1a32-/)
      expect(source, path).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
      expect(source, path).not.toMatch(/from ['"][^'"]*(?:\/db\/|dexie|repositories|importExportService)/i)
      expect(source, path).not.toMatch(/\b(?:indexedDB|localStorage|sessionStorage)\s*\.|\bnew Dexie\b/)
    }
    const scripts = Object.values(scriptSources)
    expect(scripts.length).toBe(1)
    expect(scripts[0]).not.toMatch(ORACLE_NAMES)
    expect(scripts[0]).not.toMatch(/visitPlannerAlternativeCandidates|createProductionPlan|derivePhase2C25APreSearchContexts/)
    expect(scripts[0]).toMatch(/calculationCodeChangedSinceMeasuredHead/)
  })

  it('never hands the Phase 2-C2.5-A evidence to a Worker, and the Worker runs only the Search to the first Candidate', () => {
    const worker = workerSources['../workers/plannerGlobalPhase2C25B.worker.benchmark.ts']
    const calculation = benchmarkSources['./plannerGlobalPhase2C25B.ts']
    for (const source of [worker, calculation]) {
      expect(source).not.toMatch(/plannerGlobalPhase2C25BEvidence|parsePhase2C25BEvidence|PHASE2C25A_RESULT|plannerGlobalPhase2C25AAnalysis/)
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|runPlannerAlternativeKernel|createPlannerAlternativeWhatIf|createPlannerAlternativeRepair/)
    }
    expect(calculation).toMatch(/visitPlannerAlternativeCandidates\(/)
    expect(calculation).toMatch(/derivePhase2C25APreSearchContexts\(/)
    expect(worker).toMatch(/benchmarkWorkerYield/)
  })

  it('is reached by no Production module, and Production keeps its Worker protocols, defaults, schema and versions', () => {
    const productionPaths = Object.keys(production).filter(path => !benchmarkOnly.some(pattern => pattern.test(path)))
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter(path => /plannerGlobalPhase2C25B|pg2c25b|PlannerGlobalPhase2C25BBenchmarkPage/i.test(production[path]))).toEqual([])
    for (const path of ['../workers/plannerWorkerContracts.ts', '../workers/planner.worker.ts', '../workers/planner.worker.production.ts', '../workers/contracts.ts', '../workers/search.worker.ts']) {
      expect(production[path], path).toBeDefined()
      expect(production[path], path).not.toMatch(/pg2c25b|Phase2C25B/)
    }
    // Reachable only from the benchmark shell.
    expect(production['../pages/BenchmarkApp.tsx']).toMatch(/PlannerGlobalPhase2C25BBenchmarkPage/)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
