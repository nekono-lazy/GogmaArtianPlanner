// Issue #154 Phase 1-E Research only: sequential fresh Node processes, the ORIGINAL Export reloaded by EVERY child.
// The only runtime data input is that Export. No earlier Phase report, anchor, attempt ID, retained set,
// pending order, snapshot, Candidate, Target ID or oracle is read, embedded or passed to a child.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const flags = args.filter(a => a.startsWith('--'))
if (new Set(flags).size !== flags.length) throw new Error('Duplicate Phase 1-E option.')
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const [exportPath, prefix] = args
if (!exportPath || !prefix || exportPath.startsWith('--') || prefix.startsWith('--')) {
  throw new Error('Usage: node scripts/run-planner-global-phase1e.mjs <external-export> <output-prefix> [--cancel-deadline] [--controller-budget-ms N] [--cancel-after-first-completed-ms N] [--no-reproduction] [--local-outputs]')
}
const suite = args.includes('--cancel-deadline') ? 'cancel-deadline' : 'main'
const localOutputs = args.includes('--local-outputs')
const skipReproduction = args.includes('--no-reproduction')
const controllerBudgetMs = Number(option('--controller-budget-ms') ?? 10800000)
const cancelAfterFirstCompletedMs = option('--cancel-after-first-completed-ms') === undefined ? null : Number(option('--cancel-after-first-completed-ms'))
if (!Number.isFinite(controllerBudgetMs) || controllerBudgetMs < 0 || (cancelAfterFirstCompletedMs !== null && (!Number.isFinite(cancelAfterFirstCompletedMs) || cancelAfterFirstCompletedMs < 0))) throw new Error('Invalid Phase 1-E controller bounds.')
if (suite === 'cancel-deadline' && (cancelAfterFirstCompletedMs !== null || skipReproduction || localOutputs || option('--controller-budget-ms') !== undefined)) throw new Error('The cancel / deadline suite takes no controller option.')
const out = name => `${prefix}_${name}.json${localOutputs ? '.local' : ''}`
const outputs = suite === 'main' ? ['CONTROL', 'INITIAL_VARIANTS', 'RESULT', 'REPRODUCTION'].map(out) : ['CANCEL', 'DEADLINE'].map(out)
if (outputs.some(p => existsSync(p) || resolve(p).toLowerCase() === resolve(exportPath).toLowerCase())) throw new Error('Outputs must be new and distinct from the Export.')
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
if (git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths)) throw new Error('Commit ALL benchmark code before measuring')
const sha = value => createHash('sha256').update(value).digest('hex')
const exportSha256 = sha(await readFile(exportPath))
const ATTEMPT_BUDGET_MS = 900000, FALLBACK_BUDGET_MS = 180000, MAX_PLAN_STEPS = 20000, HEAP_FLAG = '--max-old-space-size=8192'
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
let cancelled = false, current = null
const cancel = () => { cancelled = true; if (current) writeFile(current.cancelFile, 'cancel\n', { flag: 'wx' }).catch(() => {}) }
process.on('SIGINT', cancel)
const start = performance.now()
const environments = []

/** One fresh child from the original Export. `extra` carries bounds, an axis and (retry only) a derived state file. */
async function runChild(name, extra, budgetMs = ATTEMPT_BUDGET_MS) {
  const output = `${prefix}.${name}.local`, cancelFile = `${output}.cancel.local`
  const childArgs = [HEAP_FLAG, 'scripts/run-planner-global-research.mjs', '--export', exportPath, '--output', output,
    '--raw-block-cache', 'per-search', '--yield-mode', 'immediate', '--max-plan-steps', String(MAX_PLAN_STEPS),
    '--attempt-budget-ms', String(Math.max(0, Math.min(budgetMs, controllerBudgetMs - (performance.now() - start)))), '--cancel-file', cancelFile, ...extra]
  console.log(`START ${name}`)
  const began = performance.now()
  let stderrTail = ''
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    current = { child, cancelFile }
    if (cancelled) cancel()
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-16000); process.stderr.write(chunk) })
    child.once('error', reject)
    child.once('exit', code => { current = null; done(code) })
  })
  const wallMs = performance.now() - began
  let record = null, processFailure = null
  if (existsSync(output)) record = JSON.parse(await readFile(output, 'utf8'))
  else {
    const progress = existsSync(`${output}.progress.local`) ? (await readFile(`${output}.progress.local`, 'utf8')).trim().split(/\r?\n/).filter(Boolean) : []
    const last = progress.length ? JSON.parse(progress.at(-1)) : null
    const stop = cancelled ? 'cancelled' : exitCode === 134 && /heap out of memory/.test(stderrTail) ? 'memory_limit' : 'process_error'
    processFailure = { stop, exitCode, stderrTail, memoryScope: 'last progress sample: lower bound, NOT final process peak', timingScope: 'last-progress lower bounds' }
    if (last) record = { environment: last.environment, report: { ...last.report, status: 'error', error: `Child exited ${exitCode}; final result unavailable` },
      phase1c: { stop, priorityEntries: last.priorityEntries, signals: { notFound: last.report.searches.filter(s => s.status === 'not_found_within_extent' && s.fallback?.status !== 'found').map(s => s.targetId),
        resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [{ targetId: '', classification: stop }] } },
      memory: last.memory, phase1b: { searchEvidence: [], generatedEntries: [], finalSelectedEntryIds: [], planSha256: null, finalResultSha256: null, resultSha256: null } }
  }
  if (record) {
    for (const key of ['repositoryHead', 'benchmarkCodeSha256', 'rngEngineVersion', 'exportSha256', 'heapSizeLimitBytes']) {
      if (environments.length && environments[0][key] !== record.environment[key]) throw new Error(`Benchmark changed mid-controller: ${key}`)
    }
    if (record.environment.exportSha256 !== exportSha256) throw new Error('Child read another Export.')
    environments.push(record.environment)
  }
  console.log(`DONE ${name} (${Math.round(wallMs)} ms)`)
  return { name, args: extra, exitCode, wallMs, record, processFailure }
}

try {
  const phase1e = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationPhase1E.ts')
  const retry = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationRetry.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const { isGlobalPlanSuccess } = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationExtentProbe.ts')
  const bounds = phase1e.PHASE1E_BOUNDS
  const baseExtent = research.GLOBAL_RESEARCH_EXTENT
  const variantArgs = axis => ['--extent-fallback', axis, '--fallback-budget-ms', String(FALLBACK_BUDGET_MS), '--fallback-max-episodes', String(bounds.maxFallbackEpisodesPerAttempt)]
  const withoutProfiles = report => report && { ...report, searches: report.searches.map(s => ({ ...s, profile: undefined, fallback: s.fallback ? { ...s.fallback, profile: undefined } : undefined })) }

  /** Child result -> stored attempt (AttemptSummary + evidence). The state is what the run derived or was given. */
  function attemptOf(run, { axis, stage, attemptId, strategy, reason, state }) {
    const r = run.record
    if (!r) {
      const stop = run.processFailure.stop
      return { attemptId, strategy, reason, state, signature: retry.discoverySignature(state ?? { retainedEntryIds: [], pendingTargetIds: [], extent: baseExtent }), axis, stage,
        signals: { notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [{ targetId: '', classification: stop }] },
        report: { status: 'error', error: 'no progress evidence', planningTargetCount: 0, retainedOriginalEntryIds: [], searches: [], final: null, searchElapsedMs: 0, plannerElapsedMs: 0, totalElapsedMs: 0 },
        stop, evidence: null, phase1d: null, priorityEntries: null, wallMs: run.wallMs, exitCode: run.exitCode, processFailure: run.processFailure, memory: null, environment: null, childName: run.name }
    }
    const priorityEntries = r.phase1c.priorityEntries
    const actualState = state ?? phase1e.derivedAttemptState(r.report.retainedOriginalEntryIds, priorityEntries, baseExtent)
    const searchedOrder = r.report.searches.map(s => s.targetId)
    const report = withoutProfiles(r.report)
    return { attemptId, strategy, reason, state: actualState, signature: retry.discoverySignature(actualState), axis, stage,
      signals: r.phase1c.signals, report, stop: run.processFailure ? run.processFailure.stop : r.phase1c.stop,
      derivedStateMatchesSearchOrder: searchedOrder.length === actualState.pendingTargetIds.length ? isDeepStrictEqual(searchedOrder, actualState.pendingTargetIds) : null,
      evidence: r.phase1b ? { ...r.phase1b, rawBlocks: undefined } : null,
      phase1d: r.phase1d ? { fallbackMaxEpisodes: r.phase1d.fallbackMaxEpisodes ?? null, fallbackBudgetMs: r.phase1d.fallbackBudgetMs, fallbacks: r.phase1d.fallbacks,
        fallbackSearchEvidence: r.phase1d.fallbackSearchEvidence } : null,
      priorityEntries,
      timing: { candidateSearches: r.report.searches.length, fallbackEpisodes: r.report.extentFallback?.searches ?? 0,
        searchElapsedMs: r.report.searchElapsedMs, fallbackSearchElapsedMs: r.report.extentFallback?.searchElapsedMs ?? 0,
        plannerElapsedMs: r.report.plannerElapsedMs, totalElapsedMs: r.report.totalElapsedMs, wallMs: run.wallMs },
      memory: { maxRssKiB: r.memory.maxRssKiB, heapSizeLimitBytes: r.environment.heapSizeLimitBytes, scope: r.memory.scope ?? 'last progress sample' },
      exitCode: run.exitCode, processFailure: run.processFailure, cancel: r.cancel ?? null, environment: r.environment, childName: run.name }
  }
  const execution = attempt => {
    if (!attempt.priorityEntries) throw new Error(`Child ${attempt.childName} produced no priority evidence: ${attempt.stop}`)
    return { attempt, priorityEntries: attempt.priorityEntries }
  }
  const controlOf = async name => execution(attemptOf(await runChild(name, []), { axis: null, stage: 'control', attemptId: 0, strategy: 'control_no_fallback', reason: 'Phase 0 order, no fallback', state: null }))
  const initialOf = async (axis, name) => execution(attemptOf(await runChild(name, variantArgs(axis)), { axis, stage: 'initial', attemptId: 0, strategy: 'initial_phase0_order',
    reason: `original Export, Phase 0 order and retained set derived by the run, ${phase1e.phase1eStrategyName(axis)}`, state: null }))
  const retryOf = async (axis, state, strategy, reason, attemptId, name) => {
    const statePath = `${prefix}.${name}.state.local`
    await write(statePath, state)
    return attemptOf(await runChild(name, [...variantArgs(axis), '--attempt-state', statePath]), { axis, stage: 'retry', attemptId, strategy, reason, state })
  }

  if (suite === 'cancel-deadline') {
    // Stops are measured apart from the discovery totals; every child starts from the original Export.
    const initialVariants = JSON.parse(await readFile(out('INITIAL_VARIANTS'), 'utf8'))
    const axis = initialVariants.variants.find(v => v.timing?.fallbackEpisodes > 0)?.axis
    if (!axis) throw new Error('No initial axis strategy reached a fallback; nothing to cancel during a fallback.')
    const view = run => { const a = attemptOf(run, { axis: null, stage: 'stop', attemptId: 0, strategy: run.name, reason: 'stop measurement', state: null })
      return { name: run.name, args: run.args, exitCode: run.exitCode, wallMs: run.wallMs, stop: a.stop, reportStatus: a.report.status, stage: a.report.stage, error: a.report.error,
        final: a.report.final, searches: a.report.searches.map(s => ({ targetId: s.targetId, status: s.status, fallback: s.fallback ? { status: s.fallback.status, stoppedBy: s.fallback.stoppedBy, elapsedMs: s.fallback.elapsedMs, timeBudgetMs: s.fallback.timeBudgetMs } : undefined })),
        totalElapsedMs: a.report.totalElapsedMs, cancel: a.cancel, memory: a.memory, environment: a.environment } }
    const nested = async (name, extra) => {
      const nestedPrefix = `${prefix}.${name}`
      const began = performance.now()
      const exitCode = await new Promise((done, reject) => {
        const child = spawn(process.execPath, ['scripts/run-planner-global-phase1e.mjs', exportPath, nestedPrefix, '--local-outputs', '--no-reproduction', ...extra], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
        child.once('error', reject); child.once('exit', done)
      })
      const result = JSON.parse(await readFile(`${nestedPrefix}_RESULT.json.local`, 'utf8'))
      return { name, args: extra, exitCode, wallMs: performance.now() - began, outcome: result.outcome, stop: result.stop, cancel: result.cancel, firstCompleted: result.firstCompleted,
        variants: result.variants.map(v => ({ axis: v.axis, stage: v.stage, stop: v.stop, final: v.final, reportStatus: v.reportStatus })), control: result.control ? { stop: result.control.stop, reportStatus: result.control.reportStatus } : null,
        totals: result.totals }
    }
    const deadline = {
      axis, note: 'axis = first initial strategy of this Phase 1-E run that reached a fallback (read from its own INITIAL_VARIANTS)',
      fallbackDeadline: view(await runChild('deadline-fallback', ['--extent-fallback', axis, '--fallback-budget-ms', '1000', '--fallback-max-episodes', String(bounds.maxFallbackEpisodesPerAttempt)])),
      attemptDeadline: view(await runChild('deadline-attempt', variantArgs(axis), 30000)),
      controllerDeadline: await nested('deadline-controller', ['--controller-budget-ms', '5000']),
    }
    await write(out('DEADLINE'), deadline)
    const cancelRuns = {
      axis,
      controlCancel: view(await runChild('cancel-control', ['--cancel-after-ms', '2000'])),
      initialVariantCancel: view(await runChild('cancel-initial', [...variantArgs(axis), '--cancel-after-ms', '60000'])),
      fallbackCancel: view(await runChild('cancel-fallback', [...variantArgs(axis), '--cancel-after-fallback-start-ms', '1000'])),
      controllerCancelAfterCompleted: await nested('cancel-controller', ['--cancel-after-first-completed-ms', '5000']),
    }
    await write(out('CANCEL'), cancelRuns)
  } else {
    let cancelTimer
    const deps = {
      control: () => controlOf('control'),
      initial: axis => initialOf(axis, `${axis}-initial`),
      retry: (axis, state, strategy, reason, attemptId) => retryOf(axis, state, strategy, reason, attemptId, `${axis}-retry-${attemptId}`),
      nowMs: () => performance.now(),
      shouldStop: () => cancelled ? 'cancelled' : performance.now() - start >= controllerBudgetMs ? 'time_budget' : null,
    }
    const observed = { ...deps, initial: async axis => {
      const run = await deps.initial(axis)
      // Stop measurement only: cancel once a completed variant exists, to show it is not overwritten.
      if (cancelAfterFirstCompletedMs !== null && cancelTimer === undefined && isGlobalPlanSuccess(phase1e.phase1eVariantOutcome(axis, run.attempt))) cancelTimer = setTimeout(cancel, cancelAfterFirstCompletedMs)
      return run
    } }
    const result = await phase1e.runPhase1EController(observed, bounds)
    clearTimeout(cancelTimer)
    const controllerWallMs = performance.now() - start
    const variantView = v => ({ axis: v.axis, strategy: v.strategy, stage: v.stage, attemptId: v.attempt.attemptId, retryStrategy: v.stage === 'retry' ? v.attempt.strategy : null,
      reason: v.attempt.reason, signature: v.outcome.signature, success: v.axis ? isGlobalPlanSuccess(v.outcome) : null, stop: v.attempt.stop,
      reportStatus: v.attempt.report.status, error: v.attempt.report.error, planningTargetCount: v.attempt.report.planningTargetCount, final: v.attempt.report.final,
      state: v.attempt.state, derivedStateMatchesSearchOrder: v.attempt.derivedStateMatchesSearchOrder ?? null, signals: v.attempt.signals,
      searches: v.attempt.report.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome ?? null, generatedEntryId: s.generatedEntryId,
        routeKind: s.routeKind ?? s.fallback?.routeKind ?? null, estimatedOperationCount: s.estimatedOperationCount ?? s.fallback?.estimatedOperationCount ?? null,
        advances: s.advances ?? s.fallback?.advances ?? null, elapsedMs: s.elapsedMs, boundary: s.predictionBoundaryReached, reach: s.observedPredictionReach,
        fallback: s.fallback ? { axis: s.fallback.axis, extent: s.fallback.extent, status: s.fallback.status, stoppedBy: s.fallback.stoppedBy, elapsedMs: s.fallback.elapsedMs,
          searchRunId: s.fallback.searchRunId, requestFingerprint: s.fallback.requestFingerprint, reach: s.fallback.observedPredictionReach, boundary: s.fallback.predictionBoundaryReached } : null })),
      retainedOriginalEntryIds: v.attempt.report.retainedOriginalEntryIds, baseline: v.attempt.report.baseline, retained: v.attempt.report.retained,
      phase1d: v.attempt.phase1d, evidence: v.attempt.evidence, timing: v.attempt.timing, finishedAtMs: v.finishedAtMs, memory: v.attempt.memory,
      exitCode: v.attempt.exitCode, processFailure: v.attempt.processFailure, environment: v.attempt.environment })
    const controlView = result.control && { ...variantView({ axis: null, strategy: 'control_no_fallback', stage: 'control', attempt: result.control.attempt, outcome: { signature: result.control.attempt.signature }, finishedAtMs: result.control.finishedAtMs }),
      success: result.control.attempt.stop === 'completed' }
    const sum = (list, f) => list.reduce((t, x) => t + (f(x) ?? 0), 0)
    const all = [...(result.control ? [result.control.attempt] : []), ...result.variants.map(v => v.attempt)]
    const peak = list => { const values = list.map(a => a.memory?.maxRssKiB).filter(n => typeof n === 'number'); return values.length ? Math.max(...values) : null }
    const initialEndMs = result.initial.at(-1)?.finishedAtMs ?? null
    const environment = { ...environments[0], controller: 'scripts/run-planner-global-phase1e.mjs', runtimeInput: 'original Export only (every child reloads it)',
      exportSha256, maxPlanSteps: MAX_PLAN_STEPS, productionDefaultMaxPlanSteps: 1000, baseExtent, fallbackFactor: 2, fallbackEpisodeLimit: bounds.maxFallbackEpisodesPerAttempt,
      axisStrategies: result.initial.map(v => v.strategy), retryBounds: bounds.retry, rawCacheMode: 'per-search', yieldMode: 'immediate', childHeapFlag: HEAP_FLAG,
      attemptBudgetMs: ATTEMPT_BUDGET_MS, fallbackBudgetMs: FALLBACK_BUDGET_MS, controllerBudgetMs, cancelAfterFirstCompletedMs, readsEarlierPhaseReports: false }
    const control = { environment, control: controlView }
    if (result.control) await write(out('CONTROL'), control)
    // Ranked by the final Global Plan only (compareExtentVariants inside the controller), never by a Candidate.
    const initialVariants = { environment, initialSuccess: result.initialSuccess,
      ranking: result.ranking.filter(v => v.stage === 'initial').map(v => ({ axis: v.axis, signature: v.outcome.signature, success: isGlobalPlanSuccess(v.outcome), final: v.outcome.final, stop: v.outcome.stop })),
      variants: result.initial.map(variantView) }
    await write(out('INITIAL_VARIANTS'), initialVariants)
    const winnerView = result.winner && { axis: result.winner.axis, stage: result.winner.stage, attemptId: result.winner.attempt.attemptId, signature: result.winner.outcome.signature,
      final: result.winner.attempt.report.final, timing: result.winner.attempt.timing, memory: result.winner.attempt.memory, evidence: { planSha256: result.winner.attempt.evidence?.planSha256,
        finalResultSha256: result.winner.attempt.evidence?.finalResultSha256, resultSha256: result.winner.attempt.evidence?.resultSha256 } }
    const totals = {
      control: result.control ? result.control.attempt.timing : null,
      initialVariants: Object.fromEntries(result.initial.map(v => [v.axis, v.attempt.timing])),
      retryAttempts: result.variants.filter(v => v.stage === 'retry').length,
      attempts: all.length,
      candidateSearches: sum(all, a => a.timing?.candidateSearches), fallbackEpisodes: sum(all, a => a.timing?.fallbackEpisodes),
      searchElapsedMs: sum(all, a => a.timing?.searchElapsedMs), fallbackSearchElapsedMs: sum(all, a => a.timing?.fallbackSearchElapsedMs),
      plannerElapsedMs: sum(all, a => a.timing?.plannerElapsedMs), attemptElapsedMs: sum(all, a => a.timing?.totalElapsedMs), childWallMs: sum(all, a => a.timing?.wallMs ?? a.wallMs),
      timeToFirstCompletedMs: result.firstCompleted?.elapsedMs ?? null,
      timeToFirstCompletedExcludingControlMs: result.firstCompleted && result.control ? result.firstCompleted.elapsedMs - result.control.finishedAtMs : null,
      allInitialAxesComparedAtMs: initialEndMs, controllerWallMs,
      winningAttempt: result.winner ? result.winner.attempt.timing : null,
      peakChildMaxRssKiB: peak(all), controllerMaxRssKiB: process.resourceUsage().maxRSS,
      heapSizeLimitBytes: environments[0]?.heapSizeLimitBytes ?? null, reproductionExcluded: true,
      childTimingAndPeakAreLowerBounds: all.some(a => a.processFailure),
    }
    const final = { environment, outcome: result.outcome, stop: result.stop, cancel: result.cancel, initialSuccess: result.initialSuccess, retryStarted: result.retryStarted,
      orderingRetryNeededForCompletion: result.winner ? result.winner.stage === 'retry' : null, retries: result.retries, firstCompleted: result.firstCompleted,
      winner: winnerView, ranking: result.ranking.map(v => ({ axis: v.axis, stage: v.stage, attemptId: v.attempt.attemptId, signature: v.outcome.signature, final: v.outcome.final, stop: v.outcome.stop })),
      control: controlView && { stop: controlView.stop, reportStatus: controlView.reportStatus, final: controlView.final, evidence: controlView.evidence && { resultSha256: controlView.evidence.resultSha256, planSha256: controlView.evidence.planSha256 } },
      variants: result.variants.map(v => ({ axis: v.axis, stage: v.stage, attemptId: v.attempt.attemptId, retryStrategy: v.stage === 'retry' ? v.attempt.strategy : null, stop: v.attempt.stop,
        reportStatus: v.attempt.report.status, final: v.attempt.report.final, signals: v.attempt.signals, fallbacks: v.attempt.phase1d?.fallbacks.map(f => ({ searchIndex: f.searchIndex, targetId: f.targetId,
          baseStatus: f.baseStatus, targetOutcome: f.targetOutcome, axis: f.fallback.axis, extent: f.fallback.extent, status: f.fallback.status, stoppedBy: f.fallback.stoppedBy,
          elapsedMs: f.fallback.elapsedMs, routeKind: f.fallback.routeKind, estimatedOperationCount: f.fallback.estimatedOperationCount, advances: f.fallback.advances })) ?? [],
        timing: v.attempt.timing, memory: v.attempt.memory, finishedAtMs: v.finishedAtMs,
        evidence: v.attempt.evidence && { resultSha256: v.attempt.evidence.resultSha256, planSha256: v.attempt.evidence.planSha256 } })),
      totals }
    await write(out('RESULT'), final)
    let reproduction = null
    if (result.winner && !cancelled && !skipReproduction) {
      // Only the axis strategy and bounds are handed on; the fresh chain derives everything else from the Export.
      const repeated = await phase1e.reproducePhase1EWinner(result.winner, {
        initial: axis => initialOf(axis, `reproduction-${axis}-initial`),
        retry: (axis, state, strategy, reason, attemptId) => retryOf(axis, state, strategy, reason, attemptId, `reproduction-${axis}-retry-${attemptId}`),
        shouldStop: () => cancelled ? 'cancelled' : null }, bounds)
      const semantic = a => a && ({ retainedOriginalEntryIds: [...a.report.retainedOriginalEntryIds].sort(), pendingOrder: a.report.searches.map(s => s.targetId), state: a.state,
        statuses: a.report.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome ?? null })),
        fallbacks: (a.phase1d?.fallbacks ?? []).map(f => ({ searchIndex: f.searchIndex, targetId: f.targetId, axis: f.fallback.axis, extent: f.fallback.extent, status: f.fallback.status,
          searchRunId: f.fallback.searchRunId, requestFingerprint: f.fallback.requestFingerprint, generatedEntryId: f.fallback.generatedEntryId })),
        fallbackSearchEvidence: a.phase1d?.fallbackSearchEvidence ?? [], searchEvidence: a.evidence?.searchEvidence, generatedEntries: a.evidence?.generatedEntries,
        selected: a.evidence?.finalSelectedEntryIds, planSha256: a.evidence?.planSha256, finalResultSha256: a.evidence?.finalResultSha256, resultSha256: a.evidence?.resultSha256,
        stop: a.stop, final: a.report.final && { ...a.report.final, elapsedMs: undefined } })
      const original = semantic(result.winner.attempt), again = semantic(repeated)
      reproduction = { passed: repeated !== null && isDeepStrictEqual(original, again), axis: result.winner.axis, stage: result.winner.stage, signature: result.winner.outcome.signature,
        handedToReproduction: { axis: result.winner.axis, bounds, maxPlanSteps: MAX_PLAN_STEPS, attemptBudgetMs: ATTEMPT_BUDGET_MS, fallbackBudgetMs: FALLBACK_BUDGET_MS },
        originalSemanticSha256: sha(JSON.stringify(original)), repeatedSemanticSha256: sha(JSON.stringify(again ?? null)),
        repeated: repeated && { stop: repeated.stop, final: repeated.report.final, timing: repeated.timing, memory: repeated.memory, derivedStateMatchesSearchOrder: repeated.derivedStateMatchesSearchOrder ?? null,
          state: repeated.state, evidence: repeated.evidence && { resultSha256: repeated.evidence.resultSha256, planSha256: repeated.evidence.planSha256 } },
        semantic: again, wallMs: performance.now() - start - controllerWallMs }
      await write(out('REPRODUCTION'), reproduction)
    }
    console.log(JSON.stringify({ outcome: result.outcome, initialSuccess: result.initialSuccess, retryStarted: result.retryStarted, winner: winnerView && { axis: winnerView.axis, stage: winnerView.stage, final: winnerView.final },
      reproduction: reproduction?.passed ?? null, totals }, null, 2))
    if (reproduction && !reproduction.passed) process.exitCode = 1
  }
} finally { process.off('SIGINT', cancel); await server.close() }
