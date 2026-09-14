import { describe, expect, it, vi } from 'vitest'
import {
  type NormalArtianCounterIdentificationInput,
  type NormalArtianCounterIdentificationWorkerRequest,
  type NormalArtianCounterIdentificationWorkerResponse,
} from '../domain/rng/identification'
import { normalArtianLotteryTableClassForWeaponAndElement } from '../domain/rng/production/gameNormalBonuses'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { gameVerifiedHeavyBowgunFireNormalVectors as live } from '../test/fixtures/gameVerifiedNormalVectors'
import {
  attachNormalArtianCounterIdentificationWorker,
  createNormalArtianCounterIdentificationWorkerController,
} from './normalArtianCounterIdentification.worker'
import { createProductionNormalArtianCounterIdentificationRngEngine } from './normalArtianCounterIdentification.worker.production'

function input(startInclusive = 0, endInclusive = 5_000): NormalArtianCounterIdentificationInput {
  return {
    baseSeed: String(live[0].baseSeed),
    weaponTypeId: 'weapon.heavy_bowgun',
    rarity: 8,
    observations: live.map((vector) => ({
      tableClass: normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId),
      bonuses: vector.bonuses,
    })),
    normalCounterRange: { startInclusive, endInclusive },
  }
}

const golden = {
  matches: [{ startNormalCounter: 4 }],
  searchedCounterRange: { startInclusive: 0, endInclusive: 5_000 },
  isTruncated: false,
}

describe('Normal Artian Counter Identification Worker', () => {
  it('keeps Engine/functions and the representative element outside the structured-clone request', () => {
    const request: NormalArtianCounterIdentificationWorkerRequest = {
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.clone',
      input: input(),
    }
    expect(request).not.toHaveProperty('rngEngine')
    expect(request.input).not.toHaveProperty('rngEngine')
    expect(request.input).not.toHaveProperty('elementId')
    expect(request.input).not.toHaveProperty('master')
    expect(structuredClone(request)).toEqual(request)
  })

  it('returns request-scoped progress and the Production HBG live golden', async () => {
    const responses: NormalArtianCounterIdentificationWorkerResponse[] = []
    const controller = createNormalArtianCounterIdentificationWorkerController(
      createProductionNormalArtianCounterIdentificationRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.production',
      input: input(),
    })
    const progress = responses.filter((response) => response.type === 'progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((response) => response.requestId === 'normal-identification.production')).toBe(true)
    expect(progress.at(-1)).toEqual({
      type: 'progress',
      requestId: 'normal-identification.production',
      progress: { searchedCounters: 5_001, totalCounters: 5_001, matchesFound: 1 },
    })
    expect(responses.at(-1)).toEqual({
      type: 'normal_artian_counter_identification_result',
      requestId: 'normal-identification.production',
      result: golden,
    })
  })

  it('preserves cancellation across duplicate reuse and cleans the token after termination', async () => {
    const responses: NormalArtianCounterIdentificationWorkerResponse[] = []
    const holder: {
      controller?: ReturnType<typeof createNormalArtianCounterIdentificationWorkerController>
      duplicate?: Promise<void>
    } = {}
    let cancellationSent = false
    const controller = createNormalArtianCounterIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => {
        responses.push(response)
        if (response.type === 'progress' && !cancellationSent) {
          cancellationSent = true
          void holder.controller?.handleMessage({
            type: 'cancel',
            requestId: 'normal-identification.cancel',
          })
          holder.duplicate = holder.controller?.handleMessage({
            type: 'identify_normal_artian_counter',
            requestId: 'normal-identification.cancel',
            input: input(),
          })
        }
      },
    )
    holder.controller = controller
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.cancel',
      input: {
        ...input(0, 100_000),
        observations: input().observations.slice(0, 1),
      },
    })
    await holder.duplicate
    expect(responses).toContainEqual(expect.objectContaining({
      type: 'error',
      requestId: 'normal-identification.cancel',
      code: 'invalid_input',
    }))
    expect(responses.some(({ type }) => type === 'normal_artian_counter_identification_result')).toBe(false)
    expect(responses.filter(({ type }) => type === 'progress')).toHaveLength(1)
    expect(controller.isCancelled('normal-identification.cancel')).toBe(false)

    responses.length = 0
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.cancel',
      input: input(),
    })
    expect(responses.at(-1)).toEqual({
      type: 'normal_artian_counter_identification_result',
      requestId: 'normal-identification.cancel',
      result: golden,
    })
  })

  it('ignores a cancel for an unknown requestId and keeps other requests independent', async () => {
    const responses: NormalArtianCounterIdentificationWorkerResponse[] = []
    const controller = createNormalArtianCounterIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({ type: 'cancel', requestId: 'normal-identification.missing' })
    expect(responses).toEqual([])
    expect(controller.isCancelled('normal-identification.missing')).toBe(false)
    await Promise.all([
      controller.handleMessage({
        type: 'identify_normal_artian_counter',
        requestId: 'normal-identification.a',
        input: input(0, 10),
      }),
      controller.handleMessage({
        type: 'identify_normal_artian_counter',
        requestId: 'normal-identification.b',
        input: input(5, 10),
      }),
    ])
    expect(responses).toContainEqual({
      type: 'normal_artian_counter_identification_result',
      requestId: 'normal-identification.a',
      result: {
        matches: [{ startNormalCounter: 4 }],
        searchedCounterRange: { startInclusive: 0, endInclusive: 10 },
        isTruncated: false,
      },
    })
    expect(responses).toContainEqual({
      type: 'normal_artian_counter_identification_result',
      requestId: 'normal-identification.b',
      result: {
        matches: [],
        searchedCounterRange: { startInclusive: 5, endInclusive: 10 },
        isTruncated: false,
      },
    })
  })

  it('preserves known validation and unsupported errors as structured Worker responses', async () => {
    const responses: NormalArtianCounterIdentificationWorkerResponse[] = []
    const controller = createNormalArtianCounterIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.invalid',
      input: { ...input(), normalCounterRange: { startInclusive: 2, endInclusive: 1 } },
    })
    expect(responses).toEqual([expect.objectContaining({
      type: 'error',
      requestId: 'normal-identification.invalid',
      code: 'invalid_input',
      unsupportedReason: null,
    })])

    responses.length = 0
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.unsupported',
      input: { ...input(), weaponTypeId: 'weapon.switch_axe' },
    })
    expect(responses).toEqual([expect.objectContaining({
      type: 'error',
      requestId: 'normal-identification.unsupported',
      code: 'unsupported_input',
      unsupportedReason: 'normal_pool_unverified',
    })])
  })

  it('reports unexpected kernel failures as unexpected_error without a result', async () => {
    const responses: NormalArtianCounterIdentificationWorkerResponse[] = []
    const engine = new ProductionRngEngine()
    vi.spyOn(engine, 'getPredictionSupport').mockImplementation(() => {
      throw new Error('boom')
    })
    const controller = createNormalArtianCounterIdentificationWorkerController(
      engine,
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_normal_artian_counter',
      requestId: 'normal-identification.unexpected',
      input: input(),
    })
    expect(responses).toEqual([{
      type: 'error',
      requestId: 'normal-identification.unexpected',
      message: 'boom',
      code: 'unexpected_error',
      unsupportedReason: null,
    }])
  })

  it('attaches to a Worker scope, creates the Engine once, and routes messages to the controller', async () => {
    const posted: NormalArtianCounterIdentificationWorkerResponse[] = []
    let listener: ((event: { data: NormalArtianCounterIdentificationWorkerRequest }) => void) | null = null
    const createEngine = vi.fn(() => new ProductionRngEngine())
    const controller = attachNormalArtianCounterIdentificationWorker({
      postMessage: (response) => posted.push(response),
      addEventListener: (_type, handler) => {
        listener = handler
      },
    }, createEngine)
    expect(createEngine).toHaveBeenCalledOnce()
    expect(listener).not.toBeNull()
    listener!({
      data: {
        type: 'identify_normal_artian_counter',
        requestId: 'normal-identification.attached',
        input: input(0, 10),
      },
    })
    await vi.waitFor(() => {
      expect(posted.at(-1)).toEqual({
        type: 'normal_artian_counter_identification_result',
        requestId: 'normal-identification.attached',
        result: {
          matches: [{ startNormalCounter: 4 }],
          searchedCounterRange: { startInclusive: 0, endInclusive: 10 },
          isTruncated: false,
        },
      })
    })
    expect(controller.isCancelled('normal-identification.attached')).toBe(false)
  })

  it('creates a Worker-local Production Engine without activating Seed Search capability', () => {
    const engine = createProductionNormalArtianCounterIdentificationRngEngine()
    expect(engine).toBeInstanceOf(ProductionRngEngine)
    expect(engine.capabilities.supportsNormalArtianPrediction).toBe(true)
    expect(engine.capabilities.supportsSeedSearch).toBe(false)
  })
})
