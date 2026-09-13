import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  type GogmaCounterIdentificationInput,
  type GogmaCounterIdentificationWorkerRequest,
  type GogmaCounterIdentificationWorkerResponse,
} from '../domain/rng/identification'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { gameVerifiedGogmaCounterIdentificationVector as live } from '../test/fixtures/gameVerifiedGogmaVectors'
import { createGogmaCounterIdentificationWorkerController } from './gogmaCounterIdentification.worker'
import { createProductionGogmaCounterIdentificationRngEngine } from './gogmaCounterIdentification.worker.production'

function input(startInclusive = 50, endInclusive = 65): GogmaCounterIdentificationInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  return {
    baseSeed: String(live.baseSeed),
    weaponTypeId: live.weaponTypeId,
    elementId: live.elementId,
    observations: live.observations,
    gogmaCounterRange: { startInclusive, endInclusive },
    master: {
      weaponTypes: loaded.data.weaponTypes,
      elements: loaded.data.elements,
      bonusTypes: loaded.data.bonusTypes,
      weaponBonusDefinitions: loaded.data.weaponBonusDefinitions,
    },
  }
}

describe('Gogma Counter Identification Worker', () => {
  it('keeps Engine/functions outside the structured-clone request', () => {
    const request: GogmaCounterIdentificationWorkerRequest = {
      type: 'identify_gogma_counter',
      requestId: 'gogma-identification.clone',
      input: input(),
    }
    expect(request).not.toHaveProperty('rngEngine')
    expect(request.input).not.toHaveProperty('rngEngine')
    expect(request.input.master).not.toHaveProperty('lotteries')
    expect(structuredClone(request)).toEqual(request)
  })

  it('returns request-scoped progress and the Production live golden', async () => {
    const responses: GogmaCounterIdentificationWorkerResponse[] = []
    const controller = createGogmaCounterIdentificationWorkerController(
      createProductionGogmaCounterIdentificationRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_gogma_counter',
      requestId: 'gogma-identification.production',
      input: input(),
    })
    expect(responses.some(({ type }) => type === 'progress')).toBe(true)
    expect(responses.at(-1)).toEqual({
      type: 'gogma_counter_identification_result',
      requestId: 'gogma-identification.production',
      result: {
        matches: [{ startGogmaCounter: 55 }],
        searchedCounterRange: { startInclusive: 50, endInclusive: 65 },
        isTruncated: false,
      },
    })
  })

  it('preserves cancellation across duplicate reuse and cleans the token after termination', async () => {
    const responses: GogmaCounterIdentificationWorkerResponse[] = []
    const holder: {
      controller?: ReturnType<typeof createGogmaCounterIdentificationWorkerController>
      duplicate?: Promise<void>
    } = {}
    let cancellationSent = false
    const controller = createGogmaCounterIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => {
        responses.push(response)
        if (response.type === 'progress' && !cancellationSent) {
          cancellationSent = true
          void holder.controller?.handleMessage({
            type: 'cancel',
            requestId: 'gogma-identification.cancel',
          })
          holder.duplicate = holder.controller?.handleMessage({
            type: 'identify_gogma_counter',
            requestId: 'gogma-identification.cancel',
            input: input(),
          })
        }
      },
    )
    holder.controller = controller
    await controller.handleMessage({
      type: 'identify_gogma_counter',
      requestId: 'gogma-identification.cancel',
      input: {
        ...input(0, 100_000),
        observations: live.observations.slice(0, 1),
      },
    })
    await holder.duplicate
    expect(responses).toContainEqual(expect.objectContaining({
      type: 'error',
      requestId: 'gogma-identification.cancel',
      code: 'invalid_input',
    }))
    expect(responses.some(({ type }) => type === 'gogma_counter_identification_result')).toBe(false)
    expect(controller.isCancelled('gogma-identification.cancel')).toBe(false)

    responses.length = 0
    await controller.handleMessage({
      type: 'identify_gogma_counter',
      requestId: 'gogma-identification.cancel',
      input: input(),
    })
    expect(responses.at(-1)).toEqual(expect.objectContaining({
      type: 'gogma_counter_identification_result',
      requestId: 'gogma-identification.cancel',
    }))
  })

  it('preserves known validation errors in the Worker response', async () => {
    const responses: GogmaCounterIdentificationWorkerResponse[] = []
    const controller = createGogmaCounterIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_gogma_counter',
      requestId: 'gogma-identification.invalid',
      input: { ...input(), gogmaCounterRange: { startInclusive: 2, endInclusive: 1 } },
    })
    expect(responses).toEqual([expect.objectContaining({
      type: 'error',
      requestId: 'gogma-identification.invalid',
      code: 'invalid_input',
    })])
  })

  it('creates a Worker-local Production Engine without activating Seed Search capability', () => {
    const engine = createProductionGogmaCounterIdentificationRngEngine()
    expect(engine).toBeInstanceOf(ProductionRngEngine)
    expect(engine.capabilities.supportsGogmaPrediction).toBe(true)
    expect(engine.capabilities.supportsSeedSearch).toBe(false)
  })
})
