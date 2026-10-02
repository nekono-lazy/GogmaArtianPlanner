// Issue #154 Phase 2-C2.6-B2-C2B2A post-hoc analysis only. Reads the finished B2-C2B2A raw run and its child records
// (written by run-planner-global-phase2c26b2c2b2a.mjs) and, as explicit file arguments AFTER the run ended, the E1 Target
// manifest, the Export (to re-derive the unchanged B2-C1 schedule), the B2-C2B1 RESULT (E1 population / L2 authority), the
// B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT (schedule parity / hash chain), the B2-C2A RESULT
// (diagnostic runtime comparison only) and the 1,657 oracle RESULT plus manifest (post-hoc reservation compatibility and
// Candidate coverage). It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation. Candidate
// stable keys are written as SHA-256 digests; the raw keys stay in the .local records.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), targets: option('--targets'), export: option('--export'), b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'),
  b2b1: option('--b2b1-result'), b2c2a: option('--b2c2a-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2a.mjs --run <raw.json.local> --run-dir <run dir> --targets <targets manifest> --export <external.json> --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, targetsFile, exportFile, b2c2b1File, b2c1File, b2b1File, b2c2aFile, oracleFile, manifestFile] = await Promise.all([paths.run, paths.targets, paths.export, paths.b2c2b1,
  paths.b2c1, paths.b2b1, paths.b2c2a, paths.oracle, paths.manifest].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
// The partial-raw reconstruction of the intentionally stopped run is post-hoc code too (it runs no Search and rewrites no record).
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2AAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2a.mjs', 'scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const smoke = r.environment.smoke !== null
// An intentionally stopped run is analyzed from its post-hoc reconstruction. Being intentionally stopped and reconstructed
// never makes it formal on its own: formal also needs launch provenance the runner itself attested (see launchProvenance).
const intentionallyStopped = r.status === 'intentionally_stopped' && r.intentionalStop !== undefined && r.reconstruction?.postHoc === true && r.reconstruction?.childRecordsModified === false
// A reconstructed raw's environment.uncommittedBenchmarkCode is a reconstruction value, not a launch observation: it is not read here.
const formalRunConditions = (r.status === 'completed' || intentionallyStopped) && !smoke
if (!formalRunConditions && !allowNonformal) throw new Error('The raw run is not a formal run (smoke options or incomplete).')
if (r.status !== 'completed' && !intentionallyStopped) throw new Error(`The raw run did not complete (${r.status}).`)
const intentionalStop = intentionallyStopped ? { stoppedAt: r.intentionalStop.stoppedAt, reason: r.intentionalStop.reason, notRunTaskIds: r.intentionalStop.notRunTaskIds } : null

const stream = s => s === null ? null : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }
const compactCandidate = c => c === null || c === undefined ? null : { deliveryIndex: c.deliveryIndex, stableKeySha256: sha(c.stableKey), orderingKeys: c.orderingKeys,
  respectsReservation: c.reservationCheck.respects, routeKind: c.summary.routeKind, sourceKind: c.summary.sourceKind, estimatedOperationCount: c.summary.estimatedOperationCount,
  estimatedAdvances: c.summary.estimatedAdvances, operationTypes: c.summary.operationTypes, normal: stream(c.summary.normal), gogma: stream(c.summary.gogma), skill: stream(c.summary.skill),
  heldRoute: c.summary.heldRoute }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const c2b2a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2A.ts')
  const targetsModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2AAnalysis.ts')
  const c2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2AAnalysis.ts')
  const b2c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const b2c1Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts')
  const b2aAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const hashing = await server.ssrLoadModule('/src/domain/models/hashing.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const manifestModule = await server.ssrLoadModule('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES

  // Launch provenance (evidence grade) is a separate axis from the Search decision. --allow-nonformal only lets a
  // non-formal RESULT be written; it never makes it formal.
  const launchProvenance = analysis.phase2c26b2c2b2aLaunchProvenance(r)
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2aEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: intentionallyStopped })
  const reconstructedLaunch = launchProvenance.source === 'none'

  // Authorities, re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  const parsedB2C2B1 = targetsModule.parsePhase2C26B2C2B2AB2C2B1Authority(json(b2c2b1File), b2c2b1File.source.sha256)
  if (!parsedB2C2B1.valid) invalidReasons.push(...parsedB2C2B1.issues.map(i => `b2c2b1_authority: ${i}`))
  const parsedB2C1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(json(b2c1File), b2c1File.source.sha256)
  if (!parsedB2C1.valid) invalidReasons.push(...parsedB2C1.issues.map(i => `b2c1_authority: ${i}`))
  const parsedB2B1 = b2c1Analysis.parsePhase2C26B2C1B2B1Authority(json(b2b1File), b2b1File.source.sha256)
  if (!parsedB2B1.valid) invalidReasons.push(...parsedB2B1.issues.map(i => `b2b1_authority: ${i}`))
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(json(oracleFile))
  if (!oracleParse.valid) invalidReasons.push(...oracleParse.issues.map(i => `oracle: ${i}`))
  const targetManifestParse = c2b2a.parsePhase2C26B2C2B2ATargetManifest(json(targetsFile))
  if (!targetManifestParse.valid) invalidReasons.push(...targetManifestParse.issues.map(i => `target_manifest: ${i}`))
  const authority = parsedB2C2B1.authority, b2c1Authority = parsedB2C1.authority, b2b1Authority = parsedB2B1.authority, oracle = oracleParse.oracle
  const targetManifest = targetManifestParse.manifest
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const exportSha256 = exportFile.source.sha256
  const ready = authority && b2c1Authority && b2b1Authority && oracle && targetManifest
  const hashChain = !ready ? null : {
    b2c2b1ResultIsRegistered: b2c2b1File.source.sha256 === c2b2a.PHASE2C26B2C2B2A_TARGET_SOURCE.resultSha256,
    targetManifestFromB2C2B1: targetManifest.sourceResultSha256 === b2c2b1File.source.sha256,
    targetManifestMatchesRunner: targetsFile.source.sha256 === r.environment.targetManifestSha256,
    targetManifestSourceMatchesRunner: targetManifest.sourceResultSha256 === r.environment.targetManifestSourceResultSha256,
    b2c1MatchesB2C2B1: b2c1File.source.sha256 === authority.b2c1ResultSha256,
    b2b1MatchesB2C2B1: b2b1File.source.sha256 === authority.b2b1ResultSha256,
    b2b1MatchesB2C1: b2b1File.source.sha256 === b2c1Authority.b2b1ResultSha256,
    oracleMatchesB2C2B1: oracleFile.source.sha256 === authority.oracleResultSha256,
    oracleMatchesB2C1: oracleFile.source.sha256 === b2c1Authority.oracleResultSha256,
    oracleMatchesB2B1: oracleFile.source.sha256 === b2b1Authority.oracleResultSha256,
    manifestFileMatchesB2C2B1: manifestFile.source.sha256 === authority.oracleManifestFileSha256,
    manifestFileMatchesB2C1: manifestFile.source.sha256 === b2c1Authority.oracleManifestFileSha256,
    manifestFileMatchesB2B1: manifestFile.source.sha256 === b2b1Authority.oracleManifestFileSha256,
    manifestRoutesMatchesB2C2B1: manifestRoutesSha256 === authority.oracleManifestRoutesSha256,
    manifestRoutesMatchesB2C1: manifestRoutesSha256 === b2c1Authority.oracleManifestRoutesSha256,
    manifestRoutesMatchesOracle: manifestRoutesSha256 === oracle.manifestSha256,
    exportMatchesRunner: exportSha256 === r.environment.exportSha256,
    exportMatchesTargetManifest: exportSha256 === targetManifest.exportSha256,
    exportMatchesB2C2B1: exportSha256 === authority.exportSha256,
    exportMatchesB2C1: exportSha256 === b2c1Authority.exportSha256,
    exportMatchesB2B1: exportSha256 === b2b1Authority.exportSha256,
    exportMatchesOracle: exportSha256 === oracle.exportSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracle === null ? { valid: false, issues: ['no oracle'], checkedRoutes: 0 } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (!ready) {
    const decision = analysis.phase2c26b2c2b2aDecision({ invalidReasons, tasks: 0, targets: 0, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-C2B2A (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2B2A_INVALID: ${decision.reasons.join('; ')}`)
  }
  // The population: the manifest must be exactly B2-C2B1's E1, cross-checked with the B2-C1 subgroups.
  const population = targetsModule.phase2c26b2c2b2aPopulation(authority, b2c1Authority)
  invalidReasons.push(...population.issues.map(i => `population: ${i}`))
  const expectedManifest = population.valid ? targetsModule.phase2c26b2c2b2aTargetManifest(authority, b2c1Authority) : null
  const populationParity = { manifestEqualsE1: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(targetManifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(targetManifest.targetWeaponIds), targets: targetManifest.targetWeaponIds.length,
    e1: authority.e1.length, e2: authority.e2.length, overlapsE2: targetManifest.targetWeaponIds.filter(id => authority.e2.includes(id)).length,
    overlapsDefaultExtent: targetManifest.targetWeaponIds.filter(id => b2c1Authority.routes.find(x => x.targetWeaponId === id)?.subgroups.includes('defaultExtent')).length,
    overlapsUnreached: targetManifest.targetWeaponIds.filter(id => b2c1Authority.routes.find(x => x.targetWeaponId === id)?.subgroups.includes('unreached')).length }
  if (!populationParity.manifestEqualsE1) invalidReasons.push('target_manifest: the manifest is not the B2-C2B1 E1 population')
  if (!populationParity.runnerTargetsEqualManifest) invalidReasons.push('target_manifest: the runner Targets are not the manifest Targets')

  // The schedule, re-derived from the Export through the unchanged B2-C1 calculation, and the P1 top-32 L2 task parity.
  const input = research.globalResearchInputFromExport(JSON.parse(exportFile.raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const scheduleConsistency = b2c1Analysis.validatePhase2C26B2C1Schedule(schedule)
  if (!scheduleConsistency.valid) invalidReasons.push(...scheduleConsistency.issues.map(i => `schedule: ${i}`))
  const b2b1Parity = b2c1Analysis.validatePhase2C26B2C1B2B1Parity(schedule, b2b1Authority, sha)
  if (!b2b1Parity.valid) invalidReasons.push(...b2b1Parity.issues.map(i => `b2b1_parity: ${i}`))
  const policyDrift = c2b2a.phase2c26b2c2b2aPolicyDrift(schedule)
  invalidReasons.push(...policyDrift.map(i => `policy: ${i}`))
  const rebuilt = c2b2a.buildPhase2C26B2C2B2ATasks(schedule, targetManifest.targetWeaponIds)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `tasks: ${i}`))
  const summary = r.tasksChild.scheduleSummary
  const commonExtent = JSON.stringify({ ...c2b2a.PHASE2C26B2C2B2A_EXTENT })
  const scheduleParity = {
    tasksMatchReDerivedSchedule: JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks),
    contextsDigestMatches: summary.contextsDigest === sha(hashing.stableStringify(schedule.contexts)),
    originDigestMatches: summary.originDigest === schedule.snapshot.originDigest,
    scheduleExtentIsDefault: JSON.stringify(summary.extent) === JSON.stringify(schedule.extent) && JSON.stringify(schedule.extent) === JSON.stringify(targetsModule.PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[0].extent),
    policiesMatch: JSON.stringify(summary.policies) === JSON.stringify(schedule.policies),
    everyTaskAtCommonL2: r.tasks.every(t => JSON.stringify(t.extent) === commonExtent) && JSON.stringify(r.environment.extent) === commonExtent,
    noTargetSpecificExtent: new Set(r.tasks.map(t => JSON.stringify(t.extent))).size === 1 && r.environment.perTargetExtent === false && r.environment.targetIndividualOracleExtentAsSearchInput === false,
    notRunMatchesIntentionalStop: intentionalStop === null ? r.stage1.length === r.tasks.length || smoke
      : r.stage1.length + intentionalStop.notRunTaskIds.length === r.tasks.length && JSON.stringify(r.notRun.map(t => t.taskId)) === JSON.stringify(intentionalStop.notRunTaskIds),
    calculationContextMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.calculationContext === null) || JSON.stringify(run.calculationContext) === JSON.stringify(input.calculationContext))
      && JSON.stringify(r.tasksChild.calculationContext) === JSON.stringify(input.calculationContext),
    engineMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.rngEngineVersion === null) || run.rngEngineVersion === engine.version) && r.environment.rngEngineVersion === engine.version,
    taskCount: r.tasks.length,
    ranksPerTarget: targetManifest.targetWeaponIds.every(id => JSON.stringify(r.tasks.filter(t => t.targetWeaponId === id).map(t => t.contextRank))
      === JSON.stringify(Array.from({ length: c2b2a.PHASE2C26B2C2B2A_CONTEXT_BUDGET }, (_, i) => i + 1))),
  }
  for (const [name, ok] of Object.entries(scheduleParity)) if (ok === false) invalidReasons.push(`schedule_parity: ${name}`)
  if (!smoke && (JSON.stringify(r.environment.stage1) !== JSON.stringify(c2b2a.PHASE2C26B2C2B2A_STAGE1) || r.environment.maxCostCohorts !== c2b2a.PHASE2C26B2C2B2A_MAX_COST_COHORTS
    || r.environment.candidateSafetyCap !== c2b2a.PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP || r.environment.contextBudget !== c2b2a.PHASE2C26B2C2B2A_CONTEXT_BUDGET
    || r.environment.expectedTasks !== c2b2a.PHASE2C26B2C2B2A_EXPECTED_TASKS)) {
    invalidReasons.push('conditions: Stage 1 / capture / budget conditions are not the registered ones')
  }
  for (const flag of ['oracleGuidedPolicySelection', 'oracleGuidedTargetPopulation', 'oracleInformedCommonExtent', 'commonExtentForEveryTask']) if (r.environment[flag] !== true) invalidReasons.push(`provenance: ${flag} is not true`)
  for (const flag of ['contextOrderingUsesOracle', 'oracleReadBySearchChild', 'oracleMatchUsedForEarlyStop', 'perTargetExtent', 'targetIndividualOracleExtentAsSearchInput']) {
    if (r.environment[flag] !== false) invalidReasons.push(`provenance: ${flag} is not false`)
  }
  if (JSON.stringify(r.environment.ladderRungsSearched) !== JSON.stringify(['L2'])) invalidReasons.push('provenance: a ladder rung other than L2 was searched')

  // Child records, each checked against the SHA-256 the runner recorded.
  const recordIssues = []
  const runs = []
  for (const run of r.stage1) {
    let record = null
    if (run.recordFile !== null) {
      const file = await loadRaw(join(paths.runDir, run.recordFile.file))
      if (file.source.sha256 !== run.recordFile.sha256 || file.source.bytes !== run.recordFile.bytes) recordIssues.push(`${run.taskId}: the record file is not the one the runner recorded`)
      const body = json(file)
      if (JSON.stringify(body.task) !== JSON.stringify(run.task) || body.role !== 'search') recordIssues.push(`${run.taskId}: the record is not this task's search record`)
      record = body.result
    } else if (run.outcome.process === 'completed') recordIssues.push(`${run.taskId}: a completed run without a record file`)
    runs.push({ ...run, record })
  }
  invalidReasons.push(...recordIssues.map(i => `raw_result: ${i}`))

  // Post-hoc compatibility (must reproduce B2-C1) and the oracle comparison.
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, targetManifest.targetWeaponIds, manifest, oracle)
  const b2c1FirstCompatible = new Map(b2c1Authority.routes.map(route => [route.targetWeaponId, route.p1FirstCompatible.rank]))
  const audit = analysis.runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: targetManifest.targetWeaponIds, tasks: r.tasks, runs, reach, b2c1FirstCompatible,
    oracle: { routes: oracle.routes, gogmaUsage: oracle.gogmaUsage }, smoke, intentionalStop })
  invalidReasons.push(...audit.invalidReasons)

  // Diagnostic runtime comparison with the B2-C2A default-extent Stage 1 (never a decision input).
  const b2c2aParse = analysis.parsePhase2C26B2C2B2AB2C2ADiagnostic(json(b2c2aFile), b2c2aFile.source.sha256, { b2c1ResultSha256: b2c1File.source.sha256, exportSha256 })
  if (!b2c2aParse.valid) invalidReasons.push(...b2c2aParse.issues.map(i => `b2c2a_diagnostic: ${i}`))
  const ex = audit.aggregates.execution
  const ratio = (a, b) => typeof a === 'number' && typeof b === 'number' && b > 0 ? a / b : null
  const runtimeComparison = b2c2aParse.diagnostic === null ? null : {
    note: 'Diagnostic only, never a decision input or a Production judgement. Different populations (B2-C2A: 20 default-extent Targets x P1 1..16; B2-C2B2A: 11 E1 Targets x P1 1..32) and different concurrency (3 vs 1) - process wall time is not directly comparable.',
    b2c2a: { ...b2c2aParse.diagnostic },
    b2c2b2a: { stage1: r.environment.stage1, extent: r.environment.extent, execution: { tasks: ex.tasks, completed: ex.completed, timeout: ex.timeout, outOfMemory: ex.outOfMemory,
      processFailure: ex.processFailure, safetyCapUnresolved: ex.safetyCapUnresolved, processWallMs: ex.processWallMs, searchElapsedMs: ex.searchElapsedMs, peakHeapBytesMax: ex.peakHeapBytesMax,
      peakRssBytesMax: ex.peakRssBytesMax, yields: ex.yields }, candidates: { termination: audit.aggregates.candidates.termination, captureLength: audit.aggregates.candidates.captureLength,
      costCohorts: audit.aggregates.candidates.costCohorts } },
    ratios: { searchElapsedMedian: ratio(ex.searchElapsedMs.median, b2c2aParse.diagnostic.execution.searchElapsedMs?.median),
      searchElapsedP90: ratio(ex.searchElapsedMs.p90, b2c2aParse.diagnostic.execution.searchElapsedMs?.p90),
      searchElapsedMax: ratio(ex.searchElapsedMs.max, b2c2aParse.diagnostic.execution.searchElapsedMs?.max),
      peakHeapMax: ratio(ex.peakHeapBytesMax, b2c2aParse.diagnostic.execution.peakHeapBytesMax), peakRssMax: ratio(ex.peakRssBytesMax, b2c2aParse.diagnostic.execution.peakRssBytesMax),
      yieldsMedian: ratio(ex.yields.median, b2c2aParse.diagnostic.execution.yields?.median) },
  }

  // Post-hoc diagnostic: what B2-C2B1 recorded about each E1 Route's extent, beside what this run did on that Target.
  const b2c2b1Routes = new Map((json(b2c2b1File).routes ?? []).map(route => [route.targetWeaponId, route]))
  const extentDiagnostic = targetManifest.targetWeaponIds.map((id, index) => {
    const route = b2c2b1Routes.get(id)
    const execution = audit.aggregates.execution.perTarget.find(row => row.targetWeaponId === id)
    return { targetIndex: index, targetWeaponId: id, b2c2b1: route === undefined ? null : { required: route.required, reach: route.reach, insufficientStreams: route.insufficientStreams,
      firstLadderRung: route.firstLadderRung, p1FirstCompatibleRank: route.p1FirstCompatibleRank, route: route.route }, searchExtent: r.environment.extent, execution }
  })
  const runOf = new Map(runs.map(run => [run.taskId, run]))
  const searchOf = run => run?.record?.status === 'searched' ? run.record.search : null
  const peak = run => ({ heap: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, (run?.memory?.maxRssKiB ?? 0) * 1024, run?.lastIpcMemory?.maxRssBytes ?? 0) })
  const taskRows = audit.contexts.map(c => {
    const run = runOf.get(c.taskId), s = searchOf(run)
    const task = r.tasks.find(t => t.taskId === c.taskId)
    return { taskId: c.taskId, targetWeaponId: c.targetWeaponId, contextRank: c.contextRank, groupIndex: c.groupIndex, reservationDigest: task.reservationDigest,
      targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds,
      defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: task.searchInputDigest, extent: s?.extent ?? null, excludedRouteKeySha256: s ? sha(s.excludedRouteKeys[0]) : null,
      process: run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, wallMs: run?.process.wallMs ?? null, searchElapsedMs: s?.elapsedMs ?? null, scheduleMs: run?.scheduleMs ?? null,
      peakHeapBytes: run ? peak(run).heap : null, peakRssBytes: run ? peak(run).rss : null, yields: run?.yields ?? null,
      status: s?.status ?? null, termination: s?.termination ?? null, candidateCount: c.candidateCount, deliveredCandidates: s?.summary.deliveredCandidates ?? null,
      excludedCandidates: s?.summary.excludedCandidates ?? null, distinctCostCohorts: s?.distinctCostCohorts ?? null, capturedCosts: c.capturedCosts, captureComplete: c.captureComplete,
      safetyCapHit: c.safetyCapHit, nextCostSentinel: s?.nextCostSentinel ? { deliveryIndex: s.nextCostSentinel.deliveryIndex, estimatedOperationCount: s.nextCostSentinel.orderingKeys.estimatedOperationCount } : null,
      compatible: c.compatible, coverage: c.coverage, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost, firstPartialIndex: c.firstPartialIndex, exactCount: c.exactIndexes.length,
      partialCount: c.partialIndexes.length, hit: c.hit, sentinelExact: c.sentinelExact, sentinelPartial: c.sentinelPartial, reservationViolations: c.reservationViolations,
      firstExactCandidate: c.firstExactIndex === null ? null : compactCandidate(s.candidates[c.firstExactIndex]) }
  })
  const firstCompatibleParity = audit.rows.map(row => {
    const b2c2b1Rank = authority.routes.find(x => x.targetWeaponId === row.targetWeaponId)?.p1FirstCompatibleRank ?? null
    return { targetWeaponId: row.targetWeaponId, b2c1: row.b2c1FirstCompatibleRank, b2c2b1: b2c2b1Rank, recomputed: row.recomputedFirstCompatibleRank,
      matches: row.b2c1FirstCompatibleRank === row.recomputedFirstCompatibleRank && row.b2c1FirstCompatibleRank === b2c2b1Rank }
  })
  for (const row of firstCompatibleParity) if (!row.matches) invalidReasons.push(`authority: ${row.targetWeaponId}: the P1 first compatible ranks of B2-C1 / B2-C2B1 / recomputation disagree`)
  const decision = !formal && !allowNonformal ? null : analysis.phase2c26b2c2b2aDecision({ invalidReasons, ...audit.decisionInput })
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2A: E1 P1 top-32 reservation contexts searched at the common L2 extent (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, targetManifest: targetsFile.source, export: exportFile.source, b2c2b1Result: b2c2b1File.source, b2c1Result: b2c1File.source, b2b1Result: b2b1File.source,
      b2c2aResult: b2c2aFile.source, oracle: oracleFile.source, oracleManifest: manifestFile.source },
    provenance: { formal, evidenceGrade, partialRun: intentionalStop !== null,
      launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source, launchProvenanceReason: launchProvenance.reason,
      launchWorkingTreeCleanVerified: launchProvenance.workingTreeCleanVerified, launchAttestation: r.launchAttestation ?? null,
      measuredHead, measuredHeadSource: reconstructedLaunch ? 'post_hoc_reconstruction_argument' : 'runner',
      reconstructedMeasuredHead: reconstructedLaunch ? measuredHead : null,
      measuredHeadNote: reconstructedLaunch ? 'The measurement candidate HEAD given to the post-hoc reconstruction; NOT a HEAD the runner attested at launch. The diff below is taken from it.' : null,
      analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, measurementCodeChangedSinceMeasuredHead: calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'],
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256,
      benchmarkCodeSha256Source: reconstructedLaunch ? 'recomputed post hoc from the git objects of the reconstruction-argument HEAD (runner rule); not a launch observation' : 'runner',
      // Unknown, never inferred: the launch working tree of a reconstructed run cannot be proven clean after the fact.
      uncommittedBenchmarkCode: reconstructedLaunch ? null : r.environment.uncommittedBenchmarkCode,
      rawRecordedUncommittedBenchmarkCode: reconstructedLaunch ? r.environment.uncommittedBenchmarkCode ?? null : undefined,
      smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: exportFile.source.bytes,
      b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c2b1MeasuredHead: authority.measuredHead, b2c1ResultSha256: b2c1File.source.sha256, b2c1MeasuredHead: b2c1Authority.measuredHead,
      b2b1ResultSha256: b2b1File.source.sha256, b2c2aResultSha256: b2c2aFile.source.sha256, oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256,
      oracleManifestRoutesSha256: manifestRoutesSha256, targetManifestSha256: targetsFile.source.sha256,
      oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, oracleInformedCommonExtent: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false,
      oracleMatchUsedForEarlyStop: false, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
      intentionalStop: intentionalStop === null ? null : r.intentionalStop, reconstruction: r.reconstruction ?? null },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, tasksBudgetMs: r.environment.tasksBudgetMs, contextBudget: r.environment.contextBudget, e1Targets: r.environment.e1Targets,
      expectedTasks: r.environment.expectedTasks, maxCostCohorts: r.environment.maxCostCohorts, candidateSafetyCap: r.environment.candidateSafetyCap, capturePrefixes: r.environment.capturePrefixes,
      capturePolicies: analysis.PHASE2C26B2C2B2A_CAPTURE_POLICIES, budgets: analysis.PHASE2C26B2C2B2A_BUDGETS, searchExtent: r.environment.extent, extentLabel: r.environment.extentLabel,
      scheduleExtent: schedule.extent, ladderRungsSearched: r.environment.ladderRungsSearched, nodeYield: r.environment.nodeYield, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      registeredP1: r.environment.registeredP1, origins: schedule.origins, calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps, notRun: r.environment.notRun,
      population: 'B2-C2B1 cohort E1 (extentInsufficient AND k1Minimal; oracle-guided population, declared), cross-checked with the B2-C1 subgroups: Target IDs only reach the Search runner',
      contextSelection: 'per Target the P1 ranks 1..32 of the schedule re-derived from the Export (derivePhase2C26B2C1Schedule(), Production default extent); no oracle compatibility, firstCompatible, required extent or ladder rung is read',
      extentRule: 'the unchanged reconstructPhase2C26B2B2AContext() at the default extent, then phase2c26b2c2b2aL2Context(): the extent alone replaced by the common L2 extent (B2-C2B1 ladder rung L2), every other field checked identical, the Search input digest recomputed by the unchanged phase2c26b1SearchInputDigest()',
      searchChildKnows: ['targetWeaponId', 'P1 context rank', 'reservation digest / group / representative alias (re-derived and checked)', 'Planner-start origin (re-derived)',
        'reservation (re-derived)', 'excluded current Route key (re-derived)', 'default / L2 Search input digests', 'the common L2 extent', 'capture rule (4 cost cohorts)', 'safety cap 1024'],
      searchChildNeverKnows: ['oracle RESULT', 'oracle manifest', 'B2-C1 firstCompatible', 'B2-C2B1 required extent', 'Target-specific minimum extent', 'expected exact stable key',
        'expected context rank', 'expected Candidate index', 'expected operation cost', 'expected route kind', 'compatibility', 'whether L1 already covers the Target'],
      limitation: 'E1, P1 and the L2 extent were chosen with post-hoc oracle evidence (B2-C1 / B2-C2B1). This measures only how far, on this Export and this population, searching the P1 top-32 contexts at one common L2 extent without oracle context selection rediscovers the exact oracle Route. It is not evidence that P1, a budget of 32, L2 or any capture policy is right for Production or for another Export.' },
    parity: { b2c2b1Authority: { valid: parsedB2C2B1.valid, decisionCase: json(b2c2b1File).decision?.case ?? null }, b2c1Authority: { valid: parsedB2C1.valid }, b2b1Authority: { valid: parsedB2B1.valid },
      oracle: { valid: oracleParse.valid }, b2c2aDiagnostic: { valid: b2c2aParse.valid, issues: b2c2aParse.issues }, hashChain,
      manifestConsistency: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes }, population: { ...populationParity, issues: population.issues },
      scheduleConsistency: { valid: scheduleConsistency.valid, issues: scheduleConsistency.issues }, b2b1Parity, policyDrift, taskConstruction: { valid: rebuilt.valid, issues: rebuilt.issues },
      scheduleParity, recordIssues,
      firstCompatibleParity },
    tasks: { total: r.tasks.length, targets: targetManifest.targetWeaponIds.length, contextBudget: c2b2a.PHASE2C26B2C2B2A_CONTEXT_BUDGET },
    aggregates: audit.aggregates,
    runtimeComparison,
    extentDiagnostic,
    targets: audit.rows.map(row => ({ ...row, firstLadderRung: authority.routes.find(x => x.targetWeaponId === row.targetWeaponId)?.firstLadderRung ?? null })),
    taskRows,
    decisionRule: analysis.PHASE2C26B2C2B2A_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, launchProvenance, hashChain, population: populationParity, scheduleParity, recordIssues: recordIssues.length,
    exactTargets: audit.aggregates.exactTargets, budgetCoverage: audit.aggregates.budgetCoverage, cascade: audit.aggregates.cascade, compatibility: { ...audit.aggregates.compatibility, byRank: undefined },
    firstExactEqualsFirstCompatible: audit.aggregates.firstExactEqualsFirstCompatible, missClasses: audit.aggregates.missClasses, execution: { ...audit.aggregates.execution, byRank: undefined },
    runtimeRatios: runtimeComparison?.ratios ?? null, intentionalStop: intentionalStop === null ? null : { notRun: intentionalStop.notRunTaskIds.length },
    perTarget: audit.aggregates.execution.perTarget.map(row => [row.targetWeaponId.slice(0, 8), row.started, row.completed, row.timeout, row.outOfMemory, row.notRun].join(' ')),
    targets: audit.rows.map(row => ({ t: row.targetWeaponId.slice(0, 8), firstCompatible: row.b2c1FirstCompatibleRank, C8: row.policies.C8.firstExactContextRank, C32: row.policies.C32.firstExactContextRank,
      C4C: row.policies.C4C.firstExactContextRank, idx: row.policies.C4C.firstExactCandidateIndex, cost: row.policies.C4C.firstExactOperationCost, miss: row.missClass })),
    invalidReasons: invalidReasons.slice(0, 30), invalidReasonCount: invalidReasons.length, decision }, null, 2))
} finally {
  await server.close()
}
