import type {
  PlanStep,
  ProductionPlan,
  ProductionPlanStatus,
  TargetWeapon,
  TargetWeaponId,
} from '../../domain/models/publicTypes'

/**
 * Read-only presentation helpers over an already persisted `ProductionPlan`.
 *
 * The exact persisted Plan is the only authority here (UI_FLOW 11): nothing in
 * this module reads a BuildCandidate, reconstructs a PlanStep from a Candidate
 * route, or infers a missing attribution. `progressedTargetWeaponIds ===
 * undefined` means the Plan predates the field (DATA_MODEL 12.x), so its shared
 * attribution stays unknown and is never normalized to `[targetWeaponId]`.
 */

export interface TargetRouteGroup {
  targetWeaponId: TargetWeaponId
  steps: PlanStep[]
}

export interface ProductionPlanSummary {
  planId: string
  status: ProductionPlanStatus
  createdAt: string
  totalStepCount: number
  targetWeaponCount: number
  securedStepCount: number
  isLegacy: boolean
}

/**
 * The Plan steps in their persisted `order`, ascending.
 *
 * The Plan itself is never mutated and no UI-local ordering is invented: a
 * stable sort keeps two steps that share an `order` in their persisted
 * sequence.
 */
export function orderPlanSteps(plan: ProductionPlan): PlanStep[] {
  return [...plan.steps].sort((left, right) => left.order - right.order)
}

/**
 * Every TargetWeapon this one physical Step is attributed to.
 *
 * `progressedTargetWeaponIds` and `targetWeaponId` are separate authorities:
 * a shared Route Step belongs to each progressed Target, while a Planner-only
 * Step such as `reserve_weapon` belongs to its primary Target without
 * progressing any Route. A legacy Step keeps only its primary attribution.
 */
export function getPlanStepRelatedTargetWeaponIds(
  step: PlanStep,
): TargetWeaponId[] {
  const related: TargetWeaponId[] = []
  for (const id of step.progressedTargetWeaponIds ?? []) {
    if (!related.includes(id)) related.push(id)
  }
  if (step.targetWeaponId !== null && !related.includes(step.targetWeaponId)) {
    related.push(step.targetWeaponId)
  }
  return related
}

/**
 * A Step whose single physical execution advances more than one Target Route.
 *
 * It is shown inside each Target's route as an attribution, never as a repeated
 * physical operation, and the global timeline lists it exactly once.
 */
export function isSharedPlanStep(step: PlanStep): boolean {
  return (step.progressedTargetWeaponIds?.length ?? 0) > 1
}

/** A Plan saved before `progressedTargetWeaponIds` existed. */
export function isLegacyProductionPlan(plan: ProductionPlan): boolean {
  return plan.steps.some((step) => step.progressedTargetWeaponIds === undefined)
}

/**
 * The Target-by-Target routes, each in global `step.order`.
 *
 * Groups appear in the order their first related Step appears, so the grouping
 * is fully determined by the persisted Plan.
 */
export function groupPlanStepsByTargetWeapon(
  plan: ProductionPlan,
): TargetRouteGroup[] {
  const groups = new Map<TargetWeaponId, PlanStep[]>()
  for (const step of orderPlanSteps(plan)) {
    for (const targetWeaponId of getPlanStepRelatedTargetWeaponIds(step)) {
      const steps = groups.get(targetWeaponId)
      if (steps === undefined) groups.set(targetWeaponId, [step])
      else steps.push(step)
    }
  }
  return [...groups].map(([targetWeaponId, steps]) => ({ targetWeaponId, steps }))
}

/**
 * The Plan overview counts.
 *
 * `securedStepCount` counts only steps the Plan itself marks
 * `expectedResult.shouldSecure === true`; neither the Target count nor
 * `selectedBuildListEntryIds.length` is assumed to be a weapon count.
 */
export function createProductionPlanSummary(
  plan: ProductionPlan,
): ProductionPlanSummary {
  const targetWeaponIds = new Set<TargetWeaponId>()
  let securedStepCount = 0
  for (const step of plan.steps) {
    for (const id of getPlanStepRelatedTargetWeaponIds(step)) {
      targetWeaponIds.add(id)
    }
    if (step.expectedResult?.shouldSecure === true) securedStepCount += 1
  }
  return {
    planId: plan.id,
    status: plan.status,
    createdAt: plan.createdAt,
    totalStepCount: plan.steps.length,
    targetWeaponCount: targetWeaponIds.size,
    securedStepCount,
    isLegacy: isLegacyProductionPlan(plan),
  }
}

export interface TargetWeaponLookup {
  byId(id: TargetWeaponId): TargetWeapon | null
}

/**
 * Resolves display names from the current persisted Targets.
 *
 * An unresolved reference returns `null` so the caller can fall back to the raw
 * ID; no generation-time Target name is stored on the Plan for this.
 */
export function createTargetWeaponLookup(
  targetWeapons: readonly TargetWeapon[],
): TargetWeaponLookup {
  const index = new Map(targetWeapons.map((target) => [target.id, target]))
  return { byId: (id) => index.get(id) ?? null }
}
