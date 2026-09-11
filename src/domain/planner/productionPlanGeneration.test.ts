import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
} from '../models/publicTypes'
import { createTargetDefinitionHash } from '../buildList'
import { completedPlannerTermination } from '../../test/fixtures/plannerTermination'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import {
  buildListEntryId,
  candidateId,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  type CandidateSearchFixtureOptions,
} from '../../test/fixtures/candidateSearch'
import {
  collectRequiredMaterials,
  createPlanStepsFromDrafts,
  createPlanningBuildListEntriesHash,
  createPlanningInputSnapshot,
  createPlanningTargetWeaponsHash,
  createProductionPlan,
  createRejectedBuildListEntries,
  PlannerPlanGenerationError,
} from './productionPlanGeneration'
import { defaultPlannerOptions, type PlannerBeamSearchResult, type PlannerDependencies, type PlannerInput } from './plannerTypes'

function fixture(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const searchInput = createCandidateSearchInput()
  const entry = createValidBuildListEntry()
  entry.calculationContext = structuredClone(searchInput.calculationContext)
  entry.candidateSnapshot.calculationContext = structuredClone(searchInput.calculationContext)
  entry.targetDefinitionHash = createTargetDefinitionHash(searchInput.targetWeapons[0])
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    searchInput.rngState,
    searchInput.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    [],
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash = entry.referencedOwnedWeaponsHash
  let planCount = 0
  let stepCount = 0
  let ownedCount = 0
  return {
    input: {
      rngState: structuredClone(searchInput.rngState),
      normalCounters: structuredClone(searchInput.normalCounters),
      ownedWeapons: [],
      targetWeapons: structuredClone(searchInput.targetWeapons),
      buildListEntries: [entry],
      calculationContext: structuredClone(searchInput.calculationContext),
      options: { ...defaultPlannerOptions },
      master: structuredClone(searchInput.master),
      conflictResolutions: [],
    },
    dependencies: {
      rngEngine: createCandidateSearchEngine(searchInput),
      idFactory: {
        productionPlanId: () => `plan.fixed.${++planCount}` as never,
        planStepId: () => `step.fixed.${++stepCount}` as never,
        ownedWeaponId: () => `owned.fixed.${++ownedCount}` as never,
      },
      clock: { now: () => '2026-08-30T00:00:00.000Z' },
    },
  }
}

function synchronizeEntry(input: PlannerInput) {
  const entry = input.buildListEntries[0]
  entry.targetDefinitionHash = createTargetDefinitionHash(input.targetWeapons[0])
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
/**
 * Two Targets whose Entries run the same physical operation on one shared
 * OwnedWeapon source, so Beam Search progresses both Entries with one action.
 */
function sharedSourceFixture(
  routeFor: (source: OwnedGogmaArtianWeapon) => BuildRoute,
  applyResult: (entry: BuildListEntry, source: OwnedGogmaArtianWeapon) => void,
  engineOptions: CandidateSearchFixtureOptions = {},
): { input: PlannerInput; dependencies: PlannerDependencies } {
  const { input, dependencies } = fixture()
  const source = createValidOwnedWeapon(ownedWeaponId('owned.shared.source'))
  source.isProtected = false
  source.groupSkillId = null
  source.restorationBonuses = [
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
  ]
  input.ownedWeapons = [source]
  dependencies.rngEngine = createCandidateSearchEngine(
    createCandidateSearchInput(),
    engineOptions,
  )
  const secondTarget = {
    ...structuredClone(input.targetWeapons[0]),
    id: targetWeaponId('target.shared.second'),
  }
  input.targetWeapons = [input.targetWeapons[0], secondTarget]
  const secondEntry = structuredClone(input.buildListEntries[0])
  secondEntry.id = buildListEntryId('build-list.shared.second')
  secondEntry.candidateId = candidateId('candidate.shared.second')
  secondEntry.candidateSnapshot.id = secondEntry.candidateId
  secondEntry.targetWeaponId = secondTarget.id
  secondEntry.candidateSnapshot.targetWeaponId = secondTarget.id
  input.buildListEntries = [input.buildListEntries[0], secondEntry]
  input.buildListEntries.forEach((entry) => {
    entry.candidateSnapshot.route = structuredClone(routeFor(source))
    applyResult(entry, source)
    const targetWeapon = input.targetWeapons.find(({ id }) => id === entry.targetWeaponId)
    if (!targetWeapon) throw new Error('Fixture Target is missing.')
    entry.targetDefinitionHash = createTargetDefinitionHash(targetWeapon)
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
  })
  return { input, dependencies }
}

describe('Production plan generation', () => {
  it('replays a new Normal route into ordered PlanSteps without regenerating its reserved weapon ID', async () => {
    const { input, dependencies } = fixture()
    const before = structuredClone(input)
    const result = await createProductionPlan(input, dependencies)
    const plan = result.plan
    expect(plan).not.toBeNull()
    expect(plan?.id).toBe('plan.fixed.1')
    expect(plan?.status).toBe('draft')
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_skills',
      'reserve_weapon',
    ])
    expect(plan?.steps.map(({ order }) => order)).toEqual([1, 2, 3, 4])
    expect(plan?.steps.map(({ id }) => id)).toEqual([
      'step.fixed.1', 'step.fixed.2', 'step.fixed.3', 'step.fixed.4',
    ])
    expect(plan?.currentStepId).toBe('step.fixed.1')
    expect(plan?.steps.every((step) => step.requiresUserConfirmation)).toBe(true)
    expect(plan?.steps.every((step) => !step.isCompleted && step.completedAt === null)).toBe(true)
    expect(plan?.steps[3].ownedWeaponId).toBe('owned.fixed.1')
    expect(plan?.steps[3].inventoryChange?.addOwnedWeapon?.id).toBe('owned.fixed.1')
    expect(plan?.steps[0].expectedStateBefore).toEqual(plan?.baseSnapshot.initialExecutionState)
    plan?.steps.slice(0, -1).forEach((step, index) => {
      expect(step.expectedStateAfter).toEqual(plan.steps[index + 1].expectedStateBefore)
    })
    expect(plan?.steps.every(({ title, instruction }) => title.length > 0 && instruction.length > 0)).toBe(true)
    expect(plan?.steps.some(({ title, instruction }) => /ボタン|画面|座標/.test(title + instruction))).toBe(false)
    expect(input).toEqual(before)
  })

  it('replays owned Normal conversion by removing the source once and reserving a different Gogma ID', async () => {
    const { input, dependencies } = fixture()
    const source = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.normal.source')),
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      restorationBonusScope: 'normal_artian' as const,
      isProtected: false,
    }
    input.ownedWeapons = [source]
    const entry = input.buildListEntries[0]
    entry.candidateSnapshot.route = {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'convert_normal_to_gogma',
        weaponTypeId: source.weaponTypeId,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }],
    }
    entry.candidateSnapshot.restorationBonusScope = 'normal_artian'
    entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'
    entry.candidateSnapshot.groupSkillId = null
    synchronizeEntry(input)
    const plan = (await createProductionPlan(input, dependencies)).plan
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'convert_normal_to_gogma', 'reserve_weapon',
    ])
    expect(plan?.steps[0].inventoryChange?.removeOwnedWeaponIds).toEqual([source.id])
    expect(plan?.steps[1].inventoryChange?.removeOwnedWeaponIds).toEqual([])
    expect(plan?.steps[1].inventoryChange?.addOwnedWeapon?.id).not.toBe(source.id)
    expect(plan?.steps.every(({ buildListEntryId }) => buildListEntryId === entry.id)).toBe(true)
  })

  it('replays existing Reset Bonuses as a persistent update only at reserve', async () => {
    const { input, dependencies } = fixture()
    const source = createValidOwnedWeapon(ownedWeaponId('owned.reset.source'))
    source.isProtected = false
    source.groupSkillId = null
    source.restorationBonuses = [
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    ]
    input.ownedWeapons = [source]
    dependencies.rngEngine = createCandidateSearchEngine(createCandidateSearchInput(), {
      resetResult: createValidOwnedWeapon().restorationBonuses,
    })
    const entry = input.buildListEntries[0]
    entry.candidateSnapshot.route = {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'reset_bonuses',
        sourceOwnedWeaponId: source.id,
        gogmaCounterBefore: 10,
        gogmaCounterAfter: 11,
      }],
    }
    entry.candidateSnapshot.finalBonuses = structuredClone(createValidOwnedWeapon().restorationBonuses)
    entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    entry.candidateSnapshot.seriesSkillId = source.seriesSkillId
    entry.candidateSnapshot.groupSkillId = source.groupSkillId
    synchronizeEntry(input)
    const plan = (await createProductionPlan(input, dependencies)).plan
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_bonuses', 'reserve_weapon',
    ])
    expect(plan?.steps[0].inventoryChange).toBeNull()
    expect(plan?.steps[1].ownedWeaponId).toBe(source.id)
    expect(plan?.steps[1].inventoryChange?.updateOwnedWeapons[0]?.id).toBe(source.id)
  })

  it('replays existing Keep Bonuses once and does not update inventory before reserve', async () => {
    const { input, dependencies } = fixture()
    const source = createValidOwnedWeapon(ownedWeaponId('owned.keep.source'))
    source.isProtected = false
    source.groupSkillId = null
    source.restorationBonuses = [
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
      { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    ]
    input.ownedWeapons = [source]
    const keepFixtureInput = createCandidateSearchInput()
    keepFixtureInput.ownedWeapons[0].restorationBonuses = structuredClone(
      source.restorationBonuses,
    )
    dependencies.rngEngine = createCandidateSearchEngine(keepFixtureInput, {
      keepSupported: true,
    })
    const entry = input.buildListEntries[0]
    entry.candidateSnapshot.route = {
      kind: 'existing_gogma_keep_bonuses',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'keep_bonuses',
        sourceOwnedWeaponId: source.id,
        gogmaCounterBefore: 10,
        gogmaCounterAfter: 11,
      }],
    }
    entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    entry.candidateSnapshot.seriesSkillId = source.seriesSkillId
    entry.candidateSnapshot.groupSkillId = source.groupSkillId
    synchronizeEntry(input)
    const plan = (await createProductionPlan(input, dependencies)).plan
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'keep_bonuses', 'reserve_weapon',
    ])
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[0].inventoryChange).toBeNull()
    expect(plan?.steps[1].inventoryChange?.updateOwnedWeapons[0]?.id).toBe(source.id)
  })

  it('allows protected existing Gogma Reset Skills and preserves bonuses until same-ID reserve', async () => {
    const { input, dependencies } = fixture()
    const source = createValidOwnedWeapon(ownedWeaponId('owned.skills.source'))
    source.isProtected = true
    source.seriesSkillId = null
    source.groupSkillId = null
    input.ownedWeapons = [source]
    const entry = input.buildListEntries[0]
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
    entry.candidateSnapshot.category = 'ideal'
    entry.candidateSnapshot.isSimilarToIdeal = false
    entry.candidateSnapshot.similarityScore = null
    entry.candidateSnapshot.finalBonuses = structuredClone(source.restorationBonuses)
    entry.candidateSnapshot.restorationBonusScope = source.restorationBonusScope
    entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'
    entry.candidateSnapshot.groupSkillId = null
    synchronizeEntry(input)
    const plan = (await createProductionPlan(input, dependencies)).plan
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'reset_skills', 'reserve_weapon',
    ])
    expect(plan?.steps[0].expectedResult?.restorationBonuses).toEqual(source.restorationBonuses)
    expect(plan?.steps[0].inventoryChange).toBeNull()
    expect(plan?.steps[1].inventoryChange?.updateOwnedWeapons[0]?.id).toBe(source.id)
  })
  it('does not reject in-progress or undecided Entries in a partial Plan', async () => {
    const { input, dependencies } = fixture()
    const undecided = structuredClone(input.buildListEntries[0])
    undecided.id = buildListEntryId('build-list.fixture.undecided')
    input.buildListEntries.push(undecided)
    input.options.maxPlanSteps = 1
    const result = await createProductionPlan(input, dependencies)
    const plan = result.plan
    expect(plan?.steps).toHaveLength(1)
    expect(plan?.steps[0].operationType).toBe('create_normal_artian')
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_steps_reached')
    const rejectedIds = plan?.rejectedBuildListEntries.map(({ buildListEntryId }) => buildListEntryId) ?? []
    expect(rejectedIds).not.toContain(plan?.steps[0].buildListEntryId)
    expect(rejectedIds).not.toContain(undecided.id)
  })

  it('returns no Plan and consumes no finalization IDs or clock value when Beam Search is cancelled', async () => {
    const { input, dependencies } = fixture()
    let clockCalls = 0
    let planIdCalls = 0
    let stepIdCalls = 0
    const result = await createProductionPlan(input, {
      ...dependencies,
      idFactory: {
        ...dependencies.idFactory,
        productionPlanId: () => `plan.cancelled.${++planIdCalls}` as never,
        planStepId: () => `step.cancelled.${++stepIdCalls}` as never,
      },
      clock: { now: () => {
        clockCalls += 1
        return '2026-08-30T00:00:00.000Z'
      } },
    }, { shouldCancel: () => true })
    expect(result.plan).toBeNull()
    expect(clockCalls).toBe(0)
    expect(planIdCalls).toBe(0)
    expect(stepIdCalls).toBe(0)
  })

  it('does not create an empty Plan when enabled targets are already ideal', async () => {
    const { input, dependencies } = fixture()
    const owned = createValidOwnedWeapon(ownedWeaponId('owned.already-ideal'))
    owned.groupSkillId = null
    input.ownedWeapons = [owned]
    const result = await createProductionPlan(input, dependencies)
    expect(result.plan).toBeNull()
    expect(result.warnings.map(({ kind }) => kind)).toContain('all_targets_already_satisfied')
  })

  it('creates stable snapshots excluding presentation-only data and stale flags', () => {
    const { input } = fixture()
    const targetsHash = createPlanningTargetWeaponsHash(input.targetWeapons)
    const entriesHash = createPlanningBuildListEntriesHash(input.buildListEntries)
    const presentationOnly = structuredClone(input)
    presentationOnly.targetWeapons[0].memo = 'changed only for display'
    presentationOnly.targetWeapons[0].updatedAt = '2026-09-01T00:00:00.000Z'
    presentationOnly.buildListEntries[0].isStale = true
    presentationOnly.buildListEntries[0].staleReasons = ['rng_state_changed']
    presentationOnly.buildListEntries[0].createdAt = '2026-09-01T00:00:00.000Z'
    presentationOnly.buildListEntries[0].candidateSnapshot.createdAt = '2026-09-01T00:00:00.000Z'
    expect(createPlanningTargetWeaponsHash(presentationOnly.targetWeapons)).toBe(targetsHash)
    expect(createPlanningBuildListEntriesHash(presentationOnly.buildListEntries)).toBe(entriesHash)
    const semantic = structuredClone(input)
    semantic.targetWeapons[0].priority = 5
    semantic.buildListEntries[0].candidateSnapshot.requiredMaterials = [{
      materialId: 'material.fixture.a', quantity: 2,
    }]
    expect(createPlanningTargetWeaponsHash(semantic.targetWeapons)).not.toBe(targetsHash)
    expect(createPlanningBuildListEntriesHash(semantic.buildListEntries)).not.toBe(entriesHash)
    const snapshot = createPlanningInputSnapshot(input, '2026-08-30T00:00:00.000Z')
    expect(snapshot).toMatchObject({
      targetWeaponsHash: targetsHash,
      buildListEntriesHash: entriesHash,
      calculationContext: input.calculationContext,
      createdAt: '2026-08-30T00:00:00.000Z',
    })
  })

  it('normalizes BuildList candidate semantic hashes without tracking or display-only fields', () => {
    const { input } = fixture()
    input.buildListEntries[0].candidateSnapshot.requiredMaterials = [
      { materialId: 'material.fixture.b', quantity: 2 },
      { materialId: 'material.fixture.a', quantity: 1 },
    ]
    const base = createPlanningBuildListEntriesHash(input.buildListEntries)
    const unchanged = structuredClone(input)
    unchanged.buildListEntries[0].candidateSnapshot.id = 'candidate.changed' as never
    unchanged.buildListEntries[0].candidateSnapshot.searchRunId = 'search-run.changed'
    unchanged.buildListEntries[0].candidateSnapshot.createdAt = '2026-09-01T00:00:00.000Z'
    unchanged.buildListEntries[0].candidateSnapshot.finalBonuses = [
      unchanged.buildListEntries[0].candidateSnapshot.finalBonuses[1],
      unchanged.buildListEntries[0].candidateSnapshot.finalBonuses[0],
      ...unchanged.buildListEntries[0].candidateSnapshot.finalBonuses.slice(2),
    ] as never
    unchanged.buildListEntries[0].candidateSnapshot.requiredMaterials.reverse()
    unchanged.buildListEntries[0].candidateSnapshot.idealDifference.summary = 'display-only change'
    expect(createPlanningBuildListEntriesHash(unchanged.buildListEntries)).toBe(base)

    const expectChanged = (mutate: (value: PlannerInput) => void) => {
      const changed = structuredClone(input)
      mutate(changed)
      expect(createPlanningBuildListEntriesHash(changed.buildListEntries)).not.toBe(base)
    }
    expectChanged((value) => {
      value.buildListEntries[0].candidateSnapshot.finalBonuses[0].bonusRankId = 'bonus_rank.fixture.low'
    })
    expectChanged((value) => {
      const operation = value.buildListEntries[0].candidateSnapshot.route.operations[0]
      if (operation.type !== 'create_normal_artian') throw new Error('Fixture route changed.')
      operation.count = 2
    })
    expectChanged((value) => { value.buildListEntries[0].candidateSnapshot.category = 'ideal' })
    expectChanged((value) => { value.buildListEntries[0].candidateSnapshot.requiredMaterials[0].quantity = 3 })
    expectChanged((value) => { value.buildListEntries[0].searchStateHash = 'hash.changed.search' })
    expectChanged((value) => { value.buildListEntries[0].referencedOwnedWeaponsHash = 'hash.changed.owned' })
    expectChanged((value) => { value.buildListEntries[0].calculationContext.appSchemaVersion = 2 })
    expectChanged((value) => {
      value.buildListEntries[0].candidateSnapshot.restorationBonusScope = 'gogma_artian'
    })
  })
  it('keeps deterministic Plan IDs, timestamps, selected IDs, and required material totals', async () => {
    const first = fixture()
    const second = fixture()
    const firstResult = await createProductionPlan(first.input, first.dependencies)
    const secondResult = await createProductionPlan(second.input, second.dependencies)
    expect(secondResult).toEqual(firstResult)
    const materialEntry = structuredClone(first.input.buildListEntries[0])
    materialEntry.id = buildListEntryId('build-list.fixture.material')
    materialEntry.candidateSnapshot.requiredMaterials = [{ materialId: 'material.fixture.a', quantity: 2 }]
    expect(collectRequiredMaterials({ ...first.input, buildListEntries: [first.input.buildListEntries[0], materialEntry] }, [first.input.buildListEntries[0].id, materialEntry.id])).toEqual([
      { materialId: 'material.fixture.a', quantity: 3 },
    ])
  })

  it('rejects an unselected Entry traced only through a shared complete action', () => {
    const { input } = fixture()
    const selectedEntry = structuredClone(input.buildListEntries[0])
    selectedEntry.id = buildListEntryId('build-list.fixture.shared.selected')
    const progressedEntry = structuredClone(input.buildListEntries[0])
    progressedEntry.id = buildListEntryId('build-list.fixture.shared.progressed')
    const beamResult = {
      bestState: {
        trace: [{
          primaryBuildListEntryId: selectedEntry.id,
          progressedBuildListEntryIds: [selectedEntry.id, progressedEntry.id],
        }],
      } as never,
      conflicts: [],
      warnings: [],
      validationIssues: [],
      excludedBuildListEntries: [],
      rejections: [],
      expandedStates: 1,
      completed: true,
      cancelled: false,
      termination: completedPlannerTermination({ expandedStates: 1 }),
    } satisfies PlannerBeamSearchResult
    expect(createRejectedBuildListEntries(
      { ...input, buildListEntries: [selectedEntry, progressedEntry] },
      beamResult,
      [selectedEntry.id],
    )).toEqual([
      expect.objectContaining({
        buildListEntryId: progressedEntry.id,
        reason: 'dominated_by_better_candidate',
      }),
    ])
  })
  it('uses only proven rejection classifications and retains the fallback without pairwise inference', () => {
    const { input } = fixture()
    const protectedEntry = structuredClone(input.buildListEntries[0])
    protectedEntry.id = buildListEntryId('build-list.fixture.protected')
    const fallbackEntry = structuredClone(input.buildListEntries[0])
    fallbackEntry.id = buildListEntryId('build-list.fixture.fallback')
    const unprovenEntry = structuredClone(input.buildListEntries[0])
    unprovenEntry.id = buildListEntryId('build-list.fixture.unproven')
    const selectedEntry = structuredClone(input.buildListEntries[0])
    selectedEntry.id = buildListEntryId('build-list.fixture.selected')
    const beamResult = {
      bestState: null,
      conflicts: [{
        id: 'conflict.fixture',
        kind: 'same_gogma_counter' as const,
        buildListEntryIds: [selectedEntry.id, fallbackEntry.id],
        reason: 'same physical operation',
        recommendedBuildListEntryId: selectedEntry.id,
        selectedBuildListEntryId: selectedEntry.id,
        resolutionNote: null,
      }],
      warnings: [],
      validationIssues: [],
      excludedBuildListEntries: [],
      rejections: [{
        buildListEntryId: protectedEntry.id,
        actionType: 'reset_bonuses' as const,
        reason: 'protected_destructive_use' as const,
        detail: 'protected',
      }],
      expandedStates: 0,
      completed: true,
      cancelled: false,
      termination: completedPlannerTermination(),
    } satisfies PlannerBeamSearchResult
    const rejected = createRejectedBuildListEntries(
      { ...input, buildListEntries: [selectedEntry, protectedEntry, fallbackEntry, unprovenEntry] },
      beamResult,
      [selectedEntry.id],
    )
    expect(rejected).toEqual([
      expect.objectContaining({ buildListEntryId: fallbackEntry.id, reason: 'resource_conflict' }),
      expect.objectContaining({ buildListEntryId: protectedEntry.id, reason: 'requires_protected_weapon' }),
      expect.objectContaining({ buildListEntryId: unprovenEntry.id, reason: 'dominated_by_better_candidate' }),
    ])
  })

  it('records the progressed Target on every newly generated single-Target PlanStep', async () => {
    const { input, dependencies } = fixture()
    const targetId = input.targetWeapons[0].id
    const plan = (await createProductionPlan(input, dependencies)).plan
    expect(plan?.steps.every(
      ({ progressedTargetWeaponIds }) => progressedTargetWeaponIds !== undefined,
    )).toBe(true)
    expect(plan?.steps.map(({ progressedTargetWeaponIds }) => progressedTargetWeaponIds))
      .toEqual([[targetId], [targetId], [targetId], [targetId]])
    expect(plan?.steps.every(({ targetWeaponId }) => targetWeaponId === targetId)).toBe(true)
  })

  it('records both Targets progressed by one shared physical Reset Bonuses Step', async () => {
    const { input, dependencies } = sharedSourceFixture(
      (source) => ({
        kind: 'existing_gogma_reset_bonuses',
        sourceOwnedWeaponId: source.id,
        operations: [{
          type: 'reset_bonuses',
          sourceOwnedWeaponId: source.id,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        }],
      }),
      (entry, source) => {
        entry.candidateSnapshot.finalBonuses =
          structuredClone(createValidOwnedWeapon().restorationBonuses)
        entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
        entry.candidateSnapshot.seriesSkillId = source.seriesSkillId
        entry.candidateSnapshot.groupSkillId = source.groupSkillId
      },
      { resetResult: createValidOwnedWeapon().restorationBonuses },
    )
    const [firstTarget, secondTarget] = input.targetWeapons
    const plan = (await createProductionPlan(input, dependencies)).plan
    const shared = plan?.steps.find(({ operationType }) => operationType === 'reset_bonuses')
    expect(shared?.progressedTargetWeaponIds).toEqual([firstTarget.id, secondTarget.id])
    expect(shared?.targetWeaponId).toBe(firstTarget.id)
    expect(shared?.buildListEntryId).toBe(input.buildListEntries[0].id)
    expect(plan?.steps.every(
      ({ progressedTargetWeaponIds }) => progressedTargetWeaponIds !== undefined,
    )).toBe(true)
  })

  it('records both Targets progressed by one shared physical Reset Skills Step', async () => {
    const { input, dependencies } = sharedSourceFixture(
      (source) => ({
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: source.id,
        operations: [{
          type: 'reset_skills',
          sourceOwnedWeaponId: source.id,
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        }],
      }),
      (entry, source) => {
        entry.candidateSnapshot.finalBonuses = structuredClone(source.restorationBonuses)
        entry.candidateSnapshot.restorationBonusScope = source.restorationBonusScope
        entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'
        entry.candidateSnapshot.groupSkillId = null
      },
    )
    const [firstTarget, secondTarget] = input.targetWeapons
    const plan = (await createProductionPlan(input, dependencies)).plan
    const shared = plan?.steps.find(({ operationType }) => operationType === 'reset_skills')
    expect(shared?.progressedTargetWeaponIds).toEqual([firstTarget.id, secondTarget.id])
    expect(shared?.targetWeaponId).toBe(firstTarget.id)
  })

  it('fails closed when a Draft progresses an unknown BuildListEntry', () => {
    const { input, dependencies } = fixture()
    const draft = {
      operationType: 'reset_skills' as const,
      primaryBuildListEntryId: input.buildListEntries[0].id,
      progressedBuildListEntryIds: [
        input.buildListEntries[0].id,
        buildListEntryId('build-list.fixture.missing'),
      ],
      targetWeaponId: input.targetWeapons[0].id,
      candidateId: input.buildListEntries[0].candidateId,
      ownedWeaponId: null,
      expectedResult: null,
      expectedStateBefore: {
        rngStateHash: 'hash.a', normalCountersHash: 'hash.b', ownedWeaponsHash: 'hash.c',
      },
      expectedStateAfter: {
        rngStateHash: 'hash.a', normalCountersHash: 'hash.b', ownedWeaponsHash: 'hash.c',
      },
      inventoryChange: null,
      rngAdvance: {
        gogmaCounterDelta: 0,
        skillCounterDelta: 1,
        normalCounterDelta: null,
        affectedNormalCounterId: null,
      },
      debug: null,
      isBlindNormalCreation: false,
    }
    expect(() => createPlanStepsFromDrafts(
      [draft],
      input,
      dependencies,
      draft.expectedStateBefore,
    )).toThrow(PlannerPlanGenerationError)
  })
})
