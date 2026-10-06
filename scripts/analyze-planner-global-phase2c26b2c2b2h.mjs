// Issue #154 Phase 2-C2.6-B2-C2B2H post-hoc analysis only. Reads the finished B2-C2B2H raw run and its run dir (start attestation,
// processes.jsonl, the probe record, the Search child's durable B2-C2B2G snapshots, durable section stream, CPU profile, capture
// manifest and script table, and the child-attested Search identity) and, as explicit file arguments AFTER the run ended, the probe
// manifest, the Export (to re-derive the unchanged B2-C1 schedule, the task and the excluded current Route), the committed B2-C2B2G /
// B2-C2B2F / B2-C2B2E RESULTs (population source and identity authority) and B2-C2B2G's formal profile file (the semantic parity
// reference: its held-aware depth records). It runs no Search, no kernel and no Planner, reads no oracle and no A5 / A8 / A9 result,
// and feeds no evidence into any calculation. The registered function spans and the state_generation block are read from the measured
// HEAD's source text (git show).
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b2g: option('--b2c2b2g-result'),
  b2c2b2f: option('--b2c2b2f-result'), b2c2b2e: option('--b2c2b2e-result'), b2c2b2gProfile: option('--b2c2b2g-profile'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2h.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b2g-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json --b2c2b2f-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --b2c2b2g-profile <B2-C2B2G run dir>/stage1-<task>.profile.jsonl --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b2gFile, b2c2b2fFile, b2c2b2eFile, b2c2b2gProfileFile] = await Promise.all([paths.run, paths.probes, paths.export, paths.b2c2b2g,
  paths.b2c2b2f, paths.b2c2b2e, paths.b2c2b2gProfile].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const jsonLines = file => file.raw.toString('utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2HAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2h.mjs']
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
  const h = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2H.ts')
  const targetsModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HTargets.ts')
  const gTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2GTargets.ts')
  const fTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2FTargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HAnalysis.ts')
  const structure = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HCpuProfile.ts')
  const gAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2GAnalysis.ts')
  const a5Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts')
  const d2Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts')
  const b2c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')

  const invalidReasons = []
  // Launch provenance (evidence grade): the runner start attestation of the run dir, verified against independent values.
  const probeManifestParse = h.parsePhase2C26B2C2B2HProbeManifest(json(probesFile))
  if (!probeManifestParse.valid) invalidReasons.push(...probeManifestParse.issues.map(i => `probe_manifest: ${i}`))
  const reg = targetsModule.PHASE2C26B2C2B2H_REGISTERED_B2C2B2G
  const attestationPath = join(paths.runDir, h.PHASE2C26B2C2B2H_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const launchProvenance = analysis.phase2c26b2c2b2hLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      b2c2b2gResultSha256: reg.resultSha256, b2c2b2fResultSha256: reg.b2c2b2fResultSha256, b2c2b2eResultSha256: reg.b2c2b2eResultSha256,
      probes: probeManifestParse.manifest?.probes ?? [], expectedTaskIdentities: probeManifestParse.manifest?.expectedTaskIdentities ?? [],
      firstChildStartedAt: r.probe?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  if (attestationFile !== null) invalidReasons.push(...launchProvenance.integrityIssues.map(i => `start_attestation: ${i}`))
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2hEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: false })

  // The B2-C2B2G / B2-C2B2F / B2-C2B2E authorities, the population and the expected manifest, re-derived here.
  const parsedG = targetsModule.parsePhase2C26B2C2B2HB2C2B2GAuthority(json(b2c2b2gFile), b2c2b2gFile.source.sha256)
  if (!parsedG.valid) invalidReasons.push(...parsedG.issues.map(i => `b2c2b2g_authority: ${i}`))
  const parsedF = gTargets.parsePhase2C26B2C2B2GB2C2B2FAuthority(json(b2c2b2fFile), b2c2b2fFile.source.sha256)
  if (!parsedF.valid) invalidReasons.push(...parsedF.issues.map(i => `b2c2b2f_authority: ${i}`))
  const parsedE = fTargets.parsePhase2C26B2C2B2FB2C2B2EAuthority(json(b2c2b2eFile), b2c2b2eFile.source.sha256)
  if (!parsedE.valid) invalidReasons.push(...parsedE.issues.map(i => `b2c2b2e_authority: ${i}`))
  const derived = targetsModule.phase2c26b2c2b2hPopulation(parsedG.authority, parsedF.authority, parsedE.authority)
  if (!derived.valid) invalidReasons.push(...derived.issues.map(i => `population: ${i}`))
  const expectedManifest = parsedG.valid && parsedF.valid && parsedE.valid && derived.valid ? targetsModule.phase2c26b2c2b2hProbeManifest(parsedG.authority, parsedF.authority, parsedE.authority) : null
  const manifest = probeManifestParse.manifest
  const exportSha256 = exportFile.source.sha256
  const hashChain = {
    b2c2b2gResultIsRegistered: b2c2b2gFile.source.sha256 === reg.resultSha256,
    b2c2b2fResultIsRegistered: b2c2b2fFile.source.sha256 === reg.b2c2b2fResultSha256,
    b2c2b2eResultIsRegistered: b2c2b2eFile.source.sha256 === reg.b2c2b2eResultSha256,
    b2c2b2gMadeAgainstB2C2B2F: parsedG.authority?.b2c2b2fResultSha256 === b2c2b2fFile.source.sha256,
    b2c2b2gMadeAgainstB2C2B2E: parsedG.authority?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    b2c2b2fMadeAgainstB2C2B2E: parsedF.authority?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestFromB2C2B2G: manifest?.b2c2b2gResultSha256 === b2c2b2gFile.source.sha256,
    probeManifestFromB2C2B2F: manifest?.b2c2b2fResultSha256 === b2c2b2fFile.source.sha256,
    probeManifestFromB2C2B2E: manifest?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    probeManifestB2C2B2GMatchesRunner: manifest?.b2c2b2gResultSha256 === r.environment.probeManifestB2C2B2GResultSha256,
    exportMatchesRunner: exportSha256 === r.environment.exportSha256,
    exportMatchesProbeManifest: exportSha256 === manifest?.exportSha256,
    exportMatchesB2C2B2G: exportSha256 === parsedG.authority?.exportSha256,
    exportMatchesB2C2B2F: exportSha256 === parsedF.authority?.exportSha256,
    exportMatchesB2C2B2E: exportSha256 === parsedE.authority?.exportSha256,
    b2c2b2gProfileIsRecorded: b2c2b2gProfileFile.source.sha256 === parsedG.authority?.profileFile.sha256,
  }
  for (const [name, ok] of Object.entries(hashChain)) if (ok !== true) invalidReasons.push(`hash_chain: ${name}`)
  const populationParity = { manifestEqualsDerived: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(manifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(manifest?.probes.map(p => p.targetWeaponId) ?? null),
    runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(manifest?.probes ?? null),
    runnerIdentitiesEqualManifest: JSON.stringify(r.environment.expectedTaskIdentities) === JSON.stringify(manifest?.expectedTaskIdentities ?? null),
    probesEqualB2C2B2GProfiled: JSON.stringify(manifest?.probes ?? null) === JSON.stringify(parsedG.authority?.probes ?? null),
    identitiesEqualB2C2B2GProfiled: JSON.stringify(manifest?.expectedTaskIdentities ?? null) === JSON.stringify(parsedG.authority?.expectedTaskIdentities ?? null),
    targets: derived.targetWeaponIds.length, chain: derived.chain }
  for (const [name, ok] of Object.entries(populationParity)) if (ok === false) invalidReasons.push(`population: ${name}`)

  // Schedule re-derivation from the Export: the task and the excluded current Route, independent of the runner.
  const input = research.globalResearchInputFromExport(json(exportFile), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const rebuilt = manifest === null ? { valid: false, issues: ['no manifest'], tasks: [] } : h.buildPhase2C26B2C2B2HTasks(schedule, manifest)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `task_rebuild: ${i}`))
  const tasksEqualRebuilt = JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks)
  if (!tasksEqualRebuilt) invalidReasons.push('task_rebuild: the raw tasks are not the re-derived tasks')
  const eTaskRow = parsedE.authority?.taskRows.find(t => t.taskId === manifest?.probes[0]?.b2c2b2dTaskId) ?? null
  const rederivation = eTaskRow === null ? null : d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, eTaskRow, sha)
  if (rederivation === null || !rederivation.valid) invalidReasons.push(...(rederivation?.issues ?? ['no B2-C2B2E task row']).map(i => `excluded_route: ${i}`))
  const expectedIdentity = manifest?.expectedTaskIdentities[0] ?? null

  // The Search child: one run, the registered conditions.
  const run = r.stage1[0] ?? null
  const conditionIssues = analysis.phase2c26b2c2b2hConditionIssues({ smoke, runs: r.stage1, cpuProfilerConfig: r.environment.cpuProfilerConfig })
  invalidReasons.push(...conditionIssues.map(i => `conditions: ${i}`))
  const conditionChecks = {
    stage1IsRegistered: JSON.stringify(r.environment.stage1) === JSON.stringify(smoke ? { ...h.PHASE2C26B2C2B2H_STAGE1, budgetMs: r.environment.smoke.budgetMs ?? h.PHASE2C26B2C2B2H_STAGE1.budgetMs } : h.PHASE2C26B2C2B2H_STAGE1),
    stage1EqualsB2C2B2G: JSON.stringify(h.PHASE2C26B2C2B2H_STAGE1) === JSON.stringify(h.PHASE2C26B2C2B2H_B2C2B2G_STAGE1),
    b2c2b2gStage1MatchesAuthority: JSON.stringify(h.PHASE2C26B2C2B2H_B2C2B2G_STAGE1) === JSON.stringify(reg.stage1),
    budgetIs30Minutes: h.PHASE2C26B2C2B2H_STAGE1.budgetMs === 1_800_000, heapIs12288Mb: h.PHASE2C26B2C2B2H_STAGE1.childHeapMb === 12_288, concurrencyIs1: h.PHASE2C26B2C2B2H_STAGE1.concurrency === 1,
    noRetry: h.PHASE2C26B2C2B2H_STAGE1.retry === 'none' && r.stage1.length === 1, noFallback: h.PHASE2C26B2C2B2H_STAGE1.fallback === 'none',
    instrumentationIsB2C2B2GTwoObservers: JSON.stringify(r.environment.searchInstrumentation) === JSON.stringify({ onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false }),
    instrumentationEqualsB2C2B2GAuthority: JSON.stringify(r.environment.searchInstrumentation) === JSON.stringify(reg.searchInstrumentation),
    innerSectionsAreRegistered: JSON.stringify(r.environment.innerSections) === JSON.stringify([...h.PHASE2C26B2C2B2H_INNER_SECTIONS]),
    b2c2b2gRanNoCpuProfiler: r.environment.b2c2b2gCpuProfiler === false, cpuProfilerIsTheOnlyChange: JSON.stringify(r.environment.changedFromB2C2B2G) === JSON.stringify(['cpuProfiler']),
    cpuProfilerOn: r.environment.cpuProfiler === true,
    cpuProfilerConfigIsRegistered: smoke || JSON.stringify(r.environment.cpuProfilerConfig) === JSON.stringify({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 }),
    nodeFlagsAreHeapOnly: JSON.stringify(r.environment.nodeFlags) === JSON.stringify(['--max-old-space-size=12288']),
    conditionIssues: conditionIssues.length === 0 }
  for (const [name, ok] of Object.entries(conditionChecks)) if (ok !== true) invalidReasons.push(`conditions: ${name}`)
  const processesFile = await loadRaw(join(paths.runDir, 'processes.jsonl'))
  const processEntries = jsonLines(processesFile)
  const searchEntry = processEntries.find(p => p.role === 'search') ?? null
  const id = `stage1-${run?.taskId}`
  const fileOf = async (name, recorded) => {
    const path = join(paths.runDir, name)
    if (!existsSync(path)) return { file: null, issue: `${name}: missing` }
    const file = await loadRaw(path)
    return { file, issue: recorded?.sha256 === file.source.sha256 ? null : `${name}: not the file the parent recorded at the child exit` }
  }
  const profileIn = await fileOf(`${id}.profile.jsonl`, searchEntry?.profileFile)
  const sectionsIn = await fileOf(`${id}.sections.jsonl`, searchEntry?.sectionsFile)
  const cpuIn = await fileOf(`${id}.cpuprofile`, searchEntry?.cpuProfileFile)
  const captureIn = await fileOf(`${id}.capture.json`, searchEntry?.captureFile)
  const scriptsIn = await fileOf(`${id}.scripts.json`, searchEntry?.scriptsFile)
  // A missing / unrecorded profile snapshot file is no Search identity (INVALID); a missing CPU capture is an unusable profile (INSUFFICIENT).
  if (profileIn.issue !== null) invalidReasons.push(`profile: ${profileIn.issue}`)
  const captureIssues = [sectionsIn.issue, cpuIn.issue, captureIn.issue, scriptsIn.issue].filter(Boolean)
  const lines = profileIn.file === null ? [] : jsonLines(profileIn.file)
  const childIdentity = lines.find(l => l.kind === 'search_identity')?.identity ?? null
  const childIdentityChecks = { present: childIdentity !== null && childIdentity.valid === true,
    taskId: childIdentity?.taskId === expectedIdentity?.taskId, targetWeaponId: childIdentity?.targetWeaponId === expectedIdentity?.targetWeaponId,
    searchInputDigest: childIdentity?.searchInputDigest === expectedIdentity?.searchInputDigest, defaultSearchInputDigest: childIdentity?.defaultSearchInputDigest === expectedIdentity?.defaultSearchInputDigest,
    extent: JSON.stringify(childIdentity?.extent) === JSON.stringify(expectedIdentity?.extent), groupIndex: childIdentity?.groupIndex === expectedIdentity?.groupIndex,
    reservationDigest: childIdentity?.reservationDigest === expectedIdentity?.reservationDigest, excludedRouteIsCurrentRoute: childIdentity?.excludedRouteIsCurrentRoute === true,
    excludedRouteEqualsRederived: childIdentity?.excludedRouteKeyCount === 1 && childIdentity.excludedRouteKeySha256s[0] === rederivation?.excludedRouteKeySha256,
    excludedRouteEqualsB2C2B2G: childIdentity?.excludedRouteKeySha256s?.[0] === parsedG.authority?.excludedRouteKeySha256 }
  for (const [name, ok] of Object.entries(childIdentityChecks)) if (ok !== true) invalidReasons.push(`child_identity: ${name}`)

  // B2-C2B2G's snapshots of this run and the semantic parity with B2-C2B2G's formal run.
  const snapshots = lines.filter(l => l.kind === 'profile_snapshot')
  const selection = gAnalysis.phase2c26b2c2b2gSelectSnapshot(snapshots)
  const last = selection.last
  const b2c2b2gSnapshots = jsonLines(b2c2b2gProfileFile).filter(l => l.kind === 'profile_snapshot')
  const depthParity = analysis.phase2c26b2c2b2hDepthParity(b2c2b2gSnapshots, snapshots)
  if (!depthParity.valid) invalidReasons.push(...depthParity.issues.map(i => `semantic_parity: ${i}`))
  const innerObservation = last === null ? null : gAnalysis.phase2c26b2c2b2gInnerObservation(last)
  const reconciliation = last === null ? null : gAnalysis.phase2c26b2c2b2gSnapshotReconciliation(last)
  const outerSanity = last === null ? null : gAnalysis.phase2c26b2c2b2gOuterSanity(last)
  const profilerStarted = lines.find(l => l.kind === 'profiler_started') ?? null

  // The section stream, the CPU profile and its attribution.
  const sectionRecords = sectionsIn.file === null ? [] : jsonLines(sectionsIn.file)
  const reconstruction = analysis.reconstructPhase2C26B2C2B2HIntervals(sectionRecords)
  const capture = captureIn.file === null ? null : json(captureIn.file)
  const sourceTexts = Object.fromEntries(structure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(file => [file, gitBuffer('show', `${measuredHead}:${file}`).toString('utf8')]))
  let spans = null, block = null, spanDerivationError = null
  try {
    spans = structure.derivePhase2C26B2C2B2HFunctionSpans(sourceTexts)
    block = structure.derivePhase2C26B2C2B2HStateGenerationBlock(sourceTexts[structure.PHASE2C26B2C2B2H_BLOCK_MARKERS.file])
  } catch (error) { spanDerivationError = String(error) }
  let profileAnalysis = null, profileError = null
  if (cpuIn.file !== null && scriptsIn.file !== null && capture !== null && spans !== null && block !== null) {
    try {
      const cpu = analysis.validatePhase2C26B2C2B2HCpuProfile(json(cpuIn.file))
      const table = a5Analysis.createPhase2C26A5ScriptTable(json(scriptsIn.file), map => new sourceMap.SourceMapConsumer(map))
      profileAnalysis = analysis.analyzePhase2C26B2C2B2HProfile(cpu, table, spans, sourceTexts, block, capture.window, reconstruction)
    } catch (error) { profileError = String(error) }
  }
  const qualityIssues = [...captureIssues, ...(profileError === null ? [] : [`profile: ${profileError}`]), ...analysis.phase2c26b2c2b2hProfileQuality({
    profileWritten: cpuIn.file !== null, scriptTableWritten: scriptsIn.file !== null, requiredSourceMaps: capture?.scripts?.requiredSourceMaps ?? Object.fromEntries(structure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(f => [f, false])),
    window: capture === null ? null : { stoppedBy: capture.window.stoppedBy, error: capture.window.error, actualProfileDurationMs: capture.window.actualProfileDurationMs },
    spanDerivationError, outerContractViolations: last?.runtime.contractViolations ?? null, innerContractViolations: innerObservation?.contractViolations ?? null,
    outsideReadViolations: innerObservation?.outsideReadViolations ?? null, boundaryWriteFailures: last?.boundary?.writeFailures ?? null }, profileAnalysis)]
  if (last === null) qualityIssues.push('no profile snapshot')
  else if (!selection.valid) qualityIssues.push(...selection.issues.map(i => `snapshots: ${i}`))
  const decision = analysis.phase2c26b2c2b2hDecision({ invalidReasons, insufficientReasons: qualityIssues, analysis: profileAnalysis })

  // The profile window on the snapshot clock (Research elapsed since the profiler origin), and the yield wait.
  const alignment = profileAnalysis?.alignment ?? null
  const windowAtMs = alignment !== null && alignment.researchProfileStartMs !== null && profilerStarted !== null
    ? { fromMs: alignment.researchProfileStartMs - profilerStarted.originChildProcessMs, toMs: alignment.researchProfileEndMs - profilerStarted.originChildProcessMs } : null
  const yieldWait = analysis.phase2c26b2c2b2hYieldWait(snapshots, windowAtMs)
  const record = run?.outcome.record === 'searched' ? (await loadRaw(join(paths.runDir, run.recordFile.file))) : null
  const search = record === null ? null : json(record).result.search
  const childWallMs = run?.process.wallMs ?? null
  const lastTarget = last?.runtime.byTarget.find(t => t.targetOrdinal === 0) ?? null
  const outcome = { process: run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, naturalCompletion: search !== null,
    termination: search?.termination ?? null, candidateCount: search?.candidates.length ?? null, searchElapsedMs: search?.elapsedMs ?? null,
    childWallMs, killedAtMs: run?.process.killedAtMs ?? null, budgetMs: run?.process.budgetMs ?? null,
    deliveredBeforeKill: last === null ? null : { deliveryFlushes: lastTarget?.sectionCounts?.delivery_flush ?? null, deliveryConsumerCalls: lastTarget?.sectionCounts?.delivery_consumer ?? null },
    peakHeapBytes: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0), peakRssBytes: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, run?.lastIpcMemory?.maxRssBytes ?? 0),
    yields: run?.yields ?? null, profileSnapshots: snapshots.length, profileSource: selection.source,
    lastSnapshot: last === null ? null : { atMs: last.atMs, searchElapsedMs: last.searchElapsedMs, unobservedTailMs: selection.source === 'final' || profilerStarted === null || childWallMs === null ? 0 : Math.max(0, childWallMs - profilerStarted.originChildProcessMs - last.atMs) },
    note: 'A timeout is the normal profiling outcome and is never Candidate 0; no Route exact judgement is made. Runtime is never compared with B2-C2B2G (the CPU profiler changes it).' }
  const window = capture?.window ?? null
  const probe = r.probe?.probe ?? null

  const result = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2H (post-hoc analysis): B2-C2B2G STATE_GENERATION-dominant Target, B2-C2B2G Search input, V8 CPU attribution inside state_generation',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, processes: processesFile.source, profile: profileIn.file?.source ?? null, sections: sectionsIn.file?.source ?? null,
      cpuProfile: cpuIn.file?.source ?? null, capture: captureIn.file?.source ?? null, scripts: scriptsIn.file?.source ?? null, probeManifest: probesFile.source, export: exportFile.source,
      b2c2b2gResult: b2c2b2gFile.source, b2c2b2fResult: b2c2b2fFile.source, b2c2b2eResult: b2c2b2eFile.source, b2c2b2gProfile: b2c2b2gProfileFile.source },
    provenance: { formal, evidenceGrade, partialRun: false, launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source,
      launchProvenanceReason: launchProvenance.reason, launchProvenanceIssues: launchProvenance.issues, launchProvenanceIntegrityIssues: launchProvenance.integrityIssues,
      startAttestation: attestationFile === null ? null : { file: attestationFile.source.file, sha256: attestationFile.source.sha256, bytes: attestationFile.source.bytes, body: json(attestationFile) },
      measuredHead, measuredHeadSource: 'runner_start_attestation', measuredHeadIsAncestor, measuredAt: r.measuredAt, recomputedBenchmarkCodeSha256,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportSha256, b2c2b2gResultSha256: b2c2b2gFile.source.sha256, b2c2b2gMeasuredHead: parsedG.authority?.measuredHead ?? null, b2c2b2fResultSha256: b2c2b2fFile.source.sha256,
      b2c2b2fMeasuredHead: parsedF.authority?.measuredHead ?? null, b2c2b2eResultSha256: b2c2b2eFile.source.sha256, b2c2b2eMeasuredHead: parsedE.authority?.measuredHead ?? null,
      probeManifestSha256: probesFile.source.sha256, ...h.PHASE2C26B2C2B2H_PROVENANCE_FLAGS },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, cpu: r.environment.cpu,
      logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, freeMemoryBytesAtLaunch: r.environment.freeMemoryBytesAtLaunch,
      rngEngineVersion: r.environment.rngEngineVersion, profilerMethod: r.environment.profilerMethod },
    conditions: { stage1: r.environment.stage1, b2c2b2gStage1: r.environment.b2c2b2gStage1, changedStage1Fields: r.environment.changedStage1Fields, changedFromB2C2B2G: r.environment.changedFromB2C2B2G,
      conditionChecks, searchInstrumentation: r.environment.searchInstrumentation, innerSections: r.environment.innerSections, section: r.environment.section,
      b2c2b2gCpuProfiler: r.environment.b2c2b2gCpuProfiler, cpuProfiler: r.environment.cpuProfiler, cpuProfilerConfig: r.environment.cpuProfilerConfig, nodeFlags: r.environment.nodeFlags,
      sectionStream: r.environment.sectionStream, heartbeatIntervalMs: r.environment.heartbeatIntervalMs, windowsMs: r.environment.windowsMs, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      nodeYield: r.environment.nodeYield, candidateSafetyCap: r.environment.candidateSafetyCap, maxCostCohorts: r.environment.maxCostCohorts, notRun: r.environment.notRun,
      calculationContext: run?.calculationContext ?? r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps },
    population: { rule: `B2-C2B2G decision.case = ${reg.decisionCase}, decision.dominant = ${reg.dominant} and decision.nextPhaseSections = [${reg.nextPhaseSections.join(', ')}]: the Target(s) B2-C2B2G profiled, cross-checked against the population B2-C2B2G's derivation re-derives from B2-C2B2F and B2-C2B2E`,
      targetWeaponIds: derived.targetWeaponIds, probes: manifest?.probes ?? null, b2c2b2gBackground: parsedG.authority?.background ?? null },
    parity: { b2c2b2gAuthority: { valid: parsedG.valid, issues: parsedG.issues, decisionCase: parsedG.authority?.decisionCase ?? null, dominant: parsedG.authority?.dominant ?? null },
      b2c2b2fAuthority: { valid: parsedF.valid, issues: parsedF.issues }, b2c2b2eAuthority: { valid: parsedE.valid, issues: parsedE.issues },
      hashChain, population: populationParity, taskRebuild: { valid: rebuilt.valid, issues: rebuilt.issues, tasksEqualRebuilt },
      identity: { expected: expectedIdentity, raw: r.tasks[0] ? h.phase2c26b2c2b2hTaskIdentity(r.tasks[0]) : null,
        rawEqualsExpected: r.tasks[0] ? JSON.stringify(h.phase2c26b2c2b2hTaskIdentity(r.tasks[0])) === JSON.stringify(expectedIdentity) : false },
      excludedRoute: rederivation === null ? null : { valid: rederivation.valid, issues: rederivation.issues, excludedRouteKeyCount: rederivation.excludedRouteKeyCount,
        excludedRouteIsCurrentRoute: rederivation.excludedRouteIsCurrentRoute, rederivedExcludedRouteKeySha256: rederivation.excludedRouteKeySha256,
        b2c2b2gExcludedRouteKeySha256: parsedG.authority?.excludedRouteKeySha256 ?? null, childAttestedExcludedRouteKeySha256: childIdentity?.excludedRouteKeySha256s?.[0] ?? null },
      childIdentity: childIdentityChecks, semanticParityWithB2C2B2G: depthParity },
    probe: probe === null ? null : { valid: probe.valid, issues: probe.issues, samples: probe.samples, observedMedianIntervalUs: probe.observedMedianIntervalUs, alignment: probe.alignment,
      requiredSourceMaps: probe.scripts?.requiredSourceMaps ?? null, frameLines: probe.frameLines, stateGenerationBlock: probe.stateGenerationBlock },
    outcome,
    profilerWindow: window === null ? null : { requestedSamplingIntervalUs: window.requestedSamplingIntervalUs, requestedStartElapsedMs: window.warmupMs, requestedStopElapsedMs: window.profileStopMs,
      requestedProfileDurationMs: window.requestedProfileDurationMs, actualStartElapsedMs: window.actualStartElapsedMs, actualStopElapsedMs: window.actualStopElapsedMs,
      actualProfileDurationMs: window.actualProfileDurationMs, startDelayMs: window.startDelayMs, stopDelayMs: window.stopDelayMs, stoppedBy: window.stoppedBy, error: window.error,
      clockAlignment: alignment === null ? null : { valid: alignment.valid, issues: alignment.issues, offsetSpreadMs: alignment.offsetSpreadMs, maxPairPrecisionMs: alignment.maxPairPrecisionMs,
        profileDurationMs: alignment.profileDurationMs, sumDeltasMs: alignment.sumDeltasMs, negativeTimeDeltas: alignment.negativeDeltas } },
    intervals: { valid: reconstruction.valid, issues: reconstruction.issues, records: reconstruction.records, intervals: reconstruction.intervals.length, depthsCompleted: reconstruction.depthsCompleted,
      phaseCompletions: reconstruction.phaseCompletions, openInterval: reconstruction.openInterval, boundaryRecordsEmitted: last?.boundary?.emitted ?? null,
      boundaryWriteFailures: last?.boundary?.writeFailures ?? null, depthRecordsCollected: depthParity.b2c2b2hDepths },
    spans, stateGenerationBlock: block === null ? null : { file: block.file, startLine: block.startLine, endLine: block.endLine, subBlocks: block.subBlocks },
    cpuAttribution: profileAnalysis,
    yieldWait,
    b2c2b2gStyleProfile: last === null ? null : { reconciliation, inner: innerObservation, innerCounts: last.inner.counts, yields: last.yields, yieldsByInnerSection: last.inner.yieldsByInnerSection,
      outerSanity: outerSanity === null ? null : { checks: outerSanity.checks, largestCategory: outerSanity.largestCategory, categoryShares: outerSanity.categories?.shares ?? null },
      note: 'B2-C2B2G\'s section timings of this run, recorded for context only: the CPU profiler changes the runtime, so nothing here is compared with B2-C2B2G.' },
    categoryRules: analysis.PHASE2C26B2C2B2H_CATEGORY_RULES,
    decisionRule: analysis.PHASE2C26B2C2B2H_DECISION_RULE,
    invalidReasons,
    insufficientReasons: qualityIssues,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  const shares = profileAnalysis?.categories.map(c => [c.category, c.samples, c.shareOfActive === null ? null : Number(c.shareOfActive.toFixed(4))]) ?? null
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, decision: decision.case, dominant: decision.dominant, secondary: decision.secondary, invalidReasons,
    insufficientReasons: qualityIssues, samples: profileAnalysis === null ? null : { interval: profileAnalysis.intervalSamples, active: profileAnalysis.activeSamples, idle: profileAnalysis.idleSamples }, shares,
    yieldWait, semanticParity: { valid: depthParity.valid, common: depthParity.commonDepths } }, null, 2))
} finally {
  await server.close()
}
