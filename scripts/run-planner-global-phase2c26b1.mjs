// Issue #154 Phase 2-C2.6-B1 Research only: the default-extent Candidate portfolio of the current Production, built from
// every Conflict orientation's pre-Search context WITHOUT depending on kernel completion.
//
// Parent (default role):
//   0. reads the committed A10 RESULT (--a10-result) as the parity authority, failing closed unless it is the registered
//      formal result (parsePhase2C26B1A10Authority()), and the committed A9 RESULT (--a9-result) only to check that its
//      SHA-256 is the one A10 recorded (authority chain). Neither is a Search input. The oracle is never read here;
//   1. `contexts` child: the ordinary Production Planner over the original Export (its own Conflicts give the
//      orientations) and every orientation's pre-Search contexts through derivePhase2C25APreSearchContexts();
//   2. gates: the baseline / orientations, the Search conditions and the contexts of every A10 completed kernel must
//      match the A10 authority, or no Search runs;
//   3. Stage 1: every unique searchable context (deduplicated by searchInputDigest, every alias kept) in a fresh child,
//      heap 8 GB, concurrency 3, 10-minute budget, no retry: visitPlannerAlternativeCandidates() only, capture bound 8;
//   4. coverage fallback: only for Conflict participants with no completed Stage 1 context, one registered context each,
//      fresh child, heap 8 GB, concurrency 1, 30-minute budget, run once.
// A child failure (timeout, out of memory, any other failure) is recorded as that failure, never as "no Candidate".
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b1.mjs --export <external.json> --a10-result docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-tasks N --smoke-budget-ms N --smoke-fallback-limit N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b1.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    b1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B1.ts'),
    c2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2.ts'),
    c25a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25A.ts'),
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
  const { b1, c2, c25a, c26a, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, b1.PHASE2C26B1_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    const started = performance.now()
    let result, preparationMs = null
    if (role === 'contexts') {
      const baseline = await c2.runPhase2C2Baseline(input, { createEngine: () => new ProductionRngEngine() })
      const contexts = b1.derivePhase2C26B1Contexts(input, baseline.orientations, () => research.globalResearchDependencies(new ProductionRngEngine()))
      result = { baseline: { summary: baseline.summary, orientations: baseline.orientations, originals: baseline.originals }, contexts }
    } else if (role === 'search') {
      const engine = new ProductionRngEngine()
      const prepared = c25a.derivePhase2C25APreSearchContexts(input, task.orientation, research.globalResearchDependencies(engine))
      preparationMs = performance.now() - started
      result = await b1.runPhase2C26B1SearchTask(input, prepared, task, engine, { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, preparationMs, yields,
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
const a10Path = option('--a10-result'), a9Path = option('--a9-result')
if (!runDir || !outputPath || !a10Path || !a9Path) throw new Error('The parent needs --a10-result, --a9-result, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: the first N planned tasks, an optional shorter budget and a fallback limit (default 0).
const smokeTasks = option('--smoke-tasks') === undefined ? null : Number(option('--smoke-tasks'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smokeFallbackLimit = option('--smoke-fallback-limit') === undefined ? 0 : Number(option('--smoke-fallback-limit'))
const smoke = smokeTasks !== null || smokeBudgetMs !== null
if (smoke && !allowUncommitted) throw new Error('--smoke-tasks / --smoke-budget-ms are non-formal smoke options and need --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawA10 = await readFile(a10Path)
const rawA9 = await readFile(a9Path)

const server = await createLoader()
try {
  const { b1, c26a, ProductionRngEngine } = await loadModules(server)
  // 0. The authorities, before anything is written or run.
  const parsed = b1.parsePhase2C26B1A10Authority(JSON.parse(rawA10.toString('utf8')))
  if (!parsed.valid) throw new Error(`The A10 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const authority = parsed.authority
  if (sha256(rawA9) !== authority.a9ResultSha256) throw new Error('The A9 RESULT read is not the one the A10 RESULT recorded.')
  const commitExists = sha => { try { return execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim() === 'commit' } catch { return false } }
  if (!commitExists(authority.measuredHead)) throw new Error('The A10 measured HEAD is not a commit of this repository.')

  await mkdir(runDir, { recursive: true })
  const processes = []
  const phaseStarted = performance.now()
  const nodeFlagsFor = heapMb => [`--max-old-space-size=${heapMb}`]

  /** One fresh child. Resolves with its record (or null), classified outcome and last IPC memory; never throws for a child failure. */
  const runChild = (id, childRole, task, { heapMb, budgetMs, executionClass }) => new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const nodeFlags = nodeFlagsFor(heapMb)
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
        if (memoryMessages % 20 === 1) appendFileSync(memoryPath, JSON.stringify({ receivedAtMs: performance.now() - began, ...message }) + '\n')
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const entry = { id, role: childRole, executionClass, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began, killedAtMs, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        const record = outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        const status = record?.result?.status === 'searched' ? ` ${record.result.context.status} delivered=${record.result.context.summary.deliveredCandidates}` : record?.result?.status ? ` ${record.result.status}` : ''
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id}${status} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        done({ entry, record })
      })
    }
    start()
  })

  const pool = async (items, concurrency, worker) => {
    const results = new Array(items.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) { const index = next++; results[index] = await worker(items[index], index) }
    }))
    return results
  }

  const stage1Conditions = { ...b1.PHASE2C26B1_STAGE1, budgetMs: smokeBudgetMs ?? b1.PHASE2C26B1_STAGE1.budgetMs }
  const fallbackConditions = { ...b1.PHASE2C26B1_FALLBACK, budgetMs: smokeBudgetMs ?? b1.PHASE2C26B1_FALLBACK.budgetMs }
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: stage1Conditions, fallback: fallbackConditions, contextsBudgetMs: b1.PHASE2C26B1_CONTEXTS_BUDGET_MS, captureBound: b1.PHASE2C26B1_CAPTURE_BOUND,
    extentLabel: b1.PHASE2C26B1_EXTENT_LABEL, memorySampleIntervalMs: b1.PHASE2C26B1_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: b1.PHASE2C26B1_NODE_YIELD, notAttached: [...b1.PHASE2C26B1_NOT_ATTACHED],
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    a10ResultFileName: basename(a10Path), a10ResultSha256: sha256(rawA10), a10ResultBytes: rawA10.length, a10MeasuredHead: authority.measuredHead,
    a9ResultFileName: basename(a9Path), a9ResultSha256: sha256(rawA9), a9ResultBytes: rawA9.length,
    smoke: smoke ? { tasks: smokeTasks, budgetMs: smokeBudgetMs, fallbackLimit: smokeFallbackLimit } : null }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B1: default-extent Candidate portfolio from every orientation pre-Search context (Node Research run, raw)',
    measuredAt: new Date().toISOString(), environment }

  // 1. Baseline and every orientation's pre-Search contexts.
  const contextsRun = await runChild('contexts', 'contexts', null, { heapMb: b1.PHASE2C26B1_STAGE1.childHeapMb, budgetMs: b1.PHASE2C26B1_CONTEXTS_BUDGET_MS, executionClass: null })
  if (!contextsRun.record) {
    await write(outputPath, { ...base, status: 'contexts_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The contexts child failed; no Search was run.')
  }
  const { baseline, contexts } = contextsRun.record.result
  // 2. Gates.
  const baselineParity = b1.validatePhase2C26B1BaselineParity({ exportSha256: environment.exportSha256, summary: baseline.summary, orientations: baseline.orientations }, authority)
  const conditionParity = b1.validatePhase2C26B1ConditionParity({ extent: contexts[0]?.extent ?? null, calculationContext: contextsRun.record.calculationContext,
    researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps }, authority)
  const contextParity = b1.comparePhase2C26B1ContextsWithA10(contexts, authority)
  const extentsUniform = contexts.every(c => JSON.stringify(c.extent) === JSON.stringify(contexts[0].extent))
  console.log(`baseline: ${baseline.orientations.length} orientations, ${contexts.length} contexts; parity baseline ${baselineParity.valid}, conditions ${conditionParity.valid}, contexts ${contextParity.valid}, extents uniform ${extentsUniform}`)
  if (!baselineParity.valid || !conditionParity.valid || !contextParity.valid || !extentsUniform) {
    await write(outputPath, { ...base, status: 'parity_failed', baselineParity, conditionParity, contextParity, extentsUniform,
      contexts: { process: contextsRun.entry, record: contextsRun.record }, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no Search was run: ${[...baselineParity.issues, ...conditionParity.issues, ...contextParity.issues, ...(extentsUniform ? [] : ['extent'])].join('; ')}`)
  }
  const plan = b1.planPhase2C26B1SearchTasks(contexts)
  const stage1Tasks = smokeTasks === null ? plan.tasks : plan.tasks.slice(0, smokeTasks)
  console.log(`tasks: ${plan.tasks.length} unique of ${plan.searchable} searchable (${plan.blocked.length} blocked, ${plan.dedupSavedRuns} saved); Stage 1 runs ${stage1Tasks.length}`)

  const runTask = async (task, executionClass, conditions) => {
    const input = b1.phase2c26b1TaskInput(task, baseline.orientations, executionClass)
    const run = await runChild(`${executionClass}-${task.taskId}`, 'search', input, { heapMb: conditions.childHeapMb, budgetMs: conditions.budgetMs, executionClass })
    const outcome = b1.phase2c26b1TaskOutcome(task.taskId, executionClass, run.entry.outcome, run.record?.result ?? null)
    return { taskId: task.taskId, executionClass, outcome, process: run.entry, childWallMs: run.record?.wallMs ?? null, preparationMs: run.record?.preparationMs ?? null,
      yields: run.record?.yields ?? null, memory: run.record?.memory ?? null, record: run.record?.result ?? null }
  }
  // 3. Stage 1.
  const stage1 = await pool(stage1Tasks, stage1Conditions.concurrency, task => runTask(task, 'stage1', stage1Conditions))
  // 4. Coverage fallback (registered rule; participants are the baseline's own Conflict participants).
  const participants = [...new Set(baseline.orientations.flatMap(o => o.participantTargetWeaponIds))]
  const fallbackSelection = b1.selectPhase2C26B1Fallback(participants, baseline.orientations, contexts, plan.tasks, stage1.map(run => run.outcome))
  const fallbackRunSelections = smoke ? fallbackSelection.selections.slice(0, smokeFallbackLimit) : fallbackSelection.selections
  console.log(`fallback: ${fallbackSelection.selections.length} participants (${fallbackSelection.noSearchableContext.length} without a searchable context); runs ${fallbackRunSelections.length}`)
  const taskById = new Map(plan.tasks.map(task => [task.taskId, task]))
  const fallback = await pool(fallbackRunSelections, fallbackConditions.concurrency, selection => runTask(taskById.get(selection.taskId), 'coverage_fallback', fallbackConditions))

  const record = { ...base, status: 'completed', baselineParity, conditionParity, contextParity, extentsUniform,
    contexts: { process: contextsRun.entry, childWallMs: contextsRun.record.wallMs, memory: contextsRun.record.memory, researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps,
      calculationContext: contextsRun.record.calculationContext, baseline, contexts },
    plan, participants, stage1, fallbackSelection, fallback, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = (list, predicate) => list.filter(predicate).length
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: plan.tasks.length, stage1: { runs: stage1.length, completed: count(stage1, r => b1.phase2c26b1Completed(r.outcome)),
    timeout: count(stage1, r => r.outcome.process === 'timeout'), out_of_memory: count(stage1, r => r.outcome.process === 'out_of_memory'), process_failure: count(stage1, r => r.outcome.process === 'process_failure') },
    fallback: { runs: fallback.length, completed: count(fallback, r => b1.phase2c26b1Completed(r.outcome)) }, wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
