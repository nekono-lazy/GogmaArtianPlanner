/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The environment-neutral first / fresh stages of one Global Assignment logical run (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md`
 * 6.2): the very calculation sequence of the D-1A child processes (`scripts/run-planner-global-assignment-d1a.mjs`), with every
 * environment dependency injected - the Export bytes, SHA-256, clock, cancel, yield, progress, Engine construction and PlannerInput
 * construction. The Browser Worker controller and the Vitest tests call this one module; nothing here reads a file, a clock, a random
 * value, a persisted record, an oracle or an expected result.
 *
 * first: Export bytes -> SHA-256 (over the raw bytes) -> UTF-8 decode (Node `Buffer.toString('utf8')` compatible) -> JSON.parse ->
 *        PlannerInput -> Phase 0 -> A -> B / C -> D (`runMaterializationSmoke()`) -> materialization semantic SHA-256 -> Entry set ->
 *        Phase D' (`verifyPlannerCandidate()` with a new Engine and new Planner dependencies) -> verification semantic SHA-256
 * fresh: the same Export bytes -> its own PlannerInput -> its own Phase 0 (`createGlobalAssignmentContext()`) -> the first Worker's Entry
 *        set re-checked (`d1aEntrySetIssues()`) -> Phase D' with a new Engine -> verification semantic SHA-256
 *
 * Invariants (design 6.2; fixed by `globalAssignmentBrowserStages.test.ts`): the PlannerInput is `buildInput(JSON.parse(text))` (the Worker
 * entry builds it with the validation-only `maxPlanSteps` 1,000), Phase D' takes the Research `maxPlanSteps` from the conditions, the
 * dependencies are built in the D-1A order, the conditions come from the caller alone (the Worker entry: `registeredD1cConditions()`),
 * the semantic SHA-256 is over `JSON.stringify(semantic)`, the verification budget is the registered one (exactly one handoff is
 * verified; a second handoff is an integrity issue, never verified), and no typed outcome is re-classified here. Unlike the D-1A runner
 * there is no D-0C identity check: the materialization goes to Phase D' as it is, and every comparison with a recorded value is post hoc.
 */
import type { CalculationContext } from '../../../domain/models/publicTypes'
import type { PlannerInput } from '../../../domain/planner/plannerTypes'
import type { RngEngine } from '../../../domain/rng/rngEngine'
import { globalResearchDependencies } from '../../plannerGlobalOptimizationResearch'
import type { ExportIdentity } from '../assignmentProtocol'
import { createGlobalAssignmentContext } from '../context'
import type { ShapeMaterializationResearchConditions } from '../materializationProtocol'
import { runMaterializationSmoke, summarizeMaterializationRun, type MaterializedEntriesHandoff } from '../materializationRunner'
import {
  createD1aEntrySet, d1aEntrySetIssues, handoffFromEntrySet, materializedEntriesFingerprintOfHandoffs, materializedEntriesFingerprintOfSemantic, type D1aEntrySet,
} from '../verificationProtocol'
import { verifyPlannerCandidate } from '../verify'
import type { GabErrorCode, GabEvidenceStage, GabInputStage, GabProgressEvent, GabWorkerResult, GabWorkerTiming } from './globalAssignmentBrowserProtocol'

/** D-1A `PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY`: the PlannerInput's own bound (validation only; Phase D' writes the Research one). */
export const GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS = 1_000

/** The conditions of one logical run: the D-1C registration's materialization and Phase D' values (the Worker entry reads them). */
export interface GlobalAssignmentStageConditions {
  materialization: ShapeMaterializationResearchConditions
  verification: { researchMaxPlanSteps: number; verificationBudget: number }
}

/** Every environment dependency of a stage. */
export interface GlobalAssignmentStagePorts {
  /** The picked Export's bytes (Worker: `Blob.arrayBuffer()` or the transferred buffer). */
  readExport: () => Promise<ArrayBuffer>
  /** SHA-256 of raw bytes (Export identity; never of decoded text). */
  sha256Bytes: (bytes: ArrayBuffer) => Promise<string>
  /** SHA-256 of a text's UTF-8 bytes (semantic records). */
  sha256Text: (text: string) => Promise<string>
  now: () => number
  shouldCancel: () => boolean
  yieldControl: () => Promise<void>
  onEvent: (event: GabProgressEvent) => void
  /** A new Engine per call (Worker entry: `new ProductionRngEngine()`). */
  createEngine: () => RngEngine
  /** Worker entry: `json => globalResearchInputFromExport(json, GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS)`. */
  buildInput: (json: unknown) => PlannerInput
}

export interface GlobalAssignmentStageProvenance {
  /** The Export file name the caller observed; bytes and SHA-256 are this stage's own observation. */
  exportFileName: string
  /** The Export identity the main thread observed: a different byte length or SHA-256 refuses the run before decoding. */
  expectedExport: ExportIdentity
  /** The build commit the Entry set names and the fresh stage expects (a build provenance value, never a git observation). */
  buildCommit: string
}

/** A refusal of the stage (mapped to `gab_error` by the controller; never a Planner or materialization outcome). */
export class GlobalAssignmentBrowserStageError extends Error {
  readonly code: GabErrorCode
  readonly stage: string

  constructor(code: GabErrorCode, stage: string, message: string) {
    super(message)
    this.name = 'GlobalAssignmentBrowserStageError'
    this.code = code
    this.stage = stage
  }
}

/** The stage stopped at a boundary because the caller's cancel flag was set (best effort; the main thread decides adoption). */
export class GlobalAssignmentBrowserStageCancelled extends Error {
  readonly stage: string

  constructor(stage: string) {
    super(`Cancelled before ${stage}.`)
    this.name = 'GlobalAssignmentBrowserStageCancelled'
    this.stage = stage
  }
}

/** A stage's result: the Worker result without the Worker's own envelope (request ID, environment, observed slices). */
export type GlobalAssignmentStageResult = Omit<GabWorkerResult, 'protocolVersion' | 'requestId' | 'environment' | 'observed' | 'conditions' | 'formal' | 'oracleFreeExecution'> & {
  conditions: Omit<GabWorkerResult['conditions'], 'source'>
  timing: Omit<GabWorkerTiming, 'workerTotalMs'>
}

const TEXT_DECODER_OPTIONS = { fatal: false, ignoreBOM: true } as const
const sortedIds = (values: readonly string[]) => [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

/**
 * The text Node's `Buffer.toString('utf8')` gives for the same bytes: invalid sequences become U+FFFD and a leading BOM is kept
 * (a default `TextDecoder` would drop it). A BOM-led Export therefore fails `JSON.parse` in both environments alike.
 */
export function decodeExportText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8', TEXT_DECODER_OPTIONS).decode(bytes)
}

function assertConditions(conditions: GlobalAssignmentStageConditions): void {
  const { researchMaxPlanSteps, verificationBudget } = conditions.verification
  if (verificationBudget !== 1) throw new GlobalAssignmentBrowserStageError('condition_refused', 'conditions', `This stage verifies one structural candidate per run (verification budget ${String(verificationBudget)}).`)
  if (!Number.isSafeInteger(researchMaxPlanSteps) || researchMaxPlanSteps < 1) {
    throw new GlobalAssignmentBrowserStageError('condition_refused', 'conditions', `researchMaxPlanSteps must be a positive integer (got ${String(researchMaxPlanSteps)}).`)
  }
}

interface PreparedInput {
  input: PlannerInput
  exportObservation: ExportIdentity & { matchesRequest: boolean }
  timing: GabWorkerTiming['input']
}

/** Export bytes -> SHA-256 -> decode -> parse -> PlannerInput, each section timed and announced. The parse result is dropped afterwards. */
async function prepareInput(provenance: GlobalAssignmentStageProvenance, ports: GlobalAssignmentStagePorts): Promise<PreparedInput> {
  const started = ports.now()
  const section = async <T>(stage: GabInputStage, code: GabErrorCode, body: () => T | Promise<T>): Promise<{ value: T; ms: number }> => {
    ports.onEvent({ kind: 'input', stage, status: 'started' })
    const at = ports.now()
    let value: T
    try {
      value = await body()
    } catch (error) {
      if (error instanceof GlobalAssignmentBrowserStageError) throw error
      throw new GlobalAssignmentBrowserStageError(code, stage, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    }
    const ms = ports.now() - at
    ports.onEvent({ kind: 'input', stage, status: 'finished' })
    return { value, ms }
  }
  const read = await section('export_read', 'export_read_failed', () => ports.readExport())
  const bytes = read.value
  const hashed = await section('export_hash', 'export_read_failed', () => ports.sha256Bytes(bytes))
  const observation = { fileName: provenance.exportFileName, bytes: bytes.byteLength, sha256: hashed.value }
  const matchesRequest = observation.fileName === provenance.expectedExport.fileName && observation.bytes === provenance.expectedExport.bytes && observation.sha256 === provenance.expectedExport.sha256
  if (!matchesRequest) {
    throw new GlobalAssignmentBrowserStageError('export_changed', 'export_hash',
      `The Export this Worker read (${observation.fileName}, ${observation.bytes} bytes, ${observation.sha256}) is not the one the main thread observed (${provenance.expectedExport.fileName}, ${provenance.expectedExport.bytes} bytes, ${provenance.expectedExport.sha256}).`)
  }
  const decoded = await section('utf8_decode', 'input_build_failed', () => decodeExportText(bytes))
  const parsed = await section('json_parse', 'input_build_failed', () => JSON.parse(decoded.value) as unknown)
  const built = await section('input_build', 'input_build_failed', () => ports.buildInput(parsed.value))
  return {
    input: built.value,
    exportObservation: { ...observation, matchesRequest },
    timing: { exportReadMs: read.ms, exportHashMs: hashed.ms, decodeMs: decoded.ms, parseMs: parsed.ms, buildInputMs: built.ms, totalMs: ports.now() - started },
  }
}

function checkCancel(ports: GlobalAssignmentStagePorts, stage: string): void {
  if (ports.shouldCancel()) throw new GlobalAssignmentBrowserStageCancelled(stage)
}

async function evidence<T>(ports: GlobalAssignmentStagePorts, stage: GabEvidenceStage, body: () => Promise<T>): Promise<{ value: T; ms: number }> {
  ports.onEvent({ kind: 'evidence', stage, status: 'started' })
  const at = ports.now()
  const value = await body()
  const ms = ports.now() - at
  ports.onEvent({ kind: 'evidence', stage, status: 'finished' })
  return { value, ms }
}

/** Phase D' of one handoff with new Planner dependencies (a new Engine; the Plan's IDs never depend on an earlier run in the realm). */
async function verification(input: PlannerInput, handoff: MaterializedEntriesHandoff, conditions: GlobalAssignmentStageConditions, ports: GlobalAssignmentStagePorts) {
  const result = await verifyPlannerCandidate(input, handoff, globalResearchDependencies(ports.createEngine()), { researchMaxPlanSteps: conditions.verification.researchMaxPlanSteps }, {
    now: ports.now, shouldCancel: ports.shouldCancel, yieldControl: ports.yieldControl,
    onStage: event => ports.onEvent({ kind: 'verification', event: { ...event } }),
  })
  return result
}

function conditionsRecord(conditions: GlobalAssignmentStageConditions): GlobalAssignmentStageResult['conditions'] {
  return {
    materialization: structuredClone(conditions.materialization),
    researchMaxPlanSteps: conditions.verification.researchMaxPlanSteps,
    verificationBudget: conditions.verification.verificationBudget,
  }
}

/**
 * The first Worker's stage: input, materialization (Phase 0 -> A -> B / C -> D), the Entry set of an `all_materialized` handoff, and
 * Phase D' of the first handoff. Without a handoff (Phase 0 / A unsupported, no candidate, an incomplete or cancelled structural
 * search, a fail-closed materialization) Phase D' is not run and the materialization outcome is recorded as it is.
 */
export async function runFirstStage(conditions: GlobalAssignmentStageConditions, provenance: GlobalAssignmentStageProvenance, ports: GlobalAssignmentStagePorts): Promise<GlobalAssignmentStageResult> {
  assertConditions(conditions)
  const started = ports.now()
  const prepared = await prepareInput(provenance, ports)
  checkCancel(ports, 'materialization')
  const { input } = prepared
  // D-1A order: the materialization's Engine after the input, Phase D' on a new Engine.
  const engine = ports.createEngine()
  const handoffs: MaterializedEntriesHandoff[] = []
  const materializationStarted = ports.now()
  const run = await runMaterializationSmoke(input, globalResearchDependencies(engine), { conditions: conditions.materialization }, {
    now: ports.now, shouldCancel: ports.shouldCancel, yieldControl: ports.yieldControl,
    onProgress: event => ports.onEvent({ kind: 'materialization', event }),
    onMaterializedEntries: handoff => { handoffs.push(handoff) },
  })
  const materializationWallMs = ports.now() - materializationStarted
  const materializationHash = await evidence(ports, 'materialization_semantic_hash', () => ports.sha256Text(JSON.stringify(run.semantic)))

  // The materialization's own consistency (the D-1A identity check's parts that need no recorded value).
  const integrityIssues: string[] = []
  const budget = conditions.verification.verificationBudget
  if (handoffs.length > budget) integrityIssues.push(`The materialization handed over ${handoffs.length} candidates for a verification budget of ${budget}; only the first is verified.`)
  if (handoffs.length > 0) {
    const fromHandoffs = materializedEntriesFingerprintOfHandoffs(handoffs)
    const fromRecord = materializedEntriesFingerprintOfSemantic(run.semantic)
    if (fromHandoffs !== fromRecord) integrityIssues.push(`The handed-over Entry bodies (${String(fromHandoffs)}) are not the Entries the semantic record identifies (${String(fromRecord)}).`)
  }
  if (run.semantic.integrityIssues.length > 0) integrityIssues.push(`The materialization semantic record carries ${run.semantic.integrityIssues.length} integrity issues: ${run.semantic.integrityIssues.join(' / ')}`)

  const handoff = handoffs[0] ?? null
  let entrySet: GlobalAssignmentStageResult['entrySet'] = null
  let verified: GlobalAssignmentStageResult['verification'] = null
  let verificationWallMs: number | null = null
  let entrySetMs: number | null = null
  let verificationHashMs: number | null = null
  if (handoff !== null) {
    checkCancel(ports, 'phase_d_prime')
    // Design 7.4: an Entry set (the fresh Worker's input) exists only for an all_materialized candidate.
    if (handoff.stage.kind === 'all_materialized') {
      const built = await evidence(ports, 'entry_set', async () => {
        const value = createD1aEntrySet(handoff, { repositoryHeadSha: provenance.buildCommit, export: { fileName: prepared.exportObservation.fileName, bytes: prepared.exportObservation.bytes, sha256: prepared.exportObservation.sha256 },
          calculationContext: input.calculationContext, rngEngineVersion: engine.version })
        return { value, sha256: await ports.sha256Text(JSON.stringify(value)), entryFingerprint: value.entryFingerprint, entryCount: value.materializedEntries.length }
      })
      entrySet = built.value
      entrySetMs = built.ms
    }
    const verificationStarted = ports.now()
    const record = await verification(input, handoff, conditions, ports)
    verificationWallMs = ports.now() - verificationStarted
    const hashed = await evidence(ports, 'verification_semantic_hash', () => ports.sha256Text(JSON.stringify(record.semantic)))
    verificationHashMs = hashed.ms
    verified = { semantic: record.semantic, semanticSha256: hashed.value, observed: record.observed }
  }
  return {
    role: 'first',
    exportObservation: prepared.exportObservation,
    calculationContext: structuredClone(input.calculationContext) as CalculationContext,
    rngEngineVersion: engine.version,
    conditions: conditionsRecord(conditions),
    plannerInputMaxPlanStepsForValidationOnly: input.options.maxPlanSteps,
    phase0: { planningTargetCount: run.semantic.input.planningTargetCount, planningTargetIdsSorted: handoff === null ? null : sortedIds(handoff.planningTargetIds) },
    materialization: { semantic: run.semantic, semanticSha256: materializationHash.value, summary: summarizeMaterializationRun(run.semantic), observed: run.observed, handoffCount: handoffs.length },
    entrySet,
    freshEntrySet: null,
    verification: verified,
    integrityIssues,
    timing: {
      input: prepared.timing, phase0Ms: null, materializationWallMs, verificationWallMs,
      evidence: { materializationHashMs: materializationHash.ms, entrySetMs, verificationHashMs }, stageTotalMs: ports.now() - started,
    },
  }
}

/**
 * The fresh Worker's stage: its own input and Phase 0, the first Worker's Entry set re-checked against this Worker's own observations
 * (build commit, Export, CalculationContext, Engine, recomputed Entry fingerprint), then Phase D' on a new Engine. A Phase 0 that
 * refuses the input or an Entry set that fails the check is refused before any Planner run (as the D-1A fresh child refuses it).
 */
export async function runFreshStage(entrySet: unknown, conditions: GlobalAssignmentStageConditions, provenance: GlobalAssignmentStageProvenance, ports: GlobalAssignmentStagePorts): Promise<GlobalAssignmentStageResult> {
  assertConditions(conditions)
  const started = ports.now()
  const prepared = await prepareInput(provenance, ports)
  checkCancel(ports, 'phase0')
  const { input } = prepared
  const engine = ports.createEngine()
  ports.onEvent({ kind: 'input', stage: 'phase0', status: 'started' })
  const phase0Started = ports.now()
  // The fresh Worker's own Phase 0: the denominator is re-derived, never copied from the first Worker.
  const phase0 = createGlobalAssignmentContext(input, globalResearchDependencies(engine))
  const phase0Ms = ports.now() - phase0Started
  ports.onEvent({ kind: 'input', stage: 'phase0', status: 'finished' })
  if (phase0.kind !== 'context') throw new GlobalAssignmentBrowserStageError('fresh_phase0_refused', 'phase0', `The fresh Phase 0 refused the input: ${phase0.reason} (${phase0.detail})`)
  const recorded = typeof entrySet === 'object' && entrySet !== null && typeof (entrySet as { entryFingerprint?: unknown }).entryFingerprint === 'string'
    ? (entrySet as { entryFingerprint: string }).entryFingerprint : ''
  const issues = d1aEntrySetIssues(entrySet, {
    repositoryHeadSha: provenance.buildCommit, export: { fileName: prepared.exportObservation.fileName, bytes: prepared.exportObservation.bytes, sha256: prepared.exportObservation.sha256 },
    calculationContext: input.calculationContext, rngEngineVersion: engine.version, entryFingerprint: recorded,
  })
  if (issues.length > 0) throw new GlobalAssignmentBrowserStageError('entry_set_refused', 'entry_set', `The fresh Worker refused the Entry set: ${issues.join(' ')}`)
  const set = entrySet as D1aEntrySet
  checkCancel(ports, 'phase_d_prime')
  const phase0PlanningTargetIds = phase0.context.planningTargets.map(target => target.id as string)
  const verificationStarted = ports.now()
  const record = await verification(input, handoffFromEntrySet(set, phase0PlanningTargetIds), conditions, ports)
  const verificationWallMs = ports.now() - verificationStarted
  const hashed = await evidence(ports, 'verification_semantic_hash', () => ports.sha256Text(JSON.stringify(record.semantic)))
  return {
    role: 'fresh',
    exportObservation: prepared.exportObservation,
    calculationContext: structuredClone(input.calculationContext) as CalculationContext,
    rngEngineVersion: engine.version,
    conditions: conditionsRecord(conditions),
    plannerInputMaxPlanStepsForValidationOnly: input.options.maxPlanSteps,
    phase0: { planningTargetCount: phase0PlanningTargetIds.length, planningTargetIdsSorted: sortedIds(phase0PlanningTargetIds) },
    materialization: null,
    entrySet: null,
    freshEntrySet: { entryFingerprint: set.entryFingerprint, entryCount: set.materializedEntries.length },
    verification: { semantic: record.semantic, semanticSha256: hashed.value, observed: record.observed },
    integrityIssues: [],
    timing: {
      input: prepared.timing, phase0Ms, materializationWallMs: null, verificationWallMs,
      evidence: { materializationHashMs: null, entrySetMs: null, verificationHashMs: hashed.ms }, stageTotalMs: ports.now() - started,
    },
  }
}
