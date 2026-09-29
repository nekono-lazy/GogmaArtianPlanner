// Issue #154 Phase 2-C2.5-D2-c Research only: heap profiling of the shallow Search-only OOM that remains after the
// Ideal-only publication (sampling heap profile + heap snapshot). No Production code is changed by this Phase.
//
// Parent (default role):
//   0. reads the committed D2-a RESULT (explicit --d2a) for the workload (primary OOM / cleared reference / controls)
//      and the expected outcomes, the committed C2.5-A evidence (explicit --c25a) for the pre-search context parity and
//      the C2.5-C control rule, and hashes the C2.5-C RESULT (--c25c) and the D2-b RESULT (--d2b) for provenance only;
//      it records the SHA-256 of the pre-registered D2-c rules (PHASE2C25D2C_RULES) before any profiling;
//   1. `probe` child: checks, on synthetic garbage only, whether this Node / V8 honours the live-object sampling options;
//   2. `contexts` child: this run's own baseline (ordinary Production Planner over the original Export) and the kernel
//      pre-search context of every selected context (the unchanged C2.5-A derivation). The parent checks each against
//      the C2.5-A evidence field by field and against the D2-a context digest, and stops before any profiling on a
//      mismatch;
//   3. `sampling` children (8192 MB, one fresh process per (variant, context), concurrency 1): the C2.5-C Search call with
//      a live-object sampling heap profiler, a profile the first time heapUsed crosses each Research threshold;
//   4. `snapshot` children (512 MB, --heapsnapshot-near-heap-limit=1, one fresh process per primary OOM context): the same
//      Search with no profiler, a pre-Search baseline snapshot and the near-limit snapshot.
// Sampling and snapshot never share a child. A child failure (OOM, timeout, anything else) is recorded as that
// failure, never as "no Candidate"; a profiling failure is recorded as a profiling failure.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync, writeFileSync, createReadStream, openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics, writeHeapSnapshot } from 'node:v8'
import { Session } from 'node:inspector'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath && role !== 'probe') throw new Error('Usage: node scripts/run-planner-global-phase2c25d2c.mjs --export <external.json> --d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --c25c docs/PLANNER_GLOBAL_PHASE2C25C_RESULT.json --d2b docs/PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json --run-dir <new dir .local> --profiles-dir <new dir .local> --snapshots-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --only <orientationId#workIndex,...> --skip-sampling --skip-snapshot --variants jit_default,no_inlining]')

const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sha256File = path => new Promise((done, fail) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')))
})
const memorySample = () => { const m = process.memoryUsage(); return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss, external: m.external, arrayBuffers: m.arrayBuffers } }
const setImmediateYield = () => new Promise(done => setImmediate(done))
const send = message => new Promise(done => process.send(message, () => done()))

async function withModules(paths, body) {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
  try {
    const modules = {}
    for (const [name, path] of Object.entries(paths)) modules[name] = await server.ssrLoadModule(path)
    return await body(modules)
  } finally {
    await server.close()
  }
}

const CHILD_MODULES = {
  d2c: '/src/benchmarks/plannerGlobalPhase2C25D2C.ts',
  c25c: '/src/benchmarks/plannerGlobalPhase2C25C.ts',
  c25a: '/src/benchmarks/plannerGlobalPhase2C25A.ts',
  c2: '/src/benchmarks/plannerGlobalPhase2C2.ts',
  research: '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
  runner: '/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts',
  rng: '/src/domain/rng/production/productionRngEngine.ts',
}

/** Re-derives the pre-search context of a task from the Export and checks it against the contexts child's digest. */
async function prepareSearch({ c25a, research, runner, rng }, task) {
  const prepStarted = performance.now()
  const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new rng.ProductionRngEngine()
  const prepared = c25a.derivePhase2C25APreSearchContexts(input, task.orientation, research.globalResearchDependencies(engine))
  const context = prepared.contexts[task.workIndex]
  if (!context || context.targetWeaponId !== task.targetWeaponId || context.contextDigest !== task.contextDigest) {
    throw new Error(`Re-derived context ${task.orientation.orientationId}#${task.workIndex} differs from the contexts child (${context?.contextDigest} != ${task.contextDigest}).`)
  }
  return { input, engine, prepared, preparationMs: performance.now() - prepStarted }
}

function startHeartbeat(d2c, progress, searchStartedAt) {
  const timer = setInterval(() => {
    process.send({ type: 'progress', at: Date.now(), elapsedMs: performance.now() - searchStartedAt(), memory: memorySample(), progress: progress.snapshot() })
  }, d2c.PHASE2C25D2C_PROGRESS_HEARTBEAT_MS)
  return () => clearInterval(timer)
}

if (role === 'probe') {
  // ------------------------------------------------------------------ sampling option probe (synthetic garbage only)
  const session = new Session()
  session.connect()
  const post = (method, params) => new Promise((ok, ko) => session.post(method, params, (error, result) => error ? ko(error) : ok(result)))
  await post('HeapProfiler.enable')
  const trial = async (includeCollected) => {
    const options = { samplingInterval: 4096, stackDepth: 8, includeObjectsCollectedByMajorGC: includeCollected, includeObjectsCollectedByMinorGC: includeCollected }
    let accepted = true, error = null
    try { await post('HeapProfiler.startSampling', options) } catch (e) { accepted = false; error = String(e) }
    if (!accepted) return { options, accepted, error }
    let live = []
    for (let round = 0; round < 40; round++) {
      const garbage = []
      for (let i = 0; i < 20_000; i++) garbage.push({ round, i, payload: [i, i + 1, i + 2] })
      live.push(garbage[round])
    }
    globalThis.gc()
    globalThis.gc()
    const { profile } = await post('HeapProfiler.getSamplingProfile')
    await post('HeapProfiler.stopSampling')
    let total = 0
    const walk = node => { total += node.selfSize; node.children.forEach(walk) }
    walk(profile.head)
    const kept = live.length
    live = null
    return { options, accepted, error, sampledBytes: total, samples: profile.samples.length, keptObjects: kept }
  }
  const liveOnly = await trial(false)
  const withCollected = await trial(true)
  const record = { node: process.version, v8: process.versions.v8, liveOnly, withCollected,
    liveOnlyHonoured: liveOnly.accepted && withCollected.accepted && withCollected.sampledBytes > 10 * Math.max(1, liveOnly.sampledBytes) }
  await writeFile(option('--record'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  process.exit(0)
}

if (role === 'contexts') {
  // ------------------------------------------------------------------ contexts child
  const task = JSON.parse((await readFile(option('--task'))).toString('utf8'))
  await withModules(CHILD_MODULES, async ({ c25a, c2, research, runner, rng }) => {
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const started = performance.now()
    const baseline = await c2.runPhase2C2Baseline(input, { createEngine: () => new rng.ProductionRngEngine() })
    const contexts = {}
    for (const orientationId of task.orientationIds) {
      const orientation = baseline.orientations.find(o => o.orientationId === orientationId)
      if (!orientation) throw new Error(`This run's baseline has no orientation ${orientationId}.`)
      contexts[orientationId] = c25a.derivePhase2C25APreSearchContexts(input, orientation, research.globalResearchDependencies(new rng.ProductionRngEngine())).contexts
    }
    await write(option('--record'), { role, task, wallMs: performance.now() - started, calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps,
      orientations: Object.fromEntries(task.orientationIds.map(id => [id, baseline.orientations.find(o => o.orientationId === id)])), contexts })
  })
  process.exit(0)
}

if (role === 'sampling') {
  // ------------------------------------------------------------------ sampling child (IPC): live-object sampling heap profile
  const task = JSON.parse((await readFile(option('--task'))).toString('utf8'))
  const session = new Session()
  session.connect()
  const post = (method, params) => new Promise((ok, ko) => session.post(method, params, (error, result) => error ? ko(error) : ok(result)))
  // scriptId -> url, only while the modules load: a Vite SSR module frame reports an empty url in a sampling profile.
  const scripts = new Map()
  session.on('Debugger.scriptParsed', ({ params }) => { scripts.set(params.scriptId, { url: params.url, sourceMapURL: params.sourceMapURL ?? '' }) })
  await post('Debugger.enable')
  await withModules(CHILD_MODULES, async (modules) => {
    await post('Debugger.disable')
    const { d2c, c25c } = modules
    const { engine, prepared, preparationMs } = await prepareSearch(modules, task)
    const table = [...scripts.entries()].map(([scriptId, s]) => {
      let sourceMap = null
      if (/[\\/]src[\\/]/.test(s.url) && !s.url.includes('node_modules') && s.sourceMapURL.startsWith('data:application/json;base64,')) {
        sourceMap = JSON.parse(Buffer.from(s.sourceMapURL.slice('data:application/json;base64,'.length), 'base64').toString('utf8'))
      }
      return { scriptId, url: s.url, sourceMap }
    })
    const scriptsFile = `${task.runId}.scripts.json`
    writeFileSync(join(task.profilesDir, scriptsFile), JSON.stringify(table))
    await post('HeapProfiler.enable')
    const requested = { ...d2c.PHASE2C25D2C_SAMPLING_OPTIONS }
    let samplingOptions = { requested, actual: requested, error: null }
    try {
      await post('HeapProfiler.startSampling', requested)
    } catch (error) {
      const fallback = { samplingInterval: requested.samplingInterval, stackDepth: requested.stackDepth }
      await post('HeapProfiler.startSampling', fallback)
      samplingOptions = { requested, actual: fallback, error: String(error) }
    }
    const progress = d2c.createPhase2C25D2CProgressObserver()
    let searchStarted = 0
    let firstCandidate = false
    const tracker = c25c.createPhase2C25CThresholdTracker(d2c.PHASE2C25D2C_PROFILE_THRESHOLDS_MIB)
    const profiling = c25c.createPhase2C25CProfilingYield({
      yieldControl: setImmediateYield,
      heapUsed: () => process.memoryUsage().heapUsed,
      tracker,
      isStopped: () => firstCandidate,
      capture: async (thresholdsMiB, heapUsedBytes) => {
        const captureStarted = performance.now()
        const elapsedMs = captureStarted - searchStarted
        const { profile } = await post('HeapProfiler.getSamplingProfile')
        const file = `${task.runId}.t${thresholdsMiB.join('-')}.heapprofile`
        const body = JSON.stringify(profile)
        writeFileSync(join(task.profilesDir, file), body)
        await send({ type: 'profile', at: Date.now(), thresholdsMiB, heapUsedBytes, heapUsedAfterBytes: process.memoryUsage().heapUsed, elapsedMs,
          captureMs: performance.now() - captureStarted, file, bytes: Buffer.byteLength(body), samples: profile.samples.length, progress: progress.snapshot() })
      },
      onEvent: event => { if (event.outcome !== 'captured') process.send({ type: 'profile_failed', at: Date.now(), event }) },
    })
    await send({ type: 'ready', preparationMs, preSearchMemory: memorySample(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit, scriptsFile, scriptCount: table.length, samplingOptions })
    searchStarted = performance.now()
    const stopHeartbeat = startHeartbeat(d2c, progress, () => searchStarted)
    let record
    try {
      record = await c25c.runPhase2C25CSearch(prepared, task.workIndex, engine, {
        yieldControl: profiling.yieldControl, instrumentation: progress.instrumentation, onFirstCandidate: () => { firstCandidate = true },
      })
    } finally {
      stopHeartbeat()
    }
    await post('HeapProfiler.stopSampling')
    await send({ type: 'final', record, profilingEvents: profiling.events(), thresholdsReached: tracker.reached(), thresholdsNotReached: tracker.notReached(),
      progress: progress.snapshot(), postSearchMemory: memorySample() })
  })
  process.exit(0)
}

if (role === 'snapshot') {
  // ------------------------------------------------------------------ snapshot child (IPC): baseline + near-limit heap snapshot, no profiler
  const task = JSON.parse((await readFile(option('--task'))).toString('utf8'))
  await withModules(CHILD_MODULES, async (modules) => {
    const { d2c, c25c } = modules
    const { engine, prepared, preparationMs } = await prepareSearch(modules, task)
    const progress = d2c.createPhase2C25D2CProgressObserver()
    await send({ type: 'ready', preparationMs, preSearchMemory: memorySample(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit })
    const baselineStarted = performance.now()
    const baselinePath = join(task.snapshotsDir, `${task.runId}.baseline.heapsnapshot`)
    writeHeapSnapshot(baselinePath)
    await send({ type: 'baseline', at: Date.now(), file: basename(baselinePath), writeMs: performance.now() - baselineStarted, memoryAfter: memorySample() })
    const searchStarted = performance.now()
    await send({ type: 'search_started', at: Date.now() })
    const stopHeartbeat = startHeartbeat(d2c, progress, () => searchStarted)
    let record
    try {
      record = await c25c.runPhase2C25CSearch(prepared, task.workIndex, engine, { yieldControl: setImmediateYield, instrumentation: progress.instrumentation })
    } finally {
      stopHeartbeat()
    }
    await send({ type: 'final', record, progress: progress.snapshot(), postSearchMemory: memorySample() })
  })
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const d2aPath = option('--d2a'), c25aPath = option('--c25a'), c25cPath = option('--c25c'), d2bPath = option('--d2b')
const runDir = option('--run-dir'), profilesDir = option('--profiles-dir'), snapshotsDir = option('--snapshots-dir'), outputPath = option('--output')
if (!d2aPath || !c25aPath || !c25cPath || !d2bPath || !runDir || !profilesDir || !snapshotsDir || !outputPath) throw new Error('The parent needs --d2a, --c25a, --c25c, --d2b, --run-dir, --profiles-dir, --snapshots-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
for (const dir of [runDir, profilesDir, snapshotsDir]) if (existsSync(dir)) throw new Error(`Directory already exists: ${resolve(dir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
const only = option('--only')?.split(',') ?? null
const skipSampling = args.includes('--skip-sampling'), skipSnapshot = args.includes('--skip-snapshot')
const variantsOverride = option('--variants')?.split(',') ?? null
if ((only !== null || skipSampling || skipSnapshot || variantsOverride !== null) && !allowUncommitted) throw new Error('--only / --skip-* / --variants are non-formal smoke options and need --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
const rawD2A = await readFile(d2aPath), rawC25A = await readFile(c25aPath), rawC25C = await readFile(c25cPath), rawD2B = await readFile(d2bPath)
for (const dir of [runDir, profilesDir, snapshotsDir]) await mkdir(dir, { recursive: true })
const scriptPath = 'scripts/run-planner-global-phase2c25d2c.mjs'
const processes = []
const phaseStarted = performance.now()

await withModules({ d2c: CHILD_MODULES.d2c, c25c: CHILD_MODULES.c25c, analysis: '/src/benchmarks/plannerGlobalPhase2C25D2CAnalysis.ts', hashing: '/src/domain/models/hashing.ts' }, async ({ d2c, c25c, analysis, hashing }) => {
  // The pre-registered rules, fixed before any profiling.
  const rulesSha256 = sha256(hashing.stableStringify(analysis.PHASE2C25D2C_RULES))
  const d2aView = d2c.parsePhase2C25D2CD2AResult(JSON.parse(rawD2A.toString('utf8')))
  if (d2aView.exportSha256 !== exportSha256) throw new Error('The D2-a RESULT was measured on another Export.')
  if (d2aView.c25aEvidenceSha256 !== sha256(rawC25A)) throw new Error('The D2-a RESULT selected its workload from another C2.5-A evidence file.')
  if (!d2aView.contextParityMatches) throw new Error('The D2-a RESULT records a context parity failure.')
  const c25aView = c25c.parsePhase2C25CEvidence(JSON.parse(rawC25A.toString('utf8')))
  if (c25aView.exportSha256 !== exportSha256) throw new Error('The C2.5-A evidence was measured on another Export.')
  const c25cWorkload = c25c.selectPhase2C25CWorkload(c25aView)
  const workload = d2c.selectPhase2C25D2CWorkload(d2aView, c25cWorkload)
  const items = d2c.phase2c25d2cWorkloadItems(workload)
  const keep = item => only === null || only.includes(`${item.orientationId}#${item.workIndex}`)
  const selected = items.filter(keep)
  const samplingPlan = d2c.phase2c25d2cSamplingPlan(workload).filter(p => keep(p.item) && (variantsOverride === null || variantsOverride.includes(p.variant)))
  const snapshotPlan = selected.filter(item => d2c.PHASE2C25D2C_SNAPSHOT_ROLES.includes(item.role))
  const runBudgetMs = d2c.PHASE2C25D2C_RUN_BUDGET_MS
  console.log(`selected ${selected.length}: ${selected.map(s => `${s.orientationId}#${s.workIndex}(${s.role})`).join(' ')}; unselected ${workload.unselected.length}`)
  console.log(`rules sha256 ${rulesSha256}; sampling runs ${samplingPlan.length}; snapshot runs ${snapshotPlan.length}`)

  /** One fresh child. Resolves with its messages and a classified outcome; never throws for a child failure. */
  function runChild(id, childRole, task, { heapArgs, budgetMs, ipc }) {
    return new Promise(done => {
      const taskPath = join(runDir, `${id}.task.json`)
      const recordPath = join(runDir, `${id}.record.json`)
      const messagesPath = join(runDir, `${id}.messages.jsonl`)
      const start = async () => {
        await write(taskPath, task)
        const childArgs = [...heapArgs, scriptPath, '--role', childRole, ...(exportPath ? ['--export', exportPath] : []), '--task', taskPath, '--record', recordPath]
        const began = performance.now(), startedAt = new Date().toISOString()
        let stderrTail = '', timedOut = false
        const messages = []
        const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', ...(ipc ? ['ipc'] : [])], windowsHide: true })
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, budgetMs)
        child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
        if (ipc) child.on('message', message => { const entry = { receivedAtMs: performance.now() - began, receivedAt: Date.now(), message }; messages.push(entry); appendFileSync(messagesPath, JSON.stringify(entry) + '\n') })
        child.once('exit', async (code, signal) => {
          clearTimeout(timer)
          const finalMessage = messages.find(m => m.message.type === 'final')?.message ?? null
          const recordWritten = ipc ? finalMessage !== null : existsSync(recordPath)
          const childOutcome = timedOut ? 'timeout'
            : /JavaScript heap out of memory|Allocation failed|ERR_WORKER_OUT_OF_MEMORY|\bOOM\b/.test(stderrTail) ? 'out_of_memory'
              : code === 0 && signal === null && recordWritten ? 'completed' : 'process_failure'
          const entry = { id, role: childRole, childOutcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began, nodeFlags: heapArgs,
            stderrTail: childOutcome === 'completed' ? null : stderrTail.slice(-4000) }
          processes.push(entry)
          console.log(`${childOutcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s${finalMessage ? ` ${finalMessage.record.status}` : ''}`)
          const record = !ipc && childOutcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
          done({ entry, record, messages, finalMessage })
        })
      }
      start()
    })
  }

  // 1. Sampling option probe (synthetic only).
  const probe = await runChild('probe', 'probe', {}, { heapArgs: ['--expose-gc', '--max-old-space-size=1024'], budgetMs: 5 * 60 * 1000, ipc: false })
  if (!probe.record) throw new Error('The sampling option probe failed.')
  console.log(`probe liveOnlyHonoured=${probe.record.liveOnlyHonoured} (${probe.record.liveOnly.sampledBytes} vs ${probe.record.withCollected.sampledBytes})`)

  // 2. Contexts from this run's own baseline, then parity with the C2.5-A evidence and the D2-a digest before any profiling.
  const orientationIds = [...new Set(selected.map(item => item.orientationId))]
  const contextsRun = await runChild('contexts', 'contexts', { orientationIds }, { heapArgs: ['--max-old-space-size=8192'], budgetMs: runBudgetMs, ipc: false })
  if (!contextsRun.record) throw new Error('The contexts child failed; nothing else is meaningful.')
  const { contexts, orientations } = contextsRun.record
  const parity = selected.map(item => {
    const derived = contexts[item.orientationId].find(context => context.workIndex === item.workIndex)
    if (!derived) return { orientationId: item.orientationId, workIndex: item.workIndex, role: item.role, matches: false, fields: [{ field: 'derived', matches: false }], d2aContextDigestMatches: false }
    const row = c25c.comparePhase2C25CContextParity(derived, c25aView.preSearchContexts.get(c25c.phase2c25cContextKey(item.orientationId, item.workIndex)), sha256)
    const d2aContextDigestMatches = derived.contextDigest === item.contextDigest
    return { ...row, role: item.role, d2aContextDigestMatches, matches: row.matches && d2aContextDigestMatches }
  })
  const parityMatches = parity.length === selected.length && parity.every(row => row.matches)
  console.log(`context parity ${parity.filter(r => r.matches).length}/${parity.length}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per run, NOT a Browser Worker)', node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(),
    osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), concurrency: d2c.PHASE2C25D2C_CONCURRENCY,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, rulesSha256,
    exportFileName: basename(exportPath), exportSha256, exportBytes: rawExport.length,
    d2aResultFileName: basename(d2aPath), d2aResultSha256: sha256(rawD2A), d2aMeasuredHead: d2aView.measuredHead,
    c25aEvidenceFileName: basename(c25aPath), c25aEvidenceSha256: sha256(rawC25A),
    c25cResultFileName: basename(c25cPath), c25cResultSha256: sha256(rawC25C),
    d2bResultFileName: basename(d2bPath), d2bResultSha256: sha256(rawD2B),
    calculationContext: contextsRun.record.calculationContext, researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps, nodeYield: 'setImmediate',
    searchExtent: contexts[orientationIds[0]]?.[0]?.extent ?? null, candidateStopBound: d2c.PHASE2C25D2C_CANDIDATE_STOP_BOUND,
    sampling: { childHeapLimitMb: d2c.PHASE2C25D2C_SAMPLING_CHILD_HEAP_MB, options: { ...d2c.PHASE2C25D2C_SAMPLING_OPTIONS }, thresholdsMiB: [...d2c.PHASE2C25D2C_PROFILE_THRESHOLDS_MIB],
      variants: d2c.PHASE2C25D2C_SAMPLING_VARIANTS.map(v => ({ id: v.id, v8Flags: [...v.v8Flags] })), variantsByRole: d2c.PHASE2C25D2C_VARIANTS_BY_ROLE },
    snapshot: { childHeapLimitMb: d2c.PHASE2C25D2C_SNAPSHOT_CHILD_HEAP_MB, nearHeapLimitSnapshots: d2c.PHASE2C25D2C_NEAR_HEAP_LIMIT_SNAPSHOTS, baselineSnapshotBeforeSearch: true,
      roles: [...d2c.PHASE2C25D2C_SNAPSHOT_ROLES] },
    progressHeartbeatMs: d2c.PHASE2C25D2C_PROGRESS_HEARTBEAT_MS, runBudgetMs,
    smoke: only === null && !skipSampling && !skipSnapshot && variantsOverride === null ? null : { only, skipSampling, skipSnapshot, variantsOverride } }
  const base = { phase: 'Issue #154 Phase 2-C2.5-D2-c: post-D2 heap profiling of the shallow Search-only OOM (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    workload: { ...workload, digest: d2c.phase2c25d2cWorkloadDigest(workload) }, c25cWorkload: { rule: c25cWorkload.rule, items: [...c25cWorkload.oomRepresentatives, ...c25cWorkload.controls].map(({ expected: _e, ...rest }) => rest) },
    selected, samplingPlan: samplingPlan.map(p => ({ variant: p.variant, contextKey: `${p.item.orientationId}#${p.item.workIndex}`, role: p.item.role })),
    probe: probe.record, parity,
    contexts: Object.fromEntries(Object.entries(contexts).map(([id, list]) => [id, list.map(({ searchReservation: _raw, ...rest }) => rest)])) }
  if (!parityMatches) {
    await write(outputPath, { ...base, status: 'parity_failed_no_profiling_run', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('Pre-search context parity with the C2.5-A evidence / the D2-a digest failed: no profiling was run.')
  }

  const taskOf = (item, runId, extra) => ({ runId, orientation: orientations[item.orientationId], workIndex: item.workIndex, targetWeaponId: item.targetWeaponId,
    contextDigest: item.contextDigest, ...extra })
  const fileManifest = async (dir, file) => {
    const path = join(dir, file)
    if (!existsSync(path)) return { file, present: false }
    const s = await stat(path)
    return { file, present: true, bytes: s.size, sha256: await sha256File(path), birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs }
  }

  // 3. Sampling runs: the role's variants x every selected context, one fresh 8 GB child each.
  const samplingRuns = []
  if (!skipSampling) {
    for (const { variant: variantId, item } of samplingPlan) {
      const variant = d2c.PHASE2C25D2C_SAMPLING_VARIANTS.find(v => v.id === variantId)
      const runId = `sampling-${variant.id}-${item.orientationId}-w${item.workIndex}`
      const run = await runChild(runId, 'sampling', taskOf(item, runId, { profilesDir }), {
        heapArgs: [`--max-old-space-size=${d2c.PHASE2C25D2C_SAMPLING_CHILD_HEAP_MB}`, ...variant.v8Flags], budgetMs: runBudgetMs, ipc: true })
      const ready = run.messages.find(m => m.message.type === 'ready')?.message ?? null
      const profiles = []
      for (const m of run.messages.filter(entry => entry.message.type === 'profile')) profiles.push({ ...m.message, receivedAtMs: m.receivedAtMs, ...(await fileManifest(profilesDir, m.message.file)) })
      const onDisk = (await readdir(profilesDir)).filter(f => f.startsWith(`${runId}.t`) && f.endsWith('.heapprofile'))
      const unannounced = []
      for (const file of onDisk.filter(f => !profiles.some(p => p.file === f))) unannounced.push(await fileManifest(profilesDir, file))
      const progressMessages = run.messages.filter(m => m.message.type === 'progress')
      const final = run.finalMessage
      const failures = run.messages.filter(m => m.message.type === 'profile_failed').map(m => m.message.event)
      const classified = c25c.classifyPhase2C25CRun({ kind: 'sampling', childOutcome: run.entry.childOutcome, searchStatus: final?.record.status ?? null, profilingFailures: failures.length })
      const capturedThresholds = profiles.flatMap(p => p.thresholdsMiB)
      const failedThresholds = failures.flatMap(f => f.thresholdsMiB)
      const thresholdStatus = d2c.PHASE2C25D2C_PROFILE_THRESHOLDS_MIB.map(t => ({ thresholdMiB: t, reason: d2c.phase2c25d2cThresholdMiss(t, { outcome: classified.outcome, capturedThresholds, failedThresholds }) }))
      const record = final === null ? null : final.record
      samplingRuns.push({ runId, variant: variant.id, v8Flags: [...variant.v8Flags], item, process: run.entry, ...classified, ready, scripts: ready ? await fileManifest(profilesDir, ready.scriptsFile) : null, profiles, unannouncedProfiles: unannounced,
        profileFailures: failures, thresholdStatus,
        lastProgress: progressMessages.at(-1)?.message ?? null, progressCount: progressMessages.length,
        final: final === null ? null : { ...final, record: { ...final.record, firstCandidateKey: undefined, firstCandidateKeySha256: final.record.firstCandidateKey === null ? null : sha256(final.record.firstCandidateKey) } },
        semanticParity: item.role === 'primary_oom' ? null : d2c.comparePhase2C25D2CSemantics(item, variant.id, record, sha256) })
    }
  }

  // 4. Snapshot runs: every primary OOM context, one fresh 512 MB child each, no sampling profiler.
  const snapshotRuns = []
  if (!skipSnapshot) {
    for (const item of snapshotPlan) {
      const runId = `snapshot-${item.orientationId}-w${item.workIndex}`
      const diagnosticDir = join(snapshotsDir, runId)
      await mkdir(diagnosticDir)
      const run = await runChild(runId, 'snapshot', taskOf(item, runId, { snapshotsDir: diagnosticDir }), {
        heapArgs: [`--max-old-space-size=${d2c.PHASE2C25D2C_SNAPSHOT_CHILD_HEAP_MB}`, `--heapsnapshot-near-heap-limit=${d2c.PHASE2C25D2C_NEAR_HEAP_LIMIT_SNAPSHOTS}`, `--diagnostic-dir=${diagnosticDir}`], budgetMs: runBudgetMs, ipc: true })
      const message = type => run.messages.find(m => m.message.type === type) ?? null
      const baselineMessage = message('baseline')
      const searchStarted = message('search_started')
      const files = (await readdir(diagnosticDir)).filter(f => f.endsWith('.heapsnapshot')).sort()
      const baselineFile = baselineMessage?.message.file ?? null
      const nearLimit = []
      for (const file of files.filter(f => f !== baselineFile)) {
        const manifest = await fileManifest(diagnosticDir, file)
        // Cheap tail check only (the analyzer parses the whole file): a complete V8 snapshot ends with "]}".
        const fd = openSync(join(diagnosticDir, file), 'r')
        const size = fstatSync(fd).size
        const tail = Buffer.alloc(Math.min(64, size))
        readSync(fd, tail, 0, tail.length, size - tail.length)
        closeSync(fd)
        const writtenAt = manifest.birthtimeMs
        const progressBefore = run.messages.filter(m => m.message.type === 'progress' && m.message.at <= writtenAt).at(-1)?.message ?? null
        nearLimit.push({ ...manifest, tailLooksComplete: /\]\s*\}\s*$/.test(tail.toString('utf8')),
          writtenAfterSearchStart: searchStarted !== null && writtenAt >= searchStarted.message.at, lastProgressBeforeWrite: progressBefore })
      }
      snapshotRuns.push({ runId, item, process: run.entry, diagnosticDir: basename(diagnosticDir),
        ready: message('ready')?.message ?? null, baseline: baselineMessage === null ? null : { ...baselineMessage.message, ...(await fileManifest(diagnosticDir, baselineFile)) },
        searchStartedAt: searchStarted?.message.at ?? null, nearLimitSnapshots: nearLimit,
        lastProgress: run.messages.filter(m => m.message.type === 'progress').at(-1)?.message ?? null, final: run.finalMessage === null ? null
          : { ...run.finalMessage, record: { ...run.finalMessage.record, firstCandidateKey: undefined } } })
    }
  }

  const record = { ...base, status: 'completed', samplingRuns, snapshotRuns, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), sampling: samplingRuns.map(r => `${r.runId}: ${r.outcome} profiles=${r.profiles.length}${r.semanticParity ? ` contaminated=${r.semanticParity.contaminated}` : ''}`),
    snapshot: snapshotRuns.map(r => `${r.runId}: ${r.process.childOutcome} files=${r.nearLimitSnapshots.map(s => s.bytes).join(',')}`), wallMs: record.wallMs }, null, 2))
})
