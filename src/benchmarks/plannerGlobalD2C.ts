/**
 * Issue #154 D2-C-B: winner-derived limited K1 discovery, R1 admission and set evaluation on top of the D2-B main-axis accepted set.
 * Research only. Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md` (D2-C-A, PR #227), attested by the runner at the measurement
 * HEAD. The registered order (§8.1):
 *
 * ```text
 * V    the registered inputs; the 6 scope Targets and the 7 K1 contexts re-derived from the D2 RESULT (§3.1) = the §3.2 table   parent
 * B0   the baseline PlannerInput, one fresh full run (persisted)
 * I0   the D2-B main-axis accepted set (5 K0 G store bodies), one fresh replacement_set run
 * CTX  k = 1 -> 7: phase2c27bResolveSupportContext(t, [s]) -> the context record (reservation body as a JSON object, C1 .. C5)
 * DSC  rung-major L0 (k = 1 -> 7) -> L1 -> L2: visitPlannerAlternativeCandidates() with the context reservation, D-1 .. D-4,
 *        K1_POOL_CAP = 2 per context, every new key materialized against the baseline Entries and written to the G store
 * ADM  per pooled Candidate: T = { t } (baseline), requiresSupport = [s], R1 admission (R2..R4 / found_R are diagnostics)
 * CMP  t00 -> t02 -> t03 -> t04 -> t05 -> t10, single pass: accepted ∪ { t: c } (replacement_set), R5 + gate, the §6.4 order
 * ```
 *
 * Every evaluation keeps `conflictResolutions = []` and the preflight fixed constraints `[]` (G1). The support Entry is the
 * Export's own Entry: it is never written as a resolution, a scenario resolution, a repair lineage or a selected Entry (G30). S5
 * compares the support reservation with the CTX record's `reservationBody` (a JSON object) AND `reservationDigest` through the
 * unchanged `runD2Evaluation()` (§7.2, §14).
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module and reads the D2 / Phase B
 * RESULTs through `projectD2CD2Result()` / `projectD2CPhaseBResult()` only (the §10.1 allowlists). It names no Target, Entry,
 * reservation digest or stable key: the contexts come from the D2 RESULT (§3.1), every registered value is read from the attested
 * D2-C text and only compared.
 */
import { resolveBuildListEntryReplacement } from '../domain/buildList'
import { collectReferencedOwnedWeaponIds, hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { createPlannerAlternativeMaterializer, createPlannerAlternativeSearchIdentity } from '../domain/planner/alternative'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeCandidate, type PlannerAlternativeSearchExtent } from '../domain/search'
import { parseD1SpecTables, D1_PHASE_B_PROVENANCE, D1_R5_DEFINITION, D1InvariantError } from './plannerGlobalD1'
import {
  d2DiscoveryUnitOutcome,
  d2NamesSha256,
  d2PolicyDrift,
  d2ProductionChangedFiles,
  runD2Evaluation,
  D2_CALCULATION_CONTEXT,
  D2_EVALUATION_FULL_RUN_CAP,
  D2_LADDER,
  D2_RESEARCH_MAX_PLAN_STEPS,
  D2_RNG_ENGINE_VERSION,
  D2_SELECTION_ORDER,
  type D2DiscoveryMeasuredStatus,
  type D2EvaluationChildResult,
  type D2EvaluationTask,
  type D2Stage,
} from './plannerGlobalD2'
import { respectsPhase2C2Reservation, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  parsePhase2C27BTargetManifest,
  phase2c27bPolicyDrift,
  phase2c27bResolveSupportContext,
  PHASE2C27B_RUNG_IDS,
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
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

// ---------------------------------------------------------------- registered before the formal run (D2-C-A §2 - §13, §15, §17)

export const D2C_PHASE = 'Issue #154 D2-C'
export const D2C_RESULT_PHASE = 'Issue #154 D2-C: winner-derived limited K1 discovery and set evaluation (post-hoc analysis)'
/** The D2-C-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§10.2) and attested. */
export const D2C_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md'
/** The main of D2-C-B's start (PR #227 merged): the Production audit counts changes since this commit. */
export const D2C_BASE_MAIN = 'cb61a689e87fccd70a0a3256aa3da0396e5a6bf7'

/** §10.1: the D2 formal RESULT D2-C reads (its measurement provenance and decision). */
export const D2C_D2_PROVENANCE = Object.freeze({
  measuredHead: '6f66c168e9163dab02bb60b2f1dc5b1cfc531e71',
  decisionCase: 'D2A_EXCEEDS_D1_INCUMBENT',
  startAttestationSha256: '8c0843167d2b8037d2c532e2c1646540be29354c3c39f254a125c1da9becd56b',
  runDir: 'd2-formal2.run',
  pooledCandidates: 32,
  admissionEvaluations: 32,
} as const)

export interface D2CRegisteredFile { file: string; bytes: number | null; sha256: string | null }

/**
 * §10.1: every input D2-C reads, by path relative to the repository root (the Export is an external path argument). `sha256: null`
 * is the Export only: its digest is reached through the authority chain (the Phase B RESULT, the D2 RESULT and the manifest must
 * agree and the attested D2-C text must name it), so it is written in no Research source but the oracle's.
 */
export const D2C_REGISTERED_INPUTS = Object.freeze({
  export: { file: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: null },
  phaseBTargets: { file: '.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local', bytes: 967, sha256: 'd4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de' },
  d2Result: { file: 'docs/PLANNER_GLOBAL_D2_RESULT.json', bytes: 4_122_806, sha256: 'ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c' },
  phaseBResult: { file: 'docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json', bytes: 808_015, sha256: 'd79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4' },
  phase2c2Result: { file: 'docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json', bytes: 1_195_107, sha256: 'afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4' },
  d1SpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md', bytes: 63_908, sha256: '39974cbbdb7ab81c88bd3edf006796ccf6184c2744e23d61b705fb16f35a359f' },
  d2SpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md', bytes: null, sha256: 'a250925a5f25474db1b86f71906b51613608e33ec7b612822ba862e0f7bd1625' },
  d2bDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2B.md', bytes: null, sha256: '55952cf4951d9e94d2460fce9cb22c269dec635b30a19e8ae11a98632129028a' },
  phaseADocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md', bytes: null, sha256: 'b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147' },
  phaseBDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md', bytes: null, sha256: 'e05eea56d3c9c8cdeae1f086e9ca6b2a4fa326fd1e9de87914e120a4488dff9c' },
  followupDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md', bytes: null, sha256: '335a6710d49bcdc1a9ef05a822a9931f40610c714561ae665ac008e82b987083' },
  d1bDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1B.md', bytes: null, sha256: '536f8cd4073a880e27aab84c8b0c7e3339b6b669ef65889e982813bcab72fb4f' },
} satisfies Record<string, D2CRegisteredFile>)
export type D2CRegisteredInputKey = keyof typeof D2C_REGISTERED_INPUTS

/** §1.1 / §6.1: the D2-B main-axis accepted set G store files (the D2-B run dir), the I0 bodies. */
export const D2C_D2B_RUN_DIR = '.local/d2-formal2.run'
export interface D2CRegisteredI0File { label: string; ordinal: number; file: string; bytes: number; sha256: string }
export const D2C_I0_FILES: readonly D2CRegisteredI0File[] = Object.freeze([
  { label: 't01', ordinal: 1, file: 't01-c1.generated-entry.json', bytes: 66_309, sha256: '3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14' },
  { label: 't06', ordinal: 3, file: 't06-c3.generated-entry.json', bytes: 251_042, sha256: '06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218' },
  { label: 't07', ordinal: 1, file: 't07-c1.generated-entry.json', bytes: 170_990, sha256: '27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f' },
  { label: 't08', ordinal: 1, file: 't08-c1.generated-entry.json', bytes: 222_523, sha256: '825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc' },
  { label: 't09', ordinal: 1, file: 't09-c1.generated-entry.json', bytes: 270_975, sha256: 'b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc' },
].map(row => Object.freeze(row)))

/** §1.4 / §10.1: the 10 Phase B K1 units of the same (Target, support) contexts (task: the fields of §10.1; record: `result.reservation`). */
export const D2C_PHASE_B_RUN_DIR = '.local/c27b-formal.run'
export interface D2CRegisteredPhaseBUnit { unitId: string; taskBytes: number; taskSha256: string; recordBytes: number; recordSha256: string }
export const D2C_PHASE_B_UNITS: readonly D2CRegisteredPhaseBUnit[] = Object.freeze([
  { unitId: 't00-r09-L0', taskBytes: 775, taskSha256: '12bf1ff87335fcdc0a64a157c4d45bd000309eb565c039f408382d1b4e2e9c22', recordBytes: 18_982, recordSha256: 'bda302e7faa524ad8b9b2be5c45b9d68161fd4b73366b7b914b5846009694e77' },
  { unitId: 't02-r10-L0', taskBytes: 776, taskSha256: 'a0be4ec91b3e40212c8d23b77fd1a0ffdbf07366bd9b3da34b517368d5c75c9f', recordBytes: 58_442, recordSha256: '2e853e7f3e5844bdedac39162511caadef745e4d6555616d00f31712baef8a37' },
  { unitId: 't02-r10-L1', taskBytes: 778, taskSha256: '789412c268d7936ead55e2e6f30e3d5035198a9459bd1e7ae08d48e60c9939ed', recordBytes: 58_423, recordSha256: '826a34702a94efd93be498c8b971057c5a33a6baf97d51ae16c99e0840ef6239' },
  { unitId: 't03-r43-L0', taskBytes: 776, taskSha256: '824d862e4f1d1e1b05ac5e7764016258e1d89604f2153b033bdd1eb462dadf03', recordBytes: 50_636, recordSha256: 'f5c5a7eebe78a694b3c4071770838985234c3e23500215f6f82555f445d07020' },
  { unitId: 't03-r43-L1', taskBytes: 778, taskSha256: 'f823efb2e6be62a9ceeeaf25d8f2ccac7d94420ed295bcee12acb237c5f54510', recordBytes: 50_656, recordSha256: '9d5dd6eb7acca9a371e0ce58e20f56a9b1a9585d7514a02f8df56f9a32a37baf' },
  { unitId: 't03-r10-L0', taskBytes: 776, taskSha256: '9e429d74d4f6e61a1d218d86cf102115fc6a6c2f42e475daa7bfd978f42a0f7c', recordBytes: 50_702, recordSha256: 'aa9d43ff486e02ab2f381e8ae80801e38852a142c39e5bf322fdee6671880c29' },
  { unitId: 't03-r10-L1', taskBytes: 778, taskSha256: '27ec3aa2151836b9c0cdb0dd0d9491a2ed036733c73d38d3f05819853174b393', recordBytes: 50_700, recordSha256: 'cbacb8afed9fc22fd95f389ea623f49512830052ee8b9b54d5c60a7641681847' },
  { unitId: 't04-r43-L0', taskBytes: 776, taskSha256: 'fc14dadb648bc479cd99b201f703f0974f2eb0a69f61e87d19c58c556645929d', recordBytes: 170_718, recordSha256: '41f4a9506fed0b6b77313ca804cc565d332f793ea54bf4fd4a6baae84ea04073' },
  { unitId: 't04-r43-L1', taskBytes: 778, taskSha256: '1d5aa6449d78e79ac90b69b5a74f0ef2d1a0f4243f7ec3b666f9273a03253c80', recordBytes: 170_731, recordSha256: 'f7cb4bb3153fc5e54e677deb7a7cfc893deeabcf4326a7e6cc169fd16d4fa49e' },
  { unitId: 't10-r10-L0', taskBytes: 777, taskSha256: 'f22a085e2a7022e509aeaa0de640014259e1f59e9a8a93c04d666bbd8ea9d3ba', recordBytes: 10_538, recordSha256: '8941f86729d45f4769a81be14689458ae23ba1eaae1e15f34403c22be2323db4' },
].map(row => Object.freeze(row)))
export const d2cPhaseBTaskFileName = (unitId: string) => `${unitId}.task.json`
export const d2cPhaseBRecordFileName = (unitId: string) => `${unitId}.record.json`

export const D2C_E1_TARGETS = 11
export const D2C_SCOPE_TARGETS = 6
export const D2C_CONTEXTS = 7
export const D2C_SUPPORT_CAP_PER_TARGET = 2
export const D2C_K1_POOL_CAP = 2
export const D2C_RESEARCH_MAX_PLAN_STEPS = D2_RESEARCH_MAX_PLAN_STEPS
export const D2C_EVALUATION_FULL_RUN_CAP = D2_EVALUATION_FULL_RUN_CAP
export const D2C_CALCULATION_CONTEXT = D2_CALCULATION_CONTEXT
export const D2C_RNG_ENGINE_VERSION = D2_RNG_ENGINE_VERSION
/** §3.1: an Entry the Planner Alternative materializer generated (a generated Entry is never a support Entry). */
export const D2C_GENERATED_ENTRY_PREFIX = 'build-list.constrained.'

/** §2.2 / §4.2: the registered ladder (Normal / Gogma / Skill), the Phase B / D2 one. */
export const D2C_LADDER = D2_LADDER

/** §8.4: the execution envelope (Research measurement envelopes, never a Production timeout). */
export const D2C_EXECUTION_ENVELOPE = Object.freeze({
  contextUnitBudgetMs: 10 * 60 * 1000,
  discoveryUnitBudgetMs: 60 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  discoveryEnvelopeMs: 9 * 60 * 60 * 1000,
  runBudgetMs: 12 * 60 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

/** §4.5 / §8.3: the registered budgets (each independent; never a Production bound, G5). */
export const D2C_BUDGETS = Object.freeze({
  contexts: D2C_CONTEXTS,
  supportPerContext: 1,
  contextChildren: D2C_CONTEXTS,
  discoveryUnitsPerContext: 3,
  discoveryUnitsMax: 21,
  k1PoolCap: D2C_K1_POOL_CAP,
  uniqueCandidatesMax: 14,
  deliveriesPerUnitMax: 5,
  generatedEntryFilesMax: 14,
  b0Evaluations: 1,
  i0Evaluations: 1,
  admissionEvaluationsMax: 14,
  compositionEvaluationsMax: 14,
  evaluationRequestsMax: 30,
  childProcessesMax: 58,
  evaluationFullRunCap: D2C_EVALUATION_FULL_RUN_CAP,
  researchMaxPlanSteps: D2C_RESEARCH_MAX_PLAN_STEPS,
} as const)

/** §11.1: the fixed comparison values (completed / Conflict / steps). The D2 RESULT must hold them (V). */
export const D2C_COMPARISON_BASELINES = Object.freeze({
  baseline: Object.freeze({ evaluationId: 'B0', completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d1Incumbent: Object.freeze({ evaluationId: 'A-b', completed: 22, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d2bMain: Object.freeze({ evaluationId: 'CMP-t09-c1', completed: 22, totalTargetCount: 43, conflicts: 20, steps: 1465 }),
})

/** §12 provenance flags. */
export const D2C_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  d2ResultModified: false,
  phaseBResultModified: false,
  d2EvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true,
  inheritsOracleInformedExtentLadder: true,
  inheritsOracleInformedExecutionEnvelope: true,
  supportDerivedFromD2ProvisionalWinners: true,
  speculativeSupportWrittenAsResolution: false,
  k0SearchInD2C: false,
  k2SearchInD2C: false,
  alternativeToAlternativeSupport: false,
  productionSemanticsChanged: false,
} as const)

/** §10.1: the only D2 RESULT fields D2-C reads. */
export const D2C_D2_RESULT_ALLOWLIST = Object.freeze([
  'sources.{export,specDocument,documents}', 'sources.d2.generatedEntries[file = the 5 I0 files]',
  'provenance.{formal,measuredHead,runStatus,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.sha256}',
  'invalidReasons', 'decision.case', 'aggregates.evaluations.{unmeasuredByReason,notExecutedByReason,byStatus}', 'aggregates.r6.satisfied', 'aggregates.discovery.pooledCandidates',
  'discovery.targets[].{label,targetWeaponId,currentBuildListEntryId,pool[].{ordinal,keySha256,generatedBuildListEntryId,generatedEntry}}',
  'evaluations[stage in {B0, ADM, CMP, Z}].{evaluationId,stage,targetLabel,status,inputDigest,resultDigest,generatedEntryIds,generatedEntrySha256s,plan.termination,plan.steps,plan.selectedBuildListEntryIds,conflicts (count; B0: kind / participants / resourceIdentity),candidates[].{label,selected,winnerBuildListEntryId},r5.satisfied,r1r4.R1}',
  'composition.main.{steps[].{label,stepOutcome,chosen},finalAccepted,finalResultEvaluationId,finalMetrics}',
])
/** §10.1: the only Phase B RESULT fields D2-C reads (no oracle / oracleManifest / oracleModule entry is opened). */
export const D2C_PHASE_B_RESULT_ALLOWLIST = Object.freeze([
  'sources.{export,targets}', 'sources.unitRecords[file = the 10 registered records].{file,bytes,sha256}',
  'provenance.{formal,measuredHead,runStatus,calculationCodeChangedSinceMeasuredHead}', 'decision.case',
  'units[unitId = the 10 registered units].{unitId,targetIndex,contextRank,rung,cardinality,result,process,search,deliveries (count)}',
])
export const D2C_PHASE_B_TASK_FIELDS_READ = Object.freeze(['unitId', 'targetWeaponId', 'targetIndex', 'contextRank', 'rung', 'extent', 'cardinality', 'supportBuildListEntryIds', 'reservationDigest', 'currentBuildListEntryId'])
export const D2C_PHASE_B_RECORD_FIELDS_READ = Object.freeze(['result.reservation'])
export const D2C_D1_SPEC_FIELDS_READ = Object.freeze(['§1.3 found table: the t00 / t02 / t03 / t04 / t05 / t10 rows (t, TargetWeapon ID, O_t)', '§1.3 found table: the t09 row (support Entry, reservationDigest)'])

export const D2C_DERIVATION_RULE = Object.freeze([
  'ScopeTargets = D2 RESULT composition.main.steps with stepOutcome !== accepted (label ascending)',
  'SourceEvaluations = D2 RESULT evaluations with stage in { ADM, CMP, Z }',
  'per t: every e in SourceEvaluations with targetLabel = t must be evaluated and hold exactly one candidates[] element with label = t; selected = false and winner != null counts the winner',
  'W(t) = winners by (count desc, Entry ID asc); eligible = an Export Entry whose Target is outside E1, not a generated Entry, not an E1 O_t',
  'contexts(t) = the first SUPPORT_CAP_PER_TARGET = 2 eligible winners; context ordinal = (Target ID asc, order in Target)',
  'co-participants are diagnostics only; B0 selected is recorded, never a filter; the result must equal the §3.2 table (contexts, order, observations, observed evaluations)',
])
export const D2C_DISCOVERY_RULE = Object.freeze([
  'CTX-<k> once per context: phase2c27bResolveSupportContext(baseline, t, [s]); the record holds reservationBody (a JSON object), reservationDigest, origin / excluded keys and C1 .. C5',
  'DSC-<k>-<rung> per (context, rung), rung-major: L0 (k = 1 -> 7) -> L1 -> L2; the re-derived context must equal the CTX record (context_drift otherwise)',
  'consumer: R0 false -> guardrail; a key twice in one unit -> guardrail (D-1); a key in pool(k) -> duplicate_of_lower_rung; SHA-256(key) in the D2-B K0 pool of t -> same_key_as_d2b_k0_pool; otherwise materialize, write the G store, pool; stop at |pool(k)| = 2',
  'unit outcome: consumer stop -> discovery_cap_reached; exhausted -> discovery_exhausted; extent -> stopped_by_search_extent_bound (ladder_exhausted at L2); timeout / OOM / process failure / interrupted -> unmeasured; typed error -> discovery_calculation_error',
  'escalate only after stopped_by_search_extent_bound with |pool(k)| < 2; no trial during discovery; found_R never stops the Search',
])
export const D2C_DEDUP_RULES = Object.freeze([
  'D-1 within one unit: a second delivery of one candidateStableKey is an invariant violation (guardrail)',
  'D-2 within one context across rungs: a key already in pool(k) is duplicate_of_lower_rung (not pooled, not materialized)',
  'D-3 across the K1 contexts of one Target: never identified; each context pools its own Candidates, crossContextSameKey is a diagnostic; one PlannerInput never holds two Candidates of one Target',
  'D-4 the D2-B K0 pool of the same Target: SHA-256(key) in it -> same_key_as_d2b_k0_pool (outside D2-C, not pooled)',
])
export const D2C_ADMISSION_RULE = Object.freeze([
  'one ADM-<t>-c<ordinal> per pooled Candidate, T = { t }, evaluatedAgainst = baseline, requiresSupport = [s]; Target ID then discovery ordinal order',
  'discovery ordinal per Target = (context ordinal, rung, delivery index in the unit)',
  'R1 = reusedExisting false ∧ replacement ready with replacedBuildListEntryId = O_t ∧ preflight ready ∧ evaluated ∧ plan ∧ termination in { completed, exhausted }',
  'R2 / R3 / R4 / target_regressed_R / found_R / winners / co-participants / S1 .. S3 are diagnostics; S4 / S5 are static (guardrail)',
])
export const D2C_INCUMBENT_RULE = Object.freeze([
  'I0 = the D2-B main-axis accepted set { t01 c1, t06 c3, t07 c1, t08 c1, t09 c1 } (K0, requiresSupport []) from the D2-B G store, one fresh replacement_set run',
  'expected (d2b_incumbent parity): inputDigest, status evaluated, resultDigest, termination exhausted, 22 / 43, Conflict 20, steps 1465, R5 satisfied (the D2 RESULT CMP-t09-c1)',
  'I0 is the initial accepted set and reference of CMP; the D2 RESULT values are parity expectations only',
])
export const D2C_COMPOSITION_RULE = Object.freeze([
  'accepted = I0 set, reference = I0; t00 -> t02 -> t03 -> t04 -> t05 -> t10 single pass',
  'a Target with an unmeasured / not_executed discovery or ADM -> step_unmeasured (dependency_unmeasured), afterUnmeasuredStep for the later steps',
  'no admitted Candidate -> not_replaced_no_admitted; I0 unmeasured -> every CMP not_executed (i0_unmeasured)',
  'every admitted Candidate c (discovery ordinal order, no early stop): CMP-<t>-c<ordinal> evaluates accepted ∪ { t: c } as one replacement_set run',
  'eligible(c) = evaluated ∧ R5 of the whole proposed set ∧ completed(proposed) >= completed(reference)',
  'any unmeasured / not_executed -> step_unmeasured; eligible empty -> not_replaced_no_eligible; otherwise the first eligible by the selection order is accepted and becomes the reference',
  'finalResult = the last accepted evaluation (I0 when none); no extra run; accepted Targets of I0 are never re-evaluated',
])
export const D2C_GATE_RULE = 'completed(proposed) >= completed(reference) (termination.completedTargetCount); R5 without the gate is r5OnlyEligible (diagnostic)'
export const D2C_SELECTION_ORDER = D2_SELECTION_ORDER
export const D2C_R6_DEFINITION = Object.freeze([
  '(1) status evaluated, plan !== null, Trace Replay completed',
  '(2) termination.status === completed and completedTargetCount === totalTargetCount === 43',
  '(3) result.conflicts.length === 0',
  '(4) no plan.rejectedBuildListEntries element with reason resource_conflict',
  '(5) R5 satisfied',
])
export const D2C_CONTEXT_CHECKS = Object.freeze([
  'C1: the support Entry is exactly one Export Entry, its Target is outside E1, it is not a generated Entry and not an E1 O_t',
  'C2: phase2c27bResolveSupportContext(baseline, t, [s]) is ready and its current Entry is O_t',
  'C3: the derived exclusiveOwnedWeaponIds hold collectReferencedOwnedWeaponIds(support Route) and every exclusiveConsumedOwnedWeaponId of the same unit plan',
  'C4: the origin digest is the B2-C1 schedule snapshot origin digest and excludedRouteKeys = [candidateStableKey(O_t)] (the schedule ones)',
  'C5: with a registered digest, reservationDigest = it and stableStringify(reservationBody) = stableStringify(Phase B record result.reservation) for every reference unit; t05 not_applicable',
])
export const D2C_SUPPORT_CHECKS = Object.freeze([
  'S1 dynamic: the support Target is not in the replacement set T',
  'S2 dynamic: the support Entry is in the final run input (after the runtime-unsupported retries)',
  'S3 dynamic: the support Entry is a valid Entry of the final run input initial context',
  'S4 static: the support Entry in the evaluation input is the Export body and SHA-256(stableStringify(body)) = the CTX record supportBodySha256',
  'S5 static: hashStableValue(derivePlannerAlternativeReservation([Export body])) = the CTX record reservationDigest AND stableStringify(derived) = stableStringify(CTX record reservationBody) (both objects)',
])
export const D2C_SUPPORT_EXPIRY_CAUSES = Object.freeze(['support_target_replaced', 'support_removed_runtime_unsupported', 'support_entry_absent', 'support_entry_invalid', 'support_not_selected',
  'support_body_mismatch', 'support_reservation_mismatch'])
export const D2C_ORDER = Object.freeze(['V', 'B0', 'I0', 'CTX k = 1 -> 7', 'DSC rung-major: L0 (k = 1 -> 7) -> L1 -> L2', 'ADM (Target ID, discovery ordinal)', 'CMP t00 -> t02 -> t03 -> t04 -> t05 -> t10'])
export const D2C_DECISION_RULE = Object.freeze([
  'D2C_INVALID: any formal validity violation (§7 / §9 / §10): input_evidence / provenance / baseline_parity_mismatch / d2b_parity / phase_b_k1_parity / guardrail / determinism / evidence_integrity / raw_result_mismatch',
  'D2C_INCOMPLETE: invalid 0 and a registered CTX / DSC / B0 / I0 / ADM / CMP is unmeasured or not_executed (a parity not_checked included); measured evidence is a lower bound',
  'D2C_GLOBAL_COMPLETE_R: invalid 0, unmeasured 0, finalResult satisfies R6',
  'D2C_EXCEEDS_D2B_MAIN: at least one K1 Candidate accepted and finalResult is better than I0 (22 / 20)',
  'D2C_K1_ACCEPTED_NOT_BETTER: at least one K1 Candidate accepted, finalResult not better than I0',
  'D2C_NO_K1_ACCEPTED: invalid 0, unmeasured 0, no K1 Candidate accepted (finalResult = I0)',
])
export const D2C_BETTER_RULE = 'completed larger, or completed equal and fewer Conflicts (steps are not compared)'
/** What D2-C deliberately does not run (§2.3 / §16). */
export const D2C_NOT_RUN = Object.freeze(['k0_context_search', 'k2_context_search', 'co_participant_support', 'adaptive_support', 'alternative_to_alternative_support', 'd2b_accepted_reevaluation',
  'd2b_k0_reevaluation', 'multiple_passes', 'composition_order_change', 'simultaneous_replacement_search', 'pool_cap_expansion', 'extent_expansion', 'population_expansion', 'e2_search', 'residual_3',
  'oracle_comparison', 'phase_b_result_rewrite', 'd1_result_rewrite', 'd2_result_rewrite', 'resolution_synthesis', 'repair_lineage', 'persistence', 'retry', 'fallback', 'production_change', 'production_default_change'])

// ---------------------------------------------------------------- labels, IDs and the registered order

export const d2cTargetLabel = (index: number) => `t${pad(index)}`
/** `K1-<t>-<the first 8 characters of the support Entry hash>` (a display ID; identity is the TargetWeapon ID and the full Entry ID). */
export const d2cContextId = (label: string, supportBuildListEntryId: string) => `K1-${label}-${(supportBuildListEntryId.split('-').pop() ?? '').slice(0, 8)}`
export const d2cContextUnitId = (k: number) => `CTX-${k}`
export const d2cContextRecordFileName = (k: number) => `${d2cContextUnitId(k)}.context.json`
export const d2cDiscoveryUnitId = (k: number, rung: Phase2C27BRungId) => `DSC-${k}-${rung}`
export const d2cAdmissionId = (label: string, ordinal: number) => `ADM-${label}-c${ordinal}`
export const d2cCompositionId = (label: string, ordinal: number) => `CMP-${label}-c${ordinal}`
export const d2cPoolFileName = (contextId: string, indexInContext: number) => `${contextId}-c${indexInContext}.generated-entry.json`
export const d2cRungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...D2C_LADDER.find(r => r.id === rung)!.extent })
export const D2C_COMPOSITION_ORDER_RULE = 'scope Targets in Target ID order'

export function d2cPolicyDrift(): string[] {
  const issues = [...d2PolicyDrift()]
  if (D2C_BUDGETS.discoveryUnitsMax !== D2C_CONTEXTS * D2C_BUDGETS.discoveryUnitsPerContext) issues.push('the DSC budget is not 7 x 3')
  if (D2C_BUDGETS.uniqueCandidatesMax !== D2C_CONTEXTS * D2C_K1_POOL_CAP) issues.push('the Candidate budget is not 7 x 2')
  if (D2C_BUDGETS.evaluationRequestsMax !== 1 + 1 + D2C_BUDGETS.admissionEvaluationsMax + D2C_BUDGETS.compositionEvaluationsMax) issues.push('the evaluation budget is not 1 + 1 + 14 + 14')
  if (D2C_BUDGETS.childProcessesMax !== D2C_CONTEXTS + D2C_BUDGETS.discoveryUnitsMax + D2C_BUDGETS.evaluationRequestsMax) issues.push('the child process budget is not 7 + 21 + 30')
  return issues
}

// ---------------------------------------------------------------- the registered tables of the D2-C document (§3.2)

export interface D2CSpecContextRow {
  k: number
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryId: string
  observations: number
  observedEvaluations: number
  orderInTarget: number
  phaseBUnitIds: string[]
  registeredReservationDigest: string | null
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

/** The D2-C-A §3.2 registered context table (the registered values; the source holds none of them). */
export function parseD2CSpecContextTable(markdown: string): D2CSpecContextRow[] {
  return tableRows(markdown, /^\| k \| context ID \| Target \| TargetWeapon ID \|/).map(cells => {
    const [k, id, label, target, current, support, observed, order, units, digest] = cells
    const obs = /^(\d+) \/ (\d+)$/.exec(observed ?? '')
    const unitTicks = ticks(units ?? '')
    const first = unitTicks[0] ?? null
    const phaseBUnitIds = first === null ? [] : [first, ...unitTicks.slice(1).map(suffix => suffix.startsWith('-') ? first.replace(/-L\d$/, suffix) : suffix)]
    const digests = ticks(digest ?? '')
    return { k: Number(k), contextId: ticks(id ?? '')[0] ?? '', label: label ?? '', targetWeaponId: ticks(target ?? '')[0] ?? '', currentBuildListEntryId: ticks(current ?? '')[0] ?? '',
      supportBuildListEntryId: ticks(support ?? '')[0] ?? '', observations: Number(obs?.[1]), observedEvaluations: Number(obs?.[2]), orderInTarget: Number(order),
      phaseBUnitIds, registeredReservationDigest: digests[0] ?? null }
  })
}

// ---------------------------------------------------------------- the D2 / Phase B RESULT allowlists (§10.1)

export interface D2CD2Evaluation {
  evaluationId: string
  stage: string
  targetLabel: string | null
  status: string
  inputDigest: string | null
  resultDigest: string | null
  generatedEntryIds: string[]
  generatedEntrySha256s: string[]
  termination: { status: string; completedTargetCount: number; totalTargetCount: number } | null
  steps: number | null
  selectedBuildListEntryIds: string[]
  conflictCount: number | null
  /** B0 only: kind / participants / resourceIdentity of each Conflict (diagnostic). */
  b0Conflicts: { kind: string; participants: string[]; resourceIdentity: string | null }[] | null
  candidates: { label: string; selected: boolean | null; winnerBuildListEntryId: string | null }[]
  r5Satisfied: boolean | null
  r1: boolean | null
}
export interface D2CD2ResultProjection {
  sources: { export: unknown; specDocument: unknown; documents: unknown; generatedEntries: { file: string; bytes: number; sha256: string }[] }
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown; calculationCodeChangedSinceMeasuredHead: unknown; productionChangedFiles: unknown; startAttestationSha256: unknown }
  invalidReasons: unknown
  decisionCase: unknown
  aggregates: { unmeasuredByReason: unknown; notExecutedByReason: unknown; byStatus: unknown; r6Satisfied: unknown; pooledCandidates: unknown }
  discoveryTargets: { label: string; targetWeaponId: string; currentBuildListEntryId: string; pool: { ordinal: number; keySha256: string; generatedBuildListEntryId: string; generatedEntry: unknown }[] }[]
  evaluations: D2CD2Evaluation[]
  compositionMain: { steps: { label: string; stepOutcome: string; chosen: string | null }[]; finalAccepted: unknown; finalResultEvaluationId: unknown; finalMetrics: unknown }
}

const D2C_D2_STAGES = ['B0', 'ADM', 'CMP', 'Z']

/** Reads ONLY the allowlisted D2 RESULT fields. */
export function projectD2CD2Result(json: unknown): D2CD2ResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.discovery)
    || !Array.isArray(json.evaluations) || !isObject(json.composition) || !isObject(json.composition.main)) return null
  const s = json.sources, p = json.provenance, a = json.aggregates
  const d2 = isObject(s.d2) ? s.d2 : {}
  const registeredFiles = new Set(D2C_I0_FILES.map(f => f.file))
  const generatedEntries = (Array.isArray(d2.generatedEntries) ? d2.generatedEntries as unknown[] : []).filter(isObject).filter(g => registeredFiles.has(g.file as string))
    .map(g => ({ file: g.file as string, bytes: g.bytes as number, sha256: g.sha256 as string }))
  const evaluations: D2CD2Evaluation[] = (json.evaluations as unknown[]).filter(isObject).filter(e => D2C_D2_STAGES.includes(e.stage as string)).map(e => {
    const plan = isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    return { evaluationId: e.evaluationId as string, stage: e.stage as string, targetLabel: typeof e.targetLabel === 'string' ? e.targetLabel : null, status: e.status as string,
      inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      generatedEntryIds: strings(e.generatedEntryIds), generatedEntrySha256s: strings(e.generatedEntrySha256s),
      termination: t === null ? null : { status: t.status as string, completedTargetCount: t.completedTargetCount as number, totalTargetCount: t.totalTargetCount as number },
      steps: plan && typeof plan.steps === 'number' ? plan.steps : null, selectedBuildListEntryIds: strings(plan?.selectedBuildListEntryIds),
      conflictCount: Array.isArray(e.conflicts) ? e.conflicts.length : null,
      b0Conflicts: e.stage === 'B0' && Array.isArray(e.conflicts) ? (e.conflicts as unknown[]).filter(isObject).map(c => ({ kind: c.kind as string, participants: strings(c.participants),
        resourceIdentity: typeof c.resourceIdentity === 'string' ? c.resourceIdentity : null })) : null,
      candidates: (Array.isArray(e.candidates) ? e.candidates as unknown[] : []).filter(isObject).map(c => ({ label: c.label as string, selected: typeof c.selected === 'boolean' ? c.selected : null,
        winnerBuildListEntryId: typeof c.winnerBuildListEntryId === 'string' ? c.winnerBuildListEntryId : null })),
      r5Satisfied: isObject(e.r5) && typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null,
      r1: isObject(e.r1r4) && typeof e.r1r4.R1 === 'boolean' ? e.r1r4.R1 : null }
  })
  const main = json.composition.main as Json
  const discoveryTargets = (Array.isArray(json.discovery.targets) ? json.discovery.targets as unknown[] : []).filter(isObject).map(t => ({ label: t.label as string,
    targetWeaponId: t.targetWeaponId as string, currentBuildListEntryId: t.currentBuildListEntryId as string,
    pool: (Array.isArray(t.pool) ? t.pool as unknown[] : []).filter(isObject).map(p => ({ ordinal: p.ordinal as number, keySha256: p.keySha256 as string,
      generatedBuildListEntryId: p.generatedBuildListEntryId as string, generatedEntry: structuredClone(p.generatedEntry) })) }))
  const ev = isObject(a.evaluations) ? a.evaluations : {}
  return {
    sources: { export: structuredClone(s.export), specDocument: structuredClone(s.specDocument), documents: structuredClone(s.documents), generatedEntries },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead),
      productionChangedFiles: structuredClone(p.productionChangedFiles), startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null },
    invalidReasons: structuredClone(json.invalidReasons), decisionCase: json.decision.case,
    aggregates: { unmeasuredByReason: structuredClone(ev.unmeasuredByReason), notExecutedByReason: structuredClone(ev.notExecutedByReason), byStatus: structuredClone(ev.byStatus),
      r6Satisfied: isObject(a.r6) ? a.r6.satisfied : null, pooledCandidates: isObject(a.discovery) ? a.discovery.pooledCandidates : null },
    discoveryTargets, evaluations,
    compositionMain: { steps: (Array.isArray(main.steps) ? main.steps as unknown[] : []).filter(isObject).map(st => ({ label: st.label as string, stepOutcome: st.stepOutcome as string,
      chosen: typeof st.chosen === 'string' ? st.chosen : null })), finalAccepted: structuredClone(main.finalAccepted), finalResultEvaluationId: main.finalResultEvaluationId,
      finalMetrics: structuredClone(main.finalMetrics) },
  }
}

export interface D2CPhaseBUnitProjection {
  unitId: string
  targetIndex: unknown
  contextRank: unknown
  rung: unknown
  cardinality: unknown
  result: unknown
  process: unknown
  search: { deliveredCandidates: unknown; exhausted: unknown; stoppedByExtent: unknown }
  deliveries: number | null
}
export interface D2CPhaseBResultProjection {
  sources: { export: unknown; targets: unknown; unitRecords: { file: string; bytes: number; sha256: string }[] }
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown; calculationCodeChangedSinceMeasuredHead: unknown }
  decisionCase: unknown
  units: D2CPhaseBUnitProjection[]
}

/** Reads ONLY the allowlisted Phase B RESULT fields (never an oracle-derived field or an oracle source entry). */
export function projectD2CPhaseBResult(json: unknown): D2CPhaseBResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !Array.isArray(json.units)) return null
  const s = json.sources, p = json.provenance
  const ids = new Set(D2C_PHASE_B_UNITS.map(u => u.unitId))
  const files = new Set(D2C_PHASE_B_UNITS.map(u => d2cPhaseBRecordFileName(u.unitId)))
  const unitRecords = (Array.isArray(s.unitRecords) ? s.unitRecords as unknown[] : []).filter(isObject).filter(r => files.has(r.file as string))
    .map(r => ({ file: r.file as string, bytes: r.bytes as number, sha256: r.sha256 as string }))
  const units = (json.units as unknown[]).filter(isObject).filter(u => ids.has(u.unitId as string)).map(u => {
    const search = isObject(u.search) ? u.search : {}
    return { unitId: u.unitId as string, targetIndex: u.targetIndex, contextRank: u.contextRank, rung: u.rung, cardinality: u.cardinality, result: u.result, process: u.process,
      search: { deliveredCandidates: search.deliveredCandidates, exhausted: search.exhausted, stoppedByExtent: search.stoppedByExtent },
      deliveries: Array.isArray(u.deliveries) ? u.deliveries.length : null }
  })
  return { sources: { export: structuredClone(s.export), targets: structuredClone(s.targets), unitRecords },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead) },
    decisionCase: json.decision.case, units }
}

/** §10.1: reads ONLY the allowlisted fields of a Phase B task file. */
export function projectD2CPhaseBTask(json: unknown) {
  if (!isObject(json)) return null
  return { unitId: json.unitId, targetWeaponId: json.targetWeaponId, targetIndex: json.targetIndex, contextRank: json.contextRank, rung: json.rung, extent: structuredClone(json.extent),
    cardinality: json.cardinality, supportBuildListEntryIds: structuredClone(json.supportBuildListEntryIds), reservationDigest: json.reservationDigest, currentBuildListEntryId: json.currentBuildListEntryId }
}

/** §10.1: reads ONLY `result.reservation` of a Phase B unit record (null when absent or not a JSON object). */
export function projectD2CPhaseBRecordReservation(json: unknown): Json | null {
  return isObject(json) && isObject(json.result) && isObject(json.result.reservation) ? structuredClone(json.result.reservation) : null
}

// ---------------------------------------------------------------- §3.1: the context derivation (V and the analyzer)

export interface D2CDerivedContext {
  contextId: string
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryId: string
  supportTargetWeaponId: string | null
  observations: number
  observedEvaluations: number
  orderInTarget: number
  b0Selected: boolean | null
  d2bFinalSelected: boolean | null
}
export interface D2CDerivation {
  issues: string[]
  scopeLabels: string[]
  contexts: D2CDerivedContext[]
  /** Per scope Target: every winner with its count and eligibility (diagnostic). */
  winners: { label: string; observedEvaluations: number; winners: { buildListEntryId: string; count: number; eligible: boolean; ineligibleReasons: string[] }[] }[]
}

/**
 * §3.1, mechanically: the scope Targets (D2 main-axis steps that did not accept), the provisional winners of every ADM / CMP / Z
 * evaluation of each, ordered by (count desc, Entry ID asc), the eligible ones (an Export Entry outside E1, not generated, not an E1
 * `O_t`), at most SUPPORT_CAP_PER_TARGET per Target. Co-participants never become a support. Pure.
 */
export function deriveD2CContexts(d2: D2CD2ResultProjection, exportEntries: readonly unknown[], e1TargetWeaponIds: readonly string[]): D2CDerivation {
  const issues: string[] = []
  const e1 = new Set(e1TargetWeaponIds)
  const discovery = new Map(d2.discoveryTargets.map(t => [t.label, t]))
  const oT = new Set(d2.discoveryTargets.map(t => t.currentBuildListEntryId))
  const exportById = new Map<string, Json[]>()
  for (const e of exportEntries) if (isObject(e) && typeof e.id === 'string') exportById.set(e.id, [...(exportById.get(e.id) ?? []), e])
  const scopeLabels = d2.compositionMain.steps.filter(s => s.stepOutcome !== 'accepted').map(s => s.label).sort(compare)
  const source = d2.evaluations.filter(e => e.stage === 'ADM' || e.stage === 'CMP' || e.stage === 'Z')
  const b0 = d2.evaluations.find(e => e.stage === 'B0') ?? null
  const final = d2.evaluations.find(e => e.evaluationId === d2.compositionMain.finalResultEvaluationId) ?? null
  const contexts: D2CDerivedContext[] = []
  const winners: D2CDerivation['winners'] = []
  for (const label of scopeLabels) {
    const target = discovery.get(label)
    if (!target) { issues.push(`${label}: no D2 RESULT discovery target`); continue }
    const targetIndex = Number(label.slice(1))
    if (!Number.isInteger(targetIndex) || e1TargetWeaponIds[targetIndex] !== target.targetWeaponId) issues.push(`${label}: the D2 RESULT Target is not the manifest Target ${targetIndex}`)
    const obs = source.filter(e => e.targetLabel === label)
    const count = new Map<string, number>()
    for (const e of obs) {
      if (e.status !== 'evaluated') issues.push(`${e.evaluationId}: a source evaluation that is not evaluated`)
      const own = e.candidates.filter(c => c.label === label)
      if (own.length !== 1) { issues.push(`${e.evaluationId}: ${own.length} candidates of ${label}, not exactly one`); continue }
      const c = own[0]!
      if (c.selected === false && c.winnerBuildListEntryId !== null) count.set(c.winnerBuildListEntryId, (count.get(c.winnerBuildListEntryId) ?? 0) + 1)
    }
    const ordered = [...count.entries()].sort(([a, x], [b, y]) => (y - x) || compare(a, b))
    const rows = ordered.map(([id, n]) => {
      const reasons: string[] = []
      const bodies = exportById.get(id) ?? []
      if (bodies.length !== 1) reasons.push('not exactly one Export Entry')
      const supportTarget = bodies.length === 1 && typeof bodies[0]!.targetWeaponId === 'string' ? bodies[0]!.targetWeaponId : null
      if (supportTarget === null || e1.has(supportTarget)) reasons.push('its Target is not outside E1')
      if (id.startsWith(D2C_GENERATED_ENTRY_PREFIX)) reasons.push('a generated Entry')
      if (oT.has(id)) reasons.push('an E1 O_t')
      return { buildListEntryId: id, count: n, eligible: reasons.length === 0, ineligibleReasons: reasons, supportTarget }
    })
    winners.push({ label, observedEvaluations: obs.length, winners: rows.map(r => ({ buildListEntryId: r.buildListEntryId, count: r.count, eligible: r.eligible, ineligibleReasons: r.ineligibleReasons })) })
    rows.filter(r => r.eligible).slice(0, D2C_SUPPORT_CAP_PER_TARGET).forEach((r, i) => {
      contexts.push({ contextId: d2cContextId(label, r.buildListEntryId), label, targetIndex, targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId,
        supportBuildListEntryId: r.buildListEntryId, supportTargetWeaponId: r.supportTarget, observations: r.count, observedEvaluations: obs.length, orderInTarget: i + 1,
        b0Selected: b0 === null ? null : b0.selectedBuildListEntryIds.includes(r.buildListEntryId), d2bFinalSelected: final === null ? null : final.selectedBuildListEntryIds.includes(r.buildListEntryId) })
    })
  }
  return { issues, scopeLabels, contexts, winners }
}

// ---------------------------------------------------------------- V: the registered inputs and their authority chain (§10.1)

export interface D2CObservedFile { bytes: number; sha256: string }

export interface D2CInputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D2CRegisteredInputKey, D2CObservedFile | null>
  manifest: unknown
  d2Result: unknown
  phaseBResult: unknown
  phase2c2Result: unknown
  /** By file name: the I0 G store files and their JSON (null = missing). */
  i0Files: Record<string, { file: D2CObservedFile; json: unknown } | null>
  /** By Phase B unit ID: the task / record files and their JSON (null = missing). */
  phaseBTasks: Record<string, { file: D2CObservedFile; json: unknown } | null>
  phaseBRecords: Record<string, { file: D2CObservedFile; json: unknown } | null>
  /** The Export `buildListEntries` (Entry ID -> Target ID, the support body). */
  exportBuildListEntries: readonly unknown[]
  /** The D2-C-A document text (the measurement HEAD git object). */
  specMarkdown: string
  /** The D1-A document text (a registered input). */
  d1SpecMarkdown: string
}

export interface D2CPhaseBReference { unitId: string; rung: Phase2C27BRungId; contextRank: number; taskReservationDigest: string; recordReservation: Json }

export interface D2CContext extends D2CDerivedContext {
  k: number
  /** §3.2 registered reservation digest (the C5 parity expectation), null for t05. */
  registeredReservationDigest: string | null
  phaseBUnits: D2CPhaseBReference[]
  /** The D2-B K0 pool of the same Target (D-4): ordinal and key SHA-256. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  /** B0 Conflicts in which the support Entry participates (diagnostic, §1.3). */
  b0SupportConflicts: { kind: string; participants: string[]; resourceIdentity: string | null }[]
}

export interface D2CI0Entry {
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  ordinal: number
  file: string
  bytes: number
  sha256: string
  generatedBuildListEntryId: string
}

export interface D2CD2Reference {
  b0: { evaluationId: string; inputDigest: string; resultDigest: string }
  i0: { evaluationId: string; inputDigest: string; resultDigest: string; completed: number; totalTargetCount: number; conflicts: number; steps: number; termination: string }
  /** inputDigest -> the D2 evaluations (allowlisted stages) holding it, for the D2-B determinism parity. */
  byInputDigest: Record<string, { evaluationId: string; status: string; resultDigest: string | null }[]>
}

export interface D2CScopeTarget { label: string; targetIndex: number; targetWeaponId: string; currentBuildListEntryId: string; contextIds: string[]; d2bK0Pool: { ordinal: number; keySha256: string }[] }

export interface D2CValidatedInputs {
  passed: boolean
  issues: string[]
  exportSha256: string | null
  e1TargetWeaponIds: string[]
  e1CurrentBuildListEntryIds: string[]
  scopeTargets: D2CScopeTarget[]
  contexts: D2CContext[]
  i0: D2CI0Entry[]
  d2: D2CD2Reference | null
  phase2c2BaselineSummary: unknown
  derivation: D2CDerivation | null
}

/** The Export SHA-256 the Phase B RESULT `sources.export` names (a registered input), or null. */
export function d2cChainedExportSha256(phaseBResult: unknown): string | null {
  const projection = projectD2CPhaseBResult(phaseBResult)
  const e = projection && isObject(projection.sources.export) ? projection.sources.export : null
  return e !== null && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256) ? e.sha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const

/**
 * V (§10.1): every registered input present with its registered digest; the Export chained through the Phase B RESULT, the D2
 * RESULT and the manifest and named by the D2-C text; the D2 RESULT (allowlist) the registered formal D2-B run; the §3.1 derivation
 * equal to the §3.2 table; the I0 G store bodies the D2-B final accepted set; the 10 Phase B units the §1.4 ones. Never repairs or
 * substitutes: any issue fails D2-C closed (`input_evidence`). Pure.
 */
export function validateD2CInputs(evidence: D2CInputEvidence): D2CValidatedInputs {
  const issues: string[] = [...d2cPolicyDrift()]
  const fail = (derivation: D2CDerivation | null = null): D2CValidatedInputs => ({ passed: false, issues, exportSha256: null, e1TargetWeaponIds: [], e1CurrentBuildListEntryIds: [], scopeTargets: [],
    contexts: [], i0: [], d2: null, phase2c2BaselineSummary: null, derivation })
  const exportSha = d2cChainedExportSha256(evidence.phaseBResult)
  for (const [key, registered] of Object.entries(D2C_REGISTERED_INPUTS) as [D2CRegisteredInputKey, D2CRegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? exportSha
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the Phase B RESULT`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (registered.bytes !== null && observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
  }
  const spec = evidence.specMarkdown
  if (exportSha === null || !spec.includes(exportSha)) issues.push('the chained Export SHA-256 is not the one the D2-C document registers')
  for (const registered of Object.values(D2C_REGISTERED_INPUTS)) if (registered.sha256 !== null && !d2NamesSha256(spec, registered.sha256)) issues.push(`${registered.file}: the D2-C document does not name its SHA-256`)
  for (const f of D2C_I0_FILES) if (!d2NamesSha256(spec, f.sha256)) issues.push(`${f.file}: the D2-C document does not name its SHA-256`)
  for (const u of D2C_PHASE_B_UNITS) if (!spec.includes(u.taskSha256) || !spec.includes(u.recordSha256)) issues.push(`${u.unitId}: the D2-C document does not name its task / record SHA-256`)

  // The manifest (Target IDs only).
  const manifest = parsePhase2C27BTargetManifest(evidence.manifest)
  if (!manifest.valid || manifest.manifest === null) { issues.push(...manifest.issues.map(i => `manifest: ${i}`)); return fail() }
  const ids = manifest.manifest.targetWeaponIds
  if (ids.length !== D2C_E1_TARGETS) issues.push(`the manifest holds ${ids.length} Targets, not 11`)
  if (manifest.manifest.exportSha256 !== exportSha) issues.push('the manifest Export is not the chained Export')

  // The D2 RESULT (allowlist).
  const d2 = projectD2CD2Result(evidence.d2Result)
  if (d2 === null) { issues.push('the D2 RESULT has no sources / provenance / decision / aggregates / discovery / evaluations / composition'); return fail() }
  if (d2.provenance.formal !== true) issues.push('D2 RESULT provenance.formal is not true')
  if (d2.provenance.measuredHead !== D2C_D2_PROVENANCE.measuredHead) issues.push('D2 RESULT measuredHead is not the registered one')
  if (d2.provenance.runStatus !== 'completed') issues.push('D2 RESULT runStatus is not completed')
  if (!Array.isArray(d2.provenance.calculationCodeChangedSinceMeasuredHead) || d2.provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2 RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(d2.provenance.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2 RESULT productionChangedFiles is not []')
  if (d2.provenance.startAttestationSha256 !== D2C_D2_PROVENANCE.startAttestationSha256 || !d2NamesSha256(spec, D2C_D2_PROVENANCE.startAttestationSha256)) issues.push('the D2 start attestation is not the registered one')
  if (!spec.includes(D2C_D2_PROVENANCE.measuredHead)) issues.push('the D2-C document does not name the D2 measured HEAD')
  if (!Array.isArray(d2.invalidReasons) || d2.invalidReasons.length !== 0) issues.push('D2 RESULT invalidReasons is not []')
  if (d2.decisionCase !== D2C_D2_PROVENANCE.decisionCase) issues.push('D2 RESULT decision.case is not D2A_EXCEEDS_D1_INCUMBENT')
  if (!same(d2.aggregates.unmeasuredByReason, {}) || !same(d2.aggregates.notExecutedByReason, {})) issues.push('D2 RESULT has an unmeasured / not executed evaluation')
  if (d2.aggregates.pooledCandidates !== D2C_D2_PROVENANCE.pooledCandidates) issues.push('D2 RESULT pool is not 32 Candidates')
  const d2Export = isObject(d2.sources.export) ? d2.sources.export : null
  if (d2Export === null || d2Export.sha256 !== exportSha || d2Export.bytes !== D2C_REGISTERED_INPUTS.export.bytes) issues.push('the D2 RESULT sources.export is not the chained Export')
  if (!isObject(d2.sources.specDocument) || d2.sources.specDocument.sha256 !== D2C_REGISTERED_INPUTS.d2SpecDocument.sha256) issues.push('the D2 RESULT sources.specDocument is not the registered D2-A document')
  const docs = isObject(d2.sources.documents) ? d2.sources.documents : {}
  const docSha = (k: string) => isObject(docs[k]) ? docs[k].sha256 : null
  if (docSha('phaseA') !== D2C_REGISTERED_INPUTS.phaseADocument.sha256 || docSha('phaseB') !== D2C_REGISTERED_INPUTS.phaseBDocument.sha256 || docSha('followup') !== D2C_REGISTERED_INPUTS.followupDocument.sha256
    || docSha('d1a') !== D2C_REGISTERED_INPUTS.d1SpecDocument.sha256 || docSha('d1b') !== D2C_REGISTERED_INPUTS.d1bDocument.sha256) issues.push('the D2 RESULT sources.documents are not the registered documents')
  if (d2.discoveryTargets.length !== D2C_E1_TARGETS) issues.push('the D2 RESULT discovery holds not 11 Targets')
  d2.discoveryTargets.forEach((t, i) => { if (t.label !== d2cTargetLabel(i) || t.targetWeaponId !== ids[i]) issues.push(`${t.label}: the D2 RESULT Target is not the manifest Target ${i}`) })
  if (d2.discoveryTargets.reduce((n, t) => n + t.pool.length, 0) !== D2C_D2_PROVENANCE.pooledCandidates) issues.push('the D2 RESULT discovery pools do not hold 32 Candidates')
  const adm = d2.evaluations.filter(e => e.stage === 'ADM')
  if (adm.length !== D2C_D2_PROVENANCE.admissionEvaluations || adm.some(e => e.status !== 'evaluated' || e.r1 !== true)) issues.push('the D2 RESULT ADM is not R1 32 / 32')
  const byEval = new Map(d2.evaluations.map(e => [e.evaluationId, e]))
  const comparisonEval = (id: string, baseline: { completed: number; totalTargetCount: number; conflicts: number; steps: number }) => {
    const e = byEval.get(id)
    if (!e || e.status !== 'evaluated' || e.termination === null || e.termination.completedTargetCount !== baseline.completed || e.termination.totalTargetCount !== baseline.totalTargetCount
      || e.conflictCount !== baseline.conflicts || e.steps !== baseline.steps || e.inputDigest === null || e.resultDigest === null) { issues.push(`D2 RESULT ${id} is not the §11.1 comparison value`); return null }
    if (!spec.includes(e.inputDigest) || !spec.includes(e.resultDigest)) issues.push(`D2 RESULT ${id} digests are not the ones the D2-C document names`)
    return e
  }
  const b0 = comparisonEval('B0', D2C_COMPARISON_BASELINES.baseline)
  const i0 = comparisonEval(D2C_COMPARISON_BASELINES.d2bMain.evaluationId, D2C_COMPARISON_BASELINES.d2bMain)
  if (i0 && (i0.r5Satisfied !== true || i0.termination?.status !== 'exhausted')) issues.push('D2 RESULT CMP-t09-c1 is not R5 satisfied / exhausted')
  if (d2.compositionMain.finalResultEvaluationId !== D2C_COMPARISON_BASELINES.d2bMain.evaluationId) issues.push('D2 RESULT finalResultEvaluationId is not CMP-t09-c1')
  if (!same(d2.compositionMain.finalMetrics, { completed: 22, conflicts: 20, steps: 1465 })) issues.push('D2 RESULT finalMetrics is not 22 / 20 / 1465')
  const byInputDigest: D2CD2Reference['byInputDigest'] = {}
  for (const e of d2.evaluations) if (e.inputDigest !== null) (byInputDigest[e.inputDigest] ??= []).push({ evaluationId: e.evaluationId, status: e.status, resultDigest: e.resultDigest })

  // The I0 set: the D2-B main-axis final accepted G store bodies.
  const finalAccepted = (Array.isArray(d2.compositionMain.finalAccepted) ? d2.compositionMain.finalAccepted as unknown[] : []).filter(isObject)
  if (!same(finalAccepted.map(a => [a.label, a.ordinal]), D2C_I0_FILES.map(f => [f.label, f.ordinal]))) issues.push('the D2 RESULT final accepted set is not the registered I0 set')
  const i0Entries: D2CI0Entry[] = []
  D2C_I0_FILES.forEach((registered, position) => {
    const at = registered.file
    const observed = evidence.i0Files[at] ?? null
    if (observed === null) { issues.push(`${at}: the D2-B G store file is missing`); return }
    if (observed.file.sha256 !== registered.sha256 || observed.file.bytes !== registered.bytes) issues.push(`${at}: the G store file is not the registered one`)
    const source = d2.sources.generatedEntries.find(g => g.file === at)
    if (!source || source.sha256 !== registered.sha256 || source.bytes !== registered.bytes) issues.push(`${at}: the G store file is not the one the D2 RESULT sources name`)
    if (i0 && i0.generatedEntrySha256s[position] !== registered.sha256) issues.push(`${at}: not the CMP-t09-c1 generatedEntrySha256s entry`)
    const targetIndex = Number(registered.label.slice(1))
    const target = d2.discoveryTargets[targetIndex]
    const accepted = finalAccepted[position]
    const body = isObject(observed.json) ? observed.json : null
    if (!target || !accepted || body === null || body.id !== accepted.generatedBuildListEntryId || body.targetWeaponId !== target.targetWeaponId || (i0 && i0.generatedEntryIds[position] !== body.id)) {
      issues.push(`${at}: the body is not the D2-B final accepted G of ${registered.label}`); return
    }
    const poolRow = target.pool.find(p => p.ordinal === registered.ordinal)
    if (!poolRow || poolRow.generatedBuildListEntryId !== body.id) issues.push(`${at}: not the D2 RESULT pool ordinal ${registered.ordinal} of ${registered.label}`)
    i0Entries.push({ label: registered.label, targetIndex, targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId, ordinal: registered.ordinal,
      file: at, bytes: observed.file.bytes, sha256: observed.file.sha256, generatedBuildListEntryId: String(body.id) })
  })

  // The Phase B RESULT (allowlist) and the 10 Phase B units.
  const phaseB = projectD2CPhaseBResult(evidence.phaseBResult)
  if (phaseB === null) { issues.push('the Phase B RESULT has no sources / provenance / decision / units'); return fail() }
  if (phaseB.provenance.formal !== true) issues.push('Phase B RESULT provenance.formal is not true')
  if (phaseB.provenance.measuredHead !== D1_PHASE_B_PROVENANCE.measuredHead) issues.push('Phase B RESULT measuredHead is not the registered one')
  if (phaseB.provenance.runStatus !== 'completed') issues.push('Phase B RESULT runStatus is not completed')
  if (!Array.isArray(phaseB.provenance.calculationCodeChangedSinceMeasuredHead) || phaseB.provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('Phase B RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (phaseB.decisionCase !== D1_PHASE_B_PROVENANCE.decisionCase) issues.push('Phase B RESULT decision.case is not B2C27B_INCOMPLETE')
  const pbExport = isObject(phaseB.sources.export) ? phaseB.sources.export : null
  if (pbExport === null || pbExport.bytes !== D2C_REGISTERED_INPUTS.export.bytes) issues.push('the Phase B RESULT sources.export is not the registered Export')
  const pbTargets = isObject(phaseB.sources.targets) ? phaseB.sources.targets : null
  if (pbTargets === null || pbTargets.sha256 !== D2C_REGISTERED_INPUTS.phaseBTargets.sha256) issues.push('the Phase B RESULT sources.targets is not the registered manifest')
  const phaseBRefs = new Map<string, D2CPhaseBReference & { targetWeaponId: string; targetIndex: number; supportBuildListEntryId: string; currentBuildListEntryId: string }>()
  for (const registered of D2C_PHASE_B_UNITS) {
    const at = registered.unitId
    const unit = phaseB.units.find(u => u.unitId === at)
    if (!unit || unit.process !== 'completed' || unit.result !== 'stopped_by_search_extent_bound' || unit.search.deliveredCandidates !== 0 || unit.deliveries !== 0 || unit.cardinality !== 1
      || unit.search.stoppedByExtent !== true || unit.search.exhausted !== false) issues.push(`${at}: the Phase B RESULT unit is not a completed K1 extent-bound unit with 0 deliveries`)
    const source = phaseB.sources.unitRecords.find(r => r.file === d2cPhaseBRecordFileName(at))
    if (!source || source.sha256 !== registered.recordSha256 || source.bytes !== registered.recordBytes) issues.push(`${at}: the Phase B RESULT sources.unitRecords does not name the registered record`)
    const task = evidence.phaseBTasks[at] ?? null, record = evidence.phaseBRecords[at] ?? null
    if (task === null || record === null) { issues.push(`${at}: the Phase B task / record file is missing`); continue }
    if (task.file.sha256 !== registered.taskSha256 || task.file.bytes !== registered.taskBytes) issues.push(`${at}: the task file is not the registered one`)
    if (record.file.sha256 !== registered.recordSha256 || record.file.bytes !== registered.recordBytes) issues.push(`${at}: the record file is not the registered one`)
    const t = projectD2CPhaseBTask(task.json)
    const reservation = projectD2CPhaseBRecordReservation(record.json)
    const rung = typeof t?.rung === 'string' ? t.rung as Phase2C27BRungId : null
    if (t === null || t.unitId !== at || rung === null || !PHASE2C27B_RUNG_IDS.includes(rung) || !same(t.extent, d2cRungExtent(rung)) || t.cardinality !== 1 || !Array.isArray(t.supportBuildListEntryIds)
      || t.supportBuildListEntryIds.length !== 1 || typeof t.supportBuildListEntryIds[0] !== 'string' || typeof t.targetWeaponId !== 'string' || typeof t.targetIndex !== 'number'
      || typeof t.reservationDigest !== 'string' || typeof t.currentBuildListEntryId !== 'string' || typeof t.contextRank !== 'number' || unit?.rung !== rung || unit.targetIndex !== t.targetIndex
      || unit.contextRank !== t.contextRank || ids[t.targetIndex] !== t.targetWeaponId) { issues.push(`${at}: the task is not a K1 task of its manifest Target`); continue }
    if (reservation === null) { issues.push(`${at}: the record has no result.reservation object`); continue }
    phaseBRefs.set(at, { unitId: at, rung, contextRank: t.contextRank, taskReservationDigest: t.reservationDigest, recordReservation: reservation, targetWeaponId: t.targetWeaponId,
      targetIndex: t.targetIndex, supportBuildListEntryId: t.supportBuildListEntryIds[0] as string, currentBuildListEntryId: t.currentBuildListEntryId })
  }

  // The Phase 2-C2 baseline summary.
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  // §3.1 derivation against the §3.2 table and the D1-A §1.3 table.
  const derivation = deriveD2CContexts(d2, evidence.exportBuildListEntries, ids)
  issues.push(...derivation.issues)
  if (derivation.scopeLabels.length !== D2C_SCOPE_TARGETS) issues.push(`${derivation.scopeLabels.length} scope Targets, not 6`)
  const table = parseD2CSpecContextTable(spec)
  if (table.length !== D2C_CONTEXTS) issues.push(`the D2-C §3.2 table holds ${table.length} rows, not 7`)
  if (derivation.contexts.length !== table.length) issues.push(`the derivation gives ${derivation.contexts.length} contexts, the §3.2 table ${table.length}`)
  const d1Rows = parseD1SpecTables(evidence.d1SpecMarkdown).found
  const d1T09 = d1Rows.find(r => r.t === d2cTargetLabel(9)) ?? null
  const contexts: D2CContext[] = []
  derivation.contexts.forEach((c, index) => {
    const row = table[index]
    const at = c.contextId
    if (!row || row.k !== index + 1 || row.contextId !== c.contextId || row.label !== c.label || row.targetWeaponId !== c.targetWeaponId || row.currentBuildListEntryId !== c.currentBuildListEntryId
      || row.supportBuildListEntryId !== c.supportBuildListEntryId || row.observations !== c.observations || row.observedEvaluations !== c.observedEvaluations || row.orderInTarget !== c.orderInTarget) {
      issues.push(`${at}: the §3.1 derivation is not the §3.2 table row ${index + 1}`); return
    }
    const d1 = d1Rows.find(r => r.t === c.label)
    if (!d1 || d1.targetWeaponId !== c.targetWeaponId || d1.currentBuildListEntryId !== c.currentBuildListEntryId) issues.push(`${at}: the Target / O_t is not the D1-A §1.3 row`)
    if (c.b0Selected !== true) issues.push(`${at}: the support Entry is not B0 selected as §1.3 / §3.2 register`)
    if (row.registeredReservationDigest !== null && d1T09 !== null && d1T09.supportBuildListEntryIds[0] === c.supportBuildListEntryId && d1T09.reservationDigest !== row.registeredReservationDigest) {
      issues.push(`${at}: the registered digest is not the D1-A §1.3 t09 digest of the same support`)
    }
    const refs = [...phaseBRefs.values()].filter(r => r.targetIndex === c.targetIndex && r.supportBuildListEntryId === c.supportBuildListEntryId)
      .sort((a, b) => PHASE2C27B_RUNG_IDS.indexOf(a.rung) - PHASE2C27B_RUNG_IDS.indexOf(b.rung))
    if (!same(refs.map(r => r.unitId), row.phaseBUnitIds)) issues.push(`${at}: the Phase B tasks of this (Target, support) are not the §3.2 reference units`)
    for (const r of refs) {
      if (r.currentBuildListEntryId !== c.currentBuildListEntryId || r.targetWeaponId !== c.targetWeaponId) issues.push(`${r.unitId}: the task Target / O_t is not the context's`)
      if (r.taskReservationDigest !== row.registeredReservationDigest) issues.push(`${r.unitId}: the task reservation digest is not the §3.2 registered digest`)
    }
    if ((row.registeredReservationDigest === null) !== (refs.length === 0)) issues.push(`${at}: a registered digest and the Phase B reference units do not go together`)
    if (row.registeredReservationDigest !== null && !spec.includes(`\`${row.registeredReservationDigest}\``)) issues.push(`${at}: the registered digest is not named by the D2-C document`)
    const target = d2.discoveryTargets[c.targetIndex]
    const b0Conflicts = (byEval.get('B0')?.b0Conflicts ?? []).filter(x => x.participants.includes(c.supportBuildListEntryId))
    contexts.push({ ...c, k: index + 1, registeredReservationDigest: row.registeredReservationDigest,
      phaseBUnits: refs.map(({ unitId, rung, contextRank, taskReservationDigest, recordReservation }) => ({ unitId, rung, contextRank, taskReservationDigest, recordReservation })),
      d2bK0Pool: (target?.pool ?? []).map(p => ({ ordinal: p.ordinal, keySha256: p.keySha256 })), b0SupportConflicts: b0Conflicts })
  })
  const usedUnits = new Set(contexts.flatMap(c => c.phaseBUnits.map(u => u.unitId)))
  for (const u of D2C_PHASE_B_UNITS) if (!usedUnits.has(u.unitId)) issues.push(`${u.unitId}: no context uses this Phase B unit`)
  const scopeTargets: D2CScopeTarget[] = derivation.scopeLabels.map(label => {
    const index = Number(label.slice(1))
    const t = d2.discoveryTargets[index]!
    return { label, targetIndex: index, targetWeaponId: t?.targetWeaponId ?? '', currentBuildListEntryId: t?.currentBuildListEntryId ?? '', contextIds: contexts.filter(c => c.label === label).map(c => c.contextId),
      d2bK0Pool: (t?.pool ?? []).map(p => ({ ordinal: p.ordinal, keySha256: p.keySha256 })) }
  })
  if (!same(scopeTargets.map(t => t.d2bK0Pool.length), [3, 2, 3, 3, 3, 3])) issues.push('the D2-B K0 pools of the scope Targets are not 3 / 2 / 3 / 3 / 3 / 3')
  if (i0Entries.some(e => scopeTargets.some(t => t.label === e.label))) issues.push('an I0 Target is a scope Target')

  const passed = issues.length === 0
  return { passed, issues, exportSha256: passed ? exportSha : null, e1TargetWeaponIds: passed ? [...ids] : [], e1CurrentBuildListEntryIds: passed ? d2.discoveryTargets.map(t => t.currentBuildListEntryId) : [],
    scopeTargets: passed ? scopeTargets : [], contexts: passed ? contexts : [], i0: passed ? i0Entries : [],
    d2: passed && b0 && i0 ? { b0: { evaluationId: 'B0', inputDigest: b0.inputDigest!, resultDigest: b0.resultDigest! },
      i0: { evaluationId: i0.evaluationId, inputDigest: i0.inputDigest!, resultDigest: i0.resultDigest!, completed: i0.termination!.completedTargetCount, totalTargetCount: i0.termination!.totalTargetCount,
        conflicts: i0.conflictCount!, steps: i0.steps!, termination: i0.termination!.status }, byInputDigest } : null,
    phase2c2BaselineSummary: passed ? structuredClone(phase2c2) : null, derivation }
}

// ---------------------------------------------------------------- CTX (§4.1 / §7.1)

export interface D2CContextTask {
  unitId: string
  contextId: string
  k: number
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryId: string
  /** The E1 manifest Targets and their `O_t` (C1). */
  e1TargetWeaponIds: string[]
  e1CurrentBuildListEntryIds: string[]
  /** §3.2 registered digest (C5), null for t05. */
  registeredReservationDigest: string | null
  /** The Phase B reference unit records' `result.reservation` (C5). */
  phaseBReservations: { unitId: string; reservation: Json }[]
  researchMaxPlanSteps: number
}

export interface D2CContextChecks {
  C1: { satisfied: boolean; issues: string[] }
  C2: { satisfied: boolean; issues: string[] }
  C3: { satisfied: boolean; referencedOwnedWeaponIds: string[]; exclusiveConsumedOwnedWeaponIds: string[]; exclusiveOwnedWeaponIds: string[] }
  C4: { satisfied: boolean; issues: string[] }
  C5: { state: 'matched' | 'mismatched' | 'not_applicable'; expectedDigest: string | null; digestMatched: boolean | null; phaseBUnitIds: string[]; bodyMatched: boolean[] }
}

export interface D2CContextRecord {
  status: 'context_ready' | 'guardrail_violation'
  unitId: string
  contextId: string
  k: number
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryId: string
  supportTargetWeaponId: string | null
  supportBodySha256: string | null
  /** The derived `PlannerAlternativeReservation` as a JSON object (`structuredClone`, never a string; §4.1). */
  reservationBody: Json | null
  reservationDigest: string | null
  originDigest: string | null
  scheduleOriginDigest: string
  excludedRouteKeys: string[]
  excludedRouteKeySha256s: string[]
  scheduleExcludedRouteKeys: string[]
  conflictContextCount: number | null
  checks: D2CContextChecks
  issues: string[]
}

/** C5 (§7.1): the registered digest and the Phase B record bodies (both objects through `stableStringify()`). */
export function d2cContextParity(reservationBody: unknown, reservationDigest: string | null, registeredDigest: string | null, phaseB: readonly { unitId: string; reservation: unknown }[]): D2CContextChecks['C5'] {
  if (registeredDigest === null) return { state: 'not_applicable', expectedDigest: null, digestMatched: null, phaseBUnitIds: phaseB.map(p => p.unitId), bodyMatched: [] }
  const isBody = isObject(reservationBody)
  const digestMatched = reservationDigest === registeredDigest
  const bodyMatched = phaseB.map(p => isBody && isObject(p.reservation) && stableStringify(reservationBody) === stableStringify(p.reservation))
  const ok = digestMatched && phaseB.length > 0 && bodyMatched.every(Boolean)
  return { state: ok ? 'matched' : 'mismatched', expectedDigest: registeredDigest, digestMatched, phaseBUnitIds: phaseB.map(p => p.unitId), bodyMatched }
}

/**
 * CTX-<k> (§4.1): the context record, from Production parts only - the B2-C1 schedule (origin digest, current Route key, policy
 * drift), `phase2c27bResolveSupportContext(baseline, t, [s])` (the Phase B / D2 path), the support Entry of the Export, its unit
 * plan (`createPlannerRouteUnitPlans()`) for C3 - with C1 .. C5. No Search and no full run. C1 .. C4 failing is a guardrail
 * violation; C5 is recorded for the parity (`phase_b_k1_context`).
 */
export function prepareD2CContextRecord(input: PlannerInput, schedule: Phase2C26B2C1Schedule, exportBuildListEntries: readonly unknown[], task: D2CContextTask, dependencies: PlannerDependencies,
  sha256OfText: (text: string) => string): D2CContextRecord {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule), ...d2cPolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2C_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2C_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (task.unitId !== d2cContextUnitId(task.k) || task.contextId !== d2cContextId(task.label, task.supportBuildListEntryId)) issues.push('unitId / contextId')
  // C1
  const c1: string[] = []
  const bodies = exportBuildListEntries.filter(e => isObject(e) && e.id === task.supportBuildListEntryId) as Json[]
  const supportBody = bodies.length === 1 ? bodies[0]! : null
  if (supportBody === null) c1.push(`${bodies.length} Export Entries hold the support ID`)
  const supportTarget = supportBody !== null && typeof supportBody.targetWeaponId === 'string' ? supportBody.targetWeaponId : null
  if (supportTarget === null || task.e1TargetWeaponIds.includes(supportTarget)) c1.push('the support Target is not outside E1')
  if (task.supportBuildListEntryId.startsWith(D2C_GENERATED_ENTRY_PREFIX)) c1.push('the support Entry is a generated Entry')
  if (task.e1CurrentBuildListEntryIds.includes(task.supportBuildListEntryId)) c1.push('the support Entry is an E1 O_t')
  if (task.e1TargetWeaponIds.length !== D2C_E1_TARGETS || task.e1CurrentBuildListEntryIds.length !== D2C_E1_TARGETS || !task.e1TargetWeaponIds.includes(task.targetWeaponId)) c1.push('the E1 lists are not the 11 manifest Targets')
  // C2
  const c2: string[] = []
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, [task.supportBuildListEntryId])
  if (resolved.status !== 'ready') c2.push(...resolved.issues)
  else if (resolved.prepared.invalidated.id !== task.currentBuildListEntryId) c2.push('the current Entry is not the registered O_t')
  const prepared = resolved.status === 'ready' ? resolved.prepared : null
  const reservation = prepared?.reservation ?? null
  // C3
  const referenced = supportBody !== null && isObject(supportBody.candidateSnapshot) && isObject(supportBody.candidateSnapshot.route)
    ? collectReferencedOwnedWeaponIds((supportBody as unknown as BuildListEntry).candidateSnapshot.route).map(String).sort(compare) : []
  const plans = supportBody !== null ? createPlannerRouteUnitPlans([supportBody as unknown as BuildListEntry], dependencies.rngEngine) : null
  const consumed = plans === null ? [] : sortedIds([...new Set([...(plans.unitPlans.get(task.supportBuildListEntryId as never) ?? [])].map(u => u.exclusiveConsumedOwnedWeaponId).filter((x): x is NonNullable<typeof x> => x !== null).map(String))])
  const exclusive = reservation === null ? [] : sortedIds(reservation.exclusiveOwnedWeaponIds.map(String))
  const c3 = reservation !== null && supportBody !== null && (plans?.rejections.length ?? 1) === 0 && [...referenced, ...consumed].every(id => exclusive.includes(id))
  // C4
  const c4: string[] = []
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const originDigest = prepared === null ? null : hashStableValue(prepared.origin)
  if (originDigest !== schedule.snapshot.originDigest) c4.push('the Planner-start origin does not hash to the schedule snapshot origin digest')
  if (!snapshotTarget) c4.push('the Target is not a schedule snapshot Target')
  else if (prepared !== null) {
    if (snapshotTarget.currentBuildListEntryId !== task.currentBuildListEntryId) c4.push('the schedule current Entry is not O_t')
    if (prepared.excludedRouteKeys.length !== 1 || prepared.excludedRouteKeys[0] !== candidateStableKey(prepared.invalidated.candidateSnapshot)
      || prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) c4.push('excludedRouteKeys is not [candidateStableKey(O_t)] (the schedule ones)')
    if (!same(prepared.supportBuildListEntryIds, [task.supportBuildListEntryId])) c4.push('the support set is not [s]')
  }
  const reservationBody = reservation === null ? null : structuredClone(reservation) as unknown as Json
  const reservationDigest = reservation === null ? null : hashStableValue(reservation)
  const c5 = reservationBody === null ? { state: 'mismatched' as const, expectedDigest: task.registeredReservationDigest, digestMatched: false, phaseBUnitIds: task.phaseBReservations.map(p => p.unitId), bodyMatched: [] }
    : d2cContextParity(reservationBody, reservationDigest, task.registeredReservationDigest, task.phaseBReservations)
  if (task.registeredReservationDigest === null && task.phaseBReservations.length !== 0) issues.push('Phase B reference records without a registered digest')
  const checks: D2CContextChecks = { C1: { satisfied: c1.length === 0, issues: c1 }, C2: { satisfied: c2.length === 0, issues: c2 },
    C3: { satisfied: c3, referencedOwnedWeaponIds: referenced, exclusiveConsumedOwnedWeaponIds: consumed, exclusiveOwnedWeaponIds: exclusive }, C4: { satisfied: c4.length === 0, issues: c4 }, C5: c5 }
  const ready = issues.length === 0 && checks.C1.satisfied && checks.C2.satisfied && checks.C3.satisfied && checks.C4.satisfied
  return { status: ready ? 'context_ready' : 'guardrail_violation', unitId: task.unitId, contextId: task.contextId, k: task.k, label: task.label, targetWeaponId: task.targetWeaponId,
    currentBuildListEntryId: task.currentBuildListEntryId, supportBuildListEntryId: task.supportBuildListEntryId, supportTargetWeaponId: supportTarget,
    supportBodySha256: supportBody === null ? null : sha256OfText(stableStringify(supportBody)), reservationBody, reservationDigest, originDigest, scheduleOriginDigest: schedule.snapshot.originDigest,
    excludedRouteKeys: prepared === null ? [] : [...prepared.excludedRouteKeys], excludedRouteKeySha256s: prepared === null ? [] : prepared.excludedRouteKeys.map(sha256OfText),
    scheduleExcludedRouteKeys: snapshotTarget ? [...snapshotTarget.excludedRouteKeys] : [], conflictContextCount: prepared === null ? null : prepared.conflictContexts.length, checks, issues }
}

/** §4.1: a CTX record read back from its file: `result` with `reservationBody` a JSON object (never a string), or the issue. */
export function readD2CContextRecord(json: unknown): { record: D2CContextRecord | null; issue: string | null } {
  const result = isObject(json) && isObject(json.result) ? json.result : null
  if (result === null) return { record: null, issue: 'the context record has no result' }
  if (result.status === 'context_ready') {
    if (!isObject(result.reservationBody)) return { record: null, issue: `reservationBody is ${result.reservationBody === null ? 'null' : Array.isArray(result.reservationBody) ? 'an array' : typeof result.reservationBody}, not a JSON object` }
    if (typeof result.reservationDigest !== 'string' || typeof result.supportBodySha256 !== 'string' || typeof result.originDigest !== 'string' || !Array.isArray(result.excludedRouteKeys)) {
      return { record: null, issue: 'the context record lacks reservationDigest / supportBodySha256 / originDigest / excludedRouteKeys' }
    }
  }
  return { record: result as unknown as D2CContextRecord, issue: null }
}

// ---------------------------------------------------------------- DSC (§4.2 - §4.5)

export type D2CDiscoveryUnitStatus = D2DiscoveryMeasuredStatus | 'discovery_calculation_error' | 'guardrail_violation' | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'not_executed'
export const D2C_DISCOVERY_MEASURED: readonly D2CDiscoveryUnitStatus[] = ['discovery_cap_reached', 'stopped_by_search_extent_bound', 'discovery_exhausted', 'ladder_exhausted']
export type D2CDiscoveryStop = 'discovery_cap_reached' | 'discovery_exhausted' | 'ladder_exhausted' | 'unmeasured' | 'not_executed'

/** §4.4: after one unit, the next rung of the same context or the context's discovery stop (K1_POOL_CAP = 2). */
export function d2cDiscoveryNext(status: D2CDiscoveryUnitStatus, rung: Phase2C27BRungId, poolSize: number): { next: Phase2C27BRungId | null; stop: D2CDiscoveryStop | null } {
  if (status === 'discovery_cap_reached' || status === 'discovery_exhausted' || status === 'ladder_exhausted') return { next: null, stop: status }
  if (status === 'stopped_by_search_extent_bound') {
    if (poolSize >= D2C_K1_POOL_CAP) throw new D1InvariantError('an extent-bound unit with a full pool')
    const next = PHASE2C27B_RUNG_IDS[PHASE2C27B_RUNG_IDS.indexOf(rung) + 1] ?? null
    return next === null ? { next: null, stop: 'ladder_exhausted' } : { next, stop: null }
  }
  if (status === 'not_executed') return { next: null, stop: 'not_executed' }
  return { next: null, stop: 'unmeasured' }
}

/**
 * §8.1 rung-major discovery order, shared by the runner and the analyzer: L0 for k = 1 -> 7, then L1 for every context whose L0
 * escalated (k ascending), then L2. A context whose CTX is not `context_ready` gets one `not_executed` (dependency_unmeasured) item
 * per rung. `report()` feeds a unit's status and the pool size so the next pass knows which contexts escalated.
 */
export class D2CDiscoveryScheduler {
  private readonly states: Map<number, { ready: boolean; next: Phase2C27BRungId | null; stop: D2CDiscoveryStop | null }>
  constructor(ks: readonly number[], ready: (k: number) => boolean) {
    this.states = new Map(ks.map(k => [k, { ready: ready(k), next: ready(k) ? 'L0' as Phase2C27BRungId : null, stop: ready(k) ? null : 'not_executed' as D2CDiscoveryStop }]))
  }
  *items(): Generator<{ k: number; rung: Phase2C27BRungId; dependency: boolean }> {
    for (const rung of PHASE2C27B_RUNG_IDS) {
      for (const k of [...this.states.keys()].sort((a, b) => a - b)) {
        const s = this.states.get(k)!
        if (!s.ready) yield { k, rung, dependency: true }
        else if (s.next === rung) yield { k, rung, dependency: false }
      }
    }
  }
  report(k: number, rung: Phase2C27BRungId, status: D2CDiscoveryUnitStatus, poolSize: number) {
    const s = this.states.get(k)!
    if (!s.ready) return
    const n = D2C_DISCOVERY_MEASURED.includes(status) ? d2cDiscoveryNext(status, rung, poolSize) : d2cDiscoveryNext(status === 'not_executed' ? 'not_executed' : 'timeout', rung, poolSize)
    s.next = n.next
    s.stop = n.stop
  }
  stop(k: number): D2CDiscoveryStop | null { return this.states.get(k)?.stop ?? null }
}

export interface D2CDiscoveryTask {
  unitId: string
  contextId: string
  k: number
  label: string
  targetWeaponId: string
  supportBuildListEntryId: string
  currentBuildListEntryId: string
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  /** The CTX record values the re-derived context must equal (context drift, §4.2). */
  context: { recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeys: string[] }
  /** `candidateStableKey()` of every pooled Candidate of this context before this unit, in discovery order. */
  poolKeysAtStart: string[]
  /** D-4: the D2-B K0 pool of the Target. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  poolCap: number
  researchMaxPlanSteps: number
}

export type D2CDeliveryAction = 'pooled' | 'duplicate_of_lower_rung' | 'same_key_as_d2b_k0_pool'
export interface D2CDiscoveryDelivery {
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  action: D2CDeliveryAction
  r0: { respects: boolean }
  d2bK0Ordinal: number | null
}
export interface D2CPooledCandidate {
  /** 1-based index in the context pool (rung, then delivery order). */
  indexInContext: number
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  r0: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  searchIdentity: string
  reservationDigest: string
  generatedBuildListEntryId: string
  reusedExisting: boolean
  replacement: { status: string; replacedBuildListEntryId: string | null }
  /** The G store body (the child script writes it to the run dir and drops it from the record). */
  generatedEntry: BuildListEntry | null
}

export type D2CDiscoveryChildResult =
  | { status: D2DiscoveryMeasuredStatus; unitId: string; contextId: string; rung: Phase2C27BRungId; poolSizeAtStart: number; deliveries: D2CDiscoveryDelivery[]; pooled: D2CPooledCandidate[]; searchIdentity: string;
      observedContext: { reservationDigest: string; originDigest: string; excludedRouteKeys: string[]; currentBuildListEntryId: string };
      search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean; skippedExcludedRouteKeys: number };
      timing: { searchVisitMs: number; materializeMs: number; searchOnlyMs: number } }
  | { status: 'discovery_calculation_error'; unitId: string; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; unitId: string; issues: string[] }

/**
 * One discovery unit (§4.2): re-derives the support context and checks it against the CTX record (context drift), then runs the
 * unchanged Production Search at the rung extent with the context reservation and the current Route excluded (no capture policy,
 * no reordering). Each delivery: R0 (guardrail), D-1 (guardrail), D-2 (`duplicate_of_lower_rung`), D-4
 * (`same_key_as_d2b_k0_pool`), otherwise materialized against the baseline Entries and pooled until the context pool holds 2. No
 * trial runs. Typed Search / materialization errors become `discovery_calculation_error`.
 */
export async function runD2CDiscoveryUnit(input: PlannerInput, task: D2CDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2CDiscoveryChildResult> {
  try {
    return await discover(input, task, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', unitId: task.unitId, issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'discovery_calculation_error', unitId: task.unitId, error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function discover(input: PlannerInput, task: D2CDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2CDiscoveryChildResult> {
  const now = options.now ?? (() => performance.now())
  const sha = options.sha256OfText
  const issues: string[] = [...d2cPolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2C_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2C_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, d2cRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (task.unitId !== d2cDiscoveryUnitId(task.k, task.rung) || task.contextId !== d2cContextId(task.label, task.supportBuildListEntryId)) issues.push('unitId / contextId')
  if (task.poolCap !== D2C_K1_POOL_CAP || task.poolKeysAtStart.length >= D2C_K1_POOL_CAP || new Set(task.poolKeysAtStart).size !== task.poolKeysAtStart.length) issues.push('the pool at start is not below K1_POOL_CAP and distinct')
  if (!isObject(task.context.reservationBody)) issues.push('the CTX reservationBody is not a JSON object')
  if (issues.length > 0) return { status: 'guardrail_violation', unitId: task.unitId, issues }
  // Context drift (§4.2): the re-derived context must be the CTX record one (both reservation sides objects).
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, [task.supportBuildListEntryId])
  if (resolved.status !== 'ready') return { status: 'guardrail_violation', unitId: task.unitId, issues: ['context_drift: the support context is not ready', ...resolved.issues] }
  const prepared = resolved.prepared
  const drift: string[] = []
  if (stableStringify(prepared.reservation) !== stableStringify(task.context.reservationBody)) drift.push('the reservation body differs from the CTX record')
  if (hashStableValue(prepared.reservation) !== task.context.reservationDigest) drift.push('the reservation digest differs from the CTX record')
  if (hashStableValue(prepared.origin) !== task.context.originDigest) drift.push('the origin digest differs from the CTX record')
  if (!same(prepared.excludedRouteKeys, task.context.excludedRouteKeys)) drift.push('excludedRouteKeys differ from the CTX record')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) drift.push('O_t differs from the CTX record')
  if (!same(prepared.supportBuildListEntryIds, [task.supportBuildListEntryId])) drift.push('the support set is not [s]')
  if (drift.length > 0) return { status: 'guardrail_violation', unitId: task.unitId, issues: drift.map(d => `context_drift: ${d}`) }

  const engine = dependencies.rngEngine
  const searchInput = { origin: prepared.origin, targetWeaponId: task.targetWeaponId as never, extent: { ...task.extent }, reservation: prepared.reservation, excludedRouteKeys: [...prepared.excludedRouteKeys] }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: dependencies.clock })
  const searchIdentity = createPlannerAlternativeSearchIdentity(searchInput)
  const reservationDigest = hashStableValue(prepared.reservation)
  const prior = new Set(task.poolKeysAtStart)
  const d2b = new Map(task.d2bK0Pool.map(p => [p.keySha256, p.ordinal]))
  const poolSizeAtStart = task.poolKeysAtStart.length
  const seen = new Set<string>()
  const deliveries: D2CDiscoveryDelivery[] = []
  const pooled: D2CPooledCandidate[] = []
  let materializeMs = 0
  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, async (candidate: PlannerAlternativeCandidate) => {
    const indexInUnit = deliveries.length
    const key = candidateStableKey(candidate)
    const keySha256 = sha(key)
    if (seen.has(key)) throw new D1InvariantError(`D-1: delivery ${indexInUnit} repeats a key of this unit`)
    seen.add(key)
    const started = now()
    const summary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(candidate, []).entry, input, engine)
    const r0 = respectsPhase2C2Reservation(summary, candidate.route, prepared.reservation)
    if (!r0.respects) throw new D1InvariantError(`R0: delivery ${indexInUnit} does not respect the context reservation`)
    const base = { indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, r0: { respects: r0.respects } }
    if (prior.has(key)) {
      deliveries.push({ ...base, action: 'duplicate_of_lower_rung', d2bK0Ordinal: null })
      materializeMs += now() - started
      return 'continue'
    }
    const d2bOrdinal = d2b.get(keySha256)
    if (d2bOrdinal !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2b_k0_pool', d2bK0Ordinal: d2bOrdinal })
      materializeMs += now() - started
      return 'continue'
    }
    const generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    const replacement = resolveBuildListEntryReplacement(input.buildListEntries, generated.entry)
    materializeMs += now() - started
    pooled.push({ indexInContext: poolSizeAtStart + pooled.length + 1, indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, routeKind: candidate.route.kind,
      routeOperationCount: candidate.route.operations.length, r0: structuredClone(r0), searchIdentity, reservationDigest, generatedBuildListEntryId: generated.entry.id,
      reusedExisting: generated.reusedExisting,
      replacement: replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId } : { status: replacement.status, replacedBuildListEntryId: null },
      generatedEntry: structuredClone(generated.entry) })
    deliveries.push({ ...base, action: 'pooled', d2bK0Ordinal: null })
    return poolSizeAtStart + pooled.length >= task.poolCap ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const searchVisitMs = now() - visitStarted
  const search = { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
    stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length }
  if (deliveries.length > D2C_BUDGETS.deliveriesPerUnitMax) throw new D1InvariantError(`${deliveries.length} deliveries, above ${D2C_BUDGETS.deliveriesPerUnitMax}`)
  const status = d2DiscoveryUnitOutcome(search, execution.stoppedByConsumer, task.rung)
  return { status, unitId: task.unitId, contextId: task.contextId, rung: task.rung, poolSizeAtStart, deliveries, pooled, searchIdentity,
    observedContext: { reservationDigest, originDigest: hashStableValue(prepared.origin), excludedRouteKeys: [...prepared.excludedRouteKeys], currentBuildListEntryId: prepared.invalidated.id },
    search, timing: { searchVisitMs, materializeMs, searchOnlyMs: searchVisitMs - materializeMs } }
}

// ---------------------------------------------------------------- evaluations (§5 / §6, the unchanged runD2Evaluation())

export type D2CStage = 'B0' | 'I0' | 'ADM' | 'CMP'
export type D2CEvaluatedAgainst = 'baseline_reference' | 'baseline' | 'replacement_set'
export const d2cEvaluatedAgainst = (stage: D2CStage): D2CEvaluatedAgainst => stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set'
/**
 * The `runD2Evaluation()` stage of a D2-C stage: the same evaluatedAgainst and the same procedure. I0 is a given accepted set
 * evaluated as one replacement_set run without the found_R diagnostic, exactly D2's Z0.
 */
export const d2cRunnerStage = (stage: D2CStage): D2Stage => stage === 'I0' ? 'Z0' : stage

export interface D2CReplacementTask {
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntrySha256: string
  generatedEntryFile: string
  /** `[s]` for a K1 Candidate, `[]` for a K0 (I0) Candidate. */
  requiresSupport: string[]
  /** The CTX record values (S4 / S5), null for K0. */
  contextId: string | null
  supportReservationDigest: string | null
  /** The CTX record `reservationBody` JSON object (never a string; §7.2). */
  supportReservation: Json | null
  supportBodySha256: string | null
}

export interface D2CEvaluationTask {
  evaluationId: string
  stage: D2CStage
  evaluatedAgainst: D2CEvaluatedAgainst
  /** Ascending by Target ID. Empty for B0. */
  replacements: D2CReplacementTask[]
  researchMaxPlanSteps: number
  fullRunCap: number
}

export type D2CEvaluationChildResult = D2EvaluationChildResult & { supportBodySha256Observed?: Record<string, string> }

/**
 * One evaluation (§5 / §6): S4's SHA-256 part (the Export support body against the CTX record `supportBodySha256`), then the
 * unchanged `runD2Evaluation()` with the CTX record `reservationDigest` (S5 (a)) and `reservationBody` object (S5 (b)).
 */
export async function runD2CEvaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2CEvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2CEvaluationChildResult> {
  if (task.evaluatedAgainst !== d2cEvaluatedAgainst(task.stage)) return { status: 'guardrail_violation', issues: ['evaluatedAgainst is not the stage one'] }
  const observed: Record<string, string> = {}
  for (const r of task.replacements) {
    if ((r.requiresSupport.length === 0) !== (r.supportBodySha256 === null && r.contextId === null)) return { status: 'guardrail_violation', issues: ['a support body digest / context without a support Entry, or the reverse'] }
    if (r.requiresSupport.length > 1) return { status: 'guardrail_violation', issues: ['a D2-C Candidate requires more than one support Entry'] }
    if (r.supportReservation !== null && !isObject(r.supportReservation)) return { status: 'guardrail_violation', issues: ['S5: the support reservation body is not a JSON object'] }
    for (const id of r.requiresSupport) {
      const body = exportBuildListEntries.find(e => isObject(e) && e.id === id)
      const digest = body === undefined ? null : options.sha256OfText(stableStringify(body))
      if (digest === null || digest !== r.supportBodySha256) return { status: 'guardrail_violation', issues: [`S4: the Export support Entry ${id} body SHA-256 is not the CTX record supportBodySha256`] }
      observed[id] = digest
    }
  }
  const d2Task: D2EvaluationTask = { evaluationId: task.evaluationId, stage: d2cRunnerStage(task.stage), evaluatedAgainst: task.evaluatedAgainst, researchMaxPlanSteps: task.researchMaxPlanSteps,
    fullRunCap: task.fullRunCap, replacements: task.replacements.map(r => ({ targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
      generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntrySha256: r.generatedEntrySha256, generatedEntryFile: r.generatedEntryFile, requiresSupport: [...r.requiresSupport],
      supportReservationDigest: r.supportReservationDigest, supportReservation: r.supportReservation })) }
  const result = await runD2Evaluation(input, exportBuildListEntries, d2Task, generatedEntries, dependencies, { yieldControl: options.yieldControl })
  return result.status === 'evaluated' || result.status === 'preflight_refused' || result.status === 'planner_rerun_bound_reached' ? { ...result, supportBodySha256Observed: observed } : result
}

/** §7.3: the first applicable cause (top to bottom), or null when the support holds and is selected. */
export function d2cSupportExpiryCause(checks: { S1: boolean; S2: boolean; S3: boolean; S4: boolean; S5: boolean } | null, selected: boolean | null, removedByRuntime: boolean): string | null {
  if (checks === null) return null
  if (!checks.S1) return 'support_target_replaced'
  if (!checks.S2) return removedByRuntime ? 'support_removed_runtime_unsupported' : 'support_entry_absent'
  if (!checks.S3) return 'support_entry_invalid'
  if (selected === false) return 'support_not_selected'
  if (!checks.S4) return 'support_body_mismatch'
  if (!checks.S5) return 'support_reservation_mismatch'
  return null
}

// ---------------------------------------------------------------- parity primitives (§9)

export type D2CParityState = 'matched' | 'mismatched' | 'not_checked' | 'not_applicable'

/**
 * `phase_b_k1_prefix` (§9) for one D2-C unit with a Phase B counterpart (0 deliveries, extent bound): matched for a measured unit
 * that stopped by extent with 0 deliveries; mismatched when it delivered, was exhausted or ended in a typed error; not_checked
 * when it was not measured.
 */
export function d2cPhaseBK1PrefixParity(d2c: { comparable: boolean; status: D2CDiscoveryUnitStatus | null; deliveredCandidates: number | null }): { state: D2CParityState; mismatches: string[] } {
  if (!d2c.comparable) return { state: 'not_checked', mismatches: [] }
  const mismatches: string[] = []
  if (d2c.status !== 'stopped_by_search_extent_bound') mismatches.push(`status ${d2c.status} (Phase B stopped by extent)`)
  if (d2c.deliveredCandidates !== 0) mismatches.push(`${d2c.deliveredCandidates} delivered (Phase B 0)`)
  return { state: mismatches.length === 0 ? 'matched' : 'mismatched', mismatches }
}

/** `d2b_incumbent` (§6.1 / §9): I0 against the D2 RESULT CMP-t09-c1. */
export function d2cI0Parity(expected: D2CD2Reference['i0'], observed: { status: string | null; inputDigest: string | null; resultDigest: string | null; termination: string | null; completed: number | null;
  totalTargetCount: number | null; conflicts: number | null; steps: number | null; r5Satisfied: boolean | null }): string[] {
  const mismatches: string[] = []
  if (observed.inputDigest !== expected.inputDigest) mismatches.push('inputDigest')
  if (observed.status !== 'evaluated') mismatches.push(`status ${observed.status}`)
  if (observed.resultDigest !== expected.resultDigest) mismatches.push('resultDigest')
  if (observed.termination !== expected.termination) mismatches.push('termination')
  if (observed.completed !== expected.completed || observed.totalTargetCount !== expected.totalTargetCount) mismatches.push('completed / total')
  if (observed.conflicts !== expected.conflicts) mismatches.push('Conflicts')
  if (observed.steps !== expected.steps) mismatches.push('steps')
  if (observed.r5Satisfied !== true) mismatches.push('R5 is not satisfied')
  return mismatches
}

// ---------------------------------------------------------------- start attestation and Production audit (§10.2)

export const D2C_START_ATTESTATION_FILE = 'start-attestation.json'
export const D2C_START_ATTESTATION_PHASE = 'Issue #154 D2-C-B runner start attestation'
export const d2cProductionChangedFiles = d2ProductionChangedFiles

/** §10.2 / §12 `conditions`: the registered policy (contexts, derivation, caps, ladder, dedup, procedures, order, gate, budgets, envelope, decision). */
export function d2cRegisteredConditions() {
  return {
    specFile: D2C_SPEC_FILE,
    baseMain: D2C_BASE_MAIN,
    population: { manifest: D2C_REGISTERED_INPUTS.phaseBTargets.file, e1Targets: D2C_E1_TARGETS, scopeTargets: D2C_SCOPE_TARGETS, order: 'Target ID ascending' },
    contextTable: '§3.2 of the attested D2-C document (7 contexts, re-derived by §3.1 in V and compared)',
    derivationRule: [...D2C_DERIVATION_RULE],
    supportCapPerTarget: D2C_SUPPORT_CAP_PER_TARGET,
    k1PoolCap: D2C_K1_POOL_CAP,
    ladder: D2C_LADDER.map(r => ({ id: r.id, extent: { ...r.extent } })),
    dedupRules: [...D2C_DEDUP_RULES],
    discoveryRule: [...D2C_DISCOVERY_RULE],
    admissionRule: [...D2C_ADMISSION_RULE],
    incumbent: [...D2C_INCUMBENT_RULE],
    compositionRule: [...D2C_COMPOSITION_RULE],
    r5Definition: [...D1_R5_DEFINITION],
    gate: D2C_GATE_RULE,
    selectionOrder: [...D2C_SELECTION_ORDER],
    r6Definition: [...D2C_R6_DEFINITION],
    contextChecks: [...D2C_CONTEXT_CHECKS],
    supportChecks: [...D2C_SUPPORT_CHECKS],
    supportExpiryCauses: [...D2C_SUPPORT_EXPIRY_CAUSES],
    budgets: { ...D2C_BUDGETS },
    order: [...D2C_ORDER],
    executionEnvelope: { ...D2C_EXECUTION_ENVELOPE },
    researchMaxPlanSteps: D2C_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D2C_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D2C_CALCULATION_CONTEXT },
    decisionRule: [...D2C_DECISION_RULE],
    betterRule: D2C_BETTER_RULE,
    comparisonBaselines: structuredClone(D2C_COMPARISON_BASELINES) as unknown,
    registeredInputs: structuredClone(D2C_REGISTERED_INPUTS) as unknown,
    i0Files: D2C_I0_FILES.map(f => ({ ...f })),
    phaseBUnits: D2C_PHASE_B_UNITS.map(u => ({ ...u })),
    d2Provenance: { ...D2C_D2_PROVENANCE },
    phaseBProvenance: { measuredHead: D1_PHASE_B_PROVENANCE.measuredHead, decisionCase: D1_PHASE_B_PROVENANCE.decisionCase },
    d2ResultFieldsRead: [...D2C_D2_RESULT_ALLOWLIST],
    phaseBResultFieldsRead: [...D2C_PHASE_B_RESULT_ALLOWLIST],
    phaseBTaskFieldsRead: [...D2C_PHASE_B_TASK_FIELDS_READ],
    phaseBRecordFieldsRead: [...D2C_PHASE_B_RECORD_FIELDS_READ],
    d1SpecFieldsRead: [...D2C_D1_SPEC_FIELDS_READ],
    provenanceFlags: { ...D2C_PROVENANCE_FLAGS },
    notRun: [...D2C_NOT_RUN],
  }
}

/** §10.2: the SHA-256 of `stableStringify(conditions)`. */
export const d2cRegisteredPolicySha256 = (sha256OfText: (text: string) => string) => sha256OfText(stableStringify(d2cRegisteredConditions()))

export interface D2CLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  /** The calculation code digest (the code paths at HEAD, which hold the D2-C benchmark code and every module it imports). */
  benchmarkCodeSha256: string
  /** The D2-C-A document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The observed digest of every registered input, I0 G store file and Phase B task / record (V checks them against the registered ones). */
  observedInputs: Record<string, D2CObservedFile | null>
  observedI0Files: Record<string, D2CObservedFile | null>
  observedPhaseBFiles: Record<string, D2CObservedFile | null>
  exportFileName: string
  productionAudit: { baseMain: string; baseMainIsAncestor: boolean; productionChangedSinceBaseMain: string[] }
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  appliedExecutionEnvelope: { contextUnitBudgetMs: number; discoveryUnitBudgetMs: number; evaluationBudgetMs: number; discoveryEnvelopeMs: number; runBudgetMs: number; childHeapMb: number; concurrency: number;
    retry: string; fallback: string; memorySampleIntervalMs: number; nodeYield: string }
  rngEngineVersion: string
  /** The CalculationContext the runner observed (`globalResearchInputFromExport()` at launch). */
  observedCalculationContext: unknown
  smoke: { contextKs: number[] | null; maxChildren: number | null; budgetMs: number | null; maxRung: string | null; skipEvaluations: boolean } | null
}

export type D2CStartAttestation = ReturnType<typeof d2cRegisteredConditions> & D2CLaunchObservation & { phase: string; attestedBy: 'runner' }

export function d2cStartAttestationBody(observation: D2CLaunchObservation): D2CStartAttestation {
  return { phase: D2C_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d2cRegisteredConditions(), ...observation }
}

const EMPTY_D2C_OBSERVATION: D2CLaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  registeredPolicySha256: '', observedInputs: {}, observedI0Files: {}, observedPhaseBFiles: {}, exportFileName: '', productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null }, appliedExecutionEnvelope: { ...D2C_EXECUTION_ENVELOPE }, rngEngineVersion: '', observedCalculationContext: null, smoke: null }
const D2C_ATTESTATION_KEYS = Object.keys(d2cStartAttestationBody(EMPTY_D2C_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const d2cPhaseBFileKey = (unitId: string, kind: 'task' | 'record') => `${unitId}.${kind}`

export interface D2CAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The chained Export SHA-256 (`d2cChainedExportSha256()`). */
  exportSha256: string | null
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D2-C launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / calculation code / D2-C document
 * / registered policy equal to the independently obtained ones, every observed input / I0 file / Phase B file equal to the
 * registered digest, Production changed files = [] with the base main an ancestor, the registered Engine and CalculationContext, a
 * clean non-smoke launch, and every registered condition unchanged.
 */
export function verifyD2CStartAttestation(attestation: unknown, expected: D2CAttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D2C_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D2C_START_ATTESTATION_PHASE) issues.push('not a D2-C-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  if (attestation.registeredPolicySha256 !== expected.registeredPolicySha256) issues.push('registeredPolicySha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D2C_REGISTERED_INPUTS) as [string, D2CRegisteredFile][]) {
    const o = observed[key]
    const want = registered.sha256 ?? expected.exportSha256
    if (!isObject(o) || want === null || o.sha256 !== want || (registered.bytes !== null && o.bytes !== registered.bytes)) issues.push(`the observed ${key} is not the registered input`)
  }
  const i0 = isObject(attestation.observedI0Files) ? attestation.observedI0Files : {}
  for (const f of D2C_I0_FILES) { const o = i0[f.file]; if (!isObject(o) || o.sha256 !== f.sha256 || o.bytes !== f.bytes) issues.push(`the observed I0 file ${f.file} is not the registered file`) }
  const pb = isObject(attestation.observedPhaseBFiles) ? attestation.observedPhaseBFiles : {}
  for (const u of D2C_PHASE_B_UNITS) {
    const t = pb[d2cPhaseBFileKey(u.unitId, 'task')], r = pb[d2cPhaseBFileKey(u.unitId, 'record')]
    if (!isObject(t) || t.sha256 !== u.taskSha256 || t.bytes !== u.taskBytes || !isObject(r) || r.sha256 !== u.recordSha256 || r.bytes !== u.recordBytes) issues.push(`the observed Phase B files of ${u.unitId} are not the registered files`)
  }
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || audit.baseMain !== D2C_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D2C_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (attestation.rngEngineVersion !== D2C_RNG_ENGINE_VERSION) issues.push('the Production RNG Engine is not the registered one')
  if (!same(attestation.observedCalculationContext, D2C_CALCULATION_CONTEXT)) issues.push('the observed CalculationContext is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D2C_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d2cRegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
