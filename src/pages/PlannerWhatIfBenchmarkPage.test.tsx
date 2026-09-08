import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPlannerWhatIfBenchmark } from '../benchmarks/plannerWhatIfBrowserBenchmark'
import { createPlannerWhatIfBenchmarkOutcome } from '../benchmarks/plannerWhatIfBenchmarkOutcome'
import { PlannerWhatIfBenchmarkPage } from './PlannerWhatIfBenchmarkPage'

vi.mock('../benchmarks/plannerWhatIfBrowserBenchmark', () => ({ runPlannerWhatIfBenchmark: vi.fn() }))
const run = vi.mocked(runPlannerWhatIfBenchmark)
const bounds = { maxCandidateTrialsPerCategoryPerTarget: 2, maxPlannerReruns: 32 }
function api() {
  if (!globalThis.b9WhatIfBenchmark) throw new Error('Missing API')
  return globalThis.b9WhatIfBenchmark
}
beforeEach(() => {
  run.mockReset()
  run.mockImplementation(async (options) => ({
    ...options, status: 'completed', roundTripMs: 0, // Contract stub only; never measurement evidence.
    outcome: createPlannerWhatIfBenchmarkOutcome({ status: 'planner_input_not_ready', issues: [], warnings: [], excludedBuildListEntries: [] }),
    progressEvents: 0, engineVersion: 'contract-test-only', error: null,
  }))
})
afterEach(() => { delete globalThis.b9WhatIfBenchmark })

describe('B9 isolated benchmark page', () => {
  it('exposes callable workload/fixture/record API without automatically measuring', () => {
    const view = render(<PlannerWhatIfBenchmarkPage />)
    expect(api().workloads()).toHaveLength(4)
    expect(api().fixture('what_if_three_targets').workload.participantCount).toBe(3)
    expect(api().records()).toEqual([])
    expect(api().sweep.maxCandidateTrialsPerCategoryPerTarget).toEqual([1, 2, 4, 8, 16])
    expect(api().sweep.maxPlannerReruns).toEqual([1, 2, 4, 8, 16, 32])
    expect(api().environment.engineVersion).toBe('production-rng:c5-e2')
    expect(screen.getByText(/UNDECIDED/)).toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
    view.unmount()
    expect(globalThis.b9WhatIfBenchmark).toBeUndefined()
  })

  it('runs one warm-up plus N measurements sequentially with unique requests and exportable semantic records', async () => {
    render(<PlannerWhatIfBenchmarkPage />)
    let active = 0
    let maxActive = 0
    const implementation = run.getMockImplementation()!
    run.mockImplementation(async (options) => {
      active += 1
      maxActive = Math.max(active, maxActive)
      await Promise.resolve()
      const result = await implementation(options)
      active -= 1
      return result
    })
    await act(async () => { await api().runMeasurements('what_if_dual_category', bounds, 3) })
    expect(run).toHaveBeenCalledTimes(4)
    expect(maxActive).toBe(1)
    expect(new Set(run.mock.calls.map(([options]) => options.requestId)).size).toBe(4)
    run.mock.calls.forEach(([options]) => {
      expect(options.bounds).toEqual(bounds)
      expect(options).not.toHaveProperty('enumerationBounds')
    })
    expect(api().records().map(({ phase }) => phase)).toEqual(['warm-up', 'measurement', 'measurement', 'measurement'])
    expect(JSON.parse(JSON.stringify(api().records()))).toHaveLength(4)
    expect(api().records()[0].outcome?.semantic.status).toBe('planner_input_not_ready')
    expect(api().records()[0].environment.userAgent).toBe(navigator.userAgent)
    await act(async () => { api().clear() })
    expect(api().records()).toEqual([])
  })

  it('keeps a batch lock, rejects overlap and clear, and does not start later runs after unmount', async () => {
    const view = render(<PlannerWhatIfBenchmarkPage />)
    const saved = api()
    let settle!: () => void
    const implementation = run.getMockImplementation()!
    run.mockImplementation(async (options) => {
      await new Promise<void>((resolve) => { settle = resolve })
      return implementation(options)
    })
    let batch!: Promise<unknown>
    act(() => { batch = saved.runMeasurements('what_if_two_targets', bounds, 3) })
    const rejection = expect(batch).rejects.toThrow('unmounted')
    expect(screen.getByRole('button', { name: 'Run once' })).toBeDisabled()
    await expect(saved.run({ workloadId: 'what_if_two_targets', phase: 'single', bounds })).rejects.toThrow('already in progress')
    expect(() => saved.clear()).toThrow('Cannot clear')
    view.unmount()
    settle()
    await rejection
    expect(run).toHaveBeenCalledTimes(1)
    expect(globalThis.b9WhatIfBenchmark).toBeUndefined()
  })

  it('validates count and reports runner errors without unhandled UI rejection', async () => {
    render(<PlannerWhatIfBenchmarkPage />)
    await act(async () => { await expect(api().runMeasurements('what_if_two_targets', bounds, 0)).rejects.toThrow(RangeError) })
    expect(run).not.toHaveBeenCalled()
    run.mockRejectedValue(new Error('contract error'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run once' })) })
    expect(screen.getByText('contract error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run once' })).toBeEnabled()
  })

  it('retains an error record and stops the batch when a Worker request fails', async () => {
    render(<PlannerWhatIfBenchmarkPage />)
    run.mockImplementation(async (options) => ({ ...options, status: 'error', roundTripMs: 0,
      outcome: null, progressEvents: 0, engineVersion: 'contract-test-only', error: 'Worker failed' }))
    await act(async () => { await expect(api().runMeasurements('what_if_two_targets', bounds, 3)).rejects.toThrow('Worker failed') })
    expect(run).toHaveBeenCalledTimes(1)
    expect(api().records()).toHaveLength(1)
    expect(api().records()[0].status).toBe('error')
  })
})
