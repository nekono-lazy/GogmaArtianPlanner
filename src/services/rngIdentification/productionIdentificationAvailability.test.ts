import { describe, expect, it } from 'vitest'
import { productionRngRuntime } from '../../domain/rng/production/productionRngRuntime'
import {
  detectProductionIdentificationEnvironment,
  getProductionIdentificationAvailability,
  productionIdentificationUnavailableReasonLabels,
} from './productionIdentificationAvailability'

describe('getProductionIdentificationAvailability', () => {
  it('reports the Wizard available when the runtime has Browser Workers', () => {
    expect(getProductionIdentificationAvailability({ hasWorker: true })).toEqual({ isAvailable: true })
  })

  it('reports worker_unavailable, with a user-facing reason, when Workers are missing', () => {
    const availability = getProductionIdentificationAvailability({ hasWorker: false })
    expect(availability).toEqual({ isAvailable: false, reason: 'worker_unavailable' })
    if (availability.isAvailable) throw new Error('unreachable')
    expect(productionIdentificationUnavailableReasonLabels[availability.reason]).toContain('RNG同定')
  })

  it('is independent of the legacy generic Seed Search flag', () => {
    // The legacy API stays unsupported while the Wizard is available: the two
    // are different contracts (`docs/UI_FLOW.md` 5.3 / 5.4).
    expect(productionRngRuntime.capabilities.supportsSeedSearch).toBe(false)
    expect(getProductionIdentificationAvailability({ hasWorker: true }).isAvailable).toBe(true)
  })

  it('mirrors the Worker-constructor check the Production Worker clients use', () => {
    expect(detectProductionIdentificationEnvironment()).toEqual({
      hasWorker: typeof Worker !== 'undefined',
    })
  })
})
