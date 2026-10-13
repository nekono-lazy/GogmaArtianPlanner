/**
 * Issue #154 Global Assignment Phase D-0C (Research only; never imported by the app).
 *
 * The formal measurement contract of the materialization runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md`): the start
 * gate a formal parent applies before anything is written, the gate every formal child re-applies from its own observations,
 * the reading of a child record, the judgement of whether a run counts as a formal measurement (`formalValidity`), and the
 * materialization outcome of the run, judged apart from that validity. Every condition comes from
 * `MATERIALIZATION_D0C_PREREGISTRATION` (Phase D-0B-2); nothing here changes, defaults or overrides a registered value.
 *
 * Plain data only: nothing here reads a file, the Repository, a clock or the Export (the runner script observes them and passes
 * them in). `formalValidity = valid` says the registered conditions, the provenance and the reproducibility held; it never says
 * that every Target materialized, and `all_materialized` is never a Plan (Phase D' / D-1 decides that).
 */
import type { ExportIdentity } from './assignmentProtocol'
import {
  d0cExportIdentityDifferences, d0cRegistrationGateIssues, materializationProtocolVersion, MATERIALIZATION_D0C_PREREGISTRATION, registeredD0cConditions,
  type CandidateMaterializationClass, type ConfirmedProgress, type D0cRegistrationGate, type TargetOutcomeBrief,
} from './materializationProtocol'
import { summarizeMaterializationRun, type MaterializationRunOutcome, type MaterializationSemanticRecord } from './materializationRunner'

export const MATERIALIZATION_D0C_PHASE = 'Issue #154 Global Assignment Phase D-0C: formal materialization measurement of the D-0B-2 registered conditions (rule d0a2-v2, option set a2, the first structural candidate at W0; not a Production Plan, not Planner-verified, no Trace Replay)'
/** The Research record of Phase D-0C. */
export const MATERIALIZATION_D0C_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md'
/**
 * The registration HEAD: PR #251 (Phase D-0B-2, the registration) squash-merged into main. A formal run audits the calculation-related
 * code it measures against this commit.
 */
export const MATERIALIZATION_D0C_REGISTRATION_HEAD = '3f6717968da0b29fe8e1e7feda44833d29af0678'
/**
 * The files Phase D-0C changed for the formal guard, the provenance, the RESULT derivation and their tests: the only files under the
 * runner's code paths a formal run lets differ from the registration HEAD. A change to any other file (Production RNG / Search /
 * Planner, the Research Phase A - D prediction, enumeration, method selection, matching or independent Route checks, the build
 * configuration) refuses the formal run until it is audited and this list is changed on purpose.
 */
export const MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES = Object.freeze([
  'scripts/derive-planner-global-assignment-d0c-result.mjs',
  'scripts/derive-planner-global-assignment-d0c-result.test.ts',
  'scripts/run-planner-global-assignment-d0b.mjs',
  'scripts/run-planner-global-assignment-d0b.test.ts',
  'src/benchmarks/globalAssignment/isolation.test.ts',
  'src/benchmarks/globalAssignment/materializationFormal.test.ts',
  'src/benchmarks/globalAssignment/materializationFormal.ts',
  'src/benchmarks/globalAssignment/materializationFormalResult.test.ts',
  'src/benchmarks/globalAssignment/materializationFormalResult.ts',
  'src/benchmarks/globalAssignment/materializationFormalTestFixture.ts',
  'src/benchmarks/globalAssignment/materializationProtocol.test.ts',
  'src/benchmarks/globalAssignment/materializationProtocol.ts',
] as const)
/** The only command-line options of a formal parent: every condition comes from the registration, so anything else is an override. */
export const MATERIALIZATION_D0C_FORMAL_OPTIONS = Object.freeze(['--mode', '--export', '--expected-export-sha256', '--run-dir', '--output'] as const)

/** The registered CalculationContext (with the Production RNG Engine version) a formal run must match. */
export type RegisteredCalculationContext = (typeof MATERIALIZATION_D0C_PREREGISTRATION)['calculationContext']['value']

const isSha1 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------------------------------------------------
// Calculation-related code audit against the registration HEAD
// ---------------------------------------------------------------------------------------------------------------------

/** What the runner observed in the Repository (`git merge-base --is-ancestor`, `git diff --name-only <registration>..HEAD -- <code paths>`). */
export interface CalculationCodeAudit {
  registrationHead: string
  registrationHeadIsAncestor: boolean
  /** Committed changes under the runner's code paths since the registration HEAD, sorted (the tree itself must be clean as well). */
  changedFiles: readonly string[]
  /** A git command that could not answer (the audit then refuses; never read as "no change"). */
  error: string | null
}

export interface CalculationCodeAuditReading {
  registrationHead: string
  registrationHeadIsAncestor: boolean
  changedFiles: string[]
  /** Changed files of the Phase D-0C formal infrastructure (`MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES`). */
  formalInfrastructure: string[]
  /** Changed files outside it: each one refuses a formal run. */
  outsideFormalInfrastructure: string[]
  issues: string[]
}

export function readCalculationCodeAudit(audit: CalculationCodeAudit): CalculationCodeAuditReading {
  const allowed = new Set<string>(MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES)
  const changedFiles = [...audit.changedFiles].sort()
  const outsideFormalInfrastructure = changedFiles.filter(file => !allowed.has(file))
  const issues: string[] = []
  if (audit.registrationHead !== MATERIALIZATION_D0C_REGISTRATION_HEAD) issues.push(`The calculation code was audited against ${audit.registrationHead}, not the registration HEAD ${MATERIALIZATION_D0C_REGISTRATION_HEAD}.`)
  if (audit.error !== null) issues.push(`The calculation code audit could not run: ${audit.error}`)
  if (!audit.registrationHeadIsAncestor) issues.push(`The registration HEAD ${MATERIALIZATION_D0C_REGISTRATION_HEAD} is not an ancestor of the measured HEAD.`)
  if (outsideFormalInfrastructure.length > 0) {
    issues.push(`Calculation-related files changed since the registration HEAD outside the D-0C formal infrastructure: ${outsideFormalInfrastructure.join(', ')}. Audit them against the registered values before a formal run.`)
  }
  return {
    registrationHead: audit.registrationHead, registrationHeadIsAncestor: audit.registrationHeadIsAncestor, changedFiles,
    formalInfrastructure: changedFiles.filter(file => allowed.has(file)), outsideFormalInfrastructure, issues,
  }
}

/** Why the registration does not match the current calculation authorities or the current protocol (`[]` = it does). */
export function registrationAuthorityIssues(current: { calculationContext: RegisteredCalculationContext }): string[] {
  const registration = MATERIALIZATION_D0C_PREREGISTRATION
  const issues: string[] = []
  if (!sameJson(current.calculationContext, registration.calculationContext.value)) {
    issues.push(`The current CalculationContext ${JSON.stringify(current.calculationContext)} is not the registered ${JSON.stringify(registration.calculationContext.value)}; a version change asks for a new registration.`)
  }
  const protocolVersion = materializationProtocolVersion(registeredD0cConditions().conditions)
  if (protocolVersion !== registration.researchProtocolVersion.value) issues.push(`The registered conditions run protocol ${protocolVersion}, not the registered ${registration.researchProtocolVersion.value}.`)
  return issues
}

// ---------------------------------------------------------------------------------------------------------------------
// Start gate (parent)
// ---------------------------------------------------------------------------------------------------------------------

export interface D0cFormalStartInput {
  registration: D0cRegistrationGate
  repository: { workingTreeClean: boolean; uncommittedBenchmarkCode: boolean; calculationAudit: CalculationCodeAudit }
  allowUncommitted: boolean
  /** Command-line options other than MATERIALIZATION_D0C_FORMAL_OPTIONS and --allow-uncommitted. */
  overrideOptions: readonly string[]
  /** `--expected-export-sha256` as given (null = not given). A formal run requires it. */
  cliExpectedSha256: string | null
  /** The identity read from the committed D-0B-2 document (`git show HEAD:<doc>`), or why it could not be read. */
  registeredExport: { identity: ExportIdentity | null; issues: readonly string[] }
  actualExport: ExportIdentity
  /** The run dir and the output: a formal run writes only into git-ignored paths, so its children still observe a clean tree. */
  outputPaths: readonly { option: string; path: string; gitIgnored: boolean }[]
  currentAuthorities: { calculationContext: RegisteredCalculationContext }
}

/**
 * Why a formal run must not start (`[]` = it may). The registration, the clean committed tree, the absence of overrides, the
 * registered Export (read from the committed document, named again on the command line, and matched by name, length and hash),
 * the git-ignored outputs, the calculation code audit and the current authorities are all required; none can be skipped.
 */
export function d0cFormalStartIssues(input: D0cFormalStartInput): string[] {
  const issues = d0cRegistrationGateIssues(input.registration)
  if (input.allowUncommitted || input.repository.uncommittedBenchmarkCode || !input.repository.workingTreeClean) {
    issues.push('A formal run needs a clean, committed Working Tree (no --allow-uncommitted).')
  }
  if (input.overrideOptions.length > 0) issues.push(`A formal run takes its conditions from the registration only; remove ${input.overrideOptions.join(', ')}.`)
  if (input.registeredExport.identity === null) issues.push(`The registered Export identity could not be read from the committed D-0B-2 document: ${input.registeredExport.issues.join(' ')}`)
  if (input.cliExpectedSha256 === null) issues.push('A formal run requires --expected-export-sha256 naming the registered Export SHA-256.')
  if (input.registeredExport.identity !== null) {
    if (input.cliExpectedSha256 !== null && input.cliExpectedSha256.toLowerCase() !== input.registeredExport.identity.sha256) {
      issues.push(`--expected-export-sha256 ${input.cliExpectedSha256} is not the registered Export SHA-256 ${input.registeredExport.identity.sha256}.`)
    }
    issues.push(...d0cExportIdentityDifferences(input.actualExport, input.registeredExport.identity))
  }
  for (const output of input.outputPaths) {
    if (!output.gitIgnored) issues.push(`${output.option} ${output.path} is not git-ignored; a formal run writes only into ignored paths (for example under .local/).`)
  }
  issues.push(...readCalculationCodeAudit(input.repository.calculationAudit).issues)
  issues.push(...registrationAuthorityIssues(input.currentAuthorities))
  return issues
}

// ---------------------------------------------------------------------------------------------------------------------
// Child gate (every formal child, from its own observations)
// ---------------------------------------------------------------------------------------------------------------------

export interface D0cFormalChildGateInput {
  registration: D0cRegistrationGate
  /** The task file as read (never trusted on its own). */
  task: unknown
  /** What the child itself observed in the Repository. */
  repository: { headSha: string; workingTreeClean: boolean; uncommittedBenchmarkCode: boolean; calculationAudit: CalculationCodeAudit }
  /** The identity the child itself read from the committed D-0B-2 document. */
  registeredExportFromHead: { identity: ExportIdentity | null; issues: readonly string[] }
  /** The Export the child itself read and hashed. */
  actualExport: ExportIdentity
  /** `process.execArgv` of the child: the registered heap envelope must be applied to it. */
  execArgv: readonly string[]
}

/**
 * Why a child must refuse a formal task before it computes anything (`[]` = it may load the input). A child never trusts the task:
 * it re-applies the registration gate, compares the task's protocol, conditions and envelope with the registration, checks the
 * Repository it runs in (clean, committed, on the task's measurement HEAD, the calculation code audited against the registration
 * HEAD), re-reads the registered Export identity from HEAD, and compares the Export it read itself. A hand-written formal task
 * therefore cannot run where the parent would have refused.
 */
export function d0cFormalChildGateIssues(input: D0cFormalChildGateInput): string[] {
  const task = isRecord(input.task) ? input.task : {}
  if (task.mode !== 'formal') return [`A formal child gate was asked for a ${String(task.mode)} task.`]
  const issues = d0cRegistrationGateIssues(input.registration)
  const registration = MATERIALIZATION_D0C_PREREGISTRATION
  const registered = registeredD0cConditions()
  if (task.protocolVersion !== registration.researchProtocolVersion.value) issues.push(`The task protocol ${String(task.protocolVersion)} is not the registered ${registration.researchProtocolVersion.value}.`)
  if (!sameJson(task.conditions, registered.conditions)) issues.push('The task conditions are not the registered conditions.')
  if (!sameJson(task.envelope, registered.envelope)) issues.push('The task envelope is not the registered envelope.')
  if (task.registrationHead !== MATERIALIZATION_D0C_REGISTRATION_HEAD) issues.push(`The task names the registration HEAD ${String(task.registrationHead)}, not ${MATERIALIZATION_D0C_REGISTRATION_HEAD}.`)
  const repository = input.repository
  if (!isSha1(task.repositoryHeadSha)) issues.push('The task names no measurement HEAD.')
  else if (task.repositoryHeadSha !== repository.headSha) issues.push(`The child runs at HEAD ${repository.headSha}, not the task's measurement HEAD ${task.repositoryHeadSha}.`)
  if (!repository.workingTreeClean) issues.push('The child observed a Working Tree that is not clean.')
  if (repository.uncommittedBenchmarkCode) issues.push('The child observed uncommitted benchmark code.')
  issues.push(...readCalculationCodeAudit(repository.calculationAudit).issues)
  const fromHead = input.registeredExportFromHead
  if (fromHead.identity === null) issues.push(`The child could not read the registered Export identity from HEAD: ${fromHead.issues.join(' ')}`)
  else {
    if (!sameJson(task.registeredExport, fromHead.identity)) issues.push('The task does not carry the registered Export identity read from HEAD.')
    issues.push(...d0cExportIdentityDifferences(input.actualExport, fromHead.identity))
  }
  const taskExport = isRecord(task.actualExport) ? task.actualExport : null
  if (taskExport === null || taskExport.sha256 !== input.actualExport.sha256 || taskExport.bytes !== input.actualExport.bytes) issues.push('The Export differs from the one the parent hashed.')
  const heapFlag = `--max-old-space-size=${registered.envelope.childHeapMb}`
  if (!input.execArgv.includes(heapFlag)) issues.push(`The child runs without the registered heap envelope ${heapFlag} (execArgv ${JSON.stringify(input.execArgv)}).`)
  return issues
}

/**
 * Why a child must refuse a formal task once its input is loaded and before any calculation (`[]` = it may run): the CalculationContext
 * of the restored PlannerInput and the Production RNG Engine version must be the registered ones (a version change asks for a new
 * registration, never a formal run under the old one).
 */
export function d0cFormalChildCalculationIssues(observed: { calculationContext: unknown; rngEngineVersion: unknown }): string[] {
  const registered = MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value
  const issues: string[] = []
  if (!sameJson(observed.calculationContext, registered)) issues.push(`The input CalculationContext ${JSON.stringify(observed.calculationContext)} is not the registered ${JSON.stringify(registered)}.`)
  if (observed.rngEngineVersion !== registered.rngEngineVersion) issues.push(`The Production RNG Engine ${String(observed.rngEngineVersion)} is not the registered ${registered.rngEngineVersion}.`)
  return issues
}

// ---------------------------------------------------------------------------------------------------------------------
// Child records, as the parent reads them
// ---------------------------------------------------------------------------------------------------------------------

export interface MaterializationRecordExpectation {
  mode: 'smoke' | 'formal'
  protocolVersion: string
  actualExport: ExportIdentity
  /** The parent's measurement HEAD (compared for a formal record, which states the HEAD its child observed). */
  repositoryHeadSha: string
}

export interface MaterializationRecordInspection {
  /** Every field the aggregation and the validity judgement read is present. */
  complete: boolean
  /** The record's mode / protocol / Export (and for a formal record the child's HEAD) agree with the parent. */
  consistent: boolean
  /** Formal records: the child's own gate passed (null for a smoke record or an incomplete one). */
  childGatePassed: boolean | null
  /** Formal records: the child's CalculationContext and Engine are the registered ones (null for a smoke record or an incomplete one). */
  calculationContextMatched: boolean | null
  issues: string[]
}

/** Reads one child record as the parent does (the smoke consistency rule is the D-0B one; a formal record must also state its gate). */
export function inspectMaterializationRecord(record: unknown, expected: MaterializationRecordExpectation): MaterializationRecordInspection {
  const issues: string[] = []
  const value = isRecord(record) ? record : null
  const semantic = value !== null && isRecord(value.semantic) ? value.semantic : null
  const exportActual = value !== null && isRecord(value.exportVerification) && isRecord(value.exportVerification.actual) ? value.exportVerification.actual : null
  const gate = value !== null && isRecord(value.formalChildGate) ? value.formalChildGate : null
  const missing: string[] = []
  if (value === null) missing.push('record')
  else {
    if (semantic === null) missing.push('semantic')
    else {
      if (!isRecord(semantic.outcome)) missing.push('semantic.outcome')
      if (!isRecord(semantic.input)) missing.push('semantic.input')
      if (!Array.isArray(semantic.candidates)) missing.push('semantic.candidates')
      if (!Array.isArray(semantic.integrityIssues)) missing.push('semantic.integrityIssues')
    }
    if (!isRecord(value.observed)) missing.push('observed')
    if (!isRecord(value.memory)) missing.push('memory')
    if (exportActual === null) missing.push('exportVerification.actual')
    if (!isRecord(value.calculationContext)) missing.push('calculationContext')
    if (typeof value.rngEngineVersion !== 'string') missing.push('rngEngineVersion')
    if (expected.mode === 'formal') {
      if (gate === null || !Array.isArray(gate.issues)) missing.push('formalChildGate')
      if (!isSha1(value.repositoryHeadSha)) missing.push('repositoryHeadSha')
    }
  }
  if (missing.length > 0) issues.push(`The record is incomplete: ${missing.join(', ')}.`)
  const complete = missing.length === 0
  let consistent = value !== null && value.mode === expected.mode && value.protocolVersion === expected.protocolVersion && exportActual !== null
    && exportActual.sha256 === expected.actualExport.sha256 && exportActual.bytes === expected.actualExport.bytes
  if (expected.mode === 'formal' && value !== null && value.repositoryHeadSha !== expected.repositoryHeadSha) consistent = false
  if (!consistent) issues.push('The record disagrees with the parent (mode / protocol / Export / HEAD).')
  let childGatePassed: boolean | null = null
  let calculationContextMatched: boolean | null = null
  if (expected.mode === 'formal' && complete) {
    childGatePassed = (gate!.issues as unknown[]).length === 0
    if (!childGatePassed) issues.push('The record states that its formal child gate did not pass.')
    calculationContextMatched = d0cFormalChildCalculationIssues({ calculationContext: value!.calculationContext, rngEngineVersion: value!.rngEngineVersion }).length === 0
    if (!calculationContextMatched) issues.push('The record carries another CalculationContext or Engine than the registered ones.')
  }
  return { complete, consistent, childGatePassed, calculationContextMatched, issues }
}

// ---------------------------------------------------------------------------------------------------------------------
// Formal validity
// ---------------------------------------------------------------------------------------------------------------------

export type D0cFormalValidityStatus = 'not_applicable' | 'valid' | 'invalid'

export interface D0cFormalValidityRun {
  id: string
  /** `measured`: the child completed and its record was read. `unmeasured`: timeout / out of memory / process failure / cancel / unreadable record. */
  status: 'measured' | 'unmeasured'
  reason: string | null
  semanticSha256: string | null
  recordComplete: boolean | null
  recordConsistent: boolean | null
  childGatePassed: boolean | null
  calculationContextMatched: boolean | null
  /** The semantic record's own integrity issues (a fail-closed stop is one: design D0A2 10.2 `run_error`). */
  integrityIssues: readonly string[]
}

export interface D0cFormalValidityInput {
  mode: 'smoke' | 'formal'
  registration: D0cRegistrationGate & { requiredRuns: number }
  provenance: {
    /** The start gate the parent applied (null for a smoke run). A formal run only starts with `[]`; it is re-judged here. */
    startIssues: readonly string[] | null
    measurementHeadSha: string
    benchmarkCodeSha256: string
    workingTreeClean: boolean
    uncommittedBenchmarkCode: boolean
    overrideOptions: readonly string[]
    /** `differencesFromD0cRegistration()` of the conditions and envelope the run used. */
    differencesFromRegistration: readonly string[]
    exportVerification: { registeredMatched: boolean | null; cliMatched: boolean | null }
    calculationAudit: CalculationCodeAudit
  }
  runs: readonly D0cFormalValidityRun[]
  determinism: { identical: boolean | null }
  /** The aggregated RESULT's `integrityIssues` as finally recorded. */
  integrityIssues: readonly string[]
}

export interface D0cFormalValidity {
  /** `not_applicable`: a smoke run (no formal claim). `valid`: every formal condition held. `invalid`: a formal run that is not a formal measurement. */
  status: D0cFormalValidityStatus
  issues: string[]
  checks: {
    provenance: {
      registrationGate: boolean
      completeRegistration: boolean
      startGatePassed: boolean
      measurementHeadRecorded: boolean
      committedCleanTree: boolean
      benchmarkCodeHashRecorded: boolean
      noOverrides: boolean
      conditionsMatchRegistration: boolean
      exportRegisteredMatched: boolean
      calculationCodeAudit: { passed: boolean; registrationHead: string; registrationHeadIsAncestor: boolean; changedFiles: string[]; outsideFormalInfrastructure: string[] }
      childGuardsPassed: boolean
      calculationContextMatched: boolean
    } | null
    reproducibility: {
      requiredRuns: number
      runs: number
      measuredRuns: number
      allMeasured: boolean
      recordsComplete: boolean
      recordsConsistent: boolean
      noRunIntegrityIssues: boolean
      semanticHashesEqual: boolean | null
      identical: boolean | null
    } | null
    aggregateIntegrityIssueCount: number
    noAggregateIntegrityIssues: boolean | null
  }
}

/**
 * Whether a run counts as a formal measurement (Phase D-0C). A smoke run is `not_applicable`. A formal run is `valid` only when the
 * provenance (registration enabled and complete, start gate passed, measurement HEAD and benchmark code hash recorded, clean committed
 * tree, no override, the registered conditions, the registered Export, the calculation code audited against the registration HEAD,
 * every child's own gate and CalculationContext), the reproducibility (the registered number of children all measured, records
 * complete and consistent, one semantic hash, `determinism.identical === true`) and an empty aggregate `integrityIssues` all hold.
 * It never reads whether the Targets materialized: a budget stop measured twice is a valid measurement of an unconfirmed outcome, and
 * `all_materialized` with a broken provenance is invalid.
 */
export function judgeD0cFormalValidity(input: D0cFormalValidityInput): D0cFormalValidity {
  const aggregateIntegrityIssueCount = input.integrityIssues.length
  if (input.mode !== 'formal') {
    return { status: 'not_applicable', issues: [], checks: { provenance: null, reproducibility: null, aggregateIntegrityIssueCount, noAggregateIntegrityIssues: null } }
  }
  const issues: string[] = []
  const gateIssues = d0cRegistrationGateIssues(input.registration)
  issues.push(...gateIssues)
  const p = input.provenance
  const startGatePassed = p.startIssues !== null && p.startIssues.length === 0
  if (!startGatePassed) issues.push(`The start gate did not pass: ${p.startIssues === null ? 'not applied' : p.startIssues.join(' ')}`)
  const measurementHeadRecorded = isSha1(p.measurementHeadSha)
  if (!measurementHeadRecorded) issues.push('No measurement HEAD was recorded.')
  const committedCleanTree = p.workingTreeClean && !p.uncommittedBenchmarkCode
  if (!committedCleanTree) issues.push('The Working Tree was not clean and committed.')
  const benchmarkCodeHashRecorded = isSha256(p.benchmarkCodeSha256)
  if (!benchmarkCodeHashRecorded) issues.push('No benchmark code SHA-256 was recorded.')
  const noOverrides = p.overrideOptions.length === 0
  if (!noOverrides) issues.push(`Command-line overrides were given: ${p.overrideOptions.join(', ')}.`)
  const conditionsMatchRegistration = p.differencesFromRegistration.length === 0
  if (!conditionsMatchRegistration) issues.push(`The run's conditions differ from the registration: ${p.differencesFromRegistration.join('; ')}`)
  const exportRegisteredMatched = p.exportVerification.registeredMatched === true && p.exportVerification.cliMatched === true
  if (!exportRegisteredMatched) issues.push('The Export was not verified against the registered identity and the command-line hash.')
  const audit = readCalculationCodeAudit(p.calculationAudit)
  issues.push(...audit.issues)

  const runs = input.runs
  const measured = runs.filter(run => run.status === 'measured')
  const childGuardsPassed = measured.length > 0 && measured.every(run => run.childGatePassed === true)
  for (const run of measured.filter(run => run.childGatePassed !== true)) issues.push(`Run ${run.id} carries no passed formal child gate.`)
  const calculationContextMatched = measured.length > 0 && measured.every(run => run.calculationContextMatched === true)
  for (const run of measured.filter(run => run.calculationContextMatched !== true)) issues.push(`Run ${run.id} did not run with the registered CalculationContext and Engine.`)

  const requiredRuns = input.registration.requiredRuns
  const allMeasured = runs.length === requiredRuns && measured.length === requiredRuns
  if (runs.length !== requiredRuns) issues.push(`${runs.length} run(s) were started; the registration requires ${requiredRuns}.`)
  for (const run of runs.filter(run => run.status === 'unmeasured')) issues.push(`Run ${run.id} is unmeasured (${run.reason ?? 'unknown'}).`)
  const recordsComplete = measured.every(run => run.recordComplete === true)
  for (const run of measured.filter(run => run.recordComplete !== true)) issues.push(`Run ${run.id} record is incomplete.`)
  const recordsConsistent = measured.every(run => run.recordConsistent === true)
  for (const run of measured.filter(run => run.recordConsistent !== true)) issues.push(`Run ${run.id} record disagrees with the parent (mode / protocol / Export / HEAD).`)
  const noRunIntegrityIssues = runs.every(run => run.integrityIssues.length === 0)
  for (const run of runs.filter(run => run.integrityIssues.length > 0)) issues.push(`Run ${run.id} has integrity issues: ${run.integrityIssues.join('; ')}`)
  const hashes = measured.map(run => run.semanticSha256)
  const semanticHashesEqual = measured.length >= 2 && hashes.every(hash => hash !== null) ? new Set(hashes).size === 1 : null
  if (semanticHashesEqual === false) issues.push('The semantic records of the repeated runs differ.')
  if (semanticHashesEqual === null) issues.push('Reproducibility is unconfirmed: fewer than two measured runs with a semantic hash.')
  if (input.determinism.identical !== true) issues.push(`determinism.identical is ${String(input.determinism.identical)}; a formal measurement requires true.`)
  const noAggregateIntegrityIssues = aggregateIntegrityIssueCount === 0
  if (!noAggregateIntegrityIssues) issues.push(`The aggregated RESULT carries ${aggregateIntegrityIssueCount} integrity issue(s): ${input.integrityIssues.join(' | ')}`)

  return {
    status: issues.length === 0 ? 'valid' : 'invalid', issues,
    checks: {
      provenance: {
        registrationGate: gateIssues.length === 0, completeRegistration: input.registration.registrationIssues.length === 0, startGatePassed, measurementHeadRecorded,
        committedCleanTree, benchmarkCodeHashRecorded, noOverrides, conditionsMatchRegistration, exportRegisteredMatched,
        calculationCodeAudit: {
          passed: audit.issues.length === 0, registrationHead: audit.registrationHead, registrationHeadIsAncestor: audit.registrationHeadIsAncestor,
          changedFiles: audit.changedFiles, outsideFormalInfrastructure: audit.outsideFormalInfrastructure,
        },
        childGuardsPassed, calculationContextMatched,
      },
      reproducibility: {
        requiredRuns, runs: runs.length, measuredRuns: measured.length, allMeasured, recordsComplete, recordsConsistent, noRunIntegrityIssues,
        semanticHashesEqual, identical: input.determinism.identical,
      },
      aggregateIntegrityIssueCount, noAggregateIntegrityIssues,
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Materialization outcome (judged apart from the formal validity)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `all_materialized`: every planning Target of the candidate has a matching Entry (not a Plan; D-1 decides). `not_all_materialized`:
 * measured, with a Target that is unconfirmed (budget / extent), not executed (gate), unsupported or mismatched - a measured fact,
 * never "no Route". `run_error`: a fail-closed stop (design D0A2 10.2). `no_candidate_materialized`: the structural stage ended
 * without a candidate. `unmeasured`: no run measured; only the progress a journal confirmed, never completed.
 */
export type D0cMaterializationVerdict = 'all_materialized' | 'not_all_materialized' | 'run_error' | 'no_candidate_materialized' | 'unmeasured'

export interface D0cTargetOutcomeCounts {
  settled: number
  materialized: number
  shapeMismatch: number
  unconfirmed: Record<string, number>
  notExecuted: Record<string, number>
  unsupported: Record<string, number>
  unmeasured: Record<string, number>
  /** Targets the run never reached (after a stop, or after a fail-closed Target). */
  notAttempted: number
  /** A Target that started and never settled before its run was stopped: its result is unknown, never inferred. */
  inProgressWithoutOutcome: number
}

export interface D0cCandidateOutcome {
  candidateIndex: number
  ordinal: number
  objective: number
  targetCount: number
  /** Null only for a candidate an unmeasured run started and never settled. */
  classification: CandidateMaterializationClass | null
  attempted: number
  materialized: number
  notAttempted: number
  /** The materialization order index and outcome the candidate stopped at (null when every Target materialized or nothing settled). */
  firstUnresolved: { orderIndex: number; kind: string; reason: string | null } | null
  targetOutcomes: D0cTargetOutcomeCounts
  materializedBy: { candidate_search_projected: number; shape_constrained: number; planner_alternative_reservation: number }
  /** Each stop kind counted on its own (Targets), never merged into one "failure". */
  independentStops: { searchScaleGate: number; shapeSearchBudget: number; unsupported: number; failClosed: number }
  /** The fail-closed code (no Target identifier), null without a fail-closed stop. */
  failClosedCode: string | null
}

export interface D0cMaterializationOutcome {
  /** `measured_records`: the semantic record of the measured run(s). `journal_confirmed_progress`: no run measured. `none`: nothing to read. */
  basis: 'measured_records' | 'journal_confirmed_progress' | 'none'
  measuredRuns: number
  /** The per-candidate outcome derived from each measured record is the same (null with fewer than two measured runs). */
  consistentAcrossMeasuredRuns: boolean | null
  verdict: D0cMaterializationVerdict
  runOutcome: MaterializationRunOutcome['kind'] | null
  planningTargetCount: number | null
  candidates: D0cCandidateOutcome[]
  claims: string
}

const OUTCOME_CLAIMS = 'none: all_materialized is not a Plan and not Planner-verified (D-1 decides); unconfirmed / not executed / unsupported / unmeasured never mean that no Route or Plan exists'

function emptyCounts(): D0cTargetOutcomeCounts {
  return { settled: 0, materialized: 0, shapeMismatch: 0, unconfirmed: {}, notExecuted: {}, unsupported: {}, unmeasured: {}, notAttempted: 0, inProgressWithoutOutcome: 0 }
}

const bump = (counts: Record<string, number>, key: string | null) => { const name = key ?? 'unknown'; counts[name] = (counts[name] ?? 0) + 1 }

function countOutcomes(briefs: readonly TargetOutcomeBrief[]): D0cTargetOutcomeCounts {
  const counts = emptyCounts()
  for (const brief of briefs) {
    counts.settled += 1
    switch (brief.kind) {
      case 'materialized': counts.materialized += 1; break
      case 'shape_mismatch': counts.shapeMismatch += 1; break
      case 'unconfirmed': bump(counts.unconfirmed, brief.reason); break
      case 'not_executed': bump(counts.notExecuted, brief.reason); break
      case 'unsupported': bump(counts.unsupported, brief.reason); break
      case 'unmeasured': bump(counts.unmeasured, brief.reason); break
    }
  }
  return counts
}

function materializedByOf(briefs: readonly TargetOutcomeBrief[]): D0cCandidateOutcome['materializedBy'] {
  const by = { candidate_search_projected: 0, shape_constrained: 0, planner_alternative_reservation: 0 }
  for (const brief of briefs) if (brief.kind === 'materialized' && brief.method !== null && brief.method in by) by[brief.method as keyof typeof by] += 1
  return by
}

function stopsOf(counts: D0cTargetOutcomeCounts, failClosed: boolean): D0cCandidateOutcome['independentStops'] {
  return {
    searchScaleGate: counts.notExecuted.search_scale_gate ?? 0,
    shapeSearchBudget: counts.unconfirmed.shape_search_budget_reached ?? 0,
    unsupported: Object.values(counts.unsupported).reduce((sum, value) => sum + value, 0),
    failClosed: failClosed ? 1 : 0,
  }
}

function candidateOutcomesOfRecord(semantic: MaterializationSemanticRecord): D0cCandidateOutcome[] {
  const summary = summarizeMaterializationRun(semantic)
  return summary.candidates.map((candidate, index) => {
    const record = semantic.candidates[index]!
    const briefs = candidate.targets.map(target => target.outcome)
    const counts = countOutcomes(briefs)
    counts.notAttempted = candidate.notAttemptedTargetCount
    return {
      candidateIndex: candidate.candidateIndex, ordinal: candidate.ordinal, objective: candidate.objective, targetCount: candidate.targetCount,
      classification: candidate.classification, attempted: candidate.attemptedTargetCount, materialized: candidate.materializedTargetCount, notAttempted: candidate.notAttemptedTargetCount,
      firstUnresolved: candidate.firstUnresolved === null ? null : { orderIndex: candidate.firstUnresolved.orderIndex, kind: candidate.firstUnresolved.outcome.kind, reason: 'reason' in candidate.firstUnresolved.outcome ? String(candidate.firstUnresolved.outcome.reason) : null },
      targetOutcomes: counts, materializedBy: materializedByOf(briefs), independentStops: stopsOf(counts, record.failClosed !== null), failClosedCode: record.failClosed?.code ?? null,
    }
  })
}

function candidateOutcomesOfJournal(progress: ConfirmedProgress): D0cCandidateOutcome[] {
  return progress.candidates.map(candidate => {
    const briefs = candidate.settledTargets.map(target => target.outcome)
    const counts = countOutcomes(briefs)
    counts.inProgressWithoutOutcome = candidate.targetInProgress === null ? 0 : 1
    counts.notAttempted = candidate.settled?.notAttemptedTargetCount ?? Math.max(0, candidate.targetCount - counts.settled - counts.inProgressWithoutOutcome)
    const unresolved = candidate.settledTargets.find(target => target.outcome.kind !== 'materialized') ?? null
    return {
      candidateIndex: candidate.candidateIndex, ordinal: candidate.ordinal, objective: candidate.objective, targetCount: candidate.targetCount,
      classification: candidate.settled?.classification ?? null, attempted: counts.settled, materialized: counts.materialized, notAttempted: counts.notAttempted,
      firstUnresolved: unresolved === null ? null : { orderIndex: unresolved.orderIndex, kind: unresolved.outcome.kind, reason: unresolved.outcome.reason },
      targetOutcomes: counts, materializedBy: materializedByOf(briefs), independentStops: stopsOf(counts, candidate.settled?.classification === 'fail_closed'), failClosedCode: null,
    }
  })
}

/**
 * The materialization outcome of a run, from its measured semantic record(s), or, when no run measured, from the progress the first
 * unmeasured run's journal confirmed (the Target in progress stays without an outcome). Never the formal validity.
 */
export function summarizeD0cMaterializationOutcome(input: { measured: readonly MaterializationSemanticRecord[]; unmeasuredProgress: ConfirmedProgress | null }): D0cMaterializationOutcome {
  if (input.measured.length > 0) {
    const [first] = input.measured
    const derived = input.measured.map(candidateOutcomesOfRecord)
    const candidates = derived[0]!
    const runOutcome = first!.outcome
    const verdict: D0cMaterializationVerdict = runOutcome.kind !== 'structural_candidates_materialized' ? 'no_candidate_materialized'
      : candidates.some(candidate => candidate.classification === 'fail_closed') ? 'run_error'
        : candidates[0]?.classification === 'all_materialized' ? 'all_materialized' : 'not_all_materialized'
    return {
      basis: 'measured_records', measuredRuns: input.measured.length,
      consistentAcrossMeasuredRuns: input.measured.length >= 2 ? derived.every(value => sameJson(value, candidates)) && input.measured.every(record => sameJson(record.outcome, runOutcome)) : null,
      verdict, runOutcome: runOutcome.kind, planningTargetCount: first!.input.planningTargetCount, candidates, claims: OUTCOME_CLAIMS,
    }
  }
  if (input.unmeasuredProgress !== null) {
    return {
      basis: 'journal_confirmed_progress', measuredRuns: 0, consistentAcrossMeasuredRuns: null, verdict: 'unmeasured', runOutcome: null,
      planningTargetCount: input.unmeasuredProgress.context?.planningTargetCount ?? null, candidates: candidateOutcomesOfJournal(input.unmeasuredProgress), claims: OUTCOME_CLAIMS,
    }
  }
  return { basis: 'none', measuredRuns: 0, consistentAcrossMeasuredRuns: null, verdict: 'unmeasured', runOutcome: null, planningTargetCount: null, candidates: [], claims: OUTCOME_CLAIMS }
}
