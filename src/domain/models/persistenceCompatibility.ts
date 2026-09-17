import type { OwnedWeapon, RestorationBonusScope } from './publicTypes'

type LegacyOwnedWeapon = Omit<OwnedWeapon, 'restorationBonusScope'> & {
  restorationBonusScope?: RestorationBonusScope
}

/** Read/import boundary normalization for pre-B1 records only. */
export function normalizeOwnedWeaponRestorationBonusScope(
  weapon: LegacyOwnedWeapon,
): OwnedWeapon {
  if (weapon.restorationBonusScope !== undefined) return weapon as OwnedWeapon
  return {
    ...weapon,
    restorationBonusScope:
      weapon.kind === 'normal' ? 'normal_artian' : 'gogma_artian',
  } as OwnedWeapon
}

const NON_TERMINAL_PLAN_STATUSES: readonly unknown[] = ['draft', 'active', 'stale']
export const PRODUCTION_PLAN_LIFECYCLE_FIELDS = [
  'abandonmentReason',
  'abandonedAt',
  'completedAt',
] as const

/** Whether an untrusted Plan record carries any lifecycle metadata field. */
export function hasProductionPlanLifecycleField(plan: Record<string, unknown>): boolean {
  return PRODUCTION_PLAN_LIFECYCLE_FIELDS.some((field) => field in plan)
}

/** Whether an untrusted Plan record is `completed` or `abandoned`. */
export function isTerminalProductionPlanRecord(plan: Record<string, unknown>): boolean {
  return plan.status === 'completed' || plan.status === 'abandoned'
}

/**
 * Gives a Plan record written before the lifecycle metadata existed its
 * deterministic `null`s (`docs/DATA_MODEL.md` 11.1, 14.2).
 *
 * Only a `draft` / `active` / `stale` record without any lifecycle field is
 * filled: `null` is then the only value its status allows, so nothing is
 * inferred. A terminal record would need a completion time or an abandonment
 * reason nobody recorded, and a record already carrying a field is not a
 * legacy record, so both are left exactly as they are for validation to refuse.
 * Mutates and returns whether it filled the record.
 */
export function fillNonTerminalPlanLifecycle(plan: Record<string, unknown>): boolean {
  if (!NON_TERMINAL_PLAN_STATUSES.includes(plan.status)) return false
  if (hasProductionPlanLifecycleField(plan)) return false
  PRODUCTION_PLAN_LIFECYCLE_FIELDS.forEach((field) => {
    plan[field] = null
  })
  return true
}
