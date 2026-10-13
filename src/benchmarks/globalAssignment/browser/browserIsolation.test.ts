import { describe, expect, it } from 'vitest'
import { GAB_RUN_REQUEST_KEYS, type GabRunRequest } from './globalAssignmentBrowserProtocol'

/*
 * Issue #154 Production準備 P-1 (docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md 13.2): the Global Assignment Browser Worker
 * benchmark is Research only. No Production module reaches it; its modules import only this folder, the Global Assignment runtime
 * modules, the two named Research modules, the Domain, and (page / entry only) React, MUI, the app theme and global CSS; they touch no
 * persistence, oracle or earlier result; the Worker computes with the Production Engine only; a run request carries no condition or
 * expected value; the normal Vite build and the Production Worker protocols are untouched. The existing
 * `../isolation.test.ts` stays as it is (this folder is outside its non-recursive module list).
 */

const production = {
  ...import.meta.glob('../../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const browser = import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const runtime = Object.entries(browser).filter(([path]) => !/\.test\.tsx?$|[tT]estFixture\.ts$/.test(path))
const globalAssignmentRuntime = Object.keys(import.meta.glob(['../*.ts', '!../*.test.ts', '!../*[tT]estFixture.ts'])).map(path => path.replace(/\.ts$/, ''))
const configs = import.meta.glob('../../../../vite*.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const htmlEntries = import.meta.glob('../../../../*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE_MODULES = ['./GlobalAssignmentBrowserBenchmarkPage.tsx', './main.tsx']
const MAIN_THREAD_MODULES = ['./GlobalAssignmentBrowserBenchmarkPage.tsx', './main.tsx', './globalAssignmentBrowserHarness.ts', './globalAssignmentBrowserRunner.ts']
const WORKER_ENGINE_MODULES = ['./globalAssignment.worker.benchmark.entry.ts', './globalAssignmentBrowserWorkerOptions.ts']

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const runRequestFieldsAreTheProtocolFields: Equal<keyof GabRunRequest, (typeof GAB_RUN_REQUEST_KEYS)[number]> = true

describe('Global Assignment Browser Worker isolation (P-1)', () => {
  it('has the expected modules and is reached by no Production module (no exclusion pattern)', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual([
      './GlobalAssignmentBrowserBenchmarkPage.tsx', './globalAssignment.worker.benchmark.entry.ts', './globalAssignment.worker.benchmark.ts', './globalAssignmentBrowserHarness.ts',
      './globalAssignmentBrowserJudgement.ts', './globalAssignmentBrowserProtocol.ts', './globalAssignmentBrowserRunner.ts', './globalAssignmentBrowserStages.ts',
      './globalAssignmentBrowserWorkerOptions.ts', './main.tsx',
    ])
    const productionPaths = Object.keys(production)
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths).toContain('../../../workers/planner.worker.ts')
    const exported = [...new Set(runtime.flatMap(([, source]) => [...source.matchAll(/export (?:async )?(?:function|const|class|interface|type) ([A-Za-z0-9_]+)/g)].map(match => match[1]!)))]
    expect(exported.length).toBeGreaterThan(40)
    const forbidden = new RegExp(`globalAssignment/browser|gab_|global-assignment-browser|benchmark-global-assignment|\\b(?:${exported.join('|')})\\b`)
    expect(productionPaths.filter(path => forbidden.test(production[path]!))).toEqual([])
  })

  it('imports only this folder, the Global Assignment runtime modules, the two named Research modules and the Domain (React / MUI / theme / CSS in the page only)', () => {
    expect(globalAssignmentRuntime.length).toBeGreaterThan(30)
    for (const [path, source] of runtime) {
      for (const match of source.matchAll(/from '([^']+)'|import '([^']+)'/g)) {
        const target = match[1] ?? match[2]!
        if (/^\.\/[A-Za-z.]+$/.test(target) || /^\.\.\/\.\.\/\.\.\/domain\//.test(target) || /^\.\.\/\.\.\/(?:plannerGlobalOptimizationResearch|plannerGlobalBrowserEvidence)$/.test(target)) continue
        if (/^\.\.\/[A-Za-z]+$/.test(target)) { expect(globalAssignmentRuntime, `${path} imports ${target}`).toContain(target); continue }
        if (PAGE_MODULES.includes(path) && /^(?:react|react-dom\/client|@mui\/material|@mui\/material\/styles|\.\.\/\.\.\/\.\.\/app\/theme|\.\.\/\.\.\/\.\.\/index\.css)$/.test(target)) continue
        throw new Error(`${path} imports ${target}`)
      }
      expect(source, path).not.toMatch(/from '[^']*\/(?:workers|services|db|pages|components|stores)\//)
    }
  })

  it('touches no persistence, network, oracle, earlier result or literal identity', () => {
    for (const [path, source] of runtime) {
      expect(source, path).not.toMatch(/indexedDB|Dexie|appDatabase|localStorage|sessionStorage|caches\.|serviceWorker|fetch\(/)
      expect(source, path).not.toMatch(/plannerGlobalOracle|ORACLE_1657|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|_RESULT\.json|from ['"][^'"]*\.json['"]/)
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{40,64}\b/i)
      expect(source, path).not.toMatch(/fnv1a32:[0-9a-f]{8}|randomUUID|Math\.random/)
    }
  })

  it('computes with the Production Engine only, and keeps every calculation off the main thread', () => {
    for (const path of WORKER_ENGINE_MODULES) {
      const source = codeOf(browser[path]!)
      expect(source, path).not.toMatch(/FakeRngEngine|createTableEngine|plannerGlobalRawBlocks|GlobalRawBlockResearch|plannerGlobalOptimizationProfile|GlobalSearchProfiler/)
    }
    const options = codeOf(browser['./globalAssignmentBrowserWorkerOptions.ts']!)
    expect(options.match(/new [A-Z][A-Za-z]*Engine\(/g)).toEqual(['new ProductionRngEngine('])
    expect(options).toMatch(/globalResearchInputFromExport\(json, GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS\)/)
    expect(options).toMatch(/registeredD1cConditions\(\)/)
    expect(options).toMatch(/source: 'registeredD1cConditions'/)
    expect(codeOf(browser['./globalAssignment.worker.benchmark.entry.ts']!)).toMatch(/attachGlobalAssignmentBrowserWorker\(self as unknown as GlobalAssignmentBrowserWorkerScope, globalAssignmentBrowserWorkerOptions\(\)\)/)
    // The stage module is the only caller of the calculation; the main thread neither calculates nor parses the Export.
    for (const path of MAIN_THREAD_MODULES) {
      const source = codeOf(browser[path]!)
      expect(source, path).not.toMatch(/runMaterializationSmoke|verifyPlannerCandidate|createGlobalAssignmentContext|runFirstStage|runFreshStage|globalResearchInputFromExport|JSON\.parse\(|new TextDecoder/)
    }
    const callers = runtime.filter(([, source]) => /runMaterializationSmoke\(|verifyPlannerCandidate\(/.test(codeOf(source))).map(([path]) => path)
    expect(callers).toEqual(['./globalAssignmentBrowserStages.ts'])
    // The stage module reads no clock, file or random value of its own: everything is injected.
    expect(codeOf(browser['./globalAssignmentBrowserStages.ts']!)).not.toMatch(/performance\.now|Date\.now|new Date\(|crypto\.subtle|setTimeout|MessageChannel|\bself\b/)
  })

  it('carries no condition, expected hash or registration in a run request', () => {
    expect(runRequestFieldsAreTheProtocolFields).toBe(true)
    expect([...GAB_RUN_REQUEST_KEYS].sort()).toEqual(['entrySet', 'execution', 'exportIdentity', 'exportPayload', 'protocolVersion', 'requestId', 'role', 'type'])
    const protocol = codeOf(browser['./globalAssignmentBrowserProtocol.ts']!)
    const runRequest = protocol.slice(protocol.indexOf('export interface GabRunRequest'), protocol.indexOf('export interface GabCancelRequest'))
    expect(runRequest).not.toMatch(/conditions|window|rule|budget|maxPlanSteps|expected|d0c|d1c|registration|sha256\?/i)
  })

  it('leaves the normal Vite build, the existing benchmark shell and the Production Worker protocols untouched', () => {
    const normal = Object.entries(configs).find(([path]) => path.endsWith('/vite.config.ts'))![1]
    const benchmark = Object.entries(configs).find(([path]) => path.endsWith('/vite.benchmark.config.ts'))![1]
    expect(normal).not.toMatch(/benchmark-global-assignment|globalAssignment|Cross-Origin-(?:Opener|Embedder)-Policy|PLANNER_GLOBAL/)
    expect(benchmark).toMatch(/rollupOptions: \{ input: \{ benchmark: 'benchmark\.html', globalAssignment: 'benchmark-global-assignment\.html' \} \}/)
    expect(benchmark).toMatch(/'benchmark\.html', 'benchmark-global-assignment\.html'\]/)
    const html = Object.entries(htmlEntries)
    expect(html.find(([path]) => path.endsWith('/index.html'))![1]).not.toMatch(/globalAssignment|benchmark/)
    expect(html.find(([path]) => path.endsWith('/benchmark.html'))![1]).toMatch(/src="\/src\/benchmark\.tsx"/)
    expect(html.find(([path]) => path.endsWith('/benchmark-global-assignment.html'))![1]).toMatch(/src="\/src\/benchmarks\/globalAssignment\/browser\/main\.tsx"/)
    for (const path of ['../../../workers/plannerWorkerContracts.ts', '../../../workers/planner.worker.ts', '../../../workers/search.worker.ts', '../../../pages/BenchmarkApp.tsx', '../../../benchmark.tsx']) {
      expect(production[path], path).toBeDefined()
      expect(production[path], path).not.toMatch(/gab_|GlobalAssignment|globalAssignment|global-assignment/)
    }
    // The Production Planner Worker keeps its timer yield; only benchmark Workers use a MessageChannel.
    expect(production['../../../workers/planner.worker.ts']).toContain('setTimeout(resolve, 0)')
    expect(production['../../../workers/planner.worker.ts']).not.toContain('MessageChannel')
  })
})
