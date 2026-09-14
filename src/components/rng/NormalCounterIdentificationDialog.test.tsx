import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { NormalArtianCounterIdentificationResult } from '../../domain/rng/identification'
import {
  NormalArtianCounterIdentificationDuplicateRequestError,
  NormalArtianCounterIdentificationWorkerError,
  NormalArtianCounterIdentificationWorkerUnavailableError,
} from '../../services/rngIdentification/normalArtianCounterIdentificationWorkerClient'
import {
  createFakeNormalArtianCounterIdentificationClient,
} from '../../test/fixtures/fakeNormalArtianCounterIdentificationClient'
import { NormalCounterIdentificationDialog, type NormalCounterIdentificationDialogProps } from './NormalCounterIdentificationDialog'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data

const BASE_SEED = '51231782'
const ATTACK = '基礎攻撃力強化'
const ELEMENT = '属性強化'
const SHARPNESS = '斬れ味強化'
const AFFINITY = '会心率強化'
const CAPACITY = '装填数強化'

function uniqueResult(startNormalCounter: number): NormalArtianCounterIdentificationResult {
  return { matches: [{ startNormalCounter }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false }
}

function setup(overrides: Partial<NormalCounterIdentificationDialogProps> = {}) {
  const client = createFakeNormalArtianCounterIdentificationClient()
  let requestCounter = 0
  const props: NormalCounterIdentificationDialogProps = {
    weaponTypeId: 'weapon.dual_blades',
    weaponName: '双剣',
    baseSeed: BASE_SEED,
    initialCounterRange: { startInclusive: 0, endInclusive: 5000 },
    bonusTypes: master.bonusTypes,
    elements: master.elements,
    client,
    createRequestId: vi.fn(() => `request-${++requestCounter}`),
    debugMode: false,
    onConfirm: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...overrides,
  }
  const view = render(<NormalCounterIdentificationDialog {...props} />)
  return { client, props, ...view }
}

function observationCard(number: number): HTMLElement {
  return screen.getByRole('listitem', { name: `観測${number}` })
}

async function pickSlot(user: ReturnType<typeof userEvent.setup>, number: number, slot: number, optionName: string) {
  const card = observationCard(number)
  await user.click(within(card).getByRole('combobox', { name: new RegExp(`観測${number} 復元ボーナス${slot}`) }))
  await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: optionName }))
}

async function fillObservation(user: ReturnType<typeof userEvent.setup>, number: number, names: readonly [string, string, string, string, string]) {
  for (let slot = 0; slot < 5; slot += 1) await pickSlot(user, number, slot + 1, names[slot]!)
}

describe('NormalCounterIdentificationDialog', () => {
  it('fixes rarity 8, offers only 属性あり / 無属性 for a Melee weapon, and lists five ordered slots drawn from the Production pool', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByRole('dialog', { name: '通常アーティアCounter検索: 双剣' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/レア度/)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /レア/ })).not.toBeInTheDocument()
    const card = observationCard(1)
    expect(within(card).getByRole('radio', { name: '属性あり' })).toBeChecked()
    expect(within(card).getByRole('radio', { name: '無属性' })).not.toBeChecked()
    for (const exact of ['火', '水', '雷', '氷', '龍', '毒', '麻痺', '睡眠', '爆破']) {
      expect(within(card).queryByRole('radio', { name: exact })).not.toBeInTheDocument()
    }
    const slots = within(card).getAllByRole('combobox')
    expect(slots).toHaveLength(5)
    slots.forEach((slot, index) => expect(slot).toHaveAccessibleName(new RegExp(`観測1 復元ボーナス${index + 1}`)))
    expect(within(card).getByRole('list', { name: '観測1の復元ボーナス5枠' })).toBeInTheDocument()
    expect(within(card).queryByText(/ランク/)).not.toBeInTheDocument()

    // 双剣 / 属性あり draws Attack, Element, Sharpness and Affinity; never Capacity.
    await user.click(slots[0]!)
    const attributeOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(attributeOptions).toEqual(['未入力', ATTACK, ELEMENT, SHARPNESS, AFFINITY])
    await user.keyboard('{Escape}')
    // 無属性 drops Element and clears a slot that held it.
    await pickSlot(user, 1, 1, ELEMENT)
    await user.click(within(card).getByRole('radio', { name: '無属性' }))
    expect(within(card).getByRole('combobox', { name: /観測1 復元ボーナス1/ })).toHaveTextContent('未入力')
    await user.click(within(card).getByRole('combobox', { name: /観測1 復元ボーナス1/ }))
    const noneOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(noneOptions).toEqual(['未入力', ATTACK, SHARPNESS, AFFINITY])
    expect(noneOptions).not.toContain(CAPACITY)
  }, 15_000)

  it('keeps observations in forge order, appends at the end, and deletes only the last one', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getAllByRole('listitem', { name: /^観測\d+$/ })).toHaveLength(1)
    expect(screen.getByText('同じ武器種を連続して作成した結果を、作成した順に入力してください。', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '観測1を削除' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '観測を追加' }))
    await user.click(screen.getByRole('button', { name: '観測を追加' }))
    const cards = screen.getAllByRole('listitem', { name: /^観測\d+$/ })
    expect(cards.map((card) => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual(['観測1', '観測2', '観測3'])
    await pickSlot(user, 2, 1, AFFINITY)
    expect(screen.queryByRole('button', { name: '観測1を削除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '観測2を削除' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '観測3を削除' }))
    expect(screen.getAllByRole('listitem', { name: /^観測\d+$/ })).toHaveLength(2)
    // The remaining observation keeps its own input; nothing shifted.
    expect(within(observationCard(2)).getByRole('combobox', { name: /観測2 復元ボーナス1/ })).toHaveTextContent(AFFINITY)
  }, 15_000)

  it('shows both safety notices and starts from the initial range', () => {
    setup({ initialCounterRange: { startInclusive: 0, endInclusive: 1234 } })
    expect(screen.getAllByText('観測後はゲームを保存しないでください。').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('調査前の状態へ戻ったことを確認してからCounterを確定してください。').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('検索範囲の開始')).toHaveValue(0)
    expect(screen.getByLabelText('検索範囲の終了')).toHaveValue(1234)
  })

  it('refuses to search until every slot of every observation is filled', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await user.click(screen.getByRole('button', { name: '検索' }))
    expect(await screen.findByText('観測1の復元ボーナス1を入力してください。')).toBeInTheDocument()
    expect(client.identify).not.toHaveBeenCalled()
  })

  it('sends baseSeed, weapon, rarity 8, ordered observations and the inclusive range, then shows progress', async () => {
    const user = userEvent.setup()
    const { client } = setup({ initialCounterRange: { startInclusive: 0, endInclusive: 5000 } })
    await fillObservation(user, 1, [ATTACK, ELEMENT, SHARPNESS, AFFINITY, ATTACK])
    await user.click(screen.getByRole('button', { name: '観測を追加' }))
    await user.click(within(observationCard(2)).getByRole('radio', { name: '無属性' }))
    await fillObservation(user, 2, [AFFINITY, ATTACK, ATTACK, SHARPNESS, AFFINITY])
    await user.clear(screen.getByLabelText('検索範囲の終了'))
    await user.type(screen.getByLabelText('検索範囲の終了'), '300')
    await user.click(screen.getByRole('button', { name: '検索' }))

    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    const { requestId, input } = client.lastCall()
    expect(requestId).toBe('request-1')
    expect(input).toEqual({
      baseSeed: BASE_SEED,
      weaponTypeId: 'weapon.dual_blades',
      rarity: 8,
      observations: [
        {
          tableClass: 'table_a',
          bonuses: [
            { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.normal_sharpness', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
          ],
        },
        {
          tableClass: 'table_b',
          bonuses: [
            { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.normal_sharpness', bonusRankId: 'bonus_rank.base' },
            { bonusTypeId: 'bonus_type.affinity', bonusRankId: 'bonus_rank.base' },
          ],
        },
      ],
      normalCounterRange: { startInclusive: 0, endInclusive: 300 },
    })
    expect(input).not.toHaveProperty('maxMatches')

    expect(screen.getByRole('group', { name: '検索進捗' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '検索' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '観測を追加' })).toBeDisabled()
    expect(within(observationCard(1)).getByRole('radio', { name: '無属性' })).toBeDisabled()
    act(() => client.emitProgress({ searchedCounters: 120, totalCounters: 301, matchesFound: 2 }))
    expect(screen.getByText('評価済みCounter候補: 120 / 301（発見候補 2件）')).toBeInTheDocument()
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeCloseTo((120 / 301) * 100, 5)
  }, 20_000)

  it('cancels the active request, keeps the inputs, and re-searches under a new requestId', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(client.cancel).toHaveBeenCalledWith('request-1')
    expect(await screen.findByText(/検索をキャンセルしました/)).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: /一致する候補がありません/ })).not.toBeInTheDocument()
    expect(screen.queryByText('一致する候補がありません')).not.toBeInTheDocument()
    expect(within(observationCard(1)).getByRole('combobox', { name: /観測1 復元ボーナス5/ })).toHaveTextContent(ATTACK)
    expect(screen.getByLabelText('検索範囲の終了')).toHaveValue(5000)
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(2))
    expect(client.lastCall().requestId).toBe('request-2')
    expect(client.lastCall().input).toEqual(client.calls[0]!.input)
  }, 15_000)

  it('explains a zero result without widening the range', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    expect(await screen.findByText('一致する候補がありません')).toBeInTheDocument()
    expect(screen.getByText(/観測入力、Base Seed、武器種、属性区分、検索範囲、作成順を確認してください。範囲は自動拡張されません。/)).toBeInTheDocument()
    expect(screen.getByLabelText('検索範囲の終了')).toHaveValue(5000)
    expect(screen.queryByRole('button', { name: 'Counterを確定' })).not.toBeInTheDocument()
    expect(client.identify).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('reports multiple candidates, asks for the next forge, and offers no manual candidate selector', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 4 }, { startNormalCounter: 812 }, { startNormalCounter: 2999 }], searchedCounterRange: { startInclusive: 0, endInclusive: 5000 }, isTruncated: false })
    expect(await screen.findByText('候補が3件あります')).toBeInTheDocument()
    expect(screen.getByText(/次の連続forge結果/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Counterを確定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/812/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2999/)).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  }, 15_000)

  it('never allows confirming a truncated result, even with exactly one match', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast({ matches: [{ startNormalCounter: 4 }], searchedCounterRange: { startInclusive: 0, endInclusive: 4 }, isTruncated: true })
    expect(await screen.findByText('探索が途中で打ち切られました')).toBeInTheDocument()
    expect(screen.getByText(/候補数（1件）に関係なく確定できません/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Counterを確定' })).not.toBeInTheDocument()
    expect(screen.queryByText('候補が1件に絞り込まれました')).not.toBeInTheDocument()
  }, 15_000)

  it('confirms a unique result only after the restore checkbox, reporting C and the observation count separately', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => undefined)
    const { client } = setup({ onConfirm })
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '観測を追加' }))
    await fillObservation(user, 2, [AFFINITY, AFFINITY, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast(uniqueResult(777))
    expect(await screen.findByText('候補が1件に絞り込まれました')).toBeInTheDocument()
    // The raw Counter is never shown in the ordinary UI.
    expect(screen.queryByText(/777/)).not.toBeInTheDocument()
    // The safety notice appears again right before the confirmation.
    expect(screen.getAllByText('観測後はゲームを保存しないでください。')).toHaveLength(2)
    const checkbox = screen.getByRole('checkbox', { name: '観測後にゲームを保存せず、調査前の状態へ戻ったことを確認しました' })
    expect(checkbox).not.toBeChecked()
    const confirmButton = screen.getByRole('button', { name: 'Counterを確定' })
    expect(confirmButton).toBeDisabled()
    await user.click(checkbox)
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm).toHaveBeenCalledWith({ startNormalCounter: 777, observationCount: 2 })
    expect(onConfirm).not.toHaveBeenCalledWith(expect.objectContaining({ startNormalCounter: 779 }))
  }, 20_000)

  it('shows the raw unique Counter only in Debug Mode', async () => {
    const user = userEvent.setup()
    const { client } = setup({ debugMode: true })
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast(uniqueResult(777))
    expect(await screen.findByText('デバッグ診断: startNormalCounter = 777')).toBeInTheDocument()
  }, 15_000)

  it('drops a unique result and the restore confirmation as soon as the observations change', async () => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast(uniqueResult(777))
    await user.click(await screen.findByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(screen.getByRole('button', { name: '観測を追加' }))
    expect(screen.queryByText('候補が1件に絞り込まれました')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Counterを確定' })).not.toBeInTheDocument()
  }, 15_000)

  it('keeps a failed confirmation open with its error and the inputs intact', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => { throw new Error('IndexedDB write failed') })
    const { client } = setup({ onConfirm })
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.resolveLast(uniqueResult(777))
    await user.click(await screen.findByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ }))
    await user.click(screen.getByRole('button', { name: 'Counterを確定' }))
    expect(await screen.findByText('Counterを確定できませんでした: IndexedDB write failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Counterを確定' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: /調査前の状態へ戻ったことを確認しました/ })).toBeChecked()
  }, 15_000)

  it.each([
    {
      name: 'invalid_input',
      error: new NormalArtianCounterIdentificationWorkerError('Slot 1 (bonus_type.element / bonus_rank.base) cannot be produced', 'invalid_input', null),
      title: '入力エラー',
      body: /各観測の属性区分と復元ボーナス1〜5、検索範囲を確認してください/,
    },
    {
      name: 'unsupported_input / normal_pool_unverified',
      error: new NormalArtianCounterIdentificationWorkerError('unsupported: normal_pool_unverified', 'unsupported_input', 'normal_pool_unverified'),
      title: '未対応の入力',
      body: /Production検証対象外のため、Counter検索できません/,
    },
    {
      name: 'unsupported_input / engine_capability_unavailable',
      error: new NormalArtianCounterIdentificationWorkerError('unsupported: engine_capability_unavailable', 'unsupported_input', 'engine_capability_unavailable'),
      title: '未対応の入力',
      body: /通常アーティア予測に対応していない/,
    },
    {
      name: 'unexpected_error',
      error: new NormalArtianCounterIdentificationWorkerError('boom', 'unexpected_error', null),
      title: '検索処理エラー',
      body: /再試行してください/,
    },
    {
      name: 'worker unavailable',
      error: new NormalArtianCounterIdentificationWorkerUnavailableError(),
      title: 'Workerを利用できません',
      body: /再試行してください/,
    },
    {
      name: 'duplicate request',
      error: new NormalArtianCounterIdentificationDuplicateRequestError('request-1'),
      title: '検索リクエストエラー',
      body: /もう一度検索してください/,
    },
  ])('shows $name as its own error, never as a zero-match result, and never as a raw enum', async ({ error, title, body }) => {
    const user = userEvent.setup()
    const { client } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.rejectLast(error)
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.queryByText('一致する候補がありません')).not.toBeInTheDocument()
    expect(screen.queryByText(/検索をキャンセルしました/)).not.toBeInTheDocument()
    expect(screen.queryByText(/normal_pool_unverified|engine_capability_unavailable|invalid_input|unexpected_error/)).not.toBeInTheDocument()
    // Inputs survive and the search can be retried.
    expect(within(observationCard(1)).getByRole('combobox', { name: /観測1 復元ボーナス1/ })).toHaveTextContent(ATTACK)
    expect(screen.getByRole('button', { name: '検索' })).toBeEnabled()
  }, 15_000)

  it('shows the diagnostic message of an error only in Debug Mode', async () => {
    const user = userEvent.setup()
    const { client } = setup({ debugMode: true })
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    await client.rejectLast(new NormalArtianCounterIdentificationWorkerError('unsupported: normal_pool_unverified', 'unsupported_input', 'normal_pool_unverified'))
    expect(await screen.findByText('デバッグ診断: unsupported: normal_pool_unverified')).toBeInTheDocument()
  }, 15_000)

  it('cancels a running request when unmounted and ignores its late outcome', async () => {
    const user = userEvent.setup()
    const { client, unmount } = setup()
    await fillObservation(user, 1, [ATTACK, ATTACK, ATTACK, ATTACK, ATTACK])
    await user.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
    unmount()
    expect(client.cancel).toHaveBeenCalledWith('request-1')
  }, 15_000)

  it('fails closed for Switch Axe instead of offering a reference-pool search', () => {
    const { client } = setup({ weaponTypeId: 'weapon.switch_axe', weaponName: 'スラッシュアックス' })
    expect(screen.getByText(/Production検証対象外のため、Counter検索できません/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '検索' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(client.identify).not.toHaveBeenCalled()
  })

  describe('Bow lottery tables', () => {
    const TABLE_A = 'テーブルA（火・水・雷・氷・龍・爆破）'
    const TABLE_B = 'テーブルB（無属性・毒・麻痺・睡眠）'

    it('offers exactly Table A / Table B with their element lists, no exact element dropdown, and no raw enum', () => {
      setup({ weaponTypeId: 'weapon.bow', weaponName: '弓' })
      const card = observationCard(1)
      const radios = within(card).getAllByRole('radio')
      expect(radios.map((radio) => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent)).toEqual([TABLE_A, TABLE_B])
      expect(within(card).getByRole('radio', { name: TABLE_A })).toBeChecked()
      expect(within(card).getByRole('radio', { name: TABLE_B })).not.toBeChecked()
      expect(within(card).queryByRole('radio', { name: '属性あり' })).not.toBeInTheDocument()
      expect(within(card).queryByRole('radio', { name: '無属性' })).not.toBeInTheDocument()
      for (const exact of ['火', '水', '雷', '氷', '龍', '毒', '麻痺', '睡眠', '爆破', '無属性']) {
        expect(within(card).queryByRole('radio', { name: exact })).not.toBeInTheDocument()
        expect(within(card).queryByRole('option', { name: exact })).not.toBeInTheDocument()
      }
      // Only the five slot selects exist; there is no element combobox.
      expect(within(card).getAllByRole('combobox')).toHaveLength(5)
      expect(screen.queryByText(/table_a|table_b|attribute_present/)).not.toBeInTheDocument()
      expect(screen.getByText(/属性の種類そのものは選択せず/)).toBeInTheDocument()
      expect(screen.getByText(/どちらの区分で作成してもCounterは同じ1本を消費します/)).toBeInTheDocument()
    })

    it('draws Table A options from [Attack, Element, Affinity] and Table B from [Attack, Affinity], clearing an Element slot on switch', async () => {
      const user = userEvent.setup()
      setup({ weaponTypeId: 'weapon.bow', weaponName: '弓' })
      const card = observationCard(1)
      await user.click(within(card).getByRole('combobox', { name: /観測1 復元ボーナス1/ }))
      const tableAOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
      expect(tableAOptions).toEqual(['未入力', ATTACK, ELEMENT, AFFINITY])
      expect(tableAOptions).not.toContain(SHARPNESS)
      expect(tableAOptions).not.toContain(CAPACITY)
      await user.keyboard('{Escape}')
      await pickSlot(user, 1, 1, ELEMENT)
      await pickSlot(user, 1, 2, ATTACK)
      await user.click(within(card).getByRole('radio', { name: TABLE_B }))
      // The Element slot cannot exist on Table B and is cleared; Attack survives.
      expect(within(card).getByRole('combobox', { name: /観測1 復元ボーナス1/ })).toHaveTextContent('未入力')
      expect(within(card).getByRole('combobox', { name: /観測1 復元ボーナス2/ })).toHaveTextContent(ATTACK)
      await user.click(within(card).getByRole('combobox', { name: /観測1 復元ボーナス1/ }))
      const tableBOptions = within(await screen.findByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
      expect(tableBOptions).toEqual(['未入力', ATTACK, AFFINITY])
      expect(tableBOptions).not.toContain(ELEMENT)
    }, 15_000)

    it('sends tableClass table_a / table_b per observation on the one shared Bow Counter', async () => {
      const user = userEvent.setup()
      const { client } = setup({ weaponTypeId: 'weapon.bow', weaponName: '弓' })
      // Observation 1: Blast (Table A) at Counter 0 as observed in the game.
      await fillObservation(user, 1, [ATTACK, ATTACK, AFFINITY, ELEMENT, ELEMENT])
      await user.click(screen.getByRole('button', { name: '観測を追加' }))
      // Observation 2: Poison (Table B) at the next Counter of the same stream.
      await user.click(within(observationCard(2)).getByRole('radio', { name: TABLE_B }))
      await fillObservation(user, 2, [AFFINITY, AFFINITY, ATTACK, ATTACK, AFFINITY])
      await user.click(screen.getByRole('button', { name: '検索' }))
      await waitFor(() => expect(client.identify).toHaveBeenCalledTimes(1))
      const { input } = client.lastCall()
      expect(input.weaponTypeId).toBe('weapon.bow')
      expect(input.observations.map((observation) => observation.tableClass)).toEqual(['table_a', 'table_b'])
      expect(input.observations[0]!.bonuses.map((bonus) => bonus.bonusTypeId)).toEqual([
        'bonus_type.attack', 'bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element', 'bonus_type.element',
      ])
      expect(input.observations[1]!.bonuses.map((bonus) => bonus.bonusTypeId)).toEqual([
        'bonus_type.affinity', 'bonus_type.affinity', 'bonus_type.attack', 'bonus_type.attack', 'bonus_type.affinity',
      ])
      for (const observation of input.observations) expect(observation).not.toHaveProperty('elementId')
      expect(JSON.stringify(input)).not.toContain('element.')
    }, 20_000)
  })
})
