// Issue #154 Phase 2-C2.6-A Research only: the post-H1 Global Planner kernel re-evaluation (kernel only).
//
// Parent (default role): spawns fresh Node child processes, each reloading the original Export,
//   1. `baseline` : the ordinary Production Planner over the original Build List; its own Conflicts -> orientations;
//   2. `kernel`   : one child per orientation of THIS baseline = the current Planner Alternative kernel, unchanged
//                   (Production default extent / trial bounds as spread copies, no lineage).
// No post-hoc portfolio Search, no probe, no oracle, no global assignment. The only runtime data input is the Export; no
// earlier Phase result (Phase 2-C2 RESULT included) is read, embedded or passed: the old C2 comparison is post-hoc only
// (scripts/analyze-planner-global-phase2c26a.mjs). A child failure (timeout, out of memory, any other process failure) is
// recorded as that failure and never as "no Candidate". Memory values are sampled maxima (250 ms), never a true peak.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a.mjs --export <external.json> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...>]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath) throw new Error('A child needs --record.')
  const server = await createLoader()
  const { c26a, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, c26a.PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    const dependencies = { createEngine: () => new ProductionRngEngine(), yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) }
    const started = performance.now()
    let result
    if (role === 'baseline') result = await c26a.runPhase2C26ABaseline(input, dependencies)
    else if (role === 'kernel') result = await c26a.runPhase2C26AKernel(input, task, dependencies)
    else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, result })
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output')
if (!runDir || !outputPath) throw new Error('The parent needs --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: a subset of this baseline's orientations (never with a formal measurement). It changes nothing
// else: heap, budget, extent, bounds and concurrency stay the formal values.
const smokeOrientationIds = option('--smoke-orientations')?.split(',') ?? null
if (smokeOrientationIds !== null && !allowUncommitted) throw new Error('--smoke-orientations is a non-formal smoke option and needs --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
await mkdir(runDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

const server = await createLoader()
const { c26a, ProductionRngEngine } = await loadModules(server)
const childHeapMb = c26a.PHASE2C26A_CHILD_HEAP_MB
const concurrency = c26a.PHASE2C26A_CONCURRENCY
const budgetMs = c26a.PHASE2C26A_ORIENTATION_BUDGET_MS
const nodeFlags = [`--max-old-space-size=${childHeapMb}`]

/** One fresh child. Resolves with its record (or null), classified outcome and last IPC memory; never throws for a child failure. */
function runChild(id, childRole, task) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, ...(taskPath ? ['--task', taskPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, lastMemory = null, lastYields = 0, memoryMessages = 0
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, budgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        if (message?.type !== 'memory') return
        memoryMessages += 1
        lastMemory = message.maxima
        lastYields = message.yields
        // Every 20th sample (~5 s) is kept on disk as a coarse trace; the running maxima are the authority.
        if (memoryMessages % 20 === 1) appendFileSync(memoryPath, JSON.stringify({ receivedAtMs: performance.now() - began, ...message }) + '\n')
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
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

const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
  platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  childHeapLimitMb: childHeapMb, nodeFlags, concurrency, orientationBudgetMs: budgetMs, baselineBudgetMs: budgetMs,
  memorySampleIntervalMs: c26a.PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: c26a.PHASE2C26A_NODE_YIELD,
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
  smoke: smokeOrientationIds === null ? null : { orientationIds: smokeOrientationIds } }

try {
  const baselineRun = await runChild('baseline', 'baseline', null)
  const base = { phase: 'Issue #154 Phase 2-C2.6-A: post-H1 Global Planner kernel re-evaluation (Node Research run, raw)', measuredAt: new Date().toISOString(), environment }
  if (!baselineRun.record) {
    await write(outputPath, { ...base, status: 'baseline_failed', baseline: { process: baselineRun.entry, record: null }, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The baseline child failed; no kernel was run.')
  }
  const baseline = baselineRun.record.result
  console.log(`baseline: ${baseline.summary.completedTargetCount}/${baseline.summary.planningTargetCount} completed, ${baseline.summary.conflicts} conflicts, ${baseline.summary.planSteps} steps, ${baseline.orientations.length} orientations`)
  const allTasks = c26a.phase2c26aKernelTasks(baseline.orientations)
  const tasks = smokeOrientationIds === null ? allTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  const kernelRuns = await pool(tasks, task => runChild(c26a.phase2c26aKernelChildId(task.orientation.orientationId), 'kernel', task))
  const kernels = kernelRuns.map((run, index) => ({ orientationId: tasks[index].orientation.orientationId, task: tasks[index], process: run.entry,
    childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null, memory: run.record?.memory ?? null, record: run.record?.result ?? null }))
  const record = { ...base, status: 'completed', conditions: allTasks[0]?.conditions ?? null,
    baseline: { process: baselineRun.entry, childWallMs: baselineRun.record.wallMs, memory: baselineRun.record.memory,
      researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext, record: baseline },
    kernels, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = outcome => kernels.filter(k => k.process.outcome === outcome).length
  console.log(JSON.stringify({ output: resolve(outputPath), orientations: kernels.length, completed: count('completed'), out_of_memory: count('out_of_memory'),
    timeout: count('timeout'), process_failure: count('process_failure'), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
