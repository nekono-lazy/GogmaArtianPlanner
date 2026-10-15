import { describe, expect, it } from 'vitest'
import { MATERIALIZATION_D0C_PREREGISTRATION } from '../globalAssignment/materializationProtocol'
import mechanicsPlanText from '../../../docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md?raw'
import measurementPlanText from '../../../docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md?raw'
import {
  bindBloRecordsToPlan,
  bloMeasurementPlanIssues,
  bloSlotSpecOfPlan,
  extractBloMeasurementPlan,
  type BloMeasurementPlan,
} from './buildListOptimizationBenchmarkPlan'
import { BLO_SYNTHETIC_BOUNDS } from './buildListOptimizationBenchmarkSynthetic'
import { fabricatedRecord } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the committed plans (the mechanics plan, registered; the PR-5B measurement plan, proposed and Owner approval
 * pending) are valid and say what they claim, the validation refuses every plan that would let a judgement drift, and a record binds
 * to a slot only with the slot's exact options, input, bounds, origin and Browser.
 */

function planOf(text: string): BloMeasurementPlan {
  const extracted = extractBloMeasurementPlan(text)
  expect(extracted.issues).toEqual([])
  expect(bloMeasurementPlanIssues(extracted.plan)).toEqual([])
  return extracted.plan as BloMeasurementPlan
}

const mechanics = planOf(mechanicsPlanText)
const measurement = planOf(measurementPlanText)
const variant = (plan: BloMeasurementPlan, edit: (copy: BloMeasurementPlan) => void) => {
  const copy = structuredClone(plan)
  edit(copy)
  return bloMeasurementPlanIssues(copy)
}

describe('Build List optimization measurement plans (Issue #260 PR-5A)', () => {
  it('commits a registered mechanics plan whose synthetic bounds are the harness presets', () => {
    expect(mechanics).toMatchObject({ planKind: 'mechanics', series: 'pr5a-mech-r2', status: 'registered', approval: { state: 'not_required' }, criteria: { status: 'registered', items: [] } })
    // A harness check may run headless: its Browser mode is either.
    expect(mechanics.environments.map(environment => environment.browserMode)).toEqual(['either', 'either', 'either'])
    for (const set of mechanics.boundsSets) expect(set.bounds, set.boundsId).toEqual(BLO_SYNTHETIC_BOUNDS.find(entry => entry.boundsId === set.boundsId)!.bounds)
    const slots = mechanics.environments.flatMap(environment => environment.slots)
    expect(slots.map(slot => [slot.slotId, slot.expect?.outcome, slot.expect?.resultStatus ?? slot.expect?.failureKind ?? null])).toEqual([
      ['mech.optimized', 'completed', 'optimized'], ['mech.rerun', 'completed', 'optimized'], ['mech.unsupported', 'completed', 'unsupported'],
      ['mech.bound', 'completed', 'search_bound_reached'], ['mech.cancel.input-check', 'cancelled', null], ['mech.cancel.reach-table', 'cancelled', null],
      ['mech.rerun.after-cancel', 'completed', 'optimized'], ['mech.worker-error', 'failed', 'worker_error'], ['mech.invalid-result', 'failed', 'invalid_result'],
      ['mech.memory', 'completed', 'optimized'],
    ])
    expect(mechanics.inputs.every(input => input.kind === 'synthetic')).toBe(true)
  })

  it('commits the PR-5B measurement plan registered: Owner-approved on 2026-10-15, criteria registered, the Research baseline verbatim', () => {
    expect(measurement).toMatchObject({
      planKind: 'measurement', series: 'pr5b-r2', status: 'registered', approval: { state: 'owner_approved', approvedBy: 'Owner', approvedOn: '2026-10-15' },
      criteria: { status: 'registered' }, baseCommit: 'ae21b9a8878fe146d01891aac100f01d9d517f00',
    })
    // Series pr5b-r2: the Owner changed only the cancel → Worker detach bound (2,000 → 3,000 ms); every other bound is the r1 one.
    expect(measurement.criteria.items.map(item => [item.criterionId, item.comparator, item.threshold])).toEqual([
      ['semantic.identical', 'equals', true], ['computation.optimized', 'equals', 'optimized'], ['computation.all-targets', 'equals', true],
      ['performance.request-to-result.median', 'at_most', 40000], ['performance.request-to-result.max', 'at_most', 60000], ['performance.main-long-task', 'at_most', 1000],
      ['memory.worker-heap', 'at_most', 1073741824], ['memory.renderer-private', 'at_most', 2147483648], ['memory.main-retained', 'at_most', 268435456], ['memory.worker-released', 'equals', true],
      ['cancel.trial-passed', 'equals', true], ['cancel.settle', 'at_most', 100], ['cancel.worker-gone', 'at_most', 3000], ['cancel.no-result', 'equals', true],
      ['cancel.rerun', 'equals', true], ['cancel.rerun-identical', 'equals', true], ['lifecycle.storage-counts', 'equals', true],
    ])
    expect(measurement.environments[0]!.slots.filter(slot => slot.purpose === 'cancel').map(slot => slot.cancelTrigger)).toEqual([
      { stage: 'input_check', delayMs: 100 }, { stage: 'reach_table', delayMs: 1000 }, { stage: 'assignment_search', delayMs: 100 },
      { stage: 'route_generation', delayMs: 200 }, { stage: 'plan_verification', delayMs: 500 },
    ])
    expect(measurement.inputs).toEqual([expect.objectContaining({ kind: 'export', fileName: 'gogma-artian-planner-backup_20260927015837.json', bytes: 19424064, sha256: 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b' })])
    // The baseline is the Research D-0C registration verbatim (a comparison reference, never adopted by being the baseline).
    const baseline = measurement.boundsSets.find(set => set.role === 'baseline')!
    const registration = MATERIALIZATION_D0C_PREREGISTRATION
    expect(baseline.bounds).toEqual({
      window: registration.window.value, nodeBudget: registration.nodeBudget.value, mrvLookahead: registration.mrvLookahead.value,
      maxStructuralCandidates: registration.structuralCandidateLimit.value, maxPlannerVerifications: 1,
      routeGeneration: { projectedSearchScaleGate: registration.projectedSearchScaleGate.value, shapeSearchScaleGate: registration.shapeSearchScaleGate.value, shapeSearchBudget: registration.shapeSearchBudget.value },
    })
    expect(measurement.boundsSets.map(set => [set.boundsId, set.role, set.bounds.window])).toEqual([
      ['w0-research', 'baseline', { normal: 350, gogma: 500, skill: 1500 }], ['w0-candidates-3', 'comparison', { normal: 350, gogma: 500, skill: 1500 }],
      ['w-half', 'comparison', { normal: 175, gogma: 250, skill: 750 }], ['w-wide', 'comparison', { normal: 525, gogma: 750, skill: 2250 }],
    ])
    // The derived sets follow the registration formulas of their window.
    const wide = measurement.boundsSets.find(set => set.boundsId === 'w-wide')!.bounds
    expect(wide.routeGeneration.shapeSearchScaleGate).toEqual({ maxDepthUpperBound: 3000, maxGogmaGeneratedStateUpperBound: 3000 * 750 * 752, maxNormalForgeCount: 525, maxConversionWalkPositions: 2251 })
    expect(wide.routeGeneration.shapeSearchBudget).toEqual({ maxGogmaGeneratedStates: 50_000_000, maxSkillStates: 2250 * 2250, maxSettledWork: 100_000, maxPredictions: { normalArtian: 525, skill: 2251, gogmaReset: 750, gogmaKeep: 750 } })
    // PC only: Android optional, iPhone excluded (unverified, never unsupported).
    expect(measurement.environments.map(environment => [environment.environmentId, environment.status, environment.browserMode])).toEqual([['pc-windows-chrome', 'planned', 'headed'], ['android-chrome', 'optional', 'headed'], ['iphone-safari', 'excluded', 'headed']])
    // The storage criterion names what it checks: the storage counts, not the content.
    expect(measurement.criteria.items.find(item => item.axis === 'cancel_lifecycle' && item.metric === 'storage_counts_unchanged')!.description).toMatch(/Counts only: a same-count content change is not detected/)
    expect(measurement.environments[0]!.slots).toHaveLength(16)
    expect(measurement.semanticComparison.groups.map(group => [group.groupId, group.requiredBrowserRuns, group.nodeReferenceRequired])).toEqual([
      ['real.w0-research', 4, true], ['real.w0-candidates-3', 2, true], ['real.w-half', 2, true], ['real.w-wide', 2, true],
    ])
  })

  it('refuses a plan that would let the judgement drift', () => {
    // The approval states, from a proposed variant of the committed plan (whatever its committed status).
    const proposed = structuredClone(measurement)
    proposed.status = 'proposed'
    proposed.criteria.status = 'proposed'
    proposed.approval = { state: 'owner_approval_pending', approvedBy: null, approvedOn: null, note: '' }
    expect(bloMeasurementPlanIssues(proposed)).toEqual([])
    expect(variant(proposed, plan => { plan.status = 'registered' })).toEqual(expect.arrayContaining([expect.stringMatching(/Owner-approved/), expect.stringMatching(/criteria.status must equal/)]))
    expect(variant(proposed, plan => { plan.approval = { ...plan.approval, state: 'owner_approved' } })).toEqual(expect.arrayContaining([expect.stringMatching(/still pending/)]))
    expect(variant(proposed, plan => { plan.status = 'registered'; plan.criteria.status = 'registered'; plan.approval = { state: 'owner_approved', approvedBy: null, approvedOn: null, note: '' } }))
      .toEqual([expect.stringMatching(/names who approved it/)])
    expect(variant(proposed, plan => { plan.status = 'registered'; plan.criteria.status = 'registered'; plan.approval = { state: 'owner_approved', approvedBy: 'owner', approvedOn: '2026-10-16', note: '' } })).toEqual([])
    expect(variant(proposed, plan => { plan.criteria.status = 'registered' })).toEqual(expect.arrayContaining([expect.stringMatching(/criteria.status must equal/)]))
    expect(variant(measurement, plan => { plan.environments[0]!.slots[1]!.faultInjection = 'worker_error' })).toEqual(expect.arrayContaining([expect.stringMatching(/fault injection belongs to a lifecycle slot/)]))
    expect(variant(measurement, plan => { plan.environments[0]!.slots[12]!.origin = 'non_isolated' })).toEqual(expect.arrayContaining([expect.stringMatching(/isolated origin/)]))
    expect(variant(measurement, plan => { plan.environments[0]!.slots[3]!.cancelTrigger = null })).toEqual(expect.arrayContaining([expect.stringMatching(/cancel slot needs one/)]))
    expect(variant(measurement, plan => { plan.semanticComparison.groups[0]!.requiredBrowserRuns = 3 })).toEqual(expect.arrayContaining([expect.stringMatching(/require exactly that many runs/)]))
    expect(variant(measurement, plan => { plan.criteria.items[0]!.metric = 'unknown' as never })).toEqual(expect.arrayContaining([expect.stringMatching(/metric must be one of/)]))
    expect(variant(measurement, plan => { plan.criteria.items[3]!.axis = 'memory' })).toEqual(expect.arrayContaining([expect.stringMatching(/belongs to the performance axis/)]))
    expect(variant(measurement, plan => { delete (plan.boundsSets[0]!.bounds as unknown as Record<string, unknown>).nodeBudget })).toEqual(expect.arrayContaining([expect.stringMatching(/must name window, nodeBudget/)]))
    expect(variant(measurement, plan => { plan.environments[0]!.slots[0]!.order = 3 })).toEqual(expect.arrayContaining([expect.stringMatching(/slot orders must be exactly/)]))
    expect(variant(mechanics, plan => { plan.environments[0]!.slots[0]!.expect = null })).toEqual(expect.arrayContaining([expect.stringMatching(/expectation belongs to every mechanics slot/)]))
    expect(variant(mechanics, plan => { plan.approval = { ...plan.approval, state: 'owner_approval_pending' } })).toEqual(expect.arrayContaining([expect.stringMatching(/mechanics plan is registered/)]))
    expect(extractBloMeasurementPlan('no block').issues).toEqual([expect.stringMatching(/exactly one plan block/)])
    // The Browser mode: a measurement plan names headed or headless for every environment; only a mechanics plan accepts either.
    expect(variant(measurement, plan => { plan.environments[0]!.browserMode = 'either' })).toEqual(['environments[0].browserMode of a measurement plan must be headed or headless.'])
    expect(variant(measurement, plan => { delete (plan.environments[0] as unknown as Record<string, unknown>).browserMode })).toEqual(['environments[0].browserMode must be headed, headless or either.'])
    expect(variant(measurement, plan => { plan.environments[0]!.browserMode = 'visible' as never })).toEqual(['environments[0].browserMode must be headed, headless or either.'])
    expect(variant(measurement, plan => { plan.environments[0]!.browserMode = 'headless' })).toEqual([])
    expect(variant(mechanics, plan => { plan.environments[0]!.browserMode = 'headed' })).toEqual([])
  })

  it('makes every criterion say how it applies, and a criterion naming one bounds set a common gate (PR-5B)', () => {
    // The committed plan: the cancel trials (baseline only) are the common gate of every set; everything else is per set.
    expect(measurement.criteria.items.map(item => [item.criterionId, item.application, item.scope.boundsId])).toEqual([
      ['semantic.identical', 'per_bounds_set', null], ['computation.optimized', 'per_bounds_set', null], ['computation.all-targets', 'per_bounds_set', null],
      ['performance.request-to-result.median', 'per_bounds_set', null], ['performance.request-to-result.max', 'per_bounds_set', null], ['performance.main-long-task', 'per_bounds_set', null],
      ['memory.worker-heap', 'per_bounds_set', null], ['memory.renderer-private', 'per_bounds_set', null], ['memory.main-retained', 'per_bounds_set', null], ['memory.worker-released', 'per_bounds_set', null],
      ['cancel.trial-passed', 'common_gate', 'w0-research'], ['cancel.settle', 'common_gate', 'w0-research'], ['cancel.worker-gone', 'common_gate', 'w0-research'],
      ['cancel.no-result', 'common_gate', 'w0-research'], ['cancel.rerun', 'common_gate', 'w0-research'], ['cancel.rerun-identical', 'common_gate', 'w0-research'],
      ['lifecycle.storage-counts', 'per_bounds_set', null],
    ])
    expect(measurement.criteria.items.find(item => item.criterionId === 'cancel.rerun-identical')).toMatchObject({ metric: 'cancel_rerun_semantic_identical', comparator: 'equals', threshold: true })
    expect(measurement.criteria.items.find(item => item.criterionId === 'cancel.trial-passed')).toMatchObject({ metric: 'cancel_trial_passed', comparator: 'equals', threshold: true })
    const settle = measurement.criteria.items.findIndex(item => item.criterionId === 'cancel.settle')
    const storage = measurement.criteria.items.findIndex(item => item.criterionId === 'lifecycle.storage-counts')
    // A criterion that names one bounds set without being a common gate would judge that set alone: refused.
    expect(variant(measurement, plan => { plan.criteria.items[settle]!.application = 'per_bounds_set' })).toEqual([expect.stringMatching(/a criterion naming one bounds set is a common gate/)])
    // A common gate names the set of its evidence.
    expect(variant(measurement, plan => { plan.criteria.items[storage]!.application = 'common_gate' })).toEqual([expect.stringMatching(/a common gate names the bounds set of its evidence/)])
    expect(variant(measurement, plan => { delete (plan.criteria.items[0] as unknown as Record<string, unknown>).application })).toEqual(['criteria.items[0].application must be per_bounds_set or common_gate.'])
    expect(variant(measurement, plan => { plan.criteria.items[0]!.application = 'shared' as never })).toEqual(['criteria.items[0].application must be per_bounds_set or common_gate.'])
    // A common gate on another baseline / comparison set is a valid plan; on a synthetic set it is not.
    expect(variant(measurement, plan => { plan.criteria.items[settle]!.scope.boundsId = 'w-half' })).toEqual([])
    expect(variant(mechanics, plan => {
      plan.criteria.items = [{ ...structuredClone(measurement.criteria.items[settle]!), scope: { inputId: null, boundsId: plan.boundsSets[0]!.boundsId, purposes: ['cancel'] } }]
    })).toEqual([expect.stringMatching(/a common gate reads a baseline or comparison bounds set/)])
  })

  it('binds a record to a slot only with the slot exactly, and never repairs one', () => {
    const spec = bloSlotSpecOfPlan(measurement, 'pc.timing.1')
    const input = measurement.inputs[0]!
    const identity = input.kind === 'export' ? { kind: 'export' as const, fileName: input.fileName, bytes: input.bytes, sha256: input.sha256 } : null
    const record = (overrides: Parameters<typeof fabricatedRecord>[1] = {}, slot = spec) => fabricatedRecord(slot, { input: { ...fabricatedRecord(slot).input, identity }, ...overrides })
    const run = (value: ReturnType<typeof record>, source = 'raw.json') => ({ record: value, source })
    // The driver saved the slot's record in raw.json, in a headed Browser (the plan's mode).
    const driver = { mode: 'headed' as const, slots: [{ slotId: 'pc.timing.1', sessionId: 's1-non_isolated', pageIndex: 1, outcome: 'record_saved' as const, rawFile: 'raw.json' }] }
    const bound = bindBloRecordsToPlan(measurement, [run(record())], driver)
    expect([...bound.bound.keys()]).toEqual(['pc.timing.1'])
    const reasons = (value: ReturnType<typeof record>, context: Parameters<typeof bindBloRecordsToPlan>[2] = driver) => bindBloRecordsToPlan(measurement, [run(value)], context).unplanned.map(entry => entry.reason)
    expect(reasons(record({ slot: { ...record().slot, planned: false } }))).toEqual(['not_planned'])
    expect(reasons(record({ slot: { ...record().slot, slotId: 'pc.other' } }))).toEqual(['unknown_slot'])
    expect(reasons(record({ bounds: { ...spec.bounds, nodeBudget: 2001 } }))).toEqual(['bounds_mismatch'])
    expect(reasons(record({ slot: { ...record().slot, cancelTrigger: { stage: 'reach_table', delayMs: 1 } } }))).toEqual(['options_mismatch'])
    expect(reasons(record({ input: { ...record().input, identity: { kind: 'export', fileName: input.kind === 'export' ? input.fileName : '', bytes: 1, sha256: 'f'.repeat(64) } } }))).toEqual(['input_mismatch'])
    expect(reasons(record({ environment: { ...record().environment, crossOriginIsolated: true } }))).toEqual(['origin_mismatch'])
    expect(reasons(record({ environment: { ...record().environment, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/154.0' } }))).toEqual(['environment_mismatch'])
    // The Browser mode: the record's own Browser, then the driver's launch; without a driver record it cannot be verified.
    expect(reasons(record({ environment: { ...record().environment, userAgent: record().environment.userAgent!.replace('Chrome/', 'HeadlessChrome/') } }))).toEqual(['browser_mode_mismatch'])
    expect(reasons(record(), { ...driver, mode: 'headless' })).toEqual(['browser_mode_mismatch'])
    expect(reasons(record(), null)).toEqual(['browser_mode_unverified'])
    // The driver's own end of the slot and the raw file it saved decide too.
    expect(reasons(record(), { ...driver, slots: [{ ...driver.slots[0]!, outcome: 'driver_deadline', rawFile: null }] })).toEqual(['driver_outcome_not_saved'])
    expect(reasons(record(), { ...driver, slots: [{ ...driver.slots[0]!, rawFile: 'other.json' }] })).toEqual(['driver_source_mismatch'])
    const twice = bindBloRecordsToPlan(measurement, [run(record()), run({ ...record(), recordId: 'second', startedAt: '2026-10-15T00:01:00.000Z' })], driver)
    expect(twice.bound.get('pc.timing.1')!.record.recordId).toBe(record().recordId)
    expect(twice.unplanned).toEqual([expect.objectContaining({ reason: 'duplicate_slot', source: 'raw.json' })])
  })
})
