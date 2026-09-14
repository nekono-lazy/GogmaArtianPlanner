import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  RestorationBonusSet,
} from '../../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { CompromiseCheckpointList, type CompromiseCheckpointListProps } from './CompromiseCheckpointList'

const ATTACK = 'bonus_type.fixture.attack'
const UNUSED = 'bonus_type.fixture.unused'
const HIGH = 'bonus_rank.fixture.high'
const SPECIAL = 'bonus_rank.fixture.special'

const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId })

/** Gogma-scope labels resolved by `bonusLabel` for `weapon.fixture.a`. */
const labels = {
  attackHigh: '攻撃High fixture',
  attackSpecial: '攻撃Special fixture',
  unusedHigh: '未使用fixture High fixture',
  unusedSpecial: '未使用fixture Special fixture',
}

const slots = (): RestorationBonusSet => [
  bonus(ATTACK, HIGH),
  bonus(ATTACK, SPECIAL),
  bonus(UNUSED, HIGH),
  bonus(UNUSED, SPECIAL),
  bonus(ATTACK, HIGH),
]

function opportunity(
  id: string,
  afterOperationIndex: number,
  operationCount: number,
  remainingOperationCount: number,
  group: Pick<CompromiseCheckpointGroup, 'seriesSkillId' | 'groupSkillId' | 'conditionMatch'>,
): CompromiseCheckpointOpportunity {
  return {
    id: id as CompromiseCheckpointOpportunity['id'],
    afterOperationIndex,
    operationCount,
    remainingOperationCount,
    restorationBonuses: slots(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: group.seriesSkillId,
    groupSkillId: group.groupSkillId,
    conditionMatch: group.conditionMatch,
  }
}

const practicalIdentity = {
  seriesSkillId: 'series_skill.fixture.enabled',
  groupSkillId: null,
  conditionMatch: { bonus: 'practical', skill: 'ideal' },
} as const

/** Reached twice: at the second and at the fourth operation. */
const practicalGroup: CompromiseCheckpointGroup = {
  id: 'checkpoint-group:fixture.practical' as CompromiseCheckpointGroup['id'],
  restorationBonusScope: 'gogma_artian',
  restorationBonuses: slots(),
  ...practicalIdentity,
  opportunities: [
    opportunity('checkpoint-opportunity:fixture.practical.2', 1, 2, 3, practicalIdentity),
    opportunity('checkpoint-opportunity:fixture.practical.4', 3, 4, 1, practicalIdentity),
  ],
  isDisplaySecondary: false,
  dominatingGroupId: null,
}

const alternativeIdentity = {
  seriesSkillId: 'series_skill.fixture.enabled',
  groupSkillId: null,
  conditionMatch: { bonus: 'alternative', skill: 'practical' },
} as const

/** Display-secondary behind the practical group, but still fully selectable. */
const alternativeGroup: CompromiseCheckpointGroup = {
  id: 'checkpoint-group:fixture.alternative' as CompromiseCheckpointGroup['id'],
  restorationBonusScope: 'gogma_artian',
  restorationBonuses: slots(),
  ...alternativeIdentity,
  opportunities: [
    opportunity('checkpoint-opportunity:fixture.alternative.3', 2, 3, 2, alternativeIdentity),
  ],
  isDisplaySecondary: true,
  dominatingGroupId: practicalGroup.id,
}

type ToggleHandler = NonNullable<CompromiseCheckpointListProps['onToggle']>

function renderList(
  groups: CompromiseCheckpointGroup[],
  options: { selected?: string[] } = {},
) {
  const { selected = [] } = options
  const onToggle = vi.fn<ToggleHandler>()
  const view = render(
    <CompromiseCheckpointList
      groups={groups}
      weaponTypeId="weapon.fixture.a"
      master={createValidMasterDataFixture()}
      selectedOpportunityIds={selected as CompromiseCheckpointOpportunity['id'][]}
      onToggle={onToggle}
    />,
  )
  return { ...view, onToggle }
}

describe('CompromiseCheckpointList', () => {
  it('shows the scope, five slots in slot order, skills, and judgement of a group', () => {
    renderList([practicalGroup])

    expect(screen.getByRole('heading', { level: 4, name: '途中で利用可能な妥協チェックポイント' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: 'チェックポイント 1' })).toBeInTheDocument()
    // The scope comes from the group itself, through the shared scope labels.
    expect(screen.getByText('巨戟アーティア系')).toBeInTheDocument()
    const slotList = screen.getByRole('list', { name: 'チェックポイント 1 の復元ボーナス5枠' })
    const items = within(slotList).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      labels.attackHigh,
      labels.attackSpecial,
      labels.unusedHigh,
      labels.unusedSpecial,
      labels.attackHigh,
    ])
    // Judgement labels are the persisted `conditionMatch`, never recomputed.
    expect(screen.getByText('判定: 実用')).toBeInTheDocument()
    expect(screen.getByText('ボーナス判定: 実用 ／ スキル判定: 理想')).toBeInTheDocument()
    expect(screen.getByText('シリーズfixture')).toBeInTheDocument()
    expect(screen.getByText('なし')).toBeInTheDocument()
  })

  it('starts unselected and reports the primary opportunity toggle', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderList([practicalGroup])

    const primary = screen.getByRole('checkbox', { name: '2手目（理想まで残り3操作）' })
    expect(primary).not.toBeChecked()
    await user.click(primary)
    expect(onToggle).toHaveBeenCalledWith(practicalGroup, practicalGroup.opportunities[0], true)
  })

  it('reflects the selection it is given', () => {
    renderList([practicalGroup], { selected: [practicalGroup.opportunities[0].id] })
    expect(screen.getByRole('checkbox', { name: '2手目（理想まで残り3操作）' })).toBeChecked()
  })

  it('keeps later arrivals selectable behind その他の到達点', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderList([practicalGroup])

    // The later arrival is disclosed, never deduplicated away
    // (`docs/SEARCH_SPEC.md` 5.8.3).
    const toggle = screen.getByRole('button', { name: 'その他の到達点（1）' })
    expect(screen.getByRole('heading', { level: 6, name: 'その他の到達点（1）' })).toContainElement(toggle)
    expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
    await user.click(toggle)
    const later = await screen.findByRole('checkbox', { name: '4手目（理想まで残り1操作）' })
    expect(later).not.toBeChecked()
    await user.click(later)
    expect(onToggle).toHaveBeenCalledWith(practicalGroup, practicalGroup.opportunities[1], true)
  })

  it('keeps a display-secondary group selectable behind その他の候補', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderList([practicalGroup, alternativeGroup])

    // The secondary group is disclosed, not removed: it stays in the Domain
    // and fully selectable (`docs/SEARCH_SPEC.md` 5.8.4).
    const toggle = screen.getByRole('button', { name: 'その他の候補（1）' })
    expect(screen.getByRole('heading', { level: 5, name: 'その他の候補（1）' })).toContainElement(toggle)
    await user.click(toggle)
    expect(await screen.findByText('判定: 代替')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: 'チェックポイント 2' })).toBeInTheDocument()
    expect(screen.getByText('ボーナス判定: 代替 ／ スキル判定: 実用')).toBeInTheDocument()
    const checkbox = await screen.findByRole('checkbox', { name: '3手目（理想まで残り2操作）' })
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith(alternativeGroup, alternativeGroup.opportunities[0], true)
  })

  it('explains a selection in Search terms by default and in Build List terms on request', () => {
    const searchText =
      '選択すると、この到達点を作成途中で必ず経由する条件として作成リストへ登録します。何も選ばなければ理想品まで進みます。性能ごとに選べる到達点は1つまでです。'
    const buildListText =
      '選択中のチェックポイントは、この候補を作成する途中で必ず経由する条件としてPlannerに渡されます。変更すると既存の生産計画は再計算が必要です。性能ごとに選べる到達点は1つまでです。'
    const { unmount } = renderList([practicalGroup])
    expect(screen.getByText(searchText)).toBeInTheDocument()
    unmount()

    render(
      <CompromiseCheckpointList
        groups={[practicalGroup]}
        weaponTypeId="weapon.fixture.a"
        master={createValidMasterDataFixture()}
        selectedOpportunityIds={[]}
        onToggle={vi.fn()}
        selectionContext="build_list"
      />,
    )
    expect(screen.getByText(buildListText)).toBeInTheDocument()
    expect(screen.queryByText(searchText)).not.toBeInTheDocument()
    // The selection controls are the same in both contexts.
    expect(screen.getByRole('checkbox', { name: '2手目（理想まで残り3操作）' })).toBeInTheDocument()
  })

  it('stops creating headings below h6 while keeping every disclosure operable', async () => {
    const user = userEvent.setup()
    render(
      <CompromiseCheckpointList
        groups={[practicalGroup, alternativeGroup]}
        weaponTypeId="weapon.fixture.a"
        master={createValidMasterDataFixture()}
        selectedOpportunityIds={[]}
        onToggle={vi.fn()}
        headingLevel="h5"
      />,
    )
    expect(screen.getByRole('heading', { level: 5, name: '途中で利用可能な妥協チェックポイント' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: 'チェックポイント 1' })).toBeInTheDocument()
    // The later-arrival disclosure sits below h6: same ARIA wiring, no heading.
    const later = screen.getByRole('button', { name: 'その他の到達点（1）' })
    expect(screen.queryByRole('heading', { name: 'その他の到達点（1）' })).not.toBeInTheDocument()
    expect(later).toHaveAttribute('aria-controls')
    await user.click(later)
    expect(await screen.findByRole('checkbox', { name: '4手目（理想まで残り1操作）' })).toBeInTheDocument()
    // The secondary disclosure is a sibling of the primary groups (h6), and
    // the groups inside it are labelled text rather than repeated h6s.
    const secondary = screen.getByRole('button', { name: 'その他の候補（1）' })
    expect(screen.getByRole('heading', { level: 6, name: 'その他の候補（1）' })).toContainElement(secondary)
    await user.click(secondary)
    expect(await screen.findByText('チェックポイント 2')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'チェックポイント 2' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '3手目（理想まで残り2操作）' })).toBeInTheDocument()
  })

  it('renders read-only without checkboxes when no toggle handler is supplied', () => {
    render(
      <CompromiseCheckpointList
        groups={[practicalGroup]}
        weaponTypeId="weapon.fixture.a"
        master={createValidMasterDataFixture()}
        selectedOpportunityIds={[practicalGroup.opportunities[0].id]}
      />,
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('利用する: 2手目（理想まで残り3操作）')).toBeInTheDocument()
  })

  it('explains an Ideal Route with no compromise state instead of listing nothing', () => {
    renderList([])
    expect(
      screen.getByText('この理想ルートの途中に、妥協条件を満たす状態はありません。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
