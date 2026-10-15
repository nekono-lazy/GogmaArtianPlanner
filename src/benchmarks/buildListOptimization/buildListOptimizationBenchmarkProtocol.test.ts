import { describe, expect, it } from 'vitest'
import { bloRunRecordIssues, bloSlotSpecIssues, readBloRecordExport } from './buildListOptimizationBenchmarkProtocol'
import { fabricatedRecord, testSlot } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the raw record protocol. A slot spec states every option; a record is consistent (a result exactly for a
 * completed run, a failure exactly for a failed one) and minimized (no file path, no UUID of the measured data).
 */

describe('Build List optimization Browser record protocol (Issue #260 PR-5A)', () => {
  it('accepts a complete slot spec and refuses a missing, extra or misplaced option', () => {
    expect(bloSlotSpecIssues(testSlot())).toEqual([])
    const { memory: _memory, ...withoutMemory } = testSlot()
    void _memory
    expect(bloSlotSpecIssues(withoutMemory)).toEqual(expect.arrayContaining(['slot.memory is required (null where off).']))
    expect(bloSlotSpecIssues({ ...testSlot(), windowOverride: 1 })).toEqual(['slot.windowOverride is not a slot field.'])
    expect(bloSlotSpecIssues(testSlot({ faultInjection: 'corrupt_result' }))).toEqual(['slot.faultInjection belongs to a lifecycle run only.'])
    expect(bloSlotSpecIssues(testSlot({ purpose: 'lifecycle', faultInjection: 'worker_error', cancelTrigger: { stage: 'reach_table', delayMs: 0 } }))).toEqual(['slot: a cancel trial injects no fault.'])
    expect(bloSlotSpecIssues(testSlot({ cancelTrigger: { stage: 'unknown' as never, delayMs: 0 } }))).toEqual(['slot.cancelTrigger must be { stage, delayMs } or null.'])
    expect(bloSlotSpecIssues(testSlot({ slotId: 'has space' }))).toEqual(['slot.slotId must be 1..64 characters of [A-Za-z0-9._:-].'])
  })

  it('accepts a consistent minimized record and refuses an inconsistent or disclosing one', () => {
    const record = fabricatedRecord(testSlot())
    expect(bloRunRecordIssues(record)).toEqual([])
    expect(bloRunRecordIssues({ ...record, result: null })).toEqual(['record: a result is recorded exactly for a completed run.'])
    expect(bloRunRecordIssues({ ...record, outcome: { ...record.outcome, status: 'failed' } })).toEqual(expect.arrayContaining(['record.outcome: a failure goes with status failed.']))
    expect(bloRunRecordIssues({ ...record, input: { ...record.input, identity: { kind: 'export', fileName: 'C:\\Users\\name\\export.json', bytes: 1, sha256: 'c'.repeat(64) } } }))
      .toEqual(expect.arrayContaining(['record.input.identity.fileName must be a base name (no path).', 'record must not contain a file path.']))
    expect(bloRunRecordIssues({ ...record, integrityIssues: ['plan 0f8fad5b-d9cb-469f-a165-70867728950e'] })).toEqual(['record must not contain a UUID.'])
    expect(bloRunRecordIssues({ ...record, result: { ...record.result!, semantic: { sha256: 'short', components: {} } } })).toEqual(['record.result.semantic must be { sha256, components }.'])
    expect(bloRunRecordIssues({ ...record, extra: true })).toEqual(['record.extra is not a record field.'])
    expect(readBloRecordExport({ kind: 'something-else', records: [] }).issues).toEqual(['The file is not a Build List optimization Browser record export.'])
    expect(readBloRecordExport({ kind: 'build-list-optimization-browser-records', recordProtocol: 'build-list-optimization-browser-record:1', exportedAt: '', records: [{ ...record, kind: 'x' }] }).issues)
      .toEqual(['records[0]: record.kind must be build-list-optimization-browser-run.'])
  })
})
