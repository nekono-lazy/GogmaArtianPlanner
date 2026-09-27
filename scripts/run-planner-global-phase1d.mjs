// Issue #154 Phase 1-D Research only: sequential fresh Node processes, original Export on EVERY child.
// Anchors come from the committed Phase 1-C observed report; no Target ID, order or oracle is embedded.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const suite = args.includes('--cancel-deadline') ? 'cancel-deadline' : 'main'
const [exportPath, prefix] = args.filter(a => !a.startsWith('--'))
if (!exportPath || !prefix) throw new Error('Usage: node scripts/run-planner-global-phase1d.mjs <external-export> <output-prefix> [--cancel-deadline]')
const outputs = suite === 'main' ? [`${prefix}_PROBES.json`, `${prefix}_VARIANTS.json`] : [`${prefix}_CANCEL.json`, `${prefix}_DEADLINE.json`]
if (outputs.some(p => existsSync(p) || resolve(p).toLowerCase() === resolve(exportPath).toLowerCase())) throw new Error('Outputs must be new and distinct from Export')
const sha = value => createHash('sha256').update(value).digest('hex')
if (sha(await readFile(exportPath)) !== 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b') throw new Error('Export SHA differs')
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
if (git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths)) throw new Error('Commit ALL benchmark code before measuring')
const PHASE1C_REPORT = 'docs/PLANNER_GLOBAL_PHASE1C_RESULTS_8G.json'
const ATTEMPT_BUDGET_MS = 900000, FALLBACK_BUDGET_MS = 180000, PROBE_BUDGET_MS = 180000
const write = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
let cancelled = false, child = null
const cancel = () => { cancelled = true; child?.kill('SIGINT') }
process.on('SIGINT', cancel)
const start = performance.now()
const environments = []

/** One fresh child. Never passes a Candidate, Projected state or prior result; only files it re-reads. */
async function runChild(name, extra) {
  const output = `${prefix}.${name}.local`
  const childArgs = ['--max-old-space-size=8192', 'scripts/run-planner-global-research.mjs', '--export', exportPath, '--output', output,
    '--raw-block-cache', 'per-search', '--yield-mode', 'immediate', '--max-plan-steps', '20000', ...extra]
  console.log(`START ${name}`)
  const began = performance.now()
  let stderrTail = ''
  const exitCode = await new Promise((done, reject) => {
    child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-16000); process.stderr.write(chunk) })
    child.once('error', reject)
    child.once('exit', code => { child = null; done(code) })
  })
  const wallMs = performance.now() - began
  if (!existsSync(output)) {
    const stop = cancelled ? 'cancelled' : exitCode === 134 && /heap out of memory/.test(stderrTail) ? 'memory_limit' : 'process_error'
    console.log(`FAILED ${name}: ${stop}`)
    return { name, args: extra, exitCode, wallMs, record: null, processFailure: { stop, exitCode, stderrTail } }
  }
  const record = JSON.parse(await readFile(output, 'utf8'))
  for (const key of ['repositoryHead', 'benchmarkCodeSha256', 'rngEngineVersion', 'exportSha256', 'heapSizeLimitBytes']) {
    if (environments.length && environments[0][key] !== record.environment[key]) throw new Error(`Benchmark changed mid-controller: ${key}`)
  }
  environments.push(record.environment)
  console.log(`DONE ${name} (${Math.round(wallMs)} ms)`)
  return { name, args: extra, exitCode, wallMs, record, processFailure: null }
}

try {
  const probeModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationExtentProbe.ts')
  const retry = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationRetry.ts')
  const phase1c = JSON.parse(await readFile(PHASE1C_REPORT, 'utf8'))
  if (phase1c.environment.exportSha256 !== 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b') throw new Error('Phase 1-C report is for another Export')
  const selection = probeModule.selectExtentProbeAnchors(phase1c.attempts, phase1c.bestAttemptId)
  const statePath = anchor => `${prefix}.anchor-${anchor.attemptId}.state.local`
  const capturePath = anchor => `${prefix}.anchor-${anchor.attemptId}.nomatch.local`
  const readCaptures = async anchor => (await readFile(capturePath(anchor), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const summarizeChild = run => run.record ? { wallMs: run.wallMs, exitCode: run.exitCode, maxRssKiB: run.record.memory.maxRssKiB } : { wallMs: run.wallMs, exitCode: run.exitCode, processFailure: run.processFailure }
  const semanticOfAttempt = record => ({
    completed: record.report.final?.completedTargetCount ?? null, conflicts: record.report.final?.conflicts ?? null, rejected: record.report.final?.rejected ?? null,
    resourceConflictRejected: record.report.final?.resourceConflictRejected ?? null, steps: record.report.final?.steps ?? null,
    traceReplay: record.report.final?.traceReplay ?? null, resultSha256: record.phase1b.resultSha256, planSha256: record.phase1b.planSha256,
    notFound: record.phase1c.signals.notFound, searchStatuses: record.report.searches.map(s => ({ targetId: s.targetId, status: s.status })) })

  if (suite === 'cancel-deadline') {
    // Stops are measured apart from the discovery totals; each is its own child from the original Export.
    const variants = JSON.parse(await readFile(`${prefix}_VARIANTS.json`, 'utf8'))
    const probes = JSON.parse(await readFile(`${prefix}_PROBES.json`, 'utf8'))
    const anchor = probes.anchors.find(a => a.reproduction.passed && a.probes.length)?.anchor
    if (!anchor) throw new Error('No reproduced anchor with a probe')
    const probe = probes.anchors.find(a => a.anchor.attemptId === anchor.attemptId).probes[0]
    const axis = variants.variants.find(v => v.anchorAttemptId === anchor.attemptId)?.axis ?? probe.axis
    const probeArgs = ['--probe-snapshot', capturePath(anchor), '--probe-target', probe.targetId, '--probe-axis', probe.axis]
    const stateArgs = ['--attempt-state', statePath(anchor), '--attempt-budget-ms', String(ATTEMPT_BUDGET_MS)]
    const view = run => ({ ...summarizeChild(run), args: run.args, environment: run.record?.environment ?? null,
      probe: run.record?.probe ? { ...run.record.probe, profile: undefined } : undefined,
      report: run.record?.report ? { status: run.record.report.status, stage: run.record.report.stage, error: run.record.report.error, final: run.record.report.final,
        searches: run.record.report.searches.map(s => ({ targetId: s.targetId, status: s.status, fallback: s.fallback ? { ...s.fallback, profile: undefined } : undefined })),
        totalElapsedMs: run.record.report.totalElapsedMs } : undefined,
      stop: run.record?.phase1c ? retry.classifyAttempt(run.record.report, run.record.phase1c.signals) : null,
      signals: run.record?.phase1c?.signals ?? null, cancel: run.record?.cancel ?? null })
    const probeDeadline = await runChild('deadline-probe', [...probeArgs, '--time-budget-ms', '2000'])
    const fallbackDeadline = await runChild('deadline-fallback', [...stateArgs, '--extent-fallback', axis, '--fallback-budget-ms', '1000'])
    const probeCancel = await runChild('cancel-probe', [...probeArgs, '--time-budget-ms', String(PROBE_BUDGET_MS), '--cancel-after-ms', '2000'])
    const fallbackCancel = await runChild('cancel-fallback', [...stateArgs, '--extent-fallback', axis, '--fallback-budget-ms', String(FALLBACK_BUDGET_MS), '--cancel-after-fallback-start-ms', '1000'])
    await write(`${prefix}_DEADLINE.json`, { anchorAttemptId: anchor.attemptId, axis, probe: view(probeDeadline), fallback: view(fallbackDeadline) })
    await write(`${prefix}_CANCEL.json`, { anchorAttemptId: anchor.attemptId, axis, probe: view(probeCancel), fallback: view(fallbackCancel) })
  } else {
    const ledger = new probeModule.ExtentResearchLedger()
    const anchors = [], variants = []
    for (const anchor of selection.anchors) {
      if (cancelled) break
      await write(statePath(anchor), anchor.state)
      const reproduction = await runChild(`anchor-${anchor.attemptId}`, ['--attempt-state', statePath(anchor), '--attempt-budget-ms', String(ATTEMPT_BUDGET_MS), '--capture-no-match', capturePath(anchor)])
      const phase1cAttempt = phase1c.attempts.find(a => a.attemptId === anchor.attemptId)
      const actual = reproduction.record ? semanticOfAttempt(reproduction.record) : null
      const searchEvidenceMatches = reproduction.record ? isDeepStrictEqual(reproduction.record.phase1b.searchEvidence, phase1cAttempt.evidence.searchEvidence) : false
      const entry = { anchor, reproduction: { passed: actual !== null && isDeepStrictEqual(actual, anchor.expected) && searchEvidenceMatches, searchEvidenceMatches,
        actual, ...summarizeChild(reproduction), report: reproduction.record ? { searchElapsedMs: reproduction.record.report.searchElapsedMs,
          plannerElapsedMs: reproduction.record.report.plannerElapsedMs, totalElapsedMs: reproduction.record.report.totalElapsedMs, searches: reproduction.record.report.searches.length } : null,
        noMatchCaptures: (reproduction.record?.phase1d?.noMatchCaptures ?? []).map(c => {
          const base = reproduction.record.report.searches[c.searchIndex]
          const evidence = reproduction.record.phase1b.searchEvidence.find(e => e.targetId === c.targetId)
          return { ...c, baseSearch: { status: base.status, elapsedMs: base.elapsedMs, settledWorkItems: base.profile?.settledWorkItems ?? null,
            predictionCalls: base.profile ? Object.fromEntries(['normal', 'gogma', 'skill'].map(k => [k, base.profile.predictions[k].calls])) : null,
            predictionElapsedMs: base.profile ? ['normal', 'gogma', 'skill'].reduce((t, k) => t + base.profile.predictions[k].elapsedMs, 0) : null,
            searchedRoutes: base.searchedRoutes, skippedRoutes: base.skippedRoutes, resultSha256: evidence?.resultSha256 ?? null } }
        }) }, probes: [], boundStops: [] }
      anchors.push(entry)
      // A reproduction failure stops this anchor: probes would not start from the observed state.
      if (!entry.reproduction.passed) continue
      const captures = await readCaptures(anchor)
      for (const { capture, snapshotSha256 } of captures) {
        for (const axis of probeModule.eligibleExtentAxes(capture.measurement.predictionBoundaryReached)) {
          let claimed
          try { claimed = ledger.claimProbe(anchor.signature, snapshotSha256, axis) } catch (error) { entry.boundStops.push({ axis, error: String(error) }); continue }
          if (cancelled || !claimed) continue
          const run = await runChild(`probe-${anchor.attemptId}-${capture.searchIndex}-${axis}`, ['--probe-snapshot', capturePath(anchor),
            '--probe-target', capture.searchInput.targetWeaponId, '--probe-axis', axis, '--time-budget-ms', String(PROBE_BUDGET_MS)])
          entry.probes.push({ searchIndex: capture.searchIndex, targetId: capture.searchInput.targetWeaponId, axis, snapshotSha256, ...summarizeChild(run),
            ...(run.record ? { ...run.record.probe, rawBlocks: run.record.phase1b?.rawBlockSummary ?? null, environment: run.record.environment } : {}) })
        }
      }
      const foundAxes = probeModule.EXTENT_AXES.filter(axis => entry.probes.some(p => p.axis === axis && p.status === 'found' && p.validation?.status === 'passed'))
      for (const axis of foundAxes) {
        const strategy = probeModule.createSingleAxisExtentFallback(axis, FALLBACK_BUDGET_MS).strategy
        let claimed
        try { claimed = ledger.claimVariant(anchor.signature, strategy) } catch (error) { entry.boundStops.push({ strategy, error: String(error) }); continue }
        if (cancelled || !claimed) continue
        const run = await runChild(`variant-${anchor.attemptId}-${axis}`, ['--attempt-state', statePath(anchor), '--attempt-budget-ms', String(ATTEMPT_BUDGET_MS),
          '--extent-fallback', axis, '--fallback-budget-ms', String(FALLBACK_BUDGET_MS)])
        variants.push(variantRecord(run, anchor, axis, strategy, entry.probes))
      }
    }
    function variantRecord(run, anchor, axis, strategy, probes) {
      const r = run.record
      const stop = r ? retry.classifyAttempt(r.report, r.phase1c.signals) : run.processFailure.stop
      const signature = probeModule.extentVariantSignature(anchor.signature, strategy)
      const fallbacks = r?.phase1d.fallbacks ?? []
      // The integrated run rediscovers the probe's Candidate itself; this only compares fingerprints.
      const probeConsistency = probes.filter(p => p.axis === axis).map(p => {
        const fb = r?.phase1d.fallbackSearchEvidence.find(e => e.targetId === p.targetId) ?? null
        return { targetId: p.targetId, probeCandidateSha256: p.candidateSha256 ?? null, fallbackCandidateSha256: fb?.candidateSha256 ?? null,
          same: fb !== null && fb.candidateSha256 === p.candidateSha256 }
      })
      return { anchorAttemptId: anchor.attemptId, axis, strategy, signature, stop, planningTargetCount: r?.report.planningTargetCount ?? null,
        final: r?.report.final ? { ...r.report.final, status: r.report.final.status } : null, reportStatus: r?.report.status ?? null, error: r?.report.error ?? null,
        signals: r?.phase1c.signals ?? null, fallbacks, fallbackSearchEvidence: r?.phase1d.fallbackSearchEvidence ?? [], probeConsistency,
        searches: r?.report.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome ?? null, generatedEntryId: s.generatedEntryId,
          routeKind: s.routeKind ?? s.fallback?.routeKind ?? null, estimatedOperationCount: s.estimatedOperationCount ?? s.fallback?.estimatedOperationCount ?? null,
          advances: s.advances ?? s.fallback?.advances ?? null, elapsedMs: s.elapsedMs, fallbackElapsedMs: s.fallback?.elapsedMs ?? null })) ?? [],
        evidence: r?.phase1b ? { ...r.phase1b, rawBlocks: undefined } : null,
        timing: r ? { candidateSearches: r.report.searches.length, fallbackSearches: r.report.extentFallback?.searches ?? 0,
          searchElapsedMs: r.report.searchElapsedMs, fallbackSearchElapsedMs: r.report.extentFallback?.searchElapsedMs ?? 0,
          plannerElapsedMs: r.report.plannerElapsedMs, totalElapsedMs: r.report.totalElapsedMs } : null,
        ...summarizeChild(run), environment: r?.environment ?? null }
    }
    const outcomes = variants.map(v => ({ ...v, final: v.final && { completedTargetCount: v.final.completedTargetCount, conflicts: v.final.conflicts, rejected: v.final.rejected,
      resourceConflictRejected: v.final.resourceConflictRejected, steps: v.final.steps, traceReplay: v.final.traceReplay, status: v.final.status } }))
    const ranking = [...outcomes].sort(probeModule.compareExtentVariants).map(v => ({ signature: v.signature, anchorAttemptId: v.anchorAttemptId, axis: v.axis,
      success: probeModule.isGlobalPlanSuccess(v), final: v.final, stop: v.stop }))
    const winner = ranking.find(v => v.success) ?? null
    const discoveryWallMs = performance.now() - start
    let reproduction = null
    if (winner && !cancelled) {
      const original = variants.find(v => v.signature === winner.signature)
      const anchor = selection.anchors.find(a => a.attemptId === winner.anchorAttemptId)
      const run = await runChild(`reproduction-${anchor.attemptId}-${winner.axis}`, ['--attempt-state', statePath(anchor), '--attempt-budget-ms', String(ATTEMPT_BUDGET_MS),
        '--extent-fallback', winner.axis, '--fallback-budget-ms', String(FALLBACK_BUDGET_MS)])
      const repeated = variantRecord(run, anchor, winner.axis, original.strategy, [])
      const semantic = v => ({ state: anchor.state, statuses: v.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome })),
        fallbacks: v.fallbacks.map(f => ({ searchIndex: f.searchIndex, targetId: f.targetId, axis: f.fallback.axis, extent: f.fallback.extent, status: f.fallback.status,
          searchRunId: f.fallback.searchRunId, generatedEntryId: f.fallback.generatedEntryId })),
        fallbackSearchEvidence: v.fallbackSearchEvidence, searchEvidence: v.evidence?.searchEvidence, generatedEntries: v.evidence?.generatedEntries,
        selected: v.evidence?.finalSelectedEntryIds, planSha256: v.evidence?.planSha256, finalResultSha256: v.evidence?.finalResultSha256,
        resultSha256: v.evidence?.resultSha256, stop: v.stop, final: v.final && { ...v.final, elapsedMs: undefined } })
      reproduction = { passed: isDeepStrictEqual(semantic(original), semantic(repeated)), signature: winner.signature,
        originalSemanticSha256: sha(JSON.stringify(semantic(original))), repeatedSemanticSha256: sha(JSON.stringify(semantic(repeated))), record: repeated }
    }
    const probeRuns = anchors.flatMap(a => a.probes)
    const rss = [...anchors.map(a => a.reproduction.maxRssKiB), ...probeRuns.map(p => p.maxRssKiB), ...variants.map(v => v.maxRssKiB)].filter(n => typeof n === 'number')
    const sum = (list, f) => list.reduce((t, x) => t + (f(x) ?? 0), 0)
    const totals = {
      anchorReproductions: { count: anchors.length, candidateSearches: sum(anchors, a => a.reproduction.report?.searches), searchElapsedMs: sum(anchors, a => a.reproduction.report?.searchElapsedMs),
        plannerElapsedMs: sum(anchors, a => a.reproduction.report?.plannerElapsedMs), totalElapsedMs: sum(anchors, a => a.reproduction.report?.totalElapsedMs), wallMs: sum(anchors, a => a.reproduction.wallMs) },
      probes: { count: probeRuns.length, searchElapsedMs: sum(probeRuns, p => p.elapsedMs), wallMs: sum(probeRuns, p => p.wallMs),
        predictionElapsedMs: sum(probeRuns, p => p.profile ? p.profile.predictions.normal.elapsedMs + p.profile.predictions.gogma.elapsedMs + p.profile.predictions.skill.elapsedMs : 0) },
      variants: { count: variants.length, candidateSearches: sum(variants, v => v.timing?.candidateSearches), fallbackSearches: sum(variants, v => v.timing?.fallbackSearches),
        searchElapsedMs: sum(variants, v => v.timing?.searchElapsedMs), fallbackSearchElapsedMs: sum(variants, v => v.timing?.fallbackSearchElapsedMs),
        plannerElapsedMs: sum(variants, v => v.timing?.plannerElapsedMs), totalElapsedMs: sum(variants, v => v.timing?.totalElapsedMs), wallMs: sum(variants, v => v.wallMs) },
      discoveryControllerWallMs: discoveryWallMs, controllerWallMsIncludingReproduction: performance.now() - start,
      peakChildMaxRssKiB: rss.length ? Math.max(...rss) : null, controllerMaxRssKiB: process.resourceUsage().maxRSS,
      reproductionExcludedFromDiscoveryTotals: true,
    }
    const environment = { ...environments[0], phase1cReport: PHASE1C_REPORT, phase1cReportSha256: sha(await readFile(PHASE1C_REPORT)),
      anchorDerivation: 'selectExtentProbeAnchors: blocker-free, Trace-Replay-passed, evidenced Phase 1-C attempts with the maximum completed count, ranked by compareResearchAttempts; secondary = best such attempt whose bounded no-match set names a Target absent from the primary',
      probeRule: 'single axis x2 when the base bounded no-match reached that axis boundary (observed prediction reach)',
      attemptBudgetMs: ATTEMPT_BUDGET_MS, fallbackBudgetMs: FALLBACK_BUDGET_MS, probeBudgetMs: PROBE_BUDGET_MS, bounds: probeModule.PHASE1D_BOUNDS,
      childHeapFlag: '--max-old-space-size=8192' }
    await write(`${prefix}_PROBES.json`, { environment, selection: { ...selection, anchors: selection.anchors.map(a => a.attemptId) }, anchors })
    const outcome = probeModule.phase1dControllerOutcome(outcomes, cancelled ? 'cancelled' : null)
    await write(`${prefix}_VARIANTS.json`, { environment, outcome, winner, ranking, variants, reproduction, totals })
    console.log(JSON.stringify({ outcome, winner, reproduction: reproduction?.passed ?? null, totals }, null, 2))
    if (reproduction && !reproduction.passed) process.exitCode = 1
  }
} finally { process.off('SIGINT', cancel); await server.close() }
