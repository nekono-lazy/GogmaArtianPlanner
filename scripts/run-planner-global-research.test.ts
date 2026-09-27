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

function expectRefusal(input: string, output: string, message: string, extra: string[] = []) {
  // A missing Export proves these guards run before the Research input is read.
  const result = spawnSync(process.execPath, [runner, '--export', input, '--output', output, ...extra], { encoding: 'utf8', timeout: 5000 })
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

it('refuses capture collisions with the Export, output and existing capture', () => {
  const { input, output, progress } = fixture()
  expectRefusal(input, output, 'must be distinct', ['--capture-inputs', input])
  expectRefusal(input, output, 'must be distinct', ['--capture-inputs', output])
  expectRefusal(input, output, 'must be distinct', ['--capture-inputs', progress])
  const capture = `${output}.capture.local`
  writeFileSync(capture, 'existing snapshot')
  expectRefusal(input, output, 'Capture already exists', ['--capture-inputs', capture])
  expect(readFileSync(capture, 'utf8')).toBe('existing snapshot')
  expect(existsSync(progress)).toBe(false)
})

it('requires observed failures for failed-first, and an explicit snapshot for focused Search', () => {
  const { input, output, progress } = fixture()
  expectRefusal(input, output, 'requires --observed-report', ['--strategy', 'failed-first'])
  expectRefusal(input, output, 'are required together', ['--focus-target', 'arbitrary-id'])
  expectRefusal(input, output, 'Invalid Node yield mode', ['--yield-mode', 'microtask'])
  expectRefusal(input, output, 'Invalid raw block cache mode', ['--raw-block-cache', 'session'])
  expectRefusal(input, output, 'Duplicate research option', ['--time-budget-ms', '180000', '--time-budget-ms', '100'])
  expect(existsSync(progress)).toBe(false)
})

it('guards Phase 1-D probe / fallback options before reading the Export', () => {
  const { input, output, progress } = fixture()
  expectRefusal(input, output, 'are required together', ['--probe-snapshot', 'x.local', '--probe-axis', 'normal'])
  expectRefusal(input, output, 'A probe runs one captured Search only', ['--probe-snapshot', 'x.local', '--probe-target', 't', '--probe-axis', 'gogma', '--extent-fallback', 'gogma'])
  expectRefusal(input, output, 'A probe runs one captured Search only', ['--probe-snapshot', 'x.local', '--probe-target', 't', '--probe-axis', 'gogma', '--attempt-state', 's.local'])
  expectRefusal(input, output, 'Invalid probe axis', ['--probe-snapshot', 'x.local', '--probe-target', 't', '--probe-axis', 'all'])
  expectRefusal(input, output, 'Invalid fallback axis', ['--extent-fallback', 'every'])
  expectRefusal(input, output, 'Invalid fallback bounds', ['--extent-fallback', 'normal', '--fallback-budget-ms', '-1'])
  expectRefusal(input, output, 'requires --extent-fallback', ['--cancel-after-fallback-start-ms', '10'])
  expectRefusal(input, output, 'must be distinct', ['--capture-no-match', input])
  const capture = `${output}.nomatch.local`
  writeFileSync(capture, 'existing snapshot')
  expectRefusal(input, output, 'Capture already exists', ['--capture-no-match', capture])
  expect(readFileSync(capture, 'utf8')).toBe('existing snapshot')
  expect(existsSync(progress)).toBe(false)
})
