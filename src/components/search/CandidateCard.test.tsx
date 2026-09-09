import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type {
  BuildCandidate,
  CandidateBonusAmendmentStep,
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
): BuildCandidate {
  const candidate = createValidBuildCandidate()
  candidate.route = { ...candidate.route, operations }
  if (bonusAmendmentTrace === undefined) {
    delete candidate.bonusAmendmentTrace
  } else {
    candidate.bonusAmendmentTrace = bonusAmendmentTrace
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
