// Issue #154 Phase 2-C2 Research only: Candidate portfolio from the ORIGINAL Export's baseline Conflicts.
//
// Parent (default role): spawns fresh child processes, each reloading the original Export,
//   1. `baseline`     : the ordinary Production Planner over the original Build List, its Conflicts -> orientations;
//   2. `kernel`       : one orientation = the current Planner Alternative kernel, unchanged
//                       (default Production extent / trial bounds, no lineage);
//   2b. `portfolio`   : the post-hoc portfolio Search of one searched Target of a completed kernel (capture bound 8);
//   3. probes         : `portfolio` children at a Research probe extent, one grid step at a time on the Conflict kind's
//                       axis only, only while the context stopped by extent with fewer than 8 Candidates;
// then aggregates the per-Target portfolio. The only runtime data input is the Export; no earlier Phase result, oracle,
// lower bound, Target ID, Route or Counter position is read, embedded or passed. Children get only what an earlier
// child of THIS run derived (an orientation, a recorded context). A child failure (timeout, out of memory, any other
// process failure) is recorded as a failure and never as "no Candidate".
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) throw new Error('Usage: node scripts/run-planner-global-phase2c2.mjs --export <external.json> --out-dir <dir> --output <new.json.local> [--concurrency N] [--child-heap-mb N] [--orientation-budget-ms N] [--probe-budget-ms N] [--probe-total-budget-ms N] [--allow-uncommitted]')

const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

async function withModules(body) {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
  try {
    const c2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2.ts')
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
    const fixtures = await server.ssrLoadModule('/src/benchmarks/plannerAlternativeBenchmarkFixtures.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    return await body({ c2, research, runner, fixtures, ProductionRngEngine })
  } finally {
    await server.close()
  }
}

if (role !== 'parent') {
  // ------------------------------------------------------------------ child
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath) throw new Error('A child needs --record.')
  let peakHeapUsedBytes = 0
  const sampleHeap = () => { peakHeapUsedBytes = Math.max(peakHeapUsedBytes, process.memoryUsage().heapUsed) }
  const timer = setInterval(sampleHeap, 250)
  try {
    await withModules(async ({ c2, research, runner, ProductionRngEngine }) => {
      const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
      const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
      const dependencies = { createEngine: () => new ProductionRngEngine(), yieldControl: () => new Promise(done => { sampleHeap(); setImmediate(done) }) }
      const started = performance.now()
      let result
      if (role === 'baseline') result = await c2.runPhase2C2Baseline(input, dependencies)
      else if (role === 'kernel') result = await c2.runPhase2C2Kernel(input, task.orientation, task.conditions, dependencies)
      else if (role === 'portfolio') result = await c2.runPhase2C2PortfolioContext(input, task.kernelTarget, task.orientation, task.conditions, task.extent, task.extentLabel, dependencies)
      else throw new Error(`Unknown role ${role}.`)
      sampleHeap()
      await write(recordPath, { role, task, wallMs: performance.now() - started,
        memory: { peakSampledHeapUsedBytes: peakHeapUsedBytes, maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
        researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, result })
    })
  } finally {
    clearInterval(timer)
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const outDir = option('--out-dir'), outputPath = option('--output')
if (!outDir || !outputPath) throw new Error('The parent needs --out-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(outDir)) throw new Error(`Out dir already exists: ${resolve(outDir)}`)
await mkdir(outDir, { recursive: true })
const concurrency = Number(option('--concurrency') ?? 2)
const childHeapMb = Number(option('--child-heap-mb') ?? 8192)
const orientationBudgetMs = Number(option('--orientation-budget-ms') ?? 1_800_000)
const probeBudgetMs = Number(option('--probe-budget-ms') ?? 600_000)
const probeTotalBudgetMs = Number(option('--probe-total-budget-ms') ?? 5_400_000)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: run the first N orientations (never with a formal measurement).
const smokeOrientationLimit = option('--smoke-orientations') === undefined ? null : Number(option('--smoke-orientations'))
if (smokeOrientationLimit !== null && !allowUncommitted) throw new Error('--smoke-orientations is a non-formal probe and needs --allow-uncommitted.')
for (const value of [concurrency, childHeapMb, orientationBudgetMs, probeBudgetMs, probeTotalBudgetMs]) if (!Number.isInteger(value) || value <= 0) throw new Error('Invalid numeric option.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const raw = await readFile(exportPath)
const exportSha256 = createHash('sha256').update(raw).digest('hex')
const scriptPath = 'scripts/run-planner-global-phase2c2.mjs'
const processes = []
const phaseStarted = performance.now()

/** One fresh child. Resolves with its record (or null) and a classified outcome; never throws for a child failure. */
function runChild(c2, id, childRole, task, budgetMs) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(outDir, `${id}.task.json`)
    const recordPath = join(outDir, `${id}.record.json`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [`--max-old-space-size=${childHeapMb}`, scriptPath, '--role', childRole, '--export', exportPath, '--record', recordPath, ...(taskPath ? ['--task', taskPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, budgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8000) })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const recordWritten = existsSync(recordPath)
        const outcome = c2.classifyPhase2C2ChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began,
          stderrTail: outcome === 'completed' ? null : stderrTail.slice(-2000) }
        processes.push(entry)
        console.log(`${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s`)
        const record = outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        done({ entry, record })
      })
    }
    start()
  })
}

async function pool(items, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index], index) }
  }))
  return results
}

await withModules(async ({ c2, fixtures, ProductionRngEngine }) => {
  const baselineRun = await runChild(c2, 'baseline', 'baseline', null, orientationBudgetMs)
  if (!baselineRun.record) throw new Error('The baseline child failed; nothing else is meaningful.')
  const baseline = baselineRun.record.result
  const conditions = c2.phase2c2ProductionDefaultConditions()
  console.log(`baseline: ${baseline.summary.completedTargetCount}/${baseline.summary.planningTargetCount} completed, ${baseline.summary.conflicts} conflicts, ${baseline.summary.planSteps} steps, ${baseline.orientations.length} orientations`)

  // 1. The current kernel per orientation (its own child: a kernel failure keeps every other record).
  const orientations = smokeOrientationLimit === null ? baseline.orientations : baseline.orientations.slice(0, smokeOrientationLimit)
  const kernelRuns = await pool(orientations, orientation =>
    runChild(c2, `kernel-${orientation.orientationId}`, 'kernel', { orientation, conditions }, orientationBudgetMs))
  const kernels = kernelRuns.map((run, index) => ({ orientation: orientations[index], process: run.entry, record: run.record?.result ?? null,
    wallMs: run.record?.wallMs ?? null, memory: run.record?.memory ?? null }))

  // 2. The post-hoc portfolio Search of every searched Target of a completed kernel, at the kernel's own extent.
  const portfolioTasks = kernels.flatMap(({ orientation, record }) => record?.kernel.status === 'completed'
    ? record.kernel.targets.filter(target => target.reservation !== null).map(kernelTarget => ({ orientation, kernelTarget })) : [])
  const unsearchedKernelTargets = kernels.flatMap(({ orientation, record }) => record?.kernel.status === 'completed'
    ? record.kernel.targets.filter(target => target.reservation === null).map(target => ({ orientationId: orientation.orientationId, targetWeaponId: target.targetWeaponId, outcome: target.outcome })) : [])
  const portfolioRuns = await pool(portfolioTasks, ({ orientation, kernelTarget }) =>
    runChild(c2, `portfolio-${orientation.orientationId}-${kernelTarget.targetWeaponId}-default`, 'portfolio',
      { orientation, conditions, kernelTarget, extent: conditions.extent, extentLabel: 'default' }, probeBudgetMs))
  const defaultContextRuns = portfolioRuns.map((run, index) => ({ ...portfolioTasks[index], process: run.entry, context: run.record?.result ?? null,
    wallMs: run.record?.wallMs ?? null, memory: run.record?.memory ?? null }))
  const defaultContexts = defaultContextRuns.flatMap(run => run.context ? [run.context] : [])

  // 3. Probes: one grid step at a time per context, on the Conflict kind's axis only; a failure ends that context.
  const grid = fixtures.BENCHMARK_ONLY_EXTENT_GRID
  const axisField = { normal: 'maxNormalAdvance', gogma: 'maxGogmaAdvance', skill: 'maxSkillAdvance' }
  const probeStarted = performance.now()
  const probeContexts = [], probeLog = []
  let frontier = defaultContextRuns.filter(run => run.context).map(run => ({ orientation: run.orientation, kernelTarget: run.kernelTarget, base: run.context, latest: run.context }))
  while (frontier.length > 0) {
    const tasks = []
    for (const item of frontier) {
      const decision = c2.phase2c2ProbeDecision({ kind: item.latest.kind, status: item.latest.status, extent: item.latest.extent, delivered: item.latest.summary.deliveredCandidates }, conditions.captureBound, grid)
      if (decision.status === 'skip') { probeLog.push({ baseContextId: item.base.contextId, afterExtentLabel: item.latest.extentLabel, decision, outcome: 'skipped' }); continue }
      tasks.push({ item, decision })
    }
    const nextFrontier = []
    await pool(tasks, async ({ item, decision }) => {
      const extentLabel = `probe:${decision.axis}=${decision.extent[axisField[decision.axis]]}`
      if (performance.now() - probeStarted > probeTotalBudgetMs) {
        probeLog.push({ baseContextId: item.base.contextId, afterExtentLabel: item.latest.extentLabel, decision, outcome: 'not_run_probe_total_budget' })
        return
      }
      const id = `portfolio-${item.orientation.orientationId}-${item.kernelTarget.targetWeaponId}-${extentLabel.replace(/[^a-z0-9=]/gi, '_')}`
      const run = await runChild(c2, id, 'portfolio', { orientation: item.orientation, conditions, kernelTarget: item.kernelTarget, extent: decision.extent, extentLabel }, probeBudgetMs)
      probeLog.push({ baseContextId: item.base.contextId, afterExtentLabel: item.latest.extentLabel, decision, outcome: run.entry.outcome, processId: id,
        wallMs: run.record?.wallMs ?? null, memory: run.record?.memory ?? null })
      if (run.record) {
        probeContexts.push(run.record.result)
        nextFrontier.push({ ...item, latest: run.record.result })
      }
    })
    frontier = nextFrontier
  }
  const probeWallMs = performance.now() - probeStarted

  const contexts = [...defaultContexts, ...probeContexts]
  const portfolio = c2.buildPhase2C2Portfolio(baseline, contexts)
  const record = {
    phase: 'Issue #154 Phase 2-C2: Candidate portfolio from the original Export Conflicts (Node Research run, raw)',
    measuredAt: new Date().toISOString(),
    environment: { runtime: 'Node (Vite SSR loader, one child process per task, NOT a Browser Worker)', node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
      cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), childHeapLimitMb: childHeapMb, concurrency,
      repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256: codeHash.digest('hex'),
      exportFileName: exportPath.split(/[\\/]/).at(-1), exportSha256, exportBytes: raw.length, rngEngineVersion: new ProductionRngEngine().version,
      researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext, nodeYield: 'setImmediate' },
    smokeOrientationLimit,
    budgets: { orientationBudgetMs, probeBudgetMs, probeTotalBudgetMs },
    conditions, probeGrid: grid,
    baseline: { ...baseline, process: baselineRun.entry, memory: baselineRun.record.memory },
    kernels,
    unsearchedKernelTargets,
    defaultContexts: defaultContextRuns.map(run => ({ orientationId: run.orientation.orientationId, targetWeaponId: run.kernelTarget.targetWeaponId, process: run.entry,
      wallMs: run.wallMs, memory: run.memory, context: run.context })),
    probes: { log: probeLog, contexts: probeContexts, wallMs: probeWallMs },
    contextCounts: { default: defaultContexts.length, probe: probeContexts.length },
    portfolio,
    processes,
    wallMs: performance.now() - phaseStarted,
  }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), orientations: kernels.length, kernelOutcomes: kernels.map(k => k.process.outcome),
    defaultContexts: defaultContexts.length, probeContexts: probeContexts.length,
    failures: processes.filter(p => p.outcome !== 'completed').map(p => `${p.id}:${p.outcome}`), wallMs: record.wallMs }, null, 2))
})
