// Issue #154 Phase 2-C2.6-B2-C2B1 post-hoc analysis only. Reads the finished B2-C2B1 calculation (written by
// run-planner-global-phase2c26b2c2b1.mjs) and, as explicit file arguments AFTER the calculation ended, the B2-B1 RESULT
// (context universe / extent authority), the B2-C1 RESULT (subgroup / P1 rank authority), the B2-A RESULT (extent
// authority), the B2-C2A-R2 RESULT (default-extent Search validation complete), the 1,657 oracle RESULT and the oracle
// manifest. It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation. The committed RESULT
// keeps the per-Target extent rows, the cohort aggregates, the ladder and the decision; the per-context raw stays in .local.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { calculation: option('--calculation'), b2b1: option('--b2b1-result'), b2c1: option('--b2c1-result'), b2a: option('--b2a-result'), r2: option('--r2-result'),
  oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b1.mjs --calculation <b2c2b1-raw.json.local> --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --r2-result docs/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [calculationFile, b2b1File, b2c1File, b2aFile, r2File, oracleFile, manifestFile] = await Promise.all(
  [paths.calculation, paths.b2b1, paths.b2c1, paths.b2a, paths.r2, paths.oracle, paths.manifest].map(loadRaw))
const run = JSON.parse(calculationFile.raw.toString('utf8'))
const json = file => JSON.parse(file.raw.toString('utf8'))
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B1Analysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b1.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = run.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const formalRun = run.status === 'completed' && !run.environment.uncommittedBenchmarkCode
const formal = formalRun && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
if (!formalRun && !allowNonformal) throw new Error('The calculation is not a formal run (uncommitted benchmark code or incomplete).')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B1Analysis.ts')
  const c1Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES
  const calculation = run.calculation

  const b2b1 = c1Analysis.parsePhase2C26B2C1B2B1Authority(json(b2b1File), b2b1File.source.sha256)
  const b2c1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(json(b2c1File), b2c1File.source.sha256)
  const b2a = analysis.parsePhase2C26B2C2B1B2AAuthority(json(b2aFile), b2aFile.source.sha256)
  const r2 = analysis.parsePhase2C26B2C2B1R2Authority(json(r2File), r2File.source.sha256)
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(json(oracleFile))
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B1: post-hoc extent requirement characterization of the extent-insufficient Targets (E1 K1-minimal / E2 K2-minimal) and the E1 extent ladder',
    analyzedAt: new Date().toISOString(),
    sources: { calculation: calculationFile.source, b2b1Result: b2b1File.source, b2c1Result: b2c1File.source, b2aResult: b2aFile.source, r2Result: r2File.source,
      oracle: oracleFile.source, oracleManifest: manifestFile.source } }
  const provenance = { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
    calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
    benchmarkCodeSha256: run.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: run.environment.uncommittedBenchmarkCode,
    exportFileName: run.environment.exportFileName, exportSha256: run.environment.exportSha256, exportBytes: run.environment.exportBytes,
    b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256, b2aResultSha256: b2aFile.source.sha256, r2ResultSha256: r2File.source.sha256,
    oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestRoutesSha256: manifestRoutesSha256,
    r2Use: 'authority that the default-extent Search validation is complete (B2C2AR2_ALL_C4C) and that its 20 Targets are the defaultExtent subgroup; no extent requirement is derived from it',
    oracleReadByCalculation: false, oracleReadByAnalyzerOnly: true, oracleInformedLadder: true, targetIndividualOracleExtentAsSearchInput: false, oracleFedBackToCalculation: false,
    searchRun: false, measuredAt: run.measuredAt, calculationWallMs: run.timing?.wallMs ?? null }
  const authorityIssues = [...b2b1.issues.map(i => `b2b1_authority: ${i}`), ...b2c1.issues.map(i => `b2c1_authority: ${i}`), ...b2a.issues.map(i => `b2a_authority: ${i}`),
    ...r2.issues.map(i => `r2_authority: ${i}`), ...oracleParse.issues.map(i => `oracle: ${i}`)]
  if (authorityIssues.length > 0) {
    const decision = analysis.phase2c26b2c2b1Decision({ invalidReasons: authorityIssues, unreadableTargets: [], ladderBounded: false, e1: 0, e1CoveredByTopRung: 0 })
    await writeFile(paths.output, JSON.stringify({ ...base, provenance, authorityIssues, decisionRule: analysis.PHASE2C26B2C2B1_DECISION_RULE, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2B1_INVALID: ${decision.reasons.join('; ')}`)
  }
  const oracle = oracleParse.oracle

  const hashChain = {
    exportSha256: { calculation: run.environment.exportSha256, b2b1: b2b1.authority.exportSha256, b2c1: b2c1.authority.exportSha256, b2a: b2a.authority.exportSha256,
      r2: r2.authority.exportSha256, oracle: oracle.exportSha256 },
    oracleResultSha256: { file: oracleFile.source.sha256, b2b1: b2b1.authority.oracleResultSha256, b2c1: b2c1.authority.oracleResultSha256, b2a: b2a.authority.oracleResultSha256,
      r2: r2.authority.oracleResultSha256 },
    oracleManifestFileSha256: { file: manifestFile.source.sha256, b2b1: b2b1.authority.oracleManifestFileSha256, b2c1: b2c1.authority.oracleManifestFileSha256,
      b2a: b2a.authority.oracleManifestFileSha256, r2: r2.authority.oracleManifestFileSha256 },
    oracleManifestRoutesSha256: { file: manifestRoutesSha256, oracle: oracle.manifestSha256, b2b1: b2b1.authority.oracleManifestRoutesSha256, b2c1: b2c1.authority.oracleManifestRoutesSha256,
      b2a: b2a.authority.oracleManifestRoutesSha256, r2: r2.authority.oracleManifestRoutesSha256 },
    b2c1ResultSha256: { file: b2c1File.source.sha256, r2: r2.authority.b2c1ResultSha256 },
    b2b1ResultSha256: { file: b2b1File.source.sha256, b2c1: b2c1.authority.b2b1ResultSha256, r2: r2.authority.b2b1ResultSha256 },
  }
  const hashChainIssues = analysis.phase2c26b2c2b1HashChainIssues(hashChain)
  const manifestConsistency = b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  const audit = await analysis.runPhase2C26B2C2B1Audit({ calculation, b2b1: b2b1.authority, b2c1: b2c1.authority, b2a: b2a.authority, r2: r2.authority, manifest, oracle, sha })
  const ch = audit.characterization
  // Raw / result consistency: the calculation record's own counts are the calculation's.
  const rawIssues = [
    ...(calculation.schedule.targets.reduce((sum, t) => sum + t.contexts, 0) === calculation.schedule.contexts.length ? [] : ['raw_result: the Target context counts do not add up to the context rows']),
    ...(calculation.p1Ordering.length === calculation.schedule.targets.length ? [] : ['raw_result: the P1 ordering projection does not cover every Target']),
    ...(['planner_alternative_search', 'candidate_search', 'actual_search_probe'].every(item => run.environment.notRun?.includes(item)) ? [] : ['raw_result: the calculation run does not declare the Search as not run']),
  ]
  const invalidReasons = [
    ...hashChainIssues.map(i => `hash_chain: ${i}`),
    ...(manifestConsistency.valid ? [] : manifestConsistency.issues.map(i => `oracle_manifest: ${i}`)),
    ...(formal || allowNonformal ? [] : ['provenance: not formal']),
    ...rawIssues,
    ...audit.invalidReasons,
  ]
  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2c2b1Decision({ invalidReasons, ...ch.decisionInput })

  const routeRows = ch.rows.map(row => ({ targetWeaponId: row.targetWeaponId, cohort: row.cohort, minimalCardinality: row.minimalCardinality,
    p1FirstCompatibleRank: row.p1FirstCompatibleRank, p1FirstCompatibleReservationDigest: row.p1FirstCompatibleReservationDigest, route: row.route, origins: row.origins,
    defaultExtent: calculation.schedule.extent, reach: row.extent.reach, required: row.extent.required, verdict: row.extent.verdict, shortage: row.extent.shortage,
    insufficientStreams: row.extent.insufficientStreams, multiStream: row.extent.insufficientStreams.length > 1, unreadableStreams: row.extent.unreadableStreams,
    estimatedMatches: row.extent.estimatedMatches, firstLadderRung: ch.coverage ? (row.cohort === 'E1' ? ch.coverage.e1 : ch.coverage.e2Diagnostic).firstRung[row.targetWeaponId] : null,
    windowBoundary: row.windowBoundary, walkBoundary: row.walkBoundary, parity: row.parity }))
  const schedule = calculation.schedule
  const record = {
    ...base,
    provenance,
    environment: { runtime: run.environment.runtime, node: run.environment.node, v8: run.environment.v8, platform: run.environment.platform, arch: run.environment.arch,
      osRelease: run.environment.osRelease, cpu: run.environment.cpu, logicalCpuCount: run.environment.logicalCpuCount, totalMemoryBytes: run.environment.totalMemoryBytes,
      rngEngineVersion: run.environment.rngEngineVersion },
    conditions: { defaultExtent: schedule.extent, origins: schedule.origins, calculationContext: run.calculationContext, researchMaxPlanSteps: run.researchMaxPlanSteps, notRun: run.environment.notRun,
      orderingPolicy: calculation.orderingPolicy, p1: schedule.policies.find(p => p.id === 'P1'), extentSemantics: analysis.PHASE2C26B2C2B1_DECISION_RULE.extent,
      percentile: 'nearest rank: sorted[ceil(p / 100 * n) - 1]', ladderRule: analysis.PHASE2C26B2C2B1_LADDER_RULE, ladderCeiling: analysis.PHASE2C26B2C2B1_LADDER_CEILING,
      oracleUse: 'post-hoc diagnostic fixture of Issue #154 only: never a context generator, a policy feature, a Search input, a Production heuristic or a game rule' },
    hashChain, hashChainIssues,
    parity: {
      authorities: { b2b1: { valid: b2b1.valid, measuredHead: b2b1.authority.measuredHead }, b2c1: { valid: b2c1.valid, measuredHead: b2c1.authority.measuredHead },
        b2a: { valid: b2a.valid, measuredHead: b2a.authority.measuredHead }, r2: { valid: r2.valid, measuredHead: r2.authority.measuredHead, defaultExtentTargets: r2.authority.defaultExtentTargetWeaponIds.length } },
      manifest: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes },
      b2c1Audit: { scheduleConsistency: audit.c1.consistency.valid, b2b1Universe: audit.c1.parity.valid, subgroupCounts: audit.c1.subgroupCounts, invalidReasons: audit.c1.invalidReasons },
      calculation: { checks: calculation.checks, scheduleChecks: schedule.checks, snapshotChecks: schedule.snapshot.checks },
    },
    contextUniverse: { targets: schedule.targets.length, semanticReservations: schedule.snapshot.reservationGroups.length, targetSpecificContexts: schedule.contexts.length,
      p1Ordering: calculation.p1Ordering },
    cohorts: ch.cohorts,
    aggregates: ch.aggregates,
    ladder: ch.ladder, ladderCoverage: ch.coverage ? { e1: { byRung: ch.coverage.e1.byRung, firstRungHistogram: ch.coverage.e1.firstRungHistogram },
      e2Diagnostic: { byRung: ch.coverage.e2Diagnostic.byRung, firstRungHistogram: ch.coverage.e2Diagnostic.firstRungHistogram } } : null,
    routes: routeRows,
    unreadableTargets: ch.unreadableTargets,
    decisionRule: analysis.PHASE2C26B2C2B1_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, hashChainIssues, manifest: manifestConsistency.valid, cohorts: ch.cohorts.counts,
    e1: { byStream: ch.aggregates.e1.insufficientTargetsByStream, required: ch.aggregates.e1.required }, e2: { byStream: ch.aggregates.e2.insufficientTargetsByStream, required: ch.aggregates.e2.required },
    ladder: ch.ladder, coverage: record.ladderCoverage, invalidReasons: invalidReasons.slice(0, 20), decision }, null, 2))
} finally {
  await server.close()
}
