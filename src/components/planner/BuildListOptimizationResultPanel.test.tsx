import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { BuildListOptimizationResult } from '../../domain/planner/buildListOptimization'
import type { BuildListOptimizationSessionState } from '../../services/planner/buildListOptimizationService'
import { isOrdinaryPlannerAuxiliaryOffered, planCreationStartContextOf, type PlanCreationSessionState } from '../../services/planner/planCreationService'
import {
  BONUS_ONLY_TARGET_ID,
  MIXED_KEEP_TARGET_ID,
  type BuildListOptimizationAdoptionFixture,
} from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import {
  BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS,
  optimizedPresentationFixture,
  presentationTestMaster,
  startContextOf,
} from '../../test/fixtures/buildListOptimizationPresentationFixtures'
import {
  BUILD_LIST_OPTIMIZATION_NOT_FOUND_MESSAGE,
  BUILD_LIST_OPTIMIZATION_PREVIEW_TITLE,
  BUILD_LIST_OPTIMIZATION_SEARCH_BOUND_MESSAGE,
  BUILD_LIST_OPTIMIZATION_UNCHANGED_MESSAGE,
  ORDINARY_PLANNER_AUXILIARY_LABEL,
  ORDINARY_PLANNER_AUXILIARY_OPTIONS_INVALID_MESSAGE,
  buildListOptimizationOutcomeOf,
  type BuildListOptimizationOutcome,
} from './buildListOptimizationPresentation'
import { BuildListOptimizationResultPanel, type OrdinaryPlannerAuxiliaryAction } from './BuildListOptimizationResultPanel'

/**
 * The results of the Build List optimization (`docs/UI_FLOW.md` 10.4 「結果別の表示」, `docs/PLANNER_SPEC.md` 17.2 / 17.8): each
 * typed outcome reads as what it is, and the ordinary Planner auxiliary operation follows the Application's offer and never starts
 * on its own.
 */

let master: MasterDataRoot
let fixture: BuildListOptimizationAdoptionFixture & { result: Extract<BuildListOptimizationResult, { status: 'optimized' }> }

beforeAll(async () => {
  master = presentationTestMaster()
  fixture = await optimizedPresentationFixture('scoped')
})

const notFound: BuildListOptimizationResult = { status: 'not_found', reason: 'candidates_rejected', diagnostics: BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS }
const searchBound: BuildListOptimizationResult = {
  status: 'search_bound_reached',
  bounds: [{ kind: 'structural_search_node_budget', nodeBudget: 2_000 }],
  diagnostics: BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS,
}

function renderPanel(
  outcome: BuildListOptimizationOutcome,
  options: {
    auxiliary?: OrdinaryPlannerAuxiliaryAction | null
    onRetry?: () => void
    onDiscard?: () => void
    debugMode?: boolean
    focusHeadingOnMount?: boolean
    withStartContext?: boolean
  } = {},
) {
  const element: ReactElement = (
    <MemoryRouter>
      <BuildListOptimizationResultPanel
        outcome={outcome}
        startContext={options.withStartContext === false ? null : startContextOf(fixture.input)}
        currentDraft={null}
        master={master}
        debugMode={options.debugMode ?? false}
        ordinaryPlannerAuxiliary={options.auxiliary ?? null}
        onDiscard={options.onDiscard ?? (() => undefined)}
        onRetry={options.onRetry}
        focusHeadingOnMount={options.focusHeadingOnMount}
      />
    </MemoryRouter>
  )
  return render(element)
}

const auxiliaryButton = () => screen.queryByRole('button', { name: ORDINARY_PLANNER_AUXILIARY_LABEL })

describe('BuildListOptimizationResultPanel', () => {
  it('shows an optimized result as the unsaved Preview', () => {
    renderPanel({ kind: 'result', result: fixture.result })
    expect(screen.getByRole('heading', { name: BUILD_LIST_OPTIMIZATION_PREVIEW_TITLE })).toBeInTheDocument()
    expect(auxiliaryButton()).toBeNull()
  })

  it('says not_found is "not found in this search range", never that no combination exists', () => {
    renderPanel({ kind: 'result', result: notFound })
    expect(screen.getByRole('heading', { name: '組み合わせを見つけられませんでした' })).toBeInTheDocument()
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_NOT_FOUND_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('組み合わせが存在しないという意味ではありません。')).toBeInTheDocument()
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_UNCHANGED_MESSAGE)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/存在しません|解が無い|最短|最適解/)
  })

  it('keeps search_bound_reached apart from not_found', () => {
    renderPanel({ kind: 'result', result: searchBound })
    expect(screen.getByRole('heading', { name: '結果を確定できませんでした' })).toBeInTheDocument()
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_SEARCH_BOUND_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('成立する組み合わせが無いという意味ではありません。')).toBeInTheDocument()
    expect(screen.queryByText(BUILD_LIST_OPTIMIZATION_NOT_FOUND_MESSAGE)).toBeNull()
  })

  it('lists the typed unsupported reasons with the Targets by name, weapon type and element and where to resolve them', () => {
    renderPanel({
      kind: 'result',
      result: {
        status: 'unsupported',
        reasons: [
          { kind: 'checkpoint_selection', entries: [{ buildListEntryId: fixture.input.buildListEntries[2].id, targetWeaponId: MIXED_KEEP_TARGET_ID }] },
          { kind: 'unconfirmed_rng_state', missing: ['skill_counter'] },
          { kind: 'target_without_source', targetWeaponIds: [BONUS_ONLY_TARGET_ID] },
        ],
      },
    })
    expect(screen.getByRole('heading', { name: 'この作成リストでは全体最適化を使えません' })).toBeInTheDocument()
    const reasons = within(screen.getByRole('list', { name: '全体最適化を使えない理由' }))
    expect(reasons.getByText('途中採用する状態を選択している候補があります')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '途中採用する状態を選択している候補があります（該当する目標武器）' })).getByRole('listitem'))
      .toHaveTextContent('Issue 103 mixed-keep（弓 / 雷）')
    expect(within(screen.getByRole('list', { name: '確定が必要な値' })).getByRole('listitem')).toHaveTextContent('スキルカウンター')
    expect(screen.getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
    expect(screen.getByRole('link', { name: '通常アーティアカウンターへ' })).toHaveAttribute('href', '/normal-counters')
    // Names only: no Target or Entry ID, and no raw reason kind outside Debug Mode.
    expect(document.body.textContent).not.toMatch(/target\.|build-list\.|checkpoint_selection|unconfirmed_rng_state/)
  })

  it('never names a Target it cannot resolve by its ID', () => {
    renderPanel(
      { kind: 'result', result: { status: 'unsupported', reasons: [{ kind: 'blind_route_required', targetWeaponIds: [BONUS_ONLY_TARGET_ID] }] } },
      { withStartContext: false },
    )
    expect(screen.getByText('参照できない目標武器（1件）')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(BONUS_ONLY_TARGET_ID)
  })

  it('shows a cancellation as an information notice, never an error, with no auxiliary operation', () => {
    const onStart = vi.fn()
    renderPanel({ kind: 'cancelled', reason: 'cancelled' }, { auxiliary: { onStart } })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('全体最適化の計算をキャンセルしました。')
    expect(alert.className).toMatch(/Info/)
    expect(alert.className).not.toMatch(/Error/)
    expect(auxiliaryButton()).toBeNull()
  })

  it('shows a Worker failure as an error with a retry, without presuming a lack of memory', () => {
    const onRetry = vi.fn()
    renderPanel({ kind: 'failed', failure: { kind: 'worker_error', message: 'Out of memory' } }, { onRetry, auxiliary: { onStart: vi.fn() } })
    const alert = screen.getByRole('alert')
    expect(alert.className).toMatch(/Error/)
    expect(screen.getByRole('heading', { name: '計算を完了できませんでした' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/メモリ|Out of memory/)
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_UNCHANGED_MESSAGE)).toBeInTheDocument()
    expect(auxiliaryButton()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度計算する' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows a contract violation as an error, never as unsupported or not found, with no retry and no auxiliary operation', () => {
    renderPanel(
      { kind: 'failed', failure: { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'identity broke' } },
      { onRetry: vi.fn(), auxiliary: { onStart: vi.fn() } },
    )
    expect(screen.getByRole('alert').className).toMatch(/Error/)
    expect(screen.getByText('この結果は「全体最適化を使えない」や「組み合わせが見つからなかった」という意味ではありません。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'この作成リストでは全体最適化を使えません' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '組み合わせを見つけられませんでした' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'もう一度計算する' })).toBeNull()
    expect(auxiliaryButton()).toBeNull()
    // Raw failure details are Debug Mode only.
    expect(document.body.textContent).not.toMatch(/objective_mismatch|identity broke/)
  })

  it('shows the raw failure and the diagnostics in Debug Mode only', () => {
    const { unmount } = renderPanel(
      { kind: 'failed', failure: { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'identity broke' } },
      { debugMode: true },
    )
    expect(screen.getByRole('list', { name: '計算失敗の詳細（Debug）' })).toHaveTextContent('domainCode: objective_mismatch')
    unmount()
    renderPanel({ kind: 'result', result: searchBound }, { debugMode: false })
    expect(screen.queryByRole('button', { name: '全体最適化の診断情報（Debug）' })).toBeNull()
  })

  it('offers the ordinary Planner auxiliary operation only inside a result that offers it, and never starts it by itself', () => {
    const onStart = vi.fn()
    const { unmount } = renderPanel({ kind: 'result', result: notFound }, { auxiliary: { onStart } })
    const button = auxiliaryButton()
    expect(button).not.toBeNull()
    // The result stays shown with it, and its explanation is the button's description.
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_NOT_FOUND_MESSAGE)).toBeInTheDocument()
    expect(button).toHaveAccessibleDescription(/ルートの組み直しはしません/)
    expect(onStart).not.toHaveBeenCalled()
    fireEvent.click(button as HTMLElement)
    expect(onStart).toHaveBeenCalledTimes(1)
    unmount()

    // An unsupported result that the ordinary Planner cannot run despite (a running Plan) never shows it, even when passed.
    renderPanel(
      { kind: 'result', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } },
      { auxiliary: { onStart } },
    )
    expect(auxiliaryButton()).toBeNull()
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('disables the auxiliary operation with its reason shown beside it (U7)', () => {
    renderPanel(
      { kind: 'result', result: searchBound },
      { auxiliary: { onStart: vi.fn(), disabled: true, disabledReason: ORDINARY_PLANNER_AUXILIARY_OPTIONS_INVALID_MESSAGE } },
    )
    const button = auxiliaryButton()
    expect(button).toBeDisabled()
    expect(screen.getByText(ORDINARY_PLANNER_AUXILIARY_OPTIONS_INVALID_MESSAGE)).toBeInTheDocument()
    expect(button).toHaveAccessibleDescription(new RegExp(ORDINARY_PLANNER_AUXILIARY_OPTIONS_INVALID_MESSAGE.slice(0, 12)))
  })

  it('follows the Application offer (isOrdinaryPlannerAuxiliaryOffered) when the caller connects the session state', () => {
    const snapshot = { observedDraftPlanId: null, runningPlanAbsent: true } as const
    const primaryWith = (optimization: BuildListOptimizationSessionState): PlanCreationSessionState => ({
      primary: { status: 'build_list_optimization', runId: 1, optimization, startContext: planCreationStartContextOf(fixture.input) },
      auxiliary: { status: 'idle' },
    })
    const cases: [string, BuildListOptimizationSessionState, boolean][] = [
      ['not_found', { status: 'completed', runId: 1, completion: { decidedBy: 'calculation', result: notFound, startSnapshot: snapshot } }, true],
      ['search_bound_reached', { status: 'completed', runId: 1, completion: { decidedBy: 'calculation', result: searchBound, startSnapshot: snapshot } }, true],
      ['optimized', { status: 'completed', runId: 1, completion: { decidedBy: 'calculation', result: fixture.result, startSnapshot: snapshot } }, false],
      ['running plan', { status: 'completed', runId: 1, completion: { decidedBy: 'application', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } } }, false],
      ['cancelled', { status: 'cancelled', runId: 1, reason: 'cancelled' }, false],
      ['failed', { status: 'failed', runId: 1, failure: { kind: 'worker_message_error' } }, false],
    ]
    for (const [label, optimization, expected] of cases) {
      const state = primaryWith(optimization)
      const offered = isOrdinaryPlannerAuxiliaryOffered(state)
      expect(offered, label).toBe(expected)
      const outcome = buildListOptimizationOutcomeOf(optimization)
      if (outcome === null) throw new Error(label)
      const onStart = vi.fn()
      const { unmount } = renderPanel(outcome, { auxiliary: offered ? { onStart } : null })
      expect(auxiliaryButton() !== null, label).toBe(expected)
      expect(onStart, label).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('closes through the caller and moves focus to the result heading only when asked', () => {
    const onDiscard = vi.fn()
    const { unmount } = renderPanel({ kind: 'result', result: notFound }, { onDiscard, focusHeadingOnMount: true })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '組み合わせを見つけられませんでした' }))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    unmount()
    renderPanel({ kind: 'result', result: notFound })
    expect(document.activeElement).toBe(document.body)
  })
})
