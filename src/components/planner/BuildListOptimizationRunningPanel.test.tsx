import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import { hasStyleRule } from '../../test/cssRuleAssertions'
import { BuildListOptimizationRunningPanel } from './BuildListOptimizationRunningPanel'
import {
  BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE,
  BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE_DELAY_MS,
} from './buildListOptimizationPresentation'

/**
 * The running state of the Build List optimization (`docs/UI_FLOW.md` 10.4 「計算中」, U3 of `docs/PLANNER_SPEC.md` 17.16): the
 * status region, the stage line, the cancel operation and the 30 s long-run notice with its timer lifecycle.
 */

const notice = () => screen.queryByText(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE)

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('BuildListOptimizationRunningPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the heading, an indeterminate progress bar, the stage and the cancel operation in one polite status region', () => {
    const onCancel = vi.fn()
    render(<BuildListOptimizationRunningPanel runKey={1} stage="assignment_search" onCancel={onCancel} />)
    const region = screen.getByRole('status', { name: '生産計画を計算中' })
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toContainElement(screen.getByRole('heading', { name: '生産計画を計算中' }))
    const progress = screen.getByRole('progressbar', { name: '生産計画の計算中' })
    // Indeterminate: no value, so no completion rate is announced.
    expect(progress).not.toHaveAttribute('aria-valuenow')
    expect(region).toHaveTextContent('現在の段階：割当の探索')
    expect(region.textContent).not.toMatch(/%|残り|\d+\s*\/\s*\d+/)
    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    expect(region).toContainElement(cancel)
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('names each stage, and still says it is running before the first stage arrives', () => {
    const { rerender } = render(<BuildListOptimizationRunningPanel runKey={1} stage={null} onCancel={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('現在の段階：計算を開始しています')
    const expected: [BuildListOptimizationStage, string][] = [
      ['input_check', '入力確認'],
      ['reach_table', '到達条件の計算'],
      ['assignment_search', '割当の探索'],
      ['route_generation', 'ルートの生成'],
      ['plan_verification', '計画の検証'],
    ]
    for (const [stage, label] of expected) {
      rerender(<BuildListOptimizationRunningPanel runKey={1} stage={stage} onCancel={() => undefined} />)
      expect(screen.getByRole('status')).toHaveTextContent(`現在の段階：${label}`)
    }
  })

  it('does not move focus when the stage changes', () => {
    const { rerender } = render(
      <>
        <button type="button">ほかの操作</button>
        <BuildListOptimizationRunningPanel runKey={1} stage="input_check" onCancel={() => undefined} />
      </>,
    )
    const other = screen.getByRole('button', { name: 'ほかの操作' })
    other.focus()
    rerender(
      <>
        <button type="button">ほかの操作</button>
        <BuildListOptimizationRunningPanel runKey={1} stage="plan_verification" onCancel={() => undefined} />
      </>,
    )
    expect(document.activeElement).toBe(other)
  })

  it('adds the long-run notice at 30 s, beside the stage and the cancel operation, and never cancels on its own', () => {
    const onCancel = vi.fn()
    render(<BuildListOptimizationRunningPanel runKey={7} stage="route_generation" onCancel={onCancel} />)
    advance(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE_DELAY_MS - 1)
    expect(notice()).toBeNull()
    advance(1)
    const shown = notice()
    expect(shown).not.toBeNull()
    // Same status region, not an alert: the stage, the progress bar and the cancel operation all stay.
    const region = screen.getByRole('status')
    expect(region).toContainElement(shown)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(region).toHaveTextContent('現在の段階：ルートの生成')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
    // Time alone never cancels, and nothing else is scheduled after the notice.
    advance(10 * 60_000)
    expect(onCancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer when the run ends (unmount) before 30 s, so no notice comes afterwards', () => {
    const { unmount } = render(<BuildListOptimizationRunningPanel runKey={1} stage="reach_table" onCancel={() => undefined} />)
    advance(10_000)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    advance(60_000)
    expect(notice()).toBeNull()
  })

  it('restarts the count for a new run, and the previous run neither fires nor keeps its notice', () => {
    const { rerender } = render(<BuildListOptimizationRunningPanel runKey={1} stage="reach_table" onCancel={() => undefined} />)
    advance(20_000)
    rerender(<BuildListOptimizationRunningPanel runKey={2} stage={null} onCancel={() => undefined} />)
    expect(vi.getTimerCount()).toBe(1)
    // 30 s after the first run started, 10 s after the second: the first run's timer is gone.
    advance(10_000)
    expect(notice()).toBeNull()
    advance(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE_DELAY_MS - 10_000 - 1)
    expect(notice()).toBeNull()
    advance(1)
    expect(notice()).not.toBeNull()
    // A third run starts from zero again: the second run's notice does not carry over.
    rerender(<BuildListOptimizationRunningPanel runKey={3} stage={null} onCancel={() => undefined} />)
    expect(notice()).toBeNull()
  })

  it('stops the bar animation for reduced motion and keeps the cancel operation a 44 px target', () => {
    render(<BuildListOptimizationRunningPanel runKey={1} stage={null} onCancel={() => undefined} />)
    const bar = document.querySelector('.MuiLinearProgress-bar')
    expect(bar).not.toBeNull()
    expect(hasStyleRule(bar as Element, 'animation', 'none', '(prefers-reduced-motion: reduce)')).toBe(true)
    expect(hasStyleRule(screen.getByRole('button', { name: 'キャンセル' }), 'min-height', '44px')).toBe(true)
  })
})
