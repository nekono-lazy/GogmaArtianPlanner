// Issue #154 Phase 2-C2.6-B2-C2B2D post-hoc analysis only. Reads the finished (or interrupted and reconstructed) B2-C2B2D raw
// run, its child records and its runner start attestation (written by run-planner-global-phase2c26b2c2b2d.mjs) and, as explicit
// file arguments AFTER the run ended, the probe manifest, the Export (to re-derive the unchanged B2-C1 schedule), the B2-C2B1
// RESULT (population / required extents), the B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT (schedule parity /
// hash chain), the B2-C2B2B RESULT (the E1 ∩ L1 half of the E1 aggregate), the B2-C2B2C RESULT (the paired common-L2 baseline)
// and the 1,657 oracle RESULT plus manifest (post-hoc reservation compatibility and Candidate coverage). It runs no Search, no
// kernel and no Planner, and feeds no evidence into any calculation. Candidate stable keys are written as SHA-256 digests; the raw
// keys stay in the .local records.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'),
  b2b1: option('--b2b1-result'), b2c2b2b: option('--b2c2b2b-result'), b2c2b2c: option('--b2c2b2c-result'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2d.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c2b2b-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json --b2c2b2c-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b1File, b2c1File, b2b1File, b2c2b2bFile, b2c2b2cFile, oracleFile, manifestFile] = await Promise.all([paths.run, paths.probes, paths.export, paths.b2c2b1,
  paths.b2c1, paths.b2b1, paths.b2c2b2b, paths.b2c2b2c, paths.oracle, paths.manifest].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2d.mjs', 'scripts/reconstruct-planner-global-phase2c26b2c2b2d-partial-raw.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
let measuredHeadIsAncestor = true
try { execFileSync('git', ['merge-base', '--is-ancestor', measuredHead, 'HEAD']) } catch { measuredHeadIsAncestor = false }
// The benchmark code SHA-256 of the measured HEAD, recomputed from its git objects by the runner rule (independent of the raw).
const codeHash = createHash('sha256')
for (const file of git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)) {
  codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0')
}
const recomputedBenchmarkCodeSha256 = codeHash.digest('hex')
const smoke = r.environment.smoke !== null
// An interrupted run is analyzed from its post-hoc reconstruction; it is graded by the runner start attestation alone.
const interrupted = r.status === 'interrupted' && r.interruption !== undefined && r.reconstruction?.postHoc === true && r.reconstruction?.childRecordsModified === false
const formalRunConditions = (r.status === 'completed' || interrupted) && !smoke && measuredHeadIsAncestor
if (!formalRunConditions && !allowNonformal) throw new Error('The raw run is not a formal run (smoke options, not completed / interrupted, or a measured HEAD outside this history).')
if (r.status !== 'completed' && !interrupted) throw new Error(`The raw run did not complete (${r.status}).`)
const interruption = interrupted ? { stoppedAt: r.interruption.stoppedAt, reason: r.interruption.reason, notRunTaskIds: r.interruption.notRunTaskIds } : null

const stream = s => s === null ? null : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }
const compactCandidate = c => c === null || c === undefined ? null : { deliveryIndex: c.deliveryIndex, stableKeySha256: sha(c.stableKey), orderingKeys: c.orderingKeys,
  respectsReservation: c.reservationCheck.respects, routeKind: c.summary.routeKind, sourceKind: c.summary.sourceKind, estimatedOperationCount: c.summary.estimatedOperationCount,
  estimatedAdvances: c.summary.estimatedAdvances, operationTypes: c.summary.operationTypes, normal: stream(c.summary.normal), gogma: stream(c.summary.gogma), skill: stream(c.summary.skill),
  heldRoute: c.summary.heldRoute }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const c2b2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2D.ts')
  const targetsModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DTargets.ts')
  const c2b2cTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2CTargets.ts')
  const e1Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts')
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

  // Launch provenance (evidence grade) is a separate axis from the Search decision: the runner start attestation of the run
  // dir, verified against independently obtained values. --allow-nonformal only lets a non-formal RESULT be written.
  const probeManifestParse = c2b2d.parsePhase2C26B2C2B2DProbeManifest(json(probesFile))
  const attestationPath = join(paths.runDir, c2b2d.PHASE2C26B2C2B2D_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const launchProvenance = analysis.phase2c26b2c2b2dLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      probes: probeManifestParse.manifest?.probes ?? [], firstChildStartedAt: r.tasksChild?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2dEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: interrupted })

  // Authorities, re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  // A present attestation whose integrity fails is an invalid run; an absent one, or one truthfully attesting a non-formal
  // launch (uncommitted / smoke), only makes the evidence non-formal.
  if (attestationFile !== null) invalidReasons.push(...launchProvenance.integrityIssues.map(i => `start_attestation: ${i}`))
  const b2c2b1Json = json(b2c2b1File)
  const parsedB2C2B1 = e1Targets.parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1File.source.sha256)
  if (!parsedB2C2B1.valid) invalidReasons.push(...parsedB2C2B1.issues.map(i => `b2c2b1_authority: ${i}`))
  const parsedB2C1 = c2aTargets.parsePhase2C26B2C2AB2C1Authority(json(b2c1File), b2c1File.source.sha256)
  if (!parsedB2C1.valid) invalidReasons.push(...parsedB2C1.issues.map(i => `b2c1_authority: ${i}`))
  const parsedB2B1 = b2c1Analysis.parsePhase2C26B2C1B2B1Authority(json(b2b1File), b2b1File.source.sha256)
  if (!parsedB2B1.valid) invalidReasons.push(...parsedB2B1.issues.map(i => `b2b1_authority: ${i}`))
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(json(oracleFile))
  if (!oracleParse.valid) invalidReasons.push(...oracleParse.issues.map(i => `oracle: ${i}`))
  if (!probeManifestParse.valid) invalidReasons.push(...probeManifestParse.issues.map(i => `probe_manifest: ${i}`))
  const exportSha256 = exportFile.source.sha256
  const parsedB2C2B2B = c2b2cTargets.parsePhase2C26B2C2B2CB2C2B2BAuthority(json(b2c2b2bFile), b2c2b2bFile.source.sha256, { b2c2b1ResultSha256: b2c2b1File.source.sha256, exportSha256 })
  if (!parsedB2C2B2B.valid) invalidReasons.push(...parsedB2C2B2B.issues.map(i => `b2c2b2b_authority: ${i}`))
  const parsedB2C2B2C = targetsModule.parsePhase2C26B2C2B2DB2C2B2CAuthority(json(b2c2b2cFile), b2c2b2cFile.source.sha256,
    { b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c1ResultSha256: b2c1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256, exportSha256 })
  if (!parsedB2C2B2C.valid) invalidReasons.push(...parsedB2C2B2C.issues.map(i => `b2c2b2c_authority: ${i}`))
  const authority = parsedB2C2B1.authority, b2c1Authority = parsedB2C1.authority, b2b1Authority = parsedB2B1.authority, oracle = oracleParse.oracle
  const b2c2b2bAuthority = parsedB2C2B2B.authority, b2c2b2cAuthority = parsedB2C2B2C.authority
  const probeManifest = probeManifestParse.manifest
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const ready = authority && b2c1Authority && b2b1Authority && oracle && probeManifest && b2c2b2bAuthority && b2c2b2cAuthority
  const hashChain = !ready ? null : {
    b2c2b1ResultIsRegistered: b2c2b1File.source.sha256 === c2b2d.PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256,
    probeManifestFromB2C2B1: probeManifest.sourceResultSha256 === b2c2b1File.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    probeManifestSourceMatchesRunner: probeManifest.sourceResultSha256 === r.environment.probeManifestSourceResultSha256,
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
    exportMatchesProbeManifest: exportSha256 === probeManifest.exportSha256,
    exportMatchesB2C2B1: exportSha256 === authority.exportSha256,
    exportMatchesB2C1: exportSha256 === b2c1Authority.exportSha256,
    exportMatchesB2B1: exportSha256 === b2b1Authority.exportSha256,
    exportMatchesOracle: exportSha256 === oracle.exportSha256,
    b2c2b2bResultIsRegistered: b2c2b2bFile.source.sha256 === c2b2cTargets.PHASE2C26B2C2B2C_REGISTERED_B2C2B2B.resultSha256,
    b2c2b2bMatchesB2C2B1: b2c2b2bAuthority.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    exportMatchesB2C2B2B: exportSha256 === b2c2b2bAuthority.exportSha256,
    b2c2b2cResultIsRegistered: b2c2b2cFile.source.sha256 === targetsModule.PHASE2C26B2C2B2D_REGISTERED_B2C2B2C.resultSha256,
    b2c2b2cMatchesB2C2B1: b2c2b2cAuthority.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    b2c2b2cMatchesB2C1: b2c2b2cAuthority.b2c1ResultSha256 === b2c1File.source.sha256,
    b2c2b2cMatchesB2C2B2B: b2c2b2cAuthority.b2c2b2bResultSha256 === b2c2b2bFile.source.sha256,
    exportMatchesB2C2B2C: exportSha256 === b2c2b2cAuthority.exportSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracle === null ? { valid: false, issues: ['no oracle'], checkedRoutes: 0 } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (!ready) {
    const decision = analysis.phase2c26b2c2b2dDecision({ invalidReasons, tasks: 0, targets: 0, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 } })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-C2B2D (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2B2D_INVALID: ${decision.reasons.join('; ')}`)
  }
  // The population and the probes: the manifest must be exactly the re-derived E1 ∩ L2 probes (= the B2-C2B2C Targets), each
  // at its B2-C1 / B2-C2B1 / B2-C2B2C first compatible rank and its tight extent max(Production default, B2-C2B1 required).
  const derived = targetsModule.phase2c26b2c2b2dProbes(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority)
  invalidReasons.push(...derived.issues.map(i => `probes: ${i}`))
  const expectedManifest = derived.valid ? targetsModule.phase2c26b2c2b2dProbeManifest(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority) : null
  const split = derived.population.split
  const targetWeaponIds = probeManifest.probes.map(p => p.targetWeaponId)
  const populationParity = { manifestEqualsDerivedProbes: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(probeManifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(targetWeaponIds), runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(probeManifest.probes),
    targets: targetWeaponIds.length, e1: split.e1.length, e1L1: split.l1.length, e1L2: split.l2.length, e1Overlap: split.overlap, e1Union: split.union,
    e1L1EqualsB2C2B2BTargets: JSON.stringify(split.l1) === JSON.stringify(b2c2b2bAuthority.targetWeaponIds),
    populationEqualsB2C2B2CTargets: JSON.stringify(targetWeaponIds) === JSON.stringify(b2c2b2cAuthority.targetWeaponIds),
    everyTargetFirstRungL2: targetWeaponIds.every(id => authority.routes.find(x => x.targetWeaponId === id)?.firstLadderRung === 'L2'),
    overlapsB2C2B2B: targetWeaponIds.filter(id => b2c2b2bAuthority.targetWeaponIds.includes(id)).length, overlapsE2: targetWeaponIds.filter(id => authority.e2.includes(id)).length }
  if (!populationParity.manifestEqualsDerivedProbes) invalidReasons.push('probe_manifest: the manifest is not the re-derived E1 ∩ L2 probes')
  if (!populationParity.runnerTargetsEqualManifest) invalidReasons.push('probe_manifest: the runner Targets are not the manifest Targets')
  if (!populationParity.runnerProbesEqualManifest) invalidReasons.push('probe_manifest: the runner probes are not the manifest probes')
  if (!populationParity.populationEqualsB2C2B2CTargets) invalidReasons.push('population: the probe Targets are not the B2-C2B2C Targets')

  // The schedule, re-derived from the Export through the unchanged B2-C1 calculation, and the task parity.
  const input = research.globalResearchInputFromExport(JSON.parse(exportFile.raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const scheduleConsistency = b2c1Analysis.validatePhase2C26B2C1Schedule(schedule)
  if (!scheduleConsistency.valid) invalidReasons.push(...scheduleConsistency.issues.map(i => `schedule: ${i}`))
  const b2b1Parity = b2c1Analysis.validatePhase2C26B2C1B2B1Parity(schedule, b2b1Authority, sha)
  if (!b2b1Parity.valid) invalidReasons.push(...b2b1Parity.issues.map(i => `b2b1_parity: ${i}`))
  const policyDrift = c2b2d.phase2c26b2c2b2dPolicyDrift(schedule)
  invalidReasons.push(...policyDrift.map(i => `policy: ${i}`))
  const rebuilt = c2b2d.buildPhase2C26B2C2B2DTasks(schedule, derived.probes)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `tasks: ${i}`))
  const summary = r.tasksChild.scheduleSummary
  const scheduleParity = {
    tasksMatchReDerivedSchedule: JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks),
    contextsDigestMatches: summary.contextsDigest === sha(hashing.stableStringify(schedule.contexts)),
    originDigestMatches: summary.originDigest === schedule.snapshot.originDigest,
    scheduleExtentIsDefault: JSON.stringify(summary.extent) === JSON.stringify(schedule.extent) && JSON.stringify(schedule.extent) === JSON.stringify(e1Targets.PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[0].extent),
    policiesMatch: JSON.stringify(summary.policies) === JSON.stringify(schedule.policies),
    originsMatchB2C2B2C: JSON.stringify(schedule.origins) === JSON.stringify(b2c2b2cAuthority.origins),
    everyTaskAtItsTightExtent: r.tasks.length === derived.probes.length && r.tasks.every((t, i) => JSON.stringify(t.extent) === JSON.stringify(derived.probes[i].extent)),
    everyTaskInsideBounds: r.tasks.every(t => c2b2d.phase2c26b2c2b2dExtentBoundIssues(t.extent).length === 0),
    noTaskAtCommonL2: r.tasks.every(t => JSON.stringify(t.extent) !== JSON.stringify({ ...c2b2d.PHASE2C26B2C2B2D_COMMON_L2_EXTENT })),
    everyTaskAtFirstCompatibleRank: r.tasks.every((t, i) => t.contextRank === derived.probes[i].contextRank),
    notRunMatchesInterruption: interruption === null ? r.stage1.length === r.tasks.length || smoke
      : r.stage1.length + interruption.notRunTaskIds.length === r.tasks.length && JSON.stringify(r.notRun.map(t => t.taskId)) === JSON.stringify(interruption.notRunTaskIds),
    calculationContextMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.calculationContext === null) || JSON.stringify(run.calculationContext) === JSON.stringify(input.calculationContext))
      && JSON.stringify(r.tasksChild.calculationContext) === JSON.stringify(input.calculationContext) && JSON.stringify(input.calculationContext) === JSON.stringify(b2c2b2cAuthority.calculationContext),
    researchMaxPlanStepsMatchesB2C2B2C: input.options.maxPlanSteps === b2c2b2cAuthority.researchMaxPlanSteps,
    engineMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.rngEngineVersion === null) || run.rngEngineVersion === engine.version) && r.environment.rngEngineVersion === engine.version,
    taskCount: r.tasks.length,
  }
  for (const [name, ok] of Object.entries(scheduleParity)) if (ok === false) invalidReasons.push(`schedule_parity: ${name}`)
  if (!smoke && (JSON.stringify(r.environment.stage1) !== JSON.stringify(c2b2d.PHASE2C26B2C2B2D_STAGE1) || r.environment.maxCostCohorts !== c2b2d.PHASE2C26B2C2B2D_MAX_COST_COHORTS
    || r.environment.candidateSafetyCap !== c2b2d.PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP || r.environment.expectedTasks !== c2b2d.PHASE2C26B2C2B2D_EXPECTED_TASKS
    || r.environment.contextSelection !== c2b2d.PHASE2C26B2C2B2D_CONTEXT_SELECTION.id || r.environment.extentRule !== c2b2d.PHASE2C26B2C2B2D_EXTENT_RULE.id)) {
    invalidReasons.push('conditions: Stage 1 / capture / task / context selection / extent rule conditions are not the registered ones')
  }
  // Stage 1 is B2-C2B2C's as its RESULT recorded it (neither the budget nor the heap was raised).
  if (!smoke && JSON.stringify(r.environment.stage1) !== JSON.stringify(b2c2b2cAuthority.stage1)) invalidReasons.push('conditions: Stage 1 differs from the B2-C2B2C RESULT')
  for (const [flag, value] of Object.entries(c2b2d.PHASE2C26B2C2B2D_PROVENANCE_FLAGS)) if (r.environment[flag] !== value) invalidReasons.push(`provenance: ${flag} is not ${String(value)}`)

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

  // Post-hoc compatibility (must reproduce B2-C1), the oracle comparison and the paired comparison with B2-C2B2C.
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, targetWeaponIds, manifest, oracle)
  const searchOf = run => run?.record?.status === 'searched' ? run.record.search : null
  const excludedRouteKeySha256 = new Map(runs.map(run => [run.taskId, searchOf(run) ? sha(searchOf(run).excludedRouteKeys[0]) : null]))
  const audit = analysis.runPhase2C26B2C2B2DAnalysis({ derivations: derived.derivations, tasks: r.tasks, runs, reach, excludedRouteKeySha256, b2c2b2c: b2c2b2cAuthority,
    oracle: { routes: oracle.routes, gogmaUsage: oracle.gogmaUsage }, smoke, interruption })
  invalidReasons.push(...audit.invalidReasons)

  const runOf = new Map(runs.map(run => [run.taskId, run]))
  const peak = run => ({ heap: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, (run?.memory?.maxRssKiB ?? 0) * 1024, run?.lastIpcMemory?.maxRssBytes ?? 0) })
  const taskRows = audit.contexts.map(c => {
    const run = runOf.get(c.taskId), s = searchOf(run)
    const task = r.tasks.find(t => t.taskId === c.taskId)
    return { taskId: c.taskId, targetWeaponId: c.targetWeaponId, contextRank: c.contextRank, groupIndex: c.groupIndex, reservationDigest: task.reservationDigest,
      targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds,
      defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: task.searchInputDigest, extent: task.extent, excludedRouteKeySha256: excludedRouteKeySha256.get(c.taskId) ?? null,
      process: run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, wallMs: run?.process.wallMs ?? null,
      searchElapsedMs: s?.elapsedMs ?? null, scheduleMs: run?.scheduleMs ?? null, peakHeapBytes: run ? peak(run).heap : null, peakRssBytes: run ? peak(run).rss : null, yields: run?.yields ?? null,
      status: s?.status ?? null, termination: s?.termination ?? null, candidateCount: c.candidateCount, deliveredCandidates: s?.summary.deliveredCandidates ?? null,
      excludedCandidates: s?.summary.excludedCandidates ?? null, distinctCostCohorts: s?.distinctCostCohorts ?? null, capturedCosts: c.capturedCosts, captureComplete: c.captureComplete,
      safetyCapHit: c.safetyCapHit, nextCostSentinel: s?.nextCostSentinel ? { deliveryIndex: s.nextCostSentinel.deliveryIndex, estimatedOperationCount: s.nextCostSentinel.orderingKeys.estimatedOperationCount } : null,
      compatible: c.compatible, coverage: c.coverage, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost, firstPartialIndex: c.firstPartialIndex, exactCount: c.exactIndexes.length,
      partialCount: c.partialIndexes.length, hit: c.hit, sentinelExact: c.sentinelExact, sentinelPartial: c.sentinelPartial, reservationViolations: c.reservationViolations,
      firstExactCandidate: c.firstExactIndex === null ? null : compactCandidate(s.candidates[c.firstExactIndex]) }
  })

  const b2c2b1Routes = new Map((b2c2b1Json.routes ?? []).map(route => [route.targetWeaponId, route]))
  const targets = audit.rows.map((row, index) => {
    const route = b2c2b1Routes.get(row.targetWeaponId)
    const derivation = derived.derivations.find(d => d.targetWeaponId === row.targetWeaponId)
    const baseline = b2c2b2cAuthority.targets.find(t => t.targetWeaponId === row.targetWeaponId)
    const pair = audit.paired.find(p => p.targetWeaponId === row.targetWeaponId)
    return { targetIndex: index, ...row,
      b2c2b1: route === undefined ? null : { required: route.required, insufficientStreams: route.insufficientStreams, firstLadderRung: route.firstLadderRung, p1FirstCompatibleRank: route.p1FirstCompatibleRank,
        routeKind: route.route?.routeKind ?? null, sourceKind: route.route?.sourceKind ?? null, conversion: route.route?.conversion ?? null, routeOperationCount: route.route?.operations ?? null },
      extents: derivation === undefined ? null : { required: derivation.required, tight: derivation.tightExtent, commonL2: derivation.commonL2Extent, deltaFromCommonL2: derivation.extentDeltaFromCommonL2,
        ratioToCommonL2: derivation.extentRatioToCommonL2, strictlySmallerStreams: derivation.strictlySmallerStreams },
      b2c2b2c: baseline === undefined ? null : { recovery: baseline.recovery, missClass: baseline.missClass, firstExact: baseline.firstExact,
        sameContextProcess: pair?.b2c2b2c?.process ?? null, sameContextHit: pair?.b2c2b2c?.hit ?? null },
      paired: pair ?? null }
  })
  const previouslyUnrecovered = b2c2b2cAuthority.targets.filter(t => t.recovery === 'none').map(t => t.targetWeaponId)
  const previouslyRecovered = b2c2b2cAuthority.targets.filter(t => t.recovery !== 'none').map(t => t.targetWeaponId)
  // The E1 aggregate (post hoc, never a decision input): B2-C2B2B's L1 half + this phase's L2 rows, beside the unchanged common ladder.
  const e1Aggregate = analysis.phase2c26b2c2b2dE1Aggregate({ e1: split.e1, l1: split.l1, l2: split.l2, b2c2b2b: b2c2b2bAuthority, b2c2b2c: b2c2b2cAuthority, rows: audit.rows,
    decision: null, evidenceGrade })
  invalidReasons.push(...e1Aggregate.issues.map(i => `e1_aggregate: ${i}`))
  const finalDecision = !formal && !allowNonformal ? null : analysis.phase2c26b2c2b2dDecision({ invalidReasons, ...audit.decisionInput })
  e1Aggregate.diagnostic.l2.decision = finalDecision?.case ?? null
  // The A / B / C interpretation (post hoc, never a decision input) over the Targets B2-C2B2C left unrecovered.
  const interpretation = analysis.phase2c26b2c2b2dInterpretation({ invalid: invalidReasons.length > 0, previouslyUnrecovered, previouslyRecovered, rows: audit.rows })
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2D: E1 ∩ L2 first compatible context x target-relative tight extent (oracle-guided diagnostic, post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, probeManifest: probesFile.source, export: exportFile.source, b2c2b1Result: b2c2b1File.source,
      b2c1Result: b2c1File.source, b2b1Result: b2b1File.source, b2c2b2bResult: b2c2b2bFile.source, b2c2b2cResult: b2c2b2cFile.source, oracle: oracleFile.source, oracleManifest: manifestFile.source },
    provenance: { formal, evidenceGrade, partialRun: interrupted,
      launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source, launchProvenanceReason: launchProvenance.reason,
      launchProvenanceIssues: launchProvenance.issues, launchProvenanceIntegrityIssues: launchProvenance.integrityIssues, launchWorkingTreeCleanVerified: launchProvenance.workingTreeCleanVerified,
      startAttestation: attestationFile === null ? null : { file: attestationFile.source.file, sha256: attestationFile.source.sha256, bytes: attestationFile.source.bytes, body: json(attestationFile) },
      recordedStartAttestation: r.launchAttestation ?? null,
      measuredHead, measuredHeadSource: launchProvenance.verified ? 'runner_start_attestation' : (r.environment.repositoryHeadSource ?? 'runner'), measuredHeadIsAncestor,
      recomputedBenchmarkCodeSha256, benchmarkCodeSha256: r.environment.benchmarkCodeSha256,
      analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, measurementCodeChangedSinceMeasuredHead: calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'],
      uncommittedBenchmarkCode: launchProvenance.verified ? false : r.environment.uncommittedBenchmarkCode ?? null,
      smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: exportFile.source.bytes,
      b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c2b1MeasuredHead: authority.measuredHead, b2c1ResultSha256: b2c1File.source.sha256, b2c1MeasuredHead: b2c1Authority.measuredHead,
      b2b1ResultSha256: b2b1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256, b2c2b2bMeasuredHead: b2c2b2bAuthority.measuredHead,
      b2c2b2cResultSha256: b2c2b2cFile.source.sha256, b2c2b2cMeasuredHead: b2c2b2cAuthority.measuredHead, oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256,
      oracleManifestRoutesSha256: manifestRoutesSha256, probeManifestSha256: probesFile.source.sha256,
      ...c2b2d.PHASE2C26B2C2B2D_PROVENANCE_FLAGS,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
      interruption: interruption === null ? null : r.interruption, reconstruction: r.reconstruction ?? null },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1: r.environment.stage1, tasksBudgetMs: r.environment.tasksBudgetMs, targets: r.environment.targets, contextsPerTarget: r.environment.contextsPerTarget,
      expectedTasks: r.environment.expectedTasks, maxCostCohorts: r.environment.maxCostCohorts, candidateSafetyCap: r.environment.candidateSafetyCap, capturePrefixes: r.environment.capturePrefixes,
      capturePolicies: analysis.PHASE2C26B2C2B2D_CAPTURE_POLICIES, contextSelection: c2b2d.PHASE2C26B2C2B2D_CONTEXT_SELECTION, extentRule: c2b2d.PHASE2C26B2C2B2D_EXTENT_RULE,
      extentFloor: r.environment.extentFloor, extentCeiling: r.environment.extentCeiling, probes: r.environment.probes, scheduleExtent: schedule.extent, nodeYield: r.environment.nodeYield,
      memorySampleIntervalMs: r.environment.memorySampleIntervalMs, registeredP1: r.environment.registeredP1, origins: schedule.origins, calculationContext: input.calculationContext,
      researchMaxPlanSteps: input.options.maxPlanSteps, notRun: r.environment.notRun,
      changedFromB2C2B2C: ['context selection: P1 ranks 1..32 -> the one B2-C1 first compatible rank per Target', 'Search extent: common L2 -> per Target max(Production default, B2-C2B1 required)'],
      unchangedFromB2C2B2C: ['population (the same 4 Targets)', 'Planner Alternative Search and B2-C2B2A Search body', 'C4C capture, 5th-cost sentinel, safety cap 1024', 'fresh child per task, concurrency 1',
        'heap 8192 MB', '10-minute budget', 'setImmediate yield', '250 ms memory sampling', 'no retry, no fallback', 'schedule / reservation universe / P1 ordering at the Production default extent',
        'runner start attestation contract'],
      population: 'B2-C2B1 cohort E1 ∩ firstLadderRung L2 (oracle-guided population, declared) = exactly the 4 Targets the B2-C2B2C RESULT searched',
      searchChildKnows: ['targetWeaponId', 'P1 context rank (the oracle-guided first compatible rank, given as a number)', 'reservation digest / group / representative alias (re-derived and checked)',
        'Planner-start origin (re-derived)', 'reservation (re-derived)', 'excluded current Route key (re-derived)', 'default / tight Search input digests', 'the tight extent (oracle-informed, given as numbers)',
        'capture rule (4 cost cohorts)', 'safety cap 1024'],
      searchChildNeverKnows: ['oracle RESULT', 'oracle manifest', 'B2-C1 / B2-C2B1 / B2-C2B2B / B2-C2B2C RESULTs', 'that the rank is the first compatible one', 'the required extent itself',
        'expected exact stable key', 'expected Candidate index', 'expected operation cost', 'expected route kind', 'oracle Route body', 'exact / partial expectation'],
      limitation: 'An oracle-guided diagnostic: the population, the context and the extent all come from post-hoc oracle evidence (B2-C1 / B2-C2B1). It measures only whether, with a known compatible context and the Search space cut to the Route\'s own requirement, the existing Search delivers the exact oracle Route under the B2-C2B2C execution budget. It is not evidence that Production could pick the first compatible context, know the required extent, or adopt Target-specific extents, and not evidence for a Production scheduler.' },
    parity: { b2c2b1Authority: { valid: parsedB2C2B1.valid, decisionCase: b2c2b1Json.decision?.case ?? null }, b2c1Authority: { valid: parsedB2C1.valid }, b2b1Authority: { valid: parsedB2B1.valid },
      oracle: { valid: oracleParse.valid }, b2c2b2bAuthority: { valid: parsedB2C2B2B.valid, issues: parsedB2C2B2B.issues, decisionCase: b2c2b2bAuthority.decisionCase },
      b2c2b2cAuthority: { valid: parsedB2C2B2C.valid, issues: parsedB2C2B2C.issues, decisionCase: b2c2b2cAuthority.decisionCase }, hashChain,
      manifestConsistency: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes }, population: { ...populationParity, issues: derived.issues },
      scheduleConsistency: { valid: scheduleConsistency.valid, issues: scheduleConsistency.issues }, b2b1Parity, policyDrift, taskConstruction: { valid: rebuilt.valid, issues: rebuilt.issues },
      scheduleParity, recordIssues, pairedIdentity: audit.paired.map(p => ({ taskId: p.taskId, b2c2b2cTaskId: p.b2c2b2cTaskId, ...p.identity })) },
    probes: derived.derivations,
    tasks: { total: r.tasks.length, targets: targetWeaponIds.length, contextsPerTarget: c2b2d.PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET },
    aggregates: audit.aggregates,
    pairedComparison: audit.paired,
    interpretation,
    e1Aggregate,
    targets,
    taskRows,
    decisionRule: analysis.PHASE2C26B2C2B2D_DECISION_RULE,
    invalidReasons,
    decision: finalDecision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, partialRun: interrupted, launchProvenance, hashChain, population: populationParity, scheduleParity, recordIssues: recordIssues.length,
    exactTargets: audit.aggregates.exactTargets, cascade: audit.aggregates.cascade, missClasses: audit.aggregates.missClasses, execution: audit.aggregates.execution,
    measurementCompleteness: audit.aggregates.measurementCompleteness,
    targets: targets.map(row => ({ t: row.targetWeaponId.slice(0, 8), rank: row.selectedRank, tight: row.extents?.tight, process: row.process, C8: row.hit.C8, C32: row.hit.C32, C4C: row.hit.C4C,
      idx: row.firstExactIndex, cost: row.firstExactCost, miss: row.missClass, transition: row.paired?.outcomeTransition, wallDelta: row.paired?.delta.wallMs, heapDelta: row.paired?.delta.peakHeapBytes })),
    interpretation: { case: interpretation.case, previouslyUnrecovered: interpretation.previouslyUnrecovered, previouslyRecoveredStillRecovered: interpretation.previouslyRecoveredStillRecovered },
    e1Aggregate: { commonLadder: e1Aggregate.commonLadder.total, diagnostic: e1Aggregate.diagnostic.total, statement: e1Aggregate.diagnostic.statement, issues: e1Aggregate.issues },
    invalidReasons: invalidReasons.slice(0, 30), invalidReasonCount: invalidReasons.length, decision: finalDecision }, null, 2))
} finally {
  await server.close()
}
