import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { PHASE2A_RESEARCH_MAX_PLAN_STEPS } from './plannerGlobalBrowserBenchmarkRunner'
import { GLOBAL_RESEARCH_EXTENT } from './plannerGlobalOptimizationResearch'

/*
 * Issue #154 Phase 2-A is benchmark-only Research: nothing Production reaches it, the Production Planner /
 * Search Worker protocols carry none of it, the only runtime data input is the Export the page is given,
 * and no benchmark result is persisted.
 */
const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const benchmarkOnly = [/^\.\.\/benchmark\.tsx$/, /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/, /^\.\.\/pages\/[A-Za-z0-9]+BenchmarkPage(\.test)?\.tsx$/,
  /^\.\.\/workers\/[A-Za-z0-9]+\.worker\.benchmark(\.entry)?(\.test)?\.ts$/, /\.test\.tsx?$/]
const productionPaths = Object.keys(production).filter(path => !benchmarkOnly.some(pattern => pattern.test(path)))
const phase2a = {
  ...import.meta.glob('./plannerGlobalBrowser*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../workers/plannerGlobal.worker.benchmark*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../pages/PlannerGlobalBrowserBenchmarkPage.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const phase2aRuntime = Object.entries(phase2a).filter(([path]) => !/\.test\.ts|TestFixture/.test(path))
const configs = import.meta.glob('../../vite*.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-A benchmark isolation', () => {
  it('is imported by no Production module and routed from no normal page', () => {
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths).toContain('../workers/planner.worker.production.ts')
    expect(productionPaths).not.toContain('../workers/plannerGlobal.worker.benchmark.ts')
    const forbidden = /plannerGlobalBrowser|plannerGlobal\.worker|pg2a_benchmark|PlannerGlobalBrowserBenchmarkPage|plannerGlobalOptimization|plannerGlobalRawBlocks/
    expect(productionPaths.filter(path => forbidden.test(production[path]))).toEqual([])
    expect(phase2aRuntime.map(([path]) => path).sort()).toEqual(['../pages/PlannerGlobalBrowserBenchmarkPage.tsx', '../workers/plannerGlobal.worker.benchmark.entry.ts',
      '../workers/plannerGlobal.worker.benchmark.ts', './plannerGlobalBrowserBenchmark.ts', './plannerGlobalBrowserBenchmarkProtocol.ts',
      './plannerGlobalBrowserBenchmarkRunner.ts', './plannerGlobalBrowserEvidence.ts'])
  })

  it('adds nothing to the Production Planner / Search Worker protocols, Clients or yields', () => {
    for (const path of ['../workers/plannerWorkerContracts.ts', '../workers/planner.worker.ts', '../workers/planner.worker.entry.ts', '../workers/planner.worker.production.ts',
      '../services/planner/plannerWorkerClient.ts', '../workers/contracts.ts', '../workers/search.worker.ts', '../workers/search.worker.entry.ts',
      '../workers/search.worker.production.ts', '../services/search/searchWorkerClient.ts']) {
      expect(production[path], path).toBeDefined()
      expect(production[path], path).not.toMatch(/pg2a|GlobalResearch|plannerGlobal|extentFallback|rawBlocks|Phase 2-A/)
    }
    // The Production Planner Worker keeps its timer yield; only the benchmark Worker uses a MessageChannel.
    expect(production['../workers/planner.worker.ts']).toContain('setTimeout(resolve, 0)')
    expect(production['../workers/planner.worker.ts']).not.toContain('MessageChannel')
  })

  it('reads no earlier Phase result, oracle, Target ID or persisted state, and persists nothing', () => {
    expect(phase2aRuntime.length).toBe(7)
    for (const [path, source] of phase2aRuntime) {
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      // No earlier Phase raw result (`docs/PLANNER_GLOBAL_PHASE1*_*.json`), no JSON import, no file / network read.
      expect(source, path).not.toMatch(/PHASE1[BCD]_|PHASE1E_(?!BOUNDS)|PLANNER_GLOBAL_PHASE1|observed-report|failedFirstTargetIds|readFile|fetch\(|from ['"][^'"]*\.json['"]/)
      expect(source, path).not.toMatch(/from ['"][^'"]*(?:\/db\/|dexie|repositories|importExportService)/i)
      expect(source, path).not.toMatch(/\b(?:indexedDB|localStorage|sessionStorage)\s*\.|\bnew Dexie\b/)
    }
  })

  it('keeps the normal Vite config free of benchmark isolation headers', () => {
    const normal = Object.entries(configs).find(([path]) => path.endsWith('/vite.config.ts'))?.[1]
    const benchmark = Object.entries(configs).find(([path]) => path.endsWith('/vite.benchmark.config.ts'))?.[1]
    expect(normal).toBeDefined()
    expect(normal).not.toMatch(/Cross-Origin-(?:Opener|Embedder)-Policy|benchmark\.html|PLANNER_GLOBAL/)
    expect(benchmark).toMatch(/BENCHMARK_CROSS_ORIGIN_ISOLATED === '1'/)
  })

  it('changes no Production default, schema or version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(GLOBAL_RESEARCH_EXTENT).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(PHASE2A_RESEARCH_MAX_PLAN_STEPS).toBe(20000)
  })
})
