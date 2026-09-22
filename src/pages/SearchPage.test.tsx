import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  BuildCandidate,
  BuildListEntry,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../domain/buildList'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  intermediateOpportunityAt,
} from '../test/fixtures/checkpointRoute'
import type {
  CandidateSearchInput,
  CandidateSearchProgress,
  CandidateSearchResult,
} from '../domain/search'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  createValidBuildCandidate,
  createValidTargetWeapon,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  SearchWorkerRuntimeError,
  type SearchWorkerClient,
  type SearchWorkerClientCallbacks,
} from '../services/search/searchWorkerClient'
import { hasStyleRule } from '../test/cssRuleAssertions'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

class ControlledClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly cancelSearch = vi.fn()
  readonly dispose = vi.fn()
  input: CandidateSearchInput | null = null
  callbacks: SearchWorkerClientCallbacks = {}
  private resolveSearch: ((result: CandidateSearchResult) => void) | null = null
  private rejectSearch: ((error: Error) => void) | null = null
  startSearch(input: CandidateSearchInput, callbacks: SearchWorkerClientCallbacks = {}) {
    this.input = input
    this.callbacks = callbacks
    return new Promise<CandidateSearchResult>((resolve, reject) => {
      this.resolveSearch = resolve
      this.rejectSearch = reject
    })
  }
  progress(progress: CandidateSearchProgress) { this.callbacks.onProgress?.(progress) }
  resolve(result: CandidateSearchResult) { this.resolveSearch?.(result) }
  reject(error: Error) { this.rejectSearch?.(error) }
}

function resultFor(
  target: TargetWeapon,
  candidate: BuildCandidate | null,
  skippedRoutes: CandidateSearchResult['targetResult']['skippedRoutes'] = [],
): CandidateSearchResult {
  return {
    searchRunId: 'ui-run',
    calculationContext: createFixtureInput().calculationContext,
    targetResult: { targetWeaponId: target.id, candidate, searchedRoutes: ['normal_artian_to_gogma'], skippedRoutes },
    warnings: [],
    elapsedMs: 1,
  }
}

function resultWithNotices(
  target: TargetWeapon,
  warnings: CandidateSearchResult['warnings'],
): CandidateSearchResult {
  return { ...resultFor(target, null), warnings }
}

function dependencies(
  client: ControlledClient,
  targets = [createValidTargetWeapon()],
  buildListEntries: BuildListEntry[] = [],
  master = createValidMasterDataFixture(),
): SearchPageDependencies {
  return {
    master,
    getTargets: async () => targets,
    getOwnedWeapons: async () => [],
    getBuildListEntries: async () => buildListEntries,
    getReidentificationReminder: async () => ({ kind: 'none' as const }),
    createWorkerClient: () => client,
    createInput: async (options) => {
      const fixture = createFixtureInput()
      return {
        ...fixture,
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
      }
    },
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async (candidate, target, intermediateStateSelection) => ({
      entry: createBuildListEntry(candidate, target, { intermediateStateSelection }),
      added: true,
    })),
  }
}

describe('SearchPage', () => {
  it('shows the Target empty state', async () => {
    render(<SearchPage dependencies={dependencies(new ControlledClient(), [])} />, { wrapper: MemoryRouter })
    expect(await screen.findByText('目標武器を登録してください。')).toBeInTheDocument()
  })

  it('searches exactly one Target and renders its canonical Ideal Candidate', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    // One Target per search: reconciling several Targets is the Planner's job
    // (`docs/UI_FLOW.md` 6.1).
    expect(client.input?.targetWeaponId).toBe(target.id)
    expect(client.input?.calculationContext).toEqual({
      gameVersion: deps.master.manifest.gameVersion,
      masterDataVersion: deps.master.manifest.dataVersion,
      rngEngineVersion: client.engineVersion,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    })
    const candidate = createValidBuildCandidate()
    client.resolve(resultFor(target, candidate))
    expect(await screen.findByText('理想候補')).toBeInTheDocument()
    expect(deps.saveCandidates).toHaveBeenCalledWith(target.id, [candidate])
  })

  it('keeps a long Target selectable and search cancellable with the small-screen control contracts', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const first = createValidTargetWeapon()
    const second = { ...first, id: targetWeaponId('target.acceptance.long'), name: '長い目標武器名'.repeat(12) }
    render(<SearchPage dependencies={dependencies(client, [first, second])} />, { wrapper: MemoryRouter })
    const selector = await screen.findByRole('combobox', { name: '検索対象の目標武器' })
    expect(hasStyleRule(selector, 'white-space', 'normal')).toBe(true)
    expect(hasStyleRule(selector, 'overflow-wrap', 'anywhere')).toBe(true)
    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: second.name }))
    expect(selector).toHaveTextContent(second.name)
    const start = screen.getByRole('button', { name: '検索開始' })
    expect(getComputedStyle(start).minHeight).toBe('44px')
    await user.click(start)
    expect(client.input?.targetWeaponId).toBe(second.id)
    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    expect(getComputedStyle(cancel).minHeight).toBe('44px')
    await user.click(cancel)
    expect(client.cancelSearch).toHaveBeenCalledTimes(1)
    client.resolve(resultFor(second, null))
    await waitFor(() => expect(screen.getByRole('button', { name: '検索開始' })).toBeEnabled())
  })

  it('offers no result filter and no output-cap settings at all', async () => {
    render(<SearchPage dependencies={dependencies(new ControlledClient())} />, { wrapper: MemoryRouter })
    await screen.findByRole('button', { name: '検索開始' })
    // A Search result is one canonical Ideal or nothing, so there is nothing to
    // filter by category or by closeness (`docs/UI_FLOW.md` 6.1).
    expect(screen.queryByText('理想に近い実用')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('目標武器ごとの最大候補数')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('理想に近いと判定する類似度')).not.toBeInTheDocument()
  })

  it('shows the searched Target, phase, and settled work while it searches', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    expect(screen.getByText(`対象: ${target.name}`)).toBeInTheDocument()
    expect(screen.getByText('準備中')).toBeInTheDocument()
    expect(screen.getByText('探索ステップ: 0')).toBeInTheDocument()

    client.progress({ targetWeaponId: target.id, phase: 'searching', processedWorkItems: 1200 })
    expect(await screen.findByText('探索ステップ: 1200')).toBeInTheDocument()
    expect(screen.getByText('探索中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
  })

  it('clears the searching state and shows the message on a native Worker failure', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.reject(new SearchWorkerRuntimeError('worker_error', 'boom'))
    expect(
      await screen.findByText(/Search Workerでエラーが発生したため検索を続行できません。/),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/検索中 /)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
  })

  it('shows a normal zero-result state and Worker errors separately', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const zeroClient = new ControlledClient()
    const view = render(<SearchPage dependencies={dependencies(zeroClient, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    zeroClient.resolve(resultFor(target, null))
    // Never "no Ideal exists": only "not inside the configured extent"
    // (`docs/SEARCH_SPEC.md` 5.7).
    expect(await screen.findByText(/現在の探索範囲では理想品が見つかりませんでした。/)).toBeInTheDocument()
    view.unmount()

    const errorClient = new ControlledClient()
    render(<SearchPage dependencies={dependencies(errorClient, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    errorClient.reject(new Error('Worker fixture error'))
    expect(await screen.findByText('Worker fixture error')).toBeInTheDocument()
  })

  it('shows skipped routes with their concrete RouteKind label', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const client = new ControlledClient()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, null, [{
      route: 'owned_normal_artian_to_gogma',
      reason: 'no_owned_weapon_available',
      detail: 'fixture',
    }]))
    await user.click(await screen.findByText('実行できなかった作成ルート'))
    expect(await screen.findByText(/所持通常アーティアから巨戟化/)).toBeInTheDocument()
  })

  it('cancels and ignores a late result for the obsolete request', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByText('検索をキャンセルしました。')).toBeInTheDocument()
    client.resolve(resultFor(target, createValidBuildCandidate()))
    await waitFor(() => expect(screen.queryByText(/理想候補/)).not.toBeInTheDocument())
    expect(client.cancelSearch).toHaveBeenCalledOnce()
  })

  it('presents a successful narrower search as a notice rather than a warning', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const client = new ControlledClient()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultWithNotices(target, [{
      targetWeaponId: target.id,
      severity: 'info',
      message: '通常アーティアの初期ボーナスを使わないルートで検索しました。',
    }]))

    const heading = await screen.findByText('お知らせ')
    expect(heading).toBeInTheDocument()
    expect(screen.queryByText('警告')).not.toBeInTheDocument()
    expect(heading.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorInfo')
  })

  it('keeps a genuine warning in a warning Alert', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const client = new ControlledClient()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultWithNotices(target, [{
      targetWeaponId: target.id,
      severity: 'warning',
      message: '通常アーティア経由のルートは検索していません。',
    }]))

    const heading = await screen.findByText('警告')
    expect(screen.queryByText('お知らせ')).not.toBeInTheDocument()
    expect(heading.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
  })

  it('separates notices from warnings when both are present', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const client = new ControlledClient()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultWithNotices(target, [
      { targetWeaponId: target.id, severity: 'warning', message: '警告メッセージfixture' },
      { targetWeaponId: target.id, severity: 'info', message: 'お知らせメッセージfixture' },
    ]))

    const infoAlert = (await screen.findByText('お知らせ')).closest('.MuiAlert-root')
    const warningAlert = screen.getByText('警告').closest('.MuiAlert-root')
    expect(infoAlert).not.toBe(warningAlert)
    expect(infoAlert).toHaveTextContent('お知らせメッセージfixture')
    expect(infoAlert).not.toHaveTextContent('警告メッセージfixture')
    expect(warningAlert).toHaveTextContent('警告メッセージfixture')
    expect(warningAlert).not.toHaveTextContent('お知らせメッセージfixture')
  })

  it('adds a displayed Candidate to Build List through the service boundary', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    const candidate = createValidBuildCandidate()
    client.resolve(resultFor(target, candidate))
    await user.click(await screen.findByRole('button', { name: 'ビルドリストへ追加' }))
    // Intermediate states start unselected, so a fresh result selects none.
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target, defaultIntermediateStateSelection())
    expect(screen.getByText('ビルドリストへ追加しました。')).toBeInTheDocument()
  })

  it('shows a load failure without the Target empty state or a search form', async () => {
    const deps = dependencies(new ControlledClient(), [createValidTargetWeapon()])
    deps.getTargets = async () => {
      throw new Error('読み込みfixture失敗')
    }
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    expect(await screen.findByText('読み込みfixture失敗')).toBeInTheDocument()
    // A failed load is never presented as "no Targets", and no synthetic
    // Target is offered to search.
    expect(screen.queryByText('目標武器を登録してください。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '検索開始' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('検索対象の目標武器')).not.toBeInTheDocument()
  })

  it('heads the search conditions and detail settings with sequential headings', async () => {
    const user = userEvent.setup()
    render(<SearchPage dependencies={dependencies(new ControlledClient())} />, { wrapper: MemoryRouter })
    await screen.findByRole('button', { name: '検索開始' })

    expect(screen.getByRole('heading', { level: 1, name: '候補検索' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '検索条件' })).toBeInTheDocument()
    expect(screen.getByLabelText('検索対象の目標武器')).toBeInTheDocument()
    expect(screen.getByLabelText('作成ルート')).toBeInTheDocument()
    // The Accordion heading slot is the only heading around its toggle.
    const toggle = screen.getByRole('button', { name: '詳細設定（探索量の上限）' })
    expect(screen.getByRole('heading', { level: 3, name: '詳細設定（探索量の上限）' })).toContainElement(toggle)
    expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(await screen.findByLabelText('通常アーティア最大進行量')).toBeInTheDocument()
    expect(screen.getByLabelText('巨戟最大進行量')).toBeInTheDocument()
    expect(screen.getByLabelText('スキル最大進行量')).toBeInTheDocument()
  })

  it('shows an add failure and the duplicate notice next to the Candidate', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    let attempt = 0
    deps.addCandidate = vi.fn(async (candidate, target) => {
      attempt += 1
      if (attempt === 1) throw new Error('追加fixture失敗')
      return { entry: createBuildListEntry(candidate, target), added: false }
    })
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, createValidBuildCandidate()))

    const addButton = await screen.findByRole('button', { name: 'ビルドリストへ追加' })
    const card = screen.getByRole('heading', { level: 3, name: '理想候補' }).closest('section')
    expect(card).toContainElement(addButton)

    await user.click(addButton)
    expect(await screen.findByText('追加fixture失敗')).toBeInTheDocument()
    expect(card).toHaveTextContent('追加fixture失敗')

    // The existing Build List selection is never overwritten from here. The
    // Service's duplicate answer turns the Candidate's state to "added", and
    // the guidance sentence appears exactly once rather than as feedback plus
    // permanent notice.
    await user.click(addButton)
    const duplicate = await screen.findByText(
      'この候補は作成リストに追加済みです。途中採用する状態と改善優先は作成リストで変更してください。',
    )
    expect(card).toContainElement(duplicate)
    expect(screen.getAllByText(/この候補は作成リストに追加済みです/)).toHaveLength(1)
    expect(screen.getByText('作成リスト: 追加済み')).toBeInTheDocument()
    expect(addButton).toBeDisabled()
    expect(screen.queryByText('追加fixture失敗')).not.toBeInTheDocument()
  })

  it('keeps at most one selected state per lane and passes the preference on', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    const candidate = checkpointCandidateWithArrivals()
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, candidate))

    const primary = await screen.findByRole('checkbox', { name: BONUS_ONE })
    expect(primary).not.toBeChecked()
    await user.click(primary)
    expect(primary).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'その他の到達点（1）' }))
    const later = await screen.findByRole('checkbox', { name: BONUS_TWO })
    await user.click(later)
    // Choosing another arrival on the same lane replaces the first one.
    expect(later).toBeChecked()
    expect(primary).not.toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'スキルを優先' }))

    await user.click(screen.getByRole('button', { name: 'ビルドリストへ追加' }))
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target, {
      skillOpportunityId: null,
      bonusOpportunityId: intermediateOpportunityAt(candidate, 'bonus', 2).opportunity.id,
      improvementPreference: 'skill_first',
    })

    // The draft selection stays editable afterwards, while the Candidate is
    // now added and the button no longer offers a second addition.
    await user.click(later)
    expect(later).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'ビルドリストへ追加' })).toBeDisabled()
    expect(deps.addCandidate).toHaveBeenCalledOnce()
  })
})

const BONUS_ONE = 'この途中状態を採用する: 復元ボーナス操作1回目（再抽選）の直後'
const BONUS_TWO = 'この途中状態を採用する: 復元ボーナス操作2回目（再抽選）の直後'

/** A Candidate whose Bonus lane reaches one Practical product twice before the Ideal. */
function checkpointCandidateWithArrivals(): BuildCandidate {
  return checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointIdealBonuses(),
  ])
}

/**
 * A Build List Entry whose snapshot means the same as the fixture Candidate
 * but was found on another search run, so its Candidate ID differs.
 */
function equivalentEntryFor(candidate: BuildCandidate, target: TargetWeapon): BuildListEntry {
  const earlier = {
    ...structuredClone(candidate),
    id: 'candidate.fixture.earlier-run' as BuildCandidate['id'],
    searchRunId: 'search-run.fixture.earlier',
  }
  return createBuildListEntry(earlier, target, {
    id: 'build-list.fixture.earlier' as BuildListEntry['id'],
    intermediateStateSelection: {
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: intermediateOpportunityAt(candidate, 'bonus', 2).opportunity.id,
    },
  })
}

async function searchFor(
  user: ReturnType<typeof userEvent.setup>,
  client: ControlledClient,
  target: TargetWeapon,
  candidate: BuildCandidate,
) {
  await user.click(await screen.findByRole('button', { name: '検索開始' }))
  client.resolve(resultFor(target, candidate))
  return screen.findByRole('button', { name: 'ビルドリストへ追加' })
}

describe('SearchPage disclosure ARIA wiring', () => {
  it('links every disclosure toggle to its own content region with unique ids', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const candidate = checkpointCandidateWithArrivals()
    render(<SearchPage dependencies={dependencies(client, [target])} />, { wrapper: MemoryRouter })
    await searchFor(user, client, target, candidate)

    // Detail settings, Candidate detail, later arrivals, skipped routes are
    // all closed disclosures at this point. A panel that unmounts while closed
    // has no region yet, so each one is opened before its region is checked.
    const toggles = screen.getAllByRole('button', { expanded: false })
    expect(toggles.length).toBeGreaterThanOrEqual(3)
    for (const toggle of toggles) {
      expect(toggle.id).not.toBe('')
      const contentId = toggle.getAttribute('aria-controls')
      expect(contentId).toBeTruthy()
      expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
      await user.click(toggle)
      await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
      const region = document.getElementById(contentId as string)
      expect(region).not.toBeNull()
      expect(region).not.toBe(toggle)
      expect(region).toHaveAttribute('aria-labelledby', toggle.id)
    }
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('SearchPage Master Data readiness', () => {
  /** The bundled Production Master: Lottery placeholder and material costs all disabled. */
  function productionLikeMaster() {
    const master = createValidMasterDataFixture()
    master.lotteries = master.lotteries.map((lottery) => ({ ...lottery, isEnabled: false }))
    master.materialCosts = master.materialCosts.map((cost) => ({ ...cost, isEnabled: false }))
    return master
  }

  it('keeps Search available with a disabled Lottery Master and shows only the material cost advisory', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target], [], productionLikeMaster())
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    const button = await screen.findByRole('button', { name: '検索開始' })
    // The provisional Lottery Master is never a Search readiness input
    // (`docs/MASTER_DATA_STATUS.md`), so no normal-UI sentence mentions it.
    expect(screen.queryByText(/抽選マスターデータ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/通常アーティア経由の検索は利用できません/)).not.toBeInTheDocument()
    expect(screen.queryByText(/検索は利用できません/)).not.toBeInTheDocument()
    // The unverified material cost is an advisory that says Search still works.
    const advisory = screen.getByText(/素材コストは未検証です。/)
    expect(advisory).toHaveTextContent('候補検索は利用できますが')
    expect(button).toBeEnabled()

    await user.click(button)
    expect(client.input?.targetWeaponId).toBe(target.id)
    expect(client.input?.master).not.toHaveProperty('lotteries')

    const candidate = { ...createValidBuildCandidate(), requiredMaterials: [] }
    client.resolve(resultFor(target, candidate))
    expect(await screen.findByText('理想候補')).toBeInTheDocument()
    await user.click(screen.getByText('候補詳細・作成ルート'))
    const materials = screen.getByRole('heading', { name: '必要素材（アイテム）' })
      .parentElement as HTMLElement
    expect(
      within(materials).getByText('素材コストは未検証のため表示できません。'),
    ).toBeInTheDocument()
    expect(within(materials).queryByText('なし')).not.toBeInTheDocument()
  })

  it('shows no Master advisory at all when a material cost is usable', async () => {
    render(<SearchPage dependencies={dependencies(new ControlledClient())} />, { wrapper: MemoryRouter })
    await screen.findByRole('button', { name: '検索開始' })
    expect(screen.queryByText(/素材コストは未検証/)).not.toBeInTheDocument()
    expect(screen.queryByText(/抽選マスターデータ/)).not.toBeInTheDocument()
  })
})

describe('SearchPage Build List add state', () => {
  it('shows a not-yet-added Candidate as 未追加 with the add button enabled', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    render(<SearchPage dependencies={dependencies(client, [target], [])} />, { wrapper: MemoryRouter })
    const addButton = await searchFor(user, client, target, createValidBuildCandidate())

    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()
    expect(screen.queryByText('作成リスト: 追加済み')).not.toBeInTheDocument()
    expect(screen.queryByText(/この候補は作成リストに追加済みです/)).not.toBeInTheDocument()
    expect(addButton).toBeEnabled()
  })

  it('shows an equivalent Candidate found on another run as 追加済み before any click', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const candidate = checkpointCandidateWithArrivals()
    const entry = equivalentEntryFor(candidate, target)
    expect(entry.candidateId).not.toBe(candidate.id)
    expect(entry.intermediateStateSelection?.bonusOpportunityId).not.toBeNull()
    const deps = dependencies(client, [target], [entry])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    const addButton = await searchFor(user, client, target, candidate)

    // Decided by the Build List Domain authority, not by Candidate ID.
    expect(screen.getByText('作成リスト: 追加済み')).toBeInTheDocument()
    expect(screen.queryByText('作成リスト: 未追加')).not.toBeInTheDocument()
    expect(addButton).toBeDisabled()
    // The formal guidance is shown from the state alone, before any click,
    // exactly once, inside the Candidate's own card (`docs/UI_FLOW.md` 9).
    const guidance = screen.getAllByText(
      'この候補は作成リストに追加済みです。途中採用する状態と改善優先は作成リストで変更してください。',
    )
    expect(guidance).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 3, name: '理想候補' }).closest('section')).toContainElement(guidance[0])
    // The Search draft stays all-unselected: the Entry's own selection is
    // never restored into these checkboxes.
    expect(screen.getByRole('checkbox', { name: BONUS_ONE })).not.toBeChecked()
    expect(deps.addCandidate).not.toHaveBeenCalled()
  })

  it('treats a Candidate that differs in Domain meaning as 未追加', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const stored = checkpointCandidateWithArrivals()
    const entry = equivalentEntryFor(stored, target)
    render(<SearchPage dependencies={dependencies(client, [target], [entry])} />, { wrapper: MemoryRouter })
    // Same five labels, other restoration bonus scope: a different Candidate
    // under the existing fingerprint (`docs/DATA_MODEL.md` 9.1).
    const searched = { ...structuredClone(stored), restorationBonusScope: 'normal_artian' as const }
    const addButton = await searchFor(user, client, target, searched)

    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()
    expect(addButton).toBeEnabled()
  })

  it('turns 追加済み as soon as an addition succeeds, keeping the draft selection', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const candidate = checkpointCandidateWithArrivals()
    const deps = dependencies(client, [target], [])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    const addButton = await searchFor(user, client, target, candidate)
    const primary = screen.getByRole('checkbox', { name: BONUS_ONE })
    await user.click(primary)
    expect(screen.getByText('作成リスト: 未追加')).toBeInTheDocument()

    await user.click(addButton)
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target, {
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id,
    })
    expect(await screen.findByText('作成リスト: 追加済み')).toBeInTheDocument()
    expect(screen.queryByText('作成リスト: 未追加')).not.toBeInTheDocument()
    expect(addButton).toBeDisabled()
    expect(screen.getByText('ビルドリストへ追加しました。')).toBeInTheDocument()
    // The screen's own draft selection is untouched by the add.
    expect(primary).toBeChecked()
  })

  it('never restores an existing Entry selection into the Search draft', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const candidate = checkpointCandidateWithArrivals()
    const entry = equivalentEntryFor(candidate, target)
    expect(entry.intermediateStateSelection?.bonusOpportunityId).toBe(
      intermediateOpportunityAt(candidate, 'bonus', 2).opportunity.id,
    )
    const deps = dependencies(client, [target], [entry])
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })
    const addButton = await searchFor(user, client, target, candidate)

    expect(screen.getByText('作成リスト: 追加済み')).toBeInTheDocument()
    // The Entry selected the later arrival; the draft stays all-unselected.
    expect(screen.getByRole('checkbox', { name: BONUS_ONE })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'その他の到達点（1）' }))
    expect(await screen.findByRole('checkbox', { name: BONUS_TWO })).not.toBeChecked()
    // Nothing reaches the Service, so the Entry's selection cannot change.
    expect(addButton).toBeDisabled()
    expect(deps.addCandidate).not.toHaveBeenCalled()
  })

  it('reports a Build List load failure like any other load failure', async () => {
    const client = new ControlledClient()
    const deps = dependencies(client, [createValidTargetWeapon()])
    deps.getBuildListEntries = async () => {
      throw new Error('作成リスト読み込みfixture失敗')
    }
    render(<SearchPage dependencies={deps} />, { wrapper: MemoryRouter })

    expect(await screen.findByText('作成リスト読み込みfixture失敗')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '検索開始' })).not.toBeInTheDocument()
    expect(screen.queryByText('目標武器を登録してください。')).not.toBeInTheDocument()
    expect(screen.queryByText('作成リスト: 未追加')).not.toBeInTheDocument()
  })
})
