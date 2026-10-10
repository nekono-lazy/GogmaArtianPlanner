// Issue #154 D2-B Research only: K0-first candidate discovery and set evaluation (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md).
//
// Parent (default role). It reads the registered inputs (the manifest, the Phase B / D1 RESULTs through their allowlists, the
// Phase 2-C2 RESULT baseline summary, the D1-A / D2-A documents, the four D1 G store seed bodies) and the Export:
//   0. launch observation: repository HEAD, uncommitted benchmark code, the calculation code SHA-256, the D2-A document SHA-256
//      from the HEAD git object, the registered policy SHA-256, the observed digest of every registered input, the Production audit;
//   1. START ATTESTATION: written once (`wx`, then read-only) into the new run dir BEFORE any child, read back and, for a formal
//      launch, verified (verifyD2StartAttestation());
//   2. V: validateD2Inputs(). Any issue: no child is started, the raw output says `input_invalid`;
//   3. DSC: per Target (t00 -> t10) L0 -> L1 -> L2, one fresh `discover` child per unit (60 minutes, heap 12,288 MB), the §2.3
//      escalation, the G store bodies written by the child;
//   4. B0 -> ADM -> CMP -> Z0 -> Z: one fresh `evaluate` child per evaluation (30 minutes), concurrency 1, no retry, no fallback.
//      CMP / Z compose from the earlier steps. A guardrail violation or a mismatched parity (Phase B K0 prefix, D1 G, B0, Z0, D1
//      determinism) aborts the run: every remaining registered item is `not_executed` (aborted_after_invalid). The 12-hour run
//      envelope stops new children (`run_envelope_reached`).
// Every unit / evaluation / step row is appended to discovery.jsonl / evaluations.jsonl / composition.jsonl with its record file
// SHA-256, so an interrupted run stays analyzable from the run dir alone. The oracle is never read (no oracle file, module or field).
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
  throw new Error('Usage: node scripts/run-planner-global-d2.mjs --export <external Export .json> --run-dir <new dir .local> --output <new raw .json.local> [--allow-uncommitted --smoke-targets 1,5 --smoke-max-children N --smoke-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-d2.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const lines = text => text.split(/\r?\n/).filter(Boolean)
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Only oracle-free modules (a test pins this list).
async function loadModules(server) {
  return {
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
  // ------------------------------------------------------------------ child (discover | evaluate)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { d2, b2c1, c26a, research, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const sample = () => { const maxima = tracker.sample(process.memoryUsage()); process.send?.({ type: 'memory', maxima, yields }) }
  const timer = setInterval(sample, d2.D2_EXECUTION_ENVELOPE.memorySampleIntervalMs)
  try {
    sample()
    const wrapper = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const exportJson = JSON.parse((await readFile(exportPath)).toString('utf8'))
    const input = research.globalResearchInputFromExport(exportJson, d2.D2_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    let result, scheduleMs = null
    if (role === 'discover') {
      const task = wrapper.task
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      const dependencies = research.globalResearchDependencies(engine)
      const context = d2.prepareD2K0Context(input, schedule, task, dependencies)
      if (context.status !== 'ready') result = { status: 'guardrail_violation', unitId: task.unitId, issues: context.issues }
      else {
        const unit = await d2.runD2DiscoveryUnit(input, context.prepared, task, dependencies, { yieldControl })
        if (Array.isArray(unit.pooled)) {
          for (const p of unit.pooled) {
            const file = d2.d2PoolFileName(task.targetIndex, p.ordinal)
            const body = JSON.stringify(p.generatedEntry, null, 2) + '\n'
            await writeFile(join(wrapper.poolDir, file), body, { flag: 'wx' })
            p.generatedEntry = null
            p.generatedEntryFile = { file, bytes: Buffer.byteLength(body), sha256: sha256(body) }
            p.keySha256 = sha256(p.candidateStableKey)
          }
          for (const d of unit.deliveries) d.keySha256 = sha256(d.candidateStableKey)
        }
        result = unit
      }
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
        : await d2.runD2Evaluation(input, exportJson.buildListEntries, wrapper.task, generated, research.globalResearchDependencies(engine), { yieldControl })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, taskId: wrapper.task.unitId ?? wrapper.task.evaluationId, wallMs, scheduleMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes, maxRssKiB: process.resourceUsage().maxRSS,
        heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, false)
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
// Non-formal smoke only: a subset of the Targets (by index), a cap on started children, and a shorter child budget.
const smokeTargets = option('--smoke-targets') === undefined ? null : option('--smoke-targets').split(',').map(Number)
const smokeMaxChildren = option('--smoke-max-children') === undefined ? null : Number(option('--smoke-max-children'))
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smoke = smokeTargets !== null || smokeMaxChildren !== null || smokeBudgetMs !== null
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
  const { d2, d1, c26a, ProductionRngEngine } = await loadModules(server)
  const specRaw = execFileSync('git', ['show', `HEAD:${d2.D2_SPEC_FILE}`], { maxBuffer: 1 << 28 })
  const specDocumentSha256 = sha256(specRaw)
  const registeredPolicySha256 = d2.d2RegisteredPolicySha256(text => sha256(text))
  // 0. The registered inputs, read and digested before anything is written or run (a missing file is null, never substituted).
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
  const observedInputs = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2.D2_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observedInputs[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
  }
  const observedSeedFiles = {}, seedFiles = {}
  for (const s of d2.D2_SEED_FILES) {
    const path = join(d2.D2_D1_RUN_DIR, d2.d2SeedFileName(s.unitId))
    const buffer = await readOptional(path)
    observedSeedFiles[s.unitId] = buffer === null ? null : { bytes: buffer.length, sha256: sha256(buffer) }
    seedFiles[s.unitId] = buffer === null ? null : { file: observedSeedFiles[s.unitId], json: parse(buffer) }
  }
  const baseMain = d2.D2_BASE_MAIN
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionAudit = { baseMain, baseMainIsAncestor, productionChangedSinceBaseMain: d2.d2ProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked]) }
  if (!smoke && (!baseMainIsAncestor || productionAudit.productionChangedSinceBaseMain.length > 0)) throw new Error(`The Production audit fails; no formal run: ${JSON.stringify(productionAudit)}`)
  const rngEngineVersion = new ProductionRngEngine().version
  if (rngEngineVersion !== d2.D2_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: re-register D2 before running it (§8.2).')
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, d2.D2_START_ATTESTATION_FILE)
  const envelope = { ...d2.D2_EXECUTION_ENVELOPE, ...(smokeBudgetMs === null ? {} : { discoveryUnitBudgetMs: smokeBudgetMs, evaluationBudgetMs: smokeBudgetMs }) }
  const attestation = d2.d2StartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead, uncommittedBenchmarkCode: uncommitted,
    benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, observedInputs, observedSeedFiles, exportFileName: basename(exportPath), productionAudit, machine,
    appliedExecutionEnvelope: envelope, rngEngineVersion, smoke: smoke ? { targetIndexes: smokeTargets, maxChildren: smokeMaxChildren, budgetMs: smokeBudgetMs } : null })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  const chainedExport = d2.d2ChainedExportSha256(parse(buffers.phaseBResult))
  if (!smoke && !uncommitted) {
    const check = d2.verifyD2StartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256,
      exportSha256: chainedExport, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: d2.D2_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per discovery unit / evaluation, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportFileName: basename(exportPath), rngEngineVersion,
    calculationContext: { ...d2.D2_CALCULATION_CONTEXT }, appliedExecutionEnvelope: envelope, productionAudit, machine, smoke: attestation.smoke }
  const base = { phase: 'Issue #154 D2-B: K0-first candidate discovery and set evaluation (Node Research run, raw)', measuredAt: attestation.createdAt, environment, launchAttestation }
  const phaseStarted = performance.now()

  // 2. V (no child).
  const validation = d2.validateD2Inputs({ files: observedInputs, manifest: parse(buffers.phaseBTargets), phaseBResult: parse(buffers.phaseBResult), phase2c2Result: parse(buffers.phase2c2Result),
    d1Result: parse(buffers.d1Result), seedFiles, specMarkdown: specRaw.toString('utf8'), d1SpecMarkdown: buffers.d1SpecDocument === null ? '' : buffers.d1SpecDocument.toString('utf8') })
  console.log(`V ${validation.passed ? 'passed' : `FAILED: ${validation.issues.join('; ')}`}`)
  if (!validation.passed) {
    await write(outputPath, { ...base, status: 'input_invalid', abortReason: null, runEnvelopeReached: false, inputValidation: { passed: false, issues: validation.issues },
      discovery: [], evaluations: [], composition: [], processes: [], wallMs: performance.now() - phaseStarted })
    process.exitCode = 1
  } else {
    const { targets, seed, d1: d1Reference, k0ReservationDigest } = validation
    const exportSha256 = validation.exportSha256
    const phase2c2Summary = validation.phase2c2BaselineSummary
    const processes = []
    const discoveryPath = join(runDir, 'discovery.jsonl'), evaluationsPath = join(runDir, 'evaluations.jsonl'), compositionPath = join(runDir, 'composition.jsonl')
    const MEASURED = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
    const COMPARABLE = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']
    const DSC_MEASURED = d2.D2_DISCOVERY_MEASURED

    /** One fresh child. Resolves with its process entry, record (or null) and record file digest; never throws for a child failure. */
    const runChild = (id, childRole, wrapper, budgetMs) => new Promise(done => {
      const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`), memoryPath = join(runDir, `${id}.memory.jsonl`)
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

    let aborted = null, runEnvelopeReached = false, startedChildren = 0
    const abort = reason => { if (aborted === null) { aborted = reason; console.log(`ABORT ${reason}`) } }
    const skipReason = targetIndexes => {
      if (aborted !== null) return 'aborted_after_invalid'
      if (performance.now() - phaseStarted >= envelope.runBudgetMs) { runEnvelopeReached = true; return 'run_envelope_reached' }
      if (smokeTargets !== null && targetIndexes.some(i => !smokeTargets.includes(i))) return 'smoke_skipped'
      if (smokeMaxChildren !== null && startedChildren >= smokeMaxChildren) return 'smoke_cap'
      return null
    }

    // 3. DSC.
    const discoveryRows = []
    const pools = new Map()
    const discoveryStop = new Map()
    for (const t of targets) {
      const pool = []
      let rung = 'L0', stop = null
      const comparableRungs = new Set()
      while (rung !== null) {
        const unitId = d2.d2DiscoveryUnitId(t.targetIndex, rung)
        const row = { unitId, targetIndex: t.targetIndex, rung, status: null, notExecutedReason: null, process: null, recordFile: null }
        const skip = skipReason([t.targetIndex])
        if (skip !== null) {
          row.status = 'not_executed'; row.notExecutedReason = skip
          discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
          stop = 'not_executed'; break
        }
        startedChildren += 1
        const task = { unitId, targetIndex: t.targetIndex, label: t.label, targetWeaponId: t.targetWeaponId, rung, extent: d2.d2RungExtent(rung), currentBuildListEntryId: t.currentBuildListEntryId,
          k0ReservationDigest, poolKeysAtStart: pool.map(p => p.candidateStableKey), poolCap: d2.D2_POOL_CAP, researchMaxPlanSteps: d2.D2_RESEARCH_MAX_PLAN_STEPS }
        const run = await runChild(unitId, 'discover', { task, poolDir: resolve(runDir) }, envelope.discoveryUnitBudgetMs)
        row.process = processRow(run.entry)
        row.recordFile = run.recordFile
        const result = run.record?.result ?? null
        row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
        const measured = DSC_MEASURED.includes(row.status)
        if (measured) {
          for (const p of result.pooled) {
            const raw = await readFile(join(runDir, p.generatedEntryFile.file))
            if (sha256(raw) !== p.generatedEntryFile.sha256) abort(`evidence ${unitId}: the G store body is not the one the child recorded`)
            pool.push({ ordinal: p.ordinal, candidateStableKey: p.candidateStableKey, keySha256: p.keySha256, generatedBuildListEntryId: p.generatedBuildListEntryId, file: p.generatedEntryFile.file,
              sha256: p.generatedEntryFile.sha256, reusedExisting: p.reusedExisting, replacement: p.replacement })
          }
        }
        if (row.status === 'guardrail_violation') abort(`guardrail ${unitId}: ${JSON.stringify(result.issues)}`)
        const comparable = measured || row.status === 'discovery_calculation_error' || row.status === 'guardrail_violation'
        if (comparable) comparableRungs.add(rung)
        // Phase B K0 prefix parity (§7.3.3).
        const expected = t.phaseBK0Units[rung]
        if (expected) {
          const firstKey = measured && result.deliveries.length > 0 ? result.deliveries[0].keySha256 : null
          const p = d2.d2PhaseBPrefixParity(expected, { comparable, status: row.status, deliveredCandidates: measured ? result.search.deliveredCandidates : null, firstKeySha256: firstKey })
          if (p.state === 'mismatched') abort(`phase_b_k0_parity ${unitId}: ${p.mismatches.join('; ')}`)
        }
        // D1 G parity, once the unit of the Phase B first K0 delivery is measured (§7.3.3).
        if (t.d1Generated !== null && rung === t.firstK0DeliveryRung && ['L0', 'L1', 'L2'].slice(0, ['L0', 'L1', 'L2'].indexOf(rung) + 1).every(r => comparableRungs.has(r))) {
          const p = d2.d2D1GeneratedParity({ keySha256: t.phaseBK0Units[rung].firstKeySha256, buildListEntryId: t.d1Generated.buildListEntryId, sha256: t.d1Generated.sha256 },
            pool[0] ? { keySha256: pool[0].keySha256, generatedBuildListEntryId: pool[0].generatedBuildListEntryId, generatedEntrySha256: pool[0].sha256 } : null)
          if (p.state === 'mismatched') abort(`d1_parity ${t.label} pool 1: ${p.mismatches.join('; ')}`)
        }
        discoveryRows.push(row); appendFileSync(discoveryPath, JSON.stringify(row) + '\n')
        console.log(`${run.entry.endedAt} ${unitId} ${row.status}${measured ? ` delivered=${result.search.deliveredCandidates} pooled=${result.pooled.length} pool=${pool.length}` : ''} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${((run.entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        if (!measured) { stop = row.status === 'not_executed' ? 'not_executed' : 'unmeasured'; break }
        const next = d2.d2DiscoveryNext(row.status, rung, pool.length)
        rung = next.next
        stop = next.stop
      }
      pools.set(t.targetIndex, pool)
      discoveryStop.set(t.targetIndex, stop)
    }

    // 4. Evaluations in the registered order.
    const evaluationRows = [], compositionRows = []
    const seedFileDir = resolve(d2.D2_D1_RUN_DIR)
    const label = i => d2.d2TargetLabel(i)
    /** One registered evaluation: a not_executed row, or one fresh child. Returns { row, facts, r5 }. */
    const evaluate = async (spec) => {
      const reps = [...spec.replacements].sort((a, b) => a.targetIndex - b.targetIndex)
      const ts = reps.map(r => targets.find(t => t.targetIndex === r.targetIndex))
      const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort()
      const evaluatedAgainst = d2.d2EvaluatedAgainst(spec.stage)
      const row = { evaluationId: spec.evaluationId, stage: spec.stage, axis: d2.d2Axis(spec.stage), evaluatedAgainst, targetIndex: spec.targetIndex, poolOrdinal: spec.poolOrdinal,
        replacementTargetIndexes: reps.map(r => r.targetIndex), replacementTargets: ts.map(t => t.targetWeaponId), generatedEntryIds: reps.map(r => r.generatedBuildListEntryId),
        generatedEntrySha256s: reps.map(r => r.sha256), requiresSupport: support, inputDigest: null, status: null, notExecutedReason: null, process: null, recordFile: null, runner: null }
      const finish = (facts, r5) => { evaluationRows.push(row); appendFileSync(evaluationsPath, JSON.stringify(row) + '\n'); return { row, facts, r5 } }
      if (spec.reusedExisting) { row.status = 'not_run_reused_existing'; return finish(null, null) }
      const skip = spec.blockedReason ?? skipReason(reps.map(r => r.targetIndex))
      if (skip !== null) { row.status = 'not_executed'; row.notExecutedReason = skip; return finish(null, null) }
      startedChildren += 1
      row.inputDigest = d1.d1InputDigest(row.replacementTargets, row.generatedEntryIds, row.generatedEntrySha256s, exportSha256)
      const task = { evaluationId: spec.evaluationId, stage: spec.stage, evaluatedAgainst, researchMaxPlanSteps: d2.D2_RESEARCH_MAX_PLAN_STEPS, fullRunCap: d2.D2_EVALUATION_FULL_RUN_CAP,
        replacements: reps.map((r, i) => ({ targetIndex: r.targetIndex, targetWeaponId: ts[i].targetWeaponId, currentBuildListEntryId: ts[i].currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
          generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: [...r.requiresSupport], supportReservationDigest: r.supportReservationDigest })) }
      const run = await runChild(spec.evaluationId, 'evaluate', { task, generatedEntryPaths: reps.map(r => join(r.isSeed ? seedFileDir : resolve(runDir), r.file)) }, envelope.evaluationBudgetMs)
      row.process = processRow(run.entry)
      row.recordFile = run.recordFile
      const result = run.record?.result ?? null
      row.status = run.entry.outcome !== 'completed' ? run.entry.outcome : result.status
      const facts = result !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(result.status) ? result : null
      const r5 = d1.judgeD1R5({ status: row.status, evaluatedAgainst, generatedBuildListEntryIds: row.generatedEntryIds, requiresSupport: support, facts })
      const r6 = d2.judgeD2R6({ status: row.status, evaluatedAgainst, facts, r5Satisfied: r5.satisfied })
      if (row.status === 'guardrail_violation' || (facts !== null && facts.runConflictResolutions !== 0)) abort(`guardrail ${spec.evaluationId}: ${JSON.stringify(result?.issues ?? 'G1')}`)
      // D1 determinism (§7.3.3): a comparable result whose inputDigest D1 holds must be the D1 status and resultDigest.
      const d1Same = d1Reference.byInputDigest[row.inputDigest] ?? []
      if (d1Same.length > 0 && COMPARABLE.includes(row.status) && d1Same.some(x => x.status !== row.status || x.resultDigest !== (facts?.resultDigest ?? null))) abort(`d1_parity ${spec.evaluationId}: differs from D1 ${d1Same.map(x => x.evaluationId).join(', ')}`)
      row.runner = { r5, r6, boundLimited: d1.isD1BoundLimited(row.status, facts) }
      if (spec.admission) row.runner.r1 = d2.d2R1R4(row.status, facts, row.generatedEntryIds[0], [], spec.admission).R1
      console.log(`${run.entry.endedAt} ${spec.evaluationId} ${row.status}${facts ? ` steps=${facts.plan.steps} completed=${facts.plan.termination?.completedTargetCount ?? '-'} conflicts=${facts.conflicts.length} runs=${facts.fullRunsStarted}` : ''} r5=${r5.satisfied} r6=${r6.satisfied} ${(run.entry.wallMs / 1000).toFixed(1)}s heap<=${((run.entry.lastIpcMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
      return finish(facts, r5)
    }
    const poolReplacement = (targetIndex, p) => ({ targetIndex, poolOrdinal: p.ordinal, generatedBuildListEntryId: p.generatedBuildListEntryId, sha256: p.sha256, file: p.file, requiresSupport: [], supportReservationDigest: null, isSeed: false })

    // B0
    const b0 = await evaluate({ evaluationId: 'B0', stage: 'B0', targetIndex: null, poolOrdinal: null, replacements: [] })
    if (COMPARABLE.includes(b0.row.status)) {
      const p = d1.d1B0Parity(b0.facts?.baselineSummary ?? null, phase2c2Summary)
      if (b0.row.status !== 'evaluated' || !p.matched || b0.facts.resultDigest !== d1Reference.b0.resultDigest) abort(`baseline_parity_mismatch B0: ${b0.row.status} ${p.mismatches.join(', ')}`)
    }
    const b0Facts = b0.row.status === 'evaluated' ? b0.facts : null

    // ADM
    const admitted = new Map(), admissionUnmeasured = new Map()
    for (const t of targets) {
      const ok = [], bad = []
      for (const p of pools.get(t.targetIndex)) {
        const admission = { reusedExisting: p.reusedExisting, replacementReady: p.reusedExisting || (p.replacement.status === 'ready' && p.replacement.replacedBuildListEntryId === t.currentBuildListEntryId) }
        const r = await evaluate({ evaluationId: d2.d2AdmissionId(t.targetIndex, p.ordinal), stage: 'ADM', targetIndex: t.targetIndex, poolOrdinal: p.ordinal,
          replacements: [poolReplacement(t.targetIndex, p)], reusedExisting: p.reusedExisting, admission })
        if (!MEASURED.includes(r.row.status)) bad.push(r.row.evaluationId)
        if (d2.d2R1R4(r.row.status, r.facts, p.generatedBuildListEntryId, [], admission).R1) ok.push(p)
      }
      admitted.set(t.targetIndex, ok)
      admissionUnmeasured.set(t.targetIndex, bad)
    }

    // CMP / Z (§4.1 / §5)
    const compose = async (axis, order, start, startReference, blockedReason) => {
      let accepted = [...start], reference = startReference, afterUnmeasured = false
      for (const index of order) {
        const before = accepted.map(a => label(a.targetIndex))
        const step = { axis, label: label(index), targetIndex: index, acceptedBefore: before, evaluatedCandidates: [], eligible: [], chosen: null, stepOutcome: null, stepNotEvaluatedReason: null,
          acceptedAfter: before, afterUnmeasuredStep: afterUnmeasured }
        const stop = discoveryStop.get(index)
        if (stop === 'unmeasured' || stop === 'not_executed' || admissionUnmeasured.get(index).length > 0) {
          step.stepOutcome = 'step_unmeasured'; step.stepNotEvaluatedReason = 'dependency_unmeasured'; afterUnmeasured = true
        } else {
          const results = []
          for (const c of admitted.get(index)) {
            const proposed = [...accepted, poolReplacement(index, c)].sort((a, b) => a.targetIndex - b.targetIndex)
            const id = axis === 'main' ? d2.d2CompositionId(index, c.ordinal) : d2.d2SeededId(index, c.ordinal)
            const r = await evaluate({ evaluationId: id, stage: axis === 'main' ? 'CMP' : 'Z', targetIndex: index, poolOrdinal: c.ordinal, replacements: proposed, blockedReason })
            results.push({ evaluationId: id, ordinal: c.ordinal, status: r.row.status, r5Satisfied: r.r5?.satisfied ?? null, completed: r.facts?.plan.termination?.completedTargetCount ?? null,
              conflicts: r.facts ? r.facts.conflicts.length : null, steps: r.facts?.plan.steps ?? null, facts: r.facts, candidate: c })
          }
          const outcome = d2.d2CompositionStep(results, reference?.plan.termination?.completedTargetCount ?? null)
          Object.assign(step, { evaluatedCandidates: results.map(r => ({ evaluationId: r.evaluationId, ordinal: r.ordinal })), eligible: outcome.eligible, chosen: outcome.chosen, stepOutcome: outcome.stepOutcome })
          if (outcome.stepOutcome === 'step_unmeasured') afterUnmeasured = true
          if (outcome.stepOutcome === 'accepted') {
            const chosen = results.find(r => r.evaluationId === outcome.chosen)
            accepted = [...accepted, poolReplacement(index, chosen.candidate)].sort((a, b) => a.targetIndex - b.targetIndex)
            reference = chosen.facts
          }
          step.acceptedAfter = accepted.map(a => label(a.targetIndex))
        }
        compositionRows.push(step); appendFileSync(compositionPath, JSON.stringify(step) + '\n')
        console.log(`${axis} ${step.label} ${step.stepOutcome}${step.chosen ? ` chosen=${step.chosen}` : ''} accepted=[${step.acceptedAfter.join(',')}]`)
      }
      return { accepted, reference }
    }
    const main = await compose('main', targets.map(t => t.targetIndex), [], b0Facts, null)

    const seedReplacements = seed.map(s => ({ targetIndex: s.targetIndex, poolOrdinal: null, generatedBuildListEntryId: s.generatedBuildListEntryId, sha256: s.sha256, file: s.file,
      requiresSupport: [...s.requiresSupport], supportReservationDigest: s.supportReservationDigest, isSeed: true }))
    const z0 = await evaluate({ evaluationId: 'Z0', stage: 'Z0', targetIndex: null, poolOrdinal: null, replacements: seedReplacements })
    if (COMPARABLE.includes(z0.row.status) && (z0.row.status !== 'evaluated' || z0.row.inputDigest !== d1Reference.aB.inputDigest || z0.facts.resultDigest !== d1Reference.aB.resultDigest || z0.r5?.satisfied !== true)) {
      abort(`d1_parity Z0: ${z0.row.status} ${z0.facts?.resultDigest ?? ''} r5=${z0.r5?.satisfied}`)
    }
    const dropped = d2.d2DroppedTargetIndexes(seed)
    const seeded = await compose('seeded', dropped, seedReplacements, z0.row.status === 'evaluated' ? z0.facts : null, MEASURED.includes(z0.row.status) ? null : 'z0_unmeasured')

    await write(outputPath, { ...base, status: aborted !== null ? 'aborted_after_invalid' : smoke ? 'smoke' : 'completed', abortReason: aborted, runEnvelopeReached,
      inputValidation: { passed: true, issues: [] }, discovery: discoveryRows, evaluations: evaluationRows, composition: compositionRows, processes, wallMs: performance.now() - phaseStarted })
    const count = (list, status) => list.filter(r => r.status === status).length
    console.log(JSON.stringify({ output: resolve(outputPath), aborted, runEnvelopeReached, units: discoveryRows.length, pooled: [...pools.values()].reduce((s, p) => s + p.length, 0),
      evaluated: count(evaluationRows, 'evaluated'), notExecuted: count(evaluationRows, 'not_executed'), mainAccepted: main.accepted.map(a => `${label(a.targetIndex)}#c${a.poolOrdinal}`),
      seededAccepted: seeded.accepted.map(a => a.isSeed ? label(a.targetIndex) : `${label(a.targetIndex)}#c${a.poolOrdinal}`), wallMs: performance.now() - phaseStarted }, null, 2))
  }
} finally {
  await server.close()
}
