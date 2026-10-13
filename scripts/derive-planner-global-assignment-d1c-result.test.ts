import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { concludeD1cMeasurement } from '../src/benchmarks/globalAssignment/verificationFormal'
import { collectD1cRecordIdentifiers } from '../src/benchmarks/globalAssignment/verificationFormalResult'
import { d1cFixture, type D1cFixture, type D1cFixtureParts } from '../src/benchmarks/globalAssignment/verificationFormalTestFixture'

/*
 * Issue #154 Global Assignment Phase D-1C: the public RESULT derivation script over raw files written the way the runner writes them
 * (start record, two run directories of first / fresh records and the Entry set, the raw RESULT), with SHA-256 as the semantic hash.
 * The raw RESULT's conclusion is the one the registered expectation gives these synthetic records (an invalid formal measurement, since
 * the synthetic conditions are not the registered ones), so the script runs exactly as on a real run: it re-derives that conclusion,
 * writes a minimized public RESULT once, checks it, and refuses tampered raw sources without writing.
 */
const script = resolve('scripts/derive-planner-global-assignment-d1c-result.mjs')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const directories: string[] = []
const SPAWN_TEST_TIMEOUT_MS = 120_000
let fixture: D1cFixture
beforeAll(async () => { fixture = await d1cFixture({ hash: sha256 }) }, 120_000)
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Writes the raw files of a measurement and returns their paths (the raw RESULT's conclusion is the registered expectation's). */
function writeRaw(edit: (parts: D1cFixtureParts) => void = () => {}) {
  const parts = fixture.parts()
  edit(parts)
  const sources = fixture.sources(parts)
  sources.output.conclusion = concludeD1cMeasurement(fixture.observe(parts))
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d1c-derive-'))
  directories.push(directory)
  const runDir = join(directory, 'fixture.run')
  mkdirSync(runDir)
  writeFileSync(join(runDir, 'start.json'), JSON.stringify(parts.start, null, 2) + '\n')
  for (const run of parts.runs) {
    const dir = join(runDir, `run-${run.runIndex}`)
    mkdirSync(dir)
    writeFileSync(join(dir, 'first.record.json'), JSON.stringify(run.first.record, null, 2) + '\n')
    writeFileSync(join(dir, 'first.entry-set.json'), JSON.stringify(run.entrySet) + '\n')
    if (run.fresh !== null) writeFileSync(join(dir, 'fresh.record.json'), JSON.stringify(run.fresh.record, null, 2) + '\n')
  }
  const result = join(directory, 'fixture.result.json')
  writeFileSync(result, JSON.stringify(sources.output, null, 2) + '\n')
  return { directory, runDir, result, publicPath: join(directory, 'public.json'), parts, sources }
}
function derive(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 110_000 })
  expect(result.error).toBeUndefined()
  return result
}

describe('Phase D-1C public RESULT derivation script', () => {
  it('writes the public RESULT once, re-derives the raw conclusion, checks it, and carries no record identifier', () => {
    const raw = writeRaw()
    const written = derive(['--result', raw.result, '--run-dir', raw.runDir, '--public', raw.publicPath])
    expect(written.status, written.stderr).toBe(0)
    const summary = JSON.parse(written.stdout)
    expect(summary).toMatchObject({ formalValidity: 'invalid', candidateOutcome: 'verified', acceptance: 'not_accepted' })
    const text = readFileSync(raw.publicPath, 'utf8')
    expect(summary.sha256).toBe(sha256(text))
    const published = JSON.parse(text)
    expect(published.derivation.consistency).toEqual({ startRecordMatchesRaw: true, readingsMatchRaw: true, semanticSha256MatchesRecords: true, conclusionMatchesRecords: true })
    // The synthetic conditions are not the registration's: an invalid measurement whose verified candidate is never accepted.
    expect(published.formalValidity.checks.provenance.run_conditions_equal_registration.passed).toBe(false)
    expect(published.postHoc.operationCount.judgement).toBe('not_evaluated')
    // Every raw file is a hashed source; the records and the Entry sets stay in the run directory.
    expect(published.derivation.sources.map((file: { file: string }) => file.file)).toEqual([
      'fixture.result.json', 'fixture.run/run-1/first.entry-set.json', 'fixture.run/run-1/first.record.json', 'fixture.run/run-1/fresh.record.json',
      'fixture.run/run-2/first.entry-set.json', 'fixture.run/run-2/first.record.json', 'fixture.run/run-2/fresh.record.json', 'fixture.run/start.json',
    ])
    for (const identifier of collectD1cRecordIdentifiers(raw.sources.children)) expect(text).not.toContain(identifier)
    const checked = derive(['--result', raw.result, '--run-dir', raw.runDir, '--check', raw.publicPath])
    expect(checked.status, checked.stdout).toBe(0)
    expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true, issues: [] })
    // The public file is written exclusively.
    const again = derive(['--result', raw.result, '--run-dir', raw.runDir, '--public', raw.publicPath])
    expect(again.status).not.toBe(0)
    expect(again.stderr).toMatch(/EEXIST/)
  }, 3 * SPAWN_TEST_TIMEOUT_MS)

  it('refuses tampered raw sources and a RESULT of another run directory, writing nothing', () => {
    // A recorded conclusion the records do not give.
    const forged = writeRaw()
    const output = JSON.parse(readFileSync(forged.result, 'utf8'))
    output.conclusion.acceptance.status = 'accepted'
    writeFileSync(forged.result, JSON.stringify(output, null, 2) + '\n')
    const refused = derive(['--result', forged.result, '--run-dir', forged.runDir, '--public', forged.publicPath])
    expect(refused.status).toBe(1)
    expect(JSON.parse(refused.stderr)).toMatchObject({ written: false, issues: expect.arrayContaining(['The conclusion re-derived from the raw records is not the runner\'s.']) })
    expect(existsSync(forged.publicPath)).toBe(false)
    // A record file changed after the run.
    const record = writeRaw()
    const recordPath = join(record.runDir, 'run-2', 'fresh.record.json')
    const fresh = JSON.parse(readFileSync(recordPath, 'utf8'))
    fresh.verification.semantic.planner.planHash = 'fnv1a32:00000000'
    writeFileSync(recordPath, JSON.stringify(fresh, null, 2) + '\n')
    const changed = derive(['--result', record.result, '--run-dir', record.runDir, '--public', record.publicPath])
    expect(changed.status).toBe(1)
    expect(JSON.parse(changed.stderr).issues).toEqual(expect.arrayContaining(['A child record read from the run directory is not the one the runner read.']))
    expect(existsSync(record.publicPath)).toBe(false)
    // A start record that is not the raw provenance.
    const start = writeRaw()
    writeFileSync(join(start.runDir, 'start.json'), '{}\n')
    const startRefused = derive(['--result', start.result, '--run-dir', start.runDir, '--public', start.publicPath])
    expect(startRefused.status).toBe(1)
    expect(JSON.parse(startRefused.stderr).issues).toEqual(expect.arrayContaining(['The start record in the run directory is not the start provenance of the raw RESULT.']))
    // A RESULT paired with another run directory.
    const other = writeRaw()
    const renamed = join(other.directory, 'other.run')
    mkdirSync(renamed)
    const wrong = derive(['--result', other.result, '--run-dir', renamed, '--public', other.publicPath])
    expect(wrong.status).toBe(1)
    expect(wrong.stderr).toMatch(/The RESULT belongs to the run directory .*fixture\.run, not /)
    expect(existsSync(other.publicPath)).toBe(false)
  }, 6 * SPAWN_TEST_TIMEOUT_MS)

  it('refuses unknown, duplicate and value-less options and a missing or double output mode', () => {
    const refuse = (args: string[], message: RegExp) => {
      const result = derive(args)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(message)
    }
    refuse(['--result', 'r.json', '--run-dir', 'd', '--public', 'p.json', '--export', 'x.json'], /Unknown option --export\./)
    refuse(['--result', 'r.json', '--run-dir', 'd'], /Usage:/)
    refuse(['--result', 'r.json', '--run-dir', 'd', '--public', 'p.json', '--check', 'c.json'], /Usage:/)
    refuse(['--result', 'r.json', '--result', 'r.json'], /Duplicate option/)
    refuse(['--result'], /--result needs a value/)
  }, SPAWN_TEST_TIMEOUT_MS)
})
