import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PlanStep, PlanStepDebugInfo } from '../../domain/models/publicTypes'
import { createValidProductionPlan } from '../../test/fixtures/domainData'
import { PlanStepDebugDetails } from './PlanStepDebugDetails'

const debugInfo = (overrides: Partial<PlanStepDebugInfo> = {}): PlanStepDebugInfo => ({
  startBaseSeed: '51231782',
  startGogmaCounter: 55,
  endGogmaCounter: 55,
  startSkillCounter: 341,
  endSkillCounter: 342,
  startNormalCounter: null,
  endNormalCounter: null,
  plannerReason: 'convert_normal_to_gogma',
  ...overrides,
})

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return { ...createValidProductionPlan().steps[0], order: 3, ...overrides }
}

async function open(overrides: Partial<PlanStep> = {}) {
  const user = userEvent.setup()
  render(<PlanStepDebugDetails step={step(overrides)} headingLevel="h2" />)
  await user.click(screen.getByRole('button', { name: 'PlanStep Debug' }))
}

function group(name: string): HTMLElement {
  return screen.getByRole('group', { name })
}

function rowValue(scope: HTMLElement, label: string): HTMLElement {
  const term = within(scope).getByText(label, { selector: 'dt' })
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Missing Debug value for ${label}`)
  return value
}

describe('PlanStepDebugDetails', () => {
  it('keeps the contents out of the DOM until the disclosure is opened', () => {
    render(<PlanStepDebugDetails step={step({ debug: debugInfo() })} headingLevel="h2" />)

    expect(screen.getByRole('button', { name: 'PlanStep Debug' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByText('51231782')).not.toBeInTheDocument()
  })

  it('shows a conversion Step as Skill +1 and Gogma +0, in text rather than by colour', async () => {
    await open({
      operationType: 'convert_normal_to_gogma',
      debug: debugInfo(),
      rngAdvance: {
        gogmaCounterDelta: 0,
        skillCounterDelta: 1,
        normalCounterDelta: null,
        affectedNormalCounterId: null,
      },
    })
    const counters = group('ステップ 3 のCounter開始終了')

    expect(rowValue(counters, 'Skill Counter')).toHaveTextContent('開始 341 → 終了 342（delta 1）')
    expect(rowValue(counters, 'Gogma Counter')).toHaveTextContent('開始 55 → 終了 55（delta 0）')
    // No PRNG internal step count is ever shown as a Domain Counter delta.
    expect(rowValue(counters, 'Gogma Counter')).not.toHaveTextContent('10')
  })

  it('shows a confirmed Normal creation Counter pair, its delta and its stream ID', async () => {
    await open({
      operationType: 'create_normal_artian',
      debug: debugInfo({
        startNormalCounter: 12,
        endNormalCounter: 13,
        plannerReason: 'create_normal_artian',
      }),
      rngAdvance: {
        gogmaCounterDelta: 0,
        skillCounterDelta: 0,
        normalCounterDelta: 1,
        affectedNormalCounterId: 'weapon.bow:8',
      },
    })
    const counters = group('ステップ 3 のCounter開始終了')

    expect(rowValue(counters, 'Normal Counter')).toHaveTextContent('開始 12 → 終了 13（delta 1）')
    expect(rowValue(counters, 'affectedNormalCounterId')).toHaveTextContent('weapon.bow:8')
  })

  it('never invents a Counter value for a blind creation whose Counter is unconfirmed', async () => {
    await open({
      operationType: 'create_normal_artian',
      debug: debugInfo({
        startNormalCounter: null,
        endNormalCounter: null,
        plannerReason: 'create_normal_artian',
      }),
      rngAdvance: {
        gogmaCounterDelta: 0,
        skillCounterDelta: 0,
        normalCounterDelta: null,
        affectedNormalCounterId: null,
      },
    })
    const counters = group('ステップ 3 のCounter開始終了')

    expect(rowValue(counters, 'Normal Counter')).toHaveTextContent(
      '開始 記録なし → 終了 記録なし（delta 記録なし）',
    )
    expect(rowValue(counters, 'affectedNormalCounterId')).toHaveTextContent('記録なし')
    expect(rowValue(counters, 'Normal Counter')).not.toHaveTextContent('0')
  })

  it('says a Step recorded no PlanStepDebugInfo instead of reconstructing one', async () => {
    await open({
      debug: null,
      rngAdvance: {
        gogmaCounterDelta: 1,
        skillCounterDelta: 0,
        normalCounterDelta: null,
        affectedNormalCounterId: null,
      },
    })

    expect(screen.getByText('PlanStepDebugInfo: 記録なし')).toBeInTheDocument()
    expect(rowValue(group('ステップ 3 のPlanStepDebugInfo'), 'startBaseSeed')).toHaveTextContent(
      '記録なし',
    )
    expect(rowValue(group('ステップ 3 のPlanStepDebugInfo'), 'plannerReason')).toHaveTextContent(
      '記録なし',
    )
    // The persisted RngAdvance is a separate record and is still shown.
    expect(rowValue(group('ステップ 3 のCounter開始終了'), 'Gogma Counter')).toHaveTextContent(
      '開始 記録なし → 終了 記録なし（delta 1）',
    )
  })

  it('shows the Planner reason exactly as stored, with no invented Japanese meaning', async () => {
    await open({ debug: debugInfo({ plannerReason: 'reset_skills' }) })

    expect(rowValue(group('ステップ 3 のPlanStepDebugInfo'), 'plannerReason')).toHaveTextContent(
      'reset_skills',
    )
  })

  it('shows the persisted expectedResult raw identifiers', async () => {
    await open({
      debug: debugInfo(),
      expectedResult: {
        restorationBonuses: null,
        restorationBonusScope: 'gogma_artian',
        seriesSkillId: 'series_skill.fixture.a',
        groupSkillId: null,
        shouldSecure: false,
      },
    })
    const expected = group('ステップ 3 のexpectedResult')

    expect(rowValue(expected, 'restorationBonusScope')).toHaveTextContent('gogma_artian')
    expect(rowValue(expected, 'restorationBonuses')).toHaveTextContent('記録なし')
    expect(rowValue(expected, 'seriesSkillId')).toHaveTextContent('series_skill.fixture.a')
    expect(rowValue(expected, 'groupSkillId')).toHaveTextContent('記録なし')
  })

  it('shows the persisted ExpectedPlanState hashes of both sides as stored', async () => {
    await open({
      debug: debugInfo(),
      expectedStateBefore: {
        rngStateHash: 'before-rng',
        normalCountersHash: 'before-normal',
        ownedWeaponsHash: 'before-owned',
        targetExecutionStateHash: 'before-target',
      },
      expectedStateAfter: {
        rngStateHash: 'after-rng',
        normalCountersHash: 'after-normal',
        ownedWeaponsHash: 'after-owned',
      },
    })

    expect(
      rowValue(group('ステップ 3 のexpectedStateBefore'), 'before rngStateHash'),
    ).toHaveTextContent('before-rng')
    expect(
      rowValue(group('ステップ 3 のexpectedStateAfter'), 'after ownedWeaponsHash'),
    ).toHaveTextContent('after-owned')
    // A calculation schema 11 state carries no Target execution state hash and
    // is never normalized to a computed value.
    expect(
      rowValue(group('ステップ 3 のexpectedStateAfter'), 'after targetExecutionStateHash'),
    ).toHaveTextContent('記録なし')
  })

  it('renders long identifiers with a wrapping rule instead of a horizontal scroll', async () => {
    await open({ debug: debugInfo({ startBaseSeed: 'a'.repeat(120) }) })
    const seed = rowValue(group('ステップ 3 のPlanStepDebugInfo'), 'startBaseSeed')

    expect(seed).toHaveStyle({ overflowWrap: 'anywhere' })
  })

  it('shows a caller-supplied note above the values', async () => {
    const user = userEvent.setup()
    render(
      <PlanStepDebugDetails
        step={step({ debug: debugInfo() })}
        headingLevel="h2"
        title="現在Stepの内部情報"
        note={<span>この予測は現在状態と一致しない可能性があります。</span>}
      />,
    )
    await user.click(screen.getByRole('button', { name: '現在Stepの内部情報' }))

    expect(
      screen.getByText('この予測は現在状態と一致しない可能性があります。'),
    ).toBeInTheDocument()
  })
})
