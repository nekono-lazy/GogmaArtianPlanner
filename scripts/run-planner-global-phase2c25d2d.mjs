// Issue #154 Phase 2-C2.5-D2-d Research only: the Node memory / runtime effect of the single-pass held-aware Bonus
// stream (H1: no past-depth raw solution retention).
//
// Parent only. Every child is the UNCHANGED D2-a child role of scripts/run-planner-global-phase2c25d2a.mjs, so the
// Search-only conditions are exactly D2-a's:
//   0. reads the committed D2-a RESULT (explicit --d2a) for the workload and the "before" values, the D2-c RESULT
//      (explicit --d2c) for the workload equality check and the profiled reference, and the C2.5-A evidence (explicit
//      --c25a) for the C2.5-C control rule and the pre-search context parity. The Export must be the one they measured;
//   1. `contexts` child: this run's own baseline and pre-search contexts; the parent checks each against the C2.5-A
//      evidence field by field and against the workload digest, and stops before any Search on a mismatch;
//   2. `search` children, one fresh process per (context, mode), concurrency 1, heap limit 8192 MB, run budget 20 min:
//      `minimal` then `instrumented`, consumer stop at 1 Candidate.
// A child failure (timeout, out of memory, any other failure) is recorded as that failure, never as "no Candidate".
// Memory values are sampled maxima of process.memoryUsage(), never a true peak.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const exportPath = option('--export'), c25aPath = option('--c25a'), d2aPath = option('--d2a'), d2cPath = option('--d2c'), runDir = option('--run-dir'), outputPath = option('--output')
if (!exportPath || !c25aPath || !d2aPath || !d2cPath || !runDir || !outputPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c25d2d.mjs --export <external.json> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --d2c docs/PLANNER_GLOBAL_PHASE2C25D2C_RESULT.json --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --only <orientationId#workIndex,...> --modes minimal,instrumented --run-budget-ms N]')
}
const CHILD_SCRIPT = 'scripts/run-planner-global-phase2c25d2a.mjs'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha256 = value => createHash('sha256').update(value).digest('hex')

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
const rawExport = await readFile(exportPath), rawC25A = await readFile(c25aPath), rawD2A = await readFile(d2aPath), rawD2C = await readFile(d2cPath)
const exportSha256 = sha256(rawExport)
await mkdir(runDir, { recursive: true })
const processes = []
const phaseStarted = performance.now()

// The loader stays open until the end (the parent calls the loaded helpers throughout); it runs no Search.
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
const d2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2D.ts')
const d2c = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2C.ts')
const c25c = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25C.ts')
const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts')
const c2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2.ts')

const c25aJson = JSON.parse(rawC25A.toString('utf8')), d2aJson = JSON.parse(rawD2A.toString('utf8')), d2cJson = JSON.parse(rawD2C.toString('utf8'))
const c25aView = c25c.parsePhase2C25CEvidence(c25aJson)
const d2aView = d2c.parsePhase2C25D2CD2AResult(d2aJson)
if (c25aView.exportSha256 !== exportSha256 || d2aView.exportSha256 !== exportSha256) throw new Error('The C2.5-A evidence or the D2-a RESULT was measured on another Export.')
if (d2aView.c25aEvidenceSha256 !== sha256(rawC25A)) throw new Error('The D2-a RESULT selected its workload from another C2.5-A evidence file.')
if (d2cJson.provenance?.d2aResultSha256 !== sha256(rawD2A) || d2cJson.provenance?.exportSha256 !== exportSha256) throw new Error('The D2-c RESULT was built on another D2-a RESULT or Export.')
const workload = d2c.selectPhase2C25D2CWorkload(d2aView, c25c.selectPhase2C25CWorkload(c25aView))
d2d.assertPhase2C25D2DWorkloadMatchesD2C(workload, d2d.parsePhase2C25D2DD2CResult(d2cJson).items)
const selected = d2d.phase2c25d2dWorkloadItems(workload).filter(item => only === null || only.includes(`${item.orientationId}#${item.workIndex}`))
// Fail closed on the "before" views before any child.
d2d.parsePhase2C25D2DD2ABefore(d2aJson, selected)
const modes = modesOption ?? [...d2d.PHASE2C25D2D_MODES]
const runBudgetMs = budgetOverride ?? d2d.PHASE2C25D2D_RUN_BUDGET_MS
const childHeapMb = d2d.PHASE2C25D2D_CHILD_HEAP_MB
console.log(`selected ${selected.length}: ${selected.map(s => `${s.orientationId}#${s.workIndex}(${s.role})`).join(' ')}`)

/** One fresh child of the D2-a child script. Resolves with its messages and a classified outcome; never throws for a child failure. */
function runChild(id, childRole, task, { ipc }) {
  return new Promise(done => {
    const taskPath = join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const messagesPath = join(runDir, `${id}.messages.jsonl`)
    const start = async () => {
      await write(taskPath, task)
      const heapArgs = [`--max-old-space-size=${childHeapMb}`]
      const childArgs = [...heapArgs, CHILD_SCRIPT, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath]
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

// 1. Contexts from this run's own baseline, then parity with the C2.5-A evidence and the workload digest before any Search.
const orientationIds = [...new Set(selected.map(item => item.orientationId))]
const contextsRun = await runChild('contexts', 'contexts', { orientationIds }, { ipc: false })
if (!contextsRun.record) throw new Error('The contexts child failed; nothing else is meaningful.')
const { contexts, orientations } = contextsRun.record
const parity = selected.map(item => {
  const derived = contexts[item.orientationId].find(context => context.workIndex === item.workIndex)
  if (!derived) return { orientationId: item.orientationId, workIndex: item.workIndex, matches: false, fields: [{ field: 'derived', matches: false }] }
  const row = c25c.comparePhase2C25CContextParity(derived, c25aView.preSearchContexts.get(c25c.phase2c25cContextKey(item.orientationId, item.workIndex)), sha256)
  return { ...row, workloadDigest: item.contextDigest, derivedDigest: derived.contextDigest, digestMatches: derived.contextDigest === item.contextDigest }
})
const parityMatches = parity.every(row => row.matches && row.digestMatches)
console.log(`context parity ${parity.filter(r => r.matches && r.digestMatches).length}/${parity.length}`)

const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per Search run, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
  platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  childHeapLimitMb: childHeapMb, jit: 'jit_default (no V8 flag other than --max-old-space-size)', concurrency: d2d.PHASE2C25D2D_CONCURRENCY, childScript: CHILD_SCRIPT,
  repositoryHead: git('rev-parse', 'HEAD'), uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
  exportFileName: basename(exportPath), exportSha256, exportBytes: rawExport.length,
  c25aEvidenceFileName: basename(c25aPath), c25aEvidenceSha256: sha256(rawC25A), d2aResultFileName: basename(d2aPath), d2aResultSha256: sha256(rawD2A), d2aMeasuredHead: d2aView.measuredHead,
  d2cResultFileName: basename(d2cPath), d2cResultSha256: sha256(rawD2C), d2cMeasuredHead: d2cJson.provenance.measuredHead,
  calculationContext: contextsRun.record.calculationContext, researchMaxPlanSteps: contextsRun.record.researchMaxPlanSteps, nodeYield: 'setImmediate',
  searchExtent: contexts[orientationIds[0]]?.[0]?.extent ?? null, candidateStopBound: d2d.PHASE2C25D2D_CANDIDATE_STOP_BOUND,
  snapshotPolicy: { ...d2d.PHASE2C25D2D_SNAPSHOT_POLICY }, minimalMemoryHeartbeatMs: d2d.PHASE2C25D2D_MINIMAL_MEMORY_HEARTBEAT_MS, runBudgetMs, modes,
  smoke: only === null && modesOption === null && budgetOverride === null ? null : { only, modes: modesOption, runBudgetMs: budgetOverride } }
const base = { phase: 'Issue #154 Phase 2-C2.5-D2-d: Node memory / runtime effect of the single-pass held-aware Bonus stream (Node Research run, raw)',
  measuredAt: new Date().toISOString(), environment, workload, selected, parity,
  contexts: Object.fromEntries(Object.entries(contexts).map(([id, list]) => [id, list.map(({ searchReservation: _raw, ...rest }) => rest)])) }
if (!parityMatches) {
  await write(outputPath, { ...base, status: 'parity_failed_no_search_run', processes, wallMs: performance.now() - phaseStarted })
  await server.close()
  throw new Error('Pre-search context parity failed: no Search was run.')
}

// 2. Search-only runs: every selected context, minimal then instrumented, one fresh 8 GB child at a time.
const runs = []
for (const item of selected) {
  const run = { item, modes: {} }
  for (const mode of modes) {
    const id = `search-${item.orientationId}-w${item.workIndex}-${mode}`
    const child = await runChild(id, 'search', { orientation: orientations[item.orientationId], workIndex: item.workIndex, targetWeaponId: item.targetWeaponId,
      contextDigest: item.contextDigest, mode, snapshotPolicy: { ...d2d.PHASE2C25D2D_SNAPSHOT_POLICY } }, { ipc: true })
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
await server.close()
