// Issue #154 Phase 2-C2.7-B Research only: the E1 oracle-free execution of the Phase 2-C2.7-A pre-registered policy.
//
// Parent (default role). It reads the Export and the population manifest (Target IDs only; never a RESULT, never the oracle):
//   0. launch observation: repository HEAD, uncommitted benchmark code, benchmark code SHA-256, the Phase 2-C2.7-A document SHA-256,
//      Export / manifest SHA-256, the Production source audit (changed files since the registered base main, working tree and
//      untracked files included), and a machine observation;
//   1. START ATTESTATION: writes start-attestation.json into the new run dir ONCE (`wx`, then read-only) BEFORE any child process,
//      reads it back and, for a formal launch, verifies it (verifyPhase2C27BStartAttestation());
//   2. `tasks` child: derivePhase2C26B2C1Schedule() over the Export, then buildPhase2C27BTargetPlans(): every K <= 1 context of every
//      manifest Target in P1 order (43 each) or no unit runs;
//   3. units: per Target in manifest order, the pre-registered rung-major scheduler (createPhase2C27BTargetScheduler()) asks for the
//      next policy-required unit; each unit runs once in a fresh child (heap 12,288 MB, 60 minutes judged here, concurrency 1, no
//      retry, no fallback) that receives the unit task only (context selector, rung extent, ladder state). The scheduler is fed the
//      typed outcome and the end ladder state of each unit and nothing else. A timeout / OOM / failure is that failure (unmeasured),
//      never "no Candidate", and never escalates.
// Every unit start / end is logged and appended to units.jsonl (with its record file SHA-256) and every Target stop to targets.jsonl,
// so an interrupted run stays analyzable from the run dir alone.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c27b.mjs --export <external.json> --targets <population manifest .json.local> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-targets 0,3 --smoke-max-units N --smoke-unit-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c27b.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// The scheduler side loads only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
    b: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C27B.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { b, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, b.PHASE2C27B_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), b.PHASE2C27B_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
    const scheduleMs = performance.now() - started
    let result
    if (role === 'tasks') {
      const construction = b.buildPhase2C27BTargetPlans(schedule, task.targetWeaponIds)
      result = { construction, scheduleSummary: { policies: schedule.policies, extent: schedule.extent, origins: schedule.origins, checks: schedule.checks, snapshotChecks: schedule.snapshot.checks,
        snapshotInput: schedule.snapshot.input, originDigest: schedule.snapshot.originDigest, targets: schedule.targets.length, contexts: schedule.contexts.length } }
    } else if (role === 'unit') {
      result = await b.runPhase2C27BUnit(input, schedule, task, research.globalResearchDependencies(engine), { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
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
// Non-formal smoke only: a subset of the manifest Targets (by index), a total unit cap, and a shorter unit budget.
const smokeTargets = option('--smoke-targets') === undefined ? null : option('--smoke-targets').split(',').map(Number)
const smokeMaxUnits = option('--smoke-max-units') === undefined ? null : Number(option('--smoke-max-units'))
const smokeUnitBudgetMs = option('--smoke-unit-budget-ms') === undefined ? null : Number(option('--smoke-unit-budget-ms'))
const smoke = smokeTargets !== null || smokeMaxUnits !== null || smokeUnitBudgetMs !== null
if (smoke && !allowUncommitted) throw new Error('--smoke-* are non-formal smoke options and need --allow-uncommitted.')

async function machineObservation() {
  let otherNodeProcesses = null
  try {
    const list = platform() === 'win32' ? execFileSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      : execFileSync('ps', ['-C', 'node', '-o', 'pid='], { encoding: 'utf8' })
    otherNodeProcesses = lines(list).filter(line => /node/i.test(line) || /^\s*\d+\s*$/.test(line)).length - 1
  } catch { otherNodeProcesses = null }
  const times = () => cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a }, { busy: 0, all: 0 })
  const a = times()
  await new Promise(done => setTimeout(done, 1000))
  const t = times()
  return { freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), otherNodeProcesses, cpuBusyShare: t.all > a.all ? (t.busy - a.busy) / (t.all - a.all) : null }
}

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
  const { b, c26a, ProductionRngEngine } = await loadModules(server)
  const policyDocumentSha256 = sha256(await readFile(b.PHASE2C27B_POLICY_AUTHORITY.file))
  // 0. The population manifest (Target IDs only) and the Export it names, before anything is written or run.
  const parsed = b.parsePhase2C27BTargetManifest(JSON.parse(rawTargets.toString('utf8')))
  if (!parsed.valid) throw new Error(`The population manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export read is not the one the population manifest names.')
  // 0b. The Production source audit (git, working tree and untracked files included).
  const baseMain = b.PHASE2C27B_POLICY_AUTHORITY.baseMain
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: b.phase2c27bProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, b.PHASE2C27B_START_ATTESTATION_FILE)
  const smokeOptions = smoke ? { targetIndexes: smokeTargets, maxUnits: smokeMaxUnits, unitBudgetMs: smokeUnitBudgetMs } : null
  const envelope = { ...b.PHASE2C27B_EXECUTION_ENVELOPE, unitBudgetMs: smokeUnitBudgetMs ?? b.PHASE2C27B_EXECUTION_ENVELOPE.unitBudgetMs }
  const attestation = b.phase2c27bStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead,
    uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, policyDocumentSha256, exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length,
    targetManifestFileName: basename(targetsPath), targetManifestSha256: sha256(rawTargets), targetWeaponIds: [...manifest.targetWeaponIds], productionAudit, machine,
    appliedExecutionEnvelope: envelope, smoke: smokeOptions })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = b.verifyPhase2C27BStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, exportSha256: sha256(rawExport),
      targetManifestSha256: sha256(rawTargets), targetWeaponIds: manifest.targetWeaponIds, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: b.PHASE2C27B_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const processes = []
  const unitsPath = join(runDir, 'units.jsonl'), targetsJournalPath = join(runDir, 'targets.jsonl')
  const phaseStarted = performance.now()

  /** One fresh child. Resolves with its process entry, record (or null) and record file SHA-256; never throws for a child failure. */
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
      // The wall-clock budget is judged here, in the parent, never by the child.
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
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, endedAt: new Date().toISOString(), wallMs: performance.now() - began, killedAtMs,
          nodeFlags, lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        const recordRaw = outcome === 'completed' ? await readFile(recordPath) : null
        const recordFile = recordRaw === null ? null : { file: basename(recordPath), bytes: recordRaw.length, sha256: sha256(recordRaw) }
        done({ entry, record: recordRaw === null ? null : JSON.parse(recordRaw.toString('utf8')), recordFile })
      })
    }
    start()
  })

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per unit, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, policyDocumentSha256, exportFileName: basename(exportPath), exportSha256: sha256(rawExport),
    exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version, targetManifestFileName: basename(targetsPath), targetManifestSha256: sha256(rawTargets),
    appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: smokeOptions, registered: b.phase2c27bRegisteredConditions() }
  const base = { phase: 'Issue #154 Phase 2-C2.7-B: E1 oracle-free execution of the Phase 2-C2.7-A policy (Node Research run, raw)', measuredAt: attestation.createdAt,
    environment, launchAttestation, targetWeaponIds: manifest.targetWeaponIds }

  // 2. Context construction (no Search). The child gets the Target IDs only.
  const tasksRun = await runChild('tasks', 'tasks', { targetWeaponIds: manifest.targetWeaponIds }, { heapMb: envelope.childHeapMb, budgetMs: b.PHASE2C27B_TASKS_BUDGET_MS })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no unit was run.')
  }
  const construction = tasksRun.record.result.construction
  const tasksChild = { process: tasksRun.entry, recordFile: tasksRun.recordFile, childWallMs: tasksRun.record.wallMs, scheduleMs: tasksRun.record.scheduleMs, memory: tasksRun.record.memory,
    researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion,
    scheduleSummary: tasksRun.record.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  const plans = construction.plans
  const gateIssues = [...construction.issues]
  if (plans.length !== manifest.targetWeaponIds.length) gateIssues.push(`${plans.length} Target plans, not ${manifest.targetWeaponIds.length}`)
  for (const plan of plans) if (!plan.checkpointBlocked && plan.contexts.length !== b.PHASE2C27B_CONTEXT_SCOPE.expectedPerTarget) gateIssues.push(`${plan.targetWeaponId}: ${plan.contexts.length} contexts`)
  console.log(`plans: ${plans.length}; contexts ${plans.map(p => p.contexts.length).join('/')}; gate ${gateIssues.length === 0 ? 'ok' : gateIssues.join('; ')}`)
  if (gateIssues.length > 0) {
    await write(outputPath, { ...base, status: 'task_construction_failed', gateIssues, tasksChild, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Context construction failed; no unit was run: ${gateIssues.join('; ')}`)
  }

  // 3. The rung-major units, Target by Target (concurrency 1, no retry, no fallback).
  const units = []
  const targets = []
  let unitCount = 0
  let smokeCapReached = false
  for (const plan of plans) {
    if (smokeTargets !== null && !smokeTargets.includes(plan.targetIndex)) continue
    const scheduler = b.createPhase2C27BTargetScheduler(plan)
    const targetStarted = performance.now()
    let stop = null
    for (;;) {
      const next = scheduler.next()
      if (!('unitId' in next)) { stop = next; break }
      if (smokeMaxUnits !== null && unitCount >= smokeMaxUnits) { smokeCapReached = true; break }
      unitCount += 1
      const task = b.phase2c27bUnitTask(plan, next)
      const run = await runChild(next.unitId, 'unit', task, { heapMb: envelope.childHeapMb, budgetMs: envelope.unitBudgetMs })
      const record = run.record?.result ?? null
      const result = b.phase2c27bUnitResult(run.entry.outcome, record)
      scheduler.record(result)
      const row = { unitId: next.unitId, targetWeaponId: plan.targetWeaponId, targetIndex: plan.targetIndex, contextRank: next.contextRank, rung: next.rung,
        ladderStateAtStart: next.ladderStateAtStart, process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs,
          exitCode: run.entry.exitCode, signal: run.entry.signal, stderrTail: run.entry.stderrTail, startedAt: run.entry.startedAt, endedAt: run.entry.endedAt, killedAtMs: run.entry.killedAtMs },
        recordFile: run.recordFile, result, childWallMs: run.record?.wallMs ?? null, scheduleMs: run.record?.scheduleMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null,
        memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null,
        researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null }
      units.push(row)
      appendFileSync(unitsPath, JSON.stringify(row) + '\n')
      const r = record?.status === 'executed' ? record : null
      console.log(`${run.entry.endedAt} ${run.entry.outcome.toUpperCase()} ${next.unitId} ${result.measured ? result.outcome : result.reason}${r ? ` delivered=${r.deliveries.length} trials=${r.trials.length} skip=${r.skippedPreviouslyRejected.length} ladder=${r.ladderStateAtEnd.candidateTrialsUsed}/${r.ladderStateAtEnd.plannerRerunsUsed} search=${(r.timing.searchOnlyMs / 1000).toFixed(1)}s trial=${(r.timing.trialMs / 1000).toFixed(1)}s` : ''} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${((run.entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
    }
    const targetRow = { targetWeaponId: plan.targetWeaponId, targetIndex: plan.targetIndex, checkpointBlocked: plan.checkpointBlocked, stop, interruptedBySmokeCap: stop === null,
      contextStates: scheduler.contextStates(), wallMs: performance.now() - targetStarted }
    targets.push(targetRow)
    appendFileSync(targetsJournalPath, JSON.stringify(targetRow) + '\n')
    console.log(`TARGET t${String(plan.targetIndex).padStart(2, '0')} ${stop ? `${stop.stopReason} rung=${stop.rung} rank=${stop.contextRank}` : 'smoke cap'} ${(targetRow.wallMs / 1000).toFixed(1)}s`)
    if (smokeCapReached) break
  }

  const record = { ...base, status: smokeCapReached ? 'smoke_cap_reached' : 'completed', tasksChild, plans, units, targets, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = predicate => units.filter(predicate).length
  console.log(JSON.stringify({ output: resolve(outputPath), status: record.status, units: units.length, measured: count(u => u.result.measured),
    timeout: count(u => !u.result.measured && u.result.reason === 'timeout'), out_of_memory: count(u => !u.result.measured && u.result.reason === 'out_of_memory'),
    process_failure: count(u => !u.result.measured && u.result.reason === 'process_failure'), context_mismatch: count(u => !u.result.measured && u.result.reason === 'context_mismatch'),
    stops: targets.map(t => t.stop?.stopReason ?? 'smoke'), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
