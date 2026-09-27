import { hashStableValue } from '../domain/models/hashing'
import type { RngEngine } from '../domain/rng/rngEngine'
import { searchCandidates } from '../domain/search/candidateSearch'
import { CandidateSearchError, type CandidateSearchInput, type CandidateSearchResult, type CandidateRouteFilter, type CandidateSearchSettings } from '../domain/search/searchTypes'
import { GlobalSearchProfiler } from './plannerGlobalOptimizationProfile'
import type { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'
import { GLOBAL_RESEARCH_TIME, observeGlobalResearchReach } from './plannerGlobalOptimizationResearch'

export interface FocusOptions {
  routeFilter?: CandidateRouteFilter
  extent?: CandidateSearchSettings
  timeBudgetMs: number
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  nowMs?: () => number
  rawBlocks?: GlobalRawBlockResearch
  onResult?: (result: CandidateSearchResult | null) => void
}

/** Each experiment owns a deep copy. No prior Candidate, result, or changed
 * Counter can leak into the next experiment. Deadline uses the existing
 * checkpoint; a truncated Search never becomes bounded no-match.
 */
export async function runGlobalResearchFocus(snapshot: CandidateSearchInput, engine: RngEngine, options: FocusOptions) {
  if (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0) throw new Error('Invalid focus time budget.')
  const input = structuredClone(snapshot)
  input.routeFilter = options.routeFilter ?? input.routeFilter
  input.settings = { ...(options.extent ?? input.settings) }
  const nowMs = options.nowMs ?? (() => performance.now())
  const start = nowMs()
  let deadlineReachedAt: number | null = null
  let cancelObservedAt: number | null = null
  const reach = { normal: 0, gogma: 0, skill: 0 }
  const profiler = new GlobalSearchProfiler()
  const raw = options.rawBlocks?.beginSearch(input.targetWeaponId)
  const observed = profiler.begin(observeGlobalResearchReach(raw?.engine ?? engine, input, reach), {
    now: () => GLOBAL_RESEARCH_TIME, nowMs, yieldControl: options.yieldControl,
    shouldCancel: () => {
      if (options.shouldCancel?.()) { cancelObservedAt ??= nowMs(); return true }
      if (nowMs() - start >= options.timeBudgetMs) { deadlineReachedAt ??= nowMs(); return true }
      return false
    },
  }, nowMs)
  let result: CandidateSearchResult | null = null
  let status: 'found' | 'not_found_within_extent' | 'unavailable' | 'time_budget_reached' | 'cancelled' | 'search_error'
  let error: string | null = null
  try {
    result = await searchCandidates(input, observed.engine, observed.execution)
    status = result.targetResult.candidate ? 'found' : result.targetResult.searchedRoutes.length ? 'not_found_within_extent' : 'unavailable'
  } catch (caught) {
    status = caught instanceof CandidateSearchError && caught.code === 'cancelled'
      ? deadlineReachedAt !== null ? 'time_budget_reached' : 'cancelled' : 'search_error'
    error = caught instanceof Error ? caught.message : String(caught)
  } finally { raw?.end() }
  const candidate = result?.targetResult.candidate ?? null
  const end = nowMs()
  options.onResult?.(structuredClone(result))
  return {
    targetId: input.targetWeaponId, snapshotFingerprint: hashStableValue(snapshot), routeFilter: input.routeFilter, extent: input.settings,
    timeBudgetMs: options.timeBudgetMs, status, error, elapsedMs: end - start,
    cancelResponseMs: deadlineReachedAt !== null ? end - deadlineReachedAt : cancelObservedAt !== null ? end - cancelObservedAt : null,
    routeKind: candidate?.route.kind ?? null, estimatedOperationCount: candidate?.estimatedOperationCount ?? null,
    advances: candidate ? { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance } : null,
    candidateFingerprint: candidate ? hashStableValue(candidate) : null,
    searchedRoutes: result?.targetResult.searchedRoutes ?? [], skippedRoutes: result?.targetResult.skippedRoutes ?? [],
    observedPredictionReach: reach,
    predictionBoundaryReached: { normal: reach.normal >= input.settings.maxNormalAdvance, gogma: reach.gogma >= input.settings.maxGogmaAdvance,
      skillExisting: reach.skill >= input.settings.maxSkillAdvance, skillConversion: reach.skill >= input.settings.maxSkillAdvance + 1 },
    profile: observed.profile,
  }
}
