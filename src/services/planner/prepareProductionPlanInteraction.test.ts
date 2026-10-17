import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  PlanConflict,
  ProductionPlan,
  ProductionPlanStatus,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  isBuildResultCalculationContextCompatible,
} from '../../domain/models/publicTypes'
import { createActualExecutionState } from '../../domain/execution'
import {
  createPlanningBuildListEntriesHash,
  createPlanningTargetWeaponsHash,
  defaultPlannerOptions,
  type PlannerInput,
} from '../../domain/planner'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import type { PlannerInteractionPreparationResult } from '../../workers/plannerWorkerContracts'
import {
  compareProductionPlanInputWithCurrentState,
  createProductionPlanInteractionViewModel,
  evaluateProductionPlanCalculationCompatibility,
  mergeExplicitConflictResolution,
  restorePersistedExplicitResolutions,
} from './prepareProductionPlanInteraction'

function fixtureEntries(): {
  entries: BuildListEntry[]
  targets: TargetWeapon[]
} {
  const first = createValidBuildListEntry()
  const firstTarget = createValidTargetWeapon()
  const second = structuredClone(first)
  const secondTarget = structuredClone(firstTarget)
  second.id = buildListEntryId('build-list.fixture.b')
  second.targetWeaponId = targetWeaponId('target.fixture.b')
  second.candidateSnapshot.targetWeaponId = second.targetWeaponId
  secondTarget.id = second.targetWeaponId
  secondTarget.name = 'Second fixture target'
  return { entries: [first, second], targets: [firstTarget, secondTarget] }
}

function plannerInput(
  entries: BuildListEntry[],
  targets: TargetWeapon[],
): PlannerInput {
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

function conflict(
  entries: BuildListEntry[],
  overrides: Partial<PlanConflict> = {},
): PlanConflict {
  return {
    id: 'conflict.fixture',
    kind: 'same_gogma_counter',
    buildListEntryIds: entries.map(({ id }) => id),
    reason: 'Fixture conflict',
    recommendedBuildListEntryId: entries[0]?.id ?? null,
    selectedBuildListEntryId: null,
    resolutionNote: null,
    ...overrides,
  }
}

function plan(
  conflicts: PlanConflict[],
  status: ProductionPlanStatus = 'draft',
): ProductionPlan {
  return { ...createValidProductionPlan(), status, conflicts }
}

type ReadyPreparation = Extract<
  PlannerInteractionPreparationResult,
  { status: 'ready' }
>

function ready(
  persistedConflict: PlanConflict,
  validBuildListEntryIds = persistedConflict.buildListEntryIds,
): ReadyPreparation {
  return {
    status: 'ready',
    validBuildListEntryIds,
    excludedBuildListEntries: [],
    currentConflicts: [{
      id: persistedConflict.id,
      buildListEntryIds: [...persistedConflict.buildListEntryIds],
      checkpointParticipants: [],
    }],
  }
}

describe('evaluateProductionPlanCalculationCompatibility', () => {
  it('fails closed for a schema 2 Plan under schema 3 while keeping exact matches current', () => {
    const persistedPlan = createValidProductionPlan()
    persistedPlan.calculationContext.appSchemaVersion = 2
    persistedPlan.baseSnapshot.calculationContext.appSchemaVersion = 2
    const current = {
      ...persistedPlan.calculationContext,
      appSchemaVersion: 3,
    }

    expect(evaluateProductionPlanCalculationCompatibility(
      persistedPlan,
      current,
    )).toEqual({
      isCompatible: false,
      recalculationReasons: ['calculation_context_changed'],
    })

    persistedPlan.calculationContext = { ...current }
    persistedPlan.baseSnapshot.calculationContext = { ...current }
    expect(evaluateProductionPlanCalculationCompatibility(
      persistedPlan,
      current,
    )).toEqual({ isCompatible: true, recalculationReasons: [] })
  })

  it.each([2, 3, 4, 5])(
    'fails closed for a schema %i ProductionPlan under the current schema',
    (appSchemaVersion) => {
      // A persisted Plan records no PlannerSearchTermination, and a version 4
      // Plan could be a partial result of a bound-truncated search that the
      // current contract no longer accepts as executable, so every older
      // schema Plan is failed closed as a whole (DATA_MODEL 3.5).
      const persistedPlan = createValidProductionPlan()
      const current = {
        ...persistedPlan.calculationContext,
        appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      }
      persistedPlan.calculationContext = { ...current, appSchemaVersion }
      persistedPlan.baseSnapshot.calculationContext = { ...current, appSchemaVersion }

      expect(evaluateProductionPlanCalculationCompatibility(
        persistedPlan,
        current,
      )).toEqual({
        isCompatible: false,
        recalculationReasons: ['calculation_context_changed'],
      })
      // The build-result exception never applies to a Plan, even though the
      // same context is compatible for a BuildCandidate / BuildListEntry.
      expect(isBuildResultCalculationContextCompatible(
        persistedPlan.calculationContext,
        current,
      )).toBe(false)
    },
  )

  it('keeps a current schema ProductionPlan compatible', () => {
    const persistedPlan = createValidProductionPlan()
    const current = {
      ...persistedPlan.calculationContext,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    }
    persistedPlan.calculationContext = { ...current }
    persistedPlan.baseSnapshot.calculationContext = { ...current }

    expect(evaluateProductionPlanCalculationCompatibility(
      persistedPlan,
      current,
    )).toEqual({ isCompatible: true, recalculationReasons: [] })
  })

  it('also fails closed when only the audit snapshot context differs', () => {
    const persistedPlan = createValidProductionPlan()
    const current = { ...persistedPlan.calculationContext }
    persistedPlan.baseSnapshot.calculationContext = {
      ...current,
      rngEngineVersion: 'old-engine',
    }

    expect(evaluateProductionPlanCalculationCompatibility(
      persistedPlan,
      current,
    )).toEqual({
      isCompatible: false,
      recalculationReasons: ['calculation_context_changed'],
    })
  })
})

describe('restorePersistedExplicitResolutions', () => {
  it('restores every and only persisted explicit selection', () => {
    const { entries, targets } = fixtureEntries()
    const selected = conflict(entries, {
      selectedBuildListEntryId: entries[1].id,
    })
    const recommendationOnly = conflict(entries, {
      id: 'conflict.recommendation-only',
      recommendedBuildListEntryId: entries[0].id,
      selectedBuildListEntryId: null,
    })
    const otherSelected = conflict(entries, {
      id: 'conflict.other-selected',
      selectedBuildListEntryId: entries[0].id,
    })
    const input = plannerInput(entries, targets)
    input.conflictResolutions = [{
      conflictKey: 'cached-resolution-must-not-survive',
      selectedBuildListEntryId: entries[0].id,
    }]
    const persistedPlan = plan([selected, recommendationOnly, otherSelected])
    persistedPlan.selectedBuildListEntryIds = [entries[0].id]

    const restored = restorePersistedExplicitResolutions(input, persistedPlan)

    expect(restored).not.toBe(input)
    expect(input.conflictResolutions).toEqual([expect.objectContaining({
      conflictKey: 'cached-resolution-must-not-survive',
    })])
    expect(restored.conflictResolutions).toEqual([
      {
        conflictKey: selected.id,
        selectedBuildListEntryId: entries[1].id,
      },
      {
        conflictKey: otherSelected.id,
        selectedBuildListEntryId: entries[0].id,
      },
    ])
  })
})

describe('createProductionPlanInteractionViewModel', () => {
  it('keeps persisted participant order and exposes ready availability and badges', () => {
    const { entries, targets } = fixtureEntries()
    const persistedConflict = conflict(entries, {
      buildListEntryIds: [entries[1].id, entries[0].id],
      recommendedBuildListEntryId: entries[1].id,
      selectedBuildListEntryId: entries[0].id,
    })
    const input = plannerInput(entries, targets)

    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      input,
      ready(persistedConflict),
    )

    expect(result.conflicts[0].participants.map(({ buildListEntryId }) =>
      buildListEntryId)).toEqual([entries[1].id, entries[0].id])
    expect(result.conflicts[0].participants).toEqual([
      expect.objectContaining({
        targetName: 'Second fixture target',
        isRecommended: true,
        isSelected: false,
        isAvailable: true,
      }),
      expect.objectContaining({
        targetName: 'Domain fixture target',
        isRecommended: false,
        isSelected: true,
        isAvailable: true,
      }),
    ])
  })

  it('distinguishes current Conflict, membership and validation exclusion failures', () => {
    const { entries, targets } = fixtureEntries()
    const persistedConflict = conflict(entries)
    const input = plannerInput(entries, targets)

    const missingConflict = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      input,
      { ...ready(persistedConflict), currentConflicts: [] },
    )
    expect(missingConflict.conflicts[0].participants[0]).toMatchObject({
      isRecommended: true,
      isAvailable: false,
      unavailableReason: 'current_conflict_not_found',
    })

    const missingMembership = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      input,
      {
        ...ready(persistedConflict),
        currentConflicts: [{
          id: persistedConflict.id,
          buildListEntryIds: [entries[1].id],
          checkpointParticipants: [],
        }],
      },
    )
    expect(missingMembership.conflicts[0].participants[0]).toMatchObject({
      isAvailable: false,
      unavailableReason: 'not_current_conflict_participant',
    })

    const excludedReason = 'current validation fixture reason'
    const excluded = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      input,
      {
        ...ready(persistedConflict, [entries[1].id]),
        excludedBuildListEntries: [{
          buildListEntryId: entries[0].id,
          kind: 'protected_weapon_required',
          reason: excludedReason,
        }],
        currentConflicts: [],
      },
    )
    // The typed exclusion code is carried; the English diagnostic is not a
    // view model field at all.
    expect(excluded.conflicts[0].participants[0]).toMatchObject({
      isAvailable: false,
      unavailableReason: 'planner_validation_excluded',
      exclusionKind: 'protected_weapon_required',
    })
    expect(JSON.stringify(excluded)).not.toContain(excludedReason)
  })

  it('names an Entry whose Target is gone as unresolved, never by ID, and makes it unavailable', () => {
    const { entries, targets } = fixtureEntries()
    const persistedConflict = conflict(entries)
    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      plannerInput(entries, [targets[1]]),
      ready(persistedConflict),
    )
    expect(result.conflicts[0].participants[0]).toMatchObject({
      buildListEntryId: entries[0].id,
      target: null,
      targetName: null,
      isAvailable: false,
      unavailableReason: 'target_not_found',
    })
    expect(result.conflicts[0].participants[1]).toMatchObject({ targetName: 'Second fixture target' })
  })

  it('retains a missing persisted participant without guessing its Target', () => {
    const { entries, targets } = fixtureEntries()
    const missingId = buildListEntryId('build-list.deleted')
    const persistedConflict = conflict(entries, {
      buildListEntryIds: [missingId, entries[0].id],
      recommendedBuildListEntryId: missingId,
    })
    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      plannerInput(entries, targets),
      ready(persistedConflict),
    )

    expect(result.conflicts[0].participants).toHaveLength(2)
    expect(result.conflicts[0].participants[0]).toMatchObject({
      buildListEntryId: missingId,
      entry: null,
      target: null,
      targetName: null,
      isRecommended: true,
      isAvailable: false,
      unavailableReason: 'entry_not_found',
    })
  })

  it('fails closed for invalid preparation before considering projection details', () => {
    const { entries, targets } = fixtureEntries()
    const persistedConflict = conflict(entries)
    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      plannerInput(entries, targets),
      {
        status: 'invalid',
        issues: [{
          path: 'fixture',
          code: 'invalid_integer',
          message: 'typed issue',
        }],
        warnings: [{ kind: 'build_list_entry_stale', message: 'typed warning' }],
        excludedBuildListEntries: [],
      },
    )

    expect(result.conflicts[0].participants.every(({ isAvailable }) =>
      !isAvailable)).toBe(true)
    expect(result.conflicts[0].participants.every(({ unavailableReason }) =>
      unavailableReason === 'preparation_invalid')).toBe(true)
  })

  it.each<ProductionPlanStatus>(['stale', 'active', 'completed', 'abandoned'])(
    'makes otherwise-valid participants unavailable when Plan status is %s',
    (status) => {
      const { entries, targets } = fixtureEntries()
      const persistedConflict = conflict(entries)
      const result = createProductionPlanInteractionViewModel(
        plan([persistedConflict], status),
        plannerInput(entries, targets),
        ready(persistedConflict),
      )
      expect(result.isDraft).toBe(false)
      expect(result.inputComparison).toBe('not_compared')
      expect(result.conflicts[0].participants[0]).toMatchObject({
        isAvailable: false,
        unavailableReason: 'plan_not_draft',
      })
    },
  )
})


describe('mergeExplicitConflictResolution', () => {
  it('replaces the same key, keeps other choices and does not mutate the input', () => {
    const { entries, targets } = fixtureEntries()
    const input = plannerInput(entries, targets)
    input.conflictResolutions = [
      { conflictKey: 'a', selectedBuildListEntryId: entries[0].id },
      { conflictKey: 'b', selectedBuildListEntryId: entries[0].id },
    ]
    const before = structuredClone(input)
    const choice = { conflictKey: 'a', selectedBuildListEntryId: entries[1].id }
    const merged = mergeExplicitConflictResolution(input, choice)
    expect(merged).not.toBe(input)
    expect(merged.conflictResolutions).toEqual([choice, input.conflictResolutions[1]])
    expect(input).toEqual(before)
  })

  it('appends an absent key without generating choices from recommendations', () => {
    const { entries, targets } = fixtureEntries()
    const input = plannerInput(entries, targets)
    const persistedPlan = plan([
      conflict(entries, { id: 'recommendation-only' }),
      conflict(entries, { id: 'explicit', selectedBuildListEntryId: entries[0].id }),
    ])
    const restored = restorePersistedExplicitResolutions(input, persistedPlan)
    const before = structuredClone(restored)
    const choice = { conflictKey: 'new', selectedBuildListEntryId: entries[1].id }
    const merged = mergeExplicitConflictResolution(restored, choice)
    expect(merged.conflictResolutions).toEqual([...restored.conflictResolutions, choice])
    expect(merged.conflictResolutions.some(({ conflictKey }) => conflictKey === 'recommendation-only')).toBe(false)
    expect(restored).toEqual(before)
    expect(input.conflictResolutions).toEqual([])
  })

  it('refuses winner selection on a conflict a selected checkpoint takes part in', () => {
    const { entries, targets } = fixtureEntries()
    const persistedConflict = conflict(entries)
    const preparation = ready(persistedConflict)
    preparation.currentConflicts[0].checkpointParticipants = [{
      buildListEntryId: entries[1].id,
      axis: 'bonus',
      opportunityId: 'intermediate-opportunity:fixture' as never,
    }]

    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      plannerInput(entries, targets),
      preparation,
    )

    expect(result.conflicts[0].involvesSelectedCheckpoint).toBe(true)
    // Conservative by contract: both sides are unavailable, not only the one
    // whose checkpoint is on the line.
    for (const participant of result.conflicts[0].participants) {
      expect(participant).toMatchObject({
        isAvailable: false,
        unavailableReason: 'checkpoint_conflict',
      })
    }
    expect(result.conflicts[0].participants.map(({ checkpointOpportunityId }) => checkpointOpportunityId))
      .toEqual([null, 'intermediate-opportunity:fixture'])
  })

  it('reads checkpoint involvement from the current preparation, not the persisted Plan', () => {
    const { entries, targets } = fixtureEntries()
    // The persisted Plan remembers a checkpoint conflict, but the Build List
    // has changed since and the current conflict no longer involves one.
    const persistedConflict = conflict(entries, {
      checkpointParticipants: [{
        buildListEntryId: entries[0].id,
        axis: 'bonus',
        opportunityId: 'intermediate-opportunity:stale' as never,
      }],
    })

    const result = createProductionPlanInteractionViewModel(
      plan([persistedConflict]),
      plannerInput(entries, targets),
      ready(persistedConflict),
    )

    expect(result.conflicts[0].involvesSelectedCheckpoint).toBe(false)
    expect(result.conflicts[0].participants.every(({ isAvailable }) => isAvailable)).toBe(true)
    expect(result.conflicts[0].participants.every(
      ({ checkpointOpportunityId }) => checkpointOpportunityId === null,
    )).toBe(true)
  })
})

/**
 * Issue #278 PR-2 (`docs/PLANNER_SPEC.md` 9.6.2 / 9.6.3 / 9.6.10): availability
 * reads the same Domain decision set the press runs, so a checkpoint
 * participant an earlier decision of the displayed Draft excludes is not
 * effective; and Plan compatibility is the one Domain authority.
 */
describe('Issue #278 interaction availability', () => {
  function threeEntries() {
    const { entries, targets } = fixtureEntries()
    const third = structuredClone(entries[1])
    const thirdTarget = structuredClone(targets[1])
    third.id = buildListEntryId('build-list.fixture.c')
    third.targetWeaponId = targetWeaponId('target.fixture.c')
    third.candidateSnapshot.targetWeaponId = third.targetWeaponId
    thirdTarget.id = third.targetWeaponId
    thirdTarget.name = 'Third fixture target'
    return { entries: [...entries, third], targets: [...targets, thirdTarget] }
  }

  function scenario(earlierDecision: boolean) {
    const { entries, targets } = threeEntries()
    const [a, b, c] = entries
    // conflict 1 = {A, B}; conflict 2 = {B (checkpoint), C}.
    const conflict1 = conflict([a, b], { id: 'conflict.1', selectedBuildListEntryId: earlierDecision ? a.id : null })
    const conflict2 = conflict([b, c], { id: 'conflict.2' })
    const preparation: ReadyPreparation = {
      status: 'ready',
      validBuildListEntryIds: entries.map(({ id }) => id),
      excludedBuildListEntries: [],
      currentConflicts: [
        { id: conflict1.id, buildListEntryIds: [a.id, b.id], checkpointParticipants: [] },
        {
          id: conflict2.id,
          buildListEntryIds: [b.id, c.id],
          checkpointParticipants: [{ buildListEntryId: b.id, axis: 'bonus', opportunityId: 'opportunity.b' as never }],
        },
      ],
    }
    const persistedPlan = plan([conflict1, conflict2])
    return { persistedPlan, preparation, input: plannerInput(entries, targets) }
  }

  it('keeps a conflict with an effective checkpoint participant unavailable', () => {
    const { persistedPlan, preparation, input } = scenario(false)
    const viewModel = createProductionPlanInteractionViewModel(persistedPlan, input, preparation)
    const second = viewModel.conflicts.find(({ id }) => id === 'conflict.2')!
    expect(second.involvesSelectedCheckpoint).toBe(true)
    expect(second.participants.map(({ unavailableReason }) => unavailableReason)).toEqual(['checkpoint_conflict', 'checkpoint_conflict'])
  })

  it('treats a checkpoint participant the displayed Draft already excludes as not effective', () => {
    const { persistedPlan, preparation, input } = scenario(true)
    const viewModel = createProductionPlanInteractionViewModel(persistedPlan, input, preparation)
    const second = viewModel.conflicts.find(({ id }) => id === 'conflict.2')!
    expect(second.involvesSelectedCheckpoint).toBe(false)
    expect(second.participants.map(({ checkpointOpportunityId }) => checkpointOpportunityId)).toEqual([null, null])
    // Only C can be preferred: preferring the checkpoint participant B itself stays refused.
    expect(second.participants.map(({ isAvailable, unavailableReason }) => [isAvailable, unavailableReason])).toEqual([
      [false, 'checkpoint_conflict'],
      [true, null],
    ])
  })

  it('marks an earlier decision the current input cannot carry over, and only that one', () => {
    const { entries, targets } = fixtureEntries()
    const carried = conflict(entries, { id: 'conflict.carried', selectedBuildListEntryId: entries[0].id })
    const lost = conflict(entries, { id: 'conflict.lost', selectedBuildListEntryId: entries[1].id })
    const persistedPlan = plan([carried, lost])
    const viewModel = createProductionPlanInteractionViewModel(persistedPlan, plannerInput(entries, targets), ready(carried))
    expect(viewModel.conflicts.map(({ id, currency, decisionNotCarriedReason }) => [id, currency, decisionNotCarriedReason])).toEqual([
      ['conflict.carried', 'current', null],
      ['conflict.lost', 'input_changed', 'conflict_not_current'],
    ])
  })

  it('judges Plan compatibility through the one Domain function (18 -> 17 for resolution-free Plans)', () => {
    const persistedPlan = createValidProductionPlan()
    const current = { ...persistedPlan.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    persistedPlan.calculationContext = { ...current, appSchemaVersion: 17 }
    persistedPlan.baseSnapshot.calculationContext = { ...current, appSchemaVersion: 17 }
    persistedPlan.conflicts = []
    expect(evaluateProductionPlanCalculationCompatibility(persistedPlan, current)).toEqual({ isCompatible: true, recalculationReasons: [] })
    persistedPlan.conflicts = [conflict(fixtureEntries().entries, { selectedBuildListEntryId: fixtureEntries().entries[0].id })]
    expect(evaluateProductionPlanCalculationCompatibility(persistedPlan, current).isCompatible).toBe(false)
  })
})

/**
 * Issue #278 PR-3 (`docs/PLANNER_SPEC.md` 9.6.7): a persisted Conflict that is
 * no current initial Conflict is "found while planning" only when the displayed
 * Draft's calculation input equals the current persisted state, judged by the
 * start / save snapshot authorities read-only; otherwise the input changed.
 */
describe('Issue #278 PR-3 dynamic versus input-changed Conflicts', () => {
  function matchingDraft(entries: BuildListEntry[], targets: TargetWeapon[], conflicts: PlanConflict[]) {
    const input = plannerInput(entries, targets)
    const draft = plan(conflicts)
    draft.selectedBuildListEntryIds = [entries[0].id]
    draft.baseSnapshot = {
      ...draft.baseSnapshot,
      initialExecutionState: createActualExecutionState(draft, input, []),
      targetWeaponsHash: createPlanningTargetWeaponsHash(input.targetWeapons),
      buildListEntriesHash: createPlanningBuildListEntriesHash(input.buildListEntries),
    }
    return { input, draft }
  }

  it('reads the same input as same_input and any planning-input change as input_changed', () => {
    const { entries, targets } = fixtureEntries()
    const { input, draft } = matchingDraft(entries, targets, [])
    expect(compareProductionPlanInputWithCurrentState(draft, input)).toBe('same_input')

    // Each authority on its own moves the judgement.
    const targetChanged = structuredClone(input)
    targetChanged.targetWeapons[1].priority = 5
    expect(compareProductionPlanInputWithCurrentState(draft, targetChanged)).toBe('input_changed')
    const entryRemoved = structuredClone(input)
    entryRemoved.buildListEntries.pop()
    expect(compareProductionPlanInputWithCurrentState(draft, entryRemoved)).toBe('input_changed')
    const rngChanged = structuredClone(input)
    rngChanged.rngState.gogmaCounter = { ...rngChanged.rngState.gogmaCounter, value: (rngChanged.rngState.gogmaCounter.value ?? 0) + 1, isConfirmed: true }
    expect(compareProductionPlanInputWithCurrentState(draft, rngChanged)).toBe('input_changed')
    const contextChanged = structuredClone(input)
    contextChanged.calculationContext = { ...contextChanged.calculationContext, rngEngineVersion: 'another-engine' }
    expect(compareProductionPlanInputWithCurrentState(draft, contextChanged)).toBe('input_changed')

    // Name / memo are no planning input.
    const renamed = structuredClone(input)
    renamed.targetWeapons[1].name = 'Renamed fixture target'
    expect(compareProductionPlanInputWithCurrentState(draft, renamed)).toBe('same_input')
  })

  it('never compares a Plan that is not a draft', () => {
    const { entries, targets } = fixtureEntries()
    const { input, draft } = matchingDraft(entries, targets, [])
    expect(compareProductionPlanInputWithCurrentState({ ...draft, status: 'active' }, input)).toBe('not_compared')
  })

  it('classifies a missing Conflict ID as dynamic only over the same input', () => {
    const { entries, targets } = fixtureEntries()
    const initial = conflict(entries, { id: 'conflict.initial' })
    const dynamic = conflict(entries, { id: 'conflict.dynamic', recommendedBuildListEntryId: entries[1].id })
    const { input, draft } = matchingDraft(entries, targets, [initial, dynamic])
    const preparation = ready(initial)

    const same = createProductionPlanInteractionViewModel(draft, input, preparation)
    expect(same.inputComparison).toBe('same_input')
    expect(same.conflicts.map(({ id, currency }) => [id, currency])).toEqual([
      ['conflict.initial', 'current'],
      ['conflict.dynamic', 'dynamic'],
    ])
    // A dynamic Conflict is never choosable.
    expect(same.conflicts[1].participants.every(({ isAvailable, unavailableReason }) =>
      !isAvailable && unavailableReason === 'current_conflict_not_found')).toBe(true)

    const changedInput = structuredClone(input)
    changedInput.targetWeapons[0].isEnabled = false
    const changed = createProductionPlanInteractionViewModel(draft, changedInput, preparation)
    expect(changed.inputComparison).toBe('input_changed')
    expect(changed.conflicts[1].currency).toBe('input_changed')

    // No safe judgement without a ready preparation.
    const invalid = createProductionPlanInteractionViewModel(draft, input, {
      status: 'invalid', issues: [], warnings: [], excludedBuildListEntries: [],
    })
    expect(invalid.conflicts.map(({ currency }) => currency)).toEqual(['not_compared', 'not_compared'])
  })
})

/**
 * PR #281 review (`docs/PLANNER_SPEC.md` 9.6.3 rule 9, `docs/UI_FLOW.md`
 * 11.6.6): a participant an effective explicit decision of *another* Conflict
 * leaves out is not offered there, while re-choosing it in the Conflict whose
 * own decision excluded it stays possible. The Domain decision set and its
 * supersede rule are unchanged; only what the screen offers narrows.
 */
describe('participants another Conflict\'s effective decision excludes', () => {
  /** A, B, C, D: conflict.1 = {A, B}, conflict.2 = {D, B}, conflict.4 = {C, B}. */
  function crossFixture() {
    const { entries, targets } = fixtureEntries()
    const extra = (suffix: string, name: string) => {
      const entry = structuredClone(entries[1])
      const target = structuredClone(targets[1])
      entry.id = buildListEntryId(`build-list.fixture.${suffix}`)
      entry.targetWeaponId = targetWeaponId(`target.fixture.${suffix}`)
      entry.candidateSnapshot.targetWeaponId = entry.targetWeaponId
      target.id = entry.targetWeaponId
      target.name = name
      return { entry, target }
    }
    const c = extra('c', 'Third fixture target')
    const d = extra('d', 'Fourth fixture target')
    const [a, b] = entries
    return {
      a, b, c: c.entry, d: d.entry,
      entries: [a, b, c.entry, d.entry],
      targets: [...targets, c.target, d.target],
    }
  }

  type EntryKey = 'a' | 'b' | 'c' | 'd'

  function crossScenario(options: {
    conflict1?: EntryKey
    /** Adds conflict.2 = {D, B} with this decision (`null` = undecided). */
    conflict2?: EntryKey | null
    conflict4?: EntryKey
    /** Conflict IDs the current preparation does not detect. */
    notCurrent?: string[]
    /** Entries the current validation excludes. */
    invalid?: EntryKey[]
  } = {}) {
    const fixture = crossFixture()
    const { a, b, c, d } = fixture
    const byKey = { a, b, c, d }
    const pick = (key: EntryKey | null | undefined) => (key == null ? null : byKey[key].id)
    const conflicts = [
      conflict([a, b], { id: 'conflict.1', selectedBuildListEntryId: pick(options.conflict1) }),
      ...(options.conflict2 === undefined
        ? []
        : [conflict([d, b], { id: 'conflict.2', selectedBuildListEntryId: pick(options.conflict2) })]),
      conflict([c, b], { id: 'conflict.4', selectedBuildListEntryId: pick(options.conflict4) }),
    ]
    const invalidIds = new Set((options.invalid ?? []).map((key) => byKey[key].id))
    const preparation: ReadyPreparation = {
      status: 'ready',
      validBuildListEntryIds: fixture.entries.map(({ id }) => id).filter((id) => !invalidIds.has(id)),
      excludedBuildListEntries: [...invalidIds].map((id) => ({
        buildListEntryId: id,
        kind: 'build_list_entry_stale' as const,
        reason: 'Fixture stale entry',
      })),
      currentConflicts: conflicts
        .filter(({ id }) => !(options.notCurrent ?? []).includes(id))
        .map(({ id, buildListEntryIds }) => ({ id, buildListEntryIds: [...buildListEntryIds], checkpointParticipants: [] })),
    }
    const viewModel = createProductionPlanInteractionViewModel(
      plan(conflicts),
      plannerInput(fixture.entries, fixture.targets),
      preparation,
    )
    const availability = (conflictId: string, entry: BuildListEntry) => {
      const { isAvailable, unavailableReason, excludingDecisions } = viewModel.conflicts
        .find(({ id }) => id === conflictId)!
        .participants.find(({ buildListEntryId }) => buildListEntryId === entry.id)!
      return { isAvailable, unavailableReason, excludingDecisions }
    }
    return { ...fixture, viewModel, availability }
  }

  const AVAILABLE = { isAvailable: true, unavailableReason: null, excludingDecisions: [] }

  it('offers every participant as before while nothing is decided', () => {
    const { a, b, c, availability } = crossScenario()
    expect(availability('conflict.1', a)).toEqual(AVAILABLE)
    expect(availability('conflict.1', b)).toEqual(AVAILABLE)
    expect(availability('conflict.4', c)).toEqual(AVAILABLE)
    expect(availability('conflict.4', b)).toEqual(AVAILABLE)
  })

  it('does not offer B in conflict 4 once conflict 1 prefers A, names that decision, and keeps C choosable', () => {
    const { a, b, c, availability } = crossScenario({ conflict1: 'a' })
    expect(availability('conflict.4', b)).toEqual({
      isAvailable: false,
      unavailableReason: 'excluded_by_other_decision',
      excludingDecisions: [{ conflictKey: 'conflict.1', selectedBuildListEntryId: a.id }],
    })
    expect(availability('conflict.4', c)).toEqual(AVAILABLE)
  })

  it('keeps re-choosing B in conflict 1 itself, the Conflict whose own decision excluded it', () => {
    const { a, b, availability } = crossScenario({ conflict1: 'a' })
    expect(availability('conflict.1', b)).toEqual(AVAILABLE)
    expect(availability('conflict.1', a)).toEqual(AVAILABLE)
  })

  it('offers B in conflict 4 again once conflict 1 prefers B instead', () => {
    const { a, b, c, availability } = crossScenario({ conflict1: 'b' })
    expect(availability('conflict.4', b)).toEqual(AVAILABLE)
    expect(availability('conflict.4', c)).toEqual(AVAILABLE)
    // A is now the one conflict 1 leaves out, and stays re-choosable there.
    expect(availability('conflict.1', a)).toEqual(AVAILABLE)
  })

  it('never treats the Planner\'s provisional outcome or recommendation as an exclusion', () => {
    const fixture = crossFixture()
    const { a, b, c } = fixture
    // Undecided, recommending A and C: the Plan leaves B out only provisionally.
    const conflicts = [
      conflict([a, b], { id: 'conflict.1', recommendedBuildListEntryId: a.id }),
      conflict([c, b], { id: 'conflict.4', recommendedBuildListEntryId: c.id }),
    ]
    const persisted = { ...plan(conflicts), selectedBuildListEntryIds: [a.id, c.id] }
    const viewModel = createProductionPlanInteractionViewModel(
      persisted,
      plannerInput(fixture.entries, fixture.targets),
      {
        status: 'ready',
        validBuildListEntryIds: fixture.entries.map(({ id }) => id),
        excludedBuildListEntries: [],
        currentConflicts: conflicts.map(({ id, buildListEntryIds }) => ({ id, buildListEntryIds: [...buildListEntryIds], checkpointParticipants: [] })),
      },
    )
    const bInFour = viewModel.conflicts[1].participants.find(({ buildListEntryId }) => buildListEntryId === b.id)!
    expect([bInFour.isAvailable, bInFour.unavailableReason, bInFour.excludingDecisions]).toEqual([true, null, []])
  })

  it('names every effective decision that excludes B, and still lets each excluding Conflict re-choose it', () => {
    const { a, b, d, availability } = crossScenario({ conflict1: 'a', conflict2: 'd' })
    expect(availability('conflict.4', b)).toEqual({
      isAvailable: false,
      unavailableReason: 'excluded_by_other_decision',
      excludingDecisions: [
        { conflictKey: 'conflict.1', selectedBuildListEntryId: a.id },
        { conflictKey: 'conflict.2', selectedBuildListEntryId: d.id },
      ],
    })
    // B is excluded by its own Conflict's decision there too, so re-choosing it
    // stays possible; otherwise B could be preferred nowhere.
    expect(availability('conflict.1', b)).toEqual(AVAILABLE)
    expect(availability('conflict.2', b)).toEqual(AVAILABLE)
  })

  it('never uses an earlier decision the current input cannot carry over', () => {
    // Conflict 1 is no current initial Conflict any more.
    const notCurrent = crossScenario({ conflict1: 'a', notCurrent: ['conflict.1'] })
    expect(notCurrent.availability('conflict.4', notCurrent.b)).toEqual(AVAILABLE)
    // The Entry conflict 1 preferred is no valid Entry now.
    const invalidWinner = crossScenario({ conflict1: 'a', invalid: ['a'] })
    expect(invalidWinner.availability('conflict.4', invalidWinner.b)).toEqual(AVAILABLE)
  })

  it('names a refusal that holds whatever the other Conflicts decided before the exclusion', () => {
    const fixture = crossFixture()
    const { a, b, c } = fixture
    // Conflict 4 = {C, B (checkpoint)}: preferring B there is refused even if
    // conflict 1 changed, so its checkpoint reason stays.
    const conflicts = [
      conflict([a, b], { id: 'conflict.1', selectedBuildListEntryId: a.id }),
      conflict([c, b], { id: 'conflict.4' }),
    ]
    const viewModel = createProductionPlanInteractionViewModel(
      plan(conflicts),
      plannerInput(fixture.entries, fixture.targets),
      {
        status: 'ready',
        validBuildListEntryIds: fixture.entries.map(({ id }) => id),
        excludedBuildListEntries: [],
        currentConflicts: [
          { id: 'conflict.1', buildListEntryIds: [a.id, b.id], checkpointParticipants: [] },
          {
            id: 'conflict.4',
            buildListEntryIds: [c.id, b.id],
            checkpointParticipants: [{ buildListEntryId: b.id, axis: 'bonus', opportunityId: 'opportunity.b' as never }],
          },
        ],
      },
    )
    const bInFour = viewModel.conflicts[1].participants.find(({ buildListEntryId }) => buildListEntryId === b.id)!
    expect([bInFour.isAvailable, bInFour.unavailableReason]).toEqual([false, 'checkpoint_conflict'])
  })
})
