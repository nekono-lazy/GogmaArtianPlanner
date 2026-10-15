import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildListOptimizationBenchmarkPage } from './BuildListOptimizationBenchmarkPage'

/*
 * Issue #260 PR-5A: the benchmark page renders, exposes its console API for the driver, selects a synthetic input and refuses a run on
 * an input that is not the expected one. (The page creates real Workers, which jsdom has not: running a slot is the runner tests' and
 * the Browser mechanics check's.)
 */

afterEach(() => {
  globalThis.buildListOptimizationBenchmark = undefined
})

describe('BuildListOptimizationBenchmarkPage (Issue #260 PR-5A)', () => {
  it('renders, exposes the console API and selects a synthetic input', async () => {
    render(<BuildListOptimizationBenchmarkPage />)
    expect(screen.getByRole('heading', { level: 1, name: '作成リスト全体最適化 Browser計測（benchmark専用）' })).toBeInTheDocument()
    expect(screen.getByText(/開発サーバー（provenanceなし）/)).toBeInTheDocument()
    await waitFor(() => expect(globalThis.buildListOptimizationBenchmark).toBeDefined())
    const api = globalThis.buildListOptimizationBenchmark!
    expect(api.inputInfo()).toBeNull()
    expect(api.syntheticCases().map(entry => entry.caseId)).toEqual(['synthetic.sanity-3', 'synthetic.sanity-3.duplicate-entry'])
    expect(api.syntheticBounds().map(entry => entry.boundsId)).toEqual(['synthetic.open', 'synthetic.node-budget-1', 'synthetic.wide-window'])
    const identity = await api.useSynthetic('synthetic.sanity-3')
    expect(identity).toMatchObject({ kind: 'synthetic', caseId: 'synthetic.sanity-3' })
    expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(api.inputInfo()).toEqual(identity)
    await waitFor(() => expect(screen.getByText(/選択中: synthetic synthetic\.sanity-3/)).toBeInTheDocument())
    await expect(api.runSlot({ slotId: 's', purpose: 'mechanics', planned: false, inputId: 'x', boundsId: 'synthetic.open', bounds: {} as never, cancelTrigger: null, faultInjection: null, memory: null }, { inputSha256: 'f'.repeat(64) }))
      .rejects.toThrow('The selected input is not the expected one.')
    expect(api.records()).toEqual([])
    expect(JSON.parse(api.exportJson())).toMatchObject({ kind: 'build-list-optimization-browser-records', records: [] })
  })
})
