// Issue #154 Phase 2-B Research only. Runs the Phase 2-A Browser Worker controller UNCHANGED in Node
// (same Research call, same fallback, same evidence code) on the ORIGINAL Export, with the Phase 2-B
// full Planner call timeline and the post-hoc autonomous Plan evidence. The only runtime data input is
// the Export; no earlier Phase result, oracle, Target ID or Route is read, embedded or passed.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const EXPECTED_EXPORT_SHA256 = 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b'
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const exportPath = option('--export'), outputPath = option('--output')
const heapProbe = option('--heap-probe') ?? 'used'
const allowUncommitted = args.includes('--allow-uncommitted')
if (!exportPath || !outputPath) throw new Error('Usage: node --max-old-space-size=8192 [--expose-gc] scripts/run-planner-global-phase2b.mjs --export <external.json> --output <new.json> [--heap-probe used|gc|none] [--allow-uncommitted]')
if (!['used', 'gc', 'none'].includes(heapProbe)) throw new Error('Invalid --heap-probe.')
if (heapProbe === 'gc' && typeof globalThis.gc !== 'function') throw new Error('--heap-probe gc requires node --expose-gc.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }

const raw = await readFile(exportPath)
const exportSha256 = createHash('sha256').update(raw).digest('hex')
if (exportSha256 !== EXPECTED_EXPORT_SHA256) throw new Error(`Export SHA-256 ${exportSha256} is not the Phase 1-2 Export.`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const worker = await server.ssrLoadModule('/src/workers/plannerGlobal.worker.benchmark.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const { GlobalRawBlockResearch } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalRawBlocks.ts')
  const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const config = runner.PHASE2A_WORKLOADS.normalWinner('measurement')
  const probe = heapProbe === 'none' ? undefined : {
    label: heapProbe === 'gc' ? 'node v8 used_heap_size after global.gc() (live heap at the mark)' : 'node v8 used_heap_size (includes uncollected garbage)',
    heapUsedBytes: heapProbe === 'gc' ? () => { globalThis.gc(); return getHeapStatistics().used_heap_size } : () => getHeapStatistics().used_heap_size,
  }
  const responses = []
  const controller = worker.createPlannerGlobalBenchmarkController(response => responses.push(response), {
    createEngine: () => new ProductionRngEngine(), createRawBlocks: mode => new GlobalRawBlockResearch(mode),
    // Node: setImmediate is the macrotask yield (the Phase 1-E child's `immediate` mode); no MessagePort is involved.
    yieldFor: () => () => new Promise(done => setImmediate(done)),
    ...(probe ? { timelineHeapProbe: probe } : {}),
  })
  const started = performance.now()
  await controller.handleMessage({ type: 'pg2a_benchmark_run', requestId: 'phase2b-node', input, mode: config.mode, fallbackAxis: config.fallbackAxis,
    rawCache: config.rawCache, yieldMode: config.yieldMode, maxPlanSteps: input.options.maxPlanSteps, fallbackBudgetMs: config.fallbackBudgetMs,
    fallbackMaxEpisodes: config.fallbackMaxEpisodes, attemptBudgetMs: config.attemptBudgetMs, attemptState: null, measurement: 'timing', profiler: false,
    phase2b: { timeline: true, planEvidence: true } })
  const wallMs = performance.now() - started
  const final = responses.find(r => r.type === 'pg2a_benchmark_result' || r.type === 'pg2a_benchmark_cancelled' || r.type === 'pg2a_benchmark_error')
  if (!final || final.type !== 'pg2a_benchmark_result') throw new Error(`Run did not complete: ${JSON.stringify(final)?.slice(0, 2000)}`)
  const record = {
    phase: 'Issue #154 Phase 2-B Node run of the Phase 2-A Worker controller (normal-2x-fallback) with the full Planner call timeline',
    measuredAt: new Date().toISOString(),
    environment: { runtime: 'Node (Vite SSR loader, NOT a Browser Worker)', node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
      cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit,
      execArgv: process.execArgv, repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256: codeHash.digest('hex'),
      exportSha256, exportBytes: raw.length, rngEngineVersion: new ProductionRngEngine().version, calculationContext: input.calculationContext,
      workload: { ...config, attemptState: undefined }, researchMaxPlanSteps: input.options.maxPlanSteps, nodeYield: 'setImmediate', heapProbe },
    wallMs,
    result: final.result,
    progressObservations: responses.filter(r => r.type === 'pg2a_benchmark_progress').length,
  }
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  const r = final.result
  console.log(JSON.stringify({ output: resolve(outputPath), semanticSha256: r.semanticSha256, final: r.report.final && { ...r.report.final, warnings: undefined },
    wallMs, plannerElapsedMs: r.report.plannerElapsedMs, searchElapsedMs: r.report.searchElapsedMs,
    physical: r.phase2b?.autonomousPlan?.physical && { ...r.phase2b.autonomousPlan.physical, executed: undefined, perTarget: undefined } }, null, 2))
} finally {
  await server.close()
}
// The Worker module's MessageChannel yield port keeps Node's event loop alive; the run is finished here.
process.exit(process.exitCode ?? 0)
