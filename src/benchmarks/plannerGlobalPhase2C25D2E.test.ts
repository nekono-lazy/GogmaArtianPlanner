import { describe, expect, it } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import d2bResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json'
import d2dResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json'
import d2eResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2E_RESULT.json'
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
import { attachPhase2C25D2EWorker, type Phase2C25D2EWorkerScope } from '../workers/plannerGlobalPhase2C25D2E.worker.benchmark'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { derivePhase2C25APreSearchContexts, runPhase2C25ASearchOnly } from './plannerGlobalPhase2C25A'
import { derivePhase2C25BContexts } from './plannerGlobalPhase2C25B'
import type { Phase2C25BExternalEvidence, Phase2C25BExternalRun, Phase2C25BPageExport } from './plannerGlobalPhase2C25BAnalysis'
import { parsePhase2C25BEvidence, phase2c25bRangeReservation, type Phase2C25BEvidenceView } from './plannerGlobalPhase2C25BEvidence'
import { phase2c25bRepeatDecision, type Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import { PHASE2C25B_RUN_BUDGET_MS, type Phase2C25BSearchRecord } from './plannerGlobalPhase2C25BProtocol'
import { phase2c25d2bWorkload } from './plannerGlobalPhase2C25D2B'
import { validatePhase2C25D2BFormalSeries, type Phase2C25D2BFormalSeriesInput } from './plannerGlobalPhase2C25D2BAnalysis'
import { PHASE2C25D2B_RUN_BUDGET_MS } from './plannerGlobalPhase2C25D2BProtocol'
import {
  parsePhase2C25D2EReference,
  PHASE2C25D2E_D2D_REFERENCE_REQUIREMENTS,
  phase2c25d2eWorkload,
  type Phase2C25D2EReference,
  type Phase2C25D2EWorkloadContext,
} from './plannerGlobalPhase2C25D2E'
import {
  analyzePhase2C25D2E,
  parsePhase2C25D2BBrowserBeforeResult,
  parsePhase2C25D2DNodeResult,
  phase2c25d2eBrowserEnvironmentParity,
  phase2c25d2eCdpDetail,
  phase2c25d2eProgressParity,
  phase2c25d2eStatements,
  type Phase2C25D2EBeforeView,
  type Phase2C25D2ENodeMode,
  type Phase2C25D2ENodeView,
} from './plannerGlobalPhase2C25D2EAnalysis'
import { adaptPhase2C25D2EWorker, createPhase2C25D2ERunner, phase2c25d2eBrowserEnvironmentIssue, type Phase2C25D2EBrowserEnvironmentState } from './plannerGlobalPhase2C25D2EHarness'
import {
  fromPhase2C25D2ERequest,
  fromPhase2C25D2EResponse,
  PHASE2C25D2E_DRIVER_RUN_BUDGET_MS,
  PHASE2C25D2E_DRIVER_RUN_MARGIN_MS,
  PHASE2C25D2E_PROTOCOL_VERSION,
  PHASE2C25D2E_RUN_BUDGET_MS,
  toPhase2C25D2ERequest,
  toPhase2C25D2EResponse,
} from './plannerGlobalPhase2C25D2EProtocol'

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha256Bytes = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))
const sha256 = async (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer as ArrayBuffer)
const bytesOf = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer as ArrayBuffer
const EXPORT_BYTES = bytesOf('{"synthetic":"export-d2e"}')
const clone = <T>(value: T): T => structuredClone(value)

// ---------------------------------------------------------------- workload and the D2-d reference

describe('Phase 2-C2.5-D2-e workload', () => {
  const view = parsePhase2C25BEvidence(c25aEvidence)
  const reference = parsePhase2C25D2EReference(d2dResult)

  it('checks the committed D2-d RESULT as a formal reference', () => {
    expect(reference.validation).toEqual({ ...PHASE2C25D2E_D2D_REFERENCE_REQUIREMENTS })
    expect(reference.validation).toMatchObject({ formal: true, formalRunValidationValid: true, contexts: 5, primaryLeftOom: 2, primaryEndedNormally: 2,
      semanticParityWithD2A: true, modeSemanticParityFailures: 0 })
    expect(reference.measuredHead).toBe(d2dResult.provenance.measuredHead)
    expect(reference.exportSha256).toBe(view.exportSha256)
  })

  it('is exactly the D2-d workload, derived by the D2-b rule from the C2.5-A evidence and confirmed against the D2-d workloadSelection', () => {
    const workload = phase2c25d2eWorkload(view, c25aEvidence, reference)
    const rule = phase2c25d2bWorkload(view, c25aEvidence)
    expect(workload.map(c => [c.orientationId, c.workIndex, c.targetWeaponId, c.contextDigest, c.selectionRole]))
      .toEqual(rule.map(c => [c.orientationId, c.workIndex, c.targetWeaponId, c.contextDigest, c.selectionRole]))
    const selection = [...d2dResult.workloadSelection.primary, ...d2dResult.workloadSelection.clearedReferences, ...d2dResult.workloadSelection.controls]
    expect(new Set(workload.map(c => `${c.orientationId}#${c.workIndex}:${c.targetWeaponId}:${c.contextDigest}:${c.d2dRole}`)))
      .toEqual(new Set(selection.map(s => `${s.orientationId}#${s.workIndex}:${s.targetWeaponId}:${s.contextDigest}:${s.role}`)))
    expect(workload).toHaveLength(5)
    expect(workload.map(c => c.d2dRole).sort()).toEqual(['cleared_reference', 'control_first_candidate', 'control_stopped_by_extent', 'primary_oom', 'primary_oom'])
  })

  it.each([
    ['provenance.formal', (r: typeof d2dResult) => { (r.provenance as { formal: unknown }).formal = false }, /formal is false/],
    ['formalRunValidation.valid', (r: typeof d2dResult) => { (r.formalRunValidation as { valid: unknown }).valid = false }, /formalRunValidationValid is false/],
    ['contexts', (r: typeof d2dResult) => { r.contexts.pop() }, /contexts is 4, not 5/],
    ['primaryLeftOom', (r: typeof d2dResult) => { r.totals.primaryLeftOom = 1 }, /primaryLeftOom is 1/],
    ['primaryEndedNormally', (r: typeof d2dResult) => { r.totals.primaryEndedNormally = 1 }, /primaryEndedNormally is 1/],
    ['semanticParityWithD2A', (r: typeof d2dResult) => { r.totals.semanticParityWithD2A = false }, /semanticParityWithD2A is false/],
    ['modeSemanticParityFailures', (r: typeof d2dResult) => { r.totals.modeSemanticParityFailures = 1 }, /modeSemanticParityFailures is 1/],
    ['unselected', (r: typeof d2dResult) => { (r.workloadSelection.unselected as unknown[]).push({}) }, /unselected is not empty/],
    ['a misplaced role', (r: typeof d2dResult) => { r.workloadSelection.controls[0].role = 'primary_oom' }, /does not belong to controls/],
  ])('fails closed when the D2-d RESULT is not a formal reference: %s', (_name, mutate, pattern) => {
    const broken = clone(d2dResult)
    mutate(broken)
    expect(() => parsePhase2C25D2EReference(broken)).toThrow(pattern)
  })

  it.each([
    ['another context digest', (r: Phase2C25D2EReference) => ({ ...r, selection: r.selection.map((s, i) => i === 0 ? { ...s, contextDigest: 'fnv1a32:00000000' } : s) }), /another Target or context digest/],
    ['another Target', (r: Phase2C25D2EReference) => ({ ...r, selection: r.selection.map((s, i) => i === 1 ? { ...s, targetWeaponId: 'target.other' } : s) }), /another Target or context digest/],
    ['a missing context', (r: Phase2C25D2EReference) => ({ ...r, selection: r.selection.slice(1) }), /workloads differ/],
    ['a foreign context', (r: Phase2C25D2EReference) => ({ ...r, selection: r.selection.map((s, i) => i === 0 ? { ...s, orientationId: 'foreign' } : s) }), /workloads differ/],
    ['a role of another family', (r: Phase2C25D2EReference) => ({ ...r, selection: r.selection.map(s => s.role === 'cleared_reference' ? { ...s, role: 'control_first_candidate' as const } : s) }), /disagrees with the D2-b selection role/],
    ['another Export', (r: Phase2C25D2EReference) => ({ ...r, exportSha256: 'other' }), /another Export/],
  ])('fails closed when the D2-d workload differs from the D2-b rule: %s', (_name, mutate, pattern) => {
    expect(() => phase2c25d2eWorkload(view, c25aEvidence, mutate(reference))).toThrow(pattern)
  })
})

// ---------------------------------------------------------------- protocol

describe('Phase 2-C2.5-D2-e protocol', () => {
  it('renames only the prefix, on the D2-e wire, and ignores Phase 2-C2.5-B and D2-b messages', () => {
    const request = { type: 'pg2c25b_benchmark_contexts' as const, requestId: 'r', input: {} as never, orientationIds: ['x'] }
    const wire = toPhase2C25D2ERequest(request)
    expect(wire.type).toBe('pg2c25d2e_benchmark_contexts')
    expect(fromPhase2C25D2ERequest(wire)).toEqual(request)
    expect(fromPhase2C25D2ERequest(request)).toBeNull()
    expect(fromPhase2C25D2ERequest({ ...request, type: 'pg2c25d2b_benchmark_contexts' })).toBeNull()
    const ready = toPhase2C25D2EResponse({ type: 'pg2c25b_benchmark_ready', environment: { protocolVersion: 'planner-global-phase2c25b', userAgent: null, hardwareConcurrency: null,
      crossOriginIsolated: null, performanceMemory: null, messageChannel: true, rngEngineVersion: 'v' } })
    expect(ready).toMatchObject({ type: 'pg2c25d2e_benchmark_ready', environment: { protocolVersion: PHASE2C25D2E_PROTOCOL_VERSION } })
    expect(fromPhase2C25D2EResponse(ready)?.type).toBe('pg2c25b_benchmark_ready')
    expect(fromPhase2C25D2EResponse({ type: 'pg2c25b_benchmark_first_candidate', requestId: 'r', timeToFirstMs: 1 })).toBeNull()
    expect(fromPhase2C25D2EResponse({ type: 'pg2c25d2b_benchmark_first_candidate', requestId: 'r', timeToFirstMs: 1 })).toBeNull()
    expect(fromPhase2C25D2EResponse({ type: 'pg2c25d2e_benchmark_unknown' })).toBeNull()
    expect(fromPhase2C25D2EResponse(null)).toBeNull()
  })

  it('keeps the D2-b 20-minute Search budget, and the driver waits that plus a fixed margin only', () => {
    expect(PHASE2C25D2E_RUN_BUDGET_MS).toBe(PHASE2C25B_RUN_BUDGET_MS)
    expect(PHASE2C25D2E_RUN_BUDGET_MS).toBe(PHASE2C25D2B_RUN_BUDGET_MS)
    expect(PHASE2C25D2E_RUN_BUDGET_MS).toBe(20 * 60 * 1000)
    expect(PHASE2C25D2E_DRIVER_RUN_MARGIN_MS).toBeGreaterThan(0)
    expect(PHASE2C25D2E_DRIVER_RUN_BUDGET_MS).toBe(PHASE2C25D2E_RUN_BUDGET_MS + PHASE2C25D2E_DRIVER_RUN_MARGIN_MS)
    // The committed D2-b run used the same page budget and the same driver wait (20 + 2 minutes).
    expect(d2bResult.conditions.runBudgetMs).toBe(PHASE2C25D2E_RUN_BUDGET_MS)
    expect(d2bResult.conditions.driverRunBudgetMs).toBe(PHASE2C25D2E_DRIVER_RUN_BUDGET_MS)
  })
})

// ---------------------------------------------------------------- runner (synthetic scenario, in-process D2-e Worker)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

/** The Phase 2-C2.5-A synthetic contention: A and B contend for Gogma 10; with either fixed, the other has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.d2e.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.d2e.b', { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.d2e.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.d2e.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
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
  }
}

/**
 * A D2-d-RESULT-shaped reference over the synthetic evidence: every searchable context a control, padded to the 5 contexts a
 * formal reference holds with contexts the synthetic evidence does not have (the synthetic workload ignores them).
 */
async function syntheticReference(evidence: Awaited<ReturnType<typeof syntheticEvidence>>) {
  const searchable = evidence.preSearchContexts.flatMap(o => o.contexts.filter(c => c.status === 'searchable').map(c => ({ orientationId: o.orientationId, ...c })))
  const controls = searchable.map((c, i) => ({ role: i === 0 ? 'control_first_candidate' : 'control_stopped_by_extent', orientationId: c.orientationId, workIndex: c.workIndex,
    targetWeaponId: c.targetWeaponId, contextDigest: c.contextDigest }))
  for (let i = controls.length; i < 5; i += 1) {
    controls.push({ role: 'control_stopped_by_extent', orientationId: `pad-${i}`, workIndex: 0, targetWeaponId: 'target.pad', contextDigest: 'pad' })
  }
  return {
    provenance: { formal: true, measuredHead: 'd2d-head', exportSha256: evidence.provenance.exportSha256, c25aEvidenceSha256: await sha256Bytes(bytesOf(evidence)) },
    formalRunValidation: { valid: true },
    totals: { primaryLeftOom: 2, primaryEndedNormally: 2, semanticParityWithD2A: true, modeSemanticParityFailures: 0 },
    workloadSelection: { primary: [], clearedReferences: [], controls, unselected: [] },
    contexts: [{}, {}, {}, {}, {}],
  }
}

/** The real D2-e Worker controller, in-process, answering on the D2-e wire through the Worker message interface. */
class InProcessD2EWorker implements BenchmarkWorkerLike {
  terminated = false
  readonly posted: unknown[] = []
  readonly received: unknown[] = []
  private inbound: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  constructor(engine: ReturnType<typeof scenario>['engine']) {
    const scope: Phase2C25D2EWorkerScope = {
      postMessage: message => { const copy = structuredClone(message); queueMicrotask(() => this.emit(copy)) },
      addEventListener: (_type, listener) => { this.inbound = listener },
    }
    attachPhase2C25D2EWorker(scope, { createEngine: () => engine, yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)), sha256 })
  }
  postMessage(message: unknown) { this.posted.push(message); this.inbound?.({ data: structuredClone(message) } as MessageEvent<unknown>) }
  addEventListener(type: string, listener: (event: Event) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener) }
  terminate() { this.terminated = true }
  emit(data: unknown) { if (this.terminated) return; this.received.push(data); for (const l of this.listeners.get('message') ?? []) l({ data } as MessageEvent) }
}

/**
 * The synthetic scenario is too small for the D2-b rule (no OOM representative): its workload is every searchable context,
 * confirmed against the synthetic reference exactly like `phase2c25d2eWorkload()` confirms (same key, Target, digest).
 */
const syntheticWorkload = (view: Phase2C25BEvidenceView, _json: unknown, reference: Phase2C25D2EReference): Phase2C25D2EWorkloadContext[] =>
  view.expectedContexts.filter(c => c.status === 'searchable').map(c => {
    const item = reference.selection.find(s => s.orientationId === c.orientationId && s.workIndex === c.workIndex && s.targetWeaponId === c.targetWeaponId && s.contextDigest === c.contextDigest)
    if (!item) throw new Error(`${c.orientationId}#${c.workIndex} is not in the reference`)
    return { orientationId: c.orientationId, kind: c.kind, role: c.role, workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, contextDigest: c.contextDigest,
      selectionRole: item.role === 'control_first_candidate' ? 'control_first_candidate' : 'control_stopped_by_extent', d2dRole: item.role }
  })

const ISOLATED: Phase2C25D2EBrowserEnvironmentState = { crossOriginIsolated: true, isSecureContext: true }

async function preparedRunner(options: { mutate?: (evidence: Record<string, unknown>) => void; skipReference?: boolean; environment?: Phase2C25D2EBrowserEnvironmentState } = {}) {
  const built = scenario()
  const evidence = await syntheticEvidence(built)
  options.mutate?.(evidence as unknown as Record<string, unknown>)
  const reference = await syntheticReference(evidence)
  const relayed: Record<string, unknown>[] = []
  const workers: InProcessD2EWorker[] = []
  const runner = createPhase2C25D2ERunner({
    sha256, sha256Bytes, buildInput: () => ({ input: built.input, maxPlanSteps: built.input.options.maxPlanSteps }),
    relay: event => relayed.push(event), visibilityState: () => 'visible', onVisibilityChange: () => () => undefined,
    createWorker: () => { const worker = new InProcessD2EWorker(built.engine); workers.push(worker); return worker },
    selectWorkload: syntheticWorkload,
    browserEnvironment: () => options.environment ?? ISOLATED,
  })
  if (!options.skipReference) await runner.loadD2DReference(bytesOf(reference), 'PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json')
  return { built, evidence, reference, runner, relayed, workers }
}

describe('Phase 2-C2.5-D2-e runner', () => {
  it('re-derives the workload contexts in fresh D2-e Workers, matches the evidence, and runs the current Production Search in both modes', async () => {
    const { runner, evidence, relayed, workers } = await preparedRunner()
    await runner.loadExport(EXPORT_BYTES, 'export.json')
    await runner.loadEvidence(bytesOf(evidence), 'evidence.json')
    const preparation = await runner.prepare()
    expect(preparation).toMatchObject({ status: 'ok', exportShaMatchesEvidence: true })
    expect(preparation.parity!.rows.every(row => row.matches)).toBe(true)
    const [first] = runner.selectedContexts()
    expect(first.d2dRole).toBe('control_first_candidate')
    const minimal = await runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' })
    const instrumented = await runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'instrumented' })
    for (const record of [minimal, instrumented]) {
      expect(['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate']).toContain(record.status)
      expect(record.id).toMatch(/^pg2c25d2e-record-/)
      expect(record.workerEnvironment?.protocolVersion).toBe(PHASE2C25D2E_PROTOCOL_VERSION)
    }
    // The normal-result semantic digest (status, Search summary, first Candidate key) is equal in both modes.
    expect(minimal.semanticDigest).toBe(instrumented.semanticDigest)
    expect(minimal.progress.count).toBe(0)
    expect(instrumented.progress.count).toBeGreaterThan(0)
    expect(instrumented.result!.finalSnapshot?.trigger).toBe('final')
    if (minimal.status === 'first_candidate') {
      expect(minimal.firstCandidateNotice).not.toBeNull()
      // The first Candidate notice reached the page before the final result.
      const events = relayed.filter(e => e.runKey === minimal.runKey).map(e => e.event)
      expect(events.indexOf('first_candidate')).toBeGreaterThan(-1)
      expect(events.indexOf('first_candidate')).toBeLessThan(events.indexOf('run_settled'))
    }
    // Every message crossed the Worker boundary on the D2-e wire; one fresh Worker per run, each terminated.
    expect(workers).toHaveLength(3)
    expect(workers.every(w => w.terminated)).toBe(true)
    for (const worker of workers) {
      for (const message of [...worker.posted, ...worker.received]) expect((message as { type: string }).type).toMatch(/^pg2c25d2e_benchmark_/)
      expect(JSON.stringify(worker.posted)).not.toMatch(/firstCandidateKeySha256|preSearchContexts|expectedContexts|selectionRole|d2dRole|workloadSelection/)
    }
    expect(relayed.filter(e => e.runKey === minimal.runKey).map(e => e.event)).toEqual(expect.arrayContaining(['run_started', 'accepted', 'search_ready', 'run_settled']))
    const exported = JSON.parse(runner.exportJson({}))
    expect(exported.protocolVersion).toBe(PHASE2C25D2E_PROTOCOL_VERSION)
    expect(exported.d2dReferenceInfo).toMatchObject({ fileName: 'PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json', measuredHead: 'd2d-head' })
    expect(exported.workload.map((c: Phase2C25D2EWorkloadContext) => c.d2dRole)).toEqual(runner.selectedContexts().map(c => c.d2dRole))
  })

  it('refuses the Export and the evidence before the D2-d RESULT, and files the D2-d RESULT did not measure', async () => {
    const { runner, evidence } = await preparedRunner({ skipReference: true })
    await expect(runner.loadExport(EXPORT_BYTES, 'export.json')).rejects.toThrow(/Load the Phase 2-C2\.5-D2-d RESULT first/)
    await expect(runner.loadEvidence(bytesOf(evidence), 'evidence.json')).rejects.toThrow(/Load the Phase 2-C2\.5-D2-d RESULT first/)
    const loaded = await preparedRunner()
    await expect(loaded.runner.loadExport(bytesOf('{"other":"export"}'), 'export.json')).rejects.toThrow(/Export differs/)
    await expect(loaded.runner.loadEvidence(bytesOf({ ...loaded.evidence, extra: 1 }), 'evidence.json')).rejects.toThrow(/evidence differs/)
    expect(loaded.runner.exportInfo()).toBeNull()
    expect(loaded.runner.evidenceInfo()).toBeNull()
    await loaded.runner.loadExport(EXPORT_BYTES, 'export.json')
    await expect(loaded.runner.loadD2DReference(bytesOf(loaded.reference), 'again.json')).rejects.toThrow(/before the Export/)
  })

  it('refuses a D2-d RESULT that is not a formal reference', async () => {
    const { runner, reference } = await preparedRunner({ skipReference: true })
    await expect(runner.loadD2DReference(bytesOf({ ...reference, totals: { ...reference.totals, primaryLeftOom: 1 } }), 'r.json')).rejects.toThrow(/primaryLeftOom/)
    expect(runner.d2dReferenceInfo()).toBeNull()
  })

  it('fails closed on a context parity mismatch: no formal Search starts', async () => {
    const { runner, workers, evidence } = await preparedRunner({ mutate: e => {
      (e.preSearchContexts as { contexts: { contextDigest: string }[] }[])[0].contexts[0].contextDigest = 'fnv1a32:deadbeef'
    } })
    await runner.loadExport(EXPORT_BYTES, 'export.json')
    await runner.loadEvidence(bytesOf(evidence), 'evidence.json')
    const preparation = await runner.prepare()
    expect(preparation.status).toBe('failed')
    expect(preparation.message).toMatch(/contextDigest/)
    const [first] = runner.selectedContexts()
    await expect(runner.runContext({ orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' })).rejects.toThrow(/preparation/)
    expect(workers).toHaveLength(1)
  })

  it.each([
    ['not cross-origin isolated', { crossOriginIsolated: false, isSecureContext: true }, /crossOriginIsolated is false/],
    ['not a secure context', { crossOriginIsolated: true, isSecureContext: false }, /isSecureContext is false/],
    ['an unknown environment', { crossOriginIsolated: null, isSecureContext: null }, /crossOriginIsolated is null, isSecureContext is null/],
  ])('prepares nothing and starts no Search outside the D2-b formal Browser environment: %s', async (_name, environment, pattern) => {
    const { runner, evidence, workers } = await preparedRunner({ environment })
    await runner.loadExport(EXPORT_BYTES, 'export.json')
    await runner.loadEvidence(bytesOf(evidence), 'evidence.json')
    expect(runner.browserEnvironment()).toMatchObject({ ...environment, issue: expect.stringMatching(pattern) })
    await expect(runner.prepare()).rejects.toThrow(pattern)
    const [first] = runner.selectedContexts()
    const request = { orientationId: first.orientationId, workIndex: first.workIndex, mode: 'minimal' as const }
    await expect(runner.runContext(request)).rejects.toThrow(pattern)
    expect(() => runner.startRun(request)).toThrow(pattern)
    await expect(runner.runFormalSeries()).rejects.toThrow(pattern)
    expect(runner.preparation()).toBeNull()
    expect(workers).toHaveLength(0)
    expect(phase2c25d2eBrowserEnvironmentIssue(ISOLATED)).toBeNull()
  })

  it('ignores Phase 2-C2.5-B and D2-b messages arriving at the adapter', () => {
    const listeners: ((event: Event) => void)[] = []
    const seen: unknown[] = []
    const adapted = adaptPhase2C25D2EWorker({ postMessage: () => undefined, addEventListener: (_t, l) => listeners.push(l), removeEventListener: () => undefined, terminate: () => undefined })
    adapted.addEventListener('message', event => seen.push((event as MessageEvent).data))
    listeners[0]({ data: { type: 'pg2c25b_benchmark_accepted', requestId: 'r' } } as MessageEvent)
    listeners[0]({ data: { type: 'pg2c25d2b_benchmark_accepted', requestId: 'r' } } as MessageEvent)
    listeners[0]({ data: { type: 'pg2c25d2e_benchmark_accepted', requestId: 'r' } } as MessageEvent)
    expect(seen).toEqual([{ type: 'pg2c25b_benchmark_accepted', requestId: 'r' }])
  })
})

// ---------------------------------------------------------------- analysis (synthetic records)

const SUMMARY_EXTENT = { deliveredCandidates: 0, excludedCandidates: 0, exhausted: false, stoppedByExtent: true, stoppedByConsumer: false, skippedExcludedRouteKeys: 0 }
const SUMMARY_FIRST = { deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: true, skippedExcludedRouteKeys: 0 }
const COUNTS = { predictNormalArtian: 4, predictSkills: 4, resetBonuses: 234, keepBonuses: 26719 }
const PROGRESS = { gogmaMaxDepth: 234, cumulativeGogmaGenerated: 5000, cumulativeGogmaFrontier: 800, maxGogmaGeneratedPerDepth: 300, depthOfMaxGogmaGenerated: 3,
  skillMaxDepth: 3, cumulativeSkillStates: 16, settledWorkItems: 1886 }

const WORKLOAD: Phase2C25D2EWorkloadContext[] = [
  { orientationId: 'clr', kind: 'same_gogma_counter', role: 'oom_representative', workIndex: 0, targetWeaponId: 't0', contextDigest: 'd0', selectionRole: 'oom_representative', d2dRole: 'cleared_reference' },
  { orientationId: 'pa', kind: 'same_skill_counter', role: 'oom_representative', workIndex: 0, targetWeaponId: 't1', contextDigest: 'd1', selectionRole: 'oom_representative', d2dRole: 'primary_oom' },
  { orientationId: 'pb', kind: 'same_owned_weapon_consumed', role: 'oom_representative', workIndex: 0, targetWeaponId: 't2', contextDigest: 'd2', selectionRole: 'oom_representative', d2dRole: 'primary_oom' },
  { orientationId: 'ctl', kind: 'same_gogma_counter', role: 'completed_control', workIndex: 0, targetWeaponId: 't3', contextDigest: 'd3', selectionRole: 'control_first_candidate', d2dRole: 'control_first_candidate' },
]

type Kind = 'extent' | 'first'
function nodeMode(kind: Kind, mode: 'minimal' | 'instrumented'): Phase2C25D2ENodeMode {
  const instrumented = mode === 'instrumented'
  return { status: kind === 'extent' ? 'stopped_by_extent_before_candidate' : 'first_candidate', searchSummary: kind === 'extent' ? SUMMARY_EXTENT : SUMMARY_FIRST,
    firstCandidateKeySha256: kind === 'extent' ? null : 'k', predictionCounts: instrumented ? COUNTS : null, timeToFirstMs: null, searchElapsedMs: 900_000,
    metrics: null, progress: instrumented ? PROGRESS : null }
}
const NODE_KINDS: Record<string, Kind> = { clr: 'extent', pa: 'extent', pb: 'first', ctl: 'first' }
function nodeView(): Phase2C25D2ENodeView {
  return { measuredHead: 'h', exportSha256: 'e', c25aEvidenceSha256: 'a', reference: null as never,
    contexts: WORKLOAD.map(c => ({ orientationId: c.orientationId, workIndex: 0, role: c.d2dRole, minimal: nodeMode(NODE_KINDS[c.orientationId], 'minimal'),
      instrumented: nodeMode(NODE_KINDS[c.orientationId], 'instrumented') })) }
}

function snapshot(trigger: 'heartbeat' | 'final', p: typeof PROGRESS = PROGRESS) {
  return { seq: 1, trigger, elapsedMs: 1000, settledWorkItems: p.settledWorkItems, skill: { streams: 1, maxDepth: p.skillMaxDepth, totalStates: p.cumulativeSkillStates, totalTransitions: 8 },
    gogma: { streams: 1, maxDepth: p.gogmaMaxDepth, totalGeneratedStates: p.cumulativeGogmaGenerated, totalFrontierStates: p.cumulativeGogmaFrontier,
      maxGeneratedStatesPerDepth: p.maxGogmaGeneratedPerDepth, depthOfMaxGeneratedStates: p.depthOfMaxGogmaGenerated }, lastEvent: null, predictionCounts: COUNTS, workerHeap: null } as const
}

interface Tweak { status?: string; summary?: Record<string, unknown>; key?: string | null; counts?: typeof COUNTS; progress?: typeof PROGRESS }
function pageRecord(runKey: string, mode: 'minimal' | 'instrumented', kind: Kind, tweak: Tweak = {}): Phase2C25BRunRecord {
  const status = tweak.status ?? (kind === 'extent' ? 'stopped_by_extent_before_candidate' : 'first_candidate')
  const summary = tweak.summary ?? (kind === 'extent' ? SUMMARY_EXTENT : SUMMARY_FIRST)
  const key = tweak.key !== undefined ? tweak.key : kind === 'extent' ? null : 'k'
  const instrumented = mode === 'instrumented'
  const result = { mode, orientationId: 'o', targetWeaponId: 't', workIndex: 0, contextDigest: 'd', status, searchSummary: summary, timeToFirstMs: key ? 1 : null, elapsedMs: 800_000,
    firstCandidateKeySha256: key, firstCandidateSummary: null, predictionCounts: instrumented ? tweak.counts ?? COUNTS : null, predictionCountsAtFirstCandidate: null,
    finalSnapshot: instrumented ? snapshot('final', tweak.progress) : null, snapshotsEmitted: instrumented ? 2 : 0 } as unknown as Phase2C25BSearchRecord
  // The digest is equal in both modes unless a tweak changes the status, summary or key.
  return { runKey, status, result, semanticDigest: stableStringify({ status, summary, key }), error: null, firstCandidateNotice: key ? { timeToFirstMs: 1, atMs: 1 } : null,
    timeline: { searchReadyAtMs: 1 }, progress: { count: instrumented ? 2 : 0, snapshots: instrumented ? [snapshot('heartbeat'), snapshot('final', tweak.progress)] : [] },
    workerLifetimeMs: 801_000 } as unknown as Phase2C25BRunRecord
}

function externalRun(runKey: string, overrides: Partial<Phase2C25BExternalRun> = {}): Phase2C25BExternalRun {
  const [orientationWork, mode, attempt] = runKey.split(':')
  const [orientationId, workIndex] = orientationWork.split('#')
  return { runKey, orientationId, workIndex: Number(workIndex), mode: mode as 'minimal', attempt: Number(attempt.slice(1)), sessionIndex: 1, startedAt: 1000, endedAt: 9000,
    driverStatus: 'page_settled', pageStatus: null,
    workerTargets: [{ targetIdSha: 'w', createdAt: 1000, attachedAt: 1001, firstSampleAt: 1500, lastSuccessfulSampleAt: 7000, samples: 3, detachedAt: 8000, destroyedAt: 8000 }],
    heapSamples: [{ atEpochMs: 1500, requestMs: 1, targetIdSha: 'w', usedSize: 10, totalSize: 20 }, { atEpochMs: 4000, requestMs: 2, targetIdSha: 'w', usedSize: 50, totalSize: 60 },
      { atEpochMs: 7000, requestMs: 1, targetIdSha: 'w', usedSize: 30, totalSize: 70 }],
    sampleErrors: [], events: [], pageEvents: [], crash: null, crashDumps: [], ...overrides } as Phase2C25BExternalRun
}

function lostRun(runKey: string, oomKey = true): Phase2C25BExternalRun {
  return externalRun(runKey, { driverStatus: 'page_crashed', crash: { detectedAt: 8000, via: 'Inspector.detached', reason: 'Render process gone.' },
    workerTargets: [{ targetIdSha: 'w', createdAt: 1000, attachedAt: 1001, firstSampleAt: 1500, lastSuccessfulSampleAt: 7000, samples: 2, detachedAt: null, destroyedAt: 8000 }],
    pageEvents: [{ receivedAt: 1100, event: 'search_ready', runKey }, ...(runKey.includes('instrumented') ? [{ receivedAt: 7500, event: 'progress', runKey, snapshot: snapshot('heartbeat') as never }] : [])],
    crashDumps: oomKey ? [{ ptype: 'renderer', loadedOrigin: 'http://127.0.0.1', v8OomLocation: 'MarkCompactCollector: young object promotion failed', v8OomDetails: null,
      mentionsAllocationFailure: true, mtime: 't' }] : [] } as Partial<Phase2C25BExternalRun>)
}

function beforeView(): Phase2C25D2EBeforeView {
  const metrics = (runKey: string, status: string) => ({ runKey, mode: runKey.includes('instrumented') ? 'instrumented' : 'minimal', attempt: 1, status, firstCandidateNoticed: false,
    searchElapsedMs: null, searchStartToLossMs: 45_000, workerLifetimeMs: 46_000, cdpSamples: 80, cdpSampledMaxUsedBytes: 3.6e9, cdpLastUsedBytes: 3.6e9,
    lastProgress: runKey.includes('instrumented') ? { elapsedMs: 40_000, trigger: 'heartbeat', gogmaMaxDepth: 12, skillMaxDepth: 3, cumulativeGogmaGenerated: 1000, cumulativeGogmaFrontier: 100,
      maxGogmaGeneratedPerDepth: 300, depthOfMaxGogmaGenerated: 3, cumulativeSkillStates: 16, settledWorkItems: 50, predictionCounts: COUNTS } : null,
    searchSummary: null, firstCandidateKeySha256: null, predictionCounts: null, browserOomEvidence: 'explicit_v8_oom_crash_key', v8OomLocation: 'x' }) as never
  const lostContext = (orientationId: string) => ({ orientationId, workIndex: 0, classification: 'inconclusive_page_or_browser_crash', attempts: 2, browserOomEvidenceRuns: 4,
    runs: [metrics(`${orientationId}#0:minimal:a1`, 'page_crashed'), metrics(`${orientationId}#0:instrumented:a1`, 'page_crashed')] })
  return { measuredHead: 'b', exportSha256: 'e', c25aEvidenceSha256: 'a', environment: { crossOriginIsolated: true, isSecureContext: true, chrome: 'Chrome/153' }, contexts: [
    { orientationId: 'clr', workIndex: 0, classification: 'browser_no_failure', attempts: 1, browserOomEvidenceRuns: 0, runs: [] },
    lostContext('pa'), lostContext('pb'),
    { orientationId: 'ctl', workIndex: 0, classification: 'browser_no_failure', attempts: 1, browserOomEvidenceRuns: 0, runs: [] },
  ] }
}

type Outcome = 'normal' | 'lost' | 'timeout' | Tweak
function analyse(outcomes: Partial<Record<string, Outcome>> = {}) {
  const records: Phase2C25BRunRecord[] = []
  const runs: Phase2C25BExternalRun[] = []
  for (const context of WORKLOAD) {
    const outcome = outcomes[context.orientationId] ?? 'normal'
    const attempts = outcome === 'lost' ? [1, 2] : [1]
    for (const attempt of attempts) for (const mode of ['minimal', 'instrumented'] as const) {
      const runKey = `${context.orientationId}#0:${mode}:a${attempt}`
      if (outcome === 'lost') { runs.push(lostRun(runKey)); continue }
      if (outcome === 'timeout') {
        records.push({ ...pageRecord(runKey, mode, NODE_KINDS[context.orientationId]), status: 'timeout', result: null, semanticDigest: null,
          error: { source: 'timeout' } } as unknown as Phase2C25BRunRecord)
        runs.push(externalRun(runKey))
        continue
      }
      // A tweak applies to the instrumented run only (the minimal run stays the Node value).
      records.push(pageRecord(runKey, mode, NODE_KINDS[context.orientationId], outcome !== 'normal' && mode === 'instrumented' ? outcome : {}))
      runs.push(externalRun(runKey))
    }
  }
  return analyzePhase2C25D2E({ pages: [{ records } as unknown as Phase2C25BPageExport, { records: [] } as unknown as Phase2C25BPageExport],
    external: { runs } as unknown as Phase2C25BExternalEvidence, workload: WORKLOAD, node: nodeView(), before: beforeView(), runBudgetMs: PHASE2C25D2E_RUN_BUDGET_MS })
}

describe('Phase 2-C2.5-D2-e analysis', () => {
  it('accepts every context only with the unchanged classification and full Node D2-d parity, and summarizes all-normal beside the C2.5-B verdict', () => {
    const result = analyse()
    expect(result.contexts.map(c => c.classification)).toEqual(['browser_no_failure', 'browser_no_failure', 'browser_no_failure', 'browser_no_failure'])
    for (const c of result.contexts) {
      expect(c.nodeD2DAcceptance).toEqual({ accepted: true, classification: 'browser_no_failure', nodeTerminatedInBothModes: true, nodeParityHolds: true, progressParityHolds: true })
      expect(c.nodeParity.map(p => p.matches)).toEqual([true, true])
      expect(c.progressParity.map(p => p.matches)).toEqual([true])
    }
    expect(result.verdict).toMatchObject({ formal: 'not_reproduced', representativeVerdict: 'not_reproduced', overallSummary: 'browser_no_failure_all_selected_contexts',
      outcomeCategory: 'A_all_selected_contexts_normal_with_node_d2d_parity', semanticFailures: [] })
    expect(result.verdict.nextPhase.recommendation).toBe('A_return_to_global_planner_kernel_formal_reevaluation')
    // 800 s is above half the 20-minute budget: the runtime note is recorded, nothing is implemented.
    expect(result.verdict.nextPhase).toMatchObject({ runtimeNote: 'C_generation_volume_h6_runtime_optimization_to_consider', longRuntimePrimaries: ['pa#0', 'pb#0'] })
    expect(result.totals).toMatchObject({ contexts: 4, runs: 8, pageSessions: 2, acceptedContexts: 4, primaries: 2, primariesAccepted: 2, pageCrashes: 0, timeouts: 0 })
  })

  it.each([
    ['status', { status: 'exhausted_before_candidate' } as Tweak, 'statusMatches'],
    ['first Candidate key', { key: 'other-key' } as Tweak, 'firstCandidateKeyMatches'],
    ['Search summary', { summary: { ...SUMMARY_FIRST, excludedCandidates: 3 } } as Tweak, 'searchSummaryMatches'],
    ['prediction counts', { counts: { ...COUNTS, keepBonuses: 1 } } as Tweak, 'predictionCountsMatch'],
  ])('detects a %s mismatch against Node D2-d as a semantic failure', (_name, tweak, field) => {
    const result = analyse({ pb: tweak })
    const pb = result.contexts[2]
    expect(pb.nodeD2DAcceptance.accepted).toBe(false)
    expect(pb.nodeParity.find(p => p.mode === 'instrumented')).toMatchObject({ [field]: false, matches: false })
    expect(result.verdict.overallSummary).toBe('semantic_failure')
    expect(result.verdict.formal).toBe('semantic_failure')
  })

  it('detects an instrumented final progress mismatch against Node D2-d', () => {
    const result = analyse({ pa: { progress: { ...PROGRESS, cumulativeGogmaGenerated: PROGRESS.cumulativeGogmaGenerated + 1 } } })
    const pa = result.contexts[1]
    expect(pa.classification).toBe('browser_no_failure')
    expect(pa.nodeD2DAcceptance).toMatchObject({ accepted: false, nodeParityHolds: true, progressParityHolds: false })
    expect(pa.progressParity[0].fields.filter(f => !f.matches).map(f => f.field)).toEqual(['cumulativeGogmaGenerated'])
    expect(result.verdict.semanticFailures).toEqual(['pa#0: normal Browser termination without Node D2-d parity'])
  })

  it('keeps a page loss as inconclusive with the V8 OOM key beside it, and a timeout apart from a crash', () => {
    const lost = analyse({ pa: 'lost' })
    const pa = lost.contexts[1]
    expect(pa.classification).toBe('inconclusive_page_or_browser_crash')
    expect(pa.browserOomEvidenceRuns).toBe(4)
    expect(pa.attempts[0].auxiliary.lostDuringSearchBeforeFirstCandidate).toEqual([true, true])
    expect(pa.nodeParity.every(p => !p.applicable && p.reason === 'browser_not_terminated')).toBe(true)
    expect(lost.verdict).toMatchObject({ overallSummary: 'not_all_selected_contexts_browser_no_failure', outcomeCategory: 'B_or_C_one_primary_normal', semanticFailures: [] })
    expect(lost.verdict.nextPhase.recommendation).toBe('B_post_h1_heap_localization_browser_specific_residual')
    expect(lost.totals).toMatchObject({ pageCrashes: 4, timeouts: 0, explicitV8OomRuns: 4 })
    const timedOut = analyse({ pa: 'timeout' })
    expect(timedOut.contexts[1].classification).toBe('inconclusive_timeout_or_abort')
    expect(timedOut.totals).toMatchObject({ pageCrashes: 0, timeouts: 2, explicitV8OomRuns: 0 })
    expect(timedOut.verdict.outcomeCategory).toBe('E_browser_timeout')
    const both = analyse({ pa: 'lost', pb: 'lost' })
    expect(both.verdict).toMatchObject({ representativeVerdict: 'mixed', outcomeCategory: 'D_primary_loss_continues' })
  })

  it('compares the Browser before (D2-b) with the Browser after on the same contexts', () => {
    const pa = analyse().contexts[1]
    expect(pa.browserBefore).toMatchObject({ classification: 'inconclusive_page_or_browser_crash', attempts: 2, browserOomEvidenceRuns: 4 })
    expect(pa.browserAfter).toMatchObject({ classification: 'browser_no_failure', attempts: 1, browserOomEvidenceRuns: 0 })
    expect(pa.browserAfter.runs.map(r => r.searchElapsedMs)).toEqual([800_000, 800_000])
    expect(pa.progressDelta).toMatchObject({ beforeRunKey: 'pa#0:instrumented:a1', afterRunKey: 'pa#0:instrumented:a1' })
    expect(pa.progressDelta.progressRatio?.cumulativeGogmaGenerated).toBe(5)
    expect(pa.runtime.nodeSearchElapsedMs).toEqual({ minimal: 900_000, instrumented: 900_000 })
  })

  it('records the CDP samples as sampled values: max, its time and total, the last successful sample', () => {
    expect(phase2c25d2eCdpDetail(externalRun('pa#0:minimal:a1'))).toEqual({ samples: 3, sampleErrors: 0, sampledMaxUsedBytes: 50, sampledMaxUsedAtMs: 3000,
      totalBytesAtSampledMaxUsed: 60, sampledMaxTotalBytes: 70, lastUsedBytes: 30, lastTotalBytes: 70, lastSampleAtMs: 6000 })
    expect(phase2c25d2eProgressParity({ runKey: 'x', mode: 'minimal', status: 'first_candidate', result: null }, nodeMode('first', 'minimal')).reason).toBe('not_instrumented')
  })

  it('keeps the repeat rule of Phase 2-C2.5-B', () => {
    const pair = (a: string, b: string, attempt = 1) => phase2c25bRepeatDecision({ attempt, minimal: { status: a as never, semanticDigest: 'x' },
      instrumented: { status: b as never, semanticDigest: 'x' }, cdpAttachFailure: false })
    expect(pair('stopped_by_extent_before_candidate', 'stopped_by_extent_before_candidate').repeat).toBe(false)
    expect(pair('timeout', 'timeout').repeat).toBe(false)
    expect(pair('page_crashed', 'page_crashed').repeat).toBe(true)
    expect(pair('page_crashed', 'page_crashed', 2).repeat).toBe(false)
    expect(pair('worker_error_before_first_candidate', 'worker_error_before_first_candidate').repeat).toBe(true)
  })
})

// ---------------------------------------------------------------- Browser execution environment parity

describe('Phase 2-C2.5-D2-e Browser environment parity', () => {
  const before = { crossOriginIsolated: true, isSecureContext: true, chrome: 'Chrome/153.0.8010.49' }
  const after = (patch: Partial<typeof before> = {}, session = 1) => ({ session, ...before, ...patch })

  it('A: passes when every D2-e session equals D2-b in crossOriginIsolated and isSecureContext, recording the Chrome versions', () => {
    const parity = phase2c25d2eBrowserEnvironmentParity(before, [after(), after({}, 2)])
    expect(parity).toMatchObject({ valid: true, checks: { crossOriginIsolated: true, isSecureContext: true, chromeVersion: true }, issues: [],
      required: ['crossOriginIsolated', 'isSecureContext'], before })
    // A Chrome version difference is recorded, not required.
    expect(phase2c25d2eBrowserEnvironmentParity(before, [after({ chrome: 'Chrome/154.0.0.0' })])).toMatchObject({ valid: true, checks: { chromeVersion: false } })
  })

  it('B: rejects a D2-e session that is not cross-origin isolated while D2-b was', () => {
    const parity = phase2c25d2eBrowserEnvironmentParity(before, [after(), after({ crossOriginIsolated: false }, 2)])
    expect(parity).toMatchObject({ valid: false, checks: { crossOriginIsolated: false } })
    expect(parity.issues).toEqual(['crossOriginIsolated: D2-e true / false != D2-b true'])
  })

  it('C: rejects an isSecureContext mismatch, and no session at all', () => {
    expect(phase2c25d2eBrowserEnvironmentParity(before, [after({ isSecureContext: false })])).toMatchObject({ valid: false, checks: { isSecureContext: false } })
    expect(phase2c25d2eBrowserEnvironmentParity(before, [])).toMatchObject({ valid: false, issues: ['no D2-e page session environment',
      expect.stringMatching(/^crossOriginIsolated/), expect.stringMatching(/^isSecureContext/)] })
  })

  it('D / E: accepts the committed D2-b RESULT as the before authority only when formal, series-complete and isolated', () => {
    expect(parsePhase2C25D2BBrowserBeforeResult(d2bResult).environment).toEqual({ crossOriginIsolated: true, isSecureContext: true, chrome: 'Chrome/153.0.8010.49' })
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, provenance: { ...d2bResult.provenance, formal: false } })).toThrow(/provenance.formal/)
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, formalSeriesValidation: { ...d2bResult.formalSeriesValidation, valid: false } })).toThrow(/formalSeriesValidation/)
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, environment: { ...d2bResult.environment, crossOriginIsolated: false } })).toThrow(/environment.crossOriginIsolated is false/)
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, environment: { ...d2bResult.environment, isSecureContext: false } })).toThrow(/environment.isSecureContext is false/)
  })

  it('makes the formal analyzer check the environment parity before the analysis and stop without a RESULT on a mismatch', () => {
    const analyzer = Object.values(scriptSources)[0]
    const gate = analyzer.indexOf('phase2c25d2eBrowserEnvironmentParity(')
    expect(gate).toBeGreaterThan(analyzer.indexOf('parsePhase2C25D2BBrowserBeforeResult('))
    expect(gate).toBeLessThan(analyzer.indexOf('analyzePhase2C25D2E('))
    expect(analyzer).toMatch(/Browser environment parity failed: /)
    expect(analyzer).toMatch(/browserEnvironmentParity,/)
  })
})

// ---------------------------------------------------------------- formal series completeness (the D2-b validator, reused)

type SeriesExternal = Phase2C25D2BFormalSeriesInput['external']
type SeriesRun = SeriesExternal['runs'][number]

describe('Phase 2-C2.5-D2-e formal series completeness', () => {
  const workload = phase2c25d2eWorkload(parsePhase2C25BEvidence(c25aEvidence), c25aEvidence, parsePhase2C25D2EReference(d2dResult))
  const run = (context: { orientationId: string; workIndex: number }, mode: 'minimal' | 'instrumented', attempt: number, lost: boolean): SeriesRun =>
    ({ runKey: `${context.orientationId}#${context.workIndex}:${mode}:a${attempt}`, orientationId: context.orientationId, workIndex: context.workIndex, mode, attempt,
      driverStatus: lost ? 'page_crashed' : 'page_settled', pageStatus: lost ? null : 'stopped_by_extent_before_candidate',
      workerTargets: [{ samples: 3 }] as never, ...(lost ? {} : { semanticDigest: 'same' }) } as SeriesRun)
  const complete = (lostIndex: number | null): SeriesExternal => {
    const runs: SeriesRun[] = []
    const repeatDecisions: { context: string; attempt: number; decision: { repeat: boolean; reasons: string[] } }[] = []
    workload.forEach((context, index) => {
      const lost = index === lostIndex
      for (const attempt of lost ? [1, 2] : [1]) {
        runs.push(run(context, 'minimal', attempt, lost), run(context, 'instrumented', attempt, lost))
        repeatDecisions.push({ context: `${context.orientationId}#${context.workIndex}`, attempt, decision: { repeat: lost && attempt === 1, reasons: lost ? ['page_or_browser_crash'] : [] } })
      }
    })
    return { driver: { modes: ['minimal', 'instrumented'], allowRepeat: true, only: null }, completedAt: 1, runs, repeatDecisions }
  }

  it('accepts a complete series over the 5 D2-e contexts, deriving the expected runs from the repeat rule', () => {
    expect(validatePhase2C25D2BFormalSeries({ workload, external: complete(null) })).toMatchObject({ valid: true, workloadContexts: 5, expectedRuns: 10, actualRuns: 10, repeatedContexts: [] })
    expect(validatePhase2C25D2BFormalSeries({ workload, external: complete(1) })).toMatchObject({ valid: true, expectedRuns: 12, actualRuns: 12 })
  })

  it('fails on a missing mode, a missing repeat, an extra attempt, a foreign run, or a subset driver', () => {
    const base = complete(1)
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, runs: base.runs.slice(1) } }).valid).toBe(false)
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, runs: base.runs.filter(r => r.attempt === 1) } }).missingRuns).toHaveLength(2)
    const extra = { ...run(workload[0], 'minimal', 2, false) }
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, runs: [...base.runs, extra] } }).valid).toBe(false)
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, runs: [...base.runs, { ...extra, orientationId: 'foreign', runKey: 'foreign#0:minimal:a1', attempt: 1 }] } }).foreignRuns)
      .toEqual(['foreign#0:minimal:a1'])
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, driver: { ...base.driver, only: ['x'] } } }).valid).toBe(false)
    expect(validatePhase2C25D2BFormalSeries({ workload, external: { ...base, completedAt: undefined } }).valid).toBe(false)
  })

  it('makes the formal analyzer check the D2-d reference and the series before the analysis, and stop with an error on an incomplete series', () => {
    const analyzer = Object.values(scriptSources)[0]
    const reference = analyzer.indexOf('parsePhase2C25D2DNodeResult(')
    const gate = analyzer.indexOf('validatePhase2C25D2BFormalSeries(')
    expect(reference).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(reference)
    expect(gate).toBeLessThan(analyzer.indexOf('analyzePhase2C25D2E('))
    expect(analyzer).toMatch(/Formal series incomplete: /)
    expect(analyzer).toMatch(/formalSeriesValidation,/)
    expect(analyzer).toMatch(/phase2c25d2eWorkload\(view, c25a\.json, node\.reference\)/)
    expect(analyzer).toMatch(/raw evidence is never rewritten/)
    expect(analyzer).toMatch(/driverRunBudgetMs/)
    expect(analyzer).not.toMatch(/pageSessions\s*===/)
  })
})

// ---------------------------------------------------------------- committed comparison sources

describe('Phase 2-C2.5-D2-e comparison sources', () => {
  const view = parsePhase2C25BEvidence(c25aEvidence)
  const node = parsePhase2C25D2DNodeResult(d2dResult)
  const before = parsePhase2C25D2BBrowserBeforeResult(d2bResult)
  const workload = phase2c25d2eWorkload(view, c25aEvidence, node.reference)
  const nodeOf = (c: { orientationId: string; workIndex: number }) => node.contexts.find(n => n.orientationId === c.orientationId && n.workIndex === c.workIndex)!
  const beforeOf = (c: { orientationId: string; workIndex: number }) => before.contexts.find(n => n.orientationId === c.orientationId && n.workIndex === c.workIndex)!

  it('reads the Node D2-d RESULT: every workload context ended normally in both modes, the parity values taken from the RESULT', () => {
    expect(node.exportSha256).toBe(view.exportSha256)
    for (const context of workload) {
      const n = nodeOf(context)
      expect(n.role).toBe(context.d2dRole)
      expect(n.minimal.status).toBe(n.instrumented.status)
      expect(['first_candidate', 'stopped_by_extent_before_candidate']).toContain(n.instrumented.status)
      expect(n.instrumented.progress).not.toBeNull()
      expect(n.minimal.progress).toBeNull()
    }
    // The primaries (their D2-d values are what the Browser is compared with; nothing here is a runtime constant).
    const primaries = workload.filter(c => c.d2dRole === 'primary_oom').map(nodeOf)
    const extent = primaries.find(n => n.instrumented.status === 'stopped_by_extent_before_candidate')!
    expect(extent.instrumented).toMatchObject({ firstCandidateKeySha256: null, predictionCounts: { predictNormalArtian: 4, predictSkills: 4, resetBonuses: 234, keepBonuses: 26719 } })
    expect(extent.instrumented.progress?.gogmaMaxDepth).toBe(234)
    const first = primaries.find(n => n.instrumented.status === 'first_candidate')!
    expect(first.instrumented).toMatchObject({ firstCandidateKeySha256: expect.stringMatching(/^fffec72a/), predictionCounts: { predictNormalArtian: 4, predictSkills: 5, resetBonuses: 160, keepBonuses: 13173 } })
    expect(first.instrumented.progress?.gogmaMaxDepth).toBe(63)
    expect(first.minimal.firstCandidateKeySha256).toBe(first.instrumented.firstCandidateKeySha256)
  })

  it('reads the Browser before (D2-b RESULT): the primaries lost the renderer in every run, the cleared reference and controls ended normally', () => {
    expect(before.exportSha256).toBe(view.exportSha256)
    for (const context of workload) {
      const b = beforeOf(context)
      if (context.d2dRole === 'primary_oom') {
        expect(b).toMatchObject({ classification: 'inconclusive_page_or_browser_crash', attempts: 2, browserOomEvidenceRuns: 4 })
        expect(b.runs.every(r => r.status === 'page_crashed')).toBe(true)
      } else expect(b.classification).toBe('browser_no_failure')
    }
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, formalSeriesValidation: { valid: false } })).toThrow(/formalSeriesValidation/)
    expect(() => parsePhase2C25D2BBrowserBeforeResult({ ...d2bResult, provenance: { ...d2bResult.provenance, formal: false } })).toThrow(/formal/)
    expect(() => parsePhase2C25D2DNodeResult({ ...d2dResult, provenance: { ...d2dResult.provenance, formal: false } })).toThrow(/formal/)
  })
})

// ---------------------------------------------------------------- committed formal D2-e RESULT (post hoc)

describe('Phase 2-C2.5-D2-e committed formal RESULT', () => {
  const node = parsePhase2C25D2DNodeResult(d2dResult)
  const workload = phase2c25d2eWorkload(parsePhase2C25BEvidence(c25aEvidence), c25aEvidence, node.reference)

  it('is a formal, complete series over the D2-d workload, measured on a clean committed build with the unchanged budgets', () => {
    expect(d2eResult.provenance).toMatchObject({ formal: true, uncommittedBenchmarkCode: false, calculationCodeChangedSinceMeasuredHead: [] })
    expect(d2eResult.formalSeriesValidation).toMatchObject({ valid: true, workloadContexts: 5, issues: [] })
    expect(d2eResult.workload.map(c => [c.orientationId, c.workIndex, c.contextDigest, c.d2dRole])).toEqual(workload.map(c => [c.orientationId, c.workIndex, c.contextDigest, c.d2dRole]))
    expect(d2eResult.conditions).toMatchObject({ runBudgetMs: PHASE2C25D2E_RUN_BUDGET_MS, driverRunBudgetMs: PHASE2C25D2E_DRIVER_RUN_BUDGET_MS, candidateStopBound: 1 })
    expect(d2eResult.provenance.d2dResultSha256).toBe(d2eResult.sources.d2dResult.sha256)
    expect(d2eResult.parity.every(p => p.status === 'ok' && p.matches)).toBe(true)
    // The Dedicated Worker's own limit stays unknown; the page realm value is a reference only.
    expect(d2eResult.environment.heapLimits).toMatchObject({ workerRealmJsHeapSizeLimit: null, workerHeapLimitMeasured: false })
  })

  it('equals Node D2-d in every run of every context, the comparison values read from the D2-d RESULT', () => {
    expect(d2eResult.contexts).toHaveLength(workload.length)
    for (const c of d2eResult.contexts) {
      const n = node.contexts.find(x => x.orientationId === c.orientationId && x.workIndex === c.workIndex)!
      expect(c.nodeD2DAcceptance.accepted).toBe(true)
      expect(c.nodeParity.every(p => p.applicable && p.matches === true)).toBe(true)
      expect(c.progressParity.every(p => p.applicable && p.matches === true)).toBe(true)
      for (const run of c.browserAfter.runs) {
        expect(run.status).toBe(n[run.mode as 'minimal' | 'instrumented'].status)
        expect(run.firstCandidateKeySha256).toBe(n[run.mode as 'minimal' | 'instrumented'].firstCandidateKeySha256)
        if (run.mode === 'instrumented') expect(run.predictionCounts).toEqual(n.instrumented.predictionCounts)
      }
      const final = c.progressParity[0].fields.map(f => [f.field, f.browser])
      expect(Object.fromEntries(final)).toEqual(n.instrumented.progress)
    }
    expect(d2eResult.verdict).toMatchObject({ overallSummary: 'browser_no_failure_all_selected_contexts', semanticFailures: [] })
  })
})

// ---------------------------------------------------------------- statements / heap wording

describe('Phase 2-C2.5-D2-e statements', () => {
  it('never claims the Global Planner memory problem solved, and keeps the unknown Worker limit apart from the page realm value', () => {
    const statements = phase2c25d2eStatements(analyse(), { pageRealmJsHeapSizeLimit: 4_395_630_592, workerRealmJsHeapSizeLimit: null })
    const all = [...statements.formal, ...statements.notYet].join('\n')
    expect(statements.formal.some(s => /every H1-after Chrome Dedicated Worker Search-only run ended normally/.test(s))).toBe(true)
    expect(statements.formal.some(s => /After H1, pa#0 no longer reproduced the D2-b renderer loss/.test(s))).toBe(true)
    expect(statements.formal.some(s => /clr#0 no longer/.test(s))).toBe(false)
    expect(statements.notYet[0]).toMatch(/That the Global Planner memory problem is solved: only the Search-only run/)
    expect(all).not.toMatch(/memory problem (?:is|was) (?:completely )?solved\./)
    expect(all).toMatch(/Dedicated Worker realm did not expose its own jsHeapSizeLimit, so the Worker's actual heap limit was not measured \(unknown\) and is not taken to equal the page realm value/)
    expect(all).toMatch(/a value of another realm given for reference only/)
    expect(all).toMatch(/Node heap bytes and limits are not compared with the Browser/)
    expect(all).not.toMatch(/(?:Worker|Browser)[^;.]*heap limit[^;.]*(?:about|≈|~)\s*4(?:\.\d+)?\s*GiB/i)
    expect(all).not.toMatch(/\d+(?:\.\d+)?\s*(?:x|×|倍)\s*(?:less|smaller|improve)/i)
    expect(phase2c25d2eStatements(analyse(), { pageRealmJsHeapSizeLimit: null, workerRealmJsHeapSizeLimit: 1234 }).notYet.join('\n'))
      .toMatch(/Dedicated Worker realm reported its own jsHeapSizeLimit 1234 bytes/)
    // The same-environment conclusion needs the Browser environment parity.
    expect(all).not.toMatch(/same cross-origin isolated Browser environment/)
    const heapNone = { pageRealmJsHeapSizeLimit: null, workerRealmJsHeapSizeLimit: null }
    expect(phase2c25d2eStatements(analyse(), heapNone, { valid: true }).formal.some(s => /After H1, in the same cross-origin isolated Browser environment as D2-b .* all 4 selected contexts ended normally/.test(s))).toBe(true)
    expect(phase2c25d2eStatements(analyse(), heapNone, { valid: false }).formal.some(s => /same cross-origin isolated/.test(s))).toBe(false)
    expect(phase2c25d2eStatements(analyse({ pa: 'lost' }), heapNone, { valid: true }).formal.some(s => /same cross-origin isolated/.test(s))).toBe(false)
    const lost = phase2c25d2eStatements(analyse({ pa: 'lost' }), { pageRealmJsHeapSizeLimit: null, workerRealmJsHeapSizeLimit: null })
    expect(lost.formal.some(s => /every H1-after/.test(s))).toBe(false)
    expect(lost.notYet.some(s => /pa#0 \(inconclusive_page_or_browser_crash\)/.test(s))).toBe(true)
  })
})

// ---------------------------------------------------------------- isolation

const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'PHASE2C1_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./plannerGlobalPhase2C25D2E*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const workerSources = import.meta.glob('../workers/plannerGlobalPhase2C25D2E.worker.benchmark*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const pageSources = import.meta.glob('../pages/PlannerGlobalPhase2C25D2EBenchmarkPage.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25d2e*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const benchmarkOnly = [/^\.\.\/benchmark\.tsx$/, /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/, /^\.\.\/pages\/[A-Za-z0-9]+BenchmarkPage(\.test)?\.tsx$/,
  /^\.\.\/workers\/[A-Za-z0-9]+\.worker\.benchmark(\.entry)?(\.test)?\.ts$/, /\.test\.tsx?$/]

describe('Phase 2-C2.5-D2-e isolation', () => {
  const runtime = Object.entries({ ...benchmarkSources, ...workerSources, ...pageSources }).filter(([path]) => !/\.test\.tsx?$/.test(path))
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('keeps the oracle, hard-coded IDs / Counter positions / keys and file reads out of every runtime module', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual(['../pages/PlannerGlobalPhase2C25D2EBenchmarkPage.tsx', '../workers/plannerGlobalPhase2C25D2E.worker.benchmark.entry.ts',
      '../workers/plannerGlobalPhase2C25D2E.worker.benchmark.ts', './plannerGlobalPhase2C25D2E.ts', './plannerGlobalPhase2C25D2EAnalysis.ts', './plannerGlobalPhase2C25D2EHarness.ts',
      './plannerGlobalPhase2C25D2EProtocol.ts'])
    for (const [path, source] of runtime) {
      expect(source, path).not.toMatch(ORACLE_NAMES)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source, path).not.toMatch(/['"`]c\d+-p\d+|build-list\.fnv1a32-|fnv1a32:[0-9a-f]{8}/)
      expect(source, path).not.toMatch(/\b26719\b|\b13173\b/)
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

  it('has no D2-e Search implementation: the Worker reuses the Phase 2-C2.5-B controller (current Production Search), and never receives an evidence or a comparison source', () => {
    const worker = workerSources['../workers/plannerGlobalPhase2C25D2E.worker.benchmark.ts']
    expect(worker).toMatch(/createPhase2C25BController\(/)
    expect(workerSources['../workers/plannerGlobalPhase2C25D2E.worker.benchmark.entry.ts']).toMatch(/new ProductionRngEngine\(\)/)
    for (const source of [worker, benchmarkSources['./plannerGlobalPhase2C25D2EProtocol.ts'], benchmarkSources['./plannerGlobalPhase2C25D2EHarness.ts'],
      benchmarkSources['./plannerGlobalPhase2C25D2E.ts']].map(code)) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|TargetSearchScheduler|bonusStream|skillStream|lazyIdealCross/)
      expect(source).not.toMatch(/PHASE2C25A_RESULT|D2D_RESULT|D2B_RESULT|parsePhase2C25D2DNodeResult|parsePhase2C25D2BBrowserBeforeResult/)
    }
    // The page needs neither the analysis nor the D2-b result.
    expect(pageSources['../pages/PlannerGlobalPhase2C25D2EBenchmarkPage.tsx']).not.toMatch(/Analysis|D2B_RESULT|PHASE2C25B_RESULTS/)
    expect(benchmarkSources['./plannerGlobalPhase2C25D2E.ts']).toMatch(/phase2c25d2bWorkload\(/)
    // The Search the controller calls is the current Production one.
    const controllerSearch = import.meta.glob('./plannerGlobalPhase2C25B.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(controllerSearch['./plannerGlobalPhase2C25B.ts']).toMatch(/await visitPlannerAlternativeCandidates\(searchInput, searchEngine,/)
  })

  it('is reached by no Production module, and Production keeps its Worker protocols, defaults, schema and versions', () => {
    const productionPaths = Object.keys(production).filter(path => !benchmarkOnly.some(pattern => pattern.test(path)))
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter(path => /plannerGlobalPhase2C25D2E|pg2c25d2e|PlannerGlobalPhase2C25D2EBenchmarkPage/i.test(production[path]))).toEqual([])
    for (const path of ['../workers/plannerWorkerContracts.ts', '../workers/planner.worker.ts', '../workers/planner.worker.production.ts', '../workers/contracts.ts', '../workers/search.worker.ts']) {
      expect(production[path], path).toBeDefined()
      expect(production[path], path).not.toMatch(/pg2c25d2e|Phase2C25D2E/)
    }
    expect(production['../pages/BenchmarkApp.tsx']).toMatch(/PlannerGlobalPhase2C25D2EBenchmarkPage/)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
