// Sequential, isolated Node processes. Never run tests/build alongside this suite.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const [exportPath, capturePath] = process.argv.slice(2)
if (!exportPath || !capturePath) throw new Error('Usage: node scripts/run-planner-global-phase1b.mjs <external-export> <phase1-capture.local>')
const exportSha = createHash('sha256').update(await readFile(exportPath)).digest('hex')
if (exportSha !== 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b') throw new Error('Export differs from Phase 0/1-A')
const captures = (await readFile(capturePath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
const focusCases = [['813fb479', 350], ['813fb479', 700], ['a830a376', 350], ['86439c85', 350], ['2378d3e0', 350]].map(([prefix, normal]) => {
  const matches = captures.filter(c => c.input.targetWeaponId.startsWith(prefix) && c.exportSha256 === exportSha)
  if (matches.length !== 1) throw new Error('Focus snapshot missing or ambiguous')
  return { targetId: matches[0].input.targetWeaponId, normal }
})
const prefix = 'docs/PLANNER_GLOBAL_PHASE1B_'
const names = ['FOCUSED_NO_CACHE', 'FOCUSED_CACHE', 'PHASE0_NO_CACHE', 'PHASE0_CACHE', 'PHASE0_RUN_CACHE', 'FAILED_FIRST_NO_CACHE', 'FAILED_FIRST_CACHE', 'CANCEL', 'PARITY']
for (const name of names) if (existsSync(`${prefix}${name}.json`)) throw new Error(`Output exists: ${name}`)
const file = name => `${prefix}${name}.json`
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function run(output, mode, extra = []) {
  console.log(`START ${output}`)
  const args = ['scripts/run-planner-global-research.mjs', '--export', exportPath, '--output', output,
    '--raw-block-cache', mode, '--yield-mode', 'immediate', '--max-plan-steps', '20000', ...extra]
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Benchmark exit ${code}: ${output}`)))
  })
  const report = JSON.parse(await readFile(output, 'utf8'))
  console.log(`DONE ${output}: ${report.focus?.elapsedMs ?? report.report.totalElapsedMs} ms`)
  return report
}
// Explicitly remove observation fields only; Candidate/Entry/Plan SHA includes all fields,
// including the deterministic Research timestamp. No semantic result field is dropped.
function withoutTimes(value) {
  if (Array.isArray(value)) return value.map(withoutTimes)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.endsWith('Ms')).map(([key, entry]) => [key, withoutTimes(entry)]))
  return value
}
function semantics(record) {
  const { rawBlocks: _rawBlocks, rawBlockSummary: _summary, cacheLimit: _limit, ...evidence } = record.phase1b
  return { result: withoutTimes(record.focus ?? record.report), evidence }
}
const parity = []
function compare(name, a, b) {
  for (const key of ['repositoryHead', 'benchmarkCodeSha256', 'rngEngineVersion', 'exportSha256', 'node', 'platform', 'arch', 'osRelease', 'cpu', 'yieldMode', 'benchmarkMode', 'maxPlanSteps', 'snapshotSha256', 'routeFilter']) {
    if (a.environment[key] !== b.environment[key]) throw new Error(`Environment mismatch: ${key}`)
  }
  if (!isDeepStrictEqual(a.environment.extent, b.environment.extent)) throw new Error('Extent mismatch')
  const left = semantics(a), right = semantics(b)
  if (!isDeepStrictEqual(left, right)) throw new Error(`SEMANTIC PARITY FAILURE: ${name}`)
  const rawA = a.phase1b.rawBlockSummary, rawB = b.phase1b.rawBlockSummary
  if (rawA.requests !== rawB.requests || rawA.uniqueBlocks !== rawB.uniqueBlocks) throw new Error('Raw request sequence changed')
  parity.push({ name, passed: true, semanticSha256: sha(left), measuredCommit: a.environment.repositoryHead,
    benchmarkCodeSha256: a.environment.benchmarkCodeSha256, searchSpeedup: (a.focus?.elapsedMs ?? a.report.searchElapsedMs) / (b.focus?.elapsedMs ?? b.report.searchElapsedMs),
    totalSpeedup: a.report ? a.report.totalElapsedMs / b.report.totalElapsedMs : null,
    peakRssDeltaKiB: b.memory.maxRssKiB - a.memory.maxRssKiB })
  console.log(`PARITY PASSED ${name}`)
}
const focused = []
for (const mode of ['off', 'per-search']) {
  const records = []
  for (const [index, c] of focusCases.entries()) records.push(await run(`phase1b-focused-${mode}-${index}.local`, mode,
    ['--focus-inputs', capturePath, '--focus-target', c.targetId, '--normal', String(c.normal), '--gogma', '500', '--skill', '1500', '--route-filter', 'all']))
  await write(file(mode === 'off' ? 'FOCUSED_NO_CACHE' : 'FOCUSED_CACHE'), records)
  focused.push(records)
}
for (let i = 0; i < focusCases.length; i++) compare(`focused-${i}`, focused[0][i], focused[1][i])
if (focused[0][0].focus.status !== 'not_found_within_extent' || focused[0][1].focus.status !== 'found' ||
  focused[0][1].focus.estimatedOperationCount !== 896 || !isDeepStrictEqual(focused[0][1].focus.advances, { normal: 643, gogma: 1, skill: 252 })) throw new Error('Phase 1-A focused baseline differs')
if (parity[0].searchSpeedup < 1.2) throw new Error('No substantial per-Search benefit; stop before global experiments')
const phase0off = await run(file('PHASE0_NO_CACHE'), 'off')
const phase0cache = await run(file('PHASE0_CACHE'), 'per-search')
compare('phase0-per-search', phase0off, phase0cache)
if (parity.at(-1).searchSpeedup < 1.2) throw new Error('No substantial global benefit; stop')
const phase0run = await run(file('PHASE0_RUN_CACHE'), 'run')
compare('phase0-run', phase0off, phase0run)
const failedArgs = ['--strategy', 'failed-first', '--observed-report', file('PHASE0_NO_CACHE')]
const failedOff = await run(file('FAILED_FIRST_NO_CACHE'), 'off', failedArgs)
const failedCache = await run(file('FAILED_FIRST_CACHE'), 'per-search', failedArgs)
compare('failed-first', failedOff, failedCache)
const cancellations = []
for (const mode of ['off', 'per-search', 'run']) {
  const record = await run(`phase1b-cancel-${mode}.local`, mode, ['--focus-inputs', capturePath,
    '--focus-target', focusCases[0].targetId, '--cancel-after-ms', '100'])
  if (record.focus.status !== 'cancelled') throw new Error('Cancellation misclassified')
  cancellations.push(record)
}
await write(file('CANCEL'), cancellations)
await write(file('PARITY'), { comparisons: parity, exclusions: ['elapsed/clock fields ending Ms', 'memory', 'raw cache hit/miss observations', 'cache mode'],
  included: ['complete Search result SHA-256 except elapsedMs', 'original input fingerprint', 'Search order/status', 'retained IDs', 'generated Candidate and Entry full SHA-256 and IDs',
    'final selected IDs', 'complete Plan SHA-256', 'complete final PlannerResult SHA-256', 'termination', 'Trace Replay', 'prediction counts', 'work/checkpoint/yield counts'] })
