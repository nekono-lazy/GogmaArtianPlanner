// Issue #154 Global Assignment Phase B-2A (Research only). The assignment-only runner over an explicit external
// Export (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md): Phase 0 context -> Phase A ReachTable -> Phase B-1 resource
// assignment search in a fresh child process per run, and the design 10.2 root lower bound as its own child, each
// under a wall-clock and heap envelope (concurrency 1, no retry, no fallback). It never imports into the app, never
// opens IndexedDB, never runs the Production Planner / Planner Alternative Search / Trace Replay, passes no upper
// bound to the solver, reads no oracle manifest / verifier / RESULT and takes no post-hoc comparison argument.
//
// Modes and validity are two different things. `--mode smoke` is a non-formal run (formalValidity `not_applicable`).
// `--mode formal` attempts a run under the Phase B-2B registration (`ASSIGNMENT_B2B_PREREGISTRATION` in
// src/benchmarks/globalAssignment/assignmentProtocol.ts): it is refused before anything is written unless the
// registration is complete and enabled, the Working Tree is clean and committed, no condition is overridden, and the
// Export is verified against the identity registered in the committed Research document (`git show HEAD:<doc>`, so no
// hash is hard-coded here) and against `--expected-export-sha256`, which must name that same registered hash. Having
// started in formal mode never means success: the aggregated RESULT carries `formalValidity` (`valid` only when every
// registered assignment child measured with identical semantic records, no integrity issue, the root lower bound stage
// executed and the objective / bound comparison is consistent; otherwise `invalid` with the reasons, the diagnostics
// kept, and a non-zero exit code). Phase B-2A kept `formalRun.enabled = false`; Phase B-2B enabled it without changing a registered value.
//
// Parent:
//   node scripts/run-planner-global-assignment-b2a.mjs --export <Export .json> --run-dir <new dir> --output <new .json>
//     [--mode smoke] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--candidate-limit N] [--snapshot-limit N]
//     [--repeat N] [--assignment-wall-ms N] [--assignment-heap-mb N] [--root-bound-budget N] [--root-bound-wall-ms N]
//     [--root-bound-heap-mb N] [--no-replay] [--expected-export-sha256 <hex>] [--allow-uncommitted]
// Child (`--role assignment|root-bound`): spawned by the parent with --task and --record; never run by hand. A child
// re-applies the formal gate itself (registration, registered Export identity from HEAD, registered conditions), so a
// hand-written formal task cannot bypass the parent's refusal.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'
import { runChildProcess, unmeasuredReasonOf } from './planner-global-assignment-b2a-child-process.mjs'

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

/** The registered Export identity, read from the committed Research document (never from the Working Tree, never hard-coded). */
const readRegisteredExport = protocol => {
  const source = `HEAD:${protocol.ASSIGNMENT_B2A_DOC}`
  let markdown
  try {
    markdown = execFileSync('git', ['show', source], { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (error) {
    return { source, identity: null, issues: [`git show ${source} failed: ${error?.message ?? String(error)}`] }
  }
  const parsed = protocol.parseRegisteredExportIdentity(markdown)
  return { source, identity: parsed.identity, issues: parsed.issues }
}
const registrationGate = protocol => ({ formalRunEnabled: protocol.ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled, unresolvedItems: protocol.assignmentB2bRegistrationIssues() })
/** The Repository facts a run records and a formal child re-checks on its own (never the parent's self-reported values). */
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const repositoryState = () => ({
  repositoryHeadSha: git('rev-parse', 'HEAD'),
  workingTreeClean: git('status', '--porcelain').length === 0,
  uncommittedBenchmarkCode: Boolean(git('diff', 'HEAD', '--', ...CODE_PATHS) || git('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS)),
})
/** Whether `path` is ignored by git (a formal run writes only into ignored paths, so the children still see a clean tree). */
const isGitIgnored = path => { try { execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' }); return true } catch { return false } }

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
    if (!['smoke', 'formal'].includes(task.mode)) throw new Error(`Unknown task mode ${String(task.mode)}.`)
    const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentProtocol.ts')
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const raw = await readFile(exportPath)
    const actualExport = { fileName: basename(exportPath), bytes: raw.length, sha256: sha256(raw) }
    if (actualExport.sha256 !== task.actualExport?.sha256 || actualExport.bytes !== task.actualExport?.bytes) throw new Error('The Export differs from the one the parent hashed.')
    const registeredFromHead = readRegisteredExport(protocol)
    const registeredMatched = registeredFromHead.identity === null ? null : protocol.compareExportIdentity(actualExport, registeredFromHead.identity).length === 0
    if (task.mode === 'formal') {
      // The child re-applies the whole formal gate from its own observations (registration, registered Export identity from HEAD,
      // registered conditions, and the Repository: clean, committed, on the task's measurement HEAD): a task file alone never makes a formal child run.
      const repository = repositoryState()
      const gate = protocol.formalChildGateIssues({ registration: registrationGate(protocol), taskMode: task.mode, taskRegisteredExport: task.registeredExport ?? null, registeredExportFromHead: registeredFromHead,
        actualExport, taskConditions: task.conditions, taskWindowLadder: task.windowLadder, taskEnvelope: task.envelope,
        repository: { taskHeadSha: task.repositoryHeadSha ?? null, currentHeadSha: repository.repositoryHeadSha, workingTreeClean: repository.workingTreeClean, uncommittedBenchmarkCode: repository.uncommittedBenchmarkCode } })
      if (gate.length > 0) throw new Error(`The formal child gate refused the task: ${gate.join(' ')}`)
    }
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), task.plannerInputMaxPlanStepsForValidationOnly)
    const engine = new ProductionRngEngine()
    const dependencies = research.globalResearchDependencies(engine)
    const setupMs = performance.now() - started
    const common = {
      role, mode: task.mode, protocolVersion: task.protocolVersion,
      exportVerification: { actual: actualExport, taskMatched: true, registeredSource: registeredFromHead.source, registeredMatched, registeredIssues: registeredFromHead.issues },
      rngEngineVersion: engine.version, calculationContext: input.calculationContext, node: process.version,
    }
    if (role === 'assignment') {
      const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentRunner.ts')
      let yields = 0
      const result = await runner.runAssignmentOnly(input, dependencies,
        { conditions: task.conditions, windowLadder: task.windowLadder, rungIndex: task.rungIndex, replaySnapshots: task.envelope.replaySnapshots },
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
      const budget = task.envelope.rootBoundBudget
      const report = contextResult.kind === 'context'
        ? rootBound.measureRootLowerBound(contextResult.context, engine, budget, skills, { now: () => performance.now(), recordAbove: 30 })
        : { status: 'not_applicable', reason: 'unsupported_input', detail: `${contextResult.reason}: ${contextResult.detail}`, budget, targetSet: null, crossSatisfaction: null, elapsedMs: 0 }
      const memory = sampler.stop()
      await write(recordPath, { ...common, budget, masterSkillIds: { series: skills.seriesSkillIds.length, group: skills.groupSkillIds.length }, report,
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

const { repositoryHeadSha, workingTreeClean, uncommittedBenchmarkCode } = repositoryState()
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')

const server = await createLoader()
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentProtocol.ts')
const { reachWindowW0 } = await server.ssrLoadModule('/src/benchmarks/globalAssignment/reachTable.ts')
const policy = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentWindowPolicy.ts')
const rootBoundModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/assignmentRootBound.ts')
await server.close()
const registration = protocol.ASSIGNMENT_B2B_PREREGISTRATION
const gate = registrationGate(protocol)
// The registration gate (formalRun.enabled and a complete registration; enabled in Phase B-2B) refuses before the Export is even read.
if (mode === 'formal') {
  const gateIssues = protocol.formalRunGateIssues(gate)
  if (gateIssues.length > 0) throw new Error(`A formal run cannot start: ${gateIssues.join(' ')}`)
}

// The Export and its registered identity are read before the rest of the formal gate, which verifies them.
const rawExport = await readFile(exportPath)
const actualExport = { fileName: basename(exportPath), bytes: rawExport.length, sha256: sha256(rawExport) }
const registeredExport = readRegisteredExport(protocol)
const exportVerification = {
  mode, required: mode === 'formal', registeredSource: registeredExport.source, registered: registeredExport.identity, registeredIssues: registeredExport.issues,
  cliExpectedSha256: expectedExportSha256?.toLowerCase() ?? null, actual: actualExport,
  cliMatched: expectedExportSha256 === undefined ? null : actualExport.sha256 === expectedExportSha256.toLowerCase(),
  registeredMatched: registeredExport.identity === null ? null : protocol.compareExportIdentity(actualExport, registeredExport.identity).length === 0,
}

if (mode === 'formal') {
  // The whole start gate is one pure decision shared with the children.
  const startIssues = protocol.formalStartIssues({ registration: gate, workingTreeClean, uncommittedBenchmarkCode, allowUncommitted, overrideOptions,
    cliExpectedSha256: expectedExportSha256 ?? null, registeredExport: { identity: registeredExport.identity, issues: registeredExport.issues }, actualExport })
  // The children re-check the Working Tree themselves, so a formal run may write only into git-ignored paths.
  for (const [name, path] of [['--run-dir', runDir], ['--output', outputPath]]) if (!isGitIgnored(path)) startIssues.push(`${name} ${path} is not git-ignored; a formal run writes only into ignored paths (for example under .local/).`)
  if (startIssues.length > 0) throw new Error(`A formal run cannot start: ${startIssues.join(' ')}`)
} else {
  if (uncommittedBenchmarkCode && !allowUncommitted) throw new Error('Commit the benchmark code before a run, or pass --allow-uncommitted for a non-formal smoke.')
  if (exportVerification.cliMatched === false) throw new Error(`Export SHA-256 ${actualExport.sha256} is not the expected ${expectedExportSha256}.`)
}

const parseWindow = raw => {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 3 || parts.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error(`--window must be three positive integers N,G,S (got ${raw}).`)
  return { normal: parts[0], gogma: parts[1], skill: parts[2] }
}
let conditions, windowLadder, envelope
if (mode === 'formal') {
  const registered = protocol.registeredFormalConditions()
  if ('issues' in registered) throw new Error(`The registration is incomplete: ${registered.issues.join(' ')}`)
  ;({ conditions, windowLadder, envelope } = registered)
} else {
  conditions = { window: option('--window') === undefined ? reachWindowW0() : parseWindow(option('--window')), nodeBudget: integerOption('--node-budget', SMOKE_DEFAULTS.nodeBudget),
    mrvLookahead: integerOption('--mrv-lookahead', SMOKE_DEFAULTS.mrvLookahead), candidateLimit: integerOption('--candidate-limit', SMOKE_DEFAULTS.candidateLimit),
    snapshotLimit: integerOption('--snapshot-limit', SMOKE_DEFAULTS.snapshotLimit, 0) }
  windowLadder = [conditions.window]
  envelope = { assignmentWallMs: integerOption('--assignment-wall-ms', SMOKE_DEFAULTS.assignmentWallMs), assignmentHeapMb: integerOption('--assignment-heap-mb', SMOKE_DEFAULTS.assignmentHeapMb),
    rootBoundBudget: integerOption('--root-bound-budget', null), rootBoundWallMs: integerOption('--root-bound-wall-ms', SMOKE_DEFAULTS.rootBoundWallMs),
    rootBoundHeapMb: integerOption('--root-bound-heap-mb', SMOKE_DEFAULTS.rootBoundHeapMb), repeat: integerOption('--repeat', SMOKE_DEFAULTS.repeat, 0), replaySnapshots: !has('--no-replay') }
  // `--repeat 0` (smoke only): no assignment child, e.g. to time the root lower bound stage on its own.
  if (envelope.repeat === 0 && envelope.rootBoundBudget === null) throw new Error('--repeat 0 needs --root-bound-budget (nothing would run).')
}
const rungIndex = 0
const conditionIssues = [...protocol.validateAssignmentResearchConditions(conditions), ...protocol.validateWindowLadder(windowLadder)]
if (conditionIssues.length > 0) throw new Error(`Invalid conditions: ${conditionIssues.join(' ')}`)
const basis = name => mode === 'formal' ? 'registered condition (ASSIGNMENT_B2B_PREREGISTRATION)' : has(name) ? `non-formal smoke value from ${name}` : 'non-formal smoke runner default'
const conditionBasis = {
  window: mode === 'formal' ? basis() : has('--window') ? basis('--window') : 'W0 = recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1; non-oracle origin)',
  nodeBudget: basis('--node-budget'), mrvLookahead: basis('--mrv-lookahead'), candidateLimit: basis('--candidate-limit'), snapshotLimit: basis('--snapshot-limit'),
  rootBoundBudget: envelope.rootBoundBudget === null ? 'not requested' : basis('--root-bound-budget'),
  envelope: mode === 'formal' ? basis() : 'non-formal smoke values (command line or runner default); not registered conditions',
}

const docPath = protocol.ASSIGNMENT_B2A_DOC
const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const provenance = {
  protocolVersion: protocol.ASSIGNMENT_B2A_PROTOCOL_VERSION, phase: protocol.ASSIGNMENT_B2A_PHASE, mode,
  oracleFreeExecution: true, oracleInformedDesign: true,
  repositoryHeadSha, baseMain: protocol.ASSIGNMENT_B2A_BASE_MAIN, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
  researchDoc: existsSync(docPath) ? { file: docPath, sha256: sha256(await readFile(docPath)) } : { file: docPath, sha256: null },
  runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
  exportVerification,
  plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
  conditions, windowLadder, rungIndex, envelope: { ...envelope, concurrency: 1, retry: 'none' }, conditionBasis,
  registration: { formalRunEnabled: gate.formalRunEnabled, unresolvedItems: gate.unresolvedItems, reproducibilityRuns: registration.reproducibilityRuns },
  smokeOverrides: overrideOptions, launchedAt, machine,
}

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, 'start.json')
await write(startPath, provenance)
await chmod(startPath, 0o444).catch(() => {})
console.log(`${launchedAt} START mode=${mode} head=${repositoryHeadSha.slice(0, 12)} clean=${workingTreeClean} uncommittedCode=${uncommittedBenchmarkCode} export=${actualExport.sha256.slice(0, 8)} registeredMatched=${exportVerification.registeredMatched} window=${conditions.window.normal}/${conditions.window.gogma}/${conditions.window.skill} nodeBudget=${conditions.nodeBudget} candidateLimit=${conditions.candidateLimit}`)

/** One child under its envelope; always settles (a start failure is `failed`, recorded as unmeasured process_failure). */
const runChild = async (id, childRole, task, wallMs, heapMb) => {
  const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`)
  const startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
  const nodeFlags = [`--max-old-space-size=${heapMb}`]
  const base = { id, role: childRole, wallMs, heapMb, startedAt, nodeFlags, freeMemoryAtStart, taskFile: basename(taskPath) }
  try {
    await writeFile(taskPath, JSON.stringify(task, null, 2) + '\n', { flag: 'wx' })
  } catch (error) {
    console.log(`${new Date().toISOString()} END ${id} failed (task write failed)`)
    return { ...base, outcome: 'failed', exitCode: null, signal: null, timedOut: false, spawnError: `task write failed: ${error?.message ?? String(error)}`, settledBy: 'task_write', wallObservedMs: 0, pid: null, recordWritten: false, recordFile: null, stderrTail: null }
  }
  const result = await runChildProcess({
    spawnProcess: spawn, execPath: process.execPath, args: [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath], wallMs,
    recordWritten: () => existsSync(recordPath),
    onStart: child => console.log(`${startedAt} CHILD ${id} pid=${child.pid ?? 'n/a'} wall=${wallMs}ms heap=${heapMb}MB`),
  })
  console.log(`${new Date().toISOString()} END ${id} ${result.outcome} ${(result.wallObservedMs / 1000).toFixed(1)}s${result.spawnError ? ` (${result.spawnError})` : ''}`)
  return { ...base, ...result, recordFile: result.recordWritten ? basename(recordPath) : null }
}
const readRecord = async entry => {
  if (!entry.recordFile) return { record: null, error: null }
  try {
    return { record: JSON.parse(await readFile(join(runDir, entry.recordFile), 'utf8')), error: null }
  } catch (error) {
    return { record: null, error: `record unreadable: ${error?.message ?? String(error)}` }
  }
}
const recordConsistent = record => record.mode === mode && record.protocolVersion === protocol.ASSIGNMENT_B2A_PROTOCOL_VERSION && record.exportVerification?.actual?.sha256 === actualExport.sha256
  && record.exportVerification?.actual?.bytes === actualExport.bytes

const phaseStarted = performance.now()
const processes = []
const assignmentRuns = []
const integrityIssues = []
const baseTask = { protocolVersion: protocol.ASSIGNMENT_B2A_PROTOCOL_VERSION, mode, repositoryHeadSha, actualExport, exportSha256: actualExport.sha256, registeredExport: registeredExport.identity,
  conditions, windowLadder, rungIndex, envelope, plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY }
for (let run = 1; run <= envelope.repeat; run += 1) {
  const entry = await runChild(`assignment-${run}`, 'assignment', baseTask, envelope.assignmentWallMs, envelope.assignmentHeapMb)
  processes.push(entry)
  const { record, error } = await readRecord(entry)
  if (entry.outcome === 'completed' && record) {
    const consistent = recordConsistent(record)
    if (!consistent) integrityIssues.push(`${entry.id}: the child record disagrees with the parent (mode / protocol / Export)`)
    const semanticSha256 = sha256(JSON.stringify(record.semantic))
    assignmentRuns.push({ id: entry.id, status: 'measured', reason: null, recordFile: entry.recordFile, recordMode: record.mode, recordConsistent: consistent, semanticSha256,
      outcome: record.semantic.outcome, windowTransition: record.semantic.windowTransition, planningTargetCount: record.semantic.input.planningTargetCount,
      generated: record.semantic.candidates?.generated ?? 0, bestObjective: record.semantic.candidates?.bestObjective ?? null, expandedNodes: record.semantic.solver?.diagnostics.expandedNodes ?? null,
      integrityIssues: record.semantic.integrityIssues, elapsedMs: record.observed.elapsedMs, wallMs: record.observed.wallMs, memoryMaxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB })
  } else {
    const reason = entry.outcome === 'completed' ? 'process_failure' : unmeasuredReasonOf(entry.outcome)
    const detail = error ?? entry.spawnError ?? `${entry.outcome}`
    assignmentRuns.push({ id: entry.id, status: 'unmeasured', reason, detail, recordFile: entry.recordFile, recordMode: null, recordConsistent: null, semanticSha256: null, integrityIssues: [],
      outcome: { kind: 'unmeasured', reason }, windowTransition: policy.decideWindowTransition({ kind: 'unmeasured', reason }, rungIndex, windowLadder) })
  }
}
let rootLowerBound = { status: 'not_requested' }
if (envelope.rootBoundBudget !== null) {
  const entry = await runChild('root-bound', 'root-bound', baseTask, envelope.rootBoundWallMs, envelope.rootBoundHeapMb)
  processes.push(entry)
  const { record, error } = await readRecord(entry)
  if (entry.outcome === 'completed' && record) {
    const consistent = recordConsistent(record)
    if (!consistent) integrityIssues.push('root-bound: the child record disagrees with the parent (mode / protocol / Export)')
    rootLowerBound = { ...record.report, recordMode: record.mode, recordConsistent: consistent, childOutcome: entry.outcome, masterSkillIds: record.masterSkillIds,
      wallMs: record.observed.wallMs, memoryMaxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB }
  } else {
    const reason = entry.outcome === 'completed' ? 'process_failure' : unmeasuredReasonOf(entry.outcome)
    rootLowerBound = { status: 'unmeasured', reason, detail: error ?? entry.spawnError ?? `root-bound child ${entry.outcome}`, recordConsistent: null, childOutcome: entry.outcome }
  }
}

const measured = assignmentRuns.filter(run => run.status === 'measured')
const semanticSha256s = measured.map(run => run.semanticSha256)
const determinism = { runs: assignmentRuns.length, measuredRuns: measured.length, identical: measured.length >= 2 ? new Set(semanticSha256s).size === 1 : null, semanticSha256s }
const comparison = rootBoundModule.compareObjectiveWithRootLowerBound(measured[0]?.bestObjective ?? null, rootLowerBound)
integrityIssues.push(
  ...measured.flatMap(run => run.integrityIssues.map(issue => `${run.id}: ${issue}`)),
  ...(determinism.identical === false ? ['semantic records of the repeated assignment runs differ'] : []),
  ...(comparison.consistency === 'inconsistent' ? ['best structural objective is below the root lower bound'] : []),
)
// Having started in formal mode is not a formal measurement: judgeFormalValidity() decides (smoke -> not_applicable).
const formalValidity = protocol.judgeFormalValidity({
  mode, registration: { ...gate, reproducibilityRuns: registration.reproducibilityRuns },
  tree: { workingTreeClean, uncommittedBenchmarkCode, smokeOverrides: overrideOptions },
  exportVerification: { registeredMatched: exportVerification.registeredMatched, cliMatched: exportVerification.cliMatched },
  assignmentRuns: assignmentRuns.map(run => ({ id: run.id, status: run.status, reason: run.reason, semanticSha256: run.semanticSha256, integrityIssues: run.integrityIssues, recordConsistent: run.recordConsistent })),
  determinism: { identical: determinism.identical },
  rootLowerBound: { status: rootLowerBound.status, reason: rootLowerBound.reason ?? null, recordConsistent: rootLowerBound.recordConsistent ?? null },
  comparison: { consistency: comparison.consistency },
  // The aggregated issues as finally recorded: a formal run with any of them is invalid (valid => integrityIssues is empty).
  integrityIssues,
})
const output = {
  ...provenance, runDir: resolve(runDir), status: mode, formalValidity,
  assignment: { runs: assignmentRuns, determinism, candidateNature: 'resource_assignment_only; not a Production Plan, not verified' },
  rootLowerBound, comparison, windowTransition: assignmentRuns[0]?.windowTransition ?? null, processes, integrityIssues, totalWallMs: performance.now() - phaseStarted,
}
await write(outputPath, output)
console.log(JSON.stringify({ output: resolve(outputPath), mode, formalValidity: formalValidity.status, runs: assignmentRuns.map(run => `${run.id}:${run.status}:${run.outcome.kind}${run.generated !== undefined ? `:${run.generated}` : ''}`),
  bestObjective: measured[0]?.bestObjective ?? null, rootLowerBound: rootLowerBound.status, comparison: comparison.consistency, determinism: determinism.identical, integrityIssues, formalIssues: formalValidity.issues }))
if (integrityIssues.length > 0 || formalValidity.status === 'invalid') process.exitCode = 1
