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
    expect(productionIdentificationUnavailableReasonLabels[availability.reason]).toContain('RNG状態の特定')
  })

  it('is decided at the application level, not by any RngEngine capability flag', () => {
    // Availability is the Worker environment only (`docs/UI_FLOW.md` 5.4); the
    // Engine capabilities describe prediction support and nothing else.
    expect(Object.keys(productionRngRuntime.capabilities).sort()).toEqual([
      'supportsGogmaPrediction',
      'supportsKeepBonusesPrediction',
      'supportsNormalArtianPrediction',
      'supportsSkillPrediction',
    ])
    expect(getProductionIdentificationAvailability({ hasWorker: true }).isAvailable).toBe(true)
    expect(getProductionIdentificationAvailability({ hasWorker: false }).isAvailable).toBe(false)
  })

  it('mirrors the Worker-constructor check the Production Worker clients use', () => {
    expect(detectProductionIdentificationEnvironment()).toEqual({
      hasWorker: typeof Worker !== 'undefined',
    })
  })
})
