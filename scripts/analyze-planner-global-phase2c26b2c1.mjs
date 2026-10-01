// Issue #154 Phase 2-C2.6-B2-C1 post-hoc analysis only. Reads the finished B2-C1 context schedule (written by
// run-planner-global-phase2c26b2c1.mjs) and, as explicit file arguments AFTER the schedule ended, the B2-B1 RESULT
// (authority), the 1,657 oracle RESULT and the oracle manifest; the B2-B2A2 RESULT is hashed as provenance only and never
// parsed. It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation. The committed RESULT
// keeps aggregates and per-Target first-compatible rows; the full per-context raw stays in the .local schedule.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { schedule: option('--schedule'), b2b1: option('--b2b1-result'), b2b2a2: option('--b2b2a2-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c1.mjs --schedule <b2c1-raw.json.local> --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2b2a2-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [scheduleFile, b2b1File, b2b2a2File, oracleFile, manifestFile] = await Promise.all([loadRaw(paths.schedule), loadRaw(paths.b2b1), loadRaw(paths.b2b2a2), loadRaw(paths.oracle), loadRaw(paths.manifest)])
const run = JSON.parse(scheduleFile.raw.toString('utf8'))
const b2b1Json = JSON.parse(b2b1File.raw.toString('utf8'))
const oracleJson = JSON.parse(oracleFile.raw.toString('utf8'))
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts', 'scripts/analyze-planner-global-phase2c26b2c1.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = run.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const formalSchedule = run.status === 'completed' && !run.environment.uncommittedBenchmarkCode
const formal = formalSchedule && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
if (!formalSchedule && !allowNonformal) throw new Error('The schedule is not a formal run (uncommitted benchmark code or incomplete).')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES
  const schedule = run.schedule

  const b2b1 = analysis.parsePhase2C26B2C1B2B1Authority(b2b1Json, b2b1File.source.sha256)
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(oracleJson)
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C1: post-hoc oracle evaluation of the oracle-free fixed-set reservation context schedule (P0..P3)',
    analyzedAt: new Date().toISOString(),
    sources: { schedule: scheduleFile.source, b2b1Result: b2b1File.source, b2b2a2Result: b2b2a2File.source, oracle: oracleFile.source, oracleManifest: manifestFile.source } }
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const provenance = { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
    calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
    benchmarkCodeSha256: run.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: run.environment.uncommittedBenchmarkCode,
    exportFileName: run.environment.exportFileName, exportSha256: run.environment.exportSha256, exportBytes: run.environment.exportBytes,
    b2b1ResultSha256: b2b1File.source.sha256, b2b1MeasuredHead: b2b1.authority?.measuredHead ?? null, b2b1AnalysisHead: b2b1.authority?.analysisHead ?? null,
    b2b2a2ResultSha256: b2b2a2File.source.sha256, b2b2a2Use: 'latest research provenance hash only; never parsed, never a policy input',
    oracleResultSha256: oracleFile.source.sha256, oracleSha256RecordedByB2B1: b2b1.authority?.oracleResultSha256 ?? null,
    oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestFileSha256RecordedByB2B1: b2b1.authority?.oracleManifestFileSha256 ?? null,
    oracleManifestRoutesSha256: manifestRoutesSha256, oracleManifestSha256RecordedByOracle: oracleParse.oracle?.manifestSha256 ?? null,
    oracleReadByCalculation: false, oracleGuidedPolicyEvaluation: true, measuredAt: run.measuredAt, scheduleWallMs: run.timing?.wallMs ?? null }
  if (!b2b1.valid || !oracleParse.valid) {
    const decision = analysis.phase2c26b2c1Decision({ invalidReasons: [...b2b1.issues.map(i => `b2b1_authority: ${i}`), ...oracleParse.issues.map(i => `oracle: ${i}`)], recovered: 0, selectedFiniteRanks: [] })
    await writeFile(paths.output, JSON.stringify({ ...base, provenance, authority: { b2b1: b2b1.issues, oracle: oracleParse.issues }, decisionRule: analysis.PHASE2C26B2C1_DECISION_RULE, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C1_INVALID: ${decision.reasons.join('; ')}`)
  }
  const authority = b2b1.authority, oracle = oracleParse.oracle

  const exportParity = { schedule: run.environment.exportSha256, b2b1: authority.exportSha256, oracle: oracle.exportSha256,
    matches: run.environment.exportSha256 === authority.exportSha256 && authority.exportSha256 === oracle.exportSha256 }
  const authorityHashes = { oracleMatchesB2B1: authority.oracleResultSha256 === oracleFile.source.sha256, manifestFileMatchesB2B1: authority.oracleManifestFileSha256 === manifestFile.source.sha256,
    manifestRoutesMatchesB2B1: authority.oracleManifestRoutesSha256 === manifestRoutesSha256 }
  const manifestConsistency = b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  const audit = await analysis.runPhase2C26B2C1Audit({ schedule, authority, manifest, oracle, sha })
  // Raw / result consistency: the schedule record's own counts are the schedule's.
  const rawIssues = [
    ...(run.schedule.targets.reduce((sum, t) => sum + t.contexts, 0) === run.schedule.contexts.length ? [] : ['raw_result: the Target context counts do not add up to the context rows']),
    ...(run.environment.notRun?.includes('planner_alternative_search') ? [] : ['raw_result: the schedule run does not declare planner_alternative_search as not run']),
  ]
  const invalidReasons = [
    ...(exportParity.matches ? [] : ['export_sha_mismatch']),
    ...(authorityHashes.oracleMatchesB2B1 ? [] : ['oracle_result_is_not_the_one_b2b1_read']),
    ...(authorityHashes.manifestFileMatchesB2B1 && authorityHashes.manifestRoutesMatchesB2B1 ? [] : ['oracle_manifest_is_not_the_one_b2b1_read']),
    ...(manifestConsistency.valid ? [] : manifestConsistency.issues.map(i => `oracle_manifest: ${i}`)),
    ...(formal || allowNonformal ? [] : ['provenance: not formal']),
    ...rawIssues,
    ...audit.invalidReasons,
  ]
  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2c1Decision({ invalidReasons, ...audit.decisionInput })

  const fc = f => ({ rank: f.rank, reservationDigest: f.reservationDigest, cardinality: f.cardinality, representativeFixedSetId: f.representativeFixedSetId,
    representativeFixedTargetWeaponIds: f.representativeFixedTargetWeaponIds, k1Before: f.k1Before, k2Before: f.k2Before, representativeIncludesOracleSupporter: f.representativeIncludesOracleSupporter })
  const routeRows = audit.rows.map(row => ({
    targetWeaponId: row.targetWeaponId, subgroups: row.subgroups, b2b1: row.b2b1, contexts: row.reach.contexts, compatibleByCardinality: row.reach.compatibleByCardinality,
    minimalCardinality: row.reach.minimalCardinality, firstCompatible: Object.fromEntries(Object.entries(row.reach.firstCompatible).map(([p, f]) => [p, fc(f)])),
  }))
  const selectedPolicy = audit.selected.policy
  const selectedRecovered = audit.rows.filter(row => row.subgroups.includes('recovered'))
  const record = {
    ...base,
    provenance,
    environment: { runtime: run.environment.runtime, node: run.environment.node, v8: run.environment.v8, platform: run.environment.platform, arch: run.environment.arch,
      osRelease: run.environment.osRelease, cpu: run.environment.cpu, logicalCpuCount: run.environment.logicalCpuCount, totalMemoryBytes: run.environment.totalMemoryBytes,
      rngEngineVersion: run.environment.rngEngineVersion },
    conditions: { extent: schedule.extent, origins: schedule.origins, calculationContext: run.calculationContext, researchMaxPlanSteps: run.researchMaxPlanSteps, notRun: run.environment.notRun,
      policies: schedule.policies, budgets: analysis.PHASE2C26B2C1_BUDGETS, percentile: 'nearest rank: sorted[ceil(p / 100 * n) - 1]',
      compatible: 'reservation compatibility only (phase2c26b2aReachability); extent is a separate axis',
      oracleUse: 'post-hoc diagnostic fixture of Issue #154 only: never a context generator, a policy feature, a Search input, a Production heuristic or a game rule' },
    parity: { exportSha256: exportParity, authorityHashes, b2b1Authority: { valid: b2b1.valid, decisionCase: b2b1Json.decision.case, measuredHead: authority.measuredHead },
      b2b1Universe: audit.parity, manifest: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes } },
    scheduleConsistency: { valid: audit.consistency.valid, issues: audit.consistency.issues, snapshotChecks: schedule.snapshot.checks, checks: schedule.checks },
    contextUniverse: {
      targets: schedule.targets.length,
      fixedSets: Object.fromEntries([0, 1, 2].map(k => [`K${k}`, { proposed: schedule.snapshot.fixedSets.filter(r => r.cardinality === k).length, valid: schedule.snapshot.fixedSets.filter(r => r.cardinality === k && r.valid).length,
        invalid: schedule.snapshot.fixedSets.filter(r => r.cardinality === k && !r.valid).length }])),
      semanticReservations: schedule.snapshot.reservationGroups.length,
      targetSpecificContexts: schedule.contexts.length,
      targetSpecificContextsByEligibleMinCardinality: audit.featureAggregates.byCardinality,
      contextsWhoseTargetMinimumExceedsGroupMinimum: schedule.contexts.filter(c => c.targetEligibleMinCardinality > schedule.snapshot.reservationGroups[c.groupIndex].minCardinality).length,
      perTarget: schedule.targets.map(t => ({ targetWeaponId: t.targetWeaponId, contexts: t.contexts, relevantNormalCounterId: t.relevantNormalCounterId, windows: t.windows })),
    },
    featureAggregates: audit.featureAggregates,
    subgroupCounts: audit.subgroupCounts,
    policyAggregates: audit.policyAggregates,
    selection: { rule: analysis.PHASE2C26B2C1_SELECTION_RULE, rows: audit.selectionRows, selected: audit.selected, oracleGuidedPolicyEvaluation: true,
      selectedPolicySummary: { policy: selectedPolicy, recovered: analysis.phase2c26b2c1PolicyAggregate(selectedRecovered.map(row => row.reach.firstCompatible[selectedPolicy].rank)),
        firstCompatibleCardinality: Object.fromEntries(Object.entries(selectedRecovered.reduce((acc, row) => { const k = String(row.reach.firstCompatible[selectedPolicy].cardinality); acc[k] = (acc[k] ?? 0) + 1; return acc }, {})).sort()),
        representativeIncludesOracleSupporter: selectedRecovered.filter(row => row.reach.firstCompatible[selectedPolicy].representativeIncludesOracleSupporter === true).length } },
    routes: routeRows,
    decisionRule: analysis.PHASE2C26B2C1_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  const brief = policy => ({ recovered: audit.policyAggregates[policy].recovered.cdf, rank: audit.policyAggregates[policy].recovered.rank })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, exportParity: exportParity.matches, authorityHashes, manifest: manifestConsistency.valid,
    scheduleConsistency: audit.consistency.valid, parity: audit.parity.valid, subgroups: audit.subgroupCounts,
    policies: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map(p => [p, brief(p)])), selected: audit.selected,
    invalidReasons: invalidReasons.slice(0, 20), decision }, null, 2))
} finally {
  await server.close()
}
