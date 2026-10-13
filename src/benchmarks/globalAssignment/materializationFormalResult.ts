/**
 * Issue #154 Global Assignment Phase D-0C (Research only; never imported by the app).
 *
 * The public RESULT of a D-0C run (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md`): an audit aggregate derived mechanically from
 * the runner's raw outputs (the aggregated RESULT and the child records, kept git-ignored under `.local/`), never a copy of them and
 * never a new measurement. The Repository is public, so it carries provenance, validity, reproducibility, counts, sums, maxima and
 * stage times only: no Target / OwnedWeapon / Entry identifier, no Candidate snapshot, no RouteOperation list, no Target-level
 * Counter position, no Export content, and no source-to-Target correspondence (the minimization checks below enforce it).
 *
 * `d0cPublicResultIssues()` re-derives the RESULT from the same raw sources and compares it, checks that the semantic SHA-256 the
 * runner recorded for each measured run is the hash of that run's record, that the runner's materialization outcome is the one the
 * records give, and runs the minimization checks. The script computes the file and semantic hashes (this module reads no file).
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import { summarizeD0cMaterializationOutcome, type CalculationCodeAuditReading, type D0cFormalValidity, type D0cMaterializationOutcome } from './materializationFormal'
import type { ConfirmedProgress } from './materializationProtocol'
import { summarizeMaterializationRun, type AttemptSummary, type MaterializationObservedRecord, type MaterializationSemanticRecord, type ShapeAttemptSummary } from './materializationRunner'

export const D0C_PUBLIC_RESULT_KIND = 'global-assignment-d0c-public-result'
export const D0C_PUBLIC_RESULT_REVISION = 1
export const D0C_PUBLIC_RESULT_DERIVATION_SCRIPT = 'scripts/derive-planner-global-assignment-d0c-result.mjs'

/** A raw source of the derivation, as the script hashed it (the name is relative to the run's `.local` location, never absolute). */
export interface D0cSourceFile {
  file: string
  bytes: number
  sha256: string
}

/** The fields of a child record the derivation reads (the record itself stays in `.local`). */
export interface D0cChildRecord {
  mode: string
  protocolVersion: string
  rngEngineVersion: string
  calculationContext: Record<string, unknown>
  semantic: MaterializationSemanticRecord
  observed: MaterializationObservedRecord & { setupMs: number; wallMs: number; eventLoopYields: number }
  memory: {
    maxima: { heapUsed: number; heapTotal: number; rss: number; external: number; samples: number }
    heapSizeLimit: number
    maxRssKiB: number
    targets?: { orderIndex: number; settled: { heapUsed: number; rss: number }; sampledMax: { heapUsed: number; rss: number } }[]
  }
}

export interface D0cRunnerOutputRun {
  id: string
  status: 'measured' | 'unmeasured'
  reason: string | null
  recordFile: string | null
  semanticSha256: string | null
  recordComplete: boolean | null
  recordConsistent: boolean | null
  childGatePassed: boolean | null
  calculationContextMatched: boolean | null
  confirmedProgress?: ConfirmedProgress | { unreadable: string }
}

/** The fields of the runner's aggregated RESULT the derivation reads. */
export interface D0cRunnerOutput {
  protocolVersion: string
  phase: string
  mode: 'smoke' | 'formal'
  nature: string
  oracleFreeExecution: boolean
  oracleInformedDesign: boolean
  repositoryHeadSha: string
  registrationHead?: string
  workingTreeClean: boolean
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  calculationAudit?: CalculationCodeAuditReading
  registrationDoc?: { source: string; sha256: string | null }
  runnerScript: string
  node: string
  v8: string
  exportVerification: Record<string, unknown> & { actual: { fileName: string; bytes: number; sha256: string } }
  plannerInputMaxPlanStepsForValidationOnly: number
  conditions: Record<string, unknown>
  envelope: Record<string, unknown>
  conditionBasis: Record<string, string>
  overrideOptions?: string[]
  smokeOverrides?: string[]
  formalRegistration: Record<string, unknown>
  launchedAt: string
  machine: Record<string, unknown>
  status: string
  formalValidity: D0cFormalValidity
  materializationOutcome: D0cMaterializationOutcome
  runs: D0cRunnerOutputRun[]
  determinism: { runs: number; measuredRuns: number; identical: boolean | null; semanticSha256s: string[] }
  processes: { id: string; outcome: string; exitCode: number | null; signal: string | null; timedOut: boolean; cancelled: boolean; settledBy: string; wallObservedMs: number; wallMs: number; heapMb: number; startedAt: string; recordWritten: boolean }[]
  integrityIssues: string[]
  totalWallMs: number
  claims: string
}

export interface D0cPublicResultSources {
  output: D0cRunnerOutput
  /** The measured runs' child records, by run id. */
  records: readonly { id: string; record: D0cChildRecord }[]
  files: readonly D0cSourceFile[]
  /** SHA-256 of `JSON.stringify(record.semantic)` per measured run id (the runner's own rule), computed by the script. */
  semanticSha256ByRun: Readonly<Record<string, string>>
}

/** A raw source that does not have the shape the derivation reads: the derivation stops (never fills a value in). */
export class D0cPublicResultSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'D0cPublicResultSourceError'
  }
}

interface Stat { count: number; sum: number; min: number | null; max: number | null }
function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { count: 0, sum: 0, min: null, max: null }
  return { count: values.length, sum: values.reduce((sum, value) => sum + value, 0), min: Math.min(...values), max: Math.max(...values) }
}
const round = (value: number, digits = 3) => Number(value.toFixed(digits))
function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1
  return counts
}
function sortedRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]!]))
}
const isShapeAttempt = (attempt: AttemptSummary | ShapeAttemptSummary): attempt is ShapeAttemptSummary => attempt.method === 'shape_constrained'

function assertSources(sources: D0cPublicResultSources): void {
  const output = sources.output as unknown as Record<string, unknown> | null
  if (typeof output !== 'object' || output === null) throw new D0cPublicResultSourceError('The aggregated RESULT is not an object.')
  for (const key of ['mode', 'formalValidity', 'materializationOutcome', 'runs', 'determinism', 'processes', 'integrityIssues', 'conditions', 'envelope', 'exportVerification', 'repositoryHeadSha', 'benchmarkCodeSha256']) {
    if (!(key in output)) throw new D0cPublicResultSourceError(`The aggregated RESULT has no ${key}.`)
  }
  for (const run of sources.output.runs.filter(run => run.status === 'measured')) {
    const entry = sources.records.find(value => value.id === run.id)
    if (entry === undefined) throw new D0cPublicResultSourceError(`No record was given for the measured run ${run.id}.`)
    for (const key of ['semantic', 'observed', 'memory'] as const) if (typeof entry.record?.[key] !== 'object' || entry.record[key] === null) throw new D0cPublicResultSourceError(`The record of ${run.id} has no ${key}.`)
  }
}

/** Every Target / OwnedWeapon / Entry identifier and per-Target hash a record carries (none may appear in the public RESULT). */
export function collectRecordIdentifiers(records: readonly { record: D0cChildRecord }[]): string[] {
  const identifiers = new Set<string>()
  const add = (value: unknown) => { if (typeof value === 'string' && value.length > 0) identifiers.add(value) }
  for (const { record } of records) {
    for (const candidate of record.semantic.candidates) {
      for (const id of candidate.candidate.materializationOrder) add(id)
      for (const id of candidate.notAttemptedTargetWeaponIds) add(id)
      add(candidate.firstUnresolved?.targetWeaponId)
      add(candidate.failClosed?.targetWeaponId)
      for (const target of candidate.targets) {
        add(target.targetWeaponId)
        add(target.option.sourceOwnedWeaponId)
        if (target.outcome.kind === 'materialized') { add(target.outcome.entryId); add(target.outcome.entrySemanticHash) }
        for (const attempt of target.attempts) {
          if (attempt.result.kind === 'materialized' && 'entryId' in attempt.result) { add(attempt.result.entryId); add(attempt.result.entrySemanticHash) }
          if (isShapeAttempt(attempt)) {
            add(attempt.searchIdentity)
            const base = attempt.routeShape.base
            if (base.kind !== 'new_normal') add(base.ownedWeaponId)
          }
        }
      }
    }
  }
  return [...identifiers].sort()
}

function redact(message: string, identifiers: readonly string[]): string {
  let text = message
  for (const identifier of identifiers) text = text.split(identifier).join('<redacted>')
  return text
}

/** A copy of plain data with every record identifier inside its strings redacted (issue messages may name a Target). */
function redactDeep<T>(value: T, identifiers: readonly string[]): T {
  if (typeof value === 'string') return redact(value, identifiers) as T
  if (Array.isArray(value)) return value.map(item => redactDeep(item, identifiers)) as T
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, identifiers)])) as T
  return value
}

function memoryOf(record: D0cChildRecord) {
  const targets = record.memory.targets ?? []
  return {
    heapUsedMax: record.memory.maxima.heapUsed, heapTotalMax: record.memory.maxima.heapTotal, rssMax: record.memory.maxima.rss, externalMax: record.memory.maxima.external,
    sampleCount: record.memory.maxima.samples, maxRssKiB: record.memory.maxRssKiB, heapSizeLimit: record.memory.heapSizeLimit,
    targetSettledHeapUsed: (({ count, min, max }) => ({ count, min, max }))(stat(targets.map(target => target.settled.heapUsed))),
    targetSampledMax: { heapUsed: stat(targets.map(target => target.sampledMax.heapUsed)).max, rss: stat(targets.map(target => target.sampledMax.rss)).max },
  }
}

function timingOf(record: D0cChildRecord) {
  const elapsed = record.observed.elapsedMs
  const candidate = elapsed.candidates[0] ?? null
  const targets = candidate?.targets ?? []
  const semanticTargets = record.semantic.candidates[0]?.targets ?? []
  const methodOf = (orderIndex: number) => {
    const target = semanticTargets.find(value => value.orderIndex === orderIndex)
    return target?.outcome.kind === 'materialized' ? target.outcome.method : null
  }
  const shape = targets.filter(target => methodOf(target.orderIndex) === 'shape_constrained' && target.shapeTimeline?.shapeInspectedMs != null)
  const projected = targets.filter(target => methodOf(target.orderIndex) === 'candidate_search_projected')
  return {
    setupMs: round(record.observed.setupMs), wallMs: round(record.observed.wallMs), eventLoopYields: record.observed.eventLoopYields,
    stagesMs: {
      context: round(elapsed.context), reachTable: elapsed.reachTable === null ? null : round(elapsed.reachTable), structuralSearch: elapsed.structuralSearch === null ? null : round(elapsed.structuralSearch),
      toFirstStructuralCandidate: elapsed.toFirstStructuralCandidate === null ? null : round(elapsed.toFirstStructuralCandidate),
      diagnostics: candidate === null ? null : round(candidate.diagnostics), materialization: candidate === null ? null : round(candidate.materialization), total: round(elapsed.total),
    },
    targetMs: roundStat(stat(targets.map(target => target.ms))),
    projectedTargetMs: roundStat(stat(projected.map(target => target.ms))),
    /** Design D0A2 / D-0B-2 shapeTimeline: Search ≈ shape inspection − projected inspection; Route checks ≈ settle − shape inspection. */
    shapeConstrainedSearchMsApprox: roundStat(stat(shape.map(target => target.shapeTimeline!.shapeInspectedMs! - (target.shapeTimeline!.projectedInspectedMs ?? 0)))),
    shapeConstrainedRouteCheckMsApprox: roundStat(stat(shape.map(target => target.ms - target.shapeTimeline!.shapeInspectedMs!))),
  }
}
function roundStat(value: Stat): Stat {
  return { count: value.count, sum: round(value.sum), min: value.min === null ? null : round(value.min), max: value.max === null ? null : round(value.max) }
}

function searchScaleOf(semantic: MaterializationSemanticRecord) {
  const attempts = semantic.candidates.flatMap(candidate => candidate.targets.flatMap(target => target.attempts))
  const projected = attempts.filter((attempt): attempt is AttemptSummary => attempt.method === 'candidate_search_projected')
  const shape = attempts.filter(isShapeAttempt)
  const executed = shape.filter(attempt => attempt.observed !== null)
  const predictedMax = (pick: (attempt: ShapeAttemptSummary) => number) => stat(shape.map(pick)).max
  const observed = (pick: (observed: NonNullable<ShapeAttemptSummary['observed']>) => number) => stat(executed.map(attempt => pick(attempt.observed!)))
  const ratios = executed.filter(attempt => attempt.observed!.instrumentation.gogmaGeneratedStates > 0)
    .map(attempt => attempt.predictedSearchScale.gogma.generatedStateUpperBound / attempt.observed!.instrumentation.gogmaGeneratedStates)
  const budgetExceeded: Record<string, number> = {}
  for (const attempt of executed) for (const component of attempt.observed!.stop.budgetExceeded) budgetExceeded[component] = (budgetExceeded[component] ?? 0) + 1
  return {
    projected: {
      attempts: projected.length,
      matched: projected.filter(attempt => attempt.result.kind === 'materialized').length,
      notExecuted: projected.filter(attempt => attempt.result.kind === 'not_executed').length,
      predictedMax: {
        conversionPositions: stat(projected.map(attempt => attempt.predictedSearchScale.conversionPositions)).max,
        gogmaLegalWidth: stat(projected.map(attempt => attempt.predictedSearchScale.gogmaLegalWidth)).max,
        skillLegalWidth: stat(projected.map(attempt => attempt.predictedSearchScale.skillLegalWidth)).max,
        normalForgeCount: stat(projected.map(attempt => attempt.predictedSearchScale.normalForgeCount)).max,
      },
    },
    shapeConstrained: {
      attempts: shape.length,
      executed: executed.length,
      gateRefused: shape.filter(attempt => attempt.result.kind === 'not_executed').length,
      premiseViolations: shape.reduce((sum, attempt) => sum + attempt.premiseViolations.length, 0),
      predictedMax: {
        depthUpperBound: predictedMax(attempt => attempt.predictedSearchScale.depthUpperBound),
        gogmaGeneratedStateUpperBound: predictedMax(attempt => attempt.predictedSearchScale.gogma.generatedStateUpperBound),
        normalForgeCount: predictedMax(attempt => attempt.predictedSearchScale.normalForgeCount),
        conversionWalkPositions: predictedMax(attempt => attempt.predictedSearchScale.preBase.conversionWalkPositions),
      },
      observed: {
        deliveredCandidates: observed(value => value.deliveredCandidates),
        gogmaGeneratedStates: observed(value => value.instrumentation.gogmaGeneratedStates),
        gogmaDepths: observed(value => value.instrumentation.gogmaDepths),
        maxGogmaFrontierStates: observed(value => value.instrumentation.maxGogmaFrontierStates),
        skillStates: observed(value => value.instrumentation.skillStates),
        skillDepths: observed(value => value.instrumentation.skillDepths),
        workSettled: observed(value => value.instrumentation.workSettled),
        predictions: {
          normalArtian: observed(value => value.searchPredictions.normalArtian), skill: observed(value => value.searchPredictions.skill),
          gogmaReset: observed(value => value.searchPredictions.gogmaReset), gogmaKeep: observed(value => value.searchPredictions.gogmaKeep),
          supportQueries: observed(value => value.searchPredictions.supportQueries),
        },
      },
      stops: countBy(executed.map(attempt => attempt.observed!.stop.by)),
      budgetExceededComponents: sortedRecord(budgetExceeded),
      upperBoundToObservedGogmaStates: { count: ratios.length, min: ratios.length === 0 ? null : round(Math.min(...ratios), 2), max: ratios.length === 0 ? null : round(Math.max(...ratios), 2) },
    },
  }
}

function routeVerificationOf(semantic: MaterializationSemanticRecord) {
  const checks = semantic.candidates.flatMap(candidate => candidate.targets.flatMap(target => target.attempts)).filter(isShapeAttempt).map(attempt => attempt.routeChecks).filter(value => value !== null)
  const sum = (pick: (check: (typeof checks)[number]) => number) => checks.reduce((total, check) => total + pick(check), 0)
  return {
    checkedAttempts: checks.length,
    passed: checks.filter(check => check.passed).length,
    failed: checks.filter(check => !check.passed).length,
    issueCodes: countBy(checks.flatMap(check => check.issues.map(issue => issue.code))),
    checkedOperations: stat(checks.map(check => check.checkedOperations)),
    predictions: {
      normalArtian: sum(check => check.predictions.normalArtian), skill: sum(check => check.predictions.skill), gogmaReset: sum(check => check.predictions.gogmaReset),
      gogmaKeep: sum(check => check.predictions.gogmaKeep), supportQueries: sum(check => check.predictions.supportQueries),
    },
  }
}

function methodSelectionOf(semantic: MaterializationSemanticRecord) {
  const targets = semantic.candidates.flatMap(candidate => candidate.targets)
  const rules: string[] = []
  let continuationShapes = 0, policyShapes = 0, projectedFellBackToShape = 0
  for (const target of targets) {
    const selection = target.selection
    if (selection === null || !('materializationRule' in selection)) continue
    rules.push(selection.rule)
    if (selection.continuation !== null) continuationShapes += 1
    if (selection.policyShape !== null) policyShapes += 1
    if (selection.rule === 'continuous_projected_then_shape_constrained' && target.attempts.some(isShapeAttempt)) projectedFellBackToShape += 1
  }
  return { rules: countBy(rules), continuationShapes, policyShapesTakenOn: policyShapes, projectedFellBackToShape }
}

function structuralOf(semantic: MaterializationSemanticRecord) {
  const search = semantic.structuralSearch
  const diagnostics = search?.diagnostics ?? null
  return search === null || diagnostics === null ? null : {
    outcome: structuredClone(search.outcome),
    windowDecision: { action: search.windowDecision.action, conclusion: search.windowDecision.conclusion, ladderExhausted: search.windowDecision.ladderExhausted, concludesInfeasibility: search.windowDecision.concludesInfeasibility },
    candidatesCollected: search.candidatesCollected, unexploredBranchesRemain: search.unexploredBranchesRemain, upperBoundSupplied: search.upperBoundSupplied,
    resource: {
      expandedNodes: diagnostics.resource.expandedNodes, maxDepth: diagnostics.resource.maxDepth, candidates: diagnostics.resource.candidates, rejections: sortedRecord(diagnostics.resource.rejections as unknown as Record<string, number>),
      pruned: diagnostics.resource.pruned, deadEnds: diagnostics.resource.deadEnds, completeness: diagnostics.resource.completeness,
    },
    completeAssignmentsInspected: diagnostics.completeAssignmentsInspected, coverageRejections: diagnostics.coverageRejections, coverageFeasible: diagnostics.coverageFeasible,
    coverageDrivenOrdering: {
      enabled: diagnostics.coverageDrivenOrdering.enabled, phaseActivations: diagnostics.coverageDrivenOrdering.phaseActivations, priorityDeliveries: diagnostics.coverageDrivenOrdering.priorityDeliveries,
      prioritySkips: diagnostics.coverageDrivenOrdering.prioritySkips, baseSkips: diagnostics.coverageDrivenOrdering.baseSkips, priorityChanges: diagnostics.coverageDrivenOrdering.priorityChanges,
    },
    structuralCandidates: diagnostics.structuralCandidates, replayPredictions: { ...diagnostics.replayPredictions },
  }
}

function candidateOf(semantic: MaterializationSemanticRecord) {
  const record = semantic.candidates[0]
  if (record === undefined) return null
  const candidate = record.candidate
  const origins = semantic.reachTable.status === 'reach_table' ? semantic.reachTable.summary.origins : null
  const normalEnds = Object.entries(candidate.streamEnd.normal)
  const summary = summarizeMaterializationRun(semantic).candidates[0]!
  const { targets: plannerStartIdealTargets, ...plannerStartIdealCounts } = summary.plannerStartIdeal
  return {
    ordinal: candidate.ordinal, objective: candidate.objective, targetCount: candidate.materializationOrder.length,
    streamEnd: { skill: candidate.streamEnd.skill, gogma: candidate.streamEnd.gogma },
    advance: origins === null ? null : {
      skill: candidate.streamEnd.skill - origins.skill, gogma: candidate.streamEnd.gogma - origins.gogma,
      normal: normalEnds.reduce((sum, [counterId, end]) => sum + (end - (origins.normal[counterId] ?? 0)), 0),
      normalStreamsAdvanced: normalEnds.filter(([counterId, end]) => end > (origins.normal[counterId] ?? 0)).length,
    },
    sourceKinds: { ...candidate.sourceKinds }, skillRequirements: { ...candidate.skillRequirements }, bonusRequirements: { ...candidate.bonusRequirements },
    skillDependencyCount: candidate.skillDependencyCount, predictedChainSegmentCount: candidate.predictedChainSegmentCount,
    diagnostics: {
      searchPolicyShapes: record.diagnostics.searchPolicyShapes.shapes.length,
      continuationOptions: structuredClone(record.diagnostics.continuationOptions),
      bonusFrontier: { ...summary.bonusFrontier },
      bonusFrontierLower: summary.shapeConstrained ? { ...summary.shapeConstrained.bonusFrontierLower } : null,
      plannerStartIdeal: { ...plannerStartIdealCounts, plannerStartIdealTargets, g4iiiObservability: record.diagnostics.plannerStartIdeal.g4iiiObservability },
      gateExceeded: { ...record.gateExceeded }, shapeGateExceeded: record.shapeGateExceeded ? { ...record.shapeGateExceeded } : null,
    },
  }
}

function confirmedProgressOf(progress: D0cRunnerOutputRun['confirmedProgress']) {
  if (progress === undefined) return null
  if ('unreadable' in progress) return { readable: false }
  const candidate = progress.candidates[0] ?? null
  return {
    readable: true, started: progress.started, finished: progress.finished, lastAtMs: progress.lastAtMs === null ? null : round(progress.lastAtMs), malformedLines: progress.malformedLines,
    contextReached: progress.context !== null, reachTableReached: progress.reachTable !== null, structuralCandidates: progress.structuralCandidates.length,
    settledTargets: candidate?.settledTargets.length ?? 0, targetInProgressWithoutOutcome: candidate?.targetInProgress != null,
    memory: { sampleCount: progress.memory.samples, maxHeapUsed: progress.memory.maxHeapUsed, maxRss: progress.memory.maxRss },
  }
}

/** The public RESULT, derived from the raw sources only (deterministic: the same sources give the same JSON). */
export function deriveD0cPublicResult(sources: D0cPublicResultSources) {
  assertSources(sources)
  const output = sources.output
  const recordById = new Map(sources.records.map(entry => [entry.id, entry.record]))
  const identifiers = collectRecordIdentifiers(sources.records)
  const measuredRuns = output.runs.filter(run => run.status === 'measured')
  const firstRecord = measuredRuns.length === 0 ? null : recordById.get(measuredRuns[0]!.id)!
  const semantic = firstRecord?.semantic ?? null
  const recomputedOutcome = summarizeD0cMaterializationOutcome({
    measured: measuredRuns.map(run => recordById.get(run.id)!.semantic),
    unmeasuredProgress: measuredRuns.length === 0 ? (output.runs.map(run => run.confirmedProgress).find((value): value is ConfirmedProgress => value !== undefined && !('unreadable' in value)) ?? null) : null,
  })
  const materializedEntries = semantic === null ? [] : semantic.candidates.flatMap(candidate => candidate.targets.flatMap(target =>
    target.outcome.kind === 'materialized' ? [{ orderIndex: target.orderIndex, entryId: target.outcome.entryId, entrySemanticHash: target.outcome.entrySemanticHash }] : []))
  const exportVerification = output.exportVerification as Record<string, unknown>
  return {
    resultKind: D0C_PUBLIC_RESULT_KIND,
    derivation: {
      revision: D0C_PUBLIC_RESULT_REVISION,
      script: D0C_PUBLIC_RESULT_DERIVATION_SCRIPT,
      function: 'deriveD0cPublicResult() (src/benchmarks/globalAssignment/materializationFormalResult.ts)',
      sources: [...sources.files].sort((left, right) => left.file.localeCompare(right.file)).map(file => ({ ...file })),
      consistency: {
        semanticSha256MatchesRecords: measuredRuns.every(run => run.semanticSha256 !== null && sources.semanticSha256ByRun[run.id] === run.semanticSha256),
        materializationOutcomeMatchesRecords: JSON.stringify(recomputedOutcome) === JSON.stringify(output.materializationOutcome),
      },
      excluded: [
        'Target / OwnedWeapon / BuildListEntry identifiers and per-Target hashes', 'Candidate snapshots and RouteOperation lists', 'Target-level Counter positions and requirement labels',
        'the materialization order, Skill dependencies and source-to-Target correspondence', 'reservations and requests per Target', 'the Export itself and the absolute run paths', 'process stderr',
      ],
      note: 'A mechanical aggregate of the formal outputs kept git-ignored in .local; no new measurement, no RNG prediction, no Search. The raw records stay unchanged; their SHA-256 are listed in sources.',
    },
    phase: output.phase, protocolVersion: output.protocolVersion, mode: output.mode, status: output.status, nature: output.nature,
    // As the runner judged it; only a record identifier inside an issue message is redacted.
    formalValidity: redactDeep(output.formalValidity, identifiers),
    registration: {
      ...structuredClone(output.formalRegistration),
      registrationHead: output.registrationHead ?? null,
      conditions: structuredClone(output.conditions), envelope: structuredClone(output.envelope), conditionBasis: sortedRecord(output.conditionBasis),
    },
    provenance: {
      measurementHeadSha: output.repositoryHeadSha, registrationHead: output.registrationHead ?? null, workingTreeClean: output.workingTreeClean, uncommittedBenchmarkCode: output.uncommittedBenchmarkCode,
      benchmarkCodeSha256: output.benchmarkCodeSha256, calculationAudit: output.calculationAudit ? structuredClone(output.calculationAudit) : null,
      registrationDoc: output.registrationDoc ? { ...output.registrationDoc } : null, overrideOptions: [...(output.overrideOptions ?? output.smokeOverrides ?? [])],
      oracleFreeExecution: output.oracleFreeExecution, oracleInformedDesign: output.oracleInformedDesign, runnerScript: output.runnerScript, node: output.node, v8: output.v8,
      plannerInputMaxPlanStepsForValidationOnly: output.plannerInputMaxPlanStepsForValidationOnly, launchedAt: output.launchedAt, machine: structuredClone(output.machine),
    },
    exportVerification: {
      actual: { ...output.exportVerification.actual }, registered: exportVerification.registered ?? null, registeredSource: exportVerification.registeredSource ?? null,
      registeredMatched: exportVerification.registeredMatched ?? null, cliExpectedSha256: exportVerification.cliExpectedSha256 ?? null, cliMatched: exportVerification.cliMatched ?? null,
    },
    calculationContext: firstRecord === null ? null : structuredClone(firstRecord.calculationContext),
    rngEngineVersion: firstRecord?.rngEngineVersion ?? null,
    runs: output.runs.map(run => {
      const record = recordById.get(run.id)
      return {
        id: run.id, status: run.status, reason: run.reason, semanticSha256: run.semanticSha256, recordComplete: run.recordComplete, recordConsistent: run.recordConsistent,
        childGatePassed: run.childGatePassed, calculationContextMatched: run.calculationContextMatched,
        timing: record === undefined ? null : timingOf(record), memory: record === undefined ? null : memoryOf(record),
        confirmedProgress: run.status === 'unmeasured' ? confirmedProgressOf(run.confirmedProgress) : null,
      }
    }),
    processes: output.processes.map(entry => ({
      id: entry.id, outcome: entry.outcome, exitCode: entry.exitCode, signal: entry.signal, timedOut: entry.timedOut, cancelled: entry.cancelled, settledBy: entry.settledBy,
      wallObservedMs: round(entry.wallObservedMs), wallMs: entry.wallMs, heapMb: entry.heapMb, startedAt: entry.startedAt, recordWritten: entry.recordWritten,
    })),
    determinism: structuredClone(output.determinism),
    integrityIssues: { count: output.integrityIssues.length, messages: output.integrityIssues.map(message => redact(message, identifiers)) },
    totalWallMs: round(output.totalWallMs),
    input: semantic === null ? null : structuredClone(semantic.input),
    reachTable: semantic === null || semantic.reachTable.status !== 'reach_table' ? null : {
      origins: { skill: semantic.reachTable.summary.origins.skill, gogma: semantic.reachTable.summary.origins.gogma, normalStreams: Object.keys(semantic.reachTable.summary.origins.normal).length },
      predictions: { ...semantic.reachTable.summary.predictions }, memoHits: { ...semantic.reachTable.summary.memoHits }, supportQueries: semantic.reachTable.summary.supportQueries,
      groupCount: semantic.reachTable.summary.groupCount, unsupportedPredictionCount: semantic.reachTable.summary.unsupportedPredictionCount,
    },
    structuralSearch: semantic === null ? null : structuralOf(semantic),
    structuralCandidate: semantic === null ? null : candidateOf(semantic),
    materializationOutcome: structuredClone(output.materializationOutcome),
    methodSelection: semantic === null ? null : methodSelectionOf(semantic),
    searchScale: semantic === null ? null : searchScaleOf(semantic),
    routeVerification: semantic === null ? null : routeVerificationOf(semantic),
    materializedEntries: { count: materializedEntries.length, fingerprint: materializedEntries.length === 0 ? null : hashStableValue(materializedEntries) },
    claims: output.claims,
    unconfirmed: [
      'Production Planner, Trace Replay and fresh Planner verification (D-1): all_materialized is not a Plan and not verified',
      'structural candidates after the first one, and windows other than W0',
      'G1 / G2 continuation shapes, the projected-to-shape fallback and the operation-kind alternative on the real Export unless counted above',
      'determinism on another machine or Node version',
    ],
  }
}

export type D0cPublicResult = ReturnType<typeof deriveD0cPublicResult>

/** Keys whose values would be Target-level data; none may appear anywhere in the public RESULT. */
export const D0C_PUBLIC_RESULT_FORBIDDEN_KEYS = Object.freeze([
  'targetWeaponId', 'targetWeaponIds', 'ownedWeaponId', 'sourceOwnedWeaponId', 'materializationOrder', 'targets', 'skillDependencies', 'prerequisiteOrderIndexes', 'entryId',
  'entrySemanticHash', 'searchIdentity', 'plannerRequired', 'routeShape', 'operations', 'candidateSnapshot', 'buildListEntries', 'notAttemptedTargetWeaponIds', 'option', 'reservation',
  'requests', 'skillRequired', 'bonusRequired', 'normalRequired', 'conversionPosition', 'finalPosition', 'resetPosition', 'gogmaRequiredOnlySamples', 'samples', 'stderrTail', 'runDir',
  'semantic', 'scanned', 'chosen', 'layout',
] as const)

/**
 * The only arrays the public RESULT may hold: run / process / source / issue lists and other run-level aggregates, never a list with one
 * row per planning Target (any other array is refused, whatever its length).
 */
export const D0C_PUBLIC_RESULT_AGGREGATE_ARRAYS = Object.freeze([
  'sources', 'excluded', 'runs', 'processes', 'semanticSha256s', 'messages', 'unconfirmed', 'issues', 'changedFiles', 'formalInfrastructure', 'outsideFormalInfrastructure',
  'registeredItemKeys', 'differencesFromRegistration', 'startIssues', 'registrationIssues', 'overrideOptions', 'candidates', 'deferredItems', 'differences',
] as const)

/** Why a public RESULT would leak data it must not carry (`[]` = minimized). */
export function d0cPublicResultMinimizationIssues(result: unknown, identifiers: readonly string[]): string[] {
  const issues: string[] = []
  const text = JSON.stringify(result)
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) issues.push('The public RESULT contains a UUID.')
  // A drive path in the JSON text (`X:\\` escaped, or `X:/`) or a POSIX home path.
  if (/(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\|\/)|\/Users\/|\/home\//.test(text)) issues.push('The public RESULT contains a local absolute path.')
  for (const identifier of identifiers) if (text.includes(identifier)) issues.push(`The public RESULT contains a record identifier (${identifier.length} characters).`)
  const forbidden = new Set<string>(D0C_PUBLIC_RESULT_FORBIDDEN_KEYS)
  const aggregateArrays = new Set<string>(D0C_PUBLIC_RESULT_AGGREGATE_ARRAYS)
  const walk = (value: unknown, path: string, key: string | null) => {
    if (Array.isArray(value)) {
      if (key === null || !aggregateArrays.has(key)) issues.push(`${path} is not a known aggregate array.`)
      value.forEach((item, index) => walk(item, `${path}[${index}]`, null))
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [name, item] of Object.entries(value)) {
      if (forbidden.has(name)) issues.push(`${path}.${name} is a Target-level field.`)
      walk(item, `${path}.${name}`, name)
    }
  }
  walk(result, '$', null)
  return issues
}

/**
 * Why a public RESULT is not the mechanical aggregate of the given raw sources (`[]` = it is): it must equal the re-derivation, the
 * runner's semantic SHA-256 must be each measured record's hash, the runner's materialization outcome must be the records' one, and
 * the minimization checks must pass.
 */
export function d0cPublicResultIssues(published: unknown, sources: D0cPublicResultSources): string[] {
  const issues: string[] = []
  const derived = deriveD0cPublicResult(sources)
  if (JSON.stringify(published) !== JSON.stringify(derived)) {
    const publishedRecord = (typeof published === 'object' && published !== null ? published : {}) as Record<string, unknown>
    const differing = Object.keys(derived).filter(key => JSON.stringify(publishedRecord[key]) !== JSON.stringify((derived as Record<string, unknown>)[key]))
    issues.push(`The public RESULT is not the re-derivation of the raw sources (differing: ${differing.join(', ') || 'key order or extra keys'}).`)
  }
  if (!derived.derivation.consistency.semanticSha256MatchesRecords) issues.push('A measured run\'s recorded semantic SHA-256 is not the hash of its record.')
  if (!derived.derivation.consistency.materializationOutcomeMatchesRecords) issues.push('The runner\'s materialization outcome is not the one its records give.')
  issues.push(...d0cPublicResultMinimizationIssues(published, collectRecordIdentifiers(sources.records)))
  return issues
}
