import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Issue #154 Production準備 P-2: the analyzer script's own refusals, which need no measured commit (they hold in a shallow CI checkout
 * too). The analysis itself is tested over real synthetic records in
 * src/benchmarks/globalAssignment/browser/globalAssignmentBrowserAnalysis.test.ts; the script only reads files and git objects.
 */
const script = resolve('scripts/analyze-planner-global-assignment-browser.mjs')
const run = (args: string[]) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000 })
  expect(result.error).toBeUndefined()
  return result
}
const NOT_A_COMMIT = 'f'.repeat(40)

describe('P-2 Browser analyzer script: refusals before any analysis', () => {
  it('refuses an unknown or duplicate option, a missing value and a malformed measurement HEAD', () => {
    expect(run(['--export', 'x.json']).stderr).toMatch(/Unknown option --export/)
    expect(run(['--measurement-head', NOT_A_COMMIT, '--measurement-head', NOT_A_COMMIT, '--validate-plan']).stderr).toMatch(/Duplicate option/)
    expect(run(['--measurement-head']).stderr).toMatch(/--measurement-head needs a value/)
    const short = run(['--measurement-head', 'abc', '--validate-plan'])
    expect(short.status).not.toBe(0)
    expect(short.stderr).toMatch(/must be a 40 lower-case hex commit/)
  })

  it('refuses a mode mix: --validate-plan with inputs, no output mode, both output modes, and a Node output without its run directory', () => {
    expect(run(['--measurement-head', NOT_A_COMMIT, '--validate-plan', '--browser-raw-dir', '.local/x']).stderr).toMatch(/--validate-plan takes no other input/)
    expect(run(['--measurement-head', NOT_A_COMMIT, '--browser-raw-dir', '.local/x']).stderr).toMatch(/Usage:/)
    expect(run(['--measurement-head', NOT_A_COMMIT, '--browser-raw-dir', '.local/x', '--public', '.local/a.json', '--check', '.local/b.json']).stderr).toMatch(/Usage:/)
    expect(run(['--measurement-head', NOT_A_COMMIT, '--browser-raw-dir', '.local/x', '--node-output', '.local/n.json', '--public', '.local/a.json']).stderr).toMatch(/go together/)
  })

  it('refuses a measurement HEAD that is not a commit of the Repository, before reading any file', () => {
    const result = run(['--measurement-head', NOT_A_COMMIT, '--validate-plan'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/is not a commit of this Repository/)
  })
})
