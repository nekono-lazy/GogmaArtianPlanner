import { describe, expect, it } from 'vitest'
import rawB1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json?raw'
import rawOracle from '../../docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json?raw'
import { hashStableValue } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeReservation } from '../domain/search'
import { createCounterReservation, nextOperationPositions } from '../domain/search/counterReservation'
import { belowPracticalBonuses, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { deriveOracleRequiredPositions, expandOracleOperations } from './plannerGlobalOracle1657'
import { ORACLE_1657_ROUTES, type OracleRouteSpec } from './plannerGlobalOracle1657Manifest'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { runPhase2C2Baseline } from './plannerGlobalPhase2C2'
import { derivePhase2C26B1Contexts } from './plannerGlobalPhase2C26B1'
import { derivePhase2C26B2AContextSnapshots, type Phase2C26B2AContextSnapshot, type Phase2C26B2ASnapshotRecord } from './plannerGlobalPhase2C26B2A'
import b2aSource from './plannerGlobalPhase2C26B2A.ts?raw'
import {
  parsePhase2C26B2AB1Authority,
  parsePhase2C26B2AOracle,
  phase2c26b2aB1ContextOutcome,
  phase2c26b2aClassifyContext,
  phase2c26b2aDecision,
  phase2c26b2aExpandRanges,
  phase2c26b2aLaneCheck,
  phase2c26b2aNormalCheck,
  phase2c26b2aOccupancy,
  phase2c26b2aPattern,
  phase2c26b2aRanges,
  phase2c26b2aReachability,
  phase2c26b2aReservationRanges,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  phase2c26b2aSupport,
  runPhase2C26B2AAudit,
  validatePhase2C26B2AContextParity,
  validatePhase2C26B2AOracleManifest,
  PHASE2C26B2A_DECISION_RULE,
  type Phase2C26B2AB1Authority,
  type Phase2C26B2AB1Run,
  type Phase2C26B2AOracle,
} from './plannerGlobalPhase2C26B2AAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2AAnalysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2a.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2a.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-A: the pre-Search context snapshot (calculation) and the post-hoc oracle reachability audit.
 * The synthetic world below is invented for the tests; the committed B1 RESULT / oracle RESULT / manifest are read only to
 * check the authority parser and the manifest consistency.
 */

const digest = (value: string) => hashStableValue(value)
const reservation = (patch: Partial<{ normal: PlannerAlternativeReservation['normal']; skill: [number[], number[]]; gogma: [number[], number[]]; exclusive: string[] }>): PlannerAlternativeReservation => ({
  normal: patch.normal ?? [],
  skill: { held: patch.skill?.[0] ?? [], blocked: patch.skill?.[1] ?? [] },
  gogma: { held: patch.gogma?.[0] ?? [], blocked: patch.gogma?.[1] ?? [] },
  exclusiveOwnedWeaponIds: (patch.exclusive ?? []) as unknown as PlannerAlternativeReservation['exclusiveOwnedWeaponIds'],
})

// ---------------------------------------------------------------- a synthetic oracle world

const ORIGIN = { skill: 100, gogma: 10, normal: 0 }
const COUNTER = 'weapon.x:8'
const SPECS: OracleRouteSpec[] = [
  { targetWeaponId: 't-a', source: { kind: 'owned', ownedWeaponId: 'w-a' }, materialization: 'candidate_search', routeKind: 'existing_gogma_keep_bonuses',
    operations: [{ type: 'keep_bonuses', from: 12, to: 12 }], required: { normal: null, skill: [], gogma: [12] }, estimated: { operations: 1, normal: null, gogma: 3, skill: 0 } },
  { targetWeaponId: 't-b', source: { kind: 'owned', ownedWeaponId: 'w-b' }, materialization: 'candidate_search', routeKind: 'existing_gogma_mixed',
    operations: [{ type: 'reset_bonuses', from: 10, to: 11 }, { type: 'reset_skills', from: 100, to: 100 }], required: { normal: null, skill: [100], gogma: [11] },
    estimated: { operations: 3, normal: null, gogma: 2, skill: 1 } },
  { targetWeaponId: 't-c', source: { kind: 'new_normal', normalPosition: 0 }, materialization: 'planner_alternative_search', routeKind: 'normal_artian_to_gogma',
    operations: [{ type: 'create_normal_artian', from: 0, to: 0 }, { type: 'convert_normal_to_gogma', from: 101, to: 101 }, { type: 'reset_bonuses', from: 13, to: 13 }],
    required: { normal: 0, skill: [101], gogma: [13] }, estimated: { operations: 3, normal: 1, gogma: 4, skill: 2 } },
]

function oracleOf(specs: readonly OracleRouteSpec[]): Phase2C26B2AOracle {
  const usage = { gogma: [] as Phase2C26B2AOracle['gogmaUsage'], skill: [] as Phase2C26B2AOracle['requiredSkillUsage'], normal: {} as Phase2C26B2AOracle['requiredNormalUsage'] }
  const routes = specs.map(spec => {
    const ops = expandOracleOperations(spec.operations)
    const required = deriveOracleRequiredPositions(ops)
    const stream = (name: 'normal' | 'skill' | 'gogma') => {
      const positions = ops.filter(op => op.stream === name).map(op => op.position)
      return { first: positions[0] ?? null, last: positions.at(-1) ?? null, operations: positions.length, ...(name === 'normal' ? {} : { required: required[name] }) }
    }
    ops.filter(op => op.stream === 'gogma').forEach(op => usage.gogma.push({ position: op.position, targetWeaponId: spec.targetWeaponId, type: op.type, required: required.gogma.includes(op.position) }))
    ops.filter(op => op.stream === 'skill' && required.skill.includes(op.position)).forEach(op => usage.skill.push({ position: op.position, targetWeaponId: spec.targetWeaponId, type: op.type, required: true }))
    if (required.normal !== null) (usage.normal[COUNTER] ??= []).push({ position: required.normal, targetWeaponId: spec.targetWeaponId, type: 'create_normal_artian', required: true })
    return { targetWeaponId: spec.targetWeaponId, weaponTypeId: 'weapon.x', sourceKind: spec.source.kind, sourceOwnedWeaponId: spec.source.kind === 'owned' ? spec.source.ownedWeaponId : null,
      normalPosition: spec.source.kind === 'new_normal' ? spec.source.normalPosition : null, conversionPosition: ops.find(op => op.type === 'convert_normal_to_gogma')?.position ?? null,
      normal: stream('normal'), gogma: stream('gogma'), skill: stream('skill'), routeOperationCount: ops.length,
      materialization: { method: spec.materialization, routeKind: spec.routeKind, estimated: spec.estimated, plannerRequired: spec.required } }
  })
  return { exportSha256: 'e'.repeat(64), routes, gogmaUsage: usage.gogma, requiredSkillUsage: usage.skill, requiredNormalUsage: usage.normal,
    summary: { skill: { start: 100, end: 102 }, gogma: { start: 10, end: 14 }, normal: { [COUNTER]: { start: 0, end: 1 } }, physicalOperations: 7 }, manifestSha256: 'm' }
}

const ORIGIN_SNAPSHOT = { skillCounter: { value: ORIGIN.skill, isConfirmed: true }, gogmaCounter: { value: ORIGIN.gogma, isConfirmed: true },
  normalCounters: [{ counterId: COUNTER, counter: ORIGIN.normal, isConfirmed: true }] }

function context(orientationId: string, targetWeaponId: string, res: PlannerAlternativeReservation): Phase2C26B2AContextSnapshot {
  const body = { orientationId, targetWeaponId, res }
  return { orientationId, workIndex: 0, targetWeaponId, status: 'searchable', invalidatedBuildListEntryId: `e-${targetWeaponId}`, fixedRouteBuildListEntryIds: [`e-fixed-${orientationId}`],
    reservation: res, excludedRouteKeys: [`key-${targetWeaponId}`], extent: { ...defaultPlannerAlternativeSearchExtent }, originDigest: 'origin', origin: ORIGIN_SNAPSHOT,
    contextDigest: `cd-${hashStableValue(body)}`, searchInputDigest: `sd-${hashStableValue(body)}` }
}

function world(patch: { contexts?: Phase2C26B2AContextSnapshot[]; runs?: Phase2C26B2AB1Run[]; coverage?: Record<string, { coverage: string; key: string | null }> } = {}) {
  const contexts = patch.contexts ?? [
    context('o0', 't-a', reservation({ gogma: [[10, 11], []] })),
    context('o1', 't-a', reservation({ gogma: [[10], []] })),
    context('o2', 't-b', reservation({ gogma: [[10, 11], [11]], exclusive: ['w-b'] })),
  ]
  const snapshot: Phase2C26B2ASnapshotRecord = {
    baseline: { summary: {} as Phase2C26B2ASnapshotRecord['baseline']['summary'],
      orientations: contexts.map(c => ({ orientationId: c.orientationId, conflictIndex: 0, conflictKey: 'k', kind: 'same_gogma_counter', participantBuildListEntryIds: [],
        participantTargetWeaponIds: [c.targetWeaponId, 't-b'], fixedBuildListEntryId: 'e-fixed', fixedTargetWeaponId: 't-b' })) },
    contexts,
  }
  const runs = patch.runs ?? [
    { taskId: 's0', executionClass: 'stage1', process: 'timeout', record: null, searchStatus: null, delivered: null, candidateKeySha256s: [] },
    { taskId: 's1', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'consumer_stop', delivered: 8, candidateKeySha256s: ['k1'] },
    { taskId: 's2', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'stopped_by_extent', delivered: 0, candidateKeySha256s: [] },
  ]
  const authority: Phase2C26B2AB1Authority = {
    measuredHead: 'a'.repeat(40), analysisHead: 'b'.repeat(40), exportSha256: 'e'.repeat(64), oracleSha256: 'o'.repeat(64), extent: { ...defaultPlannerAlternativeSearchExtent },
    captureBound: 8, calculationContext: {}, researchMaxPlanSteps: 1, baselineSummary: snapshot.baseline.summary,
    orientations: snapshot.baseline.orientations.map(o => ({ orientationId: o.orientationId, kind: o.kind })),
    contexts: contexts.map((c, i) => ({ orientationId: c.orientationId, kind: 'same_gogma_counter', workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, status: c.status,
      contextDigest: c.contextDigest, searchInputDigest: c.searchInputDigest, taskId: `s${i}`, fixedRouteBuildListEntryIds: c.fixedRouteBuildListEntryIds,
      excludedRouteKeySha256s: c.excludedRouteKeys.map(digest), reservation: phase2c26b2aReservationRanges(c.reservation) })),
    runs, participants: ['t-a', 't-b'],
    oracleRows: SPECS.map(spec => ({ targetWeaponId: spec.targetWeaponId, coverage: patch.coverage?.[spec.targetWeaponId]?.coverage ?? 'uncovered', coveredBy: null,
      matchedStableKeySha256: patch.coverage?.[spec.targetWeaponId]?.key ?? null, oracleHeldRoute: null, conflictParticipant: spec.targetWeaponId !== 't-c' })),
  }
  return { snapshot, authority, manifest: SPECS, oracle: oracleOf(SPECS) }
}

// ---------------------------------------------------------------- calculation: the snapshot

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2a.b', { priority: 1 })
  return orchestrationScenario({
    engine: { gogmaPositions: defaultPlannerAlternativeSearchExtent.maxGogmaAdvance + 8, skillPositions: defaultPlannerAlternativeSearchExtent.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2a.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2a.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

describe('Phase 2-C2.6-B2-A context snapshot (calculation)', () => {
  it('re-derives exactly the B1 contexts and adds the prepared Counter origins, the same fields for every context', async () => {
    const built = scenario()
    const baseline = await runPhase2C2Baseline(built.input, { createEngine: () => built.engine, now: () => 0 })
    expect(baseline.orientations.length).toBeGreaterThan(0)
    const deps = () => globalResearchDependencies(built.engine)
    const b1 = derivePhase2C26B1Contexts(built.input, baseline.orientations, deps)
    const snapshots = derivePhase2C26B2AContextSnapshots(built.input, baseline.orientations, deps)
    expect(snapshots.length).toBe(b1.length)
    snapshots.forEach((s, i) => {
      const c = b1[i]!
      expect([s.orientationId, s.workIndex, s.targetWeaponId, s.status, s.contextDigest, s.searchInputDigest, s.originDigest])
        .toEqual([c.orientationId, c.workIndex, c.targetWeaponId, c.status, c.contextDigest, c.searchInputDigest, c.originDigest])
      expect(s.reservation).toEqual(c.reservation)
      expect(s.fixedRouteBuildListEntryIds).toEqual(c.fixedRouteBuildListEntryIds)
      expect(s.excludedRouteKeys).toEqual(c.excludedRouteKeys)
      expect(s.extent).toEqual(defaultPlannerAlternativeSearchExtent)
      expect(Object.keys(s.origin).sort()).toEqual(['gogmaCounter', 'normalCounters', 'skillCounter'])
      expect(s.origin.skillCounter.value).toBe(built.input.rngState.skillCounter.value)
      expect(s.origin.gogmaCounter.value).toBe(built.input.rngState.gogmaCounter.value)
      expect(s.origin.normalCounters.map(n => n.counterId)).toEqual([...built.input.normalCounters.map(n => n.id)].sort())
    })
  })
})

// ---------------------------------------------------------------- authorities

describe('Phase 2-C2.6-B2-A authorities', () => {
  const b1Json = JSON.parse(rawB1)
  it('accepts the committed formal B1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2AB1Authority(b1Json)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.contexts).toHaveLength(146)
    expect(parsed.authority!.orientations).toHaveLength(54)
    expect(parsed.authority!.oracleRows.filter(r => r.coverage === 'uncovered')).toHaveLength(41)
    expect(parsed.authority!.oracleRows.filter(r => !r.conflictParticipant)).toHaveLength(9)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted JSON mutated in place
    const mutate = (fn: (json: Record<string, any>) => void) => { const copy = structuredClone(b1Json); fn(copy); return parsePhase2C26B2AB1Authority(copy) }
    expect(mutate(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] }).valid).toBe(false)
    expect(mutate(j => { j.decision.case = 'B1_I_measurement_incomplete' }).valid).toBe(false)
    expect(mutate(j => { j.participants.explored = 33 }).valid).toBe(false)
    expect(mutate(j => { j.stage1.timeout = 19 }).valid).toBe(false)
    expect(mutate(j => { j.stage1.outOfMemory = 1 }).valid).toBe(false)
    expect(mutate(j => { j.fallback.completed = 2 }).valid).toBe(false)
    expect(mutate(j => { j.oracleCoverage.totals.uncovered = 40 }).valid).toBe(false)
    expect(mutate(j => { j.contexts.perOrientation.pop() }).valid).toBe(false)
    expect(mutate(j => { j.runs.pop() }).valid).toBe(false)
    expect(parsePhase2C26B2AB1Authority(null).valid).toBe(false)
  })

  it('accepts the committed oracle and finds the manifest consistent with it; any drift is reported', () => {
    const parsed = parsePhase2C26B2AOracle(JSON.parse(rawOracle))
    expect(parsed.issues).toEqual([])
    const ok = validatePhase2C26B2AOracleManifest(ORACLE_1657_ROUTES, parsed.oracle!, true)
    expect(ok.issues).toEqual([])
    expect([ok.checkedRoutes, ok.gogmaUsage, ok.requiredSkillUsage, ok.requiredNormalUsage]).toEqual([43, 295, 25, 8])
    expect(validatePhase2C26B2AOracleManifest(ORACLE_1657_ROUTES, parsed.oracle!, false).valid).toBe(false)
    const shifted = ORACLE_1657_ROUTES.map((route, i) => i !== 3 ? route : { ...route, operations: route.operations.map(op => ({ ...op, from: op.from + 1, to: op.to + 1 })) })
    expect(validatePhase2C26B2AOracleManifest(shifted, parsed.oracle!, true).valid).toBe(false)
    const oracle = structuredClone(parsed.oracle!)
    oracle.gogmaUsage[0]!.required = !oracle.gogmaUsage[0]!.required
    expect(validatePhase2C26B2AOracleManifest(ORACLE_1657_ROUTES, oracle, true).valid).toBe(false)
    const notProven = JSON.parse(rawOracle); notProven.verdict = 'validated_oracle'
    expect(parsePhase2C26B2AOracle(notProven).valid).toBe(false)
  })

  it('checks the snapshot against B1 field by field and fails closed on any drift', () => {
    const { snapshot, authority } = world()
    const full = { ...snapshot, exportSha256: authority.exportSha256, calculationContext: {}, researchMaxPlanSteps: 1 }
    expect(validatePhase2C26B2AContextParity(full, authority, digest).issues).toEqual([])
    const drift = (fn: (s: typeof full) => void) => { const copy = structuredClone(full); fn(copy); return validatePhase2C26B2AContextParity(copy, authority, digest) }
    expect(drift(s => { s.exportSha256 = 'x' }).valid).toBe(false)
    expect(drift(s => { s.contexts[1]!.contextDigest = 'x' }).contextMismatches).toEqual([{ orientationId: 'o1', workIndex: 0, fields: ['contextDigest'] }])
    expect(drift(s => { s.contexts[1]!.searchInputDigest = 'x' }).valid).toBe(false)
    expect(drift(s => { const r = s.contexts[0]!.reservation!; s.contexts[0]!.reservation = { ...r, gogma: { ...r.gogma, held: [...r.gogma.held, 30] } } }).contextMismatches[0]!.fields).toEqual(['reservation'])
    expect(drift(s => { s.contexts[0]!.excludedRouteKeys = ['other'] }).contextMismatches[0]!.fields).toEqual(['excludedRouteKeys'])
    expect(drift(s => { s.contexts[0]!.fixedRouteBuildListEntryIds = [] }).valid).toBe(false)
    expect(drift(s => { s.contexts[0]!.extent = { ...s.contexts[0]!.extent, maxSkillAdvance: 5 } }).valid).toBe(false)
    expect(drift(s => { s.contexts.pop() }).valid).toBe(false)
    expect(drift(s => { s.baseline.orientations.reverse() }).orientationOrderMatches).toBe(false)
    expect(drift(s => { s.contexts[2]!.origin = { ...s.contexts[2]!.origin, gogmaCounter: { value: 11, isConfirmed: true } } }).originsUniform).toBe(false)
  })
})

// ---------------------------------------------------------------- the Production primitives

describe('Phase 2-C2.6-B2-A reservation compatibility', () => {
  it('expands operation segments into strictly ascending lanes, the conversion first in the Skill lane', () => {
    const view = phase2c26b2aRouteView(SPECS[2]!, 'weapon.x')
    expect([view.normal, view.conversion, view.skill, view.gogma, view.normalCounterId]).toEqual([[0], 101, [101], [13], COUNTER])
    expect(phase2c26b2aRouteView(SPECS[1]!, 'weapon.x').gogma).toEqual([10, 11])
    expect(phase2c26b2aRouteView({ ...SPECS[1]!, operations: [{ type: 'reset_bonuses', from: 10, to: 12 }] }, 'weapon.x').oracleHeldRoute).toBe(false)
    expect(phase2c26b2aRouteView({ ...SPECS[1]!, operations: [{ type: 'reset_bonuses', from: 10, to: 10 }, { type: 'keep_bonuses', from: 12, to: 12 }] }, 'weapon.x').oracleHeldRoute).toBe(true)
    expect(() => phase2c26b2aRouteView({ ...SPECS[1]!, operations: [{ type: 'reset_bonuses', from: 12, to: 12 }, { type: 'keep_bonuses', from: 11, to: 11 }] }, 'weapon.x')).toThrow()
    expect(phase2c26b2aRanges([5, 3, 4, 9, 9, 11])).toEqual([[3, 5], [9, 9], [11, 11]])
    expect(phase2c26b2aExpandRanges(phase2c26b2aRanges([5, 3, 4, 9]))).toEqual([3, 4, 5, 9])
  })

  it('a Skill / Gogma lane is legal exactly where nextOperationPositions() puts the next own operation', async () => {
    const res = createCounterReservation([10, 11, 12, 15], [11])
    expect((await phase2c26b2aLaneCheck(res, 10, [13], 100)).compatible).toBe(true)
    const gap = await phase2c26b2aLaneCheck(res, 10, [17], 100)
    expect([gap.compatible, gap.missingHeld, gap.blockedOwn]).toEqual([false, [13, 14, 16], []])
    const blocked = await phase2c26b2aLaneCheck(res, 10, [11, 13], 100)
    expect([blocked.compatible, blocked.missingHeld, blocked.blockedOwn]).toEqual([false, [], [11]])
    // Random worlds: the verdict is always the primitive's own walk, and its decomposition never disagrees.
    let seed = 7
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let trial = 0; trial < 200; trial += 1) {
      const held = Array.from({ length: 20 }, (_, i) => i).filter(() => rand(3) > 0)
      const blockedSet = held.filter(() => rand(4) === 0)
      const r = createCounterReservation(held, blockedSet)
      const positions = [...new Set(Array.from({ length: 1 + rand(3) }, () => rand(22)))].sort((a, b) => a - b)
      const check = await phase2c26b2aLaneCheck(r, 0, positions, 1000)
      let from = 0, primitive = true
      for (const p of positions) {
        if (!(await nextOperationPositions(r, from, 1000, async () => {})).positions.includes(p)) primitive = false
        from = p + 1
      }
      expect(check.compatible).toBe(primitive)
      expect(check.inconsistent).toBe(false)
    }
  })

  it('the Production limit walk agrees with the reach extent verdict', async () => {
    const res = createCounterReservation([10, 11, 12], [])
    expect((await phase2c26b2aLaneCheck(res, 10, [13], 10 + 4)).productionLimitAccepts).toBe(true)
    expect((await phase2c26b2aLaneCheck(res, 10, [13], 10 + 3)).productionLimitAccepts).toBe(false)
  })

  it('the Normal lane is the canonical heldPrefixNormalCreation(): prefix, missing held, overlap and a blocked target', () => {
    const exact = phase2c26b2aNormalCheck(createCounterReservation([0, 1], []), 0, [2, 3], 4)
    expect([exact.compatible, exact.productionLimitAccepts]).toEqual([true, true])
    expect(phase2c26b2aNormalCheck(createCounterReservation([0, 1], []), 0, [2, 3, 4, 5], 4).productionLimitAccepts).toBe(false)
    const missing = phase2c26b2aNormalCheck(createCounterReservation([0], []), 0, [2, 3], 4)
    expect([missing.compatible, missing.missingHeld]).toEqual([false, [1]])
    const overlap = phase2c26b2aNormalCheck(createCounterReservation([0, 1, 2], []), 0, [1, 2, 3], 4)
    expect([overlap.compatible, overlap.heldPrefixOverlap]).toEqual([false, [1, 2]])
    const blocked = phase2c26b2aNormalCheck(createCounterReservation([0, 3], [3]), 0, [0, 1, 2, 3], 4)
    expect([blocked.compatible, blocked.blockedOwn]).toEqual([false, [3]])
    // A held Counter-advance position after the prefix is forged by the Route itself (only the target is checked).
    expect(phase2c26b2aNormalCheck(createCounterReservation([2], [2]), 0, [0, 1, 2, 3], 4).compatible).toBe(true)
    for (const c of [exact, missing, overlap, blocked]) expect(c.inconsistent).toBe(false)
  })

  it('rejects an exclusive source OwnedWeapon and reports several causes at once', async () => {
    const view = phase2c26b2aRouteView(SPECS[1]!, 'weapon.x')
    const reach = await phase2c26b2aReachability(view, reservation({ gogma: [[10, 11], [11]], skill: [[], []], exclusive: ['w-b'] }), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect(reach.compatible).toBe(false)
    expect(reach.reasons).toEqual(['exclusive_owned_weapon_conflict', 'blocked_position_conflict'])
    const both = await phase2c26b2aReachability(phase2c26b2aRouteView(SPECS[0]!, 'weapon.x'), reservation({ gogma: [[11, 12], [12]], exclusive: ['w-a'] }), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect(both.reasons).toEqual(['exclusive_owned_weapon_conflict', 'blocked_position_conflict', 'held_coverage_gap'])
    expect(both.lanes.gogma!.missingHeld).toEqual([10])
    expect((await phase2c26b2aReachability(phase2c26b2aRouteView(SPECS[0]!, 'weapon.x'), null, ORIGIN, defaultPlannerAlternativeSearchExtent)).lanes.gogma!.missingHeld).toEqual([10, 11])
  })

  it('judges the default extent from the reach, with one more Skill position for a conversion Route, and reproduces the estimates', () => {
    const owned = phase2c26b2aRouteExtent(phase2c26b2aRouteView(SPECS[1]!, 'weapon.x'), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect([owned.reach, owned.withinDefaultExtent, owned.estimatedMatches]).toEqual([{ normal: null, gogma: 2, skill: 1 }, true, true])
    expect(owned.verdict.normal).toBe('not_applicable')
    const longSkill: OracleRouteSpec = { ...SPECS[1]!, operations: [{ type: 'reset_bonuses', from: 10, to: 10 }, { type: 'reset_skills', from: 104, to: 104 }], estimated: { operations: 2, normal: null, gogma: 1, skill: 5 } }
    const r = phase2c26b2aRouteExtent(phase2c26b2aRouteView(longSkill, 'weapon.x'), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect([r.verdict.skill, r.estimatedMatches]).toEqual(['requires_larger_extent', true])
    const conversion: OracleRouteSpec = { ...SPECS[2]!, operations: [{ type: 'create_normal_artian', from: 0, to: 3 }, { type: 'convert_normal_to_gogma', from: 104, to: 104 }, { type: 'reset_bonuses', from: 13, to: 13 }],
      estimated: { operations: 6, normal: 4, gogma: 4, skill: 5 } }
    const c = phase2c26b2aRouteExtent(phase2c26b2aRouteView(conversion, 'weapon.x'), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect([c.verdict.skill, c.verdict.normal, c.withinDefaultExtent, c.estimatedMatches]).toEqual(['within_default_extent', 'within_default_extent', true, true])
    const far = phase2c26b2aRouteExtent(phase2c26b2aRouteView({ ...conversion, operations: [{ type: 'create_normal_artian', from: 0, to: 4 }, ...conversion.operations.slice(1)] }, 'weapon.x'), ORIGIN, defaultPlannerAlternativeSearchExtent)
    expect([far.verdict.normal, far.estimatedMatches]).toEqual(['requires_larger_extent', false])
  })
})

// ---------------------------------------------------------------- B1 outcomes, support and classification

describe('Phase 2-C2.6-B2-A classification', () => {
  const run = (patch: Partial<Phase2C26B2AB1Run>): Phase2C26B2AB1Run => ({ taskId: 's', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'stopped_by_extent', delivered: 0, candidateKeySha256s: [], ...patch })

  it('never reads a timeout as Candidate 0 and never reads a consumer stop as "no oracle Candidate"', () => {
    const timeout = phase2c26b2aB1ContextOutcome('s', [run({ process: 'timeout', record: null, searchStatus: null, delivered: null })])
    expect([timeout.status, timeout.completed]).toEqual(['timeout', false])
    expect(phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: true, b1: timeout, deliveredOracle: false, captureBound: 8 })).toBe('default_context_unfinished')
    const rescued = phase2c26b2aB1ContextOutcome('s', [run({ process: 'timeout', record: null, searchStatus: null }), run({ executionClass: 'coverage_fallback' })])
    expect([rescued.status, rescued.completedBy, rescued.runs]).toEqual(['stopped_by_extent', 'coverage_fallback', ['stage1:timeout', 'coverage_fallback:stopped_by_extent']])
    const stop = phase2c26b2aB1ContextOutcome('s', [run({ searchStatus: 'consumer_stop', delivered: 8 })])
    expect(phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: true, b1: stop, deliveredOracle: false, captureBound: 8 })).toBe('capture_or_ordering_unresolved')
    expect(() => phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: true, b1: { ...stop, delivered: 3 }, deliveredOracle: false, captureBound: 8 })).toThrow()
    expect(phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: true, b1: rescued, deliveredOracle: false, captureBound: 8 })).toBe('eligible_but_not_observed')
    expect(phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: false, b1: timeout, deliveredOracle: false, captureBound: 8 })).toBe('extent_insufficient')
    expect(phase2c26b2aClassifyContext({ compatible: false, withinDefaultExtent: true, b1: stop, deliveredOracle: false, captureBound: 8 })).toBe('reservation_incompatible')
    expect(phase2c26b2aClassifyContext({ compatible: true, withinDefaultExtent: true, b1: stop, deliveredOracle: true, captureBound: 8 })).toBe('observed')
    expect(() => phase2c26b2aClassifyContext({ compatible: false, withinDefaultExtent: true, b1: stop, deliveredOracle: true, captureBound: 8 })).toThrow()
  })

  it('derives the support Targets: the required unit owner, else the only other operator, and a single carrier when one exists', () => {
    const views = SPECS.map(spec => phase2c26b2aRouteView(spec, 'weapon.x'))
    const occupancy = phase2c26b2aOccupancy(views)
    const a = phase2c26b2aSupport(views[0]!, ORIGIN, occupancy)
    expect([a.needed.gogma, a.supportTargetWeaponIds, a.providerBucket, a.singleRouteCoverTargetWeaponIds]).toEqual([[10, 11], ['t-b'], '1', ['t-b']])
    const c = phase2c26b2aSupport(views[2]!, ORIGIN, occupancy)
    expect([c.needed.gogma, c.needed.skill, c.supportTargetWeaponIds, c.providerBucket, c.singleRouteCoverTargetWeaponIds]).toEqual([[10, 11, 12], [100], ['t-a', 't-b'], '2+', []])
    const b = phase2c26b2aSupport(views[1]!, ORIGIN, occupancy)
    expect([b.providers, b.providerBucket, b.unsupportedPositions]).toEqual([0, '0', 0])
    // Two skippable operators and no required one: the executor is not fixed by the manifest.
    const twin = phase2c26b2aOccupancy([views[0]!, phase2c26b2aRouteView({ ...SPECS[1]!, targetWeaponId: 't-d', operations: [{ type: 'reset_bonuses', from: 10, to: 12 }], required: { normal: null, skill: [], gogma: [12] } }, 'weapon.x'),
      phase2c26b2aRouteView({ ...SPECS[1]!, targetWeaponId: 't-e', operations: [{ type: 'reset_bonuses', from: 10, to: 13 }], required: { normal: null, skill: [], gogma: [13] } }, 'weapon.x')])
    const amb = phase2c26b2aSupport(views[0]!, ORIGIN, twin)
    expect([amb.ambiguousPositions, amb.ambiguousCandidateTargetWeaponIds, amb.providerBucket]).toEqual([2, ['t-d', 't-e'], '2+'])
  })

  it('audits every oracle Route against every context of its Target: probe gap, context gap and no-context Target', async () => {
    const audit = await runPhase2C26B2AAudit(world())
    expect(audit.inconsistencies).toEqual([])
    const byTarget = new Map(audit.routes.map(r => [r.view.targetWeaponId, r]))
    const a = byTarget.get('t-a')!
    expect(a.contexts.map(row => row.classification)).toEqual(['default_context_unfinished', 'reservation_incompatible'])
    expect([a.audit.probeGap, a.audit.contextGap, a.audit.flags.hasUnfinishedCompatibleContext, a.audit.flags.hasHeldCoverageGap]).toEqual([true, false, true, true])
    const b = byTarget.get('t-b')!
    expect([b.audit.probeGap, b.audit.contextGap, b.audit.flags.hasExclusiveOwnedWeaponConflict, b.audit.flags.hasBlockedPositionConflict]).toEqual([false, true, true, true])
    const c = byTarget.get('t-c')!
    expect([c.audit.flags.noSingleWinnerSearchContext, c.audit.contextGap, c.audit.flags.needsMultipleOracleSupportTargets, c.audit.flags.needsLargerExtent]).toEqual([true, true, true, false])
    expect(phase2c26b2aPattern(c.contexts, c.emptyReservation)).toBe('no_context:needs_held[skill+gogma]')
    expect(phase2c26b2aPattern(b.contexts, b.emptyReservation)).toBe('incompatible:exclusive_owned_weapon_conflict+blocked_position_conflict[gogma]')
    expect(audit.aggregates.uncovered).toMatchObject({ routes: 3, noSearchContext: 1, probeGap: 1, contextGap: 2, probeAndContextGap: 0 })
    expect(audit.aggregates.uncoveredNonParticipants.routes).toBe(1)
    expect(audit.unexplained).toEqual([])
  })

  it('a covered Route must be observed in a reachable context; a delivery the audit finds unreachable is an inconsistency', async () => {
    const ok = await runPhase2C26B2AAudit(world({ coverage: { 't-a': { coverage: 'exact', key: 'k1' } }, contexts: [
      context('o0', 't-a', reservation({ gogma: [[10, 11], []] })),
      context('o1', 't-a', reservation({ gogma: [[10], []] })),
      context('o2', 't-b', reservation({ gogma: [[10, 11], [11]], exclusive: ['w-b'] }))],
    runs: [
      { taskId: 's0', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'consumer_stop', delivered: 8, candidateKeySha256s: ['k1'] },
      { taskId: 's1', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'stopped_by_extent', delivered: 0, candidateKeySha256s: [] },
      { taskId: 's2', executionClass: 'stage1', process: 'completed', record: 'searched', searchStatus: 'stopped_by_extent', delivered: 0, candidateKeySha256s: [] }] }))
    expect(ok.inconsistencies).toEqual([])
    expect(ok.routes[0]!.contexts[0]!.classification).toBe('observed')
    const bad = await runPhase2C26B2AAudit(world({ coverage: { 't-a': { coverage: 'exact', key: 'k1' } } }))
    expect(bad.inconsistencies.some(i => /delivered the oracle Candidate although/.test(i))).toBe(true)
    expect(bad.inconsistencies.some(i => /covered by B1 but observed in no context/.test(i))).toBe(true)
    const drifted = world()
    drifted.manifest = SPECS.map(spec => spec.targetWeaponId === 't-a' ? { ...spec, estimated: { ...spec.estimated, gogma: 9 } } : spec)
    expect((await runPhase2C26B2AAudit(drifted)).inconsistencies.some(i => /estimated advance/.test(i))).toBe(true)
  })

  it('decides B2A-BOTH / PROBE / CONTEXT / COVERED / INVALID by the registered rule', () => {
    const decide = (p: Partial<Parameters<typeof phase2c26b2aDecision>[0]>) => phase2c26b2aDecision({ invalidReasons: [], uncovered: 3, probeGapRoutes: 1, contextGapRoutes: 2, unexplainedRoutes: 0, ...p }).case
    expect(decide({})).toBe('B2A_BOTH')
    expect(decide({ contextGapRoutes: 0 })).toBe('B2A_PROBE')
    expect(decide({ probeGapRoutes: 0 })).toBe('B2A_CONTEXT')
    expect(decide({ uncovered: 0, probeGapRoutes: 0, contextGapRoutes: 0 })).toBe('B2A_COVERED')
    expect(decide({ invalidReasons: ['context_parity: x'] })).toBe('B2A_INVALID')
    expect(decide({ unexplainedRoutes: 1 })).toBe('B2A_INVALID')
    expect(() => decide({ probeGapRoutes: 4 })).toThrow()
    expect(PHASE2C26B2A_DECISION_RULE.order[0]).toMatch(/^B2A-INVALID/)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-A isolation', () => {
  it('is never imported by Production and fixes no orientation, Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [b2aSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    for (const source of [b2aSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle and the manifest out of the calculation: only the analyzer reads them, after the snapshot', () => {
    for (const source of [b2aSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_1657|1657|--oracle|--manifest|--b1-result|gogmaUsage|plannerGlobalOracle|PHASE2C26B1_RESULT/)
    }
    expect(b2aSource).not.toMatch(/plannerGlobalPhase2C26B2AAnalysis/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
  })

  it('runs no Search, kernel, trial or Planner beyond the baseline: the calculation is a snapshot, the analysis reads only', () => {
    for (const source of [b2aSource, runnerSource]) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates\(|runPhase2C26B1SearchTask|runPhase2C2SearchContext|runPhase2C2Kernel|runPreparedPlannerAlternativeKernel|createProductionPlan\(/)
    }
    for (const source of [analysisSource, analyzerSource]) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B1SearchTask|runPhase2C2Kernel|createProductionPlan|runPhase2C2Baseline|derivePhase2C25APreSearchContexts/)
    }
    expect(analysisSource).toMatch(/nextOperationPositions/)
    expect(analysisSource).toMatch(/heldPrefixNormalCreation/)
    expect(analysisSource).toMatch(/createCounterReservation/)
    expect(analyzerSource).toMatch(/const decision = !formal && !allowNonformal \? null :/)
  })
})
