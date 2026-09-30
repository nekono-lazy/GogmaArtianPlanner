import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import schedulerSource from '../domain/search/targetSearchScheduler.ts?raw'
import searchSource from '../domain/search/alternative/plannerAlternativeSearch.ts?raw'
import runtimeSource from '../domain/search/searchRuntime.ts?raw'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
} from '../domain/planner/alternative'
import type { BuildListEntryId, TargetWeapon, TargetWeaponId } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchInput,
} from '../domain/search'
import {
  SEARCH_RUNTIME_SECTION_PARENT,
  SEARCH_RUNTIME_SECTIONS,
  type SearchRuntimeEvent,
  type SearchRuntimeSection,
} from '../domain/search/searchRuntime'
import { idealBonuses, belowPracticalBonuses } from '../test/fixtures/constrainedEnumeration'
import { createCandidateSearchEngine, createCandidateSearchInput, practicalOnlyBonuses } from '../test/fixtures/candidateSearch'
import { ownedWeaponId } from '../test/fixtures/domainData'
import type { OwnedGogmaArtianWeapon } from '../domain/models/publicTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { emptyPlannerAlternativeReservation } from '../domain/search/alternative/plannerAlternativeTypes'
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
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import {
  createPhase2C26A4KernelProgress,
  createPhase2C26A4RuntimeTracker,
  parsePhase2C26A3ResultAuthority,
  PHASE2C26A4_CONTAINER_SECTIONS,
  PHASE2C26A4_OUTER_CATEGORIES,
  PHASE2C26A4_SECTION_CATEGORY,
  validatePhase2C26A4ConditionParity,
  type Phase2C26A4SearchSummaryRecord,
  type Phase2C26A4SectionStartRecord,
  type Phase2C26A4WorkSummaryRecord,
} from './plannerGlobalPhase2C26A4'
import { analyzePhase2C26A4Kernel, phase2c26a4Decision, summarizePhase2C26A4 } from './plannerGlobalPhase2C26A4Analysis'

/*
 * Issue #154 Phase 2-C2.6-A4. The Search section boundary observer is observational only: with and without it the
 * delivered Candidates, the Search summary, the prediction calls and the kernel result are identical. Its event contract
 * (the registered hierarchy, strict nesting, pairing, depth detail / counts only on depth work) is fixed here, and the
 * committed A3 / A2 / C2.6-A RESULTs are read as the fail-closed selection / parity authorities. No duration is asserted.
 */

const SLOW = 180_000

// ---------------------------------------------------------------- Search level

/**
 * The delivering fixture of the Planner Alternative Search tests: an unprotected owned Gogma whose first Reset Bonuses
 * (Gogma 10) yields the Ideal five slots and whose Skill reaches the Ideal only at Skill Counter 8, plus a second
 * preferred source; Normal offsets forge Practical-only slots. It composes, wakes waiting Lazy Cross rows and delivers
 * Candidates of several costs, so every scheduler work kind and the delivery flush run.
 */
function deliveringWorkload(): { input: PlannerAlternativeSearchInput; engine: RngEngine } {
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: 5, maxGogmaAdvance: 5, maxSkillAdvance: 5 }
  input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
  input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
  input.ownedWeapons[0].isProtected = false
  input.ownedWeapons[0].seriesSkillId = 'series.other'
  const second: OwnedGogmaArtianWeapon = { ...(structuredClone(input.ownedWeapons[0]) as OwnedGogmaArtianWeapon), id: ownedWeaponId('owned.fixture.second') }
  input.ownedWeapons.push(second)
  input.targetWeapons[0].preferredOwnedWeaponId = second.id
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => practicalOnlyBonuses())
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => ({
    seriesSkillId: skillCounter === 8 ? 'series_skill.fixture.a' : 'series.other.' + skillCounter, groupSkillId: 'group_skill.fixture.a',
  }))
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) =>
    operation.type === 'reset_bonuses' && gogmaCounter === 10 ? structuredClone(input.targetWeapons[0].idealBonuses) : practicalOnlyBonuses())
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return {
    input: {
      origin: { rngState: input.rngState, normalCounters: input.normalCounters, ownedWeapons: input.ownedWeapons, targetWeapons: input.targetWeapons,
        master: input.master, calculationContext: input.calculationContext },
      targetWeaponId: input.targetWeaponId,
      extent: { maxNormalAdvance: 5, maxGogmaAdvance: 5, maxSkillAdvance: 5 },
      reservation: emptyPlannerAlternativeReservation,
      excludedRouteKeys: [],
    },
    engine,
  }
}

const production = (input: PlannerAlternativeSearchInput) => () => ({ input, engine: new ProductionRngEngine() as RngEngine })

function searchWorkloads(): Array<[string, () => { input: PlannerAlternativeSearchInput; engine: RngEngine }, number | null]> {
  return [
    ['no-Ideal, empty reservation', production(createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 12, maxSkillAdvance: 2 })), null],
    ['long Gogma held', production(createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input), 12],
    ['long Gogma held / blocked', production(createLongHeldFixture('long_gogma_held', { heldLength: 4, heldMode: 'held_blocked' }, { maxNormalAdvance: 1, maxGogmaAdvance: 10, maxSkillAdvance: 1 }).input), null],
    ['long Skill held', production(createLongHeldFixture('long_skill_held', { heldLength: 4, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 4, maxSkillAdvance: 8 }).input), 20],
    ['delivering, to the extent', deliveringWorkload, null],
    ['delivering, consumer stop', deliveringWorkload, 3],
  ]
}

afterEach(() => { vi.restoreAllMocks() })

async function runSearch(workload: () => { input: PlannerAlternativeSearchInput; engine: RngEngine }, stopAfter: number | null,
  observe: ((event: SearchRuntimeEvent) => unknown) | null) {
  const { input, engine } = workload()
  const counting = createCountingRngEngine(engine)
  const keys: string[] = []
  const execution = await visitPlannerAlternativeCandidates(
    structuredClone(input),
    counting.engine,
    (candidate) => {
      keys.push(candidateStableKey(candidate))
      return stopAfter !== null && keys.length >= stopAfter ? 'stop' : 'continue'
    },
    observe === null ? {} : { instrumentation: { onSearchRuntime: observe as (event: SearchRuntimeEvent) => void } },
  )
  return { keys, execution, counts: counting.counts() }
}

/** The contract every observed sequence of one completed Search must satisfy; returns the violations (empty = valid). */
function contractViolations(events: readonly SearchRuntimeEvent[]): string[] {
  const issues: string[] = []
  const stack: SearchRuntimeSection[] = []
  for (const [index, event] of events.entries()) {
    const at = `#${index} ${event.type} ${event.section}`
    const keys = Object.keys(event).sort()
    if (event.type === 'section_started') {
      const depthWork = event.section === 'bonus_depth_work' || event.section === 'skill_depth_work'
      if (JSON.stringify(keys) !== JSON.stringify(depthWork ? ['section', 'type', 'work'] : ['section', 'type'])) issues.push(`${at}: keys ${keys.join(',')}`)
      if (SEARCH_RUNTIME_SECTION_PARENT[event.section] !== (stack.at(-1) ?? null)) issues.push(`${at}: under ${String(stack.at(-1) ?? null)}`)
      if (event.section === 'search_runtime' && index !== 0) issues.push(`${at}: a second root`)
      stack.push(event.section)
    } else {
      const depthWork = event.section === 'bonus_depth_work' || event.section === 'skill_depth_work'
      if (JSON.stringify(keys) !== JSON.stringify(depthWork ? ['counts', 'section', 'type'] : ['section', 'type'])) issues.push(`${at}: keys ${keys.join(',')}`)
      if (stack.at(-1) !== event.section) issues.push(`${at}: open ${String(stack.at(-1))}`)
      stack.pop()
    }
  }
  if (stack.length > 0) issues.push(`left open: ${stack.join('>')}`)
  if (events.at(-1)?.type !== 'section_completed' || events.at(-1)?.section !== 'search_runtime') issues.push('the root does not complete last')
  return issues
}

describe('Search runtime observer: registered hierarchy', () => {
  it('registers every section once, parents first, with a Search root and no clock in the Domain', () => {
    expect(new Set(SEARCH_RUNTIME_SECTIONS).size).toBe(SEARCH_RUNTIME_SECTIONS.length)
    expect(Object.keys(SEARCH_RUNTIME_SECTION_PARENT).sort()).toEqual([...SEARCH_RUNTIME_SECTIONS].sort())
    for (const [index, section] of SEARCH_RUNTIME_SECTIONS.entries()) {
      const parent = SEARCH_RUNTIME_SECTION_PARENT[section]
      if (index === 0) expect(parent).toBeNull()
      else expect(SEARCH_RUNTIME_SECTIONS.indexOf(parent as SearchRuntimeSection)).toBeLessThan(index)
    }
    for (const source of [schedulerSource, searchSource, runtimeSource]) expect(source).not.toMatch(/performance\.now|Date\.now|process\.hrtime|new Date\(/)
    // Every section maps to one outer category except the root, which is the only unattributed time.
    for (const section of SEARCH_RUNTIME_SECTIONS) expect(PHASE2C26A4_SECTION_CATEGORY[section] === null).toBe(section === 'search_runtime')
    expect(new Set(Object.values(PHASE2C26A4_SECTION_CATEGORY).filter(Boolean)).size).toBeLessThanOrEqual(PHASE2C26A4_OUTER_CATEGORIES.length)
    expect([...PHASE2C26A4_CONTAINER_SECTIONS]).toContain('bonus_depth_work')
    expect([...PHASE2C26A4_CONTAINER_SECTIONS]).not.toContain('bonus_depth_read')
  })
})

describe('Search runtime observer: semantic neutrality', () => {
  it('changes no delivered key sequence, Search summary or prediction call count', async () => {
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const plain = await runSearch(input, stopAfter, null)
      const events: SearchRuntimeEvent[] = []
      // A return value is never read: returning something must change nothing.
      const observed = await runSearch(input, stopAfter, (event) => { events.push(structuredClone(event)); return 'stop' })
      expect(observed.keys, label).toEqual(plain.keys)
      expect(observed.execution, label).toEqual(plain.execution)
      expect(observed.counts, label).toEqual(plain.counts)
      expect(events.length, label).toBeGreaterThan(0)
    }
  }, SLOW)

  it('reports boundaries in the registered hierarchy, with the depth detail and counts only on depth work and no timestamp', async () => {
    const seen = new Set<SearchRuntimeSection>()
    for (const [label, input, stopAfter] of searchWorkloads()) {
      const events: SearchRuntimeEvent[] = []
      const result = await runSearch(input, stopAfter, (event) => { events.push(structuredClone(event)) })
      expect(contractViolations(events), label).toEqual([])
      for (const event of events) seen.add(event.section)
      // Delivered Candidates = consumer calls; every depth work completion carries the counts it already held.
      expect(events.filter(e => e.type === 'section_started' && e.section === 'delivery_consumer').length, label).toBe(result.keys.length)
      for (const event of events) {
        if (event.type === 'section_completed' && event.counts !== undefined) {
          expect(event.counts.idealSolutions, label).toBeLessThanOrEqual(event.counts.rawSolutions)
          expect(event.counts.evaluatedSolutions, label).toBe(event.counts.idealSolutions)
        }
      }
      // One scheduler_settle per scheduler_step, each holding at most one scheduler-owned work section.
      let open = 0, works = 0
      for (const event of events) {
        if (event.section === 'scheduler_settle') { if (event.type === 'section_started') { open += 1; works = 0 } else { expect(works, label).toBeLessThanOrEqual(1); open -= 1 } }
        if (event.type === 'section_started' && SEARCH_RUNTIME_SECTION_PARENT[event.section] === 'scheduler_settle') works += 1
      }
      expect(open, label).toBe(0)
    }
    // Every registered section is reached by these workloads.
    expect(SEARCH_RUNTIME_SECTIONS.filter(section => !seen.has(section))).toEqual([])
  }, SLOW)

  it('stops reporting at a section interrupted by cancellation', async () => {
    const { input } = searchWorkloads()[2][1]()
    const events: SearchRuntimeEvent[] = []
    await expect(visitPlannerAlternativeCandidates(structuredClone(input), new ProductionRngEngine(), () => 'continue', {
      shouldCancel: () => events.some((event) => event.type === 'section_started' && event.section === 'bonus_depth_read'),
      instrumentation: { onSearchRuntime: (event) => { events.push(structuredClone(event)) } },
    })).rejects.toThrow()
    // The read that saw the cancel is left open, and nothing completes after it.
    const lastRead = events.map(e => e.type === 'section_started' && e.section === 'bonus_depth_read').lastIndexOf(true)
    expect(lastRead).toBeGreaterThan(0)
    expect(events.slice(lastRead + 1).filter(e => e.type === 'section_completed')).toEqual([])
    expect(events.at(-1)?.type).toBe('section_started')
  }, SLOW)
})

// ---------------------------------------------------------------- tracker

describe('Phase 2-C2.6-A4 runtime tracker', () => {
  function drive(sequence: Array<[number, number, SearchRuntimeEvent]>) {
    let clock = 0
    const starts: Phase2C26A4SectionStartRecord[] = [], works: Phase2C26A4WorkSummaryRecord[] = [], searches: Phase2C26A4SearchSummaryRecord[] = []
    const tracker = createPhase2C26A4RuntimeTracker({ now: () => clock, origin: () => 0, emitSectionStarted: r => starts.push(r), emitWorkSummary: r => works.push(r),
      emitSearchSummary: r => searches.push(r) })
    for (const [at, target, event] of sequence) { clock = at; tracker.observerForTarget(target)(event) }
    return { tracker, starts, works, searches, setClock: (at: number) => { clock = at } }
  }
  const s = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_started', section, ...extra }) as SearchRuntimeEvent
  const c = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_completed', section, ...extra }) as SearchRuntimeEvent
  const counts = { rawSolutions: 100, unsupportedPredictions: 0, idealSolutions: 2, evaluatedSolutions: 2, subscriberCount: 3, retainedCountAfter: 2, exhausted: false }

  it('attributes inclusive and exclusive time without double counting, splits a settle without work, and reads the open stack', () => {
    const { tracker, starts, works, searches, setClock } = drive([
      [0, 0, s('search_runtime')],
      [1, 0, s('search_setup')], [2, 0, c('search_setup')],
      [2, 0, s('route_registration')], [2, 0, s('normal_route_registration')], [5, 0, c('normal_route_registration')], [6, 0, c('route_registration')],
      [6, 0, s('scheduler_step')], [6, 0, s('scheduler_checkpoint')], [7, 0, c('scheduler_checkpoint')],
      [7, 0, s('scheduler_settle')], [9, 0, c('scheduler_settle')], [9, 0, s('scheduler_post_settle')], [9, 0, c('scheduler_post_settle')], [9, 0, c('scheduler_step')],
      [10, 0, s('scheduler_step')], [10, 0, s('scheduler_checkpoint')], [10, 0, c('scheduler_checkpoint')], [10, 0, s('scheduler_settle')],
      [11, 0, s('bonus_depth_work', { work: { channel: 0, depth: 1 } })],
      [11, 0, s('bonus_depth_read')], [31, 0, c('bonus_depth_read')],
      [31, 0, s('bonus_notice_scan')], [36, 0, c('bonus_notice_scan')],
      [36, 0, s('bonus_ideal_filter')], [40, 0, c('bonus_ideal_filter')],
      [40, 0, s('bonus_channel_publication')], [40, 0, s('cross_add_bonus')], [42, 0, c('cross_add_bonus')], [43, 0, c('bonus_channel_publication')],
      [44, 0, c('bonus_depth_work', { counts })],
      [45, 0, c('scheduler_settle')], [45, 0, c('scheduler_step')],
      [46, 0, s('scheduler_step')], [46, 0, s('scheduler_checkpoint')], [47, 0, c('scheduler_checkpoint')], [47, 0, s('scheduler_settle')],
      [48, 0, s('bonus_depth_work', { work: { channel: 0, depth: 2 } })], [48, 0, s('bonus_depth_read')],
    ])
    expect(starts.map(r => r.section)).toEqual(['search_runtime', 'search_setup', 'route_registration', 'normal_route_registration', 'bonus_depth_work', 'bonus_depth_read',
      'bonus_notice_scan', 'bonus_ideal_filter', 'bonus_channel_publication', 'bonus_depth_work', 'bonus_depth_read'])
    expect(starts.at(-1)?.stack).toEqual(['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'])
    expect(works).toHaveLength(1)
    expect(works[0]).toMatchObject({ inclusiveMs: 33, counts, work: { channel: 0, depth: 1 },
      phaseMs: { bonus_depth_read: 20, bonus_notice_scan: 5, bonus_ideal_filter: 4, bonus_channel_publication: 1, self: 1 } })
    expect(searches).toEqual([])
    setClock(58)
    const snapshot = tracker.snapshot()
    expect(snapshot.contractViolations).toBe(0)
    const t = snapshot.byTarget[0]
    expect(t.exclusiveMs.bonus_depth_read).toBe(20)
    expect(t.exclusiveMs.cross_add_bonus).toBe(2)
    expect(t.inclusiveMs.bonus_channel_publication).toBe(3)
    expect(t.exclusiveMs.bonus_channel_publication).toBe(1)
    expect(t.settleWithoutWork).toEqual({ count: 1, inclusiveMs: 2 })
    expect(t.bonusDepth).toMatchObject({ works: 1, rawSolutions: 100, idealSolutions: 2, subscriberPublications: 6, maxSubscriberCount: 3 })
    expect(snapshot.activeStack.map(f => [f.section, f.elapsedMs])).toEqual([['search_runtime', 58], ['scheduler_step', 12], ['scheduler_settle', 11], ['bonus_depth_work', 10], ['bonus_depth_read', 10]])
    // Observed totals add the open frames: every exclusive section plus nothing else sums to the root's inclusive time.
    const observed = snapshot.observed[0]
    expect(observed.inclusiveMs.search_runtime).toBe(58)
    expect(observed.exclusiveMs.bonus_depth_read).toBe(30)
    const exclusiveSum = SEARCH_RUNTIME_SECTIONS.reduce((sum, section) => sum + observed.exclusiveMs[section], 0)
    expect(exclusiveSum).toBe(58)
    expect(observed.exclusiveMs.search_runtime).toBe(58 - 1 - 4 - 3 - 35 - 12)
  })

  it('emits a Search summary on the root completion and accepts the next Target\'s Search after it', () => {
    const { tracker, searches } = drive([
      [0, 0, s('search_runtime')], [1, 0, s('search_setup')], [2, 0, c('search_setup')], [3, 0, c('search_runtime')],
      [4, 1, s('search_runtime')], [5, 1, c('search_runtime')],
    ])
    expect(searches.map(r => [r.targetOrdinal, r.totals.inclusiveMs.search_runtime])).toEqual([[0, 3], [1, 1]])
    expect(tracker.snapshot().contractViolations).toBe(0)
    expect(tracker.snapshot().activeTargetOrdinal).toBeNull()
  })

  it('counts contract violations instead of throwing', () => {
    const { tracker } = drive([
      [0, 0, c('search_setup')],
      [1, 0, s('bonus_depth_read')],
      [2, 0, s('search_runtime')],
      [3, 0, s('bonus_depth_work')],
      [4, 0, s('scheduler_step')],
      [5, 0, c('search_runtime', { counts })],
      [6, 1, s('search_setup')],
    ])
    expect(tracker.snapshot().contractViolations).toBeGreaterThanOrEqual(6)
  })
})

// ---------------------------------------------------------------- kernel level

const TARGET_A = 'target.a4.a'
const TARGET_B = 'target.a4.b' as TargetWeaponId
const ENTRY_A = 'build-list.a4.a' as BuildListEntryId
const ENTRY_B = 'build-list.a4.b' as BuildListEntryId
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

describe('Phase 2-C2.6-A4 kernel progress: semantic neutrality', () => {
  it('returns the identical kernel result with and without the A4 instrumentation, and attaches only the section boundary observer', async () => {
    for (const extent of [{ maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 }]) {
      const plainBuilt = kernelScenario()
      const plain: PlannerAlternativeKernelResult = await runPlannerAlternativeKernel(kernelRequest(plainBuilt, extent), plainBuilt.dependencies, {})
      let clock = 0
      const lifecycle: unknown[] = [], works: Phase2C26A4WorkSummaryRecord[] = [], searches: Phase2C26A4SearchSummaryRecord[] = []
      const progress = createPhase2C26A4KernelProgress({ now: () => (clock += 1), predictionCounts: () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }),
        emitLifecycle: r => lifecycle.push(r), emitSectionStarted: () => undefined, emitWorkSummary: r => works.push(r), emitSearchSummary: r => searches.push(r) })
      progress.start()
      const handed = progress.instrumentation.searchInstrumentationForTarget?.(TARGET_B, 0)
      expect(Object.keys(handed ?? {})).toEqual(['onSearchRuntime'])
      const observedBuilt = kernelScenario()
      const observed = await runPlannerAlternativeKernel(kernelRequest(observedBuilt, extent), observedBuilt.dependencies, { instrumentation: progress.instrumentation })
      expect(observed).toEqual(plain)
      if (plain.status !== 'completed' || observed.status !== 'completed') throw new Error('kernel failed')
      expect(observed.plannerRerunsUsed).toBe(plain.plannerRerunsUsed)
      expect(observed.targets.map(t => [t.outcome.status, t.trials, t.search])).toEqual(plain.targets.map(t => [t.outcome.status, t.trials, t.search]))
      expect(lifecycle.length).toBeGreaterThan(0)
      const heartbeat = progress.heartbeat()
      expect(heartbeat.searchRuntime.contractViolations).toBe(0)
      expect(heartbeat.searchRuntime.activeStack).toEqual([])
      expect(searches.length).toBe(observed.targets.length)
      expect(works.length).toBeGreaterThan(0)
    }
  }, SLOW)
})

// ---------------------------------------------------------------- authorities

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a)
const a2Json = JSON.parse(rawA2)
const a3Json = JSON.parse(rawA3)
let c26aSha = '', a2Sha = ''
beforeAll(async () => { c26aSha = await sha256Hex(rawC26a); a2Sha = await sha256Hex(rawA2) })

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority } {
  const c26a = parsePhase2C26AAuthority(c26aJson)
  if (!c26a.authority) throw new Error(c26a.issues.join('; '))
  const a2 = parsePhase2C26A2ResultAuthority(a2Json, c26aSha, c26a.authority)
  if (!a2.authority) throw new Error(a2.issues.join('; '))
  return { c26a: c26a.authority, a2: a2.authority }
}

describe('Phase 2-C2.6-A3 RESULT as the selection authority', () => {
  it('accepts the committed formal A3 RESULT made against the committed A2 / C2.6-A RESULTs and takes its selection', () => {
    const { c26a, a2 } = authorities()
    const parsed = parsePhase2C26A3ResultAuthority(a3Json, c26aSha, a2Sha, a2, c26a)
    expect(parsed.issues).toEqual([])
    // Evidence check (not a source constant): the committed A3 selection.
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    expect(parsed.authority?.primaryOrientationIds).toEqual(a2.primaryOrientationIds)
    expect(parsed.authority?.references.map(r => r.dominantPhase)).toEqual(['frontier_reduction_sort', 'frontier_reduction_sort', 'frontier_reduction_sort'])
  })

  it('fails closed on a non-formal A3, another decision, a broken SHA chain or a selection that is not the A2 rule\'s', () => {
    const { c26a, a2 } = authorities()
    const mutate = (edit: (json: typeof a3Json) => void) => { const json = structuredClone(a3Json); edit(json); return parsePhase2C26A3ResultAuthority(json, c26aSha, a2Sha, a2, c26a) }
    expect(parsePhase2C26A3ResultAuthority(a3Json, '0'.repeat(64), a2Sha, a2, c26a).valid).toBe(false)
    expect(parsePhase2C26A3ResultAuthority(a3Json, c26aSha, '0'.repeat(64), a2, c26a).valid).toBe(false)
    expect(parsePhase2C26A3ResultAuthority(a3Json, c26aSha, a2Sha, { primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'G_gogma_phase_dominant' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.out_of_memory = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.process_failure = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.orientations = 4 }).valid).toBe(false)
    expect(mutate(json => { json.provenance.c26aResultShaRecordedByA2 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a2Result.sha256 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.exportSha256 = 'x' }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected.reverse() }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation.reverse() }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation.pop() }).valid).toBe(false)
  })

  it('requires every A3 condition (concurrency 1 included) and A3\'s own parity against C2.6-A / A2', () => {
    const { c26a, a2 } = authorities()
    const current = { ...a3Json.conditions } as Phase2C26A2RunConditions
    const parity = validatePhase2C26A4ConditionParity(current, a3Json.conditions, c26a, a2.conditions)
    expect(parity.issues).toEqual([])
    expect(validatePhase2C26A4ConditionParity({ ...current, concurrency: 3 }, a3Json.conditions, c26a, a2.conditions).issues).toEqual(['concurrency differs', 'concurrency is 1 differs'])
    expect(validatePhase2C26A4ConditionParity({ ...current, childHeapLimitMb: 4096 }, a3Json.conditions, c26a, a2.conditions).issues).toEqual(['childHeapLimitMb differs'])
    expect(validatePhase2C26A4ConditionParity({ ...current, orientationBudgetMs: 60_000 }, a3Json.conditions, c26a, a2.conditions).issues).toEqual(['orientationBudgetMs differs'])
    expect(validatePhase2C26A4ConditionParity(current, { ...a3Json.conditions, extent: { maxNormalAdvance: 5 } }, c26a, a2.conditions).issues)
      .toEqual(['extent differs', 'a3.extent differs'])
  })
})

// ---------------------------------------------------------------- post-hoc analysis

describe('Phase 2-C2.6-A4 analysis: reconciliation and the pre-registered decision rule', () => {
  const zero = () => Object.fromEntries(SEARCH_RUNTIME_SECTIONS.map(section => [section, 0])) as Record<SearchRuntimeSection, number>

  /**
   * A synthetic killed kernel child: Search started at 1000 ms, last heartbeat snapshot at 101000 ms (wall 100 000 ms).
   * `exclusive` lists the non-root exclusive section times; the root keeps the rest minus `unattributed`... the root's own
   * exclusive time is `rootSelf`, and the kernel wrapper is 100 ms.
   */
  function killedKernel(id: string, exclusive: Partial<Record<SearchRuntimeSection, number>>, settleWithoutWorkMs = 0) {
    const lifecycle = (seq: number, type: string, elapsedMs: number) => ({ kind: 'lifecycle', seq, elapsedMs, predictionCounts: {}, search: null, searchDepths: null,
      event: { type, targetWeaponId: 'target.x', targetOrdinal: 0, targetCount: 1, budget: { used: 0, limit: 8 } } })
    const exclusiveMs = { ...zero(), ...exclusive }
    const nonRoot = SEARCH_RUNTIME_SECTIONS.reduce((sum, section) => sum + (section === 'search_runtime' ? 0 : exclusiveMs[section]), 0)
    const runtimeInclusive = 100_000 - 100
    exclusiveMs.search_runtime = runtimeInclusive - nonRoot
    const inclusiveMs = { ...zero(), search_runtime: runtimeInclusive, bonus_depth_work: (exclusive.bonus_depth_read ?? 0) + (exclusive.bonus_notice_scan ?? 0), bonus_depth_read: exclusive.bonus_depth_read ?? 0 }
    const start = { kind: 'search_section_started', seq: 1, elapsedMs: 99_000, targetOrdinal: 0, section: 'bonus_depth_read',
      stack: ['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'], work: { channel: 0, depth: 7 } }
    return {
      orientationId: id,
      task: { orientation: { orientationId: id, kind: 'same_gogma_counter', fixedTargetWeaponId: 'target.f', participantTargetWeaponIds: ['target.f', 'target.x'] } },
      process: { outcome: 'timeout', killedAtMs: 103000, ipc: { kernelInvoked: { originChildProcessMs: 500 }, minClockOffsetMs: 20 } },
      events: [lifecycle(1, 'target_started', 900), lifecycle(2, 'search_started', 1000)],
      heartbeats: [{ kind: 'heartbeat', elapsedMs: 101000, activeTarget: { targetOrdinal: 0 }, searchRuntime: {
        atMs: 101000,
        byTarget: [{ targetOrdinal: 0, sectionCounts: { ...zero(), scheduler_step: 10, bonus_depth_work: 3 }, settleWithoutWork: { count: 2, inclusiveMs: settleWithoutWorkMs },
          bonusDepth: { works: 3, rawSolutions: 3000 }, skillDepth: { works: 1 } }],
        observed: [{ targetOrdinal: 0, inclusiveMs, exclusiveMs, settleWithoutWorkMs }],
        activeTargetOrdinal: 0,
        activeStack: [{ section: 'search_runtime', startedMs: 1100, elapsedMs: 99_900, work: null }, { section: 'bonus_depth_read', startedMs: 99_000, elapsedMs: 2000, work: null }],
        contractViolations: 0, contractViolationSamples: [] } }],
      runtime: [start],
    }
  }

  it('reconciles the Search wall into the outer categories and the root\'s own unattributed time', () => {
    const row = analyzePhase2C26A4Kernel(killedKernel('c1-p0', { bonus_depth_read: 70_000, bonus_notice_scan: 15_000, bonus_ideal_filter: 5_000, scheduler_settle: 3_000,
      scheduler_checkpoint: 2_000 }, 1_000), value => value, null)
    const search = row.primarySearch
    expect(search?.observationPoint).toBe('last_heartbeat')
    expect(search?.searchWallMs).toBe(100_000)
    expect(search?.categoryTotalsMs).toMatchObject({ kernel_search_wrapper: 100, bonus_depth_read: 70_000, bonus_notice_scan: 15_000, bonus_ideal_filter: 5_000,
      scheduler_checkpoint: 2_000, route_base_work: 1_000, queue_dispatch_or_unclassified: 2_000 })
    // 100 000 - 100 - 95 000 = 4 900 in the root itself.
    expect(search?.unattributedSearchMs).toBe(4_900)
    expect(search?.coverage).toBeCloseTo(0.951)
    expect(search?.maxCategory).toBe('bonus_depth_read')
    expect(search?.groups.bonus_post_read.ms).toBe(15_000)
    expect(row.activeAtEnd).toMatchObject({ where: 'section', lastDurable: { section: 'bonus_depth_read' } })
    // Kill at parent 103 000 -> kernel elapsed 103 000 - 500 - 20 = 102 480.
    expect(row.activeAtEnd.lastDurableElapsedAtKillEstimateMs).toBeCloseTo(3480)
    expect(row.activeAtEnd.lastHeartbeatStack.map(f => f.section)).toEqual(['search_runtime', 'bonus_depth_read'])
  })

  it('decides U, O, I and M exactly by the registered rule', () => {
    const k = (id: string, exclusive: Partial<Record<SearchRuntimeSection, number>>) => analyzePhase2C26A4Kernel(killedKernel(id, exclusive), value => value, null)
    const read = (ms: number, extra: Partial<Record<SearchRuntimeSection, number>> = {}) => ({ bonus_depth_read: ms, ...extra })
    // U: two primaries leave more than 10 % in the root.
    expect(phase2c26a4Decision([k('a', read(80_000)), k('b', read(85_000)), k('c', read(95_000))])).toMatchObject({ case: 'U_instrumentation_gap' })
    // O: notice scan >= 10 % in two covered primaries, even though the read is the largest.
    expect(phase2c26a4Decision([k('a', read(70_000, { bonus_notice_scan: 25_000 })), k('b', read(75_000, { bonus_notice_scan: 20_000 })), k('c', read(95_000))]))
      .toMatchObject({ case: 'O_outer_bottleneck', category: 'bonus_notice_scan' })
    // I: the read dominates and nothing else reaches 10 %.
    expect(phase2c26a4Decision([k('a', read(90_000, { bonus_notice_scan: 5_000 })), k('b', read(93_000)), k('c', read(60_000, { delivery_sort: 35_000 }))]))
      .toMatchObject({ case: 'I_inner_read_dominant', category: 'bonus_depth_read' })
    // M: the covered primaries disagree and no outer category is shared.
    expect(phase2c26a4Decision([k('a', read(50_000, { cross_wake: 45_000 })), k('b', read(50_000, { compose_route: 45_000 })), k('c', read(40_000, { skill_depth_read: 55_000 }))]))
      .toMatchObject({ case: 'M_mixed' })
    expect(phase2c26a4Decision([k('a', read(95_000)), k('b', read(95_000))])).toMatchObject({ case: 'M_mixed', recommendation: 'fail closed: no decision' })
  })

  it('summarizes the categories without double counting', () => {
    const rows = [analyzePhase2C26A4Kernel(killedKernel('c1-p0', { bonus_depth_read: 70_000, bonus_notice_scan: 20_000 }), value => value, null)]
    const summary = summarizePhase2C26A4(rows)
    const total = Object.values(summary.categoryTotalsMs).reduce((a, b) => a + b, 0)
    expect(total).toBe(summary.measuredMs)
    expect(summary.measuredMs + summary.unattributedSearchMs).toBe(summary.searchWallMs)
  })
})
