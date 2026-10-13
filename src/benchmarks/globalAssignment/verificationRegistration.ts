/**
 * Issue #154 Global Assignment Phase D-1B (Research only; never imported by the app).
 *
 * The pre-registration of the D-1C formal integration measurement (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md`,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.5 / 9.6 / 10.4 / 11 / 12 / 13.2): the Phase D' conditions, the process envelope, the
 * repeat, the provenance and identity sources, the calculation code audit and the formal validity rules D-1C must apply, each item
 * with its value, unit, basis, evidence, oracle provenance, observed range and unconfirmed range. It registers conditions only: no
 * formal run is enabled (`formalRun.enabled` is false), no measured value of D-1C is written here, and nothing here is an expected
 * outcome. The materialization conditions are the D-0C registration itself (`registeredD0cConditions()`), never a copy that could
 * drift; the items naming them are checked against it.
 *
 * Hashes live in the D-1B document only (design 11.3): the D-0C identity D-1C compares with (`registered-d0c-*` lines, copied from the
 * D-0C public RESULT of formal measurement 2) and the fingerprint of this registration (`registered-d1c-registration-fingerprint`).
 * D-1C reads both from the committed document of its measured HEAD. Plain data only: nothing here reads a file, the Repository, a
 * clock or the Export.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import {
  MATERIALIZATION_D0A2B_PROTOCOL_VERSION, MATERIALIZATION_D0B2_DOC, MATERIALIZATION_D0C_PREREGISTRATION, registeredD0cConditions,
  type D0cRegisteredItem, type ShapeMaterializationResearchConditions,
} from './materializationProtocol'
import { reachWindowW0 } from './reachTable'
import { REACH_OPTION_SET_A2, type ReachWindow } from './types'
import { d1aEnvelopeIssues, type D0cIdentityExpectation } from './verificationProtocol'
import { PLANNER_VERIFICATION_PROTOCOL_VERSION } from './verify'

export const PLANNER_VERIFICATION_D1B_PHASE = "Issue #154 Global Assignment Phase D-1B: the Phase D' verifier rules (non-physical Steps, full Planner runs) and the pre-registration of the D-1C formal integration measurement (no formal run)"
/** The Research record of Phase D-1B; it holds the registered D-0C identity block and the registration fingerprint block. */
export const PLANNER_VERIFICATION_D1B_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md'
/** The main Phase D-1B started from (PR #253 merged). Not the registration HEAD: that is the commit merging D-1B (see `registrationHead`). */
export const PLANNER_VERIFICATION_D1B_BASE_MAIN = '982b29bd84f7e57827172aa6fa061fb1ef1b9705'

/** A D-1C condition registered in D-1B: the D-0B-2 item shape (value, unit, basis, evidence, oracle provenance, ranges). */
export type D1cRegisteredItem<T> = D0cRegisteredItem<T>

/** The formal validity rules D-1C applies (design 13.2 4): every one is required; the candidate outcome is judged apart. */
export interface D1cFormalValidityRules {
  provenance: readonly string[]
  reproducibility: readonly string[]
  /** How the candidate outcome is recorded beside the validity (never merged into it). */
  candidateOutcome: readonly string[]
}

/** The calculation-related code audit D-1C applies against the registration HEAD. */
export interface D1cCalculationCodeAuditRule {
  /**
   * The Repository paths whose committed changes since the registration HEAD are listed: the `CODE_PATHS` the D-1A runner hashes and
   * checks for uncommitted code (the D-0B / D-0C ones: `src`, `scripts` and the build configuration), named here, listed in the D-1B
   * document and pinned by the registration test against the runner source.
   */
  codePaths: 'd1a-runner-code-paths'
  /** The only files D-1C may add or change there (its formal infrastructure); any other changed file refuses the formal run. */
  allowedChangedFiles: readonly string[]
  /** The one registration change D-1C may make in `verificationRegistration.ts`: enabling `formalRun` (checked by the fingerprint). */
  registrationChange: 'formal_run_enablement_only'
}

/** The interpretation of a D-1C result: formal validity, the candidate outcome and the claims kept apart. */
export interface D1cAcceptanceInterpretation {
  /** Design 13.2 acceptance: a valid formal measurement whose candidate outcome is `verified`, both together. */
  acceptance: 'formal_validity_valid_and_candidate_verified'
  /** `verified`: the registered conditions held for this candidate in both processes of both runs. */
  verified: string
  /** `best_found`: the best verified candidate among those verified (verification budget 1: at most one). */
  bestFound: string
  /** `proven_minimum`: only under design 4.6 / 10.2 (an applicable proven root lower bound equal to it and the completeness required). */
  provenMinimum: string
  /** What a verification budget of one never says. */
  notClaimed: readonly string[]
}

/** Evidence run ids (their HEADs and records are listed in PLANNER_VERIFICATION_D1B_DOC; no hash is kept in code). */
const D1A_1 = 'd1a-nonformal-1'
const D1A_2 = 'd1a-nonformal-2'
const D1B = 'd1b-nonformal'
const D0C = 'd0c-formal-2'
const DESIGN_104 = 'design 10.4'

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const W0 = reachWindowW0()
const D0C_REGISTERED = registeredD0cConditions()

/**
 * The D-1C formal conditions (Phase D-1B). `formalRun.enabled` is false: D-1C enables it after auditing that these values and the
 * measured code are unchanged since the registration HEAD, changing no other field (the registration fingerprint proves it).
 */
export const PLANNER_VERIFICATION_D1C_PREREGISTRATION = deepFreeze({
  registeredIn: 'Phase D-1B',
  materialization: {
    value: 'MATERIALIZATION_D0C_PREREGISTRATION' as const,
    unit: 'the D-0C formal materialization conditions, taken unchanged through registeredD0cConditions() (materializationProtocol.ts)',
    basis: "D-0C measured them formally (formalValidity valid, two runs, the semantic record of the D-0B-2 registration run) and D-1A re-ran them twice non-formally with the same semantic record. D-1C re-materializes under them because the D-0C records hold Entry IDs and hashes only, never Entry bodies. The D-0C formal mode is not used (its calculation code audit refuses every change since D-1A, by design).",
    evidence: [D0C, D1A_1, D1A_2, D1B],
    oracleInformed: false,
    observedRange: 'The first structural candidate (objective 1,766) materialized 43 / 43 (21 projected, 22 shape-constrained) in every run.',
    unconfirmedRange: 'Another window, option set, rule or structural candidate; another machine or Node version.',
  } satisfies D1cRegisteredItem<'MATERIALIZATION_D0C_PREREGISTRATION'>,
  reachWindow: {
    value: { ...W0 } as ReachWindow,
    unit: 'Counter positions per stream (Normal forges / Gogma positions / Skill positions); the D-0C registered window',
    basis: 'W0 = recommendedCandidateSearchDefaults (REQUIREMENTS 14.1), a constant of non-oracle origin and the D-0C registered window. The first structural candidate at W0 is the one D-0C materialized and D-1A verified; design 10.3 asks for no window expansion.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'W0 only.',
    unconfirmedRange: 'Every other rung (W1+ are unregistered).',
  } satisfies D1cRegisteredItem<ReachWindow>,
  optionSetVersion: {
    value: REACH_OPTION_SET_A2,
    unit: 'Phase A option set version (ReachOptionSetVersion); the D-0C registered option set',
    basis: 'The D-0C registration (design 19.8). Under a2 the first structural candidate equals the a1 one; D-0C and D-1A ran a2.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'The first candidate chooses no G1 / G2 continuation option.',
    unconfirmedRange: 'A continuation shape on the real Export.',
  } satisfies D1cRegisteredItem<typeof REACH_OPTION_SET_A2>,
  methodSelectionRule: {
    value: 'd0a2-v2' as const,
    unit: 'materialization rule (design D0A2 11); the D-0C registered rule',
    basis: 'The D-0C registration: continuation shapes by shape_constrained only, continuous shapes by the projected Candidate Search first, non-continuous shapes by shape_constrained only.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: '21 projected, 22 shape-constrained materializations, every independent Route check passed.',
    unconfirmedRange: 'The continuous -> shape_constrained fallback and the continuation path on the real Export (neither occurred).',
  } satisfies D1cRegisteredItem<'d0a2-v2'>,
  structuralCandidateLimit: {
    value: 1,
    unit: 'structural candidates collected and materialized per complete run; the D-0C registered limit',
    basis: 'The D-0C registration. D-1C verifies the candidate D-0C materialized formally; a later candidate needs its own registration.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'Structural candidate ordinal 0.',
    unconfirmedRange: 'Every later structural candidate (not materialized, its outcome unmeasured).',
  } satisfies D1cRegisteredItem<number>,
  verificationBudget: {
    value: 1,
    unit: "structural candidates handed to Phase D' per complete run (design 10.4 verification budget)",
    basis: "A bound on how many candidates are verified, not a search setting and no minimality proof: with one, D-1C verifies the first structural candidate only. A later candidate is not_attempted(verification_budget), never absent; a failure of the first never says that no later candidate exists, and a success never says that it is the best one.",
    evidence: [D1A_1, D1A_2, D1B, DESIGN_104],
    oracleInformed: false,
    observedRange: 'Candidate ordinal 0 only (nonformal_planner_verified in every non-formal check).',
    unconfirmedRange: 'Every later structural candidate (neither materialized nor verified), and whether one has fewer physical operations.',
  } satisfies D1cRegisteredItem<number>,
  researchMaxPlanSteps: {
    value: 20_000,
    unit: "PlannerInput.options.maxPlanSteps of the Phase D' final input (the Production Planner's Plan step bound)",
    basis: "Design 10.4 / G12: the Research maxPlanSteps of Phase D', fixed in the design before any Phase D' measurement. Not the Production default 1,000 and not derived from any known Route or Plan length (1,657, 1,766, 8,534). Reaching it is incomplete(max_plan_steps), a planner_rejected outcome; it is never raised automatically.",
    evidence: [DESIGN_104, D1A_1, D1A_2, D1B],
    oracleInformed: false,
    observedRange: 'completed at 1,766 Plan steps in every non-formal check (8.8 % of the bound).',
    unconfirmedRange: 'A Plan needing more than 20,000 Steps; the Planner time and memory near the bound.',
  } satisfies D1cRegisteredItem<number>,
  firstChildWallMs: {
    value: 1_800_000,
    unit: "milliseconds of wall-clock of one first child (re-materialization, D-0C identity, Entry set, Phase D')",
    basis: "The D-1A first child took 39.7 s and 45.1 s (materialization 33.4 / 37.5 s, Phase D' 5.1 / 6.4 s); 30 minutes is about 40x the larger and the D-0C child envelope. Reaching it is unmeasured(timeout), never a Planner result.",
    evidence: [D1A_1, D1A_2, D1B, D0C],
    oracleInformed: false,
    observedRange: 'D-1A: 39.7 s - 45.1 s per first child (the D-1B re-check is recorded in the D-1B document).',
    unconfirmedRange: 'Any first child longer than the observed ones: nothing between them and 30 minutes was run. The bound is a safety envelope, not a measured cost.',
  } satisfies D1cRegisteredItem<number>,
  freshChildWallMs: {
    value: 1_800_000,
    unit: "milliseconds of wall-clock of one fresh child (input rebuild, own Phase 0, Entry set check, Phase D')",
    basis: 'The D-1A fresh child took 7.9 s and 9.0 s; 30 minutes keeps the first child envelope (the fresh Planner runs the same Phase D\'). Reaching it is unmeasured(timeout).',
    evidence: [D1A_1, D1A_2, D1B],
    oracleInformed: false,
    observedRange: 'D-1A: 7.9 s - 9.0 s per fresh child.',
    unconfirmedRange: 'Any fresh child longer than the observed ones; the bound is a safety envelope, not a measured cost.',
  } satisfies D1cRegisteredItem<number>,
  childHeapMb: {
    value: 8_192,
    unit: 'MB passed as --max-old-space-size to every child (first and fresh)',
    basis: "D-1A heapUsed peaked at 1.43 GB / 1.03 GB in the first child (maxRSS 1.54 / 1.19 GiB) and 0.41 GB / 0.39 GB in the fresh child; P0R's fresh Planner over an 8,534-step Plan reached maxRSS 2.98 GiB. 8,192 MB is twice the D-0C child heap, so Phase D' is not measured at the materialization's limit. Out of memory is recorded only from the V8 heap-limit signature, as unmeasured.",
    evidence: [D1A_1, D1A_2, D1B, D0C],
    oracleInformed: false,
    observedRange: 'D-1A: heapUsed at most 1.43 GB (first) and 0.41 GB (fresh).',
    unconfirmedRange: 'Any heap above the observed peaks: unobserved for this candidate, and unknown for a longer Plan.',
  } satisfies D1cRegisteredItem<number>,
  concurrency: {
    value: 1,
    unit: 'children running at a time',
    basis: 'Design 12: the first child, then the fresh child, then the next complete run, one after another; no child observes another one running.',
    evidence: [D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'One child at a time in every non-formal check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<number>,
  childProcessRetry: {
    value: 'none' as const,
    unit: 'automatic re-run of a Research child process',
    basis: "G6 / G7: a timeout, an out of memory, a cancellation or a process failure is unmeasured and is never re-run automatically. Not the Production Planner's runtime-unsupported retry inside Plan generation, which is recorded as fullPlannerRuns and judged by the conditions it breaks (D-1B 4).",
    evidence: [D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'No child stopped in any non-formal check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'none'>,
  repeat: {
    value: 2,
    unit: 'complete runs per formal measurement; one complete run = one first child + one fresh child (4 children when nothing stops). Not the D-0C repeat (2 materialization children)',
    basis: 'Design 12 determinism: within each run the first and fresh verification semantic records must be equal (condition 13), and the two runs must give one materialization semantic SHA-256, one Entry fingerprint and one verification semantic SHA-256. D-1A observed one verification semantic record in two checks at two HEADs.',
    evidence: [D1A_1, D1A_2, D1B],
    oracleInformed: false,
    observedRange: 'Two non-formal checks (D-1A) with identical semantic records.',
    unconfirmedRange: 'Determinism on another machine or Node version.',
  } satisfies D1cRegisteredItem<number>,
  planner: {
    value: 'createProductionPlanWithObserver' as const,
    unit: "the Planner of Phase D' (verify.ts productionPlannerVerificationPort)",
    basis: 'The one Production entry (the deterministic scheduler, PLANNER_SPEC 7), with conflictResolutions = [] and the Research maxPlanSteps; no Beam Search oracle, no scheduler called directly, no injected port (tests only).',
    evidence: [D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'One full Planner run in every non-formal check.',
    unconfirmedRange: 'A Production runtime-unsupported retry on the real Export (synthetic only).',
  } satisfies D1cRegisteredItem<'createProductionPlanWithObserver'>,
  traceReplay: {
    value: 'replayPlannerSearchTrace_independent' as const,
    unit: "the Trace Replay of Phase D' condition 10",
    basis: "The Production Trace Replay, re-run by the verifier over the last full run's bestState against the final input, with its physical Step correspondence and its final Counters.",
    evidence: [D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'valid, 1,766 physical drafts matched one to one in every non-formal check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'replayPlannerSearchTrace_independent'>,
  freshValidation: {
    value: 'separate_node_process_required' as const,
    unit: 'condition 13 (design 9.5 (b))',
    basis: "A separate Node process rebuilds the input from the Export, derives its own Phase 0, checks the Entry set (HEAD, Export, CalculationContext, Engine, fingerprint) and runs Phase D' with a fresh Engine and fresh Planner dependencies; its verification semantic record must equal the first process's.",
    evidence: [D1A_1, D1A_2, D1B],
    oracleInformed: false,
    observedRange: 'Identical verification semantic records in every non-formal check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'separate_node_process_required'>,
  runIntegrity: {
    value: 'zero_issues_required' as const,
    unit: 'child record and checkout integrity issues of a run (d1aChildIntegrityIssues / d1aCheckoutIntegrityIssues)',
    basis: 'PR #253 Required fix: any issue makes a D-1A run invalid_run_integrity; in D-1C it makes the formal measurement invalid. An integrity failure is never a Planner outcome.',
    evidence: [D1A_2, D1B],
    oracleInformed: false,
    observedRange: '0 issues in every non-formal check since the fix.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'zero_issues_required'>,
  oracleFreeExecution: {
    value: true as const,
    unit: 'design 11.1 oracle-free execution of every child',
    basis: 'No oracle manifest / verifier / RESULT, no past RESULT read as input, no Target position of the 1,657 oracle, no post-hoc argument; oracleInformedDesign stays true (design 11.2). Every value registered here is oracleInformed false.',
    evidence: [D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'Every non-formal check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<true>,
  exportIdentity: {
    value: 'registered-export-block' as const,
    unit: `the registered-export-file / -bytes / -sha256 block of ${MATERIALIZATION_D0B2_DOC} (the D-0C registered Export)`,
    basis: 'The Export of B-2B, D-0B, D-0B-2, D-0C and D-1A, read by every parent and child from the committed document (git show HEAD:<doc>) and matched by name, length and SHA-256; the Export itself is never committed.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'That one Export.',
    unconfirmedRange: 'Any other Export.',
  } satisfies D1cRegisteredItem<'registered-export-block'>,
  d0cIdentity: {
    value: 'registered-d0c-identity-block' as const,
    unit: `the registered-d0c-materialization-semantic-sha256 / registered-d0c-entry-fingerprint lines of ${PLANNER_VERIFICATION_D1B_DOC}`,
    basis: "The values of the D-0C public RESULT (formal measurement 2: determinism.semanticSha256s and materializedEntries.fingerprint), copied into the committed D-1B document. D-1C reads them from the committed document of its measured HEAD and compares them with the values it derives from its own re-materialization, only after that re-materialization settled and before Phase D'. A mismatch stops the run before any Planner. They are comparison values only: never a command-line value, never an execution input (no Entry body and no raw record of D-0C or D-1A is read), never a hint for any search condition.",
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'Matched in every D-1A check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'registered-d0c-identity-block'>,
  calculationContext: {
    value: { ...MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value },
    unit: 'CalculationContext of the restored PlannerInput (gameVersion, Master data version, RNG Engine version, calculation schema version)',
    basis: 'The D-0C registered CalculationContext, recorded by every D-1A child. A child recording another value (another Master data, Engine or calculation version) refuses the formal run: a version change asks for a new registration.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'This CalculationContext only.',
    unconfirmedRange: 'Any other Master data, Engine or calculation version.',
  } satisfies D1cRegisteredItem<{ gameVersion: string; masterDataVersion: number; rngEngineVersion: string; appSchemaVersion: number }>,
  verificationProtocolVersion: {
    value: PLANNER_VERIFICATION_PROTOCOL_VERSION,
    unit: "protocol version of the Phase D' verification record (verify.ts)",
    basis: "D-1B revised condition 11 (three exact identities with the non-physical confirm_owned_ideal Steps) and the full-run rule (recorded, never a reason of its own), so the verification records differ from D-1A's global-assignment-d1a:1.",
    evidence: [D1B],
    oracleInformed: false,
    observedRange: 'The D-1B re-check.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<typeof PLANNER_VERIFICATION_PROTOCOL_VERSION>,
  materializationProtocolVersion: {
    value: MATERIALIZATION_D0A2B_PROTOCOL_VERSION,
    unit: 'protocol version of the re-run materialization record',
    basis: 'The D-0C registered research protocol of a d0a2-v2 run; the materialization semantic record and its protocol are not changed by D-1B.',
    evidence: [D0C, D1A_1, D1A_2],
    oracleInformed: false,
    observedRange: 'This protocol only.',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<typeof MATERIALIZATION_D0A2B_PROTOCOL_VERSION>,
  registrationHead: {
    value: 'd1b-merge-commit' as const,
    unit: 'the commit D-1C audits the calculation code against',
    basis: "The commit on main that merges the D-1B pull request (this registration). D-1B cannot know it and fixes no SHA: D-1C records it as a 40-hex constant (as D-0C did for D-0B-2), and its formal gate refuses unless that commit is an ancestor of the measured HEAD, its main merges this registration, and the registration fingerprint at the measured HEAD equals the registered-d1c-registration-fingerprint line of the committed D-1B document.",
    evidence: [D0C],
    oracleInformed: false,
    observedRange: '—',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<'d1b-merge-commit'>,
  calculationCodeAudit: {
    value: {
      codePaths: 'd1a-runner-code-paths',
      allowedChangedFiles: [
        'scripts/derive-planner-global-assignment-d1c-result.mjs',
        'scripts/derive-planner-global-assignment-d1c-result.test.ts',
        'scripts/run-planner-global-assignment-d1a.mjs',
        'scripts/run-planner-global-assignment-d1a.test.ts',
        'scripts/run-planner-global-assignment-d1c.mjs',
        'scripts/run-planner-global-assignment-d1c.test.ts',
        'src/benchmarks/globalAssignment/isolation.test.ts',
        'src/benchmarks/globalAssignment/verificationFormal.test.ts',
        'src/benchmarks/globalAssignment/verificationFormal.ts',
        'src/benchmarks/globalAssignment/verificationFormalResult.test.ts',
        'src/benchmarks/globalAssignment/verificationFormalResult.ts',
        'src/benchmarks/globalAssignment/verificationFormalTestFixture.ts',
        'src/benchmarks/globalAssignment/verificationRegistration.test.ts',
        'src/benchmarks/globalAssignment/verificationRegistration.ts',
      ],
      registrationChange: 'formal_run_enablement_only' as const,
    } as D1cCalculationCodeAuditRule,
    unit: 'committed changes under the code paths between the registration HEAD and the measured HEAD (git diff --name-only), with a clean tree',
    basis: "D-1C adds its formal guard, provenance, RESULT derivation and their tests (these files only, the runner either extended or new). Every other file - Production RNG / Search / Planner / Trace Replay, the Phase A - D' calculation (verify.ts, verificationProtocol.ts, the materialization modules), the child-process envelope, the build configuration - refuses the formal run until it is audited and registered again. A git command that cannot answer (a shallow checkout without the registration HEAD) refuses as well, never reading as no change. The D-0C formal guard keeps refusing every change since D-1A; neither its registration HEAD nor its RESULT is touched.",
    evidence: [D0C],
    oracleInformed: false,
    observedRange: 'D-0C refused its formal mode on every D-1A commit (outside its infrastructure).',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<D1cCalculationCodeAuditRule>,
  formalValidity: {
    value: {
      provenance: [
        'registration_complete', 'formal_run_enabled', 'registration_fingerprint_equals_registered_block', 'run_conditions_equal_registration', 'no_command_line_override',
        'clean_committed_head', 'registration_head_is_ancestor', 'calculation_code_audit_passed', 'production_calculation_unchanged',
        'export_identity_matched', 'calculation_context_matched', 'rng_engine_version_matched', 'master_data_version_matched', 'oracle_not_read',
        'child_gates_passed',
      ],
      reproducibility: [
        'two_complete_runs', 'first_and_fresh_separate_processes', 'planner_conditions_evaluated_in_both_processes', 'first_fresh_verification_semantic_equal',
        'runs_verification_semantic_equal', 'materialization_semantic_equals_registered_d0c', 'entry_fingerprint_equals_registered_d0c',
        'run_integrity_issues_zero', 'result_integrity_issues_zero',
      ],
      candidateOutcome: [
        'recorded_apart_from_formal_validity', 'valid_measurement_may_reject_candidate', 'planner_rejection_is_a_measured_outcome',
        'timeout_oom_cancel_process_failure_unmeasured', 'integrity_failure_is_invalid_measurement', 'verified_without_valid_provenance_not_accepted',
      ],
    } as D1cFormalValidityRules,
    unit: 'rule identifiers D-1C implements as its formalValidity checks (every one required) and as its candidate outcome rules',
    basis: "Design 13.2 4 and the D-0C formal validity: provenance (registration, HEAD, audit, Export, CalculationContext, Engine, Master, oracle, overrides, each child re-checking HEAD, conditions and input on its own) and reproducibility (two complete runs, first and fresh in separate processes, both processes completing Phase D' with every condition evaluated, first = fresh and run 1 = run 2 verification semantic records, the materialization semantic SHA-256 and the Entry fingerprint equal to the registered D-0C values, no run or RESULT integrity issue). The candidate outcome is the D-1A judgement of the run, recorded beside the validity: a valid measurement can measure a rejected candidate, a Planner rejection is a measured outcome, a timeout / OOM / cancel / process failure is unmeasured, an integrity failure is an invalid measurement, and a verified candidate under an invalid provenance is not accepted.",
    evidence: [D0C, D1A_2],
    oracleInformed: false,
    observedRange: '—',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<D1cFormalValidityRules>,
  acceptanceInterpretation: {
    value: {
      acceptance: 'formal_validity_valid_and_candidate_verified' as const,
      verified: 'The registered conditions (design 9.5, D-1B condition 11) held for the first structural candidate in both processes of both complete runs.',
      bestFound: 'The best verified candidate among the verified ones; with a verification budget of one it is the one verified candidate, never a claim about other candidates.',
      provenMinimum: 'Only when the verified physical operations equal an applicable, proven root lower bound (design 4.6 / 10.2) and the completeness the design requires holds; D-1C compares post hoc only.',
      notClaimed: ['no_later_candidate_examined', 'no_minimality_from_verification_budget', 'd1a_physical_operations_are_not_an_expected_d1c_result'],
    } as D1cAcceptanceInterpretation,
    unit: 'how a D-1C result is read (design 4.6 / 13.2)',
    basis: 'Formal validity, the candidate outcome and the claims stay apart. D-1A measured 1,766 physical operations non-formally; that value is no expected D-1C result and no success criterion. The B-2B root lower bound is 1,657, so 1,766 is not claimed minimal.',
    evidence: [D1A_1, D1A_2, 'B-2B registration'],
    oracleInformed: false,
    observedRange: '—',
    unconfirmedRange: '—',
  } satisfies D1cRegisteredItem<D1cAcceptanceInterpretation>,
  formalRun: {
    enabled: true as boolean,
    startsIn: 'D-1C' as const,
    /** Set by D-1C when it enables the formal mode (null: never enabled). */
    enabledBy: 'Phase D-1C' as string | null,
  },
})

/** A registration object of the D-1C shape (the real one by default; tests pass edited copies). */
export type D1cRegistration = typeof PLANNER_VERIFICATION_D1C_PREREGISTRATION
type D1cItemKey = Exclude<keyof D1cRegistration, 'registeredIn' | 'formalRun'>

/** The registered item keys, in registration order (for the RESULT and the tests). */
export const D1C_REGISTERED_ITEM_KEYS = Object.freeze([
  'materialization', 'reachWindow', 'optionSetVersion', 'methodSelectionRule', 'structuralCandidateLimit', 'verificationBudget', 'researchMaxPlanSteps',
  'firstChildWallMs', 'freshChildWallMs', 'childHeapMb', 'concurrency', 'childProcessRetry', 'repeat', 'planner', 'traceReplay', 'freshValidation',
  'runIntegrity', 'oracleFreeExecution', 'exportIdentity', 'd0cIdentity', 'calculationContext', 'verificationProtocolVersion', 'materializationProtocolVersion',
  'registrationHead', 'calculationCodeAudit', 'formalValidity', 'acceptanceInterpretation',
] as const satisfies readonly D1cItemKey[])

/**
 * The files whose change would change the Phase D' or materialization calculation, or the envelope and gates of earlier Phases: never
 * allowed by the D-1C audit (Production, the Phase A - D' modules, the D-0B child-process envelope and the earlier runners).
 */
const NEVER_ALLOWED = new RegExp([
  '^src\\/(?!benchmarks\\/globalAssignment\\/)',
  '\\/(?:verify|verificationProtocol|verificationTestFixture|materialize|materialization[A-Za-z]*|shape[A-Za-z]*|reach[A-Za-z]*|structural[A-Za-z]*|coverage[A-Za-z]*|assignment[A-Za-z]*|countingRngEngine|requiredOnlyReplay|context|types|testFixture)\\.ts$',
  '^scripts\\/(?:planner-global-assignment-(?:b2a|d0b)-child-process|run-planner-global-assignment-(?:b2a|d0b)|derive-planner-global-assignment-d0c-result)\\.(?:mjs|test\\.ts)$',
].join('|'))

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/**
 * Missing or invalid registered items, and items that disagree with the D-0C registration or the current protocol, by name
 * (`[]` = the D-1C registration is complete and consistent). Never a filled-in default.
 */
export function plannerVerificationD1cRegistrationIssues(registration: D1cRegistration = PLANNER_VERIFICATION_D1C_PREREGISTRATION): string[] {
  const items = registration as unknown as Record<string, Partial<D1cRegisteredItem<unknown>> | undefined>
  const issues: string[] = []
  for (const key of D1C_REGISTERED_ITEM_KEYS) {
    const item = items[key]
    if (item === undefined || item === null || item.value === undefined || item.value === null) { issues.push(`${key} is not registered.`); continue }
    for (const field of ['unit', 'basis'] as const) if (typeof item[field] !== 'string' || item[field]!.length < 3) issues.push(`${key}.${field} is missing.`)
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) issues.push(`${key}.evidence is missing.`)
    if (typeof item.oracleInformed !== 'boolean') issues.push(`${key}.oracleInformed is missing.`)
    for (const field of ['observedRange', 'unconfirmedRange'] as const) if (typeof item[field] !== 'string' || item[field]!.length === 0) issues.push(`${key}.${field} is missing.`)
  }
  if (issues.length > 0) return issues
  const r = registration
  // The materialization items name the D-0C registration and must be exactly its values.
  const d0c = D0C_REGISTERED.conditions
  if (!sameJson(r.reachWindow.value, d0c.window)) issues.push(`reachWindow ${JSON.stringify(r.reachWindow.value)} is not the D-0C registered window ${JSON.stringify(d0c.window)}.`)
  if (r.optionSetVersion.value !== d0c.reachOptionSet) issues.push(`optionSetVersion ${String(r.optionSetVersion.value)} is not the D-0C registered ${String(d0c.reachOptionSet)}.`)
  if (r.methodSelectionRule.value !== d0c.rule) issues.push(`methodSelectionRule ${String(r.methodSelectionRule.value)} is not the D-0C registered ${d0c.rule}.`)
  if (r.structuralCandidateLimit.value !== d0c.structuralCandidateLimit) issues.push(`structuralCandidateLimit ${String(r.structuralCandidateLimit.value)} is not the D-0C registered ${d0c.structuralCandidateLimit}.`)
  if (!sameJson(r.calculationContext.value, MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value)) issues.push('calculationContext is not the D-0C registered CalculationContext.')
  if (r.materializationProtocolVersion.value !== MATERIALIZATION_D0C_PREREGISTRATION.researchProtocolVersion.value) issues.push('materializationProtocolVersion is not the D-0C registered research protocol.')
  if (r.verificationProtocolVersion.value !== PLANNER_VERIFICATION_PROTOCOL_VERSION) issues.push(`verificationProtocolVersion ${String(r.verificationProtocolVersion.value)} is not the current ${PLANNER_VERIFICATION_PROTOCOL_VERSION}.`)
  // Phase D' and the envelope.
  if (!isPositiveInteger(r.verificationBudget.value)) issues.push(`verificationBudget must be a positive integer (got ${String(r.verificationBudget.value)}).`)
  else if (r.verificationBudget.value > r.structuralCandidateLimit.value) issues.push(`verificationBudget ${r.verificationBudget.value} exceeds structuralCandidateLimit ${r.structuralCandidateLimit.value} (a candidate is verified only after it was materialized).`)
  if (!isPositiveInteger(r.researchMaxPlanSteps.value)) issues.push(`researchMaxPlanSteps must be a positive integer (got ${String(r.researchMaxPlanSteps.value)}).`)
  issues.push(...d1aEnvelopeIssues({ firstChildWallMs: r.firstChildWallMs.value, freshChildWallMs: r.freshChildWallMs.value, childHeapMb: r.childHeapMb.value }).map(issue => `registered envelope: ${issue}`))
  if (r.concurrency.value !== 1) issues.push(`concurrency must be 1 (got ${String(r.concurrency.value)}).`)
  if (r.childProcessRetry.value !== 'none') issues.push(`childProcessRetry must be none (got ${String(r.childProcessRetry.value)}).`)
  if (!isPositiveInteger(r.repeat.value) || r.repeat.value < 2) issues.push(`repeat must be an integer of at least 2 complete runs (got ${String(r.repeat.value)}).`)
  if (r.oracleFreeExecution.value !== true) issues.push('oracleFreeExecution must be true.')
  // The audit never allows a calculation file, and the validity rules are named once each.
  const audit = r.calculationCodeAudit.value
  for (const file of audit.allowedChangedFiles) {
    if (!/^(?:scripts\/|src\/benchmarks\/globalAssignment\/)/.test(file) || NEVER_ALLOWED.test(file)) issues.push(`calculationCodeAudit allows ${file}, a calculation-related file.`)
  }
  if (new Set(audit.allowedChangedFiles).size !== audit.allowedChangedFiles.length) issues.push('calculationCodeAudit lists a file twice.')
  const rules = r.formalValidity.value
  for (const group of ['provenance', 'reproducibility', 'candidateOutcome'] as const) {
    if (rules[group].length === 0) issues.push(`formalValidity.${group} lists no rule.`)
    if (new Set(rules[group]).size !== rules[group].length) issues.push(`formalValidity.${group} lists a rule twice.`)
  }
  return issues
}

/** The registered D-1C conditions as plain objects: the D-0C materialization conditions, Phase D' and the envelope. */
export function registeredD1cConditions(registration: D1cRegistration = PLANNER_VERIFICATION_D1C_PREREGISTRATION): {
  materialization: ShapeMaterializationResearchConditions
  verification: { researchMaxPlanSteps: number; verificationBudget: number }
  envelope: { firstChildWallMs: number; freshChildWallMs: number; childHeapMb: number; concurrency: number; childProcessRetry: 'none'; repeat: number }
} {
  return {
    materialization: registeredD0cConditions().conditions,
    verification: { researchMaxPlanSteps: registration.researchMaxPlanSteps.value, verificationBudget: registration.verificationBudget.value },
    envelope: {
      firstChildWallMs: registration.firstChildWallMs.value, freshChildWallMs: registration.freshChildWallMs.value, childHeapMb: registration.childHeapMb.value,
      concurrency: registration.concurrency.value, childProcessRetry: registration.childProcessRetry.value, repeat: registration.repeat.value,
    },
  }
}

/** What one complete run used (a non-formal check or a formal run), compared with the registration. */
export interface D1cObservedRunConditions {
  materialization: ShapeMaterializationResearchConditions
  researchMaxPlanSteps: number
  firstChildWallMs: number
  freshChildWallMs: number
  childHeapMb: number
  concurrency: number
  childProcessRetry: string
}

/**
 * How one complete run's conditions differ from the D-1C registration, one line per differing field (`[]` = it used exactly the
 * registered values). The repeat and the verification budget belong to the whole formal measurement and are not part of one run.
 */
export function differencesFromD1cRegistration(observed: D1cObservedRunConditions): string[] {
  const registered = registeredD1cConditions()
  const differences: string[] = []
  if (!sameJson(observed.materialization, registered.materialization)) differences.push('materialization: the conditions are not the D-0C registered conditions')
  if (observed.researchMaxPlanSteps !== registered.verification.researchMaxPlanSteps) differences.push(`researchMaxPlanSteps: ${observed.researchMaxPlanSteps} (registered ${registered.verification.researchMaxPlanSteps})`)
  for (const key of ['firstChildWallMs', 'freshChildWallMs', 'childHeapMb', 'concurrency', 'childProcessRetry'] as const) {
    if (observed[key] !== registered.envelope[key]) differences.push(`${key}: ${String(observed[key])} (registered ${String(registered.envelope[key])})`)
  }
  return differences
}

/**
 * The fingerprint of the registration without `formalRun` (`hashStableValue`): D-1C may enable the formal run and change nothing else,
 * so its fingerprint must equal the `registered-d1c-registration-fingerprint` line of the committed D-1B document.
 */
export function d1cRegistrationFingerprint(registration: D1cRegistration = PLANNER_VERIFICATION_D1C_PREREGISTRATION): string {
  const items: Record<string, unknown> = { ...registration }
  delete items.formalRun
  return hashStableValue(items)
}

function singleLines(markdown: string, keys: readonly string[]): { values: Map<string, string>; issues: string[] } {
  const found = new Map<string, string[]>()
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^([a-z0-9-]+):\s*(\S+)\s*$/.exec(line.trim())
    if (match && keys.includes(match[1]!)) found.set(match[1]!, [...(found.get(match[1]!) ?? []), match[2]!])
  }
  const issues: string[] = []
  const values = new Map<string, string>()
  for (const key of keys) {
    const count = found.get(key)?.length ?? 0
    if (count !== 1) issues.push(`${key}: expected exactly one line, found ${count}.`)
    else values.set(key, found.get(key)![0]!)
  }
  return { values, issues }
}

const D0C_SEMANTIC_KEY = 'registered-d0c-materialization-semantic-sha256'
const D0C_FINGERPRINT_KEY = 'registered-d0c-entry-fingerprint'
const REGISTRATION_FINGERPRINT_KEY = 'registered-d1c-registration-fingerprint'

/**
 * The D-0C identity D-1C compares its re-materialization with, read from the text of `PLANNER_VERIFICATION_D1B_DOC` (exactly one line
 * each; anything else is an issue, never a guessed value).
 */
export function readD1cRegisteredD0cIdentity(markdown: string): { identity: D0cIdentityExpectation; issues: [] } | { identity: null; issues: string[] } {
  const { values, issues } = singleLines(markdown, [D0C_SEMANTIC_KEY, D0C_FINGERPRINT_KEY])
  if (issues.length > 0) return { identity: null, issues }
  const semanticSha256 = values.get(D0C_SEMANTIC_KEY)!
  const entryFingerprint = values.get(D0C_FINGERPRINT_KEY)!
  if (!/^[0-9a-f]{64}$/.test(semanticSha256)) issues.push(`${D0C_SEMANTIC_KEY}: must be 64 lower-case hex characters.`)
  if (!/^fnv1a32:[0-9a-f]{8}$/.test(entryFingerprint)) issues.push(`${D0C_FINGERPRINT_KEY}: must be fnv1a32:<8 lower-case hex>.`)
  return issues.length > 0 ? { identity: null, issues } : { identity: { semanticSha256, entryFingerprint }, issues: [] }
}

/** The registration fingerprint recorded in `PLANNER_VERIFICATION_D1B_DOC` (exactly one line). */
export function readD1cRegisteredRegistrationFingerprint(markdown: string): { fingerprint: string; issues: [] } | { fingerprint: null; issues: string[] } {
  const { values, issues } = singleLines(markdown, [REGISTRATION_FINGERPRINT_KEY])
  if (issues.length > 0) return { fingerprint: null, issues }
  const fingerprint = values.get(REGISTRATION_FINGERPRINT_KEY)!
  return /^fnv1a32:[0-9a-f]{8}$/.test(fingerprint) ? { fingerprint, issues: [] } : { fingerprint: null, issues: [`${REGISTRATION_FINGERPRINT_KEY}: must be fnv1a32:<8 lower-case hex>.`] }
}

/**
 * Why a D-1C formal run must not start by its registration alone (`[]` = the registration lets it start; D-1C's own formal gate decides
 * the rest). D-1B registers the conditions with the formal run disabled; a disabled or incomplete registration is refused.
 */
export function d1cFormalRunIssues(registration: D1cRegistration = PLANNER_VERIFICATION_D1C_PREREGISTRATION): string[] {
  const issues: string[] = []
  if ((registration.formalRun as { enabled?: unknown } | undefined)?.enabled !== true) {
    issues.push('A D-1C formal run is not enabled (PLANNER_VERIFICATION_D1C_PREREGISTRATION.formalRun.enabled is false): Phase D-1B registers the conditions only; D-1C enables the formal mode after auditing them.')
  }
  const registrationIssues = plannerVerificationD1cRegistrationIssues(registration)
  if (registrationIssues.length > 0) issues.push(`The D-1C pre-registration is incomplete: ${registrationIssues.join(' ')}`)
  return issues
}

/** The registered item keys with a value, as the D-1C RESULT lists them. */
export function d1cRegisteredItemKeys(): readonly D1cItemKey[] {
  return D1C_REGISTERED_ITEM_KEYS
}
