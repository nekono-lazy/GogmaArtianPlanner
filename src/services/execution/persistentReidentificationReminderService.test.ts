import { describe, expect, it } from 'vitest'
import type {
  ExecutionHistory,
  NormalArtianCounter,
  PlanStep,
  ProductionPlan,
  RngState,
} from '../../domain/models/publicTypes'
import { withDatabase } from '../../test/fixtures/executionRuntime'
import {
  aggregatePersistentReidentificationReminder,
  loadPersistentReidentificationReminder,
} from './persistentReidentificationReminderService'

/**
 * The global aggregation of `docs/PLANNER_SPEC.md` 16.15 「再同定を促す継続表示」
 * over every Plan. Resolution itself is the Domain helper's
 * (`reidentificationReminder.test.ts`); these cases cover only that every
 * Plan is judged, whatever its status, and that the unresolved streams are
 * merged for display without deciding anything.
 */

const COUNTER_A = 'weapon.dual_blades:8'
const COUNTER_B = 'weapon.great_sword:8'

function step(id: string, operationType: PlanStep['operationType'], affectedNormalCounterId: string | null = null): PlanStep {
  return {
    id,
    operationType,
    rngAdvance: { gogmaCounterDelta: 0, skillCounterDelta: 0, normalCounterDelta: null, affectedNormalCounterId },
  } as PlanStep
}

function plan(id: string, status: ProductionPlan['status'] = 'abandoned'): Pick<ProductionPlan, 'id' | 'steps' | 'status'> {
  return {
    id: id as ProductionPlan['id'],
    status,
    steps: [
      step(`${id}.normal.a`, 'create_normal_artian', COUNTER_A),
      step(`${id}.normal.b`, 'create_normal_artian', COUNTER_B),
      step(`${id}.normal.unbound`, 'create_normal_artian', null),
      step(`${id}.reset`, 'reset_bonuses'),
      step(`${id}.skills`, 'reset_skills'),
    ],
  }
}

function history(
  id: string,
  planId: string,
  planStepId: string,
  createdAt: string,
  action: ExecutionHistory['action'] = 'actual_result_different',
): ExecutionHistory {
  return { id, planId, action, planStepId, createdAt } as ExecutionHistory
}

const T1 = '2026-09-17T00:00:10.000Z'
const T2 = '2026-09-17T00:00:20.000Z'
const BEFORE_T1 = '2026-09-17T00:00:05.000Z'
const BETWEEN = '2026-09-17T00:00:15.000Z'
const AFTER_T2 = '2026-09-17T00:00:25.000Z'

type RngProvenance = Pick<RngState, 'baseSeed' | 'gogmaCounter' | 'skillCounter' | 'lastIdentifiedAt'>

function rng(lastIdentifiedAt: string | null): RngProvenance {
  return {
    baseSeed: { value: '51231782', isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: 5, isConfirmed: true, source: 'observation' },
    skillCounter: { value: 341, isConfirmed: true, source: 'observation' },
    lastIdentifiedAt,
  }
}

type CounterRow = Pick<NormalArtianCounter, 'id' | 'weaponTypeId' | 'counter' | 'isConfirmed' | 'lastIdentifiedAt'>

function counter(id: string, lastIdentifiedAt: string | null): CounterRow {
  return { id, weaponTypeId: id.split(':')[0], counter: 12, isConfirmed: true, lastIdentifiedAt }
}

const planA = plan('plan.a', 'abandoned')
const planB = plan('plan.b', 'completed')

describe('aggregatePersistentReidentificationReminder', () => {
  it('A1: one Plan with an unresolved Gogma / Skill divergence asks for the RNG Identification', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: [history('h.1', planA.id, 'plan.a.reset', T1)],
      rngState: rng(BEFORE_T1),
      normalCounters: [],
    })).toEqual({ kind: 'actual_result_different', rngRequired: true, normalCounters: [], hasUnresolvableNormalCounter: false })
  })

  it('A2: one Plan with an unresolved Normal creation divergence names that Counter with its current weapon type', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: [history('h.1', planA.id, 'plan.a.normal.a', T1)],
      rngState: rng(AFTER_T2),
      normalCounters: [counter(COUNTER_A, null)],
    })).toEqual({
      kind: 'actual_result_different',
      rngRequired: false,
      normalCounters: [{ normalCounterId: COUNTER_A, weaponTypeId: 'weapon.dual_blades' }],
      hasUnresolvableNormalCounter: false,
    })
  })

  it('names a Counter whose record no longer exists without a weapon type, still unresolved', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: [history('h.1', planA.id, 'plan.a.normal.a', T1)],
      rngState: rng(AFTER_T2),
      normalCounters: [],
    })).toMatchObject({ normalCounters: [{ normalCounterId: COUNTER_A, weaponTypeId: null }] })
  })

  it('A3: a terminal Plan is judged like any other - no status filter', () => {
    for (const status of ['completed', 'abandoned', 'stale', 'active', 'draft'] as const) {
      const result = aggregatePersistentReidentificationReminder({
        plans: [plan('plan.x', status)],
        executionHistory: [history('h.1', 'plan.x', 'plan.x.reset', T1)],
        rngState: rng(null),
        normalCounters: [],
      })
      expect(result, status).toMatchObject({ kind: 'actual_result_different', rngRequired: true })
    }
  })

  it('A4: the same RNG stream diverged in several Plans is one request', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA, planB],
      executionHistory: [history('h.1', planA.id, 'plan.a.reset', T1), history('h.2', planB.id, 'plan.b.skills', T2)],
      rngState: rng(null),
      normalCounters: [],
    })).toEqual({ kind: 'actual_result_different', rngRequired: true, normalCounters: [], hasUnresolvableNormalCounter: false })
  })

  it('A5: the same Normal Counter diverged in several Plans is listed once', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA, planB],
      executionHistory: [history('h.1', planA.id, 'plan.a.normal.a', T1), history('h.2', planB.id, 'plan.b.normal.a', T2)],
      rngState: rng(null),
      normalCounters: [counter(COUNTER_A, null)],
    })).toMatchObject({ normalCounters: [{ normalCounterId: COUNTER_A }] })
  })

  it('A6: different Normal Counters are both kept, sorted by ID', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA, planB],
      executionHistory: [history('h.1', planA.id, 'plan.a.normal.b', T1), history('h.2', planB.id, 'plan.b.normal.a', T2)],
      rngState: rng(null),
      normalCounters: [counter(COUNTER_A, null), counter(COUNTER_B, null)],
    })).toMatchObject({
      normalCounters: [
        { normalCounterId: COUNTER_A, weaponTypeId: 'weapon.dual_blades' },
        { normalCounterId: COUNTER_B, weaponTypeId: 'weapon.great_sword' },
      ],
    })
  })

  it('A7 / A8: an adoption between two Plans divergences resolves only the earlier Plan; one after both resolves all', () => {
    const input = {
      plans: [planA, planB],
      executionHistory: [history('h.1', planA.id, 'plan.a.reset', T1), history('h.2', planB.id, 'plan.b.reset', T2)],
      normalCounters: [],
    }
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(BEFORE_T1) })).toMatchObject({ rngRequired: true })
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(BETWEEN) })).toMatchObject({ rngRequired: true })
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(AFTER_T2) })).toEqual({ kind: 'none' })
  })

  it('keeps the RNG and the Normal streams apart: each adoption resolves its own stream only', () => {
    const input = {
      plans: [planA, planB],
      executionHistory: [history('h.1', planA.id, 'plan.a.reset', T1), history('h.2', planB.id, 'plan.b.normal.a', T2)],
    }
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(AFTER_T2), normalCounters: [counter(COUNTER_A, null)] }))
      .toEqual({ kind: 'actual_result_different', rngRequired: false, normalCounters: [{ normalCounterId: COUNTER_A, weaponTypeId: 'weapon.dual_blades' }], hasUnresolvableNormalCounter: false })
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(null), normalCounters: [counter(COUNTER_A, AFTER_T2)] }))
      .toEqual({ kind: 'actual_result_different', rngRequired: true, normalCounters: [], hasUnresolvableNormalCounter: false })
    expect(aggregatePersistentReidentificationReminder({ ...input, rngState: rng(AFTER_T2), normalCounters: [counter(COUNTER_A, AFTER_T2)] }))
      .toEqual({ kind: 'none' })
  })

  it('A9: operation_uncertain, operation_count_recovered, confirmed_expected and finished_as_compromise alone remind nothing', () => {
    const actions: ExecutionHistory['action'][] = ['operation_uncertain', 'operation_count_recovered', 'confirmed_expected', 'finished_as_compromise']
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: actions.map((action, index) => history(`h.${index}`, planA.id, 'plan.a.reset', T1, action)),
      rngState: rng(null),
      normalCounters: [],
    })).toEqual({ kind: 'none' })
  })

  it('A10: no record - deleted by Undo or a save point restore - reminds nothing, whatever the Plans are', () => {
    expect(aggregatePersistentReidentificationReminder({ plans: [planA, planB], executionHistory: [], rngState: rng(null), normalCounters: [] }))
      .toEqual({ kind: 'none' })
    expect(aggregatePersistentReidentificationReminder({ plans: [], executionHistory: [], rngState: null, normalCounters: [] }))
      .toEqual({ kind: 'none' })
  })

  it('fails closed for a Normal creation naming no Counter and for a record whose Plan no longer exists', () => {
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: [history('h.1', planA.id, 'plan.a.normal.unbound', T1)],
      rngState: rng(AFTER_T2),
      normalCounters: [counter(COUNTER_A, AFTER_T2), counter(COUNTER_B, AFTER_T2)],
    })).toEqual({ kind: 'actual_result_different', rngRequired: false, normalCounters: [], hasUnresolvableNormalCounter: true })
    // An orphan record is never ignored and never guessed onto another Plan or stream.
    expect(aggregatePersistentReidentificationReminder({
      plans: [planA],
      executionHistory: [history('h.1', 'plan.missing', 'plan.a.reset', T1)],
      rngState: rng(AFTER_T2),
      normalCounters: [],
    })).toEqual({ kind: 'actual_result_different', rngRequired: false, normalCounters: [], hasUnresolvableNormalCounter: true })
  })
})

describe('loadPersistentReidentificationReminder', () => {
  it('reads every Plan, every record, the current RngState and every Counter from the database without writing', () =>
    withDatabase(async (database) => {
      await database.productionPlans.bulkPut([planA as ProductionPlan, planB as ProductionPlan])
      await database.executionHistory.bulkPut([
        history('h.1', planA.id, 'plan.a.reset', T1),
        history('h.2', planB.id, 'plan.b.normal.a', T2),
      ])
      await database.normalArtianCounters.put(counter(COUNTER_A, null) as NormalArtianCounter)
      expect(await loadPersistentReidentificationReminder(database)).toEqual({
        kind: 'actual_result_different',
        rngRequired: true,
        normalCounters: [{ normalCounterId: COUNTER_A, weaponTypeId: 'weapon.dual_blades' }],
        hasUnresolvableNormalCounter: false,
      })

      await database.rngState.put({ id: 'current', ...rng(AFTER_T2) } as RngState)
      await database.normalArtianCounters.put(counter(COUNTER_A, AFTER_T2) as NormalArtianCounter)
      expect(await loadPersistentReidentificationReminder(database)).toEqual({ kind: 'none' })
      expect((await database.executionHistory.toArray()).map(({ id }) => id).sort()).toEqual(['h.1', 'h.2'])
    }))
})
