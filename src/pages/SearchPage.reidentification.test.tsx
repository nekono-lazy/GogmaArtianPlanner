import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { BuildCandidate, TargetWeapon } from '../domain/models/publicTypes'
import type {
  CandidateSearchInput,
  CandidateSearchResult,
} from '../domain/search'
import type { PersistentReidentificationReminder } from '../services/execution/persistentReidentificationReminderService'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { createValidBuildCandidate, createValidTargetWeapon } from '../test/fixtures/domainData'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import type { SearchWorkerClient } from '../services/search/searchWorkerClient'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/**
 * The persistent re-identification reminder on Candidate Search
 * (`docs/PLANNER_SPEC.md` 16.15, `docs/UI_FLOW.md` 8): a warning above the
 * search conditions that says the prediction positions may not match the game
 * - and nothing more: the search itself stays available, and a completed
 * search changes no provenance, so the reminder stays.
 */

const TITLE = '予測と異なる結果が出たため、再特定が必要です'

class ImmediateClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly cancelSearch = vi.fn()
  readonly dispose = vi.fn()
  readonly startSearch = vi.fn(async (input: CandidateSearchInput): Promise<CandidateSearchResult> => ({
    searchRunId: input.searchRunId,
    calculationContext: input.calculationContext,
    targetResult: { targetWeaponId: input.targetWeaponId, candidate: this.candidate, searchedRoutes: ['normal_artian_to_gogma'], skippedRoutes: [] },
    warnings: [],
    elapsedMs: 1,
  }))
  private readonly candidate: BuildCandidate | null
  constructor(candidate: BuildCandidate | null) { this.candidate = candidate }
}

function dependencies(
  client: SearchWorkerClient,
  reminder: () => Promise<PersistentReidentificationReminder>,
  targets: TargetWeapon[] = [createValidTargetWeapon()],
): SearchPageDependencies {
  const master = createValidMasterDataFixture()
  return {
    master,
    getTargets: async () => targets,
    getOwnedWeapons: async () => [],
    getBuildListEntries: async () => [],
    getReidentificationReminder: vi.fn(reminder),
    createWorkerClient: () => client,
    createInput: async (options) => ({
      ...createFixtureInput(),
      ...options,
      targetWeapons: targets,
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
    addCandidate: vi.fn(async () => { throw new Error('not expected') }),
    inspectCandidateReplacement: vi.fn(async () => { throw new Error('not expected') }),
    replaceCandidate: vi.fn(async () => { throw new Error('not expected') }),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not expected') }),
  }
}

const both: PersistentReidentificationReminder = {
  kind: 'actual_result_different',
  rngRequired: true,
  normalCounters: [{ normalCounterId: 'weapon.fixture.a:8', weaponTypeId: 'weapon.fixture.a' }],
  hasUnresolvableNormalCounter: false,
}

function renderSearch(deps: SearchPageDependencies) {
  return render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
}

describe('SearchPage persistent re-identification reminder', () => {
  it('S1: shows the warning with the prediction position note above the search conditions', async () => {
    renderSearch(dependencies(new ImmediateClient(null), async () => both))
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText('この検索に使われる予測位置が、ゲーム側と一致していない可能性があります。')).toBeInTheDocument()
    expect(within(alert).getByText('予測と異なる結果が記録された後、RNG状態の再特定がまだ完了していません。')).toBeInTheDocument()
    expect(within(alert).getByText('予測と異なる結果が記録された後、通常アーティアCounterの再特定がまだ完了していません。')).toBeInTheDocument()
    const conditions = await screen.findByRole('region', { name: '検索条件' })
    expect(alert.compareDocumentPosition(conditions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('S2: links the RNG Setup for the RNG stream and the Normal Counters for the Normal stream', async () => {
    renderSearch(dependencies(new ImmediateClient(null), async () => both))
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
    expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
  })

  it('shows nothing when nothing is unresolved', async () => {
    renderSearch(dependencies(new ImmediateClient(null), async () => ({ kind: 'none' })))
    await screen.findByRole('region', { name: '検索条件' })
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('S3 / S4: the search stays available and the reminder stays after a completed search', async () => {
    const user = userEvent.setup()
    const client = new ImmediateClient(createValidBuildCandidate())
    const deps = dependencies(client, async () => both)
    renderSearch(deps)
    await screen.findByText(TITLE)
    const start = await screen.findByRole('button', { name: '検索開始' })
    expect(start).toBeEnabled()
    await user.click(start)
    expect(await screen.findByRole('region', { name: '検索結果' })).toBeInTheDocument()
    expect(client.startSearch).toHaveBeenCalledTimes(1)
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    // A search re-reads no provenance and never hides the reminder.
    expect(deps.getReidentificationReminder).toHaveBeenCalledTimes(1)
  })

  it('shows a read failure as such, never as "nothing to re-identify", and keeps the search usable', async () => {
    renderSearch(dependencies(new ImmediateClient(null), async () => { throw new Error('IndexedDB unavailable') }))
    expect(await screen.findByText('再特定の状態を確認できませんでした。予測と異なる結果が記録されている場合、再特定が必要な可能性があります。')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '検索開始' })).toBeEnabled()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })
})
