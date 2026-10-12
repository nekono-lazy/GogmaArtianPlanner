import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import { defaultPlannerAlternativeTrialBounds } from '../../domain/planner/alternative/plannerAlternativeTrial'
import { defaultPlannerOptions } from '../../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../../domain/search/alternative'

/*
 * Issue #154 Global Assignment (design 11 / 16): Research only. Nothing Production reaches these modules,
 * the runtime modules read no oracle manifest / result, no Target or weapon ID, no file, network or
 * persistence, and no clock or random value. The lower-bound module is read only by the designated Phase
 * B-2 root bound stage and its tests; the designated runner script is the only script that reaches this folder.
 */
const production = {
  ...import.meta.glob('../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const research = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const runtime = Object.entries(research).filter(([path]) => !/\.test\.ts$|[tT]estFixture\.ts$/.test(path))
const scripts = import.meta.glob('../../../scripts/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const RUNNER_SCRIPT = '../../../scripts/run-planner-global-assignment-b2a.mjs'
/** The Phase B-2A modules around the Phase A / B-1 calculation: runner orchestration, root bound stage, window policy, protocol. */
const PHASE_B2A_MODULES = ['./assignmentProtocol.ts', './assignmentRootBound.ts', './assignmentRunner.ts', './assignmentWindowPolicy.ts']

describe('Global Assignment Research isolation', () => {
  it('is imported by no Production module and by no script other than the designated Phase B-2A runner', () => {
    const productionPaths = Object.keys(production).filter(path => !/\.test\.tsx?$/.test(path))
    expect(productionPaths.length).toBeGreaterThan(100)
    const forbidden = /globalAssignment|GlobalAssignment|buildReachTable|enumerateReachOptions|replayReachOptionRequiredOnly|ReachTable|ResourceAssignment|createResourceAssignmentSearch|collectResourceAssignments|runAssignmentOnly|measureRootLowerBound|checkStreamCoverage|buildStructuralCandidate|StructuralCandidate|ExpectedRouteShape/
    expect(productionPaths.filter(path => forbidden.test(production[path]!))).toEqual([])
    expect(Object.keys(scripts).filter(path => path !== RUNNER_SCRIPT && forbidden.test(scripts[path]!))).toEqual([])
    expect(scripts[RUNNER_SCRIPT]).toBeDefined()
  })

  it('has the expected runtime modules, each reading only the PlannerInput, the Engine and the Production authorities', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual([
      './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentProtocol.ts', './assignmentRootBound.ts', './assignmentRunner.ts',
      './assignmentSolver.ts', './assignmentTypes.ts', './assignmentWindowPolicy.ts', './context.ts', './coverage.ts', './coverageTypes.ts', './reachOptions.ts', './reachTable.ts',
      './requiredOnlyReplay.ts', './structuralCandidate.ts', './types.ts',
    ])
    for (const [path, source] of runtime) {
      // No oracle manifest / verifier / RESULT, no earlier Phase result; the lower-bound module only in the designated stage (checked below).
      expect(source, path).not.toMatch(/plannerGlobalOracle|ORACLE_1657|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|\.json['"]/)
      // No Target / OwnedWeapon ID, Export hash or UUID literal.
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      // No file, network or persistence read, no clock, no random value, no enumeration ordinal as identity.
      expect(source, path).not.toMatch(/readFile|fetch\(|indexedDB|Dexie|localStorage|sessionStorage|from ['"][^'"]*(?:\/db\/|repositories|importExportService)/)
      expect(source, path).not.toMatch(/Math\.random|Date\.now|new Date\(|randomUUID|performance\.now/)
      // Only Production Domain authorities and this folder are imported (the root bound stage adds the lower-bound module): no Production Search / Planner module is re-implemented.
      const allowed = path === './assignmentRootBound.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalLowerBound$/ : /^\.\/|^\.\.\/\.\.\/domain\//
      for (const match of source.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(allowed)
    }
    // The Phase A / B-1 / B-2A runtime never reads the existing Entries' Route contents (design 4.1): only the context does, through the Production validation.
    for (const [path, source] of runtime.filter(([path]) => path !== './context.ts' && path !== './types.ts')) {
      expect(source, path).not.toMatch(/candidateSnapshot|\.route\b|buildListEntries\b(?!\.length)/)
    }
    // The Phase B-1 solver reads the ReachTable and the planning Targets' id / priority only: no PlannerInput, Engine, Master or Entry (design 6 / 11).
    for (const path of ['./assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts']) {
      expect(research[path], path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
      for (const match of research[path]!.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\//)
    }
  })

  it('lets only the Phase B-2 root bound stage and its parity tests read the lower-bound module', () => {
    const readers = Object.keys(research).filter(path => /plannerGlobalLowerBound/.test(research[path]!)).sort()
    expect(readers).toEqual(['./assignmentRootBound.test.ts', './assignmentRootBound.ts', './reachTable.test.ts'])
  })

  it('keeps the Phase B-2A runner an assignment-only calculation: no Planner, Search or Trace Replay, and no upper bound to the solver', () => {
    for (const path of PHASE_B2A_MODULES) {
      expect(research[path], path).toBeDefined()
      expect(research[path], path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|candidateSearch|search\/alternative|constrainedCandidate|createProductionPlan|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates/)
      expect(research[path], path).not.toMatch(/readVerifiedUpperBound|production_verified_plan|'verified'|'proven_minimum'/)
    }
    // The solver request built by the runner carries no VerifiedUpperBound and the literal flag says so.
    expect(research['./assignmentRunner.ts']).toMatch(/upperBoundSupplied: false as const/)
    // The root bound stage returns no field a VerifiedUpperBound has.
    expect(research['./assignmentRootBound.ts']).not.toMatch(/physicalOperations\s*[:=]|provenance\s*[:=]/)
  })

  it('keeps the designated runner script free of the oracle, the lower-bound module, a post-hoc argument and hard-coded hashes', () => {
    const runner = scripts[RUNNER_SCRIPT]!
    expect(runner).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum/)
    expect(runner).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(runner).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(runner).toMatch(/new ProductionRngEngine\(\)/)
    expect(runner).not.toMatch(/FakeRngEngine/)
  })

  it('keeps Phase C-1 a post-processing of resource assignments: no Search, Planner, reservation or upper bound', () => {
    const phaseC1 = ['./coverage.ts', './coverageTypes.ts', './structuralCandidate.ts']
    for (const path of phaseC1) {
      expect(research[path], path).toBeDefined()
      expect(research[path], path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|candidateSearch|search\/alternative|constrainedCandidate|createProductionPlan|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates|plannerRouteProgress|plannerAlternativeReservation|derivePlannerAlternativeReservation/)
      expect(research[path], path).not.toMatch(/readVerifiedUpperBound|production_verified_plan|VerifiedUpperBound/)
      // No change to the Phase B-1 search: the solver, its value order and its lower bound are not imported.
      expect(research[path], path).not.toMatch(/from '\.\/(?:assignmentSolver|assignmentOrdering|assignmentLowerBound|assignmentRunner|assignmentRootBound|reachTable)'/)
    }
    // The coverage pre-check is pure: no Engine, no PlannerInput, no prediction; only this folder and the ID types.
    expect(research['./coverage.ts']).not.toMatch(/RngEngine|predict[A-Z]|plannerInput|\.master\b|ownedWeapons|normalCounters|rngState/)
    for (const match of research['./coverage.ts']!.matchAll(/from '([^']+)'/g)) expect(match[1]).toMatch(/^\.\/|^\.\.\/\.\.\/domain\/models\/publicTypes$/)
    // The structural candidate reads RNG only through the one required-only replay authority.
    expect(research['./structuralCandidate.ts']).not.toMatch(/\.predict[A-Z]/)
    expect(research['./structuralCandidate.ts']).toMatch(/replayReachOptionRequiredOnly\(/)
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
