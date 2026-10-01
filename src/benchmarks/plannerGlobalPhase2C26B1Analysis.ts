/**
 * Issue #154 Phase 2-C2.6-B1 post-hoc analysis only. It reads a finished B1 raw run record and, as explicit analyzer
 * arguments AFTER the run ended, the A10 RESULT (parity authority) and the 1,657 oracle evidence (portfolio coverage). It
 * runs no Search, no kernel and no Planner, and feeds no evidence into any calculation. Fields an evidence does not record
 * are never inferred.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2CandidateSummary, Phase2C2SearchStatus } from './plannerGlobalPhase2C2'
import {
  phase2c26b1Completed,
  selectPhase2C26B1Fallback,
  PHASE2C26B1_CAPTURE_BOUND,
  PHASE2C26B1_FALLBACK,
  PHASE2C26B1_STAGE1,
  type Phase2C26B1A10KernelTarget,
  type Phase2C26B1A10Row,
  type Phase2C26B1Context,
  type Phase2C26B1ExecutionClass,
  type Phase2C26B1FallbackSelection,
  type Phase2C26B1ParticipantRow,
  type Phase2C26B1SearchChildRecord,
  type Phase2C26B1SearchTask,
  type Phase2C26B1TargetPortfolio,
  type Phase2C26B1TaskOutcome,
} from './plannerGlobalPhase2C26B1'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'

const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}

// ---------------------------------------------------------------- raw run shape

export interface Phase2C26B1RawRun {
  taskId: string
  executionClass: Phase2C26B1ExecutionClass
  outcome: Phase2C26B1TaskOutcome
  process: { id: string; outcome: string; wallMs: number; executionClass: string | null; budgetMs: number; nodeFlags: string[]; stderrTail: string | null; lastIpcMemory: unknown }
  childWallMs: number | null
  preparationMs: number | null
  memory: unknown
  record: Phase2C26B1SearchChildRecord | null
}

// ---------------------------------------------------------------- formal run validation

export interface Phase2C26B1FormalRunValidation {
  valid: boolean
  failures: string[]
  stage1TaskIdsMatchPlan: boolean
  fallbackMatchesRegisteredSelection: boolean
  executionConditionsMatch: boolean
  processCounts: Record<string, number>
}

/**
 * The raw run is a formal B1 series only when it completed, is no smoke run, measured committed code, ran every planned
 * task in Stage 1 exactly once and in plan order, ran exactly the registered fallback selection recomputed here from its
 * own Stage 1 outcomes (each once), and used exactly the registered execution conditions.
 */
export function validatePhase2C26B1FormalRun(raw: {
  status: string
  environment: { smoke: unknown; uncommittedBenchmarkCode: boolean; stage1: unknown; fallback: unknown; captureBound: number }
  plan: { tasks: Phase2C26B1SearchTask[] }
  participants: string[]
  contexts: { baseline: { orientations: Phase2C2Orientation[] }; contexts: Phase2C26B1Context[] }
  stage1: Pick<Phase2C26B1RawRun, 'taskId' | 'executionClass' | 'outcome'>[]
  fallbackSelection: { selections: Phase2C26B1FallbackSelection[]; noSearchableContext: string[] }
  fallback: Pick<Phase2C26B1RawRun, 'taskId' | 'executionClass' | 'outcome'>[]
  processes: { role: string; executionClass: string | null }[]
}): Phase2C26B1FormalRunValidation {
  const failures: string[] = []
  if (raw.status !== 'completed') failures.push(`raw status ${raw.status}`)
  if (raw.environment.smoke !== null) failures.push('a smoke run')
  if (raw.environment.uncommittedBenchmarkCode) failures.push('uncommitted benchmark code')
  const stage1TaskIdsMatchPlan = stableStringify(raw.stage1.map(run => run.taskId)) === stableStringify(raw.plan.tasks.map(task => task.taskId))
    && raw.stage1.every(run => run.executionClass === 'stage1' && run.outcome.taskId === run.taskId)
  if (!stage1TaskIdsMatchPlan) failures.push('Stage 1 did not run every planned task exactly once in plan order')
  const recomputed = selectPhase2C26B1Fallback(raw.participants, raw.contexts.baseline.orientations, raw.contexts.contexts, raw.plan.tasks, raw.stage1.map(run => run.outcome))
  const fallbackMatchesRegisteredSelection = stableStringify(recomputed) === stableStringify(raw.fallbackSelection)
    && stableStringify(raw.fallback.map(run => run.taskId)) === stableStringify(recomputed.selections.map(s => s.taskId))
    && raw.fallback.every(run => run.executionClass === 'coverage_fallback')
  if (!fallbackMatchesRegisteredSelection) failures.push('the fallback runs are not the registered selection')
  const executionConditionsMatch = stableStringify(raw.environment.stage1) === stableStringify(PHASE2C26B1_STAGE1) && stableStringify(raw.environment.fallback) === stableStringify(PHASE2C26B1_FALLBACK)
    && raw.environment.captureBound === PHASE2C26B1_CAPTURE_BOUND
  if (!executionConditionsMatch) failures.push('the execution conditions are not the registered ones')
  const processCounts = countBy(raw.processes, p => p.role === 'search' ? `search:${p.executionClass}` : p.role)
  if (processCounts.contexts !== 1 || (processCounts['search:stage1'] ?? 0) !== raw.plan.tasks.length || (processCounts['search:coverage_fallback'] ?? 0) !== recomputed.selections.length
    || Object.keys(processCounts).some(key => !['contexts', 'search:stage1', 'search:coverage_fallback'].includes(key))) failures.push('the process list is not one contexts child plus one child per run')
  return { valid: failures.length === 0, failures, stage1TaskIdsMatchPlan, fallbackMatchesRegisteredSelection, executionConditionsMatch, processCounts }
}

// ---------------------------------------------------------------- execution summaries

export function phase2c26b1ExecutionSummary(runs: readonly Pick<Phase2C26B1RawRun, 'outcome'>[]) {
  const completed = runs.filter(run => phase2c26b1Completed(run.outcome))
  return {
    runs: runs.length,
    completed: completed.length,
    timeout: runs.filter(run => run.outcome.process === 'timeout').length,
    outOfMemory: runs.filter(run => run.outcome.process === 'out_of_memory').length,
    processFailure: runs.filter(run => run.outcome.process === 'process_failure').length,
    contextMismatch: runs.filter(run => run.outcome.record === 'context_mismatch').length,
    consumerStop: completed.filter(run => run.outcome.searchStatus === 'consumer_stop').length,
    stoppedByExtent: completed.filter(run => run.outcome.searchStatus === 'stopped_by_extent').length,
    exhausted: completed.filter(run => run.outcome.searchStatus === 'exhausted').length,
    delivered: completed.reduce((sum, run) => sum + (run.outcome.delivered ?? 0), 0),
    deliveredDistribution: countBy(completed, run => String(run.outcome.delivered)),
  }
}

// ---------------------------------------------------------------- kernel trial prefix parity (A10 completed kernels)

export interface Phase2C26B1SearchView {
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  keySha256s: string[]
}

export type Phase2C26B1PrefixResult = 'match' | 'mismatch' | 'not_comparable'

/**
 * One A10 kernel Target against the B1 Search of the same context. The kernel trials its delivered Candidates in order,
 * so its trial key sequence must be the B1 delivery prefix; the B1 Search cannot end before the kernel's delivery count;
 * and when the kernel's Search ended by itself below the capture bound, the B1 Search must end the same way with the same
 * delivered / excluded counts. Not comparable: the kernel did not search, or the B1 Search of that context did not complete.
 */
export function comparePhase2C26B1KernelPrefix(kernel: Phase2C26B1A10KernelTarget, b1: Phase2C26B1SearchView | null, captureBound: number):
  { result: Phase2C26B1PrefixResult; reasons: string[]; comparedTrials: number; endComparison: boolean } {
  if (!kernel.searched || kernel.search === null) return { result: 'not_comparable', reasons: ['kernel_did_not_search'], comparedTrials: 0, endComparison: false }
  if (b1 === null) return { result: 'not_comparable', reasons: ['b1_search_not_completed'], comparedTrials: 0, endComparison: false }
  const reasons: string[] = []
  kernel.trials.forEach((trial, index) => {
    if (b1.keySha256s[index] !== trial.candidateKeySha256) reasons.push(`trial ${index} key differs from B1 delivery ${index}`)
  })
  const lastTrial = kernel.trials.at(-1)
  if (kernel.foundKeySha256 !== null && kernel.foundKeySha256 !== lastTrial?.candidateKeySha256) reasons.push('the found key is not the last trial key')
  const kernelDelivered = kernel.search.deliveredCandidates
  if (b1.summary.deliveredCandidates !== b1.keySha256s.length) reasons.push('B1 delivered count differs from its captured keys')
  if (!b1.summary.stoppedByConsumer && b1.summary.deliveredCandidates < Math.min(kernelDelivered, captureBound)) reasons.push('B1 ended before the kernel delivery count')
  const endComparison = !kernel.search.stoppedByConsumer && kernelDelivered < captureBound
  if (endComparison) {
    if (b1.summary.stoppedByConsumer || b1.summary.deliveredCandidates !== kernelDelivered || b1.summary.excludedCandidates !== kernel.search.excludedCandidates
      || b1.summary.exhausted !== kernel.search.exhausted || b1.summary.stoppedByExtent !== kernel.search.stoppedByExtent) reasons.push('the kernel Search ended by itself; B1 did not end the same way')
  }
  return { result: reasons.length === 0 ? 'match' : 'mismatch', reasons, comparedTrials: kernel.trials.length, endComparison }
}

export interface Phase2C26B1PrefixRow {
  orientationId: string
  targetWeaponId: string
  taskId: string | null
  result: Phase2C26B1PrefixResult
  reasons: string[]
  comparedTrials: number
  endComparison: boolean
  kernelOutcome: string
}

/** Every Target of every A10 completed kernel, mapped through its (orientation, Target) alias to the B1 task that searched it. */
export function phase2c26b1KernelPrefixParity(rows: readonly Phase2C26B1A10Row[], tasks: readonly Phase2C26B1SearchTask[], searchByTaskId: ReadonlyMap<string, Phase2C26B1SearchView>, captureBound: number) {
  const taskOf = new Map<string, string>()
  for (const task of tasks) for (const alias of task.aliases) taskOf.set(`${alias.orientationId}\u0000${task.targetWeaponId}`, task.taskId)
  const out: Phase2C26B1PrefixRow[] = []
  for (const row of rows) {
    if (!row.kernelCompleted) continue
    for (const target of row.targets) {
      const taskId = taskOf.get(`${row.orientationId}\u0000${target.targetWeaponId}`) ?? null
      const compared = comparePhase2C26B1KernelPrefix(target, taskId === null ? null : searchByTaskId.get(taskId) ?? null, captureBound)
      out.push({ orientationId: row.orientationId, targetWeaponId: target.targetWeaponId, taskId, ...compared, kernelOutcome: target.outcome })
    }
  }
  return { rows: out, totals: countBy(out, r => r.result), mismatches: out.filter(r => r.result === 'mismatch'),
    trialsCompared: out.filter(r => r.result === 'match').reduce((sum, r) => sum + r.comparedTrials, 0), endComparisons: out.filter(r => r.result === 'match' && r.endComparison).length }
}

// ---------------------------------------------------------------- kernel metadata of portfolio Candidates

/** The A10 kernel judgement of a portfolio Candidate in a context that observed it (same orientation, Target and key). Metadata only. */
export function phase2c26b1KernelMetadata(rows: readonly Phase2C26B1A10Row[], targetWeaponId: string, keySha256: string, observedOrientationIds: readonly string[]) {
  const out: { orientationId: string; status: 'kernel_found' | 'kernel_trial_rejected'; reason: string | null; generatedSelected: boolean | null }[] = []
  for (const row of rows) {
    if (!row.kernelCompleted || !observedOrientationIds.includes(row.orientationId)) continue
    for (const target of row.targets) {
      if (target.targetWeaponId !== targetWeaponId) continue
      for (const trial of target.trials) {
        if (trial.candidateKeySha256 !== keySha256) continue
        out.push({ orientationId: row.orientationId, status: trial.result === 'found' ? 'kernel_found' : 'kernel_trial_rejected', reason: trial.reason, generatedSelected: trial.generatedSelected })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- portfolio summary

const distribution = (values: readonly number[]) => countBy(values, value => String(value))

export function phase2c26b1PortfolioSummary(portfolio: readonly Phase2C26B1TargetPortfolio[], participants: readonly string[], exploredTargets: ReadonlySet<string>) {
  const participantSet = new Set(participants)
  const rows = portfolio.filter(p => participantSet.has(p.targetWeaponId))
  const explored = rows.filter(p => exploredTargets.has(p.targetWeaponId))
  const alternatives = portfolio.flatMap(p => p.candidates.filter(c => c.origin === 'alternative'))
  const heldAlternatives = alternatives.filter(c => c.summary.heldRoute)
  const lateStart = (summary: Phase2C2CandidateSummary) => Boolean(summary.gogma?.startsAfterOrigin || summary.skill?.startsAfterOrigin || summary.normal?.startsAfterOrigin)
  return {
    targets: portfolio.length,
    conflictParticipants: rows.length,
    exploredParticipants: explored.length,
    uniqueCandidates: portfolio.reduce((sum, p) => sum + p.candidates.length, 0),
    originals: portfolio.reduce((sum, p) => sum + p.candidates.filter(c => c.origin === 'original').length, 0),
    uniqueAlternatives: alternatives.length,
    portfolioSizeDistribution: distribution(portfolio.map(p => p.diversity.candidates)),
    participantPortfolioSizeDistribution: distribution(rows.map(p => p.diversity.candidates)),
    targetsWithMultiple: portfolio.filter(p => p.has.multipleCandidates).length,
    participantsWithMultiple: rows.filter(p => p.has.multipleCandidates).length,
    participantsWithSourceAlternative: rows.filter(p => p.has.sourceAlternative).length,
    participantsWithCounterPositionAlternative: rows.filter(p => p.has.counterPositionAlternative).length,
    participantsWithHeldRoute: rows.filter(p => p.has.heldRoute).length,
    participantsWithReservationRespectingAlternative: rows.filter(p => p.has.reservationRespectingAlternative).length,
    reservationViolations: alternatives.reduce((sum, c) => sum + c.provenance.filter(x => !x.respectsReservation).length, 0),
    heldRoutes: {
      heldAlternativeCandidates: heldAlternatives.length,
      targetsWithHeldAlternative: portfolio.filter(p => p.candidates.some(c => c.origin === 'alternative' && c.summary.heldRoute)).length,
      originalHeldRoutes: portfolio.filter(p => p.candidates.some(c => c.origin === 'original' && c.summary.heldRoute)).length,
      heldAlternativesByFallbackOnly: heldAlternatives.filter(c => c.provenance.every(x => x.executionClass === 'coverage_fallback')).length,
    },
    lateStartRoutes: {
      /** An own unit on some stream starts after that stream's Planner-start origin. */
      alternativeCandidates: alternatives.filter(c => lateStart(c.summary)).length,
      gogma: alternatives.filter(c => c.summary.gogma?.startsAfterOrigin).length,
      skill: alternatives.filter(c => c.summary.skill?.startsAfterOrigin).length,
      normal: alternatives.filter(c => c.summary.normal?.startsAfterOrigin).length,
    },
    alternativesByExecutionClass: {
      stage1: alternatives.filter(c => c.provenance.some(x => x.executionClass === 'stage1')).length,
      coverageFallbackOnly: alternatives.filter(c => c.provenance.every(x => x.executionClass === 'coverage_fallback')).length,
    },
    byPrefix: Object.fromEntries(['1', '2', '4', '8'].map(k => [k, {
      participantsWithMultiple: rows.filter(p => p.diversityByDefaultPrefix[k].candidates > 1).length,
      candidateTotal: portfolio.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].candidates, 0),
      participantCandidateTotal: rows.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].candidates, 0),
      heldRoutes: portfolio.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].heldRoutes, 0),
      participantHeldRoutes: rows.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].heldRoutes, 0),
    }])),
  }
}

// ---------------------------------------------------------------- decision (registered before the formal run)

export type Phase2C26B1DecisionCase = 'B1_M_measurement_complete' | 'B1_I_measurement_incomplete' | 'B1_S_semantic_failure'

export const PHASE2C26B1_DECISION_RULE = {
  order: [
    'B1-S semantic_failure: any A10 authority / A9 chain mismatch, baseline / orientation / condition parity failure, pre-Search context parity failure (A10 comparable fields), a re-derived context mismatch in a Search child, a kernel trial prefix mismatch, or a Search-delivered Candidate violating its own reservation',
    'B1-M measurement_complete: every Conflict participant explored (a Search context of its Target ended normally: consumer stop, extent stop or exhaustion, Candidate 0 included) and no participant left unexplored by an out-of-memory / process failure',
    'B1-I measurement_incomplete: otherwise (some participant has only timeout / out-of-memory / process-failure contexts after the coverage fallback)',
  ],
  note: 'Low portfolio diversity is never a semantic failure. B1 is default-extent only: it decides no final C3 readiness (A / B / C).',
} as const

export const PHASE2C26B1_RECOMMENDATION: Record<Phase2C26B1DecisionCase, string> = {
  B1_M_measurement_complete: '全Conflict participantについて少なくとも1つのdefault-extent Search contextが正常終了した（participant measurement coverageの事前登録名称であり、全Search context完走を意味しない）。B2で未完走default context・extent不足・reservation / context制約を切り分け、extent probe・oracle coverage gap・held / late-start不足・single fixed winner reservationの限界を評価する',
  B1_I_measurement_incomplete: 'final diversity / C3判断へ進まず、残participantのSearch completion方法を検討する',
  B1_S_semantic_failure: '次へ進まず原因調査',
}

// ---------------------------------------------------------------- post-hoc interpretation of the observed portfolio

/**
 * What the observed portfolio can and cannot say per participant. Explored means at least one Search context of the Target
 * ended normally; it never means every context of the Target completed. A timeout / OOM / failed context is never read as
 * Candidate 0, so a portfolio of size 1 confirms "no alternative in the default extent" only when every derived context of
 * the Target ended normally in Stage 1; with an unfinished context left, the absence is observed, not confirmed.
 */
export function phase2c26b1PortfolioObservation(rows: readonly Phase2C26B1ParticipantRow[], portfolioSizeByTarget: ReadonlyMap<string, number>) {
  const unfinished = (row: Phase2C26B1ParticipantRow) => Object.entries(row.stage1).filter(([label]) => !label.startsWith('completed:')).reduce((sum, [, count]) => sum + count, 0)
  const classify = (row: Phase2C26B1ParticipantRow) => {
    const size = portfolioSizeByTarget.get(row.targetWeaponId)
    if (size === undefined) throw new Error(`No portfolio for participant ${row.targetWeaponId}.`)
    const unfinishedStage1Contexts = unfinished(row)
    const allStage1ContextsCompleted = row.tasks > 0 && unfinishedStage1Contexts === 0
    return { targetWeaponId: row.targetWeaponId, portfolioSize: size, explored: row.explored, exploredBy: row.exploredBy, stage1Tasks: row.tasks, unfinishedStage1Contexts, allStage1ContextsCompleted,
      /** Only with every derived default-extent context completed is "no alternative" more than an observation. */
      noAlternativeConfirmedInDefaultExtent: size === 1 && row.explored && allStage1ContextsCompleted }
  }
  const participants = rows.map(classify)
  const singletons = participants.filter(p => p.portfolioSize === 1)
  const multiple = participants.filter(p => p.portfolioSize > 1)
  return {
    note: 'explored = at least one default-extent Search context of the Target ended normally (Candidate 0 included); it is not every context completed. '
      + 'Timeout contexts are never Candidate 0: portfolio size, diversity and oracle coverage are observations over the contexts that ended normally, '
      + 'and a size-1 portfolio with an unfinished context does not confirm the absence of an alternative in the default extent.',
    participantsWithUnfinishedStage1Contexts: participants.filter(p => p.unfinishedStage1Contexts > 0).length,
    singleton: {
      participants: singletons.length,
      withUnfinishedStage1Contexts: singletons.filter(p => p.unfinishedStage1Contexts > 0).length,
      allStage1ContextsCompleted: singletons.filter(p => p.allStage1ContextsCompleted).length,
      exploredOnlyByFallback: singletons.filter(p => p.exploredBy === 'coverage_fallback').length,
      noAlternativeConfirmedInDefaultExtent: singletons.filter(p => p.noAlternativeConfirmedInDefaultExtent).length,
      unresolvedCauses: ['default-extent context unfinished within the Stage 1 budget', 'outside the Production default extent', 'single fixed winner reservation / context constraint'],
    },
    multiple: {
      participants: multiple.length,
      withUnfinishedStage1Contexts: multiple.filter(p => p.unfinishedStage1Contexts > 0).length,
      note: 'The count of participants with portfolio > 1 is the one observed in this run; unfinished contexts may add Candidates, so it is not an upper bound of the default-extent diversity.',
    },
    participants,
  }
}

export function phase2c26b1Decision(input: { semanticFailures: readonly string[]; participantsTotal: number; participantsExplored: number; unexploredWithOomOrFailure: number }) {
  const { participantsTotal: total, participantsExplored: explored, unexploredWithOomOrFailure } = input
  if (![total, explored, unexploredWithOomOrFailure].every(v => Number.isInteger(v) && v >= 0) || explored > total || unexploredWithOomOrFailure > total - explored || total === 0) {
    throw new Error(`Inconsistent Phase 2-C2.6-B1 decision input: ${JSON.stringify(input)}`)
  }
  const caseId: Phase2C26B1DecisionCase = input.semanticFailures.length > 0 ? 'B1_S_semantic_failure'
    : explored === total && unexploredWithOomOrFailure === 0 ? 'B1_M_measurement_complete' : 'B1_I_measurement_incomplete'
  return { case: caseId, reasons: [...input.semanticFailures], participants: `${explored}/${total}`, recommendation: PHASE2C26B1_RECOMMENDATION[caseId] }
}

/** Collects the registered semantic failure conditions. Portfolio diversity never enters. */
export function phase2c26b1SemanticFailures(input: {
  authorityValid: boolean
  a9ChainMatches: boolean
  baselineParityValid: boolean
  conditionParityValid: boolean
  contextParityValid: boolean
  contextMismatchTasks: number
  kernelPrefixMismatches: number
  reservationViolations: number
}): string[] {
  const out: string[] = []
  if (!input.authorityValid) out.push('a10_authority_invalid')
  if (!input.a9ChainMatches) out.push('a9_chain_mismatch')
  if (!input.baselineParityValid) out.push('baseline_or_orientation_parity_failure')
  if (!input.conditionParityValid) out.push('condition_parity_failure')
  if (!input.contextParityValid) out.push('pre_search_context_parity_failure')
  if (input.contextMismatchTasks > 0) out.push('search_child_context_mismatch')
  if (input.kernelPrefixMismatches > 0) out.push('kernel_trial_prefix_mismatch')
  if (input.reservationViolations > 0) out.push('reservation_violation')
  return out
}
