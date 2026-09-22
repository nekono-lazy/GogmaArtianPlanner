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
  executionUndoControlPresentation,
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

  it('sends a Gogma / Skill unexpected result to RNG Setup', async () => {
    const { plan } = await existingGogmaFixture()
    const [reset] = plan.steps
    expect(executionDivergenceView(
      stale(plan, ['unexpected_result']),
      history(plan, reset, 'actual_result_different', 'unexpected_result'),
    )).toMatchObject({ action: 'actual_result_different', destination: 'rng' })
  })

  it('names no Identification destination for operation_uncertain', async () => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    // Recovered inside the Navigator (16.15), never sent to the ordinary Identification.
    expect(executionDivergenceView(
      stale(plan, ['execution_operation_uncertain']),
      history(plan, create, 'operation_uncertain', 'execution_operation_uncertain'),
    )).toEqual({ action: 'operation_uncertain', planStepId: create.id, operationLabel: expect.any(String) })
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

describe('executionUndoControlPresentation', () => {
  const actions: readonly ExecutionAction[] = [
    'confirmed_expected',
    'actual_result_different',
    'operation_count_recovered',
    'finished_as_compromise',
  ]

  it('names the operation_uncertain record explicitly, never a bare cancel or back', async () => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    const presentation = executionUndoControlPresentation(
      history(plan, create, 'operation_uncertain', 'execution_operation_uncertain'),
    )
    expect(presentation.buttonLabel).toBe('「操作内容不明」の記録を取り消す')
    expect(presentation.dialogTitle).toBe('「操作内容不明」の記録を取り消しますか？')
    expect(presentation.confirmLabel).toBe('記録を取り消して元の操作に戻る')
    // A user whose in-game situation really is unknown must not read this as a
    // way out of the recovery.
    for (const label of [presentation.buttonLabel, presentation.confirmLabel]) {
      expect(['キャンセル', '戻る', '元に戻る']).not.toContain(label)
    }
    expect(presentation.description).toContain('誤って記録した場合')
    expect(presentation.description).toContain('実際にゲーム内の操作状況が分からない場合は取り消さず')
    expect(presentation.notes.length).toBeGreaterThan(0)
  })

  it.each(actions)('keeps the generic Undo wording for %s', async (action) => {
    const { plan } = await newNormalFixture()
    const [create] = plan.steps
    expect(executionUndoControlPresentation(history(plan, create, action, null))).toEqual({
      description: '最後に確定した記録をツール上だけ取り消します。ゲーム内の操作は戻りません。',
      buttonLabel: '最後の操作をUndo',
      dialogTitle: '最後のツール上の操作を元に戻します',
      confirmLabel: 'Undoする',
      notes: [],
    })
  })
})
