import { loadMasterData } from '../../domain/master/loadMasterData'
import type { BuildListOptimizationWorkerEvent } from '../../services/planner/buildListOptimizationWorkerClient'
import type { BuildListOptimizationWorkerScope } from '../../workers/buildListOptimization.worker'
import { attachBuildListOptimizationBenchmarkWorker } from '../../workers/buildListOptimization.worker.benchmark'
import type { BloRunRecord, BloSlotSpec } from './buildListOptimizationBenchmarkProtocol'
import type { BloRawWorker, BloRunnerPorts } from './buildListOptimizationBenchmarkRunner'
import { bloSyntheticBounds, bloSyntheticExportText } from './buildListOptimizationBenchmarkSynthetic'

/**
 * Issue #260 PR-5A test fixture: the measurement Worker in process. The real benchmark entry logic
 * (`attachBuildListOptimizationBenchmarkWorker()` over the Production controller, adapter, Engine, ID factory and Clock) runs on a fake
 * Worker scope whose messages are structured-cloned and delivered asynchronously in both directions; a listener that throws becomes
 * the Worker's `error` event; `terminate()` stops every later delivery (the calculation itself cannot be stopped in process, but
 * nothing it posts afterwards is delivered, as with a terminated Worker).
 */

export const TEST_MEASUREMENT_HEAD = 'a'.repeat(40)
export const TEST_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'

export interface InProcessWorker extends BloRawWorker {
  /** Every message the main thread posted, in order (structured clones). */
  readonly posted: unknown[]
  isTerminated(): boolean
}

export function createInProcessMeasurementWorker(): InProcessWorker {
  const main = { message: new Set<(event: BuildListOptimizationWorkerEvent) => void>(), error: new Set<(event: BuildListOptimizationWorkerEvent) => void>(), messageerror: new Set<(event: BuildListOptimizationWorkerEvent) => void>() }
  const inside = new Set<(event: { data: unknown }) => void>()
  let terminated = false
  const posted: unknown[] = []
  const later = (deliver: () => void) => setTimeout(() => { if (!terminated) deliver() }, 0)
  const scope: BuildListOptimizationWorkerScope = {
    postMessage: (response) => {
      const data = structuredClone(response)
      later(() => { for (const listener of [...main.message]) listener({ data }) })
    },
    addEventListener: (_type, listener) => { inside.add(listener) },
  }
  attachBuildListOptimizationBenchmarkWorker(scope)
  return {
    posted,
    isTerminated: () => terminated,
    postMessage: (message) => {
      const data = structuredClone(message)
      posted.push(data)
      later(() => {
        for (const listener of inside) {
          try {
            listener({ data })
          } catch (error) {
            later(() => { for (const onError of [...main.error]) onError({ message: error instanceof Error ? error.message : String(error) }) })
          }
        }
      })
    },
    addEventListener: (type, listener) => { main[type].add(listener) },
    removeEventListener: (type, listener) => { main[type].delete(listener) },
    terminate: () => { terminated = true },
  }
}

const master = (() => {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('The Master Data does not load.')
  return loaded.data
})()

export async function testSha256(text: string): Promise<string> {
  // Copied into this realm: a jsdom TextEncoder buffer is not an ArrayBuffer of the realm Web Crypto checks.
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(new TextEncoder().encode(text)))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export interface TestPorts extends BloRunnerPorts {
  readonly workers: InProcessWorker[]
  readonly memoryLabels: string[]
}

export function createTestRunnerPorts(overrides: Partial<BloRunnerPorts> = {}): TestPorts {
  const workers: InProcessWorker[] = []
  const memoryLabels: string[] = []
  const ports: BloRunnerPorts = {
    master,
    createMeasurementWorker: () => {
      const worker = createInProcessMeasurementWorker()
      workers.push(worker)
      return worker
    },
    now: () => performance.now(),
    isoNow: () => new Date().toISOString(),
    sha256Text: testSha256,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    environment: () => ({ userAgent: TEST_USER_AGENT, language: 'ja', hardwareConcurrency: 16, deviceMemory: 8, crossOriginIsolated: false, isSecureContext: true, visibilityAtStart: 'visible' }),
    build: () => ({ commit: TEST_MEASUREMENT_HEAD, uncommittedBenchmarkCode: false, benchmarkCodeSha256: 'b'.repeat(64) }),
    readMemory: async (label, atMs) => {
      memoryLabels.push(label)
      return { label, atMs, mainHeap: { usedJSHeapSize: 1000 + memoryLabels.length, totalJSHeapSize: 4000, jsHeapSizeLimit: 8000 }, userAgentSpecific: null, error: null }
    },
    readStorage: async () => ({ indexedDbDatabases: 0, localStorageKeys: 0, sessionStorageKeys: 0, cacheKeys: 0, serviceWorkerRegistrations: 0 }),
    observeLongTasks: () => ({ stop: () => ({ observed: true, entries: [] }) }),
    observeLifecycle: () => () => undefined,
    pageLifecycle: null,
    lateMessageWaitMs: 0,
    ...overrides,
  }
  return Object.assign(ports, { workers, memoryLabels })
}

export function testSlot(overrides: Partial<BloSlotSpec> & { boundsId?: string } = {}): BloSlotSpec {
  const boundsId = overrides.boundsId ?? 'synthetic.open'
  return {
    slotId: 'test.slot', purpose: 'mechanics', planned: true, inputId: 'sanity-3', boundsId, bounds: bloSyntheticBounds(boundsId).bounds,
    cancelTrigger: null, faultInjection: null, memory: null, ...overrides,
  }
}

export async function testInput(caseId = 'synthetic.sanity-3') {
  const text = bloSyntheticExportText(caseId)
  return { text, identity: { kind: 'synthetic' as const, caseId, bytes: new TextEncoder().encode(text).length, sha256: await testSha256(text) } }
}

/** A valid record of the given slot, for analysis tests that need no calculation (every field explicit). */
export function fabricatedRecord(spec: BloSlotSpec, overrides: Partial<BloRunRecord> = {}): BloRunRecord {
  return {
    kind: 'build-list-optimization-browser-run',
    recordProtocol: 'build-list-optimization-browser-record:1',
    recordId: `test#${spec.slotId}`,
    sequence: 1,
    startedAt: '2026-10-15T00:00:00.000Z',
    endedAt: '2026-10-15T00:00:40.000Z',
    slot: { slotId: spec.slotId, purpose: spec.purpose, planned: spec.planned, inputId: spec.inputId, boundsId: spec.boundsId, cancelTrigger: spec.cancelTrigger, faultInjection: spec.faultInjection, memory: spec.memory },
    bounds: structuredClone(spec.bounds),
    protocols: { worker: 'build-list-optimization:1', benchmarkConfig: 'build-list-optimization-benchmark:1' },
    build: { commit: TEST_MEASUREMENT_HEAD, uncommittedBenchmarkCode: false, benchmarkCodeSha256: 'b'.repeat(64) },
    environment: { userAgent: TEST_USER_AGENT, language: 'ja', hardwareConcurrency: 16, deviceMemory: 8, crossOriginIsolated: spec.purpose === 'memory', isSecureContext: true, visibilityAtStart: 'visible' },
    input: {
      identity: { kind: 'export', fileName: 'export.json', bytes: 100, sha256: 'c'.repeat(64) },
      preparation: { status: 'ready', refusal: null, preparationMs: 900, calculationContext: { gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }, counts: { targetWeapons: 43, buildListEntries: 43, ownedWeapons: 40, normalCounters: 5 }, draftPresent: false },
    },
    timeline: {
      inputPreparedAtMs: 900, workerCreateStartedAtMs: 950, workerCreatedAtMs: 960, boundsPostedAtMs: 961, runPostStartedAtMs: 962, runPostedAtMs: 1000,
      progress: [{ stage: 'input_check', receivedAtMs: 1100 }, { stage: 'reach_table', receivedAtMs: 2000 }, { stage: 'assignment_search', receivedAtMs: 11000 }, { stage: 'route_generation', receivedAtMs: 12000 }, { stage: 'plan_verification', receivedAtMs: 13000 }],
      terminalReceivedAtMs: 21000, terminalType: 'blo_result', terminalDataReadMs: 30, clientHandlingMs: 120, cancelRequestedAtMs: null, outcomeAtMs: 21200, finishedAtMs: 22000,
    },
    outcome: { status: 'completed', failure: null, cancelReason: null, lastStage: 'plan_verification' },
    result: {
      status: 'optimized', planningTargetCount: 43, completedTargetCount: 43, physicalOperationCount: 1766, planStepCount: 1766, nonPhysicalStepCount: 0, structuralObjective: 1766,
      maxPlanSteps: 2500, conflictCount: 0, rejectedEntryCount: 0, warningCount: 0, generatedEntryCount: 43, unchangedTargetCount: 0, inputExclusionCount: 0,
      outOfScopeTargetCounts: { noEntry: 0, excludedEntryOnly: 0, disabled: 0, completed: 0 }, boundKinds: [], notFoundReason: null, unsupportedReasonKinds: [],
      diagnostics: {
        reachTable: { window: { ...spec.bounds.window }, predictions: { skill: 1, gogmaReset: 1, gogmaKeep: 1, normal: 1 }, memoHits: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, supportQueries: 1 },
        structuralSearch: { completeness: 'running', expandedNodes: 44, coverageRejections: 0, structuralCandidates: 1, noStructuralCandidateReason: null },
        candidates: [{ ordinal: 0, objective: 1766, routeGeneration: { outcome: 'all_generated', generatedTargetCount: 43, methods: { candidate_search_projected: 21, shape_constrained: 22 } }, verification: { outcome: 'optimized', maxPlanSteps: 2500, fullPlannerRuns: 1, rejectionCodes: [] } }],
        plannerVerifications: 1,
        workerStageMs: { input_check: 900, reach_table: 9000, assignment_search: 1000, route_generation: 1000, plan_verification: 8000 },
      },
      semantic: { sha256: 'd'.repeat(64), components: { status: 'e'.repeat(64) } },
    },
    lateMessages: { count: 0, types: [] },
    memory: [],
    mainThread: { longTaskObserved: true, longTaskCount: 1, longTaskMaxMs: 150, longTaskTotalMs: 150 },
    interruptions: [],
    storage: { before: { indexedDbDatabases: 0, localStorageKeys: 0, sessionStorageKeys: 0, cacheKeys: 0, serviceWorkerRegistrations: 0 }, after: { indexedDbDatabases: 0, localStorageKeys: 0, sessionStorageKeys: 0, cacheKeys: 0, serviceWorkerRegistrations: 0 } },
    integrityIssues: [],
    ...overrides,
  }
}
