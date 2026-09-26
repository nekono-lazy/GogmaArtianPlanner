import { describe, expect, it } from 'vitest'

/*
 * Planner Alternative Phase 3-A is benchmark-only: nothing Production reaches
 * it, the Production Worker protocol carries none of it, and the
 * instrumentation seam is passed by no Production caller. Phase 3-C decided the
 * Production defaults in the Search / Planner Domain authorities; the
 * benchmark keeps its own caller-supplied `BENCHMARK_ONLY_*` measurement
 * conditions and never reads those defaults.
 */

const production = {
  ...import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

const benchmarkOnly = [
  /^\.\.\/benchmark\.tsx$/,
  /^\.\.\/pages\/BenchmarkApp(\.test)?\.tsx$/,
  /^\.\.\/pages\/[A-Za-z0-9]+BenchmarkPage(\.test)?\.tsx$/,
  /^\.\.\/workers\/[A-Za-z0-9]+\.worker\.benchmark(\.entry)?\.ts$/,
  /\.test\.tsx?$/,
]

const productionPaths = Object.keys(production).filter((path) => !benchmarkOnly.some((pattern) => pattern.test(path)))

describe('Planner Alternative Phase 3-A benchmark isolation', () => {
  it('scans the Production sources', () => {
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths).toContain('../workers/planner.worker.production.ts')
    expect(productionPaths).not.toContain('../workers/plannerAlternative.worker.benchmark.ts')
  })

  it('is imported by no Production module', () => {
    const forbidden = /plannerAlternativeBenchmark|plannerAlternativeBrowserBenchmark|plannerAlternative\.worker\.benchmark|PlannerAlternativeBenchmarkPage|pa3_benchmark_|from '[^']*\/benchmarks\//
    const offenders = productionPaths.filter((path) => forbidden.test(production[path]))
    expect(offenders).toEqual([])
  })

  it('adds nothing to the Production Planner Worker protocol, Client or adapter', () => {
    for (const path of [
      '../workers/plannerWorkerContracts.ts',
      '../workers/planner.worker.ts',
      '../workers/planner.worker.entry.ts',
      '../workers/planner.worker.production.ts',
      '../workers/plannerWorkerClient.ts',
    ]) {
      const source = production[path]
      if (source === undefined) continue
      expect(source, path).not.toMatch(/instrumentation|pa3_benchmark|PlannerAlternative(?:Search|Kernel)Instrumentation|onWorkSettled/)
    }
  })

  it('passes the Search instrumentation from no Production caller', () => {
    const users = productionPaths.filter((path) => /\bonSkillReservedDepth\b|\bonGogmaReservedDepth\b|\binstrumentation\?\.onWorkSettled\b/.test(production[path]))
    expect(users).toEqual(['../domain/search/alternative/plannerAlternativeSearch.ts'])
    expect(production['../domain/planner/alternative/plannerAlternativeKernel.ts']).not.toContain('instrumentation')
  })

  it('defines the Production defaults only in the Search / Planner Domain authorities', () => {
    const definers = productionPaths.filter((path) =>
      /export const defaultPlannerAlternative(?:SearchExtent|TrialBounds|Extent|Bounds)\b/.test(production[path]))
    expect(definers.sort()).toEqual([
      '../domain/planner/alternative/plannerAlternativeTrial.ts',
      '../domain/search/alternative/plannerAlternativeTypes.ts',
    ])
  })

  it('keeps the benchmark measurement conditions apart from the Production defaults', () => {
    const benchmark = import.meta.glob('./plannerAlternative*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const sources = Object.entries(benchmark).filter(([path]) => !/\.test\.ts$/.test(path))
    expect(sources.map(([path]) => path)).toContain('./plannerAlternativeBenchmarkFixtures.ts')
    for (const [path, source] of sources) {
      expect(source, path).not.toMatch(/defaultPlannerAlternative(?:SearchExtent|TrialBounds)\b/)
    }
  })
})
