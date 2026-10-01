// Issue #154 Phase 2-C2.6-B2-A post-hoc analysis only. Reads the finished B2-A context snapshot (written by
// run-planner-global-phase2c26b2a.mjs) and, as explicit file arguments AFTER the snapshot ended, the B1 RESULT (parity
// authority, B1 Search outcomes), the 1,657 oracle RESULT and the oracle manifest (exact operation segments). It runs no
// Search, no kernel and no Planner, and feeds no evidence into any calculation. Candidate stable keys and excluded Route
// keys are written as SHA-256 digests; position sets as closed ranges.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { snapshot: option('--snapshot'), b1: option('--b1-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26b2a.mjs --snapshot <b2a-raw.json.local> --b1-result docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [snapshotFile, b1File, oracleFile, manifestFile] = await Promise.all([loadRaw(paths.snapshot), loadRaw(paths.b1), loadRaw(paths.oracle), loadRaw(paths.manifest)])
const run = JSON.parse(snapshotFile.raw.toString('utf8'))
const b1Json = JSON.parse(b1File.raw.toString('utf8'))
const oracleJson = JSON.parse(oracleFile.raw.toString('utf8'))
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2a.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = run.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const formalSnapshot = run.status === 'completed' && !run.environment.uncommittedBenchmarkCode
const formal = formalSnapshot && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
if (!formalSnapshot && !allowNonformal) throw new Error('The snapshot is not a formal run (uncommitted benchmark code or incomplete).')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES
  const R = analysis.phase2c26b2aRanges

  // Authorities (re-read here; nothing the snapshot run wrote is trusted for them).
  const b1 = analysis.parsePhase2C26B2AB1Authority(b1Json)
  const oracleParse = analysis.parsePhase2C26B2AOracle(oracleJson)
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-A: post-hoc reachability audit of the 1,657 oracle Routes against the B1 single-winner pre-Search contexts',
    analyzedAt: new Date().toISOString(),
    sources: { snapshot: snapshotFile.source, b1Result: b1File.source, oracle: oracleFile.source, oracleManifest: manifestFile.source } }
  const provenance = { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
    calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
    benchmarkCodeSha256: run.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: run.environment.uncommittedBenchmarkCode,
    exportFileName: run.environment.exportFileName, exportSha256: run.environment.exportSha256, exportBytes: run.environment.exportBytes,
    b1ResultSha256: b1File.source.sha256, b1MeasuredHead: b1.authority?.measuredHead ?? null, b1AnalysisHead: b1.authority?.analysisHead ?? null,
    oracleResultSha256: oracleFile.source.sha256, oracleSha256RecordedByB1: b1.authority?.oracleSha256 ?? null,
    oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestRoutesSha256: sha(JSON.stringify(manifest)), oracleManifestSha256RecordedByOracle: oracleParse.oracle?.manifestSha256 ?? null,
    oracleReadByCalculation: false, measuredAt: run.measuredAt, snapshotWallMs: run.timing?.wallMs ?? null }
  if (!b1.valid || !oracleParse.valid) {
    const decision = analysis.phase2c26b2aDecision({ invalidReasons: [...b1.issues.map(i => `b1_authority: ${i}`), ...oracleParse.issues.map(i => `oracle: ${i}`)], uncovered: 0, probeGapRoutes: 0, contextGapRoutes: 0, unexplainedRoutes: 0 })
    await writeFile(paths.output, JSON.stringify({ ...base, provenance, authority: { b1: b1.issues, oracle: oracleParse.issues }, decisionRule: analysis.PHASE2C26B2A_DECISION_RULE, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2A-INVALID: ${decision.reasons.join('; ')}`)
  }
  const authority = b1.authority, oracle = oracleParse.oracle
  const snapshot = run.snapshot

  // Parity and consistency (each failure makes the case B2A-INVALID).
  const parity = analysis.validatePhase2C26B2AContextParity({ ...snapshot, exportSha256: run.environment.exportSha256, calculationContext: run.calculationContext,
    researchMaxPlanSteps: run.researchMaxPlanSteps }, authority, sha)
  const exportParity = { snapshot: run.environment.exportSha256, b1: authority.exportSha256, oracle: oracle.exportSha256,
    matches: run.environment.exportSha256 === authority.exportSha256 && authority.exportSha256 === oracle.exportSha256 }
  const oracleShaMatchesB1 = authority.oracleSha256 === oracleFile.source.sha256
  const manifestConsistency = analysis.validatePhase2C26B2AOracleManifest(manifest, oracle, provenance.oracleManifestRoutesSha256 === oracle.manifestSha256)
  const audit = await analysis.runPhase2C26B2AAudit({ snapshot, authority, manifest, oracle })

  const invalidReasons = [
    ...(parity.valid ? [] : parity.issues.map(i => `context_parity: ${i}`)),
    ...(exportParity.matches ? [] : ['export_sha_mismatch']),
    ...(oracleShaMatchesB1 ? [] : ['oracle_result_is_not_the_one_b1_read']),
    ...(manifestConsistency.valid ? [] : manifestConsistency.issues.map(i => `oracle_manifest: ${i}`)),
    ...audit.inconsistencies.map(i => `audit: ${i}`),
  ]
  const uncovered = audit.routes.filter(r => !r.audit.covered)
  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2aDecision({ invalidReasons, uncovered: uncovered.length,
    probeGapRoutes: uncovered.filter(r => r.audit.probeGap).length, contextGapRoutes: uncovered.filter(r => r.audit.contextGap).length, unexplainedRoutes: audit.unexplained.length })

  const laneRow = lane => lane === null ? null : { compatible: lane.compatible, missingHeld: R(lane.missingHeld), blockedOwn: R(lane.blockedOwn), heldPrefixOverlap: R(lane.heldPrefixOverlap),
    productionLimitAccepts: lane.productionLimitAccepts }
  const reachRow = reach => ({ compatible: reach.compatible, reasons: reach.reasons, lanes: { normal: laneRow(reach.lanes.normal), skill: laneRow(reach.lanes.skill), gogma: laneRow(reach.lanes.gogma) },
    productionLimitAccepts: reach.productionLimitAccepts })
  const routeRows = audit.routes.map(r => ({
    targetWeaponId: r.view.targetWeaponId, conflictParticipant: r.audit.conflictParticipant, covered: r.audit.covered, oracleHeldRoute: r.audit.oracleHeldRoute,
    sourceKind: r.view.sourceKind, sourceOwnedWeaponId: r.view.sourceOwnedWeaponId, method: r.view.method, normalCounterId: r.view.sourceKind === 'new_normal' ? r.view.normalCounterId : null,
    lanes: { normal: R(r.view.normal), conversion: r.view.conversion, skill: R(r.view.skill), gogma: R(r.view.gogma) }, required: r.view.required,
    origins: r.origins, extent: r.extent,
    emptyReservation: reachRow(r.emptyReservation),
    support: { needed: { normal: R(r.support.needed.normal), skill: R(r.support.needed.skill), gogma: R(r.support.needed.gogma) },
      neededCount: { normal: r.support.needed.normal.length, skill: r.support.needed.skill.length, gogma: r.support.needed.gogma.length },
      supportTargetWeaponIds: r.support.supportTargetWeaponIds, providers: r.support.providers, providerBucket: r.support.providerBucket,
      ambiguousPositions: r.support.ambiguousPositions, ambiguousCandidateTargetWeaponIds: r.support.ambiguousCandidateTargetWeaponIds,
      singleRouteCoverTargetWeaponIds: r.support.singleRouteCoverTargetWeaponIds },
    flags: r.audit.flags, probeGap: r.audit.probeGap, contextGap: r.audit.contextGap, extentRequiresLarger: r.audit.extentRequiresLarger,
    pattern: r.audit.covered ? null : analysis.phase2c26b2aPattern(r.contexts, r.emptyReservation),
    bestContext: (best => best === null ? null : { orientationId: best.orientationId, workIndex: best.workIndex, fixedTargetWeaponId: best.fixedTargetWeaponId,
      classification: best.classification, reasons: best.reservation.reasons,
      missingHeld: Object.fromEntries(['normal', 'skill', 'gogma'].map(lane => [lane, best.reservation.lanes[lane]?.missingHeld.length ?? null])),
      blockedOwn: Object.fromEntries(['normal', 'skill', 'gogma'].map(lane => [lane, best.reservation.lanes[lane]?.blockedOwn.length ?? null])) })(analysis.phase2c26b2aBestContext(r.contexts)),
    contextClasses: r.contexts.reduce((acc, row) => { acc[row.classification] = (acc[row.classification] ?? 0) + 1; return acc }, {}),
    contexts: r.contexts.map(row => ({ orientationId: row.orientationId, workIndex: row.workIndex, fixedTargetWeaponId: row.fixedTargetWeaponId,
      fixedTargetIsOracleSupporter: row.fixedTargetIsOracleSupporter, classification: row.classification, deliveredOracle: row.deliveredOracle,
      b1: { taskId: row.b1.taskId, status: row.b1.status, completedBy: row.b1.completedBy, delivered: row.b1.delivered, runs: row.b1.runs },
      reservation: reachRow(row.reservation) })),
  }))
  const snapshotRows = snapshot.contexts.map(c => ({ orientationId: c.orientationId, workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, status: c.status,
    contextDigest: c.contextDigest, searchInputDigest: c.searchInputDigest, originDigest: c.originDigest, fixedRouteBuildListEntryIds: c.fixedRouteBuildListEntryIds,
    invalidatedBuildListEntryId: c.invalidatedBuildListEntryId, excludedRouteKeySha256s: c.excludedRouteKeys.map(sha), extent: c.extent,
    reservation: analysis.phase2c26b2aReservationRanges(c.reservation),
    origin: { skill: c.origin.skillCounter.value, gogma: c.origin.gogmaCounter.value, normal: Object.fromEntries(c.origin.normalCounters.map(n => [n.counterId, n.counter])) } }))

  const record = {
    ...base,
    provenance,
    environment: { runtime: run.environment.runtime, node: run.environment.node, v8: run.environment.v8, platform: run.environment.platform, arch: run.environment.arch,
      osRelease: run.environment.osRelease, cpu: run.environment.cpu, logicalCpuCount: run.environment.logicalCpuCount, totalMemoryBytes: run.environment.totalMemoryBytes,
      rngEngineVersion: run.environment.rngEngineVersion },
    conditions: { extent: snapshot.contexts[0]?.extent ?? null, captureBound: authority.captureBound, calculationContext: run.calculationContext, researchMaxPlanSteps: run.researchMaxPlanSteps,
      notRun: run.environment.notRun, oracleUse: 'post-hoc diagnostic fixture of Issue #154 only: never a Production heuristic, never a Search input, never a game rule' },
    parity: { exportSha256: exportParity, b1Authority: { valid: b1.valid, decisionCase: b1Json.decision.case, measuredHead: authority.measuredHead, oracleShaMatchesB1 },
      contexts: parity },
    oracleConsistency: manifestConsistency,
    snapshot: { orientations: snapshot.baseline.orientations.length, contexts: snapshot.contexts.length, targets: new Set(snapshot.contexts.map(c => c.targetWeaponId)).size,
      originsUniform: parity.originsUniform, origin: snapshotRows[0]?.origin ?? null, baselineSummary: snapshot.baseline.summary, rows: snapshotRows },
    aggregates: audit.aggregates,
    unexplainedUncoveredRoutes: audit.unexplained,
    inconsistencies: audit.inconsistencies,
    routes: routeRows,
    decisionRule: analysis.PHASE2C26B2A_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, parity: parity.valid, exportParity: exportParity.matches, oracleShaMatchesB1, manifest: manifestConsistency.valid,
    inconsistencies: audit.inconsistencies.length, aggregates: { coverage: audit.aggregates.coverage, uncovered: audit.aggregates.uncovered, patterns: audit.aggregates.singleWinnerPatterns,
      contextClasses: audit.aggregates.contextClasses, reasons: audit.aggregates.incompatibilityReasons }, decision }, null, 2))
} finally {
  await server.close()
}
