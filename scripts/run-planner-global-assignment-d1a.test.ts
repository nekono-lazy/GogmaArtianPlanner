import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
