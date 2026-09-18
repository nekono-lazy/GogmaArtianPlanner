import { describe, expect, it } from 'vitest'
import type {
  ExecutionHistory,
  NormalArtianCounter,
  PlanStep,
  ProductionPlan,
  RngState,
} from '../models/publicTypes'
import {
  deriveExecutionReidentificationReminder,
  executionReidentificationDestination,
  isNormalCounterIdentifiedAfter,
  isRngIdentifiedAfter,
} from './reidentificationReminder'

const PLAN_ID = 'plan.reminder' as ProductionPlan['id']
const COUNTER_A = 'weapon.dual_blades:8'
const COUNTER_B = 'weapon.great_sword:8'

function step(id: string, operationType: PlanStep['operationType'], affectedNormalCounterId: string | null = null): PlanStep {
  return {
    id,
    operationType,
    rngAdvance: { gogmaCounterDelta: 0, skillCounterDelta: 0, normalCounterDelta: null, affectedNormalCounterId },
  } as PlanStep
}

const plan = {
  id: PLAN_ID,
  steps: [
    step('step.normal', 'create_normal_artian', COUNTER_A),
    step('step.normal.unbound', 'create_normal_artian', null),
    step('step.convert', 'convert_normal_to_gogma'),
    step('step.reset', 'reset_bonuses'),
    step('step.keep', 'keep_bonuses'),
    step('step.skills', 'reset_skills'),
  ],
}

function history(
  id: string,
  action: ExecutionHistory['action'],
  planStepId: string,
  createdAt: string,
  planId = PLAN_ID,
): ExecutionHistory {
  return { id, planId, action, planStepId, createdAt } as ExecutionHistory
}

const DIVERGED_AT = '2026-09-17T00:00:10.000Z'
const BEFORE = '2026-09-17T00:00:09.999Z'
const AFTER = '2026-09-17T00:00:10.001Z'

type RngProvenance = Pick<RngState, 'baseSeed' | 'gogmaCounter' | 'skillCounter' | 'lastIdentifiedAt'>

function identifiedRng(lastIdentifiedAt: string | null, overrides: Partial<RngProvenance> = {}): RngProvenance {
  return {
    baseSeed: { value: '51231782', isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: 5, isConfirmed: true, source: 'observation' },
    skillCounter: { value: 341, isConfirmed: true, source: 'observation' },
    lastIdentifiedAt,
    ...overrides,
  }
}

type CounterProvenance = Pick<NormalArtianCounter, 'id' | 'counter' | 'isConfirmed' | 'lastIdentifiedAt'>

function identifiedCounter(id: string, lastIdentifiedAt: string | null, overrides: Partial<CounterProvenance> = {}): CounterProvenance {
  return { id, counter: 12, isConfirmed: true, lastIdentifiedAt, ...overrides }
}

describe('executionReidentificationDestination', () => {
  it('sends a Normal Artian creation to the Normal Counters and every Gogma / Skill operation to RNG Setup', () => {
    expect(executionReidentificationDestination({ operationType: 'create_normal_artian' })).toBe('normal_counters')
    for (const operationType of ['convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'] as const) {
      expect(executionReidentificationDestination({ operationType })).toBe('rng')
    }
  })
})

describe('isRngIdentifiedAfter', () => {
  it('requires an adoption strictly after the divergence, still held as adopted', () => {
    expect(isRngIdentifiedAfter(identifiedRng(AFTER), DIVERGED_AT)).toBe(true)
    // R1: identified before, whatever `updatedAt` later did.
    expect(isRngIdentifiedAfter(identifiedRng(BEFORE), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng(null), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(null, DIVERGED_AT)).toBe(false)
  })

  it('R6: never takes an equal instant or a non-canonical timestamp as resolved', () => {
    expect(isRngIdentifiedAfter(identifiedRng(DIVERGED_AT), DIVERGED_AT)).toBe(false)
    // Later in wall-clock terms, but not a canonical UTC ISO string.
    expect(isRngIdentifiedAfter(identifiedRng('2026-09-18T09:00:00+09:00'), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng('not a date'), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng(AFTER), 'broken')).toBe(false)
  })

  it('R2 / R5: a manual, unconfirmed or missing adopted value is no longer the identified state', () => {
    expect(isRngIdentifiedAfter(identifiedRng(AFTER, { gogmaCounter: { value: 9, isConfirmed: true, source: 'manual' } }), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng(AFTER, { baseSeed: { value: '1', isConfirmed: true, source: 'manual' } }), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng(AFTER, { skillCounter: { value: 341, isConfirmed: false, source: 'observation' } }), DIVERGED_AT)).toBe(false)
    expect(isRngIdentifiedAfter(identifiedRng(AFTER, { skillCounter: { value: null, isConfirmed: false, source: null } }), DIVERGED_AT)).toBe(false)
  })
})

describe('isNormalCounterIdentifiedAfter', () => {
  it('requires the named Counter to hold a unique Identification adopted after the divergence', () => {
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, AFTER), DIVERGED_AT)).toBe(true)
    // N1: identified before.
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, BEFORE), DIVERGED_AT)).toBe(false)
    // N4: a manual / Debug value carries no provenance.
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, null), DIVERGED_AT)).toBe(false)
    // N6: missing record.
    expect(isNormalCounterIdentifiedAfter(undefined, DIVERGED_AT)).toBe(false)
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, DIVERGED_AT), DIVERGED_AT)).toBe(false)
  })

  it('N5: an unconfirmed or empty identified value stays unresolved, because Search cannot use it', () => {
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, AFTER, { isConfirmed: false }), DIVERGED_AT)).toBe(false)
    expect(isNormalCounterIdentifiedAfter(identifiedCounter(COUNTER_A, AFTER, { counter: null, isConfirmed: false }), DIVERGED_AT)).toBe(false)
  })
})

describe('deriveExecutionReidentificationReminder', () => {
  const derive = (
    planExecutionHistory: ExecutionHistory[],
    rngState: RngProvenance | null,
    normalCounters: CounterProvenance[] = [],
  ) => deriveExecutionReidentificationReminder({ plan, planExecutionHistory, rngState, normalCounters })

  it('reminds nothing without an actual_result_different record', () => {
    expect(derive([], identifiedRng(null))).toEqual({ kind: 'none' })
    expect(derive([history('h.1', 'confirmed_expected', 'step.reset', DIVERGED_AT)], identifiedRng(null))).toEqual({ kind: 'none' })
    expect(derive([history('h.1', 'operation_uncertain', 'step.reset', DIVERGED_AT)], identifiedRng(null))).toEqual({ kind: 'none' })
  })

  it('judges a Gogma / Skill divergence against the RNG Identification adoption', () => {
    const records = [history('h.1', 'actual_result_different', 'step.reset', DIVERGED_AT)]
    expect(derive(records, identifiedRng(BEFORE))).toEqual({
      kind: 'actual_result_different',
      unresolved: [{ executionHistoryId: 'h.1', planStepId: 'step.reset', destination: 'rng' }],
    })
    expect(derive(records, identifiedRng(AFTER))).toEqual({ kind: 'none' })
    // A Normal Counter Identification never resolves an RNG divergence.
    expect(derive(records, identifiedRng(BEFORE), [identifiedCounter(COUNTER_A, AFTER)]).kind).toBe('actual_result_different')
  })

  it('judges a Normal creation divergence against the Counter the Step names only', () => {
    const records = [history('h.1', 'actual_result_different', 'step.normal', DIVERGED_AT)]
    const expected = {
      kind: 'actual_result_different',
      unresolved: [{ executionHistoryId: 'h.1', planStepId: 'step.normal', destination: 'normal_counters', normalCounterId: COUNTER_A }],
    }
    // N2: the right Counter, adopted after.
    expect(derive(records, identifiedRng(null), [identifiedCounter(COUNTER_A, AFTER)])).toEqual({ kind: 'none' })
    // N3: another weapon type's Counter.
    expect(derive(records, identifiedRng(null), [identifiedCounter(COUNTER_B, AFTER)])).toEqual(expected)
    // N1 / N6 / an RNG adoption instead.
    expect(derive(records, identifiedRng(null), [identifiedCounter(COUNTER_A, BEFORE)])).toEqual(expected)
    expect(derive(records, identifiedRng(null), [])).toEqual(expected)
    expect(derive(records, identifiedRng(AFTER), [])).toEqual(expected)
  })

  it('fails closed for a Normal creation that names no Counter and for a missing Step', () => {
    expect(derive([history('h.1', 'actual_result_different', 'step.normal.unbound', DIVERGED_AT)], identifiedRng(AFTER), [identifiedCounter(COUNTER_A, AFTER)]))
      .toEqual({
        kind: 'actual_result_different',
        unresolved: [{ executionHistoryId: 'h.1', planStepId: 'step.normal.unbound', destination: 'normal_counters', normalCounterId: null }],
      })
    expect(derive([history('h.1', 'actual_result_different', 'step.missing', DIVERGED_AT)], identifiedRng(AFTER), [identifiedCounter(COUNTER_A, AFTER)]))
      .toMatchObject({ kind: 'actual_result_different', unresolved: [{ destination: 'normal_counters', normalCounterId: null }] })
  })

  it('finds the record even when a later record of another action is the latest one', () => {
    const records = [
      history('h.1', 'actual_result_different', 'step.normal', DIVERGED_AT),
      history('h.2', 'confirmed_expected', 'step.convert', '2026-09-17T00:00:20.000Z'),
    ]
    expect(derive(records, identifiedRng(null))).toMatchObject({ kind: 'actual_result_different', unresolved: [{ executionHistoryId: 'h.1' }] })
  })

  it('keeps one unresolved record per stream, judging the latest of each stream', () => {
    const records = [
      history('h.2', 'actual_result_different', 'step.skills', '2026-09-17T00:00:30.000Z'),
      history('h.1', 'actual_result_different', 'step.normal', DIVERGED_AT),
      history('h.0', 'actual_result_different', 'step.normal', '2026-09-17T00:00:05.000Z'),
    ]
    // Nothing identified: both streams, Normal first.
    expect(derive(records, identifiedRng(null)).kind === 'actual_result_different' && derive(records, identifiedRng(null)))
      .toMatchObject({ unresolved: [{ executionHistoryId: 'h.1', destination: 'normal_counters' }, { executionHistoryId: 'h.2', destination: 'rng' }] })
    // The RNG adoption after h.2 resolves the RNG stream only.
    expect(derive(records, identifiedRng('2026-09-17T00:00:31.000Z')))
      .toMatchObject({ unresolved: [{ executionHistoryId: 'h.1', destination: 'normal_counters' }] })
    // A Counter adoption after h.1 (the latest of its stream) resolves h.0 with it.
    expect(derive(records, identifiedRng('2026-09-17T00:00:31.000Z'), [identifiedCounter(COUNTER_A, AFTER)])).toEqual({ kind: 'none' })
    // A Counter adoption between h.0 and h.1 resolves neither of the Normal records.
    expect(derive(records, identifiedRng('2026-09-17T00:00:31.000Z'), [identifiedCounter(COUNTER_A, '2026-09-17T00:00:07.000Z')]))
      .toMatchObject({ unresolved: [{ executionHistoryId: 'h.1' }] })
  })

  it('ignores another Plan record', () => {
    expect(derive([history('h.1', 'actual_result_different', 'step.reset', DIVERGED_AT, 'plan.other' as ProductionPlan['id'])], identifiedRng(null)))
      .toEqual({ kind: 'none' })
  })
})
