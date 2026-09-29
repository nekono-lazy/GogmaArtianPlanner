import type { PlannerInput } from '../domain/planner/plannerTypes'
import { stableStringify } from '../domain/models/publicTypes'
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import {
  comparePhase2C25BContextParity,
  parsePhase2C25BEvidence,
  phase2c25bWorkload,
  type Phase2C25BEvidenceView,
  type Phase2C25BParity,
  type Phase2C25BWorkloadContext,
} from './plannerGlobalPhase2C25BEvidence'
import {
  isPhase2C25BNormalStatus,
  isPhase2C25BResponse,
  PHASE2C25B_CANDIDATE_STOP_BOUND,
  PHASE2C25B_CONTEXTS_BUDGET_MS,
  PHASE2C25B_PROTOCOL_VERSION,
  PHASE2C25B_READY_BUDGET_MS,
  PHASE2C25B_RUN_BUDGET_MS,
  PHASE2C25B_SNAPSHOT_POLICY,
  type Phase2C25BContextsResult,
  type Phase2C25BErrorStage,
  type Phase2C25BMode,
  type Phase2C25BPageRunStatus,
  type Phase2C25BProgressSnapshot,
  type Phase2C25BRequest,
  type Phase2C25BRunStatus,
  type Phase2C25BSearchRecord,
  type Phase2C25BSnapshotPolicy,
  type Phase2C25BWorkerEnvironment,
  type Phase2C25BWorkerHeapSample,
} from './plannerGlobalPhase2C25BProtocol'

/**
 * Issue #154 Phase 2-C2.5-B main-thread harness and runner. Research only; benchmark.html only.
 *
 * - One run = one fresh Dedicated Worker, disposed when the run settles (a failure included).
 * - The page keeps every observable outcome apart: a Worker result (first Candidate / extent stop / exhaustion), a
 *   structured error, a native Worker `error` before or after the first Candidate notice, `messageerror`, a ready
 *   failure, a timeout and an external abort. A native failure is never a "no Candidate" result and never an
 *   out-of-memory claim.
 * - Every lifecycle event is also relayed as one `console.info('[pg2c25b]', json)` line, so an external CDP driver keeps
 *   what the page saw up to the moment the page itself is lost. The relay is a copy; nothing reads it back.
 *
 * The only calculation input is the PlannerInput the page built from the original Export; the Phase 2-C2.5-A evidence
 * selects the workload and is the parity reference, and never reaches a Worker.
 */

export const PHASE2C25B_RELAY_PREFIX = '[pg2c25b]'

export interface Phase2C25BTimeline {
  /** Main-thread ms since `new Worker()`. */
  readonly readyAtMs: number | null
  readonly requestPostedAtMs: number | null
  readonly acceptedAtMs: number | null
  readonly searchReadyAtMs: number | null
  readonly firstCandidateNoticeAtMs: number | null
  readonly settledAtMs: number | null
}

export interface Phase2C25BRunError {
  readonly source: 'structured' | 'native_error' | 'messageerror' | 'timeout' | 'ready' | 'aborted'
  readonly message: string
  readonly stage: Phase2C25BErrorStage | null
  readonly name: string | null
  readonly firstCandidateDelivered: boolean | null
}

export interface Phase2C25BRunRecord {
  readonly id: string
  readonly sequence: number
  readonly runKey: string
  readonly orientationId: string
  readonly workIndex: number
  readonly targetWeaponId: string
  readonly contextDigest: string
  readonly role: string
  readonly kind: string
  readonly mode: Phase2C25BMode
  readonly attempt: number
  readonly startedAt: string
  /** `performance.timeOrigin + now()` at `new Worker()`. */
  readonly workerCreatedAtEpochMs: number
  readonly timeline: Phase2C25BTimeline
  readonly workerEnvironment: Phase2C25BWorkerEnvironment | null
  readonly preparationMs: number | null
  readonly searchReadyWorkerHeap: Phase2C25BWorkerHeapSample | null
  readonly status: Phase2C25BPageRunStatus
  readonly error: Phase2C25BRunError | null
  readonly firstCandidateNotice: { readonly timeToFirstMs: number; readonly atMs: number } | null
  readonly result: Phase2C25BSearchRecord | null
  /** Browser semantic digest of a normal termination (status, Search summary, first Candidate key SHA-256). */
  readonly semanticDigest: string | null
  readonly progress: { readonly count: number; readonly snapshots: readonly Phase2C25BProgressSnapshot[] }
  readonly visibility: { readonly atStart: string; readonly atEnd: string; readonly changes: number }
  /** Worker creation to dispose (main-thread ms). */
  readonly workerLifetimeMs: number
  readonly lateMessages: number
}

export function phase2c25bSemanticDigest(record: Pick<Phase2C25BSearchRecord, 'status' | 'searchSummary' | 'firstCandidateKeySha256'>): string {
  return stableStringify({ status: record.status, summary: record.searchSummary, firstCandidateKeySha256: record.firstCandidateKeySha256 })
}

export function phase2c25bRunKey(orientationId: string, workIndex: number, mode: Phase2C25BMode, attempt: number): string {
  return `${orientationId}#${workIndex}:${mode}:a${attempt}`
}

// ---------------------------------------------------------------- repeat policy

const CRASH: readonly Phase2C25BRunStatus[] = ['page_crashed', 'browser_crashed']
const NATIVE_FAILURE: readonly Phase2C25BRunStatus[] = ['worker_error_before_first_candidate', 'worker_error_after_first_candidate', 'worker_messageerror',
  'worker_target_destroyed_before_first_candidate']

/**
 * Whether a context's pair is run once more under the same conditions: a page / browser crash, a native Worker failure,
 * a minimal / instrumented disagreement, or a CDP attach failure. The first pair is always kept; a repeat is recorded
 * beside it, never in its place, and a context is repeated at most once (the caller passes the attempt).
 */
export function phase2c25bRepeatDecision(pair: { readonly attempt: number; readonly minimal: { status: Phase2C25BRunStatus; semanticDigest: string | null };
  readonly instrumented: { status: Phase2C25BRunStatus; semanticDigest: string | null }; readonly cdpAttachFailure: boolean }): { repeat: boolean; reasons: string[] } {
  const statuses = [pair.minimal.status, pair.instrumented.status]
  const reasons: string[] = []
  if (statuses.some(status => CRASH.includes(status))) reasons.push('page_or_browser_crash')
  if (statuses.some(status => NATIVE_FAILURE.includes(status))) reasons.push('native_worker_failure')
  const minimalNormal = isPhase2C25BNormalStatus(pair.minimal.status), instrumentedNormal = isPhase2C25BNormalStatus(pair.instrumented.status)
  if (minimalNormal !== instrumentedNormal || (minimalNormal && pair.minimal.semanticDigest !== pair.instrumented.semanticDigest)
    || (!minimalNormal && pair.minimal.status !== pair.instrumented.status)) reasons.push('mode_classification_mismatch')
  if (pair.cdpAttachFailure) reasons.push('cdp_attach_failure')
  return { repeat: pair.attempt === 1 && reasons.length > 0, reasons }
}

// ---------------------------------------------------------------- one run on one fresh Worker

export interface Phase2C25BHarnessDependencies {
  readonly createWorker?: () => BenchmarkWorkerLike
  readonly now?: () => number
  readonly epochNow?: () => number
  readonly relay?: (event: Record<string, unknown>) => void
  readonly setTimer?: (callback: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

function createPhase2C25BWorker(): BenchmarkWorkerLike {
  return new Worker(new URL('../workers/plannerGlobalPhase2C25B.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as BenchmarkWorkerLike
}

type WorkerOutcome =
  | { kind: 'contexts'; result: Phase2C25BContextsResult }
  | { kind: 'search'; record: Phase2C25BSearchRecord }
  | { kind: 'structured'; stage: Phase2C25BErrorStage; name: string; message: string; firstCandidateDelivered: boolean }
  | { kind: 'native_error' | 'messageerror' | 'timeout' | 'ready' | 'aborted'; message: string }

interface WorkerSession {
  readonly createdAtEpochMs: number
  readonly environment: () => Phase2C25BWorkerEnvironment | null
  readonly timeline: () => Phase2C25BTimeline
  readonly run: (request: Phase2C25BRequest, budgetMs: number) => Promise<WorkerOutcome>
  readonly abort: (reason: string) => void
  readonly dispose: () => number
  readonly lateMessages: () => number
}

/**
 * One fresh Worker serving one request. `onEvent` sees every response in arrival order (the runner records progress
 * and the first Candidate notice from it).
 */
function openWorkerSession(dependencies: Required<Omit<Phase2C25BHarnessDependencies, 'createWorker' | 'relay'>> & { createWorker: () => BenchmarkWorkerLike },
  onEvent: (event: { type: string; atMs: number; data: Record<string, unknown> }) => void): WorkerSession {
  const { now, epochNow, setTimer, clearTimer } = dependencies
  const createdAt = now()
  const createdAtEpochMs = epochNow()
  const worker = dependencies.createWorker()
  const at = () => now() - createdAt
  let environment: Phase2C25BWorkerEnvironment | null = null
  const marks: { -readonly [K in keyof Phase2C25BTimeline]: number | null } = { readyAtMs: null, requestPostedAtMs: null, acceptedAtMs: null, searchReadyAtMs: null,
    firstCandidateNoticeAtMs: null, settledAtMs: null }
  let settle: ((outcome: WorkerOutcome) => void) | null = null
  let readyResolve: (() => void) | null = null
  let broken: WorkerOutcome | null = null
  let late = 0
  let disposedAt: number | null = null
  const finish = (outcome: WorkerOutcome) => {
    if (settle === null) { broken ??= outcome; return }
    marks.settledAtMs = at()
    const done = settle
    settle = null
    done(outcome)
  }
  const onMessage = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data
    if (!isPhase2C25BResponse(data)) return
    const atMs = at()
    if (data.type === 'pg2c25b_benchmark_ready') {
      environment ??= data.environment
      marks.readyAtMs ??= atMs
      readyResolve?.()
      return
    }
    if (settle === null) { late += 1; return }
    onEvent({ type: data.type, atMs, data: data as unknown as Record<string, unknown> })
    switch (data.type) {
      case 'pg2c25b_benchmark_accepted': marks.acceptedAtMs ??= atMs; return
      case 'pg2c25b_benchmark_search_ready': marks.searchReadyAtMs ??= atMs; return
      case 'pg2c25b_benchmark_first_candidate': marks.firstCandidateNoticeAtMs ??= atMs; return
      case 'pg2c25b_benchmark_progress': return
      case 'pg2c25b_benchmark_contexts_result': finish({ kind: 'contexts', result: data.result }); return
      case 'pg2c25b_benchmark_search_result': finish({ kind: 'search', record: data.record }); return
      case 'pg2c25b_benchmark_error': finish({ kind: 'structured', stage: data.stage, name: data.name, message: data.message, firstCandidateDelivered: data.firstCandidateDelivered })
    }
  }
  const onError = (event: Event) => {
    const detail = event as ErrorEvent
    const message = `${event.type}${detail.message ? `: ${detail.message}` : ''}${detail.filename ? ` (${detail.filename}:${detail.lineno ?? '?'})` : ''}`
    finish({ kind: event.type === 'messageerror' ? 'messageerror' : 'native_error', message })
  }
  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)
  worker.addEventListener('messageerror', onError)
  return {
    createdAtEpochMs,
    environment: () => environment,
    timeline: () => ({ ...marks }),
    run: (request, budgetMs) => new Promise<WorkerOutcome>(resolve => {
      settle = resolve
      if (broken !== null) { const outcome = broken; broken = null; finish(outcome); return }
      const budget = setTimer(() => finish({ kind: 'timeout', message: `No settlement within ${budgetMs} ms.` }), budgetMs)
      const release = settle
      settle = outcome => { clearTimer(budget); release(outcome) }
      const post = () => {
        if (settle === null) return
        marks.requestPostedAtMs = at()
        worker.postMessage(request)
      }
      if (marks.readyAtMs !== null) { post(); return }
      const readyTimer = setTimer(() => finish({ kind: 'ready', message: `The Worker did not become ready within ${PHASE2C25B_READY_BUDGET_MS} ms.` }), PHASE2C25B_READY_BUDGET_MS)
      readyResolve = () => { readyResolve = null; clearTimer(readyTimer); post() }
      const withReady = settle
      settle = outcome => { if (readyResolve !== null) { readyResolve = null; clearTimer(readyTimer) } withReady(outcome) }
    }),
    abort: reason => finish({ kind: 'aborted', message: reason }),
    dispose: () => {
      if (disposedAt === null) {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        worker.removeEventListener('messageerror', onError)
        worker.terminate()
        disposedAt = at()
      }
      return disposedAt
    },
    lateMessages: () => late,
  }
}

// ---------------------------------------------------------------- runner

export interface Phase2C25BFileInfo {
  readonly fileName: string
  readonly byteSize: number
  readonly sha256: string
}

export interface Phase2C25BPreparation {
  readonly status: 'ok' | 'failed'
  readonly message: string | null
  readonly exportShaMatchesEvidence: boolean
  readonly researchMaxPlanStepsMatchesEvidence: boolean
  readonly candidateStopBoundMatchesEvidence: boolean
  readonly contextsWorker: null | { readonly status: string; readonly message: string | null; readonly wallMs: number; readonly baselineElapsedMs: number | null;
    readonly derivationElapsedMs: number | null; readonly workerCreatedAtEpochMs: number }
  readonly parity: Phase2C25BParity | null
  readonly preparedAt: string
}

export interface Phase2C25BRunnerDependencies extends Phase2C25BHarnessDependencies {
  readonly sha256: (text: string) => Promise<string>
  readonly sha256Bytes: (bytes: ArrayBuffer) => Promise<string>
  /** Builds the PlannerInput from the parsed Export (the pure Research path, research maxPlanSteps). */
  readonly buildInput: (json: unknown) => { input: PlannerInput; maxPlanSteps: number }
  readonly visibilityState?: () => string
  readonly onVisibilityChange?: (listener: () => void) => () => void
  readonly clock?: () => string
  readonly createRequestId?: () => string
  readonly onChange?: () => void
  /**
   * A later Research phase that reuses this runner (Phase 2-C2.5-D2-b): its protocol version, record ID prefix and
   * workload. Omitted, the runner is exactly Phase 2-C2.5-B (every searchable context of every selected orientation).
   * With a phase, the contexts Worker derives, and the parity compares, only the orientations of that workload.
   */
  readonly phase?: Phase2C25BRunnerPhase
}

export interface Phase2C25BRunnerPhase {
  readonly protocolVersion: string
  readonly recordIdPrefix: string
  /** The phase's workload, derived from the Phase 2-C2.5-A evidence alone (its typed view and the same parsed JSON). */
  readonly workload: (view: Phase2C25BEvidenceView, json: unknown) => Phase2C25BWorkloadContext[]
}

/** The evidence view narrowed to the given orientations (selection and recorded contexts), for the phase's parity. */
export function phase2c25bEvidenceForOrientations(view: Phase2C25BEvidenceView, orientationIds: readonly string[]): Phase2C25BEvidenceView {
  const missing = orientationIds.filter(id => !view.selection.some(s => s.orientationId === id))
  if (missing.length > 0) throw new Error(`The workload names orientations the Phase 2-C2.5-A evidence did not select: ${missing.join(', ')}.`)
  return { ...view, selection: view.selection.filter(s => orientationIds.includes(s.orientationId)),
    expectedContexts: view.expectedContexts.filter(c => orientationIds.includes(c.orientationId)) }
}

export interface Phase2C25BRunRequest {
  readonly orientationId: string
  readonly workIndex: number
  readonly mode: Phase2C25BMode
  readonly attempt?: number
  readonly budgetMs?: number
}

export function createPhase2C25BRunner(dependencies: Phase2C25BRunnerDependencies) {
  const now = dependencies.now ?? (() => performance.now())
  const epochNow = dependencies.epochNow ?? (() => performance.timeOrigin + performance.now())
  const relay = dependencies.relay ?? (event => console.info(PHASE2C25B_RELAY_PREFIX, JSON.stringify(event)))
  const setTimer = dependencies.setTimer ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms))
  const clearTimer = dependencies.clearTimer ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  const createWorker = dependencies.createWorker ?? createPhase2C25BWorker
  const visibilityState = dependencies.visibilityState ?? (() => document.visibilityState)
  const onVisibilityChange = dependencies.onVisibilityChange ?? (listener => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  })
  const clock = dependencies.clock ?? (() => new Date().toISOString())
  const createRequestId = dependencies.createRequestId ?? (() => `pg2c25b-${crypto.randomUUID()}`)
  const sessionDependencies = { now, epochNow, setTimer, clearTimer, createWorker }

  let exportInfo: Phase2C25BFileInfo | null = null
  let evidenceInfo: Phase2C25BFileInfo | null = null
  let input: PlannerInput | null = null
  let researchMaxPlanSteps: number | null = null
  let evidence: Phase2C25BEvidenceView | null = null
  let evidenceJson: unknown = null
  const phase = dependencies.phase ?? null
  const protocolVersion = phase?.protocolVersion ?? PHASE2C25B_PROTOCOL_VERSION
  let preparation: Phase2C25BPreparation | null = null
  let orientations: Phase2C2Orientation[] = []
  const records: Phase2C25BRunRecord[] = []
  let sequence = 0
  let active: { runKey: string; session: WorkerSession; startedAtEpochMs: number; phase: string } | null = null
  let stopRequested = false
  let busy: string | null = null
  const changed = () => dependencies.onChange?.()

  const guard = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
    if (busy !== null) throw new Error(`Busy (${busy}).`)
    busy = label
    changed()
    try { return await task() } finally { busy = null; changed() }
  }

  async function loadExport(bytes: ArrayBuffer, fileName: string): Promise<Phase2C25BFileInfo> {
    const sha256 = await dependencies.sha256Bytes(bytes)
    input = null
    exportInfo = null
    preparation = null
    const built = dependencies.buildInput(JSON.parse(new TextDecoder().decode(bytes)))
    input = built.input
    researchMaxPlanSteps = built.maxPlanSteps
    exportInfo = { fileName, byteSize: bytes.byteLength, sha256 }
    changed()
    return exportInfo
  }

  async function loadEvidence(bytes: ArrayBuffer, fileName: string): Promise<Phase2C25BFileInfo> {
    const sha256 = await dependencies.sha256Bytes(bytes)
    evidence = null
    evidenceJson = null
    evidenceInfo = null
    preparation = null
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const view = parsePhase2C25BEvidence(json)
    if (phase !== null) phase.workload(view, json)
    evidence = view
    evidenceJson = json
    evidenceInfo = { fileName, byteSize: bytes.byteLength, sha256 }
    changed()
    return evidenceInfo
  }

  /**
   * This page session's own contexts (a fresh contexts Worker over the Export's PlannerInput) and their parity with the
   * evidence. A mismatch of the Export SHA-256, of a recorded condition or of any context field leaves the preparation
   * failed, and no formal run starts.
   */
  function prepare(): Promise<Phase2C25BPreparation> {
    return guard('prepare', async () => {
      if (!input || !evidence || !exportInfo || researchMaxPlanSteps === null) throw new Error('Load the original Export and the Phase 2-C2.5-A evidence first.')
      const exportShaMatchesEvidence = exportInfo.sha256 === evidence.exportSha256
      const researchMaxPlanStepsMatchesEvidence = researchMaxPlanSteps === evidence.researchMaxPlanSteps
      const candidateStopBoundMatchesEvidence = PHASE2C25B_CANDIDATE_STOP_BOUND === evidence.candidateStopBound
      const base = { exportShaMatchesEvidence, researchMaxPlanStepsMatchesEvidence, candidateStopBoundMatchesEvidence, preparedAt: clock() }
      if (!exportShaMatchesEvidence || !researchMaxPlanStepsMatchesEvidence || !candidateStopBoundMatchesEvidence) {
        preparation = { ...base, status: 'failed', message: 'The Export or a recorded condition differs from the Phase 2-C2.5-A evidence.', contextsWorker: null, parity: null }
        return preparation
      }
      const parityView = phase === null ? evidence
        : phase2c25bEvidenceForOrientations(evidence, [...new Set(phase.workload(evidence, evidenceJson).map(c => c.orientationId))])
      const session = openWorkerSession(sessionDependencies, event => relay({ event: `contexts:${event.type}`, atMs: event.atMs }))
      relay({ event: 'contexts_worker_created', epochMs: session.createdAtEpochMs })
      const started = now()
      let outcome: WorkerOutcome
      try {
        outcome = await session.run({ type: 'pg2c25b_benchmark_contexts', requestId: createRequestId(), input,
          orientationIds: parityView.selection.map(s => s.orientationId) }, PHASE2C25B_CONTEXTS_BUDGET_MS)
      } finally {
        session.dispose()
      }
      const wallMs = now() - started
      relay({ event: 'contexts_worker_disposed', status: outcome.kind })
      if (outcome.kind !== 'contexts') {
        preparation = { ...base, status: 'failed', message: `The contexts Worker failed: ${outcome.kind}: ${'message' in outcome ? outcome.message : ''}`,
          contextsWorker: { status: outcome.kind, message: 'message' in outcome ? outcome.message : null, wallMs, baselineElapsedMs: null, derivationElapsedMs: null,
            workerCreatedAtEpochMs: session.createdAtEpochMs }, parity: null }
        return preparation
      }
      const parity = await comparePhase2C25BContextParity(parityView, outcome.result, dependencies.sha256)
      orientations = outcome.result.baseline.orientations
      preparation = { ...base, status: parity.matches ? 'ok' : 'failed', message: parity.matches ? null : `Context parity failed: ${parity.mismatches.join(' / ')}`,
        contextsWorker: { status: 'completed', message: null, wallMs, baselineElapsedMs: outcome.result.baseline.elapsedMs, derivationElapsedMs: outcome.result.elapsedMs,
          workerCreatedAtEpochMs: session.createdAtEpochMs }, parity }
      relay({ event: 'prepared', status: preparation.status })
      return preparation
    })
  }

  function selectedContexts(): Phase2C25BWorkloadContext[] {
    if (!evidence) throw new Error('Load the Phase 2-C2.5-A evidence first.')
    return phase === null ? phase2c25bWorkload(evidence) : phase.workload(evidence, evidenceJson)
  }

  async function runOne(request: Phase2C25BRunRequest): Promise<Phase2C25BRunRecord> {
    if (!input || !evidence || preparation?.status !== 'ok') throw new Error('The preparation (Export / evidence / context parity) has not succeeded.')
    const context = selectedContexts().find(c => c.orientationId === request.orientationId && c.workIndex === request.workIndex)
    if (!context) throw new Error(`${request.orientationId}#${request.workIndex} is not a selected searchable context.`)
    const orientation = orientations.find(o => o.orientationId === request.orientationId)
    if (!orientation) throw new Error(`This page session's baseline has no orientation ${request.orientationId}.`)
    const attempt = request.attempt ?? 1
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer.')
    if (request.mode !== 'minimal' && request.mode !== 'instrumented') throw new RangeError('mode must be minimal or instrumented.')
    const runKey = phase2c25bRunKey(context.orientationId, context.workIndex, request.mode, attempt)
    const id = `${phase?.recordIdPrefix ?? 'pg2c25b-record-'}${++sequence}`
    const startedAt = clock()
    const visibilityAtStart = visibilityState()
    let visibilityChanges = 0
    const stopVisibility = onVisibilityChange(() => { visibilityChanges += 1 })
    const snapshots: Phase2C25BProgressSnapshot[] = []
    let firstCandidateNotice: Phase2C25BRunRecord['firstCandidateNotice'] = null
    let preparationMs: number | null = null
    let searchReadyWorkerHeap: Phase2C25BWorkerHeapSample | null = null
    const session = openWorkerSession(sessionDependencies, event => {
      if (event.type === 'pg2c25b_benchmark_progress') {
        const snapshot = event.data.snapshot as Phase2C25BProgressSnapshot
        snapshots.push(snapshot)
        relay({ event: 'progress', runKey, atMs: event.atMs, snapshot })
        return
      }
      if (event.type === 'pg2c25b_benchmark_first_candidate') {
        firstCandidateNotice ??= { timeToFirstMs: event.data.timeToFirstMs as number, atMs: event.atMs }
      }
      if (event.type === 'pg2c25b_benchmark_search_ready') {
        preparationMs = event.data.preparationMs as number
        searchReadyWorkerHeap = event.data.workerHeap as Phase2C25BWorkerHeapSample | null
      }
      relay({ event: event.type.replace('pg2c25b_benchmark_', ''), runKey, atMs: event.atMs, epochMs: session.createdAtEpochMs + event.atMs })
    })
    active = { runKey, session, startedAtEpochMs: session.createdAtEpochMs, phase: 'running' }
    relay({ event: 'run_started', runKey, workerCreatedAtEpochMs: session.createdAtEpochMs })
    changed()
    let outcome: WorkerOutcome
    try {
      outcome = await session.run({ type: 'pg2c25b_benchmark_search', requestId: createRequestId(), input, orientation, workIndex: context.workIndex,
        expectedContextDigest: context.contextDigest, mode: request.mode, snapshotPolicy: { ...PHASE2C25B_SNAPSHOT_POLICY } satisfies Phase2C25BSnapshotPolicy },
      request.budgetMs ?? PHASE2C25B_RUN_BUDGET_MS)
    } finally {
      stopVisibility()
    }
    const workerLifetimeMs = session.dispose()
    const noticed = firstCandidateNotice !== null
    let status: Phase2C25BPageRunStatus
    let error: Phase2C25BRunError | null = null
    let result: Phase2C25BSearchRecord | null = null
    switch (outcome.kind) {
      case 'search': result = outcome.record; status = outcome.record.status; break
      case 'structured':
        status = 'structured_error'
        error = { source: 'structured', message: outcome.message, stage: outcome.stage, name: outcome.name, firstCandidateDelivered: outcome.firstCandidateDelivered }
        break
      case 'native_error':
        status = noticed ? 'worker_error_after_first_candidate' : 'worker_error_before_first_candidate'
        error = { source: 'native_error', message: outcome.message, stage: null, name: null, firstCandidateDelivered: noticed }
        break
      case 'messageerror':
        status = 'worker_messageerror'
        error = { source: 'messageerror', message: outcome.message, stage: null, name: null, firstCandidateDelivered: noticed }
        break
      case 'timeout': status = 'timeout'; error = { source: 'timeout', message: outcome.message, stage: null, name: null, firstCandidateDelivered: noticed }; break
      case 'ready': status = 'worker_not_ready'; error = { source: 'ready', message: outcome.message, stage: null, name: null, firstCandidateDelivered: false }; break
      case 'aborted': status = 'aborted'; error = { source: 'aborted', message: outcome.message, stage: null, name: null, firstCandidateDelivered: noticed }; break
      default: throw new Error(`Unexpected Worker outcome ${outcome.kind}.`)
    }
    const record: Phase2C25BRunRecord = {
      id, sequence, runKey, orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, contextDigest: context.contextDigest,
      role: context.role, kind: context.kind, mode: request.mode, attempt, startedAt, workerCreatedAtEpochMs: session.createdAtEpochMs, timeline: session.timeline(),
      workerEnvironment: session.environment(), preparationMs, searchReadyWorkerHeap, status, error, firstCandidateNotice, result,
      semanticDigest: result === null ? null : phase2c25bSemanticDigest(result),
      progress: { count: snapshots.length, snapshots }, visibility: { atStart: visibilityAtStart, atEnd: visibilityState(), changes: visibilityChanges },
      workerLifetimeMs, lateMessages: session.lateMessages(),
    }
    records.push(record)
    active = null
    relay({ event: 'run_settled', runKey, status, recordId: id })
    changed()
    return record
  }

  function runContext(request: Phase2C25BRunRequest): Promise<Phase2C25BRunRecord> {
    return guard('run', () => runOne(request))
  }

  /** Starts a run without waiting (the external driver polls `activeRun()` / `record()`); returns its run key. */
  function startRun(request: Phase2C25BRunRequest): string {
    const attempt = request.attempt ?? 1
    const key = phase2c25bRunKey(request.orientationId, request.workIndex, request.mode, attempt)
    void runContext(request).catch(error => relay({ event: 'run_refused', runKey: key, message: error instanceof Error ? error.message : String(error) }))
    return key
  }

  /** Every selected context, minimal then instrumented, fresh Worker each; a context is repeated at most once. */
  function runFormalSeries(): Promise<Phase2C25BRunRecord[]> {
    return guard('series', async () => {
      stopRequested = false
      const out: Phase2C25BRunRecord[] = []
      for (const context of selectedContexts()) {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          if (stopRequested) return out
          const minimal = await runOne({ orientationId: context.orientationId, workIndex: context.workIndex, mode: 'minimal', attempt })
          if (stopRequested) return [...out, minimal]
          const instrumented = await runOne({ orientationId: context.orientationId, workIndex: context.workIndex, mode: 'instrumented', attempt })
          out.push(minimal, instrumented)
          if (!phase2c25bRepeatDecision({ attempt, minimal, instrumented, cdpAttachFailure: false }).repeat) break
        }
      }
      return out
    })
  }

  return {
    loadExport, loadEvidence, prepare, selectedContexts, runContext, startRun, runFormalSeries,
    repeatDecision: phase2c25bRepeatDecision,
    /** Aborts the running Search (the Worker is terminated at once) and stops a series before its next run. */
    abortActive: (reason: string) => { stopRequested = true; if (!active) return false; active.session.abort(reason); return true },
    activeRun: () => active === null ? null : { runKey: active.runKey, startedAtEpochMs: active.startedAtEpochMs, phase: active.phase },
    busy: () => busy,
    record: (runKey: string) => records.find(r => r.runKey === runKey) ?? null,
    records: () => [...records],
    exportInfo: () => exportInfo,
    evidenceInfo: () => evidenceInfo,
    preparation: () => preparation,
    evidenceView: () => evidence,
    clear: () => { if (busy !== null) throw new Error('Cannot clear while running.'); records.length = 0; sequence = 0; changed() },
    exportJson: (environment: Record<string, unknown>) => JSON.stringify({ protocolVersion, exportedAt: clock(), environment,
      exportInfo, evidenceInfo, preparation, workload: evidence ? selectedContexts() : null, records }, null, 2),
  }
}
export type Phase2C25BRunner = ReturnType<typeof createPhase2C25BRunner>
