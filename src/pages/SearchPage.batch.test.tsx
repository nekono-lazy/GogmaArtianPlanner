import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../domain/buildList'
import type { BuildCandidate, BuildListEntry, TargetWeapon } from '../domain/models/publicTypes'
import type { CandidateSearchInput, CandidateSearchResult } from '../domain/search'
import type { AddBuildListCandidateResult } from '../services/buildList/buildListService'
import {
  SearchCancelledError,
  type SearchWorkerClient,
  type SearchWorkerClientCallbacks,
} from '../services/search/searchWorkerClient'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  candidateId,
  createValidBuildCandidate,
  createValidTargetWeapon,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/**
 * 「未登録を一括検索・追加」 (`docs/UI_FLOW.md` 9.1): the ordinary single search
 * run once per Target without a Build List Entry, and the 「登録済み」 label of
 * the Target Select.
 */

/** A client answering each request by its `searchRunId`, as the real one does. */
class QueueClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly requests: { input: CandidateSearchInput; callbacks: SearchWorkerClientCallbacks }[] = []
  private readonly pending = new Map<string, { resolve: (r: CandidateSearchResult) => void; reject: (e: Error) => void }>()
  readonly cancelSearch = vi.fn((requestId: string) => {
    const current = this.pending.get(requestId)
    this.pending.delete(requestId)
    current?.reject(new SearchCancelledError())
  })
  readonly dispose = vi.fn()
  startSearch(input: CandidateSearchInput, callbacks: SearchWorkerClientCallbacks = {}) {
    this.requests.push({ input, callbacks })
    return new Promise<CandidateSearchResult>((resolve, reject) => {
      this.pending.set(input.searchRunId, { resolve, reject })
    })
  }
  get last() {
    const request = this.requests.at(-1)
    if (!request) throw new Error('no request')
    return request
  }
  resolveLast(candidate: BuildCandidate | null) {
    const { input } = this.last
    this.pending.get(input.searchRunId)?.resolve({
      searchRunId: input.searchRunId,
      calculationContext: input.calculationContext,
      targetResult: { targetWeaponId: input.targetWeaponId, candidate, searchedRoutes: [], skippedRoutes: [] },
      warnings: [],
      elapsedMs: 1,
    })
  }
  rejectLast(error: Error) {
    this.pending.get(this.last.input.searchRunId)?.reject(error)
  }
}

function target(id: string, name: string): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name }
}

function candidateFor(value: TargetWeapon, suffix = ''): BuildCandidate {
  return { ...createValidBuildCandidate(), id: candidateId(`candidate.${value.id}${suffix}`), targetWeaponId: value.id }
}

/** A persisted Build List the dependencies read and the fake Service writes to. */
function dependencies(
  client: QueueClient,
  targets: TargetWeapon[],
  initialEntries: BuildListEntry[] = [],
  addResult?: (candidate: BuildCandidate, t: TargetWeapon) => AddBuildListCandidateResult | null,
) {
  const persisted = { entries: [...initialEntries] }
  const master = createValidMasterDataFixture()
  const deps: SearchPageDependencies = {
    master,
    getTargets: async () => targets,
    getOwnedWeapons: async () => [],
    getBuildListEntries: vi.fn(async () => [...persisted.entries]),
    getReidentificationReminder: async () => ({ kind: 'none' as const }),
    createWorkerClient: () => client,
    createInput: vi.fn(async (options) => ({ ...createFixtureInput(), ...options, targetWeapons: targets })),
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async (candidate: BuildCandidate, t: TargetWeapon, intermediateStateSelection) => {
      const forced = addResult?.(candidate, t)
      if (forced) return forced
      const entry = createBuildListEntry(candidate, t, { intermediateStateSelection })
      persisted.entries.push(entry)
      return { status: 'added' as const, entry }
    }),
    inspectCandidateReplacement: vi.fn(async () => ({ approvalRequired: false as const })),
    replaceCandidate: vi.fn(async () => { throw new Error('the batch never replaces') }),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not used in this test') }),
  }
  return { deps, persisted }
}

const BATCH = /未登録を一括検索・追加/

describe('SearchPage batch search and registration', () => {
  it('labels only registered Targets and keeps them selectable for a single re-search', async () => {
    const user = userEvent.setup()
    const client = new QueueClient()
    const registered = target('target.registered', '登録済みの目標')
    const open = target('target.open', '未登録の目標')
    const staleEntry: BuildListEntry = {
      ...createBuildListEntry(candidateFor(registered), registered),
      isStale: true,
      staleReasons: ['rng_state_changed'],
    }
    const { deps } = dependencies(client, [registered, open], [staleEntry])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    const selector = await screen.findByRole('combobox', { name: '検索対象の目標武器' })
    // The selected (first) Target is registered, so the closed control shows it too.
    expect(within(selector).getByText('登録済み')).toBeInTheDocument()
    await user.click(selector)
    const registeredOption = await screen.findByRole('option', { name: /登録済みの目標/ })
    const openOption = screen.getByRole('option', { name: /未登録の目標/ })
    expect(within(registeredOption).getByText('登録済み')).toBeInTheDocument()
    expect(within(openOption).queryByText('登録済み')).not.toBeInTheDocument()
    await user.click(registeredOption)
    await user.click(screen.getByRole('button', { name: '検索開始' }))
    expect(client.last.input.targetWeaponId).toBe(registered.id)
  })

  it('searches only unregistered Targets, adds with the default selection, and summarises', async () => {
    const user = userEvent.setup()
    const client = new QueueClient()
    const registered = target('target.registered', '登録済みの目標')
    const found = target('target.found', '見つかる目標')
    const empty = target('target.empty', '候補なしの目標')
    const broken = target('target.broken', '失敗する目標')
    const disabled = { ...target('target.disabled', '検索対象外'), isEnabled: false }
    const { deps } = dependencies(
      client,
      [registered, found, empty, broken, disabled],
      [createBuildListEntry(candidateFor(registered), registered)],
    )
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    await user.click(await screen.findByRole('button', { name: '未登録を一括検索・追加（3件）' }))
    expect(screen.getByRole('button', { name: '検索開始' })).toBeDisabled()
    expect(screen.getByRole('button', { name: BATCH })).toBeDisabled()
    expect(await screen.findByText('1 / 3 件目')).toBeInTheDocument()
    expect(screen.getByText(`対象: ${found.name}`)).toBeInTheDocument()
    client.last.callbacks.onProgress?.({ targetWeaponId: found.id, phase: 'searching', processedWorkItems: 42 })
    expect(await screen.findByText('探索ステップ: 42')).toBeInTheDocument()
    expect(client.last.input).toMatchObject({ targetWeaponId: found.id, routeFilter: 'all' })
    const foundCandidate = candidateFor(found)
    client.resolveLast(foundCandidate)

    expect(await screen.findByText('2 / 3 件目')).toBeInTheDocument()
    expect(screen.getByText('完了: 1 / 3件')).toBeInTheDocument()
    expect(deps.addCandidate).toHaveBeenCalledWith(foundCandidate, found, defaultIntermediateStateSelection())
    client.resolveLast(null)
    expect(await screen.findByText('3 / 3 件目')).toBeInTheDocument()
    client.rejectLast(new Error('fixture failure'))

    const summary = await screen.findByRole('region', { name: '一括検索・追加の結果' })
    expect(within(summary).getByText('3件の目標武器を検索しました。')).toBeInTheDocument()
    const counts = within(summary).getByRole('list', { name: '一括検索・追加の件数' })
    expect(counts).toHaveTextContent('作成リストへ追加1件')
    expect(counts).toHaveTextContent('候補なし1件')
    expect(counts).toHaveTextContent('検索失敗1件')
    expect(counts).toHaveTextContent('追加しなかった0件')
    await user.click(within(summary).getByText('検索失敗（1件）'))
    expect(await within(summary).findByText(broken.name)).toBeInTheDocument()
    expect(within(summary).getByText('fixture failure')).toBeInTheDocument()
    await user.click(within(summary).getByText('候補なし（1件）'))
    expect(await within(summary).findByText(empty.name)).toBeInTheDocument()
    expect(client.requests.map(({ input }) => input.targetWeaponId)).toEqual([found.id, empty.id, broken.id])
    expect(new Set(client.requests.map(({ input }) => input.searchRunId)).size).toBe(3)
    expect(deps.replaceCandidate).not.toHaveBeenCalled()

    // The persisted Build List is read again: the added Target is now registered.
    await waitFor(() => expect(screen.getByRole('button', { name: '未登録を一括検索・追加（2件）' })).toBeEnabled())
    expect(deps.getBuildListEntries).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('combobox', { name: '検索対象の目標武器' }))
    const foundOption = await screen.findByRole('option', { name: /見つかる目標/ })
    expect(within(foundOption).getByText('登録済み')).toBeInTheDocument()
  })

  it('never replaces or picks an Entry when the Service refuses the addition', async () => {
    const user = userEvent.setup()
    const client = new QueueClient()
    const replace = target('target.replace', '置換が必要な目標')
    const legacy = target('target.legacy', '重複のある目標')
    const { deps } = dependencies(client, [replace, legacy], [], (candidate, t) => {
      const entry = createBuildListEntry(candidate, t)
      return t.id === replace.id
        ? { status: 'replacement_required', existingEntry: entry }
        : { status: 'legacy_duplicate', entries: [entry, entry] }
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '未登録を一括検索・追加（2件）' }))
    await screen.findByText('1 / 2 件目')
    client.resolveLast(candidateFor(replace))
    await screen.findByText('2 / 2 件目')
    client.resolveLast(candidateFor(legacy))

    const summary = await screen.findByRole('region', { name: '一括検索・追加の結果' })
    expect(within(summary).getByRole('list', { name: '一括検索・追加の件数' })).toHaveTextContent('追加しなかった2件')
    await user.click(within(summary).getByText('追加しなかった（2件）'))
    expect(await within(summary).findByText(/置き換えは行っていません/)).toBeInTheDocument()
    expect(within(summary).getByText(/複数の候補が登録されているため/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deps.inspectCandidateReplacement).not.toHaveBeenCalled()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
  })

  it('cancels the running search, keeps the earlier addition, and allows searching again', async () => {
    const user = userEvent.setup()
    const client = new QueueClient()
    const targets = [target('target.a', '目標A'), target('target.b', '目標B'), target('target.c', '目標C')]
    const { deps, persisted } = dependencies(client, targets)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '未登録を一括検索・追加（3件）' }))
    await screen.findByText('1 / 3 件目')
    client.resolveLast(candidateFor(targets[0]))
    await screen.findByText('2 / 3 件目')
    await user.click(screen.getByRole('button', { name: '一括検索をキャンセル' }))
    expect(client.cancelSearch).toHaveBeenCalledWith(client.last.input.searchRunId)

    const summary = await screen.findByRole('region', { name: '一括検索・追加の結果' })
    expect(within(summary).getByText(/一括検索をキャンセルしました。/)).toBeInTheDocument()
    expect(within(summary).getByRole('list', { name: '一括検索・追加の件数' })).toHaveTextContent('未処理2件')
    expect(client.requests).toHaveLength(2)
    expect(persisted.entries.map(({ targetWeaponId: id }) => id)).toEqual([targets[0].id])

    await waitFor(() => expect(screen.getByRole('button', { name: '未登録を一括検索・追加（2件）' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '検索開始' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '検索開始' }))
    expect(client.requests).toHaveLength(3)
    expect(screen.queryByRole('region', { name: '一括検索・追加の結果' })).not.toBeInTheDocument()
  })

  it('offers no batch while every searchable Target is registered, nor during a single search', async () => {
    const user = userEvent.setup()
    const client = new QueueClient()
    const only = target('target.only', '唯一の目標')
    const { deps } = dependencies(client, [only], [createBuildListEntry(candidateFor(only), only)])
    const view = render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('button', { name: '未登録を一括検索・追加（0件）' })).toBeDisabled()
    expect(screen.getByText('作成リストに未登録の目標武器はありません。')).toBeInTheDocument()
    view.unmount()

    const openClient = new QueueClient()
    const open = target('target.open', '未登録の目標')
    render(<SearchPage dependencies={dependencies(openClient, [open]).deps} />, { wrapper: MemoryRouter })
    const batch = await screen.findByRole('button', { name: '未登録を一括検索・追加（1件）' })
    expect(batch).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '検索開始' }))
    expect(batch).toBeDisabled()
  })
})
