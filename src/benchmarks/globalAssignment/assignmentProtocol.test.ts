import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_B2A_BASE_MAIN, ASSIGNMENT_B2A_PROTOCOL_VERSION, ASSIGNMENT_B2B_PREREGISTRATION, assignmentB2bRegistrationIssues, findNonPlainJsonPaths,
  snapshotResourceAssignment, validateAssignmentResearchConditions, validateWindowLadder, type AssignmentResearchConditions, type RegisteredCondition,
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
})
