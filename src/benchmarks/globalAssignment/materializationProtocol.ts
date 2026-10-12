/**
 * Issue #154 Global Assignment Phase D-0B (Research only; never imported by the app).
 *
 * The Research protocol of the D-0B materialization runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md`,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.8 / 9.9 / 10.3 / 10.4 / 14 / 19.7): the conditions one run takes,
 * their validation, the non-formal smoke defaults with the basis of each value, the refusal of a formal run, the
 * classification of one candidate's materialization stage, and the progress journal a child writes so that a run
 * stopped by its envelope still leaves its confirmed progress. Everything is plain data; nothing here reads a file,
 * a clock or the Export.
 *
 * D-0B registers no formal condition (design 19.7, audit 9.1): the delivery cap, the Search scale gate and the
 * envelope depend on the materialization method (案B) and the option set (A-2), so they are pre-registered in
 * D-0B-2 and measured formally in D-0C. Every value here is a provisional non-formal smoke condition. A D-0B run
 * is never a Planner verification: no status here says `verified`, `best_found`, `proven_minimum` or "every
 * Target completed".
 */
import { validateWindowLadder } from './assignmentProtocol'
import { isValidSearchScaleGate } from './materializationScale'
import type { MaterializationStageOutcome, SearchScaleGate } from './materializationTypes'
import { reachWindowW0 } from './reachTable'
import type { ReachWindow } from './types'

export const MATERIALIZATION_D0B_PROTOCOL_VERSION = 'global-assignment-d0b:1'
export const MATERIALIZATION_D0B_PHASE = 'Issue #154 Global Assignment Phase D-0B: materialization runner, non-formal smoke and diagnostics (D-0A materialization of Phase C structural candidates; not a Production Plan, not Planner-verified)'
/** The Research record of this Phase (Markdown; its SHA-256 is recorded by the runner). */
export const MATERIALIZATION_D0B_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md'
/** The main this Phase started from (PR #245 merged). */
export const MATERIALIZATION_D0B_BASE_MAIN = '531c447314de68c5e93adb7e28b0da1910f98af9'
/** A runner guard of the non-formal smoke (not a registered value): D-0B never materializes many structural candidates. */
export const MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES = 10
/** A runner guard on the determinism repeat of one smoke (two children at most). */
export const MATERIALIZATION_SMOKE_MAX_REPEAT = 2

/**
 * The calculation conditions of one D-0B run (design 10.4: each a different budget). Reaching the node budget
 * is `search_incomplete`, the structural candidate limit a stop after that many candidates, the delivery cap
 * `unconfirmed(delivery_cap_reached)`, the gate `not_executed(search_scale_gate)`; none of them is exhaustion.
 */
export interface MaterializationResearchConditions {
  /** The ReachTable window (Phase A). */
  window: ReachWindow
  /** Expanded node limit of the coverage-gated structural search (Phase C-2). */
  nodeBudget: number
  /** MRV lookahead of that search. */
  mrvLookahead: number
  /** Design 6.3 coverage-driven value ordering: an explicit choice, never defaulted inside the search. */
  coverageDrivenOrdering: boolean
  /** How many structural candidates are collected and materialized, one after another (1 in the smoke). */
  structuralCandidateLimit: number
  /** Design 10.4 delivery cap of one Planner Alternative materialization (passed to D-0A explicitly). */
  deliveryCap: number
  /** Design 9.7 Search scale gate (passed to D-0A explicitly; no implicit unlimited value). */
  searchScaleGate: SearchScaleGate
  /** Design 19.3 G1: Search-policy shapes are classified before any Search. Always true in D-0B. */
  searchPolicyPrecheck: true
}

/** The process envelope of one child (the parent applies it; reaching it is unmeasured, never a materialization outcome). */
export interface MaterializationEnvelope {
  childWallMs: number
  childHeapMb: number
  /** Children run one after another with the same task (the determinism check of the semantic record). */
  repeat: number
}

function isIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

/** Issues of a conditions object; `[]` means valid. */
export function validateMaterializationResearchConditions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['conditions must be an object.']
  const conditions = value as Record<string, unknown>
  const issues: string[] = []
  const window = conditions.window as Record<string, unknown> | undefined
  if (typeof window !== 'object' || window === null) issues.push('window must be an object with normal / gogma / skill.')
  else issues.push(...validateWindowLadder([window]).map(issue => issue.replace('windowLadder[0]', 'window')))
  for (const field of ['nodeBudget', 'mrvLookahead', 'deliveryCap'] as const) {
    if (!isIntegerIn(conditions[field], 1, Number.MAX_SAFE_INTEGER)) issues.push(`${field} must be a positive integer (got ${String(conditions[field])}).`)
  }
  if (typeof conditions.coverageDrivenOrdering !== 'boolean') issues.push(`coverageDrivenOrdering must be an explicit boolean (got ${String(conditions.coverageDrivenOrdering)}).`)
  if (!isIntegerIn(conditions.structuralCandidateLimit, 1, MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES)) {
    issues.push(`structuralCandidateLimit must be an integer in 1..${MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES} (got ${String(conditions.structuralCandidateLimit)}).`)
  }
  if (!isValidSearchScaleGate(conditions.searchScaleGate as SearchScaleGate)) {
    issues.push(`searchScaleGate must name maxConversionPositions / maxGogmaLegalWidth / maxSkillLegalWidth / maxNormalForgeCount as non-negative integers (got ${JSON.stringify(conditions.searchScaleGate)}).`)
  }
  if (conditions.searchPolicyPrecheck !== true) issues.push(`searchPolicyPrecheck must be true in Phase D-0B (got ${String(conditions.searchPolicyPrecheck)}).`)
  return issues
}

export function validateMaterializationEnvelope(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['envelope must be an object.']
  const envelope = value as Record<string, unknown>
  const issues: string[] = []
  if (!isIntegerIn(envelope.childWallMs, 1_000, 24 * 60 * 60_000)) issues.push(`childWallMs must be an integer in 1000..86400000 (got ${String(envelope.childWallMs)}).`)
  if (!isIntegerIn(envelope.childHeapMb, 256, 65_536)) issues.push(`childHeapMb must be an integer in 256..65536 (got ${String(envelope.childHeapMb)}).`)
  if (!isIntegerIn(envelope.repeat, 1, MATERIALIZATION_SMOKE_MAX_REPEAT)) issues.push(`repeat must be an integer in 1..${MATERIALIZATION_SMOKE_MAX_REPEAT} (got ${String(envelope.repeat)}).`)
  return issues
}

/** A non-formal smoke value with the basis it was chosen on (design 11.2: `oracleInformed` per item). Never a registered condition. */
export interface SmokeCondition<T> {
  value: T
  basis: string
  oracleInformed: false
}

const W0 = reachWindowW0()

/**
 * The runner defaults of a D-0B non-formal smoke. Conservative on purpose: one structural candidate, the B-2B registered
 * node budget, and a gate that refuses the Skill held-aware Search scale D2-G-A found dangerous. Every value is
 * provisional (D-0B-2 pre-registers the formal ones) and none is derived from the 1,657 oracle or a past RESULT's Target
 * positions.
 */
export const MATERIALIZATION_D0B_SMOKE_DEFAULTS = Object.freeze({
  window: Object.freeze({
    value: Object.freeze({ ...W0 }) as ReachWindow,
    basis: 'W0 = recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1; design 10.3), a Production constant of non-oracle origin and the B-2B registered window.',
    oracleInformed: false,
  }) as SmokeCondition<ReachWindow>,
  nodeBudget: Object.freeze({
    value: 2_000,
    basis: 'The B-2B registered node budget (first complete assignment at node 43; C-2 smoke: 1,000 coverage-feasible assignments in 1,043 nodes). One structural candidate needs far fewer nodes; a stop is search_incomplete, never no candidate.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  mrvLookahead: Object.freeze({
    value: 8,
    basis: 'The B-2B registered MRV lookahead (a Target selection order bound only; every option stays enumerable).',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  coverageDrivenOrdering: Object.freeze({
    value: true,
    basis: 'Design 6.3 adopts the coverage-driven value ordering for the structural candidate generator; the C-2 smoke found the first 1,000 candidates identical with and without it at W0 (the ordering never fired).',
    oracleInformed: false,
  }) as SmokeCondition<boolean>,
  structuralCandidateLimit: Object.freeze({
    value: 1,
    basis: 'The D-0B smoke materializes the first structural candidate only (design 9.8); more candidates are a later, separately justified step.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  deliveryCap: Object.freeze({
    value: 500,
    basis: 'Provisional: no real-Export delivery distribution exists yet (D-0A synthetic deliveredBeforeMatch <= 2). Each delivered Candidate is materialized and matched, so 500 bounds the per-Target Candidate work while leaving room for the cheaper Ideal Routes that sort before the expected shape inside its extent. A stop is unconfirmed(delivery_cap_reached).',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  searchScaleGate: Object.freeze({
    value: Object.freeze({ maxConversionPositions: 32, maxGogmaLegalWidth: W0.gogma, maxSkillLegalWidth: W0.skill + 1, maxNormalForgeCount: W0.normal }) as SearchScaleGate,
    basis: 'Conversion positions drive the retained Skill held-aware stream (D2-G-A: 255 positions held 2.8 M Skill states and completed; 306 positions at M = 1500 model 60.8 M states and ran out of memory at a 12 GB heap). 32 keeps that term far below the measured completion while a fresh reservation (one conversion position) always passes. The widths and the forge count are set to the W0 window (never binding inside W0): their cost is bounded by the child wall-clock instead, and the smoke measures it.',
    oracleInformed: false,
  }) as SmokeCondition<SearchScaleGate>,
  childWallMs: Object.freeze({
    value: 30 * 60_000,
    basis: 'B-2A / C-2 smoke: Export parse + W0 ReachTable about 14 s and the first structural candidate about 50 s; the materialization cost of 43 Searches is the unknown this smoke measures. 30 minutes stops a runaway Search; reaching it is unmeasured(timeout) with the confirmed progress kept.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  childHeapMb: Object.freeze({
    value: 4_096,
    basis: 'The B-2B registered assignment child heap (W0 peak RSS about 1.1 GB). Out of memory is recorded only from the V8 heap-limit signature, never inferred.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  repeat: Object.freeze({
    value: 1,
    basis: 'One isolated child by default (the real-Export smoke). `--repeat 2` runs the same task twice to compare the semantic records.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
})

/** The default conditions and envelope as plain objects. */
export function smokeDefaults(): { conditions: MaterializationResearchConditions; envelope: MaterializationEnvelope } {
  const value = MATERIALIZATION_D0B_SMOKE_DEFAULTS
  return {
    conditions: {
      window: { ...value.window.value }, nodeBudget: value.nodeBudget.value, mrvLookahead: value.mrvLookahead.value, coverageDrivenOrdering: value.coverageDrivenOrdering.value,
      structuralCandidateLimit: value.structuralCandidateLimit.value, deliveryCap: value.deliveryCap.value, searchScaleGate: { ...value.searchScaleGate.value }, searchPolicyPrecheck: true,
    },
    envelope: { childWallMs: value.childWallMs.value, childHeapMb: value.childHeapMb.value, repeat: value.repeat.value },
  }
}

/** The items D-0B-2 pre-registers (design 19.7); none is registered here. */
export const MATERIALIZATION_D0B2_REGISTRATION_ITEMS = Object.freeze([
  'deliveryCap', 'searchScaleGate', 'childWallMs', 'childHeapMb', 'nodeBudget', 'structuralCandidateLimit', 'optionSetVersion', 'methodSelectionRule', 'searchPolicyShapeRule',
] as const)

/**
 * Why a formal run must not start: D-0B never starts one (design 19.7). The formal conditions are pre-registered in
 * D-0B-2 after the D-0A-2 method and the A-2 option set, and measured in D-0C.
 */
export function materializationFormalRunIssues(): string[] {
  return [
    `Phase D-0B registers no formal condition: ${MATERIALIZATION_D0B2_REGISTRATION_ITEMS.join(', ')} are pre-registered in D-0B-2 (after D-0A-2 and A-2) and measured formally in D-0C. Use --mode smoke.`,
  ]
}

/** How one structural candidate's materialization stage ended (design 4.6 / 9.6), with the D-0B Search-policy distinction. */
export type CandidateMaterializationClass =
  /** Every planning Target has a matching Entry. The Planner has not run (Phase D'): not verified. */
  | 'all_materialized'
  /** Design 9.1 Search exhausted (`summary.exhausted`) without the shape: the one executed mismatch. */
  | 'executed_shape_mismatch'
  | 'unconfirmed_stopped_by_extent'
  | 'unconfirmed_delivery_cap'
  /** Design 19.3 G1: a Search-policy shape, classified before any Search. */
  | 'not_executed_search_policy'
  | 'not_executed_search_scale_gate'
  | 'unmeasured_cancelled'
  /** A fail-closed stop of the run (`GlobalAssignmentMaterializationError` / `GlobalAssignmentInvariantError`): an error of the run, never an outcome. */
  | 'fail_closed'

export function classifyMaterializationStage(stage: MaterializationStageOutcome): CandidateMaterializationClass {
  if (stage.kind === 'all_materialized') return 'all_materialized'
  if (stage.kind === 'materialization_failed') return 'executed_shape_mismatch'
  const outcome = stage.outcome
  switch (outcome.kind) {
    case 'unconfirmed':
      return outcome.reason === 'stopped_by_extent' ? 'unconfirmed_stopped_by_extent' : 'unconfirmed_delivery_cap'
    case 'not_executed':
      return outcome.reason === 'search_policy_shape' ? 'not_executed_search_policy' : 'not_executed_search_scale_gate'
    case 'unmeasured':
      if (outcome.reason !== 'cancelled') throw new RangeError(`An in-process materialization never assigns unmeasured(${outcome.reason}); only the parent process does.`)
      return 'unmeasured_cancelled'
  }
}

/**
 * The design 10.3 role of a class (D-0B fixes the Search-policy row): what the class may and may not be read as when a
 * window, a setting or the method is reviewed. No role says a Route or a feasible Plan does not exist.
 */
export interface MaterializationFollowUp {
  /** `planner_verification_pending`: only Phase D' decides. `executed_mismatch`: counts with `materialization_failed`. `settings_review`: an unconfirmed / not executed / unmeasured cause (extent, cap, gate, envelope). `method_extension`: the Search policy, so the method (design 19.5 案B) and not a window, cap, gate or envelope. `run_error`: fail closed. */
  followUp: 'planner_verification_pending' | 'executed_mismatch' | 'settings_review' | 'method_extension' | 'run_error'
  /** Whether design 10.3 may count it toward a window expansion (only an executed mismatch, and only when every candidate of an exhausted window ends so). */
  windowExpansionBasis: boolean
  /** Whether it asks for the cap / gate / envelope / extent review of design 10.3 before any expansion. */
  settingsReviewBasis: boolean
}

export function materializationFollowUp(kind: CandidateMaterializationClass): MaterializationFollowUp {
  switch (kind) {
    case 'all_materialized':
      return { followUp: 'planner_verification_pending', windowExpansionBasis: false, settingsReviewBasis: false }
    case 'executed_shape_mismatch':
      return { followUp: 'executed_mismatch', windowExpansionBasis: true, settingsReviewBasis: false }
    case 'unconfirmed_stopped_by_extent':
    case 'unconfirmed_delivery_cap':
    case 'not_executed_search_scale_gate':
    case 'unmeasured_cancelled':
      return { followUp: 'settings_review', windowExpansionBasis: false, settingsReviewBasis: true }
    case 'not_executed_search_policy':
      return { followUp: 'method_extension', windowExpansionBasis: false, settingsReviewBasis: false }
    case 'fail_closed':
      return { followUp: 'run_error', windowExpansionBasis: false, settingsReviewBasis: false }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Progress journal. A child appends one JSON object per line as it goes, synchronously, so a run its envelope stops
// still leaves what it confirmed. The parent reads it only when the child produced no record; a Target that started and
// did not settle stays "in progress" with no outcome (never inferred).
// ---------------------------------------------------------------------------------------------------------------------

/** A short, plain outcome of a settled Target (journal and RESULT). */
export interface TargetOutcomeBrief {
  kind: 'materialized' | 'shape_mismatch' | 'unconfirmed' | 'not_executed' | 'unmeasured'
  reason: string | null
  method: string | null
  delivered: number | null
  deliveredBeforeMatch: number | null
}

export type MaterializationProgressEvent =
  | { kind: 'context'; status: 'context' | 'unsupported_input'; planningTargetCount: number; reason: string | null }
  | { kind: 'reach_table'; status: 'reach_table' | 'unsupported_input' | 'cancelled'; predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number } | null }
  | { kind: 'structural_candidate'; candidateIndex: number; ordinal: number; objective: number; expandedNodes: number }
  | { kind: 'structural_search'; status: string; completeness: string | null; expandedNodes: number; structuralCandidates: number; coverageRejections: number }
  | { kind: 'candidate_started'; candidateIndex: number; ordinal: number; objective: number; targetCount: number }
  | { kind: 'target_started'; candidateIndex: number; orderIndex: number; targetWeaponId: string }
  | { kind: 'target_settled'; candidateIndex: number; orderIndex: number; targetWeaponId: string; outcome: TargetOutcomeBrief }
  | { kind: 'candidate_settled'; candidateIndex: number; classification: CandidateMaterializationClass; materializedTargetCount: number; notAttemptedTargetCount: number }

export type ProgressJournalLine =
  | { kind: 'started'; atMs: number; pid: number }
  | { kind: 'progress'; atMs: number; event: MaterializationProgressEvent }
  | { kind: 'memory'; atMs: number; heapUsed: number; heapTotal: number; rss: number; external: number }
  | { kind: 'finished'; atMs: number }

/** What a journal confirms. Only settled facts; the Target in progress (if any) carries no outcome. */
export interface ConfirmedProgress {
  lines: number
  /** Unparsable lines (a line cut by a kill is expected only at the end). */
  malformedLines: number
  started: boolean
  finished: boolean
  lastAtMs: number | null
  context: Extract<MaterializationProgressEvent, { kind: 'context' }> | null
  reachTable: { event: Extract<MaterializationProgressEvent, { kind: 'reach_table' }>; atMs: number } | null
  structuralCandidates: { candidateIndex: number; ordinal: number; objective: number; expandedNodes: number; atMs: number }[]
  structuralSearch: { event: Extract<MaterializationProgressEvent, { kind: 'structural_search' }>; atMs: number } | null
  candidates: {
    candidateIndex: number
    ordinal: number
    objective: number
    targetCount: number
    settledTargets: { orderIndex: number; targetWeaponId: string; outcome: TargetOutcomeBrief; startedAtMs: number | null; settledAtMs: number }[]
    /** A Target that started and did not settle before the journal ended: its result is unknown, never inferred. */
    targetInProgress: { orderIndex: number; targetWeaponId: string; startedAtMs: number } | null
    settled: { classification: CandidateMaterializationClass; materializedTargetCount: number; notAttemptedTargetCount: number; atMs: number } | null
  }[]
  memory: { samples: number; last: { atMs: number; heapUsed: number; heapTotal: number; rss: number } | null; maxHeapUsed: number; maxRss: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a progress journal (the text of the file). Never throws on a malformed line; counts it instead. */
export function parseProgressJournal(text: string): ConfirmedProgress {
  const progress: ConfirmedProgress = {
    lines: 0, malformedLines: 0, started: false, finished: false, lastAtMs: null, context: null, reachTable: null, structuralCandidates: [], structuralSearch: null,
    candidates: [], memory: { samples: 0, last: null, maxHeapUsed: 0, maxRss: 0 },
  }
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
    const parsed = line as ProgressJournalLine
    if (parsed.kind === 'started') { progress.started = true; continue }
    if (parsed.kind === 'finished') { progress.finished = true; continue }
    if (parsed.kind === 'memory') {
      progress.memory.samples += 1
      progress.memory.last = { atMs: parsed.atMs, heapUsed: parsed.heapUsed, heapTotal: parsed.heapTotal, rss: parsed.rss }
      progress.memory.maxHeapUsed = Math.max(progress.memory.maxHeapUsed, parsed.heapUsed)
      progress.memory.maxRss = Math.max(progress.memory.maxRss, parsed.rss)
      continue
    }
    if (parsed.kind !== 'progress' || !isRecord(parsed.event)) { progress.malformedLines += 1; continue }
    const event = parsed.event
    const candidate = (index: number) => progress.candidates.find(value => value.candidateIndex === index) ?? null
    switch (event.kind) {
      case 'context': progress.context = event; break
      case 'reach_table': progress.reachTable = { event, atMs: parsed.atMs }; break
      case 'structural_candidate': progress.structuralCandidates.push({ candidateIndex: event.candidateIndex, ordinal: event.ordinal, objective: event.objective, expandedNodes: event.expandedNodes, atMs: parsed.atMs }); break
      case 'structural_search': progress.structuralSearch = { event, atMs: parsed.atMs }; break
      case 'candidate_started':
        progress.candidates.push({ candidateIndex: event.candidateIndex, ordinal: event.ordinal, objective: event.objective, targetCount: event.targetCount, settledTargets: [], targetInProgress: null, settled: null })
        break
      case 'target_started': {
        const owner = candidate(event.candidateIndex)
        if (owner) owner.targetInProgress = { orderIndex: event.orderIndex, targetWeaponId: event.targetWeaponId, startedAtMs: parsed.atMs }
        else progress.malformedLines += 1
        break
      }
      case 'target_settled': {
        const owner = candidate(event.candidateIndex)
        if (!owner) { progress.malformedLines += 1; break }
        const startedAtMs = owner.targetInProgress?.orderIndex === event.orderIndex ? owner.targetInProgress.startedAtMs : null
        owner.settledTargets.push({ orderIndex: event.orderIndex, targetWeaponId: event.targetWeaponId, outcome: event.outcome, startedAtMs, settledAtMs: parsed.atMs })
        owner.targetInProgress = null
        break
      }
      case 'candidate_settled': {
        const owner = candidate(event.candidateIndex)
        if (owner) owner.settled = { classification: event.classification, materializedTargetCount: event.materializedTargetCount, notAttemptedTargetCount: event.notAttemptedTargetCount, atMs: parsed.atMs }
        else progress.malformedLines += 1
        break
      }
      default: progress.malformedLines += 1
    }
  }
  return progress
}
