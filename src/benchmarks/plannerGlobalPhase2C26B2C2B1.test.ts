import { describe, expect, it } from 'vitest'
import rawB2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json?raw'
import rawB2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawR2 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json?raw'
import { stableStringify } from '../domain/models/hashing'
import { recommendedCandidateSearchDefaults } from '../domain/models/common'
import type { BuildListEntry, TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeSearchExtent, normalizePlannerAlternativeReservation, type PlannerAlternativeReservation } from '../domain/search'
import { IDEAL_SERIES_SKILL_ID, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import { checkpointBonusEntry, checkpointBonusResultAt, orchestrationEntry, orchestrationScenario, orchestrationSource, orchestrationTarget, resetRoute } from '../test/fixtures/plannerConstrainedOrchestration'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import {
  phase2c26b2aExpandSegments,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  type Phase2C26B2AOracleRouteSpec,
  type Phase2C26B2ARouteView,
} from './plannerGlobalPhase2C26B2AAnalysis'
import { derivePhase2C26B2C1Schedule, PHASE2C26B2C1_POLICIES } from './plannerGlobalPhase2C26B2C1'
import { parsePhase2C26B2C1B2B1Authority, phase2c26b2c1Percentile, PHASE2C26B2C1_REGISTERED_POLICIES, type Phase2C26B2C1RouteRow } from './plannerGlobalPhase2C26B2C1Analysis'
import { parsePhase2C26B2C2AB2C1Authority, PHASE2C26B2C2A_REGISTERED_B2C1 } from './plannerGlobalPhase2C26B2C2ATargets'
import {
  derivePhase2C26B2C2B1Calculation,
  phase2c26b2c2b1CalculationFromSchedule,
  phase2c26b2c2b1IsCardinalityFirst,
  phase2c26b2c2b1P1Ordering,
  PHASE2C26B2C2B1_NOT_RUN,
  PHASE2C26B2C2B1_ORDERING_POLICY,
  type Phase2C26B2C2B1TargetOrdering,
} from './plannerGlobalPhase2C26B2C2B1'
import calculationSource from './plannerGlobalPhase2C26B2C2B1.ts?raw'
import {
  parsePhase2C26B2C2B1B2AAuthority,
  parsePhase2C26B2C2B1R2Authority,
  phase2c26b2c2b1Characterize,
  phase2c26b2c2b1CohortAggregate,
  phase2c26b2c2b1Covers,
  phase2c26b2c2b1Decision,
  phase2c26b2c2b1ExactExtent,
  phase2c26b2c2b1GridValue,
  phase2c26b2c2b1HashChainIssues,
  phase2c26b2c2b1Ladder,
  phase2c26b2c2b1LadderCoverage,
  phase2c26b2c2b1LadderMonotone,
  phase2c26b2c2b1NextPowerOfTwo,
  phase2c26b2c2b1RequiredExtent,
  phase2c26b2c2b1Stats,
  phase2c26b2c2b1WalkBoundary,
  phase2c26b2c2b1WindowBoundary,
  PHASE2C26B2C2B1_DECISION_RULE,
  PHASE2C26B2C2B1_EXPECTED_POPULATION,
  PHASE2C26B2C2B1_LADDER_CEILING,
  PHASE2C26B2C2B1_REGISTERED,
  type Phase2C26B2C2B1CharacterizeInput,
  type Phase2C26B2C2B1Row,
} from './plannerGlobalPhase2C26B2C2B1Analysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B1Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b1.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b1.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B1: the oracle-free calculation (the B2-C1 schedule + its P1 ordering projection) and the
 * post-hoc extent requirement characterization. The synthetic worlds below are invented for the tests; the committed
 * RESULTs are read only to check the authority parsers and to re-derive the cohorts and the ladder from them. The oracle
 * modules are never imported here (the Phase 2-A.5 isolation rule).
 */

const EXTENT = { ...defaultPlannerAlternativeSearchExtent }
const ORIGIN = { skill: 100, gogma: 10, normal: 0 }
const COUNTER = 'weapon.x:8'

// ---------------------------------------------------------------- synthetic oracle Routes

interface SpecOptions { gogma?: number[]; skill?: number[]; conversion?: number; normalTarget?: number }

/** One synthetic Route spec in the oracle manifest shape (owned unless it forges a production target). */
function spec(targetWeaponId: string, options: SpecOptions): Phase2C26B2AOracleRouteSpec {
  const operations: Phase2C26B2AOracleRouteSpec['operations'][number][] = []
  if (options.normalTarget !== undefined) operations.push({ type: 'create_normal_artian', from: ORIGIN.normal, to: options.normalTarget })
  if (options.conversion !== undefined) operations.push({ type: 'convert_normal_to_gogma', from: options.conversion, to: options.conversion })
  for (const position of options.skill ?? []) operations.push({ type: 'reset_skills', from: position, to: position })
  for (const position of options.gogma ?? []) operations.push({ type: 'reset_bonuses', from: position, to: position })
  const ops = phase2c26b2aExpandSegments(operations)
  const last = (stream: string) => ops.filter(o => o.stream === stream).at(-1)?.position
  const isNew = options.normalTarget !== undefined
  return { targetWeaponId, source: isNew ? { kind: 'new_normal', normalPosition: options.normalTarget! } : { kind: 'owned', ownedWeaponId: `w-${targetWeaponId}` },
    materialization: 'candidate_search', routeKind: isNew ? 'normal_artian_to_gogma' : 'existing_gogma_mixed', operations, required: { normal: isNew ? options.normalTarget! : null, skill: [], gogma: [] },
    estimated: { operations: ops.length, normal: isNew ? options.normalTarget! - ORIGIN.normal + 1 : null, gogma: last('gogma') === undefined ? 0 : last('gogma')! - ORIGIN.gogma + 1,
      skill: last('skill') === undefined ? 0 : last('skill')! - ORIGIN.skill + 1 } }
}
const viewOf = (s: Phase2C26B2AOracleRouteSpec) => phase2c26b2aRouteView(s, 'weapon.x')

/** Every position from the origin through the last own operation that the Route does not operate on is held. */
function heldFor(view: Phase2C26B2ARouteView): PlannerAlternativeReservation {
  const held = (origin: number, own: readonly number[]) => own.length === 0 ? [] : Array.from({ length: own.at(-1)! - origin }, (_, i) => origin + i).filter(p => !own.includes(p))
  return normalizePlannerAlternativeReservation({ normal: [{ counterId: COUNTER as never, held: held(ORIGIN.normal, view.normal.slice(0, 1)), blocked: [] }],
    skill: { held: held(ORIGIN.skill, view.skill), blocked: [] }, gogma: { held: held(ORIGIN.gogma, view.gogma), blocked: [] }, exclusiveOwnedWeaponIds: [] })
}

// ---------------------------------------------------------------- required extent and its boundary semantics

describe('Phase 2-C2.6-B2-C2B1 required extent (B2-A semantics)', () => {
  it('reads the B2-A extent, the shortage against the Production default and the insufficient streams', () => {
    const owned = phase2c26b2c2b1RequiredExtent(viewOf(spec('t', { gogma: [30], skill: [110] })), ORIGIN, EXTENT)
    expect([owned.required, owned.shortage, owned.insufficientStreams, owned.unreadableStreams, owned.withinDefaultExtent])
      .toEqual([{ normal: null, gogma: 21, skill: 11 }, { normal: 0, gogma: 0, skill: 7 }, ['skill'], [], false])
    // The conversion Route's Skill lane is one position wider: reach 6, required 5.
    const converted = phase2c26b2c2b1RequiredExtent(viewOf(spec('t', { normalTarget: 6, conversion: 100, skill: [105], gogma: [250] })), ORIGIN, EXTENT)
    expect([converted.reach, converted.required, converted.shortage, converted.insufficientStreams])
      .toEqual([{ normal: 7, gogma: 241, skill: 6 }, { normal: 7, gogma: 241, skill: 5 }, { normal: 3, gogma: 6, skill: 1 }, ['normal', 'gogma', 'skill']])
    // A new-Normal Route without a Normal origin cannot be read on the Normal stream.
    expect(phase2c26b2c2b1RequiredExtent(viewOf(spec('t', { normalTarget: 2, conversion: 100 })), { ...ORIGIN, normal: null }, EXTENT).unreadableStreams).toEqual(['normal'])
    // Within the default extent: no shortage at all.
    expect(phase2c26b2c2b1RequiredExtent(viewOf(spec('t', { gogma: [244], skill: [103] })), ORIGIN, EXTENT)).toMatchObject({ withinDefaultExtent: true, insufficientStreams: [] })
  })

  it('pins the required value as the exact minimum at the B2-C1 windows: accepted at it, rejected one below on every stream', () => {
    const cases: [string, Phase2C26B2AOracleRouteSpec, Record<string, number | null>][] = [
      ['Gogma lane', spec('t', { gogma: [244] }), { normal: null, gogma: 235, skill: null }],
      ['Gogma lane beyond default', spec('t', { gogma: [300] }), { normal: null, gogma: 291, skill: null }],
      ['existing Gogma Reset Skills', spec('t', { skill: [103] }), { normal: null, gogma: null, skill: 4 }],
      ['existing Gogma Reset Skills beyond default', spec('t', { skill: [104] }), { normal: null, gogma: null, skill: 5 }],
      ['conversion Route Skill (off by one)', spec('t', { normalTarget: 0, conversion: 100, skill: [104] }), { normal: 1, gogma: null, skill: 4 }],
      ['conversion Route Skill beyond default', spec('t', { normalTarget: 0, conversion: 100, skill: [105] }), { normal: 1, gogma: null, skill: 5 }],
      ['production target', spec('t', { normalTarget: 3, conversion: 100 }), { normal: 4, gogma: null, skill: 0 }],
      ['production target beyond default', spec('t', { normalTarget: 4, conversion: 100 }), { normal: 5, gogma: null, skill: 0 }],
    ]
    for (const [name, routeSpec, required] of cases) {
      const view = viewOf(routeSpec)
      const extent = phase2c26b2c2b1RequiredExtent(view, ORIGIN, EXTENT)
      expect([name, extent.required]).toEqual([name, required])
      const boundary = phase2c26b2c2b1WindowBoundary(view, ORIGIN, extent.required, EXTENT)
      expect([name, boundary.valid, boundary.acceptedAtRequired]).toEqual([name, true, true])
      // A required value one too high is not the minimum: lowering it by one still accepts.
      for (const stream of ['normal', 'gogma', 'skill'] as const) {
        if (extent.required[stream] === null || extent.required[stream]! < 1) continue
        const tooHigh = { ...extent.required, [stream]: extent.required[stream]! + 1 }
        expect([name, stream, phase2c26b2c2b1WindowBoundary(view, ORIGIN, tooHigh, EXTENT).valid]).toEqual([name, stream, false])
      }
    }
  })

  it('agrees with the Production limit walk under a compatible reservation, at the required value and one below it', async () => {
    for (const routeSpec of [spec('t', { gogma: [30, 60], skill: [110] }), spec('t', { normalTarget: 6, conversion: 100, skill: [105, 109], gogma: [250] }), spec('t', { skill: [104] })]) {
      const view = viewOf(routeSpec)
      const extent = phase2c26b2c2b1RequiredExtent(view, ORIGIN, EXTENT)
      const walk = await phase2c26b2c2b1WalkBoundary(view, heldFor(view), ORIGIN, extent.required, EXTENT)
      expect(walk).toMatchObject({ compatible: true, acceptedAtRequired: true, valid: true })
      expect(Object.keys(walk.rejectedBelow).sort()).toEqual(['gogma', 'normal', 'skill'].filter(s => extent.required[s as 'skill'] !== null && extent.required[s as 'skill']! >= 2))
      const tooLow = { ...extent.required, skill: extent.required.skill! - 1 }
      expect((await phase2c26b2c2b1WalkBoundary(view, heldFor(view), ORIGIN, tooLow, EXTENT)).acceptedAtRequired).toBe(false)
    }
    // An incompatible reservation (nothing held) is reported, never read as a boundary.
    const view = viewOf(spec('t', { skill: [110] }))
    expect(await phase2c26b2c2b1WalkBoundary(view, normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] }),
      ORIGIN, phase2c26b2c2b1RequiredExtent(view, ORIGIN, EXTENT).required, EXTENT)).toMatchObject({ compatible: false, valid: false })
  })

  it('builds the exact extent from the required values, keeping the base for a stream the Route does not operate on', () => {
    expect(phase2c26b2c2b1ExactExtent({ normal: null, gogma: 21, skill: 0 }, EXTENT)).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 21, maxSkillAdvance: 1 })
    expect(phase2c26b2c2b1ExactExtent({ normal: 7, gogma: null, skill: 1083 }, EXTENT)).toEqual({ maxNormalAdvance: 7, maxGogmaAdvance: 235, maxSkillAdvance: 1083 })
  })
})

// ---------------------------------------------------------------- aggregates and ladder

describe('Phase 2-C2.6-B2-C2B1 aggregates and ladder', () => {
  it('reports deterministic nearest-rank statistics', () => {
    expect(phase2c26b2c2b1Stats([])).toEqual({ n: 0, min: null, median: null, p75: null, p90: null, max: null })
    expect(phase2c26b2c2b1Stats([1083, 8, 22, 46, 145, 168, 226, 248, 446, 450, 547])).toEqual({ n: 11, min: 8, median: 226, p75: 450, p90: 547, max: 1083 })
    expect(phase2c26b2c2b1Stats([5, 126])).toEqual({ n: 2, min: 5, median: 5, p75: 126, p90: 126, max: 126 })
    const values = [3, 1, 4, 1, 5, 9, 2, 6]
    expect(phase2c26b2c2b1Stats(values)).toEqual(phase2c26b2c2b1Stats([...values].reverse()))
    expect(phase2c26b2c2b1Stats(values).median).toBe(phase2c26b2c1Percentile(values, 50))
  })

  it('places a value on the registered grid: default kept, power of two, lowered to the ceiling, unbounded above it', () => {
    expect([1, 2, 3, 5, 8, 9, 1083].map(phase2c26b2c2b1NextPowerOfTwo)).toEqual([1, 2, 4, 8, 8, 16, 2048])
    expect(() => phase2c26b2c2b1NextPowerOfTwo(0)).toThrow()
    expect(phase2c26b2c2b1GridValue(null, 4, 1500)).toBe(4)
    expect(phase2c26b2c2b1GridValue(3, 4, 1500)).toBe(4)
    expect(phase2c26b2c2b1GridValue(5, 4, 1500)).toBe(8)
    expect(phase2c26b2c2b1GridValue(226, 4, 1500)).toBe(256)
    expect(phase2c26b2c2b1GridValue(1083, 4, 1500)).toBe(1500)
    expect(phase2c26b2c2b1GridValue(1500, 4, 1500)).toBe(1500)
    expect(phase2c26b2c2b1GridValue(1501, 4, 1500)).toBeNull()
    expect(phase2c26b2c2b1GridValue(240, 235, 500)).toBe(256)
    expect(() => phase2c26b2c2b1GridValue(1, 600, 500)).toThrow()
    expect(PHASE2C26B2C2B1_LADDER_CEILING).toEqual({ ...recommendedCandidateSearchDefaults })
  })

  const row = (targetWeaponId: string, required: { normal: number | null; gogma: number | null; skill: number | null }) => {
    const shortage = { normal: Math.max(0, (required.normal ?? 0) - 4), gogma: Math.max(0, (required.gogma ?? 0) - 235), skill: Math.max(0, (required.skill ?? 0) - 4) }
    return { targetWeaponId, extent: { required, shortage, insufficientStreams: (['normal', 'gogma', 'skill'] as const).filter(s => shortage[s] > 0) } } as unknown as Phase2C26B2C2B1Row
  }

  it('derives L0 / L1 / L2 from the E1 cohort median and maximum, dedups equal rungs and covers every E1 Target with the top rung', () => {
    const e1 = [row('a', { normal: 5, gogma: 119, skill: 22 }), row('b', { normal: null, gogma: 46, skill: 46 }), row('c', { normal: 126, gogma: 23, skill: 450 }), row('d', { normal: null, gogma: 17, skill: 1083 })]
    const ladder = phase2c26b2c2b1Ladder(e1, EXTENT, PHASE2C26B2C2B1_LADDER_CEILING)
    expect(ladder.bounded).toBe(true)
    expect(ladder.inputs.skill).toEqual({ values: [22, 46, 450, 1083], median: 46, max: 1083 })
    expect(ladder.inputs.gogma).toEqual({ values: [], median: null, max: null })
    expect(ladder.rungs).toEqual([
      { id: 'L0', name: 'default', extent: EXTENT },
      { id: 'L1', name: 'intermediate', extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 64 } },
      { id: 'L2', name: 'larger', extent: { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } },
    ])
    expect(phase2c26b2c2b1LadderMonotone(ladder.rungs)).toBe(true)
    const coverage = phase2c26b2c2b1LadderCoverage(ladder.rungs, e1)
    expect(coverage.byRung).toEqual([{ id: 'L0', covered: 0, of: 4 }, { id: 'L1', covered: 2, of: 4 }, { id: 'L2', covered: 4, of: 4 }])
    expect(coverage.firstRung).toEqual({ a: 'L1', b: 'L1', c: 'L2', d: 'L2' })
    // Input order never changes the ladder.
    expect(phase2c26b2c2b1Ladder([...e1].reverse(), EXTENT, PHASE2C26B2C2B1_LADDER_CEILING)).toEqual(ladder)
    // One insufficient value: L1 = L2 is dropped.
    expect(phase2c26b2c2b1Ladder([row('x', { normal: null, gogma: 10, skill: 11 })], EXTENT, PHASE2C26B2C2B1_LADDER_CEILING).rungs.map(r => r.id)).toEqual(['L0', 'L1'])
    // A value above the ceiling leaves no bounded ladder.
    expect(phase2c26b2c2b1Ladder(e1, EXTENT, { ...PHASE2C26B2C2B1_LADDER_CEILING, maxSkillAdvance: 1000 })).toMatchObject({ bounded: false, unboundedStreams: ['skill'], rungs: [] })
    expect(phase2c26b2c2b1Covers({ normal: null, gogma: 235, skill: 4 }, EXTENT)).toBe(true)
    expect(phase2c26b2c2b1Covers({ normal: 5, gogma: 1, skill: 1 }, EXTENT)).toBe(false)
    expect(phase2c26b2c2b1LadderMonotone([{ id: 'L0', name: 'default', extent: EXTENT }, { id: 'L1', name: 'intermediate', extent: { ...EXTENT, maxGogmaAdvance: 100 } }])).toBe(false)
  })

  it('aggregates required extents, shortages and stream counts per cohort', () => {
    const rows = [row('a', { normal: 5, gogma: 119, skill: 22 }), row('b', { normal: null, gogma: 46, skill: 46 }), row('c', { normal: 126, gogma: 23, skill: 450 })]
      .map(r => ({ ...r, p1FirstCompatibleRank: 2, route: { sourceKind: 'owned', method: 'm', routeKind: 'k', conversion: false, operations: 1 } } as Phase2C26B2C2B1Row))
    const aggregate = phase2c26b2c2b1CohortAggregate(rows)
    expect(aggregate.insufficientTargetsByStream).toEqual({ normal: 2, gogma: 0, skill: 3 })
    expect(aggregate.operatedTargetsByStream).toEqual({ normal: 2, gogma: 3, skill: 3 })
    expect(aggregate.multiStreamInsufficient).toBe(2)
    expect(aggregate.insufficientCombination).toEqual({ 'normal+skill': 2, skill: 1 })
    expect(aggregate.required.skill).toEqual({ n: 3, min: 22, median: 46, p75: 450, p90: 450, max: 450 })
    expect(aggregate.shortage.normal).toEqual({ n: 2, min: 1, median: 1, p75: 122, p90: 122, max: 122 })
    expect(aggregate.shortage.gogma.n).toBe(0)
  })
})

// ---------------------------------------------------------------- decision

describe('Phase 2-C2.6-B2-C2B1 decision', () => {
  it('decides CHARACTERIZED / UNBOUNDED / UNDETERMINED / INVALID by the registered rule', () => {
    const decide = (patch: Partial<Parameters<typeof phase2c26b2c2b1Decision>[0]> = {}) =>
      phase2c26b2c2b1Decision({ invalidReasons: [], unreadableTargets: [], ladderBounded: true, e1: 11, e1CoveredByTopRung: 11, ...patch }).case
    expect(decide()).toBe('B2C2B1_CHARACTERIZED')
    expect(decide({ ladderBounded: false, e1CoveredByTopRung: 0 })).toBe('B2C2B1_UNBOUNDED')
    expect(decide({ unreadableTargets: ['t'], ladderBounded: false, e1CoveredByTopRung: 0 })).toBe('B2C2B1_UNDETERMINED')
    expect(decide({ invalidReasons: ['b2c1_parity: x'] })).toBe('B2C2B1_INVALID')
    expect(decide({ invalidReasons: ['x'], unreadableTargets: ['t'] })).toBe('B2C2B1_INVALID')
    expect(decide({ e1CoveredByTopRung: 10 })).toBe('B2C2B1_INVALID')
    expect(decide({ e1: 0, e1CoveredByTopRung: 0 })).toBe('B2C2B1_INVALID')
    expect(() => decide({ e1CoveredByTopRung: 12 })).toThrow()
    expect(PHASE2C26B2C2B1_DECISION_RULE.order.map(line => line.split(':')[0])).toEqual(['B2C2B1_INVALID', 'B2C2B1_UNDETERMINED', 'B2C2B1_UNBOUNDED', 'B2C2B1_CHARACTERIZED'])
  })
})

// ---------------------------------------------------------------- characterization over a synthetic world

/** E1 t-1 (Skill short), E1 t-2 (Normal short), E2 t-3 (Skill short), defaultExtent t-4, unreached t-5. */
const SPECS = [
  spec('t-1', { gogma: [30], skill: [110] }),
  spec('t-2', { normalTarget: 5, conversion: 100, skill: [102], gogma: [12] }),
  spec('t-3', { skill: [140] }),
  spec('t-4', { gogma: [20] }),
  spec('t-5', { skill: [500] }),
]
const SUBGROUPS: Record<string, string[]> = {
  't-1': ['recovered', 'extentInsufficient', 'k1Minimal'], 't-2': ['recovered', 'extentInsufficient', 'k1Minimal'], 't-3': ['recovered', 'extentInsufficient', 'k2Minimal'],
  't-4': ['recovered', 'defaultExtent', 'k1Minimal'], 't-5': ['unreached'],
}
const RANKS: Record<string, number | null> = { 't-1': 2, 't-2': 3, 't-3': 60, 't-4': 2, 't-5': null }

function world() {
  const views = new Map(SPECS.map(s => [s.targetWeaponId, viewOf(s)] as const))
  const first = (id: string) => ({ rank: RANKS[id]!, reservationDigest: RANKS[id] === null ? null : `d-${id}`, cardinality: RANKS[id] === null ? null : 1, representativeFixedSetId: null,
    representativeFixedTargetWeaponIds: [], k1Before: 0, k2Before: 0, representativeIncludesOracleSupporter: null })
  const c1Rows = SPECS.map(s => ({ targetWeaponId: s.targetWeaponId, subgroups: SUBGROUPS[s.targetWeaponId]!, b2b1: {} as never,
    reach: { firstCompatible: { P0: first(s.targetWeaponId), P1: first(s.targetWeaponId), P2: first(s.targetWeaponId), P3: first(s.targetWeaponId) } } })) as unknown as Phase2C26B2C1RouteRow[]
  const record = (s: Phase2C26B2AOracleRouteSpec) => {
    const e = phase2c26b2aRouteExtent(viewOf(s), ORIGIN, EXTENT)
    return { withinDefaultExtent: e.withinDefaultExtent, verdict: e.verdict, required: e.required, reach: e.reach }
  }
  const input: Phase2C26B2C2B1CharacterizeInput = {
    c1Rows, views, originsOf: () => ORIGIN,
    reservationOfDigest: digest => { const view = views.get(digest.slice(2)); return view ? heldFor(view) : null },
    extent: EXTENT,
    b2b1Routes: SPECS.map(s => ({ targetWeaponId: s.targetWeaponId, extent: record(s) })),
    b2aRoutes: SPECS.map(s => ({ targetWeaponId: s.targetWeaponId, extent: { ...record(s), estimatedMatches: true } })),
    b2c1Routes: SPECS.map(s => ({ targetWeaponId: s.targetWeaponId, subgroups: [...SUBGROUPS[s.targetWeaponId]!], p1FirstCompatible: { rank: RANKS[s.targetWeaponId]!,
      reservationDigest: RANKS[s.targetWeaponId] === null ? null : `d-${s.targetWeaponId}`, cardinality: null, representativeFixedSetId: null } })),
    r2DefaultExtentTargetWeaponIds: ['t-4'],
    routeKindOf: id => SPECS.find(s => s.targetWeaponId === id)!.routeKind,
    expected: { extentInsufficient: 3, e1: 2, e2: 1, defaultExtent: 1, unreached: 1 },
    expectedRanks: { e1MaxRank: 3, e2MinRank: 60, e2MaxRank: 60 },
    expectedByStream: { normal: 1, gogma: 0, skill: 2 },
  }
  return input
}

async function characterize(mutate?: (input: Phase2C26B2C2B1CharacterizeInput) => void) {
  const input = world()
  mutate?.(input)
  const result = await phase2c26b2c2b1Characterize(input)
  return { result, decision: phase2c26b2c2b1Decision({ invalidReasons: result.invalidReasons, ...result.decisionInput }) }
}

describe('Phase 2-C2.6-B2-C2B1 characterization', () => {
  it('splits the extent-insufficient cohort into E1 / E2, characterizes every Route and registers a covering ladder', async () => {
    const { result, decision } = await characterize()
    expect(result.invalidReasons).toEqual([])
    expect(result.cohorts).toEqual({ counts: { extentInsufficient: 3, e1: 2, e2: 1, defaultExtent: 1, unreached: 1 }, e1: ['t-1', 't-2'], e2: ['t-3'] })
    expect(result.rows.map(r => [r.targetWeaponId, r.cohort, r.extent.required, r.extent.insufficientStreams, r.windowBoundary.valid, r.walkBoundary?.valid])).toEqual([
      ['t-1', 'E1', { normal: null, gogma: 21, skill: 11 }, ['skill'], true, true],
      ['t-2', 'E1', { normal: 6, gogma: 3, skill: 2 }, ['normal'], true, true],
      ['t-3', 'E2', { normal: null, gogma: null, skill: 41 }, ['skill'], true, true],
    ])
    expect(result.rows.every(r => Object.values(r.parity).every(Boolean))).toBe(true)
    expect(result.aggregates.all.insufficientTargetsByStream).toEqual({ normal: 1, gogma: 0, skill: 2 })
    expect(result.ladder!.rungs.map(r => [r.id, r.extent])).toEqual([['L0', EXTENT], ['L1', { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 16 }]])
    expect(result.coverage!.e1.byRung.at(-1)).toEqual({ id: 'L1', covered: 2, of: 2 })
    expect(result.coverage!.e2Diagnostic.firstRung).toEqual({ 't-3': null })
    expect(decision.case).toBe('B2C2B1_CHARACTERIZED')
    // The same world in any input order gives the same rows and ladder.
    const reversed = await characterize(input => { input.c1Rows = [...input.c1Rows].reverse() })
    expect(stableStringify(reversed.result.rows)).toBe(stableStringify(result.rows))
    expect(reversed.result.ladder).toEqual(result.ladder)
  })

  it('fails closed on a population, subgroup, P1 rank, extent parity, stream count or boundary drift', async () => {
    const reasons = async (mutate: (input: Phase2C26B2C2B1CharacterizeInput) => void) => (await characterize(mutate)).result.invalidReasons.join('\n')
    expect(await reasons(input => { input.expected = { ...input.expected!, e1: 3 } })).toMatch(/population: .* is not the registered/)
    expect(await reasons(input => { (input.c1Rows[0] as { subgroups: string[] }).subgroups = ['recovered', 'extentInsufficient', 'k1Minimal', 'k2Minimal'] })).toMatch(/not exactly one of K1-minimal \/ K2-minimal/)
    expect(await reasons(input => { input.r2DefaultExtentTargetWeaponIds = ['t-4', 't-1'] })).toMatch(/R2 default-extent Targets are not the defaultExtent subgroup/)
    expect(await reasons(input => { input.b2c1Routes[0]!.subgroups = ['recovered'] })).toMatch(/b2c1_parity: t-1: subgroups differ/)
    expect(await reasons(input => { input.b2c1Routes[1]!.p1FirstCompatible.rank = 4 })).toMatch(/b2c1_parity: t-2: the P1 first compatible context differs/)
    expect(await reasons(input => { (input.b2b1Routes[0]!.extent as { required: { skill: number } }).required.skill = 12 })).toMatch(/extent_parity: t-1: .* differs from B2-B1/)
    expect(await reasons(input => { (input.b2aRoutes[2]!.extent as { estimatedMatches: boolean }).estimatedMatches = false })).toMatch(/extent_parity: t-3: .* differs from B2-A/)
    expect(await reasons(input => { input.expectedByStream = { normal: 1, gogma: 0, skill: 3 } })).toMatch(/insufficient Targets by stream/)
    expect(await reasons(input => { input.expectedRanks = { e1MaxRank: 2, e2MinRank: 60, e2MaxRank: 60 } })).toMatch(/E1 P1 first compatible rank exceeds/)
    expect(await reasons(input => { input.reservationOfDigest = () => null })).toMatch(/P1 first compatible reservation is not in the schedule/)
    // A reservation that leaves a gap the Route needs: the walk boundary does not hold.
    expect(await reasons(input => { input.reservationOfDigest = () => normalizePlannerAlternativeReservation({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] }) }))
      .toMatch(/Production walk boundary is not at the required extent/)
    // The defaultExtent subgroup must mean within the default extent.
    expect(await reasons(input => { (input.c1Rows[3] as { subgroups: string[] }).subgroups = ['recovered', 'extentInsufficient', 'k1Minimal'] })).toMatch(/extent_semantics: t-4/)
    expect(await reasons(input => { input.extent = { ...EXTENT, maxSkillAdvance: 5 } })).toMatch(/not the Production default extent/)
  })

  it('is UNDETERMINED on an unreadable required extent and UNBOUNDED above the ceiling', async () => {
    const undetermined = await characterize(input => { input.originsOf = view => ({ ...ORIGIN, normal: view.targetWeaponId === 't-2' ? null : ORIGIN.normal }) })
    expect(undetermined.result.unreadableTargets).toEqual(['t-2'])
    expect(undetermined.result.ladder).toBeNull()
    // Every other check still runs; only B2-B1 / B2-A parity notices the changed origin, so they are aligned here.
    expect(undetermined.result.invalidReasons.filter(r => !/extent_parity|boundary/.test(r))).toEqual([])
    expect(phase2c26b2c2b1Decision({ invalidReasons: [], ...undetermined.result.decisionInput }).case).toBe('B2C2B1_UNDETERMINED')
    const unbounded = await characterize(input => { input.ceiling = { ...PHASE2C26B2C2B1_LADDER_CEILING, maxSkillAdvance: 10 } })
    expect(unbounded.result.ladder).toMatchObject({ bounded: false, unboundedStreams: ['skill'] })
    expect(unbounded.decision.case).toBe('B2C2B1_UNBOUNDED')
  })
})

// ---------------------------------------------------------------- the calculation (oracle-free)

describe('Phase 2-C2.6-B2-C2B1 calculation', () => {
  const ordering = (contexts: number, k1: number, k2: number, k1Ranks: [number, number] | null, k2Ranks: [number, number] | null): Phase2C26B2C2B1TargetOrdering =>
    ({ targetWeaponId: 't', contexts, byEligibleMinCardinality: { '0': contexts === 0 ? 0 : 1, '1': k1, '2': k2 }, p1: { k0Rank: contexts === 0 ? null : 1, k1Ranks, k2Ranks } })

  it('recognizes a cardinality-first P1 projection only', () => {
    expect(phase2c26b2c2b1IsCardinalityFirst(ordering(5, 2, 2, [2, 3], [4, 5]))).toBe(true)
    expect(phase2c26b2c2b1IsCardinalityFirst(ordering(3, 2, 0, [2, 3], null))).toBe(true)
    expect(phase2c26b2c2b1IsCardinalityFirst(ordering(0, 0, 0, null, null))).toBe(true)
    expect(phase2c26b2c2b1IsCardinalityFirst(ordering(5, 2, 2, [2, 4], [3, 5]))).toBe(false)
    expect(phase2c26b2c2b1IsCardinalityFirst({ ...ordering(5, 2, 2, [2, 3], [4, 5]), p1: { k0Rank: 2, k1Ranks: [2, 3], k2Ranks: [4, 5] } })).toBe(false)
  })

  it('projects the unchanged B2-C1 schedule of a Planner input onto P1 ranks and fails closed on a repeated K0', () => {
    const t = (id: string) => orchestrationTarget(id, { priority: 3 })
    const targets: TargetWeapon[] = [t('target.b2c2b1.a'), t('target.b2c2b1.b'), t('target.b2c2b1.c'), t('target.b2c2b1.d')]
    const sources = [orchestrationSource('owned.b2c2b1.a'), orchestrationSource('owned.b2c2b1.b'), orchestrationSource('owned.b2c2b1.c'), orchestrationSource('owned.b2c2b1.d', { seriesSkillId: IDEAL_SERIES_SKILL_ID })]
    const entries: BuildListEntry[] = [
      orchestrationEntry('bl.b2c2b1.a', targets[0]!, resetRoute('owned.b2c2b1.a', 10), { finalBonuses: idealBonuses() }),
      orchestrationEntry('bl.b2c2b1.b', targets[1]!, resetRoute('owned.b2c2b1.b', 10), { finalBonuses: idealBonuses() }),
      orchestrationEntry('bl.b2c2b1.c', targets[2]!, resetRoute('owned.b2c2b1.c', 11), { finalBonuses: idealBonuses() }),
      checkpointBonusEntry('bl.b2c2b1.d', targets[3]!, 'owned.b2c2b1.d', sources[3]!),
    ]
    const built = orchestrationScenario({ engine: { resetResultAt: checkpointBonusResultAt }, targets, ownedWeapons: sources, entries })
    const calculation = derivePhase2C26B2C2B1Calculation(built.input, globalResearchDependencies(built.engine))
    expect(stableStringify(calculation.schedule)).toBe(stableStringify(derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))))
    expect(calculation.orderingPolicy).toBe('P1')
    expect(calculation.checks).toEqual({ p1CardinalityFirst: true, p1OrderingCoversTargets: true })
    for (const row of calculation.p1Ordering) {
      const contexts = calculation.schedule.contexts.filter(c => c.targetWeaponId === row.targetWeaponId)
      expect(row.contexts).toBe(contexts.length)
      expect(row.byEligibleMinCardinality['1']).toBe(contexts.filter(c => c.targetEligibleMinCardinality === 1).length)
    }
    // The checkpoint hard-constraint Target holds no context.
    expect(calculation.p1Ordering.find(r => r.targetWeaponId === 'target.b2c2b1.d')).toMatchObject({ contexts: 0, p1: { k0Rank: null, k1Ranks: null, k2Ranks: null } })
    expect(phase2c26b2c2b1CalculationFromSchedule(calculation.schedule)).toEqual(calculation)
    const broken = structuredClone(calculation.schedule)
    const k1 = broken.contexts.find(c => c.targetEligibleMinCardinality === 1)!
    k1.targetEligibleMinCardinality = 0
    expect(() => phase2c26b2c2b1P1Ordering(broken)).toThrow(/K0/)
  })

  it('keeps P1 the registered B2-C1 definition and declares the Search as not run', () => {
    expect(PHASE2C26B2C2B1_ORDERING_POLICY).toBe('P1')
    expect(stableStringify(PHASE2C26B2C1_POLICIES.find(p => p.id === 'P1'))).toBe(stableStringify(PHASE2C26B2C1_REGISTERED_POLICIES.find(p => p.id === 'P1')))
    for (const item of ['planner_alternative_search', 'candidate_search', 'actual_search_probe', 'candidate_capture_comparison', 'candidate_trial', 'planner_alternative_kernel',
      'full_planner_rerun', 'global_assignment', 'extent_change', 'production_default_change', 'k2_feature_grouping']) expect(PHASE2C26B2C2B1_NOT_RUN).toContain(item)
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
  })
})

// ---------------------------------------------------------------- authorities (committed RESULTs)

describe('Phase 2-C2.6-B2-C2B1 authorities', () => {
  const sha = PHASE2C26B2C2B1_REGISTERED
  const b2a = JSON.parse(rawB2A), r2 = JSON.parse(rawR2), b2c1 = JSON.parse(rawB2C1), b2b1 = JSON.parse(rawB2B1)

  it('accepts the committed formal B2-A RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C2B1B2AAuthority(b2a, sha.b2a.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.routes.length).toBe(43)
    expect(parsePhase2C26B2C2B1B2AAuthority(b2a, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof b2a) => void) => { const copy = structuredClone(b2a); patch(copy); return parsePhase2C26B2C2B1B2AAuthority(copy, sha.b2a.resultSha256).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2A_PROBE' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.aggregates.all.needsLargerExtentByStream.skill = 22 })).toBe(false)
    expect(mutate(j => { j.routes.pop() })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { extent: { withinDefaultExtent: boolean } }) => !r.extent.withinDefaultExtent).extent.withinDefaultExtent = true })).toBe(false)
  })

  it('accepts the committed formal R2 RESULT as the completed default-extent validation and fails closed otherwise', () => {
    const parsed = parsePhase2C26B2C2B1R2Authority(r2, sha.r2.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.defaultExtentTargetWeaponIds.length).toBe(20)
    expect(parsed.authority!.b2c1ResultSha256).toBe(PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256)
    expect(parsePhase2C26B2C2B1R2Authority(r2, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof r2) => void) => { const copy = structuredClone(r2); patch(copy); return parsePhase2C26B2C2B1R2Authority(copy, sha.r2.resultSha256).valid }
    expect(mutate(j => { j.decision.case = 'B2C2AR2_INCOMPLETE' })).toBe(false)
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.b2c1ResultSha256 = 'f'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.combinedTargets.pop() })).toBe(false)
    expect(mutate(j => { j.combinedTargets[0].fullyMeasured = false })).toBe(false)
    expect(mutate(j => { j.aggregates.combined.exactTargets.C4C = 19 })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
  })

  it('re-derives the registered cohorts, stream counts, rank ranges and ladder from the committed B2-B1 / B2-C1 / R2 authorities alone', () => {
    const c1 = parsePhase2C26B2C2AB2C1Authority(b2c1, PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256)
    const b1 = parsePhase2C26B2C1B2B1Authority(b2b1, PHASE2C26B2C2A_REGISTERED_B2C1.b2b1ResultSha256)
    const r = parsePhase2C26B2C2B1R2Authority(r2, sha.r2.resultSha256)
    expect([c1.issues, b1.issues, r.issues]).toEqual([[], [], []])
    const routes = c1.authority!.routes
    const insufficient = routes.filter(x => x.subgroups.includes('extentInsufficient'))
    const e1 = insufficient.filter(x => x.subgroups.includes('k1Minimal')), e2 = insufficient.filter(x => x.subgroups.includes('k2Minimal'))
    const defaults = routes.filter(x => x.subgroups.includes('defaultExtent')).map(x => x.targetWeaponId).sort()
    expect({ extentInsufficient: insufficient.length, e1: e1.length, e2: e2.length, defaultExtent: defaults.length, unreached: routes.filter(x => x.subgroups.includes('unreached')).length })
      .toEqual(PHASE2C26B2C2B1_EXPECTED_POPULATION)
    expect(insufficient.every(x => x.subgroups.includes('k1Minimal') !== x.subgroups.includes('k2Minimal'))).toBe(true)
    expect(r.authority!.defaultExtentTargetWeaponIds).toEqual(defaults)
    expect(insufficient.some(x => defaults.includes(x.targetWeaponId))).toBe(false)
    expect(Math.max(...e1.map(x => x.p1FirstCompatible.rank!))).toBeLessThanOrEqual(sha.b2c1P1.e1MaxRank)
    expect([Math.min(...e2.map(x => x.p1FirstCompatible.rank!)), Math.max(...e2.map(x => x.p1FirstCompatible.rank!))]).toEqual([sha.b2c1P1.e2MinRank, sha.b2c1P1.e2MaxRank])
    const extentOf = new Map(b1.authority!.routes.map(x => [x.targetWeaponId, x.extent as { required: Record<'normal' | 'gogma' | 'skill', number | null>; verdict: Record<string, string> }]))
    const byStream = Object.fromEntries((['normal', 'skill', 'gogma'] as const).map(s => [s, insufficient.filter(x => extentOf.get(x.targetWeaponId)!.verdict[s] === 'requires_larger_extent').length]))
    expect(byStream).toEqual(sha.b2b1ExtentByStream)
    const rows = e1.map(x => {
      const required = extentOf.get(x.targetWeaponId)!.required
      const shortage = { normal: Math.max(0, (required.normal ?? 0) - 4), gogma: Math.max(0, (required.gogma ?? 0) - 235), skill: Math.max(0, (required.skill ?? 0) - 4) }
      return { targetWeaponId: x.targetWeaponId, extent: { required, shortage } } as unknown as Phase2C26B2C2B1Row
    })
    const ladder = phase2c26b2c2b1Ladder(rows, EXTENT, PHASE2C26B2C2B1_LADDER_CEILING)
    expect(ladder.rungs.map(rung => [rung.id, rung.extent])).toEqual([
      ['L0', { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }],
      ['L1', { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }],
      ['L2', { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }],
    ])
    expect(phase2c26b2c2b1LadderCoverage(ladder.rungs, rows).byRung.map(x => x.covered)).toEqual([0, 7, 11])
  })

  it('reports every disagreeing recorder of the hash chain', () => {
    const chain = { exportSha256: { a: 'x', b: 'x' }, oracleResultSha256: { a: 'o', b: 'o' }, oracleManifestFileSha256: { a: 'm', b: 'm' }, oracleManifestRoutesSha256: { a: 'r', b: 'r' },
      b2c1ResultSha256: { a: 'c', b: 'c' }, b2b1ResultSha256: { a: 'b', b: 'b' } }
    expect(phase2c26b2c2b1HashChainIssues(chain)).toEqual([])
    expect(phase2c26b2c2b1HashChainIssues({ ...chain, exportSha256: { a: 'x', b: 'y' } })).toEqual(['exportSha256: a=x, b=y'])
    expect(phase2c26b2c2b1HashChainIssues({ ...chain, b2c1ResultSha256: { a: 'c' } })).toEqual(['b2c1ResultSha256: fewer than two recorders'])
  })
})

// ---------------------------------------------------------------- isolation

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

describe('Phase 2-C2.6-B2-C2B1 isolation', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B1/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [calculationSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\./)
    }
    // The calculation holds no numeric literal but its heap size: no origin, Counter position, rank or extent value.
    expect(code(calculationSource).match(/\b\d{2,}\b/g)).toEqual(['8192'])
    // The analysis registers authority values (hashes, counts, rank ranges) but no oracle required position.
    for (const value of ['1083', '547', '450', '446', '126', '341']) expect(code(analysisSource)).not.toMatch(new RegExp(`\\b${value}\\b`))
    for (const source of [calculationSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, the manifest and every earlier RESULT out of the calculation: only the analyzer reads them, after the calculation', () => {
    for (const source of [calculationSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2b1-result|--b2c1-result|--b2a-result|--r2-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|Analysis|B2B2A|oracleSupport|ROUTES/)
    }
    for (const flag of ['--oracle', '--manifest', '--b2b1-result', '--b2c1-result', '--b2a-result', '--r2-result', '--calculation']) expect(analyzerSource).toContain(flag)
    expect(analyzerSource).toMatch(/oracleReadByCalculation: false/)
    expect(analyzerSource).toMatch(/targetIndividualOracleExtentAsSearchInput: false/)
    expect(analyzerSource).toMatch(/const decision = !formal && !allowNonformal \? null :/)
    // The analysis never writes a rank, a context or an extent back into the calculation.
    expect(analysisSource).not.toMatch(/ranks\[[^\]]*\]\s*=|schedule\.(contexts|targets|extent)\s*=|calculation\.\w+\s*=/)
  })

  it('runs no Search, kernel, trial or Planner: the calculation derives a schedule, the analysis reads only', () => {
    for (const source of [calculationSource, runnerSource, analysisSource, analyzerSource]) {
      expect(source).not.toMatch(/visitPlannerAlternativeCandidates|searchCandidates\(|runPhase2C26B1SearchTask|runPhase2C2SearchContext|runPhase2C2Kernel|runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|createDeterministicMaterializer|enumerateConstrainedCandidates|runPhase2C26B2C2ASearch/)
    }
    expect(calculationSource).toMatch(/derivePhase2C26B2C1Schedule\(/)
    expect(analysisSource).toMatch(/phase2c26b2aRouteExtent\(/)
    expect(analysisSource).toMatch(/phase2c26b2aReachability\(/)
    expect(analysisSource).toMatch(/runPhase2C26B2C1Audit\(/)
  })
})
