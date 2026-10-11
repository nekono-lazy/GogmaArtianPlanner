/**
 * Issue #154 D2-E-B: the t03 two-support K2 context discovery and the extension of the D2-D best incumbent (PAIR-t05c1-t07c3).
 * Research only. Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md` (D2-E-A, PR #231), attested by the runner at the measurement
 * HEAD. The registered order (§8.1):
 *
 * ```text
 * V    the registered inputs; the K2 context (§3.1) and the I0 set (§6.1) re-derived from the D2-D / D2-C / D2 RESULTs   parent
 * RV   one child: RV1 .. RV6 for the 9 incumbent Candidates and the 3 support Entries (no Search, no full run, §7.1)
 * B0   the baseline PlannerInput, one fresh full run (persisted)
 * I0   the D2-D best incumbent (9 G store bodies), one fresh replacement_set run
 * CTX  CTX-K2: phase2c27bResolveSupportContext(t03, S) over the two Export support bodies, C1 .. C7 (no Search, no full run)
 * DSC  L0 -> L1 -> L2 of the one K2 context: visitPlannerAlternativeCandidates() with the K2 reservation, R0-K2 / R0-split,
 *        D-1 / D-2 / D-4 / D-5, K2_POOL_CAP = 2, every new key materialized against the baseline Entries into the G store
 * ADM  per pooled K2 Candidate: T = { t03 } (baseline), requiresSupport = S, R1 (R2 .. R4 / found_R are diagnostics)
 * EXT  per admitted K2 Candidate: the I0 set ∪ { t03: c } (10), one replacement_set run each, no early stop
 * ```
 *
 * Every evaluation keeps `conflictResolutions = []` and the preflight fixed constraints `[]` (G1). The support Entries are the
 * Export's own Entries and are never written as a resolution, a scenario resolution, a repair lineage or a selected Entry (G30).
 *
 * The evaluation child (`runD2EEvaluation()`) runs the exact `runD2Evaluation()` procedure (the same Production parts in the same
 * order: the replacement resolver, `preparePlannerReplacementConflictPreflight()` with no fixed constraint, one
 * `createPlannerAlternativeFullRunner()` with a fresh budget of 8, the D1 facts and digests). It is a D2-E wrapper (§14.2) because
 * the D2-C / D2 evaluation refuses a replacement that requires two support Entries; only its static checks differ, as §7.2
 * registers them: S4 / S5 per support Entry against the support's S5 authority CTX record (the lowest k), each K1 replacement's own
 * CTX record, and S6 for the K2 Candidate (the two support bodies of the evaluation input re-derive the CTX-K2 reservation).
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module, no Phase 2-C2.5-D2-D / D2-E
 * module, and reads the D2-D / D2-C / D2 RESULTs through `projectD2ED2DResult()` / `projectD2ED2CResult()` /
 * `projectD2ED2Result()` only (the §10.1 allowlists) and the CTX records through `readD2EContextRecord()` only. It names no Target,
 * Entry or stable key: the K2 context, the I0 set and every support come from the RESULTs; the registered file names, SHA-256,
 * digests (§10.1 / §3.3 / §6.1 / §9) are only compared, and the registered reservation body is read from the attested D2-E text.
 */
import { resolveBuildListEntryReplacement, type BuildListEntryReplacement } from '../domain/buildList'
import { collectReferencedOwnedWeaponIds, hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId, PlanConflict } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeFullRunner,
  createPlannerAlternativeMaterializer,
  createPlannerAlternativeSearchIdentity,
  derivePlannerAlternativeReservation,
  judgePlannerAlternativeTrial,
} from '../domain/planner/alternative'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import type { PlannerDependencies, PlannerInput, PlannerResult, PlannerRouteCommitmentEvidence, PlannerRunBuildListContext } from '../domain/planner/plannerTypes'
import { preparePlannerReplacementConflictPreflight } from '../domain/planner/replacement/plannerAugmentedPreflight'
import { createPlannerConflictContexts, plannerConflictResourceKey } from '../domain/planner/replacement/plannerConflictContext'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeCandidate, type PlannerAlternativeSearchExtent } from '../domain/search'
import {
  d1InputDigest,
  d1ResultDigest,
  d1RuntimeUnsupportedRemoved,
  d1TrialRunSummary,
  D1_R5_DEFINITION,
  D1InvariantError,
  type D1ConflictFact,
  type D1EvaluationFacts,
  type D1StepProjection,
  type D1SupportCheckFacts,
} from './plannerGlobalD1'
import {
  d2DiscoveryUnitOutcome,
  d2NamesSha256,
  d2ProductionChangedFiles,
  D2_CALCULATION_CONTEXT,
  D2_EVALUATION_FULL_RUN_CAP,
  D2_LADDER,
  D2_RESEARCH_MAX_PLAN_STEPS,
  D2_RNG_ENGINE_VERSION,
  type D2DiscoveryMeasuredStatus,
  type D2EvaluationFacts,
  type D2SupportStaticCheck,
} from './plannerGlobalD2'
import { readD2CContextRecord, D2C_R6_DEFINITION, D2C_SUPPORT_EXPIRY_CAUSES } from './plannerGlobalD2C'
import type { D2DReverificationTask } from './plannerGlobalD2D'
import { respectsPhase2C2Reservation, summarizePhase2C2Baseline, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { createPhase2C27BLadderRerunBudget, phase2c27bPolicyDrift, phase2c27bResolveSupportContext, PHASE2C27B_RUNG_IDS, type Phase2C27BRungId } from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sortedIds = (ids: readonly string[]) => [...ids].sort(compare)
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const suffix8 = (id: string) => (id.split('-').pop() ?? '').slice(0, 8)
const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]!)

// ---------------------------------------------------------------- registered before the formal run (D2-E-A §2 - §13, §15, §17)

export const D2E_PHASE = 'Issue #154 D2-E'
export const D2E_RESULT_PHASE = 'Issue #154 D2-E: t03 two-support K2 context discovery and extension of the D2-D best incumbent (post-hoc analysis)'
/** The D2-E-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§10.2) and attested. */
export const D2E_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md'
/** The main of D2-E-B's start (PR #231 merged): the Production audit counts changes since this commit. */
export const D2E_BASE_MAIN = '414c63d6d42ed2adf865ece48fc2cdf2c2264b16'

/** §1.1 / §10.1: the D2-D formal RESULT D2-E reads. */
export const D2E_D2D_PROVENANCE = Object.freeze({
  measuredHead: '38f4ed7bbfd7e994367856484817d115b9860ab8',
  decisionCase: 'D2D_EXCEEDS_D2C_FINAL',
  bestPair: 'PAIR-t05c1-t07c3',
  runDir: '.local/d2d-pair-formal.run',
} as const)
/** §1.3 / §10.1: the D2-C formal RESULT D2-E reads. */
export const D2E_D2C_PROVENANCE = Object.freeze({
  measuredHead: '627184363db50ef256f602014b457f05a227861c',
  decisionCase: 'D2C_EXCEEDS_D2B_MAIN',
  runDir: '.local/d2c-k1-formal.run',
} as const)
/** §10.1: the D2 formal RESULT D2-E reads. */
export const D2E_D2_PROVENANCE = Object.freeze({
  measuredHead: '6f66c168e9163dab02bb60b2f1dc5b1cfc531e71',
  decisionCase: 'D2A_EXCEEDS_D1_INCUMBENT',
  runDir: '.local/d2-formal2.run',
  e1Targets: 11,
} as const)

/**
 * `sha256: null` is the Export only: its digest is reached through the authority chain (the D2-D RESULT `sources.export`, equal to
 * the D2-C / D2 RESULT ones and named by the attested D2-E text), as in D2-C / D2-D.
 */
export interface D2ERegisteredFile { file: string; bytes: number; sha256: string | null }

/** §10.1: every committed / local input D2-E reads, by path relative to the repository root (the Export is an external path argument). */
export const D2E_REGISTERED_INPUTS = Object.freeze({
  export: { file: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: null },
  d2dResult: { file: 'docs/PLANNER_GLOBAL_D2D_RESULT.json', bytes: 402_549, sha256: '5a27030d7be3fd4650eb0094cc2227759a3b0656a096ac09291e5807298fa4b0' },
  d2cResult: { file: 'docs/PLANNER_GLOBAL_D2C_RESULT.json', bytes: 1_541_755, sha256: '99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68' },
  d2Result: { file: 'docs/PLANNER_GLOBAL_D2_RESULT.json', bytes: 4_122_806, sha256: 'ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c' },
  phase2c2Result: { file: 'docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json', bytes: 1_195_107, sha256: 'afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4' },
  d2dAttestation: { file: '.local/d2d-pair-formal.run/start-attestation.json', bytes: 24_839, sha256: '15090ba23d6a757b6106e040e90a884d17301db062a62ebf6c6059bfc6ca7985' },
  d2dRaw: { file: '.local/PLANNER_GLOBAL_D2D_PAIR_RAW.json.local', bytes: 36_344, sha256: '45be55254652287521d07e3364ccfe64a03008754285a9591c30e2d0d586f2c3' },
  d2cAttestation: { file: '.local/d2c-k1-formal.run/start-attestation.json', bytes: 27_674, sha256: 'a3998ab6460b03e9dbf91329a9f1e133e4eae63c201c9ac51ed05f153c695970' },
  d2cRaw: { file: '.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local', bytes: 136_356, sha256: 'a0e106891b2805bb2b6b28a3b99ee31b5c535a84e795084292185e07bdc78601' },
  d2dSpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md', bytes: 90_841, sha256: 'bafcb2d4e39e801afa2a28dbb9902ec3285cced625d865859a48d024c5c60c17' },
  d2dbDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md', bytes: 15_120, sha256: 'ea29814003717afaf737486cafee9d6a19437954a2e210c3fc49a2916933472e' },
} satisfies Record<string, D2ERegisteredFile>)
export type D2ERegisteredInputKey = keyof typeof D2E_REGISTERED_INPUTS

/** §10.1: the D2-C-A / D2-C-B / D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B documents, hash-checked against D2-D RESULT `sources.documents`. */
export const D2E_CHAINED_DOCUMENT_KEYS = Object.freeze(['d2cA', 'd2cB', 'd2a', 'd2b', 'd1a', 'phaseA', 'phaseB', 'followup', 'd1b'] as const)

export type D2EOrigin = 'd2b_k0' | 'd2c_k1'
export interface D2ERegisteredGStoreFile { label: string; ordinal: number; origin: D2EOrigin; runDir: string; file: string; bytes: number; sha256: string }

/** §1.2 / §10.1: the 9 G store bodies of the D2-D best incumbent (5 D2-B K0, 4 D2-C K1). Read only, never written. */
export const D2E_INCUMBENT_G_STORE_FILES: readonly D2ERegisteredGStoreFile[] = Object.freeze([
  { label: 't00', ordinal: 1, origin: 'd2c_k1', runDir: D2E_D2C_PROVENANCE.runDir, file: 'K1-t00-e396d352-c1.generated-entry.json', bytes: 101_010, sha256: 'ee101531376ac36f491d4b1d07592fc6ca8356a62da2daeee85d956c83ff13e0' },
  { label: 't01', ordinal: 1, origin: 'd2b_k0', runDir: D2E_D2_PROVENANCE.runDir, file: 't01-c1.generated-entry.json', bytes: 66_309, sha256: '3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14' },
  { label: 't04', ordinal: 1, origin: 'd2c_k1', runDir: D2E_D2C_PROVENANCE.runDir, file: 'K1-t04-92d87b90-c1.generated-entry.json', bytes: 481_245, sha256: '3d83de2ab3eac164f1ad49a21ed22bfe174f83a7fe8ac0f2644fda3ba49062c4' },
  { label: 't05', ordinal: 1, origin: 'd2c_k1', runDir: D2E_D2C_PROVENANCE.runDir, file: 'K1-t05-61066e62-c1.generated-entry.json', bytes: 67_339, sha256: '982b6da2247de3ce01fb06a747a0053f86e44a44a8fe8c02d1602a18ef51a0b2' },
  { label: 't06', ordinal: 3, origin: 'd2b_k0', runDir: D2E_D2_PROVENANCE.runDir, file: 't06-c3.generated-entry.json', bytes: 251_042, sha256: '06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218' },
  { label: 't07', ordinal: 3, origin: 'd2b_k0', runDir: D2E_D2_PROVENANCE.runDir, file: 't07-c3.generated-entry.json', bytes: 211_734, sha256: 'f23e0891fac67f6260c48aed0a121a8d2de53669b64be79efc4ca9f5d3d8abb7' },
  { label: 't08', ordinal: 1, origin: 'd2b_k0', runDir: D2E_D2_PROVENANCE.runDir, file: 't08-c1.generated-entry.json', bytes: 222_523, sha256: '825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc' },
  { label: 't09', ordinal: 1, origin: 'd2b_k0', runDir: D2E_D2_PROVENANCE.runDir, file: 't09-c1.generated-entry.json', bytes: 270_975, sha256: 'b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc' },
  { label: 't10', ordinal: 1, origin: 'd2c_k1', runDir: D2E_D2C_PROVENANCE.runDir, file: 'K1-t10-e396d352-c1.generated-entry.json', bytes: 24_593, sha256: '4ae6d9b2ca28df084a3496913fdb2e53189c7425dd460cbe3064f9f9c2307b0d' },
].map(row => Object.freeze(row as D2ERegisteredGStoreFile)))
export const d2eGStoreKey = (label: string, ordinal: number) => `${label}-c${ordinal}`

export interface D2ERegisteredContextRecord { k: number; file: string; bytes: number; sha256: string }
/** §1.4 / §1.6 / §10.1: the 6 D2-C CTX records D2-E reads (`result.{contextId, supportBuildListEntryId, supportBodySha256, reservationBody, reservationDigest, originDigest, excludedRouteKeys, excludedRouteKeySha256s, status}` only). */
export const D2E_CONTEXT_RECORDS: readonly D2ERegisteredContextRecord[] = Object.freeze([
  { k: 1, file: 'CTX-1.context.json', bytes: 35_505, sha256: '39adb498b93d2f60cd465ae16125cee53bdf131c8979c092dcb3d0a3d6c0a2e1' },
  { k: 3, file: 'CTX-3.context.json', bytes: 98_825, sha256: '56ed06f37c3d3887c3d2d538111fdff1866e936bd591ba56b05b3e1c12932dda' },
  { k: 4, file: 'CTX-4.context.json', bytes: 99_020, sha256: 'c0b706ff7f7f6ecc1cc4e1dc654ae801dd454ff0ef6cf19870f0fe460798230b' },
  { k: 5, file: 'CTX-5.context.json', bytes: 338_994, sha256: '7e42c33cbeca28265ecbc7946f9a48ae764bb3c528bbc3f89fa107d1988a4b4c' },
  { k: 6, file: 'CTX-6.context.json', bytes: 31_237, sha256: 'd1e415c4a06970055395901b40811dd9fe1226d6af70ce23471c831c79e5e054' },
  { k: 7, file: 'CTX-7.context.json', bytes: 18_630, sha256: 'a3a531065350f1a2f854ddbb7ffe2e25d6fcf14fe7f39ea83717a5a36b012372' },
].map(row => Object.freeze(row)))

/** §7.1 RV3: the empty-support (K0) Search reservation digest D2-B registered. */
export const D2E_K0_RESERVATION_DIGEST = 'fnv1a32:5ac88909'
/** §3.3: the registered K2 reservation digest (C5); the registered body is the §1.7 JSON of the attested D2-E text. */
export const D2E_K2_RESERVATION_DIGEST = 'fnv1a32:fd85c864'
/** §3.3 / C4: the B2-C1 schedule snapshot origin digest (= CTX-3 / CTX-4 `originDigest`). */
export const D2E_ORIGIN_DIGEST = 'fnv1a32:ff018910'
/** §9 baseline parity: D2-D RESULT `evaluations[B0]` (= D2 / D2-C B0). */
export const D2E_B0_EXPECTED = Object.freeze({ evaluationId: 'B0', inputDigest: 'fnv1a32:6f151dc3', resultDigest: 'fnv1a32:880bbb52', status: 'evaluated', termination: 'exhausted',
  completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 })
/** §6.1 / §9 d2d_best parity: D2-D `PAIR-t05c1-t07c3`. */
export const D2E_I0_EXPECTED = Object.freeze({ evaluationId: D2E_D2D_PROVENANCE.bestPair, inputDigest: 'fnv1a32:6493291d', resultDigest: 'fnv1a32:57dbb4e5', status: 'evaluated', termination: 'exhausted',
  completed: 24, totalTargetCount: 43, conflicts: 19, steps: 1465, resourceConflictRejections: 19 })
/** §11.1: the fixed comparison values (completed / Conflict / steps). */
export const D2E_COMPARISON_BASELINES = Object.freeze({
  baseline: Object.freeze({ evaluationId: 'B0', completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d2cFinal: Object.freeze({ evaluationId: 'D2-D I0 (D2-C CMP-t10-c1)', completed: 23, totalTargetCount: 43, conflicts: 20, steps: 1465 }),
  d2dBest: Object.freeze({ evaluationId: 'I0', completed: 24, totalTargetCount: 43, conflicts: 19, steps: 1465 }),
})

export const D2E_K2_POOL_CAP = 2
export const D2E_DELIVERIES_PER_UNIT_MAX = 9
export const D2E_RESEARCH_MAX_PLAN_STEPS = D2_RESEARCH_MAX_PLAN_STEPS
export const D2E_EVALUATION_FULL_RUN_CAP = D2_EVALUATION_FULL_RUN_CAP
export const D2E_CALCULATION_CONTEXT = D2_CALCULATION_CONTEXT
export const D2E_RNG_ENGINE_VERSION = D2_RNG_ENGINE_VERSION
/** §3.1 C1: an Entry the Planner Alternative materializer generated (a generated Entry is never a support Entry). */
export const D2E_GENERATED_ENTRY_PREFIX = 'build-list.constrained.'
/** §4.5: the registered ladder (Normal / Gogma / Skill), the Phase B / D2 / D2-C one. */
export const D2E_LADDER = D2_LADDER

/** §8.4: the execution envelope (Research measurement envelopes, never a Production timeout). */
export const D2E_EXECUTION_ENVELOPE = Object.freeze({
  rvBudgetMs: 10 * 60 * 1000,
  contextUnitBudgetMs: 10 * 60 * 1000,
  discoveryUnitBudgetMs: 60 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  discoveryEnvelopeMs: 4 * 60 * 60 * 1000,
  runBudgetMs: 7 * 60 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

/** §4.6 / §8.3: the registered budgets (each independent; never a Production bound, G5). */
export const D2E_BUDGETS = Object.freeze({
  contexts: 1,
  supportPerContext: 2,
  contextChildren: 1,
  discoveryUnitsMax: 3,
  k2PoolCap: D2E_K2_POOL_CAP,
  uniqueCandidatesMax: 2,
  deliveriesPerUnitMax: D2E_DELIVERIES_PER_UNIT_MAX,
  generatedEntryFilesMax: 2,
  rvChildren: 1,
  b0Evaluations: 1,
  i0Evaluations: 1,
  admissionEvaluationsMax: 2,
  extensionEvaluationsMax: 2,
  evaluationRequestsMax: 6,
  childProcessesMax: 11,
  evaluationFullRunCap: D2E_EVALUATION_FULL_RUN_CAP,
  fullPlannerRunsMax: 48,
  researchMaxPlanSteps: D2E_RESEARCH_MAX_PLAN_STEPS,
} as const)

/** §12 provenance flags. */
export const D2E_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  populationManifestRead: false,
  d2dResultModified: false,
  d2cResultModified: false,
  d2ResultModified: false,
  priorEvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true,
  newSearchInD2E: true,
  searchScope: 't03 K2 context only',
  newAdmissionInD2E: true,
  k2ReservationDerivedFromSupportBodies: true,
  k1ReservationUnionUsedAsSemantics: false,
  speculativeSupportWrittenAsResolution: false,
  alternativeToAlternativeSupport: false,
  productionSemanticsChanged: false,
} as const)

/** §10.1: the only D2-D RESULT fields D2-E reads. */
export const D2E_D2D_RESULT_ALLOWLIST = Object.freeze([
  'sources.{specDocument,d2c.*,d2.*,phase2c2Result,export,documents,d2d.{raw,runDir,attestation}}',
  'provenance.{formal,measuredHead,analysisHead,measuredHeadIsAncestor,runStatus,benchmarkCodeSha256,registeredPolicySha256,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.{sha256,verified},oracleReadByRunner,oracleReadByChild,oracleReadByAnalyzer,oracleGuidedTargetPopulation}',
  'invalidReasons', 'decision.{case,bestEligiblePair,bestImprovedPair}', 'aggregates.evaluations.{unmeasuredByReason,notExecutedByReason}', 'pairs.ranking',
  'inputValidation.derivedPairs[evaluationId = decision.bestImprovedPair].{pairOrdinal,evaluationId,t05Ordinal,t07Ordinal,generatedBuildListEntryIds,generatedEntrySha256s,requiresSupport,inputDigest}',
  'conditions.{fixedCandidates[],t05Candidates[ordinal = t05Ordinal],t07Candidates[ordinal = t07Ordinal]}.{label,ordinal,origin,contextId,targetWeaponId,currentBuildListEntryId,generatedBuildListEntryId,generatedEntry,requiresSupport,searchIdentity,keySha256}',
  'rv.{status,satisfied}',
  'evaluations[evaluationId in {B0,I0,decision.bestImprovedPair}].{evaluationId,stage,status,inputDigest,resultDigest,generatedEntryIds,generatedEntrySha256s,requiresSupport,plan.{termination,steps,selectedBuildListEntryIds},conflicts (count),resourceConflictRejections,r5.{satisfied,failureReasons},r6.satisfied,selectedTargetWeaponIds,supportChecksByEntry[s].{selected,supportExpiryCause}}',
  'evaluations[].{evaluationId,status,inputDigest,resultDigest} (determinism_prior only)',
])
/** §10.1: the only D2-C RESULT fields D2-E reads. */
export const D2E_D2C_RESULT_ALLOWLIST = Object.freeze([
  'sources', 'provenance.{formal,measuredHead,analysisHead,runStatus,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.{sha256,verified}}', 'invalidReasons', 'decision.case',
  'aggregates.evaluations.{unmeasuredByReason,notExecutedByReason}', 'composition.main.steps[].{label,stepOutcome}',
  'contexts[].{contextId,k,label,targetWeaponId,currentBuildListEntryId,supportBuildListEntryId,supportTargetWeaponId,record,supportBodySha256,reservationDigest,originDigest,excludedRouteKeySha256s,status}',
  'discovery.targets[label = the derived K2 Target].{label,targetWeaponId,currentBuildListEntryId,contextIds,pool[].{ordinal,contextId,keySha256,generatedBuildListEntryId,requiresSupport}}',
  'evaluations[stage in {ADM,CMP} ∧ targetLabel in D2C_NE].{evaluationId,stage,targetLabel,status,candidates[label = targetLabel].{label,selected,winnerBuildListEntryId,contextId,generatedBuildListEntryId},r1r4.R1,r5.{satisfied,failureReasons},conflicts[participants ∋ the Candidate G].{kind,participants,resourceIdentity}}',
  'evaluations[].{evaluationId,status,inputDigest,resultDigest} (determinism_prior only)',
])
/** §10.1: the only D2 RESULT fields D2-E reads. */
export const D2E_D2_RESULT_ALLOWLIST = Object.freeze([
  'sources.export', 'provenance.{formal,measuredHead}', 'invalidReasons', 'decision.case',
  'discovery.targets[].{label,targetWeaponId,currentBuildListEntryId} (the E1 Targets and O_t, 11)', 'discovery.targets[label = the derived K2 Target].pool[].{ordinal,keySha256} (D-4)',
  'evaluations[].{evaluationId,status,inputDigest,resultDigest} (determinism_prior only)',
])
export const D2E_CONTEXT_RECORD_FIELDS_READ = Object.freeze(['result.contextId', 'result.supportBuildListEntryId', 'result.supportBodySha256', 'result.reservationBody', 'result.reservationDigest',
  'result.originDigest', 'result.excludedRouteKeys', 'result.excludedRouteKeySha256s', 'result.status'])
const D2D_EVALUATIONS_READ = ['B0', 'I0']

export const D2E_DERIVATION_RULE = Object.freeze([
  'D2C_NE = D2C RESULT composition.main.steps with stepOutcome === not_replaced_no_eligible (label ascending)',
  'ctx(t) = D2C RESULT contexts with label = t and status = context_ready (k ascending); |ctx(t)| < 2 -> not a K2 Target',
  'obs(t) = D2C RESULT evaluations with stage in { ADM, CMP } and targetLabel = t; each evaluated, each with exactly one candidates[] element of label t',
  'crossSupportLoss(e) = x.selected === false and x.winnerBuildListEntryId is the support of another context of t (not x.contextId)',
  'K2(t) = { t, O_t, supports = sorted({ sup(c) | c in ctx(t) }) } when every ADM(t) R1 is true and every obs(t) has crossSupportLoss',
  'the derivation must equal the §3.2 table (Target set, O_t, support set and order, ADM 4 / CMP 4); any difference is input_evidence (no child starts)',
  'the E1 Targets and O_t come from D2 RESULT discovery.targets (11); no population manifest is read',
])
export const D2E_I0_RULE = Object.freeze([
  'I0 = D2-D RESULT decision.bestImprovedPair (= bestEligiblePair = PAIR-t05c1-t07c3): conditions.fixedCandidates ∪ t05Candidates[t05Ordinal] ∪ t07Candidates[t07Ordinal] (Target ID ascending, 9) = inputValidation.derivedPairs[bestImprovedPair] = the §1.2 table',
  'G bodies from the D2-B / D2-C G store (bytes / SHA-256 registered), requiresSupport t00 / t10 [e396d352], t04 [92d87b90], t05 [61066e62], others []; each K1 replacement carries its own CTX record (CTX-1 / CTX-5 / CTX-6 / CTX-7)',
  'one fresh replacement_set run (no found_R); expected (d2d_best): inputDigest, evaluated, resultDigest, exhausted, 24 / 43, Conflict 19, steps 1465, R5, resource_conflict 19, the 3 supports selected',
  'I0 is the reference of the gate and of "better"; I0 unmeasured -> every EXT not_executed (i0_unmeasured); the D2-D RESULT values are parity expectations only',
])
export const D2E_CONTEXT_RULE = Object.freeze([
  'CTX-K2 once: phase2c27bResolveSupportContext(baseline, t03, S) over the two Export support bodies (= derivePlannerAlternativeReservation([2 bodies])); never a union of the K1 reservations',
  'the record holds reservationBody (a JSON object), reservationDigest, originDigest, excludedRouteKeys (full text and SHA-256), conflictContextCount, C1 .. C7 and diagnostics { equalsK1ComponentwiseUnion, k1Reservations }',
  'no Search and no full run',
])
export const D2E_CONTEXT_CHECKS = Object.freeze([
  'C1: |S| = 2 without duplicates; each support is exactly one Export Entry whose Target is outside E1, not a generated Entry and not an E1 O_t',
  'C2: phase2c27bResolveSupportContext(baseline, t03, S) is ready, its current Entry is O_t03 and its support set is S',
  'C3: the derived exclusiveOwnedWeaponIds hold collectReferencedOwnedWeaponIds of both support Routes and every exclusiveConsumedOwnedWeaponId of one createPlannerRouteUnitPlans([2 bodies])',
  'C4: the origin digest is the B2-C1 schedule snapshot origin digest and the CTX-3 / CTX-4 originDigest; excludedRouteKeys = [candidateStableKey(O_t03)] = the schedule ones, its SHA-256 = the CTX-3 / CTX-4 excludedRouteKeySha256s',
  'C5: reservationDigest = fnv1a32:fd85c864 and stableStringify(reservationBody) = stableStringify(the §1.7 / §3.3 registered body) (both objects) - parity k2_context_registered',
  'C6: the K2 body contains each support K1 CTX record reservationBody componentwise (Normal per counter ID, held ⊇, blocked ⊇, exclusiveOwnedWeaponIds ⊇)',
  'C7: the reverse support order derives the same reservation (stableStringify and digest)',
])
export const D2E_DISCOVERY_RULE = Object.freeze([
  'DSC-K2-<rung>: the re-derived K2 context must equal the CTX-K2 record (context_drift otherwise); visitPlannerAlternativeCandidates({ origin, t03, rung extent, reservation, excludedRouteKeys }) without capture policy or reordering',
  'consumer: R0-K2 false -> guardrail; R0-split false (any support K1 CTX reservationBody) -> guardrail; D-1 -> guardrail; a key in pool -> duplicate_of_lower_rung; SHA-256(key) in the D2-B t03 K0 pool -> same_key_as_d2b_k0_pool; SHA-256(key) in the D2-C t03 K1 pool -> same_key_as_d2c_k1_pool; otherwise materialize, write the G store, pool; stop at |pool| = 2',
  'unit outcome: consumer stop -> discovery_cap_reached; exhausted -> discovery_exhausted; extent -> stopped_by_search_extent_bound (ladder_exhausted at L2); timeout / OOM / process failure / interrupted -> unmeasured; typed error -> discovery_calculation_error',
  'escalate only after stopped_by_search_extent_bound with |pool| < 2; no trial during discovery; found_R never stops the Search; no rung beyond L2',
])
export const D2E_DEDUP_RULES = Object.freeze([
  'D-1 within one unit: a second delivery of one candidateStableKey is an invariant violation (guardrail)',
  'D-2 across rungs of the K2 context: a key already in the pool is duplicate_of_lower_rung (not pooled, not materialized)',
  'D-3 across contexts: not applicable (one K2 context)',
  'D-4 the D2-B t03 K0 pool (3 keys): SHA-256(key) in it -> same_key_as_d2b_k0_pool (the matched D2-B ordinal recorded)',
  'D-5 the D2-C t03 K1 pool (4 keys): SHA-256(key) in it -> same_key_as_d2c_k1_pool (the matched D2-C ordinal and context recorded); R0-K2 is checked first',
])
export const D2E_ADMISSION_RULE = Object.freeze([
  'one ADM-K2-t03-c<ordinal> per pooled K2 Candidate (discovery ordinal order, at most 2), T = { t03 }, evaluatedAgainst = baseline, requiresSupport = S',
  'discovery ordinal = (rung, delivery index in the unit)',
  'R1 = reusedExisting false ∧ replacement ready with replacedBuildListEntryId = O_t03 ∧ preflight ready ∧ evaluated ∧ plan ∧ termination in { completed, exhausted }',
  'R2 / R3 / R4 / target_regressed_R / found_R (explicit decision = fixed Route = support = S) / winners / crossSupportLoss / S1 .. S3 are diagnostics; S4 / S5 / S6 are static (guardrail)',
])
export const D2E_EXTENSION_RULE = Object.freeze([
  'for every admitted K2 Candidate c (discovery ordinal order, no early stop): EXT-K2-t03-c<ordinal> evaluates the I0 set (9) ∪ { t03: c } (10) as one replacement_set run',
  'each EXT depends on I0 only; the 9 incumbent bodies and requiresSupport never change; never two K2 Candidates in one PlannerInput (G15); no EXT-to-EXT composition',
])
export const D2E_EXTENSION_DIAGNOSTICS = Object.freeze([
  't03.{generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected}; t03Supports[] { selected, S1 .. S5, supportExpiryCause }',
  'incumbentRetention { allIncumbentGeneratedSelected, incumbentGeneratedNotSelected[] }; supportExpired; conflictsWithinSet[]; conflictsWithT03G[] (other participant: support / incumbent_generated / outside_set)',
  'd2cT03ResourcesObserved[] (Skill 341 / Gogma 71 / Skill 648 / Gogma 125 as a Conflict with the t03 G); referenceDiff (I0); t03Completion { t03TargetCompleted, netCompletedDelta, t03CompletedWithoutNetGain }; resourceConflictRejections',
])
export const D2E_GATE_RULE = 'completed(EXT) >= completed(I0) (termination.completedTargetCount of the fresh I0); R5 without the gate is r5OnlyEligible (diagnostic); eligible = evaluated ∧ R5 ∧ gate'
export const D2E_BETTER_RULE = 'completed larger, or completed equal and fewer Conflicts (steps are not compared)'
export const D2E_IMPROVED_RULE = 'improved = eligible ∧ (completed, conflicts) better than I0; improvementKind completed_increase (completed > I0) / conflict_decrease_only (completed = I0, Conflict < I0) / null; equal completed with Conflict >= I0 is not improved (equalMetrics / conflictIncreased recorded)'
export const D2E_SELECTION_ORDER = Object.freeze(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
export const D2E_RV_CHECKS = Object.freeze([
  'RV1 body: SHA-256, id, targetWeaponId, calculationContext, isStale = false, candidateSnapshot.searchRunId = the registered Search identity, SHA-256(candidateStableKey) = the registered keySha256',
  'RV2 replacement: resolveBuildListEntryReplacement(baseline, G) ready with replacedBuildListEntryId = O_t',
  'RV3 the Search-time reservation: K0 phase2c27bResolveSupportContext(baseline, t, []) hashing to the registered K0 digest; K1 the own CTX record reservationBody (object) with the D2-C RESULT context row digest / record SHA-256',
  'RV4 R0: respectsPhase2C2Reservation(summarizePhase2C2Entry(G, baseline), G route, res(G)).respects',
  'RV5 S4: exactly one Export body of s and SHA-256(stableStringify(body)) = the supportBodySha256 of every K1 CTX record of s',
  'RV6 S5: hashStableValue(derivePlannerAlternativeReservation([Export body of s])) = every K1 CTX record reservationDigest of s AND the bodies equal (both objects)',
  'RV runs no Search, no full run, no discovery / materialization; any RV1 .. RV6 failure is a guardrail violation (the run aborts); K2 Candidates are not RV subjects',
])
export const D2E_SUPPORT_CHECKS = Object.freeze([
  'S1 dynamic: the support Target is not in the replacement set T',
  'S2 dynamic: the support Entry is in the final run input (after the runtime-unsupported retries)',
  'S3 dynamic: the support Entry is a valid Entry of the final run input initial context',
  'S4 static: the support Entry in the evaluation input is the Export body and SHA-256(stableStringify(body)) = the S5 authority CTX record supportBodySha256',
  'S5 static: hashStableValue(derivePlannerAlternativeReservation([Export body])) = the S5 authority CTX record reservationDigest AND the bodies equal (both objects); S5 authority: the lowest-k K1 CTX record of the support',
  'S6 static (each K2 Candidate): derivePlannerAlternativeReservation([the two S bodies of the evaluation input]) = the CTX-K2 reservationDigest AND body, and the pooled Search-input reservation digest = the CTX-K2 reservationDigest',
])
export const D2E_SUPPORT_EXPIRY_CAUSES = Object.freeze([...D2C_SUPPORT_EXPIRY_CAUSES, 'support_pair_reservation_mismatch'])
export const D2E_ORDER = Object.freeze(['V', 'RV', 'B0', 'I0', 'CTX-K2', 'DSC L0 -> L1 -> L2', 'ADM (discovery ordinal)', 'EXT (discovery ordinal, admitted only)'])
export const D2E_DECISION_RULE = Object.freeze([
  'D2E_INVALID: any formal validity violation (§4 / §7 / §9 / §10): input_evidence / provenance / baseline_parity_mismatch / d2d_parity / k1_context_parity / k2_context_parity / guardrail / determinism / evidence_integrity / raw_result_mismatch',
  'D2E_INCOMPLETE: invalid 0 and a registered RV / B0 / I0 / CTX / DSC / ADM / EXT is unmeasured or not_executed (a parity not_checked included); measured evidence is a lower bound',
  'D2E_GLOBAL_COMPLETE_R: invalid 0, unmeasured 0, an EXT satisfies R6',
  'D2E_EXCEEDS_D2D_BEST: otherwise, at least one improved EXT',
  'D2E_SET_COEXISTENT_NOT_BETTER: otherwise, at least one EXT with R5 satisfied',
  'D2E_NO_SET_COEXISTENCE: otherwise, at least one measured EXT, all with R5 not satisfied',
  'D2E_NO_ADMITTED_K2_CANDIDATE: invalid 0, unmeasured 0, a non-empty pool, every ADM measured with R1 false (no EXT)',
  'D2E_NO_K2_CANDIDATE: invalid 0, unmeasured 0, the discovery ended ladder_exhausted or discovery_exhausted with an empty pool',
])
/** What D2-E deliberately does not run (§2.3 / §16). */
export const D2E_NOT_RUN = Object.freeze(['t02_search', 't05_t07_additional_search', 't04_t10_axis', 'other_pair_origin', 'k0_k1_k3_context_search', 'k2_search_outside_t03', 'e2_search', 'residual_3',
  'co_participant_support', 'adaptive_support', 'alternative_to_alternative_support', 'd2c_t03_k1_reevaluation', 'd2b_t03_k0_reevaluation', 'multiple_passes', 'extension_composition',
  'three_or_more_targets', 'population_expansion', 'pool_cap_expansion', 'extent_expansion', 'oracle_comparison', 'prior_result_rewrite', 'resolution_synthesis', 'repair_lineage', 'persistence', 'retry',
  'fallback', 'production_change', 'production_default_change'])

export function d2ePolicyDrift(): string[] {
  const issues: string[] = []
  const b = D2E_BUDGETS
  if (b.evaluationRequestsMax !== b.b0Evaluations + b.i0Evaluations + b.admissionEvaluationsMax + b.extensionEvaluationsMax) issues.push('the evaluation budget is not 1 + 1 + 2 + 2')
  if (b.childProcessesMax !== b.rvChildren + b.contextChildren + b.discoveryUnitsMax + b.evaluationRequestsMax) issues.push('the child process budget is not 1 + 1 + 3 + 6')
  if (b.fullPlannerRunsMax !== b.evaluationRequestsMax * D2E_EVALUATION_FULL_RUN_CAP) issues.push('the full Planner run maximum is not 6 x 8')
  if (b.discoveryUnitsMax !== D2E_LADDER.length || b.uniqueCandidatesMax !== D2E_K2_POOL_CAP || b.admissionEvaluationsMax !== D2E_K2_POOL_CAP) issues.push('the discovery budget is not 3 rungs / 2 Candidates')
  if (D2E_RESEARCH_MAX_PLAN_STEPS !== 20_000 || D2E_EVALUATION_FULL_RUN_CAP !== 8) issues.push('the Research bound / full run cap moved')
  if (!same(D2E_LADDER.map(r => [r.id, r.extent.maxNormalAdvance, r.extent.maxGogmaAdvance, r.extent.maxSkillAdvance]), [['L0', 4, 235, 4], ['L1', 8, 235, 256], ['L2', 128, 235, 1500]])) issues.push('the ladder moved')
  return issues
}

// ---------------------------------------------------------------- labels and IDs

/** `K2-<t>-<the first 8 characters of each support Entry hash, Entry ID ascending>` (a display ID; identity is the TargetWeapon ID and the full Entry IDs). */
export const d2eContextId = (label: string, supportBuildListEntryIds: readonly string[]) => `K2-${label}-${sortedIds(supportBuildListEntryIds).map(suffix8).join('-')}`
export const D2E_RV_UNIT_ID = 'RV'
export const D2E_RV_RECORD_FILE = 'RV.record.json'
export const D2E_CONTEXT_UNIT_ID = 'CTX-K2'
export const D2E_CONTEXT_RECORD_FILE = 'CTX-K2.context.json'
export const d2eDiscoveryUnitId = (rung: Phase2C27BRungId) => `DSC-K2-${rung}`
export const d2eDiscoveryRecordFile = (rung: Phase2C27BRungId) => `${d2eDiscoveryUnitId(rung)}.record.json`
export const d2eAdmissionId = (label: string, ordinal: number) => `ADM-K2-${label}-c${ordinal}`
export const d2eExtensionId = (label: string, ordinal: number) => `EXT-K2-${label}-c${ordinal}`
export const d2eEvaluationRecordFile = (evaluationId: string) => `${evaluationId}.record.json`
export const d2ePoolFileName = (contextId: string, indexInContext: number) => `${contextId}-c${indexInContext}.generated-entry.json`
export const d2eRungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...D2E_LADDER.find(r => r.id === rung)!.extent })

// ---------------------------------------------------------------- the D2-D / D2-C / D2 RESULT allowlists (§10.1)

export interface D2EFileRef { file: string; bytes: number | null; sha256: string | null }
const fileRef = (v: unknown): D2EFileRef | null => isObject(v) && typeof v.file === 'string'
  ? { file: v.file, bytes: typeof v.bytes === 'number' ? v.bytes : null, sha256: typeof v.sha256 === 'string' ? v.sha256 : null } : null
const fileRefs = (v: unknown): D2EFileRef[] => (Array.isArray(v) ? v : []).map(fileRef).filter((x): x is D2EFileRef => x !== null)
export interface D2EPriorEvaluation { source: 'D2-D' | 'D2-C' | 'D2'; evaluationId: string; status: string; inputDigest: string | null; resultDigest: string | null }
const priorRows = (source: D2EPriorEvaluation['source'], v: unknown): D2EPriorEvaluation[] => (Array.isArray(v) ? v : []).filter(isObject).map(e => ({ source, evaluationId: String(e.evaluationId),
  status: String(e.status), inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null }))

export interface D2ECandidateRow {
  label: string
  ordinal: number
  origin: string
  contextId: string | null
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntry: D2EFileRef | null
  requiresSupport: string[]
  searchIdentity: string
  keySha256: string
}
const candidateRow = (c: Json): D2ECandidateRow => ({ label: String(c.label), ordinal: Number(c.ordinal), origin: String(c.origin), contextId: typeof c.contextId === 'string' ? c.contextId : null,
  targetWeaponId: String(c.targetWeaponId), currentBuildListEntryId: String(c.currentBuildListEntryId), generatedBuildListEntryId: String(c.generatedBuildListEntryId), generatedEntry: fileRef(c.generatedEntry),
  requiresSupport: strings(c.requiresSupport), searchIdentity: String(c.searchIdentity), keySha256: String(c.keySha256) })

export interface D2ED2DEvaluation {
  evaluationId: string
  stage: string | null
  status: string
  inputDigest: string | null
  resultDigest: string | null
  generatedEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  termination: { status: string; completedTargetCount: number; totalTargetCount: number; reachedLimits: string[] } | null
  steps: number | null
  selectedBuildListEntryIds: string[]
  conflictCount: number | null
  resourceConflictRejections: number | null
  r5: { satisfied: boolean | null; failureReasons: string[] } | null
  r6Satisfied: boolean | null
  selectedTargetWeaponIds: string[]
  supportChecksByEntry: Record<string, { selected: boolean | null; supportExpiryCause: string | null }>
}
export interface D2ED2DResultProjection {
  sources: { specDocument: D2EFileRef | null; d2c: Record<string, unknown>; d2: Record<string, unknown>; phase2c2Result: D2EFileRef | null; export: D2EFileRef | null; documents: Record<string, D2EFileRef>;
    d2d: { raw: D2EFileRef | null; runDir: unknown; attestation: D2EFileRef | null } }
  provenance: Record<string, unknown>
  invalidReasons: unknown
  decision: { case: unknown; bestEligiblePair: unknown; bestImprovedPair: unknown }
  aggregates: { unmeasuredByReason: unknown; notExecutedByReason: unknown }
  pairsRanking: unknown
  derivedPair: { pairOrdinal: number; evaluationId: string; t05Ordinal: number; t07Ordinal: number; generatedBuildListEntryIds: string[]; generatedEntrySha256s: string[]; requiresSupport: string[]; inputDigest: string } | null
  conditions: { fixedCandidates: D2ECandidateRow[]; t05Candidate: D2ECandidateRow | null; t07Candidate: D2ECandidateRow | null }
  rv: { status: unknown; satisfied: unknown }
  evaluations: D2ED2DEvaluation[]
  prior: D2EPriorEvaluation[]
}

/** Reads ONLY the allowlisted D2-D RESULT fields (§10.1). */
export function projectD2ED2DResult(json: unknown): D2ED2DResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.inputValidation)
    || !isObject(json.conditions) || !isObject(json.rv) || !Array.isArray(json.evaluations) || !isObject(json.pairs)) return null
  const s = json.sources, p = json.provenance, d = json.decision
  const best = typeof d.bestImprovedPair === 'string' ? d.bestImprovedPair : null
  const derived = (Array.isArray(json.inputValidation.derivedPairs) ? json.inputValidation.derivedPairs as unknown[] : []).filter(isObject).find(x => best !== null && x.evaluationId === best) ?? null
  const t05Ordinal = derived !== null && typeof derived.t05Ordinal === 'number' ? derived.t05Ordinal : null
  const t07Ordinal = derived !== null && typeof derived.t07Ordinal === 'number' ? derived.t07Ordinal : null
  const list = (v: unknown) => (Array.isArray(v) ? v as unknown[] : []).filter(isObject)
  const c = json.conditions
  const pick = (v: unknown, ordinal: number | null) => { const row = list(v).find(x => x.ordinal === ordinal); return row === undefined ? null : candidateRow(row) }
  const evals = isObject(json.aggregates.evaluations) ? json.aggregates.evaluations : {}
  const read = new Set([...D2D_EVALUATIONS_READ, ...(best === null ? [] : [best])])
  const evaluations: D2ED2DEvaluation[] = (json.evaluations as unknown[]).filter(isObject).filter(e => read.has(e.evaluationId as string)).map(e => {
    const plan = isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    const sup = isObject(e.supportChecksByEntry) ? e.supportChecksByEntry : {}
    return { evaluationId: String(e.evaluationId), stage: typeof e.stage === 'string' ? e.stage : null, status: String(e.status),
      inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      generatedEntryIds: strings(e.generatedEntryIds), generatedEntrySha256s: strings(e.generatedEntrySha256s), requiresSupport: strings(e.requiresSupport),
      termination: t === null ? null : { status: String(t.status), completedTargetCount: Number(t.completedTargetCount), totalTargetCount: Number(t.totalTargetCount), reachedLimits: strings(t.reachedLimits) },
      steps: plan && typeof plan.steps === 'number' ? plan.steps : null, selectedBuildListEntryIds: strings(plan?.selectedBuildListEntryIds),
      conflictCount: Array.isArray(e.conflicts) ? e.conflicts.length : null, resourceConflictRejections: typeof e.resourceConflictRejections === 'number' ? e.resourceConflictRejections : null,
      r5: isObject(e.r5) ? { satisfied: typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null, failureReasons: strings(e.r5.failureReasons) } : null,
      r6Satisfied: isObject(e.r6) && typeof e.r6.satisfied === 'boolean' ? e.r6.satisfied : null, selectedTargetWeaponIds: strings(e.selectedTargetWeaponIds),
      supportChecksByEntry: Object.fromEntries(Object.entries(sup).filter(([, v]) => isObject(v)).map(([k, v]) => [k, { selected: typeof (v as Json).selected === 'boolean' ? (v as Json).selected as boolean : null,
        supportExpiryCause: typeof (v as Json).supportExpiryCause === 'string' ? (v as Json).supportExpiryCause as string : null }])) }
  })
  const d2d = isObject(s.d2d) ? s.d2d : {}
  const docs = isObject(s.documents) ? s.documents : {}
  return {
    sources: { specDocument: fileRef(s.specDocument), d2c: isObject(s.d2c) ? structuredClone(s.d2c) : {}, d2: isObject(s.d2) ? structuredClone(s.d2) : {}, phase2c2Result: fileRef(s.phase2c2Result), export: fileRef(s.export),
      documents: Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map((k): [string, D2EFileRef | null] => [k, fileRef(docs[k])]).filter((x): x is [string, D2EFileRef] => x[1] !== null)),
      d2d: { raw: fileRef(d2d.raw), runDir: d2d.runDir ?? null, attestation: fileRef(d2d.attestation) } },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, analysisHead: p.analysisHead, measuredHeadIsAncestor: p.measuredHeadIsAncestor, runStatus: p.runStatus, benchmarkCodeSha256: p.benchmarkCodeSha256,
      registeredPolicySha256: p.registeredPolicySha256, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead), productionChangedFiles: structuredClone(p.productionChangedFiles),
      startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null, startAttestationVerified: isObject(p.startAttestation) ? p.startAttestation.verified : null,
      oracleReadByRunner: p.oracleReadByRunner, oracleReadByChild: p.oracleReadByChild, oracleReadByAnalyzer: p.oracleReadByAnalyzer, oracleGuidedTargetPopulation: p.oracleGuidedTargetPopulation },
    invalidReasons: structuredClone(json.invalidReasons), decision: { case: d.case, bestEligiblePair: d.bestEligiblePair, bestImprovedPair: d.bestImprovedPair },
    aggregates: { unmeasuredByReason: structuredClone(evals.unmeasuredByReason), notExecutedByReason: structuredClone(evals.notExecutedByReason) },
    pairsRanking: structuredClone(json.pairs.ranking),
    derivedPair: derived === null || t05Ordinal === null || t07Ordinal === null ? null : { pairOrdinal: Number(derived.pairOrdinal), evaluationId: String(derived.evaluationId), t05Ordinal, t07Ordinal,
      generatedBuildListEntryIds: strings(derived.generatedBuildListEntryIds), generatedEntrySha256s: strings(derived.generatedEntrySha256s), requiresSupport: strings(derived.requiresSupport), inputDigest: String(derived.inputDigest) },
    conditions: { fixedCandidates: list(c.fixedCandidates).map(candidateRow), t05Candidate: pick(c.t05Candidates, t05Ordinal), t07Candidate: pick(c.t07Candidates, t07Ordinal) },
    rv: { status: json.rv.status, satisfied: json.rv.satisfied },
    evaluations,
    prior: priorRows('D2-D', json.evaluations),
  }
}

export interface D2ED2CContextRow {
  contextId: string
  k: number
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryId: string
  supportTargetWeaponId: string | null
  record: D2EFileRef | null
  supportBodySha256: string | null
  reservationDigest: string | null
  originDigest: string | null
  excludedRouteKeySha256s: string[]
  status: string | null
}
export interface D2ED2CObservation {
  evaluationId: string
  stage: string
  targetLabel: string
  status: string
  candidates: { label: string; selected: boolean | null; winnerBuildListEntryId: string | null; contextId: string | null; generatedBuildListEntryId: string | null }[]
  r1: boolean | null
  r5: { satisfied: boolean | null; failureReasons: string[] } | null
  /** The Conflicts holding the targetLabel Candidate G as a participant. */
  conflicts: { kind: string; participants: string[]; resourceIdentity: string | null }[]
}
export interface D2ED2CPoolRow { ordinal: number; contextId: string; keySha256: string; generatedBuildListEntryId: string; requiresSupport: string[] }
export interface D2ED2CResultProjection {
  sources: Json
  provenance: Record<string, unknown>
  invalidReasons: unknown
  decisionCase: unknown
  aggregates: { unmeasuredByReason: unknown; notExecutedByReason: unknown }
  compositionSteps: { label: string; stepOutcome: string }[]
  contexts: D2ED2CContextRow[]
  /** D2C_NE: the not_replaced_no_eligible labels (label ascending). */
  notEligibleLabels: string[]
  /** discovery.targets[label = a derived K2 Target] (the labels of D2C_NE with at least two context_ready contexts). */
  poolTargets: { label: string; targetWeaponId: string; currentBuildListEntryId: string; contextIds: string[]; pool: D2ED2CPoolRow[] }[]
  observations: D2ED2CObservation[]
  prior: D2EPriorEvaluation[]
}

/** Reads ONLY the allowlisted D2-C RESULT fields (§10.1). */
export function projectD2ED2CResult(json: unknown): D2ED2CResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.discovery)
    || !Array.isArray(json.evaluations) || !isObject(json.composition) || !isObject(json.composition.main) || !Array.isArray(json.contexts)) return null
  const p = json.provenance
  const main = json.composition.main as Json
  const compositionSteps = (Array.isArray(main.steps) ? main.steps as unknown[] : []).filter(isObject).map(st => ({ label: String(st.label), stepOutcome: String(st.stepOutcome) }))
  const notEligibleLabels = compositionSteps.filter(st => st.stepOutcome === 'not_replaced_no_eligible').map(st => st.label).sort(compare)
  const contexts: D2ED2CContextRow[] = (json.contexts as unknown[]).filter(isObject).map(c => ({ contextId: String(c.contextId), k: Number(c.k), label: String(c.label), targetWeaponId: String(c.targetWeaponId),
    currentBuildListEntryId: String(c.currentBuildListEntryId), supportBuildListEntryId: String(c.supportBuildListEntryId), supportTargetWeaponId: typeof c.supportTargetWeaponId === 'string' ? c.supportTargetWeaponId : null,
    record: fileRef(c.record), supportBodySha256: typeof c.supportBodySha256 === 'string' ? c.supportBodySha256 : null, reservationDigest: typeof c.reservationDigest === 'string' ? c.reservationDigest : null,
    originDigest: typeof c.originDigest === 'string' ? c.originDigest : null, excludedRouteKeySha256s: strings(c.excludedRouteKeySha256s), status: typeof c.status === 'string' ? c.status : null }))
  const k2Labels = new Set(notEligibleLabels.filter(label => contexts.filter(c => c.label === label && c.status === 'context_ready').length >= 2))
  const poolTargets = (Array.isArray(json.discovery.targets) ? json.discovery.targets as unknown[] : []).filter(isObject).filter(t => k2Labels.has(t.label as string)).map(t => ({
    label: String(t.label), targetWeaponId: String(t.targetWeaponId), currentBuildListEntryId: String(t.currentBuildListEntryId), contextIds: strings(t.contextIds),
    pool: (Array.isArray(t.pool) ? t.pool as unknown[] : []).filter(isObject).map(x => ({ ordinal: Number(x.ordinal), contextId: String(x.contextId), keySha256: String(x.keySha256),
      generatedBuildListEntryId: String(x.generatedBuildListEntryId), requiresSupport: strings(x.requiresSupport) })) }))
  const ne = new Set(notEligibleLabels)
  const observations: D2ED2CObservation[] = (json.evaluations as unknown[]).filter(isObject).filter(e => (e.stage === 'ADM' || e.stage === 'CMP') && ne.has(e.targetLabel as string)).map(e => {
    const label = String(e.targetLabel)
    const candidates = (Array.isArray(e.candidates) ? e.candidates as unknown[] : []).filter(isObject).filter(c => c.label === label).map(c => ({ label: String(c.label),
      selected: typeof c.selected === 'boolean' ? c.selected : null, winnerBuildListEntryId: typeof c.winnerBuildListEntryId === 'string' ? c.winnerBuildListEntryId : null,
      contextId: typeof c.contextId === 'string' ? c.contextId : null, generatedBuildListEntryId: typeof c.generatedBuildListEntryId === 'string' ? c.generatedBuildListEntryId : null }))
    const g = candidates.length === 1 ? candidates[0]!.generatedBuildListEntryId : null
    return { evaluationId: String(e.evaluationId), stage: String(e.stage), targetLabel: label, status: String(e.status), candidates,
      r1: isObject(e.r1r4) && typeof e.r1r4.R1 === 'boolean' ? e.r1r4.R1 : null,
      r5: isObject(e.r5) ? { satisfied: typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null, failureReasons: strings(e.r5.failureReasons) } : null,
      conflicts: g === null ? [] : (Array.isArray(e.conflicts) ? e.conflicts as unknown[] : []).filter(isObject).filter(c => strings(c.participants).includes(g))
        .map(c => ({ kind: String(c.kind), participants: strings(c.participants), resourceIdentity: typeof c.resourceIdentity === 'string' ? c.resourceIdentity : null })) }
  })
  const evals = isObject(json.aggregates.evaluations) ? json.aggregates.evaluations : {}
  return {
    sources: structuredClone(json.sources),
    provenance: { formal: p.formal, measuredHead: p.measuredHead, analysisHead: p.analysisHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead),
      productionChangedFiles: structuredClone(p.productionChangedFiles), startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null,
      startAttestationVerified: isObject(p.startAttestation) ? p.startAttestation.verified : null },
    invalidReasons: structuredClone(json.invalidReasons), decisionCase: json.decision.case,
    aggregates: { unmeasuredByReason: structuredClone(evals.unmeasuredByReason), notExecutedByReason: structuredClone(evals.notExecutedByReason) },
    compositionSteps, contexts, notEligibleLabels, poolTargets, observations, prior: priorRows('D2-C', json.evaluations),
  }
}

export interface D2ED2ResultProjection {
  sourcesExport: D2EFileRef | null
  provenance: { formal: unknown; measuredHead: unknown }
  invalidReasons: unknown
  decisionCase: unknown
  targets: { label: string; targetWeaponId: string; currentBuildListEntryId: string }[]
  /** discovery.targets[label in poolLabels].pool[].{ordinal, keySha256} (D-4). */
  pools: Record<string, { ordinal: number; keySha256: string }[]>
  prior: D2EPriorEvaluation[]
}

/** Reads ONLY the allowlisted D2 RESULT fields (§10.1); the pools only of `poolLabels` (the derived K2 Targets). */
export function projectD2ED2Result(json: unknown, poolLabels: readonly string[]): D2ED2ResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.discovery) || !Array.isArray(json.evaluations)) return null
  const targets = (Array.isArray(json.discovery.targets) ? json.discovery.targets as unknown[] : []).filter(isObject)
  return {
    sourcesExport: fileRef(json.sources.export), provenance: { formal: json.provenance.formal, measuredHead: json.provenance.measuredHead }, invalidReasons: structuredClone(json.invalidReasons),
    decisionCase: json.decision.case,
    targets: targets.map(t => ({ label: String(t.label), targetWeaponId: String(t.targetWeaponId), currentBuildListEntryId: String(t.currentBuildListEntryId) })),
    pools: Object.fromEntries(targets.filter(t => poolLabels.includes(t.label as string)).map(t => [String(t.label), (Array.isArray(t.pool) ? t.pool as unknown[] : []).filter(isObject)
      .map(x => ({ ordinal: Number(x.ordinal), keySha256: String(x.keySha256) }))])),
    prior: priorRows('D2', json.evaluations),
  }
}

export interface D2EContextRecordProjection {
  contextId: string
  supportBuildListEntryId: string
  supportBodySha256: string
  /** The CTX record `result.reservationBody` (a JSON object, never a string). */
  reservationBody: Json
  reservationDigest: string
  originDigest: string
  excludedRouteKeys: string[]
  excludedRouteKeySha256s: string[]
  status: string
}
/** §10.1: reads ONLY the allowlisted CTX record fields (through `readD2CContextRecord()`: `reservationBody` must be a JSON object). */
export function readD2EContextRecord(json: unknown): { record: D2EContextRecordProjection | null; issue: string | null } {
  const read = readD2CContextRecord(json)
  if (read.issue !== null || read.record === null) return { record: null, issue: read.issue ?? 'no record' }
  const r = read.record as unknown as Json
  if (r.status !== 'context_ready') return { record: null, issue: `the CTX record status is ${String(r.status)}, not context_ready` }
  if (!isObject(r.reservationBody) || typeof r.contextId !== 'string' || typeof r.supportBuildListEntryId !== 'string' || typeof r.supportBodySha256 !== 'string' || typeof r.reservationDigest !== 'string'
    || typeof r.originDigest !== 'string' || !Array.isArray(r.excludedRouteKeys) || !Array.isArray(r.excludedRouteKeySha256s)) {
    return { record: null, issue: 'the CTX record lacks contextId / supportBuildListEntryId / supportBodySha256 / reservationDigest / originDigest / excludedRouteKeys or its reservationBody is not a JSON object' }
  }
  return { record: { contextId: r.contextId, supportBuildListEntryId: r.supportBuildListEntryId, supportBodySha256: r.supportBodySha256, reservationBody: structuredClone(r.reservationBody),
    reservationDigest: r.reservationDigest, originDigest: r.originDigest, excludedRouteKeys: strings(r.excludedRouteKeys), excludedRouteKeySha256s: strings(r.excludedRouteKeySha256s), status: r.status }, issue: null }
}

// ---------------------------------------------------------------- the registered tables of the attested D2-E document

export interface D2ESpecK2Row {
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  currentKeySha256: string
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: string[]
  supportBodySha256s: string[]
  admObserved: number
  cmpObserved: number
}
const linesOf = (markdown: string) => markdown.replace(/\r\n/g, '\n').split('\n')
const tableAfter = (markdown: string, heading: RegExp, header: RegExp): string[][] => {
  const lines = linesOf(markdown)
  const h = lines.findIndex(line => heading.test(line))
  if (h < 0) return []
  const start = lines.findIndex((line, i) => i > h && header.test(line))
  if (start < 0) return []
  const rows: string[][] = []
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) rows.push(lines[i]!.split('|').slice(1, -1).map(cell => cell.trim()))
  return rows
}

/** The D2-E-A §3.2 registered K2 context (the registered values; the source holds none of them), or null when the table is absent. */
export function parseD2ESpecK2Context(markdown: string): D2ESpecK2Row | null {
  const rows = tableAfter(markdown, /^### 3\.2 登録K2 context/, /^\| 項目 \| 値 \|/)
  const cell = (key: RegExp) => rows.find(r => key.test(r[0] ?? ''))?.[1] ?? null
  const id = cell(/^context ID$/), target = cell(/^Target$/), current = cell(/^`O_t`$/), support = cell(/^support/), basis = cell(/^導出根拠$/)
  if (id === null || target === null || current === null || support === null || basis === null) return null
  const supportTicks = ticks(support)
  return {
    contextId: ticks(id)[0] ?? '', label: target.split('、')[0]!.trim(), targetWeaponId: ticks(target)[0] ?? '',
    currentBuildListEntryId: ticks(current)[0] ?? '', currentKeySha256: ticks(current).find(t => /^[0-9a-f]{64}$/.test(t)) ?? '',
    supportBuildListEntryIds: supportTicks.filter(t => t.startsWith('build-list.')),
    supportTargetWeaponIds: supportTicks.filter(t => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)),
    supportBodySha256s: supportTicks.map(t => /^supportBodySha256 ([0-9a-f]{64})$/.exec(t)?.[1] ?? null).filter((x): x is string => x !== null),
    admObserved: Number(/ADM (\d+)件/.exec(basis)?.[1]), cmpObserved: Number(/CMP (\d+)件/.exec(basis)?.[1]),
  }
}

export interface D2ESpecIncumbentRow {
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  origin: D2EOrigin | null
  contextId: string | null
  ordinal: number
  file: string
  bytes: number
  sha256: string
  generatedBuildListEntryId: string
  searchIdentity: string
  keySha256: string
  requiresSupportSuffixes: string[]
}
/** The D2-E-A §1.2 registered incumbent table (the registered values; the source holds none of the IDs). */
export function parseD2ESpecIncumbentTable(markdown: string): D2ESpecIncumbentRow[] {
  return tableAfter(markdown, /^### 1\.2 D2-D最良incumbent/, /^\| t \| TargetWeapon ID \| `O_t` \| 由来 \|/).map(cells => {
    const [t, target, current, origin, file, bytes, sha, generated, search, key, support] = cells
    const o = origin ?? ''
    return { label: t ?? '', targetWeaponId: ticks(target ?? '')[0] ?? '', currentBuildListEntryId: ticks(current ?? '')[0] ?? '',
      origin: o.startsWith('D2-C') ? 'd2c_k1' : o.startsWith('D2-B') ? 'd2b_k0' : null, contextId: o.startsWith('D2-C') ? ticks(o)[0] ?? null : null, ordinal: Number(/c(\d+)\s*$/.exec(o)?.[1]),
      file: ticks(file ?? '')[0] ?? '', bytes: Number((bytes ?? '').replace(/,/g, '')), sha256: ticks(sha ?? '')[0] ?? '', generatedBuildListEntryId: ticks(generated ?? '')[0] ?? '',
      searchIdentity: ticks(search ?? '')[0] ?? '', keySha256: ticks(key ?? '')[0] ?? '', requiresSupportSuffixes: ticks(support ?? '') }
  })
}

/** §1.7 / §3.3: the registered K2 reservation body (the JSON block after 「導出されたK2 reservation body」), or null. */
export function parseD2ESpecRegisteredReservation(markdown: string): Json | null {
  const lines = linesOf(markdown)
  const at = lines.findIndex(line => line.startsWith('導出されたK2 reservation body'))
  if (at < 0) return null
  const open = lines.findIndex((line, i) => i > at && line.trim() === '```json')
  const close = open < 0 ? -1 : lines.findIndex((line, i) => i > open && line.trim() === '```')
  if (open < 0 || close < 0) return null
  try { const v: unknown = JSON.parse(lines.slice(open + 1, close).join('\n')); return isObject(v) ? v : null } catch { return null }
}

/** §1.5: the full resource identities the D2-E text registers for the D2-C t03 Conflicts (the 「resource identityの全文」 bullet). */
export function parseD2ESpecT03ResourceIdentities(markdown: string): string[] {
  const lines = linesOf(markdown)
  const at = lines.findIndex(l => l.includes('resource identityの全文'))
  if (at < 0) return []
  // The bullet and its indented continuation lines.
  const bullet = [lines[at]!]
  for (let i = at + 1; i < lines.length && /^ {2}\S/.test(lines[i]!); i += 1) bullet.push(lines[i]!)
  return ticks(bullet.join(' ')).filter(t => t.startsWith('{')).sort(compare)
}

// ---------------------------------------------------------------- §3.1: the K2 derivation, §6.1: the I0 derivation

export interface D2EK2Context {
  contextId: string
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  /** Entry ID ascending. */
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: string[]
  /** The D2-C K1 contexts of the Target (k ascending) whose support is each S element. */
  k1Contexts: { k: number; contextId: string; supportBuildListEntryId: string }[]
  admObserved: number
  cmpObserved: number
  crossSupportLossAll: boolean
}
export interface D2EK2Derivation { issues: string[]; notEligibleLabels: string[]; contexts: D2EK2Context[] }

/** §3.1, mechanically, from the D2-C RESULT allowlist (pure; never repairs a value). */
export function deriveD2EK2Contexts(d2c: D2ED2CResultProjection): D2EK2Derivation {
  const issues: string[] = []
  const contexts: D2EK2Context[] = []
  for (const t of d2c.notEligibleLabels) {
    const ctx = d2c.contexts.filter(c => c.label === t && c.status === 'context_ready').sort((a, b) => a.k - b.k)
    if (ctx.length < 2) continue
    const sup = new Map(ctx.map(c => [c.contextId, c.supportBuildListEntryId]))
    const obs = d2c.observations.filter(e => e.targetLabel === t)
    let lossAll = obs.length > 0
    for (const e of obs) {
      if (e.status !== 'evaluated') { issues.push(`${e.evaluationId}: not evaluated (V fails)`); lossAll = false; continue }
      if (e.candidates.length !== 1) { issues.push(`${e.evaluationId}: ${e.candidates.length} candidates of ${t}, not exactly 1 (V fails)`); lossAll = false; continue }
      const x = e.candidates[0]!
      const others = new Set(ctx.filter(c => c.contextId !== x.contextId).map(c => c.supportBuildListEntryId))
      const loss = x.selected === false && x.winnerBuildListEntryId !== null && others.has(x.winnerBuildListEntryId)
      if (!loss) lossAll = false
      if (x.contextId === null || !sup.has(x.contextId)) issues.push(`${e.evaluationId}: the Candidate context is not a context of ${t}`)
    }
    const adm = obs.filter(e => e.stage === 'ADM'), cmp = obs.filter(e => e.stage === 'CMP')
    const r1All = adm.length > 0 && adm.every(e => e.r1 === true)
    if (!r1All || !lossAll) continue
    const first = ctx[0]!
    if (ctx.some(c => c.targetWeaponId !== first.targetWeaponId || c.currentBuildListEntryId !== first.currentBuildListEntryId)) { issues.push(`${t}: the contexts disagree on the Target / O_t`); continue }
    const supports = sortedIds([...new Set(ctx.map(c => c.supportBuildListEntryId))])
    contexts.push({ contextId: d2eContextId(t, supports), label: t, targetIndex: Number(t.slice(1)), targetWeaponId: first.targetWeaponId, currentBuildListEntryId: first.currentBuildListEntryId,
      supportBuildListEntryIds: supports, supportTargetWeaponIds: supports.map(s => ctx.find(c => c.supportBuildListEntryId === s)?.supportTargetWeaponId ?? ''),
      k1Contexts: ctx.map(c => ({ k: c.k, contextId: c.contextId, supportBuildListEntryId: c.supportBuildListEntryId })), admObserved: adm.length, cmpObserved: cmp.length, crossSupportLossAll: lossAll })
  }
  return { issues, notEligibleLabels: [...d2c.notEligibleLabels], contexts }
}

export interface D2ECandidateRef {
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  ordinal: number
  origin: D2EOrigin
  contextId: string | null
  /** The own CTX record k (K1 only). */
  contextK: number | null
  generatedBuildListEntryId: string
  runDir: string
  file: string
  bytes: number
  sha256: string
  requiresSupport: string[]
  searchIdentity: string
  keySha256: string
}
export interface D2EI0Derivation {
  issues: string[]
  replacements: D2ECandidateRef[]
  generatedBuildListEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  inputDigest: string | null
  registeredInputDigest: string
}

const sortRefs = <T extends { targetWeaponId: string }>(refs: readonly T[]) => [...refs].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))

/** §6.1, mechanically, from the D2-D RESULT allowlist (the 9 Candidates of `decision.bestImprovedPair`), with their `inputDigest`. */
export function deriveD2EI0(d2d: D2ED2DResultProjection, d2cContexts: readonly D2ED2CContextRow[], exportSha256: string): D2EI0Derivation {
  const issues: string[] = []
  const fail = (): D2EI0Derivation => ({ issues, replacements: [], generatedBuildListEntryIds: [], generatedEntrySha256s: [], requiresSupport: [], inputDigest: null, registeredInputDigest: D2E_I0_EXPECTED.inputDigest })
  if (d2d.decision.bestImprovedPair !== D2E_D2D_PROVENANCE.bestPair || d2d.decision.bestEligiblePair !== D2E_D2D_PROVENANCE.bestPair) { issues.push('D2-D bestImprovedPair / bestEligiblePair is not the registered PAIR'); return fail() }
  const pair = d2d.derivedPair
  if (pair === null || d2d.conditions.t05Candidate === null || d2d.conditions.t07Candidate === null) { issues.push('the D2-D RESULT has no derivedPairs row / t05 / t07 Candidate of the best PAIR'); return fail() }
  const rows = [...d2d.conditions.fixedCandidates, d2d.conditions.t05Candidate, d2d.conditions.t07Candidate]
  const refs: D2ECandidateRef[] = []
  for (const row of rows) {
    const origin: D2EOrigin | null = row.origin === 'd2b_k0' || row.origin === 'd2c_k1' ? row.origin : null
    const registered = D2E_INCUMBENT_G_STORE_FILES.find(f => f.label === row.label && f.ordinal === row.ordinal && f.origin === origin)
    const g = row.generatedEntry
    if (origin === null || !registered || g === null || g.file !== `${registered.runDir}/${registered.file}` || g.sha256 !== registered.sha256 || g.bytes !== registered.bytes) {
      issues.push(`${row.label} c${row.ordinal}: the D2-D condition G store row is not the registered file`); continue
    }
    const ctx = origin === 'd2c_k1' ? d2cContexts.find(c => c.contextId === row.contextId) ?? null : null
    if (origin === 'd2c_k1' && (ctx === null || row.requiresSupport.length !== 1 || ctx.supportBuildListEntryId !== row.requiresSupport[0])) issues.push(`${row.label} c${row.ordinal}: a K1 Candidate without its D2-C context / single support`)
    if (origin === 'd2b_k0' && (row.contextId !== null || row.requiresSupport.length !== 0)) issues.push(`${row.label} c${row.ordinal}: a K0 Candidate with a context / support`)
    refs.push({ label: row.label, targetIndex: Number(row.label.slice(1)), targetWeaponId: row.targetWeaponId, currentBuildListEntryId: row.currentBuildListEntryId, ordinal: row.ordinal, origin,
      contextId: origin === 'd2c_k1' ? row.contextId : null, contextK: ctx?.k ?? null, generatedBuildListEntryId: row.generatedBuildListEntryId, runDir: registered.runDir, file: registered.file,
      bytes: registered.bytes, sha256: registered.sha256, requiresSupport: [...row.requiresSupport], searchIdentity: row.searchIdentity, keySha256: row.keySha256 })
  }
  const reps = sortRefs(refs)
  if (reps.length !== 9 || new Set(reps.map(r => r.targetWeaponId)).size !== 9) issues.push(`the I0 set holds ${reps.length} Candidates of ${new Set(reps.map(r => r.targetWeaponId)).size} Targets, not 9 / 9 (G15)`)
  const ids = reps.map(r => r.generatedBuildListEntryId), shas = reps.map(r => r.sha256)
  const requiresSupport = sortedIds([...new Set(reps.flatMap(r => r.requiresSupport))])
  if (!same(ids, pair.generatedBuildListEntryIds) || !same(shas, pair.generatedEntrySha256s) || !same(requiresSupport, sortedIds(pair.requiresSupport))) issues.push('the derived I0 set is not the D2-D derivedPairs row of the best PAIR')
  const inputDigest = d1InputDigest(reps.map(r => r.targetWeaponId), ids, shas, exportSha256)
  if (inputDigest !== D2E_I0_EXPECTED.inputDigest || pair.inputDigest !== D2E_I0_EXPECTED.inputDigest) issues.push(`I0: inputDigest ${inputDigest} (D2-D ${pair.inputDigest}) is not the registered ${D2E_I0_EXPECTED.inputDigest}`)
  if (requiresSupport.length !== 3) issues.push(`I0: |S_sup| = ${requiresSupport.length}, not 3`)
  return { issues, replacements: reps, generatedBuildListEntryIds: ids, generatedEntrySha256s: shas, requiresSupport, inputDigest, registeredInputDigest: D2E_I0_EXPECTED.inputDigest }
}

// ---------------------------------------------------------------- V: the registered inputs (§10.1)

export interface D2EObservedFile { bytes: number; sha256: string }
export interface D2EInputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D2ERegisteredInputKey, D2EObservedFile | null>
  /** The chained documents (D2-D RESULT sources.documents), by key. */
  documents: Record<string, D2EObservedFile | null>
  /** By `d2eGStoreKey(label, ordinal)`: the G store file and its JSON. */
  gStoreFiles: Record<string, { file: D2EObservedFile; json: unknown } | null>
  /** By CTX k: the CTX record file and its JSON. */
  contextRecords: Record<number, { file: D2EObservedFile; json: unknown } | null>
  d2dResult: unknown
  d2cResult: unknown
  d2Result: unknown
  phase2c2Result: unknown
  /** The Export `buildListEntries` (the support bodies, C1). */
  exportBuildListEntries: readonly unknown[]
  /** The D2-E-A document text (the measurement HEAD git object). */
  specMarkdown: string
}

export interface D2EContextData extends D2EContextRecordProjection { k: number; recordSha256: string; label: string }
export interface D2ESupportData { supportBuildListEntryId: string; contexts: D2EContextData[] }
export interface D2EParityExpectation { evaluationId: string; inputDigest: string; resultDigest: string; status: string; termination: string; completed: number; totalTargetCount: number; conflicts: number; steps: number }
export interface D2EValidatedInputs {
  passed: boolean
  issues: string[]
  exportSha256: string | null
  e1: { labels: string[]; targetWeaponIds: string[]; currentBuildListEntryIds: string[] }
  k2: D2EK2Context | null
  k2Derivation: D2EK2Derivation | null
  i0: D2EI0Derivation | null
  contexts: D2EContextData[]
  /** The 3 support Entries of I0 with every K1 CTX record (k ascending; the first is the S5 authority). */
  supports: D2ESupportData[]
  /** §1.7 / §3.3 the registered K2 reservation body (from the attested text). */
  registeredReservationBody: Json | null
  /** D-4: the D2-B K0 pool of the K2 Target; D-5: the D2-C K1 pool of the K2 Target. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  d2cK1Pool: { ordinal: number; contextId: string; keySha256: string }[]
  /** §1.5: the D2-C t03 Conflict resource identities (diagnostic). */
  d2cT03ResourceIdentities: string[]
  /** inputDigest -> the D2-D / D2-C / D2 evaluations holding it (determinism_prior). */
  priorByInputDigest: Record<string, D2EPriorEvaluation[]>
  expected: { b0: D2EParityExpectation; i0: D2EParityExpectation & { resourceConflictRejections: number; supportsSelected: string[] } } | null
  phase2c2BaselineSummary: unknown
}

/** The Export SHA-256 the D2-D RESULT `sources.export` names (a registered input), or null. */
export function d2eChainedExportSha256(d2dResult: unknown): string | null {
  const e = projectD2ED2DResult(d2dResult)?.sources.export ?? null
  return e !== null && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256) ? e.sha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const

/** C6 / the diagnostic union: `outer` contains `inner` componentwise (Normal per counter ID; held ⊇, blocked ⊇, exclusive ⊇). */
export function d2eReservationContains(outer: unknown, inner: unknown): boolean {
  if (!isObject(outer) || !isObject(inner)) return false
  const nums = (v: unknown) => Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : null
  const covers = (o: unknown, i: unknown) => { const a = nums(o), b = nums(i); return a !== null && b !== null && b.every(x => a.includes(x)) }
  const stream = (o: unknown, i: unknown) => isObject(o) && isObject(i) && covers(o.held, i.held) && covers(o.blocked, i.blocked)
  if (!stream(outer.skill, inner.skill) || !stream(outer.gogma, inner.gogma)) return false
  const on = Array.isArray(outer.normal) ? outer.normal.filter(isObject) : null, inn = Array.isArray(inner.normal) ? inner.normal.filter(isObject) : null
  if (on === null || inn === null || !inn.every(n => { const o = on.find(x => x.counterId === n.counterId); return o !== undefined && stream(o, n) })) return false
  const oe = strings(outer.exclusiveOwnedWeaponIds), ie = strings(inner.exclusiveOwnedWeaponIds)
  return Array.isArray(outer.exclusiveOwnedWeaponIds) && Array.isArray(inner.exclusiveOwnedWeaponIds) && ie.every(x => oe.includes(x))
}

/** The diagnostic componentwise union of reservation bodies (never the K2 semantics, §3.1 / G45). */
export function d2eReservationUnion(bodies: readonly Json[]): Json {
  const nums = (v: unknown) => Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  const merge = (lists: number[][]) => [...new Set(lists.flat())].sort((a, b) => a - b)
  const stream = (key: string) => ({ held: merge(bodies.map(b => nums((b[key] as Json | undefined)?.held))), blocked: merge(bodies.map(b => nums((b[key] as Json | undefined)?.blocked))) })
  const counters = sortedIds([...new Set(bodies.flatMap(b => (Array.isArray(b.normal) ? b.normal as Json[] : []).map(n => String(n.counterId))))])
  return {
    normal: counters.map(counterId => { const ns = bodies.flatMap(b => (Array.isArray(b.normal) ? b.normal as Json[] : []).filter(n => n.counterId === counterId)); return { counterId, held: merge(ns.map(n => nums(n.held))), blocked: merge(ns.map(n => nums(n.blocked))) } }),
    skill: stream('skill'), gogma: stream('gogma'), exclusiveOwnedWeaponIds: sortedIds([...new Set(bodies.flatMap(b => strings(b.exclusiveOwnedWeaponIds)))]),
  }
}

/**
 * V (§10.1): every registered input present with its registered digest; the D2-D / D2-C / D2 RESULTs (allowlists) the registered
 * formal runs; the §3.1 derivation equal to the §3.2 table; the §6.1 I0 set equal to the §1.2 table with `inputDigest`
 * `fnv1a32:6493291d`; the 9 G store bodies and the 6 CTX records the registered files. Never repairs or substitutes: any issue fails
 * D2-E closed (`input_evidence`). Pure.
 */
export function validateD2EInputs(evidence: D2EInputEvidence): D2EValidatedInputs {
  const issues: string[] = [...d2ePolicyDrift()]
  const empty = { labels: [], targetWeaponIds: [], currentBuildListEntryIds: [] }
  const fail = (partial: Partial<D2EValidatedInputs> = {}): D2EValidatedInputs => ({ issues, exportSha256: null, e1: empty, k2: null, k2Derivation: null, i0: null, contexts: [], supports: [],
    registeredReservationBody: null, d2bK0Pool: [], d2cK1Pool: [], d2cT03ResourceIdentities: [], priorByInputDigest: {}, expected: null, phase2c2BaselineSummary: null, ...partial, passed: false })
  const spec = evidence.specMarkdown
  const exportSha = d2eChainedExportSha256(evidence.d2dResult)
  if (exportSha === null || !spec.includes(exportSha)) issues.push('the chained Export SHA-256 (D2-D RESULT sources.export) is not the one the D2-E document registers')
  for (const [key, registered] of Object.entries(D2E_REGISTERED_INPUTS) as [D2ERegisteredInputKey, D2ERegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? exportSha
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the D2-D RESULT`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
    if (registered.sha256 !== null && !d2NamesSha256(spec, registered.sha256)) issues.push(`${registered.file}: the D2-E document does not name its SHA-256`)
  }
  for (const f of D2E_INCUMBENT_G_STORE_FILES) if (!spec.includes(f.sha256) || !spec.includes(`${f.runDir}/${f.file}`)) issues.push(`${f.file}: the D2-E document does not name its path / SHA-256`)
  for (const c of D2E_CONTEXT_RECORDS) if (!spec.includes(c.sha256)) issues.push(`${c.file}: the D2-E document does not name its SHA-256`)
  for (const digest of [D2E_K0_RESERVATION_DIGEST, D2E_K2_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest, D2E_B0_EXPECTED.inputDigest, D2E_B0_EXPECTED.resultDigest]) {
    if (!spec.includes(digest)) issues.push(`${digest}: the D2-E document does not name it`)
  }
  for (const head of [D2E_D2D_PROVENANCE.measuredHead, D2E_D2C_PROVENANCE.measuredHead, D2E_D2_PROVENANCE.measuredHead]) if (!spec.includes(head)) issues.push(`${head}: the D2-E document does not name the measured HEAD`)

  const d2d = projectD2ED2DResult(evidence.d2dResult)
  const d2c = projectD2ED2CResult(evidence.d2cResult)
  if (d2d === null) { issues.push('the D2-D RESULT lacks an allowlisted section'); return fail() }
  if (d2c === null) { issues.push('the D2-C RESULT lacks an allowlisted section'); return fail() }

  // ---- the D2-D RESULT (§10.1 conditions)
  const p = d2d.provenance
  if (p.formal !== true) issues.push('D2-D RESULT provenance.formal is not true')
  if (p.measuredHead !== D2E_D2D_PROVENANCE.measuredHead || p.analysisHead !== D2E_D2D_PROVENANCE.measuredHead) issues.push('D2-D RESULT measuredHead / analysisHead is not the registered one')
  if (p.runStatus !== 'completed') issues.push('D2-D RESULT runStatus is not completed')
  if (!Array.isArray(p.calculationCodeChangedSinceMeasuredHead) || p.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-D RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(p.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-D RESULT productionChangedFiles is not []')
  if (p.startAttestationSha256 !== D2E_REGISTERED_INPUTS.d2dAttestation.sha256 || p.startAttestationVerified !== true) issues.push('D2-D RESULT start attestation is not the registered verified one')
  if (p.oracleReadByRunner !== false || p.oracleReadByChild !== false || p.oracleReadByAnalyzer !== false) issues.push('D2-D RESULT oracleReadBy* is not false')
  if (!Array.isArray(d2d.invalidReasons) || d2d.invalidReasons.length !== 0) issues.push('D2-D RESULT invalidReasons is not []')
  if (d2d.decision.case !== D2E_D2D_PROVENANCE.decisionCase) issues.push('D2-D RESULT decision.case is not D2D_EXCEEDS_D2C_FINAL')
  if (!same(d2d.aggregates.unmeasuredByReason, {}) || !same(d2d.aggregates.notExecutedByReason, {})) issues.push('D2-D RESULT has an unmeasured / not executed evaluation')
  if (d2d.rv.status !== 'verified' || d2d.rv.satisfied !== true) issues.push('D2-D RESULT rv is not verified')
  const s = d2d.sources
  const sameRef = (a: D2EFileRef | null, file: string, reg: { bytes: number | null; sha256: string | null }) => reg.sha256 !== null && a !== null && a.file === file && a.sha256 === reg.sha256 && (reg.bytes === null || a.bytes === null || a.bytes === reg.bytes)
  if (!sameRef(s.specDocument, D2E_REGISTERED_INPUTS.d2dSpecDocument.file, { bytes: null, sha256: D2E_REGISTERED_INPUTS.d2dSpecDocument.sha256 })) issues.push('D2-D RESULT sources.specDocument is not the registered D2-D-A document')
  if (!sameRef(s.export, D2E_REGISTERED_INPUTS.export.file, { bytes: D2E_REGISTERED_INPUTS.export.bytes, sha256: exportSha })) issues.push('D2-D RESULT sources.export is not the registered Export')
  if (!sameRef(s.phase2c2Result, D2E_REGISTERED_INPUTS.phase2c2Result.file, { bytes: null, sha256: D2E_REGISTERED_INPUTS.phase2c2Result.sha256 })) issues.push('D2-D RESULT sources.phase2c2Result is not the registered one')
  if (!sameRef(s.d2d.raw, 'PLANNER_GLOBAL_D2D_PAIR_RAW.json.local', D2E_REGISTERED_INPUTS.d2dRaw) || s.d2d.runDir !== 'd2d-pair-formal.run'
    || !sameRef(s.d2d.attestation, 'start-attestation.json', D2E_REGISTERED_INPUTS.d2dAttestation)) issues.push('D2-D RESULT sources.d2d is not the registered raw / run dir / attestation')
  const d2cSrc = s.d2c as Json
  if (!sameRef(fileRef(d2cSrc.result), D2E_REGISTERED_INPUTS.d2cResult.file, D2E_REGISTERED_INPUTS.d2cResult) || !sameRef(fileRef(d2cSrc.attestation), D2E_REGISTERED_INPUTS.d2cAttestation.file, D2E_REGISTERED_INPUTS.d2cAttestation)
    || !sameRef(fileRef(d2cSrc.raw), D2E_REGISTERED_INPUTS.d2cRaw.file, D2E_REGISTERED_INPUTS.d2cRaw)) issues.push('D2-D RESULT sources.d2c is not the registered D2-C RESULT / attestation / raw')
  if (!sameRef(fileRef((s.d2 as Json).result), D2E_REGISTERED_INPUTS.d2Result.file, D2E_REGISTERED_INPUTS.d2Result)) issues.push('D2-D RESULT sources.d2.result is not the registered D2 RESULT')
  const usedGStore = [...fileRefs(d2cSrc.generatedEntriesUsed), ...fileRefs((s.d2 as Json).generatedEntriesUsed)]
  for (const f of D2E_INCUMBENT_G_STORE_FILES) if (!usedGStore.some(r => r.file === `${f.runDir}/${f.file}` && r.sha256 === f.sha256 && r.bytes === f.bytes)) issues.push(`${f.file}: not named by D2-D RESULT sources.{d2c,d2}.generatedEntriesUsed`)
  const usedCtx = fileRefs(d2cSrc.contextRecordsUsed)
  for (const c of D2E_CONTEXT_RECORDS.filter(x => [1, 5, 6, 7].includes(x.k))) if (!usedCtx.some(r => r.file === `${D2E_D2C_PROVENANCE.runDir}/${c.file}` && r.sha256 === c.sha256 && r.bytes === c.bytes)) issues.push(`${c.file}: not named by D2-D RESULT sources.d2c.contextRecordsUsed`)
  for (const key of D2E_CHAINED_DOCUMENT_KEYS) {
    const ref = s.documents[key] ?? null
    const observed = evidence.documents[key] ?? null
    if (ref === null || ref.sha256 === null) { issues.push(`D2-D RESULT sources.documents.${key} is missing`); continue }
    if (observed === null) { issues.push(`${ref.file}: the document is missing`); continue }
    if (observed.sha256 !== ref.sha256 || (ref.bytes !== null && observed.bytes !== ref.bytes)) issues.push(`${ref.file}: not the document D2-D RESULT sources.documents names`)
  }
  const ranking = Array.isArray(d2d.pairsRanking) ? d2d.pairsRanking.filter(isObject) : []
  if (ranking.find(r => r.rank === 1)?.evaluationId !== D2E_D2D_PROVENANCE.bestPair) issues.push('D2-D RESULT pairs.ranking does not rank the registered PAIR first')

  // ---- the D2-C RESULT
  const cp = d2c.provenance
  if (cp.formal !== true) issues.push('D2-C RESULT provenance.formal is not true')
  if (cp.measuredHead !== D2E_D2C_PROVENANCE.measuredHead || cp.analysisHead !== D2E_D2C_PROVENANCE.measuredHead) issues.push('D2-C RESULT measuredHead / analysisHead is not the registered one')
  if (cp.runStatus !== 'completed') issues.push('D2-C RESULT runStatus is not completed')
  if (!Array.isArray(cp.calculationCodeChangedSinceMeasuredHead) || cp.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-C RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(cp.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-C RESULT productionChangedFiles is not []')
  if (cp.startAttestationSha256 !== D2E_REGISTERED_INPUTS.d2cAttestation.sha256 || cp.startAttestationVerified !== true) issues.push('D2-C RESULT start attestation is not the registered verified one')
  if (!Array.isArray(d2c.invalidReasons) || d2c.invalidReasons.length !== 0) issues.push('D2-C RESULT invalidReasons is not []')
  if (d2c.decisionCase !== D2E_D2C_PROVENANCE.decisionCase) issues.push('D2-C RESULT decision.case is not D2C_EXCEEDS_D2B_MAIN')
  if (!same(d2c.aggregates.unmeasuredByReason, {}) || !same(d2c.aggregates.notExecutedByReason, {})) issues.push('D2-C RESULT has an unmeasured / not executed evaluation')
  const cs = d2c.sources
  if (!sameRef(fileRef(cs.export), D2E_REGISTERED_INPUTS.export.file, { bytes: D2E_REGISTERED_INPUTS.export.bytes, sha256: exportSha })) issues.push('D2-C RESULT sources.export is not the registered Export')
  const csd2c = isObject(cs.d2c) ? cs.d2c : {}
  if (!sameRef(fileRef(csd2c.raw), 'PLANNER_GLOBAL_D2C_K1_RAW.json.local', D2E_REGISTERED_INPUTS.d2cRaw) || !sameRef(fileRef(csd2c.attestation), 'start-attestation.json', D2E_REGISTERED_INPUTS.d2cAttestation)) issues.push('D2-C RESULT sources.d2c is not the registered raw / attestation')

  // ---- the K2 derivation (§3.1) and the §3.2 table
  const k2Derivation = deriveD2EK2Contexts(d2c)
  issues.push(...k2Derivation.issues)
  const table = parseD2ESpecK2Context(spec)
  const k2 = k2Derivation.contexts.length === 1 ? k2Derivation.contexts[0]! : null
  if (table === null) issues.push('the D2-E §3.2 table is missing')
  if (k2Derivation.contexts.length !== 1) issues.push(`the §3.1 derivation yields ${k2Derivation.contexts.length} K2 contexts, not the §3.2 one`)
  if (k2 !== null && table !== null && (k2.contextId !== table.contextId || k2.label !== table.label || k2.targetWeaponId !== table.targetWeaponId || k2.currentBuildListEntryId !== table.currentBuildListEntryId
    || !same(k2.supportBuildListEntryIds, table.supportBuildListEntryIds) || !same(k2.supportTargetWeaponIds, table.supportTargetWeaponIds) || k2.admObserved !== table.admObserved || k2.cmpObserved !== table.cmpObserved)) {
    issues.push('the §3.1 derivation is not the §3.2 table (Target, O_t, supports, order or ADM / CMP counts)')
  }
  const registeredReservationBody = parseD2ESpecRegisteredReservation(spec)
  if (registeredReservationBody === null) issues.push('the D2-E §1.7 registered reservation body is missing or not a JSON object')
  else if (hashStableValue(registeredReservationBody) !== D2E_K2_RESERVATION_DIGEST) issues.push('the D2-E §1.7 registered body does not hash to the registered K2 digest')

  // ---- the D2 RESULT (E1 Targets, D-4 pool)
  const d2 = projectD2ED2Result(evidence.d2Result, k2 === null ? [] : [k2.label])
  if (d2 === null) { issues.push('the D2 RESULT lacks an allowlisted section'); return fail({ k2Derivation }) }
  if (d2.provenance.formal !== true || d2.provenance.measuredHead !== D2E_D2_PROVENANCE.measuredHead) issues.push('D2 RESULT provenance is not the registered formal run')
  if (!Array.isArray(d2.invalidReasons) || d2.invalidReasons.length !== 0) issues.push('D2 RESULT invalidReasons is not []')
  if (d2.decisionCase !== D2E_D2_PROVENANCE.decisionCase) issues.push('D2 RESULT decision.case is not D2A_EXCEEDS_D1_INCUMBENT')
  if (!sameRef(d2.sourcesExport, D2E_REGISTERED_INPUTS.export.file, { bytes: D2E_REGISTERED_INPUTS.export.bytes, sha256: exportSha })) issues.push('D2 RESULT sources.export is not the registered Export')
  if (d2.targets.length !== D2E_D2_PROVENANCE.e1Targets) issues.push(`D2 RESULT discovery.targets holds ${d2.targets.length} Targets, not 11`)
  const e1 = { labels: d2.targets.map(t => t.label), targetWeaponIds: d2.targets.map(t => t.targetWeaponId), currentBuildListEntryIds: d2.targets.map(t => t.currentBuildListEntryId) }
  if (k2 !== null) {
    const e1t = d2.targets.find(t => t.label === k2.label)
    if (!e1t || e1t.targetWeaponId !== k2.targetWeaponId || e1t.currentBuildListEntryId !== k2.currentBuildListEntryId) issues.push('the K2 Target is not the D2 RESULT E1 Target of its label')
    const pt = d2c.poolTargets.find(t => t.label === k2.label)
    if (!pt || pt.targetWeaponId !== k2.targetWeaponId || pt.currentBuildListEntryId !== k2.currentBuildListEntryId || !same(sortedIds(pt.contextIds), sortedIds(k2.k1Contexts.map(c => c.contextId)))) issues.push('the D2-C RESULT discovery target is not the K2 Target')
    // C1 (V side): the supports are Export Entries outside E1, not generated, not an E1 O_t.
    for (const sId of k2.supportBuildListEntryIds) {
      const bodies = evidence.exportBuildListEntries.filter(e => isObject(e) && e.id === sId)
      const t = bodies.length === 1 && isObject(bodies[0]) ? (bodies[0] as Json).targetWeaponId : null
      if (bodies.length !== 1 || typeof t !== 'string' || e1.targetWeaponIds.includes(t) || sId.startsWith(D2E_GENERATED_ENTRY_PREFIX) || e1.currentBuildListEntryIds.includes(sId)) issues.push(`${sId}: not one Export Entry outside E1 (C1)`)
    }
  }
  const d2bK0Pool = k2 === null ? [] : [...(d2.pools[k2.label] ?? [])].sort((a, b) => a.ordinal - b.ordinal)
  const d2cK1Pool = k2 === null ? [] : [...(d2c.poolTargets.find(t => t.label === k2.label)?.pool ?? [])].sort((a, b) => a.ordinal - b.ordinal).map(x => ({ ordinal: x.ordinal, contextId: x.contextId, keySha256: x.keySha256 }))
  if (k2 !== null && (d2bK0Pool.length !== 3 || d2cK1Pool.length !== 4)) issues.push(`the D-4 / D-5 pools hold ${d2bK0Pool.length} / ${d2cK1Pool.length} keys, not 3 / 4`)
  for (const x of [...d2bK0Pool, ...d2cK1Pool]) if (!spec.includes(x.keySha256)) issues.push(`${x.keySha256}: the D2-E document does not name the D-4 / D-5 key`)
  const d2cT03ResourceIdentities = k2 === null ? [] : sortedIds([...new Set(d2c.observations.filter(e => e.targetLabel === k2.label).flatMap(e => e.conflicts.map(c => c.resourceIdentity)).filter((x): x is string => x !== null))])
  if (k2 !== null && !same(d2cT03ResourceIdentities, parseD2ESpecT03ResourceIdentities(spec))) issues.push('the D2-C t03 Conflict resource identities are not the §1.5 registered ones')

  // ---- the I0 set (§6.1) and the §1.2 table
  if (exportSha === null) { issues.push('no chained Export SHA-256'); return fail({ k2Derivation, k2 }) }
  const i0 = deriveD2EI0(d2d, d2c.contexts, exportSha)
  issues.push(...i0.issues)
  const incumbentTable = parseD2ESpecIncumbentTable(spec)
  if (incumbentTable.length !== 9) issues.push(`the D2-E §1.2 table holds ${incumbentTable.length} rows, not 9`)
  i0.replacements.forEach((r, i) => {
    const row = incumbentTable[i]
    if (!row || row.label !== r.label || row.targetWeaponId !== r.targetWeaponId || row.currentBuildListEntryId !== r.currentBuildListEntryId || row.origin !== r.origin || row.ordinal !== r.ordinal
      || row.contextId !== r.contextId || row.file !== `${r.runDir}/${r.file}` || row.bytes !== r.bytes || row.sha256 !== r.sha256 || row.generatedBuildListEntryId !== r.generatedBuildListEntryId
      || row.searchIdentity !== r.searchIdentity || row.keySha256 !== r.keySha256 || !same(row.requiresSupportSuffixes, r.requiresSupport.map(suffix8))) issues.push(`${r.label}: the §6.1 derivation is not the §1.2 table row ${i + 1}`)
  })

  // ---- the G store bodies (V reads id / targetWeaponId; RV checks the rest)
  for (const f of D2E_INCUMBENT_G_STORE_FILES) {
    const observed = evidence.gStoreFiles[d2eGStoreKey(f.label, f.ordinal)] ?? null
    if (observed === null) { issues.push(`${f.file}: the G store file is missing`); continue }
    if (observed.file.sha256 !== f.sha256 || observed.file.bytes !== f.bytes) issues.push(`${f.file}: the G store file is not the registered one`)
    const r = i0.replacements.find(x => x.label === f.label && x.ordinal === f.ordinal && x.origin === f.origin)
    const body = isObject(observed.json) ? observed.json : null
    if (!r) { issues.push(`${f.file}: no derived Candidate uses this G store file`); continue }
    if (body === null || body.id !== r.generatedBuildListEntryId || body.targetWeaponId !== r.targetWeaponId) issues.push(`${f.file}: the body is not the derived G (id / Target)`)
  }

  // ---- the CTX records (§1.4 / §1.6)
  const contexts: D2EContextData[] = []
  for (const registered of D2E_CONTEXT_RECORDS) {
    const observed = evidence.contextRecords[registered.k] ?? null
    if (observed === null) { issues.push(`${registered.file}: the CTX record is missing`); continue }
    if (observed.file.sha256 !== registered.sha256 || observed.file.bytes !== registered.bytes) issues.push(`${registered.file}: the CTX record is not the registered one`)
    const read = readD2EContextRecord(observed.json)
    if (read.record === null) { issues.push(`${registered.file}: ${read.issue}`); continue }
    const row = d2c.contexts.find(c => c.k === registered.k)
    if (!row || row.contextId !== read.record.contextId || row.supportBuildListEntryId !== read.record.supportBuildListEntryId || row.supportBodySha256 !== read.record.supportBodySha256
      || row.reservationDigest !== read.record.reservationDigest || row.originDigest !== read.record.originDigest || !same(row.excludedRouteKeySha256s, read.record.excludedRouteKeySha256s)
      || row.status !== 'context_ready' || row.record?.file !== registered.file || row.record.sha256 !== registered.sha256 || row.record.bytes !== registered.bytes) {
      issues.push(`${registered.file}: the CTX record is not the D2-C RESULT contexts[k = ${registered.k}] row`)
    }
    if (hashStableValue(read.record.reservationBody) !== read.record.reservationDigest) issues.push(`${registered.file}: reservationBody does not hash to reservationDigest`)
    contexts.push({ ...read.record, k: registered.k, recordSha256: observed.file.sha256, label: row?.label ?? '' })
  }
  // The K2 supports' K1 contexts are CTX-3 / CTX-4 (the derived t03 contexts), their origin / excluded keys the registered ones.
  if (k2 !== null) {
    for (const k1 of k2.k1Contexts) {
      const ctx = contexts.find(c => c.k === k1.k)
      if (!ctx || ctx.contextId !== k1.contextId || ctx.supportBuildListEntryId !== k1.supportBuildListEntryId) issues.push(`CTX-${k1.k}: not the derived K1 context ${k1.contextId}`)
      else if (ctx.originDigest !== D2E_ORIGIN_DIGEST || ctx.excludedRouteKeySha256s.length !== 1 || table === null || ctx.excludedRouteKeySha256s[0] !== table.currentKeySha256) issues.push(`CTX-${k1.k}: originDigest / excludedRouteKeySha256s is not the registered one`)
    }
    if (table !== null) k2.supportBuildListEntryIds.forEach((sId, i) => {
      const ctx = contexts.filter(c => c.supportBuildListEntryId === sId)
      if (ctx.length === 0 || ctx.some(c => c.supportBodySha256 !== table.supportBodySha256s[i])) issues.push(`${sId}: the CTX supportBodySha256 is not the §3.2 registered one`)
    })
  }
  // Every K1 incumbent names its own CTX record; the D2-C RESULT context row matches it.
  for (const r of i0.replacements.filter(x => x.origin === 'd2c_k1')) {
    const ctx = contexts.find(c => c.k === r.contextK)
    if (!ctx || ctx.contextId !== r.contextId || !same(r.requiresSupport, [ctx.supportBuildListEntryId])) issues.push(`${r.label} c${r.ordinal}: not a Candidate of a registered CTX record`)
  }
  const supportIds = sortedIds([...new Set([...i0.requiresSupport, ...(k2?.supportBuildListEntryIds ?? [])])])
  const supports: D2ESupportData[] = supportIds.map(id => ({ supportBuildListEntryId: id, contexts: contexts.filter(c => c.supportBuildListEntryId === id).sort((a, b) => a.k - b.k) }))
  if (supports.length !== 3 || !same(supportIds, i0.requiresSupport)) issues.push(`${supports.length} support Entries, not the 3 of I0 (the K2 supports are among them, §1.2)`)
  for (const sd of supports) {
    if (sd.contexts.length === 0) issues.push(`${sd.supportBuildListEntryId}: no CTX record`)
    const first = sd.contexts[0]
    for (const c of sd.contexts.slice(1)) if (first && (c.reservationDigest !== first.reservationDigest || c.supportBodySha256 !== first.supportBodySha256 || stableStringify(c.reservationBody) !== stableStringify(first.reservationBody))) {
      issues.push(`${sd.supportBuildListEntryId}: CTX-${first.k} and CTX-${c.k} differ`)
    }
  }
  if (!same(supports.map(sd => sd.contexts.map(c => c.k)), [[6], [3, 5], [1, 4, 7]])) issues.push('the support CTX records (Entry ID order) are not CTX [6] / [3, 5] / [1, 4, 7] (§1.6 / §7.1)')

  // ---- the parity expectations (D2-D RESULT B0 / best PAIR)
  const ev = new Map(d2d.evaluations.map(e => [e.evaluationId, e]))
  const b0 = ev.get('B0'), best = ev.get(D2E_D2D_PROVENANCE.bestPair)
  const B = D2E_B0_EXPECTED, I = D2E_I0_EXPECTED
  if (!b0 || b0.status !== B.status || b0.inputDigest !== B.inputDigest || b0.resultDigest !== B.resultDigest || b0.termination?.status !== B.termination || b0.termination.completedTargetCount !== B.completed
    || b0.termination.totalTargetCount !== B.totalTargetCount || b0.conflictCount !== B.conflicts || b0.steps !== B.steps) issues.push('D2-D RESULT B0 is not the registered baseline')
  if (!best || best.status !== I.status || best.inputDigest !== I.inputDigest || best.resultDigest !== I.resultDigest || best.termination?.status !== I.termination || best.termination.completedTargetCount !== I.completed
    || best.termination.totalTargetCount !== I.totalTargetCount || best.termination.reachedLimits.length !== 0 || best.conflictCount !== I.conflicts || best.steps !== I.steps || best.r5?.satisfied !== true
    || best.resourceConflictRejections !== I.resourceConflictRejections) issues.push('D2-D RESULT best PAIR is not the registered §1.1 value')
  const supportsSelected = supportIds.filter(id => best?.supportChecksByEntry[id]?.selected === true && best.supportChecksByEntry[id]?.supportExpiryCause === null)
  if (supportsSelected.length !== supportIds.length || (k2 !== null && !k2.supportBuildListEntryIds.every(x => best?.selectedBuildListEntryIds.includes(x)))) issues.push('the D2-D best PAIR does not select every support')
  if (best && (!same(best.generatedEntryIds, i0.generatedBuildListEntryIds) || !same(best.generatedEntrySha256s, i0.generatedEntrySha256s))) issues.push('the D2-D best PAIR evaluation is not the derived I0 set')
  if (best && k2 !== null && best.selectedBuildListEntryIds.includes(k2.currentBuildListEntryId)) issues.push('O_t03 is selected in the D2-D best PAIR (§1.8)')
  const priorByInputDigest: Record<string, D2EPriorEvaluation[]> = {}
  for (const e of [...d2d.prior, ...d2c.prior, ...d2.prior]) if (e.inputDigest !== null) (priorByInputDigest[e.inputDigest] ??= []).push(e)
  if ((priorByInputDigest[B.inputDigest] ?? []).length !== 3 || !(priorByInputDigest[I.inputDigest] ?? []).some(x => x.source === 'D2-D' && x.evaluationId === I.evaluationId)) issues.push('the prior B0 / I0 evaluations are not the registered ones')

  // ---- the Phase 2-C2 baseline summary
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  const partial = { exportSha256: exportSha, e1, k2, k2Derivation, i0, contexts, supports, registeredReservationBody, d2bK0Pool, d2cK1Pool, d2cT03ResourceIdentities, priorByInputDigest }
  if (issues.length > 0) return fail(partial)
  const expect = (e: D2ED2DEvaluation, id: string): D2EParityExpectation => ({ evaluationId: id, inputDigest: e.inputDigest!, resultDigest: e.resultDigest!, status: e.status, termination: e.termination!.status,
    completed: e.termination!.completedTargetCount, totalTargetCount: e.termination!.totalTargetCount, conflicts: e.conflictCount!, steps: e.steps! })
  return { passed: true, issues, ...partial,
    expected: { b0: expect(b0!, 'B0'), i0: { ...expect(best!, I.evaluationId), resourceConflictRejections: best!.resourceConflictRejections!, supportsSelected } },
    phase2c2BaselineSummary: structuredClone(phase2c2) }
}

// ---------------------------------------------------------------- RV (§7.1): the unchanged D2-D RV over the 9 incumbents and 3 supports

/** §7.1: the RV task (`runD2DReverification()` of D2-D, whose RV1 .. RV6 are D2-E's RV1 .. RV6) from a passed V. */
export function d2eReverificationTask(v: D2EValidatedInputs, d2cContexts: readonly D2ED2CContextRow[]): D2DReverificationTask {
  if (!v.passed || v.i0 === null) throw new Error('RV needs a passed V')
  return {
    unitId: D2E_RV_UNIT_ID,
    candidates: [...v.i0.replacements].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId) || a.ordinal - b.ordinal).map(r => {
      const ctx = r.origin === 'd2c_k1' ? v.contexts.find(c => c.k === r.contextK) ?? null : null
      const row = r.origin === 'd2c_k1' ? d2cContexts.find(c => c.contextId === r.contextId) ?? null : null
      return { label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, generatedBuildListEntryId: r.generatedBuildListEntryId, targetWeaponId: r.targetWeaponId,
        currentBuildListEntryId: r.currentBuildListEntryId, generatedEntryFile: r.file, generatedEntrySha256: r.sha256, searchIdentity: r.searchIdentity, keySha256: r.keySha256,
        k1: ctx === null ? null : { k: ctx.k, recordSha256: ctx.recordSha256, reservationBody: structuredClone(ctx.reservationBody), reservationDigest: ctx.reservationDigest,
          poolReservationDigest: row?.reservationDigest ?? null, poolContextRecordSha256: row?.record?.sha256 ?? null } }
    }),
    supports: v.supports.map(sd => ({ supportBuildListEntryId: sd.supportBuildListEntryId, contexts: sd.contexts.map(c => ({ k: c.k, supportBodySha256: c.supportBodySha256, reservationDigest: c.reservationDigest,
      reservationBody: structuredClone(c.reservationBody) })) })),
    k0ReservationDigest: D2E_K0_RESERVATION_DIGEST,
    researchMaxPlanSteps: D2E_RESEARCH_MAX_PLAN_STEPS,
  }
}

// ---------------------------------------------------------------- CTX-K2 (§4.1)

export interface D2EK1ContextReference { supportBuildListEntryId: string; k: number; recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeySha256s: string[] }
export interface D2EContextTask {
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  /** S (Entry ID ascending, 2). */
  supportBuildListEntryIds: string[]
  /** The E1 Targets and their `O_t` (C1, from D2 RESULT discovery.targets). */
  e1TargetWeaponIds: string[]
  e1CurrentBuildListEntryIds: string[]
  registeredReservationDigest: string
  /** The §1.7 / §3.3 registered body (a JSON object). */
  registeredReservationBody: Json
  /** The K1 CTX record of each support (CTX-3 / CTX-4: C4 / C6). */
  k1Contexts: D2EK1ContextReference[]
  researchMaxPlanSteps: number
}
export interface D2EContextChecks {
  C1: { satisfied: boolean; issues: string[] }
  C2: { satisfied: boolean; issues: string[] }
  C3: { satisfied: boolean; referencedOwnedWeaponIds: string[]; exclusiveConsumedOwnedWeaponIds: string[]; exclusiveOwnedWeaponIds: string[] }
  C4: { satisfied: boolean; issues: string[] }
  C5: { state: 'matched' | 'mismatched'; expectedDigest: string; observedDigest: string | null; digestMatched: boolean; bodyMatched: boolean }
  C6: { satisfied: boolean; perSupport: { supportBuildListEntryId: string; k: number; contained: boolean }[] }
  C7: { satisfied: boolean; reverseDigest: string | null }
}
export interface D2EContextRecord {
  status: 'context_ready' | 'guardrail_violation'
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: (string | null)[]
  supportBodySha256s: Record<string, string>
  /** The derived `PlannerAlternativeReservation` as a JSON object (`structuredClone`, never a string; §4.1). */
  reservationBody: Json | null
  reservationDigest: string | null
  originDigest: string | null
  scheduleOriginDigest: string
  excludedRouteKeys: string[]
  excludedRouteKeySha256s: string[]
  scheduleExcludedRouteKeys: string[]
  conflictContextCount: number | null
  checks: D2EContextChecks
  diagnostics: { equalsK1ComponentwiseUnion: boolean | null; k1Reservations: Record<string, { k: number; recordSha256: string; reservationDigest: string }> }
  issues: string[]
}

/**
 * CTX-K2 (§4.1): the K2 context record from Production parts only - the B2-C1 schedule (origin digest, current Route key, policy
 * drift), `phase2c27bResolveSupportContext(baseline, t03, S)` over the two Export support bodies, the support Routes and their unit
 * plans for C3 - with C1 .. C7. No Search and no full run. C1 .. C4 / C6 / C7 failing is a guardrail violation; C5 is the
 * `k2_context_registered` parity (a mismatch is INVALID).
 */
export function prepareD2EContextRecord(input: PlannerInput, schedule: Phase2C26B2C1Schedule, exportBuildListEntries: readonly unknown[], task: D2EContextTask, dependencies: PlannerDependencies,
  sha256OfText: (text: string) => string): D2EContextRecord {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule), ...d2ePolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (task.unitId !== D2E_CONTEXT_UNIT_ID || task.contextId !== d2eContextId(task.label, task.supportBuildListEntryIds)) issues.push('unitId / contextId')
  if (!isObject(task.registeredReservationBody)) issues.push('the registered reservation body is not a JSON object')
  const S = [...task.supportBuildListEntryIds]
  // C1
  const c1: string[] = []
  if (S.length !== 2 || new Set(S).size !== 2 || !same(S, sortedIds(S))) c1.push('S is not 2 distinct Entry IDs in ascending order')
  if (task.e1TargetWeaponIds.length !== D2E_D2_PROVENANCE.e1Targets || task.e1CurrentBuildListEntryIds.length !== D2E_D2_PROVENANCE.e1Targets || !task.e1TargetWeaponIds.includes(task.targetWeaponId)) c1.push('the E1 lists are not the 11 D2 RESULT Targets')
  const bodies: (Json | null)[] = S.map(sId => {
    const found = exportBuildListEntries.filter(e => isObject(e) && e.id === sId) as Json[]
    if (found.length !== 1) { c1.push(`${found.length} Export Entries hold ${sId}`); return null }
    const target = typeof found[0]!.targetWeaponId === 'string' ? found[0]!.targetWeaponId : null
    if (target === null || task.e1TargetWeaponIds.includes(target)) c1.push(`the Target of ${sId} is not outside E1`)
    if (sId.startsWith(D2E_GENERATED_ENTRY_PREFIX)) c1.push(`${sId} is a generated Entry`)
    if (task.e1CurrentBuildListEntryIds.includes(sId)) c1.push(`${sId} is an E1 O_t`)
    return found[0]!
  })
  // C2
  const c2: string[] = []
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, S)
  if (resolved.status !== 'ready') c2.push(...resolved.issues)
  else {
    if (resolved.prepared.invalidated.id !== task.currentBuildListEntryId) c2.push('the current Entry is not the registered O_t')
    if (!same(resolved.prepared.supportBuildListEntryIds, S)) c2.push('the support set is not S')
  }
  const prepared = resolved.status === 'ready' ? resolved.prepared : null
  const reservation = prepared?.reservation ?? null
  // C3
  const referenced = sortedIds([...new Set(bodies.flatMap(b => b !== null && isObject(b.candidateSnapshot) && isObject(b.candidateSnapshot.route)
    ? collectReferencedOwnedWeaponIds((b as unknown as BuildListEntry).candidateSnapshot.route).map(String) : []))])
  const plans = bodies.every(b => b !== null) ? createPlannerRouteUnitPlans(bodies as unknown as BuildListEntry[], dependencies.rngEngine) : null
  const consumed = plans === null ? [] : sortedIds([...new Set(S.flatMap(sId => [...(plans.unitPlans.get(sId as BuildListEntryId) ?? [])].map(u => u.exclusiveConsumedOwnedWeaponId)
    .filter((x): x is NonNullable<typeof x> => x !== null).map(String)))])
  const exclusive = reservation === null ? [] : sortedIds(reservation.exclusiveOwnedWeaponIds.map(String))
  const c3 = reservation !== null && plans !== null && plans.rejections.length === 0 && [...referenced, ...consumed].every(id => exclusive.includes(id))
  // C4
  const c4: string[] = []
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const originDigest = prepared === null ? null : hashStableValue(prepared.origin)
  if (originDigest !== schedule.snapshot.originDigest) c4.push('the Planner-start origin does not hash to the schedule snapshot origin digest')
  if (task.k1Contexts.length !== 2 || !same(task.k1Contexts.map(c => c.supportBuildListEntryId).sort(compare), S)) c4.push('the K1 CTX records are not one per support')
  for (const k1 of task.k1Contexts) if (k1.originDigest !== originDigest) c4.push(`the origin digest is not the CTX-${k1.k} originDigest`)
  const keySha = prepared === null ? [] : prepared.excludedRouteKeys.map(sha256OfText)
  if (!snapshotTarget) c4.push('the Target is not a schedule snapshot Target')
  else if (prepared !== null) {
    if (snapshotTarget.currentBuildListEntryId !== task.currentBuildListEntryId) c4.push('the schedule current Entry is not O_t')
    if (prepared.excludedRouteKeys.length !== 1 || prepared.excludedRouteKeys[0] !== candidateStableKey(prepared.invalidated.candidateSnapshot)
      || prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) c4.push('excludedRouteKeys is not [candidateStableKey(O_t)] (the schedule ones)')
    for (const k1 of task.k1Contexts) if (!same(k1.excludedRouteKeySha256s, keySha)) c4.push(`the excluded Route key SHA-256 is not the CTX-${k1.k} excludedRouteKeySha256s`)
  }
  const reservationBody = reservation === null ? null : structuredClone(reservation) as unknown as Json
  const reservationDigest = reservation === null ? null : hashStableValue(reservation)
  // C5 (parity)
  const digestMatched = reservationDigest === task.registeredReservationDigest
  const bodyMatched = reservationBody !== null && isObject(task.registeredReservationBody) && stableStringify(reservationBody) === stableStringify(task.registeredReservationBody)
  const C5 = { state: (digestMatched && bodyMatched ? 'matched' : 'mismatched') as 'matched' | 'mismatched', expectedDigest: task.registeredReservationDigest, observedDigest: reservationDigest, digestMatched, bodyMatched }
  // C6
  const perSupport = task.k1Contexts.map(k1 => ({ supportBuildListEntryId: k1.supportBuildListEntryId, k: k1.k, contained: reservationBody !== null && isObject(k1.reservationBody) && d2eReservationContains(reservationBody, k1.reservationBody) }))
  const C6 = { satisfied: perSupport.length === 2 && perSupport.every(x => x.contained), perSupport }
  // C7
  const reverse = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, [...S].reverse())
  const reverseDigest = reverse.status === 'ready' ? hashStableValue(reverse.prepared.reservation) : null
  const C7 = { satisfied: reverse.status === 'ready' && reservation !== null && reverseDigest === reservationDigest && stableStringify(reverse.prepared.reservation) === stableStringify(reservation), reverseDigest }
  const checks: D2EContextChecks = { C1: { satisfied: c1.length === 0, issues: c1 }, C2: { satisfied: c2.length === 0, issues: c2 },
    C3: { satisfied: c3, referencedOwnedWeaponIds: referenced, exclusiveConsumedOwnedWeaponIds: consumed, exclusiveOwnedWeaponIds: exclusive }, C4: { satisfied: c4.length === 0, issues: c4 }, C5, C6, C7 }
  const union = task.k1Contexts.every(k1 => isObject(k1.reservationBody)) ? d2eReservationUnion(task.k1Contexts.map(k1 => k1.reservationBody)) : null
  const ready = issues.length === 0 && checks.C1.satisfied && checks.C2.satisfied && checks.C3.satisfied && checks.C4.satisfied && checks.C6.satisfied && checks.C7.satisfied
  return { status: ready ? 'context_ready' : 'guardrail_violation', unitId: task.unitId, contextId: task.contextId, label: task.label, targetWeaponId: task.targetWeaponId,
    currentBuildListEntryId: task.currentBuildListEntryId, supportBuildListEntryIds: S, supportTargetWeaponIds: bodies.map(b => b !== null && typeof b.targetWeaponId === 'string' ? b.targetWeaponId : null),
    supportBodySha256s: Object.fromEntries(S.map((sId, i) => [sId, bodies[i] === null ? '' : sha256OfText(stableStringify(bodies[i]))])),
    reservationBody, reservationDigest, originDigest, scheduleOriginDigest: schedule.snapshot.originDigest, excludedRouteKeys: prepared === null ? [] : [...prepared.excludedRouteKeys], excludedRouteKeySha256s: keySha,
    scheduleExcludedRouteKeys: snapshotTarget ? [...snapshotTarget.excludedRouteKeys] : [], conflictContextCount: prepared === null ? null : prepared.conflictContexts.length, checks,
    diagnostics: { equalsK1ComponentwiseUnion: union === null || reservationBody === null ? null : stableStringify(union) === stableStringify(reservationBody),
      k1Reservations: Object.fromEntries(task.k1Contexts.map(k1 => [k1.supportBuildListEntryId, { k: k1.k, recordSha256: k1.recordSha256, reservationDigest: k1.reservationDigest }])) },
    issues }
}

/** §4.1: a CTX-K2 record read back from its file: `result` with `reservationBody` a JSON object (never a string), or the issue. */
export function readD2EK2ContextRecord(json: unknown): { record: D2EContextRecord | null; issue: string | null } {
  const result = isObject(json) && isObject(json.result) ? json.result : null
  if (result === null) return { record: null, issue: 'the context record has no result' }
  if (result.status === 'context_ready') {
    if (!isObject(result.reservationBody)) return { record: null, issue: `reservationBody is ${result.reservationBody === null ? 'null' : Array.isArray(result.reservationBody) ? 'an array' : typeof result.reservationBody}, not a JSON object` }
    if (typeof result.reservationDigest !== 'string' || !isObject(result.supportBodySha256s) || typeof result.originDigest !== 'string' || !Array.isArray(result.excludedRouteKeys) || !isObject(result.checks)) {
      return { record: null, issue: 'the context record lacks reservationDigest / supportBodySha256s / originDigest / excludedRouteKeys / checks' }
    }
  }
  return { record: result as unknown as D2EContextRecord, issue: null }
}

// ---------------------------------------------------------------- DSC (§4.2 - §4.6)

export type D2EDiscoveryUnitStatus = D2DiscoveryMeasuredStatus | 'discovery_calculation_error' | 'guardrail_violation' | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'not_executed'
export const D2E_DISCOVERY_MEASURED: readonly D2EDiscoveryUnitStatus[] = ['discovery_cap_reached', 'stopped_by_search_extent_bound', 'discovery_exhausted', 'ladder_exhausted']
export type D2EDiscoveryStop = 'discovery_cap_reached' | 'discovery_exhausted' | 'ladder_exhausted' | 'unmeasured' | 'not_executed'

/** §4.4: after one unit, the next rung or the discovery stop (K2_POOL_CAP = 2). */
export function d2eDiscoveryNext(status: D2EDiscoveryUnitStatus, rung: Phase2C27BRungId, poolSize: number): { next: Phase2C27BRungId | null; stop: D2EDiscoveryStop | null } {
  if (status === 'discovery_cap_reached' || status === 'discovery_exhausted' || status === 'ladder_exhausted') return { next: null, stop: status }
  if (status === 'stopped_by_search_extent_bound') {
    if (poolSize >= D2E_K2_POOL_CAP) throw new D1InvariantError('an extent-bound unit with a full pool')
    const next = PHASE2C27B_RUNG_IDS[PHASE2C27B_RUNG_IDS.indexOf(rung) + 1] ?? null
    return next === null ? { next: null, stop: 'ladder_exhausted' } : { next, stop: null }
  }
  if (status === 'not_executed') return { next: null, stop: 'not_executed' }
  return { next: null, stop: 'unmeasured' }
}
/** The discovery outcome of §12 (`discovery.outcome`) from the stop. */
export const d2eDiscoveryOutcome = (stop: D2EDiscoveryStop | null): 'cap_reached' | 'ladder_exhausted' | 'discovery_exhausted' | 'unmeasured' =>
  stop === 'discovery_cap_reached' ? 'cap_reached' : stop === 'ladder_exhausted' ? 'ladder_exhausted' : stop === 'discovery_exhausted' ? 'discovery_exhausted' : 'unmeasured'

export interface D2EDiscoveryTask {
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  supportBuildListEntryIds: string[]
  currentBuildListEntryId: string
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  /** The CTX-K2 record values the re-derived context must equal (context drift, §4.2). */
  context: { recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeys: string[] }
  /** R0-split: each support's K1 CTX record reservationBody (CTX-3 / CTX-4). */
  k1Reservations: { supportBuildListEntryId: string; k: number; reservationBody: Json }[]
  /** `candidateStableKey()` of every pooled Candidate before this unit, in discovery order. */
  poolKeysAtStart: string[]
  /** D-4: the D2-B K0 pool of the Target; D-5: the D2-C K1 pool of the Target. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  d2cK1Pool: { ordinal: number; contextId: string; keySha256: string }[]
  poolCap: number
  researchMaxPlanSteps: number
}

export type D2EDeliveryAction = 'pooled' | 'duplicate_of_lower_rung' | 'same_key_as_d2b_k0_pool' | 'same_key_as_d2c_k1_pool'
export interface D2EDiscoveryDelivery {
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  action: D2EDeliveryAction
  r0K2: boolean
  r0Split: Record<string, boolean>
  matchedD2bOrdinal: number | null
  matchedD2cK1: { ordinal: number; contextId: string } | null
}
export interface D2EPooledCandidate {
  /** 1-based index in the context pool (rung, then delivery order). */
  indexInContext: number
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  r0K2: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  r0Split: Record<string, boolean>
  searchIdentity: string
  reservationDigest: string
  generatedBuildListEntryId: string
  reusedExisting: boolean
  replacement: { status: string; replacedBuildListEntryId: string | null }
  requiresSupport: string[]
  /** The G store body (the child script writes it to the run dir and drops it from the record). */
  generatedEntry: BuildListEntry | null
}
export type D2EDiscoveryChildResult =
  | { status: D2DiscoveryMeasuredStatus; unitId: string; contextId: string; rung: Phase2C27BRungId; poolSizeAtStart: number; deliveries: D2EDiscoveryDelivery[]; pooled: D2EPooledCandidate[]; searchIdentity: string;
      observedContext: { reservationDigest: string; originDigest: string; excludedRouteKeys: string[]; currentBuildListEntryId: string; supportBuildListEntryIds: string[] };
      search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean; skippedExcludedRouteKeys: number };
      timing: { searchVisitMs: number; materializeMs: number; searchOnlyMs: number } }
  | { status: 'discovery_calculation_error'; unitId: string; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; unitId: string; issues: string[] }

/**
 * One discovery unit (§4.2): re-derives the K2 context and checks it against the CTX-K2 record (context drift), then runs the
 * unchanged Production Search at the rung extent with the K2 reservation and the current Route excluded (no capture policy, no
 * reordering). Each delivery: R0-K2 and R0-split (guardrail), D-1 (guardrail), D-2 / D-4 / D-5, otherwise materialized against
 * the baseline Entries and pooled until the pool holds 2. No trial runs. Typed Search / materialization errors become
 * `discovery_calculation_error`.
 */
export async function runD2EDiscoveryUnit(input: PlannerInput, task: D2EDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2EDiscoveryChildResult> {
  try {
    return await discover(input, task, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', unitId: task.unitId, issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'discovery_calculation_error', unitId: task.unitId, error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function discover(input: PlannerInput, task: D2EDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2EDiscoveryChildResult> {
  const now = options.now ?? (() => performance.now())
  const sha = options.sha256OfText
  const issues: string[] = [...d2ePolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, d2eRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (task.unitId !== d2eDiscoveryUnitId(task.rung) || task.contextId !== d2eContextId(task.label, task.supportBuildListEntryIds)) issues.push('unitId / contextId')
  if (task.poolCap !== D2E_K2_POOL_CAP || task.poolKeysAtStart.length >= D2E_K2_POOL_CAP || new Set(task.poolKeysAtStart).size !== task.poolKeysAtStart.length) issues.push('the pool at start is not below K2_POOL_CAP and distinct')
  if (!isObject(task.context.reservationBody)) issues.push('the CTX-K2 reservationBody is not a JSON object')
  if (task.k1Reservations.length !== 2 || !same(task.k1Reservations.map(r => r.supportBuildListEntryId).sort(compare), task.supportBuildListEntryIds) || task.k1Reservations.some(r => !isObject(r.reservationBody))) issues.push('the R0-split reservations are not one JSON object per support')
  if (issues.length > 0) return { status: 'guardrail_violation', unitId: task.unitId, issues }
  // Context drift (§4.2): the re-derived context must be the CTX-K2 record one (both reservation sides objects).
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, task.supportBuildListEntryIds)
  if (resolved.status !== 'ready') return { status: 'guardrail_violation', unitId: task.unitId, issues: ['context_drift: the K2 context is not ready', ...resolved.issues] }
  const prepared = resolved.prepared
  const drift: string[] = []
  if (stableStringify(prepared.reservation) !== stableStringify(task.context.reservationBody)) drift.push('the reservation body differs from the CTX-K2 record')
  if (hashStableValue(prepared.reservation) !== task.context.reservationDigest) drift.push('the reservation digest differs from the CTX-K2 record')
  if (hashStableValue(prepared.origin) !== task.context.originDigest) drift.push('the origin digest differs from the CTX-K2 record')
  if (!same(prepared.excludedRouteKeys, task.context.excludedRouteKeys)) drift.push('excludedRouteKeys differ from the CTX-K2 record')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) drift.push('O_t differs from the CTX-K2 record')
  if (!same(prepared.supportBuildListEntryIds, task.supportBuildListEntryIds)) drift.push('the support set is not S')
  if (drift.length > 0) return { status: 'guardrail_violation', unitId: task.unitId, issues: drift.map(d => `context_drift: ${d}`) }

  const engine = dependencies.rngEngine
  const searchInput = { origin: prepared.origin, targetWeaponId: task.targetWeaponId as never, extent: { ...task.extent }, reservation: prepared.reservation, excludedRouteKeys: [...prepared.excludedRouteKeys] }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: dependencies.clock })
  const searchIdentity = createPlannerAlternativeSearchIdentity(searchInput)
  const reservationDigest = hashStableValue(prepared.reservation)
  const prior = new Set(task.poolKeysAtStart)
  const d2b = new Map(task.d2bK0Pool.map(p => [p.keySha256, p.ordinal]))
  const d2c = new Map(task.d2cK1Pool.map(p => [p.keySha256, { ordinal: p.ordinal, contextId: p.contextId }]))
  const poolSizeAtStart = task.poolKeysAtStart.length
  const seen = new Set<string>()
  const deliveries: D2EDiscoveryDelivery[] = []
  const pooled: D2EPooledCandidate[] = []
  let materializeMs = 0
  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, async (candidate: PlannerAlternativeCandidate) => {
    const indexInUnit = deliveries.length
    if (indexInUnit >= D2E_DELIVERIES_PER_UNIT_MAX) throw new D1InvariantError(`delivery ${indexInUnit} is above the ${D2E_DELIVERIES_PER_UNIT_MAX} deliveries of one unit`)
    const key = candidateStableKey(candidate)
    const keySha256 = sha(key)
    if (seen.has(key)) throw new D1InvariantError(`D-1: delivery ${indexInUnit} repeats a key of this unit`)
    seen.add(key)
    const started = now()
    const summary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(candidate, []).entry, input, engine)
    const r0 = respectsPhase2C2Reservation(summary, candidate.route, prepared.reservation)
    if (!r0.respects) throw new D1InvariantError(`R0-K2: delivery ${indexInUnit} does not respect the K2 reservation`)
    const r0Split = Object.fromEntries(task.k1Reservations.map(r => [r.supportBuildListEntryId, respectsPhase2C2Reservation(summary, candidate.route, r.reservationBody as never).respects]))
    if (!Object.values(r0Split).every(Boolean)) throw new D1InvariantError(`R0-split: delivery ${indexInUnit} does not respect a support K1 reservation (an invariant: C6 makes R0-K2 imply R0-split)`)
    const base = { indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, r0K2: true, r0Split }
    if (prior.has(key)) {
      deliveries.push({ ...base, action: 'duplicate_of_lower_rung', matchedD2bOrdinal: null, matchedD2cK1: null })
      materializeMs += now() - started
      return 'continue'
    }
    const d2bOrdinal = d2b.get(keySha256)
    if (d2bOrdinal !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2b_k0_pool', matchedD2bOrdinal: d2bOrdinal, matchedD2cK1: null })
      materializeMs += now() - started
      return 'continue'
    }
    const d2cMatch = d2c.get(keySha256)
    if (d2cMatch !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2c_k1_pool', matchedD2bOrdinal: null, matchedD2cK1: { ...d2cMatch } })
      materializeMs += now() - started
      return 'continue'
    }
    const generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    const replacement = resolveBuildListEntryReplacement(input.buildListEntries, generated.entry)
    materializeMs += now() - started
    pooled.push({ indexInContext: poolSizeAtStart + pooled.length + 1, indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, routeKind: candidate.route.kind,
      routeOperationCount: candidate.route.operations.length, r0K2: structuredClone(r0), r0Split, searchIdentity, reservationDigest, generatedBuildListEntryId: generated.entry.id,
      reusedExisting: generated.reusedExisting,
      replacement: replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId } : { status: replacement.status, replacedBuildListEntryId: null },
      requiresSupport: [...task.supportBuildListEntryIds], generatedEntry: structuredClone(generated.entry) })
    deliveries.push({ ...base, action: 'pooled', matchedD2bOrdinal: null, matchedD2cK1: null })
    return poolSizeAtStart + pooled.length >= task.poolCap ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const searchVisitMs = now() - visitStarted
  const search = { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
    stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length }
  const status = d2DiscoveryUnitOutcome(search, execution.stoppedByConsumer, task.rung)
  return { status, unitId: task.unitId, contextId: task.contextId, rung: task.rung, poolSizeAtStart, deliveries, pooled, searchIdentity,
    observedContext: { reservationDigest, originDigest: hashStableValue(prepared.origin), excludedRouteKeys: [...prepared.excludedRouteKeys], currentBuildListEntryId: prepared.invalidated.id,
      supportBuildListEntryIds: [...prepared.supportBuildListEntryIds] },
    search, timing: { searchVisitMs, materializeMs, searchOnlyMs: searchVisitMs - materializeMs } }
}

// ---------------------------------------------------------------- evaluations (§5 / §6 / §7.2)

export type D2EStage = 'B0' | 'I0' | 'ADM' | 'EXT'
export type D2EEvaluatedAgainst = 'baseline_reference' | 'baseline' | 'replacement_set'
export const d2eEvaluatedAgainst = (stage: D2EStage): D2EEvaluatedAgainst => stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set'

export interface D2EReplacementTask {
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntrySha256: string
  generatedEntryFile: string
  /** `[]` K0, `[s]` K1, `S` (2, ascending) K2. */
  requiresSupport: string[]
  /** K1: its own CTX record; K2: CTX-K2. Null for K0. */
  contextId: string | null
  contextReservationDigest: string | null
  /** The CTX record `reservationBody` JSON object (never a string). */
  contextReservation: Json | null
  /** K2 only: the pooled Search-input reservation digest (S6). */
  searchReservationDigest: string | null
}
export interface D2ESupportAuthority { supportBuildListEntryId: string; k: number; contextId: string; supportBodySha256: string; reservationDigest: string; reservationBody: Json }
export interface D2EEvaluationTask {
  evaluationId: string
  stage: D2EStage
  evaluatedAgainst: D2EEvaluatedAgainst
  /** The discovery ordinal (ADM / EXT), null otherwise. */
  ordinal: number | null
  /** Ascending by Target ID. Empty for B0. */
  replacements: D2EReplacementTask[]
  /** S4 / S5: the S5 authority CTX record of every support Entry the replacements require. */
  supportAuthorities: D2ESupportAuthority[]
  researchMaxPlanSteps: number
  fullRunCap: number
}
export interface D2EReplacementReservationCheck {
  kind: 'k1_own_context' | 'k2_pair'
  contextId: string
  digestExpected: string
  digestObserved: string
  digestMatched: boolean
  bodyMatched: boolean
  /** K2 only: the pooled Search-input reservation digest equals the CTX-K2 digest (S6). */
  searchInputDigestMatched: boolean | null
  satisfied: boolean
}
export type D2EEvaluationFacts = D2EvaluationFacts & {
  supportBodySha256Observed: Record<string, string>
  childRecheck: { checked: number; issues: string[] }
  /** By generated Entry ID: the K1 own CTX record / K2 pair (S6) reservation check. */
  replacementReservationChecks: Record<string, D2EReplacementReservationCheck>
}
export type D2EEvaluationChildResult =
  | ({ status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' } & D2EEvaluationFacts)
  | { status: 'calculation_error'; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; issues: string[]; childRecheck?: { checked: number; issues: string[] } }

/**
 * One evaluation (§5 / §6 / §7.2): RV1′ / RV2′ for every G of the evaluation before anything runs; S4 / S5 per support against its
 * S5 authority CTX record; each K1 replacement's own CTX record; S6 for the K2 Candidate; then the exact `runD2Evaluation()`
 * procedure (B0: the persisted baseline; otherwise `O_t` replaced by each G store body, the replacement preflight with no fixed
 * constraint, one full runner with a fresh budget of 8; ADM carries the `found_R` diagnostic with explicit decision = fixed Route =
 * support = S). A D2-E invariant is a guardrail violation; any other thrown error is a calculation error.
 */
export async function runD2EEvaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2EEvaluationTask, generatedEntries: readonly BuildListEntry[],
  observedSha256s: readonly string[], dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2EEvaluationChildResult> {
  const recheck: string[] = []
  if (generatedEntries.length !== task.replacements.length || observedSha256s.length !== task.replacements.length) recheck.push('the G store bodies do not match the replacements')
  task.replacements.forEach((r, i) => {
    const g = generatedEntries[i]
    if (observedSha256s[i] !== r.generatedEntrySha256) recheck.push(`RV1′: the G store body ${r.generatedEntryFile} SHA-256 is not the registered one`)
    if (!g || g.id !== r.generatedBuildListEntryId || g.targetWeaponId !== r.targetWeaponId) { recheck.push(`RV1′: the G store body ${r.generatedEntryFile} is not the registered G (id / Target)`); return }
    const resolved = resolveBuildListEntryReplacement(input.buildListEntries, g)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== r.currentBuildListEntryId) recheck.push(`RV2′: the G of ${r.generatedEntryFile} does not replace its O`)
  })
  if (recheck.length > 0) return { status: 'guardrail_violation', issues: recheck, childRecheck: { checked: task.replacements.length, issues: recheck } }
  try {
    return await evaluate(input, exportBuildListEntries, task, generatedEntries, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'calculation_error', error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function evaluate(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2EEvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2EEvaluationChildResult> {
  if (input.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2E_RESEARCH_MAX_PLAN_STEPS) throw new D1InvariantError('the Research maxPlanSteps is not 20000')
  if (task.fullRunCap !== D2E_EVALUATION_FULL_RUN_CAP) throw new D1InvariantError('the evaluation full run cap is not 8')
  if (task.evaluatedAgainst !== d2eEvaluatedAgainst(task.stage)) throw new D1InvariantError('evaluatedAgainst is not the stage one')
  if ((task.stage === 'B0') !== (task.replacements.length === 0)) throw new D1InvariantError('only B0 has no replacement')
  if (task.stage === 'ADM' && task.replacements.length !== 1) throw new D1InvariantError('an admission evaluation replaces exactly one Target')
  if ((task.stage === 'ADM' || task.stage === 'EXT') !== (task.ordinal !== null)) throw new D1InvariantError('a discovery ordinal outside ADM / EXT, or an ADM / EXT without one')
  const k2Replacements = task.replacements.filter(r => r.requiresSupport.length === 2)
  if (task.replacements.some(r => r.requiresSupport.length > 2)) throw new D1InvariantError('a replacement requires more than two support Entries')
  if (k2Replacements.length > ((task.stage === 'ADM' || task.stage === 'EXT') ? 1 : 0) || ((task.stage === 'ADM' || task.stage === 'EXT') && k2Replacements.length !== 1)) {
    throw new D1InvariantError('ADM / EXT hold exactly one K2 Candidate, B0 / I0 none (G15)')
  }
  if (generatedEntries.length !== task.replacements.length) throw new D1InvariantError('the G store bodies do not match the replacements')
  const budget = createPhase2C27BLadderRerunBudget(D2E_EVALUATION_FULL_RUN_CAP, 0)
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, { yieldControl: options.yieldControl })

  if (task.stage === 'B0') {
    const runContext: PlannerRunBuildListContext = { kind: 'persisted' }
    const run = await runner.run(input, runContext)
    if (run === 'rerun_budget_reached') return finishFacts('planner_rerun_bound_reached', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, null, null, [], [], dependencies, null, {}, {}, {})
    return finishFacts('evaluated', { status: 'not_run', refusal: null }, 0, budget.used, input, runContext, run.result, run.routeCommitment, [], [], dependencies, null, {}, {}, {})
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
  const support = sortedIds([...new Set(task.replacements.flatMap(r => r.requiresSupport))])
  for (const r of task.replacements) {
    if ((r.requiresSupport.length === 0) !== (r.contextId === null && r.contextReservationDigest === null && r.contextReservation === null)) throw new D1InvariantError('a context reservation without a support Entry, or the reverse')
    if (r.contextReservation !== null && !isObject(r.contextReservation)) throw new D1InvariantError('the context reservation body is not a JSON object')
    if ((r.requiresSupport.length === 2) !== (r.searchReservationDigest !== null)) throw new D1InvariantError('a Search-input reservation digest outside a K2 Candidate, or the reverse')
    if (!same(r.requiresSupport, sortedIds(r.requiresSupport)) || new Set(r.requiresSupport).size !== r.requiresSupport.length) throw new D1InvariantError('requiresSupport is not distinct and ascending')
  }
  // S4 / S5 (static, §7.2): each support Entry is the Export's, hashing to its S5 authority supportBodySha256, and derives the
  // authority reservation (digest AND body). Any failure stops the evaluation as a guardrail violation.
  const engine = dependencies.rngEngine
  const staticChecks: Record<string, D2SupportStaticCheck> = {}
  const observedBodies: Record<string, string> = {}
  const inputBody = new Map<string, BuildListEntry>()
  for (const supportId of support) {
    const authority = task.supportAuthorities.find(a => a.supportBuildListEntryId === supportId)
    if (!authority || !isObject(authority.reservationBody)) throw new D1InvariantError(`S4 / S5: no S5 authority CTX record of the support Entry ${supportId}`)
    const inInput = input.buildListEntries.find(e => e.id === supportId)
    const inExport = exportBuildListEntries.filter(e => isObject(e) && e.id === supportId)
    if (!inInput || inExport.length !== 1 || stableStringify(inInput) !== stableStringify(inExport[0])) throw new D1InvariantError(`S4: the support Entry ${supportId} is not the Export body`)
    const bodySha = options.sha256OfText(stableStringify(inExport[0]))
    if (bodySha !== authority.supportBodySha256) throw new D1InvariantError(`S4: the Export support Entry ${supportId} body SHA-256 is not the S5 authority supportBodySha256`)
    observedBodies[supportId] = bodySha
    inputBody.set(supportId, inInput)
    const derived = derivePlannerAlternativeReservation([inInput], engine)
    const digestObserved = hashStableValue(derived)
    const digestMatched = digestObserved === authority.reservationDigest
    const bodyMatched = stableStringify(derived) === stableStringify(authority.reservationBody)
    if (!digestMatched) throw new D1InvariantError(`S5: the support Entry ${supportId} does not derive the S5 authority reservation digest`)
    if (!bodyMatched) throw new D1InvariantError(`S5: the support Entry ${supportId} derives a reservation that is not the S5 authority reservationBody`)
    staticChecks[supportId] = { S4: true, S5: { digestExpected: authority.reservationDigest, digestObserved, digestMatched, bodyExpected: structuredClone(authority.reservationBody),
      bodyObserved: structuredClone(derived), bodyMatched, satisfied: true } }
  }
  // Each K1 replacement's own CTX record and S6 for the K2 Candidate (the two S bodies of the evaluation input).
  const replacementReservationChecks: Record<string, D2EReplacementReservationCheck> = {}
  for (const r of task.replacements.filter(x => x.requiresSupport.length > 0)) {
    const derived = derivePlannerAlternativeReservation(r.requiresSupport.map(id => inputBody.get(id)!), engine)
    const digestObserved = hashStableValue(derived)
    const digestMatched = digestObserved === r.contextReservationDigest
    const bodyMatched = stableStringify(derived) === stableStringify(r.contextReservation)
    const k2 = r.requiresSupport.length === 2
    const searchInputDigestMatched = k2 ? r.searchReservationDigest === r.contextReservationDigest : null
    const satisfied = digestMatched && bodyMatched && searchInputDigestMatched !== false
    replacementReservationChecks[r.generatedBuildListEntryId] = { kind: k2 ? 'k2_pair' : 'k1_own_context', contextId: r.contextId!, digestExpected: r.contextReservationDigest!, digestObserved, digestMatched, bodyMatched,
      searchInputDigestMatched, satisfied }
    if (!satisfied) throw new D1InvariantError(k2 ? `S6: support_pair_reservation_mismatch for ${r.generatedBuildListEntryId}` : `S5: the support of ${r.generatedBuildListEntryId} does not derive its own CTX record reservation`)
  }
  const baselineContext = preparePlannerInitialContext(input, dependencies)
  if (baselineContext.status !== 'ready') throw new D1InvariantError('the baseline initial context is not ready')
  const contexts = createPlannerConflictContexts(baselineContext.context)
  const sortedGenerated = [...generatedEntries].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  const augmented: PlannerInput = { ...input, buildListEntries: [...input.buildListEntries, ...sortedGenerated] }
  const preflight = preparePlannerReplacementConflictPreflight(augmented, replacements, [], contexts, dependencies)
  const runContext: PlannerRunBuildListContext = { kind: 'temporary_replacement', replacements }
  if (preflight.status !== 'ready') {
    return finishFacts('preflight_refused', { status: preflight.status, refusal: JSON.stringify(preflight).slice(0, 2000) }, 0, 0, augmented, runContext, null, null, task.replacements, support, dependencies, null,
      staticChecks, observedBodies, replacementReservationChecks)
  }
  if (preflight.resolvedInput.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the evaluation run received a conflict resolution')
  const run = await runner.run(preflight.resolvedInput, runContext)
  if (run === 'rerun_budget_reached') {
    return finishFacts('planner_rerun_bound_reached', { status: 'ready', refusal: null }, 0, budget.used, preflight.resolvedInput, runContext, null, null, task.replacements, support, dependencies, null,
      staticChecks, observedBodies, replacementReservationChecks)
  }
  let verdict: D1EvaluationFacts['trialVerdict'] = null
  if (task.stage === 'ADM') {
    const only = task.replacements[0]!
    const v = judgePlannerAlternativeTrial(run.result, { generatedBuildListEntryId: only.generatedBuildListEntryId as BuildListEntryId, explicitDecisionBuildListEntryIds: only.requiresSupport as BuildListEntryId[],
      fixedRouteBuildListEntryIds: only.requiresSupport as BuildListEntryId[], routeCommitment: run.routeCommitment })
    verdict = v.status === 'found' ? { status: 'found_R', generatedSelected: v.generatedSelected } : { status: 'rejected', reason: v.reason }
  }
  return finishFacts('evaluated', { status: 'ready', refusal: null }, preflight.resolvedInput.conflictResolutions.length, budget.used, preflight.resolvedInput, runContext, run.result, run.routeCommitment,
    task.replacements, support, dependencies, verdict, staticChecks, observedBodies, replacementReservationChecks)
}

const stepProjection = (result: PlannerResult): D1StepProjection[] => (result.plan?.steps ?? []).map(step => ({ order: step.order, operationType: step.operationType,
  targetWeaponId: step.targetWeaponId ?? null, buildListEntryId: step.buildListEntryId ?? null,
  progressedTargetWeaponIds: step.progressedTargetWeaponIds === undefined ? null : [...step.progressedTargetWeaponIds], rngAdvance: structuredClone(step.rngAdvance) }))

/** The D2 facts (the same fields, digests and derivations as `runD2Evaluation()`), plus the D2-E static check records. */
function finishFacts(status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached', preflight: { status: string; refusal: string | null }, runConflictResolutions: number,
  fullRunsStarted: number, runInput: PlannerInput, runContext: PlannerRunBuildListContext, result: PlannerResult | null, commitment: PlannerRouteCommitmentEvidence | null,
  replacements: readonly D2EReplacementTask[], support: readonly string[], dependencies: PlannerDependencies, trialVerdict: D1EvaluationFacts['trialVerdict'],
  staticChecks: Record<string, D2SupportStaticCheck>, observedBodies: Record<string, string>, replacementReservationChecks: Record<string, D2EReplacementReservationCheck>): D2EEvaluationChildResult {
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
    const fixed = staticChecks[id]
    if (fixed === undefined) throw new D1InvariantError(`no static check of the support Entry ${id}`)
    supportChecks[id] = { S1: entry !== undefined && !T.has(entry.targetWeaponId), S2: finalInput.buildListEntries.some(e => e.id === id),
      S3: finalInitial?.status === 'ready' && finalInitial.context.entriesById.has(id as BuildListEntryId), S4: fixed.S4, S5: fixed.S5.satisfied }
  }
  const only = replacements.length === 1 ? replacements[0]! : null
  const targetOf = new Map(runInput.buildListEntries.map(e => [e.id as string, e.targetWeaponId as string]))
  const rejected = (plan?.rejectedBuildListEntries ?? []).map(r => ({ buildListEntryId: r.buildListEntryId as string, reason: r.reason as string })).sort((a, b) => compare(a.buildListEntryId, b.buildListEntryId))
  const facts: D2EEvaluationFacts = {
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
    supportStaticChecks: structuredClone(staticChecks),
    supportBodySha256Observed: { ...observedBodies },
    childRecheck: { checked: replacements.length, issues: [] },
    replacementReservationChecks: structuredClone(replacementReservationChecks),
  }
  facts.resultDigest = d1ResultDigest(facts)
  return { status, ...facts }
}

// ---------------------------------------------------------------- task builders (the runner; the analyzer replays the same inputs)

/** The S5 authority (§7.2) of every support of `v`: the lowest-k K1 CTX record. */
export function d2eSupportAuthorities(v: D2EValidatedInputs): D2ESupportAuthority[] {
  return v.supports.map(sd => {
    const c = sd.contexts[0]
    if (c === undefined) throw new Error(`${sd.supportBuildListEntryId}: no CTX record`)
    return { supportBuildListEntryId: sd.supportBuildListEntryId, k: c.k, contextId: c.contextId, supportBodySha256: c.supportBodySha256, reservationDigest: c.reservationDigest, reservationBody: structuredClone(c.reservationBody) }
  })
}

/** An incumbent replacement (§6.1): K1 carries its own CTX record (t00 CTX-1, t04 CTX-5, t05 CTX-6, t10 CTX-7). */
export function d2eIncumbentReplacement(v: D2EValidatedInputs, r: D2ECandidateRef): D2EReplacementTask {
  const ctx = r.origin === 'd2c_k1' ? v.contexts.find(c => c.k === r.contextK) ?? null : null
  if (r.origin === 'd2c_k1' && ctx === null) throw new Error(`${r.label} c${r.ordinal}: no CTX record`)
  return { targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
    generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: [...r.requiresSupport], contextId: ctx === null ? null : r.contextId,
    contextReservationDigest: ctx?.reservationDigest ?? null, contextReservation: ctx === null ? null : structuredClone(ctx.reservationBody), searchReservationDigest: null }
}

export interface D2EK2PoolRef {
  ordinal: number
  generatedBuildListEntryId: string
  file: string
  sha256: string
  searchReservationDigest: string
}
/** A K2 replacement (§5 / §6.2): requiresSupport = S, the CTX-K2 record values, the pooled Search-input reservation digest. */
export function d2eK2Replacement(v: D2EValidatedInputs, context: { contextId: string; reservationDigest: string; reservationBody: Json }, p: D2EK2PoolRef): D2EReplacementTask {
  if (v.k2 === null) throw new Error('no K2 context')
  return { targetIndex: v.k2.targetIndex, targetWeaponId: v.k2.targetWeaponId, currentBuildListEntryId: v.k2.currentBuildListEntryId, generatedBuildListEntryId: p.generatedBuildListEntryId,
    generatedEntrySha256: p.sha256, generatedEntryFile: p.file, requiresSupport: [...v.k2.supportBuildListEntryIds], contextId: context.contextId, contextReservationDigest: context.reservationDigest,
    contextReservation: structuredClone(context.reservationBody), searchReservationDigest: p.searchReservationDigest }
}

export function d2eEvaluationTask(v: D2EValidatedInputs, evaluationId: string, stage: D2EStage, ordinal: number | null, replacements: readonly D2EReplacementTask[]): D2EEvaluationTask {
  const reps = sortRefs(replacements)
  const support = new Set(reps.flatMap(r => r.requiresSupport))
  return { evaluationId, stage, evaluatedAgainst: d2eEvaluatedAgainst(stage), ordinal, replacements: reps.map(r => ({ ...r, requiresSupport: [...r.requiresSupport] })),
    supportAuthorities: d2eSupportAuthorities(v).filter(a => support.has(a.supportBuildListEntryId)), researchMaxPlanSteps: D2E_RESEARCH_MAX_PLAN_STEPS, fullRunCap: D2E_EVALUATION_FULL_RUN_CAP }
}

// ---------------------------------------------------------------- judgements shared by the runner and the analyzer (§6.5)

/** §6.5: "(a, b) is better than (c, d)". */
export const d2eBetter = (a: { completed: number; conflicts: number }, b: { completed: number; conflicts: number }) =>
  a.completed > b.completed || (a.completed === b.completed && a.conflicts < b.conflicts)
export interface D2ESelectionMetrics { evaluationId: string; ordinal: number; completed: number; conflicts: number; steps: number }
/** §6.5: completed desc, Conflicts asc, steps asc, discovery ordinal asc (a total order). */
export function compareD2ESelection(a: D2ESelectionMetrics, b: D2ESelectionMetrics): number {
  return (b.completed - a.completed) || (a.conflicts - b.conflicts) || (a.steps - b.steps) || (a.ordinal - b.ordinal)
}
/** §6.5 `improvementKind`. */
export function d2eImprovementKind(improved: boolean, metrics: { completed: number; conflicts: number } | null, reference: { completed: number; conflicts: number } | null): 'completed_increase' | 'conflict_decrease_only' | null {
  if (!improved || metrics === null || reference === null) return null
  return metrics.completed > reference.completed ? 'completed_increase' : metrics.completed === reference.completed && metrics.conflicts < reference.conflicts ? 'conflict_decrease_only' : null
}

// ---------------------------------------------------------------- start attestation and Production audit (§10.2)

export const D2E_START_ATTESTATION_FILE = 'start-attestation.json'
export const D2E_START_ATTESTATION_PHASE = 'Issue #154 D2-E-B runner start attestation'
export const d2eProductionChangedFiles = d2ProductionChangedFiles

/** §10.2 / §12 `conditions`: the registered policy (context, derivation, reservation, ladder, cap, dedup, procedures, gate, order, budgets, envelope, decision). */
export function d2eRegisteredConditions() {
  return {
    specFile: D2E_SPEC_FILE,
    baseMain: D2E_BASE_MAIN,
    k2Context: '§3.2 of the attested D2-E document (one K2 context, re-derived by §3.1 in V and compared)',
    derivationRule: [...D2E_DERIVATION_RULE],
    registeredReservation: { reservationDigest: D2E_K2_RESERVATION_DIGEST, body: '§1.7 / §3.3 of the attested D2-E document', originDigest: D2E_ORIGIN_DIGEST },
    contextRule: [...D2E_CONTEXT_RULE],
    ladder: D2E_LADDER.map(r => ({ id: r.id, extent: { ...r.extent } })),
    k2PoolCap: D2E_K2_POOL_CAP,
    deliveryCapPerUnit: D2E_DELIVERIES_PER_UNIT_MAX,
    discoveryRule: [...D2E_DISCOVERY_RULE],
    dedupRules: [...D2E_DEDUP_RULES],
    incumbent: '§1.2 of the attested D2-E document (9 Candidates, re-derived by §6.1 in V and compared)',
    order: [...D2E_ORDER],
    i0Rule: [...D2E_I0_RULE],
    admissionRule: [...D2E_ADMISSION_RULE],
    extensionRule: [...D2E_EXTENSION_RULE],
    r5Definition: [...D1_R5_DEFINITION],
    extensionDiagnostics: [...D2E_EXTENSION_DIAGNOSTICS],
    gate: D2E_GATE_RULE,
    betterRule: D2E_BETTER_RULE,
    improvedRule: D2E_IMPROVED_RULE,
    selectionOrder: [...D2E_SELECTION_ORDER],
    r6Definition: [...D2C_R6_DEFINITION],
    rvChecks: [...D2E_RV_CHECKS],
    contextChecks: [...D2E_CONTEXT_CHECKS],
    supportChecks: [...D2E_SUPPORT_CHECKS],
    supportExpiryCauses: [...D2E_SUPPORT_EXPIRY_CAUSES],
    budgets: { ...D2E_BUDGETS },
    executionEnvelope: { ...D2E_EXECUTION_ENVELOPE },
    researchMaxPlanSteps: D2E_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D2E_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D2E_CALCULATION_CONTEXT },
    decisionRule: [...D2E_DECISION_RULE],
    comparisonBaselines: structuredClone(D2E_COMPARISON_BASELINES) as unknown,
    registeredInputs: structuredClone(D2E_REGISTERED_INPUTS) as unknown,
    chainedDocuments: [...D2E_CHAINED_DOCUMENT_KEYS],
    gStoreFiles: D2E_INCUMBENT_G_STORE_FILES.map(f => ({ ...f })),
    contextRecords: D2E_CONTEXT_RECORDS.map(c => ({ ...c })),
    k0ReservationDigest: D2E_K0_RESERVATION_DIGEST,
    b0Expected: { ...D2E_B0_EXPECTED },
    i0Expected: { ...D2E_I0_EXPECTED },
    d2dProvenance: { ...D2E_D2D_PROVENANCE },
    d2cProvenance: { ...D2E_D2C_PROVENANCE },
    d2Provenance: { ...D2E_D2_PROVENANCE },
    d2dResultFieldsRead: [...D2E_D2D_RESULT_ALLOWLIST],
    d2cResultFieldsRead: [...D2E_D2C_RESULT_ALLOWLIST],
    d2ResultFieldsRead: [...D2E_D2_RESULT_ALLOWLIST],
    contextRecordFieldsRead: [...D2E_CONTEXT_RECORD_FIELDS_READ],
    provenanceFlags: { ...D2E_PROVENANCE_FLAGS },
    notRun: [...D2E_NOT_RUN],
  }
}

/** §10.2: the SHA-256 of `stableStringify(conditions)`. */
export const d2eRegisteredPolicySha256 = (sha256OfText: (text: string) => string) => sha256OfText(stableStringify(d2eRegisteredConditions()))

export interface D2ELaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  /** The calculation code digest (the code paths at HEAD, which hold the D2-E benchmark code and every module it imports). */
  benchmarkCodeSha256: string
  /** The D2-E-A document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The observed digest of every registered input, chained document, G store file and CTX record (V checks them against the registered ones). */
  observedInputs: Record<string, D2EObservedFile | null>
  observedDocuments: Record<string, D2EObservedFile | null>
  observedGStoreFiles: Record<string, D2EObservedFile | null>
  observedContextRecords: Record<string, D2EObservedFile | null>
  exportFileName: string
  productionAudit: { baseMain: string; baseMainIsAncestor: boolean; productionChangedSinceBaseMain: string[] }
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  appliedExecutionEnvelope: { rvBudgetMs: number; contextUnitBudgetMs: number; discoveryUnitBudgetMs: number; evaluationBudgetMs: number; discoveryEnvelopeMs: number; runBudgetMs: number; childHeapMb: number;
    concurrency: number; retry: string; fallback: string; memorySampleIntervalMs: number; nodeYield: string }
  rngEngineVersion: string
  /** The CalculationContext the runner observed (`globalResearchInputFromExport()` at launch). */
  observedCalculationContext: unknown
  smoke: { maxRung: string | null; maxChildren: number | null; budgetMs: number | null; skipEvaluations: boolean } | null
}

export type D2EStartAttestation = ReturnType<typeof d2eRegisteredConditions> & D2ELaunchObservation & { phase: string; attestedBy: 'runner' }

export function d2eStartAttestationBody(observation: D2ELaunchObservation): D2EStartAttestation {
  return { phase: D2E_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d2eRegisteredConditions(), ...observation }
}

const EMPTY_D2E_OBSERVATION: D2ELaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  registeredPolicySha256: '', observedInputs: {}, observedDocuments: {}, observedGStoreFiles: {}, observedContextRecords: {}, exportFileName: '',
  productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null },
  appliedExecutionEnvelope: { ...D2E_EXECUTION_ENVELOPE }, rngEngineVersion: '', observedCalculationContext: null, smoke: null }
const D2E_ATTESTATION_KEYS = Object.keys(d2eStartAttestationBody(EMPTY_D2E_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D2EAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The chained Export SHA-256 (`d2eChainedExportSha256()`). */
  exportSha256: string | null
  /** The D2-D RESULT `sources.documents` digests (the chained documents). */
  chainedDocuments: Record<string, string | null>
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D2-E launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / calculation code / D2-E document
 * / registered policy equal to the independently obtained ones, every observed input / document / G store file / CTX record equal to
 * the registered digest, Production changed files = [] with the base main an ancestor, the registered Engine and CalculationContext,
 * a clean non-smoke launch, and every registered condition unchanged.
 */
export function verifyD2EStartAttestation(attestation: unknown, expected: D2EAttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D2E_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D2E_START_ATTESTATION_PHASE) issues.push('not a D2-E-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  if (attestation.registeredPolicySha256 !== expected.registeredPolicySha256) issues.push('registeredPolicySha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D2E_REGISTERED_INPUTS) as [string, D2ERegisteredFile][]) {
    const o = observed[key]
    const want = registered.sha256 ?? expected.exportSha256
    if (!isObject(o) || want === null || o.sha256 !== want || o.bytes !== registered.bytes) issues.push(`the observed ${key} is not the registered input`)
  }
  const docs = isObject(attestation.observedDocuments) ? attestation.observedDocuments : {}
  for (const key of D2E_CHAINED_DOCUMENT_KEYS) {
    const o = docs[key]
    const want = expected.chainedDocuments[key] ?? null
    if (!isObject(o) || want === null || o.sha256 !== want) issues.push(`the observed document ${key} is not the chained document`)
  }
  const g = isObject(attestation.observedGStoreFiles) ? attestation.observedGStoreFiles : {}
  for (const f of D2E_INCUMBENT_G_STORE_FILES) { const o = g[d2eGStoreKey(f.label, f.ordinal)]; if (!isObject(o) || o.sha256 !== f.sha256 || o.bytes !== f.bytes) issues.push(`the observed G store file ${f.file} is not the registered file`) }
  const ctx = isObject(attestation.observedContextRecords) ? attestation.observedContextRecords : {}
  for (const c of D2E_CONTEXT_RECORDS) { const o = ctx[String(c.k)]; if (!isObject(o) || o.sha256 !== c.sha256 || o.bytes !== c.bytes) issues.push(`the observed CTX record ${c.file} is not the registered file`) }
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || audit.baseMain !== D2E_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D2E_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (attestation.rngEngineVersion !== D2E_RNG_ENGINE_VERSION) issues.push('the Production RNG Engine is not the registered one')
  if (!same(attestation.observedCalculationContext, D2E_CALCULATION_CONTEXT)) issues.push('the observed CalculationContext is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D2E_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d2eRegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
