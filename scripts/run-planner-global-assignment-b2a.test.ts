import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/*
 * Issue #154 Global Assignment Phase B-2A: the assignment-only runner script refuses before it reads the Export or
 * creates anything, takes no post-hoc comparison argument, starts no formal run in this Phase, and reads no oracle.
 */
const runner = resolve('scripts/run-planner-global-assignment-b2a.mjs')
const source = readFileSync(runner, 'utf8')
const directories: string[] = []
/** Each refusal spawns Node and, for the formal-mode check, the Vite module loader; under a full-suite load that exceeds the 5 s default. */
const SPAWN_TEST_TIMEOUT_MS = 60_000

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-b2a-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'missing-export.json') }
}

function expectRefusal(args: string[], message: string | RegExp) {
  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 60_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(message)
  expect(result.stdout).toBe('')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Phase B-2A runner script', () => {
  it('prints the usage without an Export, a run dir or an output', () => {
    const { output, runDir } = fixture()
    expectRefusal([], /Usage:/)
    expectRefusal(['--export', 'x.json', '--output', output], /Usage:/)
    expectRefusal(['--export', 'x.json', '--run-dir', runDir], /Usage:/)
    expect(existsSync(runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses an unknown option such as a post-hoc comparison argument, a duplicate option and a value-less option', () => {
    const { output, runDir, input } = fixture()
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--optimum', 'x.json'], /Unknown option --optimum/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--node-budget', '1', '--node-budget', '2'], /Duplicate option/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--node-budget'], /--node-budget needs a value/)
    expect(existsSync(runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses an existing output, an existing run dir and an output equal to the Export before reading the Export', () => {
    const { directory, output, runDir, input } = fixture()
    writeFileSync(output, 'existing result')
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output], /Output already exists:/)
    expect(readFileSync(output, 'utf8')).toBe('existing result')
    expect(existsSync(runDir)).toBe(false)
    const existingRunDir = join(directory, 'existing-run')
    mkdirSync(existingRunDir)
    expectRefusal(['--export', input, '--run-dir', existingRunDir, '--output', join(directory, 'fresh.json')], /Run dir already exists:/)
    expect(existsSync(join(directory, 'fresh.json'))).toBe(false)
    expect(readdirSync(existingRunDir)).toEqual([])
    expectRefusal(['--export', output, '--run-dir', runDir, '--output', output], /Output must not overwrite the Export/)
    expect(readFileSync(output, 'utf8')).toBe('existing result')
    expect(readdirSync(directory).sort()).toEqual(['existing-run', 'result.json'])
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses a formal run in this Phase (the registration gate, before any file is written) and a malformed expected Export hash', () => {
    const { output, runDir, input } = fixture()
    // Phase B-2A keeps formalRun.enabled = false: the registration gate refuses whatever else is passed, before the (here missing) Export is read.
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--mode', 'formal', '--expected-export-sha256', 'a'.repeat(64)], /A formal run cannot start: A formal run is not enabled/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--mode', 'formal'], /A formal run cannot start: A formal run is not enabled/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--expected-export-sha256', 'abc'], /64 hex characters/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output, '--mode', 'later'], /--mode must be smoke or formal/)
    expect(existsSync(runDir)).toBe(false)
    expect(existsSync(output)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('reads no oracle manifest, verifier, RESULT or lower-bound module and hard-codes no hash, UUID or Target ID', () => {
    expect(source).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|--optimum/)
    expect(source).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(source).not.toMatch(/FakeRngEngine|createProductionPlan|runPlannerDeterministicSchedule|replayPlannerSearchTrace|visitPlannerAlternativeCandidates|searchCandidates|readVerifiedUpperBound/)
    expect(source).toMatch(/new ProductionRngEngine\(\)/)
    expect(source).toMatch(/runAssignmentOnly/)
    expect(source).toMatch(/measureRootLowerBound/)
    expect(source).toMatch(/decideWindowTransition/)
    // Every run records both provenance flags (design 11.2) and writes exclusively.
    expect(source).toMatch(/oracleFreeExecution: true, oracleInformedDesign: true/)
    expect(source).toMatch(/flag: 'wx'/)
  })

  it('keeps mode and formal validity apart: no formal boolean, the registration gate before the Export, the registered identity from HEAD, one validity judgement', () => {
    // No `formal: true / false` attribute anywhere: the record carries `mode`, the RESULT carries `formalValidity`.
    expect(source).not.toMatch(/\bformal:\s*(true|false)\b/)
    expect(source).toMatch(/formalRunGateIssues\(gate\)/)
    expect(source).toMatch(/formalStartIssues\(/)
    expect(source).toMatch(/formalChildGateIssues\(/)
    expect(source).toMatch(/judgeFormalValidity\(/)
    expect(source).toMatch(/parseRegisteredExportIdentity\(/)
    expect(source).toMatch(/registeredFormalConditions\(\)/)
    expect(source).toMatch(/\['show', source\]/)
    // The child carries the parent's mode through the task, re-reads the registered identity itself, and observes the Repository itself
    // (clean / committed / on the task's measurement HEAD); the parent only writes into git-ignored paths for a formal run.
    expect(source).toMatch(/mode: task\.mode/)
    expect(source).toMatch(/readRegisteredExport\(protocol\)/)
    expect(source).toMatch(/const repository = repositoryState\(\)/)
    expect(source).toMatch(/taskHeadSha: task\.repositoryHeadSha \?\? null, currentHeadSha: repository\.repositoryHeadSha, workingTreeClean: repository\.workingTreeClean, uncommittedBenchmarkCode: repository\.uncommittedBenchmarkCode/)
    expect(source).toMatch(/\['check-ignore', '-q', path\]/)
    expect(source).toMatch(/repositoryHeadSha, actualExport/)
    // The root-bound record consistency and the aggregated integrity issues reach the validity judgement.
    expect(source).toMatch(/recordConsistent: rootLowerBound\.recordConsistent \?\? null/)
    expect(source).toMatch(/\n {2}integrityIssues,\n\}\)/)
    // An invalid formal measurement exits non-zero while keeping its diagnostics.
    expect(source).toMatch(/formalValidity\.status === 'invalid'\) process\.exitCode = 1/)
    // Children run through the shared envelope module (error / close settle once, timer released).
    expect(source).toMatch(/from '\.\/planner-global-assignment-b2a-child-process\.mjs'/)
    expect(source).toMatch(/runChildProcess\(\{/)
  })

  it('keeps the child process envelope module free of Research identifiers and oracle references', () => {
    const helper = readFileSync(resolve('scripts/planner-global-assignment-b2a-child-process.mjs'), 'utf8')
    expect(helper).not.toMatch(/globalAssignment|GlobalAssignment|ReachTable|ResourceAssignment|plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|readFile|vite/)
    expect(helper).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(helper).toMatch(/export function runChildProcess/)
  })
})
