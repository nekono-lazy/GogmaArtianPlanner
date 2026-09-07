import type {
  ConstrainedEnumerationBounds,
  ConstrainedEnumerationSummary,
} from '../domain/search'

/**
 * B8-B2 benchmark-only Worker protocol.
 *
 * This is deliberately NOT a Production Worker protocol. B8-D is the phase that
 * adds constrained re-search to `SearchWorkerRequest` / `PlannerWorkerRequest`
 * and the Application services; nothing here may be reused as that contract.
 * Every message type is prefixed `b8_benchmark_`, so it cannot collide with an
 * existing Production Worker message even if one Worker ever carried both.
 *
 * Per-Candidate messages are deliberately absent. `time to first Candidate` and
 * the later ordinals are measured with the Worker's own clock and reported once
 * at the end, so the measurement is not distorted by the message traffic the
 * measurement itself would create.
 */
export const CONSTRAINED_ENUMERATION_BENCHMARK_PROTOCOL_VERSION = 'b8-b2'

/**
 * What the visitor is allowed to do while the enumeration runs.
 *
 * `timing` is the authority for every performance number the Production
 * defaults are chosen from. Its visitor is a minimal recorder: it keeps the
 * delivered / ideal / practical counts, the route kinds, and the 1st / 10th /
 * 50th delivery timestamps. What it does not do is parity instrumentation - it
 * never re-derives `constrainedCandidateStableKey()`, never builds or retains a
 * parity digest, and never retains the Candidate sequence - so the Worker-local
 * wall time of the run is taken as the enumeration's own cost with nothing
 * subtracted from it.
 *
 * `parity` adds the memory-bounded ordered / set digests and exists only to
 * confirm determinism. Its wall time carries that instrumentation's cost - on a
 * deep-Route workload the second `constrainedCandidateStableKey()` generation
 * dominates - so a `parity` run is never used as a performance measurement.
 *
 * Both modes call the same `visitConstrainedCandidates()` with the same input:
 * the B8-B1 Production API is identical in either mode.
 */
export type ConstrainedEnumerationBenchmarkMode = 'timing' | 'parity'

export interface ConstrainedEnumerationBenchmarkRunRequest {
  readonly type: 'b8_benchmark_run'
  readonly requestId: string
  readonly workloadId: string
  readonly mode: ConstrainedEnumerationBenchmarkMode
  /**
   * Overrides the workload's own bounds when present. The sweeps use the
   * workload bounds; this exists so an ad-hoc tuple can be measured from the
   * console without inventing a new workload id.
   */
  readonly boundsOverride: ConstrainedEnumerationBounds | null
  /**
   * Stop the enumeration from the visitor after this many delivered
   * Candidates, exercising the `visitConstrainedCandidates()` consumer stop.
   * Null runs to completion.
   */
  readonly stopAfterCandidates: number | null
}

export interface ConstrainedEnumerationBenchmarkCancelRequest {
  readonly type: 'b8_benchmark_cancel'
  readonly requestId: string
}

export interface ConstrainedEnumerationBenchmarkPingRequest {
  readonly type: 'b8_benchmark_ping'
  readonly pingId: number
}

export type ConstrainedEnumerationBenchmarkRequest =
  | ConstrainedEnumerationBenchmarkRunRequest
  | ConstrainedEnumerationBenchmarkCancelRequest
  | ConstrainedEnumerationBenchmarkPingRequest

/** The Worker's event loop reached the run request, before any enumeration. */
export interface ConstrainedEnumerationBenchmarkAcceptedResponse {
  readonly type: 'b8_benchmark_accepted'
  readonly requestId: string
}

/** The Worker's event loop processed a cancel message. */
export interface ConstrainedEnumerationBenchmarkCancelAckResponse {
  readonly type: 'b8_benchmark_cancel_ack'
  readonly requestId: string
}

export interface ConstrainedEnumerationBenchmarkPongResponse {
  readonly type: 'b8_benchmark_pong'
  readonly pingId: number
}

/**
 * Everything measured inside the Worker for one completed run.
 *
 * Every timing here is anchored immediately before the
 * `visitConstrainedCandidates()` call. Fixture construction, the Master Data
 * load, and the synthetic source weapons' own Production predictions all happen
 * before that anchor and are therefore excluded: they are benchmark setup, not
 * constrained enumeration cost.
 *
 * The three `timeTo*CandidateMs` values are Worker-local offsets from that same
 * anchor, with the recorder's own accumulated overhead subtracted. They still
 * include the upfront raw stream solve that happens before the first Candidate
 * is delivered: that cost is deliberately not hidden, because B8-B2 measures
 * the enumerator as it is and does not change its algorithm.
 */
export interface ConstrainedEnumerationBenchmarkMeasurement {
  readonly mode: ConstrainedEnumerationBenchmarkMode
  /**
   * Real Worker wall time of the `visitConstrainedCandidates()` call.
   *
   * In `timing` mode the visitor's minimal recording is not worth correcting
   * for, so this is taken as the enumeration's own cost and is the only number
   * the Production defaults are chosen from. In `parity` mode it also contains
   * the digest instrumentation's cost and must not be read as a performance
   * figure.
   */
  readonly workerElapsedMs: number
  /**
   * The accumulated per-Candidate recording work inside the visitor, or null in
   * `timing` mode, whose minimal recorder does no parity instrumentation and so
   * leaves nothing to subtract.
   *
   * In `parity` mode that instrumentation re-derives
   * `constrainedCandidateStableKey()` for its digests while the enumerator has
   * already computed that key for its own semantic dedup. That duplicated cost
   * is measured here so a `parity` run's wall time can be read honestly - not
   * so that a corrected value can stand in for a measurement.
   */
  readonly recorderOverheadMs: number | null
  /**
   * `workerElapsedMs` minus `recorderOverheadMs` in `parity` mode, null in
   * `timing` mode.
   *
   * This is a benchmark-specific corrected value, not a wall-clock reading, and
   * it is never the basis for a Production default: `timing` mode exists so
   * that decision rests on a direct measurement instead of a subtraction.
   */
  readonly enumerationElapsedMs: number | null
  readonly deliveredCandidates: number
  readonly idealCandidates: number
  readonly practicalCandidates: number
  readonly timeToFirstCandidateMs: number | null
  readonly timeToTenthCandidateMs: number | null
  readonly timeToFiftiethCandidateMs: number | null
  /**
   * Ordinal-sensitive digest of the delivered `candidateStableKey` sequence,
   * folded incrementally so no key text is retained. Null in `timing` mode,
   * which generates no keys at all.
   */
  readonly orderedParityKey: string | null
  /**
   * Order-insensitive digest of the same keys, taken over their fixed-length
   * per-key digests rather than over the key text. Null in `timing` mode.
   */
  readonly setParityKey: string | null
  readonly summary: ConstrainedEnumerationSummary
  readonly stoppedByConsumer: boolean
  /** Route kinds present in the delivered Candidates, sorted. */
  readonly routeKinds: readonly string[]
}

export interface ConstrainedEnumerationBenchmarkResultResponse {
  readonly type: 'b8_benchmark_result'
  readonly requestId: string
  readonly bounds: ConstrainedEnumerationBounds
  readonly measurement: ConstrainedEnumerationBenchmarkMeasurement
}

export interface ConstrainedEnumerationBenchmarkCancelledResponse {
  readonly type: 'b8_benchmark_cancelled'
  readonly requestId: string
  /**
   * Worker wall time from the enumeration anchor to the cancelled settle, or
   * null when the run was cancelled before the anchor was reached (during
   * fixture construction, which no measurement covers).
   */
  readonly workerElapsedMs: number | null
  readonly deliveredCandidates: number
}

export interface ConstrainedEnumerationBenchmarkErrorResponse {
  readonly type: 'b8_benchmark_error'
  readonly requestId: string
  readonly message: string
}

export type ConstrainedEnumerationBenchmarkResponse =
  | ConstrainedEnumerationBenchmarkAcceptedResponse
  | ConstrainedEnumerationBenchmarkCancelAckResponse
  | ConstrainedEnumerationBenchmarkPongResponse
  | ConstrainedEnumerationBenchmarkResultResponse
  | ConstrainedEnumerationBenchmarkCancelledResponse
  | ConstrainedEnumerationBenchmarkErrorResponse

export function isConstrainedEnumerationBenchmarkResponse(
  value: unknown,
): value is ConstrainedEnumerationBenchmarkResponse {
  const type = (value as { type?: unknown } | null)?.type
  return typeof type === 'string' && type.startsWith('b8_benchmark_')
}

/**
 * FNV-1a digest plus the source length, the same shape the B5 harness records.
 * It exists so a parity comparison travels as a short string instead of a
 * multi-megabyte key list.
 */
export function benchmarkDigest(value: string): string {
  return finishDigest(foldFnv(FNV_OFFSET, value), value.length)
}

/**
 * The same digest over a sequence, folded without ever building the joined
 * string.
 *
 * `benchmarkDigest(keys.join(' '))` is the natural way to write this and is
 * what the first B8-B2 harness did, but a workload delivering a hundred
 * thousand deep-Route Candidates overflows V8's maximum string length and the
 * run fails with `Invalid string length` after the enumeration has already
 * finished. Folding incrementally keeps the identical value for any input the
 * joined form could represent, and lets the large tuples be measured at all.
 */
export function benchmarkSequenceDigest(values: readonly string[]): string {
  const rolling = createRollingBenchmarkDigest()
  for (const value of values) rolling.add(value)
  return rolling.finish()
}

/**
 * An incremental `benchmarkSequenceDigest()`.
 *
 * Feeding values one at a time lets the caller drop each value immediately, so
 * a run delivering a hundred thousand deep-Route Candidates never holds their
 * key text at all. `finish()` returns exactly what `benchmarkSequenceDigest()`
 * would have returned for the same sequence.
 */
export interface RollingBenchmarkDigest {
  add(value: string): void
  /**
   * `add(value)` and `benchmarkKeyDigest(value)` fused into one character pass.
   *
   * Done separately they scan the value three times - once for the ordered
   * fold and twice for the two per-key hashes - and on a deep-Route workload
   * that is the recorder's dominant cost, which then has to be subtracted back
   * out of the measurement. Folding all three accumulators in one loop keeps
   * the identical results while cutting the correction the benchmark has to
   * apply to its own numbers.
   */
  addAndDigest(value: string): string
  finish(): string
}

export function createRollingBenchmarkDigest(): RollingBenchmarkDigest {
  let hash = FNV_OFFSET
  let length = 0
  let started = false
  const separate = () => {
    if (started) {
      hash = foldFnv(hash, ' ')
      length += 1
    }
    started = true
  }
  return {
    add(value) {
      separate()
      hash = foldFnv(hash, value)
      length += value.length
    },
    addAndDigest(value) {
      separate()
      let fnv = FNV_OFFSET
      let djb2 = DJB2_OFFSET
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        hash = Math.imul(hash ^ code, FNV_PRIME) >>> 0
        fnv = Math.imul(fnv ^ code, FNV_PRIME) >>> 0
        djb2 = (Math.imul(djb2, 33) + code) >>> 0
      }
      length += value.length
      return keyDigest(fnv, djb2, value.length)
    },
    finish: () => finishDigest(hash, length),
  }
}

/**
 * A fixed-length digest of one value, for retaining a set of values without
 * retaining the values.
 *
 * Two independent 32-bit hashes plus the source length, hex-encoded to a
 * constant 24 characters. The set parity digest is taken over these rather than
 * over the `candidateStableKey` text, so the memory the recorder holds grows
 * with the Candidate count alone and not with Route depth. Two independent
 * functions are used because a single 32-bit hash collides at these counts by
 * birthday bound well before the workloads do.
 */
export function benchmarkKeyDigest(value: string): string {
  return keyDigest(
    foldFnv(FNV_OFFSET, value),
    foldDjb2(DJB2_OFFSET, value),
    value.length,
  )
}

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const DJB2_OFFSET = 5381

function foldFnv(hash: number, value: string): number {
  let next = hash
  for (let index = 0; index < value.length; index += 1) {
    next = Math.imul(next ^ value.charCodeAt(index), FNV_PRIME) >>> 0
  }
  return next
}

function foldDjb2(hash: number, value: string): number {
  let next = hash
  for (let index = 0; index < value.length; index += 1) {
    next = (Math.imul(next, 33) + value.charCodeAt(index)) >>> 0
  }
  return next
}

function keyDigest(fnv: number, djb2: number, length: number): string {
  return (
    fnv.toString(16).padStart(8, '0') +
    djb2.toString(16).padStart(8, '0') +
    (length >>> 0).toString(16).padStart(8, '0')
  )
}

function finishDigest(hash: number, length: number): string {
  return `${hash.toString(16).padStart(8, '0')}:${length}`
}
