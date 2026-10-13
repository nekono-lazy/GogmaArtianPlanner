import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { d0cFixtureSources } from '../src/benchmarks/globalAssignment/materializationFormalTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0C: the public RESULT derivation script, run for real over raw outputs written the way the
 * runner writes them (from a synthetic scenario): it hashes every source file, derives the RESULT, writes it exclusively, re-checks
 * it, and refuses a tampered RESULT, a RESULT paired with another run directory, an existing output and unknown options.
 */
const script = resolve('scripts/derive-planner-global-assignment-d0c-result.mjs')
const directories: string[] = []
const SPAWN_TEST_TIMEOUT_MS = 120_000
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function rawRun() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-assignment-d0c-derive-'))
  directories.push(directory)
  const runName = 'd0c-fixture.run'
  const runDir = join(directory, runName)
  mkdirSync(runDir)
  const sources = await d0cFixtureSources({ runDir: runName, semanticHash: text => sha256(text) })
  for (const { id, record } of sources.records) writeFileSync(join(runDir, `${id}.record.json`), JSON.stringify(record, null, 2) + '\n')
  writeFileSync(join(runDir, 'start.json'), JSON.stringify({ mode: 'formal' }) + '\n')
  const resultPath = join(directory, 'd0c-fixture.result.json')
  writeFileSync(resultPath, JSON.stringify({ ...sources.output, runDir }, null, 2) + '\n')
  return { directory, runDir, resultPath, publicPath: join(directory, 'public.json') }
}

const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 110_000 })

describe('Phase D-0C public RESULT derivation script', () => {
  it('derives the RESULT from the raw files, hashes every source, writes it exclusively and checks it again', async () => {
    const { runDir, resultPath, publicPath } = await rawRun()
    const derived = run(['--result', resultPath, '--run-dir', runDir, '--public', publicPath])
    expect(derived.error).toBeUndefined()
    expect(derived.status, derived.stderr).toBe(0)
    const text = readFileSync(publicPath, 'utf8')
    const published = JSON.parse(text)
    expect(text).toBe(JSON.stringify(published, null, 2) + '\n')
    expect(published).toMatchObject({ resultKind: 'global-assignment-d0c-public-result', formalValidity: { status: 'valid' }, materializationOutcome: { verdict: 'all_materialized' } })
    expect(published.derivation.consistency).toEqual({ semanticSha256MatchesRecords: true, materializationOutcomeMatchesRecords: true })
    // Every source file, by a name relative to the run (never an absolute path), with its real length and SHA-256.
    const files = published.derivation.sources.map((source: { file: string }) => source.file)
    expect(files).toEqual(['d0c-fixture.result.json', 'd0c-fixture.run/materialize-1.record.json', 'd0c-fixture.run/materialize-2.record.json', 'd0c-fixture.run/start.json'])
    const record = readFileSync(join(runDir, 'materialize-1.record.json'))
    expect(published.derivation.sources[1]).toEqual({ file: 'd0c-fixture.run/materialize-1.record.json', bytes: record.length, sha256: sha256(record) })
    expect(text).not.toMatch(/target\.fixture|owned\.g/)
    expect(text).not.toContain(resolve(runDir).replace(/\\/g, '\\\\'))

    const checked = run(['--result', resultPath, '--run-dir', runDir, '--check', publicPath])
    expect(checked.status, checked.stdout).toBe(0)
    expect(JSON.parse(checked.stdout)).toMatchObject({ ok: true, issues: [], sha256: sha256(text) })
    // An existing public RESULT is never overwritten.
    const again = run(['--result', resultPath, '--run-dir', runDir, '--public', publicPath])
    expect(again.status).not.toBe(0)
    expect(readFileSync(publicPath, 'utf8')).toBe(text)
  }, SPAWN_TEST_TIMEOUT_MS)

  it('refuses a tampered RESULT, a changed raw record, another run directory and unknown or conflicting options', async () => {
    const { directory, runDir, resultPath, publicPath } = await rawRun()
    expect(run(['--result', resultPath, '--run-dir', runDir, '--public', publicPath]).status).toBe(0)
    const published = JSON.parse(readFileSync(publicPath, 'utf8'))
    const tampered = join(directory, 'tampered.json')
    writeFileSync(tampered, JSON.stringify({ ...published, totalWallMs: 1 }, null, 2) + '\n')
    const checked = run(['--result', resultPath, '--run-dir', runDir, '--check', tampered])
    expect(checked.status).toBe(1)
    expect(JSON.parse(checked.stdout).issues).toEqual(['The public RESULT is not the re-derivation of the raw sources (differing: totalWallMs).'])
    // A raw record changed after the derivation no longer matches the published sources and semantic hash.
    const recordPath = join(runDir, 'materialize-2.record.json')
    const record = JSON.parse(readFileSync(recordPath, 'utf8'))
    writeFileSync(recordPath, JSON.stringify({ ...record, semantic: { ...record.semantic, integrityIssues: ['edited'] } }, null, 2) + '\n')
    const changed = run(['--result', resultPath, '--run-dir', runDir, '--check', publicPath])
    expect(changed.status).toBe(1)
    expect(JSON.parse(changed.stdout).issues).toEqual(expect.arrayContaining([expect.stringMatching(/not the re-derivation/), 'A measured run\'s recorded semantic SHA-256 is not the hash of its record.']))
    const otherDir = join(directory, 'other.run')
    mkdirSync(otherDir)
    expect(run(['--result', resultPath, '--run-dir', otherDir, '--check', publicPath]).stderr).toMatch(/The RESULT belongs to the run directory .*not .*other\.run/)
    expect(run(['--result', resultPath, '--run-dir', runDir, '--public', join(directory, 'x.json'), '--check', publicPath]).stderr).toMatch(/Usage:/)
    expect(run(['--result', resultPath, '--run-dir', runDir, '--export', 'x.json', '--check', publicPath]).stderr).toMatch(/Unknown option --export/)
    expect(existsSync(join(directory, 'x.json'))).toBe(false)
  }, SPAWN_TEST_TIMEOUT_MS)
})
