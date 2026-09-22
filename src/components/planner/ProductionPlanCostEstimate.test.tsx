import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { costPlanStep, createMultiTargetCostPlanFixture } from '../../test/fixtures/costEstimatePlan'
import { ProductionPlanCostEstimate } from './ProductionPlanCostEstimate'

function group(name: string): HTMLElement {
  return screen.getByRole('list', { name })
}

describe('ProductionPlanCostEstimate', () => {
  it('shows the whole-Plan totals of a multi-Target Plan, the shared Step counted once', () => {
    const { plan, targets } = createMultiTargetCostPlanFixture()
    render(<ProductionPlanCostEstimate plan={plan} targetWeapons={targets} />)

    expect(
      screen.getByText('計画全体の物理操作から算出した目安です。完了済みの操作も含みます。'),
    ).toBeInTheDocument()
    expect(within(group('RARE8アーティアパーツ')).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '砕かれた古刃 ×6',
      '潰された古筒 ×3',
    ])
    expect(within(group('通常復元')).getByRole('listitem')).toHaveTextContent('ナナイロカネ ×50')
    expect(within(group('巨戟化')).getAllByRole('listitem')[0]).toHaveTextContent('油濁した遺装置 ×3')
    // Two Gogma restorations: the Reset Bonuses Step shared by Targets A and B, and Target B's Keep.
    expect(within(group('巨戟復元')).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '2回',
      'ナナイロカネ ×40',
      'または 歴戦錬磨の証 ×4',
    ])
    expect(within(group('スキル再付与')).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '3回',
      '油濁した遺装置 ×18',
      '※巨戟化時と同じ激化タイプなら ×9',
    ])
    expect(within(group('必要ゼニー')).getByRole('listitem')).toHaveTextContent('約 107,000z')
  })

  it('says a Plan of only confirm_owned_ideal Steps needs nothing more', () => {
    const { plan, targets } = createMultiTargetCostPlanFixture()
    const ownedIdealOnly = {
      ...plan,
      steps: plan.steps.filter((step) => step.operationType === 'confirm_owned_ideal'),
    }
    render(<ProductionPlanCostEstimate plan={ownedIdealOnly} targetWeapons={targets} />)
    expect(screen.getByText('追加の素材・ゼニーは不要')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '必要素材・費用の目安' })).not.toBeInTheDocument()
  })

  it('explains that a legacy Plan cannot be estimated instead of guessing its Normal creation roles', () => {
    const { plan, targets } = createMultiTargetCostPlanFixture()
    const legacyCreate = costPlanStep('step.legacy', 1, { operationType: 'create_normal_artian' })
    delete legacyCreate.executionEffects
    render(<ProductionPlanCostEstimate plan={{ ...plan, steps: [legacyCreate] }} targetWeapons={targets} />)
    expect(
      screen.getByText('旧形式の計画のため、必要素材・費用の目安を算出できません。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '必要素材・費用の目安' })).not.toBeInTheDocument()
  })
})
