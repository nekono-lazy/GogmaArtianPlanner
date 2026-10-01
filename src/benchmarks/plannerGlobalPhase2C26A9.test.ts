import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import rawA5 from '../../docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json?raw'
import rawA6 from '../../docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json?raw'
import rawA7 from '../../docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json?raw'
import rawA8 from '../../docs/PLANNER_GLOBAL_PHASE2C26A8_RESULT.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import hashingSource from '../domain/models/hashing.ts?raw'
import semanticKeysSource from '../domain/search/semanticKeys.ts?raw'
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import { parsePhase2C26A3ResultAuthority, type Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import { parsePhase2C26A4ResultAuthority, type Phase2C26A5A4Authority, type Phase2C26A5ClockPair } from './plannerGlobalPhase2C26A5'
import type { CpuProfile, CpuProfileCallFrame, Phase2C26A5ScriptTable } from './plannerGlobalPhase2C26A5Analysis'
import { parsePhase2C26A5ResultAuthority, type Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import { parsePhase2C26A6ResultAuthority, type Phase2C26A7A6Authority } from './plannerGlobalPhase2C26A7'
import {
  parsePhase2C26A7ResultAuthority,
  PHASE2C26A8_PRIMARY_NODE_FLAGS,
  PHASE2C26A8_PROFILER,
  PHASE2C26A8_SEARCH_INSTRUMENTATION,
  type Phase2C26A8A7Authority,
} from './plannerGlobalPhase2C26A8'
import {
  analyzePhase2C26A8Profile,
  derivePhase2C26A8FrontierBlock,
  derivePhase2C26A8FunctionSpans,
  phase2c26a8DecisionRow,
  type Phase2C26A8Category,
  type Phase2C26A8IntervalReconstruction,
} from './plannerGlobalPhase2C26A8Analysis'
import {
  parsePhase2C26A8ResultAuthority,
  PHASE2C26A9_DIAGNOSTIC,
  PHASE2C26A9_PRIMARY_NODE_FLAGS,
  PHASE2C26A9_PRODUCTION_CHANGE,
  PHASE2C26A9_PROFILER,
  PHASE2C26A9_SEARCH_INSTRUMENTATION,
  validatePhase2C26A9ConditionParity,
  validatePhase2C26A9OptimizationSource,
  validatePhase2C26A9ProductionChange,
  type Phase2C26A9A8Authority,
} from './plannerGlobalPhase2C26A9'
import {
  comparePhase2C26A9DirectTiming,
  comparePhase2C26A9LifecyclePrefix,
  countPhase2C26A9CacheHelperSamples,
  phase2c26a9ComparisonRow,
  phase2c26a9Decision,
  phase2c26a9WholeRunTotals,
  PHASE2C26A9_DECISION_RULE,
  validatePhase2C26A9FormalRun,
} from './plannerGlobalPhase2C26A9Analysis'

/*
 * Issue #154 Phase 2-C2.6-A9. One Production change (the lazy WeakMap cache of stableStringify(bonuses) inside the
 * held-aware compareReservedRepresentative); the representative rule itself is fixed by
 * `src/domain/search/reservedBonusStreamRepresentative.test.ts` on the real stream. Here: the committed A8 .. C2.6-A
 * RESULTs as the fail-closed authorities, the registered Production change, the A8 conditions, the before / after
 * comparison helpers and the pre-registered decision rule. No duration is asserted.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a), a2Json = JSON.parse(rawA2), a3Json = JSON.parse(rawA3), a4Json = JSON.parse(rawA4), a5Json = JSON.parse(rawA5)
const a6Json = JSON.parse(rawA6), a7Json = JSON.parse(rawA7), a8Json = JSON.parse(rawA8)
let shas = { c26a: '', a2: '', a3: '', a4: '', a5: '', a6: '', a7: '' }
let a8Sha = ''
beforeAll(async () => {
  shas = { c26a: await sha256Hex(rawC26a), a2: await sha256Hex(rawA2), a3: await sha256Hex(rawA3), a4: await sha256Hex(rawA4), a5: await sha256Hex(rawA5),
    a6: await sha256Hex(rawA6), a7: await sha256Hex(rawA7) }
  a8Sha = await sha256Hex(rawA8)
})

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority; a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority;
  a6: Phase2C26A7A6Authority; a7: Phase2C26A8A7Authority } {
  const c26a = parsePhase2C26AAuthority(c26aJson)
  if (!c26a.authority) throw new Error(c26a.issues.join('; '))
  const a2 = parsePhase2C26A2ResultAuthority(a2Json, shas.c26a, c26a.authority)
  if (!a2.authority) throw new Error(a2.issues.join('; '))
  const a3 = parsePhase2C26A3ResultAuthority(a3Json, shas.c26a, shas.a2, a2.authority, c26a.authority)
  if (!a3.authority) throw new Error(a3.issues.join('; '))
  const a4 = parsePhase2C26A4ResultAuthority(a4Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 }, a3.authority, c26a.authority)
  if (!a4.authority) throw new Error(a4.issues.join('; '))
  const a5 = parsePhase2C26A5ResultAuthority(a5Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4 }, a4.authority, c26a.authority)
  if (!a5.authority) throw new Error(a5.issues.join('; '))
  const a6 = parsePhase2C26A6ResultAuthority(a6Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5 }, a5.authority, c26a.authority)
  if (!a6.authority) throw new Error(a6.issues.join('; '))
  const a7 = parsePhase2C26A7ResultAuthority(a7Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5, a6: shas.a6 }, a6.authority, c26a.authority)
  if (!a7.authority) throw new Error(a7.issues.join('; '))
  return { c26a: c26a.authority, a2: a2.authority, a3: a3.authority, a4: a4.authority, a5: a5.authority, a6: a6.authority, a7: a7.authority }
}
function a8Authority(): Phase2C26A9A8Authority {
  const { c26a, a7 } = authorities()
  const parsed = parsePhase2C26A8ResultAuthority(a8Json, shas, a7, c26a)
  if (!parsed.authority) throw new Error(parsed.issues.join('; '))
  return parsed.authority
}

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-A8 RESULT as the selection and before-evidence authority', () => {
  it('accepts the committed formal A8 RESULT (Case S) made against the committed A7 .. C2.6-A RESULTs and takes its selection and valid primaries', () => {
    const { c26a, a7 } = authorities()
    const parsed = parsePhase2C26A8ResultAuthority(a8Json, shas, a7, c26a)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority?.decisionCase).toBe('S_stable_serialization_dominant')
    // The selection is A8's = A7's; the comparison set is A8's own decision.validPrimaries (evidence check only, no ID in source).
    expect(parsed.authority?.primaryOrientationIds).toEqual(a7.primaryOrientationIds)
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    expect(parsed.authority?.validPrimaryOrientationIds).toEqual(a8Json.summary.decision.validPrimaries)
    expect(parsed.authority?.validPrimaryOrientationIds).toEqual(['c6-p1', 'c14-p0'])
    const invalid = parsed.authority?.references.find(r => !r.profileValid)
    expect(invalid?.negativeTimeDeltas).toBe(1)
    for (const reference of parsed.authority?.references.filter(r => r.profileValid) ?? []) {
      expect(reference.largestCategory).toBe('representative_stable_serialization')
      expect(reference.shares.representative_stable_serialization).toBeGreaterThan(0.6)
      expect(reference.negativeTimeDeltas).toBe(0)
    }
    expect(parsed.authority?.runSha256).toBe(a8Json.sources.run.sha256)
    expect(parsed.authority?.measuredHead).toBe(a8Json.provenance.measuredHead)
  })

  it('fails closed on a non-formal A8, another case, a failure count, a broken SHA chain, another selection or inconsistent profile validity', () => {
    const { c26a, a7 } = authorities()
    const mutate = (edit: (json: typeof a8Json) => void) => { const json = structuredClone(a8Json); edit(json); return parsePhase2C26A8ResultAuthority(json, shas, a7, c26a) }
    const zero = '0'.repeat(64)
    for (const key of ['c26a', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] as const) expect(parsePhase2C26A8ResultAuthority(a8Json, { ...shas, [key]: zero }, a7, c26a).valid, key).toBe(false)
    expect(parsePhase2C26A8ResultAuthority(a8Json, shas, { ...a7, primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(parsePhase2C26A8ResultAuthority(a8Json, shas, { ...a7, measuredHead: '0'.repeat(40) }, c26a).valid).toBe(false)
    expect(parsePhase2C26A8ResultAuthority(a8Json, shas, { ...a7, runSha256: zero }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(mutate(json => { json.provenance.a7RawShaMatches = false }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.conditionParity.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.baselineParity.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'M_mixed_or_insufficient' }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.category = 'frontier_sort' }).valid).toBe(false)
    expect(mutate(json => { json.conclusion.decision.case = 'T_frontier_sort_dominant' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.timeout = 2; json.summary.childStatus.completed = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.semanticFailures = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.contractViolations = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.validPrimaries = ['c6-p1'] ; json.summary.profileQuality.validPrimaries = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.profileQuality.validPrimaries = 3 }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary[1].decisionRow.valid = true }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary[0].decisionRow.largestCategory = 'gc' }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary[0].semanticParity.depthPrefix.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.perPrimary = [json.perPrimary[1], json.perPrimary[0], json.perPrimary[2]] }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a6ShaRecordedByA7 = zero }).valid).toBe(false)
    expect(mutate(json => { json.sources.a7Run.sha256 = zero }).valid).toBe(false)
    expect(mutate(json => { delete json.sources.run }).valid).toBe(false)
    expect(mutate(json => { json.conditions.cpuProfiler = false }).valid).toBe(false)
    expect(mutate(json => { json.profilerConfig.warmupMs = 60_000 }).valid).toBe(false)
    expect(mutate(json => { json.conditions.searchInstrumentation.onGogmaReservedRuntime = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected = ['c6-p1', 'c13-p1'] }).valid).toBe(false)
    expect(parsePhase2C26A8ResultAuthority(null, shas, a7, c26a).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- the one Production change

describe('Phase 2-C2.6-A9 registered Production change', () => {
  it('accepts exactly bonusStream.ts (plus Research / test sources) and fails closed on any other or a missing one', () => {
    expect(PHASE2C26A9_PRODUCTION_CHANGE).toEqual(['src/domain/search/bonusStream.ts'])
    expect(validatePhase2C26A9ProductionChange(['src/domain/search/bonusStream.ts']).valid).toBe(true)
    expect(validatePhase2C26A9ProductionChange(['src/domain/search/bonusStream.ts', 'src/benchmarks/plannerGlobalPhase2C26A9.ts',
      'src/domain/search/reservedBonusStreamRepresentative.test.ts', 'src/test/fixtures/x.ts']).valid).toBe(true)
    expect(validatePhase2C26A9ProductionChange([]).valid).toBe(false)
    expect(validatePhase2C26A9ProductionChange(['src/benchmarks/plannerGlobalPhase2C26A9.ts']).valid).toBe(false)
    for (const path of ['src/domain/models/hashing.ts', 'src/domain/search/semanticKeys.ts', 'src/domain/search/targetSearchScheduler.ts']) {
      expect(validatePhase2C26A9ProductionChange(['src/domain/search/bonusStream.ts', path]).valid, path).toBe(false)
    }
    expect(validatePhase2C26A9ProductionChange(['src/domain/search/bonusStream.ts', 'docs/SEARCH_SPEC.md']).valid).toBe(false)
  })

  it('finds the registered optimization in the current source and refuses a changed rule, a global cache or a touched ordinary comparator', () => {
    expect(validatePhase2C26A9OptimizationSource(bonusStreamSource)).toEqual({ valid: true, issues: [] })
    const swap = (from: string, to: string) => { expect(bonusStreamSource.includes(from), from).toBe(true); return validatePhase2C26A9OptimizationSource(bonusStreamSource.replace(from, to)) }
    expect(swap('compareStableKeys(reservedBonusStableKey(left.bonuses), reservedBonusStableKey(right.bonuses))',
      'compareStableKeys(reservedBonusStableKey(right.bonuses), reservedBonusStableKey(left.bonuses))').valid).toBe(false)
    expect(swap('right.lastResetDepth - left.lastResetDepth ||\n      compareStableKeys(reservedBonusStableKey', 'compareStableKeys(reservedBonusStableKey').valid).toBe(false)
    expect(swap('compareStableKeys(stableStringify(left.bonuses), stableStringify(right.bonuses))', 'compareStableKeys(reservedBonusStableKey(left.bonuses), reservedBonusStableKey(right.bonuses))').valid).toBe(false)
    expect(swap('  const reservedBonusStableKeys = new WeakMap<RestorationBonusSet, string>()', '  const reservedBonusStableKeys = new Map<RestorationBonusSet, string>()').valid).toBe(false)
    expect(swap('  const reservedBonusStableKeys = new WeakMap<RestorationBonusSet, string>()', 'const reservedBonusStableKeys = new WeakMap<RestorationBonusSet, string>()').valid).toBe(false)
    expect(swap('    reservedBonusStableKeys.set(bonuses, key)\n', '').valid).toBe(false)
  })

  it('keeps every A8 registered function and the frontier block derivable from the optimized source', () => {
    const sources = { 'src/domain/search/bonusStream.ts': bonusStreamSource, 'src/domain/models/hashing.ts': hashingSource, 'src/domain/search/semanticKeys.ts': semanticKeysSource }
    const spans = derivePhase2C26A8FunctionSpans(sources)
    expect(spans.map(s => s.functionName)).toEqual(['generateReservedDepth', 'compareReservedRepresentative', 'compareReservedFrontier', 'stableStringify', 'serializeStable', 'compareStableKeys'])
    const block = derivePhase2C26A8FrontierBlock(bonusStreamSource)
    expect(block.lines.map(l => l.text)).toEqual(expect.arrayContaining(['if (!current || compareReservedRepresentative(state, current) < 0) byKey.set(key, state)',
      'set.frontier = [...byKey.values()].sort(compareReservedFrontier)']))
  })
})

// ---------------------------------------------------------------- conditions

describe('Phase 2-C2.6-A9 conditions', () => {
  it('accepts every A8 primary condition and the registered profiler, and rejects another budget, heap flag, instrumentation or profiler window', () => {
    const { c26a, a2, a3, a4, a5, a6, a7 } = authorities()
    const a8 = a8Authority()
    const current = { ...a8.conditions, nodeFlags: [...PHASE2C26A9_PRIMARY_NODE_FLAGS], searchInstrumentation: { ...PHASE2C26A9_SEARCH_INSTRUMENTATION },
      profiler: { ...PHASE2C26A9_PROFILER } } as unknown as Phase2C26A2RunConditions & { nodeFlags: string[]; searchInstrumentation: unknown; profiler: unknown }
    const parity = (value: typeof current, authority = a8) => validatePhase2C26A9ConditionParity(value, authority, a7.conditions, a6.conditions, a5.conditions, a4.conditions,
      a3.conditions, c26a, a2.conditions)
    expect(parity(current).issues).toEqual([])
    expect(PHASE2C26A9_PRIMARY_NODE_FLAGS).toEqual(PHASE2C26A8_PRIMARY_NODE_FLAGS)
    expect(PHASE2C26A9_SEARCH_INSTRUMENTATION).toEqual(PHASE2C26A8_SEARCH_INSTRUMENTATION)
    expect(PHASE2C26A9_PROFILER).toEqual(PHASE2C26A8_PROFILER)
    expect(PHASE2C26A9_DIAGNOSTIC).toBe(false)
    expect(a8.conditions).toMatchObject({ childHeapLimitMb: 8192, concurrency: 1, orientationBudgetMs: 1_800_000, nodeYield: 'setImmediate', researchMaxPlanSteps: 20_000,
      extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }, bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 } })
    expect(parity({ ...current, orientationBudgetMs: 60_000 }).valid).toBe(false)
    expect(parity({ ...current, nodeFlags: ['--max-old-space-size=4096'] }).valid).toBe(false)
    expect(parity({ ...current, nodeFlags: ['--no-turbo-inlining', '--no-maglev-inlining', '--max-old-space-size=8192'] }).valid).toBe(false)
    expect(parity({ ...current, searchInstrumentation: { ...PHASE2C26A9_SEARCH_INSTRUMENTATION, onGogmaReservedDepth: true } }).valid).toBe(false)
    expect(parity({ ...current, concurrency: 2 }).valid).toBe(false)
    expect(parity({ ...current, profiler: { ...PHASE2C26A9_PROFILER, warmupMs: 60_000 } }).valid).toBe(false)
    expect(parity({ ...current, profiler: { ...PHASE2C26A9_PROFILER, requestedSamplingIntervalUs: 1000 } }).valid).toBe(false)
    expect(parity(current, { ...a8, conditions: { ...a8.conditions, cpuProfiler: false } }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- direct timing and lifecycle prefix

const depthRecord = (seq: number, depth: number, generatedStates: number, frontierStatesAfter: number, frontierMs: number, extra: Record<string, number> = {}) => ({
  kind: 'gogma_depth', seq, targetOrdinal: 0, streamIndex: 0, startGogmaCounter: 55, depth, exhausted: false,
  counts: { frontierStatesBefore: 1, legalPositionCount: 3, generatedStates, frontierStatesAfter, windowMemoEntries: 4 },
  phaseMs: { window_collection: 1, support_evaluation: 1, state_generation: 10, solution_materialization: 1, frontier_reduction_sort: frontierMs, exhaustion_scan: 1, ...extra },
  inclusiveMs: 20, startedMs: seq, completedMs: seq + 1 })

describe('Phase 2-C2.6-A9 direct frontier timing on the semantic common prefix', () => {
  it('compares only the leading identical depth records and reports ns per representative comparison', () => {
    const before = { gogmaRuntime: [{ kind: 'gogma_phase_started', seq: 1 }, depthRecord(2, 1, 110, 10, 40), depthRecord(3, 2, 210, 10, 80)] }
    const after = { gogmaRuntime: [depthRecord(1, 1, 110, 10, 10), depthRecord(2, 2, 210, 10, 20), depthRecord(3, 3, 310, 10, 99)] }
    const timing = comparePhase2C26A9DirectTiming(before, after)
    expect(timing.valid).toBe(true)
    expect(timing).toMatchObject({ beforeDepths: 2, afterDepths: 3, commonDepths: 2 })
    expect(timing.before.representativeCompareCalls).toBe(300)
    expect(timing.after.representativeCompareCalls).toBe(300)
    expect(timing.frontier.beforeMs).toBe(120)
    expect(timing.frontier.afterMs).toBe(30)
    expect(timing.frontier.beforeNsPerCompareCall).toBeCloseTo(120 * 1e6 / 300)
    expect(timing.frontier.afterNsPerCompareCall).toBeCloseTo(30 * 1e6 / 300)
    expect(timing.frontier.perCompareCallRatio).toBeCloseTo(0.25)
    expect(timing.sectionRatios.state_generation).toBeCloseTo(1)
    expect(phase2c26a9WholeRunTotals(after).depths).toBe(3)
    expect(phase2c26a9WholeRunTotals(after).sectionMs.frontier_reduction_sort).toBe(129)
  })

  it('ends the prefix at the first differing depth (identity or counts) and is then invalid', () => {
    const before = { gogmaRuntime: [depthRecord(1, 1, 110, 10, 40), depthRecord(2, 2, 210, 10, 80)] }
    const after = { gogmaRuntime: [depthRecord(1, 1, 110, 10, 10), depthRecord(2, 2, 210, 11, 20)] }
    const timing = comparePhase2C26A9DirectTiming(before, after)
    expect(timing.valid).toBe(false)
    expect(timing.commonDepths).toBe(1)
    expect(timing.frontier.beforeMs).toBe(40)
    expect(comparePhase2C26A9DirectTiming(before, { gogmaRuntime: [] }).valid).toBe(false)
    expect(comparePhase2C26A9DirectTiming(null, after).valid).toBe(false)
  })

  it('compares the lifecycle events (event and cumulative prediction counts, never the time) on their common prefix', () => {
    const event = (seq: number, type: string, keep: number, elapsedMs = seq) => ({ kind: 'lifecycle', seq, elapsedMs, event: { type, targetOrdinal: 0 },
      predictionCounts: { predictNormalArtian: 1, predictSkills: 0, resetBonuses: 2, keepBonuses: keep }, search: null, searchDepths: null })
    const before = { events: [{ kind: 'kernel_invoked' }, event(1, 'target_started', 5), event(2, 'search_started', 5)] }
    const after = { events: [event(1, 'target_started', 5, 99), event(2, 'search_started', 5, 120), event(3, 'search_completed', 9)] }
    expect(comparePhase2C26A9LifecyclePrefix(before, after)).toMatchObject({ valid: true, beforeEvents: 2, afterEvents: 3, commonEvents: 2 })
    expect(comparePhase2C26A9LifecyclePrefix(before, { events: [event(1, 'target_started', 6)] }).valid).toBe(false)
    expect(comparePhase2C26A9LifecyclePrefix(before, { events: [] }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- the cache helper frame (descriptive)

describe('Phase 2-C2.6-A9 cache helper frame count', () => {
  const sources = { 'src/domain/search/bonusStream.ts': bonusStreamSource, 'src/domain/models/hashing.ts': hashingSource, 'src/domain/search/semanticKeys.ts': semanticKeysSource }
  const spans = derivePhase2C26A8FunctionSpans(sources)
  const span = (name: string) => spans.find(s => s.functionName === name)!
  const fakeScripts: Phase2C26A5ScriptTable = {
    urlOf: id => (id.startsWith('s:') ? `D:/repo/${id.slice(2)}` : null),
    originalLine: (id, lineNumber) => (id.startsWith('s:src/') && lineNumber >= 0 ? lineNumber + 1 : null),
  }
  const frame = (functionName: string, file: string, originalLine = 1): CpuProfileCallFrame =>
    ({ functionName, scriptId: file === '' ? '0' : `s:${file}`, url: '', lineNumber: originalLine - 1, columnNumber: 0 })
  const BS = 'src/domain/search/bonusStream.ts', HS = 'src/domain/models/hashing.ts'
  const helperLine = bonusStreamSource.split(/\r?\n/).findIndex(line => /function reservedBonusStableKey\(/.test(line)) + 1
  const F = {
    root: frame('(root)', ''),
    owner: frame('generateReservedDepth', BS, span('generateReservedDepth').startLine),
    representative: frame('compareReservedRepresentative', BS, span('compareReservedRepresentative').startLine),
    helper: frame('reservedBonusStableKey', BS, helperLine),
    stringify: frame('stableStringify', HS, span('stableStringify').startLine),
    serialize: frame('serializeStable', HS, span('serializeStable').startLine),
  }
  type Node = { id: number; callFrame: CpuProfileCallFrame; children: number[] }
  function buildProfile(samples: { atUs: number; stack: CpuProfileCallFrame[] }[], startUs: number, endUs: number): CpuProfile {
    const nodes: Node[] = [{ id: 1, callFrame: F.root, children: [] }]
    const leafOf = (stack: CpuProfileCallFrame[]) => {
      let node = nodes[0]
      for (const f of stack.slice(1)) {
        let child = node.children.map(id => nodes.find(n => n.id === id)!).find(n => n.callFrame === f)
        if (!child) { child = { id: nodes.length + 1, callFrame: f, children: [] }; nodes.push(child); node.children.push(child.id) }
        node = child
      }
      return node.id
    }
    let previous = startUs
    const ids: number[] = [], deltas: number[] = []
    for (const sample of samples) { ids.push(leafOf(sample.stack)); deltas.push(sample.atUs - previous); previous = sample.atUs }
    return { nodes, startTime: startUs, endTime: endUs, samples: ids, timeDeltas: deltas }
  }
  const OFFSET_MS = 1_000_000
  const pair = (perfMs: number): Phase2C26A5ClockPair => ({ perfMs, hrMs: perfMs + OFFSET_MS, precisionMs: 0.01 })
  const window = { startPre: pair(99.9), startPost: pair(100.2), stopPre: pair(199.8), stopPost: pair(200.3) }
  const us = (researchMs: number) => (researchMs + OFFSET_MS) * 1000
  const reconstruction: Phase2C26A8IntervalReconstruction = { valid: true, issues: [], openFrontier: null, phaseStartRecords: 0, depthRecords: 0, gapToNextBoundaryMs: 0,
    intervals: [{ targetOrdinal: 0, streamIndex: 0, depth: 1, startMs: 110, endMs: 150, nextBoundaryMs: 151, frontierStatesBefore: 1, generatedStates: 50, frontierStatesAfter: 5 }] }
  const miss = [F.root, F.owner, F.representative, F.helper, F.stringify, F.serialize]
  const hit = [F.root, F.owner, F.representative, F.helper]
  const profile = buildProfile([
    { atUs: us(105), stack: miss }, // outside
    { atUs: us(115), stack: miss },
    { atUs: us(120), stack: hit },
    { atUs: us(125), stack: hit },
    { atUs: us(130), stack: [F.root, F.owner, F.representative] },
    { atUs: us(135), stack: [F.root, F.owner] },
    { atUs: us(170), stack: hit }, // outside
  ], us(100), us(200))

  it('counts helper samples inside the frontier intervals, with and without a serialization frame below the helper', () => {
    expect(helperLine).toBeGreaterThan(0)
    expect(countPhase2C26A9CacheHelperSamples(profile, fakeScripts, spans, window, reconstruction))
      .toEqual({ withHelper: 3, helperWithSerialization: 1, helperWithoutSerialization: 2, frontierSamples: 5 })
    expect(countPhase2C26A9CacheHelperSamples(profile, fakeScripts, spans, window, { ...reconstruction, valid: false }).frontierSamples).toBe(0)
  })

  it('keeps the A8 categories for the helper: a miss is stable serialization, a hit is representative compare', () => {
    const result = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, derivePhase2C26A8FrontierBlock(bonusStreamSource), window, reconstruction)
    const count = (category: Phase2C26A8Category) => result.categories.find(c => c.category === category)?.samples
    expect(result.frontierSamples).toBe(5)
    expect(count('representative_stable_serialization')).toBe(1)
    expect(count('representative_compare_or_inlined')).toBe(3)
    expect(count('reduction_loop_or_inlined')).toBe(1)
  })
})

// ---------------------------------------------------------------- the pre-registered decision rule

describe('Phase 2-C2.6-A9 pre-registered decision rule', () => {
  const shares = (serialization: number): Record<Phase2C26A8Category, number> => ({ representative_stable_serialization: serialization, representative_compare_or_inlined: 0.1,
    frontier_sort: 0.01, reduction_loop_or_inlined: 0.5, gc: 0.05, other_frontier: 0.05 })
  const a9Row = (serialization: number, valid = true) => ({ valid, invalidReasons: valid ? [] : ['CPU profile contains negative timeDeltas: 1'], shares: shares(serialization) })
  const direct = (ratio: number | null, valid = true) => ({ valid, frontier: { perCompareCallRatio: ratio } })
  const row = (id: string, a8: number, a9: ReturnType<typeof a9Row> | null, d: ReturnType<typeof direct> | null) => phase2c26a9ComparisonRow(id, { share: a8 }, a9, d)
  const parity = (valid = [true, true, true]) => ['c6-p1', 'c13-p1', 'c14-p0'].map((orientationId, index) => ({ orientationId, valid: valid[index] }))

  it('registers its thresholds before the formal run', () => {
    expect(PHASE2C26A9_DECISION_RULE.clearSerializationReductionMaxRatio).toBe(0.5)
    expect(PHASE2C26A9_DECISION_RULE.clearDirectImprovementMaxRatio).toBe(0.75)
    expect(PHASE2C26A9_DECISION_RULE.directRegressionMinRatio).toBe(1)
  })

  it('decides O only when every comparison-set primary clearly reduces the serialization share and the direct time', () => {
    const o = phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.34), direct(0.75))], parity())
    expect(o.case).toBe('O_optimization_adopted')
    expect(o.comparisonSet).toEqual(['c6-p1', 'c14-p0'])
  })

  it('decides P when the parity holds and something improved but not every O condition (an invalid A9 profile included)', () => {
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.35), direct(0.6))], parity()).case).toBe('P_partial_or_shifted')
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.1), direct(0.8))], parity()).case).toBe('P_partial_or_shifted')
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.1, false), direct(0.4))], parity()).case).toBe('P_partial_or_shifted')
  })

  it('decides N on any semantic mismatch whatever the performance, on a regression, or on no effect', () => {
    const good = [row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.1), direct(0.4))]
    expect(phase2c26a9Decision(good, parity([true, false, true])).case).toBe('N_not_adopted')
    expect(phase2c26a9Decision(good, parity().slice(0, 2)).case).toBe('N_not_adopted')
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.1), direct(0.4)), row('c14-p0', 0.68, a9Row(0.1), direct(1.01))], parity()).case).toBe('N_not_adopted')
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.7), direct(0.9)), row('c14-p0', 0.68, a9Row(0.69), direct(0.95))], parity()).case).toBe('N_not_adopted')
    expect(phase2c26a9Decision([row('c6-p1', 0.66, a9Row(0.3), direct(1)), row('c14-p0', 0.68, a9Row(0.3), direct(1))], parity()).case).toBe('N_not_adopted')
    expect(phase2c26a9Decision([], parity()).case).toBe('N_not_adopted')
  })

  it('never takes an invalid A9 profile or an invalid direct timing as evidence', () => {
    const invalid = row('c6-p1', 0.66, a9Row(0.01, false), direct(0.1, false))
    expect(invalid).toMatchObject({ a9ProfileValid: false, a9Share: null, shareRatio: null, directPerCompareCallRatio: null, serializationReduced: false, directImproved: false })
    expect(row('c6-p1', 0.66, null, null).a9InvalidReasons).toEqual(['no A9 profile row'])
    // The A8 decision row validity (negative timeDelta fail-closed) is the A9 profile validity.
    const decisionRow = phase2c26a8DecisionRow('c6-p1', null)
    expect(decisionRow.valid).toBe(false)
  })
})

// ---------------------------------------------------------------- formal series validation

describe('Phase 2-C2.6-A9 formal series validation', () => {
  it('refuses a raw run that is not a completed committed run with a probe, the registered profiler and change, the A8 selection, no diagnostic and full parity coverage', () => {
    const all = authorities()
    const a8 = a8Authority()
    const validation = validatePhase2C26A9FormalRun({ status: 'probe_failed', diagnostic: { orientationId: 'c6-p1' },
      environment: { smoke: { orientationIds: ['c6-p1'] }, searchInstrumentation: PHASE2C26A9_SEARCH_INSTRUMENTATION } },
    { ...all, a8 }, { ...shas, a8: a8Sha }, { productionChangeSinceA8: [], optimizationSource: { valid: false, issues: ['x'] }, a8RawShaMatches: false,
      workPrefix: [], depthPrefix: [], lifecyclePrefix: [] })
    expect(validation.valid).toBe(false)
    expect(validation.failures).toEqual(expect.arrayContaining([
      'A4 formal-run contract: raw status is probe_failed', 'A4 formal-run contract: a smoke run is never formal', 'the profiler probe did not succeed',
      'the profiler window / sampling interval is not the registered one', 'A9 runs no diagnostic',
      'the runner did not record the Production change since the A8 measured HEAD', 'the re-derived Production change since the A8 measured HEAD is not exactly the registered one',
      'the measured bonusStream.ts is not the registered optimization: x', 'the A8 raw run is not the one the A8 RESULT recorded',
      'the work prefix comparison does not cover exactly the A8 primaries', 'the depth prefix comparison does not cover exactly the A8 primaries',
      'the lifecycle prefix comparison does not cover exactly the A8 primaries', 'the raw run was not made against this C2.6-A8 RESULT']))
    const wrongInstrumentation = validatePhase2C26A9FormalRun({ status: 'completed', diagnostic: null,
      environment: { searchInstrumentation: { ...PHASE2C26A9_SEARCH_INSTRUMENTATION, onGogmaReservedRuntime: false } } },
    { ...all, a8 }, { ...shas, a8: a8Sha }, { productionChangeSinceA8: ['src/domain/search/bonusStream.ts'], optimizationSource: { valid: true, issues: [] }, a8RawShaMatches: true,
      workPrefix: [], depthPrefix: [], lifecyclePrefix: [] })
    expect(wrongInstrumentation.failures).toContain('the Search instrumentation is not the A7 pair of boundary observers')
    expect(wrongInstrumentation.failures).not.toContain('A9 runs no diagnostic')
    expect(wrongInstrumentation.productionChangeRederived.valid).toBe(true)
  })
})
