import { describe, expect, it } from 'vitest'
import type {
  ExecutionAction,
  ExecutionHistory,
  PlanStep,
  ProductionPlan,
  RecalculationReason,
} from '../../domain/models/publicTypes'
import {
  blindFixture,
  existingGogmaFixture,
  newNormalFixture,
  ownedNormalFixture,
} from '../../test/fixtures/executionRuntime'
import {
  actualResultInputKind,
  executionDivergenceView,
  executionErrorMessage,
  offersOperationUncertain,
} from './executionStepPresentation'

function withOperation(step: PlanStep, operationType: PlanStep['operationType']): PlanStep {
  return { ...step, operationType }
}

function history(
  plan: ProductionPlan,
  step: PlanStep,
  action: ExecutionAction,
  recalculationReason: RecalculationReason | null,
  overrides: Partial<ExecutionHistory> = {},
): ExecutionHistory {
  return {
    id: `history.${action}`,
    planId: plan.id,
    planStepId: step.id,
    action,
    actualResult: null,
    wasExpected: action === 'confirmed_expected',
    recalculationReason,
    createdAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  } as ExecutionHistory
}

function stale(plan: ProductionPlan, reasons: RecalculationReason[]): ProductionPlan {
  return { ...structuredClone(plan), status: 'stale', recalculationReasons: reasons }
}

describe('actualResultInputKind', () => {
  it('asks for normal-scope five slots on a predicted Normal creation only', async () => {
    const predicted = (await newNormalFixture()).plan.steps[0]
    const blind = (await blindFixture()).plan.steps[0]
    expect(predicted.executionEffects?.observationBinding).toBeNull()
    expect(actualResultInputKind(predicted)).toEqual({ kind: 'restoration_bonuses', scope: 'normal_artian' })
    expect(blind.executionEffects?.observationBinding).not.toBeNull()
    expect(actualResultInputKind(blind)).toBeNull()
  })

  it('asks for Gogma-scope five slots on Reset / Keep Bonuses and Skills on conversion / Reset Skills', async () => {
    const [reset, resetSkills] = (await existingGogmaFixture()).plan.steps
    const [convert] = (await ownedNormalFixture()).plan.steps
    expect(reset.operationType).toBe('reset_bonuses')
    expect(actualResultInputKind(reset)).toEqual({ kind: 'restoration_bonuses', scope: 'gogma_artian' })
    expect(actualResultInputKind(withOperation(reset, 'keep_bonuses'))).toEqual({ kind: 'restoration_bonuses', scope: 'gogma_artian' })
    expect(convert.operationType).toBe('convert_normal_to_gogma')
    expect(actualResultInputKind(convert)).toEqual({ kind: 'skills' })
    expect(resetSkills.operationType).toBe('reset_skills')
    expect(actualResultInputKind(resetSkills)).toEqual({ kind: 'skills' })
  })

  it('offers nothing for an owned Ideal confirmation or a legacy Step', async () => {
    const [step] = (await existingGogmaFixture()).plan.steps
    expect(actualResultInputKind(withOperation(step, 'confirm_owned_ideal'))).toBeNull()
    expect(actualResultInputKind(withOperation(step, 'reserve_weapon'))).toBeNull()
    expect(actualResultInputKind({ ...step, executionEffects: undefined })).toBeNull()
  })
})

describe('offersOperationUncertain', () => {
  it('applies to every game operation, a blind creation included', async () => {
    const [blind] = (await blindFixture()).plan.steps
    const [step] = (await existingGogmaFixture()).plan.steps
    expect(offersOperationUncertain(blind)).toBe(true)
    for (const operation of ['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'] as const) {
      expect(offersOperationUncertain(withOperation(step, operation))).toBe(true)
    }
  })

  it('never applies to an owned Ideal confirmation or a legacy Step', async () => {
    const [step] = (await existingGogmaFixture()).plan.steps
    expect(offersOperationUncertain(withOperation(step, 'confirm_owned_ideal'))).toBe(false)
    expect(offersOperationUncertain(withOperation(step, 'confirm_result'))).toBe(false)
    expect(offersOperationUncertain({ ...step, executionEffects: undefined })).toBe(false)
  })
})

describe('executionDivergenceView', () => {
  it('sends an unexpected Normal creation to the Normal Counter setup', async () => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    const view = executionDivergenceView(
      stale(plan, ['unexpected_result']),
      history(plan, create, 'actual_result_different', 'unexpected_result'),
    )
    expect(view).toEqual({
      action: 'actual_result_different',
      planStepId: create.id,
      operationLabel: expect.any(String),
      destination: 'normal_counters',
    })
  })

  it('sends a Gogma / Skill divergence to RNG Setup', async () => {
    const { plan } = await existingGogmaFixture()
    const [reset, resetSkills] = plan.steps
    expect(executionDivergenceView(
      stale(plan, ['unexpected_result']),
      history(plan, reset, 'actual_result_different', 'unexpected_result'),
    )?.destination).toBe('rng')
    expect(executionDivergenceView(
      stale(plan, ['execution_operation_uncertain']),
      history(plan, resetSkills, 'operation_uncertain', 'execution_operation_uncertain'),
    )).toMatchObject({ action: 'operation_uncertain', destination: 'rng' })
  })

  it('reads only the latest record, never a reason left by an older divergence', async () => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    const stalePlan = stale(plan, ['unexpected_result', 'calculation_context_changed'])
    // The latest record is an ordinary confirmation: the reason list alone names no Step.
    expect(executionDivergenceView(stalePlan, history(plan, create, 'confirmed_expected', null))).toBeNull()
    expect(executionDivergenceView(stalePlan, null)).toBeNull()
  })

  it('shows nothing for a Plan that is not stale, a foreign record, a mismatched reason or an unknown Step', async () => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    const record = history(plan, create, 'actual_result_different', 'unexpected_result')
    expect(executionDivergenceView({ ...plan, status: 'active' }, record)).toBeNull()
    expect(executionDivergenceView(stale(plan, ['unexpected_result']), { ...record, planId: 'plan.other' as ProductionPlan['id'] })).toBeNull()
    expect(executionDivergenceView(stale(plan, ['calculation_context_changed']), record)).toBeNull()
    expect(executionDivergenceView(stale(plan, ['unexpected_result']), { ...record, planStepId: 'step.unknown' as PlanStep['id'] })).toBeNull()
  })
})

describe('executionErrorMessage for the divergence records', () => {
  it('names each actual result refusal in its own words', () => {
    expect(executionErrorMessage('actual_result_matches_expected')).toBe(
      '入力した結果は想定結果と一致しています。「結果一致・次へ」を使用してください。',
    )
    expect(executionErrorMessage('actual_result_invalid')).toMatch(/入力を確認してください/)
    expect(executionErrorMessage('actual_result_not_applicable')).toMatch(/「結果が違う」として記録できません/)
  })
})
