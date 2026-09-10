import { describe, expect, it, vi } from 'vitest'
import type {
  PlannerInput,
  PlannerOrchestrationBounds,
  PlannerOrchestrationResult,
} from '../domain/planner'
import { PlannerOrchestrationBoundsError } from '../domain/planner'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  createPlannerOrchestrationBenchmarkInput,
  type PlannerOrchestrationBenchmarkFixture,
} from './plannerOrchestrationBenchmarkFixtures'
import { runPlannerOrchestrationBenchmark } from './plannerOrchestrationBrowserBenchmark'

/**
 * B8-E1 harness contract only. No real Worker is started here and no timing
 * value is read as a measurement: an injected clock makes the timing boundary
 * observable, which is a different thing from measuring it.
 */
const BOUNDS: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 4,
  maxGeneratedBuildListEntries: 2,
  maxPlannerReruns: 8,
}

const WORKLOAD_ID = 'orchestration_single_conflict_early_adoption'
import { exhaustedPlannerTermination } from '../test/fixtures/plannerTermination'

function emptyResult(): PlannerOrchestrationResult {
  return {
    plan: null,
    conflicts: [],
    warnings: [],
    termination: exhaustedPlannerTermination(),
    generatedBuildListEntries: [],
  }
}

interface FakeClientOptions {
  result?: PlannerOrchestrationResult
  error?: Error
  onCall?: () => void
}

function createFakeClient(options: FakeClientOptions = {}) {
  const calls: Array<{
    requestId: string
    input: PlannerInput
    bounds: PlannerOrchestrationBounds
    argumentCount: number
  }> = []
  const dispose = vi.fn()
  const createPlan = vi.fn()
  const client: PlannerWorkerClient = {
    engineVersion: 'fake-engine',
    createPlan,
    createConstrainedPlan: (requestId, input, orchestrationBounds, ...rest) => {
      options.onCall?.()
      calls.push({
        requestId,
        input,
        bounds: orchestrationBounds,
        // The callbacks object is the only extra argument the harness passes;
        // no ConstrainedEnumerationBounds crosses this boundary.
        argumentCount: 3 + rest.length,
      })
      return options.error
        ? Promise.reject(options.error)
        : Promise.resolve(options.result ?? emptyResult())
    },
    createWhatIfComparison: vi.fn(),
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose,
  }
  return { client, calls, dispose, createPlan }
}

describe('B8-E1 Planner orchestration benchmark harness', () => {
  it('passes only the PlannerInput and the caller orchestration bounds to the Client', async () => {
    const fake = createFakeClient()
    const fixture = createPlannerOrchestrationBenchmarkInput(WORKLOAD_ID)
    const result = await runPlannerOrchestrationBenchmark(
      { requestId: 'run-1', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      { createClient: () => fake.client },
    )

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].requestId).toBe('run-1')
    expect(fake.calls[0].bounds).toEqual(BOUNDS)
    // The Production Worker adapter supplies ConstrainedEnumerationBounds
    // inside the Worker; the benchmark never passes one.
    expect(fake.calls[0].argumentCount).toBe(4)
    expect(fake.calls[0].input.buildListEntries.map(({ id }) => id)).toEqual(
      fixture.input.buildListEntries.map(({ id }) => id),
    )
    expect(fake.createPlan).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.engineVersion).toBe('fake-engine')
  })

  it('measures only the createConstrainedPlan round trip', async () => {
    let clock = 0
    const now = () => {
      clock += 1
      return clock
    }
    // Fixture construction and Client construction each consume clock ticks
    // before the measurement starts; only the call itself must be measured.
    const fake = createFakeClient({ onCall: () => now() })
    const createFixture = (workloadId: string): PlannerOrchestrationBenchmarkFixture => {
      now()
      now()
      return createPlannerOrchestrationBenchmarkInput(workloadId)
    }
    const result = await runPlannerOrchestrationBenchmark(
      { requestId: 'run-2', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      {
        createClient: () => {
          now()
          return fake.client
        },
        now,
        createFixture,
      },
    )
    // startedAt and settledAt are two consecutive reads around the call, whose
    // own body consumed exactly one tick.
    expect(result.roundTripMs).toBe(2)
  })

  it('creates and disposes one Worker Client per run', async () => {
    const clients = [createFakeClient(), createFakeClient()]
    let index = 0
    const createClient = () => clients[index++].client
    await runPlannerOrchestrationBenchmark(
      { requestId: 'run-3a', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      { createClient },
    )
    await runPlannerOrchestrationBenchmark(
      { requestId: 'run-3b', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      { createClient },
    )
    expect(index).toBe(2)
    clients.forEach((client) => {
      expect(client.calls).toHaveLength(1)
      expect(client.dispose).toHaveBeenCalledTimes(1)
    })
  })

  it('reports a failed run as an error and still disposes the Client', async () => {
    const fake = createFakeClient({ error: new Error('Planner Worker exploded.') })
    const result = await runPlannerOrchestrationBenchmark(
      { requestId: 'run-4', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      { createClient: () => fake.client },
    )
    expect(result.status).toBe('error')
    expect(result.error).toBe('Planner Worker exploded.')
    expect(result.outcome).toBeNull()
    expect(result.boundFlags).toBeNull()
    expect(result.generatedBuildListEntryCount).toBeNull()
    expect(fake.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid orchestration bounds before creating a Worker Client', async () => {
    const createClient = vi.fn()
    await expect(
      runPlannerOrchestrationBenchmark(
        {
          requestId: 'run-5',
          workloadId: WORKLOAD_ID,
          orchestrationBounds: { ...BOUNDS, maxPlannerReruns: 0 },
        },
        { createClient },
      ),
    ).rejects.toBeInstanceOf(PlannerOrchestrationBoundsError)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('fails an unknown workload before creating a Worker Client', async () => {
    const createClient = vi.fn()
    await expect(
      runPlannerOrchestrationBenchmark(
        { requestId: 'run-6', workloadId: 'missing', orchestrationBounds: BOUNDS },
        { createClient },
      ),
    ).rejects.toBeInstanceOf(RangeError)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('counts Planner progress events without changing the result', async () => {
    const fake = createFakeClient()
    const result = await runPlannerOrchestrationBenchmark(
      { requestId: 'run-7', workloadId: WORKLOAD_ID, orchestrationBounds: BOUNDS },
      { createClient: () => fake.client },
    )
    // The fake Client emits none, so the counter stays at zero and the outcome
    // digest is built from the result alone.
    expect(result.progressEvents).toBe(0)
    expect(result.outcome?.planPresent).toBe(false)
    expect(result.outcome?.outcomeKey).toEqual(expect.any(String))
    expect(result.boundFlags).toEqual({
      trialBoundReached: false,
      generatedBoundReached: false,
      rerunBoundReached: false,
      enumerationBoundReached: false,
    })
  })
})
