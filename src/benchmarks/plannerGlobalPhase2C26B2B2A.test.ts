import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json?raw'
import { hashStableValue } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import { candidateStableKey, defaultPlannerAlternativeSearchExtent, type PlannerAlternativeCandidate, type PlannerAlternativeSearchExecution } from '../domain/search'
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
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { runPhase2C2SearchContext, type Phase2C2CandidateSummary, type Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { phase2c26b2aReservationRanges } from './plannerGlobalPhase2C26B2AAnalysis'
import { derivePhase2C26B2B1Snapshot, type Phase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1'
import {
  comparePhase2C26B2B2AConditions,
  comparePhase2C26B2B2AReconstruction,
  parsePhase2C26B2B2AB2B1Authority,
  phase2c26b2b2aNeedsFallback,
  phase2c26b2b2aTaskInput,
  phase2c26b2b2aTaskOutcome,
  reconstructPhase2C26B2B2AContext,
  runPhase2C26B2B2ASearch,
  runPhase2C26B2B2ATask,
  selectPhase2C26B2B2ATasks,
  PHASE2C26B2B2A_CAPTURE_BOUND,
  PHASE2C26B2B2A_FALLBACK,
  PHASE2C26B2B2A_REGISTERED_B2B1,
  PHASE2C26B2B2A_STAGE1,
  type Phase2C26B2B2AAuthority,
  type Phase2C26B2B2AContext,
  type Phase2C26B2B2ASearchRecord,
  type Phase2C26B2B2ASelection,
  type Phase2C26B2B2ATaskInput,
} from './plannerGlobalPhase2C26B2B2A'
import calculationSource from './plannerGlobalPhase2C26B2B2A.ts?raw'
import {
  phase2c26b2b2aCompare,
  phase2c26b2b2aDecision,
  phase2c26b2b2aFinalOutcomes,
  phase2c26b2b2aIndexBucket,
  phase2c26b2b2aPercentile,
  runPhase2C26B2B2AAnalysis,
  validatePhase2C26B2B2ARaw,
  PHASE2C26B2B2A_DECISION_RULE,
  type Phase2C26B2B2ARun,
} from './plannerGlobalPhase2C26B2B2AAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2B2AAnalysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2b2a.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2b2a.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-B2A: Search delivery of known-compatible, default-extent representative contexts. The
 * synthetic worlds below are invented for the tests; the committed B2-B1 RESULT is read only to check the task-selection
 * authority. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

/**
 * Every Search input, in call order. `replay > 0` makes the Search hand the visitor its first real Candidate `replay`
 * times (to reach the capture bound in a small world); every visitor decision is recorded.
 */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[], replay: 0, decisions: [] as string[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: async (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>): Promise<PlannerAlternativeSearchExecution> => {
      const [input, engine, onCandidate, options] = args
      searchCalls.inputs.push(structuredClone(input))
      if (searchCalls.replay === 0) {
        return actual.visitPlannerAlternativeCandidates(input, engine, async candidate => { const d = await onCandidate(candidate); searchCalls.decisions.push(d); return d }, options)
      }
      let first: PlannerAlternativeCandidate | null = null
      await actual.visitPlannerAlternativeCandidates(input, engine, candidate => { first = candidate; return 'stop' }, options)
      if (first === null) throw new Error('The replay world delivers no Candidate.')
      for (let delivered = 1; delivered <= searchCalls.replay; delivered += 1) {
        const d = await onCandidate(first)
        searchCalls.decisions.push(d)
        if (d === 'stop') return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: delivered, excludedCandidates: 0, exhausted: false, stoppedByExtent: false }, stoppedByConsumer: true, skippedExcludedRouteKeys: [] }
      }
      return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: searchCalls.replay, excludedCandidates: 0, exhausted: true, stoppedByExtent: false }, stoppedByConsumer: false, skippedExcludedRouteKeys: [] }
    },
  }
})
beforeEach(() => { searchCalls.inputs = []; searchCalls.replay = 0; searchCalls.decisions = [] })

const digest = (value: string) => hashStableValue(value)
const b2b1Json = JSON.parse(rawB2B1)
const registeredSha = PHASE2C26B2B2A_REGISTERED_B2B1.resultSha256

// ---------------------------------------------------------------- the B2-B1 RESULT (task-selection authority)

describe('Phase 2-C2.6-B2-B2A B2-B1 authority and task selection', () => {
  it('accepts the committed formal B2-B1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2B2AB2B1Authority(b2b1Json, registeredSha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.routes).toHaveLength(43)
    expect(parsed.authority!.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(parsePhase2C26B2B2AB2B1Authority(b2b1Json, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof b2b1Json) => void) => { const copy = structuredClone(b2b1Json); patch(copy); return parsePhase2C26B2B2AB2B1Authority(copy, registeredSha).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2B1_ALL_ELIGIBLE_RECOVERED' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.parity.issues = ['x'] })).toBe(false)
    expect(mutate(j => { j.parity.k1Contexts.matched -= 1 })).toBe(false)
    expect(mutate(j => { j.parity.reachability.verdictMatches -= 1 })).toBe(false)
    expect(mutate(j => { j.snapshotConsistency.valid = false })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.minimalCardinality['1'] = 27 })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.minimalCardinality['2'] = 10 })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.minimalCardinality.unreached = 2 })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.recoveredWithinDefaultExtent = 17 })).toBe(false)
    expect(mutate(j => { j.aggregates.contextGap.recoveredRequiresLargerExtent = 20 })).toBe(false)
    expect(mutate(j => { j.aggregates.all.recoveredWithinDefaultExtent = 21 })).toBe(false)
    expect(mutate(j => { j.conditions.extent.maxGogmaAdvance = 236 })).toBe(false)
    expect(mutate(j => { j.provenance.oracleSha256RecordedByB2A = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.oracleManifestSha256RecordedByOracle = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.routes.pop() })).toBe(false)
    expect(parsePhase2C26B2B2AB2B1Authority(null, registeredSha).valid).toBe(false)
  })

  it('selects exactly the registered 20 (2 historically covered + 18 newly recovered, all K1) and fails closed on any drift', () => {
    const authority = parsePhase2C26B2B2AB2B1Authority(b2b1Json, registeredSha).authority!
    const selection = selectPhase2C26B2B2ATasks(authority)
    expect(selection.issues).toEqual([])
    expect(selection.selections).toHaveLength(20)
    expect(selection.selections.filter(s => s.population === 'historically_covered_control')).toHaveLength(2)
    expect(selection.selections.filter(s => s.population === 'newly_recovered_default_extent')).toHaveLength(18)
    expect(selection.selections.every(s => s.representative.cardinality === 1)).toBe(true)
    expect(selection.selections.map(s => s.targetWeaponId)).toEqual([...selection.selections.map(s => s.targetWeaponId)].sort())
    // Unreached, extent-insufficient and K0 Routes are never selected.
    const byId = new Map(authority.routes.map(r => [r.targetWeaponId, r]))
    for (const s of selection.selections) {
      const route = byId.get(s.targetWeaponId)!
      expect(route.withinDefaultExtent).toBe(true)
      expect(route.minimalCardinality).toBe('1')
      expect(s.representative).toEqual(route.representative)
    }
    const drift = (patch: (a: Phase2C26B2B2AAuthority) => void) => { const copy = structuredClone(authority); patch(copy); return selectPhase2C26B2B2ATasks(copy) }
    // A K2 representative inside the default extent is an authority drift (the K1-only fixture condition).
    const k1 = drift(a => { const r = a.routes.find(x => x.minimalCardinality === '1' && x.withinDefaultExtent)!; r.minimalCardinality = '2'; r.representative!.cardinality = 2 })
    expect(k1.valid).toBe(false)
    expect(k1.issues.join()).toMatch(/K1-only/)
    expect(drift(a => { a.routes.find(x => x.minimalCardinality === '1' && x.withinDefaultExtent)!.withinDefaultExtent = false }).valid).toBe(false)
    expect(drift(a => { a.routes.find(x => x.minimalCardinality === '1' && !x.withinDefaultExtent)!.withinDefaultExtent = true }).valid).toBe(false)
    expect(drift(a => { const r = a.routes.find(x => x.b2a.covered)!; r.b2a.covered = false; r.b2a.contextGap = true }).valid).toBe(false)
    expect(drift(a => { a.routes.find(x => x.minimalCardinality === '1' && x.withinDefaultExtent)!.representative = null }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- a synthetic world (the Phase 2-C2.5-A contention)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2b2a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2b2a.b', { priority: 1 })
  return orchestrationScenario({
    engine: { gogmaPositions: defaultPlannerAlternativeSearchExtent.maxGogmaAdvance + 8, skillPositions: defaultPlannerAlternativeSearchExtent.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2b2a.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2b2a.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

function world() {
  const built = scenario()
  const snapshot = derivePhase2C26B2B1Snapshot(built.input, globalResearchDependencies(built.engine))
  return { built, snapshot }
}

/** Some eligible K-cardinality context of the given Target in the snapshot (the first in fixed-set order). */
function selectorFor(snapshot: Phase2C26B2B1Snapshot, targetWeaponId: string, cardinality: number) {
  const target = snapshot.targets.find(t => t.targetWeaponId === targetWeaponId)!
  const row = snapshot.fixedSets.find(fs => fs.valid && fs.cardinality === cardinality && !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))!
  return { targetWeaponId, fixedSetId: row.fixedSetId, cardinality, reservationDigest: snapshot.reservationGroups[row.reservationGroupIndex!]!.reservationDigest }
}

function authorityFor(snapshot: Phase2C26B2B1Snapshot, context: Phase2C26B2B2AContext): Pick<Phase2C26B2B2AAuthority, 'targets' | 'groups' | 'originDigest' | 'extent'> {
  return {
    targets: snapshot.targets.map(t => ({ targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, currentRouteKeySha256: digest(t.currentRouteKey),
      checkpointHardConstraint: t.checkpointHardConstraint, originSemanticDigest: t.originSemanticDigest })),
    groups: snapshot.reservationGroups.map(g => ({ groupIndex: g.groupIndex, reservationDigest: g.reservationDigest, minCardinality: g.minCardinality, aliasFixedSetIds: g.aliasFixedSetIds,
      reservation: phase2c26b2aReservationRanges(g.reservation) })),
    originDigest: snapshot.originDigest, extent: { ...context.extent },
  }
}

const selectionOf = (context: Phase2C26B2B2AContext): Phase2C26B2B2ASelection => ({ targetWeaponId: context.targetWeaponId, population: 'newly_recovered_default_extent',
  representative: { groupIndex: context.groupIndex, reservationDigest: context.reservationDigest, fixedSetId: context.fixedSetId, fixedTargetWeaponIds: context.fixedTargetWeaponIds, cardinality: 1 } })

// ---------------------------------------------------------------- representative reconstruction

describe('Phase 2-C2.6-B2-B2A representative reconstruction', () => {
  it('rebuilds the context from the snapshot alone: Production reservation, Planner-start origin, the current Route as the only exclusion, default extent', () => {
    const { built, snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
    const context = rebuilt.context
    const target = snapshot.targets.find(t => t.targetWeaponId === 'target.b2b2a.b')!
    const fixed = snapshot.fixedSets.find(fs => fs.fixedSetId === context.fixedSetId)!
    // The Target's own Entry is never fixed; the reservation is the snapshot group's (derivePlannerAlternativeReservation()).
    expect(context.fixedBuildListEntryIds).not.toContain(target.currentBuildListEntryId)
    expect(context.reservation).toBe(snapshot.reservationGroups[fixed.reservationGroupIndex!]!.reservation)
    expect(context.reservationDigest).toBe(hashStableValue(context.reservation))
    expect(context.excludedRouteKeys).toEqual([candidateStableKey(built.input.buildListEntries.find(e => e.id === target.currentBuildListEntryId)!.candidateSnapshot)])
    expect(context.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(context.originDigest).toBe(hashStableValue(createPlannerStartSearchOrigin(built.input)))
    expect(comparePhase2C26B2B2AReconstruction(context, selectionOf(context), authorityFor(snapshot, context), digest)).toEqual({ targetWeaponId: 'target.b2b2a.b', matches: true, mismatches: [] })
  })

  it('fails closed on a fixed set holding the Target\'s own Entry, a digest drift, a cardinality drift and an unknown Target / set', () => {
    const { snapshot } = world()
    const own = snapshot.targets.find(t => t.targetWeaponId === 'target.b2b2a.b')!
    const ownSet = snapshot.fixedSets.find(fs => fs.fixedSetId === `K1:${own.currentBuildListEntryId}`)!
    const ownSelector = { targetWeaponId: own.targetWeaponId, fixedSetId: ownSet.fixedSetId, cardinality: 1, reservationDigest: snapshot.reservationGroups[ownSet.reservationGroupIndex!]!.reservationDigest }
    const issuesOf = (selector: typeof ownSelector) => { const r = reconstructPhase2C26B2B2AContext(snapshot, selector); return r.valid ? [] : r.issues }
    expect(issuesOf(ownSelector)).toContain('fixed_set_holds_own_entry')
    const good = selectorFor(snapshot, 'target.b2b2a.b', 1)
    expect(issuesOf({ ...good, reservationDigest: 'other' })).toContain('reservation_digest')
    expect(issuesOf({ ...good, cardinality: 2 })).toContain('cardinality')
    expect(issuesOf({ ...good, targetWeaponId: 'target.none' })).toEqual(['target_not_in_snapshot'])
    expect(issuesOf({ ...good, fixedSetId: 'K1:none' })).toEqual(['fixed_set_not_in_snapshot'])
  })

  it('compares the rebuilt context with every recorded B2-B1 field and names the drifting one', () => {
    const { snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error('no context')
    const context = rebuilt.context
    const authority = authorityFor(snapshot, context)
    const check = (patch: (a: typeof authority, s: Phase2C26B2B2ASelection) => void) => {
      const a = structuredClone(authority), s = structuredClone(selectionOf(context))
      patch(a, s)
      return comparePhase2C26B2B2AReconstruction(context, s, a, digest).mismatches
    }
    expect(check((_, s) => { s.representative.fixedSetId = 'K1:x' })).toContain('fixedSetId')
    expect(check((_, s) => { s.representative.reservationDigest = 'x' })).toContain('reservationDigest')
    expect(check((_, s) => { s.representative.cardinality = 2 })).toContain('cardinality')
    expect(check((a) => { (a.groups[context.groupIndex]!.reservation as { gogma: { held: unknown[] } }).gogma.held = [[0, 0]] })).toContain('reservation')
    expect(check((a) => { a.targets.find(t => t.targetWeaponId === context.targetWeaponId)!.currentRouteKeySha256 = 'x' })).toContain('currentRouteKey')
    expect(check((a) => { a.originDigest = 'x' })).toContain('originDigest')
    expect(check((a) => { a.extent = { ...a.extent, maxSkillAdvance: 5 } })).toContain('extent')
    const conditions = { extent: { ...defaultPlannerAlternativeSearchExtent }, originDigest: snapshot.originDigest, calculationContext: { v: 1 }, researchMaxPlanSteps: 7, snapshotChecks: snapshot.checks }
    const ok = { extent: { ...defaultPlannerAlternativeSearchExtent }, originDigest: snapshot.originDigest, calculationContext: { v: 1 }, researchMaxPlanSteps: 7 }
    expect(comparePhase2C26B2B2AConditions(conditions, ok).valid).toBe(true)
    expect(comparePhase2C26B2B2AConditions({ ...conditions, researchMaxPlanSteps: 8 }, ok).issues).toEqual(['researchMaxPlanStepsMatches'])
    expect(comparePhase2C26B2B2AConditions({ ...conditions, extent: { ...conditions.extent, maxNormalAdvance: 5 } }, ok).issues).toEqual(['extentIsDefault'])
  })
})

// ---------------------------------------------------------------- the Search child

describe('Phase 2-C2.6-B2-B2A Search', () => {
  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and default extent, and nothing else', async () => {
    const { built, snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error('no context')
    const record = await runPhase2C26B2B2ASearch(built.input, rebuilt.context, built.engine, PHASE2C26B2B2A_CAPTURE_BOUND, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2b2a.b', extent: { ...defaultPlannerAlternativeSearchExtent },
      reservation: rebuilt.context.reservation, excludedRouteKeys: rebuilt.context.excludedRouteKeys }])
    expect(record.candidates.length).toBeGreaterThan(0)
    expect(record.candidates.length).toBeLessThan(PHASE2C26B2B2A_CAPTURE_BOUND)
    // A small world ends by extent / exhaustion: every decision was "continue", so nothing stopped the Search early.
    expect(searchCalls.decisions.every(d => d === 'continue')).toBe(true)
    expect(record.status).not.toBe('consumer_stop')
    expect(record.candidates.map(c => c.deliveryIndex)).toEqual(record.candidates.map((_, i) => i))
    expect(record.candidates.every(c => c.reservationCheck.respects)).toBe(true)
    expect(record.candidates.some(c => rebuilt.context.excludedRouteKeys.includes(c.stableKey))).toBe(false)
  })

  it('delivers exactly what the unchanged Phase 2-C2 Search-context helper delivers for the same context (same summary and reservation contract)', async () => {
    const { built, snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error('no context')
    const context = rebuilt.context
    const ours = await runPhase2C26B2B2ASearch(built.input, context, built.engine, PHASE2C26B2B2A_CAPTURE_BOUND, { now: () => 0 })
    // A test-only label: runPhase2C2SearchContext() reads the orientation for its record labels alone.
    const orientation = { orientationId: 'test', conflictIndex: 0, conflictKey: 'test', kind: 'same_gogma_counter', participantBuildListEntryIds: [], participantTargetWeaponIds: [],
      fixedBuildListEntryId: context.fixedBuildListEntryIds[0], fixedTargetWeaponId: context.fixedTargetWeaponIds[0] } as unknown as Phase2C2Orientation
    const c2 = await runPhase2C2SearchContext({ input: built.input, origin: createPlannerStartSearchOrigin(built.input), orientation, targetWeaponId: context.targetWeaponId,
      extent: { ...context.extent }, extentLabel: 'default', reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys, fixedRouteBuildListEntryIds: context.fixedBuildListEntryIds,
      captureBound: PHASE2C26B2B2A_CAPTURE_BOUND }, built.engine, { now: () => 0 })
    expect(ours.candidates.map(c => ({ key: c.stableKey, summary: c.summary, check: c.reservationCheck })))
      .toEqual(c2.candidates.map(c => ({ key: c.stableKey, summary: c.summary, check: c.reservationCheck })))
    expect([ours.status, ours.summary]).toEqual([c2.status, c2.summary])
  })

  it('stops the Search at the capture bound 32 and at nothing else', async () => {
    const { built, snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error('no context')
    searchCalls.replay = 40
    const record = await runPhase2C26B2B2ASearch(built.input, rebuilt.context, built.engine, PHASE2C26B2B2A_CAPTURE_BOUND, { now: () => 0 })
    expect(searchCalls.decisions).toEqual([...Array(31).fill('continue'), 'stop'])
    expect([record.candidates.length, record.status, record.summary.stoppedByConsumer]).toEqual([32, 'consumer_stop', true])
    await expect(runPhase2C26B2B2ASearch(built.input, rebuilt.context, built.engine, 8)).rejects.toThrow(/capture bound/)
    await expect(runPhase2C26B2B2ASearch(built.input, { ...rebuilt.context, extent: { ...rebuilt.context.extent, maxGogmaAdvance: 300 } }, built.engine, 32)).rejects.toThrow(/default extent/)
  })

  it('re-derives the context in the child and reports a drift as a context mismatch without searching', async () => {
    const { built, snapshot } = world()
    const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, selectorFor(snapshot, 'target.b2b2a.b', 1))
    if (!rebuilt.valid) throw new Error('no context')
    const task = phase2c26b2b2aTaskInput('t00', 'stage1', rebuilt.context)
    expect(Object.keys(task).sort()).toEqual(['captureBound', 'cardinality', 'executionClass', 'fixedSetId', 'reservationDigest', 'searchInputDigest', 'targetWeaponId', 'taskId'])
    const ok = await runPhase2C26B2B2ATask(built.input, snapshot, task, built.engine, { now: () => 0 })
    expect(ok.status).toBe('searched')
    searchCalls.inputs = []
    const mismatch = await runPhase2C26B2B2ATask(built.input, snapshot, { ...task, searchInputDigest: 'other' }, built.engine)
    expect(mismatch).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    const unknown = await runPhase2C26B2B2ATask(built.input, snapshot, { ...task, fixedSetId: 'K1:none' }, built.engine)
    expect(unknown).toMatchObject({ status: 'context_mismatch', issues: ['fixed_set_not_in_snapshot'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure (never Candidate 0) and falls back on a timeout only', () => {
    expect(phase2c26b2b2aTaskOutcome('t', 'stage1', 'timeout', null)).toEqual({ taskId: 't', executionClass: 'stage1', process: 'timeout', record: null, searchStatus: null, delivered: null })
    expect(phase2c26b2b2aTaskOutcome('t', 'stage1', 'completed', null).process).toBe('process_failure')
    expect(phase2c26b2b2aNeedsFallback({ process: 'timeout' })).toBe(true)
    for (const process of ['completed', 'out_of_memory', 'process_failure'] as const) expect(phase2c26b2b2aNeedsFallback({ process })).toBe(false)
    expect(PHASE2C26B2B2A_STAGE1).toMatchObject({ childHeapMb: 8192, concurrency: 3, budgetMs: 600_000, retry: 'none' })
    expect(PHASE2C26B2B2A_FALLBACK).toMatchObject({ trigger: 'timeout', childHeapMb: 8192, concurrency: 1, budgetMs: 1_800_000, runs: 1 })
    expect(PHASE2C26B2B2A_CAPTURE_BOUND).toBe(32)
  })
})

// ---------------------------------------------------------------- analysis

const TARGET = 't1'
function summary(patch: Partial<Phase2C2CandidateSummary> = {}): Phase2C2CandidateSummary {
  return { targetWeaponId: TARGET, routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'w1', estimatedOperationCount: 1,
    estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, ownOperationCount: 1, operationTypes: { reset_bonuses: 1 }, normalCounterId: null, normalProductionTargetPosition: null,
    blindNormalCreation: false, conversionSkillPosition: null, normal: null,
    gogma: { first: 1, last: 1, operations: 1, positions: [[1, 1]], required: [1], crossesHeldPositions: false, startsAfterOrigin: false }, skill: null,
    gogmaTypeRuns: [[1, 1, 'reset_bonuses']], heldRoute: false, finalBonuses: [], restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null, ...patch }
}
/** The oracle Route the Phase 2-C2 contract tests use: owned w2, Gogma 11 and 13 (held 12). */
const ORACLE_ROUTE = { targetWeaponId: TARGET, sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null, conversionPosition: null, normal: { first: null, last: null, operations: 0 },
  gogma: { first: 11, last: 13, operations: 2, required: [13] }, skill: { first: null, last: null, operations: 0, required: [] }, routeOperationCount: 2,
  finalBonuses: [], finalScope: 'gogma_artian', finalSeriesSkillId: null, finalGroupSkillId: null,
  materialization: { method: 'planner_alternative_search', routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 1, normal: null, gogma: 1, skill: 0 } } }
const ORACLE_USAGE = [{ position: 11, targetWeaponId: TARGET, type: 'reset_bonuses', required: false }, { position: 13, targetWeaponId: TARGET, type: 'reset_bonuses', required: true }]
const MATCH = summary({ sourceOwnedWeaponId: 'w2', ownOperationCount: 2, gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true },
  gogmaTypeRuns: [[11, 11, 'reset_bonuses'], [13, 13, 'reset_bonuses']], heldRoute: true })
const ORACLE = { routes: [ORACLE_ROUTE], gogmaUsage: ORACLE_USAGE }

const TASK: Phase2C26B2B2ATaskInput = { taskId: 't00', executionClass: 'stage1', targetWeaponId: TARGET, fixedSetId: 'K1:e0', cardinality: 1, reservationDigest: 'r', searchInputDigest: 's', captureBound: 32 }
const SELECTION: Phase2C26B2B2ASelection = { targetWeaponId: TARGET, population: 'newly_recovered_default_extent',
  representative: { groupIndex: 0, reservationDigest: 'r', fixedSetId: 'K1:e0', fixedTargetWeaponIds: ['t0'], cardinality: 1 } }

function search(summaries: Phase2C2CandidateSummary[], status: Phase2C26B2B2ASearchRecord['status'], patch: Partial<Phase2C26B2B2ASearchRecord> = {}): Phase2C26B2B2ASearchRecord {
  return { targetWeaponId: TARGET, fixedSetId: 'K1:e0', fixedTargetWeaponIds: ['t0'], cardinality: 1, reservationDigest: 'r', searchInputDigest: 's', extent: { ...defaultPlannerAlternativeSearchExtent },
    excludedRouteKeys: ['current'], captureBound: 32, status,
    summary: { deliveredCandidates: summaries.length, excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    candidates: summaries.map((s, i) => ({ deliveryIndex: i, stableKey: `k${i}`, summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } })), elapsedMs: 1, ...patch }
}
function run(record: Phase2C26B2B2ASearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed', executionClass: 'stage1' | 'timeout_fallback' = 'stage1'): Phase2C26B2B2ARun {
  const child = record === null ? null : { status: 'searched' as const, taskId: TASK.taskId, executionClass, search: record }
  return { taskId: TASK.taskId, executionClass, task: { ...TASK, executionClass }, outcome: phase2c26b2b2aTaskOutcome(TASK.taskId, executionClass, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
const filler = (n: number) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${i}` }))
const analyze = (stage1: Phase2C26B2B2ARun[], fallback: Phase2C26B2B2ARun[] = []) =>
  runPhase2C26B2B2AAnalysis({ selections: [SELECTION], tasks: [TASK], stage1, fallback, oracle: ORACLE, smoke: false })

describe('Phase 2-C2.6-B2-B2A analysis', () => {
  it('classifies delivery by the unchanged Phase 2-C2 contract and splits a miss by how the Search ended', () => {
    const classify = (stage1: Phase2C26B2B2ARun, fallback: Phase2C26B2B2ARun[] = []) => phase2c26b2b2aCompare(phase2c26b2b2aFinalOutcomes([TASK], [stage1], fallback)[0]!, ORACLE)
    const exactAt9 = classify(run(search([...filler(9), MATCH, ...filler(22)], 'consumer_stop')))
    expect([exactAt9.deliveryClass, exactAt9.matchedDeliveryIndex, exactAt9.exactDeliveryIndexes]).toEqual(['exact', 9, [9]])
    expect(phase2c26b2b2aIndexBucket(9)).toBe('8-15')
    // Without the Gogma usage the positions are undetermined: partial, never exact.
    const partial = phase2c26b2b2aCompare(phase2c26b2b2aFinalOutcomes([TASK], [run(search([MATCH], 'exhausted'))], [])[0]!, { routes: [ORACLE_ROUTE], gogmaUsage: [] })
    expect([partial.deliveryClass, partial.matchedDeliveryIndex]).toEqual(['partial', 0])
    expect(classify(run(search(filler(32), 'consumer_stop'))).deliveryClass).toBe('capture_or_ordering_unresolved')
    expect(classify(run(search(filler(5), 'stopped_by_extent'))).deliveryClass).toBe('completed_without_oracle_match')
    expect(classify(run(search([], 'exhausted'))).deliveryClass).toBe('completed_without_oracle_match')
    expect(phase2c26b2b2aCompare(phase2c26b2b2aFinalOutcomes([TASK], [run(search([MATCH], 'exhausted'))], [])[0]!, { routes: [{ ...ORACLE_ROUTE, finalBonuses: undefined }], gogmaUsage: ORACLE_USAGE }).deliveryClass).toBe('not_comparable')
    expect(classify(run(null, 'timeout'), [run(null, 'timeout', 'timeout_fallback')]).deliveryClass).toBe('unmeasured')
    expect(classify(run(null, 'out_of_memory')).deliveryClass).toBe('unmeasured')
  })

  it('takes the fallback of a Stage 1 timeout as the formal outcome and keeps the Stage 1 evidence; a Stage 1 completion is final', () => {
    const [timedOut] = phase2c26b2b2aFinalOutcomes([TASK], [run(null, 'timeout')], [run(search([MATCH], 'exhausted'), 'completed', 'timeout_fallback')])
    expect([timedOut!.formalRun, timedOut!.measured, timedOut!.stage1.outcome.process]).toEqual(['timeout_fallback', true, 'timeout'])
    const [noFallback] = phase2c26b2b2aFinalOutcomes([TASK], [run(null, 'timeout')], [])
    expect([noFallback!.formalRun, noFallback!.measured]).toEqual(['timeout_fallback', false])
    const [completed] = phase2c26b2b2aFinalOutcomes([TASK], [run(search([], 'exhausted'))], [])
    expect([completed!.formalRun, completed!.measured]).toEqual(['stage1', true])
  })

  it('fails the raw record closed on a fallback outside the timeouts, a missing fallback, a stop / count disagreement or a repeated Candidate', () => {
    const check = (stage1: Phase2C26B2B2ARun[], fallback: Phase2C26B2B2ARun[] = []) => validatePhase2C26B2B2ARaw({ selections: [SELECTION], tasks: [TASK], stage1, fallback, smoke: false })
    expect(check([run(search([MATCH], 'exhausted'))])).toEqual([])
    expect(check([run(search([MATCH], 'exhausted'))], [run(search([MATCH], 'exhausted'), 'completed', 'timeout_fallback')]).join()).toMatch(/fallback/)
    expect(check([run(null, 'timeout')]).join()).toMatch(/fallback/)
    expect(check([run(null, 'out_of_memory')])).toEqual([])
    expect(check([run(search(filler(31), 'consumer_stop'))]).join()).toMatch(/stop status/)
    expect(check([run(search(filler(32), 'stopped_by_extent'))]).join()).toMatch(/stop status/)
    const twice = search([MATCH, MATCH], 'exhausted')
    twice.candidates[1]!.stableKey = 'k0'
    expect(check([run(twice)]).join()).toMatch(/twice/)
    expect(check([run(search([MATCH], 'exhausted', { excludedRouteKeys: ['k0'] }))]).join()).toMatch(/excluded Route was delivered/)
    expect(check([run(search([MATCH], 'exhausted', { captureBound: 8 }))]).join()).toMatch(/capture bound/)
    expect(check([run(search([MATCH], 'exhausted', { fixedSetId: 'K1:other' }))]).join()).toMatch(/task's context/)
  })

  it('makes a reservation-violating delivery a semantic failure (B2B2A_INVALID), and a context mismatch too', () => {
    const violating = search([MATCH], 'exhausted')
    violating.candidates[0]!.reservationCheck = { respects: false, blockedHits: { gogma: [11] }, exclusiveHit: [] }
    const result = analyze([run(violating)])
    expect(result.invalidReasons.join()).toMatch(/semantic_failure/)
    expect(phase2c26b2b2aDecision({ invalidReasons: result.invalidReasons, tasks: 20, measured: 20, exact: 20 }).case).toBe('B2B2A_INVALID')
    const mismatch = run(null)
    mismatch.outcome = { ...mismatch.outcome, process: 'completed', record: 'context_mismatch' }
    mismatch.record = { status: 'context_mismatch', taskId: TASK.taskId, executionClass: 'stage1', issues: ['reservationDigest'] }
    expect(analyze([mismatch]).invalidReasons.join()).toMatch(/context mismatch/)
  })

  it('aggregates delivery indexes in the registered buckets, populations, terminations and runtime', () => {
    const result = analyze([run(search([...filler(9), MATCH, ...filler(22)], 'consumer_stop'))])
    expect(result.invalidReasons).toEqual([])
    expect(result.aggregates.all).toMatchObject({ targets: 1, measured: 1, exact: 1, exactBeyondCapture8: 1, exactDeliveryIndex: { '0': 0, '1': 0, '2-3': 0, '4-7': 0, '8-15': 1, '16-31': 0 } })
    expect(result.aggregates.all.byCardinality.K1.exact).toBe(1)
    expect(result.aggregates.newlyRecoveredDefaultExtent.exact).toBe(1)
    expect(result.aggregates.historicallyCoveredControl.targets).toBe(0)
    expect(result.aggregates.diversity).toMatchObject({ totalDelivered: 32, termination: { consumer_stop: 1, stopped_by_extent: 0, exhausted: 0 }, heldRoute: 1, reservationViolations: 0 })
    expect(result.aggregates.execution).toMatchObject({ stage1: { runs: 1, completed: 1, timeout: 0 }, fallback: { attempted: 0 }, final: { measured: 1, unmeasured: 0 }, peakRssBytesMax: 1024, peakHeapBytesMax: 100 })
    expect(result.decisionInput).toEqual({ tasks: 1, measured: 1, exact: 1 })
    expect(['0', '1', '2', '3', '4', '7', '8', '15', '16', '31'].map(i => phase2c26b2b2aIndexBucket(Number(i)))).toEqual(['0', '1', '2-3', '2-3', '4-7', '4-7', '8-15', '8-15', '16-31', '16-31'])
    expect(() => phase2c26b2b2aIndexBucket(32)).toThrow()
    expect(phase2c26b2b2aPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })

  it('decides ALL_EXACT / PARTIAL_DELIVERY / NO_EXACT / INCOMPLETE / INVALID by the registered rule', () => {
    expect(phase2c26b2b2aDecision({ invalidReasons: [], tasks: 20, measured: 20, exact: 20 }).case).toBe('B2B2A_ALL_EXACT')
    expect(phase2c26b2b2aDecision({ invalidReasons: [], tasks: 20, measured: 20, exact: 7 }).case).toBe('B2B2A_PARTIAL_DELIVERY')
    expect(phase2c26b2b2aDecision({ invalidReasons: [], tasks: 20, measured: 20, exact: 0 }).case).toBe('B2B2A_NO_EXACT')
    expect(phase2c26b2b2aDecision({ invalidReasons: [], tasks: 20, measured: 19, exact: 19 }).case).toBe('B2B2A_INCOMPLETE')
    expect(phase2c26b2b2aDecision({ invalidReasons: ['x'], tasks: 20, measured: 19, exact: 0 }).case).toBe('B2B2A_INVALID')
    expect(phase2c26b2b2aDecision({ invalidReasons: [], tasks: 19, measured: 19, exact: 19 })).toMatchObject({ case: 'B2B2A_INVALID', reasons: ['task_count_19'] })
    expect(() => phase2c26b2b2aDecision({ invalidReasons: [], tasks: 20, measured: 10, exact: 11 })).toThrow()
    expect(PHASE2C26B2B2A_DECISION_RULE.exact).toMatch(/partial_comparable is recorded separately/)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-B2A isolation', () => {
  it('is never imported by Production and fixes no Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2B2A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [calculationSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    for (const source of [calculationSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle and its manifest out of the Search side: only the analyzer reads them, after the run', () => {
    for (const source of [calculationSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657_|--oracle|--manifest|--b2a-result|gogmaUsage|plannerGlobal[O]racle|phase2c2OracleCoverage|plannerGlobalPhase2C2Analysis|parsePhase2C26B2AOracle|B2B2AAnalysis/)
    }
    expect(runnerSource).toMatch(/oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false/)
    expect(analysisSource).toMatch(/phase2c2OracleCoverage\(/)
  })

  it('searches through the unchanged Production Search and the existing Research summary helpers, with one consumer stop rule', () => {
    expect(calculationSource).toMatch(/visitPlannerAlternativeCandidates\(/)
    expect(calculationSource).toMatch(/createPlannerAlternativeMaterializer\(/)
    expect(calculationSource).toMatch(/summarizePhase2C2Entry\(/)
    expect(calculationSource).toMatch(/respectsPhase2C2Reservation\(/)
    expect(calculationSource).toMatch(/candidateStableKey\(/)
    expect((calculationSource.match(/'stop'/g) ?? []).length).toBe(1)
    expect(calculationSource).toMatch(/return candidates\.length >= captureBound \? 'stop' : 'continue'/)
    for (const source of [calculationSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2B2ASearch|runPhase2C26B2B2ATask\(/)
  })
})
