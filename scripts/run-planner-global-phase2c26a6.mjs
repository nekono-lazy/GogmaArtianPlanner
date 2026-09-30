// Issue #154 Phase 2-C2.6-A6 Research only: formal re-measurement after the allocation-free Bonus multiset equality.
//
// The Production change of this phase is `areRestorationBonusSetsEqual()` (src/domain/models/domainRules.ts) alone. This
// runner re-measures the Phase 2-C2.6-A5 primaries under exactly the Phase 2-C2.6-A4 conditions and instrumentation, so the
// A4 formal run is the "before" and this run the "after".
//
// Parent (default role):
//   0. reads the committed Phase 2-C2.6-A / A2 / A3 / A4 / A5 RESULTs (--c26a-result ... --c26a5-result), failing closed
//      unless each is the registered formal result made against exactly the earlier files read (SHA chain); A5 (Case
//      MULTISET) is the optimization and primary selection authority (its selection is A4's = A3's; no ID fixed). None is
//      ever a Search or Planner input;
//   1. fails closed unless the only Production calculation source changed since the A4 and A5 measured HEADs (Research /
//      test sources excluded, the working tree included) is the registered one, and records it;
//   2. `baseline` child: the ordinary Production Planner over the original Export, as in C2.6-A / A2 / A3 / A4 / A5; its
//      own Conflicts give the orientations, which must equal the C2.6-A authority's (baseline summary, ordered IDs,
//      identity, metadata) - the optimized equality must not change the ordinary Planner result either;
//   3. every run condition must equal A5's primary conditions (= A4's, concurrency 1 and the heap-only Node flags included);
//   4. `kernel` children: only the current baseline's tasks of the A5 primaries, once each (no retry), one at a time, each =
//      the unchanged current Planner Alternative kernel with A4's lifecycle instrumentation and, as the only Search
//      instrumentation, A4's Search section boundary observer (no CPU profiler, no A3 / A5 instrumentation).
// The child role is Phase 2-C2.6-A4's, unchanged (same records, same heartbeat, same durable appends + IPC).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, readFileSync, openSync, writeSync, closeSync } from 'node:fs'
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a6.mjs --export <external.json> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...> --smoke-budget-ms <ms>]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a6.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const readJsonLines = path => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line)) : []

async function loadModules(server) {
  return {
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    a2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts'),
    a3: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts'),
    a4: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts'),
    a5: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts'),
    a6: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6.ts'),
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
  const eventsPath = option('--events'), heartbeatsPath = option('--heartbeats'), runtimePath = option('--runtime')
  if (!recordPath) throw new Error('A child needs --record.')
  const server = await createLoader()
  const { c26a, a4, research, runner, instrumentation, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const memoryTimer = setInterval(() => tracker.sample(process.memoryUsage()), a4.PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS)
  let heartbeatTimer = null
  const fds = []
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
      if (!eventsPath || !heartbeatsPath || !runtimePath) throw new Error('A kernel child needs --events, --heartbeats and --runtime.')
      // One open descriptor per file; each record is one synchronous append, so a kill keeps everything written before it.
      const eventsFd = openSync(eventsPath, 'a'), heartbeatsFd = openSync(heartbeatsPath, 'a'), runtimeFd = openSync(runtimePath, 'a')
      fds.push(eventsFd, heartbeatsFd, runtimeFd)
      const durable = (fd, record) => { writeSync(fd, JSON.stringify(record) + '\n'); process.send?.(record) }
      const zero = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }
      const progress = a4.createPhase2C26A4KernelProgress({
        now: () => performance.now(), predictionCounts: () => counting?.counts() ?? zero,
        emitLifecycle: record => durable(eventsFd, record), emitSectionStarted: record => durable(runtimeFd, record),
        emitWorkSummary: record => durable(runtimeFd, record), emitSearchSummary: record => durable(runtimeFd, record),
      })
      const memory = () => { const usage = process.memoryUsage(); const maxima = tracker.sample(usage); return { current: { heapUsed: usage.heapUsed, rss: usage.rss }, maxima } }
      const origin = progress.start()
      durable(eventsFd, { kind: 'kernel_invoked', originChildProcessMs: origin, childProcessMs: performance.now() })
      heartbeatTimer = setInterval(() => durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, childProcessMs: performance.now() }), a4.PHASE2C26A4_HEARTBEAT_INTERVAL_MS)
      result = await a4.runPhase2C26A4Kernel(input, task, dependencies, progress.instrumentation)
      durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, childProcessMs: performance.now(), final: true })
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
    for (const fd of fds) closeSync(fd)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result')
const a4Path = option('--c26a4-result'), a5Path = option('--c26a5-result')
if (!runDir || !outputPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path) throw new Error('The parent needs --c26a-result, --c26a2-result, --c26a3-result, --c26a4-result, --c26a5-result, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: an explicit subset of this baseline's orientations and / or a shorter budget (never formal).
const smokeOrientationIds = option('--smoke-orientations')?.split(',') ?? null
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
if ((smokeOrientationIds !== null || smokeBudgetMs !== null) && !allowUncommitted) throw new Error('Smoke options are non-formal and need --allow-uncommitted.')
if (smokeBudgetMs !== null && !(Number.isInteger(smokeBudgetMs) && smokeBudgetMs > 0)) throw new Error('--smoke-budget-ms must be a positive integer.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawC26a = await readFile(c26aPath)
const rawA2 = await readFile(a2Path)
const rawA3 = await readFile(a3Path)
const rawA4 = await readFile(a4Path)
const rawA5 = await readFile(a5Path)
await mkdir(runDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

const server = await createLoader()
const { c26a, a2, a3, a4, a5, a6, ProductionRngEngine } = await loadModules(server)
const parsedC26a = a2.parsePhase2C26AAuthority(JSON.parse(rawC26a.toString('utf8')))
if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
const authority = parsedC26a.authority
const parsedA2 = a3.parsePhase2C26A2ResultAuthority(JSON.parse(rawA2.toString('utf8')), sha256(rawC26a), authority)
if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
const a2Authority = parsedA2.authority
const parsedA3 = a4.parsePhase2C26A3ResultAuthority(JSON.parse(rawA3.toString('utf8')), sha256(rawC26a), sha256(rawA2), a2Authority, authority)
if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
const a3Authority = parsedA3.authority
const parsedA4 = a5.parsePhase2C26A4ResultAuthority(JSON.parse(rawA4.toString('utf8')), { c26a: sha256(rawC26a), a2: sha256(rawA2), a3: sha256(rawA3) }, a3Authority, authority)
if (!parsedA4.valid) throw new Error(`The Phase 2-C2.6-A4 RESULT is not the registered authority: ${parsedA4.issues.join('; ')}`)
const a4Authority = parsedA4.authority
const parsedA5 = a6.parsePhase2C26A5ResultAuthority(JSON.parse(rawA5.toString('utf8')), { c26a: sha256(rawC26a), a2: sha256(rawA2), a3: sha256(rawA3), a4: sha256(rawA4) }, a4Authority, authority)
if (!parsedA5.valid) throw new Error(`The Phase 2-C2.6-A5 RESULT is not the registered authority: ${parsedA5.issues.join('; ')}`)
const a5Authority = parsedA5.authority
// The only Production calculation change since the A4 / A5 measured HEADs must be the registered one (working tree included).
const changedSrcSince = head => [...new Set([...git('diff', '--name-only', head, '--', 'src').split(/\r?\n/), ...git('ls-files', '--others', '--exclude-standard', '--', 'src').split(/\r?\n/)])]
  .filter(Boolean).sort()
const productionChange = { registered: a6.PHASE2C26A6_PRODUCTION_CHANGE, a4MeasuredHead: a4Authority.measuredHead, a5MeasuredHead: a5Authority.measuredHead,
  sinceA4MeasuredHead: changedSrcSince(a4Authority.measuredHead), sinceA5MeasuredHead: changedSrcSince(a5Authority.measuredHead) }
const productionChangeSinceA4 = a6.validatePhase2C26A6ProductionChange(productionChange.sinceA4MeasuredHead)
const productionChangeSinceA5 = a6.validatePhase2C26A6ProductionChange(productionChange.sinceA5MeasuredHead)
if (!productionChangeSinceA4.valid || !productionChangeSinceA5.valid) {
  throw new Error(`The Production change is not exactly the registered one: ${[...productionChangeSinceA4.issues, ...productionChangeSinceA5.issues].join('; ')}`)
}
const childHeapMb = a6.PHASE2C26A6_CHILD_HEAP_MB
const concurrency = a6.PHASE2C26A6_CONCURRENCY
const budgetMs = smokeBudgetMs ?? a6.PHASE2C26A6_ORIENTATION_BUDGET_MS
const nodeFlags = [...a6.PHASE2C26A6_NODE_FLAGS]

/** One fresh child. Resolves with its record (or null), classified outcome and IPC view; never throws for a child failure. */
function runChild(id, childRole, task, childBudgetMs) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const eventsPath = join(runDir, `${id}.events.jsonl`)
    const heartbeatsPath = join(runDir, `${id}.heartbeats.jsonl`)
    const runtimePath = join(runDir, `${id}.runtime.jsonl`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath,
        ...(taskPath ? ['--task', taskPath] : []), ...(childRole === 'kernel' ? ['--events', eventsPath, '--heartbeats', heartbeatsPath, '--runtime', runtimePath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null
      const ipc = { lifecycleMessages: 0, heartbeatMessages: 0, sectionStartMessages: 0, workSummaryMessages: 0, searchSummaryMessages: 0, lastLifecycle: null,
        lastHeartbeat: null, lastHeartbeatReceivedAtMs: null, maxHeartbeatGapMs: null, lastSectionStarted: null, lastWorkSummary: null, kernelInvoked: null,
        kernelInvokedReceivedAtMs: null,
        // min over messages of (parent receipt - child kernel-clock time): the child clock offset, delayed IPC only raises it.
        minClockOffsetMs: null }
      const offset = (receivedAtMs, elapsedMs) => {
        const origin = ipc.kernelInvoked?.originChildProcessMs
        if (typeof origin !== 'number' || typeof elapsedMs !== 'number') return
        const value = receivedAtMs - (origin + elapsedMs)
        ipc.minClockOffsetMs = ipc.minClockOffsetMs === null ? value : Math.min(ipc.minClockOffsetMs, value)
      }
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, childBudgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        const receivedAtMs = performance.now() - began
        switch (message?.kind) {
          case 'lifecycle': ipc.lifecycleMessages += 1; ipc.lastLifecycle = { ...message, receivedAtMs }; offset(receivedAtMs, message.elapsedMs); break
          case 'heartbeat':
            if (ipc.lastHeartbeatReceivedAtMs !== null) ipc.maxHeartbeatGapMs = Math.max(ipc.maxHeartbeatGapMs ?? 0, receivedAtMs - ipc.lastHeartbeatReceivedAtMs)
            ipc.heartbeatMessages += 1; ipc.lastHeartbeat = { ...message, searchRuntime: undefined, activeStack: message.searchRuntime?.activeStack ?? null }
            ipc.lastHeartbeatReceivedAtMs = receivedAtMs
            offset(receivedAtMs, message.elapsedMs)
            break
          case 'search_section_started': ipc.sectionStartMessages += 1; ipc.lastSectionStarted = { ...message, receivedAtMs }; offset(receivedAtMs, message.elapsedMs); break
          case 'search_work_summary': ipc.workSummaryMessages += 1; ipc.lastWorkSummary = { ...message, receivedAtMs }; offset(receivedAtMs, message.completedMs); break
          case 'search_summary': ipc.searchSummaryMessages += 1; offset(receivedAtMs, message.completedMs); break
          case 'kernel_invoked': ipc.kernelInvoked = message; ipc.kernelInvokedReceivedAtMs = receivedAtMs; break
          default: break
        }
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const endedAtMs = performance.now() - began
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const lastMemory = ipc.lastHeartbeat?.memory?.maxima ?? null
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs: childBudgetMs, startedAt, wallMs: endedAtMs, killedAtMs, nodeFlags,
          ipc, lastHeartbeatAgeAtEndMs: ipc.lastHeartbeatReceivedAtMs === null ? null : endedAtMs - ipc.lastHeartbeatReceivedAtMs,
          lastIpcMemory: lastMemory, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s last=${ipc.lastLifecycle?.event?.type ?? '-'} section=${(ipc.lastSectionStarted?.stack ?? []).join('>') || '-'} heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        const record = outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        done({ entry, record, events: readJsonLines(eventsPath), heartbeats: readJsonLines(heartbeatsPath), runtime: readJsonLines(runtimePath) })
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
  childHeapLimitMb: childHeapMb, nodeFlags, concurrency, orientationBudgetMs: budgetMs, baselineBudgetMs: a6.PHASE2C26A6_ORIENTATION_BUDGET_MS,
  memorySampleIntervalMs: a6.PHASE2C26A6_MEMORY_SAMPLE_INTERVAL_MS, heartbeatIntervalMs: a6.PHASE2C26A6_HEARTBEAT_INTERVAL_MS, nodeYield: a6.PHASE2C26A6_NODE_YIELD,
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
  c26aResultFileName: basename(c26aPath), c26aResultSha256: sha256(rawC26a), c26aResultBytes: rawC26a.length,
  c26a2ResultFileName: basename(a2Path), c26a2ResultSha256: sha256(rawA2), c26a2ResultBytes: rawA2.length,
  c26a3ResultFileName: basename(a3Path), c26a3ResultSha256: sha256(rawA3), c26a3ResultBytes: rawA3.length,
  c26a4ResultFileName: basename(a4Path), c26a4ResultSha256: sha256(rawA4), c26a4ResultBytes: rawA4.length,
  c26a5ResultFileName: basename(a5Path), c26a5ResultSha256: sha256(rawA5), c26a5ResultBytes: rawA5.length,
  productionChange,
  searchInstrumentation: { ...a6.PHASE2C26A6_SEARCH_INSTRUMENTATION },
  smoke: smokeOrientationIds === null && smokeBudgetMs === null ? null : { orientationIds: smokeOrientationIds, budgetMs: smokeBudgetMs } }

try {
  const base = { phase: 'Issue #154 Phase 2-C2.6-A6: formal re-measurement after the allocation-free Bonus multiset equality (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    authority: { c26aMeasuredHead: authority.measuredHead, a2MeasuredHead: a2Authority.measuredHead, a3MeasuredHead: a3Authority.measuredHead,
      a4MeasuredHead: a4Authority.measuredHead, a5MeasuredHead: a5Authority.measuredHead, a5DecisionCase: a5Authority.decisionCase,
      primaryOrientationIds: a5Authority.primaryOrientationIds } }
  const baselineRun = await runChild('baseline', 'baseline', null, a6.PHASE2C26A6_ORIENTATION_BUDGET_MS)
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
  const conditionParity = a6.validatePhase2C26A6ConditionParity({ ...currentConditions, nodeFlags }, a5Authority.conditions, a4Authority.conditions, a3Authority.conditions, authority, a2Authority.conditions)
  const selectedTasks = a6.selectPhase2C26A6Tasks(allTasks, a5Authority)
  const tasks = smokeOrientationIds === null ? selectedTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  const selection = a6.validatePhase2C26A6Selection(tasks.map(task => task.orientation), a5Authority, authority)
  const baselineView = { process: baselineRun.entry, childWallMs: baselineRun.record.wallMs, memory: baselineRun.record.memory,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    summary: baseline.summary, orientations: baseline.orientations }
  console.log(`baseline: ${baseline.orientations.length} orientations; parity ${baselineParity.valid}, conditions ${conditionParity.valid}, selection ${selection.valid} (${tasks.length} tasks: ${tasks.map(t => t.orientation.orientationId).join(', ')})`)
  // A smoke budget is not the registered one, so its condition parity fails by design; everything else still gates it.
  const conditionBlocking = smokeBudgetMs === null ? !conditionParity.valid : conditionParity.issues.some(issue => !/(^|\.)orientationBudgetMs differs$/.test(issue))
  const formalBlocked = !baselineParity.valid || conditionBlocking || (smokeOrientationIds === null && !selection.valid)
  if (formalBlocked) {
    await write(outputPath, { ...base, status: 'parity_failed', currentConditions, baselineParity, conditionParity, selection, baseline: baselineView, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no kernel was run: ${[...baselineParity.issues, ...conditionParity.issues, ...(selection.valid ? [] : ['selection'])].join('; ')}`)
  }
  const kernelRuns = await pool(tasks, task => runChild(c26a.phase2c26aKernelChildId(task.orientation.orientationId), 'kernel', task, budgetMs))
  const kernels = kernelRuns.map((run, index) => ({ orientationId: tasks[index].orientation.orientationId, task: tasks[index], process: run.entry,
    childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null, memory: run.record?.memory ?? null, predictionCounts: run.record?.predictionCounts ?? null,
    events: run.events, heartbeats: run.heartbeats, runtime: run.runtime, record: run.record?.result ?? null }))
  const record = { ...base, status: 'completed', currentConditions, baselineParity, conditionParity, selection, conditions: allTasks[0]?.conditions ?? null,
    baseline: baselineView, kernels, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = outcome => kernels.filter(k => k.process.outcome === outcome).length
  console.log(JSON.stringify({ output: resolve(outputPath), orientations: kernels.length, completed: count('completed'), out_of_memory: count('out_of_memory'),
    timeout: count('timeout'), process_failure: count('process_failure'), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
