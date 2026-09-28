// Issue #154 Phase 2-C2.5-C Research only: heap profiling of the Search-only OOM (sampling heap profile + heap snapshot).
//
// Parent (default role):
//   0. reads the Phase 2-C2.5-A committed evidence (explicit --c25a) for workload selection and context parity ONLY,
//      and hashes the Phase 2-C2.5-B evidence (explicit --c25b) for provenance only;
//   1. `probe` child: checks, on synthetic garbage only, whether this Node / V8 honours the live-object sampling
//      options (a profile with includeObjectsCollectedByMajorGC=false must not count collected objects);
//   2. `contexts` child: this run's own baseline (ordinary Production Planner over the original Export) and the kernel
//      pre-search context of every selected context (the unchanged C2.5-A derivation). The parent checks each against
//      the C2.5-A evidence, field by field, and stops before any profiling on a mismatch;
//   3. `sampling` children (8192 MB, one fresh process per context, concurrency 1): the C2.5-A Search call with a
//      live-object sampling heap profiler, a profile written the first time heapUsed crosses each Research threshold;
//   4. `snapshot` children (small heap, --heapsnapshot-near-heap-limit=1, one fresh process per OOM representative):
//      the same Search with no profiler, a pre-Search baseline snapshot and the near-limit snapshot.
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
if (!exportPath && role !== 'probe') throw new Error('Usage: node scripts/run-planner-global-phase2c25c.mjs --export <external.json> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --c25b docs/PLANNER_GLOBAL_PHASE2C25B_RESULTS.json --run-dir <new dir .local> --profiles-dir <new dir .local> --snapshots-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --only <orientationId#workIndex,...> --skip-sampling --skip-snapshot --snapshot-heap-mb N]')

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

function startHeartbeat(c25c, progress, searchStartedAt) {
  const timer = setInterval(() => {
    process.send({ type: 'progress', at: Date.now(), elapsedMs: performance.now() - searchStartedAt(), memory: memorySample(), progress: progress.snapshot() })
  }, c25c.PHASE2C25C_PROGRESS_HEARTBEAT_MS)
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
    const { c25c } = modules
    const { engine, prepared, preparationMs } = await prepareSearch(modules, task)
    // Script table (pre-Search): every script url, and the inline source map of Repository modules.
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
    const requested = { ...c25c.PHASE2C25C_SAMPLING_OPTIONS }
    let samplingOptions = { requested, actual: requested, error: null }
    try {
      await post('HeapProfiler.startSampling', requested)
    } catch (error) {
      const fallback = { samplingInterval: requested.samplingInterval, stackDepth: requested.stackDepth }
      await post('HeapProfiler.startSampling', fallback)
      samplingOptions = { requested, actual: fallback, error: String(error) }
    }
    const progress = c25c.createPhase2C25CProgressObserver()
    let searchStarted = 0
    let firstCandidate = false
    const tracker = c25c.createPhase2C25CThresholdTracker(c25c.PHASE2C25C_PROFILE_THRESHOLDS_MIB)
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
    const stopHeartbeat = startHeartbeat(c25c, progress, () => searchStarted)
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
    const { c25c } = modules
    const { engine, prepared, preparationMs } = await prepareSearch(modules, task)
    const progress = c25c.createPhase2C25CProgressObserver()
    await send({ type: 'ready', preparationMs, preSearchMemory: memorySample(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit })
    const baselineStarted = performance.now()
    const baselinePath = join(task.snapshotsDir, `${task.runId}.baseline.heapsnapshot`)
    writeHeapSnapshot(baselinePath)
    await send({ type: 'baseline', at: Date.now(), file: basename(baselinePath), writeMs: performance.now() - baselineStarted, memoryAfter: memorySample() })
    const searchStarted = performance.now()
    await send({ type: 'search_started', at: Date.now() })
    const stopHeartbeat = startHeartbeat(c25c, progress, () => searchStarted)
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
const c25aPath = option('--c25a'), c25bPath = option('--c25b'), runDir = option('--run-dir'), profilesDir = option('--profiles-dir'), snapshotsDir = option('--snapshots-dir'), outputPath = option('--output')
if (!c25aPath || !c25bPath || !runDir || !profilesDir || !snapshotsDir || !outputPath) throw new Error('The parent needs --c25a, --c25b, --run-dir, --profiles-dir, --snapshots-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
for (const dir of [runDir, profilesDir, snapshotsDir]) if (existsSync(dir)) throw new Error(`Directory already exists: ${resolve(dir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
const only = option('--only')?.split(',') ?? null
const skipSampling = args.includes('--skip-sampling'), skipSnapshot = args.includes('--skip-snapshot')
const snapshotHeapOverride = option('--snapshot-heap-mb') === undefined ? null : Number(option('--snapshot-heap-mb'))
if ((only !== null || skipSampling || skipSnapshot || snapshotHeapOverride !== null) && !allowUncommitted) throw new Error('--only / --skip-* / --snapshot-heap-mb are non-formal smoke options and need --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
const rawC25A = await readFile(c25aPath)
const rawC25B = await readFile(c25bPath)
for (const dir of [runDir, profilesDir, snapshotsDir]) await mkdir(dir, { recursive: true })
const scriptPath = 'scripts/run-planner-global-phase2c25c.mjs'
const processes = []
const phaseStarted = performance.now()

await withModules({ c25c: CHILD_MODULES.c25c }, async ({ c25c }) => {
  const view = c25c.parsePhase2C25CEvidence(JSON.parse(rawC25A.toString('utf8')))
  if (view.exportSha256 !== exportSha256) throw new Error('The Phase 2-C2.5-A evidence was measured on another Export.')
  const workload = c25c.selectPhase2C25CWorkload(view)
  const selected = [...workload.oomRepresentatives, ...workload.controls].filter(item => only === null || only.includes(`${item.orientationId}#${item.workIndex}`))
  const runBudgetMs = c25c.PHASE2C25C_RUN_BUDGET_MS
  const snapshotHeapMb = snapshotHeapOverride ?? c25c.PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB
  console.log(`selected ${selected.length}: ${selected.map(s => `${s.orientationId}#${s.workIndex}(${s.role})`).join(' ')}`)

  /** One fresh child. Resolves with its messages and a classified outcome; never throws for a child failure. */
  function runChild(id, childRole, task, { heapArgs, budgetMs, ipc, extraArgs = [] }) {
    return new Promise(done => {
      const taskPath = join(runDir, `${id}.task.json`)
      const recordPath = join(runDir, `${id}.record.json`)
      const messagesPath = join(runDir, `${id}.messages.jsonl`)
      const start = async () => {
        await write(taskPath, task)
        const childArgs = [...heapArgs, scriptPath, '--role', childRole, ...(exportPath ? ['--export', exportPath] : []), '--task', taskPath, '--record', recordPath, ...extraArgs]
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

  // 2. Contexts from this run's own baseline, then parity with the C2.5-A evidence before any profiling.
  const orientationIds = [...new Set(selected.map(item => item.orientationId))]
  const contextsRun = await runChild('contexts', 'contexts', { orientationIds }, { heapArgs: ['--max-old-space-size=8192'], budgetMs: runBudgetMs, ipc: false })
  if (!contextsRun.record) throw new Error('The contexts child failed; nothing else is meaningful.')
  const { contexts, orientations } = contextsRun.record
  const parity = selected.map(item => {
    const derived = contexts[item.orientationId].find(context => context.workIndex === item.workIndex)
    if (!derived) return { orientationId: item.orientationId, workIndex: item.workIndex, matches: false, fields: [{ field: 'derived', matches: false }] }
    return c25c.comparePhase2C25CContextParity(derived, view.preSearchContexts.get(c25c.phase2c25cContextKey(item.orientationId, item.workIndex)), sha256)
  })
  const parityMatches = parity.every(row => row.matches) && selected.every(item => contexts[item.orientationId].find(c => c.workIndex === item.workIndex)?.contextDigest === item.contextDigest)
  console.log(`context parity ${parity.filter(r => r.matches).length}/${parity.length}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per run, NOT a Browser Worker)', node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(),
    osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), concurrency: c25c.PHASE2C25C_CONCURRENCY,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256, exportBytes: rawExport.length,
    c25aEvidenceFileName: basename(c25aPath), c25aEvidenceSha256: sha256(rawC25A), c25aMeasuredHead: view.measuredHead,
    c25bEvidenceFileName: basename(c25bPath), c25bEvidenceSha256: sha256(rawC25B),
    calculationContext: contextsRun.record.calculationContext, researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps, nodeYield: 'setImmediate',
    searchExtent: contexts[orientationIds[0]]?.[0]?.extent ?? null, candidateStopBound: c25c.PHASE2C25C_CANDIDATE_STOP_BOUND,
    sampling: { childHeapLimitMb: c25c.PHASE2C25C_SAMPLING_CHILD_HEAP_MB, options: { ...c25c.PHASE2C25C_SAMPLING_OPTIONS }, thresholdsMiB: [...c25c.PHASE2C25C_PROFILE_THRESHOLDS_MIB],
      variants: c25c.PHASE2C25C_SAMPLING_VARIANTS.map(v => ({ id: v.id, v8Flags: [...v.v8Flags] })) },
    snapshot: { childHeapLimitMb: snapshotHeapMb, nearHeapLimitSnapshots: c25c.PHASE2C25C_NEAR_HEAP_LIMIT_SNAPSHOTS, baselineSnapshotBeforeSearch: true },
    progressHeartbeatMs: c25c.PHASE2C25C_PROGRESS_HEARTBEAT_MS, runBudgetMs,
    smoke: only === null && !skipSampling && !skipSnapshot && snapshotHeapOverride === null ? null : { only, skipSampling, skipSnapshot, snapshotHeapOverride } }
  const base = { phase: 'Issue #154 Phase 2-C2.5-C: heap profiling of the Search-only OOM (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    workload, selected, probe: probe.record, parity,
    contexts: Object.fromEntries(Object.entries(contexts).map(([id, list]) => [id, list.map(({ searchReservation: _raw, ...rest }) => rest)])) }
  if (!parityMatches) {
    await write(outputPath, { ...base, status: 'parity_failed_no_profiling_run', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('Pre-search context parity with the Phase 2-C2.5-A evidence failed: no profiling was run.')
  }

  const taskOf = (item, runId, extra) => ({ runId, orientation: orientations[item.orientationId], workIndex: item.workIndex, targetWeaponId: item.targetWeaponId,
    contextDigest: item.contextDigest, ...extra })
  const fileManifest = async (dir, file) => {
    const path = join(dir, file)
    if (!existsSync(path)) return { file, present: false }
    const s = await stat(path)
    return { file, present: true, bytes: s.size, sha256: await sha256File(path), birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs }
  }

  // 3. Sampling runs: every sampling variant x every selected context, one fresh 8 GB child each.
  const samplingRuns = []
  if (!skipSampling) {
    for (const variant of c25c.PHASE2C25C_SAMPLING_VARIANTS) for (const item of selected) {
      const runId = `sampling-${variant.id}-${item.orientationId}-w${item.workIndex}`
      const run = await runChild(runId, 'sampling', taskOf(item, runId, { profilesDir }), {
        heapArgs: [`--max-old-space-size=${c25c.PHASE2C25C_SAMPLING_CHILD_HEAP_MB}`, ...variant.v8Flags], budgetMs: runBudgetMs, ipc: true })
      const ready = run.messages.find(m => m.message.type === 'ready')?.message ?? null
      const profiles = []
      for (const m of run.messages.filter(entry => entry.message.type === 'profile')) profiles.push({ ...m.message, receivedAtMs: m.receivedAtMs, ...(await fileManifest(profilesDir, m.message.file)) })
      const onDisk = (await readdir(profilesDir)).filter(f => f.startsWith(`${runId}.t`) && f.endsWith('.heapprofile'))
      const unannounced = []
      for (const file of onDisk.filter(f => !profiles.some(p => p.file === f))) unannounced.push(await fileManifest(profilesDir, file))
      const progressMessages = run.messages.filter(m => m.message.type === 'progress')
      const final = run.finalMessage
      const classified = c25c.classifyPhase2C25CRun({ kind: 'sampling', childOutcome: run.entry.childOutcome, searchStatus: final?.record.status ?? null,
        profilingFailures: run.messages.filter(m => m.message.type === 'profile_failed').length })
      samplingRuns.push({ runId, variant: variant.id, v8Flags: [...variant.v8Flags], item, process: run.entry, ...classified, ready, scripts: ready ? await fileManifest(profilesDir, ready.scriptsFile) : null, profiles, unannouncedProfiles: unannounced,
        profileFailures: run.messages.filter(m => m.message.type === 'profile_failed').map(m => m.message.event),
        lastProgress: progressMessages.at(-1)?.message ?? null, progressCount: progressMessages.length,
        final: final === null ? null : { ...final, record: { ...final.record, firstCandidateKey: undefined, firstCandidateKeySha256: final.record.firstCandidateKey === null ? null : sha256(final.record.firstCandidateKey) },
        },
        control: item.role === 'oom_representative' ? null : c25c.comparePhase2C25CControl(item, final === null ? null : final.record, sha256) })
    }
  }

  // 4. Snapshot runs: every OOM representative, one fresh small-heap child each, no sampling profiler.
  const snapshotRuns = []
  if (!skipSnapshot) {
    for (const item of selected.filter(i => i.role === 'oom_representative')) {
      const runId = `snapshot-${item.orientationId}-w${item.workIndex}`
      const diagnosticDir = join(snapshotsDir, runId)
      await mkdir(diagnosticDir)
      const run = await runChild(runId, 'snapshot', taskOf(item, runId, { snapshotsDir: diagnosticDir }), {
        heapArgs: [`--max-old-space-size=${snapshotHeapMb}`, `--heapsnapshot-near-heap-limit=${c25c.PHASE2C25C_NEAR_HEAP_LIMIT_SNAPSHOTS}`, `--diagnostic-dir=${diagnosticDir}`], budgetMs: runBudgetMs, ipc: true })
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
  console.log(JSON.stringify({ output: resolve(outputPath), sampling: samplingRuns.map(r => `${r.runId}: ${r.outcome} profiles=${r.profiles.length}`),
    snapshot: snapshotRuns.map(r => `${r.runId}: ${r.process.childOutcome} files=${r.nearLimitSnapshots.map(s => s.bytes).join(',')}`), wallMs: record.wallMs }, null, 2))
})
