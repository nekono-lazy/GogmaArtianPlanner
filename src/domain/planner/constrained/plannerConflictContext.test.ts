import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedWeapon,
  TargetWeapon,
} from '../../models/publicTypes'
import { createBuildCandidateMeaningFingerprint } from '../../buildList'
import { ownedWeaponId } from '../../../test/fixtures/domainData'
import { belowPracticalBonuses } from '../../../test/fixtures/candidateSearch'
import { normalWeapon } from '../../../test/fixtures/constrainedEnumeration'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../../test/fixtures/plannerBeam'
import {
  preparePlannerInitialContext,
  type PlannerInitialContext,
} from '../plannerInitialContext'
import type { PlannerConflictResolution } from '../plannerTypes'
import {
  createPlannerConstrainedConflictContexts,
  plannerConflictResourceKey,
  preparePlannerFixedConflictConstraints,
  samePlannerConflictResource,
} from './plannerConflictContext'

function readyContext(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[] = [],
  resolutions: PlannerConflictResolution[] = [],
): PlannerInitialContext {
  const { input, dependencies } = fixture(targets, entries, ownedWeapons)
  input.conflictResolutions = resolutions
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

function contextsOf(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[] = [],
) {
  return createPlannerConstrainedConflictContexts(
    readyContext(targets, entries, ownedWeapons),
  )
}

function gogmaScenario(ids: readonly string[], counter = 10) {
  const targets = ids.map((id, index) =>
    target(`target.ctx.gogma.${id}`, index === 0 ? 5 : 1),
  )
  const sources = ids.map((id) => sourceWeapon(`owned.ctx.gogma.${id}`))
  const entries = ids.map((id, index) =>
    routeEntry(
      `entry.ctx.gogma.${id}`,
      targets[index],
      resetRoute(sources[index].id, counter),
    ),
  )
  return { targets, sources, entries }
}

function convertRoute(sourceId: string, skillCounter = 7): BuildRoute {
  return {
    kind: 'owned_normal_artian_to_gogma',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [{
      type: 'convert_normal_to_gogma',
      weaponTypeId: 'weapon.fixture.a',
      skillCounterBefore: skillCounter,
      skillCounterAfter: skillCounter + 1,
    }],
  }
}

function forgeRoute(
  weaponTypeId: string,
  normalCounterBefore: number,
): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [{
      type: 'create_normal_artian',
      weaponTypeId,
      rarity: 8,
      count: 1,
      normalCounterBefore,
      normalCounterAfter: normalCounterBefore + 1,
    }],
  }
}

function materialRoute(
  sourceId: string,
  materialId: string,
  gogmaCounter: number,
): BuildRoute {
  return {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: ownedWeaponId(sourceId),
    operations: [
      {
        type: 'reset_bonuses',
        sourceOwnedWeaponId: ownedWeaponId(sourceId),
        gogmaCounterBefore: gogmaCounter,
        gogmaCounterAfter: gogmaCounter + 1,
      },
      { type: 'use_weapon_as_material', ownedWeaponId: ownedWeaponId(materialId) },
    ],
  }
}

describe('B8-C3a Planner conflict resource identity', () => {
  it('identifies a Gogma Counter conflict by kind and position only', () => {
    const two = gogmaScenario(['first', 'second'])
    const contexts = contextsOf(two.targets, two.entries, two.sources)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resourceIdentity).toEqual({
      kind: 'same_gogma_counter',
      counterStream: 'gogma',
      counterBefore: 10,
    })
    expect(contexts[0].counterStream).toBe('gogma')
    expect(contexts[0].counterBefore).toBe(10)
    expect(contexts[0].normalCounterId).toBeNull()
    expect(contexts[0].consumedOwnedWeaponId).toBeNull()
  })

  it('keeps the Gogma resource identity while the participant set changes', () => {
    const two = gogmaScenario(['first', 'second'])
    const three = gogmaScenario(['first', 'second', 'third'])
    const [smaller] = contextsOf(two.targets, two.entries, two.sources)
    const [larger] = contextsOf(three.targets, three.entries, three.sources)
    expect(larger.participants).toHaveLength(3)
    expect(smaller.participants).toHaveLength(2)
    expect(larger.conflictId).not.toBe(smaller.conflictId)
    expect(samePlannerConflictResource(
      larger.resourceIdentity,
      smaller.resourceIdentity,
    )).toBe(true)
    expect(plannerConflictResourceKey(larger.resourceIdentity))
      .toBe(plannerConflictResourceKey(smaller.resourceIdentity))
  })

  it('identifies a Skill Counter conflict by kind and position only', () => {
    const first = target('target.ctx.skill.first', 5)
    const second = target('target.ctx.skill.second', 1)
    const firstSource = normalWeapon('owned.ctx.skill.first')
    const secondSource = normalWeapon('owned.ctx.skill.second')
    const contexts = contextsOf(
      [first, second],
      [
        routeEntry('entry.ctx.skill.first', first, convertRoute(firstSource.id)),
        routeEntry('entry.ctx.skill.second', second, convertRoute(secondSource.id)),
      ],
      [firstSource, secondSource],
    )
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resourceIdentity).toEqual({
      kind: 'same_skill_counter',
      counterStream: 'skill',
      counterBefore: 7,
    })
    expect(contexts[0].consumedOwnedWeaponId).toBeNull()
  })

  it('identifies a Normal Counter conflict by Counter ID and position', () => {
    const first = target('target.ctx.normal.first', 5)
    const second = target('target.ctx.normal.second', 1)
    const contexts = contextsOf(
      [first, second],
      [
        routeEntry('entry.ctx.normal.first', first, forgeRoute('weapon.fixture.a', 4)),
        routeEntry('entry.ctx.normal.second', second, forgeRoute('weapon.fixture.a', 4)),
      ],
    )
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resourceIdentity).toEqual({
      kind: 'same_normal_counter',
      counterStream: 'normal',
      normalCounterId: 'weapon.fixture.a:8',
      counterBefore: 4,
    })
    expect(contexts[0].normalCounterId).toBe('weapon.fixture.a:8')
  })

  it('separates Normal Counter resources that differ only by Counter ID', () => {
    const first = { ...target('target.ctx.normal.b.first', 5), weaponTypeId: 'weapon.fixture.b' }
    const second = { ...target('target.ctx.normal.b.second', 1), weaponTypeId: 'weapon.fixture.b' }
    const other = contextsOf(
      [first, second],
      [
        routeEntry('entry.ctx.normal.b.first', first, forgeRoute('weapon.fixture.b', 12)),
        routeEntry('entry.ctx.normal.b.second', second, forgeRoute('weapon.fixture.b', 12)),
      ],
    )
    const sameCounterId = contextsOf(
      [target('target.ctx.normal.a.first', 5), target('target.ctx.normal.a.second', 1)],
      [
        routeEntry(
          'entry.ctx.normal.a.first',
          target('target.ctx.normal.a.first', 5),
          forgeRoute('weapon.fixture.a', 4),
        ),
        routeEntry(
          'entry.ctx.normal.a.second',
          target('target.ctx.normal.a.second', 1),
          forgeRoute('weapon.fixture.a', 4),
        ),
      ],
    )
    expect(other[0].resourceIdentity).toMatchObject({
      normalCounterId: 'weapon.fixture.b:8',
      counterBefore: 12,
    })
    expect(samePlannerConflictResource(
      other[0].resourceIdentity,
      sameCounterId[0].resourceIdentity,
    )).toBe(false)
  })

  it('identifies a consumed weapon conflict by the exclusively consumed weapon', () => {
    const first = target('target.ctx.material.first', 5)
    const second = target('target.ctx.material.second', 1)
    const material = sourceWeapon('owned.ctx.material.shared')
    const firstSource = sourceWeapon('owned.ctx.material.source.first')
    const secondSource = sourceWeapon('owned.ctx.material.source.second')
    const contexts = contextsOf(
      [first, second],
      [
        routeEntry(
          'entry.ctx.material.first',
          first,
          materialRoute(firstSource.id, material.id, 10),
        ),
        routeEntry(
          'entry.ctx.material.second',
          second,
          materialRoute(secondSource.id, material.id, 14),
        ),
      ],
      [material, firstSource, secondSource],
    )
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resourceIdentity).toEqual({
      kind: 'same_owned_weapon_consumed',
      counterStream: null,
      consumedOwnedWeaponId: material.id,
    })
    expect(contexts[0].consumedOwnedWeaponId).toBe(material.id)
    expect(contexts[0].counterStream).toBeNull()
    expect(contexts[0].counterBefore).toBeNull()
    // The differing Route sources never define the conflict resource.
    expect(contexts[0].participants.map(({ sourceOwnedWeaponId }) => sourceOwnedWeaponId))
      .toEqual([null, null])
  })

  it('keeps the consumed weapon resource when the Route sources differ', () => {
    const material = sourceWeapon('owned.ctx.material.stable')
    const build = (sourceSuffix: string) => {
      const first = target(`target.ctx.stable.${sourceSuffix}.first`, 5)
      const second = target(`target.ctx.stable.${sourceSuffix}.second`, 1)
      const firstSource = sourceWeapon(`owned.ctx.stable.${sourceSuffix}.first`)
      const secondSource = sourceWeapon(`owned.ctx.stable.${sourceSuffix}.second`)
      return contextsOf(
        [first, second],
        [
          routeEntry(
            `entry.ctx.stable.${sourceSuffix}.first`,
            first,
            materialRoute(firstSource.id, material.id, 10),
          ),
          routeEntry(
            `entry.ctx.stable.${sourceSuffix}.second`,
            second,
            materialRoute(secondSource.id, material.id, 14),
          ),
        ],
        [material, firstSource, secondSource],
      )
    }
    const [left] = build('alpha')
    const [right] = build('beta')
    expect(samePlannerConflictResource(left.resourceIdentity, right.resourceIdentity))
      .toBe(true)
  })
})

describe('B8-C3a conflict context authority', () => {
  it('creates no context where the existing shareability rules see no conflict', () => {
    const first = target('target.ctx.shareable.first', 5)
    const second = target('target.ctx.shareable.second', 1)
    const shared = sourceWeapon('owned.ctx.shareable.shared')
    const context = readyContext(
      [first, second],
      [
        routeEntry('entry.ctx.shareable.first', first, resetRoute(shared.id, 10)),
        routeEntry('entry.ctx.shareable.second', second, resetRoute(shared.id, 10)),
      ],
      [shared],
    )
    expect(context.initialConflictDetection.conflicts).toEqual([])
    expect(createPlannerConstrainedConflictContexts(context)).toEqual([])
  })

  it('derives participant fields from the existing Route units and Entries', () => {
    const first = target('target.ctx.participant.first', 5)
    const second = target('target.ctx.participant.second', 1)
    const firstSource = normalWeapon('owned.ctx.participant.first')
    const secondSource = normalWeapon('owned.ctx.participant.second')
    const firstEntry = routeEntry(
      'entry.ctx.participant.first',
      first,
      convertRoute(firstSource.id),
    )
    const secondEntry = routeEntry(
      'entry.ctx.participant.second',
      second,
      convertRoute(secondSource.id),
    )
    const context = readyContext(
      [first, second],
      [firstEntry, secondEntry],
      [firstSource, secondSource],
    )
    const [conflict] = createPlannerConstrainedConflictContexts(context)
    expect(conflict.participants).toEqual([
      {
        buildListEntryId: firstEntry.id,
        targetWeaponId: first.id,
        candidateFingerprint: createBuildCandidateMeaningFingerprint(
          firstEntry.candidateSnapshot,
        ),
        operationType: 'convert_normal_to_gogma',
        counterAfter: 8,
        sourceOwnedWeaponId: firstSource.id,
        exclusiveConsumedOwnedWeaponId: firstSource.id,
        physicalActionKey: context.allUnitPlans.get(firstEntry.id)?.[0]
          .physicalActionKey,
      },
      {
        buildListEntryId: secondEntry.id,
        targetWeaponId: second.id,
        candidateFingerprint: createBuildCandidateMeaningFingerprint(
          secondEntry.candidateSnapshot,
        ),
        operationType: 'convert_normal_to_gogma',
        counterAfter: 8,
        sourceOwnedWeaponId: secondSource.id,
        exclusiveConsumedOwnedWeaponId: secondSource.id,
        physicalActionKey: context.allUnitPlans.get(secondEntry.id)?.[0]
          .physicalActionKey,
      },
    ])
  })

  it('keeps a consumed material weapon out of the participant source field', () => {
    const first = target('target.ctx.consume.first', 5)
    const second = target('target.ctx.consume.second', 1)
    const material = sourceWeapon('owned.ctx.consume.material')
    const firstSource = sourceWeapon('owned.ctx.consume.source.first')
    const secondSource = sourceWeapon('owned.ctx.consume.source.second')
    const [conflict] = contextsOf(
      [first, second],
      [
        routeEntry(
          'entry.ctx.consume.first',
          first,
          materialRoute(firstSource.id, material.id, 10),
        ),
        routeEntry(
          'entry.ctx.consume.second',
          second,
          materialRoute(secondSource.id, material.id, 14),
        ),
      ],
      [material, firstSource, secondSource],
    )
    conflict.participants.forEach((participant) => {
      expect(participant.operationType).toBe('use_weapon_as_material')
      expect(participant.sourceOwnedWeaponId).toBeNull()
      expect(participant.exclusiveConsumedOwnedWeaponId).toBe(material.id)
      expect(participant.counterAfter).toBeNull()
    })
  })

  it('orders contexts and participants independently of input order', () => {
    const scenario = gogmaScenario(['zulu', 'alpha'])
    const forward = contextsOf(scenario.targets, scenario.entries, scenario.sources)
    const reversed = contextsOf(
      [...scenario.targets].reverse(),
      [...scenario.entries].reverse(),
      [...scenario.sources].reverse(),
    )
    expect(reversed).toEqual(forward)
    expect(forward[0].participants.map(({ buildListEntryId }) => buildListEntryId))
      .toEqual([...forward[0].participants]
        .map(({ buildListEntryId }) => buildListEntryId)
        .sort())
  })
})

describe('B8-C3a fixed conflict constraint extraction', () => {
  function gogmaFixture(suffix: string, counter: number) {
    const first = target(`target.ctx.fixed.${suffix}.first`, 5)
    const second = target(`target.ctx.fixed.${suffix}.second`, 1)
    const firstSource = sourceWeapon(`owned.ctx.fixed.${suffix}.first`)
    const secondSource = sourceWeapon(`owned.ctx.fixed.${suffix}.second`)
    return {
      targets: [first, second],
      sources: [firstSource, secondSource],
      entries: [
        routeEntry(
          `entry.ctx.fixed.${suffix}.first`,
          first,
          resetRoute(firstSource.id, counter),
        ),
        routeEntry(
          `entry.ctx.fixed.${suffix}.second`,
          second,
          resetRoute(secondSource.id, counter),
        ),
      ],
    }
  }

  function prepare(
    targets: TargetWeapon[],
    entries: BuildListEntry[],
    ownedWeapons: OwnedWeapon[],
    resolutions: PlannerConflictResolution[],
  ) {
    const context = readyContext(
      targets,
      entries.map((entry) => structuredClone(entry)),
      ownedWeapons,
      resolutions,
    )
    const contexts = createPlannerConstrainedConflictContexts(context)
    return {
      context,
      contexts,
      result: preparePlannerFixedConflictConstraints(context, contexts),
    }
  }

  function conflictIdOf(
    targets: TargetWeapon[],
    entries: BuildListEntry[],
    ownedWeapons: OwnedWeapon[],
  ): string {
    return contextsOf(
      targets,
      entries.map((entry) => structuredClone(entry)),
      ownedWeapons,
    )[0].conflictId
  }

  it('builds one constraint from a valid explicit resolution', () => {
    const scenario = gogmaFixture('single', 10)
    const conflictKey = conflictIdOf(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const selected = scenario.entries[1]
    const prepared = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      [{ conflictKey, selectedBuildListEntryId: selected.id }],
    )
    expect(prepared.result.status).toBe('ready')
    expect(prepared.result.constraints).toEqual([{
      originalConflictId: conflictKey,
      resourceIdentity: {
        kind: 'same_gogma_counter',
        counterStream: 'gogma',
        counterBefore: 10,
      },
      fixedBuildListEntryId: selected.id,
      fixedTargetWeaponId: scenario.targets[1].id,
      fixedCandidateFingerprint: createBuildCandidateMeaningFingerprint(
        selected.candidateSnapshot,
      ),
    }])
  })

  it('never fixes a Candidate from recommendedBuildListEntryId alone', () => {
    const scenario = gogmaFixture('recommended', 10)
    const prepared = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      [],
    )
    expect(prepared.contexts).toHaveLength(1)
    expect(
      prepared.context.initialConflictDetection.conflicts[0]
        .recommendedBuildListEntryId,
    ).not.toBeNull()
    expect(prepared.result).toEqual({ status: 'ready', constraints: [] })
  })

  it('does not revive a resolution that validation already dropped', () => {
    const scenario = gogmaFixture('dropped', 10)
    const conflictKey = conflictIdOf(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const prepared = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      [{
        conflictKey,
        selectedBuildListEntryId: 'entry.ctx.fixed.dropped.missing' as never,
      }],
    )
    expect(prepared.context.validConflictResolutions).toEqual([])
    expect(prepared.result).toEqual({ status: 'ready', constraints: [] })
  })

  it('fails closed when the conflict key matches no detected conflict', () => {
    const scenario = gogmaFixture('missing-key', 10)
    const prepared = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      [{
        conflictKey: 'plan-conflict:not-detected',
        selectedBuildListEntryId: scenario.entries[0].id,
      }],
    )
    expect(prepared.result.status).toBe('unresolved')
    expect(prepared.result.constraints).toEqual([])
    expect(prepared.result.status === 'unresolved' && prepared.result.failures)
      .toMatchObject([{
        conflictKey: 'plan-conflict:not-detected',
        selectedBuildListEntryId: scenario.entries[0].id,
        reason: 'conflict_not_found',
      }])
  })

  it('fails closed when the selected Entry is not a conflict participant', () => {
    const scenario = gogmaFixture('outsider', 10)
    const outsiderTarget = target('target.ctx.fixed.outsider.third', 2)
    const outsiderSource = sourceWeapon('owned.ctx.fixed.outsider.third')
    const outsider = routeEntry(
      'entry.ctx.fixed.outsider.third',
      outsiderTarget,
      resetRoute(outsiderSource.id, 20),
    )
    const targets = [...scenario.targets, outsiderTarget]
    const entries = [...scenario.entries, outsider]
    const sources = [...scenario.sources, outsiderSource]
    const conflictKey = conflictIdOf(targets, entries, sources)
    const prepared = prepare(targets, entries, sources, [{
      conflictKey,
      selectedBuildListEntryId: outsider.id,
    }])
    expect(prepared.result.status).toBe('unresolved')
    expect(prepared.result.constraints).toEqual([])
    expect(prepared.result.status === 'unresolved' && prepared.result.failures)
      .toMatchObject([{ reason: 'selected_entry_not_participant' }])
  })

  it('re-maps every explicit resolution and keeps a stable order', () => {
    const near = gogmaFixture('multi-near', 10)
    const far = gogmaFixture('multi-far', 16)
    const targets = [...near.targets, ...far.targets]
    const entries = [...near.entries, ...far.entries]
    const sources = [...near.sources, ...far.sources]
    const conflictKeys = contextsOf(
      targets,
      entries.map((entry) => structuredClone(entry)),
      sources,
    ).map(({ conflictId }) => conflictId)
    expect(conflictKeys).toHaveLength(2)
    const byCounter = new Map(
      contextsOf(
        targets,
        entries.map((entry) => structuredClone(entry)),
        sources,
      ).map((entry) => [entry.counterBefore, entry.conflictId]),
    )
    const resolutions: PlannerConflictResolution[] = [
      {
        conflictKey: byCounter.get(10) as string,
        selectedBuildListEntryId: near.entries[0].id,
      },
      {
        conflictKey: byCounter.get(16) as string,
        selectedBuildListEntryId: far.entries[1].id,
      },
    ]
    const forward = prepare(targets, entries, sources, resolutions)
    const reversed = prepare(targets, entries, sources, [...resolutions].reverse())
    expect(forward.result.status).toBe('ready')
    expect(forward.result.constraints).toHaveLength(2)
    expect(reversed.result).toEqual(forward.result)
    expect(
      forward.result.constraints.map(({ fixedBuildListEntryId }) =>
        fixedBuildListEntryId,
      ).sort(),
    ).toEqual([near.entries[0].id, far.entries[1].id].sort())
  })

  it('returns no constraint at all when one resolution cannot be mapped', () => {
    const near = gogmaFixture('partial-near', 10)
    const far = gogmaFixture('partial-far', 16)
    const targets = [...near.targets, ...far.targets]
    const entries = [...near.entries, ...far.entries]
    const sources = [...near.sources, ...far.sources]
    const byCounter = new Map(
      contextsOf(
        targets,
        entries.map((entry) => structuredClone(entry)),
        sources,
      ).map((entry) => [entry.counterBefore, entry.conflictId]),
    )
    const prepared = prepare(targets, entries, sources, [
      {
        conflictKey: byCounter.get(10) as string,
        selectedBuildListEntryId: near.entries[0].id,
      },
      {
        conflictKey: 'plan-conflict:not-detected',
        selectedBuildListEntryId: far.entries[1].id,
      },
    ])
    expect(prepared.result.status).toBe('unresolved')
    expect(prepared.result.constraints).toEqual([])
    expect(prepared.result.status === 'unresolved' && prepared.result.failures)
      .toHaveLength(1)
  })
})

describe('B8-C3a duplicate BuildListEntry ID identity', () => {
  const conflictCounter = 10

  function duplicateFixture(
    suffix: string,
    variant: 'different_target' | 'same_target',
  ) {
    const fixedTarget = target(`target.ctx.dup.${suffix}.fixed`, 5)
    const otherTarget = target(`target.ctx.dup.${suffix}.other`, 1)
    const altTarget = target(`target.ctx.dup.${suffix}.alt`, 3)
    const fixedSource = sourceWeapon(`owned.ctx.dup.${suffix}.fixed`)
    const otherSource = sourceWeapon(`owned.ctx.dup.${suffix}.other`)
    const sharedId = `entry.ctx.dup.${suffix}.shared`
    const first = routeEntry(
      sharedId,
      fixedTarget,
      resetRoute(fixedSource.id, conflictCounter),
    )
    const second = routeEntry(
      sharedId,
      variant === 'different_target' ? altTarget : fixedTarget,
      resetRoute(fixedSource.id, conflictCounter),
    )
    if (variant === 'same_target') {
      // Same Target, different Candidate semantics: the duplicate id is what is
      // rejected, not a difference the two entries happen to disagree on.
      second.candidateSnapshot.finalBonuses = belowPracticalBonuses()
    }
    const other = routeEntry(
      `entry.ctx.dup.${suffix}.other`,
      otherTarget,
      resetRoute(otherSource.id, conflictCounter),
    )
    return {
      targets: [fixedTarget, otherTarget, altTarget],
      sources: [fixedSource, otherSource],
      sharedId,
      first,
      second,
      other,
    }
  }

  function prepareDuplicate(
    suffix: string,
    variant: 'different_target' | 'same_target',
    order: 'first_then_second' | 'second_then_first',
  ) {
    const built = duplicateFixture(suffix, variant)
    const duplicates =
      order === 'first_then_second'
        ? [built.first, built.second]
        : [built.second, built.first]
    const conflictKey = conflictIdOfEntries(
      built.targets,
      [built.first, built.other],
      built.sources,
    )
    const context = readyContext(
      built.targets,
      [...duplicates, built.other].map((entry) => structuredClone(entry)),
      built.sources,
      [{ conflictKey, selectedBuildListEntryId: built.first.id }],
    )
    const contexts = createPlannerConstrainedConflictContexts(context)
    return {
      built,
      conflictKey,
      context,
      contexts,
      result: preparePlannerFixedConflictConstraints(context, contexts),
    }
  }

  function conflictIdOfEntries(
    targets: TargetWeapon[],
    entries: BuildListEntry[],
    ownedWeapons: OwnedWeapon[],
  ): string {
    const contexts = createPlannerConstrainedConflictContexts(
      readyContext(
        targets,
        entries.map((entry) => structuredClone(entry)),
        ownedWeapons,
      ),
    )
    if (contexts.length !== 1) {
      throw new Error(`Fixture produced ${contexts.length} conflicts.`)
    }
    return contexts[0].conflictId
  }

  it('fails closed when two valid Entries share the selected id', () => {
    const prepared = prepareDuplicate('target', 'different_target', 'first_then_second')
    // Both duplicates really are valid Planner input, and the conflict itself
    // is still detected, so the failure is the identity check, not a side
    // effect of an unusable fixture.
    expect(
      prepared.context.validBuildListEntries.filter(
        ({ entry }) => entry.id === prepared.built.sharedId,
      ),
    ).toHaveLength(2)
    expect(prepared.contexts).toHaveLength(1)
    expect(prepared.contexts[0].conflictId).toBe(prepared.conflictKey)
    expect(prepared.built.second.targetWeaponId)
      .not.toBe(prepared.built.first.targetWeaponId)
    expect(prepared.result.status).toBe('unresolved')
    expect(prepared.result.constraints).toEqual([])
    expect(prepared.result.status === 'unresolved' && prepared.result.failures)
      .toMatchObject([{
        conflictKey: prepared.conflictKey,
        selectedBuildListEntryId: prepared.built.sharedId,
        reason: 'selected_entry_ambiguous',
      }])
  })

  it('fails closed regardless of the duplicate Entry order', () => {
    const forward = prepareDuplicate('order', 'different_target', 'first_then_second')
    const reversed = prepareDuplicate('order', 'different_target', 'second_then_first')
    expect(forward.result).toEqual(reversed.result)
    expect(reversed.result.status).toBe('unresolved')
    expect(reversed.result.constraints).toEqual([])
    expect(reversed.result.status === 'unresolved' && reversed.result.failures)
      .toMatchObject([{ reason: 'selected_entry_ambiguous' }])
  })

  it('fails closed for one Target with two Candidate meanings too', () => {
    const forward = prepareDuplicate('same', 'same_target', 'first_then_second')
    const reversed = prepareDuplicate('same', 'same_target', 'second_then_first')
    expect(
      forward.context.validBuildListEntries.filter(
        ({ entry }) => entry.id === forward.built.sharedId,
      ),
    ).toHaveLength(2)
    expect(forward.built.second.targetWeaponId)
      .toBe(forward.built.first.targetWeaponId)
    expect(createBuildCandidateMeaningFingerprint(forward.built.second.candidateSnapshot))
      .not.toBe(createBuildCandidateMeaningFingerprint(forward.built.first.candidateSnapshot))
    expect(forward.result.status).toBe('unresolved')
    expect(forward.result.constraints).toEqual([])
    expect(forward.result.status === 'unresolved' && forward.result.failures)
      .toMatchObject([{ reason: 'selected_entry_ambiguous' }])
    expect(reversed.result).toEqual(forward.result)
  })
})
