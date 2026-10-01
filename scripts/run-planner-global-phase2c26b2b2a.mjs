// Issue #154 Phase 2-C2.6-B2-B2A Research only: Search delivery of the known-compatible, default-extent representative
// contexts B2-B1 recorded (oracle-guided diagnostic selection; the Search children never read the oracle).
//
// Parent (default role):
//   0. reads the committed B2-B1 RESULT (--b2b1-result), failing closed unless it is the registered formal result, and
//      selects the registered 20 Targets (minimal cardinality 1 / 2 AND within the default extent: 2 historically covered
//      + 18 newly recovered, all K1). The selection is the only oracle-derived input, and it is recorded as such. The
//      Export SHA-256 must be the one B2-B1 recorded;
//   1. `tasks` child: derivePhase2C26B2B1Snapshot() over the Export and every selected representative context rebuilt from
//      it (Production reservation, Planner-start origin, excluded current Route key, default extent);
//   2. gate: each rebuilt context must equal the B2-B1 representative (fixed set, group, digest, range-form reservation,
//      current Entry / Route key, origin), or no Search runs;
//   3. Stage 1: every task in a fresh child, heap 8 GB, concurrency 3, 10-minute budget, no retry. The child receives only
//      the Target, the fixed-set selector and the expected Production digests, re-derives the context and runs
//      visitPlannerAlternativeCandidates() with capture bound 32 (no early stop of any other kind);
//   4. timeout fallback: only a Stage 1 timeout, the identical task once more, fresh child, heap 8 GB, concurrency 1,
//      30-minute budget. An out-of-memory / process failure is never retried.
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2b2a.mjs --export <external.json> --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-tasks N --smoke-budget-ms N --smoke-fallback-limit N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2b2a.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    b2b2a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A.ts'),
    b2b1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B1.ts'),
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
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { b2b2a, b2b1, c26a, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, b2b2a.PHASE2C26B2B2A_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const snapshot = b2b1.derivePhase2C26B2B1Snapshot(input, research.globalResearchDependencies(engine))
    const snapshotMs = performance.now() - started
    let result
    if (role === 'tasks') {
      // Reconstruction only: no Search.
      result = { snapshotSummary: { input: snapshot.input, originDigest: snapshot.originDigest, extent: snapshot.extent, checks: snapshot.checks,
        fixedSets: snapshot.fixedSets.length, reservationGroups: snapshot.reservationGroups.length },
        contexts: task.selectors.map(selector => ({ targetWeaponId: selector.targetWeaponId, result: b2b2a.reconstructPhase2C26B2B2AContext(snapshot, selector) })) }
    } else if (role === 'search') {
      result = await b2b2a.runPhase2C26B2B2ATask(input, snapshot, task, engine, { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, snapshotMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result })
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), b2b1Path = option('--b2b1-result')
if (!runDir || !outputPath || !b2b1Path) throw new Error('The parent needs --b2b1-result, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: the first N tasks, an optional shorter budget and a fallback limit (default 0).
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
const rawB2B1 = await readFile(b2b1Path)

const server = await createLoader()
try {
  const { b2b2a, c26a, ProductionRngEngine } = await loadModules(server)
  // 0. The authority and the registered selection, before anything is written or run.
  const parsed = b2b2a.parsePhase2C26B2B2AB2B1Authority(JSON.parse(rawB2B1.toString('utf8')), sha256(rawB2B1))
  if (!parsed.valid) throw new Error(`The B2-B1 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const authority = parsed.authority
  if (sha256(rawExport) !== authority.exportSha256) throw new Error('The Export read is not the one B2-B1 recorded.')
  const commitExists = sha => { try { return execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim() === 'commit' } catch { return false } }
  if (!commitExists(authority.measuredHead)) throw new Error('The B2-B1 measured HEAD is not a commit of this repository.')
  const selection = b2b2a.selectPhase2C26B2B2ATasks(authority)
  if (!selection.valid) throw new Error(`The registered task selection does not hold: ${selection.issues.join('; ')}`)

  await mkdir(runDir, { recursive: true })
  const processes = []
  const phaseStarted = performance.now()

  /** One fresh child. Resolves with its record (or null), classified outcome and last IPC memory; never throws for a child failure. */
  const runChild = (id, childRole, task, { heapMb, budgetMs, executionClass }) => new Promise(done => {
    const taskPath = join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const nodeFlags = [`--max-old-space-size=${heapMb}`]
    const start = async () => {
      await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--task', taskPath]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null, lastMemory = null, lastYields = 0, memoryMessages = 0
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      // The budget is judged here, in the parent, never by the child.
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
        const status = record?.result?.status === 'searched' ? ` ${record.result.search.status} delivered=${record.result.search.summary.deliveredCandidates}` : record?.result?.status ? ` ${record.result.status}` : ''
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

  const stage1Conditions = { ...b2b2a.PHASE2C26B2B2A_STAGE1, budgetMs: smokeBudgetMs ?? b2b2a.PHASE2C26B2B2A_STAGE1.budgetMs }
  const fallbackConditions = { ...b2b2a.PHASE2C26B2B2A_FALLBACK, budgetMs: smokeBudgetMs ?? b2b2a.PHASE2C26B2B2A_FALLBACK.budgetMs }
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: stage1Conditions, fallback: fallbackConditions, tasksBudgetMs: b2b2a.PHASE2C26B2B2A_TASKS_BUDGET_MS, captureBound: b2b2a.PHASE2C26B2B2A_CAPTURE_BOUND,
    extent: authority.extent, extentLabel: b2b2a.PHASE2C26B2B2A_EXTENT_LABEL, memorySampleIntervalMs: b2b2a.PHASE2C26B2B2A_MEMORY_SAMPLE_INTERVAL_MS,
    nodeYield: b2b2a.PHASE2C26B2B2A_NODE_YIELD, notRun: [...b2b2a.PHASE2C26B2B2A_NOT_RUN],
    oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    b2b1ResultFileName: basename(b2b1Path), b2b1ResultSha256: sha256(rawB2B1), b2b1ResultBytes: rawB2B1.length, b2b1MeasuredHead: authority.measuredHead,
    smoke: smoke ? { tasks: smokeTasks, budgetMs: smokeBudgetMs, fallbackLimit: smokeFallbackLimit } : null }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-B2A: Search delivery of known-compatible default-extent representative contexts (Node Research run, raw)',
    measuredAt: new Date().toISOString(), environment, selection: selection.selections }

  // 1. Representative reconstruction (no Search). The child gets the Production selectors only.
  const selectors = selection.selections.map(s => ({ targetWeaponId: s.targetWeaponId, fixedSetId: s.representative.fixedSetId, cardinality: s.representative.cardinality,
    reservationDigest: s.representative.reservationDigest }))
  const tasksRun = await runChild('tasks', 'tasks', { selectors }, { heapMb: stage1Conditions.childHeapMb, budgetMs: b2b2a.PHASE2C26B2B2A_TASKS_BUDGET_MS, executionClass: null })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  // 2. Gate: every rebuilt context equals its B2-B1 representative.
  const rebuilt = tasksRun.record.result.contexts
  const reconstruction = selection.selections.map(s => {
    const row = rebuilt.find(r => r.targetWeaponId === s.targetWeaponId)
    if (!row || !row.result.valid) return { targetWeaponId: s.targetWeaponId, matches: false, mismatches: row ? row.result.issues : ['missing'] }
    return b2b2a.comparePhase2C26B2B2AReconstruction(row.result.context, s, authority, sha256)
  })
  const conditions = b2b2a.comparePhase2C26B2B2AConditions({ extent: tasksRun.record.result.snapshotSummary.extent, originDigest: tasksRun.record.result.snapshotSummary.originDigest,
    calculationContext: tasksRun.record.calculationContext, researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, snapshotChecks: tasksRun.record.result.snapshotSummary.checks }, authority)
  const reconstructionValid = reconstruction.every(r => r.matches) && conditions.valid
  console.log(`reconstruction: ${reconstruction.filter(r => r.matches).length} / ${reconstruction.length} match; conditions ${conditions.valid ? 'match' : conditions.issues.join('; ')}`)
  if (!reconstructionValid) {
    await write(outputPath, { ...base, status: 'reconstruction_failed', reconstruction, conditions, tasksChild: { process: tasksRun.entry, record: tasksRun.record }, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Representative reconstruction failed; no Search was run: ${reconstruction.filter(r => !r.matches).map(r => `${r.targetWeaponId}(${r.mismatches.join('/')})`).join(', ')}`)
  }
  const contexts = selection.selections.map(s => rebuilt.find(r => r.targetWeaponId === s.targetWeaponId).result.context)
  const tasks = contexts.map((context, index) => b2b2a.phase2c26b2b2aTaskInput(`t${String(index).padStart(2, '0')}`, 'stage1', context))
  const stage1Tasks = smokeTasks === null ? tasks : tasks.slice(0, smokeTasks)
  console.log(`tasks: ${tasks.length}; Stage 1 runs ${stage1Tasks.length}`)

  const runTask = async (task, executionClass, conditions) => {
    const input = { ...task, executionClass }
    const run = await runChild(`${executionClass}-${task.taskId}`, 'search', input, { heapMb: conditions.childHeapMb, budgetMs: conditions.budgetMs, executionClass })
    const record = run.record?.result ?? null
    const outcome = b2b2a.phase2c26b2b2aTaskOutcome(task.taskId, executionClass, run.entry.outcome, record)
    return { taskId: task.taskId, executionClass, task: input, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail },
      childWallMs: run.record?.wallMs ?? null, snapshotMs: run.record?.snapshotMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null,
      memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null,
      researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null, record }
  }
  // 3. Stage 1.
  const stage1 = await pool(stage1Tasks, stage1Conditions.concurrency, task => runTask(task, 'stage1', stage1Conditions))
  // 4. Timeout fallback (registered rule: Stage 1 timeouts only, the identical task, once).
  const timedOut = stage1.filter(run => b2b2a.phase2c26b2b2aNeedsFallback(run.outcome)).map(run => tasks.find(task => task.taskId === run.taskId))
  const fallbackTasks = smoke ? timedOut.slice(0, smokeFallbackLimit) : timedOut
  console.log(`fallback: ${timedOut.length} Stage 1 timeouts; runs ${fallbackTasks.length}`)
  const fallback = await pool(fallbackTasks, fallbackConditions.concurrency, task => runTask(task, 'timeout_fallback', fallbackConditions))

  const record = { ...base, status: 'completed', reconstruction, conditions,
    tasksChild: { process: tasksRun.entry, childWallMs: tasksRun.record.wallMs, memory: tasksRun.record.memory, researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps,
      calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion, snapshotSummary: tasksRun.record.result.snapshotSummary },
    contexts, tasks, stage1, fallback, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = (list, predicate) => list.filter(predicate).length
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: tasks.length,
    stage1: { runs: stage1.length, searched: count(stage1, r => r.outcome.record === 'searched'), timeout: count(stage1, r => r.outcome.process === 'timeout'),
      out_of_memory: count(stage1, r => r.outcome.process === 'out_of_memory'), process_failure: count(stage1, r => r.outcome.process === 'process_failure'),
      context_mismatch: count(stage1, r => r.outcome.record === 'context_mismatch') },
    fallback: { runs: fallback.length, searched: count(fallback, r => r.outcome.record === 'searched') }, wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
