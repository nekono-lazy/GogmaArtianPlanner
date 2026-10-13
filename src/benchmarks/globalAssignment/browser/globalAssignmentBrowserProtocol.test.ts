import { describe, expect, it } from 'vitest'
import {
  buildCommitOf, GAB_RUN_REQUEST_KEYS, gabErrorName, gabProgressKey, gabRequestIssues, gabResponseIssues, gabRunRequestIssues, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION,
  isGabRequestType, isGabResponseType, type GabRunRequest,
} from './globalAssignmentBrowserProtocol'

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
    expect(gabResponseIssues({ type: 'gab_result', protocolVersion: V, requestId: 'r' })).toEqual(['gab_result needs result.'])
    expect(gabResponseIssues({ type: 'gab_progress', protocolVersion: 'x', event: {} })).toEqual(['protocolVersion must be global-assignment-browser:1 (got "x").', 'gab_progress needs a requestId.'])
    expect(gabResponseIssues({ type: 'gab_error', protocolVersion: V, requestId: null, error: {} })).toEqual([])
    expect(gabProgressKey({ kind: 'input', stage: 'json_parse', status: 'finished' })).toBe('input:json_parse:finished')
    expect(gabProgressKey({ kind: 'materialization', event: { kind: 'context', status: 'context', planningTargetCount: 0, reason: null } })).toBe('materialization:context')
    expect(gabProgressKey({ kind: 'verification', event: { stage: 'planner', status: 'started' } })).toBe('verification:planner:started')
    expect(gabProgressKey({ kind: 'evidence', stage: 'entry_set', status: 'started' })).toBe('evidence:entry_set:started')
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
