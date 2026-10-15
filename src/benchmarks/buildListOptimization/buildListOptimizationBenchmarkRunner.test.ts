import { describe, expect, it } from 'vitest'
import { BUILD_LIST_OPTIMIZATION_RUN_REQUEST_KEYS } from '../../workers/buildListOptimizationWorkerContracts'
import { bloRunRecordIssues, readBloRecordExport } from './buildListOptimizationBenchmarkProtocol'
import { createBloBenchmarkRunner } from './buildListOptimizationBenchmarkRunner'
import { createTestRunnerPorts, testInput, testSlot } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the main-thread runner over the real benchmark Worker logic (in process): the Production Client, the measurement
 * Worker's bounds message before the Client's run request, the timeline, the typed outcome of every result class, the cancel trigger,
 * the lifecycle faults, the memory fixed points and the minimized record.
 */

describe('Build List optimization Browser measurement runner (Issue #260 PR-5A)', () => {
  it('runs the Production calculation with the slot bounds in the benchmark message and records an optimized result', async () => {
    const ports = createTestRunnerPorts()
    const runner = createBloBenchmarkRunner(ports)
    const record = await runner.run(testSlot(), await testInput())
    expect(bloRunRecordIssues(record)).toEqual([])
    expect(record.outcome).toEqual({ status: 'completed', failure: null, cancelReason: null, lastStage: 'plan_verification' })
    expect(record.result).toMatchObject({ status: 'optimized', planningTargetCount: 3, completedTargetCount: 3, physicalOperationCount: 7, structuralObjective: 7, conflictCount: 0 })
    expect(record.result!.semantic.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(record.result!.semantic.components)).toContain('steps')
    expect(record.result!.diagnostics!.workerStageMs).toEqual(expect.objectContaining({ input_check: expect.any(Number), plan_verification: expect.any(Number) }))
    // One Worker: the benchmark bounds message first, then the Client's own run request, which carries no bound.
    expect(ports.workers).toHaveLength(1)
    const [bounds, request] = ports.workers[0]!.posted as Record<string, unknown>[]
    expect(bounds).toEqual({ type: 'blo_benchmark_bounds', protocolVersion: 'build-list-optimization-benchmark:1', bounds: testSlot().bounds })
    expect(Object.keys(request!).sort()).toEqual([...BUILD_LIST_OPTIMIZATION_RUN_REQUEST_KEYS].sort())
    expect(request!.type).toBe('blo_run')
    expect((request!.input as { conflictResolutions: unknown[] }).conflictResolutions).toEqual([])
    expect(ports.workers[0]!.isTerminated()).toBe(true)
    // The timeline is ordered and the stages arrive from input_check.
    const t = record.timeline
    expect(t.progress.map(receipt => receipt.stage)).toEqual(['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification'])
    for (const [earlier, later] of [[t.inputPreparedAtMs, t.workerCreateStartedAtMs], [t.workerCreateStartedAtMs, t.boundsPostedAtMs], [t.boundsPostedAtMs, t.runPostedAtMs], [t.runPostedAtMs, t.terminalReceivedAtMs], [t.terminalReceivedAtMs, t.outcomeAtMs]]) {
      expect(earlier).not.toBeNull()
      expect(later!).toBeGreaterThanOrEqual(earlier!)
    }
    expect(t.terminalType).toBe('blo_result')
    expect(record.input.preparation).toMatchObject({ status: 'ready', counts: { targetWeapons: 3, buildListEntries: 3, ownedWeapons: 3, normalCounters: 3 }, draftPresent: false })
    expect(record.integrityIssues).toEqual([])
    // The record leaks no identity of the run: no UUID (Plan / Step / reserved weapon IDs come from the Production ID factory).
    expect(JSON.stringify(record)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(JSON.stringify(record)).not.toMatch(/target\.issue103|build-list\.fnv1a32|51231782/)
  }, 60_000)

  it('gives the same semantic fingerprint to two runs on new Workers, and records each result class', async () => {
    const runner = createBloBenchmarkRunner(createTestRunnerPorts())
    const input = await testInput()
    const first = await runner.run(testSlot({ slotId: 'a' }), input)
    const second = await runner.run(testSlot({ slotId: 'b' }), input)
    expect(second.result!.semantic).toEqual(first.result!.semantic)
    const bound = await runner.run(testSlot({ slotId: 'c', boundsId: 'synthetic.node-budget-1' }), input)
    expect(bound.result).toMatchObject({ status: 'search_bound_reached', boundKinds: ['structural_search_node_budget'] })
    const unsupported = await runner.run(testSlot({ slotId: 'd' }), await testInput('synthetic.sanity-3.duplicate-entry'))
    expect(unsupported.result).toMatchObject({ status: 'unsupported', unsupportedReasonKinds: ['invalid_planner_input'], diagnostics: null })
    expect(unsupported.result!.semantic.sha256).not.toBe(first.result!.semantic.sha256)
    const exported = readBloRecordExport(JSON.parse(runner.exportJson()))
    expect(exported.issues).toEqual([])
    expect(exported.records.map(record => record.slot.slotId)).toEqual(['a', 'b', 'c', 'd'])
    runner.clear()
    expect(runner.records()).toEqual([])
  }, 60_000)

  it('cancels through the Client when the trigger fires: no result, the Worker terminated, nothing applied afterwards', async () => {
    // In process the calculation never yields to the event loop (a real Worker runs on its own thread), so the trigger's timer runs at
    // once here; the asynchronous cancel of a real Worker is the Browser mechanics check's (docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md).
    const ports = createTestRunnerPorts({
      lateMessageWaitMs: 50,
      schedule: (callback) => {
        callback()
        return () => undefined
      },
    })
    const runner = createBloBenchmarkRunner(ports)
    const record = await runner.run(testSlot({ slotId: 'cancel', purpose: 'cancel', boundsId: 'synthetic.wide-window', cancelTrigger: { stage: 'input_check', delayMs: 0 } }), await testInput())
    expect(bloRunRecordIssues(record)).toEqual([])
    expect(record.outcome).toMatchObject({ status: 'cancelled', cancelReason: 'cancelled', failure: null })
    expect(record.result).toBeNull()
    expect(record.timeline.cancelRequestedAtMs).not.toBeNull()
    expect(record.timeline.outcomeAtMs! - record.timeline.cancelRequestedAtMs!).toBeLessThan(50)
    expect(ports.workers[0]!.isTerminated()).toBe(true)
    expect(record.integrityIssues).toEqual([])
    // A new run after the cancel completes on a new Worker.
    const rerun = await runner.run(testSlot({ slotId: 'rerun', boundsId: 'synthetic.wide-window' }), await testInput())
    expect(rerun.result?.status).toBe('optimized')
    expect(ports.workers).toHaveLength(2)
  }, 60_000)

  it('records the lifecycle faults as failed runs, never as results', async () => {
    const runner = createBloBenchmarkRunner(createTestRunnerPorts())
    const input = await testInput()
    const error = await runner.run(testSlot({ slotId: 'error', purpose: 'lifecycle', faultInjection: 'worker_error' }), input)
    expect(error.outcome).toMatchObject({ status: 'failed', failure: { kind: 'worker_error' } })
    expect(error.result).toBeNull()
    const corrupt = await runner.run(testSlot({ slotId: 'corrupt', purpose: 'lifecycle', faultInjection: 'corrupt_result' }), input)
    expect(corrupt.outcome).toMatchObject({ status: 'failed', failure: { kind: 'invalid_result' } })
    expect(corrupt.result).toBeNull()
    expect(corrupt.timeline.terminalType).toBe('blo_result')
    for (const record of [error, corrupt]) expect(bloRunRecordIssues(record)).toEqual([])
  }, 60_000)

  it('refuses an input the Production path refuses, before any Worker', async () => {
    const ports = createTestRunnerPorts()
    const runner = createBloBenchmarkRunner(ports)
    const record = await runner.run(testSlot(), { text: '{ not json', identity: { kind: 'export', fileName: 'broken.json', bytes: 10, sha256: 'f'.repeat(64) } })
    expect(record.outcome.status).toBe('not_run')
    expect(record.input.preparation).toMatchObject({ status: 'refused', refusal: { code: 'invalid_json' } })
    expect(ports.workers).toHaveLength(0)
    expect(bloRunRecordIssues(record)).toEqual([])
  })

  it('takes fixed-point memory readings only for a memory slot, and refuses an invalid slot or a second run', async () => {
    const ports = createTestRunnerPorts()
    const runner = createBloBenchmarkRunner(ports)
    const memory = { fixedPoints: true, gcWaitMs: 0, cdpWorkerHeap: false, osProcessMemory: false }
    const record = await runner.run(testSlot({ slotId: 'memory', purpose: 'memory', memory }), await testInput())
    expect(record.memory.map(reading => reading.label)).toEqual(['before_input', 'before_run', 'after_outcome', 'after_release'])
    await expect(runner.run(testSlot({ faultInjection: 'worker_error' }), await testInput())).rejects.toThrow(/lifecycle run only/)
    const pending = runner.run(testSlot({ slotId: 'one' }), await testInput())
    await expect(runner.run(testSlot({ slotId: 'two' }), await testInput())).rejects.toThrow(/already running/)
    expect((await pending).outcome.status).toBe('completed')
    expect(runner.current()).toBeNull()
  }, 60_000)
})
