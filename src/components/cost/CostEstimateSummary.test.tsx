import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { summarizeCostEstimate, type CostEstimateOperation } from '../../domain/cost'
import { CostEstimateSummary } from './CostEstimateSummary'

const forge = (role: 'counter_advance' | 'production_target', weaponTypeId = 'weapon.great_sword'): CostEstimateOperation => ({
  type: 'create_normal_artian',
  weaponTypeId,
  role,
})
const repeat = (operation: CostEstimateOperation, times: number): CostEstimateOperation[] =>
  Array.from({ length: times }, () => operation)

/** A new Great Sword Normal forged twice, converted, five Gogma restorations, eight Skill reassignments. */
const fullRoute: CostEstimateOperation[] = [
  forge('counter_advance'),
  forge('production_target'),
  { type: 'convert_normal_to_gogma' },
  ...repeat({ type: 'reset_bonuses' }, 3),
  ...repeat({ type: 'keep_bonuses' }, 2),
  ...repeat({ type: 'reset_skills' }, 8),
]

function group(name: string): HTMLElement {
  return screen.getByRole('list', { name })
}

describe('CostEstimateSummary', () => {
  it('renders every group of a full Route with the item names and quantities side by side', () => {
    render(<CostEstimateSummary summary={summarizeCostEstimate(fullRoute)} headingLevel="h4" />)
    expect(screen.getByRole('heading', { level: 4, name: '必要素材・費用の目安' })).toBeInTheDocument()

    const parts = within(group('RARE8アーティアパーツ')).getAllByRole('listitem')
    expect(parts.map((item) => item.textContent)).toEqual(['砕かれた古刃 ×4', '潰された古筒 ×2'])

    expect(within(group('通常復元')).getByRole('listitem')).toHaveTextContent('ナナイロカネ ×50')

    const conversion = within(group('巨戟化')).getAllByRole('listitem')
    expect(conversion.map((item) => item.textContent)).toEqual([
      '油濁した遺装置 ×3',
      '※巨戟化に使用する激化タイプ',
    ])

    // ナナイロカネ and 歴戦錬磨の証 are an alternative, never a sum.
    const restoration = within(group('巨戟復元')).getAllByRole('listitem')
    expect(restoration.map((item) => item.textContent)).toEqual([
      '5回',
      'ナナイロカネ ×100',
      'または 歴戦錬磨の証 ×10',
    ])

    const skills = within(group('スキル再付与')).getAllByRole('listitem')
    expect(skills.map((item) => item.textContent)).toEqual([
      '8回',
      '油濁した遺装置 ×48',
      '※巨戟化時と同じ激化タイプなら ×24',
    ])

    expect(within(group('必要ゼニー')).getByRole('listitem')).toHaveTextContent(
      `約 ${(2 * 10_000 + 10_000 + 30_000 + 5 * 5_000 + 8 * 9_000).toLocaleString('ja-JP')}z`,
    )
    expect(screen.getByText('約 157,000z')).toBeInTheDocument()
  })

  it('omits the groups a Route does not contain', () => {
    render(
      <CostEstimateSummary
        summary={summarizeCostEstimate([
          { type: 'reset_bonuses' },
          { type: 'reset_skills' },
        ])}
        headingLevel="h4"
      />,
    )
    expect(screen.queryByRole('list', { name: 'RARE8アーティアパーツ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '通常復元' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '巨戟化' })).not.toBeInTheDocument()
    expect(group('巨戟復元')).toBeInTheDocument()
    expect(group('スキル再付与')).toBeInTheDocument()
    expect(within(group('必要ゼニー')).getByRole('listitem')).toHaveTextContent('約 14,000z')
  })

  it('groups large quantities and the zenny by thousands', () => {
    render(
      <CostEstimateSummary
        summary={summarizeCostEstimate(repeat({ type: 'reset_bonuses' }, 60))}
        headingLevel="h4"
      />,
    )
    const restoration = within(group('巨戟復元')).getAllByRole('listitem')
    expect(restoration.map((item) => item.textContent)).toEqual([
      '60回',
      'ナナイロカネ ×1,200',
      'または 歴戦錬磨の証 ×120',
    ])
    expect(within(group('必要ゼニー')).getByRole('listitem')).toHaveTextContent('約 300,000z')
  })

  it('says plainly that a zero-operation Candidate needs nothing more', () => {
    render(<CostEstimateSummary summary={summarizeCostEstimate([])} headingLevel="h4" />)
    expect(screen.getByText('追加の素材・ゼニーは不要')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '必要素材・費用の目安' })).not.toBeInTheDocument()
    expect(screen.queryByText(/約 [0-9,]+z/)).not.toBeInTheDocument()
  })

  it('reports forges of a weapon type without a part recipe instead of inventing parts', () => {
    render(
      <CostEstimateSummary
        summary={summarizeCostEstimate([forge('production_target', 'weapon.fixture.a')])}
        headingLevel="h4"
      />,
    )
    const parts = within(group('RARE8アーティアパーツ')).getAllByRole('listitem')
    expect(parts.map((item) => item.textContent)).toEqual([
      '武器種別のパーツ構成が未定義の作成 1本（1本につき3パーツ）',
    ])
  })

  it('renders only the body with the caller-owned heading omitted, plus the note', () => {
    render(<CostEstimateSummary summary={summarizeCostEstimate([{ type: 'keep_bonuses' }])} note="補足" />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('補足')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '必要素材・費用の目安' })).toBeInTheDocument()
  })

  it('keeps every quantity from breaking away from its item and lets item names wrap', () => {
    render(<CostEstimateSummary summary={summarizeCostEstimate(fullRoute)} headingLevel="h4" />)
    const line = within(group('RARE8アーティアパーツ')).getAllByRole('listitem')[0]
    const [name, quantity] = [...line.querySelectorAll('span')]
    expect(getComputedStyle(name).overflowWrap).toBe('anywhere')
    expect(getComputedStyle(quantity).whiteSpace).toBe('nowrap')
  })
})
