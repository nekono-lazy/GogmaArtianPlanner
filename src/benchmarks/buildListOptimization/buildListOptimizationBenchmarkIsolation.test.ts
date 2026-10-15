import { describe, expect, it } from 'vitest'
import { PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS } from '../../workers/buildListOptimization.worker.production'

/*
 * Issue #260 PR-5A: the Production Build List optimization measurement harness is benchmark only and measures the Production
 * calculation as it is.
 *
 * - No Production module reaches it; the normal Vite build and `index.html` never name its page.
 * - Its modules reach the Production Client, the Production input path and the benchmark measurement Worker, never persistence
 *   directly, the Research harness or the Research Export reader; the synthetic cases alone read a Repository test fixture.
 * - The measured run is the Client's: the harness constructs no run request, and the bounds reach the Worker only through the
 *   benchmark configuration message. The Production bounds stay undecided (`null`).
 * - The committed plan and the analysis are post-hoc: no page / runner module imports them.
 * - The scripts read the plan from the measured commit, refuse other code, and write exclusively.
 */

const harness = import.meta.glob(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = Object.fromEntries(Object.entries({
  ...import.meta.glob('../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
}).filter(([path]) => !/\.test\.tsx?$/.test(path))) as Record<string, string>
const configs = import.meta.glob('../../../vite*.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const htmlEntries = import.meta.glob('../../../*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scripts = import.meta.glob('../../../scripts/*build-list-optimization*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const importsOf = (source: string) => [...codeOf(source).matchAll(/(?:from|import)\s*'([^']+)'/g)].map(match => match[1]!)

const MAIN_THREAD = ['./BuildListOptimizationBenchmarkPage.tsx', './main.tsx', './buildListOptimizationBenchmarkRunner.ts', './buildListOptimizationBenchmarkBrowserPorts.ts',
  './buildListOptimizationBenchmarkInput.ts', './buildListOptimizationBenchmarkSemantic.ts', './buildListOptimizationBenchmarkSynthetic.ts', './buildListOptimizationBenchmarkProtocol.ts']
/** Read by the driver, the Node reference and the analyzer only (the driver's slot control included). */
const POST_HOC = ['./buildListOptimizationBenchmarkPlan.ts', './buildListOptimizationBenchmarkAnalysis.ts', './buildListOptimizationBenchmarkDriverControl.ts']

describe('Build List optimization measurement harness isolation (Issue #260 PR-5A)', () => {
  it('has the expected modules, and no Production module or normal build reaches them', () => {
    expect(Object.keys(harness).sort()).toEqual([...MAIN_THREAD, ...POST_HOC, './buildListOptimizationBenchmarkTestFixture.ts'].sort())
    expect(Object.keys(production).length).toBeGreaterThan(300)
    const forbidden = /benchmarks\/buildListOptimization|buildListOptimizationBenchmark(?:Runner|Plan|Analysis|Protocol|Input|Synthetic|Semantic|BrowserPorts|Page)|blo-browser-plan|globalThis\.buildListOptimizationBenchmark|benchmark-build-list-optimization/
    expect(Object.keys(production).filter(path => forbidden.test(production[path]!))).toEqual([])
    const normal = Object.entries(configs).find(([path]) => path.endsWith('/vite.config.ts'))![1]
    const benchmark = Object.entries(configs).find(([path]) => path.endsWith('/vite.benchmark.config.ts'))![1]
    expect(normal).not.toMatch(/benchmark-build-list-optimization|buildListOptimization/)
    expect(benchmark).toMatch(/buildListOptimization: 'benchmark-build-list-optimization\.html'/)
    expect(Object.entries(htmlEntries).find(([path]) => path.endsWith('/index.html'))![1]).not.toMatch(/buildListOptimization|benchmark/)
    expect(Object.entries(htmlEntries).find(([path]) => path.endsWith('/benchmark-build-list-optimization.html'))![1]).toMatch(/src="\/src\/benchmarks\/buildListOptimization\/main\.tsx"/)
  })

  it('reaches the Production Client, the Production input path and the measurement Worker only (no persistence, no Research)', () => {
    const allowed = [
      /^\.\/[A-Za-z]+$/, /^\.\.\/\.\.\/domain\//, /^\.\.\/\.\.\/services\/planner\/buildListOptimizationWorkerClient$/, /^\.\.\/\.\.\/services\/planner\/createPlannerInput$/,
      /^\.\.\/\.\.\/services\/buildList\/createBuildListCalculationContext$/, /^\.\.\/\.\.\/services\/dataTransfer\/importExportValidation$/,
      /^\.\.\/\.\.\/workers\/buildListOptimization\.worker\.benchmark$/, /^\.\.\/\.\.\/workers\/buildListOptimization\.worker$/, /^\.\.\/\.\.\/workers\/buildListOptimizationWorkerContracts$/,
    ]
    const page = [/^react(?:-dom\/client)?$/, /^@mui\/material(?:\/styles)?$/, /^\.\.\/\.\.\/app\/theme$/, /^\.\.\/\.\.\/index\.css$/]
    const fixtures = /^\.\.\/\.\.\/test\/fixtures\/(?:plannerSchedulerWorkloads|buildListOptimizationWorkerFixtures)$/
    for (const [path, source] of Object.entries(harness)) {
      for (const target of importsOf(source)) {
        if (allowed.some(pattern => pattern.test(target))) continue
        if ((path === './BuildListOptimizationBenchmarkPage.tsx' || path === './main.tsx') && page.some(pattern => pattern.test(target))) continue
        // The synthetic cases (and the test fixture) are the only readers of a Repository test fixture.
        if ((path === './buildListOptimizationBenchmarkSynthetic.ts' || path === './buildListOptimizationBenchmarkTestFixture.ts') && fixtures.test(target)) continue
        if (path === './buildListOptimizationBenchmarkTestFixture.ts' && /^\.\.\/\.\.\/workers\/buildListOptimization\.worker\.benchmark$/.test(target)) continue
        throw new Error(`${path} imports ${target}`)
      }
      expect(codeOf(source), path).not.toMatch(/globalResearchInputFromExport|plannerGlobalOptimizationResearch|globalAssignment|registeredD[01]cConditions|MATERIALIZATION_D0C|\bDexie\b|appDatabase/)
      expect(codeOf(source), path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/i)
    }
  })

  it('measures the Client\'s run: the harness builds no run request and passes the bounds only in the benchmark message', () => {
    const runner = codeOf(harness['./buildListOptimizationBenchmarkRunner.ts']!)
    expect(runner).not.toMatch(/type: 'blo_run'|protocolVersion: 'build-list-optimization:1'/)
    expect(runner).toMatch(/createBuildListOptimizationWorkerClient\(\{ createWorker: workerFactory\(state, onProgress\), pageLifecycle: ports\.pageLifecycle \}\)/)
    expect(runner).toMatch(/raw\.postMessage\(createBuildListOptimizationBenchmarkBoundsMessage\(spec\.bounds\)\)/)
    // The page's Worker is the benchmark measurement entry (the Production entry is the Production Client's).
    const ports = codeOf(harness['./buildListOptimizationBenchmarkBrowserPorts.ts']!)
    expect(ports).toMatch(/new Worker\(new URL\('\.\.\/\.\.\/workers\/buildListOptimization\.worker\.benchmark\.entry\.ts', import\.meta\.url\), \{ type: 'module' \}\)/)
    expect(ports).not.toMatch(/buildListOptimization\.worker\.entry\.ts/)
    // No harness module carries or fills in a Production bound; the Production adapter still has none (U2 is PR-5B's).
    for (const [path, source] of Object.entries(harness)) expect(codeOf(source), path).not.toMatch(/PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS|recommendedCandidateSearchDefaults|candidateSearchDefaults/)
    expect(PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS).toBeNull()
  })

  it('keeps the committed plan and the analysis post-hoc: no page or runner module imports them', () => {
    for (const path of MAIN_THREAD) {
      expect(importsOf(harness[path]!), path).not.toEqual(expect.arrayContaining([expect.stringMatching(/buildListOptimizationBenchmark(?:Plan|Analysis|DriverControl)$/)]))
    }
    for (const path of POST_HOC) {
      expect(codeOf(harness[path]!), path).not.toMatch(/runBuildListOptimization|ProductionRngEngine|createBuildListOptimizationWorkerClient|new Worker|performance\.now|Date\.now|readFile|from 'node:/)
    }
  })

  it('keeps the scripts honest: the plan from the measured commit, other code refused, exclusive writes, a registered plan to measure', () => {
    const analyzer = scripts['../../../scripts/analyze-build-list-optimization-browser.mjs']!
    const driver = scripts['../../../scripts/drive-build-list-optimization-browser.mjs']!
    const node = scripts['../../../scripts/run-build-list-optimization-node-reference.mjs']!
    for (const script of [analyzer, driver, node]) expect(script).toBeDefined()
    expect(analyzer).toMatch(/git\('show', `\$\{head\}:\$\{path\}`\)/)
    expect(analyzer).toMatch(/git', \['diff', '--quiet', head, '--', \.\.\.CODE_PATHS\]/)
    expect(analyzer).toMatch(/'benchmark-build-list-optimization\.html'\]/)
    expect(analyzer).toMatch(/flag: 'wx'/)
    expect(analyzer).not.toMatch(/--export|runBuildListOptimization|ProductionRngEngine|createBuildListOptimizationCalculation/)
    expect(driver).toMatch(/plan\.status !== 'registered' \|\| plan\.approval\.state !== 'owner_approved'/)
    // The driver validates the plan, takes the Browser mode from it before launching, checks every page's mode, and leaves the
    // slot order and the page replacement to the shared slot control; only a mechanics run may shorten the slot deadline.
    expect(driver).toMatch(/planModule\.bloMeasurementPlanIssues\(extracted\.plan\)/)
    expect(driver).toMatch(/control\.bloDriverLaunchModeIssue\(plan\.planKind, environment\.browserMode, launchMode\)/)
    expect(driver).toMatch(/control\.bloPageBrowserModeIssue\(environmentValue\.userAgent \?\? null, launchMode\)/)
    expect(driver).toMatch(/control\.runBloDriverSessions\(sessions, \{ openPage, runSlot, closePage, readStorage \}/)
    expect(driver).toMatch(/deadlineOption !== undefined && \(mode !== 'mechanics'/)
    expect(driver).toMatch(/revision: 2/)
    expect(driver).toMatch(/DOM\.setFileInputFiles/)
    expect(driver).toMatch(/build\?\.commit !== head \|\| build\?\.uncommittedBenchmarkCode !== false/)
    expect(driver).toMatch(/flag: 'wx'/)
    expect(node).toMatch(/adapter\.createBuildListOptimizationCalculation\(boundsSet\.bounds\)/)
    expect(node).toMatch(/adapter\.createProductionBuildListOptimizationWorkerDependencies\(\)/)
    expect(node).toMatch(/inputModule\.prepareBloBenchmarkInput\(text/)
    expect(node).toMatch(/flag: 'wx'/)
    for (const script of [analyzer, driver, node]) expect(script).not.toMatch(/\b[0-9a-f]{64}\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|globalResearchInputFromExport/)
  })
})
