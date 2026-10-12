/**
 * Test-only fixtures for the Phase C-1 coverage modules (Issue #154). Hand-built ReachTables with wide
 * windows and resource assignments assembled from hand-picked options through the Phase A option
 * factory, with the aggregate fields derived here on their own. No Engine, no oracle, no real Target or
 * weapon ID.
 */
import type { TargetWeaponId } from '../../domain/models/publicTypes'
import { handBuiltReachTable, targetId, type HandBuiltTableSpec } from './assignmentTestFixture'
import type { ResourceAssignmentCandidate } from './assignmentTypes'
import type { CoverageSegment, StreamCoverage } from './coverageTypes'
import { createReachOption, sourceResourceKey } from './reachOptions'
import type { BonusRequirement, ReachOption, ReachTable, SkillRequirement, SourceCandidate } from './types'

export const SKILL_ORIGIN = 10
export const GOGMA_ORIGIN = 50
export const WIDE_WINDOW = { skill: 30, gogma: 40, normal: 20 }

/** A hand-built table whose every row allows Reset Skills / conversions over the whole wide Skill window. */
export function coverageTable(spec: Omit<HandBuiltTableSpec, 'window' | 'originSkill' | 'originGogma'> & { originSkill?: number; originGogma?: number }): ReachTable {
  const originSkill = spec.originSkill ?? SKILL_ORIGIN
  const originGogma = spec.originGogma ?? GOGMA_ORIGIN
  const targets = spec.targets.map(target => ({
    ...target,
    skill: { idealPositions: [], resetSkillsLimit: originSkill + WIDE_WINDOW.skill - 1, conversionLimit: originSkill + WIDE_WINDOW.skill, ...target.skill },
  }))
  return handBuiltReachTable({ ...spec, originSkill, originGogma, window: WIDE_WINDOW, targets }).table
}

export const NONE: SkillRequirement & BonusRequirement = { kind: 'none' }
export const resetSkills = (finalPosition: number): SkillRequirement => ({ kind: 'reset_skills', finalPosition })
export const conversion = (conversionPosition: number, finalPosition: number): SkillRequirement => ({ kind: 'conversion', conversionPosition, finalPosition })
export const reset = (finalPosition: number): BonusRequirement => ({ kind: 'reset', finalPosition })
export const keep = (finalPosition: number): BonusRequirement => ({ kind: 'keep_from_source', finalPosition })
export const resetThenKeep = (resetPosition: number, finalPosition: number): BonusRequirement => ({ kind: 'reset_then_keep', resetPosition, finalPosition })

/** The option of Target `id` from `source` (which must be one of its row sources) through the Phase A factory. */
export function option(table: ReachTable, id: string, source: SourceCandidate, skill: SkillRequirement, bonus: BonusRequirement): ReachOption {
  const row = table.targets.find(value => value.targetWeaponId === id)
  if (!row) throw new Error(`No row ${id}`)
  return createReachOption(row, table, source, skill, bonus)
}

/**
 * A resource assignment of `options` (assignment order as given), with every aggregate re-derived here:
 * chosen in table order, sorted sources and required positions, the max stream ends, Σ (end − origin).
 */
export function assignmentOf(table: ReachTable, options: readonly ReachOption[], ordinal = 0): ResourceAssignmentCandidate {
  const counterIds = Object.keys(table.originNormal).sort()
  const chosen = new Map<TargetWeaponId, ReachOption>()
  for (const row of table.targets) {
    const found = options.find(value => value.targetWeaponId === row.targetWeaponId)
    if (found) chosen.set(row.targetWeaponId, found)
  }
  const skill: number[] = []
  const gogma: number[] = []
  const normal: Record<string, number[]> = Object.fromEntries(counterIds.map(counterId => [counterId, []]))
  for (const value of options) {
    if (value.skillRequired.kind === 'reset_skills') skill.push(value.skillRequired.finalPosition)
    if (value.skillRequired.kind === 'conversion') skill.push(...new Set([value.skillRequired.conversionPosition, value.skillRequired.finalPosition]))
    if (value.bonusRequired.kind === 'reset' || value.bonusRequired.kind === 'keep_from_source') gogma.push(value.bonusRequired.finalPosition)
    if (value.bonusRequired.kind === 'reset_then_keep') gogma.push(value.bonusRequired.resetPosition, value.bonusRequired.finalPosition)
    if (value.normalRequired) normal[value.normalRequired.counterId]!.push(value.normalRequired.position)
  }
  const ascending = (values: number[]) => [...values].sort((left, right) => left - right)
  const streamEnd = {
    skill: Math.max(table.originSkill, ...options.map(value => value.streamEnd.skill)),
    gogma: Math.max(table.originGogma, ...options.map(value => value.streamEnd.gogma)),
    normal: Object.fromEntries(counterIds.map(counterId => [counterId, Math.max(table.originNormal[counterId]!, ...options.map(value => value.streamEnd.normal[counterId] ?? 0))])),
  }
  let objective = (streamEnd.skill - table.originSkill) + (streamEnd.gogma - table.originGogma)
  for (const counterId of counterIds) objective += streamEnd.normal[counterId]! - table.originNormal[counterId]!
  return {
    kind: 'resource_assignment',
    ordinal,
    chosen,
    assignmentOrder: options.map(value => value.targetWeaponId),
    usedSources: options.map(value => sourceResourceKey(value.source)).sort(),
    requiredPositions: { skill: ascending(skill), gogma: ascending(gogma), normal: Object.fromEntries(counterIds.map(counterId => [counterId, ascending(normal[counterId]!)])) },
    streamEnd,
    objective,
  }
}

/** `[kind, from, to, coverer]` per segment, for compact expectations. */
export function segmentsOf(coverage: StreamCoverage): [CoverageSegment['kind'], number, number, string][] {
  return coverage.segments.map(segment => [segment.kind, segment.from, segment.to, segment.covererTargetWeaponId])
}

/** Asserts the documented endpoint rule (inclusive, sorted, contiguous, exactly `origin .. end - 1`) on its own. */
export function partitionProblems(coverage: StreamCoverage): string[] {
  const problems: string[] = []
  const counted = new Map<number, number>()
  for (const segment of coverage.segments) {
    if (segment.from > segment.to) problems.push(`empty segment ${segment.from}..${segment.to}`)
    for (let position = segment.from; position <= segment.to; position++) counted.set(position, (counted.get(position) ?? 0) + 1)
  }
  for (let position = coverage.origin; position < coverage.end; position++) if (counted.get(position) !== 1) problems.push(`position ${position} covered ${counted.get(position) ?? 0} times`)
  for (const position of counted.keys()) if (position < coverage.origin || position >= coverage.end) problems.push(`position ${position} outside the stream`)
  for (const required of coverage.required) {
    const segment = coverage.segments.find(value => value.from === required.position)
    if (!segment || segment.kind !== 'required' || segment.to !== required.position || segment.covererTargetWeaponId !== required.targetWeaponId) problems.push(`required ${required.position} is not its owner's required segment`)
  }
  return problems
}

export { targetId }
