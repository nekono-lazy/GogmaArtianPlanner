import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanBreakingChangeInspection } from '../domain/execution'
import { createInitialRngState } from '../domain/models/factories'
import type { RngState } from '../domain/models/publicTypes'
import type { PersistentReidentificationReminder } from '../services/execution/persistentReidentificationReminderService'
import type {
  IdentificationWizardCoordinator,
  IdentificationWizardState,
  IdentificationWizardStateListener,
} from '../services/rngIdentification/identificationWizardCoordinator'
import { RngSetupPage, type RngSetupPageDependencies } from './RngSetupPage'

/**
 * The persistent re-identification reminder on RNG Setup
 * (`docs/PLANNER_SPEC.md` 16.15, `docs/UI_FLOW.md` 5): the warning names this
 * screen's Identification Wizard as the resolution, a manual save never
 * resolves it, and the page re-reads it after a direct save and after an
 * adoption - so a formal adoption clears it at once, and a later manual edit
 * of an adopted value brings it back. The judgement itself is the injected
 * reminder's (the Domain helper's); the page only re-reads it.
 */

const TITLE = '予測と異なる結果の再同定が必要です'
const RNG_TEXT = '予測と異なる結果が記録された後、RNG状態の再同定がまだ完了していません。'
const NORMAL_TEXT = '予測と異なる結果が記録された後、通常アーティアCounterの再同定がまだ完了していません。'
const WIZARD_GUIDANCE = 'この画面のIdentification Wizardで現在のゲーム状態に合わせて再同定してください。'
const MANUAL_NOTE = '手動入力だけではこの再同定要求は解消されません。Identification Wizardの結果を採用してください。'

const rngOnly: PersistentReidentificationReminder = {
  kind: 'actual_result_different', rngRequired: true, normalCounters: [], hasUnresolvableNormalCounter: false,
}
const normalOnly: PersistentReidentificationReminder = {
  kind: 'actual_result_different',
  rngRequired: false,
  normalCounters: [{ normalCounterId: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades' }],
  hasUnresolvableNormalCounter: false,
}
const none: PersistentReidentificationReminder = { kind: 'none' }

/** A Coordinator already holding a reviewed unique result, so the Dialog offers the adoption at once. */
class ReviewedCoordinator implements IdentificationWizardCoordinator {
  private state: IdentificationWizardState = {
    skill: { status: 'completed', requestId: null, input: null, progress: null, result: null, classification: 'unique', identified: { baseSeed: '86315169', startingSkillCounter: 42 }, error: null },
    gogma: { status: 'completed', requestId: null, input: null, progress: null, result: null, classification: 'unique', startingGogmaCounter: 84, error: null },
    review: { baseSeed: '86315169', startingSkillCounter: 42, startingGogmaCounter: 84 },
    gameRestoredConfirmed: false,
    adoption: { status: 'idle', savedRngState: null, error: null },
    disposed: false,
  }
  private readonly listeners = new Set<IdentificationWizardStateListener>()
  private readonly adoptImpl: () => Promise<RngState>
  constructor(adoptImpl: () => Promise<RngState>) { this.adoptImpl = adoptImpl }
  getState() { return this.state }
  subscribe(listener: IdentificationWizardStateListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(next: IdentificationWizardState) {
    this.state = next
    for (const listener of [...this.listeners]) listener(next)
  }
  identifySkill(): Promise<never> { throw new Error('not expected') }
  cancelSkill(): void {}
  identifyGogma(): Promise<never> { throw new Error('not expected') }
  cancelGogma(): void {}
  setGameRestoredConfirmed(value: boolean) { this.publish({ ...this.state, gameRestoredConfirmed: value }) }
  async inspectAdoption(): Promise<PlanBreakingChangeInspection> { return { approvalRequired: false } }
  async adopt(): Promise<RngState> {
    const saved = await this.adoptImpl()
    this.publish({ ...this.state, adoption: { status: 'adopted', savedRngState: saved, error: null } })
    return saved
  }
  restart(): void {}
  dispose(): void { this.listeners.clear(); this.state = { ...this.state, disposed: true } }
}

function fixture(initialReminder: PersistentReidentificationReminder) {
  let stored: RngState = createInitialRngState('2026-08-29T00:00:00.000Z')
  let reminder = initialReminder
  const deps: RngSetupPageDependencies = {
    ensure: vi.fn(async () => stored),
    save: vi.fn(async (state: RngState) => { stored = state; return state }),
    inspectSave: vi.fn(async () => ({ approvalRequired: false as const })),
    getNormalCounters: vi.fn(async () => []),
    getReidentificationReminder: vi.fn(async () => reminder),
    createIdentificationCoordinator: () => new ReviewedCoordinator(async () => {
      stored = {
        ...stored,
        baseSeed: { value: '86315169', isConfirmed: true, source: 'observation' },
        skillCounter: { value: 42, isConfirmed: true, source: 'observation' },
        gogmaCounter: { value: 84, isConfirmed: true, source: 'observation' },
        lastIdentifiedAt: '2026-09-18T00:00:00.000Z',
      }
      return stored
    }),
  }
  return { deps, setReminder: (next: PersistentReidentificationReminder) => { reminder = next } }
}

function renderPage(deps: RngSetupPageDependencies) {
  return render(<RngSetupPage dependencies={deps} />, { wrapper: MemoryRouter })
}

async function saveGogmaCounter(user: ReturnType<typeof userEvent.setup>, value: string) {
  const counter = await screen.findByLabelText('巨戟カウンター')
  await user.clear(counter)
  await user.type(counter, value)
  await user.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('RNG状態を保存しました。')
}

async function adoptThroughWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Identification Wizardを開始' }))
  const dialog = await screen.findByRole('dialog', { name: 'RNG同定ウィザード' })
  await user.click(within(dialog).getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
  await user.click(within(dialog).getByRole('button', { name: '開始値を採用' }))
  await within(dialog).findByText('同定結果をRNG状態へ採用しました。')
  await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
  await screen.findByText('Identification結果をRNG状態へ採用しました。')
}

describe('RngSetupPage persistent re-identification reminder', () => {
  beforeEach(() => { vi.stubGlobal('Worker', class {}) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('R1: an unresolved RNG divergence warns and points at this screen Wizard, without a self-link', async () => {
    const { deps } = fixture(rngOnly)
    renderPage(deps)
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText(RNG_TEXT)).toBeInTheDocument()
    expect(within(alert).getByText(WIZARD_GUIDANCE)).toBeInTheDocument()
    expect(within(alert).getByText(MANUAL_NOTE)).toBeInTheDocument()
    expect(within(alert).queryByRole('link', { name: 'RNG状態設定へ' })).not.toBeInTheDocument()
    expect(within(alert).queryByRole('link', { name: '通常アーティアCounterへ' })).not.toBeInTheDocument()
  })

  it('shows the Normal Counter stream too, with its link, on RNG Setup', async () => {
    const { deps } = fixture({ ...rngOnly, normalCounters: normalOnly.normalCounters })
    renderPage(deps)
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText(NORMAL_TEXT)).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
  })

  it('R2: a manual save re-reads the reminder and does not resolve it', async () => {
    const user = userEvent.setup()
    const { deps } = fixture(rngOnly)
    renderPage(deps)
    await screen.findByText(TITLE)
    await saveGogmaCounter(user, '50')
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(deps.getReidentificationReminder).toHaveBeenCalledTimes(2)
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText(RNG_TEXT)).toBeInTheDocument()
  })

  it('R3: the formal Identification adoption re-reads the reminder, which then disappears', async () => {
    const user = userEvent.setup()
    const { deps, setReminder } = fixture(rngOnly)
    renderPage(deps)
    await screen.findByText(TITLE)
    setReminder(none)
    await adoptThroughWizard(user)
    expect(deps.getReidentificationReminder).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
    expect(screen.queryByText(RNG_TEXT)).not.toBeInTheDocument()
  })

  it('R4: after the adoption, an unresolved Normal Counter stream keeps the warning with only the Normal guidance', async () => {
    const user = userEvent.setup()
    const { deps, setReminder } = fixture({ ...rngOnly, normalCounters: normalOnly.normalCounters })
    renderPage(deps)
    await screen.findByText(RNG_TEXT)
    setReminder(normalOnly)
    await adoptThroughWizard(user)
    const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).queryByText(RNG_TEXT)).not.toBeInTheDocument()
    expect(within(alert).getByText(NORMAL_TEXT)).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
  })

  it('R5: a manual edit of an adopted value after the adoption brings the warning back', async () => {
    const user = userEvent.setup()
    const { deps, setReminder } = fixture(rngOnly)
    renderPage(deps)
    await screen.findByText(TITLE)
    setReminder(none)
    await adoptThroughWizard(user)
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
    // The helper un-identifies the manual value; the page only re-reads.
    setReminder(rngOnly)
    await saveGogmaCounter(user, '85')
    expect(deps.getReidentificationReminder).toHaveBeenCalledTimes(3)
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText(RNG_TEXT)).toBeInTheDocument()
  })

  it('shows a read failure as such and keeps the form usable', async () => {
    const { deps } = fixture(none)
    deps.getReidentificationReminder = vi.fn(async () => { throw new Error('IndexedDB unavailable') })
    renderPage(deps)
    expect(await screen.findByText('再同定状態を確認できませんでした。予測と異なる結果が記録されている場合、再同定が必要な可能性があります。')).toBeInTheDocument()
    expect(await screen.findByLabelText('巨戟カウンター')).toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })
})
