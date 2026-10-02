// Issue #154 Phase 2-C2.6-B2-C2A-R1 post-hoc analysis only. Reads the finished R1 retry run and its child records (written
// by run-planner-global-phase2c26b2c2ar1.mjs) and, as explicit file arguments AFTER the run ended, the retry manifest, the
// B2-C2A validation Target manifest, the Export (to re-derive the unchanged B2-C1 schedule), the committed B2-C2A RESULT
// (the original 318 measured tasks: never re-run, never rewritten), the B2-C1 / B2-B1 / B2-B2A / B2-B2A2 RESULTs (hash chain)
// and the 1,657 oracle RESULT plus manifest (post-hoc compatibility and Candidate coverage). It runs no Search, no kernel and
// no Planner, and feeds no evidence into any calculation. Candidate stable keys are written as SHA-256 digests.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), retry: option('--retry'), targets: option('--targets'), export: option('--export'), b2c2a: option('--b2c2a-result'),
  b2c1: option('--b2c1-result'), b2b1: option('--b2b1-result'), b2b2a: option('--b2b2a-result'), b2b2a2: option('--b2b2a2-result'), oracle: option('--oracle'), manifest: option('--manifest'),
  output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2ar1.mjs --run <raw.json.local> --run-dir <run dir> --retry <retry manifest> --targets <targets manifest> --export <external.json> --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b2a2-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, retryFile, targetsFile, exportFile, b2c2aFile, b2c1File, b2b1File, b2b2aFile, b2b2a2File, oracleFile, manifestFile] = await Promise.all([paths.run, paths.retry, paths.targets,
  paths.export, paths.b2c2a, paths.b2c1, paths.b2b1, paths.b2b2a, paths.b2b2a2, paths.oracle, paths.manifest].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2AR1Analysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2ar1.mjs']
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
const compactCandidate = c => c === null || c === undefined ? null : { deliveryIndex: c.deliveryIndex, stableKeySha256: sha(c.stableKey), orderingKeys: c.orderingKeys,
  respectsReservation: c.reservationCheck.respects, routeKind: c.summary.routeKind, sourceKind: c.summary.sourceKind, estimatedOperationCount: c.summary.estimatedOperationCount,
  estimatedAdvances: c.summary.estimatedAdvances, operationTypes: c.summary.operationTypes, normal: stream(c.summary.normal), gogma: stream(c.summary.gogma), skill: stream(c.summary.skill),
  heldRoute: c.summary.heldRoute }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const load = path => server.ssrLoadModule(path)
  const c2a = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2A.ts')
  const c2aAnalysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2AAnalysis.ts')
  const c2aTargets = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const r1 = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1.ts')
  const r1Authority = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1Authority.ts')
  const r1Analysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2AR1Analysis.ts')
  const b2c1 = await load('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const b2c1Analysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts')
  const b2b2a2 = await load('/src/benchmarks/plannerGlobalPhase2C26B2B2A2.ts')
  const b2b2a2Analysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2B2A2Analysis.ts')
  const b2aAnalysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const hashing = await load('/src/domain/models/hashing.ts')
  const research = await load('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await load('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await load('/src/domain/rng/production/productionRngEngine.ts')
  const manifestModule = await load('/' + paths.manifest.replace(/\\/g, '/').replace(/^\.?\//, ''))
  const manifest = manifestModule.ORACLE_1657_ROUTES

  // Authorities, re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  const parsedB2C2A = r1Authority.parsePhase2C26B2C2AR1Authority(json(b2c2aFile), b2c2aFile.source.sha256)
  if (!parsedB2C2A.valid) invalidReasons.push(...parsedB2C2A.issues.map(i => `b2c2a_authority: ${i}`))
  const parsedB2C1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(json(b2c1File), b2c1File.source.sha256)
  if (!parsedB2C1.valid) invalidReasons.push(...parsedB2C1.issues.map(i => `b2c1_authority: ${i}`))
  const parsedB2B1 = b2c1Analysis.parsePhase2C26B2C1B2B1Authority(json(b2b1File), b2b1File.source.sha256)
  if (!parsedB2B1.valid) invalidReasons.push(...parsedB2B1.issues.map(i => `b2b1_authority: ${i}`))
  const parsedB2B2A = b2b2a2.parsePhase2C26B2B2A2B2B2AAuthority(json(b2b2aFile), b2b2aFile.source.sha256)
  if (!parsedB2B2A.valid) invalidReasons.push(...parsedB2B2A.issues.map(i => `b2b2a_authority: ${i}`))
  const parsedB2B2A2 = c2aTargets.parsePhase2C26B2C2AB2B2A2Authority(json(b2b2a2File), b2b2a2File.source.sha256)
  if (!parsedB2B2A2.valid) invalidReasons.push(...parsedB2B2A2.issues.map(i => `b2b2a2_authority: ${i}`))
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(json(oracleFile))
  if (!oracleParse.valid) invalidReasons.push(...oracleParse.issues.map(i => `oracle: ${i}`))
  const targetManifestParse = c2a.parsePhase2C26B2C2ATargetManifest(json(targetsFile))
  if (!targetManifestParse.valid) invalidReasons.push(...targetManifestParse.issues.map(i => `target_manifest: ${i}`))
  const retryParse = r1.parsePhase2C26B2C2AR1RetryManifest(json(retryFile))
  if (!retryParse.valid) invalidReasons.push(...retryParse.issues.map(i => `retry_manifest: ${i}`))
  const authority = parsedB2C2A.authority, b2c1Authority = parsedB2C1.authority, b2b1Authority = parsedB2B1.authority, b2b2aAuthority = parsedB2B2A.authority,
    b2b2a2Authority = parsedB2B2A2.authority, oracle = oracleParse.oracle, targetManifest = targetManifestParse.manifest, retryManifest = retryParse.manifest
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const exportSha256 = exportFile.source.sha256
  const ready = authority && b2c1Authority && b2b1Authority && b2b2aAuthority && b2b2a2Authority && oracle && targetManifest && retryManifest
  const hashChain = !ready ? null : {
    b2c2aResultIsRegistered: b2c2aFile.source.sha256 === r1.PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256,
    retryManifestFromB2C2A: retryManifest.sourceB2C2AResultSha256 === b2c2aFile.source.sha256,
    retryManifestMatchesRunner: retryFile.source.sha256 === r.environment.retryManifestSha256,
    retryManifestTargetManifest: retryManifest.sourceTargetManifestSha256 === targetsFile.source.sha256,
    targetManifestIsRegistered: targetsFile.source.sha256 === r1.PHASE2C26B2C2AR1_SOURCE.targetManifestSha256,
    targetManifestMatchesB2C2A: targetsFile.source.sha256 === authority.targetManifestSha256,
    targetManifestMatchesRunner: targetsFile.source.sha256 === r.environment.targetManifestSha256,
    targetManifestFromB2C1: targetManifest.sourceResultSha256 === b2c1File.source.sha256,
    b2c1MatchesB2C2A: b2c1File.source.sha256 === authority.b2c1ResultSha256,
    b2b1MatchesB2C2A: b2b1File.source.sha256 === authority.b2b1ResultSha256,
    b2b1MatchesB2C1: b2b1File.source.sha256 === b2c1Authority.b2b1ResultSha256,
    b2b2aMatchesB2C2A: b2b2aFile.source.sha256 === authority.b2b2aResultSha256,
    b2b2aMatchesB2B2A2: b2b2aFile.source.sha256 === b2b2a2Authority.b2b2aResultSha256,
    b2b2a2MatchesB2C2A: b2b2a2File.source.sha256 === authority.b2b2a2ResultSha256,
    b2b2a2MatchesB2C1: b2b2a2File.source.sha256 === b2c1Authority.b2b2a2ResultSha256,
    oracleMatchesB2C2A: oracleFile.source.sha256 === authority.oracleResultSha256,
    oracleMatchesB2C1: oracleFile.source.sha256 === b2c1Authority.oracleResultSha256,
    manifestFileMatchesB2C2A: manifestFile.source.sha256 === authority.oracleManifestFileSha256,
    manifestRoutesMatchesB2C2A: manifestRoutesSha256 === authority.oracleManifestRoutesSha256,
    manifestRoutesMatchesOracle: manifestRoutesSha256 === oracle.manifestSha256,
    exportMatchesRunner: exportSha256 === r.environment.exportSha256,
    exportMatchesB2C2A: exportSha256 === authority.exportSha256,
    exportMatchesRetryManifest: exportSha256 === retryManifest.exportSha256,
    exportMatchesTargetManifest: exportSha256 === targetManifest.exportSha256,
    exportMatchesB2C1: exportSha256 === b2c1Authority.exportSha256,
    exportMatchesOracle: exportSha256 === oracle.exportSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracle === null ? { valid: false, issues: ['no oracle'], checkedRoutes: 0 } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (!ready) {
    const decision = r1Analysis.phase2c26b2c2ar1Decision({ invalidReasons, retrySelected: 0, retryMeasured: 0, retryUnmeasured: 0,
      combined: { tasks: 0, targets: 0, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 }, originalExactTargets: { C8: 0, C32: 0, C4C: 0 } })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-C2A-R1 (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2AR1_INVALID: ${decision.reasons.join('; ')}`)
  }
  // The population: the manifest is the B2-C1 defaultExtent subgroup, the B2-C2A Targets and the runner's Targets.
  const populationParity = { manifestEqualsB2C1DefaultExtent: JSON.stringify(c2aTargets.phase2c26b2c2aTargetManifest(b2c1Authority)) === JSON.stringify(targetManifest),
    manifestEqualsB2C2ATargets: JSON.stringify([...authority.targetWeaponIds].sort()) === JSON.stringify(targetManifest.targetWeaponIds),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(targetManifest.targetWeaponIds),
    runnerRetryTasksEqualManifest: JSON.stringify(r.retryTaskIds) === JSON.stringify(retryManifest.taskIds), targets: targetManifest.targetWeaponIds.length }
  for (const [name, ok] of Object.entries(populationParity)) if (ok === false) invalidReasons.push(`population: ${name}`)

  // The schedule, re-derived from the Export through the unchanged B2-C1 calculation; the 320 tasks and the retry selection.
  const input = research.globalResearchInputFromExport(JSON.parse(exportFile.raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const scheduleConsistency = b2c1Analysis.validatePhase2C26B2C1Schedule(schedule)
  if (!scheduleConsistency.valid) invalidReasons.push(...scheduleConsistency.issues.map(i => `schedule: ${i}`))
  const b2b1Parity = b2c1Analysis.validatePhase2C26B2C1B2B1Parity(schedule, b2b1Authority, sha)
  if (!b2b1Parity.valid) invalidReasons.push(...b2b1Parity.issues.map(i => `b2b1_parity: ${i}`))
  const policyDrift = c2a.phase2c26b2c2aPolicyDrift(schedule)
  invalidReasons.push(...policyDrift.map(i => `policy: ${i}`))
  const rebuilt = c2a.buildPhase2C26B2C2ATasks(schedule, targetManifest.targetWeaponIds)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `tasks: ${i}`))
  const reselected = r1.selectPhase2C26B2C2AR1Tasks(rebuilt, retryManifest.taskIds)
  if (!reselected.valid) invalidReasons.push(...reselected.issues.map(i => `retry_selection: ${i}`))
  const summary = r.tasksChild.scheduleSummary
  const scheduleParity = {
    tasksMatchReDerivedSchedule: JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks),
    selectedTasksMatchReDerivedSelection: JSON.stringify(reselected.tasks) === JSON.stringify(r.selectedTasks),
    contextsDigestMatches: summary.contextsDigest === sha(hashing.stableStringify(schedule.contexts)),
    originDigestMatches: summary.originDigest === schedule.snapshot.originDigest,
    extentMatches: JSON.stringify(summary.extent) === JSON.stringify(schedule.extent),
    policiesMatch: JSON.stringify(summary.policies) === JSON.stringify(schedule.policies),
    calculationContextMatches: r.retryRuns.every(run => (run.outcome.process !== 'completed' && run.calculationContext === null) || JSON.stringify(run.calculationContext) === JSON.stringify(input.calculationContext))
      && JSON.stringify(r.tasksChild.calculationContext) === JSON.stringify(input.calculationContext),
    engineMatches: r.retryRuns.every(run => (run.outcome.process !== 'completed' && run.rngEngineVersion === null) || run.rngEngineVersion === engine.version) && r.environment.rngEngineVersion === engine.version,
    taskCount: r.tasks.length,
    retryTaskCount: r.selectedTasks.length,
  }
  for (const [name, ok] of Object.entries(scheduleParity)) if (ok === false) invalidReasons.push(`schedule_parity: ${name}`)
  if (r.tasks.length !== c2a.PHASE2C26B2C2A_EXPECTED_TASKS) invalidReasons.push(`schedule_parity: ${r.tasks.length} tasks, not ${c2a.PHASE2C26B2C2A_EXPECTED_TASKS}`)
  // Conditions: the Search / capture / budget conditions are the B2-C2A ones; only the retry budget and concurrency differ.
  const conditionIssues = []
  if (!smoke && JSON.stringify(r.environment.retry) !== JSON.stringify(r1.PHASE2C26B2C2AR1_RETRY)) conditionIssues.push('the retry conditions are not the registered ones')
  if (JSON.stringify(r.environment.b2c2aStage1) !== JSON.stringify(c2a.PHASE2C26B2C2A_STAGE1) || JSON.stringify(authority.stage1) !== JSON.stringify(c2a.PHASE2C26B2C2A_STAGE1)) conditionIssues.push('the B2-C2A Stage 1 conditions drifted')
  if (r.environment.retry.childHeapMb !== c2a.PHASE2C26B2C2A_STAGE1.childHeapMb) conditionIssues.push('the retry heap is not the B2-C2A heap')
  if (r.environment.maxCostCohorts !== c2a.PHASE2C26B2C2A_MAX_COST_COHORTS || r.environment.candidateSafetyCap !== c2a.PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP
    || r.environment.contextBudget !== c2a.PHASE2C26B2C2A_CONTEXT_BUDGET || r.environment.expectedRetryTasks !== r1.PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) conditionIssues.push('capture / budget conditions drifted')
  if (r.environment.childScript !== 'scripts/run-planner-global-phase2c26b2c2a.mjs') conditionIssues.push('the child is not the unchanged B2-C2A child')
  // The extent itself is checked by buildPhase2C26B2C2ATasks() (schedule) and validatePhase2C26B2C2ARaw() (every record).
  if (r.selectedTasks.some(t => t.maxCostCohorts !== c2a.PHASE2C26B2C2A_MAX_COST_COHORTS || t.candidateSafetyCap !== c2a.PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP)) {
    conditionIssues.push('a retry task carries another capture rule')
  }
  invalidReasons.push(...conditionIssues.map(i => `conditions: ${i}`))
  for (const flag of ['oracleGuidedPolicySelection', 'oracleGuidedTargetPopulation']) if (r.environment[flag] !== true) invalidReasons.push(`provenance: ${flag} is not true`)
  for (const flag of ['contextOrderingUsesOracle', 'retrySelectionUsesOracle', 'oracleReadBySearchChild', 'oracleMatchUsedForEarlyStop']) if (r.environment[flag] !== false) invalidReasons.push(`provenance: ${flag} is not false`)

  // Child records, each checked against the SHA-256 the runner recorded.
  const recordIssues = []
  const runs = []
  for (const run of r.retryRuns) {
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

  // Post-hoc compatibility (unchanged B2-C2A / B2-C1 authority), the retry comparison and the completion overlay.
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, targetManifest.targetWeaponIds, manifest, oracle)
  const audit = r1Analysis.runPhase2C26B2C2AR1Analysis({ authority, retryManifest, tasks: r.tasks, selectedTasks: r.selectedTasks, runs, reach,
    oracle: { routes: oracle.routes, gogmaUsage: oracle.gogmaUsage }, oracleOperationCost: id => b2b2a2Analysis.phase2c26b2b2a2OracleOperationCost(oracle, id), smoke })
  invalidReasons.push(...audit.invalidReasons.filter(i => !invalidReasons.includes(i)))
  const decision = !formal && !allowNonformal ? null : r1Analysis.phase2c26b2c2ar1Decision({ ...audit.decisionInput, invalidReasons })

  const runOf = new Map(runs.map(run => [run.taskId, run]))
  const searchOf = run => run?.record?.status === 'searched' ? run.record.search : null
  const peak = run => ({ heap: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, (run?.memory?.maxRssKiB ?? 0) * 1024, run?.lastIpcMemory?.maxRssBytes ?? 0) })
  const retryRows = audit.retryContexts.map(c => {
    const run = runOf.get(c.taskId), s = searchOf(run)
    const task = r.selectedTasks.find(t => t.taskId === c.taskId)
    const original = authority.taskRows.find(row => row.taskId === c.taskId)
    return { taskId: c.taskId, targetWeaponId: c.targetWeaponId, contextRank: c.contextRank, groupIndex: c.groupIndex, reservationDigest: task.reservationDigest,
      targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds,
      searchInputDigest: task.searchInputDigest, extent: s?.extent ?? null, excludedRouteKeySha256: s ? sha(s.excludedRouteKeys[0]) : null,
      original: { process: original.process, record: original.record, wallMs: original.wallMs, peakHeapBytes: original.peakHeapBytes, peakRssBytes: original.peakRssBytes, yields: original.yields,
        budgetMs: authority.stage1.budgetMs, compatible: original.compatible },
      process: run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, budgetMs: run?.process.budgetMs ?? null, wallMs: run?.process.wallMs ?? null,
      searchElapsedMs: s?.elapsedMs ?? null, scheduleMs: run?.scheduleMs ?? null, peakHeapBytes: run ? peak(run).heap : null, peakRssBytes: run ? peak(run).rss : null, yields: run?.yields ?? null,
      status: s?.status ?? null, termination: s?.termination ?? null, candidateCount: c.candidateCount, deliveredCandidates: s?.summary.deliveredCandidates ?? null,
      excludedCandidates: s?.summary.excludedCandidates ?? null, distinctCostCohorts: s?.distinctCostCohorts ?? null, capturedCosts: c.capturedCosts, captureComplete: c.captureComplete,
      safetyCapHit: c.safetyCapHit, nextCostSentinel: s?.nextCostSentinel ? { deliveryIndex: s.nextCostSentinel.deliveryIndex, estimatedOperationCount: s.nextCostSentinel.orderingKeys.estimatedOperationCount,
        respectsReservation: s.nextCostSentinel.reservationCheck.respects } : null,
      compatible: c.compatible, compatibleRecordedByB2C2A: original.compatible, coverage: c.coverage, exactCount: c.exactIndexes.length, partialCount: c.partialIndexes.length,
      firstExactIndex: c.firstExactIndex, firstPartialIndex: c.firstPartialIndex, hit: c.hit, sentinelExact: c.sentinelExact, reservationViolations: c.reservationViolations,
      contextMismatchIssues: run?.contextMismatchIssues ?? null, stderrTail: run?.process.stderrTail ?? null,
      firstExactCandidate: c.firstExactIndex === null ? null : compactCandidate(s.candidates[c.firstExactIndex]),
      routeKinds: s ? Object.fromEntries([...new Set(s.candidates.map(x => x.summary.routeKind))].sort().map(k => [k, s.candidates.filter(x => x.summary.routeKind === k).length])) : null }
  })
  const combinedTargets = audit.combined.rows.map(row => ({ targetWeaponId: row.targetWeaponId, b2c1FirstCompatibleRank: row.b2c1FirstCompatibleRank, recomputedFirstCompatibleRank: row.recomputedFirstCompatibleRank,
    compatibleRanksInBudget: row.compatibleRanksInBudget, measuredContexts: row.measuredContexts, fullyMeasured: row.fullyMeasured, safetyCapContexts: row.safetyCapContexts,
    policies: row.policies, recovery: row.recovery, missClass: row.missClass,
    originalMeasuredContexts: audit.original.rows.find(o => o.targetWeaponId === row.targetWeaponId).measuredContexts }))
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2A-R1: B2-C2A timeout subset searched again, completion overlay (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, retryManifest: retryFile.source, targetManifest: targetsFile.source, export: exportFile.source, b2c2aResult: b2c2aFile.source, b2c1Result: b2c1File.source,
      b2b1Result: b2b1File.source, b2b2aResult: b2b2aFile.source, b2b2a2Result: b2b2a2File.source, oracle: oracleFile.source, oracleManifest: manifestFile.source },
    provenance: { measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: exportFile.source.bytes,
      b2c2aResultSha256: b2c2aFile.source.sha256, b2c2aMeasuredHead: authority.measuredHead, b2c2aAnalysisHead: authority.analysisHead, b2c2aBenchmarkCodeSha256: authority.benchmarkCodeSha256,
      b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256, b2b2aResultSha256: b2b2aFile.source.sha256, b2b2a2ResultSha256: b2b2a2File.source.sha256,
      oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestRoutesSha256: manifestRoutesSha256,
      targetManifestSha256: targetsFile.source.sha256, retryManifestSha256: retryFile.source.sha256,
      oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false, oracleReadBySearchChild: false,
      oracleMatchUsedForEarlyStop: false, originalEvidenceRerun: false, b2c2aResultRewritten: false, measuredAt: r.measuredAt, runWallMs: r.wallMs },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { retry: r.environment.retry, b2c2aStage1: r.environment.b2c2aStage1, childScript: r.environment.childScript, tasksBudgetMs: r.environment.tasksBudgetMs,
      contextBudget: r.environment.contextBudget, validationTargets: r.environment.validationTargets, expectedTasks: r.environment.expectedTasks, expectedRetryTasks: r.environment.expectedRetryTasks,
      maxCostCohorts: r.environment.maxCostCohorts, candidateSafetyCap: r.environment.candidateSafetyCap, capturePrefixes: r.environment.capturePrefixes, extent: schedule.extent,
      extentLabel: r.environment.extentLabel, nodeYield: r.environment.nodeYield, memorySampleIntervalMs: r.environment.memorySampleIntervalMs, registeredP1: r.environment.registeredP1,
      calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps, notRun: r.environment.notRun, inherited: r1.PHASE2C26B2C2AR1_INHERITED,
      changedFromB2C2A: 'execution budget 10 -> 30 minutes per task and concurrency 3 -> 1, for the timeout subset only. Search input, algorithm, ordering, comparator, extent, context, capture (4 cost cohorts + sentinel), safety cap 1024, heap 8192 MB, fresh child, setImmediate yield and memory sampling 250 ms are unchanged (the child is the unchanged B2-C2A child script). The concurrency change is for completing the unmeasured tasks, not for comparing Search semantics.',
      retrySelection: 'the B2-C2A RESULT task rows with process = timeout and record = null, nothing else read (no compatibility, coverage, exact, first compatible rank, oracle operation cost or route kind)',
      searchChildKnows: ['targetWeaponId', 'P1 context rank', 'reservation digest / group / representative alias (re-derived and checked)', 'Planner-start origin (re-derived)',
        'reservation (re-derived)', 'excluded current Route key (re-derived)', 'Production default extent', 'capture rule (4 cost cohorts)', 'safety cap 1024'],
      searchChildNeverKnows: ['oracle RESULT', 'oracle manifest', 'B2-C2A RESULT', 'compatibility', 'B2-C1 firstCompatible', 'expected exact stable key', 'expected Candidate index',
        'expected Candidate count', 'expected operation cost', 'B2-C2A Target first exact'],
      limitation: 'P1 and the defaultExtent population were chosen with B2-C1 post-hoc oracle evidence. Inside each Target, the context ordering and the retry Search used no oracle compatibility or firstCompatible. R1 only completes the B2-C2A measurement of this Export and population; it is not evidence that P1, a budget of 16, C4C or a 30-minute budget is right for Production or another Export.' },
    authority: { b2c2a: { sha256: authority.resultSha256, decisionCase: json(b2c2aFile).decision.case, execution: authority.execution, exactTargets: authority.exactTargets,
      budgetCoverage: authority.budgetCoverage, timeoutTaskIds: r1Authority.phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows) } },
    parity: { b2c2aAuthority: { valid: parsedB2C2A.valid }, b2c1Authority: { valid: parsedB2C1.valid }, b2b1Authority: { valid: parsedB2B1.valid }, b2b2aAuthority: { valid: parsedB2B2A.valid },
      b2b2a2Authority: { valid: parsedB2B2A2.valid }, oracle: { valid: oracleParse.valid }, retryManifest: { valid: retryParse.valid, taskIds: retryManifest.taskIds }, hashChain,
      manifestConsistency: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes }, population: populationParity,
      scheduleConsistency: { valid: scheduleConsistency.valid, issues: scheduleConsistency.issues }, b2b1Parity, policyDrift, taskConstruction: { valid: rebuilt.valid, issues: rebuilt.issues },
      retrySelection: { valid: reselected.valid, issues: reselected.issues }, scheduleParity, conditionIssues, recordIssues,
      reconstructionVsB2C2A: r1Analysis.phase2c26b2c2ar1ReconstructionParity(r.tasks, authority.taskRows),
      compatibilityParity: { contexts: audit.compatibilityParity.length, mismatches: audit.compatibilityParity.filter(p => p.recorded !== p.recomputed),
        retry: audit.compatibilityParity.filter(p => retryManifest.taskIds.includes(p.taskId)) },
      firstCompatibleParity: reach.map(x => ({ targetWeaponId: x.targetWeaponId, recomputed: x.p1FirstCompatibleRank,
        b2c1: authority.targets.find(t => t.targetWeaponId === x.targetWeaponId)?.b2c1FirstCompatibleRank ?? null })),
      originalReproduction: audit.originalReproduction },
    retryRows,
    overlay: audit.overlay,
    aggregates: {
      original: { exactTargets: audit.original.exactTargets, budgetCoverage: audit.original.budgetCoverage, cascade: audit.original.cascade },
      combined: { exactTargets: audit.combined.exactTargets, budgetCoverage: audit.combined.budgetCoverage, cascade: audit.combined.cascade,
        unresolvedSafetyCapTargets: audit.combined.unresolvedSafetyCapTargets,
        fullyMeasuredTargets: audit.combined.rows.filter(row => row.fullyMeasured).length },
      retrySemantics: { measured: audit.retryContexts.filter(c => c.measured).length, compatible: audit.retryContexts.filter(c => c.compatible).length,
        exact: audit.retryContexts.filter(c => c.exactIndexes.length > 0).length, partial: audit.retryContexts.filter(c => c.partialIndexes.length > 0).length,
        sentinelExact: audit.retryContexts.filter(c => c.sentinelExact).length, reservationViolations: audit.retryContexts.reduce((sum, c) => sum + c.reservationViolations, 0),
        capturedCandidates: audit.retryContexts.reduce((sum, c) => sum + (c.candidateCount ?? 0), 0) },
    },
    combinedTargets,
    decisionRule: r1Analysis.PHASE2C26B2C2AR1_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, hashChain, population: populationParity, scheduleParity, recordIssues: recordIssues.length, overlay: audit.overlay,
    originalReproduction: audit.originalReproduction, retry: retryRows.map(row => ({ taskId: row.taskId, process: row.process, termination: row.termination, n: row.candidateCount,
      costs: row.capturedCosts, cap: row.safetyCapHit, compatible: row.compatible, coverage: row.coverage, wallS: row.wallMs && (row.wallMs / 1000).toFixed(1),
      heapGB: row.peakHeapBytes && (row.peakHeapBytes / 2 ** 30).toFixed(2) })),
    combined: record.aggregates.combined, invalidReasons: invalidReasons.slice(0, 30), invalidReasonCount: invalidReasons.length, decision }, null, 2))
} finally {
  await server.close()
}
