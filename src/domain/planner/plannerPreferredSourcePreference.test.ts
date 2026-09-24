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

  it('never overrules the existing evaluationScore', () => {
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
 * Two equally rated Targets whose one-operation Routes need the same Gogma
 * Counter position on different weapons, so only one of them can run: a
 * `same_gogma_counter` conflict with no explicit resolution. One Target
 * prefers its Route's source weapon, the other prefers nothing.
 *
 * Each Target holds exactly one BuildListEntry, as every full Planner run does
 * (`docs/DATA_MODEL.md` 9.4.1, `docs/PLANNER_SPEC.md` 4.1 / 9.2.18).
 */
function equalCostScenario(preferredWeaponIndex: 0 | 1) {
  const first = sourceWeapon('owned.preferred.route.first')
  const second = sourceWeapon('owned.preferred.route.second')
  const weapons: OwnedWeapon[] = [first, second]
  const goals: TargetWeapon[] = [
    {
      ...target('target.preferred.route.first'),
      preferredOwnedWeaponId: preferredWeaponIndex === 0 ? first.id : null,
    },
    {
      ...target('target.preferred.route.second'),
      preferredOwnedWeaponId: preferredWeaponIndex === 1 ? second.id : null,
    },
  ]
  const route = (source: OwnedWeapon): BuildRoute => resetRoute(source.id, 10)
  const firstEntry = routeEntry('entry.preferred.route.first', goals[0], route(first))
  const secondEntry = routeEntry('entry.preferred.route.second', goals[1], route(second))
  return {
    ...fixture(goals, [firstEntry, secondEntry], weapons),
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
      const result = await runPlannerBeamSearch(scenario.input, scenario.dependencies, {})
      // Both Entries are equally valid and equally cheap, and only one can
      // take Gogma Counter position 10, so without the preference the stable
      // tie-break alone would decide. Flipping which Target prefers its
      // source flips the selection, which the stable key could never do.
      expect(result.bestState?.selectedBuildListEntryIds).toEqual([
        scenario.preferredEntryId,
      ])
    },
  )

  // That the preference never overrules a cheaper Route is the comparator
  // contract above ('never overrules the existing evaluationScore'): a Beam
  // Search can no longer hold two Routes of one Target to compare them.

  it('never changes a reserved weapon or a Target preference', async () => {
    const scenario = equalCostScenario(0)
    const preferenceBefore = scenario.input.targetWeapons.map(
      ({ id, preferredOwnedWeaponId }) => [id, preferredOwnedWeaponId],
    )
    const result = await runPlannerBeamSearch(scenario.input, scenario.dependencies, {})
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

  it('never compares two Routes of one Target: every full Planner run refuses them', async () => {
    const first = sourceWeapon('owned.preferred.pair.first')
    const second = sourceWeapon('owned.preferred.pair.second')
    const goal: TargetWeapon = {
      ...target('target.preferred.pair'),
      preferredOwnedWeaponId: first.id,
    }
    const firstEntry = routeEntry('entry.preferred.pair.first', goal, resetRoute(first.id, 10))
    const secondEntry = routeEntry('entry.preferred.pair.second', goal, resetRoute(second.id, 10))
    const { input, dependencies } = fixture([goal], [firstEntry, secondEntry], [first, second])

    // The ordinary persisted input fails closed on the legacy duplicate.
    const ordinary = await runPlannerBeamSearch(input, dependencies)
    expect(ordinary.bestState).toBeNull()
    expect(ordinary.expandedStates).toBe(0)
    expect(ordinary.warnings.map(({ kind }) => kind)).toContain(
      'duplicate_build_list_entries_for_target',
    )
    // A trial's full run is the replacement set: the replaced Entry left
    // beside its temporary Entry is refused too (`docs/PLANNER_SPEC.md` 9.2.18).
    const trial = await runPlannerBeamSearch(input, dependencies, {}, {
      kind: 'temporary_replacement',
      replacements: [{
        targetWeaponId: goal.id,
        replacedBuildListEntryId: firstEntry.id,
        generatedBuildListEntryId: secondEntry.id,
      }],
    })
    expect(trial.bestState).toBeNull()
    expect(trial.expandedStates).toBe(0)
  })
})
