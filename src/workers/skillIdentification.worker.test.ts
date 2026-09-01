import { describe, expect, it } from 'vitest'
import {
  referenceSkillCombinationFromIndex,
} from '../domain/rng/production/referenceSkillPools'
import type {
  CompleteSkillObservation,
  SkillIdentificationInput,
  SkillIdentificationWorkerRequest,
  SkillIdentificationWorkerResponse,
} from '../domain/rng/identification'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { createSkillIdentificationWorkerController } from './skillIdentification.worker'
import { createProductionSkillIdentificationRngEngine } from './skillIdentification.worker.production'

const observations: CompleteSkillObservation[] = [275, 255, 245, 243]
  .map(referenceSkillCombinationFromIndex)
  .map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId }))

function input(seedEnd = 8_500_100): SkillIdentificationInput {
  return {
    weaponTypeId: 'weapon.insect_glaive',
    elementId: 'element.thunder',
    observations,
    seedRange: { startInclusive: 8_500_000, endInclusive: seedEnd },
    skillCounterRange: { startInclusive: 180, endInclusive: 190 },
  }
}

describe('Skill Identification Worker', () => {
  it('keeps Engine/functions outside the structured-clone request', () => {
    const request: SkillIdentificationWorkerRequest = {
      type: 'identify_skill_seed_counter',
      requestId: 'skill-identification.clone',
      input: input(),
    }
    expect(request).not.toHaveProperty('rngEngine')
    expect(request.input).not.toHaveProperty('rngEngine')
    expect(structuredClone(request)).toEqual(request)
  })

  it('returns request-scoped progress and a Production result', async () => {
    const responses: SkillIdentificationWorkerResponse[] = []
    const controller = createSkillIdentificationWorkerController(
      createProductionSkillIdentificationRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_skill_seed_counter',
      requestId: 'skill-identification.production',
      input: {
        ...input(8_550_000),
        maxMatches: 10,
      },
    })

    expect(responses.some(({ type }) => type === 'progress')).toBe(true)
    expect(responses.at(-1)).toEqual({
      type: 'skill_identification_result',
      requestId: 'skill-identification.production',
      result: {
        matches: [{ baseSeed: 8_524_433, startSkillCounter: 186 }],
        searchedSeedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
        isTruncated: false,
      },
    })
  })

  it('does not let a reused requestId clear cancellation and cleans it after termination', async () => {
    const responses: SkillIdentificationWorkerResponse[] = []
    const holder: {
      controller?: ReturnType<typeof createSkillIdentificationWorkerController>
      duplicate?: Promise<void>
    } = {}
    let cancellationSent = false
    const controller = createSkillIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => {
        responses.push(response)
        if (response.type === 'progress' && !cancellationSent) {
          cancellationSent = true
          void holder.controller?.handleMessage({
            type: 'cancel',
            requestId: 'skill-identification.cancel',
          })
          holder.duplicate = holder.controller?.handleMessage({
            type: 'identify_skill_seed_counter',
            requestId: 'skill-identification.cancel',
            input: input(8_500_010),
          })
        }
      },
    )
    holder.controller = controller
    await controller.handleMessage({
      type: 'identify_skill_seed_counter',
      requestId: 'skill-identification.cancel',
      input: {
        ...input(8_530_000),
        observations: observations.slice(0, 1),
      },
    })

    await holder.duplicate
    expect(responses.some(({ type }) => type === 'progress')).toBe(true)
    expect(responses).toContainEqual(expect.objectContaining({
      type: 'error',
      requestId: 'skill-identification.cancel',
      code: 'invalid_input',
    }))
    expect(
      responses.some(({ type }) => type === 'skill_identification_result'),
    ).toBe(false)
    expect(controller.isCancelled('skill-identification.cancel')).toBe(false)

    responses.length = 0
    await controller.handleMessage({
      type: 'identify_skill_seed_counter',
      requestId: 'skill-identification.cancel',
      input: {
        ...input(8_524_433),
        seedRange: { startInclusive: 8_524_433, endInclusive: 8_524_433 },
        skillCounterRange: { startInclusive: 186, endInclusive: 186 },
      },
    })
    expect(responses.at(-1)).toEqual(expect.objectContaining({
      type: 'skill_identification_result',
      requestId: 'skill-identification.cancel',
    }))
  })

  it('preserves known validation errors in the Worker response', async () => {
    const responses: SkillIdentificationWorkerResponse[] = []
    const controller = createSkillIdentificationWorkerController(
      new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'identify_skill_seed_counter',
      requestId: 'skill-identification.invalid',
      input: {
        ...input(),
        seedRange: { startInclusive: 2, endInclusive: 1 },
      },
    })
    expect(responses).toEqual([
      expect.objectContaining({
        type: 'error',
        requestId: 'skill-identification.invalid',
        code: 'invalid_input',
      }),
    ])
  })

  it('creates a Worker-local Production Engine without activating Seed Search capability', () => {
    const engine = createProductionSkillIdentificationRngEngine()
    expect(engine).toBeInstanceOf(ProductionRngEngine)
    expect(engine.capabilities.supportsSkillPrediction).toBe(true)
    expect(engine.capabilities.supportsSeedSearch).toBe(false)
  })
})
