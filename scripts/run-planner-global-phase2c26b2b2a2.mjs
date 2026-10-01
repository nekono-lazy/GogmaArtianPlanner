// Issue #154 Phase 2-C2.6-B2-B2A2 Research only: boundary operation-cost cohort drain of the B2-B2A contexts whose
// capture of 32 stopped inside one cost cohort (oracle-guided diagnostic selection; the Search children never read the
// oracle).
//
// Parent (default role):
//   0. reads the committed B2-B2A RESULT (--b2b2a-result) and B2-B1 RESULT (--b2b1-result), failing closed unless both
//      are the registered formal results and the B2-B1 / Export SHA-256s are the ones B2-B2A recorded, and selects the
//      B2-B2A rows whose deliveryClass is capture_or_ordering_unresolved (expected 2). The selection and each row's
//      boundary cost (the cost of its 32nd delivery) are the only oracle-guided inputs, and they are recorded as such;
//   1. `tasks` child: derivePhase2C26B2B1Snapshot() over the Export and every selected context rebuilt from it;
//   2. gate: each rebuilt context must equal its B2-B1 representative AND its B2-B2A row (fixed set, group, digest,
//      range-form reservation, search-input digest, excluded current Route key, default extent), or no Search runs;
//   3. Stage 1: every task alone in a fresh child, heap 8 GB, concurrency 1, 30-minute budget, no retry. The child
//      receives only the Target, the fixed-set selector, the expected Production digests, the boundary cost and the
//      safety cap, re-derives the context and drains the boundary cohort (sentinel / natural end / safety cap 8192);
//   4. timeout fallback: only a Stage 1 timeout, the identical task once more, fresh child, heap 8 GB, 60-minute budget.
//      An out-of-memory / process failure is never retried.
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2b2a2.mjs --export <external.json> --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-tasks N --smoke-budget-ms N --smoke-fallback-limit N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2b2a2.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    b2b2a2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A2.ts'),
    b2b2a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A.ts'),
    b2b1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B1.ts'),
    b2aRanges: (await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')).phase2c26b2aReservationRanges,
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
  const { b2b2a2, b2b2a, b2b1, c26a, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, b2b2a2.PHASE2C26B2B2A2_MEMORY_SAMPLE_INTERVAL_MS)
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
      result = await b2b2a2.runPhase2C26B2B2A2Task(input, snapshot, task, engine, { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
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
const runDir = option('--run-dir'), outputPath = option('--output'), b2b2aPath = option('--b2b2a-result'), b2b1Path = option('--b2b1-result')
if (!runDir || !outputPath || !b2b2aPath || !b2b1Path) throw new Error('The parent needs --b2b2a-result, --b2b1-result, --run-dir and --output.')
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
const rawB2B2A = await readFile(b2b2aPath)
const rawB2B1 = await readFile(b2b1Path)

const server = await createLoader()
try {
  const { b2b2a2, b2b2a, b2aRanges, c26a, ProductionRngEngine } = await loadModules(server)
  // 0. The authorities and the registered selection, before anything is written or run.
  const parsed = b2b2a2.parsePhase2C26B2B2A2B2B2AAuthority(JSON.parse(rawB2B2A.toString('utf8')), sha256(rawB2B2A))
  if (!parsed.valid) throw new Error(`The B2-B2A RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const authority = parsed.authority
  const parsedB2B1 = b2b2a.parsePhase2C26B2B2AB2B1Authority(JSON.parse(rawB2B1.toString('utf8')), sha256(rawB2B1))
  if (!parsedB2B1.valid) throw new Error(`The B2-B1 RESULT is not the registered authority: ${parsedB2B1.issues.join('; ')}`)
  const b2b1Authority = parsedB2B1.authority
  if (sha256(rawB2B1) !== authority.b2b1ResultSha256) throw new Error('The B2-B1 RESULT read is not the one B2-B2A recorded.')
  if (sha256(rawExport) !== authority.exportSha256 || sha256(rawExport) !== b2b1Authority.exportSha256) throw new Error('The Export read is not the one B2-B2A / B2-B1 recorded.')
  const commitExists = sha => { try { return execFileSync('git', ['cat-file', '-t', sha], { encoding: 'utf8' }).trim() === 'commit' } catch { return false } }
  if (!commitExists(authority.measuredHead)) throw new Error('The B2-B2A measured HEAD is not a commit of this repository.')
  const selection = b2b2a2.selectPhase2C26B2B2A2Tasks(authority)
  if (!selection.valid) throw new Error(`The registered task selection does not hold: ${selection.issues.join('; ')}`)
  const b2b1Selection = b2b2a.selectPhase2C26B2B2ATasks(b2b1Authority)
  if (!b2b1Selection.valid) throw new Error(`The B2-B1 selection does not hold: ${b2b1Selection.issues.join('; ')}`)

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
        const s = record?.result?.status === 'searched' ? record.result.search : null
        const status = s ? ` ${s.termination} cohort=${s.cohort.length} sentinel=${s.nextCostSentinel ? `${s.nextCostSentinel.deliveryIndex}@${s.nextCostSentinel.orderingKeys.estimatedOperationCount}` : 'none'}`
          : record?.result?.status ? ` ${record.result.status}` : ''
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

  const stage1Conditions = { ...b2b2a2.PHASE2C26B2B2A2_STAGE1, budgetMs: smokeBudgetMs ?? b2b2a2.PHASE2C26B2B2A2_STAGE1.budgetMs }
  const fallbackConditions = { ...b2b2a2.PHASE2C26B2B2A2_FALLBACK, budgetMs: smokeBudgetMs ?? b2b2a2.PHASE2C26B2B2A2_FALLBACK.budgetMs }
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: stage1Conditions, fallback: fallbackConditions, tasksBudgetMs: b2b2a2.PHASE2C26B2B2A2_TASKS_BUDGET_MS, cohortSafetyCap: b2b2a2.PHASE2C26B2B2A2_COHORT_SAFETY_CAP,
    priorPrefixLength: b2b2a2.PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH, extent: authority.extent, extentLabel: b2b2a2.PHASE2C26B2B2A2_EXTENT_LABEL,
    memorySampleIntervalMs: b2b2a2.PHASE2C26B2B2A2_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: b2b2a2.PHASE2C26B2B2A2_NODE_YIELD, notRun: [...b2b2a2.PHASE2C26B2B2A2_NOT_RUN],
    oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    b2b2aResultFileName: basename(b2b2aPath), b2b2aResultSha256: sha256(rawB2B2A), b2b2aResultBytes: rawB2B2A.length, b2b2aMeasuredHead: authority.measuredHead,
    b2b1ResultFileName: basename(b2b1Path), b2b1ResultSha256: sha256(rawB2B1), b2b1ResultBytes: rawB2B1.length,
    smoke: smoke ? { tasks: smokeTasks, budgetMs: smokeBudgetMs, fallbackLimit: smokeFallbackLimit } : null }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-B2A2: boundary operation-cost cohort drain (Node Research run, raw)',
    measuredAt: new Date().toISOString(), environment, selection: selection.selections }

  // 1. Context reconstruction (no Search). The child gets the Production selectors only.
  const selectors = selection.selections.map(s => ({ targetWeaponId: s.targetWeaponId, fixedSetId: s.fixedSetId, cardinality: s.cardinality, reservationDigest: s.reservationDigest }))
  const tasksRun = await runChild('tasks', 'tasks', { selectors }, { heapMb: stage1Conditions.childHeapMb, budgetMs: b2b2a2.PHASE2C26B2B2A2_TASKS_BUDGET_MS, executionClass: null })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  // 2. Gate: every rebuilt context equals its B2-B1 representative and its B2-B2A row.
  const rebuilt = tasksRun.record.result.contexts
  const ranges = context => b2aRanges(context.reservation)
  const reconstruction = selection.selections.map(s => {
    const row = rebuilt.find(r => r.targetWeaponId === s.targetWeaponId)
    const b2b1Row = b2b1Selection.selections.find(x => x.targetWeaponId === s.targetWeaponId)
    const b2b2aRow = authority.rows.find(x => x.targetWeaponId === s.targetWeaponId)
    if (!row || !row.result.valid || !b2b1Row || !b2b2aRow) return { targetWeaponId: s.targetWeaponId, matches: false, b2b1: null, b2b2a: null, mismatches: row?.result.issues ?? ['missing'] }
    const b2b1 = b2b2a.comparePhase2C26B2B2AReconstruction(row.result.context, b2b1Row, b2b1Authority, sha256)
    const b2b2aParity = b2b2a2.comparePhase2C26B2B2A2RowReconstruction(row.result.context, b2b2aRow, sha256, ranges)
    return { targetWeaponId: s.targetWeaponId, matches: b2b1.matches && b2b2aParity.matches, b2b1, b2b2a: b2b2aParity, mismatches: [...b2b1.mismatches, ...b2b2aParity.mismatches.map(m => `b2b2a:${m}`)] }
  })
  const conditions = b2b2a.comparePhase2C26B2B2AConditions({ extent: tasksRun.record.result.snapshotSummary.extent, originDigest: tasksRun.record.result.snapshotSummary.originDigest,
    calculationContext: tasksRun.record.calculationContext, researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, snapshotChecks: tasksRun.record.result.snapshotSummary.checks }, b2b1Authority)
  const contextConditionsMatchB2B2A = JSON.stringify(tasksRun.record.calculationContext) === JSON.stringify(authority.calculationContext) && tasksRun.record.researchMaxPlanSteps === authority.researchMaxPlanSteps
  const reconstructionValid = reconstruction.every(r => r.matches) && conditions.valid && contextConditionsMatchB2B2A
  console.log(`reconstruction: ${reconstruction.filter(r => r.matches).length} / ${reconstruction.length} match; conditions ${conditions.valid && contextConditionsMatchB2B2A ? 'match' : [...conditions.issues, ...(contextConditionsMatchB2B2A ? [] : ['b2b2a_calculation_context'])].join('; ')}`)
  if (!reconstructionValid) {
    await write(outputPath, { ...base, status: 'reconstruction_failed', reconstruction, conditions, contextConditionsMatchB2B2A, tasksChild: { process: tasksRun.entry, record: tasksRun.record }, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Context reconstruction failed; no Search was run: ${reconstruction.filter(r => !r.matches).map(r => `${r.targetWeaponId}(${r.mismatches.join('/')})`).join(', ')}`)
  }
  const contexts = selection.selections.map(s => rebuilt.find(r => r.targetWeaponId === s.targetWeaponId).result.context)
  const tasks = contexts.map((context, index) => b2b2a2.phase2c26b2b2a2TaskInput(`t${String(index).padStart(2, '0')}`, 'stage1', context, selection.selections[index].boundaryCost))
  const stage1Tasks = smokeTasks === null ? tasks : tasks.slice(0, smokeTasks)
  console.log(`tasks: ${tasks.length} (boundary costs ${tasks.map(t => t.boundaryCost).join(', ')}); Stage 1 runs ${stage1Tasks.length}`)

  const runTask = async (task, executionClass, conditions) => {
    const input = { ...task, executionClass }
    const run = await runChild(`${executionClass}-${task.taskId}`, 'search', input, { heapMb: conditions.childHeapMb, budgetMs: conditions.budgetMs, executionClass })
    const record = run.record?.result ?? null
    const outcome = b2b2a2.phase2c26b2b2a2TaskOutcome(task.taskId, executionClass, run.entry.outcome, record)
    return { taskId: task.taskId, executionClass, task: input, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail },
      childWallMs: run.record?.wallMs ?? null, snapshotMs: run.record?.snapshotMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null,
      memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null,
      researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null, record }
  }
  // 3. Stage 1.
  const stage1 = await pool(stage1Tasks, stage1Conditions.concurrency, task => runTask(task, 'stage1', stage1Conditions))
  // 4. Timeout fallback (registered rule: Stage 1 timeouts only, the identical task, once).
  const timedOut = stage1.filter(run => b2b2a2.phase2c26b2b2a2NeedsFallback(run.outcome)).map(run => tasks.find(task => task.taskId === run.taskId))
  const fallbackTasks = smoke ? timedOut.slice(0, smokeFallbackLimit) : timedOut
  console.log(`fallback: ${timedOut.length} Stage 1 timeouts; runs ${fallbackTasks.length}`)
  const fallback = await pool(fallbackTasks, fallbackConditions.concurrency, task => runTask(task, 'timeout_fallback', fallbackConditions))

  const record = { ...base, status: 'completed', reconstruction, conditions, contextConditionsMatchB2B2A,
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
