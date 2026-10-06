// Issue #154 Phase 2-C2.6-B2-C2B2J Research only: the formal after run of the registered Production optimization
// (reserved_keep_family_layout_key_reuse_v1, src/domain/search/bonusStream.ts: a held-aware Keep-generated state reuses its parent's
// family layout key). The one Target B2-C2B2I searched (= B2-C2B2H's) is searched again in its exact Search input with the same
// 30-minute budget, 12,288 MB heap, two existing boundary observers (onSearchRuntime + onGogmaReservedRuntime), durable section stream
// and V8 sampling CPU profiler (node:inspector, 10 ms, Search start + 120 s .. + 720 s, JIT default). The only difference from B2-C2B2I
// is the optimized Production source at the measured HEAD. The probe and its expected Search input identity come from the probe manifest;
// the Search child never reads an oracle, a RESULT, a B2-C2B2I measurement, an expected hotspot / section / sample category, or an
// expected outcome.
//
// Parent (default role):
//   0. reads the Export and the probe manifest (--probes, made by prepare-planner-global-phase2c26b2c2b2j-probes.mjs) and computes its
//      launch observation (HEAD, uncommitted benchmark code, benchmark code SHA-256, Export / manifest SHA-256, the PR #209 main an
//      ancestor of HEAD); reads the committed B2-C2B2I RESULT (--b2c2b2i-result, the formal before authority) and hashes the local
//      B2-C2B2I raw files (--b2c2b2i-raw, --b2c2b2i-run-dir): they must be the files the RESULT recorded. It derives the Production
//      calculation sources changed between B2-C2B2I's measured HEAD and the PR #209 main (must be none) and since B2-C2B2I's measured
//      HEAD (git diff, working tree included), and the source shape of the bonusStream.ts change: a formal launch needs exactly the
//      registered file and a valid shape check, or no Search is run;
//   1. START ATTESTATION: writes start-attestation.json into the new run dir ONCE (`wx`, then read-only) BEFORE any child process,
//      reads it back and, for a formal launch, verifies it (verifyPhase2C26B2C2B2JStartAttestation());
//   2. `probe` child (B2-C2B2H's profiler probe, unchanged);
//   3. `tasks` child: derivePhase2C26B2C1Schedule() over the Export, then buildPhase2C26B2C2B2JTasks() (B2-C2B2H's construction);
//      1 task or no Search;
//   4. Stage 1: the task once in a fresh child, heap 12,288 MB (JIT default), concurrency 1, 30-minute budget, no retry and no
//      fallback (a timeout is a normal outcome; a natural completion too). The child is B2-C2B2H's, unchanged: B2-C2B2G's
//      runPhase2C26B2C2B2GTask() with B2-C2B2H's profiler, durable snapshots every 5 s, the durable section stream and A5's profile
//      controller. Nothing is written or sent per generated state.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync, openSync, writeSync, closeSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { Session } from 'node:inspector'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2c2b2j.mjs --export <external.json> --probes <probe manifest .json.local> --b2c2b2i-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json --b2c2b2i-raw <B2-C2B2I raw .json.local> --b2c2b2i-run-dir <B2-C2B2I run dir> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-budget-ms N --smoke-warmup-ms N --smoke-stop-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2c2b2j.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
/** A file at a commit, byte for byte (never trimmed). */
const gitShow = (head, file) => execFileSync('git', ['show', `${head}:${file}`], { maxBuffer: 1 << 28 }).toString('utf8')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const clockPair = () => { const a = performance.now(); const hrMs = Number(process.hrtime.bigint()) / 1e6; const b = performance.now(); return { perfMs: (a + b) / 2, hrMs, precisionMs: b - a } }

async function loadModules(server) {
  return {
    h: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2H.ts'),
    j: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2J.ts'),
    profileStructure: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HCpuProfile.ts'),
    a5: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts'),
    a5Analysis: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    hashing: await server.ssrLoadModule('/src/domain/models/hashing.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    family: await server.ssrLoadModule('/src/domain/rng/gogmaBonusFamily.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
/** The source texts the span authority is read from (the working tree = the run's committed HEAD for a formal run). */
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
  // ------------------------------------------------------------------ child (B2-C2B2H's, with B2-C2B2J's re-exports of the same functions)
  const taskPath = option('--task'), recordPath = option('--record'), profilePath = option('--profile'), sectionsPath = option('--sections'), childId = option('--child-id'), runDir = option('--run-dir')
  if (!recordPath) throw new Error('A child needs --record.')
  const profiled = role === 'search' || role === 'probe'
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
  const { h, j, profileStructure, a5, a5Analysis, b2c1, c26a, hashing, research, runner, family, ProductionRngEngine } = modules
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, h.PHASE2C26B2C2B2H_MEMORY_SAMPLE_INTERVAL_MS)
  const timers = []
  const fds = []
  const writeScriptTable = () => {
    const rows = scriptTableRows(scripts, profileStructure.normalizePhase2C26B2C2B2HUrl)
    const body = JSON.stringify(rows)
    const file = `${childId}.scripts.json`
    writeFileSync(join(runDir, file), body)
    const requiredSourceMaps = Object.fromEntries(profileStructure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(f => [f, rows.some(row => row.file === f && row.sourceMap !== null)]))
    return { rows, record: { file, sha256: sha256(body), bytes: Buffer.byteLength(body), scriptCount: rows.length, sourceMappedCount: rows.filter(row => row.sourceMap).length, requiredSourceMaps } }
  }
  try {
    sample()
    const task = taskPath ? JSON.parse((await readFile(taskPath)).toString('utf8')) : null
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    let result = null, profile = null, extra = {}, scheduleMs = null
    if (role === 'probe') {
      // ---- profiler probe (B2-C2B2H's): every call must be accepted and the profile usable, else no Search.
      const { rows, record: scriptsRecord } = writeScriptTable()
      const steps = {}
      const accept = async (name, fn) => { try { const value = await fn(); steps[name] = { accepted: true }; return value } catch (error) { steps[name] = { accepted: false, error: String(error) }; throw error } }
      const interval = h.PHASE2C26B2C2B2H_CPU_PROFILER.requestedSamplingIntervalUs
      let probe = { valid: false, steps, scripts: scriptsRecord }
      try {
        const target = input.targetWeapons.find(t => Array.isArray(t.idealBonuses) && t.idealBonuses.length === 5)
        if (!target || input.rngState.baseSeed.value === null) throw new Error('No Target with five Ideal bonuses or no Base Seed for the probe.')
        const prediction = op => ({ baseSeed: input.rngState.baseSeed.value, gogmaCounter: 55, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: op, master: input.master })
        await accept('Profiler.enable', () => post('Profiler.enable'))
        await accept('Profiler.setSamplingInterval', () => post('Profiler.setSamplingInterval', { interval }))
        const startPre = clockPair()
        await accept('Profiler.start', () => post('Profiler.start'))
        const startPost = clockPair()
        let checksum = 0
        const until = performance.now() + 1500
        while (performance.now() < until) {
          for (let k = 0; k < 50; k++) {
            checksum += engine.predictGogmaBonus(prediction({ type: 'reset_bonuses' })).length
            checksum += engine.predictGogmaBonus(prediction({ type: 'keep_bonuses', currentBonuses: target.idealBonuses })).length
            checksum += engine.advanceGogmaCounter(55 + k, { type: 'keep_bonuses' })
            for (let j = 0; j < 20; j++) checksum += family.keepFamilyLayoutKey(target.idealBonuses, input.master).length
          }
        }
        const stopPre = clockPair()
        const { profile: cpu } = await accept('Profiler.stop', () => post('Profiler.stop'))
        const stopPost = clockPair()
        const keys = ['nodes', 'samples', 'timeDeltas', 'startTime', 'endTime']
        const keysPresent = Object.fromEntries(keys.map(key => [key, cpu?.[key] !== undefined]))
        const validated = a5Analysis.validatePhase2C26A5CpuProfile(cpu)
        const alignment = a5Analysis.validatePhase2C26A5ClockAlignment(validated, { startPre, startPost, stopPre, stopPost })
        const sources = readSources(profileStructure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES)
        const spans = profileStructure.derivePhase2C26B2C2B2HFunctionSpans(sources)
        const block = profileStructure.derivePhase2C26B2C2B2HStateGenerationBlock(sources[profileStructure.PHASE2C26B2C2B2H_BLOCK_MARKERS.file])
        const table = a5Analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
        const resolved = validated.nodes.map(node => profileStructure.resolvePhase2C26B2C2B2HFrame(node.callFrame, table, spans))
        const lineCheck = (name, file) => {
          const span = spans.find(s => s.functionName === name && s.file === file)
          const frames = resolved.filter(frame => frame.functionName === name && frame.file === file)
          return { declarationLine: span.startLine, frameLines: frames.map(frame => frame.originalLine), matches: frames.length > 0 && frames.every(frame => frame.originalLine === span.startLine) }
        }
        const frameLines = { predictGogmaBonus: lineCheck('predictGogmaBonus', 'src/domain/rng/production/productionRngEngine.ts'),
          keepFamilyLayoutKey: lineCheck('keepFamilyLayoutKey', 'src/domain/rng/gogmaBonusFamily.ts') }
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
          scripts: scriptsRecord, spans, stateGenerationBlock: { startLine: block.startLine, endLine: block.endLine, subBlocks: block.subBlocks }, frameLines }
      } catch (error) {
        probe = { ...probe, valid: false, issues: [`probe threw: ${String(error)}`] }
      }
      extra = { probe }
    } else {
      const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
      scheduleMs = performance.now() - started
      if (role === 'tasks') {
        // Task construction only: no Search.
        const construction = j.buildPhase2C26B2C2B2JTasks(schedule, task)
        result = { construction,
          scheduleSummary: { policies: schedule.policies, extent: schedule.extent, origins: schedule.origins, checks: schedule.checks, snapshotChecks: schedule.snapshot.checks,
            originDigest: schedule.snapshot.originDigest, targets: schedule.targets.length, contexts: schedule.contexts.length, contextsDigest: sha256(hashing.stableStringify(schedule.contexts)) } }
      } else if (role === 'search') {
        if (!profilePath || !sectionsPath || !childId || !runDir) throw new Error('A search child needs --profile, --sections, --child-id and --run-dir.')
        const { record: scriptsRecord } = writeScriptTable()
        // One open descriptor per file; each record is one synchronous append, so a budget kill keeps everything written before it.
        const profileFd = openSync(profilePath, 'a'), sectionsFd = openSync(sectionsPath, 'a')
        fds.push(profileFd, sectionsFd)
        const durable = record => writeSync(profileFd, JSON.stringify(record) + '\n')
        durable({ kind: 'search_identity', childProcessMs: performance.now(), scheduleMs, identity: j.phase2c26b2c2b2jChildSearchIdentity(schedule, task, sha256) })
        // The CPU profiler: A5's controller with the registered window, anchored at the Search start (Research clock).
        const config = task.cpuProfilerConfig
        await post('Profiler.enable')
        await post('Profiler.setSamplingInterval', { interval: config.requestedSamplingIntervalUs })
        const controller = a5.createPhase2C26A5ProfileController({
          clockPair, config,
          setTimer: (callback, delayMs) => { timers.push(setTimeout(callback, delayMs)) },
          startProfiler: () => post('Profiler.start'),
          stopProfiler: async () => (await post('Profiler.stop')).profile,
          onCaptured: (cpu, window) => {
            const body = JSON.stringify(cpu)
            const file = `${childId}.cpuprofile`
            writeFileSync(join(runDir, file), body)
            const capture = { kind: 'profile_captured', childProcessMs: performance.now(), window,
              profile: { file, sha256: sha256(body), bytes: Buffer.byteLength(body), samples: cpu.samples.length, nodes: cpu.nodes.length }, scripts: scriptsRecord }
            writeFileSync(join(runDir, `${childId}.capture.json`), JSON.stringify(capture))
            process.send?.({ type: 'profile_captured', childProcessMs: capture.childProcessMs, window, samples: cpu.samples.length })
          },
        })
        const profiler = j.createPhase2C26B2C2B2JProfiler({ now: () => performance.now(), emitBoundary: record => writeSync(sectionsFd, JSON.stringify(record) + '\n'),
          onSearchStarted: researchMs => controller.onSearchStarted(researchMs) })
        const origin = profiler.start()
        durable({ kind: 'profiler_started', originChildProcessMs: origin, childProcessMs: performance.now() })
        const memoryNow = () => { const usage = process.memoryUsage(); return { heapUsed: usage.heapUsed, rss: usage.rss, maxima: tracker.sample(usage) } }
        const snapshot = (reason, windowBoundaryMs = null) => durable({ ...profiler.snapshot(reason, windowBoundaryMs), memory: memoryNow(), yieldsTotal: yields,
          profilerState: controller.state(), childProcessMs: performance.now() })
        let boundariesScheduled = false
        const heartbeat = () => {
          snapshot('heartbeat')
          const searchStartedAt = profiler.searchStartedAtMs()
          if (!boundariesScheduled && searchStartedAt !== null) {
            boundariesScheduled = true
            // Window boundaries of the Search elapsed (Research clock): one durable snapshot at each.
            for (const [, toMs] of h.PHASE2C26B2C2B2H_WINDOWS_MS) {
              const due = origin + searchStartedAt + toMs - performance.now()
              timers.push(setTimeout(() => snapshot('window_boundary', toMs), Math.max(0, due)))
            }
          }
        }
        timers.push(setInterval(heartbeat, h.PHASE2C26B2C2B2H_HEARTBEAT_INTERVAL_MS))
        const yieldControl = profiler.wrapYield(() => new Promise(done => { yields += 1; setImmediate(done) }))
        try {
          result = await j.runPhase2C26B2C2B2JTask(input, schedule, task, engine, { yieldControl, instrumentation: profiler.instrumentation })
        } finally {
          await controller.onKernelEnded()
        }
        snapshot('final')
        profile = { file: basename(profilePath), sections: basename(sectionsPath) }
        extra = { profilerState: controller.state(), window: controller.window() }
      } else throw new Error(`Unknown role ${role}.`)
    }
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, scheduleMs, yields, profile, ...extra,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, false)
  } finally {
    clearInterval(timer)
    for (const t of timers) clearTimeout(t)
    for (const fd of fds) closeSync(fd)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), probesPath = option('--probes')
const b2c2b2iResultPath = option('--b2c2b2i-result'), b2c2b2iRawPath = option('--b2c2b2i-raw'), b2c2b2iRunDir = option('--b2c2b2i-run-dir')
if (!runDir || !outputPath || !probesPath || !b2c2b2iResultPath || !b2c2b2iRawPath || !b2c2b2iRunDir) throw new Error('The parent needs --probes, --b2c2b2i-result, --b2c2b2i-raw, --b2c2b2i-run-dir, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: a shorter budget and / or profile window.
const smokeNumber = name => option(name) === undefined ? null : Number(option(name))
const smokeBudgetMs = smokeNumber('--smoke-budget-ms'), smokeWarmupMs = smokeNumber('--smoke-warmup-ms'), smokeStopMs = smokeNumber('--smoke-stop-ms')
const smoke = smokeBudgetMs !== null || smokeWarmupMs !== null || smokeStopMs !== null
if (smoke && !allowUncommitted) throw new Error('Smoke options are non-formal and need --allow-uncommitted.')
for (const [name, value] of [['--smoke-budget-ms', smokeBudgetMs], ['--smoke-warmup-ms', smokeWarmupMs], ['--smoke-stop-ms', smokeStopMs]]) {
  if (value !== null && !(Number.isInteger(value) && value > 0)) throw new Error(`${name} must be a positive integer.`)
}

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const repositoryHead = git('rev-parse', 'HEAD')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawProbes = await readFile(probesPath)
const rawB2C2B2I = await readFile(b2c2b2iResultPath)

const server = await createLoader()
try {
  const { h, j, c26a, ProductionRngEngine } = await loadModules(server)
  const jTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2JTargets.ts')
  // 0. The probe manifest (the probe and its expected Search input identity only) and the Export it names.
  const parsed = j.parsePhase2C26B2C2B2JProbeManifest(JSON.parse(rawProbes.toString('utf8')))
  if (!parsed.valid) throw new Error(`The probe manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export read is not the one the probe manifest names.')
  const targetWeaponIds = manifest.probes.map(p => p.targetWeaponId)
  // 0b. The formal before authority (the parent only; the Search child never reads it) and its local raw files.
  const before = jTargets.parsePhase2C26B2C2B2JB2C2B2IAuthority(JSON.parse(rawB2C2B2I.toString('utf8')), sha256(rawB2C2B2I))
  if (!before.valid) throw new Error(`The B2-C2B2I RESULT is not the registered before authority: ${before.issues.join('; ')}`)
  if (manifest.b2c2b2iResultSha256 !== before.authority.resultSha256) throw new Error('The probe manifest was not made from the B2-C2B2I RESULT read.')
  const beforeLocal = {}
  const beforeIssues = []
  for (const name of j.PHASE2C26B2C2B2J_BEFORE_FILES) {
    const recorded = before.authority.beforeFiles[name]
    const path = name === 'run' ? b2c2b2iRawPath : join(b2c2b2iRunDir, recorded.file)
    if (basename(path) !== recorded.file) beforeIssues.push(`${name}: the file name ${basename(path)} is not the recorded ${recorded.file}`)
    const local = existsSync(path) ? sha256(readFileSync(path)) : null
    beforeLocal[name] = local ?? ''
    if (local !== recorded.sha256) beforeIssues.push(`${name}: the local file SHA-256 ${local} is not the recorded ${recorded.sha256}`)
  }
  if (beforeIssues.length > 0 && !smoke) throw new Error(`The B2-C2B2I before evidence is not the recorded one; no formal comparison: ${beforeIssues.join('; ')}`)
  // 0c. The PR #209 main: an ancestor of HEAD, with no Production calculation change since B2-C2B2I's measured HEAD (PR #209 is
  // test / fixture only, so B2-C2B2I's after evidence is the before of this phase).
  const baseMain = j.PHASE2C26B2C2B2J_BASE_MAIN.sha
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const productionChangedB2C2B2IToBaseMain = j.phase2c26b2c2b2jProductionChangedFiles(git('diff', '--name-only', before.authority.measuredHead, baseMain, '--', ...codePaths).split(/\r?\n/).filter(Boolean))
  // 0d. The Production change since B2-C2B2I's measured HEAD (working tree included) and the shape of the registered optimization.
  const changedSince = git('diff', '--name-only', before.authority.measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
  const productionChangedFiles = j.phase2c26b2c2b2jProductionChangedFiles([...changedSince, ...untracked])
  const sourceCheck = j.phase2c26b2c2b2jOptimizationSourceCheck(gitShow(before.authority.measuredHead, j.PHASE2C26B2C2B2J_OPTIMIZATION.file),
    readFileSync(j.PHASE2C26B2C2B2J_OPTIMIZATION.file, 'utf8'))
  const changeIssues = [...(JSON.stringify(productionChangedFiles) === JSON.stringify([...j.PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES]) ? []
    : [`the Production change is ${productionChangedFiles.join(', ') || 'nothing'}, not exactly ${j.PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES.join(', ')}`]), ...sourceCheck.issues,
    ...(baseMainIsAncestor ? [] : [`the PR #209 main ${baseMain} is not an ancestor of HEAD`]),
    ...(productionChangedB2C2B2IToBaseMain.length === 0 ? [] : [`Production changed between the B2-C2B2I measured HEAD and the PR #209 main: ${productionChangedB2C2B2IToBaseMain.join(', ')}`])]
  if (changeIssues.length > 0 && !smoke) throw new Error(`The Production change is not the registered optimization; no formal run: ${changeIssues.join('; ')}`)
  const cpuProfilerConfig = { ...h.PHASE2C26B2C2B2H_CPU_PROFILER, ...(smokeWarmupMs === null ? {} : { warmupMs: smokeWarmupMs }), ...(smokeStopMs === null ? {} : { profileStopMs: smokeStopMs }) }
  cpuProfilerConfig.requestedProfileDurationMs = cpuProfilerConfig.profileStopMs - cpuProfilerConfig.warmupMs
  if (!(cpuProfilerConfig.requestedProfileDurationMs > 0)) throw new Error('The profile window is empty.')

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, j.PHASE2C26B2C2B2J_START_ATTESTATION_FILE)
  const smokeOptions = smoke ? { budgetMs: smokeBudgetMs, warmupMs: smokeWarmupMs, profileStopMs: smokeStopMs } : null
  const stage1Conditions = { ...j.PHASE2C26B2C2B2J_STAGE1, budgetMs: smokeBudgetMs ?? j.PHASE2C26B2C2B2J_STAGE1.budgetMs }
  const attestation = j.phase2c26b2c2b2jStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead,
    uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, baseMainIsAncestor, exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), probeManifestB2C2B2IResultSha256: manifest.b2c2b2iResultSha256,
    probeManifestB2C2B2HResultSha256: manifest.b2c2b2hResultSha256, probeManifestB2C2B2GResultSha256: manifest.b2c2b2gResultSha256,
    probeManifestB2C2B2FResultSha256: manifest.b2c2b2fResultSha256, probeManifestB2C2B2EResultSha256: manifest.b2c2b2eResultSha256, targetWeaponIds, probes: manifest.probes,
    expectedTaskIdentities: manifest.expectedTaskIdentities, b2c2b2iExcludedRouteKeySha256: before.authority.excludedRouteKeySha256, b2c2b2iResultSha256: sha256(rawB2C2B2I),
    b2c2b2iMeasuredHead: before.authority.measuredHead, b2c2b2iBeforeFiles: beforeLocal, productionChangedB2C2B2IToBaseMain, productionChangedFiles,
    optimizationSourceCheckValid: sourceCheck.valid, stage1: stage1Conditions, cpuProfilerConfig, smoke: smokeOptions })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  const reg = jTargets.PHASE2C26B2C2B2J_REGISTERED_B2C2B2I
  if (!smoke && !uncommitted) {
    const check = j.verifyPhase2C26B2C2B2JStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, exportSha256: sha256(rawExport),
      probeManifestSha256: sha256(rawProbes), b2c2b2iResultSha256: reg.resultSha256, b2c2b2iMeasuredHead: reg.measuredHead, b2c2b2hResultSha256: reg.b2c2b2hResultSha256,
      b2c2b2gResultSha256: reg.b2c2b2gResultSha256, b2c2b2fResultSha256: reg.b2c2b2fResultSha256, b2c2b2eResultSha256: reg.b2c2b2eResultSha256,
      b2c2b2iExcludedRouteKeySha256: before.authority.excludedRouteKeySha256,
      b2c2b2iBeforeFiles: Object.fromEntries(j.PHASE2C26B2C2B2J_BEFORE_FILES.map(name => [name, before.authority.beforeFiles[name].sha256])),
      productionChangedFiles: [...j.PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES], probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: j.PHASE2C26B2C2B2J_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke} production=${productionChangedFiles.join(',')} sourceCheck=${sourceCheck.valid} baseMainIsAncestor=${baseMainIsAncestor}`)

  const processes = []
  const processesPath = join(runDir, 'processes.jsonl')
  const phaseStarted = performance.now()
  const nodeFlags = [...h.PHASE2C26B2C2B2H_NODE_FLAGS]

  /** One fresh child. Resolves with its record (or null), its record file SHA-256 and classified outcome; never throws for a child failure. */
  const runChild = (id, childRole, task, budgetMs) => new Promise(done => {
    const taskPath = task === null ? null : join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const profilePath = join(runDir, `${id}.profile.jsonl`)
    const sectionsPath = join(runDir, `${id}.sections.jsonl`)
    const start = async () => {
      if (taskPath) await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--child-id', id, '--run-dir', runDir,
        ...(taskPath ? ['--task', taskPath] : []), ...(childRole === 'search' ? ['--profile', profilePath, '--sections', sectionsPath] : [])]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null, lastMemory = null, lastYields = 0, memoryMessages = 0, profileCaptured = null
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      console.log(`${startedAt} START ${id} pid=${child.pid}`)
      // The budget is judged here, in the parent, never by the child.
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, budgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        if (message?.type === 'profile_captured') {
          profileCaptured = { receivedAtMs: performance.now() - began, ...message }
          console.log(`${new Date().toISOString()} PROFILE ${id} samples=${message.samples} start+${(message.window.startDelayMs / 1000).toFixed(2)}s stop+${(message.window.stopDelayMs / 1000).toFixed(2)}s`)
          return
        }
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
        const endedAt = new Date().toISOString()
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, endedAt, wallMs: performance.now() - began, killedAtMs, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, profileCaptured, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        const recordRaw = outcome === 'completed' ? await readFile(recordPath) : null
        const recordFile = recordRaw === null ? null : { file: basename(recordPath), bytes: recordRaw.length, sha256: sha256(recordRaw) }
        const fileRecord = path => existsSync(path) ? { file: basename(path), sha256: sha256(readFileSync(path)) } : null
        const profileFile = childRole === 'search' ? fileRecord(profilePath) : null
        const sectionsFile = childRole === 'search' ? fileRecord(sectionsPath) : null
        const cpuProfileFile = childRole === 'search' ? fileRecord(join(runDir, `${id}.cpuprofile`)) : null
        const captureFile = childRole === 'search' ? fileRecord(join(runDir, `${id}.capture.json`)) : null
        const scriptsFile = childRole === 'search' || childRole === 'probe' ? fileRecord(join(runDir, `${id}.scripts.json`)) : null
        appendFileSync(processesPath, JSON.stringify({ ...entry, recordFile, profileFile, sectionsFile, cpuProfileFile, captureFile, scriptsFile }) + '\n')
        const record = recordRaw === null ? null : JSON.parse(recordRaw.toString('utf8'))
        const s = record?.result?.status === 'searched' ? record.result.search : null
        const status = s ? ` ${s.termination} n=${s.candidates.length}` : record?.result?.status ? ` ${record.result.status}` : ''
        console.log(`${endedAt} ${outcome.toUpperCase()} ${id}${status} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB`)
        done({ entry, record, recordFile, profileFile, sectionsFile, cpuProfileFile, captureFile, scriptsFile })
      })
    }
    start()
  })

  const b2c2b2hConditions = h.phase2c26b2c2b2hRegisteredConditions()
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtLaunch: freemem(),
    stage1: stage1Conditions, b2c2b2hStage1: b2c2b2hConditions.stage1, changedFromB2C2B2I: [...j.PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I], optimization: j.PHASE2C26B2C2B2J_OPTIMIZATION,
    registeredProductionChangedFiles: [...j.PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES], productionChangedFiles, productionChangedB2C2B2IToBaseMain, baseMain: j.PHASE2C26B2C2B2J_BASE_MAIN,
    baseMainIsAncestor, optimizationSourceCheck: sourceCheck,
    b2c2b2iResultSha256: sha256(rawB2C2B2I), b2c2b2iMeasuredHead: before.authority.measuredHead, b2c2b2iBeforeFiles: beforeLocal, b2c2b2iBeforeIssues: beforeIssues,
    b2c2b2iExcludedRouteKeySha256: before.authority.excludedRouteKeySha256,
    tasksBudgetMs: b2c2b2hConditions.tasksBudgetMs, targets: j.PHASE2C26B2C2B2J_TARGETS, expectedTasks: j.PHASE2C26B2C2B2J_EXPECTED_TASKS, section: b2c2b2hConditions.section,
    maxCostCohorts: h.PHASE2C26B2C2B2H_MAX_COST_COHORTS, candidateSafetyCap: h.PHASE2C26B2C2B2H_CANDIDATE_SAFETY_CAP, population: j.PHASE2C26B2C2B2J_POPULATION, probes: manifest.probes,
    expectedTaskIdentities: manifest.expectedTaskIdentities, memorySampleIntervalMs: h.PHASE2C26B2C2B2H_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: h.PHASE2C26B2C2B2H_NODE_YIELD,
    searchInstrumentation: { ...h.PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION }, innerSections: [...h.PHASE2C26B2C2B2H_INNER_SECTIONS], cpuProfiler: true, cpuProfilerConfig, nodeFlags,
    profilerMethod: 'node:inspector Session (main thread): Debugger.enable while the modules load (scriptParsed: url + inline source map), Debugger.disable, then Profiler.enable / setSamplingInterval / start / stop (A5 profile controller, Search start anchor)',
    sectionStream: { ...h.PHASE2C26B2C2B2H_SECTION_STREAM }, heartbeatIntervalMs: h.PHASE2C26B2C2B2H_HEARTBEAT_INTERVAL_MS, windowsMs: h.PHASE2C26B2C2B2H_WINDOWS_MS,
    notRun: [...j.PHASE2C26B2C2B2J_NOT_RUN], ...j.PHASE2C26B2C2B2J_PROVENANCE_FLAGS, repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), probeManifestBytes: rawProbes.length,
    probeManifestB2C2B2IResultSha256: manifest.b2c2b2iResultSha256, probeManifestB2C2B2HResultSha256: manifest.b2c2b2hResultSha256,
    probeManifestB2C2B2GResultSha256: manifest.b2c2b2gResultSha256, probeManifestB2C2B2FResultSha256: manifest.b2c2b2fResultSha256,
    probeManifestB2C2B2EResultSha256: manifest.b2c2b2eResultSha256, smoke: smokeOptions }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2J: the B2-C2B2I adopted Target, B2-C2B2I Search input, 30-minute run with the V8 CPU profiler at the optimized HEAD (held-aware Keep family layout key reuse; Node Research run, raw)',
    measuredAt: attestation.createdAt, environment, launchAttestation, targetWeaponIds }

  // 2. The profiler probe (no Search).
  const probeRun = await runChild('probe', 'probe', null, 300_000)
  const probe = probeRun.record?.probe ?? { valid: false, issues: ['the probe child left no record'] }
  console.log(`probe: valid=${probe.valid} samples=${probe.samples ?? '-'} medianInterval=${probe.observedMedianIntervalUs ?? '-'}us ${(probe.issues ?? []).join('; ')}`)
  const probeView = { process: probeRun.entry, recordFile: probeRun.recordFile, scriptsFile: probeRun.scriptsFile, probe }
  if (!probe.valid) {
    await write(outputPath, { ...base, status: 'probe_failed', probe: probeView, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The profiler probe failed; no Search was run.')
  }

  // 3. Task construction (no Search). The child gets the probe and the expected identity only.
  const tasksRun = await runChild('tasks', 'tasks', { probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities }, b2c2b2hConditions.tasksBudgetMs)
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', probe: probeView, processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  const construction = tasksRun.record.result.construction
  const tasksChild = { process: tasksRun.entry, recordFile: tasksRun.recordFile, childWallMs: tasksRun.record.wallMs, scheduleMs: tasksRun.record.scheduleMs, memory: tasksRun.record.memory,
    researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion,
    scheduleSummary: tasksRun.record.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  const tasks = construction.tasks
  const gateIssues = [...construction.issues]
  if (tasks.length !== j.PHASE2C26B2C2B2J_EXPECTED_TASKS) gateIssues.push(`${tasks.length} tasks, not ${j.PHASE2C26B2C2B2J_EXPECTED_TASKS}`)
  manifest.expectedTaskIdentities.forEach((expected, index) => {
    const task = tasks[index]
    if (!task || JSON.stringify(j.phase2c26b2c2b2jTaskIdentity(task)) !== JSON.stringify(expected)) gateIssues.push(`${expected.taskId}: the task is not the expected task identity`)
  })
  console.log(`tasks: ${tasks.length}; gate ${gateIssues.length === 0 ? 'ok' : gateIssues.join('; ')}`)
  if (gateIssues.length > 0) {
    await write(outputPath, { ...base, status: 'task_construction_failed', gateIssues, probe: probeView, tasksChild, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Task construction failed; no Search was run: ${gateIssues.join('; ')}`)
  }

  // 4. Stage 1: once, 30 minutes, 12,288 MB, concurrency 1, the CPU profiler window; no retry, no fallback.
  const stage1 = []
  for (const task of tasks) {
    const run = await runChild(`stage1-${task.taskId}`, 'search', { ...task, cpuProfilerConfig }, stage1Conditions.budgetMs)
    const result = run.record?.result ?? null
    const outcome = j.phase2c26b2c2b2jTaskOutcome(task.taskId, run.entry.outcome, result)
    stage1.push({ taskId: task.taskId, task, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail,
        startedAt: run.entry.startedAt, endedAt: run.entry.endedAt, killedAtMs: run.entry.killedAtMs, nodeFlags: run.entry.nodeFlags, profileCaptured: run.entry.profileCaptured },
      recordFile: run.recordFile, profileFile: run.profileFile, sectionsFile: run.sectionsFile, cpuProfileFile: run.cpuProfileFile, captureFile: run.captureFile, scriptsFile: run.scriptsFile,
      childWallMs: run.record?.wallMs ?? null, scheduleMs: run.record?.scheduleMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null, memory: run.record?.memory ?? null,
      lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null, researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null,
      rngEngineVersion: run.record?.rngEngineVersion ?? null, contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs, summary: result.search.summary } : null })
  }

  const record = { ...base, status: 'completed', probe: probeView, tasksChild, tasks, stage1, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: tasks.length, stage1: stage1.map(r => ({ taskId: r.taskId, process: r.outcome.process, record: r.outcome.record,
    termination: r.outcome.termination, wallMs: r.process.wallMs, profileCaptured: r.cpuProfileFile !== null })), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
