// Issue #154 Phase 2-C2.6-A2 Research only: targeted runtime analysis of the Phase 2-C2.6-A timeout orientations.
//
// Parent (default role):
//   0. reads the committed Phase 2-C2.6-A RESULT (--c26a-result) as the selection / parity authority only, failing
//      closed unless it is the registered formal result; it is never a Search or Planner input;
//   1. `baseline` child: the ordinary Production Planner over the original Export, as in Phase 2-C2.6-A; its own Conflicts
//      give the orientations, which must equal the authority's (baseline summary, ordered IDs, identity, metadata);
//   2. every run condition must equal the authority's (Export SHA, heap, concurrency, budget, extent, bounds,
//      maxPlanSteps, yield, CalculationContext, lineage), or no kernel runs;
//   3. `kernel` children: only the current baseline's tasks of the authority's timeout orientations, once each (no retry),
//      each = the unchanged current Planner Alternative kernel with the observational lifecycle instrumentation.
// A kernel child writes each lifecycle record and each 5 s heartbeat synchronously to its own run-dir files and sends
// them over IPC, so a budget kill keeps the progress up to the kill. Nothing is sent per Search work item.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync, readFileSync } from 'node:fs'
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a2.mjs --export <external.json> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...>]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a2.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const readJsonLines = path => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line)) : []

async function loadModules(server) {
  return {
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    a2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    instrumentation: await server.ssrLoadModule('/src/benchmarks/plannerAlternativeBenchmarkInstrumentation.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child
  const taskPath = option('--task'), recordPath = option('--record')
  const eventsPath = option('--events'), heartbeatsPath = option('--heartbeats')
  if (!recordPath) throw new Error('A child needs --record.')
  const server = await createLoader()
  const { c26a, a2, research, runner, instrumentation, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  // Memory is sampled locally (Phase 2-C2.6-A's 250 ms interval); it leaves the child only inside a heartbeat.
  const memoryTimer = setInterval(() => tracker.sample(process.memoryUsage()), a2.PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS)
  let heartbeatTimer = null
  try {
    tracker.sample(process.memoryUsage())
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    let counting = null
    const createEngine = role === 'kernel'
      ? () => { counting = instrumentation.createCountingRngEngine(new ProductionRngEngine()); return counting.engine }
      : () => new ProductionRngEngine()
    const dependencies = { createEngine, yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) }
    const started = performance.now()
    let result
    if (role === 'baseline') result = await c26a.runPhase2C26ABaseline(input, dependencies)
    else if (role === 'kernel') {
      if (!eventsPath || !heartbeatsPath) throw new Error('A kernel child needs --events and --heartbeats.')
      const zero = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }
      const send = record => { appendFileSync(record.kind === 'heartbeat' ? heartbeatsPath : eventsPath, JSON.stringify(record) + '\n'); process.send?.(record) }
      const progress = a2.createPhase2C26A2KernelProgress({ now: () => performance.now(), predictionCounts: () => counting?.counts() ?? zero, emit: send })
      const memory = () => { const usage = process.memoryUsage(); const maxima = tracker.sample(usage); return { current: { heapUsed: usage.heapUsed, rss: usage.rss }, maxima } }
      progress.start()
      send({ kind: 'kernel_invoked', childProcessMs: performance.now() })
      heartbeatTimer = setInterval(() => send({ ...progress.heartbeat(), memory: memory(), yields, childProcessMs: performance.now() }), a2.PHASE2C26A2_HEARTBEAT_INTERVAL_MS)
      result = await a2.runPhase2C26A2Kernel(input, task, dependencies, progress.instrumentation)
      send({ ...progress.heartbeat(), memory: memory(), yields, childProcessMs: performance.now(), final: true })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    tracker.sample(process.memoryUsage())
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      predictionCounts: counting?.counts() ?? null,
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, result })
  } finally {
    clearInterval(memoryTimer)
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), authorityPath = option('--c26a-result')
if (!runDir || !outputPath || !authorityPath) throw new Error('The parent needs --c26a-result, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: an explicit subset of this baseline's orientations (never a formal measurement). The formal
// series is always the authority's timeout set; heap, budget, extent, bounds and concurrency stay the formal values.
const smokeOrientationIds = option('--smoke-orientations')?.split(',') ?? null
if (smokeOrientationIds !== null && !allowUncommitted) throw new Error('--smoke-orientations is a non-formal smoke option and needs --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawAuthority = await readFile(authorityPath)
await mkdir(runDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

const server = await createLoader()
const { c26a, a2, ProductionRngEngine } = await loadModules(server)
const parsedAuthority = a2.parsePhase2C26AAuthority(JSON.parse(rawAuthority.toString('utf8')))
if (!parsedAuthority.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedAuthority.issues.join('; ')}`)
const authority = parsedAuthority.authority
const childHeapMb = a2.PHASE2C26A2_CHILD_HEAP_MB
const concurrency = a2.PHASE2C26A2_CONCURRENCY
const budgetMs = a2.PHASE2C26A2_ORIENTATION_BUDGET_MS
const nodeFlags = [`--max-old-space-size=${childHeapMb}`]

/** One fresh child. Resolves with its record (or null), classified outcome and IPC view; never throws for a child failure. */
function runChild(id, childRole, task) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const eventsPath = join(runDir, `${id}.events.jsonl`)
    const heartbeatsPath = join(runDir, `${id}.heartbeats.jsonl`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath,
        ...(taskPath ? ['--task', taskPath] : []), ...(childRole === 'kernel' ? ['--events', eventsPath, '--heartbeats', heartbeatsPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null
      const ipc = { lifecycleMessages: 0, heartbeatMessages: 0, lastLifecycle: null, lastHeartbeat: null, lastHeartbeatReceivedAtMs: null,
        maxHeartbeatGapMs: null, kernelInvoked: null, kernelInvokedReceivedAtMs: null }
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, budgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        const receivedAtMs = performance.now() - began
        if (message?.kind === 'lifecycle') { ipc.lifecycleMessages += 1; ipc.lastLifecycle = { ...message, receivedAtMs } }
        else if (message?.kind === 'heartbeat') {
          if (ipc.lastHeartbeatReceivedAtMs !== null) ipc.maxHeartbeatGapMs = Math.max(ipc.maxHeartbeatGapMs ?? 0, receivedAtMs - ipc.lastHeartbeatReceivedAtMs)
          ipc.heartbeatMessages += 1; ipc.lastHeartbeat = message; ipc.lastHeartbeatReceivedAtMs = receivedAtMs
        } else if (message?.kind === 'kernel_invoked') { ipc.kernelInvoked = message; ipc.kernelInvokedReceivedAtMs = receivedAtMs }
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const endedAtMs = performance.now() - began
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const lastMemory = ipc.lastHeartbeat?.memory?.maxima ?? null
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: endedAtMs, killedAtMs, nodeFlags,
          ipc, lastHeartbeatAgeAtEndMs: ipc.lastHeartbeatReceivedAtMs === null ? null : endedAtMs - ipc.lastHeartbeatReceivedAtMs,
          lastIpcMemory: lastMemory, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s last=${ipc.lastLifecycle?.event?.type ?? '-'} target=${ipc.lastHeartbeat?.activeTarget?.targetOrdinal ?? '-'} heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        const record = outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        done({ entry, record, events: readJsonLines(eventsPath), heartbeats: readJsonLines(heartbeatsPath) })
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
  memorySampleIntervalMs: a2.PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS, heartbeatIntervalMs: a2.PHASE2C26A2_HEARTBEAT_INTERVAL_MS, nodeYield: a2.PHASE2C26A2_NODE_YIELD,
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
  c26aResultFileName: basename(authorityPath), c26aResultSha256: sha256(rawAuthority), c26aResultBytes: rawAuthority.length,
  smoke: smokeOrientationIds === null ? null : { orientationIds: smokeOrientationIds } }

try {
  const base = { phase: 'Issue #154 Phase 2-C2.6-A2: timeout orientation targeted runtime analysis (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    authority: { measuredHead: authority.measuredHead, timeoutOrientationIds: authority.timeoutOrientationIds } }
  const baselineRun = await runChild('baseline', 'baseline', null)
  if (!baselineRun.record) {
    await write(outputPath, { ...base, status: 'baseline_failed', baseline: { process: baselineRun.entry, record: null }, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The baseline child failed; no kernel was run.')
  }
  const baseline = baselineRun.record.result
  const allTasks = c26a.phase2c26aKernelTasks(baseline.orientations)
  const currentConditions = { exportSha256: environment.exportSha256, childHeapLimitMb: childHeapMb, concurrency, orientationBudgetMs: budgetMs, nodeYield: environment.nodeYield,
    extent: allTasks[0]?.conditions.extent ?? null, bounds: allTasks[0]?.conditions.bounds ?? null,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] } }
  const baselineParity = a2.validatePhase2C26A2BaselineParity(baseline.summary, baseline.orientations, authority)
  const conditionParity = a2.validatePhase2C26A2ConditionParity(currentConditions, authority)
  const selectedTasks = a2.selectPhase2C26A2Tasks(allTasks, authority)
  const tasks = smokeOrientationIds === null ? selectedTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  const selection = a2.validatePhase2C26A2Selection(tasks.map(task => task.orientation), authority)
  const baselineView = { process: baselineRun.entry, childWallMs: baselineRun.record.wallMs, memory: baselineRun.record.memory,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    summary: baseline.summary, orientations: baseline.orientations }
  console.log(`baseline: ${baseline.orientations.length} orientations; parity ${baselineParity.valid}, conditions ${conditionParity.valid}, selection ${selection.valid} (${tasks.length} tasks)`)
  const formalBlocked = !baselineParity.valid || !conditionParity.valid || (smokeOrientationIds === null && !selection.valid)
  if (formalBlocked) {
    await write(outputPath, { ...base, status: 'parity_failed', currentConditions, baselineParity, conditionParity, selection, baseline: baselineView, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no kernel was run: ${[...baselineParity.issues, ...conditionParity.issues, ...(selection.valid ? [] : ['selection'])].join('; ')}`)
  }
  const kernelRuns = await pool(tasks, task => runChild(c26a.phase2c26aKernelChildId(task.orientation.orientationId), 'kernel', task))
  const kernels = kernelRuns.map((run, index) => ({ orientationId: tasks[index].orientation.orientationId, task: tasks[index], process: run.entry,
    childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null, memory: run.record?.memory ?? null, predictionCounts: run.record?.predictionCounts ?? null,
    events: run.events, heartbeats: run.heartbeats, record: run.record?.result ?? null }))
  const record = { ...base, status: 'completed', currentConditions, baselineParity, conditionParity, selection, conditions: allTasks[0]?.conditions ?? null,
    baseline: baselineView, kernels, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = outcome => kernels.filter(k => k.process.outcome === outcome).length
  console.log(JSON.stringify({ output: resolve(outputPath), orientations: kernels.length, completed: count('completed'), out_of_memory: count('out_of_memory'),
    timeout: count('timeout'), process_failure: count('process_failure'), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
