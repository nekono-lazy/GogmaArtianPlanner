import { describe, expect, it } from 'vitest'
import type { BuildRoute, OwnedWeapon, OwnedWeaponId, RestorationBonusSet, RouteOperation, WeaponTypeId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { createPlannerRouteUnitPlans } from '../../domain/planner/plannerRouteProgress'
import type { NormalizedSeed } from '../../domain/rng/rngEngine'
import { satisfiesIdealTarget } from '../../domain/target/targetEvaluator'
import { plannerEngine, routeEntry, target as beamTarget } from '../../test/fixtures/plannerBeam'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { collectResourceAssignments, createResourceAssignmentSearch } from './assignmentSolver'
import type { ResourceAssignmentCandidate, ResourceAssignmentSearchRequest } from './assignmentTypes'
import { createGlobalAssignmentContext } from './context'
import { assignmentOf, conversion, keep, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import type { ExpectedRouteShape, StructuralCandidate, StructuralCandidateResult } from './coverageTypes'
import { createReachOption, enumerateReachOptions, reachOptionKey } from './reachOptions'
import { buildReachTable } from './reachTable'
import { replayReachOptionRequiredOnly } from './requiredOnlyReplay'
import { buildStructuralCandidate } from './structuralCandidate'
import {
  createGlobalAssignmentFixture, createTableEngine, FIXTURE_NORMAL_COUNTER_ID, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks,
  OTHER_FAMILIES, ownedGogma, ownedNormal,
} from './testFixture'
import { GlobalAssignmentInvariantError, REACH_OPTION_SET_A1, type BonusRequirement, type ReachOption, type ReachTable, type SkillRequirement, type SourceCandidate } from './types'

/*
 * Issue #154 Global Assignment Phase C-1 (design 4.4 / 8.2 / 8.3 / 13.1 Phase C): structural candidates
 * built from resource assignments of a real Phase 0 context and a Phase A ReachTable over a
 * deterministic table Engine. The required-only replay is the one final-state authority; the chain
 * shapes are checked against it (a full replay including every chain unit) and against the Production
 * skip authority `createPlannerRouteUnitPlans()`. No oracle, no Search, no Planner run.
 */
const SERIES_A = 'series_skill.fixture.a'
const WINDOW = { skill: 4, gogma: 6, normal: 3 }
/** The Ideal families in another slot order, low tiers, `gogma_artian` (an Ideal-permutation Reset result). */
const REORDERED_GOGMA: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
  { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]
const G1 = 'owned.g1'
const N1 = 'owned.n1'

interface ScenarioSpec {
  skillIdeal: number[]
  resetIdeal: number[]
  keepIdeal: number[]
  /** G1's current Skills are already Ideal, so nobody holds a Gogma weapon in the Skill stream before a conversion. */
  g1SkillIdeal?: boolean
}

/**
 * Targets a / c (weapon a, element a) and b (element b) of one weapon type, the owned Gogma G1 (element
 * a, not Ideal), the owned Normal N1 (element b, an Ideal-permutation layout), Skill origin 7, Gogma
 * origin 10, Normal origin 4. Reset at 11 gives an Ideal-permutation layout; `resetIdeal` positions give
 * the Ideal; Keep at `keepIdeal` rerolls every tier to the Ideal's, elsewhere to low (families kept).
 */
async function scenario(spec: ScenarioSpec) {
  const table = createTableEngine({
    skill: position => ({ seriesSkillId: spec.skillIdeal.includes(position) ? SERIES_A : 'series_skill.fixture.other', groupSkillId: null }),
    reset: position => spec.resetIdeal.includes(position) ? structuredClone(IDEAL_BONUSES) : position === 11 ? structuredClone(REORDERED_GOGMA) : structuredClone(OTHER_FAMILIES),
    keep: (position, current) => spec.keepIdeal.includes(position) ? keepToIdealRanks(current) : keepToLowRanks(current),
  })
  const fixture = await createGlobalAssignmentFixture({ sameElementTarget: true })
  const owned: OwnedWeapon[] = [ownedGogma(G1, spec.g1SkillIdeal ? { seriesSkillId: SERIES_A } : {}), ownedNormal(N1, { elementId: 'element.fixture.b', restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) })]
  const input: PlannerInput = { ...fixture.input, ownedWeapons: owned }
  const created = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (created.kind !== 'context') throw new Error(created.detail)
  const reach = await buildReachTable(created.context, table.engine, WINDOW, REACH_OPTION_SET_A1)
  if (reach.kind !== 'reach_table') throw new Error(JSON.stringify(reach))
  const context = created.context
  const ids = { a: fixture.targets.a.id, b: fixture.targets.b.id, c: fixture.targets.c!.id }
  const sourceOf = (id: string, match: (source: SourceCandidate) => boolean) => {
    const found = reach.table.targets.find(row => row.targetWeaponId === id)!.sources.find(match)
    if (!found) throw new Error(`No such source for ${id}`)
    return found
  }
  const owns = (weapon: string) => (source: SourceCandidate) => source.kind !== 'new_normal' && source.ownedWeaponId === weapon
  const forge = (position: number) => (source: SourceCandidate) => source.kind === 'new_normal' && source.position === position
  /** One option of a planning Target, which the Phase A enumeration must also offer. */
  const optionOf = (id: string, match: (source: SourceCandidate) => boolean, skill: SkillRequirement, bonus: BonusRequirement): ReachOption => {
    const row = reach.table.targets.find(value => value.targetWeaponId === id)!
    const value = createReachOption(row, reach.table, sourceOf(id, match), skill, bonus)
    expect([...enumerateReachOptions(row, reach.table)].map(reachOptionKey)).toContain(reachOptionKey(value))
    return value
  }
  const build = (assignment: ResourceAssignmentCandidate) => buildStructuralCandidate(assignment, { table: reach.table, context, engine: table.engine })
  return { table, reach: reach.table, context, input, ids, owns, forge, optionOf, build }
}

type Scenario = Awaited<ReturnType<typeof scenario>>

function structural(result: StructuralCandidateResult): StructuralCandidate {
  if (result.kind !== 'structural_candidate') throw new Error(`expected a structural candidate, got ${JSON.stringify(result)}`)
  return result.candidate
}

const shapeOf = (candidate: StructuralCandidate, id: string) => candidate.expectedShapes.find(shape => shape.targetWeaponId === id)!

/** S2: a holds Skill 7 for both conversions; a's Reset -> Keep, b's Keep and c's Reset share the Gogma stream; c forges Normal 4..5. */
async function s2(cReset = 12) {
  const scene = await scenario({ skillIdeal: [8, 9, 10], resetIdeal: [12, 14], keepIdeal: [13, 15] })
  const options = [
    scene.optionOf(scene.ids.a, scene.owns(G1), resetSkills(10), resetThenKeep(11, 15)),
    scene.optionOf(scene.ids.b, scene.owns(N1), conversion(9, 9), keep(13)),
    scene.optionOf(scene.ids.c, scene.forge(5), conversion(8, 8), reset(cReset)),
  ]
  return { scene, options, assignment: assignmentOf(scene.reach, options, 7) }
}

type Step = { lane: 'normal' | 'skill' | 'gogma'; position: number; operation: 'create_normal_artian' | 'convert_normal_to_gogma' | 'reset_bonuses' | 'keep_bonuses' | 'reset_skills'; chain: boolean }

/** Every unit the shape predicts for its Target (required units plus chain units), per lane in position order. */
function stepsOf(shape: ExpectedRouteShape): Step[] {
  const steps: Step[] = []
  const { option } = shape
  for (const segment of shape.predicted.chainSegments) {
    for (let position = segment.from; position <= segment.to; position++) steps.push({ lane: segment.stream.kind, position, operation: segment.operation, chain: true })
  }
  if (shape.match.required.normal) steps.push({ lane: 'normal', position: shape.match.required.normal.position, operation: 'create_normal_artian', chain: false })
  if (option.skillRequired.kind === 'conversion') {
    steps.push({ lane: 'skill', position: option.skillRequired.conversionPosition, operation: 'convert_normal_to_gogma', chain: false })
    if (option.skillRequired.finalPosition !== option.skillRequired.conversionPosition) steps.push({ lane: 'skill', position: option.skillRequired.finalPosition, operation: 'reset_skills', chain: false })
  } else if (option.skillRequired.kind === 'reset_skills') {
    steps.push({ lane: 'skill', position: option.skillRequired.finalPosition, operation: 'reset_skills', chain: false })
  }
  const bonus = option.bonusRequired
  if (bonus.kind === 'reset') steps.push({ lane: 'gogma', position: bonus.finalPosition, operation: 'reset_bonuses', chain: false })
  if (bonus.kind === 'keep_from_source') steps.push({ lane: 'gogma', position: bonus.finalPosition, operation: 'keep_bonuses', chain: false })
  if (bonus.kind === 'reset_then_keep') {
    steps.push({ lane: 'gogma', position: bonus.resetPosition, operation: 'reset_bonuses', chain: false })
    steps.push({ lane: 'gogma', position: bonus.finalPosition, operation: 'keep_bonuses', chain: false })
  }
  const laneOrder = { normal: 0, skill: 1, gogma: 2 }
  return steps.sort((left, right) => laneOrder[left.lane] - laneOrder[right.lane] || left.position - right.position)
}

/**
 * A full replay of the predicted shape, every chain unit included, on the scenario's Engine. Counter-advance
 * forges produce weapons the Route never uses; the converted weapon is the production target's forge.
 */
function fullChainReplay(scene: Scenario, shape: ExpectedRouteShape) {
  const engine = scene.table.engine
  const master = scene.input.master
  const seed = scene.input.rngState.baseSeed.value as NormalizedSeed
  const target = scene.context.planningTargets.find(value => value.id === shape.targetWeaponId)!
  const { weaponTypeId, elementId } = target
  const source = shape.option.source
  const owned = source.kind === 'new_normal' ? null : scene.input.ownedWeapons.find(weapon => weapon.id === source.ownedWeaponId)!
  let bonuses: RestorationBonusSet = owned ? structuredClone(owned.restorationBonuses) : engine.predictNormalArtian({ baseSeed: seed, weaponTypeId, elementId, rarity: 8, normalCounter: shape.match.required.normal!.position, master })
  let scope = owned ? owned.restorationBonusScope : 'normal_artian'
  let seriesSkillId = owned?.seriesSkillId ?? null
  let groupSkillId = owned?.groupSkillId ?? null
  for (const step of stepsOf(shape)) {
    if (step.lane === 'skill') {
      const skills = engine.predictSkills({ baseSeed: seed, skillCounter: step.position, weaponTypeId, elementId, master })
      seriesSkillId = skills.seriesSkillId
      groupSkillId = skills.groupSkillId
    } else if (step.lane === 'gogma') {
      bonuses = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: step.position, weaponTypeId, elementId, master,
        operation: step.operation === 'reset_bonuses' ? { type: 'reset_bonuses' } : { type: 'keep_bonuses', currentBonuses: structuredClone(bonuses) } })
      scope = 'gogma_artian'
    }
  }
  return { finalBonuses: bonuses, restorationBonusScope: scope, seriesSkillId, groupSkillId }
}

/** The shape as a saved BuildRoute (lane order: base, Bonus, Skill), for the Production skip authority. */
function routeOf(shape: ExpectedRouteShape, weaponTypeId: WeaponTypeId): BuildRoute {
  const steps = stepsOf(shape)
  const source = shape.option.source
  const owned = source.kind === 'new_normal' ? null : (source.ownedWeaponId as OwnedWeaponId)
  const amendSource = source.kind === 'owned_gogma' ? owned : null
  const operations: RouteOperation[] = []
  const normal = steps.filter(step => step.lane === 'normal')
  if (normal.length > 0) {
    const from = normal[0]!.position
    const to = normal[normal.length - 1]!.position
    expect(normal.map(step => step.position)).toEqual(Array.from({ length: to - from + 1 }, (_, index) => from + index))
    operations.push({ type: 'create_normal_artian', weaponTypeId, rarity: 8, count: to - from + 1, normalCounterBefore: from, normalCounterAfter: to + 1 })
  }
  for (const step of steps.filter(value => value.operation === 'convert_normal_to_gogma')) operations.push({ type: 'convert_normal_to_gogma', weaponTypeId, skillCounterBefore: step.position, skillCounterAfter: step.position + 1 })
  for (const step of steps.filter(value => value.lane === 'gogma')) {
    operations.push({ type: step.operation as 'reset_bonuses' | 'keep_bonuses', sourceOwnedWeaponId: amendSource, gogmaCounterBefore: step.position, gogmaCounterAfter: step.position + 1 })
  }
  for (const step of steps.filter(value => value.operation === 'reset_skills')) operations.push({ type: 'reset_skills', sourceOwnedWeaponId: amendSource, skillCounterBefore: step.position, skillCounterAfter: step.position + 1 })
  const kind = source.kind === 'owned_gogma' ? 'existing_gogma_mixed' : source.kind === 'owned_normal' ? 'owned_normal_artian_to_gogma' : 'normal_artian_to_gogma'
  return { kind, sourceOwnedWeaponId: owned, operations } as BuildRoute
}

describe('Phase C-1 structural candidate (design 4.3 / 4.4 / 8.2 / 8.3)', () => {
  it('builds coverage, order and shapes for a feasible assignment without changing it', async () => {
    const { scene, assignment } = await s2()
    const before = structuredClone(assignment)
    const candidate = structural(scene.build(assignment))
    const { a, b, c } = scene.ids
    expect(candidate.kind).toBe('structural_candidate')
    expect(candidate.ordinal).toBe(7)
    expect(candidate.assignment).toBe(assignment)
    expect(assignment).toEqual(before)
    // Skill 7: a's Reset Skills chain (both other Targets convert later); Gogma 10: a's Reset chain, 14: a's Keep chain; Normal 4: c's forge.
    const segments = Object.fromEntries(candidate.coverage.map(stream => [stream.stream.kind === 'normal' ? stream.stream.counterId : stream.stream.kind,
      stream.segments.map(segment => [segment.kind, segment.from, segment.to, segment.covererTargetWeaponId])]))
    expect(segments).toEqual({
      skill: [['chain', 7, 7, a], ['required', 8, 8, c], ['required', 9, 9, b], ['required', 10, 10, a]],
      gogma: [['chain', 10, 10, a], ['required', 11, 11, a], ['required', 12, 12, c], ['required', 13, 13, b], ['chain', 14, 14, a], ['required', 15, 15, a]],
      [FIXTURE_NORMAL_COUNTER_ID]: [['chain', 4, 4, c], ['required', 5, 5, c]],
    })
    expect(candidate.materializationOrder).toEqual([a, c, b])
    expect(candidate.materializationDependencies).toEqual([
      { targetWeaponId: c, conversionPosition: 8, prerequisiteTargetWeaponIds: [a] },
      { targetWeaponId: b, conversionPosition: 9, prerequisiteTargetWeaponIds: [a, c] },
    ])
    expect(candidate.expectedShapes.map(shape => shape.targetWeaponId)).toEqual([a, b, c])
    expect(shapeOf(candidate, a).match).toMatchObject({ sourceOwnedWeaponId: G1, required: { skill: [10], gogma: [11, 15], normal: null } })
    expect(shapeOf(candidate, b).match).toMatchObject({ sourceOwnedWeaponId: N1, required: { skill: [9], gogma: [13], normal: null } })
    expect(shapeOf(candidate, c).match).toMatchObject({ sourceOwnedWeaponId: null, required: { skill: [8], gogma: [12], normal: { counterId: FIXTURE_NORMAL_COUNTER_ID, position: 5 } } })
    expect(shapeOf(candidate, a).predicted.chainSegments.map(segment => [segment.stream.kind, segment.from, segment.to, segment.operation])).toEqual([
      ['skill', 7, 7, 'reset_skills'], ['gogma', 10, 10, 'reset_bonuses'], ['gogma', 14, 14, 'keep_bonuses'],
    ])
    expect(shapeOf(candidate, c).predicted.chainSegments.map(segment => [segment.stream.kind, segment.from, segment.to, segment.operation])).toEqual([['normal', 4, 4, 'create_normal_artian']])
    expect(shapeOf(candidate, b).predicted.chainSegments).toEqual([])
    // Every position of every stream is attributed to exactly one Target.
    const total = { skill: 0, gogma: 0, normal: 0 }
    for (const shape of candidate.expectedShapes) for (const key of ['skill', 'gogma', 'normal'] as const) total[key] += shape.predicted.ownPositionCount[key]
    expect(total).toEqual({ skill: 11 - 7, gogma: 16 - 10, normal: 6 - 4 })
    expect(total.skill + total.gogma + total.normal).toBe(assignment.objective)
  })

  it('takes every final state from the required-only replay and marks the option rng_replayed', async () => {
    const { scene, assignment } = await s2()
    const candidate = structural(scene.build(assignment))
    for (const shape of candidate.expectedShapes) {
      const replay = replayReachOptionRequiredOnly(assignment.chosen.get(shape.targetWeaponId)!, scene.context, scene.table.engine)
      expect(shape.option).toEqual(replay.option)
      expect(shape.option.verification).toBe('rng_replayed')
      expect(shape.match).toMatchObject(replay.finalState)
      const target = scene.context.planningTargets.find(value => value.id === shape.targetWeaponId)!
      expect(satisfiesIdealTarget(target, shape.match.finalBonuses, shape.match.restorationBonusScope, shape.match.seriesSkillId, shape.match.groupSkillId, scene.input.master)).toBe(true)
    }
    expect(candidate.replayPredictions.skill).toBeGreaterThan(0)
  })

  it('predicts chains whose full replay reaches the same final weapon as the required-only replay', async () => {
    const { scene, assignment } = await s2()
    const candidate = structural(scene.build(assignment))
    for (const shape of candidate.expectedShapes) {
      const { finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId } = shape.match
      expect(fullChainReplay(scene, shape), shape.targetWeaponId).toEqual({ finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId })
    }
  })

  it('predicts only units the Production skip authority treats as skippable, and keeps every required unit required', async () => {
    const { scene, assignment } = await s2()
    const candidate = structural(scene.build(assignment))
    for (const shape of candidate.expectedShapes) {
      const weaponTypeId = scene.context.planningTargets.find(value => value.id === shape.targetWeaponId)!.weaponTypeId
      const entry = routeEntry(`entry.c1.${shape.targetWeaponId}`, beamTarget(shape.targetWeaponId), routeOf(shape, weaponTypeId))
      const { unitPlans, rejections } = createPlannerRouteUnitPlans([entry], plannerEngine())
      expect(rejections).toEqual([])
      const steps = stepsOf(shape)
      const units = unitPlans.get(entry.id)!.map(unit => ({ lane: unit.counterStream, position: unit.counterBefore, skippable: unit.canSkipWhenCounterPassed }))
      const expected = steps.map(step => ({ lane: step.lane, position: step.position, skippable: step.chain }))
      const byKey = (list: { lane: string | null; position: number | null }[]) => [...list].sort((left, right) => `${left.lane}`.localeCompare(`${right.lane}`) || left.position! - right.position!)
      expect(byKey(units), shape.targetWeaponId).toEqual(byKey(expected))
    }
  })

  it('keeps the match condition when only the chain prediction changes', async () => {
    const original = await s2(12)
    const first = structural(original.scene.build(original.assignment))
    const moved = await s2(14) // c's Reset moves to 14: b now covers Gogma 12 with a Keep chain, a no longer covers 14
    const second = structural(moved.scene.build(moved.assignment))
    const a = moved.scene.ids.a
    expect(shapeOf(second, a).predicted.chainSegments).not.toEqual(shapeOf(first, a).predicted.chainSegments)
    expect(shapeOf(second, a).match).toEqual(shapeOf(first, a).match)
    expect(shapeOf(second, moved.scene.ids.b).predicted.chainSegments.map(segment => [segment.stream.kind, segment.from, segment.to, segment.operation])).toEqual([['gogma', 12, 12, 'keep_bonuses']])
    for (const shape of second.expectedShapes) {
      const { finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId } = shape.match
      expect(fullChainReplay(moved.scene, shape)).toEqual({ finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId })
    }
  })

  it('handles a conversion before its final Skill position (c < s*) with a Reset Skills chain after the conversion', async () => {
    // Skill 7: a; 8: b converts; 9: b's Reset Skills chain (c converts only at 10); 10: c; 11: b's final Reset Skills.
    const scene = await scenario({ skillIdeal: [7, 10, 11], resetIdeal: [12, 14], keepIdeal: [13, 15] })
    const options = [
      scene.optionOf(scene.ids.a, scene.owns(G1), resetSkills(7), reset(12)),
      scene.optionOf(scene.ids.b, scene.owns(N1), conversion(8, 11), keep(13)),
      scene.optionOf(scene.ids.c, scene.forge(4), conversion(10, 10), reset(14)),
    ]
    const candidate = structural(scene.build(assignmentOf(scene.reach, options)))
    const b = shapeOf(candidate, scene.ids.b)
    expect(b.match.required.skill).toEqual([8, 11])
    expect(b.predicted.chainSegments.map(segment => [segment.stream.kind, segment.from, segment.to, segment.operation])).toEqual([['skill', 9, 9, 'reset_skills']])
    expect(candidate.materializationOrder).toEqual([scene.ids.a, scene.ids.b, scene.ids.c])
    expect(candidate.materializationDependencies.map(value => [value.targetWeaponId, value.prerequisiteTargetWeaponIds])).toEqual([[scene.ids.b, [scene.ids.a]], [scene.ids.c, [scene.ids.a, scene.ids.b]]])
    for (const shape of candidate.expectedShapes) {
      const { finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId } = shape.match
      expect(fullChainReplay(scene, shape), shape.targetWeaponId).toEqual({ finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId })
    }
  })

  it('returns coverage_infeasible with the first uncovered position and runs no replay', async () => {
    const scene = await scenario({ skillIdeal: [8, 9, 10], resetIdeal: [12, 14], keepIdeal: [13, 15] })
    const options = [
      scene.optionOf(scene.ids.a, scene.forge(4), conversion(10, 10), reset(14)),
      scene.optionOf(scene.ids.b, scene.owns(N1), conversion(9, 9), keep(13)),
      scene.optionOf(scene.ids.c, scene.forge(5), conversion(8, 8), reset(12)),
    ]
    const calls = { ...scene.table.calls }
    const result = scene.build(assignmentOf(scene.reach, options))
    expect(result.kind).toBe('coverage_infeasible')
    if (result.kind !== 'coverage_infeasible') return
    expect(result.firstUncovered).toMatchObject({ stream: { kind: 'skill' }, from: 7, to: 7, firstUncoveredPosition: 7, previousRequired: null })
    expect(result.uncovered).toHaveLength(1)
    expect(scene.table.calls).toEqual(calls)
  })

  it('rejects a protected source, a foreign table and a forged option, and fails closed on a replay inconsistency', async () => {
    const { scene, assignment, options } = await s2()
    // A forged option (not offered by the row) is rejected before coverage.
    const foreign = { ...options[0]!, source: { ...options[0]!.source, ownedWeaponId: 'owned.unknown' } as SourceCandidate }
    expect(scene.build(assignmentOf(scene.reach, [foreign, options[1]!, options[2]!]))).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
    // A protected Gogma never gets an operation, even if its row lists it.
    const reach: ReachTable = structuredClone(scene.reach)
    const row = reach.targets.find(value => value.targetWeaponId === scene.ids.a)!
    const protectedSource = { ...(row.sources.find(source => source.kind === 'owned_gogma')!), isProtected: true } as SourceCandidate
    row.sources = [protectedSource, ...row.sources.filter(source => source.kind !== 'owned_gogma')]
    const forged = createReachOption(row, reach, protectedSource, resetSkills(10), resetThenKeep(11, 15))
    expect(buildStructuralCandidate(assignmentOf(reach, [forged, options[1]!, options[2]!]), { table: reach, context: scene.context, engine: scene.table.engine }))
      .toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
    // A table of other origins, or of other Targets, does not belong to the context.
    expect(buildStructuralCandidate(assignment, { table: { ...scene.reach, originSkill: 8 }, context: scene.context, engine: scene.table.engine })).toMatchObject({ kind: 'invalid_input', reason: 'origin_mismatch' })
    expect(buildStructuralCandidate(assignment, { table: { ...scene.reach, targets: [...scene.reach.targets].reverse() }, context: scene.context, engine: scene.table.engine }))
      .toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    // A structurally valid option whose RNG result is not Ideal (Reset at 10) passes coverage and fails closed in the replay.
    const notIdeal = createReachOption(scene.reach.targets.find(value => value.targetWeaponId === scene.ids.c)!, scene.reach, options[2]!.source, conversion(8, 8), reset(10))
    let error: unknown
    try {
      scene.build(assignmentOf(scene.reach, [options[0]!, options[1]!, notIdeal]))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(GlobalAssignmentInvariantError)
    expect((error as GlobalAssignmentInvariantError).code).toBe('ideal_mismatch')
  })
})

describe('Phase C-1 on Phase B-1 candidates (design 6.3 / 14)', () => {
  const REQUEST: ResourceAssignmentSearchRequest = { nodeBudget: 1_000_000, mrvLookahead: 8 }

  it('post-processes solver candidates deterministically without changing the solver\'s sequence', async () => {
    const scene = await scenario({ skillIdeal: [8, 9, 10], resetIdeal: [12, 14], keepIdeal: [13, 15] })
    const alone = collectResourceAssignments(scene.reach, scene.context.planningTargets, REQUEST, 120)
    if (alone.status !== 'assignments_found') throw new Error(alone.status)
    // The same search with Phase C-1 run between every `next()` yields the same candidates in the same order.
    const created = createResourceAssignmentSearch(scene.reach, scene.context.planningTargets, REQUEST)
    if (created.kind !== 'search') throw new Error(created.detail)
    const interleaved: ResourceAssignmentCandidate[] = []
    const results: StructuralCandidateResult[] = []
    while (interleaved.length < 120) {
      const event = created.search.next()
      if (event.kind !== 'candidate') break
      interleaved.push(event.candidate)
      results.push(scene.build(event.candidate))
    }
    expect(interleaved).toEqual(alone.candidates)
    expect(results.map(result => result.kind)).not.toContain('invalid_input')
    expect(results.filter(result => result.kind === 'structural_candidate').length).toBeGreaterThan(0)
    for (const result of results) {
      if (result.kind === 'coverage_infeasible') {
        expect(result.firstUncovered.stream).toEqual({ kind: 'skill' })
        continue
      }
      if (result.kind !== 'structural_candidate') continue
      const candidate = result.candidate
      // Not verified: no physical operation count, no upper bound provenance.
      expect(candidate).not.toHaveProperty('physicalOperations')
      expect(candidate).not.toHaveProperty('provenance')
      expect(new Set(candidate.materializationOrder)).toEqual(new Set(scene.context.planningTargets.map(target => target.id)))
      expect(candidate.materializationOrder).toHaveLength(scene.context.planningTargets.length)
      for (const shape of candidate.expectedShapes) {
        const { finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId } = shape.match
        expect(fullChainReplay(scene, shape)).toEqual({ finalBonuses, restorationBonusScope, seriesSkillId, groupSkillId })
      }
    }
    // Deterministic: a second pass over the same candidates gives identical results.
    expect(alone.candidates.map(value => scene.build(value))).toEqual(results)
  })

  it('separates infeasible solver candidates from structural ones when no Gogma holds the Skill origin', async () => {
    const scene = await scenario({ skillIdeal: [7, 8, 9, 10], resetIdeal: [12, 14], keepIdeal: [13, 15], g1SkillIdeal: true })
    const collected = collectResourceAssignments(scene.reach, scene.context.planningTargets, REQUEST, 200)
    if (collected.status !== 'assignments_found') throw new Error(collected.status)
    const results = collected.candidates.map(value => scene.build(value))
    const infeasible = results.filter(result => result.kind === 'coverage_infeasible')
    const feasible = results.filter(result => result.kind === 'structural_candidate')
    expect(infeasible.length).toBeGreaterThan(0)
    expect(feasible.length).toBeGreaterThan(0)
    for (const result of infeasible) {
      // The Skill origin is uncovered exactly when no conversion sits at it (G1 holds no Skill position).
      const conversions = [...result.assignment.chosen.values()].flatMap(value => value.skillRequired.kind === 'conversion' ? [value.skillRequired.conversionPosition] : [])
      expect(result.firstUncovered.stream).toEqual({ kind: 'skill' })
      if (!conversions.includes(7)) expect(result.firstUncovered.firstUncoveredPosition).toBe(7)
    }
    for (const result of feasible) {
      const conversions = [...result.candidate.assignment.chosen.values()].flatMap(value => value.skillRequired.kind === 'conversion' ? [value.skillRequired.conversionPosition] : [])
      expect(conversions).toContain(7)
    }
  })
})
