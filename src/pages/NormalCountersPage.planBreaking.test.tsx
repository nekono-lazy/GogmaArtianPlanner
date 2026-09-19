import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionRuntimeError, type PlanBreakingChangeApproval, type PlanBreakingChangeInspection } from '../domain/execution'
import { createDefaultAppSettings, createInitialRngState } from '../domain/models/factories'
import type { NormalArtianCounter, RngState } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import {
  createFakeNormalArtianCounterIdentificationClient,
  type FakeNormalArtianCounterIdentificationClient,
} from '../test/fixtures/fakeNormalArtianCounterIdentificationClient'
import { planBreakingApproval, planBreakingInspection } from '../test/fixtures/planBreakingInspection'
import { NormalCountersPage, type NormalCountersPageDependencies } from './NormalCountersPage'

/**
 * The Normal Counter Setup saves - Debug edit, unconfirm, and the Identification
 * result adoption - behind the breaking-change warning (`docs/UI_FLOW.md`
 * 16.3). A cancelled warning keeps the Identification Dialog, its unique result
 * and the restore confirmation.
 */

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const NOW = '2026-09-14T12:00:00.000Z'
const ATTACK = '基礎攻撃力強化'
const WARNING = { name: '実行中の生産計画があります' } as const

const confirmedFixture: NormalArtianCounter = {
  id: 'weapon.great_sword:8', weaponTypeId: 'weapon.great_sword', rarity: 8, counter: 98765, isConfirmed: true,
  observationCount: 4, lastObservedAt: '2026-08-30T00:00:00.000Z', candidateCount: 1, lastIdentifiedAt: null,
  createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
}

function rngState(): RngState {
  return { ...createInitialRngState(FIXTURE_TIME), baseSeed: { value: '51231782', isConfirmed: true, source: 'observation' } }
}

function dependencies(values: NormalArtianCounter[] = [confirmedFixture]) {
  const clients: FakeNormalArtianCounterIdentificationClient[] = []
  let requestCounter = 0
  const deps = {
    clients,
    getAll: vi.fn(async () => values.map((value) => structuredClone(value))),
    save: vi.fn(async (value: NormalArtianCounter, _basis?: NormalArtianCounter, _approval?: PlanBreakingChangeApproval | null) => { void _basis; void _approval; return value }),
    inspectSave: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    inspectIdentificationAdoption: vi.fn<() => Promise<PlanBreakingChangeInspection>>(async () => ({ approvalRequired: false })),
    adoptIdentification: vi.fn(async ({ weaponTypeId, startNormalCounter, observationCount }) => ({
      id: `${weaponTypeId}:8`, weaponTypeId, rarity: 8 as const, counter: startNormalCounter, isConfirmed: true,
      observationCount, candidateCount: 1, lastObservedAt: NOW, lastIdentifiedAt: NOW, createdAt: NOW, updatedAt: NOW,
    })),
    ensureRngState: vi.fn(async () => rngState()),
    ensureSettings: vi.fn(async () => createDefaultAppSettings(FIXTURE_TIME)),
    createIdentificationClient: vi.fn(() => {
      const client = createFakeNormalArtianCounterIdentificationClient()
      clients.push(client)
      return client
    }),
    now: () => NOW,
    requestId: () => `request-${++requestCounter}`,
  } satisfies NormalCountersPageDependencies & { clients: FakeNormalArtianCounterIdentificationClient[] }
  return deps
}

async function rowFor(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  const row = heading.closest<HTMLElement>('li')
  if (!row) throw new Error('Counter row was not rendered')
  return row
}

async function fillObservation(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  for (let slot = 1; slot <= 5; slot += 1) {
    const card = within(dialog).getByRole('listitem', { name: '観測1' })
    await user.click(within(card).getByRole('combobox', { name: new RegExp(`観測1 復元ボーナス${slot}`) }))
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: ATTACK }))
  }
}

describe('NormalCountersPage breaking-change warning', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('warns before an unconfirm and saves it with the approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    const inspection = planBreakingInspection({ reasons: ['normal_counter_changed'] })
    deps.inspectSave.mockResolvedValue(inspection)
    render(<NormalCountersPage dependencies={deps} />)
    await user.click(within(await rowFor('大剣')).getByRole('button', { name: '確定解除' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('通常アーティアカウンターが変わります')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()
    expect(within(await rowFor('大剣')).getByText('確定・検索に使用')).toBeInTheDocument()

    await user.click(within(await rowFor('大剣')).getByRole('button', { name: '確定解除' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('大剣のカウンターの確定を解除しました。実行中の生産計画を破棄しました。')).toBeInTheDocument()
    expect(deps.save).toHaveBeenCalledTimes(1)
    const [saved, basis, approval] = deps.save.mock.calls[0]
    expect(saved.isConfirmed).toBe(false)
    expect(basis?.id).toBe(confirmedFixture.id)
    expect(approval).toEqual(planBreakingApproval(inspection))
  })

  it('warns before a Debug edit and keeps the edited row on cancel', async () => {
    const user = userEvent.setup()
    useSettingsStore.getState().setDebugMode(true)
    const deps = dependencies()
    deps.inspectSave.mockResolvedValue(planBreakingInspection({ reasons: ['normal_counter_changed'] }))
    render(<NormalCountersPage dependencies={deps} />)
    const row = within(await rowFor('大剣'))
    const raw = row.getByLabelText('Counter raw値')
    await user.clear(raw)
    await user.type(raw, '40')
    await user.click(row.getByRole('button', { name: 'デバッグ保存' }))

    const warning = await screen.findByRole('dialog', WARNING)
    await user.click(within(warning).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deps.save).not.toHaveBeenCalled()
    expect(within(await rowFor('大剣')).getByLabelText('Counter raw値')).toHaveValue(40)
  })

  it('reports a refusal of the approved save as the page error', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    deps.inspectSave.mockResolvedValue(planBreakingInspection())
    deps.save.mockRejectedValue(new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved'))
    render(<NormalCountersPage dependencies={deps} />)
    await user.click(within(await rowFor('大剣')).getByRole('button', { name: '確定解除' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    expect(await screen.findByText('確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
    expect(within(await rowFor('大剣')).getByText('確定・検索に使用')).toBeInTheDocument()
  })

  it('keeps the Identification result and its restore confirmation when the warning is cancelled, then adopts with the approval', async () => {
    const user = userEvent.setup()
    const deps = dependencies([])
    const inspection = planBreakingInspection({ reasons: ['normal_counter_changed'] })
    deps.inspectIdentificationAdoption.mockResolvedValue(inspection)
    render(<NormalCountersPage dependencies={deps} />)
    await user.click(within(await rowFor('双剣')).getByRole('button', { name: '観測・検索' }))
    const dialog = await screen.findByRole('dialog', { name: '通常アーティアCounter検索: 双剣' })
    await fillObservation(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 7 }], searchedCounterRange: { startInclusive: 0, endInclusive: 1000 }, isTruncated: false })
    expect(await within(dialog).findByText('候補が1件に絞り込まれました')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Counterを確定' }))

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('通常アーティアカウンターを変更すると、現在の生産計画で使用している予測位置と一致しなくなります。')).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(deps.adoptIdentification).not.toHaveBeenCalled()
    // The Identification Dialog, its unique result and the confirmation are kept.
    expect(screen.getByRole('dialog', { name: '通常アーティアCounter検索: 双剣' })).toBeInTheDocument()
    expect(within(dialog).getByText('候補が1件に絞り込まれました')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ })).toBeChecked()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Counterを確定' })).toBeEnabled())

    await user.click(within(dialog).getByRole('button', { name: 'Counterを確定' }))
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
    await waitFor(() => expect(deps.adoptIdentification).toHaveBeenCalledTimes(1))
    expect(deps.adoptIdentification).toHaveBeenCalledWith(
      { weaponTypeId: 'weapon.dual_blades', startNormalCounter: 7, observationCount: 1 },
      planBreakingApproval(inspection),
    )
    expect(deps.save).not.toHaveBeenCalled()
    expect(await screen.findByText('双剣のカウンターを確定しました。実行中の生産計画を破棄しました。')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }, 30_000)
})
