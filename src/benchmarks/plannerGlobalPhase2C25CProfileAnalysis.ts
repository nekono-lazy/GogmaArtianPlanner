/**
 * Issue #154 Phase 2-C2.5-C: post-hoc analysis of V8 sampling heap profiles, Research only. Never import from Production.
 *
 * A `HeapProfiler.getSamplingProfile` result is a call tree whose node `selfSize` is V8's scaled estimate of the live
 * bytes allocated while that frame was on top of the stack (the profile of this Phase is a live-object profile: objects
 * already collected are not in it). This module aggregates such a tree into callsites (a function at its location),
 * computes self and inclusive sampled bytes, groups them into post-hoc source categories, and compares profiles
 * captured at increasing heap thresholds.
 *
 * - A "callsite" is a frame's function (`functionName` at its function-start `lineNumber` / `columnNumber` of the
 *   evaluated script). V8 reports where the allocating FUNCTION starts, not the allocating statement.
 * - Built-in and anonymous frames (`Array.prototype.map`, `push`, an arrow callback) are additionally attributed to the
 *   nearest Repository frame with a name on their own stack (`attributed`), so an allocation inside `generated.map(...)`
 *   is also counted for the Repository function that called `map`. Raw frames are always reported too.
 * - Categories are an analysis-only grouping by source file and function name. They are not Domain semantics, and an
 *   unknown Repository frame stays `other_repo` rather than being guessed into a category.
 *
 * Sampled bytes are V8's statistical estimate, not an exact byte count; they say which callsites the live heap came
 * from, never which structure keeps it alive (that is the heap snapshot analysis).
 */

export interface SamplingHeapProfileCallFrame {
  functionName: string
  scriptId: string
  url: string
  lineNumber: number
  columnNumber: number
}

export interface SamplingHeapProfileNode {
  callFrame: SamplingHeapProfileCallFrame
  selfSize: number
  id: number
  children: SamplingHeapProfileNode[]
}

export interface SamplingHeapProfileSample {
  size: number
  nodeId: number
  ordinal: number
}

export interface SamplingHeapProfile {
  head: SamplingHeapProfileNode
  samples: SamplingHeapProfileSample[]
}

function fail(message: string): never {
  throw new Error(`Sampling heap profile: ${message}`)
}

function validateNode(value: unknown, ids: Set<number>, depth: number): SamplingHeapProfileNode {
  if (depth > 10_000) fail('the call tree is deeper than 10000 frames.')
  if (typeof value !== 'object' || value === null) fail('a node is not an object.')
  const node = value as Record<string, unknown>
  const frame = node.callFrame as Record<string, unknown> | undefined
  if (typeof frame !== 'object' || frame === null) fail('a node has no callFrame.')
  if (typeof frame.functionName !== 'string' || typeof frame.scriptId !== 'string' || typeof frame.url !== 'string' ||
    typeof frame.lineNumber !== 'number' || typeof frame.columnNumber !== 'number') fail('a callFrame is malformed.')
  if (typeof node.selfSize !== 'number' || !(node.selfSize >= 0) || typeof node.id !== 'number' || !Array.isArray(node.children)) fail('a node is malformed.')
  if (ids.has(node.id)) fail(`node id ${node.id} appears twice.`)
  ids.add(node.id)
  return node as unknown as SamplingHeapProfileNode
}

/** Structural validation of an untrusted profile; fails closed. */
export function validateSamplingHeapProfile(json: unknown): SamplingHeapProfile {
  if (typeof json !== 'object' || json === null) fail('the root is not an object.')
  const root = json as Record<string, unknown>
  const ids = new Set<number>()
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root.head, depth: 0 }]
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!
    const node = validateNode(value, ids, depth)
    for (const child of node.children) stack.push({ value: child, depth: depth + 1 })
  }
  if (!Array.isArray(root.samples)) fail('samples is not an array.')
  for (const sample of root.samples as unknown[]) {
    const s = sample as Record<string, unknown>
    if (typeof s !== 'object' || s === null || typeof s.size !== 'number' || typeof s.nodeId !== 'number' || typeof s.ordinal !== 'number') fail('a sample is malformed.')
    if (!ids.has(s.nodeId as number)) fail(`a sample names unknown node ${String(s.nodeId)}.`)
  }
  return root as unknown as SamplingHeapProfile
}

// ---------------------------------------------------------------- frames, locations, categories

export interface Phase2C25CScriptTable {
  /** `scriptId -> url` from the child's `Debugger.scriptParsed` events (Vite SSR modules report an empty frame url). */
  urlOf(scriptId: string): string | null
  /** Maps a 0-based function start in the evaluated script to its 1-based original source line, when a source map exists. */
  originalPosition?(url: string, lineNumber: number, columnNumber: number): { line: number; column: number } | null
}

/** A frame url normalized to a Repository-relative path (`src/...`), a `node:` / dependency url, or `''` (native / builtin). */
export function normalizePhase2C25CUrl(url: string): string {
  let value = url.replace(/\\/g, '/')
  value = value.replace(/^file:\/\/\/?/, '')
  const src = value.search(/(^|\/)src\//)
  if (src >= 0 && !value.includes('/node_modules/')) return value.slice(value.indexOf('src/', src))
  const nm = value.lastIndexOf('/node_modules/')
  if (nm >= 0) return value.slice(nm + 1)
  return value
}

export function isPhase2C25CRepositoryUrl(normalizedUrl: string): boolean {
  return normalizedUrl.startsWith('src/')
}

export type Phase2C25CSourceCategory =
  | 'reserved_bonus_generation'
  | 'reserved_bonus_steps'
  | 'bonus_solution_materialization'
  | 'bonus_stream_other'
  | 'skill_stream'
  | 'scheduler_channel'
  | 'stream_solution_evaluation'
  | 'semantic_keys'
  | 'lazy_ideal_cross'
  | 'search_work_queue'
  | 'rng_prediction'
  | 'reservation_window'
  | 'planner_alternative_search'
  | 'research_harness'
  | 'other_repo'
  | 'dependency'
  | 'runtime'

export const PHASE2C25C_SOURCE_CATEGORY_RULES: readonly { category: Phase2C25CSourceCategory; rule: string }[] = [
  { category: 'reserved_bonus_steps', rule: 'src/domain/search/bonusStream.ts function reservedBonusSteps' },
  { category: 'reserved_bonus_generation', rule: 'src/domain/search/bonusStream.ts functions ensureReserved, reservedGeneratedState, reservedSet' },
  { category: 'bonus_solution_materialization', rule: 'src/domain/search/bonusStream.ts functions bonusAmendmentOperations, bonusAmendmentResults' },
  { category: 'rng_prediction', rule: 'src/domain/search/bonusStream.ts functions predictReset, predictKeep; src/domain/search/skillStream.ts function predictAt; any src/domain/rng/ file' },
  { category: 'reservation_window', rule: 'src/domain/search/bonusStream.ts function reservedWindow; src/domain/search/skillStream.ts function reservedWindow; src/domain/search/counterReservation*.ts' },
  { category: 'bonus_stream_other', rule: 'any other src/domain/search/bonusStream.ts function' },
  { category: 'skill_stream', rule: 'any other src/domain/search/skillStream.ts function' },
  { category: 'scheduler_channel', rule: 'src/domain/search/targetSearchScheduler.ts' },
  { category: 'stream_solution_evaluation', rule: 'src/domain/search/streamSolutions.ts, src/domain/search/candidateFactory.ts, src/domain/target/' },
  { category: 'semantic_keys', rule: 'src/domain/search/semanticKeys.ts, src/domain/models/hashing.ts' },
  { category: 'lazy_ideal_cross', rule: 'src/domain/search/lazyIdealCross.ts' },
  { category: 'search_work_queue', rule: 'src/domain/search/searchWorkQueue.ts' },
  { category: 'planner_alternative_search', rule: 'src/domain/search/alternative/' },
  { category: 'research_harness', rule: 'src/benchmarks/' },
  { category: 'other_repo', rule: 'any other src/ file' },
  { category: 'dependency', rule: 'node_modules/' },
  { category: 'runtime', rule: 'node: / internal / empty url (V8 builtins, GC, root) with no Repository frame on its stack' },
]

/** The post-hoc category of a Repository frame (normalized url + function name). Mechanical; no guessing. */
export function categorizePhase2C25CRepositoryFrame(normalizedUrl: string, functionName: string): Phase2C25CSourceCategory {
  const file = normalizedUrl
  if (file === 'src/domain/search/bonusStream.ts') {
    if (functionName === 'reservedBonusSteps') return 'reserved_bonus_steps'
    if (['ensureReserved', 'reservedGeneratedState', 'reservedSet'].includes(functionName)) return 'reserved_bonus_generation'
    if (['bonusAmendmentOperations', 'bonusAmendmentResults'].includes(functionName)) return 'bonus_solution_materialization'
    if (['predictReset', 'predictKeep'].includes(functionName)) return 'rng_prediction'
    if (functionName === 'reservedWindow') return 'reservation_window'
    return 'bonus_stream_other'
  }
  if (file === 'src/domain/search/skillStream.ts') {
    if (functionName === 'predictAt') return 'rng_prediction'
    if (functionName === 'reservedWindow') return 'reservation_window'
    return 'skill_stream'
  }
  if (/^src\/domain\/search\/counterReservation[^/]*\.ts$/.test(file)) return 'reservation_window'
  if (file === 'src/domain/search/targetSearchScheduler.ts') return 'scheduler_channel'
  if (file === 'src/domain/search/streamSolutions.ts' || file === 'src/domain/search/candidateFactory.ts' || file.startsWith('src/domain/target/')) return 'stream_solution_evaluation'
  if (file === 'src/domain/search/semanticKeys.ts' || file === 'src/domain/models/hashing.ts') return 'semantic_keys'
  if (file === 'src/domain/search/lazyIdealCross.ts') return 'lazy_ideal_cross'
  if (file === 'src/domain/search/searchWorkQueue.ts') return 'search_work_queue'
  if (file.startsWith('src/domain/rng/')) return 'rng_prediction'
  if (file.startsWith('src/domain/search/alternative/')) return 'planner_alternative_search'
  if (file.startsWith('src/benchmarks/')) return 'research_harness'
  return 'other_repo'
}

// ---------------------------------------------------------------- aggregation

export interface Phase2C25CCallsite {
  key: string
  functionName: string
  /** Normalized url; `''` for a native / builtin frame. */
  url: string
  scriptId: string
  /** 0-based function start in the evaluated (transformed) script, as V8 reports it. */
  lineNumber: number
  columnNumber: number
  /** 1-based original source line / 0-based column of the function start, when a source map resolved it. */
  originalLine: number | null
  originalColumn: number | null
  repository: boolean
  category: Phase2C25CSourceCategory
  sampledSelfBytes: number
  sampledInclusiveBytes: number
  selfSamples: number
}

export interface Phase2C25CProfileAnalysis {
  totalSampledBytes: number
  totalSamples: number
  repositorySelfBytes: number
  /** Raw frames (native / builtin frames under their own name). */
  callsites: Phase2C25CCallsite[]
  /**
   * The same bytes attributed to the nearest named Repository frame on each node's stack (the node itself when it is
   * one); bytes with no Repository frame on their stack stay under their raw frame. Self bytes sum to the total.
   */
  attributedCallsites: Phase2C25CCallsite[]
  categories: { category: Phase2C25CSourceCategory; sampledSelfBytes: number; share: number; selfSamples: number }[]
}

interface FrameInfo {
  key: string
  functionName: string
  url: string
  scriptId: string
  lineNumber: number
  columnNumber: number
  originalLine: number | null
  originalColumn: number | null
  repository: boolean
  category: Phase2C25CSourceCategory
}

function frameInfo(frame: SamplingHeapProfileCallFrame, scripts: Phase2C25CScriptTable, memo: Map<string, FrameInfo>): FrameInfo {
  const rawUrl = frame.url !== '' ? frame.url : (scripts.urlOf(frame.scriptId) ?? '')
  const memoKey = `${frame.functionName}\u0000${rawUrl}\u0000${frame.lineNumber}\u0000${frame.columnNumber}`
  const cached = memo.get(memoKey)
  if (cached) return cached
  const url = normalizePhase2C25CUrl(rawUrl)
  const repository = isPhase2C25CRepositoryUrl(url)
  const original = repository && scripts.originalPosition ? scripts.originalPosition(rawUrl, frame.lineNumber, frame.columnNumber) : null
  const category: Phase2C25CSourceCategory = repository ? categorizePhase2C25CRepositoryFrame(url, frame.functionName)
    : url.startsWith('node_modules/') ? 'dependency' : 'runtime'
  const info: FrameInfo = {
    key: `${frame.functionName || '(anonymous)'} ${url || '(native)'}:${original?.line ?? `~${frame.lineNumber}`}`,
    functionName: frame.functionName, url, scriptId: frame.scriptId, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber,
    originalLine: original?.line ?? null, originalColumn: original?.column ?? null, repository, category,
  }
  memo.set(memoKey, info)
  return info
}

function emptyCallsite(info: FrameInfo): Phase2C25CCallsite {
  return { ...info, sampledSelfBytes: 0, sampledInclusiveBytes: 0, selfSamples: 0 }
}

/**
 * Aggregates one sampling heap profile. Inclusive bytes count a node's self bytes once for every DISTINCT callsite on
 * its stack (a recursive function is not counted twice for one allocation).
 */
export function analyzeSamplingHeapProfile(profile: SamplingHeapProfile, scripts: Phase2C25CScriptTable): Phase2C25CProfileAnalysis {
  const memo = new Map<string, FrameInfo>()
  const samplesByNode = new Map<number, number>()
  for (const sample of profile.samples) samplesByNode.set(sample.nodeId, (samplesByNode.get(sample.nodeId) ?? 0) + 1)
  const raw = new Map<string, Phase2C25CCallsite>()
  const attributed = new Map<string, Phase2C25CCallsite>()
  let totalSampledBytes = 0
  const get = (map: Map<string, Phase2C25CCallsite>, info: FrameInfo) => {
    let site = map.get(info.key)
    if (!site) { site = emptyCallsite(info); map.set(info.key, site) }
    return site
  }
  // Iterative DFS: the stack holds the frames of the current path; `active` counts each raw / attributed key on it.
  interface Visit { node: SamplingHeapProfileNode; info: FrameInfo; attributed: FrameInfo; childIndex: number; enteredRaw: boolean; enteredAttributed: boolean }
  const activeRaw = new Map<string, number>()
  const activeAttributed = new Map<string, number>()
  const enter = (active: Map<string, number>, key: string) => { const n = active.get(key) ?? 0; active.set(key, n + 1); return n === 0 }
  const leave = (active: Map<string, number>, key: string) => { const n = active.get(key)! - 1; if (n === 0) active.delete(key); else active.set(key, n) }
  const visit = (node: SamplingHeapProfileNode, parentAttributed: FrameInfo | null): Visit => {
    const info = frameInfo(node.callFrame, scripts, memo)
    const own = info.repository && info.functionName !== '' ? info : null
    const attributedInfo = own ?? parentAttributed ?? info
    return { node, info, attributed: attributedInfo, childIndex: 0, enteredRaw: enter(activeRaw, info.key), enteredAttributed: enter(activeAttributed, attributedInfo.key) }
  }
  const stack: Visit[] = [visit(profile.head, null)]
  const account = (v: Visit) => {
    const self = v.node.selfSize
    if (self === 0 && !samplesByNode.has(v.node.id)) return
    totalSampledBytes += self
    const samples = samplesByNode.get(v.node.id) ?? 0
    const rawSite = get(raw, v.info)
    rawSite.sampledSelfBytes += self
    rawSite.selfSamples += samples
    const attributedSite = get(attributed, v.attributed)
    attributedSite.sampledSelfBytes += self
    attributedSite.selfSamples += samples
    for (const key of activeRaw.keys()) raw.get(key)!.sampledInclusiveBytes += self
    for (const key of activeAttributed.keys()) attributed.get(key)!.sampledInclusiveBytes += self
  }
  // Make sure every active key has a callsite entry before inclusive accounting.
  const ensure = (v: Visit) => { get(raw, v.info); get(attributed, v.attributed) }
  ensure(stack[0])
  account(stack[0])
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.childIndex < top.node.children.length) {
      const child = top.node.children[top.childIndex++]
      const parentRepo = top.attributed.repository && top.attributed.functionName !== '' ? top.attributed : null
      const next = visit(child, parentRepo)
      ensure(next)
      stack.push(next)
      account(next)
      continue
    }
    stack.pop()
    leave(activeRaw, top.info.key)
    leave(activeAttributed, top.attributed.key)
  }
  const sortSites = (map: Map<string, Phase2C25CCallsite>) => [...map.values()].filter(s => s.sampledInclusiveBytes > 0 || s.sampledSelfBytes > 0)
    .sort((a, b) => b.sampledSelfBytes - a.sampledSelfBytes || b.sampledInclusiveBytes - a.sampledInclusiveBytes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const attributedCallsites = sortSites(attributed)
  const byCategory = new Map<Phase2C25CSourceCategory, { bytes: number; samples: number }>()
  for (const site of attributedCallsites) {
    const current = byCategory.get(site.category) ?? { bytes: 0, samples: 0 }
    byCategory.set(site.category, { bytes: current.bytes + site.sampledSelfBytes, samples: current.samples + site.selfSamples })
  }
  return {
    totalSampledBytes,
    totalSamples: profile.samples.length,
    repositorySelfBytes: attributedCallsites.filter(s => s.repository).reduce((sum, s) => sum + s.sampledSelfBytes, 0),
    callsites: sortSites(raw),
    attributedCallsites,
    categories: [...byCategory.entries()].map(([category, v]) => ({ category, sampledSelfBytes: v.bytes, share: totalSampledBytes === 0 ? 0 : v.bytes / totalSampledBytes, selfSamples: v.samples }))
      .sort((a, b) => b.sampledSelfBytes - a.sampledSelfBytes || (a.category < b.category ? -1 : 1)),
  }
}

export function topPhase2C25CCallsites(sites: readonly Phase2C25CCallsite[], count: number, filter: (site: Phase2C25CCallsite) => boolean = () => true): Phase2C25CCallsite[] {
  return sites.filter(filter).slice(0, count)
}

// ---------------------------------------------------------------- threshold growth

export interface Phase2C25CThresholdProfile {
  thresholdMiB: number
  heapUsedBytes: number
  analysis: Phase2C25CProfileAnalysis
}

export interface Phase2C25CThresholdGrowth {
  thresholdsMiB: number[]
  totalSampledBytes: number[]
  categories: { category: Phase2C25CSourceCategory; sampledSelfBytes: number[]; share: number[] }[]
  /**
   * The attributed callsites that are in the top list of the LAST reached threshold, with their bytes at every
   * threshold and `growthVsTotal`: (bytes at last / bytes at first) / (total at last / total at first), 1 when the
   * callsite grew in proportion to the whole sampled live heap. `null` when the first profile holds none of it.
   */
  topCallsites: { key: string; category: Phase2C25CSourceCategory; sampledSelfBytes: number[]; share: number[]; growthVsTotal: number | null }[]
}

/** Category shares and top callsites across the thresholds a context reached, in ascending order. */
export function comparePhase2C25CThresholds(profiles: readonly Phase2C25CThresholdProfile[], topCount: number): Phase2C25CThresholdGrowth {
  const ordered = [...profiles].sort((a, b) => a.thresholdMiB - b.thresholdMiB)
  if (ordered.length === 0) return { thresholdsMiB: [], totalSampledBytes: [], categories: [], topCallsites: [] }
  const totals = ordered.map(p => p.analysis.totalSampledBytes)
  const categoryNames = [...new Set(ordered.flatMap(p => p.analysis.categories.map(c => c.category)))]
  const categories = categoryNames.map(category => {
    const bytes = ordered.map(p => p.analysis.categories.find(c => c.category === category)?.sampledSelfBytes ?? 0)
    return { category, sampledSelfBytes: bytes, share: bytes.map((b, i) => totals[i] === 0 ? 0 : b / totals[i]) }
  }).sort((a, b) => b.sampledSelfBytes[b.sampledSelfBytes.length - 1] - a.sampledSelfBytes[a.sampledSelfBytes.length - 1] || (a.category < b.category ? -1 : 1))
  const last = ordered[ordered.length - 1].analysis
  const topCallsites = last.attributedCallsites.slice(0, topCount).map(site => {
    const bytes = ordered.map(p => p.analysis.attributedCallsites.find(s => s.key === site.key)?.sampledSelfBytes ?? 0)
    const growthVsTotal = bytes[0] === 0 || totals[0] === 0 ? null : (bytes[bytes.length - 1] / bytes[0]) / (totals[totals.length - 1] / totals[0])
    return { key: site.key, category: site.category, sampledSelfBytes: bytes, share: bytes.map((b, i) => totals[i] === 0 ? 0 : b / totals[i]), growthVsTotal }
  })
  return { thresholdsMiB: ordered.map(p => p.thresholdMiB), totalSampledBytes: totals, categories, topCallsites }
}
