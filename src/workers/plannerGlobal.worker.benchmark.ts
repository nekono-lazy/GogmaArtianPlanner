import {
  isPlannerGlobalBenchmarkRequest,
  PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION,
  validatePlannerGlobalRunRequest,
  type PlannerGlobalBenchmarkRequest,
  type PlannerGlobalBenchmarkResponse,
  type PlannerGlobalProgressObservation,
  type PlannerGlobalRawCacheMode,
  type PlannerGlobalRunRequest,
  type PlannerGlobalWorkerEnvironment,
  type PlannerGlobalWorkerHeapSample,
  type PlannerGlobalWorkerResult,
  type PlannerGlobalYieldMode,
} from '../benchmarks/plannerGlobalBrowserBenchmarkProtocol'
import {
  PlannerGlobalEvidenceCollector,
  plannerGlobalFallbackRecords,
  plannerGlobalSemantic,
  jsonSha256,
  reportWithoutProfiles,
  webCryptoSha256,
  type Sha256Text,
} from '../benchmarks/plannerGlobalBrowserEvidence'
import { createPhase1EFallback, derivedAttemptState, PHASE1E_BOUNDS } from '../benchmarks/plannerGlobalOptimizationPhase1E'
import { GlobalSearchProfiler } from '../benchmarks/plannerGlobalOptimizationProfile'
import { GLOBAL_RESEARCH_EXTENT, globalResearchDependencies, runGlobalPlannerResearch, type GlobalResearchReport } from '../benchmarks/plannerGlobalOptimizationResearch'
import { classifyAttempt, collectRetrySignals, discoverySignature, parseDiscoveryState, stableResearchEntries } from '../benchmarks/plannerGlobalOptimizationRetry'
import type { GlobalRawBlockResearch } from '../benchmarks/plannerGlobalRawBlocks'
import { phase2bAutonomousPlanEvidence } from '../benchmarks/plannerGlobalPhase2BPlan'
import { Phase2BPlannerTimeline } from '../benchmarks/plannerGlobalPhase2BTimeline'
import type { RngEngine } from '../domain/rng/rngEngine'

/**
 * Issue #154 Global Planner Research Phase 2-A: benchmark-only Worker controller.
 *
 * It runs the Phase 1-E Research calculation itself - `runGlobalPlannerResearch()` with the generic
 * single-axis fallback (`createPhase1EFallback()`), the Phase 1-B raw block cache and the Planner / Trace
 * Replay authority - inside one Browser Worker. It owns its Engine, raw block Research cache, yield and
 * cancel state; nothing is shared with a Production Worker, and no Production Worker protocol, Client or
 * adapter changed. One Worker accepts exactly one run (fresh Worker policy): no Candidate, Projected
 * state, Planner state or cache can reach a later attempt.
 */
export type PlannerGlobalBenchmarkPostMessage = (response: PlannerGlobalBenchmarkResponse) => void

export interface PlannerGlobalBenchmarkControllerOptions {
  /** The Planner / Trace Replay Engine (the Production Engine in the entry). A new one per run. */
  readonly createEngine: () => RngEngine
  /** The Phase 1-B Research raw block observer / cache for Candidate Search. A new one per run. */
  readonly createRawBlocks: (mode: PlannerGlobalRawCacheMode) => GlobalRawBlockResearch
  readonly now?: () => number
  readonly yieldFor?: (mode: PlannerGlobalYieldMode) => () => Promise<void>
  readonly sha256?: Sha256Text
  /** Worker-realm `performance.memory` when the Browser exposes it; null otherwise (never estimated). */
  readonly workerHeap?: () => PlannerGlobalWorkerHeapSample | null
  /** Phase 2-B: epoch-aligned clock (`performance.timeOrigin + performance.now()` by default). */
  readonly epochNow?: () => number
  /** Phase 2-B: synchronous heap probe at timeline marks (Node only); absent in a Browser Worker. */
  readonly timelineHeapProbe?: { readonly label: string; readonly heapUsedBytes: () => number }
}

export const defaultEpochNow = () => performance.timeOrigin + performance.now()

/**
 * A MessagePort turn: a macrotask, so a pending `cancel` / `ping` message is dispatched between two
 * calculation slices. A microtask would never let it through; a timer would measure its clamp (B5).
 * A local copy on purpose: `src/workers/search.worker.ts` and `planner.worker.ts` are Production code and
 * Phase 2-A does not touch them. Resolvers are FIFO because MessagePort delivery is ordered.
 */
const yieldChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null
const yieldResolvers: Array<() => void> = []
if (yieldChannel !== null) yieldChannel.port1.onmessage = () => yieldResolvers.shift()?.()

export function plannerGlobalMessageChannelYield(): Promise<void> {
  const channel = yieldChannel
  if (channel === null) throw new Error('MessageChannel is unavailable; the Phase 2-A message-channel yield cannot run.')
  return new Promise(resolve => {
    yieldResolvers.push(resolve)
    channel.port2.postMessage(null)
  })
}

export function plannerGlobalTimerYield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export const defaultPlannerGlobalYieldFor = (mode: PlannerGlobalYieldMode) => mode === 'message-channel' ? plannerGlobalMessageChannelYield : plannerGlobalTimerYield

export function readWorkerPerformanceMemory(): PlannerGlobalWorkerHeapSample | null {
  const memory = (globalThis.performance as Performance & { memory?: PlannerGlobalWorkerHeapSample }).memory
  if (!memory || typeof memory.usedJSHeapSize !== 'number') return null
  return { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit }
}

export interface PlannerGlobalBenchmarkController {
  handleMessage(request: PlannerGlobalBenchmarkRequest): Promise<void>
  environment(): PlannerGlobalWorkerEnvironment
}

export function createPlannerGlobalBenchmarkController(postMessage: PlannerGlobalBenchmarkPostMessage,
  options: PlannerGlobalBenchmarkControllerOptions): PlannerGlobalBenchmarkController {
  const now = options.now ?? (() => performance.now())
  const yieldFor = options.yieldFor ?? defaultPlannerGlobalYieldFor
  const sha = options.sha256 ?? webCryptoSha256
  const workerHeap = options.workerHeap ?? readWorkerPerformanceMemory
  let usedRequestId: string | null = null
  const cancelled = new Set<string>()

  async function run(request: PlannerGlobalRunRequest): Promise<void> {
    const issues = validatePlannerGlobalRunRequest(request)
    if (issues.length) throw new RangeError(`Invalid Phase 2-A run request: ${issues.join(' / ')}`)
    const attemptState = request.attemptState === null ? null : parseDiscoveryState(request.attemptState)
    const input = request.input
    const priorityEntries = stableResearchEntries(input).map(e => ({ id: e.id as string, targetWeaponId: e.targetWeaponId as string }))
    const epochNow = options.epochNow ?? defaultEpochNow
    const acceptedAtEpoch = epochNow()
    const acceptedAt = now()
    postMessage({ type: 'pg2a_benchmark_accepted', requestId: request.requestId, priorityEntries })
    const engine = options.createEngine()
    const dependencies = globalResearchDependencies(engine)
    const rawBlocks = options.createRawBlocks(request.rawCache)
    const profiler = request.profiler ? new GlobalSearchProfiler() : undefined
    const evidence = new PlannerGlobalEvidenceCollector(sha)
    const extentFallback = request.mode === 'fallback'
      ? createPhase1EFallback(request.fallbackAxis!, request.fallbackBudgetMs!, { ...PHASE1E_BOUNDS, maxFallbackEpisodesPerAttempt: request.fallbackMaxEpisodes! })
      : undefined
    let lastKey = ''
    const observe = (report: GlobalResearchReport) => {
      const last = report.searches.at(-1)
      const key = `${report.stage}|${report.status}|${report.searches.length}|${last?.status ?? ''}|${last?.fallback?.status ?? ''}`
      if (key === lastKey) return
      lastKey = key
      const observation: PlannerGlobalProgressObservation = { stage: report.stage, status: report.status, searchIndex: report.searches.length - 1,
        searchStatus: last?.status ?? null, fallbackStatus: last?.fallback?.status ?? null, fallbackEpisodes: report.extentFallback?.searches ?? 0,
        generatedReplacements: report.generatedReplacementCount, elapsedMs: now() - acceptedAt, workerHeap: request.measurement === 'memory' ? workerHeap() : null }
      postMessage({ type: 'pg2a_benchmark_progress', requestId: request.requestId, observation })
    }
    // Phase 2-B: clocks only; absent = the Phase 2-A run unchanged.
    const plannerTimeline = request.phase2b?.timeline
      ? new Phase2BPlannerTimeline({ nowMs: epochNow, ...(options.timelineHeapProbe ? { heapUsedBytes: options.timelineHeapProbe.heapUsedBytes } : {}) })
      : undefined
    const calculationStartEpoch = epochNow()
    const calculationStart = now()
    const result = await runGlobalPlannerResearch(input, dependencies, {
      ...(plannerTimeline ? { plannerTimeline } : {}),
      profiler, rawBlocks, onSearchResult: evidence.onSearchResult, onFallbackSearchResult: evidence.onFallbackSearchResult,
      attempt: attemptState ?? undefined, extent: attemptState?.extent, extentFallback,
      timeBudgetMs: request.attemptBudgetMs ?? undefined,
      shouldCancel: () => cancelled.has(request.requestId), yieldControl: yieldFor(request.yieldMode), nowMs: now, onProgress: observe,
    })
    const calculationElapsedMs = now() - calculationStart
    const calculationEndEpoch = epochNow()
    const rawBlockSummary = rawBlocks.summary()
    rawBlocks.endRun()
    const evidenceStart = now()
    const report = reportWithoutProfiles(result.report)
    const signals = collectRetrySignals(input, result.report, result.finalResult, result.generatedEntries)
    const stop = classifyAttempt(result.report, signals)
    const state = attemptState ?? derivedAttemptState(report.retainedOriginalEntryIds, priorityEntries, GLOBAL_RESEARCH_EXTENT)
    const fallbacks = plannerGlobalFallbackRecords(report)
    const collected = await evidence.finish(result.finalResult, result.generatedEntries)
    const semantic = plannerGlobalSemantic({ report, state, fallbacks, evidence: collected, stop })
    const semanticSha256 = await jsonSha256(sha, semantic)
    const evidenceElapsedMs = now() - evidenceStart
    const evidenceEndEpoch = epochNow()
    // Phase 2-B: post-hoc read of the finished Plan (after the calculation; never fed back into it).
    const planEvidenceStart = now()
    const autonomousPlan = request.phase2b?.planEvidence && result.finalResult?.plan
      ? phase2bAutonomousPlanEvidence(input, result.report, result.generatedEntries, result.finalResult.plan, engine)
      : null
    const planEvidenceElapsedMs = now() - planEvidenceStart
    const planEvidenceEndEpoch = epochNow()
    const workerResult: PlannerGlobalWorkerResult = {
      rngEngineVersion: engine.version, inputFingerprint: result.report.inputFingerprint, priorityEntries, state, signature: discoverySignature(state), signals, stop,
      report, fallbacks, evidence: collected, semantic, semanticSha256,
      timing: { workerElapsedMs: now() - acceptedAt, calculationElapsedMs, evidenceElapsedMs, searchElapsedMs: report.searchElapsedMs,
        fallbackSearchElapsedMs: report.extentFallback?.searchElapsedMs ?? 0, plannerElapsedMs: report.plannerElapsedMs, totalElapsedMs: report.totalElapsedMs,
        candidateSearches: report.searches.length, fallbackEpisodes: report.extentFallback?.searches ?? 0 },
      rawBlockSummary, predictionProfile: profiler?.summary() ?? null, workerHeapAfter: workerHeap(),
      ...(request.phase2b ? { phase2b: {
        marks: { acceptedAtMs: acceptedAtEpoch, calculationStartAtMs: calculationStartEpoch, calculationEndAtMs: calculationEndEpoch,
          evidenceEndAtMs: evidenceEndEpoch, planEvidenceEndAtMs: planEvidenceEndEpoch, resultPostAtMs: epochNow() },
        timeline: plannerTimeline ? plannerTimeline.calls : null, autonomousPlan, planEvidenceElapsedMs,
        heapProbe: plannerTimeline && options.timelineHeapProbe ? options.timelineHeapProbe.label : null,
      } } : {}),
    }
    // A cancelled run is its own outcome: never a result, never a no-match, never a deadline.
    postMessage(report.status === 'cancelled'
      ? { type: 'pg2a_benchmark_cancelled', requestId: request.requestId, result: workerResult }
      : { type: 'pg2a_benchmark_result', requestId: request.requestId, result: workerResult })
  }

  return {
    environment: () => ({ protocolVersion: PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION,
      crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent ?? null : null,
      workerPerformanceMemory: workerHeap() !== null, rngEngineVersion: options.createEngine().version }),
    handleMessage: async request => {
      if (request.type === 'pg2a_benchmark_ping') { postMessage({ type: 'pg2a_benchmark_pong', pingId: request.pingId }); return }
      if (request.type === 'pg2a_benchmark_cancel') {
        cancelled.add(request.requestId)
        postMessage({ type: 'pg2a_benchmark_cancel_ack', requestId: request.requestId })
        return
      }
      // Fresh Worker policy: exactly one run per Worker, and a repeated / concurrent request is refused.
      if (usedRequestId !== null) {
        postMessage({ type: 'pg2a_benchmark_error', requestId: request.requestId,
          message: request.requestId === usedRequestId ? `Duplicate request '${request.requestId}'.` : 'Fresh Worker policy: this Worker already ran an attempt.' })
        return
      }
      usedRequestId = request.requestId
      try { await run(request) } catch (error) {
        postMessage({ type: 'pg2a_benchmark_error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

export interface PlannerGlobalBenchmarkWorkerScope {
  postMessage: PlannerGlobalBenchmarkPostMessage
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

export function attachPlannerGlobalBenchmarkWorker(scope: PlannerGlobalBenchmarkWorkerScope, options: PlannerGlobalBenchmarkControllerOptions): PlannerGlobalBenchmarkController {
  const controller = createPlannerGlobalBenchmarkController(response => scope.postMessage(response), options)
  scope.addEventListener('message', event => { if (isPlannerGlobalBenchmarkRequest(event.data)) void controller.handleMessage(event.data) })
  scope.postMessage({ type: 'pg2a_benchmark_ready', environment: controller.environment() })
  return controller
}
