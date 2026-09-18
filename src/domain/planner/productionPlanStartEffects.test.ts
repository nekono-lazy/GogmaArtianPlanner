import { describe, expect, it } from 'vitest'
import type { BuildListEntry, BuildRoute, OwnedWeaponId, TargetWeapon } from '../models/publicTypes'
import { validateProductionPlan } from '../models/publicTypes'
import { CONSTRAINED_START_GOGMA_COUNTER } from '../../test/fixtures/constrainedEnumeration'
import { orchestrationEntry, orchestrationTarget } from '../../test/fixtures/plannerConstrainedOrchestration'
import { existingGogmaFixture } from '../../test/fixtures/executionRuntime'
import {
  applyProductionPlanStartTargetLinks,
  deriveProductionPlanStartTargetLinks,
  inspectProductionPlanStartTargetLinkChanges,
} from './productionPlanStartEffects'

const X = 'owned.start.x' as OwnedWeaponId
const Y = 'owned.start.y' as OwnedWeaponId

function resetRouteOf(source: OwnedWeaponId): BuildRoute {
  return {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: source,
    operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: source, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 }],
  }
}

function entryFor(id: string, target: TargetWeapon, route: BuildRoute): BuildListEntry {
  return orchestrationEntry(id, target, route)
}

describe('deriveProductionPlanStartTargetLinks', () => {
  const a = orchestrationTarget('target.start.a')
  const b = orchestrationTarget('target.start.b')

  it('links the Target of each selected Entry that operates on an existing weapon', () => {
    const entryA = entryFor('entry.start.a', a, resetRouteOf(X))
    const entryB = entryFor('entry.start.b', b, resetRouteOf(Y))
    expect(deriveProductionPlanStartTargetLinks([entryB.id, entryA.id], [entryA, entryB])).toEqual([
      { buildListEntryId: entryA.id, targetWeaponId: a.id, ownedWeaponId: X },
      { buildListEntryId: entryB.id, targetWeaponId: b.id, ownedWeaponId: Y },
    ])
  })

  it('ignores an unselected Entry, a missing Entry, a new-Normal Route and a zero-operation Entry', () => {
    const unselected = entryFor('entry.start.unselected', a, resetRouteOf(X))
    const newNormal = entryFor('entry.start.new', a, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [{ type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a', rarity: 8, count: 1, normalCounterBefore: null, normalCounterAfter: null }],
    })
    const zero = entryFor('entry.start.zero', b, { kind: 'existing_gogma_current', sourceOwnedWeaponId: Y, operations: [] })
    expect(deriveProductionPlanStartTargetLinks(
      [newNormal.id, zero.id, 'entry.start.missing' as BuildListEntry['id']],
      [unselected, newNormal, zero],
    )).toEqual([])
  })

  it('links nothing for a weapon several selected Entries start from, instead of picking one', () => {
    const entryA = entryFor('entry.start.shared.a', a, resetRouteOf(X))
    const entryB = entryFor('entry.start.shared.b', b, resetRouteOf(X))
    expect(deriveProductionPlanStartTargetLinks([entryA.id, entryB.id], [entryA, entryB])).toEqual([])
    // Order never decides it.
    expect(deriveProductionPlanStartTargetLinks([entryB.id, entryA.id], [entryB, entryA])).toEqual([])
  })

  it('links nothing for a Target two selected Entries would link to different weapons', () => {
    const first = entryFor('entry.start.twice.1', a, resetRouteOf(X))
    const second = entryFor('entry.start.twice.2', a, resetRouteOf(Y))
    expect(deriveProductionPlanStartTargetLinks([first.id, second.id], [first, second])).toEqual([])
  })
})

describe('applyProductionPlanStartTargetLinks / inspectProductionPlanStartTargetLinkChanges', () => {
  const link = { buildListEntryId: 'entry.start.b' as BuildListEntry['id'], targetWeaponId: 'target.start.b' as TargetWeapon['id'], ownedWeaponId: X }

  it('moves the weapon to its Target and releases the previous holder, changing nothing else', () => {
    const a = orchestrationTarget('target.start.a', { preferredOwnedWeaponId: X })
    const b = orchestrationTarget('target.start.b', { preferredOwnedWeaponId: Y })
    const c = orchestrationTarget('target.start.c')
    const next = applyProductionPlanStartTargetLinks([a, b, c], [link])
    expect(next).toEqual([{ ...a, preferredOwnedWeaponId: null }, { ...b, preferredOwnedWeaponId: X }, c])
    // Pure: the input Targets are untouched.
    expect(a.preferredOwnedWeaponId).toBe(X)
    expect(inspectProductionPlanStartTargetLinkChanges([a, b, c], [link])).toEqual([{
      ...link,
      fromTargetWeaponId: a.id,
      replacedOwnedWeaponId: Y,
    }])
  })

  it('reports no change for a link that already holds', () => {
    const b = orchestrationTarget('target.start.b', { preferredOwnedWeaponId: X })
    expect(applyProductionPlanStartTargetLinks([b], [link])).toEqual([b])
    expect(inspectProductionPlanStartTargetLinkChanges([b], [link])).toEqual([])
  })
})

describe('Plan start effect validation', () => {
  it('accepts a calculation 13 first Step that differs from the premise by the start links only', async () => {
    const { plan } = await existingGogmaFixture()
    expect(plan.steps[0].expectedStateBefore.targetExecutionStateHash)
      .not.toBe(plan.baseSnapshot.initialExecutionState.targetExecutionStateHash)
    expect(validateProductionPlan(plan).issues).toEqual([])

    const moved = structuredClone(plan)
    moved.steps[0].expectedStateBefore.rngStateHash = 'hash.moved'
    expect(validateProductionPlan(moved).issues.map(({ path }) => path)).toContain('steps[0].expectedStateBefore')
  })

  it('keeps a calculation 12 Plan to the strict premise equality', async () => {
    const { plan } = await existingGogmaFixture()
    const legacy = structuredClone(plan)
    legacy.calculationContext.appSchemaVersion = 12
    legacy.baseSnapshot.calculationContext.appSchemaVersion = 12
    expect(validateProductionPlan(legacy).issues.map(({ path }) => path)).toContain('steps[0].expectedStateBefore')
  })
})
