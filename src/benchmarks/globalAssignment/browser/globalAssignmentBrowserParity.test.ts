import { describe, expect, it } from 'vitest'
import {
  judgeGabCancelTrial, judgeGabEnvironmentParity, tallyGabOutcomes,
  type GabCancelTrialInput, type GabCancelTrialWorker, type GabEnvironmentParityInput, type GabOutcomeTallySlot, type GabParitySlot, type GabReferenceView,
  type GabVerificationParityView, type GabWorkerParityView,
} from './globalAssignmentBrowserJudgement'
import type { GabRunPurpose } from './globalAssignmentBrowserRunner'

/*
 * Issue #154 Production準備 P-2 (docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md 12.2 / 12.4 / 12.6 / 16.2): the semantic parity of
 * one environment, judged on the plan's comparison population only, the cancel trial of a cancel slot and the tally of how every slot
 * ended - three judgements that never feed one another. These cases use hand-made comparable values (the analysis tests drive the same
 * judgements from real synthetic records).
 */

const verification = (edit: Partial<GabVerificationParityView> = {}): GabVerificationParityView => ({
  semanticSha256: 'a'.repeat(64), outcomeKind: 'conditions_met', planningTargetCount: 43, materializedEntryCount: 43, entryFingerprint: 'fnv1a32:00000001',
  termination: { status: 'completed', reachedLimits: [], limits: { maxPlanSteps: 20_000 }, expandedStates: 1_809, completedTargetCount: 43, totalTargetCount: 43 },
  selectedEntryCount: 43, conflictCount: 0, rejectedCount: 0, resourceConflictCount: 0, warningCount: 0, fullPlannerRuns: 1, plannerPlanSteps: 1_766,
  planHash: 'fnv1a32:00000002', stepSemanticsHash: 'fnv1a32:00000003',
  traceReplay: { isValid: true, draftsTotal: 1_809, draftsPhysical: 1_766, draftsReserve: 43, mismatchCount: 0, counterPositionMismatchCount: 0 },
  physical: { physicalOperations: 1_766, planSteps: 1_766, nonPhysicalStepCount: 0, streamAdvanceSum: 1_766, objective: 1_766, executedHash: 'fnv1a32:00000004' },
  semanticKeyHashes: null, ...edit,
})
const firstView = (edit: Partial<GabVerificationParityView> = {}, materializationSha = 'b'.repeat(64)): GabWorkerParityView => ({
  phase0PlanningTargetCount: 43, entryFingerprint: 'fnv1a32:00000001', verification: verification(edit),
  materialization: {
    semanticSha256: materializationSha, planningTargetCount: 43, runOutcome: 'structural_candidates_materialized', verdict: 'all_materialized',
    candidate: { ordinal: 0, objective: 1_766, targetCount: 43, classification: 'all_materialized', materialized: 43, notAttempted: 0, materializedBy: { candidate_search_projected: 21, shape_constrained: 22, planner_alternative_reservation: 0 }, independentStops: { searchScaleGate: 0, shapeSearchBudget: 0, unsupported: 0, failClosed: 0 } },
    entryFingerprint: 'fnv1a32:00000001', semanticKeyHashes: null,
  },
})
const freshView = (edit: Partial<GabVerificationParityView> = {}): GabWorkerParityView => ({ phase0PlanningTargetCount: 43, materialization: null, entryFingerprint: 'fnv1a32:00000001', verification: verification(edit) })
const REFERENCE: GabReferenceView = { first: firstView(), fresh: freshView() }

type SlotRecord = NonNullable<GabParitySlot['record']>
const completedRecord = (edit: Partial<SlotRecord> = {}): SlotRecord => ({
  integrityIssueCount: 0, verdictKind: 'browser_nonformal_conditions_met', first: { settle: 'completed', view: firstView() }, fresh: { settle: 'completed', view: freshView() }, ...edit,
})
const cancelledRecord = (): SlotRecord => ({ integrityIssueCount: 0, verdictKind: 'unmeasured', first: { settle: 'cancelled', view: null }, fresh: { settle: 'not_run', view: null } })
const slot = (slotId: string, purpose: GabRunPurpose, record: SlotRecord | null): GabParitySlot => ({ slotId, purpose, record })

function input(slots: GabParitySlot[], edit: Partial<GabEnvironmentParityInput> = {}): GabEnvironmentParityInput {
  return { environmentId: 'pc', requiredComparisonRuns: slots.filter(entry => entry.purpose === 'timing' || entry.purpose === 'rerun').length, slots, premiseIssues: [], d1c: REFERENCE, node: REFERENCE, ...edit }
}

describe('P-2 semantic parity of one environment (the 11 required cases of design 16.2)', () => {
  it('1. two required comparison runs completed and identical -> parity_confirmed', () => {
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord())]))
    expect(parity).toMatchObject({ status: 'parity_confirmed', reasonCodes: [], mismatches: [], requiredComparisonRuns: 2, completedRequiredRuns: 2, comparedWorkerCount: 4, formal: false })
    expect(parity.slots.map(entry => [entry.slotId, entry.completed, entry.comparedWorkers])).toEqual([['pc.timing.1', true, ['first', 'fresh']], ['pc.rerun.1', true, ['first', 'fresh']]])
  })

  it('2. only one of the two required runs completed -> not_comparable (required_runs_incomplete)', () => {
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', cancelledRecord())]))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 1, mismatches: [] })
    expect(parity.slots[1]).toMatchObject({ slotId: 'pc.rerun.1', recorded: true, completed: false, firstSettle: 'cancelled', freshSettle: 'not_run' })
  })

  it('3. a deliberate cancel run beside complete required runs -> parity_confirmed (the cancel run is outside the population)', () => {
    const parity = judgeGabEnvironmentParity(input([
      slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord()), slot('pc.cancel.1', 'cancel', cancelledRecord()),
      // A cancel slot whose Workers both completed with other values is still never compared.
      slot('pc.cancel.2', 'cancel', completedRecord({ first: { settle: 'completed', view: firstView({ physical: null }) } })),
    ]))
    expect(parity).toMatchObject({ status: 'parity_confirmed', comparedWorkerCount: 4, mismatches: [] })
    expect(parity.slots.filter(entry => entry.purpose === 'cancel').map(entry => [entry.comparisonRole, entry.comparedWorkers])).toEqual([['excluded', []], ['excluded', []]])
  })

  it('4. only cancel runs exist -> not_comparable with no completed required run', () => {
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', null), slot('pc.rerun.1', 'rerun', null), slot('pc.cancel.1', 'cancel', cancelledRecord())]))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 0, comparedWorkerCount: 0 })
    // A plan with no required slot at all is not comparable either (and below the minimum).
    expect(judgeGabEnvironmentParity(input([slot('pc.cancel.1', 'cancel', cancelledRecord())]))).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete', 'planned_runs_below_minimum'] })
  })

  it('5. a semantic difference in a completed run -> parity_mismatch, naming the slot, the Worker, the part and the fields', () => {
    const differing = completedRecord({ fresh: { settle: 'completed', view: freshView({ semanticSha256: 'c'.repeat(64), physical: { ...verification().physical!, physicalOperations: 1_765 } }) } })
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', differing)]))
    expect(parity.status).toBe('parity_mismatch')
    const against = (kind: string) => parity.mismatches.filter(item => item.against === kind)
    expect(against('d1c_result')).toEqual([{ against: 'd1c_result', slotId: 'pc.rerun.1', worker: 'fresh', part: 'verification', fields: ['physical.physicalOperations', 'semanticSha256'], comparedWith: null }])
    expect(against('node_reference')).toEqual([{ against: 'node_reference', slotId: 'pc.rerun.1', worker: 'fresh', part: 'verification', fields: ['physical.physicalOperations', 'semanticSha256'], comparedWith: null }])
    expect(against('browser_internal')).toEqual([{ against: 'browser_internal', slotId: 'pc.rerun.1', worker: 'fresh', part: 'verification', fields: ['physical.physicalOperations', 'semanticSha256'], comparedWith: { slotId: 'pc.timing.1', worker: 'fresh' } }])
    // A materialization difference of a first Worker is reported as the materialization part.
    const materialization = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord({ first: { settle: 'completed', view: firstView({}, 'd'.repeat(64)) } })), slot('pc.rerun.1', 'rerun', completedRecord())]))
    expect(materialization.mismatches.find(item => item.against === 'd1c_result')).toMatchObject({ slotId: 'pc.timing.1', worker: 'first', part: 'materialization', fields: ['semanticSha256'] })
  })

  it('6. a confirmed difference is never hidden behind too few required runs', () => {
    const differing = completedRecord({ first: { settle: 'completed', view: firstView({ planHash: 'fnv1a32:0000ffff' }) }, fresh: { settle: 'cancelled', view: null }, verdictKind: 'unmeasured' })
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', differing), slot('pc.rerun.1', 'rerun', null)]))
    expect(parity).toMatchObject({ status: 'parity_mismatch', completedRequiredRuns: 0 })
    expect(parity.mismatches.map(item => [item.against, item.slotId, item.worker, item.part, item.fields])).toEqual([
      ['d1c_result', 'pc.timing.1', 'first', 'verification', ['planHash']], ['node_reference', 'pc.timing.1', 'first', 'verification', ['planHash']],
    ])
    // Even with no Node reference, the difference from the D-1C RESULT is a mismatch (design 12.4: step 3 precedes step 4).
    expect(judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', differing), slot('pc.rerun.1', 'rerun', null)], { node: null })).status).toBe('parity_mismatch')
  })

  it('7. no Node reference while the Browser agrees with D-1C -> not_comparable (node_reference_missing)', () => {
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord())], { node: null }))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['node_reference_missing'], completedRequiredRuns: 2, mismatches: [] })
  })

  it('8. an Export identity mismatch -> not_comparable, and no difference is called a mismatch', () => {
    const differing = completedRecord({ fresh: { settle: 'completed', view: freshView({ semanticSha256: 'c'.repeat(64) }) } })
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', differing), slot('pc.rerun.1', 'rerun', completedRecord())], {
      premiseIssues: [{ reason: 'export_identity_mismatch', source: 'pc.timing.1', detail: 'The logical run picked another Export.' }],
    }))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['export_identity_mismatch'], mismatches: [] })
    for (const reason of ['calculation_context_mismatch', 'conditions_mismatch', 'node_reference_head_mismatch'] as const) {
      expect(judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord())], { premiseIssues: [{ reason, source: 'x', detail: 'd' }] })).reasonCodes).toEqual([reason])
    }
  })

  it('9. a run with an integrity issue is never adopted: it does not count and its values are not compared', () => {
    const broken = completedRecord({ integrityIssueCount: 1, first: { settle: 'completed', view: firstView({ planHash: 'fnv1a32:0000ffff' }) } })
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', broken), slot('pc.rerun.1', 'rerun', completedRecord())]))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 1, mismatches: [] })
    expect(parity.slots[0]).toMatchObject({ completed: false, comparedWorkers: [], integrityIssueCount: 1 })
  })

  it('10. the tally of cancels, timeouts, Worker errors and page losses is independent of the parity', () => {
    const tallySlots: GabOutcomeTallySlot[] = [
      { slotId: 'pc.timing.1', purpose: 'timing', external: null, record: { firstSettle: 'completed', freshSettle: 'completed', interrupted: false, ignoredResultAfterCancel: { first: false, fresh: false } } },
      { slotId: 'pc.rerun.1', purpose: 'rerun', external: null, record: { firstSettle: 'timeout', freshSettle: 'not_run', interrupted: false, ignoredResultAfterCancel: { first: false, fresh: false } } },
      { slotId: 'pc.cancel.1', purpose: 'cancel', external: null, record: { firstSettle: 'cancelled', freshSettle: 'not_run', interrupted: false, ignoredResultAfterCancel: { first: true, fresh: false } } },
      { slotId: 'pc.cancel.2', purpose: 'cancel', external: null, record: { firstSettle: 'cancelled_terminated', freshSettle: 'not_run', interrupted: true, ignoredResultAfterCancel: { first: false, fresh: false } } },
      { slotId: 'pc.responsiveness.1', purpose: 'responsiveness', external: null, record: { firstSettle: 'completed', freshSettle: 'worker_error', interrupted: false, ignoredResultAfterCancel: { first: false, fresh: false } } },
      { slotId: 'pc.memory.1', purpose: 'memory', external: 'page_lost', record: null },
    ]
    const tally = tallyGabOutcomes(tallySlots, [{ reason: 'not_planned' }, { reason: 'not_planned' }, { reason: 'duplicate_slot' }])
    expect(tally).toMatchObject({
      plannedSlots: 6, recordedSlots: 5, unrecordedSlots: ['pc.memory.1'], external: { page_lost: 1, out_of_memory: 0 }, ignoredResultAfterCancel: 1, interrupted: 1,
      unplannedRecords: { count: 3, reasonCounts: { not_planned: 2, duplicate_slot: 1 } },
    })
    expect(tally.bySettle.first).toMatchObject({ completed: 2, timeout: 1, cancelled: 1, cancelled_terminated: 1, worker_error: 0 })
    expect(tally.bySettle.fresh).toMatchObject({ completed: 1, not_run: 3, worker_error: 1 })
    expect(tally.incomplete.map(item => [item.slotId, item.firstSettle, item.freshSettle, item.external])).toEqual([
      ['pc.rerun.1', 'timeout', 'not_run', null], ['pc.responsiveness.1', 'completed', 'worker_error', null], ['pc.memory.1', null, null, 'page_lost'],
    ])
    // Whatever the parity of the same slots says, the tally is the same value (it never reads the parity).
    const before = JSON.stringify(tally)
    for (const node of [REFERENCE, null]) judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', cancelledRecord())], { node }))
    expect(JSON.stringify(tallyGabOutcomes(tallySlots, [{ reason: 'not_planned' }, { reason: 'not_planned' }, { reason: 'duplicate_slot' }]))).toBe(before)
  })

  it('11. the planned number decides: fewer than two planned required runs never confirm, and an additional run never stands in for a required one', () => {
    expect(judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord())]))).toMatchObject({ status: 'not_comparable', reasonCodes: ['planned_runs_below_minimum'], completedRequiredRuns: 1 })
    // The responsiveness and memory runs completed and agree, but the missing rerun stays missing.
    const parity = judgeGabEnvironmentParity(input([
      slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', null), slot('pc.responsiveness.1', 'responsiveness', completedRecord()), slot('pc.memory.1', 'memory', completedRecord()),
    ]))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 1, comparedWorkerCount: 6 })
    // A required number above the planned slots (a plan the plan validation refuses) is never met by fewer slots.
    expect(judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord())], { requiredComparisonRuns: 3 })).reasonCodes).toEqual(['required_runs_incomplete'])
  })
})

describe('P-2 semantic parity: additional runs, Browser-internal and reference differences', () => {
  it('compares an additional run only when both of its Workers completed, and reports its difference', () => {
    const halfMemory = completedRecord({ fresh: { settle: 'worker_error', view: null }, verdictKind: 'unmeasured' })
    const confirmed = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord()), slot('pc.memory.1', 'memory', halfMemory)]))
    expect(confirmed).toMatchObject({ status: 'parity_confirmed', comparedWorkerCount: 4 })
    expect(confirmed.slots[2]).toMatchObject({ comparisonRole: 'additional', completed: false, comparedWorkers: [] })
    const mismatch = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord()), slot('pc.responsiveness.1', 'responsiveness', completedRecord({ fresh: { settle: 'completed', view: freshView({ warningCount: 1 }) } }))]))
    expect(mismatch.status).toBe('parity_mismatch')
    expect(mismatch.mismatches.length).toBeGreaterThan(0)
    expect(mismatch.mismatches.every(item => item.slotId === 'pc.responsiveness.1' && item.worker === 'fresh' && item.fields.includes('warningCount'))).toBe(true)
  })

  it('reports a first / fresh difference inside one logical run as browser_internal', () => {
    // Both references say what the first Worker says; the fresh Worker of the same run differs from it.
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord({ fresh: { settle: 'completed', view: freshView({ selectedEntryCount: 42 }) } })), slot('pc.rerun.1', 'rerun', completedRecord())]))
    expect(parity.mismatches.filter(item => item.against === 'browser_internal')).toEqual([
      { against: 'browser_internal', slotId: 'pc.timing.1', worker: 'fresh', part: 'verification', fields: ['selectedEntryCount'], comparedWith: { slotId: 'pc.timing.1', worker: 'first' } },
      { against: 'browser_internal', slotId: 'pc.rerun.1', worker: 'fresh', part: 'verification', fields: ['selectedEntryCount'], comparedWith: { slotId: 'pc.timing.1', worker: 'fresh' } },
    ])
  })

  it('a Node reference that differs from the D-1C RESULT is reference_inconsistent (a finding of its own), never a Browser mismatch', () => {
    const node: GabReferenceView = { first: firstView({ physical: { ...verification().physical!, objective: 1_700 } }), fresh: freshView() }
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord())], { node }))
    expect(parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['reference_inconsistent'], mismatches: [] })
    expect(parity.referenceMismatches).toEqual([{ worker: 'first', part: 'verification', fields: ['physical.objective'] }])
  })

  it('compares the semantic key hashes only when both sides carry them', () => {
    const keyed = (hash: string): GabWorkerParityView => ({ ...firstView(), verification: verification({ semanticKeyHashes: { planner: hash, physical: 'fnv1a32:00000009' } }) })
    const node: GabReferenceView = { first: keyed('fnv1a32:00000008'), fresh: freshView() }
    const parity = judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord({ first: { settle: 'completed', view: keyed('fnv1a32:00000007') } })), slot('pc.rerun.1', 'rerun', completedRecord())], { node }))
    // Against D-1C (no key hashes) the values agree; against the Node reference the planner field differs.
    expect(parity.mismatches.filter(item => item.against !== 'browser_internal')).toEqual([{ against: 'node_reference', slotId: 'pc.timing.1', worker: 'first', part: 'verification', fields: ['semanticKeyHashes.planner'], comparedWith: null }])
  })
})

const worker = (edit: Partial<GabCancelTrialWorker> = {}): GabCancelTrialWorker => ({
  role: 'first', settle: 'cancelled', requestStarted: true, settledBy: 'gab_cancelled', resultAdopted: false, cancelRequested: true, errorCode: null,
  cancel: { source: 'trigger', acceptedAtMs: 1_000, ackMs: 5, settledMs: 9, ignoredResultAfterCancel: null }, stoppedAt: 'phase_a', via: 'cancel_point',
  audit: { settleCount: 1, adoptedResults: 0, cancelAccepted: true }, terminated: true, lateResponses: 0, ...edit,
})
const notRun = (role: 'first' | 'fresh'): GabCancelTrialWorker => worker({ role, settle: 'not_run', requestStarted: false, settledBy: null, cancelRequested: false, cancel: null, stoppedAt: null, via: null, audit: null, terminated: null })
const TRIGGER = { role: 'first' as const, onProgressKey: 'materialization:context', delayMs: 2_000 }
function trial(edit: Partial<GabCancelTrialInput> = {}, record: Partial<NonNullable<GabCancelTrialInput['record']>> = {}): GabCancelTrialInput {
  return {
    slotId: 'pc.cancel.1', plannedTrigger: TRIGGER, external: null, rerun: { slotId: 'pc.rerun.2', recorded: true, completed: true },
    record: { cancel: { source: 'trigger', phase: 'request_running', role: 'first', acceptedByRequest: 'gab.run-5.first', requestedAtMs: 3_000, triggered: { ...TRIGGER } }, first: worker(), fresh: notRun('fresh'), ...record },
    ...edit,
  }
}

describe('P-2 cancel trials (design 12.6)', () => {
  it('passes a cooperative stop, a dropped result (C2) and a grace terminate', () => {
    expect(judgeGabCancelTrial(trial())).toMatchObject({ status: 'cancel_passed', reasonCodes: [], settle: 'cancelled', settledBy: 'gab_cancelled', stoppedAt: 'phase_a', ackMs: 5, settledMs: 9, adoptedResults: 0, settleCount: 1, terminated: true, freshStarted: false })
    const dropped = judgeGabCancelTrial(trial({}, { first: worker({ settledBy: 'ignored_gab_result', stoppedAt: null, via: null, cancel: { source: 'trigger', acceptedAtMs: 1, ackMs: null, settledMs: 40, ignoredResultAfterCancel: { arrivedAfterCancelMs: 40 } } }) }))
    expect(dropped).toMatchObject({ status: 'cancel_passed', settledBy: 'ignored_gab_result', ignoredResultAfterCancel: true, adoptedResults: 0 })
    expect(judgeGabCancelTrial(trial({}, { first: worker({ settle: 'cancelled_terminated', settledBy: 'cancel_grace_terminate', stoppedAt: null, via: null }) }))).toMatchObject({ status: 'cancel_passed', settle: 'cancelled_terminated' })
    // A fresh-side cancel after a completed first Worker.
    const fresh = judgeGabCancelTrial(trial({ plannedTrigger: { ...TRIGGER, role: 'fresh' } }, {
      cancel: { source: 'trigger', phase: 'request_running', role: 'fresh', acceptedByRequest: 'gab.run-5.fresh', requestedAtMs: 9_000, triggered: { ...TRIGGER, role: 'fresh' } },
      first: worker({ settle: 'completed', settledBy: 'gab_result', resultAdopted: true, cancelRequested: false, cancel: null, audit: { settleCount: 1, adoptedResults: 1, cancelAccepted: false } }), fresh: worker({ role: 'fresh' }),
    }))
    expect(fresh).toMatchObject({ status: 'cancel_passed', cancelledRole: 'fresh', freshStarted: true })
  })

  it('fails an adopted result, a second settlement, a missing terminate, an error while cancelling, a fresh start and a re-run that did not complete', () => {
    const reasons = (input: GabCancelTrialInput) => { const result = judgeGabCancelTrial(input); expect(result.status).toBe('cancel_failed'); return result.reasonCodes }
    expect(reasons(trial({}, { first: worker({ settle: 'completed', settledBy: 'gab_result', resultAdopted: true, audit: { settleCount: 1, adoptedResults: 1, cancelAccepted: true } }) }))).toEqual(['result_adopted'])
    expect(reasons(trial({}, { first: worker({ audit: { settleCount: 2, adoptedResults: 0, cancelAccepted: true } }) }))).toEqual(['settle_count_not_one'])
    expect(reasons(trial({}, { first: worker({ terminated: false }) }))).toEqual(['worker_not_terminated'])
    expect(reasons(trial({}, { first: worker({ settle: 'worker_error', settledBy: 'native_error' }) }))).toEqual(['worker_error_during_cancel'])
    expect(reasons(trial({}, { first: worker({ settledBy: 'gab_error', errorCode: 'calculation_failed' }) }))).toEqual(['worker_reported_error_during_cancel'])
    expect(reasons(trial({}, { fresh: worker({ role: 'fresh' }) }))).toEqual(['fresh_started_after_cancel'])
    expect(reasons(trial({ rerun: { slotId: 'pc.rerun.2', recorded: true, completed: false } }))).toEqual(['rerun_not_completed'])
    expect(reasons(trial({ rerun: { slotId: 'pc.rerun.2', recorded: false, completed: false } }))).toEqual(['rerun_not_run'])
    expect(reasons(trial({}, { first: worker({ settle: 'page_left', settledBy: 'pagehide' }) }))).toEqual(['page_left_during_cancel'])
  })

  it('does not exercise a slot that never ran, a cancel that never fired, a cancel with no running request or one not from the planned trigger', () => {
    const notExercised = (input: GabCancelTrialInput) => { const result = judgeGabCancelTrial(input); expect(result.status).toBe('cancel_not_exercised'); return result.reasonCodes }
    expect(notExercised(trial({ record: null }))).toEqual(['slot_not_run'])
    expect(notExercised(trial({ record: null, external: 'page_lost' }))).toEqual(['record_lost_page_lost'])
    expect(notExercised(trial({}, { cancel: null }))).toEqual(['cancel_not_triggered'])
    expect(notExercised(trial({}, { cancel: { source: 'trigger', phase: 'after_request_settled', role: 'first', acceptedByRequest: null, requestedAtMs: 1, triggered: { ...TRIGGER } } }))).toEqual(['no_request_running'])
    expect(notExercised(trial({}, { cancel: { source: 'console', phase: 'request_running', role: 'first', acceptedByRequest: 'x', requestedAtMs: 1, triggered: null } }))).toEqual(['cancel_not_from_planned_trigger'])
    expect(notExercised(trial({}, { cancel: { source: 'trigger', phase: 'request_running', role: 'first', acceptedByRequest: 'x', requestedAtMs: 1, triggered: { ...TRIGGER, delayMs: 1 } } }))).toEqual(['cancel_not_from_planned_trigger'])
  })

  it('never changes the parity: a failed cancel trial beside complete required runs leaves parity_confirmed', () => {
    const failed = judgeGabCancelTrial(trial({}, { first: worker({ settle: 'completed', settledBy: 'gab_result', resultAdopted: true, audit: { settleCount: 1, adoptedResults: 1, cancelAccepted: true } }) }))
    expect(failed.status).toBe('cancel_failed')
    expect(judgeGabEnvironmentParity(input([slot('pc.timing.1', 'timing', completedRecord()), slot('pc.rerun.1', 'rerun', completedRecord()), slot('pc.cancel.1', 'cancel', completedRecord())])).status).toBe('parity_confirmed')
  })
})
