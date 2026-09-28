import { describe, expect, it, vi } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { stableStringify } from '../domain/models/hashing'
import { validateBuildListEntry } from '../domain/models/publicTypes'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { FakeRngEngine } from '../domain/rng/fakeRngEngine'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { searchCandidates } from '../domain/search/candidateSearch'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import { createPhase1EFallback } from './plannerGlobalOptimizationPhase1E'
import { globalResearchDependencies, GLOBAL_RESEARCH_TIME, globalResearchSearchInput, materializeGlobalResearchCandidate, runGlobalPlannerResearch,
  type GlobalResearchSearchOrigin } from './plannerGlobalOptimizationResearch'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'
import { researchFinalInput, type Phase2BRouteSummary } from './plannerGlobalPhase2BPlan'
import { analyzePhase2C1Run, frontierStacking, PHASE2C1_VARIANTS, requiredCollisions, runPhase2C1Variant, searchStateFingerprint, staticStreamEnvelope,
  type Phase2C1Variant } from './plannerGlobalPhase2C1'
import { comparePhase2C1, phase2c1SourceRelation } from './plannerGlobalPhase2C1Analysis'
import { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'

const sha = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value))))]
  .map(b => b.toString(16).padStart(2, '0')).join('')
const textSha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(b => b.toString(16).padStart(2, '0')).join('')

/**
 * Three Targets of one weapon type whose original Entries all Reset at Gogma 10: the baseline keeps one (retained)
 * and the other two are pending. Every Gogma draw is Ideal, so a sequential Search finds the next free position while a
 * Planner-start Search finds the origin position again.
 */
async function threeTargetFixture() {
  const fixture = await globalResearchFixture({ extraTargets: 1 })
  const engine: FakeRngEngine = fixture.engine
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(() => createRestorationBonusSet())
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation(current => current + 1)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => createRestorationBonusSet())
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((current, op) => current + op.count)
  const skill = fixture.input.targetWeapons[0].idealSkillCondition.seriesSkillId
  vi.spyOn(engine, 'predictSkills').mockImplementation(() => ({ seriesSkillId: skill, groupSkillId: null }))
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation(current => current + 1)
  return fixture
}

async function research(input: PlannerInput, engine: FakeRngEngine, settings: PlannerInput extends never ? never : Parameters<typeof globalResearchSearchInput>[2],
  searchOrigin?: GlobalResearchSearchOrigin) {
  const states: string[] = []
  const inputs: Parameters<NonNullable<Parameters<typeof runGlobalPlannerResearch>[2]>['onSearchInput'] & object>[0][] = []
  const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: settings, nowMs: () => 0,
    extentFallback: createPhase1EFallback('normal', 1000),
    onSearchInput: value => { states.push(searchStateFingerprint(value)); inputs.push(value) },
    ...(searchOrigin ? { searchOrigin } : {}) })
  return { result, states, inputs }
}

function fixtureVariant(id: keyof typeof PHASE2C1_VARIANTS, settings: Phase2C1Variant['baseExtent']): Phase2C1Variant {
  // The fixture cannot use the Export extent; only the extent differs from the formal variant.
  return { ...PHASE2C1_VARIANTS[id], baseExtent: settings }
}

describe('Phase 2-C1 Planner-start origin Search', () => {
  it('starts every pending Search from the same Planner-start origin, while the control projects each earlier Candidate', async () => {
    const { input, search, engine } = await threeTargetFixture()
    const before = structuredClone(input)
    const origin = searchStateFingerprint(input)
    const control = await research(input, engine, search.settings)
    const c1 = await research(input, engine, search.settings, 'planner_start')
    expect(control.result.report.searches).toHaveLength(2)
    expect(c1.result.report.searches).toHaveLength(2)
    // Control: the first pending Search already sees the retained prefix, the second also the first Candidate.
    expect(control.states.every(state => state !== origin)).toBe(true)
    expect(new Set(control.states).size).toBe(2)
    // C1: every Search sees exactly the origin; no retained Route, Candidate, Counter or weapon change reaches it.
    expect(c1.states).toEqual([origin, origin])
    for (const value of c1.inputs) {
      expect(value.rngState).toEqual(input.rngState)
      expect(value.normalCounters).toEqual(input.normalCounters)
      expect(value.ownedWeapons).toEqual(input.ownedWeapons)
      expect(value.targetWeapons).toEqual(input.targetWeapons)
    }
    expect(control.inputs[0].rngState.gogmaCounter.value).toBe(11)
    expect(control.inputs[1].rngState.gogmaCounter.value).toBe(12)
    expect(c1.result.report.searchOrigin).toBe('planner_start')
    expect(c1.result.report.algorithm).toBe('phase2c1-planner-start-origin-v1:normal-2x-fallback')
    expect(control.result.report.searchOrigin).toBeUndefined()
    expect(input).toEqual(before)
  })

  it('keeps the retained derivation, Target order, extent and fallback of the control, and runs no application Planner', async () => {
    const { input, search, engine } = await threeTargetFixture()
    const control = (await research(input, engine, search.settings)).result
    const c1 = (await research(input, engine, search.settings, 'planner_start')).result
    expect(c1.report.retainedOriginalEntryIds).toEqual(control.report.retainedOriginalEntryIds)
    expect(c1.report.retainedOriginalEntryIds.length).toBeGreaterThan(0)
    expect(c1.report.searches.map(s => s.targetId)).toEqual(control.report.searches.map(s => s.targetId))
    expect(c1.report.searches.map(s => s.extent)).toEqual(control.report.searches.map(s => s.extent))
    expect(c1.report.extentFallback).toEqual(control.report.extentFallback)
    expect(c1.report.retained).toEqual(control.report.retained)
    expect(c1.report.baseline).toEqual(control.report.baseline)
    // baseline + retained prefix + one application per Candidate + final, vs baseline + retained prefix + final.
    expect(control.report.plannerFullRunCount).toBe(2 + 2 + 1)
    expect(c1.report.plannerFullRunCount).toBe(3)
    expect(c1.report.searches.every(s => s.applicationPlannerMs === 0)).toBe(true)
  })

  it('uses the ordinary canonical Candidate from the origin, unchanged, and leaves the collision to the final Production Planner', async () => {
    const { input, search, engine } = await threeTargetFixture()
    const { result } = await research(input, engine, search.settings, 'planner_start')
    expect(result.generatedEntries).toHaveLength(2)
    for (const entry of result.generatedEntries) {
      expect(validateBuildListEntry(entry).isValid).toBe(true)
      const direct = await searchCandidates(globalResearchSearchInput({ ...input }, input.targetWeapons.find(t => t.id === entry.targetWeaponId)!, search.settings),
        engine, { now: () => GLOBAL_RESEARCH_TIME })
      // The ranking authority is the ordinary Search: same Route, same final weapon.
      expect(entry.candidateSnapshot.route).toEqual(direct.targetResult.candidate!.route)
      expect(entry.candidateSnapshot.finalBonuses).toEqual(direct.targetResult.candidate!.finalBonuses)
      expect(entry.candidateSnapshot.route.operations.find(op => op.type === 'reset_bonuses')).toMatchObject({ gogmaCounterBefore: 10 })
    }
    // Final authority: the Production Planner over retained + generated Entries, as they are.
    const finalInput = researchFinalInput(input, result.report, result.generatedEntries)
    const direct = await createProductionPlan(finalInput, globalResearchDependencies(engine))
    // Same result up to the run-local Plan / Step ID counters of the Research dependencies.
    const shape = (value: typeof direct) => ({ termination: value.termination, warnings: value.warnings, conflicts: value.conflicts,
      selected: value.plan?.selectedBuildListEntryIds, rejected: value.plan?.rejectedBuildListEntries,
      steps: value.plan?.steps.map(step => [step.operationType, step.buildListEntryId, step.rngAdvance]) })
    expect(shape(result.finalResult!)).toEqual(shape(direct))
    expect(result.finalResult!.conflicts.length).toBeGreaterThan(0)
    // All three Routes forge / convert / Reset at the same origin positions: nothing moved a Candidate away from them.
    expect(result.finalResult!.conflicts.map(c => c.kind)).toContain('same_gogma_counter')
    for (const kind of result.finalResult!.conflicts.map(c => c.kind)) expect(['same_normal_counter', 'same_skill_counter', 'same_gogma_counter']).toContain(kind)
    expect(result.report.status).toBe('partial')
    const analysis = analyzePhase2C1Run(input, result.report, result.generatedEntries, result.finalResult, engine, [], searchStateFingerprint(input))
    if (!analysis.finished) throw new Error('unfinished')
    // All three Entries need Gogma 10: the post-hoc count sees it, nothing fixed it.
    expect(analysis.collisions.requiredPositionCollisions.gogma).toEqual([expect.objectContaining({ stream: 'gogma', position: 10 })])
    expect(analysis.collisions.requiredPositionCollisions.gogma[0].targetWeaponIds).toHaveLength(3)
    expect(Object.values(analysis.final!.conflictsByKind).reduce((a, b) => a + b, 0)).toBe(result.finalResult!.conflicts.length)
    // Every generated stream interval starts before the retained frontier (all of them start at the origin).
    expect(analysis.stacking.all.startsAtOrAfterFrontier).toBe(0)
    expect(analysis.stacking.all.startsBeforeFrontier).toBe(analysis.stacking.all.total)
    expect(analysis.stacking.all.total).toBeGreaterThan(0)
  })

  it('keeps the default (control) path identical and refuses an unknown origin', async () => {
    const { input, search, engine } = await globalResearchFixture()
    const plain = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0 })
    const explicit = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, searchOrigin: 'sequential_projection' })
    expect(explicit).toEqual(plain)
    // The Phase 0 / 1-C / 1-D / 1-E parity SHA of this fixture is unchanged.
    expect(await sha(plain)).toBe('9ae56d7eb3c06352bd140d28c66bd5db3c42c2f5b98a7c50c97ad11610a73cb7')
    await expect(runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, searchOrigin: 'elsewhere' as GlobalResearchSearchOrigin }))
      .rejects.toThrow('Invalid search origin')
    // The materializer keeps its Phase 0 identity by default; the C1 identity is distinct.
    const candidate = (await searchCandidates(globalResearchSearchInput({ ...input }, input.targetWeapons[1], search.settings), engine, { now: () => GLOBAL_RESEARCH_TIME })).targetResult.candidate!
    const searchInput = globalResearchSearchInput({ ...input }, input.targetWeapons[1], search.settings)
    // No existing Entry to reuse, so the materializer builds a new one under each identity.
    const empty = { ...input, buildListEntries: [] }
    const a = materializeGlobalResearchCandidate(empty, searchInput, candidate)
    expect(materializeGlobalResearchCandidate(empty, searchInput, candidate, 'phase0-sequential-v1')).toEqual(a)
    const c1Entry = materializeGlobalResearchCandidate(empty, searchInput, candidate, 'phase2c1-planner-start-origin-v1')
    // The Search identity names the algorithm; the Candidate semantics are the same.
    expect(c1Entry.candidateSnapshot.searchRunId).not.toBe(a.candidateSnapshot.searchRunId)
    expect(c1Entry.candidateId).not.toBe(a.candidateId)
    expect(c1Entry.candidateSnapshot.route).toEqual(a.candidateSnapshot.route)
  })

  it('runs both variants through the same runner with the same workload except the Search origin', async () => {
    const { input, search, engine } = await threeTargetFixture()
    // The raw block cache observes the reference PRNG, which the Fake Engine fixture does not use: no cache here.
    const noRawBlocks = { beginSearch: () => undefined, endRun: () => undefined } as unknown as GlobalRawBlockResearch
    const deps = { createEngine: () => engine, createRawBlocks: () => noRawBlocks, sha256: textSha, nowMs: () => 0 }
    const workload = (variant: Phase2C1Variant) => ({ ...variant, id: undefined, description: undefined, searchOrigin: undefined })
    expect(workload(PHASE2C1_VARIANTS['origin-independent-canonical'])).toEqual(workload(PHASE2C1_VARIANTS.control))
    expect([PHASE2C1_VARIANTS.control.searchOrigin, PHASE2C1_VARIANTS['origin-independent-canonical'].searchOrigin]).toEqual(['sequential_projection', 'planner_start'])
    expect(PHASE2C1_VARIANTS.control.baseExtent).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(PHASE2C1_VARIANTS.control).toMatchObject({ fallbackAxis: 'normal', fallbackMaxEpisodes: 3 })
    const control = await runPhase2C1Variant(input, fixtureVariant('control', search.settings), deps)
    const c1 = await runPhase2C1Variant(input, fixtureVariant('origin-independent-canonical', search.settings), deps)
    if (!control.analysis.finished || !c1.analysis.finished) throw new Error('unfinished')
    expect(control.analysis.searchOrigin.fromPlannerStartOrigin).toBe(0)
    expect(c1.analysis.searchOrigin).toMatchObject({ searches: 2, fromPlannerStartOrigin: 2, distinctStates: 1 })
    expect(c1.analysis.discoveryOrder).toEqual(control.analysis.discoveryOrder)
    expect(c1.analysis.retainedCount).toBe(control.analysis.retainedCount)
    expect(control.analysis.stacking.all.startsAtOrAfterFrontier).toBe(control.analysis.stacking.all.total)
    expect(control.analysis.final).toMatchObject({ traceReplay: 'passed' })
    expect(control.analysis.final!.physical!.identityHolds).toBe(true)
    expect(c1.analysis.final!.conflicts).toBeGreaterThan(0)
    // Plan steps and the static envelope are separate fields and never substituted for each other.
    expect(c1.analysis.staticEnvelope.finalInput.routeSet).toBe('final_input_all_entries')
    expect(Object.keys(c1.analysis.final!)).toContain('planSteps')
    expect(Object.keys(c1.analysis.staticEnvelope.finalInput)).not.toContain('planSteps')
    expect(control.semanticSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(c1.semanticSha256).not.toBe(control.semanticSha256)
    // Post-hoc: C1 regenerates the original Build List here too, so the Target-level conflicts are the original ones.
    expect(c1.analysis.candidateCounts.sameCandidateAsOriginalEntry).toBe(2)
    expect(control.analysis.candidateCounts.sameCandidateAsOriginalEntry).toBe(0)
    expect(c1.baselineComparison.sameConflictSignatures).toBe(true)
    expect(control.baselineComparison.original.conflictSignatures.length).toBeGreaterThan(0)
  })
})

const use = (first: number, last: number, required: number[]) => ({ first, last, operations: last - first + 1, required, contiguous: true })
function route(targetWeaponId: string, patch: Partial<Phase2BRouteSummary>): Phase2BRouteSummary {
  return { targetWeaponId, weaponTypeId: 'weapon.x', elementId: 'element.y', buildListEntryId: `entry.${targetWeaponId}`, entryOrigin: 'generated_base_search',
    routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned', sourceOwnedWeaponId: `weapon.${targetWeaponId}`, normalPosition: null, normalCounterId: null,
    conversionPosition: null, estimatedOperationCount: 1, estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, routeOperationCount: 1, operationTypes: {},
    normal: null, gogma: null, skill: null, ...patch }
}
const envelopeInput = { rngState: { skillCounter: { value: 100 }, gogmaCounter: { value: 50 } },
  normalCounters: [{ id: 'counter.x', weaponTypeId: 'weapon.x', counter: 5 }] } as unknown as PlannerInput

describe('Phase 2-C1 post-hoc summaries', () => {
  it('computes the static envelope from required positions, separate from any Plan step count', () => {
    const routes = [route('a', { gogma: use(50, 59, [59]) }), route('b', { gogma: use(52, 70, [55]), skill: use(100, 104, [104]) }),
      route('c', { sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalCounterId: 'counter.x', normal: use(5, 9, [9]) })]
    const envelope = staticStreamEnvelope('test', routes, envelopeInput)
    expect(envelope.streams).toEqual([
      { stream: 'skill', weaponTypeId: null, origin: 100, requiredEnd: 105, lastEnd: 105, requiredMax: 104, routes: 1, virtualAdvance: 5 },
      // Required max 59, not the skippable tail up to 70.
      { stream: 'gogma', weaponTypeId: null, origin: 50, requiredEnd: 60, lastEnd: 71, requiredMax: 59, routes: 2, virtualAdvance: 10 },
      { stream: 'normal:counter.x', weaponTypeId: 'weapon.x', origin: 5, requiredEnd: 10, lastEnd: 10, requiredMax: 9, routes: 1, virtualAdvance: 5 },
    ])
    expect(envelope.virtualStreamEnvelopeCost).toBe(20)
    expect(Object.keys(envelope)).toEqual(['routeSet', 'streams', 'virtualStreamEnvelopeCost'])
  })

  it('counts source and required-position collisions from the Routes alone, with no hard-coded ID', () => {
    const routes = [route('p', { sourceOwnedWeaponId: 'weapon.shared', gogma: use(50, 50, [50]) }), route('q', { sourceOwnedWeaponId: 'weapon.shared', gogma: use(50, 51, [51]) }),
      route('r', { entryOrigin: 'retained_original', gogma: use(51, 51, [51]), skill: use(100, 100, [100]) }), route('s', { skill: use(100, 101, [100, 101]) })]
    const collisions = requiredCollisions(routes)
    expect(collisions.sourceCollisions).toEqual([{ ownedWeaponId: 'weapon.shared', targetWeaponIds: ['p', 'q'], entryOrigins: ['generated_base_search', 'generated_base_search'] }])
    expect(collisions.sourceCollisionTargets).toBe(2)
    expect(collisions.requiredPositionCollisions.gogma).toEqual([{ stream: 'gogma', position: 51, targetWeaponIds: ['q', 'r'], entryOrigins: ['generated_base_search', 'retained_original'] }])
    expect(collisions.requiredPositionCollisions.skill.map(row => row.position)).toEqual([100])
    expect(collisions.requiredPositionCollisionCounts).toEqual({ normal: 0, skill: 1, gogma: 1 })
  })

  it('measures frontier stacking in discovery order, retained Routes first (Phase 2-B definition)', () => {
    const retained = route('r', { entryOrigin: 'retained_original', gogma: use(50, 54, [54]) })
    const stacked = [retained, route('a', { gogma: use(55, 60, [60]) }), route('b', { gogma: use(61, 62, [62]), skill: use(100, 101, [101]) })]
    expect(frontierStacking(stacked, ['a', 'b'], envelopeInput).all).toEqual({ total: 3, startsAtOrAfterFrontier: 3, startsBeforeFrontier: 0 })
    const independent = [retained, route('a', { gogma: use(50, 51, [51]) }), route('b', { gogma: use(53, 58, [58]), skill: use(100, 101, [101]) })]
    const result = frontierStacking(independent, ['a', 'b'], envelopeInput)
    expect(result.gogma).toEqual({ total: 2, startsAtOrAfterFrontier: 0, startsBeforeFrontier: 2 })
    expect(result.skill).toEqual({ total: 1, startsAtOrAfterFrontier: 1, startsBeforeFrontier: 0 })
    expect(result.rows.map(row => row.frontierBefore)).toEqual([55, 55, 100])
  })

  it('classifies source relations against an explicit comparison Route only', () => {
    expect(phase2c1SourceRelation({ sourceKind: 'owned', sourceOwnedWeaponId: 'w1', normalPosition: null }, { sourceKind: 'owned', sourceOwnedWeaponId: 'w1', normalPosition: null })).toBe('same_owned_weapon')
    expect(phase2c1SourceRelation({ sourceKind: 'owned', sourceOwnedWeaponId: 'w1', normalPosition: null }, { sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null })).toBe('different_owned_weapon')
    expect(phase2c1SourceRelation({ sourceKind: 'owned', sourceOwnedWeaponId: 'w1', normalPosition: null }, { sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalPosition: 3 })).toBe('owned_to_new_normal')
    expect(phase2c1SourceRelation({ sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalPosition: 3 }, { sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalPosition: 3 })).toBe('new_normal_same_position')
    expect(phase2c1SourceRelation({ sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalPosition: 3 }, { sourceKind: 'new_normal', sourceOwnedWeaponId: null, normalPosition: 4 })).toBe('new_normal_different_position')
    expect(comparePhase2C1).toBeTypeOf('function')
  })
})

// Built from parts so that this test itself never names the oracle modules (their own isolation test scans every Research file).
const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c1*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-C1 isolation', () => {
  it('keeps the oracle, Planner Alternative Search and hard-coded IDs out of the calculation', () => {
    for (const path of ['./plannerGlobalPhase2C1.ts', './plannerGlobalOptimizationResearch.ts', './plannerGlobalPhase2BPlan.ts']) {
      const source = benchmarkSources[path]
      expect(source, path).toBeDefined()
      expect(source, path).not.toMatch(ORACLE_NAMES)
      expect(source, path).not.toMatch(/plannerGlobalPhase2C1Analysis|plannerGlobalPhase2BGapAnalysis|parseOptimumEvidence/)
      expect(source, path).not.toMatch(/visitPlannerAlternativeCandidates|plannerAlternativeSearch/)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source, path).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
    }
    const runner = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2c1.mjs'))![1]
    expect(runner).not.toMatch(ORACLE_NAMES)
    expect(runner).not.toMatch(/--optimum|--phase2b|plannerGlobalPhase2C1Analysis|plannerGlobalPhase2BGapAnalysis|\b[0-9a-f]{64}\b/)
    const analysis = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2c1.mjs'))![1]
    expect(analysis).toMatch(/option\('--optimum'\)/)
    expect(analysis).not.toMatch(/runGlobalPlannerResearch|runPhase2C1Variant|createProductionPlan|searchCandidates/)
    expect(analysis).not.toMatch(new RegExp('plannerGlobal' + 'Oracle1657|plannerGlobal' + 'LowerBound'))
  })

  it('is reached by no Production module, and Production keeps its defaults, schema and versions', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.filter(path => /plannerGlobalPhase2C1|PHASE2C1|planner_start|searchOrigin/.test(production[path]))).toEqual([])
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
  })
})
