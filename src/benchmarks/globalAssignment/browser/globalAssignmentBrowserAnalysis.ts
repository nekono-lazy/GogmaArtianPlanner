/**
 * Issue #154 Production準備 P-2 (Research only; never imported by the app, the page, the runner, the harness or the Worker).
 *
 * The post-hoc analysis of the Browser measurement of the real Export (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 9 / 12 /
 * 16.2). From the committed measurement plan (read at the measured commit), the Browser raw records (the page's `exportJson()`), the
 * external driver's record, the Node reference (the D-1A non-formal runner at the same HEAD) and the D-1C public RESULT (read at the
 * measured commit; its SHA-256 is the plan's), it derives - and only it - per environment the semantic parity, the cancel trials, the
 * tally of how every slot ended, and the observed timings, responsiveness and memory, then a minimized public RESULT. The parity, the
 * cancel trials and the tally never feed one another, and no observed value decides a semantic one.
 *
 * It runs no calculation (no RNG prediction, Search, Planner or Trace Replay), reads no file (the script reads and passes the texts and
 * their byte SHA-256) and fails closed on a source it cannot read: a malformed raw file, a record of another measurement HEAD or with
 * uncommitted benchmark code, a plan of another commit, a reference without the fields it reads. It re-hashes every semantic record it
 * uses (a record that is not its recorded hash is an integrity issue of its run, never compared).
 */
import { hashStableValue, stableStringify, type CalculationContext } from '../../../domain/models/publicTypes'
import type { ExportIdentity } from '../assignmentProtocol'
import { summarizeD0cMaterializationOutcome } from '../materializationFormal'
import type { MaterializationSemanticRecord } from '../materializationRunner'
import { collectD1cRecordIdentifiers, D1C_PUBLIC_RESULT_FORBIDDEN_KEYS, D1C_PUBLIC_RESULT_KIND, type D1cSourceChild } from '../verificationFormalResult'
import { materializedEntriesFingerprintOfSemantic } from '../verificationProtocol'
import type { PlannerVerificationSemantic } from '../verify'
import {
  gabComparisonRole, judgeGabCancelTrial, judgeGabEnvironmentParity, tallyGabOutcomes,
  type GabCancelTrial, type GabCancelTrialWorker, type GabEnvironmentParity, type GabMaterializationParityView, type GabOutcomeTally, type GabParitySlot,
  type GabPremiseIssue, type GabReferenceView, type GabVerificationParityView, type GabWorkerParityView,
} from './globalAssignmentBrowserJudgement'
import {
  bindGabRecordsToPlan, extractGabMeasurementPlan, gabMeasurementPlanIssues,
  type GabMeasurementPlan, type GabPlanEnvironment, type GabPlanSlot, type GabRecordedRun, type GabSlotBinding,
} from './globalAssignmentBrowserMeasurementPlan'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, gabWorkerResultIssues, type GabRole, type GabWorkerResult } from './globalAssignmentBrowserProtocol'
import type { GabLogicalRunRecord, GabWorkerRunRecord } from './globalAssignmentBrowserRunner'

export const GAB_PUBLIC_RESULT_KIND = 'global-assignment-browser-p2-public-result'
export const GAB_PUBLIC_RESULT_REVISION = 1
export const GAB_ANALYSIS_SCRIPT = 'scripts/analyze-planner-global-assignment-browser.mjs'
/** The page's raw `exportJson()` kind. */
export const GAB_RAW_KIND = 'global-assignment-browser-raw'
/** The external driver's record kind (the driver is not committed; this module fixes the shape it must write). */
export const GAB_DRIVER_RECORD_KIND = 'global-assignment-browser-p2-driver-record'
export const GAB_DRIVER_RECORD_REVISION = 1

/** A source the analysis cannot read the way it must: the analysis stops (it never fills a value in). */
export class GabAnalysisSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GabAnalysisSourceError'
  }
}

/** A file the script read: its name (a base name or `<commit>:<path>`), byte length and SHA-256 over the bytes, and its UTF-8 text. */
export interface GabSourceFile {
  file: string
  bytes: number
  sha256: string
  text: string
}

export interface GabAnalysisSources {
  measurementHead: string
  /** The plan document as `git show <commit>:<path>` gave it. */
  plan: GabSourceFile & { commit: string; path: string }
  /** The D-1C public RESULT as `git show <commit>:<path>` gave it (the path the plan names). */
  d1cResult: GabSourceFile & { commit: string; path: string }
  /** The page's raw files (each the page's `exportJson()` of one or more logical runs). */
  browserRaw: readonly GabSourceFile[]
  driver: GabSourceFile | null
  /** The Node reference: the D-1A runner's output and the first / fresh record files it names (null: no Node reference). */
  node: { output: GabSourceFile; first: GabSourceFile | null; fresh: GabSourceFile | null } | null
  /** The registered conditions of the analyzed code (`registeredD1cConditions()`, `d1cRegistrationFingerprint()`) and their source name. */
  registered: { source: string; materialization: unknown; verification: unknown; fingerprint: string | null }
}

export interface GabAnalysisPorts {
  /** SHA-256 of a text's UTF-8 bytes (the re-hash of semantic records). */
  sha256Text(text: string): Promise<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const round = (value: number) => Number(value.toFixed(3))
const roundOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? round(value) : null)
const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right)
const COMMIT = /^[0-9a-f]{40}$/

function parseJson(source: GabSourceFile, what: string): unknown {
  try {
    return JSON.parse(source.text)
  } catch (error) {
    throw new GabAnalysisSourceError(`${what} ${source.file} is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function demand(condition: boolean, message: string): void {
  if (!condition) throw new GabAnalysisSourceError(message)
}

// -------------------------------------------------------------------------------------------------------------------------------------
// Views (design 12.1): every source in one comparable form
// -------------------------------------------------------------------------------------------------------------------------------------

function keyHashes(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, hashStableValue(value[key])]))
}

function candidatePick(candidate: Record<string, unknown> | null | undefined): GabMaterializationParityView['candidate'] {
  if (!isRecord(candidate)) return null
  return {
    ordinal: candidate.ordinal as number, objective: candidate.objective as number, targetCount: candidate.targetCount as number, classification: candidate.classification as string,
    materialized: candidate.materialized as number, notAttempted: candidate.notAttempted as number,
    materializedBy: { ...(candidate.materializedBy as Record<string, number>) }, independentStops: { ...(candidate.independentStops as Record<string, number>) },
  }
}

/** The materialization view of a semantic record (the D-1C public RESULT's own summary rule: `summarizeD0cMaterializationOutcome`). */
export function gabMaterializationViewOfSemantic(semantic: MaterializationSemanticRecord, semanticSha256: string): GabMaterializationParityView {
  const outcome = summarizeD0cMaterializationOutcome({ measured: [semantic], unmeasuredProgress: null })
  return {
    semanticSha256, planningTargetCount: outcome.planningTargetCount, runOutcome: outcome.runOutcome, verdict: outcome.verdict,
    candidate: candidatePick(outcome.candidates[0] as unknown as Record<string, unknown> | undefined),
    entryFingerprint: materializedEntriesFingerprintOfSemantic(semantic), semanticKeyHashes: keyHashes(semantic),
  }
}

/** The verification view of a semantic record. */
export function gabVerificationViewOfSemantic(semantic: PlannerVerificationSemantic, semanticSha256: string): GabVerificationParityView {
  const planner = semantic.planner
  const replay = semantic.traceReplay
  const physical = semantic.physical
  const termination = planner?.termination ?? null
  return {
    semanticSha256, outcomeKind: semantic.outcome.kind,
    planningTargetCount: semantic.candidate.planningTargetCount, materializedEntryCount: semantic.candidate.materializedEntryCount, entryFingerprint: semantic.candidate.entryFingerprint,
    termination: termination === null ? null : {
      status: termination.status, reachedLimits: [...termination.reachedLimits], limits: { ...termination.limits } as Record<string, number>, expandedStates: termination.expandedStates,
      completedTargetCount: termination.completedTargetCount, totalTargetCount: termination.totalTargetCount,
    },
    selectedEntryCount: planner === null ? null : planner.selectedBuildListEntryIds.length, conflictCount: planner === null ? null : planner.conflicts.length,
    rejectedCount: planner === null ? null : planner.rejected.length, resourceConflictCount: planner === null ? null : planner.rejected.filter(entry => entry.reason === 'resource_conflict').length,
    warningCount: planner === null ? null : planner.warnings.length, fullPlannerRuns: planner?.fullPlannerRuns ?? null, plannerPlanSteps: planner?.planSteps ?? null,
    planHash: planner?.planHash ?? null, stepSemanticsHash: planner?.stepSemanticsHash ?? null,
    traceReplay: replay === null ? null : {
      isValid: replay.isValid, draftsTotal: replay.drafts.total, draftsPhysical: replay.drafts.physical, draftsReserve: replay.drafts.reserve,
      mismatchCount: replay.correspondence?.mismatches ?? null, counterPositionMismatchCount: replay.correspondence?.counterPositionMismatches ?? null,
    },
    physical: physical === null ? null : {
      physicalOperations: physical.physicalOperations, planSteps: physical.planSteps, nonPhysicalStepCount: physical.nonPhysicalStepCount, streamAdvanceSum: physical.streamAdvanceSum,
      objective: physical.objective, executedHash: physical.executedHash,
    },
    semanticKeyHashes: keyHashes(semantic),
  }
}

/** The verification view of one process of the D-1C public RESULT (`runs[].first|fresh.verification`). */
export function gabVerificationViewOfD1cSummary(summary: unknown): GabVerificationParityView {
  demand(isRecord(summary) && typeof summary.semanticSha256 === 'string' && isRecord(summary.outcome) && isRecord(summary.candidate), 'A D-1C process has no verification summary to compare with.')
  const value = summary as Record<string, Record<string, unknown> | null> & { semanticSha256: string }
  const planner = value.planner as Record<string, unknown> | null
  const replay = value.traceReplay as Record<string, unknown> | null
  const physical = value.physical as Record<string, unknown> | null
  const termination = planner === null ? null : (planner.termination as Record<string, unknown> | null)
  const drafts = replay === null ? null : (replay.drafts as Record<string, number>)
  const correspondence = replay === null ? null : (replay.correspondence as Record<string, number> | null)
  return {
    semanticSha256: value.semanticSha256, outcomeKind: value.outcome!.kind as string,
    planningTargetCount: value.candidate!.planningTargetCount as number, materializedEntryCount: value.candidate!.materializedEntryCount as number, entryFingerprint: value.candidate!.entryFingerprint as string,
    termination: termination === null ? null : {
      status: termination.status as string, reachedLimits: [...(termination.reachedLimits as string[])], limits: { ...(termination.limits as Record<string, number>) }, expandedStates: termination.expandedStates as number,
      completedTargetCount: termination.completedTargetCount as number, totalTargetCount: termination.totalTargetCount as number,
    },
    selectedEntryCount: (planner?.selectedEntryCount ?? null) as number | null, conflictCount: (planner?.conflictCount ?? null) as number | null,
    rejectedCount: (planner?.rejectedCount ?? null) as number | null, resourceConflictCount: (planner?.resourceConflictCount ?? null) as number | null,
    warningCount: (planner?.warningCount ?? null) as number | null, fullPlannerRuns: (planner?.fullPlannerRuns ?? null) as number | null, plannerPlanSteps: (planner?.planSteps ?? null) as number | null,
    planHash: (planner?.planHash ?? null) as string | null, stepSemanticsHash: (planner?.stepSemanticsHash ?? null) as string | null,
    traceReplay: replay === null ? null : {
      isValid: replay.isValid as boolean | null, draftsTotal: drafts!.total, draftsPhysical: drafts!.physical, draftsReserve: drafts!.reserve,
      mismatchCount: correspondence?.mismatchCount ?? null, counterPositionMismatchCount: correspondence?.counterPositionMismatchCount ?? null,
    },
    physical: physical === null ? null : {
      physicalOperations: physical.physicalOperations as number | null, planSteps: physical.planSteps as number | null, nonPhysicalStepCount: physical.nonPhysicalStepCount as number | null,
      streamAdvanceSum: physical.streamAdvanceSum as number | null, objective: physical.objective as number, executedHash: physical.executedHash as string | null,
    },
    semanticKeyHashes: null,
  }
}

// -------------------------------------------------------------------------------------------------------------------------------------
// The D-1C public RESULT (the formal reference, read post hoc)
// -------------------------------------------------------------------------------------------------------------------------------------

export interface GabD1cReading {
  view: GabReferenceView
  issues: GabPremiseIssue[]
  export: ExportIdentity
  calculationContext: CalculationContext
  rngEngineVersion: string
  conditions: { materialization: unknown; verification: unknown }
  plannerInputMaxPlanStepsForValidationOnly: number | null
  summary: {
    measurementHeadSha: string | null; formalValidity: string; candidateOutcome: string; acceptance: string; processCount: number
    materializationSemanticSha256: string | null; verificationSemanticSha256: string | null; entryFingerprint: string | null; planningTargetCount: number | null; physicalOperations: number | null
  }
}

function d1cProcessView(process: Record<string, unknown>, role: GabRole): GabWorkerParityView {
  const materialization = role === 'first' && isRecord(process.materialization) ? process.materialization : null
  const identity = isRecord(process.identity) ? process.identity : null
  const entrySet = isRecord(process.entrySet) ? process.entrySet : null
  return {
    phase0PlanningTargetCount: (process.phase0PlanningTargetCount ?? null) as number | null,
    materialization: materialization === null ? null : {
      semanticSha256: materialization.semanticSha256 as string, planningTargetCount: (materialization.planningTargetCount ?? null) as number | null, runOutcome: (materialization.runOutcome ?? null) as string | null,
      verdict: materialization.verdict as string, candidate: candidatePick(materialization.candidate as Record<string, unknown> | null), entryFingerprint: (identity?.entryFingerprint ?? null) as string | null,
      semanticKeyHashes: null,
    },
    entryFingerprint: (entrySet?.entryFingerprint ?? null) as string | null,
    verification: process.verification === null || process.verification === undefined ? null : gabVerificationViewOfD1cSummary(process.verification),
  }
}

/**
 * The D-1C public RESULT as the comparison reference. Its run 1 first / fresh processes are the reference; every other process must
 * agree with them, and the RESULT must be the accepted one (valid, verified, accepted) - otherwise `reference_inconsistent`.
 */
export function readGabD1cReference(value: unknown): GabD1cReading {
  demand(isRecord(value) && value.resultKind === D1C_PUBLIC_RESULT_KIND, `The D-1C reference is not a ${D1C_PUBLIC_RESULT_KIND}.`)
  const result = value as Record<string, unknown>
  const runs = result.runs
  demand(Array.isArray(runs) && runs.length > 0 && runs.every(run => isRecord(run) && isRecord(run.first) && isRecord(run.fresh)), 'The D-1C reference has no runs with first and fresh processes.')
  const exportVerification = result.exportVerification as Record<string, unknown> | undefined
  demand(isRecord(exportVerification) && isRecord(exportVerification.actual), 'The D-1C reference has no Export identity.')
  demand(isRecord(result.calculationContext) && typeof result.rngEngineVersion === 'string', 'The D-1C reference has no CalculationContext.')
  const registration = result.registration as Record<string, unknown> | undefined
  const registered = (isRecord(registration) ? registration.registeredConditions : undefined) as Record<string, unknown> | undefined
  demand(isRecord(registered) && isRecord(registered.materialization) && isRecord(registered.verification), 'The D-1C reference has no registered conditions.')
  const views = (runs as Record<string, Record<string, unknown>>[]).map(run => ({ first: d1cProcessView(run.first!, 'first'), fresh: d1cProcessView(run.fresh!, 'fresh') }))
  const view = views[0]!
  const issues: GabPremiseIssue[] = []
  const formalValidity = String((result.formalValidity as Record<string, unknown> | undefined)?.status)
  const candidateOutcome = String((result.candidateOutcome as Record<string, unknown> | undefined)?.kind)
  const acceptance = String((result.acceptance as Record<string, unknown> | undefined)?.status)
  if (formalValidity !== 'valid' || candidateOutcome !== 'verified' || acceptance !== 'accepted') {
    issues.push({ reason: 'reference_inconsistent', source: 'd1c_result', detail: `The D-1C public RESULT is ${formalValidity} / ${candidateOutcome} / ${acceptance}, not valid / verified / accepted.` })
  }
  const determinism = result.determinism as Record<string, unknown> | undefined
  if (!isRecord(determinism) || determinism.materializationIdentical !== true || determinism.verificationIdentical !== true || determinism.entryFingerprintIdentical !== true) {
    issues.push({ reason: 'reference_inconsistent', source: 'd1c_result', detail: 'The D-1C public RESULT does not record identical semantic values in every process.' })
  }
  views.forEach((run, index) => {
    if (!same(run.first, view.first) || !same(run.fresh, view.fresh)) issues.push({ reason: 'reference_inconsistent', source: 'd1c_result', detail: `D-1C run ${index + 1} is not run 1.` })
  })
  if (!same(view.first.verification, view.fresh.verification)) issues.push({ reason: 'reference_inconsistent', source: 'd1c_result', detail: 'The D-1C first and fresh processes record different Planner values.' })
  const provenance = result.provenance as Record<string, unknown> | undefined
  return {
    view, issues,
    export: { ...(exportVerification!.actual as ExportIdentity) }, calculationContext: { ...(result.calculationContext as CalculationContext) }, rngEngineVersion: result.rngEngineVersion as string,
    conditions: { materialization: registered!.materialization, verification: registered!.verification },
    plannerInputMaxPlanStepsForValidationOnly: (provenance?.plannerInputMaxPlanStepsForValidationOnly ?? null) as number | null,
    summary: {
      measurementHeadSha: (provenance?.measurementHeadSha ?? null) as string | null, formalValidity, candidateOutcome, acceptance, processCount: views.length * 2,
      materializationSemanticSha256: view.first.materialization?.semanticSha256 ?? null, verificationSemanticSha256: view.first.verification?.semanticSha256 ?? null,
      entryFingerprint: view.first.entryFingerprint, planningTargetCount: view.first.verification?.planningTargetCount ?? null, physicalOperations: view.first.verification?.physical?.physicalOperations ?? null,
    },
  }
}

// -------------------------------------------------------------------------------------------------------------------------------------
// The Node reference (the D-1A non-formal runner at the measurement HEAD)
// -------------------------------------------------------------------------------------------------------------------------------------

export interface GabNodeReading {
  /** Null when the reference cannot be compared (its premise issues say why). */
  view: GabReferenceView | null
  issues: GabPremiseIssue[]
  summary: {
    repositoryHeadSha: string | null; uncommittedBenchmarkCode: boolean | null; verdictKind: string | null; integrityIssueCount: number | null; node: string | null
    materializationSemanticSha256: string | null; entryFingerprint: string | null; verificationSemanticSha256s: (string | null)[]
    firstWallObservedMs: number | null; freshWallObservedMs: number | null; firstMaterializationWallMs: number | null; firstPlannerMs: number | null; freshPlannerMs: number | null
  }
  /** The identifiers its records hold (none may reach the public RESULT). */
  children: D1cSourceChild[]
}

async function readGabNodeReference(node: NonNullable<GabAnalysisSources['node']>, plan: GabMeasurementPlan, measurementHead: string, ports: GabAnalysisPorts): Promise<GabNodeReading> {
  const output = parseJson(node.output, 'The Node reference output')
  demand(isRecord(output) && typeof output.repositoryHeadSha === 'string' && Array.isArray(output.runs) && isRecord(output.verdict), `The Node reference output ${node.output.file} is not a D-1A runner output.`)
  const value = output as Record<string, unknown> & { runs: Record<string, unknown>[] }
  const exportVerification = value.exportVerification as Record<string, unknown> | undefined
  const conditions = value.conditions as Record<string, unknown> | undefined
  demand(isRecord(exportVerification) && isRecord(exportVerification.actual) && isRecord(value.calculationContext) && isRecord(conditions) && isRecord(conditions.materialization)
    && isRecord(conditions.researchMaxPlanSteps), 'The Node reference output has no Export, CalculationContext or conditions.')
  const issues: GabPremiseIssue[] = []
  const premise = (reason: GabPremiseIssue['reason'], detail: string) => issues.push({ reason, source: 'node_reference', detail })
  if (value.repositoryHeadSha !== measurementHead) premise('node_reference_head_mismatch', `The Node reference ran at ${String(value.repositoryHeadSha)}, not the measurement HEAD ${measurementHead}.`)
  if (value.uncommittedBenchmarkCode !== false) premise('node_reference_head_mismatch', 'The Node reference did not run committed benchmark code.')
  if (!same(exportVerification!.actual, plan.export)) premise('export_identity_mismatch', 'The Node reference read another Export.')
  if (!same(value.calculationContext, plan.calculationContext)) premise('calculation_context_mismatch', 'The Node reference has another CalculationContext.')
  if (!same(conditions!.materialization, plan.conditions.materialization) || (conditions!.researchMaxPlanSteps as Record<string, unknown>).value !== plan.conditions.verification.researchMaxPlanSteps) {
    premise('conditions_mismatch', 'The Node reference ran other conditions.')
  }
  const verdictKind = String((value.verdict as Record<string, unknown>).kind)
  const integrityIssues = Array.isArray(value.integrityIssues) ? value.integrityIssues.length : null
  if (verdictKind !== 'verified' || integrityIssues !== 0) premise('reference_inconsistent', `The Node reference verdict is ${verdictKind} with ${String(integrityIssues)} integrity issues.`)
  const firstRun = value.runs.find(run => run.id === 'first') ?? null
  const freshRun = value.runs.find(run => run.id === 'fresh') ?? null
  const readRecord = (run: Record<string, unknown> | null, source: GabSourceFile | null, role: GabRole): Record<string, unknown> | null => {
    const process = isRecord(run?.process) ? run!.process : null
    if (run === null || process?.outcome !== 'completed' || typeof run.recordFile !== 'string') { premise('reference_inconsistent', `The Node reference ${role} process did not complete with a record.`); return null }
    demand(source !== null && source.file === run.recordFile, `The Node reference ${role} record ${String(run.recordFile)} was not given.`)
    const record = parseJson(source!, `The Node reference ${role} record`)
    demand(isRecord(record) && record.role === role, `The Node reference ${role} record is not a ${role} record.`)
    return record as Record<string, unknown>
  }
  const first = readRecord(firstRun, node.first, 'first')
  const fresh = readRecord(freshRun, node.fresh, 'fresh')
  const verificationOf = async (record: Record<string, unknown> | null, run: Record<string, unknown> | null, role: GabRole) => {
    const verification = record === null ? null : (record.verification as Record<string, unknown> | null)
    if (record === null || !isRecord(verification) || !isRecord(verification.semantic)) return null
    const sha = await ports.sha256Text(JSON.stringify(verification.semantic))
    const recorded = isRecord(run?.verification) ? run!.verification.semanticSha256 : undefined
    if (sha !== verification.semanticSha256 || sha !== recorded) premise('reference_inconsistent', `The Node reference ${role} verification record is not its recorded SHA-256.`)
    return gabVerificationViewOfSemantic(verification.semantic as unknown as PlannerVerificationSemantic, sha)
  }
  let materialization: GabMaterializationParityView | null = null
  const firstMaterialization = first === null ? null : (first.materialization as Record<string, unknown> | null)
  if (isRecord(firstMaterialization) && isRecord(firstMaterialization.semantic)) {
    const sha = await ports.sha256Text(JSON.stringify(firstMaterialization.semantic))
    const recorded = isRecord(firstRun?.materialization) ? firstRun!.materialization.semanticSha256 : undefined
    if (sha !== firstMaterialization.semanticSha256 || sha !== recorded) premise('reference_inconsistent', 'The Node reference materialization record is not its recorded SHA-256.')
    materialization = gabMaterializationViewOfSemantic(firstMaterialization.semantic as unknown as MaterializationSemanticRecord, sha)
  } else if (first !== null) premise('reference_inconsistent', 'The Node reference first record has no materialization record.')
  const firstVerification = await verificationOf(first, firstRun, 'first')
  const freshVerification = await verificationOf(fresh, freshRun, 'fresh')
  const entryFingerprintOf = (record: Record<string, unknown> | null) => (record !== null && isRecord(record.entrySet) ? (record.entrySet.entryFingerprint as string) ?? null : null)
  const countOf = (record: Record<string, unknown> | null) => (record !== null && Array.isArray(record.phase0PlanningTargetIds) ? record.phase0PlanningTargetIds.length : null)
  const view = first === null || fresh === null ? null : {
    first: { phase0PlanningTargetCount: countOf(first), materialization, entryFingerprint: entryFingerprintOf(first), verification: firstVerification },
    fresh: { phase0PlanningTargetCount: countOf(fresh), materialization: null, entryFingerprint: entryFingerprintOf(fresh), verification: freshVerification },
  }
  const wallOf = (run: Record<string, unknown> | null) => (isRecord(run?.process) ? roundOrNull(run!.process.wallObservedMs) : null)
  const plannerMsOf = (record: Record<string, unknown> | null) => {
    const verification = record === null ? null : (record.verification as Record<string, unknown> | null)
    const observed = isRecord(verification) && isRecord(verification.observed) && isRecord(verification.observed.elapsedMs) ? verification.observed.elapsedMs : null
    return observed === null ? null : roundOrNull(observed.planner)
  }
  const children: D1cSourceChild[] = [first, fresh].flatMap((record, index) => (record === null ? [] : [{
    runIndex: 1, role: index === 0 ? 'first' : 'fresh', reading: { process: 'completed', record: record as never, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } }, entrySet: null,
  } as D1cSourceChild]))
  return {
    view, issues, children,
    summary: {
      repositoryHeadSha: value.repositoryHeadSha as string, uncommittedBenchmarkCode: typeof value.uncommittedBenchmarkCode === 'boolean' ? value.uncommittedBenchmarkCode : null, verdictKind, integrityIssueCount: integrityIssues,
      node: typeof value.node === 'string' ? value.node : null,
      materializationSemanticSha256: materialization?.semanticSha256 ?? null, entryFingerprint: entryFingerprintOf(first), verificationSemanticSha256s: [firstVerification?.semanticSha256 ?? null, freshVerification?.semanticSha256 ?? null],
      firstWallObservedMs: wallOf(firstRun), freshWallObservedMs: wallOf(freshRun),
      firstMaterializationWallMs: first !== null && isRecord(first.materialization) ? roundOrNull(first.materialization.wallMs) : null,
      firstPlannerMs: plannerMsOf(first), freshPlannerMs: plannerMsOf(fresh),
    },
  }
}

// -------------------------------------------------------------------------------------------------------------------------------------
// Browser raw records and the driver record
// -------------------------------------------------------------------------------------------------------------------------------------

function workerShapeIssues(worker: unknown, at: string): string[] {
  if (!isRecord(worker)) return [`${at} must be an object.`]
  const issues: string[] = []
  if (worker.role !== 'first' && worker.role !== 'fresh') issues.push(`${at}.role must be first or fresh.`)
  if (typeof worker.requestId !== 'string' || typeof worker.settle !== 'string' || typeof worker.requestStarted !== 'boolean') issues.push(`${at} needs requestId, settle and requestStarted.`)
  if (worker.environment !== null && !isRecord(worker.environment)) issues.push(`${at}.environment must be an object or null.`)
  const settlement = worker.settlement
  if (settlement !== null) {
    if (!isRecord(settlement) || typeof settlement.outcome !== 'string' || typeof settlement.settledBy !== 'string' || typeof settlement.cancelRequested !== 'boolean' || !isRecord(settlement.timing) || !isRecord(settlement.progress)) {
      issues.push(`${at}.settlement must carry outcome, settledBy, cancelRequested, timing and progress.`)
    }
  }
  if (!isRecord(worker.rehash)) issues.push(`${at}.rehash must be an object.`)
  if (worker.audit !== null && !(isRecord(worker.audit) && Array.isArray(worker.audit.requests) && typeof worker.audit.terminated === 'boolean')) issues.push(`${at}.audit must be null or carry requests and terminated.`)
  if (worker.ping !== null && !isRecord(worker.ping)) issues.push(`${at}.ping must be an object or null.`)
  if (worker.memory !== null && !Array.isArray(worker.memory)) issues.push(`${at}.memory must be an array or null.`)
  if (!Number.isSafeInteger(worker.lateResponses)) issues.push(`${at}.lateResponses must be an integer.`)
  return issues
}

/** Why a raw file is not the page's `exportJson()` of logical run records (`[]` = it is). Bounded: semantic records are not walked here. */
export function gabRawFileIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The raw file is not an object.']
  const issues: string[] = []
  if (value.kind !== GAB_RAW_KIND) issues.push(`kind must be ${GAB_RAW_KIND}.`)
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (value.formal !== false || value.oracleFreeExecution !== true) issues.push('A raw file is formal: false and oracleFreeExecution: true.')
  if (!isRecord(value.environment)) issues.push('environment must be an object.')
  if (!Array.isArray(value.records) || value.records.length === 0) return [...issues, 'records must be a non-empty array.']
  value.records.forEach((record, index) => {
    const at = `records[${index}]`
    if (!isRecord(record)) { issues.push(`${at} must be an object.`); return }
    if (typeof record.id !== 'string' || !Number.isSafeInteger(record.sequence) || typeof record.startedAt !== 'string') issues.push(`${at} needs id, sequence and startedAt.`)
    const slot = record.slot
    if (!isRecord(slot) || typeof slot.slotId !== 'string' || typeof slot.purpose !== 'string' || typeof slot.planned !== 'boolean') issues.push(`${at}.slot needs slotId, purpose and planned.`)
    if (record.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`${at}.protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
    const identity = record.export
    if (!isRecord(identity) || typeof identity.fileName !== 'string' || !Number.isSafeInteger(identity.bytes) || typeof identity.sha256 !== 'string') issues.push(`${at}.export must be an Export identity.`)
    if (!isRecord(record.main) || !('build' in record.main) || !('crossOriginIsolated' in record.main)) issues.push(`${at}.main must carry build and crossOriginIsolated.`)
    if (!isRecord(record.options)) issues.push(`${at}.options must be an object.`)
    issues.push(...workerShapeIssues(record.first, `${at}.first`), ...workerShapeIssues(record.fresh, `${at}.fresh`))
    if (!Array.isArray(record.integrityIssues) || !record.integrityIssues.every(item => typeof item === 'string')) issues.push(`${at}.integrityIssues must be an array of strings.`)
    if (!isRecord(record.judgement) || !isRecord(record.judgement.verdict) || typeof record.judgement.verdict.kind !== 'string') issues.push(`${at}.judgement needs its verdict.`)
    const cancel = record.cancel
    if (cancel !== null && !(isRecord(cancel) && typeof cancel.source === 'string' && typeof cancel.phase === 'string')) issues.push(`${at}.cancel must be null or carry source and phase.`)
    const lifecycle = record.lifecycle
    if (!isRecord(lifecycle) || typeof lifecycle.interrupted !== 'boolean' || typeof lifecycle.pageLeft !== 'boolean' || !Array.isArray(lifecycle.events)) issues.push(`${at}.lifecycle needs interrupted, pageLeft and events.`)
    if (!isFiniteNumber(record.logicalRunWallMs)) issues.push(`${at}.logicalRunWallMs must be a number.`)
    if (record.formal !== false || record.oracleFreeExecution !== true) issues.push(`${at} is formal: false and oracleFreeExecution: true.`)
  })
  return issues
}

export interface GabStorageState {
  indexedDbDatabases: number
  localKeys: number
  sessionKeys: number
  cacheKeys: number
  workerRegistrations: number
}

export interface GabDriverSlot {
  slotId: string
  sessionId: string
  startedAt: string
  endedAt: string | null
  outcome: 'record_saved' | 'page_lost' | 'driver_error'
  rawFile: string | null
  cpuLoadPercentBefore: number | null
  /** External evidence of the slot (the page cannot record its own loss); `out_of_memory` only with crash evidence. */
  external: { kind: 'page_lost' | 'out_of_memory'; evidence: string } | null
  cdpWorkerHeap: { intervalMs: number; samples: { atMs: number; role: GabRole | null; usedSize: number; totalSize: number }[]; errors: number } | null
  osRendererMemory: { intervalMs: number; samples: { atMs: number; privateBytes: number; workingSetBytes: number; processCount: number }[] } | null
  note: string | null
}

export interface GabDriverRecord {
  kind: typeof GAB_DRIVER_RECORD_KIND
  revision: typeof GAB_DRIVER_RECORD_REVISION
  measurementHead: string
  driverSha256: string
  launcher: { browser: string; version: string; headless: boolean; flags: string[]; profile: string }
  machine: { cpuModel: string | null; logicalCpuCount: number | null; totalMemoryBytes: number | null; os: string | null }
  sessions: { sessionId: string; origin: string; crossOriginIsolated: boolean; storageBefore: GabStorageState | null; storageAfter: GabStorageState | null; pageLost: boolean }[]
  slots: GabDriverSlot[]
}

function storageIssues(value: unknown, at: string): string[] {
  if (value === null) return []
  if (!isRecord(value)) return [`${at} must be an object or null.`]
  return ['indexedDbDatabases', 'localKeys', 'sessionKeys', 'cacheKeys', 'workerRegistrations'].filter(key => !Number.isSafeInteger(value[key])).map(key => `${at}.${key} must be an integer.`)
}

/** Why a driver record is not the shape the analysis reads (`[]` = it is). */
export function gabDriverRecordIssues(value: unknown, measurementHead: string): string[] {
  if (!isRecord(value)) return ['The driver record is not an object.']
  const issues: string[] = []
  if (value.kind !== GAB_DRIVER_RECORD_KIND || value.revision !== GAB_DRIVER_RECORD_REVISION) issues.push(`The driver record must be ${GAB_DRIVER_RECORD_KIND} revision ${GAB_DRIVER_RECORD_REVISION}.`)
  if (value.measurementHead !== measurementHead) issues.push(`The driver record is for ${String(value.measurementHead)}, not ${measurementHead}.`)
  if (typeof value.driverSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.driverSha256)) issues.push('driverSha256 must be 64 lower-case hex characters.')
  const launcher = value.launcher
  if (!isRecord(launcher) || typeof launcher.browser !== 'string' || typeof launcher.version !== 'string' || typeof launcher.headless !== 'boolean' || !Array.isArray(launcher.flags) || typeof launcher.profile !== 'string') issues.push('launcher needs browser, version, headless, flags and profile.')
  if (!isRecord(value.machine)) issues.push('machine must be an object.')
  if (!Array.isArray(value.sessions)) issues.push('sessions must be an array.')
  else value.sessions.forEach((session, index) => {
    if (!isRecord(session) || typeof session.sessionId !== 'string' || typeof session.origin !== 'string' || typeof session.crossOriginIsolated !== 'boolean' || typeof session.pageLost !== 'boolean') issues.push(`sessions[${index}] needs sessionId, origin, crossOriginIsolated and pageLost.`)
    else issues.push(...storageIssues(session.storageBefore, `sessions[${index}].storageBefore`), ...storageIssues(session.storageAfter, `sessions[${index}].storageAfter`))
  })
  if (!Array.isArray(value.slots)) return [...issues, 'slots must be an array.']
  const seen = new Set<string>()
  value.slots.forEach((slot, index) => {
    const at = `slots[${index}]`
    if (!isRecord(slot) || typeof slot.slotId !== 'string' || typeof slot.sessionId !== 'string' || typeof slot.startedAt !== 'string') { issues.push(`${at} needs slotId, sessionId and startedAt.`); return }
    if (seen.has(slot.slotId)) issues.push(`${at}: the driver ran ${slot.slotId} twice.`)
    seen.add(slot.slotId)
    if (!['record_saved', 'page_lost', 'driver_error'].includes(slot.outcome as string)) issues.push(`${at}.outcome must be record_saved, page_lost or driver_error.`)
    const external = slot.external
    if (external !== null && !(isRecord(external) && (external.kind === 'page_lost' || external.kind === 'out_of_memory') && typeof external.evidence === 'string' && external.evidence !== '')) {
      issues.push(`${at}.external must be null or { kind: page_lost | out_of_memory, evidence }.`)
    }
    for (const key of ['cdpWorkerHeap', 'osRendererMemory'] as const) {
      const samples = slot[key]
      if (samples !== null && !(isRecord(samples) && Number.isSafeInteger(samples.intervalMs) && Array.isArray(samples.samples))) issues.push(`${at}.${key} must be null or carry intervalMs and samples.`)
    }
  })
  return issues
}

interface ReadRecord {
  run: GabRecordedRun
  /** The analysis' own findings on the record's raw contents (a malformed adopted result, a semantic record that is not its hash). */
  rawIssues: string[]
  views: Record<GabRole, GabWorkerParityView | null>
}

async function readWorker(worker: GabWorkerRunRecord, ports: GabAnalysisPorts): Promise<{ view: GabWorkerParityView | null; issues: string[] }> {
  const result = worker.settlement?.result ?? null
  if (worker.settle !== 'completed' || result === null) return { view: null, issues: [] }
  const shape = gabWorkerResultIssues(result, { requestId: worker.requestId, role: worker.role })
  if (shape.length > 0) return { view: null, issues: shape.map(issue => `${worker.role}: the adopted result is malformed in the raw file: ${issue}`) }
  const issues: string[] = []
  const rehash = async (value: unknown, recorded: string, what: string) => {
    const sha = await ports.sha256Text(JSON.stringify(value))
    if (sha !== recorded) issues.push(`${worker.role}: the raw ${what} is not its recorded SHA-256.`)
    return sha
  }
  const materialization = result.materialization === null || worker.role !== 'first' ? null
    : gabMaterializationViewOfSemantic(result.materialization.semantic, await rehash(result.materialization.semantic, result.materialization.semanticSha256, 'materialization semantic record'))
  if (result.entrySet !== null) await rehash(result.entrySet.value, result.entrySet.sha256, 'Entry set')
  const verification = result.verification === null ? null
    : gabVerificationViewOfSemantic(result.verification.semantic, await rehash(result.verification.semantic, result.verification.semanticSha256, 'verification semantic record'))
  return {
    view: {
      phase0PlanningTargetCount: result.phase0.planningTargetCount, materialization,
      entryFingerprint: worker.role === 'first' ? result.entrySet?.entryFingerprint ?? null : result.freshEntrySet?.entryFingerprint ?? null, verification,
    },
    issues,
  }
}

/** The raw records of every raw file: validated, of the measurement HEAD only, and de-duplicated (an identical record saved twice is one). */
function readRawRecords(files: readonly GabSourceFile[], measurementHead: string): GabRecordedRun[] {
  const byKey = new Map<string, { text: string; run: GabRecordedRun }>()
  for (const file of files) {
    const value = parseJson(file, 'The Browser raw file')
    const issues = gabRawFileIssues(value)
    demand(issues.length === 0, `The Browser raw file ${file.file} is malformed: ${issues.slice(0, 5).join(' / ')}`)
    const raw = value as { environment: Record<string, unknown>; records: GabLogicalRunRecord[] }
    for (const record of raw.records) {
      const build = record.main.build as Record<string, unknown> | null
      demand(isRecord(build) && build.commit === measurementHead && build.uncommittedBenchmarkCode === false,
        `${file.file} holds ${record.id}, built from ${isRecord(build) ? String(build.commit) : 'no benchmark build'}${isRecord(build) && build.uncommittedBenchmarkCode !== false ? ' with uncommitted benchmark code' : ''}, not the committed measurement HEAD ${measurementHead}: records of another HEAD are never mixed in.`)
      for (const worker of [record.first, record.fresh]) {
        demand(worker.environment === null || worker.environment.buildCommit === measurementHead, `${file.file} ${record.id}: the ${worker.role} Worker ran another build (${String(worker.environment?.buildCommit)}).`)
      }
      const key = `${record.startedAt}|${record.sequence}|${record.id}`
      const text = JSON.stringify(record)
      const previous = byKey.get(key)
      if (previous !== undefined) {
        demand(previous.text === text, `Two raw files hold different records for ${record.id} started at ${record.startedAt}.`)
        continue
      }
      byKey.set(key, { text, run: { record, source: file.file, pageUserAgent: typeof raw.environment.userAgent === 'string' ? raw.environment.userAgent : null } })
    }
  }
  return [...byKey.values()].map(entry => entry.run)
}

// -------------------------------------------------------------------------------------------------------------------------------------
// Premises (design 12.4 step 1)
// -------------------------------------------------------------------------------------------------------------------------------------

function planPremises(plan: GabMeasurementPlan, d1c: GabD1cReading, registered: GabAnalysisSources['registered'], d1cShaMatches: boolean): GabPremiseIssue[] {
  const issues: GabPremiseIssue[] = []
  if (!d1cShaMatches) issues.push({ reason: 'reference_inconsistent', source: 'd1c_result', detail: 'The D-1C public RESULT at the measured commit is not the SHA-256 the plan fixed.' })
  issues.push(...d1c.issues)
  if (plan.conditions.source !== registered.source || !same(plan.conditions.materialization, registered.materialization) || !same(plan.conditions.verification, registered.verification)
    || plan.conditions.registrationFingerprint !== registered.fingerprint) {
    issues.push({ reason: 'conditions_mismatch', source: 'registration', detail: 'The plan conditions are not the registered conditions of the analyzed code.' })
  }
  if (!same(plan.export, d1c.export)) issues.push({ reason: 'export_identity_mismatch', source: 'd1c_result', detail: 'The plan Export is not the D-1C Export.' })
  if (!same(plan.calculationContext, d1c.calculationContext) || plan.calculationContext.rngEngineVersion !== d1c.rngEngineVersion) {
    issues.push({ reason: 'calculation_context_mismatch', source: 'd1c_result', detail: 'The plan CalculationContext is not the D-1C one.' })
  }
  if (!same(plan.conditions.materialization, d1c.conditions.materialization) || !same(plan.conditions.verification, d1c.conditions.verification)) {
    issues.push({ reason: 'conditions_mismatch', source: 'd1c_result', detail: 'The plan conditions are not the D-1C registered conditions.' })
  }
  return issues
}

function recordPremises(plan: GabMeasurementPlan, d1c: GabD1cReading, slotId: string, record: GabLogicalRunRecord): GabPremiseIssue[] {
  const issues: GabPremiseIssue[] = []
  const premise = (reason: GabPremiseIssue['reason'], detail: string) => issues.push({ reason, source: slotId, detail })
  if (!same(record.export, plan.export)) premise('export_identity_mismatch', 'The logical run picked another Export.')
  for (const worker of [record.first, record.fresh]) {
    const result: GabWorkerResult | null = worker.settlement?.result ?? null
    if (result === null || !isRecord(result)) continue
    const observation = isRecord(result.exportObservation) ? result.exportObservation : null
    if (observation !== null && !same({ fileName: observation.fileName, bytes: observation.bytes, sha256: observation.sha256 }, plan.export)) premise('export_identity_mismatch', `The ${worker.role} Worker read another Export.`)
    if (!same(result.calculationContext, plan.calculationContext) || result.rngEngineVersion !== plan.calculationContext.rngEngineVersion) premise('calculation_context_mismatch', `The ${worker.role} Worker has another CalculationContext.`)
    const conditions = isRecord(result.conditions) ? result.conditions : null
    if (conditions === null || conditions.source !== plan.conditions.source || !same(conditions.materialization, plan.conditions.materialization)
      || conditions.researchMaxPlanSteps !== plan.conditions.verification.researchMaxPlanSteps || conditions.verificationBudget !== plan.conditions.verification.verificationBudget
      || (d1c.plannerInputMaxPlanStepsForValidationOnly !== null && result.plannerInputMaxPlanStepsForValidationOnly !== d1c.plannerInputMaxPlanStepsForValidationOnly)) {
      premise('conditions_mismatch', `The ${worker.role} Worker ran other conditions.`)
    }
  }
  return issues
}

// -------------------------------------------------------------------------------------------------------------------------------------
// Observed values (design 9): timings, responsiveness, memory - never semantic
// -------------------------------------------------------------------------------------------------------------------------------------

function workerTimings(worker: GabWorkerRunRecord) {
  const settlement = worker.settlement
  const result = settlement?.result ?? null
  const timing = result?.observed.timing ?? null
  const elapsed = result?.materialization?.observed.elapsedMs ?? null
  const candidate = elapsed?.candidates[0] ?? null
  const dPrime = result?.verification?.observed.elapsedMs as Record<string, number | null> | undefined
  return {
    workerStartupMs: roundOrNull(worker.createToReadyMs), requestAcceptMs: roundOrNull(settlement?.timing.postToAcceptedMs), roundTripMs: roundOrNull(settlement?.timing.roundTripMs),
    exportReadMs: roundOrNull(timing?.input.exportReadMs), exportHashMs: roundOrNull(timing?.input.exportHashMs), utf8DecodeMs: roundOrNull(timing?.input.decodeMs), jsonParseMs: roundOrNull(timing?.input.parseMs),
    plannerInputBuildMs: roundOrNull(timing?.input.buildInputMs), inputTotalMs: roundOrNull(timing?.input.totalMs),
    phase0Ms: worker.role === 'first' ? roundOrNull(elapsed?.context) : roundOrNull(timing?.phase0Ms),
    phaseAMs: roundOrNull(elapsed?.reachTable), phaseBcMs: roundOrNull(elapsed?.structuralSearch), toFirstStructuralCandidateMs: roundOrNull(elapsed?.toFirstStructuralCandidate),
    phaseDDiagnosticsMs: roundOrNull(candidate?.diagnostics), phaseDMaterializationMs: roundOrNull(candidate?.materialization), materializationTotalMs: roundOrNull(elapsed?.total),
    dPrimeHandoffMs: roundOrNull(dPrime?.handoff), dPrimeFinalInputMs: roundOrNull(dPrime?.final_input), dPrimePlannerMs: roundOrNull(dPrime?.planner), traceReplayMs: roundOrNull(dPrime?.trace_replay),
    physicalSummaryMs: roundOrNull(dPrime?.physical), dPrimeTotalMs: roundOrNull(dPrime?.total),
    evidenceMs: roundOrNull([timing?.evidence.materializationHashMs, timing?.evidence.entrySetMs, timing?.evidence.verificationHashMs].reduce<number | null>((sum, value) => (isFiniteNumber(value) ? (sum ?? 0) + value : sum), null)),
    workerTotalMs: roundOrNull(timing?.workerTotalMs),
  }
}

function workerResponsiveness(worker: GabWorkerRunRecord) {
  const settlement = worker.settlement
  const result = settlement?.result ?? null
  const slices = result?.observed.slices ?? null
  return {
    yields: result?.observed.yields ?? null, heartbeats: result?.observed.heartbeats ?? null, progressEvents: result?.observed.progressEvents ?? null,
    mainMaxMessageGapMs: roundOrNull(settlement?.progress.maxMessageGapMs),
    longestYieldGap: result?.observed.longestYieldGap ? { ms: round(result.observed.longestYieldGap.ms), fromStage: result.observed.longestYieldGap.fromStage, toStage: result.observed.longestYieldGap.toStage } : null,
    maxSliceMsByStage: slices === null ? null : Object.fromEntries(Object.keys(slices).sort().map(stage => [stage, round(slices[stage]!.maxSliceMs)])),
    ping: worker.ping === null ? null : { count: worker.ping.count, lost: worker.ping.lost, medianMs: roundOrNull(worker.ping.medianMs), p95Ms: roundOrNull(worker.ping.p95Ms), maxMs: roundOrNull(worker.ping.maxMs) },
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return round(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2)
}

/** min / median / max of each observed timing over the given Workers (a value absent on a Worker is not counted for it). */
function aggregateTimings(rows: Record<string, number | null>[]): Record<string, { n: number; min: number | null; median: number | null; max: number | null }> {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))]
  return Object.fromEntries(keys.map(key => {
    const values = rows.map(row => row[key]).filter(isFiniteNumber)
    return [key, { n: values.length, min: values.length ? round(Math.min(...values)) : null, median: median(values), max: values.length ? round(Math.max(...values)) : null }]
  }))
}

function memoryPoints(worker: GabWorkerRunRecord) {
  return (worker.memory ?? []).map(sample => ({
    label: sample.label, atMs: round(sample.atMs), status: sample.userAgentSpecific.status,
    bytes: sample.userAgentSpecific.status === 'ok' ? sample.userAgentSpecific.bytes : null,
    dedicatedWorkerBytes: sample.userAgentSpecific.status === 'ok' ? sample.userAgentSpecific.dedicatedWorkerBytes : null,
    windowBytes: sample.userAgentSpecific.status === 'ok' ? sample.userAgentSpecific.windowBytes : null,
    resolveMs: sample.userAgentSpecific.status === 'ok' ? round(sample.userAgentSpecific.resolveMs) : null,
    unavailableReason: sample.userAgentSpecific.status === 'ok' ? null : sample.userAgentSpecific.reason,
    mainRealmUsedJSHeapSize: sample.mainRealm?.usedJSHeapSize ?? null, mainRealmJSHeapSizeLimit: sample.mainRealm?.jsHeapSizeLimit ?? null,
  }))
}

function driverMemory(slot: GabDriverSlot | undefined) {
  const heap = slot?.cdpWorkerHeap ?? null
  const os = slot?.osRendererMemory ?? null
  const byRole = (role: GabRole) => {
    const samples = heap === null ? [] : heap.samples.filter(sample => sample.role === role)
    return { samples: samples.length, maxSampledUsedBytes: samples.length ? Math.max(...samples.map(sample => sample.usedSize)) : null, maxSampledTotalBytes: samples.length ? Math.max(...samples.map(sample => sample.totalSize)) : null }
  }
  return {
    cdpWorkerHeap: heap === null ? { status: 'not_sampled' as const } : { status: 'sampled' as const, intervalMs: heap.intervalMs, errors: heap.errors, first: byRole('first'), fresh: byRole('fresh') },
    osRendererMemory: os === null || os.samples.length === 0 ? { status: 'not_sampled' as const } : {
      status: 'sampled' as const, intervalMs: os.intervalMs, samples: os.samples.length,
      maxSampledPrivateBytes: Math.max(...os.samples.map(sample => sample.privateBytes)), maxSampledWorkingSetBytes: Math.max(...os.samples.map(sample => sample.workingSetBytes)),
      maxProcessCount: Math.max(...os.samples.map(sample => sample.processCount)),
    },
  }
}

// -------------------------------------------------------------------------------------------------------------------------------------
// The analysis
// -------------------------------------------------------------------------------------------------------------------------------------

function cancelTrialWorker(worker: GabWorkerRunRecord): GabCancelTrialWorker {
  const settlement = worker.settlement
  const request = worker.audit?.requests.find(entry => entry.requestId === worker.requestId) ?? null
  return {
    role: worker.role, settle: worker.settle, requestStarted: worker.requestStarted, settledBy: settlement?.settledBy ?? null, resultAdopted: settlement?.result !== null && settlement?.result !== undefined,
    cancelRequested: settlement?.cancelRequested ?? false, errorCode: settlement?.error?.code ?? null, cancel: settlement?.cancel ?? null,
    stoppedAt: settlement?.cancelledObservation?.stoppedAt ?? null, via: settlement?.cancelledObservation?.via ?? null,
    audit: request === null ? null : { settleCount: request.settleCount, adoptedResults: request.adoptedResults, cancelAccepted: request.cancelAccepted },
    terminated: worker.audit?.terminated ?? null, lateResponses: worker.lateResponses,
  }
}

const completedBoth = (record: GabLogicalRunRecord) => record.first.settle === 'completed' && record.fresh.settle === 'completed'

export interface GabEnvironmentAnalysis {
  environment: GabPlanEnvironment
  parity: GabEnvironmentParity | null
  cancelTrials: GabCancelTrial[]
  outcomes: GabOutcomeTally | null
  slots: {
    slot: GabPlanSlot
    record: GabLogicalRunRecord | null
    /** The comparable values of the bound record's Workers (null: no record bound, or a Worker that produced none). */
    views: Record<GabRole, GabWorkerParityView | null> | null
    rawIssues: string[]
    external: GabDriverSlot['external']
    driver: GabDriverSlot | null
  }[]
  order: { followed: boolean; outOfOrderSlots: string[] } | null
  unplanned: GabSlotBinding['unplanned']
  premiseIssues: GabPremiseIssue[]
}

export interface GabMeasurementAnalysis {
  measurementHead: string
  plan: GabMeasurementPlan
  planSource: { file: string; bytes: number; sha256: string }
  d1cSource: { file: string; bytes: number; sha256: string }
  d1c: GabD1cReading
  d1cShaMatchesPlan: boolean
  node: GabNodeReading | null
  driver: GabDriverRecord | null
  records: ReadRecord[]
  environments: GabEnvironmentAnalysis[]
  sourceFiles: { file: string; bytes: number; sha256: string }[]
  identifiers: string[]
}

/** The whole analysis of one measurement (deterministic: the same sources give the same analysis). */
export async function analyzeGabMeasurement(sources: GabAnalysisSources, ports: GabAnalysisPorts): Promise<GabMeasurementAnalysis> {
  const head = sources.measurementHead
  demand(COMMIT.test(head), `The measurement HEAD ${head} is not a 40-hex commit.`)
  demand(sources.plan.commit === head && sources.d1cResult.commit === head, 'The plan and the D-1C public RESULT must be read at the measurement HEAD (the plan of the measured commit is the only authority).')
  const extracted = extractGabMeasurementPlan(sources.plan.text)
  demand(extracted.issues.length === 0, `The plan cannot be read: ${extracted.issues.join(' ')}`)
  const planIssues = gabMeasurementPlanIssues(extracted.plan)
  demand(planIssues.length === 0, `The plan is invalid: ${planIssues.slice(0, 8).join(' / ')}`)
  const plan = extracted.plan as GabMeasurementPlan
  demand(sources.d1cResult.path === plan.references.d1cPublicResult.path, `The D-1C public RESULT must be the plan's ${plan.references.d1cPublicResult.path}, not ${sources.d1cResult.path}.`)
  const d1c = readGabD1cReference(parseJson(sources.d1cResult, 'The D-1C public RESULT'))
  const d1cShaMatchesPlan = sources.d1cResult.sha256 === plan.references.d1cPublicResult.sha256
  const node = sources.node === null ? null : await readGabNodeReference(sources.node, plan, head, ports)
  let driver: GabDriverRecord | null = null
  if (sources.driver !== null) {
    const value = parseJson(sources.driver, 'The driver record')
    const issues = gabDriverRecordIssues(value, head)
    demand(issues.length === 0, `The driver record ${sources.driver.file} is malformed: ${issues.slice(0, 5).join(' / ')}`)
    driver = value as GabDriverRecord
  }
  const runs = readRawRecords(sources.browserRaw, head)
  const records: ReadRecord[] = []
  for (const run of runs) {
    const first = await readWorker(run.record.first, ports)
    const fresh = await readWorker(run.record.fresh, ports)
    records.push({ run, rawIssues: [...first.issues, ...fresh.issues], views: { first: first.view, fresh: fresh.view } })
  }
  const binding = bindGabRecordsToPlan(plan, runs)
  const readOf = (run: GabRecordedRun | undefined) => (run === undefined ? null : records.find(entry => entry.run === run) ?? null)
  const shared = planPremises(plan, d1c, sources.registered, d1cShaMatchesPlan)
  const environments: GabEnvironmentAnalysis[] = plan.environments.map(environment => {
    const unplanned = binding.unplanned.filter(entry => environment.slots.some(slot => slot.slotId === entry.slotId))
    if (environment.status !== 'planned') return { environment, parity: null, cancelTrials: [], outcomes: null, slots: [], order: null, unplanned, premiseIssues: [] }
    const slotRows = environment.slots.map(slot => {
      const read = readOf(binding.bound.get(slot.slotId))
      const driverSlot = driver?.slots.find(entry => entry.slotId === slot.slotId) ?? null
      return { slot, read, record: read?.run.record ?? null, rawIssues: read?.rawIssues ?? [], external: driverSlot?.external ?? null, driver: driverSlot }
    })
    const premiseIssues = [...shared, ...(node?.issues ?? []), ...slotRows.flatMap(row => (row.record === null ? [] : recordPremises(plan, d1c, row.slot.slotId, row.record)))]
    const paritySlots: GabParitySlot[] = slotRows.map(row => ({
      slotId: row.slot.slotId, purpose: row.slot.purpose,
      record: row.record === null ? null : {
        integrityIssueCount: row.record.integrityIssues.length + row.rawIssues.length, verdictKind: row.record.judgement.verdict.kind,
        first: { settle: row.record.first.settle, view: row.read!.views.first }, fresh: { settle: row.record.fresh.settle, view: row.read!.views.fresh },
      },
    }))
    const parity = judgeGabEnvironmentParity({ environmentId: environment.environmentId, requiredComparisonRuns: environment.requiredComparisonRuns, slots: paritySlots, premiseIssues, d1c: d1c.view, node: node?.view ?? null })
    const rowOf = (slotId: string) => slotRows.find(row => row.slot.slotId === slotId) ?? null
    const cancelTrials = slotRows.filter(row => row.slot.purpose === 'cancel').map(row => {
      const trigger = row.slot.options.cancelTrigger!
      const rerunRow = row.slot.rerunSlotId === null ? null : rowOf(row.slot.rerunSlotId)
      return judgeGabCancelTrial({
        slotId: row.slot.slotId, plannedTrigger: { role: trigger.role, onProgressKey: trigger.onProgressKey, delayMs: trigger.delayMs },
        record: row.record === null ? null : {
          cancel: row.record.cancel === null ? null : {
            source: row.record.cancel.source, phase: row.record.cancel.phase, role: row.record.cancel.role, acceptedByRequest: row.record.cancel.acceptedByRequest,
            requestedAtMs: row.record.cancel.requestedAtMs, triggered: row.record.cancel.triggered === null ? null : { ...row.record.cancel.triggered },
          },
          first: cancelTrialWorker(row.record.first), fresh: cancelTrialWorker(row.record.fresh),
        },
        external: row.external?.kind ?? null,
        rerun: rerunRow === null ? null : { slotId: rerunRow.slot.slotId, recorded: rerunRow.record !== null, completed: rerunRow.record !== null && completedBoth(rerunRow.record) && rerunRow.record.integrityIssues.length + rerunRow.rawIssues.length === 0 },
      })
    })
    const outcomes = tallyGabOutcomes(slotRows.map(row => ({
      slotId: row.slot.slotId, purpose: row.slot.purpose, external: row.external?.kind ?? null,
      record: row.record === null ? null : {
        firstSettle: row.record.first.settle, freshSettle: row.record.fresh.settle, interrupted: row.record.lifecycle.interrupted,
        ignoredResultAfterCancel: { first: row.record.first.settlement?.cancel?.ignoredResultAfterCancel != null, fresh: row.record.fresh.settlement?.cancel?.ignoredResultAfterCancel != null },
      },
    })), unplanned.map(entry => ({ reason: entry.reason })))
    return {
      environment, parity, cancelTrials, outcomes, order: binding.order[environment.environmentId] ?? null, unplanned, premiseIssues,
      slots: slotRows.map(row => ({ slot: row.slot, record: row.record, views: row.read === null ? null : { ...row.read.views }, rawIssues: row.rawIssues, external: row.external, driver: row.driver })),
    }
  })
  // Every Target / OwnedWeapon / Entry / Candidate identifier the raw records hold: none may reach the public RESULT.
  const browserChildren: D1cSourceChild[] = records.flatMap(entry => [entry.run.record.first, entry.run.record.fresh].flatMap(worker => {
    const result = worker.settlement?.result ?? null
    if (result === null) return []
    return [{
      runIndex: 1, role: worker.role,
      reading: { process: 'completed', record: { verification: result.verification, materialization: result.materialization, phase0PlanningTargetIds: result.phase0.planningTargetIdsSorted } as never, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } },
      entrySet: result.entrySet?.value ?? null,
    } as D1cSourceChild]
  }))
  const identifiers = collectD1cRecordIdentifiers([...browserChildren, ...(node?.children ?? [])])
  const sourceFiles = [sources.plan, sources.d1cResult, ...sources.browserRaw, ...(sources.driver === null ? [] : [sources.driver]),
    ...(sources.node === null ? [] : [sources.node.output, ...(sources.node.first === null ? [] : [sources.node.first]), ...(sources.node.fresh === null ? [] : [sources.node.fresh])])]
    .map(file => ({ file: file.file, bytes: file.bytes, sha256: file.sha256 }))
  return {
    measurementHead: head, plan, planSource: { file: sources.plan.file, bytes: sources.plan.bytes, sha256: sources.plan.sha256 },
    d1cSource: { file: sources.d1cResult.file, bytes: sources.d1cResult.bytes, sha256: sources.d1cResult.sha256 }, d1c, d1cShaMatchesPlan, node, driver, records, environments, sourceFiles, identifiers,
  }
}

// -------------------------------------------------------------------------------------------------------------------------------------
// The public RESULT (minimized: run-level values only)
// -------------------------------------------------------------------------------------------------------------------------------------

function redact(text: string, identifiers: readonly string[]): string {
  let value = text
  for (const identifier of identifiers) value = value.split(identifier).join('<redacted>')
  return value
}

function observedEnvironment(environment: GabEnvironmentAnalysis, analysis: GabMeasurementAnalysis) {
  const record = environment.slots.find(row => row.record !== null)?.record ?? null
  if (record === null) return null
  const worker = record.first.environment ?? record.fresh.environment
  const raw = analysis.records.find(entry => entry.run.record === record)?.run ?? null
  return {
    userAgent: worker?.userAgent ?? raw?.pageUserAgent ?? null, hardwareConcurrency: worker?.hardwareConcurrency ?? null, deviceMemory: worker?.deviceMemory ?? null,
    language: worker?.language ?? null, workerLocale: worker?.locale ?? null, isSecureContext: worker?.isSecureContext ?? null,
    workerRealmPerformanceMemory: worker === null ? null : worker.capabilities.workerPerformanceMemory,
    crossOriginIsolatedByOrigin: Object.fromEntries(['non_isolated', 'isolated'].map(origin => {
      const row = environment.slots.find(entry => entry.slot.origin === origin && entry.record !== null)
      return [origin, row === undefined ? null : row.record!.main.crossOriginIsolated]
    })),
    exportTransports: [...new Set(environment.slots.flatMap(row => (row.record === null ? [] : [row.record.first.exportTransport, row.record.fresh.exportTransport]).filter((value): value is NonNullable<typeof value> => value !== null)))].sort(),
  }
}

function slotSummary(row: GabEnvironmentAnalysis['slots'][number], parity: GabEnvironmentParity | null) {
  const record = row.record
  const status = parity?.slots.find(slot => slot.slotId === row.slot.slotId) ?? null
  return {
    slotId: row.slot.slotId, purpose: row.slot.purpose, order: row.slot.order, origin: row.slot.origin, comparisonRole: gabComparisonRole(row.slot.purpose),
    recorded: record !== null, external: row.external === null ? null : row.external.kind,
    startedAt: record?.startedAt ?? row.driver?.startedAt ?? null, cpuLoadPercentBefore: row.driver?.cpuLoadPercentBefore ?? null,
    firstSettle: record?.first.settle ?? null, freshSettle: record?.fresh.settle ?? null, verdictKind: record?.judgement.verdict.kind ?? null,
    integrityIssueCount: record === null ? null : record.integrityIssues.length + row.rawIssues.length, parityCompleted: status?.completed ?? null, comparedWorkers: status?.comparedWorkers ?? [],
    interrupted: record?.lifecycle.interrupted ?? null, cancelPhase: record?.cancel?.phase ?? null, logicalRunWallMs: roundOrNull(record?.logicalRunWallMs),
    first: record === null ? null : { timing: workerTimings(record.first), responsiveness: workerResponsiveness(record.first), lateResponses: record.first.lateResponses },
    fresh: record === null ? null : { timing: workerTimings(record.fresh), responsiveness: workerResponsiveness(record.fresh), lateResponses: record.fresh.lateResponses },
  }
}

/** The semantic values of the compared Workers (the comparison population): the distinct hashes and the first compared Worker's counts. */
function semanticSummary(environment: GabEnvironmentAnalysis) {
  const compared = (environment.parity?.slots ?? []).flatMap(status => {
    const row = environment.slots.find(entry => entry.slot.slotId === status.slotId)
    return status.comparedWorkers.map(worker => row?.views?.[worker] ?? null)
  }).filter((view): view is GabWorkerParityView => view !== null)
  const reference = compared.find(view => view.verification !== null)?.verification ?? null
  const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => typeof value === 'string'))].sort()
  return {
    comparedWorkerCount: compared.length,
    materializationSemanticSha256s: unique(compared.map(view => view.materialization?.semanticSha256)),
    verificationSemanticSha256s: unique(compared.map(view => view.verification?.semanticSha256)),
    entryFingerprints: unique(compared.map(view => view.entryFingerprint)),
    planningTargetCount: reference?.planningTargetCount ?? null, materializedEntryCount: reference?.materializedEntryCount ?? null,
    materializedBy: compared.find(view => view.materialization !== null)?.materialization?.candidate?.materializedBy ?? null,
    terminationStatus: reference?.termination?.status ?? null, expandedStates: reference?.termination?.expandedStates ?? null,
    completedTargetCount: reference?.termination?.completedTargetCount ?? null, totalTargetCount: reference?.termination?.totalTargetCount ?? null,
    selectedEntryCount: reference?.selectedEntryCount ?? null, conflictCount: reference?.conflictCount ?? null, rejectedCount: reference?.rejectedCount ?? null,
    resourceConflictCount: reference?.resourceConflictCount ?? null, warningCount: reference?.warningCount ?? null, fullPlannerRuns: reference?.fullPlannerRuns ?? null,
    traceReplayValid: reference?.traceReplay?.isValid ?? null, traceReplayDrafts: reference?.traceReplay?.draftsTotal ?? null, traceReplayMismatchCount: reference?.traceReplay?.mismatchCount ?? null,
    physicalOperations: reference?.physical?.physicalOperations ?? null, planSteps: reference?.physical?.planSteps ?? null, nonPhysicalStepCount: reference?.physical?.nonPhysicalStepCount ?? null,
    streamAdvanceSum: reference?.physical?.streamAdvanceSum ?? null, objective: reference?.physical?.objective ?? null,
    planHash: reference?.planHash ?? null, stepSemanticsHash: reference?.stepSemanticsHash ?? null, executedHash: reference?.physical?.executedHash ?? null,
  }
}

function environmentSummary(environment: GabEnvironmentAnalysis, analysis: GabMeasurementAnalysis) {
  const base = { environmentId: environment.environment.environmentId, status: environment.environment.status, description: environment.environment.description, unavailableReason: environment.environment.unavailableReason }
  if (environment.environment.status !== 'planned' || environment.parity === null || environment.outcomes === null) {
    return { ...base, confirmation: 'unconfirmed', parity: null, observedEnvironment: null, semanticValues: null, slots: [], cancelTrials: [], outcomes: null, performance: null, memory: null, storage: null, binding: { boundSlots: 0, unplannedRecords: environment.unplanned.length, orderFollowed: null, outOfOrderSlots: [] } }
  }
  const parity = environment.parity
  const timingRows = environment.slots.filter(row => (row.slot.purpose === 'timing' || row.slot.purpose === 'rerun') && row.record !== null && completedBoth(row.record)
    && !row.record.lifecycle.interrupted && row.record.integrityIssues.length + row.rawIssues.length === 0)
  const memoryRows = environment.slots.filter(row => row.slot.purpose === 'memory')
  const sessions = analysis.driver?.sessions ?? []
  const storageOf = (state: GabStorageState | null) => (state === null ? null : { ...state })
  const identifiers = analysis.identifiers
  return {
    ...base, confirmation: 'measured',
    parity: {
      status: parity.status, reasonCodes: [...parity.reasonCodes], requiredComparisonRuns: parity.requiredComparisonRuns, completedRequiredRuns: parity.completedRequiredRuns, comparedWorkerCount: parity.comparedWorkerCount,
      premiseIssues: parity.premiseIssues.map(issue => ({ reason: issue.reason, source: issue.source, detail: redact(issue.detail, identifiers) })),
      referenceMismatches: parity.referenceMismatches.map(item => ({ worker: item.worker, part: item.part, fields: [...item.fields] })),
      mismatches: parity.mismatches.map(item => ({ against: item.against, slotId: item.slotId, worker: item.worker, part: item.part, fields: [...item.fields], comparedWith: item.comparedWith === null ? null : { ...item.comparedWith } })),
      claims: parity.claims,
    },
    observedEnvironment: observedEnvironment(environment, analysis),
    semanticValues: semanticSummary(environment),
    slots: environment.slots.map(row => slotSummary(row, parity)),
    cancelTrials: environment.cancelTrials.map(trial => ({
      ...trial, plannedTrigger: { ...trial.plannedTrigger }, reasonCodes: [...trial.reasonCodes], rerun: trial.rerun === null ? null : { ...trial.rerun },
      acceptedAtMs: roundOrNull(trial.acceptedAtMs), ackMs: roundOrNull(trial.ackMs), settledMs: roundOrNull(trial.settledMs),
    })),
    outcomes: structuredClone(environment.outcomes),
    performance: {
      basis: 'timing / rerun slots whose two Workers completed with an intact record and no visibility / freeze interruption (observed values; no threshold, no pass)',
      eligibleSlots: timingRows.map(row => row.slot.slotId),
      first: aggregateTimings(timingRows.map(row => workerTimings(row.record!.first))),
      fresh: aggregateTimings(timingRows.map(row => workerTimings(row.record!.fresh))),
      logicalRunWallMs: aggregateTimings(timingRows.map(row => ({ logicalRunWallMs: roundOrNull(row.record!.logicalRunWallMs) }))).logicalRunWallMs ?? null,
      excludedSlots: environment.slots.filter(row => (row.slot.purpose === 'timing' || row.slot.purpose === 'rerun') && !timingRows.includes(row)).map(row => row.slot.slotId),
    },
    memory: {
      basis: 'memory slots only: fixed points of measureUserAgentSpecificMemory (cross-origin isolated), the external CDP Worker heap sampling and the OS renderer process memory (max sampled, never a continuous peak); null / not_sampled where unavailable, never estimated',
      slots: memoryRows.map(row => ({
        slotId: row.slot.slotId, recorded: row.record !== null,
        fixedPoints: row.record === null ? [] : [...memoryPoints(row.record.first), ...memoryPoints(row.record.fresh)],
        ...driverMemory(row.driver ?? undefined),
      })),
      workerRealmPerformanceMemory: observedEnvironment(environment, analysis)?.workerRealmPerformanceMemory === true ? 'available' : 'unavailable',
      dedicatedWorkerHeapLimit: 'unknown (not exposed by the Browser)',
    },
    storage: sessions.length === 0 ? null : {
      sessions: sessions.map(session => ({ sessionId: session.sessionId, crossOriginIsolated: session.crossOriginIsolated, before: storageOf(session.storageBefore), after: storageOf(session.storageAfter), pageLost: session.pageLost })),
      unchanged: sessions.every(session => session.storageBefore !== null && session.storageAfter !== null && same(session.storageBefore, session.storageAfter)),
    },
    binding: { boundSlots: environment.slots.filter(row => row.record !== null).length, unplannedRecords: environment.unplanned.length, unplannedReasons: environment.outcomes.unplannedRecords.reasonCounts, orderFollowed: environment.order?.followed ?? null, outOfOrderSlots: [...(environment.order?.outOfOrderSlots ?? [])] },
  }
}

/** The public RESULT, derived from the sources only (deterministic: the same sources give the same JSON). */
export async function deriveGabPublicResult(sources: GabAnalysisSources, ports: GabAnalysisPorts) {
  const analysis = await analyzeGabMeasurement(sources, ports)
  const build = analysis.records[0]?.run.record.main.build as Record<string, unknown> | undefined
  const driver = analysis.driver
  const plan = analysis.plan
  return {
    resultKind: GAB_PUBLIC_RESULT_KIND,
    derivation: {
      revision: GAB_PUBLIC_RESULT_REVISION, script: GAB_ANALYSIS_SCRIPT, function: 'deriveGabPublicResult() (src/benchmarks/globalAssignment/browser/globalAssignmentBrowserAnalysis.ts)',
      sources: [...analysis.sourceFiles].sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0)),
      withheld: ['Target / OwnedWeapon / BuildListEntry / Candidate identifiers and per-Target values', 'Entry bodies, Routes and Plan Steps', 'Counter positions and stream ends', 'the Export itself and absolute paths', 'integrity issue texts (their counts are kept)'],
      note: 'A mechanical aggregate of the raw Browser records, the driver record, the Node reference and the D-1C public RESULT kept in git-ignored .local files (the plan and the D-1C RESULT read at the measured commit); no new calculation.',
    },
    phase: 'Issue #154 Production準備 P-2: the real Export in the Browser Worker, its semantic parity with the Node reference and the D-1C public RESULT, and its observed performance',
    nature: 'Research, non-formal (formal: false): no formal validity, acceptance, minimality, performance threshold or Production decision is claimed',
    formal: false,
    measurement: {
      measurementHead: analysis.measurementHead, protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION,
      plan: { file: analysis.planSource.file, sha256: analysis.planSource.sha256, revision: plan.revision, series: plan.series, baseCommit: plan.baseCommit },
      benchmarkBuild: build === undefined ? null : { commit: build.commit ?? null, uncommittedBenchmarkCode: build.uncommittedBenchmarkCode ?? null, benchmarkCodeSha256: build.benchmarkCodeSha256 ?? null },
      recordedLogicalRuns: analysis.records.length,
      driver: driver === null ? null : { driverSha256: driver.driverSha256, browser: driver.launcher.browser, version: driver.launcher.version, headless: driver.launcher.headless, flags: [...driver.launcher.flags], profile: driver.launcher.profile, machine: { ...driver.machine } },
    },
    export: { ...plan.export },
    calculationContext: { ...plan.calculationContext },
    conditions: {
      source: plan.conditions.source, registrationFingerprint: plan.conditions.registrationFingerprint,
      materializationRule: plan.conditions.materialization.rule, window: { ...plan.conditions.materialization.window }, reachOptionSet: plan.conditions.materialization.reachOptionSet ?? null,
      structuralCandidateLimit: plan.conditions.materialization.structuralCandidateLimit, nodeBudget: plan.conditions.materialization.nodeBudget, mrvLookahead: plan.conditions.materialization.mrvLookahead,
      researchMaxPlanSteps: plan.conditions.verification.researchMaxPlanSteps, verificationBudget: plan.conditions.verification.verificationBudget,
    },
    references: {
      d1cPublicResult: { path: plan.references.d1cPublicResult.path, sha256: analysis.d1cSource.sha256, matchesPlan: analysis.d1cShaMatchesPlan, ...analysis.d1c.summary, premiseIssueCount: analysis.d1c.issues.length },
      nodeReference: analysis.node === null ? { present: false } : { present: true, runner: plan.references.nodeReference.runner, ...analysis.node.summary, comparable: analysis.node.view !== null, premiseIssueCount: analysis.node.issues.length },
    },
    environments: analysis.environments.map(environment => environmentSummary(environment, analysis)),
    verdicts: { performance: 'not_judged', production: 'not_judged', formal: 'not_claimed' },
    unconfirmed: [
      'environments recorded as not_available (unconfirmed; never substituted by another environment)',
      'other Exports, windows, conditions and structural candidates',
      'determinism on other machines, Browsers or Browser versions',
      'the Dedicated Worker heap limit and any continuous memory peak between samples',
      'performance thresholds and Production suitability (not judged here)',
    ],
  }
}

export type GabPublicResult = Awaited<ReturnType<typeof deriveGabPublicResult>>

/** The only arrays the public RESULT may hold (run, slot, source and issue lists; never a per-Target list). */
export const GAB_PUBLIC_RESULT_AGGREGATE_ARRAYS = Object.freeze([
  'sources', 'withheld', 'flags', 'environments', 'slots', 'cancelTrials', 'reasonCodes', 'premiseIssues', 'referenceMismatches', 'mismatches', 'fields', 'comparedWorkers',
  'materializationSemanticSha256s', 'verificationSemanticSha256s', 'entryFingerprints', 'eligibleSlots', 'excludedSlots', 'fixedPoints', 'sessions', 'outOfOrderSlots', 'unconfirmed',
  'unrecordedSlots', 'incomplete', 'exportTransports',
] as const)

/** Why a public RESULT would carry data it must not (`[]` = minimized). */
export function gabPublicResultMinimizationIssues(result: unknown, identifiers: readonly string[]): string[] {
  const issues: string[] = []
  const text = JSON.stringify(result)
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) issues.push('The public RESULT contains a UUID.')
  if (/(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\|\/)|\/Users\/|\/home\//.test(text)) issues.push('The public RESULT contains a local absolute path.')
  for (const identifier of identifiers) if (text.includes(identifier)) issues.push(`The public RESULT contains a record identifier (${identifier.length} characters).`)
  const forbidden = new Set<string>(D1C_PUBLIC_RESULT_FORBIDDEN_KEYS)
  const arrays = new Set<string>(GAB_PUBLIC_RESULT_AGGREGATE_ARRAYS)
  const walk = (value: unknown, path: string, key: string | null) => {
    if (Array.isArray(value)) {
      if (key === null || !arrays.has(key)) issues.push(`${path} is not a known aggregate array.`)
      value.forEach((item, index) => walk(item, `${path}[${index}]`, null))
      return
    }
    if (!isRecord(value)) return
    for (const [name, item] of Object.entries(value)) {
      if (forbidden.has(name)) issues.push(`${path}.${name} is a Target-level or Plan-level field.`)
      walk(item, `${path}.${name}`, name)
    }
  }
  walk(result, '$', null)
  return issues
}

/** Why a public RESULT is not the derivation of the sources (`[]` = it is, and it is minimized). */
export async function gabPublicResultIssues(published: unknown, sources: GabAnalysisSources, ports: GabAnalysisPorts): Promise<string[]> {
  const issues: string[] = []
  const derived = await deriveGabPublicResult(sources, ports)
  if (JSON.stringify(published) !== JSON.stringify(derived)) {
    const record = isRecord(published) ? published : {}
    const differing = Object.keys(derived).filter(key => JSON.stringify(record[key]) !== JSON.stringify((derived as Record<string, unknown>)[key]))
    issues.push(`The public RESULT is not the derivation of the sources (differing: ${differing.join(', ') || 'key order or extra keys'}).`)
  }
  const analysis = await analyzeGabMeasurement(sources, ports)
  issues.push(...gabPublicResultMinimizationIssues(published, analysis.identifiers))
  return issues
}
