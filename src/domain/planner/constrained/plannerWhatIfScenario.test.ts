import { describe, expect, it } from 'vitest'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../../test/fixtures/plannerBeam'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import type { PlannerConflictResolution } from '../plannerTypes'
import { createPlannerConflictContexts } from '../replacement/plannerConflictContext'
import { preparePlannerConflictScenario } from '../replacement/plannerConflictScenario'
import { PlannerWhatIfBoundsError } from './plannerWhatIfBounds'
import { preparePlannerWhatIfScenario } from './plannerWhatIfScenario'

/**
 * The legacy B9 wrapper of the shared scenario preparation (Phase 6-B2a): the
 * B9 bounds check in front, and otherwise exactly the shared result. The
 * preparation itself is covered by
 * `../replacement/plannerConflictScenario.test.ts`.
 */

function resolution(
  conflictKey: string,
  selectedBuildListEntryId: string,
): PlannerConflictResolution {
  return {
    conflictKey,
    selectedBuildListEntryId: selectedBuildListEntryId as never,
  }
}

function gogmaScenario(suffix: string) {
  const ids = ['first', 'second']
  const targets = ids.map((id, index) =>
    target(`target.whatif.${suffix}.${id}`, index === 0 ? 5 : 1),
  )
  const sources = ids.map((id) => sourceWeapon(`owned.whatif.${suffix}.${id}`))
  const entries = ids.map((id, index) =>
    routeEntry(
      `entry.whatif.${suffix}.${id}`,
      targets[index],
      resetRoute(sources[index].id, 10),
    ),
  )
  return fixture(targets, entries, sources)
}

describe('B9-B1a what-if scenario wrapper', () => {
  it('throws on invalid bounds before touching the Planner input', () => {
    const { input, dependencies } = gogmaScenario('bad-bounds')
    const before = structuredClone(input)
    expect(() =>
      preparePlannerWhatIfScenario(
        {
          plannerInput: input,
          scenarioResolution: resolution('conflict-X', input.buildListEntries[0].id),
          bounds: { maxCandidateTrialsPerTarget: 0, maxPlannerReruns: 1 },
        },
        dependencies,
      ),
    ).toThrow(PlannerWhatIfBoundsError)
    expect(input).toEqual(before)
  })

  it('returns exactly the shared preparation for valid bounds', () => {
    const { input, dependencies } = gogmaScenario('shared')
    const prepared = preparePlannerInitialContext(input, dependencies)
    if (prepared.status !== 'ready') throw new Error('Expected a ready context.')
    const [conflict] = createPlannerConflictContexts(prepared.context)
    const scenarioResolution = resolution(conflict.conflictId, input.buildListEntries[1].id)

    const legacy = preparePlannerWhatIfScenario(
      {
        plannerInput: input,
        scenarioResolution,
        bounds: { maxCandidateTrialsPerTarget: 1, maxPlannerReruns: 1 },
      },
      dependencies,
    )
    const shared = preparePlannerConflictScenario(
      { plannerInput: input, scenarioResolution },
      dependencies,
    )

    expect(legacy.status).toBe('ready')
    expect(legacy).toEqual(shared)
  })
})
