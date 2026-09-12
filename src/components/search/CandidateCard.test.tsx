import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type {
  BuildCandidate,
  CandidateBonusAmendmentStep,
  CandidateConversionSkillStep,
  CandidateSkillAmendmentStep,
  RestorationBonusSet,
  RouteOperation,
} from '../../domain/models/publicTypes'
import {
  createValidBuildCandidate,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { CandidateCard } from './CandidateCard'

const ATTACK = 'bonus_type.fixture.attack'
const UNUSED = 'bonus_type.fixture.unused'
const HIGH = 'bonus_rank.fixture.high'
const SPECIAL = 'bonus_rank.fixture.special'

/** Labels resolved by `bonusLabel` for `weapon.fixture.a`. */
const labels = {
  attackHigh: '攻撃High fixture',
  attackSpecial: '攻撃Special fixture',
  unusedHigh: '未使用fixture High fixture',
  unusedSpecial: '未使用fixture Special fixture',
}

const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId })

/** Attack / attack / unused / unused / attack, with distinguishable tiers. */
const firstResult = (): RestorationBonusSet => [
  bonus(ATTACK, HIGH),
  bonus(ATTACK, SPECIAL),
  bonus(UNUSED, HIGH),
  bonus(UNUSED, SPECIAL),
  bonus(ATTACK, HIGH),
]

/** The same five bonuses as `firstResult`, held in a different slot order. */
const reorderedFirstResult = (): RestorationBonusSet => [
  bonus(UNUSED, SPECIAL),
  bonus(ATTACK, HIGH),
  bonus(ATTACK, SPECIAL),
  bonus(ATTACK, HIGH),
  bonus(UNUSED, HIGH),
]

const secondResult = (): RestorationBonusSet => [
  bonus(ATTACK, SPECIAL),
  bonus(ATTACK, SPECIAL),
  bonus(UNUSED, HIGH),
  bonus(ATTACK, HIGH),
  bonus(UNUSED, HIGH),
]

function amendment(
  gogmaCounterBefore: number,
  type: 'reset_bonuses' | 'keep_bonuses',
): RouteOperation {
  return {
    type,
    sourceOwnedWeaponId: null,
    gogmaCounterBefore,
    gogmaCounterAfter: gogmaCounterBefore + 1,
  }
}

function traceStep(
  operationIndex: number,
  operationType: 'reset_bonuses' | 'keep_bonuses',
  restorationBonuses: RestorationBonusSet,
): CandidateBonusAmendmentStep {
  return {
    operationIndex,
    operationType,
    restorationBonuses,
    restorationBonusScope: 'gogma_artian',
  }
}

function candidateWith(
  operations: RouteOperation[],
  bonusAmendmentTrace: CandidateBonusAmendmentStep[] | undefined,
  skillAmendmentTrace?: CandidateSkillAmendmentStep[],
  conversionSkillTrace?: CandidateConversionSkillStep,
): BuildCandidate {
  const candidate = createValidBuildCandidate()
  candidate.route = { ...candidate.route, operations }
  if (bonusAmendmentTrace === undefined) {
    delete candidate.bonusAmendmentTrace
  } else {
    candidate.bonusAmendmentTrace = bonusAmendmentTrace
  }
  if (skillAmendmentTrace === undefined) {
    delete candidate.skillAmendmentTrace
  } else {
    candidate.skillAmendmentTrace = skillAmendmentTrace
  }
  if (conversionSkillTrace === undefined) {
    delete candidate.conversionSkillTrace
  } else {
    candidate.conversionSkillTrace = conversionSkillTrace
  }
  return candidate
}

// The Target supplies the weapon type, so every slot resolves to its
// weapon-specific Master label rather than the generic fallback.
const target = () => createValidTargetWeapon()

async function renderExpanded(candidate: BuildCandidate) {
  const master = createValidMasterDataFixture()
  const view = render(
    <CandidateCard candidate={candidate} target={target()} master={master} />,
  )
  await userEvent.click(screen.getByText('候補詳細・作成ルート'))
  return view
}

function routeStepTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('ol li')].map(
    (item) => item.textContent ?? '',
  )
}

describe('CandidateCard route bonus results', () => {
  it('shows the predicted five slots next to each Reset and Keep', async () => {
    const candidate = candidateWith(
      [
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        amendment(10, 'reset_bonuses'),
        amendment(11, 'keep_bonuses'),
      ],
      [
        traceStep(1, 'reset_bonuses', firstResult()),
        traceStep(2, 'keep_bonuses', secondResult()),
      ],
    )
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      '巨戟アーティアへ変換',
      [
        '復元ボーナスをリセット予測結果:',
        labels.attackHigh,
        labels.attackSpecial,
        labels.unusedHigh,
        labels.unusedSpecial,
        labels.attackHigh,
      ].join(''),
      [
        '復元ボーナスを保持して再抽選予測結果:',
        labels.attackSpecial,
        labels.attackSpecial,
        labels.unusedHigh,
        labels.attackHigh,
        labels.unusedHigh,
      ].join(''),
    ])
  })

  it('keeps each repeated Reset bound to its own predicted result', async () => {
    const candidate = candidateWith(
      [
        amendment(10, 'reset_bonuses'),
        amendment(11, 'reset_bonuses'),
        amendment(12, 'reset_bonuses'),
      ],
      [
        traceStep(0, 'reset_bonuses', firstResult()),
        traceStep(1, 'reset_bonuses', reorderedFirstResult()),
        traceStep(2, 'reset_bonuses', secondResult()),
      ],
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts).toHaveLength(3)
    expect(new Set(texts).size).toBe(3)
    expect(texts[0]).toContain(
      [labels.attackHigh, labels.attackSpecial, labels.unusedHigh].join(''),
    )
    expect(texts[2]).toContain(
      [labels.attackSpecial, labels.attackSpecial, labels.unusedHigh].join(''),
    )
  })

  it('distinguishes the same five bonuses held in a different slot order', async () => {
    const candidate = candidateWith(
      [amendment(10, 'reset_bonuses'), amendment(11, 'keep_bonuses')],
      [
        traceStep(0, 'reset_bonuses', firstResult()),
        traceStep(1, 'keep_bonuses', reorderedFirstResult()),
      ],
    )
    const { container } = await renderExpanded(candidate)
    const [first, second] = routeStepTexts(container).map((text) =>
      text.replace(/^[^:]*予測結果:/, ''),
    )

    expect(first).not.toBe(second)
    expect(first).toBe(
      [
        labels.attackHigh,
        labels.attackSpecial,
        labels.unusedHigh,
        labels.unusedSpecial,
        labels.attackHigh,
      ].join(''),
    )
    expect(second).toBe(
      [
        labels.unusedSpecial,
        labels.attackHigh,
        labels.attackSpecial,
        labels.attackHigh,
        labels.unusedHigh,
      ].join(''),
    )
  })

  it('never shows a predicted result on a non-amendment operation', async () => {
    const candidate = candidateWith(
      [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 2,
          normalCounterBefore: 4,
          normalCounterAfter: 6,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        amendment(10, 'reset_bonuses'),
        {
          type: 'reset_skills',
          sourceOwnedWeaponId: null,
          skillCounterBefore: 8,
          skillCounterAfter: 9,
        },
      ],
      [traceStep(2, 'reset_bonuses', firstResult())],
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts[0]).toBe('通常アーティアを作成 × 2')
    expect(texts[1]).toBe('巨戟アーティアへ変換')
    expect(texts[2]).toContain('予測結果:')
    expect(texts[3]).toBe('スキルをリセット')
    expect(screen.getAllByText('予測結果:')).toHaveLength(1)
  })

  it('renders a Candidate saved before the trace existed without predictions', async () => {
    const candidate = candidateWith(
      [amendment(10, 'reset_bonuses'), amendment(11, 'keep_bonuses')],
      undefined,
    )
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      '復元ボーナスをリセット',
      '復元ボーナスを保持して再抽選',
    ])
    expect(screen.queryByText('予測結果:')).toBeNull()
    expect(
      screen.getByText('この候補には各復元ボーナス操作後の予測結果が記録されていません。'),
    ).toBeTruthy()
  })

  it('mounts the route detail only while the accordion is open', () => {
    const candidate = candidateWith([amendment(10, 'reset_bonuses')], [
      traceStep(0, 'reset_bonuses', firstResult()),
    ])
    const master = createValidMasterDataFixture()
    const { container } = render(
      <CandidateCard candidate={candidate} target={target()} master={master} />,
    )

    expect(container.querySelectorAll('ol li')).toHaveLength(0)
  })
})

describe('CandidateCard route skill results', () => {
  /** Resolved by `seriesSkillLabel` / `groupSkillLabel` from the Master fixture. */
  const skillLabels = {
    series: 'シリーズfixture',
    disabledSeries: '無効シリーズfixture',
    group: 'グループfixture',
    none: 'なし',
  }

  const resetSkills = (skillCounterBefore: number): RouteOperation => ({
    type: 'reset_skills',
    sourceOwnedWeaponId: null,
    skillCounterBefore,
    skillCounterAfter: skillCounterBefore + 1,
  })

  function skillStep(
    operationIndex: number,
    seriesSkillId: string | null,
    groupSkillId: string | null,
  ): CandidateSkillAmendmentStep {
    return { operationIndex, operationType: 'reset_skills', seriesSkillId, groupSkillId }
  }

  it('shows the predicted Series and Group next to a single Reset Skills', async () => {
    const candidate = candidateWith(
      [resetSkills(8)],
      undefined,
      [skillStep(0, 'series_skill.fixture.enabled', 'group_skill.fixture.enabled')],
    )
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      `スキルをリセット予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.group}`,
    ])
    // Master-backed labels only; a raw Master ID must never reach the card.
    expect(container.textContent).not.toContain('series_skill.fixture.enabled')
  })

  it('keeps each repeated Reset Skills bound to its own predicted result', async () => {
    const candidate = candidateWith(
      [resetSkills(8), resetSkills(9), resetSkills(10)],
      undefined,
      [
        skillStep(0, 'series_skill.fixture.enabled', null),
        skillStep(1, 'series_skill.fixture.disabled', 'group_skill.fixture.enabled'),
        skillStep(2, null, 'group_skill.fixture.enabled'),
      ],
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts).toHaveLength(3)
    expect(new Set(texts).size).toBe(3)
    expect(texts[0]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.none}`,
    )
    expect(texts[1]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.disabledSeries} ／ グループ: ${skillLabels.group}`,
    )
    expect(texts[2]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.none} ／ グループ: ${skillLabels.group}`,
    )
  })

  it('shows bonus and skill predictions on their own operations', async () => {
    const candidate = candidateWith(
      [amendment(10, 'reset_bonuses'), amendment(11, 'keep_bonuses'), resetSkills(8), resetSkills(9)],
      [
        traceStep(0, 'reset_bonuses', firstResult()),
        traceStep(1, 'keep_bonuses', secondResult()),
      ],
      [
        skillStep(2, 'series_skill.fixture.enabled', null),
        skillStep(3, null, 'group_skill.fixture.enabled'),
      ],
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts[0]).toContain(labels.attackHigh)
    expect(texts[0]).not.toContain('シリーズ:')
    expect(texts[1]).toContain(labels.attackSpecial)
    expect(texts[1]).not.toContain('シリーズ:')
    expect(texts[2]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.none}`,
    )
    expect(texts[3]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.none} ／ グループ: ${skillLabels.group}`,
    )
  })

  it('renders a Candidate saved before the skill trace existed without predictions', async () => {
    const candidate = candidateWith([resetSkills(8), resetSkills(9)], undefined, undefined)
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual(['スキルをリセット', 'スキルをリセット'])
    expect(screen.queryByText('予測結果:')).toBeNull()
    expect(
      screen.getByText('この候補には各スキルリセット後の予測結果が記録されていません。'),
    ).toBeTruthy()
  })

  it('never attaches a skill prediction to a non-Reset-Skills operation', async () => {
    const candidate = candidateWith(
      [
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        resetSkills(8),
      ],
      undefined,
      [skillStep(1, 'series_skill.fixture.enabled', null)],
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts[0]).toBe('巨戟アーティアへ変換')
    expect(texts[1]).toContain('予測結果:')
    expect(screen.getAllByText('予測結果:')).toHaveLength(1)
  })

  it('keeps the final Skill summary above the route detail', async () => {
    const candidate = candidateWith(
      [resetSkills(8)],
      undefined,
      [skillStep(0, 'series_skill.fixture.disabled', null)],
    )
    await renderExpanded(candidate)

    // The card header shows the finished weapon; the route step shows what that
    // one operation produces. `createValidBuildCandidate` uses a Master ID the
    // fixture does not define, so the header keeps its own fallback label.
    expect(screen.getByText(/不明なシリーズスキル/)).toBeTruthy()
    expect(screen.getByText(new RegExp(skillLabels.disabledSeries))).toBeTruthy()
  })
})

describe('CandidateCard conversion skill result', () => {
  /** Resolved by `seriesSkillLabel` / `groupSkillLabel` from the Master fixture. */
  const skillLabels = {
    series: 'シリーズfixture',
    disabledSeries: '無効シリーズfixture',
    group: 'グループfixture',
    none: 'なし',
  }

  const conversion: RouteOperation = {
    type: 'convert_normal_to_gogma',
    weaponTypeId: 'weapon.fixture.a',
    skillCounterBefore: 7,
    skillCounterAfter: 8,
  }

  const create: RouteOperation = {
    type: 'create_normal_artian',
    weaponTypeId: 'weapon.fixture.a',
    rarity: 8,
    count: 1,
    normalCounterBefore: 4,
    normalCounterAfter: 5,
  }

  const resetSkills = (skillCounterBefore: number): RouteOperation => ({
    type: 'reset_skills',
    sourceOwnedWeaponId: null,
    skillCounterBefore,
    skillCounterAfter: skillCounterBefore + 1,
  })

  function conversionStep(
    operationIndex: number,
    seriesSkillId: string | null,
    groupSkillId: string | null,
  ): CandidateConversionSkillStep {
    return {
      operationIndex,
      operationType: 'convert_normal_to_gogma',
      seriesSkillId,
      groupSkillId,
    }
  }

  it('shows the predicted Series and Group next to the conversion', async () => {
    const candidate = candidateWith(
      [create, conversion],
      undefined,
      [],
      conversionStep(1, 'series_skill.fixture.enabled', 'group_skill.fixture.enabled'),
    )
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      '通常アーティアを作成 × 1',
      `巨戟アーティアへ変換予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.group}`,
    ])
    // Master-backed labels only; a raw Master ID must never reach the card.
    expect(container.textContent).not.toContain('series_skill.fixture.enabled')
  })

  it('keeps the conversion result separate from each later Reset Skills', async () => {
    const candidate = candidateWith(
      [create, conversion, resetSkills(8), resetSkills(9)],
      undefined,
      [
        { operationIndex: 2, operationType: 'reset_skills', seriesSkillId: 'series_skill.fixture.disabled', groupSkillId: null },
        { operationIndex: 3, operationType: 'reset_skills', seriesSkillId: null, groupSkillId: 'group_skill.fixture.enabled' },
      ],
      conversionStep(1, 'series_skill.fixture.enabled', 'group_skill.fixture.enabled'),
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts[0]).toBe('通常アーティアを作成 × 1')
    expect(texts[1]).toBe(
      `巨戟アーティアへ変換予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.group}`,
    )
    expect(texts[2]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.disabledSeries} ／ グループ: ${skillLabels.none}`,
    )
    expect(texts[3]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.none} ／ グループ: ${skillLabels.group}`,
    )
    expect(screen.getAllByText('予測結果:')).toHaveLength(3)
  })

  it('shows the conversion, bonus, and skill predictions on their own operations', async () => {
    const candidate = candidateWith(
      [create, conversion, amendment(10, 'reset_bonuses'), resetSkills(8)],
      [traceStep(2, 'reset_bonuses', firstResult())],
      [{ operationIndex: 3, operationType: 'reset_skills', seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: null }],
      conversionStep(1, 'series_skill.fixture.disabled', null),
    )
    const { container } = await renderExpanded(candidate)
    const texts = routeStepTexts(container)

    expect(texts[1]).toBe(
      `巨戟アーティアへ変換予測結果:シリーズ: ${skillLabels.disabledSeries} ／ グループ: ${skillLabels.none}`,
    )
    expect(texts[2]).toContain(labels.attackHigh)
    expect(texts[2]).not.toContain('シリーズ:')
    expect(texts[3]).toBe(
      `スキルをリセット予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.none}`,
    )
  })

  it('renders a conversion Candidate saved before the field existed without predictions', async () => {
    const candidate = candidateWith([create, conversion], undefined, [], undefined)
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      '通常アーティアを作成 × 1',
      '巨戟アーティアへ変換',
    ])
    expect(screen.queryByText('予測結果:')).toBeNull()
    // Legacy Candidates get no extra note for the conversion Skill: the record
    // is simply omitted rather than announced.
    expect(container.textContent).not.toContain('巨戟化時')
  })

  it('shows no conversion prediction on a route without a conversion', async () => {
    const candidate = candidateWith(
      [resetSkills(8)],
      undefined,
      [{ operationIndex: 0, operationType: 'reset_skills', seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: null }],
      undefined,
    )
    const { container } = await renderExpanded(candidate)

    expect(routeStepTexts(container)).toEqual([
      `スキルをリセット予測結果:シリーズ: ${skillLabels.series} ／ グループ: ${skillLabels.none}`,
    ])
    expect(screen.getAllByText('予測結果:')).toHaveLength(1)
  })
})
