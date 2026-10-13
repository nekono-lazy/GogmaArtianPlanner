import { beforeAll, describe, expect, it } from 'vitest'
import { MATERIALIZATION_D0C_REGISTRATION_HEAD, readCalculationCodeAudit } from './materializationFormal'
import {
  concludeD1cMeasurement, createD1cFormalTask, D1C_CONDITION_CHECK_KEYS, D1C_FORMAL_OPTIONS, D1C_FORMAL_PROTOCOL_VERSION, D1C_PROVENANCE_RULES, D1C_REPRODUCIBILITY_RULES,
  d1cFormalChildCalculationIssues, d1cFormalChildGateIssues, d1cFormalStartGate, d1cFreshEntrySetSourceIssues, d1cMaximumConcurrentChildren, d1cPlannerConditionsEvaluated,
  d1cRunConditionDifferences, deriveD1cCandidateOutcome, observeD1cRegisteredD0c, observeD1cRegisteredExport, observeD1cRegistration,
  PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD, readD1cAuthorities, readD1cCalculationCodeAudit, registeredD1cExpectation,
  type D1cFormalChildGateInput, type D1cFormalStartInput, type D1cMeasurementConclusion,
} from './verificationFormal'
import { D1C_FIXTURE_EXPORT, D1C_FIXTURE_HEAD, d1cFixture, type D1cFixture, type D1cFixtureParts, type FixtureRecord } from './verificationFormalTestFixture'
import {
  d1cFormalRunIssues, d1cRegistrationFingerprint, differencesFromD1cRegistration, PLANNER_VERIFICATION_D1C_PREREGISTRATION, readD1cRegisteredRegistrationFingerprint, registeredD1cConditions,
  type D1cRegistration,
} from './verificationRegistration'

/*
 * Issue #154 Global Assignment Phase D-1C (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md): the formal contract of the integration
 * acceptance. The start gate refuses every registered provenance failure before anything is written, a child refuses a hand-written task
 * from its own observations, the formal validity judges each of the 15 + 9 registered rules from the records (never listing them as
 * passed), the candidate outcome is judged apart from it, and the acceptance needs both. Records come from a synthetic scenario (a real
 * materialization and the real Phase D' in a first and a fresh "process", two complete runs).
 */
const d1bDocument = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md', { query: '?raw', import: 'default', eager: true }))[0] as string
const REGISTRATION = PLANNER_VERIFICATION_D1C_PREREGISTRATION
let fixture: D1cFixture
beforeAll(async () => { fixture = await d1cFixture() }, 120_000)

const conclude = (parts: D1cFixtureParts, registration: D1cRegistration = REGISTRATION) => concludeD1cMeasurement(fixture.observe(parts), fixture.expectation, registration)
const failedRules = (conclusion: D1cMeasurementConclusion) => [
  ...Object.entries(conclusion.formalValidity.checks.provenance), ...Object.entries(conclusion.formalValidity.checks.reproducibility),
].filter(([, check]) => !check.passed).map(([rule]) => rule).sort()
/** Re-hashes a record's verification semantic record as its child would (so the edit is a consistent record, not an integrity failure). */
const rehash = (record: FixtureRecord) => { record.verification.semanticSha256 = fixture.hash(JSON.stringify(record.verification.semantic)) }
const copy = (): D1cRegistration => structuredClone(REGISTRATION) as D1cRegistration
const documentsWith = (fingerprintAtHead: string, fingerprintAtRegistration = fingerprintAtHead) => {
  const block = (fingerprint: string) => [`registered-d1c-registration-fingerprint: ${fingerprint}`, `registered-d0c-materialization-semantic-sha256: ${fixture.registeredD0c.semanticSha256}`, `registered-d0c-entry-fingerprint: ${fixture.registeredD0c.entryFingerprint}`].join('\n')
  return { atMeasuredHead: { source: 'HEAD:d1b', text: block(fingerprintAtHead), error: null }, atRegistrationHead: { source: 'reg:d1b', text: block(fingerprintAtRegistration), error: null } }
}

describe('Phase D-1C: the registration the formal run reads', () => {
  it('enables the formal run and changes nothing else: the fingerprint is still the committed D-1B block', () => {
    expect(REGISTRATION.formalRun).toEqual({ enabled: true, startsIn: 'D-1C', enabledBy: 'Phase D-1C' })
    expect(d1cFormalRunIssues()).toEqual([])
    const registered = readD1cRegisteredRegistrationFingerprint(d1bDocument)
    expect(registered.fingerprint).toBe('fnv1a32:2393847e')
    expect(d1cRegistrationFingerprint()).toBe(registered.fingerprint)
    expect(PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD).toMatch(/^[0-9a-f]{40}$/)
    expect(PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD).not.toBe(MATERIALIZATION_D0C_REGISTRATION_HEAD)
  })

  it('implements exactly the registered formal validity rules and the registered conditions', () => {
    expect([...D1C_PROVENANCE_RULES]).toEqual([...REGISTRATION.formalValidity.value.provenance])
    expect([...D1C_REPRODUCIBILITY_RULES]).toEqual([...REGISTRATION.formalValidity.value.reproducibility])
    expect(D1C_PROVENANCE_RULES).toHaveLength(15)
    expect(D1C_REPRODUCIBILITY_RULES).toHaveLength(9)
    expect(Object.keys(fixture.parts().runs[0]!.first.record!.verification.semantic.checks).sort()).toEqual([...D1C_CONDITION_CHECK_KEYS].sort())
    const expectation = registeredD1cExpectation()
    expect(expectation.conditions).toEqual(registeredD1cConditions())
    expect(expectation.calculationContext).toEqual(REGISTRATION.calculationContext.value)
    expect(expectation.registrationHead).toBe(PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD)
    expect([...D1C_FORMAL_OPTIONS]).toEqual(['--mode', '--export', '--run-dir', '--output'])
    // The run-condition comparison is the D-1B one with the verification budget and the per-process values added.
    const registered = expectation.conditions
    const observed = {
      materialization: registered.materialization, researchMaxPlanSteps: { first: 20_000, fresh: 20_000 }, firstChildWallMs: 1_800_000, freshChildWallMs: 1_800_000,
      childHeapMb: { first: 8_192, fresh: 8_192 }, heapFlagApplied: true, concurrency: 1, childProcessRetry: 'none' as const, verificationBudget: 1, verifiedCandidates: 1,
    }
    expect(d1cRunConditionDifferences(observed, expectation)).toEqual([])
    expect(differencesFromD1cRegistration({ materialization: registered.materialization, researchMaxPlanSteps: 20_000, firstChildWallMs: 1_800_000, freshChildWallMs: 1_800_000, childHeapMb: 8_192, concurrency: 1, childProcessRetry: 'none' })).toEqual([])
    expect(d1cRunConditionDifferences({ ...observed, researchMaxPlanSteps: { first: 20_000, fresh: 1_000 }, childHeapMb: { first: 4_096, fresh: 8_192 }, concurrency: 2, childProcessRetry: 'retried', verificationBudget: 2, heapFlagApplied: false }, expectation)).toEqual([
      'researchMaxPlanSteps (fresh): 1000 (registered 20000)', 'childHeapMb (first): 4096 (registered 8192)', 'childHeapMb: --max-old-space-size=8192 was not applied to every child',
      'concurrency: 2 (registered 1)', 'childProcessRetry: retried (registered none)', 'verificationBudget: 2 (registered 1)',
    ])
    expect(d1cRunConditionDifferences({ ...observed, verifiedCandidates: 2 }, expectation)).toEqual(['verifiedCandidates: 2 (at most the registered verification budget 1)'])
    expect(d1cRunConditionDifferences({ ...observed, verifiedCandidates: 0 }, expectation)).toEqual([])
  })
})

describe('Phase D-1C: the calculation code audit and the authorities', () => {
  it('allows the D-1C formal infrastructure only, separates Production changes, and never reads an unanswered audit as no change', () => {
    const audit = (changedFiles: string[], extra: Partial<{ registrationHeadIsAncestor: boolean; error: string | null; registrationHead: string }> = {}) =>
      readD1cCalculationCodeAudit({ registrationHead: PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD, registrationHeadIsAncestor: true, changedFiles, error: null, ...extra })
    expect(audit([])).toMatchObject({ passed: true, productionUnchanged: true, issues: [] })
    expect(audit(['scripts/run-planner-global-assignment-d1c.mjs', 'src/benchmarks/globalAssignment/verificationRegistration.ts'])).toMatchObject({ passed: true, productionUnchanged: true, allowedChanged: ['scripts/run-planner-global-assignment-d1c.mjs', 'src/benchmarks/globalAssignment/verificationRegistration.ts'] })
    const research = audit(['src/benchmarks/globalAssignment/verify.ts'])
    expect(research).toMatchObject({ passed: false, productionUnchanged: true, outsideAllowed: ['src/benchmarks/globalAssignment/verify.ts'], productionChanged: [] })
    expect(research.issues.join(' ')).toContain('outside the D-1C formal infrastructure: src/benchmarks/globalAssignment/verify.ts')
    for (const file of ['src/domain/planner/productionPlanGeneration.ts', 'src/domain/rng/production/productionRngEngine.ts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.app.json']) {
      const production = audit([file])
      expect(production, file).toMatchObject({ passed: false, productionUnchanged: false, productionChanged: [file] })
      expect(production.issues.join(' '), file).toContain(`Production calculation files changed since the registration HEAD: ${file}.`)
    }
    // A shallow checkout (no registration HEAD), a git failure and another registration HEAD all fail closed, never "no change".
    expect(audit([], { registrationHeadIsAncestor: false, error: 'git diff failed: bad revision' })).toMatchObject({ passed: false, productionUnchanged: false })
    expect(audit([], { registrationHeadIsAncestor: false })).toMatchObject({ passed: false, productionUnchanged: false })
    expect(audit([], { registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD })).toMatchObject({ passed: false, productionUnchanged: false })
    // The D-0C formal guard keeps refusing the D-1C changes (its infrastructure list is untouched).
    expect(readCalculationCodeAudit({ registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, registrationHeadIsAncestor: true, changedFiles: ['src/benchmarks/globalAssignment/verificationFormal.ts'], error: null }).outsideFormalInfrastructure).toEqual(['src/benchmarks/globalAssignment/verificationFormal.ts'])
  })

  it('reads the CalculationContext, the Engine and the Master data version against the registration', () => {
    const expected = registeredD1cExpectation().calculationContext
    expect(readD1cAuthorities({ calculationContext: { ...expected }, rngEngineVersion: expected.rngEngineVersion })).toEqual({ calculationContextMatched: true, rngEngineVersionMatched: true, masterDataVersionMatched: true, issues: [] })
    expect(readD1cAuthorities({ calculationContext: { ...expected, masterDataVersion: 5 }, rngEngineVersion: expected.rngEngineVersion })).toMatchObject({ calculationContextMatched: false, rngEngineVersionMatched: true, masterDataVersionMatched: false })
    expect(readD1cAuthorities({ calculationContext: { ...expected, rngEngineVersion: 'production-rng:c5-e8' }, rngEngineVersion: 'production-rng:c5-e8' })).toMatchObject({ calculationContextMatched: false, rngEngineVersionMatched: false, masterDataVersionMatched: true })
    expect(readD1cAuthorities({ calculationContext: { ...expected }, rngEngineVersion: 'fake-engine' }).issues).toEqual(['The Production RNG Engine fake-engine is not the registered production-rng:c5-e7.'])
  })
})

describe('Phase D-1C: the formal start gate', () => {
  const startInput = (): D1cFormalStartInput => {
    const start = fixture.parts().start
    return {
      registration: start.registration, flags: [...start.flags], mode: 'formal',
      checkout: { headSha: start.measurementHeadSha, workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit: start.calculationAudit },
      registeredExport: start.registeredExport, actualExport: { ...start.actualExport }, registeredD0c: start.registeredD0c,
      outputPaths: [{ option: '--run-dir', path: '.local/x.run', gitIgnored: true, exists: false }, { option: '--output', path: '.local/x.json', gitIgnored: true, exists: false }],
      currentAuthorities: structuredClone(start.currentAuthorities), plannedConditions: structuredClone(fixture.expectation.conditions), inputsRead: [...start.inputsRead],
    }
  }
  const gate = (edit: (input: D1cFormalStartInput) => void) => { const input = startInput(); edit(input); return d1cFormalStartGate(input, fixture.expectation) }
  const failed = (result: ReturnType<typeof gate>) => Object.entries(result.rules).filter(([, passed]) => !passed).map(([rule]) => rule).sort()

  it('passes an intact start and judges 14 of the 15 provenance rules (the child gates come later)', () => {
    const result = gate(() => {})
    expect(result).toMatchObject({ passed: true, issues: [], prerequisites: { registeredD0cReadable: true, outputsNewAndIgnored: true, exportPathRead: true } })
    expect(Object.keys(result.rules).sort()).toEqual(D1C_PROVENANCE_RULES.filter(rule => rule !== 'child_gates_passed').sort())
  })

  it('refuses a disabled, incomplete or edited registration, and a fingerprint block that moved after the registration HEAD', () => {
    const disabled = copy()
    disabled.formalRun = { enabled: false, startsIn: 'D-1C', enabledBy: null }
    const documents = documentsWith(d1cRegistrationFingerprint())
    const off = gate(input => { input.registration = observeD1cRegistration(documents, disabled) })
    expect(off.passed).toBe(false)
    expect(failed(off)).toEqual(['formal_run_enabled'])
    expect(off.issues.join(' ')).toMatch(/A D-1C formal run is not enabled/)
    const incomplete = copy()
    delete (incomplete as Partial<D1cRegistration>).verificationBudget
    const missing = gate(input => { input.registration = observeD1cRegistration(documents, incomplete) })
    expect(failed(missing)).toEqual(['formal_run_enabled', 'registration_complete', 'registration_fingerprint_equals_registered_block'])
    expect(missing.issues.join(' ')).toContain('verificationBudget is not registered.')
    const edited = copy()
    edited.researchMaxPlanSteps.value = 20_001
    const moved = gate(input => { input.registration = observeD1cRegistration(documents, edited) })
    expect(failed(moved)).toEqual(['registration_fingerprint_equals_registered_block'])
    expect(moved.issues.join(' ')).toMatch(/The registration fingerprint fnv1a32:[0-9a-f]{8} is not the registered fnv1a32:2393847e: a registered item changed since D-1B\./)
    const rewritten = gate(input => { input.registration = observeD1cRegistration(documentsWith(d1cRegistrationFingerprint(), 'fnv1a32:00000000')) })
    expect(failed(rewritten)).toEqual(['registration_fingerprint_equals_registered_block'])
    expect(rewritten.issues.join(' ')).toContain('is not the one at the registration HEAD (fnv1a32:00000000)')
    const unreadable = gate(input => { input.registration = observeD1cRegistration({ ...documents, atRegistrationHead: { source: 'reg:d1b', text: null, error: 'fatal: invalid object name' } }) })
    expect(failed(unreadable)).toEqual(['registration_fingerprint_equals_registered_block'])
    expect(unreadable.issues.join(' ')).toContain('could not be read from reg:d1b: fatal: invalid object name')
  })

  it('refuses every command-line override, a non-formal mode, a dirty or uncommitted checkout and an audit that fails or cannot answer', () => {
    for (const flag of ['--allow-uncommitted', '--first-wall-ms', '--fresh-wall-ms', '--heap-mb', '--expected-d0c-semantic-sha256', '--expected-d0c-entry-fingerprint', '--max-plan-steps', '--repeat', '--expected-export-sha256', '--task']) {
      const result = gate(input => { input.flags = [...input.flags, flag] })
      expect(failed(result), flag).toEqual(['no_command_line_override'])
      expect(result.issues.join(' '), flag).toContain(`remove ${flag}.`)
    }
    expect(gate(input => { input.mode = 'smoke' }).issues.join(' ')).toContain('remove --mode smoke.')
    expect(failed(gate(input => { input.checkout.workingTreeClean = false }))).toEqual(['clean_committed_head'])
    expect(failed(gate(input => { input.checkout.uncommittedBenchmarkCode = true }))).toEqual(['clean_committed_head'])
    expect(failed(gate(input => { input.checkout.headSha = 'HEAD' }))).toEqual(['clean_committed_head'])
    expect(failed(gate(input => { input.checkout.calculationAudit = { ...input.checkout.calculationAudit, registrationHeadIsAncestor: false } }))).toEqual(['calculation_code_audit_passed', 'production_calculation_unchanged', 'registration_head_is_ancestor'])
    const shallow = gate(input => { input.checkout.calculationAudit = { ...input.checkout.calculationAudit, registrationHeadIsAncestor: false, changedFiles: [], error: 'git diff failed: fatal: bad revision' } })
    expect(failed(shallow)).toEqual(['calculation_code_audit_passed', 'production_calculation_unchanged', 'registration_head_is_ancestor'])
    expect(shallow.issues.join(' ')).toContain('The calculation code audit could not run: git diff failed: fatal: bad revision')
    expect(failed(gate(input => { input.checkout.calculationAudit = { ...input.checkout.calculationAudit, changedFiles: ['src/benchmarks/globalAssignment/verificationProtocol.ts'] } }))).toEqual(['calculation_code_audit_passed'])
    expect(failed(gate(input => { input.checkout.calculationAudit = { ...input.checkout.calculationAudit, changedFiles: ['src/domain/planner/plannerTraceReplay.ts'] } }))).toEqual(['calculation_code_audit_passed', 'production_calculation_unchanged'])
  })

  it('refuses another Export, CalculationContext, Engine or Master, an oracle input, an unreadable D-0C identity and outputs that exist or are not ignored', () => {
    expect(failed(gate(input => { input.actualExport.sha256 = 'f'.repeat(64) }))).toEqual(['export_identity_matched'])
    expect(failed(gate(input => { input.actualExport.fileName = 'other.json' }))).toEqual(['export_identity_matched'])
    expect(failed(gate(input => { input.registeredExport = observeD1cRegisteredExport({ source: 'HEAD:d0b2', text: null, error: 'unreadable' }) }))).toEqual(['export_identity_matched'])
    const context = fixture.expectation.calculationContext
    expect(failed(gate(input => { input.currentAuthorities = { calculationContext: { ...context, masterDataVersion: context.masterDataVersion + 1 }, rngEngineVersion: context.rngEngineVersion } }))).toEqual(['calculation_context_matched', 'master_data_version_matched'])
    expect(failed(gate(input => { input.currentAuthorities = { calculationContext: { ...context, rngEngineVersion: 'other-engine' }, rngEngineVersion: 'other-engine' } }))).toEqual(['calculation_context_matched', 'rng_engine_version_matched'])
    expect(failed(gate(input => { input.currentAuthorities = { calculationContext: { ...context, appSchemaVersion: 18 }, rngEngineVersion: context.rngEngineVersion } }))).toEqual(['calculation_context_matched'])
    expect(failed(gate(input => { input.inputsRead = [...input.inputsRead, 'git:HEAD:docs/PLANNER_GLOBAL_ORACLE_1657.json'] }))).toEqual(['oracle_not_read'])
    expect(failed(gate(input => { input.plannedConditions = { ...fixture.expectation.conditions, verification: { researchMaxPlanSteps: 1, verificationBudget: 1 } } }))).toEqual(['run_conditions_equal_registration'])
    const d0c = gate(input => { input.registeredD0c = observeD1cRegisteredD0c({ atMeasuredHead: { source: 'HEAD:d1b', text: 'nothing here', error: null }, atRegistrationHead: documentsWith('x').atRegistrationHead }) })
    expect(d0c).toMatchObject({ passed: false, prerequisites: { registeredD0cReadable: false } })
    expect(d0c.issues.join(' ')).toContain('registered-d0c-materialization-semantic-sha256: expected exactly one line, found 0.')
    const outputs = gate(input => { input.outputPaths = [{ option: '--run-dir', path: 'run', gitIgnored: false, exists: false }, { option: '--output', path: '.local/x.json', gitIgnored: true, exists: true }] })
    expect(outputs).toMatchObject({ passed: false, prerequisites: { outputsNewAndIgnored: false } })
    expect(outputs.issues).toEqual(expect.arrayContaining(['--run-dir run is not git-ignored; a formal run writes Entry bodies and raw records only into ignored paths (for example under .local/).', '--output .local/x.json already exists; a formal run writes new paths only.']))
  })
})

describe('Phase D-1C: the formal child gate', () => {
  const HEAP = '--max-old-space-size=8192'
  const childInput = (role: 'first' | 'fresh', runIndex = 1): D1cFormalChildGateInput => {
    const start = fixture.parts().start
    const runDir = `/m/run.formal/run-${runIndex}`
    return {
      role, paths: { runDir, taskDir: runDir, recordDir: runDir, journalDir: runDir },
      task: createD1cFormalTask({
        role, runIndex, measurementHeadSha: D1C_FIXTURE_HEAD, registrationFingerprint: start.registration.fingerprint.computed, actualExport: D1C_FIXTURE_EXPORT,
        registeredExport: start.registeredExport.identity!, expectedD0c: start.registeredD0c.identity!, runDir,
        entrySet: role === 'fresh' ? { file: 'first.entry-set.json', firstRecordFile: 'first.record.json', sha256: 'f'.repeat(64), entryFingerprint: fixture.registeredD0c.entryFingerprint } : null,
      }, fixture.expectation),
      checkout: { headSha: D1C_FIXTURE_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit: start.calculationAudit },
      registration: start.registration, registeredExport: start.registeredExport, registeredD0c: start.registeredD0c, actualExport: { ...D1C_FIXTURE_EXPORT }, execArgv: [HEAP], inputsRead: [...start.inputsRead],
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issues = (role: 'first' | 'fresh', edit: (input: D1cFormalChildGateInput & { task: any }) => void) => {
    const input = childInput(role) as D1cFormalChildGateInput & { task: FixtureRecord }
    edit(input)
    return d1cFormalChildGateIssues(input, fixture.expectation)
  }

  it('accepts the task the parent builds, for both roles, and refuses a non-formal task outright', () => {
    expect(issues('first', () => {})).toEqual([])
    expect(issues('fresh', () => {})).toEqual([])
    expect(issues('first', input => { input.task.mode = 'smoke' })).toEqual(['A D-1C child runs formal tasks only (got mode smoke).'])
    expect(issues('first', input => { input.task = null })).toEqual(['A D-1C child runs formal tasks only (got mode undefined).'])
  })

  it('refuses a hand-written task: HEAD, role, protocols, materialization and Planner conditions, envelope, Export, D-0C identity, CalculationContext, fingerprint', () => {
    const cases: [string, 'first' | 'fresh', (input: D1cFormalChildGateInput & { task: FixtureRecord }) => void, string | RegExp][] = [
      ['HEAD', 'first', input => { input.task.repositoryHeadSha = 'f'.repeat(40) }, `The child runs at HEAD ${D1C_FIXTURE_HEAD}, not the task's measurement HEAD ${'f'.repeat(40)}.`],
      ['role', 'first', input => { input.task.role = 'fresh' }, 'The task is for the fresh process, not first.'],
      ['formal protocol', 'first', input => { input.task.formalProtocolVersion = 'global-assignment-d1c-formal:0' }, `The task formal protocol global-assignment-d1c-formal:0 is not ${D1C_FORMAL_PROTOCOL_VERSION}.`],
      ['verification protocol', 'fresh', input => { input.task.verificationProtocolVersion = 'global-assignment-d1a:1' }, 'The task verification protocol global-assignment-d1a:1 is not the registered global-assignment-d1b:1.'],
      ['materialization protocol', 'first', input => { input.task.materializationProtocolVersion = 'global-assignment-d0b:1' }, /The task materialization protocol global-assignment-d0b:1 is not the registered/],
      ['materialization conditions', 'first', input => { input.task.conditions.materialization.nodeBudget = 5 }, 'The task conditions are not the registered conditions.'],
      ['Planner conditions', 'fresh', input => { input.task.conditions.verification.researchMaxPlanSteps = 1_000_000 }, 'The task conditions are not the registered conditions.'],
      ['envelope', 'first', input => { input.task.conditions.envelope.firstChildWallMs = 60_000 }, 'The task conditions are not the registered conditions.'],
      ['repeat', 'first', input => { input.task.repeat = 1 }, 'The task repeat 1 is not the registered 2.'],
      ['run index', 'first', input => { input.task.runIndex = 3 }, 'The task run index 3 is not one of 1..2.'],
      ['registered Export', 'first', input => { input.task.registeredExport = { ...input.task.registeredExport, bytes: 11 } }, 'The task does not carry the registered Export identity read from HEAD.'],
      ['actual Export', 'fresh', input => { input.actualExport = { ...input.actualExport, sha256: '0'.repeat(64) } }, /Export SHA-256 0{64} is not the registered e{64}\./],
      ['task Export', 'first', input => { input.task.actualExport = { ...input.task.actualExport, bytes: 1 } }, 'The Export differs from the one the parent hashed.'],
      ['D-0C identity', 'first', input => { input.task.expectedD0c = { ...input.task.expectedD0c, semanticSha256: '0'.repeat(64) } }, 'The task D-0C identity is not the registered one read from HEAD.'],
      ['CalculationContext', 'fresh', input => { input.task.calculationContext = { ...input.task.calculationContext, masterDataVersion: 99 } }, 'The task CalculationContext is not the registered CalculationContext.'],
      ['registration fingerprint', 'first', input => { input.task.registrationFingerprint = 'fnv1a32:00000000' }, /The task names the registration fingerprint fnv1a32:00000000, not the child's fnv1a32:2393847e\./],
      ['registration HEAD', 'first', input => { input.task.registrationHead = MATERIALIZATION_D0C_REGISTRATION_HEAD }, `The task names the registration HEAD ${MATERIALIZATION_D0C_REGISTRATION_HEAD}, not ${PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD}.`],
      ['heap envelope', 'fresh', input => { input.execArgv = [] }, 'The child runs without the registered heap envelope --max-old-space-size=8192 (execArgv []).'],
      ['run directory', 'first', input => { input.paths = { ...input.paths, runDir: '/m/run.formal/run-2' } }, 'The task run directory /m/run.formal/run-2 is not run-1.'],
      ['record outside the run', 'fresh', input => { input.paths = { ...input.paths, recordDir: '/m/run.formal/run-2' } }, 'The record file is not in the task\'s run directory.'],
      ['first with an Entry set', 'first', input => { input.task.entrySet = { file: 'x', firstRecordFile: 'y', sha256: 'f'.repeat(64), entryFingerprint: 'fnv1a32:00000000' } }, 'A first task names an Entry set.'],
      ['fresh without an Entry set', 'fresh', input => { input.task.entrySet = null }, 'A fresh task names no Entry set.'],
      ['fresh Entry fingerprint', 'fresh', input => { input.task.entrySet.entryFingerprint = 'fnv1a32:00000000' }, /The task Entry fingerprint fnv1a32:00000000 is not the registered fnv1a32:[0-9a-f]{8}\./],
      ['Entry set outside the run', 'fresh', input => { input.task.entrySet.file = '../run-1/first.entry-set.json' }, 'The task Entry set must name files inside the run directory.'],
      ['dirty checkout', 'first', input => { input.checkout = { ...input.checkout, workingTreeClean: false } }, 'The child observed a Working Tree that is not clean.'],
      ['uncommitted code', 'fresh', input => { input.checkout = { ...input.checkout, uncommittedBenchmarkCode: true } }, 'The child observed uncommitted benchmark code.'],
      ['calculation audit', 'first', input => { input.checkout = { ...input.checkout, calculationAudit: { ...input.checkout.calculationAudit, changedFiles: ['src/benchmarks/globalAssignment/verify.ts'] } } }, /outside the D-1C formal infrastructure: src\/benchmarks\/globalAssignment\/verify\.ts/],
      ['shallow history', 'fresh', input => { input.checkout = { ...input.checkout, calculationAudit: { ...input.checkout.calculationAudit, registrationHeadIsAncestor: false, error: 'git diff failed' } } }, 'The calculation code audit could not run: git diff failed'],
      ['oracle input', 'first', input => { input.inputsRead = [...input.inputsRead, 'git:HEAD:docs/PLANNER_GLOBAL_ORACLE_RESULT.json'] }, /oracle \/ lower-bound \/ RESULT input/],
    ]
    for (const [name, role, edit, reason] of cases) {
      const result = issues(role, edit)
      expect(result.length, name).toBeGreaterThan(0)
      if (typeof reason === 'string') expect(result, name).toContain(reason)
      else expect(result.join('\n'), name).toMatch(reason)
    }
    // The child's own registration: disabled or edited is refused whatever the task says.
    const disabled = copy()
    disabled.formalRun = { enabled: false, startsIn: 'D-1C', enabledBy: null }
    expect(issues('first', input => { input.registration = observeD1cRegistration(documentsWith(d1cRegistrationFingerprint()), disabled) }).join(' ')).toMatch(/A D-1C formal run is not enabled/)
  })

  it('refuses a CalculationContext, Engine or Master other than the registered ones once the input is loaded', () => {
    const context = fixture.expectation.calculationContext
    expect(d1cFormalChildCalculationIssues({ calculationContext: { ...context }, rngEngineVersion: context.rngEngineVersion }, fixture.expectation)).toEqual([])
    expect(d1cFormalChildCalculationIssues({ calculationContext: { ...context }, rngEngineVersion: 'fake' }, fixture.expectation)).toEqual([`The Production RNG Engine fake is not the registered ${context.rngEngineVersion}.`])
    expect(d1cFormalChildCalculationIssues({ calculationContext: { ...context, masterDataVersion: 3 }, rngEngineVersion: context.rngEngineVersion }, fixture.expectation).join(' ')).toContain('The Master data version 3 is not the registered')
  })

  it('lets the fresh process read only the Entry set its own run\'s first process wrote', () => {
    const parts = fixture.parts()
    const firstRecord = parts.runs[0]!.first.record!
    const sha = firstRecord.entrySet.sha256 as string
    const task = (runIndex: number) => ({ ...(childInput('fresh', runIndex).task as ReturnType<typeof createD1cFormalTask>), entrySet: { file: 'first.entry-set.json', firstRecordFile: 'first.record.json', sha256: sha, entryFingerprint: fixture.registeredD0c.entryFingerprint } })
    expect(d1cFreshEntrySetSourceIssues({ task: task(1), entrySetSha256: sha, firstRecord, firstRecordReadError: null })).toEqual([])
    // Run 2's fresh process handed run 1's first record and Entry set: refused (never another run's Entries).
    expect(d1cFreshEntrySetSourceIssues({ task: task(2), entrySetSha256: sha, firstRecord, firstRecordReadError: null })).toEqual(['The first record belongs to run 1, not run 2.'])
    expect(d1cFreshEntrySetSourceIssues({ task: task(1), entrySetSha256: '0'.repeat(64), firstRecord, firstRecordReadError: null })).toEqual([`The Entry set file hashes to ${'0'.repeat(64)}, not the task's ${sha}.`, 'The first record of this run did not write this Entry set.'])
    expect(d1cFreshEntrySetSourceIssues({ task: task(1), entrySetSha256: sha, firstRecord: null, firstRecordReadError: 'ENOENT' })).toEqual(['The first record of this run could not be read: ENOENT'])
    expect(d1cFreshEntrySetSourceIssues({ task: task(1), entrySetSha256: sha, firstRecord: { ...firstRecord, repositoryHeadSha: 'b'.repeat(40) }, firstRecordReadError: null })).toEqual(['The first record was written at another HEAD.'])
  })
})

describe('Phase D-1C: formal validity, candidate outcome and acceptance', () => {
  it('judges an intact two-run measurement valid with every rule passed, the candidate verified and the acceptance granted', () => {
    const conclusion = conclude(fixture.parts())
    expect(conclusion.formalValidity).toMatchObject({ status: 'valid', issues: [] })
    expect(Object.keys(conclusion.formalValidity.checks.provenance)).toEqual([...D1C_PROVENANCE_RULES])
    expect(Object.keys(conclusion.formalValidity.checks.reproducibility)).toEqual([...D1C_REPRODUCIBILITY_RULES])
    expect(failedRules(conclusion)).toEqual([])
    expect(conclusion.candidateOutcome).toMatchObject({ kind: 'verified', consistentAcrossRuns: true, runVerdictKinds: ['verified', 'verified'], requiredRuns: 2, concludedRuns: 2 })
    expect(conclusion.acceptance).toEqual({ status: 'accepted', formalValidity: 'valid', candidateOutcome: 'verified', reasons: [] })
    expect(conclusion.runs.map(run => run.integrityIssues)).toEqual([[], []])
    expect(conclusion.resultIntegrityIssues).toEqual([])
    expect(conclusion.exitCode).toBe(0)
    // Post hoc: the incumbent comparison and best_found only for an accepted measurement; never proven_minimum.
    expect(conclusion.postHoc.operationCount).toMatchObject({ evaluated: true, physicalOperations: 5, incumbent: 8_534, judgement: 'improvement', proof: 'not_claimed' })
    expect(conclusion.postHoc.minimality).toMatchObject({ status: 'best_found', provenMinimum: false, verificationBudget: 1 })
  })

  it('is invalid with one complete run only, and the candidate is unmeasured rather than rejected', () => {
    const parts = fixture.parts()
    parts.runs.pop()
    const conclusion = conclude(parts)
    expect(conclusion.formalValidity.status).toBe('invalid')
    expect(failedRules(conclusion)).toEqual(['entry_fingerprint_equals_registered_d0c', 'first_and_fresh_separate_processes', 'first_fresh_verification_semantic_equal', 'materialization_semantic_equals_registered_d0c',
      'planner_conditions_evaluated_in_both_processes', 'runs_verification_semantic_equal', 'two_complete_runs'])
    expect(conclusion.candidateOutcome).toMatchObject({ kind: 'unmeasured', verdict: null, concludedRuns: 1 })
    expect(conclusion.acceptance.status).toBe('not_accepted')
    expect(conclusion.postHoc.operationCount.judgement).toBe('not_evaluated')
    expect(conclusion.postHoc.minimality.status).toBe('not_evaluated')
  })

  it('is invalid when first and fresh disagree, and the candidate is the cross-process rejection of both runs', () => {
    const parts = fixture.parts()
    for (const run of parts.runs) { run.fresh!.record!.verification.semantic.planner.planHash = 'fnv1a32:00000000'; rehash(run.fresh!.record!) }
    const conclusion = conclude(parts)
    expect(failedRules(conclusion)).toEqual(['first_fresh_verification_semantic_equal', 'runs_verification_semantic_equal'])
    expect(conclusion.candidateOutcome).toMatchObject({ kind: 'planner_rejected', verdict: { kind: 'planner_rejected', run: 'cross_process', reasons: [{ code: 'fresh_planner_mismatch', differingFields: ['planner'] }] } })
    expect(conclusion.acceptance).toMatchObject({ status: 'not_accepted', formalValidity: 'invalid' })
  })

  it('is invalid when run 1 and run 2 differ, and never accepts the candidate both runs verified', () => {
    const parts = fixture.parts()
    for (const side of [parts.runs[1]!.first, parts.runs[1]!.fresh!]) { side.record!.verification.semantic.planner.stepSemanticsHash = 'fnv1a32:11111111'; rehash(side.record!) }
    const conclusion = conclude(parts)
    expect(failedRules(conclusion)).toEqual(['runs_verification_semantic_equal'])
    expect(conclusion.candidateOutcome.kind).toBe('verified')
    expect(conclusion.acceptance).toEqual({ status: 'not_accepted', formalValidity: 'invalid', candidateOutcome: 'verified', reasons: ['the formal measurement is invalid'] })
    expect(conclusion.postHoc.operationCount).toMatchObject({ evaluated: false, judgement: 'not_evaluated' })
    expect(conclusion.exitCode).toBe(1)
  })

  it('makes a run integrity issue an invalid measurement and an invalid_run_integrity outcome, never a Planner result', () => {
    const parts = fixture.parts()
    parts.runs[0]!.fresh!.record!.repositoryHeadSha = 'b'.repeat(40)
    const conclusion = conclude(parts)
    expect(conclusion.runs[0]!.integrityIssues.join('\n')).toMatch(/^run 1 fresh: the child record's HEAD "b{40}" is not the run's HEAD a{40}\./m)
    expect(failedRules(conclusion)).toEqual(['result_integrity_issues_zero', 'run_integrity_issues_zero'])
    expect(conclusion.candidateOutcome.kind).toBe('invalid_run_integrity')
    expect(conclusion.acceptance.status).toBe('not_accepted')
    // A formal block another child wrote (wrong pid) or of another run is an integrity issue too.
    const pid = fixture.parts()
    pid.runs[1]!.first.record!.formal.pid = 999
    expect(conclude(pid).runs[1]!.integrityIssues.join('\n')).toMatch(/^run 2 first: the record was written by pid 999, not by the child the parent started \(pid 121\)\./m)
    const run = fixture.parts()
    run.runs[1]!.fresh!.record!.formal.runIndex = 1
    expect(conclude(run).runs[1]!.integrityIssues).toContain('run 2 fresh: the record belongs to run 1, not run 2.')
  })

  it('makes a RESULT integrity issue invalid on its own (start record, concurrency, checkout between runs)', () => {
    const start = fixture.parts()
    start.startRecordMatches = false
    expect(failedRules(conclude(start))).toEqual(['result_integrity_issues_zero'])
    const overlap = fixture.parts()
    overlap.runs[0]!.fresh!.process.startedAtMs = overlap.runs[0]!.first.process.startedAtMs + 1
    const overlapping = conclude(overlap)
    expect(overlapping.resultIntegrityIssues).toContain('Two children ran at the same time.')
    expect(failedRules(overlapping)).toEqual(['result_integrity_issues_zero', 'run_conditions_equal_registration'])
    expect(d1cMaximumConcurrentChildren(fixture.observe(overlap).runs.flatMap(run => [run.first.process, run.fresh!.process]))).toBe(2)
    const between = fixture.parts()
    between.runs[1]!.checkoutBefore = { ...between.runs[1]!.checkoutBefore, workingTreeClean: false }
    between.runs[1]!.checkoutAfter = { ...between.runs[1]!.checkoutAfter, workingTreeClean: false }
    expect(conclude(between).resultIntegrityIssues.join(' ')).toContain('before run 2: the Git checkout changed during the run')
  })

  it('compares the re-materialization with the registered D-0C identity read at the start', () => {
    const semantic = fixture.parts()
    semantic.start.registeredD0c = { ...semantic.start.registeredD0c, identity: { ...semantic.start.registeredD0c.identity!, semanticSha256: '0'.repeat(64) } }
    expect(failedRules(conclude(semantic))).toEqual(['materialization_semantic_equals_registered_d0c'])
    const fingerprint = fixture.parts()
    fingerprint.start.registeredD0c = { ...fingerprint.start.registeredD0c, identity: { ...fingerprint.start.registeredD0c.identity!, entryFingerprint: 'fnv1a32:00000000' } }
    expect(failedRules(conclude(fingerprint))).toEqual(['entry_fingerprint_equals_registered_d0c'])
    const missing = fixture.parts()
    missing.start.registeredD0c = { identity: null, atRegistrationHead: null, issues: ['unreadable'] }
    expect(failedRules(conclude(missing))).toEqual(['entry_fingerprint_equals_registered_d0c', 'materialization_semantic_equals_registered_d0c'])
  })

  it('keeps a Planner rejection a measured outcome of a valid measurement, and an unmeasured child apart from it', () => {
    // Every process recorded a rejection with all conditions evaluated (a consistent record of the real shape): valid, rejected, not accepted.
    const parts = fixture.parts()
    for (const run of parts.runs) {
      for (const side of [run.first, run.fresh!]) {
        const semantic = side.record!.verification.semantic
        semantic.planner.warnings = [{ kind: 'rng_prediction_unsupported', message: 'synthetic' }]
        semantic.checks.noWarnings = false
        semantic.outcome = { kind: 'planner_rejected', reasons: [{ code: 'warnings', count: 1, kinds: { rng_prediction_unsupported: 1 } }] }
        rehash(side.record!)
      }
    }
    const rejected = conclude(parts)
    expect(rejected.formalValidity.status).toBe('valid')
    expect(rejected.candidateOutcome).toMatchObject({ kind: 'planner_rejected', verdict: { kind: 'planner_rejected', run: 'first', reasons: [{ code: 'warnings' }] } })
    expect(rejected.acceptance).toEqual({ status: 'not_accepted', formalValidity: 'valid', candidateOutcome: 'planner_rejected', reasons: ['the candidate outcome is planner_rejected, not verified'] })
    expect(rejected.exitCode).toBe(0)
    expect(rejected.postHoc.operationCount.judgement).toBe('not_evaluated')
    // A fresh child the envelope stopped: unmeasured (never a rejection), the measurement invalid, exit 2.
    const stopped = fixture.parts()
    stopped.runs[1]!.fresh!.process = { ...stopped.runs[1]!.fresh!.process, outcome: 'timeout', timedOut: true, exitCode: null, signal: 'SIGKILL', recordWritten: false, recordFile: null }
    stopped.runs[1]!.fresh!.record = null
    const unmeasured = conclude(stopped)
    expect(unmeasured.candidateOutcome).toMatchObject({ kind: 'unmeasured', verdict: { kind: 'unmeasured', run: 'fresh', reason: 'timeout' }, runVerdictKinds: ['verified', 'unmeasured'] })
    expect(unmeasured.formalValidity.status).toBe('invalid')
    expect(failedRules(unmeasured)).toEqual(expect.arrayContaining(['two_complete_runs', 'child_gates_passed', 'planner_conditions_evaluated_in_both_processes']))
    expect(unmeasured.exitCode).toBe(2)
  })

  it('refuses a candidate verdict that disagrees across runs, and orders integrity before unmeasured before disagreement', () => {
    const conclusions = conclude(fixture.parts()).runs.map(run => run.conclusion)
    const rejected = { ...conclusions[1]!, verdict: { kind: 'planner_rejected' as const, run: 'first' as const, reasons: [{ code: 'plan_null' as const }] } }
    expect(deriveD1cCandidateOutcome([conclusions[0]!, rejected], 2)).toMatchObject({ kind: 'inconsistent_across_runs', verdict: null, consistentAcrossRuns: false })
    const unmeasured = { ...conclusions[1]!, verdict: { kind: 'unmeasured' as const, run: 'first' as const, reason: 'out_of_memory' as const } }
    expect(deriveD1cCandidateOutcome([rejected, unmeasured], 2)).toMatchObject({ kind: 'unmeasured', verdict: { reason: 'out_of_memory' } })
    const broken = { ...conclusions[0]!, verdict: { kind: 'invalid_run_integrity' as const, issues: ['x'] } }
    expect(deriveD1cCandidateOutcome([unmeasured, broken], 2)).toMatchObject({ kind: 'invalid_run_integrity' })
    expect(deriveD1cCandidateOutcome([conclusions[0]!], 2)).toMatchObject({ kind: 'unmeasured', verdict: null })
  })

  it('judges each rule from the records: a child gate, an override, a condition or an oracle input recorded in any child invalidates', () => {
    const cases: [string, (parts: D1cFixtureParts) => void, string[]][] = [
      ['child gate', parts => { parts.runs[1]!.fresh!.record!.formal.gate.issues = ['refused'] }, ['child_gates_passed']],
      ['child calculation gate', parts => { parts.runs[0]!.first.record!.formal.calculation.issues = ['refused'] }, ['calculation_context_matched', 'child_gates_passed']],
      ['fresh Entry set source', parts => { parts.runs[0]!.fresh!.record!.formal.entrySetSource.issues = ['other run'] }, ['child_gates_passed']],
      ['override', parts => { parts.start.flags.push('--heap-mb') }, ['no_command_line_override']],
      ['child heap flag', parts => { parts.runs[0]!.fresh!.process.nodeFlags = [] }, ['run_conditions_equal_registration']],
      ['child wall envelope', parts => { parts.runs[1]!.first.process.wallMs = 60_000 }, ['run_conditions_equal_registration']],
      ['Research maxPlanSteps', parts => { for (const side of [parts.runs[0]!.first, parts.runs[0]!.fresh!]) { side.record!.verification.semantic.conditions.researchMaxPlanSteps = 1_001; rehash(side.record!) } }, ['run_conditions_equal_registration', 'runs_verification_semantic_equal']],
      ['verification budget', parts => { parts.runs[0]!.first.record!.formal.verificationBudget = 2 }, ['run_conditions_equal_registration']],
      ['verified candidates', parts => { parts.runs[1]!.first.record!.formal.verifiedCandidates = 2 }, ['run_conditions_equal_registration']],
      ['child oracle input', parts => { parts.runs[1]!.first.record!.formal.inputsRead.push('git:HEAD:docs/PLANNER_GLOBAL_ORACLE_1657.json') }, ['oracle_not_read']],
      ['child Engine', parts => { parts.runs[1]!.fresh!.record!.rngEngineVersion = 'fake' }, ['rng_engine_version_matched']],
      ['child Master', parts => { parts.runs[0]!.first.record!.calculationContext = { ...parts.runs[0]!.first.record!.calculationContext, masterDataVersion: 99 } }, ['calculation_context_matched', 'master_data_version_matched']],
      ['child HEAD observation', parts => { parts.runs[0]!.fresh!.record!.formal.gate.observedHeadSha = 'c'.repeat(40) }, ['clean_committed_head']],
      ['child audit', parts => { parts.runs[1]!.fresh!.record!.formal.gate.calculationAudit.changedFiles = ['src/domain/planner/plannerTraceReplay.ts'] }, ['calculation_code_audit_passed', 'production_calculation_unchanged']],
      ['child registration', parts => { parts.runs[1]!.first.record!.formal.gate.registration.formalRunEnabled = false }, ['formal_run_enabled']],
      ['child fingerprint', parts => { parts.runs[1]!.first.record!.formal.gate.registration.fingerprint.matched = false }, ['registration_fingerprint_equals_registered_block']],
      ['start registration', parts => { parts.start.registration = { ...parts.start.registration, registrationIssues: ['missing'] } }, ['registration_complete']],
      ['start Export', parts => { parts.start.actualExport = { ...parts.start.actualExport, sha256: '0'.repeat(64) } }, ['export_identity_matched', 'result_integrity_issues_zero', 'run_integrity_issues_zero']],
      ['start oracle', parts => { parts.start.oracleFreeExecution = false }, ['oracle_not_read']],
      ['start benchmark hash', parts => { parts.start.benchmarkCodeSha256 = '' }, ['clean_committed_head']],
      ['same pid', parts => { parts.runs[0]!.fresh!.process.pid = parts.runs[0]!.first.process.pid; parts.runs[0]!.fresh!.record!.formal.pid = parts.runs[0]!.first.process.pid }, ['first_and_fresh_separate_processes', 'result_integrity_issues_zero']],
    ]
    for (const [name, edit, rules] of cases) {
      const parts = fixture.parts()
      edit(parts)
      const conclusion = conclude(parts)
      expect(failedRules(conclusion), name).toEqual([...rules].sort())
      expect(conclusion.formalValidity.status, name).toBe('invalid')
      expect(conclusion.acceptance.status, name).toBe('not_accepted')
    }
  })

  it('fails closed when the implemented rules are not exactly the registered ones', () => {
    const extra = copy()
    ;(extra.formalValidity.value.provenance as string[]).push('extra_rule')
    expect(() => conclude(fixture.parts(), extra)).toThrow(/The provenance rules implemented .* are not the registered ones/)
    const fewer = copy()
    ;(fewer.formalValidity.value.reproducibility as string[]).pop()
    expect(() => conclude(fixture.parts(), fewer)).toThrow(/The reproducibility rules implemented .* are not the registered ones/)
  })
})

describe('Phase D-1C: Planner conditions evaluated in a process', () => {
  it('requires a measured outcome with every condition recorded, nulls only where an earlier condition decided', () => {
    const expectation = fixture.expectation
    const semantic = () => structuredClone(fixture.parts().runs[0]!.first.record!.verification.semantic)
    expect(d1cPlannerConditionsEvaluated(semantic(), expectation)).toEqual({ evaluated: true, nullChecks: [], issues: [] })
    // Not the condition values: a rejection with every condition evaluated is evaluated.
    const rejected = semantic()
    rejected.checks.noConflicts = false
    rejected.outcome = { kind: 'planner_rejected', reasons: [] }
    expect(d1cPlannerConditionsEvaluated(rejected, expectation).evaluated).toBe(true)
    // No Plan: the physical identities stay null, every Planner-stage condition is evaluated.
    const noPlan = semantic()
    noPlan.planner.planPresent = false
    for (const key of ['physicalStepCountIdentity', 'physicalStreamAdvanceIdentity', 'physicalObjectiveIdentity']) noPlan.checks[key] = null
    noPlan.outcome = { kind: 'planner_rejected', reasons: [] }
    expect(d1cPlannerConditionsEvaluated(noPlan, expectation)).toMatchObject({ evaluated: true, nullChecks: ['physicalStepCountIdentity', 'physicalStreamAdvanceIdentity', 'physicalObjectiveIdentity'] })
    // The planning Target set changed: no Planner stage at all.
    const changed = semantic()
    changed.planner = null
    for (const key of D1C_CONDITION_CHECK_KEYS) changed.checks[key] = null
    changed.outcome = { kind: 'planning_target_set_changed', reasons: [] }
    expect(d1cPlannerConditionsEvaluated(changed, expectation).evaluated).toBe(true)
    const cases: [string, (value: FixtureRecord) => void, RegExp][] = [
      ['unmeasured', value => { value.outcome = { kind: 'unmeasured', reason: 'cancelled' } }, /not a measured Phase D' outcome/],
      ['conditions_met with a false check', value => { value.checks.noWarnings = false }, /conditions_met with a condition that is not true/],
      ['a Planner-stage null', value => { value.checks.noWarnings = null; value.outcome = { kind: 'planner_rejected', reasons: [] } }, /a Planner-stage condition was not evaluated although the Planner ran/],
      ['a missing key', value => { delete value.checks.noWarnings }, /condition keys .* are not the registered 13/],
      ['another protocol', value => { value.protocolVersion = 'global-assignment-d1a:1' }, /protocol global-assignment-d1a:1 is not global-assignment-d1b:1/],
    ]
    for (const [name, edit, reason] of cases) {
      const value = semantic()
      edit(value)
      const result = d1cPlannerConditionsEvaluated(value, expectation)
      expect(result.evaluated, name).toBe(false)
      expect(result.issues.join('; '), name).toMatch(reason)
    }
    expect(d1cPlannerConditionsEvaluated(null, expectation)).toEqual({ evaluated: false, nullChecks: [], issues: ['no verification semantic record'] })
  })
})
