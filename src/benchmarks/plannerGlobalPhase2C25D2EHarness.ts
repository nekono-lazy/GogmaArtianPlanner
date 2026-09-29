/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-e: main-thread runner. Research only; benchmark.html only.
 *
 * It is the Phase 2-C2.5-B runner - exactly as D2-b used it: one fresh Dedicated Worker per run, every page-observable
 * outcome kept apart, the `phase2c25bRepeatDecision()` rule, the relay of every lifecycle event for the external CDP driver,
 * the 20-minute Search budget - with the D2-e identity:
 *
 * - the Worker is the D2-e benchmark Worker, and every message crosses the Worker boundary on the `pg2c25d2e_benchmark_*`
 *   wire (the adapter below renames the prefix only; a Phase 2-C2.5-B or D2-b message is ignored);
 * - the relay prefix is `[pg2c25d2e]`, the protocol version and record IDs are D2-e's;
 * - the workload is `phase2c25d2eWorkload()`: the D2-b rule over the C2.5-A evidence, confirmed against the committed D2-d
 *   RESULT, which must therefore be loaded first and must have measured the same Export and evidence (fail closed).
 *
 * The only Search input is the PlannerInput the page built from the original Export. The D2-d RESULT and the evidence
 * never reach a Worker.
 */
import type { BenchmarkWorkerLike } from './constrainedEnumerationBrowserBenchmark'
import type { Phase2C25BEvidenceView } from './plannerGlobalPhase2C25BEvidence'
import { createPhase2C25BRunner, type Phase2C25BFileInfo, type Phase2C25BRunnerDependencies } from './plannerGlobalPhase2C25BHarness'
import type { Phase2C25BRequest } from './plannerGlobalPhase2C25BProtocol'
import { parsePhase2C25D2EReference, phase2c25d2eWorkload, type Phase2C25D2EReference, type Phase2C25D2EWorkloadContext } from './plannerGlobalPhase2C25D2E'
import {
  fromPhase2C25D2EResponse,
  PHASE2C25D2E_PROTOCOL_VERSION,
  PHASE2C25D2E_RELAY_PREFIX,
  toPhase2C25D2ERequest,
} from './plannerGlobalPhase2C25D2EProtocol'

/**
 * The runner's view of a D2-e Worker: requests are renamed onto the D2-e wire, D2-e responses renamed back, and any other
 * `message` (a Phase 2-C2.5-B / D2-b one included) never reaches the runner. `error` / `messageerror` pass through unchanged.
 */
export function adaptPhase2C25D2EWorker(worker: BenchmarkWorkerLike): BenchmarkWorkerLike {
  const wrapped = new Map<(event: Event) => void, (event: Event) => void>()
  return {
    postMessage: message => worker.postMessage(toPhase2C25D2ERequest(message as Phase2C25BRequest)),
    addEventListener: (type, listener) => {
      if (type !== 'message') { worker.addEventListener(type, listener); return }
      const translated = (event: Event) => {
        const data = fromPhase2C25D2EResponse((event as MessageEvent<unknown>).data)
        if (data !== null) listener({ data } as MessageEvent<unknown>)
      }
      wrapped.set(listener, translated)
      worker.addEventListener(type, translated)
    },
    removeEventListener: (type, listener) => {
      if (type !== 'message') { worker.removeEventListener(type, listener); return }
      const translated = wrapped.get(listener)
      if (translated) { wrapped.delete(listener); worker.removeEventListener(type, translated) }
    },
    terminate: () => worker.terminate(),
  }
}

function createPhase2C25D2EWorker(): BenchmarkWorkerLike {
  return new Worker(new URL('../workers/plannerGlobalPhase2C25D2E.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as BenchmarkWorkerLike
}

export interface Phase2C25D2EReferenceInfo extends Phase2C25BFileInfo {
  readonly measuredHead: string
  readonly exportSha256: string
  readonly c25aEvidenceSha256: string
  readonly validation: Phase2C25D2EReference['validation']
  readonly selection: Phase2C25D2EReference['selection']
}

export interface Phase2C25D2ERunnerDependencies extends Omit<Phase2C25BRunnerDependencies, 'phase'> {
  /** Tests only: a synthetic scenario too small for the D2-b rule. The page always uses `phase2c25d2eWorkload()`. */
  readonly selectWorkload?: (view: Phase2C25BEvidenceView, json: unknown, reference: Phase2C25D2EReference) => Phase2C25D2EWorkloadContext[]
}

export function createPhase2C25D2ERunner(dependencies: Phase2C25D2ERunnerDependencies) {
  const { selectWorkload = phase2c25d2eWorkload, createWorker = createPhase2C25D2EWorker, ...rest } = dependencies
  let reference: Phase2C25D2EReference | null = null
  let referenceInfo: Phase2C25D2EReferenceInfo | null = null
  const requireReference = () => {
    if (reference === null) throw new Error('Load the Phase 2-C2.5-D2-d RESULT first: it confirms the workload.')
    return reference
  }
  const base = createPhase2C25BRunner({
    relay: event => console.info(PHASE2C25D2E_RELAY_PREFIX, JSON.stringify(event)),
    createRequestId: () => `pg2c25d2e-${crypto.randomUUID()}`,
    ...rest,
    createWorker: () => adaptPhase2C25D2EWorker(createWorker()),
    phase: { protocolVersion: PHASE2C25D2E_PROTOCOL_VERSION, recordIdPrefix: 'pg2c25d2e-record-', workload: (view, json) => selectWorkload(view, json, requireReference()) },
  })

  /** The committed D2-d RESULT: formal reference checks, fail closed; replacing it invalidates nothing loaded later (load it first). */
  async function loadD2DReference(bytes: ArrayBuffer, fileName: string): Promise<Phase2C25D2EReferenceInfo> {
    if (base.exportInfo() !== null || base.evidenceInfo() !== null) throw new Error('Load the D2-d RESULT before the Export and the evidence.')
    const sha256 = await dependencies.sha256Bytes(bytes)
    reference = null
    referenceInfo = null
    const parsed = parsePhase2C25D2EReference(JSON.parse(new TextDecoder().decode(bytes)))
    reference = parsed
    referenceInfo = { fileName, byteSize: bytes.byteLength, sha256, measuredHead: parsed.measuredHead, exportSha256: parsed.exportSha256,
      c25aEvidenceSha256: parsed.c25aEvidenceSha256, validation: parsed.validation, selection: parsed.selection }
    dependencies.onChange?.()
    return referenceInfo
  }

  /** The Export the D2-d RESULT measured, byte for byte (SHA-256), else nothing is loaded. */
  async function loadExport(bytes: ArrayBuffer, fileName: string): Promise<Phase2C25BFileInfo> {
    const expected = requireReference().exportSha256
    const sha256 = await dependencies.sha256Bytes(bytes)
    if (sha256 !== expected) throw new Error('The Export differs from the one the D2-d RESULT measured.')
    return base.loadExport(bytes, fileName)
  }

  /** The C2.5-A evidence the D2-d RESULT selected from, byte for byte (SHA-256), else nothing is loaded. */
  async function loadEvidence(bytes: ArrayBuffer, fileName: string): Promise<Phase2C25BFileInfo> {
    const expected = requireReference().c25aEvidenceSha256
    const sha256 = await dependencies.sha256Bytes(bytes)
    if (sha256 !== expected) throw new Error('The Phase 2-C2.5-A evidence differs from the one the D2-d RESULT used.')
    return base.loadEvidence(bytes, fileName)
  }

  return {
    ...base,
    loadD2DReference,
    loadExport,
    loadEvidence,
    d2dReferenceInfo: () => referenceInfo,
    selectedContexts: () => base.selectedContexts() as Phase2C25D2EWorkloadContext[],
    /** The Phase 2-C2.5-B page export with the D2-d reference identity appended (the base fields unchanged, in their order). */
    exportJson: (environment: Record<string, unknown>) => {
      const parsed = JSON.parse(base.exportJson(environment)) as Record<string, unknown>
      return JSON.stringify({ ...parsed, d2dReferenceInfo: referenceInfo }, null, 2)
    },
  }
}
export type Phase2C25D2ERunner = ReturnType<typeof createPhase2C25D2ERunner>
