import { describe, expect, it } from 'vitest'
import type { PlanStep, PlanStepDebugInfo, RngAdvance } from '../../domain/models/publicTypes'
import { createValidProductionPlan } from '../../test/fixtures/domainData'
import {
  createPlanStepDebugView,
  debugNumberLabel,
  debugTextLabel,
  expectedPlanStateHashRows,
} from './planStepDebugPresentation'

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return { ...createValidProductionPlan().steps[0], ...overrides }
}

const advance = (overrides: Partial<RngAdvance> = {}): RngAdvance => ({
  gogmaCounterDelta: 0,
  skillCounterDelta: 0,
  normalCounterDelta: null,
  affectedNormalCounterId: null,
  ...overrides,
})

const debugInfo = (overrides: Partial<PlanStepDebugInfo> = {}): PlanStepDebugInfo => ({
  startBaseSeed: '51231782',
  startGogmaCounter: 120,
  endGogmaCounter: 121,
  startSkillCounter: 341,
  endSkillCounter: 341,
  startNormalCounter: null,
  endNormalCounter: null,
  plannerReason: 'reset_bonuses',
  ...overrides,
})

describe('debugNumberLabel', () => {
  it('keeps 0 as a recorded value and reports only null as missing', () => {
    expect(debugNumberLabel(0)).toBe('0')
    expect(debugNumberLabel(121)).toBe('121')
    expect(debugNumberLabel(null)).toBe('記録なし')
  })
})

describe('debugTextLabel', () => {
  it('reports a missing or empty identifier as 記録なし and never as "null"', () => {
    expect(debugTextLabel('weapon.bow:8')).toBe('weapon.bow:8')
    expect(debugTextLabel(null)).toBe('記録なし')
    expect(debugTextLabel('')).toBe('記録なし')
  })
})

describe('createPlanStepDebugView', () => {
  it('projects the persisted before / after pair and the persisted deltas', () => {
    const view = createPlanStepDebugView(
      step({
        debug: debugInfo(),
        rngAdvance: advance({ gogmaCounterDelta: 1 }),
      }),
    )

    expect(view.hasDebugInfo).toBe(true)
    expect(view.startBaseSeed).toBe('51231782')
    expect(view.plannerReason).toBe('reset_bonuses')
    expect(view.counters).toEqual([
      { stream: 'Gogma Counter', before: '120', after: '121', delta: '1' },
      { stream: 'Skill Counter', before: '341', after: '341', delta: '0' },
      { stream: 'Normal Counter', before: '記録なし', after: '記録なし', delta: '記録なし' },
    ])
    expect(view.affectedNormalCounterId).toBe('記録なし')
  })

  it('still reports the persisted RngAdvance when the Step recorded no PlanStepDebugInfo', () => {
    const view = createPlanStepDebugView(
      step({ debug: null, rngAdvance: advance({ skillCounterDelta: 1 }) }),
    )

    // Nothing is reconstructed from a Candidate or the current Counter: the
    // before / after pair stays missing while the persisted delta is shown.
    expect(view.hasDebugInfo).toBe(false)
    expect(view.plannerReason).toBeNull()
    expect(view.startBaseSeed).toBe('記録なし')
    expect(view.counters.map(({ before, after }) => `${before}/${after}`)).toEqual([
      '記録なし/記録なし',
      '記録なし/記録なし',
      '記録なし/記録なし',
    ])
    expect(view.counters[1].delta).toBe('1')
  })

  it('keeps a confirmed Normal creation Counter pair, its delta and its stream ID together', () => {
    const view = createPlanStepDebugView(
      step({
        debug: debugInfo({
          startGogmaCounter: 4,
          endGogmaCounter: 4,
          startSkillCounter: 9,
          endSkillCounter: 9,
          startNormalCounter: 12,
          endNormalCounter: 13,
          plannerReason: 'create_normal_artian',
        }),
        rngAdvance: advance({
          normalCounterDelta: 1,
          affectedNormalCounterId: 'weapon.bow:8',
        }),
      }),
    )

    expect(view.counters[2]).toEqual({
      stream: 'Normal Counter',
      before: '12',
      after: '13',
      delta: '1',
    })
    expect(view.affectedNormalCounterId).toBe('weapon.bow:8')
  })

  it('reports a conversion as Skill +1 and Gogma +0, never a PRNG internal step count', () => {
    const view = createPlanStepDebugView(
      step({
        operationType: 'convert_normal_to_gogma',
        debug: debugInfo({
          startGogmaCounter: 55,
          endGogmaCounter: 55,
          startSkillCounter: 341,
          endSkillCounter: 342,
          plannerReason: 'convert_normal_to_gogma',
        }),
        rngAdvance: advance({ gogmaCounterDelta: 0, skillCounterDelta: 1 }),
      }),
    )

    expect(view.counters[0]).toEqual({
      stream: 'Gogma Counter',
      before: '55',
      after: '55',
      delta: '0',
    })
    expect(view.counters[1]).toEqual({
      stream: 'Skill Counter',
      before: '341',
      after: '342',
      delta: '1',
    })
  })
})

describe('expectedPlanStateHashRows', () => {
  it('shows the persisted hashes as stored and never recomputes one', () => {
    expect(
      expectedPlanStateHashRows({
        rngStateHash: 'rng-hash',
        normalCountersHash: 'normal-hash',
        ownedWeaponsHash: 'owned-hash',
        targetExecutionStateHash: 'target-hash',
      }),
    ).toEqual([
      { label: 'rngStateHash', value: 'rng-hash' },
      { label: 'normalCountersHash', value: 'normal-hash' },
      { label: 'ownedWeaponsHash', value: 'owned-hash' },
      { label: 'targetExecutionStateHash', value: 'target-hash' },
    ])
  })

  it('reports a legacy state with no targetExecutionStateHash as 記録なし', () => {
    const rows = expectedPlanStateHashRows({
      rngStateHash: 'rng-hash',
      normalCountersHash: 'normal-hash',
      ownedWeaponsHash: 'owned-hash',
    })

    expect(rows[3]).toEqual({ label: 'targetExecutionStateHash', value: '記録なし' })
  })
})
