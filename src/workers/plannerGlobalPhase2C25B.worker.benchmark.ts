import { benchmarkWorkerYield } from './constrainedEnumeration.worker.benchmark'
import {
  derivePhase2C25BContexts,
  preparePhase2C25BSearchContext,
  runPhase2C25BSearchOnly,
} from '../benchmarks/plannerGlobalPhase2C25B'
import {
  isPhase2C25BRequest,
  PHASE2C25B_PROTOCOL_VERSION,
  validatePhase2C25BRequest,
  type Phase2C25BErrorStage,
  type Phase2C25BRequest,
  type Phase2C25BResponse,
  type Phase2C25BWorkerEnvironment,
  type Phase2C25BWorkerHeapSample,
} from '../benchmarks/plannerGlobalPhase2C25BProtocol'
import type { RngEngine } from '../domain/rng/rngEngine'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-B: benchmark-only Worker controller.
 *
 * One Worker serves exactly one request (fresh Worker policy): a `contexts` request (baseline + pre-search contexts)
 * or a `search` request (re-derive one context, check its digest, run the Planner Alternative Search alone to the first
 * Candidate). It yields through the existing benchmark MessageChannel macrotask (`benchmarkWorkerYield`), owns its
 * Engine, and shares nothing with a Production Worker; no Production Worker protocol, Client or adapter changed.
 *
 * A thrown error is answered as a structured `pg2c25b_benchmark_error`. A failure the Worker cannot catch (a V8 heap
 * limit, a terminated realm) sends nothing: the page and the external driver observe it, and nothing here turns it
 * into a result.
 */
export type Phase2C25BPostMessage = (response: Phase2C25BResponse) => void

export interface Phase2C25BWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export interface Phase2C25BControllerOptions {
  readonly createEngine: () => RngEngine
  readonly now?: () => number
  readonly yieldControl?: () => Promise<void>
  readonly heap?: () => Phase2C25BWorkerHeapSample | null
  readonly sha256?: (text: string) => Promise<string>
  readonly setHeartbeat?: (callback: () => void, intervalMs: number) => () => void
}

export function readPhase2C25BWorkerHeap(): Phase2C25BWorkerHeapSample | null {
  const memory = (globalThis.performance as Performance & { memory?: Phase2C25BWorkerHeapSample }).memory
  if (!memory || typeof memory.usedJSHeapSize !== 'number') return null
  return { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit }
}

export async function webCryptoSha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function phase2c25bWorkerEnvironment(engine: RngEngine, heap: () => Phase2C25BWorkerHeapSample | null): Phase2C25BWorkerEnvironment {
  return {
    protocolVersion: PHASE2C25B_PROTOCOL_VERSION,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    hardwareConcurrency: typeof navigator === 'undefined' ? null : navigator.hardwareConcurrency ?? null,
    crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null,
    performanceMemory: heap(),
    messageChannel: typeof MessageChannel === 'function',
    rngEngineVersion: engine.version,
  }
}

export function createPhase2C25BController(postMessage: Phase2C25BPostMessage, options: Phase2C25BControllerOptions) {
  const now = options.now ?? (() => performance.now())
  const yieldControl = options.yieldControl ?? benchmarkWorkerYield
  const heap = options.heap ?? readPhase2C25BWorkerHeap
  const sha256 = options.sha256 ?? webCryptoSha256Hex
  const setHeartbeat = options.setHeartbeat ?? ((callback: () => void, intervalMs: number) => {
    const timer = globalThis.setInterval(callback, intervalMs)
    return () => globalThis.clearInterval(timer)
  })
  let used = false

  async function handle(request: Phase2C25BRequest): Promise<void> {
    let stage: Phase2C25BErrorStage = 'validation'
    let firstCandidateDelivered = false
    try {
      if (used) throw new Error('Fresh Worker policy: this Worker already served a request.')
      used = true
      const issues = validatePhase2C25BRequest(request)
      if (issues.length) throw new RangeError(`Invalid Phase 2-C2.5-B request: ${issues.join(' / ')}`)
      postMessage({ type: 'pg2c25b_benchmark_accepted', requestId: request.requestId })
      stage = 'preparation'
      if (request.type === 'pg2c25b_benchmark_contexts') {
        const result = await derivePhase2C25BContexts(request.input, request.orientationIds, options.createEngine, now)
        postMessage({ type: 'pg2c25b_benchmark_contexts_result', requestId: request.requestId, result })
        return
      }
      const prepStarted = now()
      const engine = options.createEngine()
      const prepared = preparePhase2C25BSearchContext(request.input, request.orientation, request.workIndex, request.expectedContextDigest, engine)
      postMessage({ type: 'pg2c25b_benchmark_search_ready', requestId: request.requestId, preparationMs: now() - prepStarted, workerHeap: heap() })
      stage = 'search'
      const record = await runPhase2C25BSearchOnly(request.input, prepared, request.workIndex, engine, {
        mode: request.mode, yieldControl, now, sha256, snapshotPolicy: request.snapshotPolicy,
        onFirstCandidate: timeToFirstMs => {
          firstCandidateDelivered = true
          stage = 'summary'
          postMessage({ type: 'pg2c25b_benchmark_first_candidate', requestId: request.requestId, timeToFirstMs })
        },
        observation: request.mode === 'instrumented' ? {
          heap, setHeartbeat,
          emit: snapshot => postMessage({ type: 'pg2c25b_benchmark_progress', requestId: request.requestId, snapshot }),
        } : undefined,
      })
      postMessage({ type: 'pg2c25b_benchmark_search_result', requestId: request.requestId, record })
    } catch (error) {
      postMessage({ type: 'pg2c25b_benchmark_error', requestId: request.requestId, stage, name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error), firstCandidateDelivered })
    }
  }

  return {
    handleMessage: (data: unknown) => isPhase2C25BRequest(data) ? handle(data) : Promise.resolve(),
    environment: () => phase2c25bWorkerEnvironment(options.createEngine(), heap),
  }
}

export function attachPhase2C25BWorker(scope: Phase2C25BWorkerScope, options: Phase2C25BControllerOptions) {
  const controller = createPhase2C25BController(message => scope.postMessage(message), options)
  scope.addEventListener('message', event => { void controller.handleMessage(event.data) })
  scope.postMessage({ type: 'pg2c25b_benchmark_ready', environment: controller.environment() } satisfies Phase2C25BResponse)
  return controller
}
