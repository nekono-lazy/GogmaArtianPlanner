// Issue #154 Global Assignment Phase B-2A (Research only). The assignment-only runner over an explicit external
// Export (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md): Phase 0 context -> Phase A ReachTable -> Phase B-1 resource
// assignment search in a fresh child process per run, and the design 10.2 root lower bound as its own child, each
// under a wall-clock and heap envelope (concurrency 1, no retry, no fallback). It never imports into the app, never
// opens IndexedDB, never runs the Production Planner / Planner Alternative Search / Trace Replay, passes no upper
// bound to the solver, reads no oracle manifest / verifier / RESULT and takes no post-hoc comparison argument.
//
// Phase B-2A runs non-formal smokes only (`--mode smoke`). A formal run (`--mode formal`) is refused until the Phase
// B-2B pre-registration in src/benchmarks/globalAssignment/assignmentProtocol.ts is complete and enabled, and it then
// takes every condition from that registration (no command-line override, committed code only).
//
// Parent:
//   node scripts/run-planner-global-assignment-b2a.mjs --export <Export .json> --run-dir <new dir> --output <new .json>
//     [--mode smoke] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--candidate-limit N] [--snapshot-limit N]
//     [--repeat N] [--assignment-wall-ms N] [--assignment-heap-mb N] [--root-bound-budget N] [--root-bound-wall-ms N]
//     [--root-bound-heap-mb N] [--no-replay] [--expected-export-sha256 <hex>] [--allow-uncommitted]
// Child (`--role assignment|root-bound`): spawned by the parent with --task and --record; never run by hand.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/run-planner-global-assignment-b2a.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --export <Export .json> --run-dir <new dir> --output <new .json> [--mode smoke] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--candidate-limit N] [--snapshot-limit N] [--repeat N] [--assignment-wall-ms N] [--assignment-heap-mb N] [--root-bound-budget N] [--root-bound-wall-ms N] [--root-bound-heap-mb N] [--no-replay] [--expected-export-sha256 <hex>] [--allow-uncommitted]`
const KNOWN_OPTIONS = new Set(['--export', '--run-dir', '--output', '--mode', '--window', '--node-budget', '--mrv-lookahead', '--candidate-limit', '--snapshot-limit', '--repeat',
  '--assignment-wall-ms', '--assignment-heap-mb', '--root-bound-budget', '--root-bound-wall-ms', '--root-bound-heap-mb', '--no-replay', '--expected-export-sha256', '--allow-uncommitted',
  '--role', '--task', '--record'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => !['--no-replay', '--allow-uncommitted'].includes(name)))
// Non-formal smoke defaults (runner defaults, not registered conditions): small budgets, two runs for the determinism check.
const SMOKE_DEFAULTS = Object.freeze({ nodeBudget: 1_000, mrvLookahead: 8, candidateLimit: 10, snapshotLimit: 3, repeat: 2, assignmentWallMs: 20 * 60_000, assignmentHeapMb: 4_096,
  rootBoundWallMs: 30 * 60_000, rootBoundHeapMb: 4_096 })
/** PlannerInput.options.maxPlanSteps is validated by validatePlannerInput() but no Planner runs here (G12: not a Research maxPlanSteps). */
const PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY = 1_000
const MEMORY_SAMPLE_INTERVAL_MS = 250
const MEMORY_SERIES_LIMIT = 600

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (VALUE_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const has = name => args.includes(name)
const integerOption = (name, fallback, minimum = 1) => {
  const raw = option(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum} (got ${raw}).`)
  return value
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...values) => execFileSync('git', values, { encoding: 'utf8' }).trim()
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const role = option('--role')
const exportPath = option('--export')
if (!exportPath) throw new Error(USAGE)

// ------------------------------------------------------------------ memory sampler (child)
function startMemorySampler() {
  const maxima = { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, samples: 0 }
  const series = []
  let keepEvery = 1
  let offered = 0
  const started = performance.now()
  const sample = () => {
    const usage = process.memoryUsage()
    maxima.samples += 1
    maxima.heapUsed = Math.max(maxima.heapUsed, usage.heapUsed)
    maxima.heapTotal = Math.max(maxima.heapTotal, usage.heapTotal)
    maxima.rss = Math.max(maxima.rss, usage.rss)
    maxima.external = Math.max(maxima.external, usage.external)
    offered += 1
    if ((offered - 1) % keepEvery !== 0) return
    series.push({ atMs: performance.now() - started, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss })
    if (series.length >= MEMORY_SERIES_LIMIT) {
      keepEvery *= 2
      for (let index = series.length - 1; index >= 0; index -= 1) if (index % 2 === 1) series.splice(index, 1)
    }
  }
  sample()
  const timer = setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS)
  return {
    stop() {
      clearInterval(timer)
      sample()
      return { maxima, keepEvery, series, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, endOfRun: process.memoryUsage() }
    },
  }
}

// ------------------------------------------------------------------ child
if (role !== undefined) {
  if (!['assignment', 'root-bound'].includes(role)) throw new Error(`Unknown --role ${role}.`)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!taskPath || !recordPath) throw new Error('A child needs --task and --record.')
  const started = performance.now()
  const sampler = startMemorySampler()
  const server = await createLoader()
  try {
    const task = JSON.parse(await readFile(taskPath, 'utf8'))
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const raw = await readFile(exportPath)
    const exportSha256 = sha256(raw)
    if (exportSha256 !== task.exportSha256) throw new Error('The Export changed since the parent hashed it.')
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), task.plannerInputMaxPlanStepsForValidationOnly)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    const setupMs = performance.now() - started
    const common = { role, protocolVersion: task.protocolVersion, formal: false, exportSha256, rngEngineVersion: engine.version, calculationContext: input.calculationContext, node: process.version }
    if (role === 'assignment') {
      const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentRunner.ts')
      let yields = 0
      const result = await runner.runAssignmentOnly(input, dependencies,
        { conditions: task.conditions, windowLadder: task.windowLadder, rungIndex: task.rungIndex, replaySnapshots: task.replaySnapshots },
        { now: () => performance.now(), yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
      const memory = sampler.stop()
      await write(recordPath, { ...common, semantic: result.semantic, observed: { ...result.observed, setupMs, wallMs: performance.now() - started, eventLoopYields: yields }, memory })
    } else {
      const rootBound = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentRootBound.ts')
      const contextModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/context.ts')
      const { loadMasterData } = await server.ssrLoadModule('/src/domain/master/loadMasterData.ts')
      const master = loadMasterData()
      if (!master.ok) throw new Error('Master Data failed validation.')
      // Skill states for the cross satisfaction audit: every Master Series / Group Skill ID (disabled ones included), as Phase 2-A.5 did.
      const skills = { seriesSkillIds: master.data.seriesSkills.map(skill => skill.id), groupSkillIds: master.data.groupSkills.map(skill => skill.id) }
      const contextResult = contextModule.createGlobalAssignmentContext(input, dependencies)
      const report = contextResult.kind === 'context'
        ? rootBound.measureRootLowerBound(contextResult.context, engine, task.budget, skills, { now: () => performance.now(), recordAbove: 30 })
        : { status: 'not_applicable', reason: 'unsupported_input', detail: `${contextResult.reason}: ${contextResult.detail}`, budget: task.budget, targetSet: null, crossSatisfaction: null, elapsedMs: 0 }
      const memory = sampler.stop()
      await write(recordPath, { ...common, budget: task.budget, masterSkillIds: { series: skills.seriesSkillIds.length, group: skills.groupSkillIds.length }, report,
        observed: { setupMs, wallMs: performance.now() - started }, memory })
    }
  } finally {
    await server.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------ parent
const runDir = option('--run-dir'), outputPath = option('--output')
if (!runDir || !outputPath) throw new Error(USAGE)
const mode = option('--mode') ?? 'smoke'
if (!['smoke', 'formal'].includes(mode)) throw new Error(`--mode must be smoke or formal (got ${mode}).`)
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = has('--allow-uncommitted')
const overrideOptions = ['--window', '--node-budget', '--mrv-lookahead', '--candidate-limit', '--snapshot-limit', '--repeat', '--assignment-wall-ms', '--assignment-heap-mb',
  '--root-bound-budget', '--root-bound-wall-ms', '--root-bound-heap-mb', '--no-replay'].filter(has)
const expectedExportSha256 = option('--expected-export-sha256')
if (expectedExportSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedExportSha256)) throw new Error('--expected-export-sha256 must be 64 hex characters.')

const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const repositoryHeadSha = git('rev-parse', 'HEAD')
const workingTreeClean = git('status', '--porcelain').length === 0
const uncommittedBenchmarkCode = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...codePaths).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')

const server = await createLoader()
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentProtocol.ts')
const { reachWindowW0 } = await server.ssrLoadModule('/src/benchmarks/globalAssignment/reachTable.ts')
const policy = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentWindowPolicy.ts')
const rootBoundModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentRootBound.ts')
await server.close()
const registration = protocol.ASSIGNMENT_B2B_PREREGISTRATION
const registrationIssues = protocol.assignmentB2bRegistrationIssues()

if (mode === 'formal') {
  // Phase B-2A never starts a formal run: the registration must be complete and enabled, the code committed, and nothing overridden.
  if (!registration.formalRun.enabled) throw new Error(`A formal run is not enabled in this protocol version (enabled by ${registration.formalRun.enabledBy}).`)
  if (registrationIssues.length > 0) throw new Error(`The Phase B-2B pre-registration is incomplete: ${registrationIssues.join(' ')}`)
  if (allowUncommitted || uncommittedBenchmarkCode || !workingTreeClean) throw new Error('A formal run needs a clean, committed Working Tree.')
  if (overrideOptions.length > 0) throw new Error(`A formal run takes its conditions from the registration only; remove ${overrideOptions.join(', ')}.`)
} else if (uncommittedBenchmarkCode && !allowUncommitted) {
  throw new Error('Commit the benchmark code before a run, or pass --allow-uncommitted for a non-formal smoke.')
}

const parseWindow = raw => {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 3 || parts.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error(`--window must be three positive integers N,G,S (got ${raw}).`)
  return { normal: parts[0], gogma: parts[1], skill: parts[2] }
}
const fromRegistration = (condition, name) => { if (condition.value === null) throw new Error(`${name} is not registered.`); return condition.value }
const conditions = mode === 'formal'
  ? { window: fromRegistration(registration.windowLadder, 'windowLadder')[0], nodeBudget: fromRegistration(registration.nodeBudget, 'nodeBudget'), mrvLookahead: fromRegistration(registration.mrvLookahead, 'mrvLookahead'),
    candidateLimit: fromRegistration(registration.candidateLimit, 'candidateLimit'), snapshotLimit: fromRegistration(registration.snapshotLimit, 'snapshotLimit') }
  : { window: option('--window') === undefined ? reachWindowW0() : parseWindow(option('--window')), nodeBudget: integerOption('--node-budget', SMOKE_DEFAULTS.nodeBudget),
    mrvLookahead: integerOption('--mrv-lookahead', SMOKE_DEFAULTS.mrvLookahead), candidateLimit: integerOption('--candidate-limit', SMOKE_DEFAULTS.candidateLimit),
    snapshotLimit: integerOption('--snapshot-limit', SMOKE_DEFAULTS.snapshotLimit, 0) }
const windowLadder = mode === 'formal' ? fromRegistration(registration.windowLadder, 'windowLadder') : [conditions.window]
const rungIndex = 0
const conditionIssues = [...protocol.validateAssignmentResearchConditions(conditions), ...protocol.validateWindowLadder(windowLadder)]
if (conditionIssues.length > 0) throw new Error(`Invalid conditions: ${conditionIssues.join(' ')}`)
const envelope = mode === 'formal'
  ? { assignmentWallMs: fromRegistration(registration.assignmentChild.wallMs, 'assignmentChild.wallMs'), assignmentHeapMb: fromRegistration(registration.assignmentChild.heapMb, 'assignmentChild.heapMb'),
    rootBoundBudget: fromRegistration(registration.rootLowerBound.budget, 'rootLowerBound.budget'), rootBoundWallMs: fromRegistration(registration.rootLowerBound.childWallMs, 'rootLowerBound.childWallMs'),
    rootBoundHeapMb: fromRegistration(registration.rootLowerBound.childHeapMb, 'rootLowerBound.childHeapMb'), repeat: registration.reproducibilityRuns, replaySnapshots: true }
  : { assignmentWallMs: integerOption('--assignment-wall-ms', SMOKE_DEFAULTS.assignmentWallMs), assignmentHeapMb: integerOption('--assignment-heap-mb', SMOKE_DEFAULTS.assignmentHeapMb),
    rootBoundBudget: integerOption('--root-bound-budget', null), rootBoundWallMs: integerOption('--root-bound-wall-ms', SMOKE_DEFAULTS.rootBoundWallMs),
    rootBoundHeapMb: integerOption('--root-bound-heap-mb', SMOKE_DEFAULTS.rootBoundHeapMb), repeat: integerOption('--repeat', SMOKE_DEFAULTS.repeat, 0), replaySnapshots: !has('--no-replay') }
// `--repeat 0` (smoke only): no assignment child, e.g. to time the root lower bound stage on its own.
if (mode === 'smoke' && envelope.repeat === 0 && envelope.rootBoundBudget === null) throw new Error('--repeat 0 needs --root-bound-budget (nothing would run).')
const basis = name => mode === 'formal' ? 'registered condition (ASSIGNMENT_B2B_PREREGISTRATION)' : has(name) ? `non-formal smoke value from ${name}` : 'non-formal smoke runner default'
const conditionBasis = {
  window: mode === 'formal' ? basis() : has('--window') ? basis('--window') : 'W0 = recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1; non-oracle origin)',
  nodeBudget: basis('--node-budget'), mrvLookahead: basis('--mrv-lookahead'), candidateLimit: basis('--candidate-limit'), snapshotLimit: basis('--snapshot-limit'),
  rootBoundBudget: envelope.rootBoundBudget === null ? 'not requested' : basis('--root-bound-budget'),
  envelope: mode === 'formal' ? basis() : 'non-formal smoke values (command line or runner default); not registered conditions',
}

const rawExport = await readFile(exportPath)
const exportSha256 = sha256(rawExport)
if (expectedExportSha256 !== undefined && exportSha256 !== expectedExportSha256.toLowerCase()) throw new Error(`Export SHA-256 ${exportSha256} is not the expected ${expectedExportSha256}.`)
const docPath = protocol.ASSIGNMENT_B2A_DOC
const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const provenance = {
  protocolVersion: protocol.ASSIGNMENT_B2A_PROTOCOL_VERSION, phase: protocol.ASSIGNMENT_B2A_PHASE, mode, formal: false,
  oracleFreeExecution: true, oracleInformedDesign: true,
  repositoryHeadSha, baseMain: protocol.ASSIGNMENT_B2A_BASE_MAIN, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
  researchDoc: existsSync(docPath) ? { file: docPath, sha256: sha256(await readFile(docPath)) } : { file: docPath, sha256: null },
  runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
  export: { fileName: basename(exportPath), bytes: rawExport.length, sha256: exportSha256, expectedSha256Matched: expectedExportSha256 === undefined ? null : true },
  plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
  conditions, windowLadder, rungIndex, envelope: { ...envelope, concurrency: 1, retry: 'none' }, conditionBasis,
  registration: { formalRunEnabled: registration.formalRun.enabled, unresolvedItems: registrationIssues },
  smokeOverrides: overrideOptions, launchedAt, machine,
}

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, 'start.json')
await write(startPath, provenance)
await chmod(startPath, 0o444).catch(() => {})
console.log(`${launchedAt} START mode=${mode} head=${repositoryHeadSha.slice(0, 12)} clean=${workingTreeClean} uncommittedCode=${uncommittedBenchmarkCode} export=${exportSha256.slice(0, 8)} window=${conditions.window.normal}/${conditions.window.gogma}/${conditions.window.skill} nodeBudget=${conditions.nodeBudget} candidateLimit=${conditions.candidateLimit}`)

const classify = ({ code, timedOut, stderrTail, recordWritten }) => timedOut ? 'timed_out'
  : /heap out of memory|Allocation failed|FATAL ERROR/i.test(stderrTail) ? 'out_of_memory'
    : code === 0 && recordWritten ? 'completed' : 'failed'
const unmeasuredReason = outcome => outcome === 'timed_out' ? 'timeout' : outcome === 'out_of_memory' ? 'out_of_memory' : 'process_failure'
const runChild = (id, childRole, task, wallMs, heapMb) => new Promise(done => {
  const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`)
  writeFile(taskPath, JSON.stringify(task, null, 2) + '\n', { flag: 'wx' }).then(() => {
    const began = performance.now(), startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
    const nodeFlags = [`--max-old-space-size=${heapMb}`]
    let stderrTail = '', timedOut = false
    const child = spawn(process.execPath, [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    console.log(`${startedAt} CHILD ${id} pid=${child.pid} wall=${wallMs}ms heap=${heapMb}MB`)
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, wallMs)
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8000) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      const recordWritten = existsSync(recordPath)
      const outcome = classify({ code, timedOut, stderrTail, recordWritten })
      const wallObservedMs = performance.now() - began
      console.log(`${new Date().toISOString()} END ${id} ${outcome} ${(wallObservedMs / 1000).toFixed(1)}s`)
      done({ id, role: childRole, outcome, exitCode: code, signal, timedOut, wallMs, heapMb, startedAt, wallObservedMs, nodeFlags, freeMemoryAtStart,
        taskFile: basename(taskPath), recordFile: recordWritten ? basename(recordPath) : null, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) })
    })
  }, error => done({ id, role: childRole, outcome: 'failed', exitCode: null, signal: null, timedOut: false, wallMs, heapMb, startedAt: null, wallObservedMs: 0, nodeFlags: [], freeMemoryAtStart: null, taskFile: null, recordFile: null, stderrTail: String(error) }))
})
const readRecord = async process => process.recordFile ? JSON.parse(await readFile(join(runDir, process.recordFile), 'utf8')) : null

const phaseStarted = performance.now()
const processes = []
const assignmentRuns = []
const baseTask = { protocolVersion: protocol.ASSIGNMENT_B2A_PROTOCOL_VERSION, exportSha256, plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY }
for (let run = 1; run <= envelope.repeat; run += 1) {
  const entry = await runChild(`assignment-${run}`, 'assignment', { ...baseTask, conditions, windowLadder, rungIndex, replaySnapshots: envelope.replaySnapshots }, envelope.assignmentWallMs, envelope.assignmentHeapMb)
  processes.push(entry)
  const record = await readRecord(entry)
  if (entry.outcome === 'completed' && record) {
    const semanticSha256 = sha256(JSON.stringify(record.semantic))
    assignmentRuns.push({ id: entry.id, status: 'measured', recordFile: entry.recordFile, semanticSha256, outcome: record.semantic.outcome, windowTransition: record.semantic.windowTransition,
      planningTargetCount: record.semantic.input.planningTargetCount, generated: record.semantic.candidates?.generated ?? 0, bestObjective: record.semantic.candidates?.bestObjective ?? null,
      expandedNodes: record.semantic.solver?.diagnostics.expandedNodes ?? null, integrityIssues: record.semantic.integrityIssues,
      elapsedMs: record.observed.elapsedMs, wallMs: record.observed.wallMs, memoryMaxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB })
  } else {
    const reason = unmeasuredReason(entry.outcome)
    assignmentRuns.push({ id: entry.id, status: 'unmeasured', reason, recordFile: entry.recordFile, semanticSha256: null, outcome: { kind: 'unmeasured', reason },
      windowTransition: policy.decideWindowTransition({ kind: 'unmeasured', reason }, rungIndex, windowLadder) })
  }
}
let rootLowerBound = { status: 'not_requested' }
if (envelope.rootBoundBudget !== null) {
  const entry = await runChild('root-bound', 'root-bound', { ...baseTask, budget: envelope.rootBoundBudget }, envelope.rootBoundWallMs, envelope.rootBoundHeapMb)
  processes.push(entry)
  const record = await readRecord(entry)
  rootLowerBound = entry.outcome === 'completed' && record
    ? { ...record.report, masterSkillIds: record.masterSkillIds, wallMs: record.observed.wallMs, memoryMaxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB }
    : { status: 'unmeasured', reason: unmeasuredReason(entry.outcome), detail: `root-bound child ${entry.outcome}` }
}

const measured = assignmentRuns.filter(run => run.status === 'measured')
const semanticSha256s = measured.map(run => run.semanticSha256)
const determinism = { runs: assignmentRuns.length, measuredRuns: measured.length, identical: measured.length >= 2 ? new Set(semanticSha256s).size === 1 : null, semanticSha256s }
const first = assignmentRuns[0]
const comparison = rootBoundModule.compareObjectiveWithRootLowerBound(measured[0]?.bestObjective ?? null, rootLowerBound)
const integrityIssues = [
  ...measured.flatMap(run => run.integrityIssues.map(issue => `${run.id}: ${issue}`)),
  ...(determinism.identical === false ? ['semantic records of the repeated assignment runs differ'] : []),
  ...(comparison.consistency === 'inconsistent' ? ['best structural objective is below the root lower bound'] : []),
]
const output = {
  ...provenance, runDir: resolve(runDir), status: mode === 'formal' ? 'formal' : 'smoke',
  assignment: { runs: assignmentRuns, determinism, candidateNature: 'resource_assignment_only; not a Production Plan, not verified' },
  rootLowerBound, comparison, windowTransition: first?.windowTransition ?? null, processes, integrityIssues, totalWallMs: performance.now() - phaseStarted,
}
await write(outputPath, output)
console.log(JSON.stringify({ output: resolve(outputPath), runs: assignmentRuns.map(run => `${run.id}:${run.status}:${run.outcome.kind}${run.generated !== undefined ? `:${run.generated}` : ''}`),
  bestObjective: measured[0]?.bestObjective ?? null, rootLowerBound: rootLowerBound.status, comparison: comparison.consistency, determinism: determinism.identical, integrityIssues }))
if (integrityIssues.length > 0) process.exitCode = 1
