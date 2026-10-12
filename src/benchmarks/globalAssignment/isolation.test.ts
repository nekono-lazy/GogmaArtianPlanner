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
/** The Phase D-0A materialization modules: the only runtime modules that read a (generated) Entry's Route or run a Search. */
const PHASE_D0A_MODULES = ['./materializationScale.ts', './materializationShape.ts', './materializationTypes.ts', './materialize.ts']

describe('Global Assignment Research isolation', () => {
  it('is imported by no Production module and by no script other than the designated Phase B-2A runner', () => {
    const productionPaths = Object.keys(production).filter(path => !/\.test\.tsx?$/.test(path))
    expect(productionPaths.length).toBeGreaterThan(100)
    const forbidden = /globalAssignment|GlobalAssignment|buildReachTable|enumerateReachOptions|replayReachOptionRequiredOnly|ReachTable|ResourceAssignment|createResourceAssignmentSearch|collectResourceAssignments|runAssignmentOnly|measureRootLowerBound|checkStreamCoverage|buildStructuralCandidate|StructuralCandidate|ExpectedRouteShape|materializeStructuralCandidate|MaterializationOutcome|matchExpectedShape|predictSearchScale/
    expect(productionPaths.filter(path => forbidden.test(production[path]!))).toEqual([])
    expect(Object.keys(scripts).filter(path => path !== RUNNER_SCRIPT && forbidden.test(scripts[path]!))).toEqual([])
    expect(scripts[RUNNER_SCRIPT]).toBeDefined()
  })

  it('has the expected runtime modules, each reading only the PlannerInput, the Engine and the Production authorities', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual([
      './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentProtocol.ts', './assignmentRootBound.ts', './assignmentRunner.ts',
      './assignmentSolver.ts', './assignmentTypes.ts', './assignmentWindowPolicy.ts', './context.ts', './coverage.ts', './coverageSearch.ts', './coverageSearchTypes.ts',
      './coverageTypes.ts', './materializationScale.ts', './materializationShape.ts', './materializationTypes.ts', './materialize.ts', './reachOptions.ts', './reachTable.ts',
      './requiredOnlyReplay.ts', './structuralCandidate.ts', './structuralSearch.ts', './structuralWindowPolicy.ts', './types.ts',
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
      // Only Production Domain authorities and this folder are imported (the root bound stage adds the lower-bound module, the D-0A
      // materialization the existing Phase 0 origin-reach adapter): no Production Search / Planner module is re-implemented.
      const allowed = path === './assignmentRootBound.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalLowerBound$/
        : path === './materialize.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalOptimizationResearch$/
          : /^\.\/|^\.\.\/\.\.\/domain\//
      for (const match of source.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(allowed)
    }
    // The Phase A - C runtime never reads the existing Entries' Route contents (design 4.1): only the context does, through the Production
    // validation. Phase D-0A reads the Route of the Entries it generates (checked below).
    for (const [path, source] of runtime.filter(([path]) => path !== './context.ts' && path !== './types.ts' && !PHASE_D0A_MODULES.includes(path))) {
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

  it('keeps Phase C-2 a coverage-gated assignment search: no Search, Planner, reservation or materialization, and no unverified upper bound', () => {
    const phaseC2 = ['./coverageSearch.ts', './coverageSearchTypes.ts', './structuralSearch.ts', './structuralWindowPolicy.ts']
    for (const path of phaseC2) {
      expect(research[path], path).toBeDefined()
      expect(research[path], path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|candidateSearch|search\/alternative|constrainedCandidate|createProductionPlan|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates|plannerRouteProgress|plannerAlternativeReservation|derivePlannerAlternativeReservation/)
      // No verified / proven claim, and no structural or coverage-feasible objective ever becomes a VerifiedUpperBound.
      expect(research[path], path).not.toMatch(/production_verified_plan|'verified'|'proven_minimum'/)
      // The registered Phase B-2A / B-2B runner path is neither imported nor changed by Phase C-2.
      expect(research[path], path).not.toMatch(/from '\.\/(?:assignmentRunner|assignmentRootBound|assignmentWindowPolicy)'/)
    }
    // The coverage-gated search reads the ReachTable and the planning Targets only: no Engine, PlannerInput, Master or Entry.
    for (const path of ['./coverageSearch.ts', './coverageSearchTypes.ts', './structuralWindowPolicy.ts']) {
      expect(research[path], path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
    }
    // The upper bound is forwarded from the caller only; the coverage-gated search never builds one.
    expect(research['./coverageSearch.ts']).not.toMatch(/physicalOperations\s*[:=]|provenance\s*[:=]/)
    // The structural layer reads RNG only through the Phase C-1 builder (and so the one required-only replay authority).
    expect(research['./structuralSearch.ts']).not.toMatch(/\.predict[A-Z]|replayReachOptionRequiredOnly/)
    expect(research['./structuralSearch.ts']).toMatch(/buildStructuralCandidate\(/)
    // The Phase B-2A runner keeps the Phase B-1 value order: it never opts into the coverage-driven ordering.
    expect(research['./assignmentRunner.ts']).not.toMatch(/readPriorityConversionPosition|coverageDrivenOrdering|createCoverageSearch|createStructuralCandidateSearch/)
  })

  it('keeps Phase D-0A a materialization through the formal Search APIs: no Planner run, Trace Replay, conflict resolution or edited reservation', () => {
    // The forbidden-symbol checks read code only: the module comments name what the modules deliberately do not do.
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D0A_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      // No Planner run, scheduler, Trace Replay, fresh Planner verification or Phase 0 runner (Phase D' and the runner are later Phases).
      expect(source, path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|createProductionPlan|replayPlannerSearchTrace|runGlobalPlannerResearch|verifyGlobalResearchFreshPlan|summarizePlanPhysical/)
      // No explicit resolution, repair lineage, persistence or user-fixed Route: the speculative Entries stay Research data (G1).
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictResolutions|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      // No verified / proven claim and no upper bound: D-0A ends before the Planner.
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|'verified'|'proven_minimum'/)
      // The registered B-2A / B-2B runner path and the B-1 / C-2 search are neither imported nor changed.
      expect(source, path).not.toMatch(/from '\.\/(?:assignmentRunner|assignmentRootBound|assignmentWindowPolicy|assignmentSolver|assignmentOrdering|coverageSearch|structuralSearch)'/)
      // No reservation is assembled by hand: held / blocked come only from the formal empty value or derivePlannerAlternativeReservation().
      expect(source, path).not.toMatch(/held:\s*\[|blocked:\s*\[|\.held\.push|\.blocked\.push/)
    }
    const materialize = research['./materialize.ts']!
    expect(materialize).toMatch(/derivePlannerAlternativeReservation\(materializedEntries, inputs\.engine\)/)
    expect(materialize).toMatch(/structuredClone\(emptyPlannerAlternativeReservation\)/)
    expect(materialize).toMatch(/excludedRouteKeys: \[\]/)
    expect(materialize).not.toMatch(/excludedRouteKeys: \[[^\]]/)
    // The Search is only the Production APIs (injectable for tests), and the projected method only the existing origin-reach adapter.
    expect(materialize).toMatch(/visitPlannerAlternativeCandidates, searchCandidates \}/)
    expect(materialize).toMatch(/materializeGlobalResearchCandidate\(context\.plannerInput, searchInput, candidate, GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM\)/)
    for (const match of materialize.matchAll(/import \{([^}]+)\} from '\.\.\/plannerGlobalOptimizationResearch'/g)) {
      expect(match[1]!.split(',').map(name => name.trim()).sort()).toEqual(['GLOBAL_RESEARCH_TIME', 'materializeGlobalResearchCandidate'])
    }
    // The PlannerInput's own Entries are read once, for the materializer's ID-collision / reuse rule only (design 9.4).
    const entryReads = PHASE_D0A_MODULES.flatMap(path => [...research[path]!.matchAll(/buildListEntries\b(?!\.length)/g)].map(() => path))
    expect(entryReads).toEqual(['./materialize.ts'])
    expect(materialize).toMatch(/function collisionCheckEntries\(context: GlobalAssignmentContext\): readonly BuildListEntry\[\] \{\n {2}return context\.plannerInput\.buildListEntries\n\}/)
    // No RNG prediction of its own: the Engine reaches the Search, the unit plans and the Phase C builder only.
    for (const path of PHASE_D0A_MODULES) expect(research[path], path).not.toMatch(/\.predict[A-Z]/)
    // Scale prediction uses the Search's own legal-position primitives.
    expect(research['./materializationScale.ts']).toMatch(/from '\.\.\/\.\.\/domain\/search\/counterReservation'/)
    expect(research['./materializationScale.ts']).toMatch(/nextOperationPositions\(/)
    expect(research['./materializationScale.ts']).toMatch(/heldPrefixNormalCreation\(/)
    // Required positions come from the Planner's unit plans only.
    expect(research['./materializationShape.ts']).toMatch(/createPlannerRouteUnitPlans\(\[entry\], engine\)/)
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
