import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  PlanConflict,
  ProductionPlan,
  ProductionPlanStatus,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { defaultPlannerOptions, type PlannerInput } from '../../domain/planner'
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
  createProductionPlanInteractionViewModel,
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
  second.candidateSnapshot.category = 'ideal'
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
      lotteries: [],
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
    }],
  }
}

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
        candidateCategory: 'ideal',
        isRecommended: true,
        isSelected: false,
        isAvailable: true,
      }),
      expect.objectContaining({
        targetName: 'Domain fixture target',
        candidateCategory: 'practical',
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
          reason: excludedReason,
        }],
        currentConflicts: [],
      },
    )
    expect(excluded.conflicts[0].participants[0]).toMatchObject({
      isAvailable: false,
      unavailableReason: 'planner_validation_excluded',
      unavailableMessage: excludedReason,
    })
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
      targetName: '削除済みまたは現在存在しない候補',
      candidateCategory: null,
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
      expect(result.planStatusMessage).not.toBeNull()
      expect(result.conflicts[0].participants[0]).toMatchObject({
        isAvailable: false,
        unavailableReason: 'plan_not_draft',
      })
    },
  )
})
