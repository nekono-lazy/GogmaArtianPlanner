import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../../domain/models/hashing'
import { createTargetDefinitionHash } from '../../domain/buildList'
import { FakeRngEngine, type FakeRngFixtures } from '../../domain/rng/fakeRngEngine'
import type {
  PlannerDependencies,
  PlannerInput,
} from '../../domain/planner/plannerTypes'
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
} from './domainData'
import { belowPracticalBonuses } from './candidateSearch'
import { targetEvaluationMaster } from './targetEvaluation'

export const ENGINE_VERSION = 'fake-fixture:planner-beam-v1'

export function plannerEngine(): FakeRngEngine {
  const gogmaCounterAdvances: FakeRngFixtures['gogmaCounterAdvances'] = []
  const skillCounterAdvances: FakeRngFixtures['skillCounterAdvances'] = []
  const normalCounterAdvances: FakeRngFixtures['normalCounterAdvances'] = []
  for (let counter = 0; counter < 30; counter += 1) {
    gogmaCounterAdvances.push(
      {
        current: counter,
        operation: { type: 'reset_bonuses' },
        result: counter + 1,
      },
      {
        current: counter,
        operation: { type: 'reset_bonuses' },
        result: counter + 1,
      },
      {
        current: counter,
        operation: { type: 'keep_bonuses', },
        result: counter + 1,
      },
    )
    skillCounterAdvances.push(
      {
        current: counter,
        operation: { type: 'convert_normal_to_gogma' },
        result: counter + 1,
      },
      {
        current: counter,
        operation: { type: 'reset_skills' },
        result: counter + 1,
      },
    )
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
      supportsKeepBonusesPrediction: true,
    },
    normalizedSeeds: [],
    resetBonusPredictions: [],
    skillPredictions: [],
    normalArtianPredictions: [],
    keepBonusPredictions: [],
    gogmaCounterAdvances,
    skillCounterAdvances,
    normalCounterAdvances,
  })
}

export function sourceWeapon(
  id: string,
  isProtected = false,
): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    id: ownedWeaponId(id),
    restorationBonuses: belowPracticalBonuses(),
    seriesSkillId: null,
    groupSkillId: 'group_skill.fixture.a',
    status: 'material',
    isProtected,
    relatedTargetWeaponIds: [],
  }
}

export function target(id: string, priority: TargetWeapon['priority'] = 3): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    priority,
  }
}

export function routeEntry(
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
  entry.candidateSnapshot.restorationBonusScope = route.operations.some(({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses') || !route.operations.some(({ type }) => type === 'convert_normal_to_gogma') ? 'gogma_artian' : 'normal_artian'
  entry.candidateSnapshot.category = category
  entry.candidateSnapshot.isSimilarToIdeal = false
  entry.candidateSnapshot.finalBonuses = createRestorationBonusSet()
  entry.candidateSnapshot.seriesSkillId =
    category === 'ideal' ? 'series_skill.fixture.a' : null
  entry.candidateSnapshot.groupSkillId = category === 'ideal' ? null : 'group_skill.fixture.a'
  entry.candidateSnapshot.estimatedOperationCount =
    route.operations.reduce(
      (total, operation) =>
        total + (operation.type === 'create_normal_artian' ? operation.count : 1),
      0,
    )
  entry.candidateSnapshot.estimatedGogmaAdvance =
    route.operations.filter(({ type }) =>
      ['reset_bonuses', 'keep_bonuses'].includes(type),
    ).length
  entry.candidateSnapshot.estimatedSkillAdvance =
    route.operations.filter(({ type }) =>
      ['convert_normal_to_gogma', 'reset_skills'].includes(type),
    ).length
  entry.candidateSnapshot.estimatedNormalAdvance =
    route.operations.some(({ type }) => type === 'create_normal_artian')
      ? route.operations
          .filter(({ type }) => type === 'create_normal_artian')
          .reduce(
            (total, operation) =>
              total +
              (operation.type === 'create_normal_artian' &&
              operation.normalCounterAfter !== null &&
              operation.normalCounterBefore !== null
                ? operation.normalCounterAfter - operation.normalCounterBefore
                : 0),
            0,
          )
      : null
  return entry
}

export function synchronizeEntry(input: PlannerInput, entry: BuildListEntry) {
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

export function fixture(
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
      weaponBonusDefinitions: [],
      weaponTypes: [],
      elements: [],
      bonusTypes: [],
      lotteries: [],
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

export function resetRoute(sourceId: string, counter = 10): BuildRoute {
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
