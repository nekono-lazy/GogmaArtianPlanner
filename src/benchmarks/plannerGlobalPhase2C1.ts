/**
 * Issue #154 Phase 2-C1: transient Research only. Never import from Production.
 *
 * Two variants of the Phase 1-E normal-2x-fallback Research, run from the same original Export input:
 * - `control`: the Phase 1-E / 2-A / 2-B autonomous Research unchanged (sequential projection).
 * - `origin-independent-canonical`: the same retained derivation, pending order, extent and normal fallback, but
 *   every pending Candidate Search starts from the one Planner-start origin (`searchOrigin: 'planner_start'`) and
 *   no single-Candidate application Planner feeds a later Search.
 * The ordinary Production Planner over the final Build List is the authority of the result. Everything else here is
 * a post-hoc, read-only summary of that final input and result: nothing feeds a Search or a Planner run, and no
 * oracle, lower bound or earlier Phase result is read (the 1,657 comparison lives in the separate analysis module).
 */
import { stableStringify } from '../domain/models/hashing'
import { hashStableValue } from '../domain/models/publicTypes'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import type { PlannerInput, PlannerResult } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import type { CandidateSearchInput } from '../domain/search/searchTypes'
import { PHASE2A_ATTEMPT_BUDGET_MS, PHASE2A_FALLBACK_BUDGET_MS } from './plannerGlobalBrowserBenchmarkRunner'
import { jsonSha256, plannerGlobalFallbackRecords, plannerGlobalSemantic, PlannerGlobalEvidenceCollector, reportWithoutProfiles, type Sha256Text } from './plannerGlobalBrowserEvidence'
import { createPhase1EFallback, derivedAttemptState, PHASE1E_BOUNDS } from './plannerGlobalOptimizationPhase1E'
import { GLOBAL_RESEARCH_EXTENT, globalResearchDependencies, runGlobalPlannerResearch, type GlobalResearchReport, type GlobalResearchSearchOrigin } from './plannerGlobalOptimizationResearch'
import { classifyAttempt, collectRetrySignals, stableResearchEntries } from './plannerGlobalOptimizationRetry'
import type { GlobalRawBlockResearch, RawBlockCacheMode } from './plannerGlobalRawBlocks'
import { researchFinalInput, summarizeFinalRoutes, summarizePlanPhysical, type Phase2BPlanPhysical, type Phase2BRouteSummary, type Phase2BStreamUse } from './plannerGlobalPhase2BPlan'

export type Phase2C1VariantId = 'control' | 'origin-independent-canonical'

export interface Phase2C1Variant {
  readonly id: Phase2C1VariantId
  readonly description: string
  readonly searchOrigin: GlobalResearchSearchOrigin
  /** Identical in both variants: the Phase 1-E normal-2x winner workload. */
  readonly fallbackAxis: 'normal'
  readonly baseExtent: typeof GLOBAL_RESEARCH_EXTENT
  readonly fallbackBudgetMs: number
  readonly fallbackMaxEpisodes: number
  readonly attemptBudgetMs: number
  readonly rawCache: RawBlockCacheMode
}

const shared = { fallbackAxis: 'normal' as const, baseExtent: GLOBAL_RESEARCH_EXTENT, fallbackBudgetMs: PHASE2A_FALLBACK_BUDGET_MS,
  fallbackMaxEpisodes: PHASE1E_BOUNDS.maxFallbackEpisodesPerAttempt, attemptBudgetMs: PHASE2A_ATTEMPT_BUDGET_MS, rawCache: 'per-search' as const }

export const PHASE2C1_VARIANTS: Readonly<Record<Phase2C1VariantId, Phase2C1Variant>> = {
  control: { id: 'control', searchOrigin: 'sequential_projection', ...shared,
    description: 'Phase 1-E normal-2x-fallback winner: each pending Search starts from the projection of the retained prefix and every earlier Candidate.' },
  'origin-independent-canonical': { id: 'origin-independent-canonical', searchOrigin: 'planner_start', ...shared,
    description: 'Same retained set, pending order, extent and normal fallback; every pending Search starts from the one Planner-start origin, independently.' },
}

export interface Phase2C1RunDependencies {
  readonly createEngine: () => RngEngine
  readonly createRawBlocks: (mode: RawBlockCacheMode) => GlobalRawBlockResearch
  readonly yieldControl?: () => Promise<void>
  readonly nowMs?: () => number
  readonly sha256: Sha256Text
  readonly shouldCancel?: () => boolean
}

/** The state part of a Search input (what a Search starts from), without the request fields. */
export function searchStateFingerprint(value: Pick<CandidateSearchInput, 'rngState' | 'normalCounters' | 'ownedWeapons' | 'targetWeapons'>): string {
  return hashStableValue({ rngState: value.rngState, normalCounters: value.normalCounters, ownedWeapons: value.ownedWeapons, targetWeapons: value.targetWeapons })
}

export interface Phase2C1SearchOriginObservation {
  readonly targetWeaponId: string
  readonly stateFingerprint: string
  /** Whether the Search started from the Planner-start origin (the original input's state). */
  readonly equalsPlannerStartOrigin: boolean
}

export async function runPhase2C1Variant(input: PlannerInput, variant: Phase2C1Variant, dependencies: Phase2C1RunDependencies) {
  const now = dependencies.nowMs ?? (() => performance.now())
  const engine = dependencies.createEngine()
  const plannerDependencies = globalResearchDependencies(engine)
  const rawBlocks = dependencies.createRawBlocks(variant.rawCache)
  const evidence = new PlannerGlobalEvidenceCollector(dependencies.sha256)
  const originFingerprint = searchStateFingerprint(input)
  const searchOrigins: Phase2C1SearchOriginObservation[] = []
  const priorityEntries = stableResearchEntries(input).map(e => ({ id: e.id as string, targetWeaponId: e.targetWeaponId as string }))
  const started = now()
  const result = await runGlobalPlannerResearch(input, plannerDependencies, {
    extent: { ...variant.baseExtent }, rawBlocks, onSearchResult: evidence.onSearchResult, onFallbackSearchResult: evidence.onFallbackSearchResult,
    extentFallback: createPhase1EFallback(variant.fallbackAxis, variant.fallbackBudgetMs, { ...PHASE1E_BOUNDS, maxFallbackEpisodesPerAttempt: variant.fallbackMaxEpisodes }),
    timeBudgetMs: variant.attemptBudgetMs, nowMs: now, yieldControl: dependencies.yieldControl, shouldCancel: dependencies.shouldCancel,
    // Observation only (a copy): which state each base Search started from.
    onSearchInput: searchInput => {
      const stateFingerprint = searchStateFingerprint(searchInput)
      searchOrigins.push({ targetWeaponId: searchInput.targetWeaponId, stateFingerprint, equalsPlannerStartOrigin: stateFingerprint === originFingerprint })
    },
    ...(variant.searchOrigin === 'sequential_projection' ? {} : { searchOrigin: variant.searchOrigin }),
  })
  const calculationElapsedMs = now() - started
  rawBlocks.endRun()
  const report = reportWithoutProfiles(result.report)
  const signals = collectRetrySignals(input, result.report, result.finalResult, result.generatedEntries)
  const stop = classifyAttempt(result.report, signals)
  const state = derivedAttemptState(report.retainedOriginalEntryIds, priorityEntries, GLOBAL_RESEARCH_EXTENT)
  const fallbacks = plannerGlobalFallbackRecords(report)
  const collected = await evidence.finish(result.finalResult, result.generatedEntries)
  // Phase 1-E / 2-A semantic structure, field for field: the control must reproduce the Phase 2-A / 2-B semantic SHA.
  const semantic = plannerGlobalSemantic({ report, state, fallbacks, evidence: collected, stop })
  const semanticSha256 = await jsonSha256(dependencies.sha256, semantic)
  const analysis = analyzePhase2C1Run(input, report, result.generatedEntries, result.finalResult, engine, searchOrigins, originFingerprint)
  // Post-hoc diagnostic only (outside calculationElapsedMs): the ordinary Production Planner over the ORIGINAL Build
  // List, compared Target by Target with the final result. It feeds nothing back into the run.
  const baselineStarted = now()
  const baseline = await createProductionPlan(input, globalResearchDependencies(dependencies.createEngine()))
  const baselineComparison = { ...comparePlannerOutcomes(input, baseline, researchFinalInput(input, report, result.generatedEntries), result.finalResult),
    elapsedMs: now() - baselineStarted }
  return { variant, report, stop, state, priorityEntries, semanticSha256, evidence: collected, searchOrigins, analysis, baselineComparison,
    timing: { calculationElapsedMs, searchElapsedMs: report.searchElapsedMs, fallbackSearchElapsedMs: report.extentFallback?.searchElapsedMs ?? 0,
      plannerElapsedMs: report.plannerElapsedMs, plannerFullRunCount: report.plannerFullRunCount, candidateSearches: report.searches.length,
      fallbackEpisodes: report.extentFallback?.searches ?? 0 } }
}

// ---------------------------------------------------------------------------------------------------------------
// Post-hoc analysis (read-only; never fed back into a Search or a Planner run).

export interface Phase2C1StreamPositions {
  readonly first: number
  readonly last: number
  readonly operations: number
  readonly required: readonly number[]
  readonly requiredMax: number | null
  readonly contiguous: boolean
}

export interface Phase2C1CandidateSummary {
  readonly discoveryIndex: number
  readonly targetWeaponId: string
  readonly weaponTypeId: string
  readonly elementId: string
  readonly originalEntryId: string
  readonly found: boolean
  /** Which Search produced the final Entry: the base extent, the normal x2 fallback, or none (original Entry kept). */
  readonly foundBy: 'base_search' | 'normal_fallback' | null
  readonly baseStatus: string
  readonly fallbackStatus: string | null
  readonly generatedEntryId: string | null
  /**
   * Whether the generated Entry has the same Candidate semantics as the original Export Entry of this Target
   * (`entryCandidateSemantics`: Route, final weapon, estimates and the two hashes; never IDs). null when none was generated.
   */
  readonly sameCandidateAsOriginalEntry: boolean | null
  readonly sourceKind: 'owned' | 'new_normal' | null
  readonly sourceOwnedWeaponId: string | null
  readonly routeKind: string | null
  readonly estimatedOperationCount: number | null
  readonly estimatedAdvances: { readonly normal: number | null; readonly gogma: number; readonly skill: number } | null
  readonly normalPosition: number | null
  readonly normalCounterId: string | null
  readonly conversionSkillPosition: number | null
  readonly normal: Phase2C1StreamPositions | null
  readonly gogma: Phase2C1StreamPositions | null
  readonly skill: Phase2C1StreamPositions | null
}

function positions(use: Phase2BStreamUse | null): Phase2C1StreamPositions | null {
  if (!use) return null
  return { first: use.first, last: use.last, operations: use.operations, required: [...use.required],
    requiredMax: use.required.length ? Math.max(...use.required) : null, contiguous: use.contiguous }
}

/** One stream's static envelope over a Route set: max(route last required position) + 1, never a Plan step count. */
export interface Phase2C1StreamEnvelope {
  readonly stream: string
  readonly weaponTypeId: string | null
  readonly origin: number
  /** max(required unit position) + 1 over the Route set; the origin when no Route has a required unit there. */
  readonly requiredEnd: number
  /** max(last unit position) + 1 over the Route set (skippable units included). */
  readonly lastEnd: number
  readonly requiredMax: number | null
  readonly routes: number
  /** requiredEnd - origin: the virtual stream advance of this Route set, if it could execute without conflicts. */
  readonly virtualAdvance: number
}

export interface Phase2C1StaticEnvelope {
  readonly routeSet: string
  readonly streams: readonly Phase2C1StreamEnvelope[]
  /** Sum of virtualAdvance: a static cost of the Route set, NOT the steps of an executable Production Plan. */
  readonly virtualStreamEnvelopeCost: number
}

export function staticStreamEnvelope(routeSet: string, routes: readonly Phase2BRouteSummary[], input: PlannerInput): Phase2C1StaticEnvelope {
  const skillOrigin = input.rngState.skillCounter.value, gogmaOrigin = input.rngState.gogmaCounter.value
  if (skillOrigin === null || gogmaOrigin === null) throw new Error('Planner origin lacks a Skill / Gogma Counter.')
  const streams: Phase2C1StreamEnvelope[] = []
  const add = (stream: string, weaponTypeId: string | null, origin: number, uses: readonly (Phase2BStreamUse | null)[]) => {
    const present = uses.filter((use): use is Phase2BStreamUse => use !== null)
    const required = present.flatMap(use => use.required)
    const requiredMax = required.length ? Math.max(...required) : null
    const requiredEnd = requiredMax === null ? origin : Math.max(origin, requiredMax + 1)
    const lastEnd = present.reduce((max, use) => Math.max(max, use.last + 1), origin)
    streams.push({ stream, weaponTypeId, origin, requiredEnd, lastEnd, requiredMax, routes: present.length, virtualAdvance: requiredEnd - origin })
  }
  add('skill', null, skillOrigin, routes.map(route => route.skill))
  add('gogma', null, gogmaOrigin, routes.map(route => route.gogma))
  for (const counter of [...input.normalCounters].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (counter.counter === null) continue
    const uses = routes.filter(route => route.normalCounterId === counter.id).map(route => route.normal)
    if (uses.some(use => use !== null)) add(`normal:${counter.id}`, counter.weaponTypeId, counter.counter, uses)
  }
  return { routeSet, streams, virtualStreamEnvelopeCost: streams.reduce((sum, row) => sum + row.virtualAdvance, 0) }
}

export interface Phase2C1PositionCollision {
  readonly stream: string
  readonly position: number
  readonly targetWeaponIds: readonly string[]
  readonly entryOrigins: readonly string[]
}

export interface Phase2C1Collisions {
  /** Owned weapons that two or more final Entries use as their Route source. */
  readonly sourceCollisions: readonly { readonly ownedWeaponId: string; readonly targetWeaponIds: readonly string[]; readonly entryOrigins: readonly string[] }[]
  readonly sourceCollisionTargets: number
  /** Required unit positions two or more final Entries need on one stream (a static count, not a Planner verdict). */
  readonly requiredPositionCollisions: { readonly normal: readonly Phase2C1PositionCollision[]; readonly skill: readonly Phase2C1PositionCollision[]; readonly gogma: readonly Phase2C1PositionCollision[] }
  readonly requiredPositionCollisionCounts: { readonly normal: number; readonly skill: number; readonly gogma: number }
}

export function requiredCollisions(routes: readonly Phase2BRouteSummary[]): Phase2C1Collisions {
  const bySource = new Map<string, Phase2BRouteSummary[]>()
  for (const route of routes) if (route.sourceOwnedWeaponId !== null) bySource.set(route.sourceOwnedWeaponId, [...(bySource.get(route.sourceOwnedWeaponId) ?? []), route])
  const sourceCollisions = [...bySource].filter(([, list]) => list.length > 1).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([ownedWeaponId, list]) => ({ ownedWeaponId, targetWeaponIds: list.map(r => r.targetWeaponId), entryOrigins: list.map(r => r.entryOrigin) }))
  const collide = (streamOf: (route: Phase2BRouteSummary) => [string, Phase2BStreamUse | null]): Phase2C1PositionCollision[] => {
    const at = new Map<string, Phase2BRouteSummary[]>()
    for (const route of routes) {
      const [stream, use] = streamOf(route)
      for (const position of new Set(use?.required ?? [])) at.set(`${stream}\u0000${position}`, [...(at.get(`${stream}\u0000${position}`) ?? []), route])
    }
    return [...at].filter(([, list]) => list.length > 1).map(([key, list]) => {
      const [stream, position] = key.split('\u0000')
      return { stream, position: Number(position), targetWeaponIds: list.map(r => r.targetWeaponId), entryOrigins: list.map(r => r.entryOrigin) }
    }).sort((a, b) => a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.position - b.position)
  }
  const normal = collide(route => [`normal:${route.normalCounterId ?? ''}`, route.normal])
  const skill = collide(route => ['skill', route.skill]), gogma = collide(route => ['gogma', route.gogma])
  return { sourceCollisions, sourceCollisionTargets: sourceCollisions.reduce((sum, row) => sum + row.targetWeaponIds.length, 0),
    requiredPositionCollisions: { normal, skill, gogma }, requiredPositionCollisionCounts: { normal: normal.length, skill: skill.length, gogma: gogma.length } }
}

/** The Phase 2-B stacking metric, over the final input Routes in the Research discovery order (no Plan needed). */
export interface Phase2C1StackingRow {
  readonly discoveryIndex: number
  readonly targetWeaponId: string
  readonly stream: 'gogma' | 'skill'
  readonly frontierBefore: number
  readonly first: number
  readonly last: number
  readonly operations: number
  readonly startsAtOrAfterFrontier: boolean
}

export function frontierStacking(routes: readonly Phase2BRouteSummary[], discoveryOrder: readonly string[], input: PlannerInput) {
  const byTarget = new Map(routes.map(route => [route.targetWeaponId, route]))
  const retained = routes.filter(route => route.entryOrigin === 'retained_original')
  const generated = discoveryOrder.map(id => byTarget.get(id))
    .filter((route): route is Phase2BRouteSummary => route !== undefined && (route.entryOrigin === 'generated_base_search' || route.entryOrigin === 'generated_extent_fallback'))
  const rows: Phase2C1StackingRow[] = []
  for (const stream of ['gogma', 'skill'] as const) {
    const origin = stream === 'gogma' ? input.rngState.gogmaCounter.value! : input.rngState.skillCounter.value!
    let frontier = retained.reduce((max, route) => route[stream] ? Math.max(max, route[stream]!.last + 1) : max, origin)
    for (const route of generated) {
      const use = route[stream]
      if (!use) continue
      rows.push({ discoveryIndex: discoveryOrder.indexOf(route.targetWeaponId), targetWeaponId: route.targetWeaponId, stream, frontierBefore: frontier,
        first: use.first, last: use.last, operations: use.operations, startsAtOrAfterFrontier: use.first >= frontier })
      frontier = Math.max(frontier, use.last + 1)
    }
  }
  const count = (stream?: 'gogma' | 'skill') => {
    const scoped = rows.filter(row => stream === undefined || row.stream === stream)
    return { total: scoped.length, startsAtOrAfterFrontier: scoped.filter(row => row.startsAtOrAfterFrontier).length,
      startsBeforeFrontier: scoped.filter(row => !row.startsAtOrAfterFrontier).length }
  }
  return { rows, all: count(), gogma: count('gogma'), skill: count('skill') }
}

/** A PlanConflict read at the Target level (Entry IDs differ between an original and a regenerated Build List). */
export function conflictSignature(kind: string, targetWeaponIds: readonly string[]): string {
  return `${kind}:${[...targetWeaponIds].sort().join(',')}`
}

/** Target-level comparison of two Production Planner results (e.g. the original Build List vs the final Research input). */
export function comparePlannerOutcomes(aInput: PlannerInput, a: PlannerResult, bInput: PlannerInput, b: PlannerResult | null) {
  const describe = (input: PlannerInput, result: PlannerResult | null) => {
    const targetOf = new Map(input.buildListEntries.map(entry => [entry.id as string, entry.targetWeaponId as string]))
    const selected = [...(result?.plan?.selectedBuildListEntryIds ?? [])].map(id => targetOf.get(id)!).sort()
    const conflicts = (result?.conflicts ?? []).map(conflict => conflictSignature(conflict.kind, conflict.buildListEntryIds.map(id => targetOf.get(id)!))).sort()
    return { selectedTargets: selected, conflictSignatures: conflicts, steps: result?.plan?.steps.length ?? null,
      completedTargetCount: result?.termination.completedTargetCount ?? null, termination: result?.termination.status ?? null }
  }
  const left = describe(aInput, a), right = describe(bInput, b)
  const onlyIn = (x: readonly string[], y: readonly string[]) => x.filter(value => !y.includes(value))
  return { original: left, final: right,
    sameConflictSignatures: left.conflictSignatures.length === right.conflictSignatures.length && left.conflictSignatures.every((value, index) => value === right.conflictSignatures[index]),
    selectedOnlyInOriginal: onlyIn(left.selectedTargets, right.selectedTargets), selectedOnlyInFinal: onlyIn(right.selectedTargets, left.selectedTargets),
    conflictsOnlyInOriginal: onlyIn(left.conflictSignatures, right.conflictSignatures), conflictsOnlyInFinal: onlyIn(right.conflictSignatures, left.conflictSignatures) }
}

/** The Candidate semantics of an Entry (never its ID, Candidate ID, search run or creation time). */
export function entryCandidateSemantics(entry: BuildListEntry) {
  const c = entry.candidateSnapshot
  return { targetWeaponId: c.targetWeaponId, route: c.route, finalBonuses: c.finalBonuses, restorationBonusScope: c.restorationBonusScope,
    seriesSkillId: c.seriesSkillId, groupSkillId: c.groupSkillId, estimatedOperationCount: c.estimatedOperationCount,
    estimatedNormalAdvance: c.estimatedNormalAdvance, estimatedGogmaAdvance: c.estimatedGogmaAdvance, estimatedSkillAdvance: c.estimatedSkillAdvance,
    searchStateHash: c.searchStateHash, referencedOwnedWeaponsHash: c.referencedOwnedWeaponsHash }
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}

export function analyzePhase2C1Run(input: PlannerInput, report: GlobalResearchReport, generatedEntries: readonly BuildListEntry[], finalResult: PlannerResult | null,
  engine: RngEngine, searchOrigins: readonly Phase2C1SearchOriginObservation[], originFingerprint: string) {
  if (report.stage !== 'finished' && report.stage !== 'final_planner') {
    return { finished: false as const, stage: report.stage, status: report.status, error: report.error }
  }
  const finalInput = researchFinalInput(input, report, generatedEntries)
  const routes = summarizeFinalRoutes(finalInput, report, engine)
  const routeByTarget = new Map(routes.map(route => [route.targetWeaponId, route]))
  const targets = new Map(input.targetWeapons.map(target => [target.id as string, target]))
  const originalEntries = new Map(input.buildListEntries.map(entry => [entry.id as string, entry]))
  const generatedById = new Map(generatedEntries.map(entry => [entry.id as string, entry]))
  const candidates: Phase2C1CandidateSummary[] = report.searches.map((search, discoveryIndex) => {
    const generatedEntryId = search.fallback?.generatedEntryId ?? search.generatedEntryId
    const route = generatedEntryId !== null ? routeByTarget.get(search.targetId) ?? null : null
    if (generatedEntryId !== null && route?.buildListEntryId !== generatedEntryId) throw new Error(`Generated Entry ${generatedEntryId} is not the final Route of ${search.targetId}.`)
    const target = targets.get(search.targetId)!
    return { discoveryIndex, targetWeaponId: search.targetId, weaponTypeId: target.weaponTypeId, elementId: target.elementId, originalEntryId: search.originalEntryId,
      found: generatedEntryId !== null, foundBy: search.fallback?.generatedEntryId ? 'normal_fallback' : search.generatedEntryId ? 'base_search' : null,
      baseStatus: search.status, fallbackStatus: search.fallback?.status ?? null, generatedEntryId,
      sameCandidateAsOriginalEntry: generatedEntryId === null ? null
        : stableStringify(entryCandidateSemantics(generatedById.get(generatedEntryId)!)) === stableStringify(entryCandidateSemantics(originalEntries.get(search.originalEntryId)!)),
      sourceKind: route?.sourceKind ?? null, sourceOwnedWeaponId: route?.sourceOwnedWeaponId ?? null, routeKind: route?.routeKind ?? null,
      estimatedOperationCount: route?.estimatedOperationCount ?? null, estimatedAdvances: route?.estimatedAdvances ?? null,
      normalPosition: route?.normalPosition ?? null, normalCounterId: route?.normalCounterId ?? null, conversionSkillPosition: route?.conversionPosition ?? null,
      normal: positions(route?.normal ?? null), gogma: positions(route?.gogma ?? null), skill: positions(route?.skill ?? null) }
  })
  const entryById = new Map(finalInput.buildListEntries.map(entry => [entry.id as string, entry]))
  const originOfEntry = new Map(routes.map(route => [route.buildListEntryId, route.entryOrigin]))
  const describeEntry = (id: string) => ({ buildListEntryId: id, targetWeaponId: entryById.get(id)?.targetWeaponId ?? null, entryOrigin: originOfEntry.get(id) ?? null })
  const plan = finalResult?.plan ?? null
  const selected = new Set<string>(plan?.selectedBuildListEntryIds ?? [])
  let physical: Phase2BPlanPhysical | null = null
  if (plan) physical = summarizePlanPhysical(plan, finalInput)
  const final = finalResult === null ? null : {
    termination: finalResult.termination,
    planExists: plan !== null,
    planningTargetCount: finalResult.termination.totalTargetCount,
    completedTargetCount: finalResult.termination.completedTargetCount,
    selected: plan?.selectedBuildListEntryIds.length ?? 0,
    selectedByEntryOrigin: countBy([...selected], id => originOfEntry.get(id) ?? 'unknown'),
    conflicts: finalResult.conflicts.length,
    conflictsByKind: countBy(finalResult.conflicts, conflict => conflict.kind),
    conflictDetails: finalResult.conflicts.map(conflict => ({ id: conflict.id, kind: conflict.kind, reason: conflict.reason,
      participants: conflict.buildListEntryIds.map(describeEntry), selectedBuildListEntryId: conflict.selectedBuildListEntryId,
      recommendedBuildListEntryId: conflict.recommendedBuildListEntryId })),
    conflictParticipantTargets: new Set(finalResult.conflicts.flatMap(conflict => conflict.buildListEntryIds.map(id => entryById.get(id)?.targetWeaponId))).size,
    rejected: plan?.rejectedBuildListEntries.length ?? 0,
    rejectedByReason: countBy(plan?.rejectedBuildListEntries ?? [], row => row.reason),
    resourceConflictRejected: plan?.rejectedBuildListEntries.filter(row => row.reason === 'resource_conflict').length ?? 0,
    rejectedDetails: (plan?.rejectedBuildListEntries ?? []).map(row => ({ ...describeEntry(row.buildListEntryId), reason: row.reason, detail: row.detail })),
    notSelectedTargets: routes.filter(route => !selected.has(route.buildListEntryId)).map(route => ({ targetWeaponId: route.targetWeaponId, entryOrigin: route.entryOrigin })),
    warnings: finalResult.warnings.map(warning => ({ kind: warning.kind, message: warning.message })),
    warningsByKind: countBy(finalResult.warnings, warning => warning.kind),
    planSteps: plan?.steps.length ?? null,
    expandedStates: finalResult.termination.expandedStates,
    // A Plan exists only after Trace Replay accepted the scheduler trace (the shared Plan generation tail).
    traceReplay: plan ? 'passed' : 'not_run',
    physical: physical && { planSteps: physical.planSteps, physicalOperations: physical.physicalOperations, operationCounts: physical.operationCounts,
      streams: physical.streams, identityHolds: physical.identityHolds, sharedPhysicalSteps: physical.sharedPhysicalSteps },
  }
  const stacking = frontierStacking(routes, report.searches.map(search => search.targetId), input)
  const selectedRoutes = routes.filter(route => selected.has(route.buildListEntryId))
  return {
    finished: true as const,
    retainedCount: report.retainedOriginalEntryIds.length,
    pendingCount: report.searches.length,
    discoveryOrder: report.searches.map(search => search.targetId),
    searchOrigin: {
      plannerStartOriginFingerprint: originFingerprint,
      searches: searchOrigins.length,
      fromPlannerStartOrigin: searchOrigins.filter(row => row.equalsPlannerStartOrigin).length,
      distinctStates: new Set(searchOrigins.map(row => row.stateFingerprint)).size,
    },
    candidateCounts: {
      found: candidates.filter(c => c.found).length, foundByBase: candidates.filter(c => c.foundBy === 'base_search').length,
      foundByNormalFallback: candidates.filter(c => c.foundBy === 'normal_fallback').length, notFound: candidates.filter(c => !c.found).length,
      fallbackEpisodes: candidates.filter(c => c.fallbackStatus !== null).length,
      sameCandidateAsOriginalEntry: candidates.filter(c => c.sameCandidateAsOriginalEntry === true).length,
      byBaseStatus: countBy(candidates, c => c.baseStatus), byFallbackStatus: countBy(candidates.filter(c => c.fallbackStatus !== null), c => c.fallbackStatus!),
      bySourceKind: countBy(candidates.filter(c => c.found), c => c.sourceKind!), byRouteKind: countBy(candidates.filter(c => c.found), c => c.routeKind!),
      estimatedOperationSum: candidates.reduce((sum, c) => sum + (c.estimatedOperationCount ?? 0), 0),
    },
    candidates,
    routes,
    routeOperationSum: routes.reduce((sum, route) => sum + route.routeOperationCount, 0),
    final,
    staticEnvelope: {
      finalInput: staticStreamEnvelope('final_input_all_entries', routes, finalInput),
      selected: plan ? staticStreamEnvelope('final_plan_selected_entries', selectedRoutes, finalInput) : null,
      generatedOnly: staticStreamEnvelope('generated_entries_only', routes.filter(route => route.entryOrigin.startsWith('generated_')), finalInput),
    },
    collisions: requiredCollisions(routes),
    stacking,
  }
}

export type Phase2C1RunResult = Awaited<ReturnType<typeof runPhase2C1Variant>>
export type Phase2C1Analysis = ReturnType<typeof analyzePhase2C1Run>
