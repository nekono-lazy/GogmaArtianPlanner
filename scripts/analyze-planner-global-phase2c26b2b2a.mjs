// Issue #154 Phase 2-C2.6-B2-B2A post-hoc analysis only. Reads the finished B2-B2A raw run (written by
// run-planner-global-phase2c26b2b2a.mjs) and, as explicit file arguments AFTER the run ended, the B2-B1 RESULT (task
// selection authority), the B2-A RESULT and the 1,657 oracle RESULT plus manifest (hash chain and the unchanged Phase 2-C2
// oracle comparison), and optionally the B1 RESULT (historical-control reference only). It runs no Search, no kernel and no
// Planner, and feeds no evidence into any calculation. Candidate stable keys are written as SHA-256 digests; the raw keys
// stay in the raw record.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), b2b1: option('--b2b1-result'), b2a: option('--b2a-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26b2b2a.mjs --run <b2b2a-raw.json.local> --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--b1-result docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json] [--allow-nonformal]')
}
const b1Path = option('--b1-result')
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, b2b1File, b2aFile, oracleFile] = await Promise.all([loadRaw(paths.run), loadRaw(paths.b2b1), loadRaw(paths.b2a), loadRaw(paths.oracle)])
const manifestRaw = await readFile(paths.manifest)
const manifestSource = { file: basename(paths.manifest), bytes: manifestRaw.length, sha256: sha(manifestRaw) }
const b1File = b1Path ? await loadRaw(b1Path) : null
const r = runFile.json
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2B2AAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2b2a.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const smoke = r.environment.smoke !== null
const formalRun = r.status === 'completed' && !r.environment.uncommittedBenchmarkCode && !smoke
const formal = formalRun && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
if (!formalRun && !allowNonformal) throw new Error('The raw run is not a formal run (uncommitted benchmark code, smoke options or incomplete).')
if (r.status !== 'completed') throw new Error(`The raw run did not complete (${r.status}).`)

const ranges = values => {
  const out = []
  for (const value of [...new Set(values)].sort((x, y) => x - y)) { const last = out.at(-1); if (last && value === last[1] + 1) last[1] = value; else out.push([value, value]) }
  return out
}
const reservationRanges = reservation => ({
  normal: reservation.normal.map(n => ({ counterId: n.counterId, held: ranges(n.held), blocked: ranges(n.blocked) })),
  skill: { held: ranges(reservation.skill.held), blocked: ranges(reservation.skill.blocked) },
  gogma: { held: ranges(reservation.gogma.held), blocked: ranges(reservation.gogma.blocked) },
  exclusiveOwnedWeaponIds: reservation.exclusiveOwnedWeaponIds,
})
const stream = s => s === null ? null : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }
const compactSummary = s => ({ routeKind: s.routeKind, sourceKind: s.sourceKind, sourceOwnedWeaponId: s.sourceOwnedWeaponId, estimatedOperationCount: s.estimatedOperationCount,
  ownOperationCount: s.ownOperationCount, operationTypes: s.operationTypes, normalCounterId: s.normalCounterId, normalProductionTargetPosition: s.normalProductionTargetPosition,
  blindNormalCreation: s.blindNormalCreation, conversionSkillPosition: s.conversionSkillPosition, normal: stream(s.normal), gogma: stream(s.gogma), skill: stream(s.skill), heldRoute: s.heldRoute })
const runRow = run => run === null ? null : {
  executionClass: run.executionClass, process: run.process.outcome, timedOut: run.process.timedOut, budgetMs: run.process.budgetMs, wallMs: run.process.wallMs, childWallMs: run.childWallMs,
  snapshotMs: run.snapshotMs, yields: run.yields, record: run.outcome.record, searchStatus: run.outcome.searchStatus, delivered: run.outcome.delivered,
  searchElapsedMs: run.record?.status === 'searched' ? run.record.search.elapsedMs : null,
  peakHeapBytes: Math.max(run.memory?.sampledMaxHeapUsedBytes ?? 0, run.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  peakRssBytes: Math.max(run.memory?.sampledMaxRssBytes ?? 0, (run.memory?.maxRssKiB ?? 0) * 1024, run.lastIpcMemory?.maxRssBytes ?? 0),
  memorySamples: run.memory?.samples ?? null, contextMismatchIssues: run.record?.status === 'context_mismatch' ? run.record.issues : null, stderrTail: run.process.stderrTail ?? null }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const b2b2a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2AAnalysis.ts')
  const b2b1Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B1Analysis.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES

  // Authorities, re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  const parsed = b2b2a.parsePhase2C26B2B2AB2B1Authority(b2b1File.json, b2b1File.source.sha256)
  if (!parsed.valid) invalidReasons.push(...parsed.issues.map(i => `b2b1_authority: ${i}`))
  const authority = parsed.authority
  const b2a = b2b1Analysis.parsePhase2C26B2B1B2AAuthority(b2aFile.json, b2aFile.source.sha256)
  if (!b2a.valid) invalidReasons.push(...b2a.issues.map(i => `b2a_authority: ${i}`))
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(oracleFile.json)
  if (!oracleParse.valid) invalidReasons.push(...oracleParse.issues.map(i => `oracle: ${i}`))
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const exportSha256 = r.environment.exportSha256
  const hashChain = authority === null ? null : {
    b2b1ResultMatchesRunner: r.environment.b2b1ResultSha256 === b2b1File.source.sha256,
    b2aResultMatchesB2B1: b2aFile.source.sha256 === authority.b2aResultSha256,
    oracleMatchesB2B1: oracleFile.source.sha256 === authority.oracleResultSha256,
    oracleMatchesB2A: b2a.authority !== null && b2a.authority.oracleResultSha256 === oracleFile.source.sha256,
    manifestFileMatchesB2B1: manifestSource.sha256 === authority.oracleManifestFileSha256,
    manifestFileMatchesB2A: b2a.authority !== null && b2a.authority.oracleManifestFileSha256 === manifestSource.sha256,
    manifestRoutesMatchesB2B1: manifestRoutesSha256 === authority.oracleManifestRoutesSha256,
    manifestRoutesMatchesOracle: oracleParse.oracle !== null && oracleParse.oracle.manifestSha256 === manifestRoutesSha256,
    exportMatchesB2B1: exportSha256 === authority.exportSha256,
    exportMatchesB2A: b2a.authority !== null && b2a.authority.exportSha256 === exportSha256,
    exportMatchesOracle: oracleParse.oracle !== null && oracleParse.oracle.exportSha256 === exportSha256,
    b1ResultMatchesB2A: b1File === null ? null : b1File.source.sha256 === b2aFile.json.provenance?.b1ResultSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracleParse.oracle === null ? { valid: false, issues: ['no oracle'] } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracleParse.oracle, manifestRoutesSha256 === oracleParse.oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (authority === null || oracleParse.oracle === null) {
    const decision = analysis.phase2c26b2b2aDecision({ invalidReasons, tasks: 0, measured: 0, exact: 0 })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-B2A (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2B2A_INVALID: ${decision.reasons.join('; ')}`)
  }

  // Task selection and representative reconstruction, re-checked post hoc.
  const selection = b2b2a.selectPhase2C26B2B2ATasks(authority)
  if (!selection.valid) invalidReasons.push(...selection.issues.map(i => `selection: ${i}`))
  if (JSON.stringify(selection.selections) !== JSON.stringify(r.selection)) invalidReasons.push('selection: the runner selection is not the registered selection')
  const b2aRoutes = new Map(b2a.authority?.routes.map(route => [route.targetWeaponId, route]) ?? [])
  for (const s of selection.selections) {
    const b2aRoute = b2aRoutes.get(s.targetWeaponId)
    if (!b2aRoute || b2aRoute.covered !== (s.population === 'historically_covered_control') || (s.population === 'newly_recovered_default_extent' && !b2aRoute.contextGap)) invalidReasons.push(`selection: ${s.targetWeaponId}: the population is not B2-A's`)
  }
  const reconstruction = selection.selections.map((s, index) => {
    const context = r.contexts[index]
    if (!context || context.targetWeaponId !== s.targetWeaponId) return { targetWeaponId: s.targetWeaponId, matches: false, mismatches: ['missing'] }
    return b2b2a.comparePhase2C26B2B2AReconstruction(context, s, authority, sha)
  })
  if (!reconstruction.every(row => row.matches)) invalidReasons.push(`reconstruction: ${reconstruction.filter(row => !row.matches).map(row => `${row.targetWeaponId}(${row.mismatches.join('/')})`).join(', ')}`)
  const conditions = b2b2a.comparePhase2C26B2B2AConditions({ extent: r.tasksChild.snapshotSummary.extent, originDigest: r.tasksChild.snapshotSummary.originDigest,
    calculationContext: r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps, snapshotChecks: r.tasksChild.snapshotSummary.checks }, authority)
  if (!conditions.valid) invalidReasons.push(...conditions.issues.map(i => `conditions: ${i}`))
  const expectedTasks = r.contexts.map((context, index) => b2b2a.phase2c26b2b2aTaskInput(`t${String(index).padStart(2, '0')}`, 'stage1', context))
  if (JSON.stringify(expectedTasks) !== JSON.stringify(r.tasks)) invalidReasons.push('tasks: the runner tasks are not the reconstructed contexts')
  for (const run of [...r.stage1, ...r.fallback]) {
    if (run.record === null) continue
    if (JSON.stringify(run.calculationContext) !== JSON.stringify(authority.calculationContext) || run.researchMaxPlanSteps !== authority.researchMaxPlanSteps
      || run.rngEngineVersion !== r.environment.rngEngineVersion) invalidReasons.push(`conditions: ${run.taskId}/${run.executionClass}: CalculationContext / maxPlanSteps / Engine drift`)
  }
  for (const [name, expected] of [['captureBound', b2b2a.PHASE2C26B2B2A_CAPTURE_BOUND]]) if (r.environment[name] !== expected) invalidReasons.push(`conditions: ${name}`)
  if (!smoke && (JSON.stringify(r.environment.stage1) !== JSON.stringify(b2b2a.PHASE2C26B2B2A_STAGE1) || JSON.stringify(r.environment.fallback) !== JSON.stringify(b2b2a.PHASE2C26B2B2A_FALLBACK))) {
    invalidReasons.push('conditions: Stage 1 / fallback conditions are not the registered ones')
  }

  // Delivery, compared with the oracle only now.
  const audit = analysis.runPhase2C26B2B2AAnalysis({ selections: selection.selections, tasks: r.tasks, stage1: r.stage1, fallback: r.fallback,
    oracle: { routes: oracleFile.json.routes, gogmaUsage: oracleFile.json.gogmaUsage }, smoke })
  invalidReasons.push(...audit.invalidReasons)

  // B1 historical-control reference (descriptive; never a decision input).
  const b1Coverage = new Map((b1File?.json.oracleCoverage?.targets ?? []).map(row => [row.targetWeaponId, row]))
  const contextByTarget = new Map(r.contexts.map(c => [c.targetWeaponId, c]))
  const rows = audit.rows.map(row => {
    const context = contextByTarget.get(row.targetWeaponId)
    const selectionRow = selection.selections.find(s => s.targetWeaponId === row.targetWeaponId)
    const route = authority.routes.find(x => x.targetWeaponId === row.targetWeaponId)
    const c = row.comparison
    const b1 = b1Coverage.get(row.targetWeaponId)
    return {
      taskId: row.final.taskId, targetWeaponId: row.targetWeaponId, population: row.population, cardinality: row.cardinality,
      b2a: route.b2a, fixedSetId: context.fixedSetId, fixedTargetWeaponIds: context.fixedTargetWeaponIds, groupIndex: context.groupIndex, reservationDigest: context.reservationDigest,
      searchInputDigest: context.searchInputDigest, excludedRouteKeySha256: sha(context.excludedRouteKeys[0]), extent: context.extent, reservation: reservationRanges(context.reservation),
      representativeMatchesB2B1: selectionRow.representative.fixedSetId === context.fixedSetId && selectionRow.representative.reservationDigest === context.reservationDigest,
      formalRun: row.final.formalRun, measured: row.final.measured, stage1: runRow(row.final.stage1), fallback: runRow(row.final.fallback),
      search: row.final.search && { status: row.final.search.status, summary: row.final.search.summary, elapsedMs: row.final.search.elapsedMs,
        candidates: row.final.search.candidates.map(x => ({ deliveryIndex: x.deliveryIndex, stableKeySha256: sha(x.stableKey), respectsReservation: x.reservationCheck.respects,
          blockedHits: x.reservationCheck.blockedHits, exclusiveHit: x.reservationCheck.exclusiveHit, summary: compactSummary(x.summary) })) },
      comparison: { coverage: c.coverage, deliveryClass: c.deliveryClass, matchedDeliveryIndex: c.matchedDeliveryIndex,
        matchedDeliveryIndexBucket: c.matchedDeliveryIndex === null ? null : analysis.phase2c26b2b2aIndexBucket(c.matchedDeliveryIndex),
        matchedStableKeySha256: c.matchedStableKey === null ? null : sha(c.matchedStableKey), exactDeliveryIndexes: c.exactDeliveryIndexes, partialDeliveryIndexes: c.partialDeliveryIndexes,
        undetermined: c.undetermined, closestDifferences: c.closestDifferences, missingOracleFields: c.missingOracleFields, oracleHeldRoute: c.oracleHeldRoute },
      b1Reference: row.population !== 'historically_covered_control' || !b1 ? null : { b1Coverage: b1.coverage, b1MatchedStableKeySha256: b1.matchedStableKeySha256,
        sameMatchedKeyToday: c.matchedStableKey !== null && sha(c.matchedStableKey) === b1.matchedStableKeySha256 },
    }
  })

  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2b2aDecision({ invalidReasons, ...audit.decisionInput })
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-B2A: Search delivery of known-compatible default-extent representative contexts (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, b2b1Result: b2b1File.source, b2aResult: b2aFile.source, oracle: oracleFile.source, oracleManifest: manifestSource, b1Result: b1File?.source ?? null },
    provenance: { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: r.environment.exportBytes,
      b2b1ResultSha256: b2b1File.source.sha256, b2b1MeasuredHead: authority.measuredHead, b2b1AnalysisHead: authority.analysisHead,
      b2aResultSha256: b2aFile.source.sha256, b2aResultSha256RecordedByB2B1: authority.b2aResultSha256,
      oracleResultSha256: oracleFile.source.sha256, oracleResultSha256RecordedByB2B1: authority.oracleResultSha256,
      oracleManifestFileSha256: manifestSource.sha256, oracleManifestFileSha256RecordedByB2B1: authority.oracleManifestFileSha256,
      oracleManifestRoutesSha256: manifestRoutesSha256, oracleManifestRoutesSha256RecordedByB2B1: authority.oracleManifestRoutesSha256,
      oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false, measuredAt: r.measuredAt, runWallMs: r.wallMs },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, fallback: r.environment.fallback, tasksBudgetMs: r.environment.tasksBudgetMs, captureBound: r.environment.captureBound,
      extent: r.environment.extent, extentLabel: r.environment.extentLabel, nodeYield: r.environment.nodeYield, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      calculationContext: r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps, notRun: r.environment.notRun,
      taskSelection: 'B2-B1 routes with minimalCardinality 1 or 2 AND extent.withinDefaultExtent (oracle-guided diagnostic selection: B2-B1 judged both post hoc against the oracle Route)',
      searchRunnerKnows: ['targetWeaponId', 'Planner-start origin (re-derived)', 'Production default extent', 'reservation (re-derived)', 'excluded current Route key (re-derived)', 'capture bound 32'],
      searchRunnerNeverKnows: ['oracle RESULT', 'oracle manifest', 'oracle Candidate stable key', 'oracle operation positions', 'expected source', 'expected Route kind', 'expected delivery index'],
      limitation: 'The representative contexts were selected by B2-B1 post-hoc compatibility with the oracle Route. This measures only whether the Search delivers the Route once given such a context, never how to discover the context, and never that Production can choose it without the oracle.' },
    parity: { b2b1Authority: { valid: parsed.valid, decisionCase: b2b1File.json.decision?.case ?? null, measuredHead: authority.measuredHead }, b2aAuthority: { valid: b2a.valid },
      oracle: { valid: oracleParse.valid }, hashChain, manifestConsistency, selection: { valid: selection.valid, issues: selection.issues }, reconstruction, conditions },
    tasks: { total: selection.selections.length, historicallyCoveredControl: selection.selections.filter(s => s.population === 'historically_covered_control').length,
      newlyRecoveredDefaultExtent: selection.selections.filter(s => s.population === 'newly_recovered_default_extent').length,
      byCardinality: { K1: selection.selections.filter(s => s.representative.cardinality === 1).length, K2: selection.selections.filter(s => s.representative.cardinality === 2).length },
      distinctFixedSets: [...new Set(r.contexts.map(c => c.fixedSetId))].length, distinctReservations: [...new Set(r.contexts.map(c => c.reservationDigest))].length },
    aggregates: audit.aggregates,
    rows,
    decisionRule: analysis.PHASE2C26B2B2A_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, hashChain, reconstruction: `${reconstruction.filter(x => x.matches).length}/${reconstruction.length}`, conditions: conditions.valid,
    tasks: record.tasks, all: audit.aggregates.all, newly: audit.aggregates.newlyRecoveredDefaultExtent, controls: audit.aggregates.historicallyCoveredControl,
    diversity: { ...audit.aggregates.diversity, uniqueStableKeysPerTarget: undefined }, execution: audit.aggregates.execution,
    controlsB1: rows.filter(row => row.b1Reference).map(row => ({ target: row.targetWeaponId, ...row.b1Reference, today: row.comparison.deliveryClass })),
    invalidReasons: invalidReasons.slice(0, 20), decision }, null, 2))
} finally {
  await server.close()
}
