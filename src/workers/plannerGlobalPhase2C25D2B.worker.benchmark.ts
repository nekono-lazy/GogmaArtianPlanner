import {
  fromPhase2C25D2BRequest,
  toPhase2C25D2BResponse,
  type Phase2C25D2BResponse,
} from '../benchmarks/plannerGlobalPhase2C25D2BProtocol'
import { createPhase2C25BController, type Phase2C25BControllerOptions } from './plannerGlobalPhase2C25B.worker.benchmark'

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-b: benchmark-only Worker controller.
 *
 * It is the Phase 2-C2.5-B controller, unchanged - one request per fresh Worker, the pre-search context re-derived from
 * the PlannerInput and checked against the page's digest, then the current Production `visitPlannerAlternativeCandidates()`
 * (which since D2-a publishes Ideal Candidates only) with a first-Candidate consumer stop, the first Candidate notice
 * posted before the final result, and the existing counting Engine / Search observer in the instrumented mode - spoken
 * on the D2-b wire namespace (`pg2c25d2b_benchmark_*`). There is no D2-b Search implementation, no memory seam and no
 * change to a Production Worker protocol, Client or adapter.
 *
 * A failure the Worker cannot catch (a V8 heap limit, a terminated realm) sends nothing; the page and the external
 * driver observe it, and nothing here turns it into a result.
 */
export interface Phase2C25D2BWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export function attachPhase2C25D2BWorker(scope: Phase2C25D2BWorkerScope, options: Phase2C25BControllerOptions) {
  const controller = createPhase2C25BController(message => scope.postMessage(toPhase2C25D2BResponse(message)), options)
  scope.addEventListener('message', event => {
    const request = fromPhase2C25D2BRequest(event.data)
    if (request !== null) void controller.handleMessage(request)
  })
  scope.postMessage(toPhase2C25D2BResponse({ type: 'pg2c25b_benchmark_ready', environment: controller.environment() }) satisfies Phase2C25D2BResponse)
  return controller
}
