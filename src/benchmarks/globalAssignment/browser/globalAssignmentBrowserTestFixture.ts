/**
 * Test-only helpers of the Global Assignment Browser P-1 (Issue #154): a synthetic "Export" (the bytes of a synthetic scenario's
 * PlannerInput; no real Export, no real Target or weapon ID), a fresh table Engine per call built from the scenario spec, the D-1A child
 * call sequence written out directly (the parity reference), stage ports, and two Worker doubles - an in-process Worker that runs the
 * real controller, and a scripted Worker whose message delivery order the test controls (the cancel races of design 16.1).
 */
import { createDefaultAppSettings, createInitialRngState, EXPORT_APP_NAME, EXPORT_SCHEMA_VERSION } from '../../../domain/models/publicTypes'
import type { PlannerInput } from '../../../domain/planner/plannerTypes'
import type { RngEngine } from '../../../domain/rng/rngEngine'
import { globalResearchDependencies } from '../../plannerGlobalOptimizationResearch'
import { webCryptoSha256 } from '../../plannerGlobalBrowserEvidence'
import type { ExportIdentity } from '../assignmentProtocol'
import { createGlobalAssignmentContext } from '../context'
import { d0cFixtureConditions } from '../materializationFormalTestFixture'
import { runMaterializationSmoke, type MaterializedEntriesHandoff } from '../materializationRunner'
import { ELEMENT_A, ELEMENT_B, materializationScenario, OPEN_GATE, SERIES_IDEAL, type MaterializationScenarioSpec } from '../materializationTestFixture'
import { createTableEngine, IDEAL_BONUSES, keepToIdealRanks, keepToLowRanks, OTHER_FAMILIES, ownedGogma } from '../testFixture'
import { createD1aEntrySet, d1aEntrySetIssues, handoffFromEntrySet } from '../verificationProtocol'
import { verifyPlannerCandidate } from '../verify'
import { createGlobalAssignmentBrowserController, gabSha256Bytes, type GlobalAssignmentBrowserControllerOptions } from './globalAssignment.worker.benchmark'
import type { GabWorkerLike } from './globalAssignmentBrowserHarness'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, type GabExecutionOptions, type GabResponse, type GabWorkerEnvironment, type GabWorkerResult } from './globalAssignmentBrowserProtocol'
import { GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS, type GlobalAssignmentStageConditions, type GlobalAssignmentStagePorts } from './globalAssignmentBrowserStages'

/** The D-1A test scenario that ends `conditions_met` (a = owned Gogma Reset at 12, b = new Normal at 5 converting at 7, Reset at 11). */
export const SYNTHETIC_SPEC: MaterializationScenarioSpec = {
  targets: ['a', 'b'],
  owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL })],
  skillIdeal: { [ELEMENT_B]: [7] },
  reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
  window: { skill: 3, gogma: 5, normal: 2 },
}

/** Test conditions (never the registered ones): the D-1A test materialization conditions and the registered Research maxPlanSteps value. */
export const SYNTHETIC_CONDITIONS: GlobalAssignmentStageConditions = {
  materialization: d0cFixtureConditions({ projectedSearchScaleGate: OPEN_GATE }),
  verification: { researchMaxPlanSteps: 20_000, verificationBudget: 1 },
}

export const SYNTHETIC_EXECUTION: GabExecutionOptions = { yieldMode: 'timer', heartbeatIntervalMs: 50, workerHeapSampling: false }

/** A new table Engine per call with exactly the predictions `materializationScenario(spec)` gives its own Engine. */
export function scenarioEngineFactory(spec: MaterializationScenarioSpec): () => RngEngine {
  return () => createTableEngine({
    skill: (position, _weaponTypeId, elementId) => ({ seriesSkillId: (spec.skillIdeal?.[elementId] ?? []).includes(position) ? SERIES_IDEAL : 'series_skill.fixture.other', groupSkillId: null }),
    reset: (position, _weaponTypeId, elementId) => structuredClone(spec.reset?.[elementId]?.[position] ?? OTHER_FAMILIES),
    keep: (position, current) => ((spec.keepIdeal ?? []).includes(position) ? keepToIdealRanks(current) : keepToLowRanks(current)),
    ...(spec.normal ? { normal: (position: number, _weaponTypeId: string, elementId: string) => structuredClone(spec.normal?.[elementId]?.[position] ?? OTHER_FAMILIES) } : {}),
    ...(spec.support ? { support: spec.support } : {}),
    ...(spec.capabilities ? { capabilities: spec.capabilities } : {}),
  }).engine
}

/** The synthetic "Export" input builder: the PlannerInput as written, with the validation-only `maxPlanSteps` the Worker entry uses. */
export const syntheticBuildInput = (json: unknown): PlannerInput => ({ ...(json as PlannerInput), options: { maxPlanSteps: GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS } })

export interface SyntheticExport {
  bytes: ArrayBuffer
  identity: ExportIdentity
  createEngine: () => RngEngine
}

/** The bytes of a synthetic scenario's PlannerInput (optionally edited first) and their identity. */
export async function syntheticExport(spec: MaterializationScenarioSpec = SYNTHETIC_SPEC, edit: (input: PlannerInput) => PlannerInput = input => input, fileName = 'synthetic-export.json'): Promise<SyntheticExport> {
  const scene = await materializationScenario(spec)
  const encoded = new TextEncoder().encode(JSON.stringify(edit(scene.input)))
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
  return { bytes, identity: { fileName, bytes: bytes.byteLength, sha256: await gabSha256Bytes(bytes) }, createEngine: scenarioEngineFactory(spec) }
}

export function tickClock(): () => number {
  let tick = 0
  return () => (tick += 1)
}

/** Stage ports over a synthetic Export (no yield delay, no cancel unless given). */
export function syntheticPorts(source: SyntheticExport, overrides: Partial<GlobalAssignmentStagePorts> = {}): GlobalAssignmentStagePorts {
  return {
    readExport: async () => source.bytes.slice(0), sha256Bytes: gabSha256Bytes, sha256Text: webCryptoSha256, now: tickClock(), shouldCancel: () => false,
    yieldControl: async () => undefined, onEvent: () => undefined, createEngine: source.createEngine, buildInput: syntheticBuildInput, ...overrides,
  }
}

export function syntheticProvenance(source: SyntheticExport, buildCommit = 'c'.repeat(40)) {
  return { exportFileName: source.identity.fileName, expectedExport: { ...source.identity }, buildCommit }
}

/**
 * The D-1A child call sequence written out directly (`scripts/run-planner-global-assignment-d1a.mjs`, roles first and fresh) - the
 * parity reference of the stage module: the input from the bytes, the materialization on one Engine, the Entry set, Phase D' on a new
 * Engine; the fresh side with its own input, its own Phase 0, the Entry set check and Phase D' on a new Engine. Another clock than the
 * stage's, so a clock reaching a semantic record would show.
 */
export async function d1aReferenceRun(source: SyntheticExport, conditions: GlobalAssignmentStageConditions, buildCommit = 'c'.repeat(40)) {
  const exportIdentity = { ...source.identity }
  const now = () => 1_000_000 + Math.floor(Math.random() * 1_000)
  const yieldControl = async () => undefined
  // first
  const firstInput = syntheticBuildInput(JSON.parse(new TextDecoder().decode(source.bytes)))
  const engine = source.createEngine()
  const handoffs: MaterializedEntriesHandoff[] = []
  const materialization = await runMaterializationSmoke(firstInput, globalResearchDependencies(engine), { conditions: conditions.materialization }, {
    now, yieldControl, onProgress: () => undefined, onMaterializedEntries: handoff => { handoffs.push(handoff) },
  })
  const handoff = handoffs[0]!
  const entrySet = createD1aEntrySet(handoff, { repositoryHeadSha: buildCommit, export: exportIdentity, calculationContext: firstInput.calculationContext, rngEngineVersion: engine.version })
  const firstVerification = await verifyPlannerCandidate(firstInput, handoff, globalResearchDependencies(source.createEngine()), { researchMaxPlanSteps: conditions.verification.researchMaxPlanSteps }, { now, yieldControl, onStage: () => undefined })
  // fresh
  const freshInput = syntheticBuildInput(JSON.parse(new TextDecoder().decode(source.bytes)))
  const freshEngine = source.createEngine()
  const phase0 = createGlobalAssignmentContext(freshInput, globalResearchDependencies(freshEngine))
  if (phase0.kind !== 'context') throw new Error(phase0.detail)
  const read = JSON.parse(JSON.stringify(entrySet))
  const issues = d1aEntrySetIssues(read, { repositoryHeadSha: buildCommit, export: exportIdentity, calculationContext: freshInput.calculationContext, rngEngineVersion: freshEngine.version, entryFingerprint: entrySet.entryFingerprint })
  if (issues.length > 0) throw new Error(issues.join(' '))
  const freshPhase0 = phase0.context.planningTargets.map(target => target.id as string)
  const freshVerification = await verifyPlannerCandidate(freshInput, handoffFromEntrySet(read, freshPhase0), globalResearchDependencies(source.createEngine()), { researchMaxPlanSteps: conditions.verification.researchMaxPlanSteps }, { now, yieldControl, onStage: () => undefined })
  const sha = (value: unknown) => webCryptoSha256(JSON.stringify(value))
  return {
    first: { materialization: materialization.semantic, materializationSha256: await sha(materialization.semantic), entrySet, verification: firstVerification.semantic, verificationSha256: await sha(firstVerification.semantic), handoffs },
    fresh: { phase0PlanningTargetIdsSorted: [...freshPhase0].sort(), verification: freshVerification.semantic, verificationSha256: await sha(freshVerification.semantic) },
  }
}

type Listener = (event: Event) => void

/** A Worker double whose outgoing messages the test enqueues and delivers in the order it chooses. */
export class ScriptedWorker implements GabWorkerLike {
  readonly posted: unknown[] = []
  readonly transfers: (Transferable[] | undefined)[] = []
  terminated = 0
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly queue: unknown[] = []

  postMessage(message: unknown, transfer?: Transferable[]): void { this.posted.push(message); this.transfers.push(transfer) }
  addEventListener(type: string, listener: Listener): void { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
  terminate(): void { this.terminated += 1 }
  postedOfType(type: string): Record<string, unknown>[] { return this.posted.filter(message => (message as { type?: string }).type === type) as Record<string, unknown>[] }
  /** The Worker has sent this message; the main thread has not received it yet. */
  enqueue(message: GabResponse | Record<string, unknown>): void { this.queue.push(message) }
  /** Delivers the oldest `count` queued messages (all by default) to the main thread. */
  deliver(count = this.queue.length): void { for (const message of this.queue.splice(0, count)) this.dispatch('message', { data: message }) }
  emit(message: GabResponse | Record<string, unknown>): void { this.dispatch('message', { data: message }) }
  fail(type: 'error' | 'messageerror' = 'error'): void { this.dispatch(type, { type, message: 'boom' }) }
  private dispatch(type: string, event: Record<string, unknown>): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as unknown as Event) }
}

export const READY_ENVIRONMENT: GabWorkerEnvironment = {
  protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, crossOriginIsolated: false, isSecureContext: true, hardwareConcurrency: 4, deviceMemory: null, userAgent: 'test',
  language: 'ja', languages: ['ja'], locale: 'ja', timeOrigin: 0,
  capabilities: { cryptoSubtle: true, messageChannel: true, structuredClone: true, textDecoder: true, workerPerformanceMemory: false },
  rngEngineVersion: 'fake-fixture:global-research', build: null, buildCommit: null,
}

/**
 * A Worker double running the real controller in this realm: requests are structured-cloned (the Blob of a `blob` payload is passed by
 * reference, as the real clone shares it), responses are delivered asynchronously, and nothing is delivered after `terminate()`
 * (the controller's own computation is not interrupted, exactly as a terminated Worker's work is lost).
 */
export class InProcessWorker implements GabWorkerLike {
  readonly posted: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly controller: ReturnType<typeof createGlobalAssignmentBrowserController>
  private readonly deliverAfter: (message: GabResponse) => number
  private readonly transform: (message: GabResponse) => unknown

  /** `transform`: what the main thread receives instead of a response (tests of a malformed Worker; the identity by default). */
  constructor(options: GlobalAssignmentBrowserControllerOptions, deliverAfter: (message: GabResponse) => number = () => 0, transform: (message: GabResponse) => unknown = message => message) {
    this.deliverAfter = deliverAfter
    this.transform = transform
    this.controller = createGlobalAssignmentBrowserController(response => this.send(response), options)
    queueMicrotask(() => this.send({ type: 'gab_ready', protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, environment: this.controller.environment() }))
  }

  postMessage(message: unknown): void {
    this.posted.push(message)
    if (this.terminated) return
    const record = message as { exportPayload?: { kind: string; blob?: Blob } }
    const blob = record.exportPayload?.kind === 'blob' ? record.exportPayload.blob : undefined
    const cloned = blob === undefined ? structuredClone(message) : { ...structuredClone({ ...record, exportPayload: { kind: 'blob' } }), exportPayload: { kind: 'blob', blob } }
    setTimeout(() => { if (!this.terminated) void this.controller.handleMessage(cloned) }, 0)
  }

  addEventListener(type: string, listener: Listener): void { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
  terminate(): void { this.terminated = true }

  private send(response: GabResponse): void {
    if (this.terminated) return
    const data = this.transform(structuredClone(response))
    setTimeout(() => {
      if (this.terminated) return
      for (const listener of [...(this.listeners.get('message') ?? [])]) listener({ data } as unknown as Event)
    }, this.deliverAfter(response))
  }
}

/**
 * A minimal synthetic Export (schema 13) holding no real data: an initial RNG state, default settings and empty collections. It passes
 * the pure Export validation with the Production Master and stops at Phase 0 (`no_planning_target`); the real Browser check uses it too.
 */
export function minimalSyntheticExportRoot(): Record<string, unknown> {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION, appName: EXPORT_APP_NAME, exportedAt: at, rngState: createInitialRngState(at), normalArtianCounters: [], ownedWeapons: [], targetWeapons: [],
    buildCandidates: [], buildListEntries: [], productionPlans: [], executionHistory: [], executionSavePoints: [], settings: createDefaultAppSettings(at),
  }
}

export async function bytesOf(text: string, fileName = 'synthetic-minimal-export.json'): Promise<{ bytes: ArrayBuffer; identity: ExportIdentity }> {
  const encoded = new TextEncoder().encode(text)
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
  return { bytes, identity: { fileName, bytes: bytes.byteLength, sha256: await gabSha256Bytes(bytes) } }
}

/** A promise the test settles by hand (an async boundary it controls: an Export read, a ready wait, a memory sample). */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

export const SYNTHETIC_IDENTITY: ExportIdentity = { fileName: 'synthetic.json', bytes: 4, sha256: 'a'.repeat(64) }

/**
 * A first-Worker result that `gabWorkerResultIssues()` accepts but that carries no calculation: a materialization record whose outcome
 * holds `marker` (so a test can prove a payload was dropped), no handoff, no Entry set, no Phase D'. Its `semanticSha256` is not the
 * hash of its record unless the caller replaces it (a re-hash mismatch).
 */
export function syntheticWorkerResult(requestId: string, marker = 'the-calculation', identity: ExportIdentity = SYNTHETIC_IDENTITY): GabWorkerResult {
  const result = {
    protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, requestId, role: 'first', environment: READY_ENVIRONMENT,
    exportObservation: { ...identity, matchesRequest: true },
    calculationContext: { gameVersion: 'synthetic', masterDataVersion: 4, rngEngineVersion: READY_ENVIRONMENT.rngEngineVersion, appSchemaVersion: 17 },
    rngEngineVersion: READY_ENVIRONMENT.rngEngineVersion,
    conditions: { materialization: structuredClone(SYNTHETIC_CONDITIONS.materialization), researchMaxPlanSteps: 20_000, verificationBudget: 1, source: 'test_injected' },
    plannerInputMaxPlanStepsForValidationOnly: GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS,
    phase0: { planningTargetCount: 0, planningTargetIdsSorted: null },
    materialization: {
      semantic: { outcome: { kind: 'no_structural_candidate', reason: marker }, input: {}, candidates: [], integrityIssues: [] }, semanticSha256: 'f'.repeat(64),
      summary: {}, observed: { elapsedMs: { context: 1, reachTable: null, structuralSearch: null, toFirstStructuralCandidate: null, candidates: [], total: 1 }, yields: 0 }, handoffCount: 0,
    },
    entrySet: null, freshEntrySet: null, verification: null, integrityIssues: [],
    observed: {
      timing: { input: { exportReadMs: 0, exportHashMs: 0, decodeMs: 0, parseMs: 0, buildInputMs: 0, totalMs: 0 }, phase0Ms: null, materializationWallMs: 1, verificationWallMs: null,
        evidence: { materializationHashMs: 0, entrySetMs: null, verificationHashMs: null }, stageTotalMs: 1, workerTotalMs: 1 },
      slices: {}, longestYieldGap: null, yields: 0, heartbeats: 0, progressEvents: 0, workerHeap: null, acceptedAtEpochMs: 1,
    },
    formal: false, oracleFreeExecution: true,
  }
  return result as unknown as GabWorkerResult
}

/** Controller options over a synthetic Export's Engine (the conditions injected, as only tests may). */
export function syntheticControllerOptions(source: SyntheticExport, overrides: Partial<GlobalAssignmentBrowserControllerOptions> = {}): GlobalAssignmentBrowserControllerOptions {
  return {
    createEngine: source.createEngine, buildInput: syntheticBuildInput, conditions: { read: () => structuredClone(SYNTHETIC_CONDITIONS), source: 'test_injected' },
    yieldFor: () => async () => undefined, build: () => null, environmentOverrides: { isSecureContext: true }, ...overrides,
  }
}
