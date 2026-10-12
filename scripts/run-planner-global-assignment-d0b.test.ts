import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/*
 * Issue #154 Global Assignment Phase D-0B: the materialization runner script refuses before it reads the Export or creates
 * anything (usage, unknown / duplicate / value-less options, a formal run, invalid conditions, an existing output or run dir),
 * reads no oracle, takes no post-hoc argument, and records a child that failed as unmeasured(process_failure) with only the
 * progress its journal confirmed, exiting non-zero (a real parent and a real child over an invalid Export).
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
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--mode', 'later'], /--mode must be smoke/)
    expect(existsSync(runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses a formal run before anything is read or written: D-0B registers no formal condition', () => {
    const { directory, output, runDir } = fixture()
    const exportFile = join(directory, 'export.json')
    writeFileSync(exportFile, '{}\n')
    expectRefusal(['--export', exportFile, '--run-dir', runDir, '--output', output, '--mode', 'formal'], /A formal run cannot start: Phase D-0B registers no formal condition: .*D-0B-2 .*D-0C/)
    expect(readdirSync(directory)).toEqual(['export.json'])
  }, SPAWN_TEST_TIMEOUT_MS)

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
    expect(source).toMatch(/materializationFormalRunIssues\(\)/)
    // Exclusive writes, a synchronous journal, and the D-0B envelope (never the registered B-2A runner or its envelope).
    expect(source).toMatch(/flag: 'wx'/)
    expect(source).toMatch(/appendFileSync\(journalPath/)
    expect(source).toMatch(/from '\.\/planner-global-assignment-d0b-child-process\.mjs'/)
    expect(source).not.toMatch(/b2a/)
    expect(helper).not.toMatch(/globalAssignment|GlobalAssignment|ReachTable|readFile|vite/)
    expect(helper).toMatch(/export function runChildProcess/)
  })
})
