import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  PlanConflict,
  PlanStep,
  ProductionPlan,
  TargetWeapon,
} from '../../domain/models/publicTypes'
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
import type { PlannerInteractionPreparationResult } from '../../workers/plannerWorkerContracts'
import {
  conflictKindPresentation,
  createProductionPlanConflictSectionDisplay,
  excludedByOtherDecisionText,
  participantUnavailableText,
  plannerExclusionText,
  type ConflictNameSource,
  type ConflictSectionSource,
} from './productionPlanConflictPresentation'

const master = createValidMasterDataFixture()

function entryAndTarget(suffix: string, name = `Target ${suffix}`): { entry: BuildListEntry; target: TargetWeapon } {
  const entry = createValidBuildListEntry()
  const target = createValidTargetWeapon()
  entry.id = buildListEntryId(`build-list.conflict.${suffix}`)
  entry.targetWeaponId = targetWeaponId(`target.conflict.${suffix}`)
  entry.candidateSnapshot.targetWeaponId = entry.targetWeaponId
  target.id = entry.targetWeaponId
  target.name = name
  return { entry, target }
}

function conflictOf(id: string, entries: readonly BuildListEntry[], overrides: Partial<PlanConflict> = {}): PlanConflict {
  return {
    id,
    kind: 'same_gogma_counter',
    buildListEntryIds: entries.map(({ id: entryId }) => entryId),
    reason: `BuildListEntries require incompatible physical operations at Gogma Counter 107 (${id}).`,
    recommendedBuildListEntryId: entries[0]?.id ?? null,
    selectedBuildListEntryId: null,
    resolutionNote: 'Internal resolution note',
    checkpointParticipants: [],
    ...overrides,
  }
}

/** A current-form Plan (every Step carries `executionEffects`) completing the given Targets. */
function planCompleting(completions: readonly { entry: BuildListEntry }[], conflicts: PlanConflict[]): ProductionPlan {
  const base = createValidProductionPlan()
  const template = base.steps[0]
  const steps: PlanStep[] = (completions.length === 0 ? [null] : completions).map((completion, index) => ({
    ...structuredClone(template),
    id: `step.conflict.${index}` as never,
    order: index + 1,
    progressedTargetWeaponIds: completion === null ? [] : [completion.entry.targetWeaponId],
    executionEffects: {
      trackedOwnedWeaponId: null,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: completion === null
        ? []
        : [{
            buildListEntryId: completion.entry.id,
            targetWeaponId: completion.entry.targetWeaponId,
            ownedWeaponId: 'owned.conflict.result' as never,
          }],
    },
  }))
  return { ...base, steps, conflicts, selectedBuildListEntryIds: completions.map(({ entry }) => entry.id) }
}

function inputOf(entries: BuildListEntry[], targets: TargetWeapon[]): PlannerInput {
  return {
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [],
    targetWeapons: targets,
    buildListEntries: entries,
    calculationContext: { ...entries[0].calculationContext },
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: [],
      weaponTypes: [],
      elements: [],
      bonusTypes: [],
      bonusRanks: [],
      artianBonusTypeMappings: [],
      materialCosts: [],
    },
    conflictResolutions: [],
  }
}

function readySource(plan: ProductionPlan, input: PlannerInput, preparation: PlannerInteractionPreparationResult): ConflictSectionSource {
  return { status: 'ready', viewModel: createProductionPlanInteractionViewModel(plan, input, preparation), preparation }
}

function loaded(entries: BuildListEntry[], targets: TargetWeapon[]): ConflictNameSource {
  return { status: 'loaded', buildListEntries: entries, targetWeapons: targets }
}

function currentReady(
  plan: ProductionPlan,
  entries: readonly BuildListEntry[],
): Extract<PlannerInteractionPreparationResult, { status: 'ready' }> {
  return {
    status: 'ready',
    validBuildListEntryIds: entries.map(({ id }) => id),
    excludedBuildListEntries: [],
    currentConflicts: plan.conflicts.map(({ id, buildListEntryIds }) => ({ id, buildListEntryIds: [...buildListEntryIds], checkpointParticipants: [] })),
  }
}

/**
 * Every rendered text of the display, for "never shows an internal value"
 * checks: React keys, action arguments and the Debug-only block are dropped.
 */
function normalTexts(display: ReturnType<typeof createProductionPlanConflictSectionDisplay>): string {
  const notRendered = new Set(['key', 'id', 'buildListEntryId', 'debug'])
  return JSON.stringify(display, (field, value: unknown) => (notRendered.has(field) ? undefined : value))
}

describe('conflictKindPresentation (UI_FLOW 11.6.2)', () => {
  it.each([
    ['same_gogma_counter', '復元ボーナスの抽選位置の競合', '復元ボーナスの抽選はすべての武器で共通の順番で進みます。'],
    ['same_skill_counter', 'スキルの抽選位置の競合', 'スキルの抽選はすべての武器で共通の順番で進みます。'],
    ['same_normal_counter', '通常アーティアの作成位置の競合', '同じ武器種の通常アーティアは共通の順番で作成される'],
    ['same_owned_weapon_consumed', '所持武器の競合', '同じ所持武器を、それぞれの作成手順で使う必要がある'],
  ])('explains %s from the typed kind alone, in the existing terms', (kind, heading, explanation) => {
    const presentation = conflictKindPresentation(kind, 2)
    expect(presentation.heading).toBe(heading)
    expect(presentation.explanation).toContain(explanation)
    // No implementation term or absolute position.
    expect(`${presentation.heading}${presentation.explanation}`).not.toMatch(/Counter|カウンター|BuildList|\d/)
  })

  it('gives an unknown kind the generic wording, singular or plural', () => {
    expect(conflictKindPresentation('legacy_unknown_kind', 2)).toEqual({
      heading: '作成手順の競合',
      explanation: 'この2件の作成手順は同時に実行できません。',
    })
    expect(conflictKindPresentation('legacy_unknown_kind', 3).explanation).toBe('これらの作成手順は同時に実行できません。')
  })

  it('uses the plural conclusion for three or more participants', () => {
    expect(conflictKindPresentation('same_gogma_counter', 2).explanation).toMatch(/、同時には作成できません。$/)
    expect(conflictKindPresentation('same_gogma_counter', 3).explanation).toMatch(/、これらを同時には作成できません。$/)
    expect(conflictKindPresentation('same_owned_weapon_consumed', 4).explanation).toMatch(/これらを同時には作成できません。$/)
  })
})

describe('participant reasons (UI_FLOW 11.6.4)', () => {
  it('says every typed exclusion in Japanese and never falls back to an English reason', () => {
    for (const kind of ['build_list_entry_stale', 'completed_target_excluded', 'calculation_context_incompatible',
      'protected_weapon_required', 'rng_state_missing', 'rng_prediction_unsupported', 'max_steps_reached', null] as const) {
      const text = plannerExclusionText(kind)
      expect(text).toMatch(/[ぁ-んァ-ヶ]/)
      expect(text).not.toMatch(/[A-Za-z]{4,}/)
    }
    expect(plannerExclusionText('protected_weapon_required')).toContain('保護中の所持武器')
    expect(plannerExclusionText(null)).toBe('この候補は現在の計画対象から外れているため、優先できません。')
  })

  it('leaves section- and conflict-level reasons to their own places', () => {
    expect(participantUnavailableText('plan_not_draft', null, false)).toBeNull()
    expect(participantUnavailableText('preparation_invalid', null, false)).toBeNull()
    expect(participantUnavailableText('current_conflict_not_found', null, false)).toBeNull()
    expect(participantUnavailableText('checkpoint_conflict', null, true)).toBeNull()
    expect(participantUnavailableText('checkpoint_conflict', null, false)).toContain('途中採用する状態')
    expect(participantUnavailableText('entry_not_found', null, false)).toBe(
      'この候補の目標武器を確認できません。作成リストを確認するか、画面を再読み込みしてください。',
    )
  })
})

describe('createProductionPlanConflictSectionDisplay', () => {
  it('names participants by Target, tells equal names apart by weapon, and never shows an internal ID', () => {
    const a = entryAndTarget('a', '同じ名前')
    const b = entryAndTarget('b', '同じ名前')
    b.target.weaponTypeId = 'weapon.fixture.b'
    const conflict = conflictOf('conflict.names', [a.entry, b.entry])
    const plan = planCompleting([a], [conflict])
    const input = inputOf([a.entry, b.entry], [a.target, b.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan, source: readySource(plan, input, currentReady(plan, [a.entry, b.entry])), names: loaded(input.buildListEntries, input.targetWeapons), master,
    })
    const participants = display.conflicts[0].participants
    expect(participants.map(({ name, weaponLabel }) => [name, weaponLabel])).toEqual([
      ['同じ名前', 'A fixture / 属性A fixture'],
      ['同じ名前', 'B fixture / 属性A fixture'],
    ])
    // The registered Route is a judgement aid; no absolute Counter value.
    expect(participants[0].routeSummary).toMatch(/操作数の目安 \d+回$/)
    const texts = normalTexts(display)
    for (const internal of [a.entry.id, b.entry.id, a.target.id, conflict.id, conflict.reason, 'Internal resolution note', 'Gogma Counter']) {
      expect(texts).not.toContain(internal)
    }
    // The raw values stay available for Debug Mode only.
    expect(display.conflicts[0].debug).toMatchObject({
      id: conflict.id,
      kind: 'same_gogma_counter',
      buildListEntryIds: [a.entry.id, b.entry.id],
      reason: conflict.reason,
      resolutionNote: 'Internal resolution note',
    })
  })

  it('never falls back to an ID for a missing Entry or Target, and offers no action for it', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const gone = buildListEntryId('build-list.conflict.gone')
    const conflict = conflictOf('conflict.missing', [a.entry, b.entry])
    conflict.buildListEntryIds = [a.entry.id, b.entry.id, gone]
    const plan = planCompleting([a], [conflict])
    // b's Target is gone; the third Entry is gone from the Build List.
    const input = inputOf([a.entry, b.entry], [a.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan,
      source: readySource(plan, input, { ...currentReady(plan, [a.entry]), currentConflicts: [{ id: conflict.id, buildListEntryIds: [...conflict.buildListEntryIds], checkpointParticipants: [] }] }),
      names: loaded(input.buildListEntries, input.targetWeapons),
      master,
    })
    const [first, second, third] = display.conflicts[0].participants
    expect(first).toMatchObject({ name: 'Target a', nameResolved: true, canPrefer: true })
    for (const participant of [second, third]) {
      expect(participant).toMatchObject({ name: '目標武器を確認できない候補', nameResolved: false, canPrefer: false, weaponLabel: null })
      expect(participant.notes).toEqual(['この候補の目標武器を確認できません。作成リストを確認するか、画面を再読み込みしてください。'])
    }
    expect(normalTexts(display)).not.toContain(gone)
    expect(normalTexts(display)).not.toContain(b.target.id)
    expect(display.showBuildListLink).toBe(true)
  })

  it('names participants from the independent read while preparing, after a failure and for a stale Plan', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const plan = planCompleting([a], [conflictOf('conflict.read-only', [a.entry, b.entry], { selectedBuildListEntryId: a.entry.id })])
    const names = loaded([a.entry, b.entry], [a.target, b.target])
    for (const status of ['preparing', 'preparation_failed', 'stale'] as const) {
      const display = createProductionPlanConflictSectionDisplay({ plan, source: { status }, names, master })
      expect(display.conflicts[0].participants.map(({ name, canPrefer }) => [name, canPrefer])).toEqual([
        ['Target a', false],
        ['Target b', false],
      ])
      expect(display.conflicts[0].statusChip.label).toBe('選択済み')
      expect(display.sectionNotices).toHaveLength(1)
    }
    const pending = createProductionPlanConflictSectionDisplay({ plan, source: { status: 'preparing' }, names: { status: 'loading' }, master })
    expect(pending.conflicts[0].participants.map(({ name }) => name)).toEqual(['確認中', '確認中'])
    expect(pending.conflicts[0].participants.flatMap(({ notes }) => notes)).toEqual([])
    expect(pending.targets.namesStatus).toBe('loading')
    const failed = createProductionPlanConflictSectionDisplay({ plan, source: { status: 'preparing' }, names: { status: 'failed' }, master })
    expect(failed.conflicts[0].participants.map(({ name }) => name)).toEqual(['目標武器を確認できない候補', '目標武器を確認できない候補'])
    expect(failed.targets.namesStatus).toBe('failed')
  })

  it('tells a pending conflict, its provisional outcome and the recommendation apart from a selection', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const conflict = conflictOf('conflict.pending', [a.entry, b.entry], { recommendedBuildListEntryId: b.entry.id })
    // The Planner's provisional outcome made b; nobody selected it.
    const plan = planCompleting([b], [conflict])
    const input = inputOf([a.entry, b.entry], [a.target, b.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan, source: readySource(plan, input, currentReady(plan, [a.entry, b.entry])), names: loaded(input.buildListEntries, input.targetWeapons), master,
    })
    const card = display.conflicts[0]
    expect(card.status).toBe('pending')
    expect(card.statusChip).toEqual({ label: '判断待ち', tone: 'caution' })
    expect(card.guidance.join('')).toContain('選択済みではありません')
    expect(card.participants.map(({ chips }) => chips.map(({ label }) => label))).toEqual([
      ['暫定：この計画では作成しない'],
      ['暫定：この計画で作成予定', 'Planner推奨（参考）'],
    ])
    expect(card.participants.every(({ canPrefer }) => canPrefer)).toBe(true)
    expect(card.participants.map(({ chips }) => chips.some(({ label }) => label.includes('選択済み')))).toEqual([false, false])
    expect(display.pendingDecisionNotice).toBe('まだ判断が必要な競合があります（1件）。')
    expect([display.conflictCount, display.undecidedCount, display.selectedCount, display.pendingCount]).toEqual([1, 1, 0, 1])
    expect(display.countDetail).toBe('判断待ち 1件・選択済み 0件')
  })

  it('shows a selected conflict as 優先（選択済み） and 今回は作成しない, and lets another participant re-choose', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const conflict = conflictOf('conflict.selected', [a.entry, b.entry], { selectedBuildListEntryId: b.entry.id, recommendedBuildListEntryId: a.entry.id })
    const plan = planCompleting([b], [conflict])
    const input = inputOf([a.entry, b.entry], [a.target, b.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan, source: readySource(plan, input, currentReady(plan, [a.entry, b.entry])), names: loaded(input.buildListEntries, input.targetWeapons), master,
    })
    const card = display.conflicts[0]
    expect(card.statusChip).toEqual({ label: '選択済み', tone: 'positive' })
    expect(card.guidance).toEqual(['「Target b」を優先しています。', '選び直す場合は、別の候補の「この候補を優先」を押してください。'])
    expect(card.participants.map(({ chips }) => chips.map(({ label }) => label))).toEqual([
      ['今回は作成しない', 'Planner推奨（参考）'],
      ['優先（選択済み）'],
    ])
    expect(card.participants[0].preferExplanation).toBe('この候補を優先すると、「Target b」は今回の生産計画では作成しません。作成リストの候補は残ります。')
    expect(card.participants[1].preferExplanation).toContain('同じ選択のまま')
    expect(display.pendingDecisionNotice).toBeNull()
    expect([display.undecidedCount, display.selectedCount]).toEqual([0, 1])
    expect(display.countDetail).toBe('判断待ち 0件・選択済み 1件')
  })

  it('says a participant another Conflict explicitly prefers is made by that decision, not provisionally', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const c = entryAndTarget('c')
    const x = conflictOf('conflict.x', [a.entry, b.entry], { selectedBuildListEntryId: a.entry.id })
    const y = conflictOf('conflict.y', [a.entry, c.entry], { recommendedBuildListEntryId: null })
    const plan = planCompleting([a], [x, y])
    const input = inputOf([a.entry, b.entry, c.entry], [a.target, b.target, c.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan, source: readySource(plan, input, currentReady(plan, [a.entry, b.entry, c.entry])), names: loaded(input.buildListEntries, input.targetWeapons), master,
    })
    expect(display.conflicts[1].participants.map(({ chips }) => chips.map(({ label }) => label))).toEqual([
      ['この計画で作成予定（別の競合で優先）'],
      ['暫定：この計画では作成しない'],
    ])
  })

  it('asks for a Build List checkpoint change only while a checkpoint participant is effective', () => {
    // conflict 1 = {A, B} preferring A; conflict 2 = {B (checkpoint), C}.
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const c = entryAndTarget('c')
    const conflict1 = conflictOf('conflict.1', [a.entry, b.entry])
    const conflict2 = conflictOf('conflict.2', [b.entry, c.entry])
    const checkpoint = [{ buildListEntryId: b.entry.id, axis: 'bonus' as const, opportunityId: 'opportunity.b' as never }]
    const preparation: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [a.entry.id, b.entry.id, c.entry.id],
      excludedBuildListEntries: [],
      currentConflicts: [
        { id: conflict1.id, buildListEntryIds: [a.entry.id, b.entry.id], checkpointParticipants: [] },
        { id: conflict2.id, buildListEntryIds: [b.entry.id, c.entry.id], checkpointParticipants: checkpoint },
      ],
    }
    const input = inputOf([a.entry, b.entry, c.entry], [a.target, b.target, c.target])
    const names = loaded(input.buildListEntries, input.targetWeapons)

    // Undecided: B's checkpoint is effective, so conflict 2 sends to the Build List.
    const undecided = planCompleting([a, c], [conflict1, conflict2])
    const effective = createProductionPlanConflictSectionDisplay({ plan: undecided, source: readySource(undecided, input, preparation), names, master })
    expect(effective.conflicts[1]).toMatchObject({ status: 'checkpoint_change_required', buildListAction: 'change_checkpoint' })
    expect(effective.conflicts[1].statusChip.label).toBe('途中採用状態の変更が必要')
    expect(effective.conflicts[1].participants.every(({ canPrefer }) => !canPrefer)).toBe(true)
    expect(effective.conflicts[1].participants[0].notes).toContain('この候補の途中採用する状態の選択が、この競合に関係しています。')

    // A preferred on conflict 1: B is not made, so its checkpoint imposes nothing.
    const decided = planCompleting([a, c], [{ ...conflict1, selectedBuildListEntryId: a.entry.id }, conflict2])
    const excluded = createProductionPlanConflictSectionDisplay({ plan: decided, source: readySource(decided, input, preparation), names, master })
    const second = excluded.conflicts[1]
    expect(second.status).toBe('pending')
    expect(second.buildListAction).toBeNull()
    expect(second.guidance.join('')).not.toContain('途中採用する状態の選択が関係しています')
    expect(second.participants[0].chips.map(({ label }) => label)).toContain('今回は作成しない')
    expect(second.participants[0].notes[0]).toBe('別の競合で「Target a」を優先したため、今回は作成しません。')
    // C can be preferred; preferring B itself would restore its checkpoint.
    expect(second.participants.map(({ canPrefer }) => canPrefer)).toEqual([false, true])
  })

  it('separates a dynamic conflict from one the changed input cannot reproduce, and offers no recalculation for the dynamic one', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const initial = conflictOf('conflict.initial', [a.entry, b.entry])
    const dynamic = conflictOf('conflict.dynamic', [a.entry, b.entry], { kind: 'same_skill_counter' })
    const plan = planCompleting([a], [initial, dynamic])
    const preparation: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [a.entry.id, b.entry.id],
      excludedBuildListEntries: [],
      currentConflicts: [{ id: initial.id, buildListEntryIds: [a.entry.id, b.entry.id], checkpointParticipants: [] }],
    }
    const input = inputOf([a.entry, b.entry], [a.target, b.target])
    const viewModel = createProductionPlanInteractionViewModel(plan, input, preparation)
    const names = loaded(input.buildListEntries, input.targetWeapons)
    const display = (inputComparison: 'same_input' | 'input_changed' | 'not_compared') => createProductionPlanConflictSectionDisplay({
      plan,
      source: {
        status: 'ready',
        preparation,
        viewModel: {
          ...viewModel,
          inputComparison,
          conflicts: viewModel.conflicts.map((conflict) => conflict.currency === 'current'
            ? conflict
            : { ...conflict, currency: inputComparison === 'same_input' ? 'dynamic' : inputComparison }),
        },
      },
      names,
      master,
    })

    // 判断待ち counts only what can be decided here; the dynamic one is apart.
    expect(display('same_input').countDetail).toBe('判断待ち 1件・選択済み 0件・ここでは選べない 1件')
    expect(display('same_input').pendingDecisionNotice).toBe('まだ判断が必要な競合があります（1件）。')
    const sameInput = display('same_input').conflicts[1]
    expect(sameInput).toMatchObject({ status: 'dynamic', buildListAction: 'review' })
    expect(sameInput.statusChip.label).toBe('計画の途中で生じた競合')
    expect(sameInput.guidance[0]).toBe('この競合は、計画を立てる途中（候補を外した後など）で生じたもので、ここでは優先する候補を選べません。')
    expect(sameInput.guidance.join('')).toContain('同じ作成リストと状態のまま計算し直しても、同じ結果になります。')
    expect(sameInput.participants.every(({ canPrefer }) => !canPrefer)).toBe(true)

    const changed = display('input_changed').conflicts[1]
    expect(changed).toMatchObject({ status: 'input_changed', buildListAction: 'review' })
    expect(changed.statusChip.label).toBe('現在の入力では再現できない')
    expect(changed.guidance.join('')).toContain('作成リスト画面の「生産計画を作成」から作り直してください。')

    const unknown = display('not_compared').conflicts[1]
    expect(unknown.status).toBe('not_compared')
    expect(unknown.participants.every(({ canPrefer }) => !canPrefer)).toBe(true)

    // The current initial Conflict stays choosable in every case.
    expect(display('same_input').conflicts[0].status).toBe('pending')
  })

  it('counts the Targets made and not made, with typed reasons and no double counting', () => {
    // A, B, C, D; conflict X = {A, B} preferring A; conflict Y = {B, C} undecided;
    // conflict Z = {C, D} undecided; D also rejected; E rejected only.
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((suffix) => entryAndTarget(suffix))
    // A second Entry of A's Target in conflict Y (a legacy duplicate) counts once.
    const aDuplicate = entryAndTarget('a-duplicate')
    aDuplicate.entry.targetWeaponId = a.target.id
    const x = conflictOf('conflict.x', [a.entry, b.entry], { selectedBuildListEntryId: a.entry.id })
    const y = conflictOf('conflict.y', [b.entry, c.entry, aDuplicate.entry])
    const z = conflictOf('conflict.z', [c.entry, d.entry])
    const plan = planCompleting([a, c], [x, y, z])
    plan.rejectedBuildListEntries = [
      { buildListEntryId: d.entry.id, reason: 'lower_priority', detail: 'English detail never shown' },
      { buildListEntryId: e.entry.id, reason: 'longer_route', detail: 'English detail never shown' },
    ]
    const entries = [a.entry, b.entry, c.entry, d.entry, e.entry, aDuplicate.entry]
    const targets = [a.target, b.target, c.target, d.target, e.target]
    const display = createProductionPlanConflictSectionDisplay({ plan, source: { status: 'preparing' }, names: loaded(entries, targets), master })

    expect(display.targets.createdCount).toBe(2)
    expect(display.targets.created.map(({ name }) => name)).toEqual(['Target a', 'Target c'])
    expect(display.targets.notCreated.map(({ name, reason }) => [name, reason])).toEqual([
      // B: excluded by X's explicit decision outranks being in the undecided Y.
      ['Target b', '「Target a」を優先したため、今回は作成しません。'],
      ['Target d', '競合の選択待ちのため、今回は作成しません。'],
      ['Target e', 'より短い作成ルートの候補を優先しました。'],
    ])
    expect(display.targets.notCreatedUnresolvedCount).toBe(0)
    expect([display.conflictCount, display.undecidedCount, display.selectedCount]).toEqual([3, 2, 1])
    // Nothing current is known while preparing: the persisted decision state only.
    expect(display.countDetail).toBe('判断待ち 2件・選択済み 1件')
    expect(display.pendingDecisionNotice).toBeNull()
    expect(normalTexts(display)).not.toContain('English detail never shown')
  })

  it('falls back to the generic reason, lists unreadable Entries apart, and never invents a made count for a legacy Plan', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const gone = entryAndTarget('gone')
    const plan = planCompleting([a], [])
    plan.rejectedBuildListEntries = [
      { buildListEntryId: b.entry.id, reason: 'unknown_future_reason' as never, detail: '' },
      { buildListEntryId: gone.entry.id, reason: 'lower_priority', detail: '' },
    ]
    const display = createProductionPlanConflictSectionDisplay({ plan, source: { status: 'stale' }, names: loaded([a.entry, b.entry], [a.target, b.target]), master })
    expect(display.targets.notCreated.map(({ reason }) => reason)).toEqual(['この計画では作成しません。'])
    expect(display.targets.notCreatedUnresolvedCount).toBe(1)

    const legacy = structuredClone(plan)
    delete (legacy.steps[0] as Partial<PlanStep>).executionEffects
    const legacyDisplay = createProductionPlanConflictSectionDisplay({ plan: legacy, source: { status: 'stale' }, names: loaded([a.entry, b.entry], [a.target, b.target]), master })
    expect(legacyDisplay.targets).toMatchObject({ hasCompletionAuthority: false, createdCount: null, notCreated: [] })
  })

  it('says why nothing can be preferred for a non-draft Plan and counts its undecided Conflicts as 未選択', () => {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const plan = { ...planCompleting([a], [conflictOf('conflict.active', [a.entry, b.entry])]), status: 'active' as const }
    const input = inputOf([a.entry, b.entry], [a.target, b.target])
    const display = createProductionPlanConflictSectionDisplay({
      plan, source: readySource(plan, input, currentReady(plan, [a.entry, b.entry])), names: loaded(input.buildListEntries, input.targetWeapons), master,
    })
    expect(display.sectionNotices).toEqual(['実行中の生産計画では、優先する候補を変更できません。'])
    expect(display.undecidedLabel).toBe('未選択')
    expect(display.countDetail).toBe('未選択 1件・選択済み 0件')
    expect(display.pendingDecisionNotice).toBeNull()
    expect(display.conflicts[0].statusChip.label).toBe('未選択')
    expect(display.conflicts[0].participants.every(({ canPrefer }) => !canPrefer)).toBe(true)
    expect(display.targets.notCreated.map(({ reason }) => reason)).toEqual(['競合があるため、この計画では作成しません。'])
  })

  it('names the typed warnings of an invalid preparation in Japanese only', () => {
    const a = entryAndTarget('a')
    const plan = planCompleting([a], [conflictOf('conflict.invalid', [a.entry])])
    const input = inputOf([a.entry], [a.target])
    const preparation: PlannerInteractionPreparationResult = {
      status: 'invalid',
      issues: [{ path: 'buildListEntries', code: 'invalid_structure', message: 'TargetWeapon has 2 BuildListEntries.' }],
      warnings: [
        { kind: 'duplicate_build_list_entries_for_target', message: 'English duplicate warning' },
        { kind: 'duplicate_build_list_entries_for_target', message: 'English duplicate warning 2' },
      ],
      excludedBuildListEntries: [],
    }
    const display = createProductionPlanConflictSectionDisplay({ plan, source: readySource(plan, input, preparation), names: loaded([a.entry], [a.target]), master })
    expect(display.invalidPreparationReasons).toEqual(['同じ目標武器に複数の作成リスト候補が登録されています。使用する候補を1件にしてください'])
    expect(normalTexts(display)).not.toContain('English duplicate warning')
    expect(display.conflicts[0].participants[0].canPrefer).toBe(false)
  })
})

/**
 * PR #281 review (`docs/UI_FLOW.md` 11.6.6): a participant another Conflict's
 * effective decision leaves out keeps a disabled 「この候補を優先」 and says which
 * Conflict preferred which Target, while the other participants keep theirs.
 */
describe('participants another Conflict excludes (UI_FLOW 11.6.6)', () => {
  function crossDisplay(options: { conflict1: 'a' | 'b'; withConflict2?: boolean }) {
    const a = entryAndTarget('a')
    const b = entryAndTarget('b')
    const c = entryAndTarget('c')
    const d = entryAndTarget('d')
    const byKey = { a, b, c, d }
    const conflicts = [
      conflictOf('conflict.1', [a.entry, b.entry], { selectedBuildListEntryId: byKey[options.conflict1].entry.id }),
      ...(options.withConflict2
        ? [conflictOf('conflict.2', [d.entry, b.entry], { selectedBuildListEntryId: d.entry.id })]
        : []),
      conflictOf('conflict.4', [c.entry, b.entry], { recommendedBuildListEntryId: c.entry.id }),
    ]
    const entries = [a.entry, b.entry, c.entry, d.entry]
    const input = inputOf(entries, [a.target, b.target, c.target, d.target])
    const plan = planCompleting(options.conflict1 === 'a' ? [a, c, ...(options.withConflict2 ? [d] : [])] : [b], conflicts)
    return createProductionPlanConflictSectionDisplay({
      plan,
      source: readySource(plan, input, currentReady(plan, entries)),
      names: loaded(input.buildListEntries, input.targetWeapons),
      master,
    })
  }

  it('disables B with the other Conflict\'s number and preferred name, and keeps C choosable', () => {
    const display = crossDisplay({ conflict1: 'a' })
    const four = display.conflicts[1]
    expect(four.number).toBe(2)
    expect(four.status).toBe('pending')
    const [c, b] = four.participants
    expect([c.canPrefer, c.preferDisabledReason]).toEqual([true, null])
    expect(b.canPrefer).toBe(false)
    expect(b.preferExplanation).toBeNull()
    expect(b.preferDisabledReason).toBe(
      '「Target b」は、競合1で「Target a」を優先したため、今回は作成しません。この競合では優先できません。'
      + '「Target b」を優先したい場合は、先に競合1の選択を変更してください。',
    )
    expect(b.chips.map(({ label }) => label)).toEqual(['今回は作成しない'])
    // Said once: the persisted "another Conflict preferred" note gives way to the reason.
    expect(b.notes).toEqual([])
    expect(b.needsBuildListReview).toBe(false)
    // The re-choice in conflict 1 itself stays offered.
    expect(display.conflicts[0].participants.map(({ canPrefer, preferDisabledReason }) => [canPrefer, preferDisabledReason])).toEqual([
      [true, null],
      [true, null],
    ])
    expect(display.pendingCount).toBe(1)
    expect(normalTexts(display)).not.toMatch(/build-list\.|conflict\.|target\.conflict/)
  })

  it('offers B again once conflict 1 prefers B', () => {
    const display = crossDisplay({ conflict1: 'b' })
    expect(display.conflicts[1].participants.map(({ canPrefer, preferDisabledReason }) => [canPrefer, preferDisabledReason])).toEqual([
      [true, null],
      [true, null],
    ])
  })

  it('names every excluding Conflict and asks to change either one', () => {
    const display = crossDisplay({ conflict1: 'a', withConflict2: true })
    const b = display.conflicts[2].participants[1]
    expect(b.preferDisabledReason).toBe(
      '「Target b」は、競合1で「Target a」を、競合2で「Target d」を優先したため、今回は作成しません。この競合では優先できません。'
      + '「Target b」を優先したい場合は、先に競合1・競合2のいずれかの選択を変更してください。',
    )
    // Each excluding Conflict re-chooses B itself.
    expect(display.conflicts[0].participants[1].canPrefer).toBe(true)
    expect(display.conflicts[1].participants[1].canPrefer).toBe(true)
  })

  it('never guesses a name or a Conflict number it cannot read', () => {
    expect(excludedByOtherDecisionText(null, [{ conflictNumber: null, preferredName: null }])).toBe(
      'この候補は、別の競合で別の候補を優先したため、今回は作成しません。この競合では優先できません。'
      + 'この候補を優先したい場合は、先にその競合の選択を変更してください。',
    )
    expect(excludedByOtherDecisionText('B', [{ conflictNumber: 3, preferredName: null }])).toBe(
      '「B」は、競合3で別の候補を優先したため、今回は作成しません。この競合では優先できません。'
      + '「B」を優先したい場合は、先に競合3の選択を変更してください。',
    )
    expect(participantUnavailableText('excluded_by_other_decision', null, false)).toBeNull()
  })
})
