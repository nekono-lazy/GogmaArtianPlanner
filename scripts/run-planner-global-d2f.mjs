// Issue #154 D2-F-B Research only: the t03 three-support K3 context discovery and the extension of the D2-D best incumbent
// (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md).
//
// Parent (default role). It reads the registered inputs (the D2-E / D2-D / D2-C / D2 RESULTs through their allowlists, the Phase
// 2-C2 RESULT baseline summary, the chained documents, the D2-E-A document, the 9 incumbent G store bodies, the 6 K1 CTX records,
// the D2-E CTX-K2 record and K2 c2 G store body, the D2-E / D2-D / D2-C attestation / raw) and the Export:
//   0. launch observation: repository HEAD, uncommitted benchmark code, the calculation code SHA-256, the D2-F document SHA-256 from
//      the HEAD git object, the registered policy SHA-256, the observed digest of every registered input, the Production audit;
//   1. START ATTESTATION: written once (`wx`, then read-only) into the new run dir BEFORE any child, read back and, for a formal
//      launch, verified (verifyD2FStartAttestation());
//   2. V: validateD2FInputs() (the §3.1 K3 derivation equal to the §3.2 table, the §8.1 I0 set equal to the D2-E-A §1.2 table, the
//      §8.2 WP set equal to its table). Any issue: no child is started, the raw output says `input_invalid`;
//   3. RV: one fresh `rv` child (10 minutes) - no Search, no full run; a guardrail violation aborts, an unmeasured RV leaves every
//      later item not_executed (rv_unmeasured);
//   4. B0 -> I0 -> WP: one fresh `evaluate` child each (30 minutes); a B0 / I0 / WP parity mismatch aborts; an unmeasured I0 leaves
//      every EXT not_executed (i0_unmeasured); an unmeasured WP leaves the d2e_wrapper parity not_checked (the run continues);
//   5. CTX-K3: one fresh `context` child (10 minutes), the record read back (reservationBody and the single reservations JSON
//      objects), C1 .. C8;
//   6. DSC L0 -> L1 -> L2: one fresh `discover` child per rung (60 minutes), escalating only after an extent bound with |pool| < 2;
//   7. ADM per pooled K3 Candidate, then EXT per admitted K3 Candidate (I0 set + 1): one fresh `evaluate` child each, no early stop.
// Concurrency 1, no retry, no fallback. The 5-hour discovery envelope stops new CTX / DSC children (`discovery_envelope_reached`),
// the 8-hour run envelope every new child (`run_envelope_reached`). Every row is appended to rv.jsonl / contexts.jsonl /
// discovery.jsonl / evaluations.jsonl with its record file SHA-256, so an interrupted run stays analyzable from the run dir alone.
// The oracle is never read (no oracle file, module or field).
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
  throw new Error('Usage: node scripts/run-planner-global-d2f.mjs --export <external Export .json> --run-dir <new dir .local> --output <new raw .json.local> [--allow-uncommitted --smoke-max-rung L0 --smoke-max-children N --smoke-budget-ms N --smoke-skip-evaluations]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-d2f.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
    d2f: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2F.ts'),
    d2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2.ts'),
    d1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (rv | context | discover | evaluate)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { d2f, d1, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const sample = () => { const maxima = tracker.sample(process.memoryUsage()); process.send?.({ type: 'memory', maxima, yields }) }
  const timer = setInterval(sample, d2f.D2F_EXECUTION_ENVELOPE.memorySampleIntervalMs)
  try {
    sample()
    const wrapper = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const rawExport = await readFile(exportPath)
    const exportSha256 = sha256(rawExport)
    const exportJson = JSON.parse(rawExport.toString('utf8'))
    const input = research.globalResearchInputFromExport(exportJson, d2f.D2F_RESEARCH_MAX_PLAN_STEPS)
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
      const wpRaw = existsSync(wrapper.wpGeneratedEntryPath) ? await readFile(wrapper.wpGeneratedEntryPath) : null
      result = d2f.runD2FReverification(input, exportJson.buildListEntries, schedule, wrapper.task, bodies, observed, wpRaw === null ? null : JSON.parse(wpRaw.toString('utf8')),
        wpRaw === null ? null : { bytes: wpRaw.length, sha256: sha256(wpRaw) }, dependencies, text => sha256(text))
    } else if (role === 'context') {
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      result = d2f.prepareD2FContextRecord(input, schedule, exportJson.buildListEntries, wrapper.task, dependencies, text => sha256(text))
    } else if (role === 'discover') {
      const task = wrapper.task
      const unit = await d2f.runD2FDiscoveryUnit(input, task, dependencies, { sha256OfText: text => sha256(text), yieldControl })
      if (Array.isArray(unit.pooled)) {
        for (const p of unit.pooled) {
          const file = d2f.d2fPoolFileName(task.contextId, p.indexInContext)
          const body = JSON.stringify(p.generatedEntry, null, 2) + '\n'
          await writeFile(join(wrapper.poolDir, file), body, { flag: 'wx' })
          p.generatedEntry = null
          p.generatedEntryFile = { file, bytes: Buffer.byteLength(body), sha256: sha256(body) }
        }
      }
      result = unit
    } else if (role === 'evaluate') {
      const task = wrapper.task
      inputDigest = d1.d1InputDigest(task.replacements.map(r => r.targetWeaponId), task.replacements.map(r => r.generatedBuildListEntryId), task.replacements.map(r => r.generatedEntrySha256), exportSha256)
      const { bodies, observed } = await readBodies(wrapper.generatedEntryPaths)
      result = await d2f.runD2FEvaluation(input, exportJson.buildListEntries, task, bodies, observed, dependencies, { sha256OfText: text => sha256(text), yieldControl })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, taskId: wrapper.task.unitId ?? wrapper.task.evaluationId, wallMs, scheduleMs, yields, exportSha256, inputDigest,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes, maxRssKiB: process.resourceUsage().maxRSS,
        heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, role === 'context')
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
// Non-formal smoke only: a top rung, a cap on started children, a shorter child budget, no evaluations.
const smokeMaxRung = option('--smoke-max-rung') ?? null
const smokeMaxChildren = option('--smoke-max-children') === undefined ? null : Number(option('--smoke-max-children'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smokeSkipEvaluations = args.includes('--smoke-skip-evaluations')
const smoke = smokeMaxRung !== null || smokeMaxChildren !== null || smokeBudgetMs !== null || smokeSkipEvaluations
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
  const { d2f, d2, d1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const specRaw = execFileSync('git', ['show', `HEAD:${d2f.D2F_SPEC_FILE}`], { maxBuffer: 1 << 28 })
  const specDocumentSha256 = sha256(specRaw)
  const registeredPolicySha256 = d2f.d2fRegisteredPolicySha256(text => sha256(text))
  // 0. The registered inputs, read and digested before anything is written or run (a missing file is null, never substituted).
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
  const observedInputs = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2f.D2F_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observedInputs[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const d2eProjection = d2f.projectD2FD2EResult(parse(buffers.d2eResult))
  const chainedDocuments = {}, observedDocuments = {}
  for (const key of d2f.d2fRegisteredConditions().chainedDocuments) {
    const ref = d2eProjection?.sources.documents[key] ?? null
    chainedDocuments[key] = ref?.sha256 ?? null
    const buffer = ref === null ? null : await readOptional(ref.file)
    observedDocuments[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const gStoreFiles = {}, observedGStoreFiles = {}, gStorePath = {}
  for (const f of d2f.d2fRegisteredConditions().gStoreFiles) {
    const key = `${f.label}-c${f.ordinal}`
    const path = join(f.runDir, f.file)
    gStorePath[key] = resolve(path)
    const buffer = await readOptional(path)
    observedGStoreFiles[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    gStoreFiles[key] = buffer === null ? null : { file: observedGStoreFiles[key], json: parse(buffer) }
  }
  const contextRecords = {}, observedContextRecords = {}
  for (const c of d2f.d2fRegisteredConditions().contextRecords) {
    const buffer = await readOptional(join(d2f.d2fRegisteredConditions().d2cProvenance.runDir, c.file))
    observedContextRecords[String(c.k)] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    contextRecords[c.k] = buffer === null ? null : { file: observedContextRecords[String(c.k)], json: parse(buffer) }
  }
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observedCalculationContext = research.globalResearchInputFromExport(exportJson, d2f.D2F_RESEARCH_MAX_PLAN_STEPS).calculationContext
  const baseMain = d2f.D2F_BASE_MAIN
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: d2f.d2fProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  const rngEngineVersion = new ProductionRngEngine().version
  if (rngEngineVersion !== d2f.D2F_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: re-register D2-F before running it (§11.2).')
  if (JSON.stringify(observedCalculationContext) !== JSON.stringify(d2f.D2F_CALCULATION_CONTEXT)) throw new Error('The CalculationContext moved: re-register D2-F before running it (§11.2).')
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, d2f.D2F_START_ATTESTATION_FILE)
  const envelope = { ...d2f.D2F_EXECUTION_ENVELOPE, ...(smokeBudgetMs === null ? {} : { rvBudgetMs: smokeBudgetMs, contextUnitBudgetMs: smokeBudgetMs, discoveryUnitBudgetMs: smokeBudgetMs, evaluationBudgetMs: smokeBudgetMs }) }
  const attestation = d2f.d2fStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead, uncommittedBenchmarkCode: uncommitted,
    benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, observedInputs, observedDocuments, observedGStoreFiles, observedContextRecords, exportFileName: basename(exportPath), productionAudit, machine,
    appliedExecutionEnvelope: envelope, rngEngineVersion, observedCalculationContext,
    smoke: smoke ? { maxRung: smokeMaxRung, maxChildren: smokeMaxChildren, budgetMs: smokeBudgetMs, skipEvaluations: smokeSkipEvaluations } : null })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = d2f.verifyD2FStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: d2f.d2fChainedExportSha256(parse(buffers.d2eResult)), chainedDocuments, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: d2f.D2F_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process for RV, CTX-K3, each DSC unit and each evaluation, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportFileName: basename(exportPath), rngEngineVersion,
    calculationContext: observedCalculationContext, appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: attestation.smoke }
  const base = { phase: 'Issue #154 D2-F-B: t03 three-support K3 context discovery and extension of the D2-D best incumbent (Node Research run, raw)', measuredAt: attestation.createdAt, environment, launchAttestation }
  const phaseStarted = performance.now()

  // 2. V (no child).
  const validation = d2f.validateD2FInputs({ files: observedInputs, documents: observedDocuments, gStoreFiles, contextRecords, d2eContextRecord: parse(buffers.d2eContextRecord),
    d2eWpGeneratedEntry: parse(buffers.d2eWpGeneratedEntry), d2eResult: parse(buffers.d2eResult), d2dResult: parse(buffers.d2dResult), d2cResult: parse(buffers.d2cResult), d2Result: parse(buffers.d2Result),
    phase2c2Result: parse(buffers.phase2c2Result), exportBuildListEntries: exportJson.buildListEntries, specMarkdown: specRaw.toString('utf8'),
    d2eSpecMarkdown: buffers.d2eSpecDocument === null ? '' : buffers.d2eSpecDocument.toString('utf8'), sha256OfText: text => sha256(text) })
  console.log(`V ${validation.passed ? `passed: ${validation.k3.contextId} I0=${validation.i0.inputDigest} WP=${validation.wp.evaluationId} ${validation.wp.inputDigest}` : `FAILED: ${validation.issues.join('; ')}`}`)
  if (!validation.passed) {
    await write(outputPath, { ...base, status: 'input_invalid', abortReason: null, discoveryEnvelopeReached: false, runEnvelopeReached: false, inputValidation: { passed: false, issues: validation.issues },
      rv: null, context: null, discovery: [], evaluations: [], processes: [], wallMs: performance.now() - phaseStarted })
    process.exitCode = 1
  } else {
    const { k3, i0, wp } = validation
    const d2cContexts = d2f.projectD2FD2CResult(parse(buffers.d2cResult), k3.label).contexts
    const processes = []
    const path = name => join(runDir, name)
    const rvPath = path('rv.jsonl'), contextsPath = path('contexts.jsonl'), discoveryPath = path('discovery.jsonl'), evaluationsPath = path('evaluations.jsonl')
    const MEASURED = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
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

    let aborted = null, discoveryEnvelopeReached = false, runEnvelopeReached = false, startedChildren = 0
    const abort = reason => { if (aborted === null) { aborted = reason; console.log(`ABORT ${reason}`) } }
    /** `discovery` items (CTX / DSC) also stop at the discovery envelope; RV and evaluations only at the run envelope. */
    const skipReason = (kind, rung = null) => {
      if (aborted !== null) return 'aborted_after_invalid'
      const elapsed = performance.now() - phaseStarted
      if (elapsed >= envelope.runBudgetMs) { runEnvelopeReached = true; if (kind === 'discovery') discoveryEnvelopeReached = true; return 'run_envelope_reached' }
      if (kind === 'discovery' && elapsed >= envelope.discoveryEnvelopeMs) { discoveryEnvelopeReached = true; return 'discovery_envelope_reached' }
      if (smokeMaxRung !== null && rung !== null && d2f.D2F_LADDER.findIndex(r => r.id === rung) > d2f.D2F_LADDER.findIndex(r => r.id === smokeMaxRung)) return 'smoke_skipped'
      if (smokeSkipEvaluations && kind === 'evaluation') return 'smoke_skipped'
      if (smokeMaxChildren !== null && startedChildren >= smokeMaxChildren) return 'smoke_cap'
      return null
    }

    // 3. RV (§9.1)
    const rvTask = d2f.d2fReverificationTask(validation, d2cContexts)
    const rvRow = { unitId: d2f.D2F_RV_UNIT_ID, status: null, notExecutedReason: null, process: null, recordFile: null }
    const rvSkip = skipReason('rv')
    if (rvSkip !== null) { rvRow.status = 'not_executed'; rvRow.notExecutedReason = rvSkip }
    else {
      startedChildren += 1
      const paths = rvTask.d2d.candidates.map(c => gStorePath[`${c.label}-c${c.ordinal}`])
      const run = await runChild(d2f.D2F_RV_UNIT_ID, 'rv', { task: rvTask, generatedEntryPaths: paths, wpGeneratedEntryPath: resolve(d2f.D2F_REGISTERED_INPUTS.d2eWpGeneratedEntry.file) },
        envelope.rvBudgetMs, d2f.D2F_RV_RECORD_FILE)
      rvRow.process = processRow(run.entry)
      rvRow.recordFile = run.recordFile
      rvRow.status = run.entry.outcome !== 'completed' ? run.entry.outcome : run.record.result.status
      if (rvRow.status === 'guardrail_violation') abort(`guardrail RV: ${JSON.stringify(run.record.result.issues)}`)
      if (run.record !== null && run.record.result?.baseline?.conflictResolutions !== 0) abort('guardrail RV: G1')
      console.log(`${run.entry.endedAt} RV ${rvRow.status} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
    }
    appendFileSync(rvPath, JSON.stringify(rvRow) + '\n')
    const rvVerified = rvRow.status === 'verified'
    const rvBlocked = rvVerified ? null : 'rv_unmeasured'

    // Evaluations: one registered evaluation is a not_executed row or one fresh child. Returns { row, facts, r5 }.
    const evaluationRows = []
    const evaluate = async (spec) => {
      const task = d2f.d2fEvaluationTask(validation, spec.evaluationId, spec.stage, spec.ordinal, spec.replacements, spec.newSupportAuthority ?? null)
      const row = { evaluationId: spec.evaluationId, stage: spec.stage, evaluatedAgainst: task.evaluatedAgainst, ordinal: spec.ordinal, replacementTargets: task.replacements.map(r => r.targetWeaponId),
        generatedEntryIds: task.replacements.map(r => r.generatedBuildListEntryId), generatedEntrySha256s: task.replacements.map(r => r.generatedEntrySha256),
        requiresSupport: [...new Set(task.replacements.flatMap(r => r.requiresSupport))].sort(), inputDigest: null, registeredInputDigest: spec.registeredInputDigest, status: null, notExecutedReason: null,
        process: null, recordFile: null, runner: null }
      const finish = (facts, r5) => { evaluationRows.push(row); appendFileSync(evaluationsPath, JSON.stringify(row) + '\n'); return { row, facts, r5 } }
      if (spec.reusedExisting) { row.status = 'not_run_reused_existing'; return finish(null, null) }
      const skip = spec.blockedReason ?? skipReason('evaluation')
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip; return finish(null, null) }
      row.inputDigest = d1.d1InputDigest(row.replacementTargets, row.generatedEntryIds, row.generatedEntrySha256s, validation.exportSha256)
      if (spec.registeredInputDigest !== null && row.inputDigest !== spec.registeredInputDigest) { abort(`guardrail ${spec.evaluationId}: inputDigest ${row.inputDigest} is not the registered ${spec.registeredInputDigest}`); row.status = 'not_executed'; row.notExecutedReason = 'aborted_after_invalid'; return finish(null, null) }
      startedChildren += 1
      const run = await runChild(spec.evaluationId, 'evaluate', { task, generatedEntryPaths: task.replacements.map(r => spec.pathOf(r)) }, envelope.evaluationBudgetMs, d2f.d2fEvaluationRecordFile(spec.evaluationId))
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const facts = result !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(result.status) ? result : null
      const r5 = d1.judgeD1R5({ status: row.status, evaluatedAgainst: task.evaluatedAgainst, generatedBuildListEntryIds: row.generatedEntryIds, requiresSupport: row.requiresSupport, facts })
      const r6 = d2.judgeD2R6({ status: row.status, evaluatedAgainst: task.evaluatedAgainst, facts, r5Satisfied: r5.satisfied })
      if (row.status === 'guardrail_violation' || (facts !== null && facts.runConflictResolutions !== 0)) abort(`guardrail ${spec.evaluationId}: ${JSON.stringify(result?.issues ?? 'G1')}`)
      if (run.record !== null && run.record.inputDigest !== row.inputDigest) abort(`guardrail ${spec.evaluationId}: the child inputDigest ${run.record.inputDigest} is not the runner one`)
      row.runner = { r5, r6, boundLimited: d1.isD1BoundLimited(row.status, facts) }
      if (spec.admission) row.runner.r1 = d2.d2R1R4(row.status, facts, row.generatedEntryIds[0], row.requiresSupport, spec.admission).R1
      console.log(`${run.entry.endedAt} ${spec.evaluationId} ${row.status}${facts ? ` steps=${facts.plan.steps} completed=${facts.plan.termination?.completedTargetCount ?? '-'} conflicts=${facts.conflicts.length} runs=${facts.fullRunsStarted} selected=${facts.plan.selectedBuildListEntryIds.length}` : ''} r5=${r5.satisfied} r6=${r6.satisfied} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
      return finish(facts, r5)
    }
    const incumbentPath = r => { const ref = i0.replacements.find(x => x.generatedBuildListEntryId === r.generatedBuildListEntryId); return gStorePath[`${ref.label}-c${ref.ordinal}`] }

    // 4. B0 -> I0 -> WP (§8.1 / §8.2, parity before the discovery)
    const b0 = await evaluate({ evaluationId: 'B0', stage: 'B0', ordinal: null, replacements: [], registeredInputDigest: validation.expected.b0.inputDigest, blockedReason: rvBlocked, pathOf: incumbentPath })
    if (COMPARABLE.includes(b0.row.status)) {
      const p = d1.d1B0Parity(b0.facts?.baselineSummary ?? null, validation.phase2c2BaselineSummary)
      const t = b0.facts?.plan.termination ?? null
      const e = validation.expected.b0
      if (b0.row.status !== 'evaluated' || !p.matched || b0.facts.resultDigest !== e.resultDigest || b0.row.inputDigest !== e.inputDigest || t?.status !== e.termination || t?.completedTargetCount !== e.completed
        || t?.totalTargetCount !== e.totalTargetCount || b0.facts.conflicts.length !== e.conflicts || b0.facts.plan.steps !== e.steps) abort(`baseline_parity_mismatch B0: ${b0.row.status} ${p.mismatches.join(', ')}`)
    }
    const i0Replacements = i0.replacements.map(r => d2f.d2fIncumbentReplacement(validation, r))
    const i0Run = await evaluate({ evaluationId: 'I0', stage: 'I0', ordinal: null, replacements: i0Replacements, registeredInputDigest: i0.registeredInputDigest, blockedReason: rvBlocked, pathOf: incumbentPath })
    if (COMPARABLE.includes(i0Run.row.status)) {
      const t = i0Run.facts?.plan.termination ?? null
      const e = validation.expected.i0
      const mismatches = []
      if (i0Run.row.status !== 'evaluated') mismatches.push(`status ${i0Run.row.status}`)
      if (i0Run.row.inputDigest !== e.inputDigest) mismatches.push('inputDigest')
      if (i0Run.facts?.resultDigest !== e.resultDigest) mismatches.push('resultDigest')
      if (t?.status !== e.termination || (t?.reachedLimits ?? []).length !== 0) mismatches.push('termination')
      if (t?.completedTargetCount !== e.completed || t?.totalTargetCount !== e.totalTargetCount) mismatches.push('completed / total')
      if (i0Run.facts?.conflicts.length !== e.conflicts) mismatches.push('Conflicts')
      if (i0Run.facts?.plan.steps !== e.steps) mismatches.push('steps')
      if (i0Run.r5?.satisfied !== true) mismatches.push('R5')
      if (i0Run.facts?.resourceConflictRejections !== e.resourceConflictRejections) mismatches.push('resource_conflict')
      if (!e.supportsSelected.every(s => i0Run.facts?.plan.selectedBuildListEntryIds.includes(s))) mismatches.push('supports selected')
      if (!i0Run.facts?.plan.selectedBuildListEntryIds.includes(validation.newSupport.supportBuildListEntryId) || !i0Run.facts?.selectedTargetWeaponIds.includes(validation.newSupport.supportTargetWeaponId)) mismatches.push('the new support / its Target selected (d2e_i0)')
      if (mismatches.length > 0) abort(`d2d_parity I0: ${mismatches.join(', ')}`)
    }
    const i0Measured = i0Run.row.status === 'evaluated' && i0Run.facts !== null
    const wpRep = d2f.d2fWpReplacement(validation)
    const wpPath = r => r.generatedBuildListEntryId === wpRep.generatedBuildListEntryId ? resolve(d2f.D2F_REGISTERED_INPUTS.d2eWpGeneratedEntry.file) : incumbentPath(r)
    const wpRun = await evaluate({ evaluationId: wp.evaluationId, stage: 'WP', ordinal: null, replacements: [...i0Replacements, wpRep], registeredInputDigest: wp.registeredInputDigest, blockedReason: rvBlocked, pathOf: wpPath })
    if (COMPARABLE.includes(wpRun.row.status)) {
      const t = wpRun.facts?.plan.termination ?? null
      const e = validation.expected.wp
      const mismatches = []
      if (wpRun.row.status !== 'evaluated') mismatches.push(`status ${wpRun.row.status}`)
      if (wpRun.row.inputDigest !== e.inputDigest) mismatches.push('inputDigest')
      if (wpRun.facts?.resultDigest !== e.resultDigest) mismatches.push('resultDigest')
      if (t?.status !== e.termination) mismatches.push('termination')
      if (t?.completedTargetCount !== e.completed || t?.totalTargetCount !== e.totalTargetCount) mismatches.push('completed / total')
      if (wpRun.facts?.conflicts.length !== e.conflicts) mismatches.push('Conflicts')
      if (wpRun.facts?.plan.steps !== e.steps) mismatches.push('steps')
      if (wpRun.r5?.satisfied !== e.r5Satisfied) mismatches.push('R5')
      if (mismatches.length > 0) abort(`wrapper_parity ${wp.evaluationId}: ${mismatches.join(', ')}`)
    }

    // 5. CTX-K3 (§5.1)
    const contextRow = { unitId: d2f.D2F_CONTEXT_UNIT_ID, contextId: k3.contextId, status: null, notExecutedReason: null, process: null, recordFile: null }
    let ctxRecord = null, ctxRecordSha256 = null
    const k1Ref = c => ({ supportBuildListEntryId: c.supportBuildListEntryId, k: c.k, contextId: c.contextId, recordSha256: c.recordSha256, reservationBody: c.reservationBody, reservationDigest: c.reservationDigest,
      originDigest: c.originDigest, excludedRouteKeySha256s: c.excludedRouteKeySha256s })
    const k1Contexts = k3.k1Contexts.map(k1 => validation.contexts.find(x => x.k === k1.k))
    const ctxSkip = rvBlocked ?? skipReason('discovery')
    if (ctxSkip !== null) { contextRow.status = 'not_executed'; contextRow.notExecutedReason = ctxSkip }
    else {
      startedChildren += 1
      const k2c = validation.k2Context
      const task = { unitId: d2f.D2F_CONTEXT_UNIT_ID, contextId: k3.contextId, label: k3.label, targetWeaponId: k3.targetWeaponId, currentBuildListEntryId: k3.currentBuildListEntryId,
        supportBuildListEntryIds: k3.supportBuildListEntryIds, newSupportBuildListEntryId: k3.addedSupportBuildListEntryId, e1TargetWeaponIds: validation.e1.targetWeaponIds,
        e1CurrentBuildListEntryIds: validation.e1.currentBuildListEntryIds, registeredReservationDigest: d2f.D2F_K3_RESERVATION_DIGEST, registeredReservationBody: validation.registeredReservationBody,
        registeredNewSupportReservationDigest: d2f.D2F_NEW_SUPPORT_RESERVATION_DIGEST, registeredNewSupportReservationBody: validation.registeredNewSupportReservationBody,
        k1Contexts: k1Contexts.map(k1Ref), k1SupportRecords: validation.contexts.filter(c => k3.k2SupportBuildListEntryIds.includes(c.supportBuildListEntryId)).sort((a, b) => a.k - b.k).map(k1Ref),
        k2Context: { recordSha256: k2c.recordSha256, reservationBody: k2c.reservationBody, reservationDigest: k2c.reservationDigest, originDigest: k2c.originDigest, excludedRouteKeySha256s: k2c.excludedRouteKeySha256s },
        registeredResourceIdentities: [...validation.resourceIdentities.k2Failure, ...validation.resourceIdentities.priorT03], researchMaxPlanSteps: d2f.D2F_RESEARCH_MAX_PLAN_STEPS }
      const run = await runChild(d2f.D2F_CONTEXT_UNIT_ID, 'context', { task }, envelope.contextUnitBudgetMs, d2f.D2F_CONTEXT_RECORD_FILE)
      contextRow.process = processRow(run.entry)
      contextRow.recordFile = run.recordFile
      contextRow.status = run.entry.outcome !== 'completed' ? run.entry.outcome : run.record.result.status
      if (contextRow.status === 'context_ready' || contextRow.status === 'guardrail_violation') {
        // Read the CTX-K3 record back from its file against the journal digest: reservationBody and every single body must be JSON objects (§5.1).
        const raw = await readFile(path(contextRow.recordFile.file))
        const read = d2f.readD2FK3ContextRecord(JSON.parse(raw.toString('utf8')))
        if (sha256(raw) !== contextRow.recordFile.sha256 || read.issue !== null) abort(`evidence CTX-K3: ${read.issue ?? 'the CTX-K3 record is not the one journaled'}`)
        else if (contextRow.status === 'guardrail_violation') abort(`guardrail CTX-K3: ${JSON.stringify(read.record.issues)} ${JSON.stringify(read.record.checks)}`)
        else if (read.record.checks.C5.state !== 'matched') abort(`k3_context_parity CTX-K3 C5: ${JSON.stringify(read.record.checks.C5)}`)
        else if (read.record.checks.C8.state !== 'matched') abort(`k3_context_parity CTX-K3 C8: ${JSON.stringify({ ...read.record.checks.C8, perExistingSupport: undefined })}`)
        else { ctxRecord = read.record; ctxRecordSha256 = contextRow.recordFile.sha256 }
      }
      console.log(`${run.entry.endedAt} CTX-K3 ${k3.contextId} ${contextRow.status} digest=${ctxRecord?.reservationDigest ?? '-'} C5=${ctxRecord?.checks.C5.state ?? '-'} C8=${ctxRecord?.checks.C8.state ?? '-'} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
    }
    appendFileSync(contextsPath, JSON.stringify(contextRow) + '\n')
    const newSupportAuthority = ctxRecord === null ? null : d2f.d2fNewSupportAuthority(ctxRecord)

    // 6. DSC L0 -> L1 -> L2 (§5.2 - §5.6)
    const discoveryRows = []
    const pool = []
    let discoveryStop = null
    let rung = 'L0'
    const dependency = rvBlocked ?? (ctxRecord === null ? 'dependency_unmeasured' : null)
    if (dependency !== null) {
      for (const r of d2f.D2F_LADDER) {
        const row = { unitId: d2f.d2fDiscoveryUnitId(r.id), contextId: k3.contextId, rung: r.id, status: 'not_executed', notExecutedReason: dependency, process: null, recordFile: null }
        discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
      }
      discoveryStop = 'not_executed'
      rung = null
    }
    const singleReservations = ctxRecord === null ? [] : k3.supportBuildListEntryIds.map(s => s === k3.addedSupportBuildListEntryId
      ? { supportBuildListEntryId: s, source: 'ctx_k3_single', k: null, reservationBody: ctxRecord.singleSupportReservations[s].reservationBody }
      : (() => { const c = k1Contexts.find(x => x.supportBuildListEntryId === s); return { supportBuildListEntryId: s, source: 'k1_ctx_record', k: c.k, reservationBody: c.reservationBody } })())
    while (rung !== null) {
      const unitId = d2f.d2fDiscoveryUnitId(rung)
      const row = { unitId, contextId: k3.contextId, rung, status: null, notExecutedReason: null, process: null, recordFile: null }
      const skip = skipReason('discovery', rung)
      if (skip !== null) {
        row.status = 'not_executed'; row.notExecutedReason = skip
        discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
        discoveryStop = 'not_executed'
        break
      }
      startedChildren += 1
      const task = { unitId, contextId: k3.contextId, label: k3.label, targetWeaponId: k3.targetWeaponId, supportBuildListEntryIds: k3.supportBuildListEntryIds, currentBuildListEntryId: k3.currentBuildListEntryId,
        rung, extent: d2f.d2fRungExtent(rung),
        context: { recordSha256: ctxRecordSha256, reservationBody: ctxRecord.reservationBody, reservationDigest: ctxRecord.reservationDigest, originDigest: ctxRecord.originDigest, excludedRouteKeys: ctxRecord.excludedRouteKeys },
        k2Reservation: { reservationBody: validation.k2Context.reservationBody, reservationDigest: validation.k2Context.reservationDigest }, singleReservations,
        poolKeysAtStart: pool.map(p => p.candidateStableKey), d2bK0Pool: validation.d2bK0Pool, d2cK1Pool: validation.d2cK1Pool, d2eK2Pool: validation.d2eK2Pool, poolCap: d2f.D2F_K3_POOL_CAP,
        researchMaxPlanSteps: d2f.D2F_RESEARCH_MAX_PLAN_STEPS }
      const run = await runChild(unitId, 'discover', { task, poolDir: resolve(runDir) }, envelope.discoveryUnitBudgetMs, d2f.d2fDiscoveryRecordFile(rung))
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const measured = d2f.D2F_DISCOVERY_MEASURED.includes(row.status)
      if (measured) {
        for (const p of result.pooled) {
          const raw = await readFile(path(p.generatedEntryFile.file))
          if (sha256(raw) !== p.generatedEntryFile.sha256) abort(`evidence ${unitId}: the G store body is not the one the child recorded`)
          pool.push({ ...p, file: p.generatedEntryFile.file, sha256: p.generatedEntryFile.sha256, unitId, rung, ordinal: pool.length + 1 })
        }
      }
      if (row.status === 'guardrail_violation') abort(`guardrail ${unitId}: ${JSON.stringify(result.issues)}`)
      discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
      console.log(`${run.entry.endedAt} ${unitId} ${row.status}${measured ? ` delivered=${result.search.deliveredCandidates} actions=${result.deliveries.map(d => d.action).join(',') || '-'} pool=${pool.length}` : ''} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
      const next = measured ? d2f.d2fDiscoveryNext(row.status, rung, pool.length) : { next: null, stop: 'unmeasured' }
      discoveryStop = next.stop
      // An escalation after an abort becomes one `aborted_after_invalid` row (skipReason) and stops the discovery.
      rung = next.next
    }

    // 7. ADM (§7), then EXT (§8.3)
    const poolPath = r => resolve(runDir, r.generatedEntryFile)
    const k3Ref = p => d2f.d2fK3Replacement(validation, { contextId: k3.contextId, reservationDigest: ctxRecord.reservationDigest, reservationBody: ctxRecord.reservationBody },
      { ordinal: p.ordinal, generatedBuildListEntryId: p.generatedBuildListEntryId, file: p.file, sha256: p.sha256, searchReservationDigest: p.reservationDigest })
    const admitted = [], admissionUnmeasured = []
    for (const p of pool) {
      const admission = { reusedExisting: p.reusedExisting, replacementReady: p.reusedExisting || (p.replacement.status === 'ready' && p.replacement.replacedBuildListEntryId === k3.currentBuildListEntryId) }
      const rep = k3Ref(p)
      const r = await evaluate({ evaluationId: d2f.d2fAdmissionId(k3.label, p.ordinal), stage: 'ADM', ordinal: p.ordinal, replacements: [rep], registeredInputDigest: null, reusedExisting: p.reusedExisting,
        admission, blockedReason: rvBlocked, newSupportAuthority, pathOf: () => poolPath(rep) })
      if (!MEASURED.includes(r.row.status)) admissionUnmeasured.push(p.ordinal)
      if (d2.d2R1R4(r.row.status, r.facts, p.generatedBuildListEntryId, k3.supportBuildListEntryIds, admission).R1) admitted.push(p)
    }
    const extensionRows = []
    for (const p of pool.filter(x => admitted.includes(x) || admissionUnmeasured.includes(x.ordinal))) {
      const rep = k3Ref(p)
      const blocked = rvBlocked ?? (admissionUnmeasured.includes(p.ordinal) ? 'dependency_unmeasured' : i0Measured ? null : 'i0_unmeasured')
      const r = await evaluate({ evaluationId: d2f.d2fExtensionId(k3.label, p.ordinal), stage: 'EXT', ordinal: p.ordinal, replacements: [...i0Replacements, rep], registeredInputDigest: null,
        blockedReason: blocked, newSupportAuthority, pathOf: x => x.generatedBuildListEntryId === rep.generatedBuildListEntryId ? poolPath(rep) : incumbentPath(x) })
      extensionRows.push(r)
    }

    await write(outputPath, { ...base, status: aborted !== null ? 'aborted_after_invalid' : smoke ? 'smoke' : 'completed', abortReason: aborted, discoveryEnvelopeReached, runEnvelopeReached,
      inputValidation: { passed: true, issues: [], k3ContextId: k3.contextId, i0InputDigest: i0.inputDigest, wpEvaluationId: wp.evaluationId, wpInputDigest: wp.inputDigest }, rv: rvRow, context: contextRow,
      discovery: discoveryRows, discoveryStop, evaluations: evaluationRows, processes, wallMs: performance.now() - phaseStarted })
    const summary = r => r.facts ? `${r.facts.plan.termination?.completedTargetCount}/${r.facts.conflicts.length}/${r.facts.plan.steps} r5=${r.r5?.satisfied}` : r.row.status
    console.log(JSON.stringify({ output: resolve(outputPath), aborted, discoveryEnvelopeReached, runEnvelopeReached, rv: rvRow.status, b0: summary(b0), i0: summary(i0Run), wp: summary(wpRun), context: contextRow.status,
      discovery: discoveryRows.map(r => `${r.unitId}:${r.status}`), discoveryStop, pooled: pool.length, admitted: admitted.length,
      extensions: Object.fromEntries(extensionRows.map(r => [r.row.evaluationId, summary(r)])), wallMs: performance.now() - phaseStarted }, null, 2))
  }
} finally {
  await server.close()
}
