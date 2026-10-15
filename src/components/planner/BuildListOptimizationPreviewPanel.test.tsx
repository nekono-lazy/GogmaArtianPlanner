import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { ProductionPlan } from '../../domain/models/publicTypes'
import { BONUS_ONLY_TARGET_ID, type BuildListOptimizationAdoptionFixture } from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import {
  optimizedPresentationFixture,
  ordinaryDraftFromSameInput,
  presentationTestMaster,
  startContextOf,
} from '../../test/fixtures/buildListOptimizationPresentationFixtures'
import { BuildListOptimizationPreviewPanel } from './BuildListOptimizationPreviewPanel'
import {
  BUILD_LIST_OPTIMIZATION_NO_COMPARABLE_DRAFT_MESSAGE,
  BUILD_LIST_OPTIMIZATION_PREVIEW_DRAFT_REPLACED_MESSAGE,
  BUILD_LIST_OPTIMIZATION_PREVIEW_TITLE,
  BUILD_LIST_OPTIMIZATION_PREVIEW_UNCHANGED_MESSAGE,
  type BuildListOptimizationPreviewStartContext,
} from './buildListOptimizationPresentation'
import previewPanelSource from './BuildListOptimizationPreviewPanel.tsx?raw'
import resultPanelSource from './BuildListOptimizationResultPanel.tsx?raw'
import runningPanelSource from './BuildListOptimizationRunningPanel.tsx?raw'
import diagnosticsSource from './BuildListOptimizationDiagnostics.tsx?raw'
import presentationSource from './buildListOptimizationPresentation.ts?raw'
import longRunNoticeSource from './useBuildListOptimizationLongRunNotice.ts?raw'

/**
 * The unsaved Preview of the Build List optimization (`docs/PLANNER_SPEC.md` 17.9, `docs/UI_FLOW.md` 10.4 「Preview」) over a real
 * `optimized` artifact: the unadopted state, the 17.9 figures from their own authorities, the Build List change, the guarded Draft
 * comparison, the read-only Plan, the Debug-only diagnostics and the caller-owned operations.
 */

let master: MasterDataRoot
let fixture: BuildListOptimizationAdoptionFixture
let draft: ProductionPlan

beforeAll(async () => {
  master = presentationTestMaster()
  fixture = await optimizedPresentationFixture('scoped')
  draft = await ordinaryDraftFromSameInput(fixture)
})

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

/** The MUI `md` breakpoint (900 px) and up, as a desktop browser reports it. */
function emulateDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width:900px'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

function renderPreview(options: {
  fixture?: BuildListOptimizationAdoptionFixture
  startContext?: BuildListOptimizationPreviewStartContext | null
  currentDraft?: ProductionPlan | null
  debugMode?: boolean
  onDiscard?: () => void
  onAdopt?: () => void
  focusHeadingOnMount?: boolean
} = {}) {
  const used = options.fixture ?? fixture
  return render(
    <BuildListOptimizationPreviewPanel
      artifact={used.artifact}
      startContext={options.startContext === undefined ? startContextOf(used.input) : options.startContext}
      currentDraft={options.currentDraft ?? null}
      master={master}
      debugMode={options.debugMode ?? false}
      onDiscard={options.onDiscard ?? (() => undefined)}
      onAdopt={options.onAdopt}
      focusHeadingOnMount={options.focusHeadingOnMount}
    />,
  )
}

/** The `dd` of one overview figure, by its `dt` label. */
function figure(label: string): HTMLElement {
  const term = screen.getAllByText(label).find((element) => element.tagName === 'DT')
  if (term === undefined) throw new Error(`No figure ${label}`)
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`No value for ${label}`)
  return value
}

describe('BuildListOptimizationPreviewPanel', () => {
  it('says in words that the Preview is not adopted and nothing has changed yet', () => {
    renderPreview()
    const heading = screen.getByRole('heading', { name: BUILD_LIST_OPTIMIZATION_PREVIEW_TITLE, level: 2 })
    expect(heading).toBeInTheDocument()
    expect(screen.getAllByText('未採用').length).toBeGreaterThan(0)
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_PREVIEW_UNCHANGED_MESSAGE)).toBeInTheDocument()
    expect(document.body.textContent).toContain('まだ作成リストと生産計画は変更されていません。')
    expect(document.body.textContent).not.toMatch(/最適解|最適性|最短です|最短の/)
  })

  it('shows the completions over this run\'s planning Targets only, and the out-of-scope Targets apart', () => {
    renderPreview()
    // Seven registered Targets, three planning ones: the denominator is 3.
    expect(figure('完成予定の目標武器')).toHaveTextContent('3 / 3')
    expect(figure('完成予定の目標武器')).toHaveTextContent('今回の計画対象3本すべてが完成予定')
    expect(figure('今回の計画対象の目標武器')).toHaveTextContent('3')
    expect(figure('対象外の目標武器')).toHaveTextContent('4')
    expect(within(screen.getByRole('list', { name: '対象外の目標武器の内訳' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '作成リストに候補なし：1件',
      '候補が計画の対象外（再検索が必要など）：2件',
      '完了済み：1件',
    ])
    expect(document.body.textContent).not.toMatch(/すべての目標武器が完成|\/ 7/)
  })

  it('shows the in-game operations and the plan steps as two figures from the artifact summary', () => {
    renderPreview()
    const { summary } = fixture.artifact
    expect(figure('ゲーム内の操作回数')).toHaveTextContent(String(summary.physicalOperationCount))
    expect(figure('計画ステップ数')).toHaveTextContent(String(summary.planStepCount))
    expect(figure('計画ステップ数')).toHaveTextContent(`確認ステップ${summary.nonPhysicalStepCount}件を含む`)
  })

  it('says there is no Conflict in words', () => {
    renderPreview()
    expect(figure('競合')).toHaveTextContent('競合なし')
    expect(screen.getByText('競合なし：この試算に競合はありません。')).toBeInTheDocument()
  })

  it('lists the replacements, the unchanged Targets and the improvement preference that returns to the default', () => {
    renderPreview()
    expect(figure('置き換わる候補')).toHaveTextContent('2件')
    expect(figure('変更なしの目標武器')).toHaveTextContent('1件')
    expect(screen.getByText('採用すると、作成リストの候補2件が新しい候補に置き換わります。')).toBeInTheDocument()
    expect(screen.getByText(/置き換わる候補の途中採用状態の選択と改善優先は引き継がれません。/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '改善優先が戻る目標武器' })).getByRole('listitem'))
      .toHaveTextContent('Issue 103 bonus-only（太刀 / 火）：復元ボーナスを優先 → 生産計画に任せる')
    // The details are disclosures, unmounted while closed.
    expect(screen.queryByRole('list', { name: '置き換わる候補' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '置き換わる候補の内訳（2件）' }))
    const cards = within(screen.getByRole('list', { name: '置き換わる候補' })).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[1]).toHaveTextContent('置換')
    expect(cards[1]).toHaveTextContent('置き換え前の起点Issue 103 source bonus-only（巨戟アーティア）')
    expect(cards[1]).toHaveTextContent('起点は同じ（ルートを変更）')
    fireEvent.click(screen.getByRole('button', { name: '変更なしの目標武器（1件）' }))
    expect(within(screen.getByRole('list', { name: '変更なしの目標武器' })).getByRole('listitem')).toHaveTextContent('Issue 103 skill-only')
  })

  it('says no Build List replacement is needed when every Target stays unchanged', async () => {
    const unchanged = await optimizedPresentationFixture('unchanged')
    renderPreview({ fixture: unchanged })
    expect(figure('置き換わる候補')).toHaveTextContent('0件')
    expect(screen.getByText(/置き換える候補はありません（すべての目標武器が変更なし）。作成リストの置き換えは不要で/)).toBeInTheDocument()
  })

  it('names a Target whose new Route does not start from its preferred owned weapon', () => {
    const context = startContextOf(fixture.input)
    const preferred = fixture.input.ownedWeapons[1]
    renderPreview({
      startContext: {
        ...context,
        targetWeapons: context.targetWeapons.map((target) =>
          target.id === BONUS_ONLY_TARGET_ID ? { ...target, preferredOwnedWeaponId: preferred.id } : target),
      },
    })
    expect(within(screen.getByRole('list', { name: '優先する所持武器と異なる起点で作成する目標武器' })).getByRole('listitem'))
      .toHaveTextContent(`Issue 103 bonus-only（太刀 / 火）：優先する所持武器「${preferred.name}」ではなく、Issue 103 source bonus-only（巨戟アーティア）から作成します`)
  })

  it('shows the whole Plan read-only as an unsaved Plan, with the cost estimate, and unmounts the long lists while closed', () => {
    renderPreview()
    expect(screen.getByRole('heading', { name: '計画全体の実行順', level: 3 })).toBeInTheDocument()
    expect(screen.getByText(/^計画の順番のとおりに表示します。/)).toBeInTheDocument()
    expect(screen.queryByText(/保存された順番/)).toBeNull()
    expect(screen.getByRole('heading', { name: '必要素材・費用の目安', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '巨戟復元' })).toBeInTheDocument()
    // The persisted overview (status, Plan ID, creation time) is not shown for an unsaved Plan.
    expect(screen.queryByText('計画ID')).toBeNull()
    expect(screen.queryByRole('heading', { name: '計画の概要' })).toBeNull()
    expect(screen.queryByRole('list', { name: '計画全体の実行順' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `全${fixture.artifact.summary.planStepCount}ステップを表示` }))
    expect(within(screen.getByRole('list', { name: '計画全体の実行順' })).getAllByRole('listitem').length)
      .toBeGreaterThanOrEqual(fixture.artifact.summary.planStepCount)
  })

  it('compares the current Draft made from the same input state, as stacked cards on a narrow screen and a table on a PC', () => {
    const { unmount } = renderPreview({ currentDraft: draft })
    const cards = screen.getByRole('list', { name: '現在の下書きと全体最適化の試算の比較' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_PREVIEW_DRAFT_REPLACED_MESSAGE)).toBeInTheDocument()
    unmount()
    emulateDesktop()
    renderPreview({ currentDraft: draft })
    const table = screen.getByRole('table', { name: '現在の下書きと全体最適化の試算の比較' })
    expect(within(table).getAllByRole('row').map((row) => row.firstElementChild?.textContent)).toEqual([
      '項目',
      '完成予定の目標武器数（今回の計画対象3本中）',
      'ゲーム内の操作回数',
      '計画ステップ数',
      '競合（記録件数）',
    ])
  })

  it('compares nothing when the Draft was made from another input state, and says so', () => {
    renderPreview({ currentDraft: { ...draft, baseSnapshot: { ...draft.baseSnapshot, buildListEntriesHash: 'fnv1a32:00000000' } } })
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_NO_COMPARABLE_DRAFT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText(/異なる作成リスト・目標武器・状態から作られているため/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '現在の下書きと全体最適化の試算の比較' })).toBeNull()
    expect(screen.queryByRole('table', { name: '現在の下書きと全体最適化の試算の比較' })).toBeNull()
  })

  it('says there is no comparable Draft when none exists, and does not announce a Draft replacement', () => {
    renderPreview({ currentDraft: null })
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_NO_COMPARABLE_DRAFT_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(BUILD_LIST_OPTIMIZATION_PREVIEW_DRAFT_REPLACED_MESSAGE)).toBeNull()
  })

  it('shows no ID and guesses nothing when the start context is not available', () => {
    renderPreview({ startContext: null })
    expect(screen.getByText(/計算開始時の作成リストの情報が無いため/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '置き換わる候補の内訳（2件）' }))
    fireEvent.click(screen.getByRole('button', { name: `全${fixture.artifact.summary.planStepCount}ステップを表示` }))
    expect(screen.getAllByText(/参照できない目標武器/).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/target\.|owned\.|build-list\./)
    // The counts are the artifact's and stay.
    expect(figure('完成予定の目標武器')).toHaveTextContent('3 / 3')
  })

  it('keeps the internal diagnostics for Debug Mode only', () => {
    const { unmount } = renderPreview({ debugMode: false })
    expect(screen.queryByRole('button', { name: '全体最適化の診断情報（Debug）' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/structuralObjective|maxPlanSteps/)
    unmount()
    renderPreview({ debugMode: true })
    fireEvent.click(screen.getByRole('button', { name: '全体最適化の診断情報（Debug）' }))
    expect(screen.getByRole('list', { name: 'summary' })).toHaveTextContent(`structuralObjective: ${fixture.artifact.summary.structuralObjective}`)
  })

  it('goes back through the caller and shows no adoption the caller did not connect', () => {
    const onDiscard = vi.fn()
    const { unmount } = renderPreview({ onDiscard })
    expect(screen.queryByRole('button', { name: 'この計画を採用' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    unmount()
    const onAdopt = vi.fn()
    renderPreview({ onAdopt })
    fireEvent.click(screen.getByRole('button', { name: 'この計画を採用' }))
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the Preview heading only when asked', () => {
    const { unmount } = renderPreview({ focusHeadingOnMount: true })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: BUILD_LIST_OPTIMIZATION_PREVIEW_TITLE }))
    unmount()
    renderPreview()
    expect(document.activeElement).toBe(document.body)
  })

  it('reaches no persistence and no storage from any of the optimization UI modules', () => {
    for (const source of [previewPanelSource, resultPanelSource, runningPanelSource, diagnosticsSource, presentationSource, longRunNoticeSource]) {
      expect(source).not.toMatch(/from '[^']*\/db\//)
      expect(source).not.toMatch(/plannerResultPersistenceService|productionPlanRepository|dexie/i)
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|history\.(push|replace)State/)
    }
  })
})
