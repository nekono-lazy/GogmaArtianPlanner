// Issue #154 Phase 2-C2.6-B2-C2B2F post-hoc analysis only. Reads the finished B2-C2B2F raw run, its run dir (start attestation,
// processes.jsonl, the Search child's durable profile snapshots and child-attested Search identity) and, as explicit file arguments
// AFTER the run ended, the probe manifest, the Export (to re-derive the unchanged B2-C1 schedule, the task and the excluded current
// Route) and the committed B2-C2B2E RESULT (population source and identity authority). It runs no Search, no kernel and no Planner,
// reads no oracle, and feeds no evidence into any calculation.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b2e: option('--b2c2b2e-result'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2f.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b2eFile] = await Promise.all([paths.run, paths.probes, paths.export, paths.b2c2b2e].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const jsonLines = file => file.raw.toString('utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2FAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2f.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
let measuredHeadIsAncestor = true
try { execFileSync('git', ['merge-base', '--is-ancestor', measuredHead, 'HEAD']) } catch { measuredHeadIsAncestor = false }
const codeHash = createHash('sha256')
for (const file of git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)) {
  codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0')
}
const recomputedBenchmarkCodeSha256 = codeHash.digest('hex')
const smoke = r.environment.smoke !== null
const formalRunConditions = r.status === 'completed' && !smoke && measuredHeadIsAncestor
if (!formalRunConditions && !allowNonformal) throw new Error('The raw run is not a formal run (smoke options, not completed, or a measured HEAD outside this history).')
if (r.status !== 'completed') throw new Error(`The raw run did not complete (${r.status}).`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const f = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2F.ts')
  const targetsModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2FTargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2FAnalysis.ts')
  const d2Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts')
  const b2c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const hashing = await server.ssrLoadModule('/src/domain/models/hashing.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')

  const invalidReasons = []
  // Launch provenance (evidence grade): the runner start attestation of the run dir, verified against independent values.
  const probeManifestParse = f.parsePhase2C26B2C2B2FProbeManifest(json(probesFile))
  if (!probeManifestParse.valid) invalidReasons.push(...probeManifestParse.issues.map(i => `probe_manifest: ${i}`))
  const attestationPath = join(paths.runDir, f.PHASE2C26B2C2B2F_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const launchProvenance = analysis.phase2c26b2c2b2fLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      b2c2b2eResultSha256: targetsModule.PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, probes: probeManifestParse.manifest?.probes ?? [],
      expectedTaskIdentities: probeManifestParse.manifest?.expectedTaskIdentities ?? [], firstChildStartedAt: r.tasksChild?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  if (attestationFile !== null) invalidReasons.push(...launchProvenance.integrityIssues.map(i => `start_attestation: ${i}`))
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2fEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: false })

  // The B2-C2B2E authority, the population and the expected manifest, re-derived here.
  const parsedE = targetsModule.parsePhase2C26B2C2B2FB2C2B2EAuthority(json(b2c2b2eFile), b2c2b2eFile.source.sha256)
  if (!parsedE.valid) invalidReasons.push(...parsedE.issues.map(i => `b2c2b2e_authority: ${i}`))
  const derived = targetsModule.phase2c26b2c2b2fPopulation(parsedE.authority)
  if (!derived.valid) invalidReasons.push(...derived.issues.map(i => `population: ${i}`))
  const expectedManifest = parsedE.valid && derived.valid ? targetsModule.phase2c26b2c2b2fProbeManifest(parsedE.authority) : null
  const manifest = probeManifestParse.manifest
  const exportSha256 = exportFile.source.sha256
  const hashChain = {
    b2c2b2eResultIsRegistered: b2c2b2eFile.source.sha256 === targetsModule.PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256,
    probeManifestFromB2C2B2E: manifest?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    probeManifestB2C2B2EMatchesRunner: manifest?.b2c2b2eResultSha256 === r.environment.probeManifestB2C2B2EResultSha256,
    exportMatchesRunner: exportSha256 === r.environment.exportSha256,
    exportMatchesProbeManifest: exportSha256 === manifest?.exportSha256,
    exportMatchesB2C2B2E: exportSha256 === parsedE.authority?.exportSha256,
  }
  for (const [name, ok] of Object.entries(hashChain)) if (ok !== true) invalidReasons.push(`hash_chain: ${name}`)
  const populationParity = { manifestEqualsDerived: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(manifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(manifest?.probes.map(p => p.targetWeaponId) ?? null),
    runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(manifest?.probes ?? null),
    runnerIdentitiesEqualManifest: JSON.stringify(r.environment.expectedTaskIdentities) === JSON.stringify(manifest?.expectedTaskIdentities ?? null),
    targets: derived.targetWeaponIds.length, others: derived.others }
  for (const [name, ok] of Object.entries(populationParity)) if (ok === false) invalidReasons.push(`population: ${name}`)

  // Schedule re-derivation from the Export: the task and the excluded current Route, independent of the runner.
  const input = research.globalResearchInputFromExport(json(exportFile), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const rebuilt = manifest === null ? { valid: false, issues: ['no manifest'], tasks: [] } : f.buildPhase2C26B2C2B2FTasks(schedule, manifest)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `task_rebuild: ${i}`))
  const tasksEqualRebuilt = JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks)
  if (!tasksEqualRebuilt) invalidReasons.push('task_rebuild: the raw tasks are not the re-derived tasks')
  const eTaskRow = parsedE.authority?.taskRows.find(t => t.taskId === manifest?.probes[0]?.b2c2b2dTaskId) ?? null
  const rederivation = eTaskRow === null ? null : d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, eTaskRow, sha)
  if (rederivation === null || !rederivation.valid) invalidReasons.push(...(rederivation?.issues ?? ['no B2-C2B2E task row']).map(i => `excluded_route: ${i}`))
  const eFacts = derived.b2c2b2e[0] ?? null

  // The Search child: one run, the registered conditions, its durable profile and its own Search identity.
  const run = r.stage1[0] ?? null
  const conditionIssues = analysis.phase2c26b2c2b2fConditionIssues({ smoke, runs: r.stage1 })
  invalidReasons.push(...conditionIssues.map(i => `conditions: ${i}`))
  const conditionChecks = {
    stage1IsRegistered: JSON.stringify(r.environment.stage1) === JSON.stringify(smoke ? { ...f.PHASE2C26B2C2B2F_STAGE1, budgetMs: r.environment.smoke.budgetMs } : f.PHASE2C26B2C2B2F_STAGE1),
    onlyBudgetDiffersFromB2C2B2E: Object.keys(f.PHASE2C26B2C2B2F_STAGE1).filter(k => f.PHASE2C26B2C2B2F_STAGE1[k] !== f.PHASE2C26B2C2B2F_B2C2B2E_STAGE1[k]).join() === 'budgetMs',
    b2c2b2eStage1MatchesAuthority: JSON.stringify(f.PHASE2C26B2C2B2F_B2C2B2E_STAGE1) === JSON.stringify(parsedE.authority?.stage1 ?? null),
    budgetIs30Minutes: f.PHASE2C26B2C2B2F_STAGE1.budgetMs === 1_800_000, heapIs12288Mb: f.PHASE2C26B2C2B2F_STAGE1.childHeapMb === 12_288, concurrencyIs1: f.PHASE2C26B2C2B2F_STAGE1.concurrency === 1,
    noRetry: f.PHASE2C26B2C2B2F_STAGE1.retry === 'none' && r.stage1.length === 1, noFallback: f.PHASE2C26B2C2B2F_STAGE1.fallback === 'none',
    onlyOnSearchRuntime: JSON.stringify(r.environment.searchInstrumentation) === JSON.stringify({ onSearchRuntime: true, onGogmaReservedRuntime: false, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false }),
    noCpuProfiler: r.environment.cpuProfiler === false, conditionIssues: conditionIssues.length === 0 }
  for (const [name, ok] of Object.entries(conditionChecks)) if (ok !== true) invalidReasons.push(`conditions: ${name}`)
  const processesFile = await loadRaw(join(paths.runDir, 'processes.jsonl'))
  const processEntries = jsonLines(processesFile)
  const searchEntry = processEntries.find(p => p.role === 'search') ?? null
  const profilePath = join(paths.runDir, `stage1-${run?.taskId}.profile.jsonl`)
  const profileFile = existsSync(profilePath) ? await loadRaw(profilePath) : null
  if (profileFile === null) invalidReasons.push('profile: no profile file')
  else if (searchEntry?.profileFile?.sha256 !== profileFile.source.sha256) invalidReasons.push('profile: the profile file is not the one the parent recorded at the child exit')
  const lines = profileFile === null ? [] : jsonLines(profileFile)
  const childIdentity = lines.find(l => l.kind === 'search_identity')?.identity ?? null
  const childIdentityChecks = { present: childIdentity !== null && childIdentity.valid === true,
    searchInputDigest: childIdentity?.searchInputDigest === eTaskRow?.searchInputDigest, defaultSearchInputDigest: childIdentity?.defaultSearchInputDigest === eTaskRow?.defaultSearchInputDigest,
    extent: JSON.stringify(childIdentity?.extent) === JSON.stringify(eTaskRow?.extent), groupIndex: childIdentity?.groupIndex === eTaskRow?.groupIndex,
    reservationDigest: childIdentity?.reservationDigest === eTaskRow?.reservationDigest, excludedRouteIsCurrentRoute: childIdentity?.excludedRouteIsCurrentRoute === true,
    excludedRouteEqualsRederived: childIdentity?.excludedRouteKeyCount === 1 && childIdentity.excludedRouteKeySha256s[0] === rederivation?.excludedRouteKeySha256,
    excludedRouteEqualsB2C2B2E: childIdentity?.excludedRouteKeySha256s?.[0] === eFacts?.rederivedExcludedRouteKeySha256 }
  for (const [name, ok] of Object.entries(childIdentityChecks)) if (ok !== true) invalidReasons.push(`child_identity: ${name}`)
  const snapshots = lines.filter(l => l.kind === 'profile_snapshot')
  const selection = analysis.phase2c26b2c2b2fSelectSnapshot(snapshots)
  if (!selection.valid && selection.last !== null) invalidReasons.push(...selection.issues.map(i => `profile: ${i}`))
  const last = selection.last
  const violations = last?.runtime.contractViolations ?? 0
  if (violations > 0) invalidReasons.push(`profile: ${violations} section nesting contract violations (${last.runtime.contractViolationSamples.join(' | ')})`)
  const observed = last?.runtime.observed.find(o => o.targetOrdinal === 0) ?? null
  const categories = observed === null ? null : analysis.phase2c26b2c2b2fCategories(observed)
  if (categories !== null && !categories.partition.matches) invalidReasons.push('profile: the categories are not a partition of the Search wall')
  const insufficientReasons = selection.last === null ? ['no profile snapshot'] : []
  const decision = analysis.phase2c26b2c2b2fDecision({ invalidReasons, insufficientReasons, categories })
  const windows = analysis.phase2c26b2c2b2fWindows(snapshots)
  const depth = last === null ? null : analysis.phase2c26b2c2b2fDepthSummary(last)
  const record = run?.outcome.record === 'searched' ? (await loadRaw(join(paths.runDir, run.recordFile.file))) : null
  const search = record === null ? null : json(record).result.search
  const profilerStarted = lines.find(l => l.kind === 'profiler_started') ?? null
  const childWallMs = run?.process.wallMs ?? null
  const tail = last === null || profilerStarted === null || childWallMs === null ? null : {
    // Child elapsed when the profiler started (process start -> profiler origin: Vite load, Export, schedule, identity).
    profilerOriginChildProcessMs: profilerStarted.originChildProcessMs,
    lastSnapshotAtMs: last.atMs, lastSnapshotSearchElapsedMs: last.searchElapsedMs,
    // Search time after the last durable snapshot that no snapshot holds (a kill loses it; a completed Search has none).
    unobservedTailMs: selection.source === 'final' ? 0 : Math.max(0, childWallMs - profilerStarted.originChildProcessMs - last.atMs),
  }
  const outcome = { process: run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, naturalCompletion: search !== null,
    termination: search?.termination ?? null, candidateCount: search?.candidates.length ?? null, searchElapsedMs: search?.elapsedMs ?? null,
    childWallMs, killedAtMs: run?.process.killedAtMs ?? null, budgetMs: run?.process.budgetMs ?? null,
    deliveredBeforeKill: last === null ? null : { deliveryFlushes: depth?.sectionCounts?.delivery_flush ?? null, deliveryConsumerCalls: depth?.sectionCounts?.delivery_consumer ?? null },
    peakHeapBytes: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0), peakRssBytes: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, run?.lastIpcMemory?.maxRssBytes ?? 0),
    yields: run?.yields ?? null, profileSnapshots: snapshots.length, profileSource: selection.source, tail,
    note: 'A timeout is the normal profiling outcome and is never Candidate 0; no Route exact judgement is made.' }

  const result = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2F (post-hoc analysis): B2-C2B2E time-bound Target, B2-C2B2E Search input, 30-minute outer runtime profiling',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, processes: processesFile.source, profile: profileFile?.source ?? null, probeManifest: probesFile.source,
      export: exportFile.source, b2c2b2eResult: b2c2b2eFile.source },
    provenance: { formal, evidenceGrade, partialRun: false, launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source,
      launchProvenanceReason: launchProvenance.reason, launchProvenanceIssues: launchProvenance.issues, launchProvenanceIntegrityIssues: launchProvenance.integrityIssues,
      startAttestation: attestationFile === null ? null : { file: attestationFile.source.file, sha256: attestationFile.source.sha256, bytes: attestationFile.source.bytes, body: json(attestationFile) },
      measuredHead, measuredHeadSource: 'runner_start_attestation', measuredHeadIsAncestor, measuredAt: r.measuredAt, recomputedBenchmarkCodeSha256,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportSha256, b2c2b2eResultSha256: b2c2b2eFile.source.sha256, b2c2b2eMeasuredHead: parsedE.authority?.measuredHead ?? null, probeManifestSha256: probesFile.source.sha256,
      ...f.PHASE2C26B2C2B2F_PROVENANCE_FLAGS },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, cpu: r.environment.cpu,
      logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, freeMemoryBytesAtLaunch: r.environment.freeMemoryBytesAtLaunch,
      rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, b2c2b2eStage1: r.environment.b2c2b2eStage1, changedStage1Fields: r.environment.changedStage1Fields, conditionChecks,
      searchInstrumentation: r.environment.searchInstrumentation, cpuProfiler: r.environment.cpuProfiler, heartbeatIntervalMs: r.environment.heartbeatIntervalMs,
      windowsMs: r.environment.windowsMs, memorySampleIntervalMs: r.environment.memorySampleIntervalMs, nodeYield: r.environment.nodeYield, candidateSafetyCap: r.environment.candidateSafetyCap,
      maxCostCohorts: r.environment.maxCostCohorts, notRun: r.environment.notRun, calculationContext: run?.calculationContext ?? r.tasksChild.calculationContext,
      researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps },
    population: { rule: `B2-C2B2E nextBranch.branch = C and nextBranch.perTarget with type = ${targetsModule.PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.populationType} and result = ${targetsModule.PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.populationResult}`,
      targetWeaponIds: derived.targetWeaponIds, others: derived.others, probes: manifest?.probes ?? null, b2c2b2eBackground: eFacts },
    parity: { b2c2b2eAuthority: { valid: parsedE.valid, issues: parsedE.issues, decisionCase: parsedE.authority?.decisionCase ?? null, nextBranch: parsedE.authority?.nextBranch.branch ?? null },
      hashChain, population: populationParity, taskRebuild: { valid: rebuilt.valid, issues: rebuilt.issues, tasksEqualRebuilt },
      identity: { expected: manifest?.expectedTaskIdentities[0] ?? null, raw: r.tasks[0] ? f.phase2c26b2c2b2fTaskIdentity(r.tasks[0]) : null,
        rawEqualsExpected: r.tasks[0] ? JSON.stringify(f.phase2c26b2c2b2fTaskIdentity(r.tasks[0])) === JSON.stringify(manifest?.expectedTaskIdentities[0]) : false },
      excludedRoute: rederivation === null ? null : { valid: rederivation.valid, issues: rederivation.issues, excludedRouteKeyCount: rederivation.excludedRouteKeyCount,
        excludedRouteIsCurrentRoute: rederivation.excludedRouteIsCurrentRoute, rederivedExcludedRouteKeySha256: rederivation.excludedRouteKeySha256,
        b2c2b2eRederivedExcludedRouteKeySha256: eFacts?.rederivedExcludedRouteKeySha256 ?? null, childAttestedExcludedRouteKeySha256: childIdentity?.excludedRouteKeySha256s?.[0] ?? null },
      childIdentity: childIdentityChecks },
    outcome,
    profile: last === null ? null : { source: selection.source, snapshots: selection.snapshots, contractViolations: violations, events: last.events, searchWallMs: categories?.searchWallMs ?? null,
      coverage: categories?.coverage ?? null, partition: categories?.partition ?? null, categoryMs: categories?.ms ?? null, categoryShares: categories?.shares ?? null,
      sectionExclusiveMs: categories?.sectionExclusiveMs ?? null, scheduler: categories?.scheduler ?? null, inclusiveMs: observed?.inclusiveMs ?? null, exclusiveMs: observed?.exclusiveMs ?? null,
      sectionCounts: depth?.sectionCounts ?? null, settleWithoutWork: depth?.settleWithoutWork ?? null, activeStackAtLastSnapshot: last.runtime.activeStack,
      yields: last.yields, depth: depth === null ? null : { bonus: depth.bonus, skill: depth.skill }, memoryAtLastSnapshot: last.memory ?? null },
    windows,
    decisionRule: analysis.PHASE2C26B2C2B2F_DECISION_RULE,
    invalidReasons,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, decision: decision.case, dominant: decision.dominant, secondary: decision.secondary,
    coverage: categories?.coverage, shares: categories?.shares, invalidReasons, outcome: { process: outcome.process, naturalCompletion: outcome.naturalCompletion, tail: outcome.tail },
    windows: windows.map(w => ({ from: w.fromMs, to: w.toMs, partial: w.partial, shares: w.categories?.shares ?? null })) }, null, 2))
} finally {
  await server.close()
}
