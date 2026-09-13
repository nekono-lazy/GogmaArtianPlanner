import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuildListEntry } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import { createReferencedOwnedWeaponsHash, createSearchStateHash } from '../domain/models/hashing'
import type {
  BuildListEntry,
  NormalArtianCounter,
  OwnedNormalArtianWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import { createPlannerCalculationContext } from '../services/planner/createPlannerInput'
import { useSettingsStore } from '../stores/settingsStore'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidTargetWeapon,
  DOMAIN_FIXTURE_TIME,
  ownedWeaponId,
  productionPlanId,
} from '../test/fixtures/domainData'
import { DashboardPage, type DashboardPageDependencies } from './DashboardPage'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Master data must load for the Dashboard tests.')
const master = loadedMaster.data

/** Distinctive raw values, so their absence from the page is meaningful. */
const RAW_SEED = '987654321'
const RAW_GOGMA_COUNTER = 4321
const RAW_SKILL_COUNTER = 8765

function rngState(overrides: Partial<Pick<RngState, 'baseSeed' | 'gogmaCounter' | 'skillCounter'>> = {}): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: { value: RAW_SEED, isConfirmed: true, source: 'manual' },
    gogmaCounter: { value: RAW_GOGMA_COUNTER, isConfirmed: true, source: 'manual' },
    skillCounter: { value: RAW_SKILL_COUNTER, isConfirmed: true, source: 'manual' },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
    ...overrides,
  }
}

function confirmedNormalCounter(): NormalArtianCounter {
  return {
    id: 'weapon.dual_blades:8',
    weaponTypeId: 'weapon.dual_blades',
    rarity: 8,
    counter: 12,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: DOMAIN_FIXTURE_TIME,
    candidateCount: 1,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

function normalWeapon(): OwnedNormalArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId('owned.dashboard.normal')),
    kind: 'normal',
    rarity: 8,
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
  }
}

function target(isEnabled: boolean): TargetWeapon {
  return { ...createValidTargetWeapon(), isEnabled }
}

function activePlan(compatible: boolean): ProductionPlan {
  const plan = createValidProductionPlan()
  // The fixture Plan carries a historical CalculationContext; a compatible
  // Active Plan uses the current runtime authority instead.
  const calculationContext = compatible
    ? createPlannerCalculationContext(master, PRODUCTION_RNG_ENGINE_VERSION)
    : plan.calculationContext
  return {
    ...plan,
    id: productionPlanId('plan.dashboard.active'),
    status: 'active',
    calculationContext: { ...calculationContext },
    baseSnapshot: { ...plan.baseSnapshot, calculationContext: { ...calculationContext } },
  }
}

function dependencies(overrides: Partial<DashboardPageDependencies> = {}): DashboardPageDependencies {
  return {
    master,
    getRngState: vi.fn(async () => undefined),
    getNormalCounters: vi.fn(async () => []),
    getOwnedWeapons: vi.fn(async () => []),
    getTargetWeapons: vi.fn(async () => []),
    getBuildListEntries: vi.fn(async () => []),
    getActivePlan: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderDashboard(deps: DashboardPageDependencies) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <DashboardPage dependencies={deps} /> },
      { path: '*', element: <p>遷移先</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

async function findRegion(name: string) {
  return screen.findByRole('region', { name })
}

describe('DashboardPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('shows an unset initial state and leads to RNG Setup', async () => {
    const user = userEvent.setup()
    const router = renderDashboard(dependencies())

    const next = await findRegion('次の操作')
    expect(within(next).getByText('RNG状態を設定してください')).toBeInTheDocument()

    const rng = screen.getByRole('region', { name: 'RNG状態' })
    expect(within(rng).getAllByText('未設定')).toHaveLength(3)
    expect(within(rng).queryByText('Counter Gate', { exact: false })).not.toBeInTheDocument()

    const features = screen.getByRole('region', { name: '利用可能な機能' })
    expect(within(features).getAllByText('利用不可')).toHaveLength(3)
    expect(within(features).getByText('作成ルート依存')).toBeInTheDocument()
    expect(within(features).getAllByText('Base Seed（基準シード）を検索に使用できません').length).toBeGreaterThan(0)

    const data = screen.getByRole('region', { name: '現在のデータ' })
    expect(within(data).getByText('0 / 14')).toBeInTheDocument()
    expect(within(data).getByText('通常 0本')).toBeInTheDocument()
    expect(within(data).getByText('巨戟 0本')).toBeInTheDocument()
    expect(within(data).getByText('なし')).toBeInTheDocument()

    const actions = screen.getByRole('region', { name: '主要アクション' })
    expect(within(actions).getByRole('button', { name: '作成プランを見る' })).toBeDisabled()
    expect(within(actions).getByRole('button', { name: '実行ナビを再開する' })).toBeDisabled()

    await user.click(within(next).getByRole('link', { name: 'RNGを設定する' }))
    expect(router.state.location.pathname).toBe('/rng')
  })

  it('leads to Target Weapons when no enabled Target exists', async () => {
    renderDashboard(dependencies({
      getRngState: vi.fn(async () => rngState()),
      getTargetWeapons: vi.fn(async () => [target(false)]),
    }))

    const next = await findRegion('次の操作')
    expect(within(next).getByText('検索対象がONの目標武器がありません。')).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: '目標武器を登録する' })).toHaveAttribute('href', '/target-weapons')
  })

  it('leads to Search when enabled Targets exist but the Build List is empty', async () => {
    const user = userEvent.setup()
    const router = renderDashboard(dependencies({
      getRngState: vi.fn(async () => rngState()),
      getTargetWeapons: vi.fn(async () => [target(true)]),
    }))

    const next = await findRegion('次の操作')
    await user.click(within(next).getByRole('link', { name: '候補検索を開始する' }))
    expect(router.state.location.pathname).toBe('/search')
  })

  it('summarizes existing data, per-item RNG status and Build List staleness', async () => {
    renderDashboard(dependencies({
      getRngState: vi.fn(async () =>
        rngState({ skillCounter: { value: RAW_SKILL_COUNTER, isConfirmed: false, source: 'manual' } }),
      ),
      getNormalCounters: vi.fn(async () => [confirmedNormalCounter()]),
      getOwnedWeapons: vi.fn(async () => [normalWeapon(), createValidOwnedWeapon()]),
      getTargetWeapons: vi.fn(async () => [target(true), { ...target(false), id: 'target.dashboard.off' as TargetWeapon['id'] }]),
      // The fixture Entry carries a historical CalculationContext, so the
      // Domain staleness authority reports it as needing a new search.
      getBuildListEntries: vi.fn(async () => [createValidBuildListEntry()]),
    }))

    // Every Entry is stale, so the Dashboard sends the user to search again
    // rather than claiming the Build List can produce a Plan.
    const next = await findRegion('次の操作')
    expect(within(next).getByText('ビルドリストの候補は再検索が必要です')).toBeInTheDocument()
    expect(within(next).queryByText(/生産計画を作成できます/)).not.toBeInTheDocument()
    expect(within(next).getByRole('link', { name: '候補検索を開始する' })).toHaveAttribute('href', '/search')
    expect(within(next).getByRole('link', { name: 'ビルドリストを開く' })).toHaveAttribute('href', '/build-list')

    const rng = screen.getByRole('region', { name: 'RNG状態' })
    expect(within(rng).getAllByText('確定')).toHaveLength(2)
    expect(within(rng).getByText('要確認')).toBeInTheDocument()
    expect(within(rng).getByText(/要確認: 値は入力済みですが/)).toBeInTheDocument()

    const features = screen.getByRole('region', { name: '利用可能な機能' })
    expect(within(features).getAllByText('利用可能')).toHaveLength(2)
    expect(within(features).getByText('スキルカウンターを検索に使用できません')).toBeInTheDocument()

    const data = screen.getByRole('region', { name: '現在のデータ' })
    expect(within(data).getByText('1 / 14')).toBeInTheDocument()
    expect(within(data).getByText('通常 1本')).toBeInTheDocument()
    expect(within(data).getByText('巨戟 1本')).toBeInTheDocument()
    expect(within(data).getByText('登録済み 2件')).toBeInTheDocument()
    expect(within(data).getByText('うち再検索が必要 1件')).toBeInTheDocument()
  })

  it('asks to review a partly stale Build List without claiming a Plan can be created', async () => {
    const user = userEvent.setup()
    const state = rngState()
    const counters = [confirmedNormalCounter()]
    const owned = [createValidOwnedWeapon()]
    const currentTarget = target(true)
    // An Entry built against the current state, so the Domain staleness
    // authority reports it as current.
    const candidate = createValidBuildCandidate()
    candidate.targetWeaponId = currentTarget.id
    candidate.calculationContext = createBuildListCalculationContext(master)
    candidate.searchStateHash = createSearchStateHash(candidate.route, state, counters)
    candidate.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(candidate.route, owned)
    const current: BuildListEntry = createBuildListEntry(candidate, currentTarget, {
      id: buildListEntryId('build-list.dashboard.current'),
      createdAt: DOMAIN_FIXTURE_TIME,
    })
    // Persisted as not stale, but its historical CalculationContext makes the
    // Domain authority report it stale: the persisted flag is not trusted.
    const stale: BuildListEntry = {
      ...createValidBuildListEntry(),
      id: buildListEntryId('build-list.dashboard.stale'),
      isStale: false,
      staleReasons: [],
    }
    const router = renderDashboard(dependencies({
      getRngState: vi.fn(async () => state),
      getNormalCounters: vi.fn(async () => counters),
      getOwnedWeapons: vi.fn(async () => owned),
      getTargetWeapons: vi.fn(async () => [currentTarget]),
      getBuildListEntries: vi.fn(async () => [current, stale]),
    }))

    const next = await findRegion('次の操作')
    expect(within(next).getByText('ビルドリストを確認してください')).toBeInTheDocument()
    expect(within(next).getByText('ビルドリストの候補2件のうち、1件は再検索が必要です。')).toBeInTheDocument()
    expect(screen.queryByText(/生産計画を作成できます/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '現在のデータ' })).getByText('うち再検索が必要 1件')).toBeInTheDocument()

    await user.click(within(next).getByRole('link', { name: 'ビルドリストを開く' }))
    expect(router.state.location.pathname).toBe('/build-list')
  })

  it('leads to the Execution Navigator when a compatible Active Plan exists', async () => {
    const user = userEvent.setup()
    const router = renderDashboard(dependencies({
      getRngState: vi.fn(async () => rngState()),
      getActivePlan: vi.fn(async () => activePlan(true)),
    }))

    const next = await findRegion('次の操作')
    expect(within(next).getByText('実行中の作成プランがあります')).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', '/plans/plan.dashboard.active')

    const actions = screen.getByRole('region', { name: '主要アクション' })
    expect(within(actions).getByRole('link', { name: '実行ナビを再開する' })).toHaveAttribute('href', '/plans/plan.dashboard.active/run')
    expect(within(screen.getByRole('region', { name: '現在のデータ' })).getByText('あり')).toBeInTheDocument()

    await user.click(within(next).getByRole('link', { name: '実行ナビを再開する' }))
    expect(router.state.location.pathname).toBe('/plans/plan.dashboard.active/run')
  })

  it('guides an incompatible Active Plan to recalculation without offering execution', async () => {
    renderDashboard(dependencies({
      getRngState: vi.fn(async () => rngState()),
      getActivePlan: vi.fn(async () => activePlan(false)),
    }))

    const next = await findRegion('次の操作')
    expect(within(next).getByText('実行中の作成プランは再計算が必要です')).toBeInTheDocument()
    expect(within(next).getByRole('link', { name: '作成プランを見る' })).toHaveAttribute('href', '/plans/plan.dashboard.active')
    expect(within(next).getByRole('link', { name: 'ビルドリストで再計算する' })).toHaveAttribute('href', '/build-list')
    expect(within(next).queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()

    const actions = screen.getByRole('region', { name: '主要アクション' })
    expect(within(actions).getByRole('button', { name: '実行ナビを再開する' })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: '現在のデータ' })).getByText('再計算が必要')).toBeInTheDocument()
  })

  it('never shows internal RNG values while Debug Mode is off', async () => {
    renderDashboard(dependencies({
      getRngState: vi.fn(async () => rngState()),
      getNormalCounters: vi.fn(async () => [confirmedNormalCounter()]),
    }))

    await findRegion('次の操作')
    expect(useSettingsStore.getState().debugMode).toBe(false)
    const text = document.body.textContent ?? ''
    expect(text).not.toContain(RAW_SEED)
    expect(text).not.toContain(String(RAW_GOGMA_COUNTER))
    expect(text).not.toContain(String(RAW_SKILL_COUNTER))
  })

  it('reports a Persistence failure instead of guessing a state', async () => {
    renderDashboard(dependencies({
      getActivePlan: vi.fn(async () => {
        throw new Error('Persistence contains more than one active ProductionPlan.')
      }),
    }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Persistence contains more than one active ProductionPlan.')
    expect(screen.queryByRole('region', { name: '次の操作' })).not.toBeInTheDocument()
  })
})
