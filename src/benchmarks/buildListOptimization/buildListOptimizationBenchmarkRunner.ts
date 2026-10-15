import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { PlannerInput } from '../../domain/planner'
import type { BuildListOptimizationResult, BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import {
  createBuildListOptimizationWorkerClient,
  type BuildListOptimizationPageLifecycle,
  type BuildListOptimizationRunFailure,
  type BuildListOptimizationRunHandle,
  type BuildListOptimizationWorkerEvent,
  type BuildListOptimizationWorkerLike,
} from '../../services/planner/buildListOptimizationWorkerClient'
import { createBuildListOptimizationBenchmarkBoundsMessage } from '../../workers/buildListOptimization.worker.benchmark'
import type { BuildListOptimizationWorkerRequest } from '../../workers/buildListOptimizationWorkerContracts'
import { prepareBloBenchmarkInput } from './buildListOptimizationBenchmarkInput'
import {
  BLO_BENCHMARK_CONFIG_PROTOCOL,
  BLO_BROWSER_RECORD_KIND,
  BLO_BROWSER_RECORD_PROTOCOL,
  BLO_WORKER_PROTOCOL,
  bloSlotSpecIssues,
  type BloInputIdentity,
  type BloMemoryReading,
  type BloRecordExport,
  type BloRunFailure,
  type BloRunRecord,
  type BloSlotSpec,
  type BloStorageSnapshot,
  type BloTimeline,
} from './buildListOptimizationBenchmarkProtocol'
import { bloResultView, type BloSha256Text } from './buildListOptimizationBenchmarkSemantic'

/**
 * Issue #260 PR-5A: the main-thread runner of one Browser measurement run (benchmark only).
 *
 * The run is the Production one end to end: the Production Worker Client (`createBuildListOptimizationWorkerClient()`, its lifecycle,
 * its protocol checks and its structural result check) over the benchmark-only measurement Worker, whose controller, Production
 * adapter, Engine, ID factory and Clock are the Production Worker's. The only additions are around it, never inside it:
 *
 * - the measurement Worker gets the slot's bounds in its benchmark configuration message before the Client's `blo_run` (the run
 *   request carries no bound);
 * - a thin wrapper of the Worker object timestamps what the main thread does and receives (creation, the request's serialization,
 *   each progress, the terminal message and the Client's handling of it) and forwards every message unchanged, except in a synthetic
 *   `lifecycle` run that injects a fault on purpose;
 * - the harness cancels through the Client's own `cancel()` when a cancel trigger fires (or the page's cancel button is pressed);
 * - fixed-point memory readings, long tasks, page lifecycle events and storage snapshots are observed around the run.
 *
 * After the outcome the harness projects the result into its minimized view and fingerprints (`bloResultView()`), keeps the record
 * and drops the result and the input. Nothing is persisted, retried or compared with an expected value here.
 */

/** The Worker object of one run, as the harness sees it (a real `Worker` in the page, a fake in tests). */
export interface BloRawWorker {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: BuildListOptimizationWorkerEvent) => void): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: BuildListOptimizationWorkerEvent) => void): void
  terminate(): void
}

export interface BloLongTaskSummary {
  observed: boolean
  /** Long tasks observed, with start times relative to the run's start. */
  entries: { startMs: number; durationMs: number }[]
}

export interface BloRunnerPorts {
  master: MasterDataRoot
  /** Creates the benchmark measurement Worker (`buildListOptimization.worker.benchmark.entry.ts`). */
  createMeasurementWorker(): BloRawWorker
  /** Monotonic milliseconds (`performance.now()`). */
  now(): number
  /** Wall-clock ISO time. */
  isoNow(): string
  sha256Text: BloSha256Text
  sleep(ms: number): Promise<void>
  /** Schedules `callback` after `ms`; returns a cancel function. */
  schedule(callback: () => void, ms: number): () => void
  environment(): BloRunRecord['environment']
  build(): unknown
  readMemory(label: BloMemoryReading['label'], atMs: number): Promise<BloMemoryReading>
  readStorage(): Promise<BloStorageSnapshot>
  /** Starts observing long tasks; `stop()` returns every long task observed since, with start times relative to `originMs`. */
  observeLongTasks(originMs: number): { stop(): BloLongTaskSummary }
  /** Observes page lifecycle events (visibility, freeze, resume, pagehide); returns the unsubscribe function. */
  observeLifecycle(listener: (type: string, visibilityState: string | null) => void): () => void
  /** The Client's `pagehide` source (the page's `window`; null in tests). */
  pageLifecycle: BuildListOptimizationPageLifecycle | null
  /** How long the harness keeps listening for messages of a settled run's Worker. */
  lateMessageWaitMs: number
}

export interface BloCurrentRun {
  slotId: string
  purpose: BloSlotSpec['purpose']
  lastStage: BuildListOptimizationStage | null
  startedAt: string
}

export interface BloBenchmarkRunner {
  /** Runs one slot. Refuses (throws) an invalid slot or a second run while one is running; every started run yields a record. */
  run(spec: BloSlotSpec, input: { text: string; identity: BloInputIdentity }): Promise<BloRunRecord>
  /** Cancels the running run through the Client (a manual cancel of the page; the record keeps it as `cancelled`). */
  cancelCurrent(): boolean
  current(): BloCurrentRun | null
  records(): BloRunRecord[]
  exportJson(): string
  clear(): void
}

function failureView(failure: BuildListOptimizationRunFailure): BloRunFailure {
  switch (failure.kind) {
    case 'worker_unavailable':
    case 'worker_start_failed':
      return { kind: failure.kind }
    case 'calculation_error':
      return { kind: 'calculation_error', code: failure.code, domainCode: failure.domainCode, stage: failure.stage }
    case 'worker_error':
    case 'worker_message_error':
      return { kind: failure.kind }
    case 'protocol_violation':
    case 'invalid_result':
      return { kind: failure.kind, issueCount: failure.issues.length }
  }
}

const emptyTimeline = (): BloTimeline => ({
  inputPreparedAtMs: null, workerCreateStartedAtMs: null, workerCreatedAtMs: null, boundsPostedAtMs: null, runPostStartedAtMs: null, runPostedAtMs: null,
  progress: [], terminalReceivedAtMs: null, terminalType: null, terminalDataReadMs: null, clientHandlingMs: null, cancelRequestedAtMs: null, outcomeAtMs: null, finishedAtMs: null,
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What one run holds while it runs; the input and the result are released before the `after_release` reading. */
interface RunState {
  readonly spec: BloSlotSpec
  readonly current: BloCurrentRun
  readonly t0: number
  readonly at: () => number
  readonly timeline: BloTimeline
  handle: BuildListOptimizationRunHandle | null
  settled: boolean
  readonly lateTypes: string[]
}

export function createBloBenchmarkRunner(ports: BloRunnerPorts): BloBenchmarkRunner {
  const sessionToken = `s${Math.floor(ports.now()).toString(36)}`
  let sequence = 0
  let records: BloRunRecord[] = []
  let active: RunState | null = null

  const cancelActive = (state: RunState): boolean => {
    if (state.handle === null || state.settled) return false
    state.timeline.cancelRequestedAtMs ??= state.at()
    state.handle.cancel()
    return true
  }

  /** The wrapper of the run's Worker: timestamps around the real Worker object, every message forwarded unchanged (a lifecycle fault aside). */
  const workerFactory = (state: RunState, onProgress: (stage: BuildListOptimizationStage) => void) => (): BuildListOptimizationWorkerLike => {
    const { spec, timeline, at } = state
    timeline.workerCreateStartedAtMs = at()
    const raw = ports.createMeasurementWorker()
    timeline.workerCreatedAtMs = at()
    if (spec.faultInjection === 'worker_error') {
      // A first message that names no requestId: the Production controller cannot answer it and throws, which the main thread observes
      // as the Worker's `error` event (the Client's `worker_error`).
      raw.postMessage({ type: 'blo_benchmark_fault_probe' })
    } else {
      raw.postMessage(createBuildListOptimizationBenchmarkBoundsMessage(spec.bounds))
    }
    timeline.boundsPostedAtMs = at()
    // The harness's own listener stays after the Client detached: it counts what the Worker still delivered after the outcome.
    raw.addEventListener('message', (event) => {
      if (!state.settled) return
      const data: unknown = event.data
      state.lateTypes.push(isRecord(data) && typeof data.type === 'string' ? data.type : typeof data)
    })
    const wrapped = new Map<(event: BuildListOptimizationWorkerEvent) => void, (event: BuildListOptimizationWorkerEvent) => void>()
    return {
      postMessage: (request: BuildListOptimizationWorkerRequest) => {
        timeline.runPostStartedAtMs = at()
        // A `worker_error` lifecycle run withholds the request, so the Worker's only reaction is the error of the fault probe (the
        // run ends with the Client's `worker_error` in every environment, never racing a `blo_error` of the request).
        if (spec.faultInjection !== 'worker_error') raw.postMessage(request)
        timeline.runPostedAtMs = at()
      },
      addEventListener: (type, listener) => {
        if (type !== 'message') {
          raw.addEventListener(type, listener)
          return
        }
        const forward = (event: BuildListOptimizationWorkerEvent) => {
          const receivedAt = at()
          const data: unknown = event.data
          const readMs = at() - receivedAt
          const kind = isRecord(data) ? data.type : null
          if (kind === 'blo_progress' && typeof (data as { stage?: unknown }).stage === 'string' && !state.settled) {
            const stage = (data as { stage: BuildListOptimizationStage }).stage
            timeline.progress.push({ stage, receivedAtMs: receivedAt })
            onProgress(stage)
          }
          const terminal = (kind === 'blo_result' || kind === 'blo_error') && timeline.terminalReceivedAtMs === null && !state.settled
          if (terminal) {
            timeline.terminalReceivedAtMs = receivedAt
            timeline.terminalType = kind
            timeline.terminalDataReadMs = readMs
          }
          const delivered = spec.faultInjection === 'corrupt_result' && kind === 'blo_result'
            ? { ...(data as Record<string, unknown>), result: { status: 'corrupted_by_benchmark' } }
            : data
          const handlingStarted = at()
          listener({ data: delivered })
          if (terminal) timeline.clientHandlingMs = at() - handlingStarted
        }
        wrapped.set(listener, forward)
        raw.addEventListener('message', forward)
      },
      removeEventListener: (type, listener) => {
        if (type !== 'message') {
          raw.removeEventListener(type, listener)
          return
        }
        const forward = wrapped.get(listener)
        if (forward !== undefined) raw.removeEventListener('message', forward)
      },
      terminate: () => raw.terminate(),
    }
  }

  const runStarted = async (state: RunState, input: { text: string; identity: BloInputIdentity }): Promise<BloRunRecord> => {
    const { spec, current, timeline, at } = state
    const integrityIssues: string[] = []
    const interruptions: BloRunRecord['interruptions'] = []
    const memory: BloMemoryReading[] = []
    const stopLifecycle = ports.observeLifecycle((type, visibilityState) => interruptions.push({ type, atMs: at(), visibilityState }))
    try {
      const environment = ports.environment()
      const storageBefore = await ports.readStorage().catch(() => null)
      if (spec.memory?.fixedPoints) memory.push(await ports.readMemory('before_input', at()))

      // The input, with the Production meaning (`prepareBloBenchmarkInput()`), timed apart from every calculation interval.
      const prepared = await prepareBloBenchmarkInput(input.text, ports.master, ports.now)
      timeline.inputPreparedAtMs = at()
      const preparation = prepared.preparation
      const held: { plannerInput: PlannerInput | null; result: BuildListOptimizationResult | null } = {
        plannerInput: prepared.status === 'ready' ? prepared.plannerInput : null, result: null,
      }
      let outcomeView: BloRunRecord['outcome'] = { status: 'not_run', failure: null, cancelReason: null, lastStage: null }
      let longTaskEntries: { startMs: number; durationMs: number }[] = []
      let longTaskObserved = false
      if (held.plannerInput !== null) {
        if (spec.memory?.fixedPoints) memory.push(await ports.readMemory('before_run', at()))
        const tasks = ports.observeLongTasks(state.t0)
        const stopTimers: (() => void)[] = []
        let cancelArmed = spec.cancelTrigger !== null
        const onProgress = (stage: BuildListOptimizationStage) => {
          current.lastStage = stage
          const trigger = spec.cancelTrigger
          if (!cancelArmed || trigger === null || stage !== trigger.stage) return
          cancelArmed = false
          stopTimers.push(ports.schedule(() => {
            if (state.settled || state.handle === null) return
            timeline.cancelRequestedAtMs = at()
            state.handle.cancel()
          }, trigger.delayMs))
        }
        const client = createBuildListOptimizationWorkerClient({ createWorker: workerFactory(state, onProgress), pageLifecycle: ports.pageLifecycle })
        try {
          state.handle = client.run(held.plannerInput)
          const outcome = await state.handle.outcome
          state.settled = true
          timeline.outcomeAtMs = at()
          outcomeView = {
            status: outcome.status,
            failure: outcome.status === 'failed' ? failureView(outcome.failure) : null,
            cancelReason: outcome.status === 'cancelled' ? outcome.reason : null,
            lastStage: current.lastStage,
          }
          if (outcome.status === 'completed') held.result = outcome.result
        } catch (error) {
          integrityIssues.push(`The Client refused the run: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          state.settled = true
          timeline.outcomeAtMs ??= at()
          for (const stop of stopTimers) stop()
          const summary = tasks.stop()
          longTaskObserved = summary.observed
          longTaskEntries = summary.entries
          client.dispose()
          state.handle = null
        }
      }

      // Post-processing (never part of a calculation interval): the minimized result, memory, late messages, storage.
      const result = held.result === null ? null : await bloResultView(held.result, ports.sha256Text)
      if (spec.memory?.fixedPoints && prepared.status === 'ready') memory.push(await ports.readMemory('after_outcome', at()))
      held.result = null
      held.plannerInput = null
      if (prepared.status === 'ready') {
        await ports.sleep(ports.lateMessageWaitMs)
        if (spec.memory?.fixedPoints) {
          await ports.sleep(spec.memory.gcWaitMs)
          memory.push(await ports.readMemory('after_release', at()))
        }
      }
      const storageAfter = await ports.readStorage().catch(() => null)
      timeline.finishedAtMs = at()

      if (prepared.status === 'ready') {
        if (outcomeView.status === 'not_run') integrityIssues.push('The run produced no outcome.')
        if (timeline.progress.length > 0 && timeline.progress[0]!.stage !== 'input_check') integrityIssues.push('The first progress was not input_check.')
        if (outcomeView.status === 'completed' && timeline.terminalType !== 'blo_result') integrityIssues.push('A completed run without a received blo_result.')
        if (outcomeView.status === 'cancelled' && outcomeView.cancelReason === 'cancelled' && timeline.cancelRequestedAtMs === null) integrityIssues.push('A cancelled run without a recorded cancel request.')
      }
      const durations = longTaskEntries.filter(entry => timeline.outcomeAtMs === null || entry.startMs <= timeline.outcomeAtMs).map(entry => entry.durationMs)
      sequence += 1
      return {
        kind: BLO_BROWSER_RECORD_KIND,
        recordProtocol: BLO_BROWSER_RECORD_PROTOCOL,
        recordId: `${sessionToken}#${sequence}`,
        sequence,
        startedAt: current.startedAt,
        endedAt: ports.isoNow(),
        slot: {
          slotId: spec.slotId, purpose: spec.purpose, planned: spec.planned, inputId: spec.inputId, boundsId: spec.boundsId,
          cancelTrigger: spec.cancelTrigger === null ? null : { ...spec.cancelTrigger }, faultInjection: spec.faultInjection, memory: spec.memory === null ? null : { ...spec.memory },
        },
        bounds: structuredClone(spec.bounds),
        protocols: { worker: BLO_WORKER_PROTOCOL, benchmarkConfig: BLO_BENCHMARK_CONFIG_PROTOCOL },
        build: ports.build(),
        environment,
        input: { identity: { ...input.identity }, preparation },
        timeline,
        outcome: outcomeView,
        result,
        lateMessages: { count: state.lateTypes.length, types: [...new Set(state.lateTypes)].sort() },
        memory,
        mainThread: {
          longTaskObserved,
          longTaskCount: longTaskObserved ? durations.length : null,
          longTaskMaxMs: longTaskObserved ? (durations.length === 0 ? 0 : Math.max(...durations)) : null,
          longTaskTotalMs: longTaskObserved ? durations.reduce((sum, value) => sum + value, 0) : null,
        },
        interruptions,
        storage: { before: storageBefore, after: storageAfter },
        integrityIssues,
      }
    } finally {
      stopLifecycle()
    }
  }

  return {
    run: async (spec, input) => {
      const specIssues = bloSlotSpecIssues(spec)
      if (specIssues.length > 0) throw new Error(`Invalid slot: ${specIssues.join(' ')}`)
      if (active !== null) throw new Error('A run is already running.')
      const t0 = ports.now()
      const state: RunState = {
        spec: structuredClone(spec),
        current: { slotId: spec.slotId, purpose: spec.purpose, lastStage: null, startedAt: ports.isoNow() },
        t0,
        at: () => ports.now() - t0,
        timeline: emptyTimeline(),
        handle: null,
        settled: false,
        lateTypes: [],
      }
      active = state
      try {
        const record = await runStarted(state, input)
        records = [...records, record]
        return record
      } finally {
        active = null
      }
    },
    cancelCurrent: () => (active === null ? false : cancelActive(active)),
    current: () => (active === null ? null : { ...active.current }),
    records: () => [...records],
    exportJson: () => {
      const value: BloRecordExport = { kind: 'build-list-optimization-browser-records', recordProtocol: BLO_BROWSER_RECORD_PROTOCOL, exportedAt: ports.isoNow(), records }
      return JSON.stringify(value, null, 2) + '\n'
    },
    clear: () => {
      records = []
    },
  }
}
