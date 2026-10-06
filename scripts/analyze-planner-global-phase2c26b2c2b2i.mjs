// Issue #154 Phase 2-C2.6-B2-C2B2I post-hoc analysis only. Reads the finished B2-C2B2I raw run and its run dir (start attestation,
// processes.jsonl, the probe record, the Search child's durable B2-C2B2G snapshots, durable section stream, CPU profile, capture
// manifest and script table, and the child-attested Search identity) and, as explicit file arguments AFTER the run ended, the probe
// manifest, the Export (to re-derive the unchanged B2-C1 schedule, the task and the excluded current Route), the committed B2-C2B2H RESULT
// (the formal before authority) with its local raw files (raw, durable snapshots, section stream, CPU profile, capture, script table:
// SHA-256 checked against the RESULT) and the committed B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs (the identity chain). It runs no Search,
// no kernel and no Planner, reads no oracle, and feeds no evidence into any calculation. The registered function spans and the
// state_generation block of each profile are read from that run's measured HEAD source text (git show).
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b2h: option('--b2c2b2h-result'),
  b2c2b2hRaw: option('--b2c2b2h-raw'), b2c2b2hRunDir: option('--b2c2b2h-run-dir'), b2c2b2g: option('--b2c2b2g-result'), b2c2b2f: option('--b2c2b2f-result'),
  b2c2b2e: option('--b2c2b2e-result'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2i.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b2h-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json --b2c2b2h-raw <B2-C2B2H raw .json.local> --b2c2b2h-run-dir <B2-C2B2H run dir> --b2c2b2g-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json --b2c2b2f-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b2hFile, b2c2b2gFile, b2c2b2fFile, b2c2b2eFile] = await Promise.all([paths.run, paths.probes, paths.export, paths.b2c2b2h,
  paths.b2c2b2g, paths.b2c2b2f, paths.b2c2b2e].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const jsonLines = file => file.raw.toString('utf8').split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2IAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2i.mjs']
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
  const i = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2I.ts')
  const h = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2H.ts')
  const iTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ITargets.ts')
  const hTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HTargets.ts')
  const gTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2GTargets.ts')
  const fTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2FTargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2IAnalysis.ts')
  const hAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HAnalysis.ts')
  const structure = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2HCpuProfile.ts')
  const gAnalysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2GAnalysis.ts')
  const a5Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts')
  const d2Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DAnalysis.ts')
  const b2c1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')

  const invalidReasons = []
  const reg = iTargets.PHASE2C26B2C2B2I_REGISTERED_B2C2B2H
  // The B2-C2B2H / B2-C2B2G / B2-C2B2F / B2-C2B2E authorities.
  const parsedH = iTargets.parsePhase2C26B2C2B2IB2C2B2HAuthority(json(b2c2b2hFile), b2c2b2hFile.source.sha256)
  if (!parsedH.valid) invalidReasons.push(...parsedH.issues.map(x => `b2c2b2h_authority: ${x}`))
  const parsedG = hTargets.parsePhase2C26B2C2B2HB2C2B2GAuthority(json(b2c2b2gFile), b2c2b2gFile.source.sha256)
  if (!parsedG.valid) invalidReasons.push(...parsedG.issues.map(x => `b2c2b2g_authority: ${x}`))
  const parsedF = gTargets.parsePhase2C26B2C2B2GB2C2B2FAuthority(json(b2c2b2fFile), b2c2b2fFile.source.sha256)
  if (!parsedF.valid) invalidReasons.push(...parsedF.issues.map(x => `b2c2b2f_authority: ${x}`))
  const parsedE = fTargets.parsePhase2C26B2C2B2FB2C2B2EAuthority(json(b2c2b2eFile), b2c2b2eFile.source.sha256)
  if (!parsedE.valid) invalidReasons.push(...parsedE.issues.map(x => `b2c2b2e_authority: ${x}`))

  // The before evidence: the B2-C2B2H formal raw files, which must be the ones the B2-C2B2H RESULT recorded.
  const beforePath = name => (name === 'run' ? paths.b2c2b2hRaw : join(paths.b2c2b2hRunDir, parsedH.authority?.beforeFiles[name]?.file ?? `missing-${name}`))
  const beforeFiles = {}
  const beforeEvidence = {}
  for (const name of i.PHASE2C26B2C2B2I_BEFORE_FILES) {
    const path = beforePath(name)
    const recorded = parsedH.authority?.beforeFiles[name] ?? null
    const file = existsSync(path) ? await loadRaw(path) : null
    beforeFiles[name] = file
    beforeEvidence[name] = { file: basename(path), recordedSha256: recorded?.sha256 ?? null, localSha256: file?.source.sha256 ?? null,
      matches: recorded !== null && file !== null && file.source.file === recorded.file && file.source.sha256 === recorded.sha256 }
    if (!beforeEvidence[name].matches) invalidReasons.push(`before_evidence: ${name} is not the B2-C2B2H RESULT's recorded file`)
  }
  const beforeEvidenceValid = Object.values(beforeEvidence).every(e => e.matches)

  // Launch provenance (evidence grade): the runner start attestation of the run dir, verified against independent values.
  const probeManifestParse = i.parsePhase2C26B2C2B2IProbeManifest(json(probesFile))
  if (!probeManifestParse.valid) invalidReasons.push(...probeManifestParse.issues.map(x => `probe_manifest: ${x}`))
  const attestationPath = join(paths.runDir, i.PHASE2C26B2C2B2I_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const recordedBeforeFiles = Object.fromEntries(i.PHASE2C26B2C2B2I_BEFORE_FILES.map(name => [name, parsedH.authority?.beforeFiles[name]?.sha256 ?? '']))
  const launchProvenance = analysis.phase2c26b2c2b2iLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      b2c2b2hResultSha256: reg.resultSha256, b2c2b2hMeasuredHead: reg.measuredHead, b2c2b2gResultSha256: reg.b2c2b2gResultSha256, b2c2b2fResultSha256: reg.b2c2b2fResultSha256,
      b2c2b2eResultSha256: reg.b2c2b2eResultSha256, b2c2b2hBeforeFiles: recordedBeforeFiles, productionChangedFiles: [...i.PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES],
      probes: probeManifestParse.manifest?.probes ?? [], expectedTaskIdentities: probeManifestParse.manifest?.expectedTaskIdentities ?? [],
      firstChildStartedAt: r.probe?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  if (attestationFile !== null) invalidReasons.push(...launchProvenance.integrityIssues.map(x => `start_attestation: ${x}`))
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2iEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: false })

  // The Production change registration: from B2-C2B2H's measured HEAD to this run's measured HEAD, re-derived here.
  const beforeHead = parsedH.authority?.measuredHead ?? reg.measuredHead
  const changedBetweenHeads = git('diff', '--name-only', beforeHead, measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)
  const productionChangedFiles = i.phase2c26b2c2b2iProductionChangedFiles(changedBetweenHeads)
  const sourceCheck = i.phase2c26b2c2b2iOptimizationSourceCheck(gitBuffer('show', `${beforeHead}:${i.PHASE2C26B2C2B2I_OPTIMIZATION.file}`).toString('utf8'),
    gitBuffer('show', `${measuredHead}:${i.PHASE2C26B2C2B2I_OPTIMIZATION.file}`).toString('utf8'))
  const productionChange = { beforeHead, afterHead: measuredHead, changedPaths: changedBetweenHeads, productionChangedFiles, registered: [...i.PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES],
    equalsRegistered: JSON.stringify(productionChangedFiles) === JSON.stringify([...i.PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES]),
    equalsRunnerAttested: JSON.stringify(productionChangedFiles) === JSON.stringify(r.environment.productionChangedFiles), sourceCheck, optimization: i.PHASE2C26B2C2B2I_OPTIMIZATION }
  if (!productionChange.equalsRegistered) invalidReasons.push(`production_change: ${productionChangedFiles.join(', ') || 'nothing'} is not exactly the registered ${i.PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES.join(', ')}`)
  if (!productionChange.equalsRunnerAttested) invalidReasons.push('production_change: not the runner-attested Production change')
  if (!sourceCheck.valid) invalidReasons.push(...sourceCheck.issues.map(x => `production_change: ${x}`))

  // The committed regression tests (frozen pre-optimization records) present at the measured HEAD.
  const testFiles = ['src/domain/search/predictKeepNestedCache.test.ts', 'src/test/fixtures/predictKeepCachePreB2I.json', 'src/test/fixtures/predictKeepCacheParity.ts',
    'src/domain/search/reservedBonusStreamSinglePass.test.ts', 'src/test/fixtures/reservedBonusStreamPreD2D.json', 'src/domain/search/bonusStreamIndependence.test.ts']
  const regressionTests = Object.fromEntries(testFiles.map(file => {
    try { return [file, sha(gitBuffer('show', `${measuredHead}:${file}`))] } catch { return [file, null] }
  }))
  for (const [file, value] of Object.entries(regressionTests)) if (value === null) invalidReasons.push(`regression_tests: ${file} is not at the measured HEAD`)

  // The population and the expected manifest, re-derived here.
  const derived = iTargets.phase2c26b2c2b2iPopulation(parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
  if (!derived.valid) invalidReasons.push(...derived.issues.map(x => `population: ${x}`))
  const expectedManifest = parsedH.valid && parsedG.valid && parsedF.valid && parsedE.valid && derived.valid
    ? iTargets.phase2c26b2c2b2iProbeManifest(parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority) : null
  const manifest = probeManifestParse.manifest
  const exportSha256 = exportFile.source.sha256
  const hashChain = {
    b2c2b2hResultIsRegistered: b2c2b2hFile.source.sha256 === reg.resultSha256,
    b2c2b2gResultIsRegistered: b2c2b2gFile.source.sha256 === reg.b2c2b2gResultSha256,
    b2c2b2fResultIsRegistered: b2c2b2fFile.source.sha256 === reg.b2c2b2fResultSha256,
    b2c2b2eResultIsRegistered: b2c2b2eFile.source.sha256 === reg.b2c2b2eResultSha256,
    b2c2b2hMadeAgainstB2C2B2G: parsedH.authority?.b2c2b2gResultSha256 === b2c2b2gFile.source.sha256,
    b2c2b2hMadeAgainstB2C2B2F: parsedH.authority?.b2c2b2fResultSha256 === b2c2b2fFile.source.sha256,
    b2c2b2hMadeAgainstB2C2B2E: parsedH.authority?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    b2c2b2gMadeAgainstB2C2B2F: parsedG.authority?.b2c2b2fResultSha256 === b2c2b2fFile.source.sha256,
    b2c2b2gMadeAgainstB2C2B2E: parsedG.authority?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    b2c2b2fMadeAgainstB2C2B2E: parsedF.authority?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestFromB2C2B2H: manifest?.b2c2b2hResultSha256 === b2c2b2hFile.source.sha256,
    probeManifestFromB2C2B2G: manifest?.b2c2b2gResultSha256 === b2c2b2gFile.source.sha256,
    probeManifestFromB2C2B2F: manifest?.b2c2b2fResultSha256 === b2c2b2fFile.source.sha256,
    probeManifestFromB2C2B2E: manifest?.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    b2c2b2hMatchesRunner: b2c2b2hFile.source.sha256 === r.environment.b2c2b2hResultSha256,
    beforeFilesMatchRunner: JSON.stringify(r.environment.b2c2b2hBeforeFiles) === JSON.stringify(recordedBeforeFiles),
    beforeFilesMatchRecorded: beforeEvidenceValid,
    exportMatchesRunner: exportSha256 === r.environment.exportSha256,
    exportMatchesProbeManifest: exportSha256 === manifest?.exportSha256,
    exportMatchesB2C2B2H: exportSha256 === parsedH.authority?.exportSha256,
    exportMatchesB2C2B2G: exportSha256 === parsedG.authority?.exportSha256,
    exportMatchesB2C2B2F: exportSha256 === parsedF.authority?.exportSha256,
    exportMatchesB2C2B2E: exportSha256 === parsedE.authority?.exportSha256,
  }
  for (const [name, ok] of Object.entries(hashChain)) if (ok !== true) invalidReasons.push(`hash_chain: ${name}`)
  const populationParity = { manifestEqualsDerived: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(manifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(manifest?.probes.map(p => p.targetWeaponId) ?? null),
    runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(manifest?.probes ?? null),
    runnerIdentitiesEqualManifest: JSON.stringify(r.environment.expectedTaskIdentities) === JSON.stringify(manifest?.expectedTaskIdentities ?? null),
    probesEqualB2C2B2HProfiled: JSON.stringify(manifest?.probes ?? null) === JSON.stringify(parsedH.authority?.probes ?? null),
    identitiesEqualB2C2B2HProfiled: JSON.stringify(manifest?.expectedTaskIdentities ?? null) === JSON.stringify(parsedH.authority?.expectedTaskIdentities ?? null),
    targets: derived.targetWeaponIds.length, chain: derived.chain }
  for (const [name, ok] of Object.entries(populationParity)) if (ok === false) invalidReasons.push(`population: ${name}`)

  // Schedule re-derivation from the Export: the task and the excluded current Route, independent of the runner.
  const input = research.globalResearchInputFromExport(json(exportFile), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const rebuilt = manifest === null ? { valid: false, issues: ['no manifest'], tasks: [] } : i.buildPhase2C26B2C2B2ITasks(schedule, manifest)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(x => `task_rebuild: ${x}`))
  const tasksEqualRebuilt = JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks)
  if (!tasksEqualRebuilt) invalidReasons.push('task_rebuild: the raw tasks are not the re-derived tasks')
  const eTaskRow = parsedE.authority?.taskRows.find(t => t.taskId === manifest?.probes[0]?.b2c2b2dTaskId) ?? null
  const rederivation = eTaskRow === null ? null : d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, eTaskRow, sha)
  if (rederivation === null || !rederivation.valid) invalidReasons.push(...(rederivation?.issues ?? ['no B2-C2B2E task row']).map(x => `excluded_route: ${x}`))
  const expectedIdentity = manifest?.expectedTaskIdentities[0] ?? null

  // The Search child: one run, B2-C2B2H's registered conditions.
  const run = r.stage1[0] ?? null
  const conditionIssues = analysis.phase2c26b2c2b2iConditionIssues({ smoke, runs: r.stage1, cpuProfilerConfig: r.environment.cpuProfilerConfig })
  invalidReasons.push(...conditionIssues.map(x => `conditions: ${x}`))
  const hc = parsedH.authority?.conditions ?? null
  const conditionChecks = {
    stage1IsRegistered: JSON.stringify(r.environment.stage1) === JSON.stringify(smoke ? { ...i.PHASE2C26B2C2B2I_STAGE1, budgetMs: r.environment.smoke.budgetMs ?? i.PHASE2C26B2C2B2I_STAGE1.budgetMs } : i.PHASE2C26B2C2B2I_STAGE1),
    stage1EqualsB2C2B2H: JSON.stringify(i.PHASE2C26B2C2B2I_STAGE1) === JSON.stringify(hc?.stage1 ?? null),
    budgetIs30Minutes: i.PHASE2C26B2C2B2I_STAGE1.budgetMs === 1_800_000, heapIs12288Mb: i.PHASE2C26B2C2B2I_STAGE1.childHeapMb === 12_288, concurrencyIs1: i.PHASE2C26B2C2B2I_STAGE1.concurrency === 1,
    noRetry: i.PHASE2C26B2C2B2I_STAGE1.retry === 'none' && r.stage1.length === 1, noFallback: i.PHASE2C26B2C2B2I_STAGE1.fallback === 'none',
    instrumentationIsTwoObservers: JSON.stringify(r.environment.searchInstrumentation) === JSON.stringify({ onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false }),
    instrumentationEqualsB2C2B2H: JSON.stringify(r.environment.searchInstrumentation) === JSON.stringify(hc?.searchInstrumentation ?? null),
    innerSectionsAreRegistered: JSON.stringify(r.environment.innerSections) === JSON.stringify([...h.PHASE2C26B2C2B2H_INNER_SECTIONS]),
    optimizationIsTheOnlyChange: JSON.stringify(r.environment.changedFromB2C2B2H) === JSON.stringify([...i.PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H]),
    cpuProfilerOn: r.environment.cpuProfiler === true,
    cpuProfilerConfigEqualsB2C2B2H: smoke || JSON.stringify(r.environment.cpuProfilerConfig) === JSON.stringify(hc?.cpuProfilerConfig ?? null),
    cpuProfilerConfigIsRegistered: smoke || JSON.stringify(r.environment.cpuProfilerConfig) === JSON.stringify({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 }),
    nodeFlagsEqualB2C2B2H: JSON.stringify(r.environment.nodeFlags) === JSON.stringify(hc?.nodeFlags ?? null),
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
  // A missing / unrecorded snapshot file is no Search identity (INVALID); a missing CPU capture is an unusable after profile.
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
    excludedRouteEqualsB2C2B2H: childIdentity?.excludedRouteKeySha256s?.[0] === parsedH.authority?.excludedRouteKeySha256 }
  const identityParity = Object.values(childIdentityChecks).every(ok => ok === true)

  // One profile's attribution with B2-C2B2H's classification (spans and block from that run's measured HEAD source text).
  const profileOf = async ({ head, sectionsFile, cpuFile, captureFile, scriptsFile, snapshots, extraIssues }) => {
    const reconstruction = hAnalysis.reconstructPhase2C26B2C2B2HIntervals(sectionsFile === null ? [] : jsonLines(sectionsFile))
    const capture = captureFile === null ? null : json(captureFile)
    const sourceTexts = Object.fromEntries(structure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(file => [file, gitBuffer('show', `${head}:${file}`).toString('utf8')]))
    let spans = null, block = null, spanDerivationError = null
    try {
      spans = structure.derivePhase2C26B2C2B2HFunctionSpans(sourceTexts)
      block = structure.derivePhase2C26B2C2B2HStateGenerationBlock(sourceTexts[structure.PHASE2C26B2C2B2H_BLOCK_MARKERS.file])
    } catch (error) { spanDerivationError = String(error) }
    let profileAnalysis = null, profileError = null
    if (cpuFile !== null && scriptsFile !== null && capture !== null && spans !== null && block !== null) {
      try {
        const cpu = hAnalysis.validatePhase2C26B2C2B2HCpuProfile(json(cpuFile))
        const table = a5Analysis.createPhase2C26A5ScriptTable(json(scriptsFile), map => new sourceMap.SourceMapConsumer(map))
        profileAnalysis = hAnalysis.analyzePhase2C26B2C2B2HProfile(cpu, table, spans, sourceTexts, block, capture.window, reconstruction)
      } catch (error) { profileError = String(error) }
    }
    const selection = gAnalysis.phase2c26b2c2b2gSelectSnapshot(snapshots)
    const last = selection.last
    const inner = last === null ? null : gAnalysis.phase2c26b2c2b2gInnerObservation(last)
    const quality = [...extraIssues, ...(profileError === null ? [] : [`profile: ${profileError}`]), ...hAnalysis.phase2c26b2c2b2hProfileQuality({
      profileWritten: cpuFile !== null, scriptTableWritten: scriptsFile !== null, requiredSourceMaps: capture?.scripts?.requiredSourceMaps ?? Object.fromEntries(structure.PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(f => [f, false])),
      window: capture === null ? null : { stoppedBy: capture.window.stoppedBy, error: capture.window.error, actualProfileDurationMs: capture.window.actualProfileDurationMs },
      spanDerivationError, outerContractViolations: last?.runtime.contractViolations ?? null, innerContractViolations: inner?.contractViolations ?? null,
      outsideReadViolations: inner?.outsideReadViolations ?? null, boundaryWriteFailures: last?.boundary?.writeFailures ?? null }, profileAnalysis)]
    if (last === null) quality.push('no profile snapshot')
    else if (!selection.valid) quality.push(...selection.issues.map(x => `snapshots: ${x}`))
    return { reconstruction, capture, spans, block, profileAnalysis, quality, selection, last, inner }
  }

  // Before (B2-C2B2H formal) and after (this run).
  const beforeSnapshots = beforeFiles.profile === null ? [] : jsonLines(beforeFiles.profile).filter(l => l.kind === 'profile_snapshot')
  const afterSnapshots = lines.filter(l => l.kind === 'profile_snapshot')
  const beforeProfile = beforeEvidenceValid ? await profileOf({ head: beforeHead, sectionsFile: beforeFiles.sections, cpuFile: beforeFiles.cpuProfile, captureFile: beforeFiles.capture,
    scriptsFile: beforeFiles.scripts, snapshots: beforeSnapshots, extraIssues: [] }) : null
  const afterProfile = await profileOf({ head: measuredHead, sectionsFile: sectionsIn.file, cpuFile: cpuIn.file, captureFile: captureIn.file, scriptsFile: scriptsIn.file,
    snapshots: afterSnapshots, extraIssues: captureIssues })
  const direct = beforeEvidenceValid ? analysis.phase2c26b2c2b2iDirectComparison(beforeSnapshots, afterSnapshots) : null
  const cpu = beforeProfile === null ? null : analysis.phase2c26b2c2b2iCpuComparison({ beforeRecordedShare: parsedH.authority?.keepPredictionShareOfActive ?? NaN,
    beforeAnalysis: beforeProfile.profileAnalysis, beforeQualityIssues: beforeProfile.quality, afterAnalysis: afterProfile.profileAnalysis, afterQualityIssues: afterProfile.quality })
  if (cpu !== null && !cpu.beforeReproduced) invalidReasons.push(`before_profile: the re-analysis share ${cpu.beforeRecomputedShare} does not reproduce the B2-C2B2H RESULT's ${cpu.beforeRecordedShare}`)
  if (cpu !== null && cpu.beforeQualityIssues.length > 0) invalidReasons.push(...cpu.beforeQualityIssues.map(x => `before_profile: ${x}`))
  const decision = analysis.phase2c26b2c2b2iDecision({ invalidReasons, identityParity, direct, cpu })

  // The after run's outcome and memory.
  const profilerStarted = lines.find(l => l.kind === 'profiler_started') ?? null
  const alignment = afterProfile.profileAnalysis?.alignment ?? null
  const windowAtMs = alignment !== null && alignment.researchProfileStartMs !== null && profilerStarted !== null
    ? { fromMs: alignment.researchProfileStartMs - profilerStarted.originChildProcessMs, toMs: alignment.researchProfileEndMs - profilerStarted.originChildProcessMs } : null
  const yieldWait = hAnalysis.phase2c26b2c2b2hYieldWait(afterSnapshots, windowAtMs)
  const recordFile = run?.outcome.record === 'searched' ? (await loadRaw(join(paths.runDir, run.recordFile.file))) : null
  const search = recordFile === null ? null : json(recordFile).result.search
  const childWallMs = run?.process.wallMs ?? null
  const last = afterProfile.last
  const lastTarget = last?.runtime.byTarget.find(t => t.targetOrdinal === 0) ?? null
  const afterPeak = { peakHeapBytes: Math.max(run?.memory?.sampledMaxHeapUsedBytes ?? 0, run?.lastIpcMemory?.maxHeapUsedBytes ?? 0), peakRssBytes: Math.max(run?.memory?.sampledMaxRssBytes ?? 0, run?.lastIpcMemory?.maxRssBytes ?? 0) }
  const outcome = { process: run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, naturalCompletion: search !== null,
    termination: search?.termination ?? null, candidateCount: search?.candidates.length ?? null, searchElapsedMs: search?.elapsedMs ?? null, safetyCapHit: search?.safetyCapHit ?? null,
    childWallMs, killedAtMs: run?.process.killedAtMs ?? null, budgetMs: run?.process.budgetMs ?? null,
    deliveredBeforeKill: last === null ? null : { deliveryFlushes: lastTarget?.sectionCounts?.delivery_flush ?? null, deliveryConsumerCalls: lastTarget?.sectionCounts?.delivery_consumer ?? null },
    ...afterPeak, yields: run?.yields ?? null, profileSnapshots: afterSnapshots.length, profileSource: afterProfile.selection.source,
    completedDepths: direct?.afterDepths ?? null, generatedStates: last?.inner.counts.generatedStatesSum ?? null,
    lastSnapshot: last === null ? null : { atMs: last.atMs, searchElapsedMs: last.searchElapsedMs, unobservedTailMs: afterProfile.selection.source === 'final' || profilerStarted === null || childWallMs === null ? 0 : Math.max(0, childWallMs - profilerStarted.originChildProcessMs - last.atMs) },
    note: 'A timeout is a normal outcome and is never Candidate 0; a natural completion is recorded as it is. Route quality is no decision input and no Route exact judgement is made.' }
  const beforeLast = beforeProfile?.last ?? null
  const progress = { before: { completedDepths: direct?.beforeDepths ?? null, generatedStates: beforeLast?.inner.counts.generatedStatesSum ?? null, searchElapsedMs: beforeLast?.searchElapsedMs ?? null,
    process: parsedH.authority?.background.childOutcome ?? null },
  after: { completedDepths: direct?.afterDepths ?? null, generatedStates: last?.inner.counts.generatedStatesSum ?? null, searchElapsedMs: last?.searchElapsedMs ?? null, process: outcome.process },
  note: 'whole-run progress of two single runs (descriptive; never the speed-up evidence)' }
  const memory = analysis.phase2c26b2c2b2iMemory({ peakHeapBytes: parsedH.authority?.background.peakHeapBytes ?? null, peakRssBytes: parsedH.authority?.background.peakRssBytes ?? null }, afterPeak)
  const window = afterProfile.capture?.window ?? null
  const probe = r.probe?.probe ?? null
  const shortProfile = (p) => p === null ? null : { qualityIssues: p.quality, valid: p.quality.length === 0,
    intervals: { valid: p.reconstruction.valid, issues: p.reconstruction.issues, records: p.reconstruction.records, intervals: p.reconstruction.intervals.length,
      depthsCompleted: p.reconstruction.depthsCompleted, openInterval: p.reconstruction.openInterval },
    window: p.capture === null ? null : { requestedStartElapsedMs: p.capture.window.warmupMs, requestedStopElapsedMs: p.capture.window.profileStopMs, actualStartElapsedMs: p.capture.window.actualStartElapsedMs,
      actualStopElapsedMs: p.capture.window.actualStopElapsedMs, actualProfileDurationMs: p.capture.window.actualProfileDurationMs, stoppedBy: p.capture.window.stoppedBy, error: p.capture.window.error },
    clockAlignment: p.profileAnalysis === null ? null : { valid: p.profileAnalysis.alignment.valid, issues: p.profileAnalysis.alignment.issues, offsetSpreadMs: p.profileAnalysis.alignment.offsetSpreadMs,
      profileDurationMs: p.profileAnalysis.alignment.profileDurationMs, negativeTimeDeltas: p.profileAnalysis.alignment.negativeDeltas },
    samples: p.profileAnalysis === null ? null : { all: p.profileAnalysis.allProfileSamples, interval: p.profileAnalysis.intervalSamples, idle: p.profileAnalysis.idleSamples, active: p.profileAnalysis.activeSamples },
    categories: p.profileAnalysis?.categories ?? null, unattributedActiveShare: p.profileAnalysis?.unattributedActiveShare ?? null,
    registeredLineMismatches: p.profileAnalysis?.registeredLineMismatches ?? null, topLeaves: p.profileAnalysis?.topLeaves.slice(0, 12) ?? null,
    registeredInclusive: p.profileAnalysis?.registeredInclusive ?? null, ownerSubBlockTicks: p.profileAnalysis?.ownerSubBlockTicks ?? null,
    predictKeepLineTicks: analysis.phase2c26b2c2b2iPredictKeepLineTicks(p.profileAnalysis), workInWindow: p.profileAnalysis?.workInWindow ?? null }

  const result = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2I (post-hoc analysis): predictKeep nested (counter, family layout) memo, formal before (B2-C2B2H) / after check on the B2-C2B2H keep_prediction Target',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, processes: processesFile.source, profile: profileIn.file?.source ?? null, sections: sectionsIn.file?.source ?? null,
      cpuProfile: cpuIn.file?.source ?? null, capture: captureIn.file?.source ?? null, scripts: scriptsIn.file?.source ?? null, probeManifest: probesFile.source, export: exportFile.source,
      b2c2b2hResult: b2c2b2hFile.source, b2c2b2gResult: b2c2b2gFile.source, b2c2b2fResult: b2c2b2fFile.source, b2c2b2eResult: b2c2b2eFile.source, b2c2b2hBefore: beforeEvidence },
    provenance: { formal, evidenceGrade, partialRun: false, launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source,
      launchProvenanceReason: launchProvenance.reason, launchProvenanceIssues: launchProvenance.issues, launchProvenanceIntegrityIssues: launchProvenance.integrityIssues,
      startAttestation: attestationFile === null ? null : { file: attestationFile.source.file, sha256: attestationFile.source.sha256, bytes: attestationFile.source.bytes, body: json(attestationFile) },
      measuredHead, measuredHeadSource: 'runner_start_attestation', measuredHeadIsAncestor, measuredAt: r.measuredAt, recomputedBenchmarkCodeSha256,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'], uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, smoke: r.environment.smoke,
      exportSha256, b2c2b2hResultSha256: b2c2b2hFile.source.sha256, b2c2b2hMeasuredHead: beforeHead, b2c2b2gResultSha256: b2c2b2gFile.source.sha256,
      b2c2b2fResultSha256: b2c2b2fFile.source.sha256, b2c2b2eResultSha256: b2c2b2eFile.source.sha256, probeManifestSha256: probesFile.source.sha256, ...i.PHASE2C26B2C2B2I_PROVENANCE_FLAGS },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, cpu: r.environment.cpu,
      logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, freeMemoryBytesAtLaunch: r.environment.freeMemoryBytesAtLaunch,
      rngEngineVersion: r.environment.rngEngineVersion, profilerMethod: r.environment.profilerMethod },
    productionChange,
    conditions: { stage1: r.environment.stage1, b2c2b2hStage1: r.environment.b2c2b2hStage1, changedFromB2C2B2H: r.environment.changedFromB2C2B2H, conditionChecks,
      searchInstrumentation: r.environment.searchInstrumentation, innerSections: r.environment.innerSections, section: r.environment.section, cpuProfiler: r.environment.cpuProfiler,
      cpuProfilerConfig: r.environment.cpuProfilerConfig, nodeFlags: r.environment.nodeFlags, sectionStream: r.environment.sectionStream, heartbeatIntervalMs: r.environment.heartbeatIntervalMs,
      windowsMs: r.environment.windowsMs, memorySampleIntervalMs: r.environment.memorySampleIntervalMs, nodeYield: r.environment.nodeYield, candidateSafetyCap: r.environment.candidateSafetyCap,
      maxCostCohorts: r.environment.maxCostCohorts, notRun: r.environment.notRun, calculationContext: run?.calculationContext ?? r.tasksChild.calculationContext, researchMaxPlanSteps: r.tasksChild.researchMaxPlanSteps },
    population: { rule: `B2-C2B2H decision.case = ${reg.decisionCase} and decision.nextPhaseCategories = [${reg.nextPhaseCategories.join(', ')}]: the Target B2-C2B2H profiled, cross-checked against the population B2-C2B2H's derivation re-derives from B2-C2B2G, B2-C2B2F and B2-C2B2E`,
      targetWeaponIds: derived.targetWeaponIds, probes: manifest?.probes ?? null },
    parity: { b2c2b2hAuthority: { valid: parsedH.valid, issues: parsedH.issues, decisionCase: parsedH.authority?.decisionCase ?? null, keepPredictionShareOfActive: parsedH.authority?.keepPredictionShareOfActive ?? null },
      b2c2b2gAuthority: { valid: parsedG.valid, issues: parsedG.issues }, b2c2b2fAuthority: { valid: parsedF.valid, issues: parsedF.issues }, b2c2b2eAuthority: { valid: parsedE.valid, issues: parsedE.issues },
      hashChain, population: populationParity, taskRebuild: { valid: rebuilt.valid, issues: rebuilt.issues, tasksEqualRebuilt },
      identity: { expected: expectedIdentity, raw: r.tasks[0] ? i.phase2c26b2c2b2iTaskIdentity(r.tasks[0]) : null,
        rawEqualsExpected: r.tasks[0] ? JSON.stringify(i.phase2c26b2c2b2iTaskIdentity(r.tasks[0])) === JSON.stringify(expectedIdentity) : false },
      excludedRoute: rederivation === null ? null : { valid: rederivation.valid, issues: rederivation.issues, excludedRouteKeyCount: rederivation.excludedRouteKeyCount,
        excludedRouteIsCurrentRoute: rederivation.excludedRouteIsCurrentRoute, rederivedExcludedRouteKeySha256: rederivation.excludedRouteKeySha256,
        b2c2b2hExcludedRouteKeySha256: parsedH.authority?.excludedRouteKeySha256 ?? null, childAttestedExcludedRouteKeySha256: childIdentity?.excludedRouteKeySha256s?.[0] ?? null },
      childIdentity: childIdentityChecks },
    semanticParity: { valid: direct !== null && direct.semanticParity && identityParity, commonDepthPrefix: direct === null ? null : { semanticParity: direct.semanticParity, beforeDepths: direct.beforeDepths,
      afterDepths: direct.afterDepths, commonDepths: direct.commonDepths, firstMismatch: direct.firstMismatch, commonGeneratedStates: direct.commonGeneratedStates, issues: direct.issues },
      searchInputAndExcludedRoute: { valid: identityParity, checks: childIdentityChecks },
      committedRegressionTests: { note: 'bounded ordinary / held-aware stream, bounded Candidate Search / Planner Alternative Search records, Candidate ordering / termination and every Engine call with its exact input, frozen from main 4007ef1 (the composite key) and compared at the measured HEAD by these committed tests', files: regressionTests } },
    directComparison: direct,
    cpuHotspot: cpu === null ? null : { ...cpu, beforePredictKeepLineTicks: parsedH.authority?.predictKeepLineTicks ?? null,
      afterPredictKeepLineTicks: analysis.phase2c26b2c2b2iPredictKeepLineTicks(afterProfile.profileAnalysis),
      afterSourceHasCompositeKey: sourceCheck.afterHasCompositeKey },
    profiles: { before: shortProfile(beforeProfile), after: shortProfile(afterProfile) },
    probe: probe === null ? null : { valid: probe.valid, issues: probe.issues, samples: probe.samples, observedMedianIntervalUs: probe.observedMedianIntervalUs, alignment: probe.alignment,
      requiredSourceMaps: probe.scripts?.requiredSourceMaps ?? null, frameLines: probe.frameLines, stateGenerationBlock: probe.stateGenerationBlock },
    outcome,
    progress,
    memory,
    yieldWait,
    profilerWindow: window === null ? null : { requestedSamplingIntervalUs: window.requestedSamplingIntervalUs, requestedStartElapsedMs: window.warmupMs, requestedStopElapsedMs: window.profileStopMs,
      requestedProfileDurationMs: window.requestedProfileDurationMs, actualStartElapsedMs: window.actualStartElapsedMs, actualStopElapsedMs: window.actualStopElapsedMs,
      actualProfileDurationMs: window.actualProfileDurationMs, startDelayMs: window.startDelayMs, stopDelayMs: window.stopDelayMs, stoppedBy: window.stoppedBy, error: window.error },
    decisionRule: analysis.PHASE2C26B2C2B2I_DECISION_RULE,
    thresholds: { adoptMaxKeepShareRatio: analysis.PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO, adoptMaxDirectRatio: analysis.PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO,
      regressionDirectRatio: analysis.PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO, noEffectRatio: analysis.PHASE2C26B2C2B2I_NO_EFFECT_RATIO },
    invalidReasons,
    afterProfileQualityIssues: afterProfile.quality,
    decision,
  }
  await writeFile(paths.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, decision: decision.case, adoption: decision.adoption, invalidReasons,
    afterQuality: afterProfile.quality, semanticParity: result.semanticParity.valid, commonDepths: direct?.commonDepths ?? null,
    stateGeneration: direct === null ? null : { beforeMs: direct.beforeStateGenerationMs, afterMs: direct.afterStateGenerationMs, ratio: direct.stateGenerationDirectRatio },
    keep: cpu === null ? null : { before: cpu.beforeRecordedShare, beforeRecomputed: cpu.beforeRecomputedShare, after: cpu.afterShare, ratio: cpu.keepPredictionShareRatio },
    outcome: { process: outcome.process, termination: outcome.termination, candidateCount: outcome.candidateCount }, memory }, null, 2))
} finally {
  await server.close()
}
