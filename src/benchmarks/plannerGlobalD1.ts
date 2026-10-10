/**
 * Issue #154 D1-B: the Phase B `found_R` set coexistence diagnostic. Research only. Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md` (D1-A, PR #223), registered by the runner at the measurement
 * HEAD. D1 discovers no new Candidate: it re-delivers the 11 Candidates Phase B stopped at (R), and evaluates sets of them with
 * the unchanged Production Planner parts:
 *
 * ```text
 * V   the registered inputs (digests, Phase B RESULT allowlist, records, tasks, the §1.3 table)   parent, no child
 * R   per found unit: the Phase B task checks -> visitPlannerAlternativeCandidates() up to the recorded delivery index
 *       -> createPlannerAlternativeMaterializer().materializeBuildListEntry() -> the G store (one body per Target)
 * B0  the baseline PlannerInput, one full run (persisted)
 * S / P / A   per replacement set T: resolveBuildListEntryReplacement() per G_t -> preparePlannerReplacementConflictPreflight(
 *       baseline + G_T, replacements, NO fixed constraint) -> createPlannerAlternativeFullRunner(budget 8).run(-O + G)
 * ```
 *
 * Every evaluation run keeps `conflictResolutions = []`: no resolution, scenario resolution, repair lineage or
 * `selectedBuildListEntryId` is ever written for a support Entry or a G (G1). R5 (`set_coexistent_R`) is judged from the run facts
 * only (§4.4); S never feeds R5, the A(c) acceptance or the decision (G20).
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module, and reads the Phase B RESULT
 * through `projectD1PhaseBResult()` only (the §1.2 allowlist). It names no Target, Entry, reservation digest or stable key: those
 * are derived from the Phase B records and checked against the registered §1.3 table of the D1 document.
 */
import { resolveBuildListEntryReplacement, type BuildListEntryReplacement } from '../domain/buildList'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId, PlanConflict } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeFullRunner,
  createPlannerAlternativeMaterializer,
  createPlannerAlternativeSearchIdentity,
  derivePlannerAlternativeReservation,
  judgePlannerAlternativeTrial,
} from '../domain/planner/alternative'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import type { PlannerDependencies, PlannerInput, PlannerResult, PlannerRouteCommitmentEvidence, PlannerRunBuildListContext } from '../domain/planner/plannerTypes'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import { preparePlannerReplacementConflictPreflight } from '../domain/planner/replacement/plannerAugmentedPreflight'
import { createPlannerConflictContexts, plannerConflictResourceKey } from '../domain/planner/replacement/plannerConflictContext'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeCandidate } from '../domain/search'
import { respectsPhase2C2Reservation, summarizePhase2C2Baseline, summarizePhase2C2Entry, type Phase2C2BaselineSummary } from './plannerGlobalPhase2C2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C27BTargetPlans,
  createPhase2C27BLadderRerunBudget,
  phase2c27bLadderStateIssues,
  phase2c27bPolicyDrift,
  phase2c27bResolveSupportContext,
  phase2c27bRungExtent,
  phase2c27bUnitId,
  PHASE2C27B_INITIAL_LADDER_STATE,
  PHASE2C27B_LADDER_BUDGET,
  PHASE2C27B_RESEARCH_MAX_PLAN_STEPS,
  PHASE2C27B_RUNG_IDS,
  type Phase2C27BPreparedContext,
  type Phase2C27BUnitTask,
} from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const pad = (value: number) => String(value).padStart(2, '0')
const sortedIds = (ids: readonly string[]) => [...ids].sort(compare)

// ---------------------------------------------------------------- registered before the formal run (D1-A §1 - §7)

export const D1_PHASE = 'Issue #154 D1'
export const D1_RESULT_PHASE = 'Issue #154 D1: Phase B found_R set coexistence diagnostic (post-hoc analysis)'
/** The D1-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§1.2) and attested. */
export const D1_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md'
/** The main of D1-B's start (PR #223 merged): the Production audit counts changes since this commit. */
export const D1_BASE_MAIN = '16ffc1084788b1877b1739d8e705e39b263c8a4e'

export const D1_PHASE_B_PROVENANCE = Object.freeze({
  measuredHead: 'b24bf5dc7d98cb8341a24d27fabbd1a36843a004',
  benchmarkCodeSha256: '53480b3dbe9fd1a08bc6824c9c33c197fbd8ad61a6a3437c46155baa6585cadf',
  decisionCase: 'B2C27B_INCOMPLETE',
  policyAuthoritySha256: 'b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147',
} as const)

/**
 * One registered input. `sha256: null` is the Export only: its D1-A §1.2 digest is reached through the authority chain (the Phase B
 * start attestation, itself registered by digest, names it; the Phase B RESULT `sources.export` and the D1 document must agree),
 * so the Export digest is written in no Research source but the oracle's (the Phase 2-A.5 isolation rule).
 */
export interface D1RegisteredFile { file: string; bytes: number | null; sha256: string | null }

/** §1.2: every input D1 reads, by path relative to the repository root (the Export is an external path argument). */
export const D1_REGISTERED_INPUTS = Object.freeze({
  phaseBResult: { file: 'docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json', bytes: null, sha256: 'd79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4' },
  phaseBRaw: { file: '.local/PLANNER_GLOBAL_PHASE2C27B_RAW.json.local', bytes: 2_567_122, sha256: 'f8c16d9f8a420bad139cd26c71574ff3c3517c8321faa5c2ab26a83f514c3bed' },
  phaseBAttestation: { file: '.local/c27b-formal.run/start-attestation.json', bytes: 5_799, sha256: 'd76ebc4d7c9f7ce85404af147c2ea45c54511293b17cef52eaf0c6d0525f5c31' },
  phaseBTasksRecord: { file: '.local/c27b-formal.run/tasks.record.json', bytes: 159_706, sha256: '7c4a7d98d60857e459b743894d899785db042cc9eefa6633c47128e064d7026d' },
  phaseBTargets: { file: '.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local', bytes: 967, sha256: 'd4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de' },
  export: { file: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: null },
  phase2c2Result: { file: 'docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json', bytes: null, sha256: 'afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4' },
  phaseADocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md', bytes: null, sha256: 'b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147' },
  phaseBDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md', bytes: null, sha256: 'e05eea56d3c9c8cdeae1f086e9ca6b2a4fa326fd1e9de87914e120a4488dff9c' },
  followupDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md', bytes: null, sha256: '335a6710d49bcdc1a9ef05a822a9931f40610c714561ae665ac008e82b987083' },
} satisfies Record<string, D1RegisteredFile>)
export type D1RegisteredInputKey = keyof typeof D1_REGISTERED_INPUTS
export const D1_PHASE_B_RUN_DIR = '.local/c27b-formal.run'

export interface D1RegisteredFoundUnit { unitId: string; recordBytes: number; recordSha256: string; taskSha256: string }
/** §1.3: the 11 found_R units by Target index (record digests from the Phase B RESULT, task digests from the Phase B run dir). */
export const D1_FOUND_UNITS: readonly D1RegisteredFoundUnit[] = Object.freeze([
  { unitId: 't00-r01-L1', recordBytes: 98_903, recordSha256: 'ed94cce4cbb19736c4db65db0ec5237da464d54c46dee23444d1e1a0078630bc', taskSha256: '0ee64040137b8d2dd8c1dd37fdd7487ce3fb3fefdda1020de112ddfc85f01615' },
  { unitId: 't01-r01-L1', recordBytes: 73_825, recordSha256: '382c1235fca239160030c3b71b9d2def42e514e7823d0734d547229dd7ace292', taskSha256: '107451849e11ae50ae9a10078e36bae0b0299f18c68db8c0cd1f76cd6f6460b0' },
  { unitId: 't02-r01-L2', recordBytes: 267_503, recordSha256: '0f02586bbf78f1da6738c09874c44148e5ce408a738fd4b3bb06ab2f07845dc5', taskSha256: '1260b39d69bf5c7e33b2eac54685bab7a5b75b519ea562b3cfbaa7a63f81658c' },
  { unitId: 't03-r01-L2', recordBytes: 195_821, recordSha256: '97aff925036b65a201b22345c2d0b3df4b98ede3598559a49af3f3355ebcb92f', taskSha256: 'f8109f037c3af290284b795591b8bd2b894584b32ed167b01407ec40325e93ee' },
  { unitId: 't04-r01-L2', recordBytes: 831_918, recordSha256: '3b5ba758838f76b0f7cc09a130259640a269d164f350cbf75829faf9202a9fcb', taskSha256: '04025f86523d075547f6a6c5c643be8cfc9648ff12097f27be146edf53a56aac' },
  { unitId: 't05-r01-L0', recordBytes: 76_565, recordSha256: '57a9dfc34a25fce82b2afe26fc0e362646906a2ad29b973eb9eb06a0370ab051', taskSha256: 'fe3c82cbd837554877fd14ef8249255541dfa9337490e1b752fe47d8940c8b12' },
  { unitId: 't06-r01-L0', recordBytes: 124_440, recordSha256: '726c78dccf6e7562c36b9a28f16fabbe6b072c73094daa3bf18c23f2cb679d03', taskSha256: '671672ed0621ce09fc61c08ffb320cdf9d261be887c7f4feebf12f891436ce65' },
  { unitId: 't07-r01-L1', recordBytes: 177_405, recordSha256: '96ac0928f4edcefd6dcd63a2a1693585875962258d7bf286a7bd693290a171b4', taskSha256: 'd69f0d16bf84e9b4674dbe78b3460c305f283f3b7695e29a2e6f7b8d65a8129d' },
  { unitId: 't08-r01-L2', recordBytes: 403_338, recordSha256: '91231ae09dfad973ca841e07e38cf08d42aeb2b5ca6688eeb619a92eddfb7b6a', taskSha256: '0755b2c328a00c5d91d7a04ef5831ef2f57d6df3f88cc0b8f4c126dda9e70ff3' },
  { unitId: 't09-r10-L1', recordBytes: 203_547, recordSha256: '4de5f215bcd2d752c336ce1c92968880be9512c0df30c857f75469edd3bc7214', taskSha256: '273c35ac7a3c549b311d03ee900fc2ea79f2333a724dd1d8bb362501f1a6dd52' },
  { unitId: 't10-r01-L1', recordBytes: 37_360, recordSha256: 'c9d927eff709de978df01275afb08db5ac7599b3774423b6011ab0ddf3186906', taskSha256: 'e4f6ed5a4f0886a4c8f8bbd9622f2811d174a62fc5a80b2c2913969dfb501099' },
].map(row => Object.freeze(row)))
export const D1_TARGETS = 11
/** §5.4: A(b) is the Phase B `G` selected set, derived mechanically and checked against these Target indexes. */
export const D1_A_B_REGISTERED_TARGET_INDEXES: readonly number[] = Object.freeze([1, 7, 8, 9])

export const D1_RESEARCH_MAX_PLAN_STEPS = 20_000
/** §6.3: the Research per-evaluation full Planner run cap (the Production number, without the request-global meaning; G5). */
export const D1_EVALUATION_FULL_RUN_CAP = 8
export const D1_CALCULATION_CONTEXT = Object.freeze({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
export const D1_RNG_ENGINE_VERSION = 'production-rng:c5-e7'

/** §6.1: one execution envelope (a Research measurement envelope, never a Production timeout). */
export const D1_EXECUTION_ENVELOPE = Object.freeze({
  redeliveryBudgetMs: 60 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

export const D1_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  phaseBResultModified: false,
  speculativeSupportWrittenAsResolution: false,
  oracleGuidedTargetPopulation: true,
  inheritsOracleInformedExecutionEnvelope: true,
  productionSemanticsChanged: false,
} as const)

/** §1.2: the only Phase B RESULT fields D1 reads. */
export const D1_PHASE_B_RESULT_ALLOWLIST = Object.freeze([
  'sources.{run,runDir,attestation,tasksRecord,targets,export,unitRecords}',
  'provenance.{formal,measuredHead,runStatus,benchmarkCodeSha256,calculationCodeChangedSinceMeasuredHead}',
  'decision.case',
  'units[result=found_R] (whole entry)',
  'units[].{unitId,result}',
])

/** §7: the decision order, checked top to bottom. */
export const D1_DECISION_RULE = Object.freeze([
  'D1_INVALID: any formal validity violation (§9; input_evidence / provenance / redelivery_mismatch / baseline_parity_mismatch / phase_b_parity_mismatch / guardrail / determinism / raw_result_mismatch)',
  'D1_INCOMPLETE: invalid 0 and any registered R (11) or evaluation (80) is unmeasured or not_executed; measured evidence is a lower bound',
  'D1_FOUND_R_SET_COEXISTS: invalid 0, unmeasured 0, A-a satisfies R5',
  'D1_FOUND_R_SET_PARTIAL: invalid 0, unmeasured 0, A-a fails R5, and a P / A-b / A-c evaluation of a replacement set of size >= 2 satisfies R5',
  'D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED: invalid 0, unmeasured 0, none of the above (not a proof of non-coexistence)',
])

/** What D1 deliberately does not run (§1.1). */
export const D1_NOT_RUN = Object.freeze(['new_candidate_search', 'candidate_reselection', 'optimization', 'oracle_comparison', 'phase_b_result_rewrite', 'r6_acceptance',
  'resolution_synthesis', 'repair_lineage', 'persistence', 'retry', 'fallback', 'production_change', 'production_default_change', 'alternative_to_alternative_support'])

/** §4.4 / §4.5 as registered text (attested and copied into the RESULT). */
export const D1_R5_DEFINITION = Object.freeze([
  '(1) S_G ⊆ selected (generated_not_selected)',
  '(2) S_sup ⊆ selected, vacuous when empty (support_not_selected)',
  '(3) every support Entry passes S1 - S3 (support_expired_R)',
  '(4) no Conflict c with |c.buildListEntryIds ∩ M| >= 2, whatever c.selectedBuildListEntryId (conflict_within_set)',
  '(5) status evaluated, plan !== null, termination.status in { completed, exhausted } (no_plan / plan_bound_truncated / preflight_refused / planner_rerun_bound_reached)',
])
export const D1_SUPPORT_CHECKS = Object.freeze([
  'S1 dynamic: the support Target is not in T',
  'S2 dynamic: the final run input holds the support Entry ID',
  'S3 dynamic: the final run input initial context holds the support Entry as a valid Entry',
  'S4 static: the support Entry body equals the Export body (stableStringify)',
  'S5 static: hashStableValue(derivePlannerAlternativeReservation([support])) is the Phase B task reservationDigest and equals the Phase B record reservation',
])

// ---------------------------------------------------------------- the registered evaluations (§2 / §5 / §6.4)

export type D1Stage = 'B0' | 'S' | 'P' | 'A-a' | 'A-b' | 'A-c'
export type D1EvaluatedAgainst = 'baseline_reference' | 'baseline' | 'replacement_set'

export interface D1RegisteredEvaluation {
  evaluationId: string
  stage: D1Stage
  /** 0-based position in the registered order (0..79). */
  ordinal: number
  evaluatedAgainst: D1EvaluatedAgainst
  /** The replacement Target indexes (ascending); null for A-c, whose set depends on the earlier steps. */
  targetIndexes: number[] | null
  /** A-c only: the 0-based index of the Target this step proposes. */
  candidateIndex: number | null
}

export const d1TargetLabel = (index: number) => `t${pad(index)}`

/** The 80 registered evaluation requests in their fixed order: B0, S t00..t10, P (i, j) lexicographic, A-a, A-b, A-c-01..11. */
export function d1RegisteredEvaluations(targetCount = D1_TARGETS): D1RegisteredEvaluation[] {
  const list: Omit<D1RegisteredEvaluation, 'ordinal'>[] = []
  const all = Array.from({ length: targetCount }, (_, i) => i)
  list.push({ evaluationId: 'B0', stage: 'B0', evaluatedAgainst: 'baseline_reference', targetIndexes: [], candidateIndex: null })
  for (const i of all) list.push({ evaluationId: `S-${d1TargetLabel(i)}`, stage: 'S', evaluatedAgainst: 'baseline', targetIndexes: [i], candidateIndex: null })
  for (const i of all) for (const j of all) if (i < j) list.push({ evaluationId: `P-${d1TargetLabel(i)}-${d1TargetLabel(j)}`, stage: 'P', evaluatedAgainst: 'replacement_set', targetIndexes: [i, j], candidateIndex: null })
  list.push({ evaluationId: 'A-a', stage: 'A-a', evaluatedAgainst: 'replacement_set', targetIndexes: [...all], candidateIndex: null })
  list.push({ evaluationId: 'A-b', stage: 'A-b', evaluatedAgainst: 'replacement_set', targetIndexes: [...D1_A_B_REGISTERED_TARGET_INDEXES], candidateIndex: null })
  for (const k of all) list.push({ evaluationId: `A-c-${pad(k + 1)}`, stage: 'A-c', evaluatedAgainst: 'replacement_set', targetIndexes: null, candidateIndex: k })
  return list.map((entry, ordinal) => ({ ...entry, ordinal }))
}

/** One A(c) step (§5.4): the proposed set is the accepted set plus the candidate, ascending (Target ID order = index order). */
export function d1CompositionProposal(acceptedBefore: readonly number[], candidate: number): number[] {
  return [...new Set([...acceptedBefore, candidate])].sort((a, b) => a - b)
}

/**
 * The A(c) acceptance of one step: accepted only when the step was evaluated and the WHOLE proposed set satisfies R5; an
 * unmeasured / not executed step keeps the accepted set with `accepted = null`. Never reads S.
 */
export function d1CompositionOutcome(acceptedBefore: readonly number[], candidate: number, measured: boolean, r5Satisfied: boolean | null):
  { proposed: number[]; accepted: boolean | null; acceptedAfter: number[] } {
  const proposed = d1CompositionProposal(acceptedBefore, candidate)
  if (!measured) return { proposed, accepted: null, acceptedAfter: [...acceptedBefore] }
  const accepted = r5Satisfied === true
  return { proposed, accepted, acceptedAfter: accepted ? proposed : [...acceptedBefore] }
}

// ---------------------------------------------------------------- the Phase B RESULT allowlist (§1.2)

export interface D1PhaseBResultProjection {
  sources: { run: unknown; runDir: unknown; attestation: unknown; tasksRecord: unknown; targets: unknown; export: unknown; unitRecords: unknown }
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown; benchmarkCodeSha256: unknown; calculationCodeChangedSinceMeasuredHead: unknown }
  decisionCase: unknown
  /** Every unit, `unitId` / `result` only. */
  unitResults: { unitId: unknown; result: unknown }[]
  /** The `found_R` entries, whole. */
  foundUnits: Json[]
}

/** Reads ONLY the allowlisted fields of the Phase B RESULT (never an oracle-derived field; G21). */
export function projectD1PhaseBResult(json: unknown): D1PhaseBResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !Array.isArray(json.units)) return null
  const s = json.sources, p = json.provenance
  const units = json.units as unknown[]
  return {
    sources: { run: s.run, runDir: s.runDir, attestation: s.attestation, tasksRecord: s.tasksRecord, targets: s.targets, export: s.export, unitRecords: s.unitRecords },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, runStatus: p.runStatus, benchmarkCodeSha256: p.benchmarkCodeSha256,
      calculationCodeChangedSinceMeasuredHead: p.calculationCodeChangedSinceMeasuredHead },
    decisionCase: json.decision.case,
    unitResults: units.map(u => isObject(u) ? { unitId: u.unitId, result: u.result } : { unitId: null, result: null }),
    foundUnits: units.filter((u): u is Json => isObject(u) && u.result === 'found_R').map(u => structuredClone(u)),
  }
}

// ---------------------------------------------------------------- the registered §1.3 table (parsed from the D1 document)

export interface D1SpecFoundRow {
  t: string
  targetWeaponId: string
  unitId: string
  rung: string
  supportBuildListEntryIds: string[]
  reservationDigest: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  deliveryIndex: number
  routeOperationCount: number
  routeKind: string
}
export interface D1SpecTrialRow {
  t: string
  planPresent: boolean
  termination: string
  completed: number
  steps: number
  selected: number
  conflicts: number
  generatedSelected: boolean
  commitment: { status: string; provisionalOutcomeSelectedBuildListEntryId: string | null }
  supportSelected: string[]
  fullRuns: number
}

const tableRows = (markdown: string, header: RegExp): string[][] => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => header.test(line))
  if (start < 0) return []
  const rows: string[][] = []
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) rows.push(lines[i]!.split('|').slice(1, -1).map(cell => cell.trim()))
  return rows
}
const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]!)

/** The two registered §1.3 tables of the D1 document (the registered values; the source holds none of them). */
export function parseD1SpecTables(markdown: string): { found: D1SpecFoundRow[]; trials: D1SpecTrialRow[] } {
  const found = tableRows(markdown, /^\| t \| TargetWeapon ID \| unit \|/).map(cells => {
    const [t, target, unit, , rung, support, digest, current, generated, delivery, route] = cells
    const routeMatch = /^(\d+) \/ `([^`]+)`$/.exec(route ?? '')
    return { t: t!, targetWeaponId: ticks(target!)[0]!, unitId: ticks(unit!)[0]!, rung: (rung ?? '').slice(0, 2), supportBuildListEntryIds: support === 'なし' ? [] : [ticks(support!)[0]!],
      reservationDigest: ticks(digest!)[0]!, currentBuildListEntryId: ticks(current!)[0]!, generatedBuildListEntryId: ticks(generated!)[0]!, deliveryIndex: Number(delivery),
      routeOperationCount: Number(routeMatch?.[1]), routeKind: routeMatch?.[2] ?? '' }
  })
  const trials = tableRows(markdown, /^\| t \| plan \| termination \|/).map(cells => {
    const [t, plan, termination, completed, steps, selected, conflicts, gSelected, commitment, support, fullRuns] = cells
    const dropped = /^dropped（`([^`]+)`）$/.exec(commitment ?? '')
    return { t: t!, planPresent: plan === 'true', termination: termination!, completed: Number(completed), steps: Number(steps), selected: Number(selected), conflicts: Number(conflicts),
      generatedSelected: gSelected === 'true', commitment: dropped ? { status: 'dropped', provisionalOutcomeSelectedBuildListEntryId: dropped[1]! } : { status: commitment!, provisionalOutcomeSelectedBuildListEntryId: null },
      supportSelected: support === '—' ? [] : ticks(support!), fullRuns: Number(fullRuns) }
  })
  return { found, trials }
}

// ---------------------------------------------------------------- V: the registered inputs and their authority chain (§9.1)

export interface D1ObservedFile { bytes: number; sha256: string }

export interface D1InputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D1RegisteredInputKey, D1ObservedFile | null>
  phaseBResult: unknown
  phaseBRaw: unknown
  phaseBAttestation: unknown
  phase2c2Result: unknown
  /** By unit ID: the observed record / task files and their JSON (null = missing). */
  unitRecords: Record<string, { file: D1ObservedFile; json: unknown } | null>
  unitTasks: Record<string, { file: D1ObservedFile; json: unknown } | null>
  /** The D1 document text (for the registered §1.3 tables). */
  specMarkdown: string
}

/** One of the 11 Targets as D1 uses it, derived from the Phase B records only. */
export interface D1FoundTarget {
  targetIndex: number
  label: string
  unitId: string
  targetWeaponId: string
  task: Phase2C27BUnitTask
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  /** `requiresSupport(G_t)`: the Phase B context's support Entries (empty for K0). */
  supportBuildListEntryIds: string[]
  reservationDigest: string
  /** The Phase B record reservation / excluded Route keys (R re-derives and compares them; S5 compares the support reservation). */
  reservation: unknown
  excludedRouteKeys: string[]
  deliveryIndex: number
  trialOrdinal: number
  candidateStableKey: string
  /** The Phase B trial of the found Candidate (S parity). */
  trial: Json
  /** Phase B record `found` (route, results, generatedSelected). */
  found: Json
  /** Phase B record `search`. */
  search: Json
  deliveries: Json[]
  recordFile: { file: string; bytes: number; sha256: string }
  taskFile: { file: string; bytes: number; sha256: string }
}

/** The Export SHA-256 the Phase B start attestation (a registered input) names, or null. */
export function d1ChainedExportSha256(phaseBAttestation: unknown): string | null {
  return isObject(phaseBAttestation) && typeof phaseBAttestation.exportSha256 === 'string' && /^[0-9a-f]{64}$/.test(phaseBAttestation.exportSha256) ? phaseBAttestation.exportSha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const
export const D1_B0_PARITY_FIELDS: readonly string[] = B0_PARITY_FIELDS

/**
 * V (§1.2 / §1.3 / §9.1): every registered input present with its registered digest, the Phase B RESULT (allowlist only) the
 * registered formal INCOMPLETE run with exactly the registered 11 found_R units, each record / task consistent with the RESULT,
 * the raw run, the tasks plan and the registered §1.3 tables, and the Phase 2-C2 baseline summary complete. Never repairs or
 * substitutes: any issue fails D1 closed (`input_evidence`). Pure.
 */
export function validateD1Inputs(evidence: D1InputEvidence, sha256OfText: (text: string) => string): { passed: boolean; issues: string[]; targets: D1FoundTarget[] } {
  const issues: string[] = []
  const chainedExport = d1ChainedExportSha256(evidence.phaseBAttestation)
  for (const [key, registered] of Object.entries(D1_REGISTERED_INPUTS) as [D1RegisteredInputKey, D1RegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? chainedExport
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the Phase B attestation`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (registered.bytes !== null && observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
  }
  const result = projectD1PhaseBResult(evidence.phaseBResult)
  if (result === null) return { passed: false, issues: [...issues, 'the Phase B RESULT has no sources / provenance / decision / units'], targets: [] }
  if (result.provenance.formal !== true) issues.push('Phase B RESULT provenance.formal is not true')
  if (result.provenance.measuredHead !== D1_PHASE_B_PROVENANCE.measuredHead) issues.push('Phase B RESULT measuredHead is not the registered one')
  if (result.provenance.runStatus !== 'completed') issues.push('Phase B RESULT runStatus is not completed')
  if (result.provenance.benchmarkCodeSha256 !== D1_PHASE_B_PROVENANCE.benchmarkCodeSha256) issues.push('Phase B RESULT benchmarkCodeSha256 is not the registered one')
  if (!Array.isArray(result.provenance.calculationCodeChangedSinceMeasuredHead) || result.provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('Phase B RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (result.decisionCase !== D1_PHASE_B_PROVENANCE.decisionCase) issues.push('Phase B RESULT decision.case is not B2C27B_INCOMPLETE')
  const foundIds = result.unitResults.filter(u => u.result === 'found_R').map(u => u.unitId)
  if (!same(foundIds, D1_FOUND_UNITS.map(u => u.unitId))) issues.push(`Phase B RESULT found_R units ${JSON.stringify(foundIds)} are not the registered 11`)
  const unitRecordSources = Array.isArray(result.sources.unitRecords) ? result.sources.unitRecords as unknown[] : []
  const raw = isObject(evidence.phaseBRaw) ? evidence.phaseBRaw : null
  if (raw === null || raw.status !== 'completed') issues.push('the Phase B raw run is not completed')
  const rawUnits = raw !== null && Array.isArray(raw.units) ? raw.units as unknown[] : []
  const rawPlans = raw !== null && Array.isArray(raw.plans) ? raw.plans as unknown[] : []
  const attestation = isObject(evidence.phaseBAttestation) ? evidence.phaseBAttestation : null
  if (attestation === null) issues.push('the Phase B start attestation is not an object')
  else {
    if (!isObject(attestation.policyAuthority) || attestation.policyAuthority.sha256 !== D1_PHASE_B_PROVENANCE.policyAuthoritySha256) issues.push('the Phase B attestation policy authority is not the registered Phase A document')
    if (chainedExport === null || !evidence.specMarkdown.includes(chainedExport)) issues.push('the Phase B attestation Export is not the Export the D1 document registers')
    const resultExport = isObject(result.sources.export) ? result.sources.export : null
    if (resultExport === null || resultExport.sha256 !== chainedExport || resultExport.bytes !== D1_REGISTERED_INPUTS.export.bytes) issues.push('the Phase B RESULT sources.export is not the Phase B attestation Export')
    if (attestation.targetManifestSha256 !== D1_REGISTERED_INPUTS.phaseBTargets.sha256) issues.push('the Phase B attestation manifest is not the registered manifest')
    if (attestation.researchMaxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) issues.push('the Phase B attestation researchMaxPlanSteps is not 20000')
  }
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  const spec = parseD1SpecTables(evidence.specMarkdown)
  if (spec.found.length !== D1_TARGETS || spec.trials.length !== D1_TARGETS) issues.push('the D1 document §1.3 tables do not hold 11 rows each')

  const targets: D1FoundTarget[] = []
  D1_FOUND_UNITS.forEach((registered, targetIndex) => {
    const at = registered.unitId
    const recordEntry = evidence.unitRecords[at] ?? null, taskEntry = evidence.unitTasks[at] ?? null
    if (recordEntry === null || taskEntry === null) { issues.push(`${at}: the record or the task file is missing`); return }
    if (recordEntry.file.sha256 !== registered.recordSha256 || recordEntry.file.bytes !== registered.recordBytes) issues.push(`${at}: the record is not the registered record`)
    if (taskEntry.file.sha256 !== registered.taskSha256) issues.push(`${at}: the task is not the registered task`)
    const recordSource = unitRecordSources.find(s => isObject(s) && s.file === `${at}.record.json`)
    if (!isObject(recordSource) || recordSource.sha256 !== recordEntry.file.sha256 || recordSource.bytes !== recordEntry.file.bytes) issues.push(`${at}: the record is not the one the Phase B RESULT sources name`)
    const rawUnit = rawUnits.find((u): u is Json => isObject(u) && u.unitId === at)
    if (!rawUnit || !isObject(rawUnit.recordFile) || rawUnit.recordFile.sha256 !== recordEntry.file.sha256 || rawUnit.recordFile.bytes !== recordEntry.file.bytes) issues.push(`${at}: the record is not the one the Phase B raw names`)
    const record = recordEntry.json
    if (!isObject(record) || !isObject(record.result) || record.result.status !== 'executed') { issues.push(`${at}: the record is not an executed unit record`); return }
    const r = record.result
    const task = r.task as Phase2C27BUnitTask
    if (!same(record.task, r.task) || !same(taskEntry.json, r.task)) issues.push(`${at}: record.task, record.result.task and the task file differ`)
    if (!isObject(task)) { issues.push(`${at}: no task`); return }
    if (task.unitId !== at || task.targetIndex !== targetIndex) issues.push(`${at}: the task unit / Target index is not the registered one`)
    if (rawUnit) {
      for (const field of ['unitId', 'targetWeaponId', 'targetIndex', 'contextRank', 'rung', 'ladderStateAtStart'] as const) {
        if (!same(rawUnit[field], (task as unknown as Json)[field])) issues.push(`${at}: the raw unit ${field} differs from the task`)
      }
    }
    const plan = rawPlans.find((p): p is Json => isObject(p) && p.targetIndex === targetIndex)
    const context = plan && Array.isArray(plan.contexts) ? (plan.contexts as unknown[]).find((c): c is Json => isObject(c) && c.contextRank === task.contextRank) : undefined
    if (!plan || plan.targetWeaponId !== task.targetWeaponId || plan.currentBuildListEntryId !== task.currentBuildListEntryId || !context) issues.push(`${at}: the raw plan / context is missing or differs`)
    else for (const field of ['groupIndex', 'reservationDigest', 'cardinality', 'representativeFixedSetId', 'supportBuildListEntryIds'] as const) {
      if (!same(context[field], (task as unknown as Json)[field])) issues.push(`${at}: the raw context ${field} differs from the task`)
    }
    if (r.outcome !== 'found_R' || !isObject(r.found) || !Array.isArray(r.deliveries) || !Array.isArray(r.trials) || !isObject(r.search)) { issues.push(`${at}: the record is not a found_R record`); return }
    const found = r.found, deliveries = r.deliveries as Json[], trials = r.trials as Json[]
    const d = found.deliveryIndex as number, ordinal = found.trialOrdinal as number
    const delivery = deliveries[d], trial = trials.find(t => isObject(t) && t.trialOrdinal === ordinal)
    if (!delivery || delivery.stableKey !== found.candidateStableKey) issues.push(`${at}: the found delivery does not carry the found stable key`)
    if (!trial || trial.candidateStableKey !== found.candidateStableKey || trial.generatedBuildListEntryId !== found.generatedBuildListEntryId || trial.deliveryIndex !== d
      || !isObject(trial.verdict) || trial.verdict.status !== 'found_R') { issues.push(`${at}: the found trial is missing or differs`); return }
    if (!same(record.calculationContext, D1_CALCULATION_CONTEXT) || record.rngEngineVersion !== D1_RNG_ENGINE_VERSION || record.researchMaxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) issues.push(`${at}: the record CalculationContext / Engine / maxPlanSteps is not the registered one`)
    if (!same(task.ladderStateAtStart, PHASE2C27B_INITIAL_LADDER_STATE) || !same(r.ladderStateAtStart, PHASE2C27B_INITIAL_LADDER_STATE)) issues.push(`${at}: the ladder state at start is not the initial one`)
    // The Phase B RESULT entry (allowlist) agrees with the record: delivery key digest and the compact trial summary.
    const resultUnit = result.foundUnits.find(u => u.unitId === at)
    if (!resultUnit) issues.push(`${at}: no found_R entry in the Phase B RESULT`)
    else {
      const resultDeliveries = Array.isArray(resultUnit.deliveries) ? resultUnit.deliveries as Json[] : []
      if (resultDeliveries[d]?.keySha256 !== sha256OfText(found.candidateStableKey as string)) issues.push(`${at}: the Phase B RESULT delivery key digest is not sha256(found.candidateStableKey)`)
      const resultTrial = Array.isArray(resultUnit.trials) ? (resultUnit.trials as Json[]).find(t => t.ordinal === ordinal) : undefined
      const run = isObject(trial.run) ? trial.run : null
      const compact = run === null ? null : { planPresent: run.planPresent, termination: isObject(run.termination) ? run.termination.status : null, steps: run.stepCount, selected: run.selectedCount,
        conflicts: run.conflictCount, generatedSelected: run.generatedSelected, supportNotSelected: Array.isArray(run.supportNotSelected) ? run.supportNotSelected.length : null,
        generatedConflictsWithSupport: run.generatedConflictsWithSupport, generatedCommitment: isObject(run.generatedCommitment) ? run.generatedCommitment.status : null }
      if (!resultTrial || resultTrial.preflight !== trial.preflight || resultTrial.fullRuns !== trial.fullRunsStarted || !same(resultTrial.verdict, trial.verdict) || !same(resultTrial.run, compact)) issues.push(`${at}: the Phase B RESULT trial summary differs from the record trial`)
    }
    const support = Array.isArray(task.supportBuildListEntryIds) ? task.supportBuildListEntryIds.map(String) : []
    const t: D1FoundTarget = { targetIndex, label: d1TargetLabel(targetIndex), unitId: at, targetWeaponId: task.targetWeaponId, task: structuredClone(task),
      currentBuildListEntryId: task.currentBuildListEntryId, generatedBuildListEntryId: String(found.generatedBuildListEntryId), supportBuildListEntryIds: support,
      reservationDigest: task.reservationDigest, reservation: structuredClone(r.reservation), excludedRouteKeys: Array.isArray(r.excludedRouteKeys) ? r.excludedRouteKeys.map(String) : [],
      deliveryIndex: d, trialOrdinal: ordinal, candidateStableKey: String(found.candidateStableKey), trial: structuredClone(trial), found: structuredClone(found), search: structuredClone(r.search),
      deliveries: structuredClone(deliveries.slice(0, d + 1)),
      recordFile: { file: `${at}.record.json`, bytes: recordEntry.file.bytes, sha256: recordEntry.file.sha256 }, taskFile: { file: `${at}.task.json`, bytes: taskEntry.file.bytes, sha256: taskEntry.file.sha256 } }
    targets.push(t)
    // The registered §1.3 tables of the D1 document.
    const row = spec.found[targetIndex], trialRow = spec.trials[targetIndex]
    const route = isObject(found.route) ? found.route : null
    const routeOps = route && Array.isArray(route.operations) ? route.operations.length : null
    if (!row || row.t !== t.label || row.targetWeaponId !== t.targetWeaponId || row.unitId !== at || row.rung !== task.rung || !same(row.supportBuildListEntryIds, support)
      || row.reservationDigest !== task.reservationDigest || row.currentBuildListEntryId !== t.currentBuildListEntryId || row.generatedBuildListEntryId !== t.generatedBuildListEntryId
      || row.deliveryIndex !== d || row.routeOperationCount !== routeOps || row.routeKind !== route?.kind) issues.push(`${at}: the derived values differ from the registered §1.3 table`)
    const run = isObject(trial.run) ? trial.run : null
    const commitment = run && isObject(run.generatedCommitment) ? run.generatedCommitment : null
    if (!trialRow || !run || trialRow.t !== t.label || trialRow.planPresent !== run.planPresent || trialRow.termination !== (isObject(run.termination) ? run.termination.status : null)
      || trialRow.completed !== (isObject(run.termination) ? run.termination.completedTargetCount : null) || trialRow.steps !== run.stepCount || trialRow.selected !== run.selectedCount
      || trialRow.conflicts !== run.conflictCount || trialRow.generatedSelected !== run.generatedSelected || trialRow.commitment.status !== commitment?.status
      || trialRow.commitment.provisionalOutcomeSelectedBuildListEntryId !== (commitment?.provisionalOutcomeSelectedBuildListEntryId ?? null)
      || !same(trialRow.supportSelected, run.supportSelected) || trialRow.fullRuns !== trial.fullRunsStarted) issues.push(`${at}: the Phase B trial differs from the registered §1.3 trial table`)
  })
  // A(b): the Phase B G-selected set, derived mechanically (§5.4).
  const aB = targets.filter(t => isObject(t.trial.run) && t.trial.run.generatedSelected === true).map(t => t.targetIndex)
  if (targets.length === D1_TARGETS && !same(aB, D1_A_B_REGISTERED_TARGET_INDEXES)) issues.push(`the Phase B G-selected set ${JSON.stringify(aB)} is not the registered A(b) set`)
  if (new Set(targets.map(t => t.targetWeaponId)).size !== targets.length || !same(targets.map(t => t.targetWeaponId), sortedIds(targets.map(t => t.targetWeaponId)))) issues.push('the Targets are not distinct and in ascending ID order')
  return { passed: issues.length === 0, issues, targets: issues.length === 0 ? targets : [] }
}

// ---------------------------------------------------------------- R: re-delivery (§3)

export class D1InvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'D1InvariantError' }
}

/**
 * §3.2-2/3: the Phase B `runPhase2C27BUnit()` checks against the child's own re-derived schedule (policy drift, rung extent,
 * budget, Plan step bound, ladder state, K <= 1 context fields, current Entry, origin digest, excluded Route key, group
 * reservation and its digest), then the re-derived reservation and excluded keys equal to the Phase B record. Any failure is a
 * `redelivery_mismatch`; no Search runs.
 */
export function checkD1RedeliveryContext(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C27BUnitTask, recorded: { reservation: unknown; excludedRouteKeys: readonly string[] },
  dependencies: PlannerDependencies): { status: 'ready'; prepared: Phase2C27BPreparedContext } | { status: 'mismatch'; issues: string[] } {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule)]
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, phase2c27bRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (!same(task.budget, { maxCandidateTrialsPerTarget: PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget, maxPlannerReruns: PHASE2C27B_LADDER_BUDGET.maxPlannerReruns })) issues.push('budget is not the registered ladder budget')
  if (task.researchMaxPlanSteps !== PHASE2C27B_RESEARCH_MAX_PLAN_STEPS || input.options.maxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (input.conflictResolutions.length !== 0) issues.push('the baseline PlannerInput carries a conflict resolution')
  issues.push(...phase2c27bLadderStateIssues(task.ladderStateAtStart).map(i => `ladderStateAtStart: ${i}`))
  const built = buildPhase2C27BTargetPlans(schedule, [task.targetWeaponId])
  issues.push(...built.issues)
  const plan = built.plans[0]
  const context = plan?.contexts.find(c => c.contextRank === task.contextRank)
  if (plan && plan.checkpointBlocked) issues.push('a checkpoint-blocked Target has no unit')
  if (plan && plan.currentBuildListEntryId !== task.currentBuildListEntryId) issues.push('currentBuildListEntryId')
  if (!context) issues.push(`P1 rank ${task.contextRank} is not a K <= 1 context`)
  else {
    if (phase2c27bUnitId(task.targetIndex, task.contextRank, task.rung) !== task.unitId) issues.push('unitId')
    for (const field of ['groupIndex', 'reservationDigest', 'cardinality', 'representativeFixedSetId', 'supportBuildListEntryIds'] as const) if (!same(context[field], task[field])) issues.push(field)
  }
  if (issues.length > 0 || !plan || !context) return { status: 'mismatch', issues }
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const group = schedule.snapshot.reservationGroups[context.groupIndex]
  if (!snapshotTarget || !group) return { status: 'mismatch', issues: ['the snapshot Target or group is missing'] }
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, context.supportBuildListEntryIds)
  if (resolved.status !== 'ready') return { status: 'mismatch', issues: resolved.issues }
  const prepared = resolved.prepared
  if (hashStableValue(prepared.origin) !== schedule.snapshot.originDigest) issues.push('the Planner-start origin does not hash to the snapshot origin digest')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) issues.push('the current Entry differs')
  if (prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) issues.push('the excluded current Route key differs')
  if (stableStringify(prepared.reservation) !== stableStringify(group.reservation) || hashStableValue(prepared.reservation) !== task.reservationDigest) issues.push('the re-derived reservation is not the group reservation')
  if (stableStringify(prepared.reservation) !== stableStringify(recorded.reservation ?? null)) issues.push('the re-derived reservation is not the Phase B record reservation')
  if (stableStringify(prepared.excludedRouteKeys) !== stableStringify(recorded.excludedRouteKeys)) issues.push('the re-derived excluded Route keys are not the Phase B record ones')
  return issues.length > 0 ? { status: 'mismatch', issues } : { status: 'ready', prepared }
}

export interface D1RedeliveryExpectation {
  /** Phase B record deliveries 0..d: stable key and the reservation check `respects`. */
  deliveries: { stableKey: string; respects: boolean }[]
  deliveryIndex: number
  found: { candidateStableKey: string; generatedBuildListEntryId: string; route: unknown; finalBonuses: unknown; restorationBonusScope: unknown; seriesSkillId: unknown; groupSkillId: unknown; estimatedOperationCount: unknown }
  trialReusedExisting: boolean
  search: { deliveredCandidates: number; stoppedByConsumer: boolean }
}

export const D1_REDELIVERY_MATCH_KEYS = ['deliveryPrefix', 'candidateStableKey', 'generatedBuildListEntryId', 'reusedExistingFalse', 'routeOperations', 'candidateResult', 'searchIdentity',
  'searchSummary', 'replacement', 'reservation', 'excludedRouteKeys', 'originDigest'] as const
export type D1RedeliveryMatchKey = typeof D1_REDELIVERY_MATCH_KEYS[number]

export interface D1RedeliveryChildResult {
  status: 'redelivered' | 'redelivery_mismatch'
  unitId: string
  matches: Record<D1RedeliveryMatchKey, boolean>
  mismatches: string[]
  /** The materialized G (only when every match holds); the runner writes it to the G store. */
  generatedEntry: BuildListEntry | null
  searchIdentity: string | null
  originDigest: string | null
  reservationDigest: string | null
  deliveredStableKeys: string[]
  searchSummary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean } | null
  timing: { searchVisitMs: number; materializeMs: number; searchOnlyMs: number }
}

const emptyMatches = (): Record<D1RedeliveryMatchKey, boolean> => Object.fromEntries(D1_REDELIVERY_MATCH_KEYS.map(k => [k, false])) as Record<D1RedeliveryMatchKey, boolean>

/**
 * §3.2-4..7 / §3.3: the Phase B Search input re-run with `visitPlannerAlternativeCandidates()` (no capture policy) up to the
 * recorded delivery index `d`. Deliveries `i < d` are compared only (never trialled); at `i === d` the Candidate is
 * materialized with the unchanged materializer against the baseline Entries and every §3.3 condition is checked. A Search
 * ending before `d` is a mismatch. Typed Search / materialization errors propagate (the caller records them as mismatch).
 */
export async function redeliverD1Candidate(input: PlannerInput, task: Phase2C27BUnitTask, prepared: Phase2C27BPreparedContext, expected: D1RedeliveryExpectation,
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<D1RedeliveryChildResult> {
  const now = options.now ?? (() => performance.now())
  const matches = emptyMatches()
  const mismatches: string[] = []
  const check = (key: D1RedeliveryMatchKey, ok: boolean, detail: string) => { matches[key] = ok; if (!ok) mismatches.push(`${key}: ${detail}`) }
  const searchInput = { origin: prepared.origin, targetWeaponId: task.targetWeaponId as never, extent: { ...task.extent }, reservation: prepared.reservation, excludedRouteKeys: [...prepared.excludedRouteKeys] }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: dependencies.clock })
  const searchIdentity = createPlannerAlternativeSearchIdentity(searchInput)
  const d = expected.deliveryIndex
  const delivered: string[] = []
  let prefixOk = true
  let generated: { entry: BuildListEntry; reusedExisting: boolean } | null = null
  let candidateAtD: PlannerAlternativeCandidate | null = null
  let materializeMs = 0
  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, dependencies.rngEngine, async (candidate: PlannerAlternativeCandidate) => {
    const i = delivered.length
    const key = candidateStableKey(candidate)
    delivered.push(key)
    // The Phase B delivery summary (the reservation check is computed exactly as Phase B did, on an Entry materialized against []).
    const summary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(candidate, []).entry, input, dependencies.rngEngine)
    const respects = respectsPhase2C2Reservation(summary, candidate.route, prepared.reservation).respects
    const want = expected.deliveries[i]
    if (!want || want.stableKey !== key || want.respects !== respects) prefixOk = false
    if (i < d) return 'continue'
    const started = now()
    generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    materializeMs = now() - started
    candidateAtD = candidate
    return 'stop'
  }, { yieldControl: options.yieldControl })
  const searchVisitMs = now() - visitStarted
  const searchSummary = { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
    stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer }
  const g = generated as { entry: BuildListEntry; reusedExisting: boolean } | null
  const c = candidateAtD as PlannerAlternativeCandidate | null
  check('deliveryPrefix', prefixOk && delivered.length === d + 1 && c !== null, `delivered ${delivered.length} Candidate(s), the recorded prefix 0..${d} ${prefixOk ? 'matched so far' : 'differs'}`)
  check('searchSummary', searchSummary.deliveredCandidates === d + 1 && searchSummary.stoppedByConsumer === true
    && expected.search.deliveredCandidates === d + 1 && expected.search.stoppedByConsumer === true, `summary ${JSON.stringify(searchSummary)}`)
  check('reservation', true, '')
  check('excludedRouteKeys', true, '')
  const originDigest = hashStableValue(prepared.origin)
  check('originDigest', true, '')
  if (c === null || g === null) {
    for (const key of ['candidateStableKey', 'generatedBuildListEntryId', 'reusedExistingFalse', 'routeOperations', 'candidateResult', 'searchIdentity', 'replacement'] as const) check(key, false, 'the Search ended before the recorded delivery index')
    return { status: 'redelivery_mismatch', unitId: task.unitId, matches, mismatches, generatedEntry: null, searchIdentity, originDigest, reservationDigest: hashStableValue(prepared.reservation),
      deliveredStableKeys: delivered, searchSummary, timing: { searchVisitMs, materializeMs, searchOnlyMs: searchVisitMs - materializeMs } }
  }
  const f = expected.found
  check('candidateStableKey', candidateStableKey(c) === f.candidateStableKey && candidateStableKey(g.entry.candidateSnapshot) === f.candidateStableKey, 'the delivered / snapshot stable key is not the found key')
  check('generatedBuildListEntryId', g.entry.id === f.generatedBuildListEntryId, `G ${g.entry.id}`)
  check('reusedExistingFalse', g.reusedExisting === false && expected.trialReusedExisting === false, 'reusedExisting is not false')
  check('routeOperations', stableStringify(c.route.operations) === stableStringify((f.route as { operations?: unknown })?.operations ?? null)
    && c.route.kind === (f.route as { kind?: unknown })?.kind && c.route.sourceOwnedWeaponId === (f.route as { sourceOwnedWeaponId?: unknown })?.sourceOwnedWeaponId, 'the Route differs')
  check('candidateResult', same(c.finalBonuses, f.finalBonuses) && c.restorationBonusScope === f.restorationBonusScope && c.seriesSkillId === f.seriesSkillId && c.groupSkillId === f.groupSkillId
    && c.estimatedOperationCount === f.estimatedOperationCount, 'the Candidate result differs')
  // The generated Entry ID is derived from the Search identity and the Candidate meaning: its equality is the identity check (§3.3).
  check('searchIdentity', g.entry.id === f.generatedBuildListEntryId && task.targetWeaponId === g.entry.targetWeaponId, 'the Search / materialization identity differs')
  const replacement = resolveBuildListEntryReplacement(input.buildListEntries, g.entry)
  check('replacement', replacement.status === 'ready' && replacement.replacement.replacedBuildListEntryId === task.currentBuildListEntryId, `replacement ${replacement.status}`)
  const ok = Object.values(matches).every(Boolean)
  return { status: ok ? 'redelivered' : 'redelivery_mismatch', unitId: task.unitId, matches, mismatches, generatedEntry: ok ? structuredClone(g.entry) : null, searchIdentity, originDigest,
    reservationDigest: hashStableValue(prepared.reservation), deliveredStableKeys: delivered, searchSummary, timing: { searchVisitMs, materializeMs, searchOnlyMs: searchVisitMs - materializeMs } }
}

/** The §3.3 expectation of one found Target, from its Phase B record only. */
export function d1RedeliveryExpectation(target: D1FoundTarget): D1RedeliveryExpectation {
  const f = target.found
  return {
    deliveries: target.deliveries.map(dl => ({ stableKey: String(dl.stableKey), respects: isObject(dl.reservationCheck) && dl.reservationCheck.respects === true })),
    deliveryIndex: target.deliveryIndex,
    found: { candidateStableKey: target.candidateStableKey, generatedBuildListEntryId: target.generatedBuildListEntryId, route: f.route, finalBonuses: f.finalBonuses,
      restorationBonusScope: f.restorationBonusScope, seriesSkillId: f.seriesSkillId, groupSkillId: f.groupSkillId, estimatedOperationCount: f.estimatedOperationCount },
    trialReusedExisting: target.trial.reusedExisting === true,
    search: { deliveredCandidates: Number(target.search.deliveredCandidates), stoppedByConsumer: target.search.stoppedByConsumer === true },
  }
}

// ---------------------------------------------------------------- one evaluation run (§4)

/** One `G_t` an evaluation uses: the G store body and what the runner registered about it. */
export interface D1EvaluationReplacementTask {
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntrySha256: string
  /** The G store file name in the run dir (the child reads and SHA-checks it before the evaluation). */
  generatedEntryFile?: string
  /** `requiresSupport(G_t)` (the Phase B context's support Entries). */
  requiresSupport: string[]
  /** The Phase B task reservation digest and record reservation (S5). */
  phaseBReservationDigest: string
  phaseBReservation: unknown
}

export interface D1EvaluationTask {
  evaluationId: string
  stage: D1Stage
  evaluatedAgainst: D1EvaluatedAgainst
  /** Ascending by Target ID (= Target index). Empty for B0. */
  replacements: D1EvaluationReplacementTask[]
  researchMaxPlanSteps: number
  fullRunCap: number
}

export interface D1ConflictFact {
  id: string
  kind: string
  participants: string[]
  selectedBuildListEntryId: string | null
  recommendedBuildListEntryId: string | null
  resourceIdentity: string | null
  resourceIdentityMatched: boolean
}

export interface D1SupportCheckFacts { S1: boolean; S2: boolean; S3: boolean; S4: boolean; S5: boolean }

/** The Phase B `trialRunSummary()` shape of one G (S parity; the same fields and definitions). */
export interface D1TrialRunSummary {
  planPresent: boolean
  termination: { status: string; completedTargetCount: number; totalTargetCount: number; reachedLimits: string[] }
  stepCount: number | null
  selectedCount: number | null
  conflictCount: number
  warningKinds: string[]
  generatedSelected: boolean
  supportSelected: string[]
  supportNotSelected: string[]
  generatedConflictsWithSupport: boolean
  generatedCommitment: { status: string; provisionalOutcomeSelectedBuildListEntryId: string | null; rejectionReasons: string[] } | null
}

export interface D1StepProjection {
  order: number
  operationType: string
  targetWeaponId: string | null
  buildListEntryId: string | null
  progressedTargetWeaponIds: string[] | null
  rngAdvance: unknown
}

export interface D1EvaluationFacts {
  preflight: { status: string; refusal: string | null }
  /** The resolutions the full run received (G1: always 0). */
  runConflictResolutions: number
  fullRunsStarted: number
  runtimeUnsupportedRemoved: string[]
  plan: { present: boolean; termination: D1TrialRunSummary['termination'] | null; steps: number | null; selectedBuildListEntryIds: string[]; warningKinds: string[] }
  conflicts: D1ConflictFact[]
  routeCommitment: { buildListEntryId: string; role: 'generated' | 'support'; status: string | null; provisionalOutcomeSelectedBuildListEntryId: string | null; rejectionReasons: string[] }[]
  /** Per support Entry required by the set (S1..S5). */
  supportChecks: Record<string, D1SupportCheckFacts>
  /** S only: Phase B's trial summary and verdict of the single G. */
  trialRunSummary: D1TrialRunSummary | null
  trialVerdict: { status: 'found_R'; generatedSelected: boolean } | { status: 'rejected'; reason: string } | null
  /** B0 only: the Phase 2-C2 baseline summary of this run. */
  baselineSummary: Phase2C2BaselineSummary | null
  steps: D1StepProjection[]
  resultDigest: string
}

export type D1EvaluationChildResult =
  | ({ status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' } & D1EvaluationFacts)
  | { status: 'calculation_error'; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; issues: string[] }

/** §9.4 `inputDigest`. */
export function d1InputDigest(targetWeaponIds: readonly string[], generatedEntryIds: readonly string[], generatedEntrySha256s: readonly string[], exportSha256: string): string {
  return hashStableValue({ T: [...targetWeaponIds], generatedBuildListEntryIds: [...generatedEntryIds], generatedEntrySha256s: [...generatedEntrySha256s], exportSha256,
    researchMaxPlanSteps: D1_RESEARCH_MAX_PLAN_STEPS, conflictResolutions: [] })
}

/** §9.4 `resultDigest` of an evaluated run (Clock / ID / display fields excluded). */
export function d1ResultDigest(facts: Pick<D1EvaluationFacts, 'plan' | 'conflicts' | 'steps' | 'fullRunsStarted' | 'runtimeUnsupportedRemoved'>): string {
  return hashStableValue({
    planPresent: facts.plan.present,
    termination: facts.plan.termination,
    selectedBuildListEntryIds: sortedIds(facts.plan.selectedBuildListEntryIds),
    warningKinds: [...facts.plan.warningKinds].sort(compare),
    conflicts: [...facts.conflicts].sort((a, b) => compare(a.id, b.id)).map(c => ({ id: c.id, kind: c.kind, participants: sortedIds(c.participants),
      selectedBuildListEntryId: c.selectedBuildListEntryId, recommendedBuildListEntryId: c.recommendedBuildListEntryId })),
    stepCount: facts.steps.length,
    steps: facts.steps,
    fullRunsStarted: facts.fullRunsStarted,
    runtimeUnsupportedRemoved: sortedIds(facts.runtimeUnsupportedRemoved),
  })
}

/** Phase B `trialRunSummary()` (same definitions) for one G and its support. */
export function d1TrialRunSummary(result: PlannerResult, commitment: PlannerRouteCommitmentEvidence | null, generated: string, support: readonly string[]): D1TrialRunSummary {
  const plan = result.plan
  const selected = new Set<string>(plan?.selectedBuildListEntryIds ?? [])
  const entry = commitment?.entries.find(e => e.buildListEntryId === generated)
  return {
    planPresent: plan !== null,
    termination: { status: result.termination.status, completedTargetCount: result.termination.completedTargetCount, totalTargetCount: result.termination.totalTargetCount,
      reachedLimits: [...result.termination.reachedLimits] },
    stepCount: plan === null ? null : plan.steps.length, selectedCount: plan === null ? null : plan.selectedBuildListEntryIds.length,
    conflictCount: result.conflicts.length, warningKinds: [...new Set(result.warnings.map(w => w.kind))].sort(compare),
    generatedSelected: selected.has(generated), supportSelected: support.filter(id => selected.has(id)), supportNotSelected: support.filter(id => !selected.has(id)),
    generatedConflictsWithSupport: result.conflicts.some(c => c.buildListEntryIds.includes(generated as BuildListEntryId) && c.buildListEntryIds.some(id => support.includes(id))),
    generatedCommitment: entry === undefined ? null : { status: entry.status, provisionalOutcomeSelectedBuildListEntryId: entry.provisionalOutcome?.selectedBuildListEntryId ?? null,
      rejectionReasons: [...entry.rejectionReasons] },
  }
}

const RUNTIME_UNSUPPORTED_MESSAGE = /^BuildListEntry '([^']+)' requires unsupported RNG input /

/**
 * The Entries the runtime-unsupported retry of `generatePlanFromFullRun()` removed: the `rng_prediction_unsupported` warnings of
 * the result that the validation of the run input does not itself produce. Fails closed unless their number is exactly one per
 * retry (`fullRunsStarted - 1`, the retry adds exactly one Entry per extra run) and every one names an Entry of the run input.
 */
export function d1RuntimeUnsupportedRemoved(runInput: PlannerInput, runContext: PlannerRunBuildListContext, result: PlannerResult, fullRunsStarted: number, dependencies: PlannerDependencies): string[] {
  if (fullRunsStarted <= 1) return []
  const validation = new Set(validatePlannerInput(runInput, dependencies, runContext).warnings.filter(w => w.kind === 'rng_prediction_unsupported').map(w => w.message))
  const removed = result.warnings.filter(w => w.kind === 'rng_prediction_unsupported' && !validation.has(w.message)).map(w => RUNTIME_UNSUPPORTED_MESSAGE.exec(w.message)?.[1] ?? null)
  const ids = new Set(runInput.buildListEntries.map(e => e.id as string))
  if (removed.length !== fullRunsStarted - 1 || removed.some(id => id === null || !ids.has(id))) {
    throw new D1InvariantError(`the runtime-unsupported retries (${fullRunsStarted - 1}) do not match the runtime warnings ${JSON.stringify(removed)}`)
  }
  return sortedIds(removed as string[])
}

const stepProjection = (result: PlannerResult): D1StepProjection[] => (result.plan?.steps ?? []).map(step => ({ order: step.order, operationType: step.operationType,
  targetWeaponId: step.targetWeaponId ?? null, buildListEntryId: step.buildListEntryId ?? null,
  progressedTargetWeaponIds: step.progressedTargetWeaponIds === undefined ? null : [...step.progressedTargetWeaponIds], rngAdvance: structuredClone(step.rngAdvance) }))

/**
 * One evaluation run (§4.1): B0 is the baseline full run (`persisted`); every other evaluation replaces each `O_t` of `T` by the
 * G store body `G_t` through the unchanged preflight (no fixed constraint) and full runner (fresh budget of 8). Records the §4.2
 * facts only; R5, parity and the baseline diff are judged from them by the runner and, independently, the analyzer.
 * A D1 invariant (replacement, G1, G store body, S4 / S5) is a guardrail violation; any other thrown error (Plan generation,
 * Trace Replay, prediction, Planner / Search invariant) is a calculation error.
 */
export async function runD1Evaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D1EvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void> } = {}): Promise<D1EvaluationChildResult> {
  try {
    return await evaluate(input, exportBuildListEntries, task, generatedEntries, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'calculation_error', error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function evaluate(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D1EvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void> }): Promise<D1EvaluationChildResult> {
  if (input.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) throw new D1InvariantError('the Research maxPlanSteps is not 20000')
  if (task.fullRunCap !== D1_EVALUATION_FULL_RUN_CAP) throw new D1InvariantError('the evaluation full run cap is not 8')
  if ((task.stage === 'B0') !== (task.replacements.length === 0)) throw new D1InvariantError('only B0 has no replacement')
  if (generatedEntries.length !== task.replacements.length) throw new D1InvariantError('the G store bodies do not match the replacements')
  const budget = createPhase2C27BLadderRerunBudget(D1_EVALUATION_FULL_RUN_CAP, 0)
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, { yieldControl: options.yieldControl })

  // B0: the baseline itself (§5.1), no preflight.
  if (task.stage === 'B0') {
    const runContext: PlannerRunBuildListContext = { kind: 'persisted' }
    const run = await runner.run(input, runContext)
    if (run === 'rerun_budget_reached') return finishFacts('planner_rerun_bound_reached', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, null, null, [], [], dependencies, null)
    return finishFacts('evaluated', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, run.result, run.routeCommitment, [], [], dependencies, null)
  }

  const replacements: BuildListEntryReplacement[] = []
  const T = new Set(task.replacements.map(r => r.targetWeaponId))
  if (!same(task.replacements.map(r => r.targetWeaponId), sortedIds([...T])) || T.size !== task.replacements.length) throw new D1InvariantError('the replacement Targets are not distinct and ascending')
  task.replacements.forEach((r, index) => {
    const g = generatedEntries[index]!
    if (g.id !== r.generatedBuildListEntryId || g.targetWeaponId !== r.targetWeaponId) throw new D1InvariantError(`the G store body of ${r.targetWeaponId} is not the registered G`)
    const resolved = resolveBuildListEntryReplacement(input.buildListEntries, g)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== r.currentBuildListEntryId) throw new D1InvariantError(`the G of ${r.targetWeaponId} does not replace its O`)
    replacements.push(resolved.replacement)
  })
  const support = [...new Set(task.replacements.flatMap(r => r.requiresSupport))].sort(compare)
  // S4 / S5 (static): the support Entry is the Export's and still derives the Phase B reservation.
  for (const supportId of support) {
    const inInput = input.buildListEntries.find(e => e.id === supportId)
    const inExport = exportBuildListEntries.find(e => isObject(e) && e.id === supportId)
    if (!inInput || inExport === undefined || stableStringify(inInput) !== stableStringify(inExport)) throw new D1InvariantError(`S4: the support Entry ${supportId} is not the Export body`)
    for (const r of task.replacements.filter(x => x.requiresSupport.includes(supportId))) {
      const reservation = derivePlannerAlternativeReservation([inInput], dependencies.rngEngine)
      if (hashStableValue(reservation) !== r.phaseBReservationDigest || stableStringify(reservation) !== stableStringify(r.phaseBReservation ?? null)) throw new D1InvariantError(`S5: the support Entry ${supportId} no longer derives the Phase B reservation`)
    }
  }
  const baselineContext = preparePlannerInitialContext(input, dependencies)
  if (baselineContext.status !== 'ready') throw new D1InvariantError('the baseline initial context is not ready')
  const contexts = createPlannerConflictContexts(baselineContext.context)
  const sortedGenerated = [...generatedEntries].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  const augmented: PlannerInput = { ...input, buildListEntries: [...input.buildListEntries, ...sortedGenerated] }
  const preflight = preparePlannerReplacementConflictPreflight(augmented, replacements, [], contexts, dependencies)
  const runContext: PlannerRunBuildListContext = { kind: 'temporary_replacement', replacements }
  if (preflight.status !== 'ready') {
    return finishFacts('preflight_refused', { status: preflight.status, refusal: JSON.stringify(preflight).slice(0, 2000) }, 0, 0, augmented, runContext, null, null, task.replacements, support, dependencies, null)
  }
  if (preflight.resolvedInput.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the evaluation run received a conflict resolution')
  const run = await runner.run(preflight.resolvedInput, runContext)
  const verdictOf = (result: PlannerResult, commitment: PlannerRouteCommitmentEvidence | null) => {
    if (task.stage !== 'S') return null
    const only = task.replacements[0]!
    const verdict = judgePlannerAlternativeTrial(result, { generatedBuildListEntryId: only.generatedBuildListEntryId as BuildListEntryId, explicitDecisionBuildListEntryIds: only.requiresSupport as BuildListEntryId[],
      fixedRouteBuildListEntryIds: only.requiresSupport as BuildListEntryId[], routeCommitment: commitment })
    return verdict.status === 'found' ? { status: 'found_R' as const, generatedSelected: verdict.generatedSelected } : { status: 'rejected' as const, reason: verdict.reason }
  }
  if (run === 'rerun_budget_reached') return finishFacts('planner_rerun_bound_reached', { status: 'ready', refusal: null }, 0, budget.used, preflight.resolvedInput, runContext, null, null, task.replacements, support, dependencies, null)
  return finishFacts('evaluated', { status: 'ready', refusal: null }, preflight.resolvedInput.conflictResolutions.length, budget.used, preflight.resolvedInput, runContext, run.result, run.routeCommitment,
    task.replacements, support, dependencies, verdictOf(run.result, run.routeCommitment))
}

function finishFacts(status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached', preflight: { status: string; refusal: string | null }, runConflictResolutions: number,
  fullRunsStarted: number, runInput: PlannerInput, runContext: PlannerRunBuildListContext, result: PlannerResult | null, commitment: PlannerRouteCommitmentEvidence | null,
  replacements: readonly D1EvaluationReplacementTask[], support: readonly string[], dependencies: PlannerDependencies,
  trialVerdict: D1EvaluationFacts['trialVerdict']): D1EvaluationChildResult {
  const runtimeUnsupportedRemoved = result === null ? [] : d1RuntimeUnsupportedRemoved(runInput, runContext, result, fullRunsStarted, dependencies)
  // The final run input (after the runtime-unsupported retry), as `generatePlanFromFullRun()` builds it.
  const removed = new Set(runtimeUnsupportedRemoved)
  const finalInput: PlannerInput = removed.size === 0 ? runInput : { ...runInput, buildListEntries: runInput.buildListEntries.filter(e => !removed.has(e.id)) }
  const finalContext: PlannerRunBuildListContext = removed.size === 0 || runContext.kind === 'persisted' ? runContext
    : { kind: 'temporary_replacement', replacements: runContext.replacements.filter(r => !removed.has(r.generatedBuildListEntryId)) }
  const finalInitial = status === 'preflight_refused' ? null : preparePlannerInitialContext(finalInput, dependencies, finalContext)
  const resourceById = new Map<string, string>()
  if (finalInitial?.status === 'ready') for (const c of createPlannerConflictContexts(finalInitial.context)) resourceById.set(c.conflictId, plannerConflictResourceKey(c.resourceIdentity))
  const plan = result?.plan ?? null
  const conflicts: D1ConflictFact[] = (result?.conflicts ?? []).map((c: PlanConflict) => ({ id: c.id, kind: c.kind, participants: sortedIds(c.buildListEntryIds),
    selectedBuildListEntryId: c.selectedBuildListEntryId, recommendedBuildListEntryId: c.recommendedBuildListEntryId,
    resourceIdentity: resourceById.get(c.id) ?? null, resourceIdentityMatched: resourceById.has(c.id) }))
  const roleOf = new Map<string, 'generated' | 'support'>([...replacements.map(r => [r.generatedBuildListEntryId, 'generated'] as const), ...support.map(id => [id, 'support'] as const)])
  const routeCommitment = [...roleOf.entries()].sort(([a], [b]) => compare(a, b)).map(([id, role]) => {
    const e = commitment?.entries.find(x => x.buildListEntryId === id)
    return { buildListEntryId: id, role, status: e?.status ?? null, provisionalOutcomeSelectedBuildListEntryId: e?.provisionalOutcome?.selectedBuildListEntryId ?? null, rejectionReasons: e ? [...e.rejectionReasons] : [] }
  })
  const T = new Set(replacements.map(r => r.targetWeaponId))
  const supportChecks: Record<string, D1SupportCheckFacts> = {}
  for (const id of support) {
    const entry = runInput.buildListEntries.find(e => e.id === id)
    // S4 / S5 already held (or the evaluation would have stopped as a guardrail violation).
    supportChecks[id] = { S1: entry !== undefined && !T.has(entry.targetWeaponId), S2: finalInput.buildListEntries.some(e => e.id === id),
      S3: finalInitial?.status === 'ready' && finalInitial.context.entriesById.has(id as BuildListEntryId), S4: true, S5: true }
  }
  const only = replacements.length === 1 ? replacements[0]! : null
  const facts: D1EvaluationFacts = {
    preflight, runConflictResolutions, fullRunsStarted, runtimeUnsupportedRemoved,
    plan: { present: plan !== null, termination: result === null ? null : { status: result.termination.status, completedTargetCount: result.termination.completedTargetCount,
      totalTargetCount: result.termination.totalTargetCount, reachedLimits: [...result.termination.reachedLimits] }, steps: plan === null ? null : plan.steps.length,
      selectedBuildListEntryIds: sortedIds(plan?.selectedBuildListEntryIds ?? []), warningKinds: [...new Set((result?.warnings ?? []).map(w => w.kind))].sort(compare) },
    conflicts, routeCommitment, supportChecks,
    trialRunSummary: trialVerdict !== null && result !== null && only !== null ? d1TrialRunSummary(result, commitment, only.generatedBuildListEntryId, only.requiresSupport) : null,
    trialVerdict,
    baselineSummary: replacements.length === 0 && result !== null ? summarizePhase2C2Baseline(runInput, result) : null,
    steps: result === null ? [] : stepProjection(result),
    resultDigest: '',
  }
  facts.resultDigest = d1ResultDigest(facts)
  return { status, ...facts }
}

// ---------------------------------------------------------------- R5 (§4.4), parity (§5.1 / §5.2) and the per-evaluation judgement

export type D1EvaluationStatus = 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'calculation_error' | 'not_executed'
export const D1_MEASURED_STATUSES: readonly D1EvaluationStatus[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached']

export interface D1R5Judgement {
  judged: boolean
  conditions: { allGeneratedSelected: boolean | null; allSupportSelected: boolean | null; supportDependenciesValid: boolean | null; noConflictWithinSet: boolean | null; planAndTraceReplayOk: boolean | null }
  satisfied: boolean | null
  failureReasons: string[]
  supportVacuous: boolean
}

export interface D1R5Input {
  status: D1EvaluationStatus
  evaluatedAgainst: D1EvaluatedAgainst
  generatedBuildListEntryIds: readonly string[]
  requiresSupport: readonly string[]
  facts: Pick<D1EvaluationFacts, 'plan' | 'conflicts' | 'supportChecks'> | null
}

/** §4.4 R5, judged only for `replacement_set` evaluations that are measured. */
export function judgeD1R5(input: D1R5Input): D1R5Judgement {
  const nulls = { allGeneratedSelected: null, allSupportSelected: null, supportDependenciesValid: null, noConflictWithinSet: null, planAndTraceReplayOk: null }
  const supportVacuous = input.requiresSupport.length === 0
  if (input.evaluatedAgainst !== 'replacement_set' || !D1_MEASURED_STATUSES.includes(input.status) || input.facts === null) {
    return { judged: false, conditions: nulls, satisfied: null, failureReasons: [], supportVacuous }
  }
  const failures: string[] = []
  const f = input.facts
  if (input.status === 'preflight_refused' || input.status === 'planner_rerun_bound_reached' || !f.plan.present) {
    failures.push(input.status === 'evaluated' ? 'no_plan' : input.status)
    return { judged: true, conditions: { ...nulls, planAndTraceReplayOk: false }, satisfied: false, failureReasons: failures, supportVacuous }
  }
  const selected = new Set(f.plan.selectedBuildListEntryIds)
  const notSelected = input.generatedBuildListEntryIds.filter(id => !selected.has(id))
  const allGeneratedSelected = notSelected.length === 0
  if (!allGeneratedSelected) failures.push(`generated_not_selected:${sortedIds(notSelected).join(',')}`)
  const allSupportSelected = input.requiresSupport.every(id => selected.has(id))
  if (!allSupportSelected) failures.push('support_not_selected')
  const supportDependenciesValid = input.requiresSupport.every(id => { const c = f.supportChecks[id]; return c !== undefined && c.S1 && c.S2 && c.S3 })
  if (!supportDependenciesValid) failures.push('support_expired_R')
  const M = new Set([...input.generatedBuildListEntryIds, ...input.requiresSupport])
  const noConflictWithinSet = !f.conflicts.some(c => c.participants.filter(id => M.has(id)).length >= 2)
  if (!noConflictWithinSet) failures.push('conflict_within_set')
  const planAndTraceReplayOk = f.plan.termination !== null && (f.plan.termination.status === 'completed' || f.plan.termination.status === 'exhausted')
  if (!planAndTraceReplayOk) failures.push('plan_bound_truncated')
  const satisfied = allGeneratedSelected && allSupportSelected && supportDependenciesValid && noConflictWithinSet && planAndTraceReplayOk
  return { judged: true, conditions: { allGeneratedSelected, allSupportSelected, supportDependenciesValid, noConflictWithinSet, planAndTraceReplayOk }, satisfied, failureReasons: failures, supportVacuous }
}

/** §6.2: bound-limited evaluations (never a non-coexistence observation). */
export function isD1BoundLimited(status: D1EvaluationStatus, facts: Pick<D1EvaluationFacts, 'plan'> | null): boolean {
  return status === 'planner_rerun_bound_reached' || (status === 'evaluated' && facts?.plan.termination?.status === 'incomplete')
}

/** §5.1: the B0 parity against the Phase 2-C2 baseline summary. */
export function d1B0Parity(summary: Phase2C2BaselineSummary | null, registered: unknown): { compared: string[]; matched: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  const reg = isObject(registered) ? registered : {}
  if (summary === null) return { compared: [...B0_PARITY_FIELDS], matched: false, mismatches: ['no baseline summary'] }
  for (const field of B0_PARITY_FIELDS) if (!same((summary as unknown as Json)[field], reg[field])) mismatches.push(field)
  return { compared: [...B0_PARITY_FIELDS], matched: mismatches.length === 0, mismatches }
}

/** §5.2: the S parity against the Phase B trial of the found Candidate. */
export function d1SParity(facts: Pick<D1EvaluationFacts, 'preflight' | 'runConflictResolutions' | 'fullRunsStarted' | 'trialRunSummary' | 'trialVerdict'> | null, phaseBTrial: Json):
  { compared: string[]; matched: boolean; mismatches: string[] } {
  const compared = ['preflight', 'resolution', 'fullRunsStarted', 'run', 'verdict']
  if (facts === null) return { compared, matched: false, mismatches: ['no facts'] }
  const mismatches: string[] = []
  if (facts.preflight.status !== 'ready' || phaseBTrial.preflight !== 'ready' || phaseBTrial.preflightRefusal !== null) mismatches.push('preflight')
  if (facts.runConflictResolutions !== 0 || phaseBTrial.trialConflictResolutions !== 0) mismatches.push('resolution')
  if (facts.fullRunsStarted !== phaseBTrial.fullRunsStarted) mismatches.push('fullRunsStarted')
  if (!same(facts.trialRunSummary, phaseBTrial.run)) mismatches.push('run')
  if (!same(facts.trialVerdict, phaseBTrial.verdict)) mismatches.push('verdict')
  return { compared, matched: mismatches.length === 0, mismatches }
}

/** §5.2 R1..R4 (`evaluatedAgainst = baseline`), diagnostic only. */
export function d1R1R4(status: D1EvaluationStatus, facts: Pick<D1EvaluationFacts, 'plan' | 'conflicts' | 'preflight'> | null, generatedId: string, support: readonly string[], reusedExisting: boolean) {
  const R1 = !reusedExisting && facts !== null && facts.preflight.status === 'ready' && status === 'evaluated' && facts.plan.present
  const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
  const jointConflict = (facts?.conflicts ?? []).some(c => c.participants.includes(generatedId) && c.participants.some(id => support.includes(id)))
  const R2 = R1 && support.every(id => selected.has(id)) && !jointConflict
  const R3 = R1 && selected.has(generatedId)
  return { R1, R2, R3, R4: R2 && R3, supportVacuous: support.length === 0 }
}

// ---------------------------------------------------------------- start attestation and Production audit (§9.2)

export const D1_START_ATTESTATION_FILE = 'start-attestation.json'
export const D1_START_ATTESTATION_PHASE = 'Issue #154 D1-B runner start attestation'

/** Research / test paths that are not Production calculation sources (the Phase B rule, unchanged). */
export function isD1ResearchOrTestPath(path: string): boolean {
  return path.startsWith('src/benchmarks/') || path.startsWith('src/test/') || path.startsWith('scripts/') || path.startsWith('docs/')
    || /\.test\.tsx?$/.test(path) || path.startsWith('.github/')
}
export const d1ProductionChangedFiles = (changed: readonly string[]): string[] => [...new Set(changed.filter(path => path.length > 0 && !isD1ResearchOrTestPath(path)))].sort(compare)

export function d1RegisteredConditions() {
  return {
    specFile: D1_SPEC_FILE,
    baseMain: D1_BASE_MAIN,
    phaseBProvenance: { ...D1_PHASE_B_PROVENANCE },
    registeredInputs: structuredClone(D1_REGISTERED_INPUTS) as unknown,
    foundUnits: D1_FOUND_UNITS.map(u => ({ ...u })),
    aBRegisteredTargetIndexes: [...D1_A_B_REGISTERED_TARGET_INDEXES],
    stages: d1RegisteredEvaluations().map(e => ({ evaluationId: e.evaluationId, stage: e.stage, evaluatedAgainst: e.evaluatedAgainst, targetIndexes: e.targetIndexes, candidateIndex: e.candidateIndex })),
    order: ['V', 'R t00..t10', 'B0', 'S t00..t10', 'P (i, j) lexicographic', 'A-a', 'A-b', 'A-c-01..11'],
    researchMaxPlanSteps: D1_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D1_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D1_CALCULATION_CONTEXT },
    executionEnvelope: { ...D1_EXECUTION_ENVELOPE },
    r5Definition: [...D1_R5_DEFINITION],
    supportChecks: [...D1_SUPPORT_CHECKS],
    decisionRule: [...D1_DECISION_RULE],
    phaseBResultFieldsRead: [...D1_PHASE_B_RESULT_ALLOWLIST],
    provenanceFlags: { ...D1_PROVENANCE_FLAGS },
    notRun: [...D1_NOT_RUN],
  }
}

export interface D1LaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  /** The D1 document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  /** The observed digest of every registered input (V checks them against the registered ones). */
  observedInputs: Record<string, D1ObservedFile | null>
  exportFileName: string
  productionAudit: { baseMain: string; baseMainIsAncestor: boolean; productionChangedSinceBaseMain: string[] }
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  appliedExecutionEnvelope: { redeliveryBudgetMs: number; evaluationBudgetMs: number; childHeapMb: number; concurrency: number; retry: string; fallback: string; memorySampleIntervalMs: number; nodeYield: string }
  smoke: { redeliveryTargetIndexes: number[] | null; maxEvaluations: number | null; budgetMs: number | null } | null
}

export type D1StartAttestation = ReturnType<typeof d1RegisteredConditions> & D1LaunchObservation & { phase: string; attestedBy: 'runner' }

export function d1StartAttestationBody(observation: D1LaunchObservation): D1StartAttestation {
  return { phase: D1_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d1RegisteredConditions(), ...observation }
}

const EMPTY_D1_OBSERVATION: D1LaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  observedInputs: {}, exportFileName: '', productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null }, appliedExecutionEnvelope: { ...D1_EXECUTION_ENVELOPE }, smoke: null }
const D1_ATTESTATION_KEYS = Object.keys(d1StartAttestationBody(EMPTY_D1_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D1AttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  /** The Export SHA-256 the Phase B start attestation names (`d1ChainedExportSha256()`). */
  exportSha256: string | null
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D1 launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / benchmark code / D1 document
 * equal to the independently obtained ones, every observed input equal to the registered digest, Production changed files = []
 * with the base main an ancestor, a clean non-smoke launch, and every registered condition unchanged.
 */
export function verifyD1StartAttestation(attestation: unknown, expected: D1AttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D1_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D1_START_ATTESTATION_PHASE) issues.push('not a D1-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D1_REGISTERED_INPUTS) as [string, D1RegisteredFile][]) {
    const o = observed[key]
    const want = registered.sha256 ?? expected.exportSha256
    if (!isObject(o) || want === null || o.sha256 !== want || (registered.bytes !== null && o.bytes !== registered.bytes)) issues.push(`the observed ${key} is not the registered input`)
  }
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || audit.baseMain !== D1_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D1_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D1_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d1RegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
