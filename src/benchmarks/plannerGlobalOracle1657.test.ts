import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search/alternative'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative/plannerAlternativeTrial'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'
import {
  classifyOracleVerdict, deriveOracleRequiredPositions, expandOracleOperations, materializeOracleRoutes, routeOperationsAsOracle,
  runOraclePlanner, verifyOracleRng, type OracleVerdictInput,
} from './plannerGlobalOracle1657'
import { ORACLE_1657_EXPORT_SHA256, ORACLE_1657_PHYSICAL_OPERATIONS, ORACLE_1657_ROUTES, type OracleRouteSpec } from './plannerGlobalOracle1657Manifest'

/*
 * Issue #154 Phase 2-A.5. The oracle is a verification fixture for one Export only: nothing Production,
 * no Candidate Search / Planner module and no other Global Planner Research algorithm may read it.
 */
const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const research = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scripts = import.meta.glob('../../scripts/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const oracleFiles = ['./plannerGlobalOracle1657.ts', './plannerGlobalOracle1657Manifest.ts', './plannerGlobalOracle1657.test.ts', './plannerGlobalLowerBound.ts', './plannerGlobalLowerBound.test.ts']

/** Two synthetic Targets sharing one Normal / Skill / Gogma stream (FakeRngEngine fixture). */
async function fixture() {
  const { input, engine } = await globalResearchFixture()
  const [a, b] = input.targetWeapons
  const routes: OracleRouteSpec[] = [
    { targetWeaponId: a!.id, source: { kind: 'new_normal', normalPosition: 4 }, materialization: 'candidate_search', routeKind: 'normal_artian_to_gogma',
      operations: [{ type: 'create_normal_artian', from: 4, to: 4 }, { type: 'convert_normal_to_gogma', from: 7, to: 7 }, { type: 'reset_bonuses', from: 10, to: 10 }],
      required: { normal: 4, skill: [7], gogma: [10] }, estimated: { operations: 3, normal: 1, gogma: 1, skill: 1 } },
    { targetWeaponId: b!.id, source: { kind: 'new_normal', normalPosition: 5 }, materialization: 'planner_alternative_search', routeKind: 'normal_artian_to_gogma',
      operations: [{ type: 'create_normal_artian', from: 5, to: 5 }, { type: 'convert_normal_to_gogma', from: 8, to: 8 }, { type: 'reset_bonuses', from: 11, to: 11 }],
      required: { normal: 5, skill: [8], gogma: [11] }, estimated: { operations: 3, normal: 2, gogma: 2, skill: 2 } },
  ]
  return { input: input as PlannerInput, engine, routes }
}

describe('Phase 2-A.5 oracle isolation', () => {
  it('is imported by no Production module and read by no other Research algorithm', () => {
    const productionPaths = Object.keys(production).filter(path => !/\.test\.tsx?$/.test(path))
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter(path => /plannerGlobalOracle|plannerGlobalLowerBound|ORACLE_1657/.test(production[path]!))).toEqual([])
    const otherResearch = Object.keys(research).filter(path => !oracleFiles.includes(path))
    expect(otherResearch.length).toBeGreaterThan(10)
    expect(otherResearch.filter(path => /plannerGlobalOracle|plannerGlobalLowerBound|ORACLE_1657/.test(research[path]!))).toEqual([])
    const otherScripts = Object.keys(scripts).filter(path => !path.endsWith('run-planner-global-oracle-1657.mjs'))
    expect(otherScripts.filter(path => /plannerGlobalOracle|plannerGlobalLowerBound/.test(scripts[path]!))).toEqual([])
  })

  it('keeps every oracle Target ID, OwnedWeapon ID and the Export hash out of Production and other Research', () => {
    const ids = new Set(ORACLE_1657_ROUTES.flatMap(route => [route.targetWeaponId, ...(route.source.kind === 'owned' ? [route.source.ownedWeaponId] : [])]))
    expect(ids.size).toBe(43 + 35)
    const leaks = [...Object.entries(production), ...Object.entries(research).filter(([path]) => !oracleFiles.includes(path))]
      .filter(([, source]) => [...ids].some(id => source.includes(id)) || source.includes(ORACLE_1657_EXPORT_SHA256))
      .map(([path]) => path)
    expect(leaks).toEqual([])
  })

  it('keeps the verifier and lower bound free of oracle data, and the manifest free of logic', () => {
    for (const path of ['./plannerGlobalOracle1657.ts', './plannerGlobalLowerBound.ts']) {
      expect(research[path], path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(research[path], path).not.toMatch(/\b[0-9a-f]{64}\b/)
      expect(research[path], path).not.toMatch(/ORACLE_1657_ROUTES|readFile|fetch\(|indexedDB|Dexie/)
    }
    expect(research['./plannerGlobalLowerBound.ts']).not.toMatch(/plannerGlobalOracle1657/)
    expect(research['./plannerGlobalOracle1657Manifest.ts']).not.toMatch(/^import /m)
  })

  it('verifies with the Production RNG Engine only', () => {
    const runner = scripts['../../scripts/run-planner-global-oracle-1657.mjs']!
    expect(runner).toMatch(/new ProductionRngEngine\(\)/)
    expect(runner).not.toMatch(/FakeRngEngine|GlobalRawBlockResearch/)
    expect(runner).toMatch(/ORACLE_1657_EXPORT_SHA256/)
  })

  it('changes no Production default, schema or version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})

describe('Phase 2-A.5 oracle manifest', () => {
  it('describes 43 Routes whose streams add up to the physical operation count', () => {
    expect(ORACLE_1657_ROUTES).toHaveLength(43)
    const ops = ORACLE_1657_ROUTES.flatMap(route => expandOracleOperations(route.operations))
    const extent = (stream: string, origin: number) => Math.max(...ops.filter(op => op.stream === stream).map(op => op.position)) + 1 - origin
    expect(extent('skill', 341)).toBe(1083)
    expect(extent('gogma', 55)).toBe(235)
    for (const route of ORACLE_1657_ROUTES) expect(deriveOracleRequiredPositions(expandOracleOperations(route.operations))).toEqual(route.required)
    expect(ORACLE_1657_PHYSICAL_OPERATIONS).toBe(1657)
    expect(ORACLE_1657_ROUTES.filter(route => route.source.kind === 'owned')).toHaveLength(35)
  })
})

describe('Phase 2-A.5 oracle helpers', () => {
  it('expands segments into one physical operation per Counter position', () => {
    expect(expandOracleOperations([{ type: 'create_normal_artian', from: 0, to: 2 }, { type: 'convert_normal_to_gogma', from: 9, to: 9 }]))
      .toEqual([{ type: 'create_normal_artian', stream: 'normal', position: 0 }, { type: 'create_normal_artian', stream: 'normal', position: 1 },
        { type: 'create_normal_artian', stream: 'normal', position: 2 }, { type: 'convert_normal_to_gogma', stream: 'skill', position: 9 }])
    expect(() => expandOracleOperations([{ type: 'reset_bonuses', from: 3, to: 2 }])).toThrow(RangeError)
  })

  it('derives required units by the documented skip rule without confusing positions and PlanSteps', () => {
    const derive = (segments: Parameters<typeof expandOracleOperations>[0]) => deriveOracleRequiredPositions(expandOracleOperations(segments))
    // Reset chain: only the last Reset. Reset read by a Keep and the last Keep. Keep→Keep skippable.
    expect(derive([{ type: 'reset_bonuses', from: 1, to: 4 }])).toEqual({ normal: null, skill: [], gogma: [4] })
    expect(derive([{ type: 'reset_bonuses', from: 1, to: 3 }, { type: 'keep_bonuses', from: 4, to: 6 }])).toEqual({ normal: null, skill: [], gogma: [3, 6] })
    expect(derive([{ type: 'keep_bonuses', from: 1, to: 2 }, { type: 'reset_bonuses', from: 3, to: 3 }])).toEqual({ normal: null, skill: [], gogma: [3] })
    // Held positions: a Reset at 5 read by a Keep at 40 (non-contiguous Route).
    expect(derive([{ type: 'reset_bonuses', from: 5, to: 5 }, { type: 'keep_bonuses', from: 40, to: 40 }])).toEqual({ normal: null, skill: [], gogma: [5, 40] })
    // Conversion is required; Reset Skills chain keeps its last; Counter-advance forges are skippable.
    expect(derive([{ type: 'create_normal_artian', from: 0, to: 206 }, { type: 'convert_normal_to_gogma', from: 10, to: 10 }, { type: 'reset_skills', from: 11, to: 14 }]))
      .toEqual({ normal: 206, skill: [10, 14], gogma: [] })
  })

  it('matches the Planner route-unit authority on materialized Entries', async () => {
    const { input, engine, routes } = await fixture()
    const rng = verifyOracleRng(input, engine, routes)
    const materialized = await materializeOracleRoutes(input, engine, routes, rng, { nowMs: () => 0 })
    for (const entry of materialized.entries) {
      const units = createPlannerRouteUnitPlans([entry], engine).unitPlans.get(entry.id)!
      const route = routes.find(value => value.targetWeaponId === entry.targetWeaponId)!
      expect(routeOperationsAsOracle(entry.candidateSnapshot.route.operations)).toEqual(expandOracleOperations(route.operations))
      expect(units.filter(unit => !unit.canSkipWhenCounterPassed).map(unit => unit.counterBefore))
        .toEqual([route.required.normal, ...route.required.skill, ...route.required.gogma])
    }
  })
})

describe('Phase 2-A.5 oracle verification stages (synthetic fixture)', () => {
  it('passes Stage A with Counter continuity, distinct sources and Ideal results, counting physical operations per stream', async () => {
    const { input, engine, routes } = await fixture()
    const rng = verifyOracleRng(input, engine, routes)
    expect(rng.errors).toEqual([])
    expect(rng.targets.map(target => target.errors)).toEqual([[], []])
    expect(rng.passed).toBe(true)
    expect(rng.streams.skill).toEqual({ start: 7, end: 9, advance: 2, gaps: [], duplicateRequired: [] })
    expect(rng.streams.gogma).toEqual({ start: 10, end: 12, advance: 2, gaps: [], duplicateRequired: [] })
    expect(rng.physicalOperations).toBe(6)
    expect(rng.routeOperationSum).toBe(6)
    expect(rng.targets.every(target => target.idealFull && target.idealRequiredOnly)).toBe(true)
  })

  it('fails closed on duplicate sources, duplicate required positions, uncovered positions and wrong required units', async () => {
    const { input, engine, routes } = await fixture()
    const [a, b] = routes as [OracleRouteSpec, OracleRouteSpec]
    const sameNormal = verifyOracleRng(input, engine, [a, { ...b, source: { kind: 'new_normal', normalPosition: 4 },
      operations: [{ type: 'create_normal_artian', from: 4, to: 4 }, ...b.operations.slice(1)], required: { ...b.required, normal: 4 } }])
    expect(sameNormal.passed).toBe(false)
    expect(sameNormal.duplicateNormalSources).toEqual(['weapon.fixture.a:4'])
    expect(sameNormal.errors.join('\n')).toMatch(/position required by two Routes/)
    const sameGogma = verifyOracleRng(input, engine, [a, { ...b, operations: [b.operations[0]!, b.operations[1]!, { type: 'reset_bonuses', from: 10, to: 10 }], required: { ...b.required, gogma: [10] } }])
    expect(sameGogma.passed).toBe(false)
    expect(sameGogma.streams.gogma.duplicateRequired).toEqual([10])
    const gap = verifyOracleRng(input, engine, [a, { ...b, operations: [b.operations[0]!, { type: 'convert_normal_to_gogma', from: 9, to: 9 }, b.operations[2]!], required: { ...b.required, skill: [9] } }])
    expect(gap.passed).toBe(false)
    expect(gap.streams.skill.gaps).toEqual([8])
    const wrongRequired = verifyOracleRng(input, engine, [a, { ...b, required: { ...b.required, gogma: [10, 11] } }])
    expect(wrongRequired.passed).toBe(false)
    expect(wrongRequired.targets[1]!.errors.join('\n')).toMatch(/Required positions/)
    const sameOwned = verifyOracleRng({ ...input, ownedWeapons: [] }, engine, [{ ...a, source: { kind: 'owned', ownedWeaponId: 'owned.missing' } }, b])
    expect(sameOwned.passed).toBe(false)
    expect(sameOwned.targets[0]!.errors).toContain('Source OwnedWeapon does not exist.')
  })

  it('reports an unsupported (non-Ideal) prediction instead of passing', async () => {
    const { input, engine, routes } = await fixture()
    const [a, b] = routes as [OracleRouteSpec, OracleRouteSpec]
    const broken = verifyOracleRng(input, engine, [a, { ...b, operations: [...b.operations.slice(0, 2), { type: 'reset_bonuses', from: 11, to: 12 }], required: { ...b.required, gogma: [12] } }])
    expect(broken.passed).toBe(false)
    expect(broken.targets[1]!.errors.join('\n')).toMatch(/Prediction failed/)
  })

  it('materializes through Candidate Search and Planner Alternative Search, then plans and replays the trace', async () => {
    const { input, engine, routes } = await fixture()
    const rng = verifyOracleRng(input, engine, routes)
    const materialized = await materializeOracleRoutes(input, engine, routes, rng, { nowMs: () => 0 })
    expect(materialized.targets.map(target => [target.method, target.error, target.matches])).toEqual(routes.map(route => [route.materialization, null,
      { operations: true, estimated: true, finalWeapon: true, requiredUnits: true, routeKind: true, source: true }]))
    expect(materialized.passed).toBe(true)
    expect(materialized.targets[1]!.deliveredCandidates).toBe(1)
    const planner = await runOraclePlanner(input, globalResearchDependencies(engine), materialized.entries, 100, { nowMs: () => 0 })
    expect(planner).toMatchObject({ error: null, excludedBuildListEntries: 0, steps: 6, physicalSteps: 6, selectedBuildListEntries: 2, conflicts: 0,
      rejectedBuildListEntries: 0, resourceConflictRejections: 0, warnings: [], fullPlannerRuns: 1, traceReplay: { isValid: true, issues: 0 } })
    expect(planner.termination).toMatchObject({ status: 'completed', completedTargetCount: 2, totalTargetCount: 2 })
    expect(planner.stepOperationCounts).toEqual({ create_normal_artian: 2, convert_normal_to_gogma: 2, reset_bonuses: 2 })
  })
})

/** The committed formal evidence of the real Export run (`scripts/run-planner-global-oracle-1657.mjs`). */
const evidence = Object.values(import.meta.glob('../../docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json', { eager: true, import: 'default' }))[0] as {
  verdict: string
  environment: { repositoryHead: string; uncommittedResearchCode: boolean; exportSha256: string }
  summary: { physicalOperations: number; stageA: { passed: boolean }; stageB: { passed: boolean }; materializedBy: Record<string, number>
    stageC: { termination: { status: string; completedTargetCount: number }; steps: number; physicalSteps: number; selectedBuildListEntries: number
      conflicts: number; rejectedBuildListEntries: number; resourceConflictRejections: number; warnings: string[]; traceReplay: { isValid: boolean } } }
  lowerBound: { crossSatisfaction: { planningTargetCount: number; possiblePairCount: number; possiblePairs: unknown[]; distinctSourcePreconditionHolds: boolean }
    relaxation: { status: string; provenAtLeast: number | null; minimum: { total: number } | null } }
}

describe('Phase 2-A.5 formal evidence (real Export)', () => {
  it('records a clean-HEAD run whose distinct-source precondition held and whose bound equals the Production Plan', () => {
    expect(evidence.environment.exportSha256).toBe(ORACLE_1657_EXPORT_SHA256)
    expect(evidence.environment.repositoryHead).toMatch(/^[0-9a-f]{40}$/)
    expect(evidence.environment.uncommittedResearchCode).toBe(false)
    expect(evidence.lowerBound.crossSatisfaction).toMatchObject({ planningTargetCount: 43, possiblePairCount: 0, possiblePairs: [], distinctSourcePreconditionHolds: true })
    expect(evidence.lowerBound.relaxation).toMatchObject({ status: 'found', provenAtLeast: ORACLE_1657_PHYSICAL_OPERATIONS, minimum: { total: ORACLE_1657_PHYSICAL_OPERATIONS } })
    expect(evidence.summary.stageA.passed).toBe(true)
    expect(evidence.summary.stageB.passed).toBe(true)
    expect(evidence.summary.materializedBy).toEqual({ candidateSearch: 25, plannerAlternativeSearch: 18 })
    expect(evidence.summary.physicalOperations).toBe(ORACLE_1657_PHYSICAL_OPERATIONS)
    expect(evidence.summary.stageC).toMatchObject({ termination: { status: 'completed', completedTargetCount: 43 }, steps: 1657, physicalSteps: 1657,
      selectedBuildListEntries: 43, conflicts: 0, rejectedBuildListEntries: 0, resourceConflictRejections: 0, warnings: [], traceReplay: { isValid: true } })
    expect(evidence.verdict).toBe('proven_minimum')
  })
})

describe('Phase 2-A.5 verdict', () => {
  const planner: OracleVerdictInput['planner'] = { error: null, selectedBuildListEntries: 2, conflicts: 0, rejectedBuildListEntries: 0, warnings: [],
    traceReplay: { isValid: true, issues: 0, drafts: 6 }, physicalSteps: 6,
    termination: { status: 'completed', reachedLimits: [], limits: { maxPlanSteps: 100 }, expandedStates: 6, completedTargetCount: 2, totalTargetCount: 2 } }
  const base: OracleVerdictInput = { rngPassed: true, materializationPassed: true, planner, routeCount: 2, oraclePhysicalOperations: 6, lowerBoundTotal: 6 }

  it('calls an oracle minimal only when a proven lower bound equals its Production Plan', () => {
    expect(classifyOracleVerdict(base)).toBe('proven_minimum')
    expect(classifyOracleVerdict({ ...base, lowerBoundTotal: 5 })).toBe('validated_oracle')
    expect(classifyOracleVerdict({ ...base, lowerBoundTotal: null })).toBe('validated_oracle')
    expect(classifyOracleVerdict({ ...base, oraclePhysicalOperations: 7 })).toBe('validated_oracle')
  })

  it('never validates an oracle the Production Planner did not complete cleanly', () => {
    expect(classifyOracleVerdict({ ...base, rngPassed: false })).toBe('oracle_not_validated')
    expect(classifyOracleVerdict({ ...base, materializationPassed: false })).toBe('oracle_not_validated')
    expect(classifyOracleVerdict({ ...base, planner: { ...planner, conflicts: 1 } })).toBe('oracle_not_validated')
    expect(classifyOracleVerdict({ ...base, planner: { ...planner, traceReplay: { isValid: false, issues: 1, drafts: 0 } } })).toBe('oracle_not_validated')
    expect(classifyOracleVerdict({ ...base, planner: { ...planner, termination: { ...planner.termination!, status: 'exhausted', completedTargetCount: 1 } } })).toBe('oracle_not_validated')
    expect(classifyOracleVerdict({ ...base, planner: { ...planner, warnings: ['max_steps_reached'] } })).toBe('oracle_not_validated')
  })
})
