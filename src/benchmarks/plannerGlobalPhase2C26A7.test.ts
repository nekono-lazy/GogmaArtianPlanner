import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import rawA5 from '../../docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json?raw'
import rawA6 from '../../docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json?raw'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
} from '../domain/planner/alternative'
import type { BuildListEntryId, TargetWeapon, TargetWeaponId } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeSearchInput } from '../domain/search'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimeEvent } from '../domain/search/bonusStream'
import type { SearchRuntimeEvent } from '../domain/search/searchRuntime'
import { idealBonuses, belowPracticalBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { createCountingRngEngine } from './plannerAlternativeBenchmarkInstrumentation'
import { createIssue101NoIdealSearchInput, createLongHeldFixture } from './plannerAlternativeBenchmarkFixtures'
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority, type Phase2C26A3DepthRecord, type Phase2C26A3PhaseStartRecord } from './plannerGlobalPhase2C26A3'
import {
  parsePhase2C26A3ResultAuthority,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
  type Phase2C26A4A3Authority,
  type Phase2C26A4SearchSummaryRecord,
  type Phase2C26A4SectionStartRecord,
  type Phase2C26A4WorkSummaryRecord,
} from './plannerGlobalPhase2C26A4'
import { parsePhase2C26A4ResultAuthority, type Phase2C26A5A4Authority } from './plannerGlobalPhase2C26A5'
import { parsePhase2C26A5ResultAuthority, PHASE2C26A6_NODE_FLAGS, type Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import {
  createPhase2C26A7KernelProgress,
  parsePhase2C26A6ResultAuthority,
  PHASE2C26A7_NODE_FLAGS,
  PHASE2C26A7_PRODUCTION_CHANGE,
  PHASE2C26A7_SEARCH_INSTRUMENTATION,
  validatePhase2C26A7ConditionParity,
  validatePhase2C26A7NoProductionChange,
} from './plannerGlobalPhase2C26A7'
import {
  analyzePhase2C26A7Kernel,
  joinPhase2C26A7Works,
  phase2c26a7Decision,
  PHASE2C26A7_DECISION_RULE,
  PHASE2C26A7_SECTION_NEXT,
  summarizePhase2C26A7,
  type Phase2C26A7OrientationAnalysis,
} from './plannerGlobalPhase2C26A7Analysis'

/*
 * Issue #154 Phase 2-C2.6-A7. The A4 Search section observer and the A3 held-aware section observer, attached together,
 * are observational only (the delivered Candidates, the Search summary, the prediction calls and the kernel result are
 * identical with and without them) and the inner sections run strictly inside the outer `bonus_depth_read`. The committed
 * A6 / A5 / A4 / A3 / A2 / C2.6-A RESULTs are read as fail-closed authorities; the outer / inner connection and the
 * pre-registered decision rule are fixed on real and synthetic records. No duration is asserted.
 */

const SLOW = 180_000

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a), a2Json = JSON.parse(rawA2), a3Json = JSON.parse(rawA3), a4Json = JSON.parse(rawA4), a5Json = JSON.parse(rawA5), a6Json = JSON.parse(rawA6)
let shas = { c26a: '', a2: '', a3: '', a4: '', a5: '' }
beforeAll(async () => {
  shas = { c26a: await sha256Hex(rawC26a), a2: await sha256Hex(rawA2), a3: await sha256Hex(rawA3), a4: await sha256Hex(rawA4), a5: await sha256Hex(rawA5) }
})

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority; a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority } {
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
  return { c26a: c26a.authority, a2: a2.authority, a3: a3.authority, a4: a4.authority, a5: a5.authority }
}

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-A6 RESULT as the selection and bottleneck authority', () => {
  it('accepts the committed formal A6 RESULT (Case R) made against the committed A5 .. C2.6-A RESULTs and takes its selection', () => {
    const { c26a, a5 } = authorities()
    const parsed = parsePhase2C26A6ResultAuthority(a6Json, shas, a5, c26a)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority?.decisionCase).toBe('R_filter_reduced_timeout_remains')
    // Evidence check (not a source constant): the committed A6 selection is the A5 one.
    expect(parsed.authority?.primaryOrientationIds).toEqual(a5.primaryOrientationIds)
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    for (const reference of parsed.authority?.references ?? []) {
      expect(reference.maxCategory).toBe('bonus_depth_read')
      expect(reference.bonusDepthReadShare).toBeGreaterThanOrEqual(0.9)
      expect(reference.childOutcome).toBe('timeout')
    }
    expect(parsed.authority?.runSha256).toBe(a6Json.sources.run.sha256)
  })

  it('fails closed on a non-formal A6, another decision, a completed primary, a weaker bottleneck, a broken SHA chain or another selection', () => {
    const { c26a, a5 } = authorities()
    const mutate = (edit: (json: typeof a6Json) => void) => { const json = structuredClone(a6Json); edit(json); return parsePhase2C26A6ResultAuthority(json, shas, a5, c26a) }
    const zero = '0'.repeat(64)
    for (const key of ['c26a', 'a2', 'a3', 'a4', 'a5'] as const) expect(parsePhase2C26A6ResultAuthority(a6Json, { ...shas, [key]: zero }, a5, c26a).valid).toBe(false)
    expect(parsePhase2C26A6ResultAuthority(a6Json, shas, { ...a5, primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(parsePhase2C26A6ResultAuthority(a6Json, shas, { ...a5, measuredHead: '0'.repeat(40) }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'C_primary_search_completed' }).valid).toBe(false)
    expect(mutate(json => { json.conclusion.decision.case = 'M_mixed' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.timeout = 2; json.summary.childStatus.completed = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.primarySearchCompleted = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.semanticFailures = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[1].semanticFailures = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[0].searchCompleted.after = true }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[2].afterCategoryShare.bonus_depth_read = 0.85 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[0].maxCategoryAfter = 'bonus_ideal_filter' }).valid).toBe(false)
    expect(mutate(json => { json.a4StyleAfter.perOrientation[0].primarySearch.maxCategory = 'bonus_ideal_filter' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a5ChainRecordedByA5.a4ChainRecordedByA4.a2ShaRecordedByA3 = zero }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a4ShaRecordedByA5 = zero }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a5Result.sha256 = zero }).valid).toBe(false)
    expect(mutate(json => { delete json.sources.run }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected = ['c6-p1', 'c13-p1'] }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation = [json.perOrientation[1], json.perOrientation[0], json.perOrientation[2]] }).valid).toBe(false)
    expect(parsePhase2C26A6ResultAuthority(null, shas, a5, c26a).valid).toBe(false)
  })
})

describe('Phase 2-C2.6-A7 has no Production change', () => {
  it('accepts Research / test sources only and fails closed on any Production calculation source', () => {
    expect(PHASE2C26A7_PRODUCTION_CHANGE).toEqual([])
    expect(validatePhase2C26A7NoProductionChange([]).valid).toBe(true)
    expect(validatePhase2C26A7NoProductionChange(['src/benchmarks/plannerGlobalPhase2C26A7.ts', 'src/domain/search/bonusStream.test.ts', 'src/test/fixtures/x.ts']).valid).toBe(true)
    expect(validatePhase2C26A7NoProductionChange(['src/domain/search/bonusStream.ts']).valid).toBe(false)
    expect(validatePhase2C26A7NoProductionChange(['src/domain/models/domainRules.ts']).valid).toBe(false)
    expect(validatePhase2C26A7NoProductionChange(['docs/SEARCH_SPEC.md']).valid).toBe(false)
  })
})

describe('Phase 2-C2.6-A7 conditions', () => {
  it('accepts every A6 condition with the A7 pair of observers and rejects another budget, heap flag or instrumentation', () => {
    const { c26a, a2, a3, a4, a5 } = authorities()
    const current: Phase2C26A2RunConditions & { nodeFlags: string[]; searchInstrumentation: Record<string, boolean> } = {
      ...(a6Json.conditions as Phase2C26A2RunConditions), nodeFlags: [...PHASE2C26A7_NODE_FLAGS], searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION },
    }
    const check = (value: typeof current, a6Conditions = a6Json.conditions) => validatePhase2C26A7ConditionParity(value, a6Conditions, a5.conditions, a4.conditions, a3.conditions, c26a, a2.conditions)
    expect(check(current).issues).toEqual([])
    expect(PHASE2C26A7_NODE_FLAGS).toEqual(PHASE2C26A6_NODE_FLAGS)
    expect(PHASE2C26A7_SEARCH_INSTRUMENTATION).toEqual({ ...PHASE2C26A4_SEARCH_INSTRUMENTATION, onGogmaReservedRuntime: true })
    expect(PHASE2C26A7_SEARCH_INSTRUMENTATION).toMatchObject({ onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false })
    expect(check({ ...current, orientationBudgetMs: 3_600_000 }).valid).toBe(false)
    expect(check({ ...current, concurrency: 3 }).valid).toBe(false)
    expect(check({ ...current, nodeFlags: ['--max-old-space-size=4096'] }).valid).toBe(false)
    expect(check({ ...current, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 300, maxSkillAdvance: 4 } }).valid).toBe(false)
    expect(check({ ...current, searchInstrumentation: { ...PHASE2C26A4_SEARCH_INSTRUMENTATION } }).valid).toBe(false)
    expect(check({ ...current, searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION, onWorkSettled: true } }).valid).toBe(false)
    expect(check({ ...current, searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION, onGogmaReservedDepth: true } }).valid).toBe(false)
    expect(check(current, { ...a6Json.conditions, searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION } }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- Search level: both observers

type Observed = { source: 'outer'; event: SearchRuntimeEvent } | { source: 'inner'; event: ReservedGogmaRuntimeEvent }

function searchWorkloads(): Array<[string, PlannerAlternativeSearchInput, number | null]> {
  return [
    ['no-Ideal, empty reservation', createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 12, maxSkillAdvance: 2 }), null],
    ['long Gogma held', createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, 12],
    ['long Gogma held / blocked', createLongHeldFixture('long_gogma_held', { heldLength: 4, heldMode: 'held_blocked' }, { maxNormalAdvance: 1, maxGogmaAdvance: 10, maxSkillAdvance: 1 }).input, null],
  ]
}

async function runSearch(input: PlannerAlternativeSearchInput, stopAfter: number | null, observed: Observed[] | null) {
  const counting = createCountingRngEngine(new ProductionRngEngine())
  const keys: string[] = []
  const execution = await visitPlannerAlternativeCandidates(structuredClone(input), counting.engine, (candidate) => {
    keys.push(candidateStableKey(candidate))
    return stopAfter !== null && keys.length >= stopAfter ? 'stop' : 'continue'
  }, observed === null ? {} : { instrumentation: {
    onSearchRuntime: (event) => { observed.push({ source: 'outer', event: structuredClone(event) }) },
    onGogmaReservedRuntime: (event) => { observed.push({ source: 'inner', event: structuredClone(event) }) },
  } })
  return { keys, execution, counts: counting.counts() }
}

describe('A4 + A3 observers together: semantic neutrality and strict nesting', () => {
  it('changes no delivered key sequence, Search summary or prediction call count', async () => {
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const plain = await runSearch(input, stopAfter, null)
      const observed: Observed[] = []
      const both = await runSearch(input, stopAfter, observed)
      expect(both.keys, label).toEqual(plain.keys)
      expect(both.execution, label).toEqual(plain.execution)
      expect(both.counts, label).toEqual(plain.counts)
      expect(observed.some(o => o.source === 'inner'), label).toBe(true)
    }
  }, SLOW)

  it('reports every inner boundary strictly inside an open bonus_depth_read, one depth read per bonus_depth_read', async () => {
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const observed: Observed[] = []
      await runSearch(input, stopAfter, observed)
      const stack: string[] = []
      let depthsInRead = 0
      const perRead: number[] = []
      for (const o of observed) {
        if (o.source === 'outer') {
          if (o.event.type === 'section_started') { stack.push(o.event.section); if (o.event.section === 'bonus_depth_read') depthsInRead = 0 }
          else { if (o.event.section === 'bonus_depth_read') perRead.push(depthsInRead); stack.pop() }
          continue
        }
        expect(stack.at(-1), `${label}: inner ${o.event.type} outside bonus_depth_read`).toBe('bonus_depth_read')
        if (o.event.type === 'depth_started') depthsInRead += 1
      }
      expect(perRead.length, label).toBeGreaterThan(0)
      expect(perRead.every(count => count === 1), label).toBe(true)
      for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) expect(PHASE2C26A7_SECTION_NEXT[phase], phase).toMatch(/分離計時/)
    }
  }, SLOW)
})

// ---------------------------------------------------------------- kernel level

const TARGET_A = 'target.a7.a'
const TARGET_B = 'target.a7.b' as TargetWeaponId
const ENTRY_A = 'build-list.a7.a' as BuildListEntryId
const ENTRY_B = 'build-list.a7.b' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function kernelScenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL }),
    ],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations],
      }),
    ],
  })
}

function kernelRequest(built: ReturnType<typeof kernelScenario>, extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }): PlannerAlternativeKernelRequest {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) => kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A))
  if (!conflict) throw new Error('no Gogma conflict with A')
  return {
    plannerInput: built.input, decision: { conflictKey: conflict.id, selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [], priorExcludedRoutes: [], extent, bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
  }
}

describe('Phase 2-C2.6-A7 kernel progress', () => {
  it('returns the identical kernel result with and without the A7 instrumentation, hands exactly the two observers and snapshots on one clock', async () => {
    const extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }
    const plainBuilt = kernelScenario()
    const plain: PlannerAlternativeKernelResult = await runPlannerAlternativeKernel(kernelRequest(plainBuilt, extent), plainBuilt.dependencies, {})
    let clock = 0, calls = 0
    const lifecycle: unknown[] = [], starts: Phase2C26A4SectionStartRecord[] = [], works: Phase2C26A4WorkSummaryRecord[] = [], searches: Phase2C26A4SearchSummaryRecord[] = []
    const phases: Phase2C26A3PhaseStartRecord[] = [], depths: Phase2C26A3DepthRecord[] = []
    const progress = createPhase2C26A7KernelProgress({ now: () => { calls += 1; return (clock += 1) },
      predictionCounts: () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }),
      emitLifecycle: r => lifecycle.push(r), emitSectionStarted: r => starts.push(r), emitWorkSummary: r => works.push(r), emitSearchSummary: r => searches.push(r),
      emitGogmaPhaseStarted: r => phases.push(r), emitGogmaDepth: r => depths.push(r) })
    progress.start()
    const handed = progress.instrumentation.searchInstrumentationForTarget?.(TARGET_B, 0)
    expect(Object.keys(handed ?? {}).sort()).toEqual(['onGogmaReservedRuntime', 'onSearchRuntime'])
    const observedBuilt = kernelScenario()
    const observed = await runPlannerAlternativeKernel(kernelRequest(observedBuilt, extent), observedBuilt.dependencies, { instrumentation: progress.instrumentation })
    expect(observed).toEqual(plain)
    if (plain.status !== 'completed' || observed.status !== 'completed') throw new Error('kernel failed')
    expect(observed.targets.map(t => [t.outcome.status, t.trials, t.search])).toEqual(plain.targets.map(t => [t.outcome.status, t.trials, t.search]))
    const before = calls
    const heartbeat = progress.heartbeat()
    // The two snapshots share one frozen instant: the clock is read exactly once per heartbeat.
    expect(calls - before).toBe(1)
    expect(heartbeat.searchRuntime.contractViolations).toBe(0)
    expect(heartbeat.gogmaRuntime.contractViolations).toBe(0)
    expect(heartbeat.gogmaRuntime.activePhase).toBeNull()
    expect(depths.length).toBeGreaterThan(0)
    expect(phases.length).toBeGreaterThan(0)
    // The same Search reports one completed held-aware depth read per completed Bonus depth work.
    const bonusWorks = works.filter(w => w.section === 'bonus_depth_work')
    expect(depths.length).toBe(bonusWorks.length)

    // End to end through the analyzer: a completed kernel of these records.
    const kernel = {
      orientationId: 'x', task: { orientation: { orientationId: 'x', kind: 'same_gogma_counter', fixedTargetWeaponId: TARGET_A, participantTargetWeaponIds: [TARGET_A, TARGET_B] } },
      process: { outcome: 'completed', ipc: {} }, events: lifecycle, heartbeats: [{ ...heartbeat, final: true }], runtime: [...starts, ...works, ...searches],
      gogmaRuntime: [...phases, ...depths],
    }
    const row = analyzePhase2C26A7Kernel(kernel, value => value, null, null, null)
    expect(row.searchCompleted).toBe(true)
    expect(row.observationPoint).toBe('search_completed')
    expect(row.workJoin.issues).toEqual([])
    expect(row.workJoin.joined).toBe(bonusWorks.length)
    const read = row.outer.bonus_depth_read.ms as number
    expect(read).toBeGreaterThan(0)
    // Inner sections run inside the outer read: never more than it.
    expect(row.inner.sumMs).toBeLessThanOrEqual(read)
    expect(row.inner.innerCoverageOfBonusDepthRead).toBeGreaterThan(0)
    expect(row.inner.innerCoverageOfBonusDepthRead).toBeLessThanOrEqual(1)
    expect((row.inner.remainderSplitMs.inDepthOutsideSections ?? -1) + (row.inner.remainderSplitMs.outsideDepthBoundaries ?? -1)).toBeCloseTo(row.inner.readRemainderMs ?? NaN)
    expect(row.inner.remainderSplitMs.inDepthOutsideSections).toBeGreaterThanOrEqual(0)
    expect(row.inner.remainderSplitMs.outsideDepthBoundaries).toBeGreaterThanOrEqual(0)
    expect(row.inner.dominantSection).not.toBeNull()
    expect(row.contractViolations).toEqual({ outer: 0, inner: 0 })
  }, SLOW)
})

// ---------------------------------------------------------------- analysis: a synthetic killed child

describe('Phase 2-C2.6-A7 analysis: outer / inner connection at the last heartbeat', () => {
  const sections = (values: Partial<Record<(typeof RESERVED_GOGMA_RUNTIME_PHASES)[number], number>>) =>
    Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(p => [p, values[p] ?? 0])) as Record<(typeof RESERVED_GOGMA_RUNTIME_PHASES)[number], number>

  /** Search started at 1000 ms, last heartbeat at 101000 ms (wall 100 000 ms); bonus_depth_read 90 000 ms of it. */
  function killedKernel(inner: Partial<Record<(typeof RESERVED_GOGMA_RUNTIME_PHASES)[number], number>>, active: { phase: string; elapsedMs: number } | null, inclusiveDepthMs: number) {
    const lifecycle = (seq: number, type: string, elapsedMs: number) => ({ kind: 'lifecycle', seq, elapsedMs, predictionCounts: {}, search: null, searchDepths: null,
      event: { type, targetWeaponId: 'target.x', targetOrdinal: 0, targetCount: 1, budget: { used: 0, limit: 8 } } })
    const zero = () => ({ search_runtime: 0 }) as Record<string, number>
    const exclusiveMs = { ...zero(), bonus_depth_read: 90_000, bonus_ideal_filter: 6_000, bonus_notice_scan: 3_000, search_runtime: 100_000 - 100 - 99_000 }
    const inclusiveMs = { ...zero(), search_runtime: 100_000 - 100, bonus_depth_work: 99_000, bonus_depth_read: 90_000 }
    return {
      orientationId: 'c1-p0',
      task: { orientation: { orientationId: 'c1-p0', kind: 'same_gogma_counter', fixedTargetWeaponId: 'target.f', participantTargetWeaponIds: ['target.f', 'target.x'] } },
      process: { outcome: 'timeout', killedAtMs: 103000, ipc: { kernelInvoked: { originChildProcessMs: 500 }, minClockOffsetMs: 20 } },
      events: [lifecycle(1, 'target_started', 900), lifecycle(2, 'search_started', 1000)],
      heartbeats: [{ kind: 'heartbeat', elapsedMs: 101000, activeTarget: { targetOrdinal: 0 },
        searchRuntime: { atMs: 101000,
          byTarget: [{ targetOrdinal: 0, sectionCounts: { bonus_depth_work: 3 }, settleWithoutWork: { count: 0, inclusiveMs: 0 }, bonusDepth: { works: 3, rawSolutions: 3000 }, skillDepth: { works: 0 } }],
          observed: [{ targetOrdinal: 0, inclusiveMs, exclusiveMs, settleWithoutWorkMs: 0 }], activeTargetOrdinal: 0,
          activeStack: [{ section: 'search_runtime', startedMs: 1100, elapsedMs: 99_900, work: null }, { section: 'bonus_depth_read', startedMs: 99_000, elapsedMs: 2000, work: null }],
          contractViolations: 0, contractViolationSamples: [] },
        gogmaRuntime: {
          byTarget: [{ targetOrdinal: 0, phaseTotalsMs: sections(inner), phaseCounts: sections({}), completedDepths: 3, inclusiveDepthMs, maxDepthReached: 3, streams: 1 }],
          activePhase: active === null ? null : { targetOrdinal: 0, streamIndex: 0, depth: 4, phase: active.phase, startedMs: 101000 - active.elapsedMs, elapsedMs: active.elapsedMs },
          activeDepth: active === null ? null : { targetOrdinal: 0, streamIndex: 0, depth: 4, startedMs: 99_000, elapsedMs: 2_000, phaseMs: {} },
          contractViolations: 0, contractViolationSamples: [] } }],
      runtime: [{ kind: 'search_section_started', seq: 1, elapsedMs: 99_000, targetOrdinal: 0, section: 'bonus_depth_read',
        stack: ['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'], work: { channel: 0, depth: 4 } }],
      gogmaRuntime: [{ kind: 'gogma_phase_started', seq: 1, elapsedMs: 99_500, targetOrdinal: 0, streamIndex: 0, depth: 4, phase: active?.phase ?? 'state_generation' }],
    }
  }

  it('adds the active inner section, compares with the outer read on one instant and splits the remainder', () => {
    // Completed inner totals 84 000 + active 1 500 = 85 500 of 90 000; completed inclusive depths 86 000 + active depth 2 000.
    const kernel = killedKernel({ state_generation: 40_000, frontier_reduction_sort: 38_000, solution_materialization: 4_000, support_evaluation: 1_500, window_collection: 400, exhaustion_scan: 100 },
      { phase: 'state_generation', elapsedMs: 1_500 }, 86_000)
    const row = analyzePhase2C26A7Kernel(kernel, value => value, null, null, null)
    expect(row.observedAtMs).toEqual({ outer: 101000, inner: 101000 })
    expect(row.searchWallMs).toBe(100_000)
    expect(row.outer.bonus_depth_read).toEqual({ ms: 90_000, shareOfSearchWall: 0.9 })
    expect(row.outer.bonus_ideal_filter).toEqual({ ms: 6_000, shareOfSearchWall: 0.06 })
    expect(row.inner.sumMs).toBe(85_500)
    expect(row.inner.innerCoverageOfBonusDepthRead).toBe(0.95)
    expect(row.inner.readRemainderMs).toBe(4_500)
    expect(row.inner.readRemainderShareOfBonusDepthRead).toBe(0.05)
    expect(row.inner.readRemainderShareOfSearchWall).toBe(0.045)
    expect(row.inner.remainderSplitMs).toEqual({ inDepthOutsideSections: 88_000 - 85_500, outsideDepthBoundaries: 90_000 - 88_000 })
    expect(row.inner.dominantSection).toBe('state_generation')
    expect(row.inner.sections.find(s => s.section === 'state_generation')).toMatchObject({ totalMs: 41_500, shareOfSearchWall: 0.415, shareOfBonusDepthRead: 0.4611 })
    expect(row.inner.activeAtObservation).toMatchObject({ phase: 'state_generation', elapsedMs: 1_500 })
    expect(row.inner.dominantShareOfBonusDepthRead).toBe(0.4611)
  })

  it('joins outer Bonus depth works and inner depth reads one to one and fails closed on a depth mismatch', () => {
    const work = (seq: number, depth: number, readMs: number, raw: number) => ({ kind: 'search_work_summary', seq, targetOrdinal: 0, section: 'bonus_depth_work',
      work: { channel: 0, depth }, counts: { rawSolutions: raw }, phaseMs: { bonus_depth_read: readMs } })
    const depth = (seq: number, d: number, inclusiveMs: number, phaseMs: Record<string, number>, generated: number) => ({ kind: 'gogma_depth', seq, targetOrdinal: 0, streamIndex: 0, depth: d,
      counts: { generatedStates: generated }, phaseMs, inclusiveMs })
    const join = joinPhase2C26A7Works({
      runtime: [work(2, 1, 100, 10), work(4, 2, 200, 30), work(6, 3, 400, 50)],
      gogmaRuntime: [depth(1, 1, 98, { state_generation: 60, frontier_reduction_sort: 35 }, 10), depth(2, 2, 195, { state_generation: 120, frontier_reduction_sort: 70 }, 30),
        depth(3, 3, 390, { state_generation: 230, frontier_reduction_sort: 150 }, 50), depth(4, 4, 10, { state_generation: 5 }, 5)],
    })
    expect(join.issues).toEqual([])
    expect(join).toMatchObject({ valid: true, outerWorks: 3, innerDepths: 4, joined: 3 })
    expect(join.totalsMs).toEqual({ bonusDepthRead: 700, innerSections: 665, innerInclusive: 683, inDepthOutsideSections: 18, outsideDepthBoundaries: 17 })
    expect(join.coverage).toMatchObject({ count: 3, min: 0.95, max: 0.95 })
    const mismatch = joinPhase2C26A7Works({ runtime: [work(2, 1, 100, 10), work(4, 3, 200, 30)], gogmaRuntime: [depth(1, 1, 98, {}, 1), depth(2, 2, 195, {}, 1)] })
    expect(mismatch.valid).toBe(false)
    expect(joinPhase2C26A7Works({ runtime: [work(2, 1, 100, 10), work(4, 2, 200, 30)], gogmaRuntime: [depth(1, 1, 98, {}, 1)] }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- decision

function row(orientationId: string, coverage: number | null, dominantSection: string | null): Phase2C26A7OrientationAnalysis {
  return { orientationId, childOutcome: 'timeout', searchCompleted: false, searchWallMs: 1000, semanticFailures: 0, contractViolations: { outer: 0, inner: 0 },
    deliveredCandidates: 0, trialsStarted: 0, fullPlannerRunsStarted: 0, rawSolutions: 10, bonusDepthWorks: 1,
    outer: { bonus_depth_read: { ms: 900, shareOfSearchWall: 0.9 }, bonus_ideal_filter: { ms: 50, shareOfSearchWall: 0.05 }, bonus_notice_scan: { ms: 30, shareOfSearchWall: 0.03 } },
    inner: { innerCoverageOfBonusDepthRead: coverage, dominantSection, sumMs: coverage === null ? 0 : coverage * 900, sections: [] } } as unknown as Phase2C26A7OrientationAnalysis
}

describe('Phase 2-C2.6-A7 pre-registered decision', () => {
  it('evaluates U, then F, then M with majority 2 of 3 and never fixes the dominant section in advance', () => {
    expect(PHASE2C26A7_DECISION_RULE).toMatchObject({ registeredPrimaryCount: 3, majority: 2, coverageThreshold: 0.9 })
    expect(phase2c26a7Decision([row('a', 0.89, 'state_generation'), row('b', 0.5, 'state_generation'), row('c', 0.99, 'state_generation')]).case).toBe('U_inner_coverage_gap')
    const f = phase2c26a7Decision([row('a', 0.99, 'state_generation'), row('b', 0.9, 'state_generation'), row('c', 0.5, 'frontier_reduction_sort')])
    expect(f).toMatchObject({ case: 'F_dominant_inner_section', section: 'state_generation' })
    expect(f.recommendation).toContain('state_generation')
    const g = phase2c26a7Decision([row('a', 0.99, 'frontier_reduction_sort'), row('b', 0.97, 'state_generation'), row('c', 0.98, 'frontier_reduction_sort')])
    expect(g).toMatchObject({ case: 'F_dominant_inner_section', section: 'frontier_reduction_sort' })
    expect(phase2c26a7Decision([row('a', 0.99, 'frontier_reduction_sort'), row('b', 0.97, 'state_generation'), row('c', 0.5, 'frontier_reduction_sort')]).case).toBe('M_mixed')
    expect(phase2c26a7Decision([row('a', 0.99, 'frontier_reduction_sort'), row('b', 0.97, 'state_generation'), row('c', 0.98, 'solution_materialization')]).case).toBe('M_mixed')
    expect(phase2c26a7Decision([row('a', 0.99, 'state_generation'), row('b', 0.99, 'state_generation')]).case).toBe('M_mixed')
    expect(phase2c26a7Decision([row('a', null, null), row('b', null, null), row('c', 0.99, 'state_generation')]).case).toBe('U_inner_coverage_gap')
  })

  it('pools the Search wall, the outer read and the inner sections across primaries', () => {
    const summary = summarizePhase2C26A7([row('a', 0.9, 'state_generation'), row('b', 1, 'state_generation'), row('c', 0.95, 'state_generation')])
    expect(summary.pooled).toMatchObject({ searchWallMs: 3000, bonusDepthReadMs: 2700, bonusDepthReadShareOfSearchWall: 0.9, innerCoverageOfBonusDepthRead: 0.95 })
    expect(summary.decision.case).toBe('F_dominant_inner_section')
  })
})
