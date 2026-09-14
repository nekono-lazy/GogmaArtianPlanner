/**
 * Application-level availability of Production RNG Identification, that is
 * the Skill-first Identification Wizard (`docs/UI_FLOW.md` 5 / 5.4).
 *
 * Identification availability lives at the Worker / application level, not in
 * `RngEngineCapabilities`. In particular it is never read from
 * `supportsSeedSearch`: that flag describes the legacy generic Seed Search API
 * of `docs/UI_FLOW.md` 5.3, stays `false`, and says nothing about the Wizard
 * that C5-E2C10 activated. Presenting that flag as "RNG identification is
 * unsupported" would be false, so user-facing screens read this module instead.
 *
 * The Production Wizard runs its Skill and Gogma Counter searches in Browser
 * Workers, and the Production Worker clients report `worker_unavailable` when
 * the `Worker` constructor is missing; the same condition is mirrored here so
 * the availability shown before the Wizard starts matches what starting it
 * would find.
 */
export type ProductionIdentificationUnavailableReason = 'worker_unavailable'

export type ProductionIdentificationAvailability =
  | { readonly isAvailable: true }
  | { readonly isAvailable: false; readonly reason: ProductionIdentificationUnavailableReason }

export interface ProductionIdentificationEnvironment {
  /** Whether the runtime exposes the Browser `Worker` constructor. */
  readonly hasWorker: boolean
}

export function detectProductionIdentificationEnvironment(): ProductionIdentificationEnvironment {
  return { hasWorker: typeof Worker !== 'undefined' }
}

export function getProductionIdentificationAvailability(
  environment: ProductionIdentificationEnvironment = detectProductionIdentificationEnvironment(),
): ProductionIdentificationAvailability {
  if (!environment.hasWorker) return { isAvailable: false, reason: 'worker_unavailable' }
  return { isAvailable: true }
}

/** User-facing status of Production RNG Identification (`docs/UI_FLOW.md` 5). */
export const productionIdentificationUnavailableReasonLabels: Record<
  ProductionIdentificationUnavailableReason,
  string
> = {
  worker_unavailable: 'このブラウザではWeb Workerを利用できないため、RNG同定を実行できません',
}
