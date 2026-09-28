// Issue #154 Phase 2-C1 Research only. Runs ONE variant (control | origin-independent-canonical) of the Phase 1-E
// normal-2x-fallback Research from the ORIGINAL Export in this fresh Node process and writes its record. The only
// runtime data input is the Export; no earlier Phase result, oracle, lower bound, Target ID, Route or Counter position
// is read, embedded or passed. The Export SHA-256 is measured and recorded, never checked against an embedded value.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const exportPath = option('--export'), outputPath = option('--output'), variantId = option('--variant')
const allowUncommitted = args.includes('--allow-uncommitted')
if (!exportPath || !outputPath || !variantId) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/run-planner-global-phase2c1.mjs --export <external.json> --variant control|origin-independent-canonical --output <new.json> [--allow-uncommitted]')
}
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
const sha256 = async text => createHash('sha256').update(text).digest('hex')

// Reference only: the largest sampled used heap (includes uncollected garbage) and the process max RSS.
let peakHeapUsedBytes = 0
const sampleHeap = () => { peakHeapUsedBytes = Math.max(peakHeapUsedBytes, process.memoryUsage().heapUsed) }
const heapTimer = setInterval(sampleHeap, 250)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C1.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const { GlobalRawBlockResearch } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalRawBlocks.ts')
  const variant = c1.PHASE2C1_VARIANTS[variantId]
  if (!variant) throw new Error(`Unknown variant ${variantId}.`)
  const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const started = performance.now()
  const run = await c1.runPhase2C1Variant(input, variant, {
    createEngine: () => new ProductionRngEngine(), createRawBlocks: mode => new GlobalRawBlockResearch(mode), sha256,
    // Node: setImmediate is the macrotask yield (the Phase 1-E child's `immediate` mode, Phase 2-B Node runner).
    yieldControl: () => new Promise(done => { sampleHeap(); setImmediate(done) }),
  })
  const wallMs = performance.now() - started
  sampleHeap()
  clearInterval(heapTimer)
  const record = {
    phase: 'Issue #154 Phase 2-C1: origin-independent canonical Candidate Search vs sequential projection (Node Research run)',
    measuredAt: new Date().toISOString(),
    environment: { runtime: 'Node (Vite SSR loader, NOT a Browser Worker)', node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
      cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit,
      execArgv: process.execArgv, repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256: codeHash.digest('hex'),
      exportFileName: exportPath.split(/[\\/]/).at(-1), exportSha256, exportBytes: raw.length, rngEngineVersion: new ProductionRngEngine().version,
      calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps, nodeYield: 'setImmediate' },
    variant,
    wallMs,
    memory: { peakSampledHeapUsedBytes: peakHeapUsedBytes, maxRssKiB: process.resourceUsage().maxRSS,
      note: 'Reference only: heapUsed sampled every 250 ms and at each yield (includes uncollected garbage); maxRSS from process.resourceUsage().' },
    result: run,
  }
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  const a = run.analysis, f = a.finished ? a.final : null
  console.log(JSON.stringify({ output: resolve(outputPath), variant: variant.id, status: run.report.status, stage: run.report.stage, error: run.report.error,
    semanticSha256: run.semanticSha256, timing: run.timing, wallMs,
    final: f && { completed: `${f.completedTargetCount}/${f.planningTargetCount}`, selected: f.selected, conflicts: f.conflicts, conflictsByKind: f.conflictsByKind,
      rejected: f.rejected, rejectedByReason: f.rejectedByReason, planSteps: f.planSteps, expandedStates: f.expandedStates, traceReplay: f.traceReplay, warnings: f.warningsByKind },
    candidates: a.finished ? a.candidateCounts : null, stacking: a.finished ? { all: a.stacking.all, gogma: a.stacking.gogma, skill: a.stacking.skill } : null,
    searchOrigin: a.finished ? a.searchOrigin : null, memory: record.memory }, null, 2))
} finally {
  clearInterval(heapTimer)
  await server.close()
}
