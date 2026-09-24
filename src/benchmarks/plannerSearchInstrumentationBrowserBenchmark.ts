import type { MasterDataRoot } from '../domain/master/masterTypes'
import { prepareExportRootForImport } from '../domain/models/publicTypes'
import type { PlannerInput, PlannerOptions, PlannerSearchDepthMetrics } from '../domain/planner'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import { validateExportRootForFullReplacement } from '../services/dataTransfer/importExportValidation'
import type { PlannerSearchInstrumentationRunResult } from './plannerSearchInstrumentationBenchmark'
import type {
  PlannerSearchInstrumentationBenchmarkRequest,
  PlannerSearchInstrumentationBenchmarkResponse,
  PlannerSearchInstrumentationBenchmarkSource,
} from '../workers/plannerSearchInstrumentation.worker.benchmark'

/**
 * Issue #103 Browser benchmark client. One run owns one freshly created
 * benchmark Worker, terminated when the run settles. Nothing is persisted.
 */

export interface PlannerSearchInstrumentationBrowserRun {
  readonly entryCount: number
  readonly roundTripMs: number
  readonly result: PlannerSearchInstrumentationRunResult
}

export interface PlannerSearchInstrumentationBrowserRunHandle {
  readonly promise: Promise<PlannerSearchInstrumentationBrowserRun>
  cancel(): void
}

export function createPlannerSearchInstrumentationBenchmarkWorker(): Worker {
  return new Worker(
    new URL('../workers/plannerSearchInstrumentation.worker.benchmark.entry.ts', import.meta.url),
    { type: 'module' },
  )
}

export function startPlannerSearchInstrumentationBrowserRun(
  request: {
    source: PlannerSearchInstrumentationBenchmarkSource
    options: PlannerOptions
    instrumented: boolean
    collectDiagnosticProjections: boolean
  },
  onDepth: (depth: PlannerSearchDepthMetrics, elapsedMs: number) => void,
  createWorker: () => Worker = createPlannerSearchInstrumentationBenchmarkWorker,
  now: () => number = () => performance.now(),
): PlannerSearchInstrumentationBrowserRunHandle {
  const requestId = `issue103-${Math.random().toString(36).slice(2)}`
  const worker = createWorker()
  const promise = new Promise<PlannerSearchInstrumentationBrowserRun>((resolve, reject) => {
    const startedAt = now()
    worker.addEventListener(
      'message',
      (event: MessageEvent<PlannerSearchInstrumentationBenchmarkResponse>) => {
        const response = event.data
        if (response.requestId !== requestId) return
        if (response.type === 'issue103_depth') {
          onDepth(response.depth, response.elapsedMs)
          return
        }
        worker.terminate()
        if (response.type === 'issue103_error') {
          reject(new Error(response.message))
          return
        }
        resolve({
          entryCount: response.entryCount,
          roundTripMs: now() - startedAt,
          result: response.result,
        })
      },
    )
    worker.addEventListener('error', (event) => {
      worker.terminate()
      reject(new Error(event.message || 'The benchmark Worker failed.'))
    })
    const message: PlannerSearchInstrumentationBenchmarkRequest = {
      type: 'issue103_run',
      requestId,
      ...request,
    }
    worker.postMessage(message)
  })
  return {
    promise,
    cancel: () => {
      const message: PlannerSearchInstrumentationBenchmarkRequest = {
        type: 'issue103_cancel',
        requestId,
      }
      worker.postMessage(message)
    },
  }
}

export type ExportPlannerInputResult =
  | { ok: true; input: PlannerInput }
  | { ok: false; message: string }

/**
 * Builds a PlannerInput from a pasted Export JSON entirely in memory, through
 * the same Import validation and the same `createPlannerInput()` assembly the
 * Build List uses. Nothing is written to IndexedDB; the pasted text and the
 * input live only in this page.
 */
export async function createPlannerInputFromExportJson(
  json: string,
  master: MasterDataRoot,
  rngEngineVersion: string,
): Promise<ExportPlannerInputResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { ok: false, message: `JSONとして読み取れません: ${error instanceof Error ? error.message : String(error)}` }
  }
  const migrated = prepareExportRootForImport(parsed)
  if (!migrated.ok) {
    return { ok: false, message: migrated.issues.map(({ path, message }) => `${path}: ${message}`).join('\n') }
  }
  const validation = validateExportRootForFullReplacement(migrated.root, master)
  if (!validation.isValid) {
    return { ok: false, message: validation.issues.map(({ path, message }) => `${path}: ${message}`).join('\n') }
  }
  const root = migrated.root
  const rngState = root.rngState
  if (rngState === null) return { ok: false, message: 'Export に RngState がありません。' }
  const input = await createPlannerInput(
    master,
    createPlannerCalculationContext(master, rngEngineVersion),
    {
      ensureInitialRngState: async () => rngState,
      getAllNormalArtianCounters: async () => root.normalArtianCounters,
      getAllOwnedWeapons: async () => root.ownedWeapons,
      getAllTargetWeapons: async () => root.targetWeapons,
      getAllBuildListEntries: async () => root.buildListEntries,
    },
  )
  return { ok: true, input }
}
