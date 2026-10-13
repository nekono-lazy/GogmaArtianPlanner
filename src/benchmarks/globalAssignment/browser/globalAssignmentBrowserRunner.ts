/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The main-thread runner of Global Assignment Browser logical runs (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 7.4 / 7.10 /
 * 9 / 10 / 12.1). One logical run is:
 *
 *   first Worker (new harness) -> settled -> terminated -> [only a `completed` first with an intact record and an Entry set]
 *   fresh Worker (new harness, the first Worker's Entry set) -> settled -> terminated -> `judgeBrowserLogicalRun()`
 *
 * Concurrency 1, no Worker reuse, no retry, nothing carried from one logical run to the next (every logical run materializes again).
 * The main thread runs no calculation: it observes the Export identity, re-hashes the adopted semantic records, re-checks the Entry set
 * with `d1aEntrySetIssues()` before a fresh Worker gets it (C10), compares the Workers' build provenance with its own, and records the
 * lifecycle (visibility, freeze, page leave), pings, memory points and timings as observed values. Every logical run carries a run slot
 * (ID, purpose, planned) so that P-2 can bind runs to a committed measurement plan; P-1 runs are all unplanned. Nothing is persisted:
 * records live in memory until the user saves the raw JSON (which may hold Entry bodies and Target IDs: `.local/` only).
 *
 * PR #257 Required fixes: a cancel or a page leave is re-checked after every await before a request is posted (none is posted after
 * either; a Worker without a request is disposed at once and its record is `not_run`, with no settlement invented), `cancel()` says
 * whether a request accepted the cancel or only the logical run's stop was recorded, and a logical run restores the runner's state on
 * every exit path (a malformed Worker result, a failed re-hash or integrity check and a runner defect are integrity issues of the run).
 */
import type { ExportIdentity } from '../assignmentProtocol'
import { d1aEntrySetIssues, type D1aEntrySet } from '../verificationProtocol'
import {
  createGlobalAssignmentBrowserHarness, gabEnvironmentIssues,
  type GabHarnessAudit, type GabRequestSettlement, type GlobalAssignmentBrowserHarness,
} from './globalAssignmentBrowserHarness'
import { gabIntegrityJudgement, judgeBrowserLogicalRun, type GabLogicalRunJudgement, type GabWorkerSettle } from './globalAssignmentBrowserJudgement'
import {
  buildCommitOf, GAB_UNBUILT_COMMIT, gabErrorMessage, gabErrorName, gabProgressKey, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION,
  type GabExecutionOptions, type GabExportPayload, type GabHeartbeat, type GabProgressEvent, type GabRole, type GabWorkerEnvironment,
} from './globalAssignmentBrowserProtocol'

/** Design 12.2: the purpose of a run slot (P-2 fixes slots in a committed plan; P-1 records every run as unplanned). */
export type GabRunPurpose = 'timing' | 'rerun' | 'responsiveness' | 'memory' | 'cancel' | 'pilot'
export const GAB_RUN_PURPOSES: readonly GabRunPurpose[] = Object.freeze(['timing', 'rerun', 'responsiveness', 'memory', 'cancel', 'pilot'])

export interface GabRunSlot {
  slotId: string
  purpose: GabRunPurpose
  /** True only for a slot of a committed measurement plan (P-2). P-1 never sets it. */
  planned: boolean
  note: string | null
}

/** A benchmark-only cancel: armed by the first progress event of `role` whose key is `onProgressKey`, fired `delayMs` later. */
export interface GabCancelTrigger {
  role: GabRole
  onProgressKey: string
  delayMs: number
}

export interface GabLogicalRunOptions {
  slot: GabRunSlot
  execution: GabExecutionOptions
  envelope: { firstWallMs: number; freshWallMs: number; cancelGraceMs: number; readyTimeoutMs: number }
  cancelTrigger?: GabCancelTrigger | null
  /** Chained ping while each request runs (Worker event-loop responsiveness, not UI frame rate). */
  ping?: { timeoutMs: number } | null
  /** Memory at fixed points (a separate run from timing runs; design 9.2 / 9.5). */
  memory?: { gcWaitMs: number } | null
  /** Listen this long after a request settled before disposing its harness (late responses are counted, never applied). */
  lateResponseWaitMs?: number
  /** `auto`: a Blob when the Browser can structured-clone one, its bytes otherwise (design 7.5). */
  exportTransport?: 'auto' | 'blob' | 'array_buffer'
}

/** The Export the user picked: the file itself and the main thread's identity observation (name / bytes / SHA-256 of the raw bytes). */
export interface GabExportSource {
  file: Blob
  identity: ExportIdentity
}

export interface GabMainEnvironment {
  isSecureContext: boolean | null
  crossOriginIsolated: boolean | null
  cryptoSubtle: boolean
  build: unknown
}

export type GabMemoryReading =
  | { status: 'ok'; bytes: number; dedicatedWorkerBytes: number; windowBytes: number; otherBytes: number; resolveMs: number }
  | { status: 'unavailable' | 'error'; reason: string }

export interface GabMemorySample {
  label: string
  atMs: number
  userAgentSpecific: GabMemoryReading
  mainRealm: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null
}

export interface GabMemorySampler {
  availability(): { measureUserAgentSpecificMemory: boolean; performanceMemory: boolean; crossOriginIsolated: boolean | null }
  sample(label: string, atMs: number): Promise<GabMemorySample>
}

export interface GabPingSummary {
  count: number
  lost: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
  samplesMs: number[]
}

export interface GabWorkerRunRecord {
  role: GabRole
  requestId: string
  /**
   * `not_run`: no request was posted (C10, the first Worker's outcome, or a cancel / page leave before the post). A request that never
   * entered the harness has no settlement and no audit entry: none is invented for it.
   */
  settle: GabWorkerSettle | 'not_run'
  notRunReason: string | null
  /** The request entered the harness lifecycle (posted, or refused by a failed post). False: the harness never saw it. */
  requestStarted: boolean
  /** Why a request was never posted although its Worker slot had started: a recorded cancel or a page leave (null otherwise). */
  stoppedBeforeRequest: 'cancel' | 'page_left' | null
  /** Why no request was posted (Worker creation or ready failure, an unreadable Export), or why the harness refused it. */
  harnessError: string | null
  createToReadyMs: number | null
  environment: GabWorkerEnvironment | null
  environmentIssues: string[]
  exportTransport: GabExportPayload['kind'] | null
  /** The harness settlement (its `result` is the adopted Worker result: `completed` only). */
  settlement: GabRequestSettlement | null
  /** The main thread's re-hash of the adopted semantic records (design 7.10). */
  rehash: { materialization: { worker: string; main: string; matched: boolean } | null; verification: { worker: string; main: string; matched: boolean } | null; entrySet: { worker: string; main: string; matched: boolean } | null }
  /** The re-hash itself failed (an integrity issue of the run; the adopted result is then never trusted). */
  rehashError: string | null
  /** A runner defect while this Worker ran (an integrity issue of the run), kept beside whatever was observed. */
  runnerError: string | null
  ping: GabPingSummary | null
  memory: GabMemorySample[] | null
  lateResponses: number
  audit: GabHarnessAudit | null
  progressMilestones: { atMs: number; key: string }[]
}

export interface GabLifecycleEvent {
  type: string
  atMs: number
  visibilityState: string | null
}

/** Where the logical run was when its cancel was recorded. */
export type GabCancelPhase =
  /** A Worker slot had started but no request was posted (before the Worker was created, while it started, while the Export was read). */
  | 'before_request'
  /** The running request accepted the cancel (C1: `running` -> `cancelling`). */
  | 'request_running'
  /** The Worker's request had already settled; its outcome stands as settled. */
  | 'after_request_settled'
  /** The first Worker was gone and no fresh Worker existed yet. */
  | 'between_workers'

/**
 * What `runner.cancel()` did. Only `request_cancel_accepted` means a request accepted a cancel; `logical_run_stop_recorded` means the
 * logical run records the stop (no request is posted and no Worker is started from then on) without any request accepting one.
 */
export type GabRunnerCancelResult =
  /** No logical run is running: nothing changed. */
  | { kind: 'idle' }
  /** The logical run was already stopping (an earlier cancel or a page leave): nothing changed. */
  | { kind: 'already_stopping'; reason: 'cancel' | 'page_left' }
  /** The running request accepted the cancel (C1); its result is never adopted. */
  | { kind: 'request_cancel_accepted'; role: GabRole; requestId: string }
  /** No request was running: the stop was recorded (a Worker without a request was disposed at once). */
  | { kind: 'logical_run_stop_recorded'; phase: Exclude<GabCancelPhase, 'request_running'>; role: GabRole | null }

export interface GabLogicalRunCancel {
  source: string
  /** Main ms from the logical run's start to the cancel. */
  requestedAtMs: number
  phase: GabCancelPhase
  /** The Worker slot the cancel reached (null between the Workers). */
  role: GabRole | null
  /** The request that accepted the cancel (`request_running` only). */
  acceptedByRequest: string | null
  triggered: GabCancelTrigger | null
}

export interface GabLogicalRunRecord {
  id: string
  sequence: number
  slot: GabRunSlot
  protocolVersion: typeof GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
  startedAt: string
  export: ExportIdentity
  main: GabMainEnvironment
  options: Omit<GabLogicalRunOptions, 'slot'>
  first: GabWorkerRunRecord
  fresh: GabWorkerRunRecord
  integrityIssues: string[]
  judgement: GabLogicalRunJudgement
  cancel: GabLogicalRunCancel | null
  lifecycle: { visibilityAtStart: string | null; events: GabLifecycleEvent[]; interrupted: boolean; pageLeft: boolean }
  /** Main ms: first Worker creation -> fresh Worker termination (or the end of the run). */
  logicalRunWallMs: number
  formal: false
  oracleFreeExecution: true
}

export interface GabRunnerState {
  records: readonly GabLogicalRunRecord[]
  running: boolean
  current: { logicalRunId: string; role: GabRole; requestId: string; lastProgress: GabProgressEvent | null; lastHeartbeat: GabHeartbeat | null; events: number; heartbeats: number; elapsedMs: number; settledTargets: number } | null
}

export interface GlobalAssignmentBrowserRunnerDependencies {
  readonly createHarness?: () => GlobalAssignmentBrowserHarness
  readonly now?: () => number
  readonly clock?: () => string
  /** SHA-256 of a text's UTF-8 bytes (the main thread's re-hash; Web Crypto in the Browser). */
  readonly sha256Text?: (text: string) => Promise<string>
  readonly mainEnvironment?: () => GabMainEnvironment
  readonly canCloneBlob?: () => boolean
  readonly visibilityState?: () => string | null
  /** Subscribes to visibilitychange / freeze / resume / pagehide / pageshow; returns the unsubscriber. */
  readonly subscribeLifecycle?: (listener: (type: string) => void) => () => void
  readonly memory?: GabMemorySampler
  readonly sleep?: (ms: number) => Promise<void>
  readonly setTimer?: (callback: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
  /** The main thread's Entry set check before a fresh Worker gets it (`d1aEntrySetIssues`; injected by tests only). */
  readonly entrySetIssues?: typeof d1aEntrySetIssues
  readonly onChange?: (state: GabRunnerState) => void
}

declare const __PLANNER_GLOBAL_BENCHMARK_BUILD__: unknown

/** The page bundle's own build provenance (null outside a benchmark build). */
export function mainBuildProvenance(): unknown {
  return typeof __PLANNER_GLOBAL_BENCHMARK_BUILD__ === 'undefined' ? null : __PLANNER_GLOBAL_BENCHMARK_BUILD__
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

export const gabWebCryptoSha256Text = async (text: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/** The main thread's identity of a picked Export: its name, byte length and SHA-256 over the raw bytes (no decoding, no parsing). */
export async function observeExportIdentity(file: Blob & { name?: string }): Promise<ExportIdentity> {
  const bytes = await file.arrayBuffer()
  return { fileName: typeof file.name === 'string' && file.name !== '' ? file.name : 'export.json', bytes: bytes.byteLength, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)) }
}

export function defaultMainEnvironment(): GabMainEnvironment {
  const scope = globalThis as typeof globalThis & { isSecureContext?: boolean; crossOriginIsolated?: boolean }
  return {
    isSecureContext: typeof scope.isSecureContext === 'boolean' ? scope.isSecureContext : null,
    crossOriginIsolated: typeof scope.crossOriginIsolated === 'boolean' ? scope.crossOriginIsolated : null,
    cryptoSubtle: typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function',
    build: mainBuildProvenance(),
  }
}

/** Whether this realm can structured-clone a Blob (design 7.5; the fallback transfers the bytes instead). */
export function defaultCanCloneBlob(): boolean {
  try {
    structuredClone(new Blob(['x']))
    return true
  } catch {
    return false
  }
}

interface UserAgentSpecificMemoryResult {
  bytes: number
  breakdown: { bytes: number; attribution: { scope?: string }[] }[]
}

/** Browser memory APIs as they are (a local copy of the Phase 2-A sampler); nothing is estimated when one is unavailable. */
export function createGabMemorySampler(now: () => number = () => performance.now()): GabMemorySampler {
  const perf = globalThis.performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemoryResult>;
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }
  const isolated = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null
  const uaAvailable = typeof perf.measureUserAgentSpecificMemory === 'function' && isolated === true
  return {
    availability: () => ({ measureUserAgentSpecificMemory: uaAvailable, performanceMemory: perf.memory !== undefined, crossOriginIsolated: isolated }),
    sample: async (label, atMs) => {
      let userAgentSpecific: GabMemoryReading
      if (!uaAvailable) userAgentSpecific = { status: 'unavailable', reason: isolated === true ? 'measureUserAgentSpecificMemory is not exposed' : 'not crossOriginIsolated' }
      else {
        const start = now()
        try {
          const result = await perf.measureUserAgentSpecificMemory!()
          let worker = 0, window = 0, other = 0
          for (const entry of result.breakdown) {
            const scopes = entry.attribution.map(attribution => attribution.scope)
            if (scopes.includes('DedicatedWorkerGlobalScope')) worker += entry.bytes
            else if (scopes.includes('Window')) window += entry.bytes
            else other += entry.bytes
          }
          userAgentSpecific = { status: 'ok', bytes: result.bytes, dedicatedWorkerBytes: worker, windowBytes: window, otherBytes: other, resolveMs: now() - start }
        } catch (error) {
          userAgentSpecific = { status: 'error', reason: error instanceof Error ? error.message : String(error) }
        }
      }
      const memory = perf.memory
      return { label, atMs, userAgentSpecific, mainRealm: memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null }
    },
  }
}

export function gabMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Nearest-rank percentile of the observed samples (nothing interpolated). */
export function gabPercentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

export function summarizeGabPings(samples: readonly (number | null)[]): GabPingSummary {
  const ok = samples.filter((value): value is number => value !== null)
  return { count: samples.length, lost: samples.length - ok.length, medianMs: gabMedian(ok), p95Ms: gabPercentile(ok, 95), maxMs: ok.length ? Math.max(...ok) : null, samplesMs: ok }
}

/** Validates the run options before any Worker is created (`[]` = valid). */
export function gabLogicalRunOptionIssues(options: GabLogicalRunOptions): string[] {
  const issues: string[] = []
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(options.slot.slotId)) issues.push('slot.slotId must be 1..64 characters of [A-Za-z0-9._:-].')
  if (!GAB_RUN_PURPOSES.includes(options.slot.purpose)) issues.push(`slot.purpose must be one of ${GAB_RUN_PURPOSES.join(', ')}.`)
  for (const key of ['firstWallMs', 'freshWallMs', 'cancelGraceMs', 'readyTimeoutMs'] as const) {
    const value = options.envelope[key]
    if (!Number.isSafeInteger(value) || value < 1 || value > 86_400_000) issues.push(`envelope.${key} must be an integer in 1..86400000.`)
  }
  if (options.cancelTrigger && (!Number.isSafeInteger(options.cancelTrigger.delayMs) || options.cancelTrigger.delayMs < 0)) issues.push('cancelTrigger.delayMs must be a non-negative integer.')
  if (options.ping && (!Number.isSafeInteger(options.ping.timeoutMs) || options.ping.timeoutMs < 1)) issues.push('ping.timeoutMs must be a positive integer.')
  if (options.memory && (!Number.isSafeInteger(options.memory.gcWaitMs) || options.memory.gcWaitMs < 0)) issues.push('memory.gcWaitMs must be a non-negative integer.')
  if (options.lateResponseWaitMs !== undefined && (!Number.isSafeInteger(options.lateResponseWaitMs) || options.lateResponseWaitMs < 0)) issues.push('lateResponseWaitMs must be a non-negative integer.')
  return issues
}

function emptyWorkerRecord(role: GabRole, requestId: string): GabWorkerRunRecord {
  return {
    role, requestId, settle: 'not_run', notRunReason: null, requestStarted: false, stoppedBeforeRequest: null, harnessError: null, createToReadyMs: null, environment: null,
    environmentIssues: [], exportTransport: null, settlement: null, rehash: { materialization: null, verification: null, entrySet: null }, rehashError: null, runnerError: null,
    ping: null, memory: null, lateResponses: 0, audit: null, progressMilestones: [],
  }
}

/** The Worker slot of the running logical run (one at a time): what a cancel or a page leave can still reach. */
interface ActiveWorkerSlot {
  role: GabRole
  requestId: string
  /** Null until the Worker is created. */
  harness: GlobalAssignmentBrowserHarness | null
  /** Set synchronously right before `harness.run()`: from then on a cancel goes to the request, never around it. */
  posted: boolean
  settled: boolean
  disposed: boolean
}

interface LogicalRunState {
  id: string
  startedAt: number
  cancel: GabLogicalRunCancel | null
  pageLeft: boolean
}

export function createGlobalAssignmentBrowserRunner(dependencies: GlobalAssignmentBrowserRunnerDependencies = {}) {
  const now = dependencies.now ?? (() => performance.now())
  const clock = dependencies.clock ?? (() => new Date().toISOString())
  const createHarness = dependencies.createHarness ?? (() => createGlobalAssignmentBrowserHarness({ now }))
  const sha256Text = dependencies.sha256Text ?? gabWebCryptoSha256Text
  const mainEnvironment = dependencies.mainEnvironment ?? defaultMainEnvironment
  const canCloneBlob = dependencies.canCloneBlob ?? defaultCanCloneBlob
  const visibilityState = dependencies.visibilityState ?? (() => (typeof document === 'undefined' ? null : document.visibilityState))
  const subscribeLifecycle = dependencies.subscribeLifecycle ?? (listener => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined
    const onDocument = (event: Event) => listener(event.type)
    const onWindow = (event: Event) => listener(event.type)
    for (const type of ['visibilitychange', 'freeze', 'resume']) document.addEventListener(type, onDocument)
    for (const type of ['pagehide', 'pageshow']) window.addEventListener(type, onWindow)
    return () => {
      for (const type of ['visibilitychange', 'freeze', 'resume']) document.removeEventListener(type, onDocument)
      for (const type of ['pagehide', 'pageshow']) window.removeEventListener(type, onWindow)
    }
  })
  const memory = dependencies.memory ?? createGabMemorySampler(now)
  const sleep = dependencies.sleep ?? (ms => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms)))
  const setTimer = dependencies.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms))
  const clearTimer = dependencies.clearTimer ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  const entrySetIssues = dependencies.entrySetIssues ?? d1aEntrySetIssues

  const records: GabLogicalRunRecord[] = []
  let sequence = 0
  let logical: LogicalRunState | null = null
  let active: ActiveWorkerSlot | null = null
  let current: GabRunnerState['current'] = null

  // An observer (the page) that throws never stops the runner or its cleanup: the state it missed is sent again on the next change.
  const notify = () => {
    try {
      dependencies.onChange?.({ records: [...records], running: logical !== null, current: current === null ? null : { ...current } })
    } catch {
      // Intentionally ignored (see above).
    }
  }

  /**
   * One Worker of a logical run: create, wait ready, check the environment, post, settle, observe late responses, dispose. A recorded
   * cancel or a page leave is re-checked after every await before the post, and nothing awaits between the last check and
   * `harness.run()`, so no request is ever posted after either (a Worker that has no request yet is disposed by them at once). Every
   * path disposes the Worker and leaves the slot (`active`) and `current` empty; a runner defect is recorded (`runnerError`), never
   * thrown past the logical run or turned into a measurement.
   */
  async function runWorker(role: GabRole, source: GabExportSource, entrySet: D1aEntrySet | null, options: GabLogicalRunOptions, logicalRunId: string, runStart: number): Promise<GabWorkerRunRecord> {
    const requestId = `gab.${logicalRunId}.${role}`
    const record = emptyWorkerRecord(role, requestId)
    const samples: GabMemorySample[] | null = options.memory ? [] : null
    record.memory = samples
    // A memory reading that fails is recorded as one (status `error`), never thrown.
    const sample = async (label: string) => {
      if (samples === null) return
      try {
        samples.push(await memory.sample(`${role}:${label}`, now() - runStart))
      } catch (error) {
        samples.push({ label: `${role}:${label}`, atMs: now() - runStart, userAgentSpecific: { status: 'error', reason: gabErrorMessage(error) }, mainRealm: null })
      }
    }
    const slot: ActiveWorkerSlot = { role, requestId, harness: null, posted: false, settled: false, disposed: false }
    active = slot
    /** True (and the record says why) when the logical run was cancelled or the page left: no request is posted from here on. */
    const stoppedBeforeRequest = (where: string): boolean => {
      const stop = logical === null || logical.cancel !== null ? 'cancel' : logical.pageLeft ? 'page_left' : null
      if (stop === null) return false
      record.settle = 'not_run'
      record.stoppedBeforeRequest = stop
      record.notRunReason = `${stop === 'page_left' ? 'the page was left' : 'the logical run was cancelled'} ${where}; no request was posted`
      return true
    }
    let harness: GlobalAssignmentBrowserHarness | null = null
    try {
      await sample('before_worker_create')
      if (stoppedBeforeRequest('before the Worker was created')) return record
      let created: GlobalAssignmentBrowserHarness
      try {
        created = createHarness()
      } catch (error) {
        record.settle = 'worker_error'
        record.harnessError = `The Worker could not be created: ${gabErrorMessage(error)}`
        return record
      }
      harness = created
      slot.harness = created
      current = { logicalRunId, role, requestId, lastProgress: null, lastHeartbeat: null, events: 0, heartbeats: 0, elapsedMs: 0, settledTargets: 0 }
      notify()
      let ready: Awaited<ReturnType<GlobalAssignmentBrowserHarness['whenReady']>>
      try {
        ready = await created.whenReady(options.envelope.readyTimeoutMs)
      } catch (error) {
        // A cancel or a page leave disposes a Worker that has no request: its ready wait ends there, and that is no Worker failure.
        if (stoppedBeforeRequest('while the Worker was starting')) return record
        record.settle = 'worker_error'
        record.harnessError = `The Worker never became ready: ${gabErrorMessage(error)}`
        return record
      }
      record.createToReadyMs = ready.createToReadyMs
      record.environment = ready.environment
      await sample('worker_ready')
      if (stoppedBeforeRequest('after the Worker became ready')) return record
      record.environmentIssues = gabEnvironmentIssues(ready.environment, options.execution, mainEnvironment())
      if (record.environmentIssues.length > 0) { record.settle = 'environment_unsupported'; return record }
      const transport = options.exportTransport === 'blob' || options.exportTransport === 'array_buffer' ? options.exportTransport : canCloneBlob() ? 'blob' : 'array_buffer'
      record.exportTransport = transport
      let exportPayload: GabExportPayload
      if (transport === 'blob') exportPayload = { kind: 'blob', blob: source.file }
      else {
        let bytes: ArrayBuffer
        try {
          bytes = await source.file.arrayBuffer()
        } catch (error) {
          if (stoppedBeforeRequest('while the Export was read')) return record
          record.settle = 'worker_error'
          record.harnessError = `The main thread could not read the Export: ${gabErrorMessage(error)}`
          return record
        }
        exportPayload = { kind: 'array_buffer', bytes }
      }
      // The last check before the post. Nothing between it and `harness.run()` awaits: no cancel or page leave can slip in between.
      if (stoppedBeforeRequest(transport === 'blob' ? 'before the request was posted' : 'while the Export was read')) return record
      let settled = false
      let armedTimer: unknown = null
      const pings: (number | null)[] = []
      let pingChain: Promise<void> | null = null
      slot.posted = true
      const pending = created.run({
        requestId, role, exportPayload, exportIdentity: { ...source.identity }, entrySet, execution: { ...options.execution },
        workerWallMs: role === 'first' ? options.envelope.firstWallMs : options.envelope.freshWallMs, cancelGraceMs: options.envelope.cancelGraceMs,
      }, {
        onAccepted: () => {
          if (options.ping) {
            const timeoutMs = options.ping.timeoutMs
            // Chained: a pong sends the next ping. No ping is sent once the request settled (its Worker is terminated).
            pingChain = (async () => { while (!settled && created.state(requestId) !== 'settled') pings.push(await created.ping(timeoutMs)) })()
          }
        },
        onProgress: (event, atMs) => {
          const key = gabProgressKey(event)
          record.progressMilestones.push({ atMs, key })
          if (current !== null && current.requestId === requestId) { current.lastProgress = event; current.events += 1; current.elapsedMs = atMs; if (event.kind === 'materialization' && event.event.kind === 'target_settled') current.settledTargets += 1 }
          const trigger = options.cancelTrigger
          if (trigger && trigger.role === role && armedTimer === null && key === trigger.onProgressKey && logical !== null && logical.cancel === null) {
            armedTimer = setTimer(() => { runner.cancel('trigger', trigger) }, trigger.delayMs)
          }
          notify()
        },
        onHeartbeat: (heartbeat, atMs) => {
          if (current !== null && current.requestId === requestId) { current.lastHeartbeat = heartbeat; current.heartbeats += 1; current.elapsedMs = atMs }
          notify()
        },
      })
      // `run()` registers the request synchronously when it accepts it; a refused request never entered the lifecycle.
      record.requestStarted = created.state(requestId) !== null
      const settlement = await pending.catch((error: unknown) => {
        record.harnessError = `The harness refused the request: ${gabErrorMessage(error)}`
        return null
      })
      settled = true
      slot.settled = true
      if (armedTimer !== null) clearTimer(armedTimer)
      await pingChain
      record.ping = options.ping ? summarizeGabPings(pings) : null
      record.settlement = settlement
      record.settle = settlement === null ? 'worker_error' : settlement.outcome
      await sample('settled')
      if (options.lateResponseWaitMs) await sleep(options.lateResponseWaitMs)
      // Re-hash what the main thread adopted (design 7.10): a recorded SHA-256 that is not the hash of its record is an integrity issue,
      // and so is a record the main thread cannot hash at all.
      const result = settlement?.result ?? null
      if (result !== null) {
        try {
          if (result.materialization !== null) {
            const main = await sha256Text(JSON.stringify(result.materialization.semantic))
            record.rehash.materialization = { worker: result.materialization.semanticSha256, main, matched: main === result.materialization.semanticSha256 }
          }
          if (result.verification !== null) {
            const main = await sha256Text(JSON.stringify(result.verification.semantic))
            record.rehash.verification = { worker: result.verification.semanticSha256, main, matched: main === result.verification.semanticSha256 }
          }
          if (result.entrySet !== null) {
            const main = await sha256Text(JSON.stringify(result.entrySet.value))
            record.rehash.entrySet = { worker: result.entrySet.sha256, main, matched: main === result.entrySet.sha256 }
          }
        } catch (error) {
          record.rehashError = `${gabErrorName(error)}: ${gabErrorMessage(error)}`
        }
      }
      return record
    } catch (error) {
      // A runner defect: recorded beside what was observed (an integrity issue of the run), never a measurement and never re-thrown.
      record.runnerError = `${gabErrorName(error)}: ${gabErrorMessage(error)}`
      if (record.settle === 'not_run' && record.stoppedBeforeRequest === null) record.settle = 'worker_error'
      return record
    } finally {
      try {
        if (harness !== null) {
          record.lateResponses = harness.lateResponses()
          record.audit = harness.audit()
          harness.dispose()
        }
      } catch (error) {
        record.runnerError ??= `${gabErrorName(error)}: ${gabErrorMessage(error)}`
        try {
          harness?.dispose()
        } catch {
          // Recorded above (runnerError): the run is invalid_run_integrity whatever its Worker did.
        }
      }
      slot.disposed = true
      current = null
      notify()
      try {
        if (harness !== null) {
          await sample('after_dispose')
          if (options.memory && options.memory.gcWaitMs > 0) { await sleep(options.memory.gcWaitMs); await sample('after_gc_wait_reference') }
        }
      } catch (error) {
        record.runnerError ??= `${gabErrorName(error)}: ${gabErrorMessage(error)}`
      } finally {
        if (active === slot) active = null
      }
    }
  }

  /** The integrity issues of one Worker's record (design 12.1): never the Planner's or the materialization's own outcomes. */
  function workerIntegrityIssues(record: GabWorkerRunRecord, source: GabExportSource, main: GabMainEnvironment): string[] {
    const role = record.role
    const issues: string[] = []
    if (record.runnerError !== null) issues.push(`${role}: the runner failed while this Worker ran: ${record.runnerError}`)
    const settlement = record.settlement
    // A Worker that refused the Export or the Entry set reports an integrity issue of the run, not a calculation outcome.
    if (settlement?.outcome === 'worker_reported_error' && settlement.error !== null && (settlement.error.code === 'export_changed' || settlement.error.code === 'entry_set_refused')) {
      issues.push(`${role}: the Worker refused the run (${settlement.error.code}): ${settlement.error.message}`)
    }
    // A malformed or unrequested response: nothing that Worker sent is trusted (its payload was never adopted).
    if (settlement?.settledBy === 'protocol_violation' && settlement.error !== null) {
      issues.push(`${role}: the Worker sent a malformed or unrequested response (${settlement.error.errorName}): ${settlement.error.message}`)
    }
    if (record.environment !== null && main.build !== null && JSON.stringify(record.environment.build) !== JSON.stringify(main.build)) {
      issues.push(`${role}: the Worker's build provenance is not the page's.`)
    }
    const result = settlement?.result ?? null
    if (result === null) return issues
    if (result.role !== role || result.requestId !== record.requestId) issues.push(`${role}: the adopted result is for ${result.role} / ${result.requestId}.`)
    if (result.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`${role}: the adopted result speaks ${String(result.protocolVersion)}.`)
    const observed = result.exportObservation
    if (observed.fileName !== source.identity.fileName || observed.bytes !== source.identity.bytes || observed.sha256 !== source.identity.sha256 || observed.matchesRequest !== true) {
      issues.push(`${role}: export_changed: the Worker read ${observed.fileName} / ${observed.bytes} bytes / ${observed.sha256}, not the picked Export.`)
    }
    if (record.rehashError !== null) issues.push(`${role}: the main thread could not re-hash the adopted result: ${record.rehashError}`)
    for (const [name, hash] of Object.entries(record.rehash)) {
      if (hash !== null && !hash.matched) issues.push(`${role}: the recorded ${name} SHA-256 ${hash.worker} is not the hash of its record (${hash.main}).`)
    }
    if (role === 'first' && result.materialization === null) issues.push('first: the adopted result has no materialization record.')
    if (role === 'fresh' && result.verification === null) issues.push('fresh: the adopted result has no verification record.')
    for (const issue of result.integrityIssues) issues.push(`${role}: ${issue}`)
    return issues
  }

  /** An integrity check that throws is itself an integrity issue of the run (never skipped, never a measurement). */
  function checkedIssues(role: GabRole, what: string, check: () => string[]): string[] {
    try {
      return check()
    } catch (error) {
      return [`${role}: the ${what} failed: ${gabErrorName(error)}: ${gabErrorMessage(error)}`]
    }
  }

  const runner = {
    /**
     * One logical run (first Worker, then a fresh Worker when C10 allows). Refused while another one runs (concurrency 1). Whatever
     * happens inside, the run leaves nothing behind: no Worker, no pending request, no current request, no lifecycle listener, and
     * `running()` is false again; a failure that escapes the Workers rejects the call after that cleanup (it is never a record).
     */
    async runLogicalRun(source: GabExportSource, options: GabLogicalRunOptions): Promise<GabLogicalRunRecord> {
      if (logical !== null) throw new Error('A Global Assignment Browser logical run is already running (concurrency 1).')
      const issues = gabLogicalRunOptionIssues(options)
      if (issues.length > 0) throw new RangeError(`Invalid logical run options: ${issues.join(' / ')}`)
      sequence += 1
      const id = `run-${sequence}`
      const startedAt = clock()
      const runStart = now()
      const run: LogicalRunState = { id, startedAt: runStart, cancel: null, pageLeft: false }
      logical = run
      let unsubscribe: (() => void) | null = null
      try {
        const lifecycleEvents: GabLifecycleEvent[] = []
        const visibilityAtStart = visibilityState()
        unsubscribe = subscribeLifecycle(type => {
          lifecycleEvents.push({ type, atMs: now() - runStart, visibilityState: visibilityState() })
          if (type === 'pagehide') runner.pagehide()
        })
        const main = mainEnvironment()
        notify()
        let fresh = emptyWorkerRecord('fresh', `gab.${id}.fresh`)
        const integrityIssues: string[] = []
        // runWorker() records its own failures; this is the last resort of a runner defect (an integrity issue, never a measurement).
        const guarded = async (role: GabRole, entrySet: D1aEntrySet | null): Promise<GabWorkerRunRecord> => {
          try {
            return await runWorker(role, source, entrySet, options, id, runStart)
          } catch (error) {
            const failed = emptyWorkerRecord(role, `gab.${id}.${role}`)
            failed.settle = 'worker_error'
            failed.runnerError = `${gabErrorName(error)}: ${gabErrorMessage(error)}`
            return failed
          }
        }
        const first = await guarded('first', null)
        const firstResult = first.settlement?.result ?? null
        const firstIssues = checkedIssues('first', 'integrity check', () => workerIntegrityIssues(first, source, main))
        // The main thread re-checks the Entry set before any fresh Worker gets it (design 7.10).
        if (firstResult !== null && firstResult.entrySet !== null && first.environment !== null) {
          const environment = first.environment
          const entrySetValue = firstResult.entrySet.value
          firstIssues.push(...checkedIssues('first', 'Entry set check', () => entrySetIssues(entrySetValue, {
            repositoryHeadSha: environment.buildCommit ?? GAB_UNBUILT_COMMIT, export: { ...source.identity },
            calculationContext: firstResult.calculationContext, rngEngineVersion: firstResult.rngEngineVersion, entryFingerprint: firstResult.entrySet!.entryFingerprint,
          }).map(issue => `first entry set: ${issue}`)))
        }
        integrityIssues.push(...firstIssues)
        // C10: only a completed first Worker with an intact record and an Entry set (an all_materialized candidate) starts a fresh Worker.
        const freshReason = run.pageLeft ? 'the page was left'
          : run.cancel !== null ? 'the logical run was cancelled'
            : first.settle !== 'completed' ? `the first Worker settled as ${first.settle}`
              : firstIssues.length > 0 ? 'the first Worker\'s record has integrity issues'
                : firstResult?.entrySet == null ? 'the first Worker returned no Entry set (no all_materialized handoff)' : null
        if (freshReason === null) {
          fresh = await guarded('fresh', firstResult!.entrySet!.value)
          const freshIssues = checkedIssues('fresh', 'integrity check', () => workerIntegrityIssues(fresh, source, main))
          if (first.environment !== null && fresh.environment !== null && JSON.stringify(first.environment.build) !== JSON.stringify(fresh.environment.build)) {
            freshIssues.push('fresh: the fresh Worker\'s build provenance is not the first Worker\'s.')
          }
          integrityIssues.push(...freshIssues)
        } else {
          fresh.notRunReason = freshReason
        }
        const freshResult = fresh.settlement?.result ?? null
        let judgement: GabLogicalRunJudgement
        try {
          judgement = judgeBrowserLogicalRun(
            {
              settle: first.settle, stoppedBeforeRequest: first.stoppedBeforeRequest,
              materializationOutcome: firstResult?.materialization?.semantic.outcome ?? null,
              verification: firstResult?.verification ? { semantic: firstResult.verification.semantic, semanticSha256: firstResult.verification.semanticSha256 } : null,
            },
            {
              settle: fresh.settle,
              phase0PlanningTargetIds: freshResult?.phase0.planningTargetIdsSorted ?? null,
              verification: freshResult?.verification ? { semantic: freshResult.verification.semantic, semanticSha256: freshResult.verification.semanticSha256 } : null,
            },
            integrityIssues,
            { cancelled: run.cancel !== null },
          )
        } catch (error) {
          // Records the judgement cannot read are no measurement: the run's integrity is what failed.
          integrityIssues.push(`the judgement failed: ${gabErrorName(error)}: ${gabErrorMessage(error)}`)
          judgement = gabIntegrityJudgement(integrityIssues)
        }
        const { slot, ...rest } = options
        const record: GabLogicalRunRecord = {
          id, sequence, slot: { ...slot }, protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, startedAt, export: { ...source.identity }, main,
          options: structuredClone(rest), first, fresh, integrityIssues, judgement, cancel: run.cancel === null ? null : { ...run.cancel },
          lifecycle: {
            visibilityAtStart, events: lifecycleEvents, pageLeft: run.pageLeft,
            interrupted: visibilityAtStart === 'hidden' || lifecycleEvents.some(event => event.type === 'freeze' || event.type === 'pagehide' || (event.type === 'visibilitychange' && event.visibilityState === 'hidden')),
          },
          logicalRunWallMs: now() - runStart, formal: false, oracleFreeExecution: true,
        }
        records.push(record)
        return record
      } finally {
        try {
          unsubscribe?.()
        } finally {
          // Nothing of this logical run outlives it, a runner defect included: no Worker, no pending request, no current request.
          const leftover = active
          active = null
          current = null
          logical = null
          try {
            leftover?.harness?.dispose()
          } finally {
            notify()
          }
        }
      }
    },

    /**
     * Cancels the running logical run now. A running request goes `running` -> `cancelling` synchronously (C1); a Worker that has no
     * request yet is disposed at once and none is posted; no fresh Worker starts afterwards. The result says which of these happened
     * (only `request_cancel_accepted` is a request's cancel).
     */
    cancel(source = 'api', trigger: GabCancelTrigger | null = null): GabRunnerCancelResult {
      if (logical === null) return { kind: 'idle' }
      if (logical.cancel !== null) return { kind: 'already_stopping', reason: 'cancel' }
      if (logical.pageLeft) return { kind: 'already_stopping', reason: 'page_left' }
      const run = logical
      const requestedAtMs = now() - run.startedAt
      const recordCancel = (phase: GabCancelPhase, role: GabRole | null, acceptedByRequest: string | null) => {
        run.cancel = { source, requestedAtMs, phase, role, acceptedByRequest, triggered: trigger }
      }
      const slot = active
      let result: GabRunnerCancelResult
      if (slot === null || (slot.role === 'first' && slot.disposed) || (slot.role === 'fresh' && slot.harness === null && !slot.disposed)) {
        // The first Worker is gone and the fresh one does not exist yet: the fresh slot's next check sees the cancel (no Worker is created).
        recordCancel('between_workers', null, null)
        result = { kind: 'logical_run_stop_recorded', phase: 'between_workers', role: null }
      } else if (!slot.posted) {
        // Recorded first, so the slot's next check sees it: its ready wait or Export read ends without a post. Its Worker goes now.
        recordCancel('before_request', slot.role, null)
        slot.harness?.dispose()
        result = { kind: 'logical_run_stop_recorded', phase: 'before_request', role: slot.role }
      } else if (!slot.settled && slot.harness !== null && slot.harness.cancel(slot.requestId, source)) {
        recordCancel('request_running', slot.role, slot.requestId)
        result = { kind: 'request_cancel_accepted', role: slot.role, requestId: slot.requestId }
      } else {
        recordCancel('after_request_settled', slot.role, null)
        result = { kind: 'logical_run_stop_recorded', phase: 'after_request_settled', role: slot.role }
      }
      notify()
      return result
    },

    /** `pagehide`: a running request settles as `page_left`, a Worker without a request is disposed, and nothing else starts. */
    pagehide(): void {
      if (logical === null) return
      logical.pageLeft = true
      active?.harness?.dispose('page_left')
      notify()
    },

    /** One ping to the active Worker (null when idle, lost or broken). */
    async ping(timeoutMs = 10_000): Promise<number | null> {
      const harness = active?.harness ?? null
      return harness === null ? null : harness.ping(timeoutMs)
    },

    /** Creates a Worker, waits for ready, checks the environment and pings once, then disposes it (no request is posted). */
    async probe(execution: GabExecutionOptions, readyTimeoutMs = 120_000): Promise<{ createToReadyMs: number | null; environment: GabWorkerEnvironment | null; environmentIssues: string[]; pingMs: number | null; error: string | null }> {
      if (logical !== null) throw new Error('Cannot probe while a logical run is running.')
      const harness = createHarness()
      try {
        const ready = await harness.whenReady(readyTimeoutMs)
        const pingMs = await harness.ping(10_000)
        return { createToReadyMs: ready.createToReadyMs, environment: ready.environment, environmentIssues: gabEnvironmentIssues(ready.environment, execution, mainEnvironment()), pingMs, error: null }
      } catch (error) {
        return { createToReadyMs: null, environment: null, environmentIssues: [], pingMs: null, error: error instanceof Error ? error.message : String(error) }
      } finally {
        harness.dispose()
      }
    },

    running: () => logical !== null,
    records: (): GabLogicalRunRecord[] => [...records],
    current: () => (current === null ? null : { ...current }),
    clear(): void {
      if (logical !== null) throw new Error('Cannot clear while a logical run is running.')
      records.length = 0
    },
    memoryAvailability: () => memory.availability(),
    /** The raw records (may hold Entry bodies, Target IDs and Plan data): for a git-ignored `.local/` file only, never committed. */
    exportJson(environment: Record<string, unknown>): string {
      return JSON.stringify({
        kind: 'global-assignment-browser-raw', protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, formal: false, oracleFreeExecution: true,
        handling: 'raw Research record: may contain Entry bodies, Target IDs and Plan data; keep it in a git-ignored .local/ directory, never commit it',
        exportedAt: clock(), environment, records,
      }, null, 2)
    },
  }
  return runner
}

export type GlobalAssignmentBrowserRunner = ReturnType<typeof createGlobalAssignmentBrowserRunner>

/** The main thread's build commit, for display (null outside a benchmark build). */
export function mainBuildCommit(): string | null {
  return buildCommitOf(mainBuildProvenance())
}
