import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createDefaultAppSettings, createInitialRngState } from '../domain/models/factories'
import type { AppSettings, NormalArtianCounter, RngState } from '../domain/models/publicTypes'
import { useSettingsStore } from '../stores/settingsStore'
import {
  createFakeNormalArtianCounterIdentificationClient,
  type FakeNormalArtianCounterIdentificationClient,
} from '../test/fixtures/fakeNormalArtianCounterIdentificationClient'
import { NormalCountersPage, type NormalCountersPageDependencies } from './NormalCountersPage'

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const NOW = '2026-09-14T12:00:00.000Z'
const ATTACK = '基礎攻撃力強化'
const AFFINITY = '会心率強化'
const ELEMENT = '属性強化'
const SHARPNESS = '斬れ味強化'

const fixture: NormalArtianCounter = { id: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades', rarity: 8, counter: null, isConfirmed: false, observationCount: 0, lastObservedAt: null, candidateCount: null, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME }
const confirmedFixture: NormalArtianCounter = { ...fixture, id: 'weapon.great_sword:8', weaponTypeId: 'weapon.great_sword', counter: 98765, isConfirmed: true, observationCount: 4, candidateCount: 1, lastObservedAt: '2026-08-30T00:00:00.000Z' }
const unconfirmedFixture: NormalArtianCounter = { ...fixture, id: 'weapon.long_sword:8', weaponTypeId: 'weapon.long_sword', counter: 43210, isConfirmed: false }
const multipleFixture: NormalArtianCounter = { ...fixture, id: 'weapon.hammer:8', weaponTypeId: 'weapon.hammer', counter: null, isConfirmed: false, observationCount: 1, candidateCount: 19 }

function confirmedBaseSeedState(): RngState {
  const state = createInitialRngState(FIXTURE_TIME)
  return { ...state, baseSeed: { value: '51231782', isConfirmed: true, source: 'observation' } }
}

function unconfirmedBaseSeedState(): RngState {
  const state = createInitialRngState(FIXTURE_TIME)
  return { ...state, baseSeed: { value: '51231782', isConfirmed: false, source: 'manual' } }
}

interface TestDependencies extends NormalCountersPageDependencies {
  readonly clients: FakeNormalArtianCounterIdentificationClient[]
  getAll: Mock<NormalCountersPageDependencies['getAll']>
  save: Mock<NormalCountersPageDependencies['save']>
  createIdentificationClient: Mock<NormalCountersPageDependencies['createIdentificationClient']>
}

function dependencies(
  values: NormalArtianCounter[] = [fixture],
  options: { rngState?: RngState; settings?: AppSettings } = {},
): TestDependencies {
  const clients: FakeNormalArtianCounterIdentificationClient[] = []
  let requestCounter = 0
  return {
    clients,
    getAll: vi.fn(async () => values.map((value) => structuredClone(value))),
    save: vi.fn(async (value: NormalArtianCounter) => value),
    ensureRngState: vi.fn(async () => options.rngState ?? confirmedBaseSeedState()),
    ensureSettings: vi.fn(async () => options.settings ?? createDefaultAppSettings(FIXTURE_TIME)),
    createIdentificationClient: vi.fn(() => {
      const client = createFakeNormalArtianCounterIdentificationClient()
      clients.push(client)
      return client
    }),
    now: () => NOW,
    requestId: () => `request-${++requestCounter}`,
  }
}

async function rowFor(name: string, options: { hidden?: boolean } = {}): Promise<HTMLElement> {
  // While a modal Dialog is open MUI marks the page behind it aria-hidden, so
  // a row asserted during a session is queried with `hidden: true`.
  const heading = await screen.findByRole('heading', { name, hidden: options.hidden ?? false })
  const row = heading.closest<HTMLElement>('li')
  if (!row) throw new Error('Counter row was not rendered')
  return row
}

async function openIdentification(user: ReturnType<typeof userEvent.setup>, weaponName: string): Promise<HTMLElement> {
  await user.click(within(await rowFor(weaponName)).getByRole('button', { name: '観測・検索' }))
  return screen.findByRole('dialog', { name: `通常アーティアCounter検索: ${weaponName}` })
}

async function pickSlot(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, number: number, slot: number, optionName: string) {
  const card = within(dialog).getByRole('listitem', { name: `観測${number}` })
  await user.click(within(card).getByRole('combobox', { name: new RegExp(`観測${number} 復元ボーナス${slot}`) }))
  await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: optionName }))
}

async function fillObservation(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, number: number, names: readonly [string, string, string, string, string]) {
  for (let slot = 0; slot < 5; slot += 1) await pickSlot(user, dialog, number, slot + 1, names[slot]!)
}

describe('NormalCountersPage', () => {
  beforeEach(() => useSettingsStore.getState().reset())
  it('shows rows and prevents direct editing when Debug Mode is off', async () => {
    render(<NormalCountersPage dependencies={dependencies()} />)
    expect(await screen.findByRole('heading', { name: '双剣' })).toBeInTheDocument()
    expect(await screen.findAllByRole('heading', { level: 3 })).toHaveLength(14)
    expect(screen.queryByText(/レア[67]/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/検索に未使用/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Counter raw値')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'デバッグ保存' })).not.toBeInTheDocument()
    expect(screen.queryByText(/観測検索は未実装/)).not.toBeInTheDocument()
  })

  it('lists the 14 rarity-8 weapon types once each, with status, counts and last observation', async () => {
    render(<NormalCountersPage dependencies={dependencies([fixture, confirmedFixture, unconfirmedFixture, multipleFixture])} />)
    const list = (await screen.findByRole('heading', { name: '双剣' })).closest<HTMLElement>('ul')
    if (!list) throw new Error('Counter list was not rendered')
    // One DOM structure serves PC and smartphone, so every weapon type appears
    // exactly once rather than in a hidden duplicate representation.
    expect(within(list).getAllByRole('listitem')).toHaveLength(14)
    expect(screen.getAllByRole('heading', { name: '大剣' })).toHaveLength(1)

    const confirmed = within(await rowFor('大剣'))
    expect(confirmed.getByText('確定・検索に使用')).toBeInTheDocument()
    expect(confirmed.getByText('観測数')).toBeInTheDocument()
    expect(confirmed.getByText('候補数')).toBeInTheDocument()
    expect(confirmed.getByText('最終観測')).toBeInTheDocument()
    expect(within(await rowFor('太刀')).getByText('未確定・検索に未使用')).toBeInTheDocument()
    expect(within(await rowFor('双剣')).getByText('未設定・検索に未使用')).toBeInTheDocument()
    expect(within(await rowFor('ハンマー')).getByText('候補複数・検索に未使用')).toBeInTheDocument()
    expect(screen.getByText('確定 1 / 14')).toBeInTheDocument()
  })

  it('shows a load failure as an error, never as synthetic unset Counters', async () => {
    const deps = dependencies(); deps.getAll = vi.fn(async (): Promise<NormalArtianCounter[]> => { throw new Error('IndexedDB read failed') })
    render(<NormalCountersPage dependencies={deps} />)
    expect(await screen.findByText('IndexedDB read failed')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '武器種別カウンター（レア8）' })).toBeNull()
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.queryByText(/確定 \d+ \/ 14/)).toBeNull()
    expect(screen.queryByText(/未設定・検索に未使用/)).toBeNull()
  })

  it('never shows raw Counter values in the normal UI', async () => {
    // `docs/UI_FLOW.md` 3: Seed / Counter values are Debug Mode only.
    render(<NormalCountersPage dependencies={dependencies([confirmedFixture, unconfirmedFixture])} />)
    await screen.findByRole('heading', { name: '大剣' })
    expect(screen.queryByText(/98765/)).not.toBeInTheDocument()
    expect(screen.queryByText(/43210/)).not.toBeInTheDocument()
    expect(screen.queryByText(/51231782/)).not.toBeInTheDocument()
  })

  it('shows raw Counter values only inside the Debug Mode editor', async () => {
    useSettingsStore.getState().setDebugMode(true)
    render(<NormalCountersPage dependencies={dependencies([confirmedFixture])} />)
    const row = within(await rowFor('大剣'))
    expect(row.getByLabelText('Counter raw値')).toHaveValue(98765)
    expect(row.getByRole('checkbox', { name: '確定済み' })).toBeChecked()
    expect(row.getByRole('button', { name: 'デバッグ保存' })).toHaveAccessibleDescription('大剣')
  })

  it('allows Debug editing, rejects invalid counters, and persists valid data', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies()
    render(<NormalCountersPage dependencies={deps} />)
    const row = await rowFor('双剣')
    const input = within(row).getByLabelText('Counter raw値')
    const save = within(row).getByRole('button', { name: 'デバッグ保存' })
    await user.type(input, '-1')
    await user.click(save)
    expect(await screen.findByText(/non-negative integer/)).toBeInTheDocument()
    await user.clear(input); await user.type(input, '12'); await user.click(save)
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: 12 }))
  }, 15_000)

  it('never confirms a Counter without a value', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup(); const deps = dependencies([confirmedFixture])
    render(<NormalCountersPage dependencies={deps} />)
    const row = within(await rowFor('大剣'))
    await user.clear(row.getByLabelText('Counter raw値'))
    expect(row.getByRole('checkbox', { name: '確定済み' })).toBeDisabled()
    expect(row.getByRole('checkbox', { name: '確定済み' })).not.toBeChecked()
    await user.click(row.getByRole('button', { name: 'デバッグ保存' }))
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ counter: null, isConfirmed: false, rarity: 8 }))
    expect(await screen.findByText('カウンターを保存しました。')).toBeInTheDocument()
  }, 15_000)

  it('cannot start a search until the Base Seed is confirmed, and requires nothing else of the RNG state', async () => {
    const deps = dependencies([fixture], { rngState: unconfirmedBaseSeedState() })
    render(<NormalCountersPage dependencies={deps} />)
    const row = within(await rowFor('双剣'))
    expect(await screen.findByText(/先にRNG状態設定でBase Seedを確定してください/)).toBeInTheDocument()
    expect(row.getByRole('button', { name: '観測・検索' })).toBeDisabled()
    expect(deps.createIdentificationClient).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('starts a search with only the Base Seed confirmed, even while Skill / Gogma Counters are unknown', async () => {
    const user = userEvent.setup()
    const state = confirmedBaseSeedState()
    expect(state.skillCounter.value).toBeNull()
    expect(state.gogmaCounter.value).toBeNull()
    const deps = dependencies([fixture], { rngState: state })
    render(<NormalCountersPage dependencies={deps} />)
    await rowFor('双剣')
    expect(screen.queryByText(/先にRNG状態設定でBase Seedを確定してください/)).not.toBeInTheDocument()
    const dialog = await openIdentification(user, '双剣')
    expect(deps.createIdentificationClient).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText('観測後はゲームを保存しないでください。')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(5)
    expect(within(dialog).queryByText(/レア度/)).not.toBeInTheDocument()
  }, 15_000)

  it('offers 観測・検索 for every one of the 14 weapon types, Switch Axe included, with no unsupported notice', async () => {
    const deps = dependencies()
    render(<NormalCountersPage dependencies={deps} />)
    const row = within(await rowFor('スラッシュアックス'))
    expect(row.getByRole('button', { name: '観測・検索' })).toBeEnabled()
    expect(row.queryByText(/Production検証対象外/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Counter検索できません/)).not.toBeInTheDocument()
    expect(row.queryByText(/normal_pool_unverified/)).not.toBeInTheDocument()
    for (const name of ['弓', 'ライトボウガン', 'ヘビィボウガン', '大剣', '片手剣', '双剣', '太刀', 'ハンマー', '狩猟笛', 'ランス', 'ガンランス', 'スラッシュアックス', 'チャージアックス', '操虫棍']) {
      expect(within(await rowFor(name)).getByRole('button', { name: '観測・検索' })).toBeEnabled()
    }
    expect(deps.createIdentificationClient).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  }, 15_000)

  it('identifies a Switch Axe Counter from a 属性あり and a 無属性 observation, sends table_a / table_b, and saves C = 0 with two observations', async () => {
    const user = userEvent.setup()
    const deps = dependencies([])
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, 'スラッシュアックス')
    expect(deps.createIdentificationClient).toHaveBeenCalledTimes(1)
    expect(within(dialog).queryByText(/Production検証対象外/)).not.toBeInTheDocument()
    const first = within(dialog).getByRole('listitem', { name: '観測1' })
    expect(within(first).getByRole('radio', { name: '属性あり' })).toBeChecked()
    expect(within(first).queryByRole('radio', { name: /テーブル/ })).not.toBeInTheDocument()
    expect(within(first).getAllByRole('combobox')).toHaveLength(5)
    // Observation 1: the direct Fire Counter 0 game observation.
    await fillObservation(user, dialog, 1, [SHARPNESS, SHARPNESS, AFFINITY, ATTACK, ELEMENT])
    await user.click(within(dialog).getByRole('button', { name: '観測を追加' }))
    const second = within(dialog).getByRole('listitem', { name: '観測2' })
    await user.click(within(second).getByRole('radio', { name: '無属性' }))
    // Observation 2: the consecutive all-different-parts Counter 1 observation; Element is offered on 無属性 too.
    await fillObservation(user, dialog, 2, [AFFINITY, ATTACK, ELEMENT, ELEMENT, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    const { input } = client.lastCall()
    expect(input).toMatchObject({ baseSeed: '51231782', weaponTypeId: 'weapon.switch_axe', rarity: 8 })
    expect(input.observations.map((observation) => observation.tableClass)).toEqual(['table_a', 'table_b'])
    expect(JSON.stringify(input)).not.toContain('element.')
    await client.resolveLast({ matches: [{ startNormalCounter: 0 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    expect(await within(dialog).findByText('候補が1件に絞り込まれました')).toBeInTheDocument()
    expect(within(dialog).queryByText(/startNormalCounter/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Counterを確定' }))
    await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(1))
    expect(deps.save.mock.calls[0]![0]).toEqual({
      id: 'weapon.switch_axe:8',
      weaponTypeId: 'weapon.switch_axe',
      rarity: 8,
      counter: 0,
      isConfirmed: true,
      observationCount: 2,
      candidateCount: 1,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(await screen.findByText('スラッシュアックスのカウンターを確定しました。')).toBeInTheDocument()
    expect(within(await rowFor('スラッシュアックス')).getByText('確定・検索に使用')).toBeInTheDocument()
  }, 30_000)

  it('builds the initial range from AppSettings.defaultSearchLimit and sends it inclusively', async () => {
    const user = userEvent.setup()
    const deps = dependencies([fixture], { settings: { ...createDefaultAppSettings(FIXTURE_TIME), defaultSearchLimit: 1234 } })
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '双剣')
    expect(within(dialog).getByLabelText('検索範囲の開始')).toHaveValue(0)
    expect(within(dialog).getByLabelText('検索範囲の終了')).toHaveValue(1234)
    await fillObservation(user, dialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    expect(client.lastCall().requestId).toBe('request-1')
    expect(client.lastCall().input).toMatchObject({
      baseSeed: '51231782',
      weaponTypeId: 'weapon.dual_blades',
      rarity: 8,
      normalCounterRange: { startInclusive: 0, endInclusive: 1234 },
    })
    expect(client.lastCall().input.observations).toHaveLength(1)
  }, 15_000)

  it('saves the unique start Counter C itself with the observation count, never C + N', async () => {
    const user = userEvent.setup()
    const deps = dependencies([fixture])
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '双剣')
    await fillObservation(user, dialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '観測を追加' }))
    await fillObservation(user, dialog, 2, [AFFINITY, ATTACK, ATTACK, ATTACK, AFFINITY])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    expect(client.lastCall().input.observations).toHaveLength(2)
    await client.resolveLast({ matches: [{ startNormalCounter: 777 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    expect(await within(dialog).findByText('候補が1件に絞り込まれました')).toBeInTheDocument()
    expect(screen.queryByText(/777/)).not.toBeInTheDocument()

    const confirmButton = within(dialog).getByRole('button', { name: 'Counterを確定' })
    expect(confirmButton).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(confirmButton)

    await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(1))
    const saved = deps.save.mock.calls[0]![0]
    expect(saved).toEqual({
      id: 'weapon.dual_blades:8',
      weaponTypeId: 'weapon.dual_blades',
      rarity: 8,
      counter: 777,
      isConfirmed: true,
      observationCount: 2,
      candidateCount: 1,
      lastObservedAt: NOW,
      createdAt: FIXTURE_TIME,
      updatedAt: NOW,
    })
    expect(saved.counter).not.toBe(777 + 2)
    expect(await screen.findByText('双剣のカウンターを確定しました。')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(client.dispose).toHaveBeenCalledTimes(1)
    expect(within(await rowFor('双剣')).getByText('確定・検索に使用')).toBeInTheDocument()
    expect(screen.getByText('確定 1 / 14')).toBeInTheDocument()
    // The persisted history stays the Counter row alone: no observation is stored.
    expect(saved).not.toHaveProperty('observations')
  }, 30_000)

  it('creates the row for a weapon type with no persisted Counter when its unique result is confirmed', async () => {
    const user = userEvent.setup()
    const deps = dependencies([])
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '弓')
    await fillObservation(user, dialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 4 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    await user.click(await within(dialog).findByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Counterを確定' }))
    await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(1))
    expect(deps.save.mock.calls[0]![0]).toEqual({
      id: 'weapon.bow:8',
      weaponTypeId: 'weapon.bow',
      rarity: 8,
      counter: 4,
      isConfirmed: true,
      observationCount: 1,
      candidateCount: 1,
      lastObservedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }, 20_000)

  it('shows the raw unique Counter inside the Dialog only in Debug Mode', async () => {
    useSettingsStore.getState().setDebugMode(true)
    const user = userEvent.setup()
    const deps = dependencies([fixture])
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '双剣')
    await fillObservation(user, dialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 777 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    expect(await within(dialog).findByText('デバッグ診断: startNormalCounter = 777')).toBeInTheDocument()
  }, 15_000)

  it('keeps a failed confirmation save inside the Dialog without touching the list', async () => {
    const user = userEvent.setup()
    const deps = dependencies([fixture])
    deps.save = vi.fn(async (): Promise<NormalArtianCounter> => { throw new Error('IndexedDB write failed') })
    render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '双剣')
    await fillObservation(user, dialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(dialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[0]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 777 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    await user.click(await within(dialog).findByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Counterを確定' }))
    expect(await within(dialog).findByText(/Counterを確定できませんでした: IndexedDB write failed/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(await rowFor('双剣', { hidden: true })).getByText('未設定・検索に未使用')).toBeInTheDocument()
    expect(client.dispose).not.toHaveBeenCalled()
  }, 15_000)

  it('unconfirms a Counter while keeping its value, observation count, candidate count and last observation', async () => {
    const user = userEvent.setup()
    const deps = dependencies([confirmedFixture, fixture])
    render(<NormalCountersPage dependencies={deps} />)
    expect(within(await rowFor('双剣')).queryByRole('button', { name: '確定解除' })).not.toBeInTheDocument()
    await user.click(within(await rowFor('大剣')).getByRole('button', { name: '確定解除' }))
    await waitFor(() => expect(deps.save).toHaveBeenCalledTimes(1))
    expect(deps.save.mock.calls[0]![0]).toEqual({
      ...confirmedFixture,
      isConfirmed: false,
      updatedAt: NOW,
    })
    expect(await screen.findByText('大剣のカウンターの確定を解除しました。')).toBeInTheDocument()
    const row = within(await rowFor('大剣'))
    expect(row.getByText('未確定・検索に未使用')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: '確定解除' })).not.toBeInTheDocument()
    expect(screen.getByText('確定 0 / 14')).toBeInTheDocument()
    expect(screen.queryByText(/98765/)).not.toBeInTheDocument()
  }, 15_000)

  it('disposes the Worker Client when the Dialog is closed and when the page unmounts', async () => {
    const user = userEvent.setup()
    const deps = dependencies([fixture])
    const { unmount } = render(<NormalCountersPage dependencies={deps} />)
    const dialog = await openIdentification(user, '双剣')
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deps.clients[0]!.dispose).toHaveBeenCalledTimes(1)

    const secondDialog = await openIdentification(user, '双剣')
    expect(deps.clients).toHaveLength(2)
    await fillObservation(user, secondDialog, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(within(secondDialog).getByRole('button', { name: '検索' }))
    const client = deps.clients[1]!
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    unmount()
    expect(client.cancel).toHaveBeenCalledWith('request-1')
    expect(client.dispose).toHaveBeenCalledTimes(1)
  }, 20_000)
})
