import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { practicalOnlyBonuses } from '../../../test/fixtures/candidateSearch'
import { keepCompatiblePracticalBonuses, originOf } from '../../../test/fixtures/plannerAlternativeFrontier'
import { seamFixture, slotsText, type SeamFixture, type SeamFixtureOptions } from '../../../test/fixtures/shapeConstrainedSeamFixture'
import { projectSeamCandidate } from '../../../test/fixtures/shapeConstrainedSeamProductionGolden'
import type { OwnedWeaponId, RouteOperation } from '../../models/publicTypes'
import { satisfiesIdealTarget } from '../../target'
import {
  createPlannerAlternativeFrontier,
  PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS,
  visitPlannerAlternativeCandidates,
} from '../alternative/plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
} from '../alternative/plannerAlternativeTypes'
import { candidateStableKey } from '../candidateProcessing'
import { heldPrefixNormalCreation, createCounterReservation } from '../counterReservation'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import { CandidateSearchError } from '../searchTypes'
import type { SearchRuntimeEvent } from '../searchRuntime'
import { TargetSearchScheduler, type ScheduledRouteBase } from '../targetSearchScheduler'
import { visitShapeConstrainedRouteCandidates } from './shapeConstrainedSearch'
import {
  ShapeConstrainedSearchError,
  type RouteShapeConstraint,
  type ShapeConstrainedSearchExecution,
  type ShapeConstrainedSearchInput,
} from './shapeConstrainedTypes'

/*
 * Issue #154 Global Assignment Phase D-0A-2a (`docs/SEARCH_SPEC.md` 5.6.9, `docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md`
 * 5.3 / 6 / 7 / 15): the Research-only shape-constrained Route search. Fixture Counters: Normal 4, Skill 7, Gogma 10,
 * every advance +1; Ideal Skill = `series_skill.fixture.a`; layout L = the Ideal's families, layout P = Practical-only.
 *
 * The three Route search primitives are wrapped (same behavior) so a test can see which ones ran.
 */

vi.mock('../existingGogmaRouteSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../existingGogmaRouteSearch')>()
  return { ...actual, searchExistingGogmaRoutes: vi.fn(actual.searchExistingGogmaRoutes) }
})
vi.mock('../ownedNormalArtianRouteSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ownedNormalArtianRouteSearch')>()
  return { ...actual, searchOwnedNormalArtianRoutes: vi.fn(actual.searchOwnedNormalArtianRoutes) }
})
vi.mock('../normalArtianRouteSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../normalArtianRouteSearch')>()
  return { ...actual, searchNormalArtianRoutes: vi.fn(actual.searchNormalArtianRoutes) }
})

const primitives = {
  existing_gogma: vi.mocked(searchExistingGogmaRoutes),
  owned_normal: vi.mocked(searchOwnedNormalArtianRoutes),
  new_normal: vi.mocked(searchNormalArtianRoutes),
}

const clearStarted = () => Object.values(primitives).forEach((primitive) => primitive.mockClear())
beforeEach(clearStarted)
afterEach(() => vi.restoreAllMocks())

const at = (...positions: number[]) => (counter: number) => positions.includes(counter)
const owned = (id: string) => id as OwnedWeaponId
const COUNTER = 'weapon.fixture.a:8'

function shapeInput(
  fixture: SeamFixture,
  shape: RouteShapeConstraint,
  reservation: Partial<PlannerAlternativeReservation> = {},
): ShapeConstrainedSearchInput {
  return {
    origin: originOf(fixture.input),
    targetWeaponId: fixture.input.targetWeaponId,
    extent: { ...fixture.input.settings },
    reservation: { ...emptyPlannerAlternativeReservation, ...reservation },
    shape,
  }
}

async function collectShape(
  fixture: SeamFixture,
  shape: RouteShapeConstraint,
  reservation: Partial<PlannerAlternativeReservation> = {},
  options: Parameters<typeof visitShapeConstrainedRouteCandidates>[3] = {},
  limit = Infinity,
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitShapeConstrainedRouteCandidates(shapeInput(fixture, shape, reservation), fixture.engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  }, options)
  return { candidates, execution }
}

async function collectAlternative(fixture: SeamFixture, reservation: Partial<PlannerAlternativeReservation> = {}) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates({
    origin: originOf(fixture.input),
    targetWeaponId: fixture.input.targetWeaponId,
    extent: { ...fixture.input.settings },
    reservation: { ...emptyPlannerAlternativeReservation, ...reservation },
    excludedRouteKeys: [],
  }, fixture.engine, (candidate) => {
    candidates.push(candidate)
    return 'continue'
  })
  return { candidates, execution }
}

/** Records every Route base registered while `run` executes. */
async function recordBases<T>(run: () => Promise<T>) {
  const bases: ScheduledRouteBase[] = []
  const original = TargetSearchScheduler.prototype.addBase
  const spy = vi.spyOn(TargetSearchScheduler.prototype, 'addBase').mockImplementation(function (this: TargetSearchScheduler, base) {
    bases.push(base)
    return original.call(this, base)
  })
  try {
    return { value: await run(), bases }
  } finally {
    spy.mockRestore()
  }
}

const started = () => Object.entries(primitives).filter(([, primitive]) => primitive.mock.calls.length > 0).map(([kind]) => kind)
const ops = (candidate: PlannerAlternativeCandidate) => projectSeamCandidate(candidate).split('|')[2]

const unavailable = (execution: ShapeConstrainedSearchExecution) => execution.base.unavailable

function expectUnavailable(execution: ShapeConstrainedSearchExecution, fixture: SeamFixture) {
  expect(execution).toMatchObject({
    summary: { deliveredCandidates: 0, exhausted: false, stoppedByExtent: false },
    stoppedByConsumer: false,
    base: { admitted: false },
    requiredUnsupportedPredictions: [],
    forbiddenOperationNotices: 0,
  })
  expect(started()).toEqual([])
  expect(fixture.calls).toEqual([])
}

// ---------------------------------------------------------------- early Route base constraints (15 "早期制約")

describe('early Route base constraints: before any Route base is generated', () => {
  it('runs only the shape\'s Route search primitive for each base kind', async () => {
    const options: SeamFixtureOptions = { extent: 3, normalCounter: true, owned: [{ bonuses: 'practical', idealSkill: true }], ownedNormals: [{}],
      resetIdealAt: at(10) }
    const cases: Array<[keyof typeof primitives, RouteShapeConstraint]> = [
      ['existing_gogma', { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }],
      ['owned_normal', { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }],
      ['new_normal', { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }],
    ]
    for (const [kind, shape] of cases) {
      clearStarted()
      const fixture = seamFixture(options)
      const runtime: SearchRuntimeEvent[] = []
      await collectShape(fixture, shape, {}, { instrumentation: { onSearchRuntime: (event) => { runtime.push(event) } } })
      expect(started(), kind).toEqual([kind])
      // The predicted Normal is predicted only by the new-Normal shape.
      expect(fixture.calls.some((call) => call.startsWith('normal:')), kind).toBe(kind === 'new_normal')
      const registrations = runtime.filter((event) => event.type === 'section_started' && event.section.endsWith('_route_registration'))
      expect(registrations, kind).toHaveLength(1)
    }
  })

  it('owned_normal: registers only the shape\'s OwnedWeapon and predicts only its conversion Skill', async () => {
    const fixture = seamFixture({ extent: 3, ownedNormals: [{}, {}, {}], resetIdealAt: at(10), skillIdealAt: at(7) })
    const { value: { candidates }, bases } = await recordBases(() => collectShape(fixture,
      { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.1'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }))
    expect(bases.map((base) => base.sourceOwnedWeaponId)).toEqual(['owned.normal.1'])
    expect(fixture.calls.filter((call) => call.startsWith('skill:'))).toEqual(['skill:7'])
    expect(candidates.map(ops)).toEqual(['c7,R10'])
  })

  it('new_normal: predicts the Normal at the production target only, never another offset, and registers no blind base', async () => {
    const fixture = seamFixture({ extent: { normal: 4, gogma: 3, skill: 3 }, normalCounter: true, resetIdealAt: at(10), skillIdealAt: at(7) })
    const { value: { candidates }, bases } = await recordBases(() => collectShape(fixture,
      { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 6, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }))
    expect(fixture.calls.filter((call) => call.startsWith('normal:'))).toEqual(['normal:6'])
    expect(bases).toHaveLength(1)
    expect(candidates.map(ops)).toEqual(['n3@4-7,c7,R10'])
  })

  it('new_normal: the constrained Normal primitive never stands in the blind variant for a shape it cannot predict', async () => {
    // Driven directly on the shared frontier: the seam's own base diagnosis would stop before the primitive.
    const run = async (constrained: boolean) => {
      const fixture = seamFixture({ extent: 3, normalCounter: true, normalSupported: false, resetIdealAt: at(10), skillIdealAt: at(7) })
      const target = fixture.input.targetWeapons[0]
      const frontier = createPlannerAlternativeFrontier({
        target, reservation: emptyPlannerAlternativeReservation, origin: originOf(fixture.input), extent: { ...fixture.input.settings }, engine: fixture.engine, options: {},
        ...(constrained ? { routeBaseConstraint: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7,
          lanes: { skillStream: false, bonusOperations: 'reset' } } } as const : {}),
      })
      return recordBases(() => frontier.run({ onCandidate: () => 'continue', excludedRouteKeys: [],
        registrations: PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS.filter(([section]) => section === 'normal_route_registration') }))
    }
    const unconstrained = await run(false)
    expect(unconstrained.bases.map((base) => base.baseOperations[0])).toEqual([expect.objectContaining({ type: 'create_normal_artian', normalCounterBefore: null })])
    const constrained = await run(true)
    expect(constrained.bases).toEqual([])
    expect(constrained.value.summary.deliveredCandidates).toBe(0)
  })

  it('new_normal: builds the creation with heldPrefixNormalCreation() and never stands on a blocked production target', async () => {
    const reservation = { normal: [{ counterId: COUNTER, held: [4, 5], blocked: [5] }] }
    const fixture = seamFixture({ extent: { normal: 4, gogma: 3, skill: 3 }, normalCounter: true, resetIdealAt: at(10), skillIdealAt: at(7) })
    const { candidates } = await collectShape(fixture,
      { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 6, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }, reservation)
    const creation = heldPrefixNormalCreation(createCounterReservation([4, 5], [5]), 4, 6)
    expect(creation).toEqual({ normalCounterBefore: 6, normalCounterAfter: 7, count: 1 })
    expect(candidates[0].route.operations[0]).toMatchObject({ type: 'create_normal_artian', count: 1, normalCounterBefore: 6, normalCounterAfter: 7 })

    const blocked = seamFixture({ extent: { normal: 4, gogma: 3, skill: 3 }, normalCounter: true, resetIdealAt: at(10) })
    clearStarted()
    const { execution } = await collectShape(blocked,
      { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 5, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }, reservation)
    expect(unavailable(execution)).toEqual({ kind: 'production_target_blocked' })
    expectUnavailable(execution, blocked)
  })

  it.each([
    ['before the Normal Counter origin', 3],
    ['beyond the Normal extent', 8],
  ])('new_normal: refuses a production target %s', async (_, productionTargetPosition) => {
    const fixture = seamFixture({ extent: { normal: 4, gogma: 3, skill: 3 }, normalCounter: true })
    const { execution } = await collectShape(fixture,
      { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } })
    expect(unavailable(execution)).toEqual({ kind: 'production_target_outside_extent' })
    expectUnavailable(execution, fixture)
  })

  it('new_normal: refuses a Counter that is not the Target\'s confirmed rarity-8 Counter', async () => {
    for (const fixture of [seamFixture({ extent: 3 }), seamFixture({ extent: 3, normalCounter: true })]) {
      const counterId = fixture.input.normalCounters.length === 0 ? COUNTER : 'weapon.fixture.other:8'
      const { execution } = await collectShape(fixture,
        { base: { kind: 'new_normal', counterId, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } })
      expect(unavailable(execution)).toEqual({ kind: 'normal_counter_unavailable' })
      expectUnavailable(execution, fixture)
    }
  })

  it('converts only at the shape\'s position among the formal legal ones, and predicts no other conversion Skill', async () => {
    // Skill 7 and 8 held: the formal legal conversion positions are 7, 8 and 9.
    const fixture = seamFixture({ extent: 3, ownedNormals: [{}], resetIdealAt: at(10), skillIdealAt: at(8) })
    const { value: { candidates }, bases } = await recordBases(() => collectShape(fixture,
      { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 8 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } },
      { skill: { held: [7, 8], blocked: [] } }))
    expect(bases.map((base) => base.baseOperations.map((operation) => operation.type === 'convert_normal_to_gogma' && operation.skillCounterBefore))).toEqual([[8]])
    expect(fixture.calls.filter((call) => call.startsWith('skill:'))).toEqual(['skill:8'])
    expect(candidates.map(ops)).toEqual(['c8,R10'])
  })

  it.each([
    ['a position behind a non-held Skill position', 8, {}, [7]],
    ['a blocked position', 8, { skill: { held: [7, 8], blocked: [8] } }, [7, 9]],
    ['a position beyond the conversion Skill window', 11, { skill: { held: [7, 8, 9, 10], blocked: [] } }, [7, 8, 9, 10]],
  ] as const)('refuses %s as conversion_position_not_legal, predicting nothing', async (_, conversionSkillPosition, reservation, legalPositions) => {
    const fixture = seamFixture({ extent: 3, ownedNormals: [{}] })
    const { execution } = await collectShape(fixture,
      { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } },
      reservation as Partial<PlannerAlternativeReservation>)
    expect(unavailable(execution)).toEqual({ kind: 'conversion_position_not_legal', legalPositions })
    expectUnavailable(execution, fixture)
  })

  it('refuses protected, exclusive, incompatible, unknown and non-convertible sources without editing the reservation', async () => {
    const reset = { kind: 'reset', finalPosition: 10 } as const
    const cases: Array<[string, SeamFixtureOptions, RouteShapeConstraint, Partial<PlannerAlternativeReservation>]> = [
      ['source_protected', { owned: [{ bonuses: 'practical', idealSkill: true, protected: true }] },
        { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: reset }, {}],
      ['source_protected', { ownedNormals: [{ protected: true }] },
        { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: reset }, {}],
      ['source_exclusive', { owned: [{ bonuses: 'practical', idealSkill: true }] },
        { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: reset }, { exclusiveOwnedWeaponIds: [owned('owned.fixture.0')] }],
      ['source_incompatible', { ownedNormals: [{}] },
        { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.normal.0') }, skill: { kind: 'zero' }, bonus: reset }, {}],
      ['source_incompatible', { owned: [{ bonuses: 'practical', idealSkill: true }] },
        { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.fixture.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: reset }, {}],
      ['source_not_found', {},
        { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.missing') }, skill: { kind: 'zero' }, bonus: reset }, {}],
    ]
    for (const [kind, options, shape, reservation] of cases) {
      clearStarted()
      const fixture = seamFixture({ extent: 3, ...options })
      const input = shapeInput(fixture, shape, reservation)
      const snapshot = structuredClone(input.reservation)
      const execution = await visitShapeConstrainedRouteCandidates(input, fixture.engine, () => 'continue')
      expect(unavailable(execution), kind).toEqual({ kind })
      expect(input.reservation, kind).toEqual(snapshot)
      expectUnavailable(execution, fixture)
    }
    // An element mismatch is incompatible too.
    const other = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }] })
    other.input.ownedWeapons[0] = { ...other.input.ownedWeapons[0], elementId: 'element.fixture.other' }
    const { execution } = await collectShape(other, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: reset })
    expect(unavailable(execution)).toEqual({ kind: 'source_incompatible' })
  })

  it('keeps a protected owned Gogma usable by a zero-operation shape (the protected-weapon rule is about operations)', async () => {
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true, protected: true }] })
    const { candidates, execution } = await collectShape(fixture, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'zero' } })
    expect(candidates.map((candidate) => candidate.route.kind)).toEqual(['existing_gogma_current'])
    expect(execution.base).toEqual({ admitted: true, unavailable: null })
    expect(fixture.calls).toEqual([])
  })

  it('stops on cancellation before any Route base is registered (conversion walk and base registration work)', async () => {
    for (const reservation of [{ skill: { held: [7, 8], blocked: [] } }, {}]) {
      const fixture = seamFixture({ extent: 3, ownedNormals: [{}], resetIdealAt: at(10) })
      const { value, bases } = await recordBases(() => visitShapeConstrainedRouteCandidates(shapeInput(fixture,
        { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 8 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } },
        reservation as Partial<PlannerAlternativeReservation>), fixture.engine, () => 'continue', { shouldCancel: () => true })
        .then(() => 'finished', (error: unknown) => error))
      if (Object.keys(reservation).length === 0) {
        // No held position to walk: the base diagnosis refuses position 8 before anything runs.
        expect(value).toBe('finished')
      } else {
        expect(value).toBeInstanceOf(CandidateSearchError)
        expect((value as CandidateSearchError).code).toBe('cancelled')
      }
      expect(bases).toEqual([])
      expect(fixture.calls).toEqual([])
    }
    // The base registration work of a new Normal is behind the scheduler checkpoint.
    const fixture = seamFixture({ extent: 3, normalCounter: true, resetIdealAt: at(10) })
    let checks = 0
    const { value, bases } = await recordBases(() => visitShapeConstrainedRouteCandidates(shapeInput(fixture,
      { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }),
    fixture.engine, () => 'continue', { shouldCancel: () => ++checks > 0 }).then(() => 'finished', (error: unknown) => error))
    expect((value as CandidateSearchError).code).toBe('cancelled')
    expect(bases).toEqual([])
    expect(fixture.calls).toEqual([])
  })
})

// ---------------------------------------------------------------- lanes, admission and delivery (15 "seam単体")

describe('lanes, admission and delivery', () => {
  it('opens a stream lane whatever its start state is and never offers its zero-operation solution', async () => {
    // Current Bonus already Ideal (gogma_artian) and current Skill Ideal: Planner Alternative opens neither lane.
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true }], resetIdealAt: at(11) })
    const { candidates } = await collectShape(fixture, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } })
    expect(candidates.map(ops)).toEqual(['R10,R11'])
    const plain = seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true }], resetIdealAt: at(11) })
    const alternative = await collectAlternative(plain)
    expect(alternative.candidates.filter((candidate) => candidate.route.sourceOwnedWeaponId === 'owned.fixture.0').map(ops)).toEqual([''])
  })

  it('keeps a zero lane at zero operations: no stream, no prediction for it', async () => {
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: at(10), skillIdealAt: at(7) })
    const { candidates, execution } = await collectShape(fixture, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } })
    // The current Skill is not Ideal and the zero Skill lane never resets it: no Ideal Route, and no Skill prediction.
    expect(candidates).toEqual([])
    expect(fixture.calls.filter((call) => call.startsWith('skill:'))).toEqual([])
    expect(fixture.supportQueries).not.toContain('skill')
    expect(execution.base.admitted).toBe(true)
  })

  it('delivers only Routes ending at the shape\'s final positions, in the six-key order, deterministically', async () => {
    const options: SeamFixtureOptions = { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: at(10, 11, 12), skillIdealAt: at(8, 9) }
    const shape: RouteShapeConstraint = { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'reset_skills', finalPosition: 9 }, bonus: { kind: 'reset', finalPosition: 12 } }
    const reservation = { gogma: { held: [10, 11], blocked: [] }, skill: { held: [7], blocked: [] } }
    const first = await collectShape(seamFixture(options), shape, reservation)
    expect(first.candidates.length).toBeGreaterThan(1)
    for (const candidate of first.candidates) {
      const skill = candidate.route.operations.filter((operation) => operation.type === 'reset_skills')
      const bonus = candidate.route.operations.filter((operation) => operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses')
      expect((skill.at(-1) as Extract<RouteOperation, { type: 'reset_skills' }>).skillCounterBefore).toBe(9)
      expect((bonus.at(-1) as Extract<RouteOperation, { type: 'reset_bonuses' }>).gogmaCounterBefore).toBe(12)
    }
    // Cost layers in order; the first delivery is the minimal Route of the shape.
    const costs = first.candidates.map((candidate) => candidate.estimatedOperationCount)
    expect(costs).toEqual([...costs].sort((left, right) => left - right))
    expect(ops(first.candidates[0])).toBe('R12,S8,S9')
    const second = await collectShape(seamFixture(options), shape, reservation)
    expect(second.candidates.map(candidateStableKey)).toEqual(first.candidates.map(candidateStableKey))
    expect(second.candidates).toEqual(first.candidates)
    for (const candidate of first.candidates) {
      expect(candidate).not.toHaveProperty('id')
      expect(candidate).not.toHaveProperty('searchRunId')
      expect(candidate).not.toHaveProperty('createdAt')
    }
  })

  it('stops on the consumer and reports the ordinary termination otherwise', async () => {
    const options: SeamFixtureOptions = { extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }], resetIdealAt: at(12) }
    const shape: RouteShapeConstraint = { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 12 } }
    const stopped = await collectShape(seamFixture(options), shape, { gogma: { held: [10, 11], blocked: [] } }, {}, 1)
    expect(stopped.execution).toMatchObject({ stoppedByConsumer: true, summary: { deliveredCandidates: 1, exhausted: false, stoppedByExtent: false } })
    // The Bonus lane ends at its final position: a natural end, never an extent stop.
    const all = await collectShape(seamFixture(options), shape, { gogma: { held: [10, 11], blocked: [] } })
    expect(all.execution).toMatchObject({ stoppedByConsumer: false, summary: { exhausted: true, stoppedByExtent: false }, base: { admitted: true, unavailable: null } })
    // One Reset per position and depth, chained to the first Reset reaching it (the Production rule).
    expect(all.candidates.map(ops)).toEqual(['R12', 'R10,R12', 'R10,R11,R12'])
  })

  it('rejects with the ordinary cancellation while searching, and passes every checkpoint through the shared execution context', async () => {
    const options: SeamFixtureOptions = { extent: 4, owned: [{ bonuses: 'practical', idealSkill: false }], resetIdealAt: at(12), skillIdealAt: at(9) }
    const shape: RouteShapeConstraint = { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'reset_skills', finalPosition: 9 }, bonus: { kind: 'reset', finalPosition: 12 } }
    let checks = 0
    await expect(collectShape(seamFixture(options), shape, {}, { shouldCancel: () => ++checks > 3 }))
      .rejects.toSatisfy((error) => error instanceof CandidateSearchError && error.code === 'cancelled')
    let checkpoints = 0
    let yields = 0
    const { candidates } = await collectShape(seamFixture(options), shape, {}, {
      shouldCancel: () => { checkpoints += 1; return false },
      yieldControl: async () => { yields += 1 },
    })
    expect(candidates.map(ops)).toEqual(['R10,R11,R12,S7,S8,S9'])
    // The execution context yields once every 50 checkpoints, exactly as for Planner Alternative Search.
    expect(checkpoints).toBeGreaterThan(0)
    expect(yields).toBe(Math.floor(checkpoints / 51))
  })

  it('fails closed when a primitive registers no base although the diagnosis passed', async () => {
    primitives.existing_gogma.mockImplementationOnce(async () => ({ candidates: [], searchedRoutes: [], skippedRoutes: [], warnings: [] }))
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }], resetIdealAt: at(10) })
    await expect(collectShape(fixture, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }))
      .rejects.toSatisfy((error) => error instanceof ShapeConstrainedSearchError && error.code === 'shape_search_contract_violation'
        && /never registered/.test(error.message))
  })

  it('fails closed when a base that differs from the shape, or a second base, is offered', async () => {
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }, { bonuses: 'practical', idealSkill: true }], resetIdealAt: at(10) })
    const shape: RouteShapeConstraint = { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 10 } }
    for (const offered of [['owned.fixture.1'], ['owned.fixture.0', 'owned.fixture.0']]) {
      primitives.existing_gogma.mockImplementationOnce(async (context, scheduler) => {
        for (const id of offered) {
          const weapon = context.input.ownedWeapons.find((candidate) => candidate.id === id)!
          scheduler.addBase({
            kindResolution: { type: 'existing_gogma' }, sourceOwnedWeaponId: weapon.id, baseOperations: [], conversionSkill: null,
            zeroBonus: { gogmaAdvance: 0, lastResetDepth: 0, finalBonuses: weapon.restorationBonuses, restorationBonusScope: weapon.restorationBonusScope, operations: [], amendmentResults: [] },
            zeroSkill: { resetCount: 0, seriesSkillId: weapon.seriesSkillId, groupSkillId: weapon.groupSkillId, estimatedSkillAdvance: 0, operations: [], amendmentResults: [] },
            startSkillCounter: null,
            bonusBase: { startGogmaCounter: 10, bonuses: weapon.restorationBonuses, restorationBonusScope: 'gogma_artian' },
            onCandidate: () => undefined,
          })
        }
        return { candidates: [], searchedRoutes: [], skippedRoutes: [], warnings: [] }
      })
      await expect(collectShape(fixture, shape)).rejects.toSatisfy((error) =>
        error instanceof ShapeConstrainedSearchError && error.code === 'shape_search_contract_violation')
    }
  })
})

// ---------------------------------------------------------------- Bonus support contract through the seam (15 "Bonus support契約")

describe('Bonus support contract through the seam', () => {
  const ownedGogma = (bonuses: 'practical' | 'keep_compatible_practical') => ({ owned: [{ bonuses, idealSkill: true }] }) satisfies SeamFixtureOptions
  const gogmaShape = (bonus: RouteShapeConstraint['bonus']): RouteShapeConstraint =>
    ({ base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus })

  it('Reset supported / Keep unsupported: a Reset-only shape materializes for every base kind and queries no Keep support', async () => {
    const shapes: Array<[SeamFixtureOptions, RouteShapeConstraint, string]> = [
      [ownedGogma('practical'), gogmaShape({ kind: 'reset', finalPosition: 11 }), 'R10,R11'],
      [{ ownedNormals: [{}], skillIdealAt: at(7) }, { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } }, 'c7,R10,R11'],
      [{ normalCounter: true, skillIdealAt: at(7) }, { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } }, 'n1@4-5,c7,R10,R11'],
    ]
    for (const [options, shape, expected] of shapes) {
      const fixture = seamFixture({ extent: 3, resetIdealAt: at(11), keepSupportedFor: () => false, ...options })
      const { candidates, execution } = await collectShape(fixture, shape)
      expect(candidates.map(ops)).toEqual([expected])
      expect(fixture.supportQueries.some((query) => query.startsWith('gogma_keep'))).toBe(false)
      expect(execution).toMatchObject({ requiredUnsupportedPredictions: [], forbiddenOperationNotices: 0 })
    }
  })

  it('Keep supported / Reset unsupported: a Keep-only shape materializes for every base kind (a stream base without Reset support) and queries no Reset support', async () => {
    const shapes: Array<[SeamFixtureOptions, RouteShapeConstraint, string]> = [
      [ownedGogma('keep_compatible_practical'), gogmaShape({ kind: 'keep', finalPosition: 11 }), 'K10,K11'],
      [{ ownedNormals: [{ bonuses: 'keep_compatible_practical' }], skillIdealAt: at(7) },
        { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 11 } }, 'c7,K10,K11'],
      [{ normalCounter: true, normalAt: () => 'keep_compatible_practical', skillIdealAt: at(7) },
        { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 11 } }, 'n1@4-5,c7,K10,K11'],
    ]
    for (const [options, shape, expected] of shapes) {
      const fixture = seamFixture({ extent: 3, resetSupported: false, keepResult: (g) => (g === 11 ? 'ideal' : 'practical'), ...options })
      const { candidates, execution } = await collectShape(fixture, shape)
      expect(candidates.map(ops)).toEqual([expected])
      expect(fixture.supportQueries).not.toContain('gogma_reset')
      expect(fixture.calls.some((call) => call.startsWith('reset:'))).toBe(false)
      expect(execution).toMatchObject({ requiredUnsupportedPredictions: [], forbiddenOperationNotices: 0 })
    }
    // The Production Planner Alternative Search of the same owned Normal builds no Bonus stream base without Reset support.
    const plain = seamFixture({ extent: 3, resetSupported: false, keepResult: (g) => (g === 11 ? 'ideal' : 'practical'), ownedNormals: [{ bonuses: 'keep_compatible_practical' }], skillIdealAt: at(7) })
    const { bases } = await recordBases(() => collectAlternative(plain))
    expect(bases.map((base) => base.bonusBase)).toEqual([null])
  })

  it('diagnoses an unsupported Reset of a Reset-only or Reset-then-Keep shape before any primitive runs', async () => {
    for (const bonus of [{ kind: 'reset', finalPosition: 11 }, { kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }] as const) {
      clearStarted()
      const fixture = seamFixture({ extent: 3, resetSupported: false, ...ownedGogma('practical') })
      const { execution } = await collectShape(fixture, gogmaShape(bonus))
      expect(unavailable(execution)).toEqual({ kind: 'prediction_unsupported', prediction: 'gogma_reset', reason: 'engine_capability_unavailable' })
      expectUnavailable(execution, fixture)
    }
  })

  it('diagnoses an unsupported first Keep of an owned source, and reports a later required Keep from the stream', async () => {
    const fixture = seamFixture({ extent: 3, keepSupportedFor: () => false, ...ownedGogma('keep_compatible_practical') })
    const { execution } = await collectShape(fixture, gogmaShape({ kind: 'keep', finalPosition: 11 }))
    expect(unavailable(execution)).toEqual({ kind: 'prediction_unsupported', prediction: 'gogma_keep', reason: 'engine_capability_unavailable' })
    expectUnavailable(execution, fixture)

    // A new Normal's slots, and a Reset result, exist only inside the stream: the stream reports the required Keep.
    const normal = seamFixture({ extent: 3, normalCounter: true, normalAt: () => 'keep_compatible_practical', keepSupportedFor: () => false, skillIdealAt: at(7) })
    const run = await collectShape(normal, { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 11 } })
    expect(run.candidates).toEqual([])
    expect(run.execution).toMatchObject({ base: { admitted: true }, requiredUnsupportedPredictions: [{ type: 'keep_bonuses', reason: 'engine_capability_unavailable' }], forbiddenOperationNotices: 0 })
    expect(normal.supportQueries).not.toContain('gogma_reset')

    // The source's slots (layout L) are Reset-stage input: only the Reset at 10's result (layout P) is asked a Keep support.
    const thenKeep = seamFixture({ extent: 3, keepSupportedFor: () => false, ...ownedGogma('keep_compatible_practical') })
    const rtk = await collectShape(thenKeep, gogmaShape({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }))
    expect(rtk.execution).toMatchObject({ base: { admitted: true }, requiredUnsupportedPredictions: [{ type: 'keep_bonuses', reason: 'engine_capability_unavailable' }], forbiddenOperationNotices: 0 })
    expect(thenKeep.supportQueries.filter((query) => query.startsWith('gogma_keep'))).toEqual([`gogma_keep:${slotsText(practicalOnlyBonuses())}`])
  })

  it('diagnoses a missing Keep capability of a Keep or Reset-then-Keep shape, and needs none for a Reset-only one', async () => {
    for (const bonus of [{ kind: 'keep', finalPosition: 11 }, { kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }] as const) {
      const fixture = seamFixture({ extent: 3, capabilities: { supportsKeepBonusesPrediction: false }, ...ownedGogma('keep_compatible_practical') })
      const { execution } = await collectShape(fixture, gogmaShape(bonus))
      expect(unavailable(execution)).toEqual({ kind: 'capability_unavailable', capability: 'keep_bonuses', cause: 'engine_capability_unavailable' })
    }
    const fixture = seamFixture({ extent: 3, capabilities: { supportsKeepBonusesPrediction: false }, resetIdealAt: at(11), ...ownedGogma('practical') })
    expect((await collectShape(fixture, gogmaShape({ kind: 'reset', finalPosition: 11 }))).candidates.map(ops)).toEqual(['R10,R11'])
  })

  it('needs both supports for a Reset-then-Keep shape, and materializes when both hold', async () => {
    const fixture = seamFixture({ extent: 3, resetAt: (g) => (g === 10 ? keepCompatiblePracticalBonuses() : null), keepResult: (g) => (g === 11 ? 'ideal' : 'practical'),
      ...ownedGogma('practical') })
    const { candidates, execution } = await collectShape(fixture, gogmaShape({ kind: 'reset_then_keep', resetPosition: 10, finalPosition: 11 }))
    expect(candidates.map(ops)).toEqual(['R10,K11'])
    expect(execution).toMatchObject({ requiredUnsupportedPredictions: [], forbiddenOperationNotices: 0 })
  })

  it('diagnoses the Skill and Normal capability / support a conversion or Reset Skills lane needs', async () => {
    const reset = { kind: 'reset', finalPosition: 10 } as const
    const skillLane = seamFixture({ extent: 3, skillSupported: false, ...ownedGogma('practical') })
    expect(unavailable((await collectShape(skillLane, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: reset })).execution))
      .toEqual({ kind: 'prediction_unsupported', prediction: 'skill', reason: 'engine_capability_unavailable' })
    // A zero Skill lane of an owned Gogma asks no Skill support at all.
    const zeroLane = seamFixture({ extent: 3, skillSupported: false, resetIdealAt: at(10), ...ownedGogma('practical') })
    expect((await collectShape(zeroLane, gogmaShape(reset))).candidates.map(ops)).toEqual(['R10'])
    expect(zeroLane.supportQueries).not.toContain('skill')
    const normal = seamFixture({ extent: 3, normalCounter: true, normalSupported: false })
    expect(unavailable((await collectShape(normal, { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: reset })).execution))
      .toEqual({ kind: 'prediction_unsupported', prediction: 'normal_artian', reason: 'engine_capability_unavailable' })
    const noSkillCounter = seamFixture({ extent: 3, ownedNormals: [{}] })
    noSkillCounter.input.rngState = { ...noSkillCounter.input.rngState, skillCounter: { value: null, isConfirmed: false, source: null } }
    expect(unavailable((await collectShape(noSkillCounter, { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: reset })).execution))
      .toEqual({ kind: 'capability_unavailable', capability: 'skill', cause: 'rng_input_unconfirmed' })
  })
})

// ---------------------------------------------------------------- G1 / G2 / G3 through the seam (15 "G1 / G2 / G3")

describe('G1 / G2 / G3 through the seam', () => {
  it('G1: a conversion whose Skill is already Ideal still continues to the shape\'s Reset Skills position', async () => {
    const options: SeamFixtureOptions = { extent: { normal: 1, gogma: 1, skill: 2 }, normalCounter: true, skillIdealAt: at(7, 9), resetIdealAt: at(10) }
    const shape: RouteShapeConstraint = { base: { kind: 'new_normal', counterId: COUNTER, productionTargetPosition: 4, conversionSkillPosition: 7 },
      skill: { kind: 'reset_skills', finalPosition: 9 }, bonus: { kind: 'reset', finalPosition: 10 } }
    const fixture = seamFixture(options)
    const { candidates } = await collectShape(fixture, shape)
    expect(candidates.map(ops)).toEqual(['n1@4-5,c7,R10,S8,S9'])
    const target = fixture.input.targetWeapons[0]
    expect(satisfiesIdealTarget(target, candidates[0].finalBonuses, candidates[0].restorationBonusScope, candidates[0].seriesSkillId, candidates[0].groupSkillId, fixture.input.master)).toBe(true)
    // Planner Alternative Search never continues an Ideal conversion Skill: no Reset Skills on that Route base.
    const alternative = await collectAlternative(seamFixture(options))
    expect(alternative.candidates.map(ops)).toEqual(['n1@4-5,c7,R10'])
  })

  it('G2: an unprotected owned Gogma\'s Ideal lane is continued (Skill and Bonus); a protected one is never operated', async () => {
    const skill = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }], skillIdealAt: at(8), resetIdealAt: at(11) })
    expect((await collectShape(skill, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'reset', finalPosition: 11 } }))
      .candidates.map(ops)).toEqual(['R10,R11,S7,S8'])
    const bonus = seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true }], keepResult: (g) => (g === 11 ? 'ideal' : 'practical') })
    expect((await collectShape(bonus, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 11 } }))
      .candidates.map(ops)).toEqual(['K10,K11'])
    const alternative = await collectAlternative(seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true }], keepResult: (g) => (g === 11 ? 'ideal' : 'practical') }))
    expect(alternative.candidates.map(ops)).toEqual([''])

    const protectedSource = seamFixture({ extent: 3, owned: [{ bonuses: 'ideal', idealSkill: true, protected: true }], keepResult: (g) => (g === 11 ? 'ideal' : 'practical') })
    clearStarted()
    const { execution } = await collectShape(protectedSource, { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 11 } })
    expect(unavailable(execution)).toEqual({ kind: 'source_protected' })
    expectUnavailable(execution, protectedSource)
  })

  it('G3 upper: Planner Alternative Search never delivers the Keep chain; the Keep-only shape delivers it first', async () => {
    const options: SeamFixtureOptions = { extent: 4, owned: [{ bonuses: 'keep_compatible_practical', idealSkill: true }],
      resetAt: (g) => (g === 12 ? keepCompatiblePracticalBonuses() : null), keepResult: (g) => (g === 13 ? 'ideal' : 'practical') }
    const alternative = await collectAlternative(seamFixture(options))
    expect(alternative.candidates.map(ops)).toEqual(['R10,R11,R12,K13'])
    const { candidates } = await collectShape(seamFixture(options),
      { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'keep', finalPosition: 13 } })
    expect(candidates.map(ops)).toEqual(['K10,K11,K12,K13'])
  })

  it('G3 lower: Planner Alternative Search never delivers the minimal Reset-then-Keep Route; the shape delivers it first', async () => {
    // q = 10 and g1 = 11 held (another Route's chain), both Resets of layout L; r = 12; g* = 13.
    const options: SeamFixtureOptions = { extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }],
      resetAt: (g) => (g === 10 || g === 11 ? keepCompatiblePracticalBonuses() : null), keepResult: (g) => (g === 13 ? 'ideal' : 'practical') }
    const reservation = { gogma: { held: [10, 11], blocked: [] } }
    const alternative = await collectAlternative(seamFixture(options), reservation)
    const delivered = alternative.candidates.map(ops)
    expect(delivered).not.toContain('R11,K12,K13')
    // The minimal-cost delivery carries the q history (required {10, 13}); the required set {11, 13} appears only one
    // own operation later, behind a skippable Reset at q (observed; the design estimated no such later history).
    expect(delivered[0]).toBe('R10,K12,K13')
    expect(delivered).toContain('R10,R11,K12,K13')
    const { candidates } = await collectShape(seamFixture(options),
      { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 13 } }, reservation)
    expect(candidates.map(ops)[0]).toBe('R11,K12,K13')
    expect(candidates.map(ops)).not.toContain('R10,K12,K13')
  })
})

// ---------------------------------------------------------------- input validation (5.3 item 1)

describe('input validation', () => {
  const valid: RouteShapeConstraint = { base: { kind: 'owned_gogma', ownedWeaponId: owned('owned.fixture.0') }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } }

  it.each([
    ['a negative final position', { ...valid, bonus: { kind: 'reset', finalPosition: -1 } }],
    ['a fractional position', { ...valid, bonus: { kind: 'keep', finalPosition: 10.5 } }],
    ['a Reset position not before the final one', { ...valid, bonus: { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 11 } }],
    ['a Gogma final position outside the window', { ...valid, bonus: { kind: 'reset', finalPosition: 13 } }],
    ['a Skill final position outside the window', { ...valid, skill: { kind: 'reset_skills', finalPosition: 10 } }],
    ['a conversion base with a zero Bonus lane', { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'zero' } }],
    ['Reset Skills not after the conversion', { base: { kind: 'owned_normal', ownedWeaponId: owned('owned.normal.0'), conversionSkillPosition: 8 }, skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'reset', finalPosition: 11 } }],
    ['a Counter ID that is not rarity 8', { base: { kind: 'new_normal', counterId: 'weapon.fixture.a:7', productionTargetPosition: 4, conversionSkillPosition: 7 }, skill: { kind: 'zero' }, bonus: { kind: 'reset', finalPosition: 11 } }],
    ['an unknown base kind', { ...valid, base: { kind: 'blind_normal' } }],
  ] as const)('refuses %s with invalid_shape before any prediction', async (_, shape) => {
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }], ownedNormals: [{}], normalCounter: true })
    await expect(collectShape(fixture, shape as unknown as RouteShapeConstraint))
      .rejects.toSatisfy((error) => error instanceof ShapeConstrainedSearchError && error.code === 'invalid_shape')
    expect(fixture.calls).toEqual([])
    expect(fixture.supportQueries).toEqual([])
    expect(started()).toEqual([])
  })

  it('validates the origin, extent and reservation exactly as Planner Alternative Search, and the Engine version', async () => {
    const fixture = seamFixture({ extent: 3, owned: [{ bonuses: 'practical', idealSkill: true }] })
    const input = shapeInput(fixture, valid)
    await expect(visitShapeConstrainedRouteCandidates({ ...input, extent: { ...input.extent, maxGogmaAdvance: 0 } }, fixture.engine, () => 'continue'))
      .rejects.toMatchObject({ name: 'ShapeConstrainedSearchError', code: 'invalid_input' })
    await expect(visitShapeConstrainedRouteCandidates({ ...input, reservation: { ...input.reservation, gogma: { held: [10], blocked: [11] } } }, fixture.engine, () => 'continue'))
      .rejects.toMatchObject({ name: 'ShapeConstrainedSearchError', code: 'invalid_reservation' })
    await expect(visitShapeConstrainedRouteCandidates({ ...input, origin: { ...input.origin, calculationContext: { ...input.origin.calculationContext, rngEngineVersion: 'another-engine' } } }, fixture.engine, () => 'continue'))
      .rejects.toMatchObject({ name: 'ShapeConstrainedSearchError', code: 'calculation_context_incompatible' })
    expect(fixture.calls).toEqual([])
  })

  it('never edits the formal reservation or the origin', async () => {
    const fixture = seamFixture({ extent: 4, owned: [{ bonuses: 'practical', idealSkill: true }], resetIdealAt: at(12) })
    const input = shapeInput(fixture, { ...valid, bonus: { kind: 'reset', finalPosition: 12 } }, { gogma: { held: [11, 10, 11], blocked: [] }, exclusiveOwnedWeaponIds: [owned('owned.other')] })
    const snapshot = structuredClone(input)
    await visitShapeConstrainedRouteCandidates(input, fixture.engine, () => 'continue')
    expect(input).toEqual(snapshot)
  })
})
