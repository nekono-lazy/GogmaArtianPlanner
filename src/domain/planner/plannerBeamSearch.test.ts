import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  TargetWeapon,
} from '../models/publicTypes'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import { createTargetDefinitionHash } from '../buildList'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import {
  buildListEntryId,
  candidateId,
  createRestorationBonusSet,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  belowPracticalBonuses,
} from '../../test/fixtures/candidateSearch'
import { targetEvaluationMaster } from '../../test/fixtures/targetEvaluation'
import {
  createPlannerRouteUnitPlans,
  detectPlannerConflicts,
  runPlannerBeamSearch,
  scoreCandidate,
} from './index'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerSearchState,
} from './plannerTypes'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { validatePlannerInput } from './plannerValidation'

const ENGINE_VERSION = 'fake-fixture:planner-beam-v1'

function plannerEngine(): FakeRngEngine {
  const gogmaCounterAdvances: FakeRngFixtures['gogmaCounterAdvances'] = []
  const skillCounterAdvances: FakeRngFixtures['skillCounterAdvances'] = []
  const normalCounterAdvances: FakeRngFixtures['normalCounterAdvances'] = []
  for (let counter = 0; counter < 30; counter += 1) {
    gogmaCounterAdvances.push(
      {
        current: counter,
        operation: { type: 'create_gogma_from_normal' },
        result: counter + 1,
      },
      {
        current: counter,
        operation: { type: 'reset_bonuses' },
        result: counter + 1,
      },
    )
    skillCounterAdvances.push({
      current: counter,
      operation: { type: 'reset_skills' },
      result: counter + 1,
    })
    normalCounterAdvances.push({
      current: counter,
      operation: { type: 'create_normal_artian', count: 1 },
      result: counter + 1,
    })
  }
  return new FakeRngEngine({
    version: 'planner-beam-v1',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: false,
    },
    normalizedSeeds: [],
    gogmaPredictions: [],
    skillPredictions: [],
    normalArtianPredictions: [],
    keepSelections: [],
    gogmaCounterAdvances,
    skillCounterAdvances,
    normalCounterAdvances,
  })
}

function sourceWeapon(
  id: string,
  isProtected = false,
): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    id: ownedWeaponId(id),
    restorationBonuses: belowPracticalBonuses(),
    seriesSkillId: null,
    groupSkillId: null,
    status: 'material',
    isProtected,
    relatedTargetWeaponIds: [],
  }
}

function target(id: string, priority: TargetWeapon['priority'] = 3): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    priority,
  }
}

function routeEntry(
  id: string,
  targetWeapon: TargetWeapon,
  route: BuildRoute,
  category: 'ideal' | 'practical' = 'ideal',
): BuildListEntry {
  const entry = createValidBuildListEntry()
  entry.id = buildListEntryId(id)
  entry.candidateId = candidateId(`candidate.${id}`)
  entry.targetWeaponId = targetWeapon.id
  entry.candidateSnapshot.id = entry.candidateId
  entry.candidateSnapshot.targetWeaponId = targetWeapon.id
  entry.candidateSnapshot.route = structuredClone(route)
  entry.candidateSnapshot.category = category
  entry.candidateSnapshot.isSimilarToIdeal = false
  entry.candidateSnapshot.finalBonuses = createRestorationBonusSet()
  entry.candidateSnapshot.seriesSkillId =
    category === 'ideal' ? 'series_skill.fixture.a' : null
  entry.candidateSnapshot.groupSkillId = null
  entry.candidateSnapshot.estimatedOperationCount =
    route.operations.reduce(
      (total, operation) =>
        total + (operation.type === 'create_normal_artian' ? operation.count : 1),
      0,
    )
  entry.candidateSnapshot.estimatedGogmaAdvance =
    route.operations.filter((operation) =>
      ['convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses'].includes(
        operation.type,
      ),
    ).length
  entry.candidateSnapshot.estimatedSkillAdvance =
    route.operations.filter(({ type }) => type === 'reset_skills').length
  entry.candidateSnapshot.estimatedNormalAdvance =
    route.operations.some(({ type }) => type === 'create_normal_artian')
      ? route.operations
          .filter(({ type }) => type === 'create_normal_artian')
          .reduce(
            (total, operation) =>
              total +
              (operation.type === 'create_normal_artian'
                ? operation.normalCounterAfter - operation.normalCounterBefore
                : 0),
            0,
          )
      : null
  return entry
}

function synchronizeEntry(input: PlannerInput, entry: BuildListEntry) {
  const targetWeapon = input.targetWeapons.find(
    ({ id }) => id === entry.targetWeaponId,
  )
  if (!targetWeapon) throw new Error('Fixture Target is missing.')
  entry.calculationContext = { ...input.calculationContext }
  entry.candidateSnapshot.calculationContext = { ...input.calculationContext }
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
  entry.candidateSnapshot.referencedOwnedWeaponsHash =
    entry.referencedOwnedWeaponsHash
}

function fixture(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[] = [],
): { input: PlannerInput; dependencies: PlannerDependencies } {
  const rngState = createValidRngState()
  rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  const input: PlannerInput = {
    rngState,
    normalCounters: [
      createValidNormalArtianCounter(),
      {
        ...createValidNormalArtianCounter(),
        id: 'weapon.fixture.b:8',
        weaponTypeId: 'weapon.fixture.b',
        counter: 12,
      },
    ],
    ownedWeapons,
    targetWeapons: targets,
    buildListEntries: entries,
    calculationContext: {
      gameVersion: 'fixture-only',
      masterDataVersion: 1,
      rngEngineVersion: ENGINE_VERSION,
      appSchemaVersion: 1,
    },
    options: {
      maxPlanSteps: 300,
      beamWidth: 50,
      maxExpandedStates: 10_000,
    },
    master: {
      materialCosts: [],
      bonusRanks: targetEvaluationMaster.bonusRanks,
    },
    conflictResolutions: [],
  }
  entries.forEach((entry) => synchronizeEntry(input, entry))
  let weaponSequence = 0
  return {
    input,
    dependencies: {
      rngEngine: plannerEngine(),
      idFactory: {
        productionPlanId: () => 'plan.test' as never,
        planStepId: () => 'step.test' as never,
        ownedWeaponId: () =>
          ownedWeaponId(`owned.planner.created.${++weaponSequence}`),
      },
      clock: { now: () => '2026-08-29T00:00:00.000Z' },
    },
  }
}

function resetRoute(sourceId: string, counter = 10): BuildRoute {
  return {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [{
      type: 'reset_bonuses',
      sourceOwnedWeaponId: ownedWeaponId(sourceId),
      gogmaCounterBefore: counter,
      gogmaCounterAfter: counter + 1,
    }],
  }
}

describe('Planner Beam Search', () => {
  it('finishes one Candidate and updates satisfaction only at reserve', async () => {
    const goal = target('target.beam.single')
    const source = sourceWeapon('owned.beam.single')
    const entry = routeEntry(
      'entry.beam.single',
      goal,
      resetRoute(source.id),
    )
    const { input, dependencies } = fixture([goal], [entry], [source])
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.completed).toBe(true)
    expect(result.bestState?.trace.map(({ actionType }) => actionType)).toEqual([
      'reset_bonuses',
      'reserve_weapon',
    ])
    expect(result.bestState?.trace[0].satisfactionChanges).toEqual([])
    expect(result.bestState?.trace[1].satisfactionChanges).toHaveLength(1)
    expect(result.bestState?.targetSatisfaction[goal.id]).toEqual({
      hasPractical: true,
      hasIdeal: true,
    })
  })

  it('splits count operations without changing the Candidate snapshot', async () => {
    const goal = target('target.beam.count')
    const route: BuildRoute = {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 2,
          normalCounterBefore: 4,
          normalCounterAfter: 6,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        },
      ],
    }
    const entry = routeEntry('entry.beam.count', goal, route)
    const { input, dependencies } = fixture([goal], [entry])
    const snapshot = structuredClone(entry.candidateSnapshot.route)
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState?.trace.map(({ actionType }) => actionType)).toEqual([
      'create_normal_artian',
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reserve_weapon',
    ])
    expect(result.bestState?.trace.slice(0, 2).map((action) =>
      action.progressedRoutePositions[entry.id].unitIndex,
    )).toEqual([0, 1])
    expect(entry.candidateSnapshot.route).toEqual(snapshot)
    expect(entry.candidateSnapshot.route.operations[0]).toMatchObject({ count: 2 })
  })

  it('scores an uncovered Practical above an Ideal upgrade at equal priority', () => {
    const uncovered = target('target.score.uncovered')
    const upgrade = target('target.score.upgrade')
    const first = routeEntry(
      'entry.score.practical',
      uncovered,
      resetRoute('owned.score.first'),
      'practical',
    )
    const second = routeEntry(
      'entry.score.ideal',
      upgrade,
      resetRoute('owned.score.second'),
      'ideal',
    )
    const state = {
      targetSatisfaction: {
        [uncovered.id]: { hasPractical: false, hasIdeal: false },
        [upgrade.id]: { hasPractical: true, hasIdeal: false },
      },
    } as PlannerSearchState
    expect(scoreCandidate(state, uncovered, first).total).toBeGreaterThan(
      scoreCandidate(state, upgrade, second).total,
    )
  })

  it('shares one Gogma action only for the same physical source', async () => {
    const firstTarget = target('target.shared.gogma.first')
    const secondTarget = target('target.shared.gogma.second')
    const source = sourceWeapon('owned.shared.gogma')
    const first = routeEntry(
      'entry.shared.gogma.first',
      firstTarget,
      resetRoute(source.id),
    )
    const second = routeEntry(
      'entry.shared.gogma.second',
      secondTarget,
      resetRoute(source.id),
    )
    const { input, dependencies } = fixture(
      [firstTarget, secondTarget],
      [first, second],
      [source],
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    const sharedAction = result.bestState?.trace[0]
    expect(sharedAction?.actionType).toBe('reset_bonuses')
    expect(sharedAction?.progressedBuildListEntryIds).toEqual([
      first.id,
      second.id,
    ])
    expect(result.conflicts).toEqual([])
    expect(result.bestState?.currentRngState.gogmaCounter.value).toBe(11)
  })

  it('shares Skill progress for the same protected Reset Skills source', async () => {
    const firstTarget = target('target.shared.skill.first')
    const secondTarget = target('target.shared.skill.second')
    const source = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.shared.skill')),
      isProtected: true,
      status: 'practical' as const,
      seriesSkillId: null,
      relatedTargetWeaponIds: [],
    }
    const route = (entryTarget: TargetWeapon, id: string) =>
      routeEntry(id, entryTarget, {
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: source.id,
        operations: [{
          type: 'reset_skills',
          sourceOwnedWeaponId: source.id,
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        }],
      })
    const first = route(firstTarget, 'entry.shared.skill.first')
    const second = route(secondTarget, 'entry.shared.skill.second')
    const { input, dependencies } = fixture(
      [firstTarget, secondTarget],
      [first, second],
      [source],
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState?.trace[0]).toMatchObject({
      actionType: 'reset_skills',
      progressedBuildListEntryIds: [first.id, second.id],
    })
    expect(result.bestState?.currentRngState.skillCounter.value).toBe(8)
    expect(result.warnings.some(({ kind }) => kind === 'protected_weapon_required'))
      .toBe(false)
  })

  it('keeps Normal counters independent by weapon type', async () => {
    const firstTarget = target('target.normal.first', 5)
    const secondTarget = {
      ...target('target.normal.second', 1),
      weaponTypeId: 'weapon.fixture.b',
    }
    const first = routeEntry('entry.normal.first', firstTarget, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [{
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        count: 1,
        normalCounterBefore: 4,
        normalCounterAfter: 5,
      }],
    })
    const second = routeEntry('entry.normal.second', secondTarget, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [{
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.b',
        rarity: 8,
        count: 1,
        normalCounterBefore: 12,
        normalCounterAfter: 13,
      }],
    })
    const { input, dependencies } = fixture(
      [firstTarget, secondTarget],
      [first, second],
    )
    input.options.maxPlanSteps = 1
    input.options.beamWidth = 1
    const result = await runPlannerBeamSearch(input, dependencies)
    const counters = result.bestState?.currentNormalCounters
    expect(counters?.find(({ id }) => id === 'weapon.fixture.a:8')?.counter)
      .toBe(5)
    expect(counters?.find(({ id }) => id === 'weapon.fixture.b:8')?.counter)
      .toBe(12)
    expect(result.bestState?.routeProgressByEntryId[second.id]).toBe(0)
  })

  it('detects incompatible counter operations and applies a stable resolution', async () => {
    const firstTarget = target('target.conflict.first', 5)
    const secondTarget = target('target.conflict.second', 1)
    const firstSource = sourceWeapon('owned.conflict.first')
    const secondSource = sourceWeapon('owned.conflict.second')
    const first = routeEntry(
      'entry.conflict.first',
      firstTarget,
      resetRoute(firstSource.id),
    )
    const second = routeEntry(
      'entry.conflict.second',
      secondTarget,
      resetRoute(secondSource.id),
    )
    const base = fixture(
      [firstTarget, secondTarget],
      [first, second],
      [firstSource, secondSource],
    )
    const detected = await runPlannerBeamSearch(base.input, base.dependencies)
    expect(detected.conflicts).toHaveLength(1)
    expect(detected.conflicts[0]).toMatchObject({
      kind: 'same_gogma_counter',
      buildListEntryIds: [first.id, second.id],
      recommendedBuildListEntryId: first.id,
    })
    const key = detected.conflicts[0].id
    const resolved = fixture(
      [firstTarget, secondTarget],
      [structuredClone(first), structuredClone(second)],
      [firstSource, secondSource],
    )
    resolved.input.conflictResolutions = [{
      conflictKey: key,
      selectedBuildListEntryId: second.id,
    }]
    const result = await runPlannerBeamSearch(
      resolved.input,
      resolved.dependencies,
    )
    expect(result.conflicts[0].selectedBuildListEntryId).toBe(second.id)
    expect(result.bestState?.selectedBuildListEntryIds).toEqual([second.id])

    const thirdTarget = target('target.conflict.third')
    const thirdSource = sourceWeapon('owned.conflict.third')
    const third = routeEntry(
      'entry.conflict.third',
      thirdTarget,
      resetRoute(thirdSource.id, 11),
    )
    const nonParticipant = fixture(
      [firstTarget, secondTarget, thirdTarget],
      [structuredClone(first), structuredClone(second), third],
      [firstSource, secondSource, thirdSource],
    )
    nonParticipant.input.conflictResolutions = [{
      conflictKey: key,
      selectedBuildListEntryId: third.id,
    }]
    const nonParticipantResult = await runPlannerBeamSearch(
      nonParticipant.input,
      nonParticipant.dependencies,
    )
    expect(nonParticipantResult.warnings.some(
      ({ kind, message }) =>
        kind === 'invalid_conflict_resolution' &&
        message.includes('not a participant'),
    )).toBe(true)
  })

  it('warns when a resolution key is not rediscovered', async () => {
    const goal = target('target.resolution.invalid')
    const source = sourceWeapon('owned.resolution.invalid')
    const entry = routeEntry(
      'entry.resolution.invalid',
      goal,
      resetRoute(source.id),
    )
    const { input, dependencies } = fixture([goal], [entry], [source])
    input.conflictResolutions = [{
      conflictKey: 'missing-conflict-key',
      selectedBuildListEntryId: entry.id,
    }]
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.warnings.some(({ kind }) =>
      kind === 'invalid_conflict_resolution',
    )).toBe(true)
  })

  it('detects the same concrete material weapon without replacing its ID', () => {
    const firstTarget = target('target.material.first')
    const secondTarget = target('target.material.second')
    const materialId = ownedWeaponId('owned.material.concrete')
    const route = (sourceId: string): BuildRoute => ({
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: ownedWeaponId(sourceId),
      operations: [{ type: 'use_weapon_as_material', ownedWeaponId: materialId }],
    })
    const first = routeEntry(
      'entry.material.first',
      firstTarget,
      route('owned.material.source.first'),
    )
    const second = routeEntry(
      'entry.material.second',
      secondTarget,
      route('owned.material.source.second'),
    )
    const engine = plannerEngine()
    const plans = createPlannerRouteUnitPlans([first, second], engine)
    const state = {
      targetSatisfaction: {
        [firstTarget.id]: { hasPractical: false, hasIdeal: false },
        [secondTarget.id]: { hasPractical: false, hasIdeal: false },
      },
    } as PlannerSearchState
    const conflicts = detectPlannerConflicts(
      [first, second],
      plans.unitPlans,
      [firstTarget, secondTarget],
      state,
      [],
    )
    expect(conflicts.conflicts[0]).toMatchObject({
      kind: 'same_owned_weapon_consumed',
      buildListEntryIds: [first.id, second.id],
    })
    expect(first.candidateSnapshot.route.operations[0]).toEqual({
      type: 'use_weapon_as_material',
      ownedWeaponId: materialId,
    })
  })

  it('counts successors before beam pruning and enforces maxExpandedStates exactly', async () => {
    const firstTarget = target('target.bound.first')
    const secondTarget = target('target.bound.second')
    const firstSource = sourceWeapon('owned.bound.first')
    const secondSource = sourceWeapon('owned.bound.second')
    const first = routeEntry(
      'entry.bound.first',
      firstTarget,
      resetRoute(firstSource.id),
    )
    const second = routeEntry(
      'entry.bound.second',
      secondTarget,
      resetRoute(secondSource.id),
    )
    const { input, dependencies } = fixture(
      [firstTarget, secondTarget],
      [first, second],
      [firstSource, secondSource],
    )
    input.options.beamWidth = 1
    input.options.maxExpandedStates = 1
    const progress: number[] = []
    const result = await runPlannerBeamSearch(input, dependencies, {
      onProgress: ({ expandedStates }) => progress.push(expandedStates),
    })
    expect(result.expandedStates).toBe(1)
    expect(progress).toEqual([1])
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_expanded_states_reached',
    )
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'max_steps_reached',
    )
  })

  it('stops at maxPlanSteps without creating another action', async () => {
    const goal = target('target.step.bound')
    const source = sourceWeapon('owned.step.bound')
    const entry = routeEntry(
      'entry.step.bound',
      goal,
      resetRoute(source.id),
    )
    const { input, dependencies } = fixture([goal], [entry], [source])
    input.options.maxPlanSteps = 1
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState?.trace).toHaveLength(1)
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_steps_reached',
    )
    expect(result.warnings.map(({ kind }) => kind)).not.toContain(
      'max_expanded_states_reached',
    )
  })

  it('returns the best partial state when no complete state is reachable', async () => {
    const goal = target('target.partial')
    const source = sourceWeapon('owned.partial')
    const entry = routeEntry('entry.partial', goal, resetRoute(source.id))
    const { input, dependencies } = fixture([goal], [entry], [source])
    input.options.maxPlanSteps = 1
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.completed).toBe(false)
    expect(result.bestState).not.toBeNull()
    expect(result.bestState?.routeProgressByEntryId[entry.id]).toBe(1)
  })

  it('does no exploration when every enabled Target is already Ideal', async () => {
    const goal = target('target.already.ideal')
    const ideal = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.already.ideal')),
      relatedTargetWeaponIds: [goal.id],
    }
    const { input, dependencies } = fixture([goal], [], [ideal])
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.expandedStates).toBe(0)
    expect(result.completed).toBe(true)
    expect(result.bestState?.trace).toEqual([])
    expect(result.warnings.some(({ kind }) =>
      kind === 'all_targets_already_satisfied',
    )).toBe(true)
  })

  it('cancels safely after monotonic progress without mutating input', async () => {
    const goal = target('target.cancel')
    const source = sourceWeapon('owned.cancel')
    const entry = routeEntry('entry.cancel', goal, resetRoute(source.id))
    const { input, dependencies } = fixture([goal], [entry], [source])
    const before = structuredClone(input)
    let cancel = false
    const progress: number[] = []
    const result = await runPlannerBeamSearch(input, dependencies, {
      shouldCancel: () => cancel,
      onProgress: ({ expandedStates }) => {
        progress.push(expandedStates)
        cancel = true
      },
    })
    expect(result.cancelled).toBe(true)
    expect(result.expandedStates).toBe(1)
    expect(progress).toEqual([1])
    expect(input).toEqual(before)
  })

  it('is deterministic for the same input, fixture Engine, and options', async () => {
    const goal = target('target.deterministic')
    const source = sourceWeapon('owned.deterministic')
    const entry = routeEntry(
      'entry.deterministic',
      goal,
      resetRoute(source.id),
    )
    const first = fixture([goal], [entry], [source])
    const second = fixture(
      [structuredClone(goal)],
      [structuredClone(entry)],
      [structuredClone(source)],
    )
    const firstResult = await runPlannerBeamSearch(
      first.input,
      first.dependencies,
    )
    const secondResult = await runPlannerBeamSearch(
      second.input,
      second.dependencies,
    )
    expect(secondResult).toEqual(firstResult)
  })

  it('rejects protected destructive use but keeps protected Reset Skills executable', async () => {
    const destructiveTarget = target('target.protected.destructive')
    const protectedSource = sourceWeapon('owned.protected.source', true)
    const destructive = routeEntry(
      'entry.protected.destructive',
      destructiveTarget,
      resetRoute(protectedSource.id),
    )
    const blocked = fixture(
      [destructiveTarget],
      [destructive],
      [protectedSource],
    )
    const blockedResult = await runPlannerBeamSearch(
      blocked.input,
      blocked.dependencies,
    )
    expect(blockedResult.expandedStates).toBe(0)
    expect(blockedResult.warnings.some(({ kind }) =>
      kind === 'protected_weapon_required',
    )).toBe(true)

    const skillTarget = target('target.protected.skill')
    const practicalProtected = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.protected.skill')),
      isProtected: true,
      status: 'practical' as const,
      seriesSkillId: null,
      relatedTargetWeaponIds: [],
    }
    const skill = routeEntry('entry.protected.skill', skillTarget, {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: practicalProtected.id,
      operations: [{
        type: 'reset_skills',
        sourceOwnedWeaponId: practicalProtected.id,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }],
    })
    const allowed = fixture(
      [skillTarget],
      [skill],
      [practicalProtected],
    )
    const allowedResult = await runPlannerBeamSearch(
      allowed.input,
      allowed.dependencies,
    )
    expect(allowedResult.completed).toBe(true)
    expect(allowedResult.bestState?.trace[0].actionType).toBe('reset_skills')
  })

  it('creates an independent initial branch state', () => {
    const goal = target('target.initial.branch')
    const source = sourceWeapon('owned.initial.branch')
    const entry = routeEntry(
      'entry.initial.branch',
      goal,
      resetRoute(source.id),
    )
    const { input, dependencies } = fixture([goal], [entry], [source])
    const validation = validatePlannerInput(input, dependencies)
    const initial = createInitialPlannerSearchState(
      input,
      validation.validBuildListEntries,
    )
    expect(initial.state?.trace).toEqual([])
    expect(initial.state?.routeRuntimeByEntryId[entry.id]).toEqual({
      hasUnregisteredGogmaOutput: false,
    })
    expect(initial.state?.simulatedInventory.ownedWeapons[0])
      .not.toBe(input.ownedWeapons[0])
  })

  it('detects incompatible Skill and Normal counter positions by Entry ID', () => {
    const firstTarget = target('target.conflict.stream.first')
    const secondTarget = target('target.conflict.stream.second')
    const firstSource = createValidOwnedWeapon(
      ownedWeaponId('owned.conflict.stream.first'),
    )
    const secondSource = createValidOwnedWeapon(
      ownedWeaponId('owned.conflict.stream.second'),
    )
    const skillEntry = (id: string, targetWeapon: TargetWeapon, source: OwnedWeapon) =>
      routeEntry(id, targetWeapon, {
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: source.id,
        operations: [{
          type: 'reset_skills',
          sourceOwnedWeaponId: source.id,
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        }],
      })
    const firstSkill = skillEntry(
      'entry.conflict.skill.first',
      firstTarget,
      firstSource,
    )
    const secondSkill = skillEntry(
      'entry.conflict.skill.second',
      secondTarget,
      secondSource,
    )
    const engine = plannerEngine()
    const skillPlans = createPlannerRouteUnitPlans(
      [firstSkill, secondSkill],
      engine,
    )
    const state = {
      targetSatisfaction: {
        [firstTarget.id]: { hasPractical: false, hasIdeal: false },
        [secondTarget.id]: { hasPractical: false, hasIdeal: false },
      },
    } as PlannerSearchState
    expect(detectPlannerConflicts(
      [firstSkill, secondSkill],
      skillPlans.unitPlans,
      [firstTarget, secondTarget],
      state,
      [],
    ).conflicts[0]).toMatchObject({
      kind: 'same_skill_counter',
      buildListEntryIds: [firstSkill.id, secondSkill.id],
    })

    const normalEntry = (id: string, targetWeapon: TargetWeapon) =>
      routeEntry(id, targetWeapon, {
        kind: 'normal_artian_to_gogma',
        sourceOwnedWeaponId: null,
        operations: [{
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 1,
          normalCounterBefore: 4,
          normalCounterAfter: 5,
        }],
      })
    const firstNormal = normalEntry(
      'entry.conflict.normal.first',
      firstTarget,
    )
    const secondNormal = normalEntry(
      'entry.conflict.normal.second',
      secondTarget,
    )
    const normalPlans = createPlannerRouteUnitPlans(
      [firstNormal, secondNormal],
      engine,
    )
    expect(detectPlannerConflicts(
      [firstNormal, secondNormal],
      normalPlans.unitPlans,
      [firstTarget, secondTarget],
      state,
      [],
    ).conflicts[0]).toMatchObject({
      kind: 'same_normal_counter',
      buildListEntryIds: [firstNormal.id, secondNormal.id],
    })
  })

  it('never reuses one owned Normal conversion source in a branch', async () => {
    const firstTarget = target('target.owned-normal.first')
    const secondTarget = target('target.owned-normal.second')
    const normal = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.normal.shared')),
      kind: 'normal' as const,
      rarity: 8 as const,
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
      relatedTargetWeaponIds: [],
    }
    const ownedNormalEntry = (id: string, targetWeapon: TargetWeapon) =>
      routeEntry(id, targetWeapon, {
        kind: 'owned_normal_artian_to_gogma',
        sourceOwnedWeaponId: normal.id,
        operations: [{
          type: 'convert_normal_to_gogma',
          weaponTypeId: normal.weaponTypeId,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        }],
      })
    const first = ownedNormalEntry(
      'entry.owned-normal.first',
      firstTarget,
    )
    const second = ownedNormalEntry(
      'entry.owned-normal.second',
      secondTarget,
    )
    const { input, dependencies } = fixture(
      [firstTarget, secondTarget],
      [first, second],
      [normal],
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.conflicts.some(({ kind }) =>
      kind === 'same_owned_weapon_consumed',
    )).toBe(true)
    expect(result.bestState?.simulatedInventory.consumedWeaponIds).toEqual([
      normal.id,
    ])
    expect(result.bestState?.selectedBuildListEntryIds).toHaveLength(1)
    expect(result.bestState?.simulatedInventory.ownedWeapons.some(
      ({ id }) => id === normal.id,
    )).toBe(false)
  })

  it('does not double-consume a concrete Material weapon', async () => {
    const goal = target('target.material.double')
    const source = sourceWeapon('owned.material.route-source')
    const material = {
      ...sourceWeapon('owned.material.double'),
      status: 'material' as const,
      isProtected: false,
    }
    const entry = routeEntry('entry.material.double', goal, {
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: source.id,
      operations: [
        { type: 'use_weapon_as_material', ownedWeaponId: material.id },
        { type: 'use_weapon_as_material', ownedWeaponId: material.id },
      ],
    })
    const { input, dependencies } = fixture(
      [goal],
      [entry],
      [source, material],
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState?.trace.map(({ actionType }) => actionType)).toEqual([
      'use_weapon_as_material',
    ])
    expect(result.bestState?.simulatedInventory.consumedWeaponIds).toEqual([
      material.id,
    ])
    expect(result.warnings.some(({ kind }) =>
      kind === 'material_weapon_shortage',
    )).toBe(true)
  })

  it('does not count rejected precondition branches as expanded states', async () => {
    const goal = target('target.reject.counter')
    const source = sourceWeapon('owned.reject.counter')
    const entry = routeEntry('entry.reject.counter', goal, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'reset_bonuses',
        sourceOwnedWeaponId: source.id,
        gogmaCounterBefore: 9,
        gogmaCounterAfter: 10,
      }],
    })
    const { input, dependencies } = fixture([goal], [entry], [source])
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.expandedStates).toBe(0)
    expect(result.rejections[0]).toMatchObject({
      buildListEntryId: entry.id,
      reason: 'counter_before_current',
    })
  })

  it('counts all evaluated successors before beamWidth pruning', async () => {
    const gogmaTarget = target('target.prune.gogma', 5)
    const skillTarget = target('target.prune.skill', 1)
    const gogmaSource = sourceWeapon('owned.prune.gogma')
    const skillSource = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.prune.skill')),
      seriesSkillId: null,
      status: 'practical' as const,
      relatedTargetWeaponIds: [],
    }
    const gogma = routeEntry(
      'entry.prune.gogma',
      gogmaTarget,
      resetRoute(gogmaSource.id),
    )
    const skill = routeEntry('entry.prune.skill', skillTarget, {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: skillSource.id,
      operations: [{
        type: 'reset_skills',
        sourceOwnedWeaponId: skillSource.id,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }],
    })
    const { input, dependencies } = fixture(
      [gogmaTarget, skillTarget],
      [gogma, skill],
      [gogmaSource, skillSource],
    )
    input.options.beamWidth = 1
    input.options.maxPlanSteps = 1
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.expandedStates).toBe(2)
    expect(result.bestState?.trace).toHaveLength(1)
    expect(result.bestState?.trace[0].primaryBuildListEntryId).toBe(gogma.id)
  })

  it('uses fixed Practical-first priority in Beam pruning', async () => {
    const uncovered = {
      ...target('target.priority.uncovered'),
      idealBonuses: [
        ...createRestorationBonusSet().slice(0, 4),
        {
          bonusTypeId: 'bonus_type.fixture.sharpness',
          bonusRankId: 'bonus_rank.fixture.special',
        },
      ] as TargetWeapon['idealBonuses'],
    }
    const upgrade = {
      ...target('target.priority.upgrade'),
      weaponTypeId: 'weapon.fixture.b',
    }
    const uncoveredSource = sourceWeapon('owned.priority.uncovered')
    const upgradeSource = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.priority.upgrade')),
      weaponTypeId: 'weapon.fixture.b',
      seriesSkillId: null,
      status: 'practical' as const,
      relatedTargetWeaponIds: [],
    }
    const practical = routeEntry(
      'entry.priority.practical',
      uncovered,
      resetRoute(uncoveredSource.id),
      'practical',
    )
    const ideal = routeEntry('entry.priority.ideal', upgrade, {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: upgradeSource.id,
      operations: [{
        type: 'reset_skills',
        sourceOwnedWeaponId: upgradeSource.id,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }],
    })
    const { input, dependencies } = fixture(
      [uncovered, upgrade],
      [practical, ideal],
      [uncoveredSource, upgradeSource],
    )
    input.options.beamWidth = 1
    input.options.maxPlanSteps = 1
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(result.bestState?.trace[0].primaryBuildListEntryId).toBe(
      practical.id,
    )
  })
})
