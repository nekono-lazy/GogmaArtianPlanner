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
/**
 * Issue #260 PR-2: the Phase 0 - C calculation moved to the Production Domain module below; this folder keeps a thin
 * adapter per moved module (same path, same Research API) and everything Research-only. The module is read by its own
 * `./x.ts` names, so the checks that followed the calculation keep their meaning there.
 */
const OPTIMIZATION_DIR = '../../domain/planner/buildListOptimization/'
const optimization = Object.fromEntries(Object.entries(import.meta.glob('../../domain/planner/buildListOptimization/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
  .filter(([path]) => !/\.test\.ts$/.test(path)).map(([path, source]) => [path.replace(OPTIMIZATION_DIR, './'), source]))
/** The Research files of the moved Phase 0 - C modules: adapters of the Production module, no calculation of their own. */
const PHASE_0_C_ADAPTERS = [
  './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts', './assignmentTypes.ts', './context.ts', './coverage.ts',
  './coverageSearch.ts', './coverageSearchTypes.ts', './coverageTypes.ts', './reachOptions.ts', './reachTable.ts', './requiredOnlyReplay.ts', './structuralCandidate.ts',
  './structuralSearch.ts', './types.ts',
]
/** The Production module's Stage 0 - C files (Issue #260 PR-2), held to the strictest import rule below. */
const STAGE_0_C_MODULES = [
  './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts', './assignmentTypes.ts', './buildListOptimizationTypes.ts',
  './coverage.ts', './coverageSearch.ts', './coverageSearchTypes.ts', './coverageTypes.ts', './index.ts', './planningContext.ts', './reachOptions.ts', './reachTable.ts',
  './requiredOnlyReplay.ts', './structuralCandidate.ts', './structuralSearch.ts',
]
/** Issue #260 PR-3: Stage D (route generation; the Research rule `d0a2-v2` moved here) in the Production module. */
const STAGE_D_MODULES = [
  './countingRngEngine.ts', './projectedRouteGeneration.ts', './projectedSearchScale.ts', './routeGeneration.ts', './routeGenerationTypes.ts', './routeShape.ts',
  './shapeConstrainedRequest.ts', './shapeConstrainedRun.ts', './shapeRouteCheck.ts', './shapeSearchScale.ts',
]
/** Issue #260 PR-3: Stage D' (the final verification by the ordinary Planner), the result types and the whole calculation. */
const STAGE_D_PRIME_MODULES = ['./buildListOptimizationResult.ts', './finalVerification.ts', './optimizationInputScope.ts', './optimizeBuildList.ts', './planPhysicalOperations.ts']
/** Issue #260 PR-6A: the pure, state-independent artifact checks of the adoption save (the save itself is the Persistence Service's). */
const ADOPTION_MODULES = ['./buildListOptimizationAdoption.ts']
/** Research-only symbols (formal gates, pre-registrations, runners, RESULT derivations, oracle, root lower bound, Research option sets and names). */
const RESEARCH_ONLY_SYMBOLS = /globalAssignment|GlobalAssignment|global-assignment|reachWindowW0|REACH_OPTION_SET_A[12]|runAssignmentOnly|measureRootLowerBound|materializeStructuralCandidate|MaterializationOutcome|matchExpectedShape|predictSearchScale|runMaterializationSmoke|searchPolicyShapeOf|verifyShapeConstrainedRoute|runShapeConstrainedRequest|predictShapeSearchScale|createPredictionCountingEngine|continuationShapeOf|deriveD0cPublicResult|judgeD0cFormalValidity|verifyPlannerCandidate|judgeD1aRun|concludeD1aRun|d1aChildIntegrityIssues|MaterializedEntriesHandoff|onMaterializedEntries|PLANNER_VERIFICATION_D1C_PREREGISTRATION|d1cRegistrationFingerprint|summarizeVerificationPhysical|concludeD1cMeasurement|judgeD1cFormalValidity|d1cFormalStartGate|deriveD1cPublicResult|MATERIALIZATION_D0C_PREREGISTRATION|ASSIGNMENT_B2B_PREREGISTRATION|plannerGlobalLowerBound|plannerGlobalOracle|ORACLE_1657|plannerGlobal|GlobalResearch/
/**
 * The Phase 0 - C concepts moved to the Production module (Stage D / D' live there too since PR-3). Outside it, only the dedicated
 * Worker, its Client and the Application boundary of Issue #260 PR-4, and the adoption save of PR-6A, name them (the UI does not yet).
 */
const MOVED_PHASE_0_C_CONCEPTS = /buildReachTable|enumerateReachOptions|replayReachOptionRequiredOnly|ReachTable|ResourceAssignment|createResourceAssignmentSearch|collectResourceAssignments|checkStreamCoverage|buildStructuralCandidate|StructuralCandidate|ExpectedRouteShape|createBuildListOptimizationContext|BuildListOptimization/
/** Issue #260 PR-4: the Worker / Client / Application modules of the Build List global optimization (the measurement Worker included). */
const BUILD_LIST_OPTIMIZATION_CALLERS = [
  '../../workers/buildListOptimizationWorkerContracts.ts', '../../workers/buildListOptimization.worker.ts', '../../workers/buildListOptimization.worker.production.ts',
  '../../workers/buildListOptimization.worker.entry.ts', '../../workers/buildListOptimization.worker.benchmark.ts', '../../workers/buildListOptimization.worker.benchmark.entry.ts',
  '../../services/planner/buildListOptimizationWorkerClient.ts', '../../services/planner/buildListOptimizationService.ts',
  // Issue #260 PR-6A: the adoption save (inspect / save) beside the ordinary and repair saves.
  '../../services/planner/plannerResultPersistenceService.ts',
]
const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const scripts = import.meta.glob('../../../scripts/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const RUNNER_SCRIPT = '../../../scripts/run-planner-global-assignment-b2a.mjs'
/** The Phase D-0B materialization runner (its formal mode is Phase D-0C's). */
const D0B_RUNNER_SCRIPT = '../../../scripts/run-planner-global-assignment-d0b.mjs'
/** The Phase D-0C public RESULT derivation: reads the runner's raw outputs only (no Export, no calculation). */
const D0C_DERIVE_SCRIPT = '../../../scripts/derive-planner-global-assignment-d0c-result.mjs'
/** The Phase D-1A non-formal Phase D' runner (materialization re-run, Production Planner, independent Trace Replay, fresh Planner). */
const D1A_RUNNER_SCRIPT = '../../../scripts/run-planner-global-assignment-d1a.mjs'
/** The Phase D-1C formal integration acceptance runner (formal mode only: the D-1B registration, two complete runs of a first and a fresh child). */
const D1C_RUNNER_SCRIPT = '../../../scripts/run-planner-global-assignment-d1c.mjs'
/** The Phase D-1C public RESULT derivation: reads the runner's raw outputs only and re-derives their conclusion (no Export, no calculation). */
const D1C_DERIVE_SCRIPT = '../../../scripts/derive-planner-global-assignment-d1c-result.mjs'
/** The Production準備 P-2 Browser measurement analysis: reads the committed plan, the Browser raw records, the Node reference and the D-1C public RESULT (no Export, no calculation). */
const BROWSER_ANALYZE_SCRIPT = '../../../scripts/analyze-planner-global-assignment-browser.mjs'
/** The Phase D-1A modules: Phase D' in one process (verify.ts, the only module that runs the Production Planner) and its protocol. */
const PHASE_D1A_MODULES = ['./verificationProtocol.ts', './verify.ts']
/** The Phase D-1B module: the pre-registration of the D-1C formal measurement (plain data and pure checks; it runs nothing). */
const PHASE_D1B_MODULES = ['./verificationRegistration.ts']
/** The Phase D-1C modules: the formal contract (gates, validity, outcome, acceptance) and the public RESULT derivation (plain data and pure checks). */
const PHASE_D1C_MODULES = ['./verificationFormal.ts', './verificationFormalResult.ts']
/** The Phase D-0C formal contract and public RESULT derivation modules. */
const PHASE_D0C_MODULES = ['./materializationFormal.ts', './materializationFormalResult.ts']
/** The Phase B-2A modules around the Phase A / B-1 calculation: runner orchestration, root bound stage, window policy, protocol. */
const PHASE_B2A_MODULES = ['./assignmentProtocol.ts', './assignmentRootBound.ts', './assignmentRunner.ts', './assignmentWindowPolicy.ts']
/** The Phase D-0A materialization modules: the only runtime modules that read a (generated) Entry's Route or run a Search. */
const PHASE_D0A_MODULES = ['./materializationScale.ts', './materializationShape.ts', './materializationTypes.ts', './materialize.ts']
/** The Phase D-0B runner modules: orchestration, diagnostics and protocol around the D-0A materialization. */
const PHASE_D0B_MODULES = ['./materializationDiagnostics.ts', './materializationProtocol.ts', './materializationRunner.ts']
/** The Phase D-0A-2b shape-constrained materialization modules (rule `d0a2-v2`), apart from the D-0A orchestration in `materialize.ts`. */
const PHASE_D0A2B_MODULES = [
  './countingRngEngine.ts', './shapeMaterializationRequest.ts', './shapeMaterializationRun.ts', './shapeMaterializationScale.ts', './shapeMaterializationTypes.ts',
  './shapeRouteVerification.ts',
]

describe('Global Assignment Research isolation', () => {
  it('is imported by no Production module and by no script other than the designated Phase B-2A / D-0B / D-1A / D-1C runners and the D-0C / D-1C RESULT derivations (and the P-2 Browser analysis)', () => {
    const productionPaths = Object.keys(production).filter(path => !/\.test\.tsx?$/.test(path))
    expect(productionPaths.length).toBeGreaterThan(100)
    // Issue #260 PR-2 (design P-3 7.8): the Phase 0 - C concept names moved to Production, so the former ban of those names is replaced by
    // the import direction (no Production module imports a benchmark or the Research search adapter), the Research-only symbols, and the
    // confinement of the moved concepts to the Production module.
    // The benchmark harness entry points that live beside the app (`*.worker.benchmark*.ts`, the benchmark pages, built by the separate
    // benchmark Vite config only) are benchmark code, not Production modules; every other module is held to the boundary.
    const harness = /\.worker\.benchmark(?:\.entry)?\.ts$|BenchmarkPage\.tsx$|\/BenchmarkApp\.tsx$|\/benchmark\.tsx$/
    const modules = productionPaths.filter(path => !harness.test(path))
    expect(modules.length).toBeGreaterThan(100)
    expect(modules.filter(path => /from '[^']*\/(?:benchmarks|research)(?:\/[^']*)?'/.test(production[path]!))).toEqual([])
    expect(modules.filter(path => RESEARCH_ONLY_SYMBOLS.test(production[path]!))).toEqual([])
    expect(productionPaths.filter(path => !path.startsWith(OPTIMIZATION_DIR) && MOVED_PHASE_0_C_CONCEPTS.test(production[path]!)).sort()).toEqual([...BUILD_LIST_OPTIMIZATION_CALLERS].sort())
    expect(productionPaths.filter(path => path.startsWith(OPTIMIZATION_DIR)).length).toBeGreaterThan(15)
    // Scripts: only the designated runners and derivations reach this folder (the former name list, unchanged).
    const forbidden = /globalAssignment|GlobalAssignment|buildReachTable|enumerateReachOptions|replayReachOptionRequiredOnly|ReachTable|ResourceAssignment|createResourceAssignmentSearch|collectResourceAssignments|runAssignmentOnly|measureRootLowerBound|checkStreamCoverage|buildStructuralCandidate|StructuralCandidate|ExpectedRouteShape|materializeStructuralCandidate|MaterializationOutcome|matchExpectedShape|predictSearchScale|runMaterializationSmoke|searchPolicyShapeOf|verifyShapeConstrainedRoute|runShapeConstrainedRequest|predictShapeSearchScale|createPredictionCountingEngine|continuationShapeOf|deriveD0cPublicResult|judgeD0cFormalValidity|verifyPlannerCandidate|judgeD1aRun|concludeD1aRun|d1aChildIntegrityIssues|MaterializedEntriesHandoff|onMaterializedEntries|PLANNER_VERIFICATION_D1C_PREREGISTRATION|d1cRegistrationFingerprint|summarizeVerificationPhysical|concludeD1cMeasurement|judgeD1cFormalValidity|d1cFormalStartGate|deriveD1cPublicResult/
    expect(Object.keys(scripts).filter(path => ![RUNNER_SCRIPT, D0B_RUNNER_SCRIPT, D0C_DERIVE_SCRIPT, D1A_RUNNER_SCRIPT, D1C_RUNNER_SCRIPT, D1C_DERIVE_SCRIPT, BROWSER_ANALYZE_SCRIPT].includes(path) && forbidden.test(scripts[path]!))).toEqual([])
    expect(scripts[RUNNER_SCRIPT]).toBeDefined()
    expect(scripts[D0B_RUNNER_SCRIPT]).toBeDefined()
    expect(scripts[D0C_DERIVE_SCRIPT]).toBeDefined()
    expect(scripts[D1A_RUNNER_SCRIPT]).toBeDefined()
    expect(scripts[D1C_RUNNER_SCRIPT]).toBeDefined()
    expect(scripts[D1C_DERIVE_SCRIPT]).toBeDefined()
    expect(scripts[BROWSER_ANALYZE_SCRIPT]).toBeDefined()
  })

  it('has the expected runtime modules, each reading only the PlannerInput, the Engine and the Production authorities', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual([
      './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentProtocol.ts', './assignmentRootBound.ts', './assignmentRunner.ts',
      './assignmentSolver.ts', './assignmentTypes.ts', './assignmentWindowPolicy.ts', './context.ts', './countingRngEngine.ts', './coverage.ts', './coverageSearch.ts', './coverageSearchTypes.ts',
      './coverageTypes.ts', './materializationDiagnostics.ts', './materializationFormal.ts', './materializationFormalResult.ts', './materializationProtocol.ts', './materializationRunner.ts',
      './materializationScale.ts', './materializationShape.ts', './materializationTypes.ts', './materialize.ts', './reachOptions.ts', './reachTable.ts',
      './requiredOnlyReplay.ts', './shapeMaterializationRequest.ts', './shapeMaterializationRun.ts', './shapeMaterializationScale.ts', './shapeMaterializationTypes.ts',
      './shapeRouteVerification.ts', './structuralCandidate.ts', './structuralSearch.ts', './structuralWindowPolicy.ts', './types.ts', './verificationFormal.ts',
      './verificationFormalResult.ts', './verificationProtocol.ts', './verificationRegistration.ts', './verify.ts',
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
      // materialization the existing Phase 0 origin-reach adapter, the D-1A Phase D' the existing Phase 2-B physical summary):
      // no Production Search / Planner module is re-implemented.
      const allowed = path === './assignmentRootBound.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalLowerBound$/
        : path === './materialize.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalOptimizationResearch$/
          : path === './verify.ts' ? /^\.\/|^\.\.\/\.\.\/domain\/|^\.\.\/plannerGlobalPhase2BPlan$/
            : /^\.\/|^\.\.\/\.\.\/domain\//
      for (const match of source.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(allowed)
    }
    // The Phase A - C runtime never reads the existing Entries' Route contents (design 4.1): only the context does, through the Production
    // validation. Phase D-0A / D-0A-2b read the Route of the Entries they generate, and Phase D' (verify.ts) builds the final input from
    // the Build List through the Production replacement authority (checked below).
    for (const [path, source] of runtime.filter(([path]) => path !== './context.ts' && path !== './types.ts' && !PHASE_D0A_MODULES.includes(path) && path !== './shapeRouteVerification.ts' && !PHASE_D0C_MODULES.includes(path) && path !== './verificationFormalResult.ts' && path !== './verify.ts')) {
      expect(source, path).not.toMatch(/candidateSnapshot|\.route\b|buildListEntries\b(?!\.length)/)
    }
    // The same holds where the Phase A - C calculation now lives (the Stage 0 context reads the Entries through the Production validation only).
    // Issue #260 PR-3: Stage D reads the Route of the Entries it generates and hands the PlannerInput's own Entries to the materializer's
    // ID-collision / reuse rule only; Stage D' builds the final input from the Build List through the Production replacement authority
    // and derives the input token and the out-of-scope Target counts from it. No other file reads an Entry.
    expect(Object.keys(optimization).length).toBeGreaterThan(15)
    const entryReaders = Object.entries(optimization).filter(([, source]) => /candidateSnapshot|\.route\b|buildListEntries\b(?!\.length)/.test(source)).map(([path]) => path).sort()
    expect(entryReaders).toEqual([
      './finalVerification.ts', './optimizationInputScope.ts', './projectedRouteGeneration.ts', './routeGeneration.ts', './routeShape.ts', './shapeRouteCheck.ts',
    ])
    for (const path of entryReaders) expect([...STAGE_D_MODULES, ...STAGE_D_PRIME_MODULES], path).toContain(path)
    // Stage D reads the PlannerInput's own Entries once, for the ID-collision / reuse rule.
    expect([...codeOnly(optimization['./routeGeneration.ts']!).matchAll(/buildListEntries\b/g)]).toHaveLength(1)
    expect(optimization['./routeGeneration.ts']).toMatch(/collisionCheckEntries: inputs\.context\.plannerInput\.buildListEntries,/)
    // Phase D-0C names those keys only as strings its public RESULT must not carry; it reads no Entry, snapshot or Route either.
    for (const path of PHASE_D0C_MODULES) expect(research[path], path).not.toMatch(/\.candidateSnapshot|\.route\b|\.buildListEntries\b/)
    // Phase D-1C likewise names them only as keys its public RESULT must not carry.
    expect(research['./verificationFormalResult.ts']).not.toMatch(/\.candidateSnapshot|\.route\b|\.buildListEntries\b/)
    // The Phase B-1 solver reads the ReachTable and the planning Targets' id / priority only: no PlannerInput, Engine, Master or Entry (design 6 / 11).
    // It lives in the Production module (Issue #260 PR-2); the Research files of the same names are adapters of it (checked below).
    for (const path of ['./assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts']) {
      expect(optimization[path], path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
      for (const match of optimization[path]!.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\//)
      expect(research[path], path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
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

  it('keeps the designated runner scripts free of the oracle, the lower-bound module, a post-hoc argument and hard-coded hashes', () => {
    for (const path of [RUNNER_SCRIPT, D0B_RUNNER_SCRIPT]) {
      const runner = scripts[path]!
      expect(runner, path).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum/)
      expect(runner, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(runner, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(runner, path).toMatch(/new ProductionRngEngine\(\)/)
      expect(runner, path).not.toMatch(/FakeRngEngine/)
    }
    // The D-0B runner reaches the Research modules through its own runner / protocol only, never the registered B-2A path.
    expect(scripts[D0B_RUNNER_SCRIPT]).not.toMatch(/assignmentRunner|assignmentRootBound|assignmentProtocol|planner-global-assignment-b2a/)
  })

  it('keeps Phase D-0C a formal contract and a RESULT derivation: no calculation, no Search, no Planner, no Export, no file reading in the modules', () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D0C_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      expect(source, path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|createProductionPlan|replayPlannerSearchTrace|runGlobalPlannerResearch|verifyGlobalResearchFreshPlan/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictResolutions|savePlanner|Repository|from '[^']*\/services\//)
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|'verified'|'best_found'|'proven_minimum'/)
      // No RNG prediction, no Search, no materialization of its own: the formal contract reads what the runner observed.
      expect(source, path).not.toMatch(/\.predict[A-Z]|visitPlannerAlternativeCandidates|searchCandidates\(|visitShapeConstrainedRouteCandidates|materializeStructuralCandidate|runMaterializationSmoke|buildReachTable|new ProductionRngEngine/)
      expect(source, path).not.toMatch(/from '\.\/(?:materialize|shapeMaterializationRun|shapeRouteVerification|reachTable|structuralSearch|coverageSearch|assignmentSolver|assignmentRunner)'/)
    }
    // The registration HEAD is a commit, never an Export hash; the formal gate takes the registered conditions only.
    expect(research['./materializationFormal.ts']).toMatch(/MATERIALIZATION_D0C_REGISTRATION_HEAD = '[0-9a-f]{40}'/)
    expect(codeOf('./materializationFormal.ts')).toMatch(/registeredD0cConditions\(\)/)
    // The derivation script reads the runner's raw outputs and writes exclusively: no Export, no Engine, no oracle, no hard-coded hash.
    const derive = scripts[D0C_DERIVE_SCRIPT]!
    expect(derive).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum|--export|ProductionRngEngine|FakeRngEngine|runMaterializationSmoke|createProductionPlan/)
    expect(derive).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(derive).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(derive).toMatch(/flag: 'wx'/)
    expect(derive).toMatch(/deriveD0cPublicResult\(sources\)/)
    expect(derive).toMatch(/d0cPublicResultIssues\(/)
  })

  it('keeps Phase D-0B a materialization runner: no Planner run, Trace Replay, upper bound, conflict resolution or persistence', () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D0B_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      expect(source, path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|createProductionPlan|replayPlannerSearchTrace|runGlobalPlannerResearch|verifyGlobalResearchFreshPlan|summarizePlanPhysical/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictResolutions|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      // No verified / best_found / proven claim, and no upper bound reaches the structural search.
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|readVerifiedUpperBound|'verified'|'best_found'|'proven_minimum'/)
      expect(source, path).not.toMatch(/from '\.\/(?:assignmentRunner|assignmentRootBound|assignmentWindowPolicy|assignmentSolver|assignmentOrdering)'/)
      expect(source, path).not.toMatch(/held:\s*\[|blocked:\s*\[|\.held\.push|\.blocked\.push/)
      // No RNG prediction and no Search call of its own: the Searches run inside the D-0A materialization only.
      expect(source, path).not.toMatch(/\.predict[A-Z]|visitPlannerAlternativeCandidates\(|searchCandidates\(/)
    }
    const runnerModule = codeOf('./materializationRunner.ts')
    expect(runnerModule).toMatch(/materializeStructuralCandidate\(candidate, \{/)
    expect(runnerModule).toMatch(/searchPolicyPrecheck: conditions\.searchPolicyPrecheck/)
    expect(runnerModule).toMatch(/createStructuralCandidateSearch\(\{ table, context, engine \}, \{\n {4}nodeBudget: conditions\.nodeBudget, mrvLookahead: conditions\.mrvLookahead, coverageDrivenOrdering: conditions\.coverageDrivenOrdering,/)
    expect(runnerModule).toMatch(/upperBoundSupplied: false/)
    // G4 reads the Planner-start satisfaction through the one Production authority.
    expect(codeOf('./materializationDiagnostics.ts')).toMatch(/deriveTargetSatisfaction\(context\.planningTargets, input\.ownedWeapons, input\.master\)/)
  })

  // Phase C-1 / C-2 moved to the Production module (Issue #260 PR-2): the checks below read the calculation where it lives - the
  // Production module for a moved file, this folder for the Research-only window policy.
  const calculation = (path: string): string => optimization[path] ?? research[path]!

  it('keeps Phase C-1 a post-processing of resource assignments: no Search, Planner, reservation or upper bound', () => {
    const phaseC1 = ['./coverage.ts', './coverageTypes.ts', './structuralCandidate.ts']
    for (const path of phaseC1) {
      expect(optimization[path], path).toBeDefined()
      expect(calculation(path), path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|candidateSearch|search\/alternative|constrainedCandidate|createProductionPlan|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates|plannerRouteProgress|plannerAlternativeReservation|derivePlannerAlternativeReservation/)
      expect(calculation(path), path).not.toMatch(/readVerifiedUpperBound|production_verified_plan|VerifiedUpperBound/)
      // No change to the Phase B-1 search: the solver, its value order and its lower bound are not imported.
      expect(calculation(path), path).not.toMatch(/from '\.\/(?:assignmentSolver|assignmentOrdering|assignmentLowerBound|assignmentRunner|assignmentRootBound|reachTable)'/)
    }
    // The coverage pre-check is pure: no Engine, no PlannerInput, no prediction; only its own module and the ID types.
    expect(calculation('./coverage.ts')).not.toMatch(/RngEngine|predict[A-Z]|plannerInput|\.master\b|ownedWeapons|normalCounters|rngState/)
    for (const match of calculation('./coverage.ts').matchAll(/from '([^']+)'/g)) expect(match[1]).toMatch(/^\.\/|^\.\.\/\.\.\/models\/publicTypes$/)
    // The structural candidate reads RNG only through the one required-only replay authority.
    expect(calculation('./structuralCandidate.ts')).not.toMatch(/\.predict[A-Z]/)
    expect(calculation('./structuralCandidate.ts')).toMatch(/replayReachOptionRequiredOnly\(/)
  })

  it('keeps Phase C-2 a coverage-gated assignment search: no Search, Planner, reservation or materialization, and no unverified upper bound', () => {
    const phaseC2 = ['./coverageSearch.ts', './coverageSearchTypes.ts', './structuralSearch.ts', './structuralWindowPolicy.ts']
    expect(phaseC2.filter(path => optimization[path] !== undefined)).toEqual(['./coverageSearch.ts', './coverageSearchTypes.ts', './structuralSearch.ts'])
    for (const path of phaseC2) {
      expect(calculation(path), path).toBeDefined()
      expect(calculation(path), path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|candidateSearch|search\/alternative|constrainedCandidate|createProductionPlan|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates|plannerRouteProgress|plannerAlternativeReservation|derivePlannerAlternativeReservation/)
      // No verified / proven claim, and no structural or coverage-feasible objective ever becomes a VerifiedUpperBound.
      expect(calculation(path), path).not.toMatch(/production_verified_plan|'verified'|'proven_minimum'/)
      // The registered Phase B-2A / B-2B runner path is neither imported nor changed by Phase C-2.
      expect(calculation(path), path).not.toMatch(/from '\.\/(?:assignmentRunner|assignmentRootBound|assignmentWindowPolicy)'/)
    }
    // The coverage-gated search reads the ReachTable and the planning Targets only: no Engine, PlannerInput, Master or Entry.
    for (const path of ['./coverageSearch.ts', './coverageSearchTypes.ts', './structuralWindowPolicy.ts']) {
      expect(calculation(path), path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
    }
    // The upper bound is forwarded from the caller only; the coverage-gated search never builds one.
    expect(calculation('./coverageSearch.ts')).not.toMatch(/physicalOperations\s*[:=]|provenance\s*[:=]/)
    // The structural layer reads RNG only through the Phase C-1 builder (and so the one required-only replay authority).
    expect(calculation('./structuralSearch.ts')).not.toMatch(/\.predict[A-Z]|replayReachOptionRequiredOnly/)
    expect(calculation('./structuralSearch.ts')).toMatch(/buildStructuralCandidate\(/)
    // The Phase B-2A runner keeps the Phase B-1 value order: it never opts into the coverage-driven ordering.
    expect(research['./assignmentRunner.ts']).not.toMatch(/readPriorityConversionPosition|coverageDrivenOrdering|createCoverageSearch|createStructuralCandidateSearch/)
  })

  it('keeps the moved Phase 0 - C files thin adapters of the Production module: no calculation of their own (Issue #260 PR-2)', () => {
    for (const path of PHASE_0_C_ADAPTERS) {
      expect(research[path], path).toBeDefined()
      const code = codeOnly(research[path]!)
      // They reach the Production module, and otherwise only this folder, the W0 window's Candidate Search defaults and the Engine type.
      expect(code, path).toMatch(/from '\.\.\/\.\.\/domain\/planner\/buildListOptimization'/)
      for (const match of code.matchAll(/from '([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/[A-Za-z]+$|^\.\.\/\.\.\/domain\/planner\/buildListOptimization$|^\.\.\/\.\.\/domain\/models\/common$|^\.\.\/\.\.\/domain\/rng\/rngEngine$/)
      }
      // No loop, ordering, collection, prediction or Search: a re-export, a renamed re-export, or a call handing a Research table over.
      expect(code, path).not.toMatch(/\bfor \(|\bwhile \(|\.sort\(|new (?:Map|Set)\b|\.predict[A-Z]|visitPlannerAlternativeCandidates|searchCandidates|visitShapeConstrainedRouteCandidates|localeCompare/)
    }
    // Only the Research's own parts stay as values here: the option set identities, the W0 window and the table view conversion.
    expect(codeOnly(research['./types.ts']!)).toMatch(/REACH_OPTION_SET_A1 = 'global-assignment-reach-options:a1'/)
    expect(codeOnly(research['./types.ts']!)).toMatch(/REACH_OPTION_SET_A2 = 'global-assignment-reach-options:a2'/)
    expect(codeOnly(research['./types.ts']!)).toMatch(/return optionSet !== REACH_OPTION_SET_A1\n/)
    expect(codeOnly(research['./reachTable.ts']!)).toMatch(/export function reachWindowW0\(\)/)
    // Every moved module has its Production counterpart (the Research context is the Production Stage 0).
    for (const path of PHASE_0_C_ADAPTERS.filter(path => !['./types.ts', './context.ts'].includes(path))) expect(optimization[path], path).toBeDefined()
    expect(optimization['./planningContext.ts']).toBeDefined()
    expect(optimization['./buildListOptimizationTypes.ts']).toBeDefined()
  })

  it("keeps the Production module (Stage 0 - D') a pure Domain module: no Research, Service, persistence, clock, random value or locale-dependent order", () => {
    // Every file belongs to one stage explicitly (a new file is placed in one of them, with its import rule).
    expect(Object.keys(optimization).sort()).toEqual([...STAGE_0_C_MODULES, ...STAGE_D_MODULES, ...STAGE_D_PRIME_MODULES, ...ADOPTION_MODULES].sort())
    const stage0C = /^\.\/[A-Za-z]+$|^\.\.\/[A-Za-z]+$|^\.\.\/\.\.\/(?:models|rng|target|master)\/[A-Za-z/]+$/
    // Issue #260 PR-3: Stage D / D' add the public Production Search APIs (Candidate Search, Planner Alternative Search's reservation
    // primitives, the shape-constrained search), the Build List Entry factory and replacement authority, the Target evaluation and the
    // Planner's replacement / reservation primitives - never the Research Search adapter, a Service, a Worker or persistence.
    const stageD = /^\.\/[A-Za-z]+$|^\.\.\/[A-Za-z]+$|^\.\.\/\.\.\/(?:models|rng|target|master)\/[A-Za-z/]+$|^\.\.\/\.\.\/(?:buildList|target)$|^\.\.\/\.\.\/buildList\/buildListEntryReplacement$|^\.\.\/\.\.\/search\/(?:alternative|bonusStream|candidateFactory|candidateSearch|constrained|counterReservation|searchTypes|shapeConstrained)$|^\.\.\/(?:alternative\/plannerAlternativeReservation|replacement\/plannerDeterministicMaterializer|replacement\/plannerMaterializationErrors|replacement\/plannerSearchOrigin)$/
    for (const [path, source] of Object.entries(optimization)) {
      const code = codeOnly(source)
      // Only the Production Domain: this module, the Planner Domain and the Domain models, RNG, target and Master authorities (and, for
      // Stage D / D', the authorities above).
      for (const match of code.matchAll(/from '([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(STAGE_0_C_MODULES.includes(path) ? stage0C : stageD)
      }
      expect(source, path).not.toMatch(RESEARCH_ONLY_SYMBOLS)
      expect(source, path).not.toMatch(/research-shape-constrained-route-policy|candidate\.research\.|global-assignment-reach-options|plannerGlobalOracle|ORACLE_1657|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|\.json['"]/)
      expect(code, path).not.toMatch(/readFile|fetch\(|indexedDB|Dexie|localStorage|sessionStorage|Math\.random|Date\.now|new Date\(|randomUUID|performance\.now/)
      // Determinism across locales and engines (design P-3 7.6): every order is a code-unit or numeric comparison.
      expect(code, path).not.toMatch(/localeCompare|Intl\.|toLocale/)
      // No window, bound or default of its own from the Candidate Search defaults or a saved setting (PLANNER_SPEC 17.13).
      expect(code, path).not.toMatch(/recommendedCandidateSearchDefaults|candidateSearchDefaults|AppSettings/)
    }
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
    // The formal reservation of both rules is the Production Stage D derivation (Issue #260 PR-3): the empty value with no Entry,
    // otherwise derivePlannerAlternativeReservation() of the Entries before; the rule d0a-v1 reads that very derivation.
    expect(materialize).toMatch(/return deriveFormalReservation\(shape, materializedEntries, inputs\.engine\)/)
    expect(optimization['./routeGeneration.ts']).toMatch(/if \(generatedEntries\.length === 0\) return structuredClone\(emptyPlannerAlternativeReservation\)/)
    expect(optimization['./routeGeneration.ts']).toMatch(/return derivePlannerAlternativeReservation\(generatedEntries, engine\)/)
    expect(materialize).toMatch(/excludedRouteKeys: \[\]/)
    expect(materialize).not.toMatch(/excludedRouteKeys: \[[^\]]/)
    // The Search is only the Production APIs (injectable for tests), and the projected method only the existing origin-reach adapter.
    expect(materialize).toMatch(/visitPlannerAlternativeCandidates, searchCandidates \}/)
    // The projected Candidate is rebuilt at the Planner-start origin by the one Production authority (Issue #260 PR-3), which the Phase 0
    // origin-reach adapter calls too; the Research reads only its identity constants from that module.
    expect(optimization['./projectedRouteGeneration.ts']).toMatch(/entry = rebuildProjectedCandidateAtOrigin\(context\.plannerInput, searchInput, candidate, \{/)
    const researchImports = [...materialize.matchAll(/import \{([^}]+)\} from '\.\.\/plannerGlobalOptimizationResearch'/g)]
    expect(researchImports).toHaveLength(1)
    for (const match of researchImports) {
      expect(match[1]!.split(',').map(name => name.trim()).filter(Boolean).sort()).toEqual(['GLOBAL_RESEARCH_ORIGIN_CANDIDATE_ID_PREFIX', 'GLOBAL_RESEARCH_ORIGIN_IDENTITY_PREFIX', 'GLOBAL_RESEARCH_TIME'])
    }
    // The PlannerInput's own Entries are read once, for the materializer's ID-collision / reuse rule only (design 9.4).
    const entryReads = PHASE_D0A_MODULES.flatMap(path => [...research[path]!.matchAll(/buildListEntries\b(?!\.length)/g)].map(() => path))
    expect(entryReads).toEqual(['./materialize.ts'])
    expect(materialize).toMatch(/function collisionCheckEntries\(context: GlobalAssignmentContext\): readonly BuildListEntry\[\] \{\n {2}return context\.plannerInput\.buildListEntries\n\}/)
    // No RNG prediction of its own: the Engine reaches the Search, the unit plans and the Phase C builder only.
    for (const path of PHASE_D0A_MODULES) expect(research[path], path).not.toMatch(/\.predict[A-Z]/)
    // Scale prediction uses the Search's own legal-position primitives (in Stage D since Issue #260 PR-3; the Research file is its adapter).
    expect(optimization['./projectedSearchScale.ts']).toMatch(/from '\.\.\/\.\.\/search\/counterReservation'/)
    expect(optimization['./projectedSearchScale.ts']).toMatch(/nextOperationPositions\(/)
    expect(optimization['./projectedSearchScale.ts']).toMatch(/heldPrefixNormalCreation\(/)
    // Required positions come from the Planner's unit plans only.
    expect(optimization['./routeShape.ts']).toMatch(/createPlannerRouteUnitPlans\(\[entry\], engine\)/)
    for (const path of ['./materializationScale.ts', './materializationShape.ts']) {
      expect(codeOnly(research[path]!), path).toMatch(/from '\.\.\/\.\.\/domain\/planner\/buildListOptimization'/)
      expect(codeOnly(research[path]!), path).not.toMatch(/nextOperationPositions\(|heldPrefixNormalCreation\(|createPlannerRouteUnitPlans\(/)
    }
  })

  it('keeps Phase D-0A-2b a Research materialization: the seam alone, the formal reservation, predictions only in the counting wrapper and the Route checks', () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D0A2B_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      // No Planner run, scheduler, Trace Replay or fresh Planner verification (Phase D' / D-1 is the authority).
      expect(source, path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|createProductionPlan|replayPlannerSearchTrace|runGlobalPlannerResearch|verifyGlobalResearchFreshPlan/)
      // No explicit resolution, repair lineage, persistence or user-fixed Route.
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictResolutions|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      // No verified / best_found / proven claim.
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|'verified'|'best_found'|'proven_minimum'/)
      // No reservation assembled by hand: held / blocked come only from the formal derivation.
      expect(source, path).not.toMatch(/held:\s*\[|blocked:\s*\[|\.held\.push|\.blocked\.push/)
      // The rule d0a2-v2 never runs Planner Alternative Search (design 9.1 stays in d0a-v1 and the parity tests).
      expect(source, path).not.toMatch(/visitPlannerAlternativeCandidates|searchCandidates\(/)
      // The registered B-2A / B-2B runner path and the B-1 / C-2 search are neither imported nor changed.
      expect(source, path).not.toMatch(/from '\.\/(?:assignmentRunner|assignmentRootBound|assignmentWindowPolicy|assignmentSolver|assignmentOrdering|coverageSearch|structuralSearch|materialize)'/)
    }
    // Issue #260 PR-3: the calculation of these files moved to Stage D (they are its adapters, predicting nothing); there the counting
    // wrapper forwards predictions and the independent Route checks re-predict, and nothing else predicts.
    expect(PHASE_D0A2B_MODULES.filter(path => /\.predict[A-Z]/.test(codeOf(path)))).toEqual([])
    expect(STAGE_D_MODULES.filter(path => /\.predict[A-Z]/.test(codeOnly(optimization[path]!))).sort()).toEqual(['./countingRngEngine.ts', './shapeRouteCheck.ts'])
    for (const path of STAGE_D_MODULES) {
      const source = codeOnly(optimization[path]!)
      // No Planner run, scheduler or Trace Replay (Stage D' is the authority), no resolution, lineage or persistence, no formal claim.
      expect(source, path).not.toMatch(/productionPlanGeneration|plannerTraceReplay|plannerDeterministicSchedule|plannerBeamSearch|createProductionPlan|replayPlannerSearchTrace/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictResolutions|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|'verified'|'best_found'|'proven_minimum'/)
      // No reservation assembled by hand, and the rule d0a2-v2 never runs Planner Alternative Search (d0a-v1 stays Research).
      expect(source, path).not.toMatch(/held:\s*\[|blocked:\s*\[|\.held\.push|\.blocked\.push/)
      expect(source, path).not.toMatch(/visitPlannerAlternativeCandidates|createPlannerAlternativeSearchIdentity/)
    }
    // The shape-constrained method never runs Candidate Search (only the projected method does).
    for (const path of ['./shapeConstrainedRequest.ts', './shapeConstrainedRun.ts', './shapeRouteCheck.ts', './shapeSearchScale.ts']) expect(codeOnly(optimization[path]!), path).not.toMatch(/searchCandidates\(/)
    // The Research adapters reach the Stage D calculation through the Production module.
    expect(codeOf('./shapeMaterializationRun.ts')).toMatch(/executeShapeConstrainedRoute\(/)
    expect(codeOf('./shapeRouteVerification.ts')).toMatch(/checkShapeConstrainedRoute\(/)
    // The Search Domain is reached only through the Research seam's public module, by the run module.
    for (const path of PHASE_D0A2B_MODULES) {
      for (const match of research[path]!.matchAll(/from '(\.\.\/\.\.\/domain\/search\/[^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\.\/\.\.\/domain\/search\/(?:research|alternative|bonusStream|counterReservation|candidateFactory|searchTypes)$/)
      }
    }
    expect(codeOnly(optimization['./shapeConstrainedRun.ts']!)).toMatch(/\(deps\.visit \?\? visitShapeConstrainedRouteCandidates\)\(/)
    // The independent checks never read the Search's streams or scheduler, and derive the formal reservation again themselves.
    const checks = codeOnly(optimization['./shapeRouteCheck.ts']!)
    expect(checks).not.toMatch(/domain\/search\/research|bonusStream|skillStream|targetSearchScheduler|lazyIdealCross|visitShapeConstrainedRouteCandidates/)
    expect(checks).toMatch(/derivePlannerAlternativeReservation\(entries, engine\)/)
    expect(checks).toMatch(/createPlannerRouteUnitPlans\(\[entry\], engine\)/)
    // The Search's counting Engine is never the checks' Engine: their re-predictions never reach the Search budget.
    const run = codeOnly(optimization['./shapeConstrainedRun.ts']!)
    expect(run).toMatch(/checkShapeConstrainedRoute\(\{ entry, request, context, table: deps\.table, materializedEntries: deps\.materializedEntries, engine: deps\.engine \}\)/)
    expect(run).toMatch(/counting\.engine,\n/)
    // The formal reservation of both rules is derived in one place (Stage D) and handed to the request assembly unchanged.
    expect(optimization['./routeGeneration.ts']).toMatch(/const reservation = deriveFormalReservation\(shape, generatedEntries, inputs\.engine\)\n {2}return assembleShapeConstrainedRouteRequest\(/)
  })

  it("keeps Phase D-1A a Research Phase D': the Production Planner and Trace Replay only, no Search, no resolution, no persistence, no formal claim", () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D1A_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      // No Search, no materialization, no RNG prediction of its own: Phase D' judges the Entries it was handed.
      expect(source, path).not.toMatch(/visitPlannerAlternativeCandidates|searchCandidates\(|visitShapeConstrainedRouteCandidates|materializeStructuralCandidate\(|runMaterializationSmoke\(|buildReachTable|createStructuralCandidateSearch|\.predict[A-Z]/)
      // No other Planner than the Production one: no scheduler called directly, no Beam Search oracle, no fresh Planner helper of Phase 0.
      expect(source, path).not.toMatch(/runPlannerDeterministicSchedule|createPlannerDeterministicScheduleRun|plannerBeamSearch|runPlannerBeamSearch|createProductionPlanWithSearchRunner|verifyGlobalResearchFreshPlan|runGlobalPlannerResearch/)
      // No explicit resolution, repair lineage, persistence or user-fixed Route (design 16, G1); the final input's resolutions are [] only.
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\/|conflictResolutions: \[[^\]]/)
      // No formal claim: no best_found / proven_minimum, no upper bound to a structural search.
      expect(source, path).not.toMatch(/'best_found'|'proven_minimum'|VerifiedUpperBound|readVerifiedUpperBound|production_verified_plan/)
    }
    const verify = codeOf('./verify.ts')
    // Phase D' reaches the Production authorities directly (one each), and the Entry replacement is the Production one.
    expect(verify).toMatch(/productionPlannerVerificationPort: PlannerVerificationPort = Object\.freeze\(\{ createProductionPlanWithObserver, replayPlannerSearchTrace \}\)/)
    for (const call of ['validatePlannerInput(input, dependencies)', 'derivePlannerPlanningTargets(input.targetWeapons, validation.validBuildListEntries)', 'resolveBuildListEntryReplacement(original.buildListEntries, entry)',
      'applyBuildListEntryReplacements(original.buildListEntries, replacements, generated)', "validateBuildListEntryReplacements(finalEntries, replacements, 'replaced')", 'summarizePlanPhysical(plan, input)', 'validateBuildListEntry(entry)']) {
      expect(verify, call).toContain(call)
    }
    expect(verify).toMatch(/conflictResolutions: \[\],\n {4}options: \{ maxPlanSteps: conditions\.researchMaxPlanSteps \}/)
    // The protocol module runs nothing: no Planner, no Trace Replay.
    expect(codeOf('./verificationProtocol.ts')).not.toMatch(/productionPlanGeneration|plannerTraceReplay|createProductionPlan|replayPlannerSearchTrace|validatePlannerInput/)
    expect(codeOf('./verificationProtocol.ts')).toMatch(/proof: 'not_claimed'/)
    // The runner hands its Entries over execution-only (the semantic record is unchanged) and builds that handoff in one place.
    expect(codeOf('./materializationRunner.ts')).toMatch(/if \(returned !== null && execution\.onMaterializedEntries\) execution\.onMaterializedEntries\(materializedEntriesHandoff\(candidateIndex, candidate, context, table, returned\)\)/)
    // The D-1A runner: the registered D-0C conditions, the Production Engine, the Phase D' module and the judgement; no oracle, no hash,
    // no post-hoc argument, no Planner port, no resolution, exclusive writes and git-ignored outputs.
    const runner = scripts[D1A_RUNNER_SCRIPT]!
    expect(runner).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum|FakeRngEngine|conflictResolutions|PlannerConflictResolution|\bplanner\s*:/)
    expect(runner).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(runner).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(runner).toMatch(/new ProductionRngEngine\(\)/)
    expect(runner).toMatch(/protocol\.registeredD0cConditions\(\)/)
    expect(runner).toMatch(/runner\.runMaterializationSmoke\(input, research\.globalResearchDependencies\(engine\), \{ conditions \}/)
    expect(runner).toMatch(/verify\.verifyPlannerCandidate\(/)
    expect(runner).toMatch(/vp\.compareD0cMaterializationIdentity\(/)
    // One conclusion (verdict, classification, post hoc reading, exit code) with the integrity issues the parent found (PR #253 Required fix).
    expect(runner).toMatch(/vp\.concludeD1aRun\(\{ first: firstReading, fresh: freshReading, integrityIssues \}\)/)
    expect(runner).not.toMatch(/vp\.judgeD1aRun\(/)
    expect(runner).toMatch(/\['check-ignore', '-q', path\]/)
    expect(runner).toMatch(/flag: 'wx'/)
    expect(runner).toMatch(/appendFileSync\(journalPath/)
    expect(runner).toMatch(/from '\.\/planner-global-assignment-d0b-child-process\.mjs'/)
    expect(runner).not.toMatch(/--mode|formalValidity|d0cFormal|MATERIALIZATION_D0C_FORMAL/)
  })

  it("keeps Stage D' (Issue #260 PR-3) the ordinary Production Planner: no other Planner, Search, prediction, resolution, persistence or formal claim", () => {
    for (const path of STAGE_D_PRIME_MODULES) {
      const source = codeOnly(optimization[path]!)
      expect(source, path).not.toMatch(/runPlannerDeterministicSchedule|createPlannerDeterministicScheduleRun|plannerBeamSearch|runPlannerBeamSearch|createProductionPlanWithSearchRunner|replayPlannerSearchTrace/)
      expect(source, path).not.toMatch(/\.predict[A-Z]|visitPlannerAlternativeCandidates|searchCandidates\(|visitShapeConstrainedRouteCandidates/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\/|conflictResolutions: \[[^\]]/)
      expect(source, path).not.toMatch(/'best_found'|'proven_minimum'|VerifiedUpperBound|production_verified_plan|'verified'/)
    }
    // The final input is the Production replacement authority's, with no resolution and the Domain's own step bound; the Planner is the
    // ordinary Production one (with its own Trace Replay), injectable for tests only.
    const final = codeOnly(optimization['./finalVerification.ts']!)
    for (const call of ['resolveBuildListEntryReplacement(persisted, entry)', 'applyBuildListEntryReplacements(persisted, replacements, generated)',
      "validateBuildListEntryReplacements(finalEntries, replacements, 'replaced')", 'validatePlannerInput(final.input, dependencies)',
      'derivePlannerPlanningTargets(final.input.targetWeapons, validation.validBuildListEntries)', '(inputs.planner ?? createProductionPlanWithObserver)(final.input, dependencies, {',
      'summarizePlanPhysicalOperations(plan, final.input)', 'roundUpPlannerMaxPlanSteps(requiredActions) + BUILD_LIST_OPTIMIZATION_MAX_PLAN_STEPS_MARGIN']) {
      expect(final, call).toContain(call)
    }
    expect(final).toMatch(/conflictResolutions: \[\], options: \{ maxPlanSteps \} \}/)
    // The whole calculation refuses an input carrying a resolution and never reads one.
    expect(codeOnly(optimization['./optimizeBuildList.ts']!)).toMatch(/if \(plannerInput\.conflictResolutions\.length > 0\) \{\n {4}throw new RangeError\(/)
  })

  it('keeps the adoption checks (Issue #260 PR-6A) pure and on the shared save-time helpers: no Planner run, prediction, persistence or message parsing', () => {
    for (const path of ADOPTION_MODULES) {
      const source = codeOnly(optimization[path]!)
      // Only this module, the shared save-time helpers, the Domain models and the replacement type.
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/(?:buildListOptimizationResult|finalVerification)$|^\.\.\/plannerResultPersistenceValidation$|^\.\.\/\.\.\/models\/publicTypes$|^\.\.\/\.\.\/buildList\/buildListEntryReplacement$/)
      }
      expect(source, path).not.toMatch(/createProductionPlan[A-Za-z]*\(|runPlanner|replayPlannerSearchTrace|validatePlannerInput\(|runBuildListOptimization|verifyBuildListOptimizationCandidate|summarizePlanPhysicalOperations/)
      expect(source, path).not.toMatch(/\.predict[A-Z]|searchCandidates\(|visitShapeConstrainedRouteCandidates|visitPlannerAlternativeCandidates/)
      expect(source, path).not.toMatch(/Repository|Dexie|indexedDB|from '[^']*\/services\/|PlannerConflictResolution|savePlanner/)
      // Typed fields only: no warning message, no diagnostics.
      expect(source, path).not.toMatch(/\.message\b|\.diagnostics\b|elapsedMs|plannerVerifications/)
    }
    // The shared save-time helpers come first, with their contracts unchanged.
    const adoption = codeOnly(optimization['./buildListOptimizationAdoption.ts']!)
    for (const call of ['checkPersistablePlannerResultShape(plan, generatedEntries, plannerResult.termination, replacements)', 'checkPersistableOrdinaryPlannerResultShape(plan, plannerResult.termination)']) {
      expect(adoption, call).toContain(call)
    }
  })

  it('keeps Phase D-1B a registration: plain data and pure checks, no Planner, Search, Trace Replay, file or formal run', () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D1B_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      // It runs nothing: no Planner, Trace Replay, Search, materialization or prediction call (the verifier and the runner do; the
      // registration names the Planner and the Trace Replay as string values only).
      expect(source, path).not.toMatch(/createProductionPlan[A-Za-z]*\(|replayPlannerSearchTrace\(|verifyPlannerCandidate\(|validatePlannerInput\(|summarizePlanPhysical\(|visitPlannerAlternativeCandidates|searchCandidates\(|visitShapeConstrainedRouteCandidates|materializeStructuralCandidate|runMaterializationSmoke|buildReachTable|\.predict[A-Z]|new ProductionRngEngine/)
      for (const match of source.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/(?:materializationProtocol|reachTable|types|verificationProtocol|verify)$|^\.\.\/\.\.\/domain\/models\/publicTypes$/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      // No formal claim and no expected D-1C value: verified / best_found / proven_minimum are named only as interpretation keys.
      expect(source, path).not.toMatch(/production_verified_plan|VerifiedUpperBound|'verified'|'best_found'|'proven_minimum'/)
    }
    // The registration enables no formal run, names no registration HEAD SHA, and keeps the hashes in the D-1B document only.
    const registration = codeOf('./verificationRegistration.ts')
    // Phase D-1C enabled the formal run (its one allowed registration change; the fingerprint test proves nothing else changed).
    expect(registration).toMatch(/enabled: true as boolean,/)
    expect(registration).not.toMatch(/REGISTRATION_HEAD = '[0-9a-f]{40}'/)
    expect(registration).not.toMatch(/fnv1a32:[0-9a-f]{8}/)
    expect(registration).toMatch(/registeredD0cConditions\(\)/)
    // Only the D-1C formal runner reads the registration; the D-1A and D-0B runners never do.
    for (const path of [D1A_RUNNER_SCRIPT, D0B_RUNNER_SCRIPT]) expect(scripts[path], path).not.toMatch(/verificationRegistration|PLANNER_VERIFICATION_D1C_PREREGISTRATION/)
    expect(scripts[D1C_RUNNER_SCRIPT]).toMatch(/verificationRegistration\.ts/)
  })

  it('keeps Phase D-1C a formal contract and a RESULT derivation: no Planner, Search, Trace Replay, materialization, prediction or persistence in the modules', () => {
    const codeOf = (path: string) => research[path]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const path of PHASE_D1C_MODULES) {
      expect(research[path], path).toBeDefined()
      const source = codeOf(path)
      // It runs nothing: the runner's children run the materialization and Phase D'; these modules judge their records.
      expect(source, path).not.toMatch(/createProductionPlan[A-Za-z]*\(|replayPlannerSearchTrace\(|verifyPlannerCandidate\(|validatePlannerInput\(|summarizePlanPhysical\(|visitPlannerAlternativeCandidates|searchCandidates\(|visitShapeConstrainedRouteCandidates|materializeStructuralCandidate|runMaterializationSmoke|buildReachTable|\.predict[A-Z]|new ProductionRngEngine/)
      expect(source, path).not.toMatch(/PlannerConflictResolution|conflictRepairLineage|savePlanner|Repository|from '[^']*\/services\//)
      // Never a proven minimum, never an upper bound; no lower bound or oracle is read.
      expect(source, path).not.toMatch(/'proven_minimum'|VerifiedUpperBound|readVerifiedUpperBound|production_verified_plan|plannerGlobalLowerBound|provenLowerBoundTotal/)
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/(?:assignmentProtocol|materializationFormal|materializationFormalResult|materializationProtocol|materializationRunner|verificationFormal|verificationProtocol|verificationRegistration|verify)$|^\.\.\/\.\.\/domain\/models\/publicTypes$/)
      }
    }
    // The registration HEAD is the D-1B merge commit, fixed as a 40-hex constant; every condition comes from the registration.
    const formal = codeOf('./verificationFormal.ts')
    expect(research['./verificationFormal.ts']).toMatch(/PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD = 'd15ea9b0277b417b2681305486b6fb03dda57054'/)
    expect(formal).toMatch(/conditions: registeredD1cConditions\(registration\)/)
    // The verdict of each run is the D-1A one (no second judgement of the Planner conditions).
    expect(formal).toMatch(/concludeD1aRun\(\{ first: run\.first\.reading, fresh: run\.fresh\?\.reading \?\? null, integrityIssues: runIssues\[index\]! \}\)/)
    expect(formal).not.toMatch(/judgeD1aRun\(/)

    // The runner: formal only, the registration's conditions, the Production Engine and Phase D' module, one conclusion; no oracle,
    // no hash, no post-hoc argument, no Planner port, no resolution, exclusive writes, git-ignored outputs, the shared child envelope.
    const runner = scripts[D1C_RUNNER_SCRIPT]!
    expect(runner).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum|FakeRngEngine|conflictResolutions|PlannerConflictResolution|\bplanner\s*:/)
    expect(runner).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(runner).not.toMatch(/\b[0-9a-f]{40}\b/i)
    expect(runner).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(runner).toMatch(/new ProductionRngEngine\(\)/)
    expect(runner).toMatch(/formal\.registeredD1cExpectation\(\)\.conditions/)
    expect(runner).toMatch(/runner\.runMaterializationSmoke\(input, research\.globalResearchDependencies\(engine\), \{ conditions: materializationConditions \}/)
    expect(runner).toMatch(/verify\.verifyPlannerCandidate\(/)
    expect(runner).toMatch(/vp\.compareD0cMaterializationIdentity\(/)
    expect(runner).toMatch(/formal\.d1cFormalStartGate\(/)
    expect(runner).toMatch(/formal\.d1cFormalChildGateIssues\(/)
    expect(runner).toMatch(/formal\.d1cFormalChildCalculationIssues\(/)
    expect(runner).toMatch(/formal\.d1cFreshEntrySetSourceIssues\(/)
    expect(runner.match(/formal\.concludeD1cMeasurement\(/g)).toHaveLength(1)
    expect(runner).not.toMatch(/vp\.judgeD1aRun\(|vp\.concludeD1aRun\(|process\.exitCode = [012]/)
    expect(runner).toMatch(/\['check-ignore', '-q', path\]/)
    expect(runner).toMatch(/flag: 'wx'/)
    expect(runner).toMatch(/appendFileSync\(journalPath/)
    expect(runner).toMatch(/from '\.\/planner-global-assignment-d0b-child-process\.mjs'/)
    // The derivation reads the raw outputs and writes exclusively: no Export, no Engine, no oracle, no hard-coded hash.
    const derive = scripts[D1C_DERIVE_SCRIPT]!
    expect(derive).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum|--export|ProductionRngEngine|FakeRngEngine|runMaterializationSmoke|createProductionPlan|verifyPlannerCandidate/)
    expect(derive).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(derive).toMatch(/flag: 'wx'/)
    expect(derive).toMatch(/derive\.deriveD1cPublicResult\(sources\)/)
    expect(derive).toMatch(/derive\.d1cPublicResultIssues\(/)
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
