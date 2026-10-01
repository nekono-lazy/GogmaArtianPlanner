import { describe, expect, it } from 'vitest'
import rawB2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json?raw'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, TargetWeapon } from '../domain/models/publicTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import {
  defaultPlannerAlternativeSearchExtent,
  emptyPlannerAlternativeReservation,
  normalizePlannerAlternativeReservation,
  selectSearchableNormalCounters,
  type PlannerAlternativeReservation,
} from '../domain/search'
import { IDEAL_SERIES_SKILL_ID, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import {
  phase2c26b2aExpandSegments,
  phase2c26b2aReachability,
  phase2c26b2aReservationRanges,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  type Phase2C26B2AOracle,
  type Phase2C26B2AOracleRouteSpec,
} from './plannerGlobalPhase2C26B2AAnalysis'
import {
  derivePhase2C26B2B1Snapshot,
  enumeratePhase2C26B2B1FixedSets,
  phase2c26b2b1FixedSetId,
  type Phase2C26B2B1Cardinality,
  type Phase2C26B2B1Snapshot,
} from './plannerGlobalPhase2C26B2B1'
import {
  derivePhase2C26B2C1Schedule,
  phase2c26b2c1ComparePolicy,
  phase2c26b2c1DefaultWindows,
  phase2c26b2c1Rank,
  phase2c26b2c1ReservationFeatures,
  phase2c26b2c1ScheduleFromSnapshot,
  phase2c26b2c1StreamGeometry,
  PHASE2C26B2C1_POLICIES,
  type Phase2C26B2C1Features,
  type Phase2C26B2C1Schedule,
  type Phase2C26B2C1SortableContext,
} from './plannerGlobalPhase2C26B2C1'
import b2c1Source from './plannerGlobalPhase2C26B2C1.ts?raw'
import {
  parsePhase2C26B2C1B2B1Authority,
  phase2c26b2c1Decision,
  phase2c26b2c1FirstCompatible,
  phase2c26b2c1Percentile,
  phase2c26b2c1PolicyAggregate,
  phase2c26b2c1RouteWithinWindows,
  phase2c26b2c1SelectPolicy,
  phase2c26b2c1Subgroups,
  runPhase2C26B2C1Audit,
  validatePhase2C26B2C1Schedule,
  PHASE2C26B2C1_DECISION_RULE,
  PHASE2C26B2C1_REGISTERED_B2B1,
  PHASE2C26B2C1_REGISTERED_POLICIES,
  PHASE2C26B2C1_SELECTION_RULE,
  type Phase2C26B2C1B2B1Authority,
} from './plannerGlobalPhase2C26B2C1Analysis'
import analysisSource from './plannerGlobalPhase2C26B2C1Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c1.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c1.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C1: the oracle-free reservation context schedule (calculation) and its post-hoc oracle
 * evaluation. The synthetic worlds below are invented for the tests; the committed B2-B1 RESULT is read only to check the
 * authority parser. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

const EXTENT = { ...defaultPlannerAlternativeSearchExtent }
const ORIGIN = { skill: 100, gogma: 10, normal: 0 }
const COUNTER = 'weapon.x:8'

// ---------------------------------------------------------------- default windows vs the B2-A extent

/** One synthetic oracle Route spec for the window boundary tests. */
function spec(options: { gogma?: number; skill?: number; conversion?: number; normalTarget?: number }): Phase2C26B2AOracleRouteSpec {
  const operations: Phase2C26B2AOracleRouteSpec['operations'][number][] = []
  if (options.normalTarget !== undefined) operations.push({ type: 'create_normal_artian', from: ORIGIN.normal, to: options.normalTarget })
  if (options.conversion !== undefined) operations.push({ type: 'convert_normal_to_gogma', from: options.conversion, to: options.conversion })
  if (options.skill !== undefined) operations.push({ type: 'reset_skills', from: options.skill, to: options.skill })
  if (options.gogma !== undefined) operations.push({ type: 'reset_bonuses', from: options.gogma, to: options.gogma })
  const ops = phase2c26b2aExpandSegments(operations)
  const last = (stream: string) => ops.filter(o => o.stream === stream).at(-1)?.position
  const isNew = options.normalTarget !== undefined
  return { targetWeaponId: 't-w', source: isNew ? { kind: 'new_normal', normalPosition: options.normalTarget! } : { kind: 'owned', ownedWeaponId: 'w-w' },
    materialization: 'candidate_search', routeKind: 'r', operations, required: { normal: isNew ? options.normalTarget! : null, skill: [], gogma: [] },
    estimated: { operations: ops.length, normal: isNew ? options.normalTarget! - ORIGIN.normal + 1 : null, gogma: last('gogma') === undefined ? 0 : last('gogma')! - ORIGIN.gogma + 1,
      skill: last('skill') === undefined ? 0 : last('skill')! - ORIGIN.skill + 1 } }
}

describe('Phase 2-C2.6-B2-C1 Production default windows', () => {
  const windows = phase2c26b2c1DefaultWindows(ORIGIN, EXTENT)

  it('states the 5.6.8 windows of the Production default extent from the Planner-start origin', () => {
    expect(windows).toEqual({
      normal: { from: 0, toExclusive: 4 }, skillExistingGogma: { from: 100, toExclusive: 104 }, skillConversion: { from: 100, toExclusive: 105 },
      skill: { from: 100, toExclusive: 105 }, gogma: { from: 10, toExclusive: 245 },
    })
    expect(phase2c26b2c1DefaultWindows({ ...ORIGIN, normal: null }, EXTENT).normal).toBeNull()
    expect(() => phase2c26b2c1DefaultWindows({ ...ORIGIN, skill: -1 }, EXTENT)).toThrow()
    expect(() => phase2c26b2c1DefaultWindows(ORIGIN, { ...EXTENT, maxGogmaAdvance: 0 })).toThrow()
  })

  it('agrees with the B2-A Route extent and the Production limit walk at every boundary', async () => {
    const cases: [string, Phase2C26B2AOracleRouteSpec, boolean][] = [
      ['gogma last inside', spec({ gogma: 244 }), true], ['gogma first outside', spec({ gogma: 245 }), false],
      ['existing Gogma Reset Skills last inside', spec({ skill: 103 }), true], ['existing Gogma Reset Skills first outside', spec({ skill: 104 }), false],
      ['conversion Route Skill last inside', spec({ normalTarget: 0, conversion: 100, skill: 104 }), true],
      ['conversion Route Skill first outside', spec({ normalTarget: 0, conversion: 100, skill: 105 }), false],
      ['production target last inside', spec({ normalTarget: 3, conversion: 100 }), true], ['production target first outside', spec({ normalTarget: 4, conversion: 100 }), false],
    ]
    for (const [name, routeSpec, within] of cases) {
      const view = phase2c26b2aRouteView(routeSpec, 'weapon.x')
      const extent = phase2c26b2aRouteExtent(view, ORIGIN, EXTENT)
      expect([name, extent.withinDefaultExtent]).toEqual([name, within])
      expect([name, phase2c26b2c1RouteWithinWindows(view, windows)]).toEqual([name, within])
      // With every passed position held, the Production walk cut at the extent limit says the same.
      // Every position from the origin through the last own operation that is not an own operation.
      const held = (origin: number, own: readonly number[]) => own.length === 0 ? [] : Array.from({ length: own.at(-1)! - origin }, (_, i) => origin + i).filter(p => !own.includes(p))
      const reservation = normalizePlannerAlternativeReservation({ normal: [{ counterId: COUNTER as never, held: held(0, view.normal.slice(0, 1)), blocked: [] }],
        skill: { held: held(100, view.skill), blocked: [] }, gogma: { held: held(10, view.gogma), blocked: [] }, exclusiveOwnedWeaponIds: [] })
      const reach = await phase2c26b2aReachability(view, reservation, ORIGIN, EXTENT)
      expect([name, reach.compatible, reach.productionLimitAccepts]).toEqual([name, true, within])
    }
  })
})

// ---------------------------------------------------------------- geometry and features

const stream = (held: number[], blocked: number[] = []) => ({ held, blocked })

describe('Phase 2-C2.6-B2-C1 reservation geometry', () => {
  it('counts held / blocked / shareable held over the whole stream and inside a half-open window', () => {
    expect(phase2c26b2c1StreamGeometry(stream([5, 6, 7, 8], [6, 8]), 'full')).toEqual({ held: 4, blocked: 2, shareableHeld: 2 })
    expect(phase2c26b2c1StreamGeometry(stream([5, 6, 7, 8], [6, 8]), { from: 6, toExclusive: 8 })).toEqual({ held: 2, blocked: 1, shareableHeld: 1 })
    expect(phase2c26b2c1StreamGeometry(stream([5, 6, 7, 8], [6, 8]), { from: 9, toExclusive: 20 })).toEqual({ held: 0, blocked: 0, shareableHeld: 0 })
    expect(phase2c26b2c1StreamGeometry(stream([5]), null)).toEqual({ held: 0, blocked: 0, shareableHeld: 0 })
    expect(phase2c26b2c1StreamGeometry(null, 'full')).toEqual({ held: 0, blocked: 0, shareableHeld: 0 })
  })

  it('fails closed on a duplicate position and on blocked outside held', () => {
    expect(() => phase2c26b2c1StreamGeometry(stream([5, 5]), 'full')).toThrow()
    expect(() => phase2c26b2c1StreamGeometry(stream([5, 6], [6, 6]), 'full')).toThrow()
    expect(() => phase2c26b2c1StreamGeometry(stream([5], [7]), 'full')).toThrow(/blocked/)
  })

  it('reads only the Target weapon-type Normal Counter and sums the three streams', () => {
    const windows = phase2c26b2c1DefaultWindows(ORIGIN, EXTENT)
    const reservation: PlannerAlternativeReservation = normalizePlannerAlternativeReservation({
      normal: [{ counterId: COUNTER as never, held: [0, 1, 2, 3, 4, 5], blocked: [3] }, { counterId: 'weapon.y:8' as never, held: [0, 1], blocked: [1] }],
      skill: { held: [100, 101, 104, 105, 120], blocked: [105] }, gogma: { held: [10, 244, 245], blocked: [244] }, exclusiveOwnedWeaponIds: ['w-1', 'w-2'] as never,
    })
    const features = phase2c26b2c1ReservationFeatures(reservation, COUNTER, windows)
    expect(features.exclusiveOwnedWeaponCount).toBe(2)
    expect(features.full).toEqual({ normalRelevant: { held: 6, blocked: 1, shareableHeld: 5 }, skill: { held: 5, blocked: 1, shareableHeld: 4 },
      gogma: { held: 3, blocked: 1, shareableHeld: 2 }, total: { held: 14, blocked: 3, shareableHeld: 11 } })
    expect(features.default).toEqual({ normalRelevant: { held: 4, blocked: 1, shareableHeld: 3 }, skill: { held: 3, blocked: 0, shareableHeld: 3 },
      gogma: { held: 2, blocked: 1, shareableHeld: 1 }, total: { held: 9, blocked: 2, shareableHeld: 7 } })
    // Another weapon type's Counter is never summed; no relevant Counter means Normal 0.
    expect(phase2c26b2c1ReservationFeatures(reservation, 'weapon.y:8', windows).full.normalRelevant).toEqual({ held: 2, blocked: 1, shareableHeld: 1 })
    expect(phase2c26b2c1ReservationFeatures(reservation, null, windows).full.normalRelevant).toEqual({ held: 0, blocked: 0, shareableHeld: 0 })
    expect(phase2c26b2c1ReservationFeatures(reservation, 'weapon.z:8', windows).default.normalRelevant).toEqual({ held: 0, blocked: 0, shareableHeld: 0 })
    expect(() => phase2c26b2c1ReservationFeatures({ ...reservation, exclusiveOwnedWeaponIds: ['w-1', 'w-1'] as never }, COUNTER, windows)).toThrow()
  })
})

// ---------------------------------------------------------------- policies

const geometry = (blocked: number, shareable: number) => ({ held: blocked + shareable, blocked, shareableHeld: shareable })
const zero = { held: 0, blocked: 0, shareableHeld: 0 }
function ctx(digest: string, card: Phase2C26B2B1Cardinality, exclusive: number, def: [number, number], full: [number, number]): Phase2C26B2C1SortableContext {
  const features: Phase2C26B2C1Features = { exclusiveOwnedWeaponCount: exclusive,
    full: { normalRelevant: zero, skill: zero, gogma: geometry(...full), total: geometry(...full) }, default: { normalRelevant: zero, skill: zero, gogma: geometry(...def), total: geometry(...def) } }
  return { reservationDigest: digest, targetEligibleMinCardinality: card, features }
}

describe('Phase 2-C2.6-B2-C1 policies', () => {
  it('keeps exactly the registered lexicographic keys, reservationDigest ASC last', () => {
    expect(stableStringify(PHASE2C26B2C1_POLICIES)).toBe(stableStringify(PHASE2C26B2C1_REGISTERED_POLICIES))
    expect(PHASE2C26B2C1_POLICIES.map(p => [p.id, p.name])).toEqual([['P0', 'stable_simple_first'], ['P1', 'default_simple_first'], ['P2', 'default_utility_first'], ['P3', 'full_utility_first']])
    for (const policy of PHASE2C26B2C1_POLICIES) expect(policy.keys.at(-1)).toEqual(['reservationDigest', 'asc'])
    // No weighted score such as `held * 3 - blocked * 10` anywhere in the calculation.
    expect(b2c1Source).not.toMatch(/\w+\s*\*\s*\d+\s*[-+]/)
  })

  const contexts = [
    ctx('d-k0', 0, 0, [0, 0], [0, 0]),
    ctx('d-a', 1, 1, [0, 50], [0, 50]),
    ctx('d-b', 1, 0, [2, 10], [2, 10]),
    ctx('d-c', 1, 0, [2, 30], [5, 900]),
    ctx('d-d', 2, 0, [0, 5], [0, 5]),
    ctx('d-e', 2, 0, [0, 5], [1, 5]),
    ctx('d-f', 1, 0, [1, 1], [9, 9]),
  ]
  const order = (id: string) => {
    const policy = PHASE2C26B2C1_POLICIES.find(p => p.id === id)!
    const ranks = phase2c26b2c1Rank(contexts, policy)
    return contexts.map((c, i) => [ranks[i]!, c.reservationDigest] as const).sort((a, b) => a[0] - b[0]).map(([, d]) => d)
  }

  it('ranks K0 first under every policy and orders the rest by the exact keys', () => {
    // P0: cardinality, digest.
    expect(order('P0')).toEqual(['d-k0', 'd-a', 'd-b', 'd-c', 'd-f', 'd-d', 'd-e'])
    // P1: cardinality, exclusive, default blocked, default shareable DESC, digest.
    expect(order('P1')).toEqual(['d-k0', 'd-f', 'd-c', 'd-b', 'd-a', 'd-d', 'd-e'])
    // P2: exclusive, default blocked, default shareable DESC, cardinality, digest.
    expect(order('P2')).toEqual(['d-k0', 'd-d', 'd-e', 'd-f', 'd-c', 'd-b', 'd-a'])
    // P3: exclusive, full blocked, full shareable DESC, cardinality, digest.
    expect(order('P3')).toEqual(['d-k0', 'd-d', 'd-e', 'd-b', 'd-c', 'd-f', 'd-a'])
  })

  it('breaks a full feature tie by reservationDigest and is independent of input order', () => {
    const tie = [ctx('k0', 0, 0, [0, 0], [0, 0]), ctx('z', 1, 0, [1, 1], [1, 1]), ctx('m', 1, 0, [1, 1], [1, 1]), ctx('a', 1, 0, [1, 1], [1, 1])]
    for (const policy of PHASE2C26B2C1_POLICIES) {
      const ranks = phase2c26b2c1Rank(tie, policy)
      expect(ranks).toEqual([1, 4, 3, 2])
      const reversed = [...tie].reverse()
      const ranksReversed = phase2c26b2c1Rank(reversed, policy)
      expect(reversed.map((c, i) => [c.reservationDigest, ranksReversed[i]]).sort()).toEqual(tie.map((c, i) => [c.reservationDigest, ranks[i]]).sort())
    }
    expect(phase2c26b2c1ComparePolicy(PHASE2C26B2C1_POLICIES[1]!, tie[1]!, tie[2]!)).toBeGreaterThan(0)
  })

  it('fails closed on equal keys, a missing K0 and a second K0', () => {
    const p0 = PHASE2C26B2C1_POLICIES[0]!
    expect(() => phase2c26b2c1Rank([ctx('k0', 0, 0, [0, 0], [0, 0]), ctx('x', 1, 0, [0, 0], [0, 0]), ctx('x', 1, 0, [0, 0], [0, 0])], p0)).toThrow(/equal keys/)
    expect(() => phase2c26b2c1Rank([ctx('x', 1, 0, [0, 0], [0, 0])], p0)).toThrow(/K0/)
    expect(() => phase2c26b2c1Rank([ctx('k0', 0, 0, [0, 0], [0, 0]), ctx('k0b', 0, 0, [0, 0], [0, 0])], p0)).toThrow(/K0/)
  })
})

// ---------------------------------------------------------------- the schedule over a synthetic snapshot

const res = (gogma: [number[], number[]], exclusive: string[] = []): PlannerAlternativeReservation =>
  normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: gogma[0], blocked: gogma[1] }, exclusiveOwnedWeaponIds: exclusive as never })
const union = (rs: PlannerAlternativeReservation[]) => normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] },
  gogma: { held: rs.flatMap(r => r.gogma.held), blocked: rs.flatMap(r => r.gogma.blocked) }, exclusiveOwnedWeaponIds: rs.flatMap(r => r.exclusiveOwnedWeaponIds) })

interface World { current: Record<string, PlannerAlternativeReservation>; invalid: Set<string>; targetOf: Record<string, string> }

/** A snapshot of the B2-B1 calculation's shape for a synthetic world (exactly what derivePhase2C26B2B1Snapshot() records). */
function syntheticSnapshot(world: World, options: { checkpoint?: string[] } = {}): Phase2C26B2B1Snapshot {
  const entryIds = Object.keys(world.current).sort()
  const groups: Phase2C26B2B1Snapshot['reservationGroups'] = []
  const keyToIndex = new Map<string, number>()
  const fixedSets = enumeratePhase2C26B2B1FixedSets(entryIds).map(ids => {
    const fixedSetId = phase2c26b2b1FixedSetId(ids)
    const cardinality = ids.length as Phase2C26B2B1Cardinality
    const valid = !world.invalid.has(fixedSetId)
    let reservationGroupIndex: number | null = null
    if (valid) {
      const reservation = ids.length === 0 ? normalizePlannerAlternativeReservation(emptyPlannerAlternativeReservation) : union(ids.map(id => world.current[id]!))
      const key = stableStringify(reservation)
      if (!keyToIndex.has(key)) { keyToIndex.set(key, groups.length); groups.push({ groupIndex: groups.length, reservationDigest: hashStableValue(reservation), reservation, aliasFixedSetIds: [], minCardinality: cardinality, aliasesByCardinality: { '0': 0, '1': 0, '2': 0 } }) }
      const group = groups[keyToIndex.get(key)!]!
      group.aliasFixedSetIds.push(fixedSetId)
      group.aliasesByCardinality[String(cardinality) as '0' | '1' | '2'] += 1
      group.minCardinality = Math.min(group.minCardinality, cardinality) as Phase2C26B2B1Cardinality
      reservationGroupIndex = group.groupIndex
    }
    return { fixedSetId, cardinality, fixedBuildListEntryIds: ids, fixedTargetWeaponIds: ids.map(id => world.targetOf[id]!).sort(), valid, routePlanRejectionEntryIds: [],
      conflicts: valid ? [] : [{ kind: 'same_gogma_counter', buildListEntryIds: ids }], invalidConflictKinds: valid ? [] : ['same_gogma_counter'], reservationGroupIndex }
  })
  const checkpoint = new Set(options.checkpoint ?? [])
  const targets = entryIds.map(id => ({ targetWeaponId: world.targetOf[id]!, currentBuildListEntryId: id, currentRouteKey: `key-${id}`, excludedRouteKeys: [`key-${id}`],
    checkpointHardConstraint: checkpoint.has(world.targetOf[id]!), initiallyRelevant: true, originSemanticDigest: `osd-${id}` }))
  const byId = new Map(fixedSets.map(r => [r.fixedSetId, r]))
  const targetContexts = targets.map(t => {
    if (t.checkpointHardConstraint) return { targetWeaponId: t.targetWeaponId, status: 'checkpoint_hard_constraint' as const, rawContexts: 0, contexts: [] }
    const contexts: [number, Phase2C26B2B1Cardinality, number][] = []
    let raw = 0
    for (const g of groups) {
      const eligible = g.aliasFixedSetIds.map(id => byId.get(id)!).filter(fs => !fs.fixedBuildListEntryIds.includes(t.currentBuildListEntryId))
      if (eligible.length === 0) continue
      raw += eligible.length
      contexts.push([g.groupIndex, Math.min(...eligible.map(fs => fs.cardinality)) as Phase2C26B2B1Cardinality, eligible.length])
    }
    return { targetWeaponId: t.targetWeaponId, status: 'searchable' as const, rawContexts: raw, contexts }
  })
  const invalidCount = fixedSets.filter(r => !r.valid).length
  return {
    input: { planningTargets: targets.length, allSearchEntries: targets.length, validBuildListEntries: targets.length, initialRelevantEntries: targets.length, routePlanRejections: 0,
      initialConflicts: invalidCount, checkpointHardConstraintTargets: targets.filter(t => t.checkpointHardConstraint).map(t => t.targetWeaponId) },
    originDigest: 'origin-digest',
    origin: { skillCounter: { value: ORIGIN.skill, isConfirmed: true }, gogmaCounter: { value: ORIGIN.gogma, isConfirmed: true }, normalCounters: [{ counterId: COUNTER, counter: ORIGIN.normal, isConfirmed: true }] },
    extent: EXTENT, targets, fixedSets, reservationGroups: groups, targetContexts,
    checks: { k0IsEmptyReservation: true, reservationsNormalized: true, unitPlansMatchInitialContext: true, reservationDigestsUnique: true,
      k2ConflictPairs: { k2Invalid: invalidCount, initialDetectionPairs: invalidCount, onlyK2: [], onlyInitialDetection: [], matches: true } },
  }
}

const scheduleOf = (snapshot: Phase2C26B2B1Snapshot) => phase2c26b2c1ScheduleFromSnapshot(snapshot, { skill: ORIGIN.skill, gogma: ORIGIN.gogma, relevantNormalCounter: () => ({ id: COUNTER, counter: ORIGIN.normal }) })

/** E-a reserves exactly what E-b and E-c reserve together: one reservation with K1 and K2 aliases. */
const ALIAS_WORLD: World = (() => {
  const b = res([[10, 11], [11]], ['w-b']), c = res([[13], [13]], ['w-c'])
  return { current: { 'E-a': union([b, c]), 'E-b': b, 'E-c': c, 'E-d': res([[20], [20]], ['w-d']) }, invalid: new Set(), targetOf: { 'E-a': 't-a', 'E-b': 't-b', 'E-c': 't-c', 'E-d': 't-d' } }
})()

describe('Phase 2-C2.6-B2-C1 schedule (calculation)', () => {
  it('recomputes the eligible minimum cardinality per Target from its own eligible aliases, never the group minimum', () => {
    const snapshot = syntheticSnapshot(ALIAS_WORLD)
    const schedule = scheduleOf(snapshot)
    expect(schedule.checks).toEqual({ ranksArePermutations: true, k0RankOne: true, digestsUniquePerTarget: true, contextsMatchSnapshot: true })
    const groupIndex = snapshot.fixedSets.find(r => r.fixedSetId === 'K1:E-a')!.reservationGroupIndex!
    const group = snapshot.reservationGroups[groupIndex]!
    expect([group.minCardinality, group.aliasFixedSetIds]).toEqual([1, ['K1:E-a', 'K2:E-a|E-b', 'K2:E-a|E-c', 'K2:E-b|E-c']])
    const row = (target: string) => schedule.contexts.find(c => c.targetWeaponId === target && c.groupIndex === groupIndex)!
    // t-a cannot use K1:E-a (its own Entry): K2 is its minimum, with the one alias that avoids E-a.
    expect([row('t-a').targetEligibleMinCardinality, row('t-a').eligibleAliasCount, row('t-a').representativeFixedSetId, row('t-a').representativeFixedTargetWeaponIds]).toEqual([2, 1, 'K2:E-b|E-c', ['t-b', 't-c']])
    // t-b may use K1:E-a and K2:E-a|E-c; the representative is the K1 alias.
    expect([row('t-b').targetEligibleMinCardinality, row('t-b').eligibleAliasCount, row('t-b').representativeFixedSetId]).toEqual([1, 2, 'K1:E-a'])
    // t-d uses all four; the representative is the first minimum alias by ID.
    expect([row('t-d').targetEligibleMinCardinality, row('t-d').eligibleAliasCount, row('t-d').representativeFixedSetId]).toEqual([1, 4, 'K1:E-a'])
    // The schedule identity is the reservation: one row per (Target, group), never one per alias.
    for (const target of schedule.targets) {
      const rows = schedule.contexts.filter(c => c.targetWeaponId === target.targetWeaponId)
      expect(new Set(rows.map(r => r.reservationDigest)).size).toBe(rows.length)
      expect(rows.filter(r => r.targetEligibleMinCardinality === 0).map(r => [r.representativeFixedSetId, r.ranks])).toEqual([['K0', { P0: 1, P1: 1, P2: 1, P3: 1 }]])
    }
    expect(validatePhase2C26B2C1Schedule(schedule)).toEqual({ valid: true, issues: [] })
  })

  it('builds no context for a checkpoint hard-constraint Target and leaves an invalid K2 out of every context', () => {
    const world: World = { ...ALIAS_WORLD, invalid: new Set(['K2:E-b|E-c']) }
    const schedule = scheduleOf(syntheticSnapshot(world, { checkpoint: ['t-d'] }))
    expect(schedule.targets.find(t => t.targetWeaponId === 't-d')!.contexts).toBe(0)
    expect(schedule.contexts.some(c => c.targetWeaponId === 't-d')).toBe(false)
    expect(schedule.contexts.some(c => c.representativeFixedSetId === 'K2:E-b|E-c')).toBe(false)
    // With K2:E-b|E-c invalid, t-a has no alias of the E-a reservation left at all.
    const groupIndex = schedule.snapshot.fixedSets.find(r => r.fixedSetId === 'K1:E-a')!.reservationGroupIndex!
    expect(schedule.contexts.some(c => c.targetWeaponId === 't-a' && c.groupIndex === groupIndex)).toBe(false)
    expect(validatePhase2C26B2C1Schedule(schedule).issues).toEqual([])
  })

  it('fails closed on a feature, rank, representative, window or policy drift', () => {
    const fresh = () => scheduleOf(syntheticSnapshot(ALIAS_WORLD))
    const issues = (mutate: (s: Phase2C26B2C1Schedule) => void) => { const s = fresh(); mutate(s); return validatePhase2C26B2C1Schedule(s).issues.join('\n') }
    expect(issues(s => { s.contexts[1]!.features.exclusiveOwnedWeaponCount += 1 })).toMatch(/feature drift/)
    expect(issues(s => { const [a, b] = s.contexts.filter(c => c.targetWeaponId === 't-d' && c.targetEligibleMinCardinality > 0); const t = a!.ranks.P2; a!.ranks.P2 = b!.ranks.P2; b!.ranks.P2 = t })).toMatch(/P2 ranks are not the deterministic order/)
    expect(issues(s => { s.contexts.find(c => c.representativeFixedSetId === 'K1:E-a' && c.targetWeaponId === 't-d')!.representativeFixedSetId = 'K2:E-a|E-b' })).toMatch(/not the Target-specific eligible groups/)
    expect(issues(s => { s.targets[0]!.windows.gogma.toExclusive += 1 })).toMatch(/default windows drift/)
    expect(issues(s => { (s as { policies: unknown }).policies = [...s.policies].reverse() })).toMatch(/policy definition drift/)
    expect(issues(s => { s.checks.k0RankOne = false })).toMatch(/calculation check k0RankOne failed/)
  })

  it('derives the schedule from a Planner input through the unchanged B2-B1 snapshot and the Production Normal Counter selection', () => {
    const t = (id: string) => orchestrationTarget(id, { priority: 3 })
    const targets: TargetWeapon[] = [t('target.b2c1.a'), t('target.b2c1.b'), t('target.b2c1.c'), t('target.b2c1.d')]
    const sources = [orchestrationSource('owned.b2c1.a'), orchestrationSource('owned.b2c1.b'), orchestrationSource('owned.b2c1.c'), orchestrationSource('owned.b2c1.d', { seriesSkillId: IDEAL_SERIES_SKILL_ID })]
    const entries: BuildListEntry[] = [
      orchestrationEntry('build-list.b2c1.a', targets[0]!, resetRoute('owned.b2c1.a', 10), { finalBonuses: idealBonuses() }),
      orchestrationEntry('build-list.b2c1.b', targets[1]!, resetRoute('owned.b2c1.b', 10), { finalBonuses: idealBonuses() }),
      orchestrationEntry('build-list.b2c1.c', targets[2]!, resetRoute('owned.b2c1.c', 11), { finalBonuses: idealBonuses() }),
      checkpointBonusEntry('build-list.b2c1.d', targets[3]!, 'owned.b2c1.d', sources[3]!),
    ]
    const built = orchestrationScenario({ engine: { resetResultAt: checkpointBonusResultAt }, targets, ownedWeapons: sources, entries })
    const deps = globalResearchDependencies(built.engine)
    const schedule = derivePhase2C26B2C1Schedule(built.input, deps)
    expect(stableStringify(schedule.snapshot)).toBe(stableStringify(derivePhase2C26B2B1Snapshot(built.input, globalResearchDependencies(built.engine))))
    expect(schedule.checks).toEqual({ ranksArePermutations: true, k0RankOne: true, digestsUniquePerTarget: true, contextsMatchSnapshot: true })
    const origin = createPlannerStartSearchOrigin(built.input)
    for (const target of schedule.targets) {
      const weapon = origin.targetWeapons.find(w => w.id === target.targetWeaponId)!
      expect(target.relevantNormalCounterId).toBe(selectSearchableNormalCounters(weapon, origin.normalCounters)[0]?.id ?? null)
    }
    expect(schedule.targets.find(t => t.targetWeaponId === 'target.b2c1.d')!.contexts).toBe(0)
    expect(schedule.contexts.some(c => c.representativeFixedSetId === 'K2:build-list.b2c1.a|build-list.b2c1.b')).toBe(false)
    expect(validatePhase2C26B2C1Schedule(schedule).issues).toEqual([])
  })
})

// ---------------------------------------------------------------- the post-hoc evaluation over a synthetic oracle world

/** The B2-B1 test world: a needs 10..11 held, c needs 10..12, d / e need 14 that nobody holds. */
const AUDIT_WORLD: World = {
  current: { 'E-a': res([[12], [12]], ['w-x1']), 'E-b': res([[10, 11], [11]], ['w-x2']), 'E-c': res([[13], [13]], ['w-x3']), 'E-d': res([[12], [12]], ['w-x4']), 'E-e': res([[15], [15]], ['w-x5']) },
  invalid: new Set(['K2:E-a|E-d']),
  targetOf: { 'E-a': 't-a', 'E-b': 't-b', 'E-c': 't-c', 'E-d': 't-d', 'E-e': 't-e' },
}
const SPECS: Phase2C26B2AOracleRouteSpec[] = [['t-a', 12], ['t-b', 10], ['t-c', 13], ['t-d', 16], ['t-e', 15]].map(([targetWeaponId, own]) => ({
  targetWeaponId: targetWeaponId as string, source: { kind: 'owned' as const, ownedWeaponId: `w-${String(targetWeaponId).slice(2)}` }, materialization: 'candidate_search' as const,
  routeKind: 'existing_gogma_keep_bonuses', operations: [{ type: 'keep_bonuses' as const, from: own as number, to: own as number }], required: { normal: null, skill: [], gogma: [own as number] },
  estimated: { operations: 1, normal: null, gogma: (own as number) - ORIGIN.gogma + 1, skill: 0 } }))

function oracleOf(specs: readonly Phase2C26B2AOracleRouteSpec[]): Phase2C26B2AOracle {
  return { exportSha256: 'e'.repeat(64), gogmaUsage: [], requiredSkillUsage: [], requiredNormalUsage: {}, manifestSha256: 'm',
    summary: { skill: { start: ORIGIN.skill, end: ORIGIN.skill }, gogma: { start: ORIGIN.gogma, end: 17 }, normal: {}, physicalOperations: 0 },
    routes: specs.map(s => ({ targetWeaponId: s.targetWeaponId, weaponTypeId: 'weapon.x', sourceKind: s.source.kind, sourceOwnedWeaponId: s.source.kind === 'owned' ? s.source.ownedWeaponId : null,
      normalPosition: null, conversionPosition: null, normal: null, skill: null, gogma: null, routeOperationCount: 1,
      materialization: { method: s.materialization, routeKind: s.routeKind, estimated: s.estimated, plannerRequired: { normal: null, skill: [], gogma: [...s.required.gogma] } } })) }
}

const sha = (value: string) => `sha(${value})`

/** A B2-B1 authority that records exactly what the B2-B1 analyzer would have for this world. */
async function syntheticAuthority(schedule: Phase2C26B2C1Schedule, flags: Record<string, { covered?: boolean; probeGap?: boolean }>): Promise<Phase2C26B2C1B2B1Authority> {
  const snapshot = schedule.snapshot
  const routes = []
  for (const s of SPECS) {
    const view = phase2c26b2aRouteView(s, 'weapon.x')
    const compatibleContexts = { '0': 0, '1': 0, '2': 0 }
    for (const [groupIndex, minCard] of snapshot.targetContexts.find(r => r.targetWeaponId === s.targetWeaponId)!.contexts) {
      if ((await phase2c26b2aReachability(view, snapshot.reservationGroups[groupIndex]!.reservation, ORIGIN, EXTENT)).compatible) compatibleContexts[String(minCard) as '0' | '1' | '2'] += 1
    }
    const minimal = compatibleContexts['0'] > 0 ? '0' : compatibleContexts['1'] > 0 ? '1' : compatibleContexts['2'] > 0 ? '2' : 'unreached'
    const extent = phase2c26b2aRouteExtent(view, ORIGIN, EXTENT)
    const f = flags[s.targetWeaponId] ?? {}
    routes.push({ targetWeaponId: s.targetWeaponId, b2a: { covered: f.covered ?? false, probeGap: f.probeGap ?? false, contextGap: !(f.covered || f.probeGap), conflictParticipant: true },
      minimalCardinality: minimal as '0' | '1' | '2' | 'unreached', compatibleContexts, withinDefaultExtent: extent.withinDefaultExtent,
      extent: { withinDefaultExtent: extent.withinDefaultExtent, verdict: extent.verdict, required: extent.required, reach: extent.reach }, supportTargetWeaponIds: ['t-b'] })
  }
  const count = (valid: boolean | null) => { const out = { '0': 0, '1': 0, '2': 0 }; for (const r of snapshot.fixedSets) if (valid === null || r.valid === valid) out[String(r.cardinality) as '0' | '1' | '2'] += 1; return out }
  return {
    measuredHead: 'a'.repeat(40), analysisHead: 'b'.repeat(40), exportSha256: 'e'.repeat(64), oracleResultSha256: 'o'.repeat(64), oracleManifestFileSha256: 'f'.repeat(64), oracleManifestRoutesSha256: 'r'.repeat(64),
    origin: { skill: ORIGIN.skill, gogma: ORIGIN.gogma, normal: { [COUNTER]: ORIGIN.normal } }, originDigest: snapshot.originDigest,
    targets: snapshot.targets.map(t => ({ targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, currentRouteKeySha256: sha(t.currentRouteKey), checkpointHardConstraint: t.checkpointHardConstraint, originSemanticDigest: t.originSemanticDigest })),
    fixedSets: { proposed: count(null), valid: count(true), invalid: count(false), invalidFixedSetIds: snapshot.fixedSets.filter(r => !r.valid).map(r => r.fixedSetId).sort() },
    groups: snapshot.reservationGroups.map(g => ({ groupIndex: g.groupIndex, reservationDigest: g.reservationDigest, minCardinality: g.minCardinality, aliasFixedSetIds: g.aliasFixedSetIds, reservation: phase2c26b2aReservationRanges(g.reservation) })),
    perTarget: snapshot.targetContexts.map(r => ({ targetWeaponId: r.targetWeaponId, status: r.status, rawContexts: r.rawContexts, uniqueContexts: r.contexts.length,
      byMinCardinality: r.contexts.reduce<Record<string, number>>((acc, c) => { acc[c[1]] = (acc[c[1]] ?? 0) + 1; return acc }, {}) })),
    routes,
  }
}

const SYNTHETIC_POPULATION = { targets: 5, subgroups: { recovered: 3, defaultExtent: 3, extentInsufficient: 0, contextGapRecovered: 2, b2aCovered: 1, probeGap: 0, k1Minimal: 1, k2Minimal: 1, unreached: 2 } }

async function audit(mutate?: (input: { schedule: Phase2C26B2C1Schedule; authority: Phase2C26B2C1B2B1Authority }) => void) {
  const schedule = scheduleOf(syntheticSnapshot(AUDIT_WORLD))
  const authority = await syntheticAuthority(schedule, { 't-b': { covered: true } })
  mutate?.({ schedule, authority })
  return runPhase2C26B2C1Audit({ schedule, authority, manifest: SPECS, oracle: oracleOf(SPECS), sha, expected: SYNTHETIC_POPULATION })
}

describe('Phase 2-C2.6-B2-C1 analysis', () => {
  it('reproduces the B2-B1 counts and finds the first compatible rank of every policy', async () => {
    const result = await audit()
    expect(result.invalidReasons).toEqual([])
    const row = (t: string) => result.rows.find(r => r.targetWeaponId === t)!
    expect([row('t-b').reach.minimalCardinality, row('t-a').reach.minimalCardinality, row('t-c').reach.minimalCardinality, row('t-d').reach.minimalCardinality]).toEqual(['0', '1', '2', 'unreached'])
    for (const policy of ['P0', 'P1', 'P2', 'P3'] as const) {
      expect(row('t-b').reach.firstCompatible[policy].rank).toBe(1)
      expect(row('t-d').reach.firstCompatible[policy].rank).toBeNull()
      expect(row('t-e').reach.firstCompatible[policy].rank).toBeNull()
      expect(row('t-a').reach.firstCompatible[policy]).toMatchObject({ representativeFixedSetId: 'K1:E-b', cardinality: 1 })
    }
    // t-c: P0 walks every K1 context first (4 eligible K1), then reaches the K2 pairs.
    expect(row('t-c').reach.firstCompatible.P0).toMatchObject({ cardinality: 2, k1Before: 4 })
    expect(row('t-c').reach.firstCompatible.P0.rank).toBe(1 + 4 + row('t-c').reach.firstCompatible.P0.k2Before + 1)
    expect(result.subgroupCounts).toEqual(SYNTHETIC_POPULATION.subgroups)
    expect(result.parity).toEqual({ valid: true, issues: [] })
    expect(result.selectionRows.map(r => r.policy)).toEqual(['P0', 'P1', 'P2', 'P3'])
    expect(result.decisionInput.recovered).toBe(3)
  })

  it('fails closed on a B2-B1 compatible-count, minimal-cardinality, universe or target drift', async () => {
    expect((await audit(({ authority }) => { authority.routes[0]!.compatibleContexts['2'] += 1 })).invalidReasons.join('\n')).toMatch(/b2b1_compatible_count/)
    expect((await audit(({ authority }) => { authority.routes.find(r => r.targetWeaponId === 't-c')!.minimalCardinality = '1' })).invalidReasons.join('\n')).toMatch(/b2b1_minimal_cardinality/)
    expect((await audit(({ authority }) => { authority.groups[1]!.aliasFixedSetIds = ['K1:E-x'] })).invalidReasons.join('\n')).toMatch(/semantic reservation groups differ/)
    expect((await audit(({ authority }) => { authority.perTarget[0]!.uniqueContexts += 1 })).invalidReasons.join('\n')).toMatch(/Target-specific context universe differs/)
    expect((await audit(({ authority }) => { authority.fixedSets.invalidFixedSetIds = [] })).invalidReasons.join('\n')).toMatch(/invalid K2 sets differ/)
    expect((await audit(({ authority }) => { authority.routes[0]!.extent = {} })).invalidReasons.join('\n')).toMatch(/extent: .*differs from B2-B1/)
    expect((await audit(({ authority }) => { authority.targets[0]!.currentRouteKeySha256 = 'x' })).invalidReasons.join('\n')).toMatch(/Route keys differ/)
    // An unreached Route with a finite rank (the authority says unreached, the reach finds it) is invalid.
    expect((await audit(({ authority }) => { authority.routes.find(r => r.targetWeaponId === 't-a')!.minimalCardinality = 'unreached' })).invalidReasons.join('\n')).toMatch(/an unreached Route has a finite/)
  })

  it('records whether the first compatible representative fixes an oracle supporter (diagnostic only)', () => {
    const rows = [
      { groupIndex: 0, reservationDigest: 'k0', targetEligibleMinCardinality: 0, representativeFixedSetId: 'K0', representativeFixedTargetWeaponIds: [], ranks: { P0: 1, P1: 1, P2: 1, P3: 1 } },
      { groupIndex: 1, reservationDigest: 'x', targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:E-x', representativeFixedTargetWeaponIds: ['t-x'], ranks: { P0: 2, P1: 3, P2: 3, P3: 3 } },
      { groupIndex: 2, reservationDigest: 'y', targetEligibleMinCardinality: 2, representativeFixedSetId: 'K2:E-y|E-z', representativeFixedTargetWeaponIds: ['t-y', 't-z'], ranks: { P0: 3, P1: 2, P2: 2, P3: 2 } },
    ] as never[]
    expect(phase2c26b2c1FirstCompatible(rows, new Set([1, 2]), 'P0', new Set(['t-x']))).toMatchObject({ rank: 2, cardinality: 1, k1Before: 0, k2Before: 0, representativeIncludesOracleSupporter: true })
    expect(phase2c26b2c1FirstCompatible(rows, new Set([1, 2]), 'P1', new Set(['t-x']))).toMatchObject({ rank: 2, cardinality: 2, representativeIncludesOracleSupporter: false })
    expect(phase2c26b2c1FirstCompatible(rows, new Set([1]), 'P1', null)).toMatchObject({ rank: 3, k2Before: 1, representativeIncludesOracleSupporter: null })
    expect(phase2c26b2c1FirstCompatible(rows, new Set(), 'P1', null)).toMatchObject({ rank: null, k1Before: 1, k2Before: 1 })
  })

  it('aggregates top-N coverage and nearest-rank percentiles', () => {
    expect(phase2c26b2c1Percentile([], 50)).toBeNull()
    expect(phase2c26b2c1Percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(phase2c26b2c1Percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(phase2c26b2c1Percentile([1, 2, 3, 4], 90)).toBe(4)
    const agg = phase2c26b2c1PolicyAggregate([1, 2, 8, 9, 300, null])
    expect(agg.cdf).toEqual({ top1: 1, top2: 2, top4: 2, top8: 3, top16: 4, top32: 4, top64: 4, top128: 4, top256: 4, all: 5 })
    expect(agg.rank).toEqual({ min: 1, median: 8, p75: 9, p90: 300, p95: 300, max: 300 })
    expect([agg.targets, agg.finite]).toEqual([6, 5])
  })

  it('assigns subgroups from the B2-B1 authority', () => {
    const route = (minimal: '1' | '2' | 'unreached', within: boolean, b2a: Partial<{ covered: boolean; probeGap: boolean; contextGap: boolean }>) =>
      ({ targetWeaponId: 't', b2a: { covered: false, probeGap: false, contextGap: false, conflictParticipant: true, ...b2a }, minimalCardinality: minimal, compatibleContexts: { '0': 0, '1': 0, '2': 0 },
        withinDefaultExtent: within, extent: {}, supportTargetWeaponIds: [] })
    expect(phase2c26b2c1Subgroups(route('1', false, { probeGap: true }))).toEqual(['recovered', 'extentInsufficient', 'probeGap', 'k1Minimal'])
    expect(phase2c26b2c1Subgroups(route('2', true, { contextGap: true }))).toEqual(['recovered', 'defaultExtent', 'contextGapRecovered', 'k2Minimal'])
    expect(phase2c26b2c1Subgroups(route('unreached', false, { contextGap: true }))).toEqual(['unreached'])
  })

  it('selects the Research policy by the registered lexicographic rule', () => {
    const row = (policy: 'P0' | 'P1' | 'P2' | 'P3', top8: number, top16: number, top32: number, p90: number | null, max: number | null) => ({ policy, top8, top16, top32, p90, max })
    expect(phase2c26b2c1SelectPolicy([row('P0', 10, 20, 30, 5, 9), row('P1', 11, 11, 11, 99, 99)]).policy).toBe('P1')
    expect(phase2c26b2c1SelectPolicy([row('P0', 10, 20, 30, 5, 9), row('P1', 10, 21, 21, 99, 99)]).policy).toBe('P1')
    expect(phase2c26b2c1SelectPolicy([row('P0', 10, 20, 30, 5, 9), row('P1', 10, 20, 31, 99, 99)]).policy).toBe('P1')
    expect(phase2c26b2c1SelectPolicy([row('P0', 10, 20, 30, 6, 9), row('P1', 10, 20, 30, 5, 99)]).policy).toBe('P1')
    expect(phase2c26b2c1SelectPolicy([row('P0', 10, 20, 30, 5, 9), row('P1', 10, 20, 30, 5, 8)]).policy).toBe('P1')
    expect(phase2c26b2c1SelectPolicy([row('P3', 10, 20, 30, 5, 9), row('P2', 10, 20, 30, 5, 9)]).policy).toBe('P2')
    expect(PHASE2C26B2C1_SELECTION_RULE.oracleGuidedPolicyEvaluation).toBe(true)
  })

  it('decides TOP8 / TOP16 / TOP32 / WIDE / INVALID by the registered rule', () => {
    const decide = (ranks: number[], invalidReasons: string[] = [], recovered = ranks.length) => phase2c26b2c1Decision({ invalidReasons, recovered, selectedFiniteRanks: ranks }).case
    expect(decide([1, 8, 2])).toBe('B2C1_TOP8')
    expect(decide([1, 9])).toBe('B2C1_TOP16')
    expect(decide([16, 17])).toBe('B2C1_TOP32')
    expect(decide([32, 33])).toBe('B2C1_WIDE')
    expect(decide([1], ['b2b1_parity: x'])).toBe('B2C1_INVALID')
    expect(decide([1, 2], [], 3)).toBe('B2C1_INVALID')
    expect(decide([], [], 0)).toBe('B2C1_INVALID')
    expect(() => decide([0])).toThrow()
    expect(PHASE2C26B2C1_DECISION_RULE.order[0]).toMatch(/^B2C1_INVALID/)
  })
})

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-B2-C1 B2-B1 authority', () => {
  const json = JSON.parse(rawB2B1)
  const registeredSha = PHASE2C26B2C1_REGISTERED_B2B1.resultSha256
  it('accepts the committed formal B2-B1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C1B2B1Authority(json, registeredSha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.routes.length).toBe(43)
    expect(parsed.authority!.groups.length).toBe(879)
    expect(parsed.authority!.perTarget.reduce((sum, r) => sum + r.uniqueContexts, 0)).toBe(36084)
    expect(parsed.authority!.routes.filter(r => r.b2a.probeGap).map(r => [r.minimalCardinality, r.withinDefaultExtent])).toEqual([['1', false]])
    expect(parsePhase2C26B2C1B2B1Authority(json, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof json) => void) => { const copy = structuredClone(json); patch(copy); return parsePhase2C26B2C1B2B1Authority(copy, registeredSha).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2B1_ALL_ELIGIBLE_RECOVERED' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.aggregates.all.minimalCardinality['2'] = 8 })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.recoveredWithinDefaultExtent = 17 })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { b2a: { probeGap: boolean } }) => r.b2a.probeGap).extent.withinDefaultExtent = true })).toBe(false)
    expect(mutate(j => { j.routes.pop() })).toBe(false)
    expect(mutate(j => { j.contexts.uniqueSemanticContexts = 1 })).toBe(false)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-C1 isolation', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C1/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [b2c1Source, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|46bf2c78|c140578c|02876df4/)
    }
    for (const source of [b2c1Source, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, the manifest and every earlier RESULT out of the calculation: only the analyzer reads them, after the schedule', () => {
    for (const source of [b2c1Source, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2b1-result|--b2b2a2-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|supportTargetWeaponIds|minimalAliases|Analysis|B2B2A|oracleSupport/)
    }
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/--b2b1-result/)
    // The B2-B2A2 RESULT is hashed as provenance only, never parsed.
    expect(analyzerSource).not.toMatch(/JSON\.parse\(b2b2a2/)
    // The oracle support enters only the diagnostic flag, never a rank.
    expect(analysisSource).not.toMatch(/ranks\[[^\]]*\]\s*=|phase2c26b2c1Rank\([^)]*support/)
  })

  it('runs no Search, kernel, trial or Planner: the calculation derives a schedule, the analysis reads only', () => {
    for (const source of [b2c1Source, runnerSource, analysisSource, analyzerSource]) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|searchCandidates\(|runPhase2C26B1SearchTask|runPhase2C2SearchContext|runPhase2C2Kernel|runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|createDeterministicMaterializer|enumerateConstrainedCandidates/)
    }
    expect(b2c1Source).toMatch(/derivePhase2C26B2B1Snapshot\(/)
    expect(b2c1Source).toMatch(/selectSearchableNormalCounters\(/)
    expect(analysisSource).toMatch(/phase2c26b2aReachability\(/)
    expect(analysisSource).toMatch(/phase2c26b2aRouteExtent\(/)
    expect(analysisSource).toMatch(/validatePhase2C26B2B1Snapshot\(/)
    expect(analyzerSource).toMatch(/const decision = !formal && !allowNonformal \? null :/)
  })
})
