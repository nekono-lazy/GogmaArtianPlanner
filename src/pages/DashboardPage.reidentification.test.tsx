import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { PersistentReidentificationReminder } from '../services/execution/persistentReidentificationReminderService'
import { useSettingsStore } from '../stores/settingsStore'
import { DashboardPage, type DashboardPageDependencies } from './DashboardPage'

/**
 * The persistent re-identification reminder on the Dashboard
 * (`docs/PLANNER_SPEC.md` 16.15, `docs/UI_FLOW.md` 4): a warning above the
 * next action whenever the aggregated reminder names an unresolved stream,
 * without changing the Dashboard's own next action.
 */

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Master data must load for the Dashboard tests.')
const master = loadedMaster.data
const dualBladesName = master.weaponTypes.find(({ id }) => id === 'weapon.dual_blades')?.displayNameJa
const greatSwordName = master.weaponTypes.find(({ id }) => id === 'weapon.great_sword')?.displayNameJa
if (!dualBladesName || !greatSwordName) throw new Error('The Master must define Dual Blades and Great Sword.')

const TITLE = '予測と異なる結果が出たため、再特定が必要です'
const RNG_TEXT = '予測と異なる結果が記録された後、RNG状態の再特定がまだ完了していません。'
const NORMAL_TEXT = '予測と異なる結果が記録された後、通常アーティアCounterの再特定がまだ完了していません。'

function dependencies(reminder: () => Promise<PersistentReidentificationReminder>): DashboardPageDependencies {
  return {
    master,
    getRngState: vi.fn(async () => undefined),
    getNormalCounters: vi.fn(async () => []),
    getOwnedWeapons: vi.fn(async () => []),
    getTargetWeapons: vi.fn(async () => []),
    getBuildListEntries: vi.fn(async () => []),
    getActivePlan: vi.fn(async () => undefined),
    getReidentificationReminder: vi.fn(reminder),
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

const rngOnly: PersistentReidentificationReminder = {
  kind: 'actual_result_different', rngRequired: true, normalCounters: [], hasUnresolvableNormalCounter: false,
}
const normalOnly: PersistentReidentificationReminder = {
  kind: 'actual_result_different',
  rngRequired: false,
  normalCounters: [{ normalCounterId: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades' }],
  hasUnresolvableNormalCounter: false,
}

describe('DashboardPage persistent re-identification reminder', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('D1: shows no reminder when nothing is unresolved', async () => {
    renderDashboard(dependencies(async () => ({ kind: 'none' })))
    expect(await screen.findByRole('region', { name: '次の操作' })).toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
    expect(screen.queryByText('再特定の状態を確認できませんでした。', { exact: false })).not.toBeInTheDocument()
  })

  it('D2: an unresolved Gogma / Skill divergence of an ended Plan asks for the RNG Identification above the next action', async () => {
    renderDashboard(dependencies(async () => rngOnly))
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText(RNG_TEXT)).toBeInTheDocument()
    expect(within(alert).getByText('RNG状態設定の「RNG状態の特定」で、現在のゲーム状態に合わせて特定し直してください。')).toBeInTheDocument()
    expect(within(alert).getByText('手動入力だけではこの再特定の要求は解消されません。「RNG状態の特定」の結果を採用してください。')).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
    expect(within(alert).queryByRole('link', { name: '通常アーティアCounterへ' })).not.toBeInTheDocument()
    // Above the next action card.
    const nextAction = await screen.findByRole('region', { name: '次の操作' })
    expect(alert.compareDocumentPosition(nextAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('D3: an unresolved Normal creation divergence names the weapon type Counter and links the Normal Counters', async () => {
    renderDashboard(dependencies(async () => normalOnly))
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText(NORMAL_TEXT)).toBeInTheDocument()
    expect(within(alert).getByText(`${dualBladesName}の通常アーティアCounterを特定し直してください。`)).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
    expect(within(alert).queryByRole('link', { name: 'RNG状態設定へ' })).not.toBeInTheDocument()
    expect(within(alert).queryByText(RNG_TEXT)).not.toBeInTheDocument()
    expect(alert.textContent).not.toContain('weapon.dual_blades')
  })

  it('D4: both streams from several Plans are shown once each, with every Counter named', async () => {
    renderDashboard(dependencies(async () => ({
      kind: 'actual_result_different',
      rngRequired: true,
      normalCounters: [
        { normalCounterId: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades' },
        { normalCounterId: 'weapon.great_sword:8', weaponTypeId: 'weapon.great_sword' },
      ],
      hasUnresolvableNormalCounter: true,
    })))
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getAllByText(RNG_TEXT)).toHaveLength(1)
    expect(within(alert).getAllByText(NORMAL_TEXT)).toHaveLength(1)
    expect(within(alert).getByText(`${dualBladesName}の通常アーティアCounterを特定し直してください。`)).toBeInTheDocument()
    expect(within(alert).getByText(`${greatSwordName}の通常アーティアCounterを特定し直してください。`)).toBeInTheDocument()
    expect(within(alert).getByText('予測と異なる結果が記録されていますが、対象の通常アーティアCounterを安全に特定できません。通常アーティアCounter設定を確認してください。')).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
    expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
  })

  it('D5: the reminder leaves the Dashboard next action as the summary derived it', async () => {
    renderDashboard(dependencies(async () => rngOnly))
    await screen.findByText(TITLE)
    const nextAction = await screen.findByRole('region', { name: '次の操作' })
    // No RNG state at all: the ordinary `setup_rng` next action, unchanged by the reminder.
    expect(within(nextAction).getByText('RNG状態を設定してください')).toBeInTheDocument()
    expect(within(nextAction).getByRole('link', { name: 'RNGを設定する' })).toHaveAttribute('href', '/rng')
    expect(screen.getByRole('link', { name: '候補検索を開始する' })).toBeEnabled()
  })

  it('shows a read failure as such, never as "nothing to re-identify", and keeps the summary', async () => {
    renderDashboard(dependencies(async () => { throw new Error('IndexedDB unavailable') }))
    expect(await screen.findByText('再特定の状態を確認できませんでした。予測と異なる結果が記録されている場合、再特定が必要な可能性があります。')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '次の操作' })).toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })
})
