// Explicit external JSON input; does not import into the app or open IndexedDB.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, openSync, writeSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { getHeapStatistics } from 'node:v8'
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
const attemptPath = option('--attempt-state')
const capturePath = option('--capture-inputs')
const focusPath = option('--focus-inputs'), focusTarget = option('--focus-target')
const observedReportPath = option('--observed-report')
const routeFilter = option('--route-filter') ?? 'all'
const timeBudgetMs = Number(option('--time-budget-ms') ?? 180000)
const yieldMode = option('--yield-mode') ?? 'timer'
const rawCacheMode = option('--raw-block-cache')
// Phase 1-D (Research only): bounded no-match capture, same-snapshot single-axis probe, generic fallback.
const noMatchCapturePath = option('--capture-no-match')
const probePath = option('--probe-snapshot'), probeTarget = option('--probe-target'), probeAxis = option('--probe-axis')
const fallbackAxis = option('--extent-fallback')
const fallbackBudgetMs = Number(option('--fallback-budget-ms') ?? 180000)
const cancelAfterFallbackStartMs = option('--cancel-after-fallback-start-ms') === undefined ? null : Number(option('--cancel-after-fallback-start-ms'))
if (rawCacheMode !== undefined && !['off', 'per-search', 'run'].includes(rawCacheMode)) throw new Error('Invalid raw block cache mode.')
if (!['timer', 'immediate'].includes(yieldMode)) throw new Error('Invalid Node yield mode.')
const yieldControl = () => new Promise(resolveYield => yieldMode === 'immediate' ? setImmediate(resolveYield) : setTimeout(resolveYield, 0))
if (!['phase0', 'failed-first'].includes(strategy) || !['all', 'normal_artian', 'existing_gogma'].includes(routeFilter)) throw new Error('Invalid research strategy or route filter.')
if (strategy === 'failed-first' && !observedReportPath) throw new Error('failed-first requires --observed-report with actual bounded failures.')
if (Boolean(focusPath) !== Boolean(focusTarget)) throw new Error('--focus-inputs and --focus-target are required together.')
if (focusPath && (capturePath || strategy !== 'phase0')) throw new Error('Focused Search cannot capture a global run or change its order.')
if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 0) throw new Error('Invalid focus time budget.')
if ([probePath, probeTarget, probeAxis].some(Boolean) && ![probePath, probeTarget, probeAxis].every(Boolean)) throw new Error('--probe-snapshot, --probe-target and --probe-axis are required together.')
if (probePath && (focusPath || capturePath || noMatchCapturePath || fallbackAxis || strategy !== 'phase0' || attemptPath)) throw new Error('A probe runs one captured Search only.')
if (fallbackAxis !== undefined && !['normal', 'gogma', 'skill'].includes(fallbackAxis)) throw new Error('Invalid fallback axis.')
if (probeAxis !== undefined && !['normal', 'gogma', 'skill'].includes(probeAxis)) throw new Error('Invalid probe axis.')
if (!Number.isFinite(fallbackBudgetMs) || fallbackBudgetMs < 0 || (cancelAfterFallbackStartMs !== null && (!Number.isFinite(cancelAfterFallbackStartMs) || cancelAfterFallbackStartMs < 0))) throw new Error('Invalid fallback bounds.')
if (cancelAfterFallbackStartMs !== null && !fallbackAxis) throw new Error('--cancel-after-fallback-start-ms requires --extent-fallback.')
if (!Number.isSafeInteger(maxPlanSteps) || maxPlanSteps < 1 || (cancelAfterMs !== null && (!Number.isFinite(cancelAfterMs) || cancelAfterMs < 0))) throw new Error('Invalid research bounds.')
// Refuse an existing output before opening progress evidence or starting Research.
// Keep the final exclusive write too: another process may create it during the run.
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const reads = [inputPath, focusPath, observedReportPath, attemptPath, probePath].filter(Boolean).map(p => resolve(p).toLowerCase())
const writes = [outputPath, `${outputPath}.progress.local`, capturePath, noMatchCapturePath].filter(Boolean).map(p => resolve(p).toLowerCase())
if (new Set(writes).size !== writes.length || writes.some(p => reads.includes(p))) throw new Error('Research output paths must be distinct from every input and output.')
if ([capturePath, noMatchCapturePath].some(p => p && lstatSync(p, { throwIfNoEntry: false }) !== undefined)) throw new Error('Capture already exists.')
// Append-only progress evidence survives a killed process / out-of-memory failure.
// Exclusive creation prevents overwriting another run's evidence.
const progressFd = openSync(`${outputPath}.progress.local`, 'wx')
const captureFd = capturePath ? openSync(capturePath, 'wx') : null
const noMatchFd = noMatchCapturePath ? openSync(noMatchCapturePath, 'wx') : null
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
let timer, fallbackCancelTimer, cancelledAt = null
const cancel = () => { cancelledAt ??= performance.now() }
process.on('SIGINT', cancel)
try {
  const module = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const raw = await readFile(inputPath, 'utf8')
  const input = module.globalResearchInputFromExport(JSON.parse(raw), maxPlanSteps)
  const retryModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationRetry.ts')
  const attemptState = attemptPath ? retryModule.parseDiscoveryState(JSON.parse(await readFile(attemptPath, 'utf8'))) : undefined
  const environment = { runtime: 'Node (not Browser Worker)', node: process.version, platform: process.platform, arch: process.arch,
    heapSizeLimitBytes: getHeapStatistics().heap_size_limit, execArgv: process.execArgv,
    cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    exportSha256: createHash('sha256').update(raw).digest('hex'), maxPlanSteps, extent: module.GLOBAL_RESEARCH_EXTENT }
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  let rawBlocks
  const searchEvidence = []
  const observeSearchResult = result => {
    if (result === null) { searchEvidence.push({ resultSha256: sha(null), candidateSha256: sha(null) }); return }
    const { elapsedMs: _elapsedMs, ...semantic } = result
    searchEvidence.push({ targetId: result.targetResult.targetWeaponId, resultSha256: sha(semantic), candidateSha256: sha(result.targetResult.candidate) })
  }
  if (rawCacheMode !== undefined) {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
    const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
    if (git('diff', 'HEAD', '--', ...codePaths)) throw new Error('Commit benchmark-affecting changes before measuring raw blocks.')
    const files = git('ls-files', '--', ...codePaths).split(/\r?\n/)
    const hash = createHash('sha256')
    for (const file of files) { hash.update(file + '\0'); hash.update(await readFile(file)); hash.update('\0') }
    Object.assign(environment, { repositoryHead: git('rev-parse', 'HEAD'), benchmarkCodeSha256: hash.digest('hex'),
      rngEngineVersion: new ProductionRngEngine().version, osRelease: release(), benchmarkMode: probePath ? 'phase1d-probe' : focusPath ? 'focused' : fallbackAxis ? `phase1d-${fallbackAxis}-fallback` : strategy,
      cacheMode: rawCacheMode, yieldMode, routeFilter, cacheScope: 'Candidate Search only; Planner and Replay always use default ProductionRngEngine' })
    const { GlobalRawBlockResearch } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalRawBlocks.ts')
    rawBlocks = new GlobalRawBlockResearch(rawCacheMode)
  }
  const { GlobalSearchProfiler } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationProfile.ts')
  const profiler = profileEnabled || rawBlocks ? new GlobalSearchProfiler() : undefined
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
  let probe
  const fallbackSearchEvidence = [], noMatchCaptures = []
  const probeModule = probePath || fallbackAxis ? await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationExtentProbe.ts') : null
  if (probePath) {
    const records = (await readFile(probePath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
    const selected = records.filter(r => r.capture.searchInput.targetWeaponId === probeTarget)
    if (selected.length !== 1 || selected[0].exportSha256 !== environment.exportSha256) throw new Error('Probe snapshot missing, ambiguous, or from another Export.')
    const capture = selected[0].capture
    if (selected[0].snapshotSha256 !== sha(capture.searchInput)) throw new Error('Probe snapshot SHA differs from its capture record.')
    Object.assign(environment, { probeAxis, timeBudgetMs, snapshotSha256: selected[0].snapshotSha256, baseExtent: capture.measurement.extent,
      probeExtent: probeModule.singleAxisProbeExtent(capture.measurement.extent, probeAxis) })
    probe = await probeModule.runGlobalExtentProbe(input, capture, probeAxis, module.globalResearchDependencies(new ProductionRngEngine()), {
      timeBudgetMs, shouldCancel: () => cancelledAt !== null, yieldControl, rawBlocks, profiler: new GlobalSearchProfiler(),
      onResult: rawBlocks ? observeSearchResult : undefined })
    probe.candidateSha256 = rawBlocks ? searchEvidence.at(-1)?.candidateSha256 ?? null : null
  } else if (focusPath) {
    const records = (await readFile(focusPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
    const selected = records.filter(r => r.input.targetWeaponId === focusTarget)
    if (selected.length !== 1 || selected[0].exportSha256 !== environment.exportSha256) throw new Error('Focus snapshot missing, ambiguous, or from another Export.')
    const snapshot = selected[0].input
    const extent = { maxNormalAdvance: Number(option('--normal') ?? snapshot.settings.maxNormalAdvance),
      maxGogmaAdvance: Number(option('--gogma') ?? snapshot.settings.maxGogmaAdvance), maxSkillAdvance: Number(option('--skill') ?? snapshot.settings.maxSkillAdvance) }
    if (rawBlocks) Object.assign(environment, { extent, snapshotSha256: sha(snapshot), timeBudgetMs })
    const { runGlobalResearchFocus } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationFocus.ts')
    focus = await runGlobalResearchFocus(snapshot, new ProductionRngEngine(), { extent, routeFilter, timeBudgetMs,
      shouldCancel: () => cancelledAt !== null, yieldControl, rawBlocks, onResult: rawBlocks ? observeSearchResult : undefined })
  } else result = await module.runGlobalPlannerResearch(input, module.globalResearchDependencies(new ProductionRngEngine()), {
    profiler, failedFirstTargetIds, rawBlocks, onSearchResult: rawBlocks ? observeSearchResult : undefined,
    attempt: attemptState, extent: attemptState?.extent,
    extentFallback: fallbackAxis ? probeModule.createSingleAxisExtentFallback(fallbackAxis, fallbackBudgetMs) : undefined,
    onFallbackSearchResult: fallbackAxis ? (found, fallback) => {
      const semantic = { ...found }
      delete semantic.elapsedMs
      fallbackSearchEvidence.push({ targetId: found.targetResult.targetWeaponId, axis: fallback.axis, extent: fallback.extent, searchRunId: fallback.searchRunId,
        resultSha256: sha(semantic), candidateSha256: sha(found.targetResult.candidate) })
    } : undefined,
    onBoundedNoMatch: noMatchFd === null ? undefined : capture => {
      const snapshotSha256 = sha(capture.searchInput)
      noMatchCaptures.push({ searchIndex: capture.searchIndex, targetId: capture.searchInput.targetWeaponId, snapshotSha256, baseSearchRunId: capture.searchInput.searchRunId,
        baseBoundary: capture.measurement.predictionBoundaryReached, baseReach: capture.measurement.observedPredictionReach, baseExtent: capture.measurement.extent })
      writeSync(noMatchFd, JSON.stringify({ exportSha256: environment.exportSha256, snapshotSha256, capture }) + '\n')
    },
    timeBudgetMs: option('--attempt-budget-ms') === undefined ? undefined : Number(option('--attempt-budget-ms')),
    onSearchInput: captureFd === null ? undefined : searchInput => writeSync(captureFd, JSON.stringify({ exportSha256: environment.exportSha256, input: searchInput }) + '\n'),
    shouldCancel: () => cancelledAt !== null,
    yieldControl,
    onProgress: report => {
      latest = report
      if (cancelAfterFallbackStartMs !== null && fallbackCancelTimer === undefined && report.searches.some(s => s.fallback?.status === 'searching')) {
        fallbackCancelTimer = setTimeout(cancel, cancelAfterFallbackStartMs)
      }
      const stage = `${report.stage}: ${report.baseline?.selected ?? '-'} / ${report.retained?.selected ?? '-'} / ${report.searches.length} searches / ${report.generatedReplacementCount} replacements / ${report.status}`
      if (stage !== lastStage) {
        console.error(stage)
        writeSync(progressFd, JSON.stringify({ at: new Date().toISOString(), environment, report,
          priorityEntries: retryModule.stableResearchEntries(input).map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId })),
          memory: { maxRssKiB: process.resourceUsage().maxRSS, ...process.memoryUsage() } }) + '\n')
        lastStage = stage
      }
    },
  })
  const signals = result ? retryModule.collectRetrySignals(input, result.report, result.finalResult, result.generatedEntries) : null
  const record = { environment, ...(probe ? { probe } : focus ? { focus } : { report: result.report }),
    ...(result && (fallbackAxis || noMatchCapturePath) ? { phase1d: { extentFallback: fallbackAxis ? probeModule.createSingleAxisExtentFallback(fallbackAxis, fallbackBudgetMs).strategy : null,
      fallbackBudgetMs: fallbackAxis ? fallbackBudgetMs : null, noMatchCaptures, fallbackSearchEvidence,
      fallbacks: result.report.searches.flatMap((s, searchIndex) => s.fallback ? [{ searchIndex, targetId: s.targetId, baseStatus: s.status, targetOutcome: s.targetOutcome ?? null,
        fallback: { ...s.fallback, profile: undefined } }] : []) } } : {}),
    ...(result ? { phase1c: { signals, stop: retryModule.classifyAttempt(result.report, signals),
      priorityEntries: retryModule.stableResearchEntries(input).map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId })),
      attemptState: attemptState ?? null } } : {}),
    ...(rawBlocks ? { phase1b: { rawBlocks: rawBlocks.profiles, rawBlockSummary: rawBlocks.summary(), searchEvidence,
      generatedEntries: result?.generatedEntries.map(entry => ({ id: entry.id, candidateSha256: sha(entry.candidateSnapshot), entrySha256: sha(entry) })) ?? [],
      finalSelectedEntryIds: result?.finalResult?.plan?.selectedBuildListEntryIds ?? [],
      planSha256: sha(result?.finalResult?.plan ?? null), finalResultSha256: sha(result?.finalResult ?? null),
      resultSha256: sha({ finalResult: result?.finalResult ?? null, generatedEntries: result?.generatedEntries ?? [] }),
      cacheLimit: rawBlocks.maxEntries } } : {}),
    ...(profileEnabled || focus || strategy !== 'phase0' || yieldMode !== 'timer' ? { phase1: { strategy, yieldMode, failedFirstTargetIds: failedFirstTargetIds ?? [], predictionReuse: profiler?.summary() ?? null,
      resultSha256: result ? createHash('sha256').update(JSON.stringify({ finalResult: result.finalResult, generatedEntries: result.generatedEntries })).digest('hex') : null } } : {}),
    memory: { maxRssKiB: process.resourceUsage().maxRSS, ...process.memoryUsage(), scope: 'whole Node process, includes Vite loader and Export parsing' },
    cancel: { requested: cancelledAt !== null, responseMs: cancelledAt === null ? null : performance.now() - cancelledAt },
  }
  rawBlocks?.endRun()
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(outputPath), ...(probe ? { probe: { ...probe, profile: undefined } } : focus ? { focus } : { report: latest }) }, null, 2))
  if (result?.report.status === 'error' || focus?.status === 'search_error' || probe?.status === 'search_error') process.exitCode = 1
} finally {
  clearTimeout(timer)
  clearTimeout(fallbackCancelTimer)
  process.off('SIGINT', cancel)
  closeSync(progressFd)
  if (captureFd !== null) closeSync(captureFd)
  if (noMatchFd !== null) closeSync(noMatchFd)
  await server.close()
}
