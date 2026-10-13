import { describe, expect, it } from 'vitest'
import {
  buildCommitOf, GAB_RUN_REQUEST_KEYS, gabErrorName, gabProgressKey, gabRequestIssues, gabResponseIssues, gabRunRequestIssues, gabWorkerResultIssues,
  GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, isGabRequestType, isGabResponseType, type GabRunRequest,
} from './globalAssignmentBrowserProtocol'
import { READY_ENVIRONMENT, syntheticWorkerResult } from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1 (design 7.3): the `gab_` protocol. A run request has exactly its protocol fields - no condition,
 * window, rule, budget, expected hash, D-0C / D-1C identity or RESULT - and the role decides whether an Entry set travels. A message of
 * another version or shape fails closed; nothing is guessed.
 */

const V = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
const valid: GabRunRequest = {
  type: 'gab_run', protocolVersion: V, requestId: 'gab.run-1.first', role: 'first', exportPayload: { kind: 'array_buffer', bytes: new ArrayBuffer(2) },
  exportIdentity: { fileName: 'export.json', bytes: 2, sha256: 'a'.repeat(64) }, entrySet: null, execution: { yieldMode: 'message-channel', heartbeatIntervalMs: 1_000, workerHeapSampling: false },
}

describe('P-1 protocol', () => {
  it('names version global-assignment-browser:1 and the gab_ message set', () => {
    expect(V).toBe('global-assignment-browser:1')
    for (const type of ['gab_run', 'gab_cancel', 'gab_ping']) expect(isGabRequestType({ type })).toBe(true)
    for (const type of ['gab_ready', 'gab_accepted', 'gab_progress', 'gab_heartbeat', 'gab_cancel_ack', 'gab_pong', 'gab_result', 'gab_cancelled', 'gab_error']) expect(isGabResponseType({ type })).toBe(true)
    expect(isGabRequestType({ type: 'pg2a_benchmark_run' })).toBe(false)
    expect(isGabResponseType({ type: 'gab_run' })).toBe(false)
  })

  it('accepts a run request with exactly its fields and nothing that could carry a condition or an expected value', () => {
    expect(gabRunRequestIssues(valid)).toEqual([])
    expect([...GAB_RUN_REQUEST_KEYS].sort()).toEqual(Object.keys(valid).sort())
    for (const field of ['conditions', 'window', 'materializationRule', 'verificationBudget', 'researchMaxPlanSteps', 'expectedSemanticSha256', 'expectedEntryFingerprint', 'd0cIdentity', 'result']) {
      expect(gabRunRequestIssues({ ...valid, [field]: 1 }).join(' '), field).toMatch(new RegExp(`fields outside the protocol: ${field}`))
    }
  })

  it('refuses a role / Entry set mismatch, a foreign version and malformed fields', () => {
    expect(gabRunRequestIssues({ ...valid, entrySet: { kind: 'global-assignment-d1a-entry-set' } })).toEqual(['A first request carries no Entry set (entrySet must be null).'])
    expect(gabRunRequestIssues({ ...valid, role: 'fresh' })).toEqual(['A fresh request needs the first Worker\'s Entry set (kind global-assignment-d1a-entry-set).'])
    expect(gabRunRequestIssues({ ...valid, role: 'fresh', entrySet: { kind: 'global-assignment-d1a-entry-set' } })).toEqual([])
    expect(gabRunRequestIssues({ ...valid, protocolVersion: 'global-assignment-browser:2' })).toEqual(['protocolVersion must be global-assignment-browser:1 (got "global-assignment-browser:2").'])
    expect(gabRunRequestIssues({ ...valid, exportPayload: { kind: 'blob', blob: {} } })).toEqual(['exportPayload.blob must be a Blob.'])
    expect(gabRunRequestIssues({ ...valid, exportPayload: { kind: 'blob', blob: new Blob(['x']) } })).toEqual([])
    const { execution: _execution, ...missing } = valid
    void _execution
    expect(gabRunRequestIssues(missing)).toContain('The run request has no execution.')
    expect(gabRunRequestIssues(null)).toEqual(['The run request is not an object.'])
    expect(gabRequestIssues({ type: 'gab_cancel', protocolVersion: V, requestId: 'gab.run-1.first' })).toEqual([])
    expect(gabRequestIssues({ type: 'gab_ping', protocolVersion: V, pingId: -1 })).toEqual(['pingId must be a non-negative integer.'])
  })

  it('validates response envelopes (version, request ID, body) and keys progress events stably', () => {
    expect(gabResponseIssues({ type: 'gab_cancel_ack', protocolVersion: V, requestId: 'r' })).toEqual([])
    expect(gabResponseIssues({ type: 'gab_result', protocolVersion: V, requestId: 'r' })).toEqual(['gab_result.result must be an object.'])
    expect(gabResponseIssues({ type: 'gab_progress', protocolVersion: 'x', event: {} })).toEqual([
      'protocolVersion must be global-assignment-browser:1 (got "x").', 'gab_progress needs a requestId.', 'gab_progress.event.kind undefined is unknown.', 'gab_progress.atMs must be a finite number.',
    ])
    expect(gabResponseIssues({ type: 'gab_progress', protocolVersion: V, requestId: 'r', event: { kind: 'evidence', stage: 'entry_set', status: 'finished' }, atMs: 3 })).toEqual([])
    expect(gabResponseIssues({ type: 'gab_error', protocolVersion: V, requestId: null, error: { code: 'invalid_request', stage: 'message', errorName: 'MessageError', message: 'x' } })).toEqual([])
    expect(gabResponseIssues({ type: 'gab_error', protocolVersion: V, requestId: null, error: {} })).toEqual([
      'gab_error.error.code must be a string.', 'gab_error.error.stage must be a string.', 'gab_error.error.errorName must be a string.', 'gab_error.error.message must be a string.',
    ])
    expect(gabResponseIssues({ type: 'gab_pong', protocolVersion: V, pingId: 1.5 })).toEqual(['gab_pong.pingId must be a non-negative integer.'])
    expect(gabResponseIssues({ type: 'gab_ready', protocolVersion: V, environment: READY_ENVIRONMENT })).toEqual([])
    expect(gabResponseIssues({ type: 'gab_ready', protocolVersion: V, environment: { ...READY_ENVIRONMENT, rngEngineVersion: 1, buildCommit: 2 } })).toEqual([
      'gab_ready.environment.rngEngineVersion must be a string.', 'gab_ready.environment.buildCommit must be a string or null.',
    ])
    expect(gabProgressKey({ kind: 'input', stage: 'json_parse', status: 'finished' })).toBe('input:json_parse:finished')
    expect(gabProgressKey({ kind: 'materialization', event: { kind: 'context', status: 'context', planningTargetCount: 0, reason: null } })).toBe('materialization:context')
    expect(gabProgressKey({ kind: 'verification', event: { stage: 'planner', status: 'started' } })).toBe('verification:planner:started')
    expect(gabProgressKey({ kind: 'evidence', stage: 'entry_set', status: 'started' })).toBe('evidence:entry_set:started')
  })

  it('PR #257 Required fix 2: validates a gab_result body before adoption - nullable versus required parts, and what each role carries', () => {
    const first = () => syntheticWorkerResult('gab.run-1.first') as unknown as Record<string, unknown>
    expect(gabWorkerResultIssues(first(), { requestId: 'gab.run-1.first', role: 'first' })).toEqual([])
    for (const value of [null, 1, 'x', [], undefined]) expect(gabWorkerResultIssues(value)).toEqual(['result must be an object.'])
    expect(gabWorkerResultIssues(first(), { requestId: 'gab.run-1.fresh', role: 'fresh' })).toContain('result is for first / gab.run-1.first, not fresh / gab.run-1.fresh.')
    // Nullable parts must still be present (null when absent); required ones must have their shape.
    const { entrySet: _entrySet, ...noEntrySetKey } = first()
    void _entrySet
    expect(gabWorkerResultIssues(noEntrySetKey)).toEqual(['result.entrySet is required (null when absent).'])
    expect(gabWorkerResultIssues({ ...first(), phase0: { planningTargetCount: -1, planningTargetIdsSorted: [1] } })).toEqual(['result.phase0 needs planningTargetCount and planningTargetIdsSorted (a string array or null).'])
    expect(gabWorkerResultIssues({ ...first(), formal: true })).toEqual(['result must be formal: false and oracleFreeExecution: true.'])
    expect(gabWorkerResultIssues({ ...first(), observed: { ...(first().observed as object), workerHeap: {} } })).toEqual(['result.observed.workerHeap must be an array or null.'])
    // A fresh result plans and never materializes: its verification, its Entry set view and its own Phase 0 are required.
    const verification = { semantic: { outcome: { kind: 'unmeasured', reason: 'cancelled' }, candidate: { planningTargetCount: 0 }, finalInput: null, planner: null, physical: null }, semanticSha256: 'e'.repeat(64), observed: { elapsedMs: { total: 1 } } }
    const fresh = { ...first(), requestId: 'gab.run-1.fresh', role: 'fresh', materialization: null, freshEntrySet: { entryFingerprint: 'x', entryCount: 0 }, verification, phase0: { planningTargetCount: 0, planningTargetIdsSorted: [] } }
    expect(gabWorkerResultIssues(fresh, { requestId: 'gab.run-1.fresh', role: 'fresh' })).toEqual([])
    expect(gabWorkerResultIssues({ ...fresh, verification: null, freshEntrySet: null })).toEqual(['a fresh result needs its verification record and freshEntrySet.'])
    expect(gabWorkerResultIssues({ ...fresh, phase0: { planningTargetCount: 0, planningTargetIdsSorted: null } })).toEqual(['a fresh result needs its own Phase 0 planning Target IDs.'])
    // A verification that met every condition must carry what the judgement reads of it.
    expect(gabWorkerResultIssues({ ...fresh, verification: { ...verification, semantic: { ...verification.semantic, outcome: { kind: 'conditions_met' } } } })).toEqual([
      'result.verification.semantic of conditions_met needs finalInput, planner and physical (physicalOperations, planSteps).',
    ])
    // A first result's Entry set must be a D-1A Entry set whose own fingerprint and count it repeats, and it needs its verification.
    const entrySet = { value: { kind: 'global-assignment-d1a-entry-set', candidate: {}, materializedEntries: [{}], entryFingerprint: 'fp' }, sha256: 'd'.repeat(64), entryFingerprint: 'fp', entryCount: 1 }
    expect(gabWorkerResultIssues({ ...first(), entrySet, verification })).toEqual([])
    expect(gabWorkerResultIssues({ ...first(), entrySet: { ...entrySet, entryFingerprint: 'other', entryCount: 2 }, verification })).toEqual([
      'result.entrySet.entryFingerprint is not the Entry set\'s own.', 'result.entrySet.entryCount is not the Entry set\'s own.',
    ])
    expect(gabWorkerResultIssues({ ...first(), entrySet })).toEqual(['a first result with an Entry set needs its verification record.'])
    // Bounded: the validator never walks a semantic record (a cyclic one is the main thread's re-hash failure, not a hang here).
    const cyclic: Record<string, unknown> = { outcome: { kind: 'scan_cancelled' }, input: {}, candidates: [], integrityIssues: [] }
    cyclic.self = cyclic
    expect(gabWorkerResultIssues({ ...first(), materialization: { ...(first().materialization as object), semantic: cyclic } })).toEqual([])
  })

  it('reads a build commit only from a 40-hex provenance value, and names any thrown value', () => {
    expect(buildCommitOf({ commit: 'a'.repeat(40), uncommittedBenchmarkCode: false })).toBe('a'.repeat(40))
    expect(buildCommitOf({ commit: 'abc' })).toBeNull()
    expect(buildCommitOf({ error: 'git failed' })).toBeNull()
    expect(buildCommitOf(null)).toBeNull()
    expect(gabErrorName(new RangeError('x'))).toBe('RangeError')
    expect(gabErrorName({ name: 'DataCloneError' })).toBe('DataCloneError')
    expect(gabErrorName('text')).toBe('string')
  })
})
