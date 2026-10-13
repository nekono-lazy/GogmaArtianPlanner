import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { globalResearchDependencies } from '../src/benchmarks/plannerGlobalOptimizationResearch'
import { runMaterializationSmoke, type MaterializedEntriesHandoff } from '../src/benchmarks/globalAssignment/materializationRunner'
import { d0cFixtureConditions } from '../src/benchmarks/globalAssignment/materializationFormalTestFixture'
import { ELEMENT_A, ELEMENT_B, materializationScenario, OPEN_GATE } from '../src/benchmarks/globalAssignment/materializationTestFixture'
import { IDEAL_BONUSES, ownedGogma } from '../src/benchmarks/globalAssignment/testFixture'
import {
  compareD0cMaterializationIdentity, concludeD1aRun, createD1aEntrySet, d1aChildIntegrityIssues, d1aCheckoutIntegrityIssues, handoffFromEntrySet,
  materializedEntriesFingerprintOfSemantic, type D1aChildReading,
} from '../src/benchmarks/globalAssignment/verificationProtocol'
import { verifyPlannerCandidate } from '../src/benchmarks/globalAssignment/verify'

/*
 * Issue #154 Global Assignment Phase D-1A: the non-formal Phase D' runner refuses before it writes anything - usage, unknown /
 * duplicate / value-less options, a missing or malformed expected Export hash / D-0C semantic SHA-256 / D-0C Entry fingerprint, an
 * output or run dir that exists or is not git-ignored (Entry bodies are written there), an Export whose hash is not the expected one
 * or that is not the D-0C registered Export - and a child given a hand-written task refuses before it computes anything and writes no
 * record. The real Export run is the documented non-formal smoke, never a test.
 */
const runner = resolve('scripts/run-planner-global-assignment-d1a.mjs')
const directories: string[] = []
/** Each refusal spawns Node and (past the option checks) the Vite module loader; under a full-suite load that exceeds the 5 s default. */
const SPAWN_TEST_TIMEOUT_MS = 120_000
const HASH = 'a'.repeat(64)
const FINGERPRINT = 'fnv1a32:00000000'

/** A directory outside the Repository (never git-ignored there). */
function outsideFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d1a-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'export.json') }
}

/** A directory under the git-ignored `.local/` of the Repository. */
function ignoredFixture() {
  mkdirSync('.local', { recursive: true })
  const directory = mkdtempSync(join('.local', 'd1a-test-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'export.json') }
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

describe('Phase D-1A runner script refusals', () => {
  it('prints the usage, and refuses unknown, duplicate and value-less options and missing or malformed expected values', () => {
    const { output, runDir, input } = outsideFixture()
    const expected = ['--expected-export-sha256', HASH, '--expected-d0c-semantic-sha256', HASH, '--expected-d0c-entry-fingerprint', FINGERPRINT]
    const base = ['--export', input, '--run-dir', runDir, '--output', output]
    expectRefusal([], /Usage:/)
    expectRefusal(['--export', input, '--output', output, ...expected], /Usage:/)
    expectRefusal([...base, ...expected, '--optimum', 'x.json'], /Unknown option --optimum/)
    expectRefusal([...base, ...expected, '--mode', 'formal'], /Unknown option --mode/)
    expectRefusal([...base, ...expected, '--heap-mb', '1', '--heap-mb', '2'], /Duplicate option/)
    expectRefusal([...base, ...expected, '--heap-mb'], /--heap-mb needs a value/)
    expectRefusal(base, /--expected-export-sha256 must name 64 lower-case hex characters/)
    expectRefusal([...base, '--expected-export-sha256', HASH], /--expected-d0c-semantic-sha256 must name 64 lower-case hex characters/)
    expectRefusal([...base, '--expected-export-sha256', HASH, '--expected-d0c-semantic-sha256', HASH], /--expected-d0c-entry-fingerprint must be fnv1a32:<8 hex>/)
    expectRefusal([...base, '--expected-export-sha256', HASH, '--expected-d0c-semantic-sha256', HASH, '--expected-d0c-entry-fingerprint', 'fnv1a32:xyz'], /--expected-d0c-entry-fingerprint must be fnv1a32:<8 hex>/)
    expectRefusal([...base, '--expected-export-sha256', 'A'.repeat(64), '--expected-d0c-semantic-sha256', HASH, '--expected-d0c-entry-fingerprint', FINGERPRINT], /--expected-export-sha256 must name 64 lower-case hex/)
    expect(existsSync(runDir)).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses an output or run dir that exists or is not git-ignored, and an Export that is not the expected or the registered one, writing nothing', () => {
    const expected = ['--expected-export-sha256', HASH, '--expected-d0c-semantic-sha256', HASH, '--expected-d0c-entry-fingerprint', FINGERPRINT]
    const outside = outsideFixture()
    writeFileSync(outside.input, '{}\n')
    expectRefusal(['--export', outside.input, '--run-dir', outside.runDir, '--output', outside.output, ...expected], /--run-dir .* is not git-ignored; the run writes Entry bodies and raw records only into ignored paths/)
    expectRefusal(['--export', outside.output, '--run-dir', outside.runDir, '--output', outside.output, ...expected], /Output must not overwrite the Export/)
    writeFileSync(outside.output, 'existing result')
    expectRefusal(['--export', outside.input, '--run-dir', outside.runDir, '--output', outside.output, ...expected], /Output already exists:/)
    expect(readFileSync(outside.output, 'utf8')).toBe('existing result')
    const ignored = ignoredFixture()
    writeFileSync(ignored.input, '{}\n')
    mkdirSync(join(ignored.directory, 'existing-run'))
    expectRefusal(['--export', ignored.input, '--run-dir', join(ignored.directory, 'existing-run'), '--output', ignored.output, ...expected], /Run dir already exists:/)
    // Past the path checks (git-ignored, new): an Export whose hash is not the expected one, then one that is not the registered D-0C Export.
    expectRefusal(['--export', ignored.input, '--run-dir', ignored.runDir, '--output', ignored.output, ...expected, '--allow-uncommitted'], /Export SHA-256 [0-9a-f]{64} is not the expected a{64}\./)
    const actual = createHash('sha256').update(readFileSync(ignored.input)).digest('hex')
    expectRefusal(['--export', ignored.input, '--run-dir', ignored.runDir, '--output', ignored.output, '--expected-export-sha256', actual, '--expected-d0c-semantic-sha256', HASH, '--expected-d0c-entry-fingerprint', FINGERPRINT, '--allow-uncommitted'],
      /The Export is not the D-0C \(D-0B-2 registered\) Export: /)
    expectRefusal(['--export', ignored.input, '--run-dir', ignored.runDir, '--output', ignored.output, ...expected, '--first-wall-ms', '5', '--allow-uncommitted'], /Invalid envelope: firstChildWallMs must be an integer in 1000\.\.86400000 \(got 5\)\./)
    expect(readdirSync(ignored.directory).sort()).toEqual(['existing-run', 'export.json'])
    expect(readFileSync(ignored.input, 'utf8')).toBe('{}\n')
  }, 2 * SPAWN_TEST_TIMEOUT_MS)

  it('a child refuses a hand-written task (role, protocol, Research maxPlanSteps, HEAD, Export) before it computes anything, and writes no record', () => {
    const { directory, input } = ignoredFixture()
    writeFileSync(input, '{}\n')
    const raw = readFileSync(input)
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    const task = {
      protocolVersion: 'global-assignment-d1a:1', role: 'first', repositoryHeadSha: head, allowUncommitted: true, researchMaxPlanSteps: 20_000, runDir: resolve(directory),
      actualExport: { fileName: 'export.json', bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }, calculationContext: {},
    }
    let index = 0
    const runChild = (role: string, edited: Record<string, unknown>, reason: string | RegExp) => {
      index += 1
      const taskPath = join(directory, `task-${index}.json`), recordPath = join(directory, `record-${index}.json`), journalPath = join(directory, `journal-${index}.jsonl`)
      writeFileSync(taskPath, JSON.stringify({ ...task, ...edited }))
      const result = spawnSync(process.execPath, [runner, '--role', role, '--export', input, '--task', taskPath, '--record', recordPath, '--journal', journalPath], { encoding: 'utf8', timeout: 110_000 })
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(reason)
      expect(existsSync(recordPath)).toBe(false)
      // The child started and confirmed nothing else (memory samples aside): no materialization, no identity, no Entry set, no stage.
      expect(readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line).kind).filter(kind => kind !== 'memory')).toEqual(['started'])
    }
    runChild('first', { role: 'fresh' }, 'The task is for the fresh process, not first.')
    runChild('fresh', { role: 'fresh', protocolVersion: 'global-assignment-d0a2b:1' }, 'Task protocol global-assignment-d0a2b:1 is not global-assignment-d1a:1.')
    runChild('first', { researchMaxPlanSteps: 1_000 }, "The task's Research maxPlanSteps 1000 is not the D-1A condition.")
    runChild('first', { repositoryHeadSha: 'f'.repeat(40) }, `The child runs at HEAD ${head}, not the task's ${'f'.repeat(40)}.`)
    runChild('fresh', { role: 'fresh', actualExport: { ...task.actualExport, bytes: 1 } }, 'The Export differs from the one the parent hashed.')
    runChild('first', {}, /Export|Invalid|schema|JSON/)
    expect(readdirSync(directory).filter(name => name.endsWith('.entry-set.json'))).toEqual([])
  }, 6 * SPAWN_TEST_TIMEOUT_MS)
})

/*
 * PR #253 Required fix: the parent's RESULT for records whose integrity is broken. Child records are written to files the way the
 * children write them (from a synthetic scenario: a real materialization, Phase D' in a first and a fresh "process"), read back and
 * re-hashed with SHA-256 by the runner's readChild() rule, checked and concluded in the runner's order; each anomaly is injected into
 * the files (or the Repository state), and the RESULT fields the runner writes must all say the same thing.
 */
describe('Phase D-1A runner RESULT: integrity failures are never verified', () => {
  const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const HEAD = 'a'.repeat(40)
  const EXPORT = { fileName: 'fixture-export.json', bytes: 10, sha256: 'e'.repeat(64) }
  const REPOSITORY = { repositoryHeadSha: HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false }
  const SPEC = {
    targets: ['a', 'b'] as ('a' | 'b')[],
    owned: [ownedGogma('owned.g1', { seriesSkillId: 'series_skill.fixture.a' })],
    skillIdeal: { [ELEMENT_B]: [7] },
    reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
    window: { skill: 3, gogma: 5, normal: 2 },
  }

  /** Writes the two child records of an intact run (first: materialization + identity + Phase D'; fresh: its own Phase 0 + Phase D'). */
  async function writeRecords() {
    const scene = await materializationScenario(SPEC)
    let tick = 0
    const handoffs: MaterializedEntriesHandoff[] = []
    const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions: d0cFixtureConditions({ projectedSearchScaleGate: OPEN_GATE }) }, {
      now: () => (tick += 1), onMaterializedEntries: handoff => { handoffs.push(handoff) },
    })
    const semanticSha256 = sha256(JSON.stringify(result.semantic))
    const identity = compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected: { semanticSha256, entryFingerprint: materializedEntriesFingerprintOfSemantic(result.semantic)! } })
    const conditions = { researchMaxPlanSteps: 1_000 }
    const first = await verifyPlannerCandidate(scene.input, handoffs[0]!, globalResearchDependencies(scene.engine), conditions, { now: () => (tick += 1) })
    const set = JSON.parse(JSON.stringify(createD1aEntrySet(handoffs[0]!, { repositoryHeadSha: HEAD, export: EXPORT, calculationContext: scene.input.calculationContext, rngEngineVersion: scene.engine.version })))
    const freshScene = await materializationScenario(SPEC)
    const fresh = await verifyPlannerCandidate(freshScene.input, handoffFromEntrySet(set, handoffs[0]!.planningTargetIds), globalResearchDependencies(freshScene.engine), conditions, { now: () => (tick += 1) })
    const base = { protocolVersion: 'global-assignment-d1a:1', repositoryHeadSha: HEAD, exportVerification: { actual: EXPORT, taskMatched: true } }
    const phase0PlanningTargetIds = [...handoffs[0]!.planningTargetIds].sort()
    const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d1a-result-'))
    directories.push(directory)
    const paths = { first: join(directory, 'first.record.json'), fresh: join(directory, 'fresh.record.json') }
    writeFileSync(paths.first, JSON.stringify({ role: 'first', ...base, materialization: { semanticSha256, semantic: result.semantic }, identity, phase0PlanningTargetIds,
      verification: { ...first, semanticSha256: sha256(JSON.stringify(first.semantic)) } }, null, 2) + '\n')
    writeFileSync(paths.fresh, JSON.stringify({ role: 'fresh', ...base, phase0PlanningTargetIds, verification: { ...fresh, semanticSha256: sha256(JSON.stringify(fresh.semantic)) } }, null, 2) + '\n')
    return paths
  }

  /** The runner's readChild() rule over a record file: parse it and re-hash JSON.stringify() of each semantic record it carries. */
  function readChild(process: D1aChildReading['process'], path: string | null): D1aChildReading {
    const reading: D1aChildReading = { process, record: null, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } }
    if (process !== 'completed' || path === null) return reading
    try {
      reading.record = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      reading.readError = `record unreadable: ${(error as Error).message}`
      return reading
    }
    const record = reading.record as { materialization?: { semantic?: unknown }; verification?: { semantic?: unknown } }
    if (record.materialization?.semantic !== undefined) reading.recomputed.materializationSha256 = sha256(JSON.stringify(record.materialization.semantic))
    if (record.verification?.semantic !== undefined) reading.recomputed.verificationSha256 = sha256(JSON.stringify(record.verification.semantic))
    return reading
  }

  /** The runner's order and RESULT fields: both children's issues, the Repository's, the one conclusion. */
  function resultOf(paths: { first: string; fresh: string }, after = REPOSITORY) {
    const expected = { repositoryHeadSha: HEAD, actualExport: EXPORT }
    const firstReading = readChild('completed', paths.first)
    const firstIssues = d1aChildIntegrityIssues('first', firstReading, expected)
    const freshReading = readChild('completed', paths.fresh)
    const integrityIssues = [...firstIssues, ...d1aChildIntegrityIssues('fresh', freshReading, expected), ...d1aCheckoutIntegrityIssues(REPOSITORY, after)]
    const conclusion = concludeD1aRun({ first: firstReading, fresh: freshReading, integrityIssues })
    return { verdict: conclusion.verdict, recordClassification: conclusion.recordClassification, crossProcess: conclusion.crossProcess, postHoc: conclusion.postHoc, integrityIssues: conclusion.integrityIssues, exitCode: conclusion.exitCode }
  }
  const edit = (path: string, change: (record: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const record = JSON.parse(readFileSync(path, 'utf8'))
    change(record)
    writeFileSync(path, JSON.stringify(record, null, 2) + '\n')
  }
  const expectInvalid = (result: ReturnType<typeof resultOf>, cause: RegExp) => {
    expect(result.verdict).toEqual({ kind: 'invalid_run_integrity', issues: result.integrityIssues })
    expect(result.recordClassification).toBe('nonformal_invalid_run_integrity')
    expect(result.integrityIssues.join('\n')).toMatch(cause)
    expect(result.postHoc.operationCount).toMatchObject({ evaluated: false, judgement: 'not_evaluated', proof: 'not_claimed' })
    expect(result.exitCode).toBe(1)
    const text = JSON.stringify(result)
    expect(text).not.toContain('nonformal_planner_verified')
    expect(text).not.toContain('"kind":"verified"')
  }

  it('records an intact run as verified with no integrity issue, and every injected integrity failure as invalid_run_integrity', async () => {
    const intact = await writeRecords()
    const ok = resultOf(intact)
    expect(ok).toMatchObject({ verdict: { kind: 'verified' }, recordClassification: 'nonformal_planner_verified', integrityIssues: [], exitCode: 0, crossProcess: { compared: true, identical: true } })
    expect(ok.postHoc.operationCount).toMatchObject({ evaluated: true, judgement: 'improvement' })

    const cases: [string, (paths: { first: string; fresh: string }) => void, RegExp, typeof REPOSITORY?][] = [
      ['first verification semantic SHA-256', paths => edit(paths.first, record => { record.verification.semantic.planner.planSteps += 1 }), /^first: the recorded verification semantic SHA-256 /m],
      ['fresh verification semantic SHA-256', paths => edit(paths.fresh, record => { record.verification.semanticSha256 = 'f'.repeat(64) }), /^fresh: the recorded verification semantic SHA-256 "f{64}"/m],
      ['materialization semantic SHA-256', paths => edit(paths.first, record => { record.materialization.semantic.window.skill += 1 }), /^first: the recorded materialization semantic SHA-256 /m],
      ['child HEAD', paths => edit(paths.fresh, record => { record.repositoryHeadSha = 'b'.repeat(40) }), /^fresh: the child record's HEAD "b{40}" is not the run's HEAD a{40}\./m],
      ['child role', paths => edit(paths.first, record => { record.role = 'fresh' }), /^first: the child record's role "fresh" is not first\./m],
      ['Repository change during the run', () => {}, /^the Git checkout changed during the run \(HEAD a{40} -> c{40}, clean true -> false/m, { repositoryHeadSha: 'c'.repeat(40), workingTreeClean: false, uncommittedBenchmarkCode: false }],
    ]
    for (const [name, inject, cause, after] of cases) {
      const paths = await writeRecords()
      inject(paths)
      const result = resultOf(paths, after)
      expectInvalid(result, cause)
      // The Planner records themselves still met every condition: the run is invalid, never a Planner failure.
      expect(['planner_rejected', 'objective_mismatch'], name).not.toContain(result.verdict.kind)
    }
    // An unreadable record is an integrity failure too.
    const broken = await writeRecords()
    writeFileSync(broken.fresh, '{"role":"fresh",')
    expectInvalid(resultOf(broken), /^fresh: the child record could not be read \(record unreadable/m)
  }, 180_000)

  it('derives every RESULT field the runner writes from one conclusion, with the integrity issues it found', () => {
    const source = readFileSync(runner, 'utf8')
    // The runner re-hashes each semantic record it reads with the rule replayed above.
    expect(source).toMatch(/reading\.recomputed\.materializationSha256 = sha256\(JSON\.stringify\(record\.materialization\.semantic\)\)/)
    expect(source).toMatch(/reading\.recomputed\.verificationSha256 = sha256\(JSON\.stringify\(record\.verification\.semantic\)\)/)
    expect(source).toMatch(/const firstIssues = vp\.d1aChildIntegrityIssues\('first', firstReading, expectedIdentity\)/)
    expect(source).toMatch(/freshIssues = vp\.d1aChildIntegrityIssues\('fresh', freshReading, expectedIdentity\)/)
    expect(source).toMatch(/const repositoryIssues = vp\.d1aCheckoutIntegrityIssues\(\{ repositoryHeadSha, workingTreeClean, uncommittedBenchmarkCode \}, repositoryState\(\)\)/)
    expect(source).toMatch(/const integrityIssues = \[\.\.\.firstIssues, \.\.\.freshIssues, \.\.\.repositoryIssues\]/)
    expect(source).toMatch(/const conclusion = vp\.concludeD1aRun\(\{ first: firstReading, fresh: freshReading, integrityIssues \}\)/)
    expect(source).toMatch(/verdict: conclusion\.verdict, recordClassification: conclusion\.recordClassification, crossProcess: conclusion\.crossProcess,/)
    expect(source).toMatch(/postHoc: conclusion\.postHoc,/)
    expect(source).toMatch(/integrityIssues: conclusion\.integrityIssues, exitCode: conclusion\.exitCode,/)
    expect(source).toMatch(/process\.exitCode = conclusion\.exitCode/)
    // No second judgement, post hoc reading or exit code path, and no success wording in the fixed claims.
    expect(source).not.toMatch(/vp\.judgeD1aRun\(|vp\.d1aOperationCountReading\(|integrityIssues\.push|process\.exitCode = [12]/)
    expect(source.match(/claims: '[^']*'/)![0]).not.toMatch(/nonformal_planner_verified/)
  })
})
