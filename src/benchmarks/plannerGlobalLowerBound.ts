/**
 * Issue #154 Phase 2-A.5 (Research only): a lower bound on the physical operation count of any
 * Production Plan that completes every planning Target of one PlannerInput. Never import from
 * Production. It knows no Target ID, Counter position or oracle Route: every value is derived from the
 * given input and the given RNG Engine.
 *
 * The bound is a relaxation of the Production operation semantics (see `LOWER_BOUND_ASSUMPTIONS`):
 * each physical operation advances exactly one of the Skill / Gogma / per-weapon-type Normal Counters
 * by exactly one, so the physical operation count of a Plan equals
 * `(S_final - S_origin) + (G_final - G_origin) + Σ_w (N_w_final - N_w_origin)`. For every Target this
 * module collects which final Counter thresholds would let that Target, on its own, reach its Ideal
 * from one source (an existing OwnedWeapon or a new Normal at one position), and then minimises the
 * sum over threshold vectors under which every Target has such an option with pairwise distinct
 * sources (bipartite matching per weapon type).
 *
 * Pairwise distinct sources are NOT a general Production constraint: the Production Planner has cross
 * satisfaction (one completed weapon that also meets another Target's Ideal releases that Target's
 * Entry, `released` / `candidate_already_satisfied`). The distinct-source requirement holds for one
 * PlannerInput only when no weapon state can meet the Ideal of two of its planning Targets, which
 * `auditCrossSatisfaction()` checks with the Production evaluators before any bound is claimed. With
 * that precondition met, the relaxation drops only Counter position exclusivity, cross-stream order and
 * Route shape, so its minimum is lower than or equal to the true optimum; without it
 * `solveLowerBoundRelaxation()` fails closed (`not_applicable`) and claims no bound.
 */
import { keepFamilyLayout } from '../domain/rng/gogmaBonusFamily'
import { isTargetWeaponPlanningEligible } from '../domain/models/domainRules'
import type { OwnedWeapon, RestorationBonusSet, TargetWeapon } from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { NormalizedSeed, RngEngine, RngMasterSubset } from '../domain/rng/rngEngine'
import { satisfiesIdealBonuses, satisfiesIdealTarget } from '../domain/target/targetEvaluator'
import { evaluateSkillCondition } from '../domain/target/skillConditionEvaluator'

export const LOWER_BOUND_ASSUMPTIONS = [
  'Every physical operation advances exactly one Counter by exactly one: create_normal_artian (count c) advances its weapon type Normal Counter by c = c physical forges, convert_normal_to_gogma and reset_skills advance the Skill Counter, reset_bonuses and keep_bonuses advance the Gogma Counter (RngEngine advance functions). confirm_owned_ideal advances nothing and is not a physical operation.',
  'Counters never decrease and advance only through physical operations, so the physical operation count equals the sum of the Counter advances.',
  'Precondition checked per PlannerInput, not a general Production rule: auditCrossSatisfaction() finds no pair of planning Targets that one weapon state can satisfy together (Production has cross satisfaction; with such a pair the bound is not applicable). Then every planning Target needs its own completed weapon, because an Ideal completion protects its weapon so it never changes again, and each weapon comes from exactly one source: an existing compatible OwnedWeapon (same weapon type and element; unprotected, or protected and already Ideal with no operation) or a new rarity-8 Normal Artian forged at its own Normal Counter position of its weapon type and converted. Hence the sources are pairwise distinct.',
  'A completed weapon holds the Ideal restoration bonuses (gogma_artian scope, exact multiset) and the Ideal Skill condition.',
  'Final Skills: an existing Gogma may keep its current Skills; otherwise the last Skill operation (conversion or Reset Skills, which draw the same Skills at the same Skill position) is at a position p whose prediction satisfies the Ideal Skill condition.',
  'Final bonuses: an existing Gogma may keep its current bonuses; otherwise the last bonus operation at Gogma position g is a Reset whose result is Ideal, or a Keep whose result is Ideal for the family layout it reads: the source layout (no earlier Reset) or the layout of a Reset at an earlier position g1 (Keep preserves the slot family layout).',
  'A Keep result depends only on the Seed, weapon type, element, Gogma position and the ordered family layout of the current slots (Production Keep reads families only).',
  'Unsupported predictions (Engine support query) are not Production operations and give no option.',
] as const

export interface LowerBoundOption {
  /** `owned:<OwnedWeaponId>` or `normal:<weaponTypeId>:<position>`; one resource completes one Target. */
  resource: string
  /** Final Skill Counter the option needs (origin when no Skill operation is needed). */
  skillThreshold: number
  /** Final Gogma Counter the option needs (origin when no bonus operation is needed). */
  gogmaThreshold: number
  /** Final Normal Counter of the Target's weapon type the option needs, or null for an existing weapon. */
  normalThreshold: number | null
}

export interface LowerBoundTargetOptions {
  targetWeaponId: string
  weaponTypeId: string
  elementId: string
  firstIdealSkillPosition: number | null
  firstIdealResetPosition: number | null
  options: LowerBoundOption[]
}

/** One weapon state that meets the Ideal of both Targets of a pair (Production evaluators). */
export interface CrossSatisfactionPair {
  targetWeaponIds: [string, string]
  witness: { bonusesOfTargetWeaponId: string; seriesSkillId: string | null; groupSkillId: string | null }
}

export interface CrossSatisfactionAudit {
  planningTargetCount: number
  /** Pairs of planning Targets with the same weapon type and element (the only ones one weapon can serve). */
  sameWeaponTypeAndElementPairCount: number
  /** Largest number of Skill states tried per pair: the given Series / Group IDs, both conditions' own IDs, and null. */
  skillStateCandidates: { series: number; group: number }
  possiblePairCount: number
  possiblePairs: CrossSatisfactionPair[]
}

export interface SkillStateCandidates {
  seriesSkillIds: readonly string[]
  groupSkillIds: readonly string[]
}

type SeriesSkillIdValue = TargetWeapon['idealSkillCondition']['seriesSkillId']
type GroupSkillIdValue = TargetWeapon['idealSkillCondition']['groupSkillId']

/**
 * Pairs of planning Targets that one completed weapon state could satisfy together, judged only with the
 * Production authorities: a weapon serves a Target only with the same weapon type and element
 * (`deriveTargetSatisfaction()`), and `satisfiesIdealTarget()` decides Ideal (it delegates to
 * `satisfiesIdealBonuses()` and `evaluateSkillCondition()`). No Bonus or Skill inclusion rule is
 * re-implemented. Candidate bonus states are both Targets' own Ideal sets in `gogma_artian` scope (a
 * state meeting a Target's Ideal is, under that authority, that Target's Ideal set); candidate Skill
 * states are every combination of the given Master Series / Group IDs, the IDs both conditions name,
 * and null.
 */
export function auditCrossSatisfaction(input: PlannerInput, skills: SkillStateCandidates): CrossSatisfactionAudit {
  const planning = input.targetWeapons.filter(isTargetWeaponPlanningEligible).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const possiblePairs: CrossSatisfactionPair[] = []
  let sameWeaponTypeAndElementPairCount = 0
  const counts = { series: 0, group: 0 }
  for (let i = 0; i < planning.length; i++) {
    for (let j = i + 1; j < planning.length; j++) {
      const a = planning[i]!, b = planning[j]!
      if (a.weaponTypeId !== b.weaponTypeId || a.elementId !== b.elementId) continue
      sameWeaponTypeAndElementPairCount += 1
      const series = [...new Set<string | null>([null, ...skills.seriesSkillIds, a.idealSkillCondition.seriesSkillId, b.idealSkillCondition.seriesSkillId])]
      const group = [...new Set<string | null>([null, ...skills.groupSkillIds, a.idealSkillCondition.groupSkillId, b.idealSkillCondition.groupSkillId])]
      counts.series = Math.max(counts.series, series.length)
      counts.group = Math.max(counts.group, group.length)
      const witness = findCrossSatisfactionWitness(input, a, b, series, group)
      if (witness) possiblePairs.push({ targetWeaponIds: [a.id, b.id], witness })
    }
  }
  return { planningTargetCount: planning.length, sameWeaponTypeAndElementPairCount, skillStateCandidates: counts,
    possiblePairCount: possiblePairs.length, possiblePairs }
}

function findCrossSatisfactionWitness(input: PlannerInput, a: TargetWeapon, b: TargetWeapon,
  series: readonly (string | null)[], group: readonly (string | null)[]): CrossSatisfactionPair['witness'] | null {
  for (const bonusesOf of [a, b]) {
    for (const seriesSkillId of series) {
      for (const groupSkillId of group) {
        const satisfies = (target: TargetWeapon) => satisfiesIdealTarget(target, bonusesOf.idealBonuses, 'gogma_artian',
          seriesSkillId as SeriesSkillIdValue, groupSkillId as GroupSkillIdValue, input.master)
        if (satisfies(a) && satisfies(b)) return { bonusesOfTargetWeaponId: bonusesOf.id, seriesSkillId, groupSkillId }
      }
    }
  }
  return null
}

export interface LowerBoundProblem {
  /** Only thresholds whose total stays below `budget` were scanned; see `solveLowerBoundRelaxation()`. */
  budget: number
  /** The distinct-source precondition; the bound is claimed only when it has no possible pair. */
  crossSatisfaction: CrossSatisfactionAudit
  skillOrigin: number
  gogmaOrigin: number
  normalOrigins: Record<string, number>
  targets: LowerBoundTargetOptions[]
}

export class LowerBoundUnsupportedInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LowerBoundUnsupportedInputError'
  }
}

function layoutKey(bonuses: RestorationBonusSet, master: PlannerInput['master']): string {
  return keepFamilyLayout(bonuses, master).join('\u0000')
}

/** Distinct ordered family layouts of the Ideal multiset, each with a representative five-slot set. */
function idealLayouts(target: TargetWeapon, master: PlannerInput['master']): Map<string, RestorationBonusSet> {
  const layouts = new Map<string, RestorationBonusSet>()
  const permute = (rest: RestorationBonusSet[number][], acc: RestorationBonusSet[number][]) => {
    if (rest.length === 0) {
      const set = acc as RestorationBonusSet
      const key = layoutKey(set, master)
      if (!layouts.has(key)) layouts.set(key, set)
      return
    }
    rest.forEach((bonus, index) => permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...acc, bonus]))
  }
  permute([...target.idealBonuses], [])
  return layouts
}

/**
 * Collects every per-Target option whose thresholds each stay below `origin + budget`. A solution of
 * total `< budget` has every stream advance `< budget`, so no option outside this box can take part in
 * such a solution; that is what makes the bounded scan exhaustive for the `< budget` question.
 */
export function collectLowerBoundProblem(input: PlannerInput, engine: RngEngine, budget: number, skills: SkillStateCandidates): LowerBoundProblem {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError('Lower bound budget must be a positive integer.')
  const crossSatisfaction = auditCrossSatisfaction(input, skills)
  const master = input.master as unknown as RngMasterSubset & PlannerInput['master']
  const { baseSeed, skillCounter, gogmaCounter } = input.rngState
  if (!baseSeed.isConfirmed || baseSeed.value === null || !skillCounter.isConfirmed || skillCounter.value === null
    || !gogmaCounter.isConfirmed || gogmaCounter.value === null) {
    throw new LowerBoundUnsupportedInputError('The lower bound needs a confirmed Base Seed, Skill Counter and Gogma Counter.')
  }
  // The persisted Base Seed is already normalized; the Domain passes it to the Engine as is.
  const seed = baseSeed.value as NormalizedSeed
  const skillOrigin = skillCounter.value, gogmaOrigin = gogmaCounter.value
  const normalOrigins: Record<string, number> = {}
  const targets: LowerBoundTargetOptions[] = []
  for (const target of input.targetWeapons.filter(isTargetWeaponPlanningEligible)) {
    const { weaponTypeId, elementId } = target
    const counter = input.normalCounters.find(value => value.weaponTypeId === weaponTypeId && value.rarity === 8)
    // An unconfirmed Normal Counter would need the blind variant, whose forge count is not a Counter
    // threshold; fail closed instead of guessing a bound.
    if (!counter || !counter.isConfirmed || counter.counter === null) {
      throw new LowerBoundUnsupportedInputError(`No confirmed rarity-8 Normal Counter for ${weaponTypeId}.`)
    }
    normalOrigins[weaponTypeId] = counter.counter

    let firstIdealSkillPosition: number | null = null
    if (engine.getPredictionSupport({ type: 'skill', weaponTypeId, elementId }).supported) {
      for (let position = skillOrigin; position < skillOrigin + budget; position++) {
        const skills = engine.predictSkills({ baseSeed: seed, skillCounter: position, weaponTypeId, elementId, master })
        if (evaluateSkillCondition(target.idealSkillCondition, skills.seriesSkillId, skills.groupSkillId)) { firstIdealSkillPosition = position; break }
      }
    }

    // Gogma: first Keep-Ideal position per ordered family layout, first Reset-Ideal position, and first
    // position of a Keep that is Ideal from the layout of an earlier Reset.
    const layouts = idealLayouts(target, master)
    const keepFirst = new Map<string, number>()
    const resetLayoutsSeen = new Set<string>()
    let firstIdealResetPosition: number | null = null, firstResetThenKeep: number | null = null
    const resetSupported = engine.getPredictionSupport({ type: 'gogma_reset', weaponTypeId, elementId, master }).supported
    const keepLayouts = [...layouts].filter(([, current]) =>
      engine.getPredictionSupport({ type: 'gogma_keep', weaponTypeId, elementId, currentBonuses: current, master }).supported)
    for (let position = gogmaOrigin; position < gogmaOrigin + budget; position++) {
      for (const [key, current] of keepLayouts) {
        const result = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'keep_bonuses', currentBonuses: current }, master })
        if (!satisfiesIdealBonuses(target, result, 'gogma_artian', master)) continue
        if (!keepFirst.has(key)) keepFirst.set(key, position)
        if (firstResetThenKeep === null && resetLayoutsSeen.has(key)) firstResetThenKeep = position
      }
      if (resetSupported) {
        const result = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master })
        if (firstIdealResetPosition === null && satisfiesIdealBonuses(target, result, 'gogma_artian', master)) firstIdealResetPosition = position
        resetLayoutsSeen.add(layoutKey(result, master))
      }
    }
    const sourceIndependent = [firstIdealResetPosition, firstResetThenKeep].filter((value): value is number => value !== null)
    const lastBonusPosition = (layout: string): number | null => {
      const values = [...sourceIndependent, keepFirst.get(layout)].filter((value): value is number => value !== undefined)
      return values.length === 0 ? null : Math.min(...values)
    }
    const skillNeeded = firstIdealSkillPosition === null ? null : firstIdealSkillPosition + 1

    const options: LowerBoundOption[] = []
    for (const weapon of input.ownedWeapons.filter(value => value.weaponTypeId === weaponTypeId && value.elementId === elementId)) {
      const option = ownedWeaponOption(target, weapon, master, skillOrigin, gogmaOrigin, skillNeeded, lastBonusPosition)
      if (option) options.push(option)
    }
    if (engine.getPredictionSupport({ type: 'normal_artian', weaponTypeId, elementId, rarity: 8 }).supported && skillNeeded !== null) {
      for (let position = counter.counter; position < counter.counter + budget; position++) {
        const bonuses = engine.predictNormalArtian({ baseSeed: seed, weaponTypeId, elementId, rarity: 8, normalCounter: position, master })
        const last = lastBonusPosition(layoutKey(bonuses, master))
        if (last === null) continue
        options.push({ resource: `normal:${weaponTypeId}:${position}`, skillThreshold: skillNeeded, gogmaThreshold: last + 1, normalThreshold: position + 1 })
      }
    }
    targets.push({ targetWeaponId: target.id, weaponTypeId, elementId, firstIdealSkillPosition, firstIdealResetPosition, options })
  }
  return { budget, crossSatisfaction, skillOrigin, gogmaOrigin, normalOrigins, targets }
}

function ownedWeaponOption(target: TargetWeapon, weapon: OwnedWeapon, master: PlannerInput['master'], skillOrigin: number, gogmaOrigin: number,
  skillNeeded: number | null, lastBonusPosition: (layout: string) => number | null): LowerBoundOption | null {
  const resource = `owned:${weapon.id}`
  if (weapon.kind === 'normal') {
    // Conversion consumes the Normal and draws Skills; a protected Normal is never converted.
    if (weapon.isProtected || skillNeeded === null) return null
    const last = lastBonusPosition(layoutKey(weapon.restorationBonuses, master))
    return last === null ? null : { resource, skillThreshold: skillNeeded, gogmaThreshold: last + 1, normalThreshold: null }
  }
  const skillIdeal = evaluateSkillCondition(target.idealSkillCondition, weapon.seriesSkillId, weapon.groupSkillId)
  const bonusIdeal = satisfiesIdealBonuses(target, weapon.restorationBonuses, weapon.restorationBonusScope, master)
  if (skillIdeal && bonusIdeal) return { resource, skillThreshold: skillOrigin, gogmaThreshold: gogmaOrigin, normalThreshold: null }
  if (weapon.isProtected) return null
  const skillThreshold = skillIdeal ? skillOrigin : skillNeeded
  const last = bonusIdeal ? gogmaOrigin - 1 : lastBonusPosition(layoutKey(weapon.restorationBonuses, master))
  if (skillThreshold === null || last === null) return null
  return { resource, skillThreshold, gogmaThreshold: last + 1, normalThreshold: null }
}

export interface LowerBoundThresholds {
  skill: number
  gogma: number
  normal: Record<string, number>
}

export interface LowerBoundRelaxationResult {
  /**
   * `found`: `minimum` is the relaxation minimum, and it is `< budget`, or equals the smallest total the
   * scanned box can prove (see `provenAtLeast`). `none_below_budget`: no threshold vector of total
   * `< budget` is feasible, so every Plan needs at least `budget` physical operations.
   * `not_applicable`: the input has a cross-satisfaction pair, so pairwise distinct sources are not
   * proven and no bound is claimed.
   */
  status: 'found' | 'none_below_budget' | 'not_applicable'
  /** A valid lower bound on every Plan's physical operation count (under the assumptions), or null. */
  provenAtLeast: number | null
  /** The minimising thresholds when one was found inside the box. */
  minimum: { total: number; thresholds: LowerBoundThresholds; advances: { skill: number; gogma: number; normal: Record<string, number> } } | null
  /** Targets without any option inside the box (each alone forces a total `>= budget`). */
  targetsWithoutOption: string[]
  /**
   * With `recordAbove > 0`: the best feasible total per scanned `(skill, gogma)` pair up to
   * `budget + recordAbove`, cheapest first (at most 10), to show the trade-off around the minimum.
   * Recording raises the scan limit only for this list; `provenAtLeast` still reads `budget`. Options
   * outside the collected box are absent, so a row at or above `budget` is a view of the box only.
   */
  nearMinimum: { total: number; skill: number; gogma: number; normal: Record<string, number> }[]
}

function matchable(targets: readonly LowerBoundTargetOptions[], skill: number, gogma: number, normal: number): boolean {
  const adjacency = targets.map(target => target.options
    .filter(option => option.skillThreshold <= skill && option.gogmaThreshold <= gogma && (option.normalThreshold === null || option.normalThreshold <= normal))
    .map(option => option.resource))
  const owner = new Map<string, number>()
  const augment = (index: number, seen: Set<string>): boolean => {
    for (const resource of adjacency[index]!) {
      if (seen.has(resource)) continue
      seen.add(resource)
      const current = owner.get(resource)
      if (current === undefined || augment(current, seen)) { owner.set(resource, index); return true }
    }
    return false
  }
  return adjacency.every((_, index) => augment(index, new Set()))
}

/**
 * Minimises `(S - S0) + (G - G0) + Σ_w (N_w - N_w0)` over the threshold vectors inside the scanned box
 * under which every Target keeps an option with distinct resources. Only option threshold values need
 * to be tried (the feasibility changes only there), and a larger threshold never removes an option, so
 * `N_w` is the smallest feasible value found by binary search for each `(S, G)`.
 */
export function solveLowerBoundRelaxation(problem: LowerBoundProblem, options: { recordAbove?: number } = {}): LowerBoundRelaxationResult {
  const { budget, skillOrigin, gogmaOrigin, normalOrigins, targets } = problem
  const recordAbove = options.recordAbove ?? 0
  const limit = budget + recordAbove
  const nearMinimum: LowerBoundRelaxationResult['nearMinimum'] = []
  // Fail closed: without the distinct-source precondition the matching below proves nothing.
  if (problem.crossSatisfaction.possiblePairCount > 0) return { status: 'not_applicable', provenAtLeast: null, minimum: null, targetsWithoutOption: [], nearMinimum }
  const targetsWithoutOption = targets.filter(target => target.options.length === 0).map(target => target.targetWeaponId)
  if (targetsWithoutOption.length > 0) return { status: 'none_below_budget', provenAtLeast: budget, minimum: null, targetsWithoutOption, nearMinimum }
  const byType = new Map<string, LowerBoundTargetOptions[]>()
  for (const target of targets) byType.set(target.weaponTypeId, [...(byType.get(target.weaponTypeId) ?? []), target])
  const values = (pick: (option: LowerBoundOption) => number) => [...new Set(targets.flatMap(target => target.options.map(pick)))].sort((a, b) => a - b)
  // Every Target needs one option, so each threshold is at least the largest per-Target minimum.
  const skillFloor = Math.max(skillOrigin, ...targets.map(target => Math.min(...target.options.map(option => option.skillThreshold))))
  const gogmaFloor = Math.max(gogmaOrigin, ...targets.map(target => Math.min(...target.options.map(option => option.gogmaThreshold))))
  let best: LowerBoundRelaxationResult['minimum'] = null
  for (const skill of values(option => option.skillThreshold).filter(value => value >= skillFloor)) {
    for (const gogma of values(option => option.gogmaThreshold).filter(value => value >= gogmaFloor)) {
      let total = (skill - skillOrigin) + (gogma - gogmaOrigin)
      if (total >= limit || (recordAbove === 0 && best && total >= best.total)) break
      const normal: Record<string, number> = {}
      let feasible = true
      for (const [weaponTypeId, group] of byType) {
        const origin = normalOrigins[weaponTypeId]!
        let low = origin, high = origin + budget
        if (!matchable(group, skill, gogma, high)) { feasible = false; break }
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (matchable(group, skill, gogma, middle)) high = middle
          else low = middle + 1
        }
        normal[weaponTypeId] = low
        total += low - origin
      }
      if (!feasible || total >= limit) continue
      if (recordAbove > 0) nearMinimum.push({ total, skill, gogma, normal: Object.fromEntries(Object.entries(normal).map(([id, value]) => [id, value - normalOrigins[id]!])) })
      if (total >= budget || (best && total >= best.total)) continue
      best = { total, thresholds: { skill, gogma, normal },
        advances: { skill: skill - skillOrigin, gogma: gogma - gogmaOrigin,
          normal: Object.fromEntries(Object.entries(normal).map(([id, value]) => [id, value - normalOrigins[id]!])) } }
    }
  }
  nearMinimum.sort((a, b) => a.total - b.total || a.gogma - b.gogma || a.skill - b.skill)
  nearMinimum.splice(10)
  return best
    ? { status: 'found', provenAtLeast: best.total, minimum: best, targetsWithoutOption, nearMinimum }
    : { status: 'none_below_budget', provenAtLeast: budget, minimum: null, targetsWithoutOption, nearMinimum }
}

/**
 * The total a relaxation result proves as an exact minimum, or null. Only `found` names one; a
 * `not_applicable` result (cross satisfaction possible) and `none_below_budget` never do.
 */
export function provenLowerBoundTotal(result: LowerBoundRelaxationResult): number | null {
  return result.status === 'found' && result.minimum !== null ? result.minimum.total : null
}

/**
 * Single-stream bounds for the audit narrative. Each is the smallest advance of that stream alone over
 * all options inside the box, so it holds for every Plan of total `< budget` (and trivially otherwise
 * only when it is `< budget`). They are NOT added together: the joint bound is
 * `solveLowerBoundRelaxation()`.
 */
export function singleStreamLowerBounds(problem: LowerBoundProblem) {
  // Its Normal part uses the same distinct-source matching, so it fails closed the same way.
  if (problem.crossSatisfaction.possiblePairCount > 0) return null
  const { skillOrigin, gogmaOrigin, normalOrigins, targets } = problem
  const skillWitness = [...targets].sort((a, b) => Math.min(...b.options.map(o => o.skillThreshold)) - Math.min(...a.options.map(o => o.skillThreshold)))[0]
  const gogmaWitness = [...targets].sort((a, b) => Math.min(...b.options.map(o => o.gogmaThreshold)) - Math.min(...a.options.map(o => o.gogmaThreshold)))[0]
  const normal: Record<string, number> = {}
  const byType = new Map<string, LowerBoundTargetOptions[]>()
  for (const target of targets) byType.set(target.weaponTypeId, [...(byType.get(target.weaponTypeId) ?? []), target])
  for (const [weaponTypeId, group] of byType) {
    const origin = normalOrigins[weaponTypeId]!
    let low = origin, high = origin + problem.budget
    const huge = Number.MAX_SAFE_INTEGER
    if (!matchable(group, huge, huge, high)) { normal[weaponTypeId] = problem.budget; continue }
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (matchable(group, huge, huge, middle)) high = middle
      else low = middle + 1
    }
    normal[weaponTypeId] = low - origin
  }
  return {
    skill: { advance: skillWitness ? Math.min(...skillWitness.options.map(o => o.skillThreshold)) - skillOrigin : 0, witnessTargetId: skillWitness?.targetWeaponId ?? null },
    gogma: { advance: gogmaWitness ? Math.min(...gogmaWitness.options.map(o => o.gogmaThreshold)) - gogmaOrigin : 0, witnessTargetId: gogmaWitness?.targetWeaponId ?? null },
    normal,
  }
}
