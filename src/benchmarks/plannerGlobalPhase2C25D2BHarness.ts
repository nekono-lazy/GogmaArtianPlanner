/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-b: main-thread runner. Research only; benchmark.html only.
 *
 * It is the Phase 2-C2.5-B runner (one fresh Dedicated Worker per run, every page-observable outcome kept apart, the
 * `repeatDecision()` rule, the relay of every lifecycle event for the external CDP driver) with the D2-b identity:
 *
 * - the Worker is the D2-b benchmark Worker, and every message crosses the Worker boundary on the `pg2c25d2b_benchmark_*`
 *   wire (the adapter below renames the prefix only; a Phase 2-C2.5-B message is ignored);
 * - the relay prefix is `[pg2c25d2b]`, the protocol version and record IDs are D2-b's;
 * - the workload is the D2-a one (`phase2c25d2bWorkload()`), and the contexts Worker derives, and the parity compares,
 *   exactly the orientations of that workload.
 *
 * The only Search input is the PlannerInput the page built from the original Export.
 */
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import type { Phase2C25BEvidenceView } from './plannerGlobalPhase2C25BEvidence'
import { createPhase2C25BRunner, type Phase2C25BRunnerDependencies } from './plannerGlobalPhase2C25BHarness'
import type { Phase2C25BRequest } from './plannerGlobalPhase2C25BProtocol'
import { phase2c25d2bWorkload, type Phase2C25D2BWorkloadContext } from './plannerGlobalPhase2C25D2B'
import {
  fromPhase2C25D2BResponse,
  PHASE2C25D2B_PROTOCOL_VERSION,
  PHASE2C25D2B_RELAY_PREFIX,
  toPhase2C25D2BRequest,
} from './plannerGlobalPhase2C25D2BProtocol'

/**
 * The runner's view of a D2-b Worker: requests are renamed onto the D2-b wire, D2-b responses renamed back, and any other
 * `message` (a Phase 2-C2.5-B one included) never reaches the runner. `error` / `messageerror` pass through unchanged.
 */
export function adaptPhase2C25D2BWorker(worker: BenchmarkWorkerLike): BenchmarkWorkerLike {
  const wrapped = new Map<(event: Event) => void, (event: Event) => void>()
  return {
    postMessage: message => worker.postMessage(toPhase2C25D2BRequest(message as Phase2C25BRequest)),
    addEventListener: (type, listener) => {
      if (type !== 'message') { worker.addEventListener(type, listener); return }
      const translated = (event: Event) => {
        const data = fromPhase2C25D2BResponse((event as MessageEvent<unknown>).data)
        if (data !== null) listener({ data } as MessageEvent<unknown>)
      }
      wrapped.set(listener, translated)
      worker.addEventListener(type, translated)
    },
    removeEventListener: (type, listener) => {
      if (type !== 'message') { worker.removeEventListener(type, listener); return }
      const translated = wrapped.get(listener)
      if (translated) { wrapped.delete(listener); worker.removeEventListener(type, translated) }
    },
    terminate: () => worker.terminate(),
  }
}

function createPhase2C25D2BWorker(): BenchmarkWorkerLike {
  return new Worker(new URL('../workers/plannerGlobalPhase2C25D2B.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as BenchmarkWorkerLike
}

export interface Phase2C25D2BRunnerDependencies extends Omit<Phase2C25BRunnerDependencies, 'phase'> {
  /** Tests only: a synthetic scenario too small for the D2-a rule. The page always uses `phase2c25d2bWorkload()`. */
  readonly selectWorkload?: (view: Phase2C25BEvidenceView, json: unknown) => Phase2C25D2BWorkloadContext[]
}

export function createPhase2C25D2BRunner(dependencies: Phase2C25D2BRunnerDependencies) {
  const { selectWorkload = phase2c25d2bWorkload, createWorker = createPhase2C25D2BWorker, ...rest } = dependencies
  return createPhase2C25BRunner({
    relay: event => console.info(PHASE2C25D2B_RELAY_PREFIX, JSON.stringify(event)),
    createRequestId: () => `pg2c25d2b-${crypto.randomUUID()}`,
    ...rest,
    createWorker: () => adaptPhase2C25D2BWorker(createWorker()),
    phase: { protocolVersion: PHASE2C25D2B_PROTOCOL_VERSION, recordIdPrefix: 'pg2c25d2b-record-', workload: selectWorkload },
  })
}
export type Phase2C25D2BRunner = ReturnType<typeof createPhase2C25D2BRunner>
