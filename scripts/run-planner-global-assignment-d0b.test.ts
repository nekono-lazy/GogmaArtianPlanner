import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/*
 * Issue #154 Global Assignment Phase D-0B: the materialization runner script refuses before it reads the Export or creates
 * anything (usage, unknown / duplicate / value-less options, invalid conditions, an existing output or run dir), reads no oracle,
 * takes no post-hoc argument, and records a child that failed as unmeasured(process_failure) with only the progress its journal
 * confirmed, exiting non-zero (a real parent and a real child over an invalid Export). Phase D-0C: a formal run is refused by its
 * start gate before anything is written (an unregistered Export, a missing or foreign command-line hash, any override,
 * --allow-uncommitted, outputs outside the git-ignored paths), and a formal child refuses a hand-written task before it computes
 * anything and writes no record.
 */
const runner = resolve('scripts/run-planner-global-assignment-d0b.mjs')
const source = readFileSync(runner, 'utf8')
const helper = readFileSync(resolve('scripts/planner-global-assignment-d0b-child-process.mjs'), 'utf8')
const directories: string[] = []
/** Each refusal spawns Node and the Vite module loader; under a full-suite load that exceeds the 5 s default. */
const SPAWN_TEST_TIMEOUT_MS = 120_000

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d0b-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'missing-export.json') }
}

function expectRefusal(args: string[], message: string | RegExp) {
  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 110_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(message)
  expect(result.stdout).toBe('')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Phase D-0B runner script refusals', () => {
  it('prints the usage without an Export, a run dir or an output, and refuses unknown, duplicate and value-less options', () => {
    const { output, runDir, input } = fixture()
    expectRefusal([], /Usage:/)
    expectRefusal(['--export', 'x.json', '--output', output], /Usage:/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--optimum', 'x.json'], /Unknown option --optimum/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--delivery-cap', '1', '--delivery-cap', '2'], /Duplicate option/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--gate'], /--gate needs a value/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--mode', 'later'], /--mode must be smoke or formal \(got later\)/)
    expect(existsSync(runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('D-0C: refuses a formal run whose Export, command-line hash, overrides or output paths fail the start gate, before anything is written', () => {
    const { directory, output, runDir } = fixture()
    // The registration gate passes (D-0C enabled it), so the start gate decides: an Export that is not the registered one (name,
    // length, hash), a command-line hash that is not the registered hash, a missing command-line hash, any condition option (an
    // override, --rule and --option-set included), --allow-uncommitted and a run dir / output outside the git-ignored paths.
    const notRegistered = join(directory, 'not-the-registered-export.json')
    writeFileSync(notRegistered, '{}\n')
    const formal = ['--export', notRegistered, '--run-dir', runDir, '--output', output, '--mode', 'formal']
    const hash = ['--expected-export-sha256', 'a'.repeat(64)]
    expectRefusal([...formal, ...hash], /A formal run cannot start: .*--expected-export-sha256 a{64} is not the registered Export SHA-256 [0-9a-f]{64}\. Export SHA-256 [0-9a-f]{64} is not the registered [0-9a-f]{64}\. .*Export file name not-the-registered-export\.json is not the registered /)
    expectRefusal([...formal, ...hash], /--run-dir .* is not git-ignored; a formal run writes only into ignored paths/)
    expectRefusal([...formal, ...hash], /--output .* is not git-ignored/)
    expectRefusal(formal, /A formal run requires --expected-export-sha256 naming the registered Export SHA-256\./)
    expectRefusal([...formal, ...hash, '--node-budget', '5'], /A formal run takes its conditions from the registration only; remove --node-budget\./)
    expectRefusal([...formal, ...hash, '--rule', 'd0a2-v2', '--option-set', 'a2'], /remove --rule, --option-set\./)
    expectRefusal([...formal, ...hash, '--repeat', '1', '--wall-ms', '60000', '--task', 'x.json'], /remove --repeat, --wall-ms, --task\./)
    expectRefusal([...formal, ...hash, '--allow-uncommitted'], /A formal run needs a clean, committed Working Tree \(no --allow-uncommitted\)\./)
    expect(existsSync(runDir)).toBe(false)
    expect(existsSync(output)).toBe(false)
    expect(readdirSync(directory)).toEqual(['not-the-registered-export.json'])
    expect(readFileSync(notRegistered, 'utf8')).toBe('{}\n')
  }, SPAWN_TEST_TIMEOUT_MS)

  it('D-0C: a formal child refuses a hand-written task before it computes anything, and writes no record', async () => {
    const { registeredD0cConditions, readD0cRegisteredExportIdentity, MATERIALIZATION_D0B2_DOC } = await import('../src/benchmarks/globalAssignment/materializationProtocol')
    const { MATERIALIZATION_D0C_REGISTRATION_HEAD } = await import('../src/benchmarks/globalAssignment/materializationFormal')
    const { conditions, envelope } = registeredD0cConditions()
    const registered = readD0cRegisteredExportIdentity(readFileSync(MATERIALIZATION_D0B2_DOC, 'utf8')).identity!
    const { directory } = fixture()
    const exportFile = join(directory, 'export.json')
    writeFileSync(exportFile, '{}\n')
    const raw = readFileSync(exportFile)
    const actualExport = { fileName: 'export.json', bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    const task = {
      protocolVersion: 'global-assignment-d0a2b:1', mode: 'formal', repositoryHeadSha: head, actualExport, conditions, envelope, plannerInputMaxPlanStepsForValidationOnly: 1_000,
      registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, registeredExport: registered,
    }
    let index = 0
    const runChild = (edited: Record<string, unknown>, nodeFlags = [`--max-old-space-size=${envelope.childHeapMb}`]) => {
      index += 1
      const taskPath = join(directory, `task-${index}.json`), recordPath = join(directory, `record-${index}.json`), journalPath = join(directory, `journal-${index}.jsonl`)
      writeFileSync(taskPath, JSON.stringify({ ...task, ...edited }))
      const result = spawnSync(process.execPath, [...nodeFlags, runner, '--role', 'materialize', '--export', exportFile, '--task', taskPath, '--record', recordPath, '--journal', journalPath], { encoding: 'utf8', timeout: 110_000 })
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(existsSync(recordPath)).toBe(false)
      // The child started and confirmed nothing else (memory samples aside): no context, no ReachTable, no Target.
      expect(readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line).kind).filter(kind => kind !== 'memory')).toEqual(['started'])
      return result.stderr
    }
    // The Export of a hand-written task is never the registered one here, so every refusal also names it; each case names its own reason too.
    const gate = /The formal child gate refused the task: /
    expect(runChild({ repositoryHeadSha: 'f'.repeat(40) })).toMatch(new RegExp(`${gate.source}.*The child runs at HEAD ${head}, not the task's measurement HEAD f{40}\\.`))
    expect(runChild({ conditions: { ...conditions, nodeBudget: 5 } })).toMatch(/The formal child gate refused the task: .*The task conditions are not the registered conditions\./)
    expect(runChild({ envelope: { ...envelope, childWallMs: 60_000 } })).toMatch(/The formal child gate refused the task: .*The task envelope is not the registered envelope\./)
    expect(runChild({ registeredExport: { ...registered, bytes: 1 } })).toMatch(/The formal child gate refused the task: .*The task does not carry the registered Export identity read from HEAD\./)
    expect(runChild({})).toMatch(/The formal child gate refused the task: .*Export SHA-256 [0-9a-f]{64} is not the registered [0-9a-f]{64}\./)
    expect(runChild({}, [])).toMatch(/The formal child gate refused the task: .*The child runs without the registered heap envelope --max-old-space-size=4096/)
  }, 6 * SPAWN_TEST_TIMEOUT_MS)

  it('refuses invalid conditions, an existing output or run dir and a malformed hash before anything is created', () => {
    const { directory, output, runDir, input } = fixture()
    const base = ['--export', input, '--run-dir', runDir, '--output', output]
    expectRefusal([...base, '--delivery-cap', '0'], /Invalid conditions: deliveryCap must be a positive integer/)
    expectRefusal([...base, '--gate', '1,2,3'], /--gate must be 4 comma-separated integers/)
    expectRefusal([...base, '--structural-candidate-limit', '11'], /structuralCandidateLimit must be an integer in 1\.\.10/)
    expectRefusal([...base, '--repeat', '3', '--wall-ms', '10'], /childWallMs must be an integer in 1000\.\.86400000.*repeat must be an integer in 1\.\.2/)
    expectRefusal([...base, '--coverage-driven-ordering', 'yes'], /--coverage-driven-ordering must be true or false/)
    expectRefusal([...base, '--expected-export-sha256', 'abc'], /64 hex characters/)
    writeFileSync(output, 'existing result')
    expectRefusal(base, /Output already exists:/)
    expect(readFileSync(output, 'utf8')).toBe('existing result')
    const existing = join(directory, 'existing-run')
    mkdirSync(existing)
    expectRefusal(['--export', input, '--run-dir', existing, '--output', join(directory, 'fresh.json')], /Run dir already exists:/)
    expectRefusal(['--export', output, '--run-dir', runDir, '--output', output], /Output must not overwrite the Export/)
    expect(readdirSync(directory).sort()).toEqual(['existing-run', 'result.json'])
    expect(readdirSync(existing)).toEqual([])
  }, SPAWN_TEST_TIMEOUT_MS)
})

describe('Phase D-0A-2b rule selection (--rule)', () => {
  it('keeps d0a-v1 the default, and refuses an unknown rule, a missing d0a2-v2 gate or budget, and a condition of the other rule', () => {
    const { directory, output, runDir, input } = fixture()
    const base = ['--export', input, '--run-dir', runDir, '--output', output]
    const shape = ['--shape-gate', '10,1000,5,10', '--shape-budget', '1000,1000,1000,10,10,10,10']
    expectRefusal([...base, '--rule', 'd0a2-v3'], /--rule must be d0a-v1 or d0a2-v2 \(got d0a2-v3\)/)
    expectRefusal([...base, '--rule', 'd0a2-v2'], /--rule d0a2-v2 needs --shape-gate D,G,N,W and --shape-budget G,S,W,PN,PS,PR,PK: the shape-constrained method has no default gate or budget/)
    expectRefusal([...base, '--rule', 'd0a2-v2', '--shape-gate', '10,1000,5,10'], /needs --shape-gate D,G,N,W and --shape-budget/)
    expectRefusal([...base, '--rule', 'd0a2-v2', ...shape, '--delivery-cap', '500'], /--delivery-cap is a d0a-v1 condition/)
    expectRefusal([...base, ...shape], /--shape-gate and --shape-budget are d0a2-v2 conditions; pass --rule d0a2-v2/)
    expectRefusal([...base, '--rule', 'd0a2-v2', '--shape-gate', '1,2,3', '--shape-budget', '1,2,3,4,5,6,7'], /--shape-gate must be 4 comma-separated integers/)
    expectRefusal([...base, '--rule', 'd0a2-v2', '--shape-gate', '1,2,3,4', '--shape-budget', '1,2,3'], /--shape-budget must be 7 comma-separated integers/)
    expect(readdirSync(directory)).toEqual([])
  }, SPAWN_TEST_TIMEOUT_MS)

  it('records a d0a2-v2 run with its own protocol, conditions and deferred items, and the child accepts its task', () => {
    const { directory, output, runDir } = fixture()
    const exportFile = join(directory, 'invalid-export.json')
    writeFileSync(exportFile, '{"schemaVersion":13}\n')
    const result = spawnSync(process.execPath, [runner, '--export', exportFile, '--run-dir', runDir, '--output', output, '--allow-uncommitted', '--rule', 'd0a2-v2', '--window', '5,5,5',
      '--shape-gate', '10,1000,5,10', '--shape-budget', '1000,1000,1000,10,10,10,10', '--wall-ms', '100000'], { encoding: 'utf8', timeout: 115_000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(2)
    const written = JSON.parse(readFileSync(output, 'utf8'))
    expect(written).toMatchObject({
      protocolVersion: 'global-assignment-d0a2b:1', mode: 'smoke', formal: false,
      conditions: {
        rule: 'd0a2-v2', window: { normal: 5, gogma: 5, skill: 5 }, routeVerification: 'every_shape_constrained_materialization',
        shapeSearchScaleGate: { maxDepthUpperBound: 10, maxGogmaGeneratedStateUpperBound: 1000, maxNormalForgeCount: 5, maxConversionWalkPositions: 10 },
        shapeSearchBudget: { maxGogmaGeneratedStates: 1000, maxSkillStates: 1000, maxSettledWork: 1000, maxPredictions: { normalArtian: 10, skill: 10, gogmaReset: 10, gogmaKeep: 10 } },
      },
      formalRegistration: { formalRunEnabled: true },
      formalValidity: { status: 'not_applicable' },
    })
    expect(written.conditions).not.toHaveProperty('deliveryCap')
    expect(written.conditions).not.toHaveProperty('searchPolicyPrecheck')
    expect(written.formalRegistration.deferredItems).toEqual(expect.arrayContaining(['shapeSearchScaleGate', 'shapeSearchBudget', 'routeVerification']))
    expect(written.conditionBasis.shapeSearchScaleGate).toMatch(/no default exists/)
    // D-0B-2: the smoke records how it differs from the D-0C registration and that its Export is not the registered one; it stays a smoke.
    expect(written.formalRegistration.d0cRegistration).toMatchObject({
      registeredIn: 'Phase D-0B-2', formalRunEnabled: true, registrationIssues: [], conditionsMatchRegistration: false,
      registeredExport: { doc: 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', issues: [], matches: false },
    })
    expect(written.formalRegistration.d0cRegistration.differencesFromRegistration).toEqual(expect.arrayContaining([
      expect.stringMatching(/^window: /), expect.stringMatching(/^shapeSearchBudget: /), expect.stringMatching(/^reachOptionSet: "global-assignment-reach-options:a1"/),
    ]))
    expect(written.formalRegistration.d0cRegistration.registeredExport.differences.length).toBeGreaterThan(0)
    // The child validated the d0a2-v2 task and its protocol; it stopped at the invalid Export, never at its conditions.
    expect(written.runs[0]).toMatchObject({ status: 'unmeasured', reason: 'process_failure' })
    expect(written.processes[0].stderrTail).not.toMatch(/Invalid task conditions|Task protocol/)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('D-0B-2: a d0a2-v2 smoke with exactly the registered D-0C conditions records no difference from the registration, and stays a smoke', async () => {
    const { registeredD0cConditions } = await import('../src/benchmarks/globalAssignment/materializationProtocol')
    const { conditions, envelope } = registeredD0cConditions()
    const budget = conditions.shapeSearchBudget
    const { directory, output, runDir } = fixture()
    const exportFile = join(directory, 'invalid-export.json')
    writeFileSync(exportFile, '{"schemaVersion":13}\n')
    const result = spawnSync(process.execPath, [runner, '--export', exportFile, '--run-dir', runDir, '--output', output, '--allow-uncommitted', '--rule', 'd0a2-v2', '--option-set', 'a2',
      '--window', [conditions.window.normal, conditions.window.gogma, conditions.window.skill].join(','), '--node-budget', String(conditions.nodeBudget), '--mrv-lookahead', String(conditions.mrvLookahead),
      '--coverage-driven-ordering', String(conditions.coverageDrivenOrdering), '--structural-candidate-limit', String(conditions.structuralCandidateLimit),
      '--gate', Object.values(conditions.projectedSearchScaleGate).join(','), '--shape-gate', Object.values(conditions.shapeSearchScaleGate).join(','),
      '--shape-budget', [budget.maxGogmaGeneratedStates, budget.maxSkillStates, budget.maxSettledWork, budget.maxPredictions.normalArtian, budget.maxPredictions.skill, budget.maxPredictions.gogmaReset, budget.maxPredictions.gogmaKeep].join(','),
      '--wall-ms', String(envelope.childWallMs), '--heap-mb', String(envelope.childHeapMb), '--repeat', '1'], { encoding: 'utf8', timeout: 115_000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(2)
    const written = JSON.parse(readFileSync(output, 'utf8'))
    expect(written).toMatchObject({ mode: 'smoke', formal: false, conditions, formalValidity: { status: 'not_applicable' } })
    // Only the repeat (1 here, registered 2) differs; registered values in smoke mode are still a smoke, never a formal measurement.
    expect(written.formalRegistration.d0cRegistration).toMatchObject({ formalRunEnabled: true, differencesFromRegistration: ['repeat: 1 (registered 2)'], conditionsMatchRegistration: false })
  }, SPAWN_TEST_TIMEOUT_MS)
})

describe('Phase D-0B runner script isolation', () => {
  it('records a child that failed as unmeasured(process_failure) with its journal-confirmed progress and exits non-zero', () => {
    const { directory, output, runDir } = fixture()
    const exportFile = join(directory, 'invalid-export.json')
    writeFileSync(exportFile, '{"schemaVersion":13}\n')
    const result = spawnSync(process.execPath, [runner, '--export', exportFile, '--run-dir', runDir, '--output', output, '--allow-uncommitted', '--window', '5,5,5', '--wall-ms', '100000'], { encoding: 'utf8', timeout: 115_000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(2)
    const written = JSON.parse(readFileSync(output, 'utf8'))
    expect(written).toMatchObject({ mode: 'smoke', formal: false, status: 'smoke', oracleFreeExecution: true, conditions: { window: { normal: 5, gogma: 5, skill: 5 }, searchPolicyPrecheck: true } })
    // A smoke is never a formal measurement, and an unmeasured run has only its journal-confirmed progress as outcome.
    expect(written.formalValidity.status).toBe('not_applicable')
    expect(written.materializationOutcome).toMatchObject({ basis: 'journal_confirmed_progress', verdict: 'unmeasured', candidates: [] })
    expect(written.runs).toHaveLength(1)
    const [run] = written.runs
    expect(run).toMatchObject({ status: 'unmeasured', reason: 'process_failure', semanticSha256: null, recordFile: null })
    // The journal confirms the child started and nothing else; no stage or Target result is inferred.
    expect(run.confirmedProgress).toMatchObject({ started: true, finished: false, context: null, reachTable: null, candidates: [] })
    expect(written.processes[0]).toMatchObject({ outcome: 'process_failure', recordWritten: false })
    expect(written.processes[0].exitCode).not.toBe(0)
    expect(written.determinism).toEqual({ runs: 1, measuredRuns: 0, identical: null, semanticSha256s: [] })
    expect(readdirSync(runDir).sort()).toEqual(['materialize-1.journal.jsonl', 'materialize-1.task.json', 'start.json'])
    // A command-line hash that names another Export is refused before the run dir is created.
    const second = fixture()
    expectRefusal(['--export', exportFile, '--run-dir', second.runDir, '--output', second.output, '--allow-uncommitted', '--expected-export-sha256', 'a'.repeat(64)], /is not the expected/)
    expect(existsSync(second.runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('reads no oracle, takes no post-hoc argument, hard-codes no hash or UUID, and runs no Planner or Trace Replay', () => {
    for (const text of [source, helper]) {
      expect(text).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum/)
      expect(text).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(text).not.toMatch(/FakeRngEngine|createProductionPlan|runPlannerDeterministicSchedule|replayPlannerSearchTrace|verifyGlobalResearchFreshPlan|readVerifiedUpperBound|PlannerConflictResolution/)
    }
    expect(source).toMatch(/new ProductionRngEngine\(\)/)
    expect(source).toMatch(/runMaterializationSmoke\(/)
    expect(source).toMatch(/oracleFreeExecution: true, oracleInformedDesign: true/)
    expect(source).toMatch(/formal: false/)
    // D-0C: one registration gate, one start gate, the child's own gate and CalculationContext check, one validity judgement, the
    // registered Export identity from the committed document, git-ignored outputs, and the registered conditions only.
    expect(source).toMatch(/protocol\.d0cRegistrationGateIssues\(registrationGate\)/)
    expect(source).toMatch(/formal\.d0cFormalStartIssues\(\{/)
    expect(source).toMatch(/formal\.d0cFormalChildGateIssues\(\{/)
    expect(source).toMatch(/formal\.d0cFormalChildCalculationIssues\(\{ calculationContext: input\.calculationContext, rngEngineVersion: engine\.version \}\)/)
    expect(source).toMatch(/formal\.judgeD0cFormalValidity\(\{/)
    expect(source).toMatch(/formal\.summarizeD0cMaterializationOutcome\(\{/)
    expect(source).toMatch(/formal\.inspectMaterializationRecord\(record, expectation\)/)
    expect(source).toMatch(/\['show', source\]/)
    expect(source).toMatch(/\['check-ignore', '-q', path\]/)
    expect(source).toMatch(/\['merge-base', '--is-ancestor', registrationHead, 'HEAD'\]/)
    expect(source).toMatch(/protocol\.registeredD0cConditions\(\)/)
    expect(source).toMatch(/execArgv: process\.execArgv/)
    // The child observes the Repository itself and carries the parent's mode through the task.
    expect(source).toMatch(/const repository = repositoryState\(\)/)
    expect(source).toMatch(/mode: task\.mode/)
    // An invalid formal measurement exits non-zero while keeping its record.
    expect(source).toMatch(/formalValidity\.status === 'invalid'\) process\.exitCode = 1/)
    // Exclusive writes, a synchronous journal, and the D-0B envelope (never the registered B-2A runner or its envelope).
    expect(source).toMatch(/flag: 'wx'/)
    expect(source).toMatch(/appendFileSync\(journalPath/)
    expect(source).toMatch(/from '\.\/planner-global-assignment-d0b-child-process\.mjs'/)
    expect(source).not.toMatch(/b2a/)
    expect(helper).not.toMatch(/globalAssignment|GlobalAssignment|ReachTable|readFile|vite/)
    expect(helper).toMatch(/export function runChildProcess/)
  })
})
