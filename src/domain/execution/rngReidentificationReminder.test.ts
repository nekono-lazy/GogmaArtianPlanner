import { describe, expect, it } from 'vitest'
import type { ExecutionHistory, PlanStep, ProductionPlan } from '../models/publicTypes'
import {
  deriveExecutionRngReidentificationReminder,
  executionReidentificationDestination,
} from './rngReidentificationReminder'

const PLAN_ID = 'plan.reminder' as ProductionPlan['id']

function step(id: string, operationType: PlanStep['operationType']): PlanStep {
  return { id, operationType } as PlanStep
}

const plan = {
  id: PLAN_ID,
  steps: [
    step('step.normal', 'create_normal_artian'),
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

describe('executionReidentificationDestination', () => {
  it('sends a Normal Artian creation to the Normal Counters and every Gogma / Skill operation to RNG Setup', () => {
    expect(executionReidentificationDestination({ operationType: 'create_normal_artian' })).toBe('normal_counters')
    for (const operationType of ['convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'] as const) {
      expect(executionReidentificationDestination({ operationType })).toBe('rng')
    }
  })
})

describe('deriveExecutionRngReidentificationReminder', () => {
  const derive = (planExecutionHistory: ExecutionHistory[], updatedAt: string | null) =>
    deriveExecutionRngReidentificationReminder({
      plan,
      planExecutionHistory,
      rngState: updatedAt === null ? null : { updatedAt },
    })

  it('reminds nothing without an actual_result_different record', () => {
    expect(derive([], '2026-09-16T00:00:00.000Z')).toEqual({ kind: 'none' })
    expect(derive([history('h.1', 'confirmed_expected', 'step.reset', DIVERGED_AT)], '2026-09-16T00:00:00.000Z'))
      .toEqual({ kind: 'none' })
  })

  it('reminds until the RngState is updated strictly after the record', () => {
    const records = [history('h.1', 'actual_result_different', 'step.reset', DIVERGED_AT)]
    expect(derive(records, '2026-09-17T00:00:09.999Z')).toEqual({
      kind: 'actual_result_different',
      executionHistoryId: 'h.1',
      planStepId: 'step.reset',
      destination: 'rng',
    })
    expect(derive(records, '2026-09-17T00:00:10.001Z')).toEqual({ kind: 'none' })
  })

  it('never takes an equal instant, a non-canonical timestamp or a missing RngState as resolved', () => {
    const records = [history('h.1', 'actual_result_different', 'step.reset', DIVERGED_AT)]
    expect(derive(records, DIVERGED_AT).kind).toBe('actual_result_different')
    // Later in wall-clock terms, but not a canonical UTC ISO string.
    expect(derive(records, '2026-09-18T09:00:00+09:00').kind).toBe('actual_result_different')
    expect(derive(records, 'not a date').kind).toBe('actual_result_different')
    expect(derive([history('h.1', 'actual_result_different', 'step.reset', 'broken')], '2026-09-18T00:00:00.000Z').kind)
      .toBe('actual_result_different')
    expect(derive(records, null).kind).toBe('actual_result_different')
  })

  it('finds the record even when a later record of another action is the latest one', () => {
    const records = [
      history('h.1', 'actual_result_different', 'step.normal', DIVERGED_AT),
      history('h.2', 'confirmed_expected', 'step.convert', '2026-09-17T00:00:20.000Z'),
    ]
    expect(derive(records, '2026-09-17T00:00:05.000Z')).toMatchObject({
      kind: 'actual_result_different',
      executionHistoryId: 'h.1',
      destination: 'normal_counters',
    })
  })

  it('judges only the latest actual_result_different, by the ExecutionHistory order authority', () => {
    const records = [
      history('h.2', 'actual_result_different', 'step.skills', '2026-09-17T00:00:30.000Z'),
      history('h.1', 'actual_result_different', 'step.normal', DIVERGED_AT),
    ]
    // Re-identified after the first record only: the later one is still unresolved.
    expect(derive(records, '2026-09-17T00:00:20.000Z')).toMatchObject({
      executionHistoryId: 'h.2',
      destination: 'rng',
    })
    expect(derive(records, '2026-09-17T00:00:31.000Z')).toEqual({ kind: 'none' })
  })

  it('ignores another Plan record and falls back to RNG Setup for an unknown Step', () => {
    expect(derive([history('h.1', 'actual_result_different', 'step.reset', DIVERGED_AT, 'plan.other' as ProductionPlan['id'])], '2026-09-16T00:00:00.000Z'))
      .toEqual({ kind: 'none' })
    expect(derive([history('h.1', 'actual_result_different', 'step.missing', DIVERGED_AT)], '2026-09-16T00:00:00.000Z'))
      .toMatchObject({ kind: 'actual_result_different', destination: 'rng' })
  })
})
