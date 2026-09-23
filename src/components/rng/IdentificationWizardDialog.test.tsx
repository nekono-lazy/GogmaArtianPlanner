import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createInitialRngState } from '../../domain/models/factories'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { getEnabledElements, getEnabledWeaponTypes } from '../../domain/master/masterSelectors'
import {
  getProductionAvailableBonusTypeIds, getProductionAvailableRanksForBonusType,
} from '../../domain/artian/productionBonusAvailability'
import type {
  BonusRankId, BonusTypeId, ElementId, GroupSkillId, RngState, SeriesSkillId,
  WeaponTypeId,
} from '../../domain/models/publicTypes'
import {
  CANONICAL_BASE_SEED_MAX, CANONICAL_BASE_SEED_MIN,
  type SkillIdentificationInput,
  type SkillIdentificationResult,
} from '../../domain/rng/identification'
import {
  REFERENCE_GROUP_SKILL_POOL, REFERENCE_SERIES_SKILL_POOL,
} from '../../domain/rng/production/referenceSkillPools'
import type {
  GogmaIdentificationWizardInput,
  IdentificationResultClassification,
  IdentificationWizardCoordinator,
  IdentificationWizardState,
  IdentificationWizardStateListener,
} from '../../services/rngIdentification/identificationWizardCoordinator'
import type { PlanBreakingChangeInspection } from '../../domain/execution'
import { IdentificationWizardDialog } from './IdentificationWizardDialog'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data

// The Dialog resolves its STEP 1 Weapon Type / Element through these Master
// selectors, so the fixtures resolve the same authoritative pair instead of
// hard-coding identifiers.
const enabledWeaponTypeId = getEnabledWeaponTypes(master)[0]?.id
const enabledElementId = getEnabledElements(master)[0]?.id
if (enabledWeaponTypeId === undefined || enabledElementId === undefined) {
  throw new Error('Test fixture requires an enabled Weapon Type and Element.')
}
const authoritativeWeaponTypeId: WeaponTypeId = enabledWeaponTypeId
const authoritativeElementId: ElementId = enabledElementId

const enabledSeriesSkillId = REFERENCE_SERIES_SKILL_POOL.find(
  (id) => master.seriesSkills.find((skill) => skill.id === id)?.isEnabled,
)
const enabledGroupSkillId = REFERENCE_GROUP_SKILL_POOL.find(
  (id) => master.groupSkills.find((skill) => skill.id === id)?.isEnabled,
)
if (enabledSeriesSkillId === undefined || enabledGroupSkillId === undefined) {
  throw new Error('Test fixture requires an enabled Series Skill and Group Skill.')
}
const fixtureSeriesSkillId: SeriesSkillId = enabledSeriesSkillId
const fixtureGroupSkillId: GroupSkillId = enabledGroupSkillId

interface FixtureBonusChoice {
  readonly bonusTypeId: BonusTypeId
  readonly bonusRankId: BonusRankId
}

/**
 * Reset observation fixtures must use pairs the Dialog itself offers for the
 * STEP 1 authoritative Weapon Type / Element under `gogma_artian` scope: the
 * Production bonus availability, in the same Master order the Selects render.
 */
function gogmaBonusChoices(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): readonly FixtureBonusChoice[] {
  const choices = getProductionAvailableBonusTypeIds(master, weaponTypeId, elementId, 'gogma_artian')
    .map((bonusTypeId) => {
      const rank = getProductionAvailableRanksForBonusType(
        master, weaponTypeId, elementId, bonusTypeId, 'gogma_artian',
      )[0]
      if (rank === undefined) {
        throw new Error(`Test fixture requires a Gogma rank for ${bonusTypeId}.`)
      }
      return { bonusTypeId, bonusRankId: rank.id }
    })
  if (choices.length < 2) {
    throw new Error('Test fixture requires at least two Gogma bonus types.')
  }
  return choices
}

function rngState(): RngState {
  const state = createInitialRngState('2026-09-01T00:00:00.000Z')
  state.skillCounter = { value: 42, isConfirmed: false, source: 'manual' }
  state.gogmaCounter = { value: 84, isConfirmed: false, source: 'manual' }
  return state
}

function initialWizardState(): IdentificationWizardState {
  return {
    skill: {
      status: 'idle', requestId: null, input: null, progress: null, result: null,
      classification: null, identified: null, error: null,
    },
    gogma: {
      status: 'idle', requestId: null, input: null, progress: null, result: null,
      classification: null, startingGogmaCounter: null, error: null,
    },
    review: null,
    gameRestoredConfirmed: false,
    adoption: { status: 'idle', savedRngState: null, error: null },
    disposed: false,
  }
}

class FakeCoordinator implements IdentificationWizardCoordinator {
  state = initialWizardState()
  listeners = new Set<IdentificationWizardStateListener>()
  skillInputs: SkillIdentificationInput[] = []
  gogmaInputs: GogmaIdentificationWizardInput[] = []
  cancelSkillCalls = 0
  cancelGogmaCalls = 0
  restartCalls = 0
  adoptCalls = 0
  disposeCalls = 0
  adoptionFailure: Error | null = null
  /** The breaking-change inspection of the adoption; no `active` Plan in these fixtures. */
  inspectAdoption = vi.fn(async (): Promise<PlanBreakingChangeInspection> => ({ approvalRequired: false }))
  private skillRequest = 0
  private gogmaRequest = 0

  getState() { return this.state }
  subscribe(listener: IdentificationWizardStateListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(next: IdentificationWizardState) {
    this.state = next
    for (const listener of [...this.listeners]) listener(next)
  }

  async identifySkill(input: SkillIdentificationInput): Promise<IdentificationResultClassification> {
    this.skillInputs.push(structuredClone(input))
    const request = ++this.skillRequest
    this.publish({
      ...this.state,
      skill: {
        status: 'searching', requestId: `skill-${request}`, input: structuredClone(input),
        progress: null, result: null, classification: null, identified: null, error: null,
      },
      gogma: initialWizardState().gogma,
      review: null,
      gameRestoredConfirmed: false,
      adoption: initialWizardState().adoption,
    })
    return new Promise((resolve, reject) => {
      Object.assign(this, { skillResolve: resolve, skillReject: reject, skillActiveRequest: request })
    })
  }
  private skillResolve?: (value: IdentificationResultClassification) => void
  private skillReject?: (reason: unknown) => void
  private skillActiveRequest?: number

  progressSkill(searchedSeeds = 25, totalSeeds = 100, matchesFound = 1) {
    this.publish({
      ...this.state,
      skill: { ...this.state.skill, progress: { searchedSeeds, totalSeeds, matchesFound } },
    })
  }
  completeSkill(classification: IdentificationResultClassification, request = this.skillActiveRequest) {
    if (request !== this.skillActiveRequest || this.state.skill.status !== 'searching') return
    const matches = classification === 'zero' ? []
      : classification === 'multiple'
        ? [{ baseSeed: 86315169, startSkillCounter: 42 }, { baseSeed: 86315170, startSkillCounter: 43 }]
        : [{ baseSeed: 86315169, startSkillCounter: 42 }]
    const result: SkillIdentificationResult = {
      matches,
      searchedSeedRange: { startInclusive: 0, endInclusive: 99_999_999 },
      isTruncated: classification === 'incomplete',
    }
    this.publish({
      ...this.state,
      skill: {
        ...this.state.skill, status: 'completed', requestId: null, result,
        classification,
        identified: classification === 'unique'
          ? { baseSeed: '86315169', startingSkillCounter: 42 }
          : null,
      },
    })
    this.skillResolve?.(classification)
  }
  failSkill(error = new Error('worker exploded')) {
    this.publish({
      ...this.state,
      skill: {
        ...this.state.skill, status: 'error', requestId: null, result: null,
        classification: null, identified: null,
        error: { kind: 'unexpected_error', error },
      },
    })
    this.skillReject?.(error)
  }
  failSkillWith(kind: 'invalid_input' | 'unsupported_input', error: Error) {
    this.publish({
      ...this.state,
      skill: {
        ...this.state.skill, status: 'error', requestId: null, result: null,
        classification: null, identified: null,
        error: { kind, error },
      },
    })
    this.skillReject?.(error)
  }
  cancelSkill() {
    this.cancelSkillCalls += 1
    this.skillActiveRequest = undefined
    const error = new Error('cancelled')
    this.publish({
      ...this.state,
      skill: {
        ...this.state.skill, status: 'cancelled', requestId: null, result: null,
        classification: null, identified: null, error: { kind: 'cancelled', error },
      },
      gogma: initialWizardState().gogma,
      review: null,
      gameRestoredConfirmed: false,
      adoption: initialWizardState().adoption,
    })
    this.skillReject?.(error)
  }

  async identifyGogma(input: GogmaIdentificationWizardInput): Promise<IdentificationResultClassification> {
    this.gogmaInputs.push(structuredClone(input))
    const request = ++this.gogmaRequest
    this.publish({
      ...this.state,
      gogma: {
        status: 'searching', requestId: `gogma-${request}`,
        input: { ...structuredClone(input), baseSeed: '86315169' },
        progress: null, result: null, classification: null,
        startingGogmaCounter: null, error: null,
      },
      review: null,
      gameRestoredConfirmed: false,
      adoption: initialWizardState().adoption,
    })
    return new Promise((resolve, reject) => {
      Object.assign(this, { gogmaResolve: resolve, gogmaReject: reject, gogmaActiveRequest: request })
    })
  }
  private gogmaResolve?: (value: IdentificationResultClassification) => void
  private gogmaReject?: (reason: unknown) => void
  private gogmaActiveRequest?: number

  progressGogma(searchedCounters = 5, totalCounters = 11, matchesFound = 1) {
    this.publish({
      ...this.state,
      gogma: { ...this.state.gogma, progress: { searchedCounters, totalCounters, matchesFound } },
    })
  }
  completeGogma(classification: IdentificationResultClassification, request = this.gogmaActiveRequest) {
    if (request !== this.gogmaActiveRequest || this.state.gogma.status !== 'searching') return
    const matches = classification === 'zero' ? []
      : classification === 'multiple'
        ? [{ startGogmaCounter: 84 }, { startGogmaCounter: 85 }]
        : [{ startGogmaCounter: 84 }]
    const result = {
      matches,
      searchedCounterRange: { startInclusive: 79, endInclusive: 89 },
      isTruncated: classification === 'incomplete',
    }
    const review = classification === 'unique'
      ? { baseSeed: '86315169', startingSkillCounter: 42, startingGogmaCounter: 84 }
      : null
    this.publish({
      ...this.state,
      gogma: {
        ...this.state.gogma, status: 'completed', requestId: null, result,
        classification,
        startingGogmaCounter: classification === 'unique' ? 84 : null,
      },
      review,
    })
    this.gogmaResolve?.(classification)
  }
  failGogma(error = new Error('gogma worker exploded')) {
    this.publish({
      ...this.state,
      gogma: {
        ...this.state.gogma, status: 'error', requestId: null, result: null,
        classification: null, startingGogmaCounter: null,
        error: { kind: 'unexpected_error', error },
      },
      review: null,
      gameRestoredConfirmed: false,
      adoption: initialWizardState().adoption,
    })
    this.gogmaReject?.(error)
  }
  cancelGogma() {
    this.cancelGogmaCalls += 1
    this.gogmaActiveRequest = undefined
    const error = new Error('cancelled')
    this.publish({
      ...this.state,
      gogma: {
        ...this.state.gogma, status: 'cancelled', requestId: null, result: null,
        classification: null, startingGogmaCounter: null,
        error: { kind: 'cancelled', error },
      },
      review: null,
      gameRestoredConfirmed: false,
      adoption: initialWizardState().adoption,
    })
    this.gogmaReject?.(error)
  }

  setGameRestoredConfirmed(value: boolean) {
    this.publish({ ...this.state, gameRestoredConfirmed: value && this.state.review !== null })
  }
  async adopt(): Promise<RngState> {
    this.adoptCalls += 1
    this.publish({ ...this.state, adoption: { status: 'adopting', savedRngState: null, error: null } })
    if (this.adoptionFailure) {
      const error = this.adoptionFailure
      this.adoptionFailure = null
      this.publish({
        ...this.state,
        adoption: { status: 'error', savedRngState: null, error: { kind: 'adoption_error', error } },
      })
      throw error
    }
    const saved = rngState()
    saved.baseSeed = { value: '86315169', isConfirmed: true, source: 'observation' }
    saved.skillCounter = { value: 42, isConfirmed: true, source: 'observation' }
    saved.gogmaCounter = { value: 84, isConfirmed: true, source: 'observation' }
    this.publish({ ...this.state, adoption: { status: 'adopted', savedRngState: saved, error: null } })
    return saved
  }
  /**
   * Test fixture: publish the state a completed unique STEP 1 search produces.
   * A STEP 2 or Review test that is not about the STEP 1 journey uses this
   * instead of replaying the STEP 1 form. The transition itself stays covered by
   * the STEP 1 journey tests, and `skillInputs` is recorded exactly as
   * `identifySkill` would record it so STEP 1 authority assertions still hold.
   */
  seedUniqueSkillResult(
    weaponTypeId: WeaponTypeId = authoritativeWeaponTypeId,
    elementId: ElementId = authoritativeElementId,
  ): SkillIdentificationInput {
    const input: SkillIdentificationInput = {
      weaponTypeId,
      elementId,
      observations: Array.from({ length: 4 }, () => ({
        seriesSkillId: fixtureSeriesSkillId,
        groupSkillId: fixtureGroupSkillId,
      })),
      seedRange: { startInclusive: 100, endInclusive: 200 },
      skillCounterRange: { startInclusive: 37, endInclusive: 47 },
    }
    this.skillInputs.push(structuredClone(input))
    this.publish({
      ...initialWizardState(),
      skill: {
        status: 'completed', requestId: null, input: structuredClone(input),
        progress: null,
        result: {
          matches: [{ baseSeed: 86315169, startSkillCounter: 42 }],
          searchedSeedRange: { startInclusive: 0, endInclusive: 99_999_999 },
          isTruncated: false,
        },
        classification: 'unique',
        identified: { baseSeed: '86315169', startingSkillCounter: 42 },
        error: null,
      },
    })
    return input
  }

  /**
   * Test fixture: publish the state a completed unique STEP 2 search produces on
   * top of a seeded unique STEP 1 result. Only tests that assert Review
   * rendering, adoption, or restart use it; a test that also exercises a STEP 1
   * or STEP 2 rerun keeps the real journey because the rerun depends on the
   * Dialog's own form drafts.
   */
  seedUniqueGogmaResult(): void {
    this.seedUniqueSkillResult()
    this.publish({
      ...this.state,
      gogma: {
        ...this.state.gogma, status: 'completed', requestId: null,
        result: {
          matches: [{ startGogmaCounter: 84 }],
          searchedCounterRange: { startInclusive: 79, endInclusive: 89 },
          isTruncated: false,
        },
        classification: 'unique', startingGogmaCounter: 84,
      },
      review: { baseSeed: '86315169', startingSkillCounter: 42, startingGogmaCounter: 84 },
    })
  }

  restart() {
    this.restartCalls += 1
    this.skillActiveRequest = undefined
    this.gogmaActiveRequest = undefined
    this.publish(initialWizardState())
  }
  dispose() {
    this.disposeCalls += 1
    this.skillActiveRequest = undefined
    this.gogmaActiveRequest = undefined
    this.listeners.clear()
    this.state = { ...this.state, disposed: true }
  }
}

function renderWizard(coordinator = new FakeCoordinator()) {
  const onAdopted = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <IdentificationWizardDialog
      coordinator={coordinator}
      initialRngState={rngState()}
      master={master}
      onAdopted={onAdopted}
      onClose={onClose}
    />,
  )
  return { coordinator, onAdopted, onClose, ...view }
}

/**
 * Set a MUI Select through the hidden native input MUI renders for autofill. It
 * runs the same controlled `onChange` a Menu option click runs, without mounting
 * and unmounting a Popover/Portal per slot. Fixture setup only: real Menu
 * interaction stays asserted by the STEP 1 ordered-observation test and the
 * STEP 2 STEP 1-authority test, which both drive the Menu with `user.click`.
 */
function setMuiSelectValue(control: HTMLElement, value: string) {
  const nativeInput = control.parentElement?.querySelector('input.MuiSelect-nativeInput')
  if (!(nativeInput instanceof HTMLInputElement)) {
    throw new Error('MUI Select native input was not found.')
  }
  fireEvent.change(nativeInput, { target: { value } })
}

function fillSkillObservations(count = 4) {
  for (let index = 1; index <= count; index += 1) {
    const series = screen.getByLabelText(`観測${index} シリーズスキル`)
    if (series.textContent?.includes('未入力')) setMuiSelectValue(series, fixtureSeriesSkillId)
    const group = screen.getByLabelText(`観測${index} グループスキル`)
    if (group.textContent?.includes('未入力')) setMuiSelectValue(group, fixtureGroupSkillId)
  }
}

/**
 * Narrows the STEP 1 Seed range to a bounded custom range. The fields start at
 * the canonical full domain, so the fixture always overwrites them: the
 * default-range journey is asserted separately without calling this.
 */
function fillSeedRange(start = '100', end = '200') {
  fireEvent.change(screen.getByLabelText('Base Seed 検索範囲の開始'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('Base Seed 検索範囲の終了'), { target: { value: end } })
}

const CANONICAL_SEED_START = String(CANONICAL_BASE_SEED_MIN)
const CANONICAL_SEED_END = String(CANONICAL_BASE_SEED_MAX)

function seedRangeFields(): { start: HTMLInputElement; end: HTMLInputElement } {
  return {
    start: screen.getByLabelText('Base Seed 検索範囲の開始') as HTMLInputElement,
    end: screen.getByLabelText('Base Seed 検索範囲の終了') as HTMLInputElement,
  }
}

function fillStep1() {
  fillSeedRange()
  fillSkillObservations()
}

async function startSkillSearch(user: ReturnType<typeof userEvent.setup>) {
  fillStep1()
  await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))
}

function resetObservationEditor(observationIndex: number): HTMLElement {
  return screen.getByText(`復元ボーナス観測${observationIndex}`)
    .closest('[data-reset-observation]') as HTMLElement
}

function skillObservationCard(observationIndex: number): HTMLElement {
  return screen.getByText(`観測${observationIndex}`)
    .closest('[data-skill-observation]') as HTMLElement
}

function stepPositions(): string[] {
  const nav = screen.getByRole('navigation', { name: '特定の進行状況' })
  return within(nav).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

function step1BonusChoices(coordinator: FakeCoordinator): readonly FixtureBonusChoice[] {
  const input = coordinator.getState().skill.input
  if (input === null) throw new Error('STEP 1 input is unavailable.')
  return gogmaBonusChoices(input.weaponTypeId, input.elementId)
}

function setBonusSlot(editor: HTMLElement, slotIndex: number, choice: FixtureBonusChoice) {
  setMuiSelectValue(
    within(editor).getByLabelText(`枠${slotIndex} ボーナス種別`),
    choice.bonusTypeId,
  )
  // The rank Select stays disabled until the type is set, so it is queried again
  // after the type change re-renders the slot.
  setMuiSelectValue(
    within(editor).getByLabelText(`枠${slotIndex} ランク`),
    choice.bonusRankId,
  )
}

function fillGogmaObservations(
  coordinator: FakeCoordinator,
  observationCount = 4,
  slotCount = 5,
) {
  const choice = step1BonusChoices(coordinator)[0]!
  for (let observationIndex = 1; observationIndex <= observationCount; observationIndex += 1) {
    const editor = resetObservationEditor(observationIndex)
    for (let slotIndex = 1; slotIndex <= slotCount; slotIndex += 1) {
      setBonusSlot(editor, slotIndex, choice)
    }
  }
}

async function reachStep2(coordinator: FakeCoordinator, user: ReturnType<typeof userEvent.setup>) {
  await startSkillSearch(user)
  act(() => coordinator.completeSkill('unique'))
  await screen.findByText('STEP 2 — 開始巨戟カウンターの特定')
}

async function reachReview(coordinator: FakeCoordinator, user: ReturnType<typeof userEvent.setup>) {
  await reachStep2(coordinator, user)
  fillGogmaObservations(coordinator)
  await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))
  act(() => coordinator.completeGogma('unique'))
  await screen.findByText('確認・採用', { selector: 'h3' })
}

async function seedStep2(
  coordinator: FakeCoordinator,
  weaponTypeId: WeaponTypeId = authoritativeWeaponTypeId,
  elementId: ElementId = authoritativeElementId,
) {
  act(() => { coordinator.seedUniqueSkillResult(weaponTypeId, elementId) })
  await screen.findByText('STEP 2 — 開始巨戟カウンターの特定')
}

async function seedReview(coordinator: FakeCoordinator) {
  act(() => { coordinator.seedUniqueGogmaResult() })
  await screen.findByText('確認・採用', { selector: 'h3' })
}

describe('IdentificationWizardDialog STEP 1', () => {
  it('starts with the canonical full Base Seed range and unentered Skill observation drafts', () => {
    renderWizard()

    // The Domain constants are the only range authority (0 .. 99,999,999).
    expect(CANONICAL_SEED_START).toBe('0')
    expect(CANONICAL_SEED_END).toBe('99999999')
    const { start, end } = seedRangeFields()
    expect(start).toHaveValue(CANONICAL_SEED_START)
    expect(end).toHaveValue(CANONICAL_SEED_END)
    expect(screen.getByText(/初期値はBase Seed全域（0 ～ 99,999,999）です/)).toBeInTheDocument()
    expect(screen.queryByText(/Production defaultは設定しません/)).not.toBeInTheDocument()
    for (let index = 1; index <= 4; index += 1) {
      expect(screen.getByLabelText(`観測${index} シリーズスキル`))
        .toHaveTextContent('未入力')
      expect(screen.getByLabelText(`観測${index} グループスキル`))
        .toHaveTextContent('未入力')
    }
  })

  it('renders the Seed range as eight-digit numeric text fields, not number spinners', () => {
    renderWizard()
    for (const field of Object.values(seedRangeFields())) {
      expect(field).toHaveAttribute('type', 'text')
      expect(field).toHaveAttribute('inputmode', 'numeric')
      expect(field).toHaveAttribute('maxlength', '8')
      expect(field).toHaveAttribute('pattern', '[0-9]*')
      expect(field).not.toHaveAttribute('min')
      expect(field).not.toHaveAttribute('max')
      expect(field).not.toHaveAttribute('step')
    }
  })

  it.each([
    '12e3', '-1', '+1', '1.5', 'abcdef', '1 2', ' 12', '１２', '100000000', '0x5f5e101',
  ])('refuses the non-canonical Seed range draft %j at the onChange boundary', (invalid) => {
    renderWizard()
    const { start, end } = seedRangeFields()
    // fireEvent bypasses the `maxLength` attribute, so a nine-digit value here
    // proves the onChange guard itself, not only the HTML attribute.
    fireEvent.change(start, { target: { value: invalid } })
    fireEvent.change(end, { target: { value: invalid } })

    expect(start).toHaveValue(CANONICAL_SEED_START)
    expect(end).toHaveValue(CANONICAL_SEED_END)
  })

  it('accepts digits up to eight and keeps a temporarily blank draft while editing', async () => {
    const user = userEvent.setup()
    renderWizard()
    const { start, end } = seedRangeFields()
    await user.clear(start)
    expect(start).toHaveValue('')
    await user.type(start, '123456789')
    expect(start).toHaveValue('12345678')
    await user.clear(end)
    await user.type(end, '00000042')
    expect(end).toHaveValue('00000042')
  })

  it('does not call identifySkill while the Seed range is blank', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSkillObservations()
    fillSeedRange('', '')

    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))

    expect(await screen.findByText(/Base Seedの検索範囲の開始を入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)

    fillSeedRange('100', '')
    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))
    expect(await screen.findByText(/Base Seedの検索範囲の終了を入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)
  })

  it('does not call identifySkill when the Seed range start exceeds its end', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSkillObservations()
    fillSeedRange('200', '100')

    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))

    expect(await screen.findByText(/Base Seedの検索範囲は0から99999999までの範囲で、開始が終了以下になるように入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)
  })

  it('sends the canonical full Seed range when the initial value is left unchanged', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSkillObservations()

    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))

    await waitFor(() => expect(coordinator.skillInputs).toHaveLength(1))
    expect(coordinator.skillInputs[0]?.seedRange).toEqual({
      startInclusive: CANONICAL_BASE_SEED_MIN,
      endInclusive: CANONICAL_BASE_SEED_MAX,
    })
    expect(coordinator.skillInputs[0]?.seedRange).toEqual({ startInclusive: 0, endInclusive: 99_999_999 })
  })

  it('does not call identifySkill while any Skill observation row is incomplete', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSeedRange()
    fillSkillObservations(3)

    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))

    expect(await screen.findByText(/観測4のシリーズスキルとグループスキルを入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)
  })

  // This journey drives two real MUI Menus and types every range field, like the
  // STEP 2 and Review journeys that already run under 15 seconds. Alone it takes
  // about 3.5 seconds, but under the parallel full suite it reaches the default
  // 5 second limit, so it gets the same limit. The assertions are unchanged.
  it('passes ordered observations, semantic weapon/element, and explicit ranges to the Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await user.clear(screen.getByLabelText('Base Seed 検索範囲の開始'))
    await user.type(screen.getByLabelText('Base Seed 検索範囲の開始'), '100')
    await user.clear(screen.getByLabelText('Base Seed 検索範囲の終了'))
    await user.type(screen.getByLabelText('Base Seed 検索範囲の終了'), '200')
    await user.clear(screen.getByLabelText('概算スキルカウンター'))
    await user.type(screen.getByLabelText('概算スキルカウンター'), '50')
    await user.clear(screen.getByLabelText('スキルカウンターの±幅'))
    await user.type(screen.getByLabelText('スキルカウンターの±幅'), '3')
    await user.click(screen.getByLabelText('観測2 シリーズスキル'))
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[2]!)
    await user.click(screen.getByLabelText('観測2 グループスキル'))
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[2]!)

    await startSkillSearch(user)

    const input = coordinator.skillInputs[0]
    expect(input).toMatchObject({
      weaponTypeId: master.weaponTypes.find(({ isEnabled }) => isEnabled)?.id,
      elementId: master.elements.find(({ isEnabled }) => isEnabled)?.id,
      seedRange: { startInclusive: 100, endInclusive: 200 },
      skillCounterRange: { startInclusive: 47, endInclusive: 53 },
    })
    expect(input?.observations).toHaveLength(4)
    expect(input?.observations[0]).not.toEqual(input?.observations[1])
    expect(input?.observations[2]).toEqual(input?.observations[0])
    expect(input?.observations[3]).toEqual(input?.observations[0])
  }, 15_000)

  it('shows global progress and cancels through the Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.progressSkill(25, 100, 2))

    expect(screen.getByLabelText('検索進捗')).toHaveTextContent('25 / 100')
    const cancel = screen.getByRole('button', { name: 'STEP 1の検索をキャンセル' })
    expect(cancel).toBeEnabled()
    await user.click(cancel)

    expect(coordinator.cancelSkillCalls).toBe(1)
    expect(await screen.findByText(/検索をキャンセルしました/)).toBeInTheDocument()
    expect(screen.queryByText('STEP 2 — 開始巨戟カウンターの特定')).not.toBeInTheDocument()
  })

  it.each([
    ['zero', /一致する結果がありません/],
    ['multiple', /候補が複数あります/],
    ['incomplete', /探索が完全ではない/],
  ] as const)('%s does not advance to STEP 2', async (classification, message) => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.completeSkill(classification))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('STEP 2 — 開始巨戟カウンターの特定')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /candidate/i })).not.toBeInTheDocument()
  })

  it('keeps ordered inputs editable and allows adding an observation after multiple', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.completeSkill('multiple'))
    await user.click(screen.getByRole('button', { name: 'スキル観測を追加' }))
    expect(screen.getByLabelText('観測5 シリーズスキル')).toHaveTextContent('未入力')
    expect(screen.getByLabelText('観測5 グループスキル')).toHaveTextContent('未入力')
  })

  it('restart returns a narrowed Seed range to the canonical full domain and clears observations', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillStep1()
    expect(screen.getByLabelText('Base Seed 検索範囲の開始')).toHaveValue('100')
    expect(screen.getByLabelText('Base Seed 検索範囲の終了')).toHaveValue('200')

    await user.click(screen.getByRole('button', { name: '最初からやり直す' }))

    expect(coordinator.restartCalls).toBe(1)
    expect(screen.getByLabelText('Base Seed 検索範囲の開始')).toHaveValue(CANONICAL_SEED_START)
    expect(screen.getByLabelText('Base Seed 検索範囲の終了')).toHaveValue(CANONICAL_SEED_END)
    expect(screen.getByLabelText('観測1 シリーズスキル')).toHaveTextContent('未入力')
    expect(screen.getByLabelText('観測1 グループスキル')).toHaveTextContent('未入力')
  })

  it('shows a Worker failure as an error instead of no-match', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.failSkill())

    expect(await screen.findByText(/検索処理エラー: worker exploded/)).toBeInTheDocument()
    expect(screen.queryByText(/一致する結果がありません/)).not.toBeInTheDocument()
  })

  it('advances only for a Coordinator unique classification', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await reachStep2(coordinator, user)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('STEP 2')
  })

  it('keeps every safety item and the verification scope visible', () => {
    renderWizard()
    const dialog = within(screen.getByRole('dialog', { name: 'RNG状態の特定' }))
    for (const item of [
      '観測結果の記録が終わるまでゲーム状態を保存しないでください。',
      '開始前にバックアップ方法と自動保存の設定・挙動を確認してください。',
      '案内された操作だけを順番に連続して行ってください。',
      '観測後は調査前の状態へ戻してから採用します。',
      'ゲーム側の保存仕様や安全をこのアプリが保証するものではありません。',
    ]) {
      expect(dialog.getByText(item)).toBeInTheDocument()
    }
    expect(dialog.getByText('検証範囲')).toBeInTheDocument()
    // The verification level is stated generically from the repository's
    // game-verified evidence; fixture enumeration belongs to
    // `docs/RNG_REFERENCE_AUDIT.md`, and no blanket coverage claim is made.
    expect(dialog.getByText(/RNG状態の特定は実機で動作を確認済みです。ただし確認条件は限定されており、全武器種・全属性・全ゲームバージョンを保証するものではありません。/)).toBeInTheDocument()
    expect(dialog.getByText(/採用後の予測結果はゲーム側でも確認してください。/)).toBeInTheDocument()
    expect(dialog.queryByText(/操虫棍/)).not.toBeInTheDocument()
    expect(dialog.queryByText(/ヘヴィボウガン/)).not.toBeInTheDocument()
    expect(dialog.queryByText(/全武器種・全属性・全ゲームバージョン(で|を)?確認済み/)).not.toBeInTheDocument()
  })

  it('numbers each Skill observation, shows its completion, and deletes by number down to one', async () => {
    const user = userEvent.setup()
    renderWizard()

    expect(within(skillObservationCard(1)).getByText('1回目のスキル抽選結果')).toBeInTheDocument()
    expect(within(skillObservationCard(2)).getByText('2回目のスキル抽選結果')).toBeInTheDocument()
    expect(within(skillObservationCard(1)).getByText('未入力あり')).toBeInTheDocument()
    fillSkillObservations(1)
    expect(within(skillObservationCard(1)).getByText('入力済み')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '観測2を削除' }))
    expect(screen.queryByLabelText('観測4 シリーズスキル')).not.toBeInTheDocument()
    expect(screen.getByLabelText('観測3 シリーズスキル')).toBeInTheDocument()
    // Observation 1 keeps its entered values after a later row is removed.
    expect(within(skillObservationCard(1)).getByText('入力済み')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '観測3を削除' }))
    await user.click(screen.getByRole('button', { name: '観測2を削除' }))
    expect(screen.getByRole('button', { name: '観測1を削除' })).toBeDisabled()
  })

  it('labels every Skill observation by its draw order, never by a fixed operation', () => {
    renderWizard()
    for (const index of [1, 2, 3, 4]) {
      const card = skillObservationCard(index)
      expect(within(card).getByText(`${index}回目のスキル抽選結果`)).toBeInTheDocument()
      // Observation 1 is not fixed to a conversion, and later ones are not
      // fixed to Reset Skills (`docs/UI_FLOW.md` 5.4).
      expect(card.textContent).not.toMatch(/conversion|巨戟化|Reset|リセット|再抽選/)
    }
  })

  it('explains both ways of starting the consecutive Skill observations', () => {
    renderWizard()
    const step1 = within(screen.getByRole('region', { name: 'STEP 1 — Base Seedと開始スキルカウンターの特定' }))
    expect(step1.getByText('同じ武器種・属性で、スキルの抽選結果を連続して記録します。')).toBeInTheDocument()
    expect(step1.getByText(/通常アーティアから始める場合は、巨戟化したときに自動で付いたスキルを観測1として記録し/)).toBeInTheDocument()
    expect(step1.getByText('すでに巨戟アーティアを持っている場合は、スキル再抽選の結果から観測1を始められます。')).toBeInTheDocument()
    expect(step1.getByText('途中でスキルが抽選される別の操作を挟まず、実際に出た順番どおりに記録してください。')).toBeInTheDocument()
  })

  it('asks for no start method, so the observation inputs are the only STEP 1 observation input', () => {
    renderWizard()
    const dialog = within(screen.getByRole('dialog', { name: 'RNG状態の特定' }))
    expect(dialog.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(dialog.queryByRole('radio')).not.toBeInTheDocument()
    expect(dialog.queryByText(/開始方法/)).not.toBeInTheDocument()
    // STEP 1 offers only the weapon / element and the per-observation Skill Selects.
    const step1 = within(screen.getByRole('region', { name: 'STEP 1 — Base Seedと開始スキルカウンターの特定' }))
    expect(step1.getAllByRole('combobox')).toHaveLength(2 + 4 * 2)
  })

  it('sends the unchanged Skill observation shape with no operation field', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)

    const input = coordinator.skillInputs[0]
    expect(Object.keys(input ?? {}).sort()).toEqual(
      ['elementId', 'observations', 'seedRange', 'skillCounterRange', 'weaponTypeId'],
    )
    expect(input?.observations).toHaveLength(4)
    for (const observation of input?.observations ?? []) {
      expect(Object.keys(observation).sort()).toEqual(['groupSkillId', 'seriesSkillId'])
    }
  })

  it('shows no English-only ordinary labels in any STEP', async () => {
    const coordinator = new FakeCoordinator()
    renderWizard(coordinator)
    await seedReview(coordinator)
    const text = screen.getByRole('dialog', { name: 'RNG状態の特定' }).textContent ?? ''
    for (const english of [
      'Weapon Type', 'Element', 'Observation', 'Series Skill', 'Group Skill', 'Search',
      'Cancel', 'Restart', 'Close', 'Review', 'Adopt', 'Starting', 'range', 'inclusive',
      'Reset Bonuses', 'Keep Bonuses', 'Skill Reset', 'conversion', 'Production Identification',
      'Identification', 'Wizard', 'Skill Counter', 'Gogma Counter', '同定',
    ]) {
      expect(text).not.toContain(english)
    }
    // Base Seed stays the app's formal term (RNG Setup: 「Base Seed（基準シード）」).
    expect(text).toContain('Base Seed')
  })

  it('previews the approximate Skill Counter as an inclusive range from center ± 5', () => {
    renderWizard()
    expect(screen.getByText('検索範囲: 37 ～ 47（両端を含む・11候補）')).toBeInTheDocument()
  })

  it('names the search state in words while searching and after cancel', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    const step1 = screen.getByRole('region', { name: 'STEP 1 — Base Seedと開始スキルカウンターの特定' })
    expect(within(step1).getByRole('status')).toHaveTextContent('未検索')
    await startSkillSearch(user)
    expect(within(step1).getByRole('status')).toHaveTextContent('検索中')
    await user.click(screen.getByRole('button', { name: 'STEP 1の検索をキャンセル' }))
    expect(within(step1).getByRole('status')).toHaveTextContent('キャンセル済み')
    expect(coordinator.cancelSkillCalls).toBe(1)
  })

  it.each([
    ['invalid_input', '入力エラー: bad observation'],
    ['unsupported_input', '未対応の入力: bad observation'],
  ] as const)('shows %s as its own error, not as no-match', async (kind, message) => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.failSkillWith(kind, new Error('bad observation')))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/一致する結果がありません/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'STEP 1 — Base Seedと開始スキルカウンターの特定' })).getByRole('status')).toHaveTextContent('エラー')
  })
})

describe('IdentificationWizardDialog STEP 2', { timeout: 15_000 }, () => {
  it('starts with four unentered five-slot Reset observation drafts', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)

    for (let observationIndex = 1; observationIndex <= 4; observationIndex += 1) {
      const editor = resetObservationEditor(observationIndex)
      for (let slotIndex = 1; slotIndex <= 5; slotIndex += 1) {
        expect(within(editor).getByLabelText(`枠${slotIndex} ボーナス種別`))
          .toHaveTextContent('未入力')
        expect(within(editor).getByLabelText(`枠${slotIndex} ランク`))
          .toHaveTextContent('未入力')
      }
    }

    await user.click(screen.getByRole('button', { name: '復元ボーナス観測を追加' }))
    const addedEditor = resetObservationEditor(5)
    expect(within(addedEditor).getByLabelText('枠1 ボーナス種別'))
      .toHaveTextContent('未入力')
    expect(within(addedEditor).getByLabelText('枠1 ランク'))
      .toHaveTextContent('未入力')
  })

  it('does not call identifyGogma while any five-slot Reset observation is incomplete', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    fillGogmaObservations(coordinator, 3)
    // Reset Observation 4 keeps slot 5 unentered.
    const choice = step1BonusChoices(coordinator)[0]!
    const fourthEditor = resetObservationEditor(4)
    for (let slotIndex = 1; slotIndex <= 4; slotIndex += 1) {
      setBonusSlot(fourthEditor, slotIndex, choice)
    }

    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))

    expect(await screen.findByText(/復元ボーナス観測4の枠5を完成させてください/)).toBeInTheDocument()
    expect(coordinator.gogmaInputs).toHaveLength(0)
  })

  it('uses STEP 1 authority, sends ordered five-slot Reset observations, and has no Seed/Keep input', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)

    expect(screen.queryByLabelText(/^Base Seed$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Keep Observation/)).not.toBeInTheDocument()
    fillGogmaObservations(coordinator)
    const secondResetPanel = resetObservationEditor(2)
    await user.click(within(secondResetPanel).getAllByRole('combobox')[0]!)
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[2]!)
    await user.click(within(secondResetPanel).getAllByRole('combobox')[1]!)
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[1]!)
    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))

    const input = coordinator.gogmaInputs[0]
    expect(input).not.toHaveProperty('baseSeed')
    expect(input).toMatchObject({
      weaponTypeId: coordinator.skillInputs[0]?.weaponTypeId,
      elementId: coordinator.skillInputs[0]?.elementId,
      gogmaCounterRange: { startInclusive: 79, endInclusive: 89 },
    })
    expect(input?.observations).toHaveLength(4)
    expect(input?.observations.every((observation) => observation.length === 5)).toBe(true)
    expect(input?.observations[1]?.[0].bonusTypeId).not.toBe(
      input?.observations[0]?.[0].bonusTypeId,
    )
  })

  it('offers Element II / EX for a Switch Axe element.none Reset observation and completes with it', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator, 'weapon.switch_axe', 'element.none')
    const firstEditor = resetObservationEditor(1)

    await user.click(within(firstEditor).getByLabelText('枠1 ボーナス種別'))
    const types = within(await screen.findByRole('listbox'))
    expect(types.getAllByRole('option').map((option) => option.textContent))
      .toEqual(['未入力', '基礎攻撃力強化', '会心率強化', '属性強化', '斬れ味・装填強化'])
    await user.click(types.getByRole('option', { name: '属性強化' }))
    await user.click(within(firstEditor).getByLabelText('枠1 ランク'))
    const ranks = within(await screen.findByRole('listbox'))
    expect(ranks.getAllByRole('option').map((option) => option.textContent)).toEqual(['未入力', 'II', 'EX'])
    await user.click(ranks.getByRole('option', { name: 'EX' }))

    const choice = step1BonusChoices(coordinator)[0]!
    for (let slotIndex = 2; slotIndex <= 5; slotIndex += 1) setBonusSlot(firstEditor, slotIndex, choice)
    for (let observationIndex = 2; observationIndex <= 4; observationIndex += 1) {
      const editor = resetObservationEditor(observationIndex)
      for (let slotIndex = 1; slotIndex <= 5; slotIndex += 1) setBonusSlot(editor, slotIndex, choice)
    }
    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))

    expect(screen.queryByText(/を完成させてください/)).not.toBeInTheDocument()
    expect(coordinator.gogmaInputs).toHaveLength(1)
    expect(coordinator.gogmaInputs[0]).toMatchObject({ weaponTypeId: 'weapon.switch_axe', elementId: 'element.none' })
    expect(coordinator.gogmaInputs[0]?.observations[0]?.[0]).toEqual({ bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ex' })
  })

  it.each(['element.poison', 'element.paralysis', 'element.sleep'])(
    'never offers Element for a Bow %s Reset observation',
    async (elementId) => {
      const user = userEvent.setup()
      const { coordinator } = renderWizard()
      await seedStep2(coordinator, 'weapon.bow', elementId)
      await user.click(within(resetObservationEditor(1)).getByLabelText('枠1 ボーナス種別'))
      const types = within(await screen.findByRole('listbox'))
      expect(types.getAllByRole('option').map((option) => option.textContent))
        .toEqual(['未入力', '基礎攻撃力強化', '会心率強化'])
    },
  )

  it('summarizes the STEP 1 authority and counts filled slots per Reset observation', async () => {
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    const step2 = within(screen.getByRole('region', { name: 'STEP 2 — 開始巨戟カウンターの特定' }))
    const input = coordinator.getState().skill.input!
    expect(step2.getByText(master.weaponTypes.find(({ id }) => id === input.weaponTypeId)!.displayNameJa)).toBeInTheDocument()
    expect(step2.getByText(master.elements.find(({ id }) => id === input.elementId)!.displayNameJa)).toBeInTheDocument()
    expect(step2.getByText('完了（一意に特定）')).toBeInTheDocument()
    expect(step2.queryByRole('textbox', { name: /Base Seed/ })).not.toBeInTheDocument()
    expect(step2.getByText('検索範囲: 79 ～ 89（両端を含む・11候補）')).toBeInTheDocument()

    expect(within(resetObservationEditor(1)).getByText('入力 0/5枠')).toBeInTheDocument()
    fillGogmaObservations(coordinator, 1)
    expect(within(resetObservationEditor(1)).getByText('入力 5/5枠')).toBeInTheDocument()
    expect(within(resetObservationEditor(1)).getByRole('list', { name: '復元ボーナス観測1の5枠' })).toBeInTheDocument()
    expect(within(resetObservationEditor(2)).getByRole('button', { name: '復元ボーナス観測2を削除' })).toBeEnabled()
  })

  it.each([
    ['zero', /一致する結果がありません/],
    ['multiple', /候補が複数あります/],
    ['incomplete', /探索が完全ではない/],
  ] as const)('%s does not advance to Review', async (classification, message) => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    fillGogmaObservations(coordinator)
    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))
    act(() => coordinator.completeGogma(classification))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('確認・採用', { selector: 'h3' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /candidate/i })).not.toBeInTheDocument()
  })

  it('shows global progress, cancellation, and Worker failure distinctly', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    fillGogmaObservations(coordinator)
    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))
    act(() => coordinator.progressGogma())
    expect(screen.getByLabelText('検索進捗')).toHaveTextContent('5 / 11')
    await user.click(screen.getByRole('button', { name: 'STEP 2の検索をキャンセル' }))
    expect(coordinator.cancelGogmaCalls).toBe(1)
    expect(await screen.findByText(/検索をキャンセルしました/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))
    act(() => coordinator.failGogma())
    expect(await screen.findByText(/検索処理エラー: gogma worker exploded/)).toBeInTheDocument()
    expect(screen.queryByText(/一致する結果がありません/)).not.toBeInTheDocument()
  })
})

describe('IdentificationWizardDialog Review and lifecycle', { timeout: 15_000 }, () => {
  it('shows exact starting values, requires restoration confirmation, and adopts only through Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator, onAdopted } = renderWizard()
    await seedReview(coordinator)

    expect(screen.getByText('Base Seed: 86315169')).toBeInTheDocument()
    expect(screen.getByText('開始スキルカウンター: 42')).toBeInTheDocument()
    expect(screen.getByText('開始巨戟カウンター: 84')).toBeInTheDocument()
    expect(screen.queryByText(/Current Skill Counter/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current Gogma Counter/)).not.toBeInTheDocument()
    expect(screen.queryByText('開始スキルカウンター: 46')).not.toBeInTheDocument()

    const adopt = screen.getByRole('button', { name: '開始値を採用' })
    expect(adopt).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
    expect(adopt).toBeEnabled()
    await user.click(adopt)

    await waitFor(() => expect(coordinator.adoptCalls).toBe(1))
    expect(onAdopted).toHaveBeenCalledWith(expect.objectContaining({
      baseSeed: { value: '86315169', isConfirmed: true, source: 'observation' },
      skillCounter: { value: 42, isConfirmed: true, source: 'observation' },
      gogmaCounter: { value: 84, isConfirmed: true, source: 'observation' },
    }), { planAbandoned: false })
  })

  it('retains Review and confirmation after adoption failure and allows retry', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedReview(coordinator)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
    coordinator.adoptionFailure = new Error('put failed')

    await user.click(screen.getByRole('button', { name: '開始値を採用' }))
    expect(await screen.findByText(/採用に失敗しました: put failed/)).toBeInTheDocument()
    expect(screen.getByText('確認・採用', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' })).toBeChecked()
    expect(screen.getByRole('button', { name: '開始値を採用' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '開始値を採用' }))
    await waitFor(() => expect(coordinator.adoptCalls).toBe(2))
  })

  it('STEP 1 rerun removes STEP 2 result, Review, and confirmation', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await reachReview(coordinator, user)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))

    await user.click(screen.getByRole('button', { name: 'STEP 1を検索' }))

    expect(screen.queryByText('STEP 2 — 開始巨戟カウンターの特定')).not.toBeInTheDocument()
    expect(screen.queryByText('確認・採用', { selector: 'h3' })).not.toBeInTheDocument()
    expect(coordinator.getState().gameRestoredConfirmed).toBe(false)
  })

  it('STEP 2 rerun retains STEP 1 unique and removes Review and confirmation', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await reachReview(coordinator, user)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))

    await user.click(screen.getByRole('button', { name: 'STEP 2を検索' }))

    expect(screen.getByText('STEP 2 — 開始巨戟カウンターの特定')).toBeInTheDocument()
    expect(screen.queryByText('確認・採用', { selector: 'h3' })).not.toBeInTheDocument()
    expect(coordinator.getState().skill.classification).toBe('unique')
    expect(coordinator.getState().gameRestoredConfirmed).toBe(false)
  })

  it('restart returns to the initial Coordinator state', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedReview(coordinator)
    await user.click(screen.getByRole('button', { name: '最初からやり直す' }))

    expect(coordinator.restartCalls).toBe(1)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('STEP 1')
    expect(screen.queryByText('STEP 2 — 開始巨戟カウンターの特定')).not.toBeInTheDocument()
    expect(screen.queryByText('確認・採用', { selector: 'h3' })).not.toBeInTheDocument()
  })

  it('ignores a late completion after cancel and does not advance', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    const oldRequest = 1
    await user.click(screen.getByRole('button', { name: 'STEP 1の検索をキャンセル' }))
    act(() => coordinator.completeSkill('unique', oldRequest))

    expect(screen.queryByText('STEP 2 — 開始巨戟カウンターの特定')).not.toBeInTheDocument()
    expect(coordinator.getState().skill.status).toBe('cancelled')
  })

  it('moves the step indicator only with Coordinator state and marks adoption in words', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    expect(stepPositions()).toEqual(['STEP 1現在', 'STEP 2未到達', '確認・採用未到達'])
    await seedStep2(coordinator)
    expect(stepPositions()).toEqual(['STEP 1完了', 'STEP 2現在', '確認・採用未到達'])
    await seedReview(coordinator)
    expect(stepPositions()).toEqual(['STEP 1完了', 'STEP 2完了', '確認・採用現在'])
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('確認・採用')

    expect(screen.getByText('「調査前のゲーム状態へ戻した」を確認すると採用できます。')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
    await user.click(screen.getByRole('button', { name: '開始値を採用' }))

    expect(await screen.findByText('特定結果をRNG状態へ採用しました。')).toBeInTheDocument()
    expect(stepPositions()).toEqual(['STEP 1完了', 'STEP 2完了', '確認・採用採用済み'])
    expect(screen.getByRole('button', { name: '開始値を採用' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' })).toBeDisabled()
  })

  it('Close only asks the owner to close and never disposes the Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator, onClose } = renderWizard()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(coordinator.disposeCalls).toBe(0)
    expect(coordinator.restartCalls).toBe(0)
  })

  it('unsubscribes on unmount and leaves Coordinator disposal to its owner', () => {
    const { coordinator, unmount } = renderWizard()
    expect(coordinator.listeners.size).toBe(1)
    unmount()
    expect(coordinator.listeners.size).toBe(0)
    // The Dialog owns only the subscription. Disposing here would destroy a still
    // live Coordinator during a development StrictMode effect replay.
    expect(coordinator.disposeCalls).toBe(0)
  })
})
