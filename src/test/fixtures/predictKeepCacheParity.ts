import type {
  OwnedGogmaArtianWeapon,
  RestorationBonus,
  RestorationBonusSet,
} from '../../domain/models/publicTypes'
import { stableStringify } from '../../domain/models/hashing'
import { keepFamilyLayoutKey } from '../../domain/rng/gogmaBonusFamily'
import type { RngPredictionSupportInput } from '../../domain/rng/rngEngine'
import {
  createTargetBonusStream,
  type BonusStreamBase,
  type ReservedGogmaDepthObservation,
  type ReservedGogmaRuntimeEvent,
} from '../../domain/search/bonusStream'
import { visitPlannerAlternativeCandidates } from '../../domain/search/alternative/plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeSearchInput,
} from '../../domain/search/alternative/plannerAlternativeTypes'
import { searchCandidates } from '../../domain/search/candidateSearch'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from '../../domain/search/counterReservation'
import { createSearchExecutionContext } from '../../domain/search/searchExecution'
import { createSearchPredictionSupport } from '../../domain/search/searchPredictionSupport'
import { createCandidateSearchEngine, createCandidateSearchInput, SEARCH_FIXTURE_TIME } from './candidateSearch'
import { ownedWeaponId } from './domainData'
import { projectReservedBonusSolution } from './reservedBonusStreamSinglePass'

/*
 * Global Planner Research Phase 2-C2.6-B2-C2B2I (Issue #154): the `predictKeep()`
 * memo of `createTargetBonusStream()` changed its representation from one
 * composite string key `${gogmaCounter}\u0000${familyLayoutKey}` to a nested
 * `counter -> familyLayoutKey -> prediction` Map. The pair it identifies is the
 * same, so nothing a stream or a Search returns may change.
 *
 * `recordPredictKeepCacheParity()` drives the real stream and the real Searches
 * over a deterministic fixture engine whose Reset / Keep results vary both the
 * family layout and the tiers, so states with one family layout but different
 * tiers meet at one Gogma position (the tier-sharing case), and reduces each run
 * to what a caller sees: the ordinary `readDepth()` solutions, the held-aware
 * `readReservedDepth()` raw solutions with their absolute steps and whole
 * history chain, the observer counts (frontier before / after, generated
 * states, family layouts), the bounded Candidate Search / Planner Alternative
 * Search candidates in delivery order with their termination, and every Engine
 * call with its exact input (the Keep representative's five slots included).
 *
 * The expected records were produced ONCE by this very function on main
 * 4007ef1 (the composite key, before the optimization) and are frozen in
 * `predictKeepCachePreB2I.json`. A test never regenerates them.
 */

const RANKS = ['bonus_rank.fixture.low', 'bonus_rank.fixture.middle', 'bonus_rank.fixture.high'] as const
const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'

/** Three ordered family layouts: X is the Ideal one, Y / Z two orders of one other multiset. */
export const PREDICT_KEEP_LAYOUTS = {
  X: [ATTACK, ATTACK, ELEMENT, UTILITY, SHARPNESS],
  Y: [ELEMENT, ATTACK, ATTACK, UTILITY, UTILITY],
  Z: [ATTACK, ELEMENT, ATTACK, UTILITY, UTILITY],
} as const
type LayoutName = keyof typeof PREDICT_KEEP_LAYOUTS

const withTiers = (types: readonly string[], tier: (slot: number) => number): RestorationBonusSet =>
  types.map((bonusTypeId, slot): RestorationBonus => ({ bonusTypeId, bonusRankId: RANKS[tier(slot) % RANKS.length]! })) as RestorationBonusSet

export interface PredictKeepCacheCase {
  name: string
  extent: number
  held?: number[]
  blocked?: number[]
  /** Reset result layout at a Gogma Counter (tiers vary with the Counter). */
  resetLayout: (gogmaCounter: number) => LayoutName
  /** Keep tier offset at a Gogma Counter (the family layout is always kept). */
  keepTier: (gogmaCounter: number) => number
  /** Gogma Counters whose Reset (or Keep of an X layout) returns the Ideal five slots. */
  idealAt?: number[]
  /** Owned Gogma sources of the bounded Searches (unprotected, gogma scope): their layout and tier offset. */
  owned: Array<{ layout: LayoutName; tier: number }>
}

export const predictKeepCacheCases: PredictKeepCacheCase[] = [
  { name: 'one layout, tiers vary per counter', extent: 4, resetLayout: () => 'X', keepTier: (c) => c * 2, idealAt: [12],
    owned: [{ layout: 'X', tier: 0 }, { layout: 'X', tier: 1 }] },
  { name: 'three layouts cycling, tiers vary', extent: 4, resetLayout: (c) => (['X', 'Y', 'Z'] as const)[c % 3]!, keepTier: (c) => c + 1, idealAt: [13],
    owned: [{ layout: 'Y', tier: 0 }, { layout: 'Z', tier: 2 }, { layout: 'Y', tier: 1 }] },
  { name: 'two layouts, ideal late', extent: 5, resetLayout: (c) => (c % 2 === 0 ? 'Y' : 'X'), keepTier: (c) => c, idealAt: [14],
    owned: [{ layout: 'X', tier: 1 }, { layout: 'Y', tier: 2 }] },
  { name: 'held and blocked positions, layouts cycling', extent: 5, held: [11, 12, 13], blocked: [12], resetLayout: (c) => (['Z', 'X', 'Y'] as const)[c % 3]!,
    keepTier: (c) => c * 3 + 1, idealAt: [14], owned: [{ layout: 'Z', tier: 0 }, { layout: 'X', tier: 2 }] },
]

/** The Ideal five slots of the fixture Target (layout X). */
const IDEAL_TIERS = [2, 2, 1, 0, 2]

/** A fixture input and an Engine whose Reset / Keep results follow the case; every Engine call is logged with its exact input. */
export function predictKeepCacheFixture(testCase: PredictKeepCacheCase) {
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: testCase.extent, maxGogmaAdvance: testCase.extent, maxSkillAdvance: 1 }
  input.routeFilter = 'existing_gogma'
  const ideal = withTiers(PREDICT_KEEP_LAYOUTS.X, (slot) => IDEAL_TIERS[slot]!)
  input.targetWeapons[0]!.idealBonuses = structuredClone(ideal)
  const template = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  input.ownedWeapons = testCase.owned.map((owned, index): OwnedGogmaArtianWeapon => ({
    ...structuredClone(template),
    id: ownedWeaponId(`owned.fixture.predict-keep.${index}`),
    restorationBonuses: withTiers(PREDICT_KEEP_LAYOUTS[owned.layout], (slot) => owned.tier + slot),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: input.targetWeapons[0]!.idealSkillCondition?.seriesSkillId ?? template.seriesSkillId,
    groupSkillId: input.targetWeapons[0]!.idealSkillCondition?.groupSkillId ?? template.groupSkillId,
    isProtected: false,
  }))
  input.normalCounters = []
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  const idealAt = new Set(testCase.idealAt ?? [])
  const isX = (bonuses: RestorationBonusSet) => bonuses.every((bonus, slot) => bonus.bonusTypeId === PREDICT_KEEP_LAYOUTS.X[slot])
  engine.predictGogmaBonus = ({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      calls.push(`reset:${gogmaCounter}`)
      if (idealAt.has(gogmaCounter)) return structuredClone(ideal)
      return withTiers(PREDICT_KEEP_LAYOUTS[testCase.resetLayout(gogmaCounter)], (slot) => gogmaCounter + slot)
    }
    calls.push(`keep:${gogmaCounter}:${keepFamilyLayoutKey(operation.currentBonuses, input.master)}:${stableStringify(operation.currentBonuses)}`)
    if (idealAt.has(gogmaCounter) && isX(operation.currentBonuses)) return structuredClone(ideal)
    return withTiers(operation.currentBonuses.map((bonus) => bonus.bonusTypeId), (slot) => testCase.keepTier(gogmaCounter) + slot)
  }
  const support = engine.getPredictionSupport.bind(engine)
  engine.getPredictionSupport = (request: RngPredictionSupportInput) => support(request)
  engine.advanceGogmaCounter = (counter) => counter + 1
  engine.advanceSkillCounter = (counter) => counter + 1
  return { input, engine, calls, ideal }
}

const BASE: BonusStreamBase = { startGogmaCounter: 10, bonuses: null, restorationBonusScope: 'normal_artian' }
const knownBase = (testCase: PredictKeepCacheCase): BonusStreamBase => ({
  startGogmaCounter: 10,
  bonuses: withTiers(PREDICT_KEEP_LAYOUTS[testCase.owned[0]!.layout], (slot) => testCase.owned[0]!.tier + slot),
  restorationBonusScope: 'gogma_artian',
})

function streamOf(testCase: PredictKeepCacheCase, reserved: boolean) {
  const fixture = predictKeepCacheFixture(testCase)
  const target = fixture.input.targetWeapons[0]!
  const reservation = !reserved || testCase.held === undefined ? EMPTY_COUNTER_RESERVATION : createCounterReservation(testCase.held, testCase.blocked ?? [])
  const depthEvents: ReservedGogmaDepthObservation[] = []
  const runtimeEvents: Array<Pick<ReservedGogmaRuntimeEvent, 'type' | 'streamIndex' | 'depth' | 'counts'>> = []
  const stream = createTargetBonusStream(
    target,
    { rngState: fixture.input.rngState, master: fixture.input.master, maxGogmaAdvance: testCase.extent, reservation },
    fixture.engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(fixture.engine, target, fixture.input.master),
    (event) => { depthEvents.push({ ...event }) },
    (event) => { if (event.type === 'depth_completed') runtimeEvents.push({ type: event.type, streamIndex: event.streamIndex, depth: event.depth, counts: { ...event.counts } }) },
  )
  return { stream, fixture, depthEvents, runtimeEvents }
}

/** The ordinary stream: `readDepth()` from depth 1 until exhausted, for a blind and a known base. */
async function recordOrdinary(testCase: PredictKeepCacheCase) {
  const out: unknown[] = []
  for (const base of [BASE, knownBase(testCase)]) {
    const { stream, fixture } = streamOf(testCase, false)
    const reads: unknown[] = []
    for (let depth = 1; ; depth += 1) {
      const read = await stream.readDepth(base, depth)
      reads.push(JSON.parse(JSON.stringify({ depth, solutions: read.solutions, unsupportedPredictions: read.unsupportedPredictions, exhausted: read.exhausted, steps: read.steps })))
      if (read.exhausted) break
      if (depth > 64) throw new Error(`${testCase.name}: the ordinary stream never became exhausted.`)
    }
    out.push({ base: base.bonuses === null ? 'blind' : 'known', reads, reachesBeyondExtent: stream.reachesBeyondExtent(base), calls: [...fixture.calls] })
  }
  return out
}

/** The held-aware stream: `readReservedDepth()` single-pass, with the observer counts (frontier before / after, generated states, family layouts). */
async function recordReserved(testCase: PredictKeepCacheCase) {
  const out: unknown[] = []
  for (const base of [BASE, knownBase(testCase)]) {
    const { stream, fixture, depthEvents, runtimeEvents } = streamOf(testCase, true)
    const reads: unknown[] = []
    for (let depth = 1; ; depth += 1) {
      const read = await stream.readReservedDepth(base, depth)
      reads.push({ depth, solutions: read.solutions.map(projectReservedBonusSolution), unsupportedPredictions: [...read.unsupportedPredictions], exhausted: read.exhausted })
      if (read.exhausted) break
      if (depth > 64) throw new Error(`${testCase.name}: the held-aware stream never became exhausted.`)
    }
    out.push({ base: base.bonuses === null ? 'blind' : 'known', reads, reachesBeyondExtent: stream.reservedReachesBeyondExtent(base), depthEvents, runtimeEvents,
      calls: [...fixture.calls] })
  }
  return out
}

/** Everything a caller receives, as plain data. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** The bounded ordinary Candidate Search (existing Gogma Routes) over the fixture: the whole result, Candidates in order. */
async function recordCandidateSearch(testCase: PredictKeepCacheCase) {
  const fixture = predictKeepCacheFixture(testCase)
  const result = await searchCandidates(fixture.input, fixture.engine, { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 100 })
  return { result: plain(result), calls: [...fixture.calls] }
}

/** The bounded Planner Alternative Search (the held-aware stream, with and without a reservation) over the fixture. */
async function recordAlternativeSearch(testCase: PredictKeepCacheCase) {
  const out: unknown[] = []
  for (const reserved of [false, true]) {
    const fixture = predictKeepCacheFixture(testCase)
    const input: PlannerAlternativeSearchInput = {
      origin: { rngState: fixture.input.rngState, normalCounters: fixture.input.normalCounters, ownedWeapons: fixture.input.ownedWeapons,
        targetWeapons: fixture.input.targetWeapons, master: fixture.input.master, calculationContext: fixture.input.calculationContext },
      targetWeaponId: fixture.input.targetWeaponId,
      extent: { ...fixture.input.settings },
      reservation: !reserved || testCase.held === undefined ? emptyPlannerAlternativeReservation
        : { ...emptyPlannerAlternativeReservation, gogma: { held: [...testCase.held], blocked: [...(testCase.blocked ?? [])] } },
      excludedRouteKeys: [],
    }
    const candidates: unknown[] = []
    const execution = await visitPlannerAlternativeCandidates(input, fixture.engine, (candidate) => {
      candidates.push(plain(candidate))
      return candidates.length >= 64 ? 'stop' : 'continue'
    })
    out.push({ reserved, candidates, execution: plain(execution), calls: [...fixture.calls] })
  }
  return out
}

export interface PredictKeepCacheRecord {
  name: string
  ordinary: unknown
  reserved: unknown
  candidateSearch: unknown
  alternativeSearch: unknown
}

export async function recordPredictKeepCacheParity(testCase: PredictKeepCacheCase): Promise<PredictKeepCacheRecord> {
  return {
    name: testCase.name,
    ordinary: await recordOrdinary(testCase),
    reserved: await recordReserved(testCase),
    candidateSearch: await recordCandidateSearch(testCase),
    alternativeSearch: await recordAlternativeSearch(testCase),
  }
}
