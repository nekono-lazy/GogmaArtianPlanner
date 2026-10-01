// Issue #154 Phase 2-C2.6-B2-B1 post-hoc analysis only. Reads the finished B2-B1 fixed-set reservation snapshot (written
// by run-planner-global-phase2c26b2b1.mjs) and, as explicit file arguments AFTER the snapshot ended, the B2-A RESULT
// (authority), the 1,657 oracle RESULT and the oracle manifest. It runs no Search, no kernel and no Planner, and feeds no
// evidence into any calculation. Route keys are written as SHA-256 digests; position sets as closed ranges.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { snapshot: option('--snapshot'), b2a: option('--b2a-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26b2b1.mjs --snapshot <b2b1-raw.json.local> --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [snapshotFile, b2aFile, oracleFile, manifestFile] = await Promise.all([loadRaw(paths.snapshot), loadRaw(paths.b2a), loadRaw(paths.oracle), loadRaw(paths.manifest)])
const run = JSON.parse(snapshotFile.raw.toString('utf8'))
const b2aJson = JSON.parse(b2aFile.raw.toString('utf8'))
const oracleJson = JSON.parse(oracleFile.raw.toString('utf8'))
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2B1Analysis.ts', 'scripts/analyze-planner-global-phase2c26b2b1.mjs']
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
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2B1Analysis.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES
  const snapshot = run.snapshot

  const b2a = analysis.parsePhase2C26B2B1B2AAuthority(b2aJson, b2aFile.source.sha256)
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(oracleJson)
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-B1: post-hoc oracle reachability of the all-current K0 / K1 / K2 fixed-set reservations',
    analyzedAt: new Date().toISOString(),
    sources: { snapshot: snapshotFile.source, b2aResult: b2aFile.source, oracle: oracleFile.source, oracleManifest: manifestFile.source } }
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const provenance = { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
    calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
    benchmarkCodeSha256: run.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: run.environment.uncommittedBenchmarkCode,
    exportFileName: run.environment.exportFileName, exportSha256: run.environment.exportSha256, exportBytes: run.environment.exportBytes,
    b2aResultSha256: b2aFile.source.sha256, b2aMeasuredHead: b2a.authority?.measuredHead ?? null, b2aAnalysisHead: b2a.authority?.analysisHead ?? null,
    oracleResultSha256: oracleFile.source.sha256, oracleSha256RecordedByB2A: b2a.authority?.oracleResultSha256 ?? null,
    oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestFileSha256RecordedByB2A: b2a.authority?.oracleManifestFileSha256 ?? null,
    oracleManifestRoutesSha256: manifestRoutesSha256, oracleManifestSha256RecordedByOracle: oracleParse.oracle?.manifestSha256 ?? null,
    oracleReadByCalculation: false, measuredAt: run.measuredAt, snapshotWallMs: run.timing?.wallMs ?? null }
  if (!b2a.valid || !oracleParse.valid) {
    const decision = analysis.phase2c26b2b1Decision({ invalidReasons: [...b2a.issues.map(i => `b2a_authority: ${i}`), ...oracleParse.issues.map(i => `oracle: ${i}`)], searchEligibleContextGaps: 0, recovered: 0 })
    await writeFile(paths.output, JSON.stringify({ ...base, provenance, authority: { b2a: b2a.issues, oracle: oracleParse.issues }, decisionRule: analysis.PHASE2C26B2B1_DECISION_RULE, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2B1_INVALID: ${decision.reasons.join('; ')}`)
  }
  const authority = b2a.authority, oracle = oracleParse.oracle

  const exportParity = { snapshot: run.environment.exportSha256, b2a: authority.exportSha256, oracle: oracle.exportSha256,
    matches: run.environment.exportSha256 === authority.exportSha256 && authority.exportSha256 === oracle.exportSha256 }
  const authorityHashes = { oracleMatchesB2A: authority.oracleResultSha256 === oracleFile.source.sha256, manifestFileMatchesB2A: authority.oracleManifestFileSha256 === manifestFile.source.sha256,
    manifestRoutesMatchesB2A: authority.oracleManifestRoutesSha256 === manifestRoutesSha256 }
  const manifestConsistency = b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  const audit = await analysis.runPhase2C26B2B1Audit({ snapshot, authority, manifest, oracle, sha })
  const invalidReasons = [
    ...(exportParity.matches ? [] : ['export_sha_mismatch']),
    ...(authorityHashes.oracleMatchesB2A ? [] : ['oracle_result_is_not_the_one_b2a_read']),
    ...(authorityHashes.manifestFileMatchesB2A && authorityHashes.manifestRoutesMatchesB2A ? [] : ['oracle_manifest_is_not_the_one_b2a_read']),
    ...(manifestConsistency.valid ? [] : manifestConsistency.issues.map(i => `oracle_manifest: ${i}`)),
    ...audit.invalidReasons,
  ]
  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2b1Decision({ invalidReasons, ...audit.decisionInput })

  const fixedSetRows = snapshot.fixedSets
  const validRows = fixedSetRows.filter(row => row.valid)
  const aliasDistribution = {}
  for (const group of snapshot.reservationGroups) aliasDistribution[group.aliasFixedSetIds.length] = (aliasDistribution[group.aliasFixedSetIds.length] ?? 0) + 1
  const rawContexts = snapshot.targetContexts.reduce((sum, row) => sum + row.rawContexts, 0)
  const uniqueContexts = snapshot.targetContexts.reduce((sum, row) => sum + row.contexts.length, 0)
  const routeRows = audit.rows.map(row => ({
    targetWeaponId: row.targetWeaponId, b2a: row.b2a,
    minimalCardinality: row.reach.minimalCardinality, compatibleContexts: row.reach.compatibleContexts, anyK1Compatible: row.reach.anyK1Compatible, contextsChecked: row.reach.contextsChecked,
    representative: row.reach.representative, minimalAliases: row.reach.minimalAliases.map(a => a.fixedSetId),
    extent: { withinDefaultExtent: row.reach.extent.withinDefaultExtent, verdict: row.reach.extent.verdict, required: row.reach.extent.required, reach: row.reach.extent.reach },
    unreachedPattern: row.reach.unreachedPattern, unreachedBestMissing: row.reach.unreachedBestMissing, heldUnion: row.reach.heldUnion, nonBlockingHeldUnion: row.reach.nonBlockingHeldUnion, oracleSupport: row.oracleSupport,
  }))
  const record = {
    ...base,
    provenance,
    environment: { runtime: run.environment.runtime, node: run.environment.node, v8: run.environment.v8, platform: run.environment.platform, arch: run.environment.arch,
      osRelease: run.environment.osRelease, cpu: run.environment.cpu, logicalCpuCount: run.environment.logicalCpuCount, totalMemoryBytes: run.environment.totalMemoryBytes,
      rngEngineVersion: run.environment.rngEngineVersion },
    conditions: { extent: snapshot.extent, calculationContext: run.calculationContext, researchMaxPlanSteps: run.researchMaxPlanSteps, notRun: run.environment.notRun,
      maxCardinality: 2, oracleUse: 'post-hoc diagnostic fixture of Issue #154 only: never a fixed-set selector, never a Production heuristic, never a Search input, never a game rule' },
    parity: { exportSha256: exportParity, authorityHashes, b2aAuthority: { valid: b2a.valid, decisionCase: b2aJson.decision.case, measuredHead: authority.measuredHead },
      origin: audit.parity.origin, k1Contexts: audit.parity.k1Contexts, reachability: audit.parity.reachability, issues: audit.parity.issues },
    oracleConsistency: manifestConsistency,
    currentInput: { ...snapshot.input, originDigest: snapshot.originDigest,
      origin: { skill: snapshot.origin.skillCounter.value, gogma: snapshot.origin.gogmaCounter.value, normal: Object.fromEntries(snapshot.origin.normalCounters.map(n => [n.counterId, n.counter])) },
      targets: snapshot.targets.map(t => ({ targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, currentRouteKeySha256: sha(t.currentRouteKey),
        checkpointHardConstraint: t.checkpointHardConstraint, initiallyRelevant: t.initiallyRelevant, originSemanticDigest: t.originSemanticDigest })) },
    snapshotConsistency: { valid: audit.consistency.valid, issues: audit.consistency.issues, checks: snapshot.checks },
    fixedSets: { ...audit.consistency.fixedSets,
      k2InvalidConflictKinds: Object.fromEntries(Object.entries(fixedSetRows.filter(row => row.cardinality === 2 && !row.valid).reduce((acc, row) => {
        acc[row.invalidConflictKinds.join('+') || 'route_plan_rejection'] = (acc[row.invalidConflictKinds.join('+') || 'route_plan_rejection'] ?? 0) + 1; return acc }, {})).sort()),
      k2InvalidConflictKindOccurrences: Object.fromEntries(Object.entries(fixedSetRows.filter(row => row.cardinality === 2 && !row.valid).flatMap(row => row.conflicts.map(c => c.kind))
        .reduce((acc, kind) => { acc[kind] = (acc[kind] ?? 0) + 1; return acc }, {})).sort()),
      invalidRows: fixedSetRows.filter(row => !row.valid).map(row => ({ fixedSetId: row.fixedSetId, fixedTargetWeaponIds: row.fixedTargetWeaponIds, routePlanRejectionEntryIds: row.routePlanRejectionEntryIds,
        conflicts: row.conflicts })) },
    reservations: { rawValidFixedSets: validRows.length, uniqueReservations: snapshot.reservationGroups.length, dedupSaved: validRows.length - snapshot.reservationGroups.length,
      aliasCountDistribution: aliasDistribution,
      groupsByMinCardinality: snapshot.reservationGroups.reduce((acc, g) => { acc[g.minCardinality] = (acc[g.minCardinality] ?? 0) + 1; return acc }, {}),
      groupsWithMixedCardinalityAliases: snapshot.reservationGroups.filter(g => Object.values(g.aliasesByCardinality).filter(n => n > 0).length > 1).length,
      groups: snapshot.reservationGroups.map(g => ({ groupIndex: g.groupIndex, reservationDigest: g.reservationDigest, minCardinality: g.minCardinality, aliasFixedSetIds: g.aliasFixedSetIds,
        reservation: b2aAnalysis.phase2c26b2aReservationRanges(g.reservation) })) },
    contexts: { rawTargetFixedSetContexts: rawContexts, uniqueSemanticContexts: uniqueContexts, dedupSaved: rawContexts - uniqueContexts,
      checkpointHardConstraintTargets: snapshot.targetContexts.filter(r => r.status === 'checkpoint_hard_constraint').length,
      perTarget: snapshot.targetContexts.map(r => ({ targetWeaponId: r.targetWeaponId, status: r.status, rawContexts: r.rawContexts, uniqueContexts: r.contexts.length,
        byMinCardinality: r.contexts.reduce((acc, c) => { acc[c[1]] = (acc[c[1]] ?? 0) + 1; return acc }, {}) })) },
    aggregates: audit.aggregates,
    routes: routeRows,
    decisionRule: analysis.PHASE2C26B2B1_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, exportParity: exportParity.matches, authorityHashes, manifest: manifestConsistency.valid,
    snapshotConsistency: audit.consistency.valid, parity: { origin: audit.parity.origin, k1: { checked: audit.parity.k1Contexts.checked, matched: audit.parity.k1Contexts.matched },
      reach: { ...audit.parity.reachability, mismatches: audit.parity.reachability.mismatches.length } },
    fixedSets: record.fixedSets.proposed, valid: record.fixedSets.valid, k2Kinds: record.fixedSets.k2InvalidConflictKinds,
    reservations: { raw: validRows.length, unique: snapshot.reservationGroups.length }, contexts: { raw: rawContexts, unique: uniqueContexts },
    aggregates: { all: audit.aggregates.all.minimalCardinality, contextGap: audit.aggregates.contextGap, nonParticipant: audit.aggregates.nonParticipantContextGap.minimalCardinality,
      participant: audit.aggregates.participantContextGap.minimalCardinality, held: audit.aggregates.uncoveredOracleHeld.minimalCardinality, patternCross: audit.aggregates.patternCross.contextGap,
      unreached: audit.aggregates.heldUnionMissingLanes },
    invalidReasons: invalidReasons.slice(0, 20), decision }, null, 2))
} finally {
  await server.close()
}
