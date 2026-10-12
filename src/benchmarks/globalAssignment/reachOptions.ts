/**
 * Issue #154 Global Assignment Phase A (Research only; never imported by the app).
 *
 * Lazy, deterministic enumeration of the reach options of one planning Target from its ReachTable row
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.3 / 5.2 / 5.4). An option is a necessary condition
 * (source + required positions per stream), never a Route and never a coexistence proof. The
 * generator never materializes the `source x Skill x Bonus` product: Phase B pulls options one at a
 * time (`countUpTo(k)` for MRV, value ordering, resume), and the order is a pure function of the table.
 *
 * Order (design 5.4): sources as listed (owned by OwnedWeapon ID, then `new_normal` by position);
 * per source, Skill requirements outer, Bonus requirements inner.
 *   Skill, owned Gogma:  `none` when the current Skills are Ideal, else `reset_skills` by `s*` asc
 *                         (`s* <= resetSkillsLimit`).
 *   Skill, Normal:       `conversion (c, s*)` by `s*` asc (`s* <= conversionLimit`); for one `s*` first
 *                         `c = s*`, then `c = s* - 1, ..., originSkill` (the closest conversion first).
 *   Bonus, owned Gogma already Ideal in `gogma_artian` scope: `none`.
 *   Bonus, otherwise:    `reset` by `g*` asc, then `keep_from_source` by `g*` asc (only when the
 *                         source's layout is Keep-supported), then `reset_then_keep` by `(g*, g1)` asc
 *                         with `g1 < g*` and `layout(Reset(g1))` Keep-Ideal at `g*`.
 * Chains between required positions (Reset -> Reset, Keep -> Keep, Reset Skills -> Reset Skills) are
 * skippable units and are not part of an option (design 5.2); Counter coverage decides them later.
 */
import type { BonusRequirement, ReachOption, ReachTable, SkillRequirement, SourceCandidate, StreamEnd, TargetReach } from './types'

function* skillRequirements(target: TargetReach, source: SourceCandidate, originSkill: number): Generator<SkillRequirement, void, undefined> {
  if (source.kind === 'owned_gogma') {
    if (source.currentSkillIdeal) { yield { kind: 'none' }; return }
    for (const position of target.skill.idealPositions) {
      if (position > target.skill.resetSkillsLimit) break
      yield { kind: 'reset_skills', finalPosition: position }
    }
    return
  }
  for (const finalPosition of target.skill.idealPositions) {
    if (finalPosition > target.skill.conversionLimit) break
    for (let conversionPosition = finalPosition; conversionPosition >= originSkill; conversionPosition--) {
      yield { kind: 'conversion', conversionPosition, finalPosition }
    }
  }
}

/** Keep-Ideal positions reachable through a Reset layout, ascending and unique, with the Reset positions that produce each layout. */
function resetThenKeepPlan(target: TargetReach): { finalPositions: number[]; resetPositionsByLayout: Map<string, number[]> } {
  const resetPositionsByLayout = new Map<string, number[]>()
  const unsupported = new Set(target.bonus.keepUnsupportedLayouts)
  for (const [position, layout] of target.bonus.resetLayoutByPosition) {
    if (!target.bonus.keepIdealPositionsByLayout.has(layout) || unsupported.has(layout)) continue
    const positions = resetPositionsByLayout.get(layout)
    if (positions) positions.push(position)
    else resetPositionsByLayout.set(layout, [position])
  }
  const finalPositions = new Set<number>()
  for (const layout of resetPositionsByLayout.keys()) {
    for (const position of target.bonus.keepIdealPositionsByLayout.get(layout) ?? []) finalPositions.add(position)
  }
  return { finalPositions: [...finalPositions].sort((left, right) => left - right), resetPositionsByLayout }
}

function* bonusRequirements(target: TargetReach, source: SourceCandidate): Generator<BonusRequirement, void, undefined> {
  if (source.kind === 'owned_gogma' && source.currentBonusIdeal) { yield { kind: 'none' }; return }
  for (const finalPosition of target.bonus.resetIdealPositions) yield { kind: 'reset', finalPosition }
  if (source.keepSupported) {
    for (const finalPosition of target.bonus.keepIdealPositionsByLayout.get(source.layout) ?? []) yield { kind: 'keep_from_source', finalPosition }
  }
  const plan = resetThenKeepPlan(target)
  for (const finalPosition of plan.finalPositions) {
    // g1 ascending over every Reset position whose layout is Keep-Ideal at g*, and strictly before g*.
    const candidates: number[] = []
    for (const [layout, resetPositions] of plan.resetPositionsByLayout) {
      if (!(target.bonus.keepIdealPositionsByLayout.get(layout) ?? []).includes(finalPosition)) continue
      for (const resetPosition of resetPositions) {
        if (resetPosition >= finalPosition) break
        candidates.push(resetPosition)
      }
    }
    for (const resetPosition of candidates.sort((left, right) => left - right)) yield { kind: 'reset_then_keep', resetPosition, finalPosition }
  }
}

export function reachOptionStreamEnd(target: TargetReach, table: ReachTable, source: SourceCandidate, skill: SkillRequirement, bonus: BonusRequirement): StreamEnd {
  const normal: StreamEnd['normal'] = {}
  if (target.normalCounterId !== null) {
    normal[target.normalCounterId] = source.kind === 'new_normal' ? source.position + 1 : table.originNormal[target.normalCounterId]!
  }
  return {
    skill: skill.kind === 'none' ? table.originSkill : skill.finalPosition + 1,
    gogma: bonus.kind === 'none' ? table.originGogma : bonus.finalPosition + 1,
    normal,
  }
}

/** Σ (streamEnd − origin): the physical operation count the option would need if it came true (design 6.1). */
export function reachOptionObjective(option: ReachOption, table: ReachTable): number {
  let total = (option.streamEnd.skill - table.originSkill) + (option.streamEnd.gogma - table.originGogma)
  for (const [counterId, end] of Object.entries(option.streamEnd.normal)) total += end - table.originNormal[counterId]!
  return total
}

/** A stable identity of the source alone (design 6.1 C1): one OwnedWeapon, or one forge position of one Normal Counter. */
export function sourceResourceKey(source: SourceCandidate): string {
  return source.kind === 'new_normal' ? `normal:${source.counterId}:${source.position}` : `owned:${source.ownedWeaponId}`
}

/** A stable identity of the whole option, independent of enumeration order, Clock or run. */
export function reachOptionKey(option: ReachOption): string {
  const skill = option.skillRequired.kind === 'none' ? 'none'
    : option.skillRequired.kind === 'reset_skills' ? `reset_skills:${option.skillRequired.finalPosition}`
      : `conversion:${option.skillRequired.conversionPosition}:${option.skillRequired.finalPosition}`
  const bonus = option.bonusRequired.kind === 'none' ? 'none'
    : option.bonusRequired.kind === 'reset_then_keep' ? `reset_then_keep:${option.bonusRequired.resetPosition}:${option.bonusRequired.finalPosition}`
      : `${option.bonusRequired.kind}:${option.bonusRequired.finalPosition}`
  return `${option.targetWeaponId}|${sourceResourceKey(option.source)}|${skill}|${bonus}`
}

/**
 * Lazily yields every reach option of `target` in the documented deterministic order. A source with no
 * Skill or no Bonus requirement in the window yields nothing; that is a window / support fact, never
 * "unreachable". The caller stops whenever it has enough (`countUpTo(k)`, first match).
 */
export function* enumerateReachOptions(target: TargetReach, table: ReachTable): Generator<ReachOption, void, undefined> {
  for (const source of target.sources) {
    for (const skillRequired of skillRequirements(target, source, table.originSkill)) {
      for (const bonusRequired of bonusRequirements(target, source)) {
        yield {
          targetWeaponId: target.targetWeaponId,
          source,
          skillRequired,
          bonusRequired,
          normalRequired: source.kind === 'new_normal' ? { counterId: source.counterId, position: source.position } : null,
          streamEnd: reachOptionStreamEnd(target, table, source, skillRequired, bonusRequired),
          verification: 'necessary_only',
        }
      }
    }
  }
}

/** The first `limit` options, without enumerating the rest (MRV domain counting, design 6.4). */
export function takeReachOptions(target: TargetReach, table: ReachTable, limit: number): ReachOption[] {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError(`takeReachOptions limit must be a non-negative integer (got ${String(limit)}).`)
  const taken: ReachOption[] = []
  if (limit === 0) return taken
  for (const option of enumerateReachOptions(target, table)) {
    taken.push(option)
    if (taken.length >= limit) break
  }
  return taken
}
