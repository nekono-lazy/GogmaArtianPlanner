import {
  benchmarkSequenceDigest,
  createRollingBenchmarkDigest,
  type ConstrainedEnumerationBenchmarkMeasurement,
  type ConstrainedEnumerationBenchmarkMode,
  type ConstrainedEnumerationBenchmarkRequest,
  type ConstrainedEnumerationBenchmarkResponse,
} from '../benchmarks/constrainedEnumerationBenchmarkProtocol'
import { createConstrainedEnumerationBenchmarkInput } from '../benchmarks/constrainedEnumerationBenchmarkFixtures'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  CandidateSearchError,
  constrainedCandidateStableKey,
  visitConstrainedCandidates,
  type ConstrainedCandidate,
} from '../domain/search'

/**
 * B8-B2 benchmark-only Worker controller.
 *
 * It calls `visitConstrainedCandidates()` directly, with no Production Worker
 * protocol, no Search Worker controller, and no Planner involved. B8-D owns the
 * Production Worker integration; nothing here anticipates it.
 */
export type ConstrainedEnumerationBenchmarkPostMessage = (
  response: ConstrainedEnumerationBenchmarkResponse,
) => void

export interface ConstrainedEnumerationBenchmarkController {
  handleMessage: (request: ConstrainedEnumerationBenchmarkRequest) => Promise<void>
}

/**
 * The same macrotask yield mechanism the Production Search Worker uses,
 * implemented locally.
 *
 * B5 measured `setTimeout(resolve, 0)` against one MessagePort turn in a real
 * Browser Worker and found the timer's minimum clamp dominant on the larger
 * workloads, so a benchmark that used a timer here would measure the clamp
 * rather than the enumerator. It is deliberately a copy rather than an
 * extraction: `src/workers/search.worker.ts` is Production code and B8-B2 does
 * not touch it. The yield must stay a macrotask, or a pending cancel message is
 * never dispatched. Resolvers are FIFO because MessagePort delivery is ordered
 * and two runs can be in flight in one Worker.
 */
const yieldChannel =
  typeof MessageChannel === 'function' ? new MessageChannel() : null
const yieldResolvers: Array<() => void> = []
if (yieldChannel !== null) {
  yieldChannel.port1.onmessage = () => yieldResolvers.shift()?.()
}

export function benchmarkWorkerYield(): Promise<void> {
  const channel = yieldChannel
  if (channel === null) return new Promise((resolve) => setTimeout(resolve, 0))
  return new Promise((resolve) => {
    yieldResolvers.push(resolve)
    channel.port2.postMessage(null)
  })
}

/**
 * What both recorders expose to the run loop.
 *
 * The run loop never learns which one it holds, so `timing` and `parity` runs
 * drive exactly the same `visitConstrainedCandidates()` call with exactly the
 * same input. The only difference is what the visitor does with each Candidate.
 */
interface RunRecorder {
  record(candidate: ConstrainedCandidate): void
  readonly delivered: number
  readonly elapsedMs: number
  finish(
    summary: ConstrainedEnumerationBenchmarkMeasurement['summary'],
    stoppedByConsumer: boolean,
  ): ConstrainedEnumerationBenchmarkMeasurement
}

/**
 * The `timing` mode visitor, and the authority for every Production default.
 *
 * It is a minimal recorder, not an absent one: it keeps the delivered / ideal /
 * practical counts, the route kinds, and the 1st / 10th / 50th delivery
 * timestamps. What it omits is parity instrumentation - it never calls
 * `constrainedCandidateStableKey()`, never touches a digest, and never retains
 * the Candidate sequence - so it adds no second key generation, no growing
 * array and no per-Candidate `performance.now()` pair beyond the three ordinal
 * checks. The run's Worker-local wall time is therefore taken as the
 * enumeration's own cost, reported as measured with nothing subtracted.
 *
 * `recorderOverheadMs` and `enumerationElapsedMs` are null here on purpose: a
 * corrected value would only invite reading a subtraction as a measurement.
 */
class TimingRecorder implements RunRecorder {
  private readonly startedAt = performance.now()
  private readonly routeKinds = new Set<string>()
  private deliveredCount = 0
  private ideal = 0
  private practical = 0
  private first: number | null = null
  private tenth: number | null = null
  private fiftieth: number | null = null

  record(candidate: ConstrainedCandidate): void {
    this.deliveredCount += 1
    if (candidate.category === 'ideal') this.ideal += 1
    else this.practical += 1
    this.routeKinds.add(candidate.route.kind)
    if (
      this.deliveredCount === 1 ||
      this.deliveredCount === 10 ||
      this.deliveredCount === 50
    ) {
      const elapsed = performance.now() - this.startedAt
      if (this.deliveredCount === 1) this.first = elapsed
      else if (this.deliveredCount === 10) this.tenth = elapsed
      else this.fiftieth = elapsed
    }
  }

  get delivered(): number {
    return this.deliveredCount
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt
  }

  finish(
    summary: ConstrainedEnumerationBenchmarkMeasurement['summary'],
    stoppedByConsumer: boolean,
  ): ConstrainedEnumerationBenchmarkMeasurement {
    return {
      mode: 'timing',
      workerElapsedMs: this.elapsedMs,
      recorderOverheadMs: null,
      enumerationElapsedMs: null,
      deliveredCandidates: this.deliveredCount,
      idealCandidates: this.ideal,
      practicalCandidates: this.practical,
      timeToFirstCandidateMs: this.first,
      timeToTenthCandidateMs: this.tenth,
      timeToFiftiethCandidateMs: this.fiftieth,
      orderedParityKey: null,
      setParityKey: null,
      summary,
      stoppedByConsumer,
      routeKinds: [...this.routeKinds].sort(),
    }
  }
}

/**
 * Accumulates the per-run measurement.
 *
 * Constructed immediately before `visitConstrainedCandidates()`, so its clock
 * excludes fixture construction, the Master Data load, and the synthetic source
 * weapons' own Production predictions. Only the two digests and the ordinal
 * timings leave the Worker, so a run delivering hundreds of thousands of
 * Candidates still posts a small message and the transfer cost never enters the
 * measured elapsed time.
 *
 * It never retains `constrainedCandidateStableKey()` text. The enumerator
 * already holds one set of those keys for its own semantic dedup; a benchmark
 * holding a second set changes the very thing it is measuring, because heap
 * pressure, GC and huge-string retention are not removed by subtracting CPU
 * time. Each key is folded into a rolling ordered digest and reduced to a
 * fixed-length per-key digest in a single character pass, then dropped.
 * Retained state is therefore `O(delivered Candidates)` fixed-width entries
 * rather than `O(total key text)`, which on a deep-Route workload grows with
 * the square of the depth.
 */
class ParityRecorder implements RunRecorder {
  private readonly startedAt = performance.now()
  /** Ordinal-sensitive digest, folded as Candidates arrive. */
  private readonly ordered = createRollingBenchmarkDigest()
  /** One fixed-length digest per Candidate; never the key text itself. */
  private readonly keyDigests: string[] = []
  private readonly routeKinds = new Set<string>()
  private deliveredCount = 0
  private ideal = 0
  private practical = 0
  private first: number | null = null
  private tenth: number | null = null
  private fiftieth: number | null = null
  /** Accumulated cost of this recorder's own per-Candidate work. */
  private overheadMs = 0

  record(candidate: ConstrainedCandidate): void {
    const at = performance.now()
    // The offset the enumeration is responsible for: the recorder's own earlier
    // work is not part of what a Production consumer would wait for.
    const elapsed = at - this.startedAt - this.overheadMs
    // One character pass folds the ordered digest and produces the
    // fixed-length per-key digest, after which the key text is unreachable.
    this.keyDigests.push(
      this.ordered.addAndDigest(constrainedCandidateStableKey(candidate)),
    )
    this.routeKinds.add(candidate.route.kind)
    this.deliveredCount += 1
    if (candidate.category === 'ideal') this.ideal += 1
    else this.practical += 1
    if (this.deliveredCount === 1) this.first = elapsed
    if (this.deliveredCount === 10) this.tenth = elapsed
    if (this.deliveredCount === 50) this.fiftieth = elapsed
    this.overheadMs += performance.now() - at
  }

  get delivered(): number {
    return this.deliveredCount
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt
  }

  finish(
    summary: ConstrainedEnumerationBenchmarkMeasurement['summary'],
    stoppedByConsumer: boolean,
  ): ConstrainedEnumerationBenchmarkMeasurement {
    // Read before the digests below, so building them never enters the elapsed.
    const workerElapsedMs = this.elapsedMs
    return {
      mode: 'parity',
      workerElapsedMs,
      recorderOverheadMs: this.overheadMs,
      enumerationElapsedMs: workerElapsedMs - this.overheadMs,
      deliveredCandidates: this.deliveredCount,
      idealCandidates: this.ideal,
      practicalCandidates: this.practical,
      timeToFirstCandidateMs: this.first,
      timeToTenthCandidateMs: this.tenth,
      timeToFiftiethCandidateMs: this.fiftieth,
      orderedParityKey: this.ordered.finish(),
      // Over the per-key digests, so the sort never touches key text.
      setParityKey: benchmarkSequenceDigest([...this.keyDigests].sort()),
      summary,
      stoppedByConsumer,
      routeKinds: [...this.routeKinds].sort(),
    }
  }
}

function createRunRecorder(
  mode: ConstrainedEnumerationBenchmarkMode,
): RunRecorder {
  return mode === 'timing' ? new TimingRecorder() : new ParityRecorder()
}

export function createConstrainedEnumerationBenchmarkController(
  engine: RngEngine,
  postMessage: ConstrainedEnumerationBenchmarkPostMessage,
): ConstrainedEnumerationBenchmarkController {
  const cancelledRequestIds = new Set<string>()

  return {
    handleMessage: async (request) => {
      if (request.type === 'b8_benchmark_ping') {
        postMessage({ type: 'b8_benchmark_pong', pingId: request.pingId })
        return
      }
      if (request.type === 'b8_benchmark_cancel') {
        cancelledRequestIds.add(request.requestId)
        postMessage({
          type: 'b8_benchmark_cancel_ack',
          requestId: request.requestId,
        })
        return
      }

      cancelledRequestIds.delete(request.requestId)
      postMessage({ type: 'b8_benchmark_accepted', requestId: request.requestId })
      let recorder: RunRecorder | null = null
      try {
        const fixture = createConstrainedEnumerationBenchmarkInput(request.workloadId)
        const bounds = request.boundsOverride ?? fixture.input.bounds
        // The measurement anchor. Everything above is benchmark setup - fixture
        // construction, the Master Data load, and the synthetic source weapons
        // own Production predictions - and is not constrained enumeration cost.
        recorder = createRunRecorder(request.mode)
        const enumeration = recorder
        const execution = await visitConstrainedCandidates(
          { ...fixture.input, bounds },
          engine,
          (candidate) => {
            enumeration.record(candidate)
            return request.stopAfterCandidates !== null &&
              enumeration.delivered >= request.stopAfterCandidates
              ? 'stop'
              : 'continue'
          },
          {
            shouldCancel: () => cancelledRequestIds.has(request.requestId),
            yieldControl: benchmarkWorkerYield,
          },
        )
        postMessage({
          type: 'b8_benchmark_result',
          requestId: request.requestId,
          bounds,
          measurement: enumeration.finish(
            execution.summary,
            execution.stoppedByConsumer,
          ),
        })
      } catch (error: unknown) {
        if (
          error instanceof CandidateSearchError &&
          error.code === 'cancelled'
        ) {
          postMessage({
            type: 'b8_benchmark_cancelled',
            requestId: request.requestId,
            // Null when the cancel landed before the measurement anchor, which
            // no measurement covers.
            workerElapsedMs: recorder === null ? null : recorder.elapsedMs,
            deliveredCandidates: recorder === null ? 0 : recorder.delivered,
          })
          return
        }
        postMessage({
          type: 'b8_benchmark_error',
          requestId: request.requestId,
          message:
            error instanceof Error ? error.message : 'Unknown enumeration error.',
        })
      }
    },
  }
}

export interface ConstrainedEnumerationBenchmarkWorkerScope {
  postMessage: ConstrainedEnumerationBenchmarkPostMessage
  addEventListener: (
    type: 'message',
    listener: (event: { data: ConstrainedEnumerationBenchmarkRequest }) => void,
  ) => void
}

export function attachConstrainedEnumerationBenchmarkWorker(
  scope: ConstrainedEnumerationBenchmarkWorkerScope,
  createEngine: () => RngEngine,
): ConstrainedEnumerationBenchmarkController {
  const controller = createConstrainedEnumerationBenchmarkController(
    createEngine(),
    (response) => scope.postMessage(response),
  )
  scope.addEventListener('message', (event) => {
    void controller.handleMessage(event.data)
  })
  return controller
}
