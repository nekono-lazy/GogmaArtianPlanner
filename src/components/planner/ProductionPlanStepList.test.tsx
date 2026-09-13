import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlanStep, RestorationBonusSet } from '../../domain/models/publicTypes'
import {
  createValidProductionPlan,
  createValidTargetWeapon,
  planStepId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createTargetWeaponLookup } from './productionPlanPresentation'
import { ProductionPlanStepList } from './ProductionPlanStepList'

const target = { ...createValidTargetWeapon(), id: targetWeaponId('target.steps.a'), name: '双剣・水' }
const other = { ...createValidTargetWeapon(), id: targetWeaponId('target.steps.b'), name: '双剣・火' }

/** Two identical slots first, so a de-duplicating display would be caught. */
const slots: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.special' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.special' },
]

function step(
  id: string,
  order: number,
  overrides: Partial<PlanStep> = {},
): PlanStep {
  const base = createValidProductionPlan().steps[0]
  return {
    ...base,
    id: planStepId(id),
    order,
    operationType: 'reset_bonuses',
    title: `タイトル ${order}`,
    instruction: `手順 ${order}`,
    targetWeaponId: target.id,
    progressedTargetWeaponIds: [target.id],
    expectedResult: {
      restorationBonuses: slots,
      restorationBonusScope: 'gogma_artian',
      seriesSkillId: null,
      groupSkillId: null,
      shouldSecure: false,
    },
    ...overrides,
  }
}

function renderList(steps: PlanStep[], showSharedBadge = false) {
  return render(
    <ProductionPlanStepList
      steps={steps}
      lookup={createTargetWeaponLookup([target, other])}
      master={createValidMasterDataFixture()}
      showSharedBadge={showSharedBadge}
      label="テスト手順"
    />,
  )
}

function card(order: number): HTMLElement {
  const heading = screen.getByRole('heading', { level: 4, name: `ステップ ${order}` })
  const item = heading.closest('li')
  if (!item) throw new Error(`Missing step item ${order}`)
  return item
}

describe('ProductionPlanStepList', () => {
  it('renders the supplied steps as an ordered list with the persisted order, operation and text', () => {
    renderList([step('step.a', 7), step('step.b', 9, { operationType: 'reset_skills' })])

    const list = screen.getByRole('list', { name: 'テスト手順' })
    expect(list.tagName).toBe('OL')
    // The persisted `order` is shown, never the DOM position.
    expect(within(list).getAllByRole('heading', { level: 4 }).map(({ textContent }) => textContent))
      .toEqual(['ステップ 7', 'ステップ 9'])
    expect(within(card(7)).getByText('復元ボーナスをリセット')).toBeInTheDocument()
    expect(within(card(9)).getByText('スキルをリセット')).toBeInTheDocument()
    expect(within(card(7)).getByText('タイトル 7')).toBeInTheDocument()
    expect(within(card(7)).getByText('手順 7')).toBeInTheDocument()
    expect(within(card(7)).getByText('対象: 双剣・水')).toBeInTheDocument()
  })

  it('marks only a shouldSecure step and only a shared step, as text badges', () => {
    renderList([
      step('step.secure', 1, {
        operationType: 'reserve_weapon',
        expectedResult: {
          restorationBonuses: slots,
          restorationBonusScope: 'gogma_artian',
          seriesSkillId: null,
          groupSkillId: null,
          shouldSecure: true,
        },
      }),
      step('step.shared', 2, { progressedTargetWeaponIds: [target.id, other.id] }),
      step('step.plain', 3),
    ], true)

    expect(screen.getAllByText('確保予定')).toHaveLength(1)
    expect(within(card(1)).getByText('確保予定')).toBeInTheDocument()
    expect(screen.getAllByText('共有操作')).toHaveLength(1)
    expect(within(card(2)).getByText('共有操作')).toBeInTheDocument()
    expect(within(card(2)).getByText(
      'この操作は他の目標武器と共有され、計画全体では1回だけ実行します。',
    )).toBeInTheDocument()
    expect(within(card(3)).queryByText('共有操作')).not.toBeInTheDocument()
  })

  it('hides the shared badge when the caller renders the global timeline', () => {
    renderList([step('step.shared', 2, { progressedTargetWeaponIds: [target.id, other.id] })])
    expect(screen.queryByText('共有操作')).not.toBeInTheDocument()
  })

  it('shows the five expected slots in stored order with the persisted Gogma scope label', () => {
    renderList([step('step.gogma', 1)])
    const list = within(card(1)).getByRole('list', { name: 'ステップ 1 の予測復元ボーナス5枠' })
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '攻撃High fixture',
      '攻撃High fixture',
      '攻撃Special fixture',
      '攻撃High fixture',
      '攻撃Special fixture',
    ])
    expect(within(card(1)).getByText('ボーナス区分: 巨戟amendment後（巨戟のボーナス）')).toBeInTheDocument()
  })

  it('uses the persisted normal_artian scope for the slot labels', () => {
    renderList([step('step.normal', 1, {
      operationType: 'convert_normal_to_gogma',
      expectedResult: {
        restorationBonuses: [slots[0], slots[0], slots[0], slots[0], slots[0]],
        restorationBonusScope: 'normal_artian',
        seriesSkillId: 'series_skill.fixture.enabled',
        groupSkillId: null,
        shouldSecure: false,
      },
    })])
    const list = within(card(1)).getByRole('list', { name: 'ステップ 1 の予測復元ボーナス5枠' })
    // The Normal-scope definition, never the Gogma one, names the slot.
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent))
      .toEqual(Array<string>(5).fill('通常攻撃fixture'))
    expect(within(card(1)).getByText('ボーナス区分: 通常継承（通常アーティアのボーナス）')).toBeInTheDocument()
    expect(within(card(1)).getByText('シリーズ: シリーズfixture ／ グループ: なし')).toBeInTheDocument()
  })

  it('falls back to the generic Master label when the persisted scope is null', () => {
    renderList([step('step.null-scope', 1, {
      expectedResult: {
        restorationBonuses: slots,
        restorationBonusScope: null,
        seriesSkillId: null,
        groupSkillId: null,
        shouldSecure: false,
      },
    })])
    const list = within(card(1)).getByRole('list', { name: 'ステップ 1 の予測復元ボーナス5枠' })
    // No scope is guessed: neither definition is used, only bonus type + rank.
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '攻撃fixture High fixture',
      '攻撃fixture High fixture',
      '攻撃fixture Special fixture',
      '攻撃fixture High fixture',
      '攻撃fixture Special fixture',
    ])
    expect(within(card(1)).getByText('ボーナス区分: 記録なし')).toBeInTheDocument()
  })

  it('treats a null expectedResult and null restorationBonuses as ordinary states', () => {
    renderList([
      step('step.none', 1, { expectedResult: null, targetWeaponId: null, progressedTargetWeaponIds: [] }),
      step('step.skills', 2, {
        operationType: 'reset_skills',
        expectedResult: {
          restorationBonuses: null,
          restorationBonusScope: null,
          seriesSkillId: 'series_skill.fixture.enabled',
          groupSkillId: null,
          shouldSecure: false,
        },
      }),
    ])
    expect(within(card(1)).getByText('想定結果: 予測結果なし')).toBeInTheDocument()
    expect(within(card(1)).getByText('対象: 目標武器に紐づかない操作')).toBeInTheDocument()
    expect(within(card(1)).queryByText('確保予定')).not.toBeInTheDocument()
    expect(within(card(2)).getByText('復元ボーナス: 対象外')).toBeInTheDocument()
    expect(within(card(2)).queryByText(/ボーナス区分/)).not.toBeInTheDocument()
    expect(within(card(2)).getByText('シリーズ: シリーズfixture ／ グループ: なし')).toBeInTheDocument()
  })

  it('falls back to the Target ID when the Target no longer resolves', () => {
    renderList([step('step.missing', 1, { targetWeaponId: targetWeaponId('target.steps.gone') })])
    expect(within(card(1)).getByText('対象: 削除済みまたは参照できない目標武器（target.steps.gone）')).toBeInTheDocument()
  })
})

describe('ProductionPlanStepList checkpoint milestones', () => {
  const milestone = (
    targetId: typeof target.id,
    remainingOperationCount: number,
    suffix: string,
  ) => ({
    buildListEntryId: `build-list.milestone.${suffix}` as never,
    targetWeaponId: targetId,
    checkpointGroupId: `checkpoint-group:${suffix}` as never,
    checkpointOpportunityId: `checkpoint-opportunity:${suffix}` as never,
    remainingOperationCount,
  })

  it('lists one persisted milestone with its Target and remaining operations', () => {
    renderList([step('step.milestone.one', 1, { checkpointMilestones: [milestone(target.id, 2, 'a')] })])
    const list = within(card(1)).getByRole('list', { name: 'ステップ 1 のチェックポイント到達' })
    expect(within(card(1)).getByText('チェックポイント到達')).toBeInTheDocument()
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent))
      .toEqual(['双剣・水（理想まで残り2操作）'])
    // Raw identifiers stay out of the normal UI.
    expect(within(card(1)).queryByText(/BuildListEntry ID/)).not.toBeInTheDocument()
  })

  it('lists every milestone of a shared Step in stored order', () => {
    renderList([step('step.milestone.shared', 1, {
      progressedTargetWeaponIds: [target.id, other.id],
      checkpointMilestones: [milestone(other.id, 1, 'b'), milestone(target.id, 2, 'a')],
    })], true)
    const list = within(card(1)).getByRole('list', { name: 'ステップ 1 のチェックポイント到達' })
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '双剣・火（理想まで残り1操作）',
      '双剣・水（理想まで残り2操作）',
    ])
    expect(within(card(1)).getByText('共有操作')).toBeInTheDocument()
  })

  it('falls back to the Target ID for a milestone whose Target no longer resolves', () => {
    renderList([step('step.milestone.gone', 1, {
      checkpointMilestones: [milestone(targetWeaponId('target.steps.gone'), 4, 'c')],
    })])
    expect(within(card(1)).getByText('削除済みまたは参照できない目標武器（target.steps.gone）（理想まで残り4操作）')).toBeInTheDocument()
  })

  it('shows no milestone section for a legacy undefined field or an empty list', () => {
    const legacy = step('step.milestone.legacy', 1)
    delete legacy.checkpointMilestones
    renderList([legacy, step('step.milestone.empty', 2, { checkpointMilestones: [] })])
    expect(screen.queryByText('チェックポイント到達')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /チェックポイント到達/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2)
  })

  it('adds the raw identifiers only in Debug Mode', () => {
    render(
      <ProductionPlanStepList
        steps={[step('step.milestone.debug', 1, { checkpointMilestones: [milestone(target.id, 2, 'dbg')] })]}
        lookup={createTargetWeaponLookup([target, other])}
        master={createValidMasterDataFixture()}
        label="テスト手順"
        debugMode
      />,
    )
    expect(screen.getByText(/BuildListEntry ID: build-list\.milestone\.dbg/)).toBeInTheDocument()
  })
})
