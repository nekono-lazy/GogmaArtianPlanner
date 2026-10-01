// Issue #154 Phase 2-C2.6-B1 post-hoc analysis only. Reads the finished B1 raw run record (written by
// run-planner-global-phase2c26b1.mjs) and, as explicit file arguments AFTER the run ended, the A10 RESULT (parity authority),
// the A9 RESULT (authority chain SHA only), the 1,657 oracle evidence (default-extent portfolio coverage) and the Phase 2-C2
// RESULT (historical reference only). It runs no Search, no kernel and no Planner, and feeds no evidence into any
// calculation. Candidate stable keys are written as SHA-256 digests; the raw keys stay in the raw record.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), a10: option('--a10-result'), a9: option('--a9-result'), oracle: option('--oracle'), c2: option('--c2-result'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26b1.mjs --run <b1-raw.json.local> --a10-result docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --c2-result docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const load = async path => {
  const raw = await readFile(path)
  return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } }
}
const [run, a10, a9, oracle, c2] = await Promise.all([load(paths.run), load(paths.a10), load(paths.a9), load(paths.oracle), load(paths.c2)])
const r = run.json
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B1Analysis.ts', 'scripts/analyze-planner-global-phase2c26b1.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

const countBy = (values, key) => {
  const out = {}
  for (const value of values) { const k = key(value); out[k] = (out[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0))
}
const median = values => { const s = [...values].sort((x, y) => x - y); return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const ranges = values => {
  const out = []
  for (const value of [...new Set(values)].sort((x, y) => x - y)) { const last = out.at(-1); if (last && value === last[1] + 1) last[1] = value; else out.push([value, value]) }
  return out
}
const reservationSummary = reservation => reservation === null ? null : {
  normal: reservation.normal.map(n => ({ counterId: n.counterId, held: ranges(n.held), blocked: ranges(n.blocked) })),
  skill: { held: ranges(reservation.skill.held), blocked: ranges(reservation.skill.blocked) },
  gogma: { held: ranges(reservation.gogma.held), blocked: ranges(reservation.gogma.blocked) },
  exclusiveOwnedWeaponIds: reservation.exclusiveOwnedWeaponIds,
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const b1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B1.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B1Analysis.ts')
  const c2Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2Analysis.ts')
  const c25aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts')

  // Authorities (re-read here; nothing the runner wrote is trusted for them).
  const parsed = b1.parsePhase2C26B1A10Authority(a10.json)
  if (!parsed.valid) throw new Error(`The A10 RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const authority = parsed.authority
  const a9ChainMatches = a9.source.sha256 === authority.a9ResultSha256 && r.environment.a9ResultSha256 === a9.source.sha256
  const a10ShaMatchesRun = r.environment.a10ResultSha256 === a10.source.sha256
  if (r.status !== 'completed') throw new Error(`The raw run did not complete (${r.status}).`)

  const { baseline, contexts } = r.contexts
  const tasks = r.plan.tasks
  // Parity, recomputed post-hoc from the raw contexts record.
  const baselineParity = b1.validatePhase2C26B1BaselineParity({ exportSha256: r.environment.exportSha256, summary: baseline.summary, orientations: baseline.orientations }, authority)
  const conditionParity = b1.validatePhase2C26B1ConditionParity({ extent: contexts[0]?.extent ?? null, calculationContext: r.contexts.calculationContext, researchMaxPlanSteps: r.contexts.researchMaxPlanSteps }, authority)
  const contextParity = b1.comparePhase2C26B1ContextsWithA10(contexts, authority)
  const recomputedPlan = b1.planPhase2C26B1SearchTasks(contexts)
  const planMatches = JSON.stringify(recomputedPlan) === JSON.stringify(r.plan)
  const formalRunValidation = analysis.validatePhase2C26B1FormalRun(r)

  // Execution.
  const allRuns = [...r.stage1, ...r.fallback]
  const stage1 = analysis.phase2c26b1ExecutionSummary(r.stage1)
  const fallbackSummary = analysis.phase2c26b1ExecutionSummary(r.fallback)
  const taskById = new Map(tasks.map(task => [task.taskId, task]))
  const orientationById = new Map(baseline.orientations.map(o => [o.orientationId, o]))
  const runRow = run => {
    const task = taskById.get(run.taskId)
    const representative = orientationById.get(task.representative.orientationId)
    const context = run.record?.status === 'searched' ? run.record.context : null
    return { taskId: run.taskId, executionClass: run.executionClass, targetWeaponId: task.targetWeaponId, representativeOrientationId: task.representative.orientationId,
      representativeKind: representative.kind, aliases: task.aliases.map(alias => `${alias.orientationId}#${alias.workIndex}`), searchInputDigest: task.searchInputDigest,
      process: { outcome: run.process.outcome, wallMs: run.process.wallMs, exitCode: run.process.exitCode, stderrTail: run.process.stderrTail },
      childWallMs: run.childWallMs, preparationMs: run.preparationMs, memory: run.memory ?? { lastIpcMemory: run.process.lastIpcMemory },
      outcome: run.outcome,
      search: context && { status: context.status, summary: context.summary, elapsedMs: context.elapsedMs, reservation: reservationSummary(context.reservation),
        excludedRouteKeySha256s: context.excludedRouteKeys.map(sha), fixedRouteBuildListEntryIds: context.fixedRouteBuildListEntryIds,
        candidates: context.candidates.map(x => ({ deliveredIndex: x.deliveredIndex, stableKeySha256: sha(x.stableKey), respectsReservation: x.reservationCheck.respects,
          heldRoute: x.summary.heldRoute, sourceKind: x.summary.sourceKind, routeKind: x.summary.routeKind, estimatedOperationCount: x.summary.estimatedOperationCount })) } }
  }
  const runRows = allRuns.map(runRow)
  const completedWall = allRuns.filter(run => b1.phase2c26b1Completed(run.outcome)).map(run => run.process.wallMs)
  const stage1ByKind = Object.fromEntries(Object.entries(runRows.filter(row => row.executionClass === 'stage1').reduce((acc, row) => { (acc[row.representativeKind] ??= []).push(row); return acc }, {}))
    .map(([kind, rows]) => [kind, countBy(rows, row => b1.phase2c26b1Completed(row.outcome) ? `completed:${row.outcome.searchStatus}` : row.outcome.record === 'context_mismatch' ? 'context_mismatch' : row.outcome.process)]))

  // Kernel trial prefix parity against every A10 completed kernel Target.
  const searchByTaskId = new Map(allRuns.filter(run => run.record?.status === 'searched').map(run => [run.taskId, {
    status: run.record.context.status, summary: run.record.context.summary, keySha256s: run.record.context.candidates.map(x => sha(x.stableKey)) }]))
  const prefix = analysis.phase2c26b1KernelPrefixParity(authority.rows, tasks, searchByTaskId, b1.PHASE2C26B1_CAPTURE_BOUND)

  // Participants.
  const coverage = b1.phase2c26b1ParticipantCoverage(r.participants, contexts, tasks, r.stage1.map(run => run.outcome), r.fallback.map(run => run.outcome))

  // Portfolio.
  const searched = allRuns.filter(run => run.record?.status === 'searched').map(run => ({ task: taskById.get(run.taskId), executionClass: run.executionClass, context: run.record.context }))
  const portfolio = b1.buildPhase2C26B1Portfolio({ originals: baseline.originals, orientations: baseline.orientations }, searched)
  const exploredTargets = new Set(coverage.rows.filter(row => row.explored).map(row => row.targetWeaponId))
  const portfolioSummary = analysis.phase2c26b1PortfolioSummary(portfolio, r.participants, exploredTargets)
  const portfolioRows = portfolio.map(p => ({
    targetWeaponId: p.targetWeaponId, conflictParticipant: p.conflictParticipant, explored: exploredTargets.has(p.targetWeaponId), searchedContexts: p.searchedContexts,
    diversity: p.diversity, diversityByPrefix: p.diversityByDefaultPrefix, has: p.has,
    candidates: p.candidates.map(c => {
      const keySha256 = sha(c.stableKey)
      return { stableKeySha256: keySha256, origin: c.origin, classification: c.origin === 'original' ? 'original' : 'search_delivered', summary: c.summary, provenance: c.provenance,
        kernelMetadata: c.origin === 'original' ? [] : analysis.phase2c26b1KernelMetadata(authority.rows, p.targetWeaponId, keySha256, c.provenance.map(x => x.orientationId)) }
    }),
  }))
  const kernelMetadataCounts = countBy(portfolioRows.flatMap(p => p.candidates.flatMap(c => c.kernelMetadata)), x => x.status)

  // 1,657 oracle: post-hoc default-extent portfolio coverage only.
  if (oracle.json.environment?.exportSha256 !== r.environment.exportSha256 || oracle.json.verdict !== 'proven_minimum') throw new Error('The oracle is not the proven minimum of this Export.')
  const oracleCoverage = c2Analysis.phase2c2OracleCoverage(portfolio, { routes: oracle.json.routes, gogmaUsage: oracle.json.gogmaUsage })
  const oracleRows = oracleCoverage.targets.map(row => ({ ...row, matchedStableKeySha256: row.matchedStableKey ? sha(row.matchedStableKey) : null, matchedStableKey: undefined,
    conflictParticipant: r.participants.includes(row.targetWeaponId), explored: exploredTargets.has(row.targetWeaponId) }))

  // Phase 2-C2 historical reference (descriptive; never a decision input).
  const c2View = c25aAnalysis.parsePhase2C25AC2Evidence(c2.json)
  const c2ContextReference = c2View.exportSha256 !== r.environment.exportSha256 ? { comparable: false, reason: 'another Export' } : (() => {
    const rows = c2View.orientations.filter(o => o.processOutcome === 'completed').map(o => {
      const own = contexts.filter(c => c.orientationId === o.orientationId).sort((x, y) => x.workIndex - y.workIndex)
      const parity = c25aAnalysis.comparePhase2C25AContextParity(own, o.kernelTargets, sha)
      return { orientationId: o.orientationId, matches: parity.matches, mismatchedTargets: parity.rows.filter(row => !row.matches).map(row => ({ targetWeaponId: row.targetWeaponId, checks: row.checks })) }
    })
    return { comparable: true, note: 'Phase 2-C2 measured an older Production; the context fields it recorded (fixed Route set, reservation ranges, excluded Route key SHA-256) are compared as a historical reference only.',
      orientations: rows.length, matching: rows.filter(row => row.matches).length, mismatches: rows.filter(row => !row.matches) }
  })()
  const c2Historical = { participantsExplored: c2.json.c3Readiness?.participantsExplored ?? null, participantsUnexplored: c2.json.c3Readiness?.participantsUnexplored ?? null,
    participantsWithMultiple: c2.json.portfolio?.summary?.participantsWithMultiple ?? null, oracleCovered: c2.json.oracleCoverage?.totals ? c2.json.oracleCoverage.totals.exact + c2.json.oracleCoverage.totals.partialComparable : null,
    note: 'Descriptive only: current Production and the measurement method (no kernel completion dependency, no probe extent) both differ from Phase 2-C2.' }

  // Decision.
  const contextMismatchTasks = allRuns.filter(run => run.outcome.record === 'context_mismatch').length
  const semanticFailures = analysis.phase2c26b1SemanticFailures({ authorityValid: parsed.valid && a10ShaMatchesRun, a9ChainMatches, baselineParityValid: baselineParity.valid && planMatches,
    conditionParityValid: conditionParity.valid, contextParityValid: contextParity.valid, contextMismatchTasks, kernelPrefixMismatches: prefix.mismatches.length,
    reservationViolations: portfolioSummary.reservationViolations })
  const formal = formalRunValidation.valid && !r.environment.uncommittedBenchmarkCode && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const decision = !formalRunValidation.valid ? null : analysis.phase2c26b1Decision({ semanticFailures, participantsTotal: coverage.total, participantsExplored: coverage.explored,
    unexploredWithOomOrFailure: coverage.unexploredWithOomOrFailure.length })

  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B1: default-extent Candidate portfolio from every orientation pre-Search context (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, a10Result: a10.source, a9Result: a9.source, oracle: oracle.source, c2Result: c2.source },
    provenance: { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      a10ResultSha256: a10.source.sha256, a10ResultRecordedByRunner: r.environment.a10ResultSha256, a10MeasuredHead: authority.measuredHead,
      a9ResultSha256: a9.source.sha256, a9ResultRecordedByRunner: r.environment.a9ResultSha256, a9ResultRecordedByA10: authority.a9ResultSha256, a9ChainMatches,
      oracleSha256: oracle.source.sha256, oracleReadByCalculation: false, measuredAt: r.measuredAt, runWallMs: r.wallMs },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, fallback: r.environment.fallback, contextsBudgetMs: r.environment.contextsBudgetMs, captureBound: r.environment.captureBound,
      extent: contexts[0]?.extent ?? null, extentLabel: r.environment.extentLabel, nodeYield: r.environment.nodeYield, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      notAttached: r.environment.notAttached, calculationContext: r.contexts.calculationContext, researchMaxPlanSteps: r.contexts.researchMaxPlanSteps,
      notRun: ['kernel', 'planner_trial', 'full_planner_rerun', 'extent_probe', 'global_assignment', 'candidate_combination_search', 'oracle_guided_search', 'multi_decision_reservation', '60_minute_budget'] },
    formalRunValidation,
    parity: { a10Authority: { valid: parsed.valid, decisionCase: authority ? a10.json.decision.case : null, orientations: authority.orientations.length, a10ShaMatchesRun },
      baseline: baselineParity, conditions: conditionParity, contexts: { ...contextParity, rows: undefined, rowsCompared: contextParity.rows.length },
      planRecomputedMatches: planMatches, kernelTrialPrefix: { totals: prefix.totals, trialsCompared: prefix.trialsCompared, endComparisons: prefix.endComparisons, mismatches: prefix.mismatches, rows: prefix.rows },
      c2HistoricalContextReference: c2ContextReference },
    baseline: { summary: baseline.summary, orientations: baseline.orientations.length, contextsChild: { wallMs: r.contexts.process.wallMs, memory: r.contexts.memory } },
    contexts: { orientations: baseline.orientations.length, derived: r.plan.derived, searchable: r.plan.searchable, blocked: r.plan.blocked, uniqueSearchInputs: r.plan.uniqueSearchInputs,
      dedupSavedRuns: r.plan.dedupSavedRuns, aliasGroups: tasks.filter(task => task.aliases.length > 1).map(task => ({ taskId: task.taskId, targetWeaponId: task.targetWeaponId,
        aliases: task.aliases.map(alias => `${alias.orientationId}#${alias.workIndex}`) })),
      perOrientation: baseline.orientations.map(o => ({ orientationId: o.orientationId, kind: o.kind, contexts: contexts.filter(c => c.orientationId === o.orientationId)
        .map(c => ({ workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, status: c.status, contextDigest: c.contextDigest, searchInputDigest: c.searchInputDigest,
          taskId: tasks.find(task => task.searchInputDigest === c.searchInputDigest)?.taskId ?? null, fixedRouteBuildListEntryIds: c.fixedRouteBuildListEntryIds,
          excludedRouteKeySha256s: c.excludedRouteKeys.map(sha), reservation: reservationSummary(c.reservation) })) })) },
    stage1: { ...stage1, byRepresentativeKind: stage1ByKind },
    fallback: { selection: r.fallbackSelection, ...fallbackSummary, newlyExploredParticipants: coverage.newlyExploredByFallback },
    runtime: { completedWallMs: { median: median(completedWall), max: completedWall.length ? Math.max(...completedWall) : null } },
    runs: runRows,
    participants: coverage,
    portfolio: { summary: portfolioSummary, kernelMetadataCounts, targets: portfolioRows },
    oracleCoverage: { scope: 'default-extent portfolio coverage (B1 runs no extent probe)', totals: oracleCoverage.totals, targets: oracleRows },
    c2Historical,
    decisionRule: analysis.PHASE2C26B1_DECISION_RULE,
    semanticFailures,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, formalRun: formalRunValidation.failures, parity: { baseline: baselineParity.valid, conditions: conditionParity.valid,
    contexts: contextParity.valid, plan: planMatches, prefix: prefix.totals, c2Reference: c2ContextReference.matching !== undefined ? `${c2ContextReference.matching}/${c2ContextReference.orientations}` : c2ContextReference },
    stage1, fallback: fallbackSummary, participants: { total: coverage.total, explored: coverage.explored, unexplored: coverage.unexplored },
    portfolio: portfolioSummary, oracle: oracleCoverage.totals, semanticFailures, decision }, null, 2))
} finally {
  await server.close()
}
