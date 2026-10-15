import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { BuildListOptimizationAdoptionInspection } from '../../services/planner/plannerResultPersistenceService'
import { planCreationStartContextOf } from '../../services/planner/planCreationService'
import { BONUS_ONLY_TARGET_ID, type BuildListOptimizationAdoptionFixture } from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import { optimizedPresentationFixture, presentationTestMaster } from '../../test/fixtures/buildListOptimizationPresentationFixtures'
import { productionPlanId } from '../../test/fixtures/domainData'
import { BuildListOptimizationAdoptionDialog } from './BuildListOptimizationAdoptionDialog'

/** Issue #260 PR-6C: the adoption confirmation (`docs/UI_FLOW.md` 10.4 「採用」), from the Persistence inspection alone. */

let master: MasterDataRoot
let fixture: BuildListOptimizationAdoptionFixture

beforeAll(async () => {
  master = presentationTestMaster()
  fixture = await optimizedPresentationFixture('scoped')
})

function inspection(overrides: Partial<BuildListOptimizationAdoptionInspection> = {}): BuildListOptimizationAdoptionInspection {
  return {
    replacedDraftPlanId: productionPlanId('plan.draft.current'),
    replacements: fixture.artifact.replacements.map((replacement) => ({
      ...replacement,
      replacedImprovementPreference: replacement.targetWeaponId === BONUS_ONLY_TARGET_ID ? 'bonus_first' : 'planner',
    })),
    unchangedTargetWeaponIds: [...fixture.artifact.unchangedTargetWeaponIds],
    ...overrides,
  }
}

function renderDialog(props: Partial<Parameters<typeof BuildListOptimizationAdoptionDialog>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <BuildListOptimizationAdoptionDialog
      inspection={inspection()}
      startContext={planCreationStartContextOf(fixture.input)}
      master={master}
      submitting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  )
  return { onCancel, onConfirm }
}

describe('BuildListOptimizationAdoptionDialog', () => {
  it('states what the all-or-nothing adoption changes, from the inspection', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'この計画を採用しますか？' })
    expect(dialog).toHaveAccessibleDescription(/目標武器ごとに一部だけ採用することはできません。/)
    expect(within(dialog).getByText(`${fixture.artifact.replacements.length}件`)).toBeInTheDocument()
    expect(within(dialog).getByText(`${fixture.artifact.unchangedTargetWeaponIds.length}件`)).toBeInTheDocument()
    expect(within(dialog).getByText('この計画に置き換えます')).toBeInTheDocument()
    expect(within(dialog).getByText(/途中採用する状態と改善優先は、新しい候補に引き継がれません。/)).toBeInTheDocument()
    expect(within(dialog).getByText(/置き換えた候補は自動では元に戻せません。/)).toBeInTheDocument()
    // The Target whose preference returns to 「生産計画に任せる」, named from the start context (never by ID).
    const resets = within(dialog).getByRole('list', { name: /改善優先が「生産計画に任せる」に戻る目標武器/ })
    const target = fixture.input.targetWeapons.find(({ id }) => id === BONUS_ONLY_TARGET_ID)!
    expect(within(resets).getByText(new RegExp(target.name))).toBeInTheDocument()
    expect(within(resets).getByText(/復元ボーナスを優先 → 生産計画に任せる/)).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(BONUS_ONLY_TARGET_ID)
  })

  it('says a replacement-free adoption keeps the Build List, and that no Draft is replaced when there is none', () => {
    renderDialog({ inspection: inspection({ replacements: [], replacedDraftPlanId: null }) })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('置き換える候補はありません。作成リストは変更せず、生産計画（下書き）だけを保存します。')).toBeInTheDocument()
    expect(within(dialog).getByText('ありません（新しく保存します）')).toBeInTheDocument()
    expect(within(dialog).queryByText(/置き換えた候補は自動では元に戻せません。/)).not.toBeInTheDocument()
  })

  it('confirms only on 「この計画を採用」 and cancels on 「キャンセル」 and Escape', () => {
    const { onCancel, onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この計画を採用' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('holds every operation while the adoption is saved', () => {
    const { onCancel } = renderDialog({ submitting: true })
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存しています…' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('progressbar', { name: '採用した計画を保存中' })).toBeInTheDocument()
  })

  it('stays closed without an inspection', () => {
    renderDialog({ inspection: null })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
