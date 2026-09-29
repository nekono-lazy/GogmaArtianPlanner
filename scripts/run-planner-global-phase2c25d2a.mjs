// Issue #154 Phase 2-C2.5-D2-a Research only: the Node memory effect of the Ideal-only Planner Alternative publication.
//
// Parent (default role):
//   0. reads the Phase 2-C2.5-A committed evidence (explicit --c25a) for workload selection, context parity and the
//      "before" values ONLY; the Export must be the one C2.5-A measured;
//   1. `contexts` child: this run's own baseline (ordinary Production Planner over the original Export) and the kernel
//      pre-search context of every selected context (the unchanged C2.5-A derivation). The parent checks each against
//      the C2.5-A evidence, field by field, and stops before any Search on a mismatch;
//   2. `search` children, one fresh process per (context, mode), concurrency 1, heap limit 8192 MB: the child re-derives
//      the context, checks its digest, and runs the unchanged runPhase2C25ASearchOnly() with a consumer stop at 1
//      Candidate, `minimal` (no Search instrumentation; memory sampled on a timer outside the Search) then
//      `instrumented` (the existing Search instrumentation + counting Engine, sparse progress snapshots over IPC).
// The only calculation input is the Export. A child failure (timeout, out of memory, any other failure) is recorded as
// that failure, never as "no Candidate". Memory values are sampled maxima of process.memoryUsage(), never a true peak.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) throw new Error('Usage: node scripts/run-planner-global-phase2c25d2a.mjs --export <external.json> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --only <orientationId#workIndex,...> --modes minimal,instrumented --run-budget-ms N]')

const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const memorySample = () => { const m = process.memoryUsage(); return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss, external: m.external, arrayBuffers: m.arrayBuffers } }
const setImmediateYield = () => new Promise(done => setImmediate(done))

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
  d2a: '/src/benchmarks/plannerGlobalPhase2C25D2A.ts',
  c25a: '/src/benchmarks/plannerGlobalPhase2C25A.ts',
  c2: '/src/benchmarks/plannerGlobalPhase2C2.ts',
  research: '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
  runner: '/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts',
  rng: '/src/domain/rng/production/productionRngEngine.ts',
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

if (role === 'search') {
  // ------------------------------------------------------------------ search child (IPC)
  const task = JSON.parse((await readFile(option('--task'))).toString('utf8'))
  const send = message => new Promise(done => process.send(message, () => done()))
  await withModules(CHILD_MODULES, async ({ d2a, c25a, research, runner, rng }) => {
    const prepStarted = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new rng.ProductionRngEngine()
    const prepared = c25a.derivePhase2C25APreSearchContexts(input, task.orientation, research.globalResearchDependencies(engine))
    const context = prepared.contexts[task.workIndex]
    if (!context || context.targetWeaponId !== task.targetWeaponId || context.contextDigest !== task.contextDigest) {
      throw new Error(`Re-derived context ${task.orientation.orientationId}#${task.workIndex} differs from the contexts child (${context?.contextDigest} != ${task.contextDigest}).`)
    }
    await send({ type: 'ready', preparationMs: performance.now() - prepStarted, preSearchMemory: memorySample(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit })
    // Minimal mode: a memory timer outside the Search (the Search itself runs without instrumentation).
    const searchStarted = performance.now()
    const memoryTimer = task.mode === 'minimal'
      ? setInterval(() => { process.send({ type: 'memory', elapsedMs: performance.now() - searchStarted, memory: memorySample() }) }, d2a.PHASE2C25D2A_MINIMAL_MEMORY_HEARTBEAT_MS)
      : null
    let record
    try {
      record = await c25a.runPhase2C25ASearchOnly(input, prepared, task.workIndex, engine, {
        mode: task.mode,
        yieldControl: setImmediateYield,
        snapshotPolicy: task.snapshotPolicy,
        observation: task.mode === 'instrumented' ? {
          memory: memorySample,
          setHeartbeat: (callback, intervalMs) => { const timer = setInterval(callback, intervalMs); return () => clearInterval(timer) },
          emit: snapshot => { process.send({ type: 'snapshot', snapshot }) },
        } : undefined,
      })
    } finally {
      if (memoryTimer !== null) clearInterval(memoryTimer)
    }
    // The prepared scenario stays referenced through the Search, as in the kernel.
    const worksKept = prepared.prepared.scenario.works.length
    await send({ type: 'final', record, worksKept, postSearchMemory: memorySample(), maxRssKiB: process.resourceUsage().maxRSS })
  })
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const c25aPath = option('--c25a'), runDir = option('--run-dir'), outputPath = option('--output')
if (!c25aPath || !runDir || !outputPath) throw new Error('The parent needs --c25a, --run-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
const only = option('--only')?.split(',') ?? null
const modesOption = option('--modes')?.split(',') ?? null
const budgetOverride = option('--run-budget-ms') === undefined ? null : Number(option('--run-budget-ms'))
if ((only !== null || modesOption !== null || budgetOverride !== null) && !allowUncommitted) throw new Error('--only / --modes / --run-budget-ms are non-formal smoke options and need --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
const rawC25A = await readFile(c25aPath)
await mkdir(runDir, { recursive: true })
const scriptPath = 'scripts/run-planner-global-phase2c25d2a.mjs'
const processes = []
const phaseStarted = performance.now()

await withModules({ d2a: CHILD_MODULES.d2a, c25c: '/src/benchmarks/plannerGlobalPhase2C25C.ts', analysis: '/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts',
  c2: CHILD_MODULES.c2 }, async ({ d2a, c25c, analysis, c2 }) => {
  const c25aJson = JSON.parse(rawC25A.toString('utf8'))
  const view = c25c.parsePhase2C25CEvidence(c25aJson)
  if (view.exportSha256 !== exportSha256) throw new Error('The Phase 2-C2.5-A evidence was measured on another Export.')
  const workload = c25c.selectPhase2C25CWorkload(view)
  const selected = d2a.phase2c25d2aWorkloadItems(workload).filter(item => only === null || only.includes(`${item.orientationId}#${item.workIndex}`))
  const modes = modesOption ?? [...d2a.PHASE2C25D2A_MODES]
  const runBudgetMs = budgetOverride ?? d2a.PHASE2C25D2A_RUN_BUDGET_MS
  const childHeapMb = d2a.PHASE2C25D2A_CHILD_HEAP_MB
  // Fail closed on the "before" view before any child: every selected context must be readable from the evidence.
  d2a.parsePhase2C25D2ABefore(c25aJson, selected)
  console.log(`selected ${selected.length}: ${selected.map(s => `${s.orientationId}#${s.workIndex}(${s.role})`).join(' ')}`)

  /** One fresh child. Resolves with its messages and a classified outcome; never throws for a child failure. */
  function runChild(id, childRole, task, { ipc }) {
    return new Promise(done => {
      const taskPath = join(runDir, `${id}.task.json`)
      const recordPath = join(runDir, `${id}.record.json`)
      const messagesPath = join(runDir, `${id}.messages.jsonl`)
      const start = async () => {
        await write(taskPath, task)
        const heapArgs = [`--max-old-space-size=${childHeapMb}`]
        const childArgs = [...heapArgs, scriptPath, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath]
        const began = performance.now(), startedAt = new Date().toISOString()
        let stderrTail = '', timedOut = false
        const collector = analysis.createPhase2C25ARunCollector()
        const memorySamples = []
        const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', ...(ipc ? ['ipc'] : [])], windowsHide: true })
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, runBudgetMs)
        child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
        if (ipc) {
          child.on('message', message => {
            appendFileSync(messagesPath, JSON.stringify({ receivedAtMs: performance.now() - began, message: message.type === 'snapshot' ? { type: 'snapshot', snapshot: analysis.compactPhase2C25ASnapshot(message.snapshot) } : message }) + '\n')
            if (message.type === 'memory') memorySamples.push({ elapsedMs: message.elapsedMs, memory: message.memory })
            else {
              const snapshot = collector.onMessage(message)
              if (snapshot !== null) memorySamples.push({ elapsedMs: snapshot.elapsedMs, memory: snapshot.memory })
            }
          })
        }
        child.once('exit', async (code, signal) => {
          clearTimeout(timer)
          const recordWritten = ipc ? collector.hasFinal() : existsSync(recordPath)
          const outcome = c2.classifyPhase2C2ChildExit({ code, signal, timedOut, stderrTail, recordWritten })
          const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs: runBudgetMs, startedAt, wallMs: performance.now() - began, nodeFlags: heapArgs,
            stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
          processes.push(entry)
          const collected = ipc ? collector.finish(outcome) : null
          console.log(`${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s${collected ? ` ${collected.status}` : ''}`)
          const record = !ipc && outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
          done({ entry, record, collected, memorySamples })
        })
      }
      start()
    })
  }

  // 1. Contexts from this run's own baseline, then parity with the C2.5-A evidence before any Search.
  const orientationIds = [...new Set(selected.map(item => item.orientationId))]
  const contextsRun = await runChild('contexts', 'contexts', { orientationIds }, { ipc: false })
  if (!contextsRun.record) throw new Error('The contexts child failed; nothing else is meaningful.')
  const { contexts, orientations } = contextsRun.record
  const parity = selected.map(item => {
    const derived = contexts[item.orientationId].find(context => context.workIndex === item.workIndex)
    if (!derived) return { orientationId: item.orientationId, workIndex: item.workIndex, matches: false, fields: [{ field: 'derived', matches: false }] }
    return c25c.comparePhase2C25CContextParity(derived, view.preSearchContexts.get(c25c.phase2c25cContextKey(item.orientationId, item.workIndex)), sha256)
  })
  const parityMatches = parity.every(row => row.matches) && selected.every(item => contexts[item.orientationId].find(c => c.workIndex === item.workIndex)?.contextDigest === item.contextDigest)
  console.log(`context parity ${parity.filter(r => r.matches).length}/${parity.length}`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per Search run, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    childHeapLimitMb: childHeapMb, jit: 'jit_default (no V8 flag other than --max-old-space-size)', concurrency: d2a.PHASE2C25D2A_CONCURRENCY,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256, exportBytes: rawExport.length,
    c25aEvidenceFileName: basename(c25aPath), c25aEvidenceSha256: sha256(rawC25A), c25aMeasuredHead: view.measuredHead,
    calculationContext: contextsRun.record.calculationContext, researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps, nodeYield: 'setImmediate',
    searchExtent: contexts[orientationIds[0]]?.[0]?.extent ?? null, candidateStopBound: d2a.PHASE2C25D2A_CANDIDATE_STOP_BOUND,
    snapshotPolicy: { ...d2a.PHASE2C25D2A_SNAPSHOT_POLICY }, minimalMemoryHeartbeatMs: d2a.PHASE2C25D2A_MINIMAL_MEMORY_HEARTBEAT_MS, runBudgetMs, modes,
    smoke: only === null && modesOption === null && budgetOverride === null ? null : { only, modes: modesOption, runBudgetMs: budgetOverride } }
  const base = { phase: 'Issue #154 Phase 2-C2.5-D2-a: Node memory effect of the Ideal-only Planner Alternative publication (Node Research run, raw)',
    measuredAt: new Date().toISOString(), environment, workload, selected, parity,
    contexts: Object.fromEntries(Object.entries(contexts).map(([id, list]) => [id, list.map(({ searchReservation: _raw, ...rest }) => rest)])) }
  if (!parityMatches) {
    await write(outputPath, { ...base, status: 'parity_failed_no_search_run', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('Pre-search context parity with the Phase 2-C2.5-A evidence failed: no Search was run.')
  }

  // 2. Search-only runs: every selected context, minimal then instrumented, one fresh 8 GB child at a time.
  const runs = []
  for (const item of selected) {
    const run = { item, modes: {} }
    for (const mode of modes) {
      const id = `search-${item.orientationId}-w${item.workIndex}-${mode}`
      const child = await runChild(id, 'search', { orientation: orientations[item.orientationId], workIndex: item.workIndex, targetWeaponId: item.targetWeaponId,
        contextDigest: item.contextDigest, mode, snapshotPolicy: { ...d2a.PHASE2C25D2A_SNAPSHOT_POLICY } }, { ipc: true })
      const { final, ...collected } = child.collected
      run.modes[mode] = { process: child.entry, ...collected, memorySamples: child.memorySamples,
        v8FatalGc: child.entry.outcome === 'out_of_memory' ? analysis.parsePhase2C25AV8FatalGcTrace(child.entry.stderrTail) : null,
        final: final === null ? null : { ...final, record: { ...final.record, firstCandidateKey: undefined,
          firstCandidateKeySha256: final.record.firstCandidateKey === null ? null : sha256(final.record.firstCandidateKey) } } }
    }
    runs.push(run)
  }
  const record = { ...base, status: 'completed', runs, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), runs: runs.map(r => `${r.item.orientationId}#${r.item.workIndex}: ${Object.entries(r.modes).map(([m, v]) => `${m}=${v.status}`).join(' ')}`),
    wallMs: record.wallMs }, null, 2))
})
