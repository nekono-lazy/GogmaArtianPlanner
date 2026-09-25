import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../domain/buildList'
import type { PlanBreakingChangeApproval, PlanBreakingChangeInspection } from '../domain/execution'
import type { BuildCandidate, BuildListEntry, TargetWeapon } from '../domain/models/publicTypes'
import type { CandidateSearchInput, CandidateSearchResult } from '../domain/search'
import {
  BuildListCardinalityError,
  type AddBuildListCandidateResult,
  type BuildListCandidateReplacementRequest,
} from '../services/buildList/buildListService'
import type { SearchWorkerClient, SearchWorkerClientCallbacks } from '../services/search/searchWorkerClient'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../test/fixtures/checkpointRoute'
import { buildListEntryId } from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { recommendedCandidateSearchDefaults } from '../domain/models/publicTypes'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/**
 * The Search screen's Build List replacement (`docs/UI_FLOW.md` 9,
 * `docs/DATA_MODEL.md` 9.4.1): another Candidate of a Target that already holds
 * one Entry is confirmed first, then saved as one guarded replacement; a legacy
 * duplicate is neither added nor replaced.
 */

const REPLACEMENT = { name: '作成リストの候補を置き換えますか？' } as const
const WARNING = { name: '実行中の生産計画があります' } as const
const NOT_CARRIED =
  '現在の候補で設定している「途中採用する状態」と「改善優先」は、新しい候補に引き継がれません。新しい候補には、この画面で選択している内容が登録されます。'
const LEGACY =
  'この目標武器には作成リストに複数の候補が登録されています。作成リストで使用する候補を1件にしてから、もう一度操作してください。'

class ControlledClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly cancelSearch = vi.fn()
  readonly dispose = vi.fn()
  private resolveSearch: ((result: CandidateSearchResult) => void) | null = null
  startSearch(_input: CandidateSearchInput, _callbacks: SearchWorkerClientCallbacks = {}) {
    void _input
    void _callbacks
    return new Promise<CandidateSearchResult>((resolve) => {
      this.resolveSearch = resolve
    })
  }
  resolve(result: CandidateSearchResult) { this.resolveSearch?.(result) }
}

function resultFor(target: TargetWeapon, candidate: BuildCandidate): CandidateSearchResult {
  return {
    searchRunId: 'ui-run',
    calculationContext: createFixtureInput().calculationContext,
    targetResult: { targetWeaponId: target.id, candidate, searchedRoutes: ['existing_gogma_mixed'], skippedRoutes: [] },
    warnings: [],
    elapsedMs: 1,
  }
}

/** A1 is the registered Entry (with a selection of its own), A2 the searched Candidate. */
function fixture() {
  const target = checkpointTarget()
  const registered = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])
  const searched = checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointIdealBonuses(),
  ])
  searched.id = 'candidate.checkpoint.searched' as typeof searched.id
  searched.searchRunId = 'ui-run'
  const a1 = createBuildListEntry(registered, target, {
    id: buildListEntryId('build-list.a1'),
    createdAt: '2026-09-20T00:00:00.000Z',
    intermediateStateSelection: {
      skillOpportunityId: null,
      bonusOpportunityId: intermediateOpportunityAt(registered, 'bonus', 1).opportunity.id,
      improvementPreference: 'bonus_first',
    },
  })
  const a2 = createBuildListEntry(searched, target, { id: buildListEntryId('build-list.a2'), createdAt: '2026-09-24T00:00:00.000Z' })
  return { target, searched, a1, a2 }
}

function harness(initialEntries: BuildListEntry[], addResult: AddBuildListCandidateResult, replaced: BuildListEntry) {
  const client = new ControlledClient()
  const master = createValidMasterDataFixture()
  const target = checkpointTarget()
  const deps = {
    master,
    getTargets: vi.fn(async () => [target]),
    getOwnedWeapons: vi.fn(async () => []),
    getBuildListEntries: vi.fn(async () => initialEntries),
    getReidentificationReminder: vi.fn(async () => ({ kind: 'none' as const })),
    getCandidateSearchDefaults: async () => ({ ...recommendedCandidateSearchDefaults }),
    createWorkerClient: () => client,
    createInput: vi.fn(async () => createFixtureInput()),
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async () => addResult),
    inspectCandidateReplacement: vi.fn<(request: BuildListCandidateReplacementRequest) => Promise<PlanBreakingChangeInspection>>(
      async () => ({ approvalRequired: false }),
    ),
    replaceCandidate: vi.fn(
      async (_request: BuildListCandidateReplacementRequest, _approval?: PlanBreakingChangeApproval | null) => {
        void _request
        void _approval
        return replaced
      },
    ),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not expected') }),
  } satisfies SearchPageDependencies
  return { deps, client, target }
}

async function searchAndAdd(
  user: ReturnType<typeof userEvent.setup>,
  client: ControlledClient,
  target: TargetWeapon,
  candidate: BuildCandidate,
) {
  await user.click(await screen.findByRole('button', { name: '検索開始' }))
  client.resolve(resultFor(target, candidate))
  await user.click(await screen.findByRole('button', { name: 'ビルドリストへ追加' }))
}

describe('SearchPage Build List replacement', () => {
  it('asks for the replacement first and writes nothing before it is confirmed', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    const dialog = within(await screen.findByRole('dialog', REPLACEMENT))
    expect(dialog.getByText(`目標武器: ${target.name}`)).toBeInTheDocument()
    expect(dialog.getByRole('heading', { name: '現在の候補' })).toBeInTheDocument()
    expect(dialog.getByRole('heading', { name: '新しい候補' })).toBeInTheDocument()
    expect(dialog.getByText(NOT_CARRIED)).toBeInTheDocument()
    // The registered Entry's own selection is shown as what is not carried over.
    expect(dialog.getByText('現在の途中採用する状態・改善優先（引き継がれません）')).toBeInTheDocument()
    expect(dialog.getByText('改善優先: 復元ボーナスを優先')).toBeInTheDocument()
    expect(dialog.getByText('改善優先: 生産計画に任せる')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '置き換える' })).toBeInTheDocument()
    // No raw identifier is shown in the comparison.
    expect(screen.getByRole('dialog', REPLACEMENT)).not.toHaveTextContent(a1.id)

    expect(deps.inspectCandidateReplacement).not.toHaveBeenCalled()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
  })

  it('changes nothing when the replacement is cancelled', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    await user.click(within(await screen.findByRole('dialog', REPLACEMENT)).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull())
    expect(deps.inspectCandidateReplacement).not.toHaveBeenCalled()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ビルドリストへ追加' })).toBeEnabled()

    // Esc is the same cancel.
    await user.click(screen.getByRole('button', { name: 'ビルドリストへ追加' }))
    expect(await screen.findByRole('dialog', REPLACEMENT)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull())
    expect(deps.inspectCandidateReplacement).not.toHaveBeenCalled()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
  })

  it('replaces A1 with A2 once confirmed when no Plan is broken, and shows the Candidate as added', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    await user.click(within(await screen.findByRole('dialog', REPLACEMENT)).getByRole('button', { name: '置き換える' }))

    expect(await screen.findByText('作成リストの候補を置き換えました。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull()
    expect(screen.queryByRole('dialog', WARNING)).toBeNull()
    const request: BuildListCandidateReplacementRequest = {
      candidate: searched,
      target,
      intermediateStateSelection: defaultIntermediateStateSelection(),
      expectedExistingEntryId: a1.id,
    }
    expect(deps.inspectCandidateReplacement).toHaveBeenCalledWith(request)
    expect(deps.replaceCandidate).toHaveBeenCalledOnce()
    expect(deps.replaceCandidate).toHaveBeenCalledWith(request, null)
    expect(screen.getByText('作成リスト: 追加済み')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ビルドリストへ追加' })).toBeDisabled()
  })

  it('shows the breaking-change warning after the replacement confirmation, and saves nothing on its cancel', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    deps.inspectCandidateReplacement.mockResolvedValue(planBreakingInspection({ reasons: ['build_list_changed'] }))
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    // The warning never stands in for the replacement confirmation.
    expect(screen.queryByRole('dialog', WARNING)).toBeNull()
    await user.click(within(await screen.findByRole('dialog', REPLACEMENT)).getByRole('button', { name: '置き換える' }))
    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('生産計画が使用する作成リスト項目が変わります')).toBeInTheDocument()
    expect(warning.getByText('作成リストの候補を置き換えると、現在の生産計画の前提と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()
    // The replacement confirmation stays as it was; its own cancel ends it.
    await user.click(within(screen.getByRole('dialog', REPLACEMENT)).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull())
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
  })

  it('saves the replacement with the approval the shared warning built', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    const inspection = planBreakingInspection({ reasons: ['build_list_changed'] })
    deps.inspectCandidateReplacement.mockResolvedValue(inspection)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    await user.click(within(await screen.findByRole('dialog', REPLACEMENT)).getByRole('button', { name: '置き換える' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText('作成リストの候補を置き換え、実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.replaceCandidate).toHaveBeenCalledOnce()
    expect(deps.replaceCandidate.mock.calls[0]?.[1]).toEqual(planBreakingApproval(inspection))
    expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull()
    expect(screen.getByText('作成リスト: 追加済み')).toBeInTheDocument()
  })

  it('reports a replacement the Service refused because the Entry changed, and never retries', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const { deps, client, target } = harness([a1], { status: 'replacement_required', existingEntry: a1 }, a2)
    deps.inspectCandidateReplacement.mockRejectedValue(new BuildListCardinalityError('replacement_target_changed'))
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    await user.click(within(await screen.findByRole('dialog', REPLACEMENT)).getByRole('button', { name: '置き換える' }))

    expect(
      await screen.findByText('置き換える作成リストの候補が変更されました。作成リストを確認してから、もう一度操作してください。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', REPLACEMENT)).toBeNull()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'ビルドリストを確認する' })).toHaveAttribute('href', '/build-list')
    // The add state is read again from the persisted Build List.
    await waitFor(() => expect(deps.getBuildListEntries).toHaveBeenCalledTimes(2))
  })

  it('neither adds nor replaces for a legacy duplicate and points to the Build List', async () => {
    const user = userEvent.setup()
    const { searched, a1, a2 } = fixture()
    const a3 = createBuildListEntry(checkpointCandidate([checkpointIdealBonuses()]), checkpointTarget(), {
      id: buildListEntryId('build-list.a3'),
      createdAt: '2026-09-21T00:00:00.000Z',
    })
    const { deps, client, target } = harness([a1, a3], { status: 'legacy_duplicate', entries: [a1, a3] }, a2)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    expect(await screen.findByText(LEGACY)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ビルドリストで整理する' })).toHaveAttribute('href', '/build-list')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deps.inspectCandidateReplacement).not.toHaveBeenCalled()
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()
  })

  it('keeps an equivalent Entry untouched and shows no dialog for a duplicate', async () => {
    const user = userEvent.setup()
    const { searched, a2 } = fixture()
    const { deps, client, target } = harness([], { status: 'duplicate', entry: a2 }, a2)
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await searchAndAdd(user, client, target, searched)

    expect(await screen.findByText('作成リスト: 追加済み')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByText(/この候補は作成リストに追加済みです/)).toHaveLength(1)
    expect(deps.replaceCandidate).not.toHaveBeenCalled()
  })
})
