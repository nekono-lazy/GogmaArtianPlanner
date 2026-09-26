import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../../test/fixtures/candidateSearch'
import { ownedWeaponId } from '../../../test/fixtures/domainData'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../../models/publicTypes'
import { keepFamilyLayoutKey } from '../../rng/gogmaBonusFamily'
import type { RngEngine } from '../../rng/rngEngine'
import { candidateStableKey } from '../candidateProcessing'
import { createCandidateRouteEstimates } from '../candidateFactory'
import { searchCandidates } from '../candidateSearch'
import { createCounterReservation, heldPrefixNormalCreation } from '../counterReservation'
import type { CandidateSearchInput } from '../searchTypes'
import {
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchExecutionOptions,
} from './plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchInput,
} from './plannerAlternativeTypes'
import { normalizePlannerAlternativeReservation } from './plannerAlternativeValidation'

/*
 * Phase 2 of SEARCH_SPEC 5.6.8 / 13.2.6: Planner Alternative Search under a
 * resource reservation. Fixture Counters: Normal 4 (`weapon.fixture.a:8`),
 * Skill 7, Gogma 10; every advance is +1 (+count for a Normal creation).
 */

const IDEAL_SERIES = 'series_skill.fixture.a'
const NORMAL_COUNTER_ID = 'weapon.fixture.a:8'

interface Options {
  extent?: number
  owned?: Array<{ bonuses: 'ideal' | 'practical'; idealSkill: boolean }>
  ownedNormal?: boolean
  normalCounter?: boolean
  resetIdealAt?: (gogmaCounter: number) => boolean
  keepResult?: (gogmaCounter: number, current: RestorationBonusSet) => 'ideal' | 'practical' | 'current'
  skillIdealAt?: (skillCounter: number) => boolean
}

function fixture(options: Options = {}) {
  const extent = options.extent ?? 5
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: extent, maxGogmaAdvance: extent, maxSkillAdvance: extent }
  const ideal = structuredClone(input.targetWeapons[0].idealBonuses)
  const template = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  input.ownedWeapons = (options.owned ?? []).map((owned, index): OwnedGogmaArtianWeapon => ({
    ...structuredClone(template),
    id: ownedWeaponId(`owned.fixture.${index}`),
    restorationBonuses: owned.bonuses === 'ideal' ? structuredClone(ideal) : practicalOnlyBonuses(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: owned.idealSkill ? IDEAL_SERIES : 'series.other',
    groupSkillId: null,
    isProtected: false,
  }))
  if (options.ownedNormal) {
    const normal: OwnedNormalArtianWeapon = {
      id: ownedWeaponId('owned.fixture.normal'),
      kind: 'normal',
      name: 'owned normal',
      weaponTypeId: template.weaponTypeId,
      elementId: template.elementId,
      rarity: 8,
      restorationBonuses: practicalOnlyBonuses(),
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
      executionInProgress: null,
      memo: null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    } as OwnedNormalArtianWeapon
    input.ownedWeapons.push(normal)
  }
  if (!options.normalCounter) input.normalCounters = []
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  const skillIdealAt = options.skillIdealAt ?? (() => false)
  const resetIdealAt = options.resetIdealAt ?? (() => false)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: skillIdealAt(skillCounter) ? IDEAL_SERIES : 'series.other.' + skillCounter, groupSkillId: null }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      calls.push('reset:' + gogmaCounter)
      return resetIdealAt(gogmaCounter) ? structuredClone(ideal) : practicalOnlyBonuses()
    }
    calls.push('keep:' + gogmaCounter + ':' + keepFamilyLayoutKey(operation.currentBonuses, input.master))
    const result = options.keepResult?.(gogmaCounter, operation.currentBonuses) ?? 'practical'
    return result === 'ideal' ? structuredClone(ideal)
      : result === 'current' ? structuredClone(operation.currentBonuses) : practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls, ideal }
}

function reservation(parts: Partial<PlannerAlternativeReservation>): PlannerAlternativeReservation {
  return { ...emptyPlannerAlternativeReservation, ...parts }
}

function alternativeInput(
  input: CandidateSearchInput,
  reserved: PlannerAlternativeReservation,
  excludedRouteKeys: string[] = [],
): PlannerAlternativeSearchInput {
  return {
    origin: {
      rngState: input.rngState,
      normalCounters: input.normalCounters,
      ownedWeapons: input.ownedWeapons,
      targetWeapons: input.targetWeapons,
      master: input.master,
      calculationContext: input.calculationContext,
    },
    targetWeaponId: input.targetWeaponId,
    extent: { ...input.settings },
    reservation: reserved,
    excludedRouteKeys,
  }
}

async function collect(
  input: CandidateSearchInput,
  engine: RngEngine,
  reserved: PlannerAlternativeReservation,
  options: PlannerAlternativeSearchExecutionOptions = {},
  limit = Infinity,
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(alternativeInput(input, reserved), engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  }, options)
  return { candidates, execution }
}

function positionsOf(operations: readonly RouteOperation[], stream: 'skill' | 'gogma'): number[] {
  return operations.flatMap((operation) => {
    if (stream === 'skill' && (operation.type === 'convert_normal_to_gogma' || operation.type === 'reset_skills')) {
      return [operation.skillCounterBefore]
    }
    if (stream === 'gogma' && (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses')) {
      return [operation.gogmaCounterBefore]
    }
    return []
  })
}

function conversionOf(candidate: PlannerAlternativeCandidate): number | null {
  const conversion = candidate.route.operations.find((operation) => operation.type === 'convert_normal_to_gogma')
  return conversion?.type === 'convert_normal_to_gogma' ? conversion.skillCounterBefore : null
}

function creationOf(candidate: PlannerAlternativeCandidate) {
  const creation = candidate.route.operations.find((operation) => operation.type === 'create_normal_artian')
  return creation?.type === 'create_normal_artian'
    ? { before: creation.normalCounterBefore, after: creation.normalCounterAfter, count: creation.count }
    : null
}

/** SEARCH_SPEC 5.6.8 coverage: origin .. last own operation is own or held, never an own operation at a blocked position. */
function expectCoverage(
  candidate: PlannerAlternativeCandidate,
  stream: 'skill' | 'gogma',
  origin: number,
  held: readonly number[],
  blocked: readonly number[],
): void {
  const own = positionsOf(candidate.route.operations, stream)
  own.forEach((position) => expect(blocked).not.toContain(position))
  if (own.length === 0) return
  for (let position = origin; position <= own[own.length - 1]; position += 1) {
    expect(own.includes(position) || held.includes(position)).toBe(true)
  }
}

function estimatesOf(estimates: ReturnType<typeof createCandidateRouteEstimates>) {
  return {
    estimatedOperationCount: estimates.estimatedOperationCount,
    estimatedGogmaAdvance: estimates.estimatedGogmaAdvance,
    estimatedSkillAdvance: estimates.estimatedSkillAdvance,
    estimatedNormalAdvance: estimates.estimatedNormalAdvance,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Normal held-prefix canonical creation (PLANNER_SPEC 9.2.19.4)', () => {
  const issue101 = createCounterReservation(Array.from({ length: 207 }, (_, index) => index), [206])

  it('forges one weapon at the origin under the Issue #101 reservation (held 0..206, blocked 206, target 0)', () => {
    expect(heldPrefixNormalCreation(issue101, 0, 0))
      .toEqual({ normalCounterBefore: 0, normalCounterAfter: 1, count: 1 })
  })

  it('skips the origin-contiguous held prefix before the target (held 0..4, target 10)', () => {
    const held = createCounterReservation([0, 1, 2, 3, 4], [])
    expect(heldPrefixNormalCreation(held, 0, 10))
      .toEqual({ normalCounterBefore: 5, normalCounterAfter: 11, count: 6 })
  })

  it('never lets held positions at or after the target extend the prefix', () => {
    const before = createCounterReservation([0, 1, 2, 3, 4], [])
    const after = createCounterReservation([0, 1, 2, 3, 4, 10, 11, 12], [11])
    expect(heldPrefixNormalCreation(after, 0, 10)).toEqual(heldPrefixNormalCreation(before, 0, 10))
    expect(heldPrefixNormalCreation(createCounterReservation([10], []), 0, 10))
      .toEqual({ normalCounterBefore: 0, normalCounterAfter: 11, count: 11 })
  })

  it('is the ordinary origin / target + 1 creation without held positions', () => {
    expect(heldPrefixNormalCreation(createCounterReservation([], []), 4, 7))
      .toEqual({ normalCounterBefore: 4, normalCounterAfter: 8, count: 4 })
  })

  it('searches the canonical creations, skips a blocked production target and lets advance forges cross it', async () => {
    const { input, engine } = fixture({ normalCounter: true, resetIdealAt: (gogma) => gogma === 10, skillIdealAt: () => true, extent: 7 })
    // Origin 4: held 4..5 prefix, a separate held + blocked 8.
    const reserved = reservation({ normal: [{ counterId: NORMAL_COUNTER_ID, held: [4, 5, 8], blocked: [8] }] })
    const { candidates } = await collect(input, engine, reserved)
    const creations = candidates
      .filter((candidate) => candidate.route.kind === 'normal_artian_to_gogma')
      .map(creationOf)
    const unique = [...new Map(creations.map((creation) => [JSON.stringify(creation), creation])).values()]
    expect(unique).toEqual([
      { before: 4, after: 5, count: 1 },
      { before: 5, after: 6, count: 1 },
      { before: 6, after: 7, count: 1 },
      { before: 6, after: 8, count: 2 },
      // Target 8 is blocked; target 9 forges 6..9, crossing the blocked 8.
      { before: 6, after: 10, count: 4 },
      { before: 6, after: 11, count: 5 },
    ])
    expect(creations.some((creation) => creation?.after === 9)).toBe(false)
  })
})

describe('no #104 reduction under a blocked origin target (SEARCH_SPEC 5.6.8 / 6.1.2)', () => {
  it('returns later Normal production targets when offset 0 is a fixed production target', async () => {
    const { input, engine, calls } = fixture({ normalCounter: true, resetIdealAt: (gogma) => gogma === 10, skillIdealAt: () => true, extent: 3 })
    const { candidates } = await collect(input, engine, reservation({ normal: [{ counterId: NORMAL_COUNTER_ID, held: [4], blocked: [4] }] }))
    const creations = candidates.filter((candidate) => candidate.route.kind === 'normal_artian_to_gogma').map(creationOf)
    expect(new Set(creations.map((creation) => JSON.stringify(creation)))).toEqual(new Set([
      JSON.stringify({ before: 5, after: 6, count: 1 }),
      JSON.stringify({ before: 5, after: 7, count: 2 }),
    ]))
    // The blocked target 4 is never even predicted.
    expect(calls).not.toContain('normal:4')
  })
})

describe('held Skill traversal (SEARCH_SPEC 5.6.8)', () => {
  it('converts right after a held and blocked origin (Skill 7), never at it', async () => {
    const { input, engine } = fixture({ normalCounter: true, ownedNormal: true, resetIdealAt: (gogma) => gogma === 10, skillIdealAt: () => true })
    const reserved = reservation({ skill: { held: [7], blocked: [7] } })
    const { candidates } = await collect(input, engine, reserved)
    const conversions = candidates.filter((candidate) => conversionOf(candidate) !== null)
    expect(conversions.length).toBeGreaterThan(0)
    expect(new Set(conversions.map(conversionOf))).toEqual(new Set([8]))
    expect(new Set(conversions.map((candidate) => candidate.route.kind)))
      .toEqual(new Set(['normal_artian_to_gogma', 'owned_normal_artian_to_gogma']))
    // One conversion operation, reaching Skill 9 from the origin 7.
    conversions.forEach((candidate) => {
      expect(candidate.route.operations.filter(({ type }) => type === 'reset_skills')).toHaveLength(0)
      expect(candidate.estimatedSkillAdvance).toBe(2)
      expectCoverage(candidate, 'skill', 7, [7], [7])
    })
  })

  it('may operate on or skip a held position that is not blocked', async () => {
    const { input, engine } = fixture({ normalCounter: true, resetIdealAt: (gogma) => gogma === 10, skillIdealAt: () => true })
    const { candidates } = await collect(input, engine, reservation({ skill: { held: [7], blocked: [] } }))
    expect(new Set(candidates.map(conversionOf))).toEqual(new Set([7, 8]))
  })

  it('skips held Reset Skills positions without predicting, operating or changing the Skills', async () => {
    const { input, engine, calls } = fixture({ owned: [{ bonuses: 'ideal', idealSkill: false }], skillIdealAt: (skill) => skill === 7 || skill === 10 })
    // Held and blocked 8..9: the Skill reached at 7 waits unchanged across them.
    const reserved = reservation({ skill: { held: [8, 9], blocked: [8, 9] } })
    const { candidates } = await collect(input, engine, reserved)
    const resets = candidates.map((candidate) => positionsOf(candidate.route.operations, 'skill'))
    expect(resets).toEqual([[7], [7, 10]])
    candidates.forEach((candidate) => expectCoverage(candidate, 'skill', 7, [8, 9], [8, 9]))
    // Two own Reset Skills reaching Skill 11: reach 4, operation count 2.
    expect(candidates[1].estimatedOperationCount).toBe(2)
    expect(candidates[1].estimatedSkillAdvance).toBe(4)
    expect(candidates[1].skillAmendmentTrace.map(({ operationIndex, seriesSkillId }) => [operationIndex, seriesSkillId]))
      .toEqual([[0, IDEAL_SERIES], [1, IDEAL_SERIES]])
    expect(calls.filter((call) => call === 'skill:8' || call === 'skill:9')).toEqual([])
  })
})

describe('held Gogma traversal (SEARCH_SPEC 5.6.8)', () => {
  it('starts the Bonus stream after a held and blocked origin (Gogma 10)', async () => {
    const { input, engine } = fixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      normalCounter: true,
      resetIdealAt: (gogma) => gogma === 10 || gogma === 12,
      skillIdealAt: () => true,
    })
    const reserved = reservation({ gogma: { held: [10], blocked: [10] } })
    const { candidates } = await collect(input, engine, reserved)
    expect(candidates.length).toBeGreaterThan(0)
    candidates.forEach((candidate) => {
      const own = positionsOf(candidate.route.operations, 'gogma')
      if (own.length > 0) expect(own[0]).toBeGreaterThanOrEqual(11)
      expectCoverage(candidate, 'gogma', 10, [10], [10])
    })
    const existing = candidates.find((candidate) => candidate.route.kind === 'existing_gogma_reset_bonuses')
    expect(existing && positionsOf(existing.route.operations, 'gogma')).toEqual([11, 12])
    // Two own Reset Bonuses reaching Gogma 13 from 10.
    expect(existing?.estimatedOperationCount).toBe(2)
    expect(existing?.estimatedGogmaAdvance).toBe(3)
  })

  it('keeps the Bonus state across a held skip and memoizes Reset per position and Keep per (position, layout)', async () => {
    const { input, engine, calls } = fixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      // Keep at 12 turns the Gogma Reset result of 10 Ideal.
      keepResult: (gogma) => (gogma === 12 ? 'ideal' : 'practical'),
    })
    const reserved = reservation({ gogma: { held: [11], blocked: [] } })
    const { candidates } = await collect(input, engine, reserved)
    const byPositions = candidates.map((candidate) => [
      candidate.route.operations.map(({ type }) => type),
      positionsOf(candidate.route.operations, 'gogma'),
    ])
    // Reset at 10, skip the held 11, Keep at 12 - the skipped position leaves the state unchanged.
    expect(byPositions).toContainEqual([['reset_bonuses', 'keep_bonuses'], [10, 12]])
    // Operating at the held 11 is explored too.
    expect(byPositions.some(([, positions]) => JSON.stringify(positions) === JSON.stringify([10, 11, 12]))).toBe(true)
    const skipped = candidates.find((candidate) => JSON.stringify(positionsOf(candidate.route.operations, 'gogma')) === '[10,12]')!
    expect(skipped.bonusAmendmentTrace.map(({ operationIndex }) => operationIndex)).toEqual([0, 1])
    expect(skipped.estimatedGogmaAdvance).toBe(3)
    expect(skipped.estimatedOperationCount).toBe(2)
    // Every prediction key at most once: position for Reset, (position, layout) for Keep.
    const gogmaCalls = calls.filter((call) => call.startsWith('reset:') || call.startsWith('keep:'))
    expect(new Set(gogmaCalls).size).toBe(gogmaCalls.length)
  })

  it('never merges states of one family layout that stand at different positions', async () => {
    const { input, engine } = fixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetIdealAt: (gogma) => gogma === 13,
    })
    const reserved = reservation({ gogma: { held: [11], blocked: [] } })
    const { candidates } = await collect(input, engine, reserved)
    // Both depth-2 routes (10, 11) and (10, 12) keep their own futures: Reset 13 follows either.
    const resets = candidates
      .filter((candidate) => candidate.route.kind === 'existing_gogma_reset_bonuses')
      .map((candidate) => positionsOf(candidate.route.operations, 'gogma'))
    expect(resets).toContainEqual([10, 12, 13])
    expect(resets).toContainEqual([10, 11, 12, 13])
  })
})

describe('exclusive OwnedWeapons (PLANNER_SPEC 9.2.19.3)', () => {
  it('never uses an exclusive owned Gogma or owned Normal as a source, even when the Target prefers it', async () => {
    const { input, engine } = fixture({
      owned: [{ bonuses: 'ideal', idealSkill: true }, { bonuses: 'practical', idealSkill: true }],
      ownedNormal: true,
      resetIdealAt: () => true,
    })
    input.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.0')
    const reserved = reservation({ exclusiveOwnedWeaponIds: [ownedWeaponId('owned.fixture.0'), ownedWeaponId('owned.fixture.normal')] })
    const { candidates } = await collect(input, engine, reserved)
    const sources = new Set(candidates.map((candidate) => candidate.route.sourceOwnedWeaponId))
    expect(sources.has(ownedWeaponId('owned.fixture.0'))).toBe(false)
    expect(sources.has(ownedWeaponId('owned.fixture.normal'))).toBe(false)
    expect(sources.has(ownedWeaponId('owned.fixture.1'))).toBe(true)
    candidates.forEach((candidate) => candidate.route.operations.forEach((operation) => {
      if ('sourceOwnedWeaponId' in operation) expect(operation.sourceOwnedWeaponId).not.toBe('owned.fixture.0')
    }))
  })
})

describe('blind Normal variant under a reservation (SEARCH_SPEC 6.1.1)', () => {
  it('stays count 1 with no Normal Counter position, one base per conversion position', async () => {
    const { input, engine } = fixture({ resetIdealAt: (gogma) => gogma === 10, skillIdealAt: () => true })
    const reserved = reservation({
      skill: { held: [7], blocked: [] },
      normal: [{ counterId: NORMAL_COUNTER_ID, held: [4, 5], blocked: [5] }],
    })
    const { candidates } = await collect(input, engine, reserved)
    const blind = candidates.filter((candidate) => candidate.route.kind === 'normal_artian_to_gogma')
    expect(blind.map(creationOf)).toEqual([
      { before: null, after: null, count: 1 },
      { before: null, after: null, count: 1 },
    ])
    expect(blind.map(conversionOf)).toEqual([7, 8])
    expect(blind.every((candidate) => candidate.estimatedNormalAdvance === null)).toBe(true)
  })
})

describe('zero Ideal lane (SEARCH_SPEC 5.6.8)', () => {
  it('searches no Reset Skills position for a lane whose starting Skills are already Ideal', async () => {
    const { input, engine, calls } = fixture({
      owned: [{ bonuses: 'practical', idealSkill: true }],
      resetIdealAt: (gogma) => gogma === 12,
      skillIdealAt: () => true,
    })
    const { candidates } = await collect(input, engine, reservation({ skill: { held: [7, 8], blocked: [8] }, gogma: { held: [11], blocked: [] } }))
    // Only the blind conversions' own positions (7, and 9 after the blocked 8) are predicted:
    // neither the existing Gogma's nor a conversion's Ideal Skill opens a Reset Skills stream.
    expect(calls.filter((call) => call.startsWith('skill:'))).toEqual(['skill:7', 'skill:9'])
    expect(candidates.some((candidate) => candidate.route.operations.some(({ type }) => type === 'reset_skills'))).toBe(false)
  })
})

describe('determinism and extent under a reservation', () => {
  it('returns the same stable key sequence whatever the reservation array order and duplicates', async () => {
    const options: Options = { owned: [{ bonuses: 'practical', idealSkill: false }], normalCounter: true, resetIdealAt: (gogma) => gogma % 2 === 0, skillIdealAt: (skill) => skill % 2 === 0 }
    const one = fixture(options)
    const first = await collect(one.input, one.engine, reservation({
      normal: [{ counterId: NORMAL_COUNTER_ID, held: [4, 5], blocked: [5] }],
      skill: { held: [7, 9], blocked: [9] },
      gogma: { held: [11, 12], blocked: [12] },
    }))
    const two = fixture(options)
    const second = await collect(two.input, two.engine, reservation({
      normal: [{ counterId: NORMAL_COUNTER_ID, held: [5, 4, 5], blocked: [5, 5] }],
      skill: { held: [9, 7, 9], blocked: [9] },
      gogma: { held: [12, 11], blocked: [12, 12] },
    }))
    expect(second.candidates.map(candidateStableKey)).toEqual(first.candidates.map(candidateStableKey))
    expect(normalizePlannerAlternativeReservation(reservation({ gogma: { held: [12, 11, 12], blocked: [12] } })))
      .toEqual(reservation({ gogma: { held: [11, 12], blocked: [12] } }))
  })

  it('reports a held Skill run the Skill window cuts as stopped by extent', async () => {
    const { input, engine } = fixture({ normalCounter: true, extent: 2, resetIdealAt: () => true, skillIdealAt: () => true })
    // Held 7..9 and blocked 7..8: the conversion could stand at 9 or 10, beyond origin + 2.
    const { execution } = await collect(input, engine, reservation({ skill: { held: [7, 8, 9], blocked: [7, 8] } }))
    expect(execution.summary.stoppedByExtent).toBe(true)
    expect(execution.summary.exhausted).toBe(false)
  })

  it('stays cancellable and yields while walking a long held run', async () => {
    const { input, engine } = fixture({ owned: [{ bonuses: 'practical', idealSkill: true }], extent: 3000, resetIdealAt: (gogma) => gogma === 2900 })
    const held = Array.from({ length: 2800 }, (_, index) => 10 + index)
    const yieldControl = vi.fn(async () => undefined)
    let checkpoints = 0
    await expect(collect(input, engine, reservation({ gogma: { held, blocked: held } }), {
      yieldControl,
      shouldCancel: () => ++checkpoints > 400,
    })).rejects.toMatchObject({ code: 'cancelled' })
    expect(yieldControl).toHaveBeenCalled()
  })
})

describe('reach estimates (SEARCH_SPEC 3.1 / 5.6.8)', () => {
  it('equal the operation sum for every origin-continuous ordinary Candidate', async () => {
    const { input, engine } = fixture({ owned: [{ bonuses: 'practical', idealSkill: false }], normalCounter: true, resetIdealAt: (gogma) => gogma === 11, skillIdealAt: (skill) => skill === 9 })
    const result = await searchCandidates(input, engine, { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 })
    const candidate = result.targetResult.candidate!
    const origin = {
      gogmaCounter: input.rngState.gogmaCounter.value,
      skillCounter: input.rngState.skillCounter.value,
      normalCounters: input.normalCounters,
    }
    const withOrigin = estimatesOf(createCandidateRouteEstimates(candidate.route, candidate.targetWeaponId, input, origin))
    expect(withOrigin).toEqual({
      estimatedOperationCount: candidate.estimatedOperationCount,
      estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
      estimatedSkillAdvance: candidate.estimatedSkillAdvance,
      estimatedNormalAdvance: candidate.estimatedNormalAdvance,
    })
  })

  it('equal the ordinary estimates for every Planner Alternative Candidate of an empty reservation', async () => {
    const { input, engine } = fixture({ owned: [{ bonuses: 'practical', idealSkill: false }], normalCounter: true, resetIdealAt: (gogma) => gogma === 11, skillIdealAt: (skill) => skill === 9 })
    const { candidates } = await collect(input, engine, emptyPlannerAlternativeReservation)
    expect(candidates.length).toBeGreaterThan(0)
    candidates.forEach((candidate) => {
      const sum = estimatesOf(createCandidateRouteEstimates(candidate.route, candidate.targetWeaponId, input))
      expect({
        estimatedOperationCount: candidate.estimatedOperationCount,
        estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
        estimatedSkillAdvance: candidate.estimatedSkillAdvance,
        estimatedNormalAdvance: candidate.estimatedNormalAdvance,
      }).toEqual(sum)
    })
  })
})
