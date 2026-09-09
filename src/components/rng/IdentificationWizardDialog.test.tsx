import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createInitialRngState } from '../../domain/models/factories'
import { loadMasterData } from '../../domain/master/loadMasterData'
import {
  getBonusDefinitionsForWeapon, getEnabledElements, getEnabledWeaponTypes,
  getRanksForBonusType,
} from '../../domain/master/masterSelectors'
import type {
  BonusRankId, BonusTypeId, ElementId, GroupSkillId, RngState, SeriesSkillId,
  WeaponTypeId,
} from '../../domain/models/publicTypes'
import type {
  SkillIdentificationInput,
  SkillIdentificationResult,
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
 * STEP 1 authoritative Weapon Type / Element under `gogma_artian` scope, in the
 * same Master order the Selects render.
 */
function gogmaBonusChoices(
  weaponTypeId: WeaponTypeId,
  elementId: ElementId,
): readonly FixtureBonusChoice[] {
  const definitions = getBonusDefinitionsForWeapon(
    master, weaponTypeId, elementId, 'gogma_artian',
  )
  const choices = [...new Set(definitions.map(({ bonusTypeId }) => bonusTypeId))]
    .map((bonusTypeId) => {
      const rank = getRanksForBonusType(
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
  seedUniqueSkillResult(): SkillIdentificationInput {
    const input: SkillIdentificationInput = {
      weaponTypeId: authoritativeWeaponTypeId,
      elementId: authoritativeElementId,
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
    const series = screen.getByLabelText(`Observation ${index} Series Skill`)
    if (series.textContent?.includes('未入力')) setMuiSelectValue(series, fixtureSeriesSkillId)
    const group = screen.getByLabelText(`Observation ${index} Group Skill`)
    if (group.textContent?.includes('未入力')) setMuiSelectValue(group, fixtureGroupSkillId)
  }
}

function fillSeedRange(start = '100', end = '200') {
  const seedStart = screen.getByLabelText('Base Seed range start') as HTMLInputElement
  const seedEnd = screen.getByLabelText('Base Seed range end') as HTMLInputElement
  if (seedStart.value === '') fireEvent.change(seedStart, { target: { value: start } })
  if (seedEnd.value === '') fireEvent.change(seedEnd, { target: { value: end } })
}

function fillStep1() {
  fillSeedRange()
  fillSkillObservations()
}

async function startSkillSearch(user: ReturnType<typeof userEvent.setup>) {
  fillStep1()
  await user.click(screen.getByRole('button', { name: 'STEP 1 Search' }))
}

function resetObservationEditor(observationIndex: number): HTMLElement {
  return screen.getByText(`Reset Observation ${observationIndex}`)
    .closest('.MuiStack-root') as HTMLElement
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
  await screen.findByText('STEP 2 — Starting Gogma Counter')
}

async function reachReview(coordinator: FakeCoordinator, user: ReturnType<typeof userEvent.setup>) {
  await reachStep2(coordinator, user)
  fillGogmaObservations(coordinator)
  await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))
  act(() => coordinator.completeGogma('unique'))
  await screen.findByText('Review')
}

async function seedStep2(coordinator: FakeCoordinator) {
  act(() => { coordinator.seedUniqueSkillResult() })
  await screen.findByText('STEP 2 — Starting Gogma Counter')
}

async function seedReview(coordinator: FakeCoordinator) {
  act(() => { coordinator.seedUniqueGogmaResult() })
  await screen.findByText('Review')
}

describe('IdentificationWizardDialog STEP 1', () => {
  it('starts with blank Seed range and unentered Skill observation drafts', () => {
    renderWizard()

    expect(screen.getByLabelText('Base Seed range start')).toHaveValue(null)
    expect(screen.getByLabelText('Base Seed range end')).toHaveValue(null)
    expect(screen.queryByText(/canonical Base Seed全域/)).not.toBeInTheDocument()
    for (let index = 1; index <= 4; index += 1) {
      expect(screen.getByLabelText(`Observation ${index} Series Skill`))
        .toHaveTextContent('未入力')
      expect(screen.getByLabelText(`Observation ${index} Group Skill`))
        .toHaveTextContent('未入力')
    }
  })

  it('does not call identifySkill while the Seed range is blank', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSkillObservations()

    await user.click(screen.getByRole('button', { name: 'STEP 1 Search' }))

    expect(await screen.findByText(/Base Seed rangeの開始を入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)
  })

  it('does not call identifySkill while any Skill observation row is incomplete', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillSeedRange()
    fillSkillObservations(3)

    await user.click(screen.getByRole('button', { name: 'STEP 1 Search' }))

    expect(await screen.findByText(/Skill Observation 4のSeries SkillとGroup Skillを入力してください/)).toBeInTheDocument()
    expect(coordinator.skillInputs).toHaveLength(0)
  })

  it('passes ordered observations, semantic weapon/element, and explicit ranges to the Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await user.clear(screen.getByLabelText('Base Seed range start'))
    await user.type(screen.getByLabelText('Base Seed range start'), '100')
    await user.clear(screen.getByLabelText('Base Seed range end'))
    await user.type(screen.getByLabelText('Base Seed range end'), '200')
    await user.clear(screen.getByLabelText('概算Skill Counter'))
    await user.type(screen.getByLabelText('概算Skill Counter'), '50')
    await user.clear(screen.getByLabelText('Skill Counterの±幅'))
    await user.type(screen.getByLabelText('Skill Counterの±幅'), '3')
    await user.click(screen.getByLabelText('Observation 2 Series Skill'))
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[2]!)
    await user.click(screen.getByLabelText('Observation 2 Group Skill'))
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
  })

  it('shows global progress and cancels through the Coordinator', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.progressSkill(25, 100, 2))

    expect(screen.getByLabelText('検索進捗')).toHaveTextContent('25 / 100')
    const cancel = screen.getByRole('button', { name: 'STEP 1 Cancel' })
    expect(cancel).toBeEnabled()
    await user.click(cancel)

    expect(coordinator.cancelSkillCalls).toBe(1)
    expect(await screen.findByText(/検索をキャンセルしました/)).toBeInTheDocument()
    expect(screen.queryByText('STEP 2 — Starting Gogma Counter')).not.toBeInTheDocument()
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
    expect(screen.queryByText('STEP 2 — Starting Gogma Counter')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /candidate/i })).not.toBeInTheDocument()
  })

  it('keeps ordered inputs editable and allows adding an observation after multiple', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    act(() => coordinator.completeSkill('multiple'))
    await user.click(screen.getByRole('button', { name: 'Skill Observationを追加' }))
    expect(screen.getByLabelText('Observation 5 Series Skill')).toHaveTextContent('未入力')
    expect(screen.getByLabelText('Observation 5 Group Skill')).toHaveTextContent('未入力')
  })

  it('restart clears the explicitly entered Seed range and observations', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    fillStep1()

    await user.click(screen.getByRole('button', { name: 'Restart' }))

    expect(coordinator.restartCalls).toBe(1)
    expect(screen.getByLabelText('Base Seed range start')).toHaveValue(null)
    expect(screen.getByLabelText('Base Seed range end')).toHaveValue(null)
    expect(screen.getByLabelText('Observation 1 Series Skill')).toHaveTextContent('未入力')
    expect(screen.getByLabelText('Observation 1 Group Skill')).toHaveTextContent('未入力')
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
    expect(screen.getByText('現在: STEP 2')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Reset Observationを追加' }))
    const addedEditor = screen.getByText('Reset Observation 5')
      .closest('.MuiStack-root') as HTMLElement
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

    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))

    expect(await screen.findByText(/Reset Observation 4の枠5を完成させてください/)).toBeInTheDocument()
    expect(coordinator.gogmaInputs).toHaveLength(0)
  })

  it('uses STEP 1 authority, sends ordered five-slot Reset observations, and has no Seed/Keep input', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)

    expect(screen.queryByLabelText(/^Base Seed$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Keep Observation/)).not.toBeInTheDocument()
    fillGogmaObservations(coordinator)
    const secondResetPanel = screen.getByText('Reset Observation 2')
      .closest('.MuiPaper-root') as HTMLElement
    await user.click(within(secondResetPanel).getAllByRole('combobox')[0]!)
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[2]!)
    await user.click(within(secondResetPanel).getAllByRole('combobox')[1]!)
    await user.click(within(await screen.findByRole('listbox')).getAllByRole('option')[1]!)
    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))

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

  it.each([
    ['zero', /一致する結果がありません/],
    ['multiple', /候補が複数あります/],
    ['incomplete', /探索が完全ではない/],
  ] as const)('%s does not advance to Review', async (classification, message) => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    fillGogmaObservations(coordinator)
    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))
    act(() => coordinator.completeGogma(classification))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: /candidate/i })).not.toBeInTheDocument()
  })

  it('shows global progress, cancellation, and Worker failure distinctly', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedStep2(coordinator)
    fillGogmaObservations(coordinator)
    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))
    act(() => coordinator.progressGogma())
    expect(screen.getByLabelText('検索進捗')).toHaveTextContent('5 / 11')
    await user.click(screen.getByRole('button', { name: 'STEP 2 Cancel' }))
    expect(coordinator.cancelGogmaCalls).toBe(1)
    expect(await screen.findByText(/検索をキャンセルしました/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))
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
    expect(screen.getByText('Starting Skill Counter: 42')).toBeInTheDocument()
    expect(screen.getByText('Starting Gogma Counter: 84')).toBeInTheDocument()
    expect(screen.queryByText(/Current Skill Counter/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current Gogma Counter/)).not.toBeInTheDocument()
    expect(screen.queryByText('Starting Skill Counter: 46')).not.toBeInTheDocument()

    const adopt = screen.getByRole('button', { name: 'Adopt starting values' })
    expect(adopt).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
    expect(adopt).toBeEnabled()
    await user.click(adopt)

    await waitFor(() => expect(coordinator.adoptCalls).toBe(1))
    expect(onAdopted).toHaveBeenCalledWith(expect.objectContaining({
      baseSeed: { value: '86315169', isConfirmed: true, source: 'observation' },
      skillCounter: { value: 42, isConfirmed: true, source: 'observation' },
      gogmaCounter: { value: 84, isConfirmed: true, source: 'observation' },
    }))
  })

  it('retains Review and confirmation after adoption failure and allows retry', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedReview(coordinator)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))
    coordinator.adoptionFailure = new Error('put failed')

    await user.click(screen.getByRole('button', { name: 'Adopt starting values' }))
    expect(await screen.findByText(/Adoption failure: put failed/)).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Adopt starting values' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Adopt starting values' }))
    await waitFor(() => expect(coordinator.adoptCalls).toBe(2))
  })

  it('STEP 1 rerun removes STEP 2 result, Review, and confirmation', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await reachReview(coordinator, user)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))

    await user.click(screen.getByRole('button', { name: 'STEP 1 Search' }))

    expect(screen.queryByText('STEP 2 — Starting Gogma Counter')).not.toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
    expect(coordinator.getState().gameRestoredConfirmed).toBe(false)
  })

  it('STEP 2 rerun retains STEP 1 unique and removes Review and confirmation', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await reachReview(coordinator, user)
    await user.click(screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' }))

    await user.click(screen.getByRole('button', { name: 'STEP 2 Search' }))

    expect(screen.getByText('STEP 2 — Starting Gogma Counter')).toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
    expect(coordinator.getState().skill.classification).toBe('unique')
    expect(coordinator.getState().gameRestoredConfirmed).toBe(false)
  })

  it('restart returns to the initial Coordinator state', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await seedReview(coordinator)
    await user.click(screen.getByRole('button', { name: 'Restart' }))

    expect(coordinator.restartCalls).toBe(1)
    expect(screen.getByText('現在: STEP 1')).toBeInTheDocument()
    expect(screen.queryByText('STEP 2 — Starting Gogma Counter')).not.toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
  })

  it('ignores a late completion after cancel and does not advance', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    await startSkillSearch(user)
    const oldRequest = 1
    await user.click(screen.getByRole('button', { name: 'STEP 1 Cancel' }))
    act(() => coordinator.completeSkill('unique', oldRequest))

    expect(screen.queryByText('STEP 2 — Starting Gogma Counter')).not.toBeInTheDocument()
    expect(coordinator.getState().skill.status).toBe('cancelled')
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
