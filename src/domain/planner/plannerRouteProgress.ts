import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeaponId,
  RouteOperation,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import type {
  PlannerSearchRejection,
  PlannerSearchRoutePosition,
} from './plannerTypes'

export type PlannerCounterStream = 'gogma' | 'skill' | 'normal' | null

export interface PlannerRouteUnit {
  entryId: BuildListEntryId
  operation: RouteOperation
  position: PlannerSearchRoutePosition
  counterStream: PlannerCounterStream
  counterId: string | null
  counterBefore: number | null
  counterAfter: number | null
  physicalActionKey: string
  shareable: boolean
  exclusiveConsumedOwnedWeaponId: OwnedWeaponId | null
}

export interface PlannerRouteUnitPlanResult {
  unitPlans: Map<BuildListEntryId, PlannerRouteUnit[]>
  rejections: PlannerSearchRejection[]
}

function engineAdvance(
  engine: RngEngine,
  operation: RouteOperation,
  current: number,
): number {
  switch (operation.type) {
    case 'create_normal_artian':
      return engine.advanceNormalCounter(current, {
        type: 'create_normal_artian',
        count: 1,
      })
    case 'convert_normal_to_gogma':
      return engine.advanceGogmaCounter(current, {
        type: 'create_gogma_from_normal',
      })
    case 'reset_bonuses':
      return engine.advanceGogmaCounter(current, { type: 'reset_bonuses' })
    case 'keep_bonuses':
      return engine.advanceGogmaCounter(current, {
        type: 'keep_bonuses',
        selection: operation.selection,
      })
    case 'reset_skills':
      return engine.advanceSkillCounter(current, { type: 'reset_skills' })
    case 'use_weapon_as_material':
      return current
  }
}

function ownedWeaponIdForOperation(
  entry: BuildListEntry,
  operation: RouteOperation,
): OwnedWeaponId | null {
  switch (operation.type) {
    case 'reset_bonuses':
    case 'keep_bonuses':
      return operation.sourceOwnedWeaponId
    case 'reset_skills':
      return operation.sourceOwnedWeaponId
    case 'use_weapon_as_material':
      return operation.ownedWeaponId
    case 'convert_normal_to_gogma':
      return entry.candidateSnapshot.route.kind ===
        'owned_normal_artian_to_gogma'
        ? entry.candidateSnapshot.route.sourceOwnedWeaponId
        : null
    case 'create_normal_artian':
      return null
  }
}

function actionIdentity(
  entry: BuildListEntry,
  operation: RouteOperation,
  operationIndex: number,
  unitIndex: number,
): { key: string; shareable: boolean } {
  if (operation.type === 'reset_bonuses') {
    return {
      key: stableStringify({
        type: operation.type,
        sourceOwnedWeaponId: operation.sourceOwnedWeaponId,
        before: operation.gogmaCounterBefore,
        after: operation.gogmaCounterAfter,
      }),
      shareable: true,
    }
  }
  if (operation.type === 'keep_bonuses') {
    return {
      key: stableStringify({
        type: operation.type,
        sourceOwnedWeaponId: operation.sourceOwnedWeaponId,
        selection: operation.selection,
        before: operation.gogmaCounterBefore,
        after: operation.gogmaCounterAfter,
      }),
      shareable: true,
    }
  }
  if (
    operation.type === 'reset_skills' &&
    operation.sourceOwnedWeaponId !== null
  ) {
    return {
      key: stableStringify({
        type: operation.type,
        sourceOwnedWeaponId: operation.sourceOwnedWeaponId,
        before: operation.skillCounterBefore,
        after: operation.skillCounterAfter,
      }),
      shareable: true,
    }
  }
  return {
    key: stableStringify({
      entryId: entry.id,
      operationIndex,
      unitIndex,
      operation,
    }),
    shareable: false,
  }
}

function counterDetails(
  operation: RouteOperation,
): {
  stream: PlannerCounterStream
  counterId: string | null
  before: number | null
  after: number | null
} {
  switch (operation.type) {
    case 'create_normal_artian':
      return {
        stream: 'normal',
        counterId: `${operation.weaponTypeId}:${operation.rarity}`,
        before: operation.normalCounterBefore,
        after: operation.normalCounterAfter,
      }
    case 'convert_normal_to_gogma':
    case 'reset_bonuses':
    case 'keep_bonuses':
      return {
        stream: 'gogma',
        counterId: null,
        before: operation.gogmaCounterBefore,
        after: operation.gogmaCounterAfter,
      }
    case 'reset_skills':
      return {
        stream: 'skill',
        counterId: null,
        before: operation.skillCounterBefore,
        after: operation.skillCounterAfter,
      }
    case 'use_weapon_as_material':
      return { stream: null, counterId: null, before: null, after: null }
  }
}

function exclusiveConsumedWeaponId(
  entry: BuildListEntry,
  operation: RouteOperation,
): OwnedWeaponId | null {
  if (operation.type === 'use_weapon_as_material') {
    return operation.ownedWeaponId
  }
  if (
    operation.type === 'convert_normal_to_gogma' &&
    entry.candidateSnapshot.route.kind === 'owned_normal_artian_to_gogma'
  ) {
    return entry.candidateSnapshot.route.sourceOwnedWeaponId
  }
  return null
}

function rejection(
  entry: BuildListEntry,
  actionType: RouteOperation['type'],
  detail: string,
  reason: PlannerSearchRejection['reason'] = 'rng_contract_unavailable',
): PlannerSearchRejection {
  return {
    buildListEntryId: entry.id,
    actionType,
    reason,
    detail,
  }
}

function createEntryUnitPlan(
  entry: BuildListEntry,
  engine: RngEngine,
): { units: PlannerRouteUnit[] | null; rejection: PlannerSearchRejection | null } {
  const units: PlannerRouteUnit[] = []
  const operations = entry.candidateSnapshot.route.operations
  for (
    let operationIndex = 0;
    operationIndex < operations.length;
    operationIndex += 1
  ) {
    const operation = operations[operationIndex]
    const detail = counterDetails(operation)
    const unitCount =
      operation.type === 'create_normal_artian' ? operation.count : 1
    let current = detail.before
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
      let next = detail.after
      if (detail.stream !== null && current !== null) {
        try {
          next = engineAdvance(engine, operation, current)
        } catch (error) {
          return {
            units: null,
            rejection: rejection(
              entry,
              operation.type,
              error instanceof Error
                ? error.message
                : 'The RNG Engine rejected the saved RouteOperation.',
            ),
          }
        }
      }
      if (
        detail.stream !== null &&
        current !== null &&
        next !== null &&
        next < current
      ) {
        return {
          units: null,
          rejection: rejection(
            entry,
            operation.type,
            `The saved RouteOperation rewinds its counter from ${current} to ${next}.`,
            'counter_after_mismatch',
          ),
        }
      }
      const identity = actionIdentity(
        entry,
        operation,
        operationIndex,
        unitIndex,
      )
      units.push({
        entryId: entry.id,
        operation: structuredClone(operation),
        position: { operationIndex, unitIndex, unitCount },
        counterStream: detail.stream,
        counterId: detail.counterId,
        counterBefore: current,
        counterAfter: next,
        physicalActionKey: identity.key,
        shareable: identity.shareable,
        exclusiveConsumedOwnedWeaponId: exclusiveConsumedWeaponId(
          entry,
          operation,
        ),
      })
      current = next
    }
    if (
      detail.stream !== null &&
      current !== detail.after
    ) {
      return {
        units: null,
        rejection: rejection(
          entry,
          operation.type,
          `RNG Engine advancement ended at ${current}, but the saved operation ends at ${detail.after}.`,
          'counter_after_mismatch',
        ),
      }
    }
  }
  return { units, rejection: null }
}

export function createPlannerRouteUnitPlans(
  entries: readonly BuildListEntry[],
  engine: RngEngine,
): PlannerRouteUnitPlanResult {
  const unitPlans = new Map<BuildListEntryId, PlannerRouteUnit[]>()
  const rejections: PlannerSearchRejection[] = []
  entries.forEach((entry) => {
    const planned = createEntryUnitPlan(entry, engine)
    if (planned.units) unitPlans.set(entry.id, planned.units)
    if (planned.rejection) rejections.push(planned.rejection)
  })
  return { unitPlans, rejections }
}

export function routeUnitOwnedWeaponId(
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): OwnedWeaponId | null {
  return ownedWeaponIdForOperation(entry, unit.operation)
}

export function arePlannerRouteUnitsShareable(
  left: PlannerRouteUnit,
  right: PlannerRouteUnit,
): boolean {
  return (
    left.shareable &&
    right.shareable &&
    left.physicalActionKey === right.physicalActionKey
  )
}
