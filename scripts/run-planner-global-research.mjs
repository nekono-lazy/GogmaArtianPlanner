// Explicit external JSON input; does not import into the app or open IndexedDB.
import { readFile, writeFile } from 'node:fs/promises'
import { openSync, writeSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, totalmem } from 'node:os'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const inputPath = option('--export'), outputPath = option('--output')
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/run-planner-global-research.mjs --export <external.json> --output <report.json> [--max-plan-steps 20000] [--cancel-after-ms N]')
if (resolve(inputPath) === resolve(outputPath)) throw new Error('Output must not overwrite the input Export.')
const maxPlanSteps = Number(option('--max-plan-steps') ?? 20000)
const cancelAfterMs = option('--cancel-after-ms') === undefined ? null : Number(option('--cancel-after-ms'))
if (!Number.isSafeInteger(maxPlanSteps) || maxPlanSteps < 1 || (cancelAfterMs !== null && (!Number.isFinite(cancelAfterMs) || cancelAfterMs < 0))) throw new Error('Invalid research bounds.')
// Append-only progress evidence survives a killed process / out-of-memory failure.
// Exclusive creation prevents overwriting another run's evidence.
const progressFd = openSync(`${outputPath}.progress.local`, 'wx')
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
let timer, cancelledAt = null
const cancel = () => { cancelledAt ??= performance.now() }
process.on('SIGINT', cancel)
try {
  const module = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const raw = await readFile(inputPath, 'utf8')
  const input = module.globalResearchInputFromExport(JSON.parse(raw), maxPlanSteps)
  const environment = { runtime: 'Node (not Browser Worker)', node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    exportSha256: createHash('sha256').update(raw).digest('hex'), maxPlanSteps, extent: module.GLOBAL_RESEARCH_EXTENT }
  let latest
  let lastStage = ''
  if (cancelAfterMs !== null) timer = setTimeout(cancel, cancelAfterMs)
  const result = await module.runGlobalPlannerResearch(input, module.globalResearchDependencies(new ProductionRngEngine()), {
    shouldCancel: () => cancelledAt !== null,
    yieldControl: () => new Promise(resolveYield => setTimeout(resolveYield, 0)),
    onProgress: report => {
      latest = report
      const stage = `${report.stage}: ${report.baseline?.selected ?? '-'} / ${report.retained?.selected ?? '-'} / ${report.searches.length} searches / ${report.generatedReplacementCount} replacements / ${report.status}`
      if (stage !== lastStage) {
        console.error(stage)
        writeSync(progressFd, JSON.stringify({ at: new Date().toISOString(), report }) + '\n')
        lastStage = stage
      }
    },
  })
  const record = { environment, report: result.report, memory: { maxRssKiB: process.resourceUsage().maxRSS, ...process.memoryUsage(), scope: 'whole Node process, includes Vite loader and Export parsing' },
    cancel: { requested: cancelledAt !== null, responseMs: cancelledAt === null ? null : performance.now() - cancelledAt },
  }
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), report: latest }, null, 2))
  if (result.report.status === 'error') process.exitCode = 1
} finally {
  clearTimeout(timer)
  process.off('SIGINT', cancel)
  closeSync(progressFd)
  await server.close()
}
