import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import type { CandidateSearchProgress } from './searchTypes'
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

const options = { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 }

afterEach(() => vi.restoreAllMocks())

describe('B6 Candidate Search defaults', () => {
  it('ships the B6 defaults chosen from the B5 measurements', () => {
    expect(defaultCandidateSearchSettings).toEqual({
      maxNormalAdvance: 1000,
      maxGogmaAdvance: 200,
      maxSkillAdvance: 1000,
    })
  })
})

describe('B6 Candidate Search progress', () => {
  it('reports the searched Target when the search starts, before it completes', async () => {
    const { input, engine } = longRunningFixture(3)
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    expect(events[0]).toEqual({
      targetWeaponId: input.targetWeaponId,
      phase: 'preparing',
      processedWorkItems: 0,
    })
    expect(events.at(-1)).toMatchObject({
      targetWeaponId: input.targetWeaponId,
      phase: 'finalizing',
    })
  })

  it('carries no multi-Target progress fields at all', async () => {
    const { input, engine } = longRunningFixture(3)
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    // One search covers one Target, so a Target-count progress bar would be a
    // constant 1 / 1 (`docs/SEARCH_SPEC.md` 4.1).
    expect(Object.keys(events[0]).sort()).toEqual([
      'phase',
      'processedWorkItems',
      'targetWeaponId',
    ])
  })

  it('reports activity inside one long-running Target with a monotonic work count', async () => {
    const { input, engine } = longRunningFixture()
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    const activity = events.filter(({ phase }) => phase === 'searching')
    expect(activity.length).toBeGreaterThan(0)
    // Activity is published while the Target is still incomplete.
    expect(activity.every(({ phase }) => phase === 'searching')).toBe(true)
    expect(activity[0].processedWorkItems).toBe(SEARCH_ACTIVITY_PROGRESS_INTERVAL)
    expect(activity.map(({ processedWorkItems }) => processedWorkItems)).toEqual(
      [...activity].map(({ processedWorkItems }) => processedWorkItems).sort((a, b) => a - b),
    )
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].processedWorkItems).toBeGreaterThanOrEqual(
        events[index - 1].processedWorkItems,
      )
    }
    expect(events.at(-1)?.processedWorkItems).toBeGreaterThanOrEqual(
      activity.at(-1)!.processedWorkItems,
    )
  })

  it('starts at zero work and ends with one finalizing event', async () => {
    const { input, engine } = longRunningFixture()
    const events: CandidateSearchProgress[] = []
    await searchCandidates(input, engine, { ...options, onProgress: (event) => events.push(event) })

    const starts = events.filter(({ phase }) => phase === 'preparing')
    expect(starts).toHaveLength(1)
    expect(starts[0].processedWorkItems).toBe(0)
    expect(events.filter(({ phase }) => phase === 'finalizing')).toHaveLength(1)
    expect(events.at(-1)?.phase).toBe('finalizing')
  })

  it('returns the same Candidates with and without a progress callback', async () => {
    const withCallback = longRunningFixture()
    const withoutCallback = longRunningFixture()
    const observed = await searchCandidates(withCallback.input, withCallback.engine, {
      ...options,
      onProgress: () => undefined,
    })
    const silent = await searchCandidates(withoutCallback.input, withoutCallback.engine, options)
    expect(observed.targetResult).toEqual(silent.targetResult)
  })
})
