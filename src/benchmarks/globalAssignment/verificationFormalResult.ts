/**
 * Issue #154 Global Assignment Phase D-1C (Research only; never imported by the app).
 *
 * The public RESULT of a D-1C formal measurement (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md`): an audit aggregate derived
 * mechanically from the runner's raw outputs (the raw RESULT, the start record, the child records and Entry sets, all git-ignored under
 * `.local/`), never a copy of them and never a new measurement. Before anything is published the derivation rebuilds the observations
 * from the raw files, re-derives the whole conclusion (`concludeD1cMeasurement()`: integrity, formal validity, candidate outcome,
 * acceptance) and requires it to be the one the runner recorded. The Repository is public, so the RESULT carries provenance, validity,
 * counts, hashes, sums and maxima only: no Target / OwnedWeapon / Entry identifier, no Entry body or Candidate snapshot, no Route, no
 * Counter position, no Plan Step, no Export content (the minimization checks below enforce it).
 *
 * The script reads and hashes the files (SHA-256) and writes exclusively; this module reads no file.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import { summarizeD0cMaterializationOutcome } from './materializationFormal'
import { collectRecordIdentifiers, type D0cChildRecord, type D0cSourceFile } from './materializationFormalResult'
import type { MaterializationSemanticRecord } from './materializationRunner'
import {
  concludeD1cMeasurement, D1C_FORMAL_PROTOCOL_VERSION, d1cPlannerConditionsEvaluated, readD1cAuthorities, readD1cCalculationCodeAudit, registeredD1cExpectation,
  type D1cMeasurementConclusion, type D1cMeasurementObservation, type D1cProcessEntry, type D1cRegisteredExpectation, type D1cRole, type D1cStartObservation,
} from './verificationFormal'
import type { D0cIdentityComparison, D1aCheckoutState, D1aChildReading, D1aVerdict } from './verificationProtocol'
import { d1cRegisteredItemKeys, PLANNER_VERIFICATION_D1C_PREREGISTRATION } from './verificationRegistration'
import type { PlannerVerificationSemantic } from './verify'

export const D1C_PUBLIC_RESULT_KIND = 'global-assignment-d1c-public-result'
export const D1C_PUBLIC_RESULT_REVISION = 1
export const D1C_PUBLIC_RESULT_DERIVATION_SCRIPT = 'scripts/derive-planner-global-assignment-d1c-result.mjs'
/** The kind the runner writes on its raw RESULT (the derivation refuses any other source). */
export const D1C_RAW_RESULT_KIND = 'global-assignment-d1c-raw-result'

/** One child side of a raw run as the runner recorded it (its record stays in the run directory). */
export interface D1cRawSide {
  process: D1cProcessEntry
  readError: string | null
  recomputed: D1aChildReading['recomputed']
  confirmedProgress: unknown
  stderrTail: string | null
}

export interface D1cRawRun {
  runIndex: number
  dir: string
  first: D1cRawSide
  fresh: D1cRawSide | null
  checkoutBefore: D1aCheckoutState
  checkoutAfter: D1aCheckoutState
}

/** The start provenance the runner records (the conclusion reads `D1cStartObservation`; the rest is published provenance). */
export type D1cStartRecord = D1cStartObservation & {
  phase: string
  nature: string
  registrationHead: string
  documents: { source: string; sha256: string | null; error: string | null }[]
  oracleInformedDesign: boolean
  verificationProtocolVersion: string
  materializationProtocolVersion: string
  plannerInputMaxPlanStepsForValidationOnly: number
  runnerScript: string
  node: string
  v8: string
  launchedAt: string
  machine: Record<string, unknown>
}

/** The runner's raw RESULT (`scripts/run-planner-global-assignment-d1c.mjs`). */
export interface D1cRawOutput {
  resultKind: string
  formalProtocolVersion: string
  status: string
  runDir: string
  start: D1cStartRecord
  startRecordMatches: boolean
  cancelled: boolean
  runs: D1cRawRun[]
  conclusion: D1cMeasurementConclusion
  totalWallMs: number
  claims: string
}

/** A child as the derivation read it from the run directory (the runner's readChild() rule) with its Entry set when it wrote one. */
export interface D1cSourceChild {
  runIndex: number
  role: D1cRole
  reading: D1aChildReading
  /** The Entry set file of a first process (Research data, read for identifier collection only). */
  entrySet: unknown
}

export interface D1cPublicResultSources {
  output: D1cRawOutput
  /** The start record as read from the run directory (null when unreadable). */
  startRecordText: string | null
  children: readonly D1cSourceChild[]
  files: readonly D0cSourceFile[]
}

/** A raw source that does not have the shape the derivation reads: the derivation stops (never fills a value in). */
export class D1cPublicResultSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'D1cPublicResultSourceError'
  }
}

const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const roundOrNull = (value: number | null | undefined) => (typeof value === 'number' ? round(value) : null)
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/** The fields of a child record the derivation reads (untrusted file contents). */
interface ChildRecordView {
  formal?: { pid?: unknown; gate?: { issues?: unknown[] }; calculation?: { issues?: unknown[] }; entrySetSource?: { issues?: unknown[] } | null; verificationBudget?: unknown; verifiedCandidates?: unknown; inputsRead?: unknown[] } | null
  calculationContext?: unknown
  rngEngineVersion?: unknown
  identity?: D0cIdentityComparison | null
  materialization?: { semanticSha256?: string; semantic?: MaterializationSemanticRecord; wallMs?: number; observed?: { elapsedMs?: Record<string, unknown> } } | null
  entrySet?: { bytes?: number; sha256?: string; entryFingerprint?: string; entryCount?: number; issues?: unknown[] } | null
  phase0PlanningTargetIds?: string[] | null
  verification?: { semantic: PlannerVerificationSemantic; semanticSha256: string; observed?: { elapsedMs?: Record<string, number | null> } } | null
  observed?: { setupMs?: number; wallMs?: number; eventLoopYields?: number }
  memory?: { maxima?: { heapUsed?: number; heapTotal?: number; rss?: number; external?: number; samples?: number }; heapSizeLimit?: number; maxRssKiB?: number; stages?: { heapUsed: number; rss: number }[] }
}

function assertSources(sources: D1cPublicResultSources): void {
  const output = sources.output as unknown
  if (!isRecord(output)) throw new D1cPublicResultSourceError('The raw RESULT is not an object.')
  if (output.resultKind !== D1C_RAW_RESULT_KIND) throw new D1cPublicResultSourceError(`The raw RESULT kind ${String(output.resultKind)} is not ${D1C_RAW_RESULT_KIND}.`)
  for (const key of ['start', 'runs', 'conclusion', 'startRecordMatches']) if (!(key in output)) throw new D1cPublicResultSourceError(`The raw RESULT has no ${key}.`)
  for (const run of sources.output.runs) {
    for (const [role, side] of [['first', run.first], ['fresh', run.fresh]] as const) {
      if (side === null) continue
      const child = sources.children.find(entry => entry.runIndex === run.runIndex && entry.role === role)
      if (child === undefined) throw new D1cPublicResultSourceError(`No reading was given for run ${run.runIndex} ${role}.`)
    }
  }
}

/** The observations of the measurement rebuilt from the raw files (the readings from the run directory, the parent's own entries from the RESULT). */
export function rebuildD1cObservation(sources: D1cPublicResultSources): D1cMeasurementObservation {
  assertSources(sources)
  const output = sources.output
  const reading = (runIndex: number, role: D1cRole) => sources.children.find(entry => entry.runIndex === runIndex && entry.role === role)!.reading
  return {
    start: output.start,
    startRecordMatches: sources.startRecordText !== null && sources.startRecordText === serialize(output.start),
    runs: output.runs.map(run => ({
      runIndex: run.runIndex,
      first: { process: run.first.process, reading: reading(run.runIndex, 'first') },
      fresh: run.fresh === null ? null : { process: run.fresh.process, reading: reading(run.runIndex, 'fresh') },
      checkoutBefore: run.checkoutBefore, checkoutAfter: run.checkoutAfter,
    })),
  }
}

/** Every Target / OwnedWeapon / Entry / Candidate / Conflict / Counter identifier the raw records hold (none may appear in the public RESULT). */
export function collectD1cRecordIdentifiers(children: readonly D1cSourceChild[]): string[] {
  const identifiers = new Set<string>()
  const masterKey = /^(?:weaponTypeId|elementId|bonusTypeId|bonusRankId|seriesSkillId|groupSkillId|materialId|skillId)$/
  const identifierKey = (key: string) => key === 'id' || key === 'materializationOrder' || (/(?:Id|Ids)$/.test(key) && !masterKey.test(key))
  const add = (value: unknown) => { if (typeof value === 'string' && value.length >= 6) identifiers.add(value) }
  const walk = (value: unknown, key: string | null) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (key !== null && identifierKey(key)) add(item)
        walk(item, null)
      }
      return
    }
    if (!isRecord(value)) return
    for (const [name, item] of Object.entries(value)) {
      if (identifierKey(name)) add(item)
      walk(item, name)
    }
  }
  for (const child of children) {
    const record = child.reading.record as ChildRecordView | null
    if (record === null) continue
    walk(record.verification?.semantic ?? null, null)
    walk(record.phase0PlanningTargetIds ?? null, 'phase0PlanningTargetIds')
    walk(record.identity ?? null, null)
    const semantic = record.materialization?.semantic
    if (semantic !== undefined) for (const identifier of collectRecordIdentifiers([{ record: { semantic } as D0cChildRecord }])) add(identifier)
    walk(child.entrySet, null)
  }
  return [...identifiers].sort()
}

function redact(message: string, identifiers: readonly string[]): string {
  let text = message
  for (const identifier of identifiers) text = text.split(identifier).join('<redacted>')
  return text
}

function redactDeep<T>(value: T, identifiers: readonly string[]): T {
  if (typeof value === 'string') return redact(value, identifiers) as T
  if (Array.isArray(value)) return value.map(item => redactDeep(item, identifiers)) as T
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, identifiers)])) as T
  return value
}

/** The reason codes of an outcome or verdict (never the Target / Entry identifiers its reasons carry). */
function reasonCodesOf(value: { reasons?: unknown } | null): string[] {
  const reasons = Array.isArray(value?.reasons) ? value!.reasons as unknown[] : []
  return reasons.flatMap(reason => (isRecord(reason) && typeof reason.code === 'string' ? [reason.code] : []))
}

function verdictSummary(verdict: D1aVerdict | null) {
  if (verdict === null) return null
  const base = { kind: verdict.kind, run: 'run' in verdict ? verdict.run : null, reasonCodes: reasonCodesOf(verdict as { reasons?: unknown }) }
  if (verdict.kind === 'verified') {
    return { ...base, physicalOperations: verdict.physicalOperations, planSteps: verdict.planSteps, objective: verdict.objective, planningTargetCount: verdict.planningTargetCount, fullPlannerRuns: { ...verdict.fullPlannerRuns } }
  }
  if (verdict.kind === 'unmeasured') return { ...base, unmeasuredReason: verdict.reason }
  if (verdict.kind === 'invalid_run_integrity' || verdict.kind === 'stopped_d0c_identity_mismatch') return { ...base, issueCount: verdict.issues.length }
  if (verdict.kind === 'materialization_failed' || verdict.kind === 'materialization_unconfirmed' || verdict.kind === 'materialization_unsupported') return { ...base, outcomeKind: verdict.outcomeKind, outcomeReason: verdict.outcomeReason }
  if (verdict.kind === 'objective_mismatch') return { ...base, physicalOperations: verdict.physicalOperations, objective: verdict.objective }
  return base
}

function verificationSummary(record: ChildRecordView, expectation: D1cRegisteredExpectation) {
  const verification = record.verification ?? null
  if (verification === null) return null
  const semantic = verification.semantic
  const planner = semantic.planner
  const replay = semantic.traceReplay
  const physical = semantic.physical
  const finalInput = semantic.finalInput
  const elapsed = verification.observed?.elapsedMs ?? {}
  return {
    semanticSha256: verification.semanticSha256, protocolVersion: semantic.protocolVersion, researchMaxPlanSteps: semantic.conditions.researchMaxPlanSteps,
    outcome: { kind: semantic.outcome.kind, reasonCodes: reasonCodesOf(semantic.outcome as { reasons?: unknown }) },
    checks: { ...semantic.checks },
    conditionsEvaluated: d1cPlannerConditionsEvaluated(semantic, expectation).evaluated,
    candidate: {
      ordinal: semantic.candidate.ordinal, objective: semantic.candidate.objective, planningTargetCount: semantic.candidate.planningTargetCount,
      materializedEntryCount: semantic.candidate.materializedEntryCount, stage: semantic.candidate.stage, entryFingerprint: semantic.candidate.entryFingerprint,
    },
    finalInput: finalInput === null ? null : {
      replacementCount: finalInput.replacements.length, originalEntryCount: finalInput.originalEntryCount, finalEntryCount: finalInput.finalEntryCount,
      keptOriginalEntryCount: finalInput.keptOriginalEntryIds.length, sourceDataUnchanged: { ...finalInput.sourceDataUnchanged }, conflictResolutionCount: finalInput.conflictResolutionCount,
      maxPlanSteps: finalInput.maxPlanSteps,
      validation: { isValid: finalInput.validation.isValid, issueCount: finalInput.validation.issues.length, warningKinds: { ...finalInput.validation.warningKinds }, excludedEntryCount: finalInput.validation.excluded.length, excludedGeneratedEntryCount: finalInput.validation.excluded.filter(entry => entry.generated).length },
      phase0PlanningTargetCount: finalInput.phase0PlanningTargetIds.length, finalPlanningTargetCount: finalInput.finalPlanningTargetIds.length,
      planningTargetSetEqual: hashStableValue(finalInput.phase0PlanningTargetIds) === hashStableValue(finalInput.finalPlanningTargetIds),
    },
    planner: planner === null ? null : {
      fullPlannerRuns: planner.fullPlannerRuns, errorName: planner.error?.name ?? null,
      termination: planner.termination === null ? null : {
        status: planner.termination.status, reachedLimits: [...planner.termination.reachedLimits], limits: { ...planner.termination.limits }, expandedStates: planner.termination.expandedStates,
        completedTargetCount: planner.termination.completedTargetCount, totalTargetCount: planner.termination.totalTargetCount,
      },
      planPresent: planner.planPresent, planSteps: planner.planSteps, planHash: planner.planHash, stepSemanticsHash: planner.stepSemanticsHash,
      selectedEntryCount: planner.selectedBuildListEntryIds.length, expectedSelectedEntryCount: planner.expectedSelectedBuildListEntryIds.length,
      selectedEqualsExpected: hashStableValue(planner.selectedBuildListEntryIds) === hashStableValue(planner.expectedSelectedBuildListEntryIds),
      conflictCount: planner.conflicts.length, conflictKinds: countBy(planner.conflicts.map(conflict => conflict.kind)),
      rejectedCount: planner.rejected.length, rejectedReasons: countBy(planner.rejected.map(entry => entry.reason)), resourceConflictCount: planner.rejected.filter(entry => entry.reason === 'resource_conflict').length,
      warningCount: planner.warnings.length, warningKinds: countBy(planner.warnings.map(warning => warning.kind)),
    },
    traceReplay: replay === null ? null : {
      ran: replay.ran, isValid: replay.isValid, issueCodes: countBy(replay.issueCodes), unsupportedInput: replay.unsupportedInput, drafts: { ...replay.drafts },
      correspondence: replay.correspondence === null ? null : {
        planPhysicalSteps: replay.correspondence.planPhysicalSteps, replayPhysicalDrafts: replay.correspondence.replayPhysicalDrafts,
        mismatchCount: replay.correspondence.mismatches, counterPositionMismatchCount: replay.correspondence.counterPositionMismatches,
      },
      finalCountersMatchPlan: replay.finalCountersMatchPlan,
    },
    physical: physical === null ? null : {
      error: physical.error === null ? null : 'physical summary refused the Plan', planSteps: physical.planSteps, physicalOperations: physical.physicalOperations,
      nonPhysicalStepCount: physical.nonPhysicalStepCount, nonPhysicalSteps: { ...physical.nonPhysicalSteps }, unexpectedNonPhysicalSteps: { ...physical.unexpectedNonPhysicalSteps },
      operationCounts: physical.operationCounts === null ? null : { ...physical.operationCounts }, streamAdvanceSum: physical.streamAdvanceSum, identities: { ...physical.identities },
      sharedPhysicalSteps: physical.sharedPhysicalSteps, streamCount: physical.streams.length,
      structuralStreamComparison: { streamCount: physical.streamComparison.length, equalStreamCount: physical.streamComparison.filter(stream => stream.equal).length },
      objective: physical.objective, executedHash: physical.executedHash,
    },
    elapsedMs: Object.fromEntries(Object.entries(elapsed).map(([key, value]) => [key, roundOrNull(value)])),
  }
}

function materializationSummary(record: ChildRecordView) {
  const materialization = record.materialization ?? null
  if (materialization === null || materialization.semantic === undefined) return null
  const outcome = summarizeD0cMaterializationOutcome({ measured: [materialization.semantic], unmeasuredProgress: null })
  const candidate = outcome.candidates[0] ?? null
  const elapsed = materialization.observed?.elapsedMs ?? {}
  return {
    semanticSha256: materialization.semanticSha256 ?? null, protocolVersion: materialization.semantic.protocolVersion, verdict: outcome.verdict, runOutcome: outcome.runOutcome,
    planningTargetCount: outcome.planningTargetCount,
    candidate: candidate === null ? null : {
      ordinal: candidate.ordinal, objective: candidate.objective, targetCount: candidate.targetCount, classification: candidate.classification, materialized: candidate.materialized,
      notAttempted: candidate.notAttempted, materializedBy: { ...candidate.materializedBy }, independentStops: { ...candidate.independentStops },
    },
    wallMs: roundOrNull(materialization.wallMs),
    stagesMs: Object.fromEntries(['context', 'reachTable', 'structuralSearch', 'toFirstStructuralCandidate', 'total'].map(key => [key, roundOrNull(elapsed[key] as number | null | undefined)])),
  }
}

function identitySummary(identity: D0cIdentityComparison | null | undefined) {
  if (identity === null || identity === undefined) return null
  return {
    matched: identity.matched, semanticSha256Matched: identity.semanticSha256.matched, entryFingerprintMatched: identity.entryFingerprint.matched,
    handoffMatchesRecord: identity.entryFingerprint.handoffMatchesRecord, entryFingerprint: identity.entryFingerprint.fromSemanticRecord, candidates: identity.candidates, handoffs: identity.handoffs,
    semanticIntegrityIssues: identity.semanticIntegrityIssues, issueCount: identity.issues.length,
  }
}

function childSummary(child: D1cSourceChild, side: D1cRawSide, expectation: D1cRegisteredExpectation) {
  const record = child.reading.record as ChildRecordView | null
  const formal = record?.formal ?? null
  const memory = record?.memory
  return {
    role: child.role,
    process: {
      outcome: side.process.outcome, exitCode: side.process.exitCode, signal: side.process.signal, timedOut: side.process.timedOut, cancelled: side.process.cancelled, settledBy: side.process.settledBy,
      wallObservedMs: round(side.process.wallObservedMs), wallMs: side.process.wallMs, heapMb: side.process.heapMb, nodeFlags: [...side.process.nodeFlags], recordWritten: side.process.recordWritten,
    },
    recordRead: record !== null, recordReadError: child.reading.readError === null ? null : 'unreadable',
    formal: formal === null ? null : {
      gatePassed: Array.isArray(formal.gate?.issues) && formal.gate!.issues!.length === 0, calculationGatePassed: Array.isArray(formal.calculation?.issues) && formal.calculation!.issues!.length === 0,
      entrySetSourcePassed: formal.entrySetSource === null || formal.entrySetSource === undefined ? null : Array.isArray(formal.entrySetSource.issues) && formal.entrySetSource.issues.length === 0,
      pidMatchesProcess: side.process.pid !== null && formal.pid === side.process.pid, verificationBudget: formal.verificationBudget ?? null, verifiedCandidates: formal.verifiedCandidates ?? null,
      inputsRead: Array.isArray(formal.inputsRead) ? formal.inputsRead.map(String) : [],
    },
    calculationContext: record?.calculationContext ?? null, rngEngineVersion: record?.rngEngineVersion ?? null,
    materialization: record === null ? null : materializationSummary(record),
    identity: identitySummary(record?.identity),
    entrySet: record?.entrySet ? { bytes: record.entrySet.bytes ?? null, sha256: record.entrySet.sha256 ?? null, entryFingerprint: record.entrySet.entryFingerprint ?? null, entryCount: record.entrySet.entryCount ?? null, issueCount: Array.isArray(record.entrySet.issues) ? record.entrySet.issues.length : null } : null,
    phase0PlanningTargetCount: record?.phase0PlanningTargetIds?.length ?? null,
    verification: record === null ? null : verificationSummary(record, expectation),
    timing: record?.observed ? { setupMs: roundOrNull(record.observed.setupMs), wallMs: roundOrNull(record.observed.wallMs), eventLoopYields: record.observed.eventLoopYields ?? null } : null,
    memory: memory ? {
      heapUsedMax: memory.maxima?.heapUsed ?? null, heapTotalMax: memory.maxima?.heapTotal ?? null, rssMax: memory.maxima?.rss ?? null, externalMax: memory.maxima?.external ?? null,
      sampleCount: memory.maxima?.samples ?? null, maxRssKiB: memory.maxRssKiB ?? null, heapSizeLimit: memory.heapSizeLimit ?? null,
      stageHeapUsedMax: (memory.stages ?? []).reduce<number | null>((max, stage) => (max === null || stage.heapUsed > max ? stage.heapUsed : max), null),
    } : null,
    confirmedProgress: record === null && isRecord(side.confirmedProgress) ? {
      started: side.confirmedProgress.started ?? null, finished: side.confirmedProgress.finished ?? null, lastAtMs: roundOrNull(side.confirmedProgress.lastAtMs as number | null),
      stageInProgress: side.confirmedProgress.stageInProgress ?? null, identityMatched: isRecord(side.confirmedProgress.identity) ? side.confirmedProgress.identity.matched ?? null : null,
    } : null,
  }
}

/** The public RESULT, derived from the raw sources only (deterministic: the same sources give the same JSON). */
export function deriveD1cPublicResult(sources: D1cPublicResultSources, expectation: D1cRegisteredExpectation = registeredD1cExpectation()) {
  const observation = rebuildD1cObservation(sources)
  const output = sources.output
  const start = output.start
  const rederived = concludeD1cMeasurement(observation, expectation)
  const identifiers = collectD1cRecordIdentifiers(sources.children)
  const childOf = (runIndex: number, role: D1cRole) => sources.children.find(entry => entry.runIndex === runIndex && entry.role === role)!
  const sides = output.runs.flatMap(run => [{ run, role: 'first' as const, side: run.first }, ...(run.fresh === null ? [] : [{ run, role: 'fresh' as const, side: run.fresh }])])
  const readingsMatch = sides.every(({ run, role, side }) => {
    const reading = childOf(run.runIndex, role).reading
    return (reading.readError === null) === (side.readError === null) && JSON.stringify(reading.recomputed) === JSON.stringify(side.recomputed) && reading.process === side.process.outcome
  })
  const recordShaLinked = sides.every(({ run, role }) => {
    const reading = childOf(run.runIndex, role).reading
    const record = reading.record as ChildRecordView | null
    if (record === null) return true
    return (record.verification === null || record.verification === undefined || record.verification.semanticSha256 === reading.recomputed.verificationSha256)
      && (record.materialization === null || record.materialization === undefined || record.materialization.semanticSha256 === reading.recomputed.materializationSha256)
  })
  const conclusion = output.conclusion
  const verdicts = conclusion.runs.map(run => run.conclusion.verdict)
  const firstRecordOf = (runIndex: number) => childOf(runIndex, 'first').reading.record as ChildRecordView | null
  const verificationShas = sides.map(({ run, role }) => childOf(run.runIndex, role).reading.recomputed.verificationSha256)
  const materializationShas = output.runs.map(run => childOf(run.runIndex, 'first').reading.recomputed.materializationSha256)
  const entryFingerprints = output.runs.flatMap(run => [firstRecordOf(run.runIndex)?.entrySet?.entryFingerprint ?? null, ...(run.fresh === null ? [] : [(childOf(run.runIndex, 'fresh').reading.record as ChildRecordView | null)?.entrySet?.entryFingerprint ?? null])])
  const allEqual = (values: readonly (string | null)[]) => values.length > 0 && values.every(value => value !== null) && new Set(values).size === 1
  const reference = output.runs.length === 0 ? null : (firstRecordOf(1) ?? null)
  const referenceVerification = reference === null ? null : verificationSummary(reference, expectation)
  const audit = readD1cCalculationCodeAudit(start.calculationAudit, expectation.registrationHead)
  const authorities = readD1cAuthorities(start.currentAuthorities, expectation)
  const registration = PLANNER_VERIFICATION_D1C_PREREGISTRATION
  return {
    resultKind: D1C_PUBLIC_RESULT_KIND,
    derivation: {
      revision: D1C_PUBLIC_RESULT_REVISION, script: D1C_PUBLIC_RESULT_DERIVATION_SCRIPT,
      function: 'deriveD1cPublicResult() (src/benchmarks/globalAssignment/verificationFormalResult.ts)',
      sources: [...sources.files].sort((left, right) => left.file.localeCompare(right.file)).map(file => ({ ...file })),
      consistency: {
        startRecordMatchesRaw: observation.startRecordMatches && output.startRecordMatches === observation.startRecordMatches,
        readingsMatchRaw: readingsMatch,
        semanticSha256MatchesRecords: recordShaLinked,
        conclusionMatchesRecords: JSON.stringify(rederived) === JSON.stringify(conclusion),
      },
      withheld: [
        'Target / OwnedWeapon / BuildListEntry / Candidate / Conflict identifiers and per-Target hashes', 'Entry bodies, Candidate snapshots and Routes', 'Plan Steps, Counter positions and stream ends',
        'the materialization order and per-Target outcomes', 'the Export itself, absolute paths, process ids and stderr',
      ],
      note: 'A mechanical aggregate of the formal raw outputs kept git-ignored in .local; no new measurement, no RNG prediction, no Search, no Planner. The conclusion is re-derived from the raw records and must equal the runner\'s.',
    },
    phase: start.phase, formalProtocolVersion: output.formalProtocolVersion, mode: start.mode, status: output.status, nature: start.nature,
    formalValidity: redactDeep(conclusion.formalValidity, identifiers),
    candidateOutcome: {
      kind: conclusion.candidateOutcome.kind, consistentAcrossRuns: conclusion.candidateOutcome.consistentAcrossRuns, runVerdictKinds: [...conclusion.candidateOutcome.runVerdictKinds],
      requiredRuns: conclusion.candidateOutcome.requiredRuns, concludedRuns: conclusion.candidateOutcome.concludedRuns, verdict: verdictSummary(conclusion.candidateOutcome.verdict),
    },
    acceptance: { status: conclusion.acceptance.status, formalValidity: conclusion.acceptance.formalValidity, candidateOutcome: conclusion.acceptance.candidateOutcome, reasonTexts: [...conclusion.acceptance.reasons] },
    registration: {
      registeredIn: start.registration.registeredIn, formalRun: { enabled: start.registration.formalRunEnabled, enabledBy: start.registration.enabledBy },
      fingerprint: { ...start.registration.fingerprint, issues: [...start.registration.fingerprint.issues] }, registrationIssues: [...start.registration.registrationIssues],
      registeredItemKeys: [...d1cRegisteredItemKeys()], registrationHead: start.registrationHead, registeredConditions: structuredClone(start.conditions),
      verificationProtocolVersion: start.verificationProtocolVersion, materializationProtocolVersion: start.materializationProtocolVersion, formalProtocolVersion: D1C_FORMAL_PROTOCOL_VERSION,
      formalValidityRules: { provenance: [...registration.formalValidity.value.provenance], reproducibility: [...registration.formalValidity.value.reproducibility] },
      allowedChangedFileCount: registration.calculationCodeAudit.value.allowedChangedFiles.length,
    },
    provenance: {
      measurementHeadSha: start.measurementHeadSha, registrationHead: start.registrationHead, benchmarkCodeSha256: start.benchmarkCodeSha256,
      workingTreeClean: start.workingTreeClean, uncommittedBenchmarkCode: start.uncommittedBenchmarkCode, flags: [...start.flags],
      calculationAudit: { changedFiles: audit.changedFiles, allowedChanged: audit.allowedChanged, outsideAllowed: audit.outsideAllowed, productionChanged: audit.productionChanged, registrationHeadIsAncestor: audit.registrationHeadIsAncestor, answered: audit.error === null, passed: audit.passed, productionUnchanged: audit.productionUnchanged },
      documents: start.documents.map(document => ({ source: document.source, sha256: document.sha256, readable: document.error === null })),
      startGate: { passed: start.startGate.passed, rules: { ...start.startGate.rules }, prerequisites: { ...start.startGate.prerequisites }, issues: [...start.startGate.issues] },
      inputsRead: [...start.inputsRead], oracleFreeExecution: start.oracleFreeExecution, oracleInformedDesign: start.oracleInformedDesign,
      runnerScript: start.runnerScript, node: start.node, v8: start.v8, launchedAt: start.launchedAt, machine: structuredClone(start.machine),
      plannerInputMaxPlanStepsForValidationOnly: start.plannerInputMaxPlanStepsForValidationOnly,
    },
    exportVerification: {
      actual: { ...start.actualExport }, registered: start.registeredExport.identity === null ? null : { ...start.registeredExport.identity }, registeredSource: start.registeredExport.source,
      matched: start.startGate.rules.export_identity_matched,
    },
    calculationContext: structuredClone(start.currentAuthorities.calculationContext), rngEngineVersion: start.currentAuthorities.rngEngineVersion,
    authorities: { calculationContextMatched: authorities.calculationContextMatched, rngEngineVersionMatched: authorities.rngEngineVersionMatched, masterDataVersionMatched: authorities.masterDataVersionMatched },
    runs: output.runs.map((run, index) => ({
      runIndex: run.runIndex,
      checkoutUnchanged: JSON.stringify(run.checkoutBefore) === JSON.stringify(run.checkoutAfter),
      first: childSummary(childOf(run.runIndex, 'first'), run.first, expectation),
      fresh: run.fresh === null ? null : childSummary(childOf(run.runIndex, 'fresh'), run.fresh, expectation),
      conclusion: {
        verdict: verdictSummary(verdicts[index] ?? null), recordClassification: conclusion.runs[index]?.conclusion.recordClassification ?? null,
        crossProcess: conclusion.runs[index] ? { compared: conclusion.runs[index]!.conclusion.crossProcess.compared, identical: conclusion.runs[index]!.conclusion.crossProcess.identical, differingFieldCount: conclusion.runs[index]!.conclusion.crossProcess.differingFields.length } : null,
        integrityIssueCount: conclusion.runs[index]?.integrityIssues.length ?? null, exitCode: conclusion.runs[index]?.conclusion.exitCode ?? null,
      },
    })),
    determinism: {
      materializationSemanticSha256s: materializationShas, materializationIdentical: allEqual(materializationShas),
      verificationSemanticSha256s: verificationShas, verificationIdentical: allEqual(verificationShas),
      entryFingerprints, entryFingerprintIdentical: allEqual(entryFingerprints),
      registeredD0c: start.registeredD0c.identity === null ? null : { ...start.registeredD0c.identity },
    },
    plannerIntegration: referenceVerification === null ? null : {
      reference: 'run 1 first process (determinism.verificationIdentical says whether all four processes recorded the same verification)',
      planningTargetCount: referenceVerification.candidate.planningTargetCount, materializedEntryCount: referenceVerification.candidate.materializedEntryCount,
      termination: referenceVerification.planner?.termination ?? null, selectedEntryCount: referenceVerification.planner?.selectedEntryCount ?? null,
      conflictCount: referenceVerification.planner?.conflictCount ?? null, rejectedCount: referenceVerification.planner?.rejectedCount ?? null,
      resourceConflictCount: referenceVerification.planner?.resourceConflictCount ?? null, warningCount: referenceVerification.planner?.warningCount ?? null,
      traceReplayValid: referenceVerification.checks.traceReplayValid, planSteps: referenceVerification.physical?.planSteps ?? null,
      physicalOperations: referenceVerification.physical?.physicalOperations ?? null, nonPhysicalStepCount: referenceVerification.physical?.nonPhysicalStepCount ?? null,
      streamAdvanceSum: referenceVerification.physical?.streamAdvanceSum ?? null, objective: referenceVerification.physical?.objective ?? null,
      identities: referenceVerification.physical?.identities ?? null,
      fullPlannerRuns: sides.map(({ run, role }) => (childOf(run.runIndex, role).reading.record as ChildRecordView | null)?.verification?.semantic.planner?.fullPlannerRuns ?? null),
    },
    postHoc: structuredClone(conclusion.postHoc),
    integrityIssues: {
      resultCount: conclusion.resultIntegrityIssues.length, runCounts: conclusion.runs.map(run => run.integrityIssues.length),
      messages: conclusion.resultIntegrityIssues.map(message => redact(message, identifiers)),
    },
    processes: output.runs.flatMap(run => [run.first, ...(run.fresh === null ? [] : [run.fresh])]).map(side => ({
      id: side.process.id, role: side.process.role, runIndex: side.process.runIndex, outcome: side.process.outcome, exitCode: side.process.exitCode, signal: side.process.signal,
      timedOut: side.process.timedOut, cancelled: side.process.cancelled, wallObservedMs: round(side.process.wallObservedMs), wallMs: side.process.wallMs, heapMb: side.process.heapMb,
    })),
    cancelled: output.cancelled,
    exitCode: conclusion.exitCode,
    totalWallMs: round(output.totalWallMs),
    claims: output.claims,
    unconfirmed: [
      'structural candidates after the first one (verification budget 1: not_attempted, never absent) and whether one has fewer physical operations',
      'windows other than W0, other option sets, rules or Exports',
      'determinism on another machine or Node version',
      'non-physical Steps and a Production runtime-unsupported retry on the real Export unless counted above (synthetic only)',
      'proven_minimum: the runner and this derivation compare no root lower bound (post hoc only, in the D-1C record)',
      'the envelope range above the observed time and memory',
    ],
  }
}

export type D1cPublicResult = ReturnType<typeof deriveD1cPublicResult>

/** Keys whose values would be Target-level or Plan-level data; none may appear anywhere in the public RESULT. */
export const D1C_PUBLIC_RESULT_FORBIDDEN_KEYS = Object.freeze([
  'targetWeaponId', 'targetWeaponIds', 'ownedWeaponId', 'sourceOwnedWeaponId', 'buildListEntryId', 'buildListEntryIds', 'entryId', 'entry', 'materializedEntries', 'candidateSnapshot',
  'materializationOrder', 'targets', 'replacements', 'phase0PlanningTargetIds', 'finalPlanningTargetIds', 'keptOriginalEntryIds', 'selectedBuildListEntryIds',
  'expectedSelectedBuildListEntryIds', 'conflicts', 'rejected', 'warnings', 'steps', 'streams', 'streamComparison', 'finalCounters', 'firstMismatches', 'streamEnd', 'origins',
  'semantic', 'operations', 'route', 'stderrTail', 'runDir', 'pid', 'parentPid', 'reasons', 'excluded', 'planningTargetIds', 'stages', 'executed',
] as const)

/** The only arrays the public RESULT may hold: run / process / source / rule / issue lists and other run-level aggregates, never a per-Target list. */
export const D1C_PUBLIC_RESULT_AGGREGATE_ARRAYS = Object.freeze([
  'sources', 'withheld', 'runs', 'processes', 'materializationSemanticSha256s', 'verificationSemanticSha256s', 'entryFingerprints', 'messages', 'unconfirmed', 'issues',
  'changedFiles', 'allowedChanged', 'outsideAllowed', 'productionChanged', 'registeredItemKeys', 'provenance', 'reproducibility', 'reachedLimits', 'flags', 'inputsRead',
  'runVerdictKinds', 'reasonCodes', 'reasonTexts', 'documents', 'registrationIssues', 'nodeFlags', 'fullPlannerRuns', 'runCounts',
] as const)

/** Why a public RESULT would leak data it must not carry (`[]` = minimized). */
export function d1cPublicResultMinimizationIssues(result: unknown, identifiers: readonly string[]): string[] {
  const issues: string[] = []
  const text = JSON.stringify(result)
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) issues.push('The public RESULT contains a UUID.')
  if (/(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\|\/)|\/Users\/|\/home\//.test(text)) issues.push('The public RESULT contains a local absolute path.')
  for (const identifier of identifiers) if (text.includes(identifier)) issues.push(`The public RESULT contains a record identifier (${identifier.length} characters).`)
  const forbidden = new Set<string>(D1C_PUBLIC_RESULT_FORBIDDEN_KEYS)
  const aggregateArrays = new Set<string>(D1C_PUBLIC_RESULT_AGGREGATE_ARRAYS)
  const walk = (value: unknown, path: string, key: string | null) => {
    if (Array.isArray(value)) {
      if (key === null || !aggregateArrays.has(key)) issues.push(`${path} is not a known aggregate array.`)
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

/**
 * Why a public RESULT is not the mechanical aggregate of the given raw sources (`[]` = it is): it must equal the re-derivation, the start
 * record and the readings must be the raw ones, the recorded semantic SHA-256s must be the records' hashes, the re-derived conclusion
 * must be the runner's, and the minimization checks must pass.
 */
export function d1cPublicResultIssues(published: unknown, sources: D1cPublicResultSources, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): string[] {
  const issues: string[] = []
  const derived = deriveD1cPublicResult(sources, expectation)
  if (JSON.stringify(published) !== JSON.stringify(derived)) {
    const publishedRecord = (isRecord(published) ? published : {}) as Record<string, unknown>
    const differing = Object.keys(derived).filter(key => JSON.stringify(publishedRecord[key]) !== JSON.stringify((derived as Record<string, unknown>)[key]))
    issues.push(`The public RESULT is not the re-derivation of the raw sources (differing: ${differing.join(', ') || 'key order or extra keys'}).`)
  }
  const consistency = derived.derivation.consistency
  if (!consistency.startRecordMatchesRaw) issues.push('The start record in the run directory is not the start provenance of the raw RESULT.')
  if (!consistency.readingsMatchRaw) issues.push('A child record read from the run directory is not the one the runner read.')
  if (!consistency.semanticSha256MatchesRecords) issues.push('A recorded semantic SHA-256 is not the hash of its record.')
  if (!consistency.conclusionMatchesRecords) issues.push('The conclusion re-derived from the raw records is not the runner\'s.')
  issues.push(...d1cPublicResultMinimizationIssues(published, collectD1cRecordIdentifiers(sources.children)))
  return issues
}
