/**
 * Test-only fixtures for the Phase C-2 coverage-gated search (Issue #154). An independent coverage
 * predicate - written position by position from design 8.1, without the Phase C-1 gap / holder code - and
 * a seeded generator of small hand-built ReachTables (no Engine, no oracle, no real Target or weapon ID).
 * Together with `bruteForceAssignments()` they are the reference the search is compared against.
 */
import { bruteForceAssignments, COUNTER_A, gogmaSource, handBuiltReachTable, newNormalSource, normalSource, type BruteAssignment, type HandBuiltTargetSpec } from './assignmentTestFixture'
import type { PlanningTargetPriority } from './assignmentTypes'
import type { ReachOption, ReachOptionSetVersion, ReachTable, SourceCandidate } from './types'

/**
 * Design 8.1, position by position: every Counter position from the origin to the stream end - 1 that is
 * not a required position needs one Target that can place a skippable chain unit there.
 *   Skill: an owned Gogma's Reset Skills chain (`p < s*`), or a conversion's chain after the conversion (`c < p < s*`).
 *   Gogma: any Bonus operation of the Target (`p < g*`).
 *   Normal: a production-target forge beyond it on the same Counter (`p < position`).
 */
export function bruteCoverageFeasible(options: readonly ReachOption[], table: ReachTable): boolean {
  const skillRequired = new Set<number>()
  const gogmaRequired = new Set<number>()
  const normalRequired = new Map<string, Set<number>>()
  let skillEnd = table.originSkill
  let gogmaEnd = table.originGogma
  for (const option of options) {
    const skill = option.skillRequired
    if (skill.kind === 'reset_skills') skillRequired.add(skill.finalPosition)
    if (skill.kind === 'conversion') { skillRequired.add(skill.conversionPosition); skillRequired.add(skill.finalPosition) }
    if (skill.kind !== 'none') skillEnd = Math.max(skillEnd, skill.finalPosition + 1)
    const bonus = option.bonusRequired
    if (bonus.kind === 'reset_then_keep') gogmaRequired.add(bonus.resetPosition)
    if (bonus.kind !== 'none') { gogmaRequired.add(bonus.finalPosition); gogmaEnd = Math.max(gogmaEnd, bonus.finalPosition + 1) }
    if (option.normalRequired) {
      const set = normalRequired.get(option.normalRequired.counterId) ?? new Set<number>()
      set.add(option.normalRequired.position)
      normalRequired.set(option.normalRequired.counterId, set)
    }
  }
  for (let position = table.originSkill; position < skillEnd; position++) {
    if (skillRequired.has(position)) continue
    const held = options.some(option => {
      const skill = option.skillRequired
      if (skill.kind === 'reset_skills') return position < skill.finalPosition
      if (skill.kind === 'conversion') return skill.conversionPosition < position && position < skill.finalPosition
      return false
    })
    if (!held) return false
  }
  for (let position = table.originGogma; position < gogmaEnd; position++) {
    if (gogmaRequired.has(position)) continue
    if (!options.some(option => option.bonusRequired.kind !== 'none' && position < option.bonusRequired.finalPosition)) return false
  }
  for (const [counterId, required] of normalRequired) {
    const end = Math.max(...required) + 1
    for (let position = table.originNormal[counterId]!; position < end; position++) {
      if (required.has(position)) continue
      if (!options.some(option => option.normalRequired?.counterId === counterId && position < option.normalRequired.position)) return false
    }
  }
  return true
}

/** Every complete C1 / C2 assignment of the table that also passes `bruteCoverageFeasible()` (Target order, brute-force order). */
export function bruteForceCoverageFeasible(table: ReachTable): BruteAssignment[] {
  return bruteForceAssignments(table).filter(assignment => bruteCoverageFeasible(assignment.options, table))
}

/** A small deterministic PRNG (test data only). */
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

function pick<T>(random: () => number, values: readonly T[], count: number): T[] {
  const pool = [...values]
  const chosen: T[] = []
  while (chosen.length < count && pool.length > 0) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!)
  return chosen.sort()
}

export const RANDOM_SKILL_ORIGIN = 10
export const RANDOM_GOGMA_ORIGIN = 50
export const RANDOM_WINDOW = { skill: 4, gogma: 4, normal: 3 }

/**
 * A random 2- or 3-Target table over Skill 10..14, Gogma 50..53 and Normal Counter A 0..2: owned Gogma
 * sources (some with Ideal Skills, so no Skill operation), owned Normals and new Normal forges, shared
 * between Targets so C1 matters, a few Ideal Skill / Reset positions and a Keep-Ideal layout.
 */
export function randomCoverageTable(seed: number): { table: ReachTable; planningTargets: PlanningTargetPriority[] } {
  const random = seededRandom(seed)
  const skillPositions = [10, 11, 12, 13, 14]
  const gogmaPositions = [50, 51, 52, 53]
  const sharedGogma = gogmaSource('owned.g.shared')
  const sharedNormal = normalSource('owned.n.shared')
  const targetCount = random() < 0.5 ? 2 : 3
  const targets: HandBuiltTargetSpec[] = []
  for (let index = 0; index < targetCount; index++) {
    const sources: SourceCandidate[] = []
    const roll = random()
    if (roll < 0.3) sources.push(gogmaSource(`owned.g.${index}`, { currentSkillIdeal: random() < 0.4 }))
    if (roll >= 0.2 && roll < 0.6) sources.push(normalSource(`owned.n.${index}`))
    if (roll >= 0.5) sources.push(newNormalSource(Math.floor(random() * 3), 'X', COUNTER_A))
    if (random() < 0.3) sources.push(random() < 0.5 ? sharedGogma : sharedNormal)
    const resetLayouts = new Map<number, string>(pick(random, gogmaPositions, 2).map(position => [position, random() < 0.5 ? 'I' : 'L']))
    targets.push({
      id: `target.${String.fromCharCode(97 + index)}`,
      sources,
      priority: (1 + Math.floor(random() * 5)) as 1 | 2 | 3 | 4 | 5,
      skill: { idealPositions: pick(random, skillPositions, 1 + Math.floor(random() * 2)), resetSkillsLimit: 13, conversionLimit: 14 },
      bonus: {
        resetIdealPositions: pick(random, gogmaPositions, 1 + Math.floor(random() * 2)),
        resetLayoutByPosition: resetLayouts,
        keepIdealPositionsByLayout: new Map([['I', pick(random, gogmaPositions, Math.floor(random() * 2))]]),
        keepUnsupportedLayouts: [],
      },
    })
  }
  return handBuiltReachTable({ originSkill: RANDOM_SKILL_ORIGIN, originGogma: RANDOM_GOGMA_ORIGIN, originNormal: { [COUNTER_A]: 0 }, window: RANDOM_WINDOW, targets })
}

/**
 * A-2: a random 2- or 3-Target table over the same small windows whose owned Gogma sources take every current-Ideal
 * combination - neither lane, the Skill lane, the Bonus lane, or both (then sometimes protected) - with a Keep-Ideal or other
 * layout, Keep support or not, plus owned Normals and new Normal forges, one owned Gogma shared between Targets with flags of
 * its own per Target (C1 matters), and a few Ideal Skill / Reset / Keep positions. `optionSet` decides which options Phase A
 * derives from it; the rows themselves do not depend on it, so the same seed gives the a1 and the a2 table of one input.
 */
export function randomContinuationTable(seed: number, optionSet: ReachOptionSetVersion): { table: ReachTable; planningTargets: PlanningTargetPriority[] } {
  const random = seededRandom(Math.imul(seed, 2_654_435_761) >>> 0)
  for (let index = 0; index < 4; index++) random()
  const chance = (probability: number) => random() < probability
  const skillPositions = [10, 11, 12, 13, 14]
  const gogmaPositions = [50, 51, 52, 53]
  const gogma = (id: string): SourceCandidate => {
    const currentSkillIdeal = chance(0.5)
    const currentBonusIdeal = chance(0.5)
    return gogmaSource(id, {
      currentSkillIdeal, currentBonusIdeal, isProtected: currentSkillIdeal && currentBonusIdeal && chance(0.4),
      layout: (['I', 'L', 'X'] as const)[Math.floor(random() * 3)]!, keepSupported: chance(0.85),
    })
  }
  const targetCount = chance(0.5) ? 2 : 3
  const targets: HandBuiltTargetSpec[] = []
  for (let index = 0; index < targetCount; index++) {
    const sources: SourceCandidate[] = []
    if (chance(0.7)) sources.push(gogma(`owned.g.${index}`))
    if (chance(0.3)) sources.push(normalSource(`owned.n.${index}`, chance(0.5) ? 'I' : 'L'))
    if (chance(0.3)) sources.push(newNormalSource(Math.floor(random() * 3), chance(0.5) ? 'I' : 'X', COUNTER_A))
    if (chance(0.4)) sources.push(gogma('owned.g.shared'))
    if (sources.length === 0) sources.push(gogma(`owned.g.${index}`))
    const resetLayouts = new Map<number, string>(pick(random, gogmaPositions, 2).map(position => [position, chance(0.5) ? 'I' : 'L']))
    targets.push({
      id: `target.${String.fromCharCode(97 + index)}`,
      sources: sources.sort((left, right) => (left.kind === 'new_normal' ? 1 : 0) - (right.kind === 'new_normal' ? 1 : 0)),
      priority: (1 + Math.floor(random() * 5)) as 1 | 2 | 3 | 4 | 5,
      skill: { idealPositions: pick(random, skillPositions, 1 + Math.floor(random() * 2)), resetSkillsLimit: 13, conversionLimit: 14 },
      bonus: {
        resetIdealPositions: pick(random, gogmaPositions, 1 + Math.floor(random() * 2)),
        resetLayoutByPosition: resetLayouts,
        keepIdealPositionsByLayout: new Map([['I', pick(random, gogmaPositions, Math.floor(random() * 3))], ['L', pick(random, gogmaPositions, Math.floor(random() * 2))]]),
        keepUnsupportedLayouts: [],
      },
    })
  }
  return handBuiltReachTable({ optionSet, originSkill: RANDOM_SKILL_ORIGIN, originGogma: RANDOM_GOGMA_ORIGIN, originNormal: { [COUNTER_A]: 0 }, window: RANDOM_WINDOW, targets })
}
