/**
 * Issue #154 Global Assignment Phase D-1C (Research only; never imported by the app).
 *
 * The formal measurement contract of the Phase D' integration acceptance (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md`,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.5 / 9.6 / 12 / 13.2): the start gate a formal parent applies before it writes anything,
 * the gate every formal child re-applies from its own observations, the integrity of each complete run and of the whole measurement,
 * the formal validity (the 15 provenance and 9 reproducibility rules registered in `PLANNER_VERIFICATION_D1C_PREREGISTRATION`, each
 * judged from the recorded observations, never listed as passed), the candidate outcome (the D-1A judgement of each complete run, kept
 * apart from the validity), the acceptance (both together) and the post hoc readings. Every condition comes from the D-1B registration
 * (`registeredD1cExpectation()`); nothing here changes, defaults or overrides a registered value.
 *
 * Plain data only: nothing here touches a file, the checkout, a clock or the Export (the runner script observes them and passes them in),
 * runs no Planner, Trace Replay, Search or materialization, and reads no oracle, lower bound or earlier RESULT. A valid formal measurement
 * can measure a rejected candidate; a verified candidate under an invalid measurement is never accepted.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import type { ExportIdentity } from './assignmentProtocol'
import { d0cExportIdentityDifferences, readD0cRegisteredExportIdentity } from './materializationProtocol'
import {
  concludeD1aRun, d1aCheckoutIntegrityIssues, d1aChildIntegrityIssues, d1aOperationCountReading, D1A_INCUMBENT_PHYSICAL_OPERATIONS,
  type D0cIdentityComparison, type D0cIdentityExpectation, type D1aCheckoutState, type D1aChildReading, type D1aProcessOutcome, type D1aRunConclusion, type D1aVerdict,
} from './verificationProtocol'
import {
  d1cFormalRunIssues, d1cRegistrationFingerprint, PLANNER_VERIFICATION_D1C_PREREGISTRATION, plannerVerificationD1cRegistrationIssues, readD1cRegisteredD0cIdentity,
  readD1cRegisteredRegistrationFingerprint, registeredD1cConditions, type D1cRegistration,
} from './verificationRegistration'
import type { PlannerConditionChecks, PlannerVerificationSemantic } from './verify'

export const PLANNER_VERIFICATION_D1C_PHASE = "Issue #154 Global Assignment Phase D-1C: formal integration acceptance of the D-1B registered conditions (re-materialization of the first structural candidate, Production Planner, independent Trace Replay, fresh ordinary Planner in a separate process; two complete runs)"
/** The Research record of Phase D-1C. */
export const PLANNER_VERIFICATION_D1C_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md'
/**
 * The registration HEAD: PR #254 (Phase D-1B, the registration) merged into main. A formal run audits the calculation-related code it
 * measures against this commit, and reads the registered fingerprint block of the D-1B document at it.
 */
export const PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD = 'd15ea9b0277b417b2681305486b6fb03dda57054'
/** The formal runner's own protocol (task, child record formal block, RESULT shape); not the verification or materialization protocol. */
export const D1C_FORMAL_PROTOCOL_VERSION = 'global-assignment-d1c-formal:1'
/** The only command-line options of a formal parent: every condition and every comparison value comes from the registration. */
export const D1C_FORMAL_OPTIONS = Object.freeze(['--mode', '--export', '--run-dir', '--output'] as const)
/** The options of a formal child (spawned by the parent; a hand-written task still passes the child gate or nothing is computed). */
export const D1C_CHILD_OPTIONS = Object.freeze(['--role', '--export', '--task', '--record', '--journal'] as const)
export const D1C_ROLES = Object.freeze(['first', 'fresh'] as const)
export type D1cRole = (typeof D1C_ROLES)[number]
/** The Phase D' conditions every process must evaluate and record (verify.ts `PlannerConditionChecks`, D-1B condition 11). */
export const D1C_CONDITION_CHECK_KEYS = Object.freeze([
  'planPresent', 'terminationCompleted', 'completedEqualsPlanningTargets', 'totalEqualsPlanningTargets', 'allPlanningEntriesSelected', 'noConflicts',
  'noRejectedEntries', 'noResourceConflicts', 'noWarnings', 'traceReplayValid', 'physicalStepCountIdentity', 'physicalStreamAdvanceIdentity', 'physicalObjectiveIdentity',
] as const satisfies readonly (keyof PlannerConditionChecks)[])
/** The checks the Planner stage evaluates whenever the Planner ran (the physical identities need a Plan). */
const PLANNER_STAGE_CHECKS = D1C_CONDITION_CHECK_KEYS.slice(0, 10)
const PHYSICAL_CHECKS = D1C_CONDITION_CHECK_KEYS.slice(10)
/** Production source and its build / dependency configuration: never changed by a Research measurement (design 13.2 4). */
const PRODUCTION_CALCULATION_FILE = /^src\/(?!benchmarks\/|test\/)|^(?:package\.json|package-lock\.json|vite\.config\.ts|tsconfig(?:\.app|\.node)?\.json)$/
/** An input name that would be an oracle, a lower bound, a post-hoc argument or an earlier RESULT (design 11.1). */
const ORACLE_INPUT = /oracle|_RESULT|--optimum|lowerBound|LowerBound/i

const REGISTRATION = PLANNER_VERIFICATION_D1C_PREREGISTRATION
/**
 * The formal validity rules this module implements, by name. They must be exactly the registered ones (`formalValidity.value`): the
 * judgement refuses to run otherwise, so a registered rule can never be skipped and no unregistered rule can be added.
 */
export const D1C_PROVENANCE_RULES = Object.freeze([
  'registration_complete', 'formal_run_enabled', 'registration_fingerprint_equals_registered_block', 'run_conditions_equal_registration', 'no_command_line_override',
  'clean_committed_head', 'registration_head_is_ancestor', 'calculation_code_audit_passed', 'production_calculation_unchanged',
  'export_identity_matched', 'calculation_context_matched', 'rng_engine_version_matched', 'master_data_version_matched', 'oracle_not_read',
  'child_gates_passed',
] as const)
export const D1C_REPRODUCIBILITY_RULES = Object.freeze([
  'two_complete_runs', 'first_and_fresh_separate_processes', 'planner_conditions_evaluated_in_both_processes', 'first_fresh_verification_semantic_equal',
  'runs_verification_semantic_equal', 'materialization_semantic_equals_registered_d0c', 'entry_fingerprint_equals_registered_d0c',
  'run_integrity_issues_zero', 'result_integrity_issues_zero',
] as const)
export type D1cProvenanceRule = (typeof D1C_PROVENANCE_RULES)[number]
export type D1cReproducibilityRule = (typeof D1C_REPRODUCIBILITY_RULES)[number]

const isSha1 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const lastSegment = (path: string) => path.split(/[\\/]+/).filter(Boolean).at(-1) ?? ''
/** The run directory of complete run `runIndex` inside the formal run directory. */
export const d1cRunDirectoryName = (runIndex: number) => `run-${runIndex}`

// ---------------------------------------------------------------------------------------------------------------------
// The registered expectation
// ---------------------------------------------------------------------------------------------------------------------

export interface D1cCalculationContext {
  gameVersion: string
  masterDataVersion: number
  rngEngineVersion: string
  appSchemaVersion: number
}

/** What a formal run must have used, all taken from the registration (the scripts never pass another one; tests pass synthetic ones). */
export interface D1cRegisteredExpectation {
  conditions: ReturnType<typeof registeredD1cConditions>
  calculationContext: D1cCalculationContext
  verificationProtocolVersion: string
  materializationProtocolVersion: string
  registrationHead: string
}

export function registeredD1cExpectation(registration: D1cRegistration = REGISTRATION): D1cRegisteredExpectation {
  return {
    conditions: registeredD1cConditions(registration),
    calculationContext: { ...registration.calculationContext.value },
    verificationProtocolVersion: registration.verificationProtocolVersion.value,
    materializationProtocolVersion: registration.materializationProtocolVersion.value,
    registrationHead: PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The committed documents: registration fingerprint, D-0C identity, registered Export
// ---------------------------------------------------------------------------------------------------------------------

/** A committed document as the script read it (`git show <commit>:<doc>`); `text` is null when git could not answer. */
export interface D1cCommittedDocument {
  source: string
  text: string | null
  error: string | null
}

export interface D1cRegistrationObservation {
  registeredIn: string
  formalRunEnabled: boolean
  enabledBy: string | null
  /** `plannerVerificationD1cRegistrationIssues()` (`[]` = complete and consistent). */
  registrationIssues: string[]
  /** `d1cFormalRunIssues()` (`[]` = the registration lets a formal run start). */
  formalRunIssues: string[]
  fingerprint: { computed: string; atMeasuredHead: string | null; atRegistrationHead: string | null; matched: boolean; issues: string[] }
}

function documentUnreadable(document: D1cCommittedDocument, what: string): string {
  return `${what} could not be read from ${document.source}: ${document.error ?? 'no text'}`
}

/**
 * The registration as one process observes it: complete, enabled, and fingerprinted exactly as the `registered-d1c-registration-fingerprint`
 * line of the committed D-1B document at the measured HEAD and at the registration HEAD (both must be the same line; a later edit of the
 * block cannot move it).
 */
export function observeD1cRegistration(documents: { atMeasuredHead: D1cCommittedDocument; atRegistrationHead: D1cCommittedDocument }, registration: D1cRegistration = REGISTRATION): D1cRegistrationObservation {
  const computed = d1cRegistrationFingerprint(registration)
  const issues: string[] = []
  const read = (document: D1cCommittedDocument, where: string): string | null => {
    if (document.text === null) { issues.push(documentUnreadable(document, `The registered fingerprint block at the ${where}`)); return null }
    const parsed = readD1cRegisteredRegistrationFingerprint(document.text)
    if (parsed.fingerprint === null) issues.push(...parsed.issues.map(issue => `${document.source}: ${issue}`))
    return parsed.fingerprint
  }
  const atMeasuredHead = read(documents.atMeasuredHead, 'measured HEAD')
  const atRegistrationHead = read(documents.atRegistrationHead, 'registration HEAD')
  if (atMeasuredHead !== null && computed !== atMeasuredHead) issues.push(`The registration fingerprint ${computed} is not the registered ${atMeasuredHead}: a registered item changed since D-1B.`)
  if (atMeasuredHead !== null && atRegistrationHead !== null && atMeasuredHead !== atRegistrationHead) {
    issues.push(`The registered fingerprint block at the measured HEAD (${atMeasuredHead}) is not the one at the registration HEAD (${atRegistrationHead}).`)
  }
  const formalRun = registration.formalRun as { enabled?: unknown; enabledBy?: unknown }
  return {
    registeredIn: registration.registeredIn, formalRunEnabled: formalRun.enabled === true, enabledBy: typeof formalRun.enabledBy === 'string' ? formalRun.enabledBy : null,
    registrationIssues: plannerVerificationD1cRegistrationIssues(registration), formalRunIssues: d1cFormalRunIssues(registration),
    fingerprint: { computed, atMeasuredHead, atRegistrationHead, matched: issues.length === 0, issues },
  }
}

export interface D1cRegisteredD0cObservation {
  /** The registered D-0C identity of the committed D-1B document at the measured HEAD (null when it is unreadable or ambiguous). */
  identity: D0cIdentityExpectation | null
  atRegistrationHead: D0cIdentityExpectation | null
  issues: string[]
}

/** The D-0C identity a re-run materialization must reproduce: the D-1B block at the measured HEAD, equal to the one at the registration HEAD. */
export function observeD1cRegisteredD0c(documents: { atMeasuredHead: D1cCommittedDocument; atRegistrationHead: D1cCommittedDocument }): D1cRegisteredD0cObservation {
  const issues: string[] = []
  const read = (document: D1cCommittedDocument, where: string): D0cIdentityExpectation | null => {
    if (document.text === null) { issues.push(documentUnreadable(document, `The registered D-0C identity at the ${where}`)); return null }
    const parsed = readD1cRegisteredD0cIdentity(document.text)
    if (parsed.identity === null) issues.push(...parsed.issues.map(issue => `${document.source}: ${issue}`))
    return parsed.identity
  }
  const atMeasuredHead = read(documents.atMeasuredHead, 'measured HEAD')
  const atRegistrationHead = read(documents.atRegistrationHead, 'registration HEAD')
  if (atMeasuredHead !== null && atRegistrationHead !== null && !sameJson(atMeasuredHead, atRegistrationHead)) {
    issues.push('The registered D-0C identity at the measured HEAD is not the one at the registration HEAD.')
  }
  return { identity: issues.length === 0 ? atMeasuredHead : null, atRegistrationHead, issues }
}

export interface D1cRegisteredExportObservation {
  source: string
  identity: ExportIdentity | null
  issues: string[]
}

/** The registered Export identity of the committed D-0B-2 document (never the working tree, never a command-line value). */
export function observeD1cRegisteredExport(document: D1cCommittedDocument): D1cRegisteredExportObservation {
  if (document.text === null) return { source: document.source, identity: null, issues: [documentUnreadable(document, 'The registered Export identity')] }
  const parsed = readD0cRegisteredExportIdentity(document.text)
  return { source: document.source, identity: parsed.identity, issues: [...parsed.issues] }
}

// ---------------------------------------------------------------------------------------------------------------------
// The calculation code audit, the authorities and the oracle
// ---------------------------------------------------------------------------------------------------------------------

/** What a script observed (`git merge-base --is-ancestor`, `git diff --name-only <registration>..HEAD -- <code paths>`). */
export interface D1cCalculationCodeAudit {
  registrationHead: string
  registrationHeadIsAncestor: boolean
  /** Committed changes under the D-1A runner's code paths since the registration HEAD, sorted (the tree itself must be clean). */
  changedFiles: readonly string[]
  /** A git command that could not answer (the audit then refuses; never read as "no change"). */
  error: string | null
}

export interface D1cCalculationCodeAuditReading {
  registrationHead: string
  registrationHeadIsAncestor: boolean
  error: string | null
  changedFiles: string[]
  /** Changed files the registration allows (the D-1C formal infrastructure). */
  allowedChanged: string[]
  /** Changed files outside it: each one refuses a formal run. */
  outsideAllowed: string[]
  /** Changed Production source or build / dependency configuration (a subset of `outsideAllowed`). */
  productionChanged: string[]
  /** `calculation_code_audit_passed`. */
  passed: boolean
  /** `production_calculation_unchanged`: answered, against the registration HEAD, with no Production file changed. */
  productionUnchanged: boolean
  issues: string[]
}

export function readD1cCalculationCodeAudit(audit: D1cCalculationCodeAudit, expectedHead: string = PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD,
  allowed: readonly string[] = REGISTRATION.calculationCodeAudit.value.allowedChangedFiles): D1cCalculationCodeAuditReading {
  const allowedSet = new Set(allowed)
  const changedFiles = [...audit.changedFiles].sort()
  const outsideAllowed = changedFiles.filter(file => !allowedSet.has(file))
  const productionChanged = changedFiles.filter(file => PRODUCTION_CALCULATION_FILE.test(file))
  const answered = audit.registrationHead === expectedHead && audit.error === null && audit.registrationHeadIsAncestor
  const issues: string[] = []
  if (audit.registrationHead !== expectedHead) issues.push(`The calculation code was audited against ${audit.registrationHead}, not the registration HEAD ${expectedHead}.`)
  if (audit.error !== null) issues.push(`The calculation code audit could not run: ${audit.error}`)
  if (!audit.registrationHeadIsAncestor) issues.push(`The registration HEAD ${expectedHead} is not an ancestor of the measured HEAD.`)
  if (outsideAllowed.length > 0) issues.push(`Calculation-related files changed since the registration HEAD outside the D-1C formal infrastructure: ${outsideAllowed.join(', ')}. Audit and register them before a formal run.`)
  if (productionChanged.length > 0) issues.push(`Production calculation files changed since the registration HEAD: ${productionChanged.join(', ')}.`)
  return {
    registrationHead: audit.registrationHead, registrationHeadIsAncestor: audit.registrationHeadIsAncestor, error: audit.error, changedFiles,
    allowedChanged: changedFiles.filter(file => allowedSet.has(file)), outsideAllowed, productionChanged,
    passed: answered && outsideAllowed.length === 0, productionUnchanged: answered && productionChanged.length === 0, issues,
  }
}

export interface D1cAuthorityReading {
  calculationContextMatched: boolean
  rngEngineVersionMatched: boolean
  masterDataVersionMatched: boolean
  issues: string[]
}

/** Whether an observed CalculationContext and Production RNG Engine version are the registered ones (a version change asks for a new registration). */
export function readD1cAuthorities(observed: { calculationContext: unknown; rngEngineVersion: unknown }, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): D1cAuthorityReading {
  const expected = expectation.calculationContext
  const context = isRecord(observed.calculationContext) ? observed.calculationContext : null
  const calculationContextMatched = sameJson(observed.calculationContext, expected)
  const rngEngineVersionMatched = observed.rngEngineVersion === expected.rngEngineVersion && context?.rngEngineVersion === expected.rngEngineVersion
  const masterDataVersionMatched = context?.masterDataVersion === expected.masterDataVersion
  const issues: string[] = []
  if (!calculationContextMatched) issues.push(`The CalculationContext ${JSON.stringify(observed.calculationContext)} is not the registered ${JSON.stringify(expected)}.`)
  if (!rngEngineVersionMatched) issues.push(`The Production RNG Engine ${String(observed.rngEngineVersion)} is not the registered ${expected.rngEngineVersion}.`)
  if (!masterDataVersionMatched) issues.push(`The Master data version ${String(context?.masterDataVersion)} is not the registered ${expected.masterDataVersion}.`)
  return { calculationContextMatched, rngEngineVersionMatched, masterDataVersionMatched, issues }
}

/** The inputs a process declares it read that would be an oracle, a lower bound, a post-hoc argument or an earlier RESULT (`[]` = none). */
export function d1cOracleInputIssues(inputsRead: readonly string[]): string[] {
  return inputsRead.filter(input => ORACLE_INPUT.test(input)).map(input => `The process read ${input}, an oracle / lower-bound / RESULT input.`)
}

// ---------------------------------------------------------------------------------------------------------------------
// Start gate (parent)
// ---------------------------------------------------------------------------------------------------------------------

export interface D1cFormalStartInput {
  registration: D1cRegistrationObservation
  /** Every command-line flag given (the values are not needed: no flag may carry a condition). */
  flags: readonly string[]
  mode: string | null
  checkout: { headSha: string; workingTreeClean: boolean; uncommittedBenchmarkCode: boolean; calculationAudit: D1cCalculationCodeAudit }
  registeredExport: D1cRegisteredExportObservation
  actualExport: ExportIdentity
  registeredD0c: D1cRegisteredD0cObservation
  /** The run dir and the output: new and git-ignored (Entry bodies and raw records are written only there). */
  outputPaths: readonly { option: string; path: string; gitIgnored: boolean; exists: boolean }[]
  currentAuthorities: { calculationContext: unknown; rngEngineVersion: unknown }
  /** The conditions the parent will hand its children (the registration, never an override). */
  plannedConditions: unknown
  inputsRead: readonly string[]
}

/** The provenance rules the parent can judge before any child runs (`child_gates_passed` needs the children). */
export type D1cStartRule = Exclude<D1cProvenanceRule, 'child_gates_passed'>

export interface D1cFormalStartGate {
  passed: boolean
  rules: Record<D1cStartRule, boolean>
  prerequisites: { registeredD0cReadable: boolean; outputsNewAndIgnored: boolean; exportPathRead: boolean }
  issues: string[]
}

/** The command-line options that are not formal options, and a mode other than formal (`[]` = no override). */
export function d1cOverrideOptions(flags: readonly string[], mode: string | null): string[] {
  const allowed = new Set<string>(D1C_FORMAL_OPTIONS)
  return [...flags.filter(flag => !allowed.has(flag)), ...(mode === 'formal' ? [] : [`--mode ${String(mode)}`])]
}

/**
 * Why a formal run must not start (`passed` false), judged once from the parent's observations before anything is written: the
 * registration (complete, enabled, fingerprinted as registered), no override, a clean committed checkout, the calculation code audited
 * against the registration HEAD with no Production change, the registered Export, the registered CalculationContext / Engine / Master,
 * no oracle input, the registered D-0C identity readable, and new git-ignored outputs. None can be skipped.
 */
export function d1cFormalStartGate(input: D1cFormalStartInput, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): D1cFormalStartGate {
  const issues: string[] = []
  const audit = readD1cCalculationCodeAudit(input.checkout.calculationAudit, expectation.registrationHead)
  const authorities = readD1cAuthorities(input.currentAuthorities, expectation)
  const overrides = d1cOverrideOptions(input.flags, input.mode)
  const exportDifferences = input.registeredExport.identity === null ? null : d0cExportIdentityDifferences(input.actualExport, input.registeredExport.identity)
  const oracle = d1cOracleInputIssues(input.inputsRead)
  const rules: Record<D1cStartRule, boolean> = {
    registration_complete: input.registration.registrationIssues.length === 0,
    formal_run_enabled: input.registration.formalRunEnabled && input.registration.formalRunIssues.length === 0,
    registration_fingerprint_equals_registered_block: input.registration.fingerprint.matched,
    run_conditions_equal_registration: sameJson(input.plannedConditions, expectation.conditions),
    no_command_line_override: overrides.length === 0,
    clean_committed_head: isSha1(input.checkout.headSha) && input.checkout.workingTreeClean && !input.checkout.uncommittedBenchmarkCode,
    registration_head_is_ancestor: audit.registrationHead === expectation.registrationHead && audit.registrationHeadIsAncestor,
    calculation_code_audit_passed: audit.passed,
    production_calculation_unchanged: audit.productionUnchanged,
    export_identity_matched: exportDifferences !== null && exportDifferences.length === 0,
    calculation_context_matched: authorities.calculationContextMatched,
    rng_engine_version_matched: authorities.rngEngineVersionMatched,
    master_data_version_matched: authorities.masterDataVersionMatched,
    oracle_not_read: oracle.length === 0,
  }
  if (!rules.formal_run_enabled || !rules.registration_complete) issues.push(...input.registration.formalRunIssues)
  issues.push(...input.registration.fingerprint.issues)
  if (!rules.run_conditions_equal_registration) issues.push('The conditions the parent would hand its children are not the registered conditions.')
  if (!rules.no_command_line_override) issues.push(`A formal run takes its conditions and comparison values from the registration only; remove ${overrides.join(', ')}.`)
  if (!rules.clean_committed_head) issues.push('A formal run needs a clean, committed Working Tree at a recorded HEAD.')
  issues.push(...audit.issues)
  if (input.registeredExport.identity === null) issues.push(`The registered Export identity could not be read from the committed D-0B-2 document: ${input.registeredExport.issues.join(' ')}`)
  else issues.push(...exportDifferences!)
  issues.push(...authorities.issues, ...oracle)
  const registeredD0cReadable = input.registeredD0c.identity !== null
  if (!registeredD0cReadable) issues.push(`The registered D-0C identity could not be read: ${input.registeredD0c.issues.join(' ')}`)
  const outputsNewAndIgnored = input.outputPaths.every(output => output.gitIgnored && !output.exists)
  for (const output of input.outputPaths) {
    if (output.exists) issues.push(`${output.option} ${output.path} already exists; a formal run writes new paths only.`)
    if (!output.gitIgnored) issues.push(`${output.option} ${output.path} is not git-ignored; a formal run writes Entry bodies and raw records only into ignored paths (for example under .local/).`)
  }
  const exportPathRead = input.inputsRead.some(value => value.startsWith('export:'))
  if (!exportPathRead) issues.push('The parent declares no Export it read.')
  const passed = Object.values(rules).every(Boolean) && registeredD0cReadable && outputsNewAndIgnored && exportPathRead && issues.length === 0
  return { passed, rules, prerequisites: { registeredD0cReadable, outputsNewAndIgnored, exportPathRead }, issues }
}

// ---------------------------------------------------------------------------------------------------------------------
// The formal task and the child gate
// ---------------------------------------------------------------------------------------------------------------------

/** The task a formal parent hands one child (never trusted by the child: every field is re-checked against its own observations). */
export interface D1cFormalTask {
  mode: 'formal'
  formalProtocolVersion: string
  role: D1cRole
  runIndex: number
  repeat: number
  verificationProtocolVersion: string
  materializationProtocolVersion: string
  registrationHead: string
  registrationFingerprint: string
  repositoryHeadSha: string
  actualExport: ExportIdentity
  registeredExport: ExportIdentity
  expectedD0c: D0cIdentityExpectation
  calculationContext: D1cCalculationContext
  conditions: ReturnType<typeof registeredD1cConditions>
  /** The absolute directory of this complete run (`run-<runIndex>` inside the formal run directory). */
  runDir: string
  /** Fresh only: the Entry set the first process of this run wrote, by file name inside `runDir`, SHA-256 and Entry fingerprint. */
  entrySet: { file: string; firstRecordFile: string; sha256: string; entryFingerprint: string } | null
}

/** The one constructor of a formal task (the runner's only path; the conditions are the registration's). */
export function createD1cFormalTask(input: {
  role: D1cRole; runIndex: number; measurementHeadSha: string; registrationFingerprint: string; actualExport: ExportIdentity; registeredExport: ExportIdentity
  expectedD0c: D0cIdentityExpectation; runDir: string; entrySet: D1cFormalTask['entrySet']
}, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): D1cFormalTask {
  return {
    mode: 'formal', formalProtocolVersion: D1C_FORMAL_PROTOCOL_VERSION, role: input.role, runIndex: input.runIndex, repeat: expectation.conditions.envelope.repeat,
    verificationProtocolVersion: expectation.verificationProtocolVersion, materializationProtocolVersion: expectation.materializationProtocolVersion,
    registrationHead: expectation.registrationHead, registrationFingerprint: input.registrationFingerprint, repositoryHeadSha: input.measurementHeadSha,
    actualExport: { ...input.actualExport }, registeredExport: { ...input.registeredExport }, expectedD0c: { ...input.expectedD0c },
    calculationContext: { ...expectation.calculationContext }, conditions: structuredClone(expectation.conditions), runDir: input.runDir,
    entrySet: input.entrySet === null ? null : { ...input.entrySet },
  }
}

export interface D1cFormalChildGateInput {
  /** `--role` of the child's own command line. */
  role: string
  task: unknown
  /** Resolved absolute paths: the task's run directory and the directories of the task, record and journal files the child was given. */
  paths: { runDir: string; taskDir: string; recordDir: string; journalDir: string }
  checkout: { headSha: string; workingTreeClean: boolean; uncommittedBenchmarkCode: boolean; calculationAudit: D1cCalculationCodeAudit }
  registration: D1cRegistrationObservation
  registeredExport: D1cRegisteredExportObservation
  registeredD0c: D1cRegisteredD0cObservation
  actualExport: ExportIdentity
  /** `process.execArgv`: the registered heap envelope must be applied to the child itself. */
  execArgv: readonly string[]
  inputsRead: readonly string[]
}

const samePath = (left: string, right: string) => left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase()

/**
 * Why a child must refuse a formal task before it computes anything (`[]` = it may load the input). A child never trusts its task: it
 * re-applies the registration gate and the fingerprint, compares every task field with the registration and its own observations
 * (checkout, calculation code audit, registered Export, registered D-0C identity, heap envelope, run directory), so a hand-written task
 * cannot run where the parent would have refused.
 */
export function d1cFormalChildGateIssues(input: D1cFormalChildGateInput, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): string[] {
  const task = isRecord(input.task) ? input.task : {}
  if (task.mode !== 'formal') return [`A D-1C child runs formal tasks only (got mode ${String(task.mode)}).`]
  const issues: string[] = []
  if (task.formalProtocolVersion !== D1C_FORMAL_PROTOCOL_VERSION) issues.push(`The task formal protocol ${String(task.formalProtocolVersion)} is not ${D1C_FORMAL_PROTOCOL_VERSION}.`)
  if (!(D1C_ROLES as readonly string[]).includes(input.role)) issues.push(`Unknown child role ${input.role}.`)
  if (task.role !== input.role) issues.push(`The task is for the ${String(task.role)} process, not ${input.role}.`)
  const repeat = expectation.conditions.envelope.repeat
  if (task.repeat !== repeat) issues.push(`The task repeat ${String(task.repeat)} is not the registered ${repeat}.`)
  const runIndex = typeof task.runIndex === 'number' && Number.isSafeInteger(task.runIndex) && task.runIndex >= 1 && task.runIndex <= repeat ? task.runIndex : null
  if (runIndex === null) issues.push(`The task run index ${String(task.runIndex)} is not one of 1..${repeat}.`)
  if (task.verificationProtocolVersion !== expectation.verificationProtocolVersion) issues.push(`The task verification protocol ${String(task.verificationProtocolVersion)} is not the registered ${expectation.verificationProtocolVersion}.`)
  if (task.materializationProtocolVersion !== expectation.materializationProtocolVersion) issues.push(`The task materialization protocol ${String(task.materializationProtocolVersion)} is not the registered ${expectation.materializationProtocolVersion}.`)
  if (task.registrationHead !== expectation.registrationHead) issues.push(`The task names the registration HEAD ${String(task.registrationHead)}, not ${expectation.registrationHead}.`)
  // The registration as this child observes it (enabled, complete, fingerprinted), and the fingerprint the parent named.
  issues.push(...input.registration.formalRunIssues, ...input.registration.fingerprint.issues)
  if (task.registrationFingerprint !== input.registration.fingerprint.computed) issues.push(`The task names the registration fingerprint ${String(task.registrationFingerprint)}, not the child's ${input.registration.fingerprint.computed}.`)
  if (!sameJson(task.conditions, expectation.conditions)) issues.push('The task conditions are not the registered conditions.')
  if (!sameJson(task.calculationContext, expectation.calculationContext)) issues.push('The task CalculationContext is not the registered CalculationContext.')
  // The checkout the child runs in.
  const checkout = input.checkout
  if (!isSha1(task.repositoryHeadSha)) issues.push('The task names no measurement HEAD.')
  else if (task.repositoryHeadSha !== checkout.headSha) issues.push(`The child runs at HEAD ${checkout.headSha}, not the task's measurement HEAD ${task.repositoryHeadSha}.`)
  if (!checkout.workingTreeClean) issues.push('The child observed a Working Tree that is not clean.')
  if (checkout.uncommittedBenchmarkCode) issues.push('The child observed uncommitted benchmark code.')
  issues.push(...readD1cCalculationCodeAudit(checkout.calculationAudit, expectation.registrationHead).issues)
  // The Export and the D-0C identity, each read by the child itself from the committed documents.
  const registeredExport = input.registeredExport.identity
  if (registeredExport === null) issues.push(`The child could not read the registered Export identity: ${input.registeredExport.issues.join(' ')}`)
  else {
    if (!sameJson(task.registeredExport, registeredExport)) issues.push('The task does not carry the registered Export identity read from HEAD.')
    issues.push(...d0cExportIdentityDifferences(input.actualExport, registeredExport))
  }
  if (!sameJson(task.actualExport, input.actualExport)) issues.push('The Export differs from the one the parent hashed.')
  const registeredD0c = input.registeredD0c.identity
  if (registeredD0c === null) issues.push(`The child could not read the registered D-0C identity: ${input.registeredD0c.issues.join(' ')}`)
  else if (!sameJson(task.expectedD0c, registeredD0c)) issues.push('The task D-0C identity is not the registered one read from HEAD.')
  // The envelope applied to this very process.
  const heapFlag = `--max-old-space-size=${expectation.conditions.envelope.childHeapMb}`
  if (!input.execArgv.includes(heapFlag)) issues.push(`The child runs without the registered heap envelope ${heapFlag} (execArgv ${JSON.stringify(input.execArgv)}).`)
  // The run directory: this run's own, holding the task, record and journal (another run's files never reach this child).
  if (runIndex !== null && lastSegment(input.paths.runDir) !== d1cRunDirectoryName(runIndex)) issues.push(`The task run directory ${input.paths.runDir} is not ${d1cRunDirectoryName(runIndex)}.`)
  for (const [name, dir] of [['task', input.paths.taskDir], ['record', input.paths.recordDir], ['journal', input.paths.journalDir]] as const) {
    if (!samePath(dir, input.paths.runDir)) issues.push(`The ${name} file is not in the task's run directory.`)
  }
  // The Entry set: none for the first process; for the fresh process the one of this run, with the registered Entry fingerprint.
  const entrySet = isRecord(task.entrySet) ? task.entrySet : null
  if (input.role === 'first' && task.entrySet !== null) issues.push('A first task names an Entry set.')
  if (input.role === 'fresh') {
    if (entrySet === null) issues.push('A fresh task names no Entry set.')
    else {
      if (typeof entrySet.file !== 'string' || /[\\/]/.test(entrySet.file) || typeof entrySet.firstRecordFile !== 'string' || /[\\/]/.test(entrySet.firstRecordFile)) issues.push('The task Entry set must name files inside the run directory.')
      if (!isSha256(entrySet.sha256)) issues.push('The task Entry set names no SHA-256.')
      if (registeredD0c !== null && entrySet.entryFingerprint !== registeredD0c.entryFingerprint) issues.push(`The task Entry fingerprint ${String(entrySet.entryFingerprint)} is not the registered ${registeredD0c.entryFingerprint}.`)
    }
  }
  issues.push(...d1cOracleInputIssues(input.inputsRead))
  return issues
}

/** Why a child must refuse once its input is loaded and before any calculation: the registered CalculationContext, Engine and Master. */
export function d1cFormalChildCalculationIssues(observed: { calculationContext: unknown; rngEngineVersion: unknown }, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): string[] {
  return readD1cAuthorities(observed, expectation).issues
}

/**
 * Why the fresh process must refuse the Entry set before it plans: the file it read is not the one the parent named, or the first record
 * of this run (read by the fresh child itself) is not this run's first process or did not write that file (`[]` = it is this run's).
 */
export function d1cFreshEntrySetSourceIssues(input: { task: D1cFormalTask; entrySetSha256: string; firstRecord: unknown; firstRecordReadError: string | null }): string[] {
  const issues: string[] = []
  const expected = input.task.entrySet
  if (expected === null) return ['A fresh task names no Entry set.']
  if (input.entrySetSha256 !== expected.sha256) issues.push(`The Entry set file hashes to ${input.entrySetSha256}, not the task's ${expected.sha256}.`)
  if (input.firstRecordReadError !== null) return [...issues, `The first record of this run could not be read: ${input.firstRecordReadError}`]
  const record = isRecord(input.firstRecord) ? input.firstRecord : null
  const formal = record !== null && isRecord(record.formal) ? record.formal : null
  const entrySet = record !== null && isRecord(record.entrySet) ? record.entrySet : null
  if (record === null || formal === null) return [...issues, 'The first record of this run carries no formal block.']
  if (record.role !== 'first' || formal.role !== 'first') issues.push('The first record of this run is not a first process record.')
  if (formal.runIndex !== input.task.runIndex) issues.push(`The first record belongs to run ${String(formal.runIndex)}, not run ${input.task.runIndex}.`)
  if (record.repositoryHeadSha !== input.task.repositoryHeadSha) issues.push('The first record was written at another HEAD.')
  if (entrySet === null || entrySet.sha256 !== input.entrySetSha256 || entrySet.file !== expected.file) issues.push('The first record of this run did not write this Entry set.')
  return issues
}

/** The formal block of a child record (what the child itself observed and decided; the parent and the derivation re-read it). */
export interface D1cChildFormalBlock {
  mode: 'formal'
  formalProtocolVersion: string
  role: D1cRole
  runIndex: number
  pid: number
  gate: {
    issues: string[]
    observedHeadSha: string
    workingTreeClean: boolean
    uncommittedBenchmarkCode: boolean
    /** The raw audit (re-read by `readD1cCalculationCodeAudit()`, never a stored verdict). */
    calculationAudit: D1cCalculationCodeAudit
    registration: D1cRegistrationObservation
    registeredExport: D1cRegisteredExportObservation
    registeredD0c: D1cRegisteredD0cObservation
    execArgv: string[]
  }
  calculation: { issues: string[]; calculationContext: unknown; rngEngineVersion: unknown }
  /** Fresh only: the Entry set source check (`d1cFreshEntrySetSourceIssues()`). */
  entrySetSource: { issues: string[] } | null
  /** The registered verification budget the first process applied (null for fresh). */
  verificationBudget: number | null
  /** Structural candidates handed to Phase D' (at most the budget; first only, null for fresh). */
  verifiedCandidates: number | null
  inputsRead: string[]
}

// ---------------------------------------------------------------------------------------------------------------------
// The observations of a formal measurement and their one conclusion
// ---------------------------------------------------------------------------------------------------------------------

/** One child process as the parent observed it (the envelope's outcome, its pid and its place in the sequence). */
export interface D1cProcessEntry {
  id: string
  role: D1cRole
  runIndex: number
  outcome: D1aProcessOutcome
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  settledBy: string | null
  spawnError: string | null
  pid: number | null
  wallMs: number
  heapMb: number
  nodeFlags: string[]
  /** Parent-monotonic milliseconds (from the measurement start) when the child was started and when it settled. */
  startedAtMs: number
  endedAtMs: number
  wallObservedMs: number
  recordWritten: boolean
  recordFile: string | null
}

export interface D1cRunObservation {
  runIndex: number
  first: { process: D1cProcessEntry; reading: D1aChildReading }
  /** Null when the parent did not start the fresh process (the first one stopped or was not intact, or the run was cancelled). */
  fresh: { process: D1cProcessEntry; reading: D1aChildReading } | null
  checkoutBefore: D1aCheckoutState
  checkoutAfter: D1aCheckoutState
}

/** The parent's start provenance the conclusion reads (the runner records more; only these fields are judged). */
export interface D1cStartObservation {
  formalProtocolVersion: string
  mode: string
  measurementHeadSha: string
  benchmarkCodeSha256: string
  workingTreeClean: boolean
  uncommittedBenchmarkCode: boolean
  flags: string[]
  modeOption: string | null
  parentPid: number
  registration: D1cRegistrationObservation
  calculationAudit: D1cCalculationCodeAudit
  registeredExport: D1cRegisteredExportObservation
  actualExport: ExportIdentity
  registeredD0c: D1cRegisteredD0cObservation
  currentAuthorities: { calculationContext: unknown; rngEngineVersion: unknown }
  conditions: unknown
  inputsRead: string[]
  oracleFreeExecution: boolean
  startGate: D1cFormalStartGate
}

export interface D1cMeasurementObservation {
  start: D1cStartObservation
  /** The start record in the run directory is the provenance the parent carries (read back after it was written). */
  startRecordMatches: boolean
  runs: D1cRunObservation[]
}

/** A child record's fields the conclusion reads (untrusted file contents). */
interface D1cChildRecordView {
  role?: unknown
  repositoryHeadSha?: unknown
  rngEngineVersion?: unknown
  calculationContext?: unknown
  exportVerification?: { actual?: unknown } | null
  formal?: Partial<D1cChildFormalBlock> | null
  identity?: D0cIdentityComparison | null
  materialization?: { semanticSha256?: unknown; semantic?: { conditions?: unknown; protocolVersion?: unknown } } | null
  entrySet?: { entryFingerprint?: unknown; sha256?: unknown; file?: unknown } | null
  verification?: { semantic: PlannerVerificationSemantic; semanticSha256: string } | null
}

const viewOf = (reading: D1aChildReading | undefined): D1cChildRecordView | null => (reading?.record ?? null) as D1cChildRecordView | null
const formalOf = (reading: D1aChildReading | undefined) => {
  const formal = viewOf(reading)?.formal
  return isRecord(formal) ? formal as Partial<D1cChildFormalBlock> : null
}

/** The formal-block integrity of one child record against the parent's own observation of that child (`[]` = consistent). */
function childFormalIntegrityIssues(role: D1cRole, runIndex: number, side: { process: D1cProcessEntry; reading: D1aChildReading }): string[] {
  const record = viewOf(side.reading)
  if (record === null) return []
  const formal = formalOf(side.reading)
  if (formal === null) return [`${role}: the record carries no formal block.`]
  const issues: string[] = []
  if (formal.mode !== 'formal' || formal.formalProtocolVersion !== D1C_FORMAL_PROTOCOL_VERSION) issues.push(`${role}: the record's formal block is not a ${D1C_FORMAL_PROTOCOL_VERSION} block.`)
  if (formal.role !== role) issues.push(`${role}: the record's formal role ${JSON.stringify(formal.role)} is not ${role}.`)
  if (formal.runIndex !== runIndex) issues.push(`${role}: the record belongs to run ${JSON.stringify(formal.runIndex)}, not run ${runIndex}.`)
  if (side.process.pid === null || formal.pid !== side.process.pid) issues.push(`${role}: the record was written by pid ${JSON.stringify(formal.pid)}, not by the child the parent started (pid ${String(side.process.pid)}).`)
  if (side.process.role !== role || side.process.runIndex !== runIndex) issues.push(`${role}: the process entry is not the ${role} process of run ${runIndex}.`)
  return issues
}

/** The integrity issues of one complete run (`[]` = none): the D-1A child and checkout checks plus the formal blocks, each prefixed with the run. */
export function d1cRunIntegrityIssues(run: D1cRunObservation, start: D1cStartObservation): string[] {
  const expected = { repositoryHeadSha: start.measurementHeadSha, actualExport: start.actualExport }
  const issues = [
    ...d1aChildIntegrityIssues('first', run.first.reading, expected), ...childFormalIntegrityIssues('first', run.runIndex, run.first),
    ...(run.fresh === null ? [] : [...d1aChildIntegrityIssues('fresh', run.fresh.reading, expected), ...childFormalIntegrityIssues('fresh', run.runIndex, run.fresh)]),
    ...d1aCheckoutIntegrityIssues(run.checkoutBefore, run.checkoutAfter),
  ]
  return issues.map(issue => `run ${run.runIndex} ${issue}`)
}

const processesOf = (runs: readonly D1cRunObservation[]) => runs.flatMap(run => [run.first.process, ...(run.fresh === null ? [] : [run.fresh.process])])

/** The largest number of children whose observed intervals overlap (1 = one child at a time). */
export function d1cMaximumConcurrentChildren(processes: readonly D1cProcessEntry[]): number {
  const events = processes.flatMap(entry => [{ at: entry.startedAtMs, delta: 1 }, { at: entry.endedAtMs, delta: -1 }]).sort((left, right) => left.at - right.at || left.delta - right.delta)
  let running = 0, maximum = 0
  for (const event of events) { running += event.delta; maximum = Math.max(maximum, running) }
  return maximum
}

/** The RESULT-level integrity issues (`[]` = none): every run's issues plus the start record, the order of runs and processes, and the checkout between runs. */
export function d1cResultIntegrityIssues(observation: D1cMeasurementObservation, runIssues: readonly (readonly string[])[]): string[] {
  const issues = runIssues.flat()
  if (!observation.startRecordMatches) issues.push('The start record in the run directory is not the provenance the RESULT carries.')
  observation.runs.forEach((run, index) => { if (run.runIndex !== index + 1) issues.push(`Run ${index + 1} is recorded as run ${run.runIndex}.`) })
  const processes = processesOf(observation.runs)
  if (d1cMaximumConcurrentChildren(processes) > 1) issues.push('Two children ran at the same time.')
  const pids = processes.map(entry => entry.pid).filter((pid): pid is number => pid !== null)
  if (new Set(pids).size !== pids.length) issues.push('Two children share a pid.')
  if (pids.includes(observation.start.parentPid)) issues.push('A child shares the parent\'s pid.')
  const startCheckout: D1aCheckoutState = { repositoryHeadSha: observation.start.measurementHeadSha, workingTreeClean: observation.start.workingTreeClean, uncommittedBenchmarkCode: observation.start.uncommittedBenchmarkCode }
  let previous = startCheckout
  for (const run of observation.runs) {
    issues.push(...d1aCheckoutIntegrityIssues(previous, run.checkoutBefore).map(issue => `before run ${run.runIndex}: ${issue}`))
    previous = run.checkoutAfter
  }
  return issues
}

// ---------------------------------------------------------------------------------------------------------------------
// Formal validity (the registered rules, each judged from the observations)
// ---------------------------------------------------------------------------------------------------------------------

export interface D1cRuleCheck {
  passed: boolean
  /** Why the rule did not hold (null when it held). */
  detail: string | null
}

export interface D1cFormalValidity {
  status: 'valid' | 'invalid'
  issues: string[]
  checks: {
    provenance: Record<D1cProvenanceRule, D1cRuleCheck>
    reproducibility: Record<D1cReproducibilityRule, D1cRuleCheck>
  }
}

/**
 * Whether one process evaluated and recorded the Phase D' conditions (`planner_conditions_evaluated_in_both_processes`, D-1B 12.2): its
 * verification semantic record is of the registered protocol, holds every condition key with a boolean or null, has a measured outcome
 * (not `unmeasured`), and leaves a condition null only where an earlier design 9.5 condition decided the outcome first (the handoff or the
 * planning Target set: no Planner stage at all; no Plan: no physical identity). Whether the conditions held is the candidate outcome.
 */
export function d1cPlannerConditionsEvaluated(semantic: unknown, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): { evaluated: boolean; nullChecks: string[]; issues: string[] } {
  if (!isRecord(semantic)) return { evaluated: false, nullChecks: [], issues: ['no verification semantic record'] }
  const issues: string[] = []
  if (semantic.protocolVersion !== expectation.verificationProtocolVersion) issues.push(`protocol ${String(semantic.protocolVersion)} is not ${expectation.verificationProtocolVersion}`)
  const checks = isRecord(semantic.checks) ? semantic.checks : null
  const outcome = isRecord(semantic.outcome) && typeof semantic.outcome.kind === 'string' ? semantic.outcome.kind : null
  if (checks === null) return { evaluated: false, nullChecks: [], issues: [...issues, 'no condition checks'] }
  const keys = Object.keys(checks).sort()
  if (!sameJson(keys, [...D1C_CONDITION_CHECK_KEYS].sort())) issues.push(`condition keys ${keys.join(',')} are not the registered ${D1C_CONDITION_CHECK_KEYS.length}`)
  const nullChecks = D1C_CONDITION_CHECK_KEYS.filter(key => checks[key] === null)
  if (D1C_CONDITION_CHECK_KEYS.some(key => checks[key] !== null && typeof checks[key] !== 'boolean')) issues.push('a condition check is neither a boolean nor null')
  if (outcome === null || outcome === 'unmeasured') issues.push(`the outcome ${String(outcome)} is not a measured Phase D' outcome`)
  else if (outcome === 'conditions_met') {
    if (D1C_CONDITION_CHECK_KEYS.some(key => checks[key] !== true)) issues.push('conditions_met with a condition that is not true')
  } else if (semantic.planner === null) {
    if (!['planning_target_set_changed', 'materialization_failed', 'materialization_unconfirmed', 'materialization_unsupported'].includes(outcome)) issues.push(`no Planner stage for the outcome ${outcome}`)
    if (nullChecks.length !== D1C_CONDITION_CHECK_KEYS.length) issues.push('a condition was recorded although the Planner never ran')
  } else {
    if (PLANNER_STAGE_CHECKS.some(key => checks[key] === null)) issues.push('a Planner-stage condition was not evaluated although the Planner ran')
    const planPresent = isRecord(semantic.planner) && semantic.planner.planPresent === true
    if (planPresent && PHYSICAL_CHECKS.some(key => checks[key] === null)) issues.push('a physical identity was not evaluated although a Plan exists')
    if (!planPresent && PHYSICAL_CHECKS.some(key => checks[key] !== null)) issues.push('a physical identity was recorded without a Plan')
  }
  return { evaluated: issues.length === 0, nullChecks, issues }
}

/** One complete run's conditions as observed (the D-1B `D1cObservedRunConditions` plus the verification budget actually used). */
export interface D1cObservedRunConditions {
  materialization: unknown
  researchMaxPlanSteps: { first: unknown; fresh: unknown }
  firstChildWallMs: number | null
  freshChildWallMs: number | null
  childHeapMb: { first: number | null; fresh: number | null }
  heapFlagApplied: boolean
  concurrency: number
  childProcessRetry: 'none' | 'retried'
  /** The bound the first process applied, and how many candidates it actually handed to Phase D' (never more than the bound). */
  verificationBudget: unknown
  verifiedCandidates: unknown
}

/** How one run's observed conditions differ from the expectation, one line per field (`[]` = exactly the registered values). */
export function d1cRunConditionDifferences(observed: D1cObservedRunConditions, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): string[] {
  const registered = expectation.conditions
  const differences: string[] = []
  if (!sameJson(observed.materialization, registered.materialization)) differences.push('materialization: the conditions are not the registered D-0C conditions')
  for (const role of D1C_ROLES) {
    if (observed.researchMaxPlanSteps[role] !== registered.verification.researchMaxPlanSteps) differences.push(`researchMaxPlanSteps (${role}): ${String(observed.researchMaxPlanSteps[role])} (registered ${registered.verification.researchMaxPlanSteps})`)
  }
  if (observed.firstChildWallMs !== registered.envelope.firstChildWallMs) differences.push(`firstChildWallMs: ${String(observed.firstChildWallMs)} (registered ${registered.envelope.firstChildWallMs})`)
  if (observed.freshChildWallMs !== registered.envelope.freshChildWallMs) differences.push(`freshChildWallMs: ${String(observed.freshChildWallMs)} (registered ${registered.envelope.freshChildWallMs})`)
  for (const role of D1C_ROLES) {
    if (observed.childHeapMb[role] !== registered.envelope.childHeapMb) differences.push(`childHeapMb (${role}): ${String(observed.childHeapMb[role])} (registered ${registered.envelope.childHeapMb})`)
  }
  if (!observed.heapFlagApplied) differences.push(`childHeapMb: --max-old-space-size=${registered.envelope.childHeapMb} was not applied to every child`)
  if (observed.concurrency !== registered.envelope.concurrency) differences.push(`concurrency: ${observed.concurrency} (registered ${registered.envelope.concurrency})`)
  if (observed.childProcessRetry !== registered.envelope.childProcessRetry) differences.push(`childProcessRetry: ${observed.childProcessRetry} (registered ${registered.envelope.childProcessRetry})`)
  if (observed.verificationBudget !== registered.verification.verificationBudget) differences.push(`verificationBudget: ${String(observed.verificationBudget)} (registered ${registered.verification.verificationBudget})`)
  const verified = observed.verifiedCandidates
  if (typeof verified !== 'number' || !Number.isSafeInteger(verified) || verified < 0 || verified > registered.verification.verificationBudget) {
    differences.push(`verifiedCandidates: ${String(verified)} (at most the registered verification budget ${registered.verification.verificationBudget})`)
  }
  return differences
}

function observedRunConditions(run: D1cRunObservation, allProcesses: readonly D1cProcessEntry[], expectation: D1cRegisteredExpectation): D1cObservedRunConditions {
  const first = viewOf(run.first.reading)
  const fresh = run.fresh === null ? null : viewOf(run.fresh.reading)
  const heapFlag = `--max-old-space-size=${expectation.conditions.envelope.childHeapMb}`
  const sides = [run.first, ...(run.fresh === null ? [] : [run.fresh])]
  const roles = allProcesses.filter(entry => entry.runIndex === run.runIndex).map(entry => entry.role)
  return {
    materialization: first?.materialization?.semantic?.conditions ?? null,
    researchMaxPlanSteps: { first: first?.verification?.semantic?.conditions?.researchMaxPlanSteps ?? null, fresh: fresh?.verification?.semantic?.conditions?.researchMaxPlanSteps ?? null },
    firstChildWallMs: run.first.process.wallMs, freshChildWallMs: run.fresh?.process.wallMs ?? null,
    childHeapMb: { first: run.first.process.heapMb, fresh: run.fresh?.process.heapMb ?? null },
    heapFlagApplied: run.fresh !== null && sides.every(side => side.process.nodeFlags.includes(heapFlag) && (formalOf(side.reading)?.gate?.execArgv ?? []).includes(heapFlag)),
    concurrency: d1cMaximumConcurrentChildren(allProcesses),
    childProcessRetry: new Set(roles).size === roles.length ? 'none' : 'retried',
    verificationBudget: formalOf(run.first.reading)?.verificationBudget ?? null,
    verifiedCandidates: formalOf(run.first.reading)?.verifiedCandidates ?? null,
  }
}

type RuleBody = () => string[]

function ruleCheck(body: RuleBody): D1cRuleCheck {
  const failures = body()
  return { passed: failures.length === 0, detail: failures.length === 0 ? null : failures.join(' ') }
}

/**
 * The formal validity of a D-1C measurement (D-1B 12.1 / 12.2): every registered provenance and reproducibility rule, each judged from the
 * observations (the start provenance, each child's record and formal block, the parent's process entries, the integrity issues), never
 * listed as passed. `valid` only when every rule holds. It never reads whether the candidate met its conditions: a valid measurement can
 * measure a rejected candidate, and an invalid one never accepts a verified candidate.
 */
export function judgeD1cFormalValidity(input: {
  observation: D1cMeasurementObservation
  runIssues: readonly (readonly string[])[]
  resultIntegrityIssues: readonly string[]
  conclusions: readonly D1aRunConclusion[]
}, expectation: D1cRegisteredExpectation = registeredD1cExpectation(), registration: D1cRegistration = REGISTRATION): D1cFormalValidity {
  const { observation } = input
  const start = observation.start
  const runs = observation.runs
  const repeat = expectation.conditions.envelope.repeat
  const allProcesses = processesOf(runs)
  const sides = runs.flatMap(run => [{ run: run.runIndex, role: 'first' as const, side: run.first }, ...(run.fresh === null ? [] : [{ run: run.runIndex, role: 'fresh' as const, side: run.fresh }])])
  const withRecord = sides.filter(entry => viewOf(entry.side.reading) !== null)
  const label = (entry: { run: number; role: string }) => `run ${entry.run} ${entry.role}`
  const childFailures = (test: (formal: Partial<D1cChildFormalBlock>, record: D1cChildRecordView) => string | null) => withRecord.flatMap(entry => {
    const formal = formalOf(entry.side.reading)
    if (formal === null) return [`${label(entry)}: no formal block.`]
    const failure = test(formal, viewOf(entry.side.reading)!)
    return failure === null ? [] : [`${label(entry)}: ${failure}`]
  })
  const auditOf = (audit: D1cCalculationCodeAudit | undefined) => (audit === undefined ? null : readD1cCalculationCodeAudit(audit, expectation.registrationHead))
  const startAudit = readD1cCalculationCodeAudit(start.calculationAudit, expectation.registrationHead)
  const startAuthorities = readD1cAuthorities(start.currentAuthorities, expectation)
  const registeredD0c = start.registeredD0c.identity
  const completeRun = (run: D1cRunObservation) => run.fresh !== null
    && [run.first, run.fresh].every(side => side.process.outcome === 'completed' && (viewOf(side.reading)?.verification ?? null) !== null)
  const verificationShas = runs.flatMap(run => [run.first.reading.recomputed.verificationSha256, run.fresh?.reading.recomputed.verificationSha256 ?? null])

  const provenance: Record<D1cProvenanceRule, RuleBody> = {
    registration_complete: () => [
      ...(start.registration.registrationIssues.length > 0 ? [`start: ${start.registration.registrationIssues.join(' ')}`] : []),
      ...(plannerVerificationD1cRegistrationIssues(registration).length > 0 ? ['the registration module is incomplete'] : []),
      ...childFailures(formal => (formal.gate?.registration?.registrationIssues?.length ?? 1) === 0 ? null : 'the registration it observed is incomplete.'),
    ],
    formal_run_enabled: () => [
      ...(start.registration.formalRunEnabled ? [] : ['start: the formal run is not enabled']),
      ...childFailures(formal => formal.gate?.registration?.formalRunEnabled === true ? null : 'the formal run is not enabled in its registration.'),
    ],
    registration_fingerprint_equals_registered_block: () => [
      ...(start.registration.fingerprint.matched && start.registration.fingerprint.computed === d1cRegistrationFingerprint(registration) ? [] : [`start: ${start.registration.fingerprint.issues.join(' ') || 'the fingerprint is not the registration\'s'}`]),
      ...childFailures(formal => formal.gate?.registration?.fingerprint?.matched === true && formal.gate.registration.fingerprint.computed === start.registration.fingerprint.computed ? null : 'its fingerprint is not the registered block.'),
    ],
    run_conditions_equal_registration: () => [
      ...(sameJson(start.conditions, expectation.conditions) ? [] : ['start: the planned conditions are not the registered conditions']),
      ...runs.flatMap(run => d1cRunConditionDifferences(observedRunConditions(run, allProcesses, expectation), expectation).map(difference => `run ${run.runIndex}: ${difference}`)),
      ...(runs.length === 0 ? ['no run was observed'] : []),
    ],
    no_command_line_override: () => {
      const overrides = d1cOverrideOptions(start.flags, start.modeOption)
      return overrides.length === 0 ? [] : [`overrides: ${overrides.join(', ')}`]
    },
    clean_committed_head: () => [
      ...(isSha1(start.measurementHeadSha) && start.workingTreeClean && !start.uncommittedBenchmarkCode && isSha256(start.benchmarkCodeSha256) ? [] : ['start: not a clean committed HEAD with a recorded benchmark code hash']),
      ...childFailures(formal => formal.gate?.observedHeadSha === start.measurementHeadSha && formal.gate.workingTreeClean === true && formal.gate.uncommittedBenchmarkCode === false ? null : 'it did not observe the clean measurement HEAD.'),
      ...runs.flatMap(run => [run.checkoutBefore, run.checkoutAfter].every(state => state.repositoryHeadSha === start.measurementHeadSha && state.workingTreeClean && !state.uncommittedBenchmarkCode) ? [] : [`run ${run.runIndex}: the checkout was not the clean measurement HEAD`]),
    ],
    registration_head_is_ancestor: () => [
      ...(startAudit.registrationHead === expectation.registrationHead && startAudit.registrationHeadIsAncestor ? [] : ['start: the registration HEAD is not an ancestor']),
      ...childFailures(formal => { const audit = auditOf(formal.gate?.calculationAudit); return audit !== null && audit.registrationHead === expectation.registrationHead && audit.registrationHeadIsAncestor ? null : 'the registration HEAD is not an ancestor.' }),
    ],
    calculation_code_audit_passed: () => [
      ...(startAudit.passed ? [] : [`start: ${startAudit.issues.join(' ')}`]),
      ...childFailures(formal => (auditOf(formal.gate?.calculationAudit)?.passed ? null : 'its calculation code audit did not pass.')),
    ],
    production_calculation_unchanged: () => [
      ...(startAudit.productionUnchanged ? [] : [`start: Production changed (${startAudit.productionChanged.join(', ') || 'unanswered'})`]),
      ...childFailures(formal => (auditOf(formal.gate?.calculationAudit)?.productionUnchanged ? null : 'it observed a Production change.')),
    ],
    export_identity_matched: () => {
      const registered = start.registeredExport.identity
      const failures = registered === null ? ['start: no registered Export identity'] : d0cExportIdentityDifferences(start.actualExport, registered).map(difference => `start: ${difference}`)
      return [...failures, ...childFailures((formal, record) => sameJson(record.exportVerification?.actual, start.actualExport) && sameJson(formal.gate?.registeredExport?.identity, registered) ? null : 'its Export or registered identity is not the start one.')]
    },
    calculation_context_matched: () => [
      ...(startAuthorities.calculationContextMatched ? [] : ['start: the current CalculationContext is not the registered one']),
      ...childFailures((formal, record) => sameJson(record.calculationContext, expectation.calculationContext) && sameJson(formal.calculation?.calculationContext, expectation.calculationContext) && (formal.calculation?.issues?.length ?? 1) === 0 ? null : 'its CalculationContext is not the registered one.'),
    ],
    rng_engine_version_matched: () => [
      ...(startAuthorities.rngEngineVersionMatched ? [] : ['start: the Production RNG Engine is not the registered one']),
      ...childFailures((formal, record) => record.rngEngineVersion === expectation.calculationContext.rngEngineVersion && formal.calculation?.rngEngineVersion === expectation.calculationContext.rngEngineVersion ? null : 'its Engine is not the registered one.'),
    ],
    master_data_version_matched: () => [
      ...(startAuthorities.masterDataVersionMatched ? [] : ['start: the Master data version is not the registered one']),
      ...childFailures((_formal, record) => isRecord(record.calculationContext) && record.calculationContext.masterDataVersion === expectation.calculationContext.masterDataVersion ? null : 'its Master data version is not the registered one.'),
    ],
    oracle_not_read: () => [
      ...(start.oracleFreeExecution === true ? [] : ['start: not an oracle-free execution']),
      ...d1cOracleInputIssues(start.inputsRead).map(issue => `start: ${issue}`),
      ...childFailures(formal => (Array.isArray(formal.inputsRead) && d1cOracleInputIssues(formal.inputsRead).length === 0 ? null : 'it read an oracle input or declared none.')),
    ],
    child_gates_passed: () => [
      ...(sides.length === 0 ? ['no child ran'] : []),
      ...sides.filter(entry => viewOf(entry.side.reading) === null).map(entry => `${label(entry)}: no record, so its gate is unconfirmed.`),
      ...childFailures(formal => {
        if ((formal.gate?.issues?.length ?? 1) !== 0) return 'its formal child gate did not pass.'
        if ((formal.calculation?.issues?.length ?? 1) !== 0) return 'its calculation gate did not pass.'
        if (formal.role === 'fresh' && (formal.entrySetSource?.issues?.length ?? 1) !== 0) return 'its Entry set source check did not pass.'
        return null
      }),
    ],
  }

  const reproducibility: Record<D1cReproducibilityRule, RuleBody> = {
    two_complete_runs: () => [
      ...(runs.length === repeat ? [] : [`${runs.length} run(s) were observed; the registration requires ${repeat}.`]),
      ...runs.filter(run => !completeRun(run)).map(run => `run ${run.runIndex} is not complete (first ${run.first.process.outcome}, fresh ${run.fresh?.process.outcome ?? 'not run'}).`),
    ],
    first_and_fresh_separate_processes: () => runs.flatMap(run => {
      const first = run.first.process.pid, fresh = run.fresh?.process.pid ?? null
      if (first === null || fresh === null || first === fresh || first === start.parentPid || fresh === start.parentPid) return [`run ${run.runIndex}: first pid ${String(first)} and fresh pid ${String(fresh)} are not two separate children.`]
      const recorded = [formalOf(run.first.reading)?.pid, formalOf(run.fresh!.reading)?.pid]
      return recorded[0] === first && recorded[1] === fresh ? [] : [`run ${run.runIndex}: the records were not written by those children.`]
    }).concat(runs.length === repeat ? [] : ['not every run was observed']),
    planner_conditions_evaluated_in_both_processes: () => runs.flatMap(run => [run.first, run.fresh].flatMap((side, index) => {
      const role = index === 0 ? 'first' : 'fresh'
      if (side === null) return [`run ${run.runIndex} ${role}: not run.`]
      const evaluated = d1cPlannerConditionsEvaluated(viewOf(side.reading)?.verification?.semantic, expectation)
      return evaluated.evaluated ? [] : [`run ${run.runIndex} ${role}: ${evaluated.issues.join('; ')}.`]
    })).concat(runs.length === repeat ? [] : ['not every run was observed']),
    first_fresh_verification_semantic_equal: () => runs.flatMap((run, index) => {
      const first = run.first.reading.recomputed.verificationSha256, fresh = run.fresh?.reading.recomputed.verificationSha256 ?? null
      return first !== null && first === fresh && input.conclusions[index]?.crossProcess.identical === true ? [] : [`run ${run.runIndex}: the first and fresh verification semantic records are not equal.`]
    }).concat(runs.length === repeat ? [] : ['not every run was observed']),
    runs_verification_semantic_equal: () => runs.length === repeat && verificationShas.every(sha => sha !== null) && new Set(verificationShas).size === 1 ? [] : [`the verification semantic SHA-256s of the runs are ${JSON.stringify(verificationShas)}.`],
    materialization_semantic_equals_registered_d0c: () => {
      if (registeredD0c === null) return ['no registered D-0C identity was read']
      return runs.flatMap(run => {
        const record = viewOf(run.first.reading)
        const recomputed = run.first.reading.recomputed.materializationSha256
        return recomputed === registeredD0c.semanticSha256 && record?.identity?.semanticSha256?.matched === true && record.identity.semanticSha256.expected === registeredD0c.semanticSha256
          ? [] : [`run ${run.runIndex}: the materialization semantic SHA-256 ${String(recomputed)} is not the registered ${registeredD0c.semanticSha256}.`]
      }).concat(runs.length === repeat ? [] : ['not every run was observed'])
    },
    entry_fingerprint_equals_registered_d0c: () => {
      if (registeredD0c === null) return ['no registered D-0C identity was read']
      const expected = registeredD0c.entryFingerprint
      return runs.flatMap(run => {
        const first = viewOf(run.first.reading), fresh = run.fresh === null ? null : viewOf(run.fresh.reading)
        const values = [first?.identity?.entryFingerprint?.fromSemanticRecord, first?.identity?.entryFingerprint?.fromHandoff, first?.entrySet?.entryFingerprint, fresh?.entrySet?.entryFingerprint]
        return values.every(value => value === expected) ? [] : [`run ${run.runIndex}: the Entry fingerprints ${JSON.stringify(values)} are not the registered ${expected}.`]
      }).concat(runs.length === repeat ? [] : ['not every run was observed'])
    },
    run_integrity_issues_zero: () => input.runIssues.flatMap((issues, index) => (issues.length === 0 ? [] : [`run ${index + 1}: ${issues.length} integrity issue(s).`])),
    result_integrity_issues_zero: () => (input.resultIntegrityIssues.length === 0 ? [] : [`${input.resultIntegrityIssues.length} RESULT integrity issue(s).`]),
  }

  const judged = <K extends string>(rules: readonly string[], bodies: Record<K, RuleBody>, group: string): Record<K, D1cRuleCheck> => {
    const keys = Object.keys(bodies)
    // Fail closed: a registered rule without a judgement, or a judgement the registration does not name, never yields a validity.
    if (!sameJson([...keys].sort(), [...rules].sort())) throw new RangeError(`The ${group} rules implemented (${keys.join(', ')}) are not the registered ones (${rules.join(', ')}).`)
    return Object.fromEntries(rules.map(rule => [rule, ruleCheck(bodies[rule as K])])) as Record<K, D1cRuleCheck>
  }
  const rules = registration.formalValidity.value
  const checks = { provenance: judged(rules.provenance, provenance, 'provenance'), reproducibility: judged(rules.reproducibility, reproducibility, 'reproducibility') }
  const issues = [
    ...Object.entries(checks.provenance).flatMap(([rule, check]) => (check.passed ? [] : [`${rule}: ${check.detail}`])),
    ...Object.entries(checks.reproducibility).flatMap(([rule, check]) => (check.passed ? [] : [`${rule}: ${check.detail}`])),
  ]
  return { status: issues.length === 0 ? 'valid' : 'invalid', issues, checks }
}

// ---------------------------------------------------------------------------------------------------------------------
// Candidate outcome, acceptance and the post hoc readings (each apart from the formal validity)
// ---------------------------------------------------------------------------------------------------------------------

export interface D1cCandidateOutcome {
  /**
   * The D-1A verdict both complete runs gave (`verified`, `planner_rejected`, `objective_mismatch`, `planning_target_set_changed`, a
   * materialization outcome, `stopped_d0c_identity_mismatch`, `unmeasured`), `invalid_run_integrity` when a run's records are broken,
   * `inconsistent_across_runs` when the runs disagree, `unmeasured` when fewer runs than registered concluded.
   */
  kind: D1aVerdict['kind'] | 'inconsistent_across_runs'
  /** The common verdict (null when the runs disagree or fewer runs concluded). */
  verdict: D1aVerdict | null
  runVerdictKinds: string[]
  consistentAcrossRuns: boolean | null
  requiredRuns: number
  concludedRuns: number
}

/**
 * The candidate outcome of the measurement from its runs' D-1A conclusions, in this order: a run whose records are broken makes it
 * `invalid_run_integrity` (an invalid measurement, never a Planner result); a run stopped by its envelope, or fewer concluded runs than
 * registered, makes it `unmeasured` (never a candidate rejection); runs that disagree make it `inconsistent_across_runs` (no outcome is
 * picked); otherwise it is the one verdict every run gave.
 */
export function deriveD1cCandidateOutcome(conclusions: readonly D1aRunConclusion[], requiredRuns: number): D1cCandidateOutcome {
  const verdicts = conclusions.map(conclusion => conclusion.verdict)
  const base = { runVerdictKinds: verdicts.map(verdict => verdict.kind), requiredRuns, concludedRuns: conclusions.length }
  const consistent = verdicts.length >= 2 ? new Set(verdicts.map(verdict => hashStableValue(verdict))).size === 1 : null
  const broken = verdicts.find(verdict => verdict.kind === 'invalid_run_integrity')
  if (broken !== undefined) return { ...base, kind: 'invalid_run_integrity', verdict: structuredClone(broken), consistentAcrossRuns: consistent }
  const unmeasured = verdicts.find(verdict => verdict.kind === 'unmeasured')
  if (unmeasured !== undefined) return { ...base, kind: 'unmeasured', verdict: structuredClone(unmeasured), consistentAcrossRuns: consistent }
  if (conclusions.length < requiredRuns) return { ...base, kind: 'unmeasured', verdict: null, consistentAcrossRuns: consistent }
  if (consistent !== true) return { ...base, kind: 'inconsistent_across_runs', verdict: null, consistentAcrossRuns: consistent }
  return { ...base, kind: verdicts[0]!.kind, verdict: structuredClone(verdicts[0]!), consistentAcrossRuns: true }
}

export interface D1cAcceptance {
  /** Design 13.2 / D-1B 12.4: accepted only with a valid formal measurement and a verified candidate, both together. */
  status: 'accepted' | 'not_accepted'
  formalValidity: D1cFormalValidity['status']
  candidateOutcome: D1cCandidateOutcome['kind']
  reasons: string[]
}

export function judgeD1cAcceptance(validity: D1cFormalValidity, outcome: D1cCandidateOutcome): D1cAcceptance {
  const reasons: string[] = []
  if (validity.status !== 'valid') reasons.push('the formal measurement is invalid')
  if (outcome.kind !== 'verified') reasons.push(`the candidate outcome is ${outcome.kind}, not verified`)
  return { status: reasons.length === 0 ? 'accepted' : 'not_accepted', formalValidity: validity.status, candidateOutcome: outcome.kind, reasons }
}

/** Design 13.2 2, post hoc: the incumbent comparison of an accepted measurement only (never for an invalid one, never a minimality claim). */
export function d1cOperationCountReading(acceptance: D1cAcceptance, outcome: D1cCandidateOutcome): ReturnType<typeof d1aOperationCountReading> {
  if (acceptance.status !== 'accepted' || outcome.verdict === null) return { evaluated: false, physicalOperations: null, incumbent: D1A_INCUMBENT_PHYSICAL_OPERATIONS, judgement: 'not_evaluated', proof: 'not_claimed' }
  return d1aOperationCountReading(outcome.verdict)
}

export interface D1cMinimalityReading {
  /** `best_found`: the best verified candidate among those verified (verification budget 1: the one verified candidate). */
  status: 'best_found' | 'not_evaluated'
  /** Never claimed here: no root lower bound is compared by the runner or the derivation (design 4.6 / 10.2; post hoc in the D-1C record). */
  provenMinimum: false
  verificationBudget: number
  basis: string
}

export function d1cMinimalityReading(acceptance: D1cAcceptance, expectation: D1cRegisteredExpectation = registeredD1cExpectation()): D1cMinimalityReading {
  const budget = expectation.conditions.verification.verificationBudget
  return acceptance.status === 'accepted'
    ? { status: 'best_found', provenMinimum: false, verificationBudget: budget, basis: `The one verified structural candidate of a verification budget of ${budget}: no later candidate was examined and no root lower bound was compared, so no minimality is claimed.` }
    : { status: 'not_evaluated', provenMinimum: false, verificationBudget: budget, basis: 'Not accepted: no verified candidate under a valid formal measurement, so neither best_found nor a minimality reading applies.' }
}

export interface D1cMeasurementConclusion {
  runs: { runIndex: number; integrityIssues: string[]; conclusion: D1aRunConclusion }[]
  resultIntegrityIssues: string[]
  formalValidity: D1cFormalValidity
  candidateOutcome: D1cCandidateOutcome
  acceptance: D1cAcceptance
  postHoc: { operationCount: ReturnType<typeof d1aOperationCountReading>; minimality: D1cMinimalityReading }
  /** 0 = a valid formal measurement (accepted or not); 1 = an invalid one; 2 = an invalid one with an unmeasured child. */
  exitCode: 0 | 1 | 2
}

/**
 * The one conclusion of a D-1C measurement, derived from its observations alone (the runner and the RESULT derivation call it on the same
 * raw records and must agree): each run's integrity issues and D-1A conclusion, the RESULT integrity issues, the formal validity, the
 * candidate outcome, the acceptance and the post hoc readings.
 */
export function concludeD1cMeasurement(observation: D1cMeasurementObservation, expectation: D1cRegisteredExpectation = registeredD1cExpectation(), registration: D1cRegistration = REGISTRATION): D1cMeasurementConclusion {
  const runIssues = observation.runs.map(run => d1cRunIntegrityIssues(run, observation.start))
  const conclusions = observation.runs.map((run, index) => concludeD1aRun({ first: run.first.reading, fresh: run.fresh?.reading ?? null, integrityIssues: runIssues[index]! }))
  const resultIntegrityIssues = d1cResultIntegrityIssues(observation, runIssues)
  const formalValidity = judgeD1cFormalValidity({ observation, runIssues, resultIntegrityIssues, conclusions }, expectation, registration)
  const candidateOutcome = deriveD1cCandidateOutcome(conclusions, expectation.conditions.envelope.repeat)
  const acceptance = judgeD1cAcceptance(formalValidity, candidateOutcome)
  const unmeasured = processesOf(observation.runs).some(entry => entry.outcome !== 'completed')
  return {
    runs: observation.runs.map((run, index) => ({ runIndex: run.runIndex, integrityIssues: runIssues[index]!, conclusion: conclusions[index]! })),
    resultIntegrityIssues, formalValidity, candidateOutcome, acceptance,
    postHoc: { operationCount: d1cOperationCountReading(acceptance, candidateOutcome), minimality: d1cMinimalityReading(acceptance, expectation) },
    exitCode: formalValidity.status === 'valid' ? 0 : unmeasured ? 2 : 1,
  }
}
