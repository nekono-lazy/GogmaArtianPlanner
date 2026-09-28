// Issue #154 Phase 2-C2 post-hoc analysis only. Reads the finished Phase 2-C2 raw run record (written by
// run-planner-global-phase2c2.mjs) and, as explicit file arguments AFTER the run ended, the Phase 2-C1 evidence (baseline
// parity) and the 1,657 proven-minimum evidence (portfolio coverage). It runs no Search, no kernel and no Planner, and it
// feeds neither evidence into any calculation. Candidate stable keys are written as SHA-256 digests; the raw keys stay in
// the raw record.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), c1: option('--c1'), optimum: option('--optimum'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c2.mjs --run <c2-raw.json.local> --c1 <PLANNER_GLOBAL_PHASE2C1_RESULT.json> --optimum <1,657 evidence.json> --output <new.json>')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const load = async path => {
  const raw = await readFile(path)
  return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } }
}
const [run, c1, optimum] = await Promise.all([load(paths.run), load(paths.c1), load(paths.optimum)])
const r = run.json
if (r.environment.uncommittedBenchmarkCode) throw new Error('The run measured uncommitted benchmark code.')
if (r.smokeOrientationLimit !== null) throw new Error('The run is a non-formal smoke run.')
const exportSha256 = r.environment.exportSha256
if (optimum.json.environment?.exportSha256 !== exportSha256 || optimum.json.verdict !== 'proven_minimum') throw new Error('Optimum evidence is not the proven minimum of this Export.')
if (c1.json.provenance?.exportSha256 !== exportSha256) throw new Error('Phase 2-C1 evidence is for another Export.')

const sha = text => createHash('sha256').update(text).digest('hex')
const countBy = (values, key) => {
  const out = {}
  for (const value of values) { const k = key(value); out[k] = (out[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}
const distribution = values => countBy(values, value => String(value))
const ranges = values => {
  const out = []
  for (const value of [...new Set(values)].sort((a, b) => a - b)) { const last = out.at(-1); if (last && value === last[1] + 1) last[1] = value; else out.push([value, value]) }
  return out
}
const reservationSummary = reservation => reservation === null ? null : {
  normal: reservation.normal.map(n => ({ counterId: n.counterId, held: ranges(n.held), blocked: ranges(n.blocked) })),
  skill: { held: ranges(reservation.skill.held), blocked: ranges(reservation.skill.blocked) },
  gogma: { held: ranges(reservation.gogma.held), blocked: ranges(reservation.gogma.blocked) },
  exclusiveOwnedWeaponIds: reservation.exclusiveOwnedWeaponIds,
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2Analysis.ts')
  const baseline = r.baseline
  const c1Parity = analysis.comparePhase2C2BaselineWithC1(baseline.summary, c1.json)

  // Conflicts and orientations (from the run's own baseline).
  const conflicts = Object.values(baseline.orientations.reduce((acc, o) => {
    acc[o.conflictIndex] ??= { conflictIndex: o.conflictIndex, conflictKey: o.conflictKey, kind: o.kind, participantBuildListEntryIds: o.participantBuildListEntryIds,
      participantTargetWeaponIds: o.participantTargetWeaponIds, orientationIds: [] }
    acc[o.conflictIndex].orientationIds.push(o.orientationId)
    return acc
  }, {}))

  // Kernel results.
  const kernelRows = r.kernels.map(k => {
    const base = { orientationId: k.orientation.orientationId, conflictKey: k.orientation.conflictKey, kind: k.orientation.kind, fixedBuildListEntryId: k.orientation.fixedBuildListEntryId,
      fixedTargetWeaponId: k.orientation.fixedTargetWeaponId, process: { outcome: k.process.outcome, wallMs: k.process.wallMs, exitCode: k.process.exitCode, stderrTail: k.process.stderrTail },
      memory: k.memory }
    if (!k.record) return { ...base, kernel: { status: `process_${k.process.outcome}` }, targets: [] }
    if (k.record.kernel.status !== 'completed') return { ...base, kernel: { status: k.record.kernel.status, failure: k.record.kernel.failure, detail: k.record.kernel.detail }, targets: [] }
    return { ...base, kernel: { status: 'completed', plannerRerunsUsed: k.record.kernel.plannerRerunsUsed, explicitDecisionBuildListEntryIds: k.record.kernel.explicitDecisionBuildListEntryIds, kernelMs: k.record.timing.kernelMs },
      targets: k.record.kernel.targets.map(t => ({ targetWeaponId: t.targetWeaponId, invalidatedBuildListEntryId: t.invalidatedBuildListEntryId, invalidatedRouteKeySha256: sha(t.invalidatedRouteKey),
        fixedRouteBuildListEntryIds: t.fixedRouteBuildListEntryIds, reservation: reservationSummary(t.reservation), excludedRouteKeySha256s: t.excludedRouteKeys.map(sha),
        outcome: t.outcome, found: t.found && { stableKeySha256: sha(t.found.stableKey), generatedSelected: t.found.generatedSelected, trialPlan: t.found.trialPlan, summary: t.found.summary },
        trials: t.trials.map(trial => ({ candidateKeySha256: sha(trial.candidateKey), result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })),
        search: t.search, skippedExcludedRouteKeys: t.skippedExcludedRouteKeys })) }
  })
  const kernelTargetRows = kernelRows.flatMap(row => row.targets.map(t => ({ orientationId: row.orientationId, kind: row.kind, ...t })))
  const kernelOutcomes = {
    orientations: kernelRows.length,
    orientationStatus: countBy(kernelRows, row => row.kernel.status),
    targetOutcomes: countBy(kernelTargetRows, t => t.outcome),
    targetOutcomesByKind: Object.fromEntries(Object.entries(kernelTargetRows.reduce((acc, t) => { (acc[t.kind] ??= []).push(t.outcome); return acc }, {})).map(([k, v]) => [k, countBy(v, x => x)])),
    trialRejectionReasons: countBy(kernelTargetRows.flatMap(t => t.trials.filter(x => x.result === 'rejected')), x => x.reason),
    plannerRerunsUsed: kernelRows.filter(row => row.kernel.status === 'completed').map(row => row.kernel.plannerRerunsUsed),
  }

  // Search contexts.
  const contextRow = c => ({ contextId: c.contextId, orientationId: c.orientationId, kind: c.kind, fixedTargetWeaponId: c.fixedTargetWeaponId, targetWeaponId: c.targetWeaponId,
    extentLabel: c.extentLabel, extent: c.extent, status: c.status, summary: c.summary, kernelTrialPrefixMatches: c.kernelTrialPrefixMatches, elapsedMs: c.elapsedMs,
    candidates: c.candidates.map(x => ({ deliveredIndex: x.deliveredIndex, stableKeySha256: sha(x.stableKey), kernel: x.kernel, respectsReservation: x.reservationCheck.respects,
      heldRoute: x.summary.heldRoute, sourceKind: x.summary.sourceKind, estimatedOperationCount: x.summary.estimatedOperationCount })) })
  // The measured runner (3db8197) left `defaultContexts[].process` unset; the same child entry is in `processes` under its id.
  const processById = new Map(r.processes.map(p => [p.id, p]))
  const defaultRows = r.defaultContexts.map(d => {
    const process = d.process ?? processById.get(`portfolio-${d.orientationId}-${d.targetWeaponId}-default`)
    if (!process) throw new Error(`No process entry for the default context ${d.orientationId}/${d.targetWeaponId}.`)
    return { orientationId: d.orientationId, targetWeaponId: d.targetWeaponId, process: { outcome: process.outcome, wallMs: process.wallMs, stderrTail: process.stderrTail },
      memory: d.memory, context: d.context ? contextRow(d.context) : null }
  })
  const probeRows = r.probes.contexts.map(contextRow)
  const statusCounts = rows => countBy(rows, c => c.status)
  const searchExecution = {
    defaultContextTasks: defaultRows.length,
    defaultContextProcessOutcomes: countBy(defaultRows, d => d.process.outcome),
    defaultStatus: statusCounts(defaultRows.flatMap(d => d.context ? [d.context] : [])),
    defaultDelivered: defaultRows.reduce((sum, d) => sum + (d.context?.summary.deliveredCandidates ?? 0), 0),
    defaultDeliveredDistribution: distribution(defaultRows.flatMap(d => d.context ? [d.context.summary.deliveredCandidates] : [])),
    kernelTrialPrefixMatches: countBy(defaultRows.flatMap(d => d.context ? [d.context] : []), c => String(c.kernelTrialPrefixMatches)),
    reservationViolations: [...defaultRows.flatMap(d => d.context?.candidates ?? []), ...probeRows.flatMap(c => c.candidates)].filter(x => !x.respectsReservation).length,
    probeContexts: probeRows.length,
    probeStatus: statusCounts(probeRows),
    probeDelivered: probeRows.reduce((sum, c) => sum + c.summary.deliveredCandidates, 0),
    probeLog: r.probes.log.map(entry => ({ ...entry, memory: entry.memory ?? null })),
    probeLogOutcomes: countBy(r.probes.log, entry => entry.outcome === 'skipped' ? `skipped:${entry.decision.reason}` : entry.outcome),
    probeWallMs: r.probes.wallMs,
  }

  // Portfolio.
  const portfolio = r.portfolio.map(p => ({ ...p, candidates: p.candidates.map(c => ({ stableKeySha256: sha(c.stableKey), origin: c.origin, kernelFound: c.kernelFound, summary: c.summary, provenance: c.provenance })) }))
  const participants = portfolio.filter(p => p.conflictParticipant)
  const participantTargets = participants.map(p => p.targetWeaponId)
  const alternativeCandidates = portfolio.flatMap(p => p.candidates.filter(c => c.origin === 'alternative'))
  const heldFrom = (list, label) => list.filter(c => c.origin === 'alternative' && c.summary.heldRoute && c.provenance.some(x => label === null || x.extentLabel === label))
  const diversitySummary = {
    targets: portfolio.length,
    conflictParticipants: participants.length,
    portfolioSizeDistribution: distribution(portfolio.map(p => p.diversity.candidates)),
    participantPortfolioSizeDistribution: distribution(participants.map(p => p.diversity.candidates)),
    targetsWithMultiple: portfolio.filter(p => p.has.multipleCandidates).length,
    participantsWithMultiple: participants.filter(p => p.has.multipleCandidates).length,
    participantsWithSourceAlternative: participants.filter(p => p.has.sourceAlternative).length,
    participantsWithCounterPositionAlternative: participants.filter(p => p.has.counterPositionAlternative).length,
    participantsWithHeldRoute: participants.filter(p => p.has.heldRoute).length,
    participantsWithReservationRespectingAlternative: participants.filter(p => p.has.reservationRespectingAlternative).length,
    uniqueCandidates: portfolio.reduce((sum, p) => sum + p.candidates.length, 0),
    uniqueAlternatives: alternativeCandidates.length,
    deliveredTotal: searchExecution.defaultDelivered + searchExecution.probeDelivered,
    kernelFoundCandidates: alternativeCandidates.filter(c => c.kernelFound).length,
    heldRoutes: {
      targetsWithHeldAlternative: portfolio.filter(p => p.candidates.some(c => c.origin === 'alternative' && c.summary.heldRoute)).length,
      heldAlternativeCandidates: heldFrom(alternativeCandidates, null).length,
      heldAlternativeCandidatesAtDefaultExtent: heldFrom(alternativeCandidates, 'default').length,
      heldAlternativeCandidatesProbeOnly: alternativeCandidates.filter(c => c.summary.heldRoute && c.provenance.every(x => x.extentLabel !== 'default')).length,
      targetsWithHeldAlternativeAtDefaultExtent: portfolio.filter(p => heldFrom(p.candidates, 'default').length > 0).length,
      originalHeldRoutes: portfolio.filter(p => p.candidates.some(c => c.origin === 'original' && c.summary.heldRoute)).length,
    },
    probeAddedCandidates: alternativeCandidates.filter(c => c.provenance.every(x => x.extentLabel !== 'default')).length,
    byDefaultPrefix: Object.fromEntries(['1', '2', '4', '8'].map(k => [k, {
      participantsWithMultiple: participants.filter(p => p.diversityByDefaultPrefix[k].candidates > 1).length,
      participantCandidateTotal: participants.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].candidates, 0),
      participantHeldRoutes: participants.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].heldRoutes, 0),
      participantDistinctOwnedSources: participants.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].distinctOwnedWeaponSources, 0),
      participantDistinctRequiredGogmaSets: participants.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].distinctRequiredGogmaSets, 0),
      participantDistinctRequiredSkillSets: participants.reduce((sum, p) => sum + p.diversityByDefaultPrefix[k].distinctRequiredSkillSets, 0),
    }])),
  }

  // Participants never searched by any completed context (kernel failure, not searched, or context failure).
  const searchedTargets = new Set([...defaultRows.flatMap(d => d.context ? [d.targetWeaponId] : []), ...probeRows.map(c => c.targetWeaponId)])
  const unsearchedParticipants = participantTargets.filter(id => !searchedTargets.has(id))

  // 1,657 post-hoc coverage.
  const coverage = analysis.phase2c2OracleCoverage(r.portfolio, { routes: optimum.json.routes, gogmaUsage: optimum.json.gogmaUsage })
  const coverageRows = coverage.targets.map(row => ({ ...row, matchedStableKeySha256: row.matchedStableKey ? sha(row.matchedStableKey) : null, matchedStableKey: undefined,
    conflictParticipant: participantTargets.includes(row.targetWeaponId), searched: searchedTargets.has(row.targetWeaponId) }))
  const oracleCovered = coverage.totals.exact + coverage.totals.partialComparable
  const judgement = analysis.phase2c2CaseJudgement({ participants: participants.length, participantsWithMultiple: diversitySummary.participantsWithMultiple,
    oracleRoutes: coverage.totals.routes, oracleCovered })

  const failures = r.processes.filter(p => p.outcome !== 'completed').map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, wallMs: p.wallMs, stderrTail: p.stderrTail }))
  const record = {
    phase: 'Issue #154 Phase 2-C2: Candidate portfolio from the original Export Conflicts (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c1: c1.source, optimum: optimum.source },
    provenance: { measuredHead: r.environment.repositoryHead, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: false, exportSha256,
      exportFileName: r.environment.exportFileName, exportBytes: r.environment.exportBytes, measuredAt: r.measuredAt, runWallMs: r.wallMs, environment: r.environment, budgets: r.budgets },
    conditions: r.conditions, probeGrid: r.probeGrid,
    baseline: { summary: baseline.summary, elapsedMs: baseline.elapsedMs, memory: baseline.memory },
    c1Parity,
    conflicts,
    orientations: baseline.orientations,
    kernel: { outcomes: kernelOutcomes, results: kernelRows, unsearchedKernelTargets: r.unsearchedKernelTargets },
    searchExecution,
    defaultContexts: defaultRows,
    probeContexts: probeRows,
    portfolio: { summary: diversitySummary, unsearchedParticipants, targets: portfolio },
    processFailures: { count: failures.length, byOutcome: countBy(failures, f => `${f.role}:${f.outcome}`), failures },
    oracleCoverage: { totals: coverage.totals, targets: coverageRows },
    c3Readiness: { ...judgement, participants: participants.length, participantsWithMultiple: diversitySummary.participantsWithMultiple, oracleRoutes: coverage.totals.routes, oracleCovered,
      kernelOrientationsCompleted: kernelOutcomes.orientationStatus.completed ?? 0, kernelOrientations: kernelOutcomes.orientations, unsearchedParticipants: unsearchedParticipants.length },
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), baseline: baseline.summary.conflictsByKind, c1Parity: c1Parity.checks, kernel: kernelOutcomes.orientationStatus,
    kernelTargets: kernelOutcomes.targetOutcomes, search: { defaultStatus: searchExecution.defaultStatus, probeStatus: searchExecution.probeStatus }, diversity: diversitySummary,
    coverage: coverage.totals, c3: record.c3Readiness, failures: record.processFailures.byOutcome }, null, 2))
} finally {
  await server.close()
}
