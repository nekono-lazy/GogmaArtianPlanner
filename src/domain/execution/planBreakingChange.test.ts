import { describe, expect, it } from 'vitest'
import { withIntermediateStateSelection } from '../buildList'
import type {
  BuildListEntry,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  ProductionPlan,
  TargetWeapon,
} from '../models/publicTypes'
import { orchestrationSource, orchestrationTarget } from '../../test/fixtures/plannerConstrainedOrchestration'
import {
  checkpointFixture,
  existingGogmaFixture,
  newNormalFixture,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import {
  applyUserChanges,
  detectPlanBreakingMutation,
  type PlanBreakingMutableState,
} from './planBreakingChange'

const EXTRA_WEAPON_ID = 'owned.breaking.outside-scope'

function stateOf({ built }: ExecutionFixture): PlanBreakingMutableState {
  return structuredClone({
    rngState: built.input.rngState,
    normalCounters: built.input.normalCounters,
    ownedWeapons: built.input.ownedWeapons,
    targetWeapons: built.input.targetWeapons,
    buildListEntries: built.input.buildListEntries,
  })
}

function detect(plan: ProductionPlan, before: PlanBreakingMutableState, after: PlanBreakingMutableState) {
  return detectPlanBreakingMutation({ plan, planExecutionHistory: [], before, after })
}

function mapTarget(state: PlanBreakingMutableState, id: string, change: (target: TargetWeapon) => TargetWeapon) {
  return { ...state, targetWeapons: state.targetWeapons.map((target) => (target.id === id ? change(target) : target)) }
}

function mapWeapon(state: PlanBreakingMutableState, id: string, change: (weapon: OwnedGogmaArtianWeapon) => OwnedWeapon) {
  return {
    ...state,
    ownedWeapons: state.ownedWeapons.map((weapon) => (weapon.id === id ? change(weapon as OwnedGogmaArtianWeapon) : weapon)),
  }
}

function mapEntry(state: PlanBreakingMutableState, id: string, change: (entry: BuildListEntry) => BuildListEntry) {
  return { ...state, buildListEntries: state.buildListEntries.map((entry) => (entry.id === id ? change(entry) : entry)) }
}

function mapCounters(state: PlanBreakingMutableState, change: (counter: NormalArtianCounter) => NormalArtianCounter) {
  return { ...state, normalCounters: state.normalCounters.map(change) }
}

describe('detectPlanBreakingMutation: RngState and Normal Counters', () => {
  it('breaks on a semantic RNG change and ignores notes and timestamps', async () => {
    const fixture = await newNormalFixture(3)
    const before = stateOf(fixture)
    const rng = before.rngState!

    expect(detect(fixture.plan, before, { ...before, rngState: { ...rng, gogmaCounter: { ...rng.gogmaCounter, value: 999 } } }))
      .toEqual({ breaksPlan: true, reasons: ['rng_state_changed'] })
    expect(detect(fixture.plan, before, { ...before, rngState: { ...rng, skillCounter: { ...rng.skillCounter, isConfirmed: false } } }))
      .toEqual({ breaksPlan: true, reasons: ['rng_state_changed'] })
    // `source` is outside the expected-state authority, like notes and timestamps.
    expect(detect(fixture.plan, before, { ...before, rngState: { ...rng, baseSeed: { ...rng.baseSeed, source: 'observation' } } })).toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, { ...before, rngState: { ...rng, notes: 'memo', updatedAt: '2026-09-18T09:00:00.000Z' } }))
      .toEqual({ breaksPlan: false })
    // Counter Gate is legacy data, never a Production Prediction input.
    expect(detect(fixture.plan, before, { ...before, rngState: { ...rng, counterGate: { value: 99, isConfirmed: true, source: 'manual' } } }))
      .toEqual({ breaksPlan: false })
  })

  it('breaks on a Counter value or confirmation change and ignores observation metadata', async () => {
    const fixture = await newNormalFixture(3)
    const before = stateOf(fixture)
    expect(before.normalCounters.length).toBeGreaterThan(0)

    expect(detect(fixture.plan, before, mapCounters(before, (counter) => ({ ...counter, counter: (counter.counter ?? 0) + 5 }))))
      .toEqual({ breaksPlan: true, reasons: ['normal_counter_changed'] })
    expect(detect(fixture.plan, before, mapCounters(before, (counter) => ({ ...counter, isConfirmed: !counter.isConfirmed }))))
      .toEqual({ breaksPlan: true, reasons: ['normal_counter_changed'] })
    expect(detect(fixture.plan, before, { ...before, normalCounters: [] }))
      .toEqual({ breaksPlan: true, reasons: ['normal_counter_changed'] })
    expect(detect(fixture.plan, before, mapCounters(before, (counter) => ({
      ...counter,
      observationCount: counter.observationCount + 3,
      candidateCount: 2,
      lastObservedAt: '2026-09-18T09:00:00.000Z',
      updatedAt: '2026-09-18T09:00:00.000Z',
    })))).toEqual({ breaksPlan: false })
  })
})

describe('detectPlanBreakingMutation: TargetWeapon', () => {
  const GOAL = 'target.execution.gogma'
  const OTHER = 'target.execution.other'

  it('breaks on every Plan-dependent planning and execution field', async () => {
    const fixture = await existingGogmaFixture()
    const before = stateOf(fixture)
    const breaks = { breaksPlan: true, reasons: ['target_changed'] }

    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => {
      const changed = structuredClone(target)
      changed.idealBonuses[0].bonusRankId = 'bonus_rank.fixture.changed'
      return changed
    }))).toEqual(breaks)
    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => ({ ...target, priority: target.priority === 5 ? 4 : 5 }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => ({ ...target, isEnabled: !target.isEnabled }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => ({ ...target, preferredOwnedWeaponId: before.ownedWeapons[0].id }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => ({ ...target, lifecycleStatus: 'completed', completedAt: '2026-09-18T09:00:00.000Z' }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, { ...before, targetWeapons: before.targetWeapons.filter(({ id }) => id !== GOAL) }))
      .toEqual(breaks)
  })

  it('never breaks on a name or memo, nor on a Plan-independent or new Target', async () => {
    const fixture = await existingGogmaFixture()
    const before = stateOf(fixture)

    expect(detect(fixture.plan, before, mapTarget(before, GOAL, (target) => ({ ...target, name: 'renamed', memo: 'memo', updatedAt: '2026-09-18T09:00:00.000Z' }))))
      .toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, mapTarget(before, OTHER, (target) => ({ ...target, priority: 1, isEnabled: false, preferredOwnedWeaponId: null }))))
      .toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, { ...before, targetWeapons: [...before.targetWeapons, orchestrationTarget('target.breaking.new')] }))
      .toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, { ...before, targetWeapons: before.targetWeapons.filter(({ id }) => id !== OTHER) }))
      .toEqual({ breaksPlan: false })
  })

  it('judges the whole post-state: a Plan-dependent preference released as a side effect breaks the Plan', async () => {
    const outside = orchestrationSource(EXTRA_WEAPON_ID)
    const fixture = await existingGogmaFixture([outside])
    const linked = mapTarget(stateOf(fixture), GOAL, (target) => ({ ...target, preferredOwnedWeaponId: outside.id }))

    // Protecting a weapon outside the execution scope is no OwnedWeapon break,
    // but the release of the Plan-dependent Target's preference is.
    const protectedAndReleased = mapTarget(
      mapWeapon(linked, outside.id, (weapon) => ({ ...weapon, isProtected: true })),
      GOAL,
      (target) => ({ ...target, preferredOwnedWeaponId: null }),
    )
    expect(detect(fixture.plan, linked, protectedAndReleased)).toEqual({ breaksPlan: true, reasons: ['target_changed'] })

    // A Plan-independent Target taking the weapon over from the Plan-dependent one.
    const takenOver = mapTarget(
      mapTarget(linked, OTHER, (target) => ({ ...target, preferredOwnedWeaponId: outside.id })),
      GOAL,
      (target) => ({ ...target, preferredOwnedWeaponId: null }),
    )
    expect(detect(fixture.plan, linked, takenOver)).toEqual({ breaksPlan: true, reasons: ['target_changed'] })
  })
})

describe('detectPlanBreakingMutation: BuildListEntry', () => {
  it('breaks on a selected Entry checkpoint, improvement preference or delete', async () => {
    const fixture = await checkpointFixture()
    const before = stateOf(fixture)
    const selection = fixture.entry.intermediateStateSelection!
    expect(selection.bonusOpportunityId).not.toBeNull()
    const breaks = { breaksPlan: true, reasons: ['build_list_changed'] }

    expect(detect(fixture.plan, before, mapEntry(before, fixture.entry.id, (entry) =>
      withIntermediateStateSelection(entry, { ...selection, bonusOpportunityId: null })))).toEqual(breaks)
    expect(detect(fixture.plan, before, mapEntry(before, fixture.entry.id, (entry) =>
      withIntermediateStateSelection(entry, { ...selection, improvementPreference: 'skill_first' })))).toEqual(breaks)
    expect(detect(fixture.plan, before, { ...before, buildListEntries: [] })).toEqual(breaks)
  })

  it('never breaks on a non-selected or new Entry, nor on a staleness refresh', async () => {
    const fixture = await checkpointFixture()
    const before = stateOf(fixture)
    const other: BuildListEntry = {
      ...structuredClone(fixture.entry),
      id: 'entry.breaking.other' as BuildListEntry['id'],
    }

    const added = { ...before, buildListEntries: [...before.buildListEntries, other] }
    expect(detect(fixture.plan, before, added)).toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, added, mapEntry(added, other.id, (entry) =>
      withIntermediateStateSelection(entry, { ...entry.intermediateStateSelection!, improvementPreference: 'bonus_first' }))))
      .toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, added, before)).toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, mapEntry(before, fixture.entry.id, (entry) => ({
      ...entry,
      isStale: true,
      staleReasons: ['rng_state_changed'],
      updatedAt: '2026-09-18T09:00:00.000Z',
    })))).toEqual({ breaksPlan: false })
  })
})

describe('detectPlanBreakingMutation: OwnedWeapon', () => {
  const SOURCE = 'owned.execution.gogma'

  it('breaks on a semantic change or delete of an execution scope weapon', async () => {
    const fixture = await existingGogmaFixture()
    const before = stateOf(fixture)
    const breaks = { breaksPlan: true, reasons: ['owned_weapon_changed'] }

    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => {
      const changed = structuredClone(weapon)
      changed.restorationBonuses[0].bonusRankId = 'bonus_rank.fixture.changed'
      return changed
    }))).toEqual(breaks)
    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => ({ ...weapon, seriesSkillId: 'series_skill.fixture.changed' }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => ({ ...weapon, groupSkillId: 'group_skill.fixture.a' }))))
      .toEqual(breaks)
    // Protecting it also invalidates the Plan-independent Target's preference,
    // which is not a Plan-dependent Target: only the weapon breaks the Plan.
    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => ({ ...weapon, isProtected: true }))))
      .toEqual(breaks)
    expect(detect(fixture.plan, before, { ...before, ownedWeapons: before.ownedWeapons.filter(({ id }) => id !== SOURCE) }))
      .toEqual(breaks)
  })

  it('never breaks on status, name, memo or in-progress alone, nor on a weapon outside the scope', async () => {
    const outside = orchestrationSource(EXTRA_WEAPON_ID)
    const fixture = await existingGogmaFixture([outside])
    const before = stateOf(fixture)

    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => ({
      ...weapon,
      status: 'practical',
      name: 'renamed',
      memo: 'memo',
      updatedAt: '2026-09-18T09:00:00.000Z',
    })))).toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, mapWeapon(before, SOURCE, (weapon) => ({
      ...weapon,
      executionInProgress: { productionPlanId: fixture.plan.id, startedAt: '2026-09-18T09:00:00.000Z' },
    })))).toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, mapWeapon(before, outside.id, (weapon) => ({ ...weapon, isProtected: true, seriesSkillId: 'series_skill.fixture.changed' }))))
      .toEqual({ breaksPlan: false })
    expect(detect(fixture.plan, before, { ...before, ownedWeapons: before.ownedWeapons.filter(({ id }) => id !== outside.id) }))
      .toEqual({ breaksPlan: false })
  })

  it('reports every broken premise in a fixed order', async () => {
    const fixture = await existingGogmaFixture()
    const before = stateOf(fixture)
    const rng = before.rngState!
    const after = mapTarget(
      mapWeapon({ ...before, rngState: { ...rng, skillCounter: { ...rng.skillCounter, value: 999 } } }, SOURCE, (weapon) => ({ ...weapon, isProtected: true })),
      'target.execution.gogma',
      (target) => ({ ...target, priority: 1 }),
    )
    expect(detect(fixture.plan, before, after)).toEqual({
      breaksPlan: true,
      reasons: ['rng_state_changed', 'owned_weapon_changed', 'target_changed'],
    })
  })
})

describe('applyUserChanges', () => {
  it('takes only what the user changed from the basis and keeps every other stored value', () => {
    const basis = { a: 1, b: [1, 2], c: 'x' }
    const current = { a: 1, b: [3, 4], c: 'y' }
    expect(applyUserChanges(current, basis, { a: 2, b: [1, 2], c: 'x' })).toEqual({ a: 2, b: [3, 4], c: 'y' })
    expect(applyUserChanges(basis, basis, { a: 5, b: [9], c: 'z' })).toEqual({ a: 5, b: [9], c: 'z' })
  })
})
