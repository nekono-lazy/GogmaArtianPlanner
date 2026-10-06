import { candidateStableKey } from '../../domain/search/candidateProcessing'
import { visitPlannerAlternativeCandidates } from '../../domain/search/alternative/plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
} from '../../domain/search/alternative/plannerAlternativeTypes'
import { counters, frontierFixture, originOf, type FrontierFixtureOptions, type FrontierKeepTier } from './plannerAlternativeFrontier'

/*
 * Global Planner Research Phase 2-C2.5-D2-a (Issue #154): the exhaustive
 * synthetic parity grid of the Ideal-only Planner Alternative publication.
 *
 * Each pattern varies where the Ideal Bonus / Skill positions lie, the Keep
 * results, the Route bases and the held / blocked reservation, and runs the
 * complete bounded Planner Alternative frontier. `recordParityPattern()` reduces
 * one run to the Candidate-visible contract: the delivered Route projection,
 * the SHA-256 of the `candidateStableKey` sequence, the summary, the skipped
 * excluded keys and the prediction calls; the same reduction again after
 * excluding one delivered Candidate.
 *
 * The expected records were produced ONCE by this very function on the pre-D2
 * publication (main 83e8975, before the Ideal-only change) and are frozen in
 * `plannerAlternativeIdealPublicationPreD2.json`. A test never regenerates them.
 *
 * Issue #154 (before B2J): the frontier fixture's fake Keep used to change the
 * slot families, which RNG_SPEC 6.1 forbids, and `keepIdealFromPractical()` and
 * the former `current` Keep (now the `low` tier) read the current ranks. The
 * fake Keep now keeps the family layout and rerolls the tiers only, so a Keep
 * reaches the Ideal only from an Ideal-layout state (the Keep of an Ideal Reset
 * result rerolled to the Practical tiers, then to the Ideal ones); the pattern
 * options are otherwise unchanged. The frozen records were re-recorded ONCE by
 * this function with that contract-valid fixture on the same historical
 * publication (main 83e8975, through a temporary worktree), not on the current
 * implementation; see the JSON `provenance`.
 */

export interface ParityPattern {
  name: string
  options: FrontierFixtureOptions
  reservation?: PlannerAlternativeReservation
}

const at = (...positions: number[]) => (counter: number) => positions.includes(counter)
const none = () => false
const all = () => true

function gogmaReservation(held: number[], blocked: number[] = []): PlannerAlternativeReservation {
  return { ...emptyPlannerAlternativeReservation, gogma: { held, blocked } }
}
function skillReservation(held: number[], blocked: number[] = []): PlannerAlternativeReservation {
  return { ...emptyPlannerAlternativeReservation, skill: { held, blocked } }
}

/**
 * A Keep rerolling to the Ideal tier at `positions`: only a state of the Ideal
 * family layout (the Practical-tier Keep of an Ideal Reset result, or an Ideal)
 * reaches the Ideal there; a Practical-only layout keeps its own families
 * (RNG_SPEC 6.1). It never reads the current ranks.
 */
const keepIdealFromPractical = (positions: number[]) =>
  (gogma: number): FrontierKeepTier => (positions.includes(gogma) ? 'ideal' : 'practical')

/**
 * The parity grid. Counters: Normal 4, Skill 7, Gogma 10; extent 4 unless
 * stated. Every pattern keeps at least one non-Ideal position on each axis it
 * reads, so an Ideal-only publication actually drops something.
 */
export const parityPatterns: readonly ParityPattern[] = [
  // Existing Gogma only: Ideal Bonus position patterns (Skill Ideal at 7 / 9).
  ...[[], [10], [11], [13], [10, 11], [11, 13], [10, 12, 13]].map((bonus): ParityPattern => ({
    name: `existing:bonus[${bonus.join(',')}]:skill[7,9]`,
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(...bonus), skillIdealAt: at(7, 9),
    },
  })),
  // Existing Gogma only: Ideal Skill position patterns (Bonus Ideal at 11).
  ...[[], [7], [8], [10], [7, 8], [8, 10], [7, 9, 10]].map((skill): ParityPattern => ({
    name: `existing:bonus[11]:skill[${skill.join(',')}]`,
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(11), skillIdealAt: at(...skill),
    },
  })),
  // Keep reaching the Ideal from Practical slots: same-result later positions
  // through Keep and Reset alike.
  {
    name: 'existing:keep-ideal[12,13]:bonus[10]:skill[8]',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(10), keepResult: keepIdealFromPractical([12, 13]), skillIdealAt: at(8),
    },
  },
  {
    name: 'existing:keep-current:bonus[11,13]:skill[7,10]',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(11, 13), keepResult: () => 'low', skillIdealAt: at(7, 10),
    },
  },
  // Current Ideal axis on one side: only the other axis streams.
  {
    name: 'existing:idealSkill:bonus[10,12]',
    options: { extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }], resetIdealAt: at(10, 12) },
  },
  {
    name: 'existing:idealBonus:skill[8,9]',
    options: { extent: 4, owned: [{ bonuses: 'ideal', idealSkill: false }], resetIdealAt: at(12), skillIdealAt: at(8, 9) },
  },
  // Two owned Gogma sharing one family layout (one Bonus channel).
  {
    name: 'existing-x2:bonus[10,13]:skill[7,9]',
    options: {
      extent: 4,
      owned: [{ bonuses: 'practical', idealSkill: false }, { bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(10, 13), skillIdealAt: at(7, 9),
    },
  },
  // Predicted Normal offsets, late subscribers on shared channels.
  ...[
    { bonus: [10], skill: [8] },
    { bonus: [11, 12], skill: [9] },
    { bonus: [10, 13], skill: [8, 10] },
    { bonus: [], skill: [8] },
    { bonus: [12], skill: [] },
  ].map(({ bonus, skill }): ParityPattern => ({
    name: `normal:bonus[${bonus.join(',')}]:skill[${skill.join(',')}]`,
    options: { extent: 4, normalCounter: true, resetIdealAt: at(...bonus), skillIdealAt: at(...skill) },
  })),
  {
    name: 'normal+existing:keep-ideal[13]:bonus[10,12]:skill[8,10]',
    options: {
      extent: 4, normalCounter: true, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(10, 12), keepResult: keepIdealFromPractical([13]), skillIdealAt: at(8, 10),
    },
  },
  // Blind Normal (no Normal Counter): Reset-first Bonus channel.
  {
    name: 'blind:bonus[11,13]:skill[8,9]',
    options: { extent: 4, resetIdealAt: at(11, 13), skillIdealAt: at(8, 9) },
  },
  // Every position Ideal on one axis, none on the other.
  {
    name: 'existing:bonus[all]:skill[none]',
    options: { extent: 3, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: all, skillIdealAt: none },
  },
  {
    name: 'existing:bonus[all]:skill[all]',
    options: { extent: 3, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: all, skillIdealAt: all },
  },
  // A Bonus stream that ends naturally inside the extent (exhausted).
  {
    name: 'existing:reset-unsupported:keep-unsupported:idealSkill',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }],
      resetSupported: false, keepResult: () => 'low', keepSupportedFor: () => false,
    },
  },
  // Held / blocked reservations: non-contiguous absolute positions.
  {
    name: 'existing:gogma-held[11]:bonus[10,12,13]:skill[7,9]',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(10, 12, 13), skillIdealAt: at(7, 9),
    },
    reservation: gogmaReservation([11]),
  },
  {
    name: 'existing:gogma-held-blocked[12]:bonus[10,12,13]:skill[8]',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(10, 12, 13), skillIdealAt: at(8),
    },
    reservation: gogmaReservation([12], [12]),
  },
  {
    name: 'existing:skill-held[8]:bonus[11]:skill[7,9,10]',
    options: {
      extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }],
      resetIdealAt: at(11), skillIdealAt: at(7, 9, 10),
    },
    reservation: skillReservation([8]),
  },
  {
    name: 'normal:gogma-held[10]:skill-held[9]:bonus[11,12]:skill[8,10]',
    options: { extent: 4, normalCounter: true, resetIdealAt: at(11, 12), skillIdealAt: at(8, 10) },
    reservation: {
      ...emptyPlannerAlternativeReservation,
      gogma: { held: [10], blocked: [] },
      skill: { held: [9], blocked: [] },
    },
  },
]

export interface ParityRunRecord {
  candidateCount: number
  /** Short Route projection of each delivered Candidate, in delivery order. */
  projection: string[]
  /** SHA-256 (hex) of the delivered `candidateStableKey` sequence joined by '\n'. */
  stableKeysSha256: string
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean }
  stoppedByConsumer: boolean
  /** SHA-256 of each skipped excluded key, in skip order. */
  skippedExcludedRouteKeysSha256: string[]
  predictionCounts: Record<'normal' | 'skill' | 'reset' | 'keep', number>
  /** SHA-256 of the complete prediction call sequence joined by '\n'. */
  predictionCallsSha256: string
}

export interface ParityPatternRecord {
  name: string
  full: ParityRunRecord
  /** The same pattern excluding the delivered Candidate at `excludedIndex`; null without Candidates. */
  excluded: { excludedIndex: number; run: ParityRunRecord } | null
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function projectParityCandidate(candidate: PlannerAlternativeCandidate): string {
  const operations = candidate.route.operations
  const bonus = operations.flatMap((operation) =>
    operation.type === 'reset_bonuses' ? [`R${operation.gogmaCounterBefore}`]
      : operation.type === 'keep_bonuses' ? [`K${operation.gogmaCounterBefore}`] : [])
  return [
    candidate.route.kind,
    `n${counters(operations, 'create_normal_artian').join('')}`,
    `c${counters(operations, 'convert_normal_to_gogma').join('')}`,
    `s${candidate.route.sourceOwnedWeaponId ?? '-'}`,
    `B${bonus.join(',')}`,
    `S${counters(operations, 'reset_skills').join(',')}`,
  ].join('|')
}

async function runOnce(pattern: ParityPattern, excludedRouteKeys: readonly string[]) {
  const fixture = frontierFixture(pattern.options)
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates({
    origin: originOf(fixture.input),
    targetWeaponId: fixture.input.targetWeaponId,
    extent: { ...fixture.input.settings },
    reservation: pattern.reservation ?? emptyPlannerAlternativeReservation,
    excludedRouteKeys,
  }, fixture.engine, (candidate) => {
    candidates.push(candidate)
    return 'continue'
  })
  const keys = candidates.map(candidateStableKey)
  const count = (prefix: string) => fixture.calls.filter((call) => call.startsWith(prefix)).length
  const record: ParityRunRecord = {
    candidateCount: candidates.length,
    projection: candidates.map(projectParityCandidate),
    stableKeysSha256: await sha256Hex(keys.join('\n')),
    summary: { ...execution.summary },
    stoppedByConsumer: execution.stoppedByConsumer,
    skippedExcludedRouteKeysSha256: await Promise.all(execution.skippedExcludedRouteKeys.map(sha256Hex)),
    predictionCounts: { normal: count('normal:'), skill: count('skill:'), reset: count('reset:'), keep: count('keep:') },
    predictionCallsSha256: await sha256Hex(fixture.calls.join('\n')),
  }
  return { record, keys }
}

/**
 * Runs one pattern completely, then again excluding the delivered Candidate in
 * the middle of the sequence. The excluded key is taken from the first run; a
 * test compares the first run with the frozen pre-D2 record before trusting it.
 */
export async function recordParityPattern(pattern: ParityPattern): Promise<ParityPatternRecord> {
  const full = await runOnce(pattern, [])
  if (full.keys.length === 0) return { name: pattern.name, full: full.record, excluded: null }
  const excludedIndex = Math.floor(full.keys.length / 2)
  const excluded = await runOnce(pattern, [full.keys[excludedIndex]])
  return { name: pattern.name, full: full.record, excluded: { excludedIndex, run: excluded.record } }
}
