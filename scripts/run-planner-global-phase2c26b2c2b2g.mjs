// Issue #154 Phase 2-C2.6-B2-C2B2G Research only (profiling only): the one Target B2-C2B2F profiled as BONUS dominant, searched
// again in B2-C2B2F's exact Search input with B2-C2B2F's 30-minute profiling budget and A7's pair of existing boundary observers
// (PlannerAlternativeSearchInstrumentation.onSearchRuntime + onGogmaReservedRuntime) as the only instrumentation. The probe and its
// expected Search input identity come from the probe manifest; the Search child never reads an oracle, an earlier RESULT, a
// B2-C2B2E / B2-C2B2F / A7 measurement, an expected bottleneck or section, or an expected outcome.
//
// Parent (default role):
//   0. reads the Export and the probe manifest (--probes, made by prepare-planner-global-phase2c26b2c2b2g-probes.mjs) and computes
//      its launch observation (HEAD, uncommitted benchmark code, benchmark code SHA-256, Export / manifest SHA-256);
//   1. START ATTESTATION: writes start-attestation.json into the new run dir ONCE (`wx`, then read-only) BEFORE any child process,
//      reads it back and, for a formal launch, verifies it (verifyPhase2C26B2C2B2GStartAttestation());
//   2. `tasks` child: derivePhase2C26B2C1Schedule() over the Export, then buildPhase2C26B2C2B2GTasks() (B2-C2B2F's construction over
//      the probe, every Search input identity field compared with the expected identity); 1 task or no Search;
//   3. Stage 1: the task once in a fresh child, heap 12,288 MB, concurrency 1, 30-minute budget, no retry and no fallback (a timeout
//      is the normal profiling outcome; never an automatic longer rerun). The child re-derives the schedule, writes the Search input
//      identity it rebuilt (excluded Route key hashed) and runs runPhase2C26B2C2B2GTask() with the profiler: every 5 s, at each window
//      boundary of the Search elapsed and once at a natural completion it appends one cumulative profile snapshot (outer A4 runtime +
//      inner A3 runtime on one frozen clock, depth facts, yield waits, the inner depth records completed since the previous snapshot)
//      synchronously to <id>.profile.jsonl, so a budget kill keeps the profile up to the last snapshot. Nothing is written per boundary.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2c2b2g.mjs --export <external.json> --probes <probe manifest .json.local> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2c2b2g.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function loadModules(server) {
  return {
    g: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2G.ts'),
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
  const taskPath = option('--task'), recordPath = option('--record'), profilePath = option('--profile')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { g, b2c1, c26a, hashing, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, g.PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS)
  const timers = []
  let profileFd = null
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
    const scheduleMs = performance.now() - started
    let result, profile = null
    if (role === 'tasks') {
      // Task construction only: no Search.
      const construction = g.buildPhase2C26B2C2B2GTasks(schedule, task)
      result = { construction,
        scheduleSummary: { policies: schedule.policies, extent: schedule.extent, origins: schedule.origins, checks: schedule.checks, snapshotChecks: schedule.snapshot.checks,
          originDigest: schedule.snapshot.originDigest, targets: schedule.targets.length, contexts: schedule.contexts.length, contextsDigest: sha256(hashing.stableStringify(schedule.contexts)) } }
    } else if (role === 'search') {
      if (!profilePath) throw new Error('A search child needs --profile.')
      // One open descriptor; each snapshot is one synchronous append, so a budget kill keeps everything written before it.
      profileFd = openSync(profilePath, 'a')
      const durable = record => writeSync(profileFd, JSON.stringify(record) + '\n')
      durable({ kind: 'search_identity', childProcessMs: performance.now(), scheduleMs, identity: g.phase2c26b2c2b2gChildSearchIdentity(schedule, task, sha256) })
      const profiler = g.createPhase2C26B2C2B2GProfiler({ now: () => performance.now() })
      const origin = profiler.start()
      durable({ kind: 'profiler_started', originChildProcessMs: origin, childProcessMs: performance.now() })
      const memoryNow = () => { const usage = process.memoryUsage(); return { heapUsed: usage.heapUsed, rss: usage.rss, maxima: tracker.sample(usage) } }
      const snapshot = (reason, windowBoundaryMs = null) => durable({ ...profiler.snapshot(reason, windowBoundaryMs), memory: memoryNow(), yieldsTotal: yields, childProcessMs: performance.now() })
      let boundariesScheduled = false
      const heartbeat = () => {
        snapshot('heartbeat')
        const searchStartedAt = profiler.searchStartedAtMs()
        if (!boundariesScheduled && searchStartedAt !== null) {
          boundariesScheduled = true
          // Window boundaries of the Search elapsed (Research clock): one durable snapshot at each.
          for (const [, toMs] of g.PHASE2C26B2C2B2G_WINDOWS_MS) {
            const due = origin + searchStartedAt + toMs - performance.now()
            timers.push(setTimeout(() => snapshot('window_boundary', toMs), Math.max(0, due)))
          }
        }
      }
      timers.push(setInterval(heartbeat, g.PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS))
      const yieldControl = profiler.wrapYield(() => new Promise(done => { yields += 1; setImmediate(done) }))
      result = await g.runPhase2C26B2C2B2GTask(input, schedule, task, engine, { yieldControl, instrumentation: profiler.instrumentation })
      snapshot('final')
      profile = { file: basename(profilePath) }
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, scheduleMs, yields, profile,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, false)
  } finally {
    clearInterval(timer)
    for (const t of timers) clearTimeout(t)
    if (profileFd !== null) closeSync(profileFd)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), probesPath = option('--probes')
if (!runDir || !outputPath || !probesPath) throw new Error('The parent needs --probes, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: an optional shorter budget.
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smoke = smokeBudgetMs !== null
if (smoke && !allowUncommitted) throw new Error('--smoke-budget-ms is a non-formal smoke option and needs --allow-uncommitted.')
if (smoke && !(Number.isInteger(smokeBudgetMs) && smokeBudgetMs > 0)) throw new Error('--smoke-budget-ms must be a positive integer.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const repositoryHead = git('rev-parse', 'HEAD')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawProbes = await readFile(probesPath)

const server = await createLoader()
try {
  const { g, c26a, ProductionRngEngine } = await loadModules(server)
  // 0. The probe manifest (the probe and its expected Search input identity only) and the Export it names.
  const parsed = g.parsePhase2C26B2C2B2GProbeManifest(JSON.parse(rawProbes.toString('utf8')))
  if (!parsed.valid) throw new Error(`The probe manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export read is not the one the probe manifest names.')
  const targetWeaponIds = manifest.probes.map(p => p.targetWeaponId)

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, g.PHASE2C26B2C2B2G_START_ATTESTATION_FILE)
  const smokeOptions = smoke ? { budgetMs: smokeBudgetMs } : null
  const stage1Conditions = { ...g.PHASE2C26B2C2B2G_STAGE1, budgetMs: smokeBudgetMs ?? g.PHASE2C26B2C2B2G_STAGE1.budgetMs }
  const attestation = g.phase2c26b2c2b2gStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead,
    uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), probeManifestB2C2B2FResultSha256: manifest.b2c2b2fResultSha256,
    probeManifestB2C2B2EResultSha256: manifest.b2c2b2eResultSha256, targetWeaponIds, probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities,
    stage1: stage1Conditions, smoke: smokeOptions })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = g.verifyPhase2C26B2C2B2GStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, exportSha256: sha256(rawExport),
      probeManifestSha256: sha256(rawProbes), b2c2b2fResultSha256: manifest.b2c2b2fResultSha256, b2c2b2eResultSha256: manifest.b2c2b2eResultSha256, probes: manifest.probes,
      expectedTaskIdentities: manifest.expectedTaskIdentities, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: g.PHASE2C26B2C2B2G_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const processes = []
  const processesPath = join(runDir, 'processes.jsonl')
  const phaseStarted = performance.now()

  /** One fresh child. Resolves with its record (or null), its record file SHA-256 and classified outcome; never throws for a child failure. */
  const runChild = (id, childRole, task, { heapMb, budgetMs }) => new Promise(done => {
    const taskPath = join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const profilePath = join(runDir, `${id}.profile.jsonl`)
    const nodeFlags = [`--max-old-space-size=${heapMb}`]
    const start = async () => {
      await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--task', taskPath,
        ...(childRole === 'search' ? ['--profile', profilePath] : [])]
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
        const profileFile = childRole === 'search' && existsSync(profilePath) ? { file: basename(profilePath), sha256: sha256(await readFile(profilePath)) } : null
        appendFileSync(processesPath, JSON.stringify({ ...entry, recordFile, profileFile }) + '\n')
        const record = recordRaw === null ? null : JSON.parse(recordRaw.toString('utf8'))
        const s = record?.result?.status === 'searched' ? record.result.search : null
        const status = s ? ` ${s.termination} n=${s.candidates.length}` : record?.result?.status ? ` ${record.result.status}` : ''
        console.log(`${endedAt} ${outcome.toUpperCase()} ${id}${status} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        done({ entry, record, recordFile, profileFile })
      })
    }
    start()
  })

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtLaunch: freemem(),
    stage1: stage1Conditions, b2c2b2fStage1: { ...g.PHASE2C26B2C2B2G_B2C2B2F_STAGE1 }, changedStage1Fields: [...g.PHASE2C26B2C2B2G_CHANGED_STAGE1_FIELDS],
    changedFromB2C2B2F: [...g.PHASE2C26B2C2B2G_CHANGED_FROM_B2C2B2F], tasksBudgetMs: g.PHASE2C26B2C2B2G_TASKS_BUDGET_MS, targets: g.PHASE2C26B2C2B2G_TARGETS,
    expectedTasks: g.PHASE2C26B2C2B2G_EXPECTED_TASKS, maxCostCohorts: g.PHASE2C26B2C2B2G_MAX_COST_COHORTS, candidateSafetyCap: g.PHASE2C26B2C2B2G_CANDIDATE_SAFETY_CAP,
    population: g.PHASE2C26B2C2B2G_POPULATION, probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities,
    memorySampleIntervalMs: g.PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: g.PHASE2C26B2C2B2G_NODE_YIELD, searchInstrumentation: { ...g.PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION },
    b2c2b2fSearchInstrumentation: { ...g.PHASE2C26B2C2B2G_B2C2B2F_SEARCH_INSTRUMENTATION }, innerSections: [...g.PHASE2C26B2C2B2G_INNER_SECTIONS], cpuProfiler: g.PHASE2C26B2C2B2G_CPU_PROFILER,
    heartbeatIntervalMs: g.PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS, windowsMs: g.PHASE2C26B2C2B2G_WINDOWS_MS, notRun: [...g.PHASE2C26B2C2B2G_NOT_RUN],
    ...g.PHASE2C26B2C2B2G_PROVENANCE_FLAGS, repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), probeManifestBytes: rawProbes.length,
    probeManifestB2C2B2FResultSha256: manifest.b2c2b2fResultSha256, probeManifestB2C2B2EResultSha256: manifest.b2c2b2eResultSha256, smoke: smokeOptions }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2G: the B2-C2B2F BONUS-dominant Target, B2-C2B2F Search input, 30-minute bonus_depth_read inner runtime profiling (Node Research run, raw)',
    measuredAt: attestation.createdAt, environment, launchAttestation, targetWeaponIds }

  // 2. Task construction (no Search). The child gets the probe and the expected identity only.
  const tasksRun = await runChild('tasks', 'tasks', { probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities },
    { heapMb: stage1Conditions.childHeapMb, budgetMs: g.PHASE2C26B2C2B2G_TASKS_BUDGET_MS })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  const construction = tasksRun.record.result.construction
  const tasksChild = { process: tasksRun.entry, recordFile: tasksRun.recordFile, childWallMs: tasksRun.record.wallMs, scheduleMs: tasksRun.record.scheduleMs, memory: tasksRun.record.memory,
    researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion,
    scheduleSummary: tasksRun.record.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  const tasks = construction.tasks
  const gateIssues = [...construction.issues]
  if (tasks.length !== g.PHASE2C26B2C2B2G_EXPECTED_TASKS) gateIssues.push(`${tasks.length} tasks, not ${g.PHASE2C26B2C2B2G_EXPECTED_TASKS}`)
  manifest.expectedTaskIdentities.forEach((expected, index) => {
    const task = tasks[index]
    if (!task || JSON.stringify(g.phase2c26b2c2b2gTaskIdentity(task)) !== JSON.stringify(expected)) gateIssues.push(`${expected.taskId}: the task is not the expected task identity`)
  })
  console.log(`tasks: ${tasks.length}; gate ${gateIssues.length === 0 ? 'ok' : gateIssues.join('; ')}`)
  if (gateIssues.length > 0) {
    await write(outputPath, { ...base, status: 'task_construction_failed', gateIssues, tasksChild, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Task construction failed; no Search was run: ${gateIssues.join('; ')}`)
  }

  // 3. Stage 1: once, 30 minutes, 12,288 MB, concurrency 1; no retry, no fallback.
  const stage1 = []
  for (const task of tasks) {
    const run = await runChild(`stage1-${task.taskId}`, 'search', task, { heapMb: stage1Conditions.childHeapMb, budgetMs: stage1Conditions.budgetMs })
    const result = run.record?.result ?? null
    const outcome = g.phase2c26b2c2b2gTaskOutcome(task.taskId, run.entry.outcome, result)
    stage1.push({ taskId: task.taskId, task, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail,
        startedAt: run.entry.startedAt, endedAt: run.entry.endedAt, killedAtMs: run.entry.killedAtMs, nodeFlags: run.entry.nodeFlags },
      recordFile: run.recordFile, profileFile: run.profileFile, childWallMs: run.record?.wallMs ?? null, scheduleMs: run.record?.scheduleMs ?? null,
      yields: run.record?.yields ?? run.entry.lastIpcYields ?? null, memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory,
      calculationContext: run.record?.calculationContext ?? null, researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null,
      contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs, summary: result.search.summary } : null })
  }

  const record = { ...base, status: 'completed', tasksChild, tasks, stage1, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: tasks.length, stage1: stage1.map(r => ({ taskId: r.taskId, process: r.outcome.process, record: r.outcome.record,
    termination: r.outcome.termination, wallMs: r.process.wallMs })), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
