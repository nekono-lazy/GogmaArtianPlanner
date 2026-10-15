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
    expect(mechanics).toMatchObject({ planKind: 'mechanics', status: 'registered', approval: { state: 'not_required' }, criteria: { status: 'registered', items: [] } })
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

  it('commits the PR-5B measurement plan as a proposal: Owner approval pending, criteria proposed, the Research baseline verbatim', () => {
    expect(measurement).toMatchObject({ planKind: 'measurement', status: 'proposed', approval: { state: 'owner_approval_pending', approvedBy: null, approvedOn: null }, criteria: { status: 'proposed' } })
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
    expect(measurement.environments.map(environment => [environment.environmentId, environment.status])).toEqual([['pc-windows-chrome', 'planned'], ['android-chrome', 'optional'], ['iphone-safari', 'excluded']])
    expect(measurement.environments[0]!.slots).toHaveLength(16)
    expect(measurement.semanticComparison.groups.map(group => [group.groupId, group.requiredBrowserRuns, group.nodeReferenceRequired])).toEqual([
      ['real.w0-research', 4, true], ['real.w0-candidates-3', 2, true], ['real.w-half', 2, true], ['real.w-wide', 2, true],
    ])
  })

  it('refuses a plan that would let the judgement drift', () => {
    expect(variant(measurement, plan => { plan.status = 'registered' })).toEqual(expect.arrayContaining([expect.stringMatching(/Owner-approved/), expect.stringMatching(/criteria.status must equal/)]))
    expect(variant(measurement, plan => { plan.approval = { ...plan.approval, state: 'owner_approved' } })).toEqual(expect.arrayContaining([expect.stringMatching(/still pending/)]))
    expect(variant(measurement, plan => { plan.status = 'registered'; plan.criteria.status = 'registered'; plan.approval = { state: 'owner_approved', approvedBy: null, approvedOn: null, note: '' } }))
      .toEqual([expect.stringMatching(/names who approved it/)])
    expect(variant(measurement, plan => { plan.status = 'registered'; plan.criteria.status = 'registered'; plan.approval = { state: 'owner_approved', approvedBy: 'owner', approvedOn: '2026-10-16', note: '' } })).toEqual([])
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
  })

  it('binds a record to a slot only with the slot exactly, and never repairs one', () => {
    const spec = bloSlotSpecOfPlan(measurement, 'pc.timing.1')
    const input = measurement.inputs[0]!
    const identity = input.kind === 'export' ? { kind: 'export' as const, fileName: input.fileName, bytes: input.bytes, sha256: input.sha256 } : null
    const record = (overrides: Parameters<typeof fabricatedRecord>[1] = {}, slot = spec) => fabricatedRecord(slot, { input: { ...fabricatedRecord(slot).input, identity }, ...overrides })
    const run = (value: ReturnType<typeof record>, source = 'raw.json') => ({ record: value, source })
    const bound = bindBloRecordsToPlan(measurement, [run(record())])
    expect([...bound.bound.keys()]).toEqual(['pc.timing.1'])
    const reasons = (value: ReturnType<typeof record>) => bindBloRecordsToPlan(measurement, [run(value)]).unplanned.map(entry => entry.reason)
    expect(reasons(record({ slot: { ...record().slot, planned: false } }))).toEqual(['not_planned'])
    expect(reasons(record({ slot: { ...record().slot, slotId: 'pc.other' } }))).toEqual(['unknown_slot'])
    expect(reasons(record({ bounds: { ...spec.bounds, nodeBudget: 2001 } }))).toEqual(['bounds_mismatch'])
    expect(reasons(record({ slot: { ...record().slot, cancelTrigger: { stage: 'reach_table', delayMs: 1 } } }))).toEqual(['options_mismatch'])
    expect(reasons(record({ input: { ...record().input, identity: { kind: 'export', fileName: input.kind === 'export' ? input.fileName : '', bytes: 1, sha256: 'f'.repeat(64) } } }))).toEqual(['input_mismatch'])
    expect(reasons(record({ environment: { ...record().environment, crossOriginIsolated: true } }))).toEqual(['origin_mismatch'])
    expect(reasons(record({ environment: { ...record().environment, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/154.0' } }))).toEqual(['environment_mismatch'])
    const twice = bindBloRecordsToPlan(measurement, [run(record(), 'a.json'), run({ ...record(), recordId: 'second', startedAt: '2026-10-15T00:01:00.000Z' }, 'b.json')])
    expect(twice.bound.get('pc.timing.1')!.source).toBe('a.json')
    expect(twice.unplanned).toEqual([expect.objectContaining({ reason: 'duplicate_slot', source: 'b.json' })])
  })
})
