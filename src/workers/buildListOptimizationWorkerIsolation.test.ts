import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'

/*
 * Issue #260 PR-4: the Build List global optimization Worker / Client / Application boundary.
 *
 * - The Worker bundle reaches the Domain only: no persistence (`src/db/**`, Dexie), Service, UI, store, benchmark or Research
 *   module, followed through every import edge the bundler keeps (type-only `import type` statements are erased; with
 *   `verbatimModuleSyntax` an `import { type X }` statement is kept, so it counts).
 * - The Production Planner Worker protocol and Client are untouched.
 * - No module of this boundary computes a step bound, carries a search bound outside the Worker adapter, persists anything, or
 *   ends a run on a timer.
 */

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
/** The same sources keyed by their `src/...` path (Vite keys this folder's files as `./x`, the others as `../dir/x`). */
const bySrcPath = new Map(Object.entries(sources).map(([key, source]) => [key.startsWith('./') ? `src/workers/${key.slice(2)}` : `src/${key.replace(/^\.\.\//, '')}`, source]))
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const WORKER_ENTRY = 'src/workers/buildListOptimization.worker.entry.ts'
const BENCHMARK_ENTRY = 'src/workers/buildListOptimization.worker.benchmark.entry.ts'
const BOUNDARY_MODULES = [
  'src/workers/buildListOptimizationWorkerContracts.ts',
  'src/workers/buildListOptimization.worker.ts',
  'src/workers/buildListOptimization.worker.production.ts',
  WORKER_ENTRY,
  'src/workers/buildListOptimization.worker.benchmark.ts',
  BENCHMARK_ENTRY,
  'src/services/planner/buildListOptimizationWorkerClient.ts',
  'src/services/planner/buildListOptimizationResultCheck.ts',
  'src/services/planner/buildListOptimizationService.ts',
]
const MAIN_THREAD_MODULES = BOUNDARY_MODULES.filter(path => path.startsWith('src/services/'))

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

function resolveModule(from: string, specifier: string): string | null {
  const base = normalize(`${from.slice(0, from.lastIndexOf('/'))}/${specifier}`)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (bySrcPath.has(candidate)) return candidate
  return null
}

/** The import edges a bundle keeps: value imports and re-exports, side-effect imports, dynamic imports and `new URL()` assets. */
function importSpecifiers(source: string): string[] {
  const code = codeOf(source)
  const specifiers: string[] = []
  for (const match of code.matchAll(/(^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*'([^']+)'/g)) {
    if (match[3] !== undefined) continue
    specifiers.push(match[5]!)
  }
  for (const match of code.matchAll(/(^|\n)\s*import\s*'([^']+)'/g)) specifiers.push(match[2]!)
  for (const match of code.matchAll(/import\(\s*'([^']+)'\s*\)/g)) specifiers.push(match[1]!)
  for (const match of code.matchAll(/new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)/g)) specifiers.push(match[1]!)
  return specifiers
}

/** Every module and bare package reachable from `entry`. */
function reachable(entry: string): { modules: Set<string>; packages: Set<string>; unresolved: string[] } {
  const modules = new Set<string>()
  const packages = new Set<string>()
  const unresolved: string[] = []
  const pending = [entry]
  while (pending.length > 0) {
    const path = pending.pop()!
    if (modules.has(path)) continue
    modules.add(path)
    for (const specifier of importSpecifiers(bySrcPath.get(path)!)) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier)
        continue
      }
      const resolved = resolveModule(path, specifier)
      if (resolved === null) {
        // A JSON Master file or another asset is a leaf; anything else unresolved is reported.
        if (!/\.json$/.test(specifier)) unresolved.push(`${path} -> ${specifier}`)
        continue
      }
      pending.push(resolved)
    }
  }
  return { modules, packages, unresolved }
}

const FORBIDDEN_MODULE = /^src\/(?:db|services|benchmarks|pages|components|stores|app|presentation)\/|^src\/domain\/search\/research\//

describe('Build List optimization Worker isolation (Issue #260 PR-4)', () => {
  it('has every boundary module', () => {
    for (const path of BOUNDARY_MODULES) expect(bySrcPath.has(path), path).toBe(true)
    expect(bySrcPath.size).toBeGreaterThan(300)
  })

  it('keeps the Production Worker bundle free of persistence, Services, UI, benchmarks and Research', () => {
    const { modules, packages, unresolved } = reachable(WORKER_ENTRY)
    expect(unresolved).toEqual([])
    expect(modules.size).toBeGreaterThan(50)
    expect(modules).toContain('src/domain/planner/buildListOptimization/optimizeBuildList.ts')
    expect(modules).toContain('src/domain/rng/production/productionRngEngine.ts')
    expect([...modules].filter(path => FORBIDDEN_MODULE.test(path))).toEqual([])
    expect([...modules].filter(path => /\.worker\.benchmark/.test(path))).toEqual([])
    expect([...packages].filter(name => /^(?:dexie|dexie-react-hooks|react|react-dom|@mui|@emotion|zustand)(?:\/|$)/.test(name))).toEqual([])
  })

  it('keeps the benchmark measurement Worker on the same Domain-only graph', () => {
    const { modules, packages, unresolved } = reachable(BENCHMARK_ENTRY)
    expect(unresolved).toEqual([])
    expect(modules).toContain('src/workers/buildListOptimization.worker.production.ts')
    expect([...modules].filter(path => FORBIDDEN_MODULE.test(path))).toEqual([])
    expect([...packages].filter(name => /^(?:dexie|react|@mui)(?:\/|$)/.test(name))).toEqual([])
  })

  it('walks the edges a bundle keeps (a type-only statement is erased, an inline type specifier is not)', () => {
    expect(importSpecifiers("import type { A } from './a'\nimport { type B } from './b'\nexport * from './c'\nexport type { D } from './d'\nimport './e'\nconst w = new URL('./f.ts', import.meta.url)"))
      .toEqual(['./b', './c', './e', './f.ts'])
    // The walk does see persistence where it is reached: the main-thread Application reads through the repositories, and the
    // Production Client names the Worker entry (a separate bundle) by `new URL()`.
    const application = reachable('src/services/planner/buildListOptimizationService.ts')
    expect(application.modules).toContain('src/db/AppDatabase.ts')
    expect(application.modules).toContain(WORKER_ENTRY)
    expect(application.packages).toContain('dexie')
  })

  it('leaves the Production Planner Worker protocol and Client untouched', () => {
    for (const path of ['src/workers/plannerWorkerContracts.ts', 'src/workers/planner.worker.ts', 'src/workers/planner.worker.entry.ts', 'src/workers/planner.worker.production.ts', 'src/services/planner/plannerWorkerClient.ts']) {
      const source = bySrcPath.get(path)
      expect(source, path).toBeDefined()
      expect(source, path).not.toMatch(/blo_|buildListOptimization|BuildListOptimization|build-list-optimization/)
    }
    // The optimization Worker has its own protocol and never names a Planner Worker request kind.
    for (const path of BOUNDARY_MODULES) {
      expect(codeOf(bySrcPath.get(path)!), path).not.toMatch(/plannerWorkerContracts|'create_plan'|create_planner_alternative|prepare_interaction/)
    }
  })

  it('computes no step bound anywhere in the boundary: the Domain derives it and the artifact summary carries it', () => {
    for (const path of BOUNDARY_MODULES) {
      expect(codeOf(bySrcPath.get(path)!), path).not.toMatch(/deriveBuildListOptimizationMaxPlanSteps|roundUpPlannerMaxPlanSteps|recommendedBuildListMaxPlanSteps|conflictResolutionMaxPlanSteps|PLANNER_MAX_PLAN_STEPS_INCREMENT|BUILD_LIST_OPTIMIZATION_MAX_PLAN_STEPS_MARGIN|defaultPlannerOptions|plannerRuntimeOptions/)
    }
  })

  it('leaves the Worker-side input token to the Domain: the main thread re-derives none of its items', () => {
    for (const path of BOUNDARY_MODULES) {
      expect(codeOf(bySrcPath.get(path)!), path).not.toMatch(/deriveBuildListOptimizationInputToken|createPlanningTargetWeaponsHash|createPlanningBuildListEntriesHash|createExpectedPlanState|createDependent\w*Hash/)
    }
    // The Application's own items are the observed Draft ID and the absence of a running Plan, read with the input.
    expect(codeOf(bySrcPath.get('src/services/planner/buildListOptimizationService.ts')!)).toMatch(/startSnapshot: \{ observedDraftPlanId: draft\?\.id \?\? null, runningPlanAbsent: true \}/)
  })

  it('keeps the search bounds inside the Worker adapter: no request, Client, Application or default carries one', () => {
    for (const path of [...MAIN_THREAD_MODULES, 'src/workers/buildListOptimizationWorkerContracts.ts', 'src/workers/buildListOptimization.worker.ts']) {
      expect(codeOf(bySrcPath.get(path)!), path).not.toMatch(/BuildListOptimizationBounds|nodeBudget|mrvLookahead|maxStructuralCandidates|maxPlannerVerifications|routeGeneration/)
    }
    for (const path of BOUNDARY_MODULES) {
      // No bound from the Candidate Search defaults, a saved setting or the Research registrations.
      expect(codeOf(bySrcPath.get(path)!), path).not.toMatch(/recommendedCandidateSearchDefaults|candidateSearchDefaults|AppSettings|settingsRepository|reachWindowW0|registeredD[01]cConditions|MATERIALIZATION_D0C|PREREGISTRATION/)
    }
    // The Production bounds are not decided yet (U2): the adapter supplies none rather than a guessed value.
    expect(codeOf(bySrcPath.get('src/workers/buildListOptimization.worker.production.ts')!)).toMatch(/export const PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS: BuildListOptimizationBounds \| null = null\n/)
    expect(codeOf(bySrcPath.get(WORKER_ENTRY)!)).toMatch(/createProductionBuildListOptimizationWorkerRuntime\(\)/)
    // Only benchmark harness files name the measurement entry; the normal application never loads it.
    const namers = [...bySrcPath].filter(([path, source]) => !path.includes('.worker.benchmark') && /buildListOptimization\.worker\.benchmark/.test(codeOf(source))).map(([path]) => path)
    expect(namers).toEqual([])
  })

  it('persists nothing, ends no run on a timer and never falls back to the ordinary Planner', () => {
    for (const path of BOUNDARY_MODULES) {
      const code = codeOf(bySrcPath.get(path)!)
      expect(code, path).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|setTimeout|setInterval|fetch\(/)
      expect(code, path).not.toMatch(/savePlanner|createPlan\(|createProductionPlan\(|createPlannerWorkerClient|createProductionPlannerWorkerClient/)
    }
    const service = codeOf(bySrcPath.get('src/services/planner/buildListOptimizationService.ts')!)
    expect(service).not.toMatch(/transaction\(\s*'rw'|database\.\w+\.(?:put|add|bulkPut|bulkAdd|update|bulkDelete|delete|clear)\(|\.(?:put|add|delete|save|ensure)[A-Z]\w*\(/)
    expect(service.match(/database\.transaction\(/g)).toHaveLength(1)
    expect(service).toMatch(/database\.transaction\(\n\s+'r',/)
  })

  it('changes no schema or calculation version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})
