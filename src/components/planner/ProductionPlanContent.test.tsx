import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { ProductionPlan } from '../../domain/models/publicTypes'
import { optimizedPresentationFixture, presentationTestMaster } from '../../test/fixtures/buildListOptimizationPresentationFixtures'
import { ProductionPlanContent } from './ProductionPlanContent'

/**
 * The read-only Plan view (`docs/UI_FLOW.md` 11.0): the persisted view is unchanged by the unsaved Preview variant added for the
 * Build List optimization Preview (Issue #260 PR-6B2), which only drops the persisted overview, lowers the section headings under
 * the Preview heading, does not call the order "saved" and names an unresolved Target without its ID.
 */

let master: MasterDataRoot
let plan: ProductionPlan

beforeAll(async () => {
  master = presentationTestMaster()
  const fixture = await optimizedPresentationFixture('plain')
  plan = fixture.artifact.plannerResult.plan as ProductionPlan
})

describe('ProductionPlanContent', () => {
  it('keeps the persisted view as it was by default', () => {
    render(<ProductionPlanContent plan={plan} targetWeapons={[]} master={master} />)
    expect(screen.getByRole('heading', { name: '計画の概要', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('計画ID')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '計画全体の実行順', level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/^保存された順番のとおりに表示します。/)).toBeInTheDocument()
    // An unresolved Target of a persisted Plan keeps its existing ID fallback.
    fireEvent.click(screen.getByRole('button', { name: `全${plan.steps.length}ステップを表示` }))
    expect(screen.getByRole('heading', { name: 'ステップ 1', level: 4 })).toBeInTheDocument()
    expect(screen.getAllByText(/削除済みまたは参照できない目標武器（target\./).length).toBeGreaterThan(0)
  })

  it('shows an unsaved Plan without the persisted overview, one heading level down, and without raw IDs', () => {
    render(<ProductionPlanContent plan={plan} targetWeapons={[]} master={master} variant="unsaved_preview" />)
    expect(screen.queryByRole('heading', { name: '計画の概要' })).toBeNull()
    expect(screen.queryByText('計画ID')).toBeNull()
    expect(screen.getByRole('heading', { name: '計画全体の実行順', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '目標武器ごとの作成ルート', level: 3 })).toBeInTheDocument()
    expect(screen.getByText(/^計画の順番のとおりに表示します。/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `全${plan.steps.length}ステップを表示` }))
    expect(screen.getByRole('heading', { name: 'ステップ 1', level: 5 })).toBeInTheDocument()
    expect(screen.getAllByText('参照できない目標武器').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/target\./)
  })
})
