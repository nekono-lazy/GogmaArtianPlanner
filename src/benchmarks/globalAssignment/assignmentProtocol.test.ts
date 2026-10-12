import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_B2A_BASE_MAIN, ASSIGNMENT_B2A_PROTOCOL_VERSION, ASSIGNMENT_B2B_PREREGISTRATION, assignmentB2bRegistrationIssues, compareExportIdentity, findNonPlainJsonPaths,
  formalChildGateIssues, formalRunGateIssues, formalStartIssues, judgeFormalValidity, parseRegisteredExportIdentity, registeredFormalConditions, snapshotResourceAssignment,
  validateAssignmentResearchConditions, validateWindowLadder, type AssignmentResearchConditions, type ExportIdentity, type FormalValidityInput, type RegisteredCondition,
} from './assignmentProtocol'
import { collectResourceAssignments } from './assignmentSolver'
import { gogmaSource, handBuiltReachTable, newNormalSource } from './assignmentTestFixture'

/*
 * Issue #154 Global Assignment Phase B-2A (design 10.4 / 11.2 / 12): the Research conditions, the window
 * ladder, the bounded plain-data candidate snapshot and the Phase B-2B pre-registration record.
 */
const VALID: AssignmentResearchConditions = { window: { normal: 3, gogma: 6, skill: 4 }, nodeBudget: 100, mrvLookahead: 8, candidateLimit: 10, snapshotLimit: 2 }

describe('Phase B-2A Research conditions', () => {
  it('accepts positive integer budgets and a snapshot limit up to the candidate limit', () => {
    expect(validateAssignmentResearchConditions(VALID)).toEqual([])
    expect(validateAssignmentResearchConditions({ ...VALID, snapshotLimit: 0 })).toEqual([])
    expect(validateAssignmentResearchConditions({ ...VALID, snapshotLimit: 10 })).toEqual([])
  })

  it('refuses a non-positive, fractional or missing budget, a bad window and a snapshot limit above the candidate limit', () => {
    expect(validateAssignmentResearchConditions(null)).toEqual(['conditions must be an object.'])
    expect(validateAssignmentResearchConditions({ ...VALID, window: { normal: 0, gogma: 6, skill: 4 } })).toEqual(['window.normal must be a positive integer (got 0).'])
    expect(validateAssignmentResearchConditions({ ...VALID, window: undefined })).toEqual(['window must be an object with normal / gogma / skill.'])
    expect(validateAssignmentResearchConditions({ ...VALID, nodeBudget: 1.5 })).toEqual(['nodeBudget must be a positive integer (got 1.5).'])
    expect(validateAssignmentResearchConditions({ ...VALID, mrvLookahead: -1 })).toEqual(['mrvLookahead must be a positive integer (got -1).'])
    expect(validateAssignmentResearchConditions({ ...VALID, candidateLimit: 0 })).toEqual(['candidateLimit must be a positive integer (got 0).'])
    expect(validateAssignmentResearchConditions({ ...VALID, snapshotLimit: -1 })).toEqual(['snapshotLimit must be a non-negative integer (got -1).'])
    expect(validateAssignmentResearchConditions({ ...VALID, snapshotLimit: 11 })).toEqual(['snapshotLimit (11) must not exceed candidateLimit (10).'])
    expect(validateAssignmentResearchConditions({ ...VALID, nodeBudget: '100' })).toEqual(['nodeBudget must be a positive integer (got 100).'])
  })

  it('accepts a ladder whose rungs never narrow a stream and refuses an empty or narrowing one', () => {
    expect(validateWindowLadder([VALID.window])).toEqual([])
    expect(validateWindowLadder([VALID.window, { normal: 3, gogma: 12, skill: 8 }])).toEqual([])
    expect(validateWindowLadder([])).toEqual(['windowLadder must be a non-empty array of windows.'])
    expect(validateWindowLadder([VALID.window, { normal: 2, gogma: 6, skill: 4 }])).toEqual(['windowLadder[1].normal (2) narrows rung 0 (3); a rung never narrows a stream.'])
    expect(validateWindowLadder([VALID.window, null])).toEqual(['windowLadder[1] must be a window.'])
    expect(validateWindowLadder([{ normal: 3, gogma: 0, skill: 4 }])).toEqual(['windowLadder[0].gogma must be a positive integer (got 0).'])
  })
})

describe('Phase B-2A candidate snapshot', () => {
  it('turns a resource assignment into plain JSON data in planning Target order, with source and requirement kind counts', () => {
    const built = handBuiltReachTable({ targets: [
      { id: 'target.b', sources: [gogmaSource('owned.g1')] },
      { id: 'target.a', sources: [newNormalSource(4)] },
    ] })
    const result = collectResourceAssignments(built.table, built.planningTargets, { nodeBudget: 1000, mrvLookahead: 8 }, 1)
    if (result.status !== 'assignments_found') throw new Error(result.status)
    const candidate = result.candidates[0]!
    const snapshot = snapshotResourceAssignment(candidate)
    expect(snapshot.kind).toBe('resource_assignment')
    expect(snapshot.ordinal).toBe(candidate.ordinal)
    expect(snapshot.objective).toBe(candidate.objective)
    expect(snapshot.chosen.map(option => option.targetWeaponId)).toEqual(['target.a', 'target.b'])
    expect(snapshot.sourceKinds).toEqual({ owned_gogma: 1, owned_normal: 0, new_normal: 1 })
    expect(snapshot.skillRequirements.none + snapshot.skillRequirements.reset_skills + snapshot.skillRequirements.conversion).toBe(2)
    expect(snapshot.bonusRequirements.none + snapshot.bonusRequirements.reset + snapshot.bonusRequirements.keep_from_source + snapshot.bonusRequirements.reset_then_keep).toBe(2)
    expect(snapshot.usedSources).toEqual(candidate.usedSources)
    expect(snapshot.streamEnd).toEqual(candidate.streamEnd)
    expect(findNonPlainJsonPaths(snapshot)).toEqual([])
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    // The original candidate holds a Map, which JSON would turn into {}; the snapshot never does.
    expect(findNonPlainJsonPaths(candidate)).toEqual(['$.chosen: Map'])
  })
})

describe('findNonPlainJsonPaths', () => {
  it('names every Map, Set, function, bigint, non-finite number and undefined property, and accepts plain data', () => {
    expect(findNonPlainJsonPaths({ a: 1, b: 'x', c: null, d: [1, { e: true }], f: {} })).toEqual([])
    expect(findNonPlainJsonPaths({ a: new Map([[1, 2]]), b: { c: new Set([1]) } })).toEqual(['$.a: Map', '$.b.c: Set'])
    expect(findNonPlainJsonPaths({ a: () => 1 })).toEqual(['$.a: function'])
    expect(findNonPlainJsonPaths({ a: 10n })).toEqual(['$.a: bigint'])
    expect(findNonPlainJsonPaths({ a: Number.NaN, b: [Number.POSITIVE_INFINITY] })).toEqual(['$.a: non-finite number', '$.b[0]: non-finite number'])
    expect(findNonPlainJsonPaths({ a: undefined, b: [undefined] })).toEqual(['$.a: undefined', '$.b[0]: undefined'])
  })
})

describe('Phase B-2B pre-registration record', () => {
  it('keeps the protocol identity and the Phase start main', () => {
    expect(ASSIGNMENT_B2A_PROTOCOL_VERSION).toBe('global-assignment-b2a:1')
    expect(ASSIGNMENT_B2A_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names exactly the unregistered items, and never enables a formal run in Phase B-2A', () => {
    const registration = ASSIGNMENT_B2B_PREREGISTRATION
    const items: [string, RegisteredCondition<unknown>][] = [
      ['windowLadder', registration.windowLadder], ['nodeBudget', registration.nodeBudget], ['mrvLookahead', registration.mrvLookahead],
      ['candidateLimit', registration.candidateLimit], ['snapshotLimit', registration.snapshotLimit],
      ['rootLowerBound.budget', registration.rootLowerBound.budget], ['rootLowerBound.childWallMs', registration.rootLowerBound.childWallMs],
      ['rootLowerBound.childHeapMb', registration.rootLowerBound.childHeapMb],
      ['assignmentChild.wallMs', registration.assignmentChild.wallMs], ['assignmentChild.heapMb', registration.assignmentChild.heapMb],
    ]
    const issues = assignmentB2bRegistrationIssues()
    for (const [path, condition] of items) {
      expect(typeof condition.basis, path).toBe('string')
      expect(condition.basis.length, path).toBeGreaterThan(0)
      expect(typeof condition.oracleInformed, path).toBe('boolean')
      expect(issues.includes(`${path} is not registered.`), path).toBe(condition.value === null)
    }
    expect(registration.concurrency).toBe(1)
    expect(registration.retry).toBe('none')
    expect(registration.reproducibilityRuns).toBeGreaterThanOrEqual(2)
    expect(registration.formalRun.enabled).toBe(false)
    if (registration.windowLadder.value !== null) expect(validateWindowLadder(registration.windowLadder.value)).toEqual([])
  })

  it('exposes the registered conditions as one object once every item is registered', () => {
    const registered = registeredFormalConditions()
    if ('issues' in registered) {
      expect(registered.issues).toEqual(assignmentB2bRegistrationIssues())
      return
    }
    const registration = ASSIGNMENT_B2B_PREREGISTRATION
    expect(registered.conditions).toEqual({ window: registration.windowLadder.value![0], nodeBudget: registration.nodeBudget.value, mrvLookahead: registration.mrvLookahead.value,
      candidateLimit: registration.candidateLimit.value, snapshotLimit: registration.snapshotLimit.value })
    expect(registered.windowLadder).toEqual(registration.windowLadder.value)
    expect(registered.envelope).toEqual({ assignmentWallMs: registration.assignmentChild.wallMs.value, assignmentHeapMb: registration.assignmentChild.heapMb.value,
      rootBoundBudget: registration.rootLowerBound.budget.value, rootBoundWallMs: registration.rootLowerBound.childWallMs.value, rootBoundHeapMb: registration.rootLowerBound.childHeapMb.value,
      repeat: registration.reproducibilityRuns, replaySnapshots: true })
    expect(validateAssignmentResearchConditions(registered.conditions)).toEqual([])
  })
})

/*
 * The formal measurement contract (Phase B-2B): the registered Export identity comes from the committed Research
 * document text, the parent and every child apply one gate, and formalValidity is a separate judgement from the mode.
 * Fixture hashes are synthetic (no real Export).
 */
const FIXTURE_SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)
const REGISTERED: ExportIdentity = { fileName: 'export-fixture.json', bytes: 12_345, sha256: FIXTURE_SHA }
const DOC = ['# Research', '', '```text', 'registered-export-file: export-fixture.json', 'registered-export-bytes: 12345', `registered-export-sha256: ${FIXTURE_SHA}`, '```', ''].join('\n')
const ENABLED_GATE = { formalRunEnabled: true, unresolvedItems: [] as string[] }
const B2A_GATE = { formalRunEnabled: ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled, unresolvedItems: assignmentB2bRegistrationIssues() }

const researchDocument = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md', { query: '?raw', import: 'default', eager: true }))[0] as string

describe('registered Export identity (Research document authority)', () => {
  it('finds exactly one registered Export identity in the committed Research document', () => {
    const parsed = parseRegisteredExportIdentity(researchDocument)
    expect(parsed.issues).toEqual([])
    expect(parsed.identity).not.toBeNull()
    // Shape only: the hash itself stays in the document, never in Research code or tests (design 11.3).
    expect(parsed.identity!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parsed.identity!.bytes).toBeGreaterThan(0)
    expect(parsed.identity!.fileName).toMatch(/^gogma-artian-planner-backup_\d{14}\.json$/)
  })

  it('parses exactly one line per key and refuses a missing, duplicated or malformed line', () => {
    expect(parseRegisteredExportIdentity(DOC)).toEqual({ identity: REGISTERED, issues: [] })
    expect(parseRegisteredExportIdentity(DOC.replace(/registered-export-bytes: 12345\n/, ''))).toEqual({ identity: null, issues: ['registered-export-bytes: expected exactly one line, found 0.'] })
    expect(parseRegisteredExportIdentity(`${DOC}registered-export-file: other.json\n`)).toEqual({ identity: null, issues: ['registered-export-file: expected exactly one line, found 2.'] })
    expect(parseRegisteredExportIdentity(DOC.replace('12345', '0'))).toEqual({ identity: null, issues: ['registered-export-bytes: must be a positive integer (got 0).'] })
    expect(parseRegisteredExportIdentity(DOC.replace(FIXTURE_SHA, FIXTURE_SHA.toUpperCase()))).toEqual({ identity: null, issues: ['registered-export-sha256: must be 64 lower-case hex characters.'] })
    expect(parseRegisteredExportIdentity('').identity).toBeNull()
    // Prose that mentions the hash without the key is not a registration line.
    expect(parseRegisteredExportIdentity(`SHA-256 \`${FIXTURE_SHA}\``).identity).toBeNull()
  })

  it('compares file name, length and hash, naming every difference', () => {
    expect(compareExportIdentity(REGISTERED, REGISTERED)).toEqual([])
    expect(compareExportIdentity({ ...REGISTERED, sha256: FIXTURE_SHA.toUpperCase() }, REGISTERED)).toEqual([])
    expect(compareExportIdentity({ fileName: 'renamed.json', bytes: 1, sha256: OTHER_SHA }, REGISTERED)).toEqual([
      `Export SHA-256 ${OTHER_SHA} is not the registered ${FIXTURE_SHA}.`, 'Export length 1 is not the registered 12345 bytes.', 'Export file name renamed.json is not the registered export-fixture.json.',
    ])
  })
})

describe('formal run gate (parent start and child)', () => {
  const start = (overrides: Partial<Parameters<typeof formalStartIssues>[0]> = {}) => formalStartIssues({
    registration: ENABLED_GATE, workingTreeClean: true, uncommittedBenchmarkCode: false, allowUncommitted: false, overrideOptions: [],
    cliExpectedSha256: FIXTURE_SHA, registeredExport: { identity: REGISTERED, issues: [] }, actualExport: REGISTERED, ...overrides,
  })

  it('refuses while the registration is disabled or incomplete', () => {
    expect(formalRunGateIssues({ formalRunEnabled: false, unresolvedItems: [] })).toEqual(['A formal run is not enabled in this protocol version (ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled is false).'])
    expect(formalRunGateIssues({ formalRunEnabled: true, unresolvedItems: ['nodeBudget is not registered.'] })).toEqual(['The Phase B-2B pre-registration is incomplete: nodeBudget is not registered.'])
    expect(formalRunGateIssues(ENABLED_GATE)).toEqual([])
    // Phase B-2A: the real registration never lets a formal run start.
    expect(B2A_GATE.formalRunEnabled).toBe(false)
    expect(start({ registration: B2A_GATE })[0]).toMatch(/not enabled/)
  })

  it('lets a formal run start only with a clean committed tree, no override, and the Export verified twice against the registered identity', () => {
    expect(start()).toEqual([])
    expect(start({ cliExpectedSha256: FIXTURE_SHA.toUpperCase() })).toEqual([])
    expect(start({ workingTreeClean: false })).toEqual(['A formal run needs a clean, committed Working Tree (no --allow-uncommitted).'])
    expect(start({ uncommittedBenchmarkCode: true })).toHaveLength(1)
    expect(start({ allowUncommitted: true })).toHaveLength(1)
    expect(start({ overrideOptions: ['--node-budget'] })).toEqual(['A formal run takes its conditions from the registration only; remove --node-budget.'])
    expect(start({ cliExpectedSha256: null })).toEqual(['A formal run requires --expected-export-sha256 naming the registered Export SHA-256.'])
    expect(start({ cliExpectedSha256: OTHER_SHA })).toEqual([`--expected-export-sha256 ${OTHER_SHA} is not the registered Export SHA-256 ${FIXTURE_SHA}.`])
    expect(start({ actualExport: { ...REGISTERED, sha256: OTHER_SHA } })).toEqual([`Export SHA-256 ${OTHER_SHA} is not the registered ${FIXTURE_SHA}.`])
    expect(start({ actualExport: { ...REGISTERED, bytes: 1 } })).toEqual(['Export length 1 is not the registered 12345 bytes.'])
    expect(start({ registeredExport: { identity: null, issues: ['registered-export-sha256: expected exactly one line, found 0.'] } })).toEqual([
      'The registered Export identity could not be read from the committed Research document: registered-export-sha256: expected exactly one line, found 0.',
    ])
    // A command-line hash that matches a different actual Export never substitutes for the registered identity.
    expect(start({ cliExpectedSha256: OTHER_SHA, actualExport: { ...REGISTERED, sha256: OTHER_SHA } })).toHaveLength(2)
  })

  it('makes a child re-apply the gate, the registered identity from HEAD, the registered conditions and its own Repository state, so a task alone cannot bypass the parent', () => {
    const registered = registeredFormalConditions()
    if ('issues' in registered) throw new Error('This test needs a complete registration.')
    const HEAD = 'c'.repeat(40)
    const cleanRepository = { taskHeadSha: HEAD, currentHeadSha: HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false }
    const child = (overrides: Partial<Parameters<typeof formalChildGateIssues>[0]> = {}) => formalChildGateIssues({
      registration: ENABLED_GATE, taskMode: 'formal', taskRegisteredExport: REGISTERED, registeredExportFromHead: { identity: REGISTERED, issues: [] }, actualExport: REGISTERED,
      taskConditions: registered.conditions, taskWindowLadder: registered.windowLadder, taskEnvelope: registered.envelope, repository: cleanRepository, ...overrides,
    })
    expect(child()).toEqual([])
    // The child observes the Repository itself: a dirty tree, uncommitted code, a missing or different measurement HEAD each refuse before any calculation.
    expect(child({ repository: { ...cleanRepository, workingTreeClean: false } })).toEqual(['The child observed a Working Tree that is not clean.'])
    expect(child({ repository: { ...cleanRepository, uncommittedBenchmarkCode: true } })).toEqual(['The child observed uncommitted benchmark code.'])
    expect(child({ repository: { ...cleanRepository, taskHeadSha: null } })).toEqual(['The task names no measurement HEAD.'])
    expect(child({ repository: { ...cleanRepository, taskHeadSha: 'not-a-sha' } })).toEqual(['The task names no measurement HEAD.'])
    expect(child({ repository: { ...cleanRepository, currentHeadSha: 'd'.repeat(40) } })).toEqual([`The child runs at HEAD ${'d'.repeat(40)}, not the task's measurement HEAD ${HEAD}.`])
    // A task that claims a clean tree does not matter: only the child's own observation enters the gate.
    expect(child({ repository: { ...cleanRepository, workingTreeClean: false, uncommittedBenchmarkCode: true } })).toHaveLength(2)
    expect(child({ taskMode: 'smoke' })).toEqual(['A formal child gate was asked for a smoke task.'])
    expect(child({ registration: B2A_GATE })[0]).toMatch(/not enabled/)
    expect(child({ taskConditions: { ...registered.conditions, nodeBudget: registered.conditions.nodeBudget + 1 } })).toEqual(['The task conditions are not the registered conditions.'])
    expect(child({ taskWindowLadder: [...registered.windowLadder, registered.windowLadder[0]] })).toEqual(['The task window ladder is not the registered ladder.'])
    expect(child({ taskEnvelope: { ...registered.envelope, repeat: 1 } })).toEqual(['The task envelope is not the registered envelope.'])
    expect(child({ taskRegisteredExport: null })).toEqual(['The task does not carry the registered Export identity read from HEAD.'])
    expect(child({ taskRegisteredExport: { ...REGISTERED, sha256: OTHER_SHA } })).toEqual(['The task does not carry the registered Export identity read from HEAD.'])
    expect(child({ actualExport: { ...REGISTERED, sha256: OTHER_SHA } })).toEqual([`Export SHA-256 ${OTHER_SHA} is not the registered ${FIXTURE_SHA}.`])
    expect(child({ registeredExportFromHead: { identity: null, issues: ['git show failed'] } })).toEqual(['The child could not read the registered Export identity from HEAD: git show failed'])
  })
})

describe('judgeFormalValidity', () => {
  const run = (id: string, overrides: Partial<FormalValidityInput['assignmentRuns'][number]> = {}): FormalValidityInput['assignmentRuns'][number] =>
    ({ id, status: 'measured', reason: null, semanticSha256: 'same', integrityIssues: [], recordConsistent: true, ...overrides })
  const valid = (): FormalValidityInput => ({
    mode: 'formal', registration: { ...ENABLED_GATE, reproducibilityRuns: 2 }, tree: { workingTreeClean: true, uncommittedBenchmarkCode: false, smokeOverrides: [] },
    exportVerification: { registeredMatched: true, cliMatched: true }, assignmentRuns: [run('assignment-1'), run('assignment-2')], determinism: { identical: true },
    rootLowerBound: { status: 'found', reason: null, recordConsistent: true }, comparison: { consistency: 'consistent' }, integrityIssues: [],
  })
  const judge = (mutate: (input: FormalValidityInput) => void) => { const input = valid(); mutate(input); return judgeFormalValidity(input) }

  it('is not_applicable for a smoke run whatever its content', () => {
    const result = judge(input => { input.mode = 'smoke'; input.assignmentRuns = [run('assignment-1', { status: 'unmeasured', reason: 'timeout' })]; input.determinism.identical = null })
    expect(result).toMatchObject({ status: 'not_applicable', issues: [], checks: { reproducibility: null, registrationGate: null } })
    expect(result.checks.rootLowerBoundStage).toEqual({ requested: true, executed: true, status: 'found', provenBound: 'exact_minimum', reason: null, recordConsistent: true })
  })

  it('is valid only when every formal condition holds', () => {
    const result = judgeFormalValidity(valid())
    expect(result.status).toBe('valid')
    expect(result.issues).toEqual([])
    expect(result.checks).toMatchObject({ registrationGate: true, committedCleanTree: true, noOverrides: true, exportRegisteredMatched: true, comparisonConsistent: true,
      reproducibility: { requiredRuns: 2, runs: 2, measuredRuns: 2, allMeasured: true, noIntegrityIssues: true, recordsConsistent: true, semanticHashesEqual: true, identical: true } })
    // none_below_budget is an executed stage whose bound is "at least the budget", not an exact minimum; still valid.
    const atLeast = judge(input => { input.rootLowerBound = { status: 'none_below_budget', reason: null, recordConsistent: true } })
    expect(atLeast.status).toBe('valid')
    expect(atLeast.checks.rootLowerBoundStage).toMatchObject({ executed: true, provenBound: 'at_least_budget', recordConsistent: true })
    // The invariant valid => no aggregated integrity issue is visible in the checks.
    expect(result.checks).toMatchObject({ aggregateIntegrityIssueCount: 0, noAggregateIntegrityIssues: true })
  })

  it('is invalid when the root-bound child record disagrees with the parent, even though its report says found or none_below_budget', () => {
    for (const status of ['found', 'none_below_budget'] as const) {
      const result = judge(input => { input.rootLowerBound = { status, reason: null, recordConsistent: false } })
      expect(result.status).toBe('invalid')
      expect(result.issues).toEqual([`The root-bound child record disagrees with the parent (mode / protocol / Export); its ${status} is not a bound of this measurement.`])
      expect(result.checks.rootLowerBoundStage).toMatchObject({ executed: true, status, recordConsistent: false })
      // A measured report without a consistent record (null) is not a bound of this measurement either.
      expect(judge(input => { input.rootLowerBound = { status, reason: null, recordConsistent: null } }).status).toBe('invalid')
    }
    // The parent also records the disagreement as an aggregate integrity issue; both reasons are named, and the run stays invalid.
    const both = judge(input => {
      input.rootLowerBound = { status: 'found', reason: null, recordConsistent: false }
      input.integrityIssues = ['root-bound: the child record disagrees with the parent (mode / protocol / Export)']
    })
    expect(both.status).toBe('invalid')
    expect(both.issues).toHaveLength(2)
    expect(both.checks).toMatchObject({ aggregateIntegrityIssueCount: 1, noAggregateIntegrityIssues: false })
  })

  it('is invalid whenever the aggregated RESULT keeps an integrity issue, so valid implies an empty integrityIssues', () => {
    const result = judge(input => { input.integrityIssues = ['assignment-1: non-plain value at semantic.x'] })
    expect(result.status).toBe('invalid')
    expect(result.issues).toEqual(['The aggregated RESULT carries 1 integrity issue(s): assignment-1: non-plain value at semantic.x'])
    expect(result.checks).toMatchObject({ aggregateIntegrityIssueCount: 1, noAggregateIntegrityIssues: false })
    expect(judge(input => { input.integrityIssues = ['a', 'b'] }).issues[0]).toBe('The aggregated RESULT carries 2 integrity issue(s): a | b')
    // Every other check may pass: the aggregate issue alone keeps the run invalid, and a valid run always has zero.
    expect(judgeFormalValidity(valid()).checks.aggregateIntegrityIssueCount).toBe(0)
    // A smoke run records the count but judges nothing.
    const smoke = judge(input => { input.mode = 'smoke'; input.integrityIssues = ['x'] })
    expect(smoke).toMatchObject({ status: 'not_applicable', issues: [], checks: { aggregateIntegrityIssueCount: 1, noAggregateIntegrityIssues: null } })
  })

  it('is invalid when the registered number of assignment runs is not reached or one is unmeasured', () => {
    expect(judge(input => { input.assignmentRuns = [run('assignment-1')]; input.determinism.identical = null })).toMatchObject({ status: 'invalid' })
    for (const reason of ['timeout', 'out_of_memory', 'process_failure']) {
      const result = judge(input => { input.assignmentRuns = [run('assignment-1'), run('assignment-2', { status: 'unmeasured', reason, semanticSha256: null, recordConsistent: null })]; input.determinism.identical = null })
      expect(result.status).toBe('invalid')
      expect(result.issues).toContain(`Assignment run assignment-2 is unmeasured (${reason}).`)
      expect(result.checks.reproducibility).toMatchObject({ measuredRuns: 1, allMeasured: false, semanticHashesEqual: null, identical: null })
    }
    expect(judge(input => { input.assignmentRuns = [run('assignment-1'), run('assignment-2'), run('assignment-3')] }).issues).toContain('3 assignment run(s) were started; the registration requires 2.')
  })

  it('is invalid when the semantic records differ, carry an integrity issue, disagree with the parent, or determinism is unconfirmed', () => {
    expect(judge(input => { input.assignmentRuns = [run('assignment-1'), run('assignment-2', { semanticSha256: 'other' })]; input.determinism.identical = false }).issues).toContain('The semantic records of the assignment runs differ.')
    const integrity = judge(input => { input.assignmentRuns = [run('assignment-1', { integrityIssues: ['non-plain value at x'] }), run('assignment-2')] })
    expect(integrity.status).toBe('invalid')
    expect(integrity.issues).toContain('Assignment run assignment-1 has integrity issues: non-plain value at x')
    expect(judge(input => { input.assignmentRuns = [run('assignment-1'), run('assignment-2', { recordConsistent: false })] }).issues).toContain('Assignment run assignment-2 record disagrees with the parent (mode / protocol / Export).')
    const unconfirmed = judge(input => { input.determinism.identical = null })
    expect(unconfirmed.status).toBe('invalid')
    expect(unconfirmed.issues).toContain('determinism.identical is null; a formal measurement requires true.')
  })

  it('is invalid when the root lower bound stage did not execute, or the comparison is inconsistent', () => {
    for (const status of ['unmeasured', 'not_requested', 'not_applicable'] as const) {
      const result = judge(input => { input.rootLowerBound = { status, reason: status === 'unmeasured' ? 'timeout' : status === 'not_applicable' ? 'cross_satisfaction_possible' : null, recordConsistent: null } })
      expect(result.status).toBe('invalid')
      expect(result.checks.rootLowerBoundStage).toMatchObject({ executed: false, provenBound: 'none', status })
      expect(result.issues.some(issue => issue.startsWith('The root lower bound stage did not execute'))).toBe(true)
    }
    const inconsistent = judge(input => { input.comparison = { consistency: 'inconsistent' } })
    expect(inconsistent).toMatchObject({ status: 'invalid', checks: { comparisonConsistent: false } })
    // A not_comparable comparison (no candidate) is a legitimate formal outcome, not a validity failure.
    expect(judge(input => { input.comparison = { consistency: 'not_comparable' } }).status).toBe('valid')
  })

  it('is invalid when the gate, the tree, an override or the Export verification fails', () => {
    expect(judge(input => { input.registration = { ...input.registration, formalRunEnabled: false } }).issues[0]).toMatch(/not enabled/)
    expect(judge(input => { input.registration = { ...input.registration, unresolvedItems: ['x is not registered.'] } }).status).toBe('invalid')
    expect(judge(input => { input.tree = { ...input.tree, workingTreeClean: false } }).issues).toContain('The Working Tree was not clean and committed.')
    expect(judge(input => { input.tree = { ...input.tree, uncommittedBenchmarkCode: true } }).status).toBe('invalid')
    expect(judge(input => { input.tree = { ...input.tree, smokeOverrides: ['--repeat'] } }).issues).toContain('Command-line overrides were applied: --repeat.')
    for (const verification of [{ registeredMatched: false, cliMatched: true }, { registeredMatched: true, cliMatched: null }, { registeredMatched: null, cliMatched: null }]) {
      expect(judge(input => { input.exportVerification = verification }).issues).toContain('The Export was not verified against the registered identity and the command-line hash.')
    }
  })
})
