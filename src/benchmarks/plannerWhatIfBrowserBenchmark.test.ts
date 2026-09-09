import { describe, expect, it, vi } from 'vitest'
import type { PlannerWhatIfCalculationResult } from '../domain/planner'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { createPlannerWhatIfBenchmarkFixture } from './plannerWhatIfBenchmarkFixtures'
import { runPlannerWhatIfBenchmark } from './plannerWhatIfBrowserBenchmark'

const bounds = { maxCandidateTrialsPerCategoryPerTarget: 4, maxPlannerReruns: 16 }
const options = { requestId: 'contract-only', workloadId: 'what_if_two_targets', bounds }
const fixture = createPlannerWhatIfBenchmarkFixture(options.workloadId)
const completed: PlannerWhatIfCalculationResult = {
  status: 'completed', comparison: {
    conflictKey: fixture.scenarioResolution.conflictKey,
    fixedBuildListEntryId: fixture.scenarioResolution.selectedBuildListEntryId,
    fixedTargetWeaponId: fixture.plannerInput.targetWeapons[0].id,
    alternatives: [],
  },
}
function fakeClient(): PlannerWorkerClient {
  return {
    engineVersion: 'contract-test-only',
    createPlan: vi.fn(() => { throw new Error('Must not call ordinary Planner') }),
    createConstrainedPlan: vi.fn(() => { throw new Error('Must not call B8 orchestration') }),
    createWhatIfComparison: vi.fn(async () => completed),
    prepareInteraction: vi.fn(() => { throw new Error('Must not prepare interaction') }),
    cancelPlan: vi.fn(), dispose: vi.fn(),
  }
}

// Fake clocks and Clients check boundaries only; none are performance evidence.
describe('B9 Browser harness contract', () => {
  it('times only the what-if Promise and disposes before normalization', async () => {
    const order: string[] = []
    const client = fakeClient()
    let settle!: (value: PlannerWhatIfCalculationResult) => void
    client.createWhatIfComparison = vi.fn<PlannerWorkerClient['createWhatIfComparison']>((_id, _request, callbacks) => {
      order.push('request')
      callbacks?.onProgress?.({ expandedStates: 1, maxExpandedStates: 100 })
      callbacks?.onProgress?.({ expandedStates: 1, maxExpandedStates: 100 })
      return new Promise((resolve) => { settle = resolve })
    })
    client.dispose = vi.fn(() => { order.push('dispose') })
    const observedResult: PlannerWhatIfCalculationResult = {
      ...completed,
      get status() { order.push('normalize'); return 'completed' as const },
    }
    const now = vi.fn().mockImplementationOnce(() => { order.push('start'); return 100 })
      .mockImplementationOnce(() => { order.push('end'); return 107 })
    const promise = runPlannerWhatIfBenchmark(options, {
      now,
      createFixture: (id) => { expect(id).toBe(options.workloadId); order.push('fixture'); return fixture },
      createClient: () => { order.push('client'); return client },
    })
    expect(order).toEqual(['fixture', 'client', 'start', 'request'])
    expect(now).toHaveBeenCalledTimes(1)
    const request = vi.mocked(client.createWhatIfComparison).mock.calls[0][1]
    expect(Object.keys(request)).toEqual(['plannerInput', 'scenarioResolution', 'bounds'])
    expect(request.bounds).toBe(bounds)
    expect(request.plannerInput).toBe(fixture.plannerInput)
    expect(request.scenarioResolution).toBe(fixture.scenarioResolution)
    expect(request).not.toHaveProperty('enumerationBounds')
    settle(observedResult)
    const result = await promise
    expect(order.slice(0, 6)).toEqual(['fixture', 'client', 'start', 'request', 'end', 'dispose'])
    expect(order.indexOf('normalize')).toBeGreaterThan(order.indexOf('dispose'))
    expect(now).toHaveBeenCalledTimes(2)
    expect(result.roundTripMs).toBe(7) // Artificial clock assertion only.
    expect(result.progressEvents).toBe(2)
    expect(result).not.toHaveProperty('progressTrace')
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(client.dispose).toHaveBeenCalledExactlyOnceWith()
  })

  it('creates and disposes a different Client for each run', async () => {
    const clients: PlannerWorkerClient[] = []
    const createClient = vi.fn(() => { const client = fakeClient(); clients.push(client); return client })
    for (let index = 0; index < 2; index += 1) {
      await runPlannerWhatIfBenchmark(options, { createClient, createFixture: () => fixture })
    }
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(clients[0]).not.toBe(clients[1])
    clients.forEach((client) => expect(client.dispose).toHaveBeenCalledTimes(1))
  })

  it.each([false, true])('disposes on Worker error (synchronous=%s) without fallback', async (synchronous) => {
    const client = fakeClient()
    const failure = new Error('Worker failure')
    client.createWhatIfComparison = vi.fn(() => {
      if (synchronous) throw failure
      return Promise.reject(failure)
    })
    const order: string[] = []
    const now = () => { order.push('clock'); return 0 }
    client.dispose = vi.fn(() => { order.push('dispose') })
    const result = await runPlannerWhatIfBenchmark(options, { createClient: () => client, createFixture: () => fixture, now })
    expect(order).toEqual(['clock', 'clock', 'dispose'])
    expect(result).toMatchObject({ status: 'error', error: 'Worker failure', outcome: null })
    expect(client.dispose).toHaveBeenCalledTimes(1)
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })

  it('preserves typed failures as settled calculation outcomes', async () => {
    const client = fakeClient()
    client.createWhatIfComparison = vi.fn<PlannerWorkerClient['createWhatIfComparison']>(async () => ({
      status: 'invalid_fixed_resolution', reason: 'scenario_constraint_missing',
      conflictKey: 'fixture-key', selectedBuildListEntryId: fixture.scenarioResolution.selectedBuildListEntryId,
      detail: 'diagnostic only',
    }))
    const result = await runPlannerWhatIfBenchmark(options, { createClient: () => client, createFixture: () => fixture })
    expect(result.status).toBe('completed')
    expect(result.outcome?.semantic).toMatchObject({ status: 'invalid_fixed_resolution', reason: 'scenario_constraint_missing' })
  })

  it.each([0, -1, 1.5, Infinity, NaN, undefined])('rejects invalid bound %s before Client or fixture construction', async (value) => {
    const createClient = vi.fn(fakeClient)
    const createFixture = vi.fn(() => fixture)
    for (const field of ['maxCandidateTrialsPerCategoryPerTarget', 'maxPlannerReruns']) {
      await expect(runPlannerWhatIfBenchmark({ ...options, bounds: { ...bounds, [field]: value } }, { createClient, createFixture })).rejects.toThrow()
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(createFixture).not.toHaveBeenCalled()
  })

  it('rejects unknown workload before Client construction, even with an injected fixture', async () => {
    const createClient = vi.fn(fakeClient)
    await expect(runPlannerWhatIfBenchmark({ ...options, workloadId: 'missing' }, { createClient, createFixture: () => fixture })).rejects.toThrow(RangeError)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('propagates fixture and constructor failures without a direct calculation fallback', async () => {
    const createClient = vi.fn(fakeClient)
    await expect(runPlannerWhatIfBenchmark(options, { createClient, createFixture: () => { throw new Error('fixture failed') } })).rejects.toThrow('fixture failed')
    expect(createClient).not.toHaveBeenCalled()
    await expect(runPlannerWhatIfBenchmark(options, { createFixture: () => fixture, createClient: () => { throw new Error('constructor failed') } })).rejects.toThrow('constructor failed')
  })
})
