// Issue #154 D2-G-A Research only (non-formal): the K3 Search memory diagnosis (docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2GA.md).
//
// Parent (default role): verifies the Export SHA-256, reads the four formal discovery tasks read-only (D2-E K2 L0 / L1 from
// .local/d2e-k2-formal2.run, D2-F K3 L0 / L1 from .local/d2f-k3-formal.run) and checks them (checkD2GAFormalTask()), then runs the
// registered protocol (D2GA_PROTOCOL): K2-L0 -> K3-L0 -> K2-L1 -> K3-L1, one fresh child each, concurrency 1, child heap 12,288 MB,
// child wall 15 minutes, 90 minutes for the whole diagnosis, no retry, no fallback. K3 L2 is never re-run.
//
// Child (`--role child`): rebuilds the Research PlannerInput from the Export exactly as the formal discover child did, runs
// runD2GADiagnosticUnit() with the read-only observer, samples process.memoryUsage() every 250 ms (a bounded, thinned series is
// appended to <unit>.series.jsonl as it goes, so an OOM child still leaves its series), observes GC through PerformanceObserver
// (no GC is forced: the heapUsed read right after a major GC is the live-heap proxy), and writes <unit>.record.json.
// Nothing is committed: the run dir and the output stay under .local.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) throw new Error('Usage: node scripts/run-planner-global-d2ga.mjs --export <Export .json> --run-dir <new dir under .local> --output <new .json.local>')
const SCRIPT_PATH = 'scripts/run-planner-global-d2ga.mjs'
const sha256 = value => createHash('sha256').update(value).digest('hex')
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })

if (role === 'child') {
  const unitId = option('--unit'), taskPath = option('--task'), recordPath = option('--record'), seriesPath = option('--series')
  if (!unitId || !taskPath || !recordPath || !seriesPath) throw new Error('A child needs --unit, --task, --record and --series.')
  const server = await createLoader()
  const d2ga = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2GA.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const protocol = d2ga.D2GA_PROTOCOL
  const unit = protocol.units.find(u => u.id === unitId)
  if (!unit) throw new Error(`Unknown unit ${unitId}`)
  const started = performance.now()
  const at = () => performance.now() - started
  let yields = 0
  const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
  const maxima = { heapUsed: 0, heapTotal: 0, rss: 0, samples: 0 }
  let observer = null
  const series = d2ga.createD2GASeries(protocol.keepEverySample, protocol.maxKeptSamples)
  const gc = { byKind: {}, major: [], majorDropped: 0, maxPostMajorHeapUsed: 0, lastPostMajor: null }
  const majorKind = perfConstants.NODE_PERFORMANCE_GC_MAJOR
  const gcObserver = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      const kind = entry.detail?.kind ?? entry.kind
      const k = String(kind)
      const slot = gc.byKind[k] ?? (gc.byKind[k] = { count: 0, durationMs: 0 })
      slot.count += 1
      slot.durationMs += entry.duration
      if (kind === majorKind) {
        const heapUsed = process.memoryUsage().heapUsed
        gc.maxPostMajorHeapUsed = Math.max(gc.maxPostMajorHeapUsed, heapUsed)
        gc.lastPostMajor = { atMs: at(), heapUsed }
        if (gc.major.length < protocol.maxMajorGcEntries) gc.major.push({ atMs: entry.startTime - started, durationMs: entry.duration, heapUsedAfter: heapUsed })
        else gc.majorDropped += 1
      }
    }
  })
  gcObserver.observe({ entryTypes: ['gc'] })
  const sample = () => {
    const usage = process.memoryUsage()
    maxima.samples += 1
    maxima.heapUsed = Math.max(maxima.heapUsed, usage.heapUsed)
    maxima.heapTotal = Math.max(maxima.heapTotal, usage.heapTotal)
    maxima.rss = Math.max(maxima.rss, usage.rss)
    series.offer(() => {
      const point = { atMs: at(), heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, external: usage.external, arrayBuffers: usage.arrayBuffers, yields,
        postMajorHeapUsed: gc.lastPostMajor?.heapUsed ?? null, probe: observer?.probe() ?? null }
      appendFileSync(seriesPath, JSON.stringify(point) + '\n')
      return point
    })
  }
  const timer = setInterval(sample, protocol.memorySampleIntervalMs)
  try {
    sample()
    const rawExport = await readFile(exportPath)
    const exportSha256 = sha256(rawExport)
    if (exportSha256 !== d2ga.D2GA_EXPORT_SHA256) throw new Error('Export SHA-256 differs from the registered Export.')
    const input = research.globalResearchInputFromExport(JSON.parse(rawExport.toString('utf8')), d2ga.D2GA_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    const { task, issues } = d2ga.readD2GAFormalTask(JSON.parse((await readFile(taskPath)).toString('utf8')))
    if (task === null) throw new Error(`task: ${issues.join('; ')}`)
    const setupMs = at()
    observer = d2ga.createD2GADiagnosticObserver(engine)
    const result = await d2ga.runD2GADiagnosticUnit(input, unit, task, dependencies, observer, { sha256OfText: text => sha256(text), yieldControl })
    const endUsage = process.memoryUsage()
    sample()
    clearInterval(timer)
    gcObserver.disconnect()
    await write(recordPath, { phase: d2ga.D2GA_PHASE, formal: false, unit, wallMs: at(), setupMs, yields, checkpointsApprox: yields * 50, exportSha256,
      memory: { maxima, endOfSearch: endUsage, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, keepEvery: series.keepEvery(),
        series: series.values().map(({ probe, ...rest }) => ({ ...rest, settledWork: probe?.settledWork ?? null })) },
      gc, rngEngineVersion: engine.version, calculationContext: input.calculationContext, result })
  } finally {
    clearInterval(timer)
    gcObserver.disconnect()
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output')
// `--smoke`: the registered pre-measurement check (D2-G-A §3.4) - the first unit only, in its own run dir, never compared.
const smoke = args.includes('--smoke')
if (!runDir || !outputPath) throw new Error('The parent needs --run-dir and --output.')
if (existsSync(runDir)) throw new Error('The run dir must be new.')
const server = await createLoader()
const d2ga = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2GA.ts')
await server.close()
const protocol = d2ga.D2GA_PROTOCOL
const phaseStarted = performance.now()
const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
if (exportSha256 !== d2ga.D2GA_EXPORT_SHA256) throw new Error(`Export SHA-256 ${exportSha256} is not the registered ${d2ga.D2GA_EXPORT_SHA256}.`)
await mkdir(runDir, { recursive: true })
const tasks = []
for (const unit of protocol.units) {
  const source = d2ga.D2GA_FORMAL_SOURCES[unit.context]
  const path = join(source.runDir, source.task(unit.rung))
  const raw = await readFile(path)
  const { task, issues } = d2ga.readD2GAFormalTask(JSON.parse(raw.toString('utf8')))
  const check = task === null ? issues : d2ga.checkD2GAFormalTask(unit, task)
  tasks.push({ unit, path, sha256: sha256(raw), bytes: raw.length, issues: check })
}
const launch = {
  phase: d2ga.D2GA_PHASE, formal: false, createdAt: new Date().toISOString(), repositoryHead: git('rev-parse', 'HEAD'), baseMain: d2ga.D2GA_BASE_MAIN,
  workingTreeClean: git('status', '--porcelain').length === 0, docSha256: existsSync(d2ga.D2GA_DOC) ? sha256(await readFile(d2ga.D2GA_DOC)) : null,
  smoke, protocol, exportFile: { bytes: rawExport.length, sha256: exportSha256 }, tasks, node: process.version,
  machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model ?? null, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), platform: platform(), release: release(), arch: arch() },
}
await write(join(runDir, 'launch.json'), launch)
console.log(`${launch.createdAt} D2-G-A head=${launch.repositoryHead} clean=${launch.workingTreeClean} doc=${launch.docSha256?.slice(0, 12)}`)
if (tasks.some(t => t.issues.length > 0)) {
  await write(outputPath, { ...launch, status: 'input_invalid', units: [] })
  throw new Error(`Formal task check failed: ${JSON.stringify(tasks.map(t => t.issues))}`)
}

const classify = ({ code, signal, timedOut, stderrTail, recordWritten }) => timedOut ? 'timed_out'
  : /heap out of memory|Allocation failed/i.test(stderrTail) ? 'out_of_memory'
    : code === 0 && recordWritten ? 'completed' : 'failed'
const runChild = (unit, task, budgetMs) => new Promise(done => {
  const recordPath = join(runDir, `${unit.id}.record.json`), seriesPath = join(runDir, `${unit.id}.series.jsonl`)
  const nodeFlags = [`--max-old-space-size=${protocol.childHeapMb}`]
  const began = performance.now(), startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
  let stderrTail = '', timedOut = false
  const child = spawn(process.execPath, [...nodeFlags, SCRIPT_PATH, '--role', 'child', '--unit', unit.id, '--export', exportPath, '--task', task.path, '--record', recordPath, '--series', seriesPath],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  console.log(`${startedAt} START ${unit.id} pid=${child.pid} budget=${(budgetMs / 1000).toFixed(0)}s`)
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, budgetMs)
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8000) })
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    const recordWritten = existsSync(recordPath)
    const outcome = classify({ code, signal, timedOut, stderrTail, recordWritten })
    const wallMs = performance.now() - began
    console.log(`${new Date().toISOString()} END ${unit.id} ${outcome} ${(wallMs / 1000).toFixed(1)}s`)
    done({ unitId: unit.id, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, wallMs, nodeFlags, freeMemoryAtStart, recordFile: recordWritten ? `${unit.id}.record.json` : null,
      stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) })
  })
})

const units = []
for (const task of smoke ? tasks.slice(0, 1) : tasks) {
  const remaining = protocol.totalWallMs - (performance.now() - phaseStarted)
  if (remaining <= 0) { units.push({ unitId: task.unit.id, outcome: 'not_executed', reason: 'total_wall_reached' }); continue }
  const processEntry = await runChild(task.unit, task, Math.min(protocol.childWallMs, remaining))
  const record = processEntry.recordFile ? JSON.parse((await readFile(join(runDir, processEntry.recordFile))).toString('utf8')) : null
  units.push({ ...processEntry, recordSha256: record ? sha256(await readFile(join(runDir, processEntry.recordFile))) : null })
}
await write(outputPath, { ...launch, status: smoke ? 'smoke' : 'completed', totalWallMs: performance.now() - phaseStarted, units })
console.log(JSON.stringify({ output: resolve(outputPath), units: units.map(u => `${u.unitId}:${u.outcome}`) }))
