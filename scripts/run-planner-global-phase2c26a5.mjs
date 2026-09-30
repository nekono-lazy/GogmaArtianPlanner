// Issue #154 Phase 2-C2.6-A5 Research only: Bonus Ideal filter internal runtime localization (V8 sampling CPU profiler).
//
// Parent (default role):
//   0. reads the committed Phase 2-C2.6-A / A2 / A3 RESULTs (baseline / condition parity, A2 rule and A3 selection
//      authorities) and the committed Phase 2-C2.6-A4 RESULT (--c26a4-result, the primary selection authority), failing
//      closed unless each is the registered formal result made against exactly the files read (SHA chain). The primaries
//      are A4's selection and the no-inlining diagnostic representative is derived from A4's evidence (no ID fixed);
//   1. `probe` child: Profiler.enable / setSamplingInterval / start / stop must be accepted by this Node / V8, the profile
//      must carry nodes / samples / timeDeltas / startTime / endTime on the process.hrtime clock, every required source
//      file must have an inline source map, and a probe frame must resolve to satisfiesIdealBonuses' declaration line.
//      A failed probe stops the run (no fallback);
//   2. `baseline` child: the ordinary Production Planner over the original Export, as in C2.6-A..A4; its orientations
//      must equal the C2.6-A authority's;
//   3. every run condition must equal A4's (concurrency 1 and the primary Node flags included);
//   4. `kernel` children (jit_default, the primary evidence): the A4 primaries, once each (no retry), one at a time, each
//      = the unchanged current Planner Alternative kernel with A4's instrumentation (lifecycle + the Search section
//      boundary observer, its durable records and heartbeat) plus the filter interval stamps, and the CPU profiler from
//      120 s to 720 s after the first Search start; the Search then continues to the 30-minute budget;
//   5. `diagnostic` child (no_inlining, never Production-like): the representative only, same profile window; it stops
//      its own run once its profile is written.
// The profile, the script table (scriptId -> url + inline source maps, from Debugger.scriptParsed while the modules
// load; the Debugger is disabled before the kernel runs) and a capture manifest (window, both clocks around the profiler
// calls, filter interval snapshot) are written synchronously by the child; nothing is written or sent per solution.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, readFileSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { Session } from 'node:inspector'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a5.mjs --export <external.json> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --run-dir <new dir .local> --profiles-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...> --smoke-budget-ms <ms> --smoke-warmup-ms <ms> --smoke-stop-ms <ms> --skip-diagnostic]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a5.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const readJsonLines = path => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line)) : []
const clockPair = () => { const a = performance.now(); const hrMs = Number(process.hrtime.bigint()) / 1e6; const b = performance.now(); return { perfMs: (a + b) / 2, hrMs, precisionMs: b - a } }

async function loadModules(server) {
  return {
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    a2: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts'),
    a3: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts'),
    a4: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts'),
    a5: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts'),
    analysis: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    instrumentation: await server.ssrLoadModule('/src/benchmarks/plannerAlternativeBenchmarkInstrumentation.ts'),
    targetEvaluator: await server.ssrLoadModule('/src/domain/target/targetEvaluator.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

/** Reads the source texts of the registered functions' files (the span authority is the working tree = the run's HEAD). */
const readSources = files => Object.fromEntries(files.map(file => [file, readFileSync(file, 'utf8')]))

/** The child's script table: every parsed script's url, and the inline source map of Repository scripts. */
function scriptTableRows(scripts, normalize) {
  return [...scripts.entries()].map(([scriptId, s]) => {
    let map = null
    const file = normalize(s.url)
    if (file.startsWith('src/') && s.sourceMapURL.startsWith('data:application/json;base64,')) {
      map = JSON.parse(Buffer.from(s.sourceMapURL.slice('data:application/json;base64,'.length), 'base64').toString('utf8'))
    }
    return { scriptId, url: s.url, file, sourceMap: map }
  })
}

if (role !== 'parent') {
  // ------------------------------------------------------------------ child
  const taskPath = option('--task'), recordPath = option('--record'), profilesDir = option('--profiles-dir'), childId = option('--child-id')
  const eventsPath = option('--events'), heartbeatsPath = option('--heartbeats'), runtimePath = option('--runtime')
  if (!recordPath) throw new Error('A child needs --record.')
  const profiled = role === 'kernel' || role === 'diagnostic' || role === 'probe'
  const session = profiled ? new Session() : null
  const post = (method, params) => new Promise((ok, ko) => session.post(method, params, (error, result) => error ? ko(error) : ok(result)))
  const scripts = new Map()
  if (session) {
    session.connect()
    // scriptId -> url / inline source map, only while the modules load; the Debugger is disabled before any calculation.
    session.on('Debugger.scriptParsed', ({ params }) => { scripts.set(params.scriptId, { url: params.url, sourceMapURL: params.sourceMapURL ?? '' }) })
    await post('Debugger.enable')
  }
  const server = await createLoader()
  const modules = await loadModules(server)
  if (session) await post('Debugger.disable')
  const { c26a, a4, a5, analysis, research, runner, instrumentation, targetEvaluator, ProductionRngEngine } = modules
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const memoryTimer = setInterval(() => tracker.sample(process.memoryUsage()), a5.PHASE2C26A5_MEMORY_SAMPLE_INTERVAL_MS)
  let heartbeatTimer = null
  const fds = []
  const writeScriptTable = () => {
    const rows = scriptTableRows(scripts, analysis.normalizePhase2C26A5Url)
    const body = JSON.stringify(rows)
    const file = `${childId}.scripts.json`
    writeFileSync(join(profilesDir, file), body)
    const requiredSourceMaps = Object.fromEntries(a5.PHASE2C26A5_REQUIRED_SOURCE_FILES.map(f => [f, rows.some(row => row.file === f && row.sourceMap !== null)]))
    return { rows, record: { file, sha256: sha256(body), bytes: Buffer.byteLength(body), scriptCount: rows.length, sourceMappedCount: rows.filter(row => row.sourceMap).length, requiredSourceMaps } }
  }
  try {
    tracker.sample(process.memoryUsage())
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    const dependencies = { createEngine: () => new ProductionRngEngine(), yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) }
    const started = performance.now()
    let result = null, extra = {}
    if (role === 'baseline') result = await c26a.runPhase2C26ABaseline(input, dependencies)
    else if (role === 'probe') {
      // ---- profiler probe: every call must be accepted and the profile must be usable, else no formal run.
      const { rows, record: scriptsRecord } = writeScriptTable()
      const steps = {}
      const accept = async (name, fn) => { try { const value = await fn(); steps[name] = { accepted: true }; return value } catch (error) { steps[name] = { accepted: false, error: String(error) }; throw error } }
      const interval = a5.PHASE2C26A5_PROFILER.requestedSamplingIntervalUs
      let probe = { valid: false, steps, scripts: scriptsRecord }
      try {
        await accept('Profiler.enable', () => post('Profiler.enable'))
        await accept('Profiler.setSamplingInterval', () => post('Profiler.setSamplingInterval', { interval }))
        const startPre = clockPair()
        await accept('Profiler.start', () => post('Profiler.start'))
        const startPost = clockPair()
        // CPU work through the registered predicate (the real Master and the first Target of the Export).
        const target = input.targetWeapons.find(t => Array.isArray(t.idealBonuses) && t.idealBonuses.length === 5)
        if (!target) throw new Error('No Target with five Ideal bonuses for the probe.')
        const rotated = [...target.idealBonuses.slice(1), target.idealBonuses[0]]
        let hits = 0
        const until = performance.now() + 1500
        while (performance.now() < until) for (let i = 0; i < 1000; i++) if (targetEvaluator.satisfiesIdealBonuses(target, i % 2 ? rotated : target.idealBonuses, 'gogma_artian', input.master)) hits += 1
        const stopPre = clockPair()
        const { profile } = await accept('Profiler.stop', () => post('Profiler.stop'))
        const stopPost = clockPair()
        const keys = ['nodes', 'samples', 'timeDeltas', 'startTime', 'endTime']
        const keysPresent = Object.fromEntries(keys.map(key => [key, profile?.[key] !== undefined]))
        const validated = analysis.validatePhase2C26A5CpuProfile(profile)
        const alignment = analysis.validatePhase2C26A5ClockAlignment(validated, { startPre, startPost, stopPre, stopPost })
        const spans = analysis.derivePhase2C26A5FunctionSpans(readSources([...new Set(analysis.PHASE2C26A5_FUNCTION_REGISTRY.map(e => e.file))]))
        const table = analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
        const predicateSpan = spans.find(s => s.functionName === 'satisfiesIdealBonuses')
        const resolved = validated.nodes.map(node => analysis.resolvePhase2C26A5Frame(node.callFrame, table, spans))
        const predicateFrames = resolved.filter(frame => frame.functionName === 'satisfiesIdealBonuses' && frame.file === 'src/domain/target/targetEvaluator.ts')
        const predicateLineMatches = predicateFrames.length > 0 && predicateFrames.every(frame => frame.originalLine === predicateSpan.startLine)
        const deltas = [...validated.timeDeltas].sort((a, b) => a - b)
        const allRequired = Object.values(scriptsRecord.requiredSourceMaps).every(Boolean)
        const issues = [
          ...keys.filter(key => !keysPresent[key]).map(key => `profile lacks ${key}`),
          ...(validated.samples.length >= 50 ? [] : [`only ${validated.samples.length} samples`]),
          ...alignment.issues.map(issue => `clock: ${issue}`),
          ...(allRequired ? [] : ['a required source file has no source map']),
          ...(predicateLineMatches ? [] : ['no probe frame resolved to satisfiesIdealBonuses at its declaration line']),
        ]
        probe = { valid: issues.length === 0, issues, steps, requestedSamplingIntervalUs: interval, observedMedianIntervalUs: deltas[Math.floor(deltas.length / 2)] ?? null,
          keysPresent, samples: validated.samples.length, nodes: validated.nodes.length, hits,
          alignment: { valid: alignment.valid, issues: alignment.issues, offsetSpreadMs: alignment.offsetSpreadMs, maxPairPrecisionMs: alignment.maxPairPrecisionMs,
            profileDurationMs: alignment.profileDurationMs, negativeDeltas: alignment.negativeDeltas },
          scripts: scriptsRecord, predicateSpan, predicateFrameLines: predicateFrames.map(frame => frame.originalLine), predicateLineMatches }
      } catch (error) {
        probe = { ...probe, valid: false, issues: [`probe threw: ${String(error)}`] }
      }
      extra = { probe }
    } else if (role === 'kernel' || role === 'diagnostic') {
      if (!eventsPath || !heartbeatsPath || !runtimePath || !profilesDir || !childId) throw new Error('A profiled child needs --events, --heartbeats, --runtime, --profiles-dir and --child-id.')
      const { record: scriptsRecord } = writeScriptTable()
      const eventsFd = openSync(eventsPath, 'a'), heartbeatsFd = openSync(heartbeatsPath, 'a'), runtimeFd = openSync(runtimePath, 'a')
      fds.push(eventsFd, heartbeatsFd, runtimeFd)
      const durable = (fd, record) => { writeSync(fd, JSON.stringify(record) + '\n'); process.send?.(record) }
      let counting = null
      dependencies.createEngine = () => { counting = instrumentation.createCountingRngEngine(new ProductionRngEngine()); return counting.engine }
      const zero = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }
      // A4's kernel progress, unchanged (lifecycle, section boundary tracker, durable records, heartbeat).
      const progress = a4.createPhase2C26A4KernelProgress({
        now: () => performance.now(), predictionCounts: () => counting?.counts() ?? zero,
        emitLifecycle: record => durable(eventsFd, record), emitSectionStarted: record => durable(runtimeFd, record),
        emitWorkSummary: record => durable(runtimeFd, record), emitSearchSummary: record => durable(runtimeFd, record),
      })
      const profilerConfig = task.profiler
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: profilerConfig.requestedSamplingIntervalUs })
      let intervalTracker = null
      let finishDiagnostic = null
      const diagnosticDone = new Promise(done => { finishDiagnostic = done })
      const controller = a5.createPhase2C26A5ProfileController({
        clockPair, config: profilerConfig,
        setTimer: (callback, delayMs) => { setTimeout(callback, delayMs) },
        startProfiler: () => post('Profiler.start'),
        stopProfiler: async () => (await post('Profiler.stop')).profile,
        onFrozen: () => intervalTracker.freeze(),
        onCaptured: (profile, window) => {
          const body = JSON.stringify(profile)
          const file = `${childId}.cpuprofile`
          writeFileSync(join(profilesDir, file), body)
          const capture = { kind: 'profile_captured', childProcessMs: performance.now(), window, intervals: intervalTracker.snapshot(),
            profile: { file, sha256: sha256(body), bytes: Buffer.byteLength(body), samples: profile.samples.length, nodes: profile.nodes.length },
            scripts: scriptsRecord, predictionCounts: counting?.counts() ?? zero, heartbeat: { ...progress.heartbeat(), searchRuntime: undefined } }
          const manifest = `${childId}.capture.json`
          writeFileSync(join(profilesDir, manifest), JSON.stringify(capture))
          process.send?.({ kind: 'profile_captured', manifest, childProcessMs: capture.childProcessMs, window, samples: profile.samples.length, intervals: capture.intervals.intervals.length })
          if (role === 'diagnostic') finishDiagnostic()
        },
      })
      intervalTracker = a5.createPhase2C26A5FilterIntervalTracker({ now: () => performance.now(), onSearchStarted: atMs => controller.onSearchStarted(atMs) })
      const kernelInstrumentation = a5.createPhase2C26A5KernelInstrumentation(progress.instrumentation, intervalTracker)
      const memory = () => { const usage = process.memoryUsage(); const maxima = tracker.sample(usage); return { current: { heapUsed: usage.heapUsed, rss: usage.rss }, maxima } }
      const origin = progress.start()
      durable(eventsFd, { kind: 'kernel_invoked', originChildProcessMs: origin, childProcessMs: performance.now() })
      heartbeatTimer = setInterval(() => durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, profilerState: controller.state(), childProcessMs: performance.now() }), a5.PHASE2C26A5_HEARTBEAT_INTERVAL_MS)
      const kernel = a5.runPhase2C26A5Kernel(input, task, dependencies, kernelInstrumentation)
      if (role === 'diagnostic') {
        // The diagnostic stops once its profile is written (the kernel promise is abandoned; the process exits).
        const winner = await Promise.race([diagnosticDone.then(() => 'captured'), kernel.then(() => 'kernel_ended', error => { throw error })])
        if (winner === 'kernel_ended') await controller.onKernelEnded()
        extra = { diagnosticStoppedBy: winner, profilerState: controller.state(), window: controller.window() }
      } else {
        try { result = await kernel } finally { await controller.onKernelEnded() }
        durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, profilerState: controller.state(), childProcessMs: performance.now(), final: true })
        extra = { profilerState: controller.state(), window: controller.window() }
      }
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    tracker.sample(process.memoryUsage())
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, yields, ...extra,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, result })
  } finally {
    clearInterval(memoryTimer)
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    for (const fd of fds) closeSync(fd)
    if (role !== 'diagnostic') await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), profilesDir = option('--profiles-dir'), outputPath = option('--output')
const c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result'), a4Path = option('--c26a4-result')
if (!runDir || !profilesDir || !outputPath || !c26aPath || !a2Path || !a3Path || !a4Path) throw new Error('The parent needs --c26a-result, --c26a2-result, --c26a3-result, --c26a4-result, --run-dir, --profiles-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
if (existsSync(profilesDir)) throw new Error(`Profiles dir already exists: ${resolve(profilesDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: a subset of this baseline's orientations, a shorter budget / window, or no diagnostic.
const smokeOrientationIds = option('--smoke-orientations')?.split(',') ?? null
const smokeNumber = name => option(name) === undefined ? null : Number(option(name))
const smokeBudgetMs = smokeNumber('--smoke-budget-ms'), smokeWarmupMs = smokeNumber('--smoke-warmup-ms'), smokeStopMs = smokeNumber('--smoke-stop-ms')
const skipDiagnostic = args.includes('--skip-diagnostic')
const smokeUsed = smokeOrientationIds !== null || smokeBudgetMs !== null || smokeWarmupMs !== null || smokeStopMs !== null || skipDiagnostic
if (smokeUsed && !allowUncommitted) throw new Error('Smoke options are non-formal and need --allow-uncommitted.')
for (const [name, value] of [['--smoke-budget-ms', smokeBudgetMs], ['--smoke-warmup-ms', smokeWarmupMs], ['--smoke-stop-ms', smokeStopMs]]) {
  if (value !== null && !(Number.isInteger(value) && value > 0)) throw new Error(`${name} must be a positive integer.`)
}

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawC26a = await readFile(c26aPath), rawA2 = await readFile(a2Path), rawA3 = await readFile(a3Path), rawA4 = await readFile(a4Path)
await mkdir(runDir, { recursive: true })
await mkdir(profilesDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

const server = await createLoader()
const { c26a, a2, a3, a4, a5, ProductionRngEngine } = await loadModules(server)
const parsedC26a = a2.parsePhase2C26AAuthority(JSON.parse(rawC26a.toString('utf8')))
if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
const authority = parsedC26a.authority
const parsedA2 = a3.parsePhase2C26A2ResultAuthority(JSON.parse(rawA2.toString('utf8')), sha256(rawC26a), authority)
if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
const a2Authority = parsedA2.authority
const parsedA3 = a4.parsePhase2C26A3ResultAuthority(JSON.parse(rawA3.toString('utf8')), sha256(rawC26a), sha256(rawA2), a2Authority, authority)
if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
const a3Authority = parsedA3.authority
const parsedA4 = a5.parsePhase2C26A4ResultAuthority(JSON.parse(rawA4.toString('utf8')), { c26a: sha256(rawC26a), a2: sha256(rawA2), a3: sha256(rawA3) }, a3Authority, authority)
if (!parsedA4.valid) throw new Error(`The Phase 2-C2.6-A4 RESULT is not the registered authority: ${parsedA4.issues.join('; ')}`)
const a4Authority = parsedA4.authority
const diagnosticSelection = a5.selectPhase2C26A5DiagnosticRepresentative(a4Authority)
const childHeapMb = a5.PHASE2C26A5_CHILD_HEAP_MB
const concurrency = a5.PHASE2C26A5_CONCURRENCY
const budgetMs = smokeBudgetMs ?? a5.PHASE2C26A5_ORIENTATION_BUDGET_MS
const profiler = { ...a5.PHASE2C26A5_PROFILER,
  ...(smokeWarmupMs === null ? {} : { warmupMs: smokeWarmupMs }),
  ...(smokeStopMs === null ? {} : { profileStopMs: smokeStopMs }) }
profiler.requestedProfileDurationMs = profiler.profileStopMs - profiler.warmupMs
if (!(profiler.requestedProfileDurationMs > 0)) throw new Error('The profile window is empty.')
const primaryFlags = [...a5.PHASE2C26A5_PRIMARY_NODE_FLAGS]
const diagnosticFlags = [...a5.PHASE2C26A5_DIAGNOSTIC_NODE_FLAGS]

/** One fresh child. Resolves with its record (or null), classified outcome and IPC view; never throws for a child failure. */
function runChild(id, childRole, task, childBudgetMs, nodeFlags) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const eventsPath = join(runDir, `${id}.events.jsonl`)
    const heartbeatsPath = join(runDir, `${id}.heartbeats.jsonl`)
    const runtimePath = join(runDir, `${id}.runtime.jsonl`)
    const profiledRole = childRole === 'kernel' || childRole === 'diagnostic'
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--child-id', id, '--profiles-dir', profilesDir,
        ...(taskPath ? ['--task', taskPath] : []), ...(profiledRole ? ['--events', eventsPath, '--heartbeats', heartbeatsPath, '--runtime', runtimePath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null
      const ipc = { lifecycleMessages: 0, heartbeatMessages: 0, sectionStartMessages: 0, workSummaryMessages: 0, searchSummaryMessages: 0, lastLifecycle: null,
        lastHeartbeat: null, lastHeartbeatReceivedAtMs: null, maxHeartbeatGapMs: null, lastSectionStarted: null, kernelInvoked: null, profileCaptured: null, profileCapturedAtMs: null }
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, childBudgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        const receivedAtMs = performance.now() - began
        switch (message?.kind) {
          case 'lifecycle': ipc.lifecycleMessages += 1; ipc.lastLifecycle = { ...message, receivedAtMs }; break
          case 'heartbeat':
            if (ipc.lastHeartbeatReceivedAtMs !== null) ipc.maxHeartbeatGapMs = Math.max(ipc.maxHeartbeatGapMs ?? 0, receivedAtMs - ipc.lastHeartbeatReceivedAtMs)
            ipc.heartbeatMessages += 1; ipc.lastHeartbeat = { ...message, searchRuntime: undefined, activeStack: message.searchRuntime?.activeStack ?? null }
            ipc.lastHeartbeatReceivedAtMs = receivedAtMs
            break
          case 'search_section_started': ipc.sectionStartMessages += 1; ipc.lastSectionStarted = { ...message, receivedAtMs }; break
          case 'search_work_summary': ipc.workSummaryMessages += 1; break
          case 'search_summary': ipc.searchSummaryMessages += 1; break
          case 'kernel_invoked': ipc.kernelInvoked = message; break
          case 'profile_captured':
            ipc.profileCaptured = message; ipc.profileCapturedAtMs = receivedAtMs
            console.log(`${new Date().toISOString()} PROFILE ${id} samples=${message.samples} intervals=${message.intervals} start+${(message.window.startDelayMs / 1000).toFixed(2)}s stop+${(message.window.stopDelayMs / 1000).toFixed(2)}s`)
            break
          default: break
        }
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const endedAtMs = performance.now() - began
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs: childBudgetMs, startedAt, wallMs: endedAtMs, killedAtMs, nodeFlags,
          ipc, lastHeartbeatAgeAtEndMs: ipc.lastHeartbeatReceivedAtMs === null ? null : endedAtMs - ipc.lastHeartbeatReceivedAtMs,
          stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s section=${(ipc.lastSectionStarted?.stack ?? []).join('>') || '-'}`)
        const record = recordWritten ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        const manifestPath = join(profilesDir, `${id}.capture.json`)
        const capture = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
        done({ entry, record, capture, events: readJsonLines(eventsPath), heartbeats: readJsonLines(heartbeatsPath), runtime: readJsonLines(runtimePath) })
      })
    }
    start()
  })
}

const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
  platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  childHeapLimitMb: childHeapMb, nodeFlags: primaryFlags, diagnosticNodeFlags: diagnosticFlags, concurrency, orientationBudgetMs: budgetMs,
  diagnosticBudgetMs: a5.PHASE2C26A5_DIAGNOSTIC_BUDGET_MS, baselineBudgetMs: a5.PHASE2C26A5_ORIENTATION_BUDGET_MS,
  memorySampleIntervalMs: a5.PHASE2C26A5_MEMORY_SAMPLE_INTERVAL_MS, heartbeatIntervalMs: a5.PHASE2C26A5_HEARTBEAT_INTERVAL_MS, nodeYield: a5.PHASE2C26A5_NODE_YIELD,
  profiler, profilerMethod: 'node:inspector Session (main thread): Debugger.enable while the modules load (scriptParsed: url + inline source map), Debugger.disable, then Profiler.enable / setSamplingInterval / start / stop',
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
  c26aResultFileName: basename(c26aPath), c26aResultSha256: sha256(rawC26a), c26aResultBytes: rawC26a.length,
  c26a2ResultFileName: basename(a2Path), c26a2ResultSha256: sha256(rawA2), c26a2ResultBytes: rawA2.length,
  c26a3ResultFileName: basename(a3Path), c26a3ResultSha256: sha256(rawA3), c26a3ResultBytes: rawA3.length,
  c26a4ResultFileName: basename(a4Path), c26a4ResultSha256: sha256(rawA4), c26a4ResultBytes: rawA4.length,
  searchInstrumentation: { ...a5.PHASE2C26A5_SEARCH_INSTRUMENTATION },
  smoke: smokeUsed ? { orientationIds: smokeOrientationIds, budgetMs: smokeBudgetMs, warmupMs: smokeWarmupMs, stopMs: smokeStopMs, skipDiagnostic } : null }

const profiledView = (run, orientationId, task, variant) => ({ orientationId, variant, task, process: run.entry, childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null,
  memory: run.record?.memory ?? null, recordWindow: run.record?.window ?? null, profilerState: run.record?.profilerState ?? null, diagnosticStoppedBy: run.record?.diagnosticStoppedBy ?? null,
  capture: run.capture, events: run.events, heartbeats: run.heartbeats, runtime: run.runtime, record: run.record?.result ?? null })

try {
  const base = { phase: 'Issue #154 Phase 2-C2.6-A5: Bonus Ideal filter internal runtime localization (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    authority: { c26aMeasuredHead: authority.measuredHead, a2MeasuredHead: a2Authority.measuredHead, a3MeasuredHead: a3Authority.measuredHead, a4MeasuredHead: a4Authority.measuredHead,
      primaryOrientationIds: a4Authority.primaryOrientationIds }, diagnosticSelection }
  const probeRun = await runChild('probe', 'probe', null, 300_000, primaryFlags)
  const probe = probeRun.record?.probe ?? { valid: false, issues: ['the probe child left no record'], process: probeRun.entry }
  console.log(`probe: valid=${probe.valid} samples=${probe.samples ?? '-'} medianInterval=${probe.observedMedianIntervalUs ?? '-'}us ${(probe.issues ?? []).join('; ')}`)
  if (!probe.valid) {
    await write(outputPath, { ...base, status: 'probe_failed', probe, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The profiler probe failed; no formal run.')
  }
  const baselineRun = await runChild('baseline', 'baseline', null, a5.PHASE2C26A5_ORIENTATION_BUDGET_MS, primaryFlags)
  if (!baselineRun.record) {
    await write(outputPath, { ...base, status: 'baseline_failed', probe, baseline: { process: baselineRun.entry, record: null }, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The baseline child failed; no kernel was run.')
  }
  const baseline = baselineRun.record.result
  const allTasks = c26a.phase2c26aKernelTasks(baseline.orientations)
  const currentConditions = { exportSha256: environment.exportSha256, childHeapLimitMb: childHeapMb, concurrency, orientationBudgetMs: budgetMs, nodeYield: environment.nodeYield,
    extent: allTasks[0]?.conditions.extent ?? null, bounds: allTasks[0]?.conditions.bounds ?? null,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] }, nodeFlags: primaryFlags }
  const baselineParity = a2.validatePhase2C26A2BaselineParity(baseline.summary, baseline.orientations, authority)
  const conditionParity = a5.validatePhase2C26A5ConditionParity(currentConditions, a4Authority.conditions, a3Authority.conditions, authority, a2Authority.conditions)
  const selectedTasks = a3.selectPhase2C26A3Tasks(allTasks, a4Authority.primaryOrientationIds)
  const tasks = smokeOrientationIds === null ? selectedTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  const selection = a3.validatePhase2C26A3Selection(tasks.map(task => task.orientation), a4Authority.primaryOrientationIds, authority)
  const diagnosticTask = allTasks.find(task => task.orientation.orientationId === diagnosticSelection.representativeOrientationId) ?? null
  const baselineView = { process: baselineRun.entry, childWallMs: baselineRun.record.wallMs, memory: baselineRun.record.memory,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    summary: baseline.summary, orientations: baseline.orientations }
  console.log(`baseline: ${baseline.orientations.length} orientations; parity ${baselineParity.valid}, conditions ${conditionParity.valid}, selection ${selection.valid} (${tasks.map(t => t.orientation.orientationId).join(', ')}); diagnostic ${diagnosticSelection.representativeOrientationId}`)
  // A smoke budget is not the registered one, so its condition parity fails by design; everything else still gates it.
  const conditionBlocking = smokeBudgetMs === null ? !conditionParity.valid : conditionParity.issues.some(issue => issue !== 'orientationBudgetMs differs')
  const formalBlocked = !baselineParity.valid || conditionBlocking || (smokeOrientationIds === null && !selection.valid) || diagnosticTask === null
  if (formalBlocked) {
    await write(outputPath, { ...base, status: 'parity_failed', probe, currentConditions, baselineParity, conditionParity, selection, baseline: baselineView, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no kernel was run: ${[...baselineParity.issues, ...conditionParity.issues, ...(selection.valid ? [] : ['selection']), ...(diagnosticTask ? [] : ['diagnostic task'])].join('; ')}`)
  }
  const kernels = []
  for (const task of tasks) {
    const id = `kernel-${task.orientation.orientationId}`
    const run = await runChild(id, 'kernel', { ...task, profiler }, budgetMs, primaryFlags)
    kernels.push(profiledView(run, task.orientation.orientationId, task, 'jit_default'))
  }
  let diagnostic = null
  if (!skipDiagnostic) {
    const id = `diagnostic-${diagnosticTask.orientation.orientationId}`
    const run = await runChild(id, 'diagnostic', { ...diagnosticTask, profiler }, a5.PHASE2C26A5_DIAGNOSTIC_BUDGET_MS, diagnosticFlags)
    diagnostic = profiledView(run, diagnosticTask.orientation.orientationId, diagnosticTask, 'no_inlining')
  }
  const record = { ...base, status: 'completed', probe, currentConditions, baselineParity, conditionParity, selection, conditions: allTasks[0]?.conditions ?? null,
    baseline: baselineView, kernels, diagnostic, processes, profilesDir: basename(profilesDir), wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  const count = outcome => kernels.filter(k => k.process.outcome === outcome).length
  console.log(JSON.stringify({ output: resolve(outputPath), orientations: kernels.length, completed: count('completed'), out_of_memory: count('out_of_memory'),
    timeout: count('timeout'), process_failure: count('process_failure'), captured: kernels.filter(k => k.capture !== null).length,
    diagnostic: diagnostic === null ? null : { outcome: diagnostic.process.outcome, captured: diagnostic.capture !== null }, wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
