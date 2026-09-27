import { describe, expect, it, vi } from 'vitest'
import { createCandidateSearchInput, createCandidateSearchEngine } from '../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, validateBuildCandidate, validateBuildListEntry } from '../domain/models/publicTypes'
import { searchCandidates } from '../domain/search/candidateSearch'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { globalResearchDependencies, GLOBAL_RESEARCH_TIME, materializeGlobalResearchCandidate, runGlobalPlannerResearch } from './plannerGlobalOptimizationResearch'
import { GlobalSearchProfiler } from './plannerGlobalOptimizationProfile'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'

const fixture = globalResearchFixture

describe('Global Planner Phase 0 Research', () => {
  it('keeps the exact baseline and input, deterministically replaces a conflict, validates and replays the final Plan', async () => {
    const { input, search, engine } = await fixture()
    const before = structuredClone(input)
    const baseline = await createProductionPlan(input, globalResearchDependencies(engine))
    const run = () => runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0 })
    const a = await run(), b = await run()
    expect(a).toEqual(b)
    const profiled = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), {
      extent: search.settings, nowMs: () => 0, profiler: new GlobalSearchProfiler(),
      // The observation receives a copy, never write authority.
      onSearchInput: snapshot => { snapshot.ownedWeapons.length = 0; snapshot.rngState.skillCounter.value = 999 },
    })
    expect(profiled.finalResult).toEqual(a.finalResult)
    expect(profiled.generatedEntries).toEqual(a.generatedEntries)
    for (const measurement of profiled.report.searches) {
      expect(measurement.profile?.settledCountExact).toBe(true)
      delete measurement.profile
    }
    expect(profiled.report).toEqual(a.report)
    expect(input).toEqual(before)
    expect(a.report.baseline?.steps).toBe(baseline.plan?.steps.length)
    expect(a.report.baseline?.conflicts).toBe(baseline.conflicts.length)
    expect(a.report.baseline?.selected).toBe(1)
    expect(a.report.status, JSON.stringify(a.report)).toBe('completed')
    expect(a.report.final).toMatchObject({ selected: 2, completedTargetCount: 2, conflicts: 0, rejected: 0, traceReplay: 'passed' })
    expect(a.generatedEntries).toHaveLength(1)
    for (const entry of a.generatedEntries) {
      expect(validateBuildCandidate(entry.candidateSnapshot, input.ownedWeapons).isValid).toBe(true)
      expect(validateBuildListEntry(entry).isValid).toBe(true)
      expect(validatePlannerInput({ ...input, buildListEntries: [entry] }, globalResearchDependencies(engine)).excludedBuildListEntries).toEqual([])
      expect(entry.candidateSnapshot.estimatedNormalAdvance).toBe(2)
      expect(a.report.searches[0].advances?.normal).toBe(1)
    }
    expect(a.report.plannerFullRunCount).toBe(4)
    const attempt = { retainedEntryIds: a.report.retainedOriginalEntryIds, pendingTargetIds: a.report.searches.map(s => s.targetId) }
    const explicit = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt })
    expect(explicit).toEqual(a)
    const none = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0,
      attempt: { retainedEntryIds: [], pendingTargetIds: input.buildListEntries.map(e => e.targetWeaponId) } })
    expect(none.report.retained).toMatchObject({ completedTargetCount: 0, conflicts: 0, rejected: 0, traceReplay: 'passed' })
    expect(none.report.status, JSON.stringify(none.report)).toBe('completed')
    const again = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt })
    expect(again).toEqual(a)
    expect(input).toEqual(before)
  })

  it('revalidates a retained set instead of projecting a conflicting prefix', async () => {
    const { input, search, engine } = await fixture()
    const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings,
      attempt: { retainedEntryIds: input.buildListEntries.map(e => e.id), pendingTargetIds: [] } })
    expect(result.report.status).toBe('blocked')
    expect(result.report.searches).toEqual([])
    expect(result.report.retained?.conflicts).toBeGreaterThan(0)
  })

  it('distinguishes attempt deadline from cancel and bounded no-match', async () => {
    const { input, engine } = await fixture()
    const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { timeBudgetMs: 0, nowMs: () => 0 })
    expect(result.report.status).toBe('time_budget_reached')
    expect(result.report.searches).toEqual([])
    expect(result.finalResult).toBeNull()
  })

  it('reports bounded no-match separately from a prediction exception, keeping failed original Entries', async () => {
    const { input, search, engine } = await fixture()
    const predict = engine.predictGogmaBonus.bind(engine)
    vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => value.gogmaCounter === 11
      ? createRestorationBonusSet().map(b => ({ ...b, bonusTypeId: 'bonus_type.fixture.utility' })) as ReturnType<typeof createRestorationBonusSet>
      : predict(value))
    const empty = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings })
    expect(empty.report.searches[0].status).toBe('not_found_within_extent')
    expect(empty.report.searches[0].predictionBoundaryReached.normal).toBe(true)
    expect(empty.report.final?.totalTargetCount).toBe(2)
    vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => { if (value.gogmaCounter === 11) throw new Error('prediction failed'); return predict(value) })
    const failed = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings })
    expect(failed.report.searches[0]).toMatchObject({ status: 'search_error', error: 'prediction failed' })
    expect(failed.report.status).toBe('partial')
  })

  it('cancels at the existing execution seam without claiming a final Plan', async () => {
    const { input, search, engine } = await fixture()
    let cancel = false
    const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings,
      shouldCancel: () => cancel, onProgress: report => { if (report.retained) cancel = true }, yieldControl: async () => undefined,
    })
    expect(result.report.status).toBe('cancelled')
    expect(result.finalResult).toBeNull()
  })

  it('cancels during Candidate Search through its checkpoint', async () => {
    const { input, search, engine } = await fixture()
    let cancel = false
    const predict = engine.predictNormalArtian.bind(engine)
    vi.spyOn(engine, 'predictNormalArtian').mockImplementation(value => {
      if (value.normalCounter === 5) cancel = true
      return predict(value)
    })
    const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), {
      extent: search.settings, shouldCancel: () => cancel,
    })
    expect(result.report.status).toBe('cancelled')
    expect(result.report.searches[0].status).toBe('cancelled')
    expect(result.finalResult).toBeNull()
  })

  it('refuses to relabel a changed source as an original-source Candidate', async () => {
    const search = createCandidateSearchInput()
    search.calculationContext.appSchemaVersion = CURRENT_CALCULATION_APP_SCHEMA_VERSION
    const original = structuredClone(search)
    original.ownedWeapons[0].restorationBonusScope = 'normal_artian'
    const source = search.ownedWeapons[0]
    source.restorationBonusScope = 'gogma_artian'
    const candidate = (await searchCandidates(search, createCandidateSearchEngine(search), { now: () => GLOBAL_RESEARCH_TIME })).targetResult.candidate!
    expect(candidate.route.kind).toBe('existing_gogma_current')
    const input: PlannerInput = { ...original, buildListEntries: [], conflictResolutions: [], options: { maxPlanSteps: 100 } }
    expect(() => materializeGlobalResearchCandidate(input, search, candidate)).toThrow('source changed')
    expect(() => materializeGlobalResearchCandidate({ ...input, ownedWeapons: [] }, search, candidate)).toThrow('generated by the prefix')
  })

  it('rejects a forged projected hash and never silently fixes it', async () => {
    const { input, search } = await fixture()
    const candidate = structuredClone(input.buildListEntries[0].candidateSnapshot)
    candidate.searchStateHash = 'forged-hash'
    expect(() => materializeGlobalResearchCandidate(input, search, candidate)).toThrow('stale')
  })

  it('fails closed on a corrupted final prediction through the ordinary Trace Replay', async () => {
    const { input, engine } = await fixture()
    const candidate = input.buildListEntries[0].candidateSnapshot
    candidate.seriesSkillId = 'series_skill.fixture.wrong'
    await expect(createProductionPlan(input, globalResearchDependencies(engine))).rejects.toThrow(/replay/i)
  })
})

const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
it('has no incoming Production import and adds no persistence or legacy orchestration dependency', () => {
  const production = Object.entries(sources).filter(([path]) => path.startsWith('../') && !/benchmarks|\.test\.|\/test\//.test(path))
  expect(production.length).toBeGreaterThan(100)
  expect(production.filter(([, source]) => /plannerGlobal(?:Optimization|RawBlocks)/.test(source))).toEqual([])
  for (const [path, source] of Object.entries(sources).filter(([path]) => /plannerGlobal(?:Optimization|RawBlocks)/.test(path) && !path.includes('.test.'))) {
    expect(source, path).not.toMatch(/from ['"][^'"]*(?:\/db\/|planner\/constrained\/|importExportService|createConstrainedPlan)/)
  }
})
