/**
 * Issue #154 Phase 2-C2.5-D2-c: post-D2 heap analysis layer, hypotheses and pre-registered rules, Research only. Never
 * import from Production.
 *
 * It re-uses the Phase 2-C2.5-C parsers and graph primitives unchanged (sampling profile validation / aggregation,
 * heap snapshot stream parser, graph, BFS, edge-cut, retaining path) and adds only what the post-D2 questions need:
 *
 * - a stack-aware sampling category: an allocation is attributed to the innermost named Repository frame (as in C2.5-C),
 *   and a key helper frame (`hashing.ts`, `semanticKeys.ts`) is split by the nearest non-helper Repository frame that
 *   called it, so a held-aware stream key (`bonusStream.ts`) is never mixed with the old Candidate semantic keys of the
 *   scheduler publication (`streamSolutions.ts` / `targetSearchScheduler.ts`);
 * - a persistent / in-flight split of every edge-cut: persistent = new nodes a long-lived Search root
 *   (`TargetSearchScheduler`) reaches; in-flight = new nodes the synthetic root reaches and no such root does;
 * - an array census (arrays grouped by the signature most of their elements have) and in-flight array edge-cuts, so the
 *   one-depth `generated` array and a publication array under construction can be measured without naming a local;
 * - a string census (family layout keys, position + layout keys, stable JSON, concatenated strings).
 *
 * Terminology is C2.5-C's: no dominator tree is computed, so nothing is a "retained size"; shallow size, root reachable,
 * edge-cut, retaining path, persistent and in-flight only.
 *
 * Every rule in `PHASE2C25D2C_RULES` was fixed BEFORE the formal run and is committed with the measured HEAD. The runner
 * records its SHA-256 (of `stableStringify(PHASE2C25D2C_RULES)`) and the analyzer fails closed when it changed; the
 * analyzer also refuses any change to this module after the measured HEAD (it is not a post-hoc file). The thresholds
 * were fixed before any D2-c measurement; the holder signatures, the FixedArray part of the array census and the NUL /
 * space layout-key pattern were audited on one non-formal smoke snapshot before the formal run.
 */
import {
  analyzeHeapSnapshot,
  heapSnapshotBfs,
  heapSnapshotEdgeName,
  heapSnapshotEdgeTarget,
  heapSnapshotEdgeType,
  heapSnapshotNodeId,
  heapSnapshotNodeName,
  heapSnapshotNodeSelfSize,
  heapSnapshotNodeSignature,
  heapSnapshotNodeType,
  heapSnapshotRetainingPath,
  PHASE2C25C_TARGETED_EDGE_NAMES,
  type HeapSnapshotAnalysis,
  type HeapSnapshotEdgeGroup,
  type HeapSnapshotGraph,
} from './plannerGlobalPhase2C25CSnapshotAnalysis'
import {
  analyzeSamplingHeapProfile,
  isPhase2C25CRepositoryUrl,
  normalizePhase2C25CUrl,
  type Phase2C25CProfileAnalysis,
  type Phase2C25CScriptTable,
  type SamplingHeapProfile,
  type SamplingHeapProfileNode,
} from './plannerGlobalPhase2C25CProfileAnalysis'

// ---------------------------------------------------------------- sampling categories (stack-aware)

export type Phase2C25D2CCategory =
  | 'reserved_generation'
  | 'reserved_steps'
  | 'family_layout_key'
  | 'reserved_key_generation'
  | 'rng_prediction'
  | 'reservation_window'
  | 'scheduler_publication'
  | 'publication_evaluation'
  | 'publication_materialization'
  | 'publication_keys'
  | 'other_keys'
  | 'bonus_stream_other'
  | 'skill_stream'
  | 'lazy_cross'
  | 'work_queue'
  | 'planner_alternative_search'
  | 'research_harness'
  | 'other_repo'
  | 'dependency'
  | 'runtime'

const BONUS = 'src/domain/search/bonusStream.ts'
const SKILL = 'src/domain/search/skillStream.ts'
const KEY_HELPER_FILES = new Set(['src/domain/models/hashing.ts', 'src/domain/search/semanticKeys.ts'])

export const PHASE2C25D2C_CATEGORY_RULES: readonly { category: Phase2C25D2CCategory; rule: string }[] = [
  { category: 'reserved_steps', rule: `${BONUS} reservedBonusSteps` },
  { category: 'reserved_generation', rule: `${BONUS} ensureReserved, reservedGeneratedState, reservedSet, readReservedDepth` },
  { category: 'family_layout_key', rule: 'src/domain/rng/gogmaBonusFamily.ts (keepFamilyLayoutKey, keepFamilyLayout, keepFamilyOfBonus, keepFamilyBonusTypeId)' },
  { category: 'reserved_key_generation', rule: `${BONUS} compareReservedRepresentative, compareReservedFrontier, bonusStreamBaseKey; a key helper (hashing.ts / semanticKeys.ts) whose nearest non-helper Repository caller is in ${BONUS}` },
  { category: 'publication_keys', rule: 'a key helper whose nearest non-helper Repository caller is in targetSearchScheduler.ts, streamSolutions.ts, candidateFactory.ts or src/domain/target/' },
  { category: 'other_keys', rule: 'a key helper with any other (or no) non-helper Repository caller' },
  { category: 'rng_prediction', rule: `${BONUS} predictReset, predictKeep; ${SKILL} predictAt; any other src/domain/rng/ file` },
  { category: 'reservation_window', rule: `${BONUS} / ${SKILL} reservedWindow; src/domain/search/counterReservation*.ts` },
  { category: 'publication_materialization', rule: `${BONUS} bonusAmendmentOperations, bonusAmendmentResults; ${SKILL} resetSkillsOperations, skillAmendmentResults` },
  { category: 'scheduler_publication', rule: 'src/domain/search/targetSearchScheduler.ts' },
  { category: 'publication_evaluation', rule: 'src/domain/search/streamSolutions.ts, src/domain/search/candidateFactory.ts, src/domain/target/' },
  { category: 'bonus_stream_other', rule: `any other ${BONUS} function` },
  { category: 'skill_stream', rule: `any other ${SKILL} function` },
  { category: 'lazy_cross', rule: 'src/domain/search/lazyIdealCross.ts' },
  { category: 'work_queue', rule: 'src/domain/search/searchWorkQueue.ts' },
  { category: 'planner_alternative_search', rule: 'src/domain/search/alternative/' },
  { category: 'research_harness', rule: 'src/benchmarks/' },
  { category: 'other_repo', rule: 'any other src/ file' },
  { category: 'dependency', rule: 'node_modules/ (no named Repository frame on the stack)' },
  { category: 'runtime', rule: 'native / builtin / node: frames with no named Repository frame on the stack' },
]

export interface Phase2C25D2CFrame { functionName: string; url: string; repository: boolean }

function categoryOfFrame(frame: Phase2C25D2CFrame): Phase2C25D2CCategory {
  const { url: file, functionName: name } = frame
  if (file === BONUS) {
    if (name === 'reservedBonusSteps') return 'reserved_steps'
    if (['ensureReserved', 'reservedGeneratedState', 'reservedSet', 'readReservedDepth'].includes(name)) return 'reserved_generation'
    if (['compareReservedRepresentative', 'compareReservedFrontier', 'bonusStreamBaseKey'].includes(name)) return 'reserved_key_generation'
    if (['predictReset', 'predictKeep'].includes(name)) return 'rng_prediction'
    if (name === 'reservedWindow') return 'reservation_window'
    if (['bonusAmendmentOperations', 'bonusAmendmentResults'].includes(name)) return 'publication_materialization'
    return 'bonus_stream_other'
  }
  if (file === SKILL) {
    if (name === 'predictAt') return 'rng_prediction'
    if (name === 'reservedWindow') return 'reservation_window'
    if (['resetSkillsOperations', 'skillAmendmentResults'].includes(name)) return 'publication_materialization'
    return 'skill_stream'
  }
  if (file === 'src/domain/rng/gogmaBonusFamily.ts') return 'family_layout_key'
  if (file.startsWith('src/domain/rng/')) return 'rng_prediction'
  if (/^src\/domain\/search\/counterReservation[^/]*\.ts$/.test(file)) return 'reservation_window'
  if (file === 'src/domain/search/targetSearchScheduler.ts') return 'scheduler_publication'
  if (file === 'src/domain/search/streamSolutions.ts' || file === 'src/domain/search/candidateFactory.ts' || file.startsWith('src/domain/target/')) return 'publication_evaluation'
  if (file === 'src/domain/search/lazyIdealCross.ts') return 'lazy_cross'
  if (file === 'src/domain/search/searchWorkQueue.ts') return 'work_queue'
  if (file.startsWith('src/domain/search/alternative/')) return 'planner_alternative_search'
  if (file.startsWith('src/benchmarks/')) return 'research_harness'
  return 'other_repo'
}

/**
 * The D2-c category of one allocation from its whole stack (outermost first). The innermost named Repository frame
 * decides, except that a key helper frame is resolved by the nearest non-helper named Repository caller. With no named
 * Repository frame the innermost frame's url decides between `dependency` and `runtime`.
 */
export function categorizePhase2C25D2CStack(stack: readonly Phase2C25D2CFrame[]): Phase2C25D2CCategory {
  let innermost = -1
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].repository && stack[i].functionName !== '') { innermost = i; break }
  if (innermost < 0) return stack.length > 0 && stack[stack.length - 1].url.startsWith('node_modules/') ? 'dependency' : 'runtime'
  const frame = stack[innermost]
  if (!KEY_HELPER_FILES.has(frame.url)) return categoryOfFrame(frame)
  for (let i = innermost - 1; i >= 0; i--) {
    const caller = stack[i]
    if (!caller.repository || caller.functionName === '' || KEY_HELPER_FILES.has(caller.url)) continue
    if (caller.url === BONUS) return 'reserved_key_generation'
    const category = categoryOfFrame(caller)
    if (category === 'scheduler_publication' || category === 'publication_evaluation') return 'publication_keys'
    return 'other_keys'
  }
  return 'other_keys'
}

export interface Phase2C25D2CProfileAnalysis {
  /** The unchanged C2.5-C aggregation (raw and attributed callsites, C2.5-C categories). */
  base: Phase2C25CProfileAnalysis
  totalSampledBytes: number
  categories: { category: Phase2C25D2CCategory; sampledSelfBytes: number; share: number }[]
  /** Inclusive sampled bytes of every named Repository function (`file#function`), counted once per allocation. */
  inclusive: { key: string; sampledInclusiveBytes: number; share: number }[]
}

/** Aggregates one sampling heap profile into D2-c categories and Repository-function inclusive bytes. */
export function analyzePhase2C25D2CProfile(profile: SamplingHeapProfile, scripts: Phase2C25CScriptTable): Phase2C25D2CProfileAnalysis {
  const base = analyzeSamplingHeapProfile(profile, scripts)
  const frameMemo = new Map<string, Phase2C25D2CFrame>()
  const frameOf = (node: SamplingHeapProfileNode): Phase2C25D2CFrame => {
    const f = node.callFrame
    const rawUrl = f.url !== '' ? f.url : (scripts.urlOf(f.scriptId) ?? '')
    const key = `${f.functionName}\u0000${rawUrl}`
    let frame = frameMemo.get(key)
    if (!frame) {
      const url = normalizePhase2C25CUrl(rawUrl)
      frame = { functionName: f.functionName, url, repository: isPhase2C25CRepositoryUrl(url) }
      frameMemo.set(key, frame)
    }
    return frame
  }
  const categoryBytes = new Map<Phase2C25D2CCategory, number>()
  const inclusive = new Map<string, number>()
  let total = 0
  const path: Phase2C25D2CFrame[] = []
  const stack: { node: SamplingHeapProfileNode; child: number }[] = [{ node: profile.head, child: -1 }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.child === -1) {
      path.push(frameOf(top.node))
      top.child = 0
      const self = top.node.selfSize
      if (self > 0) {
        total += self
        const category = categorizePhase2C25D2CStack(path)
        categoryBytes.set(category, (categoryBytes.get(category) ?? 0) + self)
        const seen = new Set<string>()
        for (const frame of path) {
          if (!frame.repository || frame.functionName === '') continue
          const key = `${frame.url}#${frame.functionName}`
          if (seen.has(key)) continue
          seen.add(key)
          inclusive.set(key, (inclusive.get(key) ?? 0) + self)
        }
      }
    }
    if (top.child < top.node.children.length) {
      stack.push({ node: top.node.children[top.child++], child: -1 })
      continue
    }
    stack.pop()
    path.pop()
  }
  const share = (bytes: number) => total === 0 ? 0 : bytes / total
  return {
    base, totalSampledBytes: total,
    categories: [...categoryBytes.entries()].map(([category, bytes]) => ({ category, sampledSelfBytes: bytes, share: share(bytes) }))
      .sort((a, b) => b.sampledSelfBytes - a.sampledSelfBytes || (a.category < b.category ? -1 : 1)),
    inclusive: [...inclusive.entries()].map(([key, bytes]) => ({ key, sampledInclusiveBytes: bytes, share: share(bytes) }))
      .sort((a, b) => b.sampledInclusiveBytes - a.sampledInclusiveBytes || (a.key < b.key ? -1 : 1)),
  }
}

export function phase2c25d2cCategoryShare(analysis: Pick<Phase2C25D2CProfileAnalysis, 'categories' | 'totalSampledBytes'> | null, categories: readonly Phase2C25D2CCategory[]): number | null {
  if (analysis === null || analysis.totalSampledBytes === 0) return null
  return analysis.categories.filter(c => categories.includes(c.category)).reduce((sum, c) => sum + c.sampledSelfBytes, 0) / analysis.totalSampledBytes
}

/** The attributed self share of one Repository function (the C2.5-C attribution) in a profile. */
export function phase2c25d2cFunctionShare(analysis: Pick<Phase2C25D2CProfileAnalysis, 'base'> | null, url: string, functionName: string): number | null {
  if (analysis === null || analysis.base.totalSampledBytes === 0) return null
  return analysis.base.attributedCallsites.filter(s => s.url === url && s.functionName === functionName).reduce((sum, s) => sum + s.sampledSelfBytes, 0) / analysis.base.totalSampledBytes
}

// ---------------------------------------------------------------- holder signatures (re-audited for the post-D2 code)

/**
 * `heapSnapshotNodeSignature()` forms of the Search structures the hypotheses name, re-audited against the post-D2-a
 * source (bonusStream.ts `ReservedSet`, `ReservedBonusStreamSolution`, `ReservedBonusState`, `ReservedBonusResultNode`;
 * targetSearchScheduler.ts `RouteBonusSolution` shape and the evaluated solution keys) and a non-formal smoke.
 */
export const PHASE2C25D2C_HOLDER_SIGNATURES = {
  reservedBonusSet: 'object:Object{cutByExtent,depths,done,frontier,index,unsupported,windows}',
  reservedSkillSet: 'object:Object{cutByExtent,depths,done,frontier,index,windows}',
  reservedBonusSolution: 'object:Object{bonuses,depth,lastResetDepth,restorationBonusScope,results,steps}',
  reservedBonusState: 'object:Object{bonuses,depth,familyLayoutKey,lastResetDepth,nextFrom,position,results,scope}',
  reservedBonusResultNode: 'object:Object{depth,previous,result,step}',
  bonusAmendmentResult: 'object:Object{restorationBonusScope,restorationBonuses}',
  bonusStreamStep: 'object:Object{gogmaCounterAfter,gogmaCounterBefore}',
  routeBonusSolution: 'object:Object{amendmentResults,finalBonuses,gogmaAdvance,lastResetDepth,operations,restorationBonusScope}',
  searchWorkQueue: 'object:SearchWorkQueue{',
  targetSearchScheduler: 'object:TargetSearchScheduler{',
} as const

/** The long-lived Search root of the persistent / in-flight split (the same root C2.5-C used, re-audited). */
export const PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES: readonly string[] = [PHASE2C25D2C_HOLDER_SIGNATURES.targetSearchScheduler]

export const PHASE2C25D2C_TARGETED_EDGE_NAMES: readonly string[] = [...PHASE2C25C_TARGETED_EDGE_NAMES, 'familyLayoutKey']

// ---------------------------------------------------------------- hypotheses

export type Phase2C25D2CHypothesisId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7' | 'H8' | 'H9'

/** How a hypothesis' snapshot measure is taken. */
export type Phase2C25D2CSnapshotMeasure =
  | { type: 'edge_group'; group: HeapSnapshotEdgeGroup }
  /** Every non-weak edge INTO an in-flight array whose elements are mostly of this signature (what those arrays alone keep alive). */
  | { type: 'in_flight_arrays'; elementSignature: string }

export interface Phase2C25D2CHypothesis {
  id: Phase2C25D2CHypothesisId
  title: string
  retention: 'persistent' | 'in_flight'
  samplingCategories: Phase2C25D2CCategory[]
  snapshot: Phase2C25D2CSnapshotMeasure
}

const S = PHASE2C25D2C_HOLDER_SIGNATURES

export const PHASE2C25D2C_HYPOTHESES: readonly Phase2C25D2CHypothesis[] = [
  { id: 'H1', title: 'ReservedSet.depths keeps every published raw Bonus solution of every past depth', retention: 'persistent',
    samplingCategories: ['reserved_generation', 'reserved_steps'],
    snapshot: { type: 'edge_group', group: { group: 'H1', edgeNames: ['depths'], holderSignaturePrefixes: [S.reservedBonusSet], edgeTypes: ['property'] } } },
  { id: 'H2', title: 'reservedBonusSteps() materializes a full steps[] per published raw solution', retention: 'persistent',
    samplingCategories: ['reserved_generation', 'reserved_steps'],
    snapshot: { type: 'edge_group', group: { group: 'H2', edgeNames: ['steps'], holderSignaturePrefixes: [S.reservedBonusSolution], edgeTypes: ['property'] } } },
  { id: 'H3', title: 'ReservedBonusResultNode results / previous history chain', retention: 'persistent',
    samplingCategories: ['reserved_generation'],
    snapshot: { type: 'edge_group', group: { group: 'H3', edgeNames: ['results', 'previous'],
      holderSignaturePrefixes: [S.reservedBonusSolution, S.reservedBonusState, S.reservedBonusResultNode], edgeTypes: ['property'] } } },
  { id: 'H4', title: 'scheduler channel.retained (Ideal positions only after D2-a)', retention: 'persistent',
    samplingCategories: ['scheduler_publication', 'publication_evaluation', 'publication_materialization', 'publication_keys'],
    snapshot: { type: 'edge_group', group: { group: 'H4', edgeNames: ['retained'], holderSignaturePrefixes: null, edgeTypes: ['property'] } } },
  { id: 'H5', title: 'ReservedSet.frontier (reduced states per (position, family layout))', retention: 'persistent',
    samplingCategories: ['reserved_generation'],
    snapshot: { type: 'edge_group', group: { group: 'H5', edgeNames: ['frontier'], holderSignaturePrefixes: [S.reservedBonusSet], edgeTypes: ['property'] } } },
  { id: 'H6', title: 'one-depth generated[] of raw ReservedBonusState (synchronous burst, in-flight)', retention: 'in_flight',
    samplingCategories: ['reserved_generation', 'family_layout_key'],
    snapshot: { type: 'in_flight_arrays', elementSignature: S.reservedBonusState } },
  { id: 'H7', title: 'publication intermediates: the mapped solution array under construction beside generated[] (in-flight)', retention: 'in_flight',
    samplingCategories: ['reserved_generation', 'reserved_steps'],
    snapshot: { type: 'in_flight_arrays', elementSignature: S.reservedBonusSolution } },
  { id: 'H8', title: 'reservation windows / prediction memo', retention: 'persistent',
    samplingCategories: ['rng_prediction', 'reservation_window'],
    snapshot: { type: 'edge_group', group: { group: 'H8', edgeNames: ['windows', 'resetPredictions', 'keepPredictions', 'predictions'], holderSignaturePrefixes: null, edgeTypes: ['property', 'context'] } } },
  { id: 'H9', title: 'family layout key strings held per raw state (keepFamilyLayoutKey) and held-aware key generation', retention: 'persistent',
    samplingCategories: ['family_layout_key', 'reserved_key_generation'],
    snapshot: { type: 'edge_group', group: { group: 'H9', edgeNames: ['familyLayoutKey'], holderSignaturePrefixes: [S.reservedBonusState], edgeTypes: ['property'] } } },
]

/** Descriptive edge sets (the old C2.5-C major structures, for the D2-a effect validation), never verdict inputs. */
export const PHASE2C25D2C_DESCRIPTIVE_EDGE_GROUPS: readonly HeapSnapshotEdgeGroup[] = [
  { group: 'route_bonus_operations', edgeNames: ['operations'], holderSignaturePrefixes: [S.routeBonusSolution], edgeTypes: ['property'] },
  { group: 'route_bonus_amendment_results', edgeNames: ['amendmentResults'], holderSignaturePrefixes: [S.routeBonusSolution], edgeTypes: ['property'] },
  { group: 'route_bonus_solution_operations', edgeNames: ['operations', 'amendmentResults'], holderSignaturePrefixes: [S.routeBonusSolution], edgeTypes: ['property'] },
  { group: 'evaluated_solution_keys', edgeNames: ['operationTypeKey', 'retentionKey', 'bonusKey'], holderSignaturePrefixes: null, edgeTypes: ['property'] },
  { group: 'evaluated_solution_body', edgeNames: ['solution'], holderSignaturePrefixes: null, edgeTypes: ['property'] },
  { group: 'reserved_sets_closure', edgeNames: ['reservedSets'], holderSignaturePrefixes: null, edgeTypes: ['context'] },
  { group: 'lazy_cross', edgeNames: ['bonuses', 'skills', 'nextColumn', 'waiting'], holderSignaturePrefixes: null, edgeTypes: ['context'] },
  { group: 'work_queue', edgeNames: ['heap', 'queue'], holderSignaturePrefixes: [S.searchWorkQueue, S.targetSearchScheduler], edgeTypes: ['property'] },
]

/** The label of the descriptive in-flight array cut of every hypothesis signature together (never a verdict input). */
export const PHASE2C25D2C_IN_FLIGHT_COMBINED = '(H6+H7 combined)'

export const PHASE2C25D2C_PATH_SIGNATURE_PREFIXES: readonly string[] = [
  S.reservedBonusSolution, S.reservedBonusState, S.reservedBonusResultNode, S.bonusStreamStep, S.routeBonusSolution,
]

// ---------------------------------------------------------------- pre-registered rules

/**
 * The per-context level of one hypothesis, from two measures of the primary OOM context:
 *
 * - snap  the hypothesis' snapshot measure (an edge-cut, or the in-flight array edge-cut) as a share of the new bytes the
 *         synthetic root reaches in the 512 MB near-limit snapshot;
 * - samp  the `jit_default` (Production-like JIT) attributed share of the hypothesis' sampling categories at the
 *         highest threshold that run reached. The `no_inlining` share is reported beside it and is never a verdict input.
 *
 * Sampling categories are shared by several hypotheses (a Production-like JIT inlines the helpers into
 * `ensureReserved`), so `samp` confirms that the allocation path that builds the structure is live at the largest
 * observed heap; `snap` is what tells the structures apart.
 */
export const PHASE2C25D2C_VERDICT_RULE = {
  strongSnapshotShare: 0.25,
  strongSamplingShare: 0.10,
  contributingSnapshotShare: 0.05,
  notSupportedSnapshotShare: 0.005,
  notSupportedSamplingShare: 0.01,
  samplingVariant: 'jit_default',
  levelOrder: ['strong', 'contributing', 'minor', 'not_supported'],
  text: 'Per primary context: strong when snap >= 25 % and jit_default samp >= 10 %; contributing when not strong and snap >= 5 %; ' +
    'not_supported when snap < 0.5 % and samp < 1 %; minor otherwise; inconclusive when either measure is unavailable (never read as 0 %). ' +
    'Across the primary contexts: inconclusive if any context is inconclusive, otherwise the weakest per-context level (strong > contributing > minor > not_supported).',
} as const

export type Phase2C25D2CLevel = 'strong' | 'contributing' | 'minor' | 'not_supported' | 'inconclusive'

/** The D2-a effect validation: how an old C2.5-C major allocation / retention reads after D2-a. */
export const PHASE2C25D2C_EFFECT_RULE = {
  majorShare: 0.25,
  contributingShare: 0.05,
  minorShare: 0.001,
  text: 'Per primary context, the largest available share among the post-D2 snapshot edge-cut share (of root-reachable new bytes) and the ' +
    'jit_default / no_inlining sampling shares at the highest reached threshold: major >= 25 %, contributing >= 5 %, minor >= 0.1 %, not_observed < 0.1 %; ' +
    'not_available when no measure exists. The level of the structure is the largest level over the primary contexts (it is gone only when gone in every context).',
} as const

export type Phase2C25D2CEffectLevel = 'major' | 'contributing' | 'minor' | 'not_observed' | 'not_available'

/** The old C2.5-C majors the D2-a effect validation reads, with their post-D2 measures. */
export const PHASE2C25D2C_OLD_MAJORS = [
  { id: 'channel_retained', title: 'scheduler channel.retained', snapshotGroup: 'H4', samplingCategories: ['scheduler_publication'] as Phase2C25D2CCategory[], samplingFunction: null },
  { id: 'bonus_amendment_operations', title: 'bonusAmendmentOperations (RouteOperation[] per published Bonus solution)', snapshotGroup: 'route_bonus_operations',
    samplingCategories: ['publication_materialization'] as Phase2C25D2CCategory[], samplingFunction: { url: BONUS, functionName: 'bonusAmendmentOperations' } },
  { id: 'bonus_amendment_results', title: 'bonusAmendmentResults', snapshotGroup: 'route_bonus_amendment_results',
    samplingCategories: [] as Phase2C25D2CCategory[], samplingFunction: { url: BONUS, functionName: 'bonusAmendmentResults' } },
  { id: 'candidate_semantic_keys', title: 'Candidate semantic keys of evaluated solutions (retentionKey / bonusKey / operationTypeKey, sort comparison)', snapshotGroup: 'evaluated_solution_keys',
    samplingCategories: ['publication_keys'] as Phase2C25D2CCategory[], samplingFunction: null },
] as const

/**
 * The mechanical choice of the next optimization candidate (at most one primary recommendation). The interpretation
 * written after the evidence explains it; it never replaces it.
 */
export const PHASE2C25D2C_RECOMMENDATION_RULE = {
  text: 'Candidates: the hypotheses whose overall level is strong; if none, those that are contributing; if none, no recommendation. ' +
    'Rank by the minimum over the primary contexts of snap, then by the minimum of the jit_default samp, then by hypothesis id. ' +
    'The first is the primary recommendation; the others are listed as secondary and are not to be implemented together with it.',
} as const

/** Everything the formal run fixes before profiling. Its SHA-256 is recorded by the runner and checked by the analyzer. */
export const PHASE2C25D2C_RULES = {
  verdictRule: PHASE2C25D2C_VERDICT_RULE,
  effectRule: PHASE2C25D2C_EFFECT_RULE,
  recommendationRule: PHASE2C25D2C_RECOMMENDATION_RULE,
  hypotheses: PHASE2C25D2C_HYPOTHESES,
  oldMajors: PHASE2C25D2C_OLD_MAJORS,
  categoryRules: PHASE2C25D2C_CATEGORY_RULES,
  holderSignatures: PHASE2C25D2C_HOLDER_SIGNATURES,
  persistentRootPrefixes: PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES,
  descriptiveEdgeGroups: PHASE2C25D2C_DESCRIPTIVE_EDGE_GROUPS,
} as const

export function phase2c25d2cContextLevel(snap: number | null, samp: number | null): Phase2C25D2CLevel {
  const rule = PHASE2C25D2C_VERDICT_RULE
  if (snap === null || samp === null) return 'inconclusive'
  if (snap >= rule.strongSnapshotShare && samp >= rule.strongSamplingShare) return 'strong'
  if (snap >= rule.contributingSnapshotShare) return 'contributing'
  if (snap < rule.notSupportedSnapshotShare && samp < rule.notSupportedSamplingShare) return 'not_supported'
  return 'minor'
}

export function phase2c25d2cOverallLevel(levels: readonly Phase2C25D2CLevel[]): Phase2C25D2CLevel {
  if (levels.length === 0 || levels.includes('inconclusive')) return 'inconclusive'
  const order = PHASE2C25D2C_VERDICT_RULE.levelOrder as readonly string[]
  return levels.reduce((weakest, level) => order.indexOf(level) > order.indexOf(weakest) ? level : weakest, levels[0])
}

export function phase2c25d2cEffectLevel(shares: readonly (number | null)[]): Phase2C25D2CEffectLevel {
  const available = shares.filter((s): s is number => s !== null)
  if (available.length === 0) return 'not_available'
  const max = Math.max(...available)
  const rule = PHASE2C25D2C_EFFECT_RULE
  return max >= rule.majorShare ? 'major' : max >= rule.contributingShare ? 'contributing' : max >= rule.minorShare ? 'minor' : 'not_observed'
}

const EFFECT_ORDER: readonly Phase2C25D2CEffectLevel[] = ['major', 'contributing', 'minor', 'not_observed', 'not_available']
/** The strongest effect level over contexts (a structure is gone only when gone in every context). */
export function phase2c25d2cStrongestEffect(levels: readonly Phase2C25D2CEffectLevel[]): Phase2C25D2CEffectLevel {
  const available = levels.filter(l => l !== 'not_available')
  if (available.length === 0) return 'not_available'
  return available.reduce((best, level) => EFFECT_ORDER.indexOf(level) < EFFECT_ORDER.indexOf(best) ? level : best, available[0])
}

// ---------------------------------------------------------------- snapshot analysis (post-D2 extension)

export interface Phase2C25D2CSplitCut {
  nodes: number
  newNodes: number
  newSize: number
  persistentNewSize: number
  inFlightNewSize: number
}

export interface Phase2C25D2CArrayGroup {
  class: 'persistent' | 'in_flight' | 'baseline'
  kind: 'js_array' | 'fixed_array'
  elementSignature: string
  arrays: number
  elements: number
  maxLength: number
  /** Shallow size of the arrays and their element backing stores. */
  shallowSize: number
}

export interface Phase2C25D2CSnapshotAnalysis {
  /** The unchanged C2.5-C analysis with the D2-c edge groups (group cuts are not split). */
  base: HeapSnapshotAnalysis
  newRoot: { nodes: number; size: number }
  persistent: { roots: number; newNodes: number; newSize: number }
  inFlight: { newNodes: number; newSize: number }
  /** Every hypothesis / descriptive edge group, cut with the persistent / in-flight split. */
  splitCuts: { group: string; matchedEdges: number; cut: Phase2C25D2CSplitCut }[]
  /** In-flight array cuts, per element signature asked for, then all of them together (`PHASE2C25D2C_IN_FLIGHT_COMBINED`). */
  inFlightArrayCuts: { elementSignature: string; arrays: number; elements: number; maxLength: number; cut: Phase2C25D2CSplitCut }[]
  arrayCensus: Phase2C25D2CArrayGroup[]
  /** New nodes by signature, persistent and in-flight apart (top by total shallow size). */
  signatureCensus: { signature: string; persistent: { count: number; size: number }; inFlight: { count: number; size: number } }[]
  stringCensus: { class: string; persistent: { count: number; size: number }; inFlight: { count: number; size: number } }[]
  /** One retaining path per in-flight array group asked for (its largest array). */
  inFlightArrayPaths: { elementSignature: string; path: ReturnType<typeof heapSnapshotRetainingPath> }[]
}

// V8 writes the NUL separator of a string node name as a space; a NUL is normalized to a space before matching.
const LAYOUT_KEY = /^bonus_type\.[^ ]+( bonus_type\.[^ ]+){4}$/
const POSITION_LAYOUT_KEY = /^-?\d+ bonus_type\./

export function phase2c25d2cStringClass(type: string, name: string): string {
  if (type === 'concatenated string') return 'concatenated_string'
  if (type === 'sliced string') return 'sliced_string'
  const spaced = name.replaceAll('\u0000', ' ')
  if (LAYOUT_KEY.test(spaced)) return 'family_layout_key'
  if (POSITION_LAYOUT_KEY.test(spaced)) return 'position_layout_key'
  if (/^[[{]/.test(name)) return 'stable_json'
  return 'other_string'
}

/**
 * The post-D2 snapshot analysis: the C2.5-C analysis with the D2-c edge groups, plus the persistent / in-flight split of
 * every cut, the array / signature / string censuses and the in-flight array cuts. `baselineMaxNodeId` splits new nodes.
 */
export function analyzePhase2C25D2CSnapshot(graph: HeapSnapshotGraph, options: { baselineMaxNodeId: number; top?: number }): Phase2C25D2CSnapshotAnalysis {
  const top = options.top ?? 30
  const edgeGroups = [
    ...PHASE2C25D2C_HYPOTHESES.flatMap(h => h.snapshot.type === 'edge_group' ? [h.snapshot.group] : []),
    ...PHASE2C25D2C_DESCRIPTIVE_EDGE_GROUPS,
  ]
  const base = analyzeHeapSnapshot(graph, {
    baselineMaxNodeId: options.baselineMaxNodeId, targetedEdgeNames: PHASE2C25D2C_TARGETED_EDGE_NAMES, edgeGroups, top, holderGroupsPerEdge: 5, edgeCutHolderGroupsPerEdge: 2,
    pathSignaturePrefixes: PHASE2C25D2C_PATH_SIGNATURE_PREFIXES, persistentRootSignaturePrefixes: PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES,
    elementPropertyCensus: [{ edgeName: 'retained', property: 'idealMatch' }],
  })
  const count = graph.schema.nodeCount
  const baseline = options.baselineMaxNodeId
  const isNew = (node: number) => heapSnapshotNodeId(graph, node) > baseline
  // Signatures are interned: one id per node, one string per distinct signature.
  const signatureIds = new Int32Array(count).fill(-1)
  const signatureTable: string[] = []
  const signatureIndex = new Map<string, number>()
  const signatureOf = (node: number) => {
    let id = signatureIds[node]
    if (id < 0) {
      const value = heapSnapshotNodeSignature(graph, node)
      const known = signatureIndex.get(value)
      if (known === undefined) { id = signatureTable.length; signatureTable.push(value); signatureIndex.set(value, id) } else id = known
      signatureIds[node] = id
    }
    return signatureTable[id]
  }
  /** Strings are grouped by their node type only (their content is the string census). */
  const censusSignatureOf = (node: number) => {
    const type = heapSnapshotNodeType(graph, node)
    return type === 'string' || type === 'concatenated string' || type === 'sliced string' ? `${type}:(any)` : signatureOf(node)
  }
  const full = heapSnapshotBfs(graph, [0])
  const roots: number[] = []
  const rootNames = PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES.map(prefix => /^object:([^{]+)\{/.exec(prefix)?.[1] ?? null)
  for (let node = 0; node < count; node++) {
    if (!full.reached[node] || heapSnapshotNodeType(graph, node) !== 'object') continue
    const name = heapSnapshotNodeName(graph, node)
    if (!PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES.some((prefix, i) => (rootNames[i] === null || rootNames[i] === name) && signatureOf(node).startsWith(prefix))) continue
    roots.push(node)
  }
  const persistentReached = heapSnapshotBfs(graph, roots, undefined, false).reached
  // 0 unreached, 1 baseline reachable, 2 persistent new, 3 in-flight new
  const klass = new Uint8Array(count)
  let newRootNodes = 0, newRootSize = 0, persistentNodes = 0, persistentSize = 0
  for (let node = 0; node < count; node++) {
    if (!full.reached[node]) continue
    if (!isNew(node)) { klass[node] = 1; continue }
    const self = heapSnapshotNodeSelfSize(graph, node)
    newRootNodes++; newRootSize += self
    if (persistentReached[node]) { klass[node] = 2; persistentNodes++; persistentSize += self } else klass[node] = 3
  }
  const splitCut = (blocked: Uint8Array): Phase2C25D2CSplitCut => {
    const partial = heapSnapshotBfs(graph, [0], edge => blocked[edge] === 1, false)
    const out: Phase2C25D2CSplitCut = { nodes: 0, newNodes: 0, newSize: 0, persistentNewSize: 0, inFlightNewSize: 0 }
    for (let node = 0; node < count; node++) {
      if (!full.reached[node] || partial.reached[node]) continue
      out.nodes++
      if (klass[node] < 2) continue
      const self = heapSnapshotNodeSelfSize(graph, node)
      out.newNodes++; out.newSize += self
      if (klass[node] === 2) out.persistentNewSize += self; else out.inFlightNewSize += self
    }
    return out
  }
  const edgeOwner = new Int32Array(graph.schema.edgeCount)
  for (let node = 0; node < count; node++) edgeOwner.fill(node, graph.firstEdge[node], graph.firstEdge[node + 1])
  const namedTypes = new Set(['property', 'context', 'internal', 'shortcut'])
  const groupNames = new Set(edgeGroups.flatMap(g => g.edgeNames))
  const edgesByName = new Map<string, number[]>()
  for (let edge = 0; edge < graph.schema.edgeCount; edge++) {
    const type = heapSnapshotEdgeType(graph, edge)
    if (!namedTypes.has(type)) continue
    const name = heapSnapshotEdgeName(graph, edge)
    if (!groupNames.has(name)) continue
    const list = edgesByName.get(name) ?? []
    list.push(edge)
    edgesByName.set(name, list)
  }
  const splitCuts = edgeGroups.map(group => {
    const flags = new Uint8Array(graph.schema.edgeCount)
    let matchedEdges = 0
    for (const name of group.edgeNames) {
      for (const edge of edgesByName.get(name) ?? []) {
        if (group.edgeTypes !== null && !group.edgeTypes.includes(heapSnapshotEdgeType(graph, edge))) continue
        if (group.holderSignaturePrefixes !== null && !group.holderSignaturePrefixes.some(prefix => signatureOf(edgeOwner[edge]).startsWith(prefix))) continue
        flags[edge] = 1
        matchedEdges++
      }
    }
    return { group: group.group, matchedEdges, cut: matchedEdges === 0 ? { nodes: 0, newNodes: 0, newSize: 0, persistentNewSize: 0, inFlightNewSize: 0 } : splitCut(flags) }
  })

  // Arrays: a JSArray (`object:Array`) by its element edges, or through its internal `elements` backing store; and every
  // other FixedArray-like `array` node that is no JSArray's backing store (e.g. the growable store `Array.prototype.map`
  // fills before it creates its result array), by its element / internal / hidden edges.
  const arrayCensus = new Map<string, Phase2C25D2CArrayGroup>()
  const arraysBySignature = new Map<string, { node: number; length: number }[]>()
  const backingStoreOf = (node: number): number | null => {
    for (let edge = graph.firstEdge[node], end = graph.firstEdge[node + 1]; edge < end; edge++) {
      if (heapSnapshotEdgeType(graph, edge) === 'internal' && heapSnapshotEdgeName(graph, edge) === 'elements') return heapSnapshotEdgeTarget(graph, edge)
    }
    return null
  }
  const storeElements = (store: number, into: number[]) => {
    for (let edge = graph.firstEdge[store], end = graph.firstEdge[store + 1]; edge < end; edge++) {
      const type = heapSnapshotEdgeType(graph, edge)
      if (type === 'element' || type === 'hidden' || (type === 'internal' && heapSnapshotEdgeName(graph, edge) !== 'map')) into.push(heapSnapshotEdgeTarget(graph, edge))
    }
    return into
  }
  const elementsOf = (node: number, kind: 'js_array' | 'fixed_array'): number[] => {
    if (kind === 'fixed_array') return storeElements(node, [])
    const out: number[] = []
    for (let edge = graph.firstEdge[node], end = graph.firstEdge[node + 1]; edge < end; edge++) {
      if (heapSnapshotEdgeType(graph, edge) === 'element') out.push(heapSnapshotEdgeTarget(graph, edge))
    }
    if (out.length > 0) return out
    const store = backingStoreOf(node)
    return store === null ? out : storeElements(store, out)
  }
  const isJsArray = (node: number) => heapSnapshotNodeType(graph, node) === 'object' && heapSnapshotNodeName(graph, node) === 'Array'
  const backingStore = new Uint8Array(count)
  for (let node = 0; node < count; node++) {
    if (klass[node] === 0 || !isJsArray(node)) continue
    const store = backingStoreOf(node)
    if (store !== null) backingStore[store] = 1
  }
  for (let node = 0; node < count; node++) {
    if (klass[node] === 0) continue
    const kind = isJsArray(node) ? 'js_array' as const : heapSnapshotNodeType(graph, node) === 'array' && !backingStore[node] ? 'fixed_array' as const : null
    if (kind === null) continue
    const elements = elementsOf(node, kind)
    if (elements.length === 0) continue
    const tally = new Map<string, number>()
    for (const element of elements) { const s = censusSignatureOf(element); tally.set(s, (tally.get(s) ?? 0) + 1) }
    let dominant = '', dominantCount = 0
    for (const [s, n] of tally) if (n > dominantCount || (n === dominantCount && s < dominant)) { dominant = s; dominantCount = n }
    if (dominantCount * 2 < elements.length) dominant = '(mixed)'
    const arrayClass = klass[node] === 1 ? 'baseline' : klass[node] === 2 ? 'persistent' : 'in_flight'
    const store = kind === 'js_array' ? backingStoreOf(node) : null
    const shallow = heapSnapshotNodeSelfSize(graph, node) + (store === null ? 0 : heapSnapshotNodeSelfSize(graph, store))
    const key = `${arrayClass}\u0000${kind}\u0000${dominant}`
    const group = arrayCensus.get(key) ?? { class: arrayClass, kind, elementSignature: dominant, arrays: 0, elements: 0, maxLength: 0, shallowSize: 0 }
    group.arrays++; group.elements += elements.length; group.maxLength = Math.max(group.maxLength, elements.length); group.shallowSize += shallow
    arrayCensus.set(key, group)
    if (arrayClass === 'in_flight') {
      const list = arraysBySignature.get(dominant) ?? []
      list.push({ node, length: elements.length })
      arraysBySignature.set(dominant, list)
    }
  }
  const inFlightSignatures = [...new Set(PHASE2C25D2C_HYPOTHESES.flatMap(h => h.snapshot.type === 'in_flight_arrays' ? [h.snapshot.elementSignature] : []))]
  const arrayCut = (label: string, signatures: readonly string[]) => {
    const arrays = signatures.flatMap(signature => arraysBySignature.get(signature) ?? [])
    const flags = new Uint8Array(graph.schema.edgeCount)
    const targets = new Set(arrays.map(a => a.node))
    if (targets.size > 0) {
      for (let edge = 0; edge < graph.schema.edgeCount; edge++) if (targets.has(heapSnapshotEdgeTarget(graph, edge))) flags[edge] = 1
    }
    return { elementSignature: label, arrays: arrays.length, elements: arrays.reduce((n, a) => n + a.length, 0), maxLength: arrays.reduce((m, a) => Math.max(m, a.length), 0),
      cut: targets.size === 0 ? { nodes: 0, newNodes: 0, newSize: 0, persistentNewSize: 0, inFlightNewSize: 0 } : splitCut(flags) }
  }
  // One cut per hypothesis signature, and (descriptive) all of them together: shared objects fall into no single cut.
  const inFlightArrayCuts = [...inFlightSignatures.map(signature => arrayCut(signature, [signature])), arrayCut(PHASE2C25D2C_IN_FLIGHT_COMBINED, inFlightSignatures)]
  const inFlightArrayPaths = inFlightSignatures.map(signature => {
    const arrays = [...(arraysBySignature.get(signature) ?? [])].sort((a, b) => b.length - a.length || a.node - b.node)
    return { elementSignature: signature, path: arrays.length === 0 ? null : heapSnapshotRetainingPath(graph, full, arrays[0].node, isNew) }
  })

  const signatures = new Map<string, { persistent: { count: number; size: number }; inFlight: { count: number; size: number } }>()
  const strings = new Map<string, { persistent: { count: number; size: number }; inFlight: { count: number; size: number } }>()
  for (let node = 0; node < count; node++) {
    if (klass[node] < 2) continue
    const self = heapSnapshotNodeSelfSize(graph, node)
    const side = klass[node] === 2 ? 'persistent' : 'inFlight'
    const type = heapSnapshotNodeType(graph, node)
    const stringLike = type === 'string' || type === 'concatenated string' || type === 'sliced string'
    const s = censusSignatureOf(node)
    const row = signatures.get(s) ?? { persistent: { count: 0, size: 0 }, inFlight: { count: 0, size: 0 } }
    row[side].count++; row[side].size += self
    signatures.set(s, row)
    if (stringLike) {
      const c = phase2c25d2cStringClass(type, heapSnapshotNodeName(graph, node))
      const srow = strings.get(c) ?? { persistent: { count: 0, size: 0 }, inFlight: { count: 0, size: 0 } }
      srow[side].count++; srow[side].size += self
      strings.set(c, srow)
    }
  }
  const total = (row: { persistent: { size: number }; inFlight: { size: number } }) => row.persistent.size + row.inFlight.size
  return {
    base, newRoot: { nodes: newRootNodes, size: newRootSize }, persistent: { roots: roots.length, newNodes: persistentNodes, newSize: persistentSize },
    inFlight: { newNodes: newRootNodes - persistentNodes, newSize: newRootSize - persistentSize },
    splitCuts, inFlightArrayCuts,
    arrayCensus: [...arrayCensus.values()].sort((a, b) => b.elements - a.elements || b.shallowSize - a.shallowSize || (a.elementSignature < b.elementSignature ? -1 : 1)).slice(0, top),
    signatureCensus: [...signatures.entries()].map(([signature, row]) => ({ signature, ...row }))
      .sort((a, b) => total(b) - total(a) || (a.signature < b.signature ? -1 : 1)).slice(0, top),
    stringCensus: [...strings.entries()].map(([c, row]) => ({ class: c, ...row })).sort((a, b) => total(b) - total(a) || (a.class < b.class ? -1 : 1)),
    inFlightArrayPaths,
  }
}

// ---------------------------------------------------------------- hypothesis evaluation

export interface Phase2C25D2CContextInputs {
  contextKey: string
  snapshot: Pick<Phase2C25D2CSnapshotAnalysis, 'newRoot' | 'splitCuts' | 'inFlightArrayCuts'> | null
  sampling: { jit_default: { thresholdMiB: number; analysis: Pick<Phase2C25D2CProfileAnalysis, 'categories' | 'totalSampledBytes'> } | null
    no_inlining: { thresholdMiB: number; analysis: Pick<Phase2C25D2CProfileAnalysis, 'categories' | 'totalSampledBytes'> } | null }
}

/** The snapshot bytes of one hypothesis (with the persistent / in-flight split), or null without a snapshot. */
export function phase2c25d2cHypothesisCut(hypothesis: Phase2C25D2CHypothesis, snapshot: Phase2C25D2CContextInputs['snapshot']): Phase2C25D2CSplitCut | null {
  if (snapshot === null) return null
  if (hypothesis.snapshot.type === 'edge_group') {
    const group = hypothesis.snapshot.group.group
    const row = snapshot.splitCuts.find(g => g.group === group)
    if (!row) throw new Error(`The snapshot analysis has no edge group ${group}.`)
    return row.cut
  }
  const signature = hypothesis.snapshot.elementSignature
  const row = snapshot.inFlightArrayCuts.find(g => g.elementSignature === signature)
  if (!row) throw new Error(`The snapshot analysis has no in-flight array cut for ${signature}.`)
  return row.cut
}

export function evaluatePhase2C25D2CHypotheses(contexts: readonly Phase2C25D2CContextInputs[]) {
  return PHASE2C25D2C_HYPOTHESES.map(hypothesis => {
    const measures = contexts.map(context => {
      const cut = phase2c25d2cHypothesisCut(hypothesis, context.snapshot)
      const denominator = context.snapshot?.newRoot.size ?? 0
      const snap = cut === null || denominator === 0 ? null : cut.newSize / denominator
      const samp = phase2c25d2cCategoryShare(context.sampling.jit_default?.analysis ?? null, hypothesis.samplingCategories)
      return {
        contextKey: context.contextKey, snapshotShare: snap, snapshotNewBytes: cut?.newSize ?? null,
        snapshotPersistentBytes: cut?.persistentNewSize ?? null, snapshotInFlightBytes: cut?.inFlightNewSize ?? null,
        samplingShareJitDefault: samp, samplingThresholdMiBJitDefault: context.sampling.jit_default?.thresholdMiB ?? null,
        samplingShareNoInliningDiagnostic: phase2c25d2cCategoryShare(context.sampling.no_inlining?.analysis ?? null, hypothesis.samplingCategories),
        level: phase2c25d2cContextLevel(snap, samp),
      }
    })
    const levels = measures.map(m => m.level)
    return { id: hypothesis.id, title: hypothesis.title, retention: hypothesis.retention, samplingCategories: hypothesis.samplingCategories, snapshot: hypothesis.snapshot,
      measures, level: phase2c25d2cOverallLevel(levels), sameLevelInEveryContext: new Set(levels).size === 1 }
  })
}

export type Phase2C25D2CHypothesisResult = ReturnType<typeof evaluatePhase2C25D2CHypotheses>[number]

/** The pre-registered mechanical recommendation (`PHASE2C25D2C_RECOMMENDATION_RULE`). */
export function selectPhase2C25D2CRecommendation(hypotheses: readonly Phase2C25D2CHypothesisResult[]) {
  const strong = hypotheses.filter(h => h.level === 'strong')
  const pool = strong.length > 0 ? strong : hypotheses.filter(h => h.level === 'contributing')
  const minOf = (values: (number | null)[]) => values.some(v => v === null) ? -1 : Math.min(...(values as number[]))
  const ranked = [...pool].map(h => ({ id: h.id, level: h.level, minSnapshotShare: minOf(h.measures.map(m => m.snapshotShare)), minSamplingShareJitDefault: minOf(h.measures.map(m => m.samplingShareJitDefault)) }))
    .sort((a, b) => b.minSnapshotShare - a.minSnapshotShare || b.minSamplingShareJitDefault - a.minSamplingShareJitDefault || (a.id < b.id ? -1 : 1))
  return { rule: PHASE2C25D2C_RECOMMENDATION_RULE.text, pool: strong.length > 0 ? 'strong' as const : ranked.length > 0 ? 'contributing' as const : 'none' as const,
    primary: ranked[0] ?? null, secondary: ranked.slice(1) }
}

// ---------------------------------------------------------------- D2-a effect validation

export interface Phase2C25D2CEffectContextInputs {
  contextKey: string
  snapshot: Pick<Phase2C25D2CSnapshotAnalysis, 'newRoot' | 'splitCuts'> | null
  jitDefault: Pick<Phase2C25D2CProfileAnalysis, 'categories' | 'totalSampledBytes' | 'base'> | null
  noInlining: Pick<Phase2C25D2CProfileAnalysis, 'categories' | 'totalSampledBytes' | 'base'> | null
}

export function evaluatePhase2C25D2CEffect(contexts: readonly Phase2C25D2CEffectContextInputs[]) {
  return PHASE2C25D2C_OLD_MAJORS.map(major => {
    const perContext = contexts.map(context => {
      const cut = context.snapshot?.splitCuts.find(g => g.group === major.snapshotGroup) ?? null
      if (context.snapshot !== null && cut === null) throw new Error(`The snapshot analysis has no edge group ${major.snapshotGroup}.`)
      const snapshotShare = context.snapshot === null || cut === null || context.snapshot.newRoot.size === 0 ? null : cut.cut.newSize / context.snapshot.newRoot.size
      const sampling = (analysis: Phase2C25D2CEffectContextInputs['jitDefault']) => {
        if (analysis === null) return null
        const category = major.samplingCategories.length === 0 ? 0 : (phase2c25d2cCategoryShare(analysis, major.samplingCategories) ?? 0)
        const fn = major.samplingFunction === null ? 0 : (phase2c25d2cFunctionShare(analysis, major.samplingFunction.url, major.samplingFunction.functionName) ?? 0)
        return Math.max(category, fn)
      }
      const jit = sampling(context.jitDefault)
      const noInlining = sampling(context.noInlining)
      return { contextKey: context.contextKey, snapshotShare, samplingShareJitDefault: jit, samplingShareNoInliningDiagnostic: noInlining,
        level: phase2c25d2cEffectLevel([snapshotShare, jit, noInlining]) }
    })
    return { id: major.id, title: major.title, perContext, level: phase2c25d2cStrongestEffect(perContext.map(c => c.level)) }
  })
}
