import { describe, expect, it, vi } from 'vitest'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { createConstrainedEnumerationBenchmarkController } from '../workers/constrainedEnumeration.worker.benchmark'
import { createConstrainedEnumerationBenchmarkHarness } from './constrainedEnumerationBrowserBenchmark'
import {
  benchmarkDigest,
  benchmarkKeyDigest,
  benchmarkSequenceDigest,
  createRollingBenchmarkDigest,
  isConstrainedEnumerationBenchmarkResponse,
  type ConstrainedEnumerationBenchmarkRequest,
  type ConstrainedEnumerationBenchmarkResponse,
} from './constrainedEnumerationBenchmarkProtocol'

/**
 * A Worker stand-in that runs the real benchmark controller with the real
 * `ProductionRngEngine`, so the harness is tested over the same message
 * contract the Browser Worker uses. Messages are delivered asynchronously, as a
 * real Worker delivers them.
 */
class FakeBenchmarkWorker {
  readonly posted: ConstrainedEnumerationBenchmarkRequest[] = []
  readonly terminate = vi.fn()
  private readonly listeners = new Map<string, Array<(event: Event) => void>>()
  private readonly controller = createConstrainedEnumerationBenchmarkController(
    new ProductionRngEngine(),
    (response) => this.emit(response),
  )

  postMessage(message: unknown) {
    const request = message as ConstrainedEnumerationBenchmarkRequest
    this.posted.push(request)
    void Promise.resolve().then(() => this.controller.handleMessage(request))
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    )
  }
  emit(data: ConstrainedEnumerationBenchmarkResponse) {
    for (const listener of [...(this.listeners.get('message') ?? [])]) {
      listener({ data } as unknown as Event)
    }
  }
  fail() {
    for (const listener of [...(this.listeners.get('error') ?? [])]) {
      listener({} as Event)
    }
  }
}

function harnessOverFake() {
  const worker = new FakeBenchmarkWorker()
  return {
    worker,
    harness: createConstrainedEnumerationBenchmarkHarness({
      createWorker: () => worker,
    }),
  }
}

describe('B8 benchmark protocol', () => {
  it('recognizes only its own message shapes', () => {
    expect(
      isConstrainedEnumerationBenchmarkResponse({ type: 'b8_benchmark_result' }),
    ).toBe(true)
    expect(isConstrainedEnumerationBenchmarkResponse({ type: 'progress' })).toBe(false)
    expect(isConstrainedEnumerationBenchmarkResponse(null)).toBe(false)
  })

  it('digests a value stably and separates different values', () => {
    expect(benchmarkDigest('a b')).toBe(benchmarkDigest('a b'))
    expect(benchmarkDigest('a b')).not.toBe(benchmarkDigest('b a'))
  })

  it('folds a sequence to exactly the joined digest without building it', () => {
    expect(benchmarkSequenceDigest(['a', 'b'])).toBe(benchmarkDigest('a b'))
    expect(benchmarkSequenceDigest([])).toBe(benchmarkDigest(''))
    expect(benchmarkSequenceDigest(['ab'])).not.toBe(benchmarkSequenceDigest(['a', 'b']))
  })

  it('rolls a sequence incrementally to the same value', () => {
    const rolling = createRollingBenchmarkDigest()
    for (const value of ['alpha', 'beta', 'gamma']) rolling.add(value)
    expect(rolling.finish()).toBe(benchmarkSequenceDigest(['alpha', 'beta', 'gamma']))
    expect(createRollingBenchmarkDigest().finish()).toBe(benchmarkSequenceDigest([]))
  })

  it('reduces a key to a fixed-length digest that separates different keys', () => {
    // 24 characters regardless of the key length: this is what makes the
    // recorder's retained state independent of Route depth.
    expect(benchmarkKeyDigest('a')).toHaveLength(24)
    expect(benchmarkKeyDigest('a'.repeat(5_000))).toHaveLength(24)
    expect(benchmarkKeyDigest('ab')).toBe(benchmarkKeyDigest('ab'))
    expect(benchmarkKeyDigest('ab')).not.toBe(benchmarkKeyDigest('ba'))
    expect(benchmarkKeyDigest('ab')).not.toBe(benchmarkKeyDigest('abc'))
  })

  it('fuses the rolling fold and the per-key digest into one pass', () => {
    const keys = ['alpha', 'beta', 'gamma']
    const fused = createRollingBenchmarkDigest()
    const separate = createRollingBenchmarkDigest()
    const fusedKeys = keys.map((key) => fused.addAndDigest(key))
    for (const key of keys) separate.add(key)
    // Identical results to doing the two separately; only the cost differs.
    expect(fusedKeys).toEqual(keys.map(benchmarkKeyDigest))
    expect(fused.finish()).toBe(separate.finish())
    expect(fused.finish()).toBe(benchmarkSequenceDigest(keys))
  })

  it('makes the set digest order-insensitive over per-key digests', () => {
    const keys = ['k1', 'k2', 'k3']
    const setOf = (order: readonly string[]) =>
      benchmarkSequenceDigest([...order.map(benchmarkKeyDigest)].sort())
    expect(setOf(keys)).toBe(setOf([...keys].reverse()))
    expect(setOf(keys)).not.toBe(setOf(['k1', 'k2', 'k4']))
  })
})

describe('B8 benchmark Worker path', () => {
  it('passes the workload bounds through to the enumeration', async () => {
    const { harness, worker } = harnessOverFake()
    const result = await harness.run({
      requestId: 'b8.test.bounds',
      workloadId: 'constrained_gogma_10',
    })
    expect(worker.posted[0]).toMatchObject({
      type: 'b8_benchmark_run',
      workloadId: 'constrained_gogma_10',
      boundsOverride: null,
      stopAfterCandidates: null,
    })
    expect(result.outcome.status).toBe('completed')
    if (result.outcome.status !== 'completed') return
    expect(result.outcome.bounds).toEqual({
      maxNormalForgeCount: 1,
      maxGogmaAdvance: 10,
      maxSkillResetCount: 1,
      maxOffAxisPairEvaluations: 0,
    })
    harness.dispose()
  })

  it('honours an explicit bounds override', async () => {
    const { harness } = harnessOverFake()
    const override = {
      maxNormalForgeCount: 1,
      maxGogmaAdvance: 3,
      maxSkillResetCount: 1,
      maxOffAxisPairEvaluations: 0,
    }
    const result = await harness.run({
      requestId: 'b8.test.override',
      workloadId: 'constrained_gogma_10',
      boundsOverride: override,
    })
    expect(result.outcome.status).toBe('completed')
    if (result.outcome.status !== 'completed') return
    expect(result.outcome.bounds).toEqual(override)
    const full = await harness.run({
      requestId: 'b8.test.override.full',
      workloadId: 'constrained_gogma_10',
    })
    if (full.outcome.status !== 'completed') throw new Error('expected completion')
    expect(result.outcome.measurement.deliveredCandidates).toBeLessThan(
      full.outcome.measurement.deliveredCandidates,
    )
    harness.dispose()
  })

  it('transfers the enumeration summary and the stable-key parity digests', async () => {
    const { harness } = harnessOverFake()
    const first = await harness.run({
      requestId: 'b8.test.parity.1',
      workloadId: 'constrained_off_axis_10_100',
      mode: 'parity',
    })
    const second = await harness.run({
      requestId: 'b8.test.parity.2',
      workloadId: 'constrained_off_axis_10_100',
      mode: 'parity',
    })
    if (first.outcome.status !== 'completed' || second.outcome.status !== 'completed') {
      throw new Error('expected completion')
    }
    const measurement = first.outcome.measurement
    expect(measurement.summary.examinedCandidates).toBeGreaterThan(0)
    expect(measurement.summary.exhausted).toBe(false)
    expect(measurement.summary.stoppedByBound).toBe(true)
    expect(measurement.stoppedByConsumer).toBe(false)
    expect(measurement.deliveredCandidates).toBeGreaterThan(0)
    expect(measurement.timeToFirstCandidateMs).not.toBeNull()
    expect(measurement.mode).toBe('parity')
    expect(measurement.recorderOverheadMs).not.toBeNull()
    expect(measurement.enumerationElapsedMs).toBe(
      measurement.workerElapsedMs - (measurement.recorderOverheadMs ?? 0),
    )
    // The enumeration is deterministic, so a rerun of the same input matches
    // both the ordered delivery sequence and the delivered set. The recorder
    // now folds each key away instead of retaining it, so this also fixes that
    // the memory-bounded digests stay run-independent.
    expect(second.outcome.measurement.orderedParityKey).toBe(
      measurement.orderedParityKey,
    )
    expect(second.outcome.measurement.setParityKey).toBe(measurement.setParityKey)
    harness.dispose()
  })

  it('keeps the memory-bounded parity digests stable across many reruns', async () => {
    const { harness } = harnessOverFake()
    const runs = []
    for (const index of [1, 2, 3]) {
      runs.push(
        await harness.run({
          requestId: `b8.test.parity.repeat.${index}`,
          workloadId: 'constrained_combined_10_10_25_25',
          mode: 'parity',
        }),
      )
    }
    const measurements = runs.map((run) => {
      if (run.outcome.status !== 'completed') throw new Error('expected completion')
      return run.outcome.measurement
    })
    expect(new Set(measurements.map((m) => m.orderedParityKey)).size).toBe(1)
    expect(new Set(measurements.map((m) => m.setParityKey)).size).toBe(1)
    expect(new Set(measurements.map((m) => m.deliveredCandidates)).size).toBe(1)
    // The ordered digest is folded over the key text, the set digest over the
    // fixed-length per-key digests, so the two are not the same value.
    expect(measurements[0].orderedParityKey).not.toBe(measurements[0].setParityKey)
    harness.dispose()
  })

  it('excludes fixture construction from the measured elapsed time', async () => {
    const { harness } = harnessOverFake()
    const result = await harness.run({
      requestId: 'b8.test.anchor',
      workloadId: 'constrained_skill_10',
    })
    if (result.outcome.status !== 'completed') throw new Error('expected completion')
    // The Worker builds the fixture, loads Master Data and runs the synthetic
    // sources' own Production predictions before the measurement anchor, so the
    // Worker-local elapsed must stay strictly below the whole round trip.
    expect(result.outcome.measurement.mode).toBe('timing')
    expect(result.outcome.measurement.workerElapsedMs).toBeLessThan(result.roundTripMs)
    expect(result.outcome.measurement.timeToFirstCandidateMs).not.toBeNull()
    expect(result.outcome.measurement.timeToFirstCandidateMs).toBeLessThanOrEqual(
      result.outcome.measurement.workerElapsedMs,
    )
  })

  it('stops at the requested Candidate count and reports the consumer stop', async () => {
    const { harness } = harnessOverFake()
    const stopped = await harness.run({
      requestId: 'b8.test.stop',
      workloadId: 'constrained_skill_10',
      stopAfterCandidates: 3,
    })
    const full = await harness.run({
      requestId: 'b8.test.stop.full',
      workloadId: 'constrained_skill_10',
    })
    if (stopped.outcome.status !== 'completed' || full.outcome.status !== 'completed') {
      throw new Error('expected completion')
    }
    expect(stopped.outcome.measurement.deliveredCandidates).toBe(3)
    expect(stopped.outcome.measurement.stoppedByConsumer).toBe(true)
    expect(stopped.outcome.measurement.summary.exhausted).toBe(false)
    // A consumer stop ends the enumeration, so it evaluates strictly less than
    // the complete run does.
    expect(stopped.outcome.measurement.summary.examinedCandidates).toBeLessThan(
      full.outcome.measurement.summary.examinedCandidates,
    )
    harness.dispose()
  })

  it('reports a cancelled run separately from a completed one', async () => {
    const worker = new FakeBenchmarkWorker()
    const harness = createConstrainedEnumerationBenchmarkHarness({
      createWorker: () => worker,
    })
    const run = harness.run({
      requestId: 'b8.test.cancel',
      workloadId: 'constrained_gogma_100',
    })
    worker.postMessage({ type: 'b8_benchmark_cancel', requestId: 'b8.test.cancel' })
    const result = await run
    expect(result.outcome.status).toBe('cancelled')
    harness.dispose()
  })

  it('reports an enumeration error instead of hanging', async () => {
    const { harness } = harnessOverFake()
    const result = await harness.run({
      requestId: 'b8.test.error',
      workloadId: 'no_such_workload',
    })
    expect(result.outcome.status).toBe('error')
    if (result.outcome.status !== 'error') return
    expect(result.outcome.message).toContain('no_such_workload')
    harness.dispose()
  })

  it('fails a pending run closed when the Worker itself errors', async () => {
    const worker = new FakeBenchmarkWorker()
    const harness = createConstrainedEnumerationBenchmarkHarness({
      createWorker: () => worker,
    })
    const run = harness.run({
      requestId: 'b8.test.worker-error',
      workloadId: 'constrained_gogma_100',
    })
    worker.fail()
    const result = await run
    expect(result.outcome.status).toBe('error')
    harness.dispose()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('defaults to timing mode and does no parity instrumentation', async () => {
    const { harness, worker } = harnessOverFake()
    const result = await harness.run({
      requestId: 'b8.test.timing.default',
      workloadId: 'constrained_off_axis_10_100',
    })
    expect(worker.posted[0]).toMatchObject({ mode: 'timing' })
    if (result.outcome.status !== 'completed') throw new Error('expected completion')
    const measurement = result.outcome.measurement
    expect(measurement.mode).toBe('timing')
    // A timing run does no parity instrumentation: no key is generated and no
    // digest is built, so the corrected fields and both parity digests are
    // absent by construction and nothing is subtracted from the wall time.
    expect(measurement.recorderOverheadMs).toBeNull()
    expect(measurement.enumerationElapsedMs).toBeNull()
    expect(measurement.orderedParityKey).toBeNull()
    expect(measurement.setParityKey).toBeNull()
    harness.dispose()
  })

  it('reports the same Candidate semantics in timing and parity mode', async () => {
    const { harness } = harnessOverFake()
    const timing = await harness.run({
      requestId: 'b8.test.mode.timing',
      workloadId: 'constrained_combined_10_10_25_25',
      mode: 'timing',
    })
    const parity = await harness.run({
      requestId: 'b8.test.mode.parity',
      workloadId: 'constrained_combined_10_10_25_25',
      mode: 'parity',
    })
    if (timing.outcome.status !== 'completed' || parity.outcome.status !== 'completed') {
      throw new Error('expected completion')
    }
    // Both modes drive the identical enumeration; only the visitor differs, so
    // a timing run measures the same work a parity run confirms.
    expect(timing.outcome.measurement.deliveredCandidates).toBe(
      parity.outcome.measurement.deliveredCandidates,
    )
    expect(timing.outcome.measurement.routeKinds).toEqual(
      parity.outcome.measurement.routeKinds,
    )
    expect(timing.outcome.measurement.summary).toEqual(
      parity.outcome.measurement.summary,
    )
    harness.dispose()
  })

  it('honours a consumer stop in timing mode too', async () => {
    const { harness } = harnessOverFake()
    const result = await harness.run({
      requestId: 'b8.test.timing.stop',
      workloadId: 'constrained_skill_10',
      stopAfterCandidates: 3,
    })
    if (result.outcome.status !== 'completed') throw new Error('expected completion')
    expect(result.outcome.measurement.deliveredCandidates).toBe(3)
    expect(result.outcome.measurement.summary.examinedCandidates).toBe(3)
    expect(result.outcome.measurement.stoppedByConsumer).toBe(true)
    harness.dispose()
  })

  it('answers a ping from the Worker event loop', async () => {
    const { harness } = harnessOverFake()
    await expect(harness.ping(5_000)).resolves.not.toBeNull()
    harness.dispose()
  })
})
