// Issue #154 D2-C-B Research only: winner-derived limited K1 discovery and set evaluation
// (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md).
//
// Parent (default role). It reads the registered inputs (the manifest, the D2 / Phase B RESULTs through their allowlists, the Phase
// 2-C2 RESULT baseline summary, the D1-A / D2-C documents, the five D2-B G store bodies, the ten Phase B K1 task / record files) and
// the Export:
//   0. launch observation: repository HEAD, uncommitted benchmark code, the calculation code SHA-256, the D2-C document SHA-256 from
//      the HEAD git object, the registered policy SHA-256, the observed digest of every registered input, the Production audit;
//   1. START ATTESTATION: written once (`wx`, then read-only) into the new run dir BEFORE any child, read back and, for a formal
//      launch, verified (verifyD2CStartAttestation());
//   2. V: validateD2CInputs() (the §3.1 derivation equal to the §3.2 table). Any issue: no child is started, the raw output says
//      `input_invalid`;
//   3. B0 -> I0: one fresh `evaluate` child each (30 minutes); a parity mismatch aborts before the discovery;
//   4. CTX k = 1 -> 7: one fresh `context` child each (10 minutes) writing CTX-<k>.context.json;
//   5. DSC rung-major (L0 k = 1 -> 7, then L1, then L2): one fresh `discover` child per unit (60 minutes, heap 12,288 MB);
//   6. ADM -> CMP: one fresh `evaluate` child per evaluation (30 minutes), concurrency 1, no retry, no fallback.
// A guardrail violation, a B0 / I0 parity mismatch or a CTX C5 mismatch aborts the run: every remaining registered item is
// `not_executed` (aborted_after_invalid). The 9-hour discovery envelope stops new CTX / DSC children (`discovery_envelope_reached`),
// the 12-hour run envelope every new child (`run_envelope_reached`). Every row is appended to contexts.jsonl / discovery.jsonl /
// evaluations.jsonl / composition.jsonl with its record file SHA-256, so an interrupted run stays analyzable from the run dir alone.
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
  throw new Error('Usage: node scripts/run-planner-global-d2c.mjs --export <external Export .json> --run-dir <new dir .local> --output <new raw .json.local> [--allow-uncommitted --smoke-contexts 1,5 --smoke-max-rung L0 --smoke-max-children N --smoke-budget-ms N --smoke-skip-evaluations]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-d2c.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
    d2c: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2C.ts'),
    d1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1.ts'),
    d2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (context | discover | evaluate)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { d2c, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const sample = () => { const maxima = tracker.sample(process.memoryUsage()); process.send?.({ type: 'memory', maxima, yields }) }
  const timer = setInterval(sample, d2c.D2C_EXECUTION_ENVELOPE.memorySampleIntervalMs)
  try {
    sample()
    const wrapper = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const exportJson = JSON.parse((await readFile(exportPath)).toString('utf8'))
    const input = research.globalResearchInputFromExport(exportJson, d2c.D2C_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    let result, scheduleMs = null
    if (role === 'context') {
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      result = d2c.prepareD2CContextRecord(input, schedule, exportJson.buildListEntries, wrapper.task, dependencies, text => sha256(text))
    } else if (role === 'discover') {
      const task = wrapper.task
      const unit = await d2c.runD2CDiscoveryUnit(input, task, dependencies, { sha256OfText: text => sha256(text), yieldControl })
      if (Array.isArray(unit.pooled)) {
        for (const p of unit.pooled) {
          const file = d2c.d2cPoolFileName(task.contextId, p.indexInContext)
          const body = JSON.stringify(p.generatedEntry, null, 2) + '\n'
          await writeFile(join(wrapper.poolDir, file), body, { flag: 'wx' })
          p.generatedEntry = null
          p.generatedEntryFile = { file, bytes: Buffer.byteLength(body), sha256: sha256(body) }
        }
      }
      result = unit
    } else if (role === 'evaluate') {
      const generated = []
      let guardrail = null
      wrapper.task.replacements.forEach((r, i) => { if (wrapper.generatedEntryPaths[i] === undefined) guardrail = `no G store path for ${r.generatedEntryFile}` })
      for (const [i, r] of wrapper.task.replacements.entries()) {
        if (guardrail !== null) break
        const raw = await readFile(wrapper.generatedEntryPaths[i])
        if (basename(wrapper.generatedEntryPaths[i]) !== r.generatedEntryFile || sha256(raw) !== r.generatedEntrySha256) { guardrail = `the G store body ${r.generatedEntryFile} is not the registered one`; break }
        generated.push(JSON.parse(raw.toString('utf8')))
      }
      result = guardrail !== null ? { status: 'guardrail_violation', issues: [guardrail] }
        : await d2c.runD2CEvaluation(input, exportJson.buildListEntries, wrapper.task, generated, dependencies, { sha256OfText: text => sha256(text), yieldControl })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, taskId: wrapper.task.unitId ?? wrapper.task.evaluationId, wallMs, scheduleMs, yields,
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
// Non-formal smoke only: a subset of the contexts (by k), a top rung, a cap on started children, a shorter child budget, no evaluations.
const smokeContexts = option('--smoke-contexts') === undefined ? null : option('--smoke-contexts').split(',').map(Number)
const smokeMaxRung = option('--smoke-max-rung') ?? null
const smokeMaxChildren = option('--smoke-max-children') === undefined ? null : Number(option('--smoke-max-children'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smokeSkipEvaluations = args.includes('--smoke-skip-evaluations')
const smoke = smokeContexts !== null || smokeMaxRung !== null || smokeMaxChildren !== null || smokeBudgetMs !== null || smokeSkipEvaluations
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
  const { d2c, d1, d2, research, c26a, ProductionRngEngine } = await loadModules(server)
  const specRaw = execFileSync('git', ['show', `HEAD:${d2c.D2C_SPEC_FILE}`], { maxBuffer: 1 << 28 })
  const specDocumentSha256 = sha256(specRaw)
  const registeredPolicySha256 = d2c.d2cRegisteredPolicySha256(text => sha256(text))
  // 0. The registered inputs, read and digested before anything is written or run (a missing file is null, never substituted).
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
  const observedInputs = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2c.D2C_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observedInputs[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const observedI0Files = {}, i0Files = {}
  for (const f of d2c.D2C_I0_FILES) {
    const buffer = await readOptional(join(d2c.D2C_D2B_RUN_DIR, f.file))
    observedI0Files[f.file] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    i0Files[f.file] = buffer === null ? null : { file: observedI0Files[f.file], json: parse(buffer) }
  }
  const observedPhaseBFiles = {}, phaseBTasks = {}, phaseBRecords = {}
  for (const u of d2c.D2C_PHASE_B_UNITS) {
    for (const [kind, name, target] of [['task', d2c.d2cPhaseBTaskFileName(u.unitId), phaseBTasks], ['record', d2c.d2cPhaseBRecordFileName(u.unitId), phaseBRecords]]) {
      const buffer = await readOptional(join(d2c.D2C_PHASE_B_RUN_DIR, name))
      const key = d2c.d2cPhaseBFileKey(u.unitId, kind)
      observedPhaseBFiles[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
      target[u.unitId] = buffer === null ? null : { file: observedPhaseBFiles[key], json: parse(buffer) }
    }
  }
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observedCalculationContext = research.globalResearchInputFromExport(exportJson, d2c.D2C_RESEARCH_MAX_PLAN_STEPS).calculationContext
  const baseMain = d2c.D2C_BASE_MAIN
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: d2c.d2cProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  const rngEngineVersion = new ProductionRngEngine().version
  if (rngEngineVersion !== d2c.D2C_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: re-register D2-C before running it (§10.2).')
  if (JSON.stringify(observedCalculationContext) !== JSON.stringify(d2c.D2C_CALCULATION_CONTEXT)) throw new Error('The CalculationContext moved: re-register D2-C before running it (§10.2).')
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, d2c.D2C_START_ATTESTATION_FILE)
  const envelope = { ...d2c.D2C_EXECUTION_ENVELOPE, ...(smokeBudgetMs === null ? {} : { contextUnitBudgetMs: smokeBudgetMs, discoveryUnitBudgetMs: smokeBudgetMs, evaluationBudgetMs: smokeBudgetMs }) }
  const attestation = d2c.d2cStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead, uncommittedBenchmarkCode: uncommitted,
    benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, observedInputs, observedI0Files, observedPhaseBFiles, exportFileName: basename(exportPath), productionAudit, machine,
    appliedExecutionEnvelope: envelope, rngEngineVersion, observedCalculationContext,
    smoke: smoke ? { contextKs: smokeContexts, maxChildren: smokeMaxChildren, budgetMs: smokeBudgetMs, maxRung: smokeMaxRung, skipEvaluations: smokeSkipEvaluations } : null })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  const chainedExport = d2c.d2cChainedExportSha256(parse(buffers.phaseBResult))
  if (!smoke && !uncommitted) {
    const check = d2c.verifyD2CStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256,
      exportSha256: chainedExport, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: d2c.D2C_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per context / discovery unit / evaluation, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportFileName: basename(exportPath), rngEngineVersion,
    calculationContext: observedCalculationContext, appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: attestation.smoke }
  const base = { phase: 'Issue #154 D2-C-B: winner-derived limited K1 discovery and set evaluation (Node Research run, raw)', measuredAt: attestation.createdAt, environment, launchAttestation }
  const phaseStarted = performance.now()

  // 2. V (no child).
  const validation = d2c.validateD2CInputs({ files: observedInputs, manifest: parse(buffers.phaseBTargets), d2Result: parse(buffers.d2Result), phaseBResult: parse(buffers.phaseBResult),
    phase2c2Result: parse(buffers.phase2c2Result), i0Files, phaseBTasks, phaseBRecords, exportBuildListEntries: exportJson.buildListEntries,
    specMarkdown: specRaw.toString('utf8'), d1SpecMarkdown: buffers.d1SpecDocument === null ? '' : buffers.d1SpecDocument.toString('utf8') })
  console.log(`V ${validation.passed ? `passed: ${validation.contexts.map(c => c.contextId).join(' ')}` : `FAILED: ${validation.issues.join('; ')}`}`)
  if (!validation.passed) {
    await write(outputPath, { ...base, status: 'input_invalid', abortReason: null, discoveryEnvelopeReached: false, runEnvelopeReached: false, inputValidation: { passed: false, issues: validation.issues },
      contexts: [], discovery: [], evaluations: [], composition: [], processes: [], wallMs: performance.now() - phaseStarted })
    process.exitCode = 1
  } else {
    const { contexts, scopeTargets, i0, d2: d2Reference } = validation
    const exportSha256 = validation.exportSha256
    const phase2c2Summary = validation.phase2c2BaselineSummary
    const processes = []
    const path = name => join(runDir, name)
    const contextsPath = path('contexts.jsonl'), discoveryPath = path('discovery.jsonl'), evaluationsPath = path('evaluations.jsonl'), compositionPath = path('composition.jsonl')
    const MEASURED = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
    const COMPARABLE = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']
    const DSC_MEASURED = d2c.D2C_DISCOVERY_MEASURED

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
    /** `discovery` items (CTX / DSC) also stop at the discovery envelope; evaluations only at the run envelope. */
    const skipReason = (kind, k = null, rung = null) => {
      if (aborted !== null) return 'aborted_after_invalid'
      const elapsed = performance.now() - phaseStarted
      if (elapsed >= envelope.runBudgetMs) { runEnvelopeReached = true; if (kind === 'discovery') discoveryEnvelopeReached = true; return 'run_envelope_reached' }
      if (kind === 'discovery' && elapsed >= envelope.discoveryEnvelopeMs) { discoveryEnvelopeReached = true; return 'discovery_envelope_reached' }
      if (smokeContexts !== null && k !== null && !smokeContexts.includes(k)) return 'smoke_skipped'
      if (smokeMaxRung !== null && rung !== null && d2c.D2C_LADDER.findIndex(r => r.id === rung) > d2c.D2C_LADDER.findIndex(r => r.id === smokeMaxRung)) return 'smoke_skipped'
      if (smokeSkipEvaluations && kind === 'evaluation') return 'smoke_skipped'
      if (smokeMaxChildren !== null && startedChildren >= smokeMaxChildren) return 'smoke_cap'
      return null
    }
    const label = r => r.label

    // 3. Evaluations: one registered evaluation is a not_executed row or one fresh child. Returns { row, facts, r5 }.
    const evaluationRows = [], compositionRows = []
    const evaluate = async (spec) => {
      const reps = [...spec.replacements].sort((a, b) => a.targetIndex - b.targetIndex)
      const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort()
      const evaluatedAgainst = d2c.d2cEvaluatedAgainst(spec.stage)
      const row = { evaluationId: spec.evaluationId, stage: spec.stage, evaluatedAgainst, label: spec.label, poolOrdinal: spec.poolOrdinal, contextId: spec.contextId,
        replacementLabels: reps.map(label), replacementTargets: reps.map(r => r.targetWeaponId), generatedEntryIds: reps.map(r => r.generatedBuildListEntryId),
        generatedEntrySha256s: reps.map(r => r.sha256), requiresSupport: support, inputDigest: null, status: null, notExecutedReason: null, process: null, recordFile: null, runner: null }
      const finish = (facts, r5) => { evaluationRows.push(row); appendFileSync(evaluationsPath, JSON.stringify(row) + '\n'); return { row, facts, r5 } }
      if (spec.reusedExisting) { row.status = 'not_run_reused_existing'; return finish(null, null) }
      const skip = spec.blockedReason ?? skipReason('evaluation')
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip; return finish(null, null) }
      startedChildren += 1
      row.inputDigest = d1.d1InputDigest(row.replacementTargets, row.generatedEntryIds, row.generatedEntrySha256s, exportSha256)
      const task = { evaluationId: spec.evaluationId, stage: spec.stage, evaluatedAgainst, researchMaxPlanSteps: d2c.D2C_RESEARCH_MAX_PLAN_STEPS, fullRunCap: d2c.D2C_EVALUATION_FULL_RUN_CAP,
        replacements: reps.map(r => ({ targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
          generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: [...r.requiresSupport], contextId: r.contextId, supportReservationDigest: r.supportReservationDigest,
          supportReservation: r.supportReservation, supportBodySha256: r.supportBodySha256 })) }
      const run = await runChild(spec.evaluationId, 'evaluate', { task, generatedEntryPaths: reps.map(r => join(r.fromD2B ? resolve(d2c.D2C_D2B_RUN_DIR) : resolve(runDir), r.file)) },
        envelope.evaluationBudgetMs, `${spec.evaluationId}.record.json`)
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const facts = result !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(result.status) ? result : null
      const r5 = d1.judgeD1R5({ status: row.status, evaluatedAgainst, generatedBuildListEntryIds: row.generatedEntryIds, requiresSupport: support, facts })
      const r6 = d2.judgeD2R6({ status: row.status, evaluatedAgainst, facts, r5Satisfied: r5.satisfied })
      if (row.status === 'guardrail_violation' || (facts !== null && facts.runConflictResolutions !== 0)) abort(`guardrail ${spec.evaluationId}: ${JSON.stringify(result?.issues ?? 'G1')}`)
      row.runner = { r5, r6, boundLimited: d1.isD1BoundLimited(row.status, facts) }
      if (spec.admission) row.runner.r1 = d2.d2R1R4(row.status, facts, row.generatedEntryIds[0], support, spec.admission).R1
      console.log(`${run.entry.endedAt} ${spec.evaluationId} ${row.status}${facts ? ` steps=${facts.plan.steps} completed=${facts.plan.termination?.completedTargetCount ?? '-'} conflicts=${facts.conflicts.length} runs=${facts.fullRunsStarted}` : ''} r5=${r5.satisfied} r6=${r6.satisfied} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
      return finish(facts, r5)
    }

    // B0 -> I0 (§6.1, parity before the discovery)
    const b0 = await evaluate({ evaluationId: 'B0', stage: 'B0', label: null, poolOrdinal: null, contextId: null, replacements: [] })
    if (COMPARABLE.includes(b0.row.status)) {
      const p = d1.d1B0Parity(b0.facts?.baselineSummary ?? null, phase2c2Summary)
      if (b0.row.status !== 'evaluated' || !p.matched || b0.facts.resultDigest !== d2Reference.b0.resultDigest || b0.row.inputDigest !== d2Reference.b0.inputDigest) abort(`baseline_parity_mismatch B0: ${b0.row.status} ${p.mismatches.join(', ')}`)
    }
    const i0Refs = i0.map(x => ({ label: x.label, targetIndex: x.targetIndex, targetWeaponId: x.targetWeaponId, currentBuildListEntryId: x.currentBuildListEntryId, generatedBuildListEntryId: x.generatedBuildListEntryId,
      sha256: x.sha256, file: x.file, requiresSupport: [], contextId: null, supportReservationDigest: null, supportReservation: null, supportBodySha256: null, poolOrdinal: x.ordinal, fromD2B: true }))
    const i0Run = await evaluate({ evaluationId: 'I0', stage: 'I0', label: null, poolOrdinal: null, contextId: null, replacements: i0Refs })
    if (COMPARABLE.includes(i0Run.row.status)) {
      const t = i0Run.facts?.plan.termination ?? null
      const mismatches = d2c.d2cI0Parity(d2Reference.i0, { status: i0Run.row.status, inputDigest: i0Run.row.inputDigest, resultDigest: i0Run.facts?.resultDigest ?? null, termination: t?.status ?? null,
        completed: t?.completedTargetCount ?? null, totalTargetCount: t?.totalTargetCount ?? null, conflicts: i0Run.facts ? i0Run.facts.conflicts.length : null, steps: i0Run.facts?.plan.steps ?? null, r5Satisfied: i0Run.r5?.satisfied ?? null })
      if (mismatches.length > 0) abort(`d2b_parity I0: ${mismatches.join(', ')}`)
    }
    const i0Measured = i0Run.row.status === 'evaluated' && i0Run.facts !== null

    // 4. CTX (§4.1)
    const contextRows = []
    const ctxRecords = new Map()
    for (const c of contexts) {
      const unitId = d2c.d2cContextUnitId(c.k)
      const row = { unitId, k: c.k, contextId: c.contextId, status: null, notExecutedReason: null, process: null, recordFile: null }
      const skip = skipReason('discovery', c.k)
      if (skip !== null) {
        row.status = 'not_executed'; row.notExecutedReason = skip
        contextRows.push(row); appendFileSync(contextsPath, JSON.stringify(row) + '\n')
        continue
      }
      startedChildren += 1
      const task = { unitId, contextId: c.contextId, k: c.k, label: c.label, targetWeaponId: c.targetWeaponId, currentBuildListEntryId: c.currentBuildListEntryId, supportBuildListEntryId: c.supportBuildListEntryId,
        e1TargetWeaponIds: validation.e1TargetWeaponIds, e1CurrentBuildListEntryIds: validation.e1CurrentBuildListEntryIds, registeredReservationDigest: c.registeredReservationDigest,
        phaseBReservations: c.phaseBUnits.map(u => ({ unitId: u.unitId, reservation: u.recordReservation })), researchMaxPlanSteps: d2c.D2C_RESEARCH_MAX_PLAN_STEPS }
      const run = await runChild(unitId, 'context', { task }, envelope.contextUnitBudgetMs, d2c.d2cContextRecordFileName(c.k))
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : run.record.result.status
      if (row.status === 'context_ready' || row.status === 'guardrail_violation') {
        // Read the CTX record back from its file against the journal digest: reservationBody must be a JSON object (§4.1).
        const raw = await readFile(path(row.recordFile.file))
        const read = d2c.readD2CContextRecord(JSON.parse(raw.toString('utf8')))
        if (sha256(raw) !== row.recordFile.sha256 || read.issue !== null) abort(`evidence ${unitId}: ${read.issue ?? 'the CTX record is not the one journaled'}`)
        else if (row.status === 'guardrail_violation') abort(`guardrail ${unitId}: ${JSON.stringify(read.record.issues)} ${JSON.stringify(read.record.checks)}`)
        else {
          ctxRecords.set(c.k, { record: read.record, recordSha256: row.recordFile.sha256 })
          if (read.record.checks.C5.state === 'mismatched') abort(`phase_b_k1_parity ${unitId}: ${JSON.stringify(read.record.checks.C5)}`)
        }
      }
      contextRows.push(row); appendFileSync(contextsPath, JSON.stringify(row) + '\n')
      console.log(`${run.entry.endedAt} ${unitId} ${c.contextId} ${row.status} digest=${ctxRecords.get(c.k)?.record.reservationDigest ?? '-'} C5=${ctxRecords.get(c.k)?.record.checks.C5.state ?? '-'} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
    }

    // 5. DSC rung-major (§4.2 - §4.4, §8.1)
    const discoveryRows = []
    const contextPools = new Map(contexts.map(c => [c.k, []]))
    const scheduler = new d2c.D2CDiscoveryScheduler(contexts.map(c => c.k), k => ctxRecords.has(k))
    for (const item of scheduler.items()) {
      const c = contexts.find(x => x.k === item.k)
      const unitId = d2c.d2cDiscoveryUnitId(item.k, item.rung)
      const pool = contextPools.get(item.k)
      const row = { unitId, k: item.k, contextId: c.contextId, rung: item.rung, status: null, notExecutedReason: null, process: null, recordFile: null }
      const skip = item.dependency ? 'dependency_unmeasured' : skipReason('discovery', item.k, item.rung)
      if (skip !== null) {
        row.status = 'not_executed'; row.notExecutedReason = skip
        discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
        scheduler.report(item.k, item.rung, 'not_executed', pool.length)
        continue
      }
      startedChildren += 1
      const ctx = ctxRecords.get(item.k)
      const task = { unitId, contextId: c.contextId, k: c.k, label: c.label, targetWeaponId: c.targetWeaponId, supportBuildListEntryId: c.supportBuildListEntryId, currentBuildListEntryId: c.currentBuildListEntryId,
        rung: item.rung, extent: d2c.d2cRungExtent(item.rung),
        context: { recordSha256: ctx.recordSha256, reservationBody: ctx.record.reservationBody, reservationDigest: ctx.record.reservationDigest, originDigest: ctx.record.originDigest, excludedRouteKeys: ctx.record.excludedRouteKeys },
        poolKeysAtStart: pool.map(p => p.candidateStableKey), d2bK0Pool: c.d2bK0Pool, poolCap: d2c.D2C_K1_POOL_CAP, researchMaxPlanSteps: d2c.D2C_RESEARCH_MAX_PLAN_STEPS }
      const run = await runChild(unitId, 'discover', { task, poolDir: resolve(runDir) }, envelope.discoveryUnitBudgetMs, `${unitId}.record.json`)
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const measured = DSC_MEASURED.includes(row.status)
      if (measured) {
        for (const p of result.pooled) {
          const raw = await readFile(path(p.generatedEntryFile.file))
          if (sha256(raw) !== p.generatedEntryFile.sha256) abort(`evidence ${unitId}: the G store body is not the one the child recorded`)
          pool.push({ ...p, contextId: c.contextId, k: c.k, supportBuildListEntryId: c.supportBuildListEntryId, file: p.generatedEntryFile.file, sha256: p.generatedEntryFile.sha256, unitId, rung: item.rung })
        }
      }
      if (row.status === 'guardrail_violation') abort(`guardrail ${unitId}: ${JSON.stringify(result.issues)}`)
      discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
      scheduler.report(item.k, item.rung, row.status, pool.length)
      console.log(`${run.entry.endedAt} ${unitId} ${c.contextId} ${row.status}${measured ? ` delivered=${result.search.deliveredCandidates} actions=${result.deliveries.map(d => d.action).join(',') || '-'} pool=${pool.length}` : ''} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${heap(run.entry)}`)
    }

    // Discovery ordinals per Target: (context ordinal, rung, delivery index) (§5.1).
    const pools = new Map()
    for (const t of scopeTargets) {
      const list = []
      for (const c of contexts.filter(x => x.label === t.label).sort((a, b) => a.k - b.k)) for (const p of contextPools.get(c.k)) list.push({ ...p, ordinal: list.length + 1 })
      pools.set(t.label, list)
    }
    const k1Ref = (t, p) => {
      const ctx = ctxRecords.get(p.k)
      return { label: t.label, targetIndex: t.targetIndex, targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, generatedBuildListEntryId: p.generatedBuildListEntryId,
        sha256: p.sha256, file: p.file, requiresSupport: [p.supportBuildListEntryId], contextId: p.contextId, supportReservationDigest: ctx.record.reservationDigest,
        supportReservation: ctx.record.reservationBody, supportBodySha256: ctx.record.supportBodySha256, poolOrdinal: p.ordinal, fromD2B: false }
    }

    // 6. ADM (§5)
    const admitted = new Map(), admissionUnmeasured = new Map()
    for (const t of scopeTargets) {
      const ok = [], bad = []
      for (const p of pools.get(t.label)) {
        const admission = { reusedExisting: p.reusedExisting, replacementReady: p.reusedExisting || (p.replacement.status === 'ready' && p.replacement.replacedBuildListEntryId === t.currentBuildListEntryId) }
        const r = await evaluate({ evaluationId: d2c.d2cAdmissionId(t.label, p.ordinal), stage: 'ADM', label: t.label, poolOrdinal: p.ordinal, contextId: p.contextId,
          replacements: [k1Ref(t, p)], reusedExisting: p.reusedExisting, admission })
        if (!MEASURED.includes(r.row.status)) bad.push(r.row.evaluationId)
        if (d2.d2R1R4(r.row.status, r.facts, p.generatedBuildListEntryId, [p.supportBuildListEntryId], admission).R1) ok.push(p)
      }
      admitted.set(t.label, ok)
      admissionUnmeasured.set(t.label, bad)
    }

    // 7. CMP (§6.2), single pass from the I0 set.
    let accepted = [...i0Refs], reference = i0Measured ? i0Run.facts : null, afterUnmeasured = false
    for (const t of scopeTargets) {
      const before = accepted.map(label)
      const step = { label: t.label, acceptedBefore: before, evaluatedCandidates: [], eligible: [], chosen: null, stepOutcome: null, stepNotEvaluatedReason: null, acceptedAfter: before, afterUnmeasuredStep: afterUnmeasured }
      const stops = contexts.filter(c => c.label === t.label).map(c => ctxRecords.has(c.k) ? scheduler.stop(c.k) : 'not_executed')
      if (stops.some(s => s === 'unmeasured' || s === 'not_executed' || s === null) || admissionUnmeasured.get(t.label).length > 0) {
        step.stepOutcome = 'step_unmeasured'; step.stepNotEvaluatedReason = 'dependency_unmeasured'; afterUnmeasured = true
      } else {
        const results = []
        for (const c of admitted.get(t.label)) {
          const proposed = [...accepted, k1Ref(t, c)].sort((a, b) => a.targetIndex - b.targetIndex)
          const id = d2c.d2cCompositionId(t.label, c.ordinal)
          const r = await evaluate({ evaluationId: id, stage: 'CMP', label: t.label, poolOrdinal: c.ordinal, contextId: c.contextId, replacements: proposed, blockedReason: i0Measured ? null : 'i0_unmeasured' })
          results.push({ evaluationId: id, ordinal: c.ordinal, contextId: c.contextId, status: r.row.status, r5Satisfied: r.r5?.satisfied ?? null, completed: r.facts?.plan.termination?.completedTargetCount ?? null,
            conflicts: r.facts ? r.facts.conflicts.length : null, steps: r.facts?.plan.steps ?? null, facts: r.facts, candidate: c })
        }
        const outcome = d2.d2CompositionStep(results, reference?.plan.termination?.completedTargetCount ?? null)
        Object.assign(step, { evaluatedCandidates: results.map(r => ({ evaluationId: r.evaluationId, ordinal: r.ordinal, contextId: r.contextId })), eligible: outcome.eligible, chosen: outcome.chosen, stepOutcome: outcome.stepOutcome })
        if (outcome.stepOutcome === 'step_unmeasured') afterUnmeasured = true
        if (outcome.stepOutcome === 'accepted') {
          const chosen = results.find(r => r.evaluationId === outcome.chosen)
          accepted = [...accepted, k1Ref(t, chosen.candidate)].sort((a, b) => a.targetIndex - b.targetIndex)
          reference = chosen.facts
        }
        step.acceptedAfter = accepted.map(label)
      }
      compositionRows.push(step); appendFileSync(compositionPath, JSON.stringify(step) + '\n')
      console.log(`CMP ${step.label} ${step.stepOutcome}${step.chosen ? ` chosen=${step.chosen}` : ''} accepted=[${step.acceptedAfter.join(',')}]`)
    }

    await write(outputPath, { ...base, status: aborted !== null ? 'aborted_after_invalid' : smoke ? 'smoke' : 'completed', abortReason: aborted, discoveryEnvelopeReached, runEnvelopeReached,
      inputValidation: { passed: true, issues: [] }, contexts: contextRows, discovery: discoveryRows, evaluations: evaluationRows, composition: compositionRows, processes, wallMs: performance.now() - phaseStarted })
    const count = (list, status) => list.filter(r => r.status === status).length
    console.log(JSON.stringify({ output: resolve(outputPath), aborted, discoveryEnvelopeReached, runEnvelopeReached, contexts: contextRows.map(r => `${r.contextId}:${r.status}`), units: discoveryRows.length,
      pooled: [...pools.values()].reduce((s, p) => s + p.length, 0), evaluated: count(evaluationRows, 'evaluated'), notExecuted: count(evaluationRows, 'not_executed'),
      accepted: accepted.map(a => a.fromD2B ? a.label : `${a.label}#c${a.poolOrdinal}(${a.contextId})`), final: reference ? { completed: reference.plan.termination?.completedTargetCount, conflicts: reference.conflicts.length, steps: reference.plan.steps } : null,
      wallMs: performance.now() - phaseStarted }, null, 2))
  }
} finally {
  await server.close()
}
