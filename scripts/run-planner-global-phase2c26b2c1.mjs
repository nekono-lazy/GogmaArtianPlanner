// Issue #154 Phase 2-C2.6-B2-C1 Research only: the oracle-free fixed-set reservation context schedule of the current Production.
//
// One calculation, no Search: the unchanged B2-B1 snapshot (preparePlannerInitialContext(), K0 / K1 / K2 fixed sets,
// validity, Production reservations, semantic groups, eligible aliases), then per Target x semantic reservation context the
// Target-specific eligible minimum cardinality, the representative alias, the reservation geometry (full and Production
// default window) and the ranks of the four fixed policies P0..P3 (derivePhase2C26B2C1Schedule()). It reads the Export only:
// no earlier RESULT, no oracle and no manifest. Every compatibility judgement is the post-hoc analyzer's.
//
// Run with a large heap, for example: node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2c1.mjs ...
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const exportPath = option('--export'), outputPath = option('--output')
if (!exportPath || !outputPath) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2c1.mjs --export <external.json> --output <new.json.local> [--allow-uncommitted]')
}
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal schedule (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const b2c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')

  const environment = { runtime: 'Node (Vite SSR loader, one process, NOT a Browser Worker)', node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(),
    osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    notRun: [...b2c1.PHASE2C26B2C1_NOT_RUN] }
  const started = performance.now()
  const input = research.globalResearchInputFromExport(JSON.parse(rawExport.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(new ProductionRngEngine()))
  const wallMs = performance.now() - started
  const record = { phase: 'Issue #154 Phase 2-C2.6-B2-C1: oracle-free fixed-set reservation context schedule (Node Research run, raw; no Search)',
    measuredAt: new Date().toISOString(), status: 'completed', environment, researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext,
    schedule, timing: { wallMs }, memory: { rssBytes: process.memoryUsage().rss, maxRssKiB: process.resourceUsage().maxRSS } }
  await writeFile(outputPath, JSON.stringify(record) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), targets: schedule.targets.length, contexts: schedule.contexts.length,
    fixedSets: schedule.snapshot.fixedSets.length, valid: schedule.snapshot.fixedSets.filter(row => row.valid).length, reservationGroups: schedule.snapshot.reservationGroups.length,
    snapshotChecks: schedule.snapshot.checks, checks: schedule.checks, wallMs, head: environment.repositoryHead, uncommitted }, null, 2))
} finally {
  await server.close()
}
