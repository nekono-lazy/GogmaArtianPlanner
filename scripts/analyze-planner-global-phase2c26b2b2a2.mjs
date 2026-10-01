// Issue #154 Phase 2-C2.6-B2-B2A2 post-hoc analysis only. Reads the finished B2-B2A2 raw run (written by
// run-planner-global-phase2c26b2b2a2.mjs) and, as explicit file arguments AFTER the run ended, the B2-B2A RESULT (task
// selection and prior-prefix authority), the B2-B1 RESULT, the B2-A RESULT and the 1,657 oracle RESULT plus manifest (hash
// chain and the unchanged Phase 2-C2 oracle comparison), and optionally the B2-B2A raw run (supplementary prefix parity of
// the estimated advances, accepted only when its SHA-256 is the one the B2-B2A RESULT names). It runs no Search, no kernel
// and no Planner, and feeds no evidence into any calculation. Candidate stable keys are written as SHA-256 digests; the raw
// keys stay in the raw record.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), b2b2a: option('--b2b2a-result'), b2b1: option('--b2b1-result'), b2a: option('--b2a-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26b2b2a2.mjs --run <b2b2a2-raw.json.local> --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--b2b2a-raw <B2-B2A raw .json.local>] [--allow-nonformal]')
}
const b2b2aRawPath = option('--b2b2a-raw')
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, b2b2aFile, b2b1File, b2aFile, oracleFile] = await Promise.all([loadRaw(paths.run), loadRaw(paths.b2b2a), loadRaw(paths.b2b1), loadRaw(paths.b2a), loadRaw(paths.oracle)])
const manifestRaw = await readFile(paths.manifest)
const manifestSource = { file: basename(paths.manifest), bytes: manifestRaw.length, sha256: sha(manifestRaw) }
const b2b2aRawFile = b2b2aRawPath ? await loadRaw(b2b2aRawPath) : null
const r = runFile.json
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2B2A2Analysis.ts', 'scripts/analyze-planner-global-phase2c26b2b2a2.mjs']
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

const stream = s => s === null ? null : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }
const compactSummary = s => ({ routeKind: s.routeKind, sourceKind: s.sourceKind, sourceOwnedWeaponId: s.sourceOwnedWeaponId, estimatedOperationCount: s.estimatedOperationCount,
  estimatedAdvances: s.estimatedAdvances, ownOperationCount: s.ownOperationCount, operationTypes: s.operationTypes, normalCounterId: s.normalCounterId,
  normalProductionTargetPosition: s.normalProductionTargetPosition, blindNormalCreation: s.blindNormalCreation, conversionSkillPosition: s.conversionSkillPosition,
  normal: stream(s.normal), gogma: stream(s.gogma), skill: stream(s.skill), heldRoute: s.heldRoute })
const delivered = c => ({ deliveryIndex: c.deliveryIndex, stableKeySha256: sha(c.stableKey), orderingKeys: c.orderingKeys, comparatorWithPrevious: c.comparatorWithPrevious,
  respectsReservation: c.reservationCheck.respects, blockedHits: c.reservationCheck.blockedHits, exclusiveHit: c.reservationCheck.exclusiveHit, summary: compactSummary(c.summary) })
const runRow = run => run === null ? null : {
  executionClass: run.executionClass, process: run.process.outcome, timedOut: run.process.timedOut, budgetMs: run.process.budgetMs, wallMs: run.process.wallMs, childWallMs: run.childWallMs,
  snapshotMs: run.snapshotMs, yields: run.yields, record: run.outcome.record, searchStatus: run.outcome.searchStatus, termination: run.outcome.termination, cohortCandidates: run.outcome.cohortCandidates,
  searchElapsedMs: run.record?.status === 'searched' ? run.record.search.elapsedMs : null,
  peakHeapBytes: Math.max(run.memory?.sampledMaxHeapUsedBytes ?? 0, run.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  peakRssBytes: Math.max(run.memory?.sampledMaxRssBytes ?? 0, (run.memory?.maxRssKiB ?? 0) * 1024, run.lastIpcMemory?.maxRssBytes ?? 0),
  memorySamples: run.memory?.samples ?? null, contextMismatchIssues: run.record?.status === 'context_mismatch' ? run.record.issues : null, stderrTail: run.process.stderrTail ?? null }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const b2b2a2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A2.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A2Analysis.ts')
  const b2b2a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B2A.ts')
  const b2b1Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B1Analysis.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES

  // Authorities, re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  const parsed = b2b2a2.parsePhase2C26B2B2A2B2B2AAuthority(b2b2aFile.json, b2b2aFile.source.sha256)
  if (!parsed.valid) invalidReasons.push(...parsed.issues.map(i => `b2b2a_authority: ${i}`))
  const authority = parsed.authority
  const parsedB2B1 = b2b2a.parsePhase2C26B2B2AB2B1Authority(b2b1File.json, b2b1File.source.sha256)
  if (!parsedB2B1.valid) invalidReasons.push(...parsedB2B1.issues.map(i => `b2b1_authority: ${i}`))
  const b2b1Authority = parsedB2B1.authority
  const b2a = b2b1Analysis.parsePhase2C26B2B1B2AAuthority(b2aFile.json, b2aFile.source.sha256)
  if (!b2a.valid) invalidReasons.push(...b2a.issues.map(i => `b2a_authority: ${i}`))
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(oracleFile.json)
  if (!oracleParse.valid) invalidReasons.push(...oracleParse.issues.map(i => `oracle: ${i}`))
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const exportSha256 = r.environment.exportSha256
  const hashChain = authority === null ? null : {
    b2b2aResultMatchesRunner: r.environment.b2b2aResultSha256 === b2b2aFile.source.sha256,
    b2b1ResultMatchesRunner: r.environment.b2b1ResultSha256 === b2b1File.source.sha256,
    b2b1ResultMatchesB2B2A: b2b1File.source.sha256 === authority.b2b1ResultSha256,
    b2aResultMatchesB2B2A: b2aFile.source.sha256 === authority.b2aResultSha256,
    b2aResultMatchesB2B1: b2b1Authority !== null && b2aFile.source.sha256 === b2b1Authority.b2aResultSha256,
    oracleMatchesB2B2A: oracleFile.source.sha256 === authority.oracleResultSha256,
    oracleMatchesB2B1: b2b1Authority !== null && oracleFile.source.sha256 === b2b1Authority.oracleResultSha256,
    oracleMatchesB2A: b2a.authority !== null && b2a.authority.oracleResultSha256 === oracleFile.source.sha256,
    manifestFileMatchesB2B2A: manifestSource.sha256 === authority.oracleManifestFileSha256,
    manifestFileMatchesB2B1: b2b1Authority !== null && manifestSource.sha256 === b2b1Authority.oracleManifestFileSha256,
    manifestRoutesMatchesB2B2A: manifestRoutesSha256 === authority.oracleManifestRoutesSha256,
    manifestRoutesMatchesOracle: oracleParse.oracle !== null && oracleParse.oracle.manifestSha256 === manifestRoutesSha256,
    exportMatchesB2B2A: exportSha256 === authority.exportSha256,
    exportMatchesB2B1: b2b1Authority !== null && exportSha256 === b2b1Authority.exportSha256,
    exportMatchesB2A: b2a.authority !== null && b2a.authority.exportSha256 === exportSha256,
    exportMatchesOracle: oracleParse.oracle !== null && oracleParse.oracle.exportSha256 === exportSha256,
    b2b2aRawMatchesB2B2A: b2b2aRawFile === null ? null : b2b2aRawFile.source.sha256 === authority.rawRunSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracleParse.oracle === null ? { valid: false, issues: ['no oracle'] } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracleParse.oracle, manifestRoutesSha256 === oracleParse.oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (authority === null || b2b1Authority === null || oracleParse.oracle === null) {
    const decision = analysis.phase2c26b2b2a2Decision({ invalidReasons, tasks: 0, measured: 0, exact: 0, drained: 0 })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-B2A2 (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2B2A2_INVALID: ${decision.reasons.join('; ')}`)
  }

  // Task selection and context reconstruction, re-checked post hoc.
  const selection = b2b2a2.selectPhase2C26B2B2A2Tasks(authority)
  if (!selection.valid) invalidReasons.push(...selection.issues.map(i => `selection: ${i}`))
  if (JSON.stringify(selection.selections) !== JSON.stringify(r.selection)) invalidReasons.push('selection: the runner selection is not the registered selection')
  const b2b1Selection = b2b2a.selectPhase2C26B2B2ATasks(b2b1Authority)
  if (!b2b1Selection.valid) invalidReasons.push(...b2b1Selection.issues.map(i => `b2b1_selection: ${i}`))
  const ranges = context => b2aAnalysis.phase2c26b2aReservationRanges(context.reservation)
  const reconstruction = selection.selections.map((s, index) => {
    const context = r.contexts[index]
    const b2b1Row = b2b1Selection.selections.find(x => x.targetWeaponId === s.targetWeaponId)
    const b2b2aRow = authority.rows.find(x => x.targetWeaponId === s.targetWeaponId)
    if (!context || context.targetWeaponId !== s.targetWeaponId || !b2b1Row || !b2b2aRow) return { targetWeaponId: s.targetWeaponId, matches: false, mismatches: ['missing'] }
    const b2b1 = b2b2a.comparePhase2C26B2B2AReconstruction(context, b2b1Row, b2b1Authority, sha)
    const b2b2aParity = b2b2a2.comparePhase2C26B2B2A2RowReconstruction(context, b2b2aRow, sha, ranges)
    return { targetWeaponId: s.targetWeaponId, matches: b2b1.matches && b2b2aParity.matches, mismatches: [...b2b1.mismatches, ...b2b2aParity.mismatches.map(m => `b2b2a:${m}`)] }
  })
  if (!reconstruction.every(row => row.matches)) invalidReasons.push(`reconstruction: ${reconstruction.filter(row => !row.matches).map(row => `${row.targetWeaponId}(${row.mismatches.join('/')})`).join(', ')}`)
  const conditions = b2b2a.comparePhase2C26B2B2AConditions({ extent: r.tasksChild.snapshotSummary.extent, originDigest: r.tasksChild.snapshotSummary.originDigest,
    calculationContext: r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps, snapshotChecks: r.tasksChild.snapshotSummary.checks }, b2b1Authority)
  if (!conditions.valid) invalidReasons.push(...conditions.issues.map(i => `conditions: ${i}`))
  if (JSON.stringify(r.tasksChild.calculationContext) !== JSON.stringify(authority.calculationContext) || r.tasksChild.researchMaxPlanSteps !== authority.researchMaxPlanSteps) {
    invalidReasons.push('conditions: CalculationContext / maxPlanSteps differ from B2-B2A')
  }
  const expectedTasks = r.contexts.map((context, index) => b2b2a2.phase2c26b2b2a2TaskInput(`t${String(index).padStart(2, '0')}`, 'stage1', context, selection.selections[index]?.boundaryCost))
  if (JSON.stringify(expectedTasks) !== JSON.stringify(r.tasks)) invalidReasons.push('tasks: the runner tasks are not the reconstructed contexts with their boundary costs')
  for (const run of [...r.stage1, ...r.fallback]) {
    if (run.record === null) continue
    if (JSON.stringify(run.calculationContext) !== JSON.stringify(authority.calculationContext) || run.researchMaxPlanSteps !== authority.researchMaxPlanSteps
      || run.rngEngineVersion !== r.environment.rngEngineVersion) invalidReasons.push(`conditions: ${run.taskId}/${run.executionClass}: CalculationContext / maxPlanSteps / Engine drift`)
  }
  if (r.environment.cohortSafetyCap !== b2b2a2.PHASE2C26B2B2A2_COHORT_SAFETY_CAP) invalidReasons.push('conditions: cohortSafetyCap')
  if (JSON.stringify(r.environment.extent) !== JSON.stringify(authority.extent)) invalidReasons.push('conditions: extent')
  if (!smoke && (JSON.stringify(r.environment.stage1) !== JSON.stringify(b2b2a2.PHASE2C26B2B2A2_STAGE1) || JSON.stringify(r.environment.fallback) !== JSON.stringify(b2b2a2.PHASE2C26B2B2A2_FALLBACK))) {
    invalidReasons.push('conditions: Stage 1 / fallback conditions are not the registered ones')
  }

  // The supplementary B2-B2A raw prefix (estimated advances and the whole summary), only when it is the recorded raw.
  let rawPriorByTarget = null
  if (b2b2aRawFile !== null && hashChain.b2b2aRawMatchesB2B2A) {
    rawPriorByTarget = new Map()
    for (const s of selection.selections) {
      const runs = [...b2b2aRawFile.json.stage1, ...b2b2aRawFile.json.fallback]
      const formal = runs.filter(run => run.taskId === s.b2b2aTaskId && run.record?.status === 'searched').at(-1)
      if (formal && formal.record.search.targetWeaponId === s.targetWeaponId) rawPriorByTarget.set(s.targetWeaponId, formal.record.search.candidates.map(c => ({ stableKey: c.stableKey, summary: c.summary })))
    }
  }

  // Cohort delivery, compared with the oracle only now.
  const audit = analysis.runPhase2C26B2B2A2Analysis({ selections: selection.selections, tasks: r.tasks, stage1: r.stage1, fallback: r.fallback,
    oracle: { routes: oracleFile.json.routes, gogmaUsage: oracleFile.json.gogmaUsage }, sha, rawPriorByTarget, smoke })
  invalidReasons.push(...audit.invalidReasons)

  const contextByTarget = new Map(r.contexts.map(c => [c.targetWeaponId, c]))
  const rows = audit.rows.map(row => {
    const context = contextByTarget.get(row.targetWeaponId)
    const c = row.comparison
    const search = row.final.search
    const matched = c.firstExactIndex ?? c.firstPartialIndex
    return {
      taskId: row.final.taskId, targetWeaponId: row.targetWeaponId, b2b2aTaskId: row.selection.b2b2aTaskId, boundaryCost: row.selection.boundaryCost,
      fixedSetId: context.fixedSetId, fixedTargetWeaponIds: context.fixedTargetWeaponIds, groupIndex: context.groupIndex, reservationDigest: context.reservationDigest,
      searchInputDigest: context.searchInputDigest, excludedRouteKeySha256: sha(context.excludedRouteKeys[0]), extent: context.extent,
      reservation: b2aAnalysis.phase2c26b2aReservationRanges(context.reservation),
      formalRun: row.final.formalRun, measured: row.final.measured, stage1: runRow(row.final.stage1), fallback: runRow(row.final.fallback),
      prefixParity: row.prefixParity,
      cohort: row.cohort,
      search: search && { status: search.status, summary: search.summary, termination: search.termination, cohortDrained: search.cohortDrained, safetyCapHit: search.safetyCapHit,
        preferredOwnedWeaponId: search.preferredOwnedWeaponId, elapsedMs: search.elapsedMs,
        nextCostSentinel: search.nextCostSentinel === null ? null : delivered(search.nextCostSentinel),
        /** The matched Candidate (exact, else partial) and its neighbours; the whole cohort stays in the raw record. */
        matchedCandidate: matched === null ? null : delivered(search.cohort[matched]),
        priorCaptureBoundary: search.cohort.slice(30, 34).map(delivered),
        cohortTail: search.cohort.slice(-3).map(delivered) },
      comparison: { cohortClass: c.cohortClass, coverage: c.coverage, oracleOperationCost: c.oracleOperationCost, boundaryCost: c.boundaryCost,
        firstExactIndex: c.firstExactIndex, firstPartialIndex: c.firstPartialIndex, beyondPriorCapture: c.beyondPriorCapture, exactDeliveryIndexes: c.exactDeliveryIndexes,
        partialDeliveryIndexes: c.partialDeliveryIndexes, matchedStableKeySha256: c.matchedStableKey === null ? null : sha(c.matchedStableKey), matchedDeliveryIndex: c.matchedDeliveryIndex,
        undetermined: c.undetermined, closestDifferences: c.closestDifferences, oracleHeldRoute: c.oracleHeldRoute, orderingExplanation: c.orderingExplanation },
    }
  })

  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2b2a2Decision({ invalidReasons, ...audit.decisionInput })
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-B2A2: boundary operation-cost cohort drain (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, b2b2aResult: b2b2aFile.source, b2b1Result: b2b1File.source, b2aResult: b2aFile.source, oracle: oracleFile.source, oracleManifest: manifestSource,
      b2b2aRaw: b2b2aRawFile?.source ?? null },
    provenance: { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: r.environment.exportBytes,
      b2b2aResultSha256: b2b2aFile.source.sha256, b2b2aMeasuredHead: authority.measuredHead, b2b2aAnalysisHead: authority.analysisHead,
      b2b1ResultSha256: b2b1File.source.sha256, b2b1ResultSha256RecordedByB2B2A: authority.b2b1ResultSha256,
      b2aResultSha256: b2aFile.source.sha256, b2aResultSha256RecordedByB2B2A: authority.b2aResultSha256,
      oracleResultSha256: oracleFile.source.sha256, oracleResultSha256RecordedByB2B2A: authority.oracleResultSha256,
      oracleManifestFileSha256: manifestSource.sha256, oracleManifestFileSha256RecordedByB2B2A: authority.oracleManifestFileSha256,
      oracleManifestRoutesSha256: manifestRoutesSha256, oracleManifestRoutesSha256RecordedByB2B2A: authority.oracleManifestRoutesSha256,
      b2b2aRawSha256: b2b2aRawFile?.source.sha256 ?? null, b2b2aRawSha256RecordedByB2B2A: authority.rawRunSha256,
      oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false, measuredAt: r.measuredAt, runWallMs: r.wallMs },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, fallback: r.environment.fallback, tasksBudgetMs: r.environment.tasksBudgetMs, cohortSafetyCap: r.environment.cohortSafetyCap,
      priorPrefixLength: r.environment.priorPrefixLength, extent: r.environment.extent, extentLabel: r.environment.extentLabel, nodeYield: r.environment.nodeYield,
      memorySampleIntervalMs: r.environment.memorySampleIntervalMs, calculationContext: r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps,
      notRun: r.environment.notRun,
      taskSelection: 'B2-B2A rows with comparison.deliveryClass === capture_or_ordering_unresolved (oracle-guided diagnostic selection: B2-B2A judged the miss post hoc against the oracle Route); boundaryCost = that row\'s search.candidates[31].summary.estimatedOperationCount',
      searchRunnerKnows: ['targetWeaponId', 'fixed-set selector', 'reservation digest', 'searchInputDigest', 'Planner-start origin (re-derived)', 'Production default extent', 'reservation (re-derived)',
        'excluded current Route key (re-derived)', 'boundary operation cost', 'cohort safety cap 8192'],
      searchRunnerNeverKnows: ['oracle RESULT', 'oracle manifest', 'oracle Candidate stable key', 'oracle Route kind', 'oracle operation positions', 'oracle expected operation count', 'expected delivery index'],
      limitation: 'The contexts were selected by B2-B1 post-hoc compatibility with the oracle Route and the two tasks by B2-B2A post-hoc miss classification. This measures only where the oracle Route lies in the current Search delivery sequence of such a context, never how to discover the context, never that Production can choose it, and never that the Production capture bound should change.' },
    parity: { b2b2aAuthority: { valid: parsed.valid, decisionCase: b2b2aFile.json.decision?.case ?? null, measuredHead: authority.measuredHead }, b2b1Authority: { valid: parsedB2B1.valid },
      b2aAuthority: { valid: b2a.valid }, oracle: { valid: oracleParse.valid }, hashChain, manifestConsistency, selection: { valid: selection.valid, issues: selection.issues },
      reconstruction, conditions },
    tasks: { total: selection.selections.length, boundaryCosts: selection.selections.map(s => ({ targetWeaponId: s.targetWeaponId, boundaryCost: s.boundaryCost })) },
    aggregates: audit.aggregates,
    rows,
    decisionRule: analysis.PHASE2C26B2B2A2_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, hashChain, reconstruction: `${reconstruction.filter(x => x.matches).length}/${reconstruction.length}`, conditions: conditions.valid,
    aggregates: { ...audit.aggregates, execution: undefined }, execution: audit.aggregates.execution,
    rows: rows.map(row => ({ target: row.targetWeaponId, boundaryCost: row.boundaryCost, cohort: row.cohort && { ...row.cohort, boundaryCohort: undefined }, prefix: row.prefixParity && { valid: row.prefixParity.valid, stableKeyMatches: row.prefixParity.stableKeyMatches },
      cls: row.comparison.cohortClass, firstExact: row.comparison.firstExactIndex, firstPartial: row.comparison.firstPartialIndex, oracleCost: row.comparison.oracleOperationCost,
      ordering: row.comparison.orderingExplanation && { precededBy: row.comparison.orderingExplanation.precededBy, keys: row.comparison.orderingExplanation.exactOrderingKeys } })),
    invalidReasons: invalidReasons.slice(0, 20), decision }, null, 2))
} finally {
  await server.close()
}
