// Research-only: sequential fresh Node processes, original Export on EVERY attempt.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const [exportPath, outputPath] = process.argv.slice(2)
if (!exportPath || !outputPath) throw new Error('Usage: node scripts/run-planner-global-phase1c.mjs <external-export> <new-report.json>')
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase() || existsSync(outputPath)) throw new Error('Output must be new and distinct from Export')
const sha = value => createHash('sha256').update(value).digest('hex')
if (sha(await readFile(exportPath)) !== 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b') throw new Error('Export SHA differs')
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
if (git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths)) throw new Error('Commit ALL benchmark code before measuring')
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const controllerBudgetMs = 3600000, attemptBudgetMs = 600000
let cancelled = false, child = null
const cancel = () => { cancelled = true; child?.kill('SIGINT') }
process.on('SIGINT', cancel)
const start = performance.now()
try {
  const retry = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationRetry.ts')
  const extent = { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }
  const records = []
  async function execute(state, strategy, reason, attemptId, suffix = String(attemptId)) {
    const output = `${outputPath}.attempt-${suffix}.local`, statePath = `${outputPath}.state-${suffix}.local`
    const args = ['scripts/run-planner-global-research.mjs', '--export', exportPath, '--output', output,
      '--raw-block-cache', 'per-search', '--yield-mode', 'immediate', '--max-plan-steps', '20000',
      '--attempt-budget-ms', String(suffix === 'reproduction' ? attemptBudgetMs : Math.max(0, Math.min(attemptBudgetMs, controllerBudgetMs - (performance.now() - start))))]
    if (state) { await write(statePath, state); args.push('--attempt-state', statePath) }
    console.log(`START ${suffix} ${strategy}`)
    await new Promise((done, reject) => {
      child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true })
      child.once('error', reject)
      child.once('exit', code => { child = null; (code === 0 || code === 1 && existsSync(output)) ? done() : reject(new Error(`Attempt process failed: ${code}; evidence at ${output}`)) })
    })
    const record = JSON.parse(await readFile(output, 'utf8'))
    for (const key of ['repositoryHead', 'benchmarkCodeSha256', 'rngEngineVersion', 'exportSha256']) {
      if (records.length && records[0].environment[key] !== record.environment[key]) throw new Error(`Benchmark changed mid-controller: ${key}`)
    }
    const actualState = state ?? { retainedEntryIds: record.report.retainedOriginalEntryIds,
      pendingTargetIds: record.phase1c.priorityEntries.filter(e => !record.report.retainedOriginalEntryIds.includes(e.id)).map(e => e.targetWeaponId), extent }
    const summary = { attemptId, strategy, reason, state: actualState, signature: retry.discoverySignature(actualState),
      signals: record.phase1c.signals, report: record.report, stop: record.phase1c.stop }
    const stored = { ...summary, releasedEntryIds: records[0]?.state.retainedEntryIds.filter(id => !actualState.retainedEntryIds.includes(id)) ?? [],
      environment: { ...record.environment, extent: actualState.extent, strategy, attemptBudgetMs, controllerBudgetMs, bounds: retry.PHASE1C_BOUNDS },
      evidence: record.phase1b, memory: record.memory }
    records.push(stored)
    console.log(`DONE ${suffix}: ${record.report.final?.completedTargetCount ?? 0}/43, conflicts ${record.report.final?.conflicts}, ${record.report.totalElapsedMs} ms`)
    return { summary, priorityEntries: record.phase1c.priorityEntries }
  }
  const first = await execute(null, 'fixed_retained', 'Phase 0 default order', 0)
  // Prior ordinary Phase 0 result is a parity assertion ONLY, never controller input.
  const phase0 = JSON.parse(await readFile('docs/PLANNER_GLOBAL_PHASE1B_PHASE0_CACHE.json', 'utf8'))
  const baselineParity = { passed: records[0].evidence.resultSha256 === phase0.phase1b.resultSha256,
    priorResultSha256: phase0.phase1b.resultSha256, currentResultSha256: records[0].evidence.resultSha256 }
  if (!baselineParity.passed && (first.summary.stop === null || first.summary.stop === 'completed')) throw new Error('Phase 0 semantic parity failed')
  const result = await retry.runDiscoveryRetries(first.summary, first.priorityEntries,
    async (...args) => (await execute(...args)).summary, retry.PHASE1C_BOUNDS,
    () => cancelled ? 'cancelled' : performance.now() - start >= controllerBudgetMs ? 'time_budget' : null)
  const controllerWallMs = performance.now() - start
  const discoveryRecords = [...records]
  let reproduction = null
  const winner = discoveryRecords.find(r => r.stop === 'completed')
  if (winner && !cancelled) {
    const rerun = await execute(winner.state, 'independent_reproduction', `repeat winning state ${winner.attemptId}`, winner.attemptId, 'reproduction')
    const repeated = records.at(-1)
    const semantic = r => ({ state: r.state, statuses: r.report.searches.map(s => ({ targetId: s.targetId, status: s.status })),
      searchEvidence: r.evidence.searchEvidence, generatedEntries: r.evidence.generatedEntries,
      selected: r.evidence.finalSelectedEntryIds, planSha256: r.evidence.planSha256,
      finalResultSha256: r.evidence.finalResultSha256, resultSha256: r.evidence.resultSha256, stop: r.stop,
      traceReplay: r.report.final?.traceReplay, conflicts: r.report.final?.conflicts, rejected: r.report.final?.rejected })
    reproduction = { passed: isDeepStrictEqual(semantic(winner), semantic(repeated)), originalAttemptId: winner.attemptId,
      originalSemanticSha256: sha(JSON.stringify(semantic(winner))), repeatedSemanticSha256: sha(JSON.stringify(semantic(repeated))),
      elapsedMs: rerun.summary.report.totalElapsedMs, record: repeated }
  }
  const sum = key => discoveryRecords.reduce((total, r) => total + r.report[key], 0)
  const final = { environment: discoveryRecords[0].environment, stopReason: result.stopReason, stageStops: result.stageStops,
    cycleCount: result.cycleCount, bestAttemptId: result.bestAttemptId, attempts: discoveryRecords, reproduction, baselineParity,
    totals: { attempts: discoveryRecords.length, candidateSearches: discoveryRecords.reduce((n, r) => n + r.report.searches.length, 0),
      searchElapsedMs: sum('searchElapsedMs'), plannerElapsedMs: sum('plannerElapsedMs'), attemptElapsedMs: sum('totalElapsedMs'), controllerWallMs,
      winningAttemptElapsedMs: winner?.report.totalElapsedMs ?? null,
      peakChildMaxRssKiB: Math.max(...discoveryRecords.map(r => r.memory.maxRssKiB)),
      controllerMaxRssKiB: process.resourceUsage().maxRSS },
    extentFallback: 'not implemented; conditional follow-up only if ordering and release remain unsuccessful' }
  await write(outputPath, final)
  if (reproduction && !reproduction.passed) throw new Error('Independent reproduction FAILED')
  console.log(JSON.stringify({ outputPath, stop: result.stopReason, totals: final.totals, reproduction: reproduction?.passed }, null, 2))
} finally { process.off('SIGINT', cancel); await server.close() }
