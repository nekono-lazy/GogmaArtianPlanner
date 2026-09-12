import { describe, expect, it } from 'vitest'
import type {
  BuildRoute,
  OwnedGogmaArtianWeapon,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import { buildListEntryId, ownedWeaponId } from '../../test/fixtures/domainData'
import {
  fixture,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import {
  advancePlannerWeaponSwitchMetric,
  plannerWeaponOperationSubjectKey,
} from './plannerRouteProgress'
import { comparePlannerSearchStates } from './plannerScoring'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import type { PlannerSearchState } from './plannerTypes'

const FIRST_ENTRY = buildListEntryId('entry.weapon-switch.first')
const SECOND_ENTRY = buildListEntryId('entry.weapon-switch.second')
const WEAPON_A = ownedWeaponId('owned.weapon-switch.a')
const WEAPON_B = ownedWeaponId('owned.weapon-switch.b')

function resetBonuses(
  sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'] | null,
  counter: number,
): RouteOperation {
  return {
    type: 'reset_bonuses',
    sourceOwnedWeaponId,
    gogmaCounterBefore: counter,
    gogmaCounterAfter: counter + 1,
  }
}

function keepBonuses(
  sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'] | null,
  counter: number,
): RouteOperation {
  return {
    type: 'keep_bonuses',
    sourceOwnedWeaponId,
    gogmaCounterBefore: counter,
    gogmaCounterAfter: counter + 1,
  }
}

function resetSkills(
  sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'] | null,
  counter: number,
): RouteOperation {
  return {
    type: 'reset_skills',
    sourceOwnedWeaponId,
    skillCounterBefore: counter,
    skillCounterAfter: counter + 1,
  }
}

function subjectKey(
  entryId: typeof FIRST_ENTRY,
  operation: RouteOperation,
): string | null {
  return plannerWeaponOperationSubjectKey(entryId, operation)
}

describe('Planner weapon operation subject identity', () => {
  it('treats one concrete OwnedWeapon as one subject across BuildListEntries', () => {
    expect(subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_A, 10))).toBe(
      subjectKey(SECOND_ENTRY, resetBonuses(WEAPON_A, 40)),
    )
    // The subject is the weapon, not the operation: the same weapon stays the
    // same subject across Reset Bonuses, Keep Bonuses, and Reset Skills.
    expect(subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_A, 10))).toBe(
      subjectKey(FIRST_ENTRY, keepBonuses(WEAPON_A, 11)),
    )
    expect(subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_A, 10))).toBe(
      subjectKey(FIRST_ENTRY, resetSkills(WEAPON_A, 7)),
    )
    expect(subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_A, 10))).not.toBe(
      subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_B, 10)),
    )
  })

  it('keeps each Entry transient Gogma a separate physical subject', () => {
    expect(subjectKey(FIRST_ENTRY, resetBonuses(null, 10))).toBe(
      subjectKey(FIRST_ENTRY, keepBonuses(null, 11)),
    )
    expect(subjectKey(FIRST_ENTRY, resetBonuses(null, 10))).not.toBe(
      subjectKey(SECOND_ENTRY, resetBonuses(null, 10)),
    )
    expect(subjectKey(FIRST_ENTRY, resetBonuses(null, 10))).not.toBe(
      subjectKey(FIRST_ENTRY, resetBonuses(WEAPON_A, 10)),
    )
  })

  it('reports no subject for operations without a continuously operated weapon', () => {
    expect(
      subjectKey(FIRST_ENTRY, {
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        count: 1,
        normalCounterBefore: 4,
        normalCounterAfter: 5,
      }),
    ).toBeNull()
    expect(
      subjectKey(FIRST_ENTRY, {
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      }),
    ).toBeNull()
  })
})

describe('Planner weapon switch metric', () => {
  function run(subjectKeys: readonly (string | null)[]) {
    const state = { weaponSwitchCount: 0, lastWeaponOperationSubjectKey: null } as
      Pick<
        PlannerSearchState,
        'weaponSwitchCount' | 'lastWeaponOperationSubjectKey'
      >
    subjectKeys.forEach((key) => advancePlannerWeaponSwitchMetric(state, key))
    return state
  }

  it('counts no switch while the same weapon stays selected', () => {
    expect(run(['A', 'A', 'A']).weaponSwitchCount).toBe(0)
  })

  it('counts one switch when the operated weapon changes', () => {
    expect(run(['A', 'B']).weaponSwitchCount).toBe(1)
  })

  it('counts a return to an earlier weapon as another switch', () => {
    expect(run(['A', 'B', 'A']).weaponSwitchCount).toBe(2)
  })

  it('never counts the first operation of a branch as a switch', () => {
    const state = run(['A'])
    expect(state.weaponSwitchCount).toBe(0)
    expect(state.lastWeaponOperationSubjectKey).toBe('A')
  })

  it('leaves both fields untouched for an operation with no weapon subject', () => {
    // `reserve_weapon` and every other subject-less action must not split one
    // weapon's run of operations in two.
    const state = run(['A', null, null, 'A'])
    expect(state.weaponSwitchCount).toBe(0)
    expect(run(['A', null, 'B']).weaponSwitchCount).toBe(1)
    expect(state.lastWeaponOperationSubjectKey).toBe('A')
  })
})

/**
 * Two Entries whose next Route unit is literally the same physical action on
 * the same concrete OwnedWeapon. PR #4 sharing runs both with one operation, so
 * the switch metric must judge that operation once.
 */
function sharedActionScenario() {
  const source = sourceWeapon('owned.weapon-switch.shared')
  const firstTarget = target('target.weapon-switch.shared.first')
  const secondTarget = target('target.weapon-switch.shared.second')
  const route = (): BuildRoute => ({
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: source.id,
    operations: [resetBonuses(source.id, 10)],
  })
  const first = routeEntry(
    'entry.weapon-switch.shared.first',
    firstTarget,
    route(),
  )
  const second = routeEntry(
    'entry.weapon-switch.shared.second',
    secondTarget,
    route(),
  )
  return {
    ...fixture([firstTarget, secondTarget], [first, second], [source]),
    first,
    second,
  }
}

/** One Entry performing three operations in a row on one owned weapon. */
function singleWeaponScenario() {
  const source = sourceWeapon('owned.weapon-switch.single')
  const only = target('target.weapon-switch.single')
  const entry = routeEntry('entry.weapon-switch.single', only, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: source.id,
    operations: [
      resetBonuses(source.id, 10),
      resetBonuses(source.id, 11),
      resetBonuses(source.id, 12),
    ],
  })
  return { ...fixture([only], [entry], [source]), entry }
}

/** Two Entries on two different owned weapons and two different streams. */
function twoWeaponScenario(): {
  input: ReturnType<typeof fixture>['input']
  dependencies: ReturnType<typeof fixture>['dependencies']
  bonusTarget: TargetWeapon
  skillTarget: TargetWeapon
} {
  const bonusSource = sourceWeapon('owned.weapon-switch.two.bonus')
  // A second element keeps the two Targets genuinely separate: identical Target
  // definitions would let one reserved weapon satisfy both.
  const skillSource = {
    ...sourceWeapon('owned.weapon-switch.two.skill'),
    elementId: 'element.fixture.b',
  }
  const bonusTarget = target('target.weapon-switch.two.bonus')
  const skillTarget = {
    ...target('target.weapon-switch.two.skill'),
    elementId: 'element.fixture.b',
  }
  const bonusEntry = routeEntry('entry.weapon-switch.two.bonus', bonusTarget, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: bonusSource.id,
    operations: [resetBonuses(bonusSource.id, 10)],
  })
  const skillEntry = routeEntry('entry.weapon-switch.two.skill', skillTarget, {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: skillSource.id,
    operations: [resetSkills(skillSource.id, 7)],
  })
  return {
    ...fixture(
      [bonusTarget, skillTarget],
      [bonusEntry, skillEntry],
      [bonusSource, skillSource],
    ),
    bonusTarget,
    skillTarget,
  }
}

describe('Planner weapon switch metric in Beam Search', () => {
  it('counts no switch for consecutive operations on one owned weapon', async () => {
    const { input, dependencies } = singleWeaponScenario()
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(
      result.bestState?.trace.filter(({ kind }) => kind === 'route_operation'),
    ).toHaveLength(3)
    expect(result.bestState?.weaponSwitchCount).toBe(0)
  })

  it('counts one switch across two different owned weapons', async () => {
    const { input, dependencies } = twoWeaponScenario()
    const result = await runPlannerBeamSearch(input, dependencies)
    expect(
      result.bestState?.trace.filter(({ kind }) => kind === 'route_operation'),
    ).toHaveLength(2)
    expect(result.bestState?.weaponSwitchCount).toBe(1)
    // The two `reserve_weapon` actions between and after them add nothing.
    expect(
      result.bestState?.trace.filter(
        ({ kind }) => kind === 'reserve_candidate',
      ),
    ).toHaveLength(2)
  })

  it('counts a shared physical action once instead of once per Entry', async () => {
    const { input, dependencies, first, second } = sharedActionScenario()
    const result = await runPlannerBeamSearch(input, dependencies)
    const routeActions =
      result.bestState?.trace.filter(({ kind }) => kind === 'route_operation') ??
      []
    expect(routeActions).toHaveLength(1)
    expect(routeActions[0]?.progressedBuildListEntryIds).toEqual(
      [first.id, second.id].sort(),
    )
    expect(result.bestState?.weaponSwitchCount).toBe(0)
  })
})

describe('comparePlannerSearchStates weapon switch preference', () => {
  function partial(
    values: Partial<PlannerSearchState>,
  ): PlannerSearchState {
    return {
      evaluationScore: 0,
      weaponSwitchCount: 0,
      ...values,
    } as PlannerSearchState
  }

  it('keeps the existing evaluationScore above a lower weapon switch count', () => {
    const higherScore = partial({ evaluationScore: 20, weaponSwitchCount: 9 })
    const fewerSwitches = partial({ evaluationScore: 10, weaponSwitchCount: 0 })
    expect(comparePlannerSearchStates(higherScore, fewerSwitches)).toBeLessThan(
      0,
    )
  })

  it('prefers fewer weapon switches only once the existing evaluation ties', () => {
    const fewerSwitches = partial({ evaluationScore: 10, weaponSwitchCount: 1 })
    const moreSwitches = partial({ evaluationScore: 10, weaponSwitchCount: 3 })
    expect(comparePlannerSearchStates(fewerSwitches, moreSwitches)).toBeLessThan(
      0,
    )
    expect(comparePlannerSearchStates(moreSwitches, fewerSwitches)).toBeGreaterThan(
      0,
    )
  })

  it('falls through to the existing stable tie-breaks when switch counts tie', () => {
    const { input } = twoWeaponScenario()
    const first = createInitialPlannerSearchState(input, []).state
    const second = createInitialPlannerSearchState(input, []).state
    if (!first || !second) throw new Error('Fixture initial state is missing.')
    expect(first.weaponSwitchCount).toBe(0)
    expect(first.lastWeaponOperationSubjectKey).toBeNull()
    expect(comparePlannerSearchStates(first, second)).toBe(0)

    // Only the semantic state differs, so the semantic key decides, exactly as
    // it did before the weapon switch preference existed.
    second.currentRngState.gogmaCounter.value = 11
    expect(comparePlannerSearchStates(first, second)).not.toBe(0)
    expect(comparePlannerSearchStates(first, second)).toBe(
      -comparePlannerSearchStates(second, first),
    )
  })
})
