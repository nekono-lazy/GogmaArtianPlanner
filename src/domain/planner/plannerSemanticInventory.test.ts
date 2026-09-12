import { describe, expect, it } from 'vitest'
import type { OwnedGogmaArtianWeapon, OwnedWeapon } from '../models/publicTypes'
import { fixture, sourceWeapon } from '../../test/fixtures/plannerBeam'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { createPlannerSearchStateSemanticKey } from './plannerScoring'

/**
 * The Planner search state semantic key for an inventory holding one weapon.
 *
 * This is the deduplication identity of a Beam Search branch, so anything it
 * drops merges two branches that the Planner would otherwise keep apart.
 */
function inventoryKey(weapon: OwnedWeapon): string {
  const { input } = fixture([], [], [weapon])
  const created = createInitialPlannerSearchState(input, [])
  if (!created.state) throw new Error('Fixture initial state is missing.')
  return createPlannerSearchStateSemanticKey(created.state)
}

function gogma(
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  return { ...sourceWeapon('owned.semantic-inventory'), ...overrides }
}

describe('Planner search state semantic inventory', () => {
  it('ignores the status label: relabelling never splits a branch', () => {
    const base = inventoryKey(gogma({ status: 'unclassified' }))
    for (const status of ['unclassified', 'practical', 'ideal'] as const) {
      expect(inventoryKey(gogma({ status }))).toBe(base)
    }
    expect(base).not.toContain('"status"')
  })

  it('keeps restorationBonusScope semantic', () => {
    // The same five labels under `normal_artian` and `gogma_artian` scope are
    // different results and reach different later Bonus outcomes, so two
    // branches differing only in scope must never deduplicate together
    // (`docs/SEARCH_SPEC.md` 5.1 / 5.5.3).
    const gogmaScope = inventoryKey(gogma({ restorationBonusScope: 'gogma_artian' }))
    const normalScope = inventoryKey(gogma({ restorationBonusScope: 'normal_artian' }))
    expect(normalScope).not.toBe(gogmaScope)
    expect(gogmaScope).toContain('"restorationBonusScope"')
  })

  it('keeps protection semantic', () => {
    expect(inventoryKey(gogma({ isProtected: true }))).not.toBe(
      inventoryKey(gogma({ isProtected: false })),
    )
  })

  it('keeps the restoration bonus slots semantic', () => {
    const base = gogma()
    const changed = gogma({
      restorationBonuses: base.restorationBonuses.map((bonus, index) =>
        index === 0
          ? { ...bonus, bonusRankId: 'bonus_rank.fixture.changed' }
          : bonus,
      ) as OwnedGogmaArtianWeapon['restorationBonuses'],
    })
    expect(inventoryKey(changed)).not.toBe(inventoryKey(base))
  })

  it('keeps Series and Group Skill semantic', () => {
    const base = inventoryKey(gogma())
    expect(inventoryKey(gogma({ seriesSkillId: 'series_skill.fixture.other' })))
      .not.toBe(base)
    expect(inventoryKey(gogma({ groupSkillId: 'group_skill.fixture.other' })))
      .not.toBe(base)
  })

  it('keeps weapon type and element semantic', () => {
    const base = inventoryKey(gogma())
    expect(inventoryKey(gogma({ weaponTypeId: 'weapon.fixture.b' }))).not.toBe(base)
    expect(inventoryKey(gogma({ elementId: 'element.fixture.b' }))).not.toBe(base)
  })

  it('ignores name, memo, and timestamps like status', () => {
    expect(
      inventoryKey(
        gogma({
          name: 'Renamed',
          memo: 'Changed memo',
          updatedAt: '2026-09-01T00:00:00.000Z',
          status: 'ideal',
        }),
      ),
    ).toBe(inventoryKey(gogma({ status: 'unclassified' })))
  })
})
