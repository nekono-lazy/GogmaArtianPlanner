/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The Global Assignment Browser benchmark Worker controller (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 7.2 / 7.3 / 7.7 /
 * 7.8): one Worker accepts exactly one run (fresh Worker policy), validates the request before any calculation, reads the registered
 * conditions itself, runs the environment-neutral stage (`globalAssignmentBrowserStages.ts`) with its own Engine, yield, cancel flag,
 * heartbeat and slice monitor, and sends exactly one terminal message per request (`gab_result`, `gab_cancelled` or `gab_error`).
 *
 * Cancellation here is cooperative and best effort only: `gab_cancel` sets a flag (acknowledged at once) that the existing cancel points
 * and the stage boundaries read, and the flag is checked once more before `gab_result` is posted. A Worker inside a synchronous
 * section cannot even see `gab_cancel`, so the main-thread request lifecycle - never this flag - is what guarantees that a cancelled
 * request's result is not adopted (`globalAssignmentBrowserHarness.ts`).
 *
 * Nothing here touches a Production Worker, its protocol or its Client; nothing is persisted; no expected value is received.
 */
import type { PlannerInput } from '../../../domain/planner/plannerTypes'
import type { RngEngine } from '../../../domain/rng/rngEngine'
import { webCryptoSha256 } from '../../plannerGlobalBrowserEvidence'
import { findNonPlainJsonPaths } from '../assignmentProtocol'
import {
  buildCommitOf, GAB_UNBUILT_COMMIT, gabErrorMessage, gabErrorName, gabRequestIssues, gabResolvedLocale, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, isGabRequestType,
  type GabCancelledObservation, type GabProgressEvent, type GabResponse, type GabRunRequest, type GabSliceStat, type GabWorkerEnvironment, type GabWorkerError,
  type GabWorkerHeapSample, type GabWorkerResult, type GabYieldGap, type GabYieldMode,
} from './globalAssignmentBrowserProtocol'
import {
  GlobalAssignmentBrowserStageCancelled, GlobalAssignmentBrowserStageError, runFirstStage, runFreshStage,
  type GlobalAssignmentStageConditions, type GlobalAssignmentStagePorts,
} from './globalAssignmentBrowserStages'

declare const __PLANNER_GLOBAL_BENCHMARK_BUILD__: unknown

export type GabPostMessage = (response: GabResponse) => void

export interface GlobalAssignmentBrowserControllerOptions {
  /** A new Engine per call (the entry: `new ProductionRngEngine()`). */
  readonly createEngine: () => RngEngine
  /** The entry: `globalResearchInputFromExport(json, 1_000)`. */
  readonly buildInput: (json: unknown) => PlannerInput
  /** The conditions the Worker reads itself (the entry: `registeredD1cConditions()`); never a request field. Tests inject others. */
  readonly conditions: { readonly read: () => GlobalAssignmentStageConditions; readonly source: string }
  readonly now?: () => number
  readonly epochNow?: () => number
  readonly yieldFor?: (mode: GabYieldMode) => () => Promise<void>
  readonly sha256Text?: (text: string) => Promise<string>
  readonly sha256Bytes?: (bytes: ArrayBuffer) => Promise<string>
  /** Worker-realm `performance.memory` when exposed; null otherwise (never estimated). */
  readonly workerHeap?: () => GabWorkerHeapSample | null
  /** The benchmark build provenance (default: the `vite.benchmark.config.ts` define; null outside a benchmark build). */
  readonly build?: () => unknown
  /** Tests only: fields that replace the probed environment (a jsdom realm has no Worker secure context). The entry never passes it. */
  readonly environmentOverrides?: Partial<Pick<GabWorkerEnvironment, 'isSecureContext' | 'crossOriginIsolated'>>
}

export const gabDefaultEpochNow = () => performance.timeOrigin + performance.now()

/**
 * A MessagePort turn: a macrotask, so a pending `gab_cancel` / `gab_ping` is dispatched between two calculation slices (a microtask
 * would never let it through). A local copy on purpose (design 3.2): the Production `planner.worker.ts` / `search.worker.ts` and the
 * Phase 2-A Worker are not touched. Created on first use; resolvers are FIFO because MessagePort delivery is ordered.
 */
let yieldChannel: MessageChannel | null = null
const yieldResolvers: (() => void)[] = []

export function gabMessageChannelYield(): Promise<void> {
  if (yieldChannel === null) {
    if (typeof MessageChannel !== 'function') throw new Error('MessageChannel is unavailable; the message-channel yield cannot run.')
    yieldChannel = new MessageChannel()
    yieldChannel.port1.onmessage = () => yieldResolvers.shift()?.()
  }
  const channel = yieldChannel
  return new Promise(resolve => {
    yieldResolvers.push(resolve)
    channel.port2.postMessage(null)
  })
}

export function gabTimerYield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export const defaultGabYieldFor = (mode: GabYieldMode) => (mode === 'message-channel' ? gabMessageChannelYield : gabTimerYield)

export const gabSha256Bytes = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function readGabWorkerHeap(): GabWorkerHeapSample | null {
  const memory = (globalThis.performance as Performance & { memory?: GabWorkerHeapSample }).memory
  if (!memory || typeof memory.usedJSHeapSize !== 'number') return null
  return { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit }
}

function defaultBuild(): unknown {
  return typeof __PLANNER_GLOBAL_BENCHMARK_BUILD__ === 'undefined' ? null : __PLANNER_GLOBAL_BENCHMARK_BUILD__
}

export function probeGabEnvironment(rngEngineVersion: string, build: unknown, workerHeap: () => GabWorkerHeapSample | null): GabWorkerEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number })
  const locale = gabResolvedLocale()
  const scope = globalThis as typeof globalThis & { crossOriginIsolated?: boolean; isSecureContext?: boolean }
  return {
    protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION,
    crossOriginIsolated: typeof scope.crossOriginIsolated === 'boolean' ? scope.crossOriginIsolated : null,
    isSecureContext: typeof scope.isSecureContext === 'boolean' ? scope.isSecureContext : null,
    hardwareConcurrency: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    userAgent: typeof nav?.userAgent === 'string' ? nav.userAgent : null,
    language: typeof nav?.language === 'string' ? nav.language : null,
    languages: Array.isArray(nav?.languages) ? [...nav.languages] : null,
    locale,
    timeOrigin: typeof performance === 'undefined' ? null : performance.timeOrigin,
    capabilities: {
      cryptoSubtle: typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function',
      messageChannel: typeof MessageChannel === 'function',
      structuredClone: typeof structuredClone === 'function',
      textDecoder: typeof TextDecoder === 'function',
      workerPerformanceMemory: workerHeap() !== null,
    },
    rngEngineVersion,
    build: build ?? null,
    buildCommit: buildCommitOf(build),
  }
}

/**
 * Stage-by-stage synchronous segments (split at yields and at stage boundaries) and the yield-to-yield gaps (the event loop's own
 * blocked intervals, which a stage boundary does not end). Observed values only.
 */
class SliceMonitor {
  stage = 'accepted'
  yields = 0
  readonly slices: Record<string, GabSliceStat> = {}
  longest: GabYieldGap | null = null
  maxGapMs = 0
  maxGapSinceHeartbeatMs = 0
  private readonly now: () => number
  private segmentStart: number
  private lastResume: number
  private gapFromStage = 'accepted'

  constructor(now: () => number) {
    this.now = now
    this.segmentStart = now()
    this.lastResume = this.segmentStart
  }

  private stat(stage: string): GabSliceStat {
    this.slices[stage] ??= { segments: 0, maxSliceMs: 0, totalMs: 0, yields: 0 }
    return this.slices[stage]
  }

  private closeSegment(): void {
    const at = this.now()
    const ms = at - this.segmentStart
    const stat = this.stat(this.stage)
    stat.segments += 1
    stat.totalMs += ms
    stat.maxSliceMs = Math.max(stat.maxSliceMs, ms)
    this.segmentStart = at
  }

  private closeGap(): void {
    const ms = this.now() - this.lastResume
    if (this.longest === null || ms > this.longest.ms) this.longest = { ms, fromStage: this.gapFromStage, toStage: this.stage }
    this.maxGapMs = Math.max(this.maxGapMs, ms)
    this.maxGapSinceHeartbeatMs = Math.max(this.maxGapSinceHeartbeatMs, ms)
  }

  enter(stage: string): void {
    if (stage === this.stage) return
    this.closeSegment()
    this.stage = stage
  }

  beforeYield(): void {
    this.closeSegment()
    this.closeGap()
    this.stat(this.stage).yields += 1
    this.yields += 1
  }

  afterYield(): void {
    const at = this.now()
    this.segmentStart = at
    this.lastResume = at
    this.gapFromStage = this.stage
  }

  finish(): void {
    this.closeSegment()
    this.closeGap()
  }
}

/** The slice stage a progress event leaves the calculation in (the events mark the end of Phase 0 / A / B-C and the start of D / D'). */
export function gabSliceStageAfter(event: GabProgressEvent, role: GabRunRequest['role']): string {
  switch (event.kind) {
    case 'input':
      if (event.status === 'started') return event.stage === 'phase0' ? 'phase0' : 'input'
      if (event.stage === 'input_build') return role === 'first' ? 'phase0' : 'input'
      return event.stage === 'phase0' ? 'entry_set_check' : 'input'
    case 'materialization':
      switch (event.event.kind) {
        case 'context': return 'phase_a'
        case 'reach_table': return 'phase_bc'
        case 'structural_candidate': return 'phase_bc'
        default: return 'phase_d'
      }
    case 'verification': return event.event.status === 'started' ? `phase_d_prime:${event.event.stage}` : 'phase_d_prime'
    case 'evidence': return event.status === 'started' ? `evidence:${event.stage}` : 'evidence'
  }
}

export interface GlobalAssignmentBrowserController {
  handleMessage(message: unknown): Promise<void>
  environment(): GabWorkerEnvironment
}

function errorOf(error: unknown, code: GabWorkerError['code'], stage: string): GabWorkerError {
  return { code, stage, errorName: gabErrorName(error), message: gabErrorMessage(error) }
}

export function createGlobalAssignmentBrowserController(postMessage: GabPostMessage, options: GlobalAssignmentBrowserControllerOptions): GlobalAssignmentBrowserController {
  const now = options.now ?? (() => performance.now())
  const epochNow = options.epochNow ?? gabDefaultEpochNow
  const yieldFor = options.yieldFor ?? defaultGabYieldFor
  const sha256Text = options.sha256Text ?? webCryptoSha256
  const sha256Bytes = options.sha256Bytes ?? gabSha256Bytes
  const workerHeap = options.workerHeap ?? readGabWorkerHeap
  const build = (options.build ?? defaultBuild)()
  let environment: GabWorkerEnvironment | null = null
  const environmentOf = () => (environment ??= { ...probeGabEnvironment(options.createEngine().version, build, workerHeap), ...options.environmentOverrides })
  let usedRequestId: string | null = null
  const cancelled = new Set<string>()
  const version = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION

  async function run(request: GabRunRequest): Promise<void> {
    const { requestId } = request
    const acceptedAt = now()
    const acceptedAtEpochMs = epochNow()
    const env = environmentOf()
    postMessage({ type: 'gab_accepted', protocolVersion: version, requestId, role: request.role, acceptedAtEpochMs })
    const monitor = new SliceMonitor(now)
    const baseYield = yieldFor(request.execution.yieldMode)
    const heapSamples: GabWorkerHeapSample[] | null = request.execution.workerHeapSampling ? [] : null
    let heartbeats = 0
    let progressEvents = 0
    let lastHeartbeatAt = acceptedAt
    let terminal = false
    const send = (response: GabResponse) => {
      if (terminal) return
      if (response.type === 'gab_result' || response.type === 'gab_cancelled' || response.type === 'gab_error') terminal = true
      postMessage(response)
    }
    const heartbeat = () => {
      const heap = heapSamples === null ? null : workerHeap()
      if (heap !== null) heapSamples!.push(heap)
      heartbeats += 1
      lastHeartbeatAt = now()
      send({ type: 'gab_heartbeat', protocolVersion: version, requestId, heartbeat: {
        stage: monitor.stage, elapsedMs: lastHeartbeatAt - acceptedAt, yields: monitor.yields, maxSliceMs: monitor.maxGapMs, maxSliceSinceLastHeartbeatMs: monitor.maxGapSinceHeartbeatMs, workerHeap: heap,
      } })
      monitor.maxGapSinceHeartbeatMs = 0
    }
    const ports: GlobalAssignmentStagePorts = {
      readExport: () => (request.exportPayload.kind === 'blob' ? request.exportPayload.blob.arrayBuffer() : Promise.resolve(request.exportPayload.bytes)),
      sha256Bytes, sha256Text, now,
      shouldCancel: () => cancelled.has(requestId),
      yieldControl: async () => {
        monitor.beforeYield()
        if (now() - lastHeartbeatAt >= request.execution.heartbeatIntervalMs) heartbeat()
        await baseYield()
        monitor.afterYield()
      },
      onEvent: event => {
        progressEvents += 1
        monitor.enter(gabSliceStageAfter(event, request.role))
        send({ type: 'gab_progress', protocolVersion: version, requestId, event, atMs: now() - acceptedAt })
      },
      createEngine: options.createEngine,
      buildInput: options.buildInput,
    }
    const exportFileName = request.exportPayload.kind === 'blob' && typeof (request.exportPayload.blob as Partial<File>).name === 'string' && (request.exportPayload.blob as File).name !== ''
      ? (request.exportPayload.blob as File).name : request.exportIdentity.fileName
    const provenance = { exportFileName, expectedExport: { ...request.exportIdentity }, buildCommit: env.buildCommit ?? GAB_UNBUILT_COMMIT }
    const cancelledObservation = (stoppedAt: string, via: GabCancelledObservation['via']): GabCancelledObservation =>
      ({ stoppedAt, via, elapsedMs: now() - acceptedAt, yields: monitor.yields, maxSliceMs: monitor.maxGapMs })
    try {
      const conditions = options.conditions.read()
      const stage = request.role === 'first'
        ? await runFirstStage(conditions, provenance, ports)
        : await runFreshStage(request.entrySet, conditions, provenance, ports)
      monitor.finish()
      // Best effort: a flag set by now turns the result into gab_cancelled (the main thread discards a result after its cancel anyway).
      if (cancelled.has(requestId)) {
        send({ type: 'gab_cancelled', protocolVersion: version, requestId, observed: cancelledObservation(monitor.stage, 'before_result') })
        return
      }
      const { timing, ...body } = stage
      const result: GabWorkerResult = {
        protocolVersion: version, requestId, environment: env, ...body, role: request.role,
        conditions: { ...body.conditions, source: options.conditions.source },
        observed: {
          timing: { ...timing, workerTotalMs: now() - acceptedAt }, slices: monitor.slices, longestYieldGap: monitor.longest, yields: monitor.yields, heartbeats, progressEvents,
          workerHeap: heapSamples, acceptedAtEpochMs,
        },
        formal: false, oracleFreeExecution: true,
      }
      // Every value the main thread re-hashes or exports must be plain JSON; anything else is an integrity issue of this run.
      const nonPlain = findNonPlainJsonPaths(result, 'result')
      if (nonPlain.length > 0) result.integrityIssues = [...result.integrityIssues, ...nonPlain.map(path => `non-plain value at ${path}`)]
      send({ type: 'gab_result', protocolVersion: version, requestId, result })
    } catch (error) {
      monitor.finish()
      if (error instanceof GlobalAssignmentBrowserStageCancelled) {
        send({ type: 'gab_cancelled', protocolVersion: version, requestId, observed: cancelledObservation(error.stage, 'cancel_point') })
      } else if (error instanceof GlobalAssignmentBrowserStageError) {
        send({ type: 'gab_error', protocolVersion: version, requestId, error: errorOf(error, error.code, error.stage) })
      } else {
        send({ type: 'gab_error', protocolVersion: version, requestId, error: errorOf(error, 'calculation_failed', monitor.stage) })
      }
    }
  }

  return {
    environment: environmentOf,
    handleMessage: async message => {
      if (!isGabRequestType(message)) return
      const issues = gabRequestIssues(message)
      const raw = message as { requestId?: unknown; type: string }
      const requestId = typeof raw.requestId === 'string' ? raw.requestId : null
      if (issues.length > 0) {
        postMessage({ type: 'gab_error', protocolVersion: version, requestId, error: { code: 'invalid_request', stage: 'request', errorName: 'InvalidRequest', message: issues.join(' ') } })
        return
      }
      if (raw.type === 'gab_ping') {
        postMessage({ type: 'gab_pong', protocolVersion: version, pingId: (message as unknown as { pingId: number }).pingId })
        return
      }
      if (raw.type === 'gab_cancel') {
        // Acknowledged at once, whether or not the request is still running (the main thread reads late acks as late responses).
        cancelled.add(requestId!)
        postMessage({ type: 'gab_cancel_ack', protocolVersion: version, requestId: requestId! })
        return
      }
      // Fresh Worker policy: exactly one run per Worker; a repeated or second request is refused before any calculation.
      if (usedRequestId !== null) {
        postMessage({ type: 'gab_error', protocolVersion: version, requestId, error: {
          code: requestId === usedRequestId ? 'duplicate_request' : 'worker_already_used', stage: 'request', errorName: 'FreshWorkerPolicy',
          message: requestId === usedRequestId ? `Duplicate request '${requestId}'.` : 'Fresh Worker policy: this Worker already ran a request.',
        } })
        return
      }
      usedRequestId = requestId
      await run(message as GabRunRequest)
    },
  }
}

export interface GlobalAssignmentBrowserWorkerScope {
  postMessage: (response: GabResponse) => void
  addEventListener: (type: 'message' | 'messageerror', listener: (event: { data: unknown }) => void) => void
}

/** Wires the controller to a Dedicated Worker scope and announces readiness (with the environment probe) once the module evaluated. */
export function attachGlobalAssignmentBrowserWorker(scope: GlobalAssignmentBrowserWorkerScope, options: GlobalAssignmentBrowserControllerOptions): GlobalAssignmentBrowserController {
  const controller = createGlobalAssignmentBrowserController(response => scope.postMessage(response), options)
  scope.addEventListener('message', event => { void controller.handleMessage(event.data) })
  // A message the Worker could not deserialize cannot be attributed to a request: reported without one, never guessed.
  scope.addEventListener('messageerror', () => {
    scope.postMessage({ type: 'gab_error', protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, requestId: null, error: { code: 'invalid_request', stage: 'message', errorName: 'MessageError', message: 'The Worker could not deserialize a message.' } })
  })
  scope.postMessage({ type: 'gab_ready', protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, environment: controller.environment() })
  return controller
}
