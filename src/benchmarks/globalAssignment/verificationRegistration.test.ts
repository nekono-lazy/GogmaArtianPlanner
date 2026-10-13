import { describe, expect, it } from 'vitest'
import { hashStableValue } from '../../domain/models/publicTypes'
import { readCalculationCodeAudit, MATERIALIZATION_D0C_REGISTRATION_HEAD } from './materializationFormal'
import { MATERIALIZATION_D0B2_DOC, MATERIALIZATION_D0C_PREREGISTRATION, readD0cRegisteredExportIdentity, registeredD0cConditions } from './materializationProtocol'
import { reachWindowW0 } from './reachTable'
import { D1A_NONFORMAL_CONDITIONS } from './verificationProtocol'
import {
  D1C_REGISTERED_ITEM_KEYS, d1cFormalRunIssues, d1cRegistrationFingerprint, differencesFromD1cRegistration, PLANNER_VERIFICATION_D1B_BASE_MAIN, PLANNER_VERIFICATION_D1B_DOC,
  PLANNER_VERIFICATION_D1C_PREREGISTRATION, plannerVerificationD1cRegistrationIssues, readD1cRegisteredD0cIdentity, readD1cRegisteredRegistrationFingerprint, registeredD1cConditions,
  type D1cRegistration,
} from './verificationRegistration'
import { PLANNER_VERIFICATION_PROTOCOL_VERSION } from './verify'

/*
 * Issue #154 Global Assignment Phase D-1B (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md 8 - 13): the pre-registration of the D-1C
 * formal integration measurement. Every item is registered with its basis, the materialization items are the D-0C registration itself,
 * the values are frozen and fingerprinted in the committed D-1B document, the D-0C identity block equals the D-0C public RESULT, the
 * calculation code audit allows the D-1C formal infrastructure only, and the formal run is enabled by D-1C alone (the one allowed change,
 * which leaves the fingerprint unchanged).
 */
const d1bDocument = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md', { query: '?raw', import: 'default', eager: true }))[0] as string
const d0b2Document = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', { query: '?raw', import: 'default', eager: true }))[0] as string
const d0cPublicResult = JSON.parse(Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json', { query: '?raw', import: 'default', eager: true }))[0] as string) as {
  determinism: { semanticSha256s: string[]; identical: boolean }
  runs: { semanticSha256: string }[]
  materializedEntries: { fingerprint: string; count: number }
  formalValidity: { status: string }
}
const d1aRunnerSource = Object.values(import.meta.glob('../../../scripts/run-planner-global-assignment-d1a.mjs', { query: '?raw', import: 'default', eager: true }))[0] as string
const REGISTRATION = PLANNER_VERIFICATION_D1C_PREREGISTRATION
/** A mutable deep copy of the registration (the real one is frozen). */
const copy = (): D1cRegistration => structuredClone(REGISTRATION) as D1cRegistration

describe('Phase D-1B: the D-1C pre-registration', () => {
  it('registers every item with its value, unit, basis, evidence, oracle provenance and both ranges, none oracle-informed', () => {
    expect(plannerVerificationD1cRegistrationIssues()).toEqual([])
    expect(Object.keys(REGISTRATION).sort()).toEqual([...D1C_REGISTERED_ITEM_KEYS, 'registeredIn', 'formalRun'].sort())
    for (const key of D1C_REGISTERED_ITEM_KEYS) {
      const item = REGISTRATION[key]
      expect(item.value, key).not.toBeNull()
      expect(item.unit.length, key).toBeGreaterThan(3)
      expect(item.basis.length, key).toBeGreaterThan(20)
      expect(item.evidence.length, key).toBeGreaterThan(0)
      expect(item.oracleInformed, key).toBe(false)
      expect(item.observedRange.length, key).toBeGreaterThan(0)
      expect(item.unconfirmedRange.length, key).toBeGreaterThan(0)
    }
    expect(REGISTRATION.registeredIn).toBe('Phase D-1B')
    expect(PLANNER_VERIFICATION_D1B_DOC).toBe('docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md')
    expect(PLANNER_VERIFICATION_D1B_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
  })

  it('registers the requested values: W0 / a2 / d0a2-v2 / one candidate, verification budget 1, maxPlanSteps 20,000, the envelope and 2 complete runs', () => {
    expect(REGISTRATION.reachWindow.value).toEqual({ normal: 350, gogma: 500, skill: 1500 })
    expect(REGISTRATION.reachWindow.value).toEqual(reachWindowW0())
    expect(REGISTRATION.optionSetVersion.value).toBe('global-assignment-reach-options:a2')
    expect(REGISTRATION.methodSelectionRule.value).toBe('d0a2-v2')
    expect(REGISTRATION.structuralCandidateLimit.value).toBe(1)
    expect(REGISTRATION.verificationBudget.value).toBe(1)
    expect(REGISTRATION.researchMaxPlanSteps.value).toBe(20_000)
    expect(REGISTRATION.firstChildWallMs.value).toBe(1_800_000)
    expect(REGISTRATION.freshChildWallMs.value).toBe(1_800_000)
    expect(REGISTRATION.childHeapMb.value).toBe(8_192)
    expect(REGISTRATION.concurrency.value).toBe(1)
    expect(REGISTRATION.childProcessRetry.value).toBe('none')
    expect(REGISTRATION.repeat.value).toBe(2)
    expect(REGISTRATION.repeat.unit).toMatch(/one first child \+ one fresh child \(4 children/)
    expect(REGISTRATION.planner.value).toBe('createProductionPlanWithObserver')
    expect(REGISTRATION.traceReplay.value).toBe('replayPlannerSearchTrace_independent')
    expect(REGISTRATION.freshValidation.value).toBe('separate_node_process_required')
    expect(REGISTRATION.runIntegrity.value).toBe('zero_issues_required')
    expect(REGISTRATION.oracleFreeExecution.value).toBe(true)
    expect(REGISTRATION.verificationProtocolVersion.value).toBe(PLANNER_VERIFICATION_PROTOCOL_VERSION)
    expect(PLANNER_VERIFICATION_PROTOCOL_VERSION).toBe('global-assignment-d1b:1')
    expect(registeredD1cConditions()).toEqual({
      materialization: registeredD0cConditions().conditions,
      verification: { researchMaxPlanSteps: 20_000, verificationBudget: 1 },
      envelope: { firstChildWallMs: 1_800_000, freshChildWallMs: 1_800_000, childHeapMb: 8_192, concurrency: 1, childProcessRetry: 'none', repeat: 2 },
    })
    // The verification budget is a bound on candidates verified, never a minimality claim, and maxPlanSteps is the design 10.4 value.
    expect(REGISTRATION.verificationBudget.basis).toMatch(/no minimality proof/)
    expect(REGISTRATION.verificationBudget.basis).toMatch(/not_attempted\(verification_budget\), never absent/)
    expect(REGISTRATION.researchMaxPlanSteps.basis).toMatch(/Design 10\.4 \/ G12/)
    expect(REGISTRATION.researchMaxPlanSteps.basis).toMatch(/not derived from any known Route or Plan length \(1,657, 1,766, 8,534\)/)
    // The observed and the unconfirmed ranges stay apart: the envelope is a safety bound, not a measured cost.
    for (const key of ['firstChildWallMs', 'freshChildWallMs', 'childHeapMb'] as const) {
      expect(REGISTRATION[key].observedRange, key).toMatch(/D-1A/)
      expect(REGISTRATION[key].unconfirmedRange, key).toMatch(/unobserved|nothing between|not a measured cost/)
    }
  })

  it('inherits the D-0C materialization conditions unchanged: the items equal the D-0C registration, which D-1B does not touch', () => {
    const d0c = registeredD0cConditions().conditions
    expect(REGISTRATION.materialization.value).toBe('MATERIALIZATION_D0C_PREREGISTRATION')
    expect(REGISTRATION.reachWindow.value).toEqual(d0c.window)
    expect(REGISTRATION.optionSetVersion.value).toBe(d0c.reachOptionSet)
    expect(REGISTRATION.methodSelectionRule.value).toBe(d0c.rule)
    expect(REGISTRATION.structuralCandidateLimit.value).toBe(d0c.structuralCandidateLimit)
    expect(REGISTRATION.calculationContext.value).toEqual(MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value)
    expect(REGISTRATION.materializationProtocolVersion.value).toBe(MATERIALIZATION_D0C_PREREGISTRATION.researchProtocolVersion.value)
    // The D-0C registration stays as D-0C measured it (formal mode enabled for D-0C, its own registration HEAD).
    expect(MATERIALIZATION_D0C_PREREGISTRATION.formalRun.enabled).toBe(true)
    expect(MATERIALIZATION_D0C_REGISTRATION_HEAD).toBe('3f6717968da0b29fe8e1e7feda44833d29af0678')
    expect(d0c).toMatchObject({ rule: 'd0a2-v2', window: { normal: 350, gogma: 500, skill: 1500 }, nodeBudget: 2_000, mrvLookahead: 8, coverageDrivenOrdering: true, structuralCandidateLimit: 1, reachOptionSet: 'global-assignment-reach-options:a2' })
  })

  it('ties the non-formal D-1A / D-1B checks to the registered values: one complete run of exactly these conditions', () => {
    const nonformal = {
      materialization: registeredD0cConditions().conditions, researchMaxPlanSteps: D1A_NONFORMAL_CONDITIONS.researchMaxPlanSteps.value,
      firstChildWallMs: D1A_NONFORMAL_CONDITIONS.firstChildWallMs.value, freshChildWallMs: D1A_NONFORMAL_CONDITIONS.freshChildWallMs.value, childHeapMb: D1A_NONFORMAL_CONDITIONS.childHeapMb.value,
      concurrency: D1A_NONFORMAL_CONDITIONS.concurrency.value, childProcessRetry: D1A_NONFORMAL_CONDITIONS.retry.value,
    }
    expect(differencesFromD1cRegistration(nonformal)).toEqual([])
    // The D-1A conditions themselves stay non-formal records: never registered, never rewritten as registered.
    for (const condition of Object.values(D1A_NONFORMAL_CONDITIONS)) expect(condition).toMatchObject({ registered: false, oracleInformed: false })
    expect(differencesFromD1cRegistration({ ...nonformal, researchMaxPlanSteps: 1_000, childHeapMb: 4_096 })).toEqual(['researchMaxPlanSteps: 1000 (registered 20000)', 'childHeapMb: 4096 (registered 8192)'])
    expect(differencesFromD1cRegistration({ ...nonformal, materialization: { ...nonformal.materialization, nodeBudget: 1 } })).toEqual(['materialization: the conditions are not the D-0C registered conditions'])
  })

  it('is frozen, and its fingerprint (formalRun excluded) is the one the committed D-1B document registers', () => {
    expect(Object.isFrozen(REGISTRATION)).toBe(true)
    expect(Object.isFrozen(REGISTRATION.calculationCodeAudit.value.allowedChangedFiles)).toBe(true)
    expect(Object.isFrozen(REGISTRATION.formalValidity.value.provenance)).toBe(true)
    expect(() => { (REGISTRATION.verificationBudget as { value: number }).value = 2 }).toThrow(TypeError)
    expect(() => { (REGISTRATION.reachWindow.value as { gogma: number }).gogma = 1 }).toThrow(TypeError)
    expect(REGISTRATION.verificationBudget.value).toBe(1)
    const registered = readD1cRegisteredRegistrationFingerprint(d1bDocument)
    expect(registered.issues).toEqual([])
    expect(d1cRegistrationFingerprint()).toBe(registered.fingerprint)
    // Enabling the formal run (D-1C's one allowed change) keeps the fingerprint; any other change moves it.
    const enabled = copy()
    enabled.formalRun = { enabled: true, startsIn: 'D-1C', enabledBy: 'D-1C' }
    expect(d1cRegistrationFingerprint(enabled)).toBe(registered.fingerprint)
    const edited = copy()
    edited.researchMaxPlanSteps.value = 20_001
    expect(d1cRegistrationFingerprint(edited)).not.toBe(registered.fingerprint)
    const reworded = copy()
    reworded.verificationBudget.basis += ' '
    expect(d1cRegistrationFingerprint(reworded)).not.toBe(registered.fingerprint)
    expect(readD1cRegisteredRegistrationFingerprint('registered-d1c-registration-fingerprint: x')).toEqual({ fingerprint: null, issues: ['registered-d1c-registration-fingerprint: must be fnv1a32:<8 lower-case hex>.'] })
    expect(readD1cRegisteredRegistrationFingerprint('')).toMatchObject({ fingerprint: null, issues: ['registered-d1c-registration-fingerprint: expected exactly one line, found 0.'] })
  })

  it('registers the D-0C identity in the committed D-1B document, equal to the D-0C public RESULT, and refuses an ambiguous block', () => {
    const identity = readD1cRegisteredD0cIdentity(d1bDocument)
    expect(identity.issues).toEqual([])
    expect(d0cPublicResult.formalValidity.status).toBe('valid')
    expect(d0cPublicResult.determinism.identical).toBe(true)
    for (const sha of [...d0cPublicResult.determinism.semanticSha256s, ...d0cPublicResult.runs.map(run => run.semanticSha256)]) expect(identity.identity!.semanticSha256).toBe(sha)
    expect(identity.identity!.entryFingerprint).toBe(d0cPublicResult.materializedEntries.fingerprint)
    expect(d0cPublicResult.materializedEntries.count).toBe(43)
    expect(REGISTRATION.d0cIdentity.unit).toContain(PLANNER_VERIFICATION_D1B_DOC)
    expect(REGISTRATION.d0cIdentity.basis).toMatch(/only after that re-materialization settled and before Phase D'/)
    expect(REGISTRATION.d0cIdentity.basis).toMatch(/never a command-line value, never an execution input/)
    const lines = d1bDocument.split(/\r?\n/).filter(line => /^registered-d0c-/.test(line.trim()))
    expect(readD1cRegisteredD0cIdentity(lines.join('\n'))).toEqual(identity)
    expect(readD1cRegisteredD0cIdentity([...lines, lines[0]!].join('\n'))).toMatchObject({ identity: null, issues: ['registered-d0c-materialization-semantic-sha256: expected exactly one line, found 2.'] })
    expect(readD1cRegisteredD0cIdentity(lines.slice(1).join('\n'))).toMatchObject({ identity: null, issues: ['registered-d0c-materialization-semantic-sha256: expected exactly one line, found 0.'] })
    expect(readD1cRegisteredD0cIdentity('registered-d0c-materialization-semantic-sha256: ABC\nregistered-d0c-entry-fingerprint: fnv1a32:zz')).toMatchObject({ identity: null, issues: [expect.stringMatching(/64 lower-case hex/), expect.stringMatching(/fnv1a32:<8 lower-case hex>/)] })
    // The Export identity is the D-0B-2 committed block, unchanged.
    expect(REGISTRATION.exportIdentity.unit).toContain(MATERIALIZATION_D0B2_DOC)
    expect(readD0cRegisteredExportIdentity(d0b2Document)).toEqual({ identity: { fileName: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19_424_064, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }, issues: [] })
  })

  it('audits the calculation code against the D-1B merge commit with the D-1C formal infrastructure allowed only, and keeps the D-0C guard refusing', () => {
    const audit = REGISTRATION.calculationCodeAudit.value
    expect(REGISTRATION.registrationHead.value).toBe('d1b-merge-commit')
    expect(REGISTRATION.registrationHead.basis).toMatch(/fixes no SHA/)
    // The code paths are the D-1A runner's (the D-0B / D-0C ones), pinned here against the runner source and listed in the D-1B document.
    expect(audit.codePaths).toBe('d1a-runner-code-paths')
    const codePaths = /^const CODE_PATHS = (\[[^\]]+\])$/m.exec(d1aRunnerSource)?.[1]
    expect(codePaths && JSON.parse(codePaths.replace(/'/g, '"'))).toEqual(['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'])
    expect(d1bDocument).toContain('`src`、`scripts`、`package.json`、`package-lock.json`、`vite.config.ts`、`vitest.config.ts`、`tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`')
    expect(audit.registrationChange).toBe('formal_run_enablement_only')
    // Never the Phase D' calculation, its protocol, the materialization, Production or the child-process envelope.
    for (const file of audit.allowedChangedFiles) {
      expect(file).toMatch(/^(?:scripts\/(?:run|derive)-planner-global-assignment-d1[ac]|src\/benchmarks\/globalAssignment\/(?:verificationFormal|verificationRegistration|isolation))/)
    }
    for (const forbidden of ['src/benchmarks/globalAssignment/verify.ts', 'src/benchmarks/globalAssignment/verificationProtocol.ts', 'src/benchmarks/globalAssignment/materializationRunner.ts', 'src/domain/planner/productionPlanGeneration.ts', 'scripts/planner-global-assignment-d0b-child-process.mjs']) {
      expect(audit.allowedChangedFiles).not.toContain(forbidden)
      const widened = copy()
      ;(widened.calculationCodeAudit.value.allowedChangedFiles as string[]).push(forbidden)
      expect(plannerVerificationD1cRegistrationIssues(widened).join(' ')).toContain(`calculationCodeAudit allows ${forbidden}, a calculation-related file.`)
    }
    // The D-0C formal guard keeps refusing the D-1B changes (its registration HEAD and infrastructure list are untouched).
    const d0c = readCalculationCodeAudit({ registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, registrationHeadIsAncestor: true, changedFiles: ['src/benchmarks/globalAssignment/verificationRegistration.ts', 'src/benchmarks/globalAssignment/verify.ts'], error: null })
    expect(d0c.outsideFormalInfrastructure).toEqual(['src/benchmarks/globalAssignment/verificationRegistration.ts', 'src/benchmarks/globalAssignment/verify.ts'])
    expect(d0c.issues.join(' ')).toMatch(/outside the D-0C formal infrastructure/)
  })

  it('registers the formal validity rules D-1C must apply, the candidate outcome kept apart, and no expected result', () => {
    const rules = REGISTRATION.formalValidity.value
    expect(rules.provenance).toEqual(expect.arrayContaining([
      'registration_complete', 'run_conditions_equal_registration', 'clean_committed_head', 'registration_head_is_ancestor', 'calculation_code_audit_passed', 'production_calculation_unchanged',
      'export_identity_matched', 'calculation_context_matched', 'rng_engine_version_matched', 'master_data_version_matched', 'oracle_not_read', 'no_command_line_override', 'child_gates_passed',
    ]))
    expect(rules.reproducibility).toEqual(expect.arrayContaining([
      'two_complete_runs', 'first_and_fresh_separate_processes', 'planner_conditions_evaluated_in_both_processes', 'first_fresh_verification_semantic_equal', 'runs_verification_semantic_equal',
      'materialization_semantic_equals_registered_d0c', 'entry_fingerprint_equals_registered_d0c', 'run_integrity_issues_zero', 'result_integrity_issues_zero',
    ]))
    expect(rules.candidateOutcome).toEqual(expect.arrayContaining([
      'recorded_apart_from_formal_validity', 'valid_measurement_may_reject_candidate', 'planner_rejection_is_a_measured_outcome', 'timeout_oom_cancel_process_failure_unmeasured',
      'integrity_failure_is_invalid_measurement', 'verified_without_valid_provenance_not_accepted',
    ]))
    const interpretation = REGISTRATION.acceptanceInterpretation.value
    expect(interpretation.acceptance).toBe('formal_validity_valid_and_candidate_verified')
    expect(interpretation.provenMinimum).toMatch(/applicable, proven root lower bound/)
    expect(interpretation.notClaimed).toEqual(['no_later_candidate_examined', 'no_minimality_from_verification_budget', 'd1a_physical_operations_are_not_an_expected_d1c_result'])
    // No item is an expected outcome of D-1C (no expected physical operations, Plan steps, verdict or semantic hash of D-1C).
    expect(D1C_REGISTERED_ITEM_KEYS.filter(key => /expected|result|verdict|physical|steps(?!$)/i.test(key))).toEqual([])
    expect(JSON.stringify(REGISTRATION)).not.toMatch(/"expected[A-Z]/)
  })

  it('D-1C enabled the formal run (its one allowed change), and an incomplete or inconsistent registration is still refused by name', () => {
    // Phase D-1C: formalRun is enabled and nothing else changed (the fingerprint test above still matches the committed D-1B block).
    expect(REGISTRATION.formalRun).toEqual({ enabled: true, startsIn: 'D-1C', enabledBy: 'Phase D-1C' })
    expect(d1cFormalRunIssues()).toEqual([])
    const disabled = copy()
    disabled.formalRun = { enabled: false, startsIn: 'D-1C', enabledBy: null }
    expect(d1cFormalRunIssues(disabled)).toEqual([expect.stringMatching(/A D-1C formal run is not enabled .* Phase D-1B registers the conditions only/)])
    expect(d1cRegistrationFingerprint(disabled)).toBe(d1cRegistrationFingerprint())
    const issuesOf = (edit: (registration: D1cRegistration) => void) => { const value = copy(); edit(value); return plannerVerificationD1cRegistrationIssues(value).join(' ') }
    expect(issuesOf(value => { delete (value as Partial<D1cRegistration>).verificationBudget })).toBe('verificationBudget is not registered.')
    expect(issuesOf(value => { value.childHeapMb.basis = '' })).toBe('childHeapMb.basis is missing.')
    expect(issuesOf(value => { value.verificationBudget.value = 0 })).toMatch(/verificationBudget must be a positive integer/)
    expect(issuesOf(value => { value.verificationBudget.value = 2 })).toMatch(/verificationBudget 2 exceeds structuralCandidateLimit 1/)
    expect(issuesOf(value => { value.researchMaxPlanSteps.value = 1.5 })).toMatch(/researchMaxPlanSteps must be a positive integer/)
    expect(issuesOf(value => { value.repeat.value = 1 })).toMatch(/repeat must be an integer of at least 2 complete runs/)
    expect(issuesOf(value => { value.concurrency.value = 2 })).toMatch(/concurrency must be 1/)
    expect(issuesOf(value => { (value.childProcessRetry as { value: string }).value = 'once' })).toMatch(/childProcessRetry must be none/)
    expect(issuesOf(value => { value.firstChildWallMs.value = 10 })).toMatch(/registered envelope: firstChildWallMs must be an integer/)
    expect(issuesOf(value => { value.reachWindow.value = { normal: 1, gogma: 1, skill: 1 } })).toMatch(/reachWindow .* is not the D-0C registered window/)
    expect(issuesOf(value => { (value.verificationProtocolVersion as { value: string }).value = 'global-assignment-d1a:1' })).toMatch(/verificationProtocolVersion global-assignment-d1a:1 is not the current global-assignment-d1b:1/)
    expect(issuesOf(value => { (value.formalValidity.value.provenance as string[]).push('registration_complete') })).toMatch(/formalValidity\.provenance lists a rule twice/)
    // A disabled and incomplete registration is refused for both reasons.
    const broken = copy()
    broken.formalRun = { enabled: false, startsIn: 'D-1C', enabledBy: null }
    broken.repeat.value = 1
    expect(d1cFormalRunIssues(broken)).toEqual([expect.stringMatching(/not enabled/), expect.stringMatching(/pre-registration is incomplete: repeat must be/)])
    expect(hashStableValue(REGISTRATION)).toBe(hashStableValue(PLANNER_VERIFICATION_D1C_PREREGISTRATION))
  })
})
