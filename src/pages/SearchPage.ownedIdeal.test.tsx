import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanBreakingChangeApproval, PlanBreakingChangeInspection } from '../domain/execution'
import type { BuildCandidate, OwnedGogmaArtianWeapon, OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import type { CandidateSearchInput, CandidateSearchResult } from '../domain/search'
import { createBuildListEntry } from '../domain/buildList'
import { type SearchWorkerClient, type SearchWorkerClientCallbacks } from '../services/search/searchWorkerClient'
import type { TargetOwnedIdealCompletion } from '../services/crud/targetWeaponLifecycleService'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { targetEvaluationMaster } from '../test/fixtures/targetEvaluation'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/**
 * The owned Ideal notice and 「この武器で目標を完了にする」 beside the search
 * conditions (`docs/UI_FLOW.md` 8.2, `docs/SEARCH_SPEC.md` 5.5.5): a preferred
 * path that never gates the search, and a completion after which no result of
 * the completed Target stays operable.
 */

const COMPLETE = { name: 'この武器で目標を完了にする' } as const
const WARNING = { name: '実行中の生産計画があります' } as const
const NOW = '2026-09-22T10:00:00.000Z'

class ControlledClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly cancelSearch = vi.fn()
  readonly dispose = vi.fn()
  input: CandidateSearchInput | null = null
  private resolveSearch: ((result: CandidateSearchResult) => void) | null = null
  startSearch(input: CandidateSearchInput, _callbacks: SearchWorkerClientCallbacks = {}) {
    void _callbacks
    this.input = input
    return new Promise<CandidateSearchResult>((resolve) => {
      this.resolveSearch = resolve
    })
  }
  resolve(result: CandidateSearchResult) { this.resolveSearch?.(result) }
}

function resultFor(target: TargetWeapon, candidate: BuildCandidate | null): CandidateSearchResult {
  return {
    searchRunId: 'ui-run',
    calculationContext: createFixtureInput().calculationContext,
    targetResult: { targetWeaponId: target.id, candidate, searchedRoutes: ['normal_artian_to_gogma'], skippedRoutes: [] },
    warnings: [],
    elapsedMs: 1,
  }
}

/** The fixture weapon already performs as the fixture Target's Ideal. */
function idealGogma(id: string, patch: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return { ...createValidOwnedWeapon(ownedWeaponId(id)), name: id, status: 'unclassified', isProtected: false, ...patch }
}

function dependencies(client: ControlledClient, targets: TargetWeapon[], ownedWeapons: OwnedWeapon[]) {
  let storedTargets = targets
  let storedWeapons = ownedWeapons
  // The fixture Master lacks the evaluation ranks the fixture Target uses.
  const base = createValidMasterDataFixture()
  const master = {
    ...base,
    bonusRanks: [...base.bonusRanks, ...targetEvaluationMaster.bonusRanks.filter((rank) => !base.bonusRanks.some(({ id }) => id === rank.id))],
  }
  const deps = {
    master,
    getTargets: vi.fn(async () => storedTargets.map((value) => structuredClone(value))),
    getOwnedWeapons: vi.fn(async () => storedWeapons.map((value) => structuredClone(value))),
    getBuildListEntries: async () => [],
    getReidentificationReminder: async () => ({ kind: 'none' as const }),
    createWorkerClient: () => client,
    createInput: async (options: Parameters<SearchPageDependencies['createInput']>[0]) => ({
      ...createFixtureInput(),
      ...options,
      targetWeapons: storedTargets,
      targetWeaponId: options.targetWeaponId,
      master: {
        weaponBonusDefinitions: master.weaponBonusDefinitions,
        weaponTypes: master.weaponTypes,
        elements: master.elements,
        bonusTypes: master.bonusTypes,
        bonusRanks: master.bonusRanks,
        artianBonusTypeMappings: master.artianBonusTypeMappings,
        materialCosts: master.materialCosts,
      },
    }),
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async (candidate: BuildCandidate, target: TargetWeapon, intermediateStateSelection: Parameters<SearchPageDependencies['addCandidate']>[2]) => ({
      entry: createBuildListEntry(candidate, target, { intermediateStateSelection }),
      added: true,
    })),
    inspectCompleteWithOwnedIdeal: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    completeWithOwnedIdeal: vi.fn(async (targetId: TargetWeapon['id'], weaponId: OwnedWeapon['id'], _approval?: PlanBreakingChangeApproval | null): Promise<TargetOwnedIdealCompletion> => {
      void _approval
      const stored = storedTargets.find(({ id }) => id === targetId)
      const weapon = storedWeapons.find(({ id }) => id === weaponId)
      if (!stored || !weapon || weapon.kind !== 'gogma') throw new Error('fixture mismatch')
      const completed: TargetWeapon = { ...stored, lifecycleStatus: 'completed', completedAt: NOW, completedByProductionPlanId: null, preferredOwnedWeaponId: null, updatedAt: NOW }
      const protectedWeapon: OwnedGogmaArtianWeapon = { ...weapon, status: 'ideal', isProtected: true, updatedAt: NOW }
      storedTargets = storedTargets.map((other) => (other.id === targetId ? completed : other))
      storedWeapons = storedWeapons.map((other) => (other.id === weaponId ? protectedWeapon : other))
      return { target: completed, ownedWeapon: protectedWeapon, releasedTargetIds: [] }
    }),
  } satisfies SearchPageDependencies
  return deps
}

function renderSearch(deps: SearchPageDependencies) {
  return render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
}

afterEach(() => vi.restoreAllMocks())

describe('SearchPage owned Ideal notice', () => {
  it('notifies every owned Ideal of the selected Target with the direct completion, and keeps the search available', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const second = idealGogma('owned.second', { name: 'B武器', status: 'practical', isProtected: true })
    const first = idealGogma('owned.first', { name: 'A武器' })
    const notIdeal = idealGogma('owned.skip', { name: '不一致', seriesSkillId: 'series_skill.fixture.z' })
    const deps = dependencies(client, [target], [second, notIdeal, first])
    renderSearch(deps)

    expect(await screen.findByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeInTheDocument()
    const weapons = within(screen.getByRole('list', { name: `${target.name}の理想条件を満たす所持武器` }))
    expect(weapons.getAllByRole('listitem').map((item) => within(item).getAllByText(/武器$/)[0].textContent)).toEqual(['A武器', 'B武器'])
    expect(weapons.queryByText('不一致')).toBeNull()
    const buttons = weapons.getAllByRole('button', COMPLETE)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleDescription('A武器')
    expect(buttons[1]).toHaveAccessibleDescription('B武器')
    buttons.forEach((button) => expect(getComputedStyle(button).minHeight).toBe('44px'))

    // Never a gate: the search starts as usual beside the notice.
    const start = screen.getByRole('button', { name: '検索開始' })
    expect(start).toBeEnabled()
    await user.click(start)
    expect(client.input?.targetWeaponId).toBe(target.id)
    expect(screen.getByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeInTheDocument()
  })

  it('shows no notice when no owned weapon meets the Ideal', async () => {
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    renderSearch(dependencies(client, [target], [idealGogma('owned.skip', { restorationBonusScope: 'normal_artian' })]))
    await screen.findByRole('button', { name: '検索開始' })
    expect(screen.queryByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeNull()
    expect(screen.queryByRole('button', COMPLETE)).toBeNull()
  })

  it('cancels the confirmation with nothing changed', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target], [idealGogma('owned.a')])
    renderSearch(deps)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, createValidBuildCandidate()))
    await screen.findByRole('button', { name: 'ビルドリストへ追加' })

    await user.click(screen.getByRole('button', COMPLETE))
    const dialog = await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.inspectCompleteWithOwnedIdeal).not.toHaveBeenCalled()
    expect(deps.completeWithOwnedIdeal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ビルドリストへ追加' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '検索対象の目標武器' })).toHaveTextContent(target.name)
  })

  it('completes the selected Target, drops its result, removes it from the Select and selects the next eligible Target', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const next = { ...createValidTargetWeapon(), id: targetWeaponId('target.next'), name: '次の目標', elementId: 'element.fixture.b' }
    const deps = dependencies(client, [target, next], [idealGogma('owned.a')])
    renderSearch(deps)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, createValidBuildCandidate()))
    await screen.findByRole('button', { name: 'ビルドリストへ追加' })

    await user.click(screen.getByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))

    expect(await screen.findByText(`目標武器「${target.name}」を完了にしました。`)).toBeInTheDocument()
    expect(deps.completeWithOwnedIdeal).toHaveBeenCalledWith(target.id, 'owned.a', null)
    await waitFor(() => expect(deps.getTargets).toHaveBeenCalledTimes(2))
    expect(deps.getOwnedWeapons).toHaveBeenCalledTimes(2)
    // The stale result of the completed Target is gone: nothing can be added.
    expect(screen.queryByRole('button', { name: 'ビルドリストへ追加' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '検索結果' })).toBeNull()
    expect(deps.addCandidate).not.toHaveBeenCalled()
    const select = await screen.findByRole('combobox', { name: '検索対象の目標武器' })
    await waitFor(() => expect(select).toHaveTextContent('次の目標'))
    await user.click(select)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByRole('option', { name: target.name })).toBeNull()
    expect(within(listbox).getByRole('option', { name: '次の目標' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    // The next Target has no owned Ideal (other element): no notice for it.
    await waitFor(() => expect(screen.queryByText('この目標の理想条件を満たす所持武器をすでに所有しています。')).toBeNull())
  })

  it('empties the Select when the completed Target was the last eligible one', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target], [idealGogma('owned.a')])
    renderSearch(deps)
    await user.click(await screen.findByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))
    expect(await screen.findByText(`目標武器「${target.name}」を完了にしました。`)).toBeInTheDocument()
    expect(await screen.findByText('目標武器を登録してください。')).toBeInTheDocument()
    expect(screen.queryByRole('button', COMPLETE)).toBeNull()
  })

  it('cancels a running search of the completed Target so its late result never lands', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target], [idealGogma('owned.a')])
    renderSearch(deps)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    expect(screen.getByRole('heading', { name: '検索中' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))
    expect(await screen.findByText(`目標武器「${target.name}」を完了にしました。`)).toBeInTheDocument()
    expect(client.cancelSearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: '検索中' })).toBeNull()
    client.resolve(resultFor(target, createValidBuildCandidate()))
    await waitFor(() => expect(deps.getTargets).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'ビルドリストへ追加' })).toBeNull()
    expect(deps.saveCandidates).not.toHaveBeenCalled()
  })

  it('routes the completion through the breaking-change warning', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target], [idealGogma('owned.a')])
    const inspection = planBreakingInspection({ reasons: ['target_changed'] })
    deps.inspectCompleteWithOwnedIdeal.mockResolvedValue(inspection)
    renderSearch(deps)
    await user.click(await screen.findByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))
    const warning = within(await screen.findByRole('dialog', WARNING))
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.completeWithOwnedIdeal).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole('dialog', { name: 'この所持武器で目標を完了しますか？' })).getByRole('button', COMPLETE))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText(`目標武器「${target.name}」を完了にし、実行中の生産計画を破棄しました。`)).toBeInTheDocument()
    expect(deps.completeWithOwnedIdeal).toHaveBeenCalledWith(target.id, 'owned.a', planBreakingApproval(inspection))
  })
})
