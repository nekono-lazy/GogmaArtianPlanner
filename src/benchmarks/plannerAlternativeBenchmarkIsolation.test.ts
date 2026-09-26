import { describe, expect, it } from 'vitest'

/*
 * Planner Alternative Phase 3-A is benchmark-only: nothing Production reaches
 * it, the Production Worker protocol carries none of it, the instrumentation
 * seam is passed by no Production caller, and no Production default exists
 * yet (Phase 3-C decides them from the real Browser Worker measurements).
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

  it('defines no Production extent or trial bound default yet', () => {
    const offenders = productionPaths.filter((path) =>
      /defaultPlannerAlternative(?:SearchExtent|TrialBounds|Extent|Bounds)\b/.test(production[path]))
    expect(offenders).toEqual([])
  })
})
