/**
 * Issue #154 D2-D-B: local two-Target recomposition of existing Candidates (t05 K1 x t07 K0) on top of the D2-C final accepted set.
 * Research only. Never import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md` (D2-D-A, PR #229), attested by the runner at the measurement
 * HEAD. The registered order (§4.1):
 *
 * ```text
 * V     the registered inputs; F / Fixed / P07 / P05 / PAIRS re-derived from the D2-C / D2 RESULTs (§3.1) = the §3.2 table   parent
 * RV    one child: RV1 .. RV6 for the 12 Candidates and the 3 support Entries (no Search, no full run, §6.1)
 * B0    the baseline PlannerInput, one fresh full run (persisted)
 * I0    the D2-C final accepted set (8 G store bodies), one fresh replacement_set run
 * PAIR  ordinal 1 -> 6: Fixed (7) ∪ { t05: a, t07: b }, one fresh replacement_set run each, independent of each other
 * ```
 *
 * Every evaluation keeps `conflictResolutions = []` and the preflight fixed constraints `[]` (G1). The support Entries are the
 * Export's own Entries and are never written as a resolution, a scenario resolution, a repair lineage or a selected Entry (G30). The
 * evaluations go through the unchanged `runD2CEvaluation()` (S4 / S5 against the CTX record body object and digest), with the D2-C
 * I0 procedure (replacement_set, no found_R) for both I0 and PAIR; the RESULT records PAIR as its own stage (§13.2).
 *
 * Oracle isolation: this module imports no oracle, Phase B analysis or population-authority module and reads the D2-C / D2 RESULTs
 * through `projectD2DD2CResult()` / `projectD2DD2Result()` only (the §9.1 allowlists) and the CTX records through
 * `projectD2DContextRecord()` only. It names no Target, Entry or stable key: every Candidate, Target and support comes from the
 * RESULTs (§3.1); the registered file names, SHA-256 and digests (§9.1 / §3.2 / §4.3 / §8.1) are only compared.
 */
import { resolveBuildListEntryReplacement } from '../domain/buildList'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, D1_R5_DEFINITION } from './plannerGlobalD1'
import { d2NamesSha256, d2ProductionChangedFiles } from './plannerGlobalD2'
import {
  readD2CContextRecord,
  runD2CEvaluation,
  D2C_CALCULATION_CONTEXT,
  D2C_EVALUATION_FULL_RUN_CAP,
  D2C_R6_DEFINITION,
  D2C_RESEARCH_MAX_PLAN_STEPS,
  D2C_RNG_ENGINE_VERSION,
  D2C_SUPPORT_CHECKS,
  D2C_SUPPORT_EXPIRY_CAUSES,
  type D2CEvaluationChildResult,
  type D2CReplacementTask,
} from './plannerGlobalD2C'
import { respectsPhase2C2Reservation, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { buildPhase2C27BTargetPlans, phase2c27bPolicyDrift, phase2c27bResolveSupportContext } from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const suffix8 = (id: string) => (id.split('-').pop() ?? '').slice(0, 8)

// ---------------------------------------------------------------- registered before the formal run (D2-D-A §2 - §14, §16)

export const D2D_PHASE = 'Issue #154 D2-D'
export const D2D_RESULT_PHASE = 'Issue #154 D2-D: local two-Target recomposition of existing Candidates (post-hoc analysis)'
/** The D2-D-A document. Its SHA-256 is computed by the runner from the measurement HEAD git object (§9.2) and attested. */
export const D2D_SPEC_FILE = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md'
/** The main of D2-D-B's start (PR #229 merged): the Production audit counts changes since this commit. */
export const D2D_BASE_MAIN = '6f1c90b7829d1bca1aec2d0552d6d01229e13ae6'

/** §9.1: the D2-C formal RESULT D2-D reads (its measurement provenance and decision). */
export const D2D_D2C_PROVENANCE = Object.freeze({
  measuredHead: '627184363db50ef256f602014b457f05a227861c',
  decisionCase: 'D2C_EXCEEDS_D2B_MAIN',
  finalResultEvaluationId: 'CMP-t10-c1',
  runDir: '.local/d2c-k1-formal.run',
} as const)
/** §9.1: the D2 formal RESULT D2-D reads. */
export const D2D_D2_PROVENANCE = Object.freeze({
  measuredHead: '6f66c168e9163dab02bb60b2f1dc5b1cfc531e71',
  decisionCase: 'D2A_EXCEEDS_D1_INCUMBENT',
  runDir: '.local/d2-formal2.run',
} as const)

/**
 * `sha256: null` is the Export only: its digest is reached through the authority chain (the D2-C RESULT `sources.export`, equal to the
 * D2 RESULT one and named by the attested D2-D text), so it is written in no Research source but the oracle's (as in D2-C).
 */
export interface D2DRegisteredFile { file: string; bytes: number; sha256: string | null }

/** §9.1: every committed / local input D2-D reads, by path relative to the repository root (the Export is an external path argument). */
export const D2D_REGISTERED_INPUTS = Object.freeze({
  export: { file: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: null },
  d2cResult: { file: 'docs/PLANNER_GLOBAL_D2C_RESULT.json', bytes: 1_541_755, sha256: '99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68' },
  d2Result: { file: 'docs/PLANNER_GLOBAL_D2_RESULT.json', bytes: 4_122_806, sha256: 'ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c' },
  phase2c2Result: { file: 'docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json', bytes: 1_195_107, sha256: 'afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4' },
  d2cSpecDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md', bytes: 104_521, sha256: 'edd9a3fbf4095a1577ec4fac670cc7649597d5f8c562d40a859dfe64e71a70a5' },
  d2cbDocument: { file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md', bytes: 13_983, sha256: 'a8fe32851f9fcc27f85cf366c6b539ef6464f6f72572edf836e00162c27ceebe' },
  d2cAttestation: { file: '.local/d2c-k1-formal.run/start-attestation.json', bytes: 27_674, sha256: 'a3998ab6460b03e9dbf91329a9f1e133e4eae63c201c9ac51ed05f153c695970' },
  d2cRaw: { file: '.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local', bytes: 136_356, sha256: 'a0e106891b2805bb2b6b28a3b99ee31b5c535a84e795084292185e07bdc78601' },
} satisfies Record<string, D2DRegisteredFile>)
export type D2DRegisteredInputKey = keyof typeof D2D_REGISTERED_INPUTS

/** §9.1: the D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B documents, hash-checked against D2-C RESULT `sources.documents`. */
export const D2D_CHAINED_DOCUMENT_KEYS = Object.freeze(['d2a', 'd2b', 'd1a', 'phaseA', 'phaseB', 'followup', 'd1b'] as const)

export type D2DOrigin = 'd2b_k0' | 'd2c_k1'
export interface D2DRegisteredGStoreFile { label: string; ordinal: number; origin: D2DOrigin; runDir: string; file: string; bytes: number; sha256: string }

/** §1.2 - §1.4 / §9.1: the 12 G store bodies D2-D evaluates (7 D2-B K0, 5 D2-C K1). Read only, never written. */
export const D2D_G_STORE_FILES: readonly D2DRegisteredGStoreFile[] = Object.freeze([
  { label: 't01', ordinal: 1, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't01-c1.generated-entry.json', bytes: 66_309, sha256: '3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14' },
  { label: 't06', ordinal: 3, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't06-c3.generated-entry.json', bytes: 251_042, sha256: '06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218' },
  { label: 't07', ordinal: 1, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't07-c1.generated-entry.json', bytes: 170_990, sha256: '27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f' },
  { label: 't07', ordinal: 2, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't07-c2.generated-entry.json', bytes: 119_011, sha256: 'd7a708d84757be2b8d8251e676e25decb3c85f150a91a71761712ee9556e91d6' },
  { label: 't07', ordinal: 3, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't07-c3.generated-entry.json', bytes: 211_734, sha256: 'f23e0891fac67f6260c48aed0a121a8d2de53669b64be79efc4ca9f5d3d8abb7' },
  { label: 't08', ordinal: 1, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't08-c1.generated-entry.json', bytes: 222_523, sha256: '825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc' },
  { label: 't09', ordinal: 1, origin: 'd2b_k0', runDir: D2D_D2_PROVENANCE.runDir, file: 't09-c1.generated-entry.json', bytes: 270_975, sha256: 'b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc' },
  { label: 't00', ordinal: 1, origin: 'd2c_k1', runDir: D2D_D2C_PROVENANCE.runDir, file: 'K1-t00-e396d352-c1.generated-entry.json', bytes: 101_010, sha256: 'ee101531376ac36f491d4b1d07592fc6ca8356a62da2daeee85d956c83ff13e0' },
  { label: 't04', ordinal: 1, origin: 'd2c_k1', runDir: D2D_D2C_PROVENANCE.runDir, file: 'K1-t04-92d87b90-c1.generated-entry.json', bytes: 481_245, sha256: '3d83de2ab3eac164f1ad49a21ed22bfe174f83a7fe8ac0f2644fda3ba49062c4' },
  { label: 't05', ordinal: 1, origin: 'd2c_k1', runDir: D2D_D2C_PROVENANCE.runDir, file: 'K1-t05-61066e62-c1.generated-entry.json', bytes: 67_339, sha256: '982b6da2247de3ce01fb06a747a0053f86e44a44a8fe8c02d1602a18ef51a0b2' },
  { label: 't05', ordinal: 2, origin: 'd2c_k1', runDir: D2D_D2C_PROVENANCE.runDir, file: 'K1-t05-61066e62-c2.generated-entry.json', bytes: 67_339, sha256: 'd433f6a2a7bf839a2d3470c774a9f8d6a4e7d32beaee3736e4197691005d1c33' },
  { label: 't10', ordinal: 1, origin: 'd2c_k1', runDir: D2D_D2C_PROVENANCE.runDir, file: 'K1-t10-e396d352-c1.generated-entry.json', bytes: 24_593, sha256: '4ae6d9b2ca28df084a3496913fdb2e53189c7425dd460cbe3064f9f9c2307b0d' },
].map(row => Object.freeze(row as D2DRegisteredGStoreFile)))
export const d2dGStoreKey = (label: string, ordinal: number) => `${label}-c${ordinal}`

export interface D2DRegisteredContextRecord { k: number; file: string; bytes: number; sha256: string }
/** §1.6 / §9.1: the D2-C CTX records D2-D reuses (read: `result.{contextId, supportBuildListEntryId, supportBodySha256, reservationBody, reservationDigest, status}` only). */
export const D2D_CONTEXT_RECORDS: readonly D2DRegisteredContextRecord[] = Object.freeze([
  { k: 1, file: 'CTX-1.context.json', bytes: 35_505, sha256: '39adb498b93d2f60cd465ae16125cee53bdf131c8979c092dcb3d0a3d6c0a2e1' },
  { k: 5, file: 'CTX-5.context.json', bytes: 338_994, sha256: '7e42c33cbeca28265ecbc7946f9a48ae764bb3c528bbc3f89fa107d1988a4b4c' },
  { k: 6, file: 'CTX-6.context.json', bytes: 31_237, sha256: 'd1e415c4a06970055395901b40811dd9fe1226d6af70ce23471c831c79e5e054' },
  { k: 7, file: 'CTX-7.context.json', bytes: 18_630, sha256: 'a3a531065350f1a2f854ddbb7ffe2e25d6fcf14fe7f39ea83717a5a36b012372' },
].map(row => Object.freeze(row)))

/** §6.1 RV3: the empty-support (K0) Search reservation digest D2-B registered (D2-A §2.3). */
export const D2D_K0_RESERVATION_DIGEST = 'fnv1a32:5ac88909'
/** §1.8 / §3.2: the registered `inputDigest` of I0 and of PAIR ordinal 1 .. 6. */
export const D2D_REGISTERED_INPUT_DIGESTS = Object.freeze({
  I0: 'fnv1a32:75e7dba9',
  pairs: Object.freeze(['fnv1a32:55b1abda', 'fnv1a32:30ea5123', 'fnv1a32:6493291d', 'fnv1a32:a7b574da', 'fnv1a32:39fc4b63', 'fnv1a32:f135c305']),
})
/** §8.1 baseline parity: D2-C RESULT `evaluations[B0]` (= D2 B0). */
export const D2D_B0_EXPECTED = Object.freeze({ evaluationId: 'B0', inputDigest: 'fnv1a32:6f151dc3', resultDigest: 'fnv1a32:880bbb52', status: 'evaluated', termination: 'exhausted',
  completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 })
/** §4.3 / §8.1 d2c_final parity: D2-C `CMP-t10-c1`. */
export const D2D_I0_EXPECTED = Object.freeze({ evaluationId: 'CMP-t10-c1', inputDigest: 'fnv1a32:75e7dba9', resultDigest: 'fnv1a32:77d41017', status: 'evaluated', termination: 'exhausted',
  completed: 23, totalTargetCount: 43, conflicts: 20, steps: 1465 })
/** §10.1: the fixed comparison values (completed / Conflict / steps). */
export const D2D_COMPARISON_BASELINES = Object.freeze({
  baseline: Object.freeze({ evaluationId: 'B0', completed: 20, totalTargetCount: 43, conflicts: 21, steps: 1465 }),
  d2bMain: Object.freeze({ evaluationId: 'D2-C I0', completed: 22, totalTargetCount: 43, conflicts: 20, steps: 1465 }),
  d2cFinal: Object.freeze({ evaluationId: 'I0', completed: 23, totalTargetCount: 43, conflicts: 20, steps: 1465 }),
})

export const D2D_E1_LABELS = Object.freeze({ t05: 't05', t07: 't07' } as const)
export const D2D_PAIR_COUNT = 6
export const D2D_RESEARCH_MAX_PLAN_STEPS = D2C_RESEARCH_MAX_PLAN_STEPS
export const D2D_EVALUATION_FULL_RUN_CAP = D2C_EVALUATION_FULL_RUN_CAP
export const D2D_CALCULATION_CONTEXT = D2C_CALCULATION_CONTEXT
export const D2D_RNG_ENGINE_VERSION = D2C_RNG_ENGINE_VERSION

/** §7.3: the execution envelope (Research measurement envelopes, never a Production timeout). */
export const D2D_EXECUTION_ENVELOPE = Object.freeze({
  rvBudgetMs: 10 * 60 * 1000,
  evaluationBudgetMs: 30 * 60 * 1000,
  runBudgetMs: 4 * 60 * 60 * 1000,
  childHeapMb: 12_288,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  memorySampleIntervalMs: 250,
  nodeYield: 'setImmediate',
} as const)

/** §7.2: the registered budgets (each independent; never a Production bound, G5). */
export const D2D_BUDGETS = Object.freeze({
  newSearch: 0,
  candidateDiscovery: 0,
  contextRecords: 0,
  admissions: 0,
  rvChildren: 1,
  b0Evaluations: 1,
  i0Evaluations: 1,
  pairEvaluations: D2D_PAIR_COUNT,
  evaluationRequestsMax: 8,
  childProcessesMax: 9,
  evaluationFullRunCap: D2D_EVALUATION_FULL_RUN_CAP,
  fullPlannerRunsMax: 64,
  researchMaxPlanSteps: D2D_RESEARCH_MAX_PLAN_STEPS,
} as const)

/** §11 provenance flags. */
export const D2D_PROVENANCE_FLAGS = Object.freeze({
  oracleReadByRunner: false,
  oracleReadByChild: false,
  oracleReadByAnalyzer: false,
  d2cResultModified: false,
  d2ResultModified: false,
  priorEvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true,
  newSearchInD2D: false,
  newCandidateDiscoveryInD2D: false,
  newAdmissionInD2D: false,
  speculativeSupportWrittenAsResolution: false,
  alternativeToAlternativeSupport: false,
  productionSemanticsChanged: false,
} as const)

/** §9.1: the only D2-C RESULT fields D2-D reads. */
export const D2D_D2C_RESULT_ALLOWLIST = Object.freeze([
  'sources.{specDocument,d2.result,d2.generatedEntriesUsedByI0,phase2c2Result,export,documents,d2c.{raw,attestation,contextRecords,generatedEntries}}',
  'provenance.{formal,measuredHead,analysisHead,runStatus,calculationCodeChangedSinceMeasuredHead,productionChangedFiles,startAttestation.{sha256,verified}}', 'invalidReasons', 'decision.case',
  'aggregates.evaluations.{unmeasuredByReason,notExecutedByReason}',
  'composition.main.{finalAccepted,finalResultEvaluationId,finalMetrics,steps[label = t05].{stepOutcome,acceptedBefore}}',
  'discovery.targets[label in {t00,t04,t05,t10}].{label,targetWeaponId,currentBuildListEntryId,pool[].{ordinal,contextId,candidateStableKey,keySha256,searchIdentity,reservationDigest,contextRecordSha256,requiresSupport,generatedBuildListEntryId,generatedEntry,replacement,r0,reusedExisting}}',
  'contexts[k in {1,5,6,7}].{contextId,k,supportBuildListEntryId,record,supportBodySha256,reservationDigest,status}',
  'evaluations[evaluationId in {B0,CMP-t10-c1,CMP-t05-c1,CMP-t05-c2,ADM-t05-c1,ADM-t05-c2}].{evaluationId,stage,status,inputDigest,resultDigest,generatedEntryIds,generatedEntrySha256s,plan.{termination,steps},conflicts (count; CMP-t05: kind / participants / resourceIdentity / selectedBuildListEntryId),candidates[].{label,selected,winnerBuildListEntryId},r5.{satisfied,failureReasons},r1r4.R1}',
])
/** §9.1: the only D2 RESULT fields D2-D reads. */
export const D2D_D2_RESULT_ALLOWLIST = Object.freeze([
  'sources.{export,d2.generatedEntries[file = the 7 D2-B G store files]}', 'provenance.{formal,measuredHead,runStatus}', 'invalidReasons', 'decision.case',
  'discovery.targets[label in {t01,t06,t07,t08,t09}].{label,targetWeaponId,currentBuildListEntryId,pool[].{ordinal,candidateStableKey,keySha256,searchIdentity,generatedBuildListEntryId,generatedEntry,replacement,reservationCheck,reusedExisting}}',
  'evaluations[evaluationId in {B0,ADM-t07-c1,ADM-t07-c2,ADM-t07-c3}].{evaluationId,status,inputDigest,resultDigest,r1r4.R1}',
])
export const D2D_CONTEXT_RECORD_FIELDS_READ = Object.freeze(['result.contextId', 'result.supportBuildListEntryId', 'result.supportBodySha256', 'result.reservationBody', 'result.reservationDigest', 'result.status'])
const D2C_LABELS = ['t00', 't04', 't05', 't10']
const D2_LABELS = ['t01', 't06', 't07', 't08', 't09']
const D2C_CONTEXT_KS = [1, 5, 6, 7]
const D2C_EVALUATIONS_READ = ['B0', 'CMP-t10-c1', 'CMP-t05-c1', 'CMP-t05-c2', 'ADM-t05-c1', 'ADM-t05-c2']
const D2_EVALUATIONS_READ = ['B0', 'ADM-t07-c1', 'ADM-t07-c2', 'ADM-t07-c3']

export const D2D_DERIVATION_RULE = Object.freeze([
  'F = D2C RESULT composition.main.finalAccepted (Target ID ascending, 8); finalResultEvaluationId = CMP-t10-c1, finalMetrics = { 23, 20, 1465 }; each G store = D2 sources.d2.generatedEntries (K0) / D2C discovery.targets[].pool[].generatedEntry (K1)',
  'Fixed = F without t07 (7)',
  'P07 = D2 RESULT discovery.targets[t07].pool (ordinal ascending, 3); D2 ADM-t07-c<o>.r1r4.R1 = true; F[t07] = P07[ordinal 1]',
  'P05 = D2C RESULT discovery.targets[t05].pool (ordinal ascending, 2); D2C ADM-t05-c<o>.r1r4.R1 = true; D2C composition.main.steps[t05].stepOutcome = not_replaced_no_eligible',
  'PAIRS = [(a, b) for a in P05 for b in P07] (t05 ordinal major, t07 ordinal minor) = PAIR ordinal 1 .. 6',
  'PAIR replacement set = Fixed ∪ { t05: a, t07: b } (Target ID ascending, 9); I0 replacement set = F (8)',
  'the derivation must equal the §3.2 table (set, order, Entry IDs, G store bytes / SHA-256, requiresSupport, inputDigest); any difference is input_evidence (no child starts)',
])
export const D2D_I0_RULE = Object.freeze([
  'I0 = the D2-C final accepted set (8, Target ID ascending), G bodies from the D2-B / D2-C G store, one fresh replacement_set run (the D2-C I0 procedure: Z0, no found_R)',
  'requiresSupport: t00 / t10 [e396d352], t04 [92d87b90], others []; support records CTX-1 / CTX-5 / CTX-7',
  'expected (d2c_final parity): inputDigest, evaluated, resultDigest, exhausted, 23 / 43, Conflict 20, steps 1465, R5 (D2-C CMP-t10-c1); the D2-C RESULT values are parity expectations only',
  'I0 is the reference of the gate and of "better"; I0 unmeasured -> every PAIR not_executed (i0_unmeasured)',
])
export const D2D_PAIR_RULE = Object.freeze([
  'for k in 1 .. 6 (PAIR ordinal order, each independent of the others): replacements = Fixed ∪ { t05: a, t07: b }, one replacement_set run',
  't05 is added (O_t05 -> a) and t07 is replaced (I0 t07 c1 -> b) in ONE PlannerInput; never two steps, never t07 alone',
  'at most one generated Entry per Target in one PlannerInput (G15); the Fixed bodies and requiresSupport never change',
  'every registered PAIR is evaluated (no early stop); PAIR selection uses the recorded results only, no extra run or composition',
])
export const D2D_PAIR_COEXISTENCE_DEFINITION = Object.freeze([
  't05.selected / t07.selected: the G of t05 / t07 is in plan.selectedBuildListEntryIds',
  'winnerBuildListEntryId: the provisional winner of a non-selected G (route commitment, as the D1 candidates[])',
  'targetSelected: the Target is in selectedTargetWeaponIds (recorded apart from selected, never corrected)',
  'conflictsBetweenPair: Conflicts with both t05.G and t07.G as participants; conflictsWithPair: Conflicts with t05.G or t07.G and another member of M',
  'pairCoexistence = t05.selected ∧ t07.selected ∧ conflictsBetweenPair = []  (diagnostic; the decision reads R5 only)',
  'd2cT05ResourcesObserved: whether each D2-C CMP-t05-c1 / -c2 within-set Conflict resource identity appears in result.conflicts (any participants)',
])
export const D2D_GATE_RULE = 'completed(PAIR) >= completed(I0) (termination.completedTargetCount of the fresh I0); R5 without the gate is r5OnlyEligible (diagnostic); eligible = evaluated ∧ R5 ∧ gate'
export const D2D_BETTER_RULE = 'completed larger, or completed equal and fewer Conflicts (steps are not compared)'
export const D2D_IMPROVED_RULE = 'improved = eligible ∧ (completed, conflicts) better than I0; equal completed and Conflict >= I0 is not improved (equalMetrics / conflictIncreased recorded)'
export const D2D_SELECTION_ORDER = Object.freeze(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'PAIR ordinal asc'])
export const D2D_RV_CHECKS = Object.freeze([
  'RV1 body: SHA-256, id, targetWeaponId, calculationContext, isStale = false, candidateSnapshot.searchRunId = the registered Search identity, SHA-256(candidateStableKey) = the registered keySha256',
  'RV2 replacement: resolveBuildListEntryReplacement(baseline, G) ready with replacedBuildListEntryId = O_t',
  'RV3 the Search-time reservation: K0 phase2c27bResolveSupportContext(baseline, t, []) (the D2-B path, with the schedule K0 context) hashing to the registered K0 digest; K1 the CTX record reservationBody (object) with pool reservationDigest = CTX reservationDigest and pool contextRecordSha256 = CTX record SHA-256',
  'RV4 R0: respectsPhase2C2Reservation(summarizePhase2C2Entry(G, baseline), G route, res(G)).respects',
  'RV5 S4: exactly one Export body of s and SHA-256(stableStringify(body)) = CTX supportBodySha256 (every CTX record of s)',
  'RV6 S5: hashStableValue(derivePlannerAlternativeReservation([Export body of s])) = CTX reservationDigest AND stableStringify(derived) = stableStringify(CTX reservationBody) (both objects; every CTX record of s)',
  'RV runs no Search, no full run, no discovery / materialization; any RV1 .. RV6 failure is a guardrail violation (the run aborts)',
])
export const D2D_ORDER = Object.freeze(['V', 'RV', 'B0', 'I0', 'PAIR 1 -> 6'])
export const D2D_DECISION_RULE = Object.freeze([
  'D2D_INVALID: any formal validity violation (§6 / §8 / §9): input_evidence / provenance / baseline_parity_mismatch / d2c_parity / guardrail / determinism / evidence_integrity / raw_result_mismatch',
  'D2D_INCOMPLETE: invalid 0 and a registered RV / B0 / I0 / PAIR is unmeasured or not_executed (a parity not_checked included); measured evidence is a lower bound',
  'D2D_GLOBAL_COMPLETE_R: invalid 0, unmeasured 0, a PAIR satisfies R6',
  'D2D_EXCEEDS_D2C_FINAL: otherwise, at least one improved PAIR',
  'D2D_SET_COEXISTENT_NOT_BETTER: otherwise, at least one PAIR with R5 satisfied',
  'D2D_NO_SET_COEXISTENCE: invalid 0, unmeasured 0, all 6 PAIRs measured with R5 not satisfied',
])
/** What D2-D deliberately does not run (§2.3). */
export const D2D_NOT_RUN = Object.freeze(['new_search', 'candidate_discovery', 'context_record_creation', 'admission', 't02_t03', 'three_or_more_targets', 'fixed_set_replacement',
  't04_t10_axis', 'pairs_outside_the_registered_six', 'pair_composition', 'multiple_passes', 'composition_order_change', 'alternative_to_alternative_support', 'oracle_comparison',
  'phase_b_d1_d2_d2c_result_rewrite', 'resolution_synthesis', 'repair_lineage', 'persistence', 'retry', 'fallback', 'production_change', 'production_default_change'])

export function d2dPolicyDrift(): string[] {
  const issues: string[] = []
  if (D2D_BUDGETS.evaluationRequestsMax !== D2D_BUDGETS.b0Evaluations + D2D_BUDGETS.i0Evaluations + D2D_BUDGETS.pairEvaluations) issues.push('the evaluation budget is not 1 + 1 + 6')
  if (D2D_BUDGETS.childProcessesMax !== D2D_BUDGETS.rvChildren + D2D_BUDGETS.evaluationRequestsMax) issues.push('the child process budget is not 1 + 8')
  if (D2D_BUDGETS.fullPlannerRunsMax !== D2D_BUDGETS.evaluationRequestsMax * D2D_EVALUATION_FULL_RUN_CAP) issues.push('the full Planner run maximum is not 8 x 8')
  if (D2D_REGISTERED_INPUT_DIGESTS.pairs.length !== D2D_PAIR_COUNT) issues.push('not 6 registered PAIR digests')
  if (D2D_RESEARCH_MAX_PLAN_STEPS !== 20_000 || D2D_EVALUATION_FULL_RUN_CAP !== 8) issues.push('the Research bound / full run cap moved')
  return issues
}

// ---------------------------------------------------------------- labels and IDs

export const d2dPairEvaluationId = (t05Ordinal: number, t07Ordinal: number) => `PAIR-t05c${t05Ordinal}-t07c${t07Ordinal}`
export const D2D_RV_UNIT_ID = 'RV'
export const D2D_RV_RECORD_FILE = 'RV.record.json'
export const d2dEvaluationRecordFile = (evaluationId: string) => `${evaluationId}.record.json`

// ---------------------------------------------------------------- the D2-C / D2 RESULT allowlists (§9.1)

export interface D2DPoolRow {
  ordinal: number
  contextId: string | null
  candidateStableKey: string | null
  keySha256: string
  searchIdentity: string
  reservationDigest: string | null
  contextRecordSha256: string | null
  requiresSupport: string[] | null
  generatedBuildListEntryId: string
  generatedEntry: { file: string; bytes: number | null; sha256: string } | null
  replacement: { status: string; replacedBuildListEntryId: string | null } | null
  r0: boolean | null
  reusedExisting: boolean | null
}
export interface D2DResultTarget { label: string; targetWeaponId: string; currentBuildListEntryId: string; pool: D2DPoolRow[] }
export interface D2DResultConflict { kind: string; participants: string[]; resourceIdentity: string | null; selectedBuildListEntryId: string | null }
export interface D2DResultEvaluation {
  evaluationId: string
  stage: string | null
  status: string
  inputDigest: string | null
  resultDigest: string | null
  generatedEntryIds: string[]
  generatedEntrySha256s: string[]
  termination: { status: string; completedTargetCount: number; totalTargetCount: number } | null
  steps: number | null
  conflictCount: number | null
  /** CMP-t05-c1 / -c2 only. */
  conflicts: D2DResultConflict[] | null
  candidates: { label: string; selected: boolean | null; winnerBuildListEntryId: string | null }[]
  r5: { satisfied: boolean | null; failureReasons: string[] } | null
  r1: boolean | null
}
export interface D2DFileRef { file: string; bytes: number | null; sha256: string | null }
export interface D2DD2CResultProjection {
  sources: { specDocument: D2DFileRef | null; d2Result: D2DFileRef | null; d2GeneratedEntriesUsedByI0: D2DFileRef[]; phase2c2Result: D2DFileRef | null; export: D2DFileRef | null;
    documents: Record<string, D2DFileRef>; d2c: { raw: D2DFileRef | null; attestation: D2DFileRef | null; contextRecords: D2DFileRef[]; generatedEntries: D2DFileRef[] } }
  provenance: { formal: unknown; measuredHead: unknown; analysisHead: unknown; runStatus: unknown; calculationCodeChangedSinceMeasuredHead: unknown; productionChangedFiles: unknown;
    startAttestationSha256: unknown; startAttestationVerified: unknown }
  invalidReasons: unknown
  decisionCase: unknown
  aggregates: { unmeasuredByReason: unknown; notExecutedByReason: unknown }
  compositionMain: { finalAccepted: { label: string; ordinal: number; contextId: string | null; generatedBuildListEntryId: string; requiresSupport: string[]; fromD2B: boolean }[];
    finalResultEvaluationId: unknown; finalMetrics: unknown; t05Step: { stepOutcome: unknown; acceptedBefore: string[] } | null }
  discoveryTargets: D2DResultTarget[]
  contexts: { contextId: string; k: number; supportBuildListEntryId: string; record: D2DFileRef | null; supportBodySha256: string | null; reservationDigest: string | null; status: string | null }[]
  evaluations: D2DResultEvaluation[]
}
export interface D2DD2ResultProjection {
  sources: { export: D2DFileRef | null; generatedEntries: D2DFileRef[] }
  provenance: { formal: unknown; measuredHead: unknown; runStatus: unknown }
  invalidReasons: unknown
  decisionCase: unknown
  discoveryTargets: D2DResultTarget[]
  evaluations: { evaluationId: string; status: string; inputDigest: string | null; resultDigest: string | null; r1: boolean | null }[]
}

const fileRef = (v: unknown): D2DFileRef | null => isObject(v) && typeof v.file === 'string'
  ? { file: v.file, bytes: typeof v.bytes === 'number' ? v.bytes : null, sha256: typeof v.sha256 === 'string' ? v.sha256 : null } : null
const fileRefs = (v: unknown): D2DFileRef[] => (Array.isArray(v) ? v : []).map(fileRef).filter((x): x is D2DFileRef => x !== null)
const poolRow = (p: Json, k1: boolean): D2DPoolRow => ({
  ordinal: p.ordinal as number, contextId: k1 && typeof p.contextId === 'string' ? p.contextId : null, candidateStableKey: typeof p.candidateStableKey === 'string' ? p.candidateStableKey : null,
  keySha256: p.keySha256 as string, searchIdentity: p.searchIdentity as string, reservationDigest: k1 && typeof p.reservationDigest === 'string' ? p.reservationDigest : null,
  contextRecordSha256: k1 && typeof p.contextRecordSha256 === 'string' ? p.contextRecordSha256 : null, requiresSupport: k1 ? strings(p.requiresSupport) : null,
  generatedBuildListEntryId: p.generatedBuildListEntryId as string, generatedEntry: fileRef(p.generatedEntry) as D2DPoolRow['generatedEntry'],
  replacement: isObject(p.replacement) ? { status: String(p.replacement.status), replacedBuildListEntryId: typeof p.replacement.replacedBuildListEntryId === 'string' ? p.replacement.replacedBuildListEntryId : null } : null,
  r0: k1 ? (typeof p.r0 === 'boolean' ? p.r0 : null) : (isObject(p.reservationCheck) && typeof p.reservationCheck.respects === 'boolean' ? p.reservationCheck.respects : null),
  reusedExisting: typeof p.reusedExisting === 'boolean' ? p.reusedExisting : null,
})
const resultTargets = (discovery: unknown, labels: readonly string[], k1: boolean): D2DResultTarget[] =>
  (isObject(discovery) && Array.isArray(discovery.targets) ? discovery.targets as unknown[] : []).filter(isObject).filter(t => labels.includes(t.label as string)).map(t => ({
    label: t.label as string, targetWeaponId: t.targetWeaponId as string, currentBuildListEntryId: t.currentBuildListEntryId as string,
    pool: (Array.isArray(t.pool) ? t.pool as unknown[] : []).filter(isObject).map(p => poolRow(p, k1)) }))

/** Reads ONLY the allowlisted D2-C RESULT fields (§9.1). */
export function projectD2DD2CResult(json: unknown): D2DD2CResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.discovery)
    || !Array.isArray(json.evaluations) || !isObject(json.composition) || !isObject(json.composition.main) || !Array.isArray(json.contexts)) return null
  const s = json.sources, p = json.provenance
  const d2 = isObject(s.d2) ? s.d2 : {}
  const d2c = isObject(s.d2c) ? s.d2c : {}
  const docs = isObject(s.documents) ? s.documents : {}
  const evals = isObject(json.aggregates.evaluations) ? json.aggregates.evaluations : {}
  const main = json.composition.main as Json
  const t05 = (Array.isArray(main.steps) ? main.steps as unknown[] : []).filter(isObject).find(st => st.label === D2D_E1_LABELS.t05) ?? null
  const evaluations: D2DResultEvaluation[] = (json.evaluations as unknown[]).filter(isObject).filter(e => D2C_EVALUATIONS_READ.includes(e.evaluationId as string)).map(e => {
    const plan = isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    const cmpT05 = String(e.evaluationId).startsWith('CMP-t05-')
    return { evaluationId: e.evaluationId as string, stage: typeof e.stage === 'string' ? e.stage : null, status: e.status as string,
      inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      generatedEntryIds: strings(e.generatedEntryIds), generatedEntrySha256s: strings(e.generatedEntrySha256s),
      termination: t === null ? null : { status: t.status as string, completedTargetCount: t.completedTargetCount as number, totalTargetCount: t.totalTargetCount as number },
      steps: plan && typeof plan.steps === 'number' ? plan.steps : null, conflictCount: Array.isArray(e.conflicts) ? e.conflicts.length : null,
      conflicts: cmpT05 && Array.isArray(e.conflicts) ? (e.conflicts as unknown[]).filter(isObject).map(c => ({ kind: c.kind as string, participants: strings(c.participants),
        resourceIdentity: typeof c.resourceIdentity === 'string' ? c.resourceIdentity : null, selectedBuildListEntryId: typeof c.selectedBuildListEntryId === 'string' ? c.selectedBuildListEntryId : null })) : null,
      candidates: (Array.isArray(e.candidates) ? e.candidates as unknown[] : []).filter(isObject).map(c => ({ label: c.label as string, selected: typeof c.selected === 'boolean' ? c.selected : null,
        winnerBuildListEntryId: typeof c.winnerBuildListEntryId === 'string' ? c.winnerBuildListEntryId : null })),
      r5: isObject(e.r5) ? { satisfied: typeof e.r5.satisfied === 'boolean' ? e.r5.satisfied : null, failureReasons: strings(e.r5.failureReasons) } : null,
      r1: isObject(e.r1r4) && typeof e.r1r4.R1 === 'boolean' ? e.r1r4.R1 : null }
  })
  return {
    sources: { specDocument: fileRef(s.specDocument), d2Result: fileRef(d2.result), d2GeneratedEntriesUsedByI0: fileRefs(d2.generatedEntriesUsedByI0), phase2c2Result: fileRef(s.phase2c2Result),
      export: fileRef(s.export), documents: Object.fromEntries(D2D_CHAINED_DOCUMENT_KEYS.map((k): [string, D2DFileRef | null] => [k, fileRef(docs[k])]).filter((x): x is [string, D2DFileRef] => x[1] !== null)),
      d2c: { raw: fileRef(d2c.raw), attestation: fileRef(d2c.attestation), contextRecords: fileRefs(d2c.contextRecords), generatedEntries: fileRefs(d2c.generatedEntries) } },
    provenance: { formal: p.formal, measuredHead: p.measuredHead, analysisHead: p.analysisHead, runStatus: p.runStatus, calculationCodeChangedSinceMeasuredHead: structuredClone(p.calculationCodeChangedSinceMeasuredHead),
      productionChangedFiles: structuredClone(p.productionChangedFiles), startAttestationSha256: isObject(p.startAttestation) ? p.startAttestation.sha256 : null,
      startAttestationVerified: isObject(p.startAttestation) ? p.startAttestation.verified : null },
    invalidReasons: structuredClone(json.invalidReasons), decisionCase: json.decision.case,
    aggregates: { unmeasuredByReason: structuredClone(evals.unmeasuredByReason), notExecutedByReason: structuredClone(evals.notExecutedByReason) },
    compositionMain: { finalAccepted: (Array.isArray(main.finalAccepted) ? main.finalAccepted as unknown[] : []).filter(isObject).map(a => ({ label: a.label as string, ordinal: a.ordinal as number,
      contextId: typeof a.contextId === 'string' ? a.contextId : null, generatedBuildListEntryId: a.generatedBuildListEntryId as string, requiresSupport: strings(a.requiresSupport), fromD2B: a.fromD2B === true })),
      finalResultEvaluationId: main.finalResultEvaluationId, finalMetrics: structuredClone(main.finalMetrics),
      t05Step: t05 === null ? null : { stepOutcome: t05.stepOutcome, acceptedBefore: strings(t05.acceptedBefore) } },
    discoveryTargets: resultTargets(json.discovery, D2C_LABELS, true),
    contexts: (json.contexts as unknown[]).filter(isObject).filter(c => D2C_CONTEXT_KS.includes(c.k as number)).map(c => ({ contextId: c.contextId as string, k: c.k as number,
      supportBuildListEntryId: c.supportBuildListEntryId as string, record: fileRef(c.record), supportBodySha256: typeof c.supportBodySha256 === 'string' ? c.supportBodySha256 : null,
      reservationDigest: typeof c.reservationDigest === 'string' ? c.reservationDigest : null, status: typeof c.status === 'string' ? c.status : null })),
    evaluations,
  }
}

/** Reads ONLY the allowlisted D2 RESULT fields (§9.1). */
export function projectD2DD2Result(json: unknown): D2DD2ResultProjection | null {
  if (!isObject(json) || !isObject(json.sources) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.discovery) || !Array.isArray(json.evaluations)) return null
  const d2 = isObject(json.sources.d2) ? json.sources.d2 : {}
  const files = new Set(D2D_G_STORE_FILES.filter(f => f.origin === 'd2b_k0').map(f => f.file))
  return {
    sources: { export: fileRef(json.sources.export), generatedEntries: fileRefs(d2.generatedEntries).filter(g => files.has(g.file)) },
    provenance: { formal: json.provenance.formal, measuredHead: json.provenance.measuredHead, runStatus: json.provenance.runStatus },
    invalidReasons: structuredClone(json.invalidReasons), decisionCase: json.decision.case,
    discoveryTargets: resultTargets(json.discovery, D2_LABELS, false),
    evaluations: (json.evaluations as unknown[]).filter(isObject).filter(e => D2_EVALUATIONS_READ.includes(e.evaluationId as string)).map(e => ({ evaluationId: e.evaluationId as string,
      status: e.status as string, inputDigest: typeof e.inputDigest === 'string' ? e.inputDigest : null, resultDigest: typeof e.resultDigest === 'string' ? e.resultDigest : null,
      r1: isObject(e.r1r4) && typeof e.r1r4.R1 === 'boolean' ? e.r1r4.R1 : null })),
  }
}

export interface D2DContextRecordProjection {
  contextId: string
  supportBuildListEntryId: string
  supportBodySha256: string
  /** The CTX record `result.reservationBody` (a JSON object, never a string). */
  reservationBody: Json
  reservationDigest: string
  status: string
}
/** §6.1 / §9.1: reads ONLY `result.{contextId, supportBuildListEntryId, supportBodySha256, reservationBody, reservationDigest, status}` (through `readD2CContextRecord()`). */
export function projectD2DContextRecord(json: unknown): { record: D2DContextRecordProjection | null; issue: string | null } {
  const read = readD2CContextRecord(json)
  if (read.issue !== null || read.record === null) return { record: null, issue: read.issue ?? 'no record' }
  const r = read.record as unknown as Json
  if (r.status !== 'context_ready') return { record: null, issue: `the CTX record status is ${String(r.status)}, not context_ready` }
  if (!isObject(r.reservationBody) || typeof r.contextId !== 'string' || typeof r.supportBuildListEntryId !== 'string' || typeof r.supportBodySha256 !== 'string' || typeof r.reservationDigest !== 'string') {
    return { record: null, issue: 'the CTX record lacks contextId / supportBuildListEntryId / supportBodySha256 / reservationDigest or its reservationBody is not a JSON object' }
  }
  return { record: { contextId: r.contextId, supportBuildListEntryId: r.supportBuildListEntryId, supportBodySha256: r.supportBodySha256, reservationBody: structuredClone(r.reservationBody),
    reservationDigest: r.reservationDigest, status: r.status }, issue: null }
}

// ---------------------------------------------------------------- the registered §3.2 PAIR table

export interface D2DSpecPairRow {
  pairOrdinal: number
  evaluationId: string
  t05Ordinal: number
  t05Suffix: string
  t07Ordinal: number
  t07Suffix: string
  generatedCount: number
  supportSuffixes: string[]
  inputDigest: string
}
const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]!)
/** The D2-D-A §3.2 registered PAIR table (the registered values; the source holds none of them). `同上` repeats the previous row's supports. */
export function parseD2DSpecPairTable(markdown: string): D2DSpecPairRow[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => /^\| PAIR ordinal \| 評価ID \| t05 \| t07 \|/.test(line))
  if (start < 0) return []
  const rows: D2DSpecPairRow[] = []
  let supports: string[] = []
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) {
    const [ordinal, id, t05, t07, , count, sup, digest] = lines[i]!.split('|').slice(1, -1).map(c => c.trim())
    const tickSup = ticks(sup ?? '')
    if (tickSup.length > 0) supports = tickSup
    const cell = (text: string) => ({ ordinal: Number(/c(\d+)/.exec(text)?.[1]), suffix: (ticks(text)[0] ?? '').replace(/^…/, '') })
    const a = cell(t05 ?? ''), b = cell(t07 ?? '')
    rows.push({ pairOrdinal: Number(ordinal), evaluationId: ticks(id ?? '')[0] ?? '', t05Ordinal: a.ordinal, t05Suffix: a.suffix, t07Ordinal: b.ordinal, t07Suffix: b.suffix,
      generatedCount: Number(count), supportSuffixes: [...supports], inputDigest: ticks(digest ?? '')[0] ?? '' })
  }
  return rows
}

// ---------------------------------------------------------------- §3.1: the mechanical derivation (V and the analyzer)

export interface D2DCandidateRef {
  label: string
  targetIndex: number
  targetWeaponId: string
  currentBuildListEntryId: string
  ordinal: number
  origin: D2DOrigin
  contextId: string | null
  /** The CTX record k (K1 only). */
  contextK: number | null
  generatedBuildListEntryId: string
  /** The registered G store file. */
  runDir: string
  file: string
  bytes: number
  sha256: string
  requiresSupport: string[]
  searchIdentity: string
  keySha256: string
  /** K1: the pool reservation digest / CTX record SHA-256 (RV3). */
  poolReservationDigest: string | null
  poolContextRecordSha256: string | null
}
export interface D2DDerivedSet {
  evaluationId: string
  stage: 'I0' | 'PAIR'
  pairOrdinal: number | null
  t05Ordinal: number | null
  t07Ordinal: number | null
  replacements: D2DCandidateRef[]
  generatedBuildListEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  inputDigest: string
  registeredInputDigest: string
}
export interface D2DDerivation {
  issues: string[]
  final: D2DCandidateRef[]
  fixed: D2DCandidateRef[]
  p07: D2DCandidateRef[]
  p05: D2DCandidateRef[]
  i0: D2DDerivedSet | null
  pairs: D2DDerivedSet[]
}

const targetIndexOf = (label: string) => Number(label.slice(1))
const sortRefs = (refs: readonly D2DCandidateRef[]) => [...refs].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))

/**
 * §3.1, mechanically, from the D2-C / D2 RESULT allowlists: F, Fixed, P07, P05, the PAIRS (t05 ordinal major) and their replacement
 * sets and `inputDigest`s (D1-A §9.4). Every G store row must be the registered file (bytes / SHA-256). Pure; never repairs a value.
 */
export function deriveD2DSets(d2c: D2DD2CResultProjection, d2: D2DD2ResultProjection, exportSha256: string): D2DDerivation {
  const issues: string[] = []
  const d2cTargets = new Map(d2c.discoveryTargets.map(t => [t.label, t]))
  const d2Targets = new Map(d2.discoveryTargets.map(t => [t.label, t]))
  const contextKOf = new Map(d2c.contexts.map(c => [c.contextId, c.k]))
  const ref = (label: string, ordinal: number, origin: D2DOrigin, contextId: string | null): D2DCandidateRef | null => {
    const target = (origin === 'd2b_k0' ? d2Targets : d2cTargets).get(label)
    if (!target) { issues.push(`${label}: no ${origin === 'd2b_k0' ? 'D2' : 'D2-C'} RESULT discovery target`); return null }
    const pool = target.pool.find(p => p.ordinal === ordinal && (origin === 'd2b_k0' || p.contextId === contextId))
    if (!pool) { issues.push(`${label} c${ordinal}: no pool row`); return null }
    const registered = D2D_G_STORE_FILES.find(f => f.label === label && f.ordinal === ordinal && f.origin === origin)
    const g = pool.generatedEntry
    const sourceBytes = origin === 'd2b_k0' ? d2.sources.generatedEntries.find(x => x.file === g?.file)?.bytes ?? null : g?.bytes ?? null
    if (!registered || g === null || g.file !== registered.file || g.sha256 !== registered.sha256 || sourceBytes !== registered.bytes) {
      issues.push(`${label} c${ordinal}: the RESULT G store row is not the registered file`); return null
    }
    if (origin === 'd2c_k1') {
      const d2cSource = d2c.sources.d2c.generatedEntries.find(x => x.file === g.file)
      if (!d2cSource || d2cSource.sha256 !== registered.sha256 || d2cSource.bytes !== registered.bytes) issues.push(`${label} c${ordinal}: the D2-C RESULT sources.d2c.generatedEntries do not name the registered file`)
    }
    if (pool.reusedExisting !== false) issues.push(`${label} c${ordinal}: reusedExisting is not false`)
    if (pool.r0 !== true) issues.push(`${label} c${ordinal}: R0 is not true`)
    if (pool.replacement?.status !== 'ready' || pool.replacement.replacedBuildListEntryId !== target.currentBuildListEntryId) issues.push(`${label} c${ordinal}: the RESULT replacement is not ready for O_t`)
    const k = contextId === null ? null : contextKOf.get(contextId) ?? null
    if (origin === 'd2c_k1' && (k === null || pool.requiresSupport === null || pool.requiresSupport.length !== 1)) issues.push(`${label} c${ordinal}: a K1 Candidate without its context / single support`)
    return { label, targetIndex: targetIndexOf(label), targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId, ordinal, origin, contextId, contextK: k,
      generatedBuildListEntryId: pool.generatedBuildListEntryId, runDir: registered.runDir, file: registered.file, bytes: registered.bytes, sha256: registered.sha256,
      requiresSupport: origin === 'd2b_k0' ? [] : [...(pool.requiresSupport ?? [])], searchIdentity: pool.searchIdentity, keySha256: pool.keySha256,
      poolReservationDigest: origin === 'd2c_k1' ? pool.reservationDigest : null, poolContextRecordSha256: origin === 'd2c_k1' ? pool.contextRecordSha256 : null }
  }
  // F
  if (d2c.compositionMain.finalResultEvaluationId !== D2D_D2C_PROVENANCE.finalResultEvaluationId) issues.push('D2-C finalResultEvaluationId is not CMP-t10-c1')
  if (!same(d2c.compositionMain.finalMetrics, { completed: D2D_I0_EXPECTED.completed, conflicts: D2D_I0_EXPECTED.conflicts, steps: D2D_I0_EXPECTED.steps })) issues.push('D2-C finalMetrics is not 23 / 20 / 1465')
  const final: D2DCandidateRef[] = []
  for (const a of d2c.compositionMain.finalAccepted) {
    const origin: D2DOrigin = a.fromD2B ? 'd2b_k0' : 'd2c_k1'
    if (a.fromD2B && (a.contextId !== null || a.requiresSupport.length !== 0)) issues.push(`${a.label}: a D2-B accepted Candidate with a context / support`)
    const r = ref(a.label, a.ordinal, origin, a.contextId)
    if (r === null) continue
    if (r.generatedBuildListEntryId !== a.generatedBuildListEntryId) issues.push(`${a.label}: the accepted G is not the pool G`)
    if (!same(r.requiresSupport, a.requiresSupport)) issues.push(`${a.label}: the accepted requiresSupport is not the pool one`)
    final.push(r)
  }
  const F = sortRefs(final)
  if (F.length !== 8 || new Set(F.map(r => r.label)).size !== 8) issues.push(`F holds ${F.length} distinct Targets, not 8`)
  const fixed = F.filter(r => r.label !== D2D_E1_LABELS.t07)
  if (fixed.length !== 7) issues.push(`Fixed holds ${fixed.length} Candidates, not 7`)
  // P07
  const d2Eval = new Map(d2.evaluations.map(e => [e.evaluationId, e]))
  const t07 = d2Targets.get(D2D_E1_LABELS.t07)
  const p07 = (t07?.pool ?? []).map(p => p.ordinal).sort((x, y) => x - y).map(o => ref(D2D_E1_LABELS.t07, o, 'd2b_k0', null)).filter((x): x is D2DCandidateRef => x !== null)
  if (p07.length !== 3) issues.push(`P07 holds ${p07.length} Candidates, not 3`)
  for (const c of p07) if (d2Eval.get(`ADM-t07-c${c.ordinal}`)?.r1 !== true) issues.push(`D2 ADM-t07-c${c.ordinal} R1 is not true`)
  const f07 = F.find(r => r.label === D2D_E1_LABELS.t07)
  if (!f07 || p07[0] === undefined || f07.generatedBuildListEntryId !== p07[0].generatedBuildListEntryId || f07.ordinal !== 1) issues.push('F[t07] is not P07[ordinal 1]')
  // P05
  const d2cEval = new Map(d2c.evaluations.map(e => [e.evaluationId, e]))
  const t05 = d2cTargets.get(D2D_E1_LABELS.t05)
  const p05 = [...(t05?.pool ?? [])].sort((x, y) => x.ordinal - y.ordinal).map(p => ref(D2D_E1_LABELS.t05, p.ordinal, 'd2c_k1', p.contextId)).filter((x): x is D2DCandidateRef => x !== null)
  if (p05.length !== 2) issues.push(`P05 holds ${p05.length} Candidates, not 2`)
  for (const c of p05) if (d2cEval.get(`ADM-t05-c${c.ordinal}`)?.r1 !== true) issues.push(`D2-C ADM-t05-c${c.ordinal} R1 is not true`)
  if (d2c.compositionMain.t05Step?.stepOutcome !== 'not_replaced_no_eligible') issues.push('D2-C composition step t05 is not not_replaced_no_eligible')
  if (F.some(r => r.label === D2D_E1_LABELS.t05)) issues.push('F already holds t05')
  const setOf = (refs: readonly D2DCandidateRef[], evaluationId: string, stage: 'I0' | 'PAIR', pairOrdinal: number | null, t05Ordinal: number | null, t07Ordinal: number | null,
    registeredInputDigest: string): D2DDerivedSet => {
    const reps = sortRefs(refs)
    if (new Set(reps.map(r => r.targetWeaponId)).size !== reps.length) issues.push(`${evaluationId}: a Target holds two Candidates (G15)`)
    const ids = reps.map(r => r.generatedBuildListEntryId), shas = reps.map(r => r.sha256)
    const inputDigest = d1InputDigest(reps.map(r => r.targetWeaponId), ids, shas, exportSha256)
    if (inputDigest !== registeredInputDigest) issues.push(`${evaluationId}: inputDigest ${inputDigest} is not the registered ${registeredInputDigest}`)
    return { evaluationId, stage, pairOrdinal, t05Ordinal, t07Ordinal, replacements: reps, generatedBuildListEntryIds: ids, generatedEntrySha256s: shas,
      requiresSupport: [...new Set(reps.flatMap(r => r.requiresSupport))].sort(compare), inputDigest, registeredInputDigest }
  }
  const i0 = F.length === 8 ? setOf(F, 'I0', 'I0', null, null, null, D2D_REGISTERED_INPUT_DIGESTS.I0) : null
  const pairs: D2DDerivedSet[] = []
  for (const a of p05) for (const b of p07) {
    const k = pairs.length
    pairs.push(setOf([...fixed, a, b], d2dPairEvaluationId(a.ordinal, b.ordinal), 'PAIR', k + 1, a.ordinal, b.ordinal, D2D_REGISTERED_INPUT_DIGESTS.pairs[k] ?? ''))
  }
  if (pairs.length !== D2D_PAIR_COUNT) issues.push(`${pairs.length} PAIRS, not 6`)
  return { issues, final: F, fixed, p07, p05, i0, pairs }
}

// ---------------------------------------------------------------- V: the registered inputs (§9.1)

export interface D2DObservedFile { bytes: number; sha256: string }
export interface D2DInputEvidence {
  /** The observed digest of every registered input (null = the file is missing). */
  files: Record<D2DRegisteredInputKey, D2DObservedFile | null>
  /** The chained documents (D2-C RESULT sources.documents), by key. */
  documents: Record<string, D2DObservedFile | null>
  /** By `d2dGStoreKey(label, ordinal)`: the G store file and its JSON. */
  gStoreFiles: Record<string, { file: D2DObservedFile; json: unknown } | null>
  /** By CTX k: the CTX record file and its JSON. */
  contextRecords: Record<number, { file: D2DObservedFile; json: unknown } | null>
  d2cResult: unknown
  d2Result: unknown
  phase2c2Result: unknown
  /** The D2-D-A document text (the measurement HEAD git object). */
  specMarkdown: string
}

export interface D2DContextData extends D2DContextRecordProjection { k: number; recordSha256: string }
export interface D2DSupportData { supportBuildListEntryId: string; contexts: D2DContextData[] }
export interface D2DPriorEvaluation { source: 'D2' | 'D2-C'; evaluationId: string; status: string; resultDigest: string | null }
export interface D2DKnownD2CEvaluation {
  evaluationId: string
  setDifference: string
  completed: number | null
  conflicts: number | null
  steps: number | null
  r5Satisfied: boolean | null
  failureReasons: string[]
  t07Selected: boolean | null
  t07Winner: string | null
  withinSetResourceIdentities: string[]
}
export interface D2DValidatedInputs {
  passed: boolean
  issues: string[]
  exportSha256: string | null
  derivation: D2DDerivation | null
  contexts: D2DContextData[]
  supports: D2DSupportData[]
  /** The D2-C CMP-t05-c1 / -c2 values for the §8.3 diagnostic. */
  knownD2C: D2DKnownD2CEvaluation[]
  /** The resource identities of the D2-C CMP-t05 within-set Conflicts (§5.2 d2cT05ResourcesObserved). */
  d2cT05ResourceIdentities: string[]
  /** inputDigest -> the allowlisted D2 / D2-C evaluations holding it (determinism_prior). */
  priorByInputDigest: Record<string, D2DPriorEvaluation[]>
  /** The B0 / I0 parity expectations: the D2-C RESULT B0 / CMP-t10-c1 values, checked equal to the registered ones (§8.1). */
  expected: { b0: D2DParityExpectation; i0: D2DParityExpectation } | null
  phase2c2BaselineSummary: unknown
}
export interface D2DParityExpectation { evaluationId: string; inputDigest: string; resultDigest: string; status: string; termination: string; completed: number; totalTargetCount: number; conflicts: number; steps: number }

/** The Export SHA-256 the D2-C RESULT `sources.export` names (a registered input), or null. */
export function d2dChainedExportSha256(d2cResult: unknown): string | null {
  const e = projectD2DD2CResult(d2cResult)?.sources.export ?? null
  return e !== null && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256) ? e.sha256 : null
}

const B0_PARITY_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'selectedTargets', 'conflicts', 'conflictsByKind', 'conflictSignatures'] as const

/**
 * V (§9.1): every registered input present with its registered digest; the D2-C / D2 RESULTs (allowlists) the registered formal runs;
 * the 12 G store bodies and the 4 CTX records the registered files, named by the D2-D text and consistent with the RESULTs; the §3.1
 * derivation equal to the §3.2 table and the §1.8 digests. Never repairs or substitutes: any issue fails D2-D closed
 * (`input_evidence`). Pure.
 */
export function validateD2DInputs(evidence: D2DInputEvidence): D2DValidatedInputs {
  const issues: string[] = [...d2dPolicyDrift()]
  const fail = (derivation: D2DDerivation | null = null): D2DValidatedInputs => ({ passed: false, issues, exportSha256: null, derivation, contexts: [], supports: [], knownD2C: [],
    d2cT05ResourceIdentities: [], priorByInputDigest: {}, expected: null, phase2c2BaselineSummary: null })
  const spec = evidence.specMarkdown
  const exportSha = d2dChainedExportSha256(evidence.d2cResult)
  if (exportSha === null || !spec.includes(exportSha)) issues.push('the chained Export SHA-256 (D2-C RESULT sources.export) is not the one the D2-D document registers')
  for (const [key, registered] of Object.entries(D2D_REGISTERED_INPUTS) as [D2DRegisteredInputKey, D2DRegisteredFile][]) {
    const observed = evidence.files[key]
    if (observed === null || observed === undefined) { issues.push(`${key}: ${registered.file} is missing`); continue }
    const expected = registered.sha256 ?? exportSha
    if (expected === null) issues.push(`${key}: no registered SHA-256 is reachable through the D2-C RESULT`)
    else if (observed.sha256 !== expected) issues.push(`${key}: SHA-256 ${observed.sha256} is not the registered ${expected}`)
    if (observed.bytes !== registered.bytes) issues.push(`${key}: ${observed.bytes} bytes, not the registered ${registered.bytes}`)
    if (registered.sha256 !== null && !d2NamesSha256(spec, registered.sha256)) issues.push(`${registered.file}: the D2-D document does not name its SHA-256`)
  }
  for (const f of D2D_G_STORE_FILES) if (!spec.includes(f.sha256)) issues.push(`${f.file}: the D2-D document does not name its SHA-256`)
  for (const c of D2D_CONTEXT_RECORDS) if (!spec.includes(c.sha256)) issues.push(`${c.file}: the D2-D document does not name its SHA-256`)
  for (const digest of [D2D_K0_RESERVATION_DIGEST, D2D_REGISTERED_INPUT_DIGESTS.I0, ...D2D_REGISTERED_INPUT_DIGESTS.pairs, D2D_B0_EXPECTED.inputDigest, D2D_B0_EXPECTED.resultDigest, D2D_I0_EXPECTED.resultDigest]) {
    if (!spec.includes(`\`${digest}\``) && !spec.includes(digest)) issues.push(`${digest}: the D2-D document does not name it`)
  }
  if (!spec.includes(D2D_D2C_PROVENANCE.measuredHead) || !spec.includes(D2D_D2_PROVENANCE.measuredHead)) issues.push('the D2-D document does not name the D2-C / D2 measured HEADs')

  // The D2-C RESULT (allowlist).
  const d2c = projectD2DD2CResult(evidence.d2cResult)
  const d2 = projectD2DD2Result(evidence.d2Result)
  if (d2c === null) { issues.push('the D2-C RESULT has no sources / provenance / decision / aggregates / discovery / evaluations / composition / contexts'); return fail() }
  if (d2 === null) { issues.push('the D2 RESULT has no sources / provenance / decision / discovery / evaluations'); return fail() }
  const p = d2c.provenance
  if (p.formal !== true) issues.push('D2-C RESULT provenance.formal is not true')
  if (p.measuredHead !== D2D_D2C_PROVENANCE.measuredHead || p.analysisHead !== D2D_D2C_PROVENANCE.measuredHead) issues.push('D2-C RESULT measuredHead / analysisHead is not the registered one')
  if (p.runStatus !== 'completed') issues.push('D2-C RESULT runStatus is not completed')
  if (!Array.isArray(p.calculationCodeChangedSinceMeasuredHead) || p.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('D2-C RESULT calculationCodeChangedSinceMeasuredHead is not []')
  if (!same(p.productionChangedFiles, { toMeasuredHead: [], toAnalysisHead: [] })) issues.push('D2-C RESULT productionChangedFiles is not []')
  if (p.startAttestationSha256 !== D2D_REGISTERED_INPUTS.d2cAttestation.sha256 || p.startAttestationVerified !== true) issues.push('D2-C RESULT start attestation is not the registered verified one')
  if (!Array.isArray(d2c.invalidReasons) || d2c.invalidReasons.length !== 0) issues.push('D2-C RESULT invalidReasons is not []')
  if (d2c.decisionCase !== D2D_D2C_PROVENANCE.decisionCase) issues.push('D2-C RESULT decision.case is not D2C_EXCEEDS_D2B_MAIN')
  if (!same(d2c.aggregates.unmeasuredByReason, {}) || !same(d2c.aggregates.notExecutedByReason, {})) issues.push('D2-C RESULT has an unmeasured / not executed evaluation')
  const src = d2c.sources
  const sameRef = (a: D2DFileRef | null, file: string, reg: { bytes: number | null; sha256: string | null }) => reg.sha256 !== null && a !== null && a.file === file && a.sha256 === reg.sha256 && (reg.bytes === null || a.bytes === null || a.bytes === reg.bytes)
  if (!sameRef(src.specDocument, D2D_REGISTERED_INPUTS.d2cSpecDocument.file, { bytes: null, sha256: D2D_REGISTERED_INPUTS.d2cSpecDocument.sha256 })) issues.push('D2-C RESULT sources.specDocument is not the registered D2-C-A document')
  if (!sameRef(src.d2Result, D2D_REGISTERED_INPUTS.d2Result.file, D2D_REGISTERED_INPUTS.d2Result)) issues.push('D2-C RESULT sources.d2.result is not the registered D2 RESULT')
  if (!sameRef(src.phase2c2Result, D2D_REGISTERED_INPUTS.phase2c2Result.file, { bytes: null, sha256: D2D_REGISTERED_INPUTS.phase2c2Result.sha256 })) issues.push('D2-C RESULT sources.phase2c2Result is not the registered one')
  if (!sameRef(src.export, D2D_REGISTERED_INPUTS.export.file, { bytes: D2D_REGISTERED_INPUTS.export.bytes, sha256: exportSha })) issues.push('D2-C RESULT sources.export is not the registered Export')
  if (!sameRef(src.d2c.raw, 'PLANNER_GLOBAL_D2C_K1_RAW.json.local', D2D_REGISTERED_INPUTS.d2cRaw)) issues.push('D2-C RESULT sources.d2c.raw is not the registered raw')
  if (!sameRef(src.d2c.attestation, 'start-attestation.json', D2D_REGISTERED_INPUTS.d2cAttestation)) issues.push('D2-C RESULT sources.d2c.attestation is not the registered attestation')
  for (const c of D2D_CONTEXT_RECORDS) if (!src.d2c.contextRecords.some(r => r.file === c.file && r.sha256 === c.sha256 && r.bytes === c.bytes)) issues.push(`${c.file}: not named by D2-C RESULT sources.d2c.contextRecords`)
  for (const f of D2D_G_STORE_FILES.filter(x => x.origin === 'd2c_k1')) if (!src.d2c.generatedEntries.some(r => r.file === f.file && r.sha256 === f.sha256 && r.bytes === f.bytes)) issues.push(`${f.file}: not named by D2-C RESULT sources.d2c.generatedEntries`)
  for (const f of D2D_G_STORE_FILES.filter(x => x.origin === 'd2b_k0' && x.label !== D2D_E1_LABELS.t07 || x.origin === 'd2b_k0' && x.ordinal === 1)) {
    if (!src.d2GeneratedEntriesUsedByI0.some(r => r.file === `${f.runDir}/${f.file}` && r.sha256 === f.sha256 && r.bytes === f.bytes)) issues.push(`${f.file}: not named by D2-C RESULT sources.d2.generatedEntriesUsedByI0`)
  }
  for (const key of D2D_CHAINED_DOCUMENT_KEYS) {
    const ref = src.documents[key] ?? null
    const observed = evidence.documents[key] ?? null
    if (ref === null || ref.sha256 === null) { issues.push(`D2-C RESULT sources.documents.${key} is missing`); continue }
    if (observed === null) { issues.push(`${ref.file}: the document is missing`); continue }
    if (observed.sha256 !== ref.sha256 || (ref.bytes !== null && observed.bytes !== ref.bytes)) issues.push(`${ref.file}: not the document D2-C RESULT sources.documents names`)
  }
  // The D2 RESULT (allowlist).
  if (d2.provenance.formal !== true) issues.push('D2 RESULT provenance.formal is not true')
  if (d2.provenance.measuredHead !== D2D_D2_PROVENANCE.measuredHead) issues.push('D2 RESULT measuredHead is not the registered one')
  if (d2.provenance.runStatus !== 'completed') issues.push('D2 RESULT runStatus is not completed')
  if (!Array.isArray(d2.invalidReasons) || d2.invalidReasons.length !== 0) issues.push('D2 RESULT invalidReasons is not []')
  if (d2.decisionCase !== D2D_D2_PROVENANCE.decisionCase) issues.push('D2 RESULT decision.case is not D2A_EXCEEDS_D1_INCUMBENT')
  if (!sameRef(d2.sources.export, D2D_REGISTERED_INPUTS.export.file, { bytes: D2D_REGISTERED_INPUTS.export.bytes, sha256: exportSha })) issues.push('D2 RESULT sources.export is not the registered Export')
  for (const f of D2D_G_STORE_FILES.filter(x => x.origin === 'd2b_k0')) if (!d2.sources.generatedEntries.some(r => r.file === f.file && r.sha256 === f.sha256 && r.bytes === f.bytes)) issues.push(`${f.file}: not named by D2 RESULT sources.d2.generatedEntries`)

  // §3.1 derivation and the §3.2 table.
  if (exportSha === null) { issues.push('no chained Export SHA-256'); return fail() }
  const derivation = deriveD2DSets(d2c, d2, exportSha)
  issues.push(...derivation.issues)
  const table = parseD2DSpecPairTable(spec)
  if (table.length !== D2D_PAIR_COUNT) issues.push(`the D2-D §3.2 table holds ${table.length} rows, not 6`)
  derivation.pairs.forEach((pair, i) => {
    const row = table[i]
    const t05 = pair.replacements.find(r => r.label === D2D_E1_LABELS.t05)
    const t07 = pair.replacements.find(r => r.label === D2D_E1_LABELS.t07)
    if (!row || !t05 || !t07 || row.pairOrdinal !== i + 1 || row.evaluationId !== pair.evaluationId || row.t05Ordinal !== pair.t05Ordinal || row.t07Ordinal !== pair.t07Ordinal
      || suffix8(t05.generatedBuildListEntryId) !== row.t05Suffix || suffix8(t07.generatedBuildListEntryId) !== row.t07Suffix || row.generatedCount !== pair.generatedBuildListEntryIds.length
      || !same([...row.supportSuffixes].sort(), pair.requiresSupport.map(suffix8).sort()) || row.inputDigest !== pair.inputDigest) issues.push(`${pair.evaluationId}: the §3.1 derivation is not the §3.2 table row ${i + 1}`)
    if (pair.generatedBuildListEntryIds.length !== 9 || pair.requiresSupport.length !== 3) issues.push(`${pair.evaluationId}: |S_G| = ${pair.generatedBuildListEntryIds.length}, |S_sup| = ${pair.requiresSupport.length}, not 9 / 3`)
  })
  if (derivation.i0 && (derivation.i0.generatedBuildListEntryIds.length !== 8 || derivation.i0.requiresSupport.length !== 2)) issues.push('I0: |S_G| / |S_sup| is not 8 / 2')

  // The G store bodies (V reads id / targetWeaponId; RV checks the rest).
  const allRefs = [...derivation.final, ...derivation.p07, ...derivation.p05]
  for (const f of D2D_G_STORE_FILES) {
    const key = d2dGStoreKey(f.label, f.ordinal)
    const observed = evidence.gStoreFiles[key] ?? null
    if (observed === null) { issues.push(`${f.file}: the G store file is missing`); continue }
    if (observed.file.sha256 !== f.sha256 || observed.file.bytes !== f.bytes) issues.push(`${f.file}: the G store file is not the registered one`)
    const r = allRefs.find(x => x.label === f.label && x.ordinal === f.ordinal && x.origin === f.origin)
    const body = isObject(observed.json) ? observed.json : null
    if (!r) { issues.push(`${f.file}: no derived Candidate uses this G store file`); continue }
    if (body === null || body.id !== r.generatedBuildListEntryId || body.targetWeaponId !== r.targetWeaponId) issues.push(`${f.file}: the body is not the derived G (id / Target)`)
  }

  // The CTX records (§1.6).
  const contexts: D2DContextData[] = []
  for (const registered of D2D_CONTEXT_RECORDS) {
    const observed = evidence.contextRecords[registered.k] ?? null
    if (observed === null) { issues.push(`${registered.file}: the CTX record is missing`); continue }
    if (observed.file.sha256 !== registered.sha256 || observed.file.bytes !== registered.bytes) issues.push(`${registered.file}: the CTX record is not the registered one`)
    const read = projectD2DContextRecord(observed.json)
    if (read.record === null) { issues.push(`${registered.file}: ${read.issue}`); continue }
    const row = d2c.contexts.find(c => c.k === registered.k)
    if (!row || row.contextId !== read.record.contextId || row.supportBuildListEntryId !== read.record.supportBuildListEntryId || row.supportBodySha256 !== read.record.supportBodySha256
      || row.reservationDigest !== read.record.reservationDigest || row.status !== 'context_ready' || row.record?.file !== registered.file || row.record.sha256 !== registered.sha256) {
      issues.push(`${registered.file}: the CTX record is not the D2-C RESULT contexts[k = ${registered.k}] row`)
    }
    if (hashStableValue(read.record.reservationBody) !== read.record.reservationDigest) issues.push(`${registered.file}: reservationBody does not hash to reservationDigest`)
    contexts.push({ ...read.record, k: registered.k, recordSha256: observed.file.sha256 })
  }
  // Every K1 Candidate names a reused CTX record; its pool reservation digest / record SHA-256 are the record's.
  for (const r of allRefs.filter(x => x.origin === 'd2c_k1')) {
    const ctx = contexts.find(c => c.k === r.contextK)
    if (!ctx || ctx.contextId !== r.contextId || !same(r.requiresSupport, [ctx.supportBuildListEntryId])) issues.push(`${r.label} c${r.ordinal}: not a Candidate of a registered CTX record`)
    else if (r.poolReservationDigest !== ctx.reservationDigest || r.poolContextRecordSha256 !== ctx.recordSha256) issues.push(`${r.label} c${r.ordinal}: the pool reservation digest / CTX record SHA-256 is not the CTX record one`)
  }
  const supportIds = [...new Set(allRefs.flatMap(r => r.requiresSupport))].sort(compare)
  const supports: D2DSupportData[] = supportIds.map(id => ({ supportBuildListEntryId: id, contexts: contexts.filter(c => c.supportBuildListEntryId === id).sort((a, b) => a.k - b.k) }))
  if (supports.length !== 3) issues.push(`${supports.length} support Entries, not 3`)
  for (const s of supports) {
    if (s.contexts.length === 0) issues.push(`${s.supportBuildListEntryId}: no CTX record`)
    const first = s.contexts[0]
    for (const c of s.contexts.slice(1)) if (first && (c.reservationDigest !== first.reservationDigest || c.supportBodySha256 !== first.supportBodySha256 || stableStringify(c.reservationBody) !== stableStringify(first.reservationBody))) {
      issues.push(`${s.supportBuildListEntryId}: CTX-${first.k} and CTX-${c.k} differ`)
    }
  }

  // The parity expectations and the §8.3 diagnostic values.
  const d2cEval = new Map(d2c.evaluations.map(e => [e.evaluationId, e]))
  const d2Eval = new Map(d2.evaluations.map(e => [e.evaluationId, e]))
  const b0c = d2cEval.get('B0'), b0d = d2Eval.get('B0')
  if (!b0c || b0c.status !== D2D_B0_EXPECTED.status || b0c.inputDigest !== D2D_B0_EXPECTED.inputDigest || b0c.resultDigest !== D2D_B0_EXPECTED.resultDigest || b0c.termination?.status !== D2D_B0_EXPECTED.termination
    || b0c.termination.completedTargetCount !== D2D_B0_EXPECTED.completed || b0c.termination.totalTargetCount !== D2D_B0_EXPECTED.totalTargetCount || b0c.conflictCount !== D2D_B0_EXPECTED.conflicts
    || b0c.steps !== D2D_B0_EXPECTED.steps) issues.push('D2-C RESULT B0 is not the registered baseline')
  if (!b0d || b0d.status !== 'evaluated' || b0d.inputDigest !== D2D_B0_EXPECTED.inputDigest || b0d.resultDigest !== D2D_B0_EXPECTED.resultDigest) issues.push('D2 RESULT B0 is not the registered baseline')
  const fin = d2cEval.get(D2D_I0_EXPECTED.evaluationId)
  if (!fin || fin.status !== D2D_I0_EXPECTED.status || fin.inputDigest !== D2D_I0_EXPECTED.inputDigest || fin.resultDigest !== D2D_I0_EXPECTED.resultDigest || fin.termination?.status !== D2D_I0_EXPECTED.termination
    || fin.termination.completedTargetCount !== D2D_I0_EXPECTED.completed || fin.termination.totalTargetCount !== D2D_I0_EXPECTED.totalTargetCount || fin.conflictCount !== D2D_I0_EXPECTED.conflicts
    || fin.steps !== D2D_I0_EXPECTED.steps || fin.r5?.satisfied !== true) issues.push('D2-C RESULT CMP-t10-c1 is not the registered D2-C final')
  if (derivation.i0 && fin && (!same(fin.generatedEntryIds, derivation.i0.generatedBuildListEntryIds) || !same(fin.generatedEntrySha256s, derivation.i0.generatedEntrySha256s))) issues.push('D2-C CMP-t10-c1 is not the derived I0 set')
  const priorByInputDigest: Record<string, D2DPriorEvaluation[]> = {}
  for (const e of d2.evaluations) if (e.inputDigest !== null) (priorByInputDigest[e.inputDigest] ??= []).push({ source: 'D2', evaluationId: e.evaluationId, status: e.status, resultDigest: e.resultDigest })
  for (const e of d2c.evaluations) if (e.inputDigest !== null) (priorByInputDigest[e.inputDigest] ??= []).push({ source: 'D2-C', evaluationId: e.evaluationId, status: e.status, resultDigest: e.resultDigest })
  for (const pair of derivation.pairs) if ((priorByInputDigest[pair.inputDigest] ?? []).length > 0) issues.push(`${pair.evaluationId}: a prior evaluation holds the PAIR inputDigest (§1.8 registers none)`)
  const knownD2C: D2DKnownD2CEvaluation[] = []
  const resourceIds = new Set<string>()
  for (const ordinal of [1, 2]) {
    const id = `CMP-t05-c${ordinal}`
    const e = d2cEval.get(id)
    if (!e || e.conflicts === null) { issues.push(`D2-C RESULT ${id} is missing`); continue }
    const gIds = new Set(e.generatedEntryIds)
    const support = new Set([...derivation.final, ...derivation.p05].filter(r => gIds.has(r.generatedBuildListEntryId)).flatMap(r => r.requiresSupport))
    const M = new Set([...gIds, ...support])
    const within = e.conflicts.filter(c => c.participants.filter(x => M.has(x)).length >= 2)
    for (const c of within) if (c.resourceIdentity !== null) resourceIds.add(c.resourceIdentity)
    const t07 = e.candidates.find(c => c.label === D2D_E1_LABELS.t07)
    knownD2C.push({ evaluationId: id, setDifference: 't10: O_t10 (D2-C CMP-t05) -> K1 t10 c1 (PAIR)', completed: e.termination?.completedTargetCount ?? null, conflicts: e.conflictCount, steps: e.steps,
      r5Satisfied: e.r5?.satisfied ?? null, failureReasons: [...(e.r5?.failureReasons ?? [])], t07Selected: t07?.selected ?? null, t07Winner: t07?.winnerBuildListEntryId ?? null,
      withinSetResourceIdentities: [...new Set(within.map(c => c.resourceIdentity).filter((x): x is string => x !== null))].sort(compare) })
  }
  const d2cT05ResourceIdentities = [...resourceIds].sort(compare)
  if (d2cT05ResourceIdentities.length === 0) issues.push('no D2-C CMP-t05 within-set Conflict resource identity')
  for (const r of d2cT05ResourceIdentities) if (!spec.includes(r)) issues.push(`${r}: the D2-D document does not name the D2-C t05 resource identity`)

  // The Phase 2-C2 baseline summary.
  const phase2c2 = isObject(evidence.phase2c2Result) && isObject(evidence.phase2c2Result.baseline) && isObject(evidence.phase2c2Result.baseline.summary) ? evidence.phase2c2Result.baseline.summary : null
  if (phase2c2 === null) issues.push('the Phase 2-C2 RESULT has no baseline.summary')
  else for (const field of B0_PARITY_FIELDS) if (!(field in phase2c2)) issues.push(`the Phase 2-C2 baseline.summary has no ${field}`)

  const passed = issues.length === 0
  if (!passed) return fail(derivation)
  const expectationOf = (e: D2DResultEvaluation): D2DParityExpectation => ({ evaluationId: e.evaluationId, inputDigest: e.inputDigest!, resultDigest: e.resultDigest!, status: e.status,
    termination: e.termination!.status, completed: e.termination!.completedTargetCount, totalTargetCount: e.termination!.totalTargetCount, conflicts: e.conflictCount!, steps: e.steps! })
  return { passed, issues, exportSha256: exportSha, derivation, contexts, supports, knownD2C, d2cT05ResourceIdentities, priorByInputDigest,
    expected: { b0: expectationOf(b0c!), i0: expectationOf(fin!) }, phase2c2BaselineSummary: structuredClone(phase2c2) }
}

// ---------------------------------------------------------------- RV (§6.1): one child, no Search, no full run

/** §6.1: the 12 RV Candidates (Fixed ∪ P07 ∪ P05), in (Target ID, ordinal) order. */
export function d2dReverificationCandidates(derivation: D2DDerivation): D2DCandidateRef[] {
  return [...derivation.fixed, ...derivation.p07, ...derivation.p05].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId) || a.ordinal - b.ordinal)
}

export interface D2DReverificationCandidate {
  label: string
  ordinal: number
  origin: D2DOrigin
  contextId: string | null
  generatedBuildListEntryId: string
  targetWeaponId: string
  currentBuildListEntryId: string
  generatedEntryFile: string
  /** The registered G store SHA-256 (RV1) and the one the child observed reading the file. */
  generatedEntrySha256: string
  searchIdentity: string
  keySha256: string
  /** K1: the CTX record (§1.6) the Candidate's Search used, and the pool values that must equal it (RV3). */
  k1: { k: number; recordSha256: string; reservationBody: Json; reservationDigest: string; poolReservationDigest: string | null; poolContextRecordSha256: string | null } | null
}
export interface D2DReverificationTask {
  unitId: string
  candidates: D2DReverificationCandidate[]
  supports: { supportBuildListEntryId: string; contexts: { k: number; supportBodySha256: string; reservationDigest: string; reservationBody: Json }[] }[]
  k0ReservationDigest: string
  researchMaxPlanSteps: number
}
export interface D2DReverificationCandidateResult {
  label: string
  ordinal: number
  origin: D2DOrigin
  contextId: string | null
  generatedBuildListEntryId: string
  generatedEntry: { file: string; sha256Observed: string }
  RV1: { bodySha256Matched: boolean; idMatched: boolean; targetMatched: boolean; calculationContextMatched: boolean; notStale: boolean; searchRunIdMatched: boolean; keySha256Matched: boolean }
  RV2: { status: string; replacedBuildListEntryId: string | null; satisfied: boolean }
  RV3: { reservationSource: 'k0_empty' | 'ctx_record'; reservationDigest: string | null; matched: boolean; issues: string[] }
  RV4: { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] }
  satisfied: boolean
}
export interface D2DReverificationSupportResult {
  supportBuildListEntryId: string
  contextRecords: number[]
  RV5: { expected: string[]; observed: string | null; exportBodies: number; matched: boolean }
  RV6: { digestExpected: string[]; digestObserved: string | null; digestMatched: boolean; bodyObserved: Json | null; bodyMatched: boolean; satisfied: boolean }
}
export interface D2DReverificationResult {
  status: 'verified' | 'guardrail_violation'
  unitId: string
  baseline: { conflictResolutions: number; maxPlanSteps: number }
  candidates: D2DReverificationCandidateResult[]
  supports: D2DReverificationSupportResult[]
  issues: string[]
}

/**
 * RV (§6.1): RV1 .. RV4 for each of the 12 Candidates and RV5 / RV6 for each support Entry, from Production parts only (the
 * replacement resolver, the K0 support context of the D2-B path with the schedule K0 context, the CTX record body, the Phase 2-C2 R0
 * check, the support reservation derivation). No Search, no full run, no discovery / materialization. Any failure is a guardrail
 * violation. `bodies[i]` is the G store body of `task.candidates[i]` and `observedSha256s[i]` the SHA-256 the child read.
 */
export function runD2DReverification(input: PlannerInput, exportBuildListEntries: readonly unknown[], schedule: Phase2C26B2C1Schedule, task: D2DReverificationTask, bodies: readonly unknown[],
  observedSha256s: readonly string[], dependencies: PlannerDependencies, sha256OfText: (text: string) => string): D2DReverificationResult {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule), ...d2dPolicyDrift()]
  if (input.conflictResolutions.length !== 0) issues.push('G1: the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2D_RESEARCH_MAX_PLAN_STEPS || task.researchMaxPlanSteps !== D2D_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (task.unitId !== D2D_RV_UNIT_ID) issues.push('unitId')
  if (bodies.length !== task.candidates.length || observedSha256s.length !== task.candidates.length) issues.push('the G store bodies do not match the candidates')
  const engine = dependencies.rngEngine
  const k0Cache = new Map<string, { reservation: unknown; digest: string | null; issues: string[] }>()
  const k0Reservation = (targetWeaponId: string, currentBuildListEntryId: string) => {
    const cached = k0Cache.get(targetWeaponId)
    if (cached) return cached
    const own: string[] = []
    const built = buildPhase2C27BTargetPlans(schedule, [targetWeaponId])
    own.push(...built.issues)
    const plan = built.plans[0]
    const k0 = plan?.contexts.find(c => c.contextRank === 1)
    const group = k0 === undefined ? undefined : schedule.snapshot.reservationGroups[k0.groupIndex]
    if (!k0 || k0.cardinality !== 0 || k0.supportBuildListEntryIds.length !== 0) own.push('P1 rank 1 is not the K0 context')
    else if (k0.reservationDigest !== task.k0ReservationDigest) own.push('the schedule K0 context digest is not the registered K0 digest')
    const resolved = phase2c27bResolveSupportContext(input, dependencies, targetWeaponId, [])
    if (resolved.status !== 'ready') { own.push(...resolved.issues); const r = { reservation: null, digest: null, issues: own }; k0Cache.set(targetWeaponId, r); return r }
    const prepared = resolved.prepared
    if (prepared.invalidated.id !== currentBuildListEntryId) own.push('the K0 context current Entry is not O_t')
    if (prepared.supportBuildListEntryIds.length !== 0) own.push('a support Entry in the K0 context')
    if (hashStableValue(prepared.origin) !== schedule.snapshot.originDigest) own.push('the Planner-start origin does not hash to the schedule snapshot origin digest')
    if (group === undefined || stableStringify(prepared.reservation) !== stableStringify(group.reservation)) own.push('the K0 reservation is not the schedule K0 group reservation')
    const digest = hashStableValue(prepared.reservation)
    if (digest !== task.k0ReservationDigest) own.push('the K0 reservation digest is not the registered K0 digest')
    const r = { reservation: prepared.reservation as unknown, digest, issues: own }
    k0Cache.set(targetWeaponId, r)
    return r
  }
  const candidates: D2DReverificationCandidateResult[] = task.candidates.map((c, i) => {
    const raw = bodies[i]
    const body = isObject(raw) ? raw as unknown as BuildListEntry : null
    const snapshot = body !== null && isObject(body.candidateSnapshot) ? body.candidateSnapshot : null
    let keySha: string | null
    try { keySha = snapshot === null ? null : sha256OfText(candidateStableKey(snapshot)) } catch { keySha = null }
    const RV1 = { bodySha256Matched: observedSha256s[i] === c.generatedEntrySha256, idMatched: body?.id === c.generatedBuildListEntryId, targetMatched: body?.targetWeaponId === c.targetWeaponId,
      calculationContextMatched: body !== null && same(body.calculationContext, D2D_CALCULATION_CONTEXT), notStale: body?.isStale === false,
      searchRunIdMatched: snapshot !== null && snapshot.searchRunId === c.searchIdentity, keySha256Matched: keySha === c.keySha256 }
    const replacement = body === null ? null : resolveBuildListEntryReplacement(input.buildListEntries, body)
    const RV2 = replacement === null ? { status: 'no_body', replacedBuildListEntryId: null, satisfied: false }
      : replacement.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: replacement.replacement.replacedBuildListEntryId as string, satisfied: replacement.replacement.replacedBuildListEntryId === c.currentBuildListEntryId }
        : { status: replacement.status, replacedBuildListEntryId: null, satisfied: false }
    let reservation: unknown = null
    const rv3: string[] = []
    let rv3Digest: string | null = null
    if (c.origin === 'd2b_k0') {
      if (c.k1 !== null) rv3.push('a K0 Candidate with a CTX record (G42)')
      const k0 = k0Reservation(c.targetWeaponId, c.currentBuildListEntryId)
      rv3.push(...k0.issues)
      reservation = k0.reservation
      rv3Digest = k0.digest
    } else if (c.k1 === null || !isObject(c.k1.reservationBody)) rv3.push('a K1 Candidate without its CTX record reservationBody object')
    else {
      reservation = c.k1.reservationBody
      rv3Digest = hashStableValue(c.k1.reservationBody)
      if (rv3Digest !== c.k1.reservationDigest) rv3.push('the CTX reservationBody does not hash to the CTX reservationDigest')
      if (c.k1.poolReservationDigest !== c.k1.reservationDigest) rv3.push('the pool reservation digest is not the CTX record reservationDigest')
      if (c.k1.poolContextRecordSha256 !== c.k1.recordSha256) rv3.push('the pool contextRecordSha256 is not the CTX record SHA-256')
    }
    const RV3 = { reservationSource: (c.origin === 'd2b_k0' ? 'k0_empty' : 'ctx_record') as 'k0_empty' | 'ctx_record', reservationDigest: rv3Digest, matched: rv3.length === 0, issues: rv3 }
    let RV4: D2DReverificationCandidateResult['RV4'] = { respects: false, blockedHits: {}, exclusiveHit: [] }
    if (body !== null && reservation !== null) {
      const r0 = respectsPhase2C2Reservation(summarizePhase2C2Entry(body, input, engine), body.candidateSnapshot.route, reservation as never)
      RV4 = { respects: r0.respects, blockedHits: structuredClone(r0.blockedHits), exclusiveHit: [...r0.exclusiveHit] }
    }
    const satisfied = Object.values(RV1).every(Boolean) && RV2.satisfied && RV3.matched && RV4.respects
    return { label: c.label, ordinal: c.ordinal, origin: c.origin, contextId: c.contextId, generatedBuildListEntryId: c.generatedBuildListEntryId,
      generatedEntry: { file: c.generatedEntryFile, sha256Observed: observedSha256s[i] ?? '' }, RV1, RV2, RV3, RV4, satisfied }
  })
  const supports: D2DReverificationSupportResult[] = task.supports.map(s => {
    const exportBodies = exportBuildListEntries.filter(e => isObject(e) && e.id === s.supportBuildListEntryId)
    const body = exportBodies.length === 1 ? exportBodies[0] as BuildListEntry : null
    const observed = body === null ? null : sha256OfText(stableStringify(body))
    const expectedSha = s.contexts.map(c => c.supportBodySha256)
    const RV5 = { expected: expectedSha, observed, exportBodies: exportBodies.length, matched: observed !== null && expectedSha.length > 0 && expectedSha.every(x => x === observed) }
    const derived = body === null ? null : derivePlannerAlternativeReservation([body], engine)
    const digestObserved = derived === null ? null : hashStableValue(derived)
    const digestMatched = digestObserved !== null && s.contexts.length > 0 && s.contexts.every(c => c.reservationDigest === digestObserved)
    const bodyMatched = derived !== null && s.contexts.length > 0 && s.contexts.every(c => isObject(c.reservationBody) && stableStringify(derived) === stableStringify(c.reservationBody))
    return { supportBuildListEntryId: s.supportBuildListEntryId, contextRecords: s.contexts.map(c => c.k), RV5,
      RV6: { digestExpected: s.contexts.map(c => c.reservationDigest), digestObserved, digestMatched, bodyObserved: derived === null ? null : structuredClone(derived) as unknown as Json, bodyMatched,
        satisfied: digestMatched && bodyMatched } }
  })
  if (task.supports.length !== 3) issues.push(`${task.supports.length} support Entries, not 3`)
  for (const c of candidates) if (!c.satisfied) issues.push(`${c.label} c${c.ordinal}: RV1 .. RV4 do not hold`)
  for (const s of supports) if (!s.RV5.matched || !s.RV6.satisfied) issues.push(`${s.supportBuildListEntryId}: RV5 / RV6 do not hold`)
  return { status: issues.length === 0 ? 'verified' : 'guardrail_violation', unitId: task.unitId, baseline: { conflictResolutions: input.conflictResolutions.length, maxPlanSteps: input.options.maxPlanSteps },
    candidates, supports, issues }
}

// ---------------------------------------------------------------- evaluations (§4.2 - §4.4, the unchanged runD2CEvaluation())

export type D2DStage = 'B0' | 'I0' | 'PAIR'
export type D2DEvaluatedAgainst = 'baseline_reference' | 'replacement_set'
export const d2dEvaluatedAgainst = (stage: D2DStage): D2DEvaluatedAgainst => stage === 'B0' ? 'baseline_reference' : 'replacement_set'
/** §13.2: the D2-C stage whose procedure a D2-D stage runs (I0 and PAIR: replacement_set, no found_R = the D2-C I0 = D2 Z0). */
export const d2dRunnerStage = (stage: D2DStage): 'B0' | 'I0' => stage === 'B0' ? 'B0' : 'I0'

export interface D2DEvaluationTask {
  evaluationId: string
  stage: D2DStage
  evaluatedAgainst: D2DEvaluatedAgainst
  pairOrdinal: number | null
  /** Ascending by Target ID. Empty for B0. */
  replacements: D2CReplacementTask[]
  researchMaxPlanSteps: number
  fullRunCap: number
}

export type D2DEvaluationChildResult = D2CEvaluationChildResult & { childRecheck?: { checked: number; issues: string[] } }

/**
 * One evaluation (§4.2 - §4.4): before the full run, RV1 (body SHA-256, id, targetWeaponId) and RV2 again for every G of the
 * evaluation (never trusting RV alone, §6.2); then the unchanged `runD2CEvaluation()` with the D2-C I0 procedure for I0 and PAIR.
 */
export async function runD2DEvaluation(input: PlannerInput, exportBuildListEntries: readonly unknown[], task: D2DEvaluationTask, generatedEntries: readonly BuildListEntry[],
  observedSha256s: readonly string[], dependencies: PlannerDependencies, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void> }): Promise<D2DEvaluationChildResult> {
  if (task.evaluatedAgainst !== d2dEvaluatedAgainst(task.stage)) return { status: 'guardrail_violation', issues: ['evaluatedAgainst is not the stage one'] }
  if ((task.stage === 'PAIR') !== (task.pairOrdinal !== null)) return { status: 'guardrail_violation', issues: ['a PAIR ordinal outside PAIR, or a PAIR without one'] }
  const recheck: string[] = []
  if (generatedEntries.length !== task.replacements.length || observedSha256s.length !== task.replacements.length) recheck.push('the G store bodies do not match the replacements')
  task.replacements.forEach((r, i) => {
    const g = generatedEntries[i]
    if (observedSha256s[i] !== r.generatedEntrySha256) recheck.push(`RV1: the G store body ${r.generatedEntryFile} SHA-256 is not the registered one`)
    if (!g || g.id !== r.generatedBuildListEntryId || g.targetWeaponId !== r.targetWeaponId) { recheck.push(`RV1: the G store body ${r.generatedEntryFile} is not the registered G (id / Target)`); return }
    const resolved = resolveBuildListEntryReplacement(input.buildListEntries, g)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== r.currentBuildListEntryId) recheck.push(`RV2: the G of ${r.generatedEntryFile} does not replace its O`)
  })
  if (recheck.length > 0) return { status: 'guardrail_violation', issues: recheck, childRecheck: { checked: task.replacements.length, issues: recheck } }
  const stage = d2dRunnerStage(task.stage)
  const result = await runD2CEvaluation(input, exportBuildListEntries, { evaluationId: task.evaluationId, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : 'replacement_set',
    replacements: task.replacements.map(r => ({ ...r, requiresSupport: [...r.requiresSupport] })), researchMaxPlanSteps: task.researchMaxPlanSteps, fullRunCap: task.fullRunCap }, generatedEntries, dependencies, options)
  return { ...result, childRecheck: { checked: task.replacements.length, issues: [] } }
}

// ---------------------------------------------------------------- task builders (the runner; the analyzer replays the same inputs)

/** The RV task from a passed V (§6.1): the 12 Candidates with their registered values and CTX records, the 3 supports with theirs. */
export function d2dReverificationTask(v: D2DValidatedInputs): D2DReverificationTask {
  if (!v.passed || v.derivation === null) throw new Error('RV needs a passed V')
  const ctxOf = (k: number | null) => v.contexts.find(c => c.k === k) ?? null
  return {
    unitId: D2D_RV_UNIT_ID,
    candidates: d2dReverificationCandidates(v.derivation).map(r => {
      const ctx = r.origin === 'd2c_k1' ? ctxOf(r.contextK) : null
      return { label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, generatedBuildListEntryId: r.generatedBuildListEntryId, targetWeaponId: r.targetWeaponId,
        currentBuildListEntryId: r.currentBuildListEntryId, generatedEntryFile: r.file, generatedEntrySha256: r.sha256, searchIdentity: r.searchIdentity, keySha256: r.keySha256,
        k1: ctx === null ? null : { k: ctx.k, recordSha256: ctx.recordSha256, reservationBody: structuredClone(ctx.reservationBody), reservationDigest: ctx.reservationDigest,
          poolReservationDigest: r.poolReservationDigest, poolContextRecordSha256: r.poolContextRecordSha256 } }
    }),
    supports: v.supports.map(s => ({ supportBuildListEntryId: s.supportBuildListEntryId, contexts: s.contexts.map(c => ({ k: c.k, supportBodySha256: c.supportBodySha256, reservationDigest: c.reservationDigest,
      reservationBody: structuredClone(c.reservationBody) })) })),
    k0ReservationDigest: D2D_K0_RESERVATION_DIGEST,
    researchMaxPlanSteps: D2D_RESEARCH_MAX_PLAN_STEPS,
  }
}

/** One evaluation task (§4.2 - §4.4): K1 replacements carry their own CTX record body object / digest / support body SHA-256 (§6.2). */
export function d2dEvaluationTask(v: D2DValidatedInputs, evaluationId: string, stage: D2DStage, pairOrdinal: number | null, replacements: readonly D2DCandidateRef[]): D2DEvaluationTask {
  return {
    evaluationId, stage, evaluatedAgainst: d2dEvaluatedAgainst(stage), pairOrdinal, researchMaxPlanSteps: D2D_RESEARCH_MAX_PLAN_STEPS, fullRunCap: D2D_EVALUATION_FULL_RUN_CAP,
    replacements: sortRefs(replacements).map(r => {
      const ctx = r.origin === 'd2c_k1' ? v.contexts.find(c => c.k === r.contextK) ?? null : null
      if (r.origin === 'd2c_k1' && ctx === null) throw new Error(`${r.label} c${r.ordinal}: no CTX record`)
      return { targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
        generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: [...r.requiresSupport], contextId: ctx === null ? null : r.contextId,
        supportReservationDigest: ctx?.reservationDigest ?? null, supportReservation: ctx === null ? null : structuredClone(ctx.reservationBody), supportBodySha256: ctx?.supportBodySha256 ?? null }
    }),
  }
}

// ---------------------------------------------------------------- judgements shared by the runner and the analyzer (§5)

/** §5.4: "(a, b) is better than (c, d)". */
export const d2dBetter = (a: { completed: number; conflicts: number }, b: { completed: number; conflicts: number }) =>
  a.completed > b.completed || (a.completed === b.completed && a.conflicts < b.conflicts)

export interface D2DSelectionMetrics { evaluationId: string; pairOrdinal: number; completed: number; conflicts: number; steps: number }
/** §5.4: completed desc, Conflicts asc, steps asc, PAIR ordinal asc (a total order). */
export function compareD2DSelection(a: D2DSelectionMetrics, b: D2DSelectionMetrics): number {
  return (b.completed - a.completed) || (a.conflicts - b.conflicts) || (a.steps - b.steps) || (a.pairOrdinal - b.pairOrdinal)
}

export interface D2DPairConflictFact { id: string; kind: string; participants: string[]; resourceIdentity: string | null; selectedBuildListEntryId: string | null }
/** §5.2 `pairCoexistence` and its parts (a diagnostic, never the decision). */
export function judgeD2DPairCoexistence(input: { t05: string; t07: string; t05Target: string; t07Target: string; members: readonly string[]; selected: readonly string[] | null; selectedTargets: readonly string[] | null;
  routeCommitment: readonly { buildListEntryId: string; provisionalOutcomeSelectedBuildListEntryId: string | null }[]; conflicts: readonly D2DPairConflictFact[]; d2cT05ResourceIdentities: readonly string[] }) {
  const selected = input.selected === null ? null : new Set(input.selected)
  const side = (id: string, target: string) => ({ generatedBuildListEntryId: id, selected: selected === null ? null : selected.has(id),
    winnerBuildListEntryId: selected !== null && !selected.has(id) ? input.routeCommitment.find(r => r.buildListEntryId === id)?.provisionalOutcomeSelectedBuildListEntryId ?? null : null,
    targetSelected: input.selectedTargets === null ? null : input.selectedTargets.includes(target) })
  const t05 = side(input.t05, input.t05Target), t07 = side(input.t07, input.t07Target)
  const strip = (c: D2DPairConflictFact) => ({ id: c.id, kind: c.kind, participants: [...c.participants], resourceIdentity: c.resourceIdentity, selectedBuildListEntryId: c.selectedBuildListEntryId })
  const between = input.conflicts.filter(c => c.participants.includes(input.t05) && c.participants.includes(input.t07)).map(strip)
  const others = new Set(input.members.filter(id => id !== input.t05 && id !== input.t07))
  const withPair = input.conflicts.filter(c => (c.participants.includes(input.t05) || c.participants.includes(input.t07)) && c.participants.some(id => others.has(id))).map(strip)
  return { t05, t07, conflictsBetweenPair: between, conflictsWithPair: withPair,
    pairCoexistence: selected === null ? null : t05.selected === true && t07.selected === true && between.length === 0,
    d2cT05ResourcesObserved: input.d2cT05ResourceIdentities.map(resourceIdentity => ({ resourceIdentity, observed: input.conflicts.some(c => c.resourceIdentity === resourceIdentity),
      participants: input.conflicts.filter(c => c.resourceIdentity === resourceIdentity).map(c => [...c.participants]) })) }
}

// ---------------------------------------------------------------- start attestation and Production audit (§9.2)

export const D2D_START_ATTESTATION_FILE = 'start-attestation.json'
export const D2D_START_ATTESTATION_PHASE = 'Issue #154 D2-D-B runner start attestation'
export const d2dProductionChangedFiles = d2ProductionChangedFiles

/** §9.2 / §11 `conditions`: the registered policy (sets, derivation, order, procedures, judgements, budgets, envelope, decision). */
export function d2dRegisteredConditions() {
  return {
    specFile: D2D_SPEC_FILE,
    baseMain: D2D_BASE_MAIN,
    pairTable: '§3.2 of the attested D2-D document (6 PAIRs, re-derived by §3.1 in V and compared)',
    derivationRule: [...D2D_DERIVATION_RULE],
    order: [...D2D_ORDER],
    i0Rule: [...D2D_I0_RULE],
    pairRule: [...D2D_PAIR_RULE],
    r5Definition: [...D1_R5_DEFINITION],
    pairCoexistenceDefinition: [...D2D_PAIR_COEXISTENCE_DEFINITION],
    gate: D2D_GATE_RULE,
    betterRule: D2D_BETTER_RULE,
    improvedRule: D2D_IMPROVED_RULE,
    selectionOrder: [...D2D_SELECTION_ORDER],
    r6Definition: [...D2C_R6_DEFINITION],
    rvChecks: [...D2D_RV_CHECKS],
    supportChecks: [...D2C_SUPPORT_CHECKS],
    supportExpiryCauses: [...D2C_SUPPORT_EXPIRY_CAUSES],
    budgets: { ...D2D_BUDGETS },
    executionEnvelope: { ...D2D_EXECUTION_ENVELOPE },
    researchMaxPlanSteps: D2D_RESEARCH_MAX_PLAN_STEPS,
    evaluationFullRunCap: D2D_EVALUATION_FULL_RUN_CAP,
    calculationContext: { ...D2D_CALCULATION_CONTEXT },
    decisionRule: [...D2D_DECISION_RULE],
    comparisonBaselines: structuredClone(D2D_COMPARISON_BASELINES) as unknown,
    registeredInputs: structuredClone(D2D_REGISTERED_INPUTS) as unknown,
    chainedDocuments: [...D2D_CHAINED_DOCUMENT_KEYS],
    gStoreFiles: D2D_G_STORE_FILES.map(f => ({ ...f })),
    contextRecords: D2D_CONTEXT_RECORDS.map(c => ({ ...c })),
    k0ReservationDigest: D2D_K0_RESERVATION_DIGEST,
    registeredInputDigests: { I0: D2D_REGISTERED_INPUT_DIGESTS.I0, pairs: [...D2D_REGISTERED_INPUT_DIGESTS.pairs] },
    b0Expected: { ...D2D_B0_EXPECTED },
    i0Expected: { ...D2D_I0_EXPECTED },
    d2cProvenance: { ...D2D_D2C_PROVENANCE },
    d2Provenance: { ...D2D_D2_PROVENANCE },
    d2cResultFieldsRead: [...D2D_D2C_RESULT_ALLOWLIST],
    d2ResultFieldsRead: [...D2D_D2_RESULT_ALLOWLIST],
    contextRecordFieldsRead: [...D2D_CONTEXT_RECORD_FIELDS_READ],
    provenanceFlags: { ...D2D_PROVENANCE_FLAGS },
    notRun: [...D2D_NOT_RUN],
  }
}

/** §9.2: the SHA-256 of `stableStringify(conditions)`. */
export const d2dRegisteredPolicySha256 = (sha256OfText: (text: string) => string) => sha256OfText(stableStringify(d2dRegisteredConditions()))

export interface D2DLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  /** The calculation code digest (the code paths at HEAD, which hold the D2-D benchmark code and every module it imports). */
  benchmarkCodeSha256: string
  /** The D2-D-A document SHA-256 from the HEAD git object. */
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The observed digest of every registered input, chained document, G store file and CTX record (V checks them against the registered ones). */
  observedInputs: Record<string, D2DObservedFile | null>
  observedDocuments: Record<string, D2DObservedFile | null>
  observedGStoreFiles: Record<string, D2DObservedFile | null>
  observedContextRecords: Record<string, D2DObservedFile | null>
  exportFileName: string
  productionAudit: { baseMain: string; baseMainIsAncestor: boolean; productionChangedSinceBaseMain: string[] }
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  appliedExecutionEnvelope: { rvBudgetMs: number; evaluationBudgetMs: number; runBudgetMs: number; childHeapMb: number; concurrency: number; retry: string; fallback: string; memorySampleIntervalMs: number; nodeYield: string }
  rngEngineVersion: string
  /** The CalculationContext the runner observed (`globalResearchInputFromExport()` at launch). */
  observedCalculationContext: unknown
  smoke: { pairs: number[] | null; maxChildren: number | null; budgetMs: number | null; skipEvaluations: boolean } | null
}

export type D2DStartAttestation = ReturnType<typeof d2dRegisteredConditions> & D2DLaunchObservation & { phase: string; attestedBy: 'runner' }

export function d2dStartAttestationBody(observation: D2DLaunchObservation): D2DStartAttestation {
  return { phase: D2D_START_ATTESTATION_PHASE, attestedBy: 'runner', ...d2dRegisteredConditions(), ...observation }
}

const EMPTY_D2D_OBSERVATION: D2DLaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '', specDocumentSha256: '',
  registeredPolicySha256: '', observedInputs: {}, observedDocuments: {}, observedGStoreFiles: {}, observedContextRecords: {}, exportFileName: '',
  productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null },
  appliedExecutionEnvelope: { ...D2D_EXECUTION_ENVELOPE }, rngEngineVersion: '', observedCalculationContext: null, smoke: null }
const D2D_ATTESTATION_KEYS = Object.keys(d2dStartAttestationBody(EMPTY_D2D_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface D2DAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  specDocumentSha256: string
  registeredPolicySha256: string
  /** The chained Export SHA-256 (`d2dChainedExportSha256()`). */
  exportSha256: string | null
  /** The D2-C RESULT `sources.documents` digests (the chained documents). */
  chainedDocuments: Record<string, string | null>
  /** When the first child started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal D2-D launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / calculation code / D2-D document
 * / registered policy equal to the independently obtained ones, every observed input / document / G store file / CTX record equal to
 * the registered digest, Production changed files = [] with the base main an ancestor, the registered Engine and CalculationContext,
 * a clean non-smoke launch, and every registered condition unchanged.
 */
export function verifyD2DStartAttestation(attestation: unknown, expected: D2DAttestationExpectation): { verified: boolean; issues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'] }
  const issues: string[] = []
  if (!same(Object.keys(attestation).sort(), D2D_ATTESTATION_KEYS)) issues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') issues.push('not attested by the runner')
  if (attestation.phase !== D2D_START_ATTESTATION_PHASE) issues.push('not a D2-D-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) issues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) issues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead) || attestation.repositoryHead !== expected.repositoryHead) issues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) issues.push('benchmarkCodeSha256 differs')
  if (attestation.specDocumentSha256 !== expected.specDocumentSha256) issues.push('specDocumentSha256 differs')
  if (attestation.registeredPolicySha256 !== expected.registeredPolicySha256) issues.push('registeredPolicySha256 differs')
  const observed = isObject(attestation.observedInputs) ? attestation.observedInputs : {}
  for (const [key, registered] of Object.entries(D2D_REGISTERED_INPUTS) as [string, D2DRegisteredFile][]) {
    const o = observed[key]
    const want = registered.sha256 ?? expected.exportSha256
    if (!isObject(o) || want === null || o.sha256 !== want || o.bytes !== registered.bytes) issues.push(`the observed ${key} is not the registered input`)
  }
  const docs = isObject(attestation.observedDocuments) ? attestation.observedDocuments : {}
  for (const key of D2D_CHAINED_DOCUMENT_KEYS) {
    const o = docs[key]
    const want = expected.chainedDocuments[key] ?? null
    if (!isObject(o) || want === null || o.sha256 !== want) issues.push(`the observed document ${key} is not the chained document`)
  }
  const g = isObject(attestation.observedGStoreFiles) ? attestation.observedGStoreFiles : {}
  for (const f of D2D_G_STORE_FILES) { const o = g[d2dGStoreKey(f.label, f.ordinal)]; if (!isObject(o) || o.sha256 !== f.sha256 || o.bytes !== f.bytes) issues.push(`the observed G store file ${f.file} is not the registered file`) }
  const ctx = isObject(attestation.observedContextRecords) ? attestation.observedContextRecords : {}
  for (const c of D2D_CONTEXT_RECORDS) { const o = ctx[String(c.k)]; if (!isObject(o) || o.sha256 !== c.sha256 || o.bytes !== c.bytes) issues.push(`the observed CTX record ${c.file} is not the registered file`) }
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || audit.baseMain !== D2D_BASE_MAIN || audit.baseMainIsAncestor !== true || !Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) issues.push('the Production audit is not clean')
  if (attestation.uncommittedBenchmarkCode !== false) issues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) issues.push('a smoke option at launch')
  if (attestation.exportFileName !== D2D_REGISTERED_INPUTS.export.file) issues.push('the Export file name is not the registered one')
  if (attestation.rngEngineVersion !== D2D_RNG_ENGINE_VERSION) issues.push('the Production RNG Engine is not the registered one')
  if (!same(attestation.observedCalculationContext, D2D_CALCULATION_CONTEXT)) issues.push('the observed CalculationContext is not the registered one')
  if (!same(attestation.appliedExecutionEnvelope, D2D_EXECUTION_ENVELOPE)) issues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(d2dRegisteredConditions())) if (!same(attestation[field], value)) issues.push(`${field} differs from the registered condition`)
  return { verified: issues.length === 0, issues }
}
