/**
 * Issue #154 D2-F-B: the t03 three-support K3 context discovery and the extension of the D2-D best incumbent (PAIR-t05c1-t07c3).
 * Research only. Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md` (D2-F-A, PR #233), attested by the runner at the measurement
 * HEAD. The registered order (§10.1):
 *
 * ```text
 * V    the registered inputs; the K3 context (§3.1) from the D2-E RESULT, the I0 set (§8.1) and the WP set (§8.2)      parent
 * RV   one child: RV1 .. RV6 (the unchanged D2-D RV over the 9 incumbents and 3 supports), RV7 (the new support), RV8 (WP K2)
 * B0   the baseline PlannerInput, one fresh full run (persisted)
 * I0   the D2-D best incumbent (9 G store bodies), one fresh replacement_set run
 * WP   the I0 set ∪ { t03: D2-E K2 c2 }: the evaluation wrapper parity run (never an incumbent, an EXT or a decision value)
 * CTX  CTX-K3: phase2c27bResolveSupportContext(t03, S) over the three Export support bodies, C1 .. C8 (no Search, no full run)
 * DSC  L0 -> L1 -> L2 of the one K3 context: visitPlannerAlternativeCandidates() with the K3 reservation, R0-K3 / R0-K2 /
 *        R0-split, D-1 / D-2 / D-4 / D-5 / D-6, K3_POOL_CAP = 2, every new key materialized into the G store
 * ADM  per pooled K3 Candidate: T = { t03 } (baseline), requiresSupport = S (3), R1 (R2 .. R4 / found_R are diagnostics)
 * EXT  per admitted K3 Candidate: the I0 set ∪ { t03: c } (10), one replacement_set run each, no early stop
 * ```
 *
 * Every evaluation keeps `conflictResolutions = []` and the preflight fixed constraints `[]` (G1). The support Entries are the
 * Export's own Entries and are never written as a resolution, a scenario resolution, a repair lineage or a selected Entry (G30).
 *
 * The evaluation child (`runD2FEvaluation()`) runs the exact `runD2EEvaluation()` procedure (the same Production parts in the
 * same order) with only the static support-count limits changed (§6 / G60): a replacement requires at most three support Entries,
 * ADM / EXT hold exactly one K3 Candidate, WP exactly one K2 Candidate, B0 / I0 none. S4 / S5 apply to every support of `S_sup`
 * (at most four), S6 to the K2 / K3 Candidate of the set. The D2-E module is not changed.
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module, no Phase 2-C2.5-D2-D / D2-E /
 * D2-F module, and reads the D2-E / D2-D / D2-C / D2 RESULTs through their §11.1 allowlists only and the CTX records through
 * `readD2EContextRecord()` / `readD2EK2ContextRecord()` only. It names no Target, Entry or stable key: the K3 context, the I0 set,
 * the WP set and every support come from the RESULTs and the Export; the registered file names, SHA-256 and digests (§11.1 / §4 /
 * §8) are only compared, and the registered reservation bodies are read from the attested D2-F text (§1.6).
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
import { D2C_R6_DEFINITION, D2C_SUPPORT_EXPIRY_CAUSES } from './plannerGlobalD2C'
import { runD2DReverification, type D2DReverificationResult, type D2DReverificationTask } from './plannerGlobalD2D'
import {
  compareD2ESelection,
  d2eBetter,
  d2eExtensionId,
  d2eGStoreKey,
  d2eImprovementKind,
  d2eReservationContains,
  d2eReservationUnion,
  deriveD2EI0,
  parseD2ESpecIncumbentTable,
  parseD2ESpecT03ResourceIdentities,
  projectD2ED2DResult,
  projectD2ED2Result,
  readD2EContextRecord,
  readD2EK2ContextRecord,
  D2E_B0_EXPECTED,
  D2E_CHAINED_DOCUMENT_KEYS,
  D2E_CONTEXT_RECORD_FIELDS_READ,
  D2E_CONTEXT_RECORDS,
  D2E_D2_PROVENANCE,
  D2E_D2_RESULT_ALLOWLIST,
  D2E_D2C_PROVENANCE,
  D2E_D2D_PROVENANCE,
  D2E_D2D_RESULT_ALLOWLIST,
  D2E_GENERATED_ENTRY_PREFIX,
  D2E_I0_EXPECTED,
  D2E_INCUMBENT_G_STORE_FILES,
  D2E_K0_RESERVATION_DIGEST,
  D2E_K2_RESERVATION_DIGEST,
  D2E_ORIGIN_DIGEST,
  D2E_REGISTERED_INPUTS,
  type D2ECandidateRef,
  type D2EContextData,
  type D2ED2CContextRow,
  type D2ED2DEvaluation,
  type D2EFileRef,
  type D2EI0Derivation,
  type D2EObservedFile,
  type D2EParityExpectation,
  type D2ESupportData,
} from './plannerGlobalD2E'
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
const HEX64 = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------- registered before the formal run (D2-F-A §2 - §14, §16, §18)

export const D2F_PHASE = 'Issue #154 D2-F'
export const D2F_RESULT_PHASE = 'Issue #154 D2-F: t03 three-support K3 context discovery and extension of the D2-D best incumbent (post-hoc analysis)'
/** The D2-F-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§11.2) and attested. */
export const D2F_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md'
/** The main of D2-F-B's start (PR #233 merged): the Production audit counts changes since this commit. */
export const D2F_BASE_MAIN = '407a57f5272351b903ae0030c0a7f707dfd692c5'

/** §1.1 / §11.1: the D2-E formal RESULT D2-F reads (the K3 derivation, the WP set and the D-6 pool come from it). */
export const D2F_D2E_PROVENANCE = Object.freeze({
  measuredHead: 'd294efb005e4943627f3ed27873a33ed7ead8173',
  decisionCase: 'D2E_SET_COEXISTENT_NOT_BETTER',
  runDir: '.local/d2e-k2-formal2.run',
  runDirName: 'd2e-k2-formal2.run',
  contextStatus: 'context_ready',
  k2ReservationDigest: D2E_K2_RESERVATION_DIGEST,
} as const)

/**
 * `sha256: null` is the Export only (its digest is reached through the authority chain, the D2-E / D2-D RESULT `sources.export`).
 * `namedBy`: the attested document whose §11.1 table registers the file - D2-F-A names it itself, or it delegates to D2-E-A §10.1
 * (「D2-E-A §10.1と同じ」).
 */
export interface D2FRegisteredFile { file: string; bytes: number; sha256: string | null; namedBy: 'd2f' | 'd2e' }

/** §11.1: every committed / local input D2-F reads, by path relative to the repository root (the Export is an external path argument). */
export const D2F_REGISTERED_INPUTS = Object.freeze({
  export: { file: D2E_REGISTERED_INPUTS.export.file, bytes: D2E_REGISTERED_INPUTS.export.bytes, sha256: null, namedBy: 'd2f' },
  d2eResult: { file: 'docs/PLANNER_GLOBAL_D2E_RESULT.json', bytes: 409_430, sha256: 'c80f44a8e94dc80a34d9651a7b4f2d8c1242a0e71edaed95d2d7c9d7f0472d58', namedBy: 'd2f' },
  d2dResult: { ...D2E_REGISTERED_INPUTS.d2dResult, namedBy: 'd2f' },
  d2cResult: { ...D2E_REGISTERED_INPUTS.d2cResult, namedBy: 'd2f' },
  d2Result: { ...D2E_REGISTERED_INPUTS.d2Result, namedBy: 'd2f' },
  phase2c2Result: { ...D2E_REGISTERED_INPUTS.phase2c2Result, namedBy: 'd2f' },
  d2eContextRecord: { file: '.local/d2e-k2-formal2.run/CTX-K2.context.json', bytes: 100_563, sha256: '3feb35a7e5746ae2970e8ce64e29bc3bf72aff5b63f54fb056634de7027ee9e4', namedBy: 'd2f' },
  d2eWpGeneratedEntry: { file: '.local/d2e-k2-formal2.run/K2-t03-92d87b90-e396d352-c2.generated-entry.json', bytes: 158_357, sha256: 'b1ac6a83fed5d956fa50c19d415161a33490ab72055d219dfc3a5378135410f4', namedBy: 'd2f' },
  d2eAttestation: { file: '.local/d2e-k2-formal2.run/start-attestation.json', bytes: 32_853, sha256: '6d6c4629cb11cf4f7e26b2c3ed62b3054dd4b5ddcc036b115ffd7fb0cd21b811', namedBy: 'd2f' },
  d2eRaw: { file: '.local/PLANNER_GLOBAL_D2E_K2_RAW2.json.local', bytes: 31_753, sha256: 'c092429263dd4300b2dcdf67d1c36bfbcb21024b96030844db908311ab3081ad', namedBy: 'd2f' },
  d2eSpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md', bytes: 127_982, sha256: '9bbb824169ac22364b451b6313730c7e2042b181db8557dbfeec359f8fa14797', namedBy: 'd2f' },
  d2ebDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2EB.md', bytes: 20_134, sha256: 'fc1d39d43538ecf4b17525c37e3929718f0495c5d0903e73701c8abb0420e498', namedBy: 'd2f' },
  d2dAttestation: { ...D2E_REGISTERED_INPUTS.d2dAttestation, namedBy: 'd2e' },
  d2dRaw: { ...D2E_REGISTERED_INPUTS.d2dRaw, namedBy: 'd2e' },
  d2cAttestation: { ...D2E_REGISTERED_INPUTS.d2cAttestation, namedBy: 'd2e' },
  d2cRaw: { ...D2E_REGISTERED_INPUTS.d2cRaw, namedBy: 'd2e' },
  d2dSpecDocument: { ...D2E_REGISTERED_INPUTS.d2dSpecDocument, namedBy: 'd2e' },
  d2dbDocument: { ...D2E_REGISTERED_INPUTS.d2dbDocument, namedBy: 'd2e' },
} satisfies Record<string, D2FRegisteredFile>)
export type D2FRegisteredInputKey = keyof typeof D2F_REGISTERED_INPUTS

/** §4.1: the registered K3 reservation (C5); the registered body is the first §1.6 JSON of the attested D2-F text. */
export const D2F_K3_RESERVATION_DIGEST = 'fnv1a32:6e2a0744'
export const D2F_K3_RESERVATION_BODY_SHA256 = '4d1de5f415932bd1eebb1a1deadfaeebd995143b6d5b9da4bc6a5160190ae531'
/** §4.2: the registered single-support reservation of the new support (C8, RV7); the body is the second §1.6 JSON. */
export const D2F_NEW_SUPPORT_RESERVATION_DIGEST = 'fnv1a32:6ee53871'
export const D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256 = 'b23501cefc9f47102af4137ca83ce6888a0e1bec10933bc2abc718398e8e0253'
/** §8.2 d2e_wrapper parity: D2-E `EXT-K2-t03-c2` (the evaluation wrapper reproduces the D2-E two-support path). */
export const D2F_WP_EXPECTED = Object.freeze({ inputDigest: 'fnv1a32:2f7009bf', resultDigest: 'fnv1a32:03e2ef58', status: 'evaluated', termination: 'exhausted', completed: 24, totalTargetCount: 43,
  conflicts: 19, steps: 1470, r5Satisfied: true })
/** §12.2: the fixed comparison values (completed / Conflict / steps). The D2-E best EXT is a reference only (never an incumbent). */
export const D2F_COMPARISON_BASELINES = Object.freeze({
  baseline: Object.freeze({ evaluationId: 'B0', completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d2cFinal: Object.freeze({ evaluationId: 'D2-D I0 (D2-C CMP-t10-c1)', completed: 23, totalTargetCount: 43, conflicts: 20, steps: 1465 }),
  d2dBest: Object.freeze({ evaluationId: 'I0', completed: 24, totalTargetCount: 43, conflicts: 19, steps: 1465 }),
  d2eBestExtension: Object.freeze({ evaluationId: 'D2-E best EXT (reference only, the WP parity expectation)', completed: 24, totalTargetCount: 43, conflicts: 19, steps: 1470 }),
})

export const D2F_K3_POOL_CAP = 2
/** §5.6: pooled 2 + duplicate_of_lower_rung (sum <= 2) + D-4 3 + D-5 4 + D-6 2. */
export const D2F_DELIVERIES_PER_UNIT_MAX = 11
export const D2F_SUPPORTS_PER_CONTEXT = 3
export const D2F_RESEARCH_MAX_PLAN_STEPS = D2_RESEARCH_MAX_PLAN_STEPS
export const D2F_EVALUATION_FULL_RUN_CAP = D2_EVALUATION_FULL_RUN_CAP
export const D2F_CALCULATION_CONTEXT = D2_CALCULATION_CONTEXT
export const D2F_RNG_ENGINE_VERSION = D2_RNG_ENGINE_VERSION
export const D2F_GENERATED_ENTRY_PREFIX = D2E_GENERATED_ENTRY_PREFIX
/** §5.5: the registered ladder (Normal / Gogma / Skill), the Phase B / D2 / D2-C / D2-E one. */
export const D2F_LADDER = D2_LADDER

/** §10.4: the execution envelope (Research measurement envelopes, never a Production timeout). */
export const D2F_EXECUTION_ENVELOPE = Object.freeze({
  rvBudgetMs: 10 * 60 * 1000,
  contextUnitBudgetMs: 10 * 60 * 1000,
  discoveryUnitBudgetMs: 60 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  discoveryEnvelopeMs: 5 * 60 * 60 * 1000,
  runBudgetMs: 8 * 60 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

/** §5.6 / §10.3: the registered budgets (each independent; never a Production bound, G5). */
export const D2F_BUDGETS = Object.freeze({
  contexts: 1,
  supportPerContext: D2F_SUPPORTS_PER_CONTEXT,
  contextChildren: 1,
  discoveryUnitsMax: 3,
  k3PoolCap: D2F_K3_POOL_CAP,
  uniqueCandidatesMax: 2,
  deliveriesPerUnitMax: D2F_DELIVERIES_PER_UNIT_MAX,
  generatedEntryFilesMax: 2,
  rvChildren: 1,
  b0Evaluations: 1,
  i0Evaluations: 1,
  wpEvaluations: 1,
  admissionEvaluationsMax: 2,
  extensionEvaluationsMax: 2,
  evaluationRequestsMax: 7,
  childProcessesMax: 12,
  evaluationFullRunCap: D2F_EVALUATION_FULL_RUN_CAP,
  fullPlannerRunsMax: 56,
  researchMaxPlanSteps: D2F_RESEARCH_MAX_PLAN_STEPS,
} as const)

/** §13 provenance flags. */
export const D2F_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  populationManifestRead: false,
  d2eResultModified: false,
  d2dResultModified: false,
  d2cResultModified: false,
  d2ResultModified: false,
  priorEvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true,
  newSearchInD2F: true,
  searchScope: 't03 K3 context only',
  newAdmissionInD2F: true,
  k3ReservationDerivedFromSupportBodies: true,
  k1k2ReservationUnionUsedAsSemantics: false,
  d2eBestExtensionUsedAsIncumbent: false,
  wrapperParityUsedAsDecision: false,
  speculativeSupportWrittenAsResolution: false,
  alternativeToAlternativeSupport: false,
  productionSemanticsChanged: false,
} as const)

/** §11.1: the only D2-C RESULT fields D2-F reads (narrower than D2-E: no composition, no ADM / CMP observation, no aggregates). */
export const D2F_D2C_RESULT_ALLOWLIST = Object.freeze([
  'sources', 'provenance.{formal,measuredHead,analysisHead,runStatus,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.{sha256,verified}}', 'invalidReasons', 'decision.case',
  'contexts[].{contextId,k,label,targetWeaponId,currentBuildListEntryId,supportBuildListEntryId,supportTargetWeaponId,record,supportBodySha256,reservationDigest,originDigest,excludedRouteKeySha256s,status}',
  'discovery.targets[label = the K3 Target label].pool[].{ordinal,contextId,keySha256,generatedBuildListEntryId,requiresSupport} (D-5)',
  'evaluations[].{evaluationId,status,inputDigest,resultDigest} (determinism_prior only)',
])
/** §11.1: the only D2-E RESULT fields D2-F reads. */
export const D2F_D2E_RESULT_ALLOWLIST = Object.freeze([
  'sources.{specDocument,d2d.*,d2c.*,d2.*,incumbentGeneratedEntries,phase2c2Result,export,documents,d2e.{raw,runDir,attestation,contextRecord,generatedEntries}}',
  'provenance.{formal,measuredHead,analysisHead,measuredHeadIsAncestor,runStatus,benchmarkCodeSha256,registeredPolicySha256,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.{sha256,verified},oracleReadByRunner,oracleReadByChild,oracleReadByAnalyzer,oracleGuidedTargetPopulation}',
  'invalidReasons',
  'decision.{case,bestEligibleExtension,bestImprovedExtension,eligibleExtensions,t03CompletedWithoutNetGainExtensions,unmeasuredEvaluations}', 'aggregates.evaluations.{unmeasuredByReason,notExecutedByReason}',
  'context.{contextId,status,record,targetWeaponId,currentBuildListEntryId,supportBuildListEntryIds,supportBodySha256s,reservationDigest,originDigest,excludedRouteKeySha256s}',
  'discovery.{outcome,pool[].{ordinal,keySha256,generatedBuildListEntryId,generatedEntry,searchIdentity,reservationDigest,requiresSupport}}',
  'evaluations[evaluationId in {I0} ∪ EXT].{evaluationId,stage,status,inputDigest,resultDigest,r5.satisfied,eligible,plan.{termination,steps,selectedBuildListEntryIds},conflicts (count),rejectedBuildListEntries,resourceConflictRejections,selectedTargetWeaponIds,referenceDiff.{targetsGained,targetsLost},extension.{t03Completion,conflictsWithT03G[].{resourceIdentity,participants,others}}}',
  'evaluations[].{evaluationId,status,inputDigest,resultDigest} (determinism_prior only)',
])
/** §11.1: the only D2-E CTX-K2 record fields D2-F reads (through `readD2EK2ContextRecord()`: `reservationBody` must be a JSON object). */
export const D2F_K2_CONTEXT_RECORD_FIELDS_READ = Object.freeze(['result.contextId', 'result.supportBuildListEntryIds', 'result.supportBodySha256s', 'result.reservationBody', 'result.reservationDigest',
  'result.originDigest', 'result.excludedRouteKeySha256s', 'result.status'])

export const D2F_DERIVATION_RULE = Object.freeze([
  'S2 = D2-E RESULT context.supportBuildListEntryIds; t = context.targetWeaponId; O_t = context.currentBuildListEntryId; I0e = evaluations[I0]',
  'E* = D2-E RESULT evaluations with stage EXT ∧ r5.satisfied ∧ eligible ∧ extension.t03Completion.t03CompletedWithoutNetGain; |E*| != 1 -> V fails',
  'lost = e.referenceDiff.targetsLost; |lost| != 1 -> V fails',
  'X = { o.buildListEntryId | c in e.extension.conflictsWithT03G, o in c.others, o.role = outside_set, selected in I0e, not selected in e, { o, resource_conflict } in e.rejectedBuildListEntries, exactly one Export Entry of o whose Target is in lost }; |X| != 1 -> V fails',
  'K3(t) = { t, O_t, supports = sorted(S2 ∪ X) } (Entry ID ascending, 3); it must equal the §3.2 table (Target, O_t, supports, order, E*, lost, X); any difference is input_evidence (no child starts)',
  'the E1 Targets and O_t come from D2 RESULT discovery.targets (11); no population manifest is read',
])
export const D2F_I0_RULE = Object.freeze([
  'I0 = D2-D RESULT decision.bestImprovedPair (= PAIR-t05c1-t07c3): the 9 Candidates (Target ID ascending) = the D2-E-A §1.2 table, re-derived in V with inputDigest fnv1a32:6493291d',
  'requiresSupport t00 / t10 [e396d352], t04 [92d87b90], t05 [61066e62], others []; each K1 replacement carries its own CTX record (CTX-1 / CTX-5 / CTX-6 / CTX-7); evaluatedAgainst = replacement_set',
  'expected (d2d_best / d2e_i0): inputDigest, evaluated, resultDigest fnv1a32:57dbb4e5, exhausted, 24 / 43, Conflict 19, steps 1465, R5, resource_conflict 19, the 3 supports selected; d2e_i0 adds the new support and its Target selected',
  'I0 is the only reference of the gate and of "better"; the D2-E best EXT is never an incumbent; I0 unmeasured -> every EXT not_executed (i0_unmeasured)',
])
export const D2F_WRAPPER_PARITY_RULE = Object.freeze([
  'WP-D2E-EXT-c<ordinal>: the I0 set ∪ { t03: the D2-E K2 Candidate of decision.bestEligibleExtension } (10), re-derived in V from the D2-E RESULT decision / discovery.pool[] and compared with §8.2',
  'requiresSupport of the K2 Candidate = the D2-E CTX-K2 supports; S6 against the D2-E CTX-K2 reservationBody / digest and the D2-E pooled Search-input digest; evaluatedAgainst = replacement_set',
  'expected (d2e_wrapper): inputDigest fnv1a32:2f7009bf, evaluated, resultDigest fnv1a32:03e2ef58, exhausted, 24 / 43, Conflict 19, steps 1470, R5',
  'WP is parity only: never an incumbent, an EXT, a gate / better / selection value or a decision input; a comparable mismatch aborts (wrapper_parity), an unmeasured WP is not_checked (INCOMPLETE)',
])
export const D2F_CONTEXT_RULE = Object.freeze([
  'CTX-K3 once: phase2c27bResolveSupportContext(baseline, t03, S) over the three Export support bodies (= derivePlannerAlternativeReservation([3 bodies])); never a union of the K1 / K2 reservations',
  'singles = derivePlannerAlternativeReservation([Export body of s]) for every s in S',
  'the record holds reservationBody (a JSON object), reservationDigest, singleSupportReservations, originDigest, excludedRouteKeys (full text and SHA-256), conflictContextCount, C1 .. C8 and diagnostics { equalsK1ComponentwiseUnion, equalsK2UnionNewSupport, registeredResources }',
  'no Search and no full run',
])
export const D2F_CONTEXT_CHECKS = Object.freeze([
  'C1: |S| = 3 distinct and ascending; each support is exactly one Export Entry whose Target is outside E1, not t03, not a generated Entry, not an E1 O_t; the three Targets differ',
  'C2: phase2c27bResolveSupportContext(baseline, t03, S) is ready, its current Entry is O_t03 and its support set is S',
  'C3: the derived exclusiveOwnedWeaponIds hold collectReferencedOwnedWeaponIds of the three support Routes and every exclusiveConsumedOwnedWeaponId of one createPlannerRouteUnitPlans([3 bodies]), with no rejection',
  'C4: the origin digest is the B2-C1 schedule snapshot origin digest and the CTX-3 / CTX-4 / D2-E CTX-K2 originDigest; excludedRouteKeys = [candidateStableKey(O_t03)] = the schedule ones, its SHA-256 = the CTX-3 / CTX-4 / CTX-K2 excludedRouteKeySha256s',
  'C5: reservationDigest = fnv1a32:6e2a0744 and stableStringify(reservationBody) = stableStringify(the §1.6 / §4.1 registered body) (both objects) - parity k3_context_registered',
  'C6: the K3 body contains (a) the D2-E CTX-K2 reservationBody, (b) the CTX-3 / CTX-4 reservationBody, (c) the new support single reservation, componentwise (Normal per counter ID, held ⊇, blocked ⊇, exclusiveOwnedWeaponIds ⊇)',
  'C7: every one of the 6 support orders derives the same reservation (stableStringify and digest)',
  'C8: the new support single reservation digest = fnv1a32:6ee53871 and body = the §1.6 / §4.2 registered body (parity k1_new_support_registered); the other two singles equal every K1 CTX record of their support (guardrail)',
])
export const D2F_DISCOVERY_RULE = Object.freeze([
  'DSC-K3-<rung>: the re-derived K3 context must equal the CTX-K3 record (context_drift otherwise); visitPlannerAlternativeCandidates({ origin, t03, rung extent, reservation, excludedRouteKeys }) without capture policy or reordering',
  'consumer: R0-K3 false -> guardrail; R0-K2 (the D2-E CTX-K2 reservationBody) false -> guardrail; R0-split (the CTX-K3 single of the new support, CTX-3, CTX-4) false -> guardrail; D-1 -> guardrail; a key in pool -> duplicate_of_lower_rung; SHA-256(key) in the D2-B t03 K0 pool -> same_key_as_d2b_k0_pool; in the D2-C t03 K1 pool -> same_key_as_d2c_k1_pool; in the D2-E t03 K2 pool -> same_key_as_d2e_k2_pool; otherwise materialize, write the G store, pool; stop at |pool| = 2',
  'unit outcome: consumer stop -> discovery_cap_reached; exhausted -> discovery_exhausted; extent -> stopped_by_search_extent_bound (ladder_exhausted at L2); timeout / OOM / process failure / interrupted -> unmeasured; typed error -> discovery_calculation_error',
  'escalate only after stopped_by_search_extent_bound with |pool| < 2; no trial during discovery; found_R never stops the Search; no rung beyond L2',
])
export const D2F_DEDUP_RULES = Object.freeze([
  'D-1 within one unit: a second delivery of one candidateStableKey is an invariant violation (guardrail)',
  'D-2 across rungs of the K3 context: a key already in the pool is duplicate_of_lower_rung (not pooled, not materialized)',
  'D-3 across contexts: not applicable (one K3 context)',
  'D-4 the D2-B t03 K0 pool (3 keys): SHA-256(key) in it -> same_key_as_d2b_k0_pool (the matched ordinal recorded)',
  'D-5 the D2-C t03 K1 pool (4 keys): SHA-256(key) in it -> same_key_as_d2c_k1_pool (the matched ordinal and context recorded)',
  'D-6 the D2-E t03 K2 pool (2 keys): SHA-256(key) in it -> same_key_as_d2e_k2_pool (the matched ordinal recorded); R0-K3 is checked first',
])
export const D2F_ADMISSION_RULE = Object.freeze([
  'one ADM-K3-t03-c<ordinal> per pooled K3 Candidate (discovery ordinal order, at most 2), T = { t03 }, evaluatedAgainst = baseline, requiresSupport = S (3)',
  'discovery ordinal = (rung, delivery index in the unit)',
  'R1 = reusedExisting false ∧ replacement ready with replacedBuildListEntryId = O_t03 ∧ preflight ready ∧ evaluated ∧ plan ∧ termination in { completed, exhausted }',
  'R2 / R3 / R4 / target_regressed_R / found_R (explicit decision = fixed Route = support = S) / winners / crossSupportLoss / newSupport / S1 .. S3 are diagnostics; S4 / S5 / S6 are static (guardrail)',
])
export const D2F_EXTENSION_RULE = Object.freeze([
  'for every admitted K3 Candidate c (discovery ordinal order, no early stop): EXT-K3-t03-c<ordinal> evaluates the I0 set (9) ∪ { t03: c } (10) as one replacement_set run',
  'each EXT depends on I0 only; the 9 incumbent bodies and requiresSupport never change; never two generated Entries of one Target in one PlannerInput (G15); no EXT-to-EXT composition; no WP / D2-E K2 Candidate in an EXT',
  'S_sup of an EXT = the new support ∪ the 3 incumbent supports (4); the new support not selected makes R5(2) false',
])
export const D2F_EXTENSION_DIAGNOSTICS = Object.freeze([
  't03.{generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected}; t03Supports[] (3) { selected, S1 .. S5, supportExpiryCause }',
  'incumbentRetention; supportExpired; conflictsWithinSet[]; conflictsWithT03G[] (other participant: support / incumbent_generated / outside_set); referenceDiff (I0); resourceConflictRejections',
  'newSupport { buildListEntryId, selected, targetWeaponId, targetSelected, winnerBuildListEntryId, S1 .. S5, supportExpiryCause }; newSupportTargetRetained',
  'k2FailureResourcesObserved[] (Skill 648 / Gogma 125: with the t03 G, with the new support); priorT03ResourcesObserved[] (Skill 341 / Gogma 71 / Skill 344 with the t03 G); outsideSetConflictsWithT03G[]',
  't03Completion { t03TargetCompleted, newSupportTargetRetained, netCompletedDelta, t03CompletedWithoutNetGain, t03CompletedWithNewSupportRetainedWithoutNetGain }',
])
export const D2F_GATE_RULE = 'completed(EXT) >= completed(I0) (termination.completedTargetCount of the fresh I0); R5 without the gate is r5OnlyEligible (diagnostic); eligible = evaluated ∧ R5 ∧ gate'
export const D2F_BETTER_RULE = 'completed larger, or completed equal and fewer Conflicts (steps are not compared)'
export const D2F_IMPROVED_RULE = 'improved = eligible ∧ (completed, conflicts) better than I0; improvementKind completed_increase (completed > I0) / conflict_decrease_only (completed = I0, Conflict < I0) / null; equal completed with Conflict >= I0 is not improved (equalMetrics / conflictIncreased recorded)'
export const D2F_SELECTION_ORDER = Object.freeze(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
export const D2F_RV_CHECKS = Object.freeze([
  'RV1 .. RV6: the unchanged D2-D / D2-E RV over the 9 incumbent Candidates and the 3 supports 61066e62 / 92d87b90 / e396d352 (runD2DReverification())',
  'RV7 (the new support): exactly one Export body, SHA-256(stableStringify(body)) = the §3.2 registered supportBodySha256; derivePlannerAlternativeReservation([body]) digest = fnv1a32:6ee53871 and body = the §1.6 / §4.2 registered body',
  'RV8 (the WP K2 Candidate): the D2-E K2 c2 G store bytes / SHA-256 = D2-E RESULT discovery.pool[ordinal].generatedEntry; id, targetWeaponId, calculationContext, isStale = false; candidateSnapshot.searchRunId = the pooled Search identity; SHA-256(candidateStableKey) = the pooled keySha256; replacement ready (O_t03); R0 against the D2-E CTX-K2 reservationBody',
  'RV runs no Search, no full run, no discovery / materialization; any RV1 .. RV8 failure is a guardrail violation (the run aborts); K3 Candidates are not RV subjects',
])
export const D2F_SUPPORT_CHECKS = Object.freeze([
  'S1 dynamic: the support Target is not in the replacement set T',
  'S2 dynamic: the support Entry is in the final run input (after the runtime-unsupported retries)',
  'S3 dynamic: the support Entry is a valid Entry of the final run input initial context',
  'S4 static: the support Entry in the evaluation input is the Export body and SHA-256(stableStringify(body)) = the S5 authority supportBodySha256',
  'S5 static: hashStableValue(derivePlannerAlternativeReservation([Export body])) = the S5 authority reservationDigest AND the bodies equal (both objects); S5 authority: e396d352 CTX-1, 92d87b90 CTX-3, 61066e62 CTX-6, the new support the CTX-K3 singleSupportReservations entry',
  'S6 static (each K2 / K3 Candidate): derivePlannerAlternativeReservation([the requiresSupport bodies of the evaluation input]) = the context record (K3: CTX-K3, the WP K2: the D2-E CTX-K2) reservationDigest AND body, and the pooled Search-input reservation digest = that digest',
])
export const D2F_SUPPORT_EXPIRY_CAUSES = Object.freeze([...D2C_SUPPORT_EXPIRY_CAUSES, 'support_set_reservation_mismatch'])
export const D2F_ORDER = Object.freeze(['V', 'RV', 'B0', 'I0', 'WP', 'CTX-K3', 'DSC L0 -> L1 -> L2', 'ADM (discovery ordinal)', 'EXT (discovery ordinal, admitted only)'])
export const D2F_DECISION_RULE = Object.freeze([
  'D2F_INVALID: any formal validity violation (§5 / §9 / §11 / §12.1): input_evidence / provenance / baseline_parity_mismatch / d2d_parity / wrapper_parity / k1_context_parity / k2_context_parity / k3_context_parity / guardrail / determinism / evidence_integrity / raw_result_mismatch',
  'D2F_INCOMPLETE: invalid 0 and a registered RV / B0 / I0 / WP / CTX / DSC / ADM / EXT is unmeasured or not_executed (a parity not_checked included); measured evidence is a lower bound',
  'D2F_GLOBAL_COMPLETE_R: invalid 0, unmeasured 0, an EXT satisfies R6',
  'D2F_EXCEEDS_D2D_BEST: otherwise, at least one improved EXT',
  'D2F_SET_COEXISTENT_NOT_BETTER: otherwise, at least one EXT with R5 satisfied',
  'D2F_NO_SET_COEXISTENCE: otherwise, at least one measured EXT, all with R5 not satisfied',
  'D2F_NO_ADMITTED_K3_CANDIDATE: invalid 0, unmeasured 0, a non-empty pool, every ADM measured with R1 false (no EXT)',
  'D2F_NO_K3_CANDIDATE: invalid 0, unmeasured 0, the discovery ended ladder_exhausted or discovery_exhausted with an empty pool',
])
/** What D2-F deliberately does not run (§2.5 / §16). */
export const D2F_NOT_RUN = Object.freeze(['t02_search', 'search_outside_t03', 'k0_k1_k2_k4_context_search', 'new_support_target_alternative_search', 'b4b4c72c_support', 'k2_pool_extension',
  'pool_cap_expansion', 'extent_expansion', 'adaptive_support', 'alternative_to_alternative_support', 'incumbent_replacement', 'd2e_best_extension_as_incumbent', 'd2b_d2c_d2e_t03_reevaluation',
  'multiple_passes', 'extension_composition', 'e2_search', 'residual_3', 'population_expansion', 'oracle_comparison', 'prior_result_rewrite', 'resolution_synthesis', 'repair_lineage', 'persistence',
  'retry', 'fallback', 'production_change', 'production_default_change'])

export function d2fPolicyDrift(): string[] {
  const issues: string[] = []
  const b = D2F_BUDGETS
  if (b.evaluationRequestsMax !== b.b0Evaluations + b.i0Evaluations + b.wpEvaluations + b.admissionEvaluationsMax + b.extensionEvaluationsMax) issues.push('the evaluation budget is not 1 + 1 + 1 + 2 + 2')
  if (b.childProcessesMax !== b.rvChildren + b.contextChildren + b.discoveryUnitsMax + b.evaluationRequestsMax) issues.push('the child process budget is not 1 + 1 + 3 + 7')
  if (b.fullPlannerRunsMax !== b.evaluationRequestsMax * D2F_EVALUATION_FULL_RUN_CAP) issues.push('the full Planner run maximum is not 7 x 8')
  if (b.discoveryUnitsMax !== D2F_LADDER.length || b.uniqueCandidatesMax !== D2F_K3_POOL_CAP || b.admissionEvaluationsMax !== D2F_K3_POOL_CAP || b.extensionEvaluationsMax !== D2F_K3_POOL_CAP) issues.push('the discovery budget is not 3 rungs / 2 Candidates')
  if (D2F_DELIVERIES_PER_UNIT_MAX !== D2F_K3_POOL_CAP + 3 + 4 + 2) issues.push('the delivery cap is not 2 + 3 + 4 + 2')
  if (D2F_RESEARCH_MAX_PLAN_STEPS !== 20_000 || D2F_EVALUATION_FULL_RUN_CAP !== 8) issues.push('the Research bound / full run cap moved')
  if (!same(D2F_LADDER.map(r => [r.id, r.extent.maxNormalAdvance, r.extent.maxGogmaAdvance, r.extent.maxSkillAdvance]), [['L0', 4, 235, 4], ['L1', 8, 235, 256], ['L2', 128, 235, 1500]])) issues.push('the ladder moved')
  return issues
}

// ---------------------------------------------------------------- labels and IDs

/** `K3-<t>-<the first 8 characters of each support Entry hash, Entry ID ascending>` (a display ID; identity is the TargetWeapon ID and the full Entry IDs). */
export const d2fContextId = (label: string, supportBuildListEntryIds: readonly string[]) => `K3-${label}-${sortedIds(supportBuildListEntryIds).map(suffix8).join('-')}`
export const D2F_RV_UNIT_ID = 'RV'
export const D2F_RV_RECORD_FILE = 'RV.record.json'
export const D2F_CONTEXT_UNIT_ID = 'CTX-K3'
export const D2F_CONTEXT_RECORD_FILE = 'CTX-K3.context.json'
export const d2fDiscoveryUnitId = (rung: Phase2C27BRungId) => `DSC-K3-${rung}`
export const d2fDiscoveryRecordFile = (rung: Phase2C27BRungId) => `${d2fDiscoveryUnitId(rung)}.record.json`
export const d2fAdmissionId = (label: string, ordinal: number) => `ADM-K3-${label}-c${ordinal}`
export const d2fExtensionId = (label: string, ordinal: number) => `EXT-K3-${label}-c${ordinal}`
/** §8.2: `WP-D2E-EXT-c<the D2-E pool ordinal of the K2 Candidate>`. */
export const d2fWrapperParityId = (d2eOrdinal: number) => `WP-D2E-EXT-c${d2eOrdinal}`
export const d2fEvaluationRecordFile = (evaluationId: string) => `${evaluationId}.record.json`
export const d2fPoolFileName = (contextId: string, indexInContext: number) => `${contextId}-c${indexInContext}.generated-entry.json`
export const d2fRungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...D2F_LADDER.find(r => r.id === rung)!.extent })

// ---------------------------------------------------------------- the D2-E / D2-C RESULT allowlists (§11.1); D2-D / D2 reuse the D2-E-A projections

const fileRef = (v: unknown): D2EFileRef | null => isObject(v) && typeof v.file === 'string'
  ? { file: v.file, bytes: typeof v.bytes === 'number' ? v.bytes : null, sha256: typeof v.sha256 === 'string' ? v.sha256 : null } : null
const fileRefs = (v: unknown): D2EFileRef[] => (Array.isArray(v) ? v : []).map(fileRef).filter((x): x is D2EFileRef => x !== null)
export interface D2FPriorEvaluation { source: 'D2-E' | 'D2-D' | 'D2-C' | 'D2'; evaluationId: string; status: string; inputDigest: string | null; resultDigest: string | null }
const priorRows = (source: D2FPriorEvaluation['source'], v: unknown): D2FPriorEvaluation[] => (Array.isArray(v) ? v : []).filter(isObject).map(e => ({ source, evaluationId: String(e.evaluationId),
  status: String(e.status), inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null }))

export interface D2FD2CResultProjection {
  sources: Json
  provenance: Record<string, unknown>
  invalidReasons: unknown
  decisionCase: unknown
  contexts: D2ED2CContextRow[]
  /** discovery.targets[label = poolLabel].pool[] (D-5), null when the label has no discovery target. */
  pool: { ordinal: number; contextId: string; keySha256: string; generatedBuildListEntryId: string; requiresSupport: string[] }[] | null
  prior: D2FPriorEvaluation[]
}

/** Reads ONLY the D2-F §11.1 D2-C RESULT fields (narrower than the D2-E-A allowlist). */
export function projectD2FD2CResult(json: unknown, poolLabel: string | null): D2FD2CResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.discovery) || !Array.isArray(json.evaluations) || !Array.isArray(json.contexts)) return null
  const p = json.provenance
  const contexts: D2ED2CContextRow[] = (json.contexts as unknown[]).filter(isObject).map(c => ({ contextId: String(c.contextId), k: Number(c.k), label: String(c.label), targetWeaponId: String(c.targetWeaponId),
    currentBuildListEntryId: String(c.currentBuildListEntryId), supportBuildListEntryId: String(c.supportBuildListEntryId), supportTargetWeaponId: typeof c.supportTargetWeaponId === 'string' ? c.supportTargetWeaponId : null,
    record: fileRef(c.record), supportBodySha256: typeof c.supportBodySha256 === 'string' ? c.supportBodySha256 : null, reservationDigest: typeof c.reservationDigest === 'string' ? c.reservationDigest : null,
    originDigest: typeof c.originDigest === 'string' ? c.originDigest : null, excludedRouteKeySha256s: strings(c.excludedRouteKeySha256s), status: typeof c.status === 'string' ? c.status : null }))
  const target = poolLabel === null ? null : (Array.isArray(json.discovery.targets) ? json.discovery.targets as unknown[] : []).filter(isObject).find(t => t.label === poolLabel) ?? null
  const pool = target === null ? null : (Array.isArray(target.pool) ? target.pool as unknown[] : []).filter(isObject).map(x => ({ ordinal: Number(x.ordinal), contextId: String(x.contextId),
    keySha256: String(x.keySha256), generatedBuildListEntryId: String(x.generatedBuildListEntryId), requiresSupport: strings(x.requiresSupport) }))
  return {
    sources: structuredClone(json.sources),
    provenance: { formal: p.formal, measuredHead: p.measuredHead, analysisHead: p.analysisHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead),
      productionChangedFiles: structuredClone(p.productionChangedFiles), startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null,
      startAttestationVerified: isObject(p.startAttestation) ? p.startAttestation.verified : null },
    invalidReasons: structuredClone(json.invalidReasons), decisionCase: json.decision.case, contexts, pool, prior: priorRows('D2-C', json.evaluations),
  }
}

export interface D2FD2EConflictWithT03G { resourceIdentity: string | null; participants: string[]; others: { buildListEntryId: string; role: string }[] }
export interface D2FD2EEvaluation {
  evaluationId: string
  stage: string | null
  status: string
  inputDigest: string | null
  resultDigest: string | null
  r5Satisfied: boolean | null
  eligible: boolean | null
  termination: { status: string; completedTargetCount: number; totalTargetCount: number; reachedLimits: string[] } | null
  steps: number | null
  selectedBuildListEntryIds: string[]
  conflictCount: number | null
  rejectedBuildListEntries: { buildListEntryId: string; reason: string }[]
  resourceConflictRejections: number | null
  selectedTargetWeaponIds: string[]
  targetsGained: string[]
  targetsLost: string[]
  t03Completion: { t03TargetCompleted: boolean | null; netCompletedDelta: number | null; t03CompletedWithoutNetGain: boolean | null } | null
  conflictsWithT03G: D2FD2EConflictWithT03G[]
}
export interface D2FD2EPoolRow { ordinal: number; keySha256: string; generatedBuildListEntryId: string; generatedEntry: D2EFileRef | null; searchIdentity: string; reservationDigest: string; requiresSupport: string[] }
export interface D2FD2EResultProjection {
  sources: { specDocument: D2EFileRef | null; d2d: Json; d2c: Json; d2: Json; incumbentGeneratedEntries: D2EFileRef[]; phase2c2Result: D2EFileRef | null; export: D2EFileRef | null; documents: Record<string, D2EFileRef>;
    d2e: { raw: D2EFileRef | null; runDir: unknown; attestation: D2EFileRef | null; contextRecord: D2EFileRef | null; generatedEntries: D2EFileRef[] } }
  provenance: Record<string, unknown>
  invalidReasons: unknown
  decision: { case: unknown; bestEligibleExtension: unknown; bestImprovedExtension: unknown; eligibleExtensions: string[]; t03CompletedWithoutNetGainExtensions: string[]; unmeasuredEvaluations: unknown }
  aggregates: { unmeasuredByReason: unknown; notExecutedByReason: unknown }
  context: { contextId: string; status: string | null; record: D2EFileRef | null; targetWeaponId: string; currentBuildListEntryId: string; supportBuildListEntryIds: string[]; supportBodySha256s: Record<string, string>;
    reservationDigest: string | null; originDigest: string | null; excludedRouteKeySha256s: string[] } | null
  discovery: { outcome: unknown; pool: D2FD2EPoolRow[] }
  /** I0 and every EXT (§11.1 allowlist). */
  evaluations: D2FD2EEvaluation[]
  prior: D2FPriorEvaluation[]
}

/** Reads ONLY the allowlisted D2-E RESULT fields (§11.1). */
export function projectD2FD2EResult(json: unknown): D2FD2EResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.discovery) || !Array.isArray(json.evaluations)) return null
  const s = json.sources, p = json.provenance, d = json.decision
  const d2e = isObject(s.d2e) ? s.d2e : {}
  const docs = isObject(s.documents) ? s.documents : {}
  const c = isObject(json.context) ? json.context : null
  const evals = isObject(json.aggregates.evaluations) ? json.aggregates.evaluations : {}
  const evaluations: D2FD2EEvaluation[] = (json.evaluations as unknown[]).filter(isObject).filter(e => e.evaluationId === 'I0' || e.stage === 'EXT').map(e => {
    const plan = isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    const ref = isObject(e.referenceDiff) ? e.referenceDiff : null
    const ext = isObject(e.extension) ? e.extension : null
    const tc = ext !== null && isObject(ext.t03Completion) ? ext.t03Completion : null
    return { evaluationId: String(e.evaluationId), stage: typeof e.stage === 'string' ? e.stage : null, status: String(e.status),
      inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      r5Satisfied: isObject(e.r5) && typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null, eligible: typeof e.eligible === 'boolean' ? e.eligible : null,
      termination: t === null ? null : { status: String(t.status), completedTargetCount: Number(t.completedTargetCount), totalTargetCount: Number(t.totalTargetCount), reachedLimits: strings(t.reachedLimits) },
      steps: plan && typeof plan.steps === 'number' ? plan.steps : null, selectedBuildListEntryIds: strings(plan?.selectedBuildListEntryIds),
      conflictCount: Array.isArray(e.conflicts) ? e.conflicts.length : null,
      rejectedBuildListEntries: (Array.isArray(e.rejectedBuildListEntries) ? e.rejectedBuildListEntries as unknown[] : []).filter(isObject).map(r => ({ buildListEntryId: String(r.buildListEntryId), reason: String(r.reason) })),
      resourceConflictRejections: typeof e.resourceConflictRejections === 'number' ? e.resourceConflictRejections : null, selectedTargetWeaponIds: strings(e.selectedTargetWeaponIds),
      targetsGained: strings(ref?.targetsGained), targetsLost: strings(ref?.targetsLost),
      t03Completion: tc === null ? null : { t03TargetCompleted: typeof tc.t03TargetCompleted === 'boolean' ? tc.t03TargetCompleted : null,
        netCompletedDelta: typeof tc.netCompletedDelta === 'number' ? tc.netCompletedDelta : null, t03CompletedWithoutNetGain: typeof tc.t03CompletedWithoutNetGain === 'boolean' ? tc.t03CompletedWithoutNetGain : null },
      conflictsWithT03G: (ext !== null && Array.isArray(ext.conflictsWithT03G) ? ext.conflictsWithT03G as unknown[] : []).filter(isObject).map(x => ({
        resourceIdentity: typeof x.resourceIdentity === 'string' ? x.resourceIdentity : null, participants: strings(x.participants),
        others: (Array.isArray(x.others) ? x.others as unknown[] : []).filter(isObject).map(o => ({ buildListEntryId: String(o.buildListEntryId), role: String(o.role) })) })) }
  })
  const pool: D2FD2EPoolRow[] = (Array.isArray(json.discovery.pool) ? json.discovery.pool as unknown[] : []).filter(isObject).map(x => ({ ordinal: Number(x.ordinal), keySha256: String(x.keySha256),
    generatedBuildListEntryId: String(x.generatedBuildListEntryId), generatedEntry: fileRef(x.generatedEntry), searchIdentity: String(x.searchIdentity), reservationDigest: String(x.reservationDigest),
    requiresSupport: strings(x.requiresSupport) }))
  return {
    sources: { specDocument: fileRef(s.specDocument), d2d: isObject(s.d2d) ? structuredClone(s.d2d) : {}, d2c: isObject(s.d2c) ? structuredClone(s.d2c) : {}, d2: isObject(s.d2) ? structuredClone(s.d2) : {},
      incumbentGeneratedEntries: fileRefs(s.incumbentGeneratedEntries), phase2c2Result: fileRef(s.phase2c2Result), export: fileRef(s.export),
      documents: Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map((k): [string, D2EFileRef | null] => [k, fileRef(docs[k])]).filter((x): x is [string, D2EFileRef] => x[1] !== null)),
      d2e: { raw: fileRef(d2e.raw), runDir: d2e.runDir ?? null, attestation: fileRef(d2e.attestation), contextRecord: fileRef(d2e.contextRecord), generatedEntries: fileRefs(d2e.generatedEntries) } },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, analysisHead: p.analysisHead, measuredHeadIsAncestor: p.measuredHeadIsAncestor, runStatus: p.runStatus, benchmarkCodeSha256: p.benchmarkCodeSha256,
      registeredPolicySha256: p.registeredPolicySha256, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead), productionChangedFiles: structuredClone(p.productionChangedFiles),
      startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null, startAttestationVerified: isObject(p.startAttestation) ? p.startAttestation.verified : null,
      oracleReadByRunner: p.oracleReadByRunner, oracleReadByChild: p.oracleReadByChild, oracleReadByAnalyzer: p.oracleReadByAnalyzer, oracleGuidedTargetPopulation: p.oracleGuidedTargetPopulation },
    invalidReasons: structuredClone(json.invalidReasons),
    decision: { case: d.case, bestEligibleExtension: d.bestEligibleExtension, bestImprovedExtension: d.bestImprovedExtension, eligibleExtensions: strings(d.eligibleExtensions),
      t03CompletedWithoutNetGainExtensions: strings(d.t03CompletedWithoutNetGainExtensions), unmeasuredEvaluations: structuredClone(d.unmeasuredEvaluations) },
    aggregates: { unmeasuredByReason: structuredClone(evals.unmeasuredByReason), notExecutedByReason: structuredClone(evals.notExecutedByReason) },
    context: c === null ? null : { contextId: String(c.contextId), status: typeof c.status === 'string' ? c.status : null, record: fileRef(c.record), targetWeaponId: String(c.targetWeaponId),
      currentBuildListEntryId: String(c.currentBuildListEntryId), supportBuildListEntryIds: strings(c.supportBuildListEntryIds),
      supportBodySha256s: isObject(c.supportBodySha256s) ? Object.fromEntries(Object.entries(c.supportBodySha256s).filter((x): x is [string, string] => typeof x[1] === 'string')) : {},
      reservationDigest: typeof c.reservationDigest === 'string' ? c.reservationDigest : null, originDigest: typeof c.originDigest === 'string' ? c.originDigest : null,
      excludedRouteKeySha256s: strings(c.excludedRouteKeySha256s) },
    discovery: { outcome: json.discovery.outcome, pool },
    evaluations,
    prior: priorRows('D2-E', json.evaluations),
  }
}

export interface D2FK2ContextProjection {
  contextId: string
  supportBuildListEntryIds: string[]
  supportBodySha256s: Record<string, string>
  /** The D2-E CTX-K2 record `result.reservationBody` (a JSON object, never a string). */
  reservationBody: Json
  reservationDigest: string
  originDigest: string
  excludedRouteKeySha256s: string[]
  status: string
}
/** §11.1: reads ONLY the allowlisted D2-E CTX-K2 record fields (through `readD2EK2ContextRecord()`: `reservationBody` must be a JSON object). */
export function readD2FK2ContextRecord(json: unknown): { record: D2FK2ContextProjection | null; issue: string | null } {
  const read = readD2EK2ContextRecord(json)
  if (read.issue !== null || read.record === null) return { record: null, issue: read.issue ?? 'no record' }
  const r = read.record as unknown as Json
  if (r.status !== 'context_ready') return { record: null, issue: `the CTX-K2 record status is ${String(r.status)}, not context_ready` }
  if (!isObject(r.reservationBody) || typeof r.contextId !== 'string' || !Array.isArray(r.supportBuildListEntryIds) || !isObject(r.supportBodySha256s) || typeof r.reservationDigest !== 'string'
    || typeof r.originDigest !== 'string' || !Array.isArray(r.excludedRouteKeySha256s)) return { record: null, issue: 'the CTX-K2 record lacks an allowlisted field or its reservationBody is not a JSON object' }
  return { record: { contextId: r.contextId, supportBuildListEntryIds: strings(r.supportBuildListEntryIds),
    supportBodySha256s: Object.fromEntries(Object.entries(r.supportBodySha256s).filter((x): x is [string, string] => typeof x[1] === 'string')), reservationBody: structuredClone(r.reservationBody),
    reservationDigest: r.reservationDigest, originDigest: r.originDigest, excludedRouteKeySha256s: strings(r.excludedRouteKeySha256s), status: r.status }, issue: null }
}

// ---------------------------------------------------------------- the registered tables of the attested D2-F document

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
const jsonBlockAfter = (markdown: string, heading: RegExp): Json | null => {
  const lines = linesOf(markdown)
  const at = lines.findIndex(line => heading.test(line))
  if (at < 0) return null
  const open = lines.findIndex((line, i) => i > at && line.trim() === '```json')
  const close = open < 0 ? -1 : lines.findIndex((line, i) => i > open && line.trim() === '```')
  if (open < 0 || close < 0) return null
  try { const v: unknown = JSON.parse(lines.slice(open + 1, close).join('\n')); return isObject(v) ? v : null } catch { return null }
}

export interface D2FSpecK3Row {
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  currentKeySha256: string
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: string[]
  supportBodySha256s: string[]
  /** The EXT the derivation basis names (E*). */
  extendedEvaluationId: string
  /** The 8-character suffix the 「新しいsupport」 row names (X). */
  newSupportSuffix: string
}
/** The D2-F-A §3.2 registered K3 context (the registered values; the source holds none of them), or null when the table is absent. */
export function parseD2FSpecK3Context(markdown: string): D2FSpecK3Row | null {
  const rows = tableAfter(markdown, /^### 3\.2 登録K3 context/, /^\| 項目 \| 値 \|/)
  const cell = (key: RegExp) => rows.find(r => key.test(r[0] ?? ''))?.[1] ?? null
  const id = cell(/^context ID$/), target = cell(/^Target$/), current = cell(/^`O_t`$/), support = cell(/^support/), basis = cell(/^導出根拠$/), added = cell(/^新しいsupport$/)
  if (id === null || target === null || current === null || support === null || basis === null || added === null) return null
  const supportTicks = ticks(support)
  return {
    contextId: ticks(id)[0] ?? '', label: target.split('、')[0]!.trim(), targetWeaponId: ticks(target)[0] ?? '',
    currentBuildListEntryId: ticks(current)[0] ?? '', currentKeySha256: ticks(current).find(t => HEX64.test(t)) ?? '',
    supportBuildListEntryIds: supportTicks.filter(t => t.startsWith('build-list.')),
    supportTargetWeaponIds: supportTicks.filter(t => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(t)),
    supportBodySha256s: supportTicks.map(t => /^(?:supportBodySha256 )?([0-9a-f]{64})$/.exec(t)?.[1] ?? null).filter((x): x is string => x !== null),
    extendedEvaluationId: ticks(basis).find(t => t.startsWith('EXT-')) ?? '', newSupportSuffix: ticks(added)[0] ?? '',
  }
}

/** §1.6 / §4.1: the registered K3 reservation body (the JSON block after 「導出されたK3 reservation body」), or null. */
export const parseD2FSpecK3Reservation = (markdown: string): Json | null => jsonBlockAfter(markdown, /^導出されたK3 reservation body/)
/** §1.6 / §4.2: the registered new-support single reservation body (the JSON block after 「導出された … 単独のreservation body」), or null. */
export const parseD2FSpecNewSupportReservation = (markdown: string): Json | null => jsonBlockAfter(markdown, /^導出された .*単独のreservation body/)

export interface D2FSpecWpRow { evaluationId: string; generatedBuildListEntryId: string; gStoreFile: string; gStoreBytes: number }
/** The D2-F-A §8.2 registered WP set (the evaluation ID, the K2 Candidate Entry ID and its G store path / bytes). */
export function parseD2FSpecWp(markdown: string): D2FSpecWpRow | null {
  const rows = tableAfter(markdown, /^### 8\.2 WP/, /^\| 項目 \| 値 \|/)
  const cell = (key: RegExp) => rows.find(r => key.test(r[0] ?? ''))?.[1] ?? null
  const id = cell(/^評価ID$/), set = cell(/^集合$/)
  if (id === null || set === null) return null
  return { evaluationId: ticks(id)[0] ?? '', generatedBuildListEntryId: ticks(set).find(t => t.startsWith('build-list.')) ?? '', gStoreFile: ticks(set).find(t => t.startsWith('.local/')) ?? '',
    gStoreBytes: Number(/([\d,]+) bytes/.exec(set)?.[1]?.replace(/,/g, '')) }
}

// ---------------------------------------------------------------- §3.1: the K3 derivation, §8.2: the WP derivation

export interface D2FK3Context {
  contextId: string
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  /** S2: the D2-E CTX-K2 supports (Entry ID ascending). */
  k2SupportBuildListEntryIds: string[]
  /** X: the added support. */
  addedSupportBuildListEntryId: string
  /** S = sorted(S2 ∪ X) (3). */
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: string[]
  /** E*: the D2-E EXT the derivation reads. */
  extendedEvaluationId: string
  lostTargetWeaponIds: string[]
  /** The D2-C K1 contexts of the Target whose support is an S2 element (k ascending): C4 / C6 / R0-split. */
  k1Contexts: { k: number; contextId: string; supportBuildListEntryId: string }[]
}
export interface D2FK3Derivation { issues: string[]; k3: D2FK3Context | null; extended: string[]; lost: string[]; added: string[] }

/** §3.1, mechanically, from the D2-E RESULT allowlist, the Export and the D2 E1 Targets (pure; never repairs a value). */
export function deriveD2FK3Context(d2e: D2FD2EResultProjection, exportBuildListEntries: readonly unknown[], e1Targets: readonly { label: string; targetWeaponId: string; currentBuildListEntryId: string }[],
  d2cContexts: readonly D2ED2CContextRow[]): D2FK3Derivation {
  const issues: string[] = []
  const fail = (extended: string[] = [], lost: string[] = [], added: string[] = []): D2FK3Derivation => ({ issues, k3: null, extended, lost, added })
  const ctx = d2e.context
  if (ctx === null) { issues.push('the D2-E RESULT has no context'); return fail() }
  const S2 = [...ctx.supportBuildListEntryIds]
  if (S2.length !== 2 || new Set(S2).size !== 2 || !same(S2, sortedIds(S2))) issues.push('the D2-E context supports are not 2 distinct Entry IDs in ascending order')
  const i0 = d2e.evaluations.find(e => e.evaluationId === 'I0') ?? null
  if (i0 === null) { issues.push('the D2-E RESULT has no I0 evaluation'); return fail() }
  const extended = d2e.evaluations.filter(e => e.stage === 'EXT' && e.r5Satisfied === true && e.eligible === true && e.t03Completion?.t03CompletedWithoutNetGain === true)
  if (extended.length !== 1) { issues.push(`|E*| = ${extended.length}, not 1`); return fail(extended.map(e => e.evaluationId)) }
  const e = extended[0]!
  const lost = [...e.targetsLost]
  if (lost.length !== 1) { issues.push(`|lost| = ${lost.length}, not 1`); return fail([e.evaluationId], lost) }
  const i0Selected = new Set(i0.selectedBuildListEntryIds), eSelected = new Set(e.selectedBuildListEntryIds)
  const rejected = new Set(e.rejectedBuildListEntries.filter(r => r.reason === 'resource_conflict').map(r => r.buildListEntryId))
  const X = sortedIds([...new Set(e.conflictsWithT03G.flatMap(c => c.others.filter(o => o.role === 'outside_set').map(o => o.buildListEntryId)).filter(p => {
    const bodies = exportBuildListEntries.filter(x => isObject(x) && x.id === p) as Json[]
    return i0Selected.has(p) && !eSelected.has(p) && rejected.has(p) && bodies.length === 1 && typeof bodies[0]!.targetWeaponId === 'string' && lost.includes(bodies[0]!.targetWeaponId as string)
  }))])
  if (X.length !== 1) { issues.push(`|X| = ${X.length}, not 1`); return fail([e.evaluationId], lost, X) }
  const x = X[0]!
  if (S2.includes(x)) issues.push('X is already a K2 support')
  const label = e1Targets.find(t => t.targetWeaponId === ctx.targetWeaponId)?.label ?? null
  if (label === null) { issues.push('the K3 Target is not a D2 RESULT E1 Target'); return fail([e.evaluationId], lost, X) }
  const S = sortedIds([...S2, x])
  const targetOf = (id: string) => { const b = exportBuildListEntries.filter(y => isObject(y) && y.id === id) as Json[]; return b.length === 1 && typeof b[0]!.targetWeaponId === 'string' ? b[0]!.targetWeaponId as string : '' }
  const k1 = d2cContexts.filter(c => c.targetWeaponId === ctx.targetWeaponId && c.status === 'context_ready' && S2.includes(c.supportBuildListEntryId)).sort((a, b) => a.k - b.k)
  if (k1.length !== 2 || !same(sortedIds(k1.map(c => c.supportBuildListEntryId)), S2)) issues.push('the D2-C K1 contexts of the K3 Target are not one per K2 support')
  if (k1.some(c => c.currentBuildListEntryId !== ctx.currentBuildListEntryId)) issues.push('a D2-C K1 context of the K3 Target names another O_t')
  return { issues, extended: [e.evaluationId], lost, added: X, k3: { contextId: d2fContextId(label, S), label, targetIndex: Number(label.slice(1)), targetWeaponId: ctx.targetWeaponId,
    currentBuildListEntryId: ctx.currentBuildListEntryId, k2SupportBuildListEntryIds: S2, addedSupportBuildListEntryId: x, supportBuildListEntryIds: S, supportTargetWeaponIds: S.map(targetOf),
    extendedEvaluationId: e.evaluationId, lostTargetWeaponIds: lost, k1Contexts: k1.map(c => ({ k: c.k, contextId: c.contextId, supportBuildListEntryId: c.supportBuildListEntryId })) } }
}

export interface D2FK2CandidateRef {
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  /** The D2-E discovery ordinal. */
  ordinal: number
  generatedBuildListEntryId: string
  file: string
  bytes: number
  sha256: string
  searchIdentity: string
  keySha256: string
  /** The D2-E pooled Search-input reservation digest (S6). */
  searchReservationDigest: string
  requiresSupport: string[]
}
export interface D2FWpDerivation {
  issues: string[]
  evaluationId: string
  extensionEvaluationId: string
  k2: D2FK2CandidateRef | null
  generatedBuildListEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  replacementTargets: string[]
  inputDigest: string | null
  registeredInputDigest: string
}

/** §8.2, mechanically: the I0 set ∪ { t03: the D2-E pool Candidate of decision.bestEligibleExtension }, with its `inputDigest`. */
export function deriveD2FWp(d2e: D2FD2EResultProjection, i0: D2EI0Derivation, k3: D2FK3Context, exportSha256: string): D2FWpDerivation {
  const issues: string[] = []
  const best = typeof d2e.decision.bestEligibleExtension === 'string' ? d2e.decision.bestEligibleExtension : ''
  const base = { evaluationId: '', extensionEvaluationId: best, k2: null, generatedBuildListEntryIds: [], generatedEntrySha256s: [], requiresSupport: [], replacementTargets: [], inputDigest: null,
    registeredInputDigest: D2F_WP_EXPECTED.inputDigest }
  if (best !== k3.extendedEvaluationId) { issues.push(`D2-E decision.bestEligibleExtension ${best} is not E* ${k3.extendedEvaluationId}`); return { ...base, issues } }
  const pools = d2e.discovery.pool.filter(p => d2eExtensionId(k3.label, p.ordinal) === best)
  if (pools.length !== 1) { issues.push(`${pools.length} D2-E pool Candidates are the K2 Candidate of ${best}`); return { ...base, issues } }
  const p = pools[0]!
  const ext = d2e.evaluations.find(e => e.evaluationId === best)
  const tG = ext === undefined ? [] : [...new Set(ext.conflictsWithT03G.flatMap(c => c.participants.filter(id => !c.others.some(o => o.buildListEntryId === id))))]
  if (ext === undefined || !same(tG, [p.generatedBuildListEntryId]) || !ext.selectedBuildListEntryIds.includes(p.generatedBuildListEntryId)) issues.push(`the t03 G of ${best} is not the pool Candidate ${p.ordinal}`)
  if (!same(p.requiresSupport, k3.k2SupportBuildListEntryIds)) issues.push('the D2-E pool Candidate requiresSupport is not the K2 supports')
  if (p.reservationDigest !== D2E_K2_RESERVATION_DIGEST) issues.push('the D2-E pool Search-input reservation digest is not the registered K2 digest')
  const g = p.generatedEntry
  const reg = D2F_REGISTERED_INPUTS.d2eWpGeneratedEntry
  if (g === null || `${D2F_D2E_PROVENANCE.runDir}/${g.file}` !== reg.file || g.bytes !== reg.bytes || g.sha256 !== reg.sha256) issues.push('the D2-E pool G store row is not the registered WP G store file')
  if (!HEX64.test(p.keySha256)) issues.push('the D2-E pool keySha256 is not a SHA-256')
  const k2: D2FK2CandidateRef = { label: k3.label, targetIndex: k3.targetIndex, targetWeaponId: k3.targetWeaponId, currentBuildListEntryId: k3.currentBuildListEntryId, ordinal: p.ordinal,
    generatedBuildListEntryId: p.generatedBuildListEntryId, file: reg.file.split('/').pop()!, bytes: reg.bytes, sha256: reg.sha256, searchIdentity: p.searchIdentity, keySha256: p.keySha256,
    searchReservationDigest: p.reservationDigest, requiresSupport: [...p.requiresSupport] }
  const rows = [...i0.replacements.map(r => ({ targetWeaponId: r.targetWeaponId, id: r.generatedBuildListEntryId, sha: r.sha256, support: r.requiresSupport })),
    { targetWeaponId: k2.targetWeaponId, id: k2.generatedBuildListEntryId, sha: k2.sha256, support: k2.requiresSupport }].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  if (rows.length !== 10 || new Set(rows.map(r => r.targetWeaponId)).size !== 10) issues.push('the WP set does not hold 10 distinct Targets (G15)')
  const inputDigest = d1InputDigest(rows.map(r => r.targetWeaponId), rows.map(r => r.id), rows.map(r => r.sha), exportSha256)
  if (inputDigest !== D2F_WP_EXPECTED.inputDigest) issues.push(`WP: inputDigest ${inputDigest} is not the registered ${D2F_WP_EXPECTED.inputDigest}`)
  if (ext !== undefined && ext.inputDigest !== inputDigest) issues.push(`WP: the D2-E ${best} inputDigest ${String(ext.inputDigest)} is not the re-derived ${inputDigest}`)
  return { issues, evaluationId: d2fWrapperParityId(p.ordinal), extensionEvaluationId: best, k2, generatedBuildListEntryIds: rows.map(r => r.id), generatedEntrySha256s: rows.map(r => r.sha),
    requiresSupport: sortedIds([...new Set(rows.flatMap(r => r.support))]), replacementTargets: rows.map(r => r.targetWeaponId), inputDigest, registeredInputDigest: D2F_WP_EXPECTED.inputDigest }
}

// ---------------------------------------------------------------- V: the registered inputs (§11.1)

export interface D2FInputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D2FRegisteredInputKey, D2EObservedFile | null>
  /** The chained documents (D2-D / D2-E RESULT sources.documents), by key. */
  documents: Record<string, D2EObservedFile | null>
  /** By `d2eGStoreKey(label, ordinal)`: the incumbent G store file and its JSON. */
  gStoreFiles: Record<string, { file: D2EObservedFile; json: unknown } | null>
  /** By CTX k: the K1 CTX record file and its JSON. */
  contextRecords: Record<number, { file: D2EObservedFile; json: unknown } | null>
  /** The D2-E CTX-K2 record JSON and the D2-E K2 c2 G store body JSON (their digests are in `files`). */
  d2eContextRecord: unknown
  d2eWpGeneratedEntry: unknown
  d2eResult: unknown
  d2dResult: unknown
  d2cResult: unknown
  d2Result: unknown
  phase2c2Result: unknown
  /** The Export `buildListEntries` (the support bodies, C1, X). */
  exportBuildListEntries: readonly unknown[]
  /** The D2-F-A document text (the measurement HEAD git object). */
  specMarkdown: string
  /** The registered D2-E-A document text (its digest is in `files.d2eSpecDocument`). */
  d2eSpecMarkdown: string
  sha256OfText: (text: string) => string
}

export interface D2FK2ContextData extends D2FK2ContextProjection { recordSha256: string }
export interface D2FValidatedInputs {
  passed: boolean
  issues: string[]
  exportSha256: string | null
  e1: { labels: string[]; targetWeaponIds: string[]; currentBuildListEntryIds: string[] }
  k3: D2FK3Context | null
  k3Derivation: D2FK3Derivation | null
  i0: D2EI0Derivation | null
  wp: D2FWpDerivation | null
  /** The 6 K1 CTX records. */
  contexts: D2EContextData[]
  /** The D2-E CTX-K2 record. */
  k2Context: D2FK2ContextData | null
  /** The 3 support Entries of I0 with every K1 CTX record (k ascending; the first is the S5 authority). */
  supports: D2ESupportData[]
  /** The new support X: its §3.2 registered supportBodySha256 and Target. */
  newSupport: { supportBuildListEntryId: string; supportTargetWeaponId: string; supportBodySha256: string } | null
  /** §1.6 / §4.1 and §4.2: the registered reservation bodies (from the attested text). */
  registeredReservationBody: Json | null
  registeredNewSupportReservationBody: Json | null
  /** D-4 / D-5 / D-6: the D2-B K0, D2-C K1 and D2-E K2 pools of the K3 Target. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  d2cK1Pool: { ordinal: number; contextId: string; keySha256: string }[]
  d2eK2Pool: { ordinal: number; keySha256: string }[]
  /** §8.5 diagnostics: the K2 failure resources (Skill 648 / Gogma 125) and the prior t03 resources (Skill 341 / Gogma 71 / Skill 344). */
  resourceIdentities: { k2Failure: string[]; priorT03: string[] }
  /** inputDigest -> the D2-E / D2-D / D2-C / D2 evaluations holding it (determinism_prior). */
  priorByInputDigest: Record<string, D2FPriorEvaluation[]>
  expected: { b0: D2EParityExpectation; i0: D2EParityExpectation & { resourceConflictRejections: number; supportsSelected: string[]; newSupportSelected: boolean; newSupportTargetSelected: boolean };
    wp: D2EParityExpectation & { r5Satisfied: boolean } } | null
  phase2c2BaselineSummary: unknown
}

/** The Export SHA-256 the D2-E RESULT `sources.export` names (a registered input), or null. */
export function d2fChainedExportSha256(d2eResult: unknown): string | null {
  const e = projectD2FD2EResult(d2eResult)?.sources.export ?? null
  return e !== null && typeof e.sha256 === 'string' && HEX64.test(e.sha256) ? e.sha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const

/**
 * V (§11.1): every registered input present with its registered digest; the D2-E / D2-D / D2-C / D2 RESULTs (allowlists) the
 * registered formal runs; the §3.1 derivation equal to the §3.2 table; the §8.1 I0 set equal to the D2-E-A §1.2 table with
 * `inputDigest` `fnv1a32:6493291d`; the §8.2 WP set equal to its table with `inputDigest` `fnv1a32:2f7009bf`; the incumbent G store,
 * the K1 CTX records, the D2-E CTX-K2 record and the WP G store the registered files. Never repairs or substitutes: any issue fails
 * D2-F closed (`input_evidence`). Pure.
 */
export function validateD2FInputs(evidence: D2FInputEvidence): D2FValidatedInputs {
  const issues: string[] = [...d2fPolicyDrift()]
  const sha = evidence.sha256OfText
  const empty = { labels: [], targetWeaponIds: [], currentBuildListEntryIds: [] }
  const fail = (partial: Partial<D2FValidatedInputs> = {}): D2FValidatedInputs => ({ issues, exportSha256: null, e1: empty, k3: null, k3Derivation: null, i0: null, wp: null, contexts: [], k2Context: null,
    supports: [], newSupport: null, registeredReservationBody: null, registeredNewSupportReservationBody: null, d2bK0Pool: [], d2cK1Pool: [], d2eK2Pool: [], resourceIdentities: { k2Failure: [], priorT03: [] },
    priorByInputDigest: {}, expected: null, phase2c2BaselineSummary: null, ...partial, passed: false })
  const spec = evidence.specMarkdown
  const d2eSpec = evidence.d2eSpecMarkdown
  const named = (key: D2FRegisteredInputKey) => D2F_REGISTERED_INPUTS[key].namedBy === 'd2f' ? spec : d2eSpec
  const exportSha = d2fChainedExportSha256(evidence.d2eResult)
  if (exportSha === null || !spec.includes(exportSha)) issues.push('the chained Export SHA-256 (D2-E RESULT sources.export) is not the one the D2-F document registers')
  for (const [key, registered] of Object.entries(D2F_REGISTERED_INPUTS) as [D2FRegisteredInputKey, D2FRegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? exportSha
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the D2-E RESULT`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
    if (registered.sha256 !== null && !d2NamesSha256(named(key), registered.sha256)) issues.push(`${registered.file}: the ${registered.namedBy === 'd2f' ? 'D2-F' : 'D2-E-A'} document does not name its SHA-256`)
  }
  if (sha(d2eSpec) !== D2F_REGISTERED_INPUTS.d2eSpecDocument.sha256) issues.push('the D2-E-A text is not the registered D2-E-A document')
  for (const f of D2E_INCUMBENT_G_STORE_FILES) if (!d2eSpec.includes(f.sha256) || !d2eSpec.includes(`${f.runDir}/${f.file}`)) issues.push(`${f.file}: the D2-E-A document does not name its path / SHA-256`)
  for (const c of D2E_CONTEXT_RECORDS) if (!d2eSpec.includes(c.sha256)) issues.push(`${c.file}: the D2-E-A document does not name its SHA-256`)
  for (const digest of [D2F_K3_RESERVATION_DIGEST, D2F_NEW_SUPPORT_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_K2_RESERVATION_DIGEST, D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest,
    D2E_B0_EXPECTED.inputDigest, D2E_B0_EXPECTED.resultDigest, D2F_WP_EXPECTED.inputDigest, D2F_WP_EXPECTED.resultDigest, D2F_K3_RESERVATION_BODY_SHA256, D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256]) {
    if (!spec.includes(digest)) issues.push(`${digest}: the D2-F document does not name it`)
  }
  if (!d2eSpec.includes(D2E_K0_RESERVATION_DIGEST)) issues.push(`${D2E_K0_RESERVATION_DIGEST}: the D2-E-A document does not name the K0 digest`)
  if (!spec.includes(D2F_D2E_PROVENANCE.measuredHead)) issues.push('the D2-F document does not name the D2-E measured HEAD')
  for (const head of [D2E_D2D_PROVENANCE.measuredHead, D2E_D2C_PROVENANCE.measuredHead, D2E_D2_PROVENANCE.measuredHead]) if (!d2eSpec.includes(head)) issues.push(`${head}: the D2-E-A document does not name the measured HEAD`)

  const d2e = projectD2FD2EResult(evidence.d2eResult)
  const d2d = projectD2ED2DResult(evidence.d2dResult)
  if (d2e === null) { issues.push('the D2-E RESULT lacks an allowlisted section'); return fail() }
  if (d2d === null) { issues.push('the D2-D RESULT lacks an allowlisted section'); return fail() }
  const sameRef = (a: D2EFileRef | null, file: string, reg: { bytes: number | null; sha256: string | null }) => reg.sha256 !== null && a !== null && a.file === file && a.sha256 === reg.sha256 && (reg.bytes === null || a.bytes === null || a.bytes === reg.bytes)
  const R = D2F_REGISTERED_INPUTS

  // ---- the D2-E RESULT (§11.1 conditions)
  const ep = d2e.provenance
  if (ep.formal !== true) issues.push('D2-E RESULT provenance.formal is not true')
  if (ep.measuredHead !== D2F_D2E_PROVENANCE.measuredHead || ep.analysisHead !== D2F_D2E_PROVENANCE.measuredHead || ep.measuredHeadIsAncestor !== true) issues.push('D2-E RESULT measuredHead / analysisHead is not the registered one')
  if (ep.runStatus !== 'completed') issues.push('D2-E RESULT runStatus is not completed')
  if (!Array.isArray(ep.calculationCodeChangedSinceMeasuredHead) || ep.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-E RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(ep.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-E RESULT productionChangedFiles is not []')
  if (ep.startAttestationSha256 !== R.d2eAttestation.sha256 || ep.startAttestationVerified !== true) issues.push('D2-E RESULT start attestation is not the registered verified one')
  if (ep.oracleReadByRunner !== false || ep.oracleReadByChild !== false || ep.oracleReadByAnalyzer !== false) issues.push('D2-E RESULT oracleReadBy* is not false')
  if (ep.oracleGuidedTargetPopulation !== true) issues.push('D2-E RESULT oracleGuidedTargetPopulation is not true')
  if (!Array.isArray(d2e.invalidReasons) || d2e.invalidReasons.length !== 0) issues.push('D2-E RESULT invalidReasons is not []')
  if (d2e.decision.case !== D2F_D2E_PROVENANCE.decisionCase) issues.push('D2-E RESULT decision.case is not D2E_SET_COEXISTENT_NOT_BETTER')
  if (!same(d2e.aggregates.unmeasuredByReason, {}) || !same(d2e.aggregates.notExecutedByReason, {}) || !same(d2e.decision.unmeasuredEvaluations, [])) issues.push('D2-E RESULT has an unmeasured / not executed evaluation')
  if (d2e.decision.bestImprovedExtension !== null) issues.push('D2-E RESULT bestImprovedExtension is not null')
  const es = d2e.sources
  if (!sameRef(es.specDocument, R.d2eSpecDocument.file, { bytes: null, sha256: R.d2eSpecDocument.sha256 })) issues.push('D2-E RESULT sources.specDocument is not the registered D2-E-A document')
  if (!sameRef(es.export, R.export.file, { bytes: R.export.bytes, sha256: exportSha })) issues.push('D2-E RESULT sources.export is not the registered Export')
  if (!sameRef(es.phase2c2Result, R.phase2c2Result.file, { bytes: null, sha256: R.phase2c2Result.sha256 })) issues.push('D2-E RESULT sources.phase2c2Result is not the registered one')
  if (!sameRef(fileRef(es.d2d.result), R.d2dResult.file, R.d2dResult) || !sameRef(fileRef(es.d2d.attestation), R.d2dAttestation.file, R.d2dAttestation) || !sameRef(fileRef(es.d2d.raw), R.d2dRaw.file, R.d2dRaw)) issues.push('D2-E RESULT sources.d2d is not the registered D2-D RESULT / attestation / raw')
  const esDocs = isObject(es.d2d.documents) ? es.d2d.documents : {}
  if (!sameRef(fileRef(esDocs.d2dA), R.d2dSpecDocument.file, R.d2dSpecDocument) || !sameRef(fileRef(esDocs.d2dB), R.d2dbDocument.file, R.d2dbDocument)) issues.push('D2-E RESULT sources.d2d.documents is not the registered D2-D-A / D2-D-B')
  if (!sameRef(fileRef(es.d2c.result), R.d2cResult.file, R.d2cResult) || !sameRef(fileRef(es.d2c.attestation), R.d2cAttestation.file, R.d2cAttestation) || !sameRef(fileRef(es.d2c.raw), R.d2cRaw.file, R.d2cRaw)) issues.push('D2-E RESULT sources.d2c is not the registered D2-C RESULT / attestation / raw')
  const usedCtx = fileRefs(es.d2c.contextRecordsUsed)
  for (const c of D2E_CONTEXT_RECORDS) if (!usedCtx.some(r => r.file === `${D2E_D2C_PROVENANCE.runDir}/${c.file}` && r.sha256 === c.sha256 && r.bytes === c.bytes)) issues.push(`${c.file}: not named by D2-E RESULT sources.d2c.contextRecordsUsed`)
  if (!sameRef(fileRef(es.d2.result), R.d2Result.file, R.d2Result)) issues.push('D2-E RESULT sources.d2.result is not the registered D2 RESULT')
  for (const f of D2E_INCUMBENT_G_STORE_FILES) if (!es.incumbentGeneratedEntries.some(r => r.file === `${f.runDir}/${f.file}` && r.sha256 === f.sha256 && r.bytes === f.bytes)) issues.push(`${f.file}: not named by D2-E RESULT sources.incumbentGeneratedEntries`)
  const runDirName = D2F_D2E_PROVENANCE.runDirName
  const local = (key: 'd2eAttestation' | 'd2eRaw' | 'd2eContextRecord' | 'd2eWpGeneratedEntry') => { const r = R[key]; return { name: r.file.split('/').pop()!, reg: r } }
  if (es.d2e.runDir !== runDirName) issues.push('D2-E RESULT sources.d2e.runDir is not the registered run dir')
  for (const [ref, key] of [[es.d2e.attestation, 'd2eAttestation'], [es.d2e.raw, 'd2eRaw'], [es.d2e.contextRecord, 'd2eContextRecord']] as const) {
    const { name, reg } = local(key)
    if (!sameRef(ref, name, reg)) issues.push(`D2-E RESULT sources.d2e is not the registered ${key}`)
  }
  { const { name, reg } = local('d2eWpGeneratedEntry'); if (!es.d2e.generatedEntries.some(r => sameRef(r, name, reg))) issues.push('D2-E RESULT sources.d2e.generatedEntries does not name the registered WP G store file') }
  for (const key of D2E_CHAINED_DOCUMENT_KEYS) {
    const ref = es.documents[key] ?? null
    const dref = d2d.sources.documents[key] ?? null
    const observed = evidence.documents[key] ?? null
    if (ref === null || ref.sha256 === null || dref === null || dref.sha256 !== ref.sha256) { issues.push(`D2-E / D2-D RESULT sources.documents.${key} is missing or differs`); continue }
    if (observed === null) { issues.push(`${ref.file}: the document is missing`); continue }
    if (observed.sha256 !== ref.sha256 || (ref.bytes !== null && observed.bytes !== ref.bytes)) issues.push(`${ref.file}: not the document D2-E RESULT sources.documents names`)
  }
  const ectx = d2e.context
  if (ectx === null || ectx.status !== D2F_D2E_PROVENANCE.contextStatus || ectx.reservationDigest !== D2E_K2_RESERVATION_DIGEST || ectx.originDigest !== D2E_ORIGIN_DIGEST) issues.push('D2-E RESULT context is not the registered context_ready K2 context')
  if (ectx !== null && !sameRef(ectx.record, R.d2eContextRecord.file.split('/').pop()!, R.d2eContextRecord)) issues.push('D2-E RESULT context.record is not the registered CTX-K2 record')
  const d2eI0 = d2e.evaluations.find(e => e.evaluationId === 'I0') ?? null
  const I = D2E_I0_EXPECTED
  if (d2eI0 === null || d2eI0.status !== I.status || d2eI0.inputDigest !== I.inputDigest || d2eI0.resultDigest !== I.resultDigest || d2eI0.termination?.status !== I.termination
    || d2eI0.termination.completedTargetCount !== I.completed || d2eI0.termination.totalTargetCount !== I.totalTargetCount || d2eI0.termination.reachedLimits.length !== 0 || d2eI0.conflictCount !== I.conflicts
    || d2eI0.steps !== I.steps || d2eI0.r5Satisfied !== true || d2eI0.resourceConflictRejections !== I.resourceConflictRejections) issues.push('D2-E RESULT I0 is not the registered §1.1 value')

  // ---- the D2-D RESULT (the D2-E-A §10.1 conditions)
  const p = d2d.provenance
  if (p.formal !== true) issues.push('D2-D RESULT provenance.formal is not true')
  if (p.measuredHead !== D2E_D2D_PROVENANCE.measuredHead || p.analysisHead !== D2E_D2D_PROVENANCE.measuredHead) issues.push('D2-D RESULT measuredHead / analysisHead is not the registered one')
  if (p.runStatus !== 'completed') issues.push('D2-D RESULT runStatus is not completed')
  if (!Array.isArray(p.calculationCodeChangedSinceMeasuredHead) || p.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-D RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(p.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-D RESULT productionChangedFiles is not []')
  if (p.startAttestationSha256 !== R.d2dAttestation.sha256 || p.startAttestationVerified !== true) issues.push('D2-D RESULT start attestation is not the registered verified one')
  if (p.oracleReadByRunner !== false || p.oracleReadByChild !== false || p.oracleReadByAnalyzer !== false) issues.push('D2-D RESULT oracleReadBy* is not false')
  if (!Array.isArray(d2d.invalidReasons) || d2d.invalidReasons.length !== 0) issues.push('D2-D RESULT invalidReasons is not []')
  if (d2d.decision.case !== D2E_D2D_PROVENANCE.decisionCase) issues.push('D2-D RESULT decision.case is not D2D_EXCEEDS_D2C_FINAL')
  if (!same(d2d.aggregates.unmeasuredByReason, {}) || !same(d2d.aggregates.notExecutedByReason, {})) issues.push('D2-D RESULT has an unmeasured / not executed evaluation')
  if (d2d.rv.status !== 'verified' || d2d.rv.satisfied !== true) issues.push('D2-D RESULT rv is not verified')
  if (!sameRef(d2d.sources.export, R.export.file, { bytes: R.export.bytes, sha256: exportSha })) issues.push('D2-D RESULT sources.export is not the registered Export')
  const ranking = Array.isArray(d2d.pairsRanking) ? d2d.pairsRanking.filter(isObject) : []
  if (ranking.find(r => r.rank === 1)?.evaluationId !== D2E_D2D_PROVENANCE.bestPair) issues.push('D2-D RESULT pairs.ranking does not rank the registered PAIR first')

  // ---- the D2 RESULT (E1 Targets, D-4 pool)
  const label = ectx === null ? null : (projectD2ED2Result(evidence.d2Result, [])?.targets.find(t => t.targetWeaponId === ectx.targetWeaponId)?.label ?? null)
  const d2 = projectD2ED2Result(evidence.d2Result, label === null ? [] : [label])
  if (d2 === null) { issues.push('the D2 RESULT lacks an allowlisted section'); return fail() }
  if (d2.provenance.formal !== true || d2.provenance.measuredHead !== D2E_D2_PROVENANCE.measuredHead) issues.push('D2 RESULT provenance is not the registered formal run')
  if (!Array.isArray(d2.invalidReasons) || d2.invalidReasons.length !== 0) issues.push('D2 RESULT invalidReasons is not []')
  if (d2.decisionCase !== D2E_D2_PROVENANCE.decisionCase) issues.push('D2 RESULT decision.case is not D2A_EXCEEDS_D1_INCUMBENT')
  if (!sameRef(d2.sourcesExport, R.export.file, { bytes: R.export.bytes, sha256: exportSha })) issues.push('D2 RESULT sources.export is not the registered Export')
  if (d2.targets.length !== D2E_D2_PROVENANCE.e1Targets) issues.push(`D2 RESULT discovery.targets holds ${d2.targets.length} Targets, not 11`)
  const e1 = { labels: d2.targets.map(t => t.label), targetWeaponIds: d2.targets.map(t => t.targetWeaponId), currentBuildListEntryIds: d2.targets.map(t => t.currentBuildListEntryId) }

  // ---- the D2-C RESULT (the D2-F §11.1 allowlist)
  const d2c = projectD2FD2CResult(evidence.d2cResult, label)
  if (d2c === null) { issues.push('the D2-C RESULT lacks an allowlisted section'); return fail({ e1 }) }
  const cp = d2c.provenance
  if (cp.formal !== true) issues.push('D2-C RESULT provenance.formal is not true')
  if (cp.measuredHead !== D2E_D2C_PROVENANCE.measuredHead || cp.analysisHead !== D2E_D2C_PROVENANCE.measuredHead) issues.push('D2-C RESULT measuredHead / analysisHead is not the registered one')
  if (cp.runStatus !== 'completed') issues.push('D2-C RESULT runStatus is not completed')
  if (!Array.isArray(cp.calculationCodeChangedSinceMeasuredHead) || cp.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-C RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(cp.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-C RESULT productionChangedFiles is not []')
  if (cp.startAttestationSha256 !== R.d2cAttestation.sha256 || cp.startAttestationVerified !== true) issues.push('D2-C RESULT start attestation is not the registered verified one')
  if (!Array.isArray(d2c.invalidReasons) || d2c.invalidReasons.length !== 0) issues.push('D2-C RESULT invalidReasons is not []')
  if (d2c.decisionCase !== D2E_D2C_PROVENANCE.decisionCase) issues.push('D2-C RESULT decision.case is not D2C_EXCEEDS_D2B_MAIN')
  if (!sameRef(fileRef(d2c.sources.export), R.export.file, { bytes: R.export.bytes, sha256: exportSha })) issues.push('D2-C RESULT sources.export is not the registered Export')

  // ---- the K3 derivation (§3.1) and the §3.2 table
  const k3Derivation = deriveD2FK3Context(d2e, evidence.exportBuildListEntries, d2.targets, d2c.contexts)
  issues.push(...k3Derivation.issues)
  const table = parseD2FSpecK3Context(spec)
  const k3 = k3Derivation.k3
  if (table === null) issues.push('the D2-F §3.2 table is missing')
  if (k3 !== null && table !== null && (k3.contextId !== table.contextId || k3.label !== table.label || k3.targetWeaponId !== table.targetWeaponId || k3.currentBuildListEntryId !== table.currentBuildListEntryId
    || !same(k3.supportBuildListEntryIds, table.supportBuildListEntryIds) || !same(k3.supportTargetWeaponIds, table.supportTargetWeaponIds) || k3.extendedEvaluationId !== table.extendedEvaluationId
    || suffix8(k3.addedSupportBuildListEntryId) !== table.newSupportSuffix || !same(k3.lostTargetWeaponIds, [table.supportTargetWeaponIds[k3.supportBuildListEntryIds.indexOf(k3.addedSupportBuildListEntryId)]]))) {
    issues.push('the §3.1 derivation is not the §3.2 table (Target, O_t, supports, order, E*, lost or X)')
  }
  if (k3 !== null && (!same(d2e.decision.t03CompletedWithoutNetGainExtensions, [k3.extendedEvaluationId]) || d2e.decision.bestEligibleExtension !== k3.extendedEvaluationId)) issues.push('E* is not the D2-E decision t03CompletedWithoutNetGain / bestEligible extension')
  if (k3 !== null && ectx !== null && (!e1.targetWeaponIds.includes(k3.targetWeaponId) || e1.currentBuildListEntryIds[e1.targetWeaponIds.indexOf(k3.targetWeaponId)] !== k3.currentBuildListEntryId)) issues.push('the K3 Target is not the D2 RESULT E1 Target of its label')
  // C1 (V side) and the registered support body SHA-256 (§3.2).
  let newSupport: D2FValidatedInputs['newSupport'] = null
  if (k3 !== null && table !== null) {
    k3.supportBuildListEntryIds.forEach((sId, i) => {
      const bodies = evidence.exportBuildListEntries.filter(e => isObject(e) && e.id === sId) as Json[]
      const t = bodies.length === 1 ? bodies[0]!.targetWeaponId : null
      if (bodies.length !== 1 || typeof t !== 'string' || e1.targetWeaponIds.includes(t) || t === k3.targetWeaponId || sId.startsWith(D2F_GENERATED_ENTRY_PREFIX) || e1.currentBuildListEntryIds.includes(sId)) issues.push(`${sId}: not one Export Entry outside E1 (C1)`)
      else if (sha(stableStringify(bodies[0])) !== table.supportBodySha256s[i]) issues.push(`${sId}: SHA-256(stableStringify(Export body)) is not the §3.2 registered supportBodySha256`)
    })
    if (new Set(k3.supportTargetWeaponIds).size !== 3) issues.push('the three support Targets are not distinct (C1)')
    const xi = k3.supportBuildListEntryIds.indexOf(k3.addedSupportBuildListEntryId)
    newSupport = { supportBuildListEntryId: k3.addedSupportBuildListEntryId, supportTargetWeaponId: k3.supportTargetWeaponIds[xi] ?? '', supportBodySha256: table.supportBodySha256s[xi] ?? '' }
    if (ectx !== null) for (const s of k3.k2SupportBuildListEntryIds) if (ectx.supportBodySha256s[s] !== table.supportBodySha256s[k3.supportBuildListEntryIds.indexOf(s)]) issues.push(`${s}: the D2-E context supportBodySha256 is not the §3.2 one`)
  }
  const registeredReservationBody = parseD2FSpecK3Reservation(spec)
  const registeredNewSupportReservationBody = parseD2FSpecNewSupportReservation(spec)
  if (registeredReservationBody === null) issues.push('the D2-F §1.6 registered K3 reservation body is missing or not a JSON object')
  else if (hashStableValue(registeredReservationBody) !== D2F_K3_RESERVATION_DIGEST || sha(stableStringify(registeredReservationBody)) !== D2F_K3_RESERVATION_BODY_SHA256) issues.push('the D2-F §1.6 registered K3 body does not hash to the registered digest / SHA-256')
  if (registeredNewSupportReservationBody === null) issues.push('the D2-F §1.6 registered new-support body is missing or not a JSON object')
  else if (hashStableValue(registeredNewSupportReservationBody) !== D2F_NEW_SUPPORT_RESERVATION_DIGEST || sha(stableStringify(registeredNewSupportReservationBody)) !== D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256) issues.push('the D2-F §1.6 registered new-support body does not hash to the registered digest / SHA-256')

  // ---- D-4 / D-5 / D-6 pools and the §8.5 resource identities
  const d2bK0Pool = label === null ? [] : [...(d2.pools[label] ?? [])].sort((a, b) => a.ordinal - b.ordinal)
  const d2cK1Pool = [...(d2c.pool ?? [])].sort((a, b) => a.ordinal - b.ordinal).map(x => ({ ordinal: x.ordinal, contextId: x.contextId, keySha256: x.keySha256 }))
  const d2eK2Pool = [...d2e.discovery.pool].sort((a, b) => a.ordinal - b.ordinal).map(x => ({ ordinal: x.ordinal, keySha256: x.keySha256 }))
  if (d2bK0Pool.length !== 3 || d2cK1Pool.length !== 4 || d2eK2Pool.length !== 2) issues.push(`the D-4 / D-5 / D-6 pools hold ${d2bK0Pool.length} / ${d2cK1Pool.length} / ${d2eK2Pool.length} keys, not 3 / 4 / 2`)
  if (k3 !== null && d2cK1Pool.some(x => !k3.k1Contexts.some(c => c.contextId === x.contextId))) issues.push('the D-5 pool names a context that is not a K1 context of the K3 Target')
  for (const x of [...d2bK0Pool, ...d2cK1Pool, ...d2eK2Pool]) if (!d2NamesSha256(spec, x.keySha256)) issues.push(`${x.keySha256}: the D2-F document does not name the D-4 / D-5 / D-6 key`)
  for (const x of [...d2bK0Pool, ...d2eK2Pool]) if (!spec.includes(x.keySha256)) issues.push(`${x.keySha256}: the D2-F document does not name the full D-4 / D-6 key`)
  for (const x of d2cK1Pool) if (!d2eSpec.includes(x.keySha256)) issues.push(`${x.keySha256}: the D2-E-A document does not name the full D-5 key`)
  const d2fResources = parseD2ESpecT03ResourceIdentities(spec)
  const d2cResources = parseD2ESpecT03ResourceIdentities(d2eSpec)
  const extended = k3 === null ? null : d2e.evaluations.find(e => e.evaluationId === k3.extendedEvaluationId) ?? null
  const k2Failure = k3 === null || extended === null ? [] : sortedIds([...new Set(extended.conflictsWithT03G.filter(c => c.others.some(o => o.buildListEntryId === k3.addedSupportBuildListEntryId))
    .map(c => c.resourceIdentity).filter((x): x is string => x !== null))])
  const priorT03 = sortedIds([...new Set([...d2fResources, ...d2cResources])].filter(r => !k2Failure.includes(r)))
  if (k2Failure.length !== 2 || !k2Failure.every(r => d2fResources.includes(r) && d2cResources.includes(r))) issues.push('the K2 failure resources of E* are not the two §1.2 registered identities')
  if (priorT03.length !== 3) issues.push(`the prior t03 resource identities are ${priorT03.length}, not 3 (§8.5)`)

  // ---- the I0 set (§8.1) and the D2-E-A §1.2 table
  if (exportSha === null) { issues.push('no chained Export SHA-256'); return fail({ e1, k3, k3Derivation }) }
  const i0 = deriveD2EI0(d2d, d2c.contexts, exportSha)
  issues.push(...i0.issues)
  const incumbentTable = parseD2ESpecIncumbentTable(d2eSpec)
  if (incumbentTable.length !== 9) issues.push(`the D2-E-A §1.2 table holds ${incumbentTable.length} rows, not 9`)
  i0.replacements.forEach((r, i) => {
    const row = incumbentTable[i]
    if (!row || row.label !== r.label || row.targetWeaponId !== r.targetWeaponId || row.currentBuildListEntryId !== r.currentBuildListEntryId || row.origin !== r.origin || row.ordinal !== r.ordinal
      || row.contextId !== r.contextId || row.file !== `${r.runDir}/${r.file}` || row.bytes !== r.bytes || row.sha256 !== r.sha256 || row.generatedBuildListEntryId !== r.generatedBuildListEntryId
      || row.searchIdentity !== r.searchIdentity || row.keySha256 !== r.keySha256 || !same(row.requiresSupportSuffixes, r.requiresSupport.map(suffix8))) issues.push(`${r.label}: the §8.1 derivation is not the D2-E-A §1.2 table row ${i + 1}`)
  })
  if (d2eI0 !== null && d2eI0.inputDigest !== i0.inputDigest) issues.push('the D2-E I0 inputDigest is not the re-derived I0 inputDigest')
  if (k3 !== null && i0.replacements.some(r => r.targetWeaponId === k3.targetWeaponId)) issues.push('the K3 Target is an I0 replacement Target')
  // ---- the WP set (§8.2) and its table
  const wp = k3 === null ? null : deriveD2FWp(d2e, i0, k3, exportSha)
  if (wp !== null) issues.push(...wp.issues)
  const wpTable = parseD2FSpecWp(spec)
  if (wp !== null && (wpTable === null || wpTable.evaluationId !== wp.evaluationId || wp.k2 === null || wpTable.generatedBuildListEntryId !== wp.k2.generatedBuildListEntryId
    || wpTable.gStoreFile !== R.d2eWpGeneratedEntry.file || wpTable.gStoreBytes !== R.d2eWpGeneratedEntry.bytes)) issues.push('the §8.2 WP derivation is not the §8.2 table')

  // ---- the incumbent G store bodies (V reads id / targetWeaponId; RV checks the rest)
  for (const f of D2E_INCUMBENT_G_STORE_FILES) {
    const observed = evidence.gStoreFiles[d2eGStoreKey(f.label, f.ordinal)] ?? null
    if (observed === null) { issues.push(`${f.file}: the G store file is missing`); continue }
    if (observed.file.sha256 !== f.sha256 || observed.file.bytes !== f.bytes) issues.push(`${f.file}: the G store file is not the registered one`)
    const r = i0.replacements.find(x => x.label === f.label && x.ordinal === f.ordinal && x.origin === f.origin)
    const body = isObject(observed.json) ? observed.json : null
    if (!r) { issues.push(`${f.file}: no derived Candidate uses this G store file`); continue }
    if (body === null || body.id !== r.generatedBuildListEntryId || body.targetWeaponId !== r.targetWeaponId) issues.push(`${f.file}: the body is not the derived G (id / Target)`)
  }
  // ---- the WP G store body (V reads id / targetWeaponId; RV8 checks the rest)
  const wpBody = isObject(evidence.d2eWpGeneratedEntry) ? evidence.d2eWpGeneratedEntry : null
  if (wp?.k2 && (wpBody === null || wpBody.id !== wp.k2.generatedBuildListEntryId || wpBody.targetWeaponId !== wp.k2.targetWeaponId)) issues.push('the WP G store body is not the derived K2 G (id / Target)')

  // ---- the K1 CTX records
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
  if (k3 !== null) for (const k1 of k3.k1Contexts) {
    const ctx = contexts.find(c => c.k === k1.k)
    if (!ctx || ctx.contextId !== k1.contextId || ctx.supportBuildListEntryId !== k1.supportBuildListEntryId) issues.push(`CTX-${k1.k}: not the derived K1 context ${k1.contextId}`)
    else if (ctx.originDigest !== D2E_ORIGIN_DIGEST || table === null || !same(ctx.excludedRouteKeySha256s, [table.currentKeySha256])) issues.push(`CTX-${k1.k}: originDigest / excludedRouteKeySha256s is not the registered one`)
  }
  // Every K1 incumbent names its own CTX record.
  for (const r of i0.replacements.filter(x => x.origin === 'd2c_k1')) {
    const ctx = contexts.find(c => c.k === r.contextK)
    if (!ctx || ctx.contextId !== r.contextId || !same(r.requiresSupport, [ctx.supportBuildListEntryId])) issues.push(`${r.label} c${r.ordinal}: not a Candidate of a registered CTX record`)
  }
  const supportIds = [...i0.requiresSupport]
  const supports: D2ESupportData[] = supportIds.map(id => ({ supportBuildListEntryId: id, contexts: contexts.filter(c => c.supportBuildListEntryId === id).sort((a, b) => a.k - b.k) }))
  if (supports.length !== 3) issues.push(`${supports.length} I0 support Entries, not 3`)
  if (k3 !== null && (!k3.k2SupportBuildListEntryIds.every(s => supportIds.includes(s)) || supportIds.includes(k3.addedSupportBuildListEntryId))) issues.push('the K2 supports are not I0 supports, or X already is one (§1.3)')
  for (const sd of supports) {
    if (sd.contexts.length === 0) issues.push(`${sd.supportBuildListEntryId}: no CTX record`)
    const first = sd.contexts[0]
    for (const c of sd.contexts.slice(1)) if (first && (c.reservationDigest !== first.reservationDigest || c.supportBodySha256 !== first.supportBodySha256 || stableStringify(c.reservationBody) !== stableStringify(first.reservationBody))) {
      issues.push(`${sd.supportBuildListEntryId}: CTX-${first.k} and CTX-${c.k} differ`)
    }
  }
  if (!same(supports.map(sd => sd.contexts.map(c => c.k)), [[6], [3, 5], [1, 4, 7]])) issues.push('the support CTX records (Entry ID order) are not CTX [6] / [3, 5] / [1, 4, 7]')

  // ---- the D2-E CTX-K2 record (§11.1)
  let k2Context: D2FK2ContextData | null = null
  {
    const read = readD2FK2ContextRecord(evidence.d2eContextRecord)
    if (read.record === null) issues.push(`CTX-K2: ${read.issue}`)
    else {
      const r = read.record
      k2Context = { ...r, recordSha256: evidence.files.d2eContextRecord?.sha256 ?? '' }
      if (ectx === null || r.contextId !== ectx.contextId || !same(r.supportBuildListEntryIds, ectx.supportBuildListEntryIds) || !same(r.supportBodySha256s, ectx.supportBodySha256s) || r.reservationDigest !== ectx.reservationDigest
        || r.originDigest !== ectx.originDigest || !same(r.excludedRouteKeySha256s, ectx.excludedRouteKeySha256s)) issues.push('CTX-K2: the record is not the D2-E RESULT context')
      if (r.reservationDigest !== D2E_K2_RESERVATION_DIGEST || hashStableValue(r.reservationBody) !== r.reservationDigest) issues.push('CTX-K2: reservationBody does not hash to the registered K2 digest')
      if (k3 !== null) for (const k1 of k3.k1Contexts) {
        const c = contexts.find(x => x.k === k1.k)
        if (!c || c.originDigest !== r.originDigest || !same(c.excludedRouteKeySha256s, r.excludedRouteKeySha256s) || r.supportBodySha256s[c.supportBuildListEntryId] !== c.supportBodySha256) issues.push(`CTX-K2: originDigest / excluded keys / support body differ from CTX-${k1.k}`)
      }
    }
  }

  // ---- the parity expectations (D2-D B0 / best PAIR, D2-E I0 / E*)
  const ev = new Map<string, D2ED2DEvaluation>(d2d.evaluations.map(e => [e.evaluationId, e]))
  const b0 = ev.get('B0'), best = ev.get(D2E_D2D_PROVENANCE.bestPair)
  const B = D2E_B0_EXPECTED
  if (!b0 || b0.status !== B.status || b0.inputDigest !== B.inputDigest || b0.resultDigest !== B.resultDigest || b0.termination?.status !== B.termination || b0.termination.completedTargetCount !== B.completed
    || b0.termination.totalTargetCount !== B.totalTargetCount || b0.conflictCount !== B.conflicts || b0.steps !== B.steps) issues.push('D2-D RESULT B0 is not the registered baseline')
  if (!best || best.status !== I.status || best.inputDigest !== I.inputDigest || best.resultDigest !== I.resultDigest || best.termination?.status !== I.termination || best.termination.completedTargetCount !== I.completed
    || best.termination.totalTargetCount !== I.totalTargetCount || best.termination.reachedLimits.length !== 0 || best.conflictCount !== I.conflicts || best.steps !== I.steps || best.r5?.satisfied !== true
    || best.resourceConflictRejections !== I.resourceConflictRejections) issues.push('D2-D RESULT best PAIR is not the registered §1.1 value')
  const supportsSelected = supportIds.filter(id => best?.supportChecksByEntry[id]?.selected === true && best.supportChecksByEntry[id]?.supportExpiryCause === null)
  if (supportsSelected.length !== supportIds.length) issues.push('the D2-D best PAIR does not select every support')
  if (best && (!same(best.generatedEntryIds, i0.generatedBuildListEntryIds) || !same(best.generatedEntrySha256s, i0.generatedEntrySha256s))) issues.push('the D2-D best PAIR evaluation is not the derived I0 set')
  const newSupportSelected = k3 !== null && d2eI0 !== null && d2eI0.selectedBuildListEntryIds.includes(k3.addedSupportBuildListEntryId)
  const newSupportTargetSelected = newSupport !== null && d2eI0 !== null && d2eI0.selectedTargetWeaponIds.includes(newSupport.supportTargetWeaponId)
  if (k3 !== null && (!newSupportSelected || !newSupportTargetSelected)) issues.push('the new support and its Target are not selected in the D2-E I0 (§1.3)')
  if (k3 !== null && d2eI0 !== null && !k3.supportBuildListEntryIds.every(s => d2eI0.selectedBuildListEntryIds.includes(s))) issues.push('a K3 support is not selected in the D2-E I0')
  const W = D2F_WP_EXPECTED
  if (extended === null || extended.status !== W.status || extended.inputDigest !== W.inputDigest || extended.resultDigest !== W.resultDigest || extended.termination?.status !== W.termination
    || extended.termination.completedTargetCount !== W.completed || extended.termination.totalTargetCount !== W.totalTargetCount || extended.conflictCount !== W.conflicts || extended.steps !== W.steps
    || extended.r5Satisfied !== W.r5Satisfied) issues.push('the D2-E E* evaluation is not the registered §8.2 WP expectation')
  const priorByInputDigest: Record<string, D2FPriorEvaluation[]> = {}
  for (const e of [...d2e.prior, ...d2d.prior.map(x => ({ ...x, source: x.source as D2FPriorEvaluation['source'] })), ...d2c.prior, ...d2.prior.map(x => ({ ...x, source: x.source as D2FPriorEvaluation['source'] }))]) {
    if (e.inputDigest !== null) (priorByInputDigest[e.inputDigest] ??= []).push(e)
  }
  if ((priorByInputDigest[B.inputDigest] ?? []).length !== 4 || !(priorByInputDigest[I.inputDigest] ?? []).some(x => x.source === 'D2-D' && x.evaluationId === I.evaluationId)
    || !(priorByInputDigest[I.inputDigest] ?? []).some(x => x.source === 'D2-E' && x.evaluationId === 'I0') || !(priorByInputDigest[W.inputDigest] ?? []).some(x => x.source === 'D2-E' && x.evaluationId === k3?.extendedEvaluationId)) {
    issues.push('the prior B0 / I0 / WP evaluations are not the registered ones')
  }

  // ---- the Phase 2-C2 baseline summary
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  const partial = { exportSha256: exportSha, e1, k3, k3Derivation, i0, wp, contexts, k2Context, supports, newSupport, registeredReservationBody, registeredNewSupportReservationBody, d2bK0Pool, d2cK1Pool, d2eK2Pool,
    resourceIdentities: { k2Failure, priorT03 }, priorByInputDigest }
  if (issues.length > 0) return fail(partial)
  const expect = (e: D2ED2DEvaluation, id: string): D2EParityExpectation => ({ evaluationId: id, inputDigest: e.inputDigest!, resultDigest: e.resultDigest!, status: e.status, termination: e.termination!.status,
    completed: e.termination!.completedTargetCount, totalTargetCount: e.termination!.totalTargetCount, conflicts: e.conflictCount!, steps: e.steps! })
  return { passed: true, issues, ...partial,
    expected: { b0: expect(b0!, 'B0'), i0: { ...expect(best!, I.evaluationId), resourceConflictRejections: best!.resourceConflictRejections!, supportsSelected, newSupportSelected, newSupportTargetSelected },
      wp: { evaluationId: wp!.evaluationId, inputDigest: W.inputDigest, resultDigest: W.resultDigest, status: W.status, termination: W.termination, completed: W.completed, totalTargetCount: W.totalTargetCount,
        conflicts: W.conflicts, steps: W.steps, r5Satisfied: W.r5Satisfied } },
    phase2c2BaselineSummary: structuredClone(phase2c2) }
}
// ---------------------------------------------------------------- RV (§9.1): the unchanged D2-D RV (RV1 .. RV6) + RV7 + RV8

export interface D2FReverificationTask {
  unitId: string
  /** RV1 .. RV6: the 9 incumbent Candidates and the 3 I0 supports (`runD2DReverification()`, unchanged). */
  d2d: D2DReverificationTask
  /** RV7: the new support X (the §3.2 registered body SHA-256, the §4.2 registered single reservation). */
  newSupport: { supportBuildListEntryId: string; supportBodySha256: string; registeredReservationDigest: string; registeredReservationBody: Json }
  /** RV8: the D2-E K2 Candidate WP evaluates (the D2-E pool row and the D2-E CTX-K2 reservation). */
  wpCandidate: { label: string; ordinal: number; generatedBuildListEntryId: string; targetWeaponId: string; currentBuildListEntryId: string; generatedEntryFile: string; generatedEntryBytes: number;
    generatedEntrySha256: string; searchIdentity: string; keySha256: string; contextReservationDigest: string; contextReservationBody: Json }
  researchMaxPlanSteps: number
}

/** §9.1: the RV task from a passed V (the D2-D RV part is the D2-E one; the D2-C context rows carry the K1 pool values, RV3). */
export function d2fReverificationTask(v: D2FValidatedInputs, d2cContexts: readonly D2ED2CContextRow[]): D2FReverificationTask {
  if (!v.passed || v.i0 === null || v.wp?.k2 == null || v.k2Context === null || v.newSupport === null || v.registeredNewSupportReservationBody === null) throw new Error('RV needs a passed V')
  const k2 = v.wp.k2
  return {
    unitId: D2F_RV_UNIT_ID,
    d2d: {
      unitId: D2F_RV_UNIT_ID,
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
      researchMaxPlanSteps: D2F_RESEARCH_MAX_PLAN_STEPS,
    },
    newSupport: { supportBuildListEntryId: v.newSupport.supportBuildListEntryId, supportBodySha256: v.newSupport.supportBodySha256, registeredReservationDigest: D2F_NEW_SUPPORT_RESERVATION_DIGEST,
      registeredReservationBody: structuredClone(v.registeredNewSupportReservationBody) },
    wpCandidate: { label: k2.label, ordinal: k2.ordinal, generatedBuildListEntryId: k2.generatedBuildListEntryId, targetWeaponId: k2.targetWeaponId, currentBuildListEntryId: k2.currentBuildListEntryId,
      generatedEntryFile: k2.file, generatedEntryBytes: k2.bytes, generatedEntrySha256: k2.sha256, searchIdentity: k2.searchIdentity, keySha256: k2.keySha256,
      contextReservationDigest: v.k2Context.reservationDigest, contextReservationBody: structuredClone(v.k2Context.reservationBody) },
    researchMaxPlanSteps: D2F_RESEARCH_MAX_PLAN_STEPS,
  }
}

export interface D2FRv7Result { exportBodies: number; bodySha256Expected: string; bodySha256Observed: string | null; bodyMatched: boolean; digestExpected: string; digestObserved: string | null; digestMatched: boolean;
  reservationBodyObserved: Json | null; reservationBodyMatched: boolean; satisfied: boolean }
export interface D2FRv8Result {
  generatedEntry: { file: string; bytesExpected: number; bytesObserved: number | null; sha256Expected: string; sha256Observed: string | null }
  bodySha256Matched: boolean; idMatched: boolean; targetMatched: boolean; calculationContextMatched: boolean; notStale: boolean; searchRunIdMatched: boolean; keySha256Matched: boolean
  replacement: { status: string; replacedBuildListEntryId: string | null; satisfied: boolean }
  r0: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  satisfied: boolean
}
export type D2FReverificationResult = Omit<D2DReverificationResult, 'status'> & { status: 'verified' | 'guardrail_violation'; d2dStatus: D2DReverificationResult['status'];
  newSupport: { supportBuildListEntryId: string; RV7: D2FRv7Result }; wpCandidate: { generatedBuildListEntryId: string; RV8: D2FRv8Result } }

/**
 * RV (§9.1): `runD2DReverification()` unchanged for RV1 .. RV6, then RV7 (the new support Export body and its single
 * reservation against the §3.2 / §4.2 registered values) and RV8 (the WP K2 G store body, its replacement and its R0 against the
 * D2-E CTX-K2 reservation). No Search, no full run. Any failure is a guardrail violation.
 */
export function runD2FReverification(input: PlannerInput, exportBuildListEntries: readonly unknown[], schedule: Phase2C26B2C1Schedule, task: D2FReverificationTask, bodies: readonly unknown[],
  observedSha256s: readonly string[], wpBody: unknown, wpObserved: D2EObservedFile | null, dependencies: PlannerDependencies, sha256OfText: (text: string) => string): D2FReverificationResult {
  const d2d = runD2DReverification(input, exportBuildListEntries, schedule, task.d2d, bodies, observedSha256s, dependencies, sha256OfText)
  const issues: string[] = [...d2d.issues, ...d2fPolicyDrift()]
  if (task.unitId !== D2F_RV_UNIT_ID || task.researchMaxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS) issues.push('the RV task is not the registered RV')
  const engine = dependencies.rngEngine
  // RV7
  const ns = task.newSupport
  const exportBodies = exportBuildListEntries.filter(e => isObject(e) && e.id === ns.supportBuildListEntryId)
  const nsBody = exportBodies.length === 1 ? exportBodies[0] as BuildListEntry : null
  const bodySha256Observed = nsBody === null ? null : sha256OfText(stableStringify(nsBody))
  const derived = nsBody === null ? null : derivePlannerAlternativeReservation([nsBody], engine)
  const digestObserved = derived === null ? null : hashStableValue(derived)
  const RV7: D2FRv7Result = { exportBodies: exportBodies.length, bodySha256Expected: ns.supportBodySha256, bodySha256Observed, bodyMatched: bodySha256Observed !== null && bodySha256Observed === ns.supportBodySha256,
    digestExpected: ns.registeredReservationDigest, digestObserved, digestMatched: digestObserved === ns.registeredReservationDigest,
    reservationBodyObserved: derived === null ? null : structuredClone(derived) as unknown as Json,
    reservationBodyMatched: derived !== null && isObject(ns.registeredReservationBody) && stableStringify(derived) === stableStringify(ns.registeredReservationBody), satisfied: false }
  RV7.satisfied = RV7.exportBodies === 1 && RV7.bodyMatched && RV7.digestMatched && RV7.reservationBodyMatched
  if (!RV7.satisfied) issues.push(`${ns.supportBuildListEntryId}: RV7 does not hold`)
  // RV8
  const w = task.wpCandidate
  const body = isObject(wpBody) ? wpBody as unknown as BuildListEntry : null
  const snapshot = body !== null && isObject(body.candidateSnapshot) ? body.candidateSnapshot : null
  let keySha: string | null
  try { keySha = snapshot === null ? null : sha256OfText(candidateStableKey(snapshot)) } catch { keySha = null }
  const replacement = body === null ? null : resolveBuildListEntryReplacement(input.buildListEntries, body)
  let r0: D2FRv8Result['r0'] = { respects: false, blockedHits: {}, exclusiveHit: [] }
  if (body !== null && snapshot !== null && isObject(w.contextReservationBody) && hashStableValue(w.contextReservationBody) === w.contextReservationDigest) {
    const r = respectsPhase2C2Reservation(summarizePhase2C2Entry(body, input, engine), body.candidateSnapshot.route, w.contextReservationBody as never)
    r0 = { respects: r.respects, blockedHits: structuredClone(r.blockedHits), exclusiveHit: [...r.exclusiveHit] }
  }
  const RV8: D2FRv8Result = {
    generatedEntry: { file: w.generatedEntryFile, bytesExpected: w.generatedEntryBytes, bytesObserved: wpObserved?.bytes ?? null, sha256Expected: w.generatedEntrySha256, sha256Observed: wpObserved?.sha256 ?? null },
    bodySha256Matched: wpObserved !== null && wpObserved.sha256 === w.generatedEntrySha256 && wpObserved.bytes === w.generatedEntryBytes, idMatched: body?.id === w.generatedBuildListEntryId,
    targetMatched: body?.targetWeaponId === w.targetWeaponId, calculationContextMatched: body !== null && same(body.calculationContext, D2F_CALCULATION_CONTEXT), notStale: body?.isStale === false,
    searchRunIdMatched: snapshot !== null && snapshot.searchRunId === w.searchIdentity, keySha256Matched: keySha === w.keySha256,
    replacement: replacement === null ? { status: 'no_body', replacedBuildListEntryId: null, satisfied: false }
      : replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId as string, satisfied: replacement.replacement.replacedBuildListEntryId === w.currentBuildListEntryId }
        : { status: replacement.status, replacedBuildListEntryId: null, satisfied: false },
    r0, satisfied: false }
  RV8.satisfied = RV8.bodySha256Matched && RV8.idMatched && RV8.targetMatched && RV8.calculationContextMatched && RV8.notStale && RV8.searchRunIdMatched && RV8.keySha256Matched && RV8.replacement.satisfied && RV8.r0.respects
  if (!RV8.satisfied) issues.push(`${w.generatedBuildListEntryId}: RV8 does not hold`)
  return { ...d2d, status: issues.length === 0 && d2d.status === 'verified' ? 'verified' : 'guardrail_violation', d2dStatus: d2d.status, unitId: task.unitId,
    newSupport: { supportBuildListEntryId: ns.supportBuildListEntryId, RV7 }, wpCandidate: { generatedBuildListEntryId: w.generatedBuildListEntryId, RV8 }, issues }
}

// ---------------------------------------------------------------- CTX-K3 (§5.1)

export interface D2FK1ContextReference { supportBuildListEntryId: string; k: number; contextId: string; recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeySha256s: string[] }
export interface D2FContextTask {
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  /** S (Entry ID ascending, 3). */
  supportBuildListEntryIds: string[]
  /** X (the new support). */
  newSupportBuildListEntryId: string
  /** The E1 Targets and their `O_t` (C1, from D2 RESULT discovery.targets). */
  e1TargetWeaponIds: string[]
  e1CurrentBuildListEntryIds: string[]
  registeredReservationDigest: string
  /** The §1.6 / §4.1 registered body (a JSON object). */
  registeredReservationBody: Json
  registeredNewSupportReservationDigest: string
  /** The §1.6 / §4.2 registered body (a JSON object). */
  registeredNewSupportReservationBody: Json
  /** The K1 CTX records of the K3 Target (CTX-3 / CTX-4: C4 / C6(b)). */
  k1Contexts: D2FK1ContextReference[]
  /** Every K1 CTX record of the K2 supports (C8: CTX-3 / CTX-5 and CTX-1 / CTX-4 / CTX-7). */
  k1SupportRecords: D2FK1ContextReference[]
  /** The D2-E CTX-K2 record (C4 / C6(a)). */
  k2Context: { recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeySha256s: string[] }
  /** The §8.5 / §5.1 diagnostic resource identities (Skill 648 / Gogma 125 / Skill 344 / Skill 341 / Gogma 71). */
  registeredResourceIdentities: string[]
  researchMaxPlanSteps: number
}
export interface D2FContextChecks {
  C1: { satisfied: boolean; issues: string[] }
  C2: { satisfied: boolean; issues: string[] }
  C3: { satisfied: boolean; referencedOwnedWeaponIds: string[]; exclusiveConsumedOwnedWeaponIds: string[]; exclusiveOwnedWeaponIds: string[]; routeUnitRejections: number }
  C4: { satisfied: boolean; issues: string[] }
  C5: { state: 'matched' | 'mismatched'; expectedDigest: string; observedDigest: string | null; digestMatched: boolean; bodyMatched: boolean }
  C6: { satisfied: boolean; k2Contained: boolean; perSupport: { supportBuildListEntryId: string; k: number; contained: boolean }[]; newSupportContained: boolean }
  C7: { satisfied: boolean; permutations: { order: string[]; digest: string | null; bodyMatched: boolean }[] }
  C8: { state: 'matched' | 'mismatched'; expectedDigest: string; observedDigest: string | null; bodyMatched: boolean; existingSupportsMatched: boolean;
    perExistingSupport: { supportBuildListEntryId: string; k: number; digestMatched: boolean; bodyMatched: boolean }[] }
}
export interface D2FRegisteredResource { resourceIdentity: string; counterStream: string | null; counterBefore: number | null; held: boolean | null; blocked: boolean | null }
export interface D2FContextRecord {
  status: 'context_ready' | 'guardrail_violation'
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  currentBuildListEntryId: string
  supportBuildListEntryIds: string[]
  newSupportBuildListEntryId: string
  supportTargetWeaponIds: (string | null)[]
  supportBodySha256s: Record<string, string>
  /** The derived `PlannerAlternativeReservation` as a JSON object (`structuredClone`, never a string; §5.1). */
  reservationBody: Json | null
  reservationDigest: string | null
  /** derivePlannerAlternativeReservation([Export body of s]) for every s in S (JSON objects). */
  singleSupportReservations: Record<string, { reservationBody: Json; reservationDigest: string }>
  originDigest: string | null
  scheduleOriginDigest: string
  excludedRouteKeys: string[]
  excludedRouteKeySha256s: string[]
  scheduleExcludedRouteKeys: string[]
  conflictContextCount: number | null
  checks: D2FContextChecks
  diagnostics: { equalsK1ComponentwiseUnion: boolean | null; equalsK2UnionNewSupport: boolean | null; registeredResources: D2FRegisteredResource[] }
  issues: string[]
}

/** The six orders of a three-element support set (C7). */
export const d2fPermutations = (s: readonly string[]): string[][] => s.length <= 1 ? [[...s]] : s.flatMap((x, i) => d2fPermutations([...s.slice(0, i), ...s.slice(i + 1)]).map(rest => [x, ...rest]))

/** §5.1 `registeredResources`: whether each resource identity's position is held / blocked in a reservation body (diagnostic). */
export function d2fRegisteredResources(reservationBody: unknown, identities: readonly string[]): D2FRegisteredResource[] {
  return identities.map(resourceIdentity => {
    let parsed: Json | null
    try { const v: unknown = JSON.parse(resourceIdentity); parsed = isObject(v) ? v : null } catch { parsed = null }
    const counterStream = parsed !== null && typeof parsed.counterStream === 'string' ? parsed.counterStream : null
    const counterBefore = parsed !== null && typeof parsed.counterBefore === 'number' ? parsed.counterBefore : null
    const stream = isObject(reservationBody) && counterStream !== null && isObject(reservationBody[counterStream]) ? reservationBody[counterStream] as Json : null
    const has = (list: unknown) => Array.isArray(list) && counterBefore !== null ? list.includes(counterBefore) : null
    return { resourceIdentity, counterStream, counterBefore, held: stream === null ? null : has(stream.held), blocked: stream === null ? null : has(stream.blocked) }
  })
}

/**
 * CTX-K3 (§5.1): the K3 context record from Production parts only - the B2-C1 schedule (origin digest, current Route key, policy
 * drift), `phase2c27bResolveSupportContext(baseline, t03, S)` over the three Export support bodies, the three single support
 * reservations, the support Routes and their unit plans for C3 - with C1 .. C8. No Search and no full run. C1 .. C4 / C6 / C7 and
 * the C8 existing-support equality failing is a guardrail violation; C5 and the C8 new-support value are the `k3_context_registered`
 * / `k1_new_support_registered` parities (a mismatch is INVALID).
 */
export function prepareD2FContextRecord(input: PlannerInput, schedule: Phase2C26B2C1Schedule, exportBuildListEntries: readonly unknown[], task: D2FContextTask, dependencies: PlannerDependencies,
  sha256OfText: (text: string) => string): D2FContextRecord {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule), ...d2fPolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (task.unitId !== D2F_CONTEXT_UNIT_ID || task.contextId !== d2fContextId(task.label, task.supportBuildListEntryIds)) issues.push('unitId / contextId')
  if (!isObject(task.registeredReservationBody) || !isObject(task.registeredNewSupportReservationBody) || !isObject(task.k2Context.reservationBody)) issues.push('a registered / CTX-K2 reservation body is not a JSON object')
  const engine = dependencies.rngEngine
  const S = [...task.supportBuildListEntryIds]
  // C1
  const c1: string[] = []
  if (S.length !== D2F_SUPPORTS_PER_CONTEXT || new Set(S).size !== D2F_SUPPORTS_PER_CONTEXT || !same(S, sortedIds(S))) c1.push('S is not 3 distinct Entry IDs in ascending order')
  if (!S.includes(task.newSupportBuildListEntryId)) c1.push('the new support is not in S')
  if (task.e1TargetWeaponIds.length !== D2E_D2_PROVENANCE.e1Targets || task.e1CurrentBuildListEntryIds.length !== D2E_D2_PROVENANCE.e1Targets || !task.e1TargetWeaponIds.includes(task.targetWeaponId)) c1.push('the E1 lists are not the 11 D2 RESULT Targets')
  const bodies: (Json | null)[] = S.map(sId => {
    const found = exportBuildListEntries.filter(e => isObject(e) && e.id === sId) as Json[]
    if (found.length !== 1) { c1.push(`${found.length} Export Entries hold ${sId}`); return null }
    const target = typeof found[0]!.targetWeaponId === 'string' ? found[0]!.targetWeaponId : null
    if (target === null || task.e1TargetWeaponIds.includes(target) || target === task.targetWeaponId) c1.push(`the Target of ${sId} is not outside E1`)
    if (sId.startsWith(D2F_GENERATED_ENTRY_PREFIX)) c1.push(`${sId} is a generated Entry`)
    if (task.e1CurrentBuildListEntryIds.includes(sId)) c1.push(`${sId} is an E1 O_t`)
    return found[0]!
  })
  const supportTargetWeaponIds = bodies.map(b => b !== null && typeof b.targetWeaponId === 'string' ? b.targetWeaponId : null)
  if (supportTargetWeaponIds.every(t => t !== null) && new Set(supportTargetWeaponIds).size !== S.length) c1.push('the support Targets are not distinct')
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
  // The single support reservations (C6 / C8).
  const singleSupportReservations: Record<string, { reservationBody: Json; reservationDigest: string }> = {}
  S.forEach((sId, i) => {
    const b = bodies[i]
    if (b === null || b === undefined) return
    const single = derivePlannerAlternativeReservation([b as unknown as BuildListEntry], engine)
    singleSupportReservations[sId] = { reservationBody: structuredClone(single) as unknown as Json, reservationDigest: hashStableValue(single) }
  })
  // C3
  const referenced = sortedIds([...new Set(bodies.flatMap(b => b !== null && isObject(b.candidateSnapshot) && isObject(b.candidateSnapshot.route)
    ? collectReferencedOwnedWeaponIds((b as unknown as BuildListEntry).candidateSnapshot.route).map(String) : []))])
  const plans = bodies.every(b => b !== null) ? createPlannerRouteUnitPlans(bodies as unknown as BuildListEntry[], engine) : null
  const consumed = plans === null ? [] : sortedIds([...new Set(S.flatMap(sId => [...(plans.unitPlans.get(sId as BuildListEntryId) ?? [])].map(u => u.exclusiveConsumedOwnedWeaponId)
    .filter((x): x is NonNullable<typeof x> => x !== null).map(String)))])
  const exclusive = reservation === null ? [] : sortedIds(reservation.exclusiveOwnedWeaponIds.map(String))
  const c3 = reservation !== null && plans !== null && plans.rejections.length === 0 && [...referenced, ...consumed].every(id => exclusive.includes(id))
  // C4
  const c4: string[] = []
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const originDigest = prepared === null ? null : hashStableValue(prepared.origin)
  if (originDigest !== schedule.snapshot.originDigest) c4.push('the Planner-start origin does not hash to the schedule snapshot origin digest')
  const k2Supports = S.filter(s => s !== task.newSupportBuildListEntryId)
  if (task.k1Contexts.length !== 2 || !same(task.k1Contexts.map(c => c.supportBuildListEntryId).sort(compare), k2Supports)) c4.push('the K1 CTX records are not one per K2 support')
  for (const k1 of task.k1Contexts) if (k1.originDigest !== originDigest) c4.push(`the origin digest is not the CTX-${k1.k} originDigest`)
  if (task.k2Context.originDigest !== originDigest) c4.push('the origin digest is not the D2-E CTX-K2 originDigest')
  const keySha = prepared === null ? [] : prepared.excludedRouteKeys.map(sha256OfText)
  if (!snapshotTarget) c4.push('the Target is not a schedule snapshot Target')
  else if (prepared !== null) {
    if (snapshotTarget.currentBuildListEntryId !== task.currentBuildListEntryId) c4.push('the schedule current Entry is not O_t')
    if (prepared.excludedRouteKeys.length !== 1 || prepared.excludedRouteKeys[0] !== candidateStableKey(prepared.invalidated.candidateSnapshot)
      || prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) c4.push('excludedRouteKeys is not [candidateStableKey(O_t)] (the schedule ones)')
    for (const k1 of task.k1Contexts) if (!same(k1.excludedRouteKeySha256s, keySha)) c4.push(`the excluded Route key SHA-256 is not the CTX-${k1.k} excludedRouteKeySha256s`)
    if (!same(task.k2Context.excludedRouteKeySha256s, keySha)) c4.push('the excluded Route key SHA-256 is not the D2-E CTX-K2 excludedRouteKeySha256s')
  }
  const reservationBody = reservation === null ? null : structuredClone(reservation) as unknown as Json
  const reservationDigest = reservation === null ? null : hashStableValue(reservation)
  // C5 (parity)
  const digestMatched = reservationDigest === task.registeredReservationDigest
  const bodyMatched = reservationBody !== null && isObject(task.registeredReservationBody) && stableStringify(reservationBody) === stableStringify(task.registeredReservationBody)
  const C5 = { state: (digestMatched && bodyMatched ? 'matched' : 'mismatched') as 'matched' | 'mismatched', expectedDigest: task.registeredReservationDigest, observedDigest: reservationDigest, digestMatched, bodyMatched }
  // C6
  const contains = (inner: unknown) => reservationBody !== null && isObject(inner) && d2eReservationContains(reservationBody, inner)
  const perSupport = task.k1Contexts.map(k1 => ({ supportBuildListEntryId: k1.supportBuildListEntryId, k: k1.k, contained: contains(k1.reservationBody) }))
  const newSingle = singleSupportReservations[task.newSupportBuildListEntryId] ?? null
  const C6 = { satisfied: false, k2Contained: contains(task.k2Context.reservationBody), perSupport, newSupportContained: newSingle !== null && contains(newSingle.reservationBody) }
  C6.satisfied = C6.k2Contained && perSupport.length === 2 && perSupport.every(x => x.contained) && C6.newSupportContained
  // C7
  const permutations = d2fPermutations(S).map(order => {
    const r = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, order)
    return { order, digest: r.status === 'ready' ? hashStableValue(r.prepared.reservation) : null, bodyMatched: r.status === 'ready' && reservation !== null && stableStringify(r.prepared.reservation) === stableStringify(reservation) }
  })
  const C7 = { satisfied: reservation !== null && permutations.length === 6 && permutations.every(p => p.digest === reservationDigest && p.bodyMatched), permutations }
  // C8
  const newBodyMatched = newSingle !== null && isObject(task.registeredNewSupportReservationBody) && stableStringify(newSingle.reservationBody) === stableStringify(task.registeredNewSupportReservationBody)
  const perExistingSupport = task.k1SupportRecords.map(r => {
    const single = singleSupportReservations[r.supportBuildListEntryId] ?? null
    return { supportBuildListEntryId: r.supportBuildListEntryId, k: r.k, digestMatched: single !== null && single.reservationDigest === r.reservationDigest,
      bodyMatched: single !== null && isObject(r.reservationBody) && stableStringify(single.reservationBody) === stableStringify(r.reservationBody) }
  })
  const C8 = { state: (newSingle !== null && newSingle.reservationDigest === task.registeredNewSupportReservationDigest && newBodyMatched ? 'matched' : 'mismatched') as 'matched' | 'mismatched',
    expectedDigest: task.registeredNewSupportReservationDigest, observedDigest: newSingle?.reservationDigest ?? null, bodyMatched: newBodyMatched,
    existingSupportsMatched: k2Supports.every(s => perExistingSupport.some(x => x.supportBuildListEntryId === s)) && perExistingSupport.every(x => x.digestMatched && x.bodyMatched), perExistingSupport }
  const checks: D2FContextChecks = { C1: { satisfied: c1.length === 0, issues: c1 }, C2: { satisfied: c2.length === 0, issues: c2 },
    C3: { satisfied: c3, referencedOwnedWeaponIds: referenced, exclusiveConsumedOwnedWeaponIds: consumed, exclusiveOwnedWeaponIds: exclusive, routeUnitRejections: plans?.rejections.length ?? 0 },
    C4: { satisfied: c4.length === 0, issues: c4 }, C5, C6, C7, C8 }
  const singles = S.map(s => singleSupportReservations[s]?.reservationBody).filter((x): x is Json => x !== undefined)
  const equalsK1ComponentwiseUnion = singles.length !== S.length || reservationBody === null ? null : stableStringify(d2eReservationUnion(singles)) === stableStringify(reservationBody)
  const equalsK2UnionNewSupport = newSingle === null || reservationBody === null || !isObject(task.k2Context.reservationBody) ? null
    : stableStringify(d2eReservationUnion([task.k2Context.reservationBody, newSingle.reservationBody])) === stableStringify(reservationBody)
  const ready = issues.length === 0 && checks.C1.satisfied && checks.C2.satisfied && checks.C3.satisfied && checks.C4.satisfied && checks.C6.satisfied && checks.C7.satisfied && checks.C8.existingSupportsMatched
  return { status: ready ? 'context_ready' : 'guardrail_violation', unitId: task.unitId, contextId: task.contextId, label: task.label, targetWeaponId: task.targetWeaponId,
    currentBuildListEntryId: task.currentBuildListEntryId, supportBuildListEntryIds: S, newSupportBuildListEntryId: task.newSupportBuildListEntryId, supportTargetWeaponIds,
    supportBodySha256s: Object.fromEntries(S.map((sId, i) => [sId, bodies[i] === null ? '' : sha256OfText(stableStringify(bodies[i]))])),
    reservationBody, reservationDigest, singleSupportReservations, originDigest, scheduleOriginDigest: schedule.snapshot.originDigest, excludedRouteKeys: prepared === null ? [] : [...prepared.excludedRouteKeys],
    excludedRouteKeySha256s: keySha, scheduleExcludedRouteKeys: snapshotTarget ? [...snapshotTarget.excludedRouteKeys] : [], conflictContextCount: prepared === null ? null : prepared.conflictContexts.length, checks,
    diagnostics: { equalsK1ComponentwiseUnion, equalsK2UnionNewSupport, registeredResources: d2fRegisteredResources(reservationBody, task.registeredResourceIdentities) }, issues }
}

/** §5.1: a CTX-K3 record read back from its file: `result` with `reservationBody` and every single reservation body a JSON object (never a string), or the issue. */
export function readD2FK3ContextRecord(json: unknown): { record: D2FContextRecord | null; issue: string | null } {
  const result = isObject(json) && isObject(json.result) ? json.result : null
  if (result === null) return { record: null, issue: 'the context record has no result' }
  if (result.status === 'context_ready') {
    if (!isObject(result.reservationBody)) return { record: null, issue: `reservationBody is ${result.reservationBody === null ? 'null' : Array.isArray(result.reservationBody) ? 'an array' : typeof result.reservationBody}, not a JSON object` }
    if (typeof result.reservationDigest !== 'string' || !isObject(result.supportBodySha256s) || typeof result.originDigest !== 'string' || !Array.isArray(result.excludedRouteKeys) || !isObject(result.checks)
      || !isObject(result.singleSupportReservations)) return { record: null, issue: 'the context record lacks reservationDigest / supportBodySha256s / originDigest / excludedRouteKeys / checks / singleSupportReservations' }
    for (const [s, v] of Object.entries(result.singleSupportReservations)) {
      if (!isObject(v) || !isObject(v.reservationBody) || typeof v.reservationDigest !== 'string') return { record: null, issue: `singleSupportReservations[${s}].reservationBody is not a JSON object` }
    }
  }
  return { record: result as unknown as D2FContextRecord, issue: null }
}

// ---------------------------------------------------------------- DSC (§5.2 - §5.7)

export type D2FDiscoveryUnitStatus = D2DiscoveryMeasuredStatus | 'discovery_calculation_error' | 'guardrail_violation' | 'timeout' | 'out_of_memory' | 'process_failure' | 'interrupted' | 'not_executed'
export const D2F_DISCOVERY_MEASURED: readonly D2FDiscoveryUnitStatus[] = ['discovery_cap_reached', 'stopped_by_search_extent_bound', 'discovery_exhausted', 'ladder_exhausted']
export type D2FDiscoveryStop = 'discovery_cap_reached' | 'discovery_exhausted' | 'ladder_exhausted' | 'unmeasured' | 'not_executed'

/** §5.4: after one unit, the next rung or the discovery stop (K3_POOL_CAP = 2). */
export function d2fDiscoveryNext(status: D2FDiscoveryUnitStatus, rung: Phase2C27BRungId, poolSize: number): { next: Phase2C27BRungId | null; stop: D2FDiscoveryStop | null } {
  if (status === 'discovery_cap_reached' || status === 'discovery_exhausted' || status === 'ladder_exhausted') return { next: null, stop: status }
  if (status === 'stopped_by_search_extent_bound') {
    if (poolSize >= D2F_K3_POOL_CAP) throw new D1InvariantError('an extent-bound unit with a full pool')
    const next = PHASE2C27B_RUNG_IDS[PHASE2C27B_RUNG_IDS.indexOf(rung) + 1] ?? null
    return next === null ? { next: null, stop: 'ladder_exhausted' } : { next, stop: null }
  }
  if (status === 'not_executed') return { next: null, stop: 'not_executed' }
  return { next: null, stop: 'unmeasured' }
}
/** The discovery outcome of §13 (`discovery.outcome`) from the stop. */
export const d2fDiscoveryOutcome = (stop: D2FDiscoveryStop | null): 'cap_reached' | 'ladder_exhausted' | 'discovery_exhausted' | 'unmeasured' =>
  stop === 'discovery_cap_reached' ? 'cap_reached' : stop === 'ladder_exhausted' ? 'ladder_exhausted' : stop === 'discovery_exhausted' ? 'discovery_exhausted' : 'unmeasured'

export interface D2FSingleReservationRef { supportBuildListEntryId: string; source: 'ctx_k3_single' | 'k1_ctx_record'; k: number | null; reservationBody: Json }
export interface D2FDiscoveryTask {
  unitId: string
  contextId: string
  label: string
  targetWeaponId: string
  supportBuildListEntryIds: string[]
  currentBuildListEntryId: string
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  /** The CTX-K3 record values the re-derived context must equal (context drift, §5.2). */
  context: { recordSha256: string; reservationBody: Json; reservationDigest: string; originDigest: string; excludedRouteKeys: string[] }
  /** R0-K2: the D2-E CTX-K2 reservationBody. */
  k2Reservation: { reservationBody: Json; reservationDigest: string }
  /** R0-split: one single reservation per support (the new support from CTX-K3, CTX-3 / CTX-4). */
  singleReservations: D2FSingleReservationRef[]
  /** `candidateStableKey()` of every pooled Candidate before this unit, in discovery order. */
  poolKeysAtStart: string[]
  /** D-4 / D-5 / D-6: the D2-B K0, D2-C K1 and D2-E K2 pools of the Target. */
  d2bK0Pool: { ordinal: number; keySha256: string }[]
  d2cK1Pool: { ordinal: number; contextId: string; keySha256: string }[]
  d2eK2Pool: { ordinal: number; keySha256: string }[]
  poolCap: number
  researchMaxPlanSteps: number
}

export type D2FDeliveryAction = 'pooled' | 'duplicate_of_lower_rung' | 'same_key_as_d2b_k0_pool' | 'same_key_as_d2c_k1_pool' | 'same_key_as_d2e_k2_pool'
export interface D2FDiscoveryDelivery {
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  action: D2FDeliveryAction
  r0K3: boolean
  r0K2: boolean
  r0Split: Record<string, boolean>
  matchedD2bOrdinal: number | null
  matchedD2cK1: { ordinal: number; contextId: string } | null
  matchedD2eK2Ordinal: number | null
}
export interface D2FPooledCandidate {
  /** 1-based index in the context pool (rung, then delivery order). */
  indexInContext: number
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  r0K3: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  r0K2: boolean
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
export type D2FDiscoveryChildResult =
  | { status: D2DiscoveryMeasuredStatus; unitId: string; contextId: string; rung: Phase2C27BRungId; poolSizeAtStart: number; deliveries: D2FDiscoveryDelivery[]; pooled: D2FPooledCandidate[]; searchIdentity: string;
      observedContext: { reservationDigest: string; originDigest: string; excludedRouteKeys: string[]; currentBuildListEntryId: string; supportBuildListEntryIds: string[] };
      search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean; skippedExcludedRouteKeys: number };
      timing: { searchVisitMs: number; materializeMs: number; searchOnlyMs: number } }
  | { status: 'discovery_calculation_error'; unitId: string; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; unitId: string; issues: string[] }

/**
 * One discovery unit (§5.2): re-derives the K3 context and checks it against the CTX-K3 record (context drift), then runs the
 * unchanged Production Search at the rung extent with the K3 reservation and the current Route excluded (no capture policy, no
 * reordering). Each delivery: R0-K3, R0-K2 and R0-split (guardrail), D-1 (guardrail), D-2 / D-4 / D-5 / D-6, otherwise
 * materialized against the baseline Entries and pooled until the pool holds 2. No trial runs. Typed Search / materialization
 * errors become `discovery_calculation_error`.
 */
export async function runD2FDiscoveryUnit(input: PlannerInput, task: D2FDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2FDiscoveryChildResult> {
  try {
    return await discover(input, task, dependencies, options)
  } catch (error) {
    if (error instanceof D1InvariantError) return { status: 'guardrail_violation', unitId: task.unitId, issues: [error.message] }
    const e = error instanceof Error ? error : new Error(String(error))
    return { status: 'discovery_calculation_error', unitId: task.unitId, error: { name: e.name, message: e.message.slice(0, 4000) } }
  }
}

async function discover(input: PlannerInput, task: D2FDiscoveryTask, dependencies: PlannerDependencies,
  options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2FDiscoveryChildResult> {
  const now = options.now ?? (() => performance.now())
  const sha = options.sha256OfText
  const issues: string[] = [...d2fPolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, d2fRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (task.unitId !== d2fDiscoveryUnitId(task.rung) || task.contextId !== d2fContextId(task.label, task.supportBuildListEntryIds)) issues.push('unitId / contextId')
  if (task.supportBuildListEntryIds.length !== D2F_SUPPORTS_PER_CONTEXT || !same(task.supportBuildListEntryIds, sortedIds(task.supportBuildListEntryIds))) issues.push('S is not 3 Entry IDs in ascending order')
  if (task.poolCap !== D2F_K3_POOL_CAP || task.poolKeysAtStart.length >= D2F_K3_POOL_CAP || new Set(task.poolKeysAtStart).size !== task.poolKeysAtStart.length) issues.push('the pool at start is not below K3_POOL_CAP and distinct')
  if (!isObject(task.context.reservationBody)) issues.push('the CTX-K3 reservationBody is not a JSON object')
  if (!isObject(task.k2Reservation.reservationBody) || hashStableValue(task.k2Reservation.reservationBody) !== task.k2Reservation.reservationDigest) issues.push('the R0-K2 reservation is not the CTX-K2 JSON object')
  if (task.singleReservations.length !== D2F_SUPPORTS_PER_CONTEXT || !same(task.singleReservations.map(r => r.supportBuildListEntryId).sort(compare), task.supportBuildListEntryIds)
    || task.singleReservations.some(r => !isObject(r.reservationBody))) issues.push('the R0-split reservations are not one JSON object per support')
  if (issues.length > 0) return { status: 'guardrail_violation', unitId: task.unitId, issues }
  // Context drift (§5.2): the re-derived context must be the CTX-K3 record one (both reservation sides objects).
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, task.supportBuildListEntryIds)
  if (resolved.status !== 'ready') return { status: 'guardrail_violation', unitId: task.unitId, issues: ['context_drift: the K3 context is not ready', ...resolved.issues] }
  const prepared = resolved.prepared
  const drift: string[] = []
  if (stableStringify(prepared.reservation) !== stableStringify(task.context.reservationBody)) drift.push('the reservation body differs from the CTX-K3 record')
  if (hashStableValue(prepared.reservation) !== task.context.reservationDigest) drift.push('the reservation digest differs from the CTX-K3 record')
  if (hashStableValue(prepared.origin) !== task.context.originDigest) drift.push('the origin digest differs from the CTX-K3 record')
  if (!same(prepared.excludedRouteKeys, task.context.excludedRouteKeys)) drift.push('excludedRouteKeys differ from the CTX-K3 record')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) drift.push('O_t differs from the CTX-K3 record')
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
  const d2e = new Map(task.d2eK2Pool.map(p => [p.keySha256, p.ordinal]))
  const poolSizeAtStart = task.poolKeysAtStart.length
  const seen = new Set<string>()
  const deliveries: D2FDiscoveryDelivery[] = []
  const pooled: D2FPooledCandidate[] = []
  let materializeMs = 0
  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, async (candidate: PlannerAlternativeCandidate) => {
    const indexInUnit = deliveries.length
    if (indexInUnit >= D2F_DELIVERIES_PER_UNIT_MAX) throw new D1InvariantError(`delivery ${indexInUnit} is above the ${D2F_DELIVERIES_PER_UNIT_MAX} deliveries of one unit`)
    const key = candidateStableKey(candidate)
    const keySha256 = sha(key)
    if (seen.has(key)) throw new D1InvariantError(`D-1: delivery ${indexInUnit} repeats a key of this unit`)
    seen.add(key)
    const started = now()
    const summary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(candidate, []).entry, input, engine)
    const r0 = respectsPhase2C2Reservation(summary, candidate.route, prepared.reservation)
    if (!r0.respects) throw new D1InvariantError(`R0-K3: delivery ${indexInUnit} does not respect the K3 reservation`)
    const r0K2 = respectsPhase2C2Reservation(summary, candidate.route, task.k2Reservation.reservationBody as never).respects
    if (!r0K2) throw new D1InvariantError(`R0-K2: delivery ${indexInUnit} does not respect the D2-E K2 reservation (an invariant: C6 makes R0-K3 imply R0-K2)`)
    const r0Split = Object.fromEntries(task.singleReservations.map(r => [r.supportBuildListEntryId, respectsPhase2C2Reservation(summary, candidate.route, r.reservationBody as never).respects]))
    if (!Object.values(r0Split).every(Boolean)) throw new D1InvariantError(`R0-split: delivery ${indexInUnit} does not respect a single support reservation (an invariant: C6 makes R0-K3 imply R0-split)`)
    const base = { indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, r0K3: true, r0K2: true, r0Split, matchedD2bOrdinal: null, matchedD2cK1: null, matchedD2eK2Ordinal: null }
    if (prior.has(key)) {
      deliveries.push({ ...base, action: 'duplicate_of_lower_rung' })
      materializeMs += now() - started
      return 'continue'
    }
    const d2bOrdinal = d2b.get(keySha256)
    if (d2bOrdinal !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2b_k0_pool', matchedD2bOrdinal: d2bOrdinal })
      materializeMs += now() - started
      return 'continue'
    }
    const d2cMatch = d2c.get(keySha256)
    if (d2cMatch !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2c_k1_pool', matchedD2cK1: { ...d2cMatch } })
      materializeMs += now() - started
      return 'continue'
    }
    const d2eOrdinal = d2e.get(keySha256)
    if (d2eOrdinal !== undefined) {
      deliveries.push({ ...base, action: 'same_key_as_d2e_k2_pool', matchedD2eK2Ordinal: d2eOrdinal })
      materializeMs += now() - started
      return 'continue'
    }
    const generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    const replacement = resolveBuildListEntryReplacement(input.buildListEntries, generated.entry)
    materializeMs += now() - started
    pooled.push({ indexInContext: poolSizeAtStart + pooled.length + 1, indexInUnit, candidateStableKey: key, keySha256, cost: candidate.estimatedOperationCount, routeKind: candidate.route.kind,
      routeOperationCount: candidate.route.operations.length, r0K3: structuredClone(r0), r0K2, r0Split, searchIdentity, reservationDigest, generatedBuildListEntryId: generated.entry.id,
      reusedExisting: generated.reusedExisting,
      replacement: replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId } : { status: replacement.status, replacedBuildListEntryId: null },
      requiresSupport: [...task.supportBuildListEntryIds], generatedEntry: structuredClone(generated.entry) })
    deliveries.push({ ...base, action: 'pooled' })
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

// ---------------------------------------------------------------- evaluations (§6 / §7 / §8 / §9.2)

export type D2FStage = 'B0' | 'I0' | 'WP' | 'ADM' | 'EXT'
export type D2FEvaluatedAgainst = 'baseline_reference' | 'baseline' | 'replacement_set'
export const d2fEvaluatedAgainst = (stage: D2FStage): D2FEvaluatedAgainst => stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set'
/** The replacement kind by its support count: K0 (0), K1 (1), the WP K2 Candidate (2), a K3 Candidate (3). */
export const d2fReplacementKind = (requiresSupport: readonly string[]): 'k0' | 'k1' | 'k2' | 'k3' | null =>
  requiresSupport.length === 0 ? 'k0' : requiresSupport.length === 1 ? 'k1' : requiresSupport.length === 2 ? 'k2' : requiresSupport.length === 3 ? 'k3' : null

export interface D2FReplacementTask {
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedBuildListEntryId: string
  generatedEntrySha256: string
  generatedEntryFile: string
  /** `[]` K0, `[s]` K1, the D2-E K2 supports (2) for the WP Candidate, `S` (3, ascending) for a K3 Candidate. */
  requiresSupport: string[]
  /** K1: its own CTX record; the WP K2: the D2-E CTX-K2; K3: CTX-K3. Null for K0. */
  contextId: string | null
  contextReservationDigest: string | null
  /** The context record `reservationBody` JSON object (never a string). */
  contextReservation: Json | null
  /** K2 / K3 only: the pooled Search-input reservation digest (S6). */
  searchReservationDigest: string | null
}
export interface D2FSupportAuthority { supportBuildListEntryId: string; source: 'k1_ctx_record' | 'ctx_k3_single'; k: number | null; contextId: string; supportBodySha256: string; reservationDigest: string; reservationBody: Json }
export interface D2FEvaluationTask {
  evaluationId: string
  stage: D2FStage
  evaluatedAgainst: D2FEvaluatedAgainst
  /** The discovery ordinal (ADM / EXT), null otherwise. */
  ordinal: number | null
  /** Ascending by Target ID. Empty for B0. */
  replacements: D2FReplacementTask[]
  /** S4 / S5: the S5 authority of every support Entry the replacements require. */
  supportAuthorities: D2FSupportAuthority[]
  researchMaxPlanSteps: number
  fullRunCap: number
}
export interface D2FReplacementReservationCheck {
  kind: 'k1_own_context' | 'k2_pair' | 'k3_set'
  contextId: string
  digestExpected: string
  digestObserved: string
  digestMatched: boolean
  bodyMatched: boolean
  /** K2 / K3 only: the pooled Search-input reservation digest equals the context record digest (S6). */
  searchInputDigestMatched: boolean | null
  satisfied: boolean
}
export type D2FEvaluationFacts = D2EvaluationFacts & {
  supportBodySha256Observed: Record<string, string>
  childRecheck: { checked: number; issues: string[] }
  /** By generated Entry ID: the K1 own CTX record / K2 pair / K3 set (S6) reservation check. */
  replacementReservationChecks: Record<string, D2FReplacementReservationCheck>
}
export type D2FEvaluationChildResult =
  | ({ status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached' } & D2FEvaluationFacts)
  | { status: 'calculation_error'; error: { name: string; message: string } }
  | { status: 'guardrail_violation'; issues: string[]; childRecheck?: { checked: number; issues: string[] } }

/**
 * One evaluation (§6 / §7 / §8 / §9.2): RV1′ / RV2′ for every G of the evaluation before anything runs; S4 / S5 per support
 * against its S5 authority; each K1 replacement's own CTX record; S6 for the K2 / K3 Candidate; then the exact
 * `runD2EEvaluation()` procedure (B0: the persisted baseline; otherwise `O_t` replaced by each G store body, the replacement
 * preflight with no fixed constraint, one full runner with a fresh budget of 8; ADM carries the `found_R` diagnostic with
 * explicit decision = fixed Route = support = S). Only the static support-count limits differ from D2-E (§6 / G60). A D2-F
 * invariant is a guardrail violation; any other thrown error is a calculation error.
 */
export async function runD2FEvaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2FEvaluationTask, generatedEntries: readonly BuildListEntry[],
  observedSha256s: readonly string[], dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2FEvaluationChildResult> {
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

async function evaluate(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2FEvaluationTask, generatedEntries: readonly BuildListEntry[],
  dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2FEvaluationChildResult> {
  if (input.conflictResolutions.length !== 0) throw new D1InvariantError('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2F_RESEARCH_MAX_PLAN_STEPS) throw new D1InvariantError('the Research maxPlanSteps is not 20000')
  if (task.fullRunCap !== D2F_EVALUATION_FULL_RUN_CAP) throw new D1InvariantError('the evaluation full run cap is not 8')
  if (task.evaluatedAgainst !== d2fEvaluatedAgainst(task.stage)) throw new D1InvariantError('evaluatedAgainst is not the stage one')
  if ((task.stage === 'B0') !== (task.replacements.length === 0)) throw new D1InvariantError('only B0 has no replacement')
  if (task.stage === 'ADM' && task.replacements.length !== 1) throw new D1InvariantError('an admission evaluation replaces exactly one Target')
  if ((task.stage === 'ADM' || task.stage === 'EXT') !== (task.ordinal !== null)) throw new D1InvariantError('a discovery ordinal outside ADM / EXT, or an ADM / EXT without one')
  if (task.replacements.some(r => r.requiresSupport.length > D2F_SUPPORTS_PER_CONTEXT)) throw new D1InvariantError('a replacement requires more than three support Entries')
  const k2Count = task.replacements.filter(r => r.requiresSupport.length === 2).length
  const k3Count = task.replacements.filter(r => r.requiresSupport.length === 3).length
  const shapeOk = task.stage === 'B0' ? true : task.stage === 'I0' ? k2Count === 0 && k3Count === 0 : task.stage === 'WP' ? k2Count === 1 && k3Count === 0 : k3Count === 1 && k2Count === 0
  if (!shapeOk) throw new D1InvariantError('ADM / EXT hold exactly one K3 Candidate, WP exactly one K2 Candidate, B0 / I0 none (G15)')
  if (generatedEntries.length !== task.replacements.length) throw new D1InvariantError('the G store bodies do not match the replacements')
  const budget = createPhase2C27BLadderRerunBudget(D2F_EVALUATION_FULL_RUN_CAP, 0)
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
    if ((r.requiresSupport.length >= 2) !== (r.searchReservationDigest !== null)) throw new D1InvariantError('a Search-input reservation digest outside a K2 / K3 Candidate, or the reverse')
    if (!same(r.requiresSupport, sortedIds(r.requiresSupport)) || new Set(r.requiresSupport).size !== r.requiresSupport.length) throw new D1InvariantError('requiresSupport is not distinct and ascending')
  }
  // S4 / S5 (static, §9.2): each support Entry is the Export's, hashing to its S5 authority supportBodySha256, and derives the
  // authority reservation (digest AND body). Any failure stops the evaluation as a guardrail violation.
  const engine = dependencies.rngEngine
  const staticChecks: Record<string, D2SupportStaticCheck> = {}
  const observedBodies: Record<string, string> = {}
  const inputBody = new Map<string, BuildListEntry>()
  for (const supportId of support) {
    const authority = task.supportAuthorities.find(a => a.supportBuildListEntryId === supportId)
    if (!authority || !isObject(authority.reservationBody)) throw new D1InvariantError(`S4 / S5: no S5 authority of the support Entry ${supportId}`)
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
  // Each K1 replacement's own CTX record and S6 for the K2 / K3 Candidate (the support bodies of the evaluation input).
  const replacementReservationChecks: Record<string, D2FReplacementReservationCheck> = {}
  for (const r of task.replacements.filter(x => x.requiresSupport.length > 0)) {
    const derived = derivePlannerAlternativeReservation(r.requiresSupport.map(id => inputBody.get(id)!), engine)
    const digestObserved = hashStableValue(derived)
    const digestMatched = digestObserved === r.contextReservationDigest
    const bodyMatched = stableStringify(derived) === stableStringify(r.contextReservation)
    const multi = r.requiresSupport.length >= 2
    const searchInputDigestMatched = multi ? r.searchReservationDigest === r.contextReservationDigest : null
    const satisfied = digestMatched && bodyMatched && searchInputDigestMatched !== false
    const kind = r.requiresSupport.length === 3 ? 'k3_set' : r.requiresSupport.length === 2 ? 'k2_pair' : 'k1_own_context'
    replacementReservationChecks[r.generatedBuildListEntryId] = { kind, contextId: r.contextId!, digestExpected: r.contextReservationDigest!, digestObserved, digestMatched, bodyMatched, searchInputDigestMatched, satisfied }
    if (!satisfied) throw new D1InvariantError(multi ? `S6: support_set_reservation_mismatch for ${r.generatedBuildListEntryId}` : `S5: the support of ${r.generatedBuildListEntryId} does not derive its own CTX record reservation`)
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

/** The D2 facts (the same fields, digests and derivations as `runD2EEvaluation()` / `runD2Evaluation()`), plus the static check records. */
function finishFacts(status: 'evaluated' | 'preflight_refused' | 'planner_rerun_bound_reached', preflight: { status: string; refusal: string | null }, runConflictResolutions: number,
  fullRunsStarted: number, runInput: PlannerInput, runContext: PlannerRunBuildListContext, result: PlannerResult | null, commitment: PlannerRouteCommitmentEvidence | null,
  replacements: readonly D2FReplacementTask[], support: readonly string[], dependencies: PlannerDependencies, trialVerdict: D1EvaluationFacts['trialVerdict'],
  staticChecks: Record<string, D2SupportStaticCheck>, observedBodies: Record<string, string>, replacementReservationChecks: Record<string, D2FReplacementReservationCheck>): D2FEvaluationChildResult {
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
  const facts: D2FEvaluationFacts = {
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

/** The S5 authority (§9.2) of every I0 support (the lowest-k K1 CTX record), plus the new support's CTX-K3 single reservation when given. */
export function d2fSupportAuthorities(v: D2FValidatedInputs, newSupport: D2FSupportAuthority | null): D2FSupportAuthority[] {
  const k1 = v.supports.map((sd): D2FSupportAuthority => {
    const c = sd.contexts[0]
    if (c === undefined) throw new Error(`${sd.supportBuildListEntryId}: no CTX record`)
    return { supportBuildListEntryId: sd.supportBuildListEntryId, source: 'k1_ctx_record', k: c.k, contextId: c.contextId, supportBodySha256: c.supportBodySha256, reservationDigest: c.reservationDigest,
      reservationBody: structuredClone(c.reservationBody) }
  })
  return newSupport === null ? k1 : [...k1, { ...newSupport, reservationBody: structuredClone(newSupport.reservationBody) }]
}

/** The new support's S5 authority from a read-back CTX-K3 record (§9.2: `singleSupportReservations[X]` and `supportBodySha256s[X]`). */
export function d2fNewSupportAuthority(record: Pick<D2FContextRecord, 'contextId' | 'newSupportBuildListEntryId' | 'singleSupportReservations' | 'supportBodySha256s'>): D2FSupportAuthority | null {
  const x = record.newSupportBuildListEntryId
  const single = record.singleSupportReservations[x]
  const body = record.supportBodySha256s[x]
  if (single === undefined || !isObject(single.reservationBody) || typeof body !== 'string') return null
  return { supportBuildListEntryId: x, source: 'ctx_k3_single', k: null, contextId: record.contextId, supportBodySha256: body, reservationDigest: single.reservationDigest, reservationBody: structuredClone(single.reservationBody) }
}

/** An incumbent replacement (§8.1): K1 carries its own CTX record (t00 CTX-1, t04 CTX-5, t05 CTX-6, t10 CTX-7). */
export function d2fIncumbentReplacement(v: D2FValidatedInputs, r: D2ECandidateRef): D2FReplacementTask {
  const ctx = r.origin === 'd2c_k1' ? v.contexts.find(c => c.k === r.contextK) ?? null : null
  if (r.origin === 'd2c_k1' && ctx === null) throw new Error(`${r.label} c${r.ordinal}: no CTX record`)
  return { targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
    generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: [...r.requiresSupport], contextId: ctx === null ? null : r.contextId,
    contextReservationDigest: ctx?.reservationDigest ?? null, contextReservation: ctx === null ? null : structuredClone(ctx.reservationBody), searchReservationDigest: null }
}

/** The WP K2 replacement (§8.2): requiresSupport = the D2-E CTX-K2 supports, the D2-E CTX-K2 record values, the D2-E pooled Search-input digest. */
export function d2fWpReplacement(v: D2FValidatedInputs): D2FReplacementTask {
  const k2 = v.wp?.k2 ?? null
  if (k2 === null || v.k2Context === null) throw new Error('no WP K2 Candidate')
  return { targetIndex: k2.targetIndex, targetWeaponId: k2.targetWeaponId, currentBuildListEntryId: k2.currentBuildListEntryId, generatedBuildListEntryId: k2.generatedBuildListEntryId,
    generatedEntrySha256: k2.sha256, generatedEntryFile: k2.file, requiresSupport: [...k2.requiresSupport], contextId: v.k2Context.contextId, contextReservationDigest: v.k2Context.reservationDigest,
    contextReservation: structuredClone(v.k2Context.reservationBody), searchReservationDigest: k2.searchReservationDigest }
}

export interface D2FK3PoolRef { ordinal: number; generatedBuildListEntryId: string; file: string; sha256: string; searchReservationDigest: string }
/** A K3 replacement (§7 / §8.3): requiresSupport = S, the CTX-K3 record values, the pooled Search-input reservation digest. */
export function d2fK3Replacement(v: D2FValidatedInputs, context: { contextId: string; reservationDigest: string; reservationBody: Json }, p: D2FK3PoolRef): D2FReplacementTask {
  if (v.k3 === null) throw new Error('no K3 context')
  return { targetIndex: v.k3.targetIndex, targetWeaponId: v.k3.targetWeaponId, currentBuildListEntryId: v.k3.currentBuildListEntryId, generatedBuildListEntryId: p.generatedBuildListEntryId,
    generatedEntrySha256: p.sha256, generatedEntryFile: p.file, requiresSupport: [...v.k3.supportBuildListEntryIds], contextId: context.contextId, contextReservationDigest: context.reservationDigest,
    contextReservation: structuredClone(context.reservationBody), searchReservationDigest: p.searchReservationDigest }
}

const sortRefs = <T extends { targetWeaponId: string }>(refs: readonly T[]) => [...refs].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
export function d2fEvaluationTask(v: D2FValidatedInputs, evaluationId: string, stage: D2FStage, ordinal: number | null, replacements: readonly D2FReplacementTask[], newSupport: D2FSupportAuthority | null): D2FEvaluationTask {
  const reps = sortRefs(replacements)
  const support = new Set(reps.flatMap(r => r.requiresSupport))
  return { evaluationId, stage, evaluatedAgainst: d2fEvaluatedAgainst(stage), ordinal, replacements: reps.map(r => ({ ...r, requiresSupport: [...r.requiresSupport] })),
    supportAuthorities: d2fSupportAuthorities(v, newSupport).filter(a => support.has(a.supportBuildListEntryId)), researchMaxPlanSteps: D2F_RESEARCH_MAX_PLAN_STEPS, fullRunCap: D2F_EVALUATION_FULL_RUN_CAP }
}

// ---------------------------------------------------------------- judgements shared by the runner and the analyzer (§8.6)

/** §8.6: "(a, b) is better than (c, d)" (the D2-E-A §6.5 rule, applied unchanged). */
export const d2fBetter = d2eBetter
/** §8.6: completed desc, Conflicts asc, steps asc, discovery ordinal asc (a total order). */
export const compareD2FSelection = compareD2ESelection
/** §8.6 `improvementKind`. */
export const d2fImprovementKind = d2eImprovementKind

// ---------------------------------------------------------------- start attestation and Production audit (§11.2)

export const D2F_START_ATTESTATION_FILE = 'start-attestation.json'
export const D2F_START_ATTESTATION_PHASE = 'Issue #154 D2-F-B runner start attestation'
export const d2fProductionChangedFiles = d2ProductionChangedFiles

/** §11.2 / §13 `conditions`: the registered policy (context, derivation, reservations, ladder, cap, dedup, procedures, gate, order, budgets, envelope, decision). */
export function d2fRegisteredConditions() {
  return {
    specFile: D2F_SPEC_FILE,
    baseMain: D2F_BASE_MAIN,
    k3Context: '§3.2 of the attested D2-F document (one K3 context, re-derived by §3.1 in V and compared)',
    derivationRule: [...D2F_DERIVATION_RULE],
    registeredReservation: { reservationDigest: D2F_K3_RESERVATION_DIGEST, bodySha256: D2F_K3_RESERVATION_BODY_SHA256, body: '§1.6 / §4.1 of the attested D2-F document', originDigest: D2E_ORIGIN_DIGEST },
    registeredNewSupportReservation: { reservationDigest: D2F_NEW_SUPPORT_RESERVATION_DIGEST, bodySha256: D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256, body: '§1.6 / §4.2 of the attested D2-F document' },
    contextRule: [...D2F_CONTEXT_RULE],
    ladder: D2F_LADDER.map(r => ({ id: r.id, extent: { ...r.extent } })),
    k3PoolCap: D2F_K3_POOL_CAP,
    deliveryCapPerUnit: D2F_DELIVERIES_PER_UNIT_MAX,
    discoveryRule: [...D2F_DISCOVERY_RULE],
    dedupRules: [...D2F_DEDUP_RULES],
    incumbent: '§1.4 / §8.1: the D2-E-A §1.2 table (9 Candidates, re-derived from the D2-D RESULT in V and compared)',
    order: [...D2F_ORDER],
    i0Rule: [...D2F_I0_RULE],
    wrapperParityRule: [...D2F_WRAPPER_PARITY_RULE],
    wpExpected: { ...D2F_WP_EXPECTED },
    evaluationProcedure: 'runD2FEvaluation(): the runD2EEvaluation() procedure and parts in the same order (B0 persisted; otherwise O_t -> G store bodies, the replacement preflight with no fixed constraint, one full runner with a fresh budget of 8, runtime-unsupported removal, d1InputDigest / d1ResultDigest, Trace Replay in Plan generation; ADM found_R with explicit decision = fixed Route = support = S); only the static limits change: requiresSupport <= 3, ADM / EXT exactly one K3 Candidate, WP exactly one K2 Candidate, B0 / I0 none; S4 / S5 over S_sup (<= 4), S6 over the K2 / K3 Candidate',
    admissionRule: [...D2F_ADMISSION_RULE],
    extensionRule: [...D2F_EXTENSION_RULE],
    r5Definition: [...D1_R5_DEFINITION],
    extensionDiagnostics: [...D2F_EXTENSION_DIAGNOSTICS],
    gate: D2F_GATE_RULE,
    betterRule: D2F_BETTER_RULE,
    improvedRule: D2F_IMPROVED_RULE,
    selectionOrder: [...D2F_SELECTION_ORDER],
    r6Definition: [...D2C_R6_DEFINITION],
    rvChecks: [...D2F_RV_CHECKS],
    contextChecks: [...D2F_CONTEXT_CHECKS],
    supportChecks: [...D2F_SUPPORT_CHECKS],
    supportExpiryCauses: [...D2F_SUPPORT_EXPIRY_CAUSES],
    budgets: { ...D2F_BUDGETS },
    executionEnvelope: { ...D2F_EXECUTION_ENVELOPE },
    researchMaxPlanSteps: D2F_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D2F_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D2F_CALCULATION_CONTEXT },
    decisionRule: [...D2F_DECISION_RULE],
    comparisonBaselines: structuredClone(D2F_COMPARISON_BASELINES) as unknown,
    registeredInputs: structuredClone(D2F_REGISTERED_INPUTS) as unknown,
    chainedDocuments: [...D2E_CHAINED_DOCUMENT_KEYS],
    gStoreFiles: D2E_INCUMBENT_G_STORE_FILES.map(f => ({ ...f })),
    contextRecords: D2E_CONTEXT_RECORDS.map(c => ({ ...c })),
    k0ReservationDigest: D2E_K0_RESERVATION_DIGEST,
    k2ReservationDigest: D2E_K2_RESERVATION_DIGEST,
    b0Expected: { ...D2E_B0_EXPECTED },
    i0Expected: { ...D2E_I0_EXPECTED },
    d2eProvenance: { ...D2F_D2E_PROVENANCE },
    d2dProvenance: { ...D2E_D2D_PROVENANCE },
    d2cProvenance: { ...D2E_D2C_PROVENANCE },
    d2Provenance: { ...D2E_D2_PROVENANCE },
    d2eResultFieldsRead: [...D2F_D2E_RESULT_ALLOWLIST],
    d2dResultFieldsRead: [...D2E_D2D_RESULT_ALLOWLIST],
    d2cResultFieldsRead: [...D2F_D2C_RESULT_ALLOWLIST],
    d2ResultFieldsRead: [...D2E_D2_RESULT_ALLOWLIST],
    contextRecordFieldsRead: [...D2E_CONTEXT_RECORD_FIELDS_READ],
    k2ContextRecordFieldsRead: [...D2F_K2_CONTEXT_RECORD_FIELDS_READ],
    provenanceFlags: { ...D2F_PROVENANCE_FLAGS },
    notRun: [...D2F_NOT_RUN],
  }
}

/** §11.2: the SHA-256 of `stableStringify(conditions)`. */
export const d2fRegisteredPolicySha256 = (sha256OfText: (text: string) => string) => sha256OfText(stableStringify(d2fRegisteredConditions()))

export interface D2FLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  /** The calculation code digest (the code paths at HEAD, which hold the D2-F benchmark code and every module it imports). */
  benchmarkCodeSha256: string
  /** The D2-F-A document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The observed digest of every registered input, chained document, incumbent G store file and K1 CTX record (V checks them against the registered ones). */
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

export type D2FStartAttestation = ReturnType<typeof d2fRegisteredConditions> & D2FLaunchObservation & { phase: string; attestedBy: 'runner' }

export function d2fStartAttestationBody(observation: D2FLaunchObservation): D2FStartAttestation {
  return { phase: D2F_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d2fRegisteredConditions(), ...observation }
}

const EMPTY_D2F_OBSERVATION: D2FLaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  registeredPolicySha256: '', observedInputs: {}, observedDocuments: {}, observedGStoreFiles: {}, observedContextRecords: {}, exportFileName: '',
  productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null },
  appliedExecutionEnvelope: { ...D2F_EXECUTION_ENVELOPE }, rngEngineVersion: '', observedCalculationContext: null, smoke: null }
const D2F_ATTESTATION_KEYS = Object.keys(d2fStartAttestationBody(EMPTY_D2F_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D2FAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The chained Export SHA-256 (`d2fChainedExportSha256()`). */
  exportSha256: string | null
  /** The D2-E RESULT `sources.documents` digests (the chained documents). */
  chainedDocuments: Record<string, string | null>
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D2-F launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / calculation code / D2-F document
 * / registered policy equal to the independently obtained ones, every observed input / document / G store file / CTX record equal to
 * the registered digest, Production changed files = [] with the base main an ancestor, the registered Engine and CalculationContext,
 * a clean non-smoke launch, and every registered condition unchanged.
 */
export function verifyD2FStartAttestation(attestation: unknown, expected: D2FAttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D2F_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D2F_START_ATTESTATION_PHASE) issues.push('not a D2-F-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  if (attestation.registeredPolicySha256 !== expected.registeredPolicySha256) issues.push('registeredPolicySha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D2F_REGISTERED_INPUTS) as [string, D2FRegisteredFile][]) {
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
  if (audit === null || audit.baseMain !== D2F_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D2F_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (attestation.rngEngineVersion !== D2F_RNG_ENGINE_VERSION) issues.push('the Production RNG Engine is not the registered one')
  if (!same(attestation.observedCalculationContext, D2F_CALCULATION_CONTEXT)) issues.push('the observed CalculationContext is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D2F_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d2fRegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
