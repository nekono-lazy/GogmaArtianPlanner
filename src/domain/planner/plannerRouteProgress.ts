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
  PlannerSearchState,
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
  /**
   * Planner-internal only: another Entry's real operation may pass this unit's
   * shared Counter position without executing it, because the immediately
   * following Route unit rewrites this unit's whole semantic output without
   * reading it (`docs/PLANNER_SPEC.md` 7.0.2).
   *
   * It is never persisted: no `RouteOperation`, `BuildRoute`, `BuildCandidate`,
   * `ProductionPlan`, or DB field carries it, and it is derived here from the
   * saved Route semantics alone.
   */
  canSkipWhenCounterPassed: boolean
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
      return engine.advanceSkillCounter(current, { type: 'convert_normal_to_gogma' })
    case 'reset_bonuses':
      return engine.advanceGogmaCounter(current, { type: 'reset_bonuses' })
    case 'keep_bonuses':
      return engine.advanceGogmaCounter(current, { type: 'keep_bonuses' })
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

export function createPlannerPhysicalActionIdentity(
  entry: BuildListEntry,
  operation: RouteOperation,
  operationIndex: number,
  unitIndex: number,
): { key: string; shareable: boolean } {
  if (operation.type === 'reset_bonuses') {
    const physicalSubject =
      operation.sourceOwnedWeaponId === null
        ? { type: 'entry_transient_gogma', buildListEntryId: entry.id }
        : { type: 'owned_weapon', ownedWeaponId: operation.sourceOwnedWeaponId }
    return {
      key: stableStringify({
        type: operation.type,
        physicalSubject,
        before: operation.gogmaCounterBefore,
        after: operation.gogmaCounterAfter,
      }),
      shareable: operation.sourceOwnedWeaponId !== null,
    }
  }
  if (operation.type === 'keep_bonuses') {
    const physicalSubject =
      operation.sourceOwnedWeaponId === null
        ? { type: 'entry_transient_gogma', buildListEntryId: entry.id }
        : { type: 'owned_weapon', ownedWeaponId: operation.sourceOwnedWeaponId }
    return {
      key: stableStringify({
        type: operation.type,
        physicalSubject,
        before: operation.gogmaCounterBefore,
        after: operation.gogmaCounterAfter,
      }),
      shareable: operation.sourceOwnedWeaponId !== null,
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

/**
 * Whether another Entry's real operation passing this unit's shared Counter
 * position lets the Planner treat the unit as already passed.
 *
 * The condition is deliberately narrow: the immediately following Route
 * operation must rewrite this operation's entire semantic output without
 * reading it, so neither the later Route result nor any displayed expected
 * result changes when the unit is skipped.
 *
 * - `reset_bonuses` draws all five slots from the Gogma stream position alone,
 *   so any bonus operation directly followed by `reset_bonuses` is unobserved
 * - `keep_bonuses` reads only the current slot families and preserves them, so
 *   a Keep directly followed by another Keep leaves that next Keep's families,
 *   and therefore its result, unchanged (`docs/RNG_SPEC.md` 5.3)
 * - a Reset directly followed by a Keep is required, because the Keep reads the
 *   Reset's families
 * - `reset_skills` writes only the Series / Group Skill pair and predicts it
 *   from the Skill stream position alone, so a Reset Skills directly followed
 *   by another Reset Skills is unobserved
 *
 * Every other operation is never skippable. `create_normal_artian`,
 * `convert_normal_to_gogma`, and `use_weapon_as_material` carry physical or
 * inventory side effects, and a route's final operation forms the Candidate
 * result itself.
 */
function canSkipWhenCounterPassed(
  operations: readonly RouteOperation[],
  operationIndex: number,
  unitIndex: number,
  unitCount: number,
): boolean {
  if (unitIndex !== unitCount - 1) return false
  const operation = operations[operationIndex]
  const next = operations[operationIndex + 1]
  if (next === undefined) return false
  if (operation.type === 'reset_skills') {
    return (
      next.type === 'reset_skills' &&
      operation.sourceOwnedWeaponId === next.sourceOwnedWeaponId
    )
  }
  if (operation.type !== 'reset_bonuses' && operation.type !== 'keep_bonuses') {
    return false
  }
  if (next.type === 'reset_bonuses') {
    return operation.sourceOwnedWeaponId === next.sourceOwnedWeaponId
  }
  return (
    next.type === 'keep_bonuses' &&
    operation.type === 'keep_bonuses' &&
    operation.sourceOwnedWeaponId === next.sourceOwnedWeaponId
  )
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
      return { stream: 'skill', counterId: null, before: operation.skillCounterBefore, after: operation.skillCounterAfter }
    case 'reset_bonuses':
    case 'keep_bonuses':
      return { stream: 'gogma', counterId: null, before: operation.gogmaCounterBefore, after: operation.gogmaCounterAfter }
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
  if (
    operation.type === 'reset_bonuses' ||
    operation.type === 'keep_bonuses'
  ) {
    return operation.sourceOwnedWeaponId
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
      const identity = createPlannerPhysicalActionIdentity(
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
        canSkipWhenCounterPassed: canSkipWhenCounterPassed(
          operations,
          operationIndex,
          unitIndex,
          unitCount,
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

/** The shared Counter value a unit's precondition is compared against. */
export function currentPlannerCounterValue(
  state: PlannerSearchState,
  unit: PlannerRouteUnit,
): number | null {
  if (unit.counterStream === 'gogma') {
    return state.currentRngState.gogmaCounter.value
  }
  if (unit.counterStream === 'skill') {
    return state.currentRngState.skillCounter.value
  }
  if (unit.counterStream === 'normal') {
    return (
      state.currentNormalCounters.find(({ id }) => id === unit.counterId)
        ?.counter ?? null
    )
  }
  return null
}

/**
 * Advances Route progress past units whose shared Counter position a different
 * Entry's real operation already passed.
 *
 * This is Counter stream progression, not physical action sharing: no
 * PlannerSearchAction is created, nothing is added to the trace,
 * `progressedBuildListEntryIds` / `progressedTargetWeaponIds`, the inventory,
 * the route runtime output, or any source mutation version
 * (`docs/PLANNER_SPEC.md` 7.0.2). A unit that is not
 * `canSkipWhenCounterPassed` is never passed here, so a past required unit
 * still fails closed in the ordinary counter precondition.
 */
export function fastForwardPlannerRouteProgress(
  state: PlannerSearchState,
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
): void {
  unitPlans.forEach((units, entryId) => {
    const started = state.routeProgressByEntryId[entryId]
    if (started === undefined) return
    let progress = started
    while (progress < units.length) {
      const unit = units[progress]
      if (!unit.canSkipWhenCounterPassed || unit.counterBefore === null) break
      const current = currentPlannerCounterValue(state, unit)
      if (current === null || current <= unit.counterBefore) break
      progress += 1
    }
    if (progress !== started) state.routeProgressByEntryId[entryId] = progress
  })
}
