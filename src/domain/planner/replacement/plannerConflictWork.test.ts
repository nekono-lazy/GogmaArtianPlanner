import { describe, expect, it } from 'vitest'
import type { BuildListEntryId, TargetWeaponId } from '../../models/publicTypes'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../../test/fixtures/plannerBeam'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import type { PlannerCheckpointRequirements } from '../plannerCheckpoints'
import {
  createPlannerConflictContexts,
  preparePlannerFixedConflictConstraints,
  type PlannerConflictContext,
} from './plannerConflictContext'
import { createPlannerConflictWorks } from './plannerConflictWork'

/**
 * The shared conflict work derivation (Phase 6-B2a; formerly the B8-C4b
 * "conflict work scheduling" tests of the legacy orchestration). The works are
 * built from the ordinary Planner's own conflict detection over one
 * `same_gogma_counter` conflict of three Targets, whose first Entry is fixed.
 */

const IDS = ['first', 'second', 'third'] as const

function threeTargetConflict() {
  const targets = IDS.map((id, index) =>
    target(`target.work.${id}`, index === 0 ? 5 : 1),
  )
  const sources = IDS.map((id) => sourceWeapon(`owned.work.${id}`))
  const entries = IDS.map((id, index) =>
    routeEntry(`entry.work.${id}`, targets[index], resetRoute(sources[index].id, 10)),
  )
  const probe = fixture(targets, entries.map((entry) => structuredClone(entry)), sources)
  const probed = preparePlannerInitialContext(probe.input, probe.dependencies)
  if (probed.status !== 'ready') throw new Error('Expected a ready context.')
  const [conflict] = createPlannerConflictContexts(probed.context)

  const built = fixture(targets, entries, sources)
  built.input.conflictResolutions = [{
    conflictKey: conflict.conflictId,
    selectedBuildListEntryId: entries[0].id,
  }]
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('Expected a ready context.')
  const contexts = createPlannerConflictContexts(prepared.context)
  const fixed = preparePlannerFixedConflictConstraints(prepared.context, contexts)
  if (fixed.status !== 'ready') throw new Error('Expected ready constraints.')
  return {
    targets,
    entries,
    contexts,
    constraints: fixed.constraints,
    requirements: prepared.context.checkpointRequirements,
  }
}

describe('shared conflict work derivation', () => {
  it('creates one work per non-fixed participant Target and never for the fixed side', () => {
    const { targets, entries, contexts, constraints, requirements } = threeTargetConflict()
    const works = createPlannerConflictWorks(constraints, contexts, requirements)

    expect(constraints).toHaveLength(1)
    expect(works.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      targets[1].id,
      targets[2].id,
    ])
    // The fixed side never yields, so the fixed Target is never re-searched.
    expect(works.some(({ targetWeaponId }) => targetWeaponId === targets[0].id)).toBe(false)
    works.forEach((work) => {
      expect(work.constraint.fixedBuildListEntryId).toBe(entries[0].id)
      expect(work.originalConflictId).toBe(constraints[0].originalConflictId)
      expect(work.blockedBySelectedCheckpoint).toBe(false)
    })
  })

  it('produces the same works whatever order the contexts and constraints arrive in', () => {
    const { contexts, constraints, requirements } = threeTargetConflict()
    const forward = createPlannerConflictWorks(constraints, contexts, requirements)
    const reversed = createPlannerConflictWorks(
      [...constraints].reverse(),
      [...contexts].reverse().map((context) => ({
        ...context,
        participants: [...context.participants].reverse(),
      })),
      requirements,
    )

    expect(reversed).toEqual(forward)
  })

  it('dedupes several participants of one Target into a single work', () => {
    const { targets, contexts, constraints, requirements } = threeTargetConflict()
    const conflict = contexts.find(({ conflictId }) =>
      conflictId === constraints[0].originalConflictId,
    )
    if (!conflict) throw new Error('The fixed conflict is missing.')
    const duplicated: PlannerConflictContext = {
      ...conflict,
      participants: [...conflict.participants, ...conflict.participants],
    }

    const works = createPlannerConflictWorks(constraints, [duplicated], requirements)

    expect(works.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      targets[1].id,
      targets[2].id,
    ])
  })

  it('blocks a Target Target-wide when the run holds its required checkpoint Entry', () => {
    const { targets, contexts, constraints } = threeTargetConflict()
    // A required checkpoint Entry of the second Target that takes no part in
    // this conflict still blocks that Target's re-search.
    const requirements: PlannerCheckpointRequirements = {
      requiredEntryIdByTargetId: new Map<TargetWeaponId, BuildListEntryId>([
        [targets[1].id, 'entry.work.second.checkpoint' as BuildListEntryId],
      ]),
    }

    const works = createPlannerConflictWorks(constraints, contexts, requirements)

    expect(works.map(({ targetWeaponId, blockedBySelectedCheckpoint }) => ({
      targetWeaponId,
      blockedBySelectedCheckpoint,
    }))).toEqual([
      { targetWeaponId: targets[1].id, blockedBySelectedCheckpoint: true },
      { targetWeaponId: targets[2].id, blockedBySelectedCheckpoint: false },
    ])
  })

  it('creates no work for a constraint whose conflict is not among the contexts', () => {
    const { contexts, constraints, requirements } = threeTargetConflict()
    const works = createPlannerConflictWorks(
      constraints.map((constraint) => ({ ...constraint, originalConflictId: 'plan-conflict:absent' })),
      contexts,
      requirements,
    )
    expect(works).toEqual([])
  })
})
