import { describe, expect, it } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/common'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { ShapeConstrainedSearchError } from '../../domain/search/research'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { productionShapeMaterializationSearchPort } from './materialize'
import {
  d0cFormalChildCalculationIssues, d0cFormalChildGateIssues, d0cFormalStartIssues, inspectMaterializationRecord, judgeD0cFormalValidity, MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES,
  MATERIALIZATION_D0C_FORMAL_OPTIONS, MATERIALIZATION_D0C_REGISTRATION_HEAD, readCalculationCodeAudit, summarizeD0cMaterializationOutcome,
  type CalculationCodeAudit, type D0cFormalChildGateInput, type D0cFormalStartInput, type D0cFormalValidityInput, type D0cFormalValidityRun,
} from './materializationFormal'
import {
  d0cRegistrationGate, d0cRegistrationGateIssues, MATERIALIZATION_D0A2B_PROTOCOL_VERSION, MATERIALIZATION_D0C_PREREGISTRATION, parseProgressJournal, readD0cRegisteredExportIdentity,
  registeredD0cConditions, type D0cRegistration, type ProgressJournalLine, type ShapeMaterializationResearchConditions,
} from './materializationProtocol'
import { runMaterializationSmoke, type MaterializationRunExecution } from './materializationRunner'
import { materializationScenario, OPEN_GATE, type MaterializationScenarioSpec } from './materializationTestFixture'
import { V1_GOLDEN_RUNNER_SPECS } from './materializationV1GoldenTestFixture'
import { OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE } from './shapeMaterializationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0C (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md`): the formal contract of the
 * materialization runner - the start gate, the child gate a hand-written task cannot bypass, the reading of a child record, the
 * formal validity, and the materialization outcome judged apart from it. Synthetic registrations keep the refusal of a disabled or
 * incomplete registration under test now that the real one is enabled.
 */

const d0b2Document = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', { query: '?raw', import: 'default', eager: true }))[0] as string
const REGISTERED = readD0cRegisteredExportIdentity(d0b2Document).identity!
const HEAD = 'a'.repeat(40)
const OTHER_HEAD = 'f'.repeat(40)

/**
 * The CalculationContext the D-0C formal runs were registered and run with: the Master and Engine authorities of this checkout and
 * the calculation schema 17 the registration records. Issue #278 PR-2 moved the Production schema to 18, so a formal run under the
 * current runtime asks for a new registration (tested below); the registered runs themselves are unchanged.
 */
function registeredContext() {
  const master = loadMasterData()
  if (!master.ok) throw new Error('Master data failed to load.')
  return { gameVersion: master.data.manifest.gameVersion, masterDataVersion: master.data.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: 17 }
}

const AUDIT_OK: CalculationCodeAudit = {
  registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, registrationHeadIsAncestor: true, error: null,
  changedFiles: ['scripts/run-planner-global-assignment-d0b.mjs', 'src/benchmarks/globalAssignment/materializationFormal.ts', 'src/benchmarks/globalAssignment/materializationProtocol.ts'],
}
const disabledRegistration = { ...MATERIALIZATION_D0C_PREREGISTRATION, formalRun: { enabled: false, enabledBy: null, startsIn: 'D-0C' } } as unknown as D0cRegistration
const incompleteRegistration = { ...MATERIALIZATION_D0C_PREREGISTRATION, shapeSearchBudget: undefined } as unknown as D0cRegistration

function startInput(edit: Partial<D0cFormalStartInput> = {}): D0cFormalStartInput {
  return {
    registration: d0cRegistrationGate(), repository: { workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit: AUDIT_OK }, allowUncommitted: false, overrideOptions: [],
    cliExpectedSha256: REGISTERED.sha256, registeredExport: { identity: REGISTERED, issues: [] }, actualExport: { ...REGISTERED },
    outputPaths: [{ option: '--run-dir', path: '.local/d0c.run', gitIgnored: true }, { option: '--output', path: '.local/d0c.json', gitIgnored: true }],
    currentAuthorities: { calculationContext: registeredContext() },
    ...edit,
  }
}

function childInput(task: Record<string, unknown> = {}, edit: Partial<D0cFormalChildGateInput> = {}): D0cFormalChildGateInput {
  const { conditions, envelope } = registeredD0cConditions()
  return {
    registration: d0cRegistrationGate(),
    task: { mode: 'formal', protocolVersion: MATERIALIZATION_D0A2B_PROTOCOL_VERSION, repositoryHeadSha: HEAD, registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, conditions, envelope, registeredExport: { ...REGISTERED }, actualExport: { ...REGISTERED }, ...task },
    repository: { headSha: HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit: AUDIT_OK },
    registeredExportFromHead: { identity: REGISTERED, issues: [] }, actualExport: { ...REGISTERED }, execArgv: ['--max-old-space-size=4096'],
    ...edit,
  }
}

function measuredRun(id: string, edit: Partial<D0cFormalValidityRun> = {}): D0cFormalValidityRun {
  return { id, status: 'measured', reason: null, semanticSha256: 'b'.repeat(64), recordComplete: true, recordConsistent: true, childGatePassed: true, calculationContextMatched: true, integrityIssues: [], ...edit }
}

function validityInput(edit: Partial<D0cFormalValidityInput> = {}): D0cFormalValidityInput {
  return {
    mode: 'formal', registration: { ...d0cRegistrationGate(), requiredRuns: 2 },
    provenance: {
      startIssues: [], measurementHeadSha: HEAD, benchmarkCodeSha256: 'c'.repeat(64), workingTreeClean: true, uncommittedBenchmarkCode: false, overrideOptions: [], differencesFromRegistration: [],
      exportVerification: { registeredMatched: true, cliMatched: true }, calculationAudit: AUDIT_OK,
    },
    runs: [measuredRun('materialize-1'), measuredRun('materialize-2')], determinism: { identical: true }, integrityIssues: [],
    ...edit,
  }
}

describe('Phase D-0C registration gate', () => {
  it('passes the real registration (enabled, complete) and keeps refusing a disabled or an incomplete one', () => {
    expect(d0cRegistrationGate()).toEqual({ formalRunEnabled: true, registrationIssues: [] })
    expect(d0cRegistrationGateIssues(d0cRegistrationGate())).toEqual([])
    expect(d0cRegistrationGateIssues(d0cRegistrationGate(disabledRegistration))).toEqual([expect.stringMatching(/^A formal run is not enabled/)])
    const incomplete = d0cRegistrationGate(incompleteRegistration)
    expect(incomplete.registrationIssues).toEqual(['shapeSearchBudget is not registered.'])
    expect(d0cRegistrationGateIssues(incomplete)).toEqual([expect.stringMatching(/^The D-0C pre-registration is incomplete: shapeSearchBudget is not registered\./)])
    // An item without its record (basis / evidence) is incomplete too, never filled in.
    const unexplained = { ...MATERIALIZATION_D0C_PREREGISTRATION, nodeBudget: { ...MATERIALIZATION_D0C_PREREGISTRATION.nodeBudget, basis: '', evidence: [] } } as unknown as D0cRegistration
    expect(d0cRegistrationGate(unexplained).registrationIssues).toEqual(['nodeBudget.basis is missing.', 'nodeBudget.evidence is missing.'])
    // A registered value the conditions validation refuses keeps the gate closed.
    const invalid = { ...MATERIALIZATION_D0C_PREREGISTRATION, nodeBudget: { ...MATERIALIZATION_D0C_PREREGISTRATION.nodeBudget, value: 0 } } as unknown as D0cRegistration
    expect(d0cRegistrationGate(invalid).registrationIssues[0]).toMatch(/^registered conditions: nodeBudget must be a positive integer/)
  })
})

describe('Phase D-0C calculation code audit', () => {
  it('lets only the D-0C formal infrastructure differ from the registration HEAD, and refuses another file, a foreign base or a git failure', () => {
    expect(MATERIALIZATION_D0C_REGISTRATION_HEAD).toMatch(/^[0-9a-f]{40}$/)
    expect(readCalculationCodeAudit(AUDIT_OK)).toMatchObject({ issues: [], outsideFormalInfrastructure: [], formalInfrastructure: AUDIT_OK.changedFiles })
    expect(readCalculationCodeAudit({ ...AUDIT_OK, changedFiles: [] }).issues).toEqual([])
    for (const file of ['src/benchmarks/globalAssignment/materialize.ts', 'src/benchmarks/globalAssignment/shapeRouteVerification.ts', 'src/domain/search/research/index.ts', 'src/domain/rng/production/productionRngEngine.ts', 'package.json', 'scripts/planner-global-assignment-d0b-child-process.mjs']) {
      const reading = readCalculationCodeAudit({ ...AUDIT_OK, changedFiles: [...AUDIT_OK.changedFiles, file] })
      expect(reading.outsideFormalInfrastructure, file).toEqual([file])
      expect(reading.issues, file).toEqual([expect.stringMatching(/outside the D-0C formal infrastructure/)])
    }
    expect(readCalculationCodeAudit({ ...AUDIT_OK, registrationHeadIsAncestor: false }).issues).toEqual([expect.stringMatching(/is not an ancestor of the measured HEAD/)])
    expect(readCalculationCodeAudit({ ...AUDIT_OK, error: 'git diff failed' }).issues).toEqual([expect.stringMatching(/could not run: git diff failed/)])
    expect(readCalculationCodeAudit({ ...AUDIT_OK, registrationHead: OTHER_HEAD }).issues[0]).toMatch(/not the registration HEAD/)
    // The infrastructure list holds the formal guard, provenance, RESULT derivation and their tests only: no Search, materialization or RNG module.
    for (const file of MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES) expect(file).toMatch(/run-planner-global-assignment-d0b|derive-planner-global-assignment-d0c-result|isolation\.test|materializationFormal|materializationProtocol/)
  })
})

describe('Phase D-0C start gate (parent)', () => {
  it('lets a formal run start only with every check satisfied', () => {
    expect(d0cFormalStartIssues(startInput())).toEqual([])
    expect(MATERIALIZATION_D0C_FORMAL_OPTIONS).toEqual(['--mode', '--export', '--expected-export-sha256', '--run-dir', '--output'])
  })

  it('refuses a disabled or incomplete registration, a dirty or uncommitted tree, --allow-uncommitted and any override', () => {
    expect(d0cFormalStartIssues(startInput({ registration: d0cRegistrationGate(disabledRegistration) }))[0]).toMatch(/^A formal run is not enabled/)
    expect(d0cFormalStartIssues(startInput({ registration: d0cRegistrationGate(incompleteRegistration) }))[0]).toMatch(/pre-registration is incomplete/)
    const tree = /^A formal run needs a clean, committed Working Tree \(no --allow-uncommitted\)\.$/
    expect(d0cFormalStartIssues(startInput({ repository: { ...startInput().repository, workingTreeClean: false } }))).toEqual([expect.stringMatching(tree)])
    expect(d0cFormalStartIssues(startInput({ repository: { ...startInput().repository, uncommittedBenchmarkCode: true } }))).toEqual([expect.stringMatching(tree)])
    expect(d0cFormalStartIssues(startInput({ allowUncommitted: true }))).toEqual([expect.stringMatching(tree)])
    expect(d0cFormalStartIssues(startInput({ overrideOptions: ['--rule', '--option-set', '--node-budget'] }))).toEqual(['A formal run takes its conditions from the registration only; remove --rule, --option-set, --node-budget.'])
  })

  it('refuses an Export that is not the registered one, a missing or foreign command-line hash and an unreadable registration document', () => {
    const otherHash = 'e'.repeat(64)
    expect(d0cFormalStartIssues(startInput({ actualExport: { ...REGISTERED, sha256: otherHash } }))).toEqual([`Export SHA-256 ${otherHash} is not the registered ${REGISTERED.sha256}.`])
    expect(d0cFormalStartIssues(startInput({ actualExport: { ...REGISTERED, bytes: REGISTERED.bytes - 1 } }))).toEqual([`Export length ${REGISTERED.bytes - 1} is not the registered ${REGISTERED.bytes} bytes.`])
    expect(d0cFormalStartIssues(startInput({ actualExport: { ...REGISTERED, fileName: 'renamed.json' } }))).toEqual([`Export file name renamed.json is not the registered ${REGISTERED.fileName}.`])
    expect(d0cFormalStartIssues(startInput({ cliExpectedSha256: null }))).toEqual(['A formal run requires --expected-export-sha256 naming the registered Export SHA-256.'])
    expect(d0cFormalStartIssues(startInput({ cliExpectedSha256: otherHash }))).toEqual([`--expected-export-sha256 ${otherHash} is not the registered Export SHA-256 ${REGISTERED.sha256}.`])
    expect(d0cFormalStartIssues(startInput({ cliExpectedSha256: REGISTERED.sha256.toUpperCase() }))).toEqual([])
    expect(d0cFormalStartIssues(startInput({ registeredExport: { identity: null, issues: ['git show failed'] } }))).toEqual([
      'The registered Export identity could not be read from the committed D-0B-2 document: git show failed',
    ])
  })

  it('refuses outputs outside the git-ignored paths, an unaudited calculation change and another CalculationContext', () => {
    const outputs = [{ option: '--run-dir', path: 'tmp/run', gitIgnored: false }, { option: '--output', path: '.local/d0c.json', gitIgnored: true }]
    expect(d0cFormalStartIssues(startInput({ outputPaths: outputs }))).toEqual(['--run-dir tmp/run is not git-ignored; a formal run writes only into ignored paths (for example under .local/).'])
    const changed = { ...AUDIT_OK, changedFiles: [...AUDIT_OK.changedFiles, 'src/benchmarks/globalAssignment/shapeMaterializationRun.ts'] }
    expect(d0cFormalStartIssues(startInput({ repository: { ...startInput().repository, calculationAudit: changed } }))[0]).toMatch(/shapeMaterializationRun\.ts\. Audit them/)
    const context = { ...registeredContext(), rngEngineVersion: 'production-rng:next' }
    expect(d0cFormalStartIssues(startInput({ currentAuthorities: { calculationContext: context } }))[0]).toMatch(/^The current CalculationContext .* is not the registered .*a version change asks for a new registration\.$/)
    // The current Production runtime (calculation schema 18) is such a version change: the registered D-0C runs cannot be repeated
    // formally without a new registration.
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(18)
    const runtime = { ...registeredContext(), appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    expect(d0cFormalStartIssues(startInput({ currentAuthorities: { calculationContext: runtime } }))[0]).toMatch(/a version change asks for a new registration\.$/)
  })
})

describe('Phase D-0C child gate (a hand-written formal task cannot bypass the parent)', () => {
  it('lets the parent\'s formal task run on the measured HEAD with the registered heap envelope', () => {
    expect(d0cFormalChildGateIssues(childInput())).toEqual([])
  })

  it('refuses a task naming another HEAD, a dirty or uncommitted tree, an unaudited calculation change and a missing heap envelope', () => {
    expect(d0cFormalChildGateIssues(childInput({ repositoryHeadSha: OTHER_HEAD }))).toEqual([`The child runs at HEAD ${HEAD}, not the task's measurement HEAD ${OTHER_HEAD}.`])
    expect(d0cFormalChildGateIssues(childInput({ repositoryHeadSha: undefined }))).toEqual(['The task names no measurement HEAD.'])
    expect(d0cFormalChildGateIssues(childInput({}, { repository: { ...childInput().repository, workingTreeClean: false } }))).toEqual(['The child observed a Working Tree that is not clean.'])
    expect(d0cFormalChildGateIssues(childInput({}, { repository: { ...childInput().repository, uncommittedBenchmarkCode: true } }))).toEqual(['The child observed uncommitted benchmark code.'])
    const changed = { ...AUDIT_OK, changedFiles: ['src/benchmarks/globalAssignment/reachTable.ts'] }
    expect(d0cFormalChildGateIssues(childInput({}, { repository: { ...childInput().repository, calculationAudit: changed } }))[0]).toMatch(/reachTable\.ts/)
    expect(d0cFormalChildGateIssues(childInput({}, { execArgv: [] }))).toEqual(['The child runs without the registered heap envelope --max-old-space-size=4096 (execArgv []).'])
    expect(d0cFormalChildGateIssues(childInput({}, { execArgv: ['--max-old-space-size=8192'] }))[0]).toMatch(/without the registered heap envelope/)
  })

  it('refuses edited conditions, envelope, protocol, registration HEAD or Export identity, and a disabled registration', () => {
    const { conditions, envelope } = registeredD0cConditions()
    expect(d0cFormalChildGateIssues(childInput({ conditions: { ...conditions, nodeBudget: 5 } }))).toEqual(['The task conditions are not the registered conditions.'])
    expect(d0cFormalChildGateIssues(childInput({ conditions: { ...conditions, shapeSearchBudget: { ...conditions.shapeSearchBudget, maxSettledWork: 1 } } }))).toEqual(['The task conditions are not the registered conditions.'])
    expect(d0cFormalChildGateIssues(childInput({ envelope: { ...envelope, childWallMs: 60_000 } }))).toEqual(['The task envelope is not the registered envelope.'])
    expect(d0cFormalChildGateIssues(childInput({ protocolVersion: 'global-assignment-d0b:1' }))).toEqual([`The task protocol global-assignment-d0b:1 is not the registered ${MATERIALIZATION_D0A2B_PROTOCOL_VERSION}.`])
    expect(d0cFormalChildGateIssues(childInput({ registrationHead: OTHER_HEAD }))[0]).toMatch(/^The task names the registration HEAD f{40}/)
    expect(d0cFormalChildGateIssues(childInput({ registeredExport: { ...REGISTERED, bytes: 1 } }))).toEqual(['The task does not carry the registered Export identity read from HEAD.'])
    expect(d0cFormalChildGateIssues(childInput({ actualExport: { ...REGISTERED, bytes: 1 } }))).toEqual(['The Export differs from the one the parent hashed.'])
    const other = { fileName: 'other.json', bytes: 2, sha256: 'd'.repeat(64) }
    expect(d0cFormalChildGateIssues(childInput({ actualExport: other }, { actualExport: other }))).toEqual([
      `Export SHA-256 ${other.sha256} is not the registered ${REGISTERED.sha256}.`, `Export length 2 is not the registered ${REGISTERED.bytes} bytes.`, `Export file name other.json is not the registered ${REGISTERED.fileName}.`,
    ])
    expect(d0cFormalChildGateIssues(childInput({}, { registeredExportFromHead: { identity: null, issues: ['missing block'] } }))).toEqual(['The child could not read the registered Export identity from HEAD: missing block'])
    expect(d0cFormalChildGateIssues(childInput({}, { registration: d0cRegistrationGate(disabledRegistration) }))[0]).toMatch(/^A formal run is not enabled/)
    // A smoke task never reaches the formal gate's checks.
    expect(d0cFormalChildGateIssues(childInput({ mode: 'smoke' }))).toEqual(['A formal child gate was asked for a smoke task.'])
  })

  it('refuses another CalculationContext or Engine before any calculation', () => {
    const registered = MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value
    expect(d0cFormalChildCalculationIssues({ calculationContext: registeredContext(), rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION })).toEqual([])
    expect(d0cFormalChildCalculationIssues({ calculationContext: { ...registered, masterDataVersion: 5 }, rngEngineVersion: registered.rngEngineVersion })[0]).toMatch(/^The input CalculationContext/)
    expect(d0cFormalChildCalculationIssues({ calculationContext: registered, rngEngineVersion: 'production-rng:other' })).toEqual([`The Production RNG Engine production-rng:other is not the registered ${registered.rngEngineVersion}.`])
  })
})

describe('Phase D-0C child record reading', () => {
  const expectation = { mode: 'formal' as const, protocolVersion: MATERIALIZATION_D0A2B_PROTOCOL_VERSION, actualExport: REGISTERED, repositoryHeadSha: HEAD }
  const record = (edit: Record<string, unknown> = {}) => ({
    mode: 'formal', protocolVersion: MATERIALIZATION_D0A2B_PROTOCOL_VERSION, exportVerification: { actual: { ...REGISTERED }, taskMatched: true },
    rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, calculationContext: registeredContext(), repositoryHeadSha: HEAD, formalChildGate: { issues: [] },
    semantic: { outcome: { kind: 'structural_candidates_materialized', classifications: [] }, input: {}, candidates: [], integrityIssues: [] }, observed: {}, memory: {},
    ...edit,
  })

  it('reads a complete, consistent formal record whose own gate passed', () => {
    expect(inspectMaterializationRecord(record(), expectation)).toEqual({ complete: true, consistent: true, childGatePassed: true, calculationContextMatched: true, issues: [] })
  })

  it('distinguishes an incomplete record, a disagreeing one, a failed child gate and another CalculationContext', () => {
    expect(inspectMaterializationRecord(record({ formalChildGate: undefined }), expectation)).toMatchObject({ complete: false, childGatePassed: null, issues: ['The record is incomplete: formalChildGate.'] })
    expect(inspectMaterializationRecord(record({ semantic: { outcome: {} } }), expectation).issues[0]).toMatch(/incomplete: semantic\.input, semantic\.candidates, semantic\.integrityIssues/)
    expect(inspectMaterializationRecord(null, expectation)).toMatchObject({ complete: false, consistent: false })
    expect(inspectMaterializationRecord(record({ repositoryHeadSha: OTHER_HEAD }), expectation)).toMatchObject({ complete: true, consistent: false })
    expect(inspectMaterializationRecord(record({ mode: 'smoke' }), expectation)).toMatchObject({ consistent: false })
    expect(inspectMaterializationRecord(record({ exportVerification: { actual: { ...REGISTERED, bytes: 3 } } }), expectation)).toMatchObject({ consistent: false })
    expect(inspectMaterializationRecord(record({ formalChildGate: { issues: ['refused'] } }), expectation)).toMatchObject({ childGatePassed: false })
    expect(inspectMaterializationRecord(record({ rngEngineVersion: 'production-rng:other' }), expectation)).toMatchObject({ calculationContextMatched: false })
    // A smoke record is read with the D-0B rule: no child gate, no CalculationContext judgement.
    const smoke = inspectMaterializationRecord(record({ mode: 'smoke', repositoryHeadSha: undefined, formalChildGate: undefined }), { ...expectation, mode: 'smoke' })
    expect(smoke).toEqual({ complete: true, consistent: true, childGatePassed: null, calculationContextMatched: null, issues: [] })
  })
})

describe('Phase D-0C formal validity', () => {
  it('is valid only when provenance, reproducibility and an empty aggregate all hold; a smoke run is not_applicable', () => {
    const valid = judgeD0cFormalValidity(validityInput())
    expect(valid.status).toBe('valid')
    expect(valid.issues).toEqual([])
    expect(valid.checks.provenance).toMatchObject({ registrationGate: true, completeRegistration: true, startGatePassed: true, measurementHeadRecorded: true, committedCleanTree: true, benchmarkCodeHashRecorded: true, noOverrides: true, conditionsMatchRegistration: true, exportRegisteredMatched: true, childGuardsPassed: true, calculationContextMatched: true, calculationCodeAudit: { passed: true } })
    expect(valid.checks.reproducibility).toEqual({ requiredRuns: 2, runs: 2, measuredRuns: 2, allMeasured: true, recordsComplete: true, recordsConsistent: true, noRunIntegrityIssues: true, semanticHashesEqual: true, identical: true })
    const smoke = judgeD0cFormalValidity(validityInput({ mode: 'smoke', integrityIssues: ['x'] }))
    expect(smoke).toEqual({ status: 'not_applicable', issues: [], checks: { provenance: null, reproducibility: null, aggregateIntegrityIssueCount: 1, noAggregateIntegrityIssues: null } })
  })

  it('is invalid with only one measured run, a timeout or out-of-memory run, or a single started run', () => {
    const timeout = judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1'), { ...measuredRun('materialize-2'), status: 'unmeasured', reason: 'timeout', semanticSha256: null, recordComplete: null, recordConsistent: null, childGatePassed: null, calculationContextMatched: null }], determinism: { identical: null } }))
    expect(timeout.status).toBe('invalid')
    expect(timeout.issues).toEqual(expect.arrayContaining(['Run materialize-2 is unmeasured (timeout).', 'Reproducibility is unconfirmed: fewer than two measured runs with a semantic hash.']))
    expect(timeout.checks.reproducibility).toMatchObject({ measuredRuns: 1, allMeasured: false, semanticHashesEqual: null })
    const oom = judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1'), { ...measuredRun('materialize-2'), status: 'unmeasured', reason: 'out_of_memory', semanticSha256: null }], determinism: { identical: null } }))
    expect(oom.issues).toContain('Run materialize-2 is unmeasured (out_of_memory).')
    const one = judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1')], determinism: { identical: null } }))
    expect(one.status).toBe('invalid')
    expect(one.issues).toContain('1 run(s) were started; the registration requires 2.')
  })

  it('is invalid when the semantic records differ, a record is incomplete or disagrees, a child gate or context fails, or an integrity issue exists', () => {
    const differ = judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1'), measuredRun('materialize-2', { semanticSha256: 'e'.repeat(64) })], determinism: { identical: false } }))
    expect(differ.issues).toEqual(expect.arrayContaining(['The semantic records of the repeated runs differ.', 'determinism.identical is false; a formal measurement requires true.']))
    expect(judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1'), measuredRun('materialize-2', { recordComplete: false })] })).issues).toContain('Run materialize-2 record is incomplete.')
    expect(judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1'), measuredRun('materialize-2', { recordConsistent: false })] })).issues).toContain('Run materialize-2 record disagrees with the parent (mode / protocol / Export / HEAD).')
    expect(judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1', { childGatePassed: null }), measuredRun('materialize-2')] })).issues).toContain('Run materialize-1 carries no passed formal child gate.')
    expect(judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1', { calculationContextMatched: false }), measuredRun('materialize-2')] })).issues).toContain('Run materialize-1 did not run with the registered CalculationContext and Engine.')
    const integrity = judgeD0cFormalValidity(validityInput({ integrityIssues: ['materialize-1: something'] }))
    expect(integrity.status).toBe('invalid')
    expect(integrity.checks.noAggregateIntegrityIssues).toBe(false)
  })

  it('is invalid for an all_materialized run whose provenance broke: dirty tree, override, other conditions, unregistered Export, failed start gate or unaudited code', () => {
    const p = validityInput().provenance
    const cases: [Partial<D0cFormalValidityInput['provenance']>, RegExp][] = [
      [{ workingTreeClean: false }, /not clean and committed/],
      [{ uncommittedBenchmarkCode: true }, /not clean and committed/],
      [{ overrideOptions: ['--window'] }, /overrides were given: --window/],
      [{ differencesFromRegistration: ['repeat: 1 (registered 2)'] }, /differ from the registration: repeat/],
      [{ exportVerification: { registeredMatched: true, cliMatched: null } }, /not verified against the registered identity/],
      [{ startIssues: null }, /start gate did not pass: not applied/],
      [{ measurementHeadSha: 'HEAD' }, /No measurement HEAD/],
      [{ benchmarkCodeSha256: '' }, /No benchmark code SHA-256/],
      [{ calculationAudit: { ...AUDIT_OK, changedFiles: ['src/benchmarks/globalAssignment/materialize.ts'] } }, /outside the D-0C formal infrastructure/],
    ]
    for (const [edit, issue] of cases) {
      const judged = judgeD0cFormalValidity(validityInput({ provenance: { ...p, ...edit } }))
      expect(judged.status, JSON.stringify(edit)).toBe('invalid')
      expect(judged.issues.join('\n'), JSON.stringify(edit)).toMatch(issue)
    }
    expect(judgeD0cFormalValidity(validityInput({ registration: { ...d0cRegistrationGate(disabledRegistration), requiredRuns: 2 } })).status).toBe('invalid')
  })
})

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
function shapeConditions(overrides: Partial<ShapeMaterializationResearchConditions> = {}): ShapeMaterializationResearchConditions {
  return {
    rule: 'd0a2-v2', window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 1,
    projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 }, shapeSearchScaleGate: OPEN_SHAPE_GATE, shapeSearchBudget: OPEN_SHAPE_BUDGET, routeVerification: 'every_shape_constrained_materialization',
    ...overrides,
  }
}
async function semanticOf(spec: MaterializationScenarioSpec, conditions: ShapeMaterializationResearchConditions, execution: Partial<MaterializationRunExecution> = {}) {
  const scene = await materializationScenario(spec)
  let tick = 0
  return (await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1), ...execution })).semantic
}

describe('Phase D-0C materialization outcome, judged apart from the formal validity', () => {
  it('reads all_materialized with the method of each Target, and two equal records as consistent', async () => {
    const one = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions())
    const two = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions())
    const outcome = summarizeD0cMaterializationOutcome({ measured: [one, two], unmeasuredProgress: null })
    expect(outcome).toMatchObject({ basis: 'measured_records', measuredRuns: 2, consistentAcrossMeasuredRuns: true, verdict: 'all_materialized', runOutcome: 'structural_candidates_materialized', planningTargetCount: 2 })
    const [candidate] = outcome.candidates
    expect(candidate).toMatchObject({ classification: 'all_materialized', attempted: 2, materialized: 2, notAttempted: 0, firstUnresolved: null, failClosedCode: null, independentStops: { searchScaleGate: 0, shapeSearchBudget: 0, unsupported: 0, failClosed: 0 } })
    expect(candidate!.materializedBy.shape_constrained + candidate!.materializedBy.candidate_search_projected).toBe(2)
    expect(JSON.stringify(outcome)).not.toMatch(/target\.fixture|owned\.g/)
  }, 60_000)

  it('keeps a budget stop measured twice a valid measurement of an unconfirmed outcome, never a success', async () => {
    const conditions = shapeConditions({ shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxSettledWork: 0 } })
    const one = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, conditions)
    const two = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, conditions)
    const outcome = summarizeD0cMaterializationOutcome({ measured: [one, two], unmeasuredProgress: null })
    expect(outcome.verdict).toBe('not_all_materialized')
    expect(outcome.candidates[0]).toMatchObject({ classification: 'unconfirmed_shape_search_budget', independentStops: { shapeSearchBudget: 1, searchScaleGate: 0, unsupported: 0, failClosed: 0 }, firstUnresolved: { kind: 'unconfirmed', reason: 'shape_search_budget_reached' } })
    expect(outcome.candidates[0]!.targetOutcomes.unconfirmed).toEqual({ shape_search_budget_reached: 1 })
    // The validity of the measurement does not read the outcome.
    expect(judgeD0cFormalValidity(validityInput()).status).toBe('valid')
  }, 60_000)

  it('counts a gate refusal on its own, and keeps a fail-closed stop as a run error that also invalidates the measurement', async () => {
    const gate = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions({ shapeSearchScaleGate: { ...OPEN_SHAPE_GATE, maxDepthUpperBound: 0 } }))
    const gated = summarizeD0cMaterializationOutcome({ measured: [gate], unmeasuredProgress: null })
    expect(gated).toMatchObject({ verdict: 'not_all_materialized', consistentAcrossMeasuredRuns: null })
    expect(gated.candidates[0]!.independentStops).toEqual({ searchScaleGate: 1, shapeSearchBudget: 0, unsupported: 0, failClosed: 0 })
    const failing = await semanticOf(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions(), {
      shapeSearch: { ...productionShapeMaterializationSearchPort, visitShapeConstrainedRouteCandidates: async () => { throw new ShapeConstrainedSearchError('shape_search_contract_violation', 'broken') } },
    })
    const failed = summarizeD0cMaterializationOutcome({ measured: [failing, failing], unmeasuredProgress: null })
    expect(failed.verdict).toBe('run_error')
    expect(failed.candidates[0]).toMatchObject({ classification: 'fail_closed', failClosedCode: 'shape_search_contract_violation', independentStops: { failClosed: 1 } })
    expect(JSON.stringify(failed)).not.toMatch(/target\.fixture/)
    // The semantic record flags the fail-closed stop as an integrity issue (design D0A2 10.2 run_error): the measurement is invalid, the outcome kept.
    expect(failing.integrityIssues).toHaveLength(1)
    const judged = judgeD0cFormalValidity(validityInput({ runs: [measuredRun('materialize-1', { integrityIssues: failing.integrityIssues }), measuredRun('materialize-2', { integrityIssues: failing.integrityIssues })], integrityIssues: failing.integrityIssues.map(issue => `materialize-1: ${issue}`) }))
    expect(judged.status).toBe('invalid')
    expect(judged.checks.reproducibility).toMatchObject({ noRunIntegrityIssues: false, semanticHashesEqual: true })
  }, 60_000)

  it('reports an unmeasured run from its journal only: settled Targets, the Target in progress without an outcome, the rest not attempted', () => {
    const brief = { kind: 'materialized' as const, reason: null, method: 'shape_constrained', delivered: null, deliveredBeforeMatch: 0 }
    const lines: ProgressJournalLine[] = [
      { kind: 'started', atMs: 0, pid: 1 },
      { kind: 'progress', atMs: 1, event: { kind: 'context', status: 'context', planningTargetCount: 3, reason: null } },
      { kind: 'progress', atMs: 2, event: { kind: 'candidate_started', candidateIndex: 0, ordinal: 0, objective: 9, targetCount: 3 } },
      { kind: 'progress', atMs: 3, event: { kind: 'target_started', candidateIndex: 0, orderIndex: 0, targetWeaponId: 'target.fixture.a' } },
      { kind: 'progress', atMs: 4, event: { kind: 'target_settled', candidateIndex: 0, orderIndex: 0, targetWeaponId: 'target.fixture.a', outcome: brief } },
      { kind: 'progress', atMs: 5, event: { kind: 'target_started', candidateIndex: 0, orderIndex: 1, targetWeaponId: 'target.fixture.b' } },
    ]
    const outcome = summarizeD0cMaterializationOutcome({ measured: [], unmeasuredProgress: parseProgressJournal(lines.map(line => JSON.stringify(line)).join('\n')) })
    expect(outcome).toMatchObject({ basis: 'journal_confirmed_progress', verdict: 'unmeasured', runOutcome: null, planningTargetCount: 3 })
    expect(outcome.candidates[0]).toMatchObject({ classification: null, attempted: 1, materialized: 1, notAttempted: 1, targetOutcomes: { inProgressWithoutOutcome: 1, settled: 1 } })
    expect(JSON.stringify(outcome)).not.toMatch(/target\.fixture/)
    expect(summarizeD0cMaterializationOutcome({ measured: [], unmeasuredProgress: null })).toMatchObject({ basis: 'none', verdict: 'unmeasured', candidates: [] })
  })
})
