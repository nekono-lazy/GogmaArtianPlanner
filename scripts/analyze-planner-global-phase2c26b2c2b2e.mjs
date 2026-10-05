// Issue #154 Phase 2-C2.6-B2-C2B2E post-hoc analysis only. Reads the finished (or interrupted and reconstructed) B2-C2B2E raw
// run, its child records, its per-child memory logs and its runner start attestation (written by run-planner-global-phase2c26b2c2b2e.mjs)
// and, as explicit file arguments AFTER the run ended, the probe manifest, the Export (to re-derive the unchanged B2-C1 schedule),
// the B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C RESULTs (the authority chain B2-C2B2D read), the B2-C2B2D RESULT (the population
// source and the paired baseline of the same Search input) and the 1,657 oracle RESULT plus manifest (post-hoc reservation
// compatibility and Candidate coverage). It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation.
// Candidate stable keys are written as SHA-256 digests; the raw keys stay in the .local records.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'),
  b2b1: option('--b2b1-result'), b2c2b2b: option('--b2c2b2b-result'), b2c2b2c: option('--b2c2b2c-result'), b2c2b2d: option('--b2c2b2d-result'), oracle: option('--oracle'),
  manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2e.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c2b2b-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json --b2c2b2c-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json --b2c2b2d-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b1File, b2c1File, b2b1File, b2c2b2bFile, b2c2b2cFile, b2c2b2dFile, oracleFile, manifestFile] = await Promise.all([paths.run, paths.probes,
  paths.export, paths.b2c2b1, paths.b2c1, paths.b2b1, paths.b2c2b2b, paths.b2c2b2c, paths.b2c2b2d, paths.oracle, paths.manifest].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2EAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2e.mjs', 'scripts/reconstruct-planner-global-phase2c26b2c2b2e-partial-raw.mjs']
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
  const c2b2e = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2E.ts')
  const c2b2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2D.ts')
  const targetsModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ETargets.ts')
  const d2Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DTargets.ts')
  const c2b2cTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2CTargets.ts')
  const e1Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2EAnalysis.ts')
  const d2Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts')
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
  const probeManifestParse = c2b2e.parsePhase2C26B2C2B2EProbeManifest(json(probesFile))
  const attestationPath = join(paths.runDir, c2b2e.PHASE2C26B2C2B2E_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const launchProvenance = analysis.phase2c26b2c2b2eLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      b2c2b2dResultSha256: targetsModule.PHASE2C26B2C2B2E_REGISTERED_B2C2B2D.resultSha256, probes: probeManifestParse.manifest?.probes ?? [],
      firstChildStartedAt: r.tasksChild?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2eEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: interrupted })

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
  const parsedB2C2B2C = d2Targets.parsePhase2C26B2C2B2DB2C2B2CAuthority(json(b2c2b2cFile), b2c2b2cFile.source.sha256,
    { b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c1ResultSha256: b2c1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256, exportSha256 })
  if (!parsedB2C2B2C.valid) invalidReasons.push(...parsedB2C2B2C.issues.map(i => `b2c2b2c_authority: ${i}`))
  const parsedB2C2B2D = targetsModule.parsePhase2C26B2C2B2EB2C2B2DAuthority(json(b2c2b2dFile), b2c2b2dFile.source.sha256, { b2c2b1ResultSha256: b2c2b1File.source.sha256,
    b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256, b2c2b2cResultSha256: b2c2b2cFile.source.sha256, exportSha256 })
  if (!parsedB2C2B2D.valid) invalidReasons.push(...parsedB2C2B2D.issues.map(i => `b2c2b2d_authority: ${i}`))
  const authority = parsedB2C2B1.authority, b2c1Authority = parsedB2C1.authority, b2b1Authority = parsedB2B1.authority, oracle = oracleParse.oracle
  const b2c2b2bAuthority = parsedB2C2B2B.authority, b2c2b2cAuthority = parsedB2C2B2C.authority, b2c2b2dAuthority = parsedB2C2B2D.authority
  const probeManifest = probeManifestParse.manifest
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const ready = authority && b2c1Authority && b2b1Authority && oracle && probeManifest && b2c2b2bAuthority && b2c2b2cAuthority && b2c2b2dAuthority
  const hashChain = !ready ? null : {
    b2c2b1ResultIsRegistered: b2c2b1File.source.sha256 === c2b2e.PHASE2C26B2C2B2E_PROBE_SOURCE.resultSha256,
    probeManifestFromB2C2B1: probeManifest.sourceResultSha256 === b2c2b1File.source.sha256,
    probeManifestFromB2C2B2D: probeManifest.b2c2b2dResultSha256 === b2c2b2dFile.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    probeManifestSourceMatchesRunner: probeManifest.sourceResultSha256 === r.environment.probeManifestSourceResultSha256,
    probeManifestB2C2B2DMatchesRunner: probeManifest.b2c2b2dResultSha256 === r.environment.probeManifestB2C2B2DResultSha256,
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
    b2c2b2cResultIsRegistered: b2c2b2cFile.source.sha256 === d2Targets.PHASE2C26B2C2B2D_REGISTERED_B2C2B2C.resultSha256,
    b2c2b2cMatchesB2C2B1: b2c2b2cAuthority.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    b2c2b2cMatchesB2C1: b2c2b2cAuthority.b2c1ResultSha256 === b2c1File.source.sha256,
    b2c2b2cMatchesB2C2B2B: b2c2b2cAuthority.b2c2b2bResultSha256 === b2c2b2bFile.source.sha256,
    exportMatchesB2C2B2C: exportSha256 === b2c2b2cAuthority.exportSha256,
    b2c2b2dResultIsRegistered: b2c2b2dFile.source.sha256 === targetsModule.PHASE2C26B2C2B2E_REGISTERED_B2C2B2D.resultSha256,
    b2c2b2dMatchesB2C2B1: b2c2b2dAuthority.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    b2c2b2dMatchesB2C1: b2c2b2dAuthority.b2c1ResultSha256 === b2c1File.source.sha256,
    b2c2b2dMatchesB2B1: b2c2b2dAuthority.b2b1ResultSha256 === b2b1File.source.sha256,
    b2c2b2dMatchesB2C2B2B: b2c2b2dAuthority.b2c2b2bResultSha256 === b2c2b2bFile.source.sha256,
    b2c2b2dMatchesB2C2B2C: b2c2b2dAuthority.b2c2b2cResultSha256 === b2c2b2cFile.source.sha256,
    exportMatchesB2C2B2D: exportSha256 === b2c2b2dAuthority.exportSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracle === null ? { valid: false, issues: ['no oracle'], checkedRoutes: 0 } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (!ready) {
    const decision = analysis.phase2c26b2c2b2eDecision({ invalidReasons, tasks: 0, targets: 0, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 } })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-C2B2E (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2B2E_INVALID: ${decision.reasons.join('; ')}`)
  }
  // The population and the probes: the manifest must be exactly the re-derived population (the B2-C2B2D Targets unrecovered with a
  // timeout / out-of-memory task) at B2-C2B2D's selected rank, tight extent and task ID.
  const derived = targetsModule.phase2c26b2c2b2eProbes(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority, b2c2b2dAuthority)
  invalidReasons.push(...derived.issues.map(i => `probes: ${i}`))
  const expectedManifest = derived.valid ? targetsModule.phase2c26b2c2b2eProbeManifest(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority, b2c2b2dAuthority) : null
  const e1Population = d2Targets.phase2c26b2c2b2dPopulation(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority)
  invalidReasons.push(...e1Population.issues.map(i => `e1_population: ${i}`))
  const split = e1Population.split
  const targetWeaponIds = probeManifest.probes.map(p => p.targetWeaponId)
  const populationParity = { manifestEqualsDerivedProbes: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(probeManifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(targetWeaponIds), runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(probeManifest.probes),
    targets: targetWeaponIds.length, previouslyUnrecovered: derived.population.previouslyUnrecovered.length, previouslyRecovered: derived.population.previouslyRecovered.length,
    otherwiseUnrecovered: derived.population.otherwiseUnrecovered.length, populationIsB2C2B2DUnmeasuredUnrecovered: JSON.stringify(targetWeaponIds) === JSON.stringify(derived.population.targetWeaponIds),
    populationInsideB2C2B2D: targetWeaponIds.every(id => b2c2b2dAuthority.targetWeaponIds.includes(id)),
    e1: split.e1.length, e1L1: split.l1.length, e1L2: split.l2.length, e1Overlap: split.overlap, e1Union: split.union,
    everyTargetFirstRungL2: targetWeaponIds.every(id => authority.routes.find(x => x.targetWeaponId === id)?.firstLadderRung === 'L2'),
    overlapsB2C2B2B: targetWeaponIds.filter(id => b2c2b2bAuthority.targetWeaponIds.includes(id)).length, overlapsE2: targetWeaponIds.filter(id => authority.e2.includes(id)).length }
  if (!populationParity.manifestEqualsDerivedProbes) invalidReasons.push('probe_manifest: the manifest is not the re-derived probes')
  if (!populationParity.runnerTargetsEqualManifest) invalidReasons.push('probe_manifest: the runner Targets are not the manifest Targets')
  if (!populationParity.runnerProbesEqualManifest) invalidReasons.push('probe_manifest: the runner probes are not the manifest probes')
  if (!populationParity.populationIsB2C2B2DUnmeasuredUnrecovered) invalidReasons.push('population: the probe Targets are not the B2-C2B2D unmeasured unrecovered Targets')

  // The schedule, re-derived from the Export through the unchanged B2-C1 calculation, and the task parity.
  const input = research.globalResearchInputFromExport(JSON.parse(exportFile.raw.toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const scheduleConsistency = b2c1Analysis.validatePhase2C26B2C1Schedule(schedule)
  if (!scheduleConsistency.valid) invalidReasons.push(...scheduleConsistency.issues.map(i => `schedule: ${i}`))
  const b2b1Parity = b2c1Analysis.validatePhase2C26B2C1B2B1Parity(schedule, b2b1Authority, sha)
  if (!b2b1Parity.valid) invalidReasons.push(...b2b1Parity.issues.map(i => `b2b1_parity: ${i}`))
  const policyDrift = c2b2e.phase2c26b2c2b2ePolicyDrift(schedule)
  invalidReasons.push(...policyDrift.map(i => `policy: ${i}`))
  const rebuilt = c2b2e.buildPhase2C26B2C2B2ETasks(schedule, derived.probes)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `tasks: ${i}`))
  const summary = r.tasksChild.scheduleSummary
  const b2dRowOf = id => b2c2b2dAuthority.taskRows.find(row => row.targetWeaponId === id)
  const scheduleParity = {
    tasksMatchReDerivedSchedule: JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks),
    contextsDigestMatches: summary.contextsDigest === sha(hashing.stableStringify(schedule.contexts)),
    originDigestMatches: summary.originDigest === schedule.snapshot.originDigest,
    scheduleExtentIsDefault: JSON.stringify(summary.extent) === JSON.stringify(schedule.extent) && JSON.stringify(schedule.extent) === JSON.stringify(e1Targets.PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[0].extent),
    policiesMatch: JSON.stringify(summary.policies) === JSON.stringify(schedule.policies),
    originsMatchB2C2B2D: JSON.stringify(schedule.origins) === JSON.stringify(b2c2b2dAuthority.origins),
    everyTaskAtB2C2B2DTightExtent: r.tasks.length === derived.probes.length && r.tasks.every(t => JSON.stringify(t.extent) === JSON.stringify(b2dRowOf(t.targetWeaponId)?.extent)),
    everyTaskAtB2C2B2DRank: r.tasks.every(t => t.contextRank === b2dRowOf(t.targetWeaponId)?.contextRank),
    everyTaskAtB2C2B2DSearchInputDigest: r.tasks.every(t => t.searchInputDigest === b2dRowOf(t.targetWeaponId)?.searchInputDigest && t.defaultSearchInputDigest === b2dRowOf(t.targetWeaponId)?.defaultSearchInputDigest),
    everyTaskNamedByB2C2B2DTaskId: r.tasks.every(t => t.taskId === b2dRowOf(t.targetWeaponId)?.taskId),
    everyTaskInsideBounds: r.tasks.every(t => c2b2e.phase2c26b2c2b2eExtentBoundIssues(t.extent).length === 0),
    notRunMatchesInterruption: interruption === null ? r.stage1.length === r.tasks.length || smoke
      : r.stage1.length + interruption.notRunTaskIds.length === r.tasks.length && JSON.stringify(r.notRun.map(t => t.taskId)) === JSON.stringify(interruption.notRunTaskIds),
    calculationContextMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.calculationContext === null) || JSON.stringify(run.calculationContext) === JSON.stringify(input.calculationContext))
      && JSON.stringify(r.tasksChild.calculationContext) === JSON.stringify(input.calculationContext) && JSON.stringify(input.calculationContext) === JSON.stringify(b2c2b2dAuthority.calculationContext),
    researchMaxPlanStepsMatchesB2C2B2D: input.options.maxPlanSteps === b2c2b2dAuthority.researchMaxPlanSteps,
    engineMatches: r.stage1.every(run => (run.outcome.process !== 'completed' && run.rngEngineVersion === null) || run.rngEngineVersion === engine.version) && r.environment.rngEngineVersion === engine.version,
    taskCount: r.tasks.length,
  }
  for (const [name, ok] of Object.entries(scheduleParity)) if (ok === false) invalidReasons.push(`schedule_parity: ${name}`)
  // Execution conditions: Stage 1 is this phase's (60 minutes, 12,288 MB), and every other Stage 1 field is B2-C2B2D's as its RESULT recorded it.
  const stage1 = r.environment.stage1
  const changed = c2b2e.PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS
  const conditionChecks = { stage1IsRegistered: JSON.stringify(stage1) === JSON.stringify(c2b2e.PHASE2C26B2C2B2E_STAGE1),
    b2c2b2dStage1IsItsRegistered: JSON.stringify(b2c2b2dAuthority.stage1) === JSON.stringify(c2b2d.PHASE2C26B2C2B2D_STAGE1),
    onlyBudgetAndHeapDiffer: JSON.stringify(Object.keys(stage1).filter(k => JSON.stringify(stage1[k]) !== JSON.stringify(b2c2b2dAuthority.stage1[k])).sort()) === JSON.stringify([...changed].sort()),
    budgetIs60Minutes: stage1.budgetMs === c2b2e.PHASE2C26B2C2B2E_BUDGET_MS, heapIs12288Mb: stage1.childHeapMb === c2b2e.PHASE2C26B2C2B2E_CHILD_HEAP_MB,
    concurrencyIs1: stage1.concurrency === 1, noRetry: stage1.retry === 'none', noFallback: stage1.fallback === 'none',
    everyChildAtTheBudget: r.stage1.every(run => run.process.budgetMs === stage1.budgetMs), everyChildAtTheHeap: r.processes === null || r.processes.filter(p => p.role === 'search').every(p => JSON.stringify(p.nodeFlags) === JSON.stringify([`--max-old-space-size=${stage1.childHeapMb}`])),
    captureUnchanged: r.environment.maxCostCohorts === c2b2d.PHASE2C26B2C2B2D_MAX_COST_COHORTS && r.environment.candidateSafetyCap === c2b2d.PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP
      && JSON.stringify(r.environment.capturePrefixes) === JSON.stringify(c2b2d.PHASE2C26B2C2B2D_CAPTURE_PREFIXES),
    yieldAndSamplingUnchanged: r.environment.nodeYield === c2b2d.PHASE2C26B2C2B2D_NODE_YIELD && r.environment.memorySampleIntervalMs === c2b2d.PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS,
    expectedTasks: r.environment.expectedTasks === c2b2e.PHASE2C26B2C2B2E_EXPECTED_TASKS,
    contextSelectionAndExtentRuleUnchanged: r.environment.contextSelection === c2b2d.PHASE2C26B2C2B2D_CONTEXT_SELECTION.id && r.environment.extentRule === c2b2d.PHASE2C26B2C2B2D_EXTENT_RULE.id,
    childCalculationIsB2C2B2D: c2b2e.runPhase2C26B2C2B2ETask === c2b2d.runPhase2C26B2C2B2DTask }
  if (!smoke) for (const [name, ok] of Object.entries(conditionChecks)) if (ok === false) invalidReasons.push(`conditions: ${name}`)
  for (const [flag, value] of Object.entries(c2b2e.PHASE2C26B2C2B2E_PROVENANCE_FLAGS)) if (r.environment[flag] !== value) invalidReasons.push(`provenance: ${flag} is not ${String(value)}`)

  // Child records, each checked against the SHA-256 the runner recorded; the memory logs as the runner appended them.
  const recordIssues = []
  const runs = []
  const memorySamples = new Map()
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
    const memoryPath = join(paths.runDir, `stage1-${run.taskId}.memory.jsonl`)
    memorySamples.set(run.taskId, existsSync(memoryPath) ? (await readFile(memoryPath)).toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [])
  }
  invalidReasons.push(...recordIssues.map(i => `raw_result: ${i}`))

  // Post-hoc compatibility (must reproduce B2-C1), the oracle comparison and the paired comparison with B2-C2B2D.
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, targetWeaponIds, manifest, oracle)
  const searchOf = run => run?.record?.status === 'searched' ? run.record.search : null
  const excludedRouteKeySha256 = new Map(runs.map(run => [run.taskId, searchOf(run) ? sha(searchOf(run).excludedRouteKeys[0]) : null]))
  // The default context of every B2-C2B2D counterpart, re-derived post hoc from this schedule by B2-C2B2D's own re-derivation (PR #203).
  const rederivations = new Map(r.tasks.flatMap(task => {
    const row = b2dRowOf(task.targetWeaponId)
    return row === undefined ? [] : [[task.taskId, d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, row, sha)]]
  }))
  const audit = analysis.runPhase2C26B2C2B2EAnalysis({ derivations: derived.derivations, tasks: r.tasks, runs, reach, excludedRouteKeySha256, rederivations, memorySamples, b2c2b2d: b2c2b2dAuthority,
    oracle: { routes: oracle.routes, gogmaUsage: oracle.gogmaUsage }, smoke, conditions: { budgetMs: stage1.budgetMs, childHeapMb: stage1.childHeapMb }, interruption })
  invalidReasons.push(...audit.invalidReasons)

  const runOf = new Map(runs.map(run => [run.taskId, run]))
  const taskRows = audit.contexts.map(c => {
    const run = runOf.get(c.taskId), s = searchOf(run)
    const task = r.tasks.find(t => t.taskId === c.taskId)
    const peak = run ? analysis.phase2c26b2c2b2ePeak(run) : null
    return { taskId: c.taskId, targetWeaponId: c.targetWeaponId, contextRank: c.contextRank, groupIndex: c.groupIndex, reservationDigest: task.reservationDigest,
      targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds,
      defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: task.searchInputDigest, extent: task.extent, excludedRouteKeySha256: excludedRouteKeySha256.get(c.taskId) ?? null,
      process: run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, budgetMs: run?.process.budgetMs ?? null,
      wallMs: run?.process.wallMs ?? null, searchElapsedMs: s?.elapsedMs ?? null, scheduleMs: run?.scheduleMs ?? null, peakHeapBytes: peak?.heap ?? null, peakRssBytes: peak?.rss ?? null,
      yields: run?.yields ?? null, status: s?.status ?? null, termination: s?.termination ?? null, candidateCount: c.candidateCount, deliveredCandidates: s?.summary.deliveredCandidates ?? null,
      excludedCandidates: s?.summary.excludedCandidates ?? null, distinctCostCohorts: s?.distinctCostCohorts ?? null, capturedCosts: c.capturedCosts, captureComplete: c.captureComplete,
      safetyCapHit: c.safetyCapHit, nextCostSentinel: s?.nextCostSentinel ? { deliveryIndex: s.nextCostSentinel.deliveryIndex, estimatedOperationCount: s.nextCostSentinel.orderingKeys.estimatedOperationCount } : null,
      compatible: c.compatible, coverage: c.coverage, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost, firstPartialIndex: c.firstPartialIndex, exactCount: c.exactIndexes.length,
      partialCount: c.partialIndexes.length, hit: c.hit, sentinelExact: c.sentinelExact, sentinelPartial: c.sentinelPartial, reservationViolations: c.reservationViolations,
      firstExactCandidate: c.firstExactIndex === null ? null : compactCandidate(s.candidates[c.firstExactIndex]) }
  })

  const b2c2b1Routes = new Map((b2c2b1Json.routes ?? []).map(route => [route.targetWeaponId, route]))
  const nextBranch = analysis.phase2c26b2c2b2eNextBranch({ invalid: invalidReasons.length > 0, rows: audit.rows, b2c2b2d: b2c2b2dAuthority })
  const targets = audit.rows.map((row, index) => {
    const route = b2c2b1Routes.get(row.targetWeaponId)
    const derivation = derived.derivations.find(d => d.targetWeaponId === row.targetWeaponId)
    const pair = audit.paired.find(p => p.targetWeaponId === row.targetWeaponId)
    return { targetIndex: index, ...row,
      type: nextBranch.perTarget.find(t => t.targetWeaponId === row.targetWeaponId)?.type ?? null,
      b2c2b1: route === undefined ? null : { required: route.required, insufficientStreams: route.insufficientStreams, firstLadderRung: route.firstLadderRung, p1FirstCompatibleRank: route.p1FirstCompatibleRank,
        routeKind: route.route?.routeKind ?? null, sourceKind: route.route?.sourceKind ?? null, conversion: route.route?.conversion ?? null, routeOperationCount: route.route?.operations ?? null },
      extents: derivation === undefined ? null : { required: derivation.required, tight: derivation.tightExtent, commonL2: derivation.commonL2Extent },
      paired: pair ?? null,
      trajectory: audit.trajectories.find(t => t.taskId === row.taskId)?.trajectory ?? null }
  })
  // The E1 aggregate (post hoc, never a decision input): B2-C2B2B's L1 half + B2-C2B2D's recovered L2 Targets + this phase's rows, beside the unchanged common ladder.
  const e1Aggregate = analysis.phase2c26b2c2b2eE1Aggregate({ e1: split.e1, l1: split.l1, l2: split.l2, b2c2b2b: b2c2b2bAuthority, b2c2b2d: b2c2b2dAuthority, rows: audit.rows, decision: null, evidenceGrade })
  invalidReasons.push(...e1Aggregate.issues.map(i => `e1_aggregate: ${i}`))
  const finalDecision = !formal && !allowNonformal ? null : analysis.phase2c26b2c2b2eDecision({ invalidReasons, ...audit.decisionInput })
  e1Aggregate.diagnostic.l2.fromB2C2B2E.decision = finalDecision?.case ?? null
  const finalNextBranch = analysis.phase2c26b2c2b2eNextBranch({ invalid: invalidReasons.length > 0, rows: audit.rows, b2c2b2d: b2c2b2dAuthority })
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2E: the B2-C2B2D unmeasured unrecovered Targets, same first compatible context x tight extent, 60 minutes / 12 GB (oracle-guided diagnostic, post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, probeManifest: probesFile.source, export: exportFile.source, b2c2b1Result: b2c2b1File.source,
      b2c1Result: b2c1File.source, b2b1Result: b2b1File.source, b2c2b2bResult: b2c2b2bFile.source, b2c2b2cResult: b2c2b2cFile.source, b2c2b2dResult: b2c2b2dFile.source,
      oracle: oracleFile.source, oracleManifest: manifestFile.source },
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
      b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256,
      b2c2b2cResultSha256: b2c2b2cFile.source.sha256, b2c2b2dResultSha256: b2c2b2dFile.source.sha256, b2c2b2dMeasuredHead: b2c2b2dAuthority.measuredHead,
      b2c2b2dAnalysisHead: b2c2b2dAuthority.analysisHead, oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256,
      oracleManifestRoutesSha256: manifestRoutesSha256, probeManifestSha256: probesFile.source.sha256,
      ...c2b2e.PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
      measuredAt: r.measuredAt, runWallMs: r.wallMs, freeMemoryBytesAtLaunch: r.environment.freeMemoryBytesAtLaunch ?? null,
      interruption: interruption === null ? null : r.interruption, reconstruction: r.reconstruction ?? null },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    conditions: { stage1, b2c2b2dStage1: b2c2b2dAuthority.stage1, changedStage1Fields: [...changed], conditionChecks, tasksBudgetMs: r.environment.tasksBudgetMs, targets: r.environment.targets,
      contextsPerTarget: r.environment.contextsPerTarget, expectedTasks: r.environment.expectedTasks, maxCostCohorts: r.environment.maxCostCohorts, candidateSafetyCap: r.environment.candidateSafetyCap,
      capturePrefixes: r.environment.capturePrefixes, capturePolicies: analysis.PHASE2C26B2C2B2E_CAPTURE_POLICIES, population: r.environment.population,
      contextSelection: c2b2e.PHASE2C26B2C2B2E_CONTEXT_SELECTION, extentRule: c2b2e.PHASE2C26B2C2B2E_EXTENT_RULE, extentFloor: r.environment.extentFloor, extentCeiling: r.environment.extentCeiling,
      probes: r.environment.probes, scheduleExtent: schedule.extent, nodeYield: r.environment.nodeYield, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      registeredP1: r.environment.registeredP1, origins: schedule.origins, calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps, notRun: r.environment.notRun,
      changedFromB2C2B2D: ['budget: 10 minutes (600,000 ms) -> 60 minutes (3,600,000 ms)', 'child heap: 8,192 MB -> 12,288 MB', 'population: the 4 E1 ∩ L2 Targets -> the 2 B2-C2B2D left unmeasured and unrecovered (the 2 B2-C2B2D recovered are not re-run)'],
      unchangedFromB2C2B2D: ['the Target / B2-C1 P1 first compatible context / target-relative tight extent of every task (identical Search input digests)', 'Planner-start origin and reservation universe',
        'P1 ordering', 'the B2-C2B2D task construction and child calculation (the same function objects) and the B2-C2B2A Search body', 'Search comparator and Candidate materializer',
        'C4C capture, max 4 distinct cost cohorts, 5th-cost sentinel, safety cap 1024', 'fresh child per task, concurrency 1', 'setImmediate yield', '250 ms memory sampling', 'oracle isolation',
        'no exact early stop, no context early stop', 'no retry, no fallback', 'runner start attestation contract'],
      searchChildKnows: ['targetWeaponId', 'P1 context rank (the oracle-guided first compatible rank, given as a number)', 'reservation digest / group / representative alias (re-derived and checked)',
        'Planner-start origin (re-derived)', 'reservation (re-derived)', 'excluded current Route key (re-derived)', 'default / tight Search input digests', 'the tight extent (oracle-informed, given as numbers)',
        'capture rule (4 cost cohorts)', 'safety cap 1024'],
      searchChildNeverKnows: ['oracle RESULT', 'oracle manifest', 'B2-C1 / B2-C2B1 / B2-C2B2B / B2-C2B2C / B2-C2B2D RESULTs', 'B2-C2B2D measurements', 'that the rank is the first compatible one',
        'the required extent itself', 'expected exact stable key', 'expected Candidate index', 'expected operation cost', 'expected route kind', 'oracle Route body', 'exact / partial expectation'],
      limitation: 'An oracle-guided diagnostic: the population, the context and the extent all come from post-hoc oracle evidence, and the execution budget is beyond what B2-C2B2D used. It measures only whether, given the same known compatible context and tight extent, the existing Search delivers the exact oracle Route within 60 minutes and a 12 GB heap. It is not evidence that Production could pick the context, know the extent or afford the budget, and not evidence for a Production scheduler or runtime.' },
    parity: { b2c2b1Authority: { valid: parsedB2C2B1.valid, decisionCase: b2c2b1Json.decision?.case ?? null }, b2c1Authority: { valid: parsedB2C1.valid }, b2b1Authority: { valid: parsedB2B1.valid },
      oracle: { valid: oracleParse.valid }, b2c2b2bAuthority: { valid: parsedB2C2B2B.valid, issues: parsedB2C2B2B.issues, decisionCase: b2c2b2bAuthority.decisionCase },
      b2c2b2cAuthority: { valid: parsedB2C2B2C.valid, issues: parsedB2C2B2C.issues, decisionCase: b2c2b2cAuthority.decisionCase },
      b2c2b2dAuthority: { valid: parsedB2C2B2D.valid, issues: parsedB2C2B2D.issues, decisionCase: b2c2b2dAuthority.decisionCase }, hashChain,
      manifestConsistency: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes }, population: { ...populationParity, issues: derived.issues },
      scheduleConsistency: { valid: scheduleConsistency.valid, issues: scheduleConsistency.issues }, b2b1Parity, policyDrift, taskConstruction: { valid: rebuilt.valid, issues: rebuilt.issues },
      scheduleParity, recordIssues, pairedIdentity: audit.paired.map(p => ({ taskId: p.taskId, b2c2b2dTaskId: p.b2c2b2dTaskId, ...p.identity })),
      rederivations: [...rederivations.values()] },
    probes: derived.derivations,
    tasks: { total: r.tasks.length, targets: targetWeaponIds.length, contextsPerTarget: c2b2e.PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET },
    aggregates: audit.aggregates,
    pairedComparison: audit.paired,
    trajectories: audit.trajectories,
    nextBranch: finalNextBranch,
    e1Aggregate,
    targets,
    taskRows,
    decisionRule: analysis.PHASE2C26B2C2B2E_DECISION_RULE,
    invalidReasons,
    decision: finalDecision,
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, partialRun: interrupted, launchProvenance, hashChain, population: populationParity, scheduleParity, conditionChecks,
    recordIssues: recordIssues.length, exactTargets: audit.aggregates.exactTargets, cascade: audit.aggregates.cascade, missClasses: audit.aggregates.missClasses, execution: audit.aggregates.execution,
    measurementCompleteness: audit.aggregates.measurementCompleteness,
    targets: targets.map(row => ({ t: row.targetWeaponId.slice(0, 8), task: row.taskId, type: row.type, tight: row.extents?.tight, process: row.process, C8: row.hit.C8, C32: row.hit.C32, C4C: row.hit.C4C,
      idx: row.firstExactIndex, cost: row.firstExactCost, miss: row.missClass, transition: row.paired?.outcomeTransition, wall: row.paired?.b2c2b2e.wallMs, heap: row.paired?.b2c2b2e.peakHeapBytes,
      heap90At: row.trajectory?.heapReached90PctAtMs, plateau: row.trajectory?.heapPlateauInLastThird })),
    nextBranch: { branch: finalNextBranch.branch, perTarget: finalNextBranch.perTarget },
    e1Aggregate: { commonLadder: e1Aggregate.commonLadder.total, diagnostic: e1Aggregate.diagnostic.total, statement: e1Aggregate.diagnostic.statement, issues: e1Aggregate.issues },
    invalidReasons: invalidReasons.slice(0, 30), invalidReasonCount: invalidReasons.length, decision: finalDecision }, null, 2))
} finally {
  await server.close()
}
