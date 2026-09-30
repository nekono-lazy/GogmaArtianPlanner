import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import targetEvaluatorSource from '../domain/target/targetEvaluator.ts?raw'
import bonusConditionSource from '../domain/target/bonusConditionEvaluator.ts?raw'
import masterSelectorsSource from '../domain/master/masterSelectors.ts?raw'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import type { RngEngine } from '../domain/rng/rngEngine'
import { candidateStableKey, visitPlannerAlternativeCandidates } from '../domain/search'
import type { SearchRuntimeEvent, SearchRuntimeObserver } from '../domain/search/searchRuntime'
import { createCountingRngEngine } from './plannerAlternativeBenchmarkInstrumentation'
import { createIssue101NoIdealSearchInput } from './plannerAlternativeBenchmarkFixtures'
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import { parsePhase2C26A3ResultAuthority, PHASE2C26A4_SEARCH_INSTRUMENTATION, type Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import {
  createPhase2C26A5FilterIntervalTracker,
  createPhase2C26A5KernelInstrumentation,
  createPhase2C26A5ProfileController,
  parsePhase2C26A4ResultAuthority,
  PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS,
  PHASE2C26A5_PRIMARY_NODE_FLAGS,
  PHASE2C26A5_PROFILER,
  PHASE2C26A5_SEARCH_INSTRUMENTATION,
  selectPhase2C26A5DiagnosticRepresentative,
  validatePhase2C26A5ConditionParity,
  type Phase2C26A5A4Authority,
  type Phase2C26A5ClockPair,
  type Phase2C26A5FilterInterval,
} from './plannerGlobalPhase2C26A5'
import {
  analyzePhase2C26A5Profile,
  classifyPhase2C26A5Stack,
  createPhase2C26A5ScriptTable,
  derivePhase2C26A5FunctionSpans,
  phase2c26a5Decision,
  phase2c26a5DecisionRow,
  phase2c26a5PooledShares,
  phase2c26a5SampleTimesUs,
  PHASE2C26A5_CATEGORIES,
  PHASE2C26A5_DECISION_RULE,
  PHASE2C26A5_FUNCTION_REGISTRY,
  PHASE2C26A5_SOURCE_MAP_BIAS,
  resolvePhase2C26A5Frame,
  validatePhase2C26A5ClockAlignment,
  validatePhase2C26A5CpuProfile,
  validatePhase2C26A5FilterIntervals,
  validatePhase2C26A5FormalRun,
  type CpuProfile,
  type CpuProfileCallFrame,
  type Phase2C26A5Category,
  type Phase2C26A5DecisionRow,
  type Phase2C26A5Frame,
  type Phase2C26A5ProfileAnalysis,
  type Phase2C26A5ScriptTable,
} from './plannerGlobalPhase2C26A5Analysis'

/*
 * Issue #154 Phase 2-C2.6-A5. No Production code changes: the only Search instrumentation stays A4's section boundary
 * observer, which this phase wraps to stamp the Bonus Ideal filter intervals (observational, checked here), while the
 * V8 CPU profiler observes the child from outside. The committed A4 / A3 / A2 / C2.6-A RESULTs are the fail-closed
 * authorities; the profile analysis (timestamps, clock alignment, interval population, stack classification) and the
 * pre-registered decision rule are fixed here on synthetic profiles. No duration is asserted.
 */

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

// ---------------------------------------------------------------- authorities

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a), a2Json = JSON.parse(rawA2), a3Json = JSON.parse(rawA3), a4Json = JSON.parse(rawA4)
let shas = { c26a: '', a2: '', a3: '' }
beforeAll(async () => { shas = { c26a: await sha256Hex(rawC26a), a2: await sha256Hex(rawA2), a3: await sha256Hex(rawA3) } })

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority } {
  const c26a = parsePhase2C26AAuthority(c26aJson)
  if (!c26a.authority) throw new Error(c26a.issues.join('; '))
  const a2 = parsePhase2C26A2ResultAuthority(a2Json, shas.c26a, c26a.authority)
  if (!a2.authority) throw new Error(a2.issues.join('; '))
  const a3 = parsePhase2C26A3ResultAuthority(a3Json, shas.c26a, shas.a2, a2.authority, c26a.authority)
  if (!a3.authority) throw new Error(a3.issues.join('; '))
  return { c26a: c26a.authority, a2: a2.authority, a3: a3.authority }
}
function a4Authority(): Phase2C26A5A4Authority {
  const { c26a, a3 } = authorities()
  const parsed = parsePhase2C26A4ResultAuthority(a4Json, shas, a3, c26a)
  if (!parsed.authority) throw new Error(parsed.issues.join('; '))
  return parsed.authority
}

describe('Phase 2-C2.6-A4 RESULT as the selection authority', () => {
  it('accepts the committed formal A4 RESULT made against the committed A3 / A2 / C2.6-A RESULTs and takes its selection', () => {
    const { c26a, a3 } = authorities()
    const parsed = parsePhase2C26A4ResultAuthority(a4Json, shas, a3, c26a)
    expect(parsed.issues).toEqual([])
    // Evidence check (not a source constant): the committed A4 selection is the A3 one.
    expect(parsed.authority?.primaryOrientationIds).toEqual(a3.primaryOrientationIds)
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    for (const reference of parsed.authority?.references ?? []) {
      expect(reference.coverage).toBeGreaterThanOrEqual(0.9)
      expect(reference.bonusIdealFilterShare).toBeGreaterThanOrEqual(0.1)
      expect(reference.childOutcome).toBe('timeout')
    }
  })

  it('fails closed on a non-formal A4, another decision / category, a primary below the A4 thresholds, a broken SHA chain or another selection', () => {
    const { c26a, a3 } = authorities()
    const mutate = (edit: (json: typeof a4Json) => void) => { const json = structuredClone(a4Json); edit(json); return parsePhase2C26A4ResultAuthority(json, shas, a3, c26a) }
    const zero = '0'.repeat(64)
    expect(parsePhase2C26A4ResultAuthority(a4Json, { ...shas, c26a: zero }, a3, c26a).valid).toBe(false)
    expect(parsePhase2C26A4ResultAuthority(a4Json, { ...shas, a2: zero }, a3, c26a).valid).toBe(false)
    expect(parsePhase2C26A4ResultAuthority(a4Json, { ...shas, a3: zero }, a3, c26a).valid).toBe(false)
    expect(parsePhase2C26A4ResultAuthority(a4Json, shas, { primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'M_mixed' }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.category = 'bonus_notice_scan' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.timeout = 2; json.summary.childStatus.completed = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[1].primarySearch.categoryShare.bonus_ideal_filter = 0.09 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[2].primarySearch.coverage = 0.89 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[0].childOutcome = 'completed' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.c26a3ResultSha256 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a2ShaRecordedByA3 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.c26aShaRecordedByA3ForA2 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a3Result.sha256 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.exportSha256 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected.reverse() }).valid).toBe(false)
    expect(mutate(json => { json.selectionRule.primaryOrientationIds = ['c6-p1', 'c13-p1'] }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation.reverse() }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation.pop() }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected = ['c6-p1', 'c6-p1', 'c14-p0']; json.selectionValidation.actual = ['c6-p1', 'c6-p1', 'c14-p0'] }).valid).toBe(false)
  })

  it('derives the no-inlining representative from the A4 evidence (middle share, ties in A4 order)', () => {
    const a4 = a4Authority()
    const selection = selectPhase2C26A5DiagnosticRepresentative(a4)
    const byShare = [...a4.references].sort((a, b) => a.bonusIdealFilterShare - b.bonusIdealFilterShare)
    expect(selection.representativeOrientationId).toBe(byShare[1].orientationId)
    expect(selection.ordered.map(o => o.orientationId)).toEqual(byShare.map(r => r.orientationId))
    const tie = { primaryOrientationIds: ['a', 'b', 'c'], references: ['a', 'b', 'c'].map(orientationId => ({ ...a4.references[0], orientationId, bonusIdealFilterShare: 0.2 })) }
    expect(selectPhase2C26A5DiagnosticRepresentative(tie).representativeOrientationId).toBe('b')
    const skew = { primaryOrientationIds: ['a', 'b', 'c'], references: [['a', 0.3], ['b', 0.1], ['c', 0.2]].map(([orientationId, share]) => ({ ...a4.references[0], orientationId: orientationId as string, bonusIdealFilterShare: share as number })) }
    expect(selectPhase2C26A5DiagnosticRepresentative(skew).representativeOrientationId).toBe('c')
  })

  it('requires every A4 primary condition (Node flags and concurrency 1 included) and A4\'s own parity against A3 / C2.6-A / A2', () => {
    const { c26a, a2, a3 } = authorities()
    const current = { ...a4Json.conditions } as Phase2C26A2RunConditions & { nodeFlags: string[] }
    expect(validatePhase2C26A5ConditionParity(current, a4Json.conditions, a3.conditions, c26a, a2.conditions).issues).toEqual([])
    expect(validatePhase2C26A5ConditionParity({ ...current, nodeFlags: [...PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS] }, a4Json.conditions, a3.conditions, c26a, a2.conditions).issues)
      .toEqual(['nodeFlags differs', 'primary nodeFlags differs'])
    expect(validatePhase2C26A5ConditionParity({ ...current, orientationBudgetMs: 60_000 }, a4Json.conditions, a3.conditions, c26a, a2.conditions).issues).toEqual(['orientationBudgetMs differs'])
    expect(validatePhase2C26A5ConditionParity({ ...current, concurrency: 2 }, a4Json.conditions, a3.conditions, c26a, a2.conditions).issues).toEqual(['concurrency differs', 'concurrency is 1 differs'])
    expect(validatePhase2C26A5ConditionParity(current, { ...a4Json.conditions, searchInstrumentation: { onSearchRuntime: false } }, a3.conditions, c26a, a2.conditions).issues)
      .toEqual(['A4 searchInstrumentation differs'])
    expect(PHASE2C26A5_SEARCH_INSTRUMENTATION).toEqual(PHASE2C26A4_SEARCH_INSTRUMENTATION)
    expect(PHASE2C26A5_PRIMARY_NODE_FLAGS).toEqual(a4Json.conditions.nodeFlags)
    expect(PHASE2C26A5_PROFILER).toEqual({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 })
  })
})

// ---------------------------------------------------------------- the filter interval stamps (Research side)

describe('Phase 2-C2.6-A5 filter interval tracker', () => {
  const started = (section: SearchRuntimeEvent['section'], work?: { channel: number; depth: number }): SearchRuntimeEvent =>
    (work === undefined ? { type: 'section_started', section } : { type: 'section_started', section, work })
  const completed = (section: SearchRuntimeEvent['section']): SearchRuntimeEvent => ({ type: 'section_completed', section })

  it('stamps the start after and the end before the wrapped observer, keeps the depth detail, reports the first Search once and forwards every event unchanged', () => {
    let clock = 0
    const order: string[] = []
    const searchStarts: number[] = []
    const tracker = createPhase2C26A5FilterIntervalTracker({ now: () => { clock += 1; order.push(`now=${clock}`); return clock }, onSearchStarted: at => searchStarts.push(at) })
    const seen: SearchRuntimeEvent[] = []
    const base: SearchRuntimeObserver = event => { seen.push(event); order.push(`base:${event.type}:${event.section}`) }
    const observer = tracker.wrap(base, 0)
    const events = [started('search_runtime'), started('bonus_depth_work', { channel: 2, depth: 7 }), started('bonus_depth_read'), completed('bonus_depth_read'),
      started('bonus_ideal_filter'), completed('bonus_ideal_filter'), completed('bonus_depth_work'), started('bonus_depth_work', { channel: 0, depth: 1 }),
      started('bonus_ideal_filter'), completed('bonus_ideal_filter'), completed('bonus_depth_work'), started('search_runtime'), completed('search_runtime')]
    for (const event of events) observer(event)
    expect(seen).toEqual(events)
    const filterStart = order.indexOf('base:section_started:bonus_ideal_filter')
    expect(order[filterStart + 1]).toMatch(/^now=/)
    const filterEnd = order.indexOf('base:section_completed:bonus_ideal_filter')
    expect(order[filterEnd - 1]).toMatch(/^now=/)
    const snapshot = tracker.snapshot()
    expect(snapshot.intervals.map(i => [i.channel, i.depth])).toEqual([[2, 7], [0, 1]])
    expect(snapshot.intervals.every(i => i.endMs > i.startMs)).toBe(true)
    expect(searchStarts).toHaveLength(1)
    expect(snapshot.violations).toBe(0)
    expect(snapshot.openAtSnapshot).toBeNull()
  })

  it('only counts after freeze, and counts boundary contract breaches instead of throwing', () => {
    let clock = 0
    const tracker = createPhase2C26A5FilterIntervalTracker({ now: () => (clock += 1) })
    const observer = tracker.wrap(() => undefined, 1)
    observer(started('bonus_ideal_filter'))
    observer(completed('bonus_ideal_filter'))
    tracker.freeze()
    observer(started('bonus_ideal_filter'))
    observer(completed('bonus_ideal_filter'))
    observer(completed('bonus_ideal_filter'))
    observer(started('bonus_ideal_filter'))
    observer(started('bonus_ideal_filter'))
    const snapshot = tracker.snapshot()
    expect(snapshot.intervals).toHaveLength(1)
    expect(snapshot.intervals[0].depth).toBeNull()
    expect(snapshot.completedAfterFreeze).toBe(1)
    expect(snapshot.violations).toBe(2)
    expect(snapshot.openAtSnapshot).not.toBeNull()
  })

  it('wraps only A4\'s onSearchRuntime and requires it', () => {
    const tracker = createPhase2C26A5FilterIntervalTracker({ now: () => 0 })
    const onEvent = vi.fn()
    const base = vi.fn()
    const instrumentation = createPhase2C26A5KernelInstrumentation({ onEvent, searchInstrumentationForTarget: () => ({ onSearchRuntime: base }) }, tracker)
    expect(instrumentation.onEvent).toBe(onEvent)
    const handed = instrumentation.searchInstrumentationForTarget?.('t' as never, 0)
    expect(Object.keys(handed ?? {})).toEqual(['onSearchRuntime'])
    handed?.onSearchRuntime?.({ type: 'section_started', section: 'search_runtime' })
    expect(base).toHaveBeenCalledTimes(1)
    const missing = createPhase2C26A5KernelInstrumentation({ searchInstrumentationForTarget: () => ({}) }, tracker)
    expect(() => missing.searchInstrumentationForTarget?.('t' as never, 0)).toThrow()
  })

  it('changes no delivered key sequence, Search summary or prediction call count, and records exactly the filter sections', async () => {
    const input = createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 12, maxSkillAdvance: 2 })
    const run = async (observer: SearchRuntimeObserver | null) => {
      const counting = createCountingRngEngine(new ProductionRngEngine() as RngEngine)
      const keys: string[] = []
      const execution = await visitPlannerAlternativeCandidates(structuredClone(input), counting.engine, candidate => { keys.push(candidateStableKey(candidate)); return 'continue' },
        observer === null ? {} : { instrumentation: { onSearchRuntime: observer } })
      return { keys, summary: execution.summary, counts: counting.counts() }
    }
    const plain = await run(null)
    const baseEvents: SearchRuntimeEvent[] = []
    let clock = 0
    const tracker = createPhase2C26A5FilterIntervalTracker({ now: () => (clock += 1) })
    const observed = await run(tracker.wrap(event => { baseEvents.push(event) }, 0))
    expect(observed).toEqual(plain)
    const filterCompletions = baseEvents.filter(e => e.type === 'section_completed' && e.section === 'bonus_ideal_filter').length
    expect(filterCompletions).toBeGreaterThan(0)
    const snapshot = tracker.snapshot()
    expect(snapshot.intervals).toHaveLength(filterCompletions)
    expect(validatePhase2C26A5FilterIntervals(snapshot.intervals).valid).toBe(true)
    expect(snapshot.violations).toBe(0)
  }, 120_000)
})

// ---------------------------------------------------------------- the profile window controller

describe('Phase 2-C2.6-A5 profile window controller', () => {
  function harness(options: { failStart?: boolean } = {}) {
    let perf = 0
    const timers: { at: number; callback: () => void }[] = []
    const calls: string[] = []
    const captures: { profile: unknown; window: unknown }[] = []
    const clockPair = (): Phase2C26A5ClockPair => ({ perfMs: perf, hrMs: perf + 1_000_000, precisionMs: 0.01 })
    const controller = createPhase2C26A5ProfileController({
      clockPair,
      setTimer: (callback, delayMs) => { timers.push({ at: perf + delayMs, callback }) },
      startProfiler: async () => { calls.push('start'); if (options.failStart) throw new Error('refused'); perf += 5 },
      stopProfiler: async () => { calls.push('stop'); perf += 7; return { profile: true } },
      onFrozen: () => calls.push('frozen'),
      onCaptured: (profile, window) => { calls.push('captured'); captures.push({ profile, window }) },
    })
    const advanceTo = async (at: number) => {
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (next === undefined || next.at > at) break
        timers.shift()
        perf = Math.max(perf, next.at)
        next.callback()
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      }
      perf = Math.max(perf, at)
    }
    return { controller, advanceTo, calls, captures, setPerf: (value: number) => { perf = value }, timers }
  }

  it('starts after the warmup and stops at the registered stop, recording both delays, freezing the intervals before the capture', async () => {
    const h = harness()
    h.setPerf(1_000)
    h.controller.onSearchStarted(1_000)
    h.controller.onSearchStarted(2_000)
    await h.advanceTo(1_000 + PHASE2C26A5_PROFILER.warmupMs + 300)
    expect(h.controller.state()).toBe('running')
    await h.advanceTo(1_000 + PHASE2C26A5_PROFILER.profileStopMs + 1_000)
    await h.controller.settled()
    expect(h.calls).toEqual(['start', 'stop', 'frozen', 'captured'])
    const window = h.controller.window()
    expect(window.searchStartedMs).toBe(1_000)
    expect(window.stoppedBy).toBe('window')
    expect(window.startDelayMs).toBeGreaterThanOrEqual(0)
    expect(window.actualStartElapsedMs).toBe(window.startPost!.perfMs - 1_000)
    expect(window.actualStopElapsedMs).toBe(window.stopPre!.perfMs - 1_000)
    expect(window.stopDelayMs).toBe((window.actualStopElapsedMs as number) - PHASE2C26A5_PROFILER.profileStopMs)
    expect(h.captures).toHaveLength(1)
  })

  it('stops early when the kernel ends first (kernel_ended), and records a refused profiler call without throwing', async () => {
    const h = harness()
    h.controller.onSearchStarted(0)
    await h.advanceTo(PHASE2C26A5_PROFILER.warmupMs + 10)
    await h.controller.onKernelEnded()
    expect(h.controller.window().stoppedBy).toBe('kernel_ended')
    const failing = harness({ failStart: true })
    failing.controller.onSearchStarted(0)
    await failing.advanceTo(PHASE2C26A5_PROFILER.warmupMs + 10)
    expect(failing.controller.state()).toBe('failed')
    expect(failing.controller.window().error).toMatch(/refused/)
    await failing.controller.onKernelEnded()
    expect(failing.captures).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- profile analysis

/**
 * `src/domain/models/domainRules.ts` as A5 measured it (lines 1-40 at the A5 measured HEAD
 * a2e3c3ed489c0ff9bceabb2b66ff813ae8068906). Phase 2-C2.6-A6 replaced that multiset comparison, so the A5 span tests
 * read this fixed text - what the A5 analyzer itself reads from the measured HEAD - never the working tree.
 */
const domainRulesSource = [
  'import type {',
  '  CalculationContext,',
  '  RestorationBonusSet,',
  '} from \'./common\'',
  'import type { OwnedWeapon, SkillCondition, TargetWeapon } from \'./entities\'',
  '',
  'function bonusKey(bonus: RestorationBonusSet[number]): string {',
  '  return JSON.stringify([bonus.bonusTypeId, bonus.bonusRankId])',
  '}',
  '',
  'function countBonuses(bonuses: RestorationBonusSet): Map<string, number> {',
  '  const counts = new Map<string, number>()',
  '  bonuses.forEach((bonus) => {',
  '    const key = bonusKey(bonus)',
  '    counts.set(key, (counts.get(key) ?? 0) + 1)',
  '  })',
  '  return counts',
  '}',
  '',
  '/**',
  ' * Unordered multiset equality with duplicate counts preserved.',
  ' *',
  ' * This is the completed-result contract: Target conditions, Candidate',
  ' * completion, and Candidate semantic identity all compare five slots this way,',
  ' * so slot order alone never creates a second result.',
  ' *',
  ' * It is deliberately NOT the comparison for anything that feeds Keep',
  ' * prediction: use `areRestorationBonusSlotsEqual()` there.',
  ' */',
  'export function areRestorationBonusSetsEqual(',
  '  left: RestorationBonusSet,',
  '  right: RestorationBonusSet,',
  '): boolean {',
  '  const leftCounts = countBonuses(left)',
  '  const rightCounts = countBonuses(right)',
  '  if (leftCounts.size !== rightCounts.size) return false',
  '  return [...leftCounts].every(',
  '    ([key, count]) => rightCounts.get(key) === count,',
  '  )',
  '}',
].join('\n')

const sources = {
  'src/domain/target/targetEvaluator.ts': targetEvaluatorSource,
  'src/domain/target/bonusConditionEvaluator.ts': bonusConditionSource,
  'src/domain/master/masterSelectors.ts': masterSelectorsSource,
  'src/domain/models/domainRules.ts': domainRulesSource,
}
const lineOf = (text: string, pattern: RegExp) => text.split(/\r?\n/).findIndex(line => pattern.test(line)) + 1

describe('Phase 2-C2.6-A5 function spans', () => {
  it('derives each registered function span from the source text and fails closed on a missing, duplicate or unterminated declaration', () => {
    const spans = derivePhase2C26A5FunctionSpans(sources)
    expect(spans.map(s => s.functionName)).toEqual(PHASE2C26A5_FUNCTION_REGISTRY.map(e => e.functionName))
    const predicate = spans.find(s => s.functionName === 'satisfiesIdealBonuses')!
    expect(predicate.startLine).toBe(lineOf(targetEvaluatorSource, /^export function satisfiesIdealBonuses\(/))
    const count = spans.find(s => s.functionName === 'countBonuses')!
    // The forEach callback of countBonuses lies inside its span.
    expect(lineOf(domainRulesSource, /bonuses\.forEach\(\(bonus\) => \{/)).toBeGreaterThan(count.startLine)
    expect(lineOf(domainRulesSource, /bonuses\.forEach\(\(bonus\) => \{/)).toBeLessThan(count.endLine)
    for (const span of spans) expect(span.endLine).toBeGreaterThan(span.startLine)
    expect(() => derivePhase2C26A5FunctionSpans({ ...sources, 'src/domain/models/domainRules.ts': '' })).toThrow()
    expect(() => derivePhase2C26A5FunctionSpans({ ...sources, 'src/domain/models/domainRules.ts': `${domainRulesSource}\nfunction bonusKey() {\n}\n` })).toThrow()
    expect(() => derivePhase2C26A5FunctionSpans({ 'src/x.ts': 'function a() {\n  return 1' }, [{ file: 'src/x.ts', functionName: 'a' }])).toThrow()
  })
})

/** A script table over fake scripts: scriptId `s:<file>` with an identity source map (generated line n -> original n + 1). */
const fakeScripts: Phase2C26A5ScriptTable = {
  urlOf: id => (id.startsWith('s:') ? `D:/repo/${id.slice(2)}` : null),
  originalLine: (id, lineNumber) => (id.startsWith('s:src/') && lineNumber >= 0 ? lineNumber + 1 : null),
}
const spans = derivePhase2C26A5FunctionSpans(sources)
const span = (name: string) => spans.find(s => s.functionName === name)!
const frame = (functionName: string, file: string, originalLine = 1): CpuProfileCallFrame =>
  ({ functionName, scriptId: file === '' ? '0' : `s:${file}`, url: '', lineNumber: originalLine - 1, columnNumber: 0 })
const F = {
  root: frame('(root)', ''),
  gc: frame('(garbage collector)', ''),
  program: frame('(program)', ''),
  settle: frame('settle', 'src/domain/search/targetSearchScheduler.ts', 410),
  callback: frame('', 'src/domain/search/targetSearchScheduler.ts', 433),
  predicate: frame('satisfiesIdealBonuses', 'src/domain/target/targetEvaluator.ts', span('satisfiesIdealBonuses').startLine),
  assertRank: frame('assertRestorationBonusRankReferences', 'src/domain/target/bonusConditionEvaluator.ts', span('assertRestorationBonusRankReferences').startLine),
  assertCallback: frame('', 'src/domain/target/bonusConditionEvaluator.ts', span('assertRestorationBonusRankReferences').startLine + 3),
  findCallback: frame('', 'src/domain/master/masterSelectors.ts', span('requireById').startLine + 5),
  equal: frame('areRestorationBonusSetsEqual', 'src/domain/models/domainRules.ts', span('areRestorationBonusSetsEqual').startLine),
  count: frame('countBonuses', 'src/domain/models/domainRules.ts', span('countBonuses').startLine),
  countCallback: frame('', 'src/domain/models/domainRules.ts', span('countBonuses').startLine + 2),
  bonusKey: frame('bonusKey', 'src/domain/models/domainRules.ts', span('bonusKey').startLine),
  stringify: frame('stringify', ''),
  viteGetter: frame('get', 'node_modules/vite/dist/node/module-runner.js'),
  harness: frame('observe', 'src/benchmarks/plannerGlobalPhase2C26A5.ts', 300),
  otherRepo: frame('', 'src/domain/models/domainRules.ts', span('areRestorationBonusSetsEqual').endLine + 50),
}
const resolved = (callFrames: CpuProfileCallFrame[]): Phase2C26A5Frame[] => callFrames.map(f => resolvePhase2C26A5Frame(f, fakeScripts, spans))

describe('Phase 2-C2.6-A5 stack classification', () => {
  it('resolves registered functions by name and anonymous callbacks by their source span', () => {
    expect(resolved([F.assertCallback])[0].registered).toBe('src/domain/target/bonusConditionEvaluator.ts#assertRestorationBonusRankReferences')
    expect(resolved([F.findCallback])[0].registered).toBe('src/domain/master/masterSelectors.ts#requireById')
    expect(resolved([F.countCallback])[0].registered).toBe('src/domain/models/domainRules.ts#countBonuses')
    expect(resolved([F.otherRepo])[0].registered).toBeNull()
    expect(resolved([F.callback])[0].registered).toBeNull()
    expect(resolved([F.viteGetter])[0].leafKind).toBe('vite_module_runner')
    expect(resolved([frame('', 'src/domain/models/domainRules.ts', 0)])[0].leafKind).toBe('vite_ssr_unmapped')
  })

  it('applies the registered priority: gc, rank, multiset, predicate, filter leaf, other', () => {
    const cases: [CpuProfileCallFrame[], Phase2C26A5Category][] = [
      [[F.root, F.gc], 'gc'],
      [[F.root, F.settle, F.callback, F.predicate, F.assertRank, F.assertCallback, F.findCallback], 'rank_reference_validation'],
      [[F.root, F.predicate, F.assertCallback], 'rank_reference_validation'],
      [[F.root, F.settle, F.callback, F.predicate, F.equal, F.count, F.countCallback, F.bonusKey, F.stringify], 'multiset_equality'],
      [[F.root, F.predicate, F.countCallback], 'multiset_equality'],
      [[F.root, F.settle, F.callback, F.predicate], 'predicate_self_or_inlined'],
      [[F.root, F.settle, F.callback, F.predicate, F.viteGetter], 'predicate_self_or_inlined'],
      [[F.root, F.settle, F.callback], 'filter_or_inlined_predicate'],
      [[F.root, F.settle], 'filter_or_inlined_predicate'],
      [[F.root, F.settle, F.callback, F.viteGetter], 'other_unresolved'],
      [[F.root, F.program], 'other_unresolved'],
      [[F.root, F.harness], 'other_unresolved'],
      [[F.root, F.otherRepo], 'other_unresolved'],
    ]
    for (const [stack, category] of cases) expect(classifyPhase2C26A5Stack(resolved(stack)), stack.map(f => f.functionName || '(anon)').join('>')).toBe(category)
  })

  it('maps with the greatest lower bound, falling back to the least upper bound of the same generated line', () => {
    const calls: number[] = []
    const table = createPhase2C26A5ScriptTable([{ scriptId: '1', url: 'u', sourceMap: {} }, { scriptId: '2', url: 'v', sourceMap: null }], () => ({
      originalPositionFor: ({ bias, column }) => { calls.push(bias ?? 0); return { line: bias === PHASE2C26A5_SOURCE_MAP_BIAS.greatestLowerBound && column < 5 ? null : 42 } },
    }))
    expect(table.originalLine('1', 0, 10)).toBe(42)
    expect(table.originalLine('1', 0, 1)).toBe(42)
    expect(calls).toEqual([1, 1, 2])
    expect(table.originalLine('2', 0, 0)).toBeNull()
    expect(table.urlOf('2')).toBe('v')
    expect(table.urlOf('3')).toBeNull()
  })
})

/** Builds a CPU profile whose samples are the given stacks at the given profile-clock times (us). */
function buildProfile(samples: { atUs: number; stack: CpuProfileCallFrame[] }[], startUs: number, endUs: number): CpuProfile {
  const nodes: { id: number; callFrame: CpuProfileCallFrame; children: number[] }[] = [{ id: 1, callFrame: F.root, children: [] }]
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
const OFFSET_MS = 1_000_000 // hrtime ms - performance.now() ms
const pair = (perfMs: number): Phase2C26A5ClockPair => ({ perfMs, hrMs: perfMs + OFFSET_MS, precisionMs: 0.01 })
/** A profile window from Research time 100 ms to 200 ms. */
const window = { startPre: pair(99.9), startPost: pair(100.2), stopPre: pair(199.8), stopPost: pair(200.3) }
const us = (researchMs: number) => (researchMs + OFFSET_MS) * 1000

describe('Phase 2-C2.6-A5 profile analysis', () => {
  const intervals: Phase2C26A5FilterInterval[] = [
    { targetOrdinal: 0, startMs: 110, endMs: 130, channel: 0, depth: 1 },
    { targetOrdinal: 0, startMs: 150, endMs: 190, channel: 0, depth: 2 },
  ]
  const stacks = {
    multiset: [F.root, F.settle, F.callback, F.predicate, F.equal, F.count, F.countCallback, F.bonusKey],
    rank: [F.root, F.settle, F.callback, F.predicate, F.assertRank, F.assertCallback],
    predicate: [F.root, F.settle, F.callback, F.predicate],
    filter: [F.root, F.settle, F.callback],
    gc: [F.root, F.gc],
    read: [F.root, F.settle, frame('readReservedDepth', 'src/domain/search/bonusStream.ts', 200)],
  }
  const profileSamples = [
    { atUs: us(105), stack: stacks.read }, // outside
    { atUs: us(112), stack: stacks.multiset },
    { atUs: us(115), stack: stacks.multiset },
    { atUs: us(118), stack: stacks.rank },
    { atUs: us(121), stack: stacks.gc },
    { atUs: us(129.999), stack: stacks.filter },
    { atUs: us(130), stack: stacks.predicate }, // end is exclusive -> outside (registered frame outside)
    { atUs: us(140), stack: stacks.read }, // outside
    { atUs: us(150), stack: stacks.predicate }, // start inclusive
    { atUs: us(170), stack: stacks.multiset },
    { atUs: us(195), stack: stacks.multiset }, // outside
  ]
  const profile = buildProfile(profileSamples, us(100), us(200))

  it('validates the untrusted profile structure and reconstructs sample times', () => {
    expect(validatePhase2C26A5CpuProfile(profile)).toBe(profile)
    expect(() => validatePhase2C26A5CpuProfile({ ...profile, samples: [...profile.samples, 1] })).toThrow()
    expect(() => validatePhase2C26A5CpuProfile({ ...profile, samples: profile.samples.map(() => 999) })).toThrow()
    expect(() => validatePhase2C26A5CpuProfile({ ...profile, endTime: profile.startTime - 1 })).toThrow()
    expect(() => validatePhase2C26A5CpuProfile({ ...profile, nodes: [] })).toThrow()
    expect(() => validatePhase2C26A5CpuProfile({ ...profile, nodes: [{ id: 1 }] })).toThrow()
    const { timesUs, negativeDeltas } = phase2c26a5SampleTimesUs(profile)
    expect(Array.from(timesUs)).toEqual(profileSamples.map(s => s.atUs))
    expect(negativeDeltas).toBe(0)
  })

  it('aligns the clocks only when startTime / endTime lie in the hrtime brackets of the profiler calls and the offset is constant', () => {
    const aligned = validatePhase2C26A5ClockAlignment(profile, window)
    expect(aligned.issues).toEqual([])
    expect(aligned.offsetMs).toBeCloseTo(OFFSET_MS, 6)
    expect(aligned.researchProfileStartMs).toBeCloseTo(100, 6)
    expect(validatePhase2C26A5ClockAlignment({ ...profile, startTime: us(95) }, window).valid).toBe(false)
    expect(validatePhase2C26A5ClockAlignment({ ...profile, endTime: us(210) }, window).valid).toBe(false)
    expect(validatePhase2C26A5ClockAlignment(profile, { ...window, stopPost: { ...pair(200.3), hrMs: 200.3 + OFFSET_MS + 5 } }).valid).toBe(false)
    expect(validatePhase2C26A5ClockAlignment(profile, { ...window, startPre: { ...pair(99.9), precisionMs: 3 } }).valid).toBe(false)
    expect(validatePhase2C26A5ClockAlignment(profile, { ...window, stopPre: null }).valid).toBe(false)
  })

  it('classifies only the samples inside [start, end) of a filter interval', () => {
    const analysis = analyzePhase2C26A5Profile(profile, fakeScripts, spans, window, intervals)
    expect(analysis.allProfileSamples).toBe(11)
    expect(analysis.filterIntervalSamples).toBe(7)
    const count = (c: Phase2C26A5Category) => analysis.categories.find(x => x.category === c)!.samples
    expect(count('multiset_equality')).toBe(3)
    expect(count('rank_reference_validation')).toBe(1)
    expect(count('gc')).toBe(1)
    expect(count('filter_or_inlined_predicate')).toBe(1)
    expect(count('predicate_self_or_inlined')).toBe(1)
    expect(count('other_unresolved')).toBe(0)
    expect(analysis.categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 10)
    expect(analysis.unresolvedShare).toBeCloseTo(2 / 7, 10)
    expect(analysis.registeredOutsideFilterSamples).toBe(2)
    expect(analysis.intervalsInProfile).toBe(2)
    expect(analysis.intervalMsInProfile).toBeCloseTo(60, 6)
    expect(analysis.registeredInclusive.find(r => r.registered.endsWith('#satisfiesIdealBonuses'))?.samples).toBe(5)
    expect(analysis.categories.map(c => c.category)).toEqual(PHASE2C26A5_CATEGORIES)
  })

  it('maps no sample when the clocks are not aligned or the intervals are malformed', () => {
    expect(analyzePhase2C26A5Profile({ ...profile, startTime: us(95) }, fakeScripts, spans, window, intervals).filterIntervalSamples).toBe(0)
    const overlapping = [intervals[1], intervals[0]]
    expect(validatePhase2C26A5FilterIntervals(overlapping).valid).toBe(false)
    expect(analyzePhase2C26A5Profile(profile, fakeScripts, spans, window, overlapping).filterIntervalSamples).toBe(0)
    expect(validatePhase2C26A5FilterIntervals([{ ...intervals[0], endMs: 100 }]).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- the pre-registered decision rule

describe('Phase 2-C2.6-A5 decision rule', () => {
  const analysisWith = (n: number, shares: Partial<Record<Phase2C26A5Category, number>>): Phase2C26A5ProfileAnalysis => {
    const categories = PHASE2C26A5_CATEGORIES.map(category => ({ category, samples: Math.round((shares[category] ?? 0) * n), share: shares[category] ?? 0 }))
    const unresolved = (shares.predicate_self_or_inlined ?? 0) + (shares.filter_or_inlined_predicate ?? 0) + (shares.other_unresolved ?? 0)
    return {
      alignment: { valid: true, issues: [] } as never, intervalValidation: { valid: true, issues: [], count: 1 },
      allProfileSamples: n * 2, observedIntervalUs: { median: 10_000, mean: 10_000 }, intervalsInProfile: 1, intervalMsInProfile: 1, intervalShareOfProfile: 0.5,
      filterIntervalSamples: n, filterSampleShare: 0.5, categories, unresolvedShare: unresolved, leafKinds: [], topLeaves: [], topStacks: [], registeredInclusive: [],
      registeredOutsideFilterSamples: 0, boundarySamples: 0,
    }
  }
  const decide = (rows: [number, Partial<Record<Phase2C26A5Category, number>>][]) => {
    const built = rows.map(([n, shares], index) => ({ id: `p${index}`, analysis: analysisWith(n, shares) }))
    const decisionRows: Phase2C26A5DecisionRow[] = built.map(row => phase2c26a5DecisionRow(row.id, row.analysis))
    const pooled = phase2c26a5PooledShares(built.map((row, index) => ({ valid: decisionRows[index].valid, analysis: row.analysis })))
    return phase2c26a5Decision(decisionRows, pooled)
  }
  const multiset = { multiset_equality: 0.7, rank_reference_validation: 0.1, predicate_self_or_inlined: 0.05, filter_or_inlined_predicate: 0.1, gc: 0.05 }

  it('decides U0 / U1 / GC / RANK / MULTISET / MIXED exactly in the registered order', () => {
    expect(decide([[4_999, multiset], [5_000, multiset], [100, multiset]]).case).toBe('U0_insufficient_samples')
    expect(decide([[6_000, { predicate_self_or_inlined: 0.2, filter_or_inlined_predicate: 0.15, multiset_equality: 0.65 }],
      [6_000, { other_unresolved: 0.35, multiset_equality: 0.65 }], [6_000, multiset]]).case).toBe('U1_jit_attribution_insufficient')
    expect(decide([[6_000, { gc: 0.2, rank_reference_validation: 0.4, multiset_equality: 0.4 }], [6_000, { gc: 0.25, rank_reference_validation: 0.4, multiset_equality: 0.35 }],
      [6_000, multiset]]).case).toBe('GC_allocation_or_gc')
    expect(decide([[6_000, { rank_reference_validation: 0.4, multiset_equality: 0.4, gc: 0.2 - 1e-9 }], [6_000, { rank_reference_validation: 0.35, multiset_equality: 0.65 }],
      [6_000, multiset]]).case).toBe('RANK_rank_reference_validation')
    const decided = decide([[6_000, multiset], [6_000, multiset], [100, { rank_reference_validation: 1 }]])
    expect(decided.case).toBe('MULTISET_multiset_equality')
    expect(decided.validPrimaries).toEqual(['p0', 'p1'])
    expect(decided.invalidPrimaries.map(p => p.orientationId)).toEqual(['p2'])
    const mixed = decide([[6_000, { multiset_equality: 0.3, rank_reference_validation: 0.3, gc: 0.15, filter_or_inlined_predicate: 0.25 }],
      [6_000, { multiset_equality: 0.34, rank_reference_validation: 0.34, filter_or_inlined_predicate: 0.32 }], [6_000, multiset]])
    expect(mixed.case).toBe('MIXED_mixed_internal_cost')
    expect(mixed.topPooledCategories).toHaveLength(2)
    expect(PHASE2C26A5_DECISION_RULE.minimumFilterIntervalSamples).toBe(5_000)
  })

  it('never counts a primary whose clocks, intervals or capture are invalid', () => {
    const bad = analysisWith(6_000, multiset)
    const rows = [
      phase2c26a5DecisionRow('a', { ...bad, alignment: { valid: false, issues: ['x'] } as never }),
      phase2c26a5DecisionRow('b', bad, ['profile SHA-256 differs from the child record']),
      phase2c26a5DecisionRow('c', null),
    ]
    expect(rows.every(row => !row.valid)).toBe(true)
    expect(phase2c26a5Decision(rows, phase2c26a5PooledShares([])).case).toBe('U0_insufficient_samples')
  })
})

describe('Phase 2-C2.6-A5 formal series validation', () => {
  it('refuses a raw run that is not a completed, committed, non-smoke run with a probe and the registered profiler', () => {
    const { c26a, a2, a3 } = authorities()
    const a4 = a4Authority()
    const validation = validatePhase2C26A5FormalRun({ status: 'probe_failed', environment: { smoke: { orientationIds: ['c14-p0'] } } }, c26a, a2, a3, a4, { ...shas, a4: 'x' })
    expect(validation.valid).toBe(false)
    expect(validation.failures).toEqual(expect.arrayContaining(['raw status is probe_failed', 'a smoke run is never formal', 'the profiler probe did not succeed',
      'the profiler window / sampling interval is not the registered one', 'baseline record missing', 'the diagnostic did not run on the rule\'s representative']))
    expect(validation.diagnosticRepresentative.expected).toBe(selectPhase2C26A5DiagnosticRepresentative(a4).representativeOrientationId)
  })
})
