import { describe, expect, it } from 'vitest'
import type { BuildRoute, TargetWeapon } from '../models/publicTypes'
import {
  createRestorationBonusSet,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { entryIsRelevantForState } from './plannerEntryRelevance'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { runPlannerBeamSearch } from './plannerBeamSearch'

function singleEntryFixture() {
  const goal = target('target.preflight.single')
  const source = sourceWeapon('owned.preflight.single')
  const entry = routeEntry('entry.preflight.single', goal, resetRoute(source.id))
  return { goal, source, entry, ...fixture([goal], [entry], [source]) }
}

function conflictFixture() {
  const firstTarget = target('target.preflight.conflict.first', 5)
  const secondTarget = target('target.preflight.conflict.second', 1)
  const firstSource = sourceWeapon('owned.preflight.conflict.first')
  const secondSource = sourceWeapon('owned.preflight.conflict.second')
  const first = routeEntry(
    'entry.preflight.conflict.first',
    firstTarget,
    resetRoute(firstSource.id),
  )
  const second = routeEntry(
    'entry.preflight.conflict.second',
    secondTarget,
    resetRoute(secondSource.id),
  )
  return { first, second, firstTarget, secondTarget, firstSource, secondSource }
}

function readyContext(
  input: Parameters<typeof preparePlannerInitialContext>[0],
  dependencies: Parameters<typeof preparePlannerInitialContext>[1],
) {
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

describe('Planner initial context preparation', () => {
  it('derives every initial structure from validated entries without mutating input', () => {
    const { input, dependencies, goal, entry } = singleEntryFixture()
    const snapshot = structuredClone(input)
    const context = readyContext(input, dependencies)
    expect(context.validBuildListEntries.map(({ entry: valid }) => valid.id)).toEqual([entry.id])
    expect(context.excludedBuildListEntries).toEqual([])
    expect(context.allSearchEntries.map(({ id }) => id)).toEqual([entry.id])
    expect([...context.entriesById.keys()]).toEqual([entry.id])
    expect(context.allUnitPlans.get(entry.id)).toHaveLength(1)
    expect(context.routeUnitCountByEntryId.get(entry.id)).toBe(1)
    expect(context.targets.map(({ id }) => id)).toEqual([goal.id])
    expect([...context.targetsById.keys()]).toEqual([goal.id])
    expect(context.initialRelevantEntries.map(({ id }) => id)).toEqual([entry.id])
    expect([...context.initialRelevantUnitPlans.keys()]).toEqual([entry.id])
    expect(context.initialConflictDetection.conflicts).toEqual([])
    expect(context.routePlanRejections).toEqual([])
    expect(Object.keys(context.initialState.routeProgressByEntryId)).toEqual([entry.id])
    expect(context.initialState.trace).toEqual([])
    expect(input).toEqual(snapshot)
  })

  it('detects the initial Counter conflict with the ordinary Planner authority', () => {
    const scenario = conflictFixture()
    const { input, dependencies } = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [scenario.first, scenario.second],
      [scenario.firstSource, scenario.secondSource],
    )
    const context = readyContext(input, dependencies)
    expect(context.initialConflictDetection.conflicts).toHaveLength(1)
    expect(context.initialConflictDetection.conflicts[0]).toMatchObject({
      kind: 'same_gogma_counter',
      buildListEntryIds: [scenario.first.id, scenario.second.id],
    })
  })

  it('applies a valid explicit conflict resolution during preparation', () => {
    const scenario = conflictFixture()
    const detected = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [structuredClone(scenario.first), structuredClone(scenario.second)],
      [scenario.firstSource, scenario.secondSource],
    )
    const conflictKey = readyContext(detected.input, detected.dependencies)
      .initialConflictDetection.conflicts[0].id
    const resolved = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [structuredClone(scenario.first), structuredClone(scenario.second)],
      [scenario.firstSource, scenario.secondSource],
    )
    resolved.input.conflictResolutions = [{
      conflictKey,
      selectedBuildListEntryId: scenario.second.id,
    }]
    const context = readyContext(resolved.input, resolved.dependencies)
    expect(context.validConflictResolutions).toEqual(resolved.input.conflictResolutions)
    expect(context.initialConflictDetection.conflicts[0]).toMatchObject({
      id: conflictKey,
      selectedBuildListEntryId: scenario.second.id,
    })
  })

  it('drops a resolution whose Entry is unknown and fails a structurally invalid one', () => {
    const unknown = singleEntryFixture()
    unknown.input.conflictResolutions = [{
      conflictKey: 'conflict.preflight.unknown-entry',
      selectedBuildListEntryId: 'build-list.preflight.missing' as never,
    }]
    const context = readyContext(unknown.input, unknown.dependencies)
    expect(context.validConflictResolutions).toEqual([])
    expect(context.warnings.some(({ kind }) => kind === 'invalid_conflict_resolution')).toBe(true)
    expect(context.initialConflictDetection.conflicts).toEqual([])

    const structural = singleEntryFixture()
    structural.input.conflictResolutions = [{
      conflictKey: '   ',
      selectedBuildListEntryId: structural.entry.id,
    }]
    const prepared = preparePlannerInitialContext(
      structural.input,
      structural.dependencies,
    )
    expect(prepared.status).toBe('invalid')
    if (prepared.status !== 'invalid') return
    expect(prepared.issues.map(({ path }) => path)).toEqual([
      'conflictResolutions[0].conflictKey',
    ])
    expect(prepared.excludedBuildListEntries).toEqual([])
  })

  it('excludes a stale BuildListEntry from every derived structure', () => {
    const { input, dependencies, entry } = singleEntryFixture()
    input.targetWeapons[0].priority = 5
    const context = readyContext(input, dependencies)
    expect(context.validBuildListEntries).toEqual([])
    expect(context.excludedBuildListEntries.map(({ entry: excluded }) => excluded.id))
      .toEqual([entry.id])
    expect(context.warnings.some(({ kind }) => kind === 'build_list_entry_stale')).toBe(true)
    expect(context.allSearchEntries).toEqual([])
    expect(context.initialRelevantEntries).toEqual([])
    expect(context.initialState.routeProgressByEntryId).toEqual({})
    expect(context.initialState.routeRuntimeByEntryId).toEqual({})
    expect(context.initialState.routeSourceVersionByEntryId).toEqual({})
    expect(context.initialConflictDetection.conflicts).toEqual([])
  })

  it('excludes a CalculationContext-incompatible BuildListEntry', () => {
    const { input, dependencies, entry } = singleEntryFixture()
    input.calculationContext = {
      ...input.calculationContext,
      masterDataVersion: input.calculationContext.masterDataVersion + 1,
    }
    const context = readyContext(input, dependencies)
    expect(context.validBuildListEntries).toEqual([])
    expect(context.excludedBuildListEntries.map(({ entry: excluded }) => excluded.id))
      .toEqual([entry.id])
    expect(context.warnings.some(({ kind }) => kind === 'calculation_context_incompatible'))
      .toBe(true)
    expect(context.allSearchEntries).toEqual([])
  })

  it('excludes a protected destructive BuildListEntry through validation', () => {
    const goal = target('target.preflight.protected')
    const source = sourceWeapon('owned.preflight.protected', true)
    const entry = routeEntry('entry.preflight.protected', goal, resetRoute(source.id))
    const { input, dependencies } = fixture([goal], [entry], [source])
    const context = readyContext(input, dependencies)
    expect(context.validBuildListEntries).toEqual([])
    expect(context.excludedBuildListEntries.map(({ entry: excluded }) => excluded.id))
      .toEqual([entry.id])
    expect(context.warnings.some(({ kind }) => kind === 'protected_weapon_required')).toBe(true)
    expect(context.allSearchEntries).toEqual([])
  })

  it('keeps Route plan rejections and removes the Entry from the searchable set', () => {
    const goal = target('target.preflight.rejected')
    const source = sourceWeapon('owned.preflight.rejected')
    const divergedRoute: BuildRoute = {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'reset_bonuses',
        sourceOwnedWeaponId: source.id,
        gogmaCounterBefore: 10,
        gogmaCounterAfter: 12,
      }],
    }
    const entry = routeEntry('entry.preflight.rejected', goal, divergedRoute)
    const { input, dependencies } = fixture([goal], [entry], [source])
    const context = readyContext(input, dependencies)
    expect(context.validBuildListEntries.map(({ entry: valid }) => valid.id)).toEqual([entry.id])
    expect(context.routePlanRejections).toEqual([{
      buildListEntryId: entry.id,
      actionType: 'reset_bonuses',
      reason: 'counter_after_mismatch',
      detail: 'RNG Engine advancement ended at 11, but the saved operation ends at 12.',
    }])
    expect(context.allSearchEntries).toEqual([])
    expect(context.allUnitPlans.size).toBe(0)
    expect(context.initialState.routeProgressByEntryId).toEqual({})
  })

  it('excludes already-Ideal and already-Practical Targets from initial relevance', () => {
    const idealTarget = target('target.preflight.relevance.ideal')
    const practicalTarget = {
      ...target('target.preflight.relevance.practical'),
      weaponTypeId: 'weapon.fixture.b',
    }
    const activeTarget = {
      ...target('target.preflight.relevance.active'),
      weaponTypeId: 'weapon.fixture.c',
    }
    const idealSource = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.preflight.relevance.ideal')),
      isProtected: false,
      relatedTargetWeaponIds: [],
    }
    const practicalSource = {
      ...createValidOwnedWeapon(ownedWeaponId('owned.preflight.relevance.practical')),
      weaponTypeId: 'weapon.fixture.b',
      restorationBonuses: [
        ...createRestorationBonusSet().slice(0, 4),
        {
          bonusTypeId: 'bonus_type.fixture.sharpness',
          bonusRankId: 'bonus_rank.fixture.special',
        },
      ] as TargetWeapon['idealBonuses'],
      isProtected: false,
      relatedTargetWeaponIds: [],
    }
    const activeSource = {
      ...sourceWeapon('owned.preflight.relevance.active'),
      weaponTypeId: 'weapon.fixture.c',
    }
    const ideal = routeEntry(
      'entry.preflight.relevance.ideal', idealTarget, resetRoute(idealSource.id),
    )
    const practical = routeEntry(
      'entry.preflight.relevance.practical', practicalTarget,
      resetRoute(practicalSource.id), 'practical',
    )
    const active = routeEntry(
      'entry.preflight.relevance.active', activeTarget, resetRoute(activeSource.id),
    )
    const { input, dependencies } = fixture(
      [idealTarget, practicalTarget, activeTarget],
      [ideal, practical, active],
      [idealSource, practicalSource, activeSource],
    )
    const context = readyContext(input, dependencies)
    expect(context.allSearchEntries.map(({ id }) => id)).toEqual(
      [active.id, ideal.id, practical.id].sort(),
    )
    expect(context.initialRelevantEntries.map(({ id }) => id)).toEqual([active.id])
    expect([...context.initialRelevantUnitPlans.keys()]).toEqual([active.id])
    expect(context.initialConflictDetection.conflicts).toEqual([])
    expect(entryIsRelevantForState(context.initialState, ideal)).toBe(false)
    expect(entryIsRelevantForState(context.initialState, practical)).toBe(false)
    expect(entryIsRelevantForState(context.initialState, active)).toBe(true)
  })

  it('orders entries, targets, and conflicts independently of input order', () => {
    const scenario = conflictFixture()
    const ordered = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [structuredClone(scenario.first), structuredClone(scenario.second)],
      [scenario.firstSource, scenario.secondSource],
    )
    const reversed = fixture(
      [scenario.secondTarget, scenario.firstTarget],
      [structuredClone(scenario.second), structuredClone(scenario.first)],
      [scenario.secondSource, scenario.firstSource],
    )
    const orderedContext = readyContext(ordered.input, ordered.dependencies)
    const reversedContext = readyContext(reversed.input, reversed.dependencies)
    expect(reversedContext.allSearchEntries.map(({ id }) => id))
      .toEqual(orderedContext.allSearchEntries.map(({ id }) => id))
    expect(reversedContext.targets.map(({ id }) => id))
      .toEqual(orderedContext.targets.map(({ id }) => id))
    expect(reversedContext.initialRelevantEntries.map(({ id }) => id))
      .toEqual(orderedContext.initialRelevantEntries.map(({ id }) => id))
    expect(reversedContext.initialConflictDetection.conflicts)
      .toEqual(orderedContext.initialConflictDetection.conflicts)
  })

  it('is the same authority runPlannerBeamSearch starts from', async () => {
    const scenario = conflictFixture()
    const prepared = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [structuredClone(scenario.first), structuredClone(scenario.second)],
      [scenario.firstSource, scenario.secondSource],
    )
    const context = readyContext(prepared.input, prepared.dependencies)
    const searched = fixture(
      [scenario.firstTarget, scenario.secondTarget],
      [structuredClone(scenario.first), structuredClone(scenario.second)],
      [scenario.firstSource, scenario.secondSource],
    )
    const result = await runPlannerBeamSearch(searched.input, searched.dependencies)
    expect(result.conflicts.map(({ id }) => id))
      .toEqual(context.initialConflictDetection.conflicts.map(({ id }) => id))
    expect(result.excludedBuildListEntries).toEqual(context.excludedBuildListEntries)

    const stale = singleEntryFixture()
    stale.input.targetWeapons[0].priority = 5
    const staleContext = readyContext(stale.input, stale.dependencies)
    const staleSearch = singleEntryFixture()
    staleSearch.input.targetWeapons[0].priority = 5
    const staleResult = await runPlannerBeamSearch(
      staleSearch.input,
      staleSearch.dependencies,
    )
    expect(staleResult.excludedBuildListEntries.map(({ entry }) => entry.id))
      .toEqual(staleContext.excludedBuildListEntries.map(({ entry }) => entry.id))
    expect(staleResult.warnings).toEqual(staleContext.warnings)
  })
})
