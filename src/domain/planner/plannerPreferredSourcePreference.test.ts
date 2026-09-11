import { describe, expect, it } from 'vitest'
import type { BuildRoute, OwnedWeapon, TargetWeapon } from '../models/publicTypes'
import { buildListEntryId, ownedWeaponId } from '../../test/fixtures/domainData'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import {
  advancePlannerPreferredSourceMetric,
  collectPreferredSourceEntryIds,
  isPreferredSourceEntry,
} from './plannerPreferredSource'
import {
  comparePlannerSearchStates,
  createPlannerSearchStateSemanticKey,
} from './plannerScoring'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import type { PlannerSearchState } from './plannerTypes'

const PREFERRED_ENTRY = buildListEntryId('entry.preferred')
const OTHER_ENTRY = buildListEntryId('entry.other')

function state(overrides: Partial<PlannerSearchState> = {}): PlannerSearchState {
  const { input } = fixture([], [], [])
  const created = createInitialPlannerSearchState(input, [])
  if (!created.state) throw new Error('Fixture initial state is missing.')
  return { ...created.state, ...overrides }
}

describe('Planner preferred source identity', () => {
  const weapon = sourceWeapon('owned.preferred.identity')
  const goal = target('target.preferred.identity')
  const entry = routeEntry('entry.preferred.identity', goal, resetRoute(weapon.id))

  it('matches on the Route source owned weapon ID', () => {
    expect(
      isPreferredSourceEntry(entry, {
        ...goal,
        preferredOwnedWeaponId: weapon.id,
      }),
    ).toBe(true)
    expect(
      isPreferredSourceEntry(entry, {
        ...goal,
        preferredOwnedWeaponId: ownedWeaponId('owned.preferred.elsewhere'),
      }),
    ).toBe(false)
  })

  it('is never preferred with no preference set or no Target', () => {
    expect(isPreferredSourceEntry(entry, goal)).toBe(false)
    expect(isPreferredSourceEntry(entry, undefined)).toBe(false)
  })

  it('never treats a new-Normal route as preferred, whose source is null', () => {
    const blind = routeEntry('entry.preferred.blind', goal, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [],
    })
    // A preference names an owned weapon, and a new-Normal route starts from
    // none, so a null preference must not match a null source either.
    expect(
      isPreferredSourceEntry(blind, {
        ...goal,
        preferredOwnedWeaponId: weapon.id,
      }),
    ).toBe(false)
    expect(isPreferredSourceEntry(blind, goal)).toBe(false)
  })

  it('collects only the Entries whose Target prefers their source', () => {
    const other = routeEntry(
      'entry.preferred.other',
      goal,
      resetRoute('owned.preferred.other'),
    )
    const ids = collectPreferredSourceEntryIds(
      [entry, other],
      new Map([[goal.id, { ...goal, preferredOwnedWeaponId: weapon.id }]]),
    )
    expect([...ids]).toEqual([entry.id])
  })
})

describe('Planner preferred source metric', () => {
  it('counts one per progressed Entry whose Route is preferred', () => {
    const metric = { preferredSourceProgressCount: 0 }
    const preferredIds = new Set([PREFERRED_ENTRY])
    advancePlannerPreferredSourceMetric(metric, [PREFERRED_ENTRY], preferredIds)
    advancePlannerPreferredSourceMetric(metric, [OTHER_ENTRY], preferredIds)
    expect(metric.preferredSourceProgressCount).toBe(1)
    // One shared physical action progressing both Entries counts only its
    // preferred participants.
    advancePlannerPreferredSourceMetric(
      metric,
      [PREFERRED_ENTRY, OTHER_ENTRY],
      preferredIds,
    )
    expect(metric.preferredSourceProgressCount).toBe(2)
  })

  it('counts nothing for an action that progressed no Entry', () => {
    const metric = { preferredSourceProgressCount: 0 }
    // A silent fast-forward progresses Route position only, so it never appears
    // in `progressedBuildListEntryIds` (`docs/PLANNER_SPEC.md` 7.0.2).
    advancePlannerPreferredSourceMetric(metric, [], new Set([PREFERRED_ENTRY]))
    expect(metric.preferredSourceProgressCount).toBe(0)
  })
})

describe('comparePlannerSearchStates preferred-source position', () => {
  it('prefers more preferred-source progress when the existing evaluation ties', () => {
    const less = state({ evaluationScore: 100, preferredSourceProgressCount: 1 })
    const more = state({ evaluationScore: 100, preferredSourceProgressCount: 2 })
    expect(comparePlannerSearchStates(more, less)).toBeLessThan(0)
  })

  it('never overrules practical-first progress or evaluationScore', () => {
    const betterScore = state({
      evaluationScore: 200,
      preferredSourceProgressCount: 0,
    })
    const preferredButWorse = state({
      evaluationScore: 100,
      preferredSourceProgressCount: 5,
    })
    expect(comparePlannerSearchStates(betterScore, preferredButWorse))
      .toBeLessThan(0)

    const practicalFirst = state({
      evaluationScore: 100,
      preferredSourceProgressCount: 0,
      practicalFirstProgressTargetIds: [target('target.practical-first').id],
    })
    expect(comparePlannerSearchStates(practicalFirst, preferredButWorse))
      .toBeLessThan(0)
  })

  it('outranks the weapon switch count and both stable tie-breaks', () => {
    const preferred = state({
      evaluationScore: 100,
      preferredSourceProgressCount: 2,
      weaponSwitchCount: 9,
    })
    const fewerSwitches = state({
      evaluationScore: 100,
      preferredSourceProgressCount: 1,
      weaponSwitchCount: 0,
    })
    expect(comparePlannerSearchStates(preferred, fewerSwitches)).toBeLessThan(0)
    // With the preference equal, the switch count decides again.
    expect(
      comparePlannerSearchStates(
        { ...preferred, preferredSourceProgressCount: 1 },
        fewerSwitches,
      ),
    ).toBeGreaterThan(0)
  })

  it('stays out of the state semantic key', () => {
    // Like `weaponSwitchCount`, it is a pure function of the trace projection
    // the key already carries (`docs/PLANNER_SPEC.md` 7.4).
    const base = state({ preferredSourceProgressCount: 0 })
    expect(
      createPlannerSearchStateSemanticKey({
        ...base,
        preferredSourceProgressCount: 7,
      }),
    ).toBe(createPlannerSearchStateSemanticKey(base))
    expect(createPlannerSearchStateSemanticKey(base)).not.toContain(
      'preferredSourceProgressCount',
    )
  })
})

/**
 * Two equally rated ways to reach the same Target: one from the weapon the
 * Target prefers, one from an identical weapon it does not.
 */
function equalCostScenario(preferredWeaponIndex: 0 | 1) {
  const first = sourceWeapon('owned.preferred.route.first')
  const second = sourceWeapon('owned.preferred.route.second')
  const weapons: OwnedWeapon[] = [first, second]
  const goal: TargetWeapon = {
    ...target('target.preferred.route'),
    preferredOwnedWeaponId: weapons[preferredWeaponIndex].id,
  }
  const route = (source: OwnedWeapon): BuildRoute => resetRoute(source.id, 10)
  const firstEntry = routeEntry(
    'entry.preferred.route.first',
    goal,
    route(first),
  )
  const secondEntry = routeEntry(
    'entry.preferred.route.second',
    goal,
    route(second),
  )
  return {
    ...fixture([goal], [firstEntry, secondEntry], weapons),
    firstEntry,
    secondEntry,
    preferredEntryId: preferredWeaponIndex === 0 ? firstEntry.id : secondEntry.id,
  }
}

describe('Planner preferred source in Beam Search', () => {
  it.each([0, 1] as const)(
    'selects the preferred source Entry (%i) when the two are otherwise equal',
    async (preferredWeaponIndex) => {
      const scenario = equalCostScenario(preferredWeaponIndex)
      const result = await runPlannerBeamSearch(
        scenario.input,
        scenario.dependencies,
      )
      // Both Entries are equally valid and equally cheap, so without the
      // preference the stable tie-break alone would decide. Flipping which
      // weapon is preferred flips the selection, which the stable key could
      // never do.
      // Exactly one Entry is selected, so this is a genuine choice between the
      // two rather than both being taken.
      expect(result.bestState?.selectedBuildListEntryIds).toEqual([
        scenario.preferredEntryId,
      ])
    },
  )

  it('keeps the cheaper non-preferred Route when the preferred one costs more', async () => {
    const near = sourceWeapon('owned.preferred.cost.near')
    const far = sourceWeapon('owned.preferred.cost.far')
    const goal: TargetWeapon = {
      ...target('target.preferred.cost'),
      preferredOwnedWeaponId: far.id,
    }
    const nearEntry = routeEntry(
      'entry.preferred.cost.near',
      goal,
      resetRoute(near.id, 10),
    )
    const farEntry = routeEntry('entry.preferred.cost.far', goal, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: far.id,
      operations: [
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: far.id,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        },
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: far.id,
          gogmaCounterBefore: 11,
          gogmaCounterAfter: 12,
        },
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: far.id,
          gogmaCounterBefore: 12,
          gogmaCounterAfter: 13,
        },
      ],
    })
    const { input, dependencies } = fixture(
      [goal],
      [nearEntry, farEntry],
      [near, far],
    )
    const result = await runPlannerBeamSearch(input, dependencies)
    // The preference sits below every cost term, so the one-operation Route
    // wins even though the three-operation one starts from the preferred
    // weapon (`docs/PLANNER_SPEC.md` 7.4).
    expect(result.bestState?.selectedBuildListEntryIds).toEqual([nearEntry.id])
  })

  it('never changes a reserved weapon or a Target preference', async () => {
    const scenario = equalCostScenario(0)
    const preferenceBefore = scenario.input.targetWeapons.map(
      ({ id, preferredOwnedWeaponId }) => [id, preferredOwnedWeaponId],
    )
    const result = await runPlannerBeamSearch(
      scenario.input,
      scenario.dependencies,
    )
    // reserve_weapon secures a Candidate result; it is never a licence to
    // rewrite the user's planning input (`docs/PLANNER_SPEC.md` 7.4).
    expect(
      scenario.input.targetWeapons.map(({ id, preferredOwnedWeaponId }) => [
        id,
        preferredOwnedWeaponId,
      ]),
    ).toEqual(preferenceBefore)
    result.bestState?.simulatedInventory.ownedWeapons.forEach((weapon) => {
      expect(weapon).not.toHaveProperty('relatedTargetWeaponIds')
    })
  })
})
