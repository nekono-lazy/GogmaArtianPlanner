import { describe, expect, it } from 'vitest'
import { applyReachOption, createEmptyPartialAssignment, findResourceViolation } from './assignmentFeasibility'
import { createTargetStreamMenus, partialAssignmentLowerBound } from './assignmentLowerBound'
import { compareValueOrder, countFeasibleOptionsUpTo, createKeyedOptionEnumerator, createOrderedOptionEnumerator, createTargetOptionLattice, valueOrderKey } from './assignmentOrdering'
import { COUNTER_A, gogmaSource, handBuiltReachTable, newNormalSource, normalSource } from './assignmentTestFixture'
import type { PartialResourceAssignment } from './assignmentTypes'
import { checkStreamCoverage } from './coverage'
import { collectCoverageFeasibleAssignments } from './coverageSearch'
import { bruteCoverageFeasible, randomContinuationTable } from './coverageSearchTestFixture'
import { assignmentOf, conversion, keep, NONE, option as optionOf, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import { createReachOption, enumerateReachOptions, reachOptionKey, sourceLaneAdmission } from './reachOptions'
import {
  REACH_OPTION_SET_A1, REACH_OPTION_SET_A2,
  type BonusRequirement, type ReachOption, type ReachOptionSetVersion, type ReachTable, type SkillRequirement, type SourceCandidate, type StreamEnd, type TargetReach,
} from './types'

/*
 * Issue #154 Global Assignment Phase A-2 (`docs/PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md` 5 / 6 / 9.3, design 19.8):
 * the a2 option set (the owned-Gogma current-Ideal lane continuations, G2) through Phase A, the Phase B value order, MRV and
 * lower bound, and Phase C. The reference is written here from the documented rules on its own - an option enumeration, the
 * stream ends, the C1 / C2 brute force, a position-by-position coverage predicate and the dominance procedure P of the audit's
 * Theorem T - and never calls the Phase A generator, the solver or the Phase C module it checks. Hand-built tables, no Engine.
 */

const keyOf = (option: ReachOption) => reachOptionKey(option)
const isA2 = (rule: ReachOptionSetVersion) => rule === REACH_OPTION_SET_A2

// ------------------------------------------------------------------------------------------------ the independent reference

function referenceSkills(row: TargetReach, table: ReachTable, source: SourceCandidate, rule: ReachOptionSetVersion): SkillRequirement[] {
  if (source.kind !== 'owned_gogma') {
    const out: SkillRequirement[] = []
    for (const finalPosition of row.skill.idealPositions.filter(position => position <= row.skill.conversionLimit)) {
      for (let conversionPosition = finalPosition; conversionPosition >= table.originSkill; conversionPosition--) out.push({ kind: 'conversion', conversionPosition, finalPosition })
    }
    return out
  }
  const resets: SkillRequirement[] = row.skill.idealPositions.filter(position => position <= row.skill.resetSkillsLimit).map(finalPosition => ({ kind: 'reset_skills', finalPosition }))
  if (source.isProtected) return [{ kind: 'none' }]
  if (!source.currentSkillIdeal) return resets
  // a1: a current-Ideal lane is `none`. a2: `none`, then the continuations - unless the source is Ideal on both axes (G4-iii).
  return isA2(rule) && !source.currentBonusIdeal ? [{ kind: 'none' }, ...resets] : [{ kind: 'none' }]
}

function referenceBonuses(row: TargetReach, source: SourceCandidate, rule: ReachOptionSetVersion): BonusRequirement[] {
  const operations: BonusRequirement[] = row.bonus.resetIdealPositions.map(finalPosition => ({ kind: 'reset', finalPosition }))
  if (source.keepSupported) for (const finalPosition of row.bonus.keepIdealPositionsByLayout.get(source.layout) ?? []) operations.push({ kind: 'keep_from_source', finalPosition })
  const pairs: { resetPosition: number; finalPosition: number }[] = []
  for (const [resetPosition, layout] of row.bonus.resetLayoutByPosition) {
    if (row.bonus.keepUnsupportedLayouts.includes(layout)) continue
    for (const finalPosition of row.bonus.keepIdealPositionsByLayout.get(layout) ?? []) if (resetPosition < finalPosition) pairs.push({ resetPosition, finalPosition })
  }
  pairs.sort((left, right) => left.finalPosition - right.finalPosition || left.resetPosition - right.resetPosition)
  for (const pair of pairs) operations.push({ kind: 'reset_then_keep', ...pair })
  if (source.kind !== 'owned_gogma') return operations
  if (source.isProtected) return [{ kind: 'none' }]
  if (!source.currentBonusIdeal) return operations
  return isA2(rule) && !source.currentSkillIdeal ? [{ kind: 'none' }, ...operations] : [{ kind: 'none' }]
}

function referenceOption(row: TargetReach, table: ReachTable, source: SourceCandidate, skillRequired: SkillRequirement, bonusRequired: BonusRequirement): ReachOption {
  const normal: StreamEnd['normal'] = row.normalCounterId === null ? {} : { [row.normalCounterId]: source.kind === 'new_normal' ? source.position + 1 : table.originNormal[row.normalCounterId]! }
  return {
    targetWeaponId: row.targetWeaponId, source, skillRequired, bonusRequired,
    normalRequired: source.kind === 'new_normal' ? { counterId: source.counterId, position: source.position } : null,
    streamEnd: {
      skill: skillRequired.kind === 'none' ? table.originSkill : skillRequired.finalPosition + 1,
      gogma: bonusRequired.kind === 'none' ? table.originGogma : bonusRequired.finalPosition + 1,
      normal,
    },
    verification: 'necessary_only',
  }
}

/** Every option of a row by the documented rules (design 5.2 / 5.4, A-2), in the documented order. */
function referenceOptions(row: TargetReach, table: ReachTable, rule: ReachOptionSetVersion = table.optionSet): ReachOption[] {
  return row.sources.flatMap(source => referenceSkills(row, table, source, rule).flatMap(skill => referenceBonuses(row, source, rule).map(bonus => referenceOption(row, table, source, skill, bonus))))
}

/** S1 (G1), S2 / B (G2): which lanes of the option continue past an Ideal lane start (audit 5.1). */
function continuationOf(option: ReachOption, row: TargetReach): { s1: boolean; s2: boolean; bonus: boolean } {
  const { source, skillRequired: skill, bonusRequired: bonus } = option
  return {
    s1: skill.kind === 'conversion' && skill.conversionPosition < skill.finalPosition && row.skill.idealPositions.includes(skill.conversionPosition),
    s2: source.kind === 'owned_gogma' && source.currentSkillIdeal && skill.kind === 'reset_skills',
    bonus: source.kind === 'owned_gogma' && source.currentBonusIdeal && bonus.kind !== 'none',
  }
}
const isContinuation = (option: ReachOption, row: TargetReach) => Object.values(continuationOf(option, row)).some(Boolean)

function resources(option: ReachOption) {
  const skill = option.skillRequired.kind === 'none' ? [] : option.skillRequired.kind === 'reset_skills' ? [option.skillRequired.finalPosition]
    : [...new Set([option.skillRequired.conversionPosition, option.skillRequired.finalPosition])]
  const gogma = option.bonusRequired.kind === 'none' ? [] : option.bonusRequired.kind === 'reset_then_keep' ? [option.bonusRequired.resetPosition, option.bonusRequired.finalPosition] : [option.bonusRequired.finalPosition]
  const source = option.source.kind === 'new_normal' ? `N:${option.source.counterId}:${option.source.position}` : `O:${option.source.ownedWeaponId}`
  return { source, skill, gogma, normal: option.normalRequired === null ? null : `${option.normalRequired.counterId}@${option.normalRequired.position}` }
}

/** C1 / C2 checked here on their own. */
function resourceValid(options: readonly ReachOption[]): boolean {
  const seen = new Set<string>()
  for (const option of options) {
    const used = resources(option)
    for (const key of [used.source, ...used.skill.map(position => `S${position}`), ...used.gogma.map(position => `G${position}`), ...(used.normal === null ? [] : [`N${used.normal}`])]) {
      if (seen.has(key)) return false
      seen.add(key)
    }
  }
  return true
}

function objectiveOf(options: readonly ReachOption[], table: ReachTable): number {
  let total = Math.max(table.originSkill, ...options.map(option => option.streamEnd.skill)) - table.originSkill
  total += Math.max(table.originGogma, ...options.map(option => option.streamEnd.gogma)) - table.originGogma
  for (const [counterId, origin] of Object.entries(table.originNormal)) total += Math.max(origin, ...options.map(option => option.streamEnd.normal[counterId] ?? origin)) - origin
  return total
}

/** Every complete C1 / C2 assignment over the reference options (Target order); `filter` restricts each Target's options. */
function referenceAssignments(table: ReachTable, rule: ReachOptionSetVersion, filter: (option: ReachOption, row: TargetReach) => boolean = () => true): ReachOption[][] {
  const perTarget = table.targets.map(row => referenceOptions(row, table, rule).filter(option => filter(option, row)))
  const out: ReachOption[][] = []
  const chosen: ReachOption[] = []
  const recurse = (index: number) => {
    if (index === perTarget.length) { out.push([...chosen]); return }
    for (const option of perTarget[index]!) {
      chosen.push(option)
      if (resourceValid(chosen)) recurse(index + 1)
      chosen.pop()
    }
  }
  recurse(0)
  return out
}

/** The lowest Skill position no required position and no Reset Skills / post-conversion chain holds (design 8.1), or null. */
function lowestUncoveredSkill(options: readonly ReachOption[], table: ReachTable): number | null {
  const required = new Set(options.flatMap(option => resources(option).skill))
  const end = Math.max(table.originSkill, ...options.map(option => option.streamEnd.skill))
  for (let position = table.originSkill; position < end; position++) {
    if (required.has(position)) continue
    const held = options.some(option => {
      const skill = option.skillRequired
      if (skill.kind === 'reset_skills') return position < skill.finalPosition
      if (skill.kind === 'conversion') return skill.conversionPosition < position && position < skill.finalPosition
      return false
    })
    if (!held) return position
  }
  return null
}

/**
 * The audit's procedure P (5.2 / 5.3), implemented here on its own: L1 replaces every continued lane of an owned Gogma by `none`;
 * then every S1 `conversion (c, s*)` becomes `(c, c)`, and while the Skill stream is not covered, the conversion of a Target whose
 * conversion lies above the lowest uncovered position p (the smallest such `c`, then Target order) is lowered to p.
 */
function dominate(options: readonly ReachOption[], table: ReachTable): ReachOption[] {
  const rows = new Map(table.targets.map(row => [row.targetWeaponId, row]))
  let current = options.map(option => {
    const row = rows.get(option.targetWeaponId)!
    const lanes = continuationOf(option, row)
    return referenceOption(row, table, option.source, lanes.s2 ? NONE : option.skillRequired, lanes.bonus ? NONE : option.bonusRequired)
  })
  for (let guard = 0; guard < 10_000; guard++) {
    const s1 = current.findIndex(option => continuationOf(option, rows.get(option.targetWeaponId)!).s1)
    if (s1 >= 0) {
      const option = current[s1]!
      const skill = option.skillRequired as Extract<SkillRequirement, { kind: 'conversion' }>
      current = current.map((value, index) => (index === s1 ? referenceOption(rows.get(option.targetWeaponId)!, table, option.source, conversion(skill.conversionPosition, skill.conversionPosition), option.bonusRequired) : value))
      continue
    }
    const p = lowestUncoveredSkill(current, table)
    if (p === null) return current
    const lowered = current.map((option, index) => ({ option, index }))
      .filter(({ option }) => option.skillRequired.kind === 'conversion' && option.skillRequired.conversionPosition > p)
      .sort((left, right) => (left.option.skillRequired as { conversionPosition: number }).conversionPosition - (right.option.skillRequired as { conversionPosition: number }).conversionPosition || left.index - right.index)[0]
    if (lowered === undefined) throw new Error(`P: no conversion above the uncovered Skill position ${p} (the coverage lemma is broken).`)
    const skill = lowered.option.skillRequired as Extract<SkillRequirement, { kind: 'conversion' }>
    current = current.map((value, index) => (index === lowered.index ? referenceOption(rows.get(value.targetWeaponId)!, table, value.source, conversion(p, skill.finalPosition), value.bonusRequired) : value))
  }
  throw new Error('P did not terminate.')
}

const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1)

// ------------------------------------------------------------------------------------------------ Phase A

describe('A-2 Phase A: the owned-Gogma current-Ideal lane continuations (G2)', () => {
  const sources = {
    skillIdeal: gogmaSource('g.skill', { currentSkillIdeal: true, layout: 'I' }),
    bonusIdeal: gogmaSource('g.bonus', { currentBonusIdeal: true, layout: 'I' }),
    bothIdeal: gogmaSource('g.both', { currentSkillIdeal: true, currentBonusIdeal: true, layout: 'I' }),
    protectedIdeal: gogmaSource('g.protected', { currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true, layout: 'I' }),
    plain: gogmaSource('g.plain', { layout: 'I' }),
  }
  const tableOf = (optionSet: ReachOptionSetVersion) => handBuiltReachTable({ optionSet, targets: [{ id: 'target.a', sources: Object.values(sources) }] }).table
  const keysOf = (optionSet: ReachOptionSetVersion, source: SourceCandidate) => {
    const table = tableOf(optionSet)
    return [...enumerateReachOptions({ ...table.targets[0]!, sources: [source] }, table)].map(option => keyOf(option).split('|').slice(2).join('|'))
  }

  it('lists none and then the Reset Skills continuations on a current-Ideal Skill lane, Bonus operations unchanged', () => {
    // DEFAULT_SKILL: Ideal Skill at 8 and 10; default Bonus: Reset 12, Keep from I at 11 / 13, Reset -> Keep (11, 13) (12, 13) (11, 15) (14, 15).
    const bonusOps = ['reset:12', 'keep_from_source:11', 'keep_from_source:13', 'reset_then_keep:11:13', 'reset_then_keep:12:13', 'reset_then_keep:11:15', 'reset_then_keep:14:15']
    expect(keysOf(REACH_OPTION_SET_A2, sources.skillIdeal)).toEqual(['none', 'reset_skills:8', 'reset_skills:10'].flatMap(skill => bonusOps.map(bonus => `${skill}|${bonus}`)))
    expect(keysOf(REACH_OPTION_SET_A1, sources.skillIdeal)).toEqual(bonusOps.map(bonus => `none|${bonus}`))
    expect(sourceLaneAdmission(sources.skillIdeal, REACH_OPTION_SET_A2)).toEqual({ skill: 'none_then_operations', bonus: 'operations_only' })
  })

  it('lists none and then Reset / Keep from source / Reset -> Keep on a current-Ideal gogma_artian Bonus lane', () => {
    const bonusOps = ['none', 'reset:12', 'keep_from_source:11', 'keep_from_source:13', 'reset_then_keep:11:13', 'reset_then_keep:12:13', 'reset_then_keep:11:15', 'reset_then_keep:14:15']
    expect(keysOf(REACH_OPTION_SET_A2, sources.bonusIdeal)).toEqual(['reset_skills:8', 'reset_skills:10'].flatMap(skill => bonusOps.map(bonus => `${skill}|${bonus}`)))
    expect(keysOf(REACH_OPTION_SET_A1, sources.bonusIdeal)).toEqual(['reset_skills:8|none', 'reset_skills:10|none'])
    // A source whose layout is not Keep-supported continues with Reset and Reset -> Keep only.
    const noKeep = keysOf(REACH_OPTION_SET_A2, { ...sources.bonusIdeal, keepSupported: false } as SourceCandidate)
    expect(noKeep.some(key => key.includes('keep_from_source'))).toBe(false)
    expect(noKeep.filter(key => key.startsWith('reset_skills:8|'))).toEqual(['reset_skills:8|none', 'reset_skills:8|reset:12', 'reset_skills:8|reset_then_keep:11:13', 'reset_skills:8|reset_then_keep:12:13', 'reset_skills:8|reset_then_keep:11:15', 'reset_skills:8|reset_then_keep:14:15'])
  })

  it('keeps none / none alone on a source Ideal on both axes (G4-iii), protected or not, and never operates a protected source', () => {
    for (const optionSet of [REACH_OPTION_SET_A1, REACH_OPTION_SET_A2]) {
      expect(keysOf(optionSet, sources.bothIdeal), optionSet).toEqual(['none|none'])
      expect(keysOf(optionSet, sources.protectedIdeal), optionSet).toEqual(['none|none'])
      expect(sourceLaneAdmission(sources.protectedIdeal, optionSet)).toEqual({ skill: 'none_only', bonus: 'none_only' })
    }
    // Protection is its own condition: a protected source with one Ideal axis (never a ReachTable source) still gets no operation.
    const protectedSkillIdeal = gogmaSource('g.p', { currentSkillIdeal: true, isProtected: true })
    expect(sourceLaneAdmission(protectedSkillIdeal, REACH_OPTION_SET_A2)).toEqual({ skill: 'none_only', bonus: 'none_only' })
    expect(sourceLaneAdmission(sources.bothIdeal, REACH_OPTION_SET_A2)).toEqual({ skill: 'none_only', bonus: 'none_only' })
  })

  it('changes nothing for a non-Ideal owned Gogma, an owned Normal or a new Normal', () => {
    for (const source of [sources.plain, normalSource('n', 'I'), newNormalSource(5, 'I')]) {
      expect(keysOf(REACH_OPTION_SET_A2, source), source.kind).toEqual(keysOf(REACH_OPTION_SET_A1, source))
      expect(sourceLaneAdmission(source, REACH_OPTION_SET_A2), source.kind).toEqual({ skill: 'operations_only', bonus: 'operations_only' })
    }
  })

  it('equals the independent reference enumeration option by option, in order, for both option sets over random tables', () => {
    let continuations = 0
    for (const seed of SEEDS) {
      for (const optionSet of [REACH_OPTION_SET_A1, REACH_OPTION_SET_A2]) {
        const { table } = randomContinuationTable(seed, optionSet)
        for (const row of table.targets) {
          const generated = [...enumerateReachOptions(row, table)]
          expect(generated, `seed ${seed} ${optionSet} ${row.targetWeaponId}`).toEqual(referenceOptions(row, table))
          expect(new Set(generated.map(keyOf)).size).toBe(generated.length)
          if (isA2(optionSet)) continuations += generated.filter(option => continuationOf(option, row).s2 || continuationOf(option, row).bonus).length
        }
      }
    }
    expect(continuations).toBeGreaterThan(500)
  })

  it('a2 contains a1 for every source and adds exactly the G2 continuations', () => {
    for (const seed of SEEDS) {
      const a1 = randomContinuationTable(seed, REACH_OPTION_SET_A1).table
      const a2 = randomContinuationTable(seed, REACH_OPTION_SET_A2).table
      a1.targets.forEach((row, index) => {
        const before = new Set([...enumerateReachOptions(row, a1)].map(keyOf))
        const after = [...enumerateReachOptions(a2.targets[index]!, a2)]
        for (const key of before) expect(after.map(keyOf), `seed ${seed}`).toContain(key)
        const added = after.filter(option => !before.has(keyOf(option)))
        for (const option of added) {
          const lanes = continuationOf(option, row)
          expect(lanes.s2 || lanes.bonus, `seed ${seed} ${keyOf(option)}`).toBe(true)
          // Never on a source Ideal on both axes, never on a protected source.
          expect(option.source.kind === 'owned_gogma' && option.source.currentSkillIdeal && option.source.currentBonusIdeal).toBe(false)
          expect(option.source.kind === 'owned_gogma' && option.source.isProtected).toBe(false)
        }
        expect(after.length - before.size).toBe(added.length)
      })
    }
  })
})

// ------------------------------------------------------------------------------------------------ Phase B

/** Random C1 / C2-feasible partial assignments of a table: the empty one and the Target-order prefixes of some complete assignments. */
function partialsOf(table: ReachTable, seed: number): PartialResourceAssignment[] {
  const partials = [createEmptyPartialAssignment(table)]
  const complete = referenceAssignments(table, table.optionSet)
  for (let index = 0; index < complete.length && partials.length < 8; index += Math.max(1, Math.floor(complete.length / 5) + (seed % 3))) {
    let partial = createEmptyPartialAssignment(table)
    for (const option of complete[index]!.slice(0, table.targets.length - 1)) {
      partial = applyReachOption(partial, option)
      partials.push(partial)
    }
  }
  return partials
}

describe('A-2 Phase B: the value-order lattice and MRV over the a2 option set', () => {
  it('delivers every option of the unused sources exactly once, in strictly ascending value order equal to the full sort', () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      for (const partial of partialsOf(table, seed)) {
        for (const row of table.targets) {
          if (partial.chosen.has(row.targetWeaponId)) continue
          const enumerator = createKeyedOptionEnumerator(createTargetOptionLattice(row, table), table, partial)
          const delivered: { option: ReachOption; key: ReturnType<typeof valueOrderKey> }[] = []
          for (let next = enumerator.next(); next !== undefined; next = enumerator.next()) delivered.push(next)
          const reference = referenceOptions(row, table).filter(option => !partial.usedSources.has(option.source.kind === 'new_normal' ? `normal:${option.source.counterId}:${option.source.position}` : `owned:${option.source.ownedWeaponId}`))
          const sorted = reference.map(option => ({ option, key: valueOrderKey(option, partial) })).sort((left, right) => compareValueOrder(left.key, right.key))
          expect(delivered.map(value => keyOf(value.option)), `seed ${seed}`).toEqual(sorted.map(value => keyOf(value.option)))
          for (let index = 1; index < delivered.length; index++) expect(compareValueOrder(delivered[index - 1]!.key, delivered[index]!.key)).toBeLessThan(0)
          // The value order key is the option's own: recomputing it from the delivered option gives the same key.
          for (const value of delivered) expect(value.key).toEqual(valueOrderKey(value.option, partial))
        }
      }
    }
  })

  it('never delivers a continuation before the option of the same source that replaces its continued lanes (L1) or its conversion (S1)', () => {
    let checked = 0
    for (const seed of SEEDS.slice(0, 150)) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      for (const partial of partialsOf(table, seed)) {
        for (const row of table.targets) {
          if (partial.chosen.has(row.targetWeaponId)) continue
          const enumerator = createOrderedOptionEnumerator(createTargetOptionLattice(row, table), table, partial)
          const index = new Map<string, number>()
          for (let option = enumerator.next(), at = 0; option !== undefined; option = enumerator.next(), at++) index.set(keyOf(option), at)
          for (const [key, at] of index) {
            const option = referenceOptions(row, table).find(value => keyOf(value) === key)!
            const lanes = continuationOf(option, row)
            if (!lanes.s1 && !lanes.s2 && !lanes.bonus) continue
            const skill = lanes.s2 ? NONE : lanes.s1 ? conversion((option.skillRequired as { conversionPosition: number }).conversionPosition, (option.skillRequired as { conversionPosition: number }).conversionPosition) : option.skillRequired
            const dominating = referenceOption(row, table, option.source, skill, lanes.bonus ? NONE : option.bonusRequired)
            expect(index.get(keyOf(dominating)), `seed ${seed}: ${key} has no dominating option`).toBeDefined()
            expect(index.get(keyOf(dominating))!, `seed ${seed}: ${key}`).toBeLessThan(at)
            expect(compareValueOrder(valueOrderKey(dominating, partial), valueOrderKey(option, partial))).toBeLessThan(0)
            checked += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1_000)
  })

  it('counts the resource-feasible options exactly (countUpTo) against the reference, and stops at the lookahead', () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      for (const partial of partialsOf(table, seed)) {
        for (const row of table.targets) {
          const feasible = referenceOptions(row, table).filter(option => findResourceViolation(option, partial) === null).length
          expect(countFeasibleOptionsUpTo(row, table, partial, 1_000_000).count, `seed ${seed}`).toBe(feasible)
          for (const limit of [1, 2, 5]) expect(countFeasibleOptionsUpTo(row, table, partial, limit).count).toBe(Math.min(limit, feasible))
        }
      }
    }
  })

  it('holds no source x Skill x Bonus product: a large continuation row comes out lazily with a bounded frontier', () => {
    const idealPositions = Array.from({ length: 2000 }, (_, index) => 8 + index)
    const resets = Array.from({ length: 2000 }, (_, index) => 10 + index)
    const { table } = handBuiltReachTable({ optionSet: REACH_OPTION_SET_A2, window: { skill: 3000, gogma: 3000, normal: 3 }, targets: [{
      id: 'target.huge',
      sources: [gogmaSource('g.skill', { currentSkillIdeal: true }), gogmaSource('g.bonus', { currentBonusIdeal: true })],
      skill: { idealPositions, resetSkillsLimit: 100_000, conversionLimit: 100_000 },
      bonus: { resetIdealPositions: resets, resetLayoutByPosition: new Map(), keepIdealPositionsByLayout: new Map() },
    }] })
    const lattice = createTargetOptionLattice(table.targets[0]!, table)
    // g.skill: Skill axis none + 2,000 Reset Skills, one Reset stream; g.bonus: 2,000 Reset Skills, a none stream and a Reset stream.
    expect(lattice.sources.map(source => [source.skills.length, source.bonusStreams.map(stream => stream.length)])).toEqual([[2001, [2000]], [2000, [1, 2000]]])
    const enumerator = createOrderedOptionEnumerator(lattice, table, createEmptyPartialAssignment(table))
    const first = Array.from({ length: 4 }, () => keyOf(enumerator.next()!))
    // Σ increments 1, 2, 2, 3: the continuations' `none` lanes key below every operation, so the zero-Skill options come first.
    expect(first).toEqual(['target.huge|owned:g.skill|none|reset:10', 'target.huge|owned:g.skill|none|reset:11', 'target.huge|owned:g.bonus|reset_skills:8|none', 'target.huge|owned:g.skill|none|reset:12'])
    expect(enumerator.frontierSize).toBeLessThan(10)
  })
})

// ------------------------------------------------------------------------------------------------ lower bound and Theorem T

describe('A-2 lower bound and Theorem T (independent brute force)', () => {
  it('keeps LB(partial) admissible on every Target-order prefix, and the same value as under a1 (root included)', () => {
    let prefixes = 0
    for (const seed of SEEDS) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      const a1 = randomContinuationTable(seed, REACH_OPTION_SET_A1).table
      const menus = createTargetStreamMenus(table)
      const a1Menus = createTargetStreamMenus(a1)
      const complete = referenceAssignments(table, REACH_OPTION_SET_A2)
      // The true remaining minimum of every Target-order prefix of a complete assignment, in one pass.
      const best = new Map<string, { prefix: ReachOption[]; objective: number }>([['', { prefix: [], objective: Number.POSITIVE_INFINITY }]])
      for (const assignment of complete) {
        const objective = objectiveOf(assignment, table)
        for (let length = 0; length < table.targets.length; length++) {
          const prefix = assignment.slice(0, length)
          const key = prefix.map(keyOf).join('\n')
          const known = best.get(key)
          if (known === undefined || objective < known.objective) best.set(key, { prefix, objective })
        }
      }
      for (const [key, { prefix, objective }] of best) {
        const length = prefix.length
        let partial = createEmptyPartialAssignment(table)
        for (const option of prefix) partial = applyReachOption(partial, option)
        const bound = partialAssignmentLowerBound(partial, table.targets.slice(length).map(row => menus.get(row.targetWeaponId)!), table)
        expect(bound, `seed ${seed} prefix ${key}`).toBeLessThanOrEqual(objective)
        // The same function of the partial assignment under the a1 rule (the continuations lower no minimal end).
        expect(partialAssignmentLowerBound(partial, a1.targets.slice(length).map(row => a1Menus.get(row.targetWeaponId)!), a1)).toBe(bound)
        prefixes += 1
      }
      // The root bound (empty partial) of a1 and a2.
      expect(partialAssignmentLowerBound(createEmptyPartialAssignment(table), [...menus.values()], table))
        .toBe(partialAssignmentLowerBound(createEmptyPartialAssignment(a1), [...a1Menus.values()], a1))
    }
    expect(prefixes).toBeGreaterThan(1_000)
  })

  it('Theorem T: the structural optimum is the same with and without continuations, and P maps each continuation assignment to a cheaper-or-equal one without', () => {
    let withContinuation = 0
    let repairedCoverage = 0
    for (const seed of SEEDS) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      const rows = new Map(table.targets.map(row => [row.targetWeaponId, row]))
      const feasible = (options: ReachOption[]) => bruteCoverageFeasible(options, table)
      const full = referenceAssignments(table, REACH_OPTION_SET_A2).filter(feasible)
      const a1 = referenceAssignments(table, REACH_OPTION_SET_A1).filter(feasible)
      const plain = referenceAssignments(table, REACH_OPTION_SET_A2, (option, row) => !isContinuation(option, row)).filter(feasible)
      const optimum = (assignments: ReachOption[][]) => (assignments.length === 0 ? null : Math.min(...assignments.map(value => objectiveOf(value, table))))
      expect(optimum(full), `seed ${seed}`).toBe(optimum(plain))
      expect(optimum(full), `seed ${seed}`).toBe(optimum(a1))
      const legal = new Set(table.targets.flatMap(row => referenceOptions(row, table).filter(option => !isContinuation(option, row)).map(keyOf)))
      for (const assignment of full) {
        if (!assignment.some(option => isContinuation(option, rows.get(option.targetWeaponId)!))) continue
        withContinuation += 1
        const lowered = dominate(assignment, table)
        expect(lowered.map(option => option.source), `seed ${seed}`).toEqual(assignment.map(option => option.source))
        for (const option of lowered) {
          expect(legal.has(keyOf(option)), `seed ${seed}: ${keyOf(option)}`).toBe(true)
          expect(isContinuation(option, rows.get(option.targetWeaponId)!)).toBe(false)
        }
        expect(resourceValid(lowered), `seed ${seed}`).toBe(true)
        expect(bruteCoverageFeasible(lowered, table), `seed ${seed}`).toBe(true)
        expect(objectiveOf(lowered, table), `seed ${seed}`).toBeLessThanOrEqual(objectiveOf(assignment, table))
        // Count the cases where removing the continuations broke the Skill coverage and P had to lower a conversion.
        const afterL1 = assignment.map(option => {
          const lanes = continuationOf(option, rows.get(option.targetWeaponId)!)
          return referenceOption(rows.get(option.targetWeaponId)!, table, option.source, lanes.s2 ? NONE : option.skillRequired, lanes.bonus ? NONE : option.bonusRequired)
        })
        if (lowestUncoveredSkill(afterL1, table) !== null) repairedCoverage += 1
      }
    }
    expect(withContinuation).toBeGreaterThan(500)
    expect(repairedCoverage).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------------------------------------------ Phase C

describe('A-2 Phase C: coverage, C-1 option validation and the coverage-gated search', () => {
  it('accepts every a2 assignment and judges its coverage exactly like the independent predicate; rejects options outside the rule', () => {
    let infeasible = 0
    for (const seed of SEEDS.slice(0, 200)) {
      const { table } = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      for (const options of referenceAssignments(table, REACH_OPTION_SET_A2)) {
        const result = checkStreamCoverage(assignmentOf(table, options), table)
        expect(result.kind, `seed ${seed}`).not.toBe('invalid_input')
        expect(result.kind === 'feasible', `seed ${seed}`).toBe(bruteCoverageFeasible(options, table))
        if (result.kind === 'coverage_infeasible') infeasible += 1
      }
    }
    expect(infeasible).toBeGreaterThan(0)
  })

  it('validates each lane by the option set: continuations under a2 only, never none on a non-Ideal lane, never on a both-axis Ideal or protected source', () => {
    const spec = (optionSet: ReachOptionSetVersion, source: SourceCandidate) => handBuiltReachTable({ optionSet, targets: [{ id: 'target.a', sources: [source], skill: { idealPositions: [8, 10] } }] }).table
    const verdict = (optionSet: ReachOptionSetVersion, source: SourceCandidate, skill: SkillRequirement, bonus: BonusRequirement) => {
      const table = spec(optionSet, source)
      const result = checkStreamCoverage(assignmentOf(table, [optionOf(table, 'target.a', source, skill, bonus)]), table)
      return result.kind === 'invalid_input' ? `${result.reason}: ${result.detail}` : result.kind
    }
    const skillIdeal = gogmaSource('g.s', { currentSkillIdeal: true, layout: 'I' })
    const bonusIdeal = gogmaSource('g.b', { currentBonusIdeal: true, layout: 'I' })
    const both = gogmaSource('g.both', { currentSkillIdeal: true, currentBonusIdeal: true, layout: 'I' })
    const protectedBoth = gogmaSource('g.p', { currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true, layout: 'I' })
    // S2 continuation: a2 accepts, a1 refuses; none stays legal on the Ideal lane.
    expect(verdict(REACH_OPTION_SET_A2, skillIdeal, resetSkills(10), reset(12))).toBe('feasible')
    expect(verdict(REACH_OPTION_SET_A2, skillIdeal, NONE, reset(12))).toBe('feasible')
    expect(verdict(REACH_OPTION_SET_A1, skillIdeal, resetSkills(10), reset(12))).toMatch(/^invalid_option: .*needs Skill requirement none under global-assignment-reach-options:a1/)
    // B continuations (Reset, Keep, Reset -> Keep) under a2, refused under a1; a Bonus none on the Ideal lane stays legal.
    for (const bonus of [reset(12), keep(13), resetThenKeep(11, 13), NONE]) expect(verdict(REACH_OPTION_SET_A2, bonusIdeal, resetSkills(8), bonus), bonus.kind).toBe('feasible')
    expect(verdict(REACH_OPTION_SET_A1, bonusIdeal, resetSkills(8), keep(13))).toMatch(/^invalid_option: .*needs Bonus requirement none under global-assignment-reach-options:a1/)
    // none on a non-Ideal lane is never an option, under either set.
    for (const optionSet of [REACH_OPTION_SET_A1, REACH_OPTION_SET_A2]) {
      expect(verdict(optionSet, skillIdeal, NONE, NONE)).toMatch(/^invalid_option: .*Bonus requirement none needs an owned Gogma already Ideal/)
      expect(verdict(optionSet, bonusIdeal, NONE, NONE)).toMatch(/^invalid_option: .*needs Skill requirement reset_skills/)
    }
    // G4-iii: a source Ideal on both axes keeps none / none under a2 too; a protected source accepts no operation at all.
    expect(verdict(REACH_OPTION_SET_A2, both, NONE, NONE)).toBe('feasible')
    expect(verdict(REACH_OPTION_SET_A2, both, resetSkills(10), NONE)).toMatch(/^invalid_option: .*needs Skill requirement none under global-assignment-reach-options:a2/)
    expect(verdict(REACH_OPTION_SET_A2, both, NONE, reset(12))).toMatch(/^invalid_option: .*needs Bonus requirement none under global-assignment-reach-options:a2/)
    expect(verdict(REACH_OPTION_SET_A2, protectedBoth, NONE, reset(12))).toMatch(/^invalid_option: .*protected Gogma g\.p accepts no Skill or Bonus operation/)
    // The independent position and support checks still apply to a continuation.
    expect(verdict(REACH_OPTION_SET_A2, skillIdeal, resetSkills(11), reset(12))).toMatch(/^invalid_option: .*Reset Skills position 11 lies outside 7\.\.10/)
    expect(verdict(REACH_OPTION_SET_A2, { ...bonusIdeal, keepSupported: false } as SourceCandidate, resetSkills(8), keep(13))).toMatch(/^invalid_option: .*keep_from_source needs a Keep-supported source layout/)
    expect(verdict(REACH_OPTION_SET_A2, bonusIdeal, resetSkills(8), resetThenKeep(13, 13))).toMatch(/^invalid_option: .*reset_then_keep Reset position 13 lies outside 10\.\.12/)
    const table = spec(REACH_OPTION_SET_A2, bonusIdeal)
    const tampered = { ...optionOf(table, 'target.a', bonusIdeal, resetSkills(8), reset(12)), streamEnd: { skill: 9, gogma: 10, normal: { [COUNTER_A]: 4 } } }
    expect(checkStreamCoverage(assignmentOf(table, [tampered]), table)).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option', detail: expect.stringMatching(/streamEnd .* differs from the re-derived/) })
  })

  it('treats a current-Ideal Skill source that resets its Skills as a Skill coverer from the origin', () => {
    const { table } = handBuiltReachTable({
      optionSet: REACH_OPTION_SET_A2, originSkill: 7, window: { skill: 6, gogma: 6, normal: 3 },
      targets: [
        { id: 'target.a', sources: [gogmaSource('g.s', { currentSkillIdeal: true })], skill: { idealPositions: [12], resetSkillsLimit: 12, conversionLimit: 13 } },
        { id: 'target.b', sources: [normalSource('n.b')], skill: { idealPositions: [10], resetSkillsLimit: 12, conversionLimit: 13 } },
      ],
    })
    const options = [optionOf(table, 'target.a', gogmaSource('g.s', { currentSkillIdeal: true }), resetSkills(12), reset(12)), optionOf(table, 'target.b', normalSource('n.b'), conversion(10, 10), reset(14))]
    const result = checkStreamCoverage(assignmentOf(table, options), table)
    expect(result.kind).toBe('feasible')
    if (result.kind !== 'feasible') return
    // a's Reset Skills chain (a continuation of its Ideal Skills) holds 7 .. 9 before b converts at 10, and 11 after it.
    expect(result.coverage.find(value => value.stream.kind === 'skill')!.segments.map(segment => [segment.kind, segment.from, segment.to, segment.covererTargetWeaponId]))
      .toEqual([['chain', 7, 9, 'target.a'], ['required', 10, 10, 'target.b'], ['chain', 11, 11, 'target.a'], ['required', 12, 12, 'target.a']])
    // Without the continuation the Skill origin is uncovered.
    const withoutContinuation = [optionOf(table, 'target.a', gogmaSource('g.s', { currentSkillIdeal: true }), NONE, reset(12)), options[1]!]
    expect(checkStreamCoverage(assignmentOf(table, withoutContinuation), table).kind).toBe('coverage_infeasible')
  })

  it('finds exactly the reference coverage-feasible a2 assignments, deterministically, and never ends coverage_infeasible while a C1 / C2 assignment exists', () => {
    let nonTrivial = 0
    for (const seed of SEEDS.slice(0, 200)) {
      const built = randomContinuationTable(seed, REACH_OPTION_SET_A2)
      const reference = referenceAssignments(built.table, REACH_OPTION_SET_A2)
      const feasible = reference.filter(options => bruteCoverageFeasible(options, built.table)).map(options => options.map(keyOf).sort().join('\n')).sort()
      for (const coverageDrivenOrdering of [true, false]) {
        const run = () => {
          const result = collectCoverageFeasibleAssignments(built.table, built.planningTargets, { nodeBudget: 1_000_000, mrvLookahead: 8, coverageDrivenOrdering }, 1_000_000)
          expect(result.status, `seed ${seed}`).not.toBe('invalid_input')
          expect(result.status, `seed ${seed}`).not.toBe('search_incomplete')
          return { status: result.status, candidates: 'candidates' in result ? result.candidates : [] }
        }
        const first = run()
        const sequence = (candidates: typeof first.candidates) => candidates.map(candidate => [...candidate.assignment.chosen.values()].map(keyOf))
        const keys = sequence(first.candidates).map(options => [...options].sort().join('\n'))
        expect(new Set(keys).size).toBe(keys.length)
        expect([...keys].sort(), `seed ${seed}`).toEqual(feasible)
        expect(JSON.stringify(sequence(run().candidates))).toBe(JSON.stringify(sequence(first.candidates)))
        if (reference.length > 0) expect(first.status, `seed ${seed}`).toBe('candidates_found')
        // Every delivered candidate holds C1 / C2 and is coverage-feasible by the Phase C-1 check too.
        for (const candidate of first.candidates) expect(checkStreamCoverage(candidate.assignment, built.table).kind).toBe('feasible')
      }
      if (feasible.length > 0 && feasible.length < reference.length) nonTrivial += 1
    }
    expect(nonTrivial).toBeGreaterThan(5)
  })
})

// The factory is the one Phase A path: the reference options are structurally the factory's options.
describe('A-2 option factory', () => {
  it('builds the same option object as the reference for a continuation', () => {
    const { table } = handBuiltReachTable({ optionSet: REACH_OPTION_SET_A2, targets: [{ id: 'target.a', sources: [gogmaSource('g', { currentSkillIdeal: true })] }] })
    const row = table.targets[0]!
    expect(createReachOption(row, table, row.sources[0]!, resetSkills(10), reset(12))).toEqual(referenceOption(row, table, row.sources[0]!, resetSkills(10), reset(12)))
  })
})
