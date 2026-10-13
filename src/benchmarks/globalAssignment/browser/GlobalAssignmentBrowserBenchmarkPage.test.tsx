import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createGlobalAssignmentBrowserHarness } from './globalAssignmentBrowserHarness'
import type { GlobalAssignmentBrowserRunnerDependencies } from './globalAssignmentBrowserRunner'
import { GlobalAssignmentBrowserBenchmarkPage } from './GlobalAssignmentBrowserBenchmarkPage'
import { InProcessWorker, syntheticControllerOptions, syntheticExport } from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1: the benchmark page. The main thread reads the picked Export's bytes for its identity only (no JSON
 * parse), shows the registered conditions read-only, runs logical runs through the runner, states progress and outcomes in text (never
 * by colour alone, never as a completion ratio), shows no Target ID, and exposes the console API only while mounted.
 */

describe('P-1 benchmark page', () => {
  it('observes the Export identity without parsing it, runs a logical run and lists its outcome in text, with the console API while mounted', async () => {
    const synthetic = await syntheticExport()
    const dependencies: GlobalAssignmentBrowserRunnerDependencies = {
      createHarness: () => createGlobalAssignmentBrowserHarness({ createWorker: () => new InProcessWorker(syntheticControllerOptions(synthetic)) }),
      mainEnvironment: () => ({ isSecureContext: true, crossOriginIsolated: false, cryptoSubtle: true, build: null }),
      canCloneBlob: () => false, subscribeLifecycle: () => () => undefined, sleep: async () => undefined,
    }
    const user = userEvent.setup()
    const view = render(<GlobalAssignmentBrowserBenchmarkPage runnerDependencies={dependencies} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Global Assignment Browser Worker（P-1）' })).toBeInTheDocument()
    const conditions = screen.getByRole('group', { name: 'Registered conditions' })
    expect(within(conditions).getByText('350 / 500 / 1500')).toBeInTheDocument()
    expect(within(conditions).getByText('20,000')).toBeInTheDocument()
    expect(within(conditions).getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('Exportは未選択です。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'logical runを実行' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('待機中（実行記録なし）')

    const parse = vi.spyOn(JSON, 'parse')
    await user.upload(view.container.querySelector<HTMLInputElement>('#gab-export-file')!, new File([synthetic.bytes.slice(0)], synthetic.identity.fileName, { type: 'application/json' }))
    const identity = await screen.findByRole('group', { name: 'Export identity' })
    expect(within(identity).getByText(synthetic.identity.sha256)).toBeInTheDocument()
    expect(within(identity).getByText(synthetic.identity.bytes.toLocaleString())).toBeInTheDocument()
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
    expect(globalThis.globalAssignmentBrowserBenchmark?.exportInfo()).toMatchObject({ fileName: synthetic.identity.fileName, bytes: synthetic.identity.bytes, sha256: synthetic.identity.sha256 })

    await user.click(screen.getByRole('button', { name: 'logical runを実行' }))
    const record = await screen.findByRole('article', { name: 'logical run run-1' }, { timeout: 60_000 })
    expect(within(record).getByRole('heading', { level: 3 })).toHaveTextContent('run-1: browser_nonformal_conditions_met')
    expect(record).toHaveTextContent('両Workerで全条件を満たし一致（非formal）')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('待機中（直前のrun run-1: browser_nonformal_conditions_met）'))
    expect(document.body.textContent).not.toMatch(/target\.fixture|owned\.g1|build-list\./)
    expect(globalThis.globalAssignmentBrowserBenchmark?.records()).toHaveLength(1)
    expect(JSON.parse(globalThis.globalAssignmentBrowserBenchmark!.exportJson())).toMatchObject({ kind: 'global-assignment-browser-raw', formal: false })
    view.unmount()
    expect(globalThis.globalAssignmentBrowserBenchmark).toBeUndefined()
  }, 120_000)
})
