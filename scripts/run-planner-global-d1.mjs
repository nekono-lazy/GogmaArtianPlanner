// Issue #154 D1-B Research only: the Phase B found_R set coexistence diagnostic (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md).
//
// Parent (default role). It reads the registered inputs (the Phase B RESULT through its allowlist, the Phase B raw, attestation,
// tasks record, manifest, the 11 found_R records / tasks, the Phase 2-C2 RESULT baseline summary, the D1 document) and the Export:
//   0. launch observation: repository HEAD, uncommitted benchmark code, benchmark code SHA-256, the D1 document SHA-256 from the
//      HEAD git object, the observed digest of every registered input, the Production source audit since the D1-B base main;
//   1. START ATTESTATION: written once (`wx`, then read-only) into the new run dir BEFORE any child, read back and, for a formal
//      launch, verified (verifyD1StartAttestation());
//   2. V: validateD1Inputs(). Any issue: no child is started, the raw output says `input_invalid`;
//   3. R: per found Target (t00 -> t10) one fresh `redeliver` child (60 minutes, heap 12,288 MB) re-delivers the Phase B Candidate
//      and writes its G store body `<unitId>.generated-entry.json`;
//   4. B0 -> S -> P -> A-a -> A-b -> A-c-01..11: one fresh `evaluate` child per registered evaluation (30 minutes), concurrency 1,
//      no retry, no fallback. A(c) composes from the previous step's R5. An invalid event (R mismatch, B0 / S parity mismatch,
//      a guardrail violation) aborts the run: every remaining registered item is `not_executed` (aborted_after_invalid).
// Every R / evaluation row is appended to redeliveries.jsonl / evaluations.jsonl with its record file SHA-256, so an interrupted
// run stays analyzable from the run dir alone. The oracle is never read (no oracle file, module or field).
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
  throw new Error('Usage: node scripts/run-planner-global-d1.mjs --export <external Export .json> --run-dir <new dir .local> --output <new raw .json.local> [--allow-uncommitted --smoke-targets 1,10 --smoke-max-evaluations N --smoke-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-d1.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
    d1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (redeliver | evaluate)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { d1, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const sample = () => { const maxima = tracker.sample(process.memoryUsage()); process.send?.({ type: 'memory', maxima, yields }) }
  const timer = setInterval(sample, d1.D1_EXECUTION_ENVELOPE.memorySampleIntervalMs)
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const exportJson = JSON.parse((await readFile(exportPath)).toString('utf8'))
    const input = research.globalResearchInputFromExport(exportJson, d1.D1_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    let result, scheduleMs = null, generatedEntryFile = null
    if (role === 'redeliver') {
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      const dependencies = research.globalResearchDependencies(engine)
      const context = d1.checkD1RedeliveryContext(input, schedule, task.phaseBTask, task.recorded, dependencies)
      if (context.status !== 'ready') result = { status: 'redelivery_mismatch', stage: 'context', unitId: task.unitId, issues: context.issues }
      else {
        try {
          const redelivery = await d1.redeliverD1Candidate(input, task.phaseBTask, context.prepared, task.expectation, dependencies, { yieldControl })
          const { generatedEntry, ...rest } = redelivery
          if (redelivery.status === 'redelivered') {
            const body = JSON.stringify(generatedEntry, null, 2) + '\n'
            await writeFile(task.generatedEntryPath, body, { flag: 'wx' })
            generatedEntryFile = { file: basename(task.generatedEntryPath), bytes: Buffer.byteLength(body), sha256: sha256(body) }
          }
          result = { ...rest, stage: 'search' }
        } catch (error) {
          result = { status: 'redelivery_mismatch', stage: 'calculation_error', unitId: task.unitId, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 4000) } }
        }
      }
    } else if (role === 'evaluate') {
      const generated = []
      let guardrail = null
      for (const r of task.task.replacements) {
        const raw = await readFile(join(task.generatedEntryDir, r.generatedEntryFile))
        if (sha256(raw) !== r.generatedEntrySha256) { guardrail = `the G store body ${r.generatedEntryFile} is not the one R wrote`; break }
        generated.push(JSON.parse(raw.toString('utf8')))
      }
      result = guardrail !== null ? { status: 'guardrail_violation', issues: [guardrail] }
        : await d1.runD1Evaluation(input, exportJson.buildListEntries, task.task, generated, research.globalResearchDependencies(engine), { yieldControl })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, taskId: task.unitId ?? task.task.evaluationId, wallMs, scheduleMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes, maxRssKiB: process.resourceUsage().maxRSS,
        heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, generatedEntryFile, result }, false)
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
// Non-formal smoke only: a subset of the Targets (by index), a cap on started evaluations, and a shorter child budget.
const smokeTargets = option('--smoke-targets') === undefined ? null : option('--smoke-targets').split(',').map(Number)
const smokeMaxEvaluations = option('--smoke-max-evaluations') === undefined ? null : Number(option('--smoke-max-evaluations'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smoke = smokeTargets !== null || smokeMaxEvaluations !== null || smokeBudgetMs !== null
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

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths, 'docs') || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const repositoryHead = git('rev-parse', 'HEAD')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)

const server = await createLoader()
try {
  const { d1, c26a, ProductionRngEngine } = await loadModules(server)
  const specDocumentSha256 = sha256(execFileSync('git', ['show', `HEAD:${d1.D1_SPEC_FILE}`], { maxBuffer: 1 << 28 }))
  // 0. The registered inputs, read and digested before anything is written or run (a missing file is null, never substituted).
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const observedInputs = {}
  const buffers = {}
  for (const [key, registered] of Object.entries(d1.D1_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observedInputs[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
  const unitRecords = {}, unitTasks = {}
  for (const unit of d1.D1_FOUND_UNITS) {
    const record = await readOptional(join(d1.D1_PHASE_B_RUN_DIR, `${unit.unitId}.record.json`))
    const task = await readOptional(join(d1.D1_PHASE_B_RUN_DIR, `${unit.unitId}.task.json`))
    unitRecords[unit.unitId] = record === null ? null : { file: { bytes: record.length, sha256: sha256(record) }, json: parse(record) }
    unitTasks[unit.unitId] = task === null ? null : { file: { bytes: task.length, sha256: sha256(task) }, json: parse(task) }
  }
  const specMarkdown = execFileSync('git', ['show', `HEAD:${d1.D1_SPEC_FILE}`], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const baseMain = d1.D1_BASE_MAIN
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: d1.d1ProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  if (new ProductionRngEngine().version !== d1.D1_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: re-register D1 before running it (§9.2).')
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, d1.D1_START_ATTESTATION_FILE)
  const envelope = { ...d1.D1_EXECUTION_ENVELOPE, ...(smokeBudgetMs === null ? {} : { redeliveryBudgetMs: smokeBudgetMs, evaluationBudgetMs: smokeBudgetMs }) }
  const attestation = d1.d1StartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead, uncommittedBenchmarkCode: uncommitted,
    benchmarkCodeSha256, specDocumentSha256, observedInputs, exportFileName: basename(exportPath), productionAudit, machine, appliedExecutionEnvelope: envelope,
    smoke: smoke ? { redeliveryTargetIndexes: smokeTargets, maxEvaluations: smokeMaxEvaluations, budgetMs: smokeBudgetMs } : null })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = d1.verifyD1StartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, specDocumentSha256,
      exportSha256: d1.d1ChainedExportSha256(parse(buffers.phaseBAttestation)), firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: d1.D1_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per R unit / evaluation, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, specDocumentSha256, exportFileName: basename(exportPath), rngEngineVersion: new ProductionRngEngine().version,
    calculationContext: { ...d1.D1_CALCULATION_CONTEXT }, appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: attestation.smoke }
  const base = { phase: 'Issue #154 D1-B: Phase B found_R set coexistence diagnostic (Node Research run, raw)', measuredAt: attestation.createdAt, environment, launchAttestation }
  const phaseStarted = performance.now()

  // 2. V (no child).
  const validation = d1.validateD1Inputs({ files: observedInputs, phaseBResult: parse(buffers.phaseBResult), phaseBRaw: parse(buffers.phaseBRaw), phaseBAttestation: parse(buffers.phaseBAttestation),
    phase2c2Result: parse(buffers.phase2c2Result), unitRecords, unitTasks, specMarkdown }, text => sha256(text))
  console.log(`V ${validation.passed ? 'passed' : `FAILED: ${validation.issues.join('; ')}`}`)
  if (!validation.passed) {
    await write(outputPath, { ...base, status: 'input_invalid', inputValidation: { passed: false, issues: validation.issues }, redeliveries: [], evaluations: [], processes: [], wallMs: performance.now() - phaseStarted })
    process.exitCode = 1
  } else {
    const targets = validation.targets
    const phase2c2Summary = parse(buffers.phase2c2Result).baseline.summary
    const processes = []
    const redeliveriesPath = join(runDir, 'redeliveries.jsonl'), evaluationsPath = join(runDir, 'evaluations.jsonl')

    /** One fresh child. Resolves with its process entry, record (or null) and record file digest; never throws for a child failure. */
    const runChild = (id, childRole, task, budgetMs) => new Promise(done => {
      const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`), memoryPath = join(runDir, `${id}.memory.jsonl`)
      const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
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
    const processRow = entry => entry === null ? null : { outcome: entry.outcome, exitCode: entry.exitCode, signal: entry.signal, timedOut: entry.timedOut, budgetMs: entry.budgetMs,
      startedAt: entry.startedAt, endedAt: entry.endedAt, wallMs: entry.wallMs, killedAtMs: entry.killedAtMs, stderrTail: entry.stderrTail, lastIpcMemory: entry.lastIpcMemory }

    let aborted = null
    const abort = reason => { if (aborted === null) { aborted = reason; console.log(`ABORT ${reason}`) } }

    // 3. R.
    const redeliveries = []
    const generatedByIndex = new Map()
    for (const target of targets) {
      const row = { unitId: target.unitId, targetIndex: target.targetIndex, targetWeaponId: target.targetWeaponId, status: null, process: null, recordFile: null, generatedEntry: null, notExecutedReason: null }
      const skip = aborted !== null ? 'aborted_after_invalid' : smokeTargets !== null && !smokeTargets.includes(target.targetIndex) ? 'smoke_skipped' : null
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip } else {
        const generatedEntryPath = join(runDir, `${target.unitId}.generated-entry.json`)
        const task = { unitId: target.unitId, targetIndex: target.targetIndex, phaseBTask: target.task, recorded: { reservation: target.reservation, excludedRouteKeys: target.excludedRouteKeys },
          expectation: d1.d1RedeliveryExpectation(target), generatedEntryPath }
        const run = await runChild(`R-${target.unitId}`, 'redeliver', task, envelope.redeliveryBudgetMs)
        row.process = processRow(run.entry)
        row.recordFile = run.recordFile
        if (run.entry.outcome !== 'completed') row.status = run.entry.outcome
        else {
          row.status = run.record.result.status
          if (row.status === 'redelivered') {
            const raw = await readFile(generatedEntryPath)
            row.generatedEntry = { file: basename(generatedEntryPath), bytes: raw.length, sha256: sha256(raw) }
            if (!run.record.generatedEntryFile || run.record.generatedEntryFile.sha256 !== row.generatedEntry.sha256) { row.status = 'redelivery_mismatch'; row.generatedEntry = null }
            else generatedByIndex.set(target.targetIndex, { file: row.generatedEntry.file, sha256: row.generatedEntry.sha256 })
          }
          if (row.status === 'redelivery_mismatch') abort(`redelivery_mismatch ${target.unitId}`)
        }
        console.log(`${run.entry.endedAt} R ${target.unitId} ${row.status} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${((run.entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
      }
      redeliveries.push(row)
      appendFileSync(redeliveriesPath, JSON.stringify(row) + '\n')
    }

    // 4. Evaluations in the registered order.
    const registry = d1.d1RegisteredEvaluations()
    const evaluations = []
    let started = 0, accepted = [], unmeasuredStepSeen = false, b0Selected = null
    const replacementTask = index => {
      const t = targets[index], g = generatedByIndex.get(index)
      return { targetIndex: index, targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, generatedBuildListEntryId: t.generatedBuildListEntryId,
        generatedEntrySha256: g.sha256, generatedEntryFile: g.file, requiresSupport: [...t.supportBuildListEntryIds], phaseBReservationDigest: t.reservationDigest, phaseBReservation: t.reservation }
    }
    for (const registered of registry) {
      const composition = registered.stage === 'A-c' ? { acceptedBefore: [...accepted], candidate: registered.candidateIndex } : null
      const indexes = registered.stage === 'A-c' ? d1.d1CompositionProposal(accepted, registered.candidateIndex) : registered.targetIndexes
      const row = { evaluationId: registered.evaluationId, stage: registered.stage, ordinal: registered.ordinal, evaluatedAgainst: registered.evaluatedAgainst, replacementTargetIndexes: indexes,
        replacementTargets: indexes.map(i => targets[i].targetWeaponId), generatedEntryIds: indexes.map(i => targets[i].generatedBuildListEntryId),
        generatedEntrySha256s: indexes.map(i => generatedByIndex.get(i)?.sha256 ?? null), requiresSupport: [...new Set(indexes.flatMap(i => targets[i].supportBuildListEntryIds))].sort(),
        inputDigest: null, status: null, notExecutedReason: null, process: null, recordFile: null, runner: null, composition, afterUnmeasuredStep: registered.stage === 'A-c' ? unmeasuredStepSeen : false }
      const missing = indexes.filter(i => !generatedByIndex.has(i))
      const skip = aborted !== null ? 'aborted_after_invalid' : smokeTargets !== null && indexes.some(i => !smokeTargets.includes(i)) ? 'smoke_skipped'
        : smokeMaxEvaluations !== null && started >= smokeMaxEvaluations ? 'smoke_cap' : missing.length > 0 ? 'dependency_unmeasured' : null
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip } else {
        started += 1
        const replacements = indexes.map(replacementTask)
        row.inputDigest = d1.d1InputDigest(row.replacementTargets, row.generatedEntryIds, row.generatedEntrySha256s, observedInputs.export.sha256)
        const task = { task: { evaluationId: registered.evaluationId, stage: registered.stage, evaluatedAgainst: registered.evaluatedAgainst, replacements,
          researchMaxPlanSteps: d1.D1_RESEARCH_MAX_PLAN_STEPS, fullRunCap: d1.D1_EVALUATION_FULL_RUN_CAP }, generatedEntryDir: resolve(runDir) }
        const run = await runChild(registered.evaluationId, 'evaluate', task, envelope.evaluationBudgetMs)
        row.process = processRow(run.entry)
        row.recordFile = run.recordFile
        const result = run.record?.result ?? null
        row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
        // The runner's own judgement (the analyzer re-derives every one of them independently).
        const facts = result !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(result.status) ? result : null
        const r5 = d1.judgeD1R5({ status: row.status, evaluatedAgainst: registered.evaluatedAgainst, generatedBuildListEntryIds: row.generatedEntryIds, requiresSupport: row.requiresSupport, facts })
        let parity = null
        if (registered.stage === 'B0') {
          parity = d1.d1B0Parity(facts?.baselineSummary ?? null, phase2c2Summary)
          if (facts !== null) b0Selected = facts.plan.selectedBuildListEntryIds
          if (row.status === 'calculation_error' || (facts !== null && !parity.matched) || (row.status === 'planner_rerun_bound_reached')) abort(`baseline_parity_mismatch ${registered.evaluationId}`)
        }
        if (registered.stage === 'S') {
          parity = d1.d1SParity(facts, targets[indexes[0]].trial)
          if (row.status === 'calculation_error' || (D1MEASURED(row.status) && !parity.matched)) abort(`phase_b_parity_mismatch ${registered.evaluationId}`)
        }
        if (row.status === 'guardrail_violation' || (facts !== null && facts.runConflictResolutions !== 0)) abort(`guardrail ${registered.evaluationId}`)
        row.runner = { r5, parity, boundLimited: d1.isD1BoundLimited(row.status, facts), b0SelectedKnown: b0Selected !== null }
        console.log(`${run.entry.endedAt} ${registered.evaluationId} ${row.status}${facts ? ` steps=${facts.plan.steps} completed=${facts.plan.termination?.completedTargetCount ?? '-'} conflicts=${facts.conflicts.length} runs=${facts.fullRunsStarted}` : ''} r5=${r5.satisfied} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${((run.entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
      }
      if (composition !== null) {
        const measured = D1MEASURED(row.status)
        const outcome = d1.d1CompositionOutcome(composition.acceptedBefore, composition.candidate, measured, measured ? row.runner?.r5.satisfied ?? false : null)
        row.composition = { ...composition, proposed: outcome.proposed, accepted: outcome.accepted, acceptedAfter: outcome.acceptedAfter }
        accepted = outcome.acceptedAfter
        if (!measured) unmeasuredStepSeen = true
      }
      evaluations.push(row)
      appendFileSync(evaluationsPath, JSON.stringify(row) + '\n')
    }
    await write(outputPath, { ...base, status: aborted !== null ? 'aborted_after_invalid' : smoke ? 'smoke' : 'completed', abortReason: aborted,
      inputValidation: { passed: true, issues: [] }, redeliveries, evaluations, processes, wallMs: performance.now() - phaseStarted })
    const count = (list, status) => list.filter(r => r.status === status).length
    console.log(JSON.stringify({ output: resolve(outputPath), aborted, redelivered: count(redeliveries, 'redelivered'), evaluated: count(evaluations, 'evaluated'),
      notExecuted: count(evaluations, 'not_executed'), r5Satisfied: evaluations.filter(e => e.runner?.r5.satisfied === true).map(e => e.evaluationId), accepted, wallMs: performance.now() - phaseStarted }, null, 2))
  }
} finally {
  await server.close()
}

function D1MEASURED(status) { return status === 'evaluated' || status === 'preflight_refused' || status === 'planner_rerun_bound_reached' }
