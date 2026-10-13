/**
 * Issue #154 Global Assignment Phase D-1A (Research only; never imported by the app).
 *
 * The protocol around Phase D' (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md`, `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.5 /
 * 9.6 / 10.4 / 13.2): the D-1A **non-formal** conditions (nothing here is registered; D-1B registers the formal values), the check
 * that a re-run materialization is the D-0C one (semantic SHA-256 and Entry fingerprint, compared only after the recomputation
 * settled), the Entry set handed to the fresh process, its journal reading, the integrity of the run's records and provenance, and the
 * one conclusion of a D-1A run from its first process (materialization + Phase D') and its fresh process (a fresh ordinary Planner over
 * the same Entries): verdict, classification, post hoc reading and exit code, derived together so they never disagree.
 *
 * `verified` here is the design status of one structural candidate under these non-formal conditions, recorded as
 * `nonformal_planner_verified`: it carries the evidence a `VerifiedPlanRecord` (design 4.3) holds - the Entries, the physical
 * operations, the Planner summary of both processes - but it is not a formal `VerifiedPlanRecord`, not `bestVerified`, and
 * never `proven_minimum` (no root lower bound is compared here). Reads no file, clock, random value or oracle.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import type { ExportIdentity } from './assignmentProtocol'
import { parseProgressJournal, type ConfirmedProgress } from './materializationProtocol'
import type { MaterializationSemanticRecord, MaterializedEntriesHandoff } from './materializationRunner'
import {
  materializedEntriesFingerprint, PLANNER_VERIFICATION_PROTOCOL_VERSION,
  type ObjectiveMismatchReason, type PlannerRejectionReason, type PlannerVerificationSemantic, type PlanningTargetSetChangeReason,
} from './verify'

export const D1A_PHASE = "Issue #154 Global Assignment Phase D-1A: Phase D' (Production Planner, independent Trace Replay, fresh ordinary Planner) over the materialized first structural candidate; non-formal, not a registered measurement"
export const D1A_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md'
/** PR #252 merged: the main D-1A started from. */
export const D1A_BASE_MAIN = '65c1d5c6291ef1267641d4de40faf709b63497cd'
export const D1A_PROTOCOL_VERSION = PLANNER_VERIFICATION_PROTOCOL_VERSION

/** One D-1A condition: a provisional value with its basis. Never registered, never oracle-informed. */
export interface NonformalCondition<T> {
  value: T
  basis: string
  registered: false
  oracleInformed: false
}

/**
 * The D-1A non-formal conditions. The materialization conditions are the D-0C ones (`registeredD0cConditions()`), so the re-run is
 * the measured materialization; the Planner condition and the process envelope are D-1A's own provisional values.
 */
export const D1A_NONFORMAL_CONDITIONS = Object.freeze({
  researchMaxPlanSteps: {
    value: 20_000,
    basis: "Design 10.4 / G12: the Research maxPlanSteps of Phase D' (Production default 1000 is not used). D-1A non-formal; D-1B registers the formal value.",
    registered: false, oracleInformed: false,
  } satisfies NonformalCondition<number>,
  materialization: {
    value: 'registeredD0cConditions()',
    basis: 'The D-0B-2 registration (MATERIALIZATION_D0C_PREREGISTRATION) that D-0C measured formally, used unchanged so the re-run reproduces the D-0C materialization; the formal D-0C mode is not used.',
    registered: false, oracleInformed: false,
  } satisfies NonformalCondition<string>,
  firstChildWallMs: {
    value: 1_800_000,
    basis: "Provisional: D-0C materialization child 34 s wall; P0R fresh ordinary Planner over an 8,534-step Plan 28.6 s (Node). Not a Phase D' envelope; D-1B registers one from the D-1A measurements.",
    registered: false, oracleInformed: false,
  } satisfies NonformalCondition<number>,
  freshChildWallMs: {
    value: 1_800_000,
    basis: "Provisional, as firstChildWallMs (the fresh process runs Phase D' only).",
    registered: false, oracleInformed: false,
  } satisfies NonformalCondition<number>,
  childHeapMb: {
    value: 8_192,
    basis: "Provisional: D-0C heapUsed <= 0.96 GB under 4,096 MB; P0R fresh Planner maxRSS 2.98 GiB. Twice the D-0C heap so Phase D' is not measured at the materialization's limit.",
    registered: false, oracleInformed: false,
  } satisfies NonformalCondition<number>,
  concurrency: { value: 1, basis: 'One child at a time (design 12).', registered: false, oracleInformed: false } satisfies NonformalCondition<number>,
  retry: { value: 'none', basis: 'No automatic retry: a timeout, an OOM, a cancellation or a process failure is unmeasured (G6 / G7).', registered: false, oracleInformed: false } satisfies NonformalCondition<string>,
})

/** The incumbent of design 13.2 (Phase 1-E / 2-A / P0R automatic construction): read post hoc, and only for a `verified` outcome. */
export const D1A_INCUMBENT_PHYSICAL_OPERATIONS = 8_534

/** Validates an envelope override of a non-formal smoke (positive integers, the D-0B bounds). */
export function d1aEnvelopeIssues(envelope: { firstChildWallMs: number; freshChildWallMs: number; childHeapMb: number }): string[] {
  const issues: string[] = []
  for (const key of ['firstChildWallMs', 'freshChildWallMs'] as const) {
    if (!Number.isSafeInteger(envelope[key]) || envelope[key] < 1_000 || envelope[key] > 86_400_000) issues.push(`${key} must be an integer in 1000..86400000 (got ${String(envelope[key])}).`)
  }
  if (!Number.isSafeInteger(envelope.childHeapMb) || envelope.childHeapMb < 256 || envelope.childHeapMb > 65_536) issues.push(`childHeapMb must be an integer in 256..65536 (got ${String(envelope.childHeapMb)}).`)
  return issues
}

// ---------------------------------------------------------------------------------------------------------------------
// The D-0C identity of the re-run materialization
// ---------------------------------------------------------------------------------------------------------------------

/** The D-0C values the re-run must reproduce (the D-0C record: semantic SHA-256 and `materializedEntries.fingerprint`). */
export interface D0cIdentityExpectation {
  semanticSha256: string
  entryFingerprint: string
}

export interface D0cIdentityComparison {
  matched: boolean
  issues: string[]
  semanticSha256: { recomputed: string; expected: string; matched: boolean }
  entryFingerprint: { fromSemanticRecord: string | null; fromHandoff: string | null; expected: string; matched: boolean; handoffMatchesRecord: boolean }
  candidates: number
  handoffs: number
  semanticIntegrityIssues: number
}

/** The D-0C public RESULT's `materializedEntries.fingerprint`, from a semantic record (null without a materialized Target). */
export function materializedEntriesFingerprintOfSemantic(semantic: MaterializationSemanticRecord): string | null {
  const rows = semantic.candidates.flatMap(candidate => candidate.targets.flatMap(target =>
    target.outcome.kind === 'materialized' ? [{ orderIndex: target.orderIndex, entryId: target.outcome.entryId, entrySemanticHash: target.outcome.entrySemanticHash }] : []))
  return rows.length === 0 ? null : hashStableValue(rows)
}

/** The same fingerprint from the Entry bodies the run handed over (every handoff in candidate order). */
export function materializedEntriesFingerprintOfHandoffs(handoffs: readonly MaterializedEntriesHandoff[]): string | null {
  const entries = handoffs.flatMap(handoff => handoff.materializedEntries)
  return entries.length === 0 ? null : materializedEntriesFingerprint(entries)
}

/**
 * Whether a re-run materialization is the D-0C one. Called after the run settled (the recomputed values are final): the semantic
 * SHA-256 of the whole semantic record, the Entry fingerprint of the record and of the handed-over Entry bodies (they must agree with
 * each other and with D-0C), one handoff per recorded candidate, and no integrity issue. A mismatch stops the run before Phase D'.
 */
export function compareD0cMaterializationIdentity(input: { semantic: MaterializationSemanticRecord; semanticSha256: string; handoffs: readonly MaterializedEntriesHandoff[]; expected: D0cIdentityExpectation }): D0cIdentityComparison {
  const { semantic, semanticSha256, handoffs, expected } = input
  const fromSemanticRecord = materializedEntriesFingerprintOfSemantic(semantic)
  const fromHandoff = materializedEntriesFingerprintOfHandoffs(handoffs)
  const semanticMatched = semanticSha256 === expected.semanticSha256
  const fingerprintMatched = fromSemanticRecord === expected.entryFingerprint
  const handoffMatchesRecord = fromHandoff !== null && fromHandoff === fromSemanticRecord
  const issues: string[] = []
  if (!semanticMatched) issues.push(`The re-run semantic SHA-256 ${semanticSha256} is not the D-0C ${expected.semanticSha256}.`)
  if (!fingerprintMatched) issues.push(`The re-run Entry fingerprint ${String(fromSemanticRecord)} is not the D-0C ${expected.entryFingerprint}.`)
  if (!handoffMatchesRecord) issues.push(`The handed-over Entry bodies (${String(fromHandoff)}) are not the Entries the semantic record identifies (${String(fromSemanticRecord)}).`)
  if (handoffs.length !== semantic.candidates.length) issues.push(`${handoffs.length} handoffs for ${semantic.candidates.length} materialized candidates.`)
  if (semantic.integrityIssues.length > 0) issues.push(`The semantic record carries ${semantic.integrityIssues.length} integrity issues.`)
  return {
    matched: issues.length === 0, issues,
    semanticSha256: { recomputed: semanticSha256, expected: expected.semanticSha256, matched: semanticMatched },
    entryFingerprint: { fromSemanticRecord, fromHandoff, expected: expected.entryFingerprint, matched: fingerprintMatched, handoffMatchesRecord },
    candidates: semantic.candidates.length, handoffs: handoffs.length, semanticIntegrityIssues: semantic.integrityIssues.length,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The Entry set handed to the fresh process
// ---------------------------------------------------------------------------------------------------------------------

export const D1A_ENTRY_SET_KIND = 'global-assignment-d1a-entry-set'

/**
 * Research data for the fresh process only (a git-ignored file of the run directory): never an Import, never written to the app's
 * persistence, never a user-fixed Route (design 16). It names where it came from so the fresh process can refuse another source.
 */
export interface D1aEntrySet {
  kind: typeof D1A_ENTRY_SET_KIND
  protocolVersion: string
  nature: 'research_data: the generated Entries of one structural candidate for the fresh-process Planner check; never imported, never persisted'
  repositoryHeadSha: string
  export: ExportIdentity
  calculationContext: PlannerInput['calculationContext']
  rngEngineVersion: string
  candidate: Omit<MaterializedEntriesHandoff, 'materializedEntries'>
  materializedEntries: MaterializedEntriesHandoff['materializedEntries']
  entryFingerprint: string
}

export function createD1aEntrySet(handoff: MaterializedEntriesHandoff, provenance: { repositoryHeadSha: string; export: ExportIdentity; calculationContext: PlannerInput['calculationContext']; rngEngineVersion: string }): D1aEntrySet {
  const { materializedEntries, ...candidate } = structuredClone(handoff)
  return {
    kind: D1A_ENTRY_SET_KIND, protocolVersion: D1A_PROTOCOL_VERSION,
    nature: 'research_data: the generated Entries of one structural candidate for the fresh-process Planner check; never imported, never persisted',
    repositoryHeadSha: provenance.repositoryHeadSha, export: { ...provenance.export }, calculationContext: structuredClone(provenance.calculationContext),
    rngEngineVersion: provenance.rngEngineVersion, candidate, materializedEntries, entryFingerprint: materializedEntriesFingerprint(materializedEntries),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Why the fresh process must refuse an Entry set before it plans anything: another kind or protocol, another HEAD, Export,
 * CalculationContext or Engine than its own observations, or Entries whose recomputed fingerprint is not the recorded one (or not the
 * one the parent expects). `[]` = it may plan.
 */
export function d1aEntrySetIssues(value: unknown, expected: { repositoryHeadSha: string; export: ExportIdentity; calculationContext: PlannerInput['calculationContext']; rngEngineVersion: string; entryFingerprint: string }): string[] {
  if (!isRecord(value)) return ['The Entry set is not an object.']
  const issues: string[] = []
  if (value.kind !== D1A_ENTRY_SET_KIND) issues.push(`The Entry set kind ${String(value.kind)} is not ${D1A_ENTRY_SET_KIND}.`)
  if (value.protocolVersion !== D1A_PROTOCOL_VERSION) issues.push(`The Entry set protocol ${String(value.protocolVersion)} is not ${D1A_PROTOCOL_VERSION}.`)
  if (value.repositoryHeadSha !== expected.repositoryHeadSha) issues.push(`The Entry set was written at HEAD ${String(value.repositoryHeadSha)}, not ${expected.repositoryHeadSha}.`)
  if (JSON.stringify(value.export) !== JSON.stringify(expected.export)) issues.push('The Entry set names another Export.')
  if (hashStableValue(value.calculationContext) !== hashStableValue(expected.calculationContext)) issues.push('The Entry set carries another CalculationContext.')
  if (value.rngEngineVersion !== expected.rngEngineVersion) issues.push(`The Entry set was materialized with Engine ${String(value.rngEngineVersion)}, not ${expected.rngEngineVersion}.`)
  const entries = Array.isArray(value.materializedEntries) ? value.materializedEntries : null
  const candidate = isRecord(value.candidate) ? value.candidate : null
  if (entries === null || candidate === null) return [...issues, 'The Entry set has no candidate or no Entries.']
  const wellFormed = entries.every(row => isRecord(row) && typeof row.orderIndex === 'number' && typeof row.targetWeaponId === 'string' && isRecord(row.entry) && typeof row.entry.id === 'string')
  if (!wellFormed) return [...issues, 'An Entry row is malformed.']
  const recomputed = materializedEntriesFingerprint(entries as MaterializedEntriesHandoff['materializedEntries'])
  if (recomputed !== value.entryFingerprint) issues.push(`The Entries hash to ${recomputed}, not the recorded ${String(value.entryFingerprint)}.`)
  if (recomputed !== expected.entryFingerprint) issues.push(`The Entries hash to ${recomputed}, not the expected ${expected.entryFingerprint}.`)
  if (!Array.isArray(candidate.planningTargetIds) || !isRecord(candidate.stage) || typeof candidate.objective !== 'number') issues.push('The Entry set candidate is malformed.')
  return issues
}

/**
 * The fresh process's handoff: the Entry set's candidate and Entries, with the planning Target IDs of the fresh process's own Phase 0
 * (the denominator is re-derived, never copied; `judgeD1aRun()` compares it with the first process's).
 */
export function handoffFromEntrySet(set: D1aEntrySet, freshPhase0PlanningTargetIds: readonly string[]): MaterializedEntriesHandoff {
  return { ...structuredClone(set.candidate), planningTargetIds: [...freshPhase0PlanningTargetIds] as MaterializedEntriesHandoff['planningTargetIds'], materializedEntries: structuredClone(set.materializedEntries) }
}

// ---------------------------------------------------------------------------------------------------------------------
// The judgement of one D-1A run (design 9.5 condition 13, 9.6)
// ---------------------------------------------------------------------------------------------------------------------

export type D1aProcessOutcome = 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' | 'cancelled'
export type D1aUnmeasuredReason = Exclude<D1aProcessOutcome, 'completed'>

export interface D1aVerificationView {
  semantic: PlannerVerificationSemantic
  /** SHA-256 of `JSON.stringify(semantic)` (the script hashes it; the two processes are compared by it). */
  semanticSha256: string
}

export interface D1aFirstProcessView {
  process: D1aProcessOutcome
  /** Null when the process wrote no complete record. */
  identity: D0cIdentityComparison | null
  /** Null when the run stopped before Phase D' (identity mismatch) or wrote no complete record. */
  verification: D1aVerificationView | null
}

export interface D1aFreshProcessView {
  /** `not_run`: the parent never started it (the first process stopped first, or the run was cancelled). */
  process: D1aProcessOutcome | 'not_run'
  /** The fresh process's own Phase 0 planning Target IDs, sorted. */
  phase0PlanningTargetIds: string[] | null
  verification: D1aVerificationView | null
}

export type D1aRunSide = 'first' | 'fresh'

export type D1aCandidateOutcome =
  /** Every design 9.5 condition held in both processes and they agree: `nonformal_planner_verified`, not a formal VerifiedPlanRecord. */
  | { kind: 'verified'; physicalOperations: number; planSteps: number; objective: number; planningTargetCount: number; fullPlannerRuns: { first: number; fresh: number } }
  | { kind: 'materialization_failed' | 'materialization_unconfirmed' | 'materialization_unsupported'; run: 'first'; targetWeaponId: string; outcomeKind: string; outcomeReason: string | null }
  | { kind: 'planning_target_set_changed'; run: D1aRunSide; reasons: PlanningTargetSetChangeReason[] }
  | { kind: 'planner_rejected'; run: D1aRunSide; reasons: PlannerRejectionReason[] }
  /** Both processes met the in-process conditions but their semantic records differ (condition 13). */
  | { kind: 'planner_rejected'; run: 'cross_process'; reasons: { code: 'fresh_planner_mismatch'; differingFields: string[] }[] }
  | { kind: 'objective_mismatch'; run: D1aRunSide; physicalOperations: number | null; objective: number; reasons: ObjectiveMismatchReason[] }
  | { kind: 'unmeasured'; run: D1aRunSide; reason: D1aUnmeasuredReason }

export type D1aVerdict =
  | D1aCandidateOutcome
  /** The re-run materialization is not the D-0C one: Phase D' never ran (no candidate outcome is claimed). */
  | { kind: 'stopped_d0c_identity_mismatch'; issues: string[] }
  /**
   * D-1A run-level (never a design 4.6 candidate outcome): the parent found the run's records or provenance broken - a child record that
   * cannot be read or disagrees with the parent (role / HEAD / Export), a recorded semantic SHA-256 that is not the hash of its record, a
   * Repository that changed during the run. Nothing the records say is trusted, so no candidate outcome is claimed: never `verified`, and
   * never a Planner failure (`planner_rejected` / `objective_mismatch`) either.
   */
  | { kind: 'invalid_run_integrity'; issues: string[] }

export interface D1aJudgement {
  verdict: D1aVerdict
  /** The record label: `nonformal_planner_verified` for `verified`, `nonformal_<kind>` otherwise. Never a formal status. */
  recordClassification: string
  /** Condition 13 as observed, whatever the verdict (null when one side has no verification). */
  crossProcess: { compared: boolean; identical: boolean | null; differingFields: string[] }
}

function outcomeOf(run: D1aRunSide, semantic: PlannerVerificationSemantic): D1aCandidateOutcome | null {
  const outcome = semantic.outcome
  switch (outcome.kind) {
    case 'conditions_met': return null
    case 'materialization_failed':
    case 'materialization_unconfirmed':
    case 'materialization_unsupported':
      return { kind: outcome.kind, run: 'first', targetWeaponId: outcome.targetWeaponId, outcomeKind: outcome.outcomeKind, outcomeReason: outcome.outcomeReason }
    case 'planning_target_set_changed': return { kind: outcome.kind, run, reasons: structuredClone(outcome.reasons) }
    case 'planner_rejected': return { kind: outcome.kind, run, reasons: structuredClone(outcome.reasons) }
    case 'objective_mismatch': return { kind: outcome.kind, run, physicalOperations: outcome.physicalOperations, objective: outcome.objective, reasons: structuredClone(outcome.reasons) }
    case 'unmeasured': return { kind: 'unmeasured', run, reason: outcome.reason }
  }
}

/** The top-level fields in which two semantic records differ. */
export function differingSemanticFields(left: PlannerVerificationSemantic, right: PlannerVerificationSemantic): string[] {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys.filter(key => hashStableValue((left as unknown as Record<string, unknown>)[key]) !== hashStableValue((right as unknown as Record<string, unknown>)[key]))
}

function classification(verdict: D1aVerdict): string {
  return verdict.kind === 'verified' ? 'nonformal_planner_verified' : `nonformal_${verdict.kind}`
}

/**
 * One D-1A run's verdict (design 9.5 / 9.6). The run's integrity comes first: with any issue the parent found (`integrityIssues`, from
 * `d1aChildIntegrityIssues()` / `d1aCheckoutIntegrityIssues()`) the verdict is `invalid_run_integrity` whatever the records say.
 * Otherwise both processes must complete and meet every in-process condition, the fresh process's Phase 0 must be the first one's, and
 * their semantic records must be identical; one side alone is never `verified`. A process the envelope stopped is `unmeasured`, never
 * a Planner result (G6); a first-side outcome stands whatever the fresh side shows. `integrityIssues` is required: a caller cannot
 * judge a run without saying what it found.
 */
export function judgeD1aRun(first: D1aFirstProcessView, fresh: D1aFreshProcessView, integrityIssues: readonly string[]): D1aJudgement {
  const compared = first.verification !== null && fresh.verification !== null
  const differingFields = compared ? differingSemanticFields(first.verification!.semantic, fresh.verification!.semantic) : []
  const crossProcess = { compared, identical: compared ? first.verification!.semanticSha256 === fresh.verification!.semanticSha256 && differingFields.length === 0 : null, differingFields }
  const judged = (verdict: D1aVerdict): D1aJudgement => ({ verdict, recordClassification: classification(verdict), crossProcess })

  if (integrityIssues.length > 0) return judged({ kind: 'invalid_run_integrity', issues: [...integrityIssues] })
  if (first.process !== 'completed') return judged({ kind: 'unmeasured', run: 'first', reason: first.process })
  if (first.identity === null) return judged({ kind: 'unmeasured', run: 'first', reason: 'process_failure' })
  if (!first.identity.matched) return judged({ kind: 'stopped_d0c_identity_mismatch', issues: [...first.identity.issues] })
  if (first.verification === null) return judged({ kind: 'unmeasured', run: 'first', reason: 'process_failure' })
  const firstOutcome = outcomeOf('first', first.verification.semantic)
  if (firstOutcome !== null) return judged(firstOutcome)

  if (fresh.process === 'not_run') return judged({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled' })
  if (fresh.process !== 'completed') return judged({ kind: 'unmeasured', run: 'fresh', reason: fresh.process })
  if (fresh.verification === null || fresh.phase0PlanningTargetIds === null) return judged({ kind: 'unmeasured', run: 'fresh', reason: 'process_failure' })
  const firstPhase0 = first.verification.semantic.finalInput?.phase0PlanningTargetIds ?? []
  const freshPhase0 = new Set(fresh.phase0PlanningTargetIds)
  const added = fresh.phase0PlanningTargetIds.filter(id => !firstPhase0.includes(id))
  const removed = firstPhase0.filter(id => !freshPhase0.has(id))
  if (added.length > 0 || removed.length > 0) {
    const reasons: PlanningTargetSetChangeReason[] = []
    if (added.length > 0) reasons.push({ code: 'planning_target_added', targetWeaponIds: added })
    if (removed.length > 0) reasons.push({ code: 'planning_target_removed', targetWeaponIds: removed })
    return judged({ kind: 'planning_target_set_changed', run: 'fresh', reasons })
  }
  const freshOutcome = outcomeOf('fresh', fresh.verification.semantic)
  if (freshOutcome !== null) return judged(freshOutcome)
  if (crossProcess.identical !== true) return judged({ kind: 'planner_rejected', run: 'cross_process', reasons: [{ code: 'fresh_planner_mismatch', differingFields }] })

  const physical = first.verification.semantic.physical!
  return judged({
    kind: 'verified', physicalOperations: physical.physicalOperations!, planSteps: physical.planSteps!, objective: physical.objective,
    planningTargetCount: first.verification.semantic.candidate.planningTargetCount,
    fullPlannerRuns: { first: first.verification.semantic.planner!.fullPlannerRuns, fresh: fresh.verification.semantic.planner!.fullPlannerRuns },
  })
}

/**
 * The design 13.2 operation-count reading, post hoc: only a `verified` outcome is compared with the incumbent; anything else is not
 * evaluated (43 / 43 not reached). Never a minimality claim: `proof` stays `not_claimed` (no root lower bound is compared in D-1A).
 */
export function d1aOperationCountReading(verdict: D1aVerdict): { evaluated: boolean; physicalOperations: number | null; incumbent: number; judgement: 'improvement' | 'equal' | 'worse' | 'not_evaluated'; proof: 'not_claimed' } {
  if (verdict.kind !== 'verified') return { evaluated: false, physicalOperations: null, incumbent: D1A_INCUMBENT_PHYSICAL_OPERATIONS, judgement: 'not_evaluated', proof: 'not_claimed' }
  const value = verdict.physicalOperations
  const judgement = value < D1A_INCUMBENT_PHYSICAL_OPERATIONS ? 'improvement' : value === D1A_INCUMBENT_PHYSICAL_OPERATIONS ? 'equal' : 'worse'
  return { evaluated: true, physicalOperations: value, incumbent: D1A_INCUMBENT_PHYSICAL_OPERATIONS, judgement, proof: 'not_claimed' }
}

// ---------------------------------------------------------------------------------------------------------------------
// The run's integrity and its one conclusion (verdict, classification, post hoc reading, exit code)
// ---------------------------------------------------------------------------------------------------------------------

/** The fields of a child record (`scripts/run-planner-global-assignment-d1a.mjs`) the parent reads: untrusted file contents. */
export interface D1aChildRecord {
  role?: unknown
  repositoryHeadSha?: unknown
  exportVerification?: { actual?: unknown } | null
  identity?: D0cIdentityComparison | null
  materialization?: { semanticSha256?: unknown } | null
  verification?: { semantic: PlannerVerificationSemantic; semanticSha256: string } | null
  phase0PlanningTargetIds?: string[] | null
}

/** What the parent observed of one child: the envelope's outcome, the parsed record or why it could not be read, and its own re-hashes. */
export interface D1aChildReading {
  process: D1aProcessOutcome
  record: D1aChildRecord | null
  /** Why a written record could not be read (an integrity issue, never "no record"). */
  readError: string | null
  /** SHA-256 the parent recomputed from `JSON.stringify()` of the record's own semantic records (null where the record has none). */
  recomputed: { materializationSha256: string | null; verificationSha256: string | null }
}

/** The Repository state the parent records before its children and observes again after them. */
export interface D1aCheckoutState {
  repositoryHeadSha: string
  workingTreeClean: boolean
  uncommittedBenchmarkCode: boolean
}

/**
 * The integrity issues of one child's record (`[]` = none): a record that cannot be read, a completed process without one, a role, HEAD
 * or Export other than the run's, a recorded materialization / verification semantic SHA-256 that is not the hash of its own record,
 * and (first process) a Phase D' verification recorded although the D-0C identity did not match. A child the envelope stopped without
 * writing a record has no integrity issue: it is `unmeasured`.
 */
export function d1aChildIntegrityIssues(role: D1aRunSide, reading: D1aChildReading, expected: { repositoryHeadSha: string; actualExport: ExportIdentity }): string[] {
  const issues: string[] = []
  if (reading.readError !== null) issues.push(`${role}: the child record could not be read (${reading.readError}).`)
  const record = reading.record
  if (record === null) {
    if (reading.process === 'completed' && reading.readError === null) issues.push(`${role}: the process completed without a record.`)
    return issues
  }
  if (record.role !== role) issues.push(`${role}: the child record's role ${JSON.stringify(record.role)} is not ${role}.`)
  if (record.repositoryHeadSha !== expected.repositoryHeadSha) issues.push(`${role}: the child record's HEAD ${JSON.stringify(record.repositoryHeadSha)} is not the run's HEAD ${expected.repositoryHeadSha}.`)
  if (JSON.stringify(record.exportVerification?.actual ?? null) !== JSON.stringify(expected.actualExport)) issues.push(`${role}: the child record's Export is not the one the parent hashed.`)
  const materialization = record.materialization ?? null
  if (materialization !== null && materialization.semanticSha256 !== reading.recomputed.materializationSha256) {
    issues.push(`${role}: the recorded materialization semantic SHA-256 ${JSON.stringify(materialization.semanticSha256)} is not the hash of its record (${String(reading.recomputed.materializationSha256)}).`)
  }
  const verification = record.verification ?? null
  if (verification !== null && verification.semanticSha256 !== reading.recomputed.verificationSha256) {
    issues.push(`${role}: the recorded verification semantic SHA-256 ${JSON.stringify(verification.semanticSha256)} is not the hash of its record (${String(reading.recomputed.verificationSha256)}).`)
  }
  if (role === 'first' && verification !== null && record.identity?.matched !== true) issues.push("first: the record carries a Phase D' verification although the D-0C identity did not match.")
  return issues
}

/** The integrity issue of a Repository that changed while the children ran (`[]` = unchanged). */
export function d1aCheckoutIntegrityIssues(before: D1aCheckoutState, after: D1aCheckoutState): string[] {
  const same = before.repositoryHeadSha === after.repositoryHeadSha && before.workingTreeClean === after.workingTreeClean && before.uncommittedBenchmarkCode === after.uncommittedBenchmarkCode
  return same ? [] : [
    `the Git checkout changed during the run (HEAD ${before.repositoryHeadSha} -> ${after.repositoryHeadSha}, clean ${before.workingTreeClean} -> ${after.workingTreeClean}, uncommitted code ${before.uncommittedBenchmarkCode} -> ${after.uncommittedBenchmarkCode}).`,
  ]
}

export interface D1aRunConclusion extends D1aJudgement {
  /** Design 13.2, post hoc: evaluated for `verified` only, so never for a run whose integrity failed. */
  postHoc: { operationCount: ReturnType<typeof d1aOperationCountReading> }
  integrityIssues: string[]
  /** 0 = a measured verdict; 1 = integrity failure or D-0C identity mismatch (the records are kept); 2 = unmeasured. */
  exitCode: 0 | 1 | 2
}

function viewOf(reading: D1aChildReading): { process: D1aProcessOutcome; verification: D1aVerificationView | null } {
  const record = reading.record
  return {
    // A completed process whose record is missing or unreadable produced no measurement (the read error is an integrity issue).
    process: reading.process === 'completed' && record === null ? 'process_failure' : reading.process,
    verification: record?.verification ? { semantic: record.verification.semantic, semanticSha256: record.verification.semanticSha256 } : null,
  }
}

/**
 * The one conclusion of a D-1A run the runner records: the verdict and its classification (`judgeD1aRun()` with the integrity issues),
 * the post hoc reading of that same verdict and the exit code of that same verdict, so the four can never disagree (an integrity issue is
 * `invalid_run_integrity`, `nonformal_invalid_run_integrity`, `not_evaluated` and exit 1 together). `fresh` is null when it never ran.
 */
export function concludeD1aRun(input: { first: D1aChildReading; fresh: D1aChildReading | null; integrityIssues: readonly string[] }): D1aRunConclusion {
  const first = viewOf(input.first)
  const fresh = input.fresh === null ? null : viewOf(input.fresh)
  const judgement = judgeD1aRun(
    { process: first.process, identity: input.first.record?.identity ?? null, verification: first.verification },
    fresh === null ? { process: 'not_run', phase0PlanningTargetIds: null, verification: null } : { process: fresh.process, phase0PlanningTargetIds: input.fresh!.record?.phase0PlanningTargetIds ?? null, verification: fresh.verification },
    input.integrityIssues,
  )
  const kind = judgement.verdict.kind
  const exitCode = kind === 'invalid_run_integrity' || kind === 'stopped_d0c_identity_mismatch' ? 1 : kind === 'unmeasured' ? 2 : 0
  return { ...judgement, postHoc: { operationCount: d1aOperationCountReading(judgement.verdict) }, integrityIssues: [...input.integrityIssues], exitCode }
}

// ---------------------------------------------------------------------------------------------------------------------
// The child journal
// ---------------------------------------------------------------------------------------------------------------------

/** What a D-1A child journal confirms (only settled facts; a stage in progress carries no result). */
export interface D1aConfirmedProgress {
  lines: number
  malformedLines: number
  started: boolean
  finished: boolean
  lastAtMs: number | null
  /** The materialization progress lines, read by the D-0B journal reader. */
  materialization: ConfirmedProgress
  identity: { matched: boolean; atMs: number } | null
  entrySetWritten: { atMs: number } | null
  stages: { stage: string; status: 'started' | 'finished'; atMs: number }[]
  /** A verification stage that started and did not finish before the journal ended. */
  stageInProgress: string | null
}

/** Reads a D-1A child journal. Never throws on a malformed line (a line a kill cut is expected only at the end). */
export function parseD1aJournal(text: string): D1aConfirmedProgress {
  const materializationLines: string[] = []
  const progress: Omit<D1aConfirmedProgress, 'materialization'> = { lines: 0, malformedLines: 0, started: false, finished: false, lastAtMs: null, identity: null, entrySetWritten: null, stages: [], stageInProgress: null }
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    progress.lines += 1
    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      progress.malformedLines += 1
      continue
    }
    if (!isRecord(line) || typeof line.kind !== 'string' || typeof line.atMs !== 'number') { progress.malformedLines += 1; continue }
    progress.lastAtMs = line.atMs
    switch (line.kind) {
      case 'started': progress.started = true; materializationLines.push(raw); break
      case 'finished': progress.finished = true; materializationLines.push(raw); break
      case 'memory': case 'progress': materializationLines.push(raw); break
      case 'identity': progress.identity = { matched: line.matched === true, atMs: line.atMs }; break
      case 'entry_set': progress.entrySetWritten = { atMs: line.atMs }; break
      case 'verification_stage': {
        if ((line.status !== 'started' && line.status !== 'finished') || typeof line.stage !== 'string') { progress.malformedLines += 1; break }
        progress.stages.push({ stage: line.stage, status: line.status, atMs: line.atMs })
        progress.stageInProgress = line.status === 'started' ? line.stage : null
        break
      }
      default: progress.malformedLines += 1
    }
  }
  return { ...progress, materialization: parseProgressJournal(materializationLines.join('\n')) }
}
