import { describe, expect, it } from 'vitest'
import type {
  ExecutionAction,
  ExecutionHistory,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  RecalculationReason,
  RestorationBonusSet,
} from '../models/publicTypes'
import {
  alternativePracticalBonuses,
  belowPracticalBonuses,
  idealBonuses,
  practicalBonuses,
  sameLayoutLowerRanks,
} from '../../test/fixtures/constrainedEnumeration'
import {
  blindFixture,
  checkpointFixture,
  newNormalFixture,
  ownedNormalFixture,
  sameWeaponWindowFixture,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import { ExecutionRuntimeError } from './executionRuntimeError'
import {
  deriveOperationCountRecovery,
  matchOperationCountRecovery,
  recoveryResultsEqual,
  type OperationCountRecoveryObservation,
  type OperationCountRecoveryWindow,
} from './operationCountRecovery'

/**
 * Current Position Recovery (`docs/PLANNER_SPEC.md` 16.15) over Plans the real
 * Planner produced. The Plan is put, in memory, at the state an
 * `operation_uncertain` record leaves: every Step before `index` confirmed as
 * expected, the Step at `index` current, and the Plan `stale`.
 */
function uncertainAt(
  fixture: ExecutionFixture,
  index: number,
  reasons: RecalculationReason[] = ['execution_operation_uncertain'],
  latestAction: ExecutionAction = 'operation_uncertain',
): { plan: ProductionPlan; history: ExecutionHistory[] } {
  const steps = fixture.plan.steps.map((step, position): PlanStep => ({ ...step, isCompleted: position < index }))
  const plan: ProductionPlan = {
    ...structuredClone(fixture.plan),
    steps,
    status: 'stale',
    currentStepId: steps[index].id,
    recalculationReasons: reasons,
  }
  const record = (step: PlanStep, action: ExecutionAction, second: number): ExecutionHistory => ({
    id: `history.${second}`,
    planId: plan.id,
    planStepId: step.id,
    action,
    actualResult: null,
    wasExpected: action === 'confirmed_expected',
    recalculationReason: action === 'operation_uncertain' ? 'execution_operation_uncertain' : null,
    createdAt: `2026-09-18T00:00:${String(second).padStart(2, '0')}.000Z`,
  }) as ExecutionHistory
  const history = [
    ...steps.slice(0, index).map((step, second) => record(step, 'confirmed_expected', second)),
    record(steps[index], latestAction, index),
  ]
  return { plan, history }
}

function windowOf(
  fixture: ExecutionFixture,
  index: number,
  ownedWeapons: readonly OwnedWeapon[] = fixture.built.input.ownedWeapons,
): OperationCountRecoveryWindow {
  const { plan, history } = uncertainAt(fixture, index)
  const availability = deriveOperationCountRecovery(plan, { ownedWeapons, planExecutionHistory: history })
  if (availability.kind !== 'available') throw new Error(`unavailable: ${availability.reason}`)
  return availability.window
}

const bonuses = (restorationBonuses: RestorationBonusSet, scope: 'normal_artian' | 'gogma_artian' = 'gogma_artian'): OperationCountRecoveryObservation =>
  ({ kind: 'restoration_bonuses', restorationBonuses, restorationBonusScope: scope })

/** Keep x5 on one weapon, then Reset Skills: A, B, A, X, Ideal. */
const KEEP_RESULTS = [sameLayoutLowerRanks(), practicalBonuses(), sameLayoutLowerRanks(), alternativePracticalBonuses(), idealBonuses()]
const keepFixture = () => sameWeaponWindowFixture(
  ['keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
  KEEP_RESULTS,
)

describe('Recovery Window', () => {
  it('covers the consecutive Keeps on one weapon and stops at Reset Skills', async () => {
    const fixture = await keepFixture()
    const window = windowOf(fixture, 0)
    expect(window.steps.map(({ operationType }) => operationType)).toEqual(Array(5).fill('keep_bonuses'))
    expect(window.steps.map(({ id }) => id)).toEqual(fixture.plan.steps.slice(0, 5).map(({ id }) => id))
    expect(fixture.plan.steps[5].operationType).toBe('reset_skills')
    // Keep Bonuses advances the Gogma Counter just like Reset Bonuses.
    window.steps.forEach((step) => {
      expect(step.rngAdvance.gogmaCounterDelta).toBe(1)
      expect(step.rngAdvance.skillCounterDelta).toBe(0)
    })
    expect(window.resultKind).toEqual({ kind: 'restoration_bonuses', scope: 'gogma_artian' })
    expect(window.baseline).toEqual(bonuses(belowPracticalBonuses()))
  })

  it('starts at the current Step, never before it', async () => {
    const fixture = await keepFixture()
    const window = windowOf(fixture, 2)
    expect(window.steps.map(({ id }) => id)).toEqual(fixture.plan.steps.slice(2, 5).map(({ id }) => id))
  })

  it('covers consecutive Reset Bonuses on one weapon, the Target-completing Step included', async () => {
    const fixture = await checkpointFixture()
    const window = windowOf(fixture, 0)
    expect(window.steps).toHaveLength(5)
    expect(window.steps.every(({ operationType }) => operationType === 'reset_bonuses')).toBe(true)
    expect(window.steps.at(-1)?.executionEffects.targetCompletions).toHaveLength(1)
  })

  it('ends where the tracked weapon changes, even for the same operation', async () => {
    const fixture = await checkpointFixture()
    const changed = { ...fixture, plan: structuredClone(fixture.plan) }
    const effects = changed.plan.steps[2].executionEffects as NonNullable<PlanStep['executionEffects']>
    effects.trackedOwnedWeaponId = 'owned.execution.another' as OwnedWeapon['id']
    expect(windowOf(changed, 0).steps).toHaveLength(2)
  })

  it('ends where the operation changes: Reset Bonuses -> Keep Bonuses', async () => {
    const fixture = await sameWeaponWindowFixture(
      ['reset_bonuses', 'reset_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
      [sameLayoutLowerRanks(), practicalBonuses(), alternativePracticalBonuses(), idealBonuses()],
    )
    const window = windowOf(fixture, 0)
    expect(window.steps.map(({ operationType }) => operationType)).toEqual(['reset_bonuses', 'reset_bonuses'])
  })

  it('ends after a Step that completes a Target', async () => {
    const fixture = await checkpointFixture()
    const changed = { ...fixture, plan: structuredClone(fixture.plan) }
    const last = changed.plan.steps[4].executionEffects as NonNullable<PlanStep['executionEffects']>
    const early = changed.plan.steps[1].executionEffects as NonNullable<PlanStep['executionEffects']>
    early.targetCompletions = structuredClone(last.targetCompletions)
    expect(windowOf(changed, 0).steps).toHaveLength(2)
  })

  it('never crosses from Counter-advance Normals into the production-target Normal', async () => {
    const fixture = await newNormalFixture()
    const roles = fixture.plan.steps.map((step) => step.executionEffects?.normalCreationRole)
    expect(roles.slice(0, 3)).toEqual(['counter_advance', 'counter_advance', 'production_target'])
    const window = windowOf(fixture, 0)
    expect(window.steps.map(({ id }) => id)).toEqual(fixture.plan.steps.slice(0, 2).map(({ id }) => id))
    expect(window.resultKind).toEqual({ kind: 'restoration_bonuses', scope: 'normal_artian' })
    // No confirmed Normal before the first Step: no baseline is invented.
    expect(window.baseline).toBeNull()
  })

  it('derives a Normal baseline only from the confirmed previous creation on the same Counter', async () => {
    const fixture = await newNormalFixture()
    const window = windowOf(fixture, 2)
    expect(window.steps.map(({ id }) => id)).toEqual([fixture.plan.steps[2].id])
    expect(window.baseline).toEqual(bonuses(fixture.plan.steps[1].expectedResult?.restorationBonuses as RestorationBonusSet, 'normal_artian'))
  })

  it('gives a conversion a one-Step Skill window without a baseline', async () => {
    const fixture = await ownedNormalFixture()
    const window = windowOf(fixture, 0)
    expect(window.steps).toHaveLength(1)
    expect(window.resultKind).toEqual({ kind: 'skills' })
    expect(window.baseline).toBeNull()
  })

  it('does not apply to a blind production-target Normal', async () => {
    const fixture = await blindFixture()
    const { plan, history } = uncertainAt(fixture, 0)
    expect(deriveOperationCountRecovery(plan, { ownedWeapons: [], planExecutionHistory: history }))
      .toEqual({ kind: 'unavailable', reason: 'no_comparable_result' })
  })

  it('does not apply with another stale reason or when the latest record is not operation_uncertain', async () => {
    const fixture = await keepFixture()
    const owned = fixture.built.input.ownedWeapons
    const other = uncertainAt(fixture, 1, ['execution_operation_uncertain', 'manual_recalculate'])
    expect(deriveOperationCountRecovery(other.plan, { ownedWeapons: owned, planExecutionHistory: other.history }))
      .toEqual({ kind: 'unavailable', reason: 'other_recalculation_reason' })
    const notLatest = uncertainAt(fixture, 1, ['execution_operation_uncertain'], 'actual_result_different')
    expect(deriveOperationCountRecovery(notLatest.plan, { ownedWeapons: owned, planExecutionHistory: notLatest.history }))
      .toEqual({ kind: 'unavailable', reason: 'latest_record_not_uncertain' })
    const active = { ...uncertainAt(fixture, 1).plan, status: 'active' as const }
    expect(deriveOperationCountRecovery(active, { ownedWeapons: owned, planExecutionHistory: other.history }))
      .toEqual({ kind: 'unavailable', reason: 'not_operation_uncertain' })
  })
})

describe('candidate matching', () => {
  it('finds a unique position inside the Window', async () => {
    const window = windowOf(await keepFixture(), 0)
    expect(matchOperationCountRecovery(window, [bonuses(alternativePracticalBonuses())]))
      .toEqual({ kind: 'unique', candidates: [4], position: 4 })
  })

  it('offers the persisted position itself (0 Step advance) as a candidate', async () => {
    const window = windowOf(await keepFixture(), 0)
    expect(matchOperationCountRecovery(window, [bonuses(belowPracticalBonuses())]))
      .toEqual({ kind: 'unique', candidates: [0], position: 0 })
  })

  it('asks for one more Plan operation when every candidate continues inside the Window', async () => {
    const window = windowOf(await keepFixture(), 0)
    expect(matchOperationCountRecovery(window, [bonuses(sameLayoutLowerRanks())]))
      .toEqual({ kind: 'needs_next_observation', candidates: [1, 3] })
    // Observation 2 compares position k + 1 of each candidate.
    expect(matchOperationCountRecovery(window, [bonuses(sameLayoutLowerRanks()), bonuses(practicalBonuses())]))
      .toEqual({ kind: 'unique', candidates: [1], position: 2 })
  })

  it('narrows a longer sequence (candidates 1 and 3 of a Reset window)', async () => {
    const window = windowOf(await checkpointFixture(), 0)
    // Results: P, below, P, below, Ideal; baseline below.
    expect(matchOperationCountRecovery(window, [bonuses(practicalBonuses())]).kind).toBe('needs_next_observation')
    expect(matchOperationCountRecovery(window, [bonuses(practicalBonuses()), bonuses(belowPracticalBonuses())]))
      .toEqual({ kind: 'needs_next_observation', candidates: [1, 3] })
    expect(matchOperationCountRecovery(window, [
      bonuses(practicalBonuses()), bonuses(belowPracticalBonuses()), bonuses(practicalBonuses()),
    ])).toEqual({ kind: 'unique', candidates: [1], position: 3 })
  })

  it('never asks for an operation past the Window end', async () => {
    const fixture = await keepFixture()
    const changed = { ...fixture, plan: structuredClone(fixture.plan) }
    // Positions 4 and 5 show the same result; position 5 is followed by Reset Skills.
    const fourth = changed.plan.steps[3].expectedResult as NonNullable<PlanStep['expectedResult']>
    fourth.restorationBonuses = idealBonuses()
    const window = windowOf(changed, 0)
    expect(matchOperationCountRecovery(window, [bonuses(idealBonuses())]))
      .toEqual({ kind: 'unrecoverable', candidates: [4, 5], reason: 'ambiguous' })
  })

  it('never asks for an operation past the end of a Counter-advance Normal window', async () => {
    const window = windowOf(await newNormalFixture(), 0)
    const [first, second] = window.steps.map((step) => step.expectedResult?.restorationBonuses as RestorationBonusSet)
    expect(first).toEqual(second)
    expect(matchOperationCountRecovery(window, [bonuses(first, 'normal_artian')]))
      .toEqual({ kind: 'unrecoverable', candidates: [1, 2], reason: 'ambiguous' })
  })

  it('reports zero candidates, comparing the five slots in order', async () => {
    const window = windowOf(await keepFixture(), 0)
    const reordered = [...practicalBonuses()].reverse() as RestorationBonusSet
    expect(recoveryResultsEqual(bonuses(reordered), bonuses(practicalBonuses()))).toBe(false)
    expect(matchOperationCountRecovery(window, [bonuses(reordered)]))
      .toEqual({ kind: 'unrecoverable', candidates: [], reason: 'no_match' })
  })

  it('never follows a result that only appears after the Window', async () => {
    const fixture = await sameWeaponWindowFixture(
      ['reset_bonuses', 'reset_bonuses', 'keep_bonuses', 'keep_bonuses', 'reset_skills'],
      [sameLayoutLowerRanks(), practicalBonuses(), alternativePracticalBonuses(), idealBonuses()],
    )
    const window = windowOf(fixture, 0)
    // The first Keep's result is outside the Reset window.
    expect(matchOperationCountRecovery(window, [bonuses(alternativePracticalBonuses())]))
      .toEqual({ kind: 'unrecoverable', candidates: [], reason: 'no_match' })
  })

  it('matches Series and Group Skills exactly', async () => {
    const window = windowOf(await ownedNormalFixture(), 0)
    const expected = window.steps[0].expectedResult as NonNullable<PlanStep['expectedResult']>
    const skills = (seriesSkillId: string | null, groupSkillId: string | null): OperationCountRecoveryObservation =>
      ({ kind: 'skills', seriesSkillId, groupSkillId } as OperationCountRecoveryObservation)
    expect(matchOperationCountRecovery(window, [skills(expected.seriesSkillId, expected.groupSkillId)]))
      .toEqual({ kind: 'unique', candidates: [1], position: 1 })
    expect(matchOperationCountRecovery(window, [skills(expected.seriesSkillId, 'group_skill.fixture.other')]).kind)
      .toBe('unrecoverable')
  })

  it('refuses an observation of another result kind or scope', async () => {
    const window = windowOf(await keepFixture(), 0)
    expect(() => matchOperationCountRecovery(window, [{ kind: 'skills', seriesSkillId: null, groupSkillId: null }]))
      .toThrow(ExecutionRuntimeError)
    expect(() => matchOperationCountRecovery(window, [bonuses(practicalBonuses(), 'normal_artian')]))
      .toThrow(ExecutionRuntimeError)
    expect(() => matchOperationCountRecovery(window, [])).toThrow(ExecutionRuntimeError)
  })
})
