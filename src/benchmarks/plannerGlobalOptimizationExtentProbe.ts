/** Issue #154 Phase 1-D: transient Research only. Never import from Production. No Target ID policy. */
import { createBuildListEntry } from '../domain/buildList'
import { hashStableValue } from '../domain/models/hashing'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import type { CandidateSearchResult, CandidateSearchSettings } from '../domain/search/searchTypes'
import type { GlobalSearchProfiler } from './plannerGlobalOptimizationProfile'
import { projectGlobalResearchPlan } from './plannerGlobalOptimizationProjection'
import { GLOBAL_RESEARCH_TIME, globalResearchSearchInput, materializeGlobalResearchCandidate, runGlobalResearchSearch,
  type GlobalResearchExtentFallback, type GlobalResearchNoMatchCapture, type GlobalResearchProjectedState, type SearchMeasurement } from './plannerGlobalOptimizationResearch'
import { compareResearchAttempts, discoverySignature, type AttemptSummary, type DiscoveryState } from './plannerGlobalOptimizationRetry'
import type { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'

export type ExtentAxis = 'normal' | 'gogma' | 'skill'
export const EXTENT_AXES: readonly ExtentAxis[] = ['normal', 'gogma', 'skill']
/** Phase 1-D bound: one axis, at most twice the base value. Never widened further here. */
export const EXTENT_PROBE_FACTOR = 2
export const PHASE1D_BOUNDS = { maxAnchors: 2, maxProbes: 6, maxVariants: 6 } as const

export function isExtentAxis(value: unknown): value is ExtentAxis {
  return typeof value === 'string' && (EXTENT_AXES as readonly string[]).includes(value)
}

/** Only the named axis changes; the other two keep the base value exactly. */
export function singleAxisProbeExtent(base: CandidateSearchSettings, axis: ExtentAxis): CandidateSearchSettings {
  return { maxNormalAdvance: base.maxNormalAdvance * (axis === 'normal' ? EXTENT_PROBE_FACTOR : 1),
    maxGogmaAdvance: base.maxGogmaAdvance * (axis === 'gogma' ? EXTENT_PROBE_FACTOR : 1),
    maxSkillAdvance: base.maxSkillAdvance * (axis === 'skill' ? EXTENT_PROBE_FACTOR : 1) }
}

/**
 * Axes whose extent the base Search actually read to its last position (observed prediction reach).
 * A bounded no-match drains its whole queue, so an axis that did not reach its boundary ended
 * naturally; widening it alone cannot read more for that axis. A reached boundary does not prove
 * the axis is the cause - only that it is a candidate.
 */
export function eligibleExtentAxes(boundary: SearchMeasurement['predictionBoundaryReached']): ExtentAxis[] {
  return EXTENT_AXES.filter(axis => axis === 'normal' ? boundary.normal : axis === 'gogma' ? boundary.gogma : boundary.skillExisting || boundary.skillConversion)
}

/** Generic single-axis fallback: base bounded no-match + that axis' boundary evidence. Nothing else. */
export function createSingleAxisExtentFallback(axis: ExtentAxis, timeBudgetMs: number): GlobalResearchExtentFallback {
  if (!isExtentAxis(axis)) throw new Error('Invalid extent axis')
  return { strategy: `${axis}-${EXTENT_PROBE_FACTOR}x-fallback`, timeBudgetMs,
    request: measurement => measurement.status === 'not_found_within_extent' && eligibleExtentAxes(measurement.predictionBoundaryReached).includes(axis)
      ? { axis, extent: singleAxisProbeExtent(measurement.extent, axis) } : null }
}

/** The projected state of a captured request: exactly the request minus its four request fields. */
export function projectedStateOfCapture(capture: GlobalResearchNoMatchCapture): GlobalResearchProjectedState {
  const projected: Partial<GlobalResearchNoMatchCapture['searchInput']> = structuredClone(capture.searchInput)
  delete projected.searchRunId
  delete projected.targetWeaponId
  delete projected.routeFilter
  delete projected.settings
  return projected as GlobalResearchProjectedState
}

/** Rebuild the captured request for a probe extent through the one Research request authority. */
export function probeSearchInput(capture: GlobalResearchNoMatchCapture, extent: CandidateSearchSettings) {
  const base = globalResearchSearchInput(projectedStateOfCapture(capture), capture.originTarget, { ...capture.measurement.extent })
  // The capture must be what the authority builds; otherwise the snapshot is not the base request.
  if (hashStableValue(base) !== hashStableValue(capture.searchInput)) throw new Error('Captured request does not match the Research request authority.')
  return globalResearchSearchInput(projectedStateOfCapture(capture), capture.originTarget, { ...extent })
}

export interface ExtentProbeRecord {
  targetId: string
  axis: ExtentAxis
  snapshotSha256: string
  baseSearchRunId: string
  baseExtent: CandidateSearchSettings
  probeExtent: CandidateSearchSettings
  probeSearchRunId: string
  baseBoundary: SearchMeasurement['predictionBoundaryReached']
  status: 'found' | 'not_found_within_extent' | 'unavailable' | 'time_budget_reached' | 'cancelled' | 'search_error'
  error: string | null
  timeBudgetMs: number
  elapsedMs: number
  observedPredictionReach: SearchMeasurement['observedPredictionReach']
  predictionBoundaryReached: SearchMeasurement['predictionBoundaryReached']
  routeKind: string | null
  estimatedOperationCount: number | null
  advances: SearchMeasurement['advances']
  searchedRoutes: SearchMeasurement['searchedRoutes']
  skippedRoutes: SearchMeasurement['skippedRoutes']
  candidateFingerprint: string | null
  /** Ordinary validation of a found Candidate: materialization against the original Ideal + single Planner. */
  validation: { status: 'passed' | 'materialization_blocked' | 'projection_failed' | 'not_applicable'; error: string | null;
    generatedEntryId: string | null; applicationSteps: number | null }
  profile?: GlobalResearchSearchProfile
}
type GlobalResearchSearchProfile = NonNullable<Awaited<ReturnType<typeof runGlobalResearchSearch>>['profile']>

/**
 * One focused probe from a captured snapshot. Every probe starts from its own deep copy of the
 * same base snapshot: nothing a previous probe found, predicted or projected is passed on.
 */
export async function runGlobalExtentProbe(original: PlannerInput, capture: GlobalResearchNoMatchCapture, axis: ExtentAxis, dependencies: PlannerDependencies, options: {
  timeBudgetMs: number; shouldCancel?: () => boolean; yieldControl?: () => Promise<void>; nowMs?: () => number
  profiler?: GlobalSearchProfiler; rawBlocks?: GlobalRawBlockResearch; onResult?: (result: CandidateSearchResult | null) => void
}): Promise<ExtentProbeRecord> {
  if (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0) throw new Error('Invalid probe time budget.')
  if (capture.measurement.status !== 'not_found_within_extent') throw new Error('A probe starts only from a bounded no-match.')
  if (!eligibleExtentAxes(capture.measurement.predictionBoundaryReached).includes(axis)) throw new Error('Axis did not reach its base boundary.')
  const snapshot = structuredClone(capture)
  const extent = singleAxisProbeExtent(snapshot.measurement.extent, axis)
  const input = probeSearchInput(snapshot, extent)
  const nowMs = options.nowMs ?? (() => performance.now())
  const start = nowMs()
  let deadline = false, externalCancel = false
  const run = await runGlobalResearchSearch(input, dependencies.rngEngine, { nowMs, yieldControl: options.yieldControl, profiler: options.profiler, rawBlocks: options.rawBlocks,
    shouldCancel: () => { if (options.shouldCancel?.()) { externalCancel = true; return true } if (nowMs() - start >= options.timeBudgetMs) deadline = true; return deadline } })
  options.onResult?.(structuredClone(run.result))
  const candidate = run.result?.targetResult.candidate ?? null
  const status: ExtentProbeRecord['status'] = run.failure === 'cancelled' ? externalCancel ? 'cancelled' : 'time_budget_reached'
    : run.failure === 'search_error' || !run.result ? 'search_error'
      : candidate ? 'found' : run.result.targetResult.searchedRoutes.length ? 'not_found_within_extent' : 'unavailable'
  const validation: ExtentProbeRecord['validation'] = { status: 'not_applicable', error: null, generatedEntryId: null, applicationSteps: null }
  if (candidate) {
    try {
      const entry = materializeGlobalResearchCandidate(original, input, candidate)
      const check = validatePlannerInput({ ...original, buildListEntries: [entry] }, dependencies)
      if (!check.isValid || check.excludedBuildListEntries.length) throw new Error(JSON.stringify({ issues: check.issues, exclusions: check.excludedBuildListEntries.map(e => e.reason) }))
      validation.generatedEntryId = entry.id
      validation.status = 'passed'
    } catch (error) { validation.status = 'materialization_blocked'; validation.error = String(error) }
    if (validation.status === 'passed') {
      try {
        const projected = projectedStateOfCapture(snapshot)
        if (hashStableValue(projected.master) !== hashStableValue(original.master)) throw new Error('Snapshot Master differs from the original.')
        const target = projected.targetWeapons.find(t => t.id === candidate.targetWeaponId)!
        const application: PlannerInput = { rngState: projected.rngState, normalCounters: projected.normalCounters, ownedWeapons: projected.ownedWeapons,
          targetWeapons: projected.targetWeapons, master: original.master, calculationContext: projected.calculationContext, options: original.options,
          buildListEntries: [createBuildListEntry(candidate, target, { createdAt: GLOBAL_RESEARCH_TIME })], conflictResolutions: [] }
        const result = await createProductionPlan(application, dependencies)
        if (!result.plan || result.termination.status !== 'completed' || result.conflicts.length || result.plan.rejectedBuildListEntries.length) throw new Error('Single Candidate full Planner did not complete.')
        projectGlobalResearchPlan(application, result.plan, dependencies)
        validation.applicationSteps = result.plan.steps.length
      } catch (error) { validation.status = 'projection_failed'; validation.error = String(error) }
    }
  }
  return { targetId: snapshot.searchInput.targetWeaponId, axis, snapshotSha256: hashStableValue(capture.searchInput), baseSearchRunId: capture.searchInput.searchRunId,
    baseExtent: { ...snapshot.measurement.extent }, probeExtent: extent, probeSearchRunId: input.searchRunId, baseBoundary: snapshot.measurement.predictionBoundaryReached,
    status, error: run.error, timeBudgetMs: options.timeBudgetMs, elapsedMs: run.elapsedMs,
    observedPredictionReach: run.observedPredictionReach, predictionBoundaryReached: run.predictionBoundaryReached,
    routeKind: candidate?.route.kind ?? null, estimatedOperationCount: candidate?.estimatedOperationCount ?? null,
    advances: candidate ? { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance } : null,
    searchedRoutes: run.result?.targetResult.searchedRoutes ?? [], skippedRoutes: run.result?.targetResult.skippedRoutes ?? [],
    candidateFingerprint: candidate ? hashStableValue(candidate) : null, validation, ...(run.profile ? { profile: run.profile } : {}) }
}

/** A Phase 1-C attempt as stored in its raw report (typed summary + semantic evidence). */
export interface StoredResearchAttempt extends AttemptSummary {
  evidence?: { resultSha256: string | null; planSha256?: string | null; searchEvidence?: unknown[] } | null
}
export interface ExtentProbeAnchor {
  role: 'primary' | 'secondary'
  attemptId: number
  state: DiscoveryState
  signature: string
  reason: string
  expected: { completed: number; conflicts: number; rejected: number; resourceConflictRejected: number; steps: number; traceReplay: string
    resultSha256: string; planSha256: string | null; notFound: string[]; searchStatuses: { targetId: string; status: string }[] }
}

const usableAnchor = (a: StoredResearchAttempt) => a.signature === discoverySignature(a.state) && a.stop === null && a.signals.blockers.length === 0 && a.report.error === null &&
  a.report.final !== null && a.report.final.traceReplay === 'passed' && typeof a.evidence?.resultSha256 === 'string'

/**
 * Anchors from OBSERVED Phase 1-C results only: the best partial state by the existing Research
 * comparison (restricted to blocker-free, replayed, evidenced states with the maximum completed
 * count and a signature matching its state), plus at most one such state whose bounded no-match set names a Target the primary's
 * does not. No Target ID, order, oracle count or Counter is embedded here.
 */
export function selectExtentProbeAnchors(attempts: readonly StoredResearchAttempt[], reportedBestAttemptId: number | null) {
  const usable = attempts.filter(usableAnchor)
  const rejected = attempts.filter(a => !usableAnchor(a)).map(a => a.attemptId)
  if (!usable.length) return { anchors: [] as ExtentProbeAnchor[], rejectedAttemptIds: rejected, reportedBestAttemptId, primaryMatchesReportedBest: false }
  const maxCompleted = Math.max(...usable.map(a => a.report.final!.completedTargetCount))
  const ranked = usable.filter(a => a.report.final!.completedTargetCount === maxCompleted).sort(compareResearchAttempts)
  const anchor = (a: StoredResearchAttempt, role: ExtentProbeAnchor['role'], reason: string): ExtentProbeAnchor => {
    return { role, attemptId: a.attemptId, state: structuredClone(a.state), signature: a.signature, reason, expected: {
      completed: a.report.final!.completedTargetCount, conflicts: a.report.final!.conflicts, rejected: a.report.final!.rejected,
      resourceConflictRejected: a.report.final!.resourceConflictRejected, steps: a.report.final!.steps, traceReplay: a.report.final!.traceReplay,
      resultSha256: a.evidence!.resultSha256!, planSha256: a.evidence?.planSha256 ?? null, notFound: [...a.signals.notFound],
      searchStatuses: a.report.searches.map(s => ({ targetId: s.targetId, status: s.status })) } }
  }
  const primary = ranked[0]
  const anchors = [anchor(primary, 'primary', `best of ${ranked.length} blocker-free replayed states with ${maxCompleted} completed (compareResearchAttempts)`)]
  const primaryMisses = new Set(primary.signals.notFound)
  const secondary = ranked.slice(1).find(a => a.signals.notFound.some(id => !primaryMisses.has(id)))
  if (secondary && anchors.length < PHASE1D_BOUNDS.maxAnchors) anchors.push(anchor(secondary, 'secondary', 'best such state whose bounded no-match set names a Target absent from the primary'))
  return { anchors, rejectedAttemptIds: rejected, reportedBestAttemptId, primaryMatchesReportedBest: reportedBestAttemptId === primary.attemptId }
}

/** Research variant comparison (not a Production Candidate ranking). */
export interface ExtentVariantOutcome {
  signature: string
  planningTargetCount: number
  final: { completedTargetCount: number; conflicts: number; rejected: number; resourceConflictRejected: number; steps: number; traceReplay: string; status: string } | null
  stop: string | null
}
export function isGlobalPlanSuccess(v: ExtentVariantOutcome): boolean {
  const f = v.final
  return v.stop === 'completed' && f !== null && f.status === 'completed' && f.completedTargetCount === v.planningTargetCount &&
    f.conflicts === 0 && f.rejected === 0 && f.resourceConflictRejected === 0 && f.traceReplay === 'passed'
}
export function compareExtentVariants(a: ExtentVariantOutcome, b: ExtentVariantOutcome): number {
  const key = (v: ExtentVariantOutcome) => [isGlobalPlanSuccess(v) ? 0 : 1, v.final?.resourceConflictRejected ?? Infinity, v.final?.conflicts ?? Infinity,
    -(v.final?.completedTargetCount ?? 0), v.final?.steps ?? Infinity]
  const ka = key(a), kb = key(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0
}
export const extentVariantSignature = (anchorSignature: string, strategy: string) => JSON.stringify({ anchor: anchorSignature, strategy })

/** Bounded, duplicate-free work plan; the executor decides nothing about which axes to try. */
export class ExtentResearchLedger {
  private readonly probes = new Set<string>()
  private readonly variants = new Set<string>()
  claimProbe(anchorSignature: string, snapshotSha256: string, axis: ExtentAxis): boolean {
    const key = JSON.stringify({ anchorSignature, snapshotSha256, axis })
    if (this.probes.has(key)) return false
    if (this.probes.size >= PHASE1D_BOUNDS.maxProbes) throw new Error('Phase 1-D probe bound reached')
    this.probes.add(key)
    return true
  }
  claimVariant(anchorSignature: string, strategy: string): boolean {
    const key = extentVariantSignature(anchorSignature, strategy)
    if (this.variants.has(key)) return false
    if (this.variants.size >= PHASE1D_BOUNDS.maxVariants) throw new Error('Phase 1-D variant bound reached')
    this.variants.add(key)
    return true
  }
}

/** A completed variant, once observed, is never replaced by a later failure. */
export function phase1dControllerOutcome(variants: readonly ExtentVariantOutcome[], stop: string | null): string {
  return variants.some(isGlobalPlanSuccess) ? 'completed' : stop ?? 'not_completed'
}
