import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawA10 from '../../docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json?raw'
import { hashStableValue } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeReservation } from '../domain/search'
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
import {
  PHASE2C2_PORTFOLIO_CAPTURE_BOUND,
  phase2c2ProductionDefaultConditions,
  runPhase2C2Baseline,
  runPhase2C2Kernel,
  type Phase2C2CandidateSummary,
  type Phase2C2Orientation,
  type Phase2C2SearchContextRecord,
} from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts, type Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import {
  buildPhase2C26B1Portfolio,
  comparePhase2C26B1ContextsWithA10,
  derivePhase2C26B1Contexts,
  expandPhase2C26B1Aliases,
  parsePhase2C26B1A10Authority,
  phase2c26b1Completed,
  phase2c26b1ParticipantCoverage,
  phase2c26b1SearchInputDigest,
  phase2c26b1TaskInput,
  phase2c26b1TaskOutcome,
  planPhase2C26B1SearchTasks,
  runPhase2C26B1SearchTask,
  selectPhase2C26B1Fallback,
  validatePhase2C26B1BaselineParity,
  validatePhase2C26B1ConditionParity,
  withPhase2C26B1SearchInputDigest,
  PHASE2C26B1_CAPTURE_BOUND,
  PHASE2C26B1_FALLBACK,
  PHASE2C26B1_STAGE1,
  type Phase2C26B1A10Authority,
  type Phase2C26B1A10KernelTarget,
  type Phase2C26B1Context,
  type Phase2C26B1SearchChildRecord,
  type Phase2C26B1TaskOutcome,
} from './plannerGlobalPhase2C26B1'
import b1Source from './plannerGlobalPhase2C26B1.ts?raw'
import {
  comparePhase2C26B1KernelPrefix,
  phase2c26b1Decision,
  phase2c26b1ExecutionSummary,
  phase2c26b1KernelMetadata,
  phase2c26b1KernelPrefixParity,
  phase2c26b1PortfolioObservation,
  phase2c26b1PortfolioSummary,
  phase2c26b1SemanticFailures,
  validatePhase2C26B1FormalRun,
  PHASE2C26B1_DECISION_RULE,
} from './plannerGlobalPhase2C26B1Analysis'
import analysisSource from './plannerGlobalPhase2C26B1Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b1.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b1.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B1. The default-extent Candidate portfolio from every orientation's pre-Search context, without
 * kernel completion. The committed A10 RESULT is the parity authority.
 */

/** Every input the Planner Alternative Search received, in call order. */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>) => {
      searchCalls.inputs.push(structuredClone(args[0]))
      return actual.visitPlannerAlternativeCandidates(...args)
    },
  }
})
beforeEach(() => { searchCalls.inputs = [] })

/** Any injective digest works for the parity helpers (the analyzer passes SHA-256). */
const digest = (value: string) => hashStableValue(value)
const a10Json = JSON.parse(rawA10)

// ---------------------------------------------------------------- the synthetic contention (the Phase 2-C2.5-A fixture)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.b1.a'
const ENTRY_B = 'build-list.b1.b'

function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b1.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b1.b', { priority: 1 })
  // The Fake Engine covers the whole default extent: B1 keeps searching past the kernel's first Candidate, up to 8.
  return orchestrationScenario({
    engine: { gogmaPositions: defaultPlannerAlternativeSearchExtent.maxGogmaAdvance + 8, skillPositions: defaultPlannerAlternativeSearchExtent.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

async function synthetic() {
  const built = scenario()
  const baseline = await runPhase2C2Baseline(built.input, { createEngine: () => built.engine, now: () => 0 })
  return { built, baseline }
}

// ---------------------------------------------------------------- fake helpers

const RESERVATION = { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [10], blocked: [10] }, exclusiveOwnedWeaponIds: [] } as unknown as PlannerAlternativeReservation

function fakeContext(patch: Partial<Phase2C25APreSearchContext> = {}): Phase2C26B1Context {
  return withPhase2C26B1SearchInputDigest({
    orientationId: 'o0', workIndex: 0, targetWeaponId: 't1', status: 'searchable', invalidatedBuildListEntryId: 'e1', invalidatedRouteKey: 'k1',
    fixedRouteBuildListEntryIds: ['e0'], reservation: RESERVATION, searchReservation: RESERVATION, excludedRouteKeys: ['k1'], extent: { ...defaultPlannerAlternativeSearchExtent },
    originDigest: 'origin', contextDigest: `cd-${patch.orientationId ?? 'o0'}-${patch.workIndex ?? 0}`, ...patch,
  })
}

function fakeOrientation(orientationId: string, participants: string[], fixed = 0): Phase2C2Orientation {
  return { orientationId, conflictIndex: 0, conflictKey: `key-${orientationId}`, kind: 'same_gogma_counter', participantBuildListEntryIds: participants.map(p => `e-${p}`),
    participantTargetWeaponIds: participants, fixedBuildListEntryId: `e-${participants[fixed]}`, fixedTargetWeaponId: participants[fixed] }
}

function summary(targetWeaponId: string, patch: Partial<Phase2C2CandidateSummary> = {}): Phase2C2CandidateSummary {
  return { targetWeaponId, routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'w1', estimatedOperationCount: 1,
    estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, ownOperationCount: 1, operationTypes: { reset_bonuses: 1 }, normalCounterId: null, normalProductionTargetPosition: null,
    blindNormalCreation: false, conversionSkillPosition: null, normal: null,
    gogma: { first: 1, last: 1, operations: 1, positions: [[1, 1]], required: [1], crossesHeldPositions: false, startsAfterOrigin: false }, skill: null,
    gogmaTypeRuns: [[1, 1, 'reset_bonuses']], heldRoute: false, finalBonuses: [], restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null, ...patch }
}

function searchRecord(targetWeaponId: string, keys: string[], patch: Partial<Phase2C2SearchContextRecord> = {}, summaries: Record<string, Phase2C2CandidateSummary> = {}): Phase2C2SearchContextRecord {
  return {
    contextId: `x:${targetWeaponId}:default`, orientationId: 'x', conflictKey: 'k', kind: 'same_gogma_counter', fixedTargetWeaponId: 'f', targetWeaponId,
    extent: { ...defaultPlannerAlternativeSearchExtent }, extentLabel: 'default', reservation: RESERVATION, excludedRouteKeys: [], fixedRouteBuildListEntryIds: [],
    status: keys.length >= PHASE2C26B1_CAPTURE_BOUND ? 'consumer_stop' : 'stopped_by_extent',
    summary: { deliveredCandidates: keys.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: keys.length < PHASE2C26B1_CAPTURE_BOUND, stoppedByConsumer: keys.length >= PHASE2C26B1_CAPTURE_BOUND },
    candidates: keys.map((key, index) => ({ deliveredIndex: index, stableKey: key, summary: summaries[key] ?? summary(targetWeaponId, { estimatedOperationCount: index + 2 }),
      reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] }, kernel: { status: 'search_delivered' as const } })),
    kernelTrialPrefixMatches: null, elapsedMs: 1, ...patch,
  }
}

const completedOutcome = (taskId: string, status: 'consumer_stop' | 'stopped_by_extent' | 'exhausted' = 'stopped_by_extent', delivered = 0, executionClass: 'stage1' | 'coverage_fallback' = 'stage1'): Phase2C26B1TaskOutcome =>
  ({ taskId, executionClass, process: 'completed', record: 'searched', searchStatus: status, delivered })
const failedOutcome = (taskId: string, process: 'timeout' | 'out_of_memory' | 'process_failure', executionClass: 'stage1' | 'coverage_fallback' = 'stage1'): Phase2C26B1TaskOutcome =>
  ({ taskId, executionClass, process, record: null, searchStatus: null, delivered: null })

// ---------------------------------------------------------------- A10 authority

describe('Phase 2-C2.6-B1 A10 authority', () => {
  const a10 = (): typeof a10Json => structuredClone(a10Json)

  it('reads the committed A10 RESULT as the registered formal R1 authority, deriving every count from its rows', () => {
    const parsed = parsePhase2C26B1A10Authority(a10())
    expect(parsed.issues).toEqual([])
    const authority = parsed.authority!
    expect(authority.orientations).toHaveLength(authority.rows.length)
    expect(authority.rows.map(r => r.orientationId)).toEqual(authority.orientations.map(o => o.orientationId))
    expect(authority.childStatus).toEqual(a10().kernel.childStatus)
    for (const row of authority.rows) expect(row.kernelCompleted).toBe(row.childOutcome === 'completed')
    expect(authority.rows.filter(r => r.kernelCompleted).every(r => r.targets.length > 0)).toBe(true)
    expect(authority.conditions.extent).toEqual(defaultPlannerAlternativeSearchExtent)
  })

  it('fails closed on a non-formal, a non-R1, a resized or an inconsistent RESULT', () => {
    const broken = (mutate: (json: typeof a10Json) => void) => { const json = a10(); mutate(json); return parsePhase2C26B1A10Authority(json) }
    expect(broken(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(broken(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] }).valid).toBe(false)
    expect(broken(j => { j.decision.case = 'R0_all_completed' }).valid).toBe(false)
    expect(broken(j => { j.conclusion.case = 'R2_unchanged_timeout_count' }).valid).toBe(false)
    expect(broken(j => { j.kernel.orientations -= 1 }).valid).toBe(false)
    expect(broken(j => { j.perOrientation.pop() }).valid).toBe(false)
    expect(broken(j => { j.perOrientation.push(j.perOrientation[0]) }).valid).toBe(false)
    expect(broken(j => { j.kernel.childStatus.timeout += 1 }).valid).toBe(false)
    expect(broken(j => { j.perOrientation[0].fixedTargetWeaponId = 'other' }).valid).toBe(false)
    expect(broken(j => { j.perOrientation.find((r: { child: { outcome: string } }) => r.child.outcome === 'completed').kernel.targets[0].trials = [{ result: 'found' }] }).valid).toBe(false)
    expect(broken(j => { j.formalRunValidation.valid = false }).valid).toBe(false)
    expect(broken(j => { delete j.provenance.a9ResultSha256 }).valid).toBe(false)
    expect(parsePhase2C26B1A10Authority(null).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- baseline / orientation / condition parity

describe('Phase 2-C2.6-B1 parity gates', () => {
  const authority = () => parsePhase2C26B1A10Authority(JSON.parse(rawA10)).authority as Phase2C26B1A10Authority

  it('accepts exactly the authority baseline and orientations, and fails closed on any listed field', () => {
    const a = authority()
    const current = { exportSha256: a.exportSha256, summary: structuredClone(a.baseline), orientations: structuredClone(a.orientations) }
    expect(validatePhase2C26B1BaselineParity(current, a).valid).toBe(true)
    const fail = (mutate: (c: typeof current) => void) => { const c = structuredClone(current); mutate(c); return validatePhase2C26B1BaselineParity(c, a) }
    expect(fail(c => { c.exportSha256 = '0'.repeat(64) })).toMatchObject({ valid: false, exportSha256Matches: false })
    for (const field of ['planningTargetCount', 'completedTargetCount', 'planSteps', 'conflicts'] as const) {
      expect(fail(c => { (c.summary[field] as number) += 1 }).valid).toBe(false)
    }
    expect(fail(c => { c.summary.termination = 'completed' }).valid).toBe(false)
    expect(fail(c => { c.summary.conflictsByKind = { ...c.summary.conflictsByKind, same_skill_counter: 99 } }).valid).toBe(false)
    expect(fail(c => { c.summary.selectedTargets = c.summary.selectedTargets.slice(1) }).valid).toBe(false)
    expect(fail(c => { c.orientations.reverse() }).orderedOrientationIdsMatch).toBe(false)
    expect(fail(c => { c.orientations.pop() }).valid).toBe(false)
    for (const field of ['conflictIndex', 'conflictKey', 'kind', 'participantBuildListEntryIds', 'participantTargetWeaponIds', 'fixedBuildListEntryId', 'fixedTargetWeaponId'] as const) {
      const result = fail(c => { (c.orientations[1] as unknown as Record<string, unknown>)[field] = 'changed' })
      expect(result.valid).toBe(false)
      expect(result.orientationMismatches[0].fields).toContain(field)
    }
  })

  it('requires the A10 extent (the Production default), CalculationContext and Research maxPlanSteps', () => {
    const a = authority()
    const ok = { extent: { ...defaultPlannerAlternativeSearchExtent }, calculationContext: a.conditions.calculationContext, researchMaxPlanSteps: a.conditions.researchMaxPlanSteps }
    expect(validatePhase2C26B1ConditionParity(ok, a).valid).toBe(true)
    expect(validatePhase2C26B1ConditionParity({ ...ok, extent: { ...ok.extent, maxGogmaAdvance: 236 } }, a).valid).toBe(false)
    expect(validatePhase2C26B1ConditionParity({ ...ok, researchMaxPlanSteps: 1 }, a).valid).toBe(false)
    expect(validatePhase2C26B1ConditionParity({ ...ok, calculationContext: {} }, a).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- pre-Search contexts and dedup

describe('Phase 2-C2.6-B1 pre-Search contexts', () => {
  it('derives every orientation\'s contexts through the unchanged Phase 2-C2.5-A authority and adds only the provenance-free digest', async () => {
    const { built, baseline } = await synthetic()
    expect(baseline.orientations).toHaveLength(2)
    const contexts = derivePhase2C26B1Contexts(built.input, baseline.orientations, () => globalResearchDependencies(built.engine))
    const expected = baseline.orientations.flatMap(o => derivePhase2C25APreSearchContexts(built.input, o, globalResearchDependencies(built.engine)).contexts)
    expect(contexts.map(({ searchInputDigest, ...rest }) => { expect(searchInputDigest).toBe(phase2c26b1SearchInputDigest(rest)); return rest })).toEqual(expected)
    expect(contexts.every(c => c.extent.maxGogmaAdvance === defaultPlannerAlternativeSearchExtent.maxGogmaAdvance)).toBe(true)
    // The digest ignores provenance only.
    const [first] = contexts
    expect(phase2c26b1SearchInputDigest({ ...first, orientationId: 'other', workIndex: 7, contextDigest: 'x' })).toBe(first.searchInputDigest)
    for (const patch of [{ targetWeaponId: 'x' }, { excludedRouteKeys: ['x'] }, { fixedRouteBuildListEntryIds: [] }, { originDigest: 'x' }, { reservation: null }, { status: 'blocked_by_selected_checkpoint' as const }]) {
      expect(phase2c26b1SearchInputDigest({ ...first, ...patch })).not.toBe(first.searchInputDigest)
    }
  })

  it('dedups only semantically identical contexts, keeping every orientation / work alias', () => {
    const a = fakeContext({ orientationId: 'o0', workIndex: 0 })
    const sameOtherOrientation = fakeContext({ orientationId: 'o1', workIndex: 2 })
    const otherTarget = fakeContext({ orientationId: 'o1', workIndex: 0, targetWeaponId: 't2' })
    const otherReservation = fakeContext({ orientationId: 'o2', workIndex: 0, reservation: { ...RESERVATION, gogma: { held: [11], blocked: [11] } } as never,
      searchReservation: { ...RESERVATION, gogma: { held: [11], blocked: [11] } } as never })
    const otherExclusion = fakeContext({ orientationId: 'o3', workIndex: 0, excludedRouteKeys: ['k2'] })
    const blocked = fakeContext({ orientationId: 'o4', workIndex: 0, status: 'blocked_by_selected_checkpoint', reservation: null, searchReservation: null })
    const plan = planPhase2C26B1SearchTasks([a, sameOtherOrientation, otherTarget, otherReservation, otherExclusion, blocked])
    expect(plan).toMatchObject({ derived: 6, searchable: 5, uniqueSearchInputs: 4, dedupSavedRuns: 1, blocked: [{ orientationId: 'o4', workIndex: 0, targetWeaponId: 't1' }] })
    expect(plan.tasks[0].aliases).toEqual([{ orientationId: 'o0', workIndex: 0, contextDigest: a.contextDigest }, { orientationId: 'o1', workIndex: 2, contextDigest: sameOtherOrientation.contextDigest }])
    expect(plan.tasks[0].representative).toEqual(plan.tasks[0].aliases[0])
    expect(plan.tasks.map(t => t.targetWeaponId)).toEqual(['t1', 't2', 't1', 't1'])
    expect(plan.tasks.flatMap(t => t.aliases).some(alias => alias.orientationId === 'o4')).toBe(false)
    expect(() => planPhase2C26B1SearchTasks([{ ...a, searchInputDigest: 'forged' }])).toThrow(/body digest/)
  })

  it('keeps the provenance of every alias when a task is expanded into the portfolio', () => {
    const plan = planPhase2C26B1SearchTasks([fakeContext({ orientationId: 'o0' }), fakeContext({ orientationId: 'o1', workIndex: 1 })])
    const orientations = [fakeOrientation('o0', ['f', 't1']), fakeOrientation('o1', ['g', 't1'])]
    const { contexts, classByContextId } = expandPhase2C26B1Aliases([{ task: plan.tasks[0], executionClass: 'stage1', context: searchRecord('t1', ['a', 'b']) }], orientations)
    expect(contexts.map(c => [c.contextId, c.orientationId, c.conflictKey, c.fixedTargetWeaponId])).toEqual([['o0:t1:default', 'o0', 'key-o0', 'f'], ['o1:t1:default', 'o1', 'key-o1', 'g']])
    expect([...classByContextId.values()]).toEqual([{ executionClass: 'stage1', taskId: plan.tasks[0].taskId }, { executionClass: 'stage1', taskId: plan.tasks[0].taskId }])
  })
})

// ---------------------------------------------------------------- Search tasks

describe('Phase 2-C2.6-B1 Search tasks', () => {
  it('hands the Search exactly the kernel\'s input, captures at most 8 and matches the kernel trial prefix', async () => {
    const { built, baseline } = await synthetic()
    const contexts = derivePhase2C26B1Contexts(built.input, baseline.orientations, () => globalResearchDependencies(built.engine))
    const plan = planPhase2C26B1SearchTasks(contexts)
    const delivered: number[] = []
    for (const task of plan.tasks) {
      const input = phase2c26b1TaskInput(task, baseline.orientations, 'stage1')
      expect(input.captureBound).toBe(PHASE2C2_PORTFOLIO_CAPTURE_BOUND)
      const orientation = baseline.orientations.find(o => o.orientationId === task.representative.orientationId)!
      searchCalls.inputs = []
      const kernel = await runPhase2C2Kernel(built.input, orientation, phase2c2ProductionDefaultConditions(), { createEngine: () => built.engine, now: () => 0 })
      if (kernel.kernel.status !== 'completed') throw new Error(kernel.kernel.status)
      const kernelSearch = searchCalls.inputs[0]
      const prepared = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
      searchCalls.inputs = []
      const record = await runPhase2C26B1SearchTask(built.input, prepared, input, built.engine, { now: () => 0 })
      expect(searchCalls.inputs).toEqual([kernelSearch])
      if (record.status !== 'searched') throw new Error(record.status)
      expect(record.context.candidates.length).toBeLessThanOrEqual(PHASE2C26B1_CAPTURE_BOUND)
      expect(record.context.candidates.every(c => c.kernel.status === 'search_delivered')).toBe(true)
      expect(record.context.kernelTrialPrefixMatches).toBeNull()
      const [target] = kernel.kernel.targets
      const kernelTarget: Phase2C26B1A10KernelTarget = { targetWeaponId: target.targetWeaponId, outcome: target.outcome, searched: target.search !== null, search: target.search,
        trials: target.trials.map(t => ({ candidateKeySha256: digest(t.candidateKey), result: t.result, reason: t.reason, generatedSelected: t.generatedSelected })),
        foundKeySha256: target.found ? digest(target.found.stableKey) : null }
      const view = { status: record.context.status, summary: record.context.summary, keySha256s: record.context.candidates.map(c => digest(c.stableKey)) }
      expect(comparePhase2C26B1KernelPrefix(kernelTarget, view, PHASE2C26B1_CAPTURE_BOUND).result).toBe('match')
      delivered.push(record.context.summary.deliveredCandidates)
    }
    // B1 keeps searching past the kernel's first trialled Candidate.
    expect(Math.max(...delivered)).toBeGreaterThan(1)
  })

  it('refuses a wrong capture bound, reports a re-derived context mismatch, and never searches a blocked context', async () => {
    const { built, baseline } = await synthetic()
    const contexts = derivePhase2C26B1Contexts(built.input, baseline.orientations, () => globalResearchDependencies(built.engine))
    const [task] = planPhase2C26B1SearchTasks(contexts).tasks
    const input = phase2c26b1TaskInput(task, baseline.orientations, 'stage1')
    const prepared = derivePhase2C25APreSearchContexts(built.input, input.orientation, globalResearchDependencies(built.engine))
    await expect(runPhase2C26B1SearchTask(built.input, prepared, { ...input, captureBound: 9 }, built.engine)).rejects.toThrow(/capture bound/)
    searchCalls.inputs = []
    const mismatch = await runPhase2C26B1SearchTask(built.input, prepared, { ...input, searchInputDigest: 'other' }, built.engine)
    expect(mismatch.status).toBe('context_mismatch')
    expect(searchCalls.inputs).toEqual([])
    const blockedPrepared = { ...prepared, contexts: prepared.contexts.map(c => ({ ...c, status: 'blocked_by_selected_checkpoint' as const })) }
    const blockedContext = withPhase2C26B1SearchInputDigest(blockedPrepared.contexts[input.workIndex])
    await expect(runPhase2C26B1SearchTask(built.input, blockedPrepared, { ...input, searchInputDigest: blockedContext.searchInputDigest }, built.engine)).rejects.toThrow(/does not search/)
    expect(searchCalls.inputs).toEqual([])
  })
})

// ---------------------------------------------------------------- outcomes, coverage and fallback

describe('Phase 2-C2.6-B1 outcomes and participant coverage', () => {
  it('never turns a timeout, an OOM or a failure into Candidate 0, and counts a normal Candidate 0 end as completed', () => {
    for (const process of ['timeout', 'out_of_memory', 'process_failure'] as const) {
      const outcome = phase2c26b1TaskOutcome('s0', 'stage1', process, null)
      expect(outcome).toEqual({ taskId: 's0', executionClass: 'stage1', process, record: null, searchStatus: null, delivered: null })
      expect(phase2c26b1Completed(outcome)).toBe(false)
    }
    expect(phase2c26b1TaskOutcome('s0', 'stage1', 'completed', null).process).toBe('process_failure')
    const zero: Phase2C26B1SearchChildRecord = { status: 'searched', taskId: 's0', executionClass: 'stage1', searchInputDigest: 'd', context: searchRecord('t1', []) }
    expect(phase2c26b1Completed(phase2c26b1TaskOutcome('s0', 'stage1', 'completed', zero))).toBe(true)
    const mismatch: Phase2C26B1SearchChildRecord = { status: 'context_mismatch', taskId: 's0', executionClass: 'stage1', expected: { contextDigest: 'a', searchInputDigest: 'b', targetWeaponId: 't' },
      actual: { contextDigest: null, searchInputDigest: null, targetWeaponId: null } }
    expect(phase2c26b1Completed(phase2c26b1TaskOutcome('s0', 'stage1', 'completed', mismatch))).toBe(false)
    const summary = phase2c26b1ExecutionSummary([{ outcome: completedOutcome('a', 'consumer_stop', 8) }, { outcome: completedOutcome('b', 'stopped_by_extent', 0) },
      { outcome: completedOutcome('c', 'exhausted', 3) }, { outcome: failedOutcome('d', 'timeout') }, { outcome: failedOutcome('e', 'out_of_memory') }])
    expect(summary).toMatchObject({ runs: 5, completed: 3, timeout: 1, outOfMemory: 1, processFailure: 0, consumerStop: 1, stoppedByExtent: 1, exhausted: 1, delivered: 11 })
  })

  it('explores a participant only through a normally ended context, and records why the others stay unexplored', () => {
    const contexts = [fakeContext({ orientationId: 'o0', targetWeaponId: 't1' }), fakeContext({ orientationId: 'o0', workIndex: 1, targetWeaponId: 't2' }),
      fakeContext({ orientationId: 'o1', targetWeaponId: 't3' }), fakeContext({ orientationId: 'o1', workIndex: 1, targetWeaponId: 't4' })]
    const { tasks } = planPhase2C26B1SearchTasks(contexts)
    const coverage = phase2c26b1ParticipantCoverage(['t1', 't2', 't3', 't4', 't5'], contexts, tasks,
      [completedOutcome(tasks[0].taskId, 'stopped_by_extent', 0), failedOutcome(tasks[1].taskId, 'timeout'), failedOutcome(tasks[2].taskId, 'timeout'), failedOutcome(tasks[3].taskId, 'out_of_memory')],
      [completedOutcome(tasks[1].taskId, 'exhausted', 2, 'coverage_fallback'), failedOutcome(tasks[2].taskId, 'timeout', 'coverage_fallback')])
    expect(coverage).toMatchObject({ total: 5, explored: 2, exploredInStage1: 1, newlyExploredByFallback: ['t2'], unexplored: ['t3', 't4', 't5'], unexploredWithOomOrFailure: ['t4'] })
    expect(coverage.rows.find(r => r.targetWeaponId === 't3')!.unexploredBy).toEqual(['timeout'])
    expect(coverage.rows.find(r => r.targetWeaponId === 't5')).toMatchObject({ contexts: 0, explored: false, unexploredBy: [] })
  })

  it('never reads an explored participant as every context completed, nor a size-1 portfolio with an unfinished context as a confirmed absence', () => {
    const contexts = [fakeContext({ orientationId: 'o0', targetWeaponId: 't1' }), fakeContext({ orientationId: 'o1', targetWeaponId: 't1', fixedRouteBuildListEntryIds: ['x'] }),
      fakeContext({ orientationId: 'o0', workIndex: 1, targetWeaponId: 't2' }), fakeContext({ orientationId: 'o2', targetWeaponId: 't3' }),
      fakeContext({ orientationId: 'o3', targetWeaponId: 't4' }), fakeContext({ orientationId: 'o4', targetWeaponId: 't4', fixedRouteBuildListEntryIds: ['y'] })]
    const { tasks } = planPhase2C26B1SearchTasks(contexts)
    const taskOf = (orientationId: string) => tasks.find(t => t.aliases.some(a => a.orientationId === orientationId) && t.targetWeaponId === contexts.find(c => c.orientationId === orientationId)!.targetWeaponId)!.taskId
    const t2Task = tasks.find(t => t.targetWeaponId === 't2')!.taskId
    const stage1 = [completedOutcome(taskOf('o0'), 'stopped_by_extent', 0), failedOutcome(taskOf('o1'), 'timeout'), completedOutcome(t2Task, 'stopped_by_extent', 0),
      failedOutcome(taskOf('o2'), 'timeout'), completedOutcome(taskOf('o3'), 'consumer_stop', 8), failedOutcome(taskOf('o4'), 'timeout')]
    const fallback = [completedOutcome(taskOf('o2'), 'stopped_by_extent', 0, 'coverage_fallback')]
    const coverage = phase2c26b1ParticipantCoverage(['t1', 't2', 't3', 't4'], contexts, tasks, stage1, fallback)
    // Every participant is explored (measurement coverage 4 / 4) ...
    expect(coverage).toMatchObject({ total: 4, explored: 4, unexplored: [] })
    const observation = phase2c26b1PortfolioObservation(coverage.rows, new Map([['t1', 1], ['t2', 1], ['t3', 1], ['t4', 9]]))
    const byTarget = new Map(observation.participants.map(p => [p.targetWeaponId, p]))
    // ... but explored is not every context completed.
    expect(byTarget.get('t1')).toMatchObject({ explored: true, unfinishedStage1Contexts: 1, allStage1ContextsCompleted: false, noAlternativeConfirmedInDefaultExtent: false })
    expect(byTarget.get('t3')).toMatchObject({ explored: true, exploredBy: 'coverage_fallback', unfinishedStage1Contexts: 1, noAlternativeConfirmedInDefaultExtent: false })
    expect(byTarget.get('t2')).toMatchObject({ allStage1ContextsCompleted: true, noAlternativeConfirmedInDefaultExtent: true })
    expect(byTarget.get('t4')).toMatchObject({ portfolioSize: 9, unfinishedStage1Contexts: 1, noAlternativeConfirmedInDefaultExtent: false })
    expect(observation.singleton).toMatchObject({ participants: 3, withUnfinishedStage1Contexts: 2, allStage1ContextsCompleted: 1, exploredOnlyByFallback: 1, noAlternativeConfirmedInDefaultExtent: 1 })
    expect(observation.multiple).toMatchObject({ participants: 1, withUnfinishedStage1Contexts: 1 })
    expect(observation.note).toMatch(/not every context completed/)
    expect(() => phase2c26b1PortfolioObservation(coverage.rows, new Map())).toThrow(/No portfolio/)
  })

  it('selects one deterministic fallback context per unexplored participant, and none for an explored one', () => {
    const orientations = [fakeOrientation('o0', ['f', 't1', 't2']), fakeOrientation('o1', ['g', 't1', 't2']), fakeOrientation('o2', ['h', 't3'])]
    const contexts = [
      fakeContext({ orientationId: 'o1', workIndex: 0, targetWeaponId: 't1', fixedRouteBuildListEntryIds: ['g'] }),
      fakeContext({ orientationId: 'o0', workIndex: 1, targetWeaponId: 't1', fixedRouteBuildListEntryIds: ['f'] }),
      fakeContext({ orientationId: 'o0', workIndex: 0, targetWeaponId: 't2', fixedRouteBuildListEntryIds: ['f'] }),
      fakeContext({ orientationId: 'o1', workIndex: 1, targetWeaponId: 't2', fixedRouteBuildListEntryIds: ['g'] }),
      fakeContext({ orientationId: 'o2', workIndex: 0, targetWeaponId: 't3', status: 'blocked_by_selected_checkpoint', reservation: null, searchReservation: null }),
    ]
    const { tasks } = planPhase2C26B1SearchTasks(contexts)
    const taskOf = (orientationId: string, target: string) => tasks.find(t => t.targetWeaponId === target && t.aliases.some(a => a.orientationId === orientationId))!.taskId
    const stage1 = [failedOutcome(taskOf('o1', 't1'), 'timeout'), failedOutcome(taskOf('o0', 't1'), 'timeout'), completedOutcome(taskOf('o0', 't2')), failedOutcome(taskOf('o1', 't2'), 'out_of_memory')]
    const selection = selectPhase2C26B1Fallback(['t2', 't1', 't3', 't1'], orientations, contexts, tasks, stage1)
    // t1: its first context by orientation order is o0#1 (not the first in the list); t2 is explored; t3 has no searchable context.
    expect(selection).toEqual({ selections: [{ targetWeaponId: 't1', taskId: taskOf('o0', 't1'), orientationId: 'o0', workIndex: 1, contextDigest: contexts[1].contextDigest }], noSearchableContext: ['t3'] })
    expect(selectPhase2C26B1Fallback(['t2', 't1', 't3'], orientations, [...contexts].reverse(), tasks, [...stage1].reverse())).toEqual(selection)
    expect(selectPhase2C26B1Fallback(['t1', 't2'], orientations, contexts, tasks, stage1.map(o => completedOutcome(o.taskId))).selections).toEqual([])
  })
})

// ---------------------------------------------------------------- portfolio

describe('Phase 2-C2.6-B1 portfolio', () => {
  const orientations = [fakeOrientation('o0', ['f', 't1']), fakeOrientation('o1', ['g', 't1'])]
  const originals = [{ targetWeaponId: 't1', buildListEntryId: 'e-t1', stableKey: 'orig', summary: summary('t1', { sourceOwnedWeaponId: 'w0' }) },
    { targetWeaponId: 'f', buildListEntryId: 'e-f', stableKey: 'orig-f', summary: summary('f') }, { targetWeaponId: 'g', buildListEntryId: 'e-g', stableKey: 'orig-g', summary: summary('g') }]

  it('dedups Candidates by stable key within the Target, keeps every provenance and execution class, and reports prefixes 1 / 2 / 4 / 8', () => {
    const plan = planPhase2C26B1SearchTasks([fakeContext({ orientationId: 'o0', fixedRouteBuildListEntryIds: ['e-f'] }), fakeContext({ orientationId: 'o1', fixedRouteBuildListEntryIds: ['e-g'] })])
    const keys = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
    const shared = { k3: summary('t1', { heldRoute: true, estimatedOperationCount: 5 }) }
    const portfolio = buildPhase2C26B1Portfolio({ originals, orientations }, [
      { task: plan.tasks[0], executionClass: 'stage1', context: searchRecord('t1', keys, {}, shared) },
      { task: plan.tasks[1], executionClass: 'coverage_fallback', context: searchRecord('t1', ['k3', 'orig', 'z'], {}, { ...shared, orig: originals[0].summary }) },
    ])
    const t1 = portfolio.find(p => p.targetWeaponId === 't1')!
    expect(t1.candidates.map(c => c.stableKey)).toEqual(['orig', ...keys, 'z'])
    expect(t1.candidates.find(c => c.stableKey === 'k3')!.provenance.map(p => [p.orientationId, p.executionClass, p.deliveredIndex])).toEqual([['o0', 'stage1', 3], ['o1', 'coverage_fallback', 0]])
    expect(t1.candidates.find(c => c.stableKey === 'orig')).toMatchObject({ origin: 'original' })
    expect(Object.keys(t1.diversityByDefaultPrefix)).toEqual(['1', '2', '4', '8'])
    expect(['1', '2', '4', '8'].map(k => t1.diversityByDefaultPrefix[k].candidates)).toEqual([3, 4, 6, 10])
    const summaryRow = phase2c26b1PortfolioSummary(portfolio, ['t1', 'f', 'g'], new Set(['t1']))
    expect(summaryRow).toMatchObject({ targets: 3, conflictParticipants: 3, exploredParticipants: 1, uniqueCandidates: 12, originals: 3, uniqueAlternatives: 9, participantsWithMultiple: 1,
      heldRoutes: { heldAlternativeCandidates: 1, heldAlternativesByFallbackOnly: 0 }, alternativesByExecutionClass: { stage1: 8, coverageFallbackOnly: 1 } })
    expect(summaryRow.byPrefix['8'].participantsWithMultiple).toBe(1)
    expect(() => buildPhase2C26B1Portfolio({ originals, orientations }, [{ task: plan.tasks[0], executionClass: 'stage1', context: searchRecord('t1', ['k0'], {}, { k0: summary('t1', { estimatedOperationCount: 2 }) }) },
      { task: plan.tasks[1], executionClass: 'stage1', context: searchRecord('t1', ['k0'], {}, { k0: summary('t1', { estimatedOperationCount: 3 }) }) }])).toThrow(/different summaries/)
  })

  it('marks A10 kernel judgements as metadata only, in the observing orientations', () => {
    const rows = [{ orientationId: 'o0', childOutcome: 'completed' as const, kernelCompleted: true, targets: [{ targetWeaponId: 't1', outcome: 'found', searched: true,
      search: null, trials: [{ candidateKeySha256: 'h0', result: 'rejected', reason: 'preflight_refused', generatedSelected: null }, { candidateKeySha256: 'h1', result: 'found', reason: null, generatedSelected: true }], foundKeySha256: 'h1' }] }]
    expect(phase2c26b1KernelMetadata(rows, 't1', 'h1', ['o0'])).toEqual([{ orientationId: 'o0', status: 'kernel_found', reason: null, generatedSelected: true }])
    expect(phase2c26b1KernelMetadata(rows, 't1', 'h0', ['o0'])).toEqual([{ orientationId: 'o0', status: 'kernel_trial_rejected', reason: 'preflight_refused', generatedSelected: null }])
    expect(phase2c26b1KernelMetadata(rows, 't1', 'h1', ['o1'])).toEqual([])
  })
})

// ---------------------------------------------------------------- kernel trial prefix parity

describe('Phase 2-C2.6-B1 kernel trial prefix parity', () => {
  const kernel = (patch: Partial<Phase2C26B1A10KernelTarget> = {}): Phase2C26B1A10KernelTarget => ({ targetWeaponId: 't1', outcome: 'found', searched: true,
    search: { deliveredCandidates: 2, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: true },
    trials: [{ candidateKeySha256: 'a', result: 'rejected', reason: 'x', generatedSelected: null }, { candidateKeySha256: 'b', result: 'found', reason: null, generatedSelected: true }], foundKeySha256: 'b', ...patch })
  const view = (keys: string[], patch: Partial<{ deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }> = {}) => ({
    status: 'consumer_stop' as const, keySha256s: keys,
    summary: { deliveredCandidates: keys.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: keys.length >= 8, ...patch } })

  it('matches the trial keys as the delivery prefix and checks a self-ended kernel Search end to end', () => {
    expect(comparePhase2C26B1KernelPrefix(kernel(), view(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 8).result).toBe('match')
    expect(comparePhase2C26B1KernelPrefix(kernel(), view(['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']), 8).result).toBe('mismatch')
    expect(comparePhase2C26B1KernelPrefix(kernel(), view(['a'], { stoppedByExtent: true }), 8)).toMatchObject({ result: 'mismatch' })
    expect(comparePhase2C26B1KernelPrefix(kernel({ foundKeySha256: 'a' }), view(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 8).result).toBe('mismatch')
    const selfEnded = kernel({ outcome: 'stopped_by_search_extent_bound', trials: [], foundKeySha256: null,
      search: { deliveredCandidates: 0, excludedCandidates: 1, exhausted: false, stoppedByExtent: true, stoppedByConsumer: false } })
    expect(comparePhase2C26B1KernelPrefix(selfEnded, view([], { excludedCandidates: 1, stoppedByExtent: true }), 8)).toMatchObject({ result: 'match', endComparison: true })
    expect(comparePhase2C26B1KernelPrefix(selfEnded, view([], { excludedCandidates: 0, stoppedByExtent: true }), 8).result).toBe('mismatch')
    expect(comparePhase2C26B1KernelPrefix(selfEnded, view([], { exhausted: true }), 8).result).toBe('mismatch')
    expect(comparePhase2C26B1KernelPrefix(selfEnded, view(['z'], { excludedCandidates: 1, stoppedByExtent: true }), 8).result).toBe('mismatch')
    expect(comparePhase2C26B1KernelPrefix(kernel(), null, 8)).toMatchObject({ result: 'not_comparable', reasons: ['b1_search_not_completed'] })
    expect(comparePhase2C26B1KernelPrefix(kernel({ searched: false, search: null }), view([]), 8).result).toBe('not_comparable')
  })

  it('maps every A10 completed kernel Target through its alias to the B1 task, skipping failed orientations', () => {
    const plan = planPhase2C26B1SearchTasks([fakeContext({ orientationId: 'o0' }), fakeContext({ orientationId: 'o1', workIndex: 1 })])
    const rows = [{ orientationId: 'o0', childOutcome: 'completed' as const, kernelCompleted: true, targets: [kernel()] },
      { orientationId: 'o1', childOutcome: 'completed' as const, kernelCompleted: true, targets: [kernel()] },
      { orientationId: 'o2', childOutcome: 'timeout' as const, kernelCompleted: false, targets: [] }]
    const parity = phase2c26b1KernelPrefixParity(rows, plan.tasks, new Map([[plan.tasks[0].taskId, view(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])]]), 8)
    expect(parity.totals).toEqual({ match: 2 })
    expect(parity.rows.map(r => [r.orientationId, r.taskId])).toEqual([['o0', plan.tasks[0].taskId], ['o1', plan.tasks[0].taskId]])
    expect(phase2c26b1KernelPrefixParity(rows, plan.tasks, new Map(), 8).totals).toEqual({ not_comparable: 2 })
  })

  it('checks the derived contexts against the A10 kernel Targets (order, searched status, extent) and lists what it cannot compare', () => {
    const rows = [{ orientationId: 'o0', childOutcome: 'completed' as const, kernelCompleted: true, targets: [kernel(), kernel({ targetWeaponId: 't2' })] },
      { orientationId: 'o1', childOutcome: 'timeout' as const, kernelCompleted: false, targets: [] }]
    const conditions = { extent: { ...defaultPlannerAlternativeSearchExtent }, bounds: {}, researchMaxPlanSteps: 1, calculationContext: {} }
    const contexts = [fakeContext({ orientationId: 'o0' }), fakeContext({ orientationId: 'o0', workIndex: 1, targetWeaponId: 't2' }), fakeContext({ orientationId: 'o1' })]
    const ok = comparePhase2C26B1ContextsWithA10(contexts, { rows, conditions })
    expect(ok).toMatchObject({ valid: true, comparedOrientations: 1, comparedTargets: 2 })
    expect(ok.notComparableFields).toEqual(expect.arrayContaining(['reservation', 'fixedRouteBuildListEntryIds', 'excludedRouteKeys']))
    expect(comparePhase2C26B1ContextsWithA10([contexts[1], { ...contexts[0], workIndex: 2 }], { rows, conditions }).valid).toBe(false)
    expect(comparePhase2C26B1ContextsWithA10([contexts[0], { ...contexts[1], status: 'blocked_by_selected_checkpoint' }], { rows, conditions }).valid).toBe(false)
    expect(comparePhase2C26B1ContextsWithA10(contexts, { rows, conditions: { ...conditions, extent: { ...conditions.extent, maxSkillAdvance: 5 } } }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- formal run validation and decision

describe('Phase 2-C2.6-B1 formal run and decision', () => {
  function fakeRaw() {
    const orientations = [fakeOrientation('o0', ['f', 't1']), fakeOrientation('o1', ['g', 't2'])]
    const contexts = [fakeContext({ orientationId: 'o0', targetWeaponId: 't1' }), fakeContext({ orientationId: 'o1', targetWeaponId: 't2' })]
    const plan = planPhase2C26B1SearchTasks(contexts)
    const stage1 = [{ taskId: plan.tasks[0].taskId, executionClass: 'stage1' as const, outcome: completedOutcome(plan.tasks[0].taskId) },
      { taskId: plan.tasks[1].taskId, executionClass: 'stage1' as const, outcome: failedOutcome(plan.tasks[1].taskId, 'timeout') }]
    const participants = ['t1', 't2']
    const fallbackSelection = selectPhase2C26B1Fallback(participants, orientations, contexts, plan.tasks, stage1.map(s => s.outcome))
    const fallback = fallbackSelection.selections.map(s => ({ taskId: s.taskId, executionClass: 'coverage_fallback' as const, outcome: completedOutcome(s.taskId, 'exhausted', 1, 'coverage_fallback') }))
    return { status: 'completed', environment: { smoke: null, uncommittedBenchmarkCode: false, stage1: { ...PHASE2C26B1_STAGE1 }, fallback: { ...PHASE2C26B1_FALLBACK }, captureBound: 8 },
      plan, participants, contexts: { baseline: { orientations }, contexts }, stage1, fallbackSelection, fallback,
      processes: [{ role: 'contexts', executionClass: null }, { role: 'search', executionClass: 'stage1' }, { role: 'search', executionClass: 'stage1' }, { role: 'search', executionClass: 'coverage_fallback' }] }
  }

  it('accepts only a complete formal series that ran exactly the registered fallback', () => {
    const raw = fakeRaw()
    expect(raw.fallback).toHaveLength(1)
    expect(validatePhase2C26B1FormalRun(raw)).toMatchObject({ valid: true, failures: [] })
    expect(validatePhase2C26B1FormalRun({ ...raw, environment: { ...raw.environment, smoke: { tasks: 1 } } }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, stage1: raw.stage1.slice(1) }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, fallback: [] }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, fallback: [...raw.fallback, raw.fallback[0]] }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, environment: { ...raw.environment, stage1: { ...PHASE2C26B1_STAGE1, budgetMs: 1 } } }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, environment: { ...raw.environment, captureBound: 4 } }).valid).toBe(false)
    expect(validatePhase2C26B1FormalRun({ ...raw, processes: raw.processes.slice(1) }).valid).toBe(false)
  })

  it('decides B1-S on any semantic failure, B1-M only with every participant explored, B1-I otherwise', () => {
    const clean = { authorityValid: true, a9ChainMatches: true, baselineParityValid: true, conditionParityValid: true, contextParityValid: true, contextMismatchTasks: 0, kernelPrefixMismatches: 0, reservationViolations: 0 }
    expect(phase2c26b1SemanticFailures(clean)).toEqual([])
    expect(phase2c26b1SemanticFailures({ ...clean, kernelPrefixMismatches: 1, contextParityValid: false })).toEqual(['pre_search_context_parity_failure', 'kernel_trial_prefix_mismatch'])
    expect(phase2c26b1Decision({ semanticFailures: [], participantsTotal: 34, participantsExplored: 34, unexploredWithOomOrFailure: 0 }).case).toBe('B1_M_measurement_complete')
    expect(phase2c26b1Decision({ semanticFailures: [], participantsTotal: 34, participantsExplored: 33, unexploredWithOomOrFailure: 0 }).case).toBe('B1_I_measurement_incomplete')
    expect(phase2c26b1Decision({ semanticFailures: [], participantsTotal: 34, participantsExplored: 33, unexploredWithOomOrFailure: 1 }).case).toBe('B1_I_measurement_incomplete')
    expect(phase2c26b1Decision({ semanticFailures: ['kernel_trial_prefix_mismatch'], participantsTotal: 34, participantsExplored: 34, unexploredWithOomOrFailure: 0 }).case).toBe('B1_S_semantic_failure')
    expect(() => phase2c26b1Decision({ semanticFailures: [], participantsTotal: 3, participantsExplored: 4, unexploredWithOomOrFailure: 0 })).toThrow()
    expect(() => phase2c26b1Decision({ semanticFailures: [], participantsTotal: 3, participantsExplored: 2, unexploredWithOomOrFailure: 2 })).toThrow()
    expect(PHASE2C26B1_DECISION_RULE.note).toMatch(/never a semantic failure/)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B1 isolation', () => {
  it('is never imported by Production and fixes no orientation, Target, Entry or Conflict ID', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B1/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [b1Source, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    for (const source of [b1Source, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle out of every calculation: only the analyzer reads it, after the run', () => {
    for (const source of [b1Source, runnerSource]) expect(source).not.toMatch(/ORACLE_RESULT|1657|--oracle|optimum|gogmaUsage/)
    expect(analysisSource).not.toMatch(/ORACLE_RESULT|1657|visitPlannerAlternativeCandidates|createProductionPlan/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B1SearchTask|createProductionPlan|runPhase2C2Kernel/)
  })

  it('runs Search only (no kernel, no trial, no observer) and gates every Search behind the A10 parity checks, with the fallback after Stage 1', () => {
    expect(runnerSource).not.toMatch(/Profiler|inspector|--cpu-prof|--no-opt|heartbeat|createCountingRngEngine|instrumentation|runPhase2C2Kernel|runPreparedPlannerAlternativeKernel/)
    const gate = runnerSource.indexOf('if (!baselineParity.valid || !conditionParity.valid || !contextParity.valid || !extentsUniform)')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(runnerSource.indexOf('const stage1 = await pool('))
    expect(runnerSource.indexOf('parsePhase2C26B1A10Authority(')).toBeLessThan(runnerSource.indexOf("runChild('contexts'"))
    expect(runnerSource.indexOf('selectPhase2C26B1Fallback(')).toBeGreaterThan(runnerSource.indexOf('const stage1 = await pool('))
    expect(runnerSource).toMatch(/--smoke-tasks \/ --smoke-budget-ms are non-formal smoke options and need --allow-uncommitted/)
    expect(b1Source).not.toMatch(/runPreparedPlannerAlternativeKernel|createProductionPlan\(|tryCandidate/)
  })

  it('the analyzer decides only on a formal run and records the oracle as default-extent coverage', () => {
    expect(analyzerSource).toMatch(/const decision = !formalRunValidation\.valid \? null :/)
    expect(analyzerSource).toMatch(/default-extent portfolio coverage/)
    expect(analyzerSource.indexOf('validatePhase2C26B1FormalRun(')).toBeLessThan(analyzerSource.indexOf('writeFile('))
  })
})
