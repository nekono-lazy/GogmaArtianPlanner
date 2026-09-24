import { describe, expect, it } from 'vitest'
import type { BuildListEntry, ProductionPlan } from '../models/publicTypes'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidProductionPlan,
} from '../../test/fixtures/domainData'
import { completedPlannerTermination } from '../../test/fixtures/plannerTermination'
import type { BuildListEntryReplacement } from '../buildList'
import {
  checkBuildListEntryReplacementsCurrent,
  checkPersistablePlannerResultShape,
  checkProductionPlanBuildListReferences,
  prepareFinalReplacementBuildList,
} from './plannerResultPersistenceValidation'

/**
 * The shared save-time checks of a Planner result that replaces persisted
 * Entries (`docs/PLANNER_SPEC.md` 9.2.15 / 9.2.18), used by the ordinary Draft
 * save and the replan adoption alike.
 */
function entry(id: string, targetWeaponId: string): BuildListEntry {
  const base = createValidBuildListEntry()
  return {
    ...base,
    id: buildListEntryId(id),
    targetWeaponId: targetWeaponId as BuildListEntry['targetWeaponId'],
    candidateSnapshot: { ...base.candidateSnapshot, targetWeaponId: targetWeaponId as BuildListEntry['targetWeaponId'] },
  }
}

const O = entry('build-list.o', 'target.b')
const G = entry('build-list.g', 'target.b')
const A = entry('build-list.a', 'target.a')
const REPLACEMENT: BuildListEntryReplacement = {
  targetWeaponId: O.targetWeaponId,
  replacedBuildListEntryId: O.id,
  generatedBuildListEntryId: G.id,
}

/** A draft Plan over the final replacement set: A and G. */
function planOver(entries: readonly BuildListEntry[]): ProductionPlan {
  const base = createValidProductionPlan()
  const steps = entries.map((selected, index) => ({
    ...base.steps[0],
    id: `step.validation.${index}` as ProductionPlan['steps'][number]['id'],
    order: index + 1,
    targetWeaponId: selected.targetWeaponId,
    buildListEntryId: selected.id,
    candidateId: selected.candidateSnapshot.id,
  }))
  return {
    ...base,
    status: 'draft',
    selectedBuildListEntryIds: entries.map(({ id }) => id),
    steps,
    currentStepId: steps[0].id,
    conflicts: [],
    rejectedBuildListEntries: [],
  }
}

describe('prepareFinalReplacementBuildList', () => {
  it('removes the replaced Entry and adds the generated one', () => {
    const result = prepareFinalReplacementBuildList([A, O], [G], [REPLACEMENT])
    expect(result.issue).toBeNull()
    expect(result.finalEntries?.map(({ id }) => id)).toEqual([A.id, G.id])
  })

  it('refuses a state change when the Target no longer holds exactly the replaced Entry', () => {
    const b3 = entry('build-list.b3', 'target.b')
    for (const persisted of [[A], [A, b3], [A, O, b3]]) {
      expect(prepareFinalReplacementBuildList(persisted, [G], [REPLACEMENT]).issue)
        .toMatchObject({ kind: 'state_changed' })
    }
    expect(checkBuildListEntryReplacementsCurrent([REPLACEMENT], [A, b3]))
      .toMatchObject({ kind: 'state_changed', message: expect.stringContaining('[build-list.b3]') })
  })

  it('refuses a generated ID that is already persisted, never overwriting it', () => {
    expect(prepareFinalReplacementBuildList([A, O, G], [G], [REPLACEMENT]).issue)
      .toMatchObject({ kind: 'state_changed', message: expect.stringContaining('already exists') })
  })
})

describe('checkProductionPlanBuildListReferences over the final replacement set', () => {
  const finalEntries = [A, G]

  it('accepts a Plan over the replacement set', () => {
    expect(checkProductionPlanBuildListReferences(planOver(finalEntries), [G], finalEntries)).toBeNull()
  })

  it('refuses a Plan still naming the replaced Entry anywhere', () => {
    const plan = planOver(finalEntries)
    const variants: ProductionPlan[] = [
      { ...plan, selectedBuildListEntryIds: [...plan.selectedBuildListEntryIds, O.id] },
      { ...plan, steps: plan.steps.map((step, index) => (index === 1 ? { ...step, buildListEntryId: O.id, candidateId: O.candidateSnapshot.id } : step)) },
      {
        ...plan,
        conflicts: [{
          id: 'plan-conflict:validation',
          kind: 'same_gogma_counter',
          buildListEntryIds: [A.id, O.id],
          reason: 'fixture',
          recommendedBuildListEntryId: null,
          selectedBuildListEntryId: A.id,
          resolutionNote: null,
          checkpointParticipants: [],
        }],
      },
      {
        ...plan,
        rejectedBuildListEntries: [{
          buildListEntryId: O.id,
          reason: 'resource_conflict',
          detail: 'fixture',
        }],
      },
    ]
    variants.forEach((variant) => {
      expect(checkProductionPlanBuildListReferences(variant, [G], finalEntries))
        .toMatchObject({ kind: 'result_invalid', message: expect.stringContaining(O.id) })
    })
  })
})

describe('checkPersistablePlannerResultShape replacement pairing', () => {
  it('accepts one replacement per generated Entry and refuses malformed metadata', () => {
    const plan = planOver([A, G])
    const termination = completedPlannerTermination()
    expect(checkPersistablePlannerResultShape(plan, [G], termination, [REPLACEMENT])).toBeNull()
    for (const replacements of [
      undefined,
      [],
      [{ ...REPLACEMENT, targetWeaponId: A.targetWeaponId }],
      [REPLACEMENT, { ...REPLACEMENT, replacedBuildListEntryId: A.id }],
    ]) {
      expect(checkPersistablePlannerResultShape(plan, [G], termination, replacements))
        .toMatchObject({ kind: 'result_invalid' })
    }
  })
})
