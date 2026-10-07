/**
 * Issue #154 Phase 2-C2.7-B post-hoc analysis only (Phase 2-C2.7-A §9.2 - §9.7). It reads a finished (or interrupted) raw run, every
 * unit record and, as explicit analyzer inputs AFTER the run ended, the authorities and the oracle. It runs no Search, no unit and
 * no Planner for the policy side and feeds nothing back into any calculation; the scheduler side never imports this module.
 *
 * It does not trust the runner: the expected unit sequence is replayed from the recorded typed outcomes by the same registered
 * scheduler (`createPhase2C27BTargetScheduler()`), every unit's typed result is recomputed from its process outcome and record,
 * every ladder state is re-derived from the unit's own trial records, and the Search reservation of every `found_R` Route is
 * re-checked operation by operation. The exact judgement is `candidateStableKey()` equality between the Route the policy stopped
 * at and the oracle Route (re-materialized by the analyzer script from the oracle manifest and checked against the oracle RESULT).
 */
import { stableStringify } from '../domain/models/hashing'
import type { RouteOperation } from '../domain/models/entities'
import type { PlannerAlternativeReservation } from '../domain/search'
import type { Phase2C2CandidateSummary } from './plannerGlobalPhase2C2'
import {
  createPhase2C27BTargetScheduler,
  PHASE2C27B_LADDER,
  PHASE2C27B_LADDER_BUDGET,
  PHASE2C27B_RUNG_IDS,
  phase2c27bLadderStateIssues,
  phase2c27bUnitResult,
  phase2c27bUnitTask,
  type Phase2C27BLadderState,
  type Phase2C27BRungId,
  type Phase2C27BScheduledUnit,
  type Phase2C27BTargetPlan,
  type Phase2C27BTargetStop,
  type Phase2C27BUnitChildRecord,
  type Phase2C27BUnitOutcome,
  type Phase2C27BUnitResult,
  type Phase2C27BUnitTask,
} from './plannerGlobalPhase2C27B'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const rungIndex = (rung: Phase2C27BRungId) => PHASE2C27B_RUNG_IDS.indexOf(rung)
type Executed = Extract<Phase2C27BUnitChildRecord, { status: 'executed' }>

// ---------------------------------------------------------------- the raw shapes the runner writes

export interface Phase2C27BUnitRow {
  unitId: string
  targetWeaponId: string
  targetIndex: number
  contextRank: number
  rung: Phase2C27BRungId
  ladderStateAtStart: Phase2C27BLadderState
  process: { outcome: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure'; wallMs: number; timedOut: boolean; budgetMs: number }
  recordFile: { file: string; bytes: number; sha256: string } | null
  result: Phase2C27BUnitResult
}

export interface Phase2C27BTargetJournalRow {
  targetWeaponId: string
  targetIndex: number
  checkpointBlocked: boolean
  stop: Phase2C27BTargetStop | null
}

// ---------------------------------------------------------------- 1. the scheduler replay (task generation order and escalation)

export interface Phase2C27BReplayedUnit {
  scheduled: Phase2C27BScheduledUnit
  task: Phase2C27BUnitTask
  row: Phase2C27BUnitRow
  record: Phase2C27BUnitChildRecord | null
  /** The typed result recomputed from the process outcome and the record (never the row's own claim). */
  result: Phase2C27BUnitResult
}

export interface Phase2C27BTargetReplay {
  targetWeaponId: string
  targetIndex: number
  plan: Phase2C27BTargetPlan
  units: Phase2C27BReplayedUnit[]
  /** The replayed stop; null when the run ended before the policy stopped this Target. */
  stop: Phase2C27BTargetStop | null
  /** The policy-required unit the run never executed (interrupted / never reached); null when the Target stopped. */
  requiredNotExecuted: Phase2C27BScheduledUnit | null
  contextStates: ReturnType<ReturnType<typeof createPhase2C27BTargetScheduler>['contextStates']>
  /** Divergences between the realized run and the registered scheduler: each one invalidates the run. */
  mismatches: string[]
}

/**
 * Replays the registered rung-major scheduler of every plan over the recorded units, in manifest order. Each recorded unit must be
 * the next unit the scheduler asks for (unit ID, context, rung, ladder state at start), its result is recomputed from the record,
 * the replayed stop must be the recorded one, and no unit may be left over (an extra unit = a re-run, a retry or an escalation the
 * policy did not require). A recorded unit order that is not Target-major in manifest order is a mismatch too.
 */
export function phase2c27bReplay(plans: readonly Phase2C27BTargetPlan[], rows: readonly Phase2C27BUnitRow[], recordOf: (unitId: string) => Phase2C27BUnitChildRecord | null,
  journal: readonly Phase2C27BTargetJournalRow[]): { targets: Phase2C27BTargetReplay[]; mismatches: string[] } {
  const mismatches: string[] = []
  const order = rows.map(r => r.targetIndex)
  if (!order.every((value, i) => i === 0 || value >= order[i - 1]!)) mismatches.push('the recorded units are not Target-major in manifest order')
  if (new Set(rows.map(r => r.unitId)).size !== rows.length) mismatches.push('a unit ID repeats (a retry or a re-run)')
  const targets = plans.map((plan): Phase2C27BTargetReplay => {
    const own = rows.filter(r => r.targetWeaponId === plan.targetWeaponId)
    const scheduler = createPhase2C27BTargetScheduler(plan)
    const units: Phase2C27BReplayedUnit[] = []
    const issues: string[] = []
    let stop: Phase2C27BTargetStop | null = null
    let requiredNotExecuted: Phase2C27BScheduledUnit | null = null
    let index = 0
    for (;;) {
      const next = scheduler.next()
      if (!('unitId' in next)) { stop = next; break }
      const row = own[index]
      if (!row) { requiredNotExecuted = next; break }
      index += 1
      if (row.unitId !== next.unitId || row.contextRank !== next.contextRank || row.rung !== next.rung || row.targetIndex !== plan.targetIndex) {
        issues.push(`${plan.targetWeaponId}: recorded unit ${row.unitId} is not the scheduled ${next.unitId}`)
        break
      }
      if (!same(row.ladderStateAtStart, next.ladderStateAtStart)) issues.push(`${row.unitId}: the recorded ladder state at start is not the previous rung's end state`)
      const record = recordOf(row.unitId)
      const result = phase2c27bUnitResult(row.process.outcome, record)
      if (!same(result, row.result)) issues.push(`${row.unitId}: the recorded result is not the result of its record`)
      units.push({ scheduled: next, task: phase2c27bUnitTask(plan, next), row, record, result })
      scheduler.record(result)
    }
    if (index < own.length && issues.length === 0) issues.push(`${plan.targetWeaponId}: ${own.length - index} recorded unit(s) the policy did not require`)
    const recorded = journal.find(j => j.targetWeaponId === plan.targetWeaponId)
    if (stop !== null) {
      if (!recorded) issues.push(`${plan.targetWeaponId}: the policy stopped the Target but no Target stop was recorded`)
      else if (!same(recorded.stop, stop)) issues.push(`${plan.targetWeaponId}: the recorded stop ${JSON.stringify(recorded.stop)} is not the replayed ${JSON.stringify(stop)}`)
    } else if (recorded && recorded.stop !== null) issues.push(`${plan.targetWeaponId}: a stop was recorded before the policy stopped the Target`)
    if (plan.checkpointBlocked && own.length > 0) issues.push(`${plan.targetWeaponId}: a checkpoint-blocked Target ran units`)
    mismatches.push(...issues)
    return { targetWeaponId: plan.targetWeaponId, targetIndex: plan.targetIndex, plan, units, stop, requiredNotExecuted, contextStates: scheduler.contextStates(), mismatches: issues }
  })
  const known = new Set(plans.map(p => p.targetWeaponId))
  if (rows.some(r => !known.has(r.targetWeaponId))) mismatches.push('a recorded unit names a Target outside the plans')
  return { targets, mismatches }
}

// ---------------------------------------------------------------- 2. one unit's ladder state, budget and outcome (independent recomputation)

/**
 * The independent checks of one executed unit against its scheduled task: the echoed task, the ladder state chain (start = task,
 * end = start + this unit's own trial records), the cumulative caps 2 / 8, no re-trial of a rejected Candidate, the skip / stop
 * actions of every delivery, the typed outcome against the Search summary and the trials, no conflict resolution in any trial run
 * (G1), and non-decreasing delivered operation cost. Every returned issue invalidates the run.
 */
export function phase2c27bUnitIssues(task: Phase2C27BUnitTask, record: Executed): string[] {
  const at = task.unitId
  const issues: string[] = []
  if (!same(record.task, task)) issues.push(`${at}: the echoed task is not the scheduled task`)
  if (!same(record.ladderStateAtStart, task.ladderStateAtStart)) issues.push(`${at}: the record's ladder state at start is not the task's`)
  issues.push(...phase2c27bLadderStateIssues(record.ladderStateAtStart).map(i => `${at}: start: ${i}`))
  issues.push(...phase2c27bLadderStateIssues(record.ladderStateAtEnd).map(i => `${at}: end: ${i}`))
  const start = record.ladderStateAtStart, end = record.ladderStateAtEnd
  // Trials: consecutive ladder ordinals, each on a distinct, never-rejected Candidate.
  if (!same(record.trials.map(t => t.trialOrdinal), record.trials.map((_, i) => start.candidateTrialsUsed + i))) issues.push(`${at}: trial ordinals are not consecutive from the ladder state`)
  if (end.candidateTrialsUsed !== start.candidateTrialsUsed + record.trials.length) issues.push(`${at}: candidateTrialsUsed is not start + this unit's trials`)
  if (end.plannerRerunsUsed !== start.plannerRerunsUsed + record.trials.reduce((s, t) => s + t.fullRunsStarted, 0)) issues.push(`${at}: plannerRerunsUsed is not start + this unit's full runs`)
  if (end.candidateTrialsUsed > PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget) issues.push(`${at}: more than ${PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget} cumulative trials`)
  if (end.plannerRerunsUsed > PHASE2C27B_LADDER_BUDGET.maxPlannerReruns) issues.push(`${at}: more than ${PHASE2C27B_LADDER_BUDGET.maxPlannerReruns} cumulative full runs`)
  const rejectedHere = record.trials.filter(t => t.verdict.status === 'rejected').map(t => t.candidateStableKey)
  if (!same(end.previouslyRejectedCandidateStableKeys, [...start.previouslyRejectedCandidateStableKeys, ...rejectedHere])) issues.push(`${at}: the rejected keys are not start + this unit's rejected trials`)
  const trialled = new Set<string>()
  for (const t of record.trials) {
    if (start.previouslyRejectedCandidateStableKeys.includes(t.candidateStableKey)) issues.push(`${at}: a Candidate rejected at a lower rung was trialled again`)
    if (trialled.has(t.candidateStableKey)) issues.push(`${at}: a Candidate was trialled twice`)
    trialled.add(t.candidateStableKey)
    if (t.trialConflictResolutions !== 0) issues.push(`${at}: a trial run received a conflict resolution (G1)`)
    if (t.verdict.status === 'rerun_bound' && t !== record.trials[record.trials.length - 1]) issues.push(`${at}: a trial after a rerun-bound trial`)
    if (t.verdict.status === 'found_R' && t !== record.trials[record.trials.length - 1]) issues.push(`${at}: a trial after a found_R trial`)
  }
  // Deliveries: the action each one had to get, replayed from the ladder state.
  const rejected = new Set(start.previouslyRejectedCandidateStableKeys)
  let trials = start.candidateTrialsUsed, reruns = start.plannerRerunsUsed, stopped = false
  const trialByDelivery = new Map(record.trials.map(t => [t.deliveryIndex, t]))
  record.deliveries.forEach((d, i) => {
    if (d.deliveryIndex !== i) issues.push(`${at}: delivery ${i} carries index ${d.deliveryIndex}`)
    if (stopped) { issues.push(`${at}: a delivery after the consumer stop`); return }
    if (i > 0 && d.estimatedOperationCount < record.deliveries[i - 1]!.estimatedOperationCount) issues.push(`${at}: delivered operation cost decreases at ${i}`)
    const expected = rejected.has(d.stableKey) ? 'skipped_previously_rejected' : trials >= PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget ? 'stopped_by_candidate_trial_bound'
      : reruns >= PHASE2C27B_LADDER_BUDGET.maxPlannerReruns ? 'stopped_by_planner_rerun_bound' : 'trialled'
    if (d.action !== expected) issues.push(`${at}: delivery ${i} action ${d.action} is not ${expected}`)
    if (expected === 'stopped_by_candidate_trial_bound' || expected === 'stopped_by_planner_rerun_bound') { stopped = true; return }
    if (expected !== 'trialled') return
    const t = trialByDelivery.get(i)
    if (!t || t.candidateStableKey !== d.stableKey || d.trialOrdinal !== trials) { issues.push(`${at}: delivery ${i} has no matching trial`); stopped = true; return }
    trials += 1
    reruns += t.fullRunsStarted
    if (t.verdict.status === 'rejected') rejected.add(t.candidateStableKey)
    else stopped = true
  })
  if (trials !== end.candidateTrialsUsed || reruns !== end.plannerRerunsUsed) issues.push(`${at}: the replayed deliveries do not reach the end ladder state`)
  if (!same(record.skippedPreviouslyRejected, record.deliveries.filter(d => d.action === 'skipped_previously_rejected').map(d => d.stableKey))) issues.push(`${at}: skippedPreviouslyRejected is not the skipped deliveries`)
  // The typed outcome against what happened.
  const last = record.trials[record.trials.length - 1]
  const lastDelivery = record.deliveries[record.deliveries.length - 1]
  const expectOutcome = ((): Phase2C27BUnitOutcome | 'inconsistent' => {
    if (last?.verdict.status === 'found_R') return 'found_R'
    if (last?.verdict.status === 'rerun_bound') return 'stopped_by_planner_rerun_bound'
    if (lastDelivery?.action === 'stopped_by_candidate_trial_bound') return 'stopped_by_candidate_trial_bound'
    if (lastDelivery?.action === 'stopped_by_planner_rerun_bound') return 'stopped_by_planner_rerun_bound'
    if (record.search.stoppedByConsumer) return 'inconsistent'
    return record.search.stoppedByExtent ? 'stopped_by_search_extent_bound' : 'not_found_within_search_extent'
  })()
  if (expectOutcome !== record.outcome) issues.push(`${at}: outcome ${record.outcome} is not the recomputed ${expectOutcome}`)
  const consumerStop = record.outcome === 'found_R' || record.outcome === 'stopped_by_candidate_trial_bound' || record.outcome === 'stopped_by_planner_rerun_bound'
  if (consumerStop !== record.search.stoppedByConsumer) issues.push(`${at}: the consumer stop flag disagrees with the outcome`)
  if (record.search.deliveredCandidates !== record.deliveries.length) issues.push(`${at}: the Search delivered count is not the recorded deliveries`)
  if ((record.outcome === 'found_R') !== (record.found !== null)) issues.push(`${at}: found_R without a found Route (or the reverse)`)
  if (record.found && (record.found.candidateStableKey !== last?.candidateStableKey || record.found.trialOrdinal !== last?.trialOrdinal)) issues.push(`${at}: the found Route is not the last trial's Candidate`)
  if (!same(record.excludedRouteKeys.length, 1)) issues.push(`${at}: the excluded Route keys are not exactly the current Route`)
  return issues
}

// ---------------------------------------------------------------- 3. the found_R Route against its reservation (operation level)

/**
 * The Search reservation of one Route, judged operation by operation and independently of the child's check: no Gogma (Reset /
 * Keep) or Skill (conversion / Reset Skills) operation on a blocked position, no predicted Normal production target (the last
 * forge) on a blocked position of its own weapon-type Counter, and no source OwnedWeapon the reservation holds exclusively.
 */
export function phase2c27bRouteReservationCheck(route: { operations: readonly RouteOperation[]; sourceOwnedWeaponId: string | null }, reservation: PlannerAlternativeReservation):
  { respects: boolean; hits: string[] } {
  const hits: string[] = []
  const gogma = new Set(reservation.gogma?.blocked ?? []), skill = new Set(reservation.skill?.blocked ?? [])
  for (const op of route.operations) {
    switch (op.type) {
      case 'reset_bonuses':
      case 'keep_bonuses':
        if (gogma.has(op.gogmaCounterBefore)) hits.push(`gogma:${op.gogmaCounterBefore}`)
        break
      case 'convert_normal_to_gogma':
      case 'reset_skills':
        if (skill.has(op.skillCounterBefore)) hits.push(`skill:${op.skillCounterBefore}`)
        break
      case 'create_normal_artian': {
        if (op.normalCounterAfter === null) break
        const blocked = reservation.normal.find(n => n.counterId === `${op.weaponTypeId}:${op.rarity}`)?.blocked ?? []
        if (blocked.includes(op.normalCounterAfter - 1)) hits.push(`normal:${op.normalCounterAfter - 1}`)
        break
      }
    }
  }
  if (route.sourceOwnedWeaponId !== null && reservation.exclusiveOwnedWeaponIds.includes(route.sourceOwnedWeaponId as never)) hits.push(`exclusive:${route.sourceOwnedWeaponId}`)
  return { respects: hits.length === 0, hits }
}

// ---------------------------------------------------------------- 4. the per-Target class (§9.6)

export type Phase2C27BContextVerdict = 'not_executed' | 'covered_measured' | 'covered_unmeasured' | 'unmeasured_below_covering' | 'trial_bound_below_covering'
  | 'rerun_bound_below_covering' | 'closed_below_covering' | 'extent_bound_at_ladder_top'
  /** Completion of the §9.6 table for a Target stopped by found_R elsewhere: never decides a class (found_R classes come first). */
  | 'escalation_pending_at_target_stop' | 'found_r_below_covering'

export type Phase2C27BTargetClass = 'exact_recovered' | 'found_non_oracle' | 'blocked_by_selected_checkpoint' | 'context_not_reached' | 'searched_not_recovered'
  | 'execution_unmeasured' | 'stopped_by_trial_or_rerun_bound' | 'extent_ladder_insufficient'
export const PHASE2C27B_TARGET_CLASSES: readonly Phase2C27BTargetClass[] = ['exact_recovered', 'found_non_oracle', 'blocked_by_selected_checkpoint', 'context_not_reached',
  'searched_not_recovered', 'execution_unmeasured', 'stopped_by_trial_or_rerun_bound', 'extent_ladder_insufficient']

/** The smallest registered rung whose extent covers a required extent (a null stream needs nothing); null when none does. */
export function phase2c27bCoveringRung(required: { normal: number | null; gogma: number | null; skill: number | null }): Phase2C27BRungId | null {
  const rung = PHASE2C27B_LADDER.find(r => (required.normal ?? 0) <= r.extent.maxNormalAdvance && (required.gogma ?? 0) <= r.extent.maxGogmaAdvance && (required.skill ?? 0) <= r.extent.maxSkillAdvance)
  return rung?.id ?? null
}

/** The verdict of one compatible context from the last unit this run executed for it (§9.6). */
export function phase2c27bContextVerdict(units: readonly { rung: Phase2C27BRungId; result: Phase2C27BUnitResult }[], coveringRung: Phase2C27BRungId | null): Phase2C27BContextVerdict {
  const last = units[units.length - 1]
  if (!last) return 'not_executed'
  const covering = coveringRung === null ? Infinity : rungIndex(coveringRung)
  if (rungIndex(last.rung) >= covering) return last.result.measured ? 'covered_measured' : 'covered_unmeasured'
  if (!last.result.measured) return 'unmeasured_below_covering'
  switch (last.result.outcome) {
    case 'stopped_by_candidate_trial_bound': return 'trial_bound_below_covering'
    case 'stopped_by_planner_rerun_bound': return 'rerun_bound_below_covering'
    case 'not_found_within_search_extent': return 'closed_below_covering'
    case 'found_R': return 'found_r_below_covering'
    case 'stopped_by_search_extent_bound': return last.rung === 'L2' ? 'extent_bound_at_ladder_top' : 'escalation_pending_at_target_stop'
  }
}

export interface Phase2C27BTargetClassInput {
  checkpointBlocked: boolean
  stop: Phase2C27BTargetStop | null
  foundStableKey: string | null
  oracleStableKey: string
  verdicts: readonly Phase2C27BContextVerdict[]
}

/** The exclusive Target class, top to bottom (§9.6). */
export function phase2c27bTargetClass(input: Phase2C27BTargetClassInput): Phase2C27BTargetClass {
  if (input.stop?.stopReason === 'found_R') return input.foundStableKey !== null && input.foundStableKey === input.oracleStableKey ? 'exact_recovered' : 'found_non_oracle'
  if (input.checkpointBlocked || input.stop?.stopReason === 'blocked_by_selected_checkpoint') return 'blocked_by_selected_checkpoint'
  const has = (...v: Phase2C27BContextVerdict[]) => input.verdicts.some(x => v.includes(x))
  if (input.verdicts.every(v => v === 'not_executed')) return 'context_not_reached'
  if (has('covered_measured', 'closed_below_covering')) return 'searched_not_recovered'
  if (has('covered_unmeasured', 'unmeasured_below_covering')) return 'execution_unmeasured'
  if (has('trial_bound_below_covering', 'rerun_bound_below_covering')) return 'stopped_by_trial_or_rerun_bound'
  return 'extent_ladder_insufficient'
}

// ---------------------------------------------------------------- 5. the aggregate decision (§9.7)

export type Phase2C27BDecisionCase = 'B2C27B_INVALID' | 'B2C27B_INCOMPLETE' | 'B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED' | 'B2C27B_E1_PARTIAL' | 'B2C27B_E1_NOT_RECOVERED'

export function phase2c27bDecision(input: { invalidReasons: readonly string[]; unmeasuredUnits: number; requiredNotExecuted: number; exactRecovered: number; targets: number }):
  { case: Phase2C27BDecisionCase; reasons: string[] } {
  if (input.invalidReasons.length > 0) return { case: 'B2C27B_INVALID', reasons: [...input.invalidReasons] }
  const unmeasured = input.unmeasuredUnits + input.requiredNotExecuted
  if (unmeasured > 0) {
    return { case: 'B2C27B_INCOMPLETE', reasons: [`${input.unmeasuredUnits} policy-required unit(s) unmeasured and ${input.requiredNotExecuted} not executed; exact_recovered ${input.exactRecovered} / ${input.targets} is a lower bound`] }
  }
  if (input.exactRecovered === input.targets) return { case: 'B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED', reasons: [] }
  if (input.exactRecovered === 0) return { case: 'B2C27B_E1_NOT_RECOVERED', reasons: [] }
  return { case: 'B2C27B_E1_PARTIAL', reasons: [`exact_recovered ${input.exactRecovered} / ${input.targets}`] }
}

// ---------------------------------------------------------------- 6. the superset diagnostic of an escalated context (§6.2)

/**
 * For every context that ran at two consecutive rungs: the Candidates trialled at the upper rung must be new (never delivered at the
 * lower rung, every one of which was trialled and rejected or skipped there), and each is reported with whether its estimated
 * advance exceeds the lower rung extent on some stream (a diagnostic: the estimate is no Search window authority).
 */
export function phase2c27bEscalationDiagnostics(units: readonly { scheduled: Phase2C27BScheduledUnit; record: Phase2C27BUnitChildRecord | null }[]) {
  const rows: { contextRank: number; fromRung: Phase2C27BRungId; toRung: Phase2C27BRungId; lowerDelivered: number; upperTrialledNew: number; upperTrialledSeenBelow: number;
    upperTrialledEstimateWithinLowerExtent: number }[] = []
  const byContext = new Map<number, { scheduled: Phase2C27BScheduledUnit; record: Phase2C27BUnitChildRecord | null }[]>()
  for (const u of units) byContext.set(u.scheduled.contextRank, [...(byContext.get(u.scheduled.contextRank) ?? []), u])
  for (const [contextRank, list] of byContext) {
    for (let i = 1; i < list.length; i += 1) {
      const lower = list[i - 1]!.record, upper = list[i]!.record
      if (lower?.status !== 'executed' || upper?.status !== 'executed') continue
      const below = new Set(lower.deliveries.map(d => d.stableKey))
      const lowerExtent = lower.task.extent
      const trialled = upper.trials.map(t => upper.deliveries[t.deliveryIndex]!)
      rows.push({ contextRank, fromRung: lower.task.rung, toRung: upper.task.rung, lowerDelivered: below.size,
        upperTrialledNew: trialled.filter(d => !below.has(d.stableKey)).length, upperTrialledSeenBelow: trialled.filter(d => below.has(d.stableKey)).length,
        upperTrialledEstimateWithinLowerExtent: trialled.filter(d => (d.estimatedAdvances.normal ?? 0) <= lowerExtent.maxNormalAdvance && (d.estimatedAdvances.gogma ?? 0) <= lowerExtent.maxGogmaAdvance
          && (d.estimatedAdvances.skill ?? 0) <= lowerExtent.maxSkillAdvance).length })
    }
  }
  return { rows, violations: rows.filter(r => r.upperTrialledSeenBelow > 0).length }
}

/** The Phase 2-C2 summary shape of a found Route, as the post-hoc semantic oracle cross-check reads it. */
export type Phase2C27BFoundSummary = Phase2C2CandidateSummary
