// Issue #154 Phase 2-C2.6-A10 Research only: the formal whole-orientation-set kernel availability re-evaluation of the current
// Production (after A6 / A9) under the Phase 2-C2.6-A conditions.
//
// Parent (default role):
//   0. reads the committed Phase 2-C2.6-A RESULT (--c26a-result) as the parity / before authority, failing closed unless
//      it is the registered formal result (the unchanged parsePhase2C26AAuthority()); reads the committed Phase 2-C2.6-A9
//      RESULT (--a9-result) and the A2 .. A8 RESULT files it names (next to it) as the authority chain, failing closed
//      unless A9 is formal, Case O, and was made against exactly those files. Neither is a Search or Planner input;
//   1. `baseline` child: the ordinary Production Planner over the original Export; its own Conflicts give the
//      orientations, which must equal the C2.6-A authority's (summary, ordered IDs, identity, metadata);
//   2. every run condition must equal the C2.6-A authority's (Export SHA, heap, concurrency 3, budget, extent, bounds,
//      maxPlanSteps, yield, CalculationContext, lineage), and the task list must be exactly the authority's whole
//      orientation list, or no kernel runs;
//   3. `kernel` children: every orientation once (no retry), each = the unchanged C2.6-A kernel child (nothing in
//      PHASE2C26A10_NOT_ATTACHED is attached), memory sampled every 250 ms and the last sample sent over IPC.
// A child failure (timeout, out of memory, any other process failure) is recorded as that failure, never "no Candidate".
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
import { resolve, join, basename, dirname } from 'node:path'
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a10.mjs --export <external.json> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...>]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a10.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    a2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts'),
    a10: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A10.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (the C2.6-A child, unchanged in substance)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath) throw new Error('A child needs --record.')
  const server = await createLoader()
  const { c26a, a10, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, a10.PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    const dependencies = { createEngine: () => new ProductionRngEngine(), yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) }
    const started = performance.now()
    let result
    if (role === 'baseline') result = await a10.runPhase2C26A10Baseline(input, dependencies)
    else if (role === 'kernel') result = await a10.runPhase2C26A10Kernel(input, task, dependencies)
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
const c26aPath = option('--c26a-result'), a9Path = option('--a9-result')
if (!runDir || !outputPath || !c26aPath || !a9Path) throw new Error('The parent needs --c26a-result, --a9-result, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: an explicit subset of this baseline's orientations (never a formal measurement). Heap, budget,
// extent, bounds and concurrency stay the formal values.
const smokeOrientationIds = option('--smoke-orientations')?.split(',') ?? null
if (smokeOrientationIds !== null && !allowUncommitted) throw new Error('--smoke-orientations is a non-formal smoke option and needs --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawC26a = await readFile(c26aPath)
const rawA9 = await readFile(a9Path)

const server = await createLoader()
try {
  const { c26a, a2, a10, ProductionRngEngine } = await loadModules(server)
  // 0. The authorities, before anything is written or run.
  const parsedC26a = a2.parsePhase2C26AAuthority(JSON.parse(rawC26a.toString('utf8')))
  if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
  const authority = parsedC26a.authority
  const a9Json = JSON.parse(rawA9.toString('utf8'))
  const chainFiles = a10.phase2c26a10A9ChainFiles(a9Json)
  if (chainFiles === null) throw new Error('The Phase 2-C2.6-A9 RESULT does not name its chain files.')
  const chainSha = {}
  for (const [source, file] of Object.entries(chainFiles)) chainSha[source] = sha256(await readFile(join(dirname(a9Path), file)))
  const parsedA9 = a10.parsePhase2C26A9ResultAuthority(a9Json, { c26a: sha256(rawC26a), chain: chainSha }, authority)
  if (!parsedA9.valid) throw new Error(`The Phase 2-C2.6-A9 RESULT is not the registered authority chain: ${parsedA9.issues.join('; ')}`)
  const a9 = parsedA9.authority
  // Both measured HEADs must exist as commits here. They are PR-branch commits (squash merges), so they are recorded, not
  // required to be ancestors of HEAD.
  const commitExists = sha => { try { return execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim() === 'commit' } catch { return false } }
  if (!commitExists(authority.measuredHead)) throw new Error('The C2.6-A measured HEAD is not a commit of this repository.')
  if (!commitExists(a9.measuredHead)) throw new Error('The A9 measured HEAD is not a commit of this repository.')

  await mkdir(runDir, { recursive: true })
  const processes = []
  const phaseStarted = performance.now()
  const childHeapMb = a10.PHASE2C26A10_CHILD_HEAP_MB
  const concurrency = a10.PHASE2C26A10_CONCURRENCY
  const budgetMs = a10.PHASE2C26A10_ORIENTATION_BUDGET_MS
  const nodeFlags = [...a10.PHASE2C26A10_NODE_FLAGS]

  /** One fresh child. Resolves with its record (or null), classified outcome and last IPC memory; never throws for a child failure. */
  const runChild = (id, childRole, task) => new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, ...(taskPath ? ['--task', taskPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null, lastMemory = null, lastYields = 0, memoryMessages = 0
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, budgetMs)
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
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began, killedAtMs, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        const record = outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        done({ entry, record })
      })
    }
    start()
  })

  const pool = async (items, worker) => {
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
    memorySampleIntervalMs: a10.PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: a10.PHASE2C26A10_NODE_YIELD, retry: a10.PHASE2C26A10_RETRY, notAttached: [...a10.PHASE2C26A10_NOT_ATTACHED],
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    c26aResultFileName: basename(c26aPath), c26aResultSha256: sha256(rawC26a), c26aResultBytes: rawC26a.length, c26aMeasuredHead: authority.measuredHead,
    a9ResultFileName: basename(a9Path), a9ResultSha256: sha256(rawA9), a9ResultBytes: rawA9.length, a9MeasuredHead: a9.measuredHead, a9DecisionCase: a9.decisionCase,
    a9ChainResultSha256: chainSha,
    smoke: smokeOrientationIds === null ? null : { orientationIds: smokeOrientationIds } }
  const base = { phase: 'Issue #154 Phase 2-C2.6-A10: whole-orientation-set kernel availability re-evaluation (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    authority: { c26aMeasuredHead: authority.measuredHead, c26aTimeoutOrientationIds: authority.timeoutOrientationIds, a9MeasuredHead: a9.measuredHead, a9DecisionCase: a9.decisionCase, a9Primaries: a9.primaries } }

  const baselineRun = await runChild('baseline', 'baseline', null)
  if (!baselineRun.record) {
    await write(outputPath, { ...base, status: 'baseline_failed', baseline: { process: baselineRun.entry, record: null }, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The baseline child failed; no kernel was run.')
  }
  const baseline = baselineRun.record.result
  const allTasks = a10.phase2c26a10KernelTasks(baseline.orientations)
  const currentConditions = { exportSha256: environment.exportSha256, childHeapLimitMb: childHeapMb, concurrency, orientationBudgetMs: budgetMs, nodeYield: environment.nodeYield,
    extent: allTasks[0]?.conditions.extent ?? null, bounds: allTasks[0]?.conditions.bounds ?? null,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] } }
  const baselineParity = a2.validatePhase2C26A2BaselineParity(baseline.summary, baseline.orientations, authority)
  const conditionParity = a2.validatePhase2C26A2ConditionParity(currentConditions, authority)
  const taskSet = a10.validatePhase2C26A10TaskSet(allTasks, authority)
  const tasks = smokeOrientationIds === null ? allTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  console.log(`baseline: ${baseline.orientations.length} orientations; parity ${baselineParity.valid}, conditions ${conditionParity.valid}, task set ${taskSet.valid} (${tasks.length} tasks)`)
  if (!baselineParity.valid || !conditionParity.valid || !taskSet.valid) {
    await write(outputPath, { ...base, status: 'parity_failed', currentConditions, baselineParity, conditionParity, taskSet,
      baseline: { process: baselineRun.entry, record: baseline }, kernels: [], processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no kernel was run: ${[...baselineParity.issues, ...conditionParity.issues, ...(taskSet.valid ? [] : ['task set'])].join('; ')}`)
  }
  const kernelRuns = await pool(tasks, task => runChild(c26a.phase2c26aKernelChildId(task.orientation.orientationId), 'kernel', task))
  const kernels = kernelRuns.map((run, index) => ({ orientationId: tasks[index].orientation.orientationId, task: tasks[index], process: run.entry,
    childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null, memory: run.record?.memory ?? null, record: run.record?.result ?? null }))
  const record = { ...base, status: 'completed', currentConditions, baselineParity, conditionParity, taskSet, conditions: allTasks[0]?.conditions ?? null,
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
