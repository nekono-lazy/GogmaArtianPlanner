/**
 * Issue #154 D2-B: K0-first Candidate discovery, R1 admission and set evaluation (R5 + the non-regression gate). Research only.
 * Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md` (D2-A, PR #225), attested by the runner at the measurement
 * HEAD. D2 discovers up to `POOL_CAP = 3` K0 Candidates per E1 Target and evaluates them with the unchanged Production Planner
 * parts, in the registered order:
 *
 * ```text
 * V    the registered inputs (digests, the Phase B / D1 RESULT allowlists, the D1-A §1.3 table, the D1 G store seeds)   parent
 * DSC  per Target L0 -> L1 -> L2 (K0 only): visitPlannerAlternativeCandidates() with no capture policy; each new stable key is
 *        materialized by createPlannerAlternativeMaterializer() against the baseline Entries and written to the G store
 * B0   the baseline PlannerInput, one full run (persisted)
 * ADM  per pooled Candidate: T = { t } (baseline), R1 admission; R2..R4 / found_R / winners are diagnostics only
 * CMP  Target ID order, single pass: every admitted Candidate of t as accepted ∪ { t: c } (replacement_set), R5 + gate, §4.3 order
 * Z    the D1 incumbent { t01, t07, t08, t09 } as a seed (Z0), then the dropped 7 the same way (an independent axis)
 * ```
 *
 * Every evaluation run keeps `conflictResolutions = []` and the preflight fixed constraints `[]` (G1). R1 (ADM, `baseline`) never
 * feeds R5, the gate, the acceptance or the decision (G25). The K1 Candidate of the seed (t09) never enters the K0 discovery, pool or
 * the main axis (G23).
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module and reads the Phase B / D1
 * RESULTs through `projectD2PhaseBResult()` / `projectD2D1Result()` only (the §8.1 allowlists). It names no Target, Entry,
 * reservation digest or stable key: those come from the manifest, the D1-A §1.3 table and the D1 RESULT, each checked against the
 * attested D2-A text.
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
import { preparePlannerReplacementConflictPreflight } from '../domain/planner/replacement/plannerAugmentedPreflight'
import { createPlannerConflictContexts, plannerConflictResourceKey } from '../domain/planner/replacement/plannerConflictContext'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeCandidate, type PlannerAlternativeSearchExtent } from '../domain/search'
import {
  d1RuntimeUnsupportedRemoved,
  d1ResultDigest,
  d1TrialRunSummary,
  parseD1SpecTables,
  D1_CALCULATION_CONTEXT,
  D1_EVALUATION_FULL_RUN_CAP,
  D1_PHASE_B_PROVENANCE,
  D1_R5_DEFINITION,
  D1_RESEARCH_MAX_PLAN_STEPS,
  D1_RNG_ENGINE_VERSION,
  D1_SUPPORT_CHECKS,
  D1InvariantError,
  type D1ConflictFact,
  type D1EvaluationFacts,
  type D1StepProjection,
  type D1SupportCheckFacts,
} from './plannerGlobalD1'
import { respectsPhase2C2Reservation, summarizePhase2C2Baseline, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C27BTargetPlans,
  createPhase2C27BLadderRerunBudget,
  parsePhase2C27BTargetManifest,
  phase2c27bPolicyDrift,
  phase2c27bResolveSupportContext,
  phase2c27bRungExtent,
  PHASE2C27B_LADDER,
  PHASE2C27B_RUNG_IDS,
  type Phase2C27BPreparedContext,
  type Phase2C27BRungId,
} from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const pad = (value: number) => String(value).padStart(2, '0')
const sortedIds = (ids: readonly string[]) => [...ids].sort(compare)
/** Whether a document names a SHA-256 in full or as `<first 8>…<a suffix of 4 or more>` (the D2-A abbreviation). */
export const d2NamesSha256 = (text: string, sha: string) => text.includes(sha)
  || [...text.matchAll(new RegExp(`${sha.slice(0, 8)}…([0-9a-f]{4,})`, 'g'))].some(m => sha.endsWith(m[1]!))

// ---------------------------------------------------------------- registered before the formal run (D2-A §2 - §11, §14, §15)

export const D2_PHASE = 'Issue #154 D2'
export const D2_RESULT_PHASE = 'Issue #154 D2: K0-first candidate discovery and set evaluation (post-hoc analysis)'
/** The D2-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§8.1) and attested. */
export const D2_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md'
/** The main of D2-B's start (PR #225 merged): the Production audit counts changes since this commit. */
export const D2_BASE_MAIN = '6d626b71a4f8de3250ce8c5835add6f7cbfd2f4e'

export const D2_D1_PROVENANCE = Object.freeze({
  measuredHead: '74886ef596ef774b6540b6516913a27074781d00',
  decisionCase: 'D1_FOUND_R_SET_PARTIAL',
  aCFinalAccepted: Object.freeze([1, 7, 8, 9]),
} as const)

/**
 * One registered input. `sha256: null` is the Export only: its digest is reached through the authority chain (the Phase B RESULT
 * `sources.export`, the D1 RESULT `sources.export` and the manifest must agree and the attested D2-A text must name it), so the
 * Export digest is written in no Research source but the oracle's (the Phase 2-A.5 isolation rule, kept from D1).
 */
export interface D2RegisteredFile { file: string; bytes: number | null; sha256: string | null }

/** §8.1: every input D2 reads, by path relative to the repository root (the Export is an external path argument). */
export const D2_REGISTERED_INPUTS = Object.freeze({
  export: { file: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: null },
  phaseBTargets: { file: '.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local', bytes: 967, sha256: 'd4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de' },
  phaseBResult: { file: 'docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json', bytes: 808_015, sha256: 'd79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4' },
  phase2c2Result: { file: 'docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json', bytes: 1_195_107, sha256: 'afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4' },
  d1Result: { file: 'docs/PLANNER_GLOBAL_D1_RESULT.json', bytes: 1_588_705, sha256: 'b846363fb5cfc9b9e31b8ae655faaf8b6a17f0be7d715fd42e63ed56ff35c971' },
  phaseADocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md', bytes: null, sha256: 'b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147' },
  phaseBDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md', bytes: null, sha256: 'e05eea56d3c9c8cdeae1f086e9ca6b2a4fa326fd1e9de87914e120a4488dff9c' },
  followupDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md', bytes: null, sha256: '335a6710d49bcdc1a9ef05a822a9931f40610c714561ae665ac008e82b987083' },
  d1SpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md', bytes: null, sha256: '39974cbbdb7ab81c88bd3edf006796ccf6184c2744e23d61b705fb16f35a359f' },
  d1bDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1B.md', bytes: null, sha256: '536f8cd4073a880e27aab84c8b0c7e3339b6b669ef65889e982813bcab72fb4f' },
} satisfies Record<string, D2RegisteredFile>)
export type D2RegisteredInputKey = keyof typeof D2_REGISTERED_INPUTS

/** §5 / §8.1: the D1 G store bodies used as the Z seed (D1 RESULT `sources.d1.generatedEntries`), by the D1 unit that wrote them. */
export const D2_D1_RUN_DIR = '.local/d1-formal2.run'
export interface D2RegisteredSeedFile { unitId: string; targetIndex: number; bytes: number; sha256: string }
export const D2_SEED_FILES: readonly D2RegisteredSeedFile[] = Object.freeze([
  { unitId: 't01-r01-L1', targetIndex: 1, bytes: 66_309, sha256: '3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14' },
  { unitId: 't07-r01-L1', targetIndex: 7, bytes: 170_990, sha256: '27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f' },
  { unitId: 't08-r01-L2', targetIndex: 8, bytes: 222_523, sha256: '825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc' },
  { unitId: 't09-r10-L1', targetIndex: 9, bytes: 168_914, sha256: '52f36e8ea65b189755c76cb87b7eb88024bfcd752dacd2ab58a1f20945148ccf' },
].map(row => Object.freeze(row)))
export const d2SeedFileName = (unitId: string) => `${unitId}.generated-entry.json`

export const D2_TARGETS = 11
export const D2_POOL_CAP = 3
export const D2_RESEARCH_MAX_PLAN_STEPS = 20_000
/** §6.3: the Research per-evaluation full Planner run cap (the Production number, without the request-global meaning; G5). */
export const D2_EVALUATION_FULL_RUN_CAP = 8
export const D2_CALCULATION_CONTEXT = Object.freeze({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
export const D2_RNG_ENGINE_VERSION = 'production-rng:c5-e7'

/** §2.1 / §6.3: the registered ladder (Normal / Gogma / Skill), the Phase B one. */
export const D2_LADDER: readonly { id: Phase2C27BRungId; extent: PlannerAlternativeSearchExtent }[] = Object.freeze([
  Object.freeze({ id: 'L0' as const, extent: Object.freeze({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }) }),
  Object.freeze({ id: 'L1' as const, extent: Object.freeze({ maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }) }),
  Object.freeze({ id: 'L2' as const, extent: Object.freeze({ maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }) }),
])

/** §7.2: one execution envelope (a Research measurement envelope, never a Production timeout; G7). */
export const D2_EXECUTION_ENVELOPE = Object.freeze({
  discoveryUnitBudgetMs: 60 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  runBudgetMs: 12 * 60 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

/** §6.3: the registered budgets (each independent; never a Production bound, G5). */
export const D2_BUDGETS = Object.freeze({
  contextsPerTarget: 1,
  discoveryUnitsPerTarget: 3,
  discoveryUnitsMax: 33,
  poolCap: D2_POOL_CAP,
  uniqueCandidatesMax: 33,
  deliveriesPerUnitMax: 3,
  admissionEvaluationsMax: 33,
  compositionMainEvaluationsMax: 33,
  compositionSeededEvaluationsMax: 22,
  b0Evaluations: 1,
  evaluationRequestsMax: 89,
  evaluationFullRunCap: D2_EVALUATION_FULL_RUN_CAP,
  researchMaxPlanSteps: D2_RESEARCH_MAX_PLAN_STEPS,
} as const)

/** §9.1: the fixed comparison values (completed / Conflict / steps). The D1 RESULT must hold them (V). */
export const D2_COMPARISON_BASELINES = Object.freeze({
  baseline: Object.freeze({ evaluationId: 'B0', completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d1Incumbent: Object.freeze({ evaluationId: 'A-b', completed: 22, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
})

export const D2_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  phaseBResultModified: false,
  d1ResultModified: false,
  oracleGuidedTargetPopulation: true,
  inheritsOracleInformedExtentLadder: true,
  inheritsOracleInformedExecutionEnvelope: true,
  speculativeSupportWrittenAsResolution: false,
  k1SupportInDiscovery: false,
  seededAxisUsesD1Incumbent: true,
  seededAxisIncludesK1Candidate: true,
  productionSemanticsChanged: false,
} as const)

/** §8.1: the only Phase B RESULT fields D2 reads. */
export const D2_PHASE_B_RESULT_ALLOWLIST = Object.freeze([
  'sources.{export,targets}',
  'provenance.{formal,measuredHead,runStatus,calculationCodeChangedSinceMeasuredHead}',
  'decision.case',
  'units[].contextRank (to select the K0 units)',
  'units[contextRank=1].{unitId,targetIndex,contextRank,rung,result,search,deliveries[].{i,keySha256,cost,action,respectsReservation}}',
])
/** §8.1: the only D1 RESULT fields D2 reads. */
export const D2_D1_RESULT_ALLOWLIST = Object.freeze([
  'sources',
  'provenance.{formal,measuredHead,runStatus,calculationCodeChangedSinceMeasuredHead,startAttestation.sha256}',
  'decision.case',
  'evaluations[].{evaluationId,stage,evaluatedAgainst,replacementTargets,generatedEntryIds,generatedEntrySha256s,status,inputDigest,resultDigest,plan.termination,plan.steps,conflicts (count),r5.satisfied}',
  'redelivery[].generatedEntry',
  'aggregates.aCFinalAccepted',
])
/**
 * The D1-A document fields D2 reads: the §1.3 registered table, which D2-A §2.3 names as the registered `O_t` and §5 as the t09
 * support Entry / reservation digest (every value is also checked against the attested D2-A text where D2-A writes it).
 */
export const D2_D1_SPEC_FIELDS_READ = Object.freeze(['§1.3 found table: t, TargetWeapon ID, support Entry, reservationDigest, O_t (current Entry)'])

/** §9: the decision orders, checked top to bottom. */
export const D2_DECISION_RULE = Object.freeze([
  'D2A_INVALID: any formal validity violation (§7.3 / §8): a parity mismatched on either axis, input_evidence / provenance / phase_b_k0_parity / d1_parity / baseline_parity_mismatch / guardrail / determinism / evidence_integrity / raw_result_mismatch',
  'D2A_INCOMPLETE: invalid 0 and a main-axis (DSC / B0 / ADM / CMP) unit or evaluation is unmeasured or not_executed (Z0 / Z never make the main axis incomplete); measured evidence is a lower bound',
  'D2A_GLOBAL_COMPLETE_R: invalid 0, unmeasured 0, finalResult satisfies R6',
  'D2A_EXCEEDS_D1_INCUMBENT: |final accepted| >= 1 and finalResult is better than the D1 incumbent (22 / 21)',
  'D2A_IMPROVED_OVER_BASELINE: finalResult is better than the baseline (20 / 21); equalsD1IncumbentMetrics when it equals 22 / 21',
  'D2A_NO_IMPROVEMENT: invalid 0, unmeasured 0, none of the above (accepting nothing included)',
])
export const D2_SEEDED_DECISION_RULE = Object.freeze([
  'null: the whole run is D2A_INVALID (a Z0 / Z parity mismatch included)',
  'D2A_Z_INCOMPLETE: Z0 (parity not_checked), a registered Z evaluation, or a DSC / ADM of the dropped 7 Z depends on is unmeasured or not_executed',
  'D2A_Z_GLOBAL_COMPLETE_R: the Z final result satisfies R6',
  'D2A_Z_EXTENDS_D1_INCUMBENT: at least one Target accepted beyond the seed (the gate keeps completed >= 22)',
  'D2A_Z_NO_EXTENSION: none of the above',
])
/** "(a, b) is better than (c, d)": completed larger, or completed equal and Conflicts fewer (steps never compared). */
export const D2_BETTER_RULE = 'completed larger, or completed equal and fewer Conflicts (steps are not compared)'

export const D2_DISCOVERY_RULE = Object.freeze([
  'K0 only (empty reservation), rungs L0 -> L1 -> L2, one fresh child per (Target, rung)',
  'consumer: a stable key already in pool(t) -> duplicate_of_lower_rung (continue, not pooled, not materialized); otherwise materialize against the baseline Entries, write the G store body, pool it; stop when |pool(t)| = 3',
  'unit outcome: consumer stop -> discovery_cap_reached; summary.exhausted -> discovery_exhausted; summary.stoppedByExtent -> stopped_by_search_extent_bound (ladder_exhausted at L2); timeout / OOM / process failure / interrupted -> unmeasured; typed error -> discovery_calculation_error',
  'escalate to the next rung only after stopped_by_search_extent_bound with |pool(t)| < 3; found_R, G-not-selected or target_regressed_R never remove a Candidate',
])
export const D2_ADMISSION_RULE = Object.freeze([
  'one ADM-<t>-c<ordinal> per pooled Candidate, T = { t }, evaluatedAgainst = baseline, Target ID then discovery ordinal order',
  'R1 = reusedExisting === false ∧ replacement ready with replacedBuildListEntryId === O_t ∧ preflight ready ∧ status evaluated ∧ plan !== null ∧ termination.status in { completed, exhausted }',
  'reusedExisting === true -> not_run_reused_existing (measured, R1 false); R2 / R3 / R4 / target_regressed_R / found_R / winners / co-participants are diagnostics only',
])
export const D2_COMPOSITION_RULE = Object.freeze([
  'accepted = [], reference = B0; t00 -> t10 single pass',
  'a Target whose discovery or any ADM is unmeasured / not_executed -> step_unmeasured (dependency_unmeasured), no evaluation, afterUnmeasuredStep for the later steps',
  'no admitted Candidate -> not_replaced_no_admitted',
  'every admitted Candidate c (ordinal order, no early stop): CMP-<t>-c<ordinal> evaluates accepted ∪ { t: c } as one replacement_set run',
  'eligible(c) = evaluated ∧ R5 of the whole proposed set ∧ completed(proposed) >= completed(reference)',
  'any evaluation unmeasured / not_executed -> step_unmeasured; eligible empty -> not_replaced_no_eligible; otherwise the first eligible by the selection order is accepted and becomes the reference',
  'finalResult = the last accepted evaluation (B0 when none); no extra run',
])
export const D2_GATE_RULE = 'completed(proposed) >= completed(reference) (termination.completedTargetCount); R5 without the gate is r5OnlyEligible (diagnostic)'
export const D2_SELECTION_ORDER = Object.freeze(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
export const D2_SEEDED_AXIS_RULE = Object.freeze([
  'seed = the D1 final accepted { t01, t07, t08, t09 } G store bodies (t09 is a K1 Candidate: requiresSupport = the D1-A §1.3 t09 support Entry)',
  'Z0 evaluates the seed (replacement_set): inputDigest = D1 A-b, resultDigest = D1 A-b and R5 satisfied, else mismatched',
  'then the dropped 7 (the Targets outside the seed) in Target ID order with their D2 admitted K0 Candidates, the §4.1 step from accepted = seed, reference = Z0',
  'S_sup = the t09 support Entry: S1 - S3 dynamic (support_expired_R), S4 / S5 static (D2A_INVALID)',
])
export const D2_R6_DEFINITION = Object.freeze([
  '(1) status evaluated, plan !== null, Trace Replay completed',
  '(2) termination.status === completed and completedTargetCount === totalTargetCount === 43',
  '(3) result.conflicts.length === 0',
  '(4) no plan.rejectedBuildListEntries element with reason resource_conflict',
  '(5) R5 satisfied',
])
export const D2_ORDER = Object.freeze(['V', 'DSC t00 -> t10 (L0 -> L1 -> L2 per Target)', 'B0', 'ADM (Target ID, discovery ordinal)', 'CMP t00 -> t10', 'Z0', 'Z (dropped 7, Target ID order)'])
/** What D2 deliberately does not run (§2.1 / §13). */
export const D2_NOT_RUN = Object.freeze(['k1_context_search', 'k2_context_search', 'e2_search', 'residual_3', 'population_expansion', 'oracle_comparison', 'phase_b_result_rewrite',
  'd1_result_rewrite', 'multiple_passes', 'composition_order_change', 'simultaneous_replacement_search', 'pool_cap_expansion', 'resolution_synthesis', 'repair_lineage', 'persistence',
  'retry', 'fallback', 'production_change', 'production_default_change', 'alternative_to_alternative_support'])
/**
 * S5 as D2 can check it: the Phase B record reservation body (D1-A §4.5 S5, second half) is not a D2 input (§8.1), so S5 is the
 * registered digest of the D1-A §1.3 t09 row (named by D2-A §5) of the reservation the Export support Entry derives.
 */
export const D2_SUPPORT_CHECKS = Object.freeze([...D1_SUPPORT_CHECKS.slice(0, 4),
  'S5 static (D2): hashStableValue(derivePlannerAlternativeReservation([support from the Export])) is the D1-A §1.3 / D2-A §5 registered reservationDigest (the Phase B record body is not a D2 input)'])

// ---------------------------------------------------------------- labels, IDs and the registered order

export const d2TargetLabel = (index: number) => `t${pad(index)}`
export const d2DiscoveryUnitId = (index: number, rung: Phase2C27BRungId) => `DSC-${d2TargetLabel(index)}-${rung}`
/** The Phase B K0 unit (P1 rank 1) of the same (Target, rung). */
export const d2PhaseBK0UnitId = (index: number, rung: Phase2C27BRungId) => `${d2TargetLabel(index)}-r01-${rung}`
export const d2AdmissionId = (index: number, ordinal: number) => `ADM-${d2TargetLabel(index)}-c${ordinal}`
export const d2CompositionId = (index: number, ordinal: number) => `CMP-${d2TargetLabel(index)}-c${ordinal}`
export const d2SeededId = (index: number, ordinal: number) => `Z-${d2TargetLabel(index)}-c${ordinal}`
export const d2PoolFileName = (index: number, ordinal: number) => `${d2TargetLabel(index)}-c${ordinal}.generated-entry.json`
export const d2RungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...D2_LADDER.find(r => r.id === rung)!.extent })

export function d2PolicyDrift(): string[] {
  const issues: string[] = []
  if (!same(D2_LADDER.map(r => [r.id, r.extent]), PHASE2C27B_LADDER.map(r => [r.id, r.extent]))) issues.push('the D2 ladder is not the Phase B registered ladder')
  if (!same(PHASE2C27B_RUNG_IDS, D2_LADDER.map(r => r.id))) issues.push('the rung IDs are not L0 / L1 / L2')
  if (D2_RESEARCH_MAX_PLAN_STEPS !== D1_RESEARCH_MAX_PLAN_STEPS || D2_EVALUATION_FULL_RUN_CAP !== D1_EVALUATION_FULL_RUN_CAP) issues.push('the D2 run bounds are not the D1 ones')
  if (!same(D2_CALCULATION_CONTEXT, D1_CALCULATION_CONTEXT) || D2_RNG_ENGINE_VERSION !== D1_RNG_ENGINE_VERSION) issues.push('the CalculationContext / Engine is not the D1 one')
  return issues
}

// ---------------------------------------------------------------- discovery (§2.3): unit outcome and rung escalation

export type D2DiscoveryMeasuredStatus = 'discovery_cap_reached' | 'stopped_by_search_extent_bound' | 'discovery_exhausted' | 'ladder_exhausted'
export type D2DiscoveryUnitStatus = D2DiscoveryMeasuredStatus | 'discovery_calculation_error' | 'guardrail_violation' | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'not_executed'
export const D2_DISCOVERY_MEASURED: readonly D2DiscoveryUnitStatus[] = ['discovery_cap_reached', 'stopped_by_search_extent_bound', 'discovery_exhausted', 'ladder_exhausted']
export type D2DiscoveryStop = 'discovery_cap_reached' | 'discovery_exhausted' | 'ladder_exhausted' | 'unmeasured' | 'not_executed'

/** §2.3: the typed outcome of one measured unit, checked top to bottom. */
export function d2DiscoveryUnitOutcome(search: { exhausted: boolean; stoppedByExtent: boolean }, stoppedByConsumer: boolean, rung: Phase2C27BRungId): D2DiscoveryMeasuredStatus {
  if (stoppedByConsumer) return 'discovery_cap_reached'
  if (search.exhausted) return 'discovery_exhausted'
  if (search.stoppedByExtent) return rung === 'L2' ? 'ladder_exhausted' : 'stopped_by_search_extent_bound'
  throw new D1InvariantError('the Search ended with neither a consumer stop, exhaustion nor an extent bound')
}

/**
 * §2.3: after one unit, the next rung of the same Target or the Target's discovery stop. Only an extent-bound unit with a pool
 * below `POOL_CAP` escalates; an unmeasured / calculation error / not executed unit stops the Target (no escalation, G6 / G11).
 */
export function d2DiscoveryNext(status: D2DiscoveryUnitStatus, rung: Phase2C27BRungId, poolSize: number): { next: Phase2C27BRungId | null; stop: D2DiscoveryStop | null } {
  if (status === 'discovery_cap_reached' || status === 'discovery_exhausted' || status === 'ladder_exhausted') return { next: null, stop: status }
  if (status === 'stopped_by_search_extent_bound') {
    const index = PHASE2C27B_RUNG_IDS.indexOf(rung)
    if (poolSize >= D2_POOL_CAP) throw new D1InvariantError('an extent-bound unit with a full pool')
    const next = PHASE2C27B_RUNG_IDS[index + 1] ?? null
    return next === null ? { next: null, stop: 'ladder_exhausted' } : { next, stop: null }
  }
  if (status === 'not_executed') return { next: null, stop: 'not_executed' }
  return { next: null, stop: 'unmeasured' }
}

export interface D2DiscoveryTask {
  unitId: string
  targetIndex: number
  label: string
  targetWeaponId: string
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  /** `O_t`: the D1-A §1.3 registered current Entry. */
  currentBuildListEntryId: string
  /** The registered K0 (empty) reservation digest. */
  k0ReservationDigest: string
  /** `candidateStableKey()` of every pooled Candidate before this unit, in discovery order. */
  poolKeysAtStart: string[]
  poolCap: number
  researchMaxPlanSteps: number
}

/**
 * §2.3 / §12: the K0 context re-derived the Phase B way (the B2-C1 schedule, its K <= 1 plan of the Target, rank 1 = K0 with no
 * support, `phase2c27bResolveSupportContext(…, [])`) and checked: no policy drift, the rung extent, the Research bound, no
 * resolution, the Planner-start origin digest, the current Entry = the registered `O_t`, the excluded current Route key, the
 * reservation = the K0 group reservation whose digest is the registered K0 digest. Any failure is an invariant violation.
 */
export function prepareD2K0Context(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: D2DiscoveryTask, dependencies: PlannerDependencies):
  { status: 'ready'; prepared: Phase2C27BPreparedContext } | { status: 'mismatch'; issues: string[] } {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule), ...d2PolicyDrift()]
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, d2RungExtent(task.rung)) || !same(task.extent, phase2c27bRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (task.unitId !== d2DiscoveryUnitId(task.targetIndex, task.rung) || task.label !== d2TargetLabel(task.targetIndex)) issues.push('unitId / label')
  if (task.researchMaxPlanSteps !== D2_RESEARCH_MAX_PLAN_STEPS || input.options.maxPlanSteps !== D2_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (task.poolCap !== D2_POOL_CAP || task.poolKeysAtStart.length >= D2_POOL_CAP || new Set(task.poolKeysAtStart).size !== task.poolKeysAtStart.length) issues.push('the pool at start is not below POOL_CAP and distinct')
  if (input.conflictResolutions.length !== 0) issues.push('the baseline PlannerInput carries a conflict resolution')
  const built = buildPhase2C27BTargetPlans(schedule, [task.targetWeaponId])
  issues.push(...built.issues)
  const plan = built.plans[0]
  const k0 = plan?.contexts.find(c => c.contextRank === 1)
  if (plan && plan.checkpointBlocked) issues.push('a checkpoint-blocked Target')
  if (plan && plan.currentBuildListEntryId !== task.currentBuildListEntryId) issues.push('the schedule current Entry is not the registered O_t')
  if (!k0 || k0.cardinality !== 0 || k0.supportBuildListEntryIds.length !== 0) issues.push('P1 rank 1 is not the K0 context')
  else if (k0.reservationDigest !== task.k0ReservationDigest) issues.push('the K0 context reservation digest is not the registered K0 digest')
  if (issues.length > 0 || !plan || !k0) return { status: 'mismatch', issues }
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const group = schedule.snapshot.reservationGroups[k0.groupIndex]
  if (!snapshotTarget || !group) return { status: 'mismatch', issues: ['the snapshot Target or group is missing'] }
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, [])
  if (resolved.status !== 'ready') return { status: 'mismatch', issues: resolved.issues }
  const prepared = resolved.prepared
  if (hashStableValue(prepared.origin) !== schedule.snapshot.originDigest) issues.push('the Planner-start origin does not hash to the snapshot origin digest')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) issues.push('the current Entry is not the registered O_t')
  if (prepared.excludedRouteKeys.length !== 1 || prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) issues.push('the excluded current Route key differs')
  if (prepared.supportBuildListEntryIds.length !== 0) issues.push('a support Entry in the K0 discovery (G23)')
  if (stableStringify(prepared.reservation) !== stableStringify(group.reservation) || hashStableValue(prepared.reservation) !== task.k0ReservationDigest) issues.push('the re-derived reservation is not the registered K0 reservation')
  return issues.length > 0 ? { status: 'mismatch', issues } : { status: 'ready', prepared }
}

export type D2DeliveryAction = 'pooled' | 'duplicate_of_lower_rung'
export interface D2DiscoveryDelivery {
  indexInUnit: number
  candidateStableKey: string
  cost: number
  action: D2DeliveryAction
  reservationCheck: { respects: boolean }
}
export interface D2PooledCandidate {
  /** 1-based discovery ordinal of the Target (rung, then delivery order). */
  ordinal: number
  indexInUnit: number
  candidateStableKey: string
  cost: number
  routeKind: string
  routeOperationCount: number
  reservationCheck: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  searchIdentity: string
  generatedBuildListEntryId: string
  reusedExisting: boolean
  replacement: { status: string; replacedBuildListEntryId: string | null }
  /** The G store body (the child script writes it to the run dir and drops it from the record). */
  generatedEntry: BuildListEntry | null
}

export type D2DiscoveryChildResult =
  | { status: D2DiscoveryMeasuredStatus; unitId: string; poolSizeAtStart: number; deliveries: D2DiscoveryDelivery[]; pooled: D2PooledCandidate[]; searchIdentity: string;
      originDigest: string; reservationDigest: string; excludedRouteKeys: string[];
      search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean; skippedExcludedRouteKeys: number };
      timing: { searchVisitMs: number; materializeMs: number; searchOnlyMs: number } }
  | { status: 'discovery_calculation_error'; unitId: string; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; unitId: string; issues: string[] }

/**
 * One discovery unit (§2.3): the Production Search at the rung extent with the K0 reservation and the current Route excluded, no
 * capture policy, no reordering. A stable key already pooled at a lower rung is `duplicate_of_lower_rung`; every other delivery is
 * materialized against the baseline Entries (the unchanged materializer, never from `route.operations`) and pooled until the
 * pool holds `POOL_CAP`. The reservation check (R0) is computed for every delivery exactly as Phase B did. Typed Search /
 * materialization errors become `discovery_calculation_error`.
 */
export async function runD2DiscoveryUnit(input: PlannerInput, prepared: Phase2C27BPreparedContext, task: D2DiscoveryTask, dependencies: PlannerDependencies,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<D2DiscoveryChildResult> {
  try {
    return await discover(input, prepared, task, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', unitId: task.unitId, issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'discovery_calculation_error', unitId: task.unitId, error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function discover(input: PlannerInput, prepared: Phase2C27BPreparedContext, task: D2DiscoveryTask, dependencies: PlannerDependencies,
  options: { yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2DiscoveryChildResult> {
  const now = options.now ?? (() => performance.now())
  if (prepared.supportBuildListEntryIds.length !== 0) throw new D1InvariantError('G23: a support Entry in the K0 discovery')
  const engine = dependencies.rngEngine
  const searchInput = { origin: prepared.origin, targetWeaponId: task.targetWeaponId as never, extent: { ...task.extent }, reservation: prepared.reservation, excludedRouteKeys: [...prepared.excludedRouteKeys] }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: dependencies.clock })
  const searchIdentity = createPlannerAlternativeSearchIdentity(searchInput)
  const prior = new Set(task.poolKeysAtStart)
  const poolSizeAtStart = task.poolKeysAtStart.length
  const deliveries: D2DiscoveryDelivery[] = []
  const pooled: D2PooledCandidate[] = []
  let materializeMs = 0
  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, async (candidate: PlannerAlternativeCandidate) => {
    const indexInUnit = deliveries.length
    const key = candidateStableKey(candidate)
    const started = now()
    const summary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(candidate, []).entry, input, engine)
    const reservationCheck = respectsPhase2C2Reservation(summary, candidate.route, prepared.reservation)
    if (prior.has(key)) {
      deliveries.push({ indexInUnit, candidateStableKey: key, cost: candidate.estimatedOperationCount, action: 'duplicate_of_lower_rung', reservationCheck: { respects: reservationCheck.respects } })
      materializeMs += now() - started
      return 'continue'
    }
    const generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    const replacement = resolveBuildListEntryReplacement(input.buildListEntries, generated.entry)
    materializeMs += now() - started
    pooled.push({ ordinal: poolSizeAtStart + pooled.length + 1, indexInUnit, candidateStableKey: key, cost: candidate.estimatedOperationCount, routeKind: candidate.route.kind,
      routeOperationCount: candidate.route.operations.length, reservationCheck: structuredClone(reservationCheck), searchIdentity, generatedBuildListEntryId: generated.entry.id,
      reusedExisting: generated.reusedExisting,
      replacement: replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId } : { status: replacement.status, replacedBuildListEntryId: null },
      generatedEntry: structuredClone(generated.entry) })
    deliveries.push({ indexInUnit, candidateStableKey: key, cost: candidate.estimatedOperationCount, action: 'pooled', reservationCheck: { respects: reservationCheck.respects } })
    return poolSizeAtStart + pooled.length >= task.poolCap ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const searchVisitMs = now() - visitStarted
  const search = { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
    stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length }
  const status = d2DiscoveryUnitOutcome(search, execution.stoppedByConsumer, task.rung)
  return { status, unitId: task.unitId, poolSizeAtStart, deliveries, pooled, searchIdentity, originDigest: hashStableValue(prepared.origin), reservationDigest: hashStableValue(prepared.reservation),
    excludedRouteKeys: [...prepared.excludedRouteKeys], search, timing: { searchVisitMs, materializeMs, searchOnlyMs: searchVisitMs - materializeMs } }
}

// ---------------------------------------------------------------- one evaluation run (§6.1 = D1-A §4.1 / §4.2, plus the D2 records)

export type D2Stage = 'B0' | 'ADM' | 'CMP' | 'Z0' | 'Z'
export type D2Axis = 'main' | 'seeded' | 'none'
export type D2EvaluatedAgainst = 'baseline_reference' | 'baseline' | 'replacement_set'
export const d2EvaluatedAgainst = (stage: D2Stage): D2EvaluatedAgainst => stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set'
export const d2Axis = (stage: D2Stage): D2Axis => stage === 'CMP' ? 'main' : stage === 'Z0' || stage === 'Z' ? 'seeded' : stage === 'ADM' ? 'main' : 'none'

export interface D2ReplacementTask {
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntrySha256: string
  /** The G store file (the child reads it and checks its SHA-256 before the evaluation). */
  generatedEntryFile: string
  /** `requiresSupport(G_t)`: empty for a K0 Candidate; the t09 seed's support Entry. */
  requiresSupport: string[]
  /** The registered reservation digest of the support context (S5), null for K0. */
  supportReservationDigest: string | null
}

export interface D2EvaluationTask {
  evaluationId: string
  stage: D2Stage
  evaluatedAgainst: D2EvaluatedAgainst
  /** Ascending by Target ID. Empty for B0. */
  replacements: D2ReplacementTask[]
  researchMaxPlanSteps: number
  fullRunCap: number
}

export interface D2EvaluationFacts extends D1EvaluationFacts {
  /** `plan.rejectedBuildListEntries` (ID ascending). */
  rejectedBuildListEntries: { buildListEntryId: string; reason: string }[]
  resourceConflictRejections: number
  /** The Targets of `plan.selectedBuildListEntryIds` (ascending). */
  selectedTargetWeaponIds: string[]
}

export type D2EvaluationChildResult =
  | ({ status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' } & D2EvaluationFacts)
  | { status: 'calculation_error'; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; issues: string[] }

/**
 * One evaluation run, the D1-A §4.1 procedure with the same parts in the same order as `runD1Evaluation()` (B0: the persisted
 * baseline, no preflight; otherwise each `O_t` replaced by its G store body, `preparePlannerReplacementConflictPreflight()` with
 * no fixed constraint, `createPlannerAlternativeFullRunner()` with a fresh budget of 8), recording the D1-A §4.2 facts with the D1
 * digests plus the D2 records (§6.1) read from the same `PlannerResult`. ADM carries the Phase B `found_R` diagnostic
 * (`judgePlannerAlternativeTrial()`, explicit decision = fixed Route = support = `[]`). A D2 invariant (replacement, G1, G store
 * body, S4 / S5) is a guardrail violation; any other thrown error is a calculation error.
 */
export async function runD2Evaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2EvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void> } = {}): Promise<D2EvaluationChildResult> {
  try {
    return await evaluate(input, exportBuildListEntries, task, generatedEntries, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'calculation_error', error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function evaluate(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2EvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void> }): Promise<D2EvaluationChildResult> {
  if (input.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2_RESEARCH_MAX_PLAN_STEPS) throw new D1InvariantError('the Research maxPlanSteps is not 20000')
  if (task.fullRunCap !== D2_EVALUATION_FULL_RUN_CAP) throw new D1InvariantError('the evaluation full run cap is not 8')
  if (task.evaluatedAgainst !== d2EvaluatedAgainst(task.stage)) throw new D1InvariantError('evaluatedAgainst is not the stage one')
  if ((task.stage === 'B0') !== (task.replacements.length === 0)) throw new D1InvariantError('only B0 has no replacement')
  if (task.stage === 'ADM' && task.replacements.length !== 1) throw new D1InvariantError('an admission evaluation replaces exactly one Target')
  if (generatedEntries.length !== task.replacements.length) throw new D1InvariantError('the G store bodies do not match the replacements')
  const budget = createPhase2C27BLadderRerunBudget(D2_EVALUATION_FULL_RUN_CAP, 0)
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, { yieldControl: options.yieldControl })

  if (task.stage === 'B0') {
    const runContext: PlannerRunBuildListContext = { kind: 'persisted' }
    const run = await runner.run(input, runContext)
    if (run === 'rerun_budget_reached') return finishD2Facts('planner_rerun_bound_reached', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, null, null, [], [], dependencies, null)
    return finishD2Facts('evaluated', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, run.result, run.routeCommitment, [], [], dependencies, null)
  }

  const replacements: BuildListEntryReplacement[] = []
  const T = new Set(task.replacements.map(r => r.targetWeaponId))
  // G15: at most one replacement (one Candidate) per Target in one PlannerInput.
  if (!same(task.replacements.map(r => r.targetWeaponId), sortedIds([...T])) || T.size !== task.replacements.length) throw new D1InvariantError('the replacement Targets are not distinct and ascending')
  task.replacements.forEach((r, index) => {
    const g = generatedEntries[index]!
    if (g.id !== r.generatedBuildListEntryId || g.targetWeaponId !== r.targetWeaponId) throw new D1InvariantError(`the G store body of ${r.targetWeaponId} is not the registered G`)
    const resolved = resolveBuildListEntryReplacement(input.buildListEntries, g)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== r.currentBuildListEntryId) throw new D1InvariantError(`the G of ${r.targetWeaponId} does not replace its O`)
    replacements.push(resolved.replacement)
  })
  const support = [...new Set(task.replacements.flatMap(r => r.requiresSupport))].sort(compare)
  // S4 / S5 (static): the support Entry is the Export's and still derives the registered reservation digest.
  for (const supportId of support) {
    const inInput = input.buildListEntries.find(e => e.id === supportId)
    const inExport = exportBuildListEntries.find(e => isObject(e) && e.id === supportId)
    if (!inInput || inExport === undefined || stableStringify(inInput) !== stableStringify(inExport)) throw new D1InvariantError(`S4: the support Entry ${supportId} is not the Export body`)
    for (const r of task.replacements.filter(x => x.requiresSupport.includes(supportId))) {
      if (r.supportReservationDigest === null || hashStableValue(derivePlannerAlternativeReservation([inInput], dependencies.rngEngine)) !== r.supportReservationDigest) {
        throw new D1InvariantError(`S5: the support Entry ${supportId} no longer derives the registered reservation`)
      }
    }
  }
  if (task.replacements.some(r => r.requiresSupport.length === 0 ? r.supportReservationDigest !== null : r.supportReservationDigest === null)) throw new D1InvariantError('a support reservation digest without a support Entry, or the reverse')
  const baselineContext = preparePlannerInitialContext(input, dependencies)
  if (baselineContext.status !== 'ready') throw new D1InvariantError('the baseline initial context is not ready')
  const contexts = createPlannerConflictContexts(baselineContext.context)
  const sortedGenerated = [...generatedEntries].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  const augmented: PlannerInput = { ...input, buildListEntries: [...input.buildListEntries, ...sortedGenerated] }
  const preflight = preparePlannerReplacementConflictPreflight(augmented, replacements, [], contexts, dependencies)
  const runContext: PlannerRunBuildListContext = { kind: 'temporary_replacement', replacements }
  if (preflight.status !== 'ready') {
    return finishD2Facts('preflight_refused', { status: preflight.status, refusal: JSON.stringify(preflight).slice(0, 2000) }, 0, 0, augmented, runContext, null, null, task.replacements, support, dependencies, null)
  }
  if (preflight.resolvedInput.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the evaluation run received a conflict resolution')
  const run = await runner.run(preflight.resolvedInput, runContext)
  if (run === 'rerun_budget_reached') return finishD2Facts('planner_rerun_bound_reached', { status: 'ready', refusal: null }, 0, budget.used, preflight.resolvedInput, runContext, null, null, task.replacements, support, dependencies, null)
  let verdict: D1EvaluationFacts['trialVerdict'] = null
  if (task.stage === 'ADM') {
    const only = task.replacements[0]!
    const v = judgePlannerAlternativeTrial(run.result, { generatedBuildListEntryId: only.generatedBuildListEntryId as BuildListEntryId, explicitDecisionBuildListEntryIds: only.requiresSupport as BuildListEntryId[],
      fixedRouteBuildListEntryIds: only.requiresSupport as BuildListEntryId[], routeCommitment: run.routeCommitment })
    verdict = v.status === 'found' ? { status: 'found_R', generatedSelected: v.generatedSelected } : { status: 'rejected', reason: v.reason }
  }
  return finishD2Facts('evaluated', { status: 'ready', refusal: null }, preflight.resolvedInput.conflictResolutions.length, budget.used, preflight.resolvedInput, runContext, run.result, run.routeCommitment,
    task.replacements, support, dependencies, verdict)
}

const stepProjection = (result: PlannerResult): D1StepProjection[] => (result.plan?.steps ?? []).map(step => ({ order: step.order, operationType: step.operationType,
  targetWeaponId: step.targetWeaponId ?? null, buildListEntryId: step.buildListEntryId ?? null,
  progressedTargetWeaponIds: step.progressedTargetWeaponIds === undefined ? null : [...step.progressedTargetWeaponIds], rngAdvance: structuredClone(step.rngAdvance) }))

function finishD2Facts(status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached', preflight: { status: string; refusal: string | null }, runConflictResolutions: number,
  fullRunsStarted: number, runInput: PlannerInput, runContext: PlannerRunBuildListContext, result: PlannerResult | null, commitment: PlannerRouteCommitmentEvidence | null,
  replacements: readonly D2ReplacementTask[], support: readonly string[], dependencies: PlannerDependencies, trialVerdict: D1EvaluationFacts['trialVerdict']): D2EvaluationChildResult {
  const runtimeUnsupportedRemoved = result === null ? [] : d1RuntimeUnsupportedRemoved(runInput, runContext, result, fullRunsStarted, dependencies)
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
    supportChecks[id] = { S1: entry !== undefined && !T.has(entry.targetWeaponId), S2: finalInput.buildListEntries.some(e => e.id === id),
      S3: finalInitial?.status === 'ready' && finalInitial.context.entriesById.has(id as BuildListEntryId), S4: true, S5: true }
  }
  const only = replacements.length === 1 ? replacements[0]! : null
  const targetOf = new Map(runInput.buildListEntries.map(e => [e.id as string, e.targetWeaponId as string]))
  const rejected = (plan?.rejectedBuildListEntries ?? []).map(r => ({ buildListEntryId: r.buildListEntryId as string, reason: r.reason as string })).sort((a, b) => compare(a.buildListEntryId, b.buildListEntryId))
  const facts: D2EvaluationFacts = {
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
    rejectedBuildListEntries: rejected,
    resourceConflictRejections: rejected.filter(r => r.reason === 'resource_conflict').length,
    selectedTargetWeaponIds: [...new Set((plan?.selectedBuildListEntryIds ?? []).map(id => targetOf.get(id) ?? `?${id}`))].sort(compare),
  }
  facts.resultDigest = d1ResultDigest(facts)
  return { status, ...facts }
}

// ---------------------------------------------------------------- statuses, R1 / R6, the gate and the selection order (§3 / §4 / §6.4)

export type D2EvaluationStatus = 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' | 'not_run_reused_existing' | 'calculation_error' | 'guardrail_violation'
  | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'not_executed'
/** §6.2: measured evaluation statuses (`not_run_reused_existing` is a measured R1 false). */
export const D2_MEASURED_EVALUATION: readonly D2EvaluationStatus[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
/** §7.3.2: a "comparable result" (normally measured, for parity): a typed calculation error the child recorded is one. */
export const D2_COMPARABLE_EVALUATION: readonly D2EvaluationStatus[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']
export const D2_UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const

/** §3 R1 (D2: termination in { completed, exhausted } and reusedExisting false), and the R2..R4 diagnostics derived from it. */
export function d2R1R4(status: D2EvaluationStatus, facts: Pick<D1EvaluationFacts, 'plan' | 'conflicts' | 'preflight'> | null, generatedId: string, support: readonly string[],
  discovery: { reusedExisting: boolean; replacementReady: boolean }) {
  const termination = facts?.plan.termination?.status
  const conditions = {
    notReusedExisting: !discovery.reusedExisting,
    replacementReady: discovery.replacementReady,
    preflightReady: facts !== null && facts.preflight.status === 'ready',
    evaluated: status === 'evaluated',
    planPresentAndTerminated: facts !== null && facts.plan.present && (termination === 'completed' || termination === 'exhausted'),
  }
  const R1 = Object.values(conditions).every(Boolean)
  const R1FailureReason = R1 ? null : !conditions.notReusedExisting ? 'reused_existing' : !conditions.replacementReady ? 'replacement_not_ready' : !conditions.preflightReady ? (status === 'preflight_refused' ? 'preflight_refused' : 'not_evaluated')
    : !conditions.evaluated ? status : facts?.plan.present !== true ? 'no_plan' : 'plan_bound_truncated'
  const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
  const jointConflict = (facts?.conflicts ?? []).some(c => c.participants.includes(generatedId) && c.participants.some(id => support.includes(id)))
  const R2 = R1 && support.every(id => selected.has(id)) && !jointConflict
  const R3 = R1 && selected.has(generatedId)
  return { R1, R1FailureReason, conditions, R2, R3, R4: R2 && R3, supportVacuous: support.length === 0 }
}

export interface D2R6Judgement {
  judged: boolean
  conditions: { evaluatedPlanAndTraceReplay: boolean | null; allTargetsCompleted: boolean | null; noUnresolvedConflict: boolean | null; noResourceConflictRejection: boolean | null; r5: boolean | null }
  satisfied: boolean | null
}

/** §6.4 R6, judged for `replacement_set` evaluations that are measured. */
export function judgeD2R6(input: { status: string; evaluatedAgainst: D2EvaluatedAgainst; facts: Pick<D2EvaluationFacts, 'plan' | 'conflicts' | 'resourceConflictRejections'> | null; r5Satisfied: boolean | null }): D2R6Judgement {
  const nulls = { evaluatedPlanAndTraceReplay: null, allTargetsCompleted: null, noUnresolvedConflict: null, noResourceConflictRejection: null, r5: null }
  if (input.evaluatedAgainst !== 'replacement_set' || !['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(input.status)) return { judged: false, conditions: nulls, satisfied: null }
  const f = input.facts
  const t = f?.plan.termination ?? null
  const conditions = {
    evaluatedPlanAndTraceReplay: input.status === 'evaluated' && f !== null && f.plan.present,
    allTargetsCompleted: t !== null && t.status === 'completed' && t.completedTargetCount === t.totalTargetCount && t.totalTargetCount === D2_COMPARISON_BASELINES.baseline.totalTargetCount,
    noUnresolvedConflict: f !== null && f.conflicts.length === 0,
    noResourceConflictRejection: f !== null && f.resourceConflictRejections === 0,
    r5: input.r5Satisfied === true,
  }
  return { judged: true, conditions, satisfied: Object.values(conditions).every(v => v === true) }
}

/** §4.2: the non-regression gate. */
export const d2GateSatisfied = (proposedCompleted: number | null, referenceCompleted: number | null): boolean =>
  proposedCompleted !== null && referenceCompleted !== null && proposedCompleted >= referenceCompleted

export interface D2SelectionMetrics { evaluationId: string; ordinal: number; completed: number; conflicts: number; steps: number }
/** §4.3: completed desc, Conflicts asc, steps asc, discovery ordinal asc (a total order). */
export function compareD2Selection(a: D2SelectionMetrics, b: D2SelectionMetrics): number {
  return (b.completed - a.completed) || (a.conflicts - b.conflicts) || (a.steps - b.steps) || (a.ordinal - b.ordinal)
}

export type D2StepOutcome = 'accepted' | 'not_replaced_no_admitted' | 'not_replaced_no_eligible' | 'step_unmeasured'
export interface D2StepEvaluation {
  evaluationId: string
  ordinal: number
  status: D2EvaluationStatus
  r5Satisfied: boolean | null
  completed: number | null
  conflicts: number | null
  steps: number | null
}

/**
 * §4.1 one Target step given its evaluated Candidates (ordinal order) and the reference completed: eligible = evaluated ∧ R5 ∧
 * gate; an unmeasured / not executed evaluation makes the step `step_unmeasured` (the accepted set and the reference kept);
 * otherwise the first eligible by §4.3 is accepted. `r5OnlyEligible` lists the R5-satisfied evaluations the gate refused.
 */
export function d2CompositionStep(evaluations: readonly D2StepEvaluation[], referenceCompleted: number | null):
  { stepOutcome: D2StepOutcome; eligible: string[]; r5OnlyEligible: string[]; chosen: string | null } {
  if (evaluations.length === 0) return { stepOutcome: 'not_replaced_no_admitted', eligible: [], r5OnlyEligible: [], chosen: null }
  const eligible: D2SelectionMetrics[] = []
  const r5OnlyEligible: string[] = []
  for (const e of evaluations) {
    if (e.status !== 'evaluated' || e.r5Satisfied !== true || e.completed === null || e.conflicts === null || e.steps === null) continue
    if (d2GateSatisfied(e.completed, referenceCompleted)) eligible.push({ evaluationId: e.evaluationId, ordinal: e.ordinal, completed: e.completed, conflicts: e.conflicts, steps: e.steps })
    else r5OnlyEligible.push(e.evaluationId)
  }
  const ids = eligible.map(e => e.evaluationId)
  if (evaluations.some(e => !D2_MEASURED_EVALUATION.includes(e.status))) return { stepOutcome: 'step_unmeasured', eligible: ids, r5OnlyEligible, chosen: null }
  if (eligible.length === 0) return { stepOutcome: 'not_replaced_no_eligible', eligible: [], r5OnlyEligible, chosen: null }
  const chosen = [...eligible].sort(compareD2Selection)[0]!.evaluationId
  return { stepOutcome: 'accepted', eligible: ids, r5OnlyEligible, chosen }
}

/** §9.1: "(a, b) is better than (c, d)". */
export const d2Better = (a: { completed: number; conflicts: number }, b: { completed: number; conflicts: number }) =>
  a.completed > b.completed || (a.completed === b.completed && a.conflicts < b.conflicts)

// ---------------------------------------------------------------- the registered tables of the D2-A document (§1.2)

export interface D2SpecK0Row {
  t: string
  rungs: Record<Phase2C27BRungId, 'stopped_by_search_extent_bound' | 'found_R' | 'not_run'>
  firstRung: Phase2C27BRungId | null
  keyPrefix: string | null
  cost: number | null
}

const tableRows = (markdown: string, header: RegExp): string[][] => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => header.test(line))
  if (start < 0) return []
  const rows: string[][] = []
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) rows.push(lines[i]!.split('|').slice(1, -1).map(cell => cell.trim()))
  return rows
}

/** The D2-A §1.2 table of the Phase B K0 units (the registered values; the source holds none of them). */
export function parseD2SpecK0Table(markdown: string): D2SpecK0Row[] {
  const cell = (text: string) => text.startsWith('extent bound') ? 'stopped_by_search_extent_bound' as const : text.startsWith('found_R') ? 'found_R' as const : 'not_run' as const
  return tableRows(markdown, /^\| t \| L0 \| L1 \| L2 \| K0が最初にdeliverしたrung \|/).map(cells => {
    const [t, l0, l1, l2, firstRung, first] = cells
    const key = /^`([0-9a-f]{8})` \/ (\d+)$/.exec(first ?? '')
    return { t: t!, rungs: { L0: cell(l0 ?? ''), L1: cell(l1 ?? ''), L2: cell(l2 ?? '') }, firstRung: (PHASE2C27B_RUNG_IDS as readonly string[]).includes(firstRung ?? '') ? firstRung as Phase2C27BRungId : null,
      keyPrefix: key?.[1] ?? null, cost: key ? Number(key[2]) : null }
  })
}

// ---------------------------------------------------------------- the Phase B / D1 RESULT allowlists (§8.1)

export interface D2PhaseBK0Unit {
  unitId: string
  targetIndex: number
  contextRank: number
  rung: Phase2C27BRungId
  result: string
  search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  deliveries: { i: number; keySha256: string; cost: number; action: string; respectsReservation: boolean }[]
}
export interface D2PhaseBResultProjection {
  sources: { export: unknown; targets: unknown }
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown; calculationCodeChangedSinceMeasuredHead: unknown }
  decisionCase: unknown
  k0Units: D2PhaseBK0Unit[]
}

/** Reads ONLY the allowlisted Phase B RESULT fields (never an oracle-derived field). */
export function projectD2PhaseBResult(json: unknown): D2PhaseBResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !Array.isArray(json.units)) return null
  const s = json.sources, p = json.provenance
  const k0Units = (json.units as unknown[]).filter((u): u is Json => isObject(u) && u.contextRank === 1).map(u => {
    const search = isObject(u.search) ? u.search : {}
    return { unitId: u.unitId as string, targetIndex: u.targetIndex as number, contextRank: u.contextRank as number, rung: u.rung as Phase2C27BRungId, result: u.result as string,
      search: { deliveredCandidates: search.deliveredCandidates as number, excludedCandidates: search.excludedCandidates as number, exhausted: search.exhausted as boolean,
        stoppedByExtent: search.stoppedByExtent as boolean, stoppedByConsumer: search.stoppedByConsumer as boolean },
      deliveries: (Array.isArray(u.deliveries) ? u.deliveries as unknown[] : []).filter(isObject).map(d => ({ i: d.i as number, keySha256: d.keySha256 as string, cost: d.cost as number,
        action: d.action as string, respectsReservation: d.respectsReservation as boolean })) }
  })
  return { sources: { export: structuredClone(s.export), targets: structuredClone(s.targets) },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead) },
    decisionCase: json.decision.case, k0Units }
}

export interface D2D1Evaluation {
  evaluationId: string
  stage: string
  evaluatedAgainst: string
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: (string | null)[]
  status: string
  inputDigest: string | null
  resultDigest: string | null
  termination: { status: string; completedTargetCount: number; totalTargetCount: number } | null
  steps: number | null
  conflictCount: number | null
  r5Satisfied: boolean | null
}
export interface D2D1ResultProjection {
  sources: Json
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown; calculationCodeChangedSinceMeasuredHead: unknown; startAttestationSha256: unknown }
  decisionCase: unknown
  evaluations: D2D1Evaluation[]
  redeliveryGeneratedEntries: unknown[]
  aCFinalAccepted: unknown
}

/** Reads ONLY the allowlisted D1 RESULT fields. */
export function projectD2D1Result(json: unknown): D2D1ResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !Array.isArray(json.evaluations) || !isObject(json.aggregates)) return null
  const p = json.provenance
  const strings = (v: unknown) => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : null) : []
  const evaluations = (json.evaluations as unknown[]).filter(isObject).map(e => {
    const plan = isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    return { evaluationId: e.evaluationId as string, stage: e.stage as string, evaluatedAgainst: e.evaluatedAgainst as string,
      replacementTargets: strings(e.replacementTargets) as string[], generatedEntryIds: strings(e.generatedEntryIds) as string[], generatedEntrySha256s: strings(e.generatedEntrySha256s),
      status: e.status as string, inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      termination: t === null ? null : { status: t.status as string, completedTargetCount: t.completedTargetCount as number, totalTargetCount: t.totalTargetCount as number },
      steps: plan && typeof plan.steps === 'number' ? plan.steps : null, conflictCount: Array.isArray(e.conflicts) ? e.conflicts.length : null,
      r5Satisfied: isObject(e.r5) && typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null }
  })
  return { sources: structuredClone(json.sources),
    provenance: { formal: p.formal, measuredHead: p.measuredHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead),
      startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null },
    decisionCase: json.decision.case, evaluations,
    redeliveryGeneratedEntries: Array.isArray(json.redelivery) ? (json.redelivery as unknown[]).map(r => isObject(r) ? structuredClone(r.generatedEntry) : null) : [],
    aCFinalAccepted: structuredClone(json.aggregates.aCFinalAccepted) }
}

// ---------------------------------------------------------------- V: the registered inputs and their authority chain (§8.1)

export interface D2ObservedFile { bytes: number; sha256: string }

export interface D2InputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D2RegisteredInputKey, D2ObservedFile | null>
  manifest: unknown
  phaseBResult: unknown
  phase2c2Result: unknown
  d1Result: unknown
  /** By D1 unit ID: the seed G store files and their JSON (null = missing). */
  seedFiles: Record<string, { file: D2ObservedFile; json: unknown } | null>
  /** The D2-A document text (the measurement HEAD git object). */
  specMarkdown: string
  /** The D1-A document text (its digest is a registered input). */
  d1SpecMarkdown: string
}

export interface D2PhaseBUnitExpectation {
  phaseBUnitId: string
  rung: Phase2C27BRungId
  result: 'found_R' | 'stopped_by_search_extent_bound'
  /** found_R: the delivery 0 key SHA-256 and cost; extent bound: none. */
  firstKeySha256: string | null
  firstCost: number | null
}

/** One E1 Target as D2 uses it, from the manifest, the D1-A §1.3 table, the Phase B K0 units and the D1 RESULT only. */
export interface D2Target {
  targetIndex: number
  label: string
  targetWeaponId: string
  /** `O_t` (D1-A §1.3). */
  currentBuildListEntryId: string
  /** The Phase B K0 units of this Target by rung (§1.2). */
  phaseBK0Units: Partial<Record<Phase2C27BRungId, D2PhaseBUnitExpectation>>
  /** The rung of the first Phase B K0 delivery (null for t09). */
  firstK0DeliveryRung: Phase2C27BRungId | null
  /** D1's `G_t` when it is a K0 Candidate (D1 RESULT `S-<t>`); null for t09 (a K1 Candidate). */
  d1Generated: { buildListEntryId: string; sha256: string; evaluationId: string } | null
}

export interface D2Seed {
  targetIndex: number
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  unitId: string
  file: string
  bytes: number
  sha256: string
  generatedBuildListEntryId: string
  requiresSupport: string[]
  supportReservationDigest: string | null
  isK1Candidate: boolean
}

export interface D2D1Reference {
  b0: { inputDigest: string; resultDigest: string }
  aB: { inputDigest: string; resultDigest: string; evaluationId: string }
  /** inputDigest -> the D1 evaluations holding it (status, resultDigest), for the D1 determinism parity. */
  byInputDigest: Record<string, { evaluationId: string; status: string; resultDigest: string | null }[]>
}

export interface D2ValidatedInputs {
  passed: boolean
  issues: string[]
  exportSha256: string | null
  targets: D2Target[]
  k0ReservationDigest: string | null
  seed: D2Seed[]
  d1: D2D1Reference | null
  phase2c2BaselineSummary: unknown
}

/** The Export SHA-256 the Phase B RESULT `sources.export` names (a registered input), or null. */
export function d2ChainedExportSha256(phaseBResult: unknown): string | null {
  const projection = projectD2PhaseBResult(phaseBResult)
  const e = projection && isObject(projection.sources.export) ? projection.sources.export : null
  return e !== null && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256) ? e.sha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const

/**
 * V (§8.1): every registered input present with its registered digest; the Export chained through the Phase B RESULT, the D1
 * RESULT and the manifest and named by the D2-A text; the Phase B RESULT (allowlist) the registered formal INCOMPLETE run whose 24
 * K0 units are the D2-A §1.2 table; the D1 RESULT (allowlist) the registered formal PARTIAL run with the §1.1 comparison values;
 * the D1-A §1.3 table agreeing with the manifest; the seed G store bodies the D1 A-b ones; the Phase 2-C2 baseline summary
 * complete. Never repairs or substitutes: any issue fails D2 closed (`input_evidence`). Pure.
 */
export function validateD2Inputs(evidence: D2InputEvidence): D2ValidatedInputs {
  const issues: string[] = [...d2PolicyDrift()]
  const fail = (): D2ValidatedInputs => ({ passed: false, issues, exportSha256: null, targets: [], k0ReservationDigest: null, seed: [], d1: null, phase2c2BaselineSummary: null })
  const exportSha = d2ChainedExportSha256(evidence.phaseBResult)
  for (const [key, registered] of Object.entries(D2_REGISTERED_INPUTS) as [D2RegisteredInputKey, D2RegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? exportSha
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the Phase B RESULT`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (registered.bytes !== null && observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
  }
  const spec = evidence.specMarkdown
  if (exportSha === null || !spec.includes(exportSha)) issues.push('the chained Export SHA-256 is not the one the D2-A document registers')
  for (const registered of Object.values(D2_REGISTERED_INPUTS)) if (registered.sha256 !== null && !d2NamesSha256(spec, registered.sha256)) issues.push(`${registered.file}: the D2-A document does not name its SHA-256`)

  // The manifest (Target IDs only).
  const manifest = parsePhase2C27BTargetManifest(evidence.manifest)
  if (!manifest.valid || manifest.manifest === null) { issues.push(...manifest.issues.map(i => `manifest: ${i}`)); return fail() }
  const ids = manifest.manifest.targetWeaponIds
  if (manifest.manifest.exportSha256 !== exportSha) issues.push('the manifest Export is not the chained Export')

  // The Phase B RESULT (allowlist).
  const phaseB = projectD2PhaseBResult(evidence.phaseBResult)
  if (phaseB === null) { issues.push('the Phase B RESULT has no sources / provenance / decision / units'); return fail() }
  if (phaseB.provenance.formal !== true) issues.push('Phase B RESULT provenance.formal is not true')
  if (phaseB.provenance.measuredHead !== D1_PHASE_B_PROVENANCE.measuredHead) issues.push('Phase B RESULT measuredHead is not the registered one')
  if (phaseB.provenance.runStatus !== 'completed') issues.push('Phase B RESULT runStatus is not completed')
  if (!Array.isArray(phaseB.provenance.calculationCodeChangedSinceMeasuredHead) || phaseB.provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('Phase B RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (phaseB.decisionCase !== D1_PHASE_B_PROVENANCE.decisionCase) issues.push('Phase B RESULT decision.case is not B2C27B_INCOMPLETE')
  const pbExport = isObject(phaseB.sources.export) ? phaseB.sources.export : null
  if (pbExport === null || pbExport.bytes !== D2_REGISTERED_INPUTS.export.bytes) issues.push('the Phase B RESULT sources.export is not the registered Export')
  const pbTargets = isObject(phaseB.sources.targets) ? phaseB.sources.targets : null
  if (pbTargets === null || pbTargets.sha256 !== D2_REGISTERED_INPUTS.phaseBTargets.sha256) issues.push('the Phase B RESULT sources.targets is not the registered manifest')

  // The D2-A §1.2 table against the Phase B K0 units.
  const k0Table = parseD2SpecK0Table(spec)
  if (k0Table.length !== D2_TARGETS) issues.push('the D2-A §1.2 table does not hold 11 rows')
  if (phaseB.k0Units.length !== 24) issues.push(`the Phase B RESULT holds ${phaseB.k0Units.length} K0 units, not 24`)
  const phaseBUnitsByTarget = new Map<number, Partial<Record<Phase2C27BRungId, D2PhaseBUnitExpectation>>>()
  for (const unit of phaseB.k0Units) {
    const at = unit.unitId
    if (!Number.isInteger(unit.targetIndex) || unit.targetIndex < 0 || unit.targetIndex >= D2_TARGETS || !PHASE2C27B_RUNG_IDS.includes(unit.rung) || at !== d2PhaseBK0UnitId(unit.targetIndex, unit.rung)) {
      issues.push(`${at}: not a K0 unit of an E1 Target`); continue
    }
    const row = k0Table[unit.targetIndex]
    if (!row || row.t !== d2TargetLabel(unit.targetIndex) || row.rungs[unit.rung] !== unit.result) issues.push(`${at}: the Phase B result ${unit.result} is not the D2-A §1.2 table`)
    let expectation: D2PhaseBUnitExpectation | null = null
    if (unit.result === 'found_R') {
      const d = unit.deliveries[0]
      if (unit.deliveries.length !== 1 || !d || d.i !== 0 || typeof d.keySha256 !== 'string' || unit.search.deliveredCandidates !== 1 || unit.search.stoppedByConsumer !== true) issues.push(`${at}: the found_R unit is not one delivery with a consumer stop`)
      else {
        if (!row || row.firstRung !== unit.rung || row.keyPrefix !== d.keySha256.slice(0, 8) || row.cost !== d.cost) issues.push(`${at}: the first K0 delivery is not the D2-A §1.2 table`)
        expectation = { phaseBUnitId: at, rung: unit.rung, result: 'found_R', firstKeySha256: d.keySha256, firstCost: d.cost }
      }
    } else if (unit.result === 'stopped_by_search_extent_bound') {
      if (unit.deliveries.length !== 0 || unit.search.deliveredCandidates !== 0 || unit.search.stoppedByExtent !== true || unit.search.exhausted !== false) issues.push(`${at}: the extent-bound unit delivered or did not stop by extent`)
      else expectation = { phaseBUnitId: at, rung: unit.rung, result: 'stopped_by_search_extent_bound', firstKeySha256: null, firstCost: null }
    } else issues.push(`${at}: a K0 unit with result ${unit.result}`)
    if (expectation !== null) phaseBUnitsByTarget.set(unit.targetIndex, { ...phaseBUnitsByTarget.get(unit.targetIndex), [unit.rung]: expectation })
  }
  for (const row of k0Table) {
    const index = Number(row.t.slice(1))
    const units = phaseBUnitsByTarget.get(index) ?? {}
    for (const rung of PHASE2C27B_RUNG_IDS) if ((row.rungs[rung] !== 'not_run') !== (units[rung] !== undefined)) issues.push(`${row.t} ${rung}: the D2-A §1.2 table and the Phase B K0 units disagree on whether it ran`)
  }

  // The D1-A §1.3 table (O_t, the t09 support / reservation, the K0 digest).
  const d1Rows = parseD1SpecTables(evidence.d1SpecMarkdown).found
  if (d1Rows.length !== D2_TARGETS) issues.push('the D1-A §1.3 table does not hold 11 rows')
  d1Rows.forEach((row, index) => {
    if (row.t !== d2TargetLabel(index) || row.targetWeaponId !== ids[index]) issues.push(`${row.t}: the D1-A §1.3 Target is not the manifest Target ${index}`)
  })
  const k0Digests = [...new Set(d1Rows.filter(r => r.supportBuildListEntryIds.length === 0).map(r => r.reservationDigest))]
  const k0ReservationDigest = k0Digests.length === 1 ? k0Digests[0]! : null
  if (k0ReservationDigest === null || !spec.includes(`\`${k0ReservationDigest}\``)) issues.push('the K0 reservation digest is not one value the D2-A document names')
  const k1Rows = d1Rows.filter(r => r.supportBuildListEntryIds.length > 0)
  if (k1Rows.length !== 1 || k1Rows[0]!.t !== d2TargetLabel(9) || k1Rows[0]!.supportBuildListEntryIds.length !== 1) issues.push('the D1-A §1.3 K1 row is not exactly t09 with one support Entry')
  const k1 = k1Rows[0]
  if (k1 && (!spec.includes(k1.supportBuildListEntryIds[0]!) || !spec.includes(k1.reservationDigest))) issues.push('the t09 support Entry / reservation digest is not the one the D2-A document names')

  // The D1 RESULT (allowlist).
  const d1 = projectD2D1Result(evidence.d1Result)
  if (d1 === null) { issues.push('the D1 RESULT has no sources / provenance / decision / evaluations / aggregates'); return fail() }
  if (d1.provenance.formal !== true) issues.push('D1 RESULT provenance.formal is not true')
  if (d1.provenance.measuredHead !== D2_D1_PROVENANCE.measuredHead) issues.push('D1 RESULT measuredHead is not the registered one')
  if (d1.provenance.runStatus !== 'completed') issues.push('D1 RESULT runStatus is not completed')
  if (!Array.isArray(d1.provenance.calculationCodeChangedSinceMeasuredHead) || d1.provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D1 RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (typeof d1.provenance.startAttestationSha256 !== 'string' || !d2NamesSha256(spec, d1.provenance.startAttestationSha256)) issues.push('the D1 start attestation is not the one the D2-A document names')
  if (d1.decisionCase !== D2_D1_PROVENANCE.decisionCase) issues.push('D1 RESULT decision.case is not D1_FOUND_R_SET_PARTIAL')
  if (!same(d1.aCFinalAccepted, D2_D1_PROVENANCE.aCFinalAccepted)) issues.push('D1 RESULT aggregates.aCFinalAccepted is not [1, 7, 8, 9]')
  const d1Export = isObject(d1.sources.export) ? d1.sources.export : null
  if (d1Export === null || d1Export.sha256 !== exportSha || d1Export.bytes !== D2_REGISTERED_INPUTS.export.bytes) issues.push('the D1 RESULT sources.export is not the chained Export')
  const d1Sources = isObject(d1.sources.d1) ? d1.sources.d1 : null
  const d1Generated = d1Sources !== null && Array.isArray(d1Sources.generatedEntries) ? (d1Sources.generatedEntries as unknown[]).filter(isObject) : []
  if (d1Sources === null || d1Sources.runDir !== D2_D1_RUN_DIR.split('/').pop()) issues.push('the D1 RESULT run dir is not the registered D1 run dir')
  const byId = new Map(d1.evaluations.map(e => [e.evaluationId, e]))
  const checkComparison = (id: string, baseline: { completed: number; totalTargetCount: number; conflicts: number; steps: number }) => {
    const e = byId.get(id)
    if (!e || e.status !== 'evaluated' || e.termination === null || e.termination.completedTargetCount !== baseline.completed || e.termination.totalTargetCount !== baseline.totalTargetCount
      || e.conflictCount !== baseline.conflicts || e.steps !== baseline.steps || e.inputDigest === null || e.resultDigest === null) {
      issues.push(`D1 RESULT ${id} is not the §9.1 comparison value`); return null
    }
    if (!spec.includes(e.inputDigest) || !spec.includes(e.resultDigest)) issues.push(`D1 RESULT ${id} digests are not the ones the D2-A document names`)
    return e
  }
  const b0 = checkComparison('B0', D2_COMPARISON_BASELINES.baseline)
  const aB = checkComparison('A-b', D2_COMPARISON_BASELINES.d1Incumbent)
  if (aB && aB.r5Satisfied !== true) issues.push('D1 RESULT A-b does not satisfy R5')
  if (d1.evaluations.length !== 80) issues.push(`the D1 RESULT holds ${d1.evaluations.length} evaluations, not 80`)
  const byInputDigest: D2D1Reference['byInputDigest'] = {}
  for (const e of d1.evaluations) if (e.inputDigest !== null) (byInputDigest[e.inputDigest] ??= []).push({ evaluationId: e.evaluationId, status: e.status, resultDigest: e.resultDigest })

  // The Phase 2-C2 baseline summary.
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  // The Targets.
  const targets: D2Target[] = ids.map((targetWeaponId, targetIndex) => {
    const label = d2TargetLabel(targetIndex)
    const row = d1Rows[targetIndex]
    const k0 = k0Table[targetIndex]
    const s = byId.get(`S-${label}`)
    let d1G: D2Target['d1Generated'] = null
    if (!s || s.stage !== 'S' || s.replacementTargets.length !== 1 || s.replacementTargets[0] !== targetWeaponId || s.generatedEntryIds.length !== 1 || typeof s.generatedEntrySha256s[0] !== 'string') {
      issues.push(`${label}: the D1 RESULT S-${label} is not a single replacement of the Target`)
    } else if (row && row.supportBuildListEntryIds.length === 0) {
      const sha = s.generatedEntrySha256s[0]!
      const file = d1Generated.find(g => g.sha256 === sha)
      const redelivered = d1.redeliveryGeneratedEntries[targetIndex]
      if (!file || !isObject(redelivered) || redelivered.sha256 !== sha || s.generatedEntryIds[0] !== row.generatedBuildListEntryId) issues.push(`${label}: the D1 G_t is not the one the D1 RESULT sources / redelivery / D1-A table name`)
      d1G = { buildListEntryId: s.generatedEntryIds[0]!, sha256: sha, evaluationId: s.evaluationId }
    }
    const firstRung = k0?.firstRung ?? null
    return { targetIndex, label, targetWeaponId, currentBuildListEntryId: row?.currentBuildListEntryId ?? '', phaseBK0Units: phaseBUnitsByTarget.get(targetIndex) ?? {}, firstK0DeliveryRung: firstRung, d1Generated: d1G }
  })
  if (targets.filter(t => t.firstK0DeliveryRung === null).map(t => t.label).join() !== d2TargetLabel(9)) issues.push('the Targets without a Phase B K0 delivery are not exactly t09')
  for (const t of targets) if ((t.firstK0DeliveryRung === null) !== (t.d1Generated === null)) issues.push(`${t.label}: a K0 first delivery and the D1 K0 G_t do not go together`)

  // The seed (§5): the D1 G store bodies of the D1 final accepted set, equal to the D1 A-b replacement set.
  const seed: D2Seed[] = []
  if (!same(D2_SEED_FILES.map(s => s.targetIndex), D2_D1_PROVENANCE.aCFinalAccepted)) issues.push('the registered seed files are not the D1 final accepted set')
  D2_SEED_FILES.forEach((registered, position) => {
    const at = registered.unitId
    const observed = evidence.seedFiles[at] ?? null
    if (observed === null) { issues.push(`${at}: the D1 G store seed file is missing`); return }
    if (observed.file.sha256 !== registered.sha256 || observed.file.bytes !== registered.bytes) issues.push(`${at}: the seed file is not the registered one`)
    if (!d2NamesSha256(spec, registered.sha256)) issues.push(`${at}: the D2-A document does not name the seed SHA-256`)
    const source = d1Generated.find(g => g.file === d2SeedFileName(at))
    if (!source || source.sha256 !== observed.file.sha256 || source.bytes !== observed.file.bytes) issues.push(`${at}: the seed file is not the one the D1 RESULT sources name`)
    const body = isObject(observed.json) ? observed.json : null
    const targetWeaponId = ids[registered.targetIndex]
    if (body === null || body.targetWeaponId !== targetWeaponId || !aB || aB.replacementTargets[position] !== targetWeaponId || aB.generatedEntryIds[position] !== body.id
      || aB.generatedEntrySha256s[position] !== observed.file.sha256) { issues.push(`${at}: the seed body is not the D1 A-b G of the Target`); return }
    const row = d1Rows[registered.targetIndex]
    const isK1 = (row?.supportBuildListEntryIds.length ?? 0) > 0
    if (row && body.id !== row.generatedBuildListEntryId) issues.push(`${at}: the seed body is not the D1-A §1.3 G_t`)
    seed.push({ targetIndex: registered.targetIndex, label: d2TargetLabel(registered.targetIndex), targetWeaponId: targetWeaponId!, currentBuildListEntryId: row?.currentBuildListEntryId ?? '',
      unitId: at, file: d2SeedFileName(at), bytes: observed.file.bytes, sha256: observed.file.sha256, generatedBuildListEntryId: String(body.id),
      requiresSupport: row ? [...row.supportBuildListEntryIds] : [], supportReservationDigest: isK1 && row ? row.reservationDigest : null, isK1Candidate: isK1 })
  })
  if (seed.filter(s => s.isK1Candidate).map(s => s.label).join() !== d2TargetLabel(9)) issues.push('the K1 Candidate of the seed is not exactly t09')
  const passed = issues.length === 0
  return { passed, issues, exportSha256: passed ? exportSha : null, targets: passed ? targets : [], k0ReservationDigest: passed ? k0ReservationDigest : null, seed: passed ? seed : [],
    d1: passed && b0 && aB ? { b0: { inputDigest: b0.inputDigest!, resultDigest: b0.resultDigest! }, aB: { inputDigest: aB.inputDigest!, resultDigest: aB.resultDigest!, evaluationId: aB.evaluationId }, byInputDigest } : null,
    phase2c2BaselineSummary: passed ? structuredClone(phase2c2) : null }
}

/** The dropped 7 (§1.1): the Targets outside the seed, in Target ID order. */
export const d2DroppedTargetIndexes = (seed: readonly { targetIndex: number }[], targetCount = D2_TARGETS) => {
  const inSeed = new Set(seed.map(s => s.targetIndex))
  return Array.from({ length: targetCount }, (_, i) => i).filter(i => !inSeed.has(i))
}

// ---------------------------------------------------------------- parity (§7.3)

export type D2ParityState = 'matched' | 'mismatched' | 'not_checked' | 'not_applicable'

/**
 * §7.3.3 Phase B K0 prefix, for one D2 unit with a Phase B counterpart. `comparable` = the D2 unit has a comparable result
 * (measured, or a typed calculation error the child recorded); `firstKeySha256` = the SHA-256 of its delivery 0 (null: none).
 */
export function d2PhaseBPrefixParity(expected: D2PhaseBUnitExpectation, d2: { comparable: boolean; status: D2DiscoveryUnitStatus; deliveredCandidates: number | null; firstKeySha256: string | null }):
  { state: D2ParityState; mismatches: string[] } {
  if (!d2.comparable) return { state: 'not_checked', mismatches: [] }
  const mismatches: string[] = []
  if (expected.result === 'found_R') {
    if (!D2_DISCOVERY_MEASURED.includes(d2.status)) mismatches.push(`status ${d2.status}`)
    else if (d2.firstKeySha256 === null) mismatches.push('no delivery (the Phase B delivery 0 is missing)')
    else if (d2.firstKeySha256 !== expected.firstKeySha256) mismatches.push('the delivery 0 key differs')
  } else {
    if (d2.status !== 'stopped_by_search_extent_bound' && d2.status !== 'ladder_exhausted') mismatches.push(`status ${d2.status} (Phase B stopped by extent)`)
    if (d2.deliveredCandidates !== 0) mismatches.push(`${d2.deliveredCandidates} delivered (Phase B 0)`)
  }
  return { state: mismatches.length === 0 ? 'matched' : 'mismatched', mismatches }
}

/** §7.3.3 D1 G: pool 1 against D1's `G_t` (key SHA-256, generated Entry ID, G store SHA-256). */
export function d2D1GeneratedParity(expected: { keySha256: string; buildListEntryId: string; sha256: string }, pool1: { keySha256: string; generatedBuildListEntryId: string; generatedEntrySha256: string | null } | null):
  { state: 'matched' | 'mismatched'; mismatches: string[] } {
  if (pool1 === null) return { state: 'mismatched', mismatches: ['no pool 1 Candidate'] }
  const mismatches: string[] = []
  if (pool1.keySha256 !== expected.keySha256) mismatches.push('candidateStableKey SHA-256')
  if (pool1.generatedBuildListEntryId !== expected.buildListEntryId) mismatches.push('generated Entry ID')
  if (pool1.generatedEntrySha256 !== expected.sha256) mismatches.push('G store SHA-256')
  return { state: mismatches.length === 0 ? 'matched' : 'mismatched', mismatches }
}

// ---------------------------------------------------------------- start attestation and Production audit (§8.2)

export const D2_START_ATTESTATION_FILE = 'start-attestation.json'
export const D2_START_ATTESTATION_PHASE = 'Issue #154 D2-B runner start attestation'

/** Research / test paths that are not Production calculation sources (the Phase B / D1 rule, unchanged). */
export function isD2ResearchOrTestPath(path: string): boolean {
  return path.startsWith('src/benchmarks/') || path.startsWith('src/test/') || path.startsWith('scripts/') || path.startsWith('docs/')
    || /\.test\.tsx?$/.test(path) || path.startsWith('.github/')
}
export const d2ProductionChangedFiles = (changed: readonly string[]): string[] => [...new Set(changed.filter(path => path.length > 0 && !isD2ResearchOrTestPath(path)))].sort(compare)

/** §8.2 / §10 `conditions`: the registered policy (POOL_CAP, ladder, context, procedures, order, gate, budgets, envelope, decision rules). */
export function d2RegisteredConditions() {
  return {
    specFile: D2_SPEC_FILE,
    baseMain: D2_BASE_MAIN,
    population: { manifest: D2_REGISTERED_INPUTS.phaseBTargets.file, targets: D2_TARGETS, order: 'Target ID ascending (t00 .. t10)' },
    context: 'K0' as const,
    ladder: D2_LADDER.map(r => ({ id: r.id, extent: { ...r.extent } })),
    poolCap: D2_POOL_CAP,
    discoveryRule: [...D2_DISCOVERY_RULE],
    admissionRule: [...D2_ADMISSION_RULE],
    compositionRule: [...D2_COMPOSITION_RULE],
    gate: D2_GATE_RULE,
    selectionOrder: [...D2_SELECTION_ORDER],
    seededAxis: [...D2_SEEDED_AXIS_RULE],
    budgets: { ...D2_BUDGETS },
    order: [...D2_ORDER],
    executionEnvelope: { ...D2_EXECUTION_ENVELOPE },
    researchMaxPlanSteps: D2_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D2_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D2_CALCULATION_CONTEXT },
    r5Definition: [...D1_R5_DEFINITION],
    r6Definition: [...D2_R6_DEFINITION],
    supportChecks: [...D2_SUPPORT_CHECKS],
    decisionRule: [...D2_DECISION_RULE],
    seededDecisionRule: [...D2_SEEDED_DECISION_RULE],
    betterRule: D2_BETTER_RULE,
    comparisonBaselines: structuredClone(D2_COMPARISON_BASELINES) as unknown,
    registeredInputs: structuredClone(D2_REGISTERED_INPUTS) as unknown,
    seedFiles: D2_SEED_FILES.map(s => ({ ...s })),
    d1Provenance: { measuredHead: D2_D1_PROVENANCE.measuredHead, decisionCase: D2_D1_PROVENANCE.decisionCase, aCFinalAccepted: [...D2_D1_PROVENANCE.aCFinalAccepted] },
    phaseBProvenance: { measuredHead: D1_PHASE_B_PROVENANCE.measuredHead, decisionCase: D1_PHASE_B_PROVENANCE.decisionCase },
    phaseBResultFieldsRead: [...D2_PHASE_B_RESULT_ALLOWLIST],
    d1ResultFieldsRead: [...D2_D1_RESULT_ALLOWLIST],
    d1SpecFieldsRead: [...D2_D1_SPEC_FIELDS_READ],
    provenanceFlags: { ...D2_PROVENANCE_FLAGS },
    notRun: [...D2_NOT_RUN],
  }
}

/** §8.2: the SHA-256 of `stableStringify(conditions)`. */
export const d2RegisteredPolicySha256 = (sha256OfText: (text: string) => string) => sha256OfText(stableStringify(d2RegisteredConditions()))

export interface D2LaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  /** The calculation code digest (the code paths at HEAD, which hold the D2 benchmark code and every module it imports). */
  benchmarkCodeSha256: string
  /** The D2-A document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The observed digest of every registered input and seed file (V checks them against the registered ones). */
  observedInputs: Record<string, D2ObservedFile | null>
  observedSeedFiles: Record<string, D2ObservedFile | null>
  exportFileName: string
  productionAudit: { baseMain: string; baseMainIsAncestor: boolean; productionChangedSinceBaseMain: string[] }
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  appliedExecutionEnvelope: { discoveryUnitBudgetMs: number; evaluationBudgetMs: number; runBudgetMs: number; childHeapMb: number; concurrency: number; retry: string; fallback: string; memorySampleIntervalMs: number; nodeYield: string }
  rngEngineVersion: string
  smoke: { targetIndexes: number[] | null; maxChildren: number | null; budgetMs: number | null } | null
}

export type D2StartAttestation = ReturnType<typeof d2RegisteredConditions> & D2LaunchObservation & { phase: string; attestedBy: 'runner' }

export function d2StartAttestationBody(observation: D2LaunchObservation): D2StartAttestation {
  return { phase: D2_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d2RegisteredConditions(), ...observation }
}

const EMPTY_D2_OBSERVATION: D2LaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  registeredPolicySha256: '', observedInputs: {}, observedSeedFiles: {}, exportFileName: '', productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null }, appliedExecutionEnvelope: { ...D2_EXECUTION_ENVELOPE }, rngEngineVersion: '', smoke: null }
const D2_ATTESTATION_KEYS = Object.keys(d2StartAttestationBody(EMPTY_D2_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D2AttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The chained Export SHA-256 (`d2ChainedExportSha256()`). */
  exportSha256: string | null
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D2 launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / calculation code / D2-A
 * document / registered policy equal to the independently obtained ones, every observed input and seed file equal to the
 * registered digest, Production changed files = [] with the base main an ancestor, the registered Engine, a clean non-smoke launch,
 * and every registered condition unchanged.
 */
export function verifyD2StartAttestation(attestation: unknown, expected: D2AttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D2_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D2_START_ATTESTATION_PHASE) issues.push('not a D2-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  if (attestation.registeredPolicySha256 !== expected.registeredPolicySha256) issues.push('registeredPolicySha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D2_REGISTERED_INPUTS) as [string, D2RegisteredFile][]) {
    const o = observed[key]
    const want = registered.sha256 ?? expected.exportSha256
    if (!isObject(o) || want === null || o.sha256 !== want || (registered.bytes !== null && o.bytes !== registered.bytes)) issues.push(`the observed ${key} is not the registered input`)
  }
  const seeds = isObject(attestation.observedSeedFiles) ? attestation.observedSeedFiles : {}
  for (const s of D2_SEED_FILES) {
    const o = seeds[s.unitId]
    if (!isObject(o) || o.sha256 !== s.sha256 || o.bytes !== s.bytes) issues.push(`the observed seed ${s.unitId} is not the registered file`)
  }
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || audit.baseMain !== D2_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D2_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (attestation.rngEngineVersion !== D2_RNG_ENGINE_VERSION) issues.push('the Production RNG Engine is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D2_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d2RegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
