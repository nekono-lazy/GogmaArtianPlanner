import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MATERIALIZATION_D0B2_DOC, readD0cRegisteredExportIdentity } from '../src/benchmarks/globalAssignment/materializationProtocol'
import { createD1cFormalTask, PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD, registeredD1cExpectation } from '../src/benchmarks/globalAssignment/verificationFormal'
import { d1cRegistrationFingerprint, PLANNER_VERIFICATION_D1B_DOC, readD1cRegisteredD0cIdentity } from '../src/benchmarks/globalAssignment/verificationRegistration'

/*
 * Issue #154 Global Assignment Phase D-1C: the formal runner refuses before it writes anything - usage, duplicate / value-less options, any
 * command-line override (every condition and comparison value comes from the registration), a non-formal mode, an Export that is not the
 * registered one, an output or run dir that exists or is not git-ignored - and spawns no child then. A child given a hand-written task
 * re-applies the formal gate from its own observations and refuses before it computes anything, writing no record. The real Export run is
 * the documented formal measurement, never a test.
 */
const runner = resolve('scripts/run-planner-global-assignment-d1c.mjs')
const source = readFileSync(runner, 'utf8')
const directories: string[] = []
/** Each refusal past the option checks spawns Node, the Vite module loader and git; under a full-suite load that exceeds the 5 s default. */
const SPAWN_TEST_TIMEOUT_MS = 120_000
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function outsideFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d1c-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'export.json') }
}
function ignoredFixture() {
  mkdirSync('.local', { recursive: true })
  const directory = mkdtempSync(join('.local', 'd1c-test-'))
  directories.push(directory)
  return { directory, output: join(directory, 'result.json'), runDir: join(directory, 'run'), input: join(directory, 'export.json') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/**
 * A refusal joins every reason that applies, and a reason can span lines (a failed git command quotes git's own stderr). Each expected
 * reason is checked on its own inside the message (the text after `prefix`), so the assertion holds whatever other reasons the checkout
 * adds (a dirty tree locally, a history without the registration HEAD in a shallow CI checkout).
 */
function expectReasons(stderr: string, prefix: string, reasons: readonly (string | RegExp)[]) {
  const start = stderr.indexOf(prefix)
  expect(start, `no "${prefix}" in: ${stderr}`).toBeGreaterThanOrEqual(0)
  const message = stderr.slice(start + prefix.length)
  for (const reason of reasons) {
    if (typeof reason === 'string') expect(message).toContain(reason)
    else expect(message).toMatch(reason)
  }
}
/** The registration HEAD is in this checkout (a shallow CI checkout has only the tested commit). */
const registrationHeadInCheckout = () => spawnSync('git', ['cat-file', '-e', `${PLANNER_VERIFICATION_D1C_REGISTRATION_HEAD}^{commit}`], { encoding: 'utf8' }).status === 0
const AUDIT_COULD_NOT_RUN = 'The calculation code audit could not run: '

function run(args: string[], nodeFlags: string[] = []) {
  const result = spawnSync(process.execPath, [...nodeFlags, runner, ...args], { encoding: 'utf8', timeout: 110_000 })
  expect(result.error).toBeUndefined()
  return result
}
function expectRefusal(args: string[], message: string | RegExp) {
  const result = run(args)
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(message)
  expect(result.stdout).toBe('')
}
function expectStartRefusal(args: string[], reasons: readonly (string | RegExp)[]) {
  const result = run(args)
  expect(result.status).toBe(1)
  // Nothing was started: no START line, no CHILD line.
  expect(result.stdout).toBe('')
  expectReasons(result.stderr, 'A formal run cannot start: ', reasons)
  // The history audit is never skipped: missing history refuses the run, a complete history raises no audit failure.
  if (registrationHeadInCheckout()) expect(result.stderr).not.toContain(AUDIT_COULD_NOT_RUN)
  else expectReasons(result.stderr, 'A formal run cannot start: ', [AUDIT_COULD_NOT_RUN])
}

describe('Phase D-1C runner script refusals', () => {
  it('prints the usage without --mode, an Export, a run dir or an output, and refuses duplicate and value-less options', () => {
    const { output, runDir, input } = outsideFixture()
    expectRefusal([], /Usage: node scripts\/run-planner-global-assignment-d1c\.mjs --mode formal/)
    expectRefusal(['--export', input, '--run-dir', runDir, '--output', output], /Usage:/)
    expectRefusal(['--mode', 'formal', '--export', input, '--output', output], /Usage:/)
    expectRefusal(['--mode', 'formal', '--mode', 'formal', '--export', input, '--run-dir', runDir, '--output', output], /Duplicate option/)
    expectRefusal(['--mode', 'formal', '--export', input, '--run-dir', runDir, '--output'], /--output needs a value/)
    expectRefusal(['--mode', 'formal', '--export', input, '--run-dir', runDir, '--output', input], /Output must not overwrite the Export\./)
    // A child accepts only its own options.
    expectRefusal(['--role', 'first', '--mode', 'formal', '--export', input], /Unknown child option --mode\./)
    expectRefusal(['--role', 'middle', '--export', input, '--task', 't', '--record', 'r', '--journal', 'j'], /Unknown --role middle\./)
  })

  it('refuses an unregistered Export and outputs outside the git-ignored paths before anything is written, and spawns no child', () => {
    const { directory, output, runDir } = outsideFixture()
    const notRegistered = join(directory, 'not-the-registered-export.json')
    writeFileSync(notRegistered, '{}\n')
    expectStartRefusal(['--mode', 'formal', '--export', notRegistered, '--run-dir', runDir, '--output', output], [
      /Export SHA-256 [0-9a-f]{64} is not the registered [0-9a-f]{64}\./, 'Export file name not-the-registered-export.json is not the registered ',
      `--run-dir ${runDir} is not git-ignored; a formal run writes Entry bodies and raw records only into ignored paths`, `--output ${output} is not git-ignored`,
    ])
    expect(existsSync(runDir)).toBe(false)
    expect(existsSync(output)).toBe(false)
    expect(readdirSync(directory)).toEqual(['not-the-registered-export.json'])
    expect(readFileSync(notRegistered, 'utf8')).toBe('{}\n')
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses every command-line override, a non-formal mode and an existing output, writing nothing', () => {
    const { directory, output, runDir, input } = ignoredFixture()
    writeFileSync(input, '{}\n')
    const formal = ['--mode', 'formal', '--export', input, '--run-dir', runDir, '--output', output]
    // Conditions, envelope, repeat, comparison values and --allow-uncommitted: all overrides of the registration, refused together.
    expectStartRefusal([...formal, '--allow-uncommitted', '--first-wall-ms', '60000', '--fresh-wall-ms', '60000', '--heap-mb', '4096', '--max-plan-steps', '1000', '--repeat', '1',
      '--expected-d0c-semantic-sha256', 'a'.repeat(64), '--expected-d0c-entry-fingerprint', 'fnv1a32:00000000', '--expected-export-sha256', 'b'.repeat(64)], [
      'A formal run takes its conditions and comparison values from the registration only; remove --allow-uncommitted, --first-wall-ms, --fresh-wall-ms, --heap-mb, --max-plan-steps, --repeat, --expected-d0c-semantic-sha256, --expected-d0c-entry-fingerprint, --expected-export-sha256.',
    ])
    expectStartRefusal(['--mode', 'smoke', '--export', input, '--run-dir', runDir, '--output', output], ['remove --mode smoke.'])
    writeFileSync(output, 'exists\n')
    expectStartRefusal(formal, [`--output ${output} already exists; a formal run writes new paths only.`])
    expect(existsSync(runDir)).toBe(false)
    expect(readdirSync(directory).sort()).toEqual(['export.json', 'result.json'])
    expect(readFileSync(output, 'utf8')).toBe('exists\n')
  }, 3 * SPAWN_TEST_TIMEOUT_MS)

  it('a child refuses a hand-written task from its own observations before it computes anything, and writes no record', () => {
    const { directory, input } = ignoredFixture()
    writeFileSync(input, '{}\n')
    const raw = readFileSync(input)
    const actualExport = { fileName: 'export.json', bytes: raw.length, sha256: sha256(raw) }
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    const registeredExport = readD0cRegisteredExportIdentity(readFileSync(MATERIALIZATION_D0B2_DOC, 'utf8')).identity!
    const expectedD0c = readD1cRegisteredD0cIdentity(readFileSync(PLANNER_VERIFICATION_D1B_DOC, 'utf8')).identity!
    const expectation = registeredD1cExpectation()
    const runDir = join(directory, 'run-1')
    mkdirSync(runDir)
    const task = createD1cFormalTask({ role: 'first', runIndex: 1, measurementHeadSha: head, registrationFingerprint: d1cRegistrationFingerprint(), actualExport, registeredExport, expectedD0c, runDir: resolve(runDir), entrySet: null })
    let index = 0
    const runChild = (edited: Record<string, unknown>, nodeFlags = [`--max-old-space-size=${expectation.conditions.envelope.childHeapMb}`], role = 'first') => {
      index += 1
      const taskPath = join(runDir, `task-${index}.json`), recordPath = join(runDir, `record-${index}.json`), journalPath = join(runDir, `journal-${index}.jsonl`)
      writeFileSync(taskPath, JSON.stringify({ ...task, ...edited }))
      const result = run(['--role', role, '--export', input, '--task', taskPath, '--record', recordPath, '--journal', journalPath], nodeFlags)
      expect(result.status).not.toBe(0)
      expect(existsSync(recordPath)).toBe(false)
      // The child started and confirmed nothing else (memory samples aside): no materialization, no identity, no Entry set, no stage.
      expect(readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line).kind).filter(kind => kind !== 'memory')).toEqual(['started'])
      return result.stderr
    }
    const refused = (stderr: string, reasons: readonly (string | RegExp)[]) => {
      // The Export of a hand-written task here is never the registered one, so every refusal names it too.
      expectReasons(stderr, 'The formal child gate refused the task: ', [/Export SHA-256 [0-9a-f]{64} is not the registered [0-9a-f]{64}\./, ...reasons])
      if (registrationHeadInCheckout()) expect(stderr).not.toContain(AUDIT_COULD_NOT_RUN)
      else expectReasons(stderr, 'The formal child gate refused the task: ', [AUDIT_COULD_NOT_RUN])
    }
    expect(runChild({ mode: 'smoke' })).toContain('The formal child gate refused the task: A D-1C child runs formal tasks only (got mode smoke).')
    refused(runChild({ repositoryHeadSha: 'f'.repeat(40) }), [`The child runs at HEAD ${head}, not the task's measurement HEAD ${'f'.repeat(40)}.`])
    refused(runChild({}, undefined, 'fresh'), ['The task is for the first process, not fresh.', 'A fresh task names no Entry set.'])
    refused(runChild({ conditions: { ...task.conditions, verification: { ...task.conditions.verification, researchMaxPlanSteps: 1_000 } } }), ['The task conditions are not the registered conditions.'])
    refused(runChild({ expectedD0c: { ...expectedD0c, entryFingerprint: 'fnv1a32:00000000' } }), ['The task D-0C identity is not the registered one read from HEAD.'])
    refused(runChild({ runDir: resolve(directory) }), [/The task run directory .* is not run-1\./])
    refused(runChild({}, []), ['The child runs without the registered heap envelope --max-old-space-size=8192'])
    expect(readdirSync(runDir).filter(name => name.endsWith('.entry-set.json') || name.startsWith('record-'))).toEqual([])
  }, 8 * SPAWN_TEST_TIMEOUT_MS)

  it('decides the start gate before it writes anything, concludes once and takes its exit code from that conclusion', () => {
    const parent = source.slice(source.indexOf('// ------------------------------------------------------------------ parent'))
    const gate = parent.indexOf('formal.d1cFormalStartGate(')
    const refusal = parent.indexOf('if (!startGate.passed) throw new Error(`A formal run cannot start: ')
    expect(gate).toBeGreaterThan(0)
    expect(refusal).toBeGreaterThan(gate)
    for (const write of ['await mkdir(runDir', 'await write(startPath', 'runChild(dir', 'await write(outputPath']) expect(parent.indexOf(write), write).toBeGreaterThan(refusal)
    // The child gate and the calculation gate come before any input is built or anything is computed.
    const child = source.slice(source.indexOf('// ------------------------------------------------------------------ children'), source.indexOf('// ------------------------------------------------------------------ parent'))
    expect(child.indexOf('formal.d1cFormalChildGateIssues(')).toBeLessThan(child.indexOf('globalResearchInputFromExport('))
    expect(child.indexOf('formal.d1cFormalChildCalculationIssues(')).toBeLessThan(child.indexOf('runner.runMaterializationSmoke('))
    expect(child.indexOf('formal.d1cFreshEntrySetSourceIssues(')).toBeLessThan(child.indexOf('vp.handoffFromEntrySet('))
    // Two complete runs one after another, each in its own directory, the fresh child only after an intact first child of the same run.
    expect(parent).toMatch(/for \(let runIndex = 1; runIndex <= envelope\.repeat && !abort\.signal\.aborted; runIndex \+= 1\)/)
    expect(parent).toMatch(/const dir = join\(runDir, formal\.d1cRunDirectoryName\(runIndex\)\)/)
    expect(parent).toMatch(/if \(!abort\.signal\.aborted && firstIssues\.length === 0 && record\?\.identity\?\.matched === true/)
    expect(parent).toMatch(/const conclusion = formal\.concludeD1cMeasurement\(\{ start: startObservation, startRecordMatches, runs: observedRuns \}\)/)
    expect(parent).toMatch(/process\.exitCode = conclusion\.exitCode/)
    // No retry, no second judgement, no envelope or condition from the command line.
    expect(source).not.toMatch(/retry\(|for \(let attempt|vp\.judgeD1aRun\(|positiveIntegerOption|--first-wall-ms|--heap-mb/)
  })
})
