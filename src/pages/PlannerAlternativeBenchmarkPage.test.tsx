import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlannerAlternativeBenchmarkHarness,
  type PlannerAlternativeBenchmarkHarness,
} from '../benchmarks/plannerAlternativeBrowserBenchmark'
import { PlannerAlternativeBenchmarkPage } from './PlannerAlternativeBenchmarkPage'

vi.mock('../benchmarks/plannerAlternativeBrowserBenchmark', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../benchmarks/plannerAlternativeBrowserBenchmark')>()),
  createPlannerAlternativeBenchmarkHarness: vi.fn(),
}))
const createHarness = vi.mocked(createPlannerAlternativeBenchmarkHarness)

function api() {
  if (!globalThis.plannerAlternativeBenchmark) throw new Error('Missing API')
  return globalThis.plannerAlternativeBenchmark
}

beforeEach(() => {
  createHarness.mockReset()
  createHarness.mockImplementation((): PlannerAlternativeBenchmarkHarness => ({
    run: async (options) => ({
      requestId: options.requestId,
      // Contract stub only; never measurement evidence.
      outcome: { status: 'cancelled', workerElapsedMs: 0, deliveredCandidates: 0 },
      roundTripMs: 0,
      acceptedAtMs: 0,
      firstCandidateNoticeAtMs: null,
      cancel: null,
    }),
    cancel: () => true,
    ping: async () => 0,
    dispose: () => undefined,
  }))
})

afterEach(() => {
  delete globalThis.plannerAlternativeBenchmark
})

describe('Planner Alternative Phase 3 benchmark page', () => {
  it('registers the console API while mounted, measures nothing by itself, and unregisters on unmount', () => {
    const view = render(<PlannerAlternativeBenchmarkPage />)
    expect(api().protocolVersion).toBe('planner-alternative-phase3-a')
    expect(api().grids.extent.gogma).toContain(235)
    expect(api().grids.heldLength).toEqual([1, 8, 32, 128, 512])
    expect(api().workloads.search).toContain('issue101_no_ideal')
    expect(api().workloads.kernel).toEqual(['issue101_prefer_dragon_normal', 'kernel_multi_target'])
    expect(api().sanity.rerunPressureExtent).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 40, maxSkillAdvance: 1 })
    expect(api().sanity.rerunPressureCandidateTrials).toBe(8)
    expect(api().records()).toEqual([])
    expect(api().environment()).toMatchObject({ engineVersion: 'production-rng:c5-e7', calculationAppSchemaVersion: 16 })
    expect(api().longHeld).toEqual({
      fixedExtent: { maxNormalAdvance: 1, maxGogmaAdvance: 513, maxSkillAdvance: 513 },
      skillIdealPosition: 853,
      gogmaIdealPosition: 567,
    })
    // The Ideal anchor stays put whatever the held length.
    for (const heldLength of [4, 512]) {
      expect(api().longHeldFixture('long_skill_held', { heldLength, heldMode: 'held' }, api().longHeld.fixedExtent))
        .toMatchObject({ idealPosition: 853, heldCount: heldLength, blockedCount: 0 })
    }
    expect(screen.getByText(/Production default ではありません/)).toBeInTheDocument()
    expect(createHarness).not.toHaveBeenCalled()
    view.unmount()
    expect(globalThis.plannerAlternativeBenchmark).toBeUndefined()
  })

  it('runs a warm-up plus measurement series from the console on fresh harnesses and shows the records', async () => {
    render(<PlannerAlternativeBenchmarkPage />)
    await act(async () => {
      await api().runMeasurements({
        mode: 'search', workload: 'long_gogma_held', extent: api().longHeld.fixedExtent,
        longHeld: { heldLength: 4, heldMode: 'held_blocked' }, stopAfterCandidates: 1, warmUp: 1, measurements: 2,
      })
    })
    expect(createHarness).toHaveBeenCalledTimes(3)
    expect(api().records().map(({ phase }) => phase)).toEqual(['warm-up', 'measurement', 'measurement'])
    expect(api().summarize().measurementRecords).toBe(2)
    expect(JSON.parse(api().exportJson()).records).toHaveLength(3)
    const table = screen.getByRole('table', { name: 'Planner Alternative benchmark records' })
    expect(within(table).getAllByText(/long_gogma_held \(held_blocked 4\)/)).toHaveLength(3)
    act(() => api().clear())
    expect(within(table).getByText('No measurements yet.')).toBeInTheDocument()
  })

  it('offers the rerun-pressure Kernel workload and fills its sanity values into the visible fields', async () => {
    render(<PlannerAlternativeBenchmarkPage />)
    fireEvent.mouseDown(screen.getByLabelText('Mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Kernel measurement' }))
    fireEvent.mouseDown(screen.getByLabelText('Workload'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['issue101_prefer_dragon_normal', 'kernel_multi_target'])
    fireEvent.click(screen.getByRole('option', { name: 'kernel_multi_target' }))
    fireEvent.click(screen.getByRole('button', { name: 'sanity値を入力' }))
    expect(screen.getByLabelText('maxGogmaAdvance')).toHaveValue(40)
    expect(screen.getByLabelText('maxCandidateTrialsPerTarget')).toHaveValue(8)
    expect(screen.getByLabelText('maxPlannerReruns')).toHaveValue(1)
    expect(createHarness).not.toHaveBeenCalled()
  })

  it('refuses an invalid extent from the form without creating a Worker', async () => {
    render(<PlannerAlternativeBenchmarkPage />)
    fireEvent.change(screen.getByLabelText('maxGogmaAdvance'), { target: { value: '0' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('extent の3値はすべて1以上の整数')
    expect(createHarness).not.toHaveBeenCalled()
  })

  it('runs a long-held Search from the form with the explicit extent it shows', async () => {
    render(<PlannerAlternativeBenchmarkPage />)
    fireEvent.mouseDown(screen.getByLabelText('Workload'))
    fireEvent.click(await screen.findByRole('option', { name: 'long_skill_held' }))
    fireEvent.change(screen.getByLabelText('held length'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '固定extentを入力' }))
    expect(screen.getByLabelText('maxSkillAdvance')).toHaveValue(513)
    fireEvent.change(screen.getByLabelText('warm-up'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('measurement'), { target: { value: '1' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    })
    expect(createHarness).toHaveBeenCalledTimes(1)
    expect(api().records()[0]).toMatchObject({
      mode: 'search', workload: 'long_skill_held', phase: 'measurement',
      extent: { maxNormalAdvance: 1, maxGogmaAdvance: 513, maxSkillAdvance: 513 },
      longHeld: { heldLength: 8, heldMode: 'held' }, stopAfterCandidates: 1,
    })
    expect(screen.getByRole('status')).toHaveTextContent('完了: 1 records')
  })
})
