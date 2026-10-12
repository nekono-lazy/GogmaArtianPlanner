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
 *
 * Phase B-1 (design 6.3 / 6.4) reads the same rules through the per-source and per-requirement entry
 * points below (`skillRequirementBlocks()`, `enumerateSkillRequirements()`, `enumerateBonusRequirements()`,
 * `enumerateReachOptionsOfSource()`, `createReachOption()`), so its lazily ordered enumeration and its
 * lower bound never re-implement an option rule: the full enumeration is exactly the concatenation of
 * the per-source enumerations, and every path builds options through the one factory.
 */
import type { BonusRequirement, LayoutKey, ReachOption, ReachTable, SkillRequirement, SourceCandidate, StreamEnd, TargetReach } from './types'

/**
 * The structure behind one source's Skill requirements (design 5.2), in enumeration order. `none` is one
 * requirement; `reset_skills` is one per listed final position; `conversion` is, per listed final `s*`,
 * the block `c = s*, s* - 1, ..., originSkill` (`s* - originSkill + 1` requirements).
 */
export type SkillRequirementBlocks =
  | { kind: 'none' }
  | { kind: 'reset_skills'; finalPositions: number[] }
  | { kind: 'conversion'; finalPositions: number[]; originSkill: number }

export function skillRequirementBlocks(target: TargetReach, source: SourceCandidate, originSkill: number): SkillRequirementBlocks {
  if (source.kind === 'owned_gogma') {
    if (source.currentSkillIdeal) return { kind: 'none' }
    return { kind: 'reset_skills', finalPositions: target.skill.idealPositions.filter(position => position <= target.skill.resetSkillsLimit) }
  }
  return { kind: 'conversion', finalPositions: target.skill.idealPositions.filter(position => position <= target.skill.conversionLimit), originSkill }
}

function* skillRequirements(target: TargetReach, source: SourceCandidate, originSkill: number): Generator<SkillRequirement, void, undefined> {
  const blocks = skillRequirementBlocks(target, source, originSkill)
  switch (blocks.kind) {
    case 'none':
      yield { kind: 'none' }
      return
    case 'reset_skills':
      for (const finalPosition of blocks.finalPositions) yield { kind: 'reset_skills', finalPosition }
      return
    case 'conversion':
      for (const finalPosition of blocks.finalPositions) {
        for (let conversionPosition = finalPosition; conversionPosition >= blocks.originSkill; conversionPosition--) {
          yield { kind: 'conversion', conversionPosition, finalPosition }
        }
      }
      return
  }
}

/** The Skill requirements of one source in enumeration order (the outer loop of `enumerateReachOptionsOfSource()`). */
export function enumerateSkillRequirements(target: TargetReach, source: SourceCandidate, table: ReachTable): Generator<SkillRequirement, void, undefined> {
  return skillRequirements(target, source, table.originSkill)
}

/**
 * Keep-Ideal positions reachable through a Reset layout, ascending and unique, with the Reset positions
 * that produce each layout (`reset_then_keep`, design 5.2). A Target-level fact: it reads no source.
 */
export function resetThenKeepPlan(target: TargetReach): { finalPositions: number[]; resetPositionsByLayout: Map<LayoutKey, number[]> } {
  const resetPositionsByLayout = new Map<LayoutKey, number[]>()
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

/** The `reset_then_keep` requirements of a Target by `(g*, g1)` ascending; the same for every source whose Bonus is not already Ideal. */
export function* enumerateResetThenKeepRequirements(target: TargetReach): Generator<Extract<BonusRequirement, { kind: 'reset_then_keep' }>, void, undefined> {
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

/** The `keep_from_source` final positions of one source: its layout's Keep-Ideal positions, only while its Keep input is supported. */
export function keepFromSourcePositions(target: TargetReach, source: SourceCandidate): readonly number[] {
  if (!source.keepSupported) return []
  return target.bonus.keepIdealPositionsByLayout.get(source.layout) ?? []
}

/** Whether a source's only Bonus requirement is `none` (an owned Gogma already Ideal in `gogma_artian` scope). */
export function bonusRequirementIsNone(source: SourceCandidate): boolean {
  return source.kind === 'owned_gogma' && source.currentBonusIdeal
}

function* bonusRequirements(target: TargetReach, source: SourceCandidate): Generator<BonusRequirement, void, undefined> {
  if (bonusRequirementIsNone(source)) { yield { kind: 'none' }; return }
  for (const finalPosition of target.bonus.resetIdealPositions) yield { kind: 'reset', finalPosition }
  for (const finalPosition of keepFromSourcePositions(target, source)) yield { kind: 'keep_from_source', finalPosition }
  yield* enumerateResetThenKeepRequirements(target)
}

/** The Bonus requirements of one source in enumeration order (the inner loop of `enumerateReachOptionsOfSource()`). */
export function enumerateBonusRequirements(target: TargetReach, source: SourceCandidate): Generator<BonusRequirement, void, undefined> {
  return bonusRequirements(target, source)
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

/** The one option factory: the same object whichever enumeration (full, per source, or Phase B-1's ordered lattice) reached it. */
export function createReachOption(target: TargetReach, table: ReachTable, source: SourceCandidate, skillRequired: SkillRequirement, bonusRequired: BonusRequirement): ReachOption {
  return {
    targetWeaponId: target.targetWeaponId,
    source,
    skillRequired,
    bonusRequired,
    normalRequired: source.kind === 'new_normal' ? { counterId: source.counterId, position: source.position } : null,
    streamEnd: reachOptionStreamEnd(target, table, source, skillRequired, bonusRequired),
    verification: 'necessary_only',
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

/** Lazily yields every reach option of `target` from one of its sources, Skill requirements outer and Bonus requirements inner. */
export function* enumerateReachOptionsOfSource(target: TargetReach, table: ReachTable, source: SourceCandidate): Generator<ReachOption, void, undefined> {
  for (const skillRequired of skillRequirements(target, source, table.originSkill)) {
    for (const bonusRequired of bonusRequirements(target, source)) {
      yield createReachOption(target, table, source, skillRequired, bonusRequired)
    }
  }
}

/**
 * Lazily yields every reach option of `target` in the documented deterministic order. A source with no
 * Skill or no Bonus requirement in the window yields nothing; that is a window / support fact, never
 * "unreachable". The caller stops whenever it has enough (`countUpTo(k)`, first match).
 */
export function* enumerateReachOptions(target: TargetReach, table: ReachTable): Generator<ReachOption, void, undefined> {
  for (const source of target.sources) yield* enumerateReachOptionsOfSource(target, table, source)
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
