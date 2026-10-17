import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, type OtherTargetSourceUsageReason } from '../domain/buildList'
import type { BuildCandidate, OwnedWeapon, OwnedWeaponId, TargetWeapon } from '../domain/models/publicTypes'
import { recommendedCandidateSearchDefaults } from '../domain/models/publicTypes'
import type { CandidateSearchInput, CandidateSearchResult } from '../domain/search'
import type {
  CandidateSearchSourceExclusionSnapshot,
  PreparedCandidateSearchInput,
  PrepareCandidateSearchInputOptions,
} from '../services/search/prepareCandidateSearchInput'
import {
  SearchCancelledError,
  type SearchWorkerClient,
  type SearchWorkerClientCallbacks,
} from '../services/search/searchWorkerClient'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { preparedFixtureInput } from '../test/fixtures/preparedCandidateSearchInput'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/*
 * 「他の目標武器で使用する所持武器を除外する」 on the Search screen (Issue #157 PR-4, `docs/UI_FLOW.md` 9 / 9.1 / 9.2 /
 * 19). The derivation and the Search are faked here: the screen decides neither, it only passes the condition fixed at
 * each start, shows what the Search really excluded, and names it from that search's own snapshot.
 */

const HEADING = '他の目標武器で使用する所持武器を除外する'
const SINGLE = '検索開始（単体検索）'
const BATCH_CHECKBOX = '未登録を一括検索・追加'
const ON = '他の目標武器で使用する所持武器: 除外する'
const OFF = '他の目標武器で使用する所持武器: 除外しない'
const DESCRIPTION = /ほかの目標武器の「優先する所持武器」と、作成リストに登録済みのほかの目標武器の候補が起点に使う所持武器を/
const NOT_FOUND = '現在の探索範囲では理想品が見つかりませんでした。探索量の上限を上げると見つかる場合があります。詳細設定の「通常アーティア最大進行量」「復元ボーナス最大進行量」「スキル最大進行量」を見直してください。'

/** A client answering each request by its `searchRunId`, as the real one does. */
class QueueClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly requests: { input: CandidateSearchInput; callbacks: SearchWorkerClientCallbacks }[] = []
  private readonly pending = new Map<string, { resolve: (r: CandidateSearchResult) => void; reject: (e: Error) => void }>()
  readonly cancelSearch = vi.fn((requestId: string) => {
    this.pending.get(requestId)?.reject(new SearchCancelledError())
    this.pending.delete(requestId)
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
  /** Answers the last request; `excluded` is what the Search Domain reports it excluded. */
  resolveLast(candidate: BuildCandidate | null, excluded: OwnedWeaponId[] = []) {
    const { input } = this.last
    this.pending.get(input.searchRunId)?.resolve({
      searchRunId: input.searchRunId,
      calculationContext: input.calculationContext,
      targetResult: {
        targetWeaponId: input.targetWeaponId,
        candidate,
        searchedRoutes: ['normal_artian_to_gogma'],
        skippedRoutes: [],
        excludedSourceOwnedWeaponIds: excluded,
      },
      warnings: [],
      elapsedMs: 1,
    })
  }
  rejectLast(error: Error) {
    this.pending.get(this.last.input.searchRunId)?.reject(error)
  }
}

function target(id: string, name: string, createdAt: string, patch: Partial<TargetWeapon> = {}): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name, createdAt, ...patch }
}

function weapon(id: string, name: string, createdAt: string): OwnedWeapon {
  return { ...createValidOwnedWeapon(ownedWeaponId(id)), name, createdAt, isProtected: false }
}

interface Usage {
  weapon: OwnedWeapon
  reasons: OtherTargetSourceUsageReason[]
}

/** A snapshot as `prepareCandidateSearchInput()` records it (code unit order). */
function snapshotOf(searched: TargetWeapon, usages: Usage[], reasonTargets: TargetWeapon[]): CandidateSearchSourceExclusionSnapshot {
  const sorted = [...usages].sort((left, right) => (left.weapon.id < right.weapon.id ? -1 : 1))
  return {
    exclusion: {
      targetWeaponId: searched.id,
      excludedOwnedWeaponIds: sorted.map(({ weapon: w }) => w.id),
      usages: sorted.map(({ weapon: w, reasons }) => ({ ownedWeaponId: w.id, reasons })),
    },
    ownedWeapons: sorted.map(({ weapon: w }) => w),
    targetWeapons: [...reasonTargets].sort((left, right) => (left.id < right.id ? -1 : 1)),
  }
}

interface Setup {
  targets: TargetWeapon[]
  ownedWeapons?: OwnedWeapon[]
  /** The snapshot a preparation with the exclusion on records; nothing excluded by default. */
  snapshotFor?: (options: PrepareCandidateSearchInputOptions) => CandidateSearchSourceExclusionSnapshot | undefined
  /** Replaces the preparation altogether. */
  prepare?: (options: PrepareCandidateSearchInputOptions) => Promise<PreparedCandidateSearchInput>
}

function setup({ targets, ownedWeapons = [], snapshotFor, prepare }: Setup) {
  const client = new QueueClient()
  const master = createValidMasterDataFixture()
  const persisted = { entries: [] as ReturnType<typeof createBuildListEntry>[] }
  const prepareInput = vi.fn(prepare ?? (async (options: PrepareCandidateSearchInputOptions) => {
    const { excludeOtherTargetSources, ...inputOptions } = options
    return preparedFixtureInput(
      { ...createFixtureInput(), ...inputOptions, targetWeapons: targets, ownedWeapons },
      excludeOtherTargetSources,
      excludeOtherTargetSources ? snapshotFor?.(options) : undefined,
    )
  }))
  const deps: SearchPageDependencies = {
    master,
    getTargets: async () => targets,
    getOwnedWeapons: async () => ownedWeapons,
    getBuildListEntries: vi.fn(async () => [...persisted.entries]),
    getReidentificationReminder: async () => ({ kind: 'none' as const }),
    getCandidateSearchDefaults: vi.fn(async () => ({ ...recommendedCandidateSearchDefaults })),
    createWorkerClient: () => client,
    prepareInput,
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async (candidate: BuildCandidate, t: TargetWeapon, intermediateStateSelection) => {
      const entry = createBuildListEntry(candidate, t, { intermediateStateSelection })
      persisted.entries.push(entry)
      return { status: 'added' as const, entry }
    }),
    inspectCandidateReplacement: vi.fn(async () => ({ approvalRequired: false as const })),
    replaceCandidate: vi.fn(async () => { throw new Error('not used in this test') }),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not used in this test') }),
  }
  return { client, deps, prepareInput }
}

const conditions = () => screen.getByRole('group', { name: HEADING })
const singleCheckbox = () => within(conditions()).getByRole('checkbox', { name: SINGLE })
const batchCheckbox = () => within(conditions()).getByRole('checkbox', { name: BATCH_CHECKBOX })
const resultRegion = () => screen.getByRole('region', { name: '検索結果' })

async function startSingleSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '検索開始' }))
}

/** A summary row whose name and note are separate nodes of one line. */
const summaryRow = (text: string) => (_content: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text

describe('SearchPage source exclusion conditions', () => {
  it('starts single OFF and batch ON, keeps them independent of each other and of the other conditions, and starts over on a new visit', async () => {
    const user = userEvent.setup()
    const a = target('target.a', '目標A', '2026-01-01T00:00:00.000Z')
    const b = target('target.b', '目標B', '2026-01-02T00:00:00.000Z')
    const { deps } = setup({ targets: [a, b] })
    const view = render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    await screen.findByRole('group', { name: HEADING })
    expect(singleCheckbox()).not.toBeChecked()
    expect(batchCheckbox()).toBeChecked()
    // The always-visible description is what each Checkbox refers to.
    expect(within(conditions()).getByText(DESCRIPTION)).toBeVisible()
    expect(singleCheckbox()).toHaveAccessibleDescription(DESCRIPTION)
    expect(batchCheckbox()).toHaveAccessibleDescription(DESCRIPTION)

    await user.click(singleCheckbox())
    expect(singleCheckbox()).toBeChecked()
    expect(batchCheckbox()).toBeChecked()
    await user.click(batchCheckbox())
    expect(singleCheckbox()).toBeChecked()
    expect(batchCheckbox()).not.toBeChecked()
    // The label clicks the box too.
    await user.click(within(conditions()).getByText(SINGLE))
    expect(singleCheckbox()).not.toBeChecked()
    await user.click(singleCheckbox())

    // Another Target and another route filter leave both values alone.
    await user.click(screen.getByRole('combobox', { name: '検索対象の目標武器' }))
    await user.click(await screen.findByRole('option', { name: '目標B' }))
    await user.click(screen.getByRole('combobox', { name: '作成ルート' }))
    await user.click(await screen.findByRole('option', { name: '所持巨戟アーティア経由' }))
    expect(singleCheckbox()).toBeChecked()
    expect(batchCheckbox()).not.toBeChecked()

    // Nothing is saved anywhere: a new visit starts from single OFF / batch ON again.
    view.unmount()
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await screen.findByRole('group', { name: HEADING })
    expect(singleCheckbox()).not.toBeChecked()
    expect(batchCheckbox()).toBeChecked()
    expect(window.localStorage.length).toBe(0)
  })

  it('reaches both Checkboxes and the buttons with the keyboard', async () => {
    const user = userEvent.setup()
    const { deps } = setup({ targets: [target('target.a', '目標A', '2026-01-01T00:00:00.000Z')] })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await screen.findByRole('group', { name: HEADING })
    singleCheckbox().focus()
    await user.keyboard(' ')
    expect(singleCheckbox()).toBeChecked()
    await user.tab()
    expect(batchCheckbox()).toHaveFocus()
    await user.keyboard(' ')
    expect(batchCheckbox()).not.toBeChecked()
    await user.tab()
    expect(screen.getByRole('button', { name: '検索開始' })).toHaveFocus()
  })
})

describe('SearchPage single search with the source exclusion', () => {
  const searched = target('target.searched', '検索する目標', '2026-01-01T00:00:00.000Z')
  const other = target('target.other', '別の目標', '2026-01-02T00:00:00.000Z')
  const usedWeapon = weapon('owned.used', '他で使う武器', '2026-01-01T00:00:00.000Z')

  it('prepares the ordinary input with the box off and the excluding input with it on', async () => {
    const user = userEvent.setup()
    const { client, deps, prepareInput } = setup({
      targets: [searched, other],
      ownedWeapons: [usedWeapon],
      snapshotFor: () => snapshotOf(searched, [{ weapon: usedWeapon, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: other.id }] }], [other]),
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(1))
    expect(prepareInput.mock.calls[0][0]).toMatchObject({ targetWeaponId: searched.id, excludeOtherTargetSources: false })
    expect('excludedSourceOwnedWeaponIds' in client.last.input).toBe(false)
    client.resolveLast(null)
    expect(await within(await screen.findByRole('region', { name: '検索結果' })).findByText(OFF)).toBeInTheDocument()

    await user.click(singleCheckbox())
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(2))
    expect(prepareInput.mock.calls[1][0]).toMatchObject({ targetWeaponId: searched.id, excludeOtherTargetSources: true })
    expect(client.last.input.excludedSourceOwnedWeaponIds).toEqual([usedWeapon.id])
  })

  it('never searches an input that does not say what the condition asks for', async () => {
    const user = userEvent.setup()
    const { client, deps } = setup({
      targets: [searched],
      // Ignores the condition: no exclusion although it was asked for.
      prepare: async (options) => {
        const input = { ...createFixtureInput(), ...options, targetWeapons: [searched] }
        delete (input as Partial<PrepareCandidateSearchInputOptions>).excludeOtherTargetSources
        return preparedFixtureInput(input, false)
      },
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await startSingleSearch(user)
    expect(await screen.findByText(/検索条件（他の目標武器で使用する所持武器の除外）を検索入力へ反映できなかったため、検索を開始しませんでした。/)).toBeInTheDocument()
    expect(client.requests).toHaveLength(0)
    expect(screen.getByRole('button', { name: '検索開始' })).toBeEnabled()
  })

  it('keeps the running search and the shown result on the condition they started with', async () => {
    const user = userEvent.setup()
    const { client, deps } = setup({
      targets: [searched, other],
      ownedWeapons: [usedWeapon],
      snapshotFor: () => snapshotOf(searched, [{ weapon: usedWeapon, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: other.id }] }], [other]),
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await startSingleSearch(user)
    const progress = await screen.findByRole('status')
    expect(within(progress).getByText(ON)).toBeInTheDocument()
    await waitFor(() => expect(client.requests).toHaveLength(1))

    // Unticked while it runs: neither the request nor the progress changes.
    await user.click(singleCheckbox())
    expect(singleCheckbox()).not.toBeChecked()
    expect(within(screen.getByRole('status')).getByText(ON)).toBeInTheDocument()
    expect(client.requests).toHaveLength(1)
    expect(client.last.input.excludedSourceOwnedWeaponIds).toEqual([usedWeapon.id])

    client.resolveLast(null, [usedWeapon.id])
    const result = await screen.findByRole('region', { name: '検索結果' })
    expect(within(result).getByText(ON)).toBeInTheDocument()
    expect(within(result).getByText('他の目標武器で使用する所持武器（1本）を起点から除外して検索しました。')).toBeInTheDocument()

    // Ticked and unticked again after the result: the shown result keeps its own condition.
    await user.click(singleCheckbox())
    await user.click(singleCheckbox())
    expect(within(resultRegion()).getByText(ON)).toBeInTheDocument()

    // The next search uses the box as it is now.
    await startSingleSearch(user)
    expect(within(await screen.findByRole('status')).getByText(OFF)).toBeInTheDocument()
    // The earlier result and its exclusion are gone while the new search runs.
    expect(screen.queryByRole('region', { name: '検索結果' })).not.toBeInTheDocument()
    await waitFor(() => expect(client.requests).toHaveLength(2))
    client.rejectLast(new Error('fixture failure'))
    expect(await screen.findByText('fixture failure')).toBeInTheDocument()
    expect(screen.queryByText(/所持武器の除外/)).not.toBeInTheDocument()
  })

  it('drops a late preparation of a cancelled search so it never overwrites the next one', async () => {
    const user = userEvent.setup()
    let releaseFirst: (() => void) | null = null
    const { client, deps, prepareInput } = setup({ targets: [searched] })
    const ordinary = prepareInput.getMockImplementation()!
    prepareInput.mockImplementationOnce((options) => new Promise((resolve) => {
      releaseFirst = () => resolve(ordinary(options))
    }))
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await startSingleSearch(user)
    await waitFor(() => expect(releaseFirst).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    // The second search runs with the box off.
    await user.click(singleCheckbox())
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(1))
    releaseFirst!()
    // The first preparation lands late and starts nothing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.requests).toHaveLength(1)
    expect('excludedSourceOwnedWeaponIds' in client.last.input).toBe(false)
    client.resolveLast(null)
    expect(within(await screen.findByRole('region', { name: '検索結果' })).getByText(OFF)).toBeInTheDocument()
  })
})

describe('SearchPage source exclusion result', () => {
  // IDs sort the other way from registration order.
  const searched = target('target.m-searched', '検索する目標', '2026-01-01T00:00:00.000Z')
  const first = target('target.z-first', '目標・一番目（検索時の名前）', '2026-01-02T00:00:00.000Z')
  const second = target('target.a-second', '目標・二番目', '2026-01-03T00:00:00.000Z')
  const weaponFirst = weapon('owned.z-first', '所持武器・一番目'.repeat(4), '2026-01-01T00:00:00.000Z')
  const weaponSecond = weapon('owned.a-second', '所持武器・二番目', '2026-01-02T00:00:00.000Z')
  const derivedOnly = weapon('owned.m-derived-only', '起点にならなかった武器', '2026-01-03T00:00:00.000Z')
  const usages: Usage[] = [
    { weapon: weaponFirst, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: first.id }] },
    {
      weapon: weaponSecond,
      reasons: [
        { kind: 'build_list_entry_source', targetWeaponId: second.id, buildListEntryId: buildListEntryId('entry.second') },
        { kind: 'build_list_entry_source', targetWeaponId: first.id, buildListEntryId: buildListEntryId('entry.first') },
      ],
    },
    { weapon: derivedOnly, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: second.id }] },
  ]
  // The screen's own Target list names `first` differently: only the snapshot may name it.
  const currentFirst = { ...first, name: '目標・一番目（現在の名前）' }

  async function searchWithExclusion(excluded: OwnedWeaponId[], candidate: BuildCandidate | null = null) {
    const user = userEvent.setup()
    const harness = setup({
      targets: [searched, currentFirst, second],
      ownedWeapons: [weaponFirst, weaponSecond, derivedOnly],
      snapshotFor: () => snapshotOf(searched, usages, [first, second]),
    })
    const view = render(<SearchPage dependencies={harness.deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await startSingleSearch(user)
    await waitFor(() => expect(harness.client.requests).toHaveLength(1))
    harness.client.resolveLast(candidate, excluded)
    await screen.findByRole('region', { name: '検索結果' })
    return { user, view, ...harness }
  }

  it('names the weapons the Search really excluded and their reasons from the search\'s own read, in registration order', async () => {
    const { user, view } = await searchWithExclusion([weaponSecond.id, weaponFirst.id])
    const result = resultRegion()
    const alert = within(result).getByText('所持武器の除外').closest<HTMLElement>('[role="alert"]')!
    expect(alert.className).toMatch(/MuiAlert-colorInfo/)
    expect(within(alert).getByText('他の目標武器で使用する所持武器（2本）を起点から除外して検索しました。')).toBeInTheDocument()
    await user.click(within(alert).getByRole('button', { name: '除外した所持武器（2本）' }))
    const list = within(alert).getByRole('list', { name: '除外した所持武器' })
    const rows = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list)
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([weaponFirst.name, weaponSecond.name])
    expect(within(rows[0]).getByText('目標武器「目標・一番目（検索時の名前）」の優先する所持武器')).toBeInTheDocument()
    expect(within(rows[1]).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '目標武器「目標・一番目（検索時の名前）」の作成リストの候補が起点に使用',
      '目標武器「目標・二番目」の作成リストの候補が起点に使用',
    ])
    // Derived but not excluded by this search's Route bases: never shown.
    expect(within(alert).queryByText(derivedOnly.name)).not.toBeInTheDocument()
    expect(within(alert).queryByText(/現在の名前/)).not.toBeInTheDocument()
    // Kept apart from the Candidate Search notices, and no internal ID in the ordinary view.
    expect(within(result).queryByText('お知らせ')).not.toBeInTheDocument()
    expect(view.container.textContent).not.toMatch(/owned\.|target\.|entry\./)

    // A Checkbox change after the result never relabels it.
    await user.click(singleCheckbox())
    expect(within(resultRegion()).getByText(ON)).toBeInTheDocument()
    expect(within(resultRegion()).getByText('他の目標武器で使用する所持武器（2本）を起点から除外して検索しました。')).toBeInTheDocument()
  })

  it('follows the not-found guidance with the exclusion note only when weapons were excluded', async () => {
    const { view } = await searchWithExclusion([weaponFirst.id])
    expect(within(resultRegion()).getByText(NOT_FOUND)).toBeInTheDocument()
    expect(within(resultRegion()).getByText(/この検索では、他の目標武器で使用する所持武器（1本）を起点から除外したため、それらの所持武器からの作成ルートは探していません。除外をOFFにして検索すると/)).toBeInTheDocument()
    expect(view.container.textContent).not.toMatch(/存在しません|解がありません/)
  })

  it('shows no exclusion Alert and notes that nothing was excluded when the Search excluded nothing', async () => {
    await searchWithExclusion([])
    const result = resultRegion()
    expect(within(result).getByText(`${ON}（除外の対象になる所持武器はありませんでした）`)).toBeInTheDocument()
    expect(within(result).queryByText('所持武器の除外')).not.toBeInTheDocument()
    expect(within(result).getByText(NOT_FOUND)).toBeInTheDocument()
    expect(within(result).queryByText(/この検索では、他の目標武器で使用する所持武器/)).not.toBeInTheDocument()
  })

  it('keeps the ordinary result display with the box off', async () => {
    const user = userEvent.setup()
    const { client, deps } = setup({ targets: [searched], ownedWeapons: [weaponFirst] })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(1))
    client.resolveLast(null)
    const result = await screen.findByRole('region', { name: '検索結果' })
    expect(within(result).getByText(OFF)).toBeInTheDocument()
    expect(within(result).queryByText(/除外の対象になる所持武器/)).not.toBeInTheDocument()
    expect(within(result).queryByText('所持武器の除外')).not.toBeInTheDocument()
    expect(within(result).getByText(NOT_FOUND)).toBeInTheDocument()
  })

  it('adds the exclusion reason to the Issue #128 notice only when this search excluded the preferred weapon', async () => {
    const preferringSearched = { ...searched, preferredOwnedWeaponId: weaponSecond.id }
    const candidate = { ...createValidBuildCandidate(), id: candidateId('candidate.searched'), targetWeaponId: searched.id }
    const note = 'この検索では、優先する所持武器を起点から除外しました（目標武器「目標・一番目（検索時の名前）」、「目標・二番目」の作成リストの候補が起点に使用しているため）。'
    const user = userEvent.setup()
    const { client, deps } = setup({
      targets: [preferringSearched, currentFirst, second],
      ownedWeapons: [weaponFirst, weaponSecond],
      snapshotFor: () => snapshotOf(preferringSearched, usages.slice(0, 2), [first, second]),
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(1))
    client.resolveLast(candidate, [weaponSecond.id])
    const card = await screen.findByRole('region', { name: '理想候補' })
    const notice = within(card).getByText('優先する所持武器を使用しないルートです').closest<HTMLElement>('[role="alert"]')!
    expect(within(notice).getByText(note)).toBeInTheDocument()

    // A search that did not exclude the preferred weapon keeps the plain notice.
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(2))
    client.resolveLast(candidate, [weaponFirst.id])
    const plainCard = await screen.findByRole('region', { name: '理想候補' })
    expect(within(plainCard).getByText('優先する所持武器を使用しないルートです')).toBeInTheDocument()
    expect(within(plainCard).queryByText(/この検索では、優先する所持武器を起点から除外しました/)).not.toBeInTheDocument()
  })
})

describe('SearchPage batch search with the source exclusion', () => {
  const a = target('target.a', '目標A', '2026-01-01T00:00:00.000Z')
  const b = target('target.b', '目標B', '2026-01-02T00:00:00.000Z')
  const c = target('target.c', '目標C', '2026-01-03T00:00:00.000Z')
  const candidateFor = (value: TargetWeapon): BuildCandidate =>
    ({ ...createValidBuildCandidate(), id: candidateId(`candidate.${value.id}`), targetWeaponId: value.id })

  it('runs the whole batch with the exclusion on by default, whatever the box says later', async () => {
    const user = userEvent.setup()
    const { client, deps, prepareInput } = setup({ targets: [a, b, c] })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '未登録を一括検索・追加（3件）' }))
    const progress = await screen.findByRole('status')
    expect(within(progress).getByText(ON)).toBeInTheDocument()
    await waitFor(() => expect(client.requests).toHaveLength(1))

    // Unticked while the batch runs: the batch keeps its condition.
    await user.click(batchCheckbox())
    expect(batchCheckbox()).not.toBeChecked()
    expect(within(screen.getByRole('status')).getByText(ON)).toBeInTheDocument()
    client.resolveLast(candidateFor(a))
    await waitFor(() => expect(client.requests).toHaveLength(2))
    client.resolveLast(null, [ownedWeaponId('owned.x'), ownedWeaponId('owned.y')])
    await waitFor(() => expect(client.requests).toHaveLength(3))
    client.resolveLast(null)

    const summary = await screen.findByRole('region', { name: '一括検索・追加の結果' })
    expect(prepareInput.mock.calls.map(([options]) => options.excludeOtherTargetSources)).toEqual([true, true, true])
    expect(client.requests.every(({ input }) => Array.isArray(input.excludedSourceOwnedWeaponIds))).toBe(true)
    expect(within(summary).getByText(ON)).toBeInTheDocument()
    expect(within(summary).getByRole('list', { name: '一括検索・追加の件数' })).toHaveTextContent('候補なし2件')
    await user.click(within(summary).getByText('候補なし（2件）'))
    // Only the Target whose search really excluded weapons gets the count.
    expect(await within(summary).findByText(summaryRow('目標B（除外した所持武器 2本）'))).toBeInTheDocument()
    expect(within(summary).getByText(summaryRow('目標C'))).toBeInTheDocument()
    expect(within(summary).queryByText(/目標C（除外した所持武器/)).not.toBeInTheDocument()
    await user.click(within(summary).getByText('作成リストへ追加（1件）'))
    expect(await within(summary).findByText('目標A')).toBeInTheDocument()

    // A later change of the box never relabels the summary shown.
    await user.click(batchCheckbox())
    expect(within(screen.getByRole('region', { name: '一括検索・追加の結果' })).getByText(ON)).toBeInTheDocument()
  })

  it('runs the batch with the exclusion off once the user unticks it', async () => {
    const user = userEvent.setup()
    const { client, deps, prepareInput } = setup({ targets: [a, b] })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: BATCH_CHECKBOX }))
    await user.click(screen.getByRole('button', { name: '未登録を一括検索・追加（2件）' }))
    expect(within(await screen.findByRole('status')).getByText(OFF)).toBeInTheDocument()
    await waitFor(() => expect(client.requests).toHaveLength(1))
    client.resolveLast(null)
    await waitFor(() => expect(client.requests).toHaveLength(2))
    client.resolveLast(null)
    const summary = await screen.findByRole('region', { name: '一括検索・追加の結果' })
    expect(prepareInput.mock.calls.map(([options]) => options.excludeOtherTargetSources)).toEqual([false, false])
    expect(client.requests.every(({ input }) => !('excludedSourceOwnedWeaponIds' in input))).toBe(true)
    expect(within(summary).getByText(OFF)).toBeInTheDocument()
    await user.click(within(summary).getByText('候補なし（2件）'))
    expect(await within(summary).findByText('目標A')).toBeInTheDocument()
    expect(within(summary).queryByText(/除外した所持武器/)).not.toBeInTheDocument()
  })

  it('never uses the single-search box for the batch, nor the batch box for a single search', async () => {
    const user = userEvent.setup()
    const { client, deps, prepareInput } = setup({ targets: [a] })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('checkbox', { name: SINGLE }))
    await user.click(batchCheckbox())
    // Single ON / batch OFF now.
    await user.click(screen.getByRole('button', { name: '未登録を一括検索・追加（1件）' }))
    await waitFor(() => expect(client.requests).toHaveLength(1))
    client.resolveLast(null)
    await screen.findByRole('region', { name: '一括検索・追加の結果' })
    await waitFor(() => expect(screen.getByRole('button', { name: '検索開始' })).toBeEnabled())
    await startSingleSearch(user)
    await waitFor(() => expect(client.requests).toHaveLength(2))
    expect(prepareInput.mock.calls.map(([options]) => options.excludeOtherTargetSources)).toEqual([false, true])
  })
})
