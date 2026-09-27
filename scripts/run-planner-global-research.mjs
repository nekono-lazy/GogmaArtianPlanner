// Explicit external JSON input; does not import into the app or open IndexedDB.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, openSync, writeSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, totalmem } from 'node:os'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
if (new Set(flags).size !== flags.length) throw new Error('Duplicate research option; specify each bound or mode once.')
const option = name => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const inputPath = option('--export'), outputPath = option('--output')
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/run-planner-global-research.mjs --export <external.json> --output <new-report.json> [--max-plan-steps 20000] [--cancel-after-ms N] [--profile] [--capture-inputs <new-local.jsonl>] [--strategy phase0|failed-first --observed-report <phase0-report.json>] [--focus-inputs <local.jsonl> --focus-target <full-id> --route-filter all|existing_gogma|normal_artian --normal N --gogma N --skill N --time-budget-ms 180000] [--yield-mode timer|immediate]')
if (resolve(inputPath) === resolve(outputPath)) throw new Error('Output must not overwrite the input Export.')
const maxPlanSteps = Number(option('--max-plan-steps') ?? 20000)
const cancelAfterMs = option('--cancel-after-ms') === undefined ? null : Number(option('--cancel-after-ms'))
const profileEnabled = args.includes('--profile')
const strategy = option('--strategy') ?? 'phase0'
const capturePath = option('--capture-inputs')
const focusPath = option('--focus-inputs'), focusTarget = option('--focus-target')
const observedReportPath = option('--observed-report')
const routeFilter = option('--route-filter') ?? 'all'
const timeBudgetMs = Number(option('--time-budget-ms') ?? 180000)
const yieldMode = option('--yield-mode') ?? 'timer'
if (!['timer', 'immediate'].includes(yieldMode)) throw new Error('Invalid Node yield mode.')
const yieldControl = () => new Promise(resolveYield => yieldMode === 'immediate' ? setImmediate(resolveYield) : setTimeout(resolveYield, 0))
if (!['phase0', 'failed-first'].includes(strategy) || !['all', 'normal_artian', 'existing_gogma'].includes(routeFilter)) throw new Error('Invalid research strategy or route filter.')
if (strategy === 'failed-first' && !observedReportPath) throw new Error('failed-first requires --observed-report with actual bounded failures.')
if (Boolean(focusPath) !== Boolean(focusTarget)) throw new Error('--focus-inputs and --focus-target are required together.')
if (focusPath && (capturePath || strategy !== 'phase0')) throw new Error('Focused Search cannot capture a global run or change its order.')
if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 0) throw new Error('Invalid focus time budget.')
if (!Number.isSafeInteger(maxPlanSteps) || maxPlanSteps < 1 || (cancelAfterMs !== null && (!Number.isFinite(cancelAfterMs) || cancelAfterMs < 0))) throw new Error('Invalid research bounds.')
// Refuse an existing output before opening progress evidence or starting Research.
// Keep the final exclusive write too: another process may create it during the run.
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const reads = [inputPath, focusPath, observedReportPath].filter(Boolean).map(p => resolve(p).toLowerCase())
const writes = [outputPath, `${outputPath}.progress.local`, capturePath].filter(Boolean).map(p => resolve(p).toLowerCase())
if (new Set(writes).size !== writes.length || writes.some(p => reads.includes(p))) throw new Error('Research output paths must be distinct from every input and output.')
if (capturePath && lstatSync(capturePath, { throwIfNoEntry: false }) !== undefined) throw new Error('Capture already exists.')
// Append-only progress evidence survives a killed process / out-of-memory failure.
// Exclusive creation prevents overwriting another run's evidence.
const progressFd = openSync(`${outputPath}.progress.local`, 'wx')
const captureFd = capturePath ? openSync(capturePath, 'wx') : null
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
  const { GlobalSearchProfiler } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationProfile.ts')
  const profiler = profileEnabled ? new GlobalSearchProfiler() : undefined
  let failedFirstTargetIds
  if (strategy === 'failed-first') {
    const observed = JSON.parse(await readFile(observedReportPath, 'utf8'))
    if (observed.environment.exportSha256 !== environment.exportSha256) throw new Error('Observed report Export SHA differs.')
    failedFirstTargetIds = observed.report.searches.filter(s => s.status === 'not_found_within_extent').map(s => s.targetId)
    if (failedFirstTargetIds.length === 0) throw new Error('Observed report contains no bounded failures.')
  }
  let latest
  let lastStage = ''
  if (cancelAfterMs !== null) timer = setTimeout(cancel, cancelAfterMs)
  let result
  let focus
  if (focusPath) {
    const records = (await readFile(focusPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
    const selected = records.filter(r => r.input.targetWeaponId === focusTarget)
    if (selected.length !== 1 || selected[0].exportSha256 !== environment.exportSha256) throw new Error('Focus snapshot missing, ambiguous, or from another Export.')
    const snapshot = selected[0].input
    const extent = { maxNormalAdvance: Number(option('--normal') ?? snapshot.settings.maxNormalAdvance),
      maxGogmaAdvance: Number(option('--gogma') ?? snapshot.settings.maxGogmaAdvance), maxSkillAdvance: Number(option('--skill') ?? snapshot.settings.maxSkillAdvance) }
    const { runGlobalResearchFocus } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationFocus.ts')
    focus = await runGlobalResearchFocus(snapshot, new ProductionRngEngine(), { extent, routeFilter, timeBudgetMs,
      shouldCancel: () => cancelledAt !== null, yieldControl })
  } else result = await module.runGlobalPlannerResearch(input, module.globalResearchDependencies(new ProductionRngEngine()), {
    profiler, failedFirstTargetIds,
    onSearchInput: captureFd === null ? undefined : searchInput => writeSync(captureFd, JSON.stringify({ exportSha256: environment.exportSha256, input: searchInput }) + '\n'),
    shouldCancel: () => cancelledAt !== null,
    yieldControl,
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
  const record = { environment, ...(focus ? { focus } : { report: result.report }),
    ...(profileEnabled || focus || strategy !== 'phase0' || yieldMode !== 'timer' ? { phase1: { strategy, yieldMode, failedFirstTargetIds: failedFirstTargetIds ?? [], predictionReuse: profiler?.summary() ?? null,
      resultSha256: result ? createHash('sha256').update(JSON.stringify({ finalResult: result.finalResult, generatedEntries: result.generatedEntries })).digest('hex') : null } } : {}),
    memory: { maxRssKiB: process.resourceUsage().maxRSS, ...process.memoryUsage(), scope: 'whole Node process, includes Vite loader and Export parsing' },
    cancel: { requested: cancelledAt !== null, responseMs: cancelledAt === null ? null : performance.now() - cancelledAt },
  }
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), ...(focus ? { focus } : { report: latest }) }, null, 2))
  if (result?.report.status === 'error' || focus?.status === 'search_error') process.exitCode = 1
} finally {
  clearTimeout(timer)
  process.off('SIGINT', cancel)
  closeSync(progressFd)
  if (captureFd !== null) closeSync(captureFd)
  await server.close()
}
