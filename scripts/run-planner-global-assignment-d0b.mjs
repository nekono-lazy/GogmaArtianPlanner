// Issue #154 Global Assignment Phase D-0B (Research only). The materialization runner over an explicit external Export
// (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md): Phase 0 context -> Phase A ReachTable -> Phase C-2 coverage-gated
// structural candidate search -> the design 19 G1 / G3 / G4 diagnostics -> the Phase D-0A materialization of the first
// structural candidate(s), in a fresh child process per run under a wall-clock and heap envelope (concurrency 1, no retry,
// no fallback). It never imports into the app, never opens IndexedDB, never runs the Production Planner or Trace Replay,
// passes no upper bound to the structural search, reads no oracle manifest / verifier / RESULT and takes no post-hoc
// comparison argument.
//
// Only `--mode smoke` runs (non-formal; every condition is a provisional smoke value recorded with its basis). D-0B
// registers no formal condition (design 19.7): `--mode formal` is refused before the Export is read, and the formal
// conditions are pre-registered in D-0B-2 and measured in D-0C.
//
// Parent:
//   node scripts/run-planner-global-assignment-d0b.mjs --export <Export .json> --run-dir <new dir> --output <new .json>
//     [--mode smoke] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--coverage-driven-ordering true|false]
//     [--structural-candidate-limit N] [--delivery-cap N] [--gate C,G,S,N] [--wall-ms N] [--heap-mb N] [--repeat N]
//     [--expected-export-sha256 <hex>] [--allow-uncommitted]
// Child (`--role materialize`): spawned by the parent with --task, --record and --journal; never run by hand. It appends
// its progress to the journal synchronously, so a run its envelope stops keeps its confirmed progress; the Target in
// progress at that moment is reported without an outcome.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { appendFileSync, existsSync, lstatSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'
import { runChildProcess } from './planner-global-assignment-d0b-child-process.mjs'

const SCRIPT_PATH = 'scripts/run-planner-global-assignment-d0b.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --export <Export .json> --run-dir <new dir> --output <new .json> [--mode smoke] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--coverage-driven-ordering true|false] [--structural-candidate-limit N] [--delivery-cap N] [--gate C,G,S,N] [--wall-ms N] [--heap-mb N] [--repeat N] [--expected-export-sha256 <hex>] [--allow-uncommitted]`
const KNOWN_OPTIONS = new Set(['--export', '--run-dir', '--output', '--mode', '--window', '--node-budget', '--mrv-lookahead', '--coverage-driven-ordering', '--structural-candidate-limit',
  '--delivery-cap', '--gate', '--wall-ms', '--heap-mb', '--repeat', '--expected-export-sha256', '--allow-uncommitted', '--role', '--task', '--record', '--journal'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => name !== '--allow-uncommitted'))
const OVERRIDE_OPTIONS = ['--window', '--node-budget', '--mrv-lookahead', '--coverage-driven-ordering', '--structural-candidate-limit', '--delivery-cap', '--gate', '--wall-ms', '--heap-mb', '--repeat']
/** PlannerInput.options.maxPlanSteps is validated by validatePlannerInput() but no Planner runs here (G12: not a Research maxPlanSteps). */
const PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY = 1_000
const MEMORY_SAMPLE_INTERVAL_MS = 250
const JOURNAL_MEMORY_INTERVAL_MS = 5_000

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (VALUE_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const has = name => args.includes(name)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...values) => execFileSync('git', values, { encoding: 'utf8' }).trim()
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const role = option('--role')
const exportPath = option('--export')
if (!exportPath) throw new Error(USAGE)

// ------------------------------------------------------------------ child
if (role !== undefined) {
  if (role !== 'materialize') throw new Error(`Unknown --role ${role}.`)
  const taskPath = option('--task'), recordPath = option('--record'), journalPath = option('--journal')
  if (!taskPath || !recordPath || !journalPath) throw new Error('A child needs --task, --record and --journal.')
  const started = performance.now()
  const atMs = () => performance.now() - started
  // Synchronous appends: whatever was written survives a SIGKILL from the parent's envelope.
  const journal = line => appendFileSync(journalPath, JSON.stringify({ ...line, atMs: atMs() }) + '\n')
  journal({ kind: 'started', pid: process.pid })
  const maxima = { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, samples: 0 }
  let lastJournalMemory = -Infinity
  const sample = () => {
    const usage = process.memoryUsage()
    maxima.samples += 1
    maxima.heapUsed = Math.max(maxima.heapUsed, usage.heapUsed)
    maxima.heapTotal = Math.max(maxima.heapTotal, usage.heapTotal)
    maxima.rss = Math.max(maxima.rss, usage.rss)
    maxima.external = Math.max(maxima.external, usage.external)
    if (atMs() - lastJournalMemory >= JOURNAL_MEMORY_INTERVAL_MS) {
      lastJournalMemory = atMs()
      journal({ kind: 'memory', heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, external: usage.external })
    }
  }
  sample()
  const timer = setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS)
  const server = await createLoader()
  try {
    const task = JSON.parse(await readFile(taskPath, 'utf8'))
    if (task.mode !== 'smoke') throw new Error(`Phase D-0B runs smoke tasks only (got ${String(task.mode)}).`)
    const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
    if (task.protocolVersion !== protocol.MATERIALIZATION_D0B_PROTOCOL_VERSION) throw new Error(`Task protocol ${String(task.protocolVersion)} is not ${protocol.MATERIALIZATION_D0B_PROTOCOL_VERSION}.`)
    const conditionIssues = protocol.validateMaterializationResearchConditions(task.conditions)
    if (conditionIssues.length > 0) throw new Error(`Invalid task conditions: ${conditionIssues.join(' ')}`)
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
    const raw = await readFile(exportPath)
    const actualExport = { fileName: basename(exportPath), bytes: raw.length, sha256: sha256(raw) }
    if (actualExport.sha256 !== task.actualExport?.sha256 || actualExport.bytes !== task.actualExport?.bytes) throw new Error('The Export differs from the one the parent hashed.')
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), task.plannerInputMaxPlanStepsForValidationOnly)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    const setupMs = performance.now() - started
    let yields = 0
    const result = await runner.runMaterializationSmoke(input, dependencies, { conditions: task.conditions }, {
      now: () => performance.now(),
      yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }),
      onProgress: event => journal({ kind: 'progress', event }),
    })
    clearInterval(timer)
    sample()
    const memory = { maxima, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, endOfRun: process.memoryUsage() }
    await write(recordPath, {
      role, mode: task.mode, protocolVersion: task.protocolVersion,
      exportVerification: { actual: actualExport, taskMatched: true },
      rngEngineVersion: engine.version, calculationContext: input.calculationContext, node: process.version,
      semantic: result.semantic, observed: { ...result.observed, setupMs, wallMs: performance.now() - started, eventLoopYields: yields }, memory,
    })
    journal({ kind: 'finished' })
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------ parent
const runDir = option('--run-dir'), outputPath = option('--output')
if (!runDir || !outputPath) throw new Error(USAGE)
const mode = option('--mode') ?? 'smoke'
if (!['smoke', 'formal'].includes(mode)) throw new Error(`--mode must be smoke (formal is refused in Phase D-0B) (got ${mode}).`)

const server = await createLoader()
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
const runnerModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
await server.close()
// D-0B registers no formal condition: a formal run is refused before anything is read or written.
if (mode === 'formal') throw new Error(`A formal run cannot start: ${protocol.materializationFormalRunIssues().join(' ')}`)
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const expectedExportSha256 = option('--expected-export-sha256')
if (expectedExportSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedExportSha256)) throw new Error('--expected-export-sha256 must be 64 hex characters.')

const positiveIntegerOption = (name, fallback) => {
  const raw = option(name)
  if (raw === undefined) return fallback
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer (got ${raw}).`)
  return Number(raw)
}
const integerList = (name, count, fallback) => {
  const raw = option(name)
  if (raw === undefined) return fallback
  const parts = raw.split(',')
  if (parts.length !== count || parts.some(part => !/^[0-9]+$/.test(part))) throw new Error(`${name} must be ${count} comma-separated integers (got ${raw}).`)
  return parts.map(Number)
}
const defaults = protocol.smokeDefaults()
const windowValues = integerList('--window', 3, null)
const gateValues = integerList('--gate', 4, null)
const orderingRaw = option('--coverage-driven-ordering')
if (orderingRaw !== undefined && !['true', 'false'].includes(orderingRaw)) throw new Error(`--coverage-driven-ordering must be true or false (got ${orderingRaw}).`)
const conditions = {
  window: windowValues === null ? defaults.conditions.window : { normal: windowValues[0], gogma: windowValues[1], skill: windowValues[2] },
  nodeBudget: positiveIntegerOption('--node-budget', defaults.conditions.nodeBudget),
  mrvLookahead: positiveIntegerOption('--mrv-lookahead', defaults.conditions.mrvLookahead),
  coverageDrivenOrdering: orderingRaw === undefined ? defaults.conditions.coverageDrivenOrdering : orderingRaw === 'true',
  structuralCandidateLimit: positiveIntegerOption('--structural-candidate-limit', defaults.conditions.structuralCandidateLimit),
  deliveryCap: positiveIntegerOption('--delivery-cap', defaults.conditions.deliveryCap),
  searchScaleGate: gateValues === null ? defaults.conditions.searchScaleGate
    : { maxConversionPositions: gateValues[0], maxGogmaLegalWidth: gateValues[1], maxSkillLegalWidth: gateValues[2], maxNormalForgeCount: gateValues[3] },
  searchPolicyPrecheck: true,
}
const envelope = {
  childWallMs: positiveIntegerOption('--wall-ms', defaults.envelope.childWallMs),
  childHeapMb: positiveIntegerOption('--heap-mb', defaults.envelope.childHeapMb),
  repeat: positiveIntegerOption('--repeat', defaults.envelope.repeat),
}
const conditionIssues = [...protocol.validateMaterializationResearchConditions(conditions), ...protocol.validateMaterializationEnvelope(envelope)]
if (conditionIssues.length > 0) throw new Error(`Invalid conditions: ${conditionIssues.join(' ')}`)
const smokeOverrides = OVERRIDE_OPTIONS.filter(has)
const basisOf = (name, key) => has(name) ? `non-formal smoke value from ${name}` : `non-formal smoke runner default: ${protocol.MATERIALIZATION_D0B_SMOKE_DEFAULTS[key].basis}`
const conditionBasis = {
  window: basisOf('--window', 'window'), nodeBudget: basisOf('--node-budget', 'nodeBudget'), mrvLookahead: basisOf('--mrv-lookahead', 'mrvLookahead'),
  coverageDrivenOrdering: basisOf('--coverage-driven-ordering', 'coverageDrivenOrdering'), structuralCandidateLimit: basisOf('--structural-candidate-limit', 'structuralCandidateLimit'),
  deliveryCap: basisOf('--delivery-cap', 'deliveryCap'), searchScaleGate: basisOf('--gate', 'searchScaleGate'),
  searchPolicyPrecheck: 'Phase D-0B fixed rule (design 19.3 G1): a Search-policy shape is classified not_executed(search_policy_shape) before any Search.',
  childWallMs: basisOf('--wall-ms', 'childWallMs'), childHeapMb: basisOf('--heap-mb', 'childHeapMb'), repeat: basisOf('--repeat', 'repeat'),
}

const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const repositoryHeadSha = git('rev-parse', 'HEAD')
const workingTreeClean = git('status', '--porcelain').length === 0
const uncommittedBenchmarkCode = Boolean(git('diff', 'HEAD', '--', ...CODE_PATHS) || git('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS))
if (uncommittedBenchmarkCode && !has('--allow-uncommitted')) throw new Error('Commit the benchmark code before a run, or pass --allow-uncommitted for a non-formal smoke.')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')

const rawExport = await readFile(exportPath)
const actualExport = { fileName: basename(exportPath), bytes: rawExport.length, sha256: sha256(rawExport) }
const cliMatched = expectedExportSha256 === undefined ? null : actualExport.sha256 === expectedExportSha256.toLowerCase()
if (cliMatched === false) throw new Error(`Export SHA-256 ${actualExport.sha256} is not the expected ${expectedExportSha256}.`)

const docPath = protocol.MATERIALIZATION_D0B_DOC
const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const provenance = {
  protocolVersion: protocol.MATERIALIZATION_D0B_PROTOCOL_VERSION, phase: protocol.MATERIALIZATION_D0B_PHASE, mode, formal: false,
  nature: 'Research: non-formal D-0B smoke; not a Production Plan, not Planner-verified, no Trace Replay',
  oracleFreeExecution: true, oracleInformedDesign: true,
  repositoryHeadSha, baseMain: protocol.MATERIALIZATION_D0B_BASE_MAIN, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
  researchDoc: existsSync(docPath) ? { file: docPath, sha256: sha256(await readFile(docPath)) } : { file: docPath, sha256: null },
  runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
  exportVerification: { actual: actualExport, cliExpectedSha256: expectedExportSha256?.toLowerCase() ?? null, cliMatched },
  plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
  conditions, envelope: { ...envelope, concurrency: 1, retry: 'none' }, conditionBasis, smokeOverrides,
  formalRegistration: { formalRunEnabled: false, deferredItems: [...protocol.MATERIALIZATION_D0B2_REGISTRATION_ITEMS], deferredTo: 'D-0B-2 (pre-registration), D-0C (formal measurement)' },
  launchedAt, machine,
}

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, 'start.json')
await write(startPath, provenance)
await chmod(startPath, 0o444).catch(() => {})
console.log(`${launchedAt} START mode=${mode} head=${repositoryHeadSha.slice(0, 12)} clean=${workingTreeClean} uncommittedCode=${uncommittedBenchmarkCode} export=${actualExport.sha256.slice(0, 8)} window=${conditions.window.normal}/${conditions.window.gogma}/${conditions.window.skill} nodeBudget=${conditions.nodeBudget} candidates=${conditions.structuralCandidateLimit} deliveryCap=${conditions.deliveryCap} gate=${Object.values(conditions.searchScaleGate).join(',')}`)

// A parent interrupt kills the running child and records it as cancelled (never as a materialization outcome).
const abort = new AbortController()
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { console.log(`${new Date().toISOString()} ${name}: cancelling the running child`); abort.abort() })

const runChild = async id => {
  const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`), journalPath = join(runDir, `${id}.journal.jsonl`)
  const startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
  const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
  const base = { id, wallMs: envelope.childWallMs, heapMb: envelope.childHeapMb, startedAt, nodeFlags, freeMemoryAtStart, taskFile: basename(taskPath), journalFile: basename(journalPath) }
  const task = { protocolVersion: protocol.MATERIALIZATION_D0B_PROTOCOL_VERSION, mode, repositoryHeadSha, actualExport, conditions, envelope, plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY }
  try {
    await writeFile(taskPath, JSON.stringify(task, null, 2) + '\n', { flag: 'wx' })
  } catch (error) {
    return { ...base, outcome: 'process_failure', exitCode: null, signal: null, timedOut: false, cancelled: false, spawnError: `task write failed: ${error?.message ?? String(error)}`, settledBy: 'task_write', wallObservedMs: 0, pid: null, recordWritten: false, recordFile: null, stderrTail: null }
  }
  const result = await runChildProcess({
    spawnProcess: spawn, execPath: process.execPath, args: [...nodeFlags, SCRIPT_PATH, '--role', 'materialize', '--export', exportPath, '--task', taskPath, '--record', recordPath, '--journal', journalPath],
    wallMs: envelope.childWallMs, recordWritten: () => existsSync(recordPath), signal: abort.signal,
    onStart: child => console.log(`${startedAt} CHILD ${id} pid=${child.pid ?? 'n/a'} wall=${envelope.childWallMs}ms heap=${envelope.childHeapMb}MB`),
  })
  console.log(`${new Date().toISOString()} END ${id} ${result.outcome} ${(result.wallObservedMs / 1000).toFixed(1)}s${result.spawnError ? ` (${result.spawnError})` : ''}`)
  return { ...base, ...result, recordFile: result.recordWritten ? basename(recordPath) : null }
}
const readJournal = async entry => {
  try {
    return protocol.parseProgressJournal(await readFile(join(runDir, entry.journalFile), 'utf8'))
  } catch (error) {
    return { unreadable: `journal unreadable: ${error?.message ?? String(error)}` }
  }
}

const phaseStarted = performance.now()
const processes = []
const runs = []
const integrityIssues = []
for (let run = 1; run <= envelope.repeat && !abort.signal.aborted; run += 1) {
  const entry = await runChild(`materialize-${run}`)
  processes.push(entry)
  let record = null, recordError = null
  if (entry.recordFile) {
    try {
      record = JSON.parse(await readFile(join(runDir, entry.recordFile), 'utf8'))
    } catch (error) {
      recordError = `record unreadable: ${error?.message ?? String(error)}`
    }
  }
  const journal = await readJournal(entry)
  if (entry.outcome === 'completed' && record) {
    const consistent = record.mode === mode && record.protocolVersion === protocol.MATERIALIZATION_D0B_PROTOCOL_VERSION && record.exportVerification?.actual?.sha256 === actualExport.sha256
    if (!consistent) integrityIssues.push(`${entry.id}: the child record disagrees with the parent (mode / protocol / Export)`)
    for (const issue of record.semantic.integrityIssues) integrityIssues.push(`${entry.id}: ${issue}`)
    runs.push({ id: entry.id, status: 'measured', reason: null, recordFile: entry.recordFile, recordConsistent: consistent, semanticSha256: sha256(JSON.stringify(record.semantic)),
      rngEngineVersion: record.rngEngineVersion, calculationContext: record.calculationContext,
      summary: runnerModule.summarizeMaterializationRun(record.semantic), observed: record.observed, memory: { maxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB, heapSizeLimit: record.memory.heapSizeLimit } })
  } else {
    // Not completed: unmeasured with the reason the envelope observed, and only what the journal confirmed (never the result of the Target in progress).
    const reason = entry.outcome === 'completed' ? 'process_failure' : entry.outcome
    runs.push({ id: entry.id, status: 'unmeasured', reason, detail: recordError ?? entry.spawnError ?? `child ${entry.outcome} (exit ${entry.exitCode}, signal ${entry.signal})`,
      recordFile: entry.recordFile, recordConsistent: null, semanticSha256: null, confirmedProgress: journal })
  }
}

const measured = runs.filter(run => run.status === 'measured')
const determinism = { runs: runs.length, measuredRuns: measured.length, identical: measured.length >= 2 ? new Set(measured.map(run => run.semanticSha256)).size === 1 : null, semanticSha256s: measured.map(run => run.semanticSha256) }
if (determinism.identical === false) integrityIssues.push('semantic records of the repeated runs differ')
const output = {
  ...provenance, runDir: resolve(runDir), status: mode,
  runs, determinism, processes, integrityIssues, totalWallMs: performance.now() - phaseStarted,
  claims: 'none: no verified / best_found / proven_minimum, and all_materialized is not a Plan (Phase D\' is not run)',
}
await write(outputPath, output)
console.log(JSON.stringify({ output: resolve(outputPath), mode, runs: runs.map(run => `${run.id}:${run.status}:${run.status === 'measured' ? run.summary.outcome.kind : run.reason}`),
  classifications: measured[0]?.summary.candidates.map(candidate => `${candidate.classification}:${candidate.materializedTargetCount}/${candidate.targetCount}`) ?? [], determinism: determinism.identical, integrityIssues }))
// A run its envelope stopped is reported as unmeasured with exit code 2; an integrity issue with exit code 1.
if (integrityIssues.length > 0) process.exitCode = 1
else if (runs.some(run => run.status === 'unmeasured')) process.exitCode = 2
