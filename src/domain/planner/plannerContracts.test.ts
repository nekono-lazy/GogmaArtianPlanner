import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  InventoryChange,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
} from '../models/publicTypes'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import { createTargetDefinitionHash } from '../buildList'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../../test/fixtures/candidateSearch'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerWarning,
} from './plannerTypes'
import {
  defaultPlannerOptions,
} from './plannerTypes'
import {
  validatePlannerInput,
  validatePlannerOptions,
  validatePlannerWarning,
  validateOwnedNormalConversionInventoryChange,
  validateReserveWeaponInventoryChange,
} from './plannerValidation'
import { createPlanConflictId } from './conflictKey'

function createPlannerFixture(): {
  input: PlannerInput
  dependencies: PlannerDependencies
} {
  const searchInput = createCandidateSearchInput()
  const entry = createValidBuildListEntry()
  entry.calculationContext = { ...searchInput.calculationContext }
  entry.candidateSnapshot.calculationContext = { ...searchInput.calculationContext }
  entry.targetDefinitionHash = createTargetDefinitionHash(searchInput.targetWeapons[0])
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    searchInput.rngState,
    searchInput.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    searchInput.ownedWeapons,
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash = entry.referencedOwnedWeaponsHash
  const engine = createCandidateSearchEngine(searchInput)
  let planSequence = 0
  let stepSequence = 0
  let weaponSequence = 0
  return {
    input: {
      rngState: searchInput.rngState,
      normalCounters: searchInput.normalCounters,
      ownedWeapons: searchInput.ownedWeapons,
      targetWeapons: searchInput.targetWeapons,
      buildListEntries: [entry],
      calculationContext: searchInput.calculationContext,
      options: { ...defaultPlannerOptions },
      master: {
        weaponBonusDefinitions: searchInput.master.weaponBonusDefinitions,
        weaponTypes: searchInput.master.weaponTypes,
        elements: searchInput.master.elements,
        bonusTypes: searchInput.master.bonusTypes,
        lotteries: searchInput.master.lotteries,
        materialCosts: searchInput.master.materialCosts,
        bonusRanks: searchInput.master.bonusRanks,
      },
      conflictResolutions: [],
    },
    dependencies: {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => `plan.fixed.${++planSequence}` as never,
        planStepId: () => `step.fixed.${++stepSequence}` as never,
        ownedWeaponId: () => `owned.fixed.${++weaponSequence}` as never,
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
    },
  }
}

function reservedGogma(entry: BuildListEntry): OwnedGogmaArtianWeapon {
  const source = createValidOwnedWeapon(ownedWeaponId('owned.fixture.reserved'))
  return {
    ...source,
    restorationBonuses: entry.candidateSnapshot.finalBonuses,
    seriesSkillId: entry.candidateSnapshot.seriesSkillId,
    groupSkillId: entry.candidateSnapshot.groupSkillId,
    status: entry.candidateSnapshot.category,
    isProtected: entry.candidateSnapshot.category === 'ideal',
  }
}

function emptyInventoryChange(): InventoryChange {
  return {
    addOwnedWeapon: null,
    removeOwnedWeaponIds: [],
    updateOwnedWeapons: [],
    materialRequirements: [],
  }
}

describe('Planner contracts', () => {
  it('keeps PlannerInput serializable and excludes runtime dependencies and legacy inputs', () => {
    const { input } = createPlannerFixture()
    expect(structuredClone(input)).toEqual(input)
    expect(input).not.toHaveProperty('rngEngine')
    expect(input).not.toHaveProperty('engineCapabilities')
    expect(input).not.toHaveProperty('existingActivePlan')
    expect(input.options).not.toHaveProperty('preferPracticalBeforeIdeal')
  })

  it('validates only the three positive integer Planner options', () => {
    expect(validatePlannerOptions({ ...defaultPlannerOptions }).isValid).toBe(true)
    expect(validatePlannerOptions({ ...defaultPlannerOptions, maxPlanSteps: 0 }).isValid).toBe(false)
    expect(validatePlannerOptions({ ...defaultPlannerOptions, beamWidth: 0 }).isValid).toBe(false)
    expect(validatePlannerOptions({ ...defaultPlannerOptions, maxExpandedStates: 0 }).isValid).toBe(false)
    expect(validatePlannerOptions({
      ...defaultPlannerOptions,
      preferPracticalBeforeIdeal: true,
    } as typeof defaultPlannerOptions).isValid).toBe(false)
  })

  it('keeps max step and max expanded state warnings distinct', () => {
    const warnings: PlannerWarning[] = [
      { kind: 'max_steps_reached', message: 'step bound' },
      { kind: 'max_expanded_states_reached', message: 'state bound' },
    ]
    expect(warnings.every((warning) => validatePlannerWarning(warning).isValid)).toBe(true)
    expect(warnings.map(({ kind }) => kind)).toEqual([
      'max_steps_reached',
      'max_expanded_states_reached',
    ])
  })

  it('accepts the concrete prediction unsupported warning taxonomy', () => {
    expect(validatePlannerWarning({
      kind: 'rng_prediction_unsupported',
      message: 'The concrete semantic RNG input is unsupported.',
    }).isValid).toBe(true)
  })

  it('accepts an executable conflict choice and warns for missing or stale choices', () => {
    const valid = createPlannerFixture()
    valid.input.conflictResolutions = [{
      conflictKey: 'conflict.fixture.shared-counter',
      selectedBuildListEntryId: valid.input.buildListEntries[0].id,
    }]
    expect(validatePlannerInput(valid.input, valid.dependencies)).toMatchObject({
      isValid: true,
      warnings: [],
      validConflictResolutions: valid.input.conflictResolutions,
    })

    const missing = createPlannerFixture()
    missing.input.conflictResolutions = [{
      conflictKey: 'conflict.fixture.missing',
      selectedBuildListEntryId: buildListEntryId('build-list.fixture.missing'),
    }]
    expect(validatePlannerInput(missing.input, missing.dependencies).warnings[0].kind)
      .toBe('invalid_conflict_resolution')

    const stale = createPlannerFixture()
    stale.input.buildListEntries[0].isStale = true
    stale.input.buildListEntries[0].staleReasons = ['rng_state_changed']
    stale.input.rngState.skillCounter = {
      ...stale.input.rngState.skillCounter,
      value: 8,
    }
    stale.input.conflictResolutions = [{
      conflictKey: 'conflict.fixture.stale',
      selectedBuildListEntryId: stale.input.buildListEntries[0].id,
    }]
    expect(validatePlannerInput(stale.input, stale.dependencies).validConflictResolutions)
      .toEqual([])
  })

  it('validates reserve_weapon for new Normal, owned Normal, and existing Gogma routes', () => {
    const entry = createValidBuildListEntry()
    const added = reservedGogma(entry)
    const newNormalChange = { ...emptyInventoryChange(), addOwnedWeapon: added }
    expect(validateReserveWeaponInventoryChange(entry, [], newNormalChange).isValid).toBe(true)

    const sourceNormal: OwnedNormalArtianWeapon = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.fixture.normal-source')),
      kind: 'normal',
      rarity: 8,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
    }
    const ownedNormalEntry = structuredClone(entry)
    ownedNormalEntry.candidateSnapshot.route = {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: sourceNormal.id,
      operations: [{
        type: 'convert_normal_to_gogma',
        weaponTypeId: sourceNormal.weaponTypeId,
        skillCounterBefore: 10,
        skillCounterAfter: 11,
      }],
    }
    const converted = { ...reservedGogma(ownedNormalEntry), id: ownedWeaponId('owned.fixture.converted') }
    const conversionChange = {
      ...emptyInventoryChange(),
      removeOwnedWeaponIds: [sourceNormal.id],
    }
    expect(validateOwnedNormalConversionInventoryChange(
      ownedNormalEntry,
      [sourceNormal],
      conversionChange,
    ).isValid).toBe(true)
    const inventoryAfterConversion: OwnedNormalArtianWeapon[] = []
    expect(validateOwnedNormalConversionInventoryChange(
      ownedNormalEntry,
      inventoryAfterConversion,
      conversionChange,
    ).isValid).toBe(false)
    expect(validateReserveWeaponInventoryChange(ownedNormalEntry, inventoryAfterConversion, {
      ...emptyInventoryChange(),
      addOwnedWeapon: converted,
    }).isValid).toBe(true)
    expect(validateReserveWeaponInventoryChange(ownedNormalEntry, inventoryAfterConversion, {
      ...emptyInventoryChange(),
      addOwnedWeapon: converted,
      removeOwnedWeaponIds: [sourceNormal.id],
    }).isValid).toBe(false)
    expect(converted.id).not.toBe(sourceNormal.id)

    const existing = createValidOwnedWeapon(ownedWeaponId('owned.fixture.existing'))
    const existingEntry = structuredClone(entry)
    existingEntry.candidateSnapshot.route = {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: existing.id,
      operations: [{
        type: 'reset_skills',
        sourceOwnedWeaponId: existing.id,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }],
    }
    existingEntry.candidateSnapshot.finalBonuses = existing.restorationBonuses
    const updated = {
      ...existing,
      seriesSkillId: existingEntry.candidateSnapshot.seriesSkillId,
      groupSkillId: existingEntry.candidateSnapshot.groupSkillId,
      status: existingEntry.candidateSnapshot.category,
      isProtected: true,
    }
    expect(validateReserveWeaponInventoryChange(existingEntry, [existing], {
      ...emptyInventoryChange(),
      updateOwnedWeapons: [updated],
    }).isValid).toBe(true)
  })

  it('does not mutate a Candidate BuildRoute while validating Planner-only inventory changes', () => {
    const entry = createValidBuildListEntry()
    const routeBefore = structuredClone(entry.candidateSnapshot.route)
    const futureId = ownedWeaponId('owned.fixture.future-material')
    validateReserveWeaponInventoryChange(entry, [], {
      ...emptyInventoryChange(),
      addOwnedWeapon: { ...reservedGogma(entry), id: futureId },
    })
    expect(entry.candidateSnapshot.route).toEqual(routeBefore)
    expect(JSON.stringify(entry.candidateSnapshot.route)).not.toContain(futureId)
  })

  it('creates stable conflict keys from semantic positions and sorted BuildListEntry IDs', () => {
    const first = buildListEntryId('build-list.fixture.first')
    const second = buildListEntryId('build-list.fixture.second')
    const ordered = createPlanConflictId({
      kind: 'same_gogma_counter',
      gogmaCounter: 42,
      buildListEntryIds: [first, second],
    })
    const reversed = createPlanConflictId({
      kind: 'same_gogma_counter',
      gogmaCounter: 42,
      buildListEntryIds: [second, first],
    })
    expect(reversed).toBe(ordered)
    expect(createPlanConflictId({
      kind: 'same_gogma_counter',
      gogmaCounter: 43,
      buildListEntryIds: [first, second],
    })).not.toBe(ordered)
    expect(createPlanConflictId({
      kind: 'same_gogma_counter',
      gogmaCounter: 42,
      buildListEntryIds: [first],
    })).not.toBe(ordered)
    expect(createPlanConflictId({
      kind: 'same_skill_counter',
      skillCounter: 42,
      buildListEntryIds: [first, second],
    })).not.toBe(ordered)
    const normalCounterConflict = createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: 'weapon.fixture.a:8',
      normalCounter: 42,
      buildListEntryIds: [first, second],
    })
    expect(normalCounterConflict).not.toBe(ordered)
    expect(createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: 'weapon.fixture.b:8',
      normalCounter: 42,
      buildListEntryIds: [first, second],
    })).not.toBe(normalCounterConflict)
    expect(createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: 'weapon.fixture.a:8',
      normalCounter: 43,
      buildListEntryIds: [first, second],
    })).not.toBe(normalCounterConflict)
    const ownedWeaponConflict = createPlanConflictId({
      kind: 'same_owned_weapon_consumed',
      ownedWeaponId: ownedWeaponId('owned.fixture.material'),
      buildListEntryIds: [first, second],
    })
    expect(ownedWeaponConflict).not.toBe(ordered)
    expect(createPlanConflictId({
      kind: 'same_owned_weapon_consumed',
      ownedWeaponId: ownedWeaponId('owned.fixture.other-material'),
      buildListEntryIds: [first, second],
    })).not.toBe(ownedWeaponConflict)
  })
})
