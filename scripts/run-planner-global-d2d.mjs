// Issue #154 D2-D-B Research only: local two-Target recomposition of existing Candidates (t05 K1 x t07 K0)
// (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md).
//
// Parent (default role). It reads the registered inputs (the D2-C / D2 RESULTs through their allowlists, the Phase 2-C2 RESULT
// baseline summary, the chained documents, the 12 G store bodies, the 4 CTX records, the D2-C attestation / raw) and the Export:
//   0. launch observation: repository HEAD, uncommitted benchmark code, the calculation code SHA-256, the D2-D document SHA-256 from
//      the HEAD git object, the registered policy SHA-256, the observed digest of every registered input, the Production audit;
//   1. START ATTESTATION: written once (`wx`, then read-only) into the new run dir BEFORE any child, read back and, for a formal
//      launch, verified (verifyD2DStartAttestation());
//   2. V: validateD2DInputs() (the §3.1 derivation equal to the §3.2 table). Any issue: no child is started, the raw output says
//      `input_invalid`;
//   3. RV: one fresh `rv` child (10 minutes) - no Search, no full run; a guardrail violation aborts, an unmeasured RV leaves every
//      evaluation not_executed (rv_unmeasured);
//   4. B0 -> I0 -> PAIR 1 .. 6: one fresh `evaluate` child each (30 minutes), concurrency 1, no retry, no fallback; a B0 / I0 parity
//      mismatch, a guardrail violation or a registered inputDigest mismatch aborts; an unmeasured I0 leaves every PAIR not_executed
//      (i0_unmeasured); every PAIR is evaluated (no early stop).
// The 4-hour run envelope stops new children (`run_envelope_reached`). Every row is appended to rv.jsonl / evaluations.jsonl with its
// record file SHA-256, so an interrupted run stays analyzable from the run dir alone. The oracle is never read (no oracle file,
// module or field).
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
  throw new Error('Usage: node scripts/run-planner-global-d2d.mjs --export <external Export .json> --run-dir <new dir .local> --output <new raw .json.local> [--allow-uncommitted --smoke-pairs 1,4 --smoke-max-children N --smoke-budget-ms N --smoke-skip-evaluations]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-d2d.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
    d2d: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2D.ts'),
    d1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1.ts'),
    d2c: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2C.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (rv | evaluate)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { d2d, d1, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const sample = () => { const maxima = tracker.sample(process.memoryUsage()); process.send?.({ type: 'memory', maxima, yields }) }
  const timer = setInterval(sample, d2d.D2D_EXECUTION_ENVELOPE.memorySampleIntervalMs)
  try {
    sample()
    const wrapper = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const rawExport = await readFile(exportPath)
    const exportSha256 = sha256(rawExport)
    const exportJson = JSON.parse(rawExport.toString('utf8'))
    const input = research.globalResearchInputFromExport(exportJson, d2d.D2D_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    const readBodies = async paths => {
      const bodies = [], observed = []
      for (const path of paths) { const raw = await readFile(path); observed.push(sha256(raw)); bodies.push(JSON.parse(raw.toString('utf8'))) }
      return { bodies, observed }
    }
    let result, scheduleMs = null, inputDigest = null
    if (role === 'rv') {
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      const { bodies, observed } = await readBodies(wrapper.generatedEntryPaths)
      result = d2d.runD2DReverification(input, exportJson.buildListEntries, schedule, wrapper.task, bodies, observed, dependencies, text => sha256(text))
    } else if (role === 'evaluate') {
      const task = wrapper.task
      inputDigest = d1.d1InputDigest(task.replacements.map(r => r.targetWeaponId), task.replacements.map(r => r.generatedBuildListEntryId), task.replacements.map(r => r.generatedEntrySha256), exportSha256)
      const { bodies, observed } = await readBodies(wrapper.generatedEntryPaths)
      result = await d2d.runD2DEvaluation(input, exportJson.buildListEntries, task, bodies, observed, dependencies, { sha256OfText: text => sha256(text), yieldControl })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, taskId: wrapper.task.unitId ?? wrapper.task.evaluationId, wallMs, scheduleMs, yields, exportSha256, inputDigest,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes, maxRssKiB: process.resourceUsage().maxRSS,
        heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result })
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
// Non-formal smoke only: a subset of the PAIRs (by ordinal), a cap on started children, a shorter child budget, no evaluations.
const smokePairs = option('--smoke-pairs') === undefined ? null : option('--smoke-pairs').split(',').map(Number)
const smokeMaxChildren = option('--smoke-max-children') === undefined ? null : Number(option('--smoke-max-children'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smokeSkipEvaluations = args.includes('--smoke-skip-evaluations')
const smoke = smokePairs !== null || smokeMaxChildren !== null || smokeBudgetMs !== null || smokeSkipEvaluations
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
  const { d2d, d1, d2c, c26a, research, ProductionRngEngine } = await loadModules(server)
  const specRaw = execFileSync('git', ['show', `HEAD:${d2d.D2D_SPEC_FILE}`], { maxBuffer: 1 << 28 })
  const specDocumentSha256 = sha256(specRaw)
  const registeredPolicySha256 = d2d.d2dRegisteredPolicySha256(text => sha256(text))
  // 0. The registered inputs, read and digested before anything is written or run (a missing file is null, never substituted).
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
  const observedInputs = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2d.D2D_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observedInputs[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const d2cProjection = d2d.projectD2DD2CResult(parse(buffers.d2cResult))
  const chainedDocuments = {}, observedDocuments = {}
  for (const key of d2d.D2D_CHAINED_DOCUMENT_KEYS) {
    const ref = d2cProjection?.sources.documents[key] ?? null
    chainedDocuments[key] = ref?.sha256 ?? null
    const buffer = ref === null ? null : await readOptional(ref.file)
    observedDocuments[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const gStoreFiles = {}, observedGStoreFiles = {}, gStorePath = {}
  for (const f of d2d.D2D_G_STORE_FILES) {
    const key = d2d.d2dGStoreKey(f.label, f.ordinal)
    const path = join(f.runDir, f.file)
    gStorePath[key] = resolve(path)
    const buffer = await readOptional(path)
    observedGStoreFiles[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    gStoreFiles[key] = buffer === null ? null : { file: observedGStoreFiles[key], json: parse(buffer) }
  }
  const contextRecords = {}, observedContextRecords = {}
  for (const c of d2d.D2D_CONTEXT_RECORDS) {
    const buffer = await readOptional(join(d2d.D2D_D2C_PROVENANCE.runDir, c.file))
    observedContextRecords[String(c.k)] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    contextRecords[c.k] = buffer === null ? null : { file: observedContextRecords[String(c.k)], json: parse(buffer) }
  }
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observedCalculationContext = research.globalResearchInputFromExport(exportJson, d2d.D2D_RESEARCH_MAX_PLAN_STEPS).calculationContext
  const baseMain = d2d.D2D_BASE_MAIN
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: d2d.d2dProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  const rngEngineVersion = new ProductionRngEngine().version
  if (rngEngineVersion !== d2d.D2D_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: re-register D2-D before running it (§9.2).')
  if (JSON.stringify(observedCalculationContext) !== JSON.stringify(d2d.D2D_CALCULATION_CONTEXT)) throw new Error('The CalculationContext moved: re-register D2-D before running it (§9.2).')
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, d2d.D2D_START_ATTESTATION_FILE)
  const envelope = { ...d2d.D2D_EXECUTION_ENVELOPE, ...(smokeBudgetMs === null ? {} : { rvBudgetMs: smokeBudgetMs, evaluationBudgetMs: smokeBudgetMs }) }
  const attestation = d2d.d2dStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead, uncommittedBenchmarkCode: uncommitted,
    benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, observedInputs, observedDocuments, observedGStoreFiles, observedContextRecords, exportFileName: basename(exportPath), productionAudit, machine,
    appliedExecutionEnvelope: envelope, rngEngineVersion, observedCalculationContext,
    smoke: smoke ? { pairs: smokePairs, maxChildren: smokeMaxChildren, budgetMs: smokeBudgetMs, skipEvaluations: smokeSkipEvaluations } : null })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = d2d.verifyD2DStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: d2d.d2dChainedExportSha256(parse(buffers.d2cResult)), chainedDocuments, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: d2d.D2D_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process for RV and per evaluation, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportFileName: basename(exportPath), rngEngineVersion,
    calculationContext: observedCalculationContext, appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: attestation.smoke }
  const base = { phase: 'Issue #154 D2-D-B: local two-Target recomposition of existing Candidates (Node Research run, raw)', measuredAt: attestation.createdAt, environment, launchAttestation }
  const phaseStarted = performance.now()

  // 2. V (no child).
  const validation = d2d.validateD2DInputs({ files: observedInputs, documents: observedDocuments, gStoreFiles, contextRecords, d2cResult: parse(buffers.d2cResult), d2Result: parse(buffers.d2Result),
    phase2c2Result: parse(buffers.phase2c2Result), specMarkdown: specRaw.toString('utf8') })
  console.log(`V ${validation.passed ? `passed: ${validation.derivation.pairs.map(p => `${p.evaluationId}=${p.inputDigest}`).join(' ')}` : `FAILED: ${validation.issues.join('; ')}`}`)
  if (!validation.passed) {
    await write(outputPath, { ...base, status: 'input_invalid', abortReason: null, runEnvelopeReached: false, inputValidation: { passed: false, issues: validation.issues }, rv: null, evaluations: [], processes: [],
      wallMs: performance.now() - phaseStarted })
    process.exitCode = 1
  } else {
    const derivation = validation.derivation
    const processes = []
    const path = name => join(runDir, name)
    const rvPath = path('rv.jsonl'), evaluationsPath = path('evaluations.jsonl')
    const COMPARABLE = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']

    /** One fresh child. Resolves with its process entry, record (or null) and record file digest; never throws for a child failure. */
    const runChild = (id, childRole, wrapper, budgetMs, recordName) => new Promise(done => {
      const taskPath = path(`${id}.task.json`), recordPath = path(recordName), memoryPath = path(`${id}.memory.jsonl`)
      const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
      const start = async () => {
        await write(taskPath, wrapper)
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
    const heap = entry => `${((entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`

    let aborted = null, runEnvelopeReached = false, startedChildren = 0
    const abort = reason => { if (aborted === null) { aborted = reason; console.log(`ABORT ${reason}`) } }
    const skipReason = (kind, pairOrdinal = null) => {
      if (aborted !== null) return 'aborted_after_invalid'
      if (performance.now() - phaseStarted >= envelope.runBudgetMs) { runEnvelopeReached = true; return 'run_envelope_reached' }
      if (smokeSkipEvaluations && kind === 'evaluation') return 'smoke_skipped'
      if (smokePairs !== null && pairOrdinal !== null && !smokePairs.includes(pairOrdinal)) return 'smoke_skipped'
      if (smokeMaxChildren !== null && startedChildren >= smokeMaxChildren) return 'smoke_cap'
      return null
    }

    // 3. RV (§6.1)
    const rvTask = d2d.d2dReverificationTask(validation)
    const rvRefs = d2d.d2dReverificationCandidates(derivation)
    const rvRow = { unitId: d2d.D2D_RV_UNIT_ID, status: null, notExecutedReason: null, process: null, recordFile: null }
    const rvSkip = skipReason('rv')
    if (rvSkip !== null) { rvRow.status = 'not_executed'; rvRow.notExecutedReason = rvSkip }
    else {
      startedChildren += 1
      const run = await runChild(d2d.D2D_RV_UNIT_ID, 'rv', { task: rvTask, generatedEntryPaths: rvRefs.map(r => gStorePath[d2d.d2dGStoreKey(r.label, r.ordinal)]) }, envelope.rvBudgetMs, d2d.D2D_RV_RECORD_FILE)
      rvRow.process = processRow(run.entry)
      rvRow.recordFile = run.recordFile
      rvRow.status = run.entry.outcome !== 'completed' ? run.entry.outcome : run.record.result.status
      if (rvRow.status === 'guardrail_violation') abort(`guardrail RV: ${JSON.stringify(run.record.result.issues)}`)
      if (run.record !== null && run.record.result?.baseline?.conflictResolutions !== 0) abort('guardrail RV: G1')
      console.log(`${run.entry.endedAt} RV ${rvRow.status} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
    }
    appendFileSync(rvPath, JSON.stringify(rvRow) + '\n')
    const rvVerified = rvRow.status === 'verified'

    // 4. Evaluations: one registered evaluation is a not_executed row or one fresh child. Returns { row, facts, r5 }.
    const evaluationRows = []
    const evaluate = async (spec) => {
      const task = d2d.d2dEvaluationTask(validation, spec.evaluationId, spec.stage, spec.pairOrdinal, spec.replacements)
      const row = { evaluationId: spec.evaluationId, stage: spec.stage, evaluatedAgainst: task.evaluatedAgainst, pairOrdinal: spec.pairOrdinal, t05Ordinal: spec.t05Ordinal, t07Ordinal: spec.t07Ordinal,
        replacementLabels: [...spec.replacements].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1).map(r => r.label), replacementTargets: task.replacements.map(r => r.targetWeaponId),
        generatedEntryIds: task.replacements.map(r => r.generatedBuildListEntryId), generatedEntrySha256s: task.replacements.map(r => r.generatedEntrySha256),
        requiresSupport: [...new Set(task.replacements.flatMap(r => r.requiresSupport))].sort(), inputDigest: null, registeredInputDigest: spec.registeredInputDigest, status: null, notExecutedReason: null,
        process: null, recordFile: null, runner: null }
      const finish = (facts, r5) => { evaluationRows.push(row); appendFileSync(evaluationsPath, JSON.stringify(row) + '\n'); return { row, facts, r5 } }
      const skip = spec.blockedReason ?? skipReason('evaluation', spec.pairOrdinal)
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip; return finish(null, null) }
      row.inputDigest = d1.d1InputDigest(row.replacementTargets, row.generatedEntryIds, row.generatedEntrySha256s, validation.exportSha256)
      if (spec.registeredInputDigest !== null && row.inputDigest !== spec.registeredInputDigest) { abort(`guardrail ${spec.evaluationId}: inputDigest ${row.inputDigest} is not the registered ${spec.registeredInputDigest}`); row.status = 'not_executed'; row.notExecutedReason = 'aborted_after_invalid'; return finish(null, null) }
      startedChildren += 1
      const paths = task.replacements.map(r => { const ref = spec.replacements.find(x => x.generatedBuildListEntryId === r.generatedBuildListEntryId); return gStorePath[d2d.d2dGStoreKey(ref.label, ref.ordinal)] })
      const run = await runChild(spec.evaluationId, 'evaluate', { task, generatedEntryPaths: paths }, envelope.evaluationBudgetMs, d2d.d2dEvaluationRecordFile(spec.evaluationId))
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const facts = result !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(result.status) ? result : null
      const r5 = d1.judgeD1R5({ status: row.status, evaluatedAgainst: task.evaluatedAgainst, generatedBuildListEntryIds: row.generatedEntryIds, requiresSupport: row.requiresSupport, facts })
      if (row.status === 'guardrail_violation' || (facts !== null && facts.runConflictResolutions !== 0)) abort(`guardrail ${spec.evaluationId}: ${JSON.stringify(result?.issues ?? 'G1')}`)
      if (run.record !== null && run.record.inputDigest !== row.inputDigest) abort(`guardrail ${spec.evaluationId}: the child inputDigest ${run.record.inputDigest} is not the runner one`)
      row.runner = { r5, boundLimited: d1.isD1BoundLimited(row.status, facts) }
      console.log(`${run.entry.endedAt} ${spec.evaluationId} ${row.status}${facts ? ` steps=${facts.plan.steps} completed=${facts.plan.termination?.completedTargetCount ?? '-'} conflicts=${facts.conflicts.length} runs=${facts.fullRunsStarted} selected=${facts.plan.selectedBuildListEntryIds.length}` : ''} r5=${r5.satisfied} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
      return finish(facts, r5)
    }
    const blocked = rvVerified ? null : 'rv_unmeasured'
    // B0 (§4.2)
    const b0 = await evaluate({ evaluationId: 'B0', stage: 'B0', pairOrdinal: null, t05Ordinal: null, t07Ordinal: null, replacements: [], registeredInputDigest: d2d.D2D_B0_EXPECTED.inputDigest, blockedReason: blocked })
    if (COMPARABLE.includes(b0.row.status)) {
      const p = d1.d1B0Parity(b0.facts?.baselineSummary ?? null, validation.phase2c2BaselineSummary)
      const t = b0.facts?.plan.termination ?? null
      const e = d2d.D2D_B0_EXPECTED
      if (b0.row.status !== 'evaluated' || !p.matched || b0.facts.resultDigest !== e.resultDigest || b0.row.inputDigest !== e.inputDigest || t?.status !== e.termination || t?.completedTargetCount !== e.completed
        || b0.facts.conflicts.length !== e.conflicts || b0.facts.plan.steps !== e.steps) abort(`baseline_parity_mismatch B0: ${b0.row.status} ${p.mismatches.join(', ')}`)
    }
    // I0 (§4.3)
    const i0Run = await evaluate({ evaluationId: 'I0', stage: 'I0', pairOrdinal: null, t05Ordinal: null, t07Ordinal: null, replacements: derivation.i0.replacements, registeredInputDigest: derivation.i0.registeredInputDigest, blockedReason: blocked })
    if (COMPARABLE.includes(i0Run.row.status)) {
      const t = i0Run.facts?.plan.termination ?? null
      const e = d2d.D2D_I0_EXPECTED
      const mismatches = d2c.d2cI0Parity({ evaluationId: e.evaluationId, inputDigest: e.inputDigest, resultDigest: e.resultDigest, completed: e.completed, totalTargetCount: e.totalTargetCount, conflicts: e.conflicts,
        steps: e.steps, termination: e.termination }, { status: i0Run.row.status, inputDigest: i0Run.row.inputDigest, resultDigest: i0Run.facts?.resultDigest ?? null, termination: t?.status ?? null,
        completed: t?.completedTargetCount ?? null, totalTargetCount: t?.totalTargetCount ?? null, conflicts: i0Run.facts ? i0Run.facts.conflicts.length : null, steps: i0Run.facts?.plan.steps ?? null, r5Satisfied: i0Run.r5?.satisfied ?? null })
      if (mismatches.length > 0) abort(`d2c_parity I0: ${mismatches.join(', ')}`)
    }
    const i0Measured = i0Run.row.status === 'evaluated' && i0Run.facts !== null
    // PAIR 1 .. 6 (§4.4): every PAIR, each independent of the others.
    const pairRows = []
    for (const p of derivation.pairs) {
      const r = await evaluate({ evaluationId: p.evaluationId, stage: 'PAIR', pairOrdinal: p.pairOrdinal, t05Ordinal: p.t05Ordinal, t07Ordinal: p.t07Ordinal, replacements: p.replacements,
        registeredInputDigest: p.registeredInputDigest, blockedReason: blocked ?? (i0Measured ? null : 'i0_unmeasured') })
      pairRows.push(r)
    }

    await write(outputPath, { ...base, status: aborted !== null ? 'aborted_after_invalid' : smoke ? 'smoke' : 'completed', abortReason: aborted, runEnvelopeReached,
      inputValidation: { passed: true, issues: [], derivedPairs: derivation.pairs.map(p => ({ pairOrdinal: p.pairOrdinal, evaluationId: p.evaluationId, inputDigest: p.inputDigest })) },
      rv: rvRow, evaluations: evaluationRows, processes, wallMs: performance.now() - phaseStarted })
    const summary = r => r.facts ? `${r.facts.plan.termination?.completedTargetCount}/${r.facts.conflicts.length}/${r.facts.plan.steps} r5=${r.r5?.satisfied}` : r.row.status
    console.log(JSON.stringify({ output: resolve(outputPath), aborted, runEnvelopeReached, rv: rvRow.status, b0: summary(b0), i0: summary(i0Run),
      pairs: Object.fromEntries(pairRows.map(r => [r.row.evaluationId, summary(r)])), wallMs: performance.now() - phaseStarted }, null, 2))
  }
} finally {
  await server.close()
}
