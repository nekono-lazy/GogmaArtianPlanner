import type {
  AppSettings,
  AppSettingsV1,
  ExecutionSavePoint,
  ExportRoot,
  ProductionPlanId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { executionSavePointIdForPlan } from '../../domain/models/publicTypes'
import type { ImportMasterSubset } from '../../services/dataTransfer/importExportValidation'
import {
  DOMAIN_FIXTURE_TIME,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  executionHistoryId,
  productionPlanId,
  targetWeaponId,
} from './domainData'
import { targetEvaluationMaster } from './targetEvaluation'

/**
 * Shared fixtures of the Import / Export service tests: a current-schema
 * Export root built from the Domain fixtures, carrying every Execution
 * lifecycle state and the Identification provenance, and the Master subset
 * that declares the fixture IDs those entities use.
 */

export const DATA_TRANSFER_PLAN_ID = productionPlanId('plan.fixture.a')

export function dataTransferSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 'settings',
    schemaVersion: 2,
    debugMode: true,
    resultPageSize: 25,
    defaultSearchLimit: 4000,
    candidateSearchDefaults: { maxNormalAdvance: 1000, maxGogmaAdvance: 200, maxSkillAdvance: 2500 },
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
    ...overrides,
  }
}

/**
 * An AppSettings as an Export schema 11 (or older) root carries it: record
 * version 1 without `candidateSearchDefaults`, every other field kept.
 */
export function legacyAppSettingsV1(settings: AppSettings): AppSettingsV1 {
  const { candidateSearchDefaults: _removed, ...rest } = settings
  void _removed
  return { ...rest, schemaVersion: 1 }
}

export function completedFixtureTarget(
  id: string,
  completedByProductionPlanId: ProductionPlanId | null = DATA_TRANSFER_PLAN_ID,
): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    lifecycleStatus: 'completed',
    completedAt: DOMAIN_FIXTURE_TIME,
    completedByProductionPlanId,
  }
}

export function fixtureSavePoint(
  planId: ProductionPlanId = DATA_TRANSFER_PLAN_ID,
  lastExecutionHistoryId: ExecutionSavePoint['lastExecutionHistoryId'] = executionHistoryId('history.fixture.a'),
): ExecutionSavePoint {
  return {
    id: executionSavePointIdForPlan(planId),
    productionPlanId: planId,
    lastExecutionHistoryId,
    rngState: { ...createValidRngState(), lastIdentifiedAt: '2026-08-28T00:00:00.000Z' },
    normalCounters: [{ ...createValidNormalArtianCounter(), lastIdentifiedAt: '2026-08-27T00:00:00.000Z' }],
    ownedWeapons: [{
      ...createValidOwnedWeapon(),
      isProtected: false,
      executionInProgress: { productionPlanId: planId, startedAt: DOMAIN_FIXTURE_TIME },
    }],
    targetWeapons: [createValidTargetWeapon()],
    productionPlan: { ...createValidProductionPlan(), id: planId, status: 'active' },
    recordedAt: DOMAIN_FIXTURE_TIME,
  }
}

/**
 * A complete current-schema root: an in-progress weapon, a completed Target, an
 * active Plan plus an abandoned one, an ExecutionHistory whose Undo snapshot
 * holds a Target and a save point, a game save point, and the Identification
 * provenance on the RngState and the Normal Counter.
 */
export function dataTransferRoot(overrides: Partial<ExportRoot> = {}): ExportRoot {
  const plan = { ...createValidProductionPlan(), id: DATA_TRANSFER_PLAN_ID, status: 'active' as const }
  const abandoned = {
    ...createValidProductionPlan(),
    id: productionPlanId('plan.fixture.abandoned'),
    status: 'abandoned' as const,
    abandonmentReason: 'user_abandoned' as const,
    abandonedAt: DOMAIN_FIXTURE_TIME,
  }
  const history = createValidExecutionHistory()
  history.planId = plan.id
  history.undoSnapshot.productionPlanBefore = { ...plan }
  history.undoSnapshot.affectedTargetWeaponsBefore = [createValidTargetWeapon()]
  history.undoSnapshot.executionSavePointBefore = fixtureSavePoint(plan.id, null)
  return {
    schemaVersion: 13,
    appName: 'mh-wilds-gogma-artian-planner',
    exportedAt: DOMAIN_FIXTURE_TIME,
    rngState: { ...createValidRngState(), lastIdentifiedAt: '2026-08-28T12:00:00.000Z' },
    normalArtianCounters: [{ ...createValidNormalArtianCounter(), lastIdentifiedAt: '2026-08-27T12:00:00.000Z' }],
    ownedWeapons: [
      { ...createValidOwnedWeapon(), isProtected: false, executionInProgress: { productionPlanId: plan.id, startedAt: DOMAIN_FIXTURE_TIME } },
    ],
    targetWeapons: [createValidTargetWeapon(), completedFixtureTarget('target.fixture.completed')],
    buildCandidates: [createValidBuildCandidate()],
    buildListEntries: [createValidBuildListEntry()],
    productionPlans: [plan, abandoned],
    executionHistory: [history],
    executionSavePoints: [fixtureSavePoint(plan.id)],
    settings: dataTransferSettings(),
    ...overrides,
  }
}

/** The Master subset declaring every ID the Domain / orchestration fixtures use. */
export function dataTransferMaster(): ImportMasterSubset {
  const simple = (id: string, sortOrder: number) => ({
    id,
    displayNameJa: id,
    displayNameEn: id,
    sortOrder,
    isEnabled: true,
  })
  return {
    weaponTypes: [
      { ...simple('weapon.fixture.a', 10), category: 'melee', supportsElement: true, supportsSharpness: true },
      { ...simple('weapon.fixture.b', 20), category: 'ranged', supportsElement: true, supportsSharpness: false },
    ],
    elements: [
      { ...simple('element.fixture.a', 10), allowsElementBonus: true },
      { ...simple('element.fixture.b', 20), allowsElementBonus: true },
    ],
    bonusTypes: [
      { ...simple('bonus_type.fixture.attack', 10), category: 'offense' },
      { ...simple('bonus_type.fixture.element', 20), category: 'element' },
      { ...simple('bonus_type.fixture.utility', 30), category: 'utility' },
      { ...simple('bonus_type.fixture.sharpness', 40), category: 'sharpness' },
      { ...simple('bonus_type.fixture.normal_sharpness', 50), category: 'sharpness' },
    ],
    bonusRanks: targetEvaluationMaster.bonusRanks.map((rank) => ({ ...rank })),
    seriesSkills: [simple('series_skill.fixture.a', 10), simple('series_skill.fixture.z', 20)],
    groupSkills: [simple('group_skill.fixture.a', 10)],
    materials: [simple('material.fixture.a', 10)],
  }
}

/**
 * A root's ProductionPlan bodies as an Export schema 12 or older root wrote
 * them: without `conflictRepairLineage` - top-level, in every game save point,
 * in every Undo snapshot and in the save point an Undo snapshot holds. The
 * current fixtures carry `null`, which the schema 12 -> 13 migration refuses as
 * "not a schema 12 body".
 */
export function withoutConflictRepairLineage<T>(root: T): T {
  const copy = structuredClone(root) as unknown as Record<string, unknown>
  const strip = (plan: unknown) => {
    if (typeof plan === 'object' && plan !== null) delete (plan as Record<string, unknown>).conflictRepairLineage
  }
  const plans = copy.productionPlans
  if (Array.isArray(plans)) plans.forEach(strip)
  const savePoints = copy.executionSavePoints
  if (Array.isArray(savePoints)) savePoints.forEach((savePoint) => strip((savePoint as Record<string, unknown>)?.productionPlan))
  const history = copy.executionHistory
  if (Array.isArray(history)) {
    history.forEach((record) => {
      const snapshot = (record as Record<string, unknown>)?.undoSnapshot as Record<string, unknown> | undefined
      if (!snapshot) return
      strip(snapshot.productionPlanBefore)
      const savePointBefore = snapshot.executionSavePointBefore as Record<string, unknown> | null | undefined
      if (savePointBefore) strip(savePointBefore.productionPlan)
    })
  }
  return copy as unknown as T
}
