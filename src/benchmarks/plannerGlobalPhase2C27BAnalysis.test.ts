import { describe, expect, it } from 'vitest'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json?raw'
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
import type { BuildListEntryId, RouteOperation } from '../domain/models/publicTypes'
import {
  createPhase2C27BTargetScheduler,
  PHASE2C27B_INITIAL_LADDER_STATE,
  phase2c27bResolveSupportContext,
  phase2c27bUnitTask,
  runPhase2C27BTrialLoop,
  type Phase2C27BLadderState,
  type Phase2C27BScheduledUnit,
  type Phase2C27BTargetPlan,
  type Phase2C27BUnitChildRecord,
  type Phase2C27BUnitResult,
} from './plannerGlobalPhase2C27B'
import {
  phase2c27bContextVerdict,
  phase2c27bCoveringRung,
  phase2c27bDecision,
  phase2c27bEscalationDiagnostics,
  phase2c27bReplay,
  phase2c27bRouteReservationCheck,
  phase2c27bTargetClass,
  phase2c27bUnitIssues,
  type Phase2C27BTargetJournalRow,
  type Phase2C27BUnitRow,
} from './plannerGlobalPhase2C27BAnalysis'

type Executed = Extract<Phase2C27BUnitChildRecord, { status: 'executed' }>
const state = (t: number, r: number, keys: string[] = []): Phase2C27BLadderState => ({ candidateTrialsUsed: t, plannerRerunsUsed: r, previouslyRejectedCandidateStableKeys: keys })

function plan(ranks: number, targetIndex = 0, checkpointBlocked = false): Phase2C27BTargetPlan {
  const id = `target.${targetIndex}`
  return { targetWeaponId: id, targetIndex, currentBuildListEntryId: `entry.own.${targetIndex}`, checkpointBlocked,
    contexts: Array.from({ length: ranks }, (_, i) => ({ targetWeaponId: id, contextRank: i + 1, groupIndex: i, reservationDigest: `d${i}`, cardinality: (i === 0 ? 0 : 1) as 0 | 1,
      representativeFixedSetId: i === 0 ? 'K0' : `F${i}`, supportBuildListEntryIds: i === 0 ? [] : [`entry.s${i}`], supportTargetWeaponIds: [] })) }
}

/** A minimal executed record whose own fields agree with `outcome` (no delivery, no trial). */
function emptyRecord(task: ReturnType<typeof phase2c27bUnitTask>, outcome: Executed['outcome'], end: Phase2C27BLadderState = task.ladderStateAtStart): Executed {
  return { status: 'executed', unitId: task.unitId, task, outcome, ladderStateAtStart: task.ladderStateAtStart, ladderStateAtEnd: end, reservation: { normal: [], skill: null, gogma: null, exclusiveOwnedWeaponIds: [] } as never,
    excludedRouteKeys: ['current'], deliveries: [], skippedPreviouslyRejected: [], trials: [], found: null,
    search: { deliveredCandidates: 0, excludedCandidates: 0, exhausted: outcome === 'not_found_within_search_extent', stoppedByExtent: outcome === 'stopped_by_search_extent_bound', stoppedByConsumer: false, skippedExcludedRouteKeys: 0 },
    timing: { unitMs: 1, searchVisitMs: 1, trialMs: 0, searchOnlyMs: 1 } }
}

/** Simulates a run of the registered scheduler over plans: rows, records and the Target journal it would write. */
function simulate(plans: Phase2C27BTargetPlan[], outcomeOf: (unit: Phase2C27BScheduledUnit) => Executed['outcome'] | 'timeout') {
  const rows: Phase2C27BUnitRow[] = [], records = new Map<string, Phase2C27BUnitChildRecord | null>(), journal: Phase2C27BTargetJournalRow[] = []
  for (const p of plans) {
    const scheduler = createPhase2C27BTargetScheduler(p)
    for (;;) {
      const next = scheduler.next()
      if (!('unitId' in next)) { journal.push({ targetWeaponId: p.targetWeaponId, targetIndex: p.targetIndex, checkpointBlocked: p.checkpointBlocked, stop: next }); break }
      const outcome = outcomeOf(next)
      const task = phase2c27bUnitTask(p, next)
      const record = outcome === 'timeout' ? null : emptyRecord(task, outcome)
      const result: Phase2C27BUnitResult = record === null ? { measured: false, reason: 'timeout' } : { measured: true, outcome: record.outcome, ladderStateAtEnd: record.ladderStateAtEnd }
      records.set(next.unitId, record)
      rows.push({ unitId: next.unitId, targetWeaponId: p.targetWeaponId, targetIndex: p.targetIndex, contextRank: next.contextRank, rung: next.rung, ladderStateAtStart: next.ladderStateAtStart,
        process: { outcome: record === null ? 'timeout' : 'completed', wallMs: 1, timedOut: record === null, budgetMs: 3_600_000 }, recordFile: null, result })
      scheduler.record(result)
    }
  }
  return { rows, recordOf: (id: string) => records.get(id) ?? null, journal }
}

describe('Phase 2-C2.7-B scheduler replay (task generation order and escalation)', () => {
  const outcome = (u: Phase2C27BScheduledUnit): Executed['outcome'] | 'timeout' => u.contextRank === 2 ? 'stopped_by_candidate_trial_bound' : u.contextRank === 3 ? 'timeout'
    : u.rung === 'L1' && u.contextRank === 4 ? 'found_R' : 'stopped_by_search_extent_bound'

  it('accepts a realized run that is exactly the registered scheduler, with each unit result recomputed from its record', () => {
    const plans = [plan(4, 0), plan(0, 1, true), plan(4, 2)]
    const run = simulate(plans, outcome)
    const replay = phase2c27bReplay(plans, run.rows, run.recordOf, run.journal)
    expect(replay.mismatches).toEqual([])
    expect(replay.targets.map(t => t.stop?.stopReason)).toEqual(['found_R', 'blocked_by_selected_checkpoint', 'found_R'])
    expect(replay.targets[0]!.units.map(u => u.scheduled.unitId)).toEqual(['t00-r01-L0', 't00-r02-L0', 't00-r03-L0', 't00-r04-L0', 't00-r01-L1', 't00-r04-L1'])
    expect(replay.targets.every(t => t.requiredNotExecuted === null)).toBe(true)
  })

  it('flags an escalated trial-bound context, a refilled ladder state, a retry, a recorded result its record does not give, and a checkpoint Target that ran', () => {
    const plans = [plan(4, 0)]
    const base = simulate(plans, outcome)
    const escalated = [...base.rows.slice(0, 5), { ...base.rows[1]!, unitId: 't00-r02-L1', rung: 'L1' as const }, ...base.rows.slice(5)]
    expect(phase2c27bReplay(plans, escalated, base.recordOf, base.journal).mismatches.length).toBeGreaterThan(0)
    const refilled = base.rows.map(r => r.unitId === 't00-r04-L1' ? { ...r, ladderStateAtStart: state(0, 0, ['x']) } : r)
    expect(phase2c27bReplay(plans, refilled, base.recordOf, base.journal).mismatches.join()).toMatch(/ladder state at start/)
    expect(phase2c27bReplay(plans, [...base.rows, base.rows[0]!], base.recordOf, base.journal).mismatches.join()).toMatch(/repeats/)
    const lied = base.rows.map(r => r.unitId === 't00-r02-L0' ? { ...r, result: { measured: true as const, outcome: 'stopped_by_search_extent_bound' as const, ladderStateAtEnd: state(0, 0) } } : r)
    expect(phase2c27bReplay(plans, lied, base.recordOf, base.journal).mismatches.join()).toMatch(/recorded result/)
    const blocked = [plan(0, 0, true)]
    expect(phase2c27bReplay(blocked, base.rows, base.recordOf, [{ targetWeaponId: 'target.0', targetIndex: 0, checkpointBlocked: true, stop: { stopReason: 'blocked_by_selected_checkpoint', rung: null, contextRank: null } }]).mismatches.length).toBeGreaterThan(0)
  })

  it('reports the policy-required unit an interrupted run never executed, without inventing its outcome', () => {
    const plans = [plan(4, 0), plan(4, 1)]
    const run = simulate(plans, outcome)
    const cut = run.rows.filter(r => r.targetIndex === 0).slice(0, 3)
    const replay = phase2c27bReplay(plans, cut, run.recordOf, [])
    expect(replay.mismatches).toEqual([])
    expect(replay.targets.map(t => t.requiredNotExecuted?.unitId ?? null)).toEqual(['t00-r04-L0', 't01-r01-L0'])
    expect(replay.targets.map(t => t.stop)).toEqual([null, null])
  })
})

// ---------------------------------------------------------------- one unit, against a real trial loop record

const TARGET_A = 'target.c27ba.a', TARGET_B = 'target.c27ba.b'
const ENTRY_A = 'build-list.c27ba.a' as BuildListEntryId, ENTRY_B = 'build-list.c27ba.b' as BuildListEntryId
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source'
async function realRecord(): Promise<Executed> {
  const skill = { seriesSkillId: SKILL_A, groupSkillId: null, matchMode: 'all' as const }
  const a = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill }), b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const built = orchestrationScenario({ targets: [a, b], ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }),
    orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B })],
  entries: [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] })] })
  const resolved = phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, [ENTRY_A])
  if (resolved.status !== 'ready') throw new Error('fixture')
  const loop = await runPhase2C27BTrialLoop(built.input, resolved.prepared, { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, PHASE2C27B_INITIAL_LADDER_STATE, built.dependencies)
  const task = { ...phase2c27bUnitTask(plan(2, 0), { unitId: 't00-r02-L0', targetWeaponId: 'target.0', targetIndex: 0, contextRank: 2, rung: 'L0', ladderStateAtStart: PHASE2C27B_INITIAL_LADDER_STATE }) }
  return { status: 'executed', unitId: task.unitId, task, ...loop }
}

describe('Phase 2-C2.7-B unit checks (independent ladder state and outcome recomputation)', () => {
  it('finds nothing to object to in a real found_R record', async () => {
    const record = await realRecord()
    expect(record.outcome).toBe('found_R')
    expect(phase2c27bUnitIssues(record.task, record)).toEqual([])
  })

  it('flags a refilled or inconsistent ladder state, a re-trial, a resolution in a trial run, a cost decrease and a wrong outcome', async () => {
    const record = await realRecord()
    const issues = (patch: (r: Executed) => void) => { const r = structuredClone(record); patch(r); return phase2c27bUnitIssues(record.task, r).join(' | ') }
    expect(issues(r => { r.ladderStateAtEnd.candidateTrialsUsed = 0 })).toMatch(/candidateTrialsUsed/)
    expect(issues(r => { r.ladderStateAtEnd.plannerRerunsUsed = 9 })).toMatch(/plannerRerunsUsed/)
    expect(phase2c27bUnitIssues({ ...record.task, ladderStateAtStart: state(0, 0, [record.trials[0]!.candidateStableKey]) }, { ...structuredClone(record), task: { ...record.task, ladderStateAtStart: state(0, 0, [record.trials[0]!.candidateStableKey]) }, ladderStateAtStart: state(0, 0, [record.trials[0]!.candidateStableKey]) }).join()).toMatch(/trialled again/)
    expect(issues(r => { r.trials[0]!.trialConflictResolutions = 1 })).toMatch(/G1/)
    expect(issues(r => { r.deliveries.push({ ...r.deliveries[0]!, deliveryIndex: 1, estimatedOperationCount: -1 }) })).toMatch(/after the consumer stop|decreases/)
    expect(issues(r => { r.outcome = 'stopped_by_search_extent_bound' })).toMatch(/outcome/)
    expect(issues(r => { r.task = { ...r.task, rung: 'L1' } })).toMatch(/echoed task/)
  })

  it('accepts the stop actions a cumulative state requires and nothing else', async () => {
    const record = await realRecord()
    const trialBound = structuredClone(record)
    trialBound.task.ladderStateAtStart = state(2, 2, ['k1', 'k2'])
    trialBound.ladderStateAtStart = trialBound.task.ladderStateAtStart
    trialBound.ladderStateAtEnd = trialBound.task.ladderStateAtStart
    trialBound.trials = []
    trialBound.found = null
    trialBound.outcome = 'stopped_by_candidate_trial_bound'
    trialBound.deliveries = [{ ...record.deliveries[0]!, action: 'stopped_by_candidate_trial_bound', trialOrdinal: null }]
    expect(phase2c27bUnitIssues(trialBound.task, trialBound)).toEqual([])
    trialBound.deliveries = [{ ...record.deliveries[0]!, action: 'trialled', trialOrdinal: null }]
    expect(phase2c27bUnitIssues(trialBound.task, trialBound).join()).toMatch(/action/)
  })
})

// ---------------------------------------------------------------- reservation, verdicts, classes, decision

describe('Phase 2-C2.7-B found_R Route reservation check', () => {
  const reservation = { normal: [{ counterId: 'weapon.bow:8', held: [3, 4, 5], blocked: [5] }], skill: { held: [10, 11], blocked: [11] }, gogma: { held: [20, 21], blocked: [21] }, exclusiveOwnedWeaponIds: ['owned.x'] }
  const route = (operations: RouteOperation[], sourceOwnedWeaponId: string | null = null) => ({ operations, sourceOwnedWeaponId })
  it('accepts held-but-shareable positions and a Counter-advance forge on a blocked position', () => {
    expect(phase2c27bRouteReservationCheck(route([
      { type: 'create_normal_artian', weaponTypeId: 'weapon.bow', rarity: 8, count: 3, normalCounterBefore: 4, normalCounterAfter: 7 },
      { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.bow', skillCounterBefore: 10, skillCounterAfter: 11 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 20, gogmaCounterAfter: 21 },
    ] as never), reservation as never)).toEqual({ respects: true, hits: [] })
  })
  it('rejects a blocked Gogma / Skill position, a blocked production target and an exclusive source', () => {
    const check = phase2c27bRouteReservationCheck(route([
      { type: 'create_normal_artian', weaponTypeId: 'weapon.bow', rarity: 8, count: 2, normalCounterBefore: 4, normalCounterAfter: 6 },
      { type: 'reset_skills', sourceOwnedWeaponId: null, skillCounterBefore: 11, skillCounterAfter: 12 },
      { type: 'keep_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 21, gogmaCounterAfter: 22 },
    ] as never, 'owned.x'), reservation as never)
    expect(check.hits).toEqual(['normal:5', 'skill:11', 'gogma:21', 'exclusive:owned.x'])
  })
})

describe('Phase 2-C2.7-B per-Target class (§9.6) and decision (§9.7)', () => {
  const m = (rung: 'L0' | 'L1' | 'L2', outcome: Extract<Phase2C27BUnitResult, { measured: true }>['outcome']) => ({ rung, result: { measured: true as const, outcome, ladderStateAtEnd: state(0, 0) } })
  const u = (rung: 'L0' | 'L1' | 'L2') => ({ rung, result: { measured: false as const, reason: 'timeout' as const } })

  it('derives the covering rung from the registered ladder', () => {
    expect(phase2c27bCoveringRung({ normal: 4, gogma: 235, skill: 4 })).toBe('L0')
    expect(phase2c27bCoveringRung({ normal: 5, gogma: 119, skill: 22 })).toBe('L1')
    expect(phase2c27bCoveringRung({ normal: null, gogma: 10, skill: 1213 })).toBe('L2')
    expect(phase2c27bCoveringRung({ normal: 1, gogma: 236, skill: 1 })).toBeNull()
  })

  it('decides a context verdict from its last unit only, relative to the covering rung', () => {
    expect(phase2c27bContextVerdict([], 'L1')).toBe('not_executed')
    expect(phase2c27bContextVerdict([m('L0', 'stopped_by_search_extent_bound'), m('L1', 'not_found_within_search_extent')], 'L1')).toBe('covered_measured')
    expect(phase2c27bContextVerdict([m('L0', 'stopped_by_search_extent_bound'), u('L1')], 'L1')).toBe('covered_unmeasured')
    expect(phase2c27bContextVerdict([u('L0')], 'L1')).toBe('unmeasured_below_covering')
    expect(phase2c27bContextVerdict([m('L0', 'stopped_by_candidate_trial_bound')], 'L2')).toBe('trial_bound_below_covering')
    expect(phase2c27bContextVerdict([m('L0', 'stopped_by_planner_rerun_bound')], 'L2')).toBe('rerun_bound_below_covering')
    expect(phase2c27bContextVerdict([m('L0', 'not_found_within_search_extent')], 'L1')).toBe('closed_below_covering')
    expect(phase2c27bContextVerdict([m('L0', 'stopped_by_search_extent_bound')], 'L1')).toBe('escalation_pending_at_target_stop')
    expect(phase2c27bContextVerdict([m('L2', 'stopped_by_search_extent_bound')], null)).toBe('extent_bound_at_ladder_top')
  })

  it('classifies exclusively, top to bottom, never reading trial / rerun / unmeasured as extent shortage', () => {
    const base = { checkpointBlocked: false, stop: null, foundStableKey: null, oracleStableKey: 'k' }
    const found = { stopReason: 'found_R' as const, rung: 'L1' as const, contextRank: 3 }
    expect(phase2c27bTargetClass({ ...base, stop: found, foundStableKey: 'k', verdicts: [] })).toBe('exact_recovered')
    expect(phase2c27bTargetClass({ ...base, stop: found, foundStableKey: 'other', verdicts: ['covered_measured'] })).toBe('found_non_oracle')
    expect(phase2c27bTargetClass({ ...base, checkpointBlocked: true, verdicts: [] })).toBe('blocked_by_selected_checkpoint')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['not_executed', 'not_executed'] })).toBe('context_not_reached')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['covered_unmeasured', 'covered_measured'] })).toBe('searched_not_recovered')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['closed_below_covering', 'trial_bound_below_covering'] })).toBe('searched_not_recovered')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['unmeasured_below_covering', 'trial_bound_below_covering'] })).toBe('execution_unmeasured')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['rerun_bound_below_covering', 'not_executed'] })).toBe('stopped_by_trial_or_rerun_bound')
    expect(phase2c27bTargetClass({ ...base, verdicts: ['extent_bound_at_ladder_top'] })).toBe('extent_ladder_insufficient')
  })

  it('applies the pre-registered decision order and keeps INCOMPLETE recovery counts as lower bounds', () => {
    expect(phase2c27bDecision({ invalidReasons: ['x'], unmeasuredUnits: 0, requiredNotExecuted: 0, exactRecovered: 11, targets: 11 }).case).toBe('B2C27B_INVALID')
    const incomplete = phase2c27bDecision({ invalidReasons: [], unmeasuredUnits: 1, requiredNotExecuted: 0, exactRecovered: 11, targets: 11 })
    expect(incomplete.case).toBe('B2C27B_INCOMPLETE')
    expect(incomplete.reasons.join()).toMatch(/lower bound/)
    expect(phase2c27bDecision({ invalidReasons: [], unmeasuredUnits: 0, requiredNotExecuted: 1, exactRecovered: 0, targets: 11 }).case).toBe('B2C27B_INCOMPLETE')
    expect(phase2c27bDecision({ invalidReasons: [], unmeasuredUnits: 0, requiredNotExecuted: 0, exactRecovered: 11, targets: 11 }).case).toBe('B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED')
    expect(phase2c27bDecision({ invalidReasons: [], unmeasuredUnits: 0, requiredNotExecuted: 0, exactRecovered: 4, targets: 11 }).case).toBe('B2C27B_E1_PARTIAL')
    expect(phase2c27bDecision({ invalidReasons: [], unmeasuredUnits: 0, requiredNotExecuted: 0, exactRecovered: 0, targets: 11 }).case).toBe('B2C27B_E1_NOT_RECOVERED')
  })
})

describe('Phase 2-C2.7-B escalation superset diagnostic', () => {
  it('counts an upper-rung trial of a Candidate already delivered below as a violation', async () => {
    const record = await realRecord()
    const lower = structuredClone(record), upper = structuredClone(record)
    lower.task = { ...lower.task, rung: 'L0' }
    upper.task = { ...upper.task, rung: 'L1' }
    const unit = (r: Executed, rung: 'L0' | 'L1') => ({ scheduled: { unitId: `t00-r02-${rung}`, targetWeaponId: 'target.0', targetIndex: 0, contextRank: 2, rung, ladderStateAtStart: state(0, 0) }, record: r })
    expect(phase2c27bEscalationDiagnostics([unit(lower, 'L0'), unit(upper, 'L1')]).violations).toBe(1)
    upper.deliveries[0]!.stableKey = 'a new key'
    expect(phase2c27bEscalationDiagnostics([unit(lower, 'L0'), unit(upper, 'L1')]).violations).toBe(0)
  })
})

// ---------------------------------------------------------------- the committed formal RESULT

describe('Phase 2-C2.7-B committed formal RESULT', () => {
  const result = JSON.parse(rawResult)
  const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')

  it('is the analyzed formal run of the measurement HEAD, with no Production change and the registered conditions', async () => {
    expect(await sha256(rawResult)).toBe('d79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4')
    expect(result.provenance.formal).toBe(true)
    expect(result.provenance.measuredHead).toBe('b24bf5dc7d98cb8341a24d27fabbd1a36843a004')
    expect(result.provenance.runStatus).toBe('completed')
    expect(result.provenance.startAttestation.verified).toBe(true)
    expect(result.provenance.calculationCodeChangedSinceMeasuredHead).toEqual([])
    expect(result.provenance.productionChangedFiles).toEqual({ toMeasuredHead: [], toAnalysisHead: [] })
    expect(result.provenance.oracleGuidedTargetPopulation).toBe(true)
    expect(result.provenance.oracleInformedExecutionEnvelope).toBe(true)
    expect(result.provenance.oracleReadByScheduler).toBe(false)
    expect(result.provenance.oracleReadBySearchChild).toBe(false)
    expect(result.conditions.ladderBudget).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8, scope: '(Target, context)', resetPerRung: false })
    expect(result.conditions.researchMaxPlanSteps).toBe(20_000)
    expect(result.environment.appliedExecutionEnvelope).toEqual({ unitBudgetMs: 3_600_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none' })
    expect(Object.values(result.hashChain).every(Boolean)).toBe(true)
    expect(result.oracleMaterialization).toEqual({ passed: true, entriesSha256Matches: true, candidateIdsMatch: true })
    expect(result.populationParity).toMatchObject({ manifestEqualsE1: true, manifestKeysAreTargetIdsOnly: true, targets: 11 })
    expect(result.p1Order.every((p: { contexts: number; k0: number; k1: number; independentP1Matches: boolean }) => p.independentP1Matches && p.contexts === 43 && p.k0 === 1 && p.k1 === 42)).toBe(true)
  })

  it('records B2C27B_INCOMPLETE: 0 invalid, 8 timeouts, every Target stopped by found_R, exact_recovered 0 / 11 as a lower bound', () => {
    expect(result.invalidReasons).toEqual([])
    expect(result.decision.case).toBe('B2C27B_INCOMPLETE')
    expect(result.aggregates).toMatchObject({ units: 575, measured: 567, unmeasured: 8, requiredNotExecuted: 0, unmeasuredByReason: { timeout: 8 }, stops: { found_R: 11 },
      exactRecovered: 0, exactRecoveredOf: 11, reservationViolations: 0, escalationSupersetViolations: 0, contextsReachingRerunBound: 0 })
    expect(result.aggregates.classCounts).toEqual({ exact_recovered: 0, found_non_oracle: 11, blocked_by_selected_checkpoint: 0, context_not_reached: 0, searched_not_recovered: 0,
      execution_unmeasured: 0, stopped_by_trial_or_rerun_bound: 0, extent_ladder_insufficient: 0 })
    expect(phase2c27bDecision({ invalidReasons: result.invalidReasons, unmeasuredUnits: result.aggregates.unmeasured, requiredNotExecuted: result.aggregates.requiredNotExecuted,
      exactRecovered: result.aggregates.exactRecovered, targets: result.targets.length })).toEqual(result.decision)
  })

  it('re-derives every Target class and keeps every unit inside the registered ladder rules', () => {
    for (const t of result.targets) {
      expect(phase2c27bTargetClass({ checkpointBlocked: t.checkpointBlocked, stop: t.stop, foundStableKey: t.found?.stableKeySha256 ?? null, oracleStableKey: t.oracle.stableKeySha256,
        verdicts: t.compatibleContextVerdicts.map((v: { verdict: string }) => v.verdict) })).toBe(t.class)
      expect(t.exactDeliveredButNotFound).toBe(false)
    }
    const units = result.units as { unitId: string; targetIndex: number; contextRank: number; rung: 'L0' | 'L1' | 'L2'; result: string; ladderStateAtStart: { candidateTrialsUsed: number; plannerRerunsUsed: number }; ladderStateAtEnd: { candidateTrialsUsed: number; plannerRerunsUsed: number } | null }[]
    expect(new Set(units.map(u => u.unitId)).size).toBe(units.length)
    for (const u of units) {
      if (u.rung !== 'L0') {
        const below = units.find(x => x.targetIndex === u.targetIndex && x.contextRank === u.contextRank && x.rung === (u.rung === 'L1' ? 'L0' : 'L1'))
        expect(below?.result, u.unitId).toBe('stopped_by_search_extent_bound')
        expect(u.ladderStateAtStart).toEqual({ candidateTrialsUsed: below!.ladderStateAtEnd!.candidateTrialsUsed, plannerRerunsUsed: below!.ladderStateAtEnd!.plannerRerunsUsed,
          previouslyRejectedSha256: (below!.ladderStateAtEnd as unknown as { previouslyRejectedSha256: string[] }).previouslyRejectedSha256 })
      }
      if (u.ladderStateAtEnd) {
        expect(u.ladderStateAtEnd.candidateTrialsUsed).toBeLessThanOrEqual(2)
        expect(u.ladderStateAtEnd.plannerRerunsUsed).toBeLessThanOrEqual(8)
      }
    }
    expect(rawResult).not.toMatch(/"stableKey"|"candidateStableKey"/)
  })
})
