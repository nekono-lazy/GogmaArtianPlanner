import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const runner = resolve('scripts/run-planner-global-research.mjs')
const directories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'planner-global-runner-'))
  directories.push(directory)
  const output = join(directory, 'report.json')
  return { directory, output, progress: `${output}.progress.local`, input: join(directory, 'missing-export.json') }
}

function expectRefusal(input: string, output: string, message: string) {
  // A missing Export proves these guards run before the Research input is read.
  const result = spawnSync(process.execPath, [runner, '--export', input, '--output', output], { encoding: 'utf8', timeout: 5000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(message)
  expect(result.stdout).toBe('')
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file))
    rmdirSync(directory)
  }
})

it('refuses an existing output before Research starts, without creating progress evidence', () => {
  const { directory, input, output, progress } = fixture()
  writeFileSync(output, 'existing result')
  expectRefusal(input, output, 'Output already exists:')
  expect(readFileSync(output, 'utf8')).toBe('existing result')
  expect(existsSync(progress)).toBe(false)
  expect(readdirSync(directory)).toEqual(['report.json'])
})

it('preserves exclusive creation of progress evidence and does not create the output', () => {
  const { input, output, progress } = fixture()
  writeFileSync(progress, 'existing progress')
  expectRefusal(input, output, 'EEXIST')
  expect(readFileSync(progress, 'utf8')).toBe('existing progress')
  expect(existsSync(output)).toBe(false)
})

it('still refuses identical input and output paths without modifying the input', () => {
  const { output, progress } = fixture()
  writeFileSync(output, 'original export')
  expectRefusal(output, output, 'Output must not overwrite the input Export.')
  expect(readFileSync(output, 'utf8')).toBe('original export')
  expect(existsSync(progress)).toBe(false)
})
