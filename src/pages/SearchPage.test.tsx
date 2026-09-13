import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  BuildCandidate,
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  TargetWeapon,
} from '../domain/models/publicTypes'
import type {
  CandidateSearchInput,
  CandidateSearchProgress,
  CandidateSearchResult,
} from '../domain/search'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  createValidBuildCandidate,
  createValidTargetWeapon,
} from '../test/fixtures/domainData'
import { createCandidateSearchInput as createFixtureInput } from '../test/fixtures/candidateSearch'
import {
  SearchWorkerRuntimeError,
  type SearchWorkerClient,
  type SearchWorkerClientCallbacks,
} from '../services/search/searchWorkerClient'
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

function dependencies(client: ControlledClient, targets = [createValidTargetWeapon()]): SearchPageDependencies {
  const master = createValidMasterDataFixture()
  return {
    master,
    getTargets: async () => targets,
    getOwnedWeapons: async () => [],
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
          lotteries: master.lotteries,
          materialCosts: master.materialCosts,
        },
      }
    },
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async () => ({ added: true })),
  }
}

describe('SearchPage', () => {
  it('shows the Target empty state', async () => {
    render(<SearchPage dependencies={dependencies(new ControlledClient(), [])} />)
    expect(await screen.findByText('目標武器を登録してください。')).toBeInTheDocument()
  })

  it('searches exactly one Target and renders its canonical Ideal Candidate', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    render(<SearchPage dependencies={deps} />)
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

  it('offers no result filter and no output-cap settings at all', async () => {
    render(<SearchPage dependencies={dependencies(new ControlledClient())} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    const view = render(<SearchPage dependencies={dependencies(zeroClient, [target])} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    zeroClient.resolve(resultFor(target, null))
    // Never "no Ideal exists": only "not inside the configured extent"
    // (`docs/SEARCH_SPEC.md` 5.7).
    expect(await screen.findByText(/現在の探索範囲では理想品が見つかりませんでした。/)).toBeInTheDocument()
    view.unmount()

    const errorClient = new ControlledClient()
    render(<SearchPage dependencies={dependencies(errorClient, [target])} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    errorClient.reject(new Error('Worker fixture error'))
    expect(await screen.findByText('Worker fixture error')).toBeInTheDocument()
  })

  it('shows skipped routes with their concrete RouteKind label', async () => {
    const user = userEvent.setup()
    const target = createValidTargetWeapon()
    const client = new ControlledClient()
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={dependencies(client, [target])} />)
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
    render(<SearchPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    const candidate = createValidBuildCandidate()
    client.resolve(resultFor(target, candidate))
    await user.click(await screen.findByRole('button', { name: 'ビルドリストへ追加' }))
    // Checkpoints start unselected, so a fresh result selects none.
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target, [])
    expect(screen.getByText('ビルドリストへ追加しました。')).toBeInTheDocument()
  })

  it('shows a load failure without the Target empty state or a search form', async () => {
    const deps = dependencies(new ControlledClient(), [createValidTargetWeapon()])
    deps.getTargets = async () => {
      throw new Error('読み込みfixture失敗')
    }
    render(<SearchPage dependencies={deps} />)

    expect(await screen.findByText('読み込みfixture失敗')).toBeInTheDocument()
    // A failed load is never presented as "no Targets", and no synthetic
    // Target is offered to search.
    expect(screen.queryByText('目標武器を登録してください。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '検索開始' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('検索対象の目標武器')).not.toBeInTheDocument()
  })

  it('heads the search conditions and detail settings with sequential headings', async () => {
    const user = userEvent.setup()
    render(<SearchPage dependencies={dependencies(new ControlledClient())} />)
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
    deps.addCandidate = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('追加fixture失敗')
      return { added: false }
    })
    render(<SearchPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, createValidBuildCandidate()))

    const addButton = await screen.findByRole('button', { name: 'ビルドリストへ追加' })
    const card = screen.getByRole('heading', { level: 3, name: '理想候補' }).closest('section')
    expect(card).toContainElement(addButton)

    await user.click(addButton)
    expect(await screen.findByText('追加fixture失敗')).toBeInTheDocument()
    expect(card).toHaveTextContent('追加fixture失敗')

    // The existing Build List selection is never overwritten from here.
    await user.click(addButton)
    const duplicate = await screen.findByText(
      'この候補は作成リストに追加済みです。チェックポイントは作成リストで変更してください。',
    )
    expect(card).toContainElement(duplicate)
    expect(screen.queryByText('追加fixture失敗')).not.toBeInTheDocument()
  })

  it('keeps at most one selected opportunity per checkpoint group', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    const deps = dependencies(client, [target])
    const candidate = createValidBuildCandidate()
    const identity = {
      seriesSkillId: 'series_skill.fixture.enabled',
      groupSkillId: null,
      conditionMatch: { bonus: 'practical', skill: 'ideal' },
    } as const
    const arrival = (id: string, afterOperationIndex: number): CompromiseCheckpointOpportunity => ({
      id: id as CompromiseCheckpointOpportunity['id'],
      afterOperationIndex,
      operationCount: afterOperationIndex + 1,
      remainingOperationCount: 2 - afterOperationIndex,
      restorationBonuses: candidate.finalBonuses,
      restorationBonusScope: 'gogma_artian',
      ...identity,
    })
    const group: CompromiseCheckpointGroup = {
      id: 'checkpoint-group:fixture.ui' as CompromiseCheckpointGroup['id'],
      restorationBonusScope: 'gogma_artian',
      restorationBonuses: candidate.finalBonuses,
      ...identity,
      opportunities: [
        arrival('checkpoint-opportunity:fixture.ui.1', 0),
        arrival('checkpoint-opportunity:fixture.ui.2', 1),
      ],
      isDisplaySecondary: false,
      dominatingGroupId: null,
    }
    candidate.checkpointGroups = [group]
    render(<SearchPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    client.resolve(resultFor(target, candidate))

    const primary = await screen.findByRole('checkbox', { name: '1手目（理想まで残り2操作）' })
    expect(primary).not.toBeChecked()
    await user.click(primary)
    expect(primary).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'その他の到達点（1）' }))
    const later = await screen.findByRole('checkbox', { name: '2手目（理想まで残り1操作）' })
    await user.click(later)
    // Choosing another arrival at the same product replaces the first one.
    expect(later).toBeChecked()
    expect(primary).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'ビルドリストへ追加' }))
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target, [group.opportunities[1].id])

    await user.click(later)
    expect(later).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'ビルドリストへ追加' }))
    expect(deps.addCandidate).toHaveBeenLastCalledWith(candidate, target, [])
  })
})
