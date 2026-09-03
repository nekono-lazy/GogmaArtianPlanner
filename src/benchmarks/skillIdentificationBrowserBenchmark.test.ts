import { describe, expect, it } from 'vitest'
import { identifySkillSeedAndCounter, type SkillIdentificationInput } from '../domain/rng/identification'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { referenceSkillCombinationFromIndex } from '../domain/rng/production/referenceSkillPools'
import type { SkillIdentificationWorkerClient, SkillIdentificationWorkerClientCallbacks } from '../services/rngIdentification/skillIdentificationWorkerClient'
import { selectSkillIdentificationWorkerCount } from '../services/rngIdentification/multiWorkerSkillIdentificationClient'
import { createBrowserBenchmarkSkillIdentificationClient } from './skillIdentificationBrowserBenchmark'

class KernelChildClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = 'production-rng:c5-e2'
  identify(_requestId: string, input: SkillIdentificationInput, callbacks: SkillIdentificationWorkerClientCallbacks = {}) {
    return identifySkillSeedAndCounter(input, new ProductionRngEngine(), { onProgress: callbacks.onProgress })
  }
  cancel(): void {}
  dispose(): void {}
}

const input: SkillIdentificationInput = {
  weaponTypeId: 'weapon.insect_glaive',
  elementId: 'element.thunder',
  observations: [275, 255, 245, 243].map(referenceSkillCombinationFromIndex).map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId })),
  seedRange: { startInclusive: 8_500_000, endInclusive: 8_550_000 },
  skillCounterRange: { startInclusive: 180, endInclusive: 190 },
}

describe('C8 browser benchmark construction seam', () => {
  it.each([1, 2, 4] as const)('preserves the complete bounded golden result with an explicit %s-Worker pool', async (workerCount) => {
    const expected = await identifySkillSeedAndCounter(input, new ProductionRngEngine())
    const client = createBrowserBenchmarkSkillIdentificationClient(workerCount, { workerClientFactory: () => new KernelChildClient() })
    await expect(client.identify(`benchmark.${workerCount}`, input)).resolves.toEqual(expected)
    client.dispose()
  }, 30_000)

  it('does not alter the normal Production worker-count policy', () => {
    expect(selectSkillIdentificationWorkerCount(undefined)).toBe(1)
    expect(selectSkillIdentificationWorkerCount(3)).toBe(2)
    expect(selectSkillIdentificationWorkerCount(8)).toBe(4)
  })
})
