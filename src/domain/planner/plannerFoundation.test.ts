import { describe, expect, it } from 'vitest'
import { createTargetDefinitionHash } from '../buildList'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import type {
  BuildListEntry,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
} from '../models/publicTypes'
import {
  createValidBuildListEntry,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  belowPracticalBonuses,
} from '../../test/fixtures/candidateSearch'
import {
  addRegisteredWeapon,
  areAllEnabledTargetsAlreadySatisfied,
  canUseAsDestructiveGogmaSource,
  canUseAsResetSkillsSource,
  consumeMaterialWeapon,
  consumeOwnedNormalForConversion,
  createInitialPlannerSearchState,
  createSimulatedInventory,
  deriveTargetSatisfaction,
  type PlannerDependencies,
  type PlannerInput,
  reserveWeaponId,
  updateOwnedWeapon,
  validatePlannerInput,
} from '.'

function synchronizeEntry(entry: BuildListEntry, input: PlannerInput) {
  const target = input.targetWeapons.find(({ id }) => id === entry.targetWeaponId)
  if (!target) throw new Error('Fixture Target is required.')
  entry.calculationContext = { ...input.calculationContext }
  entry.candidateSnapshot.calculationContext = { ...input.calculationContext }
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    input.rngState,
    input.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    input.ownedWeapons,
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash = entry.referencedOwnedWeaponsHash
}

function fixture(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const search = createCandidateSearchInput()
  const entry = createValidBuildListEntry()
  const input: PlannerInput = {
    rngState: search.rngState,
    normalCounters: search.normalCounters,
    ownedWeapons: search.ownedWeapons,
    targetWeapons: search.targetWeapons,
    buildListEntries: [entry],
    calculationContext: search.calculationContext,
    options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10_000 },
    master: {
      weaponBonusDefinitions: search.master.weaponBonusDefinitions,
      lotteries: search.master.lotteries,
      materialCosts: search.master.materialCosts,
      bonusRanks: search.master.bonusRanks,
    },
    conflictResolutions: [],
  }
  synchronizeEntry(entry, input)
  return {
    input,
    dependencies: {
      rngEngine: createCandidateSearchEngine(search),
      idFactory: {
        productionPlanId: () => 'plan.foundation' as never,
        planStepId: () => 'step.foundation' as never,
        ownedWeaponId: () => 'owned.foundation' as never,
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
    },
  }
}

function resetSkillsEntry(input: PlannerInput): BuildListEntry {
  const entry = structuredClone(input.buildListEntries[0])
  const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  entry.id = 'build-list.foundation.reset-skills' as never
  entry.candidateId = 'candidate.foundation.reset-skills' as never
  entry.candidateSnapshot.id = entry.candidateId
  entry.candidateSnapshot.route = {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: source.id,
    operations: [{
      type: 'reset_skills',
      sourceOwnedWeaponId: source.id,
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    }],
  }
  entry.candidateSnapshot.finalBonuses = structuredClone(source.restorationBonuses)
  synchronizeEntry(entry, input)
  return entry
}

describe('Planner current-state entry validation', () => {
  it('rederives target, RNG, referenced-weapon, and CalculationContext staleness', () => {
    const target = fixture()
    target.input.targetWeapons[0].priority = 5
    expect(validatePlannerInput(target.input, target.dependencies).excludedBuildListEntries)
      .toHaveLength(1)

    const rng = fixture()
    const rngEntry = resetSkillsEntry(rng.input)
    rng.input.buildListEntries = [rngEntry]
    rng.input.rngState.skillCounter.value = 8
    expect(validatePlannerInput(rng.input, rng.dependencies).excludedBuildListEntries).toHaveLength(1)

    const weapon = fixture()
    const weaponEntry = resetSkillsEntry(weapon.input)
    weapon.input.buildListEntries = [weaponEntry]
    weapon.input.ownedWeapons[0].isProtected = false
    expect(validatePlannerInput(weapon.input, weapon.dependencies).warnings[0].kind).toBe('build_list_entry_stale')

    const context = fixture()
    context.input.calculationContext.masterDataVersion += 1
    expect(validatePlannerInput(context.input, context.dependencies).warnings[0].kind)
      .toBe('calculation_context_incompatible')
  })

  it('does not stale an entry for unrelated or presentation-only OwnedWeapon changes', () => {
    const { input, dependencies } = fixture()
    input.ownedWeapons.push({ ...createValidOwnedWeapon(ownedWeaponId('owned.foundation.unrelated')), id: ownedWeaponId('owned.foundation.unrelated') })
    input.ownedWeapons[0].name = 'Renamed only'
    input.ownedWeapons[0].memo = 'Changed only'
    input.ownedWeapons[0].updatedAt = '2026-08-30T00:00:00.000Z'
    expect(validatePlannerInput(input, dependencies).validBuildListEntries).toHaveLength(1)
  })

  it('uses current validity when persisted stale flags are obsolete', () => {
    const { input, dependencies } = fixture()
    input.buildListEntries[0].isStale = true
    input.buildListEntries[0].staleReasons = ['rng_state_changed']
    const result = validatePlannerInput(input, dependencies)
    expect(result.validBuildListEntries).toHaveLength(1)
    expect(result.excludedBuildListEntries).toEqual([])
    expect(result.warnings.some(({ kind }) => kind === 'build_list_entry_stale')).toBe(false)
  })

  it('excludes conversion and Reset-Skills routes when Skill prediction is unsupported', () => {
    const { input } = fixture()
    const normal = input.buildListEntries[0]
    normal.id = 'build-list.foundation.normal' as never
    normal.candidateSnapshot.route.operations = normal.candidateSnapshot.route.operations.slice(0, 2)
    synchronizeEntry(normal, input)
    const resetSkills = resetSkillsEntry(input)
    input.buildListEntries = [normal, resetSkills]
    const dependencies = { ...fixture().dependencies, rngEngine: createCandidateSearchEngine(
      { ...createCandidateSearchInput(), ownedWeapons: input.ownedWeapons },
      { skillSupported: false },
    ) }
    const result = validatePlannerInput(input, dependencies)
    expect(result.validBuildListEntries).toEqual([])
    expect(result.excludedBuildListEntries).toHaveLength(2)
    expect(result.warnings.some(({ kind }) => kind === 'rng_state_missing')).toBe(true)
  })

  it('rejects protected destructive routes but allows protected Reset Skills-only routes', () => {
    const destructive = fixture()
    const source = destructive.input.ownedWeapons[0]
    const entry = resetSkillsEntry(destructive.input)
    entry.candidateSnapshot.route = {
      kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: source.id,
      operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: source.id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }],
    }
    synchronizeEntry(entry, destructive.input)
    destructive.input.buildListEntries = [entry]
    expect(validatePlannerInput(destructive.input, destructive.dependencies).warnings[0].kind)
      .toBe('protected_weapon_required')

    const skills = fixture()
    skills.input.buildListEntries = [resetSkillsEntry(skills.input)]
    expect(validatePlannerInput(skills.input, skills.dependencies).validBuildListEntries).toHaveLength(1)
  })
})

describe('Planner Target Satisfaction', () => {
  it('uses only compatible Gogma weapons and evaluates actual Target conditions', () => {
    const { input } = fixture()
    const ideal: OwnedGogmaArtianWeapon = {
      ...(input.ownedWeapons[0] as OwnedGogmaArtianWeapon),
      groupSkillId: null,
      status: 'material',
      isProtected: false,
    }
    const normal: OwnedWeapon = {
      ...ideal,
      id: ownedWeaponId('owned.foundation.normal'),
      kind: 'normal',
      rarity: 8,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
    }
    const wrongStatus: OwnedGogmaArtianWeapon = {
      ...ideal,
      id: ownedWeaponId('owned.foundation.wrong'),
      restorationBonuses: belowPracticalBonuses(),
      status: 'ideal',
    }
    const satisfaction = deriveTargetSatisfaction(input.targetWeapons, [ideal, normal, wrongStatus], input.master)
    expect(satisfaction[0]).toMatchObject({ hasPractical: true, hasIdeal: true, practicalOwnedWeaponIds: [ideal.id], idealOwnedWeaponIds: [ideal.id] })
  })

  it('creates deterministic IDs, skips disabled Targets, and detects all-Ideal completion', () => {
    const { input } = fixture()
    const first = { ...input.ownedWeapons[0], id: ownedWeaponId('owned.foundation.z'), groupSkillId: null }
    const second = { ...input.ownedWeapons[0], id: ownedWeaponId('owned.foundation.a'), groupSkillId: null }
    const satisfaction = deriveTargetSatisfaction(input.targetWeapons, [first, second], input.master)
    expect(satisfaction[0].practicalOwnedWeaponIds).toEqual([second.id, first.id])
    expect(areAllEnabledTargetsAlreadySatisfied(satisfaction)).toBe(true)
    input.targetWeapons[0].isEnabled = false
    expect(deriveTargetSatisfaction(input.targetWeapons, [first], input.master)).toEqual([])
  })
})

describe('Planner simulated inventory', () => {
  it('deep-copies inventory and only consumes unprotected Material Gogma once', () => {
    const material = { ...createValidOwnedWeapon(), status: 'material' as const, isProtected: false }
    const initial = createSimulatedInventory([material])
    expect(initial.inventory?.ownedWeapons[0]).not.toBe(material)
    const consumed = consumeMaterialWeapon(initial.inventory!, material.id)
    expect(consumed.inventory).toMatchObject({ ownedWeapons: [], consumedWeaponIds: [material.id] })
    expect(consumeMaterialWeapon(consumed.inventory!, material.id).isValid).toBe(false)
    expect(consumeMaterialWeapon(createSimulatedInventory([{ ...material, isProtected: true }]).inventory!, material.id).isValid).toBe(false)
    expect(consumeMaterialWeapon(createSimulatedInventory([{ ...material, status: 'practical' }]).inventory!, material.id).isValid).toBe(false)
  })

  it('consumes owned Normal conversion sources without registering or reusing Gogma IDs', () => {
    const normal = { ...createValidOwnedWeapon(), kind: 'normal' as const, rarity: 8 as const, seriesSkillId: null, groupSkillId: null, status: null, isProtected: false }
    const initial = createSimulatedInventory([normal]).inventory!
    const converted = consumeOwnedNormalForConversion(initial, normal.id)
    expect(converted.inventory).toMatchObject({ ownedWeapons: [], consumedWeaponIds: [normal.id] })
    expect(consumeOwnedNormalForConversion(converted.inventory!, normal.id).isValid).toBe(false)
    expect(consumeOwnedNormalForConversion(createSimulatedInventory([{ ...normal, isProtected: true }]).inventory!, normal.id).isValid).toBe(false)
    expect(reserveWeaponId(converted.inventory!, normal.id).isValid).toBe(false)
  })

  it('requires reservation before registration and recognizes protected-source rules', () => {
    const futureId = ownedWeaponId('owned.foundation.future')
    const base = createSimulatedInventory([]).inventory!
    const material = { ...createValidOwnedWeapon(futureId), id: futureId, status: 'material' as const, isProtected: false }
    expect(addRegisteredWeapon(base, material).isValid).toBe(false)
    const reserved = reserveWeaponId(base, futureId).inventory!
    expect(reserved.ownedWeapons).toEqual([])
    const registered = addRegisteredWeapon(reserved, material).inventory!
    expect(registered.reservedWeaponIds).toEqual([])
    expect(registered.createdWeaponIds).toEqual([futureId])
    expect(consumeMaterialWeapon(registered, futureId).isValid).toBe(true)
    const protectedGogma = { ...material, isProtected: true }
    expect(canUseAsDestructiveGogmaSource(protectedGogma)).toBe(false)
    expect(canUseAsResetSkillsSource(protectedGogma)).toBe(true)
  })

  it('allows same-kind updates but rejects a Normal ID becoming Gogma', () => {
    const normal = {
      ...createValidOwnedWeapon(), kind: 'normal' as const, rarity: 8 as const,
      seriesSkillId: null, groupSkillId: null, status: null, isProtected: false,
    }
    const inventory = createSimulatedInventory([normal]).inventory!
    expect(updateOwnedWeapon(inventory, { ...normal, name: 'Updated' }).isValid).toBe(true)
    const gogma = {
      ...createValidOwnedWeapon(normal.id), id: normal.id, kind: 'gogma' as const,
    }
    expect(updateOwnedWeapon(inventory, gogma).isValid).toBe(false)
  })
})

describe('Planner initial search state', () => {
  it('uses validated entries, derives independent initial state, and does not alter candidate material IDs', () => {
    const { input, dependencies } = fixture()
    const routeBefore = structuredClone(input.buildListEntries[0].candidateSnapshot.route)
    const validation = validatePlannerInput(input, dependencies)
    const initial = createInitialPlannerSearchState(input, validation.validBuildListEntries)
    expect(initial.state).toMatchObject({ selectedBuildListEntryIds: [], totalCost: 0, evaluationScore: 0 })
    expect(initial.state).not.toHaveProperty('steps')
    expect(initial.state?.targetSatisfaction).toEqual({
      [input.targetWeapons[0].id]: { hasPractical: true, hasIdeal: true },
    })
    expect(initial.state?.routeProgressByEntryId).toEqual({ [input.buildListEntries[0].id]: 0 })
    expect(initial.state?.simulatedInventory.ownedWeapons[0]).not.toBe(input.ownedWeapons[0])
    expect(input.buildListEntries[0].candidateSnapshot.route).toEqual(routeBefore)
    expect(createInitialPlannerSearchState(input, validation.validBuildListEntries)).toEqual(initial)
  })

  it('returns the existing all-targets-satisfied warning without creating a Plan', () => {
    const { input, dependencies } = fixture()
    input.ownedWeapons[0].groupSkillId = null
    const validation = validatePlannerInput(input, dependencies)
    expect(createInitialPlannerSearchState(input, validation.validBuildListEntries).warnings)
      .toEqual([expect.objectContaining({ kind: 'all_targets_already_satisfied' })])
  })
})
