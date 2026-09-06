import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { targetWeaponId } from '../../test/fixtures/domainData'
import type { CandidateSearchInput, CandidateSearchProgress } from './searchTypes'
import { defaultCandidateSearchSettings } from './searchTypes'
import { SEARCH_ACTIVITY_PROGRESS_INTERVAL } from './searchExecution'
import { searchCandidates } from './candidateSearch'

/**
 * A Skill-only workload with no reachable Ideal, so the Target-wide queue keeps
 * settling work far past one activity interval without terminating early.
 */
function longRunningFixture(bound = 400) {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings = {
    ...input.settings,
    maxNormalAdvance: 1,
    maxGogmaAdvance: 1,
    maxSkillAdvance: bound,
  }
  input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
  input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
  input.ownedWeapons[0].isProtected = false
  // Not the Target's Ideal Series Skill, so the Skill stream keeps searching.
  input.ownedWeapons[0].seriesSkillId = 'series.other'
  const engine = createCandidateSearchEngine(input)
  // No Skill position ever matches the Target's Ideal Series Skill.
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => ({
    seriesSkillId: `series.other.${skillCounter}`,
    groupSkillId: null,
  }))
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(() => practicalOnlyBonuses())
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine }
}

function withSecondTarget(input: CandidateSearchInput): CandidateSearchInput {
  const second = {
    ...structuredClone(input.targetWeapons[0]),
    id: targetWeaponId('target.fixture.b'),
    name: 'Second fixture target',
  }
  return {
    ...input,
    targetWeapons: [...input.targetWeapons, second],
    targetWeaponIds: [...input.targetWeaponIds, second.id],
  }
}

const options = { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 }

afterEach(() => vi.restoreAllMocks())

describe('B6 Candidate Search defaults', () => {
  it('ships the B6 defaults chosen from the B5 measurements', () => {
    expect(defaultCandidateSearchSettings).toEqual({
      maxNormalAdvance: 1000,
      maxGogmaAdvance: 200,
      maxSkillAdvance: 1000,
      maxCandidatesPerTarget: 200,
      similarityThreshold: 0.6,
    })
  })
})

describe('B6 Candidate Search progress', () => {
  it('reports the current Target when its search starts, before it completes', async () => {
    const { input, engine } = longRunningFixture(3)
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    expect(events[0]).toEqual({
      completedTargets: 0,
      totalTargets: 1,
      currentTargetWeaponId: input.targetWeaponIds[0],
      phase: 'preparing',
      processedWorkItems: 0,
    })
    expect(events.at(-1)).toMatchObject({
      completedTargets: 1,
      totalTargets: 1,
      currentTargetWeaponId: input.targetWeaponIds[0],
      phase: 'finalizing',
    })
  })

  it('reports activity inside one long-running Target with a monotonic work count', async () => {
    const { input, engine } = longRunningFixture()
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    const activity = events.filter(({ phase }) => phase === 'searching')
    expect(activity.length).toBeGreaterThan(0)
    // Activity is published while the single Target is still incomplete.
    expect(activity.every(({ completedTargets }) => completedTargets === 0)).toBe(true)
    expect(activity[0].processedWorkItems).toBe(SEARCH_ACTIVITY_PROGRESS_INTERVAL)
    expect(activity.map(({ processedWorkItems }) => processedWorkItems)).toEqual(
      [...activity].map(({ processedWorkItems }) => processedWorkItems).sort((a, b) => a - b),
    )
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].completedTargets !== events[index - 1].completedTargets) continue
      expect(events[index].processedWorkItems).toBeGreaterThanOrEqual(
        events[index - 1].processedWorkItems,
      )
    }
    expect(events.at(-1)?.processedWorkItems).toBeGreaterThanOrEqual(
      activity.at(-1)!.processedWorkItems,
    )
  })

  it('restarts the work count per Target and ends at completedTargets = totalTargets', async () => {
    const base = longRunningFixture()
    const input = withSecondTarget(base.input)
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, base.engine, { ...options, onProgress: (event) => events.push(event) })

    const starts = events.filter(({ phase }) => phase === 'preparing')
    expect(starts).toHaveLength(2)
    expect(starts.map(({ completedTargets }) => completedTargets)).toEqual([0, 1])
    expect(starts.every(({ processedWorkItems }) => processedWorkItems === 0)).toBe(true)
    expect(new Set(starts.map(({ currentTargetWeaponId }) => currentTargetWeaponId)).size).toBe(2)

    const last = events.at(-1)!
    expect(last.completedTargets).toBe(2)
    expect(last.totalTargets).toBe(2)
    expect(last.phase).toBe('finalizing')
  })

  it('returns the same Candidates with and without a progress callback', async () => {
    const withCallback = longRunningFixture()
    const withoutCallback = longRunningFixture()
    const observed = await searchCandidates(withCallback.input, withCallback.engine, {
      ...options,
      onProgress: () => undefined,
    })
    const silent = await searchCandidates(withoutCallback.input, withoutCallback.engine, options)
    expect(observed.targetResults).toEqual(silent.targetResults)
    expect(observed.isTruncated).toBe(silent.isTruncated)
  })
})
