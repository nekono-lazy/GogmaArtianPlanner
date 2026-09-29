import { describe, expect, it } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import c25bResults from '../../docs/PLANNER_GLOBAL_PHASE2C25B_RESULTS.json'
import d2aResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json'
import d2bExternal from '../../docs/PLANNER_GLOBAL_PHASE2C25D2B_EXTERNAL_MEMORY.json'
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
import { attachPhase2C25D2BWorker, type Phase2C25D2BWorkerScope } from '../workers/plannerGlobalPhase2C25D2B.worker.benchmark'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { derivePhase2C25APreSearchContexts, runPhase2C25ASearchOnly } from './plannerGlobalPhase2C25A'
import { derivePhase2C25BContexts } from './plannerGlobalPhase2C25B'
import type { Phase2C25BExternalEvidence, Phase2C25BExternalRun, Phase2C25BPageExport } from './plannerGlobalPhase2C25BAnalysis'
import { parsePhase2C25BEvidence, phase2c25bRangeReservation, type Phase2C25BEvidenceView } from './plannerGlobalPhase2C25BEvidence'
import { phase2c25bRepeatDecision, type Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import type { Phase2C25BSearchRecord } from './plannerGlobalPhase2C25BProtocol'
import { parsePhase2C25CEvidence, selectPhase2C25CWorkload } from './plannerGlobalPhase2C25C'
import { phase2c25d2bWorkload, type Phase2C25D2BWorkloadContext } from './plannerGlobalPhase2C25D2B'
import {
  analyzePhase2C25D2B,
  parsePhase2C25BBrowserBefore,
  parsePhase2C25D2ANodeResult,
  phase2c25d2bNodeParity,
  phase2c25d2bStatements,
  validatePhase2C25D2BFormalSeries,
  type Phase2C25D2BBeforeView,
  type Phase2C25D2BFormalSeriesInput,
  type Phase2C25D2BNodeMode,
  type Phase2C25D2BNodeView,
} from './plannerGlobalPhase2C25D2BAnalysis'
import { adaptPhase2C25D2BWorker, createPhase2C25D2BRunner } from './plannerGlobalPhase2C25D2BHarness'
import {
  fromPhase2C25D2BRequest,
  fromPhase2C25D2BResponse,
  PHASE2C25D2B_PROTOCOL_VERSION,
  toPhase2C25D2BRequest,
  toPhase2C25D2BResponse,
} from './plannerGlobalPhase2C25D2BProtocol'

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha256Bytes = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))
const sha256 = async (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer as ArrayBuffer)
const EXPORT_BYTES = new TextEncoder().encode('{"synthetic":"export-d2b"}').buffer as ArrayBuffer

// ---------------------------------------------------------------- the D2-a workload

describe('Phase 2-C2.5-D2-b workload', () => {
  const view = parsePhase2C25BEvidence(c25aEvidence)
  const workload = phase2c25d2bWorkload(view, c25aEvidence)

  it('is exactly the D2-a 5 contexts, selected by the existing selectPhase2C25CWorkload() rule from the committed C2.5-A evidence', () => {
    const rule = selectPhase2C25CWorkload(parsePhase2C25CEvidence(c25aEvidence))
    const expected = [...rule.oomRepresentatives, ...rule.controls]
    expect(workload.map(c => [c.orientationId, c.workIndex, c.targetWeaponId, c.contextDigest, c.selectionRole]))
      .toEqual(expected.map(c => [c.orientationId, c.workIndex, c.targetWeaponId, c.contextDigest, c.role]))
    const d2a = d2aResult.workloadSelection
    expect(workload.map(c => [c.orientationId, c.workIndex, c.contextDigest])).toEqual([...d2a.oomRepresentatives, ...d2a.controls].map(c => [c.orientationId, c.workIndex, c.contextDigest]))
    // The IDs are a consequence of the committed evidence, never a selection authority in source (see the isolation tests).
    expect(workload.map(c => `${c.orientationId}#${c.workIndex}`)).toEqual(['c0-p0#0', 'c12-p0#0', 'c2-p1#0', 'c8-p1#0', 'c13-p4#0'])
    expect(workload.map(c => c.role)).toEqual(['oom_representative', 'oom_representative', 'oom_representative', 'completed_control', 'completed_control'])
  })

  it('fails closed when a selected context disagrees with its recorded pre-search context', () => {
    const broken = structuredClone(view)
    broken.expectedContexts.find(c => c.orientationId === workload[0].orientationId && c.workIndex === workload[0].workIndex)!.contextDigest = 'fnv1a32:00000000'
    expect(() => phase2c25d2bWorkload(broken, c25aEvidence)).toThrow(/disagrees/)
    const missing = { ...view, expectedContexts: view.expectedContexts.filter(c => c.orientationId !== workload[1].orientationId) }
    expect(() => phase2c25d2bWorkload(missing, c25aEvidence)).toThrow(/no recorded pre-search context/)
  })
})

// ---------------------------------------------------------------- protocol

describe('Phase 2-C2.5-D2-b protocol', () => {
  it('renames only the prefix, on the D2-b wire, and ignores Phase 2-C2.5-B messages', () => {
    const request = { type: 'pg2c25b_benchmark_contexts' as const, requestId: 'r', input: {} as never, orientationIds: ['x'] }
    const wire = toPhase2C25D2BRequest(request)
    expect(wire.type).toBe('pg2c25d2b_benchmark_contexts')
    expect(fromPhase2C25D2BRequest(wire)).toEqual(request)
    expect(fromPhase2C25D2BRequest(request)).toBeNull()
    const ready = toPhase2C25D2BResponse({ type: 'pg2c25b_benchmark_ready', environment: { protocolVersion: 'planner-global-phase2c25b', userAgent: null, hardwareConcurrency: null,
      crossOriginIsolated: null, performanceMemory: null, messageChannel: true, rngEngineVersion: 'v' } })
    expect(ready).toMatchObject({ type: 'pg2c25d2b_benchmark_ready', environment: { protocolVersion: PHASE2C25D2B_PROTOCOL_VERSION } })
    expect(fromPhase2C25D2BResponse(ready)?.type).toBe('pg2c25b_benchmark_ready')
    expect(fromPhase2C25D2BResponse({ type: 'pg2c25b_benchmark_first_candidate', requestId: 'r', timeToFirstMs: 1 })).toBeNull()
    expect(fromPhase2C25D2BResponse({ type: 'pg2c25d2b_benchmark_unknown' })).toBeNull()
    expect(fromPhase2C25D2BResponse(null)).toBeNull()
  })
})

// ---------------------------------------------------------------- runner (synthetic scenario, in-process D2-b Worker)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

/** The Phase 2-C2.5-A synthetic contention: A and B contend for Gogma 10; with either fixed, the other has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.d2b.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.d2b.b', { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.d2b.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.d2b.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

/** A Phase 2-C2.5-A-shaped evidence built from a real derivation (committed forms), with the Node rows from the C2.5-A Search-only path. */
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
        role: 'completed_control', kind: orientation.kind, minimal: mode, instrumented: mode, growth: null })
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

/** The real D2-b Worker controller, in-process, answering on the D2-b wire through the Worker message interface. */
class InProcessD2BWorker implements BenchmarkWorkerLike {
  terminated = false
  readonly posted: unknown[] = []
  readonly received: unknown[] = []
  private inbound: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  constructor(engine: ReturnType<typeof scenario>['engine']) {
    const scope: Phase2C25D2BWorkerScope = {
      postMessage: message => { const copy = structuredClone(message); queueMicrotask(() => this.emit(copy)) },
      addEventListener: (_type, listener) => { this.inbound = listener },
    }
    attachPhase2C25D2BWorker(scope, { createEngine: () => engine, yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)), sha256 })
  }
  postMessage(message: unknown) { this.posted.push(message); this.inbound?.({ data: structuredClone(message) } as MessageEvent<unknown>) }
  addEventListener(type: string, listener: (event: Event) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  terminate() { this.terminated = true }
  emit(data: unknown) { if (this.terminated) return; this.received.push(data); for (const l of this.listeners.get('message') ?? []) l({ data } as MessageEvent) }
}

/** The synthetic scenario is too small for the D2-a rule (no OOM representative), so its workload is every searchable context. */
const syntheticWorkload = (view: Phase2C25BEvidenceView): Phase2C25D2BWorkloadContext[] => view.expectedContexts.filter(c => c.status === 'searchable')
  .map(c => ({ orientationId: c.orientationId, kind: c.kind, role: c.role, workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, contextDigest: c.contextDigest,
    selectionRole: 'control_first_candidate' }))

async function preparedRunner(options: { mutate?: (evidence: Record<string, unknown>) => void; workload?: (view: Phase2C25BEvidenceView) => Phase2C25D2BWorkloadContext[] } = {}) {
  const built = scenario()
  const { json } = await syntheticEvidence(built)
  options.mutate?.(json as unknown as Record<string, unknown>)
  const relayed: Record<string, unknown>[] = []
  const workers: InProcessD2BWorker[] = []
  const runner = createPhase2C25D2BRunner({
    sha256, sha256Bytes, buildInput: () => ({ input: built.input, maxPlanSteps: built.input.options.maxPlanSteps }),
    relay: event => relayed.push(event), visibilityState: () => 'visible', onVisibilityChange: () => () => undefined,
    createWorker: () => { const worker = new InProcessD2BWorker(built.engine); workers.push(worker); return worker },
    selectWorkload: options.workload ?? syntheticWorkload,
  })
  await runner.loadExport(EXPORT_BYTES, 'export.json')
  await runner.loadEvidence(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer, 'evidence.json')
  return { built, json, runner, relayed, workers }
}

describe('Phase 2-C2.5-D2-b runner', () => {
  it('re-derives the workload contexts in fresh D2-b Workers, matches the evidence, and returns the Node Search-only semantics in both modes', async () => {
    const { runner, json, relayed, workers } = await preparedRunner()
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
      expect(record.id).toMatch(/^pg2c25d2b-record-/)
      expect(record.workerEnvironment?.protocolVersion).toBe(PHASE2C25D2B_PROTOCOL_VERSION)
    }
    // The normal-result semantic digest (status, Search summary, first Candidate key) is equal in both modes.
    expect(minimal.semanticDigest).toBe(instrumented.semanticDigest)
    expect(minimal.progress.count).toBe(0)
    expect(instrumented.progress.count).toBeGreaterThan(0)
    if (minimal.status === 'first_candidate') expect(minimal.firstCandidateNotice).not.toBeNull()
    // Every message crossed the Worker boundary on the D2-b wire; one fresh Worker per run, each terminated.
    expect(workers).toHaveLength(3)
    expect(workers.every(w => w.terminated)).toBe(true)
    for (const worker of workers) {
      for (const message of [...worker.posted, ...worker.received]) expect((message as { type: string }).type).toMatch(/^pg2c25d2b_benchmark_/)
      expect(JSON.stringify(worker.posted)).not.toMatch(/firstCandidateKeySha256|preSearchContexts|expectedContexts|selectionRole/)
    }
    expect(relayed.filter(e => e.runKey === minimal.runKey).map(e => e.event)).toEqual(expect.arrayContaining(['run_started', 'accepted', 'search_ready', 'run_settled']))
    expect(JSON.parse(runner.exportJson({})).protocolVersion).toBe(PHASE2C25D2B_PROTOCOL_VERSION)
  })

  it('derives and compares only the orientations of the workload', async () => {
    const { runner, json, workers } = await preparedRunner({ workload: view => syntheticWorkload(view).slice(0, 1) })
    const preparation = await runner.prepare()
    expect(preparation.status).toBe('ok')
    const orientationId = runner.selectedContexts()[0].orientationId
    const contextsRequest = workers[0].posted[0] as { orientationIds: string[] }
    expect(contextsRequest.orientationIds).toEqual([orientationId])
    expect(preparation.parity!.rows.every(row => row.orientationId === orientationId)).toBe(true)
    expect(json.selection.selected.length).toBeGreaterThan(1)
  })

  it('fails closed on a context parity mismatch: no formal Search starts', async () => {
    const { runner, workers } = await preparedRunner({ mutate: e => {
      (e.preSearchContexts as { contexts: { contextDigest: string }[] }[])[0].contexts[0].contextDigest = 'fnv1a32:deadbeef'
    }, workload: view => syntheticWorkload({ ...view, expectedContexts: view.expectedContexts.map(c => ({ ...c })) }) })
    const preparation = await runner.prepare()
    expect(preparation.status).toBe('failed')
    expect(preparation.message).toMatch(/contextDigest/)
    const [first] = runner.selectedContexts()
    await expect(runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' })).rejects.toThrow(/preparation/)
    expect(workers).toHaveLength(1)
  })

  it('ignores a Phase 2-C2.5-B message arriving at the adapter', () => {
    const listeners: ((event: Event) => void)[] = []
    const seen: unknown[] = []
    const adapted = adaptPhase2C25D2BWorker({ postMessage: () => undefined, addEventListener: (_t, l) => listeners.push(l), removeEventListener: () => undefined, terminate: () => undefined })
    adapted.addEventListener('message', event => seen.push((event as MessageEvent).data))
    listeners[0]({ data: { type: 'pg2c25b_benchmark_accepted', requestId: 'r' } } as MessageEvent)
    listeners[0]({ data: { type: 'pg2c25d2b_benchmark_accepted', requestId: 'r' } } as MessageEvent)
    expect(seen).toEqual([{ type: 'pg2c25b_benchmark_accepted', requestId: 'r' }])
  })
})

// ---------------------------------------------------------------- analysis (synthetic records)

const SUMMARY_EXTENT = { deliveredCandidates: 0, excludedCandidates: 0, exhausted: false, stoppedByExtent: true, stoppedByConsumer: false, skippedExcludedRouteKeys: 0 }
const SUMMARY_FIRST = { deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: true, skippedExcludedRouteKeys: 0 }
const COUNTS = { predictNormalArtian: 4, predictSkills: 5, resetBonuses: 233, keepBonuses: 25474 }

const WORKLOAD: Phase2C25D2BWorkloadContext[] = [
  { orientationId: 'rep-a', kind: 'same_gogma_counter', role: 'oom_representative', workIndex: 0, targetWeaponId: 't1', contextDigest: 'd1', selectionRole: 'oom_representative' },
  { orientationId: 'rep-b', kind: 'same_skill_counter', role: 'oom_representative', workIndex: 0, targetWeaponId: 't2', contextDigest: 'd2', selectionRole: 'oom_representative' },
  { orientationId: 'ctl', kind: 'same_gogma_counter', role: 'completed_control', workIndex: 0, targetWeaponId: 't3', contextDigest: 'd3', selectionRole: 'control_first_candidate' },
]

function nodeMode(status: string, summary: Record<string, unknown> | null, key: string | null, counts: typeof COUNTS | null): Phase2C25D2BNodeMode {
  return { status, searchSummary: summary, firstCandidateKeySha256: key, predictionCounts: counts, timeToFirstMs: null, searchElapsedMs: 1, metrics: null }
}
const NODE: Phase2C25D2BNodeView = { measuredHead: 'h', exportSha256: 'e', c25aEvidenceSha256: 'a', contexts: [
  { orientationId: 'rep-a', workIndex: 0, role: 'oom_representative', minimal: nodeMode('stopped_by_extent_before_candidate', SUMMARY_EXTENT, null, null),
    instrumented: nodeMode('stopped_by_extent_before_candidate', SUMMARY_EXTENT, null, COUNTS) },
  { orientationId: 'rep-b', workIndex: 0, role: 'oom_representative', minimal: nodeMode('out_of_memory', null, null, null), instrumented: nodeMode('out_of_memory', null, null, null) },
  { orientationId: 'ctl', workIndex: 0, role: 'completed_control', minimal: nodeMode('first_candidate', SUMMARY_FIRST, 'k', null), instrumented: nodeMode('first_candidate', SUMMARY_FIRST, 'k', COUNTS) },
] }

function progress(gogmaMaxDepth: number, generated: number) {
  return { seq: 1, trigger: 'heartbeat', elapsedMs: 1000, settledWorkItems: gogmaMaxDepth * 10,
    skill: { streams: 1, maxDepth: 4, totalStates: 8, totalTransitions: 8 },
    gogma: { streams: 1, maxDepth: gogmaMaxDepth, totalGeneratedStates: generated, totalFrontierStates: generated / 2, maxGeneratedStatesPerDepth: 100, depthOfMaxGeneratedStates: 3 },
    lastEvent: null, predictionCounts: COUNTS, workerHeap: null } as const
}

function pageRecord(runKey: string, mode: 'minimal' | 'instrumented', status: string, summary: Record<string, unknown>, key: string | null, counts: typeof COUNTS | null): Phase2C25BRunRecord {
  const result = { mode, orientationId: 'o', targetWeaponId: 't', workIndex: 0, contextDigest: 'd', status, searchSummary: summary, timeToFirstMs: key ? 1 : null, elapsedMs: 5000,
    firstCandidateKeySha256: key, firstCandidateSummary: null, predictionCounts: counts, predictionCountsAtFirstCandidate: null, finalSnapshot: null, snapshotsEmitted: 0 } as unknown as Phase2C25BSearchRecord
  return { runKey, status, result, semanticDigest: stableStringify({ status, summary, key }), error: null, firstCandidateNotice: key ? { timeToFirstMs: 1, atMs: 1 } : null,
    timeline: { searchReadyAtMs: 1 }, progress: { count: mode === 'instrumented' ? 1 : 0, snapshots: mode === 'instrumented' ? [progress(233, 2000)] : [] }, workerLifetimeMs: 6000 } as unknown as Phase2C25BRunRecord
}

function externalRun(runKey: string, overrides: Partial<Phase2C25BExternalRun> = {}): Phase2C25BExternalRun {
  const [orientationWork, mode, attempt] = runKey.split(':')
  const [orientationId, workIndex] = orientationWork.split('#')
  return { runKey, orientationId, workIndex: Number(workIndex), mode: mode as 'minimal', attempt: Number(attempt.slice(1)), sessionIndex: 1, startedAt: 1000, endedAt: 9000,
    driverStatus: 'page_settled', pageStatus: null,
    workerTargets: [{ targetIdSha: 'w', createdAt: 1000, attachedAt: 1001, firstSampleAt: 1500, lastSuccessfulSampleAt: 7000, samples: 2, detachedAt: 8000, destroyedAt: 8000 }],
    heapSamples: [{ atEpochMs: 1500, requestMs: 1, targetIdSha: 'w', usedSize: 10, totalSize: 20 }, { atEpochMs: 7000, requestMs: 1, targetIdSha: 'w', usedSize: 30, totalSize: 40 }],
    sampleErrors: [], events: [], pageEvents: [], crash: null, crashDumps: [], ...overrides }
}

function lostRun(runKey: string, generated: number | null, oomKey = true): Phase2C25BExternalRun {
  return externalRun(runKey, { driverStatus: 'page_crashed', crash: { detectedAt: 8000, via: 'Inspector.detached', reason: 'Render process gone.' },
    workerTargets: [{ targetIdSha: 'w', createdAt: 1000, attachedAt: 1001, firstSampleAt: 1500, lastSuccessfulSampleAt: 7000, samples: 2, detachedAt: null, destroyedAt: 8000 }],
    pageEvents: [{ receivedAt: 1100, event: 'search_ready', runKey }, ...(generated === null ? [] : [{ receivedAt: 7500, event: 'progress', runKey, snapshot: progress(12, generated) as never }])],
    crashDumps: oomKey ? [{ ptype: 'renderer', loadedOrigin: 'http://127.0.0.1', v8OomLocation: 'MarkCompactCollector: young object promotion failed', v8OomDetails: null,
      mentionsAllocationFailure: true, mtime: 't' }] : [] })
}

function beforeView(): Phase2C25D2BBeforeView {
  const lost = (runKey: string, generated: number | null) => ({ runKey, mode: runKey.includes('instrumented') ? 'instrumented' : 'minimal', attempt: 1, orientationId: runKey.split('#')[0],
    workIndex: 0, status: 'page_crashed', firstCandidateNoticed: false, searchStartToLossMs: 20000, workerLifetimeMs: 21000, result: null,
    lastProgress: generated === null ? null : progress(8, generated), crashDump: { v8OomLocation: 'x' }, browserOomEvidence: 'explicit_v8_oom_crash_key',
    cdp: { samples: 40, maxUsedBytes: 4e9, lastUsedBytes: 4e9 } })
  return { measuredHead: 'b', exportSha256: 'e', evidenceSha256: 'a', contexts: [
    { orientationId: 'rep-a', workIndex: 0, classification: 'inconclusive_page_or_browser_crash' },
    { orientationId: 'rep-b', workIndex: 0, classification: 'inconclusive_page_or_browser_crash' },
    { orientationId: 'ctl', workIndex: 0, classification: 'browser_no_failure' },
  ], runs: [lost('rep-a#0:minimal:a1', null), lost('rep-a#0:instrumented:a1', 800), lost('rep-b#0:minimal:a1', null), lost('rep-b#0:instrumented:a1', 1000)] as never }
}

function analyse(options: { repA?: 'normal' | 'lost' | 'counts_mismatch'; repB?: 'lost' | 'native'; ctlKey?: string } = {}) {
  const records: Phase2C25BRunRecord[] = []
  const runs: Phase2C25BExternalRun[] = []
  const repA = options.repA ?? 'normal'
  for (const mode of ['minimal', 'instrumented'] as const) {
    const runKey = `rep-a#0:${mode}:a1`
    if (repA === 'lost') runs.push(lostRun(runKey, mode === 'instrumented' ? 5000 : null))
    else {
      records.push(pageRecord(runKey, mode, 'stopped_by_extent_before_candidate', SUMMARY_EXTENT, null,
        mode === 'instrumented' ? (repA === 'counts_mismatch' ? { ...COUNTS, keepBonuses: 1 } : COUNTS) : null))
      runs.push(externalRun(runKey))
    }
  }
  for (const attempt of [1, 2]) for (const mode of ['minimal', 'instrumented'] as const) {
    const runKey = `rep-b#0:${mode}:a${attempt}`
    if (options.repB === 'native') {
      records.push({ ...pageRecord(runKey, mode, 'worker_error_before_first_candidate', SUMMARY_EXTENT, null, null), result: null, semanticDigest: null,
        error: { source: 'native_error' } } as unknown as Phase2C25BRunRecord)
      runs.push(externalRun(runKey))
    } else runs.push(lostRun(runKey, mode === 'instrumented' ? 3000 : null))
  }
  for (const mode of ['minimal', 'instrumented'] as const) {
    const runKey = `ctl#0:${mode}:a1`
    records.push(pageRecord(runKey, mode, 'first_candidate', SUMMARY_FIRST, options.ctlKey ?? 'k', mode === 'instrumented' ? COUNTS : null))
    runs.push(externalRun(runKey))
  }
  return analyzePhase2C25D2B({ pages: [{ records } as unknown as Phase2C25BPageExport], external: { runs } as unknown as Phase2C25BExternalEvidence,
    workload: WORKLOAD, node: NODE, before: beforeView() })
}

describe('Phase 2-C2.5-D2-b analysis', () => {
  it('classifies each context by the unchanged Phase 2-C2.5-B rule, keeping page loss and the V8 OOM key apart', () => {
    const result = analyse()
    const [repA, repB, ctl] = result.contexts
    expect(repA.classification).toBe('browser_no_failure')
    expect(repB.classification).toBe('inconclusive_page_or_browser_crash')
    expect(repB.attempts).toHaveLength(2)
    expect(repB.browserOomEvidenceRuns).toBe(4)
    expect(repB.attempts[0].auxiliary.lostDuringSearchBeforeFirstCandidate).toEqual([true, true])
    expect(ctl.classification).toBe('browser_no_failure')
    expect(result.verdict).toMatchObject({ formal: 'mixed', semanticFailures: [] })
    expect(result.verdict.perContext.map(c => c.classification)).toEqual(['browser_no_failure', 'inconclusive_page_or_browser_crash', 'browser_no_failure'])
    expect(result.totals).toMatchObject({ runs: 8, pageCrashes: 4, nativeWorkerFailures: 0, structuredErrors: 0, timeouts: 0, firstCandidateReachedRuns: 2, attemptsRepeated: 1 })
    // A lost run is external-only; its last progress is the relayed one.
    const lost = result.runs.find(run => run.runKey === 'rep-b#0:instrumented:a1')!
    expect(lost).toMatchObject({ source: 'external_only', status: 'page_crashed', browserOomEvidence: 'explicit_v8_oom_crash_key' })
    expect(lost.lastProgress?.gogma.totalGeneratedStates).toBe(3000)
  })

  it('reports a native Worker failure in both modes before the first Candidate as reproduced, never as OOM or no Candidate', () => {
    const repB = analyse({ repB: 'native' }).contexts[1]
    expect(repB.classification).toBe('browser_search_failure_reproduced')
    expect(repB.browserOomEvidenceRuns).toBe(0)
    expect(repB.nodeParity.every(p => !p.applicable)).toBe(true)
  })

  it('accepts a Node-terminated representative only with full Node D2-a parity in both modes', () => {
    const good = analyse().contexts[0]
    expect(good.nodeTerminatedRepresentativeAcceptance).toEqual({ accepted: true, classification: 'browser_no_failure', nodeParityHolds: true })
    expect(good.nodeParity.map(p => p.matches)).toEqual([true, true])
    expect(good.nodeParity[0].predictionCountsMatch).toBeNull()
    const mismatch = analyse({ repA: 'counts_mismatch' })
    expect(mismatch.contexts[0].nodeTerminatedRepresentativeAcceptance).toMatchObject({ accepted: false, nodeParityHolds: false })
    // A semantic failure takes precedence over any memory result.
    expect(mismatch.verdict.formal).toBe('semantic_failure')
    const lost = analyse({ repA: 'lost' }).contexts[0]
    expect(lost.nodeTerminatedRepresentativeAcceptance).toMatchObject({ accepted: false })
    expect(lost.classification).toBe('inconclusive_page_or_browser_crash')
    // A Node OOM representative has no Node parity to accept.
    expect(analyse().contexts[1].nodeTerminatedRepresentativeAcceptance).toBeNull()
  })

  it('requires control parity with Node D2-a in status, Search summary, key, extent / exhaustion and prediction counts', () => {
    expect(analyse().contexts[2].controlSemanticParity).toBe(true)
    const bad = analyse({ ctlKey: 'other' })
    expect(bad.contexts[2].controlSemanticParity).toBe(false)
    expect(bad.verdict.formal).toBe('semantic_failure')
    const parity = phase2c25d2bNodeParity({ runKey: 'x', mode: 'minimal', status: 'stopped_by_extent_before_candidate', result: { searchSummary: { ...SUMMARY_EXTENT, exhausted: true },
      firstCandidateKeySha256: null, predictionCounts: null } as never }, NODE.contexts[0].minimal)
    expect(parity).toMatchObject({ applicable: true, extentAndExhaustedMatch: false, searchSummaryMatches: false, matches: false })
  })

  it('compares the Browser before (Phase 2-C2.5-B) with the Browser after on the same contexts, as progress only', () => {
    const [repA, repB] = analyse().contexts
    expect(repA.browserBefore.classification).toBe('inconclusive_page_or_browser_crash')
    expect(repA.browserAfter.runs.map(r => r.status)).toEqual(['stopped_by_extent_before_candidate', 'stopped_by_extent_before_candidate'])
    expect(repA.browserAfter.runs[1].searchElapsedMs).toBe(5000)
    expect(repB.progressDelta).toMatchObject({ beforeRunKey: 'rep-b#0:instrumented:a1', afterRunKey: expect.stringMatching(/^rep-b#0:instrumented:a[12]$/) })
    expect(repB.progressDelta.progressRatio?.cumulativeGogmaGenerated).toBe(3)
    expect(repB.browserBefore.runs[1]).toMatchObject({ status: 'page_crashed', cdpSampledMaxUsedBytes: 4e9, searchStartToLossMs: 20000 })
  })

  it('keeps the repeat rule of Phase 2-C2.5-B', () => {
    const pair = (a: string, b: string, attempt = 1) => phase2c25bRepeatDecision({ attempt, minimal: { status: a as never, semanticDigest: 'x' },
      instrumented: { status: b as never, semanticDigest: 'x' }, cdpAttachFailure: false })
    expect(pair('stopped_by_extent_before_candidate', 'stopped_by_extent_before_candidate').repeat).toBe(false)
    expect(pair('page_crashed', 'page_crashed').repeat).toBe(true)
    expect(pair('page_crashed', 'page_crashed', 2).repeat).toBe(false)
    expect(pair('worker_error_before_first_candidate', 'worker_error_before_first_candidate').repeat).toBe(true)
  })
})

// ---------------------------------------------------------------- formal series completeness

type SeriesExternal = Phase2C25D2BFormalSeriesInput['external']
type SeriesRun = SeriesExternal['runs'][number]
type SeriesDecision = NonNullable<SeriesExternal['repeatDecisions']>[number]
type CompleteSeries = SeriesExternal & { runs: SeriesRun[]; repeatDecisions: SeriesDecision[] }

describe('Phase 2-C2.5-D2-b formal series completeness', () => {
  const workload = phase2c25d2bWorkload(parsePhase2C25BEvidence(c25aEvidence), c25aEvidence)
  /** The committed formal external evidence: the complete series (5 contexts, 14 runs, 2 repeated contexts). */
  const complete = (): CompleteSeries => structuredClone(d2bExternal) as unknown as CompleteSeries
  const validate = (external: SeriesExternal) => validatePhase2C25D2BFormalSeries({ workload, external })
  const is = (context: string, mode?: string, attempt?: number) => (run: SeriesRun) => `${run.orientationId}#${run.workIndex}` === context
    && (mode === undefined || run.mode === mode) && (attempt === undefined || run.attempt === attempt)
  const without = (external: CompleteSeries, predicate: (run: SeriesRun) => boolean): CompleteSeries => ({ ...external, runs: external.runs.filter(run => !predicate(run)) })
  const copyOf = (external: CompleteSeries, predicate: (run: SeriesRun) => boolean, patch: Partial<SeriesRun>): SeriesRun =>
    ({ ...structuredClone(external.runs.find(predicate)!), ...patch })

  it('A: accepts the committed formal series, deriving 14 expected runs from the workload and the repeat rule', () => {
    const result = validate(complete())
    expect(result).toMatchObject({ valid: true, workloadContexts: 5, expectedRuns: 14, actualRuns: 14, repeatedContexts: ['c12-p0#0', 'c2-p1#0'], duplicateRunKeys: [],
      duplicateLogicalRuns: [], missingRuns: [], unexpectedRuns: [], foreignRuns: [], attemptsAboveTwo: [], driverIssues: [], issues: [] })
    expect(result.repeatDecisions).toEqual({ expected: 7, recorded: 7, missing: [], duplicate: [], unexpected: [], mismatches: [] })
  })

  it('A: accepts a synthetic complete series and derives its expected run count from the rule', () => {
    const run = (context: string, mode: 'minimal' | 'instrumented', attempt: number, lost: boolean): SeriesRun => {
      const [orientationId, workIndex] = context.split('#')
      return { runKey: `${context}:${mode}:a${attempt}`, orientationId, workIndex: Number(workIndex), mode, attempt,
        driverStatus: lost ? 'page_crashed' : 'page_settled', pageStatus: lost ? null : 'stopped_by_extent_before_candidate',
        workerTargets: [{ samples: 3 }] as never, ...(lost ? {} : { semanticDigest: 'same' }) } as SeriesRun
    }
    const external: SeriesExternal = { driver: { modes: ['minimal', 'instrumented'], allowRepeat: true, only: null }, completedAt: 1,
      runs: [run('a#0', 'minimal', 1, false), run('a#0', 'instrumented', 1, false), run('b#0', 'minimal', 1, true), run('b#0', 'instrumented', 1, true),
        run('b#0', 'minimal', 2, true), run('b#0', 'instrumented', 2, true)],
      repeatDecisions: [{ context: 'a#0', attempt: 1, decision: { repeat: false, reasons: [] } }, { context: 'b#0', attempt: 1, decision: { repeat: true, reasons: ['page_or_browser_crash'] } },
        { context: 'b#0', attempt: 2, decision: { repeat: false, reasons: ['page_or_browser_crash'] } }] }
    const result = validatePhase2C25D2BFormalSeries({ workload: [{ orientationId: 'a', workIndex: 0 }, { orientationId: 'b', workIndex: 0 }], external })
    expect(result).toMatchObject({ valid: true, expectedRuns: 6, actualRuns: 6, repeatedContexts: ['b#0'] })
  })

  it('B: fails when a whole context is missing', () => {
    const base = complete()
    const result = validate({ ...without(base, is('c8-p1#0')), repeatDecisions: base.repeatDecisions.filter(d => d.context !== 'c8-p1#0') })
    expect(result.valid).toBe(false)
    expect(result.missingRuns).toEqual(['c8-p1#0:minimal:a1', 'c8-p1#0:instrumented:a1'])
  })

  it('C: fails when one mode of a context is missing', () => {
    const result = validate(without(complete(), is('c8-p1#0', 'instrumented', 1)))
    expect(result.valid).toBe(false)
    expect(result.missingRuns).toEqual(['c8-p1#0:instrumented:a1'])
  })

  it('D: fails when a required repeat was not run', () => {
    const base = complete()
    const result = validate({ ...without(base, is('c12-p0#0', undefined, 2)), repeatDecisions: base.repeatDecisions.filter(d => !(d.context === 'c12-p0#0' && d.attempt === 2)) })
    expect(result.valid).toBe(false)
    expect(result.missingRuns).toEqual(['c12-p0#0:minimal:a2', 'c12-p0#0:instrumented:a2'])
  })

  it('E: fails when the repeated attempt 2 has one mode only', () => {
    const result = validate(without(complete(), is('c12-p0#0', 'instrumented', 2)))
    expect(result.valid).toBe(false)
    expect(result.missingRuns).toEqual(['c12-p0#0:instrumented:a2'])
  })

  it('F: fails on an attempt 2 after a pair that did not need a repeat', () => {
    const base = complete()
    const extra = (['minimal', 'instrumented'] as const).map(mode => copyOf(base, is('c8-p1#0', mode, 1), { attempt: 2, runKey: `c8-p1#0:${mode}:a2` }))
    const result = validate({ ...base, runs: [...base.runs, ...extra] })
    expect(result.valid).toBe(false)
    expect(result.unexpectedRuns).toEqual(['c8-p1#0:minimal:a2', 'c8-p1#0:instrumented:a2'])
  })

  it('G: fails on an attempt above 2', () => {
    const base = complete()
    const result = validate({ ...base, runs: [...base.runs, copyOf(base, is('c12-p0#0', 'minimal', 2), { attempt: 3, runKey: 'c12-p0#0:minimal:a3' })] })
    expect(result.valid).toBe(false)
    expect(result.attemptsAboveTwo).toEqual(['c12-p0#0:minimal:a3'])
  })

  it('H: fails on a duplicate runKey', () => {
    const base = complete()
    const result = validate({ ...base, runs: [...base.runs, copyOf(base, is('c0-p0#0', 'minimal', 1), {})] })
    expect(result.valid).toBe(false)
    expect(result.duplicateRunKeys).toEqual(['c0-p0#0:minimal:a1'])
  })

  it('I: fails on a duplicate logical run under another runKey', () => {
    const base = complete()
    const result = validate({ ...base, runs: [...base.runs, copyOf(base, is('c0-p0#0', 'minimal', 1), { runKey: 'renamed' })] })
    expect(result.valid).toBe(false)
    expect(result.duplicateRunKeys).toEqual([])
    expect(result.duplicateLogicalRuns).toEqual(['c0-p0#0:minimal:a1'])
  })

  it('J: fails when a pair has no recorded repeat decision', () => {
    const base = complete()
    const result = validate({ ...base, repeatDecisions: base.repeatDecisions.filter(d => d.context !== 'c0-p0#0') })
    expect(result.valid).toBe(false)
    expect(result.repeatDecisions.missing).toEqual(['c0-p0#0:a1'])
  })

  it('K: fails on a duplicate repeat decision', () => {
    const base = complete()
    const result = validate({ ...base, repeatDecisions: [...base.repeatDecisions, structuredClone(base.repeatDecisions[0])] })
    expect(result.valid).toBe(false)
    expect(result.repeatDecisions.duplicate).toEqual([`${base.repeatDecisions[0].context}:a${base.repeatDecisions[0].attempt}`])
  })

  it('L: fails when a recorded decision differs from the recomputed one, or names an attempt not run', () => {
    const base = complete()
    const decisions = base.repeatDecisions.map(d => d.context === 'c12-p0#0' && d.attempt === 1 ? { ...d, decision: { repeat: false, reasons: [] } } : d)
    const result = validate({ ...base, repeatDecisions: decisions })
    expect(result.valid).toBe(false)
    expect(result.repeatDecisions.mismatches).toHaveLength(1)
    expect(result.repeatDecisions.mismatches[0]).toMatch(/^c12-p0#0:a1 recorded/)
    const orphan = validate({ ...base, repeatDecisions: [...base.repeatDecisions, { context: 'c0-p0#0', attempt: 2, decision: { repeat: false, reasons: [] } }] })
    expect(orphan.valid).toBe(false)
    expect(orphan.repeatDecisions.unexpected).toEqual(['c0-p0#0:a2'])
  })

  it('M: fails on a run outside the workload', () => {
    const base = complete()
    const result = validate({ ...base, runs: [...base.runs, copyOf(base, is('c0-p0#0', 'minimal', 1), { orientationId: 'foreign', runKey: 'foreign#0:minimal:a1' })] })
    expect(result.valid).toBe(false)
    expect(result.foreignRuns).toEqual(['foreign#0:minimal:a1'])
  })

  it('N / O: fails unless the driver ran both modes with repeat enabled, on the whole workload, to completion', () => {
    const base = complete()
    expect(validate({ ...base, driver: { ...base.driver, modes: ['minimal'] } })).toMatchObject({ valid: false, driverIssues: [expect.stringMatching(/driver\.modes/)] })
    expect(validate({ ...base, driver: { ...base.driver, modes: ['minimal', 'instrumented', 'other'] } }).valid).toBe(false)
    expect(validate({ ...base, driver: { ...base.driver, allowRepeat: false } })).toMatchObject({ valid: false, driverIssues: ['driver.allowRepeat is not true'] })
    expect(validate({ ...base, driver: { ...base.driver, only: ['c0-p0#0'] } }).valid).toBe(false)
    expect(validate({ ...base, completedAt: undefined }).valid).toBe(false)
  })

  it('makes the formal analyzer run the validator before the analysis and stop with an error on an incomplete series', () => {
    const analyzer = Object.values(scriptSources)[0]
    const gate = analyzer.indexOf('validatePhase2C25D2BFormalSeries(')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(analyzer.indexOf('analyzePhase2C25D2B('))
    expect(analyzer).toMatch(/Formal series incomplete: /)
    expect(analyzer).toMatch(/formalSeriesValidation,/)
    expect(analyzer).not.toMatch(/pageSessions\s*===/)
  })
})

// ---------------------------------------------------------------- statements / heap wording

describe('Phase 2-C2.5-D2-b statements', () => {
  const statements = phase2c25d2bStatements(analyse(), { pageRealmJsHeapSizeLimit: 4_395_630_592, workerRealmJsHeapSizeLimit: null })
  const all = [...statements.formal, ...statements.notYet].join('\n')

  it('claims a cleared representative only with its Node parity, and never that the Browser memory problem is solved while one remains', () => {
    expect(statements.formal.some(s => /rep-a#0 no longer reproduced the Phase 2-C2\.5-B renderer loss/.test(s))).toBe(true)
    expect(statements.formal.some(s => /rep-b#0 no longer/.test(s))).toBe(false)
    expect(statements.notYet[0]).toMatch(/That the Browser memory problem is solved: rep-b#0 \(inconclusive_page_or_browser_crash\)/)
    expect(all).not.toMatch(/memory problem (?:is|was) solved\./)
    expect(all).toMatch(/not bytes per state/)
  })

  it('keeps the unknown Worker limit apart from the page realm reference value and never compares heap limits with Node', () => {
    expect(all).toMatch(/Dedicated Worker realm did not expose its own jsHeapSizeLimit, so the Worker's actual heap limit was not measured \(unknown\) and is not taken to equal the page realm value/)
    expect(all).toMatch(/a value of another realm given for reference only/)
    expect(all).toMatch(/Node heap bytes and limits are not compared with the Browser/)
    expect(all).not.toMatch(/(?:Worker|Browser)[^;.]*heap limit[^;.]*(?:about|≈|~)\s*4(?:\.\d+)?\s*GiB/i)
    expect(all).not.toMatch(/before the renderer loss/)
    expect(phase2c25d2bStatements(analyse(), { pageRealmJsHeapSizeLimit: null, workerRealmJsHeapSizeLimit: 1234 }).notYet.join('\n'))
      .toMatch(/Dedicated Worker realm reported its own jsHeapSizeLimit 1234 bytes/)
  })
})

// ---------------------------------------------------------------- committed comparison sources

describe('Phase 2-C2.5-D2-b comparison sources', () => {
  it('reads the committed Node D2-a result and Phase 2-C2.5-B results for the workload contexts', () => {
    const node = parsePhase2C25D2ANodeResult(d2aResult)
    const before = parsePhase2C25BBrowserBefore(c25bResults)
    const workload = phase2c25d2bWorkload(parsePhase2C25BEvidence(c25aEvidence), c25aEvidence)
    for (const context of workload) {
      expect(node.contexts.some(c => c.orientationId === context.orientationId && c.workIndex === context.workIndex)).toBe(true)
      expect(before.contexts.some(c => c.orientationId === context.orientationId && c.workIndex === context.workIndex)).toBe(true)
    }
    const statuses = workload.map(c => node.contexts.find(n => n.orientationId === c.orientationId && n.workIndex === c.workIndex)!.instrumented.status)
    expect(statuses).toEqual(['stopped_by_extent_before_candidate', 'out_of_memory', 'out_of_memory', 'first_candidate', 'stopped_by_extent_before_candidate'])
    expect(workload.slice(0, 3).map(c => before.contexts.find(b => b.orientationId === c.orientationId && b.workIndex === c.workIndex)!.classification))
      .toEqual(['inconclusive_page_or_browser_crash', 'inconclusive_page_or_browser_crash', 'inconclusive_page_or_browser_crash'])
    expect(node.exportSha256).toBe(before.exportSha256)
    expect(() => parsePhase2C25D2ANodeResult({ ...d2aResult, provenance: { ...d2aResult.provenance, formal: false } })).toThrow(/formal/)
    expect(() => parsePhase2C25BBrowserBefore({ ...c25bResults, runs: null })).toThrow(/runs/)
  })
})

// ---------------------------------------------------------------- isolation

const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'PHASE2C1_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./plannerGlobalPhase2C25D2B*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const workerSources = import.meta.glob('../workers/plannerGlobalPhase2C25D2B.worker.benchmark*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const pageSources = import.meta.glob('../pages/PlannerGlobalPhase2C25D2BBenchmarkPage.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25d2b*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const benchmarkOnly = [/^\.\.\/benchmark\.tsx$/, /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/, /^\.\.\/pages\/[A-Za-z0-9]+BenchmarkPage(\.test)?\.tsx$/,
  /^\.\.\/workers\/[A-Za-z0-9]+\.worker\.benchmark(\.entry)?(\.test)?\.ts$/, /\.test\.tsx?$/]

describe('Phase 2-C2.5-D2-b isolation', () => {
  const runtime = Object.entries({ ...benchmarkSources, ...workerSources, ...pageSources }).filter(([path]) => !/\.test\.tsx?$/.test(path))

  it('keeps the oracle, hard-coded IDs / Counter positions and file reads out of every runtime module', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual(['../pages/PlannerGlobalPhase2C25D2BBenchmarkPage.tsx', '../workers/plannerGlobalPhase2C25D2B.worker.benchmark.entry.ts',
      '../workers/plannerGlobalPhase2C25D2B.worker.benchmark.ts', './plannerGlobalPhase2C25D2B.ts', './plannerGlobalPhase2C25D2BAnalysis.ts', './plannerGlobalPhase2C25D2BHarness.ts',
      './plannerGlobalPhase2C25D2BProtocol.ts'])
    for (const [path, source] of runtime) {
      expect(source, path).not.toMatch(ORACLE_NAMES)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source, path).not.toMatch(/['"`]c\d+-p\d+|build-list\.fnv1a32-|fnv1a32:[0-9a-f]{8}/)
      expect(source, path).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
      expect(source, path).not.toMatch(/from ['"][^'"]*(?:\/db\/|dexie|repositories|importExportService)/i)
      expect(source, path).not.toMatch(/\b(?:indexedDB|localStorage|sessionStorage)\s*\.|\bnew Dexie\b/)
    }
    const scripts = Object.values(scriptSources)
    expect(scripts.length).toBe(1)
    expect(scripts[0]).not.toMatch(ORACLE_NAMES)
    expect(scripts[0]).not.toMatch(/visitPlannerAlternativeCandidates|createProductionPlan|derivePhase2C25APreSearchContexts/)
    expect(scripts[0]).toMatch(/calculationCodeChangedSinceMeasuredHead/)
    expect(scripts[0]).toMatch(/raw evidence is never rewritten/)
  })

  it('has no D2-b Search implementation: the Worker reuses the Phase 2-C2.5-B controller, and never receives the evidence or a comparison source', () => {
    const worker = workerSources['../workers/plannerGlobalPhase2C25D2B.worker.benchmark.ts']
    expect(worker).toMatch(/createPhase2C25BController\(/)
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const source of [worker, benchmarkSources['./plannerGlobalPhase2C25D2BProtocol.ts'], benchmarkSources['./plannerGlobalPhase2C25D2BHarness.ts']].map(code)) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|TargetSearchScheduler|bonusStream|skillStream|lazyIdealCross/)
      expect(source).not.toMatch(/PHASE2C25A_RESULT|D2A_RESULT|PHASE2C25B_RESULTS|parsePhase2C25D2ANodeResult|parsePhase2C25BBrowserBefore/)
    }
    // The page needs neither the D2-a result nor the Phase 2-C2.5-B results.
    expect(pageSources['../pages/PlannerGlobalPhase2C25D2BBenchmarkPage.tsx']).not.toMatch(/Analysis|D2A|PHASE2C25B_RESULTS/)
    expect(benchmarkSources['./plannerGlobalPhase2C25D2B.ts']).toMatch(/selectPhase2C25CWorkload\(/)
  })

  it('is reached by no Production module, and Production keeps its Worker protocols, defaults, schema and versions', () => {
    const productionPaths = Object.keys(production).filter(path => !benchmarkOnly.some(pattern => pattern.test(path)))
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter(path => /plannerGlobalPhase2C25D2B|pg2c25d2b|PlannerGlobalPhase2C25D2BBenchmarkPage/i.test(production[path]))).toEqual([])
    for (const path of ['../workers/plannerWorkerContracts.ts', '../workers/planner.worker.ts', '../workers/planner.worker.production.ts', '../workers/contracts.ts', '../workers/search.worker.ts']) {
      expect(production[path], path).toBeDefined()
      expect(production[path], path).not.toMatch(/pg2c25d2b|Phase2C25D2B/)
    }
    expect(production['../pages/BenchmarkApp.tsx']).toMatch(/PlannerGlobalPhase2C25D2BBenchmarkPage/)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
