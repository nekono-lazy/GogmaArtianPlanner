import type {
  BuildCandidate,
  BuildCandidateId,
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  ExecutionHistory,
  ExecutionHistoryId,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  PlanStepId,
  ProductionPlan,
  ProductionPlanId,
  RestorationBonusSet,
  RngState,
  TargetWeapon,
  TargetWeaponId,
} from '../../domain/models/publicTypes'

export const DOMAIN_FIXTURE_TIME = '2026-08-29T00:00:00.000Z'

export const domainFixtureContext: CalculationContext = {
  gameVersion: 'fixture-only',
  masterDataVersion: 1,
  rngEngineVersion: 'fixture-only',
  // Historical calculation context; runtime creators use the current authority.
  appSchemaVersion: 1,
}

export function ownedWeaponId(value: string): OwnedWeaponId {
  return value as OwnedWeaponId
}

export function targetWeaponId(value: string): TargetWeaponId {
  return value as TargetWeaponId
}

export function candidateId(value: string): BuildCandidateId {
  return value as BuildCandidateId
}

export function buildListEntryId(value: string): BuildListEntryId {
  return value as BuildListEntryId
}

export function productionPlanId(value: string): ProductionPlanId {
  return value as ProductionPlanId
}

export function planStepId(value: string): PlanStepId {
  return value as PlanStepId
}

export function executionHistoryId(value: string): ExecutionHistoryId {
  return value as ExecutionHistoryId
}

export function createRestorationBonusSet(): RestorationBonusSet {
  return [
    { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
    { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
    { bonusTypeId: 'bonus_type.fixture.element', bonusRankId: 'bonus_rank.fixture.middle' },
    { bonusTypeId: 'bonus_type.fixture.utility', bonusRankId: 'bonus_rank.fixture.low' },
    { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.high' },
  ]
}

export function createValidRngState(): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: { value: 'fixture-seed', isConfirmed: true, source: 'manual' },
    gogmaCounter: { value: 10, isConfirmed: true, source: 'observation' },
    skillCounter: { value: null, isConfirmed: false, source: null },
    counterGate: { value: 2, isConfirmed: true, source: 'manual' },
    notes: 'Fixture note excluded from semantic hashes.',
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidNormalArtianCounter(): NormalArtianCounter {
  return {
    id: 'weapon.fixture.a:8',
    weaponTypeId: 'weapon.fixture.a',
    rarity: 8,
    counter: 4,
    isConfirmed: true,
    observationCount: 1,
    lastObservedAt: DOMAIN_FIXTURE_TIME,
    candidateCount: 1,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidOwnedWeapon(
  id: OwnedWeaponId = ownedWeaponId('owned.fixture.a'),
): OwnedGogmaArtianWeapon {
  return {
    id,
    kind: 'gogma',
    name: 'Domain fixture weapon',
    weaponTypeId: 'weapon.fixture.a',
    elementId: 'element.fixture.a',
    restorationBonuses: createRestorationBonusSet(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: 'group_skill.fixture.a',
    status: 'practical',
    isProtected: true,
    memo: 'Fixture memo excluded from semantic hashes.',
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidTargetWeapon(): TargetWeapon {
  return {
    id: targetWeaponId('target.fixture.a'),
    name: 'Domain fixture target',
    weaponTypeId: 'weapon.fixture.a',
    elementId: 'element.fixture.a',
    priority: 3,
    isEnabled: true,
    preferredOwnedWeaponId: null,
    idealBonuses: createRestorationBonusSet(),
    practicalBonusConditions: [
      {
        id: 'condition.fixture.attack',
        bonusTypeId: 'bonus_type.fixture.attack',
        minimumRankId: 'bonus_rank.fixture.high',
        requiredExCount: 0,
      },
      { id: 'condition.fixture.sharpness', bonusTypeId: 'bonus_type.fixture.sharpness', minimumRankId: 'bonus_rank.fixture.low', requiredExCount: 0 },
      { id: 'condition.fixture.utility', bonusTypeId: 'bonus_type.fixture.utility', minimumRankId: 'bonus_rank.fixture.low', requiredExCount: 0 },
      { id: 'condition.fixture.element', bonusTypeId: 'bonus_type.fixture.element', minimumRankId: 'bonus_rank.fixture.middle', requiredExCount: 0 },
    ],
    alternativeBonusRules: [
      {
        id: 'alternative.fixture.one',
        sourceBonusTypeId: 'bonus_type.fixture.sharpness',
        maxReplacementCount: 1,
        options: [{ alternativeBonusTypeId: 'bonus_type.fixture.utility', minimumRankId: 'bonus_rank.fixture.low', requiredExCount: 0 }],
      },
    ],
    idealSkillCondition: {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: null,
      matchMode: 'all',
    },
    practicalSkillCondition: {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: 'group_skill.fixture.a',
      matchMode: 'any',
    },
    memo: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidBuildCandidate(): BuildCandidate {
  return {
    id: candidateId('candidate.fixture.a'),
    targetWeaponId: targetWeaponId('target.fixture.a'),
    category: 'practical',
    finalBonuses: createRestorationBonusSet(),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    route: {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 1,
          normalCounterBefore: 4,
          normalCounterAfter: 5,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        {
          type: 'reset_skills',
          sourceOwnedWeaponId: null,
          skillCounterBefore: 8,
          skillCounterAfter: 9,
        },
      ],
    },
    estimatedOperationCount: 3,
    estimatedGogmaAdvance: 0,
    estimatedSkillAdvance: 2,
    estimatedNormalAdvance: 1,
    requiredMaterials: [{ materialId: 'material.fixture.a', quantity: 1 }],
    idealDifference: {
      missingBonuses: [],
      extraBonuses: [],
      matchedBonusCount: 5,
      seriesSkillMatches: true,
      groupSkillMatches: true,
      summary: 'Domain fixture only.',
    },
    isSimilarToIdeal: true,
    similarityScore: 0.9,
    searchStateHash: 'hash.fixture.search',
    referencedOwnedWeaponsHash: null,
    calculationContext: { ...domainFixtureContext },
    searchRunId: 'search-run.fixture.a',
    createdAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidBuildListEntry(): BuildListEntry {
  const candidate = createValidBuildCandidate()
  return {
    id: buildListEntryId('build-list.fixture.a'),
    candidateId: candidate.id,
    targetWeaponId: candidate.targetWeaponId,
    candidateSnapshot: candidate,
    targetDefinitionHash: 'hash.fixture.target',
    searchStateHash: candidate.searchStateHash,
    referencedOwnedWeaponsHash: candidate.referencedOwnedWeaponsHash,
    calculationContext: { ...candidate.calculationContext },
    isStale: false,
    staleReasons: [],
    createdAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidProductionPlan(): ProductionPlan {
  const stepId = planStepId('step.fixture.a')
  const expectedState = {
    rngStateHash: 'hash.fixture.rng',
    normalCountersHash: 'hash.fixture.normal',
    ownedWeaponsHash: 'hash.fixture.owned',
  }
  return {
    id: productionPlanId('plan.fixture.a'),
    status: 'draft',
    baseSnapshot: {
      initialExecutionState: { ...expectedState },
      targetWeaponsHash: 'hash.fixture.targets',
      buildListEntriesHash: 'hash.fixture.build-list',
      calculationContext: { ...domainFixtureContext },
      createdAt: DOMAIN_FIXTURE_TIME,
    },
    selectedBuildListEntryIds: [buildListEntryId('build-list.fixture.a')],
    calculationContext: { ...domainFixtureContext },
    steps: [
      {
        id: stepId,
        order: 1,
        operationType: 'confirm_result',
        title: 'Fixture step',
        instruction: 'Domain structure fixture only.',
        targetWeaponId: targetWeaponId('target.fixture.a'),
        buildListEntryId: buildListEntryId('build-list.fixture.a'),
        candidateId: candidateId('candidate.fixture.a'),
        ownedWeaponId: null,
        expectedResult: {
          restorationBonuses: createRestorationBonusSet(),
          restorationBonusScope: 'gogma_artian',
          seriesSkillId: 'series_skill.fixture.a',
          groupSkillId: null,
          candidateCategory: 'practical',
          isSimilarToIdeal: true,
          shouldSecure: true,
        },
        expectedStateBefore: { ...expectedState },
        expectedStateAfter: { ...expectedState },
        inventoryChange: null,
        rngAdvance: {
          gogmaCounterDelta: 0,
          skillCounterDelta: 0,
          normalCounterDelta: null,
          affectedNormalCounterId: null,
        },
        requiresUserConfirmation: false,
        isCompleted: false,
        completedAt: null,
        debug: null,
      },
    ],
    conflicts: [],
    rejectedBuildListEntries: [],
    requiredMaterials: [{ materialId: 'material.fixture.a', quantity: 1 }],
    currentStepId: stepId,
    recalculationReasons: [],
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }
}

export function createValidExecutionHistory(): ExecutionHistory {
  const plan = createValidProductionPlan()
  return {
    id: executionHistoryId('history.fixture.a'),
    planId: plan.id,
    planStepId: plan.steps[0].id,
    action: 'confirmed_expected',
    actualResult: null,
    wasExpected: true,
    recalculationReason: null,
    undoSnapshot: {
      rngStateBefore: createValidRngState(),
      normalCountersBefore: [createValidNormalArtianCounter()],
      affectedOwnedWeaponsBefore: [createValidOwnedWeapon()],
      addedOwnedWeaponIds: [],
      removedOwnedWeaponsBefore: [],
      productionPlanBefore: plan,
    },
    createdAt: DOMAIN_FIXTURE_TIME,
  }
}
