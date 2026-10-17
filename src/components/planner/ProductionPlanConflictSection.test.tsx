import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { BuildListEntry, PlanConflict, PlanStep, ProductionPlan, TargetWeapon } from '../../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/common'
import { defaultPlannerOptions, type PlannerInput } from '../../domain/planner'
import { createProductionPlanInteractionViewModel } from '../../services/planner/prepareProductionPlanInteraction'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { ProductionPlanConflictSection } from './ProductionPlanConflictSection'
import {
  createProductionPlanConflictSectionDisplay,
  type ConflictSectionDisplay,
} from './productionPlanConflictPresentation'

const master = createValidMasterDataFixture()

function entryAndTarget(suffix: string, name: string): { entry: BuildListEntry; target: TargetWeapon } {
  const entry = createValidBuildListEntry()
  const target = createValidTargetWeapon()
  entry.id = buildListEntryId(`build-list.section.${suffix}`)
  entry.targetWeaponId = targetWeaponId(`target.section.${suffix}`)
  entry.candidateSnapshot.targetWeaponId = entry.targetWeaponId
  target.id = entry.targetWeaponId
  target.name = name
  return { entry, target }
}

const longName = 'とても長い名前の目標武器・双剣・水属性・会心特化・巨戟アーティア・二本目の予備ビルド'

function scenario() {
  const a = entryAndTarget('a', longName)
  const b = entryAndTarget('b', 'B側の目標武器')
  const conflict: PlanConflict = {
    id: 'conflict.section.hash-7f3a',
    kind: 'same_gogma_counter',
    buildListEntryIds: [a.entry.id, b.entry.id],
    reason: 'BuildListEntries require incompatible physical operations at Gogma Counter 107.',
    recommendedBuildListEntryId: a.entry.id,
    selectedBuildListEntryId: null,
    resolutionNote: 'Internal note',
    checkpointParticipants: [],
  }
  const base = createValidProductionPlan()
  const step: PlanStep = {
    ...structuredClone(base.steps[0]),
    progressedTargetWeaponIds: [a.target.id],
    executionEffects: {
      trackedOwnedWeaponId: null,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: [{ buildListEntryId: a.entry.id, targetWeaponId: a.target.id, ownedWeaponId: 'owned.section' as never }],
    },
  }
  const plan: ProductionPlan = { ...base, steps: [step], conflicts: [conflict], selectedBuildListEntryIds: [a.entry.id] }
  const input: PlannerInput = {
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [],
    targetWeapons: [a.target, b.target],
    buildListEntries: [a.entry, b.entry],
    calculationContext: { ...a.entry.calculationContext },
    options: { ...defaultPlannerOptions },
    master: { weaponBonusDefinitions: [], weaponTypes: [], elements: [], bonusTypes: [], bonusRanks: [], artianBonusTypeMappings: [], materialCosts: [] },
    conflictResolutions: [],
  }
  const preparation = {
    status: 'ready' as const,
    validBuildListEntryIds: [a.entry.id, b.entry.id],
    excludedBuildListEntries: [],
    currentConflicts: [{ id: conflict.id, buildListEntryIds: [a.entry.id, b.entry.id], checkpointParticipants: [] }],
  }
  const display: ConflictSectionDisplay = createProductionPlanConflictSectionDisplay({
    plan,
    source: { status: 'ready', viewModel: createProductionPlanInteractionViewModel(plan, input, preparation), preparation },
    names: { status: 'loaded', buildListEntries: input.buildListEntries, targetWeapons: input.targetWeapons },
    master,
  })
  return { a, b, conflict, display }
}

function renderSection(display: ConflictSectionDisplay, props: Partial<Parameters<typeof ProductionPlanConflictSection>[0]> = {}) {
  const onPrefer = vi.fn()
  render(
    <MemoryRouter>
      <ProductionPlanConflictSection display={display} debugMode={false} busy={false} onPrefer={onPrefer} {...props} />
    </MemoryRouter>,
  )
  return { onPrefer }
}

describe('ProductionPlanConflictSection', () => {
  it('shows the kind, the state, the counts and the Targets made and not made, as text', () => {
    const { a, b, display } = scenario()
    renderSection(display)

    expect(screen.getByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })).toBeInTheDocument()
    expect(screen.getByText('判断待ち')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('まだ判断が必要な競合があります（1件）。')
    const counts = screen.getByLabelText('競合と作成予定の件数')
    expect(within(counts).getByText('判断待ち 1件・選択済み 0件')).toBeInTheDocument()
    expect(within(counts).getByText('今回作成する目標武器').nextElementSibling).toHaveTextContent('1本')
    expect(within(counts).getByText('今回作成しない目標武器').nextElementSibling).toHaveTextContent('1本')

    const outcome = screen.getByRole('region', { name: '今回作成する / 作成しない目標武器' })
    expect(within(outcome).getByRole('heading', { level: 4, name: '今回作成する目標武器（1本）' })).toBeInTheDocument()
    expect(within(outcome).getByText(a.target.name)).toBeInTheDocument()
    expect(within(outcome).getByText(b.target.name)).toBeInTheDocument()
    expect(within(outcome).getByText('競合の選択待ちのため、今回は作成しません。')).toBeInTheDocument()
    expect(within(outcome).getByText(/作成リストの候補と目標武器は削除されず、残っています。/)).toBeInTheDocument()
  })

  it('hides every internal value outside Debug Mode and shows them collapsed inside it', async () => {
    const { a, conflict, display } = scenario()
    const { unmount } = render(
      <MemoryRouter>
        <ProductionPlanConflictSection display={display} debugMode={false} busy={false} onPrefer={vi.fn()} />
      </MemoryRouter>,
    )
    const normal = document.body.textContent ?? ''
    for (const internal of [conflict.id, conflict.reason, 'Internal note', a.entry.id, 'Gogma Counter', 'BuildListEntry']) {
      expect(normal).not.toContain(internal)
    }
    expect(screen.queryByRole('button', { name: /診断情報/ })).not.toBeInTheDocument()
    unmount()

    renderSection(display, { debugMode: true })
    const toggle = screen.getByRole('button', { name: '競合 1 の診断情報（Debug）' })
    // Collapsed by default, and unmounted while collapsed.
    expect(screen.queryByText(conflict.reason)).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(await screen.findByText(conflict.reason)).toBeInTheDocument()
    expect(screen.getByText(conflict.id)).toBeInTheDocument()
    expect(screen.getByText('same_gogma_counter')).toBeInTheDocument()
  })

  it('offers 44px actions only to participants the display allows, and disables them while busy', async () => {
    const { a, b, conflict, display } = scenario()
    const user = userEvent.setup()
    const { onPrefer } = renderSection(display)
    const buttons = screen.getAllByRole('button', { name: 'この候補を優先' })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1])
    expect(onPrefer).toHaveBeenCalledExactlyOnceWith(conflict.id, b.entry.id)
    expect(buttons[0]).toHaveAccessibleDescription(new RegExp(`「${b.target.name}」は今回の生産計画では作成しません`))
    expect(buttons[0]).toHaveAccessibleDescription(new RegExp(a.target.name.slice(0, 10)))

    const unavailable = structuredClone(display)
    unavailable.conflicts[0].participants[1].canPrefer = false
    unavailable.conflicts[0].participants[1].notes = ['理由の文']
    const busy = render(
      <MemoryRouter>
        <ProductionPlanConflictSection display={unavailable} debugMode={false} busy onPrefer={vi.fn()} />
      </MemoryRouter>,
    )
    const list = within(busy.container).getByRole('list', { name: '競合 1 の参加候補' })
    const cards = within(list).getAllByRole('listitem')
    expect(within(cards[0]).getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
    expect(within(cards[1]).queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    expect(within(cards[1]).getByText('理由の文')).toBeInTheDocument()
  })

  it('keeps a disabled 「この候補を優先」 with its written reason for a participant another Conflict excludes', async () => {
    const { a, b, conflict, display } = scenario()
    const user = userEvent.setup()
    const reason = '「B側の目標武器」は、競合2で「別の武器」を優先したため、今回は作成しません。この競合では優先できません。'
    const excluded = structuredClone(display)
    excluded.conflicts[0].participants[1].canPrefer = false
    excluded.conflicts[0].participants[1].preferExplanation = null
    excluded.conflicts[0].participants[1].preferDisabledReason = reason
    const { onPrefer } = renderSection(excluded)
    const cards = within(screen.getByRole('list', { name: '競合 1 の参加候補' })).getAllByRole('listitem')
    const disabled = within(cards[1]).getByRole('button', { name: 'この候補を優先' })
    expect(disabled).toBeDisabled()
    // The reason is visible text beside the button, not only a tooltip.
    expect(within(cards[1]).getByText(reason)).toBeVisible()
    expect(disabled).toHaveAccessibleDescription(new RegExp(reason.slice(0, 20)))
    expect(disabled).toHaveStyle({ minHeight: '44px' })
    // The other participant stays choosable.
    const enabled = within(cards[0]).getByRole('button', { name: 'この候補を優先' })
    expect(enabled).toBeEnabled()
    await user.click(enabled)
    expect(onPrefer).toHaveBeenCalledExactlyOnceWith(conflict.id, a.entry.id)
    expect(onPrefer).not.toHaveBeenCalledWith(conflict.id, b.entry.id)
  })

  it('says a Plan without Conflicts has none and lists no outcome', () => {
    const { display } = scenario()
    renderSection({ ...display, conflictCount: 0, undecidedCount: 0, conflicts: [], pendingDecisionNotice: null, targets: { ...display.targets, notCreated: [] } })
    expect(screen.getByText('この生産計画に表示する競合はありません。')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '今回作成する / 作成しない目標武器' })).not.toBeInTheDocument()
  })
})

/**
 * Issue #121 (`docs/UI_FLOW.md` 11.6.5): a Plan whose rejections carry their
 * causes groups the not-made Targets by cause, with each group's count in its
 * heading, and says how many a conflict leaves out under the count figure.
 */
describe('ProductionPlanConflictSection cause groups (Issue #121)', () => {
  function causeDisplay(names: 'loaded' | 'loading' | 'failed' = 'loaded'): ConflictSectionDisplay {
    const { a, b, conflict } = scenario()
    const c = entryAndTarget('c', 'C側の目標武器')
    const base = createValidProductionPlan()
    const plan: ProductionPlan = {
      ...base,
      calculationContext: { ...base.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
      steps: [{
        ...structuredClone(base.steps[0]),
        progressedTargetWeaponIds: [a.target.id],
        executionEffects: {
          trackedOwnedWeaponId: null,
          normalCreationRole: null,
          registersTrackedWeapon: false,
          observationBinding: null,
          targetLinks: [],
          compromiseLabels: [],
          targetCompletions: [{ buildListEntryId: a.entry.id, targetWeaponId: a.target.id, ownedWeaponId: 'owned.section' as never }],
        },
      }],
      conflicts: [conflict],
      selectedBuildListEntryIds: [a.entry.id],
      rejectedBuildListEntries: [
        { buildListEntryId: b.entry.id, targetWeaponId: b.target.id, reason: 'resource_conflict', resourceConflictCause: 'provisional_outcome_not_committed', detail: '' },
        { buildListEntryId: c.entry.id, targetWeaponId: c.target.id, reason: 'already_satisfied', detail: '' },
      ],
    }
    return createProductionPlanConflictSectionDisplay({
      plan,
      source: { status: 'stale' },
      names: names === 'loaded'
        ? { status: 'loaded', buildListEntries: [a.entry, b.entry, c.entry], targetWeapons: [a.target, b.target, c.target] }
        : { status: names },
      master,
    })
  }

  it('heads each non-empty group with its count and leaves an empty group out', () => {
    renderSection(causeDisplay())
    const counts = screen.getByLabelText('競合と作成予定の件数')
    const notCreated = within(counts).getByText('今回作成しない目標武器').nextElementSibling
    expect(notCreated).toHaveTextContent('2本うち競合のため 1本')

    const outcome = screen.getByRole('region', { name: '今回作成する / 作成しない目標武器' })
    expect(within(outcome).getByRole('heading', { level: 4, name: '今回作成しない目標武器（2本）' })).toBeInTheDocument()
    const conflictGroup = within(outcome).getByRole('list', { name: '競合のため今回作成しない（1本）' })
    expect(within(conflictGroup).getByText('B側の目標武器')).toBeInTheDocument()
    expect(within(conflictGroup).getByText('競合の選択待ちのため、今回は作成しません。')).toBeInTheDocument()
    const otherGroup = within(outcome).getByRole('list', { name: 'その他の理由で今回作成しない（1本）' })
    expect(within(otherGroup).getByText('C側の目標武器')).toBeInTheDocument()
    expect(within(otherGroup).getByText('目標武器はすでに満たされています。')).toBeInTheDocument()
    expect(within(outcome).queryByRole('heading', { name: /競合によるものか確認できない/ })).not.toBeInTheDocument()
  })

  it('says the established and the undetermined counts apart when a stuck drop cannot be told', () => {
    const display = causeDisplay()
    const groups = display.targets.causeGroups!
    groups.ratioDetermined = false
    groups.unestablishedCount = 1
    groups.unestablished = [{
      key: 'target.section.d',
      name: '名前を確認できない目標武器',
      nameResolved: false,
      weaponLabel: null,
      reason: '計画の途中で作成手順が行き詰まったため、今回は作成しません。ほかの目標武器との競合によるものかは確認できません。',
    }]
    display.targets.notCreated = [...groups.conflict, ...groups.unestablished, ...groups.other]
    renderSection(display)
    const counts = screen.getByLabelText('競合と作成予定の件数')
    expect(within(counts).getByText('今回作成しない目標武器').nextElementSibling)
      .toHaveTextContent('3本うち競合を確認できたもの 1本・確認できないもの 1本')
    const group = screen.getByRole('list', { name: '競合によるものか確認できない（1本）' })
    expect(within(group).getByText('名前を確認できない目標武器')).toBeInTheDocument()
  })

  it.each(['loading', 'failed'] as const)('keeps the conflict count while the names are %s', (names) => {
    renderSection(causeDisplay(names))
    const counts = screen.getByLabelText('競合と作成予定の件数')
    const value = within(counts).getByText('今回作成しない目標武器').nextElementSibling
    expect(value).toHaveTextContent(`${names === 'loading' ? '確認中' : '確認できません'}うち競合のため 1本`)
  })
})
