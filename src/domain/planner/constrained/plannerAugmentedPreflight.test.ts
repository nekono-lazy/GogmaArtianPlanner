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
  synchronizeEntry,
  target,
} from '../../../test/fixtures/plannerBeam'
import {
  preparePlannerInitialContext,
  type PlannerInitialContext,
} from '../plannerInitialContext'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
} from '../plannerTypes'
import {
  createPlannerConstrainedConflictContexts,
  preparePlannerFixedConflictConstraints,
  type PlannerConstrainedConflictContext,
  type PlannerFixedConflictConstraint,
} from './plannerConflictContext'
import {
  preparePlannerAugmentedConflictPreflight,
  reassociatePlannerFixedConstraints,
} from './plannerAugmentedPreflight'

interface Scenario {
  input: PlannerInput
  dependencies: PlannerDependencies
}

/** Builds a Planner input and keeps every Entry hash synchronized with it. */
function scenario(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[] = [],
  resolutions: PlannerConflictResolution[] = [],
): Scenario {
  const built = fixture(
    targets,
    entries.map((entry) => structuredClone(entry)),
    ownedWeapons,
  )
  built.input.conflictResolutions = resolutions
  return built
}

function readyContext(built: Scenario): PlannerInitialContext {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context
}

function contextsOf(built: Scenario): PlannerConstrainedConflictContext[] {
  return createPlannerConstrainedConflictContexts(readyContext(built))
}

/**
 * The original validated Planner input side: one explicit resolution turned
 * into the transient fixed constraints B8-C3b re-maps.
 */
function originalConstraints(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[],
  select: (contexts: PlannerConstrainedConflictContext[]) => PlannerConflictResolution[],
): { constraints: PlannerFixedConflictConstraint[]; conflictIds: string[] } {
  const detected = contextsOf(scenario(targets, entries, ownedWeapons))
  const resolutions = select(detected)
  const built = scenario(targets, entries, ownedWeapons, resolutions)
  const context = readyContext(built)
  const contexts = createPlannerConstrainedConflictContexts(context)
  const prepared = preparePlannerFixedConflictConstraints(context, contexts)
  if (prepared.status !== 'ready') {
    throw new Error('Expected ready fixed constraints from the original input.')
  }
  return {
    constraints: prepared.constraints,
    conflictIds: contexts.map(({ conflictId }) => conflictId),
  }
}

function gogmaScenario(suffix: string, ids: readonly string[], counter = 10) {
  const targets = ids.map((id, index) =>
    target(`target.pf.${suffix}.${id}`, index === 0 ? 5 : 1),
  )
  const sources = ids.map((id) => sourceWeapon(`owned.pf.${suffix}.${id}`))
  const entries = ids.map((id, index) =>
    routeEntry(
      `entry.pf.${suffix}.${id}`,
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

function forgeRoute(weaponTypeId: string, normalCounterBefore: number): BuildRoute {
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

/**
 * A Route that exclusively uses one shared owned Gogma weapon, once per given
 * Gogma Counter position.
 *
 * An owned Artian weapon is never consumed as material any more
 * (`docs/PLANNER_SPEC.md` 8), so the remaining exclusive OwnedWeapon use is a
 * Route amending one existing source. Two Routes naming the same source at
 * different Counter positions are the `same_owned_weapon_consumed` conflict,
 * and several positions in one Route make that Entry participate more than
 * once.
 */
function sharedSourceRoute(
  sharedSourceId: string,
  gogmaCounters: readonly number[],
): BuildRoute {
  return {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: ownedWeaponId(sharedSourceId),
    operations: gogmaCounters.map((gogmaCounter) => ({
      type: 'reset_bonuses' as const,
      sourceOwnedWeaponId: ownedWeaponId(sharedSourceId),
      gogmaCounterBefore: gogmaCounter,
      gogmaCounterAfter: gogmaCounter + 1,
    })),
  }
}

describe('B8-C3b augmented conflict preflight', () => {
  it('re-maps a fixed constraint onto the changed PlanConflict id', () => {
    const two = gogmaScenario('remap', ['first', 'second'])
    const three = gogmaScenario('remap', ['first', 'second', 'generated'])
    const original = originalConstraints(
      two.targets,
      two.entries,
      two.sources,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: two.entries[0].id,
      }],
    )
    const augmented = scenario(three.targets, three.entries, three.sources)
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts).toHaveLength(1)
    const currentId = result.conflictContexts[0].conflictId
    expect(currentId).not.toBe(original.conflictIds[0])
    expect(result.conflictResolutions).toEqual([{
      conflictKey: currentId,
      selectedBuildListEntryId: two.entries[0].id,
    }])
    expect(result.resolvedInput.conflictResolutions).toEqual(
      result.conflictResolutions,
    )
    // The caller's augmented input is never mutated.
    expect(augmented.input.conflictResolutions).toEqual([])
    expect(result.resolvedInput).not.toBe(augmented.input)
  })

  it('keeps the same physical resource while the participant set grows', () => {
    const two = gogmaScenario('resource', ['first', 'second'])
    const three = gogmaScenario('resource', ['first', 'second', 'generated'])
    const original = originalConstraints(
      two.targets,
      two.entries,
      two.sources,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: two.entries[1].id,
      }],
    )
    const augmented = scenario(three.targets, three.entries, three.sources)
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts[0].resourceIdentity).toEqual(
      original.constraints[0].resourceIdentity,
    )
    expect(result.conflictContexts[0].participants).toHaveLength(3)
    expect(result.conflictResolutions[0].selectedBuildListEntryId)
      .toBe(two.entries[1].id)
  })
})

describe('B8-C3b preflight never applies the stale conflict resolutions', () => {
  function staleResolutionScenario() {
    const three = gogmaScenario('stale-res', ['first', 'second', 'generated'])
    const augmented = scenario(three.targets, three.entries, three.sources)
    augmented.input.conflictResolutions = [{
      conflictKey: 'plan-conflict:stale-original-key',
      selectedBuildListEntryId: 'entry.pf.stale-res.removed' as never,
    }]
    return { three, augmented }
  }

  it('drops them before validation instead of raising invalid_conflict_resolution', () => {
    const { augmented } = staleResolutionScenario()
    // Applying the stale resolutions really would warn, so the preflight's
    // silence is the observable difference, not an accident of the fixture.
    const applied = preparePlannerInitialContext(
      augmented.input,
      augmented.dependencies,
    )
    expect(
      applied.status === 'ready'
        ? applied.context.warnings
        : applied.warnings,
    ).toContainEqual(expect.objectContaining({
      kind: 'invalid_conflict_resolution',
    }))
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      [],
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.preflightContext.validConflictResolutions).toEqual([])
    expect(
      result.preflightContext.warnings.map(({ kind }) => kind),
    ).not.toContain('invalid_conflict_resolution')
  })

  it('detects the current conflict with no selected Entry before re-association', () => {
    const { three, augmented } = staleResolutionScenario()
    const original = originalConstraints(
      three.targets.slice(0, 2),
      three.entries.slice(0, 2),
      three.sources.slice(0, 2),
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: three.entries[0].id,
      }],
    )
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const detected = result.preflightContext.initialConflictDetection.conflicts
    expect(detected).toHaveLength(1)
    expect(detected[0].selectedBuildListEntryId).toBeNull()
    // The fixed choice only reappears in the rebuilt array, under the current id.
    expect(result.conflictResolutions).toEqual([{
      conflictKey: detected[0].id,
      selectedBuildListEntryId: three.entries[0].id,
    }])
  })
})

describe('B8-C3b fixed Entry validity', () => {
  function remapping(
    suffix: string,
    mutate: (built: Scenario, entries: BuildListEntry[]) => void,
  ) {
    const two = gogmaScenario(suffix, ['first', 'second'])
    const three = gogmaScenario(suffix, ['first', 'second', 'generated'])
    const original = originalConstraints(
      two.targets,
      two.entries,
      two.sources,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: two.entries[0].id,
      }],
    )
    const augmented = scenario(three.targets, three.entries, three.sources)
    mutate(augmented, augmented.input.buildListEntries)
    return {
      augmented,
      fixedId: two.entries[0].id,
      result: preparePlannerAugmentedConflictPreflight(
        augmented.input,
        original.constraints,
        augmented.dependencies,
      ),
    }
  }

  it('fails closed when the fixed Entry left the augmented input', () => {
    const { result, fixedId } = remapping('gone', (built, entries) => {
      built.input.buildListEntries = entries.filter(({ id }) => id !== fixedIdOf(entries, 'first'))
    })
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toMatchObject([{
      fixedBuildListEntryId: fixedId,
      reason: 'fixed_entry_not_valid',
    }])
  })

  it('fails closed when validation excluded the fixed Entry', () => {
    const { augmented, result, fixedId } = remapping('excluded', (_built, entries) => {
      const fixed = entries.find(({ id }) => id.endsWith('.first'))
      if (fixed) fixed.targetDefinitionHash = 'stale-target-definition-hash'
    })
    // The exclusion comes from the ordinary Planner validation authority.
    const prepared = preparePlannerInitialContext(
      augmented.input,
      augmented.dependencies,
    )
    expect(prepared.status).toBe('ready')
    if (prepared.status === 'ready') {
      expect(augmented.input.buildListEntries.map(({ id }) => id))
        .toContain(fixedId)
      expect(prepared.context.excludedBuildListEntries.map(({ entry }) => entry.id))
        .toContain(fixedId)
    }
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.failures).toMatchObject([{ reason: 'fixed_entry_not_valid' }])
  })

  it('fails closed when the same Entry ID now belongs to another Target', () => {
    const { result } = remapping('retargeted', (built, entries) => {
      const fixed = entries.find(({ id }) => id.endsWith('.first'))
      const other = built.input.targetWeapons.find(({ id }) =>
        id.endsWith('.generated'),
      )
      if (!fixed || !other) throw new Error('Fixture is incomplete.')
      fixed.targetWeaponId = other.id
      fixed.candidateSnapshot.targetWeaponId = other.id
      synchronizeEntry(built.input, fixed)
    })
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.failures).toMatchObject([{ reason: 'fixed_target_mismatch' }])
  })

  it('fails closed when the fixed Entry now carries another Candidate meaning', () => {
    const { result } = remapping('reskinned', (built, entries) => {
      const fixed = entries.find(({ id }) => id.endsWith('.first'))
      if (!fixed) throw new Error('Fixture is incomplete.')
      fixed.candidateSnapshot.finalBonuses = belowPracticalBonuses()
      synchronizeEntry(built.input, fixed)
    })
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.failures).toMatchObject([{
      reason: 'fixed_candidate_fingerprint_mismatch',
    }])
  })
})

function fixedIdOf(entries: readonly BuildListEntry[], suffix: string): string {
  const found = entries.find(({ id }) => id.endsWith(`.${suffix}`))
  if (!found) throw new Error(`Fixture has no '${suffix}' Entry.`)
  return found.id
}

describe('B8-C3b resource re-association per ConflictKind', () => {
  function remapped(
    targets: TargetWeapon[],
    entries: BuildListEntry[],
    ownedWeapons: OwnedWeapon[],
    extra: {
      targets: TargetWeapon[]
      entries: BuildListEntry[]
      ownedWeapons: OwnedWeapon[]
    },
    fixed: BuildListEntry,
  ) {
    const original = originalConstraints(
      targets,
      entries,
      ownedWeapons,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: fixed.id,
      }],
    )
    const augmented = scenario(
      [...targets, ...extra.targets],
      [...entries, ...extra.entries],
      [...ownedWeapons, ...extra.ownedWeapons],
    )
    return {
      original,
      result: preparePlannerAugmentedConflictPreflight(
        augmented.input,
        original.constraints,
        augmented.dependencies,
      ),
    }
  }

  it('re-maps a same_gogma_counter conflict', () => {
    const two = gogmaScenario('kind-gogma', ['first', 'second'])
    const extra = gogmaScenario('kind-gogma', ['generated'])
    const { original, result } = remapped(
      two.targets,
      two.entries,
      two.sources,
      { targets: extra.targets, entries: extra.entries, ownedWeapons: extra.sources },
      two.entries[0],
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts[0].resourceIdentity.kind)
      .toBe('same_gogma_counter')
    expect(result.conflictResolutions[0].conflictKey)
      .not.toBe(original.conflictIds[0])
    expect(result.conflictResolutions[0].selectedBuildListEntryId)
      .toBe(two.entries[0].id)
  })

  it('re-maps a same_skill_counter conflict', () => {
    const build = (ids: readonly string[]) => {
      const targets = ids.map((id, index) =>
        target(`target.pf.kind-skill.${id}`, index === 0 ? 5 : 1),
      )
      const sources = ids.map((id) => normalWeapon(`owned.pf.kind-skill.${id}`))
      return {
        targets,
        sources,
        entries: ids.map((id, index) =>
          routeEntry(
            `entry.pf.kind-skill.${id}`,
            targets[index],
            convertRoute(sources[index].id),
          ),
        ),
      }
    }
    const two = build(['first', 'second'])
    const extra = build(['generated'])
    const { original, result } = remapped(
      two.targets,
      two.entries,
      two.sources,
      { targets: extra.targets, entries: extra.entries, ownedWeapons: extra.sources },
      two.entries[1],
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts[0].resourceIdentity).toEqual({
      kind: 'same_skill_counter',
      counterStream: 'skill',
      counterBefore: 7,
    })
    expect(result.conflictResolutions).toEqual([{
      conflictKey: result.conflictContexts[0].conflictId,
      selectedBuildListEntryId: two.entries[1].id,
    }])
    expect(result.conflictResolutions[0].conflictKey)
      .not.toBe(original.conflictIds[0])
  })

  it('re-maps a same_normal_counter conflict', () => {
    const build = (ids: readonly string[]) => {
      const targets = ids.map((id, index) =>
        target(`target.pf.kind-normal.${id}`, index === 0 ? 5 : 1),
      )
      return {
        targets,
        entries: ids.map((id, index) =>
          routeEntry(
            `entry.pf.kind-normal.${id}`,
            targets[index],
            forgeRoute('weapon.fixture.a', 4),
          ),
        ),
      }
    }
    const two = build(['first', 'second'])
    const extra = build(['generated'])
    const { original, result } = remapped(
      two.targets,
      two.entries,
      [],
      { targets: extra.targets, entries: extra.entries, ownedWeapons: [] },
      two.entries[0],
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts[0].resourceIdentity).toEqual({
      kind: 'same_normal_counter',
      counterStream: 'normal',
      normalCounterId: 'weapon.fixture.a:8',
      counterBefore: 4,
    })
    expect(result.conflictResolutions[0].conflictKey)
      .not.toBe(original.conflictIds[0])
    expect(result.conflictResolutions[0].selectedBuildListEntryId)
      .toBe(two.entries[0].id)
  })

  it('re-maps a same_owned_weapon_consumed conflict by the consumed weapon', () => {
    const shared = sourceWeapon('owned.pf.kind-consumed.shared')
    const build = (ids: readonly string[], counterBase: number) => {
      const targets = ids.map((id, index) =>
        target(`target.pf.kind-consumed.${id}`, index === 0 ? 5 : 1),
      )
      return {
        targets,
        entries: ids.map((id, index) =>
          routeEntry(
            `entry.pf.kind-consumed.${id}`,
            targets[index],
            sharedSourceRoute(shared.id, [counterBase + index * 4]),
          ),
        ),
      }
    }
    const two = build(['first', 'second'], 10)
    const extra = build(['generated'], 20)
    const { original, result } = remapped(
      two.targets,
      two.entries,
      [shared],
      {
        targets: extra.targets,
        entries: extra.entries,
        ownedWeapons: [],
      },
      two.entries[1],
    )
    expect(original.constraints[0].resourceIdentity).toEqual({
      kind: 'same_owned_weapon_consumed',
      counterStream: null,
      consumedOwnedWeaponId: shared.id,
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const consumed = result.conflictContexts.filter(
      ({ kind }) => kind === 'same_owned_weapon_consumed',
    )
    expect(consumed).toHaveLength(1)
    // The resource comes from the conflict's own consumed-weapon field, never
    // from a participant scan, and the participant Entry set never enters the
    // resource identity (PLANNER_SPEC 9.2.3).
    expect(consumed[0].consumedOwnedWeaponId).toBe(shared.id)
    expect(consumed[0].participants).toHaveLength(3)
    expect(result.conflictResolutions).toEqual([{
      conflictKey: consumed[0].conflictId,
      selectedBuildListEntryId: two.entries[1].id,
    }])
  })
})

describe('B8-C3b zero and multiple current conflict matches', () => {
  function baseline(suffix: string) {
    const two = gogmaScenario(suffix, ['first', 'second'])
    const built = scenario(two.targets, two.entries, two.sources)
    const context = readyContext(built)
    const contexts = createPlannerConstrainedConflictContexts(context)
    return { two, context, contexts }
  }

  it('reports current_conflict_not_found when the fixed Entry does not participate', () => {
    const { two, context, contexts } = baseline('nomatch')
    const outsiderTarget = target('target.pf.nomatch.outsider', 2)
    const outsiderSource = sourceWeapon('owned.pf.nomatch.outsider')
    const outsider = routeEntry(
      'entry.pf.nomatch.outsider',
      outsiderTarget,
      resetRoute(outsiderSource.id, 22),
    )
    const built = scenario(
      [...two.targets, outsiderTarget],
      [...two.entries, outsider],
      [...two.sources, outsiderSource],
    )
    const withOutsider = readyContext(built)
    const outsiderEntry = withOutsider.validBuildListEntries.find(
      ({ entry }) => entry.id === outsider.id,
    )
    if (!outsiderEntry) throw new Error('Fixture Entry is missing.')
    const constraint: PlannerFixedConflictConstraint = {
      originalConflictId: contexts[0].conflictId,
      resourceIdentity: contexts[0].resourceIdentity,
      fixedBuildListEntryId: outsiderEntry.entry.id,
      fixedTargetWeaponId: outsiderEntry.entry.targetWeaponId,
      fixedCandidateFingerprint: createBuildCandidateMeaningFingerprint(
        outsiderEntry.entry.candidateSnapshot,
      ),
    }
    const result = reassociatePlannerFixedConstraints(
      withOutsider,
      createPlannerConstrainedConflictContexts(withOutsider),
      [constraint],
    )
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toMatchObject([{ reason: 'current_conflict_not_found' }])
    expect(context.initialConflictDetection.conflicts).toHaveLength(1)
  })

  it('reports current_conflict_ambiguous instead of picking one', () => {
    const { two, context, contexts } = baseline('ambiguous')
    const duplicated: PlannerConstrainedConflictContext[] = [
      contexts[0],
      { ...contexts[0], conflictId: `${contexts[0].conflictId}:duplicate` },
    ]
    const fixed = context.validBuildListEntries.find(
      ({ entry }) => entry.id === two.entries[0].id,
    )
    if (!fixed) throw new Error('Fixture Entry is missing.')
    const result = reassociatePlannerFixedConstraints(context, duplicated, [{
      originalConflictId: contexts[0].conflictId,
      resourceIdentity: contexts[0].resourceIdentity,
      fixedBuildListEntryId: fixed.entry.id,
      fixedTargetWeaponId: fixed.entry.targetWeaponId,
      fixedCandidateFingerprint: createBuildCandidateMeaningFingerprint(
        fixed.entry.candidateSnapshot,
      ),
    }])
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toMatchObject([{ reason: 'current_conflict_ambiguous' }])
  })

  it('fails closed when two constraints collide on one current conflict key', () => {
    const { two, context, contexts } = baseline('collision')
    const constraintFor = (entryId: string): PlannerFixedConflictConstraint => {
      const found = context.validBuildListEntries.find(
        ({ entry }) => entry.id === entryId,
      )
      if (!found) throw new Error('Fixture Entry is missing.')
      return {
        originalConflictId: `${contexts[0].conflictId}:original:${entryId}`,
        resourceIdentity: contexts[0].resourceIdentity,
        fixedBuildListEntryId: found.entry.id,
        fixedTargetWeaponId: found.entry.targetWeaponId,
        fixedCandidateFingerprint: createBuildCandidateMeaningFingerprint(
          found.entry.candidateSnapshot,
        ),
      }
    }
    const result = reassociatePlannerFixedConstraints(context, contexts, [
      constraintFor(two.entries[0].id),
      constraintFor(two.entries[1].id),
    ])
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toHaveLength(2)
    expect(result.failures.every(({ reason }) => reason === 'resolution_key_collision'))
      .toBe(true)
    const reversed = reassociatePlannerFixedConstraints(context, contexts, [
      constraintFor(two.entries[1].id),
      constraintFor(two.entries[0].id),
    ])
    expect(reversed).toEqual(result)
  })

  it('fails closed on a mixed semantic participant context for the fixed Entry', () => {
    const { two, context, contexts } = baseline('participant')
    const fixed = context.validBuildListEntries.find(
      ({ entry }) => entry.id === two.entries[0].id,
    )
    if (!fixed) throw new Error('Fixture Entry is missing.')
    const fingerprint = createBuildCandidateMeaningFingerprint(
      fixed.entry.candidateSnapshot,
    )
    const [participant] = contexts[0].participants.filter(
      ({ buildListEntryId }) => buildListEntryId === fixed.entry.id,
    )
    const mixed: PlannerConstrainedConflictContext[] = [{
      ...contexts[0],
      participants: [
        ...contexts[0].participants,
        { ...participant, candidateFingerprint: `${fingerprint}:other` },
      ],
    }]
    const result = reassociatePlannerFixedConstraints(context, mixed, [{
      originalConflictId: contexts[0].conflictId,
      resourceIdentity: contexts[0].resourceIdentity,
      fixedBuildListEntryId: fixed.entry.id,
      fixedTargetWeaponId: fixed.entry.targetWeaponId,
      fixedCandidateFingerprint: fingerprint,
    }])
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toMatchObject([{ reason: 'participant_context_mismatch' }])
  })
})

describe('B8-C3b multiple explicit resolutions', () => {
  function twoConflictScenario(suffix: string) {
    const near = gogmaScenario(`${suffix}-near`, ['first', 'second'], 10)
    const far = gogmaScenario(`${suffix}-far`, ['first', 'second'], 16)
    const generated = gogmaScenario(`${suffix}-gen`, ['generated'], 10)
    return {
      near,
      far,
      generated,
      targets: [...near.targets, ...far.targets],
      entries: [...near.entries, ...far.entries],
      sources: [...near.sources, ...far.sources],
    }
  }

  function constraintsFor(base: ReturnType<typeof twoConflictScenario>) {
    return originalConstraints(
      base.targets,
      base.entries,
      base.sources,
      (contexts) => {
        const byCounter = new Map(
          contexts.map(({ counterBefore, conflictId }) => [counterBefore, conflictId]),
        )
        return [
          {
            conflictKey: byCounter.get(10) as string,
            selectedBuildListEntryId: base.near.entries[0].id,
          },
          {
            conflictKey: byCounter.get(16) as string,
            selectedBuildListEntryId: base.far.entries[1].id,
          },
        ]
      },
    )
  }

  it('re-maps every explicit resolution, including the untouched one', () => {
    const base = twoConflictScenario('multi')
    const original = constraintsFor(base)
    expect(original.constraints).toHaveLength(2)
    const augmented = scenario(
      [...base.targets, ...base.generated.targets],
      [...base.entries, ...base.generated.entries],
      [...base.sources, ...base.generated.sources],
    )
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictResolutions).toHaveLength(2)
    expect(
      result.conflictResolutions
        .map(({ selectedBuildListEntryId }) => selectedBuildListEntryId)
        .sort(),
    ).toEqual([base.near.entries[0].id, base.far.entries[1].id].sort())
    // The near conflict gained the generated participant, so only its id moved;
    // the untouched far resolution is re-mapped all the same.
    const originalIdByCounter = new Map(
      contextsOf(scenario(base.targets, base.entries, base.sources)).map(
        ({ counterBefore, conflictId }) => [counterBefore, conflictId],
      ),
    )
    const currentByCounter = new Map(
      result.conflictContexts.map(({ counterBefore, conflictId }) => [
        counterBefore,
        conflictId,
      ]),
    )
    expect(currentByCounter.get(10)).not.toBe(originalIdByCounter.get(10))
    expect(currentByCounter.get(16)).toBe(originalIdByCounter.get(16))
    expect(result.conflictResolutions.map(({ conflictKey }) => conflictKey).sort())
      .toEqual([
        currentByCounter.get(10) as string,
        currentByCounter.get(16) as string,
      ].sort())
  })

  it('is independent of the fixed constraint input order', () => {
    const base = twoConflictScenario('order')
    const original = constraintsFor(base)
    const run = (constraints: PlannerFixedConflictConstraint[]) => {
      const augmented = scenario(
        [...base.targets, ...base.generated.targets],
        [...base.entries, ...base.generated.entries],
        [...base.sources, ...base.generated.sources],
      )
      return preparePlannerAugmentedConflictPreflight(
        augmented.input,
        constraints,
        augmented.dependencies,
      )
    }
    const forward = run(original.constraints)
    const reversed = run([...original.constraints].reverse())
    expect(forward.status).toBe('ready')
    expect(
      forward.status === 'ready' ? forward.conflictResolutions : null,
    ).toEqual(reversed.status === 'ready' ? reversed.conflictResolutions : undefined)
  })

  it('returns no resolution at all when one constraint cannot be re-mapped', () => {
    const base = twoConflictScenario('partial')
    const original = constraintsFor(base)
    const augmented = scenario(
      [...base.targets, ...base.generated.targets],
      [...base.entries, ...base.generated.entries],
      [...base.sources, ...base.generated.sources],
    )
    augmented.input.buildListEntries = augmented.input.buildListEntries.filter(
      ({ id }) => id !== base.far.entries[1].id,
    )
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('unresolved')
    if (result.status !== 'unresolved') return
    expect(result.conflictResolutions).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      fixedBuildListEntryId: base.far.entries[1].id,
      reason: 'fixed_entry_not_valid',
    })
  })
})

describe('B8-C3b conflict match granularity', () => {
  it('accepts a fixed Entry that participates through several Route units', () => {
    const shared = sourceWeapon('owned.pf.units.shared')
    const first = target('target.pf.units.first', 5)
    const second = target('target.pf.units.second', 1)
    const generatedTarget = target('target.pf.units.generated', 1)
    const firstEntry = routeEntry(
      'entry.pf.units.first',
      first,
      sharedSourceRoute(shared.id, [10, 11]),
    )
    const secondEntry = routeEntry(
      'entry.pf.units.second',
      second,
      sharedSourceRoute(shared.id, [14]),
    )
    const generatedEntry = routeEntry(
      'entry.pf.units.generated',
      generatedTarget,
      sharedSourceRoute(shared.id, [18]),
    )
    const owned = [shared]
    const original = originalConstraints(
      [first, second],
      [firstEntry, secondEntry],
      owned,
      (contexts) => {
        const consumed = contexts.find(
          ({ kind }) => kind === 'same_owned_weapon_consumed',
        )
        if (!consumed) throw new Error('Fixture produced no consumed-weapon conflict.')
        expect(
          consumed.participants.filter(
            ({ buildListEntryId }) => buildListEntryId === firstEntry.id,
          ),
        ).toHaveLength(2)
        return [{
          conflictKey: consumed.conflictId,
          selectedBuildListEntryId: firstEntry.id,
        }]
      },
    )
    const augmented = scenario(
      [first, second, generatedTarget],
      [firstEntry, secondEntry, generatedEntry],
      owned,
    )
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const consumed = result.conflictContexts.find(
      ({ kind }) => kind === 'same_owned_weapon_consumed',
    )
    if (!consumed) throw new Error('The augmented input lost the consumed-weapon conflict.')
    expect(
      consumed.participants.filter(
        ({ buildListEntryId }) => buildListEntryId === firstEntry.id,
      ).length,
    ).toBeGreaterThan(1)
    expect(result.conflictResolutions).toContainEqual({
      conflictKey: consumed.conflictId,
      selectedBuildListEntryId: firstEntry.id,
    })
  })
})

describe('B8-C3b generated Entry is never promoted to the fixed side', () => {
  it('keeps the original fixed Entry even when the generated one is recommended', () => {
    const two = gogmaScenario('promote', ['first', 'second'])
    const generatedTarget = target('target.pf.promote.generated', 5)
    const generatedSource = sourceWeapon('owned.pf.promote.generated')
    const generatedEntry = routeEntry(
      'entry.pf.promote.generated',
      generatedTarget,
      resetRoute(generatedSource.id, 10),
    )
    const original = originalConstraints(
      two.targets,
      two.entries,
      two.sources,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: two.entries[1].id,
      }],
    )
    const augmented = scenario(
      [...two.targets, generatedTarget],
      [...two.entries, generatedEntry],
      [...two.sources, generatedSource],
    )
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const detected = result.preflightContext.initialConflictDetection.conflicts[0]
    expect(detected.buildListEntryIds).toContain(generatedEntry.id)
    expect(detected.recommendedBuildListEntryId).not.toBeNull()
    expect(result.conflictResolutions).toEqual([{
      conflictKey: detected.id,
      selectedBuildListEntryId: two.entries[1].id,
    }])
  })

  it('creates no fixed constraint of its own when none was given', () => {
    const three = gogmaScenario('empty', ['first', 'second', 'generated'])
    const augmented = scenario(three.targets, three.entries, three.sources)
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      [],
      augmented.dependencies,
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.conflictContexts).toHaveLength(1)
    expect(result.conflictResolutions).toEqual([])
    expect(result.resolvedInput.conflictResolutions).toEqual([])
  })
})

describe('B8-C3b invalid preflight', () => {
  it('returns the ordinary Planner validation result without a re-association reason', () => {
    const two = gogmaScenario('invalid', ['first', 'second'])
    const original = originalConstraints(
      two.targets,
      two.entries,
      two.sources,
      (contexts) => [{
        conflictKey: contexts[0].conflictId,
        selectedBuildListEntryId: two.entries[0].id,
      }],
    )
    const augmented = scenario(two.targets, two.entries, two.sources)
    augmented.input.options = { ...augmented.input.options, beamWidth: 0 }
    const result = preparePlannerAugmentedConflictPreflight(
      augmented.input,
      original.constraints,
      augmented.dependencies,
    )
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: 'beamWidth' }),
    )
    expect(result.excludedBuildListEntries).toEqual([])
    expect(result).not.toHaveProperty('failures')
  })
})
