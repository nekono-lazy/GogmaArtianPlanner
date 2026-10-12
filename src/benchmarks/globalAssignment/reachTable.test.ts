import { describe, expect, it } from 'vitest'
import type { BuildListEntry, OwnedWeapon, RestorationBonusSet, TargetWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { keepFamilyMultisetKey } from '../../domain/rng/gogmaBonusFamily'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { evaluateSkillCondition } from '../../domain/target/skillConditionEvaluator'
import { satisfiesIdealBonuses } from '../../domain/target/targetEvaluator'
import { collectLowerBoundProblem } from '../plannerGlobalLowerBound'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { createGlobalAssignmentContext } from './context'
import { enumerateReachOptions, sourceResourceKey } from './reachOptions'
import { assertReachWindow, buildReachTable, reachWindowW0 } from './reachTable'
import {
  createGlobalAssignmentFixture, createTableEngine, FIXTURE_NORMAL_COUNTER_ID, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks,
  keepToLowRanks, layoutKeyOf, OTHER_FAMILIES, ownedGogma, ownedNormal, type GlobalAssignmentFixtureOptions, type TableEngineSpec,
} from './testFixture'
import type { GlobalAssignmentContext, ReachTable, ReachWindow, TargetReach } from './types'

/*
 * Issue #154 Global Assignment Phase A (design 4.2 / 5 / 13.1): the ReachTable holds, per planning
 * Target, the Counter positions inside an explicit window at which the given Engine reaches the Ideal,
 * judged only by the Production evaluators. Small tables, brute-force comparison, no oracle.
 */
const L_IDEAL = layoutKeyOf(IDEAL_BONUSES)
const L_R = layoutKeyOf(IDEAL_FAMILIES_REORDERED_NORMAL)
const L_OTHER = layoutKeyOf(OTHER_FAMILIES)
const SERIES_A = 'series_skill.fixture.a'
/** The Ideal families in the reordered slot order, Gogma-side spelling, mixed tiers (a Reset result). */
const REORDERED_GOGMA: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
  { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]
/** The Ideal slot order with the Normal-side Sharpness spelling (a Normal forge result). */
const IDEAL_ORDER_NORMAL: RestorationBonusSet = [IDEAL_BONUSES[0], IDEAL_BONUSES[1], IDEAL_BONUSES[2], IDEAL_BONUSES[3],
  { bonusTypeId: 'bonus_type.fixture.normal_sharpness', bonusRankId: 'bonus_rank.fixture.low' }]
const WINDOW: ReachWindow = { skill: 3, gogma: 4, normal: 3 }
const ELEMENT_A = 'element.fixture.a', ELEMENT_B = 'element.fixture.b'
const skillAt = (series: string | null) => ({ seriesSkillId: series, groupSkillId: null })

/** Element a: Ideal Skill at 8 / 10, Ideal Reset at 12, reordered Reset layout at 11, Keep Ideal at 13 (any layout) and 11 (Ideal order only). */
function scanEngine(overrides: Partial<TableEngineSpec> = {}) {
  return createTableEngine({
    skill: (position, _type, element) => skillAt((element === ELEMENT_A ? [8, 10] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other'),
    reset: (position, _type, element) => element === ELEMENT_A
      ? position === 12 ? structuredClone(IDEAL_BONUSES) : position === 11 ? structuredClone(REORDERED_GOGMA) : structuredClone(OTHER_FAMILIES)
      : position === 10 ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
    keep: (position, current, _type, element) => element === ELEMENT_A
      ? position === 13 || (position === 11 && layoutKeyOf(current) === L_IDEAL) ? keepToIdealRanks(current) : keepToLowRanks(current)
      : position === 12 ? keepToIdealRanks(current) : keepToLowRanks(current),
    normal: (position, _type, element) => element === ELEMENT_A
      ? position === 5 ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : position === 6 ? structuredClone(IDEAL_ORDER_NORMAL) : structuredClone(OTHER_FAMILIES)
      : position === 4 ? structuredClone(IDEAL_ORDER_NORMAL) : structuredClone(OTHER_FAMILIES),
    ...overrides,
  })
}

/** Owned weapons of Target a's group: every source rule of design 5.2 at least once. */
function ownedForGroupA(): OwnedWeapon[] {
  return [
    ownedGogma('owned.g1'),
    ownedGogma('owned.g2', { restorationBonuses: structuredClone(IDEAL_BONUSES), seriesSkillId: SERIES_A, isProtected: true, status: 'ideal' }),
    ownedGogma('owned.g3', { isProtected: true }),
    ownedGogma('owned.g4', { restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL), restorationBonusScope: 'normal_artian' }),
    ownedGogma('owned.g5', { restorationBonuses: structuredClone(IDEAL_BONUSES) }),
    ownedNormal('owned.n1'),
    ownedNormal('owned.n2', { isProtected: true }),
  ]
}

async function prepared(options: { owned?: OwnedWeapon[]; engine?: ReturnType<typeof scanEngine> } & GlobalAssignmentFixtureOptions = {}) {
  const fixture = await createGlobalAssignmentFixture(options)
  const table = options.engine ?? scanEngine()
  // Owned weapons added after the search: no Entry references them, so every Entry stays valid.
  const input: PlannerInput = { ...fixture.input, ownedWeapons: [...fixture.input.ownedWeapons, ...(options.owned ?? [])] }
  const result = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (result.kind !== 'context') throw new Error(`Expected a context, got ${result.kind}: ${result.detail}`)
  return { ...fixture, input, context: result.context, table }
}

async function tableOf(context: GlobalAssignmentContext, engine: RngEngine, window: ReachWindow = WINDOW): Promise<ReachTable> {
  const result = await buildReachTable(context, engine, window)
  if (result.kind !== 'reach_table') throw new Error(`Expected a table, got ${JSON.stringify(result)}`)
  return result.table
}

/** Direct re-evaluation of one Target with the same Engine and the same evaluators, no memo, no sharing. */
function bruteForce(engine: RngEngine, input: PlannerInput, target: TargetWeapon, window: ReachWindow, layouts: readonly string[]) {
  const master = input.master
  const seed = input.rngState.baseSeed.value!
  const S0 = input.rngState.skillCounter.value!, G0 = input.rngState.gogmaCounter.value!
  const { weaponTypeId, elementId } = target
  const skill: number[] = []
  for (let position = S0; position <= S0 + window.skill; position++) {
    const result = engine.predictSkills({ baseSeed: seed, skillCounter: position, weaponTypeId, elementId, master })
    if (evaluateSkillCondition(target.idealSkillCondition, result.seriesSkillId, result.groupSkillId)) skill.push(position)
  }
  const reset: number[] = [], resetLayouts: [number, string][] = []
  for (let position = G0; position < G0 + window.gogma; position++) {
    const result = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master })
    resetLayouts.push([position, layoutKeyOf(result)])
    if (satisfiesIdealBonuses(target, result, 'gogma_artian', master)) reset.push(position)
  }
  const keep = new Map<string, number[]>()
  for (const layout of layouts) {
    const current = layout.split('\u0000').map(family => ({ bonusTypeId: family, bonusRankId: 'bonus_rank.fixture.low' })) as RestorationBonusSet
    const positions: number[] = []
    for (let position = G0; position < G0 + window.gogma; position++) {
      const result = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'keep_bonuses', currentBonuses: current }, master })
      if (satisfiesIdealBonuses(target, result, 'gogma_artian', master)) positions.push(position)
    }
    keep.set(layout, positions)
  }
  return { skill, reset, resetLayouts, keep }
}

describe('Phase A ReachTable', () => {
  it('matches a brute-force re-evaluation of every position in the window, per Target, stream and layout', async () => {
    const { context, table, input, targets } = await prepared({ owned: ownedForGroupA() })
    const reach = await tableOf(context, table.engine)
    expect(reach.targets.map(target => target.targetWeaponId)).toEqual([targets.a.id, targets.b.id])
    for (const row of reach.targets) {
      const target = input.targetWeapons.find(value => value.id === row.targetWeaponId)!
      const direct = bruteForce(table.engine, input, target, WINDOW, [...row.bonus.keepIdealPositionsByLayout.keys()])
      expect(row.skill.idealPositions).toEqual(direct.skill)
      expect(row.bonus.resetIdealPositions).toEqual(direct.reset)
      expect([...row.bonus.resetLayoutByPosition]).toEqual(direct.resetLayouts)
      expect(row.bonus.keepIdealPositionsByLayout).toEqual(direct.keep)
      // Every layout of interest is a permutation of the Ideal multiset; nothing else was predicted.
      const idealMultiset = keepFamilyMultisetKey(target.idealBonuses, input.master)
      for (const layout of row.bonus.keepIdealPositionsByLayout.keys()) expect(layout.split('\u0000').sort().join('\u0000')).toBe(idealMultiset)
    }
    const a = reach.targets[0]!, b = reach.targets[1]!
    expect(a.skill).toEqual({ idealPositions: [8, 10], resetSkillsLimit: 9, conversionLimit: 10 })
    expect(a.bonus.resetIdealPositions).toEqual([12])
    expect([...a.bonus.resetLayoutByPosition]).toEqual([[10, L_OTHER], [11, L_R], [12, L_IDEAL], [13, L_OTHER]])
    expect([...a.bonus.keepIdealPositionsByLayout]).toEqual([[L_IDEAL, [11, 13]], [L_R, [13]]])
    expect(b.skill.idealPositions).toEqual([9])
    expect(b.bonus.resetIdealPositions).toEqual([10])
    expect([...b.bonus.keepIdealPositionsByLayout]).toEqual([[L_IDEAL, [12]]])
    expect(reach.scanned).toEqual({ skill: { from: 7, to: 10 }, gogma: { from: 10, to: 13 }, normal: { [FIXTURE_NORMAL_COUNTER_ID]: { from: 4, to: 6 } } })
    expect(reach.originNormal).toEqual({ [FIXTURE_NORMAL_COUNTER_ID]: 4 })
    expect(reach.summary.unsupported).toEqual([])
  })

  it('lists sources by the design 5.2 rules: owned by ID (protected only while Ideal, no protected Normal), then new Normal positions', async () => {
    const { context, table } = await prepared({ owned: ownedForGroupA() })
    const a = (await tableOf(context, table.engine)).targets[0]!
    expect(a.sources.map(source => source.kind === 'new_normal' ? `normal:${source.position}` : source.ownedWeaponId))
      .toEqual(['owned.g1', 'owned.g2', 'owned.g4', 'owned.g5', 'owned.n1', 'normal:4', 'normal:5', 'normal:6'])
    expect(a.excludedOwnedWeapons).toEqual([{ ownedWeaponId: 'owned.g3', reason: 'protected_gogma_not_ideal' }, { ownedWeaponId: 'owned.n2', reason: 'protected_normal' }])
    expect(a.sources[1]).toEqual({ kind: 'owned_gogma', ownedWeaponId: 'owned.g2', layout: L_IDEAL, scope: 'gogma_artian', currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true, keepSupported: true })
    expect(a.sources[2]).toMatchObject({ kind: 'owned_gogma', ownedWeaponId: 'owned.g4', layout: L_R, scope: 'normal_artian', currentSkillIdeal: false, currentBonusIdeal: false, isProtected: false })
    expect(a.sources[3]).toMatchObject({ kind: 'owned_gogma', ownedWeaponId: 'owned.g5', currentSkillIdeal: false, currentBonusIdeal: true })
    expect(a.sources[4]).toEqual({ kind: 'owned_normal', ownedWeaponId: 'owned.n1', layout: L_R, isProtected: false, keepSupported: true })
    expect(a.sources.slice(5)).toEqual([4, 5, 6].map(position => ({ kind: 'new_normal', counterId: FIXTURE_NORMAL_COUNTER_ID, position, layout: [L_OTHER, L_R, L_IDEAL][position - 4], keepSupported: true })))
    // The current Ideal of a protected Gogma yields exactly the zero-operation option; a protected non-Ideal Gogma yields none.
    const options = [...enumerateReachOptions(a, await tableOf(context, table.engine))]
    expect(options.filter(option => option.source.kind !== 'new_normal' && option.source.ownedWeaponId === 'owned.g2')).toEqual([
      expect.objectContaining({ skillRequired: { kind: 'none' }, bonusRequired: { kind: 'none' }, streamEnd: { skill: 7, gogma: 10, normal: { [FIXTURE_NORMAL_COUNTER_ID]: 4 } } }),
    ])
    expect(options.some(option => option.source.kind !== 'new_normal' && ['owned.g3', 'owned.n2'].includes(option.source.ownedWeaponId))).toBe(false)
  })

  it('keeps two orderings of one family multiset apart: Keep is predicted and judged per ordered layout', async () => {
    const { context, table } = await prepared({ owned: ownedForGroupA() })
    const reach = await tableOf(context, table.engine)
    const a = reach.targets[0]!
    expect(L_IDEAL).not.toBe(L_R)
    expect(L_IDEAL.split('\u0000').sort()).toEqual(L_R.split('\u0000').sort())
    expect(a.bonus.keepIdealPositionsByLayout.get(L_IDEAL)).toEqual([11, 13])
    expect(a.bonus.keepIdealPositionsByLayout.get(L_R)).toEqual([13])
    const keepFrom = (id: string) => [...enumerateReachOptions(a, reach)]
      .filter(option => option.source.kind !== 'new_normal' && option.source.ownedWeaponId === id && option.bonusRequired.kind === 'keep_from_source')
      .map(option => option.bonusRequired.kind === 'keep_from_source' && option.bonusRequired.finalPosition)
    expect(keepFrom('owned.g5')).toEqual([])          // already Ideal: Bonus requirement none
    expect(keepFrom('owned.g4')).toEqual([13])        // reordered layout from normal-scope slots
    expect([...new Set(keepFrom('owned.n1'))]).toEqual([13])  // once per conversion requirement, one Keep position
    // The Keep inputs the Engine saw name the layouts, never a sorted multiset, and the two layouts are separate calls.
    expect(table.inputs.keep.filter(key => key.includes(`|${ELEMENT_A}|13|`)).sort()).toEqual([
      `weapon.fixture.a|${ELEMENT_A}|13|${L_IDEAL.split('\u0000').join(',')}`, `weapon.fixture.a|${ELEMENT_A}|13|${L_R.split('\u0000').join(',')}`])
  })

  it('offers reset_then_keep only with the Reset strictly before the Keep', async () => {
    const { context, table } = await prepared({ owned: [ownedGogma('owned.g1')] })
    const reach = await tableOf(context, table.engine)
    const options = [...enumerateReachOptions(reach.targets[0]!, reach)].filter(option => option.source.kind === 'owned_gogma')
    const pairs = options.filter(option => option.bonusRequired.kind === 'reset_then_keep')
      .map(option => option.bonusRequired.kind === 'reset_then_keep' && [option.bonusRequired.resetPosition, option.bonusRequired.finalPosition])
    // Reset 11 (reordered layout) and Reset 12 (Ideal-order layout) both precede the Keep-Ideal position 13; Keep-Ideal 11 of
    // the Ideal-order layout has no earlier Reset producing that layout, so (12, 11) is never offered.
    expect(pairs).toEqual([[11, 13], [12, 13]])
    for (const pair of pairs) expect(pair && pair[0] < pair[1]).toBe(true)
  })

  it('shares every prediction between Targets of one weapon type and element and never mixes elements', async () => {
    const { context, table, targets } = await prepared({ owned: ownedForGroupA(), sameElementTarget: true })
    const reach = await tableOf(context, table.engine)
    expect(reach.targets.map(target => target.targetWeaponId)).toEqual([targets.a.id, targets.b.id, targets.c!.id])
    expect(reach.summary.groups.map(group => [group.elementId, group.targetWeaponIds])).toEqual([[ELEMENT_A, [targets.a.id, targets.c!.id]], [ELEMENT_B, [targets.b.id]]])
    // One call per position per group: Skill 4 + 4, Reset 4 + 4, Normal 3 + 3, Keep (2 layouts + 1 layout) x 4.
    expect(table.calls).toMatchObject({ skill: 8, reset: 8, normal: 6, keep: 12 })
    expect(reach.summary.predictions).toEqual({ skill: 8, gogmaReset: 8, gogmaKeep: 12, normal: 6 })
    expect(reach.summary.memoHits).toEqual({ skill: 4, gogmaReset: 4, gogmaKeep: 8, normal: 3 })
    expect(new Set(table.inputs.skill).size).toBe(table.inputs.skill.length)
    expect(new Set(table.inputs.keep).size).toBe(table.inputs.keep.length)
    expect(table.inputs.skill.filter(key => key.includes(ELEMENT_B))).toEqual([7, 8, 9, 10].map(position => `weapon.fixture.a|${ELEMENT_B}|${position}`))
    expect(reach.targets[2]!.skill).toEqual(reach.targets[0]!.skill)
    expect(reach.targets[2]!.bonus).toEqual(reach.targets[0]!.bonus)
    expect(reach.targets[1]!.skill.idealPositions).toEqual([9])
  })

  it('is deterministic: the same context, Engine and window give an identical table twice', async () => {
    const { context, table } = await prepared({ owned: ownedForGroupA(), sameElementTarget: true })
    const first = await tableOf(context, table.engine)
    const second = await tableOf(context, scanEngine().engine)
    expect(second).toEqual(first)
    const keys = (reach: ReachTable) => reach.targets.map(target => [...enumerateReachOptions(target, reach)].map(option => JSON.stringify(option)))
    expect(keys(second)).toEqual(keys(first))
  })

  it('does not depend on the existing Entries Route contents: two inputs with the same planning Targets give the same table', async () => {
    const one = await prepared({ owned: ownedForGroupA() })
    const two = await prepared({ owned: ownedForGroupA(), idealResetPositions: [11] })
    const operations = (input: PlannerInput) => input.buildListEntries.map(entry => entry.candidateSnapshot.route.operations.map(operation => operation.type))
    expect(operations(one.input)).not.toEqual(operations(two.input))
    expect(one.context.planningTargets.map(target => target.id)).toEqual(two.context.planningTargets.map(target => target.id))
    expect(await tableOf(two.context, two.table.engine)).toEqual(await tableOf(one.context, one.table.engine))
  })

  it('reports an unsupported prediction as an option absence with a notice, never as an unreachable Ideal', async () => {
    const skillUnsupported = scanEngine({ support: input => input.type === 'skill' && input.elementId === ELEMENT_B ? { supported: false, reason: 'reference_adapter_unsupported' } : null })
    // Target b's Entry is an existing-Gogma Reset Route (its Skills already Ideal), so it stays a planning Target without Skill prediction.
    const b1 = ownedGogma('owned.b1', { elementId: ELEMENT_B, seriesSkillId: SERIES_A })
    const { context, table, targets, input } = await prepared({ owned: ownedForGroupA(), ownedAtSearch: [b1], engine: skillUnsupported })
    expect(input.buildListEntries.find(entry => entry.targetWeaponId === targets.b.id)!.candidateSnapshot.route.sourceOwnedWeaponId).toBe('owned.b1')
    const reach = await tableOf(context, table.engine)
    const b = reach.targets[1]!
    expect(b.support).toEqual({ normal: true, skill: false, gogmaReset: true })
    expect(b.skill.idealPositions).toEqual([])
    expect(b.bonus.resetIdealPositions).toEqual([10])
    expect(reach.summary.unsupported).toEqual([{ targetWeaponId: targets.b.id, prediction: 'skill', reason: 'reference_adapter_unsupported' }])
    expect(table.inputs.skill.some(key => key.includes(ELEMENT_B))).toBe(false)
    // The new Normal sources need a conversion and yield nothing; the owned Gogma keeps its current Skills and still has Bonus options.
    const bOptions = [...enumerateReachOptions(b, reach)]
    expect(bOptions.length).toBeGreaterThan(0)
    expect(bOptions.every(option => option.source.kind === 'owned_gogma' && option.skillRequired.kind === 'none')).toBe(true)
    expect(b.sources.filter(source => source.kind === 'new_normal')).toHaveLength(3)

    const keepUnsupported = scanEngine({ support: input => input.type === 'gogma_keep' && layoutKeyOf(input.currentBonuses) === L_R ? { supported: false, reason: 'unsupported_current_bonus' } : null })
    const second = await prepared({ owned: ownedForGroupA(), engine: keepUnsupported })
    const reach2 = await tableOf(second.context, second.table.engine)
    const a = reach2.targets[0]!
    expect(a.bonus.keepUnsupportedLayouts).toEqual([L_R])
    expect(a.bonus.keepIdealPositionsByLayout.has(L_R)).toBe(false)
    expect(a.sources.filter(source => source.layout === L_R).map(source => source.keepSupported)).toEqual([false, false, false])
    expect(reach2.summary.unsupported.filter(notice => notice.prediction === 'gogma_keep')).toEqual([{ targetWeaponId: targets.a.id, prediction: 'gogma_keep', reason: 'unsupported_current_bonus', layout: L_R }])
    const options = [...enumerateReachOptions(a, reach2)]
    expect(options.some(option => option.source.layout === L_R && option.bonusRequired.kind === 'keep_from_source')).toBe(false)
    expect(options.filter(option => option.bonusRequired.kind === 'reset_then_keep').map(option => option.bonusRequired.kind === 'reset_then_keep' && option.bonusRequired.resetPosition))
      .toEqual(expect.arrayContaining([12]))
    expect(options.some(option => option.bonusRequired.kind === 'reset_then_keep' && option.bonusRequired.resetPosition === 11)).toBe(false)
  })

  it('fails closed on a Target with no owned source and no confirmed Normal Counter, and keeps going when owned sources exist', async () => {
    // An unconfirmed Counter makes the fixture Entries forced-Reset (blind) Routes, which Production validation keeps valid.
    const fixture = await createGlobalAssignmentFixture({ normalCounterConfirmed: false })
    const unconfirmed: PlannerInput = fixture.input
    expect(unconfirmed.normalCounters.map(counter => counter.isConfirmed)).toEqual([false])
    expect(unconfirmed.buildListEntries.map(entry => entry.candidateSnapshot.route.operations[0])).toEqual([
      expect.objectContaining({ type: 'create_normal_artian', normalCounterBefore: null }), expect.objectContaining({ type: 'create_normal_artian', normalCounterBefore: null })])
    const table = scanEngine()
    const context = createGlobalAssignmentContext(unconfirmed, globalResearchDependencies(table.engine))
    expect(context.kind).toBe('context')
    if (context.kind !== 'context') return
    const refused = await buildReachTable(context.context, table.engine, WINDOW)
    expect(refused).toMatchObject({ kind: 'unsupported_input', reason: 'unconfirmed_counter' })
    expect(refused.kind === 'unsupported_input' && refused.detail).toContain(fixture.targets.a.id)
    expect(table.calls.skill + table.calls.reset + table.calls.normal + table.calls.keep).toBe(0)

    const withOwned = createGlobalAssignmentContext({ ...unconfirmed, ownedWeapons: [ownedGogma('owned.g1'), ownedGogma('owned.b1', { elementId: ELEMENT_B })] }, globalResearchDependencies(table.engine))
    if (withOwned.kind !== 'context') throw new Error(withOwned.detail)
    const reach = await tableOf(withOwned.context, table.engine)
    expect(reach.targets.map(target => target.normalCounterId)).toEqual([null, null])
    expect(reach.targets.every(target => target.sources.every(source => source.kind !== 'new_normal'))).toBe(true)
    expect(reach.scanned.normal).toEqual({})
    expect(table.calls.normal).toBe(0)
    for (const target of reach.targets) for (const option of enumerateReachOptions(target, reach)) expect(option.streamEnd.normal).toEqual({})
  })

  it('fails closed when only a blind Route could reach a Target, and on an unconfirmed Base Seed / Skill / Gogma Counter', async () => {
    const noNormal = scanEngine({ capabilities: { supportsNormalArtianPrediction: false } })
    const { context, input: blindInput } = await prepared({ engine: noNormal, fakeNormalPrediction: false })
    expect(blindInput.normalCounters[0]!.isConfirmed).toBe(true)
    expect(blindInput.buildListEntries.every(entry => entry.candidateSnapshot.route.operations[0]!.type === 'create_normal_artian'
      && (entry.candidateSnapshot.route.operations[0] as { normalCounterBefore: number | null }).normalCounterBefore === null)).toBe(true)
    expect(await buildReachTable(context, noNormal.engine, WINDOW)).toMatchObject({ kind: 'unsupported_input', reason: 'blind_route_required' })
    expect(noNormal.calls.skill + noNormal.calls.reset + noNormal.calls.normal + noNormal.calls.keep).toBe(0)
    const { context: ok, input, table } = await prepared({ owned: ownedForGroupA() })
    const modified: GlobalAssignmentContext = { ...ok, plannerInput: { ...input, rngState: { ...input.rngState, gogmaCounter: { value: 10, isConfirmed: false, source: 'manual' } } } }
    expect(await buildReachTable(modified, table.engine, WINDOW)).toEqual({ kind: 'unsupported_input', reason: 'unconfirmed_rng_state', detail: 'No confirmed value for: Gogma Counter.' })
  })

  it('fails closed on a selected intermediate state and on an invalid window', async () => {
    const { context, table } = await prepared({ owned: ownedForGroupA() })
    const pinned: GlobalAssignmentContext = { ...context, validation: { ...context.validation, validBuildListEntries: context.validation.validBuildListEntries.map(({ entry, missingRngRequirements }, index) => ({
      missingRngRequirements, entry: index === 0 ? { ...entry, intermediateStateSelection: { skillOpportunityId: 'opportunity.fixture.skill', bonusOpportunityId: null, improvementPreference: 'planner' } as BuildListEntry['intermediateStateSelection'] } : entry })) } }
    const refused = await buildReachTable(pinned, table.engine, WINDOW)
    expect(refused).toMatchObject({ kind: 'unsupported_input', reason: 'checkpoint_selection' })
    expect(refused.kind === 'unsupported_input' && refused.detail).toContain(context.validation.validBuildListEntries[0]!.entry.id)
    for (const window of [{ ...WINDOW, skill: 0 }, { ...WINDOW, gogma: -1 }, { ...WINDOW, normal: 1.5 }, { ...WINDOW, skill: Number.NaN }]) {
      expect(() => assertReachWindow(window)).toThrow(RangeError)
      await expect(buildReachTable(context, table.engine, window)).rejects.toThrow(RangeError)
    }
  })

  it('fails closed when the Master lacks a bonus rank the Ideal judgement needs', async () => {
    const { context, table, input } = await prepared({ owned: ownedForGroupA() })
    const reduced: GlobalAssignmentContext = { ...context, plannerInput: { ...input, master: { ...input.master, bonusRanks: input.master.bonusRanks.filter(rank => rank.id !== 'bonus_rank.fixture.high') } } }
    await expect(buildReachTable(reduced, table.engine, WINDOW)).rejects.toThrow()
  })

  it('reports cancellation as cancelled with the progress so far, never as an empty table, and yields control', async () => {
    const { context, table } = await prepared({ owned: ownedForGroupA() })
    const cancelled = await buildReachTable(context, table.engine, WINDOW, { shouldCancel: () => table.calls.skill >= 2 })
    expect(cancelled).toMatchObject({ kind: 'cancelled', progress: { predictions: { skill: 2, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, lastGroup: { weaponTypeId: 'weapon.fixture.a', elementId: ELEMENT_A } } })
    let yields = 0
    const wide = await buildReachTable(context, scanEngine().engine, { ...WINDOW, skill: 100 }, { yieldControl: async () => { yields += 1 } })
    expect(wide.kind).toBe('reach_table')
    expect(yields).toBeGreaterThan(0)
  })

  it('names the W0 reference window from recommendedCandidateSearchDefaults and applies no window of its own', () => {
    expect(reachWindowW0()).toEqual({ normal: 350, gogma: 500, skill: 1500 })
    expect(() => assertReachWindow(reachWindowW0())).not.toThrow()
  })
})

describe('Phase A ReachTable and the lower-bound relaxation', () => {
  const fixtureSkills = { seriesSkillIds: [SERIES_A, 'series_skill.fixture.b'], groupSkillIds: ['group_skill.fixture.a', 'group_skill.fixture.b'] }

  /** Per source: the smallest stream ends over the Target's options (the thresholds the relaxation reads). */
  function thresholdsFromReach(target: TargetReach, reach: ReachTable) {
    const byResource = new Map<string, { skillThreshold: number; gogmaThreshold: number; normalThreshold: number | null }>()
    for (const option of enumerateReachOptions(target, reach)) {
      const resource = sourceResourceKey(option.source)
      const normalThreshold = option.normalRequired === null ? null : option.normalRequired.position + 1
      const current = byResource.get(resource)
      byResource.set(resource, current
        ? { skillThreshold: Math.min(current.skillThreshold, option.streamEnd.skill), gogmaThreshold: Math.min(current.gogmaThreshold, option.streamEnd.gogma), normalThreshold }
        : { skillThreshold: option.streamEnd.skill, gogmaThreshold: option.streamEnd.gogma, normalThreshold })
    }
    return [...byResource].map(([resource, thresholds]) => ({ resource, ...thresholds })).sort((left, right) => left.resource < right.resource ? -1 : 1)
  }

  it('re-derives every collectLowerBoundProblem() threshold from the ReachTable on a fixture where both Target sets coincide', async () => {
    const { context, table, input } = await prepared({ owned: ownedForGroupA() })
    const budget = 4
    const problem = collectLowerBoundProblem(input, table.engine, budget, fixtureSkills)
    // The relaxation scans `origin .. origin + budget - 1` on every stream; the Skill window of the table is `W + 1` positions.
    const reach = await tableOf(context, scanEngine().engine, { skill: budget - 1, gogma: budget, normal: budget })
    expect(problem.targets.map(target => target.targetWeaponId)).toEqual(reach.targets.map(target => target.targetWeaponId))
    expect(reach.originSkill).toBe(problem.skillOrigin)
    expect(reach.originGogma).toBe(problem.gogmaOrigin)
    expect(reach.originNormal).toEqual({ [FIXTURE_NORMAL_COUNTER_ID]: problem.normalOrigins['weapon.fixture.a'] })
    for (const [index, lower] of problem.targets.entries()) {
      const row = reach.targets[index]!
      const expected = [...lower.options].map(option => ({ ...option, resource: option.resource.replace(/^normal:weapon\.fixture\.a:/, `normal:${FIXTURE_NORMAL_COUNTER_ID}:`) }))
        .sort((left, right) => left.resource < right.resource ? -1 : 1)
      expect(thresholdsFromReach(row, reach)).toEqual(expected)
      expect(lower.firstIdealSkillPosition).toBe(row.skill.idealPositions[0] ?? null)
      expect(lower.firstIdealResetPosition).toBe(row.bonus.resetIdealPositions[0] ?? null)
    }
    // The protected Ideal Gogma is the zero-advance option of both, and the protected non-Ideal / protected Normal appear in neither.
    const a = problem.targets[0]!
    expect(a.options.find(option => option.resource === 'owned:owned.g2')).toEqual({ resource: 'owned:owned.g2', skillThreshold: 7, gogmaThreshold: 10, normalThreshold: null })
    expect(a.options.some(option => ['owned:owned.g3', 'owned:owned.n2'].includes(option.resource))).toBe(false)
  })
})
