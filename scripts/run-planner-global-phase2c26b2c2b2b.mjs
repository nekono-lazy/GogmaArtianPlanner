// Issue #154 Phase 2-C2.6-B2-C2B2B Research only: the P1 top-32 reservation contexts of the 7 E1 ∩ L1 Targets, actually
// searched at the common L1 extent (oracle-free context choice; the Search children never read an oracle or an earlier RESULT).
//
// Parent (default role):
//   0. reads the Export and the Target manifest (--targets, made by prepare-planner-global-phase2c26b2c2b2b-targets.mjs).
//      The manifest holds Target IDs only; the Export SHA-256 must be the one it names. It computes its launch observation:
//      repository HEAD, whether any benchmark code is uncommitted, the benchmark code SHA-256, the Export / manifest SHA-256;
//   1. START ATTESTATION: creates the run dir and writes start-attestation.json into it ONCE (`wx`, then read-only), BEFORE
//      any child process: the launch observation plus every registered condition (phase2c26b2c2b2bStartAttestationBody()). It reads the
//      file back and checks it, and for a formal launch verifies it (verifyPhase2C26B2C2B2BStartAttestation()). An interrupted
//      run keeps its launch provenance through this file alone;
//   2. `tasks` child: derivePhase2C26B2C1Schedule() over the Export (Production default extent, unchanged), then per Target the
//      P1 ranks 1..32 rebuilt into Search contexts and moved to the common L1 extent (buildPhase2C26B2C2B2BTasks());
//      7 x 32 = 224 tasks or no Search runs;
//   3. Stage 1: every task once in a fresh child, heap 8 GB, concurrency 1, 10-minute budget, no retry and no fallback - the
//      B2-C2B2A conditions with the extent alone changed. The child receives the task only (Target, P1 rank, expected default /
//      L1 digests, the common L1 extent, capture rule, safety cap), re-derives the schedule from the Export, checks the task
//      against its own P1 rank row, rebuilds the context, replaces its extent by L1 and captures up to four complete
//      operation-cost cohorts (sentinel / natural end / safety cap 1024). Every rank of every Target is searched.
// A child failure (timeout, out of memory, any other failure) is recorded as that failure, never as "no Candidate". Every
// child start and end is logged; each ended child is also appended to processes.jsonl in the run dir, so an interrupted run
// can be reconstructed (scripts/reconstruct-planner-global-phase2c26b2c2b2b-partial-raw.mjs) without the parent's memory.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2c2b2b.mjs --export <external.json> --targets <targets manifest .json.local> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-tasks N --smoke-task-ids a,b --smoke-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2c2b2b.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    c2b2b: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2B.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    hashing: await server.ssrLoadModule('/src/domain/models/hashing.ts'),
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
  const { c2b2b, b2c1, c26a, hashing, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, c2b2b.PHASE2C26B2C2B2B_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
    const scheduleMs = performance.now() - started
    let result
    if (role === 'tasks') {
      // Task construction only: no Search.
      const construction = c2b2b.buildPhase2C26B2C2B2BTasks(schedule, task.targetWeaponIds)
      result = { construction,
        scheduleSummary: { policies: schedule.policies, extent: schedule.extent, origins: schedule.origins, checks: schedule.checks, snapshotChecks: schedule.snapshot.checks,
          originDigest: schedule.snapshot.originDigest, targets: schedule.targets.length, contexts: schedule.contexts.length, contextsDigest: sha256(hashing.stableStringify(schedule.contexts)),
          targetContexts: task.targetWeaponIds.map(id => ({ targetWeaponId: id, contexts: schedule.targets.find(t => t.targetWeaponId === id)?.contexts ?? null })) } }
    } else if (role === 'search') {
      result = await c2b2b.runPhase2C26B2C2B2BTask(input, schedule, task, engine, { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, scheduleMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, false)
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), targetsPath = option('--targets')
if (!runDir || !outputPath || !targetsPath) throw new Error('The parent needs --targets, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: the first N tasks or the named tasks, and an optional shorter budget.
const smokeTasks = option('--smoke-tasks') === undefined ? null : Number(option('--smoke-tasks'))
const smokeTaskIds = option('--smoke-task-ids') === undefined ? null : option('--smoke-task-ids').split(',')
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smoke = smokeTasks !== null || smokeTaskIds !== null || smokeBudgetMs !== null
if (smoke && !allowUncommitted) throw new Error('--smoke-tasks / --smoke-task-ids / --smoke-budget-ms are non-formal smoke options and need --allow-uncommitted.')

// The launch observation, computed by the runner itself before anything runs.
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const repositoryHead = git('rev-parse', 'HEAD')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawTargets = await readFile(targetsPath)

const server = await createLoader()
try {
  const { c2b2b, c26a, ProductionRngEngine } = await loadModules(server)
  // 0. The Target manifest (Target IDs only) and the Export it names, before anything is written or run.
  const parsed = c2b2b.parsePhase2C26B2C2B2BTargetManifest(JSON.parse(rawTargets.toString('utf8')))
  if (!parsed.valid) throw new Error(`The Target manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export read is not the one the Target manifest names.')

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, c2b2b.PHASE2C26B2C2B2B_START_ATTESTATION_FILE)
  const smokeOptions = smoke ? { tasks: smokeTasks, taskIds: smokeTaskIds, budgetMs: smokeBudgetMs } : null
  const stage1Conditions = { ...c2b2b.PHASE2C26B2C2B2B_STAGE1, budgetMs: smokeBudgetMs ?? c2b2b.PHASE2C26B2C2B2B_STAGE1.budgetMs }
  const attestation = c2b2b.phase2c26b2c2b2bStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead,
    uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length,
    targetManifestFileName: basename(targetsPath), targetManifestSha256: sha256(rawTargets), targetManifestSourceResultSha256: manifest.sourceResultSha256,
    targetWeaponIds: [...manifest.targetWeaponIds], stage1: stage1Conditions, smoke: smokeOptions })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = c2b2b.verifyPhase2C26B2C2B2BStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, exportSha256: sha256(rawExport),
      targetManifestSha256: sha256(rawTargets), targetWeaponIds: manifest.targetWeaponIds, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: c2b2b.PHASE2C26B2C2B2B_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const processes = []
  const processesPath = join(runDir, 'processes.jsonl')
  const phaseStarted = performance.now()

  /** One fresh child. Resolves with its record (or null), its record file SHA-256, classified outcome and last IPC memory; never throws for a child failure. */
  const runChild = (id, childRole, task, { heapMb, budgetMs }) => new Promise(done => {
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
      console.log(`${startedAt} START ${id} pid=${child.pid}`)
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
        const endedAt = new Date().toISOString()
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, endedAt, wallMs: performance.now() - began, killedAtMs, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        const recordRaw = outcome === 'completed' ? await readFile(recordPath) : null
        const recordFile = recordRaw === null ? null : { file: basename(recordPath), bytes: recordRaw.length, sha256: sha256(recordRaw) }
        appendFileSync(processesPath, JSON.stringify({ ...entry, recordFile }) + '\n')
        const record = recordRaw === null ? null : JSON.parse(recordRaw.toString('utf8'))
        const s = record?.result?.status === 'searched' ? record.result.search : null
        const status = s ? ` ${s.termination} n=${s.candidates.length} costs=${s.capturedCosts.join('/')}${s.nextCostSentinel ? ` sentinel=${s.nextCostSentinel.deliveryIndex}@${s.nextCostSentinel.orderingKeys.estimatedOperationCount}` : ''}`
          : record?.result?.status ? ` ${record.result.status}` : ''
        console.log(`${endedAt} ${outcome.toUpperCase()} ${id}${status} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        done({ entry, record, recordFile })
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

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: stage1Conditions, tasksBudgetMs: c2b2b.PHASE2C26B2C2B2B_TASKS_BUDGET_MS, contextBudget: c2b2b.PHASE2C26B2C2B2B_CONTEXT_BUDGET, targets: c2b2b.PHASE2C26B2C2B2B_TARGETS,
    expectedTasks: c2b2b.PHASE2C26B2C2B2B_EXPECTED_TASKS, maxCostCohorts: c2b2b.PHASE2C26B2C2B2B_MAX_COST_COHORTS, candidateSafetyCap: c2b2b.PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP,
    capturePrefixes: c2b2b.PHASE2C26B2C2B2B_CAPTURE_PREFIXES, extentLabel: c2b2b.PHASE2C26B2C2B2B_EXTENT_LABEL, extent: { ...c2b2b.PHASE2C26B2C2B2B_EXTENT }, memorySampleIntervalMs: c2b2b.PHASE2C26B2C2B2B_MEMORY_SAMPLE_INTERVAL_MS,
    nodeYield: c2b2b.PHASE2C26B2C2B2B_NODE_YIELD, notRun: [...c2b2b.PHASE2C26B2C2B2B_NOT_RUN], registeredP1: c2b2b.PHASE2C26B2C2B2B_REGISTERED_P1,
    oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false,
    oracleInformedCommonExtent: true, commonExtentForEveryTask: true, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: ['L1'],
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    targetManifestFileName: basename(targetsPath), targetManifestSha256: sha256(rawTargets), targetManifestBytes: rawTargets.length, targetManifestSourceResultSha256: manifest.sourceResultSha256,
    smoke: smokeOptions }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2B: E1 ∩ L1 P1 top-32 reservation contexts searched at the common L1 extent (Node Research run, raw)',
    measuredAt: attestation.createdAt, environment, launchAttestation, targetWeaponIds: manifest.targetWeaponIds }

  // 2. Task construction (no Search). The child gets the Target IDs only.
  const tasksRun = await runChild('tasks', 'tasks', { targetWeaponIds: manifest.targetWeaponIds }, { heapMb: stage1Conditions.childHeapMb, budgetMs: c2b2b.PHASE2C26B2C2B2B_TASKS_BUDGET_MS })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  const construction = tasksRun.record.result.construction
  const tasksChild = { process: tasksRun.entry, recordFile: tasksRun.recordFile, childWallMs: tasksRun.record.wallMs, scheduleMs: tasksRun.record.scheduleMs, memory: tasksRun.record.memory,
    researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion,
    scheduleSummary: tasksRun.record.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  // Gate: exactly 7 x 32 tasks, every Target ranks 1..32, every task at the common L1 extent.
  const tasks = construction.tasks
  const gateIssues = [...construction.issues]
  if (tasks.length !== c2b2b.PHASE2C26B2C2B2B_EXPECTED_TASKS) gateIssues.push(`${tasks.length} tasks, not ${c2b2b.PHASE2C26B2C2B2B_EXPECTED_TASKS}`)
  for (const id of manifest.targetWeaponIds) {
    const ranks = tasks.filter(t => t.targetWeaponId === id).map(t => t.contextRank)
    if (JSON.stringify(ranks) !== JSON.stringify(Array.from({ length: c2b2b.PHASE2C26B2C2B2B_CONTEXT_BUDGET }, (_, i) => i + 1))) gateIssues.push(`${id}: ranks are not 1..${c2b2b.PHASE2C26B2C2B2B_CONTEXT_BUDGET}`)
  }
  const commonExtent = JSON.stringify({ ...c2b2b.PHASE2C26B2C2B2B_EXTENT })
  if (tasks.some(t => JSON.stringify(t.extent) !== commonExtent)) gateIssues.push('a task extent is not the common L1 extent')
  console.log(`tasks: ${tasks.length}; gate ${gateIssues.length === 0 ? 'ok' : gateIssues.join('; ')}`)
  if (gateIssues.length > 0) {
    await write(outputPath, { ...base, status: 'task_construction_failed', gateIssues, tasksChild, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Task construction failed; no Search was run: ${gateIssues.join('; ')}`)
  }
  const stage1Tasks = smokeTaskIds !== null ? tasks.filter(t => smokeTaskIds.includes(t.taskId)) : smokeTasks !== null ? tasks.slice(0, smokeTasks) : tasks
  console.log(`Stage 1 runs ${stage1Tasks.length} / ${tasks.length}`)

  // 3. Stage 1 (no retry, no fallback).
  const stage1 = await pool(stage1Tasks, stage1Conditions.concurrency, async task => {
    const run = await runChild(`stage1-${task.taskId}`, 'search', task, { heapMb: stage1Conditions.childHeapMb, budgetMs: stage1Conditions.budgetMs })
    const result = run.record?.result ?? null
    const outcome = c2b2b.phase2c26b2c2b2bTaskOutcome(task.taskId, run.entry.outcome, result)
    return { taskId: task.taskId, task, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail,
        startedAt: run.entry.startedAt, endedAt: run.entry.endedAt },
      recordFile: run.recordFile, childWallMs: run.record?.wallMs ?? null, scheduleMs: run.record?.scheduleMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null,
      memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null,
      researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null,
      contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs } : null }
  })

  const record = { ...base, status: 'completed', tasksChild, tasks, stage1, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = predicate => stage1.filter(predicate).length
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: tasks.length,
    stage1: { runs: stage1.length, searched: count(r => r.outcome.record === 'searched'), timeout: count(r => r.outcome.process === 'timeout'),
      out_of_memory: count(r => r.outcome.process === 'out_of_memory'), process_failure: count(r => r.outcome.process === 'process_failure'),
      context_mismatch: count(r => r.outcome.record === 'context_mismatch'), safety_cap: count(r => r.capture?.safetyCapHit === true) }, wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
