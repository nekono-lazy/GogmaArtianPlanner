import {
  fromPhase2C25D2ERequest,
  toPhase2C25D2EResponse,
  type Phase2C25D2EResponse,
} from '../benchmarks/plannerGlobalPhase2C25D2EProtocol'
import { createPhase2C25BController, type Phase2C25BControllerOptions } from './plannerGlobalPhase2C25B.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-e: benchmark-only Worker controller.
 *
 * It is the Phase 2-C2.5-B controller, unchanged, exactly as D2-b used it - one request per fresh Worker, the pre-search
 * context re-derived from the PlannerInput and checked against the page's digest, then the current Production
 * `visitPlannerAlternativeCandidates()` (since D2-d with the single-pass held-aware Bonus stream) with a first-Candidate
 * consumer stop, the first Candidate notice posted before the final result, and the existing counting Engine / Search
 * observer in the instrumented mode - spoken on the D2-e wire namespace (`pg2c25d2e_benchmark_*`). There is no D2-e Search
 * implementation, no memory seam and no change to a Production Worker protocol, Client or adapter.
 *
 * A failure the Worker cannot catch (a V8 heap limit, a terminated realm) sends nothing; the page and the external
 * driver observe it, and nothing here turns it into a result.
 */
export interface Phase2C25D2EWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export function attachPhase2C25D2EWorker(scope: Phase2C25D2EWorkerScope, options: Phase2C25BControllerOptions) {
  const controller = createPhase2C25BController(message => scope.postMessage(toPhase2C25D2EResponse(message)), options)
  scope.addEventListener('message', event => {
    const request = fromPhase2C25D2ERequest(event.data)
    if (request !== null) void controller.handleMessage(request)
  })
  scope.postMessage(toPhase2C25D2EResponse({ type: 'pg2c25b_benchmark_ready', environment: controller.environment() }) satisfies Phase2C25D2EResponse)
  return controller
}
