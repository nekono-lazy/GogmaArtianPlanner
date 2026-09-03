import type { SkillIdentificationWorkerClient } from '../services/rngIdentification/skillIdentificationWorkerClient'
import { createProductionSkillIdentificationWorkerClient } from '../services/rngIdentification/skillIdentificationWorkerClient'
import { createMultiWorkerSkillIdentificationClient } from '../services/rngIdentification/multiWorkerSkillIdentificationClient'

/** C5-E2C8-only seam; normal UI keeps navigator.hardwareConcurrency policy. */
export type BrowserBenchmarkWorkerCount = 1 | 2 | 4

export interface BrowserBenchmarkClientDependencies {
  readonly workerClientFactory?: () => SkillIdentificationWorkerClient
}

export function createBrowserBenchmarkSkillIdentificationClient(
  workerCount: BrowserBenchmarkWorkerCount,
  dependencies: BrowserBenchmarkClientDependencies = {},
): SkillIdentificationWorkerClient {
  return createMultiWorkerSkillIdentificationClient({
    hardwareConcurrency: workerCount,
    workerClientFactory:
      dependencies.workerClientFactory ?? createProductionSkillIdentificationWorkerClient,
  })
}
