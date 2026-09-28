/**
 * Issue #154 Phase 2-C2.5-C: hypothesis measures and verdict rules, Research only. Never import from Production.
 *
 * The rules below were fixed BEFORE the formal profiling run (they are committed with the profiling code). They read
 * only numbers the two analyses produce:
 *
 * - snapshot measure  the collective edge-cut size of the hypothesis' edge set, restricted to nodes allocated after the
 *                     pre-Search baseline, as a share of every such node reachable from the synthetic root;
 * - sampling measure  the share of sampled live bytes whose attributed Repository frame falls into the hypothesis'
 *                     source categories, in the `no_inlining` variant's profile of the highest threshold reached
 *                     (function-precise attribution; the `jit_default` share is reported beside it).
 *
 * Per context: `strong` when both measures are >= 25 %, `none` when both are < 5 %, `mixed` otherwise, `missing` when
 * either measure is unavailable (an analysis failure is never read as 0 %). Across contexts: `supported` when every
 * context is strong, `not_supported` when every context is none, `inconclusive` when no context has both measures,
 * `partially_supported` otherwise. The edge-cut measure is what the listed edges alone keep alive; it is not a
 * dominator-tree retained size, and overlapping hypotheses are never summed.
 */
import type { HeapSnapshotAnalysis, HeapSnapshotEdgeGroup } from './plannerGlobalPhase2C25CSnapshotAnalysis'
import type { Phase2C25CProfileAnalysis, Phase2C25CSourceCategory } from './plannerGlobalPhase2C25CProfileAnalysis'

export type Phase2C25CHypothesisId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7'

export interface Phase2C25CHypothesis {
  id: Phase2C25CHypothesisId
  title: string
  samplingCategories: Phase2C25CSourceCategory[]
  snapshotEdgeGroup: HeapSnapshotEdgeGroup
}

/** Holder signatures (`heapSnapshotNodeSignature()` form) of the Search structures the hypotheses name. */
export const PHASE2C25C_HOLDER_SIGNATURES = {
  reservedBonusSet: 'object:Object{cutByExtent,depths,done,frontier,index,unsupported,windows}',
  reservedSkillSet: 'object:Object{cutByExtent,depths,done,frontier,index,windows}',
  reservedBonusSolution: 'object:Object{bonuses,depth,lastResetDepth,restorationBonusScope,results,steps}',
  reservedBonusState: 'object:Object{bonuses,depth,familyLayoutKey,lastResetDepth,nextFrom,position,results,scope}',
  reservedBonusResultNode: 'object:Object{depth,previous,result,step}',
  searchWorkQueue: 'object:SearchWorkQueue{',
  targetSearchScheduler: 'object:TargetSearchScheduler{',
} as const

export const PHASE2C25C_HYPOTHESES: readonly Phase2C25CHypothesis[] = [
  { id: 'H1', title: 'held-aware Bonus ReservedSet.depths keeps every generated state as a published solution',
    samplingCategories: ['reserved_bonus_generation', 'reserved_bonus_steps'],
    snapshotEdgeGroup: { group: 'H1', edgeNames: ['depths'], holderSignaturePrefixes: [PHASE2C25C_HOLDER_SIGNATURES.reservedBonusSet], edgeTypes: ['property'] } },
  { id: 'H2', title: 'reservedBonusSteps() materializes a full steps[] per published solution',
    samplingCategories: ['reserved_bonus_steps'],
    snapshotEdgeGroup: { group: 'H2', edgeNames: ['steps'], holderSignaturePrefixes: [PHASE2C25C_HOLDER_SIGNATURES.reservedBonusSolution], edgeTypes: ['property'] } },
  { id: 'H3', title: 'the ReservedBonusResultNode.previous history chain',
    samplingCategories: ['reserved_bonus_generation'],
    snapshotEdgeGroup: { group: 'H3', edgeNames: ['results', 'previous'],
      holderSignaturePrefixes: [PHASE2C25C_HOLDER_SIGNATURES.reservedBonusSolution, PHASE2C25C_HOLDER_SIGNATURES.reservedBonusState, PHASE2C25C_HOLDER_SIGNATURES.reservedBonusResultNode],
      edgeTypes: ['property'] } },
  { id: 'H4', title: 'scheduler channel.retained keeps every evaluated Bonus / Skill solution',
    samplingCategories: ['scheduler_channel', 'bonus_solution_materialization', 'stream_solution_evaluation', 'semantic_keys'],
    snapshotEdgeGroup: { group: 'H4', edgeNames: ['retained'], holderSignaturePrefixes: null, edgeTypes: ['property'] } },
  { id: 'H5', title: 'createLazyIdealCross() bonuses / skills / nextColumn / waiting',
    samplingCategories: ['lazy_ideal_cross'],
    snapshotEdgeGroup: { group: 'H5', edgeNames: ['bonuses', 'skills', 'nextColumn', 'waiting'], holderSignaturePrefixes: null, edgeTypes: ['context'] } },
  { id: 'H6', title: 'SearchWorkQueue / pending closures',
    samplingCategories: ['search_work_queue'],
    snapshotEdgeGroup: { group: 'H6', edgeNames: ['heap', 'queue'],
      holderSignaturePrefixes: [PHASE2C25C_HOLDER_SIGNATURES.searchWorkQueue, PHASE2C25C_HOLDER_SIGNATURES.targetSearchScheduler], edgeTypes: ['property'] } },
  { id: 'H7', title: 'prediction memo / reservation windows',
    samplingCategories: ['rng_prediction', 'reservation_window'],
    snapshotEdgeGroup: { group: 'H7', edgeNames: ['windows', 'resetPredictions', 'keepPredictions', 'predictions'], holderSignaturePrefixes: null, edgeTypes: ['property', 'context'] } },
]

/** Descriptive edge sets reported beside the hypotheses (not verdicts). */
export const PHASE2C25C_DESCRIPTIVE_EDGE_GROUPS: readonly HeapSnapshotEdgeGroup[] = [
  { group: 'route_bonus_solution_operations', edgeNames: ['operations', 'amendmentResults'], holderSignaturePrefixes: ['object:Object{amendmentResults,finalBonuses,gogmaAdvance,lastResetDepth,operations,restorationBonusScope}'], edgeTypes: ['property'] },
  { group: 'evaluated_solution_keys', edgeNames: ['operationTypeKey', 'retentionKey', 'bonusKey'], holderSignaturePrefixes: null, edgeTypes: ['property'] },
  { group: 'evaluated_solution_body', edgeNames: ['solution'], holderSignaturePrefixes: null, edgeTypes: ['property'] },
  { group: 'reserved_sets_closure', edgeNames: ['reservedSets'], holderSignaturePrefixes: null, edgeTypes: ['context'] },
]

/** Shapes that get a retaining path example beside the top new signatures (post-hoc, descriptive). */
export const PHASE2C25C_PATH_SIGNATURE_PREFIXES: readonly string[] = [
  'object:Object{bonusKey,idealMatch,index,',
  'object:Object{bonusKey,idealMatch,matchedIdealBonusCount,',
  PHASE2C25C_HOLDER_SIGNATURES.reservedBonusSolution,
  PHASE2C25C_HOLDER_SIGNATURES.reservedBonusState,
  PHASE2C25C_HOLDER_SIGNATURES.reservedBonusResultNode,
]

/** The long-lived Search structure root of the persistent / in-flight split (post-hoc, descriptive). */
export const PHASE2C25C_PERSISTENT_ROOT_PREFIXES: readonly string[] = [PHASE2C25C_HOLDER_SIGNATURES.targetSearchScheduler]

/** Post-hoc census (descriptive, not a verdict input): the Ideal flag of every evaluated solution a channel retains. */
export const PHASE2C25C_ELEMENT_PROPERTY_CENSUS: readonly { edgeName: string; property: string }[] = [{ edgeName: 'retained', property: 'idealMatch' }]

export const PHASE2C25C_VERDICT_RULE = {
  strongShare: 0.25,
  noneShare: 0.05,
  samplingVariant: 'no_inlining',
  text: 'Per context: strong when the snapshot edge-cut share (new nodes) and the no_inlining sampling share at the highest reached threshold are both >= 25 %, ' +
    'none when both are < 5 %, mixed otherwise, missing when either is unavailable. supported: every context strong; not_supported: every context none; ' +
    'inconclusive: no context has both measures; partially_supported: otherwise.',
} as const

export type Phase2C25CContextStrength = 'strong' | 'none' | 'mixed' | 'missing'
export type Phase2C25CVerdict = 'supported' | 'partially_supported' | 'not_supported' | 'inconclusive'

export interface Phase2C25CHypothesisMeasure {
  contextKey: string
  snapshotShare: number | null
  snapshotNewEdgeCutBytes: number | null
  snapshotMatchedEdges: number | null
  samplingShare: number | null
  samplingShareJitDefault: number | null
  samplingThresholdMiB: number | null
  strength: Phase2C25CContextStrength
}

export function phase2c25cSnapshotShare(analysis: HeapSnapshotAnalysis | null, group: string): { share: number | null; bytes: number | null; matchedEdges: number | null } {
  if (analysis === null) return { share: null, bytes: null, matchedEdges: null }
  const cut = analysis.groupEdgeCuts.find(g => g.group === group)
  if (!cut) throw new Error(`The snapshot analysis has no edge group ${group}.`)
  const denominator = analysis.reachableFromRoot.newSize
  return { share: denominator === 0 ? null : cut.edgeCut.newSize / denominator, bytes: cut.edgeCut.newSize, matchedEdges: cut.matchedEdges }
}

export function phase2c25cSamplingShare(analysis: Phase2C25CProfileAnalysis | null, categories: readonly Phase2C25CSourceCategory[]): number | null {
  if (analysis === null || analysis.totalSampledBytes === 0) return null
  const bytes = analysis.categories.filter(c => categories.includes(c.category)).reduce((sum, c) => sum + c.sampledSelfBytes, 0)
  return bytes / analysis.totalSampledBytes
}

export function phase2c25cContextStrength(snapshotShare: number | null, samplingShare: number | null): Phase2C25CContextStrength {
  if (snapshotShare === null || samplingShare === null) return 'missing'
  if (snapshotShare >= PHASE2C25C_VERDICT_RULE.strongShare && samplingShare >= PHASE2C25C_VERDICT_RULE.strongShare) return 'strong'
  if (snapshotShare < PHASE2C25C_VERDICT_RULE.noneShare && samplingShare < PHASE2C25C_VERDICT_RULE.noneShare) return 'none'
  return 'mixed'
}

export function phase2c25cVerdict(strengths: readonly Phase2C25CContextStrength[]): Phase2C25CVerdict {
  const available = strengths.filter(s => s !== 'missing')
  if (available.length === 0) return 'inconclusive'
  if (available.length === strengths.length && strengths.every(s => s === 'strong')) return 'supported'
  if (available.length === strengths.length && strengths.every(s => s === 'none')) return 'not_supported'
  return 'partially_supported'
}

export interface Phase2C25CContextAnalyses {
  contextKey: string
  snapshot: HeapSnapshotAnalysis | null
  /** Highest-threshold profile of each sampling variant (null when that run captured none / failed). */
  sampling: { no_inlining: { thresholdMiB: number; analysis: Phase2C25CProfileAnalysis } | null; jit_default: { thresholdMiB: number; analysis: Phase2C25CProfileAnalysis } | null }
}

/** Measures and verdict of every hypothesis over the OOM representative contexts. */
export function evaluatePhase2C25CHypotheses(contexts: readonly Phase2C25CContextAnalyses[]) {
  return PHASE2C25C_HYPOTHESES.map(hypothesis => {
    const measures: Phase2C25CHypothesisMeasure[] = contexts.map(context => {
      const snapshot = phase2c25cSnapshotShare(context.snapshot, hypothesis.snapshotEdgeGroup.group)
      const samplingShare = phase2c25cSamplingShare(context.sampling.no_inlining?.analysis ?? null, hypothesis.samplingCategories)
      return { contextKey: context.contextKey, snapshotShare: snapshot.share, snapshotNewEdgeCutBytes: snapshot.bytes, snapshotMatchedEdges: snapshot.matchedEdges,
        samplingShare, samplingShareJitDefault: phase2c25cSamplingShare(context.sampling.jit_default?.analysis ?? null, hypothesis.samplingCategories),
        samplingThresholdMiB: context.sampling.no_inlining?.thresholdMiB ?? null, strength: phase2c25cContextStrength(snapshot.share, samplingShare) }
    })
    return { id: hypothesis.id, title: hypothesis.title, samplingCategories: hypothesis.samplingCategories, snapshotEdgeGroup: hypothesis.snapshotEdgeGroup,
      measures, verdict: phase2c25cVerdict(measures.map(m => m.strength)) }
  })
}

// ---------------------------------------------------------------- findings (post-hoc, descriptive)

/** Growth type of an OOM context: `deep` when its held-aware Gogma depth reached at least this before dying. */
export const PHASE2C25C_DEEP_GROWTH_MIN_GOGMA_DEPTH = 20

export interface Phase2C25CSamplingSummary {
  thresholdMiB: number
  totalSampledBytes: number
  repositorySelfBytes: number
  categories: { category: Phase2C25CSourceCategory; sampledSelfBytes: number; share: number }[]
  attributedRepositoryCallsites: { key: string; functionName: string; url: string; category: Phase2C25CSourceCategory; sampledSelfBytes: number }[]
}

export interface Phase2C25CFindingsContext {
  contextKey: string
  kind: string
  gogmaMaxDepthAtLastProgress: number | null
  sampling: { jit_default: Phase2C25CSamplingSummary | null; no_inlining: Phase2C25CSamplingSummary | null }
  snapshot: null | {
    newReachableBytes: number
    persistentNewBytes: number | null
    groupCutNewBytes: Record<string, number>
    reservedBonusResultNodeShallowBytes: number
  }
}

const shareOf = (part: number, whole: number) => whole === 0 ? null : part / whole
const pct = (value: number | null) => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`

/**
 * The per-question numbers of this Phase and a one-line reading of each, computed from the analyzed evidence only.
 * Interpretation beyond these numbers is left to the document.
 */
export function buildPhase2C25CFindings(contexts: readonly Phase2C25CFindingsContext[], hypotheses: ReturnType<typeof evaluatePhase2C25CHypotheses>) {
  const growthType = (c: Phase2C25CFindingsContext) => c.gogmaMaxDepthAtLastProgress === null ? 'unknown'
    : c.gogmaMaxDepthAtLastProgress >= PHASE2C25C_DEEP_GROWTH_MIN_GOGMA_DEPTH ? 'deep' : 'shallow'
  const categoryShare = (s: Phase2C25CSamplingSummary | null, category: Phase2C25CSourceCategory) =>
    s === null ? null : shareOf(s.categories.find(c => c.category === category)?.sampledSelfBytes ?? 0, s.totalSampledBytes)
  const functionShare = (s: Phase2C25CSamplingSummary | null, name: string) =>
    s === null ? null : shareOf(s.attributedRepositoryCallsites.filter(c => c.functionName === name).reduce((sum, c) => sum + c.sampledSelfBytes, 0), s.totalSampledBytes)
  const cutShare = (c: Phase2C25CFindingsContext, group: string) => c.snapshot === null ? null : shareOf(c.snapshot.groupCutNewBytes[group] ?? 0, c.snapshot.newReachableBytes)
  const perContext = contexts.map(c => {
    const noInline = c.sampling.no_inlining
    const jit = c.sampling.jit_default
    const top = noInline?.attributedRepositoryCallsites[0] ?? null
    const jitTop = jit?.attributedRepositoryCallsites[0] ?? null
    const persistent = c.snapshot?.persistentNewBytes ?? null
    return {
      contextKey: c.contextKey, kind: c.kind, growthType: growthType(c), gogmaMaxDepthAtLastProgress: c.gogmaMaxDepthAtLastProgress,
      samplingThresholdMiB: noInline?.thresholdMiB ?? null,
      repositoryShareNoInlining: noInline === null ? null : shareOf(noInline.repositorySelfBytes, noInline.totalSampledBytes),
      topCallsiteNoInlining: top === null || noInline === null ? null : { key: top.key, category: top.category, share: shareOf(top.sampledSelfBytes, noInline.totalSampledBytes) },
      topCallsiteJitDefault: jitTop === null || jit === null ? null : { key: jitTop.key, category: jitTop.category, share: shareOf(jitTop.sampledSelfBytes, jit.totalSampledBytes) },
      topCategoriesNoInlining: noInline?.categories.slice(0, 5).map(x => ({ category: x.category, share: x.share })) ?? null,
      reservedBonusStepsShare: categoryShare(noInline, 'reserved_bonus_steps'),
      bonusAmendmentOperationsShare: functionShare(noInline, 'bonusAmendmentOperations'),
      semanticKeysShare: categoryShare(noInline, 'semantic_keys'),
      snapshotPersistentShare: c.snapshot === null || persistent === null ? null : shareOf(persistent, c.snapshot.newReachableBytes),
      snapshotRetainedCutShare: cutShare(c, 'H4'),
      snapshotRetainedCutShareOfPersistent: c.snapshot === null || persistent === null ? null : shareOf(c.snapshot.groupCutNewBytes.H4 ?? 0, persistent),
      snapshotDepthsCutShare: cutShare(c, 'H1'),
      snapshotStepsCutShare: cutShare(c, 'H2'),
      snapshotHistoryCutShare: cutShare(c, 'H3'),
      snapshotResultNodeShallowShare: c.snapshot === null ? null : shareOf(c.snapshot.reservedBonusResultNodeShallowBytes, c.snapshot.newReachableBytes),
      snapshotOperationsCutShare: cutShare(c, 'route_bonus_solution_operations'),
      snapshotKeysCutShare: cutShare(c, 'evaluated_solution_keys'),
      snapshotCrossCutShare: cutShare(c, 'H5'),
      snapshotQueueCutShare: cutShare(c, 'H6'),
    }
  })
  type Row = typeof perContext[number]
  const line = (label: (c: Row) => string) => perContext.map(c => `${c.contextKey} (${c.growthType}): ${label(c)}`).join('; ')
  const verdict = (id: Phase2C25CHypothesisId) => hypotheses.find(h => h.id === id)?.verdict ?? 'inconclusive'
  const answers = {
    Q1: { question: 'heap増加の最大寄与allocation site',
      perContext: perContext.map(c => ({ contextKey: c.contextKey, growthType: c.growthType, topCallsiteNoInlining: c.topCallsiteNoInlining, topCallsiteJitDefault: c.topCallsiteJitDefault })),
      reading: line(c => `no_inlining top ${c.topCallsiteNoInlining?.key ?? 'n/a'} ${pct(c.topCallsiteNoInlining?.share ?? null)}`) },
    Q2: { question: 'deep型とshallow型で同じallocation siteが支配的か',
      sameTopCallsite: new Set(perContext.map(c => c.topCallsiteNoInlining?.key ?? null)).size === 1,
      reading: line(c => `top categories ${(c.topCategoriesNoInlining ?? []).slice(0, 3).map(x => `${x.category} ${pct(x.share)}`).join(', ')}`) },
    Q3: { question: 'reservedBonusSteps()のfull steps[] materializationの割合',
      reading: line(c => `sampling ${pct(c.reservedBonusStepsShare)}, snapshot steps edge-cut ${pct(c.snapshotStepsCutShare)}`) },
    Q4: { question: 'ReservedBonusResultNode.previous history chainは主要因か', verdict: verdict('H3'),
      reading: line(c => `results+previous edge-cut ${pct(c.snapshotHistoryCutShare)}, result node shallow ${pct(c.snapshotResultNodeShallowShare)}`) },
    Q5: { question: 'set.depths由来のpublished solution群が主要retaining pathか', verdict: verdict('H1'),
      reading: line(c => `depths edge-cut ${pct(c.snapshotDepthsCutShare)} vs channel.retained edge-cut ${pct(c.snapshotRetainedCutShare)}`) },
    Q6: { question: 'Scheduler channel.retainedの保持量', verdict: verdict('H4'),
      reading: line(c => `retained edge-cut ${pct(c.snapshotRetainedCutShare)} of new bytes (${pct(c.snapshotRetainedCutShareOfPersistent)} of the Search-reachable new bytes)`) },
    Q7: { question: 'Lazy Ideal Cross / SearchWorkQueueは主要因か', verdicts: { H5: verdict('H5'), H6: verdict('H6') },
      reading: line(c => `cross edge-cut ${pct(c.snapshotCrossCutShare)}, queue edge-cut ${pct(c.snapshotQueueCutShare)}`) },
  }
  return { growthRule: `deep when the held-aware Gogma depth reached at the last progress is >= ${PHASE2C25C_DEEP_GROWTH_MIN_GOGMA_DEPTH}`, perContext, answers }
}
