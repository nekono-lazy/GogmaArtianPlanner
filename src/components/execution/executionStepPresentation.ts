import type { ExecutionRuntimeErrorCode } from '../../domain/execution'
import type {
  ExpectedResult,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
  PlanStepNormalCreationRole,
  ProductionPlan,
  TargetWeapon,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import { planStepOperationLabels } from '../../presentation/labels'
import { orderPlanSteps } from '../planner/productionPlanPresentation'

/**
 * Pure presentation over an exact persisted ProductionPlan for the Execution
 * Navigator (`docs/UI_FLOW.md` 12, `docs/PLANNER_SPEC.md` 16).
 *
 * Nothing here decides Execution semantics: the Plan's `currentStepId`, the
 * Steps' `isCompleted`, `order` and `executionEffects` are read as they were
 * persisted, no RNG prediction runs, and no Step is reconstructed from a
 * Candidate. The Execution runtime stays the authority that accepts or refuses
 * every confirmation.
 */

/** Where the Plan stands, from its persisted `order`, `isCompleted` and `currentStepId`. */
export interface ExecutionProgressView {
  totalStepCount: number
  completedStepCount: number
  remainingStepCount: number
  /** 1-based position of the current Step in Plan order, or `null` when there is none. */
  currentStepNumber: number | null
  currentStep: PlanStep | null
}

export function createExecutionProgress(plan: ProductionPlan): ExecutionProgressView {
  const steps = orderPlanSteps(plan)
  const completedStepCount = steps.filter(({ isCompleted }) => isCompleted).length
  // `currentStepId` is the only current-Step authority; an array index or the
  // first incomplete Step is never taken in its place.
  const currentIndex =
    plan.currentStepId === null ? -1 : steps.findIndex(({ id }) => id === plan.currentStepId)
  const currentStep = currentIndex < 0 ? null : steps[currentIndex]
  return {
    totalStepCount: steps.length,
    completedStepCount,
    remainingStepCount: steps.length - completedStepCount,
    currentStepNumber: currentStep === null || currentStep.isCompleted ? null : currentIndex + 1,
    currentStep: currentStep === null || currentStep.isCompleted ? null : currentStep,
  }
}

/** Which confirmation the current Step offers (`docs/PLANNER_SPEC.md` 16.4). */
export type ExecutionStepActionKind =
  /** 「結果一致・次へ」 */
  | 'confirm_expected'
  /** 「実際の5枠を入力して確定」: a blind production-target Normal. */
  | 'observe_normal_bonuses'
  /** 「所持武器で完成を確認」: no game operation. */
  | 'confirm_owned_ideal'
  /** A legacy or projection-less Step the Navigator never executes. */
  | 'not_executable'

export type ExecutionExpectedView =
  | { kind: 'none' }
  | { kind: 'observation_required' }
  | { kind: 'result'; result: ExpectedResult }

export interface ExecutionStepPresentation {
  step: PlanStep
  operationLabel: string
  actionKind: ExecutionStepActionKind
  normalCreationRole: PlanStepNormalCreationRole | null
  /**
   * The tracked weapon's current name (or its ID when it cannot be resolved).
   * `null` for a Counter-advance Normal and for the Step that registers the
   * production-target Normal, which does not exist yet.
   */
  weaponLabel: string | null
  /** The weapon type whose bonus names the expected result uses. */
  weaponTypeId: string
  /** The Step's primary Target name, or its ID when it cannot be resolved. */
  targetLabel: string | null
  expected: ExecutionExpectedView
  /** Target names from `executionEffects.targetCompletions` only. */
  completionTargetLabels: string[]
  /** The Step carries `checkpointMilestones`: it reaches a selected intermediate state. */
  reachesCheckpoint: boolean
}

export function ownedWeaponLabel(
  weaponId: OwnedWeaponId,
  ownedWeapons: readonly OwnedWeapon[],
): string {
  return ownedWeapons.find(({ id }) => id === weaponId)?.name ?? `所持武器（${weaponId}）`
}

export function targetWeaponLabel(
  targetWeaponId: TargetWeaponId,
  targetWeapons: readonly TargetWeapon[],
): string {
  return targetWeapons.find(({ id }) => id === targetWeaponId)?.name ?? `目標武器（${targetWeaponId}）`
}

function actionKindFor(step: PlanStep): ExecutionStepActionKind {
  const effects = step.executionEffects
  if (effects === undefined) return 'not_executable'
  switch (step.operationType) {
    case 'confirm_owned_ideal':
      return 'confirm_owned_ideal'
    case 'create_normal_artian':
      return effects.observationBinding !== null ? 'observe_normal_bonuses' : 'confirm_expected'
    case 'convert_normal_to_gogma':
    case 'reset_bonuses':
    case 'keep_bonuses':
    case 'reset_skills':
      return 'confirm_expected'
    case 'reserve_weapon':
    case 'confirm_result':
      // Legacy Steps are displayed by the Plan page but never executed.
      return 'not_executable'
  }
}

export function createExecutionStepPresentation(
  step: PlanStep,
  ownedWeapons: readonly OwnedWeapon[],
  targetWeapons: readonly TargetWeapon[],
): ExecutionStepPresentation {
  const effects = step.executionEffects
  const actionKind = actionKindFor(step)
  const trackedId = effects?.trackedOwnedWeaponId ?? null
  const tracked = trackedId === null ? null : ownedWeapons.find(({ id }) => id === trackedId) ?? null
  const target = step.targetWeaponId === null
    ? null
    : targetWeapons.find(({ id }) => id === step.targetWeaponId) ?? null
  const weaponLabel =
    trackedId === null || effects?.registersTrackedWeapon === true
      ? null
      : ownedWeaponLabel(trackedId, ownedWeapons)
  const expected: ExecutionExpectedView =
    actionKind === 'observe_normal_bonuses'
      ? { kind: 'observation_required' }
      : step.expectedResult === null
        ? { kind: 'none' }
        : { kind: 'result', result: step.expectedResult }
  return {
    step,
    operationLabel: planStepOperationLabels[step.operationType],
    actionKind,
    normalCreationRole: effects?.normalCreationRole ?? null,
    weaponLabel,
    weaponTypeId: tracked?.weaponTypeId ?? target?.weaponTypeId ?? '',
    targetLabel:
      step.targetWeaponId === null ? null : targetWeaponLabel(step.targetWeaponId, targetWeapons),
    expected,
    completionTargetLabels: (effects?.targetCompletions ?? []).map(({ targetWeaponId }) =>
      targetWeaponLabel(targetWeaponId, targetWeapons),
    ),
    reachesCheckpoint: (step.checkpointMilestones ?? []).length > 0,
  }
}

/** The physical operations the weapon switch guidance compares (16.14). */
const WEAPON_SWITCH_OPERATIONS: ReadonlySet<PlanStep['operationType']> = new Set([
  'convert_normal_to_gogma',
  'reset_bonuses',
  'keep_bonuses',
  'reset_skills',
])

function switchSubject(step: PlanStep): OwnedWeaponId | null {
  if (!WEAPON_SWITCH_OPERATIONS.has(step.operationType)) return null
  return step.executionEffects?.trackedOwnedWeaponId ?? null
}

/**
 * The weapon the user must switch to before the current Step
 * (`docs/UI_FLOW.md` 12.6, `docs/PLANNER_SPEC.md` 16.14), or `null`.
 *
 * Presentation only: it compares the current Step's tracked weapon with the
 * tracked weapon of the last *completed* conversion / Reset / Keep / Reset
 * Skills Step in Plan order. `create_normal_artian` and `confirm_owned_ideal`
 * are neither compared nor prompted. With no earlier compared Step there is no
 * weapon to switch from, so nothing is prompted.
 */
export function weaponSwitchTarget(
  plan: ProductionPlan,
  currentStep: PlanStep,
): OwnedWeaponId | null {
  const current = switchSubject(currentStep)
  if (current === null) return null
  let previous: OwnedWeaponId | null = null
  for (const step of orderPlanSteps(plan)) {
    if (!step.isCompleted) continue
    const subject = switchSubject(step)
    if (subject !== null) previous = subject
  }
  return previous !== null && previous !== current ? current : null
}

/** A typed Execution runtime refusal, in the words the Navigator shows. */
export function executionErrorMessage(code: ExecutionRuntimeErrorCode): string {
  switch (code) {
    case 'plan_not_found':
      return '生産計画が見つかりません。'
    case 'plan_not_startable':
      return 'この生産計画は開始できる状態ではありません。'
    case 'running_plan_conflict':
      return '別の生産計画が実行中です。実行中の生産計画を終えてから開始してください。'
    case 'plan_not_active':
      return 'この生産計画は実行中ではないため、操作を確定できません。'
    case 'plan_not_executable':
      return 'この生産計画は現在の実行形式ではないため実行できません。ビルドリストから再計算してください。'
    case 'calculation_context_changed':
      return 'この生産計画は現在の計算契約と互換性がないため実行できません。ビルドリストから再計算してください。'
    case 'step_not_current':
      return 'このStepは現在のStepではありません。最新の状態を読み込み直しました。'
    case 'plan_dependency_changed':
      return 'この生産計画が前提とする目標武器または作成リストが変更されています。'
    case 'execution_state_mismatch':
      return '現在の保存状態が、このStep開始時の想定と一致しません。'
    case 'observation_required':
      return 'ゲーム画面で確認した実際の5枠を入力してください。'
    case 'observation_not_expected':
      return 'このStepでは5枠の入力は不要です。'
    case 'observation_invalid':
      return '入力した5枠は、この武器種・属性の通常アーティアとして保存できません。入力を確認してください。'
    case 'compromise_finish_not_applicable':
      return 'この武器は作成リストで選んだ途中採用状態として終了できません。'
    case 'compromise_checkpoint_not_current':
      return '途中採用状態は既に通過しているため、妥協品として終了できません。'
    case 'execution_effect_inconsistent':
    case 'expected_state_after_mismatch':
    case 'collection_validation_failed':
    case 'entity_validation_failed':
      return 'Stepを確定すると保存状態の整合性が崩れるため、確定しませんでした。'
    default:
      return '操作を確定できませんでした。'
  }
}

/** Refusals whose recovery is recalculation, not a retry. */
export function isRecalculationRequiredError(code: ExecutionRuntimeErrorCode): boolean {
  return (
    code === 'execution_state_mismatch' ||
    code === 'plan_dependency_changed' ||
    code === 'calculation_context_changed' ||
    code === 'plan_not_executable'
  )
}
