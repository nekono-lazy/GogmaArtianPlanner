import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  OwnedWeapon,
  TargetWeapon,
} from '../../models/publicTypes'
import { createBuildCandidateMeaningFingerprint } from '../../buildList'
import {
  fixture,
  resetRoute,
  sourceWeapon,
  target,
  routeEntry,
} from '../../../test/fixtures/plannerBeam'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
} from '../plannerTypes'
import { createPlannerConstrainedConflictContexts } from './plannerConflictContext'
import { PlannerWhatIfBoundsError } from './plannerWhatIfBounds'
import type { PlannerWhatIfBounds } from './plannerWhatIfBounds'
import {
  mergePlannerWhatIfScenarioResolution,
  preparePlannerWhatIfScenario,
  type PlannerWhatIfScenarioPreparationResult,
} from './plannerWhatIfScenario'
import type { PlannerWhatIfRequest } from './plannerWhatIfTypes'

const BOUNDS: PlannerWhatIfBounds = {
  maxCandidateTrialsPerTarget: 1,
  maxPlannerReruns: 1,
}

function resolution(
  conflictKey: string,
  selectedBuildListEntryId: string,
): PlannerConflictResolution {
  return {
    conflictKey,
    selectedBuildListEntryId: selectedBuildListEntryId as never,
  }
}

/** One Gogma Counter conflict with `ids.length` participating Targets. */
function gogmaScenario(suffix: string, ids: readonly string[], counter = 10) {
  const targets = ids.map((id, index) =>
    target(`target.whatif.${suffix}.${id}`, index === 0 ? 5 : 1),
  )
  const sources = ids.map((id) => sourceWeapon(`owned.whatif.${suffix}.${id}`))
  const entries = ids.map((id, index) =>
    routeEntry(
      `entry.whatif.${suffix}.${id}`,
      targets[index],
      resetRoute(sources[index].id, counter),
    ),
  )
  return { targets, sources, entries }
}

function build(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[],
  resolutions: PlannerConflictResolution[] = [],
): { input: PlannerInput; dependencies: PlannerDependencies } {
  const built = fixture(
    targets,
    entries.map((entry) => structuredClone(entry)),
    ownedWeapons,
  )
  built.input.conflictResolutions = resolutions
  return built
}

/** The `PlanConflict.id`s the ordinary Planner authority detects, in order. */
function detectedConflicts(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[],
) {
  const { input, dependencies } = build(targets, entries, ownedWeapons)
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return {
    contexts: createPlannerConstrainedConflictContexts(prepared.context),
    conflicts: prepared.context.initialConflictDetection.conflicts,
  }
}

function prepare(
  targets: TargetWeapon[],
  entries: BuildListEntry[],
  ownedWeapons: OwnedWeapon[],
  scenarioResolution: PlannerConflictResolution,
  otherResolutions: PlannerConflictResolution[] = [],
  mutate: (input: PlannerInput) => void = () => {},
): {
  request: PlannerWhatIfRequest
  result: PlannerWhatIfScenarioPreparationResult
} {
  const { input, dependencies } = build(
    targets,
    entries,
    ownedWeapons,
    otherResolutions,
  )
  mutate(input)
  const request: PlannerWhatIfRequest = {
    plannerInput: input,
    scenarioResolution,
    bounds: BOUNDS,
  }
  return { request, result: preparePlannerWhatIfScenario(request, dependencies) }
}

describe('B9-B1a scenario resolution merge', () => {
  const { input } = build([], [], [], [
    resolution('conflict-X', 'entry-old'),
    resolution('conflict-Y', 'entry-Y'),
  ])

  it('replaces the resolution carrying the scenario conflictKey', () => {
    const merged = mergePlannerWhatIfScenarioResolution(
      input,
      resolution('conflict-X', 'entry-new'),
    )
    expect(merged.conflictResolutions).toEqual([
      resolution('conflict-X', 'entry-new'),
      resolution('conflict-Y', 'entry-Y'),
    ])
  })

  it('appends a scenario conflictKey the input does not carry', () => {
    const merged = mergePlannerWhatIfScenarioResolution(
      input,
      resolution('conflict-Z', 'entry-Z'),
    )
    expect(merged.conflictResolutions).toEqual([
      resolution('conflict-X', 'entry-old'),
      resolution('conflict-Y', 'entry-Y'),
      resolution('conflict-Z', 'entry-Z'),
    ])
  })

  it('never mutates the caller input', () => {
    const before = structuredClone(input)
    mergePlannerWhatIfScenarioResolution(input, resolution('conflict-X', 'entry-new'))
    mergePlannerWhatIfScenarioResolution(input, resolution('conflict-Z', 'entry-Z'))
    expect(input).toEqual(before)
    expect(
      mergePlannerWhatIfScenarioResolution(input, resolution('conflict-Z', 'entry-Z'))
        .conflictResolutions,
    ).not.toBe(input.conflictResolutions)
  })

  it('keeps every unrelated field of the input', () => {
    const merged = mergePlannerWhatIfScenarioResolution(
      input,
      resolution('conflict-X', 'entry-new'),
    )
    expect({ ...merged, conflictResolutions: [] })
      .toEqual({ ...input, conflictResolutions: [] })
  })

  it('preserves a malformed duplicate conflictKey instead of repairing it', () => {
    const { input: malformed } = build([], [], [], [
      resolution('conflict-X', 'entry-1'),
      resolution('conflict-X', 'entry-2'),
    ])
    const merged = mergePlannerWhatIfScenarioResolution(
      malformed,
      resolution('conflict-X', 'entry-3'),
    )
    expect(merged.conflictResolutions).toHaveLength(2)
    expect(
      merged.conflictResolutions.filter(
        ({ conflictKey }) => conflictKey === 'conflict-X',
      ),
    ).toHaveLength(2)
  })

  it('lets Planner validation fail closed on a preserved duplicate', () => {
    const scenario = gogmaScenario('duplicate', ['first', 'second'])
    const { conflicts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const conflictKey = conflicts[0].id
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(conflictKey, scenario.entries[1].id),
      [
        resolution(conflictKey, scenario.entries[0].id),
        resolution(conflictKey, scenario.entries[1].id),
      ],
    )
    expect(result.status).toBe('planner_input_not_ready')
    expect(
      result.status === 'planner_input_not_ready' &&
        result.issues.some(({ message }) => message === 'conflictKey must be unique.'),
    ).toBe(true)
  })
})

describe('B9-B1a scenario preparation', () => {
  it('prepares the scenario from the existing Planner authority', () => {
    const scenario = gogmaScenario('valid', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    expect(contexts).toHaveLength(1)
    const conflictKey = contexts[0].conflictId
    const fixed = scenario.entries[1]
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(conflictKey, fixed.id),
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const { scenario: prepared } = result
    expect(prepared.mergedInput.conflictResolutions).toEqual([
      resolution(conflictKey, fixed.id),
    ])
    expect(prepared.fixedConstraints).toEqual([{
      originalConflictId: conflictKey,
      resourceIdentity: {
        kind: 'same_gogma_counter',
        counterStream: 'gogma',
        counterBefore: 10,
      },
      fixedBuildListEntryId: fixed.id,
      fixedTargetWeaponId: scenario.targets[1].id,
      fixedCandidateFingerprint: createBuildCandidateMeaningFingerprint(
        fixed.candidateSnapshot,
      ),
    }])
    expect(prepared.scenarioConstraint).toBe(prepared.fixedConstraints[0])
    expect(prepared.conflictContexts).toHaveLength(1)
    expect(prepared.initialContext.validConflictResolutions).toEqual([
      resolution(conflictKey, fixed.id),
    ])
  })

  it('builds the origin from the Planner-start snapshot with no UI request field', () => {
    const scenario = gogmaScenario('origin', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const { request, result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(contexts[0].conflictId, scenario.entries[1].id),
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(Object.keys(result.scenario.origin).sort()).toEqual([
      'calculationContext',
      'master',
      'normalCounters',
      'ownedWeapons',
      'rngState',
      'targetWeapons',
    ])
    expect(result.scenario.origin.rngState)
      .toEqual(request.plannerInput.rngState)
    expect(result.scenario.origin.rngState)
      .not.toBe(request.plannerInput.rngState)
  })

  it('yields one work per unique non-fixed participant Target', () => {
    const scenario = gogmaScenario('works', ['first', 'second', 'third'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const conflictKey = contexts[0].conflictId
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(conflictKey, scenario.entries[0].id),
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.scenario.works.map(({ targetWeaponId }) => targetWeaponId))
      .toEqual([scenario.targets[1].id, scenario.targets[2].id])
    result.scenario.works.forEach((work) => {
      expect(work.originalConflictId).toBe(conflictKey)
      expect(work.constraint).toBe(result.scenario.scenarioConstraint)
      expect(work.targetWeaponId).not.toBe(scenario.targets[0].id)
    })
  })

  it('keeps every other explicit resolution while working only on the scenario conflict', () => {
    const near = gogmaScenario('multi-near', ['first', 'second'], 10)
    const far = gogmaScenario('multi-far', ['first', 'second'], 16)
    const targets = [...near.targets, ...far.targets]
    const entries = [...near.entries, ...far.entries]
    const sources = [...near.sources, ...far.sources]
    const { contexts } = detectedConflicts(targets, entries, sources)
    expect(contexts).toHaveLength(2)
    const byCounter = new Map(
      contexts.map((entry) => [entry.counterBefore, entry.conflictId]),
    )
    const scenarioKey = byCounter.get(10) as string
    const otherKey = byCounter.get(16) as string
    const { result } = prepare(
      targets,
      entries,
      sources,
      resolution(scenarioKey, near.entries[1].id),
      [resolution(otherKey, far.entries[0].id)],
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const { scenario: prepared } = result
    expect(
      prepared.fixedConstraints.map(({ originalConflictId }) => originalConflictId).sort(),
    ).toEqual([scenarioKey, otherKey].sort())
    expect(prepared.scenarioConstraint.originalConflictId).toBe(scenarioKey)
    expect(prepared.scenarioConstraint.fixedBuildListEntryId)
      .toBe(near.entries[1].id)
    // Only the scenario conflict produces what-if work; the other user choice
    // stays a feasibility constraint.
    expect(prepared.works.map(({ originalConflictId }) => originalConflictId))
      .toEqual([scenarioKey])
    expect(prepared.works.map(({ targetWeaponId }) => targetWeaponId))
      .toEqual([near.targets[0].id])
  })

  it('never mutates the request input', () => {
    const scenario = gogmaScenario('immutable', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const { request, result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(contexts[0].conflictId, scenario.entries[1].id),
    )
    expect(result.status).toBe('ready')
    const { input } = build(scenario.targets, scenario.entries, scenario.sources)
    expect(request.plannerInput.conflictResolutions).toEqual([])
    expect(request.plannerInput.buildListEntries).toEqual(input.buildListEntries)
    expect(request.plannerInput.targetWeapons).toEqual(input.targetWeapons)
    expect(request.plannerInput.ownedWeapons).toEqual(input.ownedWeapons)
    expect(request.plannerInput.rngState).toEqual(input.rngState)
  })
})

describe('B9-B1a scenario preparation failures', () => {
  it('fails closed when validation dropped the scenario resolution', () => {
    const scenario = gogmaScenario('dropped', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const conflictKey = contexts[0].conflictId
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(conflictKey, 'entry.whatif.dropped.missing'),
    )
    expect(result).toEqual({
      status: 'invalid_fixed_resolution',
      reason: 'scenario_resolution_not_valid',
      conflictKey,
      selectedBuildListEntryId: 'entry.whatif.dropped.missing',
      detail: expect.any(String),
    })
  })

  it('selects no alternate Entry when the scenario resolution was dropped', () => {
    const scenario = gogmaScenario('no-alternate', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(contexts[0].conflictId, 'entry.whatif.no-alternate.missing'),
    )
    expect(result.status).toBe('invalid_fixed_resolution')
    expect('scenario' in result).toBe(false)
  })

  it('fails closed when the scenario conflictKey matches no detected conflict', () => {
    const scenario = gogmaScenario('missing-key', ['first', 'second'])
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution('plan-conflict:not-detected', scenario.entries[0].id),
    )
    expect(result).toMatchObject({
      status: 'invalid_fixed_resolution',
      reason: 'fixed_constraints_unresolved',
      conflictKey: 'plan-conflict:not-detected',
      selectedBuildListEntryId: scenario.entries[0].id,
    })
  })

  it('fails closed when the selected Entry is not a conflict participant', () => {
    const scenario = gogmaScenario('outsider', ['first', 'second'])
    const outsiderTarget = target('target.whatif.outsider.third', 2)
    const outsiderSource = sourceWeapon('owned.whatif.outsider.third')
    const outsider = routeEntry(
      'entry.whatif.outsider.third',
      outsiderTarget,
      resetRoute(outsiderSource.id, 20),
    )
    const targets = [...scenario.targets, outsiderTarget]
    const entries = [...scenario.entries, outsider]
    const sources = [...scenario.sources, outsiderSource]
    const { contexts } = detectedConflicts(targets, entries, sources)
    const { result } = prepare(
      targets,
      entries,
      sources,
      resolution(contexts[0].conflictId, outsider.id),
    )
    expect(result).toMatchObject({
      status: 'invalid_fixed_resolution',
      reason: 'fixed_constraints_unresolved',
      selectedBuildListEntryId: outsider.id,
    })
  })

  it('reports an unusable Planner input before any what-if work', () => {
    const scenario = gogmaScenario('invalid-input', ['first', 'second'])
    const { contexts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(contexts[0].conflictId, scenario.entries[1].id),
      [],
      (input) => {
        input.options = { ...input.options, beamWidth: 0 }
      },
    )
    expect(result.status).toBe('planner_input_not_ready')
    if (result.status !== 'planner_input_not_ready') return
    expect(result.issues.map(({ path }) => path)).toContain('beamWidth')
    expect(Array.isArray(result.warnings)).toBe(true)
    expect(Array.isArray(result.excludedBuildListEntries)).toBe(true)
  })

  it('throws on invalid bounds before touching the Planner input', () => {
    const scenario = gogmaScenario('bad-bounds', ['first', 'second'])
    const { input, dependencies } = build(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const before = structuredClone(input)
    expect(() =>
      preparePlannerWhatIfScenario(
        {
          plannerInput: input,
          scenarioResolution: resolution('conflict-X', scenario.entries[0].id),
          bounds: { maxCandidateTrialsPerTarget: 0, maxPlannerReruns: 1 },
        },
        dependencies,
      ),
    ).toThrow(PlannerWhatIfBoundsError)
    expect(input).toEqual(before)
  })
})

describe('B9-B1a fixed authority', () => {
  it('fixes only the scenario selection, never recommendedBuildListEntryId', () => {
    const scenario = gogmaScenario('recommended', ['first', 'second'])
    const { contexts, conflicts } = detectedConflicts(
      scenario.targets,
      scenario.entries,
      scenario.sources,
    )
    const recommended = conflicts[0].recommendedBuildListEntryId
    expect(recommended).not.toBeNull()
    const selected = scenario.entries.find(({ id }) => id !== recommended)
    expect(selected).toBeDefined()
    const { result } = prepare(
      scenario.targets,
      scenario.entries,
      scenario.sources,
      resolution(contexts[0].conflictId, (selected as BuildListEntry).id),
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.scenario.scenarioConstraint.fixedBuildListEntryId)
      .toBe((selected as BuildListEntry).id)
    expect(result.scenario.scenarioConstraint.fixedBuildListEntryId)
      .not.toBe(recommended)
    // The recommended Entry's Target is what the what-if measures, not what it
    // fixes.
    expect(result.scenario.works.map(({ targetWeaponId }) => targetWeaponId))
      .toEqual([
        scenario.entries.find(({ id }) => id === recommended)?.targetWeaponId,
      ])
  })
})
