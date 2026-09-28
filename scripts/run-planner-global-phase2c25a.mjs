// Issue #154 Phase 2-C2.5-A Research only: localize the Phase 2-C2 kernel OOM to the Planner Alternative Search alone.
//
// Parent (default role):
//   0. reads the Phase 2-C2 evidence (explicit --c2) for workload selection and context parity ONLY;
//   1. `contexts` child: this run's own baseline (ordinary Production Planner over the original Export), its orientations,
//      and the kernel pre-search context of every non-fixed Target of the selected and the Phase 2-C2 completed
//      orientations (kernel preparation + Planner reservation authority). The parent checks the baseline orientations
//      and the completed orientations' contexts against the Phase 2-C2 evidence and stops before any Search on a mismatch;
//   2. `search` children, one fresh process per (context, mode), concurrency 1, heap limit 8192 MB: the child re-derives
//      the context from the Export, checks its digest against step 1, and runs only visitPlannerAlternativeCandidates()
//      with a consumer stop at 1 Candidate, `minimal` (no instrumentation, no counting) then `instrumented` (existing
//      Search instrumentation + counting Engine, sparse progress snapshots sent over IPC so an OOM keeps them).
// The only calculation input is the Export; a child gets only what an earlier child of THIS run derived. A child
// failure (timeout, out of memory, any other failure) is recorded as that failure, never as "no Candidate".
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) throw new Error('Usage: node scripts/run-planner-global-phase2c25a.mjs --export <external.json> --c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --out-dir <dir> --output <new.json.local> [--run-budget-ms N] [--allow-uncommitted --only <orientationId,...> --max-targets N]')

const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

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
  c25a: '/src/benchmarks/plannerGlobalPhase2C25A.ts',
  c2: '/src/benchmarks/plannerGlobalPhase2C2.ts',
  research: '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
  runner: '/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts',
  rng: '/src/domain/rng/production/productionRngEngine.ts',
}
const memorySample = () => { const m = process.memoryUsage(); return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss, external: m.external, arrayBuffers: m.arrayBuffers } }
const setImmediateYield = () => new Promise(done => setImmediate(done))

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
      baseline: { summary: baseline.summary, orientations: baseline.orientations }, contexts })
  })
  process.exit(0)
}

if (role === 'search') {
  // ------------------------------------------------------------------ search child (IPC)
  const task = JSON.parse((await readFile(option('--task'))).toString('utf8'))
  const send = message => new Promise(done => process.send(message, () => done()))
  await withModules(CHILD_MODULES, async ({ c25a, research, runner, rng }) => {
    const prepStarted = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new rng.ProductionRngEngine()
    const prepared = c25a.derivePhase2C25APreSearchContexts(input, task.orientation, research.globalResearchDependencies(engine))
    const context = prepared.contexts[task.workIndex]
    if (!context || context.targetWeaponId !== task.targetWeaponId || context.contextDigest !== task.contextDigest) {
      throw new Error(`Re-derived context ${task.orientation.orientationId}#${task.workIndex} differs from the contexts child (${context?.contextDigest} != ${task.contextDigest}).`)
    }
    await send({ type: 'ready', preparationMs: performance.now() - prepStarted, preSearchMemory: memorySample(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit })
    const record = await c25a.runPhase2C25ASearchOnly(input, prepared, task.workIndex, engine, {
      mode: task.mode,
      yieldControl: setImmediateYield,
      snapshotPolicy: task.snapshotPolicy,
      observation: task.mode === 'instrumented' ? {
        memory: memorySample,
        setHeartbeat: (callback, intervalMs) => { const timer = setInterval(callback, intervalMs); return () => clearInterval(timer) },
        emit: snapshot => { process.send({ type: 'snapshot', snapshot }) },
      } : undefined,
    })
    // The prepared scenario stays referenced through the Search, as in the kernel.
    const worksKept = prepared.prepared.scenario.works.length
    await send({ type: 'final', record, worksKept, postSearchMemory: memorySample(), maxRssKiB: process.resourceUsage().maxRSS })
  })
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const c2Path = option('--c2'), outDir = option('--out-dir'), outputPath = option('--output')
if (!c2Path || !outDir || !outputPath) throw new Error('The parent needs --c2, --out-dir and --output.')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(outDir)) throw new Error(`Out dir already exists: ${resolve(outDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
const only = option('--only')?.split(',') ?? null
const maxTargets = option('--max-targets') === undefined ? null : Number(option('--max-targets'))
if ((only !== null || maxTargets !== null) && !allowUncommitted) throw new Error('--only / --max-targets are non-formal smoke options and need --allow-uncommitted.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal probe).')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
const rawC2 = await readFile(c2Path)
const c2EvidenceSha256 = sha256(rawC2)
await mkdir(outDir, { recursive: true })
const scriptPath = 'scripts/run-planner-global-phase2c25a.mjs'
const processes = []
const phaseStarted = performance.now()

await withModules({ c25a: CHILD_MODULES.c25a, analysis: '/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts', c2: CHILD_MODULES.c2 }, async ({ c25a, analysis, c2 }) => {
  const childHeapMb = c25a.PHASE2C25A_CHILD_HEAP_MB
  const runBudgetMs = Number(option('--run-budget-ms') ?? c25a.PHASE2C25A_RUN_BUDGET_MS)
  const view = analysis.parsePhase2C25AC2Evidence(JSON.parse(rawC2.toString('utf8')))
  if (view.exportSha256 !== exportSha256) throw new Error('The Phase 2-C2 evidence was measured on another Export.')
  const selection = analysis.selectPhase2C25AWorkload(view)
  const selected = only === null ? selection.selected : selection.selected.filter(item => only.includes(item.orientationId))
  const completedIds = view.orientations.filter(o => o.processOutcome === 'completed').map(o => o.orientationId)
  const contextOrientationIds = [...new Set([...selected.map(item => item.orientationId), ...completedIds])]
  console.log(`selected ${selected.length}: ${selected.map(s => `${s.orientationId}(${s.role}/${s.kind})`).join(' ')}; parity orientations ${completedIds.length}`)

  /** One fresh child. Resolves with its messages and a classified outcome; never throws for a child failure. */
  function runChild(id, childRole, task, budgetMs, { ipc }) {
    return new Promise(done => {
      const taskPath = join(outDir, `${id}.task.json`)
      const recordPath = join(outDir, `${id}.record.json`)
      const progressPath = join(outDir, `${id}.progress.jsonl`)
      const start = async () => {
        await write(taskPath, task)
        const childArgs = [`--max-old-space-size=${childHeapMb}`, scriptPath, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath]
        const began = performance.now(), startedAt = new Date().toISOString()
        let stderrTail = '', timedOut = false
        const collector = analysis.createPhase2C25ARunCollector()
        const arrival = { readyAtMs: null, firstSnapshotAtMs: null, lastSnapshotAtMs: null }
        const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', ...(ipc ? ['ipc'] : [])], windowsHide: true })
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, budgetMs)
        child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8000) })
        if (ipc) {
          child.on('message', message => {
            const snapshot = collector.onMessage(message)
            const at = performance.now() - began
            if (message.type === 'ready') arrival.readyAtMs = at
            if (snapshot !== null) {
              appendFileSync(progressPath, JSON.stringify(snapshot) + '\n')
              arrival.lastSnapshotAtMs = at
              arrival.firstSnapshotAtMs ??= at
            }
          })
        }
        child.once('exit', async (code, signal) => {
          clearTimeout(timer)
          const recordWritten = ipc ? collector.hasFinal() : existsSync(recordPath)
          const outcome = c2.classifyPhase2C2ChildExit({ code, signal, timedOut, stderrTail, recordWritten })
          const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs: performance.now() - began,
            stderrTail: outcome === 'completed' ? null : stderrTail.slice(-3000) }
          processes.push(entry)
          const collected = ipc ? collector.finish(outcome) : null
          console.log(`${outcome.toUpperCase()} ${id} ${(entry.wallMs / 1000).toFixed(1)}s${collected ? ` ${collected.status}` : ''}`)
          const record = !ipc && outcome === 'completed' ? JSON.parse((await readFile(recordPath)).toString('utf8')) : null
          done({ entry, record, collected, arrival })
        })
      }
      start()
    })
  }

  // 1. Contexts from this run's own baseline, then parity with the Phase 2-C2 evidence before any Search.
  const contextsRun = await runChild('contexts', 'contexts', { orientationIds: contextOrientationIds }, runBudgetMs, { ipc: false })
  if (!contextsRun.record) throw new Error('The contexts child failed; nothing else is meaningful.')
  const { baseline, contexts } = contextsRun.record
  const orientationParity = analysis.comparePhase2C25AOrientations(baseline.orientations, view.orientations)
  const contextParity = completedIds.map(orientationId => ({ orientationId,
    ...analysis.comparePhase2C25AContextParity(contexts[orientationId], view.orientations.find(o => o.orientationId === orientationId).kernelTargets, sha256) }))
  const parityMatches = orientationParity.matches && contextParity.every(row => row.matches)
  console.log(`orientation parity ${orientationParity.matches}, context parity ${contextParity.filter(r => r.matches).length}/${contextParity.length} orientations, ${contextParity.flatMap(r => r.rows).filter(r => r.matches).length}/${contextParity.flatMap(r => r.rows).length} contexts`)

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per Search run, NOT a Browser Worker)', node: process.version, platform: platform(), arch: arch(), osRelease: release(),
    cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), childHeapLimitMb: childHeapMb, concurrency: c25a.PHASE2C25A_CONCURRENCY,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, exportFileName: exportPath.split(/[\\/]/).at(-1), exportSha256, exportBytes: rawExport.length,
    c2EvidenceFileName: c2Path.split(/[\\/]/).at(-1), c2EvidenceSha256, c2MeasuredHead: view.measuredHead, calculationContext: contextsRun.record.calculationContext,
    researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps, nodeYield: 'setImmediate', searchExtent: contexts[contextOrientationIds[0]]?.[0]?.extent ?? null,
    candidateStopBound: c25a.PHASE2C25A_CANDIDATE_STOP_BOUND, snapshotPolicy: { ...c25a.PHASE2C25A_SNAPSHOT_POLICY }, runBudgetMs,
    smoke: only === null && maxTargets === null ? null : { only, maxTargets } }
  const base = { phase: 'Issue #154 Phase 2-C2.5-A: kernel OOM localization to Planner Alternative Search (Node Research run, raw)', measuredAt: new Date().toISOString(), environment,
    selection: { ...selection, selectedRun: selected }, baseline: { summary: baseline.summary, orientationCount: baseline.orientations.length }, orientationParity, contextParity,
    contexts: Object.fromEntries(Object.entries(contexts).map(([id, list]) => [id, list.map(({ searchReservation: _raw, ...rest }) => rest)])) }
  if (!parityMatches) {
    await write(outputPath, { ...base, status: 'parity_failed_no_search_run', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('Pre-search context parity with the Phase 2-C2 evidence failed: the formal OOM comparison is invalid and no Search was run.')
  }

  // 2. Search-only runs: every searchable Target of every selected orientation, minimal then instrumented, one at a time.
  const runs = []
  for (const item of selected) {
    const orientation = baseline.orientations.find(o => o.orientationId === item.orientationId)
    const searchable = contexts[item.orientationId].filter(context => context.status === 'searchable')
    for (const context of maxTargets === null ? searchable : searchable.slice(0, maxTargets)) {
      const pair = { orientationId: item.orientationId, role: item.role, kind: item.kind, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, contextDigest: context.contextDigest, modes: {} }
      for (const mode of ['minimal', 'instrumented']) {
        const id = `search-${item.orientationId}-w${context.workIndex}-${mode}`
        const run = await runChild(id, 'search', { orientation, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, contextDigest: context.contextDigest, mode,
          snapshotPolicy: { ...c25a.PHASE2C25A_SNAPSHOT_POLICY } }, runBudgetMs, { ipc: true })
        const { final, ...collected } = run.collected
        pair.modes[mode] = { process: run.entry, ...collected, arrival: run.arrival,
          final: final === null ? null : { ...final, record: { ...final.record, firstCandidateKeySha256: final.record.firstCandidateKey === null ? null : sha256(final.record.firstCandidateKey) } } }
      }
      runs.push(pair)
    }
  }
  const record = { ...base, status: 'completed', blockedContexts: Object.values(contexts).flat().filter(c => c.status !== 'searchable').map(c => ({ orientationId: c.orientationId, targetWeaponId: c.targetWeaponId, status: c.status })),
    runs, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), runs: runs.map(r => `${r.orientationId}#${r.workIndex}: ${r.modes.minimal.status} / ${r.modes.instrumented.status}`),
    wallMs: record.wallMs }, null, 2))
})
