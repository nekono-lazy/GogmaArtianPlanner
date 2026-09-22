import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanStep,
  ProductionPlan,
  ProductionPlanAbandonmentReason,
  ProductionPlanStatus,
} from '../domain/models/publicTypes'
import { productionPlanAbandonmentReasons } from '../domain/models/publicTypes'
import { RepositoryError } from '../db/repositoryError'
import {
  productionPlanAbandonmentReasonLabels,
  productionPlanRecalculationReasonLabels,
} from '../presentation/labels'
import { useSettingsStore } from '../stores/settingsStore'
import {
  createValidProductionPlan,
  DOMAIN_FIXTURE_TIME,
  planStepId,
  productionPlanId,
} from '../test/fixtures/domainData'
import {
  ProductionPlansPage,
  type ProductionPlansPageDependencies,
} from './ProductionPlansPage'

function steps(count: number, completed: number): PlanStep[] {
  const template = createValidProductionPlan().steps[0]
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: planStepId(`step.page.${index + 1}`),
    order: index + 1,
    isCompleted: index < completed,
    completedAt: index < completed ? DOMAIN_FIXTURE_TIME : null,
  }))
}

interface PlanOptions {
  status: ProductionPlanStatus
  updatedAt?: string
  createdAt?: string
  stepCount?: number
  completedSteps?: number
  recalculationReasons?: ProductionPlan['recalculationReasons']
  abandonmentReason?: ProductionPlanAbandonmentReason
}

function planFixture(id: string, options: PlanOptions): ProductionPlan {
  const base = createValidProductionPlan()
  const planSteps = steps(options.stepCount ?? 1, options.completedSteps ?? 0)
  const firstIncomplete = planSteps.find((step) => !step.isCompleted) ?? null
  return {
    ...base,
    id: productionPlanId(id),
    status: options.status,
    steps: planSteps,
    currentStepId: options.status === 'completed' ? null : (firstIncomplete?.id ?? null),
    recalculationReasons: options.recalculationReasons ?? [],
    abandonmentReason: options.status === 'abandoned' ? (options.abandonmentReason ?? 'user_abandoned') : null,
    abandonedAt: options.status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
    completedAt: options.status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
    createdAt: options.createdAt ?? DOMAIN_FIXTURE_TIME,
    updatedAt: options.updatedAt ?? DOMAIN_FIXTURE_TIME,
  }
}

/** One Plan of every status, with distinct update times so the order is checkable. */
function everyStatus(): ProductionPlan[] {
  return [
    planFixture('plan.page.completed', {
      status: 'completed',
      updatedAt: '2026-09-19T22:15:00.000Z',
      stepCount: 28,
      completedSteps: 28,
    }),
    planFixture('plan.page.draft', {
      status: 'draft',
      updatedAt: '2026-09-22T08:00:00.000Z',
      stepCount: 24,
    }),
    planFixture('plan.page.abandoned', {
      status: 'abandoned',
      updatedAt: '2026-09-18T20:00:00.000Z',
      stepCount: 26,
      completedSteps: 14,
      abandonmentReason: 'finished_as_compromise',
    }),
    planFixture('plan.page.stale', {
      status: 'stale',
      updatedAt: '2026-09-20T18:40:00.000Z',
      stepCount: 30,
      completedSteps: 12,
      recalculationReasons: ['unexpected_result'],
    }),
    planFixture('plan.page.active', {
      status: 'active',
      updatedAt: '2026-09-21T21:30:00.000Z',
      stepCount: 24,
      completedSteps: 8,
    }),
  ]
}

function dependencies(
  plans: ProductionPlan[] | Error = [],
  overrides: Partial<ProductionPlansPageDependencies> = {},
): ProductionPlansPageDependencies {
  return {
    getAllProductionPlans: vi.fn(async () => {
      if (plans instanceof Error) throw plans
      return structuredClone(plans)
    }),
    deleteDraftProductionPlan: vi.fn(async () => undefined),
    ...overrides,
  }
}

function PlanDestination({ label }: { label: string }) {
  const { planId } = useParams()
  return <div>{label}: {planId}</div>
}

function renderPage(deps: ProductionPlansPageDependencies) {
  const router = createMemoryRouter(
    [
      { path: '/plans', element: <ProductionPlansPage dependencies={deps} /> },
      { path: '/plans/:planId', element: <PlanDestination label="Plan detail" /> },
      { path: '/plans/:planId/run', element: <PlanDestination label="Execution navigator" /> },
      { path: '/build-list', element: <div>Build list destination</div> },
    ],
    { initialEntries: ['/plans'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

/** The Plan cards in document order (the direct items of the Plan list, not a card's own reason list). */
async function findListItems(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: '生産計画一覧' })
  return Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

function itemOf(items: HTMLElement[], statusLabel: string): HTMLElement {
  const match = items.find((item) =>
    within(item).queryByRole('heading', { level: 3, name: new RegExp(`^${statusLabel}`) }) !== null,
  )
  if (!match) throw new Error(`No list item with status ${statusLabel}`)
  return match
}

describe('ProductionPlansPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('shows the empty state with a Build List link when no Plan is stored', async () => {
    const user = userEvent.setup()
    const { router } = renderPage(dependencies([]))

    expect(await screen.findByText('生産計画はまだありません。')).toBeInTheDocument()
    expect(screen.getByText('ビルドリストから生産計画を作成できます。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'ビルドリストを開く' }))
    expect(router.state.location.pathname).toBe('/build-list')
  })

  it('reports a read failure as an error, never as an empty list', async () => {
    renderPage(dependencies(new Error('IndexedDB is unavailable')))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('生産計画一覧を読み込めませんでした: IndexedDB is unavailable')
    expect(screen.queryByText('生産計画はまだありません。')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'ビルドリストを開く' })).not.toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })

  it('shows loading progress before the Plans arrive', () => {
    renderPage(dependencies([]))
    expect(screen.getByLabelText('生産計画一覧を読み込み中')).toBeInTheDocument()
  })

  it('lists every status in one list, most recently updated first', async () => {
    renderPage(dependencies(everyStatus()))

    const items = await findListItems()
    expect(items).toHaveLength(5)
    expect(items.map((item) => within(item).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '下書き現在の下書き',
      '実行中',
      '再計算が必要',
      '完了',
      '終了',
    ])
    // One list, not one section per status.
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.queryByText('破棄済み')).not.toBeInTheDocument()
  })

  it('shows the stale Plan recalculation reasons as typed text', async () => {
    renderPage(dependencies([
      planFixture('plan.page.stale', {
        status: 'stale',
        recalculationReasons: ['unexpected_result', 'rng_state_changed'],
      }),
    ]))

    const [item] = await findListItems()
    expect(within(item).getByText(productionPlanRecalculationReasonLabels.unexpected_result)).toBeInTheDocument()
    expect(within(item).getByText(productionPlanRecalculationReasonLabels.rng_state_changed)).toBeInTheDocument()
    expect(within(item).queryByText('unexpected_result')).not.toBeInTheDocument()
    expect(within(item).queryByText('rng_state_changed')).not.toBeInTheDocument()
  })

  it('shows every abandonment reason as its typed label', async () => {
    renderPage(dependencies(
      productionPlanAbandonmentReasons.map((reason, index) =>
        planFixture(`plan.page.abandoned.${reason}`, {
          status: 'abandoned',
          abandonmentReason: reason,
          updatedAt: `2026-09-1${index}T00:00:00.000Z`,
        })),
    ))

    const items = await findListItems()
    expect(items).toHaveLength(productionPlanAbandonmentReasons.length)
    for (const reason of productionPlanAbandonmentReasons) {
      expect(screen.getByText(productionPlanAbandonmentReasonLabels[reason])).toBeInTheDocument()
      expect(screen.queryByText(reason)).not.toBeInTheDocument()
    }
  })

  it('shows the completed and total Step counts of each Plan', async () => {
    renderPage(dependencies(everyStatus()))

    const items = await findListItems()
    expect(within(itemOf(items, '下書き')).getByText('0 / 24 Step')).toBeInTheDocument()
    expect(within(itemOf(items, '実行中')).getByText('8 / 24 Step')).toBeInTheDocument()
    expect(within(itemOf(items, '再計算が必要')).getByText('12 / 30 Step')).toBeInTheDocument()
    expect(within(itemOf(items, '完了')).getByText('28 / 28 Step')).toBeInTheDocument()
    expect(within(itemOf(items, '終了')).getByText('14 / 26 Step')).toBeInTheDocument()
    expect(within(itemOf(items, '下書き')).getByText('1件')).toBeInTheDocument()
  })

  it('offers 実行ナビを再開 only for the active Plan and navigates to its Execution Navigator', async () => {
    const user = userEvent.setup()
    const { router } = renderPage(dependencies(everyStatus()))

    const items = await findListItems()
    const resume = within(itemOf(items, '実行中')).getByRole('link', { name: '実行ナビを再開' })
    expect(resume).toHaveAttribute('href', '/plans/plan.page.active/run')
    for (const status of ['下書き', '再計算が必要', '完了', '終了']) {
      expect(within(itemOf(items, status)).queryByRole('link', { name: '実行ナビを再開' })).not.toBeInTheDocument()
    }
    await user.click(resume)
    expect(router.state.location.pathname).toBe('/plans/plan.page.active/run')
    expect(await screen.findByText('Execution navigator: plan.page.active')).toBeInTheDocument()
  })

  it('offers 詳細を見る for every status, leading to that Plan', async () => {
    const user = userEvent.setup()
    const { router } = renderPage(dependencies(everyStatus()))

    const items = await findListItems()
    const expected: Record<string, string> = {
      下書き: 'plan.page.draft',
      実行中: 'plan.page.active',
      再計算が必要: 'plan.page.stale',
      完了: 'plan.page.completed',
      終了: 'plan.page.abandoned',
    }
    for (const [status, id] of Object.entries(expected)) {
      expect(within(itemOf(items, status)).getByRole('link', { name: '詳細を見る' })).toHaveAttribute('href', `/plans/${id}`)
    }
    await user.click(within(itemOf(items, '完了')).getByRole('link', { name: '詳細を見る' }))
    expect(router.state.location.pathname).toBe('/plans/plan.page.completed')
    expect(await screen.findByText('Plan detail: plan.page.completed')).toBeInTheDocument()
  })

  it('offers 下書きを削除 only for the Draft', async () => {
    renderPage(dependencies(everyStatus()))

    const items = await findListItems()
    expect(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' })).toBeInTheDocument()
    for (const status of ['実行中', '再計算が必要', '完了', '終了']) {
      expect(within(itemOf(items, status)).queryByRole('button', { name: '下書きを削除' })).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: '下書きを削除' })).toHaveLength(1)
  })

  it('asks for confirmation and deletes nothing on cancel', async () => {
    const user = userEvent.setup()
    const deps = dependencies(everyStatus())
    renderPage(deps)

    const items = await findListItems()
    await user.click(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' }))
    const dialog = await screen.findByRole('dialog', { name: 'この下書きを削除しますか？' })
    expect(dialog).toHaveAccessibleDescription(/まだ開始していない生産計画だけを削除します。/)
    expect(dialog).toHaveAccessibleDescription(/ビルドリスト、候補、目標武器、所持武器は削除されません。/)
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.deleteDraftProductionPlan).not.toHaveBeenCalled()
    expect((await findListItems())).toHaveLength(5)
    expect(screen.getByRole('heading', { level: 3, name: /^下書き/ })).toBeInTheDocument()
  })

  it('deletes the Draft through the guarded delete once and removes only it from the list', async () => {
    const user = userEvent.setup()
    const deps = dependencies(everyStatus())
    renderPage(deps)

    const items = await findListItems()
    await user.click(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' }))
    const dialog = await screen.findByRole('dialog', { name: 'この下書きを削除しますか？' })
    await user.click(within(dialog).getByRole('button', { name: '下書きを削除' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.deleteDraftProductionPlan).toHaveBeenCalledExactlyOnceWith('plan.page.draft')
    const remaining = await findListItems()
    expect(remaining).toHaveLength(4)
    expect(screen.queryByRole('heading', { level: 3, name: /^下書き/ })).not.toBeInTheDocument()
    expect(remaining.map((item) => within(item).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '実行中',
      '再計算が必要',
      '完了',
      '終了',
    ])
    // No reload: the list is updated in place from the same read.
    expect(deps.getAllProductionPlans).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the Draft listed and reports a typed refusal when the delete fails', async () => {
    const user = userEvent.setup()
    const deps = dependencies(everyStatus(), {
      deleteDraftProductionPlan: vi.fn(async () => {
        throw new RepositoryError('draft_plan_delete_not_allowed', 'not a draft any more')
      }),
    })
    renderPage(deps)

    const items = await findListItems()
    await user.click(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' }))
    const dialog = await screen.findByRole('dialog', { name: 'この下書きを削除しますか？' })
    await user.click(within(dialog).getByRole('button', { name: '下書きを削除' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('この生産計画はすでに開始または終了しているため、下書きとして削除できませんでした。')
    expect(alert).not.toHaveTextContent('not a draft any more')
    expect(deps.deleteDraftProductionPlan).toHaveBeenCalledOnce()
    expect(await findListItems()).toHaveLength(5)
    expect(screen.getByRole('heading', { level: 3, name: /^下書き/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下書きを削除' })).toBeEnabled()
  })

  it('clears the delete error on 再読み込み and shows only the freshly read list', async () => {
    const user = userEvent.setup()
    const initial = everyStatus()
    // The second read returns the state after the Draft was started elsewhere:
    // the former Draft is active now, so the refused delete was right.
    const latest = everyStatus()
      .filter((plan) => plan.id !== 'plan.page.active')
      .map((plan) => (plan.id === 'plan.page.draft' ? { ...plan, status: 'active' as const } : plan))
    // The second read is held open so the loading state is observable.
    let resolveSecondRead!: (plans: ProductionPlan[]) => void
    const secondRead = new Promise<ProductionPlan[]>((resolve) => {
      resolveSecondRead = resolve
    })
    const deps = dependencies(initial, {
      getAllProductionPlans: vi.fn()
        .mockResolvedValueOnce(structuredClone(initial))
        .mockReturnValueOnce(secondRead),
      deleteDraftProductionPlan: vi.fn(async () => {
        throw new RepositoryError('not_found', 'gone')
      }),
    })
    renderPage(deps)

    // A. the typed delete failure is shown and the list is kept.
    const items = await findListItems()
    await user.click(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '下書きを削除' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('この下書きはすでに存在しません。一覧を再読み込みしてください。')
    expect(await findListItems()).toHaveLength(5)

    // B. the reload drops the delete error at once and shows the list loading.
    await user.click(within(alert).getByRole('button', { name: '再読み込み' }))
    expect(screen.queryByText('この下書きはすでに存在しません。一覧を再読み込みしてください。')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('生産計画一覧を読み込み中')).toBeInTheDocument()

    // C. the fresh list alone is shown afterwards.
    expect(deps.getAllProductionPlans).toHaveBeenCalledTimes(2)
    resolveSecondRead(structuredClone(latest))
    const reloaded = await findListItems()
    expect(reloaded).toHaveLength(4)
    expect(reloaded.map((item) => within(item).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '実行中',
      '再計算が必要',
      '完了',
      '終了',
    ])
    expect(screen.queryByRole('heading', { level: 3, name: /^下書き/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('生産計画一覧を読み込み中')).not.toBeInTheDocument()
    expect(deps.deleteDraftProductionPlan).toHaveBeenCalledOnce()
  })

  it('shows only the load error when the 再読み込み after a delete failure fails itself', async () => {
    const user = userEvent.setup()
    const initial = everyStatus()
    const deps = dependencies(initial, {
      getAllProductionPlans: vi.fn()
        .mockResolvedValueOnce(structuredClone(initial))
        .mockRejectedValueOnce(new Error('IndexedDB is unavailable')),
      deleteDraftProductionPlan: vi.fn(async () => {
        throw new RepositoryError('draft_plan_delete_not_allowed', 'not a draft any more')
      }),
    })
    renderPage(deps)

    const items = await findListItems()
    await user.click(within(itemOf(items, '下書き')).getByRole('button', { name: '下書きを削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '下書きを削除' }))
    const deleteAlert = await screen.findByRole('alert')
    expect(deleteAlert).toHaveTextContent('この生産計画はすでに開始または終了しているため、下書きとして削除できませんでした。')

    await user.click(within(deleteAlert).getByRole('button', { name: '再読み込み' }))
    const loadAlert = await screen.findByText('生産計画一覧を読み込めませんでした: IndexedDB is unavailable')
    expect(loadAlert).toBeInTheDocument()
    // One Alert only: the stale delete error is gone, and no empty state or list is shown.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText(/下書きとして削除できませんでした/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '生産計画一覧' })).not.toBeInTheDocument()
    expect(screen.queryByText('生産計画はまだありません。')).not.toBeInTheDocument()
    expect(deps.getAllProductionPlans).toHaveBeenCalledTimes(2)
  })

  it('hides the Plan ID unless Debug Mode is on', async () => {
    const { unmount } = renderPage(dependencies(everyStatus()))
    await findListItems()
    expect(screen.queryByText(/Plan ID:/)).not.toBeInTheDocument()
    expect(screen.queryByText('plan.page.draft')).not.toBeInTheDocument()
    unmount()

    useSettingsStore.setState({ debugMode: true })
    renderPage(dependencies(everyStatus()))
    const items = await findListItems()
    expect(within(itemOf(items, '下書き')).getByText('Plan ID: plan.page.draft')).toBeInTheDocument()
    expect(screen.getAllByText(/^Plan ID:/)).toHaveLength(5)
  })

  it('names the list section and each card, and describes each action by its card', async () => {
    renderPage(dependencies([planFixture('plan.page.active', { status: 'active' })]))

    const section = await screen.findByRole('region', { name: '生産計画一覧' })
    expect(within(section).getByRole('heading', { level: 2, name: '生産計画一覧' })).toBeInTheDocument()
    const [item] = await findListItems()
    expect(item).toHaveAccessibleName('実行中')
    expect(within(item).getByRole('link', { name: '詳細を見る' })).toHaveAccessibleDescription('実行中')
    expect(within(item).getByRole('link', { name: '実行ナビを再開' })).toHaveAccessibleDescription('実行中')
  })
})
