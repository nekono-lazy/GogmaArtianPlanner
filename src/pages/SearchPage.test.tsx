import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BuildCandidate, TargetWeapon } from '../domain/models/publicTypes'
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
  candidates: BuildCandidate[],
  skippedRoutes: CandidateSearchResult['targetResults'][number]['skippedRoutes'] = [],
): CandidateSearchResult {
  return {
    searchRunId: 'ui-run',
    calculationContext: createFixtureInput().calculationContext,
    targetResults: [{ targetWeaponId: target.id, candidates, searchedRoutes: ['normal_artian_to_gogma'], skippedRoutes }],
    relaxationSuggestions: [],
    warnings: [],
    elapsedMs: 1,
    isTruncated: false,
  }
}

function resultWithNotices(
  target: TargetWeapon,
  warnings: CandidateSearchResult['warnings'],
): CandidateSearchResult {
  return { ...resultFor(target, []), warnings }
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
        targetWeaponIds: options.targetWeaponIds,
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

  it('starts search, shows progress, and renders Ideal/Practical/Similar results', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const deps = dependencies(client)
    render(<SearchPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    expect(screen.getByText(/検索中 0 \/ 1/)).toBeInTheDocument()
    expect(client.input?.calculationContext).toEqual({
      gameVersion: deps.master.manifest.gameVersion,
      masterDataVersion: deps.master.manifest.dataVersion,
      rngEngineVersion: client.engineVersion,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    })
    client.progress({ completedTargets: 1, totalTargets: 1, currentTargetWeaponId: deps.master.weaponTypes[0].id as never, phase: 'finalizing', processedWorkItems: 42 })
    const target = createValidTargetWeapon()
    const ideal = { ...createValidBuildCandidate(), id: 'candidate.ideal' as BuildCandidate['id'], category: 'ideal' as const, isSimilarToIdeal: false }
    const practical = { ...createValidBuildCandidate(), id: 'candidate.practical' as BuildCandidate['id'], category: 'practical' as const, isSimilarToIdeal: true }
    client.resolve(resultFor(target, [ideal, practical]))
    expect(await screen.findByText('理想候補 1件 ／ 実用候補 1件')).toBeInTheDocument()
    expect(screen.getByText('理想に近い')).toBeInTheDocument()
    expect(deps.saveCandidates).toHaveBeenCalledWith(target.id, [ideal, practical])
  })

  it('shows the current Target, phase, and settled work while one Target searches', async () => {
    const user = userEvent.setup()
    const client = new ControlledClient()
    const target = createValidTargetWeapon()
    render(<SearchPage dependencies={dependencies(client, [target])} />)
    await user.click(await screen.findByRole('button', { name: '検索開始' }))
    expect(screen.getByText('現在の目標武器: 準備中')).toBeInTheDocument()
    expect(screen.getByText('準備中')).toBeInTheDocument()
    expect(screen.getByText('探索ステップ: 0')).toBeInTheDocument()

    // Target start: the Target is named before it completes.
    client.progress({ completedTargets: 0, totalTargets: 1, currentTargetWeaponId: target.id, phase: 'preparing', processedWorkItems: 0 })
    expect(await screen.findByText(`現在の目標武器: ${target.name}`)).toBeInTheDocument()

    // Activity inside the same Target, still 0 / 1 completed.
    client.progress({ completedTargets: 0, totalTargets: 1, currentTargetWeaponId: target.id, phase: 'searching', processedWorkItems: 1200 })
    expect(await screen.findByText('探索ステップ: 1200')).toBeInTheDocument()
    expect(screen.getByText('探索中')).toBeInTheDocument()
    expect(screen.getByText(/検索中 0 \/ 1/)).toBeInTheDocument()
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
    zeroClient.resolve(resultFor(target, []))
    expect(await screen.findByText('条件を満たす候補は見つかりませんでした。')).toBeInTheDocument()
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
    client.resolve(resultFor(target, [], [{
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
    client.resolve(resultFor(target, [createValidBuildCandidate()]))
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
    client.resolve(resultFor(target, [candidate]))
    await user.click(await screen.findByRole('button', { name: 'ビルドリストへ追加' }))
    expect(deps.addCandidate).toHaveBeenCalledWith(candidate, target)
    expect(screen.getByText('ビルドリストへ追加しました。')).toBeInTheDocument()
  })
})
