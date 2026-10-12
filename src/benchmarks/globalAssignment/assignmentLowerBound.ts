/**
 * Issue #154 Global Assignment Phase B-1 (Research only; never imported by the app).
 *
 * The admissible lower bound of a partial assignment (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 10.1):
 *
 *   LB(partial) = Σ_streams ( max(currentEnd_stream, floor_stream(unassigned)) − origin_stream )
 *   floor_stream(unassigned) = max over unassigned Targets t of minStreamEnd_stream(t, partial)
 *
 * `minStreamEnd` is a safe relaxation of "the minimum stream end over the resource-feasible options of
 * t": per stream it reads the Target's ascending position arrays from the ReachTable and takes the first
 * required candidate position the partial assignment has not used, through an unused source, ignoring
 * the other streams of the same option, the Reset position a `reset_then_keep` also needs, the window
 * limit distinctions beyond those the source kind already fixes, and whether the option exists on the
 * other axes. Every relaxation can only lower the value, so no completion of the partial assignment has
 * a smaller objective. `+Infinity` means an unassigned Target has no resource-feasible option on that
 * stream at all - then no completion exists and any bound is admissible.
 *
 * The option product is never materialized here. This module reads the partial assignment's resources
 * only; it never enumerates options, never calls the feasibility filter and never cuts a branch itself
 * (review R1: `resourceFeasibleOptions -> LB -> pruning`, one direction). It is not the root lower bound
 * of the Phase 2-A.5 relaxation module (design 10.2), which Phase B-1 does not integrate.
 */
import type { PartialResourceAssignment } from './assignmentTypes'
import { bonusRequirementIsNone, enumerateResetThenKeepRequirements, keepFromSourcePositions, skillRequirementBlocks, sourceResourceKey } from './reachOptions'
import type { NormalArtianCounterId, ReachTable, SourceCandidate, TargetReach } from './types'

export interface TargetStreamMenuSource {
  source: SourceCandidate
  key: string
  /** Ascending final Skill positions this source can end at; `null` when its only Skill requirement is `none`. */
  skillFinals: readonly number[] | null
  /** Ascending `keep_from_source` final positions (empty when Keep is unsupported for its layout). */
  keepFinals: readonly number[]
  /** Whether its only Bonus requirement is `none`. */
  bonusNone: boolean
}

/** The per-stream position menus of one Target the lower bound reads (design 6.4 `minStreamEnd`). */
export interface TargetStreamMenu {
  target: TargetReach
  sources: readonly TargetStreamMenuSource[]
  /** Ascending `reset` final positions (Target-level). */
  resetFinals: readonly number[]
  /** Ascending `reset_then_keep` final positions (Target-level, the Reset position relaxed away). */
  resetThenKeepFinals: readonly number[]
}

export function createTargetStreamMenu(target: TargetReach, table: ReachTable): TargetStreamMenu {
  // The conversion finals are the same array for every Normal source, so `firstUnused` memoizes across them.
  let conversionFinals: readonly number[] | null = null
  const sources = target.sources.map((source): TargetStreamMenuSource => {
    const blocks = skillRequirementBlocks(target, source, table.originSkill)
    let skillFinals: readonly number[] | null
    if (blocks.kind === 'none') skillFinals = null
    else if (blocks.kind === 'reset_skills') skillFinals = blocks.finalPositions
    else skillFinals = conversionFinals ??= blocks.finalPositions
    return { source, key: sourceResourceKey(source), skillFinals, keepFinals: keepFromSourcePositions(target, source), bonusNone: bonusRequirementIsNone(source) }
  })
  // The finals that at least one earlier Reset really reaches (the generator's own set, ascending), not every Keep-Ideal position of a Reset layout.
  const resetThenKeepFinals = [...new Set([...enumerateResetThenKeepRequirements(target)].map(requirement => requirement.finalPosition))]
  return { target, sources, resetFinals: target.bonus.resetIdealPositions, resetThenKeepFinals }
}

/** Menus in the table's Target order. */
export function createTargetStreamMenus(table: ReachTable): Map<TargetReach['targetWeaponId'], TargetStreamMenu> {
  return new Map(table.targets.map(target => [target.targetWeaponId, createTargetStreamMenu(target, table)]))
}

export interface MinimalStreamEnds {
  skill: number
  gogma: number
  /** The Target's Normal Counter and its minimal end, or null for a Target without a Normal Counter. */
  normal: { counterId: NormalArtianCounterId; end: number } | null
}

/** The first position of an ascending array not in `used`, or null. */
function firstUnused(positions: readonly number[], used: ReadonlySet<number>): number | null {
  for (const position of positions) if (!used.has(position)) return position
  return null
}

/** The relaxed minimal stream ends of one unassigned Target under `partial` (design 10.1 `minStreamEnd`); `+Infinity` where no option can end. */
export function minimalStreamEnds(menu: TargetStreamMenu, partial: PartialResourceAssignment, table: ReachTable): MinimalStreamEnds {
  let skill = Number.POSITIVE_INFINITY
  let gogma = Number.POSITIVE_INFINITY
  let normal = Number.POSITIVE_INFINITY
  const firstUnusedMemo = new Map<readonly number[], number | null>()
  const first = (positions: readonly number[], used: ReadonlySet<number>): number | null => {
    const memo = firstUnusedMemo.get(positions)
    if (memo !== undefined) return memo
    const value = firstUnused(positions, used)
    firstUnusedMemo.set(positions, value)
    return value
  }
  const counterId = menu.target.normalCounterId
  const usedNormal = counterId === null ? null : partial.usedNormalPositions.get(counterId) ?? null
  for (const entry of menu.sources) {
    if (partial.usedSources.has(entry.key)) continue
    if (entry.skillFinals === null) skill = Math.min(skill, table.originSkill)
    else {
      const position = first(entry.skillFinals, partial.usedSkillPositions)
      if (position !== null) skill = Math.min(skill, position + 1)
    }
    if (entry.bonusNone) gogma = Math.min(gogma, table.originGogma)
    else {
      for (const finals of [menu.resetFinals, entry.keepFinals, menu.resetThenKeepFinals]) {
        const position = first(finals, partial.usedGogmaPositions)
        if (position !== null) gogma = Math.min(gogma, position + 1)
      }
    }
    if (counterId !== null) {
      if (entry.source.kind === 'new_normal') {
        if (!(usedNormal?.has(entry.source.position) ?? false)) normal = Math.min(normal, entry.source.position + 1)
      } else {
        normal = Math.min(normal, table.originNormal[counterId]!)
      }
    }
  }
  return { skill, gogma, normal: counterId === null ? null : { counterId, end: normal } }
}

/**
 * `LB(partial)` over the given unassigned Targets (design 10.1). `+Infinity` when some unassigned Target
 * has no resource-feasible option on some stream (no completion exists). Never calls the option
 * enumeration, the feasibility filter or any pruning.
 */
export function partialAssignmentLowerBound(partial: PartialResourceAssignment, unassigned: readonly TargetStreamMenu[], table: ReachTable): number {
  let floorSkill = table.originSkill
  let floorGogma = table.originGogma
  const floorNormal: Record<NormalArtianCounterId, number> = { ...table.originNormal }
  for (const menu of unassigned) {
    const ends = minimalStreamEnds(menu, partial, table)
    if (!Number.isFinite(ends.skill) || !Number.isFinite(ends.gogma) || (ends.normal !== null && !Number.isFinite(ends.normal.end))) return Number.POSITIVE_INFINITY
    floorSkill = Math.max(floorSkill, ends.skill)
    floorGogma = Math.max(floorGogma, ends.gogma)
    if (ends.normal !== null) floorNormal[ends.normal.counterId] = Math.max(floorNormal[ends.normal.counterId]!, ends.normal.end)
  }
  let bound = (Math.max(partial.streamEnd.skill, floorSkill) - table.originSkill) + (Math.max(partial.streamEnd.gogma, floorGogma) - table.originGogma)
  for (const [counterId, origin] of Object.entries(table.originNormal)) {
    bound += Math.max(partial.streamEnd.normal[counterId] ?? origin, floorNormal[counterId]!) - origin
  }
  return bound
}
