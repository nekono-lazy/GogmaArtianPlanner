import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../db/repositoryError'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { loadMasterData } from '../domain/master/loadMasterData'
import type {
  NormalArtianCounter,
  PlanStep,
  PlanStepDebugInfo,
  ProductionPlan,
  RngState,
} from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { DebugPageDependencies } from '../services/debug/debugPageDependencies'
import { useSettingsStore } from '../stores/settingsStore'
import {
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
} from '../test/fixtures/domainData'
import { DebugPage } from './DebugPage'

const master = loadMasterData()
if (!master.ok) throw new Error('Production Master Data must load for the Debug Details test.')

function rngState(overrides: Partial<RngState> = {}): RngState {
  return {
    ...createValidRngState(),
    baseSeed: { value: '51231782', isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: 35, isConfirmed: true, source: 'observation' },
    skillCounter: { value: 341, isConfirmed: true, source: 'observation' },
    counterGate: { value: 54, isConfirmed: false, source: 'manual' },
    lastIdentifiedAt: '2026-09-15T01:02:03.000Z',
    updatedAt: '2026-09-15T04:05:06.000Z',
    ...overrides,
  }
}

function normalCounter(
  weaponTypeId: string,
  overrides: Partial<NormalArtianCounter> = {},
): NormalArtianCounter {
  return {
    ...createValidNormalArtianCounter(),
    id: `${weaponTypeId}:8`,
    weaponTypeId,
    ...overrides,
  }
}

const debugInfo = (overrides: Partial<PlanStepDebugInfo> = {}): PlanStepDebugInfo => ({
  startBaseSeed: '51231782',
  startGogmaCounter: 120,
  endGogmaCounter: 121,
  startSkillCounter: 341,
  endSkillCounter: 341,
  startNormalCounter: null,
  endNormalCounter: null,
  plannerReason: 'reset_bonuses',
  ...overrides,
})

function planWith(step: Partial<PlanStep>, plan: Partial<ProductionPlan> = {}): ProductionPlan {
  const base = createValidProductionPlan()
  const [first] = base.steps
  return {
    ...base,
    status: 'active',
    steps: [{ ...first, operationType: 'reset_bonuses', ...step }],
    currentStepId: first.id,
    ...plan,
  }
}

function deps(overrides: Partial<DebugPageDependencies> = {}): DebugPageDependencies {
  return {
    getRngState: vi.fn(async () => rngState()),
    getNormalCounters: vi.fn(async () => [] as NormalArtianCounter[]),
    getRunningProductionPlan: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function renderDebug(dependencies: DebugPageDependencies = deps()) {
  const result = render(<DebugPage dependencies={dependencies} />)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  return result
}

function list(name: string): HTMLElement {
  return screen.getByRole('list', { name })
}

/** One labelled Debug key / value set. */
function group(name: string, scope: HTMLElement | null = null): HTMLElement {
  return scope === null
    ? screen.getByRole('group', { name })
    : within(scope).getByRole('group', { name })
}

/** The value cell of one labelled Debug row, scoped to its own definition list. */
function rowValue(scope: HTMLElement, label: string): HTMLElement {
  const term = within(scope).getByText(label, { selector: 'dt' })
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Missing Debug value for ${label}`)
  return value
}

/** The one Debug disclosure of the current Step, opened for inspection. */
async function openStepDebug(name: RegExp | string): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
}

describe('DebugPage with Debug Mode off', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('shows only the explanation and reads nothing from persistence', () => {
    const dependencies = deps({
      getRngState: vi.fn(async () => rngState()),
      getNormalCounters: vi.fn(async () => [normalCounter('weapon.bow')]),
      getRunningProductionPlan: vi.fn(async () => planWith({ debug: debugInfo() })),
    })
    const { container } = render(<DebugPage dependencies={dependencies} />)

    expect(
      screen.getByText('Debug Modeが無効です。「設定」画面のデバッグモードから有効にしてください。'),
    ).toBeInTheDocument()
    // No read is even started while Debug Mode is off.
    expect(dependencies.getRngState).not.toHaveBeenCalled()
    expect(dependencies.getNormalCounters).not.toHaveBeenCalled()
    expect(dependencies.getRunningProductionPlan).not.toHaveBeenCalled()
    // No internal value reaches the DOM, hidden nodes included.
    const markup = container.innerHTML
    for (const leaked of [
      '51231782',
      '341',
      '120',
      '121',
      'reset_bonuses',
      'PlanStepDebugInfo',
      'Base Seed',
      'Gogma Counter',
      'Skill Counter',
      'Counter Gate',
    ]) {
      expect(markup).not.toContain(leaked)
    }
  })
})

describe('DebugPage current RNG state', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
    useSettingsStore.setState({ debugMode: true })
  })

  it('shows every persisted RngState field with its confirmation and source', async () => {
    await renderDebug()
    const section = screen.getByRole('region', { name: '現在のRNG状態' })

    const seedRow = rowValue(section, 'Base Seed')
    expect(within(seedRow).getByText('value: 51231782')).toBeInTheDocument()
    expect(within(seedRow).getByText('confirmed: true（確定）')).toBeInTheDocument()
    expect(within(seedRow).getByText('source: observation（観測検索）')).toBeInTheDocument()

    expect(within(rowValue(section, 'Gogma Counter')).getByText('value: 35')).toBeInTheDocument()
    expect(within(rowValue(section, 'Skill Counter')).getByText('value: 341')).toBeInTheDocument()
    expect(rowValue(section, 'lastIdentifiedAt')).toHaveTextContent('2026-09-15T01:02:03.000Z')
    expect(rowValue(section, 'updatedAt')).toHaveTextContent('2026-09-15T04:05:06.000Z')
  })

  it('shows the Counter Gate value beside its diagnostic-only explanation', async () => {
    await renderDebug()
    const section = screen.getByRole('region', { name: '現在のRNG状態' })
    const gate = rowValue(section, 'Counter Gate')
    expect(within(gate).getByText('value: 54')).toBeInTheDocument()
    expect(within(gate).getByText('confirmed: false（未確定）')).toBeInTheDocument()
    expect(
      within(gate).getByText(/診断・互換用の保存値です。/),
    ).toHaveTextContent('Production Predictionではpersisted Counter Gateをauthorityとして使用しません。')
  })

  it('shows a null value as 未設定 rather than as the string "null"', async () => {
    await renderDebug(
      deps({
        getRngState: vi.fn(async () =>
          rngState({
            skillCounter: { value: null, isConfirmed: false, source: null },
            lastIdentifiedAt: null,
          }),
        ),
      }),
    )
    const section = screen.getByRole('region', { name: '現在のRNG状態' })
    const skillRow = rowValue(section, 'Skill Counter')

    expect(within(skillRow).getByText('value: 未設定')).toBeInTheDocument()
    expect(within(skillRow).getByText('source: 未設定')).toBeInTheDocument()
    expect(within(section).queryByText('value: null')).not.toBeInTheDocument()
  })

  it('says so when no RngState is persisted', async () => {
    await renderDebug(deps({ getRngState: vi.fn(async () => undefined) }))

    expect(screen.getByText('保存済みのRNG状態はありません。')).toBeInTheDocument()
  })

  it('reports a read failure as an error, never as an absent state', async () => {
    await renderDebug(
      deps({
        getRngState: vi.fn(async () => {
          throw new Error('read failed')
        }),
      }),
    )

    expect(screen.getByText('現在のRNG状態を読み込めませんでした。')).toBeInTheDocument()
    expect(screen.queryByText('保存済みのRNG状態はありません。')).not.toBeInTheDocument()
    // One failed read never hides the sections that succeeded.
    expect(screen.getByText('保存済みの通常アーティアCounterはありません。')).toBeInTheDocument()
  })
})

describe('DebugPage Normal Artian Counters', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
    useSettingsStore.setState({ debugMode: true })
  })

  it('lists every persisted Counter in a stable Master order, whatever the repository returned', async () => {
    const counters = [
      normalCounter('weapon.bow', { counter: 7, isConfirmed: true }),
      normalCounter('weapon.great_sword', { counter: 0, isConfirmed: false, candidateCount: null }),
    ]
    await renderDebug(deps({ getNormalCounters: vi.fn(async () => counters) }))
    const items = within(list('保存済みの通常アーティアCounter')).getAllByRole('listitem')

    expect(items.map((item) => item.querySelector('.MuiTypography-subtitle2')?.textContent)).toEqual([
      '大剣',
      '弓',
    ])
    const greatSword = group('weapon.great_sword:8 の通常アーティアCounter', items[0])
    expect(rowValue(greatSword, 'weaponTypeId')).toHaveTextContent('weapon.great_sword')
    expect(rowValue(greatSword, 'id')).toHaveTextContent('weapon.great_sword:8')
    expect(rowValue(greatSword, 'rarity')).toHaveTextContent('8')
    // A stored 0 stays 0; only a null value reads 未設定.
    expect(rowValue(greatSword, 'counter')).toHaveTextContent('0')
    expect(rowValue(greatSword, 'isConfirmed')).toHaveTextContent('false（未確定）')
    expect(rowValue(greatSword, 'candidateCount')).toHaveTextContent('未設定')
    const bow = group('weapon.bow:8 の通常アーティアCounter', items[1])
    expect(rowValue(bow, 'counter')).toHaveTextContent('7')
    expect(rowValue(bow, 'isConfirmed')).toHaveTextContent('true（確定）')
  })

  it('says so when no Counter is persisted', async () => {
    await renderDebug(deps({ getNormalCounters: vi.fn(async () => []) }))

    expect(screen.getByText('保存済みの通常アーティアCounterはありません。')).toBeInTheDocument()
  })

  it('reports a read failure as an error, never as an empty Counter set', async () => {
    await renderDebug(
      deps({
        getNormalCounters: vi.fn(async () => {
          throw new Error('read failed')
        }),
      }),
    )

    expect(
      screen.getByText('保存済みの通常アーティアCounterを読み込めませんでした。'),
    ).toBeInTheDocument()
    expect(screen.queryByText('保存済みの通常アーティアCounterはありません。')).not.toBeInTheDocument()
  })
})

describe('DebugPage runtime and version information', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
    useSettingsStore.setState({ debugMode: true })
  })

  it('keeps the Engine mode, version, capabilities and Identification availability', async () => {
    await renderDebug()
    const provenance = list('Production RNG Engine provenance')

    expect(within(provenance).getByText(PRODUCTION_RNG_ENGINE_VERSION)).toBeInTheDocument()
    expect(within(provenance).getByText('Production')).toBeInTheDocument()
    for (const capability of [
      'supportsNormalArtianPrediction',
      'supportsSkillPrediction',
      'supportsGogmaPrediction',
      'supportsKeepBonusesPrediction',
    ]) {
      const row = within(provenance).getByText(capability).closest('li') as HTMLElement
      expect(within(row).getByText('true（対応）')).toBeInTheDocument()
    }
    const identification = within(provenance)
      .getByText('Production Identification (Identification Wizard)')
      .closest('li') as HTMLElement
    expect(within(identification).getByText(/（利用不可）|（利用可能）/)).toBeInTheDocument()
  })

  it('shows the Master versions and the calculation app schema version', async () => {
    await renderDebug()
    const versions = list('Master data and calculation versions')

    const gameRow = within(versions).getByText('Master gameVersion').closest('li') as HTMLElement
    expect(within(gameRow).getByText(master.ok ? master.data.manifest.gameVersion : '')).toBeInTheDocument()
    const dataRow = within(versions).getByText('Master dataVersion').closest('li') as HTMLElement
    expect(
      within(dataRow).getByText(String(master.ok ? master.data.manifest.dataVersion : '')),
    ).toBeInTheDocument()
    const schemaRow = within(versions)
      .getByText('CURRENT_CALCULATION_APP_SCHEMA_VERSION')
      .closest('li') as HTMLElement
    expect(
      within(schemaRow).getByText(String(CURRENT_CALCULATION_APP_SCHEMA_VERSION)),
    ).toBeInTheDocument()
  })

  it('replaces the unconnected placeholder section', async () => {
    await renderDebug()

    expect(screen.queryByRole('heading', { name: 'Future debug sections' })).not.toBeInTheDocument()
    expect(screen.queryByText('データ接続は未実装です。')).not.toBeInTheDocument()
  })
})

describe('DebugPage running ProductionPlan', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
    useSettingsStore.setState({ debugMode: true })
  })

  it('says so when no running Plan exists, and never falls back to a Draft', async () => {
    const getRunningProductionPlan = vi.fn(async () => undefined)
    await renderDebug(deps({ getRunningProductionPlan }))

    expect(screen.getByText('実行中または続行不可の生産計画はありません。')).toBeInTheDocument()
    expect(getRunningProductionPlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('下書き')).not.toBeInTheDocument()
  })

  it('reports a Repository invariant failure as an error, never as "no Plan"', async () => {
    await renderDebug(
      deps({
        getRunningProductionPlan: vi.fn(async () => {
          throw new RepositoryError(
            'active_plan_conflict',
            'Persistence contains more than one running ProductionPlan.',
          )
        }),
      }),
    )

    expect(screen.getByText('実行中の生産計画を読み込めませんでした。')).toBeInTheDocument()
    expect(screen.queryByText('実行中または続行不可の生産計画はありません。')).not.toBeInTheDocument()
  })

  it('shows an active Plan with its identity, CalculationContext and current Step debug', async () => {
    const plan = planWith({ debug: debugInfo() })
    await renderDebug(deps({ getRunningProductionPlan: vi.fn(async () => plan) }))
    const section = screen.getByRole('region', { name: '実行中の生産計画' })

    const identity = group('実行中の生産計画', section)
    expect(rowValue(identity, 'Plan ID')).toHaveTextContent(plan.id)
    expect(rowValue(identity, 'status')).toHaveTextContent('active（実行中）')
    expect(rowValue(identity, 'currentStepId')).toHaveTextContent(plan.steps[0].id)
    expect(rowValue(identity, 'CalculationContext.appSchemaVersion')).toHaveTextContent(
      String(plan.calculationContext.appSchemaVersion),
    )
    expect(rowValue(identity, 'CalculationContext.rngEngineVersion')).toHaveTextContent(
      plan.calculationContext.rngEngineVersion,
    )
    expect(within(section).getByText('記録されている再計算理由はありません。')).toBeInTheDocument()

    await openStepDebug(/PlanStep Debug/)
    const seedBlock = group('ステップ 1 のPlanStepDebugInfo')
    expect(rowValue(seedBlock, 'startBaseSeed')).toHaveTextContent('51231782')
    expect(rowValue(seedBlock, 'plannerReason')).toHaveTextContent('reset_bonuses')
    const counters = group('ステップ 1 のCounter開始終了')
    expect(rowValue(counters, 'Gogma Counter')).toHaveTextContent('開始 120 → 終了 121（delta 0）')
  })

  it('lists every recalculation reason of a stale Plan with its raw enum, and warns the values may be outdated', async () => {
    const plan = planWith(
      { debug: debugInfo() },
      {
        status: 'stale',
        recalculationReasons: ['rng_state_changed', 'unexpected_result', 'owned_weapon_changed'],
      },
    )
    await renderDebug(deps({ getRunningProductionPlan: vi.fn(async () => plan) }))
    const reasons = within(list('再計算理由')).getAllByRole('listitem')

    expect(reasons.map(({ textContent }) => textContent)).toEqual([
      'RNG状態が変更されています（rng_state_changed）',
      '想定外の結果が記録されています（unexpected_result）',
      '所持武器が変更されています（owned_weapon_changed）',
    ])
    expect(screen.getByText('stale（再計算が必要）')).toBeInTheDocument()

    await openStepDebug(/PlanStep Debug/)
    expect(
      screen.getByText(/この予測は現在状態と一致しない可能性があります。/),
    ).toBeInTheDocument()
  })

  it('reports an unresolvable currentStepId as the anomaly it is instead of guessing a Step', async () => {
    const plan = planWith({ debug: debugInfo() })
    await renderDebug(
      deps({
        getRunningProductionPlan: vi.fn(async () => ({
          ...plan,
          currentStepId: plan.steps[0].id,
          steps: [],
        })),
      }),
    )

    expect(
      screen.getByText('currentStepIdに対応するPlanStepが見つかりません。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /PlanStep Debug/ })).not.toBeInTheDocument()
  })

  it('keeps the current persisted state and the Plan prediction apart', async () => {
    await renderDebug(
      deps({ getRunningProductionPlan: vi.fn(async () => planWith({ debug: debugInfo() })) }),
    )

    expect(
      screen.getByText(/上の「現在のRNG状態」は現在の保存値で、意味が異なります。/),
    ).toBeInTheDocument()
  })
})
