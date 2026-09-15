import type { ImprovementPreference, RouteOperation } from '../models/publicTypes'
import type { IntermediatePin } from './plannerCheckpoints'
import type { PlannerRouteUnit } from './plannerRouteProgress'

/**
 * The three execution lanes of one Route (`docs/PLANNER_SPEC.md` 7.0.4).
 *
 * `base` is the creation / conversion prefix and runs strictly first. `bonus`
 * (Reset / Keep Bonuses) and `skill` (Reset Skills) are the two independent
 * RNG streams: each keeps its own Route order, but the Planner interleaves the
 * two freely, because a Bonus amendment reads nothing a Skill amendment writes
 * and vice versa (`docs/SEARCH_SPEC.md` 5.4).
 */
export type PlannerRouteLane = 'base' | 'bonus' | 'skill'

export function routeOperationLane(operation: RouteOperation): PlannerRouteLane {
  switch (operation.type) {
    case 'create_normal_artian':
    case 'convert_normal_to_gogma':
      return 'base'
    case 'reset_bonuses':
    case 'keep_bonuses':
      return 'bonus'
    case 'reset_skills':
      return 'skill'
  }
}

/** Units executed (or silently passed) per lane; Planner runtime state only. */
export interface PlannerLaneProgress {
  base: number
  bonus: number
  skill: number
}

export function initialPlannerLaneProgress(): PlannerLaneProgress {
  return { base: 0, bonus: 0, skill: 0 }
}

export function totalPlannerLaneProgress(progress: PlannerLaneProgress): number {
  return progress.base + progress.bonus + progress.skill
}

/** One Entry's Route units split by lane, plus its compromise checkpoint pin. */
export interface PlannerEntryLanes {
  base: readonly PlannerRouteUnit[]
  bonus: readonly PlannerRouteUnit[]
  skill: readonly PlannerRouteUnit[]
  unitCount: number
  /** `null` means the Entry selected no intermediate state and has no checkpoint. */
  pin: IntermediatePin | null
}

export function splitPlannerRouteUnitsByLane(
  units: readonly PlannerRouteUnit[],
  pin: IntermediatePin | null,
): PlannerEntryLanes {
  return {
    base: units.filter(({ lane }) => lane === 'base'),
    bonus: units.filter(({ lane }) => lane === 'bonus'),
    skill: units.filter(({ lane }) => lane === 'skill'),
    unitCount: units.length,
    pin,
  }
}

export function isPlannerLaneRouteComplete(
  lanes: PlannerEntryLanes,
  progress: PlannerLaneProgress,
): boolean {
  return (
    progress.base >= lanes.base.length &&
    progress.bonus >= lanes.bonus.length &&
    progress.skill >= lanes.skill.length
  )
}

/**
 * Whether running this lane unit now would move its lane past the Entry's
 * pinned checkpoint position before the other lane reached its own pin.
 *
 * The compromise checkpoint is the moment both lanes hold their pinned state
 * at once (`docs/PLANNER_SPEC.md` 7.5.2). A lane may therefore not advance
 * beyond its pin until the other lane has arrived, and a fast-forward may not
 * pass it either. Base units are never gated, and an Entry with no selection
 * has no pin.
 */
export function isPlannerLaneUnitBlockedByPin(
  unit: PlannerRouteUnit,
  progress: PlannerLaneProgress,
  pin: IntermediatePin | null,
): boolean {
  if (pin === null || unit.lane === 'base') return false
  const other = unit.lane === 'bonus' ? 'skill' : 'bonus'
  return unit.laneIndex + 1 > pin[unit.lane] && progress[other] < pin[other]
}

/** Whether both lanes hold their pinned state (`false` without a pin). */
export function hasReachedIntermediatePin(
  progress: PlannerLaneProgress,
  pin: IntermediatePin | null,
): boolean {
  return pin !== null && progress.skill >= pin.skill && progress.bonus >= pin.bonus
}

/**
 * The units this Entry may execute next, in the order the Beam Search tries
 * them: the next base unit while the base lane is unfinished, otherwise the
 * next unit of each stream lane that the checkpoint pin allows.
 *
 * The preferred lane comes first - the Skill lane for `skill_first`, the
 * Bonus lane otherwise, which is also the order the Search composed the
 * Route in (`docs/PLANNER_SPEC.md` 7.0.4 / 7.6). The Beam Search expands the
 * first lane that can run in the state and falls back to the other lane only
 * when it cannot, so a Route's two lanes never multiply the beam by every
 * interleaving while the other lane still runs whenever the preferred one is
 * waiting on a Counter, a pin, a conflict resolution, or a required unit.
 */
export function nextPlannerLaneUnits(
  lanes: PlannerEntryLanes,
  progress: PlannerLaneProgress,
  preference: ImprovementPreference = 'planner',
): PlannerRouteUnit[] {
  if (progress.base < lanes.base.length) return [lanes.base[progress.base]]
  const order = preference === 'skill_first' ? (['skill', 'bonus'] as const) : (['bonus', 'skill'] as const)
  const next: PlannerRouteUnit[] = []
  for (const lane of order) {
    const unit = lanes[lane][progress[lane]]
    if (unit && !isPlannerLaneUnitBlockedByPin(unit, progress, lanes.pin)) next.push(unit)
  }
  return next
}

/** Every unit not yet executed or passed, in lane order: base, bonus, skill. */
export function remainingPlannerLaneUnits(
  lanes: PlannerEntryLanes,
  progress: PlannerLaneProgress,
): PlannerRouteUnit[] {
  return [
    ...lanes.base.slice(progress.base),
    ...lanes.bonus.slice(progress.bonus),
    ...lanes.skill.slice(progress.skill),
  ]
}

export function advancePlannerLaneProgress(
  progress: PlannerLaneProgress,
  unit: PlannerRouteUnit,
): PlannerLaneProgress {
  return { ...progress, [unit.lane]: progress[unit.lane] + 1 }
}
