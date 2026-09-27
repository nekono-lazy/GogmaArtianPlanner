import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const controller = resolve('scripts/run-planner-global-phase1e.mjs')
const sources = {
  controller: readFileSync(controller, 'utf8'),
  module: readFileSync(resolve('src/benchmarks/plannerGlobalOptimizationPhase1E.ts'), 'utf8'),
}
const SPAWN_TEST_TIMEOUT_MS = 30000

it('reads no earlier Phase report, anchor, snapshot, observed failure or oracle at runtime', () => {
  for (const [name, source] of Object.entries(sources)) {
    // Earlier result files and their directory are never a runtime dependency.
    expect(source, name).not.toMatch(/docs\/|PHASE1[A-D]_(?!BOUNDS)|PLANNER_GLOBAL_|_RESULTS_8G/)
    // Research seams that would hand prior evidence to a child.
    expect(source, name).not.toMatch(/--observed-report|--probe-snapshot|--focus-inputs|--capture-no-match|failed-first|selectExtentProbeAnchors|failedFirstTargetIds/)
    // No embedded Target / Entry ID (UUID) and no embedded Export SHA-256.
    expect(source, name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(source, name).not.toMatch(/[0-9a-f]{64}/i)
  }
  // The only files the controller reads: the Export, its own children's outputs, and (stop suite) its own INITIAL_VARIANTS.
  const reads = [...sources.controller.matchAll(/readFile\(([^,)]+)/g)].map(m => m[1].trim())
  expect(reads.sort()).toEqual(['`${nestedPrefix}_RESULT.json.local`', '`${output}.progress.local`', 'exportPath', "out('INITIAL_VARIANTS'", 'output'].sort())
  // A child gets a state file only on the retry path, and that state comes from the retry controller.
  expect(sources.controller.match(/--attempt-state/g)).toHaveLength(1)
})

function expectRefusal(extra: string[], message: string) {
  const result = spawnSync(process.execPath, [controller, ...extra], { encoding: 'utf8', timeout: 15000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(message)
}

it('guards its options before reading the Export or starting a child', () => {
  expectRefusal([], 'Usage')
  expectRefusal(['--cancel-deadline'], 'Usage')
  expectRefusal(['missing-export.json', 'prefix', '--controller-budget-ms', '1', '--controller-budget-ms', '2'], 'Duplicate Phase 1-E option')
  expectRefusal(['missing-export.json', 'prefix', '--controller-budget-ms', '-1'], 'Invalid Phase 1-E controller bounds')
  expectRefusal(['missing-export.json', 'prefix', '--cancel-deadline', '--no-reproduction'], 'takes no controller option')
}, SPAWN_TEST_TIMEOUT_MS)
