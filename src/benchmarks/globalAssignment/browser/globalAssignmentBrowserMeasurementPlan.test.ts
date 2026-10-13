import { beforeAll, describe, expect, it } from 'vitest'
import {
  bindGabRecordsToPlan, extractGabMeasurementPlan, GAB_MEASUREMENT_PLAN_BEGIN, GAB_MEASUREMENT_PLAN_END, gabMeasurementPlanIssues,
  type GabMeasurementPlan, type GabRecordedRun,
} from './globalAssignmentBrowserMeasurementPlan'
import type { GabLogicalRunRecord } from './globalAssignmentBrowserRunner'
import { p2DefaultSlots, p2PlanDocument, p2RecordRuns, p2Slot, p2SlotOptions, p2World, type P2World } from './globalAssignmentBrowserP2TestFixture'

/*
 * Issue #154 Production準備 P-2 (design 12.2 / 16.2): the measurement plan is fixed before the measurement and read from the measured
 * commit. Its validation refuses a plan whose required number is not its timing / rerun slots, a cancel slot without its trigger, a
 * memory reading off the isolated origin and other contradictions; the binding never re-labels, moves or substitutes a run.
 */

let world: P2World
beforeAll(async () => { world = await p2World() })

const runOf = (record: GabLogicalRunRecord, source = 'raw.json', pageUserAgent: string | null = null): GabRecordedRun => ({ record, source, pageUserAgent })

describe('P-2 measurement plan: document and validation', () => {
  it('extracts exactly one JSON block between the markers', () => {
    const plan = world.plan()
    expect(extractGabMeasurementPlan(p2PlanDocument(plan))).toEqual({ plan, issues: [] })
    expect(extractGabMeasurementPlan('no plan here').issues[0]).toMatch(/exactly one plan block/)
    expect(extractGabMeasurementPlan(`${p2PlanDocument(plan)}\n${GAB_MEASUREMENT_PLAN_BEGIN}\n${GAB_MEASUREMENT_PLAN_END}`).issues[0]).toMatch(/exactly one plan block/)
    expect(extractGabMeasurementPlan([GAB_MEASUREMENT_PLAN_BEGIN, '```json', '{"a":', '```', GAB_MEASUREMENT_PLAN_END].join('\n')).issues[0]).toMatch(/does not parse/)
    expect(extractGabMeasurementPlan([GAB_MEASUREMENT_PLAN_BEGIN, '```json', '{}', '```', '```json', '{}', '```', GAB_MEASUREMENT_PLAN_END].join('\n')).issues[0]).toMatch(/exactly one fenced json block/)
  })

  it('accepts the synthetic plan', () => {
    expect(gabMeasurementPlanIssues(world.plan())).toEqual([])
  })

  it('refuses a required number that is not the plan\'s timing / rerun slots (it can never be lowered after the fact)', () => {
    const plan = world.plan(undefined, value => { value.environments[0]!.requiredComparisonRuns = 2 })
    expect(gabMeasurementPlanIssues(plan).join(' ')).toMatch(/requiredComparisonRuns must be its number of timing \/ rerun slots \(3\)/)
  })

  it('refuses slot contradictions', () => {
    const issues = (slots: ReturnType<typeof p2DefaultSlots>) => gabMeasurementPlanIssues(world.plan(slots)).join(' ')
    const cancelWithoutTrigger = p2DefaultSlots()
    cancelWithoutTrigger[3]!.options.cancelTrigger = null
    expect(issues(cancelWithoutTrigger)).toMatch(/a cancel slot needs one/)
    const triggerOnTiming = p2DefaultSlots()
    triggerOnTiming[1]!.options.cancelTrigger = { role: 'first', onProgressKey: 'materialization:context', delayMs: 0 }
    expect(issues(triggerOnTiming)).toMatch(/A cancel trigger belongs to a cancel slot/i)
    const memoryNotIsolated = p2DefaultSlots()
    memoryNotIsolated[6]!.origin = 'non_isolated'
    expect(issues(memoryNotIsolated)).toMatch(/a memory slot runs on the isolated origin/)
    const pingOnTiming = p2DefaultSlots()
    pingOnTiming[1]!.options.ping = { timeoutMs: 1 }
    expect(issues(pingOnTiming)).toMatch(/chained ping belongs to a responsiveness slot/)
    const duplicate = p2DefaultSlots()
    duplicate[2]!.slotId = 't.timing.1'
    expect(issues(duplicate)).toMatch(/is not unique in the plan/)
    const badOrder = p2DefaultSlots()
    badOrder[0]!.order = 9
    expect(issues(badOrder)).toMatch(/the slot orders must be exactly 1\.\.7/)
    const rerunEarlier = p2DefaultSlots()
    rerunEarlier[3]!.rerunSlotId = 't.timing.1'
    expect(issues(rerunEarlier)).toMatch(/must be a later completing slot/)
    const rerunOnTiming = p2DefaultSlots()
    rerunOnTiming[1]!.rerunSlotId = 't.rerun.2'
    expect(issues(rerunOnTiming)).toMatch(/only a cancel slot names a re-run slot/)
    const extraOption = p2DefaultSlots()
    ;(extraOption[1]!.options as unknown as Record<string, unknown>).slot = { slotId: 'x' }
    expect(issues(extraOption)).toMatch(/options must have exactly/)
    const badEnvelope = p2DefaultSlots()
    badEnvelope[1]!.options.envelope.firstWallMs = 0
    expect(issues(badEnvelope)).toMatch(/envelope\.firstWallMs must be an integer/)
  })

  it('refuses an unavailable environment with slots or without a reason, and a verification budget other than 1', () => {
    expect(gabMeasurementPlanIssues(world.plan(undefined, plan => { plan.environments[1]!.slots = [p2Slot('phone.timing.1', 'timing', 1)] })).join(' ')).toMatch(/not_available environment has no slot/)
    expect(gabMeasurementPlanIssues(world.plan(undefined, plan => { plan.environments[1]!.unavailableReason = null })).join(' ')).toMatch(/needs its unavailableReason/)
    expect(gabMeasurementPlanIssues(world.plan(undefined, plan => { plan.conditions.verification.verificationBudget = 2 })).join(' ')).toMatch(/verificationBudget: 1/)
    expect(gabMeasurementPlanIssues(world.plan(undefined, plan => { plan.references.d1cPublicResult.path = '../outside.json' })).join(' ')).toMatch(/d1cPublicResult/)
  })
})

describe('P-2 measurement plan: binding recorded runs to slots', () => {
  let plan: GabMeasurementPlan
  let records: GabLogicalRunRecord[]
  beforeAll(async () => {
    plan = world.plan()
    const slots = p2DefaultSlots()
    records = (await p2RecordRuns(world, [
      { slot: slots[1]! },                                     // timing (bound)
      { slot: slots[2]!, planned: false },                     // rerun, marked unplanned
      { slot: slots[2]!, purpose: 'pilot' },                   // rerun slot re-labelled as a pilot
      { slot: slots[2]!, options: { ...p2SlotOptions('rerun'), lateResponseWaitMs: 5 } }, // other options than the plan's
      { slot: { ...slots[2]!, slotId: 't.unknown' } },         // a slot the plan does not have
      { slot: slots[2]! },                                     // another Browser (its user agent is changed below)
      { slot: slots[2]! },                                     // the rerun slot (bound: the first record that qualifies)
      { slot: slots[2]! },                                     // the same slot again (a duplicate never replaces it)
      { slot: slots[0]! },                                     // pilot after rerun (out of plan order)
    ])).records
    const phone = structuredClone(records[5]!)
    for (const worker of [phone.first, phone.fresh]) if (worker.environment !== null) worker.environment.userAgent = 'Mozilla/5.0 (Linux; Android 14) PhoneBrowser/1.0'
    records[5] = phone
  }, 120_000)

  it('binds only qualifying records, the earliest per slot, and records why the others are unplanned', () => {
    const runs = records.map((record, index) => runOf(record, `raw-${index}.json`))
    const binding = bindGabRecordsToPlan(plan, runs)
    expect([...binding.bound.keys()].sort()).toEqual(['t.pilot.1', 't.rerun.1', 't.timing.1'])
    expect(binding.bound.get('t.rerun.1')!.source).toBe('raw-6.json')
    expect(binding.unplanned.map(entry => [entry.slotId, entry.reason])).toEqual([
      ['t.rerun.1', 'not_planned'], ['t.rerun.1', 'purpose_mismatch'], ['t.rerun.1', 'options_mismatch'], ['t.unknown', 'unknown_slot'], ['t.rerun.1', 'environment_mismatch'], ['t.rerun.1', 'duplicate_slot'],
    ])
    expect(binding.order['pc-test']).toEqual({ followed: false, outOfOrderSlots: ['t.pilot.1'] })
    expect(binding.order['phone-test']).toBeUndefined()
  })

  it('refuses a record that ran on the other origin, and a record of an environment the plan did not plan', () => {
    const isolated = structuredClone(records[0]!)
    isolated.main.crossOriginIsolated = true
    expect(bindGabRecordsToPlan(plan, [runOf(isolated)]).unplanned.map(entry => entry.reason)).toEqual(['origin_mismatch'])
    const phonePlan = world.plan(undefined, value => { value.environments[0]!.status = 'not_available'; value.environments[0]!.unavailableReason = 'x' })
    expect(bindGabRecordsToPlan(phonePlan, [runOf(records[0]!)]).unplanned.map(entry => entry.reason)).toEqual(['environment_not_planned'])
  })
})
