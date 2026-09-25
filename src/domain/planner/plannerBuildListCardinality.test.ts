import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../models/publicTypes'
import {
  applyBuildListEntryReplacements,
  type BuildListEntryReplacement,
} from '../buildList'
import { buildListEntryId } from '../../test/fixtures/domainData'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { validatePlannerInput } from './plannerValidation'
import { createProductionPlan } from './productionPlanGeneration'

/**
 * The ordinary persisted Planner input inherits the Build List cardinality
 * contract: at most one BuildListEntry per planning Target
 * (`docs/DATA_MODEL.md` 9.4.1, `docs/PLANNER_SPEC.md` 4.1). A legacy duplicate
 * fails the whole input closed; only a B8 / what-if trial input may hold
 * several Entries of one Target (9.2.18).
 */

function markStale(entry: BuildListEntry) {
  // Staleness is recalculated from current data: a stored Target definition
  // hash that no longer matches excludes the Entry as target_definition_changed.
  entry.targetDefinitionHash = 'hash.cardinality.stale'
}

/**
 * Target A with two Routes (A1, A2), Target B with one (B1), each Route at its
 * own Gogma Counter position (`counters` = A1, A2, B1).
 */
function duplicateScenario(counters: readonly [number, number, number] = [10, 11, 12]) {
  const a = target('target.cardinality.a')
  const b = target('target.cardinality.b')
  const sources = ['a1', 'a2', 'b1'].map((suffix) => sourceWeapon(`owned.cardinality.${suffix}`))
  const entries = [
    routeEntry('entry.cardinality.a1', a, resetRoute(sources[0].id, counters[0])),
    routeEntry('entry.cardinality.a2', a, resetRoute(sources[1].id, counters[1])),
    routeEntry('entry.cardinality.b1', b, resetRoute(sources[2].id, counters[2])),
  ]
  return { a, b, ...fixture([a, b], entries, sources) }
}

describe('Planner input Build List cardinality', () => {
  it('plans a valid one-Entry-per-Target input as before', async () => {
    const a = target('target.cardinality.single.a')
    const b = target('target.cardinality.single.b')
    const sources = ['a', 'b'].map((suffix) => sourceWeapon(`owned.cardinality.single.${suffix}`))
    const { input, dependencies } = fixture([a, b], [
      routeEntry('entry.cardinality.single.a', a, resetRoute(sources[0].id)),
      routeEntry('entry.cardinality.single.b', b, resetRoute(sources[1].id, 11)),
    ], sources)

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    const result = await runPlannerBeamSearchOracle(input, dependencies)
    expect(result.bestState).not.toBeNull()
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 2,
      totalTargetCount: 2,
    })
  })

  it('fails a planning Target with two Entries closed before the Beam Search, choosing neither', async () => {
    const { input, dependencies, a } = duplicateScenario()

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(false)
    const message = `TargetWeapon '${a.id}' has 2 BuildListEntries (entry.cardinality.a1, entry.cardinality.a2)`
    expect(validation.issues).toContainEqual(expect.objectContaining({
      path: 'buildListEntries',
      code: 'invalid_structure',
      message: expect.stringContaining(message) as string,
    }))
    expect(validation.warnings).toContainEqual({
      kind: 'duplicate_build_list_entries_for_target',
      message: expect.stringContaining(message) as string,
    })
    expect(preparePlannerInitialContext(input, dependencies).status).toBe('invalid')

    const beam = await runPlannerBeamSearchOracle(input, dependencies)
    expect(beam.bestState).toBeNull()
    expect(beam.expandedStates).toBe(0)
    const result = await createProductionPlan(input, dependencies)
    expect(result.plan).toBeNull()
    expect(result.conflicts).toEqual([])
    // The unsearched termination still counts the planning Targets once.
    expect(result.termination).toMatchObject({
      status: 'exhausted',
      reachedLimits: [],
      expandedStates: 0,
      completedTargetCount: 0,
      totalTargetCount: 2,
    })
  })

  it('counts a stale Entry beside a valid one, so the valid one is never picked silently', async () => {
    const { input, dependencies } = duplicateScenario()
    markStale(input.buildListEntries[1])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.validBuildListEntries.map(({ entry }) => entry.id)).toEqual([
      'entry.cardinality.a1',
      'entry.cardinality.b1',
    ])
    expect(validation.isValid).toBe(false)
    expect(validation.warnings.map(({ kind }) => kind)).toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect((await createProductionPlan(input, dependencies)).plan).toBeNull()
  })

  it('leaves a duplicate of a Target that is no planning Target to the Build List', async () => {
    const { input, dependencies, b } = duplicateScenario([11, 12, 10])
    // Every Entry of Target A is excluded, so the run plans Target B alone and
    // chooses nothing for A.
    markStale(input.buildListEntries[0])
    markStale(input.buildListEntries[1])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.isValid).toBe(true)
    expect(validation.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    expect(preparePlannerInitialContext(input, dependencies).status).toBe('ready')
    const result = await runPlannerBeamSearchOracle(input, dependencies)
    expect(result.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 1,
      totalTargetCount: 1,
    })
    expect(Object.keys(result.bestState?.targetSatisfaction ?? {})).toEqual([b.id])
  })

})

/**
 * The temporary augmented contract of a B8 / what-if trial input
 * (`docs/PLANNER_SPEC.md` 9.2.18): per Target, persisted 0..1 + temporary 0..1,
 * with the temporary Entries and the persisted Entries they replace named only
 * by runtime replacement metadata.
 */
describe('Planner trial input temporary Build List cardinality', () => {
  function replacement(
    targetWeaponId: string,
    replaced: string,
    generated: string,
  ): BuildListEntryReplacement {
    return {
      targetWeaponId: targetWeaponId as BuildListEntryReplacement['targetWeaponId'],
      replacedBuildListEntryId: buildListEntryId(replaced),
      generatedBuildListEntryId: buildListEntryId(generated),
    }
  }

  /**
   * Target A: persisted A1 and temporary A2; Target B: persisted B1. A2 takes
   * the first Gogma position and B1 the next, so the replacement set (A2, B1)
   * is a complete Plan without A1.
   */
  function trialScenario() {
    const built = duplicateScenario([12, 10, 11])
    return {
      ...built,
      replacements: [
        replacement(built.a.id, 'entry.cardinality.a1', 'entry.cardinality.a2'),
      ],
    }
  }

  function issuesOf(validation: ReturnType<typeof validatePlannerInput>): string[] {
    return validation.issues.map(({ message }) => message)
  }

  it('accepts persisted O + temporary G as the augmented input, and runs the replacement set with G only', async () => {
    const { input, dependencies, replacements, a } = trialScenario()

    const augmented = validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements,
    })
    expect(augmented.isValid).toBe(true)
    expect(augmented.warnings.map(({ kind }) => kind)).not.toContain(
      'duplicate_build_list_entries_for_target',
    )
    // O stays in the augmented input: the preflight needs its conflicts.
    expect(augmented.validBuildListEntries.map(({ entry }) => entry.id)).toEqual([
      'entry.cardinality.a1',
      'entry.cardinality.a2',
      'entry.cardinality.b1',
    ])

    const replacementSet = {
      ...input,
      buildListEntries: applyBuildListEntryReplacements(input.buildListEntries, replacements, []),
    }
    expect(replacementSet.buildListEntries.map(({ id }) => id)).toEqual([
      'entry.cardinality.a2',
      'entry.cardinality.b1',
    ])
    const beam = await runPlannerBeamSearchOracle(replacementSet, dependencies, {}, {
      kind: 'temporary_replacement',
      replacements,
    })
    expect(beam.bestState).not.toBeNull()
    expect(beam.termination).toMatchObject({ status: 'completed', completedTargetCount: 2 })
    const progressed = new Set(
      beam.bestState?.trace.flatMap(({ progressedBuildListEntryIds }) => progressedBuildListEntryIds) ?? [],
    )
    expect(progressed.has(buildListEntryId('entry.cardinality.a1'))).toBe(false)
    expect(progressed.has(buildListEntryId('entry.cardinality.a2'))).toBe(true)
    expect(a.id).toBe('target.cardinality.a')
  })

  it('fails closed on persisted O1 + persisted O2 + temporary G', () => {
    const built = duplicateScenario()
    const source = sourceWeapon('owned.cardinality.a3')
    const extra = routeEntry('entry.cardinality.a3', built.a, resetRoute(source.id, 13))
    const { input, dependencies } = fixture(
      [built.a, built.b],
      [...built.input.buildListEntries, extra],
      [...built.input.ownedWeapons, source],
    )
    const validation = validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements: [replacement(built.a.id, 'entry.cardinality.a1', 'entry.cardinality.a3')],
    })
    expect(validation.isValid).toBe(false)
    expect(issuesOf(validation)).toContainEqual(expect.stringContaining(
      `TargetWeapon '${built.a.id}' has 2 BuildListEntries (entry.cardinality.a1, entry.cardinality.a2)`,
    ))
    expect(preparePlannerInitialContext(input, dependencies, {
      kind: 'temporary_augmented',
      replacements: [replacement(built.a.id, 'entry.cardinality.a1', 'entry.cardinality.a3')],
    }).status).toBe('invalid')
  })

  it('fails closed on persisted O + temporary G1 + temporary G2', () => {
    const built = duplicateScenario()
    const source = sourceWeapon('owned.cardinality.a3')
    const extra = routeEntry('entry.cardinality.a3', built.a, resetRoute(source.id, 13))
    const { input, dependencies } = fixture(
      [built.a, built.b],
      [...built.input.buildListEntries, extra],
      [...built.input.ownedWeapons, source],
    )
    const validation = validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements: [
        replacement(built.a.id, 'entry.cardinality.a1', 'entry.cardinality.a2'),
        replacement(built.a.id, 'entry.cardinality.a1', 'entry.cardinality.a3'),
      ],
    })
    expect(validation.isValid).toBe(false)
    expect(issuesOf(validation)).toContainEqual(expect.stringContaining(
      `TargetWeapon '${built.a.id}' has more than one temporary BuildListEntry replacement`,
    ))
  })

  it('fails closed on a temporary Entry of another Target and on an unnamed temporary Entry', () => {
    const { input, dependencies, a, b } = trialScenario()
    // The replacement names Target B, but the temporary Entry targets A.
    const wrongTarget = validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements: [replacement(b.id, 'entry.cardinality.b1', 'entry.cardinality.a2')],
    })
    expect(wrongTarget.isValid).toBe(false)
    // No replacement names A2 at all: Target A holds two persisted Entries.
    const unnamed = validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements: [],
    })
    expect(unnamed.isValid).toBe(false)
    expect(issuesOf(unnamed)).toContainEqual(expect.stringContaining(
      `TargetWeapon '${a.id}' has 2 BuildListEntries`,
    ))
  })

  it('refuses a replacement set that still holds the replaced Entry', async () => {
    const { input, dependencies, replacements } = trialScenario()
    const beam = await runPlannerBeamSearchOracle(input, dependencies, {}, {
      kind: 'temporary_replacement',
      replacements,
    })
    expect(beam.bestState).toBeNull()
    expect(beam.termination).toMatchObject({ status: 'exhausted', expandedStates: 0 })
  })

  it('accepts one O + G pair on each of two Targets', async () => {
    const a = target('target.cardinality.pair.a')
    const b = target('target.cardinality.pair.b')
    const sources = ['a1', 'a2', 'b1', 'b2'].map((suffix) => sourceWeapon(`owned.cardinality.pair.${suffix}`))
    const { input, dependencies } = fixture([a, b], [
      routeEntry('entry.cardinality.pair.a1', a, resetRoute(sources[0].id, 12)),
      routeEntry('entry.cardinality.pair.a2', a, resetRoute(sources[1].id, 10)),
      routeEntry('entry.cardinality.pair.b1', b, resetRoute(sources[2].id, 13)),
      routeEntry('entry.cardinality.pair.b2', b, resetRoute(sources[3].id, 11)),
    ], sources)
    const replacements = [
      replacement(a.id, 'entry.cardinality.pair.a1', 'entry.cardinality.pair.a2'),
      replacement(b.id, 'entry.cardinality.pair.b1', 'entry.cardinality.pair.b2'),
    ]
    expect(validatePlannerInput(input, dependencies, {
      kind: 'temporary_augmented',
      replacements,
    }).isValid).toBe(true)
    const replacementSet = {
      ...input,
      buildListEntries: applyBuildListEntryReplacements(input.buildListEntries, replacements, []),
    }
    const beam = await runPlannerBeamSearchOracle(replacementSet, dependencies, {}, {
      kind: 'temporary_replacement',
      replacements,
    })
    expect(beam.termination).toMatchObject({ status: 'completed', completedTargetCount: 2, totalTargetCount: 2 })
  })
})
