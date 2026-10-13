// Issue #154 Global Assignment Phase D-0B (Research only). The materialization runner over an explicit external Export
// (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md): Phase 0 context -> Phase A ReachTable -> Phase C-2 coverage-gated
// structural candidate search -> the design 19 G1 / G3 / G4 diagnostics -> the Phase D-0A materialization of the first
// structural candidate(s), in a fresh child process per run under a wall-clock and heap envelope (concurrency 1, no retry,
// no fallback). It never imports into the app, never opens IndexedDB, never runs the Production Planner or Trace Replay,
// passes no upper bound to the structural search, reads no oracle manifest / verifier / RESULT and takes no post-hoc
// comparison argument.
//
// `--mode smoke` (the default) is a non-formal run: every condition is a provisional smoke value recorded with its basis.
//
// Phase D-0A-2b (docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md 11 / 12): `--rule` names the materialization rule. Without it
// the rule is d0a-v1 and the run, its conditions and its records are exactly the D-0B ones. `--rule d0a2-v2` runs the
// shape-constrained method: its gate (`--shape-gate D,G,N,W`: depth upper bound, Gogma generated-state upper bound, Normal
// forges, conversion walk positions) and budget (`--shape-budget G,S,W,PN,PS,PR,PK`: Gogma generated states, Skill states,
// settled work, Normal / Skill / Reset / Keep predictions) have no default and must be named; `--gate` is then the projected
// Candidate Search's gate, and `--delivery-cap` (a d0a-v1 condition) is refused.
//
// Phase A-2 (docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md 19.8): `--option-set a1|a2` names the Phase A option set of either rule.
// Without it the conditions carry no option set and the run is the a1 one every D-0B / D-0A-2b record was produced with;
// `--option-set a2` adds the owned-Gogma current-Ideal lane continuations (G2) and is recorded in the conditions.
//
// Phase D-0B-2 (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md): the D-0C conditions of the rule d0a2-v2 are pre-registered in
// MATERIALIZATION_D0C_PREREGISTRATION. A d0a2-v2 smoke records how its conditions differ from that registration and whether its
// Export is the registered one (the identity block of the D-0B-2 document), and its child records the memory at each Target's
// start and settle.
//
// Phase D-0C (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md): `--mode formal` measures the registered conditions. It takes no
// condition from the command line (every option other than --export, --expected-export-sha256, --run-dir and --output is an
// override and refused, --allow-uncommitted included) and is refused before anything is written unless the registration is
// enabled and complete, the Working Tree is clean and committed, the calculation-related code changed since the registration HEAD
// only in the D-0C formal infrastructure, the registered conditions match the current CalculationContext, the Export is the one
// registered in the committed D-0B-2 document (`git show HEAD:<doc>`; no hash is hard-coded here) and named again by
// --expected-export-sha256, and the run dir and output are new git-ignored paths. Each formal child re-applies that gate from its
// own observations (a hand-written formal task cannot bypass the parent) and checks the CalculationContext and Engine of its input
// before any calculation. Having started in formal mode is not a formal measurement: the RESULT carries `formalValidity`
// (materializationFormal.ts; `valid` only with every provenance and reproducibility check) and, judged apart from it, the
// `materializationOutcome`. An invalid formal run keeps its record and exits non-zero.
//
// Parent:
//   node scripts/run-planner-global-assignment-d0b.mjs --export <Export .json> --run-dir <new dir> --output <new .json>
//     [--mode smoke] [--rule d0a-v1|d0a2-v2] [--option-set a1|a2] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--coverage-driven-ordering true|false]
//     [--structural-candidate-limit N] [--delivery-cap N] [--gate C,G,S,N] [--shape-gate D,G,N,W] [--shape-budget G,S,W,PN,PS,PR,PK]
//     [--wall-ms N] [--heap-mb N] [--repeat N] [--expected-export-sha256 <hex>] [--allow-uncommitted]
//   node scripts/run-planner-global-assignment-d0b.mjs --mode formal --export <registered Export> --expected-export-sha256 <registered hex>
//     --run-dir <new git-ignored dir> --output <new git-ignored .json>
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
const USAGE = `Usage: node ${SCRIPT_PATH} --export <Export .json> --run-dir <new dir> --output <new .json> [--mode smoke] [--rule d0a-v1|d0a2-v2] [--option-set a1|a2] [--window N,G,S] [--node-budget N] [--mrv-lookahead N] [--coverage-driven-ordering true|false] [--structural-candidate-limit N] [--delivery-cap N] [--gate C,G,S,N] [--shape-gate D,G,N,W] [--shape-budget G,S,W,PN,PS,PR,PK] [--wall-ms N] [--heap-mb N] [--repeat N] [--expected-export-sha256 <hex>] [--allow-uncommitted]
   or: node ${SCRIPT_PATH} --mode formal --export <registered Export .json> --expected-export-sha256 <registered hex> --run-dir <new git-ignored dir> --output <new git-ignored .json>`
const KNOWN_OPTIONS = new Set(['--export', '--run-dir', '--output', '--mode', '--rule', '--option-set', '--window', '--node-budget', '--mrv-lookahead', '--coverage-driven-ordering', '--structural-candidate-limit',
  '--delivery-cap', '--gate', '--shape-gate', '--shape-budget', '--wall-ms', '--heap-mb', '--repeat', '--expected-export-sha256', '--allow-uncommitted', '--role', '--task', '--record', '--journal'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => name !== '--allow-uncommitted'))
const OVERRIDE_OPTIONS = ['--option-set', '--window', '--node-budget', '--mrv-lookahead', '--coverage-driven-ordering', '--structural-candidate-limit', '--delivery-cap', '--gate', '--shape-gate', '--shape-budget', '--wall-ms', '--heap-mb', '--repeat']
const RULES = ['d0a-v1', 'd0a2-v2']
/** PlannerInput.options.maxPlanSteps is validated by validatePlannerInput() but no Planner runs here (G12: not a Research maxPlanSteps). */
const PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY = 1_000
const MEMORY_SAMPLE_INTERVAL_MS = 250
const JOURNAL_MEMORY_INTERVAL_MS = 5_000
/** The Repository paths hashed as the benchmark code, checked for uncommitted changes, and (formal) audited since the registration HEAD. */
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

/** The Repository facts a run records and a formal child re-checks on its own (never the parent's self-reported values). */
const repositoryState = () => ({
  repositoryHeadSha: git('rev-parse', 'HEAD'),
  workingTreeClean: git('status', '--porcelain').length === 0,
  uncommittedBenchmarkCode: Boolean(git('diff', 'HEAD', '--', ...CODE_PATHS) || git('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS)),
})
/** The calculation-related code committed since the registration HEAD (formal runs): a git failure is recorded, never read as "no change". */
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
/** Whether `path` is ignored by git (a formal run writes only into ignored paths, so the children still see a clean tree). */
const isGitIgnored = path => { try { execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' }); return true } catch { return false } }
/** The registered Export identity, read from the committed D-0B-2 document (never from the Working Tree, never hard-coded). */
const readRegisteredExportFromHead = protocol => {
  const source = `HEAD:${protocol.MATERIALIZATION_D0B2_DOC}`
  let markdown
  try {
    markdown = execFileSync('git', ['show', source], { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (error) {
    return { source, documentSha256: null, identity: null, issues: [`git show ${source} failed: ${error?.message ?? String(error)}`] }
  }
  const parsed = protocol.readD0cRegisteredExportIdentity(markdown)
  return { source, documentSha256: sha256(markdown), identity: parsed.identity, issues: parsed.issues }
}

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
  // D-0B-2, d0a2-v2 tasks only: the memory at each Target's start and settle and the sampled maximum in between (observed, never semantic).
  const targetMemory = []
  let targetWindow = null
  const sample = () => {
    const usage = process.memoryUsage()
    maxima.samples += 1
    maxima.heapUsed = Math.max(maxima.heapUsed, usage.heapUsed)
    maxima.heapTotal = Math.max(maxima.heapTotal, usage.heapTotal)
    maxima.rss = Math.max(maxima.rss, usage.rss)
    maxima.external = Math.max(maxima.external, usage.external)
    if (targetWindow !== null) {
      targetWindow.samples += 1
      targetWindow.heapUsed = Math.max(targetWindow.heapUsed, usage.heapUsed)
      targetWindow.rss = Math.max(targetWindow.rss, usage.rss)
    }
    if (atMs() - lastJournalMemory >= JOURNAL_MEMORY_INTERVAL_MS) {
      lastJournalMemory = atMs()
      journal({ kind: 'memory', heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, external: usage.external })
    }
  }
  const observeTargetMemory = event => {
    const usage = process.memoryUsage()
    const point = { heapUsed: usage.heapUsed, rss: usage.rss }
    if (event.kind === 'target_started') {
      targetWindow = { candidateIndex: event.candidateIndex, orderIndex: event.orderIndex, started: point, samples: 0, heapUsed: usage.heapUsed, rss: usage.rss }
      return
    }
    if (targetWindow === null || targetWindow.orderIndex !== event.orderIndex) return
    targetMemory.push({
      candidateIndex: targetWindow.candidateIndex, orderIndex: targetWindow.orderIndex, started: targetWindow.started, settled: point,
      sampledMax: { samples: targetWindow.samples, heapUsed: Math.max(targetWindow.heapUsed, usage.heapUsed), rss: Math.max(targetWindow.rss, usage.rss) },
    })
    targetWindow = null
    journal({ kind: 'memory', heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, external: usage.external })
  }
  sample()
  const timer = setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS)
  const server = await createLoader()
  try {
    const task = JSON.parse(await readFile(taskPath, 'utf8'))
    if (!['smoke', 'formal'].includes(task.mode)) throw new Error(`A child runs smoke tasks, and formal tasks only through the formal child gate (got ${String(task.mode)}).`)
    const formalTask = task.mode === 'formal'
    const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
    const conditionIssues = protocol.validateMaterializationRunConditions(task.conditions)
    if (conditionIssues.length > 0) throw new Error(`Invalid task conditions: ${conditionIssues.join(' ')}`)
    const expectedProtocol = protocol.materializationProtocolVersion(task.conditions)
    if (task.protocolVersion !== expectedProtocol) throw new Error(`Task protocol ${String(task.protocolVersion)} is not ${expectedProtocol}.`)
    const formal = formalTask ? await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationFormal.ts') : null
    const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
    const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
    const runner = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
    const raw = await readFile(exportPath)
    const actualExport = { fileName: basename(exportPath), bytes: raw.length, sha256: sha256(raw) }
    if (actualExport.sha256 !== task.actualExport?.sha256 || actualExport.bytes !== task.actualExport?.bytes) throw new Error('The Export differs from the one the parent hashed.')
    // D-0C: a formal child re-applies the whole formal gate from its own observations before it computes anything.
    let formalChildGate = null
    let childHeadSha = null
    if (formal !== null) {
      const repository = repositoryState()
      const calculationAudit = calculationCodeAudit(formal.MATERIALIZATION_D0C_REGISTRATION_HEAD)
      const registeredFromHead = readRegisteredExportFromHead(protocol)
      const gateIssues = formal.d0cFormalChildGateIssues({
        registration: protocol.d0cRegistrationGate(), task,
        repository: { headSha: repository.repositoryHeadSha, workingTreeClean: repository.workingTreeClean, uncommittedBenchmarkCode: repository.uncommittedBenchmarkCode, calculationAudit },
        registeredExportFromHead: { identity: registeredFromHead.identity, issues: registeredFromHead.issues }, actualExport, execArgv: process.execArgv,
      })
      if (gateIssues.length > 0) throw new Error(`The formal child gate refused the task: ${gateIssues.join(' ')}`)
      childHeadSha = repository.repositoryHeadSha
      formalChildGate = {
        issues: [], observedHeadSha: repository.repositoryHeadSha, workingTreeClean: repository.workingTreeClean, uncommittedBenchmarkCode: repository.uncommittedBenchmarkCode,
        calculationAudit: formal.readCalculationCodeAudit(calculationAudit), registeredExport: { source: registeredFromHead.source, documentSha256: registeredFromHead.documentSha256, identity: registeredFromHead.identity },
        execArgv: [...process.execArgv],
      }
    }
    const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), task.plannerInputMaxPlanStepsForValidationOnly)
    const engine = new ProductionRngEngine()
    if (formal !== null) {
      const calculationIssues = formal.d0cFormalChildCalculationIssues({ calculationContext: input.calculationContext, rngEngineVersion: engine.version })
      if (calculationIssues.length > 0) throw new Error(`The formal child gate refused the task: ${calculationIssues.join(' ')}`)
    }
    const dependencies = research.globalResearchDependencies(engine)
    const setupMs = performance.now() - started
    const shapeTask = task.conditions.rule === 'd0a2-v2'
    let yields = 0
    const result = await runner.runMaterializationSmoke(input, dependencies, { conditions: task.conditions }, {
      now: () => performance.now(),
      yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }),
      onProgress: event => {
        journal({ kind: 'progress', event })
        if (shapeTask && (event.kind === 'target_started' || event.kind === 'target_settled')) observeTargetMemory(event)
      },
    })
    clearInterval(timer)
    sample()
    const memory = {
      maxima, heapSizeLimit: getHeapStatistics().heap_size_limit, maxRssKiB: process.resourceUsage().maxRSS, endOfRun: process.memoryUsage(),
      ...(shapeTask ? { targets: targetMemory } : {}),
    }
    await write(recordPath, {
      role, mode: task.mode, protocolVersion: task.protocolVersion,
      exportVerification: { actual: actualExport, taskMatched: true },
      rngEngineVersion: engine.version, calculationContext: input.calculationContext, node: process.version,
      ...(formal !== null ? { repositoryHeadSha: childHeadSha, formalChildGate } : {}),
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
if (!['smoke', 'formal'].includes(mode)) throw new Error(`--mode must be smoke or formal (got ${mode}).`)
const formalMode = mode === 'formal'

const server = await createLoader()
const protocol = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationProtocol.ts')
const formal = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationFormal.ts')
const runnerModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationRunner.ts')
// D-0C: the current calculation authorities a formal run's registered CalculationContext must equal.
let currentAuthorities = null
if (formalMode) {
  const { PRODUCTION_RNG_ENGINE_VERSION } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const { CURRENT_CALCULATION_APP_SCHEMA_VERSION } = await server.ssrLoadModule('/src/domain/models/common.ts')
  const { loadMasterData } = await server.ssrLoadModule('/src/domain/master/loadMasterData.ts')
  const master = loadMasterData()
  if (!master.ok) throw new Error('Master Data failed validation.')
  currentAuthorities = { calculationContext: { gameVersion: master.data.manifest.gameVersion, masterDataVersion: master.data.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION } }
}
await server.close()
const registrationGate = protocol.d0cRegistrationGate()
// The registration gate (formalRun.enabled and a complete registration) refuses a formal run before anything is read or written.
if (formalMode) {
  const gateIssues = protocol.d0cRegistrationGateIssues(registrationGate)
  if (gateIssues.length > 0) throw new Error(`A formal run cannot start: ${gateIssues.join(' ')}`)
}
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const expectedExportSha256 = option('--expected-export-sha256')
if (expectedExportSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedExportSha256)) throw new Error('--expected-export-sha256 must be 64 hex characters.')

/** The non-formal smoke conditions from the command line and the runner defaults (D-0B / D-0A-2b / A-2 / D-0B-2, unchanged). */
function smokeConditions() {
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
  const rule = option('--rule') ?? 'd0a-v1'
  if (!RULES.includes(rule)) throw new Error(`--rule must be ${RULES.join(' or ')} (got ${rule}).`)
  const shapeRule = rule === 'd0a2-v2'
  // Each rule's own conditions; a condition of the other rule is refused, never ignored or converted.
  if (shapeRule && has('--delivery-cap')) throw new Error('--delivery-cap is a d0a-v1 condition; the rule d0a2-v2 runs no Planner Alternative Search.')
  if (!shapeRule && (has('--shape-gate') || has('--shape-budget'))) throw new Error('--shape-gate and --shape-budget are d0a2-v2 conditions; pass --rule d0a2-v2.')
  if (shapeRule && (!has('--shape-gate') || !has('--shape-budget'))) throw new Error('--rule d0a2-v2 needs --shape-gate D,G,N,W and --shape-budget G,S,W,PN,PS,PR,PK: the shape-constrained method has no default gate or budget.')
  const optionSetRaw = option('--option-set')
  if (optionSetRaw !== undefined && !Object.hasOwn(protocol.MATERIALIZATION_REACH_OPTION_SETS, optionSetRaw)) throw new Error(`--option-set must be ${Object.keys(protocol.MATERIALIZATION_REACH_OPTION_SETS).join(' or ')} (got ${optionSetRaw}).`)
  // Absent: no field, the a1 option set of every D-0B / D-0A-2b record. Named: the full version string, recorded in the conditions.
  const optionSetCondition = optionSetRaw === undefined ? {} : { reachOptionSet: protocol.MATERIALIZATION_REACH_OPTION_SETS[optionSetRaw] }
  const windowValues = integerList('--window', 3, null)
  const gateValues = integerList('--gate', 4, null)
  const shapeGateValues = integerList('--shape-gate', 4, null)
  const shapeBudgetValues = integerList('--shape-budget', 7, null)
  const orderingRaw = option('--coverage-driven-ordering')
  if (orderingRaw !== undefined && !['true', 'false'].includes(orderingRaw)) throw new Error(`--coverage-driven-ordering must be true or false (got ${orderingRaw}).`)
  const searchScaleGate = gateValues === null ? defaults.conditions.searchScaleGate
    : { maxConversionPositions: gateValues[0], maxGogmaLegalWidth: gateValues[1], maxSkillLegalWidth: gateValues[2], maxNormalForgeCount: gateValues[3] }
  const shared = {
    window: windowValues === null ? defaults.conditions.window : { normal: windowValues[0], gogma: windowValues[1], skill: windowValues[2] },
    nodeBudget: positiveIntegerOption('--node-budget', defaults.conditions.nodeBudget),
    mrvLookahead: positiveIntegerOption('--mrv-lookahead', defaults.conditions.mrvLookahead),
    coverageDrivenOrdering: orderingRaw === undefined ? defaults.conditions.coverageDrivenOrdering : orderingRaw === 'true',
    structuralCandidateLimit: positiveIntegerOption('--structural-candidate-limit', defaults.conditions.structuralCandidateLimit),
  }
  const conditions = shapeRule
    ? {
      rule, ...shared,
      projectedSearchScaleGate: searchScaleGate,
      shapeSearchScaleGate: { maxDepthUpperBound: shapeGateValues[0], maxGogmaGeneratedStateUpperBound: shapeGateValues[1], maxNormalForgeCount: shapeGateValues[2], maxConversionWalkPositions: shapeGateValues[3] },
      shapeSearchBudget: {
        maxGogmaGeneratedStates: shapeBudgetValues[0], maxSkillStates: shapeBudgetValues[1], maxSettledWork: shapeBudgetValues[2],
        maxPredictions: { normalArtian: shapeBudgetValues[3], skill: shapeBudgetValues[4], gogmaReset: shapeBudgetValues[5], gogmaKeep: shapeBudgetValues[6] },
      },
      routeVerification: 'every_shape_constrained_materialization',
      ...optionSetCondition,
    }
    : {
      ...shared,
      deliveryCap: positiveIntegerOption('--delivery-cap', defaults.conditions.deliveryCap),
      searchScaleGate,
      searchPolicyPrecheck: true,
      ...optionSetCondition,
    }
  const envelope = {
    childWallMs: positiveIntegerOption('--wall-ms', defaults.envelope.childWallMs),
    childHeapMb: positiveIntegerOption('--heap-mb', defaults.envelope.childHeapMb),
    repeat: positiveIntegerOption('--repeat', defaults.envelope.repeat),
  }
  const conditionIssues = [...protocol.validateMaterializationRunConditions(conditions), ...protocol.validateMaterializationEnvelope(envelope)]
  if (conditionIssues.length > 0) throw new Error(`Invalid conditions: ${conditionIssues.join(' ')}`)
  const smokeOverrides = OVERRIDE_OPTIONS.filter(has)
  const basisOf = (name, key) => has(name) ? `non-formal smoke value from ${name}` : `non-formal smoke runner default: ${protocol.MATERIALIZATION_D0B_SMOKE_DEFAULTS[key].basis}`
  const sharedBasis = {
    window: basisOf('--window', 'window'), nodeBudget: basisOf('--node-budget', 'nodeBudget'), mrvLookahead: basisOf('--mrv-lookahead', 'mrvLookahead'),
    coverageDrivenOrdering: basisOf('--coverage-driven-ordering', 'coverageDrivenOrdering'), structuralCandidateLimit: basisOf('--structural-candidate-limit', 'structuralCandidateLimit'),
    ...(optionSetRaw === undefined ? {} : { reachOptionSet: `non-formal smoke value from --option-set ${optionSetRaw} (the Phase A-2 option set; D-0B-2 registers the formal one)` }),
  }
  const envelopeBasis = { childWallMs: basisOf('--wall-ms', 'childWallMs'), childHeapMb: basisOf('--heap-mb', 'childHeapMb'), repeat: basisOf('--repeat', 'repeat') }
  const conditionBasis = shapeRule
    ? {
      rule: 'Phase D-0A-2b rule d0a2-v2 named by --rule (design D0A2 11): continuation and non-continuous shapes by the shape-constrained method, continuous shapes projected first; no Planner Alternative Search.',
      ...sharedBasis,
      projectedSearchScaleGate: has('--gate') ? 'non-formal smoke value from --gate (the projected Candidate Search gate)' : `non-formal smoke runner default of the projected Candidate Search gate (the D-0B gate value): ${protocol.MATERIALIZATION_D0B_SMOKE_DEFAULTS.searchScaleGate.basis}`,
      shapeSearchScaleGate: 'non-formal smoke value from --shape-gate (no default exists; D-0B-2 registers the formal value)',
      shapeSearchBudget: 'non-formal smoke value from --shape-budget (no default exists; D-0B-2 registers the formal value)',
      routeVerification: 'Phase D-0A-2b fixed rule (design D0A2 9.3 / 13 #7): the independent Route checks run on every shape-constrained materialization.',
      ...envelopeBasis,
    }
    : {
      ...sharedBasis,
      deliveryCap: basisOf('--delivery-cap', 'deliveryCap'), searchScaleGate: basisOf('--gate', 'searchScaleGate'),
      searchPolicyPrecheck: 'Phase D-0B fixed rule (design 19.3 G1): a Search-policy shape is classified not_executed(search_policy_shape) before any Search.',
      ...envelopeBasis,
    }
  return { rule, shapeRule, optionSetRaw, conditions, envelope, smokeOverrides, conditionBasis }
}

/** The formal conditions: the registration only (registeredD0cConditions()); every other command-line option is an override. */
function formalConditions() {
  const { conditions, envelope } = protocol.registeredD0cConditions()
  const conditionIssues = [...protocol.validateMaterializationRunConditions(conditions), ...protocol.validateMaterializationEnvelope(envelope)]
  if (conditionIssues.length > 0) throw new Error(`A formal run cannot start: the registered conditions are invalid: ${conditionIssues.join(' ')}`)
  const basis = 'registered condition (MATERIALIZATION_D0C_PREREGISTRATION, Phase D-0B-2)'
  const conditionBasis = Object.fromEntries([...Object.keys(conditions), ...Object.keys(envelope)].map(key => [key, basis]))
  const overrideOptions = flags.filter(flag => !formal.MATERIALIZATION_D0C_FORMAL_OPTIONS.includes(flag) && flag !== '--allow-uncommitted')
  const optionSetRaw = Object.keys(protocol.MATERIALIZATION_REACH_OPTION_SETS).find(key => protocol.MATERIALIZATION_REACH_OPTION_SETS[key] === conditions.reachOptionSet)
  return { rule: conditions.rule, shapeRule: true, optionSetRaw, conditions, envelope, overrideOptions, conditionBasis }
}

const selected = formalMode ? formalConditions() : smokeConditions()
const { rule, shapeRule, optionSetRaw, conditions, envelope, conditionBasis } = selected

const { repositoryHeadSha, workingTreeClean, uncommittedBenchmarkCode } = repositoryState()
if (!formalMode && uncommittedBenchmarkCode && !has('--allow-uncommitted')) throw new Error('Commit the benchmark code before a run, or pass --allow-uncommitted for a non-formal smoke.')
const codeHash = createHash('sha256')
for (const file of git('ls-files', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')

const rawExport = await readFile(exportPath)
const actualExport = { fileName: basename(exportPath), bytes: rawExport.length, sha256: sha256(rawExport) }
const cliMatched = expectedExportSha256 === undefined ? null : actualExport.sha256 === expectedExportSha256.toLowerCase()

// D-0C: the whole formal start gate is one pure decision (materializationFormal.ts); the children re-apply it from their own observations.
const calculationAudit = formalMode ? calculationCodeAudit(formal.MATERIALIZATION_D0C_REGISTRATION_HEAD) : null
const registeredFromHead = formalMode ? readRegisteredExportFromHead(protocol) : null
let startIssues = null
if (formalMode) {
  startIssues = formal.d0cFormalStartIssues({
    registration: registrationGate,
    repository: { workingTreeClean, uncommittedBenchmarkCode, calculationAudit },
    allowUncommitted: has('--allow-uncommitted'), overrideOptions: selected.overrideOptions, cliExpectedSha256: expectedExportSha256 ?? null,
    registeredExport: { identity: registeredFromHead.identity, issues: registeredFromHead.issues }, actualExport,
    outputPaths: [{ option: '--run-dir', path: runDir, gitIgnored: isGitIgnored(runDir) }, { option: '--output', path: outputPath, gitIgnored: isGitIgnored(outputPath) }],
    currentAuthorities,
  })
  if (startIssues.length > 0) throw new Error(`A formal run cannot start: ${startIssues.join(' ')}`)
} else if (cliMatched === false) throw new Error(`Export SHA-256 ${actualExport.sha256} is not the expected ${expectedExportSha256}.`)

const docPath = protocol.MATERIALIZATION_D0B_DOC
// D-0B-2: a d0a2-v2 smoke records how its conditions differ from the D-0C registration and whether its Export is the registered one
// (the identity block of the D-0B-2 document in the working tree). Neither changes the run.
const d0cRegistration = async () => {
  const registrationDoc = protocol.MATERIALIZATION_D0B2_DOC
  let registeredExport
  if (!existsSync(registrationDoc)) registeredExport = { doc: registrationDoc, documentSha256: null, identity: null, issues: ['the D-0B-2 document is not in the working tree'], differences: null, matches: null }
  else {
    const text = await readFile(registrationDoc, 'utf8')
    const parsed = protocol.readD0cRegisteredExportIdentity(text)
    const differences = parsed.identity === null ? null : protocol.d0cExportIdentityDifferences(actualExport, parsed.identity)
    registeredExport = { doc: registrationDoc, documentSha256: sha256(text), identity: parsed.identity, issues: parsed.issues, differences, matches: differences === null ? null : differences.length === 0 }
  }
  const differencesFromRegistration = protocol.differencesFromD0cRegistration(conditions, envelope)
  return {
    registeredIn: protocol.MATERIALIZATION_D0C_PREREGISTRATION.registeredIn, formalRunEnabled: protocol.MATERIALIZATION_D0C_PREREGISTRATION.formalRun.enabled,
    registrationIssues: protocol.materializationD0cRegistrationIssues(), differencesFromRegistration, conditionsMatchRegistration: differencesFromRegistration.length === 0, registeredExport,
  }
}
const machine = { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() }
const launchedAt = new Date().toISOString()
const protocolVersion = protocol.materializationProtocolVersion(conditions)
const differencesFromRegistration = protocol.differencesFromD0cRegistration(conditions, envelope)
const registeredMatched = registeredFromHead === null || registeredFromHead.identity === null ? null : protocol.d0cExportIdentityDifferences(actualExport, registeredFromHead.identity).length === 0
const provenance = formalMode
  ? {
    protocolVersion, phase: formal.MATERIALIZATION_D0C_PHASE, mode,
    nature: 'Research: formal D-0C measurement of the D-0B-2 registered conditions (formalValidity decides whether it counts); not a Production Plan, not Planner-verified, no Trace Replay',
    oracleFreeExecution: true, oracleInformedDesign: true,
    repositoryHeadSha, registrationHead: formal.MATERIALIZATION_D0C_REGISTRATION_HEAD, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
    calculationAudit: formal.readCalculationCodeAudit(calculationAudit),
    registrationDoc: { source: registeredFromHead.source, sha256: registeredFromHead.documentSha256 },
    runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
    exportVerification: {
      actual: actualExport, cliExpectedSha256: expectedExportSha256?.toLowerCase() ?? null, cliMatched,
      registeredSource: registeredFromHead.source, registered: registeredFromHead.identity, registeredIssues: registeredFromHead.issues, registeredMatched,
    },
    plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
    conditions, envelope: { ...envelope, concurrency: protocol.MATERIALIZATION_D0C_PREREGISTRATION.concurrency, retry: protocol.MATERIALIZATION_D0C_PREREGISTRATION.retry },
    conditionBasis, overrideOptions: selected.overrideOptions,
    formalRegistration: {
      registeredIn: protocol.MATERIALIZATION_D0C_PREREGISTRATION.registeredIn, formalRunEnabled: registrationGate.formalRunEnabled,
      enabledBy: protocol.MATERIALIZATION_D0C_PREREGISTRATION.formalRun.enabledBy, registrationIssues: registrationGate.registrationIssues,
      registeredItemKeys: protocol.d0cRegisteredItemKeys(), registeredConditionsSha256: sha256(JSON.stringify(protocol.registeredD0cConditions())),
      differencesFromRegistration, conditionsMatchRegistration: differencesFromRegistration.length === 0, startIssues,
    },
    launchedAt, machine,
  }
  : {
    protocolVersion, phase: protocol.MATERIALIZATION_D0B_PHASE, mode, formal: false,
    nature: 'Research: non-formal D-0B smoke; not a Production Plan, not Planner-verified, no Trace Replay',
    oracleFreeExecution: true, oracleInformedDesign: true,
    repositoryHeadSha, baseMain: protocol.MATERIALIZATION_D0B_BASE_MAIN, workingTreeClean, uncommittedBenchmarkCode, benchmarkCodeSha256,
    researchDoc: existsSync(docPath) ? { file: docPath, sha256: sha256(await readFile(docPath)) } : { file: docPath, sha256: null },
    runnerScript: SCRIPT_PATH, node: process.version, v8: process.versions.v8,
    exportVerification: { actual: actualExport, cliExpectedSha256: expectedExportSha256?.toLowerCase() ?? null, cliMatched },
    plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
    conditions, envelope: { ...envelope, concurrency: 1, retry: 'none' }, conditionBasis, smokeOverrides: selected.smokeOverrides,
    formalRegistration: shapeRule
      ? { formalRunEnabled: registrationGate.formalRunEnabled, deferredItems: [...protocol.MATERIALIZATION_D0A2B_REGISTRATION_ITEMS], deferredTo: 'pre-registered in D-0B-2 (MATERIALIZATION_D0C_PREREGISTRATION); measured formally with --mode formal (Phase D-0C); a smoke is never a formal measurement', d0cRegistration: await d0cRegistration() }
      : { formalRunEnabled: registrationGate.formalRunEnabled, deferredItems: [...protocol.MATERIALIZATION_D0B2_REGISTRATION_ITEMS], deferredTo: 'D-0B-2 (pre-registration), D-0C (formal measurement of the rule d0a2-v2 only)' },
    launchedAt, machine,
  }

await mkdir(runDir, { recursive: true })
const startPath = join(runDir, 'start.json')
await write(startPath, provenance)
await chmod(startPath, 0o444).catch(() => {})
console.log(`${launchedAt} START mode=${mode} head=${repositoryHeadSha.slice(0, 12)} clean=${workingTreeClean} uncommittedCode=${uncommittedBenchmarkCode} export=${actualExport.sha256.slice(0, 8)} window=${conditions.window.normal}/${conditions.window.gogma}/${conditions.window.skill} nodeBudget=${conditions.nodeBudget} candidates=${conditions.structuralCandidateLimit} rule=${rule} optionSet=${optionSetRaw ?? "a1(default)"} ${shapeRule ? `projectedGate=${Object.values(conditions.projectedSearchScaleGate).join(",")} shapeGate=${Object.values(conditions.shapeSearchScaleGate).join(",")} ${formalMode ? `registeredExport=${registeredMatched} startGate=passed` : `matchesD0cRegistration=${provenance.formalRegistration.d0cRegistration.conditionsMatchRegistration} registeredExport=${provenance.formalRegistration.d0cRegistration.registeredExport.matches}`}` : `deliveryCap=${conditions.deliveryCap} gate=${Object.values(conditions.searchScaleGate).join(",")}`}`)

// A parent interrupt kills the running child and records it as cancelled (never as a materialization outcome).
const abort = new AbortController()
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { console.log(`${new Date().toISOString()} ${name}: cancelling the running child`); abort.abort() })

const runChild = async id => {
  const taskPath = join(runDir, `${id}.task.json`), recordPath = join(runDir, `${id}.record.json`), journalPath = join(runDir, `${id}.journal.jsonl`)
  const startedAt = new Date().toISOString(), freeMemoryAtStart = freemem()
  const nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]
  const base = { id, wallMs: envelope.childWallMs, heapMb: envelope.childHeapMb, startedAt, nodeFlags, freeMemoryAtStart, taskFile: basename(taskPath), journalFile: basename(journalPath) }
  const task = {
    protocolVersion, mode, repositoryHeadSha, actualExport, conditions, envelope, plannerInputMaxPlanStepsForValidationOnly: PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY,
    ...(formalMode ? { registrationHead: formal.MATERIALIZATION_D0C_REGISTRATION_HEAD, registeredExport: registeredFromHead.identity } : {}),
  }
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
const measuredSemantics = []
let firstUnmeasuredProgress = null
const expectation = { mode, protocolVersion, actualExport, repositoryHeadSha }
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
  const inspection = record === null ? null : formal.inspectMaterializationRecord(record, expectation)
  if (entry.outcome === 'completed' && record && inspection.complete) {
    const consistent = inspection.consistent
    if (!consistent) integrityIssues.push(`${entry.id}: the child record disagrees with the parent (mode / protocol / Export)`)
    if (formalMode) for (const issue of inspection.issues.filter(issue => !/^The record disagrees with the parent/.test(issue))) integrityIssues.push(`${entry.id}: ${issue}`)
    for (const issue of record.semantic.integrityIssues) integrityIssues.push(`${entry.id}: ${issue}`)
    measuredSemantics.push(record.semantic)
    runs.push({ id: entry.id, status: 'measured', reason: null, recordFile: entry.recordFile, recordComplete: inspection.complete, recordConsistent: consistent,
      childGatePassed: inspection.childGatePassed, calculationContextMatched: inspection.calculationContextMatched, ...(formalMode ? { recordHeadSha: record.repositoryHeadSha } : {}),
      semanticSha256: sha256(JSON.stringify(record.semantic)), semanticIntegrityIssues: [...record.semantic.integrityIssues],
      rngEngineVersion: record.rngEngineVersion, calculationContext: record.calculationContext,
      summary: runnerModule.summarizeMaterializationRun(record.semantic), observed: record.observed, memory: { maxima: record.memory.maxima, maxRssKiB: record.memory.maxRssKiB, heapSizeLimit: record.memory.heapSizeLimit } })
  } else {
    // Not completed: unmeasured with the reason the envelope observed, and only what the journal confirmed (never the result of the Target in progress).
    const reason = entry.outcome === 'completed' ? 'process_failure' : entry.outcome
    const detail = recordError ?? entry.spawnError ?? (inspection !== null && !inspection.complete ? inspection.issues.join(' ') : `child ${entry.outcome} (exit ${entry.exitCode}, signal ${entry.signal})`)
    if (firstUnmeasuredProgress === null && journal.unreadable === undefined) firstUnmeasuredProgress = journal
    runs.push({ id: entry.id, status: 'unmeasured', reason, detail, recordFile: entry.recordFile, recordComplete: inspection?.complete ?? null, recordConsistent: null,
      childGatePassed: null, calculationContextMatched: null, semanticSha256: null, semanticIntegrityIssues: [], confirmedProgress: journal })
  }
}

const measured = runs.filter(run => run.status === 'measured')
const determinism = { runs: runs.length, measuredRuns: measured.length, identical: measured.length >= 2 ? new Set(measured.map(run => run.semanticSha256)).size === 1 : null, semanticSha256s: measured.map(run => run.semanticSha256) }
if (determinism.identical === false) integrityIssues.push('semantic records of the repeated runs differ')
// D-0C: the Repository a formal run measured must not have changed while its children ran.
if (formalMode) {
  const after = repositoryState()
  if (after.repositoryHeadSha !== repositoryHeadSha || !after.workingTreeClean || after.uncommittedBenchmarkCode) integrityIssues.push(`the Repository changed during the formal run (HEAD ${after.repositoryHeadSha}, clean ${after.workingTreeClean}, uncommitted code ${after.uncommittedBenchmarkCode})`)
}
// The materialization outcome is judged apart from the formal validity: a measured stop is a measured outcome, never success.
const materializationOutcome = formal.summarizeD0cMaterializationOutcome({ measured: measuredSemantics, unmeasuredProgress: measuredSemantics.length === 0 ? firstUnmeasuredProgress : null })
// Having started in formal mode is not a formal measurement: judgeD0cFormalValidity() decides (smoke -> not_applicable).
const formalValidity = formal.judgeD0cFormalValidity({
  mode, registration: { ...registrationGate, requiredRuns: protocol.MATERIALIZATION_D0C_PREREGISTRATION.repeat.value },
  provenance: {
    startIssues, measurementHeadSha: repositoryHeadSha, benchmarkCodeSha256, workingTreeClean, uncommittedBenchmarkCode,
    overrideOptions: formalMode ? selected.overrideOptions : selected.smokeOverrides, differencesFromRegistration,
    exportVerification: { registeredMatched, cliMatched }, calculationAudit: calculationAudit ?? { registrationHead: formal.MATERIALIZATION_D0C_REGISTRATION_HEAD, registrationHeadIsAncestor: false, changedFiles: [], error: 'not audited (smoke)' },
  },
  runs: runs.map(run => ({ id: run.id, status: run.status, reason: run.reason, semanticSha256: run.semanticSha256, recordComplete: run.recordComplete, recordConsistent: run.recordConsistent,
    childGatePassed: run.childGatePassed, calculationContextMatched: run.calculationContextMatched, integrityIssues: run.semanticIntegrityIssues })),
  determinism: { identical: determinism.identical },
  // The aggregated issues as finally recorded: a formal run with any of them is invalid (valid => integrityIssues is empty).
  integrityIssues,
})
const output = {
  ...provenance, runDir: resolve(runDir), status: mode, formalValidity, materializationOutcome,
  runs, determinism, processes, integrityIssues, totalWallMs: performance.now() - phaseStarted,
  claims: 'none: no verified / best_found / proven_minimum, and all_materialized is not a Plan (Phase D\' is not run)',
}
await write(outputPath, output)
console.log(JSON.stringify({ output: resolve(outputPath), mode, formalValidity: formalValidity.status, materialization: materializationOutcome.verdict, runs: runs.map(run => `${run.id}:${run.status}:${run.status === 'measured' ? run.summary.outcome.kind : run.reason}`),
  classifications: measured[0]?.summary.candidates.map(candidate => `${candidate.classification}:${candidate.materializedTargetCount}/${candidate.targetCount}`) ?? [], determinism: determinism.identical, integrityIssues, formalIssues: formalValidity.issues }))
// An invalid formal measurement or an integrity issue exits 1 (the record is kept); a smoke run its envelope stopped is unmeasured with exit code 2.
if (integrityIssues.length > 0 || formalValidity.status === 'invalid') process.exitCode = 1
else if (runs.some(run => run.status === 'unmeasured')) process.exitCode = 2
