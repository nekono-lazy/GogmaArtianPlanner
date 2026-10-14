import { vi } from 'vitest'
import type { BuildCandidate, RouteKind, RouteOperation } from '../../domain/models/publicTypes'
import { stableStringify } from '../../domain/models/publicTypes'
import {
  bonusStreamBaseKey,
  createTargetBonusStream,
  type BonusStreamBase,
  type BonusStreamSolution,
  type ReservedGogmaRuntimeEvent,
} from '../../domain/search/bonusStream'
import { candidateStableKey } from '../../domain/search/candidateProcessing'
import { searchCandidates } from '../../domain/search/candidateSearch'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from '../../domain/search/counterReservation'
import { visitPlannerAlternativeCandidates } from '../../domain/search/alternative/plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
} from '../../domain/search/alternative/plannerAlternativeTypes'
import { createSearchExecutionContext } from '../../domain/search/searchExecution'
import { createSearchPredictionSupport } from '../../domain/search/searchPredictionSupport'
import type { CandidateSearchInput } from '../../domain/search/searchTypes'
import type { SearchRuntimeEvent } from '../../domain/search/searchRuntime'
import { TargetSearchScheduler, type ScheduledRouteBase } from '../../domain/search/targetSearchScheduler'
import { candidateId } from './domainData'
import { sha256Hex } from './plannerAlternativeIdealPublicationParity'
import { originOf } from './plannerAlternativeFrontier'
import {
  projectReservedBonusSolution,
  reservedBonusStreamBase,
  reservedBonusStreamCases,
  type ReservedBonusStreamCase,
} from './reservedBonusStreamSinglePass'
import { seamFixture, slotsText, type SeamFixture, type SeamFixtureOptions } from './shapeConstrainedSeamFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2a (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 4.2 / 15): the Production
 * golden of every Search Domain seam the shape-constrained Route search (Research-only until Issue #260 PR-2) touches.
 *
 * `recordSeamProductionGolden()` runs, on the synthetic `seamFixture()`:
 *
 * - Planner Alternative Search (`visitPlannerAlternativeCandidates()`): the delivered Candidates, the summary, every
 *   prediction call and prediction support query, every Route base the three Route search primitives register (and the
 *   Bonus notices each receives), the runtime observer section sequence, the instrumentation observations, and the
 *   cancellation / yield checkpoint counts; once with every observer and once with none
 * - ordinary Candidate Search (`searchCandidates()`): the canonical Ideal Candidate, its searched / skipped Routes and
 *   notices, the prediction calls and support queries, the registered Route bases (the #104 Normal reduction included)
 * - the Bonus stream: the held-aware `readReservedDepth()` and the ordinary `readDepth()` / `solve()` /
 *   `reachesBeyondExtent()` of every base, their support queries and unsupported notices, the held-aware depth
 *   observations and runtime boundaries, and `bonusStreamBaseKey()` verbatim
 *
 * The expected records were produced ONCE by this very function on main e6da7bd (PR #247 merged), before any D-0A-2a
 * change, and are frozen in `shapeConstrainedSeamProductionGoldenPreD0A2A.json`. A test never regenerates them.
 */

const at = (...positions: number[]) => (counter: number) => positions.includes(counter)

function gogma(held: number[], blocked: number[] = []): Pick<PlannerAlternativeReservation, 'gogma'> {
  return { gogma: { held, blocked } }
}

export interface SeamGoldenScenario {
  name: string
  options: SeamFixtureOptions
  reservation?: Partial<PlannerAlternativeReservation>
  /** Planner Alternative consumer limit (default: every Candidate). */
  limit?: number
  /** Candidate Search route filter (default `all`); only the ordinary Search reads it. */
  routeFilter?: CandidateSearchInput['routeFilter']
}

/** Counters: Normal 4, Skill 7, Gogma 10; extent 5 unless stated. */
export const seamGoldenScenarios: readonly SeamGoldenScenario[] = [
  { name: 'existing:practical:bonus[11]:skill[9]', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: at(11), skillIdealAt: at(9) } },
  { name: 'existing:x2:one-protected', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }, { bonuses: 'practical', idealSkill: true, protected: true }], resetIdealAt: at(10, 12), skillIdealAt: at(8) } },
  { name: 'existing:ideal-skill:keep-chain', options: { extent: 4, owned: [{ bonuses: 'keep_compatible_practical', idealSkill: true }], keepResult: (g) => (g === 13 ? 'ideal' : 'practical') } },
  { name: 'existing:ideal-bonus-and-skill', options: { extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true }], resetIdealAt: at(11), skillIdealAt: at(8) } },
  { name: 'existing:protected-ideal', options: { extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true, protected: true }], resetIdealAt: at(11), skillIdealAt: at(8) } },
  { name: 'existing:exclusive', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }, { bonuses: 'practical', idealSkill: false }], resetIdealAt: at(11), skillIdealAt: at(8) },
    reservation: { exclusiveOwnedWeaponIds: ['owned.fixture.0' as never] } },
  { name: 'owned-normal:conversion', options: { extent: 4, ownedNormals: [{}], resetIdealAt: at(11), skillIdealAt: at(8) } },
  { name: 'owned-normal:keep-compatible', options: { extent: 4, ownedNormals: [{ bonuses: 'keep_compatible_practical' }], keepResult: (g) => (g === 11 ? 'ideal' : 'practical'), skillIdealAt: at(7, 9) } },
  { name: 'owned-normal:protected-exclusive', options: { extent: 4, ownedNormals: [{ protected: true }, {}, {}], resetIdealAt: at(12), skillIdealAt: at(9) },
    reservation: { exclusiveOwnedWeaponIds: ['owned.normal.2' as never] } },
  { name: 'owned-normal:skill-held', options: { extent: 4, ownedNormals: [{}], resetIdealAt: at(12), skillIdealAt: at(9, 10) },
    reservation: { skill: { held: [7, 8], blocked: [] } } },
  { name: 'new-normal:offsets', options: { extent: { normal: 4, gogma: 4, skill: 4 }, normalCounter: true, resetIdealAt: at(10, 12), skillIdealAt: at(8) } },
  { name: 'new-normal:held-prefix-blocked', options: { extent: { normal: 4, gogma: 4, skill: 4 }, normalCounter: true, resetIdealAt: at(11), skillIdealAt: at(8, 9) },
    reservation: { normal: [{ counterId: 'weapon.fixture.a:8', held: [4, 5], blocked: [5] }] } },
  { name: 'new-normal:keep-compatible-later', options: { extent: { normal: 6, gogma: 4, skill: 4 }, normalCounter: true,
    normalAt: (c) => (c >= 6 ? 'keep_compatible_practical' : 'practical'), keepResult: (g) => (g === 12 ? 'ideal' : 'practical'), skillIdealAt: at(8) } },
  { name: 'new-normal:skill-and-gogma-held', options: { extent: { normal: 3, gogma: 4, skill: 4 }, normalCounter: true, resetIdealAt: at(12, 13), skillIdealAt: at(9) },
    reservation: { skill: { held: [7], blocked: [7] }, ...gogma([10, 11], [11]) } },
  { name: 'blind:reset-first', options: { extent: 4, resetIdealAt: at(11, 13), skillIdealAt: at(8, 9) } },
  { name: 'reset-unsupported', options: { extent: 4, owned: [{ bonuses: 'keep_compatible_practical', idealSkill: false }], ownedNormals: [{}], normalCounter: true,
    resetSupported: false, keepResult: (g) => (g === 12 ? 'ideal' : 'practical'), skillIdealAt: at(8) } },
  { name: 'keep-unsupported', options: { extent: 4, owned: [{ bonuses: 'keep_compatible_practical', idealSkill: false }], ownedNormals: [{}],
    keepSupportedFor: () => false, resetIdealAt: at(11), skillIdealAt: at(7, 9) } },
  { name: 'keep-capability-false', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], normalCounter: true,
    capabilities: { supportsKeepBonusesPrediction: false }, resetIdealAt: at(11), skillIdealAt: at(8) } },
  { name: 'skill-unsupported', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }], ownedNormals: [{}], normalCounter: true,
    skillSupported: false, resetIdealAt: at(10) } },
  { name: 'normal-unsupported:blind', options: { extent: 4, normalCounter: true, normalSupported: false, resetIdealAt: at(11), skillIdealAt: at(8) } },
  { name: 'all-sources:gogma-held', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], ownedNormals: [{}], normalCounter: true,
    resetIdealAt: at(10, 13), skillIdealAt: at(8, 9) }, reservation: { ...gogma([11, 12], [12]), skill: { held: [7], blocked: [] } } },
  { name: 'all-sources:consumer-stop', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], ownedNormals: [{}], normalCounter: true,
    resetIdealAt: at(10, 13), skillIdealAt: at(8, 9) }, reservation: { ...gogma([11, 12], [12]), skill: { held: [7], blocked: [] } }, limit: 2 },
  { name: 'all-sources:existing-filter', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], ownedNormals: [{}], normalCounter: true,
    resetIdealAt: at(10, 13), skillIdealAt: at(8, 9) }, routeFilter: 'existing_gogma' },
  { name: 'all-sources:normal-filter', options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], ownedNormals: [{}], normalCounter: true,
    resetIdealAt: at(10, 13), skillIdealAt: at(8, 9) }, routeFilter: 'normal_artian' },
  { name: 'n104:later-compatible-layouts', options: { extent: { normal: 8, gogma: 4, skill: 4 }, normalCounter: true,
    normalAt: (c) => (c < 6 ? 'practical' : 'keep_compatible_practical'), keepResult: (g) => (g === 12 ? 'ideal' : 'practical'), skillIdealAt: at(8) } },
  { name: 'normal-extent-1', options: { extent: { normal: 1, gogma: 4, skill: 4 }, normalCounter: true, resetIdealAt: at(12), skillIdealAt: at(8) } },
]

function reservationOf(scenario: SeamGoldenScenario): PlannerAlternativeReservation {
  return { ...emptyPlannerAlternativeReservation, ...scenario.reservation }
}

const counter = (operation: RouteOperation): string =>
  operation.type === 'create_normal_artian' ? `n${operation.count}@${operation.normalCounterBefore}-${operation.normalCounterAfter}`
    : operation.type === 'convert_normal_to_gogma' ? `c${operation.skillCounterBefore}`
      : operation.type === 'reset_bonuses' ? `R${operation.gogmaCounterBefore}`
        : operation.type === 'keep_bonuses' ? `K${operation.gogmaCounterBefore}`
          : `S${operation.skillCounterBefore}`

/** The Route projection of one Candidate: kind, source and every operation with its absolute position. */
export function projectSeamCandidate(candidate: PlannerAlternativeCandidate | BuildCandidate): string {
  return `${candidate.route.kind}|${candidate.route.sourceOwnedWeaponId ?? '-'}|${candidate.route.operations.map(counter).join(',')}`
}

/** One registered Route base, spelled out. */
export function projectSeamBase(base: ScheduledRouteBase): string {
  const kind = base.kindResolution.type === 'fixed' ? base.kindResolution.kind : 'existing_gogma'
  const bonus = base.bonusBase === null ? '-'
    : `${base.bonusBase.startGogmaCounter}/${base.bonusBase.restorationBonusScope}/${base.bonusBase.amendmentPolicy ?? '.'}/${slotsText(base.bonusBase.bonuses)}`
  return [
    kind, base.sourceOwnedWeaponId ?? '-', base.baseOperations.map(counter).join(','),
    `conv:${base.conversionSkill === null ? '-' : base.conversionSkill.seriesSkillId}`,
    `zb:${base.zeroBonus === null ? '-' : `${base.zeroBonus.restorationBonusScope}/${slotsText(base.zeroBonus.finalBonuses)}`}`,
    `zs:${base.zeroSkill.seriesSkillId}`, `ss:${base.startSkillCounter ?? '-'}`, `bb:${bonus}`,
  ].join('|')
}

/**
 * Records every Route base registered on any scheduler while `run` executes, and every Bonus notice each receives.
 * The spy hands the scheduler the same base fields; only `onBonusNotice` is wrapped to observe its calls.
 */
async function withBaseRecorder<T>(run: () => Promise<T>) {
  const original = TargetSearchScheduler.prototype.addBase
  const bases: string[] = []
  const notices: string[] = []
  const spy = vi.spyOn(TargetSearchScheduler.prototype, 'addBase').mockImplementation(function (this: TargetSearchScheduler, base: ScheduledRouteBase) {
    const index = bases.length
    bases.push(projectSeamBase(base))
    const receive = base.onBonusNotice
    return original.call(this, receive === undefined ? base : { ...base, onBonusNotice: (notice) => {
      notices.push(`${index}:${stableStringify(notice)}`)
      receive.call(base, notice)
    } })
  })
  try {
    const value = await run()
    return { value, bases, notices }
  } finally {
    spy.mockRestore()
  }
}

const counts = (calls: readonly string[]) => {
  const count = (prefix: string) => calls.filter((call) => call.startsWith(prefix)).length
  return { normal: count('normal:'), skill: count('skill:'), reset: count('reset:'), keep: count('keep:') }
}

// ---------------------------------------------------------------- Planner Alternative Search

export interface SeamPlannerAlternativeRecord {
  name: string
  candidateCount: number
  projection: string[]
  stableKeysSha256: string
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean }
  stoppedByConsumer: boolean
  predictionCounts: ReturnType<typeof counts>
  predictionCallsSha256: string
  supportQueries: string[]
  bases: string[]
  notices: string[]
  checkpoints: { shouldCancel: number; yieldControl: number }
  instrumentation: {
    workSettled: number
    skillDepths: number
    skillDepthsSha256: string
    gogmaDepths: number
    gogmaDepthsSha256: string
    gogmaRuntimeEvents: number
    gogmaRuntimeSha256: string
    searchRuntimeEvents: number
    searchRuntimeSha256: string
  }
  /** The same run with no observer at all: the same Candidates, calls, queries and checkpoints. */
  plain: { stableKeysSha256: string; predictionCallsSha256: string; supportQueries: string[]; checkpoints: { shouldCancel: number; yieldControl: number } }
}

async function runPlannerAlternative(scenario: SeamGoldenScenario, instrumented: boolean) {
  const fixture: SeamFixture = seamFixture(scenario.options)
  const candidates: PlannerAlternativeCandidate[] = []
  const checkpoints = { shouldCancel: 0, yieldControl: 0 }
  const skillDepths: unknown[] = []
  const gogmaDepths: unknown[] = []
  const gogmaRuntime: ReservedGogmaRuntimeEvent[] = []
  const searchRuntime: SearchRuntimeEvent[] = []
  let workSettled = 0
  const limit = scenario.limit ?? Infinity
  const recorded = await withBaseRecorder(() => visitPlannerAlternativeCandidates({
    origin: originOf(fixture.input),
    targetWeaponId: fixture.input.targetWeaponId,
    extent: { ...fixture.input.settings },
    reservation: reservationOf(scenario),
    excludedRouteKeys: [],
  }, fixture.engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  }, {
    shouldCancel: () => { checkpoints.shouldCancel += 1; return false },
    yieldControl: async () => { checkpoints.yieldControl += 1 },
    ...(instrumented ? { instrumentation: {
      onWorkSettled: () => { workSettled += 1 },
      onSkillReservedDepth: (observation) => { skillDepths.push(observation) },
      onGogmaReservedDepth: (observation) => { gogmaDepths.push(observation) },
      onGogmaReservedRuntime: (event) => { gogmaRuntime.push(event) },
      onSearchRuntime: (event) => { searchRuntime.push(event) },
    } } : {}),
  }))
  return { fixture, candidates, execution: recorded.value, bases: recorded.bases, notices: recorded.notices, checkpoints,
    skillDepths, gogmaDepths, gogmaRuntime, searchRuntime, workSettled }
}

export async function recordSeamPlannerAlternative(scenario: SeamGoldenScenario): Promise<SeamPlannerAlternativeRecord> {
  const run = await runPlannerAlternative(scenario, true)
  const plain = await runPlannerAlternative(scenario, false)
  return {
    name: scenario.name,
    candidateCount: run.candidates.length,
    projection: run.candidates.map(projectSeamCandidate),
    stableKeysSha256: await sha256Hex(run.candidates.map(candidateStableKey).join('\n')),
    summary: { ...run.execution.summary },
    stoppedByConsumer: run.execution.stoppedByConsumer,
    predictionCounts: counts(run.fixture.calls),
    predictionCallsSha256: await sha256Hex(run.fixture.calls.join('\n')),
    supportQueries: [...run.fixture.supportQueries],
    bases: run.bases,
    notices: run.notices,
    checkpoints: run.checkpoints,
    instrumentation: {
      workSettled: run.workSettled,
      skillDepths: run.skillDepths.length,
      skillDepthsSha256: await sha256Hex(stableStringify(run.skillDepths)),
      gogmaDepths: run.gogmaDepths.length,
      gogmaDepthsSha256: await sha256Hex(stableStringify(run.gogmaDepths)),
      gogmaRuntimeEvents: run.gogmaRuntime.length,
      gogmaRuntimeSha256: await sha256Hex(stableStringify(run.gogmaRuntime)),
      searchRuntimeEvents: run.searchRuntime.length,
      searchRuntimeSha256: await sha256Hex(stableStringify(run.searchRuntime)),
    },
    plain: {
      stableKeysSha256: await sha256Hex(plain.candidates.map(candidateStableKey).join('\n')),
      predictionCallsSha256: await sha256Hex(plain.fixture.calls.join('\n')),
      supportQueries: [...plain.fixture.supportQueries],
      checkpoints: plain.checkpoints,
    },
  }
}

// ---------------------------------------------------------------- ordinary Candidate Search

export interface SeamCandidateSearchRecord {
  name: string
  candidate: string | null
  stableKeySha256: string | null
  /** SHA-256 of the whole canonical BuildCandidate (identity, traces and intermediate states included). */
  candidateSha256: string | null
  searchedRoutes: RouteKind[]
  skippedRoutes: string[]
  warnings: string[]
  predictionCounts: ReturnType<typeof counts>
  predictionCallsSha256: string
  supportQueries: string[]
  bases: string[]
  notices: string[]
  progressSha256: string
}

export async function recordSeamCandidateSearch(scenario: SeamGoldenScenario): Promise<SeamCandidateSearchRecord> {
  const fixture = seamFixture(scenario.options)
  fixture.input.routeFilter = scenario.routeFilter ?? 'all'
  const progress: unknown[] = []
  const recorded = await withBaseRecorder(() => searchCandidates(fixture.input, fixture.engine, {
    now: () => '2026-10-13T00:00:00.000Z',
    nowMs: () => 0,
    createCandidateId: ({ semanticHash }) => candidateId(`candidate.${semanticHash}`),
    onProgress: (event) => { progress.push(event) },
  }))
  const result = recorded.value
  const candidate = result.targetResult.candidate
  return {
    name: scenario.name,
    candidate: candidate === null ? null : projectSeamCandidate(candidate),
    stableKeySha256: candidate === null ? null : await sha256Hex(candidateStableKey(candidate)),
    candidateSha256: candidate === null ? null : await sha256Hex(stableStringify(candidate)),
    searchedRoutes: [...result.targetResult.searchedRoutes],
    skippedRoutes: result.targetResult.skippedRoutes.map((skip) => stableStringify(skip)),
    warnings: result.warnings.map((warning) => stableStringify(warning)),
    predictionCounts: counts(fixture.calls),
    predictionCallsSha256: await sha256Hex(fixture.calls.join('\n')),
    supportQueries: [...fixture.supportQueries],
    bases: recorded.bases,
    notices: recorded.notices,
    progressSha256: await sha256Hex(stableStringify(progress)),
  }
}

// ---------------------------------------------------------------- the Bonus stream

function streamOf(options: SeamFixtureOptions, extent: number, held?: number[], blocked?: number[], noSeed = false) {
  const fixture = seamFixture({ ...options, extent })
  const target = fixture.input.targetWeapons[0]
  const gogmaDepths: unknown[] = []
  const runtime: ReservedGogmaRuntimeEvent[] = []
  const reservation = held === undefined ? EMPTY_COUNTER_RESERVATION : createCounterReservation(held, blocked ?? [])
  const rngState = noSeed
    ? { ...fixture.input.rngState, baseSeed: { ...fixture.input.rngState.baseSeed, value: null, isConfirmed: false } }
    : fixture.input.rngState
  const stream = createTargetBonusStream(
    target,
    { rngState, master: fixture.input.master, maxGogmaAdvance: extent, reservation },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, fixture.input.master),
    (observation) => { gogmaDepths.push(observation) },
    (event) => { runtime.push(event) },
  )
  return { fixture, stream, gogmaDepths, runtime }
}

export interface SeamReservedStreamRecord {
  name: string
  reads: Array<{ depth: number; solutions: number; solutionsSha256: string; unsupportedPredictions: unknown[]; exhausted: boolean }>
  reachesBeyondExtent: boolean
  calls: string[]
  supportQueries: string[]
  depthObservations: unknown[]
  runtimeEvents: number
  runtimeSha256: string
}

/** One single-pass held-aware read, depth 1 up to the terminal read, of one D2-d stream case. */
export async function recordSeamReservedStream(testCase: ReservedBonusStreamCase): Promise<SeamReservedStreamRecord> {
  const { fixture, stream, gogmaDepths, runtime } = streamOf(testCase.options, testCase.extent, testCase.held, testCase.blocked, testCase.noSeed)
  const base = reservedBonusStreamBase(testCase.base)
  const reads: SeamReservedStreamRecord['reads'] = []
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readReservedDepth(base, depth)
    reads.push({
      depth,
      solutions: read.solutions.length,
      solutionsSha256: await sha256Hex(stableStringify(read.solutions.map(projectReservedBonusSolution))),
      unsupportedPredictions: [...read.unsupportedPredictions],
      exhausted: read.exhausted,
    })
    if (read.exhausted) break
    if (depth > 64) throw new Error(`${testCase.name}: the stream never became exhausted.`)
  }
  return {
    name: testCase.name, reads, reachesBeyondExtent: stream.reservedReachesBeyondExtent(base),
    calls: [...fixture.calls], supportQueries: [...fixture.supportQueries], depthObservations: gogmaDepths,
    runtimeEvents: runtime.length, runtimeSha256: await sha256Hex(stableStringify(runtime)),
  }
}

export interface SeamOrdinaryStreamCase {
  name: string
  options: SeamFixtureOptions
  extent: number
  base: ReservedBonusStreamCase['base']
}

export const seamOrdinaryStreamCases: readonly SeamOrdinaryStreamCase[] = [
  { name: 'ordinary gogma base', extent: 4, base: 'gogma_practical', options: { resetIdealAt: at(11), keepResult: (g) => (g === 12 ? 'ideal' : 'practical') } },
  { name: 'ordinary known normal base, keep only', extent: 4, base: 'normal_known_keep_only', options: { keepResult: (g) => (g === 12 ? 'ideal' : 'low') } },
  { name: 'ordinary known normal base, full', extent: 3, base: 'normal_known', options: { resetIdealAt: at(10) } },
  { name: 'ordinary blind base', extent: 4, base: 'blind', options: { resetIdealAt: at(12), keepResult: (g) => (g === 13 ? 'ideal' : 'low') } },
  { name: 'ordinary reset unsupported', extent: 4, base: 'gogma_practical', options: { resetSupported: false, keepResult: (g) => (g === 12 ? 'ideal' : 'low') } },
  { name: 'ordinary keep unsupported', extent: 3, base: 'gogma_practical', options: { keepSupportedFor: () => false, resetIdealAt: at(12) } },
  { name: 'ordinary keep capability false', extent: 3, base: 'gogma_practical', options: { capabilities: { supportsKeepBonusesPrediction: false }, resetIdealAt: at(11) } },
]

export interface SeamOrdinaryStreamRecord {
  name: string
  reads: Array<{ depth: number; solutions: number; solutionsSha256: string; steps: number; unsupportedPredictions: unknown[]; exhausted: boolean }>
  reachesBeyondExtent: boolean
  solveSha256: string
  calls: string[]
  supportQueries: string[]
}

function projectOrdinarySolution(solution: BonusStreamSolution) {
  const history: unknown[] = []
  for (let node: BonusStreamSolution['results'] | null = solution.results; node !== null; node = node.previous) {
    history.push({ depth: node.depth, bonuses: node.result.restorationBonuses, scope: node.result.restorationBonusScope })
  }
  return { depth: solution.depth, lastResetDepth: solution.lastResetDepth, bonuses: solution.bonuses, scope: solution.restorationBonusScope, history }
}

/** The ordinary `readDepth()` from depth 1 to its exhausted read, then `reachesBeyondExtent()`, then `solve()` on a fresh stream. */
export async function recordSeamOrdinaryStream(testCase: SeamOrdinaryStreamCase): Promise<SeamOrdinaryStreamRecord> {
  const { fixture, stream } = streamOf(testCase.options, testCase.extent)
  const base: BonusStreamBase = reservedBonusStreamBase(testCase.base)
  const reads: SeamOrdinaryStreamRecord['reads'] = []
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readDepth(base, depth)
    reads.push({
      depth,
      solutions: read.solutions.length,
      solutionsSha256: await sha256Hex(stableStringify(read.solutions.map(projectOrdinarySolution))),
      steps: read.steps.length,
      unsupportedPredictions: [...read.unsupportedPredictions],
      exhausted: read.exhausted,
    })
    if (read.exhausted) break
    if (depth > 64) throw new Error(`${testCase.name}: the ordinary stream never became exhausted.`)
  }
  const reachesBeyondExtent = stream.reachesBeyondExtent(base)
  const fresh = streamOf(testCase.options, testCase.extent)
  const solved = await fresh.stream.solve(base)
  return {
    name: testCase.name, reads, reachesBeyondExtent,
    solveSha256: await sha256Hex(stableStringify({ ...solved, solutions: solved.solutions.map(projectOrdinarySolution) })),
    calls: [...fixture.calls, '--solve--', ...fresh.fixture.calls],
    supportQueries: [...fixture.supportQueries, '--solve--', ...fresh.fixture.supportQueries],
  }
}

/** Every Production stream base spelling, verbatim. */
export function recordSeamStreamKeys(): Array<{ base: string; key: string }> {
  const { input } = seamFixture()
  const bases: Array<[string, BonusStreamBase]> = [
    ['gogma_practical', reservedBonusStreamBase('gogma_practical')],
    ['blind', reservedBonusStreamBase('blind')],
    ['normal_known', reservedBonusStreamBase('normal_known')],
    ['normal_known_keep_only', reservedBonusStreamBase('normal_known_keep_only')],
    ['normal_known_all', { ...reservedBonusStreamBase('normal_known'), amendmentPolicy: 'all' }],
    ['gogma_practical_at_14', { ...reservedBonusStreamBase('gogma_practical'), startGogmaCounter: 14 }],
  ]
  return bases.map(([name, base]) => ({ base: name, key: bonusStreamBaseKey(base, input.master) }))
}

// ---------------------------------------------------------------- the whole golden

export interface SeamProductionGolden {
  plannerAlternative: SeamPlannerAlternativeRecord[]
  candidateSearch: SeamCandidateSearchRecord[]
  reservedStreams: SeamReservedStreamRecord[]
  ordinaryStreams: SeamOrdinaryStreamRecord[]
  streamKeys: Array<{ base: string; key: string }>
}

export async function recordSeamProductionGolden(): Promise<SeamProductionGolden> {
  const plannerAlternative: SeamPlannerAlternativeRecord[] = []
  for (const scenario of seamGoldenScenarios.filter((s) => s.routeFilter === undefined)) plannerAlternative.push(await recordSeamPlannerAlternative(scenario))
  const candidateSearch: SeamCandidateSearchRecord[] = []
  for (const scenario of seamGoldenScenarios.filter((s) => s.reservation === undefined && s.limit === undefined)) {
    candidateSearch.push(await recordSeamCandidateSearch(scenario))
  }
  const reservedStreams: SeamReservedStreamRecord[] = []
  for (const testCase of reservedBonusStreamCases) reservedStreams.push(await recordSeamReservedStream(testCase))
  const ordinaryStreams: SeamOrdinaryStreamRecord[] = []
  for (const testCase of seamOrdinaryStreamCases) ordinaryStreams.push(await recordSeamOrdinaryStream(testCase))
  return { plannerAlternative, candidateSearch, reservedStreams, ordinaryStreams, streamKeys: recordSeamStreamKeys() }
}
