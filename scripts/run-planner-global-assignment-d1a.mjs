// Issue #154 Global Assignment Phase D-1A (Research only). The non-formal Phase D' runner over an explicit external Export
// (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md, docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md 9.5 / 9.6 / 10.4 / 13.2):
//
// 1. a first child process re-runs the D-0C materialization (Phase 0 -> A -> C-2 -> D-0A, the registered D-0C conditions from
//    registeredD0cConditions(), unchanged; never the formal D-0C mode) and, once that run settled, compares its semantic SHA-256 and
//    Entry fingerprint with the D-0C values named on the command line. A mismatch stops the run before any Planner. Otherwise it
//    writes the Entry bodies it was handed (materializationRunner's execution-only onMaterializedEntries; the materialization is not
//    run twice) to a git-ignored Entry set file, and runs Phase D' in the same process: the final input (Production replacement and
//    validation authorities), createProductionPlanWithObserver() with the Research maxPlanSteps, an independent Trace Replay and the
//    physical summary (verify.ts);
// 2. a fresh child process rebuilds the PlannerInput from the Export, derives its own Phase 0, reads the Entry set (refused unless its
//    HEAD, Export, CalculationContext, Engine and Entry fingerprint are the ones this run produced), and runs Phase D' again;
// 3. the parent judges the run from both records (verificationProtocol.ts judgeD1aRun(): `verified` only when both processes meet every
//    condition and their semantic records are identical), recorded as `nonformal_planner_verified` - never a formal measurement, never
//    a registered VerifiedPlanRecord, never proven_minimum.
//
// Concurrency 1, no retry, one wall-clock and heap envelope per child (a timeout, an OOM, a cancellation or a process failure is
// unmeasured, never a Planner result). It never imports into the app, never opens IndexedDB, reads no oracle manifest / verifier /
// RESULT, takes no post-hoc comparison argument, synthesizes no conflict resolution and writes Entries only into the git-ignored run
// directory. The D-0C values to compare with are named on the command line (no hash is hard-coded here).
//
// Parent:
//   node scripts/run-planner-global-assignment-d1a.mjs --export <Export .json> --expected-export-sha256 <hex>
//     --expected-d0c-semantic-sha256 <hex> --expected-d0c-entry-fingerprint fnv1a32:<8 hex> --run-dir <new git-ignored dir>
//     --output <new git-ignored .json> [--first-wall-ms N] [--fresh-wall-ms N] [--heap-mb N] [--allow-uncommitted]
// Children (`--role first|fresh`): spawned by the parent with --task, --record and --journal; never run by hand. A child appends its
// progress to the journal synchronously, so a child its envelope stops keeps its confirmed progress.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { appendFileSync, existsSync, lstatSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'
import { runChildProcess } from './planner-global-assignment-d0b-child-process.mjs'

const SCRIPT_PATH = 'scripts/run-planner-global-assignment-d1a.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --export <Export .json> --expected-export-sha256 <hex> --expected-d0c-semantic-sha256 <hex> --expected-d0c-entry-fingerprint fnv1a32:<8 hex> --run-dir <new git-ignored dir> --output <new git-ignored .json> [--first-wall-ms N] [--fresh-wall-ms N] [--heap-mb N] [--allow-uncommitted]`
const KNOWN_OPTIONS = new Set(['--export', '--expected-export-sha256', '--expected-d0c-semantic-sha256', '--expected-d0c-entry-fingerprint', '--run-dir', '--output', '--first-wall-ms', '--fresh-wall-ms', '--heap-mb',
  '--allow-uncommitted', '--role', '--task', '--record', '--journal'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => name !== '--allow-uncommitted'))
const ROLES = ['first', 'fresh']
/** PlannerInput.options of the materialization input exactly as D-0C built it (validation only; Phase D' writes the Research maxPlanSteps). */
const PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY = 1_000
const MEMORY_SAMPLE_INTERVAL_MS = 250
const JOURNAL_MEMORY_INTERVAL_MS = 5_000
const ENTRY_SET_FILE = 'first.entry-set.json'
/** The Repository paths hashed as the benchmark code and checked for uncommitted changes (the D-0B / D-0C paths). */
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (VALUE_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const has = name => args.includes(name)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim()
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const role = option('--role')
const exportPath = option('--export')
if (!exportPath) throw new Error(USAGE)

/** The Repository facts a run records and each child re-observes on its own (never the parent's self-reported values). */
const repositoryState = () => ({
  repositoryHeadSha: git('rev-parse', 'HEAD'),
  workingTreeClean: git('status', '--porcelain').length === 0,
  uncommittedBenchmarkCode: Boolean(git('diff', 'HEAD', '--', ...CODE_PATHS) || git('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS)),
})
/** Whether `path` is ignored by git (Entry bodies and raw records are written only into ignored paths). */
const isGitIgnored = path => { try { execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' }); return true } catch { return false } }

// ------------------------------------------------------------------ children
if (role !== undefined) {
  if (!ROLES.includes(role)) throw new Error(`Unknown --role ${role}.`)
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
  // The memory at each stage boundary (observed, never semantic).
  const stageMemory = []
  const markStage = (stage, status) => {
    const usage = process.memoryUsage()
    stageMemory.push({ stage, status, atMs: atMs(), heapUsed: usage.heapUsed, rss: usage.rss })
  }
  sample()
  const timer = setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS)
  const server = await createLoader()
  try {
    const task = JSON.parse(await readFile(taskPath, 'utf8'))
    const vp = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationProtocol.ts')
    if (task.role !== role) throw new Error(`The task is for the ${String(task.role)} process, not ${role}.`)
    if (task.protocolVersion !== vp.D1A_PROTOCOL_VERSION) throw new Error(`Task protocol ${String(task.protocolVersion)} is not ${vp.D1A_PROTOCOL_VERSION}.`)
    if (task.researchMaxPlanSteps !== vp.D1A_NONFORMAL_CONDITIONS.researchMaxPlanSteps.value) throw new Error(`The task's Research maxPlanSteps ${String(task.researchMaxPlanSteps)} is not the D-1A condition.`)
    // Each child observes the Repository itself: the HEAD the parent recorded, and committed code unless the parent allowed otherwise.
    const repository = repositoryState()
    if (repository.repositoryHeadSha !== task.repositoryHeadSha) throw new Error(`The child runs at HEAD ${repository.repositoryHeadSha}, not the task's ${String(task.repositoryHeadSha)}.`)
    if (repository.uncommittedBenchmarkCode && task.allowUncommitted !== true) throw new Error('The child sees uncommitted benchmark code the task does not allow.')
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const verify = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verify.ts')
    const raw = await readFile(exportPath)
    const actualExport = { fileName: basename(exportPath), bytes: raw.length, sha256: sha256(raw) }
    if (JSON.stringify(actualExport) !== JSON.stringify(task.actualExport)) throw new Error('The Export differs from the one the parent hashed.')
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY)
    const engine = new ProductionRngEngine()
    if (JSON.stringify(input.calculationContext) !== JSON.stringify(task.calculationContext)) throw new Error('The CalculationContext of the input is not the one the parent recorded.')
    const setupMs = performance.now() - started
    let yields = 0
    const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
    const verification = async (handoff, plannerEngine) => {
      // Fresh Planner dependencies: the Plan's IDs never depend on what ran before in this process.
      const result = await verify.verifyPlannerCandidate(input, handoff, research.globalResearchDependencies(plannerEngine), { researchMaxPlanSteps: task.researchMaxPlanSteps }, {
        now: () => performance.now(), yieldControl,
        onStage: event => { markStage(event.stage, event.status); journal({ kind: 'verification_stage', stage: event.stage, status: event.status }) },
      })
      return { ...result, semanticSha256: sha256(JSON.stringify(result.semantic)) }
    }
    const base = { role, protocolVersion: task.protocolVersion, repositoryHeadSha: repository.repositoryHeadSha, childRepository: repository, exportVerification: { actual: actualExport, taskMatched: true },
      rngEngineVersion: engine.version, calculationContext: input.calculationContext, node: process.version, execArgv: [...process.execArgv] }
    const finish = async fields => {
      clearInterval(timer)
      sample()
      const memory = { maxima, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, endOfRun: process.memoryUsage(), stages: stageMemory }
      await write(recordPath, { ...base, ...fields, observed: { setupMs, wallMs: performance.now() - started, eventLoopYields: yields }, memory })
      journal({ kind: 'finished' })
    }

    if (role === 'first') {
      const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
      const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
      // The materialization conditions are the registered D-0C ones, read again here (no override reaches the child).
      const { conditions } = protocol.registeredD0cConditions()
      if (JSON.stringify(conditions) !== JSON.stringify(task.materializationConditions)) throw new Error('The task materialization conditions are not the registered D-0C conditions.')
      const handoffs = []
      const materializationStarted = performance.now()
      const result = await runner.runMaterializationSmoke(input, research.globalResearchDependencies(engine), { conditions }, {
        now: () => performance.now(), yieldControl,
        onProgress: event => journal({ kind: 'progress', event }),
        onMaterializedEntries: handoff => { handoffs.push(handoff) },
      })
      const materializationMs = performance.now() - materializationStarted
      markStage('materialization', 'finished')
      // Compared only now that the recomputation settled (the D-0C values never reach the materialization).
      const semanticSha256 = sha256(JSON.stringify(result.semantic))
      const identity = vp.compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected: task.expectedD0c })
      journal({ kind: 'identity', matched: identity.matched })
      const materialization = { semanticSha256, semantic: result.semantic, summary: runner.summarizeMaterializationRun(result.semantic), observed: result.observed, wallMs: materializationMs }
      if (!identity.matched) {
        await finish({ materialization, identity, entrySet: null, phase0PlanningTargetIds: null, verification: null })
      } else {
        const handoff = handoffs[0]
        const entrySet = vp.createD1aEntrySet(handoff, { repositoryHeadSha: repository.repositoryHeadSha, export: actualExport, calculationContext: input.calculationContext, rngEngineVersion: engine.version })
        const entrySetText = JSON.stringify(entrySet) + '\n'
        const entrySetPath = join(task.runDir, ENTRY_SET_FILE)
        await writeFile(entrySetPath, entrySetText, { flag: 'wx' })
        await chmod(entrySetPath, 0o444).catch(() => {})
        journal({ kind: 'entry_set' })
        const verified = await verification(handoff, new ProductionRngEngine())
        await finish({
          materialization, identity,
          entrySet: { file: ENTRY_SET_FILE, bytes: Buffer.byteLength(entrySetText), sha256: sha256(entrySetText), entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length },
          phase0PlanningTargetIds: [...handoff.planningTargetIds].sort(), verification: verified,
        })
      }
    } else {
      const context = await server.ssrLoadModule('/src/benchmarks/globalAssignment/context.ts')
      // The fresh process's own Phase 0 (the denominator is re-derived, never copied from the first process).
      const phase0 = context.createGlobalAssignmentContext(input, research.globalResearchDependencies(engine))
      if (phase0.kind !== 'context') throw new Error(`The fresh Phase 0 refused the input: ${phase0.reason}`)
      const entrySetText = await readFile(join(task.runDir, ENTRY_SET_FILE), 'utf8')
      if (sha256(entrySetText) !== task.entrySet.sha256) throw new Error('The Entry set file is not the one the first process wrote.')
      const entrySet = JSON.parse(entrySetText)
      const issues = vp.d1aEntrySetIssues(entrySet, { repositoryHeadSha: repository.repositoryHeadSha, export: actualExport, calculationContext: input.calculationContext, rngEngineVersion: engine.version, entryFingerprint: task.entrySet.entryFingerprint })
      if (issues.length > 0) throw new Error(`The fresh process refused the Entry set: ${issues.join(' ')}`)
      const phase0PlanningTargetIds = phase0.context.planningTargets.map(target => target.id)
      const verified = await verification(vp.handoffFromEntrySet(entrySet, phase0PlanningTargetIds), new ProductionRngEngine())
      await finish({ entrySet: { file: ENTRY_SET_FILE, sha256: task.entrySet.sha256, entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length, issues }, phase0PlanningTargetIds: [...phase0PlanningTargetIds].sort(), verification: verified })
    }
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------ parent
const runDir = option('--run-dir'), outputPath = option('--output')
if (!runDir || !outputPath) throw new Error(USAGE)
const expectedExportSha256 = option('--expected-export-sha256')
const expectedSemanticSha256 = option('--expected-d0c-semantic-sha256')
const expectedEntryFingerprint = option('--expected-d0c-entry-fingerprint')
if (expectedExportSha256 === undefined || !/^[0-9a-f]{64}$/.test(expectedExportSha256)) throw new Error(`--expected-export-sha256 must name 64 lower-case hex characters. ${USAGE}`)
if (expectedSemanticSha256 === undefined || !/^[0-9a-f]{64}$/.test(expectedSemanticSha256)) throw new Error(`--expected-d0c-semantic-sha256 must name 64 lower-case hex characters (the D-0C semantic SHA-256). ${USAGE}`)
if (expectedEntryFingerprint === undefined || !/^fnv1a32:[0-9a-f]{8}$/.test(expectedEntryFingerprint)) throw new Error(`--expected-d0c-entry-fingerprint must be fnv1a32:<8 hex> (the D-0C Entry fingerprint). ${USAGE}`)
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
for (const [name, path] of [['--run-dir', runDir], ['--output', outputPath]]) {
  if (!isGitIgnored(path)) throw new Error(`${name} ${path} is not git-ignored; the run writes Entry bodies and raw records only into ignored paths.`)
}

const server = await createLoader()
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
const vp = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationProtocol.ts')
const { PRODUCTION_RNG_ENGINE_VERSION } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
const { CURRENT_CALCULATION_APP_SCHEMA_VERSION } = await server.ssrLoadModule('/src/domain/models/common.ts')
const { loadMasterData } = await server.ssrLoadModule('/src/domain/master/loadMasterData.ts')
const master = loadMasterData()
if (!master.ok) throw new Error('Master Data failed validation.')
await server.close()
const calculationContext = { gameVersion: master.data.manifest.gameVersion, masterDataVersion: master.data.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }

const conditions = vp.D1A_NONFORMAL_CONDITIONS
const positiveIntegerOption = (name, fallback) => {
  const raw = option(name)
  if (raw === undefined) return fallback
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer (got ${raw}).`)
  return Number(raw)
}
const envelope = {
  firstChildWallMs: positiveIntegerOption('--first-wall-ms', conditions.firstChildWallMs.value),
  freshChildWallMs: positiveIntegerOption('--fresh-wall-ms', conditions.freshChildWallMs.value),
  childHeapMb: positiveIntegerOption('--heap-mb', conditions.childHeapMb.value),
}
const envelopeIssues = vp.d1aEnvelopeIssues(envelope)
if (envelopeIssues.length > 0) throw new Error(`Invalid envelope: ${envelopeIssues.join(' ')}`)
const envelopeOverrides = ['--first-wall-ms', '--fresh-wall-ms', '--heap-mb'].filter(has)
const { conditions: materializationConditions } = protocol.registeredD0cConditions()

const { repositoryHeadSha, workingTreeClean, uncommittedBenchmarkCode } = repositoryState()
if (uncommittedBenchmarkCode && !has('--allow-uncommitted')) throw new Error('Commit the benchmark code before a run, or pass --allow-uncommitted for a development run.')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')

const rawExport = await readFile(exportPath)
const actualExport = { fileName: basename(exportPath), bytes: rawExport.length, sha256: sha256(rawExport) }
if (actualExport.sha256 !== expectedExportSha256) throw new Error(`Export SHA-256 ${actualExport.sha256} is not the expected ${expectedExportSha256}.`)
// The D-0C Export is the one registered in the committed D-0B-2 document (read from HEAD, never hard-coded).
const registrationSource = `HEAD:${protocol.MATERIALIZATION_D0B2_DOC}`
let registeredExport = { identity: null, issues: [] }
try {
  registeredExport = protocol.readD0cRegisteredExportIdentity(execFileSync('git', ['show', registrationSource], { encoding: 'utf8', maxBuffer: 1 << 26 }))
} catch (error) {
  registeredExport = { identity: null, issues: [`git show ${registrationSource} failed: ${error?.message ?? String(error)}`] }
}
const registeredDifferences = registeredExport.identity === null ? null : protocol.d0cExportIdentityDifferences(actualExport, registeredExport.identity)
if (registeredDifferences === null || registeredDifferences.length > 0) {
  throw new Error(`The Export is not the D-0C (D-0B-2 registered) Export: ${registeredDifferences === null ? registeredExport.issues.join(' ') : registeredDifferences.join(' ')}`)
}

const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const provenance = {
  protocolVersion: vp.D1A_PROTOCOL_VERSION, phase: vp.D1A_PHASE, mode: 'nonformal', formal: false,
  nature: "Research: non-formal D-1A Phase D' check of the first structural candidate (Production Planner, independent Trace Replay, fresh ordinary Planner); not a formal measurement, not a registered VerifiedPlanRecord",
  oracleFreeExecution: true, oracleInformedDesign: true,
  repositoryHeadSha, baseMain: vp.D1A_BASE_MAIN, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
  runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
  exportVerification: { actual: actualExport, cliExpectedSha256: expectedExportSha256, cliMatched: true, registeredSource: registrationSource, registered: registeredExport.identity, registeredMatched: true },
  expectedD0c: { semanticSha256: expectedSemanticSha256, entryFingerprint: expectedEntryFingerprint, source: 'command line (the D-0C record); compared only after the re-run settled' },
  calculationContext,
  conditions: {
    materialization: materializationConditions,
    materializationBasis: conditions.materialization.basis,
    researchMaxPlanSteps: conditions.researchMaxPlanSteps,
    plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
    envelope: { ...envelope, concurrency: conditions.concurrency.value, retry: conditions.retry.value },
    envelopeBasis: { firstChildWallMs: has('--first-wall-ms') ? 'non-formal value from --first-wall-ms' : conditions.firstChildWallMs.basis, freshChildWallMs: has('--fresh-wall-ms') ? 'non-formal value from --fresh-wall-ms' : conditions.freshChildWallMs.basis, childHeapMb: has('--heap-mb') ? 'non-formal value from --heap-mb' : conditions.childHeapMb.basis },
    envelopeOverrides, registered: false,
  },
  launchedAt, machine,
}

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, 'start.json')
await write(startPath, provenance)
await chmod(startPath, 0o444).catch(() => {})
console.log(`${launchedAt} START d1a head=${repositoryHeadSha.slice(0, 12)} clean=${workingTreeClean} uncommittedCode=${uncommittedBenchmarkCode} export=${actualExport.sha256.slice(0, 8)} researchMaxPlanSteps=${conditions.researchMaxPlanSteps.value} envelope=${envelope.firstChildWallMs}/${envelope.freshChildWallMs}ms,${envelope.childHeapMb}MB`)

// A parent interrupt kills the running child and records it as cancelled (never as a Planner result).
const abort = new AbortController()
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { console.log(`${new Date().toISOString()} ${name}: cancelling the running child`); abort.abort() })

const runChild = async (id, task, wallMs) => {
  const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`), journalPath = join(runDir, `${id}.journal.jsonl`)
  const startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
  const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
  const base = { id, wallMs, heapMb: envelope.childHeapMb, startedAt, nodeFlags, freeMemoryAtStart, taskFile: basename(taskPath), journalFile: basename(journalPath) }
  try {
    await writeFile(taskPath, JSON.stringify(task, null, 2) + '\n', { flag: 'wx' })
  } catch (error) {
    return { ...base, outcome: 'process_failure', exitCode: null, signal: null, timedOut: false, cancelled: false, spawnError: `task write failed: ${error?.message ?? String(error)}`, settledBy: 'task_write', wallObservedMs: 0, pid: null, recordWritten: false, recordFile: null, stderrTail: null }
  }
  const result = await runChildProcess({
    spawnProcess: spawn, execPath: process.execPath, args: [...nodeFlags, SCRIPT_PATH, '--role', task.role, '--export', exportPath, '--task', taskPath, '--record', recordPath, '--journal', journalPath],
    wallMs, recordWritten: () => existsSync(recordPath), signal: abort.signal,
    onStart: child => console.log(`${startedAt} CHILD ${id} pid=${child.pid ?? 'n/a'} wall=${wallMs}ms heap=${envelope.childHeapMb}MB`),
  })
  console.log(`${new Date().toISOString()} END ${id} ${result.outcome} ${(result.wallObservedMs / 1000).toFixed(1)}s${result.spawnError ? ` (${result.spawnError})` : ''}`)
  return { ...base, ...result, recordFile: result.recordWritten ? basename(recordPath) : null }
}
const readRecord = async entry => {
  if (entry.outcome !== 'completed' || !entry.recordFile) return { record: null, error: null }
  try {
    return { record: JSON.parse(await readFile(join(runDir, entry.recordFile), 'utf8')), error: null }
  } catch (error) {
    return { record: null, error: `record unreadable: ${error?.message ?? String(error)}` }
  }
}
const readJournal = async entry => {
  try {
    return vp.parseD1aJournal(await readFile(join(runDir, entry.journalFile), 'utf8'))
  } catch (error) {
    return { unreadable: `journal unreadable: ${error?.message ?? String(error)}` }
  }
}

const phaseStarted = performance.now()
const integrityIssues = []
const taskBase = { protocolVersion: vp.D1A_PROTOCOL_VERSION, repositoryHeadSha, allowUncommitted: has('--allow-uncommitted'), actualExport, calculationContext, runDir: resolve(runDir), researchMaxPlanSteps: conditions.researchMaxPlanSteps.value }
const firstProcess = await runChild('first', { ...taskBase, role: 'first', materializationConditions, expectedD0c: { semanticSha256: expectedSemanticSha256, entryFingerprint: expectedEntryFingerprint } }, envelope.firstChildWallMs)
const first = await readRecord(firstProcess)
const firstJournal = await readJournal(firstProcess)
if (first.error) integrityIssues.push(`first: ${first.error}`)
const firstConsistent = first.record === null || (first.record.role === 'first' && first.record.repositoryHeadSha === repositoryHeadSha && JSON.stringify(first.record.exportVerification?.actual) === JSON.stringify(actualExport))
if (!firstConsistent) integrityIssues.push('first: the child record disagrees with the parent (role / HEAD / Export)')
if (first.record?.verification && first.record.verification.semanticSha256 !== sha256(JSON.stringify(first.record.verification.semantic))) integrityIssues.push('first: the recorded verification SHA-256 is not the hash of its record')
if (first.record?.materialization && first.record.materialization.semanticSha256 !== sha256(JSON.stringify(first.record.materialization.semantic))) integrityIssues.push('first: the recorded materialization SHA-256 is not the hash of its record')

// The fresh process runs only after a first process that reached Phase D' (identity matched).
let freshProcess = null, fresh = { record: null, error: null }, freshJournal = null
if (!abort.signal.aborted && firstConsistent && first.record?.identity?.matched === true && first.record.verification !== null && first.record.entrySet !== null) {
  freshProcess = await runChild('fresh', { ...taskBase, role: 'fresh', entrySet: { sha256: first.record.entrySet.sha256, entryFingerprint: first.record.entrySet.entryFingerprint } }, envelope.freshChildWallMs)
  fresh = await readRecord(freshProcess)
  freshJournal = await readJournal(freshProcess)
  if (fresh.error) integrityIssues.push(`fresh: ${fresh.error}`)
  if (fresh.record !== null && (fresh.record.role !== 'fresh' || fresh.record.repositoryHeadSha !== repositoryHeadSha)) integrityIssues.push('fresh: the child record disagrees with the parent (role / HEAD)')
  if (fresh.record?.verification && fresh.record.verification.semanticSha256 !== sha256(JSON.stringify(fresh.record.verification.semantic))) integrityIssues.push('fresh: the recorded verification SHA-256 is not the hash of its record')
}
const after = repositoryState()
if (after.repositoryHeadSha !== repositoryHeadSha || after.workingTreeClean !== workingTreeClean) integrityIssues.push(`the Repository changed during the run (HEAD ${after.repositoryHeadSha}, clean ${after.workingTreeClean})`)

const processOutcome = (entry, record) => (entry.outcome === 'completed' && record === null ? 'process_failure' : entry.outcome)
const verificationView = record => (record?.verification ? { semantic: record.verification.semantic, semanticSha256: record.verification.semanticSha256 } : null)
const judgement = vp.judgeD1aRun(
  { process: processOutcome(firstProcess, first.record), identity: first.record?.identity ?? null, verification: verificationView(first.record) },
  freshProcess === null
    ? { process: 'not_run', phase0PlanningTargetIds: null, verification: null }
    : { process: processOutcome(freshProcess, fresh.record), phase0PlanningTargetIds: fresh.record?.phase0PlanningTargetIds ?? null, verification: verificationView(fresh.record) },
)
const runSummary = (entry, record, journalProgress) => ({
  id: entry.id, process: { outcome: entry.outcome, exitCode: entry.exitCode, signal: entry.signal, timedOut: entry.timedOut, cancelled: entry.cancelled, settledBy: entry.settledBy, wallObservedMs: entry.wallObservedMs, wallMs: entry.wallMs, heapMb: entry.heapMb, startedAt: entry.startedAt, recordWritten: entry.recordWritten, stderrTail: entry.stderrTail ?? null },
  recordFile: entry.recordFile,
  materialization: record?.materialization ? { semanticSha256: record.materialization.semanticSha256, summary: record.materialization.summary, observed: record.materialization.observed, wallMs: record.materialization.wallMs } : null,
  identity: record?.identity ?? null,
  entrySet: record?.entrySet ?? null,
  phase0PlanningTargetCount: record?.phase0PlanningTargetIds?.length ?? null,
  verification: record?.verification ? { semanticSha256: record.verification.semanticSha256, semantic: record.verification.semantic, observed: record.verification.observed } : null,
  observed: record?.observed ?? null, memory: record?.memory ?? null,
  confirmedProgress: record === null ? journalProgress : null,
})
const output = {
  ...provenance, runDir: resolve(runDir), status: 'nonformal',
  verdict: judgement.verdict, recordClassification: judgement.recordClassification, crossProcess: judgement.crossProcess,
  // Post hoc only, and only for a verified verdict (design 13.2): never a minimality claim.
  postHoc: { operationCount: vp.d1aOperationCountReading(judgement.verdict) },
  runs: [runSummary(firstProcess, first.record, firstJournal), ...(freshProcess === null ? [] : [runSummary(freshProcess, fresh.record, freshJournal)])],
  integrityIssues, totalWallMs: performance.now() - phaseStarted,
  claims: 'none formal: a verified verdict here is nonformal_planner_verified (D-1A conditions, not registered), never bestVerified, a formal VerifiedPlanRecord or proven_minimum',
}
await write(outputPath, output)
console.log(JSON.stringify({ output: resolve(outputPath), verdict: judgement.verdict.kind, classification: judgement.recordClassification, crossProcess: judgement.crossProcess,
  identity: first.record?.identity?.matched ?? null, runs: output.runs.map(run => `${run.id}:${run.process.outcome}:${run.verification?.semantic.outcome.kind ?? 'none'}`), integrityIssues }))
// An integrity issue or a D-0C identity mismatch exits 1 (the records are kept); an unmeasured run exits 2.
if (integrityIssues.length > 0 || judgement.verdict.kind === 'stopped_d0c_identity_mismatch') process.exitCode = 1
else if (judgement.verdict.kind === 'unmeasured') process.exitCode = 2
