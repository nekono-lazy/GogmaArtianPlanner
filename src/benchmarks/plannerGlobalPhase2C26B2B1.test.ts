import { describe, expect, it } from 'vitest'
import rawB2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json?raw'
import rawOracle from '../../docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json?raw'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, TargetWeapon } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  emptyPlannerAlternativeReservation,
  normalizePlannerAlternativeReservation,
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
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import {
  phase2c26b2aExpandSegments,
  phase2c26b2aOccupancy,
  phase2c26b2aReachability,
  phase2c26b2aReservationRanges,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  phase2c26b2aSupport,
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
import b2b1Source from './plannerGlobalPhase2C26B2B1.ts?raw'
import {
  parsePhase2C26B2B1B2AAuthority,
  phase2c26b2b1Decision,
  phase2c26b2b1Distribution,
  phase2c26b2b1ReachRow,
  runPhase2C26B2B1Audit,
  validatePhase2C26B2B1Snapshot,
  PHASE2C26B2B1_DECISION_RULE,
  PHASE2C26B2B1_REGISTERED_B2A,
  type Phase2C26B2B1B2AAuthority,
} from './plannerGlobalPhase2C26B2B1Analysis'
import analysisSource from './plannerGlobalPhase2C26B2B1Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2b1.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2b1.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-B1: the all-current K0 / K1 / K2 fixed-set reservation snapshot (calculation) and the
 * post-hoc oracle reachability audit. The synthetic worlds below are invented for the tests; the committed B2-A RESULT is
 * read only to check the authority parser. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

// ---------------------------------------------------------------- enumeration

describe('Phase 2-C2.6-B2-B1 fixed-set enumeration', () => {
  it('lists K0, every K1 and every unordered K2 pair once, deterministically in Entry ID order', () => {
    const sets = enumeratePhase2C26B2B1FixedSets(['e-c', 'e-a', 'e-b'])
    expect(sets).toEqual([[], ['e-a'], ['e-b'], ['e-c'], ['e-a', 'e-b'], ['e-a', 'e-c'], ['e-b', 'e-c']])
    expect(enumeratePhase2C26B2B1FixedSets(['e-b', 'e-c', 'e-a'])).toEqual(sets)
    const n = 43
    const big = enumeratePhase2C26B2B1FixedSets(Array.from({ length: n }, (_, i) => `e-${String(i).padStart(2, '0')}`))
    expect(big.length).toBe(1 + n + (n * (n - 1)) / 2)
    const ids = big.map(phase2c26b2b1FixedSetId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(big.filter(s => s.length === 2).every(([a, b]) => a! < b!)).toBe(true)
    expect(() => enumeratePhase2C26B2B1FixedSets(['e-a', 'e-a'])).toThrow()
  })

  it('names a fixed set by its sorted Entry IDs, never by order', () => {
    expect(phase2c26b2b1FixedSetId([])).toBe('K0')
    expect(phase2c26b2b1FixedSetId(['e-b', 'e-a'])).toBe('K2:e-a|e-b')
    expect(phase2c26b2b1FixedSetId(['e-a', 'e-b'])).toBe('K2:e-a|e-b')
    expect(() => phase2c26b2b1FixedSetId(['e-a', 'e-a'])).toThrow()
  })
})

// ---------------------------------------------------------------- calculation over a synthetic Planner input

const SOURCES = { a: 'owned.b2b1.a', a2: 'owned.b2b1.a2', b: 'owned.b2b1.b', c: 'owned.b2b1.c', d: 'owned.b2b1.d' }

function scenario(options: { duplicate?: boolean; sharedAction?: boolean } = {}) {
  const t = (id: string) => orchestrationTarget(id, { priority: 3 })
  const targets: TargetWeapon[] = [t('target.b2b1.a'), t('target.b2b1.b'), t('target.b2b1.c'), t('target.b2b1.d')]
  const sources = [orchestrationSource(SOURCES.a), orchestrationSource(SOURCES.b), orchestrationSource(SOURCES.c), orchestrationSource(SOURCES.d, { seriesSkillId: IDEAL_SERIES_SKILL_ID })]
  const entries: BuildListEntry[] = [
    orchestrationEntry('build-list.b2b1.a', targets[0]!, resetRoute(SOURCES.a, 10), { finalBonuses: idealBonuses() }),
    // b fights a over Gogma 10 with another weapon: a Conflict.
    orchestrationEntry('build-list.b2b1.b', targets[1]!, resetRoute(SOURCES.b, 10), { finalBonuses: idealBonuses() }),
    // c operates at Gogma 11 only: never a Conflict with a.
    orchestrationEntry('build-list.b2b1.c', targets[2]!, resetRoute(SOURCES.c, 11), { finalBonuses: idealBonuses() }),
  ]
  // d carries a selected checkpoint: its Target is a hard constraint, yet its Entry may still be fixed.
  entries.push(checkpointBonusEntry('build-list.b2b1.d', targets[3]!, SOURCES.d, sources[3]!))
  if (options.sharedAction) {
    const a2 = t('target.b2b1.a2')
    targets.push(a2)
    // The same physical action as a (same weapon, same operation, same Counter): shareable, never a Conflict.
    entries.push(orchestrationEntry('build-list.b2b1.a2', a2, resetRoute(SOURCES.a, 10), { finalBonuses: idealBonuses() }))
  }
  if (options.duplicate) entries.push(orchestrationEntry('build-list.b2b1.a-dup', targets[0]!, resetRoute(SOURCES.a, 12), { finalBonuses: idealBonuses() }))
  return orchestrationScenario({ engine: { resetResultAt: checkpointBonusResultAt }, targets, ownedWeapons: sources, entries })
}

describe('Phase 2-C2.6-B2-B1 snapshot (calculation)', () => {
  it('judges validity by the Planner authorities, derives every reservation through Production, and never fixes the searched Target', () => {
    const built = scenario()
    const deps = globalResearchDependencies(built.engine)
    const snapshot = derivePhase2C26B2B1Snapshot(built.input, deps)
    expect(Object.values(snapshot.checks).every(v => v === true || (typeof v === 'object' && v.matches))).toBe(true)
    expect(snapshot.fixedSets.map(r => r.fixedSetId)).toEqual(enumeratePhase2C26B2B1FixedSets(snapshot.targets.map(t => t.currentBuildListEntryId)).map(phase2c26b2b1FixedSetId))
    const byId = new Map(snapshot.fixedSets.map(r => [r.fixedSetId, r]))
    const ab = byId.get('K2:build-list.b2b1.a|build-list.b2b1.b')!
    expect([ab.valid, ab.invalidConflictKinds, ab.reservationGroupIndex]).toEqual([false, ['same_gogma_counter'], null])
    expect(byId.get('K2:build-list.b2b1.a|build-list.b2b1.c')!.valid).toBe(true)
    // Every valid set's reservation is exactly derivePlannerAlternativeReservation() of its Entries.
    const entries = new Map(built.input.buildListEntries.map(e => [e.id as string, e]))
    for (const row of snapshot.fixedSets.filter(r => r.valid)) {
      const expected = derivePlannerAlternativeReservation(row.fixedBuildListEntryIds.map(id => entries.get(id)!), built.engine)
      expect(snapshot.reservationGroups[row.reservationGroupIndex!]!.reservation).toEqual(expected)
    }
    // K0 is the Production empty reservation.
    expect(snapshot.reservationGroups[snapshot.fixedSets[0]!.reservationGroupIndex!]!.reservation).toEqual(normalizePlannerAlternativeReservation(emptyPlannerAlternativeReservation))
    // The checkpoint Target gets no context, but its Entry is fixed in other Targets' contexts.
    const d = snapshot.targets.find(t => t.targetWeaponId === 'target.b2b1.d')!
    expect(d.checkpointHardConstraint).toBe(true)
    expect(snapshot.targetContexts.find(r => r.targetWeaponId === 'target.b2b1.d')).toEqual({ targetWeaponId: 'target.b2b1.d', status: 'checkpoint_hard_constraint', rawContexts: 0, contexts: [] })
    expect(snapshot.input.checkpointHardConstraintTargets).toEqual(['target.b2b1.d'])
    const dGroup = byId.get('K1:build-list.b2b1.d')!.reservationGroupIndex!
    expect(snapshot.targetContexts.find(r => r.targetWeaponId === 'target.b2b1.a')!.contexts.some(c => c[0] === dGroup)).toBe(true)
    // No Target's context is built from a fixed set holding its own current Entry.
    for (const row of snapshot.targetContexts) {
      const own = snapshot.targets.find(t => t.targetWeaponId === row.targetWeaponId)!.currentBuildListEntryId
      for (const [groupIndex, minCard, count] of row.contexts) {
        const eligible = snapshot.reservationGroups[groupIndex]!.aliasFixedSetIds.map(id => byId.get(id)!).filter(fs => !fs.fixedBuildListEntryIds.includes(own))
        expect([eligible.length, Math.min(...eligible.map(fs => fs.cardinality))]).toEqual([count, minCard])
      }
      expect(snapshot.reservationGroups.filter(g => g.aliasFixedSetIds.every(id => byId.get(id)!.fixedBuildListEntryIds.includes(own))).some(g => row.contexts.some(c => c[0] === g.groupIndex))).toBe(false)
    }
    // The excluded Route is the current Route only; the extent is the Production default; the origin is the Planner-start origin.
    for (const target of snapshot.targets) {
      const entry = entries.get(target.currentBuildListEntryId)!
      expect(target.excludedRouteKeys).toEqual([candidateStableKey(entry.candidateSnapshot)])
    }
    expect(snapshot.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(snapshot.originDigest).toBe(hashStableValue(createPlannerStartSearchOrigin(built.input)))
    expect(validatePhase2C26B2B1Snapshot(snapshot)).toMatchObject({ valid: true, issues: [] })
  })

  it('never invalidates a pair sharing one shareable physical action, and keeps every alias of one reservation', () => {
    const built = scenario({ sharedAction: true })
    const snapshot = derivePhase2C26B2B1Snapshot(built.input, globalResearchDependencies(built.engine))
    const byId = new Map(snapshot.fixedSets.map(r => [r.fixedSetId, r]))
    const pair = byId.get('K2:build-list.b2b1.a|build-list.b2b1.a2')!
    expect([pair.valid, pair.conflicts]).toEqual([true, []])
    // a, a2 and {a, a2} reserve the same positions and the same weapon: one group, three aliases, minimum K1.
    const group = snapshot.reservationGroups[pair.reservationGroupIndex!]!
    expect(group.aliasFixedSetIds).toEqual(['K1:build-list.b2b1.a', 'K1:build-list.b2b1.a2', 'K2:build-list.b2b1.a|build-list.b2b1.a2'])
    expect([group.minCardinality, group.aliasesByCardinality]).toEqual([1, { '0': 0, '1': 2, '2': 1 }])
    // Target a may search it through {a2} only; a2 through {a} only; another Target through all three. Same reservation, different contexts.
    const ctx = (target: string) => snapshot.targetContexts.find(r => r.targetWeaponId === target)!.contexts.find(c => c[0] === group.groupIndex)
    expect(ctx('target.b2b1.a')).toEqual([group.groupIndex, 1, 1])
    expect(ctx('target.b2b1.a2')).toEqual([group.groupIndex, 1, 1])
    expect(ctx('target.b2b1.c')).toEqual([group.groupIndex, 1, 3])
    expect(validatePhase2C26B2B1Snapshot(snapshot).issues).toEqual([])
    // The initial detection lists a, a2 and b in one Conflict at Gogma 10; only the shareable pair is not a K2 Conflict.
    expect(snapshot.checks.k2ConflictPairs).toMatchObject({ onlyK2: [], onlyInitialDetection: ['K2:build-list.b2b1.a|build-list.b2b1.a2'], matches: true })
    expect(byId.get('K2:build-list.b2b1.a2|build-list.b2b1.b')!.invalidConflictKinds).toEqual(['same_gogma_counter'])
  })

  it('fails closed instead of picking a representative Entry', () => {
    const built = scenario({ duplicate: true })
    expect(() => derivePhase2C26B2B1Snapshot(built.input, globalResearchDependencies(built.engine))).toThrow()
  })
})

// ---------------------------------------------------------------- a synthetic snapshot and oracle world (analysis)

const ORIGIN = { skill: 100, gogma: 10, normal: 0 }
const COUNTER = 'weapon.x:8'
const EXTENT = { ...defaultPlannerAlternativeSearchExtent }
const res = (gogma: [number[], number[]], exclusive: string[] = []): PlannerAlternativeReservation =>
  normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: gogma[0], blocked: gogma[1] }, exclusiveOwnedWeaponIds: exclusive as never })
const union = (rs: PlannerAlternativeReservation[]) => normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] },
  gogma: { held: rs.flatMap(r => r.gogma.held), blocked: rs.flatMap(r => r.gogma.blocked) }, exclusiveOwnedWeaponIds: rs.flatMap(r => r.exclusiveOwnedWeaponIds) })

/** Owned Gogma Routes: one Gogma lane each. a needs 10..11 held, c needs 10..12, e needs 10..14 (nobody holds 14). */
const SPECS: Phase2C26B2AOracleRouteSpec[] = [
  { targetWeaponId: 't-a', own: 12, sourceId: 'w-a' }, { targetWeaponId: 't-b', own: 10, sourceId: 'w-b' }, { targetWeaponId: 't-c', own: 13, sourceId: 'w-c' },
  { targetWeaponId: 't-d', own: 16, sourceId: 'w-d' }, { targetWeaponId: 't-e', own: 15, sourceId: 'w-e' },
].map(({ targetWeaponId, own, sourceId }) => ({ targetWeaponId, source: { kind: 'owned' as const, ownedWeaponId: sourceId }, materialization: 'candidate_search' as const,
  routeKind: 'existing_gogma_keep_bonuses', operations: [{ type: 'keep_bonuses' as const, from: own, to: own }], required: { normal: null, skill: [], gogma: [own] },
  estimated: { operations: 1, normal: null, gogma: own - ORIGIN.gogma + 1, skill: 0 } }))

function oracleOf(specs: readonly Phase2C26B2AOracleRouteSpec[]): Phase2C26B2AOracle {
  return { exportSha256: 'e'.repeat(64), gogmaUsage: [], requiredSkillUsage: [], requiredNormalUsage: {}, manifestSha256: 'm',
    summary: { skill: { start: ORIGIN.skill, end: ORIGIN.skill }, gogma: { start: ORIGIN.gogma, end: 17 }, normal: { [COUNTER]: { start: ORIGIN.normal, end: ORIGIN.normal } }, physicalOperations: 0 },
    routes: specs.map(spec => {
      const ops = phase2c26b2aExpandSegments(spec.operations)
      return { targetWeaponId: spec.targetWeaponId, weaponTypeId: 'weapon.x', sourceKind: spec.source.kind, sourceOwnedWeaponId: spec.source.kind === 'owned' ? spec.source.ownedWeaponId : null,
        normalPosition: null, conversionPosition: null, normal: null, skill: null, gogma: { first: ops[0]!.position, last: ops[0]!.position, operations: 1, required: [...spec.required.gogma] },
        routeOperationCount: ops.length, materialization: { method: spec.materialization, routeKind: spec.routeKind, estimated: spec.estimated, plannerRequired: { normal: spec.required.normal, skill: [...spec.required.skill], gogma: [...spec.required.gogma] } } }
    }) }
}

/** Current Entries: b holds 10..11 (blocks 11), a holds 12 (blocks 12), d holds 12 (blocks 12), c holds 13, e holds 15. a and d conflict. */
const CURRENT: Record<string, PlannerAlternativeReservation> = {
  'E-a': res([[12], [12]], ['w-x1']), 'E-b': res([[10, 11], [11]], ['w-x2']), 'E-c': res([[13], [13]], ['w-x3']), 'E-d': res([[12], [12]], ['w-x4']), 'E-e': res([[15], [15]], ['w-x5']),
}
const INVALID_PAIRS = new Set(['K2:E-a|E-d'])
const TARGET_OF: Record<string, string> = { 'E-a': 't-a', 'E-b': 't-b', 'E-c': 't-c', 'E-d': 't-d', 'E-e': 't-e' }

/** A snapshot of the calculation's shape for the synthetic world (validated by validatePhase2C26B2B1Snapshot()). */
function syntheticSnapshot(options: { checkpoint?: string[] } = {}): Phase2C26B2B1Snapshot {
  const entryIds = Object.keys(CURRENT).sort()
  const groups: Phase2C26B2B1Snapshot['reservationGroups'] = []
  const keyToIndex = new Map<string, number>()
  const fixedSets = enumeratePhase2C26B2B1FixedSets(entryIds).map(ids => {
    const fixedSetId = phase2c26b2b1FixedSetId(ids)
    const cardinality = ids.length as Phase2C26B2B1Cardinality
    const valid = !INVALID_PAIRS.has(fixedSetId)
    let reservationGroupIndex: number | null = null
    if (valid) {
      const reservation = ids.length === 0 ? normalizePlannerAlternativeReservation(emptyPlannerAlternativeReservation) : union(ids.map(id => CURRENT[id]!))
      const key = stableStringify(reservation)
      if (!keyToIndex.has(key)) { keyToIndex.set(key, groups.length); groups.push({ groupIndex: groups.length, reservationDigest: hashStableValue(reservation), reservation, aliasFixedSetIds: [], minCardinality: cardinality, aliasesByCardinality: { '0': 0, '1': 0, '2': 0 } }) }
      const group = groups[keyToIndex.get(key)!]!
      group.aliasFixedSetIds.push(fixedSetId)
      group.aliasesByCardinality[String(cardinality) as '0' | '1' | '2'] += 1
      group.minCardinality = Math.min(group.minCardinality, cardinality) as Phase2C26B2B1Cardinality
      reservationGroupIndex = group.groupIndex
    }
    return { fixedSetId, cardinality, fixedBuildListEntryIds: ids, fixedTargetWeaponIds: ids.map(id => TARGET_OF[id]!).sort(), valid, routePlanRejectionEntryIds: [],
      conflicts: valid ? [] : [{ kind: 'same_gogma_counter', buildListEntryIds: ids }], invalidConflictKinds: valid ? [] : ['same_gogma_counter'], reservationGroupIndex }
  })
  const checkpoint = new Set(options.checkpoint ?? [])
  const targets = entryIds.map(id => ({ targetWeaponId: TARGET_OF[id]!, currentBuildListEntryId: id, currentRouteKey: `key-${id}`, excludedRouteKeys: [`key-${id}`],
    checkpointHardConstraint: checkpoint.has(TARGET_OF[id]!), initiallyRelevant: true, originSemanticDigest: `osd-${id}` }))
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
  return {
    input: { planningTargets: targets.length, allSearchEntries: targets.length, validBuildListEntries: targets.length, initialRelevantEntries: targets.length, routePlanRejections: 0,
      initialConflicts: 1, checkpointHardConstraintTargets: targets.filter(t => t.checkpointHardConstraint).map(t => t.targetWeaponId) },
    originDigest: 'origin-digest',
    origin: { skillCounter: { value: ORIGIN.skill, isConfirmed: true }, gogmaCounter: { value: ORIGIN.gogma, isConfirmed: true }, normalCounters: [{ counterId: COUNTER, counter: ORIGIN.normal, isConfirmed: true }] },
    extent: EXTENT, targets, fixedSets, reservationGroups: groups, targetContexts,
    checks: { k0IsEmptyReservation: true, reservationsNormalized: true, unitPlansMatchInitialContext: true, reservationDigestsUnique: true,
      k2ConflictPairs: { k2Invalid: 1, initialDetectionPairs: 1, onlyK2: [], onlyInitialDetection: [], matches: true } },
  }
}

const sha = (value: string) => `sha(${value})`

/** A B2-A authority whose single-winner contexts, verdicts and extents are what the B2-A analyzer would have recorded. */
async function syntheticAuthority(snapshot: Phase2C26B2B1Snapshot, singleWinner: { target: string; fixed: string }[], gaps: Record<string, { covered?: boolean; probeGap?: boolean; contextGap?: boolean; participant?: boolean; held?: boolean }>): Promise<Phase2C26B2B1B2AAuthority> {
  const groupOfK1 = (entry: string) => snapshot.reservationGroups[snapshot.fixedSets.find(r => r.fixedSetId === `K1:${entry}`)!.reservationGroupIndex!]!.reservation
  const views = new Map(SPECS.map(spec => [spec.targetWeaponId, phase2c26b2aRouteView(spec, 'weapon.x')]))
  const origins = { skill: ORIGIN.skill, gogma: ORIGIN.gogma, normal: ORIGIN.normal }
  const rows = singleWinner.map(({ target, fixed }, i) => {
    const t = snapshot.targets.find(x => x.targetWeaponId === target)!
    const reservation = groupOfK1(fixed)
    const body = { orientationId: '', workIndex: 0, targetWeaponId: target, status: 'searchable' as const, invalidatedBuildListEntryId: t.currentBuildListEntryId, invalidatedRouteKey: t.currentRouteKey,
      fixedRouteBuildListEntryIds: [fixed], reservation, searchReservation: reservation, excludedRouteKeys: t.excludedRouteKeys, extent: EXTENT, originDigest: snapshot.originDigest, contextDigest: '' }
    return { orientationId: `o${i}`, workIndex: 0, targetWeaponId: target, status: 'searchable', searchInputDigest: phase2c26b1SearchInputDigest(body), originDigest: snapshot.originDigest,
      fixedRouteBuildListEntryIds: [fixed], invalidatedBuildListEntryId: t.currentBuildListEntryId, excludedRouteKeySha256s: t.excludedRouteKeys.map(sha), extent: EXTENT,
      reservation: phase2c26b2aReservationRanges(reservation) }
  })
  const occupancy = phase2c26b2aOccupancy([...views.values()])
  const routes = []
  for (const spec of SPECS) {
    const view = views.get(spec.targetWeaponId)!
    const g = gaps[spec.targetWeaponId] ?? {}
    const contexts = []
    for (const [i, row] of rows.entries()) {
      if (row.targetWeaponId !== spec.targetWeaponId) continue
      contexts.push({ orientationId: `o${i}`, workIndex: 0, fixedTargetWeaponId: TARGET_OF[row.fixedRouteBuildListEntryIds[0]!]!,
        reservation: phase2c26b2b1ReachRow(await phase2c26b2aReachability(view, groupOfK1(row.fixedRouteBuildListEntryIds[0]!), origins, EXTENT)) })
    }
    routes.push({ targetWeaponId: spec.targetWeaponId, conflictParticipant: g.participant ?? true, covered: g.covered ?? false, oracleHeldRoute: g.held ?? false,
      probeGap: g.probeGap ?? false, contextGap: g.contextGap ?? !(g.covered || g.probeGap), pattern: g.covered ? null : 'p', extent: phase2c26b2aRouteExtent(view, origins, EXTENT),
      emptyReservation: phase2c26b2b1ReachRow(await phase2c26b2aReachability(view, null, origins, EXTENT)),
      supportTargetWeaponIds: phase2c26b2aSupport(view, origins, occupancy).supportTargetWeaponIds, ambiguousCandidateTargetWeaponIds: phase2c26b2aSupport(view, origins, occupancy).ambiguousCandidateTargetWeaponIds, contexts })
  }
  return { measuredHead: 'a'.repeat(40), analysisHead: 'b'.repeat(40), exportSha256: 'e'.repeat(64), oracleResultSha256: 'o'.repeat(64), oracleManifestFileSha256: 'f'.repeat(64),
    oracleManifestRoutesSha256: 'r'.repeat(64), origin: { skill: ORIGIN.skill, gogma: ORIGIN.gogma, normal: { [COUNTER]: ORIGIN.normal } }, rows, routes }
}

async function audit(options: { checkpoint?: string[]; mutate?: (s: Phase2C26B2B1Snapshot) => void } = {}) {
  const snapshot = syntheticSnapshot(options)
  // B2-A tried t-a with c fixed (incompatible: 10, 11 not held), and t-c with a fixed (incompatible: 10, 11 not held).
  const authority = await syntheticAuthority(snapshot, [{ target: 't-a', fixed: 'E-c' }, { target: 't-c', fixed: 'E-a' }],
    { 't-b': { covered: true, contextGap: false }, 't-d': { participant: false, held: true }, 't-e': { participant: false } })
  options.mutate?.(snapshot)
  return runPhase2C26B2B1Audit({ snapshot, authority, manifest: SPECS, oracle: oracleOf(SPECS), sha })
}

describe('Phase 2-C2.6-B2-B1 analysis', () => {
  it('finds the minimal fixed cardinality per oracle Route: K0, first at K1, first at K2, unreached', async () => {
    const result = await audit()
    expect(result.invalidReasons).toEqual([])
    const row = (t: string) => result.rows.find(r => r.targetWeaponId === t)!
    expect(row('t-b').reach.minimalCardinality).toBe('0')
    // t-a: B2-A's winner c was incompatible, but fixing b alone holds 10..11.
    expect([row('t-a').reach.minimalCardinality, row('t-a').reach.representative?.fixedSetId, row('t-a').reach.anyK1Compatible]).toEqual(['1', 'K1:E-b', true])
    // t-c: needs 10..12 held, which no single current Route holds; b + a and b + d do.
    expect([row('t-c').reach.minimalCardinality, row('t-c').reach.minimalAliases.map(a => a.fixedSetId), row('t-c').reach.anyK1Compatible]).toEqual(['2', ['K2:E-a|E-b', 'K2:E-b|E-d'], false])
    // t-e: nobody holds 14: unreached for any K, flagged by the held-union relaxation.
    expect([row('t-e').reach.minimalCardinality, row('t-e').reach.heldUnion]).toEqual(['unreached', { coversAllNeeded: false, missingHeld: { normal: 0, skill: 0, gogma: 1 } }])
    // t-d needs 10..15 held: 14 is held by no current Route either.
    expect([row('t-d').reach.minimalCardinality, row('t-d').reach.heldUnion.coversAllNeeded]).toEqual(['unreached', false])
    // The non-blocking relaxation leaves out the Target's own Route and every Route blocking an own position:
    // for t-a (own 12) E-a is its own and E-d blocks 12, so only E-b, E-c and E-e remain.
    expect(row('t-a').reach.nonBlockingHeldUnion).toEqual({ members: 3, coversAllNeeded: true, missingHeld: { normal: 0, skill: 0, gogma: 0 } })
    expect(row('t-e').reach.nonBlockingHeldUnion).toMatchObject({ coversAllNeeded: false, missingHeld: { gogma: 1 } })
    expect(result.aggregates.contextGap).toMatchObject({ unreachedNonBlockingUnionMissesNeeded: 2, unreachedNonBlockingUnionCoversNeeded: 0 })
    const gaps = result.aggregates.contextGap
    expect([gaps.routes, gaps.newlyCompatibleByK0, gaps.newlyCompatibleByAllCurrentK1, gaps.newlyCompatibleByK2, gaps.stillUnreached]).toEqual([4, 0, 1, 1, 2])
    expect(result.decisionInput).toEqual({ searchEligibleContextGaps: 4, recovered: 2 })
    expect(result.aggregates.nonParticipantContextGap.routes).toBe(2)
    expect(result.aggregates.uncoveredOracleHeld.routes).toBe(1)
    expect(result.parity).toMatchObject({ valid: true, k1Contexts: { checked: 2, matched: 2 }, reachability: { verdictMatches: 2, extentMatches: 5, emptyReservationMatches: 5 } })
  })

  it('takes a checkpoint hard-constraint Target out of the eligible denominator and builds it no context', async () => {
    const result = await audit({ checkpoint: ['t-e'] })
    expect(result.invalidReasons).toEqual([])
    expect(result.rows.find(r => r.targetWeaponId === 't-e')!.reach.minimalCardinality).toBe('checkpoint_hard_constraint')
    expect(result.decisionInput).toEqual({ searchEligibleContextGaps: 3, recovered: 2 })
    expect(result.aggregates.contextGap.minimalCardinality.checkpoint_hard_constraint).toBe(1)
  })

  it('fails closed on a snapshot drift and on a B2-A K1 parity drift', async () => {
    const ownContext = await audit({ mutate: s => { s.targetContexts.find(r => r.targetWeaponId === 't-a')!.rawContexts += 1 } })
    expect(ownContext.invalidReasons.some(r => /snapshot: t-a: contexts are not the eligible groups/.test(r))).toBe(true)
    const reordered = await audit({ mutate: s => { s.fixedSets.reverse() } })
    expect(reordered.invalidReasons.some(r => /deterministic K0 \/ K1 \/ K2 enumeration/.test(r))).toBe(true)
    const drifted = await audit({ mutate: s => { const g = s.reservationGroups[s.fixedSets.find(r => r.fixedSetId === 'K1:E-c')!.reservationGroupIndex!]!; g.reservation = res([[13, 14], [13]], ['w-x3']) } })
    expect(drifted.invalidReasons.some(r => /b2a_parity: B2-A contexts are not K1 contexts: .*reservation/.test(r))).toBe(true)
    const origin = await audit({ mutate: s => { s.originDigest = 'other' } })
    expect(origin.invalidReasons.some(r => /origin digest differs/.test(r))).toBe(true)
    const check = await audit({ mutate: s => { s.checks.unitPlansMatchInitialContext = false } })
    expect(check.invalidReasons).toContain('snapshot: calculation check unitPlansMatchInitialContext failed')
  })

  it('reads the oracle support only after the contexts exist, to explain a recovery', async () => {
    const result = await audit()
    expect(result.invalidReasons).toEqual([])
    const a = result.rows.find(r => r.targetWeaponId === 't-a')!
    // t-b operates (required) at Gogma 10 in the oracle, and K1:E-b is the minimal alias.
    expect(a.oracleSupport).toMatchObject({ supportTargetWeaponIds: ['t-b'], minimalAliases: 1, aliasesWithSupporter: 1, aliasesAllSupporters: 1 })
    expect(phase2c26b2b1Distribution([a])).toMatchObject({ recoveredWithSupporterInMinimalAlias: 1, recoveredWithoutSupporterInMinimalAlias: 0 })
  })

  it('decides ALL / PARTIAL / NO / INVALID by the registered rule', () => {
    const decide = (p: Partial<Parameters<typeof phase2c26b2b1Decision>[0]>) => phase2c26b2b1Decision({ invalidReasons: [], searchEligibleContextGaps: 40, recovered: 37, ...p }).case
    expect(decide({})).toBe('B2B1_PARTIAL_ELIGIBLE_RECOVERY')
    expect(decide({ recovered: 40 })).toBe('B2B1_ALL_ELIGIBLE_RECOVERED')
    expect(decide({ recovered: 0 })).toBe('B2B1_NO_ELIGIBLE_RECOVERY')
    expect(decide({ invalidReasons: ['b2a_parity: x'] })).toBe('B2B1_INVALID')
    expect(decide({ searchEligibleContextGaps: 0, recovered: 0 })).toBe('B2B1_INVALID')
    expect(() => decide({ recovered: 41 })).toThrow()
    expect(PHASE2C26B2B1_DECISION_RULE.order[0]).toMatch(/^B2B1_INVALID/)
  })
})

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-B2-B1 B2-A authority', () => {
  const json = JSON.parse(rawB2A)
  const registeredSha = PHASE2C26B2B1_REGISTERED_B2A.resultSha256
  it('accepts the committed formal B2-A RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2B1B2AAuthority(json, registeredSha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.rows.length).toBe(146)
    expect(parsed.authority!.routes.filter(r => r.contextGap).length).toBe(40)
    expect(parsed.authority!.exportSha256).toBe(JSON.parse(rawOracle).environment.exportSha256)
    expect(parsed.authority!.oracleResultSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parsePhase2C26B2B1B2AAuthority(json, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof json) => void) => { const copy = structuredClone(json); patch(copy); return parsePhase2C26B2B1B2AAuthority(copy, registeredSha).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2A_PROBE' })).toBe(false)
    expect(mutate(j => { j.aggregates.uncovered.contextGap = 39 })).toBe(false)
    expect(mutate(j => { j.aggregates.uncovered.probeGap = 2 })).toBe(false)
    expect(mutate(j => { j.inconsistencies = ['x'] })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { const r = j.routes.find((x: { contextGap: boolean }) => x.contextGap); r.conflictParticipant = !r.conflictParticipant })).toBe(false)
    expect(mutate(j => { j.snapshot.rows.pop() })).toBe(false)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-B1 isolation', () => {
  it('is never imported by Production and fixes no Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2B1/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [b2b1Source, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    for (const source of [b2b1Source, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, the manifest and the B2-A RESULT out of the calculation: only the analyzer reads them, after the snapshot', () => {
    for (const source of [b2b1Source, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2a-result|gogmaUsage|plannerGlobal[O]racle|PHASE2C26B2A_RESULT|supportTargetWeaponIds|Analysis/)
    }
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/--b2a-result/)
  })

  it('runs no Search, kernel, trial or Planner: the calculation derives reservations, the analysis reads only', () => {
    for (const source of [b2b1Source, runnerSource, analysisSource, analyzerSource]) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|searchCandidates\(|runPhase2C26B1SearchTask|runPhase2C2SearchContext|runPhase2C2Kernel|runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison/)
    }
    expect(b2b1Source).toMatch(/preparePlannerInitialContext\(/)
    expect(b2b1Source).toMatch(/createPlannerRouteUnitPlans\(/)
    expect(b2b1Source).toMatch(/detectPlannerConflicts\(/)
    expect(b2b1Source).toMatch(/derivePlannerAlternativeReservation\(/)
    expect(b2b1Source).toMatch(/checkpointRequirements\.requiredEntryIdByTargetId/)
    expect(analysisSource).toMatch(/phase2c26b2aReachability\(/)
    expect(analysisSource).toMatch(/phase2c26b2aRouteExtent\(/)
    expect(analyzerSource).toMatch(/const decision = !formal && !allowNonformal \? null :/)
  })
})
