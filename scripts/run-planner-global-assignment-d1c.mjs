// Issue #154 Global Assignment Phase D-1C (Research only). The formal integration acceptance runner over the registered external
// Export (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md, docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md 8 - 16,
// docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md 9.5 / 9.6 / 12 / 13.2). Formal mode only: every condition and every comparison value comes from
// the D-1B registration (PLANNER_VERIFICATION_D1C_PREREGISTRATION) and the committed documents, never from the command line.
//
// 1. The start gate (verificationFormal.ts d1cFormalStartGate()) is judged once, before anything is written: the registration complete,
//    enabled and fingerprinted as the registered block of the D-1B document at the measured HEAD and at the registration HEAD, no
//    override, a clean committed checkout, the calculation code audited against the registration HEAD (only the D-1C formal
//    infrastructure changed, no Production file), the Export registered in the committed D-0B-2 document, the registered CalculationContext
//    / Engine / Master, no oracle input, the registered D-0C identity readable, new git-ignored outputs. A refusal creates nothing.
// 2. Two complete runs, one after another (concurrency 1, no retry), each in its own run directory: a first child re-runs the D-0C
//    registered materialization, compares its semantic SHA-256 and Entry fingerprint with the registered D-0C identity only once that
//    run settled, writes the Entry set and runs Phase D' (verify.ts: Production replacement authority, createProductionPlanWithObserver()
//    with the Research maxPlanSteps, independent Trace Replay, physical summary); a fresh child rebuilds the input from the Export, derives
//    its own Phase 0, checks the Entry set of its own run and runs Phase D' again. Each child re-applies the formal gate from its own
//    observations before it computes anything, so a hand-written task cannot bypass the parent.
// 3. The parent reads the records back and concludes once (concludeD1cMeasurement()): each run's integrity and D-1A conclusion, the RESULT
//    integrity, the formal validity (the 15 provenance and 9 reproducibility rules), the candidate outcome, the acceptance (valid and
//    verified together) and the post hoc readings. The derivation script re-derives the same conclusion from the same raw files.
//
// It never imports into the app, never opens IndexedDB, reads no oracle manifest / verifier / lower bound / RESULT, takes no post-hoc
// argument, synthesizes no conflict resolution, and writes Entry bodies and raw records only into the git-ignored run directory.
//
// Parent:
//   node scripts/run-planner-global-assignment-d1c.mjs --mode formal --export <registered Export .json> --run-dir <new git-ignored dir>
//     --output <new git-ignored .json>
// Children (`--role first|fresh`): spawned by the parent with --task, --record and --journal; a hand-written task meets the same gate.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { appendFileSync, existsSync, lstatSync } from 'node:fs'
import { resolve, join, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'
import { runChildProcess } from './planner-global-assignment-d0b-child-process.mjs'

const SCRIPT_PATH = 'scripts/run-planner-global-assignment-d1c.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --mode formal --export <registered Export .json> --run-dir <new git-ignored dir> --output <new git-ignored .json>`
/** Options a child takes (the parent's own options are verificationFormal.ts D1C_FORMAL_OPTIONS; anything else is an override). */
const CHILD_OPTIONS = ['--role', '--export', '--task', '--record', '--journal']
/** Options that take no value (only for parsing an override the start gate then refuses). */
const VALUELESS_OPTIONS = new Set(['--allow-uncommitted'])
/** PlannerInput.options of the materialization input exactly as D-0C built it (validation only; Phase D' writes the Research maxPlanSteps). */
const PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY = 1_000
const MEMORY_SAMPLE_INTERVAL_MS = 250
const JOURNAL_MEMORY_INTERVAL_MS = 5_000
const ENTRY_SET_FILE = 'first.entry-set.json'
const FIRST_RECORD_FILE = 'first.record.json'
const START_FILE = 'start.json'
/** The Repository paths hashed as the benchmark code, checked for uncommitted changes and audited since the registration HEAD (the D-1A runner's CODE_PATHS). */
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (!VALUELESS_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const serialize = value => JSON.stringify(value, null, 2) + '\n'
const write = (path, value) => writeFile(path, serialize(value), { flag: 'wx' })
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const role = option('--role')
const exportPath = option('--export')

/** The checkout facts a run records and each child re-observes on its own (never the parent's self-reported values). */
const checkoutState = () => ({
  repositoryHeadSha: git('rev-parse', 'HEAD'),
  workingTreeClean: git('status', '--porcelain').length === 0,
  uncommittedBenchmarkCode: Boolean(git('diff', 'HEAD', '--', ...CODE_PATHS) || git('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS)),
})
/** The calculation-related code committed since the registration HEAD: a git failure is recorded, never read as "no change". */
const calculationCodeAudit = registrationHead => {
  let registrationHeadIsAncestor = false
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', registrationHead, 'HEAD'], { stdio: 'ignore' })
    registrationHeadIsAncestor = true
  } catch {
    registrationHeadIsAncestor = false
  }
  try {
    const changedFiles = git('diff', '--name-only', `${registrationHead}..HEAD`, '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean).sort()
    return { registrationHead, registrationHeadIsAncestor, changedFiles, error: null }
  } catch (error) {
    return { registrationHead, registrationHeadIsAncestor, changedFiles: [], error: `git diff failed: ${error?.message ?? String(error)}` }
  }
}
/** Whether `path` is ignored by git (Entry bodies and raw records are written only into ignored paths). */
const isGitIgnored = path => { try { execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' }); return true } catch { return false } }
/** A committed document (`git show <commit>:<doc>`; never the working tree, never hard-coded). */
const committedDocument = (commit, doc) => {
  const source = `${commit}:${doc}`
  try {
    const text = execFileSync('git', ['show', source], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] })
    return { source, text, error: null, sha256: sha256(text) }
  } catch (error) {
    return { source, text: null, error: `git show ${source} failed: ${error?.message ?? String(error)}`, sha256: null }
  }
}
/** The committed documents every process reads itself: the D-1B registration blocks (measured HEAD and registration HEAD) and the D-0B-2 Export block. */
const readRegistrationDocuments = (formal, registration, protocol) => {
  const d1bAtMeasuredHead = committedDocument('HEAD', registration.PLANNER_VERIFICATION_D1B_DOC)
  const d1bAtRegistrationHead = committedDocument(formal.PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD, registration.PLANNER_VERIFICATION_D1B_DOC)
  const d0b2AtMeasuredHead = committedDocument('HEAD', protocol.MATERIALIZATION_D0B2_DOC)
  const documents = { atMeasuredHead: d1bAtMeasuredHead, atRegistrationHead: d1bAtRegistrationHead }
  return {
    registration: formal.observeD1cRegistration(documents),
    registeredD0c: formal.observeD1cRegisteredD0c(documents),
    registeredExport: formal.observeD1cRegisteredExport(d0b2AtMeasuredHead),
    documents: [d1bAtMeasuredHead, d1bAtRegistrationHead, d0b2AtMeasuredHead].map(document => ({ source: document.source, sha256: document.sha256, error: document.error })),
    inputsRead: [d1bAtMeasuredHead, d1bAtRegistrationHead, d0b2AtMeasuredHead].map(document => `git:${document.source}`),
  }
}

// ------------------------------------------------------------------ children
if (role !== undefined) {
  for (const flag of flags) if (!CHILD_OPTIONS.includes(flag)) throw new Error(`Unknown child option ${flag}.`)
  if (!['first', 'fresh'].includes(role)) throw new Error(`Unknown --role ${role}.`)
  const taskPath = option('--task'), recordPath = option('--record'), journalPath = option('--journal')
  if (!taskPath || !recordPath || !journalPath || !exportPath) throw new Error('A child needs --export, --task, --record and --journal.')
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
    const taskText = await readFile(taskPath, 'utf8')
    const task = JSON.parse(taskText)
    const formal = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationFormal.ts')
    const registrationModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationRegistration.ts')
    const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
    // The formal gate, from this child's own observations, before any calculation (a hand-written task meets the same gate).
    const checkout = checkoutState()
    const calculationAudit = calculationCodeAudit(formal.PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD)
    const read = readRegistrationDocuments(formal, registrationModule, protocol)
    const raw = await readFile(exportPath)
    const actualExport = { fileName: basename(exportPath), bytes: raw.length, sha256: sha256(raw) }
    const runDir = resolve(typeof task.runDir === 'string' ? task.runDir : '.')
    const inputsRead = [`task:${basename(taskPath)}`, `export:${actualExport.fileName}`, ...read.inputsRead]
    const gate = {
      observedHeadSha: checkout.repositoryHeadSha, workingTreeClean: checkout.workingTreeClean, uncommittedBenchmarkCode: checkout.uncommittedBenchmarkCode, calculationAudit,
      registration: read.registration, registeredExport: read.registeredExport, registeredD0c: read.registeredD0c, execArgv: [...process.execArgv],
    }
    const gateIssues = formal.d1cFormalChildGateIssues({
      role, task, paths: { runDir, taskDir: dirname(resolve(taskPath)), recordDir: dirname(resolve(recordPath)), journalDir: dirname(resolve(journalPath)) },
      checkout: { headSha: checkout.repositoryHeadSha, workingTreeClean: checkout.workingTreeClean, uncommittedBenchmarkCode: checkout.uncommittedBenchmarkCode, calculationAudit },
      registration: read.registration, registeredExport: read.registeredExport, registeredD0c: read.registeredD0c, actualExport, execArgv: process.execArgv, inputsRead,
    })
    if (gateIssues.length > 0) throw new Error(`The formal child gate refused the task: ${gateIssues.join(' ')}`)
    const vp = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationProtocol.ts')
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const verify = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verify.ts')
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY)
    const engine = new ProductionRngEngine()
    // The registered CalculationContext, Engine and Master, once the input is loaded and before any calculation.
    const calculationIssues = formal.d1cFormalChildCalculationIssues({ calculationContext: input.calculationContext, rngEngineVersion: engine.version })
    if (calculationIssues.length > 0) throw new Error(`The formal child gate refused the task: ${calculationIssues.join(' ')}`)
    // The registered conditions, read again here from the registration (the gate refused a task whose conditions differ from them).
    const { verification: verificationConditions, materialization: materializationConditions } = formal.registeredD1cExpectation().conditions
    // One structural candidate is verified per complete run (the registered verification budget; the gate checked the conditions).
    if (verificationConditions.verificationBudget !== 1) throw new Error(`This runner verifies one candidate per run (verification budget ${verificationConditions.verificationBudget}).`)
    const setupMs = performance.now() - started
    let yields = 0
    const yieldControl = () => new Promise(done => { yields += 1; setImmediate(done) })
    const verification = async (handoff, plannerEngine) => {
      // Fresh Planner dependencies: the Plan's IDs never depend on what ran before in this process.
      const result = await verify.verifyPlannerCandidate(input, handoff, research.globalResearchDependencies(plannerEngine), { researchMaxPlanSteps: verificationConditions.researchMaxPlanSteps }, {
        now: () => performance.now(), yieldControl,
        onStage: event => { markStage(event.stage, event.status); journal({ kind: 'verification_stage', stage: event.stage, status: event.status }) },
      })
      return { ...result, semanticSha256: sha256(JSON.stringify(result.semantic)) }
    }
    const formalBlock = (fields) => ({
      mode: 'formal', formalProtocolVersion: formal.D1C_FORMAL_PROTOCOL_VERSION, role, runIndex: task.runIndex, pid: process.pid,
      gate: { issues: gateIssues, ...gate }, calculation: { issues: calculationIssues, calculationContext: input.calculationContext, rngEngineVersion: engine.version },
      entrySetSource: null, verificationBudget: null, verifiedCandidates: null, inputsRead, ...fields,
    })
    const base = {
      role, protocolVersion: task.verificationProtocolVersion, repositoryHeadSha: checkout.repositoryHeadSha, childCheckout: checkout,
      exportVerification: { actual: actualExport, taskMatched: true }, rngEngineVersion: engine.version, calculationContext: input.calculationContext,
      node: process.version, execArgv: [...process.execArgv], taskSha256: sha256(taskText),
    }
    const finish = async fields => {
      clearInterval(timer)
      sample()
      const memory = { maxima, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, endOfRun: process.memoryUsage(), stages: stageMemory }
      await write(recordPath, { ...base, ...fields, observed: { setupMs, wallMs: performance.now() - started, eventLoopYields: yields }, memory })
      journal({ kind: 'finished' })
    }

    if (role === 'first') {
      const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
      const handoffs = []
      const materializationStarted = performance.now()
      // The registered D-0C conditions (the gate compared the task's with the registration; no override reaches the child).
      const result = await runner.runMaterializationSmoke(input, research.globalResearchDependencies(engine), { conditions: materializationConditions }, {
        now: () => performance.now(), yieldControl,
        onProgress: event => journal({ kind: 'progress', event }),
        onMaterializedEntries: handoff => { handoffs.push(handoff) },
      })
      const materializationMs = performance.now() - materializationStarted
      markStage('materialization', 'finished')
      // Compared only now that the recomputation settled (the registered D-0C values never reach the materialization).
      const semanticSha256 = sha256(JSON.stringify(result.semantic))
      const identity = vp.compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected: task.expectedD0c })
      journal({ kind: 'identity', matched: identity.matched })
      const materialization = { semanticSha256, semantic: result.semantic, summary: runner.summarizeMaterializationRun(result.semantic), observed: result.observed, wallMs: materializationMs }
      if (!identity.matched) {
        await finish({ formal: formalBlock({ verificationBudget: verificationConditions.verificationBudget, verifiedCandidates: 0 }), materialization, identity, entrySet: null, phase0PlanningTargetIds: null, verification: null })
      } else {
        const handoff = handoffs[0]
        const entrySet = vp.createD1aEntrySet(handoff, { repositoryHeadSha: checkout.repositoryHeadSha, export: actualExport, calculationContext: input.calculationContext, rngEngineVersion: engine.version })
        const entrySetText = JSON.stringify(entrySet) + '\n'
        const entrySetPath = join(runDir, ENTRY_SET_FILE)
        await writeFile(entrySetPath, entrySetText, { flag: 'wx' })
        await chmod(entrySetPath, 0o444).catch(() => {})
        journal({ kind: 'entry_set' })
        const verified = await verification(handoff, new ProductionRngEngine())
        await finish({
          formal: formalBlock({ verificationBudget: verificationConditions.verificationBudget, verifiedCandidates: 1 }), materialization, identity,
          entrySet: { file: ENTRY_SET_FILE, bytes: Buffer.byteLength(entrySetText), sha256: sha256(entrySetText), entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length },
          phase0PlanningTargetIds: [...handoff.planningTargetIds].sort(), verification: verified,
        })
      }
    } else {
      const context = await server.ssrLoadModule('/src/benchmarks/globalAssignment/context.ts')
      // The fresh process's own Phase 0 (the denominator is re-derived, never copied from the first process).
      const phase0 = context.createGlobalAssignmentContext(input, research.globalResearchDependencies(engine))
      if (phase0.kind !== 'context') throw new Error(`The fresh Phase 0 refused the input: ${phase0.reason}`)
      // The Entry set of this run only: the file the parent named, written by this run's first process (its record, read here).
      const entrySetText = await readFile(join(runDir, task.entrySet.file), 'utf8')
      let firstRecord = null, firstRecordReadError = null
      try {
        firstRecord = JSON.parse(await readFile(join(runDir, task.entrySet.firstRecordFile), 'utf8'))
      } catch (error) {
        firstRecordReadError = error?.message ?? String(error)
      }
      inputsRead.push(`entry-set:${basename(runDir)}/${task.entrySet.file}`, `first-record:${basename(runDir)}/${task.entrySet.firstRecordFile}`)
      const sourceIssues = formal.d1cFreshEntrySetSourceIssues({ task, entrySetSha256: sha256(entrySetText), firstRecord, firstRecordReadError })
      if (sourceIssues.length > 0) throw new Error(`The fresh process refused the Entry set: ${sourceIssues.join(' ')}`)
      const entrySet = JSON.parse(entrySetText)
      const issues = vp.d1aEntrySetIssues(entrySet, { repositoryHeadSha: checkout.repositoryHeadSha, export: actualExport, calculationContext: input.calculationContext, rngEngineVersion: engine.version, entryFingerprint: task.entrySet.entryFingerprint })
      if (issues.length > 0) throw new Error(`The fresh process refused the Entry set: ${issues.join(' ')}`)
      const phase0PlanningTargetIds = phase0.context.planningTargets.map(target => target.id)
      const verified = await verification(vp.handoffFromEntrySet(entrySet, phase0PlanningTargetIds), new ProductionRngEngine())
      await finish({
        formal: formalBlock({ entrySetSource: { issues: sourceIssues } }),
        entrySet: { file: task.entrySet.file, sha256: task.entrySet.sha256, entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length, issues },
        phase0PlanningTargetIds: [...phase0PlanningTargetIds].sort(), verification: verified,
      })
    }
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// ------------------------------------------------------------------ parent
const runDir = option('--run-dir'), outputPath = option('--output'), modeOption = option('--mode') ?? null
if (!exportPath || !runDir || !outputPath || modeOption === null) throw new Error(USAGE)
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')

const server = await createLoader()
const formal = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationFormal.ts')
const registrationModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationRegistration.ts')
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
const vp = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationProtocol.ts')
const { PRODUCTION_RNG_ENGINE_VERSION } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
const { CURRENT_CALCULATION_APP_SCHEMA_VERSION } = await server.ssrLoadModule('/src/domain/models/common.ts')
const { loadMasterData } = await server.ssrLoadModule('/src/domain/master/loadMasterData.ts')
const master = loadMasterData()
await server.close()
if (!master.ok) throw new Error('Master Data failed validation.')
const currentAuthorities = {
  calculationContext: { gameVersion: master.data.manifest.gameVersion, masterDataVersion: master.data.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION },
  rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
}

// The start gate: one pure decision over the parent's observations, before anything is written.
const checkout = checkoutState()
const calculationAudit = calculationCodeAudit(formal.PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD)
const read = readRegistrationDocuments(formal, registrationModule, protocol)
const rawExport = await readFile(exportPath)
const actualExport = { fileName: basename(exportPath), bytes: rawExport.length, sha256: sha256(rawExport) }
const inputsRead = [`export:${actualExport.fileName}`, ...read.inputsRead]
const expectation = formal.registeredD1cExpectation()
const outputPaths = [['--run-dir', runDir], ['--output', outputPath]].map(([name, path]) => ({ option: name, path, gitIgnored: isGitIgnored(path), exists: lstatSync(path, { throwIfNoEntry: false }) !== undefined }))
const startGate = formal.d1cFormalStartGate({
  registration: read.registration, flags, mode: modeOption,
  checkout: { headSha: checkout.repositoryHeadSha, workingTreeClean: checkout.workingTreeClean, uncommittedBenchmarkCode: checkout.uncommittedBenchmarkCode, calculationAudit },
  registeredExport: read.registeredExport, actualExport, registeredD0c: read.registeredD0c, outputPaths, currentAuthorities, plannedConditions: expectation.conditions, inputsRead,
})
if (!startGate.passed) throw new Error(`A formal run cannot start: ${startGate.issues.join(' ')}`)

const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const envelope = expectation.conditions.envelope
const start = {
  formalProtocolVersion: formal.D1C_FORMAL_PROTOCOL_VERSION, phase: formal.PLANNER_VERIFICATION_D1C_PHASE, mode: 'formal',
  nature: "Research: formal D-1C integration acceptance of the D-1B registered conditions (formalValidity decides whether it counts; the candidate outcome is judged apart)",
  measurementHeadSha: checkout.repositoryHeadSha, registrationHead: formal.PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD, benchmarkCodeSha256,
  workingTreeClean: checkout.workingTreeClean, uncommittedBenchmarkCode: checkout.uncommittedBenchmarkCode, flags, modeOption, parentPid: process.pid,
  registration: read.registration, calculationAudit, registeredExport: read.registeredExport, actualExport, registeredD0c: read.registeredD0c, documents: read.documents,
  currentAuthorities, conditions: expectation.conditions, inputsRead, oracleFreeExecution: true, oracleInformedDesign: true, startGate,
  verificationProtocolVersion: expectation.verificationProtocolVersion, materializationProtocolVersion: expectation.materializationProtocolVersion,
  plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
  runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8, launchedAt, machine,
}

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, START_FILE)
await write(startPath, start)
await chmod(startPath, 0o444).catch(() => {})
// The start record must be exactly the provenance the RESULT carries.
const startRecordMatches = (await readFile(startPath, 'utf8')) === serialize(start)
console.log(`${launchedAt} START d1c formal head=${checkout.repositoryHeadSha.slice(0, 12)} registration=${formal.PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD.slice(0, 12)} fingerprint=${read.registration.fingerprint.computed} export=${actualExport.sha256.slice(0, 8)} repeat=${envelope.repeat} envelope=${envelope.firstChildWallMs}/${envelope.freshChildWallMs}ms,${envelope.childHeapMb}MB`)

// A parent interrupt kills the running child, records it as cancelled and starts nothing more (never a Planner result).
const abort = new AbortController()
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { console.log(`${new Date().toISOString()} ${name}: cancelling the running child`); abort.abort() })

const phaseStarted = performance.now()
const at = () => performance.now() - phaseStarted
const runChild = async (dir, childRole, runIndex, task, wallMs) => {
  const id = `run-${runIndex}-${childRole}`
  const taskPath = join(dir, `${childRole}.task.json`), recordPath = join(dir, `${childRole}.record.json`), journalPath = join(dir, `${childRole}.journal.jsonl`)
  const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
  const base = { id, role: childRole, runIndex, wallMs, heapMb: envelope.childHeapMb, nodeFlags, taskFile: basename(taskPath), journalFile: basename(journalPath), startedAt: new Date().toISOString(), freeMemoryAtStart: freemem() }
  const startedAtMs = at()
  try {
    await writeFile(taskPath, serialize(task), { flag: 'wx' })
  } catch (error) {
    return { ...base, outcome: 'process_failure', exitCode: null, signal: null, timedOut: false, cancelled: false, spawnError: `task write failed: ${error?.message ?? String(error)}`, settledBy: 'task_write', wallObservedMs: 0, pid: null, recordWritten: false, recordFile: null, stderrTail: null, startedAtMs, endedAtMs: at() }
  }
  const result = await runChildProcess({
    spawnProcess: spawn, execPath: process.execPath, args: [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--task', taskPath, '--record', recordPath, '--journal', journalPath],
    wallMs, recordWritten: () => existsSync(recordPath), signal: abort.signal,
    onStart: child => console.log(`${base.startedAt} CHILD ${id} pid=${child.pid ?? 'n/a'} wall=${wallMs}ms heap=${envelope.childHeapMb}MB`),
  })
  const endedAtMs = at()
  console.log(`${new Date().toISOString()} END ${id} ${result.outcome} ${(result.wallObservedMs / 1000).toFixed(1)}s${result.spawnError ? ` (${result.spawnError})` : ''}`)
  return { ...base, ...result, recordFile: result.recordWritten ? basename(recordPath) : null, startedAtMs, endedAtMs }
}
/** The parent's reading of one child (verificationProtocol.ts D1aChildReading): its outcome, its record and the parent's own re-hashes. */
const readChild = async (dir, entry) => {
  const reading = { process: entry.outcome, record: null, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } }
  if (entry.outcome !== 'completed' || !entry.recordFile) return reading
  try {
    reading.record = JSON.parse(await readFile(join(dir, entry.recordFile), 'utf8'))
  } catch (error) {
    reading.readError = `record unreadable: ${error?.message ?? String(error)}`
    return reading
  }
  const record = reading.record
  if (record?.materialization?.semantic !== undefined) reading.recomputed.materializationSha256 = sha256(JSON.stringify(record.materialization.semantic))
  if (record?.verification?.semantic !== undefined) reading.recomputed.verificationSha256 = sha256(JSON.stringify(record.verification.semantic))
  return reading
}
const readJournal = async (dir, entry) => {
  try {
    return vp.parseD1aJournal(await readFile(join(dir, entry.journalFile), 'utf8'))
  } catch (error) {
    return { unreadable: `journal unreadable: ${error?.message ?? String(error)}` }
  }
}
const processEntry = entry => ({
  id: entry.id, role: entry.role, runIndex: entry.runIndex, outcome: entry.outcome, exitCode: entry.exitCode, signal: entry.signal, timedOut: entry.timedOut, cancelled: entry.cancelled,
  settledBy: entry.settledBy ?? null, spawnError: entry.spawnError ?? null, pid: entry.pid ?? null, wallMs: entry.wallMs, heapMb: entry.heapMb, nodeFlags: entry.nodeFlags,
  startedAtMs: entry.startedAtMs, endedAtMs: entry.endedAtMs, wallObservedMs: entry.wallObservedMs, recordWritten: entry.recordWritten, recordFile: entry.recordFile,
})

const startObservation = { ...start }
const observedRuns = []
const rawRuns = []
for (let runIndex = 1; runIndex <= envelope.repeat && !abort.signal.aborted; runIndex += 1) {
  const dir = join(runDir, formal.d1cRunDirectoryName(runIndex))
  await mkdir(dir)
  const checkoutBefore = checkoutState()
  const taskOf = (childRole, entrySet) => formal.createD1cFormalTask({
    role: childRole, runIndex, measurementHeadSha: checkout.repositoryHeadSha, registrationFingerprint: read.registration.fingerprint.computed, actualExport,
    registeredExport: read.registeredExport.identity, expectedD0c: read.registeredD0c.identity, runDir: resolve(dir), entrySet,
  })
  const firstEntry = await runChild(dir, 'first', runIndex, taskOf('first', null), envelope.firstChildWallMs)
  const firstReading = await readChild(dir, firstEntry)
  const first = { process: processEntry(firstEntry), reading: firstReading }
  // The fresh process runs only after an intact first process of this run that reached Phase D' (identity matched, Entry set written).
  const firstIssues = formal.d1cRunIntegrityIssues({ runIndex, first, fresh: null, checkoutBefore, checkoutAfter: checkoutBefore }, startObservation)
  const record = firstReading.record
  let fresh = null, freshEntry = null
  if (!abort.signal.aborted && firstIssues.length === 0 && record?.identity?.matched === true && record.verification != null && record.entrySet != null) {
    freshEntry = await runChild(dir, 'fresh', runIndex, taskOf('fresh', { file: record.entrySet.file, firstRecordFile: FIRST_RECORD_FILE, sha256: record.entrySet.sha256, entryFingerprint: record.entrySet.entryFingerprint }), envelope.freshChildWallMs)
    fresh = { process: processEntry(freshEntry), reading: await readChild(dir, freshEntry) }
  }
  const checkoutAfter = checkoutState()
  observedRuns.push({ runIndex, first, fresh, checkoutBefore, checkoutAfter })
  const side = async (entry, reading) => ({
    process: processEntry(entry), readError: reading.readError, recomputed: reading.recomputed,
    // Only what a journal confirmed for a child that wrote no record (never the result of a stage in progress).
    confirmedProgress: reading.record === null ? await readJournal(dir, entry) : null,
    stderrTail: entry.outcome === 'completed' ? null : entry.stderrTail ?? null,
  })
  rawRuns.push({ runIndex, dir: basename(dir), first: await side(firstEntry, firstReading), fresh: freshEntry === null ? null : await side(freshEntry, fresh.reading), checkoutBefore, checkoutAfter })
}

// The one conclusion of the measurement (the derivation script re-derives it from the same raw files and must agree).
const conclusion = formal.concludeD1cMeasurement({ start: startObservation, startRecordMatches, runs: observedRuns })
const output = {
  resultKind: 'global-assignment-d1c-raw-result', formalProtocolVersion: formal.D1C_FORMAL_PROTOCOL_VERSION, status: 'formal', runDir: resolve(runDir),
  start, startRecordMatches, cancelled: abort.signal.aborted, runs: rawRuns, conclusion, totalWallMs: at(),
  claims: 'acceptance only when formalValidity is valid and the candidate outcome is verified; verified is the first structural candidate of a verification budget of one (never a claim about later candidates); no proven_minimum is claimed by the runner',
}
await write(outputPath, output)
console.log(JSON.stringify({
  output: resolve(outputPath), formalValidity: conclusion.formalValidity.status, candidateOutcome: conclusion.candidateOutcome.kind, acceptance: conclusion.acceptance.status,
  runs: conclusion.runs.map(run => `run-${run.runIndex}:${run.conclusion.verdict.kind}:${run.integrityIssues.length}`), resultIntegrityIssues: conclusion.resultIntegrityIssues.length,
  formalIssues: conclusion.formalValidity.issues, exitCode: conclusion.exitCode,
}))
// 0 = a valid formal measurement (accepted or not); 1 = invalid; 2 = invalid with an unmeasured child. The records are kept either way.
process.exitCode = conclusion.exitCode
