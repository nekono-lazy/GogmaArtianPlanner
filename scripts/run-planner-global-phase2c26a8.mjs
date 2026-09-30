// Issue #154 Phase 2-C2.6-A8 Research only: formal CPU attribution inside the held-aware frontier_reduction_sort section
// (V8 sampling CPU profiler). No Production change.
//
// Parent (default role):
//   0. reads the committed Phase 2-C2.6-A / A2 / A3 / A4 / A5 / A6 / A7 RESULTs (--c26a-result ... --c26a7-result), failing
//      closed unless each is the registered formal result made against exactly the earlier files read (SHA chain); A7
//      (Case F, section frontier_reduction_sort) is the primary selection and hotspot authority (its selection is A6's =
//      A5's = A4's = A3's; no ID fixed), and the no-inlining diagnostic representative is derived from A7's evidence;
//   1. fails closed unless no Production calculation source changed since the A7 measured HEAD (Research / test sources
//      excluded, the working tree included), and records it;
//   2. `probe` child: Profiler.enable / setSamplingInterval / start / stop must be accepted by this Node / V8, the profile
//      must carry nodes / samples / timeDeltas / startTime / endTime on the process.hrtime clock with a valid clock
//      alignment, every required source file must have an inline source map, the registered function spans and the
//      frontier block must be derivable from the source, and stableStringify / serializeStable probe frames must resolve
//      to their declaration lines. A failed probe stops the run (no fallback);
//   3. `baseline` child: the ordinary Production Planner over the original Export, as in C2.6-A .. A7; its orientations
//      must equal the C2.6-A authority's;
//   4. every run condition must equal A7's (concurrency 1, the heap-only Node flags and the A7 pair of observers included);
//   5. `kernel` children (jit_default, the primary evidence): the A7 primaries, once each (no retry), one at a time, each =
//      the unchanged current Planner Alternative kernel with the unchanged A7 instrumentation (A4 lifecycle + Search section
//      observer + A3 held-aware section observer, their durable records and heartbeat) and the CPU profiler from 120 s to
//      720 s after the first Search start; the Search then continues to the 30-minute budget;
//   6. `diagnostic` child (no_inlining, never Production-like): the representative only, same window; it stops its own run
//      once its profile is written.
// The profile, the script table (scriptId -> url + inline source maps, from Debugger.scriptParsed while the modules load;
// the Debugger is disabled before any calculation) and a capture manifest (window, both clocks around the profiler calls)
// are written synchronously by the child. The frontier_reduction_sort intervals are rebuilt afterwards from the A3 held-aware
// stream the child already writes; nothing new is written or sent per state.
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
  throw new Error('Usage: node scripts/run-planner-global-phase2c26a8.mjs --export <external.json> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --c26a6-result docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json --c26a7-result docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json --run-dir <new dir .local> --profiles-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-orientations <id,...> --smoke-budget-ms <ms> --smoke-warmup-ms <ms> --smoke-stop-ms <ms> --skip-diagnostic]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26a8.mjs'
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
    a5Analysis: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts'),
    a6: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6.ts'),
    a7: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A7.ts'),
    a8: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A8.ts'),
    analysis: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    instrumentation: await server.ssrLoadModule('/src/benchmarks/plannerAlternativeBenchmarkInstrumentation.ts'),
    hashing: await server.ssrLoadModule('/src/domain/models/hashing.ts'),
    semanticKeys: await server.ssrLoadModule('/src/domain/search/semanticKeys.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

/** Reads the source texts of the given files (the span authority is the working tree = the run's committed HEAD). */
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
  const eventsPath = option('--events'), heartbeatsPath = option('--heartbeats'), runtimePath = option('--runtime'), gogmaPath = option('--gogma')
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
  const { c26a, a5, a5Analysis, a7, a8, analysis, research, runner, instrumentation, hashing, semanticKeys, ProductionRngEngine } = modules
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const memoryTimer = setInterval(() => tracker.sample(process.memoryUsage()), a8.PHASE2C26A8_MEMORY_SAMPLE_INTERVAL_MS)
  let heartbeatTimer = null
  const fds = []
  const writeScriptTable = () => {
    const rows = scriptTableRows(scripts, a5Analysis.normalizePhase2C26A5Url)
    const body = JSON.stringify(rows)
    const file = `${childId}.scripts.json`
    writeFileSync(join(profilesDir, file), body)
    const requiredSourceMaps = Object.fromEntries(a8.PHASE2C26A8_REQUIRED_SOURCE_FILES.map(f => [f, rows.some(row => row.file === f && row.sourceMap !== null)]))
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
      const interval = a8.PHASE2C26A8_PROFILER.requestedSamplingIntervalUs
      let probe = { valid: false, steps, scripts: scriptsRecord }
      try {
        await accept('Profiler.enable', () => post('Profiler.enable'))
        await accept('Profiler.setSamplingInterval', () => post('Profiler.setSamplingInterval', { interval }))
        const startPre = clockPair()
        await accept('Profiler.start', () => post('Profiler.start'))
        const startPost = clockPair()
        // CPU work through the registered serialization (the real bonuses of the Export's Targets) and key comparison.
        const sets = input.targetWeapons.map(t => t.idealBonuses).filter(b => Array.isArray(b) && b.length === 5)
        if (sets.length === 0) throw new Error('No Target with five Ideal bonuses for the probe.')
        let checksum = 0
        const until = performance.now() + 1500
        while (performance.now() < until) {
          for (let i = 0; i < 1000; i++) {
            const left = hashing.stableStringify(sets[i % sets.length]), right = hashing.stableStringify(sets[(i + 1) % sets.length])
            checksum += semanticKeys.compareStableKeys(left, right)
          }
        }
        const stopPre = clockPair()
        const { profile } = await accept('Profiler.stop', () => post('Profiler.stop'))
        const stopPost = clockPair()
        const keys = ['nodes', 'samples', 'timeDeltas', 'startTime', 'endTime']
        const keysPresent = Object.fromEntries(keys.map(key => [key, profile?.[key] !== undefined]))
        const validated = analysis.validatePhase2C26A8CpuProfile(profile)
        const alignment = a5Analysis.validatePhase2C26A5ClockAlignment(validated, { startPre, startPost, stopPre, stopPost })
        const sources = readSources([...new Set(analysis.PHASE2C26A8_FUNCTION_REGISTRY.map(e => e.file))])
        const spans = analysis.derivePhase2C26A8FunctionSpans(sources)
        const block = analysis.derivePhase2C26A8FrontierBlock(sources['src/domain/search/bonusStream.ts'])
        const table = a5Analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
        const resolved = validated.nodes.map(node => analysis.resolvePhase2C26A8Frame(node.callFrame, table, spans))
        const lineCheck = name => {
          const span = spans.find(s => s.functionName === name)
          const frames = resolved.filter(frame => frame.functionName === name && frame.file === 'src/domain/models/hashing.ts')
          return { declarationLine: span.startLine, frameLines: frames.map(frame => frame.originalLine), matches: frames.length > 0 && frames.every(frame => frame.originalLine === span.startLine) }
        }
        const frameLines = { stableStringify: lineCheck('stableStringify'), serializeStable: lineCheck('serializeStable') }
        const deltas = [...validated.timeDeltas].sort((a, b) => a - b)
        const allRequired = Object.values(scriptsRecord.requiredSourceMaps).every(Boolean)
        const issues = [
          ...keys.filter(key => !keysPresent[key]).map(key => `profile lacks ${key}`),
          ...(validated.samples.length >= 50 ? [] : [`only ${validated.samples.length} samples`]),
          ...alignment.issues.map(issue => `clock: ${issue}`),
          ...(allRequired ? [] : ['a required source file has no source map']),
          ...Object.entries(frameLines).filter(([, check]) => !check.matches).map(([name]) => `no probe frame resolved to ${name} at its declaration line`),
        ]
        probe = { valid: issues.length === 0, issues, steps, requestedSamplingIntervalUs: interval, observedMedianIntervalUs: deltas[Math.floor(deltas.length / 2)] ?? null,
          keysPresent, samples: validated.samples.length, nodes: validated.nodes.length, checksum,
          alignment: { valid: alignment.valid, issues: alignment.issues, offsetSpreadMs: alignment.offsetSpreadMs, maxPairPrecisionMs: alignment.maxPairPrecisionMs,
            profileDurationMs: alignment.profileDurationMs, negativeDeltas: alignment.negativeDeltas },
          scripts: scriptsRecord, spans, frontierBlock: { startLine: block.startLine, endLine: block.endLine }, frameLines }
      } catch (error) {
        probe = { ...probe, valid: false, issues: [`probe threw: ${String(error)}`] }
      }
      extra = { probe }
    } else if (role === 'kernel' || role === 'diagnostic') {
      if (!eventsPath || !heartbeatsPath || !runtimePath || !gogmaPath || !profilesDir || !childId) throw new Error('A profiled child needs --events, --heartbeats, --runtime, --gogma, --profiles-dir and --child-id.')
      const { record: scriptsRecord } = writeScriptTable()
      // One open descriptor per file; each record is one synchronous append, so a kill keeps everything written before it.
      const eventsFd = openSync(eventsPath, 'a'), heartbeatsFd = openSync(heartbeatsPath, 'a'), runtimeFd = openSync(runtimePath, 'a'), gogmaFd = openSync(gogmaPath, 'a')
      fds.push(eventsFd, heartbeatsFd, runtimeFd, gogmaFd)
      const durable = (fd, record) => { writeSync(fd, JSON.stringify(record) + '\n'); process.send?.(record) }
      let counting = null
      dependencies.createEngine = () => { counting = instrumentation.createCountingRngEngine(new ProductionRngEngine()); return counting.engine }
      const zero = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }
      // A7's kernel progress, unchanged (lifecycle, both section boundary trackers, durable records, heartbeat on one clock).
      const progress = a7.createPhase2C26A7KernelProgress({
        now: () => performance.now(), predictionCounts: () => counting?.counts() ?? zero,
        emitLifecycle: record => durable(eventsFd, record), emitSectionStarted: record => durable(runtimeFd, record),
        emitWorkSummary: record => durable(runtimeFd, record), emitSearchSummary: record => durable(runtimeFd, record),
        emitGogmaPhaseStarted: record => durable(gogmaFd, record), emitGogmaDepth: record => durable(gogmaFd, record),
      })
      const profilerConfig = task.profiler
      await post('Profiler.enable')
      await post('Profiler.setSamplingInterval', { interval: profilerConfig.requestedSamplingIntervalUs })
      let finishDiagnostic = null
      const diagnosticDone = new Promise(done => { finishDiagnostic = done })
      const controller = a5.createPhase2C26A5ProfileController({
        clockPair, config: profilerConfig,
        setTimer: (callback, delayMs) => { setTimeout(callback, delayMs) },
        startProfiler: () => post('Profiler.start'),
        stopProfiler: async () => (await post('Profiler.stop')).profile,
        onCaptured: (profile, window) => {
          const body = JSON.stringify(profile)
          const file = `${childId}.cpuprofile`
          writeFileSync(join(profilesDir, file), body)
          const capture = { kind: 'profile_captured', childProcessMs: performance.now(), window,
            profile: { file, sha256: sha256(body), bytes: Buffer.byteLength(body), samples: profile.samples.length, nodes: profile.nodes.length },
            scripts: scriptsRecord, predictionCounts: counting?.counts() ?? zero }
          const manifest = `${childId}.capture.json`
          writeFileSync(join(profilesDir, manifest), JSON.stringify(capture))
          process.send?.({ kind: 'profile_captured', manifest, childProcessMs: capture.childProcessMs, window, samples: profile.samples.length })
          if (role === 'diagnostic') finishDiagnostic()
        },
      })
      const kernelInstrumentation = a8.createPhase2C26A8KernelInstrumentation(progress.instrumentation, { now: () => performance.now(), onSearchStarted: atMs => controller.onSearchStarted(atMs) })
      const memory = () => { const usage = process.memoryUsage(); const maxima = tracker.sample(usage); return { current: { heapUsed: usage.heapUsed, rss: usage.rss }, maxima } }
      const origin = progress.start()
      durable(eventsFd, { kind: 'kernel_invoked', originChildProcessMs: origin, childProcessMs: performance.now() })
      heartbeatTimer = setInterval(() => durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, profilerState: controller.state(), childProcessMs: performance.now() }), a8.PHASE2C26A8_HEARTBEAT_INTERVAL_MS)
      const kernel = a8.runPhase2C26A8Kernel(input, task, dependencies, kernelInstrumentation)
      if (role === 'diagnostic') {
        // The diagnostic stops once its profile is written (the kernel promise is abandoned; the process exits).
        const winner = await Promise.race([diagnosticDone.then(() => 'captured'), kernel.then(() => 'kernel_ended', error => { throw error })])
        if (winner === 'kernel_ended') await controller.onKernelEnded()
        durable(heartbeatsFd, { ...progress.heartbeat(), memory: memory(), yields, profilerState: controller.state(), childProcessMs: performance.now(), final: true })
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
const a5Path = option('--c26a5-result'), a6Path = option('--c26a6-result'), a7Path = option('--c26a7-result')
if (!runDir || !profilesDir || !outputPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path || !a6Path || !a7Path) {
  throw new Error('The parent needs --c26a-result, --c26a2-result, --c26a3-result, --c26a4-result, --c26a5-result, --c26a6-result, --c26a7-result, --run-dir, --profiles-dir and --output.')
}
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
const rawA5 = await readFile(a5Path), rawA6 = await readFile(a6Path), rawA7 = await readFile(a7Path)
await mkdir(runDir, { recursive: true })
await mkdir(profilesDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

const server = await createLoader()
const { c26a, a2, a3, a4, a5, a6, a7, a8, ProductionRngEngine } = await loadModules(server)
const shas = { c26a: sha256(rawC26a), a2: sha256(rawA2), a3: sha256(rawA3), a4: sha256(rawA4), a5: sha256(rawA5), a6: sha256(rawA6), a7: sha256(rawA7) }
const parsedC26a = a2.parsePhase2C26AAuthority(JSON.parse(rawC26a.toString('utf8')))
if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
const authority = parsedC26a.authority
const parsedA2 = a3.parsePhase2C26A2ResultAuthority(JSON.parse(rawA2.toString('utf8')), shas.c26a, authority)
if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
const a2Authority = parsedA2.authority
const parsedA3 = a4.parsePhase2C26A3ResultAuthority(JSON.parse(rawA3.toString('utf8')), shas.c26a, shas.a2, a2Authority, authority)
if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
const a3Authority = parsedA3.authority
const parsedA4 = a5.parsePhase2C26A4ResultAuthority(JSON.parse(rawA4.toString('utf8')), { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 }, a3Authority, authority)
if (!parsedA4.valid) throw new Error(`The Phase 2-C2.6-A4 RESULT is not the registered authority: ${parsedA4.issues.join('; ')}`)
const a4Authority = parsedA4.authority
const parsedA5 = a6.parsePhase2C26A5ResultAuthority(JSON.parse(rawA5.toString('utf8')), { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4 }, a4Authority, authority)
if (!parsedA5.valid) throw new Error(`The Phase 2-C2.6-A5 RESULT is not the registered authority: ${parsedA5.issues.join('; ')}`)
const a5Authority = parsedA5.authority
const parsedA6 = a7.parsePhase2C26A6ResultAuthority(JSON.parse(rawA6.toString('utf8')), { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5 }, a5Authority, authority)
if (!parsedA6.valid) throw new Error(`The Phase 2-C2.6-A6 RESULT is not the registered authority: ${parsedA6.issues.join('; ')}`)
const a6Authority = parsedA6.authority
const parsedA7 = a8.parsePhase2C26A7ResultAuthority(JSON.parse(rawA7.toString('utf8')), { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5, a6: shas.a6 },
  a6Authority, authority)
if (!parsedA7.valid) throw new Error(`The Phase 2-C2.6-A7 RESULT is not the registered authority: ${parsedA7.issues.join('; ')}`)
const a7Authority = parsedA7.authority
const diagnosticSelection = a8.selectPhase2C26A8DiagnosticRepresentative(a7Authority)
// No Production calculation change since the A7 measured HEAD (working tree included).
const changedSrcSince = head => [...new Set([...git('diff', '--name-only', head, '--', 'src').split(/\r?\n/), ...git('ls-files', '--others', '--exclude-standard', '--', 'src').split(/\r?\n/)])]
  .filter(Boolean).sort()
const productionChange = { registered: a8.PHASE2C26A8_PRODUCTION_CHANGE, a7MeasuredHead: a7Authority.measuredHead, sinceA7MeasuredHead: changedSrcSince(a7Authority.measuredHead) }
const productionChangeSinceA7 = a8.validatePhase2C26A8NoProductionChange(productionChange.sinceA7MeasuredHead)
if (!productionChangeSinceA7.valid) throw new Error(`A Production calculation source changed since the A7 measured HEAD: ${productionChangeSinceA7.issues.join('; ')}`)
const childHeapMb = a8.PHASE2C26A8_CHILD_HEAP_MB
const concurrency = a8.PHASE2C26A8_CONCURRENCY
const budgetMs = smokeBudgetMs ?? a8.PHASE2C26A8_ORIENTATION_BUDGET_MS
const profiler = { ...a8.PHASE2C26A8_PROFILER,
  ...(smokeWarmupMs === null ? {} : { warmupMs: smokeWarmupMs }),
  ...(smokeStopMs === null ? {} : { profileStopMs: smokeStopMs }) }
profiler.requestedProfileDurationMs = profiler.profileStopMs - profiler.warmupMs
if (!(profiler.requestedProfileDurationMs > 0)) throw new Error('The profile window is empty.')
const primaryFlags = [...a8.PHASE2C26A8_PRIMARY_NODE_FLAGS]
const diagnosticFlags = [...a8.PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS]

/** One fresh child. Resolves with its record (or null), classified outcome and IPC view; never throws for a child failure. */
function runChild(id, childRole, task, childBudgetMs, nodeFlags) {
  return new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const eventsPath = join(runDir, `${id}.events.jsonl`)
    const heartbeatsPath = join(runDir, `${id}.heartbeats.jsonl`)
    const runtimePath = join(runDir, `${id}.runtime.jsonl`)
    const gogmaPath = join(runDir, `${id}.gogma.jsonl`)
    const profiledRole = childRole === 'kernel' || childRole === 'diagnostic'
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--child-id', id, '--profiles-dir', profilesDir,
        ...(taskPath ? ['--task', taskPath] : []), ...(profiledRole ? ['--events', eventsPath, '--heartbeats', heartbeatsPath, '--runtime', runtimePath, '--gogma', gogmaPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null
      const ipc = { lifecycleMessages: 0, heartbeatMessages: 0, sectionStartMessages: 0, workSummaryMessages: 0, searchSummaryMessages: 0,
        gogmaPhaseStartMessages: 0, gogmaDepthMessages: 0, lastLifecycle: null, lastHeartbeat: null, lastHeartbeatReceivedAtMs: null, maxHeartbeatGapMs: null,
        lastSectionStarted: null, lastGogmaPhaseStarted: null, kernelInvoked: null, profileCaptured: null, profileCapturedAtMs: null }
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, childBudgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        const receivedAtMs = performance.now() - began
        switch (message?.kind) {
          case 'lifecycle': ipc.lifecycleMessages += 1; ipc.lastLifecycle = { ...message, receivedAtMs }; break
          case 'heartbeat':
            if (ipc.lastHeartbeatReceivedAtMs !== null) ipc.maxHeartbeatGapMs = Math.max(ipc.maxHeartbeatGapMs ?? 0, receivedAtMs - ipc.lastHeartbeatReceivedAtMs)
            ipc.heartbeatMessages += 1
            ipc.lastHeartbeat = { ...message, searchRuntime: undefined, gogmaRuntime: undefined, activeStack: message.searchRuntime?.activeStack ?? null,
              activeGogmaPhase: message.gogmaRuntime?.activePhase ?? null }
            ipc.lastHeartbeatReceivedAtMs = receivedAtMs
            break
          case 'search_section_started': ipc.sectionStartMessages += 1; ipc.lastSectionStarted = { ...message, receivedAtMs }; break
          case 'search_work_summary': ipc.workSummaryMessages += 1; break
          case 'search_summary': ipc.searchSummaryMessages += 1; break
          case 'gogma_phase_started': ipc.gogmaPhaseStartMessages += 1; ipc.lastGogmaPhaseStarted = { ...message, receivedAtMs }; break
          case 'gogma_depth': ipc.gogmaDepthMessages += 1; break
          case 'kernel_invoked': ipc.kernelInvoked = message; break
          case 'profile_captured':
            ipc.profileCaptured = message; ipc.profileCapturedAtMs = receivedAtMs
            console.log(`${new Date().toISOString()} PROFILE ${id} samples=${message.samples} start+${(message.window.startDelayMs / 1000).toFixed(2)}s stop+${(message.window.stopDelayMs / 1000).toFixed(2)}s`)
            break
          default: break
        }
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const endedAtMs = performance.now() - began
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const lastMemory = ipc.lastHeartbeat?.memory?.maxima ?? null
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs: childBudgetMs, startedAt, wallMs: endedAtMs, killedAtMs, nodeFlags,
          ipc, lastHeartbeatAgeAtEndMs: ipc.lastHeartbeatReceivedAtMs === null ? null : endedAtMs - ipc.lastHeartbeatReceivedAtMs,
          lastIpcMemory: lastMemory, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        console.log(`${new Date().toISOString()} ${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s section=${(ipc.lastSectionStarted?.stack ?? []).join('>') || '-'} gogma=${ipc.lastGogmaPhaseStarted?.phase ?? '-'} heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        const record = recordWritten ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
        const manifestPath = join(profilesDir, `${id}.capture.json`)
        const capture = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
        done({ entry, record, capture, events: readJsonLines(eventsPath), heartbeats: readJsonLines(heartbeatsPath), runtime: readJsonLines(runtimePath), gogmaRuntime: readJsonLines(gogmaPath) })
      })
    }
    start()
  })
}

const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
  platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  childHeapLimitMb: childHeapMb, nodeFlags: primaryFlags, diagnosticNodeFlags: diagnosticFlags, concurrency, orientationBudgetMs: budgetMs,
  diagnosticBudgetMs: a8.PHASE2C26A8_DIAGNOSTIC_BUDGET_MS, baselineBudgetMs: a8.PHASE2C26A8_ORIENTATION_BUDGET_MS,
  memorySampleIntervalMs: a8.PHASE2C26A8_MEMORY_SAMPLE_INTERVAL_MS, heartbeatIntervalMs: a8.PHASE2C26A8_HEARTBEAT_INTERVAL_MS, nodeYield: a8.PHASE2C26A8_NODE_YIELD,
  profiler, profilerMethod: 'node:inspector Session (main thread): Debugger.enable while the modules load (scriptParsed: url + inline source map), Debugger.disable, then Profiler.enable / setSamplingInterval / start / stop',
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
  c26aResultFileName: basename(c26aPath), c26aResultSha256: shas.c26a, c26aResultBytes: rawC26a.length,
  c26a2ResultFileName: basename(a2Path), c26a2ResultSha256: shas.a2, c26a2ResultBytes: rawA2.length,
  c26a3ResultFileName: basename(a3Path), c26a3ResultSha256: shas.a3, c26a3ResultBytes: rawA3.length,
  c26a4ResultFileName: basename(a4Path), c26a4ResultSha256: shas.a4, c26a4ResultBytes: rawA4.length,
  c26a5ResultFileName: basename(a5Path), c26a5ResultSha256: shas.a5, c26a5ResultBytes: rawA5.length,
  c26a6ResultFileName: basename(a6Path), c26a6ResultSha256: shas.a6, c26a6ResultBytes: rawA6.length,
  c26a7ResultFileName: basename(a7Path), c26a7ResultSha256: shas.a7, c26a7ResultBytes: rawA7.length,
  productionChange,
  searchInstrumentation: { ...a8.PHASE2C26A8_SEARCH_INSTRUMENTATION },
  smoke: smokeUsed ? { orientationIds: smokeOrientationIds, budgetMs: smokeBudgetMs, warmupMs: smokeWarmupMs, stopMs: smokeStopMs, skipDiagnostic } : null }

const profiledView = (run, orientationId, task, variant) => ({ orientationId, variant, task, process: run.entry, childWallMs: run.record?.wallMs ?? null, yields: run.record?.yields ?? null,
  memory: run.record?.memory ?? null, recordWindow: run.record?.window ?? null, profilerState: run.record?.profilerState ?? null, diagnosticStoppedBy: run.record?.diagnosticStoppedBy ?? null,
  capture: run.capture, events: run.events, heartbeats: run.heartbeats, runtime: run.runtime, gogmaRuntime: run.gogmaRuntime, record: run.record?.result ?? null })

try {
  const base = { phase: 'Issue #154 Phase 2-C2.6-A8: frontier_reduction_sort internal CPU attribution (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    authority: { c26aMeasuredHead: authority.measuredHead, a2MeasuredHead: a2Authority.measuredHead, a3MeasuredHead: a3Authority.measuredHead, a4MeasuredHead: a4Authority.measuredHead,
      a5MeasuredHead: a5Authority.measuredHead, a6MeasuredHead: a6Authority.measuredHead, a7MeasuredHead: a7Authority.measuredHead, a7DecisionCase: a7Authority.decisionCase,
      a7DecisionSection: a7Authority.decisionSection, primaryOrientationIds: a7Authority.primaryOrientationIds }, diagnosticSelection }
  const probeRun = await runChild('probe', 'probe', null, 300_000, primaryFlags)
  const probe = probeRun.record?.probe ?? { valid: false, issues: ['the probe child left no record'], process: probeRun.entry }
  console.log(`probe: valid=${probe.valid} samples=${probe.samples ?? '-'} medianInterval=${probe.observedMedianIntervalUs ?? '-'}us ${(probe.issues ?? []).join('; ')}`)
  if (!probe.valid) {
    await write(outputPath, { ...base, status: 'probe_failed', probe, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The profiler probe failed; no formal run.')
  }
  const baselineRun = await runChild('baseline', 'baseline', null, a8.PHASE2C26A8_ORIENTATION_BUDGET_MS, primaryFlags)
  if (!baselineRun.record) {
    await write(outputPath, { ...base, status: 'baseline_failed', probe, baseline: { process: baselineRun.entry, record: null }, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The baseline child failed; no kernel was run.')
  }
  const baseline = baselineRun.record.result
  const allTasks = c26a.phase2c26aKernelTasks(baseline.orientations)
  const currentConditions = { exportSha256: environment.exportSha256, childHeapLimitMb: childHeapMb, concurrency, orientationBudgetMs: budgetMs, nodeYield: environment.nodeYield,
    extent: allTasks[0]?.conditions.extent ?? null, bounds: allTasks[0]?.conditions.bounds ?? null,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] } }
  const baselineParity = a2.validatePhase2C26A2BaselineParity(baseline.summary, baseline.orientations, authority)
  const conditionParity = a8.validatePhase2C26A8ConditionParity({ ...currentConditions, nodeFlags: primaryFlags, searchInstrumentation: environment.searchInstrumentation },
    a7Authority.conditions, a6Authority.conditions, a5Authority.conditions, a4Authority.conditions, a3Authority.conditions, authority, a2Authority.conditions)
  const selectedTasks = a8.selectPhase2C26A8Tasks(allTasks, a7Authority)
  const tasks = smokeOrientationIds === null ? selectedTasks : allTasks.filter(task => smokeOrientationIds.includes(task.orientation.orientationId))
  if (smokeOrientationIds !== null && tasks.length !== smokeOrientationIds.length) throw new Error('A smoke orientation is not an orientation of this baseline.')
  const selection = a8.validatePhase2C26A8Selection(tasks.map(task => task.orientation), a7Authority, authority)
  const diagnosticTask = allTasks.find(task => task.orientation.orientationId === diagnosticSelection.representativeOrientationId) ?? null
  const baselineView = { process: baselineRun.entry, childWallMs: baselineRun.record.wallMs, memory: baselineRun.record.memory,
    researchMaxPlanSteps: baselineRun.record.researchMaxPlanSteps, calculationContext: baselineRun.record.calculationContext,
    summary: baseline.summary, orientations: baseline.orientations }
  console.log(`baseline: ${baseline.orientations.length} orientations; parity ${baselineParity.valid}, conditions ${conditionParity.valid}, selection ${selection.valid} (${tasks.map(t => t.orientation.orientationId).join(', ')}); diagnostic ${diagnosticSelection.representativeOrientationId}`)
  // A smoke budget is not the registered one, so its condition parity fails by design; everything else still gates it.
  const conditionBlocking = smokeBudgetMs === null ? !conditionParity.valid : conditionParity.issues.some(issue => !/(^|\.)orientationBudgetMs differs$/.test(issue))
  const formalBlocked = !baselineParity.valid || conditionBlocking || (smokeOrientationIds === null && !selection.valid) || diagnosticTask === null
  if (formalBlocked) {
    await write(outputPath, { ...base, status: 'parity_failed', probe, currentConditions, baselineParity, conditionParity, selection, baseline: baselineView, kernels: [], diagnostic: null, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Parity failed; no kernel was run: ${[...baselineParity.issues, ...conditionParity.issues, ...(selection.valid ? [] : ['selection']), ...(diagnosticTask ? [] : ['diagnostic task'])].join('; ')}`)
  }
  const kernels = []
  for (const task of tasks) {
    const id = c26a.phase2c26aKernelChildId(task.orientation.orientationId)
    const run = await runChild(id, 'kernel', { ...task, profiler }, budgetMs, primaryFlags)
    kernels.push(profiledView(run, task.orientation.orientationId, task, 'jit_default'))
  }
  let diagnostic = null
  if (!skipDiagnostic) {
    const id = `diagnostic-${diagnosticTask.orientation.orientationId}`
    const run = await runChild(id, 'diagnostic', { ...diagnosticTask, profiler }, a8.PHASE2C26A8_DIAGNOSTIC_BUDGET_MS, diagnosticFlags)
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
