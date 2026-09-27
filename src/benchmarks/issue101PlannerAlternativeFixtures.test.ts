import { beforeAll, describe, expect, it } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { satisfiesIdealTarget } from '../domain/target'
import {
  createIssue101NoIdealSearchOrigin,
  createIssue101RealFixture,
  createIssue101Targets,
  ISSUE_101_BASE_SEED,
  ISSUE_101_DRAGON_TARGET_ID,
  ISSUE_101_FIRE_TARGET_ID,
  ISSUE_101_GOGMA_COUNTER,
  ISSUE_101_NORMAL_COUNTER,
  ISSUE_101_SKILL_COUNTER,
  ISSUE_101_UNREACHABLE_IDEAL_BONUSES,
  ISSUE_101_WEAPON_TYPE_ID,
  type Issue101RealFixture,
} from './issue101PlannerAlternativeFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'

/*
 * The Issue #101 fixtures the Planner Alternative tests and benchmark use,
 * under the current Production authorities. Only semantic outcomes are
 * asserted - never a duration.
 */

const SLOW = 120_000

const EXPECTED_ISSUE_ROUTE = {
  kind: 'normal_artian_to_gogma',
  operationCount: 3,
  normalForgeCount: 207,
  normalCounterBefore: 0,
  conversionSkillCounter: 341,
  resetBonusesCount: 0,
  keepBonusesCount: 1,
  resetSkillsCount: 0,
  firstGogmaCounter: 55,
  lastGogmaCounter: 55,
  estimatedGogmaAdvance: 1,
  estimatedSkillAdvance: 1,
  estimatedNormalAdvance: 207,
}

/**
 * The fixture IDs as the Issue #101 fixture produced them before it was moved
 * out of the removed B8 research harness (Phase 6-B2b): moving it changed no
 * Candidate, BuildListEntry or Conflict identity.
 */
const PINNED_FIRE_ENTRY_ID = 'build-list.fnv1a32-bfc1e95a'
const PINNED_DRAGON_ENTRY_ID = 'build-list.fnv1a32-422fd7b0'
const PINNED_FIRE_CANDIDATE_ID = 'candidate.fnv1a32:fff2ef17'
const PINNED_DRAGON_CANDIDATE_ID = 'candidate.fnv1a32:dd216c26'
const PINNED_CONFLICT_IDS = [
  'plan-conflict:fnv1a32:01be8f30',
  'plan-conflict:fnv1a32:c923b4f9',
  'plan-conflict:fnv1a32:f902a692',
]

describe('Issue #101 fixture versions', () => {
  it('does not move any version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})

describe('Issue #101 real case (current Production authorities)', () => {
  let fixture: Issue101RealFixture

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
  }, SLOW)

  it('holds the RNG state recorded in the Issue', () => {
    const { rngState, normalCounters } = fixture.plannerInput
    expect(rngState.baseSeed.value).toBe(ISSUE_101_BASE_SEED)
    expect(rngState.skillCounter.value).toBe(ISSUE_101_SKILL_COUNTER)
    expect(rngState.gogmaCounter.value).toBe(ISSUE_101_GOGMA_COUNTER)
    expect(normalCounters).toHaveLength(1)
    expect(normalCounters[0]).toMatchObject({
      weaponTypeId: ISSUE_101_WEAPON_TYPE_ID,
      counter: ISSUE_101_NORMAL_COUNTER,
      isConfirmed: true,
    })
    expect(fixture.plannerInput.targetWeapons.map(({ id }) => id))
      .toEqual([ISSUE_101_FIRE_TARGET_ID, ISSUE_101_DRAGON_TARGET_ID])
    expect(fixture.plannerInput.conflictResolutions).toEqual([])
  })

  it('reproduces the Issue Route for both Targets from Candidate Search', () => {
    expect(summarizeIssue101Route(fixture.fireCandidate.route, fixture.fireCandidate)).toEqual(EXPECTED_ISSUE_ROUTE)
    expect(summarizeIssue101Route(fixture.dragonCandidate.route, fixture.dragonCandidate)).toEqual(EXPECTED_ISSUE_ROUTE)
    expect(fixture.fireCandidate.calculationContext.rngEngineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('keeps the pinned Candidate, BuildListEntry and Conflict identities', () => {
    expect(fixture.fireCandidate.id).toBe(PINNED_FIRE_CANDIDATE_ID)
    expect(fixture.dragonCandidate.id).toBe(PINNED_DRAGON_CANDIDATE_ID)
    expect(fixture.fireEntry.id).toBe(PINNED_FIRE_ENTRY_ID)
    expect(fixture.dragonEntry.id).toBe(PINNED_DRAGON_ENTRY_ID)
    expect(fixture.initialConflicts.map(({ id }) => id)).toEqual(PINNED_CONFLICT_IDS)
  })

  it('is deterministic across fixture builds', async () => {
    const again = await createIssue101RealFixture()
    expect(again.fireEntry.id).toBe(fixture.fireEntry.id)
    expect(again.dragonEntry.id).toBe(fixture.dragonEntry.id)
    expect(again.fireCandidate.route).toEqual(fixture.fireCandidate.route)
    expect(again.initialConflicts.map(({ id }) => id)).toEqual(fixture.initialConflicts.map(({ id }) => id))
  }, SLOW)

  it('keeps one Normal conflict after Issue #129, beside the Skill and Gogma conflicts', () => {
    const kinds = fixture.initialConflicts.map(({ kind }) => kind).sort()
    expect(kinds).toEqual(['same_gogma_counter', 'same_normal_counter', 'same_skill_counter'])
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')
    expect(normal?.reason).toContain('position 206')
    expect(fixture.initialConflicts.find(({ kind }) => kind === 'same_skill_counter')?.reason)
      .toContain('Skill Counter 341')
    for (const conflict of fixture.initialConflicts) {
      expect([...conflict.buildListEntryIds].sort()).toEqual(
        [fixture.fireEntry.id, fixture.dragonEntry.id].sort(),
      )
    }
  })

  it('builds the same Targets the fixture plans for', () => {
    const { fire, dragon } = createIssue101Targets()
    expect(fixture.plannerInput.targetWeapons).toEqual([fire, dragon])
  })
})

describe('Issue #101 no-Ideal Production benchmark fixture', () => {
  it('holds the Issue RNG state and one Target whose Ideal is three 属性強化EX', () => {
    const { origin, targetWeaponId } = createIssue101NoIdealSearchOrigin()
    expect(origin.rngState.baseSeed.value).toBe(ISSUE_101_BASE_SEED)
    expect(origin.rngState.skillCounter.value).toBe(ISSUE_101_SKILL_COUNTER)
    expect(origin.rngState.gogmaCounter.value).toBe(ISSUE_101_GOGMA_COUNTER)
    expect(origin.ownedWeapons).toEqual([])
    expect(origin.targetWeapons).toHaveLength(1)
    const [target] = origin.targetWeapons
    expect(target.id).toBe(targetWeaponId)
    expect(target.idealBonuses).toEqual(ISSUE_101_UNREACHABLE_IDEAL_BONUSES)
    expect(target.weaponTypeId).toBe(ISSUE_101_WEAPON_TYPE_ID)
    // The unreachable Ideal is still a well-formed Ideal: a Gogma holding it would satisfy it.
    expect(satisfiesIdealTarget(target, ISSUE_101_UNREACHABLE_IDEAL_BONUSES, 'gogma_artian', null, null, origin.master))
      .toBe(true)
  })
})
