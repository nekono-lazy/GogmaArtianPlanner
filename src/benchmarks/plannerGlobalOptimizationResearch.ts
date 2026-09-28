/** Issue #154 Phase 0: transient Research only. Never import from Production. */
import { createBuildListEntry, createTargetDefinitionHash, evaluateBuildListEntryStaleness } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, createReferencedOwnedWeaponsHash, hashStableValue,
  prepareExportRootForImport, validateBuildCandidate, validateBuildListEntry } from '../domain/models/publicTypes'
import type { BuildCandidate, BuildListEntry, OwnedWeaponId, PlanStepId, ProductionPlanId, TargetWeapon } from '../domain/models/publicTypes'
import { validateExportRootForFullReplacement } from '../services/dataTransfer/importExportValidation'
import { createProductionPlanWithObserver } from '../domain/planner/productionPlanGeneration'
import { comparePlannerEntryPriority } from '../domain/planner/plannerEntryPriority'
import { replayPlannerSearchTrace } from '../domain/planner/plannerTraceReplay'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import { hasIntermediateStateSelection } from '../domain/planner/plannerCheckpoints'
import { createPlannerStartSearchOrigin, normalizePlannerSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import { createDeterministicMaterializer } from '../domain/planner/replacement/plannerDeterministicMaterializer'
import type { PlannerDependencies, PlannerExecutionOptions, PlannerInput, PlannerResult, PlannerRunResult } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { searchCandidates } from '../domain/search/candidateSearch'
import { createConstrainedCandidate } from '../domain/search/constrained/constrainedCandidateFactory'
import { CandidateSearchError } from '../domain/search/searchTypes'
import type { CandidateSearchInput, CandidateSearchResult, CandidateSearchSettings } from '../domain/search/searchTypes'
import { projectGlobalResearchPlan } from './plannerGlobalOptimizationProjection'
import type { GlobalSearchProfiler, SearchProfile } from './plannerGlobalOptimizationProfile'
import type { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'
import type { GlobalResearchPlannerRunKind, Phase2BPlannerTimeline } from './plannerGlobalPhase2BTimeline'

export const GLOBAL_RESEARCH_EXTENT: CandidateSearchSettings = { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }
export const GLOBAL_RESEARCH_TIME = '2026-09-27T00:00:00.000Z'

/** The projected state a Research Search starts from: a Search request minus its request fields. */
export type GlobalResearchProjectedState = Omit<CandidateSearchInput, 'searchRunId' | 'targetWeaponId' | 'routeFilter' | 'settings'>

/**
 * The one Research Search request authority (Phase 0 formula, unchanged). Every extent - base,
 * Phase 1-D probe or fallback - goes through it, so `searchRunId` always names the extent it ran
 * with. Never overwrite `settings` of an existing request, and never rewrite a Candidate hash.
 * `originTarget` is the Planner-start Target (the identity Phase 0 hashes), not the projected one.
 */
export function globalResearchSearchInput(projected: GlobalResearchProjectedState, originTarget: TargetWeapon, extent: CandidateSearchSettings): CandidateSearchInput {
  return { ...projected, searchRunId: `research.global.search.${hashStableValue({ target: originTarget.id, origin: normalizePlannerSearchOrigin(projected, originTarget), extent })}`,
    targetWeaponId: originTarget.id, routeFilter: 'all', settings: extent }
}

export function globalResearchDependencies(engine: RngEngine): PlannerDependencies {
  let plan = 0, step = 0, weapon = 0
  return { rngEngine: engine, clock: { now: () => GLOBAL_RESEARCH_TIME }, idFactory: {
    productionPlanId: () => `research.global.plan.${++plan}` as ProductionPlanId,
    planStepId: () => `research.global.step.${++step}` as PlanStepId,
    ownedWeaponId: () => `research.global.weapon.${++weapon}` as OwnedWeaponId,
  } }
}

/** Pure validation only: no Import service, repository or IndexedDB calls. */
export function globalResearchInputFromExport(value: unknown, maxPlanSteps: number): PlannerInput {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues))
  const prepared = prepareExportRootForImport(value)
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues))
  const validation = validateExportRootForFullReplacement(prepared.root, loaded.data)
  if (!validation.isValid) throw new Error(JSON.stringify(validation.issues))
  const root = prepared.root
  if (root.rngState === null) throw new Error('Export has no RNG state.')
  const master = loaded.data
  return {
    rngState: root.rngState, normalCounters: root.normalArtianCounters, ownedWeapons: root.ownedWeapons,
    targetWeapons: root.targetWeapons, buildListEntries: root.buildListEntries, conflictResolutions: [], options: { maxPlanSteps },
    calculationContext: { gameVersion: master.manifest.gameVersion, masterDataVersion: master.manifest.dataVersion,
      rngEngineVersion: new ProductionRngEngine().version, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
    master: { weaponBonusDefinitions: master.weaponBonusDefinitions, weaponTypes: master.weaponTypes, elements: master.elements,
      bonusTypes: master.bonusTypes, bonusRanks: master.bonusRanks, artianBonusTypeMappings: master.artianBonusTypeMappings, materialCosts: master.materialCosts },
  }
}

/** Reconstruct all origin-dependent semantics, not a Search-hash overwrite. */
export function materializeGlobalResearchCandidate(originInput: PlannerInput, projectedInput: CandidateSearchInput, candidate: BuildCandidate,
  algorithm: string = 'phase0-sequential-v1'): BuildListEntry {
  const origin = createPlannerStartSearchOrigin(originInput)
  const target = origin.targetWeapons.find(t => t.id === candidate.targetWeaponId)
  if (!target) throw new Error('Candidate Target is absent from Planner origin.')
  const valid = validateBuildCandidate(candidate, projectedInput.ownedWeapons)
  if (!valid.isValid) throw new Error(JSON.stringify(valid.issues))
  const projectedTarget = projectedInput.targetWeapons.find(t => t.id === target.id)
  if (!projectedTarget || createTargetDefinitionHash(projectedTarget) !== createTargetDefinitionHash(target)) {
    throw new Error('Projected Target performance differs from the Planner origin.')
  }
  const projectedEntry = createBuildListEntry(candidate, projectedTarget, { createdAt: GLOBAL_RESEARCH_TIME })
  const staleness = evaluateBuildListEntryStaleness(projectedEntry, { ...projectedInput, target: projectedTarget })
  if (staleness.isStale) throw new Error(`Projected Candidate is stale: ${staleness.staleReasons.join(', ')}`)
  // A previously changed / generated weapon cannot masquerade as an origin source.
  if (candidate.route.sourceOwnedWeaponId !== null && !origin.ownedWeapons.some(w => w.id === candidate.route.sourceOwnedWeaponId)) {
    throw new Error('Candidate references a weapon generated by the prefix; route-local references are unsupported.')
  }
  if (createReferencedOwnedWeaponsHash(candidate.route, origin.ownedWeapons) !== candidate.referencedOwnedWeaponsHash) {
    throw new Error('Candidate source changed during the prefix; origin materialization is unsupported.')
  }
  const semantic = createConstrainedCandidate(target, origin, candidate, 'origin_reach')
  if (!semantic) throw new Error('Candidate no longer satisfies the original Ideal.')
  const searchIdentity = `research.global.${hashStableValue({
    algorithm, origin: normalizePlannerSearchOrigin(origin, target),
    projectedOrigin: normalizePlannerSearchOrigin(projectedInput, projectedTarget),
    extent: projectedInput.settings, routeFilter: projectedInput.routeFilter, calculationContext: origin.calculationContext,
  })}`
  const entry = createDeterministicMaterializer({ origin, target, searchIdentity, candidateIdPrefix: 'candidate.research.global.',
    clock: { now: () => GLOBAL_RESEARCH_TIME },
  }).materializeBuildListEntry({ ...semantic, bonusAmendmentTrace: candidate.bonusAmendmentTrace,
    skillAmendmentTrace: candidate.skillAmendmentTrace, conversionSkillTrace: candidate.conversionSkillTrace }, originInput.buildListEntries).entry
  const entryValid = validateBuildListEntry(entry)
  if (!entryValid.isValid) throw new Error(JSON.stringify(entryValid.issues))
  return entry
}

export interface SearchMeasurement {
  profile?: SearchProfile
  targetId: string
  originalEntryId: string
  generatedEntryId: string | null
  generatedCandidateId: string | null
  status: 'searching' | 'found' | 'not_found_within_extent' | 'unavailable' | 'search_error' | 'materialization_blocked' | 'projection_failed' | 'checkpoint_blocked' | 'cancelled' | 'time_budget_reached'
  elapsedMs: number
  applicationPlannerMs: number
  routeKind: string | null
  estimatedOperationCount: number | null
  advances: { normal: number | null; gogma: number; skill: number } | null
  extent: CandidateSearchSettings
  /** Actual prediction calls, relative to Search start; not an inferred traversal count. */
  observedPredictionReach: { normal: number; gogma: number; skill: number }
  predictionBoundaryReached: { normal: boolean; gogma: boolean; skillExisting: boolean; skillConversion: boolean }
  searchedRoutes: CandidateSearchResult['targetResult']['searchedRoutes']
  skippedRoutes: CandidateSearchResult['targetResult']['skippedRoutes']
  error: string | null
  /** Phase 1-D only: the fallback after this base bounded no-match. */
  fallback?: ExtentFallbackMeasurement
  targetOutcome?: 'resolved_by_extent_fallback' | 'unresolved_after_extent_fallback'
}

export function observeGlobalResearchReach(engine: RngEngine, input: CandidateSearchInput, reach: SearchMeasurement['observedPredictionReach']): RngEngine {
  return { version: engine.version, capabilities: engine.capabilities,
    normalizeSeed: value => engine.normalizeSeed(value), getPredictionSupport: value => engine.getPredictionSupport(value),
    advanceGogmaCounter: (value, op) => engine.advanceGogmaCounter(value, op),
    advanceSkillCounter: (value, op) => engine.advanceSkillCounter(value, op),
    advanceNormalCounter: (value, op) => engine.advanceNormalCounter(value, op),
    predictGogmaBonus: value => { reach.gogma = Math.max(reach.gogma, value.gogmaCounter - (input.rngState.gogmaCounter.value ?? value.gogmaCounter) + 1); return engine.predictGogmaBonus(value) },
    predictSkills: value => { reach.skill = Math.max(reach.skill, value.skillCounter - (input.rngState.skillCounter.value ?? value.skillCounter) + 1); return engine.predictSkills(value) },
    predictNormalArtian: value => {
      const start = input.normalCounters.find(c => c.weaponTypeId === value.weaponTypeId && c.rarity === value.rarity)?.counter
      reach.normal = Math.max(reach.normal, value.normalCounter - (start ?? value.normalCounter) + 1)
      return engine.predictNormalArtian(value)
    },
  }
}

export function globalResearchBoundary(reach: SearchMeasurement['observedPredictionReach'], extent: CandidateSearchSettings): SearchMeasurement['predictionBoundaryReached'] {
  return { normal: reach.normal >= extent.maxNormalAdvance, gogma: reach.gogma >= extent.maxGogmaAdvance,
    skillExisting: reach.skill >= extent.maxSkillAdvance, skillConversion: reach.skill >= extent.maxSkillAdvance + 1 }
}

export interface GlobalResearchSearchRun {
  result: CandidateSearchResult | null
  /** A cancelled Search is never a bounded no-match; the caller decides which deadline it was. */
  failure: 'cancelled' | 'search_error' | null
  error: string | null
  elapsedMs: number
  observedPredictionReach: SearchMeasurement['observedPredictionReach']
  predictionBoundaryReached: SearchMeasurement['predictionBoundaryReached']
  profile?: SearchProfile
}

/** Phase 1-D: one ordinary Candidate Search under the Research observers (fallback and focused probe). */
export async function runGlobalResearchSearch(input: CandidateSearchInput, engine: RngEngine, options: {
  shouldCancel: () => boolean; yieldControl?: () => Promise<void>; nowMs: () => number; profiler?: GlobalSearchProfiler; rawBlocks?: GlobalRawBlockResearch
}): Promise<GlobalResearchSearchRun> {
  const reach = { normal: 0, gogma: 0, skill: 0 }
  const raw = options.rawBlocks?.beginSearch(input.targetWeaponId)
  const observedEngine = observeGlobalResearchReach(raw?.engine ?? engine, input, reach)
  const execution = { shouldCancel: options.shouldCancel, yieldControl: options.yieldControl, now: () => GLOBAL_RESEARCH_TIME, nowMs: options.nowMs }
  const observed = options.profiler?.begin(observedEngine, execution, options.nowMs)
  const start = options.nowMs()
  let result: CandidateSearchResult | null = null, failure: GlobalResearchSearchRun['failure'] = null, error: string | null = null
  try {
    result = await searchCandidates(input, observed?.engine ?? observedEngine, observed?.execution ?? execution)
  } catch (caught) {
    failure = caught instanceof CandidateSearchError && caught.code === 'cancelled' ? 'cancelled' : 'search_error'
    error = caught instanceof Error ? caught.message : String(caught)
  } finally { raw?.end() }
  return { result, failure, error, elapsedMs: options.nowMs() - start, observedPredictionReach: reach,
    predictionBoundaryReached: globalResearchBoundary(reach, input.settings), ...(observed ? { profile: observed.profile } : {}) }
}

/** Research diagnostic of a Phase 1-D extent fallback. It never overwrites the base Search status. */
export interface ExtentFallbackMeasurement {
  strategy: string
  axis: string
  baseExtent: CandidateSearchSettings
  extent: CandidateSearchSettings
  searchRunId: string
  /** `episode_limit_reached`: Phase 1-E bound; the fallback Search never started and the Target is not treated as absent. */
  status: 'searching' | 'found' | 'not_found_within_extent' | 'unavailable' | 'search_error' | 'materialization_blocked' | 'projection_failed' | 'cancelled' | 'time_budget_reached' | 'episode_limit_reached'
  /** hashStableValue() of the fallback request (FNV-1a fingerprint, not SHA-256): one fallback per request and attempt. */
  requestFingerprint: string
  /** Which stop ended a cancelled Search: this fallback's own budget, the attempt budget or an external cancel. */
  stoppedBy: 'fallback_budget' | 'attempt_budget' | 'external_cancel' | null
  timeBudgetMs: number
  elapsedMs: number
  applicationPlannerMs: number
  routeKind: string | null
  estimatedOperationCount: number | null
  advances: SearchMeasurement['advances']
  observedPredictionReach: SearchMeasurement['observedPredictionReach']
  predictionBoundaryReached: SearchMeasurement['predictionBoundaryReached']
  searchedRoutes: SearchMeasurement['searchedRoutes']
  skippedRoutes: SearchMeasurement['skippedRoutes']
  generatedEntryId: string | null
  generatedCandidateId: string | null
  error: string | null
  profile?: SearchProfile
}

/** Research-only policy seam. `request` sees only the base bounded no-match measurement. */
export interface GlobalResearchExtentFallback {
  strategy: string
  timeBudgetMs: number
  /** Phase 1-E: fallback Searches allowed in one attempt. Absent = unbounded (Phase 1-D). Reaching it blocks the attempt. */
  maxEpisodes?: number
  request(measurement: SearchMeasurement): { axis: string; extent: CandidateSearchSettings } | null
}

/** The exact base request of a bounded no-match, for a same-snapshot probe in a new process. */
export interface GlobalResearchNoMatchCapture {
  searchIndex: number
  originTarget: TargetWeapon
  searchInput: CandidateSearchInput
  measurement: SearchMeasurement
}

class ExtentFallbackBlocked extends Error {}

function summarizePlanner(result: PlannerResult, elapsedMs: number, fullRuns: number) {
  return { ...result.termination, selected: result.plan?.selectedBuildListEntryIds.length ?? 0,
    conflicts: result.conflicts.length, conflictsByKind: Object.fromEntries([...new Set(result.conflicts.map(c => c.kind))].sort().map(kind => [kind, result.conflicts.filter(c => c.kind === kind).length])),
    rejected: result.plan?.rejectedBuildListEntries.length ?? 0,
    resourceConflictRejected: result.plan?.rejectedBuildListEntries.filter(e => e.reason === 'resource_conflict').length ?? 0,
    steps: result.plan?.steps.length ?? 0, traceReplay: result.plan ? 'passed' : 'not_run', elapsedMs, fullRuns,
    warnings: result.warnings,
  }
}

export interface GlobalResearchReport {
  algorithm: string
  status: 'completed' | 'partial' | 'blocked' | 'cancelled' | 'error' | 'time_budget_reached'
  inputTargetCount: number
  inputEntryCount: number
  planningTargetCount: number
  inputFingerprint: string
  baseline: ReturnType<typeof summarizePlanner> | null
  retained: ReturnType<typeof summarizePlanner> | null
  final: ReturnType<typeof summarizePlanner> | null
  retainedOriginalEntryIds: string[]
  searches: SearchMeasurement[]
  generatedReplacementCount: number
  plannerFullRunCount: number
  searchElapsedMs: number
  plannerElapsedMs: number
  totalElapsedMs: number
  stage: 'baseline' | 'retained_prefix' | 'discovery' | 'final_planner' | 'finished'
  error: string | null
  /** Phase 1-D only. Fallback Search time is inside `searchElapsedMs` too. */
  extentFallback?: { strategy: string; searches: number; searchElapsedMs: number; maxEpisodes?: number }
  /** Phase 2-C1 only (absent = the sequential projection of Phase 0..2-B). */
  searchOrigin?: GlobalResearchSearchOrigin
}

/**
 * Where the pending Target Searches start (Issue #154 Phase 2-C1).
 * - `sequential_projection` (default, Phase 0..2-B): the state after the retained prefix and every earlier
 *   generated Candidate was applied by the single-Candidate Planner.
 * - `planner_start`: every pending Search starts from the same Planner-start origin (the original Export
 *   state); no retained Route, earlier Candidate, Counter advance or weapon change reaches a Search, and no
 *   single-Candidate application Planner runs. Collisions between Candidates are left to the final Planner.
 */
export type GlobalResearchSearchOrigin = 'sequential_projection' | 'planner_start'
export const PHASE2C1_PLANNER_START_ALGORITHM = 'phase2c1-planner-start-origin-v1'

export interface GlobalResearchOptions extends PlannerExecutionOptions {
  extent?: CandidateSearchSettings
  nowMs?: () => number
  onProgress?: (report: GlobalResearchReport) => void
  profiler?: GlobalSearchProfiler
  rawBlocks?: GlobalRawBlockResearch
  onSearchResult?: (result: CandidateSearchResult) => void
  /** Copy only: observers cannot mutate the Search input. Never persisted by the app. */
  onSearchInput?: (input: CandidateSearchInput) => void
  /** Observed failures supplied by the caller, never an oracle or an embedded ID. */
  failedFirstTargetIds?: readonly string[]
  /** Phase 1-C: complete independent state, never a previous projected input. */
  attempt?: { retainedEntryIds: readonly string[]; pendingTargetIds: readonly string[] }
  timeBudgetMs?: number
  /** Phase 1-D: Research-only single-axis fallback after a bounded no-match. Absent = Phase 0 / 1-C. */
  extentFallback?: GlobalResearchExtentFallback
  onBoundedNoMatch?: (capture: GlobalResearchNoMatchCapture) => void
  onFallbackSearchResult?: (result: CandidateSearchResult, fallback: ExtentFallbackMeasurement) => void
  /** Phase 2-B: semantics-neutral timeline of every full Planner call (clocks only). Absent = unchanged. */
  plannerTimeline?: Phase2BPlannerTimeline
  /** Phase 2-C1: the pending Search origin. Absent = `sequential_projection` (unchanged). */
  searchOrigin?: GlobalResearchSearchOrigin
}

export function orderGlobalResearchPending<T extends { targetWeaponId: string }>(pending: readonly T[], failedIds: readonly string[] = []): T[] {
  const failures = new Set(failedIds)
  return [...pending.filter(e => failures.has(e.targetWeaponId)), ...pending.filter(e => !failures.has(e.targetWeaponId))]
}

/** Baseline -> replayed retained prefix -> one canonical Search per missing Target -> full origin rerun. */
export async function runGlobalPlannerResearch(input: PlannerInput, dependencies: PlannerDependencies, options: GlobalResearchOptions = {}) {
  const nowMs = options.nowMs ?? (() => performance.now())
  const start = nowMs()
  if (options.timeBudgetMs !== undefined && (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0)) throw new Error('Invalid attempt budget')
  let timedOut = false
  const shouldCancel = () => {
    if (options.shouldCancel?.()) return true
    if (options.timeBudgetMs !== undefined && nowMs() - start >= options.timeBudgetMs) timedOut = true
    return timedOut
  }
  const extent = { ...(options.extent ?? GLOBAL_RESEARCH_EXTENT) }
  const original = structuredClone(input)
  const report: GlobalResearchReport = { algorithm: 'phase0-sequential-v1', status: 'partial', inputTargetCount: input.targetWeapons.length,
    inputEntryCount: input.buildListEntries.length, planningTargetCount: 0, inputFingerprint: hashStableValue(input), baseline: null, retained: null, final: null,
    retainedOriginalEntryIds: [], searches: [], generatedReplacementCount: 0, plannerFullRunCount: 0, searchElapsedMs: 0, plannerElapsedMs: 0, totalElapsedMs: 0, stage: 'baseline', error: null }
  if (options.failedFirstTargetIds?.length) report.algorithm = 'phase1a-observed-failed-first-v1'
  if (options.extentFallback) {
    if (!Number.isFinite(options.extentFallback.timeBudgetMs) || options.extentFallback.timeBudgetMs < 0) throw new Error('Invalid fallback budget')
    const max = options.extentFallback.maxEpisodes
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0)) throw new Error('Invalid fallback episode limit')
    report.algorithm = `phase1d-extent-fallback-v1:${options.extentFallback.strategy}`
    report.extentFallback = { strategy: options.extentFallback.strategy, searches: 0, searchElapsedMs: 0, ...(max !== undefined ? { maxEpisodes: max } : {}) }
  }
  const searchOrigin = options.searchOrigin ?? 'sequential_projection'
  if (searchOrigin !== 'sequential_projection' && searchOrigin !== 'planner_start') throw new Error('Invalid search origin')
  const plannerStartOrigin = searchOrigin === 'planner_start'
  if (plannerStartOrigin) {
    report.algorithm = options.extentFallback ? `${PHASE2C1_PLANNER_START_ALGORITHM}:${options.extentFallback.strategy}` : PHASE2C1_PLANNER_START_ALGORITHM
    report.searchOrigin = searchOrigin
  }
  const materializationAlgorithm = plannerStartOrigin ? PHASE2C1_PLANNER_START_ALGORITHM : undefined
  const fallbackRequests = new Set<string>()
  const publish = () => { report.totalElapsedMs = nowMs() - start; options.onProgress?.(structuredClone(report)) }
  const cancelled = () => { if (shouldCancel()) throw new CandidateSearchError('cancelled', 'Research cancelled or budget reached.') }
  const fullRun = async (runInput: PlannerInput, kind: GlobalResearchPlannerRunKind, searchIndex: number | null = null) => {
    cancelled()
    const started = nowMs(), countBefore = report.plannerFullRunCount
    let observed: PlannerRunResult | null = null
    let result: PlannerResult
    let elapsedMs: number
    // Phase 2-B: the timeline only reads clocks; it forwards shouldCancel / yieldControl unchanged.
    const timeline = options.plannerTimeline?.begin(kind, searchIndex)
    try {
      result = await createProductionPlanWithObserver(runInput, dependencies, timeline ? timeline.wrapExecution({ ...options, shouldCancel }) : { ...options, shouldCancel }, {
        beforePlannerRun: () => { report.plannerFullRunCount += 1; timeline?.beforePlannerRun() },
        afterPlannerRun: value => { observed = value; timeline?.afterPlannerRun() },
        ...(timeline ? { onPlanGenerationPhase: timeline.onPlanGenerationPhase } : {}),
      })
    } finally {
      timeline?.end()
      elapsedMs = nowMs() - started
      report.plannerElapsedMs += elapsedMs
    }
    cancelled()
    return { result, observed: observed as PlannerRunResult | null, summary: summarizePlanner(result, elapsedMs, report.plannerFullRunCount - countBefore) }
  }
  let finalResult: PlannerResult | null = null
  const replacements = new Map<string, BuildListEntry>()
  try {
    const baseline = await fullRun(original, 'baseline')
    report.baseline = baseline.summary
    report.planningTargetCount = baseline.result.termination.totalTargetCount
    publish()
    const validation = validatePlannerInput(original, dependencies)
    if (!validation.isValid) throw new Error(`Original Planner validation failed: ${JSON.stringify(validation.issues)}`)
    const state = baseline.observed?.bestState
    if (!baseline.result.plan || !state || baseline.result.termination.status === 'incomplete') throw new Error('Baseline has no usable untruncated Plan.')
    const kept = new Set(options.attempt?.retainedEntryIds ?? [...baseline.result.plan.selectedBuildListEntryIds, ...state.trace.flatMap(action => [action.primaryBuildListEntryId, ...action.progressedBuildListEntryIds])])
    if ([...kept].some(id => !validation.validBuildListEntries.some(v => v.entry.id === id))) throw new Error('Unknown or invalid retained Entry.')
    const retainedEntries = original.buildListEntries.filter(entry => kept.has(entry.id))
    report.retainedOriginalEntryIds = retainedEntries.map(entry => entry.id).sort()
    const retainedInput = { ...original, buildListEntries: retainedEntries }
    report.stage = 'retained_prefix'
    publish()
    // Removing non-progressed Routes can change scheduling. Verify the prefix anew, never assume equivalence.
    const retained = await fullRun(retainedInput, 'retained_prefix')
    report.retained = retained.summary
    publish()
    const emptyPrefix = retainedEntries.length === 0 && retained.observed?.bestState &&
      retained.result.termination.completedTargetCount === 0 && retained.result.termination.totalTargetCount === 0 &&
      replayPlannerSearchTrace(retainedInput, retained.observed.bestState, dependencies.rngEngine).isValid
    if ((!retained.result.plan && !emptyPrefix) || (!emptyPrefix && retained.result.termination.status !== 'completed') || retained.result.conflicts.length || retained.summary.rejected ||
      retained.result.termination.completedTargetCount !== new Set(retainedEntries.map(e => e.targetWeaponId)).size) {
      report.status = 'blocked'
      throw new Error('The selected/progressed retention hypothesis did not yield a complete conflict-free prefix.')
    }
    if (emptyPrefix) report.retained.traceReplay = 'passed'
    // Phase 2-C1: the Planner-start origin is the original input itself. The retained prefix is verified above,
    // exactly as in the control, but never projected into a Search.
    let projected = plannerStartOrigin ? { ...structuredClone(original), buildListEntries: [], conflictResolutions: [] }
      : retained.result.plan ? projectGlobalResearchPlan(retainedInput, retained.result.plan, dependencies) : { ...structuredClone(original), buildListEntries: [], conflictResolutions: [] }
    report.stage = 'discovery'
    const targets = new Map(original.targetWeapons.map(t => [t.id, t]))
    const pending = validation.validBuildListEntries.map(v => v.entry).filter(entry => !kept.has(entry.id))
      .sort((a, b) => comparePlannerEntryPriority(a, b, targets, original.buildListEntries))
    let ordered = orderGlobalResearchPending(pending, options.failedFirstTargetIds)
    if (options.attempt) {
      const ids = options.attempt.pendingTargetIds
      if (ids.length !== pending.length || new Set(ids).size !== ids.length || ids.some(id => !pending.some(e => e.targetWeaponId === id))) throw new Error('Attempt order must contain every pending Target exactly once.')
      ordered = ids.map(id => pending.find(e => e.targetWeaponId === id)!)
    }
    for (const oldEntry of ordered) {
      cancelled()
      const measurement: SearchMeasurement = { targetId: oldEntry.targetWeaponId, originalEntryId: oldEntry.id,
        generatedEntryId: null, generatedCandidateId: null, status: 'searching', elapsedMs: 0, applicationPlannerMs: 0,
        routeKind: null, estimatedOperationCount: null, advances: null, extent, observedPredictionReach: { normal: 0, gogma: 0, skill: 0 },
        predictionBoundaryReached: { normal: false, gogma: false, skillExisting: false, skillConversion: false }, searchedRoutes: [], skippedRoutes: [], error: null }
      report.searches.push(measurement)
      if (hasIntermediateStateSelection(oldEntry)) { measurement.status = 'checkpoint_blocked'; measurement.error = 'Phase 0 does not transfer or clear selected checkpoints.'; publish(); continue }
      publish()
      const originTarget = targets.get(oldEntry.targetWeaponId)!
      const searchInput = globalResearchSearchInput(projected, originTarget, extent)
      options.onSearchInput?.(structuredClone(searchInput))
      const raw = options.rawBlocks?.beginSearch(searchInput.targetWeaponId)
      const engine = observeGlobalResearchReach(raw?.engine ?? dependencies.rngEngine, searchInput, measurement.observedPredictionReach)
      const execution = { shouldCancel, yieldControl: options.yieldControl, now: () => GLOBAL_RESEARCH_TIME, nowMs }
      const observed = options.profiler?.begin(engine, execution, nowMs)
      if (observed) measurement.profile = observed.profile
      const searchStart = nowMs()
      let found: CandidateSearchResult
      try {
        found = await searchCandidates(searchInput, observed?.engine ?? engine, observed?.execution ?? execution)
      } catch (error) {
        measurement.status = error instanceof CandidateSearchError && error.code === 'cancelled' ? timedOut ? 'time_budget_reached' : 'cancelled' : 'search_error'
        measurement.error = error instanceof Error ? error.message : String(error)
        if (measurement.status === 'cancelled' || measurement.status === 'time_budget_reached') throw error
        continue
      } finally {
        raw?.end()
        measurement.elapsedMs = nowMs() - searchStart
        report.searchElapsedMs += measurement.elapsedMs
        measurement.predictionBoundaryReached = globalResearchBoundary(measurement.observedPredictionReach, extent)
        publish()
      }
      measurement.searchedRoutes = found.targetResult.searchedRoutes
      options.onSearchResult?.(structuredClone(found))
      measurement.skippedRoutes = found.targetResult.skippedRoutes
      let candidate = found.targetResult.candidate
      let candidateInput = searchInput
      let fallback: ExtentFallbackMeasurement | null = null
      if (!candidate) {
        measurement.status = found.targetResult.searchedRoutes.length ? 'not_found_within_extent' : 'unavailable'
        if (measurement.status === 'not_found_within_extent') options.onBoundedNoMatch?.(structuredClone({ searchIndex: report.searches.length - 1, originTarget, searchInput, measurement }))
        const request = measurement.status === 'not_found_within_extent' ? options.extentFallback?.request(structuredClone(measurement)) ?? null : null
        if (!request || !options.extentFallback) { publish(); continue }
        // Same projected snapshot, new request identity for the new extent; nothing is carried from the base Search.
        const fallbackInput = globalResearchSearchInput(projected, originTarget, { ...request.extent })
        const requestFingerprint = hashStableValue(fallbackInput)
        // Each Target is searched once per attempt, so a repeated request is an invariant failure, never a second episode.
        if (fallbackRequests.has(requestFingerprint)) throw new Error('Duplicate extent fallback request within one attempt.')
        fallbackRequests.add(requestFingerprint)
        fallback = { strategy: options.extentFallback.strategy, axis: request.axis, baseExtent: { ...extent }, extent: { ...fallbackInput.settings },
          searchRunId: fallbackInput.searchRunId, requestFingerprint, status: 'searching', stoppedBy: null, timeBudgetMs: options.extentFallback.timeBudgetMs, elapsedMs: 0,
          applicationPlannerMs: 0, routeKind: null, estimatedOperationCount: null, advances: null, observedPredictionReach: { normal: 0, gogma: 0, skill: 0 },
          predictionBoundaryReached: { normal: false, gogma: false, skillExisting: false, skillConversion: false }, searchedRoutes: [], skippedRoutes: [],
          generatedEntryId: null, generatedCandidateId: null, error: null }
        measurement.fallback = fallback
        const maxEpisodes = options.extentFallback.maxEpisodes
        if (maxEpisodes !== undefined && report.extentFallback!.searches >= maxEpisodes) {
          // Bounded: the Search is not started, and the Target is not silently left without a Candidate.
          fallback.status = 'episode_limit_reached'
          publish()
          report.status = 'blocked'
          throw new ExtentFallbackBlocked('Extent fallback episode limit reached; not a bounded no-match.')
        }
        publish()
        const fallbackStart = nowMs(), budget = options.extentFallback.timeBudgetMs
        let fallbackDeadline = false
        const run = await runGlobalResearchSearch(fallbackInput, dependencies.rngEngine, { yieldControl: options.yieldControl, nowMs,
          profiler: options.profiler, rawBlocks: options.rawBlocks,
          shouldCancel: () => { if (shouldCancel()) return true; if (nowMs() - fallbackStart >= budget) fallbackDeadline = true; return fallbackDeadline } })
        Object.assign(fallback, { elapsedMs: run.elapsedMs, observedPredictionReach: run.observedPredictionReach,
          predictionBoundaryReached: run.predictionBoundaryReached, error: run.error, ...(run.profile ? { profile: run.profile } : {}) })
        report.searchElapsedMs += run.elapsedMs
        report.extentFallback!.searches += 1
        report.extentFallback!.searchElapsedMs += run.elapsedMs
        if (run.failure === 'cancelled') {
          // A stopped fallback is neither a no-match nor a reason to continue without a Candidate.
          fallback.stoppedBy = timedOut ? 'attempt_budget' : fallbackDeadline ? 'fallback_budget' : 'external_cancel'
          fallback.status = fallback.stoppedBy === 'external_cancel' ? 'cancelled' : 'time_budget_reached'
          publish()
          if (fallback.stoppedBy !== 'fallback_budget') throw new CandidateSearchError('cancelled', 'Research cancelled or budget reached during extent fallback.')
          report.status = 'blocked'
          throw new ExtentFallbackBlocked('Extent fallback reached its Research time budget; not a bounded no-match.')
        }
        if (run.failure === 'search_error' || !run.result) {
          fallback.status = 'search_error'
          publish()
          report.status = 'blocked'
          throw new ExtentFallbackBlocked(`Extent fallback Search failed: ${run.error}`)
        }
        fallback.searchedRoutes = run.result.targetResult.searchedRoutes
        fallback.skippedRoutes = run.result.targetResult.skippedRoutes
        options.onFallbackSearchResult?.(structuredClone(run.result), structuredClone(fallback))
        candidate = run.result.targetResult.candidate
        if (!candidate) {
          fallback.status = run.result.targetResult.searchedRoutes.length ? 'not_found_within_extent' : 'unavailable'
          measurement.targetOutcome = 'unresolved_after_extent_fallback'
          publish()
          if (fallback.status === 'unavailable') { report.status = 'blocked'; throw new ExtentFallbackBlocked('Extent fallback searched no Route.') }
          continue
        }
        candidateInput = fallbackInput
        fallback.routeKind = candidate.route.kind
        fallback.estimatedOperationCount = candidate.estimatedOperationCount
        fallback.advances = { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance }
      } else {
        measurement.routeKind = candidate.route.kind
        measurement.estimatedOperationCount = candidate.estimatedOperationCount
        measurement.advances = { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance }
      }
      const chosen = candidate
      let entry: BuildListEntry
      try {
        entry = materializeGlobalResearchCandidate(original, candidateInput, chosen, materializationAlgorithm)
        const check = validatePlannerInput({ ...original, buildListEntries: [entry] }, dependencies)
        if (!check.isValid || check.excludedBuildListEntries.length) throw new Error(JSON.stringify({ issues: check.issues, exclusions: check.excludedBuildListEntries.map(e => e.reason) }))
      } catch (error) {
        if (fallback) {
          fallback.status = 'materialization_blocked'; fallback.error = String(error); publish()
          report.status = 'blocked'; throw new ExtentFallbackBlocked('Extent fallback Candidate could not be materialized.')
        }
        measurement.status = 'materialization_blocked'; measurement.error = String(error); publish(); continue
      }
      // Phase 2-C1: no single-Candidate application Planner and no projection; the next Search keeps the origin.
      if (!plannerStartOrigin) try {
        // Existing Planner + Replay applies each Route; no custom Route transition or RNG advance.
        const target = projected.targetWeapons.find(t => t.id === chosen.targetWeaponId)!
        const applicationInput = { ...projected, buildListEntries: [createBuildListEntry(chosen, target, { createdAt: GLOBAL_RESEARCH_TIME })] }
        const application = await fullRun(applicationInput, 'application', report.searches.length - 1)
        if (fallback) fallback.applicationPlannerMs = application.summary.elapsedMs
        else measurement.applicationPlannerMs = application.summary.elapsedMs
        if (!application.result.plan || application.result.termination.status !== 'completed' || application.result.conflicts.length || application.summary.rejected) throw new Error('Single Candidate full Planner did not complete.')
        projected = projectGlobalResearchPlan(applicationInput, application.result.plan, dependencies)
      } catch (error) {
        cancelled()
        if (fallback) {
          fallback.status = 'projection_failed'; fallback.error = String(error); publish()
          report.status = 'blocked'; throw new ExtentFallbackBlocked('Extent fallback Candidate could not be projected.')
        }
        measurement.status = 'projection_failed'; measurement.error = String(error); publish(); continue
      }
      replacements.set(oldEntry.id, entry)
      measurement.generatedEntryId = entry.id
      measurement.generatedCandidateId = entry.candidateId
      if (fallback) {
        // The base bounded no-match stays recorded as such; the Target outcome is a separate diagnostic.
        fallback.status = 'found'
        fallback.generatedEntryId = entry.id
        fallback.generatedCandidateId = entry.candidateId
        measurement.targetOutcome = 'resolved_by_extent_fallback'
      } else measurement.status = 'found'
      report.generatedReplacementCount = replacements.size
      publish()
    }
    // Preserve even failed/unsearched original Entries: do not hide failures by shrinking the denominator.
    const finalInput = { ...original, buildListEntries: original.buildListEntries.map(entry => replacements.get(entry.id) ?? entry) }
    report.stage = 'final_planner'
    publish()
    const final = await fullRun(finalInput, 'final')
    finalResult = final.result
    report.final = final.summary
    report.status = final.result.plan && final.result.termination.status === 'completed' && final.summary.completedTargetCount === report.planningTargetCount &&
      final.summary.conflicts === 0 && final.summary.rejected === 0 ? 'completed' : 'partial'
    report.stage = 'finished'
  } catch (error) {
    if (error instanceof CandidateSearchError && error.code === 'cancelled') report.status = timedOut ? 'time_budget_reached' : 'cancelled'
    else if (report.status !== 'blocked') report.status = 'error'
    report.error = error instanceof Error ? error.message : String(error)
  }
  publish()
  return { report, finalResult, generatedEntries: [...replacements.values()] }
}
